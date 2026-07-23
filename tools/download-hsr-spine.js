/*
 * Download HSR Live2D (Spine 4.1) assets from nanoka's static CDN.
 *
 * Source recipe (reverse-engineered from hsr.nanoka.cc):
 *   manifest: https://static.nanoka.cc/assets/hsr/spine/manifest.json
 *             -> { "<characterId>": "<basename>" | "<b1>|<b2>|..." }   ('|' = multi-skeleton)
 *   files:    https://static.nanoka.cc/assets/hsr/spine/<characterId>/<basename>.skel
 *                                                       .../<basename>.atlas
 *             texture(s): every page filename listed inside the .atlas (usually <basename>.webp)
 *
 * Each character is a standard Esoteric Spine export (.skel + .atlas + texture page).
 * Output layout mirrors the source:  <OUT>/<characterId>/<basename>.{skel,atlas,webp}
 *
 * Usage:
 *   node tools/download-hsr-spine.js                 # full roster -> public/assets/spine
 *   node tools/download-hsr-spine.js --only 1505 1403   # just these character ids
 *   node tools/download-hsr-spine.js --out some/dir  # custom output dir
 *   node tools/download-hsr-spine.js --force         # re-download even if file exists
 *   node tools/download-hsr-spine.js --list          # print manifest and exit (no downloads)
 *
 * No dependencies. Requires Node 18+ (global fetch).
 */

const fs = require('fs');
const path = require('path');

const CDN = 'https://static.nanoka.cc/assets/hsr/spine';
const MANIFEST_URL = `${CDN}/manifest.json`;
// nanoka serves the files openly, but send a Referer to stay on the safe side of any hotlink rules.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://hsr.nanoka.cc/',
  'Origin': 'https://hsr.nanoka.cc',
};
const CONCURRENCY = 6;

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valuesAfter = (f) => {
  const i = args.indexOf(f);
  if (i === -1) return null;
  const out = [];
  for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) out.push(args[j]);
  return out;
};
const OUT = (valuesAfter('--out')?.[0]) ||
  path.resolve(__dirname, '..', 'public', 'assets', 'spine');
const ONLY = valuesAfter('--only'); // null = all
const FORCE = has('--force');

// ── helpers ───────────────────────────────────────────────────────────────────
async function fetchBuffer(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Page filenames in a Spine atlas are lines that name an image file. A page header
// is a bare filename (ends in an image extension, contains no ':' key like size:/filter:).
function texturesFromAtlas(atlasText) {
  const out = [];
  for (const raw of atlasText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.includes(':')) continue;
    if (/\.(webp|png|jpg|jpeg)$/i.test(line)) out.push(line);
  }
  return [...new Set(out)];
}

// nanoka serves all textures as .webp but only rewrote *some* atlases to match
// (e.g. 1403/bg.atlas still says "bg.png" while the CDN only has bg.webp). Resolve
// the page name the atlas claims to whatever actually exists on the CDN, preferring
// the claimed name and falling back to other extensions. Returns the real filename,
// or null if nothing exists.
async function resolveTexture(charId, claimed) {
  const stem = claimed.replace(/\.[^.]+$/, '');
  const candidates = [claimed, `${stem}.webp`, `${stem}.png`, `${stem}.jpg`];
  for (const name of [...new Set(candidates)]) {
    const res = await fetch(`${CDN}/${charId}/${name}`, { method: 'HEAD', headers: HEADERS });
    if (res.ok) return name;
  }
  return null;
}

// Save a remote file unless it already exists (idempotent). Returns 'ok'|'skip'.
async function save(url, dest) {
  if (!FORCE && fs.existsSync(dest)) return 'skip';
  const buf = await fetchBuffer(url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return 'ok';
}

// Minimal promise pool.
async function pool(items, worker, size) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx]).catch((e) => ({ error: e }));
    }
  });
  await Promise.all(runners);
  return results;
}

// ── per-character download ──────────────────────────────────────────────────────
async function downloadCharacter(charId, basesStr) {
  const bases = basesStr.split('|').map((s) => s.trim()).filter(Boolean);
  const dir = path.join(OUT, charId);
  let ok = 0, skip = 0;
  const errors = [];

  for (const base of bases) {
    const skelUrl = `${CDN}/${charId}/${base}.skel`;
    const atlasUrl = `${CDN}/${charId}/${base}.atlas`;
    try {
      const r1 = await save(skelUrl, path.join(dir, `${base}.skel`));
      r1 === 'ok' ? ok++ : skip++;

      // atlas: need its text to discover the texture page filenames
      let atlasText = await fetchText(atlasUrl);

      // Resolve each page to a file that really exists, downloading it and rewriting
      // the atlas page line if the claimed name differs (so the spine runtime, which
      // reads these names verbatim, finds the texture we saved).
      for (const claimed of texturesFromAtlas(atlasText)) {
        const real = await resolveTexture(charId, claimed);
        if (!real) { errors.push(`${charId}/${base}: texture "${claimed}" not found`); continue; }
        if (real !== claimed) atlasText = atlasText.split(claimed).join(real);
        const r = await save(`${CDN}/${charId}/${real}`, path.join(dir, real));
        r === 'ok' ? ok++ : skip++;
      }

      // write the (possibly corrected) atlas last
      const atlasDest = path.join(dir, `${base}.atlas`);
      if (FORCE || !fs.existsSync(atlasDest)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(atlasDest, atlasText);
        ok++;
      } else skip++;
    } catch (e) {
      errors.push(`${charId}/${base}: ${e.message}`);
    }
  }
  return { charId, bases: bases.length, ok, skip, errors };
}

// ── main ────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Fetching spine manifest…\n  ${MANIFEST_URL}`);
  const manifest = JSON.parse(await fetchText(MANIFEST_URL));
  let ids = Object.keys(manifest);
  if (ONLY) ids = ids.filter((id) => ONLY.includes(id));

  if (has('--list')) {
    for (const id of ids) console.log(`  ${id}  ${manifest[id]}`);
    console.log(`\n${ids.length} character(s).`);
    return;
  }

  console.log(`Output: ${OUT}`);
  console.log(`Downloading ${ids.length} character(s)${FORCE ? ' (force)' : ''}…\n`);

  const results = await pool(
    ids,
    (id) => downloadCharacter(id, manifest[id]),
    CONCURRENCY,
  );

  let ok = 0, skip = 0;
  const allErrors = [];
  for (const r of results) {
    if (r.error) { allErrors.push(String(r.error)); continue; }
    ok += r.ok; skip += r.skip; allErrors.push(...r.errors);
    const tag = r.errors.length ? '✗' : '✓';
    console.log(`  ${tag} ${r.charId}  (${r.bases} skeleton${r.bases > 1 ? 's' : ''}, +${r.ok} new, ${r.skip} cached)`);
  }

  console.log(`\nDone. ${ok} file(s) downloaded, ${skip} already present.`);
  if (allErrors.length) {
    console.log(`\n${allErrors.length} error(s):`);
    for (const e of allErrors) console.log(`  - ${e}`);
    process.exitCode = 1;
  }
})();
