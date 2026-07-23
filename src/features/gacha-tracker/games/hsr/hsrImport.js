import { isHsrStandardAt } from './hsrStandardPool.js';
import { compareTimeThenId } from '../../engine/pullUtils.js';

// HSR-specific constants used by HistoryTab and GameSettingsModal.
// Parsing and 50/50 computation happen in electron/hsr/hsrParse.js (main process)
// because xlsx is bundled for main only.
// Shared pull log utilities live in ../pullUtils.js.

// Display labels for each HSR banner type
export const HSR_BANNER_LABELS = {
  character:    'Character',
  weapon:       'Light Cone',
  standard:     'Stellar',
  beginner:     'Departure',
  charCollab:   'Character Collab',
  weaponCollab: 'Light Cone Collab',
};

// Ordered list of banner type keys for HSR (no Chronicled banner).
// charCollab/weaponCollab (Saber/Archer, Rin Tohsaka/Gilgamesh, etc.) are a
// genuinely separate HoYoverse API category — gacha_type 21/22, served from
// a different endpoint (getLdGachaLog) than the normal 4 banners — not just
// a different gacha_type on the same endpoint. See project_hsr_dat_export
// memory for the full investigation.
export const HSR_ALL_BANNERS = ['character', 'weapon', 'standard', 'beginner', 'charCollab', 'weaponCollab'];

// ─── API pull processor ───────────────────────────────────────────────────────

function slugKey(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Count pulls since last 5-star in a processed entry array (chronological)
function derivePityFromLog(entries) {
  let pity = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].rarity === 5) break;
    pity++;
  }
  return pity;
}

// Convert HoYoverse API pull list (single banner type) to internal format.
// apiPulls is reverse-chronological (newest first); we sort it.
function buildApiEntries(apiPulls, banner, existingBannerPulls = []) {
  const sorted = [...apiPulls].sort(compareTimeThenId);

  // Pity offset: count pulls since the last 5-star in existing data
  let pityCounter = 0;
  const existingSorted = [...existingBannerPulls].sort(compareTimeThenId);
  for (let i = existingSorted.length - 1; i >= 0; i--) {
    if (existingSorted[i].rarity === 5) break;
    pityCounter++;
  }

  return sorted.map(pull => {
    pityCounter++;
    const rarity = parseInt(pull.rank_type, 10);
    // HSR returns item_type as "Character" / "Light Cone" (EN) or "角色" / "光锥" (CN)
    const type   = (pull.item_type === 'Character' || pull.item_type === '角色') ? 'character' : 'weapon';
    // item_id is mihoyo's own official numeric character/light cone ID —
    // straight from HoYoverse's wish-history API response, same ID
    // StarRailStation's own itemId refers to (see hsrParse.js's DEV column
    // extraction). Kept for hsrHistoryExport.js's .dat writer.
    const itemId = pull.item_id != null ? parseInt(pull.item_id, 10) : null;
    const entry  = {
      id:       pull.id,
      name:     pull.name,
      type,
      rarity,
      banner,
      time:     pull.time,
      roll:     null,     // set by recomputeRolls()
      pity:     pityCounter,
      won5050:  undefined,
      source:   'api',
      verified: true,
      itemId:   (itemId != null && !isNaN(itemId)) ? itemId : null,
    };
    if (rarity === 5) pityCounter = 0;
    return entry;
  });
}

