// Pity counting and dedup for this engine's decoded pull records.
// Deliberately NOT the same dedup strategy as the original OCR engine's
// pullLogEngine.js (since removed): that one needed a 20-consecutive-row
// matching window because OCR text is fuzzy (the same real pull can read
// slightly differently between two scans). Decoded records don't have that
// problem: each one already carries an exact, stable identity (a real
// character/arc ID plus an exact decoded unix timestamp, both read directly
// from the wire protocol, not approximated from pixels) — so dedup here is
// just "have we already stored a record with this exact id," no fuzzy
// matching needed.
//
// isPityReset/assignPity/getResumePity are conceptually identical to the
// OCR engine's and kept compatible in shape, since both ultimately produce
// the same stored pullLog format for NteHistoryTab.js to display.

const { resolveRewardName } = require('./rewardMappings');

// Same rule as nte/: only a gold CHARACTER pull resets character pity
// (Limited and Standard alike — both are "character" pools, just tracked
// as separate banners); arc pity resets on any gold arc pull. Item pulls
// never reset either pool.
function isPityReset(entry, banner) {
  if (entry.rarity !== 5) return false;
  return banner === 'arc' ? entry.kind === 'arc' : entry.kind === 'character';
}

// Converts one decoded+resolved record (from captureOrchestrator.js) into
// the stored pull-log entry shape. `banner` is passed in already resolved
// by the caller (character-limited / character-standard / arc — see
// captureOrchestrator.js for how Limited vs Standard gets told apart, since
// the wire data itself can't). Not wired to pity/id yet — those depend on
// the record's position in the batch, filled in by assignPity/stable ids
// below.
function toLogEntry(record, banner) {
  return {
    id: null,
    name: record.name ?? record.id,
    category: record.kind === 'character' ? 'Character' : record.kind === 'arc' ? 'Arc' : 'Item',
    banner,
    time: new Date(record.unixSeconds * 1000).toISOString(),
    quantity: record.quantity ?? 1, // quantity field not yet located in the wire format — see project notes
    rarity: record.rarity ?? 3,
    isGold: record.rarity === 5,
    isBonus: record.isBonus ?? false, // roll_result/bonus field not yet located — see project notes
    pity: null,
    rewardKey: record.id,
    // Which capture pass produced this entry — captureOrchestrator.js's
    // multi-pass redundancy (see its header) tags every record this way.
    // Consumed by reduceDuplicatePasses below, then stripped before
    // anything is stored (not part of the persisted entry shape).
    pass: record.pass ?? 1,
  };
}

