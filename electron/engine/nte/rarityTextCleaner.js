// Flood-fill rarity-outline removal for the OCR-fallback pipeline. Ported
// directly from a standalone Python/numpy prototype validated against real
// screenshots of all 3 banners' record tables (Limited/Standard's "Item
// Name" column and Arc's "Arcs" column) before being rewritten here — see
// project memory for the validation results (14/15 rows at 1.0 confidence,
// 1 at 0.9, across 3 real Limited-board pages, plus 5/5 at 1.0 on a real
// Arc-board page).
//
// The game renders S-Class (gold, ~#FDB50B) and A-Class (pink, ~#E73FBD)
// item/arc names with a dark outline stroke around each colored letter —
// exactly the kind of high-contrast edge that scrambles Tesseract (raw OCR
// on a real screenshot read "Item - Warp Piece" as "itemgWarplRiece"). The
// fix: for each 8-connected blob of "text-shaped" pixels (dark OR
// saturated), if any pixel in that blob is saturated, the whole blob is
// outline-plus-fill for a colored letter — keep only the saturated (color)
// pixels and drop the dark outline entirely, rendering the surviving color
// pixels as solid black. A blob that never touches a saturated pixel is
// plain grey/black text (B-Class rows, or non-colored columns) and is kept
// completely untouched. Generalizes to any saturated rarity color, not
// hardcoded to gold/pink specifically (see isColor below).
function isColorPixel(r, g, b) {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  return (maxc - minc) > 60 && maxc > 100;
}

function isDarkPixel(r, g, b) {
  return Math.max(r, g, b) < 140;
}

// `raw` is {data, width, height, channels} — an RGBA (or RGB) buffer, e.g.
// straight from screenCapture.js's captureRegion(). Returns a 1-channel
// (grayscale) Buffer of the same width/height: 0 = kept text pixel (render
// black), 255 = background — ready to hand to sharp for a PNG, or straight
// to an OCR engine that accepts raw grayscale.
function floodFillCleanRegion({ data, width, height, channels }) {
  const size = width * height;
  const isColor = new Uint8Array(size);
  const isDark = new Uint8Array(size);
  const textMask = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const o = i * channels;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    const color = isColorPixel(r, g, b);
    const dark = isDarkPixel(r, g, b);
    isColor[i] = color ? 1 : 0;
    isDark[i] = dark ? 1 : 0;
    textMask[i] = (color || dark) ? 1 : 0;
  }

  const labels = new Int32Array(size); // 0 = no blob
  const blobTouchesColor = [false]; // 1-indexed; [0] unused placeholder
  let nextLabel = 0;
  const stack = new Int32Array(size);

  for (let start = 0; start < size; start++) {
    if (!textMask[start] || labels[start] !== 0) continue;
    nextLabel += 1;
    const label = nextLabel;
    blobTouchesColor.push(false);
    let touchesColor = false;

    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;

    while (sp > 0) {
      const idx = stack[--sp];
      if (isColor[idx]) touchesColor = true;
      const y = Math.floor(idx / width);
      const x = idx - y * width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dy === 0 && dx === 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const nidx = ny * width + nx;
          if (textMask[nidx] && labels[nidx] === 0) {
            labels[nidx] = label;
            stack[sp++] = nidx;
          }
        }
      }
    }
    blobTouchesColor[label] = touchesColor;
  }

  const cleaned = Buffer.alloc(size, 255);
  for (let i = 0; i < size; i++) {
    const label = labels[i];
    if (label === 0) continue;
    if (blobTouchesColor[label]) {
      if (isColor[i]) cleaned[i] = 0;
    } else {
      cleaned[i] = 0;
    }
  }

  return { data: cleaned, width, height, channels: 1 };
}

module.exports = { floodFillCleanRegion };