// Build and return processed pull arrays from raw API results.
// Returns the same shape as genshinImport.processApiPulls (minus chronicled).
export function processHsrApiPulls(
  charApiPulls, weaponApiPulls, standardApiPulls = [], beginnerApiPulls = [],
  existingLog = [], charCollabApiPulls = [], weaponCollabApiPulls = [],
) {
  const byBanner = {};
  for (const p of existingLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }
  for (const k of Object.keys(byBanner)) {
    byBanner[k].sort(compareTimeThenId);
  }

  const charLog        = buildApiEntries(charApiPulls,        'character',    byBanner['character']    ?? []);
  const weaponLog       = buildApiEntries(weaponApiPulls,      'weapon',       byBanner['weapon']       ?? []);
  const standardLog     = buildApiEntries(standardApiPulls,    'standard',     byBanner['standard']     ?? []);
  const beginnerLog     = buildApiEntries(beginnerApiPulls,    'beginner',     byBanner['beginner']     ?? []);
  const charCollabLog   = buildApiEntries(charCollabApiPulls,  'charCollab',   byBanner['charCollab']   ?? []);
  const weaponCollabLog = buildApiEntries(weaponCollabApiPulls,'weaponCollab', byBanner['weaponCollab'] ?? []);

  return {
    pullLog: [...charLog, ...weaponLog, ...standardLog, ...beginnerLog, ...charCollabLog, ...weaponCollabLog],
    charPity:        derivePityFromLog(charLog),
    weaponPity:      derivePityFromLog(weaponLog),
    charCollabPity:  derivePityFromLog(charCollabLog),
    weaponCollabPity: derivePityFromLog(weaponCollabLog),
    totalImported: charApiPulls.length + weaponApiPulls.length + standardApiPulls.length + beginnerApiPulls.length
      + charCollabApiPulls.length + weaponCollabApiPulls.length,
    charCount:        charApiPulls.length,
    weaponCount:      weaponApiPulls.length,
    standardCount:    standardApiPulls.length,
    beginnerCount:    beginnerApiPulls.length,
    charCollabCount:  charCollabApiPulls.length,
    weaponCollabCount: weaponCollabApiPulls.length,
  };
}

// ─── API pull enrichment ──────────────────────────────────────────────────────