// Collapses same-key duplicates produced by capturing the same page more
// than once (captureOrchestrator.js's multi-pass redundancy against random
// UDP loss) WITHOUT collapsing genuine same-second duplicates that can
// legitimately occur within a single pass (e.g. arc's 10-pull batches split
// across two pages sharing one timestamp — see mergeBatchIntoHistory's
// comment below for why simple content-based dedup broke that case before).
//
// For each distinct key (banner|rewardKey|time), count how many times it
// appears WITHIN each pass separately, then keep only the largest of those
// per-pass counts. A key seen twice in pass 1 and twice in pass 2 is a real
// double-pull (kept as 2, not 4). A key seen once in pass 1 and once in
// pass 2 is the same pull caught twice (kept as 1, not 2). A key pass 1
// missed entirely but pass 2 caught is still kept (max(0, 1) = 1) — the
// whole point of running more than one pass. Generalizes to any pass count.
//
// Two passes: first tallies each key's max-per-pass count (the number to
// keep), second walks `entries` in its ORIGINAL order, keeping up to that
// many instances of each key as it goes. That second pass is required —
// grouping by key with a Map (as an earlier version of this function did,
// via `for (const byPass of groups.values()) reduced.push(...best)`) is
// convenient for counting, but iterating a Map's groups pulls every copy of
// one repeated key together in the output, wherever its group happens to
// land — destroying the true interleaved order whenever a repeated reward
// (e.g. the same arc piece landing on two different pages of one batch) sits
// between OTHER distinct rewards. Confirmed live against a real capture:
// "First Step to Success" pulled twice (once each on two adjacent pages,
// each with other distinct rewards between them) came out of the old
// version bunched together as if pulled back-to-back, scrambling the
// surrounding pulls' relative order along with it.
function reduceDuplicatePasses(entries) {
  const groups = new Map(); // key -> Map(pass -> count)
  for (const entry of entries) {
    const key = `${entry.banner}|${entry.rewardKey}|${entry.time}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const byPass = groups.get(key);
    byPass.set(entry.pass, (byPass.get(entry.pass) ?? 0) + 1);
  }

  const keepRemaining = new Map();
  for (const [key, byPass] of groups) {
    let best = 0;
    for (const count of byPass.values()) {
      if (count > best) best = count;
    }
    keepRemaining.set(key, best);
  }

  const reduced = [];
  for (const entry of entries) {
    const key = `${entry.banner}|${entry.rewardKey}|${entry.time}`;
    const left = keepRemaining.get(key) ?? 0;
    if (left > 0) {
      reduced.push(entry);
      keepRemaining.set(key, left - 1);
    }
  }
  return reduced;
}

// Same algorithm as the original OCR engine's assignPity (since removed) —
// was kept as its own separate copy rather than shared, since the two
// engines' entry shapes differed (rewardKey vs rawLine) and they were
// meant to be cleanly removable independently of each other while both
// existed side by side.
function assignPity(entries, banner, startingPity = 0) {
  let pity = startingPity;
  for (const entry of entries) {
    if (entry.isBonus) {
      entry.pity = null;
      continue;
    }
    pity += 1;
    entry.pity = pity;
    if (isPityReset(entry, banner)) pity = 0;
  }
  return entries;
}

function getResumePity(existingOldestFirst) {
  for (let i = existingOldestFirst.length - 1; i >= 0; i--) {
    if (existingOldestFirst[i].pity != null) return existingOldestFirst[i].pity;
  }
  return 0;
}

// Stable, deterministic, and — unlike nte/'s occurrence-counted ids —
// exact: two different real pulls can only collide here if they're
// genuinely the same banner + reward + the same literal second, which the
// game itself would have to produce (e.g. two of the same item in one
// multi-pull batch). Kept banner+rewardKey+time rather than folding in an
// occurrence counter for now; can be added back if same-second duplicates
// turn out to happen in practice.
function assignIds(entries, banner) {
  const seen = new Map();
  for (const entry of entries) {
    const key = `${banner}|${entry.rewardKey}|${entry.time}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    entry.id = n === 1 ? key : `${key}|${n}`;
  }
  return entries;
}

// Merges a freshly-decoded batch (any order) into existing (oldest-first)
// stored history. Simple exact-id dedup rather than nte/'s consecutive-row
// window — see file header for why that's a legitimate simplification here,
// not a corner cut.
function mergeBatchIntoHistory(records, existingOldestFirst, banner) {
  const existingIds = new Set(existingOldestFirst.map(e => e.id));

  // `records` arrives newest-first (captureOrchestrator.js sorts allRecords
  // by real capture time descending before filtering per banner) — that
  // order matters even for same-timestamp entries, not just distinct ones.
  // Array.prototype.sort is STABLE, so the ascending-by-time sort below
  // preserves each same-timestamp group's relative order AS-IS rather than
  // reversing it — which is wrong here: this function's job is to produce
  // the exact REVERSE of decode order (oldest-first, matching storage
  // convention), so that later reversing it back (as NtePullLogTab.js's own
  // display sort does, tie-breaking by descending `pity` — see its
  // comments) exactly reconstructs the true newest-first order, INCLUDING
  // within a tied group. Confirmed live (2026-07-14): a real sync showed
  // every PAGE landing in the correct relative position, but each page's
  // own 5 rows displaying in reverse (5,4,3,2,1 instead of 1,2,3,4,5) — the
  // .reverse() below (applied before the stable sort, so ties end up in the
  // correct oldest-of-the-tie-first order for storage) is the fix: without
  // it, a same-timestamp group's newest-first decode order survived
  // unreversed into storage, and pity (assigned by simple incrementing
  // counter over storage order) baked that wrong order in — which the
  // frontend's own tie-break faithfully (and correctly, given its own
  // input) reproduced rather than caused.
  let entries = records
    .map(r => toLogEntry(r, banner))
    .reverse()
    .sort((a, b) => new Date(a.time) - new Date(b.time)); // oldest-first, matches storage convention

  // Collapse multi-pass repeats (see reduceDuplicatePasses) BEFORE
  // assigning ids — assignIds' occurrence-suffixing is what makes genuine
  // same-second duplicates within a pass survive, so it needs to see the
  // already-reduced list, not the raw multi-pass one.
  entries = reduceDuplicatePasses(entries);

  // Assign ids first (pure function of banner+rewardKey+time, doesn't
  // depend on existing history) so dedup can compare against real ids.
  assignIds(entries, banner);
  const newEntries = entries
    .filter(e => !existingIds.has(e.id))
    .map(({ pass: _pass, ...e }) => e); // pass was only needed for the reduction above — not part of the stored shape

  assignPity(newEntries, banner, getResumePity(existingOldestFirst));

  return {
    merged: [...existingOldestFirst, ...newEntries],
    added: newEntries,
    addedCount: newEntries.length,
  };
}

