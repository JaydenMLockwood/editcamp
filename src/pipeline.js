/* WebGL processing pipeline shared by the live preview and full-res export. */

export const MIX_BANDS = [
  ["red", 0, "#e05c4f"],
  ["orange", 30, "#e0954f"],
  ["yellow", 60, "#ddc94e"],
  ["green", 120, "#6fbf5a"],
  ["aqua", 180, "#54c2c2"],
  ["blue", 220, "#5a7fd6"],
  ["purple", 275, "#9a6ad6"],
  ["magenta", 315, "#d66ab5"],
];

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
uniform float u_flip;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos.x, a_pos.y * u_flip, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_frameA; /* tile size as fraction of full frame */
uniform vec2 u_frameB; /* tile offset as fraction of full frame */
uniform float u_temp, u_tint, u_exp, u_con, u_hi, u_sh, u_wh, u_bl, u_sat, u_vib;
uniform float u_nr, u_shp, u_cl, u_dz, u_vig, u_txt, u_grn;
uniform float u_ssh, u_ssa, u_shh, u_sha;
uniform float u_mixC[8];
uniform float u_mixH[8];
uniform float u_mixS[8];
uniform float u_mixL[8];
uniform int u_mCount;
uniform float u_mType[6]; /* 0 radial, 1 linear */
uniform vec4 u_mA[6];     /* radial: cx,cy,rx,ry  linear: x0,y0,x1,y1 */
uniform vec4 u_mB[6];     /* feather, invert, lumLo, lumHi */
uniform vec4 u_mAdj[6];   /* exposure, contrast, temperature, saturation */
uniform vec4 u_mCol[6];   /* target colour rgb + enabled flag */
uniform float u_mRng[6];  /* colour match looseness */

const vec3 LUMW = vec3(0.299, 0.587, 0.114);

/* Contrast with a filmic-style toe and shoulder: same midtone slope as a
   linear pivot, but the curve approaches 0 and 1 asymptotically, so no
   amount of positive contrast can push pixels past either wall. Negative
   (flattening) contrast stays linear since it cannot clip. */
vec3 applyContrast(vec3 x, float k) {
  vec3 d = x - 0.5;
  if (k > 0.0) {
    return 0.5 + d * (1.0 + k) / (1.0 + 2.0 * k * abs(d));
  }
  return 0.5 + d * (1.0 + k);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/* Edge-preserving smoothing (bilateral filter). */
vec3 denoised(vec2 uv) {
  vec3 center = texture2D(u_tex, uv).rgb;
  if (u_nr < 0.004) return center;
  float sigma = 0.06 + 0.14 * u_nr;
  float inv2s2 = 1.0 / (2.0 * sigma * sigma);
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec3 s = texture2D(u_tex, uv + vec2(float(x), float(y)) * u_texel).rgb;
      vec3 d = s - center;
      float w = exp(-dot(d, d) * inv2s2) * exp(-float(x * x + y * y) * 0.125);
      sum += s * w;
      wsum += w;
    }
  }
  return mix(center, sum / wsum, min(1.0, u_nr * 1.3));
}

/* 3x3 gaussian at a given sample spacing. */
vec3 gauss3(vec2 uv, vec2 off) {
  vec3 acc = vec3(0.0);
  acc += texture2D(u_tex, uv + vec2(-1.0, -1.0) * off).rgb * 1.0;
  acc += texture2D(u_tex, uv + vec2( 0.0, -1.0) * off).rgb * 2.0;
  acc += texture2D(u_tex, uv + vec2( 1.0, -1.0) * off).rgb * 1.0;
  acc += texture2D(u_tex, uv + vec2(-1.0,  0.0) * off).rgb * 2.0;
  acc += texture2D(u_tex, uv).rgb * 4.0;
  acc += texture2D(u_tex, uv + vec2( 1.0,  0.0) * off).rgb * 2.0;
  acc += texture2D(u_tex, uv + vec2(-1.0,  1.0) * off).rgb * 1.0;
  acc += texture2D(u_tex, uv + vec2( 0.0,  1.0) * off).rgb * 2.0;
  acc += texture2D(u_tex, uv + vec2( 1.0,  1.0) * off).rgb * 1.0;
  return acc / 16.0;
}

