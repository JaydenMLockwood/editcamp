import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPipeline, processFull, resizeRGBA, canvasToBlob, downloadBlob, MIX_BANDS } from "./pipeline.js";
import { applyCrop } from "./crop.js";
import { loadFile, isRawFile, formatMeta, RAW_EXTS } from "./loader.js";

/* ------------------------------------------------------------------ */
/*  EditCamp — learn RAW editing by doing                             */
/* ------------------------------------------------------------------ */

const DEFAULTS = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  noise: 0,
  sharpen: 0,
  clarity: 0,
  dehaze: 0,
  vignette: 0,
  st_sh_hue: 60,
  st_sh_amt: 0,
  st_hi_hue: 15,
  st_hi_amt: 0,
};
for (const [band] of MIX_BANDS) {
  DEFAULTS[`mix_${band}_h`] = 0;
  DEFAULTS[`mix_${band}_s`] = 0;
  DEFAULTS[`mix_${band}_l`] = 0;
}

const SLIDERS = {
  temperature: { label: "Temperature", left: "cooler", right: "warmer" },
  tint: { label: "Tint", left: "green", right: "magenta" },
  exposure: { label: "Exposure", left: "darker", right: "brighter", ev: true },
  contrast: { label: "Contrast", left: "flatter", right: "punchier" },
  highlights: { label: "Highlights", left: "recover", right: "brighten" },
  shadows: { label: "Shadows", left: "deepen", right: "open up" },
  whites: { label: "Whites", left: "pull in", right: "push out" },
  blacks: { label: "Blacks", left: "crush", right: "lift" },
  vibrance: { label: "Vibrance", left: "mute", right: "boost" },
  saturation: { label: "Saturation", left: "mute", right: "boost" },
  noise: { label: "Noise reduction", left: "off", right: "smooth", min: 0 },
  sharpen: { label: "Sharpen", left: "off", right: "crisp", min: 0 },
  clarity: { label: "Clarity", left: "soften", right: "punch" },
  dehaze: { label: "Dehaze", left: "add haze", right: "cut haze" },
  vignette: { label: "Vignette", left: "darken", right: "lighten" },
  st_sh_hue: { label: "Shadows hue", left: "", right: "", min: 0, hue: true },
  st_sh_amt: { label: "Shadows strength", left: "off", right: "strong", min: 0 },
  st_hi_hue: { label: "Highlights hue", left: "", right: "", min: 0, hue: true },
  st_hi_amt: { label: "Highlights strength", left: "off", right: "strong", min: 0 },
};
for (const [band] of MIX_BANDS) {
  SLIDERS[`mix_${band}_h`] = { label: "Hue", left: "shift −", right: "shift +" };
  SLIDERS[`mix_${band}_s`] = { label: "Saturation", left: "mute", right: "boost" };
  SLIDERS[`mix_${band}_l`] = { label: "Luminance", left: "darker", right: "brighter" };
}

const GUIDED_STEPS = [
  {
    key: "wb",
    title: "White balance",
    sliders: ["temperature", "tint"],
    why: "Light has a colour, and cameras don't always guess it right. Photos taken in shade or on cloudy days come out blue-ish. Photos under indoor bulbs come out orange. Fluorescent office light sneaks in green.",
    example: "Think of photos of friends at a restaurant — faces glowing orange from the warm lights. Or a portrait taken in the shade where skin looks slightly grey and cold. Neither is how it looked in real life. That's a white balance problem.",
    look: "Find something in the frame that should be neutral — a white shirt, grey pavement, clouds, paper. Slide Temperature until it stops looking blue or orange and just looks white or grey. Tint fixes green or pink casts; moves there are usually tiny.",
    hist: "White balance barely changes the graph — judge this one entirely with your eyes.",
    range: "Small moves. If you pass ±40 something else is probably wrong.",
  },
  {
    key: "exposure",
    title: "Exposure",
    sliders: ["exposure"],
    why: "Exposure is the overall brightness of the whole frame. Cameras often guess wrong in tricky light, and RAW files come out a little dark and dull on purpose — they leave the decision to you.",
    example: "The classic case: someone standing in front of a bright window or a sunset. The camera darkens everything to protect the sky, and your friend becomes a silhouette. Raising exposure brings them back.",
    look: "Brighten or darken until the main subject — the face, the building, whatever the photo is about — reads clearly. If the sky washes out to white while you do it, ignore that: the next step recovers it.",
    hist: "Watch the whole hill slide left and right as you move the slider. Keep the bulk of it around the middle. If bars pile up against the right wall, you're pushing whites past the point where detail survives.",
    range: "Typically between −0.5 and +1 EV.",
  },
  {
    key: "recover",
    title: "Recover detail",
    sliders: ["highlights", "shadows"],
    why: "This is the RAW superpower. Bright skies and dark corners that look ruined are usually still holding detail — a phone JPEG throws that data away, but here it's recoverable.",
    example: "Beach and mountain photos are the textbook case: the ground looks fine but the sky is a blank white sheet. Pull Highlights down and blue sky and cloud texture reappear — it was there all along. Lift Shadows and faces under hat brims or details inside dark doorways open up.",
    look: "Drag Highlights left and watch the bright areas come back. Drag Shadows right to open the dark areas. Big moves are fine here — this pair is very forgiving.",
    hist: "This step is where the graph earns its keep: the pile jammed against the right wall shrinks as you pull Highlights down, and the left edge comes away from its wall as you lift Shadows. Any clipping warnings should fade or disappear.",
    range: "Highlights −30 to −80, Shadows +20 to +60 are common.",
  },
  {
    key: "contrast",
    title: "Contrast",
    sliders: ["contrast"],
    why: "Recovering highlights and shadows squeezes everything toward the middle, which can leave the photo looking like it's behind a thin fog — technically fine, but lifeless.",
    example: "You've seen this look in old scanned photos, or pictures taken through a dirty window — nothing is truly black, nothing truly white, everything slightly grey. Contrast clears that fog and makes the image feel solid again.",
    look: "Nudge it up until darks feel properly dark and brights feel properly bright, then stop. Push too far and you undo the recovery you just did — skies blow out again, shadows go solid black.",
    hist: "The hill stretches wider, spreading toward both edges — that's the goal. Stop before it starts piling into either wall again.",
    range: "+10 to +30 usually does it.",
  },
  {
    key: "color",
    title: "Color",
    sliders: ["vibrance", "saturation"],
    why: "Colour intensity comes last, once the tones are right. Vibrance boosts the most muted colours while protecting ones that are already strong — especially skin. Saturation boosts everything equally, which gets ugly fast.",
    example: "A market stall of fruit, autumn leaves, a sunset over water — Vibrance makes these sing. But push Saturation on a photo of people and skin goes orange like a bad fake tan. That's why Vibrance comes first.",
    look: "Raise Vibrance until colours feel alive — it's hard to overdo. Add a touch of Saturation only if the photo still feels quiet. If skin tones or skies start looking radioactive, back off.",
    hist: "Colour barely moves this graph — like white balance, trust your eyes here.",
    range: "Vibrance +10 to +40, Saturation 0 to +15.",
  },
];

