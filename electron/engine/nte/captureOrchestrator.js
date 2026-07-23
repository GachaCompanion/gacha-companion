// Ties this engine's pieces together for one capture run: starts WinDivert
// in the background, drives the click/scroll navigation (navigation.js),
// verifies every page's record count LIVE as the walk proceeds, patches any
// short page via a one-shot OCR read of the still-on-screen table
// (ocrFallback.js) before moving on, stops WinDivert once all three tables
// have been walked, decodes whatever wire traffic was captured, and merges
// the result (wire + any OCR patches) into stored pull history via
// pullLogEngine.js.
//
// 2026-07-13/14: extensive history of pktmon double-pass, raw-socket, and
// WinDivert+OCR attempts — see git history of this file for the full
// investigation (probe/port-learning stage, board-phase/page-boundary
// timing races and their fixes, double-pass duplicate reduction, etc).
// pktmon's own double-pass was the last "confirmed solid" configuration for
// a long stretch, but strictVerifyCapture.js's diagnostic work (see project
// memory) established two things conclusively: (1) WinDivert and pktmon
// miss the exact same packets when they miss at all — confirming the loss
// is not specific to either capture mechanism, and (2) system-load
// diagnostics at the moment of a miss were inconclusive/misleading (the
// "top processes" list was sorted by cumulative CPU-seconds, not
// instantaneous load, so it never actually pointed at a real cause). Since
// neither capture backend can be made more reliable and pktmon's own
// stop/decode/restart cycle makes it unusable for LIVE per-page
// verification (only WinDivert's peekPackets() supports that without
// interrupting the capture), the user explicitly asked to drop pktmon
// entirely: WinDivert now runs as the ONE always-on capture backend, and
// OCR is reintroduced as a live per-page top-up — not a second network
// pass, just reading the same page's already-loaded, still-on-screen table
// via OCR whenever WinDivert's own live count for that page comes up short.
// No double-pass, no probe/port-learning stage (WinDivert's own "udp"
// kernel filter already scopes capture correctly without needing to learn
// NTE's session port first — unlike pktmon, which had to avoid its ring
// buffer filling with unrelated traffic during a much longer double-pass
// walk).
//
// A previous WinDivert+OCR attempt (git history, 2026-07-14) was reverted
// after two bugs compounded: (1) the OCR top-up compared wire-record counts
// by PAGE-INDEX BUCKET, which a late-arriving wire packet could still miss
// by landing in the next page's window — fixed here by verifying and, if
// needed, entirely REPLACING a page's wire-derived records with its OCR
// read (see ocrCoveredPages below), never additively merging the two for
// the same page, so there is no way to double-count; (2) that attempt's OCR
// fallback fired on nearly every page in one run, meaning the wire capture
// itself was unreliable that run too — accepted risk this time, since the
// diagnostic work above already established there's no more-reliable wire
// backend available; OCR firing often just means OCR is doing more of the
// real work that run, not that anything is broken.
//
// Standard Board (a separate pity pool from Limited Character — both are
// "monopoly" system boards and produce byte-identical wire formats) is
// still split out via wall-clock phase-boundary timestamps recorded at the
// moment each board-switch navigation call is FIRED (not once it resolves)
// — see boardPhaseBoundaries below, same mechanism kept from every prior
// version of this file.
//
// 2026-07-14: two improvements folded in after being proven out in the
// separate strictVerifyCapture.js diagnostic tool (see project memory) —
// per the user's explicit instruction to bring the now-working strict-verify
// system into this real sync path rather than maintaining two parallel
// implementations:
//   1. Every page is now verified, including each banner's true LAST page
//      (a version of this file used to skip verification entirely once
//      isLastPage was true — confirmed live via strict-verify that this let
//      WinDivert misses on a genuinely partial final page go completely
//      uncaught). OCR fallback rows now also get a REAL encoded payload
//      (protocolDecode.js's encodeMonopolyRecord/encodeArcRecord — true
//      inverses of the decoders) and a real srcIp/srcPort reused from this
//      session's own last-known WinDivert endpoint, so an OCR-recovered
//      record is indistinguishable from a wire-captured one anywhere
//      downstream (debug log, stored history) — not just cosmetic: it also
//      means storage's own `rewardKey` field is populated identically
//      either way, so mergeBatchIntoHistory's id-based dedup treats both
//      sources exactly the same.
//   2. A NEW early-stop mechanism (pullLogEngine.js's createAlignmentTracker)
//      replaces the old single-timestamp stopAtOrBeforeMs approach (still
//      present in navigation.js, just no longer wired up from here — see
//      below). Per the user's explicit design: walk each banner
//      newest-first as always, and once a decoded record's (rewardKey,
//      time) pair matches its expected position in already-stored history
//      (compared in the same newest-first order, so same-second duplicate
//      groups are disambiguated by SEQUENCE POSITION rather than by a
//      single ambiguous key match), keep walking a fixed 2 MORE full pages
//      past that point as a confirmation margin, then stop. This is purely
//      a performance decision about when to stop paging — it does NOT
//      itself decide what gets stored; mergeBatchIntoHistory's existing
//      id-based filter still has final, independent say over every record,
//      so an alignment misfire can at worst make one sync walk a bit too
//      long or short, never create a duplicate or silently drop a real
//      pull (a subsequent sync's own walk — bounded by the same tracker —
//      would still reach and capture anything missed).

