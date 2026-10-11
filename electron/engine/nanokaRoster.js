// Resolves an owned character/weapon NAME (from the pull log) to a stable
// numeric/string ID, via nanoka.cc's public roster JSON — used only to know
// WHICH id to ask electron/main.js's existing get<Game>BannerImage IPC for
// (see costCalc.js). The actual IMAGE bytes still come from gc-data (see
// gc-data's scripts/updaters/update-nanoka-images.js, which fills in the
// same IDs' images there) — this module never fetches an image itself, only
// the small id/name JSON, so nanoka.cc is a runtime dependency for name
// resolution only, not for asset hosting.
//
// Always reads nanoka's "live" version (manifest.json's `live` field), never
// "latest" — the "live" snapshot cannot contain anything not actually
// released yet, which is what makes this safe to use even though nanoka's
// own roster (unlike gc-data's banner-schedule) covers every rarity: we're
// never browsing the roster, only resolving names the player's own pull log
// already proves they own, but never resolving to an unreleased id either
// way is a nice extra safety margin.
//
// Cached to disk per game (never expires automatically — same simplicity as
// the existing banner-image cache; delete the file to force a refresh).
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const STATIC_BASE = 'https://static.nanoka.cc';

// elementField: which character.json field carries the element/attribute —
// defaults to 'element' (Genshin, NTE both already store the plain name
// there). HSR instead calls it 'damageType'.
// elementMap: ZZZ and WuWa store a numeric code, not a name — built by
// cross-referencing known characters against each site's own element filter
// icons (static.nanoka.cc/assets/{zzz,ww}/...), not guessed.
const GAME_CONFIG = {
  genshin: { slug: 'gi',  weaponFile: 'weapon.json' },
  hsr:     { slug: 'hsr', weaponFile: 'lightcone.json', elementField: 'damageType' },
  zzz:     {
    slug: 'zzz', weaponFile: 'weapon.json',
    elementMap: { 200: 'Physical', 201: 'Fire', 202: 'Ice', 203: 'Electric', 204: 'Wind', 205: 'Ether' },
  },
  wuwa: {
    slug: 'ww', weaponFile: 'weapon.json',
    elementMap: { 1: 'Glacio', 2: 'Fusion', 3: 'Electro', 4: 'Aero', 5: 'Spectro', 6: 'Havoc' },
  },
  nte: { slug: 'nte', weaponFile: 'weapon.json' },
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      timeout: 20000,
      headers: { 'User-Agent': 'GachaCompanion' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
  });
}

// entries: { name: id } for characters and for weapons, keyed by nanoka's
// "en" field (the exact display name — same text the pull log uses).
// elements: { name: elementText } for characters, straight from nanoka's own
// "element" field (e.g. "Pyro") — used by the Teams tab to group by element
// without needing a second data source (see genshin/character.json shape).
async function fetchRoster(linkedDatabase) {
  const config = GAME_CONFIG[linkedDatabase];
  if (!config) return { characters: {}, weapons: {}, elements: {} };

  const manifest = await fetchJson(`${STATIC_BASE}/manifest.json`);
  const version = manifest[config.slug]?.live ?? manifest[config.slug]?.latest;
  if (!version) throw new Error(`No nanoka version for ${linkedDatabase}`);

  const [characterMap, weaponMap] = await Promise.all([
    fetchJson(`${STATIC_BASE}/${config.slug}/${version}/character.json`),
    fetchJson(`${STATIC_BASE}/${config.slug}/${version}/${config.weaponFile}`).catch(() => ({})),
  ]);

  const characters = {};
  const elements = {};
  const elementField = config.elementField ?? 'element';
  for (const [id, entry] of Object.entries(characterMap)) {
    if (!entry.en) continue;
    characters[entry.en] = id;
    const raw = entry[elementField];
    if (raw == null) continue;
    elements[entry.en] = config.elementMap ? config.elementMap[raw] : raw;
  }
  const weapons = {};
  for (const [id, entry] of Object.entries(weaponMap)) {
    if (entry.en) weapons[entry.en] = id;
  }
  return { characters, weapons, elements, schemaVersion: SCHEMA_VERSION };
}

// Bump whenever fetchRoster's output shape changes, so a stale cache file
// (e.g. one written before elementField/elementMap existed, when ZZZ/WuWa
// would have cached raw numeric element codes instead of names) is detected
// and refetched instead of silently served as-is.
const SCHEMA_VERSION = 2;

// cacheDir: the game's existing app.<game>CacheDir (see electron/main.js).
async function getRoster(linkedDatabase, cacheDir) {
  const cacheFile = path.join(cacheDir, 'nanoka-roster.json');
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    if (cached.schemaVersion === SCHEMA_VERSION) return cached;
  } catch (_) {}

  const roster = await fetchRoster(linkedDatabase);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(roster));
  } catch (_) {}
  return roster;
}

module.exports = { getRoster };
