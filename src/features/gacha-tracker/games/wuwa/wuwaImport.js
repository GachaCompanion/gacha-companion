// Wuthering Waves (Kuro Games) gacha record processing.
// Kuro's API cardPoolType: 1 = Featured Resonator (character), 2 = Featured
// Weapon, 3 = Standard Resonator, 4 = Standard Weapon. Unlike miHoYo's API,
// each record already carries its own cardPoolType/resourceType — no
// gacha_type remap or standard-pool name lookup is needed to classify pulls.

import { compareTimeThenId } from '../../engine/pullUtils';
import { isWuwaStandardAt } from './wuwaStandardPool';

export const WUWA_BANNER_LABELS = {
  character: 'Featured Resonator',
  weapon:    'Featured Weapon',
  standard:  'Standard',
};

export const WUWA_ALL_BANNERS = ['character', 'weapon', 'standard'];

export const WUWA_CARD_POOL_TYPE = { character: 1, weapon: 2, standard: 3 };
// Standard Weapon (cardPoolType 4) folds into the same 'standard' bucket as
// Standard Resonator (3) — this app only tracks 3 banner buckets for WuWa
// (character/weapon/standard), same as the other games' standard pools.
// Fetched as a second call alongside WUWA_CARD_POOL_TYPE.standard in
// useWuwaSync.js — found missing entirely from the original sync (it only
// ever fetched cardPoolType 3), confirmed via a real wuwatracker.com export
// containing genuine cardPoolType 4 pulls that a from-scratch live sync
// would have silently never captured.
export const WUWA_STANDARD_WEAPON_CARD_POOL_TYPE = 4;

// Every known weapon name (mirrors electron/engine/wuwa/wuwaHistoryExport.js's
// NAME_TO_ID table — anything with an 8-digit resourceId there is a weapon).
// Used as the PRIMARY signal for type classification, in preference to Kuro's
// raw resourceType string: a real account produced a genuine weapon pull
// ("Celestial Spiral") whose resourceType didn't even contain the substring
// "weapon" in any casing, so string-matching on that unconfirmed field proved
// unreliable outright, not just case-sensitive. A misclassified type breaks
// this item's dedup id on every future sync, not just once, so known names
// are checked first; the resourceType heuristic below only covers items not
// yet in this list (e.g. newly released weapons).
// Sourced from ww.nanoka.cc's item database (game version 3.5), cross-checked
// against a real wuwatracker.com backup. Excludes Firstlight's Herald
// (unreleased), the "Projection: ..." series (Tower of Adversity/reward
// items, not gacha-pullable), Tyro/Training/Guardian weapons
// (beginner/novice-pool — not tracked by this app), and a handful of
// placeholder-named weapons on nanoka.cc whose real names aren't confirmed —
// same exclusions as electron/engine/wuwa/wuwaHistoryExport.js's NAME_TO_ID.
const KNOWN_WUWA_WEAPON_NAMES = new Set([
  // Broadblades
  'Broadblade of Night', 'Originite: Type I', 'Discord', 'Broadblade of Voyager',
  'Dauntless Evernight', 'Wildfire Mark', 'Ages of Harvest', 'Verdant Summit',
  'Lustrous Razor', 'Kumokiri', 'Thunderflare Dominion', 'Radiance Cleaver',
  'Waning Redshift', 'Autumntrace', 'Starfield Calibrator', 'Helios Cleaver',
  'Beguiling Melody', 'Aureate Zenith', 'Meditations on Mercy',

  // Swords
  'Sword of Night', 'Originite: Type II', 'Sword of Voyager', 'Commando of Conviction',
  'Unflickering Valor', 'Red Spring', 'Overture', 'Somnoire Anchor',
  'Blazing Brilliance', 'Emerald of Genesis', 'Lunar Cutter', "Defier's Thorn",
  "Bloodpact's Pledge", 'Laser Shearer', 'Feather Edge', 'Azure Oath',
  'Fables of Wisdom', 'Frostburn', 'Endless Collapse', 'Everbright Polestar',
  'Lumingloss', 'Emerald Sentence',

  // Pistols
  'Pistols of Night', 'Originite: Type III', 'Cadenza', 'Pistols of Voyager',
  'Lux & Umbra', 'Woodland Aria', 'The Last Dance', 'Static Mist',
  'Novaburst', 'Spectral Trigger', 'Spectrum Blaster', 'Phasic Homogenizer',
  'Undying Flame', 'Relativistic Jet', 'Thunderbolt', 'Skull Thrasher',
  'Solar Flame', 'Romance in Farewell',

  // Gauntlets
  'Gauntlets of Night', 'Originite: Type IV', 'Marcato', 'Gauntlets of Voyager',
  'Amity Accord', 'Blazing Justice', 'Tragicomedy', "Verity's Handle",
  'Abyss Surges', 'Celestial Spiral', "Moongazer's Sigil", 'Pulsation Bracer',
  'Aether Strike', 'Legend of Drunken Hero', 'Stonard', 'Solsworn Ciphers',
  'Hollow Mirage', "Daybreaker's Spine",

  // Rectifiers
  'Rectifier of Night', 'Cosmic Ripples', 'Originite: Type V', 'Variation',
  'Rectifier of Voyager', 'Jinzhou Keeper', 'Comet Flare', 'Fusion Accretion',
  'Call of the Abyss', 'Stringmaster', "Ocean's Gift", 'Rime-Draped Sprouts',
  'Stellar Symphony', 'Luminous Hymn', 'Boson Astrolabe', 'Whispers of Sirens',
  'Lethean Elegy', 'Radiant Dawn', 'Waltz in Masquerade', 'Freeze Frame',
  'Forged Dwarf Star', 'Augment',
]);

