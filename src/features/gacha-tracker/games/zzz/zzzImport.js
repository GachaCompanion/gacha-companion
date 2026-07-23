import { isZzzStandardAt } from './zzzStandardPool.js';
import { compareTimeThenId } from '../../engine/pullUtils.js';

// ZZZ-specific constants and pull processing.
// API gacha types: 2 = Exclusive (character), 3 = W-Engine (weapon), 1 = Stable (standard), 5 = Bangboo

export const ZZZ_BANNER_LABELS = {
  character: 'Exclusive',
  weapon:    'W-Engine',
  standard:  'Stable',
  bangboo:   'Bangboo',
};

export const ZZZ_ALL_BANNERS = ['character', 'weapon', 'standard', 'bangboo'];

// Community-sourced character ID → name map (IDs from rng.moe backup format)
const ZZZ_CHAR_NAMES = {
  1011: 'Anby',           1021: 'Nekomata',       1031: 'Nicole',
  1041: 'Soldier 11',     1051: 'Yidhari',         1061: 'Corin',
  1071: 'Caesar',         1081: 'Billy',            1091: 'Miyabi',
  1101: 'Koleda',         1111: 'Anton',            1121: 'Ben',
  1131: 'Soukaku',        1141: 'Lycaon',           1151: 'Lucy',
  1161: 'Lighter',        1171: 'Burnice',          1181: 'Grace',
  1191: 'Ellen',          1201: 'Harumasa',         1211: 'Rina',
  1221: 'Yanagi',         1231: 'Rokudou Sariel',   1241: 'Zhu Yuan',
  1251: 'Qingyi',         1261: 'Jane Doe',         1271: 'Seth',
  1281: 'Piper',          1291: 'Hugo Vlad',        1301: 'Orphie & Magus',
  1311: 'Astra Yao',      1321: 'Evelyn',           1331: 'Vivian',
  1341: 'Zhao',           1351: 'Pulchra',          1361: 'Trigger',
  1371: 'Yi Xuan',        1381: 'Silver Anby',      1391: 'Ju Fufu',
  1401: 'Alice',          1411: 'Yuzuha',           1421: 'Pan Yinhu',
  1431: 'Ye Shunguang',   1441: 'Komano Manato',    1451: 'Lucia',
  1461: 'Seed',           1471: 'Banyue',           1481: 'Dialyn',
  1491: 'Sunna',          1501: 'Aria',             1511: 'Nangong Yu',
  1521: 'Cissia',         1531: 'Billy SP',         1541: 'Promeia',
  1551: 'Pyrois',         1561: 'Velina',           1571: 'Norma',
  1581: 'Remielle',
  2011: 'Wise',           2021: 'Belle',
};

// Community-sourced (nanoka.cc) W-Engine ID → English name map. rng.moe's
// own backup format only ever stores numeric item ids (no names at all —
// confirmed by inspecting a real export), unlike the live API which returns
// real names directly (see buildApiEntries below) — so this table only
// matters for the JSON-import path.
const ZZZ_WEAPON_NAMES = {
  12001: "[Lunar] Pleniluna",     12002: "[Lunar] Decrescent",     12003: "[Lunar] Noviluna",
  12004: "[Reverb] Mark I",       12005: "[Reverb] Mark II",       12006: "[Reverb] Mark III",
  12007: "[Vortex] Revolver",     12008: "[Vortex] Arrow",         12009: "[Vortex] Hatchet",
  12010: "[Magnetic Storm] Alpha",12011: "[Magnetic Storm] Bravo", 12012: "[Magnetic Storm] Charlie",
  12013: "[Identity] Base",       12014: "[Identity] Inflection",  12015: "[Cinder] Cobalt",
  13001: "Street Superstar",      13002: "Slice of Time",          13003: "Rainforest Gourmet",
  13004: "Starlight Engine",      13005: "Steam Oven",             13006: "Precious Fossilized Core",
  13007: "Original Transmorpher", 13008: "Weeping Gemini",         13009: "Electro-Lip Gloss",
  13010: "Bunny Band",            13011: "Spring Embrace",         13012: "Puzzle Sphere",
  13013: "Gilded Blossom",        13014: "Radiowave Journey",      13015: "Marcato Desire",
  13016: "Reel Projector",        13018: "Boisterous Echoes",      13019: "Cauldron of Clarity",
  13020: "The Simmering Pot",     13101: "Demara Battery Mark II", 13103: "The Vault",
  13106: "Housekeeper",           13108: "Starlight Engine Replica", 13111: "Drill Rig - Red Axis",
  13112: "Big Cylinder",          13113: "Bashful Demon",          13115: "Kaboom the Cannon",
  13127: "Peacekeeper - Specialized", 13128: "Roaring Ride",       13135: "Box Cutter",
  13142: "Tremor Trigram Vessel", 13144: "Grill O'Wisp",           14001: "Cannon Rotor",
  14002: "Unfettered Game Ball",  14003: "Six Shooter",            14102: "Steel Cushion",
  14104: "The Brimstone",         14105: "Kraken's Cradle",        14107: "Tusks of Fury",
  14109: "Hailstorm Shrine",      14110: "Hellfire Gears",         14114: "The Restrained",
  14116: "Blazing Laurel",        14117: "Flamemaker Shaker",      14118: "Fusion Compiler",
  14119: "Deep Sea Visitor",      14120: "Zanshin Herb Case",      14121: "Weeping Cradle",
  14122: "Timeweaver",            14124: "Riot Suppressor Mark VI",14125: "Ice-Jade Teapot",
  14126: "Sharpened Stinger",     14129: "Myriad Eclipse",         14130: "Bellicose Blaze",
  14131: "Elegant Vanity",        14132: "Heartstring Nocturne",   14133: "Flight of Fancy",
  14134: "Half-Sugar Bunny",      14136: "Spectral Gaze",          14137: "Qingming Birdcage",
  14138: "Severed Innocence",     14139: "Roaring Fur-nace",       14140: "Practiced Perfection",
  14141: "Metanukimorphosis",     14143: "Cloudcleave Radiance",   14145: "Dreamlit Hearth",
  14146: "Cordis Germina",        14147: "Wrathful Vajra",         14148: "Yesterday Calls",
  14149: "Thoughtbop",            14150: "Angel in the Shell",     14151: "Neon Fantasies",
  14152: "Serpentine Seeker",     14153: "Starlight Rider Faceplate", 14154: "Frostfall Sickle",
  14155: "Sol Exuvia",            14156: "Joyau Dore",             14157: "Chief Sidekick",
};

