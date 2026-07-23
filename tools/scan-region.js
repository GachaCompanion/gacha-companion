// Report every colour the FRONT layer has within a region defined by a flat
// mask colour in the OUTLINES layer (same canvas size). Lets us read the real
// per-pixel colour spread of one TV part (e.g. the bezel).
//
//   node tools/scan-region.js <front.png> <outlines.png> <maskHex> [topN]
//
// Also prints the lightest/darkest and a rough vertical gradient (avg per band).

const fs = require('fs');
const { PNG } = require('pngjs');

const [, , frontPath, outPath, maskHex, topNArg] = process.argv;
const topN = parseInt(topNArg || '30', 10);

const front = PNG.sync.read(fs.readFileSync(frontPath));
const out = PNG.sync.read(fs.readFileSync(outPath));
const { width: w, height: h, data: fd } = front;
const od = out.data;

const m = maskHex.replace('#', '').match(/../g).map(v => parseInt(v, 16));
const tol = 30;
const map = new Map();
const bands = Array.from({ length: 5 }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
let region = 0, lum = [];

for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const j = (y * w + x) * 4;
    if (Math.abs(od[j] - m[0]) <= tol && Math.abs(od[j + 1] - m[1]) <= tol && Math.abs(od[j + 2] - m[2]) <= tol) {
      region++;
      const r = fd[j], g = fd[j + 1], b = fd[j + 2];
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
      map.set(hex, (map.get(hex) || 0) + 1);
      const band = bands[Math.min(4, Math.floor(y / h * 5))];
      band.r += r; band.g += g; band.b += b; band.n++;
      lum.push({ hex, l: 0.299 * r + 0.587 * g + 0.114 * b });
    }
  }
}

const colors = [...map.entries()].sort((a, b) => b[1] - a[1]);
lum.sort((a, b) => a.l - b.l);
const avg = b => b.n ? '#' + [b.r, b.g, b.b].map(v => Math.round(v / b.n).toString(16).padStart(2, '0')).join('') : '-';

console.log(`region pixels: ${region}   distinct colours: ${map.size}`);
console.log(`darkest: ${lum[0]?.hex}   lightest: ${lum[lum.length - 1]?.hex}`);
console.log(`vertical gradient (top→bottom, avg per 1/5): ${bands.map(avg).join('  ')}`);
console.log(`top ${topN} by count:`);
console.log(colors.slice(0, topN).map(([hex, c]) => `  ${hex} x${c}`).join('\n'));
