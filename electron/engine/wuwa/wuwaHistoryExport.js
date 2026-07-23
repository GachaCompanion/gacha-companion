// Builds a wuwatracker.com-compatible JSON backup from our internal WuWa pull
// log. The format is a flat array of pull records — far simpler than HSR's
// .dat or ZZZ's rng.moe backup, so no stats reconstruction is needed.
//
// cardPoolType mapping (mirrors wuwaImport.js's WUWA_TRACKER_CARD_POOL_TO_BANNER
// in reverse):
//   character banner → 1 (Featured Resonator)
//   weapon banner    → 2 (Featured Weapon)
//   standard banner, type='character' → 3 (Standard Resonator)
//   standard banner, type='weapon'    → 4 (Standard Weapon)
// Pool 10 (Novice) and 12 are not tracked by this app and won't be exported.

// Sourced from ww.nanoka.cc's item database (game version 3.5), cross-checked
// against a real wuwatracker.com backup — confirmed IDs match exactly (e.g.
// 'Celestial Spiral': 21040084 on both). Deliberately excludes: unreleased
// items (Suisui, Firstlight's Herald); Rover (the player's own protagonist,
// obtained via story progression, never pullable through gacha); the
// "Projection: ..." series (Tower of Adversity/reward items, id prefix
// 8008xxxx, not part of any gacha pool); Tyro/Training/Guardian weapons
// (beginner/novice-pool items — this app doesn't track that pool at all);
// and a handful of placeholder-named weapons on nanoka.cc ("Sword#18" etc.)
// whose real names aren't confirmed.
const NAME_TO_ID = {
  // Resonators / Characters
  'Sanhua': 1102, 'Baizhi': 1103, 'Lingyang': 1104, 'Zhezhi': 1105, 'Youhu': 1106,
  'Carlotta': 1107, 'Hiyuki': 1108, 'Lucilla': 1109,
  'Chixia': 1202, 'Encore': 1203, 'Mortefi': 1204, 'Changli': 1205,
  'Brant': 1206, 'Lupa': 1207, 'Galbrena': 1208, 'Mornye': 1209,
  'Aemeath': 1210, 'Denia': 1211,
  'Calcharo': 1301, 'Yinlin': 1302, 'Yuanwu': 1303, 'Jinhsi': 1304,
  'Xiangli Yao': 1305, 'Augusta': 1306, 'Buling': 1307, 'Rebecca': 1308,
  'Yangyang': 1402, 'Aalto': 1403, 'Jiyan': 1404, 'Jianxin': 1405,
  'Ciaccona': 1407, 'Cartethyia': 1409, 'Iuno': 1410, 'Qiuyuan': 1411,
  'Sigrika': 1412,
  'Verina': 1503, 'Lumi': 1504, 'Shorekeeper': 1505, 'Phoebe': 1506,
  'Zani': 1507, 'Chisa': 1508, 'Lynae': 1509, 'Luuk Herssen': 1510,
  'Lucy': 1511,
  'Taoqi': 1601, 'Danjin': 1602, 'Camellya': 1603, 'Roccia': 1606,
  'Cantarella': 1607, 'Phrolova': 1608, 'Yangyang: Xuanling': 1610,

  // Broadblades
  'Broadblade of Night': 21010013, 'Originite: Type I': 21010023,
  'Discord': 21010024, 'Broadblade of Voyager': 21010043,
  'Dauntless Evernight': 21010044, 'Wildfire Mark': 21010036,
  'Ages of Harvest': 21010026, 'Verdant Summit': 21010016,
  'Lustrous Razor': 21010015, 'Kumokiri': 21010056,
  'Thunderflare Dominion': 21010046, 'Radiance Cleaver': 21010045,
  'Waning Redshift': 21010084, 'Autumntrace': 21010074,
  'Starfield Calibrator': 21010066, 'Helios Cleaver': 21010064,
  'Beguiling Melody': 21010063, 'Aureate Zenith': 21010104,
  'Meditations on Mercy': 21010094,

  // Swords
  'Sword of Night': 21020013, 'Originite: Type II': 21020023,
  'Sword of Voyager': 21020043, 'Commando of Conviction': 21020044,
  'Unflickering Valor': 21020036, 'Red Spring': 21020026,
  'Overture': 21020024, 'Somnoire Anchor': 21020017,
  'Blazing Brilliance': 21020016, 'Emerald of Genesis': 21020015,
  'Lunar Cutter': 21020064, 'Defier\'s Thorn': 21020056,
  'Bloodpact\'s Pledge': 21020046, 'Laser Shearer': 21020045,
  'Feather Edge': 21020104, 'Azure Oath': 21020096,
  'Fables of Wisdom': 21020094, 'Frostburn': 21020086,
  'Endless Collapse': 21020084, 'Everbright Polestar': 21020076,
  'Lumingloss': 21020074, 'Emerald Sentence': 21020066,

  // Pistols
  'Pistols of Night': 21030013, 'Originite: Type III': 21030023,
  'Cadenza': 21030024, 'Pistols of Voyager': 21030043,
  'Lux & Umbra': 21030036, 'Woodland Aria': 21030026,
  'The Last Dance': 21030016, 'Static Mist': 21030015,
  'Novaburst': 21030064, 'Spectral Trigger': 21030056,
  'Spectrum Blaster': 21030046, 'Phasic Homogenizer': 21030045,
  'Undying Flame': 21030044, 'Relativistic Jet': 21030084,
  'Thunderbolt': 21030074, 'Skull Thrasher': 21030066,
  'Solar Flame': 21030104, 'Romance in Farewell': 21030094,

  // Gauntlets
  'Gauntlets of Night': 21040013, 'Originite: Type IV': 21040023,
  'Marcato': 21040024, 'Gauntlets of Voyager': 21040043,
  'Amity Accord': 21040044, 'Blazing Justice': 21040036,
  'Tragicomedy': 21040026, 'Verity\'s Handle': 21040016,
  'Abyss Surges': 21040015, 'Celestial Spiral': 21040084,
  'Moongazer\'s Sigil': 21040046, 'Pulsation Bracer': 21040045,
  'Aether Strike': 21040104, 'Legend of Drunken Hero': 21040094,
  'Stonard': 21040074, 'Solsworn Ciphers': 21040066,
  'Hollow Mirage': 21040064, 'Daybreaker\'s Spine': 21040056,

  // Rectifiers
  'Rectifier of Night': 21050013, 'Cosmic Ripples': 21050015,
  'Originite: Type V': 21050023, 'Variation': 21050024,
  'Rectifier of Voyager': 21050043, 'Jinzhou Keeper': 21050044,
  'Comet Flare': 21050064, 'Fusion Accretion': 21050084,
  'Call of the Abyss': 21050017, 'Stringmaster': 21050016,
  'Ocean\'s Gift': 21050027, 'Rime-Draped Sprouts': 21050026,
  'Stellar Symphony': 21050036, 'Luminous Hymn': 21050046,
  'Boson Astrolabe': 21050045, 'Whispers of Sirens': 21050056,
  'Lethean Elegy': 21050066, 'Radiant Dawn': 21050104,
  'Waltz in Masquerade': 21050094, 'Freeze Frame': 21050086,
  'Forged Dwarf Star': 21050076, 'Augment': 21050074,
};

