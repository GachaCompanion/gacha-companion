// ─── StarRailStation .dat backup patcher ──────────────────────────────────
//
// StarRailStation's "Export Backup" produces a .dat file that is their
// ENTIRE local app state — warp history, calculator/planner data, social
// data, profile metadata — not just pulls. There's no way to fabricate that
// whole file safely (we'd blank out unrelated features the user cares
// about), so this patches the warp-history section of the user's own most
// recent real backup instead of generating a file from scratch.
//
// File format: 3 ASCII bytes "srs" + the rest of the file is a JSON blob
// compressed with lz-string's compressToUTF16() and written as UTF-8 text.
// (Reverse-engineered by hand — confirmed against srs2srgf, a third-party
// StarRailStation→SRGF converter, which independently validates the same
// per-pull field shape we found: uid/itemId/timestamp/gachaType/gachaId/
// rarity/manual/pity4/pity5/pullNo/result/anchorItemId/sort.)
//
// gachaType per our banner: standard=1, beginner=2, character=11, weapon=12,
// charCollab=21, weaponCollab=22. The collab pair (Saber/Archer, Rin
// Tohsaka/Gilgamesh, etc.) is a genuinely separate HoYoverse API category
// (gacha_type 21/22, served from getLdGachaLog, not just a different code on
// the normal endpoint) — see project_hsr_dat_export memory for the full
// investigation. Confirmed live: gacha_type=21 responses carry
// `gacha_id: "5001"` directly, matching StarRailStation's own fixed,
// never-rotating collab gachaId (see FIXED_GACHA_ID below).
const GACHA_TYPE_FOR_BANNER = {
  standard: 1, beginner: 2, character: 11, weapon: 12,
  charCollab: 21, weaponCollab: 22,
};

const MAGIC = 'srs';

function decodeDat(buffer) {
  const LZString = require('lz-string');
  const text = buffer.subarray(3).toString('utf8');
  const json = LZString.decompressFromUTF16(text);
  if (json == null) throw new Error('Could not decompress this file — is it a real StarRailStation "Export Backup" .dat file?');
  const data = JSON.parse(json);
  if (!data?.data?.stores?.['1_warp-v2']) throw new Error('This .dat file has no warp-history section — is it a real StarRailStation backup?');
  return data;
}

function encodeDat(data) {
  const LZString = require('lz-string');
  const json = JSON.stringify(data);
  const compressed = LZString.compressToUTF16(json);
  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), Buffer.from(compressed, 'utf8')]);
}

// featuredId/version are only ever backfilled onto a pull by
// enrichHsrApiPulls, and only for API-synced pulls — Excel-imported pulls
// (the bulk of most accounts' real history) carry only `bannerName`, and
// that's StarRailStation's own poetic banner title (e.g. "Ripples in
// Reflection"), not a character name, so it can't be matched against
// gachaid-table.json directly either. This ports enrichHsrApiPulls's own
// findBanner() date-window technique so ANY pull — regardless of source —
// can be resolved: find the schedule entry of the right type whose
// start/end window contains the pull's own timestamp, preferring (for
// 5-star pulls, when more than one dual-banner candidate overlaps) the one
// whose featured list actually contains this pull's item name.
function resolveFeaturedIdAndVersion(pull, bannerSchedule) {
  if (!bannerSchedule?.length || !pull.time) return null;
  const candidates = bannerSchedule.filter(b =>
    b.type === pull.banner && b.start && b.end && pull.time >= b.start && pull.time <= b.end,
  );
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  if (pull.rarity === 5) {
    const featured = candidates.find(b => (Array.isArray(b.featured) ? b.featured : [b.featured]).includes(pull.name));
    if (featured) return featured;
  }
  // Prefer the narrowest overlapping window — a normal ~3-week banner phase
  // should always win over an open-ended "runs forever" entry (e.g. a
  // permanent collab banner with no known end date) that would otherwise
  // overlap every date from its start onward and swallow unrelated pulls.
  return [...candidates].sort((a, b) => (new Date(a.end) - new Date(a.start)) - (new Date(b.end) - new Date(b.start)))[0];
}