// Converts "YYYY-MM-DD HH:mm:ss" from server-local time to UTC+8.
// Offsets: Asia=+8, America=-5, Europe=+1 (fixed, no DST).
function toUTC8(timeStr, serverOffset) {
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

// Normalise featured list — handles both string (old cache) and array (new schema).
function featuredIncludes(bannerObj, nameKey) {
  const raw = bannerObj.featured;
  if (!raw) return false;
  if (Array.isArray(raw)) return raw.some(f => slugKey(f) === nameKey);
  return slugKey(raw) === nameKey;
}

// Featured names/IDs of collab banners that used to be (incorrectly) typed
// as ordinary 'character'/'weapon' in banner-schedule-hsr.json, back before
// they were retyped to 'charCollab'/'weaponCollab'. Their open-ended "runs
// forever" end date (real end date TBA) meant, for that window, ordinary
// character/weapon pulls could get misrouted onto them and permanently
// tagged with the wrong bannerName/featuredId/version — enrichment below
// only ever fills in MISSING fields, it never overwrites an already-set
// (even if wrong) one, so a pull contaminated during that window stays
// wrong forever unless explicitly cleared first. One-time cleanup, safe to
// run on every sync — it only clears the specific known-bad combination.
const KNOWN_MISTAGGED_FEATURED_IDS = [1014, 1015]; // Saber, Archer

function decontaminateMistaggedCollabPulls(pullLog) {
  let changed = false;
  const result = pullLog.map(pull => {
    if (pull.banner !== 'character' && pull.banner !== 'weapon') return pull;
    if (!KNOWN_MISTAGGED_FEATURED_IDS.includes(pull.featuredId)) return pull;
    changed = true;
    return { ...pull, bannerName: null, featuredId: null, version: null };
  });
  return changed ? result : pullLog;
}

// For every API-sourced pull missing bannerName, won5050, version, or featuredId,
// derive those fields from the stored HSR banner schedule.
//
// bannerSchedule entries: { type, name, featured, start, end, version, featuredId }
//   type:     'character' | 'weapon' (matches pull.banner)
//   featured: array of featured character/LC names (or legacy string)
//   start/end: "YYYY-MM-DD HH:MM:SS" in UTC+8
//
// serverOffset: game server's UTC offset (Asia=8, America=-5, Europe=1).
export function enrichHsrApiPulls(pullLog, bannerSchedule, serverOffset = 8) {
  if (!bannerSchedule?.length || !pullLog?.length) return pullLog ?? [];

  pullLog = decontaminateMistaggedCollabPulls(pullLog);

  function findBanner(pull) {
    const t8 = toUTC8(pull.time, serverOffset);
    const candidates = bannerSchedule.filter(b =>
      b.type === pull.banner && b.start && b.end &&
      t8 >= b.start && t8 <= b.end,
    );
    if (pull.rarity === 5) {
      const nk = slugKey(pull.name);
      // Prefer any time-window banner that features this character.
      const specific = candidates.find(b => featuredIncludes(b, nk));
      if (specific) return specific;
      // No time-window featured match — search all banners by name.
      // Handles: (a) timezone mismatch putting the pull outside the window,
      // (b) multiple concurrent banners where none happens to feature this char.
      const byName = bannerSchedule.filter(b =>
        b.type === pull.banner && featuredIncludes(b, nk)
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
    if (candidates.length <= 1) return candidates[0] ?? null;
    // Multiple overlapping candidates and no rarity-5 name match to
    // disambiguate — prefer the NARROWEST window. A normal ~3-week banner
    // phase should always win over an open-ended "runs forever" entry (e.g.
    // a permanent collab banner with no known end date) that would
    // otherwise overlap every date from its start onward and swallow
    // unrelated pulls. Mirrors hsrHistoryExport.js's
    // resolveFeaturedIdAndVersion — same bug, this is the renderer-side
    // sibling used for the app's own bannerName/featuredId tagging.
    return [...candidates].sort((a, b) => (new Date(a.end) - new Date(a.start)) - (new Date(b.end) - new Date(b.start)))[0];
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
    let newPhase      = pull.phase      ?? null;

    // Backfill bannerName/version/featuredId for ANY pull missing them,
    // regardless of source — this used to be gated to `source === 'api'`
    // only, which meant excel-imported pulls (StarRailStation's own export)
    // NEVER got version/featuredId populated at all, since they're not part
    // of that file format. That's harmless for a normal ~3-week banner
    // window (it still naturally limits matches to roughly that many real
    // pulls), but breaks badly for any schedule entry with a deliberately
    // wide/open-ended window (e.g. a permanent collab banner with an
    // unknown real end date) — with version always null, its date range
    // alone becomes the only thing that can match, swallowing thousands of
    // unrelated pulls. Real bug found via a live account: ALL 9410
    // character pulls had source:'excel' and featuredId/version always
    // null, confirmed via direct pullLog.json inspection.
    // 1. Backfill bannerName (only if genuinely missing — excel pulls
    //    already carry their own real bannerName from StarRailStation's
    //    own export, so this never overwrites that).
    if (!newBannerName) {
      bannerObj     = findBanner(pull);
      newBannerName = bannerObj?.name ?? null;
    }

    // 2. Attach version, featuredId, and phase. phase must travel alongside
    // version/featuredId — hsrHistoryExport.js's resolveGachaId only re-derives
    // phase via its own date-window fallback when featuredId/version are still
    // null; since this backfill now fills those in for every pull, a missing
    // phase here would silently break the gachaId table lookup key
    // ("type:featuredId:version:phase") for every non-fixed-gachaId banner.
    bannerObj = bannerObj ?? findBanner(pull);
    if (bannerObj) {
      if (newVersion    == null) newVersion    = bannerObj.version    ?? null;
      if (newFeaturedId == null) newFeaturedId = bannerObj.featuredId ?? null;
      if (newPhase      == null) newPhase      = bannerObj.phase      ?? null;
    }

    // 3. Compute won5050 for all 5-star limited-banner pulls regardless of source.
    // Standard pool item → lost. Otherwise: previous was lost → guaranteed, else → won.
    if (pull.rarity === 5 &&
        pull.banner !== 'standard' && pull.banner !== 'beginner') {
      if (isHsrStandardAt(pull.name, toUTC8(pull.time, serverOffset))) {
        newWon5050 = 'lost';
      } else {
        newWon5050 = lastResult[pull.banner] === 'lost' ? 'guaranteed' : 'won';
      }
    }

    if (pull.rarity === 5) {
      const result = newWon5050 ?? pull.won5050;
      if (result != null) lastResult[pull.banner] = result;
    }

    enrichedMap.set(pull, { bannerName: newBannerName, won5050: newWon5050, version: newVersion, featuredId: newFeaturedId, phase: newPhase });
  }

  const result = pullLog.map(pull => {
    const { bannerName: nb, won5050: n5, version: nv, featuredId: nf, phase: np } = enrichedMap.get(pull) ?? {};
    if (nb === pull.bannerName && n5 === pull.won5050 && nv === pull.version && nf === pull.featuredId && np === pull.phase) return pull;
    return { ...pull, bannerName: nb, won5050: n5, version: nv, featuredId: nf, phase: np };
  });
  return result.every((p, i) => p === pullLog[i]) ? pullLog : result;
}