const ACCEPT =
  "image/*," + RAW_EXTS.map((e) => "." + e).join(",");

/* ------------------------ sample "flat RAW" ----------------------- */

function makeSample() {
  const W = 1400;
  const H = 900;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const x = cv.getContext("2d");

  const sky = x.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, "#a9b6c4");
  sky.addColorStop(0.7, "#cfcbc0");
  sky.addColorStop(1, "#ded4c2");
  x.fillStyle = sky;
  x.fillRect(0, 0, W, H * 0.62);

  const sun = x.createRadialGradient(W * 0.68, H * 0.5, 10, W * 0.68, H * 0.5, 220);
  sun.addColorStop(0, "rgba(255, 244, 214, 0.95)");
  sun.addColorStop(0.25, "rgba(255, 234, 190, 0.55)");
  sun.addColorStop(1, "rgba(255, 234, 190, 0)");
  x.fillStyle = sun;
  x.fillRect(0, 0, W, H * 0.62);

  const ridge = (base, amp, color, seed) => {
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, H);
    for (let px = 0; px <= W; px += 8) {
      const t = px / W;
      const y =
        base +
        Math.sin(t * 5.1 + seed) * amp +
        Math.sin(t * 13.7 + seed * 2.3) * amp * 0.4 +
        Math.sin(t * 29.0 + seed * 4.1) * amp * 0.15;
      x.lineTo(px, y);
    }
    x.lineTo(W, H);
    x.closePath();
    x.fill();
  };
  ridge(H * 0.44, 34, "#98a0ab", 1.7);
  ridge(H * 0.50, 44, "#7d8592", 4.2);
  ridge(H * 0.56, 52, "#636b79", 7.9);

  const water = x.createLinearGradient(0, H * 0.62, 0, H);
  water.addColorStop(0, "#8d9aa6");
  water.addColorStop(1, "#5a6470");
  x.fillStyle = water;
  x.fillRect(0, H * 0.62, W, H * 0.38);

  x.fillStyle = "rgba(255, 238, 200, 0.20)";
  for (let i = 0; i < 26; i++) {
    const yy = H * 0.63 + i * (H * 0.012);
    const ww = 200 - i * 5 + Math.sin(i * 2.7) * 30;
    x.fillRect(W * 0.68 - ww / 2, yy, ww, 3);
  }

  x.fillStyle = "#343a41";
  x.beginPath();
  x.moveTo(0, H);
  x.lineTo(0, H * 0.86);
  x.quadraticCurveTo(W * 0.12, H * 0.80, W * 0.26, H * 0.92);
  x.quadraticCurveTo(W * 0.33, H * 0.97, W * 0.42, H);
  x.closePath();
  x.fill();
  x.fillStyle = "#2b3036";
  x.beginPath();
  x.moveTo(W, H);
  x.lineTo(W, H * 0.90);
  x.quadraticCurveTo(W * 0.88, H * 0.86, W * 0.78, H * 0.95);
  x.quadraticCurveTo(W * 0.74, H * 0.98, W * 0.72, H);
  x.closePath();
  x.fill();

  x.fillStyle = "rgba(128, 128, 128, 0.24)";
  x.fillRect(0, 0, W, H);
  x.fillStyle = "rgba(88, 116, 168, 0.14)";
  x.fillRect(0, 0, W, H);

  x.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 2600; i++) {
    x.fillRect(Math.random() * W, Math.random() * H, 1, 1);
  }

  const id = x.getImageData(0, 0, W, H);
  return { data: id.data, width: W, height: H, meta: null };
}

/* ----------------------------- pieces ----------------------------- */

function fmtVal(key, v) {
  if (SLIDERS[key].ev) {
    const ev = (v / 100) * 1.8;
    return (ev > 0 ? "+" : "") + ev.toFixed(2) + " EV";
  }
  return (v > 0 ? "+" : "") + v;
}

function Slider({ k, value, onChange }) {
  const def = SLIDERS[k];
  return (
    <div className="sl-row">
      <div className="sl-head">
        <span className="sl-label">{def.label}</span>
        <button className="sl-value" title="Click to reset" onClick={() => onChange(k, 0)}>
          {fmtVal(k, value)}
        </button>
      </div>
      <input
        type="range"
        className={def.hue ? "hue" : undefined}
        min={def.min !== undefined ? def.min : -100}
        max={100}
        step={1}
        value={value}
        aria-label={def.label}
        onChange={(e) => onChange(k, Number(e.target.value))}
        onDoubleClick={() => onChange(k, 0)}
      />
      <div className="sl-hints">
        <span>{def.left}</span>
        <span>{def.right}</span>
      </div>
    </div>
  );
}

function Histogram({ hist, showToggle, showHelp }) {
  const [open, setOpen] = useState(false);
  const [logScale, setLogScale] = useState(true);
  if (!hist) return null;
  const useLog = showToggle ? logScale : true;
  const scaled = hist.bins.map((b) => (useLog ? Math.log1p(b) : b));
  const max = Math.max(1e-6, ...scaled);
  return (
    <div className="hist-wrap">
      <div className="hist-top">
        <span className="hist-title">Brightness of every pixel</span>
        <span className="hist-controls">
          {showToggle && (
            <span className="seg tiny">
              <button
                className={"seg-btn" + (logScale ? " on" : "")}
                title="Log scale keeps quiet tones visible next to a dominant peak"
                onClick={() => setLogScale(true)}
              >
                Log
              </button>
              <button
                className={"seg-btn" + (!logScale ? " on" : "")}
                title="Linear scale shows true pixel counts"
                onClick={() => setLogScale(false)}
              >
                Linear
              </button>
            </span>
          )}
          {showHelp && (
            <button className="hist-help" onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "What is this?"}
            </button>
          )}
        </span>
      </div>
      <div className="hist">
        {scaled.map((b, i) => (
          <div key={i} className="hist-bar" style={{ height: `${(b / max) * 100}%` }} />
        ))}
      </div>
      <div className="hist-foot">
        <span className={hist.lo > 2 ? "clip warn" : "clip"}>
          {hist.lo > 2 ? `◀ ${hist.lo.toFixed(0)}% blacks clipped` : "◀ darker pixels"}
        </span>
        <span className={hist.hi > 2 ? "clip warn" : "clip"}>
          {hist.hi > 2 ? `${hist.hi.toFixed(0)}% highlights clipped ▶` : "brighter pixels ▶"}
        </span>
      </div>
      {showHelp && open && (
        <div className="hist-explain">
          Every pixel in your photo gets sorted by brightness: the darkest stack up on the
          left, the brightest on the right. A tall pile pressed hard against the{" "}
          <strong>left wall</strong> means areas of solid black with no detail; against the{" "}
          <strong>right wall</strong>, blown-out white (that's "clipping" — the warnings
          below turn amber when it happens). There's no single correct shape — a night
          photo should lean left, a snow scene right. But a healthy edit usually ends with a
          hill spread across most of the width, reaching toward both edges without slamming
          into them.
        </div>
      )}
    </div>
  );
}

