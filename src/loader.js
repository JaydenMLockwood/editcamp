import LibRaw from "libraw-wasm";

export const RAW_EXTS = [
  "arw", "srf", "sr2",              // Sony
  "cr2", "cr3", "crw",              // Canon
  "nef", "nrw",                     // Nikon
  "raf",                            // Fujifilm
  "rw2",                            // Panasonic
  "orf",                            // Olympus / OM System
  "pef",                            // Pentax
  "srw",                            // Samsung
  "dng",                            // Adobe / phones / Leica etc.
  "3fr", "fff",                     // Hasselblad
  "iiq",                            // Phase One
  "erf", "mrw", "kdc", "dcr", "x3f" // others
];

export function isRawFile(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return RAW_EXTS.includes(ext);
}

/* Load any supported file. Returns:
   { data: Uint8ClampedArray (RGBA), width, height, meta: {...} | null }   */
export async function loadFile(file, onStatus) {
  if (isRawFile(file.name)) {
    return loadRaw(file, onStatus);
  }
  return loadStandardImage(file, onStatus);
}

async function loadRaw(file, onStatus) {
  onStatus && onStatus("Reading file\u2026");
  const buf = new Uint8Array(await file.arrayBuffer());

  onStatus && onStatus("Decoding RAW \u2014 big files can take several seconds\u2026");
  const raw = new LibRaw();
  try {
    await raw.open(buf, {
      useCameraWb: true, // start from the camera's white balance guess
      outputBps: 8,
    });

    let meta = null;
    try {
      const m = await raw.metadata();
      if (m) {
        meta = {
          make: m.make || "",
          model: m.model || "",
          iso: m.iso_speed || null,
          shutter: m.shutter || null,
          aperture: m.aperture || null,
          focal: m.focal_len || null,
        };
      }
    } catch (e) {
      /* metadata is a nice-to-have */
    }

    const img = await raw.imageData();
    if (!img || !img.data) {
      throw new Error("Decoder returned no image data.");
    }

    onStatus && onStatus("Preparing pixels\u2026");
    const { width, height, colors } = img;
    const src = img.data;
    const out = new Uint8ClampedArray(width * height * 4);
    if (colors === 3) {
      for (let i = 0, o = 0; o < out.length; i += 3, o += 4) {
        out[o] = src[i];
        out[o + 1] = src[i + 1];
        out[o + 2] = src[i + 2];
        out[o + 3] = 255;
      }
    } else if (colors === 4) {
      out.set(src.subarray(0, out.length));
      for (let o = 3; o < out.length; o += 4) out[o] = 255;
    } else if (colors === 1) {
      for (let i = 0, o = 0; o < out.length; i += 1, o += 4) {
        out[o] = out[o + 1] = out[o + 2] = src[i];
        out[o + 3] = 255;
      }
    } else {
      throw new Error(`Unexpected channel count from decoder: ${colors}`);
    }

    return { data: out, width, height, meta };
  } finally {
    raw.dispose();
  }
}

async function loadStandardImage(file, onStatus) {
  onStatus && onStatus("Decoding image\u2026");
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw new Error(
      "That image couldn't be decoded. Standard JPG/PNG/WebP should work; if this is a camera RAW file, check that its extension is one of the supported ones."
    );
  }
  const cv = document.createElement("canvas");
  cv.width = bitmap.width;
  cv.height = bitmap.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close && bitmap.close();
  const id = ctx.getImageData(0, 0, cv.width, cv.height);
  return { data: id.data, width: id.width, height: id.height, meta: null };
}

export function formatMeta(meta) {
  if (!meta) return "";
  const parts = [];
  const cam = [meta.make, meta.model].filter(Boolean).join(" ").trim();
  if (cam) parts.push(cam);
  if (meta.iso) parts.push(`ISO ${Math.round(meta.iso)}`);
  if (meta.shutter) {
    parts.push(meta.shutter >= 1 ? `${meta.shutter.toFixed(1)}s` : `1/${Math.round(1 / meta.shutter)}s`);
  }
  if (meta.aperture) parts.push(`f/${meta.aperture.toFixed(1)}`);
  if (meta.focal) parts.push(`${Math.round(meta.focal)}mm`);
  return parts.join(" \u00b7 ");
}