// "YYYY-MM-DD HH:mm:ss" UTC+8 → "YYYY-MM-DDThh:mm:ss+00:00" (UTC)
function wuwaTimeToIso(timeStr) {
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - 8, mi, s);
  const dt    = new Date(utcMs);
  const p     = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
       + `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}+00:00`;
}

// A real wuwatracker.com export is NOT one globally time-interleaved stream —
// it's laid out as contiguous per-pool BLOCKS, each independently sorted
// descending by time: all 448 pool-1 pulls first, then all pool-2, then
// pool-3, then pool-4 (confirmed against a real 940-pull export — 6 contiguous
// blocks for pools [1, 2, 3, 4, 10, 12], each internally non-increasing by
// time). Interleaving all banners into one global time-sorted list (the
// earlier approach here) put entries in a completely different order than
// wuwatracker itself produces.
const POOL_TYPES = [
  { poolType: 1, filter: p => p.banner === 'character' },
  { poolType: 2, filter: p => p.banner === 'weapon' },
  { poolType: 3, filter: p => p.banner === 'standard' && (p.poolType ?? 3) === 3 },
  { poolType: 4, filter: p => p.banner === 'standard' && p.poolType === 4 },
];

// `group` is the pull's 1-indexed position within its multi-pull batch, counted
// DOWN from N (first item drawn) to 1 (last item drawn) — confirmed against a
// real wuwatracker.com export, where every pull sharing an exact timestamp
// carries a distinct group instead of a constant. Getting this wrong (e.g.
// stamping every pull with group:1) breaks wuwatracker's own dedup/validation.
//
// Our stored pull-log order for same-timestamp entries reflects the original
// draw sequence, so a stable ascending sort recovers that sequence; groups are
// assigned per timestamp bucket in that order, then the block is stably
// re-sorted descending (Array.sort is stable), which preserves each tied
// batch's internal group-descending order exactly as the real export does.
function buildPoolBlock(pulls, poolType, gaps) {
  const items = [];
  for (const pull of pulls) {
    const resourceId = NAME_TO_ID[pull.name];
    if (!resourceId) {
      gaps.push({ name: pull.name, banner: pull.banner, time: pull.time });
      continue;
    }
    items.push({
      cardPoolType: poolType,
      resourceId,
      qualityLevel: pull.rarity,
      name:         pull.name,
      time:         wuwaTimeToIso(pull.time),
      isSorted:     true,
      _sortTime:    pull.time,
    });
  }

  const ascending = [...items].sort((a, b) => a._sortTime.localeCompare(b._sortTime));
  const byTime = new Map();
  for (const item of ascending) {
    if (!byTime.has(item._sortTime)) byTime.set(item._sortTime, []);
    byTime.get(item._sortTime).push(item);
  }
  for (const batch of byTime.values()) {
    const n = batch.length;
    batch.forEach((item, idx) => { item.group = n - idx; });
  }

  const descending = [...ascending].sort((a, b) => b._sortTime.localeCompare(a._sortTime));
  return descending.map(({ _sortTime, ...rest }) => rest);
}

/**
 * Builds a wuwatracker.com-compatible JSON backup.
 * @param {Array}  pullLog  Internal pull log (all banners).
 * @param {string} uid      Player UID string.
 * @returns {{ backup: object, gaps: Array }}
 */
function buildWuwaTrackerExport(pullLog, uid) {
  const gaps  = [];
  const pulls = [];

  for (const { poolType, filter } of POOL_TYPES) {
    pulls.push(...buildPoolBlock(pullLog.filter(filter), poolType, gaps));
  }

  return {
    backup: {
      siteVersion: 'v4.8.15',
      version:     '0.0.2',
      date:        new Date().toISOString(),
      playerId:    String(uid),
      pulls,
    },
    gaps,
  };
}

module.exports = { buildWuwaTrackerExport };
