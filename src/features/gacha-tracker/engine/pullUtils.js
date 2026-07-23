// ─── Shared pull log utilities ────────────────────────────────────────────────
// Game-agnostic helpers used by all games that have a pull/gacha log.
// Genshin-specific logic lives in ./genshin/genshinImport.js
// HSR-specific logic lives in ./hsr/hsrImport.js

// ─── Time+id ordering ──────────────────────────────────────────────────────

// A single 10-pull multi-pull shares ONE timestamp across all 10 entries —
// sorting by time alone leaves those ties in whatever order the array
// already happened to be in, which is NOT stable across re-sorts: this log
// gets rebuilt via many merge/sync/import operations over its lifetime, and
// each one can hand back the tied entries in a different order, silently
// reshuffling which specific pull lands at which roll/pity position.
// Confirmed against a real account's data compared to Paimon.moe's export:
// same-timestamp batches showed the same 10 items in a DIFFERENT order,
// producing 2700+ downstream roll/pity mismatches despite the underlying
// pull data itself being complete and correct.
//
// `id` (the raw API's own per-pull identifier) is a reliable tiebreak for
// games where it's a genuinely monotonic numeric value assigned in true
// pull order (confirmed for genshin/hsr/zzz's miHoYo-style ids — sorting a
// tied batch by ascending id exactly reproduced Paimon.moe's own order).
// BigInt is used because these ids exceed JS's safe integer range. Falls
// back to leaving the pair unordered (returns 0) when either id is missing
// (Excel-imported entries have none) or non-numeric (e.g. WuWa's composite
// string ids, NTE's "fork_x" arc keys aren't meant to be ordered this way)
// — so this only ever ADDS correct tie-breaking for the games it applies
// to, never misorders something that was already fine for others.
export function compareTimeThenId(a, b) {
  const timeCmp = (a.time ?? '').localeCompare(b.time ?? '');
  if (timeCmp !== 0) return timeCmp;
  if (a.id == null || b.id == null) return 0;
  try {
    const idA = BigInt(a.id);
    const idB = BigInt(b.id);
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  } catch {
    return 0;
  }
}

// ─── Roll number recomputation ────────────────────────────────────────────────

// Recomputes roll numbers for every entry in the pull log.
// Within each banner type, pulls are sorted by time ascending (falling back
// to id for same-timestamp ties — see compareTimeThenId) and numbered
// sequentially from 1.
// Always call this as the final step after any operation that changes the log.
export function recomputeRolls(pullLog) {
  if (!pullLog?.length) return pullLog ?? [];

  // Group by banner type (object references preserved — no copies yet)
  const byBanner = {};
  for (const p of pullLog) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }

  // Sort each group chronologically and record roll number in a Map keyed by
  // object reference so identical timestamps don't collide across banners.
  const rollMap = new Map();
  for (const pulls of Object.values(byBanner)) {
    pulls
      .slice()
      .sort(compareTimeThenId)
      .forEach((p, i) => rollMap.set(p, i + 1));
  }

  return pullLog.map(p => ({ ...p, roll: rollMap.get(p) ?? null }));
}

// ─── Replace-by-banner merge ──────────────────────────────────────────────────

// Replaces all existing entries for the specified banners with the incoming set.
// Entries from other banners (or other sources) are preserved.
// Used for file imports where incoming data is authoritative for those banners.
export function replaceBannerPulls(existing, incoming, bannersToReplace) {
  const kept = (existing ?? []).filter(p => !bannersToReplace.includes(p.banner));
  return [...kept, ...(incoming ?? [])];
}

// ─── Preserve newer API pulls across imports ──────────────────────────────────

// When a file is imported, it replaces the stored log for its banners.
// Any API-synced pulls that are NEWER than the import's latest entry for a given
// banner would be silently deleted — but those are exactly the recent pulls the
// user synced because the export hadn't caught up yet.
//
// This function scans existingLog for source:'api' entries that sit beyond the
// import's coverage window and appends them to importedLog so they survive.
// If the import has no data for a banner at all, every API pull for that banner
// is kept (the import doesn't cover it, so nothing should be dropped).
// Roll numbers for the kept entries are fixed by recomputeRolls() afterwards.
export function preserveNewerApiPulls(existingLog, importedLog) {
  const latestImported = {};
  for (const p of (importedLog ?? [])) {
    if (!latestImported[p.banner] || p.time > latestImported[p.banner]) {
      latestImported[p.banner] = p.time;
    }
  }
  const toKeep = (existingLog ?? []).filter(p => {
    if (p.source !== 'api') return false;
    const latest = latestImported[p.banner];
    // Keep if: no import coverage for this banner, OR pull is strictly newer
    return !latest || p.time > latest;
  });
  return toKeep.length > 0 ? [...(importedLog ?? []), ...toKeep] : (importedLog ?? []);
}

