// Scan a single exported layer PNG and report each distinct flat colour with its
// coverage and bounding box / centroid as % of the canvas — so the ZZZ TV can be
// redrawn 1:1 in colour at our own dimensions (positions are resolution-independent).
//
// Usage:
//   npm i -D pngjs           (one-time)
//   node tools/scan-layer.js <layer.png> [minCoveragePct]
//
// Tips:
//  - Export EACH Paint.NET layer separately as PNG (same canvas size).
//  - The "colored" segmentation layer is the key one: each flat colour = one part.
//  - minCoveragePct (default 0.03) filters stray/anti-alias pixels.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const file = process.argv[2];
const minCoverage = parseFloat(process.argv[3] || '0.03');

if (!file) {
  console.error('Usage: node tools/scan-layer.js <layer.png> [minCoveragePct]');
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(file));
const { width, height, data } = png;
const total = width * height;
const map = new Map();

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 8) continue; // skip (near-)transparent
    const hex = '#' + [data[i], data[i + 1], data[i + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('');
    let e = map.get(hex);
    if (!e) { e = { count: 0, minX: x, minY: y, maxX: x, maxY: y, sx: 0, sy: 0 }; map.set(hex, e); }
    e.count++;
    if (x < e.minX) e.minX = x; if (x > e.maxX) e.maxX = x;
    if (y < e.minY) e.minY = y; if (y > e.maxY) e.maxY = y;
    e.sx += x; e.sy += y;
  }
}

const pct = (n, d) => +(100 * n / d).toFixed(1);
const colors = [...map.entries()]
  .map(([hex, e]) => ({
    hex,
    coverage: +(100 * e.count / total).toFixed(2),
    bboxPct: {
      x: pct(e.minX, width), y: pct(e.minY, height),
      w: pct(e.maxX - e.minX + 1, width), h: pct(e.maxY - e.minY + 1, height),
    },
    centroidPct: { x: pct(e.sx / e.count, width), y: pct(e.sy / e.count, height) },
  }))
  .filter(c => c.coverage >= minCoverage)
  .sort((a, b) => b.coverage - a.coverage);

console.log(JSON.stringify({ file: path.basename(file), width, height, colors }, null, 2));
