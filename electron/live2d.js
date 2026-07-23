// Live2D (Esoteric Spine) asset cache for the showcase.
// Downloads a character's spine triple (.skel + .atlas + texture) from nanoka's CDN
// on first request and caches it under userData; serves later requests from disk.
// Game-agnostic engine; per-game URL recipe in RECIPES. See memory/reference_nanoka_spine.

const fs = require('fs');
const path = require('path');
const releasedIds = require('./engine/releasedIds');

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

// Per-game recipe.
// HSR: remote manifest JSON + per-character CDN subdir.
// ZZZ: per-character lookup via nanoka's versioned character JSON (live2_d field)
//      + flat CDN dir (all files at base level, no per-ID subdir).
const RECIPES = {
  hsr: {
    manifest: 'https://static.nanoka.cc/assets/hsr/spine/manifest.json',
    base: 'https://static.nanoka.cc/assets/hsr/spine', // + /<characterId>/<file>
    headers: { Referer: 'https://hsr.nanoka.cc/', Origin: 'https://hsr.nanoka.cc' },
  },
  zzz: {
    // Spine name resolved per-character from:
    //   https://static.nanoka.cc/zzz/{version}/en/character/{id}.json → .live2_d
    // Files at: {base}/{live2_d}.skel / .atlas / texture (flat, no per-ID subdir).
    characterUrl: (id) => `https://static.nanoka.cc/zzz/3.1.3+17077339/en/character/${id}.json`,
    base: 'https://static.nanoka.cc/assets/zzz/live2d',
    flat: true,
    headers: { Referer: 'https://zzz.nanoka.cc/', Origin: 'https://zzz.nanoka.cc' },
  },
};

// Cache: HSR manifest (id -> base name string), ZZZ per-character spine names.
const _manifests = {};        // hsr: { id -> baseName }
const _zzzSpineNames = {};    // zzz: { id -> live2_d string }, populated on demand

function headers(recipe) {
  return { ...BASE_HEADERS, ...(recipe.headers ?? {}) };
}

async function getManifest(game) {
  if (_manifests[game]) return _manifests[game];
  const recipe = RECIPES[game];
  if (!recipe) throw new Error(`no Live2D recipe for game "${game}"`);
  const res = await fetch(recipe.manifest, { headers: headers(recipe) });
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  _manifests[game] = await res.json();
  return _manifests[game];
}

// For ZZZ: resolve a character's spine base name from nanoka's per-character JSON.
// Returns null if the character has no Live2D (live2_d field absent or empty).
async function resolveZzzSpineName(id, recipe) {
  if (_zzzSpineNames[id] !== undefined) return _zzzSpineNames[id];
  const url = recipe.characterUrl(id);
  const res = await fetch(url, { headers: headers(recipe) });
  if (!res.ok) { _zzzSpineNames[id] = null; return null; }
  const data = await res.json();
  const name = data.live2_d || null;
  _zzzSpineNames[id] = name;
  return name;
}

