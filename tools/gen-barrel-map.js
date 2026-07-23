// Generate a displacement map for a CRT barrel (convex) distortion, used by an
// SVG <feDisplacementMap>. R channel = x-offset, G = y-offset (128 = none).
// Reads TV screen.png to find the actual screen-hole shape and centre, so the
// barrel is correctly aligned and scaled to match the chassis asset.
//   node tools/gen-barrel-map.js
const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// ── 1. Load TV screen.png and locate the screen hole ─────────────────────────
const tvBuf = fs.readFileSync(
  path.join(__dirname, '../../Files/TV screen.png')
);
const tv = PNG.sync.read(tvBuf);
const TW = tv.width, TH = tv.height;

// The screen hole is transparent (alpha < 128) in the PNG.
// Fallback: if the file has no alpha, treat bright pixels as the screen area.
let hasAlpha = false;
for (let i = 3; i < tv.data.length; i += 4) {
  if (tv.data[i] < 255) { hasAlpha = true; break; }
}

function isScreen(x, y) {
  const i = (y * TW + x) * 4;
  if (hasAlpha) return tv.data[i + 3] < 128;
  // No alpha channel — treat pixels brighter than mid-grey as screen area.
  return tv.data[i] > 128;
}

let minX = TW, maxX = 0, minY = TH, maxY = 0;
for (let y = 0; y < TH; y++) {
  for (let x = 0; x < TW; x++) {
    if (isScreen(x, y)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}

// Auto-detect corner radius: at y=minY the straight top edge hasn't started yet,
// so the first screen pixel on that row is at minX + cornerRadius.
let CORNER_R = 0;
for (let x = 0; x < TW; x++) {
  if (isScreen(x, minY)) { CORNER_R = x - minX; break; }
}
// Sanity-check with vertical scan (left edge at x=minX)
let cornerRY = 0;
for (let y = 0; y < TH; y++) {
  if (isScreen(minX, y)) { cornerRY = y - minY; break; }
}
CORNER_R = Math.round((CORNER_R + cornerRY) / 2);

// Centre and half-extents as fractions of the TV image dimensions.
const cx = (minX + maxX) / 2 / TW;
const cy = (minY + maxY) / 2 / TH;
const hw = (maxX - minX) / 2 / TW;   // half-width  (fraction of TV width)
const hh = (maxY - minY) / 2 / TH;   // half-height (fraction of TV height)

console.log(`Screen hole: x ${minX}–${maxX}  y ${minY}–${maxY}  (${TW}×${TH})`);
console.log(`Centre: (${(cx * 100).toFixed(1)}%, ${(cy * 100).toFixed(1)}%)`);
console.log(`Half-extents: w=${(hw * 100).toFixed(1)}%  h=${(hh * 100).toFixed(1)}%`);
console.log(`Corner radius: ${CORNER_R}px`);

// ── 2. Generate 256×256 barrel map using rounded-rect SDF ────────────────────
const N   = 256;
const out = new PNG({ width: N, height: N });

// Tuning knobs — re-run this script after editing.
const BAND_PX       = 10;   // how many pixels inward from the boundary the distortion extends (center beyond this is flat)
const EDGE_POWER    = 0.4;  // <1 = stays aggressive through the band, snaps to 0 at BAND_PX; 1 = linear; >1 = quick drop near boundary
const EDGE_STRENGTH = 3.5;  // displacement strength at the very boundary
const CORNER_BOOST  = 1.8;  // extra push at the 4 rounded corners specifically

// Hole dimensions in TV pixels (for SDF)
const hcx   = (minX + maxX) / 2;  // hole center x
const hcy   = (minY + maxY) / 2;  // hole center y
const hw_px = (maxX - minX) / 2 - CORNER_R;  // inner half-width (to corner arc centers)
const hh_px = (maxY - minY) / 2 - CORNER_R;  // inner half-height (to corner arc centers)

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // Map output pixel to TV image coords
    const tvX = x / (N - 1) * TW;
    const tvY = y / (N - 1) * TH;

    // Hole-center-relative pixel coords
    const px = tvX - hcx;
    const py = tvY - hcy;

    // Rounded-rect SDF: negative inside, 0 on boundary, positive outside.
    const qx = Math.max(0, Math.abs(px) - hw_px);
    const qy = Math.max(0, Math.abs(py) - hh_px);
    const sdf = Math.sqrt(qx * qx + qy * qy) - CORNER_R;

    // edgeT = 1 at boundary, 0 anywhere more than BAND_PX inside — center stays flat.
    const depth = Math.max(0, -sdf);
    const edgeT = Math.max(0, 1 - depth / BAND_PX);

    // Displacement direction: straight outward from hole center.
    const dist = Math.sqrt(px * px + py * py);
    const dnx  = dist > 0 ? px / dist : 0;
    const dny  = dist > 0 ? py / dist : 0;

    // Corner proximity: 1 at the corner arc center, 0 outside the corner arc radius.
    const cornerDist = Math.sqrt(qx * qx + qy * qy);
    const cornerTerm = cornerDist > 0 ? Math.max(0, 1 - cornerDist / CORNER_R) : 1;

    const strength = EDGE_STRENGTH * Math.pow(edgeT, EDGE_POWER) + CORNER_BOOST * cornerTerm * edgeT;
    let dx = -dnx * strength * hw;
    let dy = -dny * strength * hh;
    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));

    const i = (y * N + x) * 4;
    out.data[i]     = Math.round(128 + dx * 127);
    out.data[i + 1] = Math.round(128 + dy * 127);
    out.data[i + 2] = 128;
    out.data[i + 3] = 255;
  }
}

out.pack()
  .pipe(fs.createWriteStream(path.join(__dirname, '../src/assets/zzz/barrel-map.png')))
  .on('finish', () => console.log('wrote src/assets/zzz/barrel-map.png'));
