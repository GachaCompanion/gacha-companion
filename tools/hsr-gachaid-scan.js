/*
 * Scan StarRailStation's public warp_fetch API to build a lookup table of
 * their internal, private gachaId (banner-instance ID) for every HSR
 * character/light-cone banner — cross-referenced against our own official
 * banner-schedule-hsr.json so the table is keyed by something meaningful
 * (featuredId/version), not just a raw dump.
 *
 * Why this exists: our own HSR .dat export (hsrHistoryExport.js) needs a
 * real gachaId per pull to be importable back into StarRailStation. That ID
 * is StarRailStation's own private bookkeeping — no official source (not
 * mihoyo's API, not any game data file) exposes it. The only way to learn it
 * is to ask StarRailStation's own site. This script does that itself (our
 * own code, not a copy of any third-party tool) and writes a static table we
 * bundle/refresh periodically — the shipped app never calls this API live.
 *
 * Endpoint (public, unauthenticated, confirmed no API key needed):
 *   GET https://starrailstation.com/api/v1/warp_fetch/{id}
 *   -> { stats: { day, rateup, rerun, companion_banner_id, companion_rateup, ... } }
 *
 *   day:     a proleptic-Gregorian ordinal date (day 1 = 0000-01-01) — the
 *            same encoding Python's date.toordinal() and MATLAB's datenum
 *            use, offset by 366 from datenum. Converts to a real date via
 *            (day - 719163) days after the Unix epoch.
 *   rateup:  the featured item's real, official numeric ID (mihoyo's own
 *            character/light-cone ID — matches banner-schedule-hsr.json's
 *            own `featuredId` field exactly, and matches the live API's
 *            `item_id` field too).
 *
 * Banner-ID ranges (StarRailStation's own scheme, inferred from observation,
 * not returned by the API): 1001/4001/5001 = fixed singleton banners
 * (Stellar/Departure/special — never rotate); 2000-2999 = character event;
 * 3000-3999 = light cone event.
 *
 * Usage:
 *   node tools/hsr-gachaid-scan.js                  # scan + cross-reference, write table
 *   node tools/hsr-gachaid-scan.js --from 2000 --to 2200
 *   node tools/hsr-gachaid-scan.js --raw-only        # skip cross-ref, just dump raw scan cache
 *
 * No dependencies. Requires Node 18+ (global fetch).
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://starrailstation.com/api/v1/warp_fetch/';
const SCHEDULE_URL = 'https://raw.githubusercontent.com/GachaCompanion/gc-data/main/games/hsr/banner-schedule-hsr.json';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const OUT_DIR      = path.join(__dirname, 'out');
const RAW_CACHE    = path.join(OUT_DIR, 'hsr-gachaid-scan-raw.json');
const TABLE_OUT    = path.join(OUT_DIR, 'hsr-gachaid-table.json');

const CONCURRENCY   = 5;
const DELAY_MS      = 150; // between request batches — stay well clear of anything that looks like abuse
const MISS_STREAK_STOP = 40; // consecutive empty/error responses before assuming we've hit the frontier

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueAfter = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const ORDINAL_EPOCH_OFFSET = 719163; // proleptic-Gregorian ordinal for 1970-01-01

function ordinalDayToISODate(day) {
  if (day == null) return null;
  const ms = (day - ORDINAL_EPOCH_OFFSET) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function guessType(id) {
  if (id === 1001) return 'standard';
  if (id === 4001) return 'beginner';
  if (id === 5001) return 'special';
  if (id >= 2000 && id < 3000) return 'character';
  if (id >= 3000 && id < 4000) return 'weapon';
  return 'unknown';
}

async function fetchOne(id) {
  try {
    const res = await fetch(API_BASE + id, { headers: HEADERS });
    if (!res.ok) return null;
    const json = await res.json();
    const s = json?.stats;
    if (!s || s.rateup == null) return null;
    return {
      id,
      type:              guessType(id),
      day:               s.day ?? null,
      date:              ordinalDayToISODate(s.day),
      rateup:            s.rateup ?? null,
      rerun:             !!s.rerun,
      companionBannerId: s.companion_banner_id ?? null,
      companionRateup:   s.companion_rateup ?? null,
    };
  } catch (_) {
    return null;
  }
}

async function scanRange(from, to) {
  const results = {};
  let missStreak = 0;

  for (let start = from; start <= to; start += CONCURRENCY) {
    const batch = [];
    for (let id = start; id < Math.min(start + CONCURRENCY, to + 1); id++) batch.push(id);

    const settled = await Promise.all(batch.map(fetchOne));
    let batchHadHit = false;
    for (let i = 0; i < batch.length; i++) {
      const r = settled[i];
      if (r) { results[batch[i]] = r; batchHadHit = true; }
    }

    missStreak = batchHadHit ? 0 : missStreak + batch.length;
    process.stdout.write(`\rscanned up to ${Math.min(start + CONCURRENCY - 1, to)} (${Object.keys(results).length} hits)`);

    if (!has('--from') && missStreak >= MISS_STREAK_STOP) {
      console.log(`\nhit ${MISS_STREAK_STOP} consecutive misses — stopping (frontier reached)`);
      break;
    }
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  console.log('');
  return results;
}

function crossReference(raw, schedule) {
  // featuredId -> [{ name, type, version, start, end }] (a featuredId can
  // appear on multiple reruns, so keep every occurrence)
  const byFeaturedId = {};
  for (const b of schedule) {
    if (b.featuredId == null) continue;
    (byFeaturedId[b.featuredId] ??= []).push(b);
  }

  const table = {}; // "type:featuredId:version" -> gachaId
  const unmatched = [];

  for (const entry of Object.values(raw)) {
    if (entry.type !== 'character' && entry.type !== 'weapon') continue; // fixed singletons don't need mapping
    const candidates = byFeaturedId[entry.rateup];
    if (!candidates?.length) { unmatched.push(entry); continue; }

    // Prefer the schedule entry whose date window contains this banner's
    // observed date; fall back to nearest if none contain it exactly
    // (StarRailStation's `day` sometimes reflects the scrape date, not the
    // banner's true start, for very recent banners).
    let best = candidates.find(b => b.start && b.end && entry.date >= b.start.slice(0, 10) && entry.date <= b.end.slice(0, 10));
    if (!best) {
      best = [...candidates].sort((a, b) =>
        Math.abs(new Date(a.start) - new Date(entry.date)) - Math.abs(new Date(b.start) - new Date(entry.date)),
      )[0];
    }

    const key = `${entry.type}:${best.featuredId}:${best.version}:${best.phase ?? ''}`;
    table[key] = { gachaId: entry.id, bannerName: best.name, version: best.version, phase: best.phase ?? null };
  }

  return { table, unmatched };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let raw = {};
  if (fs.existsSync(RAW_CACHE) && !has('--fresh')) {
    raw = JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
    console.log(`loaded ${Object.keys(raw).length} cached entries from ${RAW_CACHE}`);
  }

  const from = has('--from') ? parseInt(valueAfter('--from'), 10) : 2000;
  const maxKnown = Math.max(0, ...Object.keys(raw).map(Number));
  const to = has('--to') ? parseInt(valueAfter('--to'), 10) : Math.max(maxKnown + 200, 2200);

  console.log(`scanning ${from}-${to}...`);
  const scanned = await scanRange(from, to);
  raw = { ...raw, ...scanned };

  fs.writeFileSync(RAW_CACHE, JSON.stringify(raw, null, 2));
  console.log(`wrote raw cache: ${RAW_CACHE} (${Object.keys(raw).length} total entries)`);

  if (has('--raw-only')) return;

  console.log('fetching banner-schedule-hsr.json for cross-reference...');
  const scheduleRes = await fetch(SCHEDULE_URL);
  const schedule = await scheduleRes.json();

  const { table, unmatched } = crossReference(raw, schedule);
  fs.writeFileSync(TABLE_OUT, JSON.stringify(table, null, 2));
  console.log(`wrote lookup table: ${TABLE_OUT} (${Object.keys(table).length} entries, ${unmatched.length} unmatched)`);
  if (unmatched.length) {
    console.log('unmatched entries (rateup id not found in banner-schedule-hsr.json):');
    for (const u of unmatched) console.log(`  ${u.id} (${u.type}) rateup=${u.rateup} date=${u.date}`);
  }
}

main();