async function fetchBuffer(url, recipe) {
  const res = await fetch(url, { headers: headers(recipe) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Texture page filenames named inside a Spine atlas (bare filenames, no ':' keys).
function texturesFromAtlas(atlasText) {
  const out = [];
  for (const raw of atlasText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.includes(':')) continue;
    if (/\.(webp|png|jpg|jpeg)$/i.test(line)) out.push(line);
  }
  return [...new Set(out)];
}

// nanoka serves textures as .webp but didn't rewrite every atlas (e.g. 1403/bg.atlas
// still says bg.png while only bg.webp exists). Resolve the page name to whatever
// actually exists on the CDN.
async function resolveTexture(baseUrl, claimed, recipe) {
  const stem = claimed.replace(/\.[^.]+$/, '');
  for (const name of [...new Set([claimed, `${stem}.webp`, `${stem}.png`, `${stem}.jpg`])]) {
    const res = await fetch(`${baseUrl}/${name}`, { method: 'HEAD', headers: headers(recipe) });
    if (res.ok) return name;
  }
  return null;
}

// Per-game framing cache (id -> { cx, cy, max, head }), persisted to
// <root>/<game>/framing.json. Computed once per character (head anchor) and
// reused indefinitely; the renderer just reads it.
const _framing = {};   // game -> { loaded:bool, dirty:bool, data:{} , path:string }

function framingStore(root, game) {
  let s = _framing[game];
  if (!s) {
    s = _framing[game] = { version: 0, data: {}, path: path.join(root, game, 'framing.json') };
    try {
      const parsed = JSON.parse(fs.readFileSync(s.path, 'utf8'));
      s.version = parsed.version ?? 0;
      s.data = parsed.data ?? parsed; // backward compat: old files are flat { id: framing }
    } catch {}
  }
  return s;
}

function saveFraming(store) {
  try {
    fs.mkdirSync(path.dirname(store.path), { recursive: true });
    fs.writeFileSync(store.path, JSON.stringify({ version: store.version, data: store.data }));
  } catch (e) { /* non-fatal */ }
}

// Framing is pre-computed by GitHub Actions and distributed as framing_<game>.json.
// No local computation — just a cache lookup.
function getFraming(root, game, id) {
  return framingStore(root, game).data[id] ?? null;
}

// Ensure a character's spine assets are cached under <root>/<game>/<characterId>/.
// Returns { ok, relPath, skeletons:[{skel, atlas}], framing } or { ok:false, ... }.
//   reason 'none' = this character has no Live2D.
async function ensure({ root, modelRoot, game, characterId }) {
  try {
    const id = String(characterId);
    const recipe = RECIPES[game];
    if (!recipe) throw new Error(`no Live2D recipe for game "${game}"`);

    // nanoka sometimes lists datamined characters before HoYoverse ships them.
    // Only sync IDs confirmed released via the official banner schedule — unless
    // we already cached this character before the whitelist existed.
    if (!releasedIds.isReleased(game, id) && !fs.existsSync(path.join(root, game, id))) {
      return { ok: false, reason: 'unreleased' };
    }

    // Resolve the spine base name(s) for this character.
    let bases;
    if (recipe.characterUrl) {
      // ZZZ: look up the live2_d name from the per-character JSON.
      const spineName = await resolveZzzSpineName(id, recipe);
      if (!spineName) return { ok: false, reason: 'none' };
      bases = [spineName];
    } else {
      const manifest = await getManifest(game);
      const entry = manifest[id];
      if (!entry) return { ok: false, reason: 'none' };
      bases = String(entry).split('|').map((s) => s.trim()).filter(Boolean);
    }

    const cdnDir = recipe.flat ? recipe.base : `${recipe.base}/${id}`;
    const dir = path.join(root, game, id);
    const relPath = `${game}/${id}`;
    const skeletons = [];

    for (const base of bases) {
      const skelName = `${base}.skel`;
      const atlasName = `${base}.atlas`;
      const skelDest = path.join(dir, skelName);
      const atlasDest = path.join(dir, atlasName);

      // Already cached? trust the presence of skel + atlas.
      if (fs.existsSync(skelDest) && fs.existsSync(atlasDest)) {
        skeletons.push({ skel: skelName, atlas: atlasName });
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(skelDest, await fetchBuffer(`${cdnDir}/${skelName}`, recipe));

      let atlasText = (await fetchBuffer(`${cdnDir}/${atlasName}`, recipe)).toString('utf8');
      for (const claimed of texturesFromAtlas(atlasText)) {
        const real = await resolveTexture(cdnDir, claimed, recipe);
        if (!real) throw new Error(`texture "${claimed}" not found for ${id}/${base}`);
        if (real !== claimed) atlasText = atlasText.split(claimed).join(real);
        const texDest = path.join(dir, real);
        if (!fs.existsSync(texDest)) fs.writeFileSync(texDest, await fetchBuffer(`${cdnDir}/${real}`, recipe));
      }
      fs.writeFileSync(atlasDest, atlasText);
      skeletons.push({ skel: skelName, atlas: atlasName });
    }

    const framing = getFraming(root, game, id);
    return { ok: true, relPath, skeletons, framing };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// All character IDs to sync for a game.
// HSR: keys from the remote manifest.
// ZZZ: S-rank (rank=4) IDs from the versioned character.json.
const _zzzCharacterIds = [];
async function listManifestIds(game) {
  const recipe = RECIPES[game];
  if (!recipe) return [];
  if (recipe.characterUrl) {
    if (_zzzCharacterIds.length) return [..._zzzCharacterIds];
    const res = await fetch(`https://static.nanoka.cc/zzz/3.1.3+17077339/character.json`, { headers: headers(recipe) });
    if (!res.ok) return [];
    const data = await res.json();
    const ids = Object.entries(data)
      .filter(([, c]) => c.rank === 4 || c.rank === 3)
      .map(([id]) => id);
    _zzzCharacterIds.push(...ids);
    return ids;
  }
  const manifest = await getManifest(game);
  return Object.keys(manifest);
}

// Sync every character: download missing assets + compute missing framing.
// Idempotent — cached characters are skipped — so warm launches fly through.
async function syncAll({ root, modelRoot, game }) {
  const ids = await listManifestIds(game);
  let added = 0;
  const errors = [];
  for (const id of ids) {
    const res = await ensure({ root, modelRoot, game, characterId: id });
    if (res.ok) { if (res.framing) added++; }
    else if (res.reason !== 'none') errors.push(`${id}: ${res.error}`);
  }
  return { ok: true, total: ids.length, framed: added, errors };
}

// Clear framing cache entries for a game (all IDs, or a specific one).
// Forces recomputation on next view.
function clearFraming(game, root, id) {
  const store = framingStore(root, game);
  if (id) {
    delete store.data[id];
  } else {
    store.data = {};
  }
  saveFraming(store);
  // Also clear in-memory cache so the live store reflects the deletion.
  delete _framing[game];
}

// List character IDs that are already downloaded locally (have at least one .skel file).
function listLocalIds(game, root) {
  const dir = path.join(root, game);
  try {
    return fs.readdirSync(dir).filter(id => {
      const sub = path.join(dir, id);
      try { return fs.readdirSync(sub).some(f => f.endsWith('.skel')); } catch { return false; }
    });
  } catch { return []; }
}

module.exports = { ensure, syncAll, listManifestIds, listLocalIds, clearFraming, hasRecipe: (game) => !!RECIPES[game] };
