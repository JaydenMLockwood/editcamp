/* Crop & straighten: bake a rotated crop of the original image.
   Coordinates: Pc is the crop-rect centre in ROTATED-image space, relative to
   the rotated image's centre, in source pixels. cw/ch are the crop size in
   source pixels. The maths: a point P in rotated space maps back to source
   space via R(-angle); rendering with the transform chain below samples the
   source exactly along that mapping. */

export function applyCrop(full, angleRad, Pc, cw, ch) {
  const w = full.width;
  const h = full.height;

  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  src.getContext("2d").putImageData(new ImageData(full.data, w, h), 0, 0);

  const outW = Math.max(8, Math.round(cw));
  const outH = Math.max(8, Math.round(ch));
  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  /* fill so any empty corners from the rotation come out dark, not transparent */
  ctx.fillStyle = "#101112";
  ctx.fillRect(0, 0, outW, outH);

  ctx.translate(outW / 2, outH / 2);
  ctx.translate(-Pc.x, -Pc.y);
  ctx.rotate(angleRad);
  ctx.translate(-w / 2, -h / 2);
  ctx.drawImage(src, 0, 0);

  const id = ctx.getImageData(0, 0, outW, outH);
  return { data: id.data, width: outW, height: outH, meta: full.meta };
}
