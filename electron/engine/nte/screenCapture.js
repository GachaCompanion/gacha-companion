// Screenshot capture for the NTE OCR pipeline, via raw GDI BitBlt (koffi)
// instead of Electron's desktopCapturer.
//
// desktopCapturer went through several rounds of testing and reliably
// returned stale/wrong content (repeatedly capturing whatever was on screen
// before NTE was actually focused, regardless of when in the sequence the
// capture call was made) — pointing at Chromium's own screen-capture
// session/compositor layer, not a timing bug in our code. Researched how
// Inventory Kamera (a working, shipped screen-scraping tool for a similar
// fullscreen game) does this instead: plain GDI BitBlt
// (GetDC -> CreateCompatibleDC -> BitBlt -> GetDIBits), the same approach
// virtually every Windows screenshot tool uses. It also sidesteps the
// DIP/scaleFactor reconciliation entirely — GetDC(NULL) covers the whole
// virtual desktop in the same raw-pixel coordinate space as
// GetCursorPos/SetCursorPos/GetWindowRect in capture.js, which is already
// proven correct, instead of Electron's separate `screen` module coordinate
// space that had to be manually converted.

const koffi = require('koffi');
const sharp = require('sharp');

let _user32 = null;
function user32() {
  if (!_user32) _user32 = koffi.load('user32.dll');
  return _user32;
}

let _gdi32 = null;
function gdi32() {
  if (!_gdi32) _gdi32 = koffi.load('gdi32.dll');
  return _gdi32;
}

let _fns = null;
function fns() {
  if (_fns) return _fns;
  const u = user32();
  const g = gdi32();
  _fns = {
    GetDC:      u.func('intptr __stdcall GetDC(intptr hwnd)'),
    ReleaseDC:  u.func('int __stdcall ReleaseDC(intptr hwnd, intptr hdc)'),
    CreateCompatibleDC:     g.func('intptr __stdcall CreateCompatibleDC(intptr hdc)'),
    CreateCompatibleBitmap: g.func('intptr __stdcall CreateCompatibleBitmap(intptr hdc, int cx, int cy)'),
    SelectObject: g.func('intptr __stdcall SelectObject(intptr hdc, intptr h)'),
    BitBlt:       g.func('bool __stdcall BitBlt(intptr hdcDest, int xDest, int yDest, int w, int h, intptr hdcSrc, int xSrc, int ySrc, uint32 rop)'),
    GetDIBits:    g.func('int __stdcall GetDIBits(intptr hdc, intptr hbm, uint32 start, uint32 cLines, void* lpvBits, void* lpbi, uint32 usage)'),
    DeleteObject: g.func('bool __stdcall DeleteObject(intptr ho)'),
    DeleteDC:     g.func('bool __stdcall DeleteDC(intptr hdc)'),
  };
  return _fns;
}

const SRCCOPY = 0x00cc0020;
const DIB_RGB_COLORS = 0;

// Captures a screen-space pixel rect (absolute desktop coordinates, same
// space as SetCursorPos/GetWindowRect) via raw GDI BitBlt. Returns an RGBA
// buffer (GDI DIBs come back BGRA; swapped here so every consumer downstream
// gets plain RGBA).
function captureScreenRectRaw(left, top, width, height) {
  const {
    GetDC, ReleaseDC, CreateCompatibleDC, CreateCompatibleBitmap,
    SelectObject, BitBlt, GetDIBits, DeleteObject, DeleteDC,
  } = fns();

  const hdcScreen = GetDC(0); // NULL hwnd = the whole virtual desktop
  if (!hdcScreen) throw new Error('GetDC(NULL) failed.');

  const hdcMem = CreateCompatibleDC(hdcScreen);
  const hBitmap = CreateCompatibleBitmap(hdcScreen, width, height);
  const hOld = SelectObject(hdcMem, hBitmap);

  try {
    if (!BitBlt(hdcMem, 0, 0, width, height, hdcScreen, left, top, SRCCOPY)) {
      throw new Error('BitBlt failed.');
    }

    // BITMAPINFOHEADER — 40 bytes. Negative biHeight requests a top-down DIB
    // (row 0 = top row) so pixel rows don't need to be flipped afterward.
    const bmi = Buffer.alloc(40);
    bmi.writeInt32LE(40, 0);      // biSize
    bmi.writeInt32LE(width, 4);   // biWidth
    bmi.writeInt32LE(-height, 8); // biHeight (negative = top-down)
    bmi.writeInt16LE(1, 12);      // biPlanes
    bmi.writeInt16LE(32, 14);     // biBitCount
    bmi.writeInt32LE(0, 16);      // biCompression = BI_RGB
    bmi.writeInt32LE(0, 20);      // biSizeImage
    bmi.writeInt32LE(0, 24);      // biXPelsPerMeter
    bmi.writeInt32LE(0, 28);      // biYPelsPerMeter
    bmi.writeInt32LE(0, 32);      // biClrUsed
    bmi.writeInt32LE(0, 36);      // biClrImportant

    const pixels = Buffer.alloc(width * 4 * height);
    const linesWritten = GetDIBits(hdcMem, hBitmap, 0, height, pixels, bmi, DIB_RGB_COLORS);
    if (!linesWritten) throw new Error('GetDIBits failed.');

    // BGRA -> RGBA in place.
    for (let i = 0; i < pixels.length; i += 4) {
      const b = pixels[i];
      pixels[i] = pixels[i + 2];
      pixels[i + 2] = b;
    }

    return { data: pixels, width, height, channels: 4 };
  } finally {
    SelectObject(hdcMem, hOld);
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(0, hdcScreen);
  }
}

// Captures a sub-region of the game window, given as a fraction (0-1) rect
// relative to the window's own bounds — the same convention used by
// calibration points. Returns both a raw RGBA pixel buffer (for direct
// color sampling) and a PNG buffer (for OCR), from the same capture so the
// two never drift apart.
async function captureRegion(windowBounds, fractionRect) {
  const left   = Math.round(windowBounds.x + (fractionRect?.x ?? 0) * windowBounds.width);
  const top    = Math.round(windowBounds.y + (fractionRect?.y ?? 0) * windowBounds.height);
  const width  = Math.max(1, Math.round((fractionRect?.width ?? 1) * windowBounds.width));
  const height = Math.max(1, Math.round((fractionRect?.height ?? 1) * windowBounds.height));

  const raw = captureScreenRectRaw(left, top, width, height);
  const png = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png()
    .toBuffer();

  return { raw, png };
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

// Checks whether a captured RGBA region contains a pixel matching the given
// hex color within tolerance — used to detect the #FDB50B S-rank highlight
// on item/arc names without needing full OCR.
function regionContainsColor({ data, channels }, hex, tolerance = 24) {
  const target = hexToRgb(hex);
  for (let i = 0; i < data.length; i += channels) {
    if (
      Math.abs(data[i] - target.r) <= tolerance &&
      Math.abs(data[i + 1] - target.g) <= tolerance &&
      Math.abs(data[i + 2] - target.b) <= tolerance
    ) {
      return true;
    }
  }
  return false;
}

module.exports = { captureRegion, regionContainsColor };