// Stellar Warp (standard) and Departure Warp (beginner) never rotate — every
// pull on them belongs to the same single, fixed gachaId forever (confirmed
// against a real backup: always 1001/4001 respectively). Our gachaId
// scanner only ever covers the rotating 2xxx/3xxx character/light-cone
// ranges, so these two would otherwise fall through to date-window
// resolution that doesn't meaningfully apply to a banner with no phases —
// hardcoding removes the ambiguity entirely instead of risking a wrong match.
// charCollab is the same story, confirmed live via the real gacha_type=21
// API response (`gacha_id: "5001"` on every record). weaponCollab's fixed ID
// is deliberately NOT guessed here — no light-cone-collab pulls have been
// observed yet to confirm it, so those pulls correctly fall through to
// gachaIdTable lookup (which has no entry either) and land in `gaps` rather
// than risk writing a wrong ID.
const FIXED_GACHA_ID = { standard: 1001, beginner: 4001, charCollab: 5001, weaponCollab: 6001 };

// Resolves the real gachaId for a pull via the pre-built lookup table
// (gc-data's games/hsr/gachaid-table.json), keyed the same way the scanner
// produces it: "type:featuredId:version:phase". Uses the pull's own
// featuredId/version if already present (API-synced, post-enrichment),
// otherwise derives them from the banner schedule by date window.
function resolveGachaId(pull, gachaIdTable, bannerSchedule) {
  if (FIXED_GACHA_ID[pull.banner] != null) return FIXED_GACHA_ID[pull.banner];

  let featuredId = pull.featuredId;
  let version    = pull.version;
  let phase      = pull.phase;

  if (featuredId == null || version == null) {
    const resolved = resolveFeaturedIdAndVersion(pull, bannerSchedule);
    if (!resolved) return null;
    featuredId = resolved.featuredId;
    version    = resolved.version;
    phase      = resolved.phase;
  }
  if (featuredId == null || version == null) return null;

  const key = `${pull.banner}:${featuredId}:${version}:${phase ?? ''}`;
  return gachaIdTable?.[key]?.gachaId ?? null;
}

// starrail.js ships its own bundled character/light-cone database
// (node_modules/starrail.js/cache/data/*.json — no network call, no
// first-run download) — a real, complete name→itemId source, unlike
// cross-referencing our own pull log which only works if some OTHER pull of
// the same item happens to already have its itemId recorded. Critical for
// one-time-only items (Departure Warp's fixed reward, never re-obtainable)
// where no such sibling pull can ever exist. Wrapped defensively: if the
// package's bundled data is ever missing/corrupt, fall back to pull-log-only
// resolution rather than fail the whole export.
function buildStarRailItemDatabase() {
  try {
    const { StarRail } = require('starrail.js');
    const client = new StarRail();
    const map = {};
    for (const c of client.getAllCharacters()) map[c.name.get('en').toString()] = c.id;
    for (const l of client.getAllLightCones()) map[l.name.get('en').toString()] = l.id;
    return map;
  } catch (_) {
    return {};
  }
}

// itemId is only reliably present on pulls synced/imported after the
// itemId/bannerId schema addition (see hsrParse.js/hsrImport.js) — older
// entries in an existing account's history have it as null. A missing
// itemId isn't a "leave it out" case like an unresolved gachaId: it's
// recoverable, because the same character/light cone always has the same
// itemId everywhere it appears. Building this once up front lets any pull
// missing its own itemId borrow one — first from any other pull of the same
// name in our own log, then from starrail.js's bundled database as a
// complete fallback for items with no such sibling pull.
function buildItemIdByName(pullLog) {
  const map = buildStarRailItemDatabase();
  for (const pull of pullLog) {
    if (pull.itemId != null) map[pull.name] = pull.itemId;
  }
  return map;
}

// Excel-imported pull.time is always already UTC+8 (hsrParse.js's
// serialToTimestamp bakes that conversion in unconditionally). API-synced
// pull.time is NOT — it's whatever the account's own game server reports
// (see hsrImport.js's buildApiEntries, which stores the raw API time
// untouched), so on a non-Asia server it can be hours off. That mismatch
// throws off both the banner date-window match (resolveFeaturedIdAndVersion)
// AND the chronological sort pity is computed from — normalizing once here,
// the same way enrichHsrApiPulls does for its own comparisons, fixes both.
function toUTC8(timeStr, serverOffset) {
  if (!timeStr || serverOffset === 8) return timeStr;
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, h - serverOffset, mi, s);
  const dt = new Date(utcMs + 8 * 3_600_000);
  const p  = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

