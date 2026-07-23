// Character background image download, crop, and cache.
// Downloads the character art webp from nanoka, crops transparent edges,
// saves as PNG keyed by avatarId. Returns the local file path.

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const releasedIds = require('./engine/releasedIds');

const APPDATA_ROOT = process.env.APPDATA ?? path.join(require('os').homedir(), 'AppData', 'Roaming');

const IMAGES_ROOT = path.join(APPDATA_ROOT, 'gacha-companion', 'storage', 'showcases', 'images', 'backgrounds');
const ICONS_ROOT  = path.join(APPDATA_ROOT, 'gacha-companion', 'storage', 'showcases', 'images', 'characters');

// Per-game nanoka source for the showcase card's background art.
const NANOKA_URL_BY_GAME = {
  zzz: (avatarId) => `https://static.nanoka.cc/assets/zzz/Mindscape_${avatarId}_1.webp`,
  hsr: (avatarId) => `https://static.nanoka.cc/assets/hsr/avatardrawcard/${avatarId}.webp`,
};

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer':    'https://zzz.nanoka.cc/',
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function cropTransparentVertical(buffer) {
  const sharp = require('sharp');
  const img = sharp(buffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let top = -1, bottom = -1;

  outer_top:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 10) { top = y; break outer_top; }
    }
  }

  outer_bottom:
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 10) { bottom = y; break outer_bottom; }
    }
  }

  // Cropped-to-content, downscaled, and re-encoded as JPEG instead of a lossless
  // PNG at full source resolution — these were averaging ~4.8MB each (source
  // webps are full game-asset resolution, way beyond what a card thumbnail
  // needs), which made every first-view-per-session decode/display visibly
  // slow even served from a local cache. 1200px tall covers every card size
  // this app renders at with headroom; quality 85 is visually indistinguishable
  // at that display size. Any leftover transparency (edges within the vertical
  // crop bounds, not just top/bottom margins) is flattened rather than left as
  // an alpha channel, since JPEG has none.
  const MAX_HEIGHT = 1200;
  if (top === -1) {
    // fully transparent
    return sharp(buffer)
      .flatten({ background: '#0f0f13' })
      .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  return sharp(buffer)
    .extract({ left: 0, top, width, height: bottom - top + 1 })
    .flatten({ background: '#0f0f13' })
    .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function ensureCharImage(game, avatarId) {
  const buildUrl = NANOKA_URL_BY_GAME[game];
  if (!buildUrl) throw new Error(`ensureCharImage: no nanoka source configured for game "${game}"`);

  const dir = path.join(IMAGES_ROOT, game);
  fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${avatarId}.jpg`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath;

  // nanoka sometimes lists datamined characters before HoYoverse ships them —
  // only download art for IDs confirmed released via the official banner schedule.
  if (!releasedIds.isReleased(game, avatarId)) return null;

  const url    = buildUrl(avatarId);
  const buffer = await fetchBuffer(url);
  const png    = await cropTransparentVertical(buffer);
  fs.writeFileSync(outPath, png);
  return outPath;
}

async function cropTransparentTop(buffer) {
  const sharp = require('sharp');
  const img = sharp(buffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let top = -1;
  outer_top:
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 10) { top = y; break outer_top; }
    }
  }

  if (top === -1) return sharp(buffer).png().toBuffer(); // fully transparent

  return sharp(buffer)
    .extract({ left: 0, top: Math.max(0, top), width, height: height - Math.max(0, top) })
    .extend({ top: 30, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function ensureCharIcon(game, avatarId, iconUrl) {
  const dir = path.join(ICONS_ROOT, game);
  fs.mkdirSync(dir, { recursive: true });

  const outPath = path.join(dir, `${avatarId}.png`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath;

  const buffer = await fetchBuffer(iconUrl);
  const png    = await cropTransparentTop(buffer);
  fs.writeFileSync(outPath, png);
  return outPath;
}

module.exports = { ensureCharImage, ensureCharIcon };