const windivertCapture = require('./windivertCapture');
const { decodeRecords, encodeMonopolyRecord, encodeArcRecord } = require('./protocolDecode');
const { resolveRewardName } = require('./rewardMappings');
const { mergeBatchIntoHistory, createAlignmentTracker } = require('./pullLogEngine');
const { writeCaptureDebugLog } = require('./debugLog');
const navigation = require('./navigation');
const { resolvePageViaOcr, shutdownOcrWorker } = require('./ocrFallback');

// How long to give WinDivert to catch up before trusting a live page count
// as final — a page's response can still be in flight when onVerifyPage
// fires (it runs right after the page's own boundary is recorded, before
// the Next click, so genuinely no artificial delay has been added yet
// anywhere in the walk). One short wait-and-recheck, not a retry loop —
// OCR is the actual fallback, this just avoids invoking OCR for packets
// that were always going to arrive a moment later anyway.
const LIVE_VERIFY_SETTLE_MS = 400;
const EXPECTED_RECORDS_PER_PAGE = 5;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Runs the full character + arc page-walk with WinDivert running underneath
// it for the whole capture, live-verifying every page and OCR-patching any
// short one, decodes the result, and merges it into `existingHistory` (the
// caller's already-stored { character, arc } oldest-first arrays — same
// shape nte/'s main.js reads from disk before a sync). Returns the merged
// history for the caller to persist; this function never touches disk for
// pull history itself, only for the debug log.
async function runCapture({ windowBounds, calibration, isInterrupted, onProgress, existingHistory }) {
  const existingCharacterLimitedHistory = existingHistory?.characterLimited ?? [];
  const existingCharacterStandardHistory = existingHistory?.characterStandard ?? [];
  const existingArcHistory = existingHistory?.arc ?? [];

  // Sequence-alignment early-stop trackers — one per banner, independent of
  // each other (each table has its own history and its own walk). See this
  // file's header and pullLogEngine.js's createAlignmentTracker for the
  // full design. stopAtOrBeforeMs is deliberately NOT passed to any
  // walkCharacterTable/walkArcTable call below anymore — the alignment
  // tracker's onVerifyPage-driven `{ stop: true }` signal is what now
  // governs early stopping instead (navigation.js's own stopAtOrBeforeMs
  // code path is untouched and still there, just unused from here).
  const alignmentTrackers = {
    'character-limited': createAlignmentTracker(existingCharacterLimitedHistory),
    'character-standard': createAlignmentTracker(existingCharacterStandardHistory),
    arc: createAlignmentTracker(existingArcHistory),
  };

  let cleanlyStoppedCapture = false;
  let usedOcrFallback = false;
  // Real endpoint seen from the last actual WinDivert packet this session —
  // stamped onto OCR-synthesized records so they carry a real, plausible
  // srcIp/srcPort instead of null. The whole session uses one fixed
  // endpoint (see this file's earlier header notes on port/IP being
  // reassigned per-session but fixed for its duration), so any real
  // packet's endpoint is valid to reuse for any other record in the same
  // run.
  let lastKnownEndpoint = null;

  // Wall-clock moment the Limited-vs-Standard board switch happens — used to
  // tell apart two record types the wire protocol itself can't distinguish.
  // Entries are pushed in chronological order across the whole capture, each
  // tagged with which banner applies from that moment until the next
  // boundary.
  const boardPhaseBoundaries = [];
  // Wall-clock moment each page became current, per banner — used both for
  // the debug log (page-by-page diffing between runs) and, live during the
  // walk, to know which already-decoded packets belong to "the page we're
  // currently verifying."
  const pageBoundaries = { 'character-limited': [], 'character-standard': [], arc: [] };
  // Pages whose wire-decoded records were replaced wholesale by an OCR read
  // — keyed `${banner}|${pageIndex}` where banner is the boardPhaseBanner
  // ('character-limited'/'character-standard'/'arc'). Any wire record
  // landing in one of these page windows is dropped at final-decode time and
  // replaced by that page's OCR records instead — never merged additively,
  // so a page can never be double-counted between the two sources.
  const ocrCoveredPages = new Set();
  const ocrFallbackRecords = [];

  function boardPhaseBannerForCaptureTimeMs(ms) {
    let banner = 'character-limited';
    for (const boundary of boardPhaseBoundaries) {
      if (ms >= boundary.ms) banner = boundary.banner;
    }
    return banner;
  }
  const isMonopoly = r => r.source === 'monopoly-marker';
  const belongsToBanner = (banner, r) => banner === 'arc'
    ? (!isMonopoly(r) && r.kind === 'arc' && Boolean(r.name))
    : (isMonopoly(r) && r.boardPhaseBanner === banner && Boolean(r.name));

  function pageIndexForCaptureTimeMs(banner, ms) {
    let pageIndex = 1;
    for (const boundary of pageBoundaries[banner]) {
      if (ms >= boundary.ms) pageIndex = boundary.pageIndex;
    }
    return pageIndex;
  }

  // Decodes a list of {timestampMicros, payload, srcIp, srcPort, ...} udp
  // packets into tagged records, deduping identical payloads via
  // `seenPayloads`.
  function decodeTagged(udpPayloads, seenPayloads) {
    const records = [];
    for (const pkt of udpPayloads) {
      lastKnownEndpoint = { srcIp: pkt.srcIp, srcPort: pkt.srcPort };
      const payloadHex = pkt.payload.toString('hex');
      if (seenPayloads.has(payloadHex)) continue;
      seenPayloads.add(payloadHex);
      const captureTimeMs = Math.round(pkt.timestampMicros / 1000);
      const boardPhaseBanner = boardPhaseBannerForCaptureTimeMs(captureTimeMs);
      for (const c of decodeRecords(pkt.payload)) {
        const kindBanner = c.source === 'arc-miracle-box' ? 'arc' : boardPhaseBanner;
        const pageIndex = pageIndexForCaptureTimeMs(kindBanner, captureTimeMs);
        records.push({ ...c, ...resolveRewardName(c.rewardKey), srcIp: pkt.srcIp, dstIp: pkt.dstIp, srcPort: pkt.srcPort, dstPort: pkt.dstPort, pass: 1, boardPhaseBanner, captureTimeMs, pageIndex });
      }
    }
    return records;
  }

  // Turns one OCR-read row into a record shaped exactly like a real
  // WinDivert-decoded one (source, payloadHex, srcIp/srcPort) — same
  // reasoning and same encoders as strictVerifyCapture.js's buildOcrRecord.
  // `payloadHex` is a REAL encoding of this record's rewardKey+timestamp,
  // not a placeholder — decoding it back reproduces the exact same
  // rewardKey/unixSeconds.
  function buildOcrRecord(row, phaseBanner, isArc, pageIndex, pageStartMs) {
    const record = { rewardKey: row.id, unixSeconds: row.unixSeconds };
    const payload = isArc ? encodeArcRecord(record) : encodeMonopolyRecord(record);
    return {
      rewardKey: row.id, unixSeconds: row.unixSeconds,
      kind: row.kind, id: row.id, name: row.name, rarity: row.rarity,
      source: isArc ? 'arc-miracle-box' : 'monopoly-marker',
      captureTimeMs: pageStartMs, boardPhaseBanner: phaseBanner, kindBanner: phaseBanner, pageIndex, pass: 1,
      srcIp: lastKnownEndpoint?.srcIp ?? null, srcPort: lastKnownEndpoint?.srcPort ?? null,
      payloadHex: payload.toString('hex'),
    };
  }

  // Live per-page verification, called from navigation.js's walkPages right
  // after this page's own boundary is recorded (before the Next click, so
  // the page's table is still the one on screen — required for the OCR
  // fallback to have anything to read). `walkBanner` is 'character' or
  // 'arc' (navigation.js's own vocabulary); `phaseBanner` is the resolved
  // 'character-limited'/'character-standard'/'arc' bucket this page's
  // records actually belong to. Returns `{ stop: true }` once this
  // banner's alignment tracker (see this file's header) is satisfied —
  // navigation.js's walkPages honors that as an early-stop signal.
  //
  // Every page is checked now, including the true last page of a banner —
  // see this file's header on why that changed. A short page (wire or OCR)
  // is only ever expected on the genuine last page; elsewhere it's exactly
  // the gap OCR exists to patch.
  async function verifyPageLive(walkBanner, phaseBanner, pageIndex, pageStartMs, isLastPage) {
    await sleep(LIVE_VERIFY_SETTLE_MS);

    const snapshot = windivertCapture.peekPackets();
    const seen = new Set();
    const decoded = decodeTagged(snapshot, seen);
    const thisPageBanner = walkBanner === 'arc' ? 'arc' : phaseBanner;
    let pageRecords = decoded.filter(r => belongsToBanner(thisPageBanner, r) && r.captureTimeMs >= pageStartMs);

    if (pageRecords.length < EXPECTED_RECORDS_PER_PAGE) {
      console.log(`[nte capture] ${thisPageBanner} page ${pageIndex}: wire capture found only ${pageRecords.length}/${EXPECTED_RECORDS_PER_PAGE} — falling back to OCR for this page`);
      usedOcrFallback = true;
      const ocrBanner = walkBanner === 'arc' ? 'arc' : 'character';
      const ocrRows = await resolvePageViaOcr(windowBounds, ocrBanner, Math.round(pageStartMs / 1000));
      // Only replace (wholesale, never additively merge) if OCR actually
      // found MORE than the wire capture did — same rule as
      // strictVerifyCapture.js. A last page that the wire capture already
      // fully covered doesn't need OCR to also match a fixed 5; a last
      // page OCR can't improve on is simply left as the wire capture's
      // own (possibly short, and that's fine) real read.
      if (ocrRows.length > pageRecords.length) {
        ocrCoveredPages.add(`${thisPageBanner}|${pageIndex}`);
        pageRecords = ocrRows.map(row => buildOcrRecord(row, thisPageBanner, walkBanner === 'arc', pageIndex, pageStartMs));
        ocrFallbackRecords.push(...pageRecords);
      }
    }

    // Sequence-alignment tracking for early-stop — see this file's header
    // and pullLogEngine.js's createAlignmentTracker. Uses this page's FINAL
    // record set (post-OCR-fill if that happened), in true on-screen order,
    // so a short page that got topped up doesn't feed incomplete data into
    // the alignment check.
    const tracker = alignmentTrackers[thisPageBanner];
    for (const r of pageRecords) {
      tracker.consider(r.id ?? r.rewardKey, new Date(r.unixSeconds * 1000).toISOString(), pageIndex);
    }

    return { stop: tracker.readyToStop(pageIndex) };
  }

  // Runs the single full navigate+walk sequence for all three banners
  // (Limited -> Standard -> Arc). Character-limited page 1 was already
  // navigated to by the caller before this runs, so this only walks it — it
  // doesn't re-navigate at the start.
  async function runWalkPass() {
    onProgress?.({ phase: 'walking-character-limited-table' });
    const characterLimitedWalk = await navigation.walkCharacterTable({
      windowBounds, calibration, isInterrupted,
      progressLabel: 'character-limited',
      onProgress: p => onProgress?.({ phase: 'walking-character-limited-table', ...p }),
      // stopAtOrBeforeMs deliberately omitted — see this file's header on
      // the alignment-tracker early-stop (onVerifyPage's `{ stop }` return)
      // replacing it as this walk's stopping mechanism.
      onPageBoundary: b => pageBoundaries['character-limited'].push(b),
      onVerifyPage: (pageIndex, pageStartMs, isLastPage) => verifyPageLive('character', 'character-limited', pageIndex, pageStartMs, isLastPage),
    });
    if (characterLimitedWalk.interrupted) return { status: 'interrupted' };

    onProgress?.({ phase: 'navigating-to-standard' });
    // Pushed BEFORE the navigate call, not after it resolves — see this
    // file's header for why (real network responses can arrive and get
    // captured before the navigation's own confirm-read finishes).
    boardPhaseBoundaries.push({ ms: Date.now(), banner: 'character-standard' });
    const standardNavResult = await navigation.navigateToStandardRecords(windowBounds, calibration, isInterrupted);
    if (!standardNavResult.ok) return { status: standardNavResult.reason === 'interrupted' ? 'interrupted' : 'error', error: standardNavResult.reason };

    onProgress?.({ phase: 'walking-character-standard-table' });
    const characterStandardWalk = await navigation.walkCharacterTable({
      windowBounds, calibration, isInterrupted,
      progressLabel: 'character-standard',
      onProgress: p => onProgress?.({ phase: 'walking-character-standard-table', ...p }),
      onPageBoundary: b => pageBoundaries['character-standard'].push(b),
      onVerifyPage: (pageIndex, pageStartMs, isLastPage) => verifyPageLive('character', 'character-standard', pageIndex, pageStartMs, isLastPage),
    });
    if (characterStandardWalk.interrupted) return { status: 'interrupted' };

    onProgress?.({ phase: 'navigating-to-arc' });
    const navResult = await navigation.navigateToArcRecords(windowBounds, calibration, isInterrupted);
    if (!navResult.ok) return { status: navResult.reason === 'interrupted' ? 'interrupted' : 'error', error: navResult.reason };

    onProgress?.({ phase: 'walking-arc-table' });
    const arcWalk = await navigation.walkArcTable({
      windowBounds, calibration, isInterrupted,
      onProgress: p => onProgress?.({ phase: 'walking-arc-table', ...p }),
      onPageBoundary: b => pageBoundaries.arc.push(b),
      onVerifyPage: (pageIndex, pageStartMs, isLastPage) => verifyPageLive('arc', 'arc', pageIndex, pageStartMs, isLastPage),
    });
    if (arcWalk.interrupted) return { status: 'interrupted' };

    return {
      status: 'ok',
      pageTimingsByBanner: {
        'character-limited': characterLimitedWalk.pageTimings,
        'character-standard': characterStandardWalk.pageTimings,
        arc: arcWalk.pageTimings,
      },
    };
  }

  try {
    onProgress?.({ phase: 'starting-capture' });
    await windivertCapture.startCapture();

    onProgress?.({ phase: 'navigating-to-character' });
    boardPhaseBoundaries.push({ ms: Date.now(), banner: 'character-limited' });
    const charNavResult = await navigation.navigateToCharacterRecords(windowBounds, calibration, isInterrupted);
    if (!charNavResult.ok) {
      if (charNavResult.reason === 'interrupted') return { status: 'interrupted' };
      return { status: 'error', error: charNavResult.reason };
    }

    const passResult = await runWalkPass();
    if (passResult.status !== 'ok') return passResult;

    onProgress?.({ phase: 'stopping-capture' });
    const { packets } = await windivertCapture.stopCapture();
    cleanlyStoppedCapture = true;
    onProgress?.({ phase: 'decoding' });

    const seenPayloads = new Set();
    let allRecords = decodeTagged(packets, seenPayloads);

    // Drop any wire record landing inside a page window OCR fully covered —
    // see this file's header on why replacement (never additive merge) is
    // what keeps a page from ever being double-counted.
    allRecords = allRecords.filter(r => {
      const kindBanner = r.source === 'arc-miracle-box' ? 'arc' : r.boardPhaseBanner;
      return !ocrCoveredPages.has(`${kindBanner}|${r.pageIndex}`);
    });
    allRecords.push(...ocrFallbackRecords);

    // ASCENDING captureTimeMs — i.e. earliest-real-capture-time first.
    // Confirmed live (2026-07-14) this was backwards for a long time
    // (descending), based on an incorrect assumption in an earlier version
    // of this comment: captureTimeMs is REAL WALL-CLOCK time our own
    // process captured a packet during the walk, and since the walk visits
    // page 1 (the NEWEST in-game data) FIRST in real time and the true last
    // page (the OLDEST in-game data) LAST, page 1's records have the
    // SMALLEST captureTimeMs and the last page's have the LARGEST — the
    // exact opposite relationship the old descending sort assumed. Sorting
    // descending put the oldest in-game data first and the newest last;
    // ascending is what actually produces true newest-in-game-first order.
    // Records sharing an identical captureTimeMs (all records decoded from
    // one single packet, i.e. one page's response) are a stable-sort tie —
    // decodeRecords' own push order (true on-screen row 1..5 order) is
    // preserved for those, which is what mergeBatchIntoHistory's own
    // stable-tie handling (its .reverse() before the final by-time sort —
    // see that function's comments) depends on receiving newest-first.
    allRecords.sort((a, b) => a.captureTimeMs - b.captureTimeMs || 0);

    const characterLimitedBannerRecords = allRecords.filter(r => belongsToBanner('character-limited', r));
    const characterStandardBannerRecords = allRecords.filter(r => belongsToBanner('character-standard', r));
    const arcBannerRecords = allRecords.filter(r => belongsToBanner('arc', r));
    const unknownRecords = allRecords.filter(r => !r.name);

    const characterLimitedMerge = mergeBatchIntoHistory(characterLimitedBannerRecords, existingCharacterLimitedHistory, 'character-limited');
    const characterStandardMerge = mergeBatchIntoHistory(characterStandardBannerRecords, existingCharacterStandardHistory, 'character-standard');
    const arcMerge = mergeBatchIntoHistory(arcBannerRecords, existingArcHistory, 'arc');

    const namedCharacterLimitedCount = characterLimitedBannerRecords.filter(r => r.name).length;
    const namedCharacterStandardCount = characterStandardBannerRecords.filter(r => r.name).length;
    const namedArcCount = arcBannerRecords.filter(r => r.name).length;

    function groupByPage(records) {
      const byPage = new Map();
      for (const r of records) {
        if (!byPage.has(r.pageIndex)) byPage.set(r.pageIndex, []);
        byPage.get(r.pageIndex).push({
          name: r.name, kind: r.kind, rarity: r.rarity, rewardKey: r.rewardKey ?? r.id,
          time: new Date(r.unixSeconds * 1000).toISOString(),
          source: r.source ?? 'ocr-fallback', srcIp: r.srcIp, srcPort: r.srcPort,
          captureTimeMs: r.captureTimeMs, pass: r.pass,
        });
      }
      return Object.fromEntries([...byPage.entries()].sort((a, b) => a[0] - b[0]));
    }

    writeCaptureDebugLog(
      {
        characterLimited: characterLimitedMerge.merged.length,
        characterStandard: characterStandardMerge.merged.length,
        arc: arcMerge.merged.length,
      },
      passResult.pageTimingsByBanner,
      {
        'character-limited': groupByPage(characterLimitedBannerRecords),
        'character-standard': groupByPage(characterStandardBannerRecords),
        arc: groupByPage(arcBannerRecords),
      },
    );

    return {
      status: 'completed',
      totalUdpPackets: packets.length,
      usedOcrFallback,
      ocrFallbackPageCount: ocrCoveredPages.size,
      characterLimitedBannerRecordCount: characterLimitedBannerRecords.length,
      namedCharacterLimitedCount,
      characterStandardBannerRecordCount: characterStandardBannerRecords.length,
      namedCharacterStandardCount,
      arcBannerRecordCount: arcBannerRecords.length,
      namedArcCount,
      unknownRecordCount: unknownRecords.length,
      characterLimitedMerged: characterLimitedMerge.merged,
      characterLimitedAdded: characterLimitedMerge.added,
      characterLimitedAddedCount: characterLimitedMerge.addedCount,
      characterStandardMerged: characterStandardMerge.merged,
      characterStandardAdded: characterStandardMerge.added,
      characterStandardAddedCount: characterStandardMerge.addedCount,
      arcMerged: arcMerge.merged,
      arcAdded: arcMerge.added,
      arcAddedCount: arcMerge.addedCount,
    };
  } catch (e) {
    return { status: 'error', error: e.message };
  } finally {
    if (!cleanlyStoppedCapture) await windivertCapture.stopCapture().catch(() => {});
    if (usedOcrFallback) await shutdownOcrWorker().catch(() => {});
  }
}

module.exports = { runCapture };