// Looks up a name's type from the banner schedule (already kept current for
// bannerName/version/featuredId backfill elsewhere — see enrichWuwaApiPulls
// below), matching the same way: strip the schedule entry's "Base: Variant"
// name down to its base part and compare. A banner's featured item is
// obviously the same type as the banner itself (a weapon banner's featured
// item IS a weapon), so this catches any newly-released FEATURED item the
// moment it's added to the schedule — without needing a code change here —
// closing the gap for new content automatically. It can't help with
// STANDARD-POOL items (never featured on any banner, so never in the
// schedule); those still need KNOWN_WUWA_WEAPON_NAMES updated manually.
function bannerScheduleTypeFor(name, bannerSchedule) {
  if (!bannerSchedule?.length || !name) return null;
  const entry = bannerSchedule.find(b => baseNameOf(b.name) === name);
  return entry?.type ?? null;
}

// Normalizes Kuro's raw item to 'weapon'/'character'. Three tiers, most to
// least reliable: (1) the curated known-name list, (2) the banner schedule
// (auto-updates as new featured content releases), (3) a lenient
// case-insensitive substring check on resourceType — a last resort, since a
// real account produced a genuine weapon pull ("Celestial Spiral") whose
// resourceType didn't contain the substring "weapon" in any casing, proving
// that field alone isn't trustworthy.
function normalizeWuwaResourceType(item, bannerSchedule) {
  if (KNOWN_WUWA_WEAPON_NAMES.has(item?.name)) return 'weapon';
  const scheduleType = bannerScheduleTypeFor(item?.name, bannerSchedule);
  if (scheduleType === 'weapon' || scheduleType === 'character') return scheduleType;
  return String(item?.resourceType ?? '').trim().toLowerCase().includes('weapon') ? 'weapon' : 'character';
}

// Kuro's API has no persistent record id — this is the same synthetic
// dedup key used by the reference open-source client, stable across
// re-fetches since Kuro always returns full per-banner history.
//
// The type segment MUST be normalized to 'weapon'/'character' — NOT Kuro's
// raw resourceType string ("Weapon"/"Resonator") — because a
// wuwatracker.com-imported pull's id (built in parseWuwaTrackerJson below)
// normalizes the same way, deriving type from resourceId magnitude. Using
// the raw string here meant a live-synced pull's id NEVER matched the same
// real pull's id from an import (".../weapon" vs ".../Weapon"), so
// appendNewPulls could never recognize them as the same pull — every sync
// silently re-duplicated the entire imported history. Confirmed against a
// real account: 716 clean imported pulls became 1051 after one sync.
export function buildWuwaId(item, bannerSchedule) {
  const type = normalizeWuwaResourceType(item, bannerSchedule);
  return `${item.time}|${item.name}|${item.qualityLevel}|${type}`;
}