// Sequence-alignment tracker for deciding WHEN TO STOP a page walk early —
// NOT a replacement for mergeBatchIntoHistory's own id-based dedup, which
// still runs unconditionally on whatever this walk captures and remains the
// sole thing that actually decides what gets stored (see that function's
// existingIds filter, unchanged by this). This tracker only answers "have we
// walked far enough back into already-known territory to stop paging,"
// which is a performance question, not a correctness one — a wrong answer
// here means an over-long or (rarely) too-short walk, never a duplicate or
// lost entry, since mergeBatchIntoHistory's id filter still has final say
// over what actually gets appended.
//
// Why sequence order, not just per-record key matching: NTE's own timestamp
// resolution is only 1 second, and real captures show groups of 10-12
// records legitimately sharing one identical (rewardKey, time) — see
// project notes on 2026-07-14's timestamp-collision investigation. A single
// matching record could be coincidence. Walking the records in their true
// on-screen order (newest-first, preserved by the wire/OCR decode) and
// requiring them to align POSITION-BY-POSITION against already-stored
// history (also newest-first once reversed) is what actually disambiguates
// this — the same-key duplicates only ever appear as a contiguous run in a
// stable, repeatable order, never scrambled, so aligning by position rather
// than by key alone is reliable where a plain Set-membership check on a
// single key would not be.
//
// Per the user's explicit design: once ANY alignment point is found (the
// first record that matches its expected position in already-stored
// history), the caller keeps walking a fixed 2 MORE full pages past that
// point before treating the walk as done — not because 2 pages are needed
// to reach statistical confidence, but as a deliberately generous, simple,
// constant safety margin the user asked for directly rather than a
// dynamically-computed threshold.
const ALIGNMENT_CONFIRMATION_PAGES = 2;

function createAlignmentTracker(existingOldestFirst) {
  // Reversed once up front — comparing newest-first against this walk's own
  // newest-first record order means matchIndex only ever needs to move
  // forward, never re-scan.
  const existingNewestFirst = [...existingOldestFirst].reverse();
  let matchIndex = 0;
  let alignmentFoundAtPageIndex = null;

  return {
    // Call once per decoded record, in true on-screen (newest-to-oldest)
    // order, as each page is walked. `rewardKey` here is the record's
    // resolved reward id (matches storage's own `rewardKey` field —
    // see toLogEntry), `isoTime` its exact stored-format timestamp string.
    consider(rewardKey, isoTime, pageIndex) {
      const candidate = existingNewestFirst[matchIndex];
      if (candidate && candidate.rewardKey === rewardKey && candidate.time === isoTime) {
        if (alignmentFoundAtPageIndex == null) alignmentFoundAtPageIndex = pageIndex;
        matchIndex += 1;
      }
      // A non-match doesn't reset or penalize anything — it's simply not
      // (yet) proof of alignment. Worst case a stray non-matching record
      // right at the boundary just means alignment is detected one record
      // later than ideal; mergeBatchIntoHistory's id filter is what
      // actually guarantees no duplicate ever gets stored regardless.
    },

    // True once the walk has gone ALIGNMENT_CONFIRMATION_PAGES full pages
    // past the first alignment point — the caller should stop walking this
    // banner's table after finishing the page currently being checked.
    readyToStop(currentPageIndex) {
      return alignmentFoundAtPageIndex != null
        && currentPageIndex >= alignmentFoundAtPageIndex + ALIGNMENT_CONFIRMATION_PAGES;
    },
  };
}

module.exports = {
  isPityReset,
  toLogEntry,
  assignPity,
  getResumePity,
  assignIds,
  reduceDuplicatePasses,
  mergeBatchIntoHistory,
  createAlignmentTracker,
};