/* ------------------------------ app ------------------------------- */

export default function App() {
  const [adj, setAdj] = useState({ ...DEFAULTS });
  const [tab, setTab] = useState("guided");
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState(false);
  const [imgInfo, setImgInfo] = useState(null);
  const [split, setSplit] = useState(false);
  const [splitPos, setSplitPos] = useState(50);
  const [holding, setHolding] = useState(false);
  const [hist, setHist] = useState(null);
  const [srcVersion, setSrcVersion] = useState(0);
  const [err, setErr] = useState(null);
  const [busyMsg, setBusyMsg] = useState(null);
  const [progress, setProgress] = useState(null);
  const [meta, setMeta] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFmt, setExportFmt] = useState("jpg");
  const [exportSize, setExportSize] = useState("full");
  const [selBand, setSelBand] = useState("red");
  const [cropMode, setCropMode] = useState(false);
  const [cropDraft, setCropDraft] = useState({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [cropAngle, setCropAngle] = useState(0);
  const [cropApplied, setCropApplied] = useState(false);
  const [zoom, setZoom] = useState({ z: 1, tx: 0, ty: 0 });

  const glCanvasRef = useRef(null);
  const origCanvasRef = useRef(null);
  const pipeRef = useRef(null);
  const fullRef = useRef(null);      // working full-resolution RGBA (after crop)
  const originalRef = useRef(null);  // as-loaded full-resolution RGBA (never modified)
  const prevWorkingRef = useRef(null);
  const cropParamsRef = useRef(null);
  const previewRef = useRef(null);   // ImageData for the on-screen preview
  const adjRef = useRef(adj);
  const histTimer = useRef(null);
  const dragging = useRef(false);
  const wrapRef = useRef(null);
  const stageInnerRef = useRef(null);
  const zoomRef = useRef({ z: 1, tx: 0, ty: 0 });
  const cropModeRef = useRef(false);
  const fileNameRef = useRef("photo");

  adjRef.current = adj;
  zoomRef.current = zoom;
  cropModeRef.current = cropMode;

  const render = useCallback(() => {
    if (!pipeRef.current) return;
    pipeRef.current.render(adjRef.current, { flip: 1 });
  }, []);

  const scheduleHist = useCallback(() => {
    if (histTimer.current) clearTimeout(histTimer.current);
    histTimer.current = setTimeout(() => {
      const glc = glCanvasRef.current;
      if (!glc || !pipeRef.current) return;
      try {
        const s = document.createElement("canvas");
        s.width = 96;
        s.height = 64;
        const sx = s.getContext("2d");
        sx.drawImage(glc, 0, 0, 96, 64);
        const d = sx.getImageData(0, 0, 96, 64).data;
        const bins = new Array(48).fill(0);
        let lo = 0;
        let hi = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          bins[Math.min(47, Math.floor((lum / 256) * 48))]++;
          if (lum <= 3) lo++;
          if (lum >= 252) hi++;
        }
        setHist({ bins, lo: (lo / n) * 100, hi: (hi / n) * 100 });
      } catch (e) {
        /* histogram is optional */
      }
    }, 140);
  }, []);

  /* after canvases mount, wire up the preview */
  useEffect(() => {
    const preview = previewRef.current;
    const glc = glCanvasRef.current;
    const oc = origCanvasRef.current;
    if (!preview || !glc || !oc) return;
    try {
      glc.width = preview.width;
      glc.height = preview.height;
      oc.width = preview.width;
      oc.height = preview.height;
      oc.getContext("2d").putImageData(preview, 0, 0);

      if (!pipeRef.current) {
        pipeRef.current = createPipeline(glc);
        if (!pipeRef.current) {
          setErr(
            "Your browser blocked WebGL, which this editor needs for live processing. Check that hardware acceleration is enabled."
          );
          return;
        }
      }
      pipeRef.current.setSource(preview);
      render();
      scheduleHist();
    } catch (ex) {
      setErr("Setup failed: " + (ex && ex.message ? ex.message : String(ex)));
    }
  }, [srcVersion, render, scheduleHist]);

  useEffect(() => {
    if (!imgInfo) return;
    render();
    scheduleHist();
  }, [adj, imgInfo, render, scheduleHist]);

  const refreshWorking = useCallback((full) => {
    fullRef.current = full;
    const p = resizeRGBA(full.data, full.width, full.height, 1600);
    previewRef.current = new ImageData(
      p.data === full.data ? new Uint8ClampedArray(p.data) : p.data,
      p.width,
      p.height
    );
    setImgInfo({ w: full.width, h: full.height });
    setZoom({ z: 1, tx: 0, ty: 0 });
    setSrcVersion((v) => v + 1);
  }, []);

  const setSource = useCallback((full, name) => {
    originalRef.current = full;
    cropParamsRef.current = null;
    setCropApplied(false);
    setCropMode(false);
    setCropAngle(0);
    fileNameRef.current = (name || "photo").replace(/\.[^.]+$/, "");
    setMeta(full.meta || null);
    setAdj({ ...DEFAULTS });
    setStep(0);
    setFinished(false);
    refreshWorking(full);
  }, [refreshWorking]);

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    setBusyMsg(isRawFile(f.name) ? "Reading file…" : "Loading…");
    setProgress(null);
    try {
      const full = await loadFile(f, setBusyMsg);
      setSource(full, f.name);
    } catch (ex) {
      setErr(
        "Couldn't load that file: " +
          (ex && ex.message ? ex.message : String(ex))
      );
    }
    setBusyMsg(null);
  };

  const useSample = () => {
    setErr(null);
    try {
      setSource(makeSample(), "sample-landscape");
    } catch (ex) {
      setErr("Sample failed: " + (ex && ex.message ? ex.message : String(ex)));
    }
  };

  const change = (k, v) => setAdj((p) => ({ ...p, [k]: v }));
  const resetAll = () => setAdj({ ...DEFAULTS });
  const edited = Object.keys(adj).some((k) => adj[k] !== DEFAULTS[k]);

  /* ------------------------------ export ---------------------------- */

  const doExport = async () => {
    if (!fullRef.current) return;
    setExportOpen(false);
    setErr(null);
    setBusyMsg("Preparing export…");
    setProgress(0);
    try {
      const maxEdge =
        exportSize === "full" ? 0 : exportSize === "large" ? 3000 : 1600;
      const cv = await processFull(fullRef.current, adjRef.current, {
        maxEdge,
        onProgress: (p, label) => {
          setProgress(p);
          setBusyMsg(label || "Processing…");
        },
      });
      setBusyMsg("Encoding…");
      const type = exportFmt === "png" ? "image/png" : "image/jpeg";
      const blob = await canvasToBlob(cv, type, 0.92);
      downloadBlob(blob, `${fileNameRef.current}_edited.${exportFmt}`);
    } catch (ex) {
      setErr("Export failed: " + (ex && ex.message ? ex.message : String(ex)));
    }
    setBusyMsg(null);
    setProgress(null);
  };

  const saveEdits = () => {
    const blob = new Blob(
      [JSON.stringify(
        {
          app: "editcamp",
          version: 2,
          adjustments: adjRef.current,
          crop: cropParamsRef.current || null,
        },
        null,
        2
      )],
      { type: "application/json" }
    );
    downloadBlob(blob, `${fileNameRef.current}.editcamp.json`);
    setExportOpen(false);
  };

  const onLoadEdits = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed || !parsed.adjustments) throw new Error("Not an EditCamp edits file.");
      const next = { ...DEFAULTS };
      for (const k of Object.keys(next)) {
        const v = Number(parsed.adjustments[k]);
        if (Number.isFinite(v)) next[k] = Math.max(-100, Math.min(100, v));
      }
      setAdj(next);
      if (parsed.crop && parsed.crop.Pc && originalRef.current) {
        try {
          const cp = parsed.crop;
          const res = applyCrop(originalRef.current, cp.angleRad, cp.Pc, cp.cw, cp.ch);
          cropParamsRef.current = cp;
          setCropApplied(true);
          refreshWorking(res);
        } catch (ex) {
          /* crop from a different image; skip it */
        }
      }
      setExportOpen(false);
    } catch (ex) {
      setErr("Couldn't load edits: " + (ex && ex.message ? ex.message : String(ex)));
    }
  };

  /* ------------------------------ zoom ------------------------------ */

  const resetZoom = useCallback(() => setZoom({ z: 1, tx: 0, ty: 0 }), []);

  const zoomBy = useCallback((f) => {
    setZoom((zm) => {
      const nz = Math.max(1, Math.min(8, zm.z * f));
      if (nz <= 1.001) return { z: 1, tx: 0, ty: 0 };
      const r = nz / zm.z;
      return { z: nz, tx: zm.tx * r, ty: zm.ty * r };
    });
  }, []);

  /* scroll to zoom (native listener so we can preventDefault page scroll) */
  useEffect(() => {
    const el = stageInnerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (cropModeRef.current || !wrapRef.current) return;
      e.preventDefault();
      const rect = wrapRef.current.getBoundingClientRect();
      setZoom((zm) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nz = Math.max(1, Math.min(8, zm.z * factor));
        if (nz === zm.z) return zm;
        if (nz <= 1.001) return { z: 1, tx: 0, ty: 0 };
        const px = e.clientX - (rect.left + rect.width / 2) + zm.tx;
        const py = e.clientY - (rect.top + rect.height / 2) + zm.ty;
        return {
          z: nz,
          tx: px - (nz / zm.z) * (px - zm.tx),
          ty: py - (nz / zm.z) * (py - zm.ty),
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [imgInfo]);

  /* classic zoom key binds: + / - / 0 */
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (cropModeRef.current) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomBy(0.8);
      } else if (e.key === "0") {
        setZoom({ z: 1, tx: 0, ty: 0 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy]);

  /* drag to pan while zoomed */
  const startPan = (e) => {
    if (zoomRef.current.z <= 1 || cropModeRef.current) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const st = { ...zoomRef.current };
    const move = (ev) =>
      setZoom({ z: st.z, tx: st.tx + (ev.clientX - sx), ty: st.ty + (ev.clientY - sy) });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* ------------------------- crop & straighten ---------------------- */

  const startCrop = () => {
    if (!originalRef.current) return;
    setSplit(false);
    setErr(null);
    prevWorkingRef.current = fullRef.current;
    if (fullRef.current !== originalRef.current) {
      refreshWorking(originalRef.current); // crop always starts from the original
    }
    setCropDraft({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
    setCropAngle(0);
    setZoom({ z: 1, tx: 0, ty: 0 });
    setCropMode(true);
  };

  const cancelCrop = () => {
    if (prevWorkingRef.current && prevWorkingRef.current !== fullRef.current) {
      refreshWorking(prevWorkingRef.current);
    }
    setCropMode(false);
  };

  const resetCrop = () => {
    if (originalRef.current) refreshWorking(originalRef.current);
    cropParamsRef.current = null;
    setCropApplied(false);
    setCropMode(false);
  };

  const computeCropParams = () => {
    const wrap = wrapRef.current;
    const full = originalRef.current;
    if (!wrap || !full) return null;
    const r = wrap.getBoundingClientRect();
    const w = full.width;
    const h = full.height;
    const rad = (cropAngle * Math.PI) / 180;
    const ca = Math.abs(Math.cos(rad));
    const sa = Math.abs(Math.sin(rad));
    const rw = w * ca + h * sa;
    const rh = w * sa + h * ca;
    const ds = r.width / w; // screen px per source px, unrotated
    const k = Math.min(w / rw, h / rh); // fit-scale applied by the CSS transform
    const sScale = ds * k; // screen px per source px in the rotated view
    const cxs = (cropDraft.x + cropDraft.w / 2 - 0.5) * r.width;
    const cys = (cropDraft.y + cropDraft.h / 2 - 0.5) * r.height;
    return {
      angleRad: rad,
      Pc: { x: cxs / sScale, y: cys / sScale },
      cw: (cropDraft.w * r.width) / sScale,
      ch: (cropDraft.h * r.height) / sScale,
    };
  };

  const applyCropNow = () => {
    const params = computeCropParams();
    if (!params) return;
    setBusyMsg("Cropping…");
    setTimeout(() => {
      try {
        const res = applyCrop(originalRef.current, params.angleRad, params.Pc, params.cw, params.ch);
        cropParamsRef.current = params;
        setCropApplied(true);
        refreshWorking(res);
      } catch (ex) {
        setErr("Crop failed: " + (ex && ex.message ? ex.message : String(ex)));
      }
      setCropMode(false);
      setBusyMsg(null);
    }, 30);
  };

  const cropDragRef = useRef(null);
  const startCropDrag = (kind) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const startX = (e.touches ? e.touches[0].clientX : e.clientX);
    const startY = (e.touches ? e.touches[0].clientY : e.clientY);
    cropDragRef.current = { kind, startX, startY, rect: { ...cropDraft }, r };
    const move = (ev) => {
      const d = cropDragRef.current;
      if (!d) return;
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const cy = ev.touches ? ev.touches[0].clientY : ev.clientY;
      const dx = (cx - d.startX) / d.r.width;
      const dy = (cy - d.startY) / d.r.height;
      let { x, y, w, h } = d.rect;
      const MIN = 0.06;
      if (d.kind === "move") {
        x = Math.max(0, Math.min(1 - w, x + dx));
        y = Math.max(0, Math.min(1 - h, y + dy));
      } else {
        if (d.kind.includes("l")) {
          const nx = Math.max(0, Math.min(x + w - MIN, x + dx));
          w = w + (x - nx);
          x = nx;
        }
        if (d.kind.includes("r")) {
          w = Math.max(MIN, Math.min(1 - x, w + dx));
        }
        if (d.kind.includes("t")) {
          const ny = Math.max(0, Math.min(y + h - MIN, y + dy));
          h = h + (y - ny);
          y = ny;
        }
        if (d.kind.includes("b")) {
          h = Math.max(MIN, Math.min(1 - y, h + dy));
        }
      }
      setCropDraft({ x, y, w, h });
    };
    const up = () => {
      cropDragRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* split-handle dragging */
  const startDrag = (e) => {
    dragging.current = true;
    e.preventDefault();
    e.stopPropagation();
    const move = (ev) => {
      if (!dragging.current || !wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const cx = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const pct = Math.max(2, Math.min(98, ((cx - r.left) / r.width) * 100));
      setSplitPos(pct);
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const curStep = GUIDED_STEPS[step];
  const clipPath = cropMode
    ? "none"
    : holding
    ? "inset(0 0 0 100%)"
    : split
    ? `inset(0 0 0 ${splitPos}%)`
    : "none";

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="top">
        <div className="brand">
          <svg
            className="brand-logo"
            viewBox="0 0 20 20"
            width="20"
            height="20"
            aria-hidden="true"
          >
            <path
              d="M10 1.6 C 7.6 4.4, 5.6 6.4, 5.6 9.4 a4.4 4.4 0 0 0 8.8 0 C 14.4 6.4, 12.4 4.4, 10 1.6 Z"
              fill="#e8a33d"
            />
            <path
              d="M10 6.2 C 8.9 7.6, 7.9 8.6, 7.9 10.1 a2.1 2.1 0 0 0 4.2 0 C 12.1 8.6, 11.1 7.6, 10 6.2 Z"
              fill="#f6d08a"
            />
            <rect x="3" y="15.4" width="14" height="2" rx="1" fill="#7a5a3a" transform="rotate(9 10 16.4)" />
            <rect x="3" y="15.4" width="14" height="2" rx="1" fill="#5d452e" transform="rotate(-9 10 16.4)" />
          </svg>
          <span className="brand-name">EditCamp</span>
          <span className="brand-tag">RAW editing made easy</span>
        </div>
        {imgInfo && (
          <div className="top-actions">
            <div className="export-anchor">
              <button
                className={"btn small" + (exportOpen ? " active" : "")}
                onClick={() => setExportOpen((o) => !o)}
              >
                Export
              </button>
              {exportOpen && (
                <div className="export-panel">
                  <div className="ex-title">Export photo</div>
                  <div className="ex-row">
                    <span className="ex-label">Format</span>
                    <div className="seg">
                      {["jpg", "png"].map((f) => (
                        <button
                          key={f}
                          className={"seg-btn" + (exportFmt === f ? " on" : "")}
                          onClick={() => setExportFmt(f)}
                        >
                          {f.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="ex-row">
                    <span className="ex-label">Size</span>
                    <div className="seg">
                      {[
                        ["full", "Full"],
                        ["large", "3000px"],
                        ["small", "1600px"],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          className={"seg-btn" + (exportSize === v ? " on" : "")}
                          onClick={() => setExportSize(v)}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button className="btn primary wide" onClick={doExport}>
                    Export {exportFmt.toUpperCase()}
                  </button>
                  <div className="ex-divider" />
                  <div className="ex-note">
                    Your original file is never modified. Save your slider
                    settings as a small edits file and re-apply them later.
                  </div>
                  <div className="ex-pair">
                    <button className="btn small" onClick={saveEdits}>
                      Save edits
                    </button>
                    <label className="btn small" htmlFor="sf-edits" role="button" tabIndex={0}>
                      Load edits
                    </label>
                  </div>
                </div>
              )}
            </div>
            <label className="btn ghost small" htmlFor="sf-file" role="button" tabIndex={0}>
              Change photo
            </label>
            <button className="btn ghost small" onClick={resetAll} disabled={!edited}>
              Reset all
            </button>
          </div>
        )}
      </header>

      <input id="sf-file" type="file" accept={ACCEPT} onChange={onFile} className="vhide" />
      <input id="sf-edits" type="file" accept=".json,application/json" onChange={onLoadEdits} className="vhide" />

      {busyMsg && (
        <div className="busy-overlay">
          <div className="busy-card">
            <div className="busy-msg">{busyMsg}</div>
            {progress !== null && (
              <div className="busy-bar">
                <div className="busy-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        </div>
      )}

      {!imgInfo ? (
        <div className="empty">
          <div className="empty-card">
            <h1>Develop your first photo</h1>
            <p>
              Load a photo — including real camera RAW files — and EditCamp walks
              you through the editing loop that professionals use, one adjustment at a
              time, with a live before/after so you can see exactly what each move does.
            </p>
            <div className="empty-actions">
              <label className="btn primary" htmlFor="sf-file" role="button" tabIndex={0}>
                Upload a photo
              </label>
              <button className="btn" onClick={useSample}>
                Practice on the sample landscape
              </button>
            </div>
            {err && <div className="err-banner">{err}</div>}
            <p className="fine">
              Supported: Sony ARW, Canon CR2/CR3, Nikon NEF, Fuji RAF, DNG and most
              other camera RAW formats — plus regular JPG, PNG and WebP. Everything
              runs on your device; nothing is uploaded.
            </p>
          </div>
        </div>
      ) : (
        <div className="work">
          <div className="stage">
            {err && <div className="err-banner in-stage">{err}</div>}
            <div className="stage-tools">
              <button
                className={"btn small" + (split ? " active" : "")}
                aria-pressed={split}
                onClick={() => {
                  if (cropModeRef.current) cancelCrop();
                  setSplit((s) => !s);
                }}
              >
                Split view
              </button>
              <button
                className="btn small"
                onPointerDown={() => setHolding(true)}
                onPointerUp={() => setHolding(false)}
                onPointerLeave={() => setHolding(false)}
              >
                Hold to see original
              </button>
              <button
                className={"btn small" + (cropMode || cropApplied ? " active" : "")}
                onClick={() => (cropMode ? cancelCrop() : startCrop())}
              >
                {cropMode ? "Exit crop" : "Crop & straighten"}
              </button>
              <span className="meta-line">
                {formatMeta(meta)}
                {meta && imgInfo ? " · " : ""}
                {imgInfo ? `${imgInfo.w}×${imgInfo.h}` : ""}
              </span>
            </div>

            {cropMode && (
              <div className="crop-bar">
                <span className="crop-label">Straighten</span>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={0.5}
                  value={cropAngle}
                  aria-label="Straighten angle"
                  onChange={(e) => setCropAngle(Number(e.target.value))}
                />
                <button className="sl-value" onClick={() => setCropAngle(0)} title="Reset angle">
                  {cropAngle.toFixed(1)}°
                </button>
                <span className="crop-actions">
                  <button className="btn small" onClick={cancelCrop}>Cancel</button>
                  {cropApplied && (
                    <button className="btn small ghost" onClick={resetCrop}>
                      Remove crop
                    </button>
                  )}
                  <button className="btn small primary" onClick={applyCropNow}>Apply</button>
                </span>
              </div>
            )}

            <div className="stage-inner" ref={stageInnerRef}>
              <div
                className="canvas-wrap"
                ref={wrapRef}
                onPointerDown={startPan}
                style={
                  zoom.z > 1
                    ? {
                        transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.z})`,
                        cursor: "grab",
                      }
                    : undefined
                }
              >
                <div
                  className="rot-layer"
                  style={
                    cropMode && imgInfo
                      ? (() => {
                          const rad = (cropAngle * Math.PI) / 180;
                          const ca = Math.abs(Math.cos(rad));
                          const sa = Math.abs(Math.sin(rad));
                          const k = Math.min(
                            imgInfo.w / (imgInfo.w * ca + imgInfo.h * sa),
                            imgInfo.h / (imgInfo.w * sa + imgInfo.h * ca)
                          );
                          return { transform: `rotate(${cropAngle}deg) scale(${k})` };
                        })()
                      : undefined
                  }
                >
                  <canvas ref={origCanvasRef} className="canvas orig" />
                  <canvas ref={glCanvasRef} className="canvas edit" style={{ clipPath }} />
                </div>
                {cropMode && (
                  <div
                    className="crop-rect"
                    style={{
                      left: `${cropDraft.x * 100}%`,
                      top: `${cropDraft.y * 100}%`,
                      width: `${cropDraft.w * 100}%`,
                      height: `${cropDraft.h * 100}%`,
                    }}
                    onPointerDown={startCropDrag("move")}
                  >
                    <div className="ch tl" onPointerDown={startCropDrag("tl")} />
                    <div className="ch tr" onPointerDown={startCropDrag("tr")} />
                    <div className="ch bl" onPointerDown={startCropDrag("bl")} />
                    <div className="ch br" onPointerDown={startCropDrag("br")} />
                    <div className="crop-thirds v1" />
                    <div className="crop-thirds v2" />
                    <div className="crop-thirds h1" />
                    <div className="crop-thirds h2" />
                  </div>
                )}
                {split && !holding && !cropMode && (
                  <>
                    <div
                      className="split-handle"
                      style={{ left: `${splitPos}%` }}
                      onPointerDown={startDrag}
                      role="slider"
                      aria-label="Before/after divider"
                      aria-valuenow={Math.round(splitPos)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft") setSplitPos((p) => Math.max(2, p - 3));
                        if (e.key === "ArrowRight") setSplitPos((p) => Math.min(98, p + 3));
                      }}
                    >
                      <div className="split-grip">{"↔"}</div>
                    </div>
                    <span className="chip chip-l">Before</span>
                    <span className="chip chip-r">After</span>
                  </>
                )}
                {holding && <span className="chip chip-l">Original</span>}
              </div>
              {zoom.z > 1 && (
                <button className="zoom-chip" onClick={resetZoom}>
                  {Math.round(zoom.z * 100)}% · Reset
                </button>
              )}
            </div>
          </div>

          <aside className="panel">
            <div className="tabs" role="tablist">
              <button
                role="tab"
                aria-selected={tab === "guided"}
                className={"tab" + (tab === "guided" ? " on" : "")}
                onClick={() => setTab("guided")}
              >
                Guided
              </button>
              <button
                role="tab"
                aria-selected={tab === "advanced"}
                className={"tab" + (tab === "advanced" ? " on" : "")}
                onClick={() => setTab("advanced")}
              >
                Advanced
              </button>
            </div>

            <Histogram hist={hist} showToggle={tab === "advanced"} showHelp={tab === "guided"} />

            {tab === "guided" ? (
              finished ? (
                <div className="step-card">
                  <div className="eyebrow">Done</div>
                  <h2>Compare your work</h2>
                  <p className="why">
                    Turn on <strong>Split view</strong> and drag the divider across the
                    photo, or hold the original button. If the "after" side reads clearly
                    better — you just developed a photo.
                  </p>
                  <div className="exbox">
                    <span className="tip-label ex">Check the graph</span>
                    A finished edit usually shows a hill spanning most of the width — a
                    little of everything from near-black to near-white — without tall
                    piles jammed against either wall, and no amber clipping warnings. The
                    graph describes your photo, it doesn't grade it: a night shot should
                    still lean left, a snow scene should lean right.
                  </div>
                  <div className="tipbox">
                    Happy with it? Hit <strong>Export</strong> in the top bar to save a
                    full-resolution JPG. That five-step loop — white balance, exposure,
                    recovery, contrast, color — is the same one used in Lightroom,
                    Capture One and Darktable.
                  </div>
                  <div className="nav">
                    <button
                      className="btn"
                      onClick={() => {
                        setFinished(false);
                        setStep(0);
                      }}
                    >
                      Review steps
                    </button>
                    <button className="btn primary" onClick={() => setTab("advanced")}>
                      Fine-tune in Advanced
                    </button>
                  </div>
                </div>
              ) : (
                <div className="step-card">
                  <div className="progress">
                    {GUIDED_STEPS.map((s, i) => (
                      <button
                        key={s.key}
                        className={"dot" + (i === step ? " cur" : "") + (i < step ? " done" : "")}
                        aria-label={`Step ${i + 1}: ${s.title}`}
                        onClick={() => setStep(i)}
                      />
                    ))}
                  </div>
                  <div className="eyebrow">
                    Step {step + 1} of {GUIDED_STEPS.length}
                  </div>
                  <h2>{curStep.title}</h2>
                  <p className="why">{curStep.why}</p>
                  <div className="exbox">
                    <span className="tip-label ex">Picture this</span>
                    {curStep.example}
                  </div>
                  <div className="tipbox">
                    <span className="tip-label">What to do</span>
                    {curStep.look}
                  </div>
                  <div className="histnote">
                    <span className="histnote-label">On the graph:</span> {curStep.hist}
                  </div>

                  <div className="step-sliders">
                    {curStep.sliders.map((k) => (
                      <Slider key={k} k={k} value={adj[k]} onChange={change} />
                    ))}
                  </div>

                  <div className="range-chip">{curStep.range}</div>

                  <div className="nav">
                    <button className="btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                      Back
                    </button>
                    <button
                      className="btn primary"
                      onClick={() =>
                        step === GUIDED_STEPS.length - 1 ? setFinished(true) : setStep((s) => s + 1)
                      }
                    >
                      {step === GUIDED_STEPS.length - 1 ? "Finish" : "Next"}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="adv">
                <div className="group">
                  <div className="group-title">White balance</div>
                  {["temperature", "tint"].map((k) => (
                    <Slider key={k} k={k} value={adj[k]} onChange={change} />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Light</div>
                  {["exposure", "contrast", "highlights", "shadows", "whites", "blacks"].map((k) => (
                    <Slider key={k} k={k} value={adj[k]} onChange={change} />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Color</div>
                  {["vibrance", "saturation"].map((k) => (
                    <Slider key={k} k={k} value={adj[k]} onChange={change} />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Color mixer</div>
                  <div className="band-chips">
                    {MIX_BANDS.map(([band, , hex]) => (
                      <button
                        key={band}
                        className={"band-chip" + (selBand === band ? " on" : "")}
                        style={{ background: hex }}
                        aria-label={band}
                        title={band}
                        onClick={() => setSelBand(band)}
                      />
                    ))}
                  </div>
                  {["h", "s", "l"].map((c) => (
                    <Slider
                      key={`mix_${selBand}_${c}`}
                      k={`mix_${selBand}_${c}`}
                      value={adj[`mix_${selBand}_${c}`]}
                      onChange={change}
                    />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Split toning</div>
                  {["st_sh_hue", "st_sh_amt", "st_hi_hue", "st_hi_amt"].map((k) => (
                    <Slider key={k} k={k} value={adj[k]} onChange={change} />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Effects</div>
                  {["clarity", "dehaze", "vignette"].map((k) => (
                    <Slider key={k} k={k} value={adj[k]} onChange={change} />
                  ))}
                </div>
                <div className="group">
                  <div className="group-title">Detail</div>
                  <Slider k="sharpen" value={adj.sharpen} onChange={change} />
                  <Slider k="noise" value={adj.noise} onChange={change} />
                </div>
                <button className="btn ghost wide" onClick={resetAll} disabled={!edited}>
                  Reset all adjustments
                </button>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- CSS ------------------------------ */

const CSS = `
:root {
  --bg: #17181a;
  --stage: #101112;
  --panel: #1f2023;
  --panel-2: #26272b;
  --line: #33353b;
  --text: #ecebe5;
  --muted: #93928b;
  --amber: #e8a33d;
  --amber-soft: rgba(232, 163, 61, 0.14);
}

* { box-sizing: border-box; }

.app {
  height: 100vh;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: 'Space Grotesk', system-ui, sans-serif;
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  gap: 12px;
  flex-wrap: wrap;
}
.brand { display: flex; align-items: baseline; gap: 10px; }
.brand-logo {
  align-self: center;
  filter: drop-shadow(0 0 8px rgba(232,163,61,0.55));
  flex-shrink: 0;
}
.brand-name {
  font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  font-size: 15px;
}
.brand-tag { color: var(--muted); font-size: 12.5px; }
.top-actions { display: flex; gap: 8px; align-items: center; }

.btn {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 15px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.btn:hover:not(:disabled) { border-color: var(--amber); }
.btn:disabled { opacity: 0.4; cursor: default; }
.btn.primary {
  background: var(--amber);
  border-color: var(--amber);
  color: #1a1408;
  font-weight: 600;
}
.btn.primary:hover:not(:disabled) { background: #f0b155; }
.btn.ghost { background: transparent; }
.btn.small { padding: 7px 12px; font-size: 12.5px; }
.btn.small.active, .btn.active {
  background: var(--amber-soft);
  border-color: var(--amber);
  color: var(--amber);
}
.btn.wide { width: 100%; margin-top: 4px; }
label.btn { display: inline-flex; align-items: center; justify-content: center; user-select: none; }
.vhide {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap; border: 0;
}
.btn:focus-visible, .tab:focus-visible, .dot:focus-visible, .seg-btn:focus-visible,
input[type=range]:focus-visible, .sl-value:focus-visible, .split-handle:focus-visible,
.hist-help:focus-visible {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}

.err-banner {
  background: rgba(200, 74, 58, 0.15);
  border: 1px solid rgba(200, 74, 58, 0.5);
  color: #f0b3a8;
  border-radius: 9px;
  padding: 11px 14px;
  font-size: 13px;
  line-height: 1.5;
  margin: 14px 0;
  text-align: left;
}
.err-banner.in-stage { margin: 12px 16px 0; }

.busy-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(10, 10, 12, 0.72);
  display: flex; align-items: center; justify-content: center;
}
.busy-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 22px 28px;
  min-width: 260px;
  text-align: center;
}
.busy-msg { font-size: 14px; margin-bottom: 12px; }
.busy-bar {
  height: 6px; border-radius: 3px;
  background: var(--stage);
  overflow: hidden;
}
.busy-fill { height: 100%; background: var(--amber); transition: width 0.15s; }

.export-anchor { position: relative; }
.export-panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 40;
  width: 270px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}
.ex-title { font-weight: 600; font-size: 14px; margin-bottom: 12px; }
.ex-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.ex-label { font-size: 12.5px; color: var(--muted); }
.seg { display: flex; gap: 4px; background: var(--stage); border-radius: 8px; padding: 3px; }
.seg-btn {
  font-family: inherit; font-size: 12px; font-weight: 600;
  padding: 5px 10px; border: none; border-radius: 6px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.seg-btn.on { background: var(--panel-2); color: var(--amber); }
.seg.tiny { padding: 2px; }
.seg.tiny .seg-btn { padding: 3px 8px; font-size: 10.5px; }
.hist-controls { display: inline-flex; align-items: center; gap: 8px; }
.group-note {
  font-size: 11.5px; color: var(--muted); line-height: 1.5;
  margin-top: -4px;
}
.ex-divider { height: 1px; background: var(--line); margin: 14px 0 10px; }
.ex-note { font-size: 11.5px; color: var(--muted); line-height: 1.45; margin-bottom: 10px; }
.ex-pair { display: flex; gap: 8px; }
.ex-pair .btn { flex: 1; }

.empty { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; }
.empty-card { max-width: 540px; text-align: center; }
.empty-card h1 { font-size: 28px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.01em; }
.empty-card p { color: var(--muted); line-height: 1.55; margin: 0 0 22px; font-size: 15px; }
.empty-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px; }
.fine { font-size: 12.5px !important; opacity: 0.8; }

.work { flex: 1; display: flex; min-height: 0; }
.stage {
  flex: 1;
  background: var(--stage);
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.stage-tools { display: flex; gap: 8px; padding: 12px 16px 0; align-items: center; flex-wrap: wrap; }
.meta-line {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; color: var(--muted);
  margin-left: auto;
}
.stage-inner {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 0;
  position: relative;
  overflow: hidden;
}
.zoom-chip {
  position: absolute; right: 14px; bottom: 14px; z-index: 10;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px;
  color: var(--text);
  background: rgba(0,0,0,0.65);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 6px 10px;
  cursor: pointer;
}
.zoom-chip:hover { border-color: var(--amber); }
.canvas-wrap { position: relative; display: inline-block; line-height: 0; }
.canvas {
  max-width: 100%;
  max-height: calc(100vh - 190px);
  width: auto;
  height: auto;
  border-radius: 6px;
}
.canvas.orig { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; }
.canvas.edit { position: relative; z-index: 1; }

.split-handle {
  position: absolute; top: 0; bottom: 0; z-index: 2;
  width: 2px; background: rgba(255,255,255,0.9);
  cursor: ew-resize; touch-action: none;
  transform: translateX(-1px);
}
.split-grip {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 34px; height: 34px; border-radius: 50%;
  background: var(--amber); color: #1a1408;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 700;
  box-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.chip {
  position: absolute; top: 10px; z-index: 3;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  background: rgba(0,0,0,0.6); color: #fff;
  padding: 4px 9px; border-radius: 5px;
}
.chip-l { left: 10px; }
.chip-r { right: 10px; }

.panel {
  width: 360px;
  border-left: 1px solid var(--line);
  background: var(--panel);
  padding: 16px;
  overflow-y: auto;
}
.tabs {
  display: flex; gap: 6px;
  background: var(--stage);
  border-radius: 10px; padding: 4px;
  margin-bottom: 14px;
}
.tab {
  flex: 1;
  font-family: inherit; font-size: 13.5px; font-weight: 600;
  padding: 8px; border: none; border-radius: 7px;
  background: transparent; color: var(--muted); cursor: pointer;
}
.tab.on { background: var(--panel-2); color: var(--amber); }

.hist-wrap { margin-bottom: 16px; }
.hist-top {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 6px;
}
.hist-title {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
}
.hist-help {
  font-family: inherit; font-size: 12px; font-weight: 500;
  color: var(--amber); background: none; border: none;
  cursor: pointer; padding: 0;
  text-decoration: underline; text-underline-offset: 3px;
}
.hist-explain {
  margin-top: 8px;
  background: var(--stage);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 11px 13px;
  font-size: 12.5px; line-height: 1.55;
  color: var(--text);
}
.hist-explain strong { color: var(--amber); font-weight: 600; }
.hist {
  height: 56px;
  display: flex; align-items: flex-end; gap: 1px;
  background: var(--stage);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px;
}
.hist-bar { flex: 1; background: #6b6a63; border-radius: 1px; min-height: 1px; }
.hist-foot {
  display: flex; justify-content: space-between;
  margin-top: 5px;
  font-family: 'IBM Plex Mono', monospace; font-size: 10.5px;
}
.clip { color: var(--muted); }
.clip.warn { color: var(--amber); }

.step-card { display: flex; flex-direction: column; }
.progress { display: flex; gap: 7px; margin-bottom: 14px; }
.dot {
  width: 26px; height: 5px; border-radius: 3px;
  border: none; cursor: pointer;
  background: var(--line);
  transition: background 0.2s;
  padding: 0;
}
.dot.done { background: rgba(232,163,61,0.45); }
.dot.cur { background: var(--amber); }
.eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--amber); margin-bottom: 6px;
}
.step-card h2 { margin: 0 0 10px; font-size: 21px; font-weight: 700; }
.why { color: var(--muted); font-size: 13.5px; line-height: 1.55; margin: 0 0 12px; }
.tipbox {
  background: var(--amber-soft);
  border: 1px solid rgba(232,163,61,0.3);
  border-radius: 9px;
  padding: 11px 13px;
  font-size: 13px; line-height: 1.5;
  margin-bottom: 12px;
}
.exbox {
  background: var(--stage);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 11px 13px;
  font-size: 13px; line-height: 1.55;
  color: var(--text);
  margin-bottom: 12px;
}
.tip-label {
  display: block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--amber); margin-bottom: 4px;
}
.tip-label.ex { color: var(--muted); }
.histnote {
  font-size: 12.5px; line-height: 1.5;
  color: var(--muted);
  margin-bottom: 16px;
  padding-left: 10px;
  border-left: 2px solid var(--line);
}
.histnote-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--amber);
}
.step-sliders { margin-bottom: 8px; }
.range-chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11.5px; color: var(--muted);
  margin-bottom: 16px;
}
.nav { display: flex; gap: 8px; }
.nav .btn { flex: 1; }

.sl-row { margin-bottom: 14px; }
.sl-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.sl-label { font-size: 13px; font-weight: 500; }
.sl-value {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px; color: var(--amber);
  background: none; border: none; cursor: pointer; padding: 0 2px;
}
input[type=range] {
  width: 100%; height: 22px;
  -webkit-appearance: none; appearance: none;
  background: transparent; cursor: pointer; margin: 0;
}
input[type=range]::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px; background: var(--line);
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 15px; height: 15px; border-radius: 50%;
  background: var(--amber);
  margin-top: -5.5px;
  border: 2px solid #17181a;
}
input[type=range]::-moz-range-track {
  height: 4px; border-radius: 2px; background: var(--line);
}
input[type=range]::-moz-range-thumb {
  width: 13px; height: 13px; border-radius: 50%;
  background: var(--amber); border: 2px solid #17181a;
}
.sl-hints {
  display: flex; justify-content: space-between;
  font-size: 10.5px; color: var(--muted);
  font-family: 'IBM Plex Mono', monospace;
  margin-top: -2px;
}

.group { margin-bottom: 18px; }
.group-title {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px; margin-bottom: 12px;
}

.rot-layer { transform-origin: center center; line-height: 0; }

.crop-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px 0;
  flex-wrap: wrap;
}
.crop-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--muted);
}
.crop-bar input[type=range] { width: 180px; }
.crop-actions { display: flex; gap: 8px; margin-left: auto; }

.crop-rect {
  position: absolute; z-index: 5;
  border: 1.5px solid rgba(255,255,255,0.95);
  box-shadow: 0 0 0 9999px rgba(0,0,0,0.55);
  cursor: move; touch-action: none;
}
.ch {
  position: absolute; width: 18px; height: 18px;
  background: var(--amber);
  border: 2px solid #17181a;
  border-radius: 4px;
  touch-action: none;
}
.ch.tl { left: -9px; top: -9px; cursor: nwse-resize; }
.ch.tr { right: -9px; top: -9px; cursor: nesw-resize; }
.ch.bl { left: -9px; bottom: -9px; cursor: nesw-resize; }
.ch.br { right: -9px; bottom: -9px; cursor: nwse-resize; }
.crop-thirds { position: absolute; background: rgba(255,255,255,0.25); pointer-events: none; }
.crop-thirds.v1 { left: 33.33%; top: 0; bottom: 0; width: 1px; }
.crop-thirds.v2 { left: 66.66%; top: 0; bottom: 0; width: 1px; }
.crop-thirds.h1 { top: 33.33%; left: 0; right: 0; height: 1px; }
.crop-thirds.h2 { top: 66.66%; left: 0; right: 0; height: 1px; }

.band-chips { display: flex; gap: 7px; margin-bottom: 12px; }
.band-chip {
  width: 24px; height: 24px; border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer; padding: 0;
  opacity: 0.55;
  transition: opacity 0.15s, border-color 0.15s;
}
.band-chip.on { opacity: 1; border-color: #fff; }
.band-chip:hover { opacity: 0.85; }

input.hue::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}
input.hue::-webkit-slider-thumb { margin-top: -4.5px; }
input.hue::-moz-range-track {
  height: 6px; border-radius: 3px;
  background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
}

@media (max-width: 900px) {
  .app { height: auto; min-height: 100vh; overflow: visible; }
  .work { flex-direction: column; }
  .panel { width: 100%; border-left: none; border-top: 1px solid var(--line); overflow-y: visible; }
  .canvas { max-height: 48vh; }
  .export-panel { right: auto; left: 0; }
}

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
`;