// A single 10-pull multi-pull can contain the same item (name+rarity) more
// than once at the EXACT same timestamp (Kuro stamps every item in one
// multi-pull with the same time) — confirmed against a real wuwatracker.com
// export, which had 88 colliding ids out of 643 pulls before this fix. Call
// this once per banner's sorted pull list to disambiguate: the first
// occurrence of a given base id keeps it as-is (so existing stored ids don't
// shift), any repeat gets a stable `#2`, `#3`, ... suffix based on order of
// appearance within this computation.
function dedupeIds(baseIds) {
  const seen = new Map();
  return baseIds.map(base => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}#${n}` : base;
  });
}

function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

// Kuro's raw API returns pull times in the account's own server-region clock,
// not necessarily UTC+8 — unlike a wuwatracker.com import, whose real-UTC
// times get shifted to UTC+8 on import (see isoToWuwaTime below). Mixing
// unconverted API times with UTC+8 import times for the same real pull gives
// them different `time` values, so the time-embedded dedup id never matches
// and appendNewPulls inserts a duplicate. Confirmed via a real account: the
// same 10-pull was stored twice, 7 hours apart, exactly matching a UTC+1
// server clock vs the UTC+8 timeline the rest of the log assumes.
//
function shiftWuwaApiTime(timeStr, hours) {
  if (!hours) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]  = date.split('-').map(Number);
  const [h, mi, s] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, h + hours, mi, s));
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

// Fix: derive the account's real clock offset empirically once per sync, per
// BANNER (each is an independent gacha history with its own timeline).
//
// This does NOT assume the API's earliest returned pull is the same real
// event as the import's earliest pull — Kuro's Convene History API is
// believed to have a retention window (like other gacha APIs' record
// endpoints), so an account with more history than that window covers would
// have its API-earliest pull be much MORE RECENT than the import's true
// earliest pull, breaking any anchor scheme that assumes both start at the
// same point.
//
// Instead: take a handful of the API's OWN earliest-returned pulls (whatever
// they are) as candidates, and for every whole-hour offset in the full
// real-world UTC range (-14..+14), count how many candidates land on an
// EXACT (name + rarity + shifted-time) match against the existing imported
// log for this banner. The correct offset should align most/all candidates;
// a wrong offset should align at most one by pure coincidence — common
// filler items recur often enough that a single match isn't enough evidence,
// so a real derived offset requires several independent corroborating hits.
// If nothing clears that bar (e.g. the import itself doesn't reach back far
// enough to overlap the API's returned window at all), fall back to 0 rather
// than risk applying a wrong multi-day shift.
//
// Earlier versions anchored on "the import's absolute earliest pull" (broken
// by any retention window) and searched across all 4 banners combined or in
// the API's raw response order (ambiguous — confirmed on a real account to
// derive offsets ~630 days and ~469 days wrong from common filler-item
// collisions) before landing on this per-banner, multi-candidate-vote design.
function deriveWuwaServerOffsetHoursForBanner(existingLog, anchorFilter, apiPulls) {
  const anchors = (existingLog ?? []).filter(p => p.source === 'json' && p.time && anchorFilter(p));
  if (!anchors.length || !apiPulls?.length) return 0;

  const byNameRarity = new Map();
  for (const p of anchors) {
    const key = `${p.name}|${p.rarity}`;
    if (!byNameRarity.has(key)) byNameRarity.set(key, new Set());
    byNameRarity.get(key).add(p.time);
  }

  const sortedApi = [...apiPulls].sort((a, b) => a.time.localeCompare(b.time));
  const candidates = sortedApi.slice(0, 10);

  let bestOffset = 0;
  let bestScore  = 0;
  for (let h = -14; h <= 14; h++) {
    let score = 0;
    for (const p of candidates) {
      const times = byNameRarity.get(`${p.name}|${p.qualityLevel}`);
      if (times?.has(shiftWuwaApiTime(p.time, h))) score++;
    }
    if (score > bestScore) { bestScore = score; bestOffset = h; }
  }

  const requiredVotes = Math.min(3, candidates.length);
  return bestScore >= requiredVotes ? bestOffset : 0;
}

