/* Write a light attribution into exported files' metadata: the standard
   EXIF "Software" tag for JPEGs, and a tEXt chunk for PNGs. Fails open:
   any problem returns the original blob untouched. */
import piexif from "piexifjs";

const SOFTWARE = "EditCamp (editcamp.net)";

function blobToBinaryString(blob) {
  return blob.arrayBuffer().then((buf) => {
    const u8 = new Uint8Array(buf);
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return s;
  });
}

function binaryStringToBlob(str, type) {
  const u8 = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
  return new Blob([u8], { type });
}

export async function tagJpeg(blob) {
  try {
    const data = await blobToBinaryString(blob);
    const exifObj = {
      "0th": { [piexif.ImageIFD.Software]: SOFTWARE },
      Exif: {},
      GPS: {},
    };
    const exifStr = piexif.dump(exifObj);
    return binaryStringToBlob(piexif.insert(exifStr, data), "image/jpeg");
  } catch (e) {
    return blob;
  }
}

/* PNG: insert a tEXt chunk (keyword "Software") right after the IHDR chunk */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) {
    c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export async function tagPng(blob) {
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    /* PNG signature + IHDR must be present */
    if (buf.length < 33 || buf[0] !== 0x89 || buf[1] !== 0x50) return blob;
    const insertAt = 8 + 4 + 4 + 13 + 4; /* after signature + IHDR chunk */

    const keyword = "Software";
    const text = SOFTWARE;
    const payload = new Uint8Array(keyword.length + 1 + text.length);
    for (let i = 0; i < keyword.length; i++) payload[i] = keyword.charCodeAt(i);
    payload[keyword.length] = 0;
    for (let i = 0; i < text.length; i++) {
      payload[keyword.length + 1 + i] = text.charCodeAt(i);
    }

    const chunk = new Uint8Array(4 + 4 + payload.length + 4);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, payload.length);
    chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; /* tEXt */
    chunk.set(payload, 8);
    const crcInput = chunk.subarray(4, 8 + payload.length);
    dv.setUint32(8 + payload.length, crc32(crcInput));

    const out = new Uint8Array(buf.length + chunk.length);
    out.set(buf.subarray(0, insertAt), 0);
    out.set(chunk, insertAt);
    out.set(buf.subarray(insertAt), insertAt + chunk.length);
    return new Blob([out], { type: "image/png" });
  } catch (e) {
    return blob;
  }
}
