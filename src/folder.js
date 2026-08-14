/* Folder mode: ingest a folder of photos, generate thumbnails lazily
   (embedded JPEG previews for RAW files), and manage per-photo edit state. */
import LibRaw from "libraw-wasm";
import { isRawFile } from "./loader.js";

export const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];

export function isSupportedImage(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXTS.includes(ext) || isRawFile(name);
}

/* Build the folder photo list from a directory-input FileList */
export function ingestFolder(fileList) {
  const files = Array.from(fileList).filter((f) => isSupportedImage(f.name));
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let folderName = "Folder";
  if (files[0] && files[0].webkitRelativePath) {
    folderName = files[0].webkitRelativePath.split("/")[0] || "Folder";
  }
  return {
    name: folderName,
    photos: files.map((f, i) => ({
      id: i,
      name: f.name,
      file: f,
      raw: isRawFile(f.name),
    })),
  };
}

const THUMB_EDGE = 320;

function fitThumb(w, h) {
  const sc = Math.min(1, THUMB_EDGE / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * sc)), h: Math.max(1, Math.round(h * sc)) };
}

async function drawableToThumbUrl(source, sw, sh) {
  const { w, h } = fitThumb(sw, sh);
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.getContext("2d").drawImage(source, 0, 0, w, h);
  return new Promise((res) =>
    cv.toBlob((b) => res(b ? URL.createObjectURL(b) : null), "image/jpeg", 0.8)
  );
}

/* Generate a thumbnail object URL for one photo. Returns null on failure. */
export async function makeThumb(photo) {
  try {
    if (!photo.raw) {
      const bmp = await createImageBitmap(photo.file).catch(() => null);
      if (!bmp) return null;
      const url = await drawableToThumbUrl(bmp, bmp.width, bmp.height);
      bmp.close && bmp.close();
      return url;
    }
    /* RAW: extract the embedded JPEG preview instead of full-decoding */
    const buf = new Uint8Array(await photo.file.arrayBuffer());
    const raw = new LibRaw();
    try {
      await raw.open(buf, { useCameraWb: true });
      const th = await raw.thumbnailData();
      if (th && th.format === "jpeg" && th.data && th.data.length) {
        const blob = new Blob([th.data], { type: "image/jpeg" });
        const bmp = await createImageBitmap(blob).catch(() => null);
        if (bmp) {
          const url = await drawableToThumbUrl(bmp, bmp.width, bmp.height);
          bmp.close && bmp.close();
          return url;
        }
      }
      /* bitmap-format thumbnail: RGB(A) pixels */
      if (th && th.format === "bitmap" && th.data && th.width && th.height) {
        const rgba = new Uint8ClampedArray(th.width * th.height * 4);
        const ch = th.data.length / (th.width * th.height);
        for (let p = 0, o = 0; o < rgba.length; p += ch, o += 4) {
          rgba[o] = th.data[p];
          rgba[o + 1] = th.data[ch > 1 ? p + 1 : p];
          rgba[o + 2] = th.data[ch > 2 ? p + 2 : p];
          rgba[o + 3] = 255;
        }
        const cv = document.createElement("canvas");
        cv.width = th.width;
        cv.height = th.height;
        cv.getContext("2d").putImageData(new ImageData(rgba, th.width, th.height), 0, 0);
        return await drawableToThumbUrl(cv, th.width, th.height);
      }
      return null;
    } finally {
      raw.dispose();
    }
  } catch (e) {
    return null;
  }
}

/* Small concurrency-limited queue so thumbnail generation never floods
   memory or blocks the UI (RAW preview extraction is the heavy case). */
export function createThumbQueue(concurrency = 2) {
  let active = 0;
  const waiting = [];
  const runNext = () => {
    if (active >= concurrency || waiting.length === 0) return;
    active++;
    const { photo, resolve } = waiting.shift();
    makeThumb(photo).then((url) => {
      active--;
      resolve(url);
      runNext();
    });
  };
  return {
    enqueue(photo) {
      return new Promise((resolve) => {
        waiting.push({ photo, resolve });
        runNext();
      });
    },
    clear() {
      waiting.length = 0;
    },
  };
}