// Community-sourced (nanoka.cc) Bangboo ID → English name map. Same
// JSON-import-only rationale as ZZZ_WEAPON_NAMES above.
const ZZZ_BANGBOO_NAMES = {
  53001: "Penguinboo", 53002: "Luckyboo",   53003: "Exploreboo", 53004: "Sumoboo",
  53005: "Paperboo",   53006: "Bagboo",     53007: "Cryboo",     53008: "Avocaboo",
  53009: "Boollseye",  53010: "Electroboo", 53011: "Magnetiboo", 53012: "Booressure",
  53013: "Baddieboo",  53014: "Overtimeboo",53015: "Brawlerboo", 53016: "Excaliboo",
  53017: "Knightboo",  53019: "Bild N. Boolok", 53021: "Booltergeist",
  54001: "Sharkboo",   54002: "Safety",     54003: "Devilboo",   54004: "Butler",
  54005: "Amillion",   54006: "Rocketboo",  54008: "Plugboo",    54009: "Resonaboo",
  54010: "Biggest Fan",54011: "Red Moccus", 54012: "Officer Cui",54013: "Bangvolver",
  54014: "Agent Gulliver", 54015: "Snap",   54016: "Robin",      54017: "Belion",
  54018: "Miss Esme",  54019: "Mercury",    54020: "Birkblick",  54021: "Sprout",
  54022: "Ultra Jake",
};

function resolveItem(id) {
  if (id >= 1000 && id < 12000) {
    return { name: ZZZ_CHAR_NAMES[id] ?? `Agent #${id}`, type: 'character' };
  }
  if (id >= 53000) return { name: ZZZ_BANGBOO_NAMES[id] ?? `Bangboo #${id}`, type: 'bangboo' };
  // 12xxx = common 3-star W-Engine fodder (dropped as filler by every
  // banner, including the Bangboo banner — not a bangboo itself), 13xxx/
  // 14xxx = real 4/5-star W-Engines. Confirmed against a real account's
  // synced data: every id in this range only ever appeared under the
  // Weapon banner (or as shared 3-star fodder), never as an actual bangboo
  // — the previous ranges here had weapon and bangboo backwards.
  return { name: ZZZ_WEAPON_NAMES[id] ?? `W-Engine #${id}`, type: 'weapon' };
}