void main() {
  vec3 c = denoised(v_uv);

  /* unsharp mask */
  if (u_shp > 0.004) {
    vec3 ctr = texture2D(u_tex, v_uv).rgb;
    c += u_shp * 0.9 * (ctr - gauss3(v_uv, u_texel));
  }

  /* white balance */
  c.r += u_temp * 0.12;
  c.b -= u_temp * 0.12;
  /* Lightroom convention: positive tint = magenta (less green) */
  c.g -= u_tint * 0.10;

  /* exposure (stops) */
  c *= pow(2.0, u_exp);

  /* dehaze: push the veil of flat gray out of (or into) the image */
  if (abs(u_dz) > 0.004) {
    float dzc = 0.22 * u_dz;
    c = (c - dzc) / (1.0 - dzc);
    float ld = dot(clamp(c, 0.0, 1.0), LUMW);
    c = mix(vec3(ld), c, 1.0 + 0.25 * u_dz);
  }

  /* luminance-masked recovery. The shadow lift is a black-anchored curve:
     multiplicative gain that falls to zero at pure black, so opening shadows
     brightens the low-mids without lifting the black point (an additive lift
     raises true blacks too, which reads as milky wash). */
  float lum = dot(clamp(c, 0.0, 1.0), LUMW);
  c += u_hi * 0.35 * smoothstep(0.62, 1.0, lum);
  float sMask = smoothstep(0.0, 0.06, lum) * (1.0 - smoothstep(0.22, 0.5, lum));
  c *= 1.0 + u_sh * 0.9 * sMask;
  c += u_wh * 0.18 * smoothstep(0.70, 1.0, lum);
  c += u_bl * 0.18 * (1.0 - smoothstep(0.0, 0.30, lum));

  /* clarity: midtone local contrast at a frame-relative radius */
  if (abs(u_cl) > 0.004) {
    vec2 co = vec2(0.005) / u_frameA;
    float ol = dot(texture2D(u_tex, v_uv).rgb, LUMW);
    float bl = dot(gauss3(v_uv, co), LUMW);
    float det = ol - bl;
    float lc = dot(clamp(c, 0.0, 1.0), LUMW);
    float midW = 1.0 - min(1.0, abs(lc - 0.5) * 1.6);
    c += u_cl * 1.2 * det * (0.25 + 0.75 * midW);
  }

  /* texture: mid-size detail, smaller radius than clarity */
  if (abs(u_txt) > 0.004) {
    vec2 co2 = vec2(0.0015) / u_frameA;
    float ot = dot(texture2D(u_tex, v_uv).rgb, LUMW);
    float bt = dot(gauss3(v_uv, co2), LUMW);
    c += u_txt * 1.5 * (ot - bt);
  }

  /* contrast around mid gray (clip-safe sigmoid) */
  c = applyContrast(c, u_con * 0.8);

  /* saturation + vibrance */
  float l2 = dot(clamp(c, 0.0, 1.0), LUMW);
  vec3 g = vec3(l2);
  c = mix(g, c, 1.0 + u_sat);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float s = mx - mn;
  c = mix(g, c, 1.0 + u_vib * max(0.0, 1.0 - s * 1.5));

  /* per-colour mixer (HSL bands) */
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float hShift = 0.0;
  float sMul = 0.0;
  float lMul = 0.0;
  float grayGuard = smoothstep(0.04, 0.22, hsv.y);
  for (int i = 0; i < 8; i++) {
    float d = abs(hsv.x - u_mixC[i]);
    d = min(d, 1.0 - d);
    float w = exp(-d * d / 0.009) * grayGuard;
    hShift += w * u_mixH[i] * 0.083;
    sMul += w * u_mixS[i];
    lMul += w * u_mixL[i];
  }
  hsv.x = fract(hsv.x + hShift + 1.0);
  hsv.y = clamp(hsv.y * (1.0 + sMul), 0.0, 1.0);
  c = hsv2rgb(hsv);
  c *= 1.0 + lMul * 0.5;

  /* local adjustment masks (frame coordinates, so tiled export matches) */
  vec2 gFrame = v_uv * u_frameA + u_frameB;
  float baseLum = dot(clamp(c, 0.0, 1.0), LUMW);
  for (int i = 0; i < 6; i++) {
    if (i >= u_mCount) break;
    vec4 A = u_mA[i];
    vec4 B = u_mB[i];
    float w;
    if (u_mType[i] < 0.5) {
      /* radial: soft-edged ellipse */
      vec2 d = (gFrame - A.xy) / max(A.zw, vec2(1.0e-4));
      float r = length(d);
      float f = clamp(B.x, 0.02, 0.98);
      w = 1.0 - smoothstep(1.0 - f, 1.0, r);
    } else {
      /* linear: full strength at start point, fading to none at end point */
      vec2 dir = A.zw - A.xy;
      float t = dot(gFrame - A.xy, dir) / max(dot(dir, dir), 1.0e-6);
      w = 1.0 - smoothstep(0.0, 1.0, t);
    }
    if (B.y > 0.5) w = 1.0 - w;
    /* luminance range limits */
    float lo = B.z;
    float hi = B.w;
    float loT = mix(smoothstep(lo - 0.08, lo + 0.04, baseLum), 1.0, step(lo, 0.002));
    float hiT = mix(1.0 - smoothstep(hi - 0.04, hi + 0.08, baseLum), 1.0, step(0.998, hi));
    w *= loT * hiT;
    /* colour range: only affect pixels similar to the picked colour */
    if (u_mCol[i].w > 0.5) {
      vec3 srcc = texture2D(u_tex, v_uv).rgb;
      float cd = distance(srcc, u_mCol[i].rgb);
      float rng = max(u_mRng[i], 0.02) * 0.6;
      w *= 1.0 - smoothstep(rng * 0.7, rng * 1.5, cd);
    }
    if (w > 0.001) {
      c *= pow(2.0, u_mAdj[i].x * 1.8 * w);
      c = applyContrast(c, u_mAdj[i].y * 0.8 * w);
      c.r += u_mAdj[i].z * 0.12 * w;
      c.b -= u_mAdj[i].z * 0.12 * w;
      float lmm = dot(clamp(c, 0.0, 1.0), LUMW);
      c = mix(vec3(lmm), c, 1.0 + u_mAdj[i].w * w);
    }
  }

  /* split toning */
  if (u_ssa > 0.004 || u_sha > 0.004) {
    float lt = dot(clamp(c, 0.0, 1.0), LUMW);
    vec3 shC = hsv2rgb(vec3(u_ssh, 1.0, 1.0));
    vec3 hiC = hsv2rgb(vec3(u_shh, 1.0, 1.0));
    c += (shC - 0.5) * (u_ssa * 0.35) * (1.0 - smoothstep(0.15, 0.6, lt));
    c += (hiC - 0.5) * (u_sha * 0.35) * smoothstep(0.4, 0.9, lt);
  }

  /* vignette: computed in FULL-FRAME coordinates so tiled export matches */
  if (abs(u_vig) > 0.004) {
    float vd = distance(gFrame, vec2(0.5)) * 1.4142;
    c *= 1.0 + u_vig * 0.85 * smoothstep(0.45, 1.05, vd);
  }

  /* film grain: lattice noise in frame coordinates so export matches preview */
  if (u_grn > 0.004) {
    float n = fract(sin(dot(floor(gFrame * 1400.0), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    float lg = dot(clamp(c, 0.0, 1.0), LUMW);
    c += n * u_grn * 0.22 * (0.3 + 0.7 * max(0.0, 1.0 - abs(lg - 0.5) * 1.7));
  }

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
  }
  return sh;
}

const SCALARS = [
  "u_temp", "u_tint", "u_exp", "u_con", "u_hi", "u_sh", "u_wh", "u_bl",
  "u_sat", "u_vib", "u_nr", "u_shp", "u_cl", "u_dz", "u_vig", "u_txt", "u_grn",
  "u_ssh", "u_ssa", "u_shh", "u_sha",
];

/* Slider values (-100..100) -> shader uniform values */
export function toUniforms(adj) {
  return {
    u_temp: adj.temperature / 100,
    u_tint: adj.tint / 100,
    u_exp: (adj.exposure / 100) * 1.8,
    u_con: adj.contrast / 100,
    u_hi: adj.highlights / 100,
    u_sh: adj.shadows / 100,
    u_wh: adj.whites / 100,
    u_bl: adj.blacks / 100,
    u_sat: adj.saturation / 100,
    u_vib: adj.vibrance / 100,
    u_nr: (adj.noise || 0) / 100,
    u_shp: (adj.sharpen || 0) / 100,
    u_cl: (adj.clarity || 0) / 100,
    u_dz: (adj.dehaze || 0) / 100,
    u_vig: (adj.vignette || 0) / 100,
    u_txt: (adj.texture || 0) / 100,
    u_grn: (adj.grain || 0) / 100,
    u_ssh: (adj.st_sh_hue || 0) / 100,
    u_ssa: (adj.st_sh_amt || 0) / 100,
    u_shh: (adj.st_hi_hue || 0) / 100,
    u_sha: (adj.st_hi_amt || 0) / 100,
  };
}

function mixArrays(adj) {
  const h = new Float32Array(8);
  const s = new Float32Array(8);
  const l = new Float32Array(8);
  MIX_BANDS.forEach(([band], i) => {
    h[i] = (adj[`mix_${band}_h`] || 0) / 100;
    s[i] = (adj[`mix_${band}_s`] || 0) / 100;
    l[i] = (adj[`mix_${band}_l`] || 0) / 100;
  });
  return { h, s, l };
}

export function createPipeline(canvas) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true });
  if (!gl) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
  }
  gl.useProgram(prog);

  const verts = new Float32Array([
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
    -1,  1, 0, 0,
     1, -1, 1, 1,
     1,  1, 1, 0,
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  const aUv = gl.getAttribLocation(prog, "a_uv");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniforms = {
    u_flip: gl.getUniformLocation(prog, "u_flip"),
    u_texel: gl.getUniformLocation(prog, "u_texel"),
    u_frameA: gl.getUniformLocation(prog, "u_frameA"),
    u_frameB: gl.getUniformLocation(prog, "u_frameB"),
    u_mixC: gl.getUniformLocation(prog, "u_mixC"),
    u_mixH: gl.getUniformLocation(prog, "u_mixH"),
    u_mixS: gl.getUniformLocation(prog, "u_mixS"),
    u_mixL: gl.getUniformLocation(prog, "u_mixL"),
    u_mCount: gl.getUniformLocation(prog, "u_mCount"),
    u_mType: gl.getUniformLocation(prog, "u_mType"),
    u_mA: gl.getUniformLocation(prog, "u_mA"),
    u_mB: gl.getUniformLocation(prog, "u_mB"),
    u_mAdj: gl.getUniformLocation(prog, "u_mAdj"),
    u_mCol: gl.getUniformLocation(prog, "u_mCol"),
    u_mRng: gl.getUniformLocation(prog, "u_mRng"),
  };
  SCALARS.forEach((n) => (uniforms[n] = gl.getUniformLocation(prog, n)));

  /* band hue centres, set once */
  gl.uniform1fv(uniforms.u_mixC, new Float32Array(MIX_BANDS.map(([, deg]) => deg / 360)));

  let texW = 1;
  let texH = 1;

  return {
    gl,
    setSource(source, w, h) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (source instanceof ImageData) {
        texW = source.width;
        texH = source.height;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        texW = w;
        texH = h;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
    },
    render(adj, { flip = 1, width = canvas.width, height = canvas.height, frame = null, masks = [] } = {}) {
      const u = toUniforms(adj);
      const MAXM = 6;
      const count = Math.min(MAXM, masks.length);
      const mT = new Float32Array(MAXM);
      const mA = new Float32Array(MAXM * 4);
      const mB = new Float32Array(MAXM * 4);
      const mJ = new Float32Array(MAXM * 4);
      const mC = new Float32Array(MAXM * 4);
      const mR = new Float32Array(MAXM);
      for (let i = 0; i < count; i++) {
        const m = masks[i];
        mT[i] = m.type === "linear" ? 1 : 0;
        if (m.type === "linear") {
          mA[i * 4] = m.x0; mA[i * 4 + 1] = m.y0; mA[i * 4 + 2] = m.x1; mA[i * 4 + 3] = m.y1;
        } else {
          mA[i * 4] = m.cx; mA[i * 4 + 1] = m.cy; mA[i * 4 + 2] = m.rx; mA[i * 4 + 3] = m.ry;
        }
        mB[i * 4] = (m.feather || 50) / 100;
        mB[i * 4 + 1] = m.invert ? 1 : 0;
        mB[i * 4 + 2] = (m.lumLo || 0) / 100;
        mB[i * 4 + 3] = (m.lumHi === undefined ? 100 : m.lumHi) / 100;
        mJ[i * 4] = (m.adj.exposure || 0) / 100;
        mJ[i * 4 + 1] = (m.adj.contrast || 0) / 100;
        mJ[i * 4 + 2] = (m.adj.temperature || 0) / 100;
        mJ[i * 4 + 3] = (m.adj.saturation || 0) / 100;
        if (m.colorOn) {
          mC[i * 4] = m.colR || 0;
          mC[i * 4 + 1] = m.colG || 0;
          mC[i * 4 + 2] = m.colB || 0;
          mC[i * 4 + 3] = 1;
        }
        mR[i] = (m.colRange === undefined ? 40 : m.colRange) / 100;
      }
      gl.uniform1i(uniforms.u_mCount, count);
      gl.uniform1fv(uniforms.u_mType, mT);
      gl.uniform4fv(uniforms.u_mA, mA);
      gl.uniform4fv(uniforms.u_mB, mB);
      gl.uniform4fv(uniforms.u_mAdj, mJ);
      gl.uniform4fv(uniforms.u_mCol, mC);
      gl.uniform1fv(uniforms.u_mRng, mR);
      gl.uniform1f(uniforms.u_flip, flip);
      gl.uniform2f(uniforms.u_texel, 1 / texW, 1 / texH);
      if (frame) {
        gl.uniform2f(uniforms.u_frameA, frame.ax, frame.ay);
        gl.uniform2f(uniforms.u_frameB, frame.bx, frame.by);
      } else {
        gl.uniform2f(uniforms.u_frameA, 1, 1);
        gl.uniform2f(uniforms.u_frameB, 0, 0);
      }
      const m = mixArrays(adj);
      gl.uniform1fv(uniforms.u_mixH, m.h);
      gl.uniform1fv(uniforms.u_mixS, m.s);
      gl.uniform1fv(uniforms.u_mixL, m.l);
      for (const k of Object.keys(u)) gl.uniform1f(uniforms[k], u[k]);
      gl.viewport(0, 0, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    readPixels(w, h, out) {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    },
    dispose() {
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    },
  };
}

/* Box-filter downscale of an RGBA buffer. Returns {data, width, height}. */
export function resizeRGBA(src, sw, sh, maxEdge) {
  if (Math.max(sw, sh) <= maxEdge) {
    return { data: src, width: sw, height: sh };
  }
  const scale = maxEdge / Math.max(sw, sh);
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const out = new Uint8ClampedArray(tw * th * 4);
  const xr = sw / tw;
  const yr = sh / th;
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * yr);
    const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil((ty + 1) * yr)));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * xr);
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil((tx + 1) * xr)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let idx = (y * sw + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += src[idx];
          g += src[idx + 1];
          b += src[idx + 2];
          idx += 4;
          n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: tw, height: th };
}