// ─── Append-new-pulls merge ───────────────────────────────────────────────────

// Adds only pulls not already present in the existing log.
//
// Primary dedup: by API pull id. If the incoming pull has an unknown id AND the
// existing log has ids for that banner, the pull is new — include regardless of
// timestamp (catches id-gaps between batches via SYNC_LOOKBACK).
//
// Fallback — existing has no ids for that banner (Excel import without DEV column):
//   - Pulls strictly newer than the latest existing timestamp: always include.
//   - Pulls at or before the latest timestamp: count-based excess — if the API
//     returns more pulls at a given timestamp than existing already holds, the
//     extra ones are a missed batch → include them.
export function appendNewPulls(existing, incoming) {
  const latestByBanner  = {};
  const existingIds     = new Set();
  const bannerHasIds    = {};
  const existCountByKey = {};   // "banner|time" → count of existing pulls

  for (const p of (existing ?? [])) {
    if (!latestByBanner[p.banner] || p.time > latestByBanner[p.banner])
      latestByBanner[p.banner] = p.time;
    if (p.id) {
      existingIds.add(p.id);
      bannerHasIds[p.banner] = true;
    }
    const k = `${p.banner}|${p.time}`;
    existCountByKey[k] = (existCountByKey[k] ?? 0) + 1;
  }

  const incomCountByKey = {};
  for (const p of (incoming ?? [])) {
    const k = `${p.banner}|${p.time}`;
    incomCountByKey[k] = (incomCountByKey[k] ?? 0) + 1;
  }
  const addedByKey = {};

  const newPulls = (incoming ?? []).filter(p => {
    if (p.id && existingIds.has(p.id)) return false;        // already have by id → skip
    const latest = latestByBanner[p.banner];
    if (!latest) return true;                               // no existing for this banner
    if (p.time > latest) return true;                      // strictly newer → include
    if (p.id && bannerHasIds[p.banner]) return true;       // unknown id, existing has ids → new
    // No ids in existing for this banner: count-based excess at this timestamp.
    const k = `${p.banner}|${p.time}`;
    const excess = Math.max(0, (incomCountByKey[k] ?? 0) - (existCountByKey[k] ?? 0));
    if ((addedByKey[k] ?? 0) < excess) { addedByKey[k] = (addedByKey[k] ?? 0) + 1; return true; }
    return false;
  });

  return [...(existing ?? []), ...newPulls];
}

// ─── Income history (day-by-day ledger) ───────────────────────────────────
// Shared by the Status tabs of every game with a day-by-day "History" ledger
// (Genshin/HSR/ZZZ's shared StatusTab in GameDashboard.js, and NTE/WuWa's own
// Status tabs) — each `state.history` entry is `{date, income, pulls, total}`,
// one row per calendar day, read by HistoryTab.js's IncomeHistoryView.
import { getToday, getMostRecentDailyReset } from '../../../shared/utils/dateHelpers';

// Ensures today has an entry (appending one seeded from the last known total
// if not), without touching any existing entry.
export function withTodayEntry(history, defaultTotal) {
  const today = getToday();
  if (history.length > 0 && history[history.length - 1].date === today) return history;
  const lastTotal = history.length > 0 ? history[history.length - 1].total : (defaultTotal ?? 0);
  return [...history, { date: today, income: 0, pulls: 0, total: lastTotal }];
}

// Overwrites today's running total directly (used by "set value" edits,
// which aren't a delta and shouldn't bump income/pulls).
export function setTodayTotal(history, total) {
  const today = getToday();
  const h = withTodayEntry(history, total);
  return h.map(e => e.date === today ? { ...e, total } : e);
}

// Adds `delta` to today's `field` (income or pulls) and updates the total.
export function incrementTodayField(history, field, delta, total) {
  const today = getToday();
  const h = withTodayEntry(history, total);
  return h.map(e => e.date === today ? { ...e, [field]: (e[field] ?? 0) + delta, total } : e);
}

// ─── Daily Pass claim gating ───────────────────────────────────────────────
// The Daily Pass claim should only be clickable once per in-game day, using
// the same reset boundary as the History ledger's day grouping — see
// getMostRecentDailyReset/getToday in dateHelpers.js.

// Whether the Daily Pass claim button should currently be clickable.
// `lastClaimedAt` is an ISO timestamp string, or null/undefined if never
// claimed.
export function canClaimDailyPass(lastClaimedAt, now = new Date()) {
  if (!lastClaimedAt) return true;
  const last = new Date(lastClaimedAt);
  if (isNaN(last.getTime())) return true;
  return last < getMostRecentDailyReset(now);
}