function msToZzzTime(ts) {
  const d = new Date(ts + 8 * 3600 * 1000); // shift to UTC+8
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
         `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const RNGMOE_TO_BANNER = { 1001: 'standard', 2001: 'character', 3001: 'weapon', 5001: 'bangboo' };
// result field: 0=no 50/50 tracking, 1=won, 2=lost, 3=guaranteed
const RNGMOE_TO_WON5050 = { 1: 'won', 2: 'lost', 3: 'guaranteed' };

export function parseZzzRngMoe(jsonText, existingLog = []) {
  let raw;
  try { raw = JSON.parse(jsonText); }
  catch { throw new Error('Invalid JSON — could not parse file.'); }

  if (raw.game !== 'zzz') throw new Error('This backup is not for ZZZ (game field is not "zzz").');
  if (!raw.data?.profiles)  throw new Error('No profile data found in backup.');

  const profileId = String(raw.data.curProfileId ?? Object.keys(raw.data.profiles)[0]);
  const profile   = raw.data.profiles[profileId];
  if (!profile) throw new Error('Profile not found in backup.');

  const store = profile.stores?.['0'];
  if (!store?.items) throw new Error('No gacha items found in backup.');

  const pullLog = [];
  let totalImported = 0;
  const counts = { character: 0, weapon: 0, standard: 0, bangboo: 0 };

  for (const [gachaTypeStr, items] of Object.entries(store.items)) {
    const gachaType = parseInt(gachaTypeStr, 10);
    const banner    = RNGMOE_TO_BANNER[gachaType];
    if (!banner || !Array.isArray(items) || items.length === 0) continue;

    const sorted = [...items].sort((a, b) => a.no - b.no);
    let pityCounter = 0;

    for (const item of sorted) {
      pityCounter++;
      const rarity   = item.rarity + 1; // rng.moe 2/3/4 → our 3/4/5
      const { name, type } = resolveItem(item.id);
      const time     = msToZzzTime(item.timestamp);
      // 50/50 only tracked on Exclusive (character) and W-Engine banners
      const won5050  = (rarity === 5 && banner !== 'standard' && banner !== 'bangboo')
        ? (RNGMOE_TO_WON5050[item.result] ?? null)
        : null;

      pullLog.push({
        id:       String(item.uid ?? ''),
        name, type, rarity, banner,
        bannerName: null,
        time,
        roll:     null,
        pity:     pityCounter,
        won5050,
        source:   'json',
        verified: true,
      });

      if (rarity === 5) pityCounter = 0;
      counts[banner] = (counts[banner] ?? 0) + 1;
      totalImported++;
    }
  }

  return { pullLog, totalImported, counts };
}

// ─────────────────────────────────────────────────────────────────────────────

function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

function buildApiEntries(apiPulls, banner, existingBannerPulls = []) {
  const sorted = [...apiPulls].sort(compareTimeThenId);

  let pityCounter = 0;
  const existingSorted = [...existingBannerPulls].sort(compareTimeThenId);
  for (let i = existingSorted.length - 1; i >= 0; i--) {
    if (existingSorted[i].rarity === 5) break;
    pityCounter++;
  }

  return sorted.map(pull => {
    pityCounter++;
    const rarity  = parseInt(pull.rank_type, 10) + 1; // API: 2/3/4 (B/A/S) → internal: 3/4/5
    const itemId  = parseInt(pull.item_id, 10);
    let type;
    // 12xxx = common 3-star W-Engine fodder, 13xxx/14xxx = real 4/5-star
    // W-Engines, 53xxx+ = Bangboo. Confirmed against a real account's
    // synced data (see resolveItem() above, same fix applied there) — the
    // previous ranges had weapon (13xxx/14xxx) and bangboo (53xxx+) backwards.
    if (itemId >= 53000)      type = 'bangboo';
    else if (itemId >= 12000) type = 'weapon';
    else                      type = 'character';     // 1xxx agents
    const entry  = {
      id:       pull.id,
      name:     pull.name,
      type,
      rarity,
      banner,
      time:     pull.time,
      roll:     null,
      pity:     pityCounter,
      won5050:  undefined,
      source:   'api',
      verified: true,
    };
    if (rarity === 5) pityCounter = 0;
    return entry;
  });
}

export function processZzzApiPulls(
  charApiPulls, weaponApiPulls, standardApiPulls = [], bangbooApiPulls = [],
  existingLog = [],
) {
  const byBanner = {};
  for (const p of existingLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }
  for (const k of Object.keys(byBanner)) {
    byBanner[k].sort(compareTimeThenId);
  }

  const charLog    = buildApiEntries(charApiPulls,    'character', byBanner['character'] ?? []);
  const weaponLog  = buildApiEntries(weaponApiPulls,  'weapon',    byBanner['weapon']    ?? []);
  const standardLog = buildApiEntries(standardApiPulls, 'standard', byBanner['standard'] ?? []);
  const bangbooLog  = buildApiEntries(bangbooApiPulls,  'bangboo',  byBanner['bangboo']  ?? []);

  return {
    pullLog:    [...charLog, ...weaponLog, ...standardLog, ...bangbooLog],
    charPity:   derivePityFromLog(charLog),
    weaponPity: derivePityFromLog(weaponLog),
  };
}

// ─── API pull enrichment ──────────────────────────────────────────────────────

function toUTC8Zzz(timeStr, serverOffset) {
  if (!timeStr || serverOffset === 8) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - serverOffset, mi, s);
  const dt    = new Date(utcMs + 8 * 3_600_000);
  const p     = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth()+1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

function slugKeyZzz(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function featuredIncludesZzz(bannerObj, nameKey) {
  const raw = bannerObj.featured;
  if (!raw) return false;
  if (Array.isArray(raw)) return raw.some(f => slugKeyZzz(f) === nameKey);
  return slugKeyZzz(raw) === nameKey;
}

// For every API-sourced pull missing bannerName, won5050, version, or featuredId,
// derive those fields from the ZZZ banner schedule.
//
// bannerSchedule entries: { type, name, featured, start, end, version, featuredId }
//   type: 'character' | 'weapon' (matches pull.banner)
//   start/end: "YYYY-MM-DD HH:MM:SS" in UTC+8
//
// serverOffset: game server's UTC offset (Asia=8, America=-5, Europe=1).
export function enrichZzzApiPulls(pullLog, bannerSchedule = [], serverOffset = 8) {
  if (!bannerSchedule?.length || !pullLog?.length) return pullLog ?? [];

  function findBanner(pull) {
    const t8 = toUTC8Zzz(pull.time, serverOffset);
    const candidates = bannerSchedule.filter(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end,
    );
    if (pull.rarity === 5) {
      const nk = slugKeyZzz(pull.name);
      // Prefer any time-window banner that features this character.
      const specific = candidates.find(b => featuredIncludesZzz(b, nk));
      if (specific) return specific;
      // No time-window featured match — search all banners by name.
      // Handles: (a) timezone mismatch putting the pull outside the window,
      // (b) multiple concurrent banners where none happens to feature this char.
      const byName = bannerSchedule.filter(b =>
        b.type === pull.banner && featuredIncludesZzz(b, nk)
      );
      if (byName.length > 0) {
        const pt = new Date(t8.replace(' ', 'T'));
        byName.sort((a, b) => {
          const da = Math.min(
            Math.abs(new Date(a.start.replace(' ', 'T')) - pt),
            Math.abs(new Date(a.end.replace(' ', 'T'))   - pt),
          );
          const db = Math.min(
            Math.abs(new Date(b.start.replace(' ', 'T')) - pt),
            Math.abs(new Date(b.end.replace(' ', 'T'))   - pt),
          );
          return da - db;
        });
        return byName[0];
      }
    }
    return candidates[0] ?? null;
  }

  const sorted = [...pullLog].sort(compareTimeThenId);
  const lastResult  = {};
  const enrichedMap = new Map();

  for (const pull of sorted) {
    let bannerObj     = null;
    let newBannerName = pull.bannerName ?? null;
    let newWon5050    = pull.won5050    ?? null;
    let newVersion    = pull.version    ?? null;
    let newFeaturedId = pull.featuredId ?? null;

    if (pull.source === 'api') {
      if (!newBannerName) {
        bannerObj     = findBanner(pull);
        newBannerName = bannerObj?.name ?? null;
      }

      bannerObj = bannerObj ?? findBanner(pull);
      if (bannerObj) {
        if (newVersion    == null) newVersion    = bannerObj.version    ?? null;
        if (newFeaturedId == null) newFeaturedId = bannerObj.featuredId ?? null;
      }

    }

    // Compute won5050 for all 5-star limited-banner pulls regardless of source.
    // Standard pool item → lost. Otherwise: previous was lost → guaranteed, else → won.
    if (pull.rarity === 5 &&
        pull.banner !== 'standard' && pull.banner !== 'bangboo') {
      if (isZzzStandardAt(pull.name, toUTC8Zzz(pull.time, serverOffset))) {
        newWon5050 = 'lost';
      } else {
        newWon5050 = lastResult[pull.banner] === 'lost' ? 'guaranteed' : 'won';
      }
    }

    if (pull.rarity === 5) {
      const result = newWon5050 ?? pull.won5050;
      if (result != null) lastResult[pull.banner] = result;
    }

    enrichedMap.set(pull, { bannerName: newBannerName, won5050: newWon5050, version: newVersion, featuredId: newFeaturedId });
  }

  const result = pullLog.map(pull => {
    const { bannerName: nb, won5050: n5, version: nv, featuredId: nf } = enrichedMap.get(pull) ?? {};
    if (nb === pull.bannerName && n5 === pull.won5050 && nv === pull.version && nf === pull.featuredId) return pull;
    return { ...pull, bannerName: nb, won5050: n5, version: nv, featuredId: nf };
  });
  return result.every((p, i) => p === pullLog[i]) ? pullLog : result;
}
