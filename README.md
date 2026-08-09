# EditCamp

RAW editing made easy. A guided photo editor that walks you through the
professional editing loop — white balance, exposure, recovery, contrast, color —
one step at a time, with a live before/after comparison.

Opens **real camera RAW files** (Sony ARW, Canon CR2/CR3, Nikon NEF, Fuji RAF,
DNG and most others) as well as regular JPG/PNG/WebP. All processing happens in
your browser on your own machine — nothing is ever uploaded anywhere.

## Setup (one time)

1. Install **Node.js LTS** from https://nodejs.org (choose the LTS version, use
   the default options).
2. Open a terminal in this folder:
   - Windows: open the folder in File Explorer, click the address bar, type
     `cmd` and press Enter.
   - Mac: right-click the folder → Services → New Terminal at Folder (or just
     open Terminal and drag the folder in after typing `cd `).
3. Run:

```
npm install
```

## Run it

```
npm run dev
```

Then open http://localhost:5173 in your browser. Leave the terminal window
open while you use the app; press Ctrl+C in it to stop.

### Use it on your phone

With your phone on the same Wi-Fi as your PC, run:

```
npm run dev -- --host
```

The terminal will print a "Network" URL — open that on your phone. Note that
very large RAW files (50+ megapixels) may be too much for older phones.

## Using the app

- **Upload a photo** — a RAW file straight from your camera works best, but a
  JPG is fine too. Or practice on the built-in sample landscape.
- **Guided tab** — the five-step editing loop with explanations. Do this a few
  times and the sliders in any editor will make sense.
- **Advanced tab** — the full slider set: light and colour controls, a
  per-colour mixer, split toning, clarity/dehaze/vignette effects, and
  sharpen/noise-reduction detail controls.
- **Crop & straighten** — button above the photo; drag the corners, use the
  straighten slider for tilted horizons, then Apply.
- **Split view / Hold to see original** — the before/after comparison.
- **Export** (top bar) — saves a finished **JPG or PNG** at full resolution
  (or a smaller size if you prefer). Your original RAW file is **never
  modified** — that's how RAW workflows are meant to work. You can also save
  your slider settings as a tiny `.editcamp.json` edits file and load them
  back later to continue where you left off.

## Troubleshooting

- **RAW file won't open** — a handful of very new cameras aren't supported by
  the decoder yet; try exporting a JPG from your camera's software as a
  fallback. Compressed RAW variants from some brands can also be unsupported.
- **Export at Full size fails** — very large sensors (60+ MP) can exceed what
  some browsers allow for a single image. Choose the 3000px export size
  instead.
- **Page is blank / WebGL error** — enable hardware acceleration in your
  browser settings.

## Hosting it as a website (optional)

```
npm run build
```

This produces a `dist/` folder of plain static files you can upload to any
static host (Netlify, GitHub Pages, Cloudflare Pages, etc.). No server code
needed.