/* Apply adjustments to a full-resolution RGBA buffer in GPU tiles. */
export async function processFull(full, adj, { maxEdge = 0, onProgress, masks = [] } = {}) {
  let { data, width, height } = full;
  if (maxEdge && Math.max(width, height) > maxEdge) {
    onProgress && onProgress(0, "Resizing\u2026");
    await tick();
    const r = resizeRGBA(data, width, height, maxEdge);
    data = r.data;
    width = r.width;
    height = r.height;
  }

  const TILE = 2048;
  /* overlap so neighbourhood filters (denoise, clarity) don't seam at tile
     edges; clarity samples up to ~0.5% of frame width away */
  const PAD = Math.min(160, Math.max(16, Math.ceil(Math.max(width, height) * 0.006)));
  const glCanvas = document.createElement("canvas");
  glCanvas.width = TILE + PAD * 2;
  glCanvas.height = TILE + PAD * 2;
  const pipe = createPipeline(glCanvas);
  if (!pipe) throw new Error("WebGL unavailable for export");

  const out = new Uint8ClampedArray(width * height * 4);
  const cols = Math.ceil(width / TILE);
  const rows = Math.ceil(height / TILE);
  const total = cols * rows;
  let done = 0;
  const side = TILE + PAD * 2;
  const tileBuf = new Uint8Array(side * side * 4);
  const readBuf = new Uint8Array(side * side * 4);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = c * TILE;
      const ty = r * TILE;
      const tw = Math.min(TILE, width - tx);
      const th = Math.min(TILE, height - ty);
      const x0 = Math.max(0, tx - PAD);
      const y0 = Math.max(0, ty - PAD);
      const x1 = Math.min(width, tx + tw + PAD);
      const y1 = Math.min(height, ty + th + PAD);
      const ew = x1 - x0;
      const eh = y1 - y0;

      const tile = tileBuf.subarray(0, ew * eh * 4);
      for (let y = 0; y < eh; y++) {
        const so = ((y0 + y) * width + x0) * 4;
        tile.set(data.subarray(so, so + ew * 4), y * ew * 4);
      }
      pipe.setSource(tile, ew, eh);
      pipe.render(adj, {
        flip: -1,
        width: ew,
        height: eh,
        frame: { ax: ew / width, ay: eh / height, bx: x0 / width, by: y0 / height },
        masks,
      });
      const px = readBuf.subarray(0, ew * eh * 4);
      pipe.readPixels(ew, eh, px);

      const ox = tx - x0;
      const oy = ty - y0;
      for (let y = 0; y < th; y++) {
        const sOff = ((oy + y) * ew + ox) * 4;
        const dOff = ((ty + y) * width + tx) * 4;
        out.set(px.subarray(sOff, sOff + tw * 4), dOff);
      }
      done++;
      onProgress && onProgress(done / total, `Processing ${done}/${total}`);
      await tick();
    }
  }
  pipe.dispose();

  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  cv.getContext("2d").putImageData(new ImageData(out, width, height), 0, 0);
  return cv;
}

export function canvasToBlob(cv, type, quality) {
  return new Promise((resolve, reject) => {
    cv.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Encoding failed \u2014 the image may be too large for this browser. Try a smaller export size."))),
      type,
      quality
    );
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function tick() {
  return new Promise((res) => setTimeout(res, 0));
}