function buildApiEntries(apiPulls, banner, poolType = null, bannerSchedule = []) {
  const sorted = [...apiPulls].sort((a, b) => a.time.localeCompare(b.time));
  const ids    = dedupeIds(sorted.map(item => buildWuwaId(item, bannerSchedule)));

  let pityCounter = 0;
  return sorted.map((item, i) => {
    pityCounter++;
    const rarity = parseInt(item.qualityLevel, 10);
    const type   = normalizeWuwaResourceType(item, bannerSchedule);
    const entry  = {
      id:       ids[i],
      name:     item.name,
      type,
      rarity,
      banner,
      ...(poolType !== null && { poolType }),
      time:     item.time,
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

export function processWuwaApiPulls(charApiPulls, weaponApiPulls, standardResonatorApiPulls = [], standardWeaponApiPulls = [], existingLog = [], bannerSchedule = []) {
  // Each banner (and each standard sub-pool) is an independent gacha history
  // with its own clock-offset anchor — derived separately so one banner's
  // filler-item ambiguity can't bleed into another's offset.
  const shiftWith = (list, hours) => hours
    ? list.map(p => ({ ...p, time: shiftWuwaApiTime(p.time, hours) }))
    : list;

  const offsetChar      = deriveWuwaServerOffsetHoursForBanner(existingLog, p => p.banner === 'character', charApiPulls);
  const offsetWeapon    = deriveWuwaServerOffsetHoursForBanner(existingLog, p => p.banner === 'weapon', weaponApiPulls);
  const offsetStandard3 = deriveWuwaServerOffsetHoursForBanner(existingLog, p => p.banner === 'standard' && (p.poolType ?? 3) === 3, standardResonatorApiPulls);
  const offsetStandard4 = deriveWuwaServerOffsetHoursForBanner(existingLog, p => p.banner === 'standard' && p.poolType === 4, standardWeaponApiPulls);

  const charLog          = buildApiEntries(shiftWith(charApiPulls, offsetChar),                          'character', null, bannerSchedule);
  const weaponLog        = buildApiEntries(shiftWith(weaponApiPulls, offsetWeapon),                       'weapon',    null, bannerSchedule);
  const standardLog      = buildApiEntries(shiftWith(standardResonatorApiPulls, offsetStandard3),         'standard', 3,    bannerSchedule);
  const standardWeapLog  = buildApiEntries(shiftWith(standardWeaponApiPulls, offsetStandard4),            'standard', 4,    bannerSchedule);

  return {
    pullLog:    [...charLog, ...weaponLog, ...standardLog, ...standardWeapLog],
    charPity:   derivePityFromLog(charLog),
    weaponPity: derivePityFromLog(weaponLog),
  };
}

// ─── wuwatracker.com JSON import ──────────────────────────────────────────────
// wuwatracker.com (https://wuwatracker.com/tracker) lets a user export their
// full pull history as a flat JSON file. Confirmed shape from a real export:
//   { siteVersion, version, date, playerId,
//     pulls: [{ cardPoolType, resourceId, qualityLevel, name, time, isSorted, group }, ...] }
// Differences from Kuro's own raw API shape (KuroGachaItem):
//   - No `resourceType` field — character vs weapon is derived from
//     `resourceId` magnitude instead (confirmed against the real export:
//     character/Resonator ids are short, e.g. 1102-9999; weapon ids are
//     8-digit, e.g. 21010043 and up — consistent across all 4 cardPoolTypes,
//     since even the character convene banner drops 3-star weapon fillers).
//   - `time` is a real ISO-8601 timestamp with an explicit UTC offset
//     ("2026-05-05T22:52:10+00:00"), unlike Kuro's raw API's naive
//     "YYYY-MM-DD HH:MM:SS" string (ambiguous timezone). Reformatted here to
//     the naive string shape the rest of the pull log uses, using the literal
//     UTC digits as-is (no shift) — this is the most defensible choice given
//     Kuro's own raw-API time convention isn't independently confirmed either,
//     so no attempt is made to align the two beyond matching digit format.
//     Known limitation: a pull imported from here and the same pull later
//     re-synced live from Kuro's API may not dedup perfectly if the two
//     sources' time conventions actually differ — same class of imperfect
//     cross-source dedup the other games' file-importers already have.
//   - `isSorted`/`group`/`siteVersion`/`version`/`date` are wuwatracker's own
//     display/bookkeeping fields, not used here.
const WUWA_TRACKER_CARD_POOL_TO_BANNER = { 1: 'character', 2: 'weapon', 3: 'standard', 4: 'standard' };

// wuwatracker's export carries a real UTC offset ("+00:00"); the rest of the
// pull log (and the banner schedule, sourced from Kuro's own calendar) is
// UTC+8, so shift by +8h rather than passing the UTC digits through as-is.
function isoToWuwaTime(isoStr) {
  const d = new Date(new Date(isoStr).getTime() + 8 * 3_600_000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
       + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function parseWuwaTrackerJson(jsonText) {
  let raw;
  try { raw = JSON.parse(jsonText); }
  catch { throw new Error('Invalid JSON — could not parse file.'); }

  if (!Array.isArray(raw.pulls)) {
    throw new Error('This file does not look like a WuWa Tracker export (missing "pulls" array).');
  }

  const byBanner = {};
  for (const p of raw.pulls) {
    const banner = WUWA_TRACKER_CARD_POOL_TO_BANNER[p.cardPoolType];
    if (!banner) continue;
    (byBanner[banner] ??= []).push(p);
  }

  const pullLog = [];
  let totalImported = 0;
  const counts = { character: 0, weapon: 0, standard: 0 };

  for (const banner of Object.keys(byBanner)) {
    const sorted = [...byBanner[banner]].sort((a, b) => a.time.localeCompare(b.time));
    const times  = sorted.map(item => isoToWuwaTime(item.time));
    const ids    = dedupeIds(sorted.map((item, i) => {
      const type = item.resourceId < 100000 ? 'character' : 'weapon';
      return `${times[i]}|${item.name}|${item.qualityLevel}|${type}`;
    }));

    let pityCounter = 0;
    sorted.forEach((item, i) => {
      pityCounter++;
      const rarity = item.qualityLevel;
      const type   = item.resourceId < 100000 ? 'character' : 'weapon';

      pullLog.push({
        id:       ids[i],
        name:     item.name,
        type,
        rarity,
        banner,
        ...(banner === 'standard' && { poolType: item.cardPoolType }),
        bannerName: null,
        time:     times[i],
        roll:     null,
        pity:     pityCounter,
        won5050:  null,
        source:   'json',
        verified: true,
      });

      if (rarity === 5) pityCounter = 0;
      counts[banner] = (counts[banner] ?? 0) + 1;
      totalImported++;
    });
  }

  const charPity   = derivePityFromLog(pullLog.filter(p => p.banner === 'character'));
  const weaponPity = derivePityFromLog(pullLog.filter(p => p.banner === 'weapon'));

  return { pullLog, totalImported, counts, charPity, weaponPity };
}

// ─── API pull enrichment ──────────────────────────────────────────────────────
// Backfills bannerName/version/featuredId onto API-sourced pulls using
// banner-schedule-wuwa.json (see the data repo's wuwa/scripts/build.js), AND
// (separately, see the won5050 pass below) computes won5050 for character-
// banner 5-stars via wuwaStandardPool.js — the same kind of lookup table
// genshin/hsr build via *StandardPool.js. Weapon-banner pulls never get a
// won5050 value; WuWa's weapon banner has no 50/50 mechanic to begin with.
//
// Matching strategy: multiple character/weapon banners can be concurrently
// live within the same date window (confirmed via Kuro's own calendar — a
// single patch regularly runs 2+ simultaneous character banners), so a
// time-window match alone is ambiguous; name is the primary signal. But the
// schedule stores the combined "Base: Variant" display name (e.g. "Yangyang:
// Xuanling") while a pulled item's own name is presumed to be just the base
// character/weapon name (e.g. "Yangyang") — WuWa reruns/outfits don't change
// which underlying resonator you actually obtain. So matching strips the
// schedule entry's name down to its part before ":" and compares that
// against the pull's raw name, within the entry's time window.
function baseNameOf(fullName) {
  const idx = (fullName ?? '').indexOf(':');
  return idx === -1 ? fullName : fullName.slice(0, idx).trim();
}

function toUTC8Wuwa(timeStr, serverOffset) {
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

// bannerSchedule entries: { type, version, start, end, name, featured, featuredId }
//   type: 'character' | 'weapon' (matches pull.banner)
//   start/end: "YYYY-MM-DD HH:MM:SS", UTC+8 (Kuro's calendar is CN/Asia-server time)
//
// serverOffset: the pulling account's own server UTC offset (Asia=8,
// America=-5, Europe=1) — defaults to 8 since WuWa's global players are
// predominantly on Asia-adjacent-timed servers and no per-UID server-offset
// derivation exists yet for this game (see engine/uidUtils.js — no 'wuwa'
// case there; only affects pulls made near a banner's start/end boundary).
export function enrichWuwaApiPulls(pullLog, bannerSchedule = [], serverOffset = 8) {
  // Unlike bannerName backfill below, won5050 doesn't need bannerSchedule at
  // all — only require pullLog here, not bannerSchedule.length, so won5050
  // still gets computed even before/without the schedule being available.
  if (!pullLog?.length) return pullLog ?? [];

  function findBanner(pull) {
    const t8 = toUTC8Wuwa(pull.time, serverOffset);
    return bannerSchedule.find(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end &&
      baseNameOf(b.name) === pull.name,
    ) ?? null;
  }

  const bannerNameResult = bannerSchedule?.length
    ? pullLog.map(pull => {
        if (pull.bannerName) return pull;
        const banner = findBanner(pull);
        if (!banner) return pull;
        return { ...pull, bannerName: banner.name, version: banner.version ?? null, featuredId: banner.featuredId ?? null };
      })
    : pullLog;

  // won5050: character-banner 5-stars only — processed chronologically (not
  // in whatever order pullLog happens to be in) so the "a loss guarantees
  // the next featured hit" rule tracks correctly, same approach as
  // genshinImport.js/hsrImport.js. Recomputes even for pulls that already
  // have a won5050 value of null (the placeholder buildWuwaApiEntries used
  // to set unconditionally, back when this wasn't computed at all) — it
  // does NOT touch a pull that already has a real 'won'/'lost'/'guaranteed'
  // value (e.g. from a JSON import that already carried it).
  const sorted = [...bannerNameResult].sort(compareTimeThenId);
  let lastResult = null;
  const won5050Map = new Map();
  for (const pull of sorted) {
    if (pull.rarity !== 5 || pull.banner !== 'character') continue;
    let won5050 = pull.won5050 ?? null;
    if (won5050 == null) {
      won5050 = isWuwaStandardAt(pull.name, toUTC8Wuwa(pull.time, serverOffset))
        ? 'lost'
        : (lastResult === 'lost' ? 'guaranteed' : 'won');
    }
    won5050Map.set(pull, won5050);
    lastResult = won5050;
  }

  const result = bannerNameResult.map(pull => {
    if (pull.rarity !== 5 || pull.banner !== 'character') return pull;
    const won5050 = won5050Map.get(pull);
    if (won5050 === pull.won5050) return pull;
    return { ...pull, won5050 };
  });

  return result.every((p, i) => p === pullLog[i]) ? pullLog : result;
}