// Turns our own pull-log entries into StarRailStation-shaped item
// *candidates* for one banner category — no pity4/pity5/pullNo/sort yet,
// those can only be computed correctly once merged against whatever
// pre-existing items the base backup already has (see mergeCategoryItems).
// Pulls whose gachaId OR itemId can't be resolved are pushed to `gaps` and
// excluded — a null itemId is what crashes StarRailStation's own item-detail
// lookup (confirmed live: "Cannot read properties of undefined (reading
// 'name')"), so it gets the same "leave it out rather than risk a broken
// record" treatment as an unresolved gachaId.
function buildCandidateItems(entries, gachaType, gachaIdTable, bannerSchedule, itemIdByName, serverOffset, gaps) {
  // Sorted by our own `roll` up front — multiple pulls in the same 1x/10x
  // batch share an identical timestamp, so this is the only thing that
  // preserves their correct within-batch order once merged (see
  // mergeCategoryItems).
  const sorted = [...entries].sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0));

  const candidates = [];
  for (const raw of sorted) {
    const pull = raw.source === 'api' ? { ...raw, time: toUTC8(raw.time, serverOffset) } : raw;

    const gachaId = resolveGachaId(pull, gachaIdTable, bannerSchedule);
    if (gachaId == null) { gaps.push({ ...pull, _gapReason: 'gachaId' }); continue; }

    const itemId = pull.itemId ?? itemIdByName[pull.name] ?? null;
    if (itemId == null) { gaps.push({ ...pull, _gapReason: 'itemId' }); continue; }

    candidates.push({
      uid:          pull.id ?? '',
      itemId,
      timestamp:    Date.parse(pull.time.replace(' ', 'T') + '+08:00'),
      gachaType,
      gachaId,
      rarity:       pull.rarity,
      manual:       false,
      // `result` is a real field in StarRailStation's schema whose exact
      // encoding we couldn't pin down (values 0/2/3/4 observed, meaning
      // unclear) — it appears to be a cosmetic/UI-filter flag, not something
      // that affects pity or banner assignment, so it's left at a safe
      // default rather than guessed at.
      result:       0,
      anchorItemId: '0',
    });
  }
  return candidates;
}

// Inverse of the timestamp computation in buildCandidateItems — needed to
// match a MERGED item (existing or new, both already carry a plain UTC ms
// timestamp) back against the banner schedule's UTC+8 date-window strings.
function msToUtc8String(ms) {
  const dt = new Date(ms + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())} `
       + `${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}`;
}

// Derives win/loss (rate-up "Win Rate") for EVERY 5-star item — existing or
// new — directly from itemId vs. the banner schedule's featuredId, instead
// of depending on our own pull log's won5050 tracking (which only ever
// covers pulls we ourselves added this round). Pre-existing items carried
// straight over from a real backup have no name/context of their own beyond
// raw IDs, so without this they'd silently be excluded from the win-rate
// stats — which is exactly what made "main" (99% pre-existing items) show a
// near-zero rate while "default" (100% freshly rebuilt from our own log,
// which does track this per pull) came out complete. Matching by itemId is
// simpler and more reliable than the name-based matching resolveGachaId
// needs, since both sides are already numeric IDs — no ambiguity to resolve.
const RATE_UP_BANNERS = ['character', 'weapon', 'charCollab', 'weaponCollab'];
function deriveWon5050(items, bannerSchedule, banner) {
  if (!RATE_UP_BANNERS.includes(banner)) return items; // no rate-up concept on standard/beginner
  let lastResult = null;
  return items.map(item => {
    if (item.rarity !== 5) return item;
    const timeStr = msToUtc8String(item.timestamp);
    const candidates = (bannerSchedule ?? []).filter(b =>
      b.type === banner && b.start && b.end && timeStr >= b.start && timeStr <= b.end,
    );
    const isFeatured = candidates.some(b => b.featuredId === item.itemId);
    const won5050 = !isFeatured ? 'lost' : (lastResult === 'lost' ? 'guaranteed' : 'won');
    lastResult = won5050;
    return { ...item, _won5050: won5050 };
  });
}

// Merges the base backup's own existing items for a category with our new
// candidates (deduped by uid — a pull already present in the real backup is
// never touched or duplicated), then recomputes pity4/pity5/pullNo/sort
// across the FULL combined, chronologically-sorted list. This is what makes
// the whole operation a true patch rather than a replace: nothing from the
// user's real account is ever dropped, even if our own app's history is
// incomplete relative to theirs.
//
// IMPORTANT: multiple pulls within the same 1x/10x batch share an identical
// `timestamp`, so a plain timestamp sort can't tell which came first within
// that batch — Array.sort is stable, so it falls back to each item's
// pre-sort position. existingItems arrive newest-first (StarRailStation's
// own storage order, highest pullNo first) — sorting them into ascending
// pullNo order BEFORE the merge (their own pullNo is authoritative and
// already correctly resolves same-timestamp ties) is what makes the
// subsequent stable timestamp-sort preserve true chronological order
// instead of reversing same-timestamp batches.
function mergeCategoryItems(existingItems, candidates) {
  const existingUids = new Set(existingItems.map(it => it.uid));
  const newOnes = candidates.filter(c => !existingUids.has(c.uid));
  const existingSorted = [...existingItems].sort((a, b) => (a.pullNo ?? 0) - (b.pullNo ?? 0));

  // _won5050 (win/loss for rate-up stats) isn't computed here — it needs the
  // full merged, pity-computed sequence first, so it's derived afterward by
  // deriveWon5050() for every item uniformly, existing or new alike.
  const merged = [...existingSorted, ...newOnes]
    .sort((a, b) => a.timestamp - b.timestamp);

  let pity4 = 0;
  let pity5 = 0;
  return merged.map((item, i) => {
    pity4++; pity5++;
    // Record THIS pull's own pity value first (count of pulls since the
    // previous same-rarity hit, inclusive of itself — confirmed against a
    // real backup: a 4-star's own pity4 was 9, not 0), THEN reset for the
    // next pull. Resetting before recording (as an earlier version of this
    // function did) wrongly zeroed every 4-star/5-star's own pity field.
    const thisPity4 = pity4;
    const thisPity5 = pity5;
    if (item.rarity === 5) pity5 = 0;
    if (item.rarity === 4) pity4 = 0;

    return {
      ...item,
      pity4: thisPity4,
      pity5: thisPity5,
      pullNo: i + 1,
      // `sort` drives their own display ordering (a global, all-categories,
      // monotonically-decreasing insertion key) — approximated here as a
      // simple descending sequence per category, which sorts correctly
      // within itself even though it won't interleave with other
      // categories exactly like their real global counter would.
      sort: 999999999 - i,
    };
  });
}

// Computes every stat field StarRailStation's UI reads for a scope (either
// one banner instance for `banners[gachaId]`, or a whole category for
// `types[gachaType]`) from its final, merged item list — never left
// partially stale, which is what caused the per-banner detail page crash.
function computeAggregateStats(items) {
  const rarityCount = { 3: 0, 4: 0, 5: 0 };
  for (const it of items) rarityCount[it.rarity] = (rarityCount[it.rarity] ?? 0) + 1;

  // Character vs light-cone split uses the same itemId-range rule as
  // hsrParse.js's parseItemType() (id < 10000 → character) — reliable for
  // every item regardless of source, unlike a per-pull type tag that only
  // our own new pulls would carry.
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const fourStars  = items.filter(it => it.rarity === 4);
  const fiveStars  = items.filter(it => it.rarity === 5);
  const fourChar   = fourStars.filter(it => it.itemId != null && it.itemId < 10000).map(it => it.pity4);
  const fourLC     = fourStars.filter(it => it.itemId != null && it.itemId >= 10000).map(it => it.pity4);

  const lastFiveStar = fiveStars[fiveStars.length - 1];
  const last = items[items.length - 1];

  // rateupChallenges/rateupWins: best-effort from our own won5050 tracking
  // (won = actual 50/50 win, lost = rate-up challenge triggered). We don't
  // track 4-star rate-up state anywhere, so guarantee4 stays a documented
  // false — a known gap, not a crash risk.
  const rateupWins      = fiveStars.filter(it => it._won5050 === 'won').length;
  const rateupChallenges = fiveStars.filter(it => it._won5050 === 'won' || it._won5050 === 'lost').length;

  return {
    lastItemId:  String(last?.itemId ?? 0),
    pullCount3:  rarityCount[3],
    pullCount4:  rarityCount[4],
    pullCount5:  rarityCount[5],
    avgPity4Char: avg(fourChar),
    avgPity4LC:   avg(fourLC),
    avgPity4:     avg(fourStars.map(it => it.pity4)),
    avgPity5:     avg(fiveStars.map(it => it.pity5)),
    // The CURRENT ongoing pity is what happens AFTER the last item's own
    // reset, not the last item's own (pre-reset) recorded value — if the
    // very last pull in the category was itself a 5-star/4-star, the
    // current pity toward that rarity is 0, not that pull's own inclusive
    // count. Confirmed live: Departure Warp's only pull ever is a 5-star,
    // so its own pity5 is legitimately 50 (50 pulls since account start),
    // but the CURRENT state (nothing pulled since) is 0.
    pity4: last?.rarity === 4 ? 0 : (last?.pity4 ?? 0),
    pity5: last?.rarity === 5 ? 0 : (last?.pity5 ?? 0),
    guarantee5: lastFiveStar?._won5050 === 'lost',
    guarantee4: false,
    rateupChallenges,
    rateupWins,
    advanceInfo: {},
  };
}

// baseBackupBuffer: the user's own real, most recent "Export Backup" .dat —
// everything outside 1_warp-v2 (calculator, social, profile) is carried
// through untouched, and every existing item inside 1_warp-v2 is kept too —
// this only ever ADDS pulls our app knows about that the backup doesn't
// already have (deduped by uid), never removes or replaces existing history.
// gachaIdTable: gc-data's games/hsr/gachaid-table.json.
// Returns { buffer, gaps } — gaps are pulls whose gachaId or itemId couldn't
// be resolved (banner not yet in the table, missing featuredId/version, or
// no itemId anywhere in the log for that item name) and were therefore left
// out of the patched file rather than risk a broken/crashing record.
function buildHsrDatExport(pullLog, baseBackupBuffer, gachaIdTable, bannerSchedule, serverOffset = 8) {
  const data = decodeDat(baseBackupBuffer);
  const warp = data.data.stores['1_warp-v2'];

  const byBanner = { standard: [], beginner: [], character: [], weapon: [], charCollab: [], weaponCollab: [] };
  for (const pull of (pullLog ?? [])) {
    if (byBanner[pull.banner]) byBanner[pull.banner].push(pull);
  }

  const itemIdByName = buildItemIdByName(pullLog ?? []);
  const gaps = [];
  // mergedByType[gachaType] = full merged item list WITH internal
  // _pullType/_won5050 still attached, for stats — the cleaned version
  // (those fields stripped) is what actually gets written to items_X.
  const mergedByType = {};

  for (const [banner, gachaType] of Object.entries(GACHA_TYPE_FOR_BANNER)) {
    const candidates = buildCandidateItems(byBanner[banner], gachaType, gachaIdTable, bannerSchedule, itemIdByName, serverOffset, gaps);
    const existing = warp[`items_${gachaType}`] ?? [];
    const merged = deriveWon5050(mergeCategoryItems(existing, candidates), bannerSchedule, banner);
    mergedByType[gachaType] = merged;
    warp[`items_${gachaType}`] = merged.map(({ _won5050, ...clean }) => clean);
  }

  // Rebuild BOTH aggregate-stats objects StarRailStation's UI reads —
  // `banners` (per specific banner instance) and `types` (per whole
  // category) — fully and consistently from the same merged data, rather
  // than leaving stale fields that no longer match the new item counts
  // (which is what crashed the per-banner detail page).
  warp.banners = warp.banners ?? {};
  warp.types = warp.types ?? {};

  for (const [gachaTypeStr, items] of Object.entries(mergedByType)) {
    const gachaType = Number(gachaTypeStr);
    warp.types[gachaTypeStr] = { type: gachaType, ...computeAggregateStats(items) };

    const byGachaId = {};
    for (const item of items) (byGachaId[item.gachaId] ??= []).push(item);
    for (const [gachaId, gachaItems] of Object.entries(byGachaId)) {
      warp.banners[gachaId] = { id: Number(gachaId), type: gachaType, ...computeAggregateStats(gachaItems) };
    }
  }

  return { buffer: encodeDat(data), gaps };
}

module.exports = { buildHsrDatExport };
