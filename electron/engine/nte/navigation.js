// Drives the same click/scroll page-walk as the original OCR-based capture
// engine's arcNavigation.js (since removed — character table -> ESC ->
// arc-menu -> arc-banner -> arc-history -> Records-tab -> arc table),
// reusing its proven calibration points and tuned timing constants
// verbatim. The one deliberate difference: this version never reads table
// ROWS via OCR at all — rawSocketCapture.js is running in the background for
// the whole walk and captures the real protocol data directly, so this
// file's only job is to turn pages and know when to stop. The page-counter
// OCR read is kept (stateVerify.js/ocr.js) purely to detect the last page —
// that's a much smaller, already-proven-reliable OCR surface than reading
// full table rows ever was.
//
// Early-stop: reads just the TOP row's timestamp each page (one small,
// single-line OCR read — much lighter than nte/'s full 5-row table read)
// and stops as soon as it's at or before the newest timestamp already in
// storage for that banner. Confirmed live this was needed — without it, a
// resync with nothing new to find still walked all ~130+68 pages end to
// end, taking the same ~15 minutes as the very first full sync every time.
//
// A targeted per-page retry system (track every page's timestamp, detect
// gaps after decoding, revisit just the short pages) was built and reverted
// — real bugs kept surfacing one layer at a time (timezone mismatch between
// OCR and wire-protocol clocks, inclusive/inclusive bracket double-counting,
// same-timestamp page pairs needing merged brackets, wrong re-entry
// sequence, stale window focus after elevation prompts) without the whole
// system ever being confirmed working end-to-end. The juice wasn't worth
// the squeeze for closing what's typically a 1-2% gap from ordinary
// internet packet loss, which no local capture tool can fully eliminate
// anyway.
//
// Confirmed live (via a throwaway probe, see git history of testRevisit.js)
// that simply revisiting an already-loaded page (Next then Previous) does
// NOT re-ask the server — the client just redisplays its own cached copy,
// producing zero new packets. The only way to force a genuinely fresh
// server response for a page is to leave the table entirely and re-enter
// it. That's what exitToPullScreen() is for: it backs all the way out to
// the pull screen (3x ESC, timing confirmed by the user from direct
// experience) so captureOrchestrator.js can run the whole navigate+walk
// sequence a second time under the same still-running capture — real
// redundancy against random loss, without any gap-detection bookkeeping.

const nteCapture = require('./capture');
const nteOverlay = require('./overlay');
const { captureRegion } = require('./screenCapture');
const { ocrText } = require('./ocr');
const { isLastPage, parsePageCounter } = require('./stateVerify');

const CHARACTER_PAGE_COUNTER_RECT = { x: 0.4427, y: 0.7917, width: 0.1146, height: 0.0648 };
const ARC_PAGE_COUNTER_RECT = { x: 0.4427, y: 0.7667, width: 0.1146, height: 0.0648 };

// Top 1/5 slice of nte/'s measured 5-row table regions (CHARACTER_TABLE_ROW_RECT
// / ARC_TABLE_ROW_RECT) — just enough to catch the newest (topmost) row's
// timestamp, not the other 4 rows or any other column. Same
// "Month Day, Year H:MM:SS" pattern tableParser.js already relies on for
// finding timestamps regardless of row color/position.
const CHARACTER_TOP_ROW_RECT = { x: 0.1875, y: 0.5, width: 0.6042, height: 0.0556 };
const ARC_TOP_ROW_RECT = { x: 0.1875, y: 0.43, width: 0.6042, height: 0.064 };
const TIMESTAMP_RE = /([A-Za-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2})/;
// Component-capturing version of TIMESTAMP_RE, used to parse the matched
// text as an explicit UTC instant via Date.UTC() rather than JS's
// Date.parse(). Confirmed live (2026-07-14) via a real sync's debug log:
// the same real multi-pull batch's records, split across pages 1 and 2,
// came back with page 1's OCR-recovered records stamped exactly 2 hours
// EARLIER than page 2's wire-decoded records for the identical event.
// Date.parse() on this non-ISO "Month Day, Year H:MM:SS" format (no
// timezone marker) is implementation-defined and treats it as LOCAL time,
// silently subtracting the system's own UTC offset (+2h on this machine)
// when converting to the epoch ms this function returns — but the game's
// displayed "Acquisition Time" is actually already in UTC (matches the
// wire protocol's own timestamp formulas, which have no timezone ambiguity
// at all and are the proven-correct ground truth), so that subtraction was
// simply wrong. Parsing the components explicitly via Date.UTC() removes
// the implicit local-timezone assumption entirely.
const TIMESTAMP_COMPONENTS_RE = /([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/;
const MONTH_ABBR_TO_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseGameTimestampAsUtcMs(text) {
  const m = text.match(TIMESTAMP_COMPONENTS_RE);
  if (!m) return null;
  const monthIndex = MONTH_ABBR_TO_INDEX[m[1].slice(0, 3).toLowerCase()];
  if (monthIndex == null) return null;
  const [, , day, year, hour, minute, second] = m;
  return Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second));
}

// "Item Name"/"Arcs" column only, spanning all 5 rows — used by ocrFallback.js
// as the OCR-fallback data source when a page's packet capture comes up
// short. x/width measured directly against real full-resolution screenshots
// (1521x856 and 1522x856) of both tables; y/height derived from the already-
// calibrated *_TOP_ROW_RECT above (same y, height x5 to cover all 5 rows)
// rather than re-measured independently, so the two stay in sync if the
// top-row rects are ever retuned.
const CHARACTER_NAME_COLUMN_RECT = { x: 0.2992, y: CHARACTER_TOP_ROW_RECT.y, width: 0.1743, height: CHARACTER_TOP_ROW_RECT.height * 5 };
const ARC_NAME_COLUMN_RECT = { x: 0.2431, y: ARC_TOP_ROW_RECT.y, width: 0.1249, height: ARC_TOP_ROW_RECT.height * 5 };

// Character-table clicks were observed dropping intermittently at 100/100
// (the counter would sit unchanged for ~40 consecutive clicks, then jump
// several pages at once) — a verify-and-retry loop was tried and made it
// worse (permanently stuck), so instead of adding retry logic this is being
// tuned directly: bump these until the on-screen counter reliably advances
// once per click on both banners.
// RULED OUT (2026-07-14): tried 200/200 (still lost 1 page on the very next
// single-pass test) and 500/500 — ~1 full second per page, meant to rule
// speed out definitively — which was WORSE, losing 2 pages, not fewer.
// Slower pacing making it worse instead of better/neutral is strong
// evidence pace/load on pktmon's capture session is NOT the cause of the
// single-pass loss (see captureOrchestrator.js's header for the full
// investigation) — reverted to the original tuned value. Whatever's
// actually causing this needs a different angle, not more delay here.
// 2026-07-14: stress-tested at 0/0, 50/50, 75/75, and 100/100 (was 175/175)
// per the user's explicit ask, now that every page also pays a mandatory
// 400ms WinDivert-verify wait (captureOrchestrator.js's
// LIVE_VERIFY_SETTLE_MS) AND, on any short page, a fully-awaited OCR pass on
// top of that — testing whether that other work happening between clicks is
// enough to keep clicks reliable even with a much smaller explicit delay
// here. Single-run results: 0/0 and 50/50 both produced wrong TOTALS (real
// click/data loss); 75/75 and 100/100 both produced CORRECT totals — the
// "wrong order" symptom both of those last two showed turned out to be a
// separate, unrelated bug (captureOrchestrator.js's final sort direction —
// now fixed) rather than anything to do with click timing at all. Settled
// on 75/75 as the current value per the user's choice — each value so far
// has only had ONE real run, so this is NOT yet considered proven reliable
// the way 175/175 was (that one has a real multi-run track record). Revert
// to 175/175 if the on-screen counter starts desyncing or totals come out
// wrong on a future run (see navigation.js's own pageMismatch
// detection/logging in walkPages) — and see this file's header on the
// RULED-OUT 500/500 test (slower was WORSE there) for why a partial
// step-down to some other value isn't automatically safer either.
const NEXT_BUTTON_PRE_CLICK_DELAY_MS = 75;
const CLICK_DELAY_MS = 75;

const POST_CAPTURE_SETTLE_MS = 100;
const FINAL_HOVER_DELAY_MS = 1000;

const ESC_POST_DELAY_MS = 200;
const PRE_CLICK_DELAY_MS = 300;
const POST_CLICK_DELAY_MS = 300;

const PRE_CLICK_DELAY_OVERRIDES_MS = {
  arcMenuButton: 200,
  arcBannerIcon: 500,
  standardBannerIcon: 500,
  limitedBannerIcon: 500,
  // 1s pause before the "History" click on every banner switch — gives the
  // banner-select click's own UI transition/settle time to fully finish
  // before requesting the records table, per the user's explicit ask.
  // characterDiceRollRecordsTab is shared by both Limited and Standard
  // (see navigateToCharacterRecords/navigateToStandardRecords), so these two
  // entries alone cover all 3 banners.
  characterDiceRollRecordsTab: 1000,
  arcHistoryButton: 1000,
};
const POST_CLICK_DELAY_OVERRIDES_MS = {
  arcMenuButton: 1200,
};

function preClickDelayFor(pointName) {
  return PRE_CLICK_DELAY_OVERRIDES_MS[pointName] ?? PRE_CLICK_DELAY_MS;
}

function postClickDelayFor(pointName) {
  return POST_CLICK_DELAY_OVERRIDES_MS[pointName] ?? POST_CLICK_DELAY_MS;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function moveToCalibrated(windowBounds, point) {
  nteCapture.moveMouseTo(
    windowBounds.x + point.x * windowBounds.width,
    windowBounds.y + point.y * windowBounds.height
  );
}

function clickHere() {
  nteOverlay.flashClickIndicator();
  return nteCapture.clickHere();
}

async function readPageCounterText(windowBounds, rect) {
  const { png } = await captureRegion(windowBounds, rect);
  return ocrText(png);
}

// Returns the top row's timestamp as a JS ms value, or null if it couldn't
// be read (treated as "not caught up yet" by the caller — a missed OCR
// read just costs one extra page, never a false early-stop).
async function readTopRowTimestampMs(windowBounds, rect) {
  const { png } = await captureRegion(windowBounds, rect);
  const text = await ocrText(png);
  const ms = parseGameTimestampAsUtcMs(text);
  return ms == null || Number.isNaN(ms) ? null : ms;
}

// Identical sequence to the original OCR engine's arcNavigation.js
// navigateToArcRecords (ESC is injected rather than called directly, and
// each point is a separate move-then-click rather than one atomic
// clickAt(), both carried over unchanged).
async function navigateToArcRecords(windowBounds, calibration, isInterrupted) {
  await sleep(POST_CAPTURE_SETTLE_MS);

  // Was a synthetic ESC (SendInput) — replaced with a click on the actual
  // in-game X button per the user's own diagnosis: clicks are routed by
  // screen position and have worked reliably throughout capture, unlike the
  // synthetic ESC keypress, which stopped reaching NTE (left the Board
  // Details modal open instead of closing it). Sidesteps needing to prove
  // exactly why the keyboard path broke.
  {
    const point = calibration.characterRecordsCloseButton;
    if (!point) return { ok: false, reason: 'missing calibration point: characterRecordsCloseButton' };
    moveToCalibrated(windowBounds, point);
    await sleep(PRE_CLICK_DELAY_MS);
    await clickHere();
    await sleep(ESC_POST_DELAY_MS);
  }

  for (const pointName of ['arcMenuButton', 'arcBannerIcon', 'arcHistoryButton', 'arcRecordsTab']) {
    if (isInterrupted?.()) return { ok: false, reason: 'interrupted' };
    const point = calibration[pointName];
    if (!point) return { ok: false, reason: `missing calibration point: ${pointName}` };

    moveToCalibrated(windowBounds, point);
    await sleep(preClickDelayFor(pointName));
    await clickHere();
    await sleep(postClickDelayFor(pointName));
  }

  const counterText = await readPageCounterText(windowBounds, ARC_PAGE_COUNTER_RECT);
  if (!/\d+\s*\/\s*\d+/.test(counterText)) {
    return { ok: false, reason: 'Could not confirm the Arc Records table — page counter not found after navigating.' };
  }

  if (isInterrupted?.()) return { ok: false, reason: 'interrupted' };
  moveToCalibrated(windowBounds, calibration.nextButton);
  await sleep(FINAL_HOVER_DELAY_MS);

  return { ok: true };
}

// Navigates from "the pull screen" (the user's own manual starting point —
// pressing F3 in-game before hitting Sync in the app, a precondition this
// function assumes rather than automates) into the Dice Roll Records table,
// via calibrated clicks: pull screen -> Limited banner icon -> Board Details
// -> Dice Roll Records. Called AFTER rawSocketCapture.js has already
// started, unlike the old assumption of "the table is already open" —
// confirmed live that assumption caused a real, consistent data gap: page
// 1's data had already been fetched (and was already stale/reshuffled by
// the time capture started) before this function existed, so its actual
// request/response was never inside the capture window at all. Mirrors
// navigateToArcRecords's shape but skips the leading ESC — this always runs
// first in a capture, before any modal this app itself opened could exist.
//
// 2026-07-13: added the explicit limitedBannerIcon click after re-adopting
// the double-pass capture (see captureOrchestrator.js's header) surfaced a
// new bug this navigation flow never hit before: this function is also used
// to re-enter the table for pass 2, AFTER Standard and Arc have already been
// visited that run. Confirmed live via debug-log forensics that pass 2's
// entire "Limited" walk was actually reading STANDARD's table — the game
// apparently remembers the last-viewed board type across a Board Details
// close/reopen, so re-entering via just Board Details -> Dice Roll Records
// silently landed back on Standard instead of defaulting to Limited. Explicit
// selection of the Limited banner icon first (mirroring exactly how
// navigateToStandardRecords force-selects Standard) removes the reliance on
// "the game happens to default to Limited," which only ever held true on a
// capture's very first entry, before Standard/Arc were ever visited.
async function navigateToCharacterRecords(windowBounds, calibration, isInterrupted) {
  await sleep(POST_CAPTURE_SETTLE_MS);

  for (const pointName of ['limitedBannerIcon', 'characterBoardDetailsButton', 'characterDiceRollRecordsTab']) {
    if (isInterrupted?.()) return { ok: false, reason: 'interrupted' };
    const point = calibration[pointName];
    if (!point) return { ok: false, reason: `missing calibration point: ${pointName}` };

    moveToCalibrated(windowBounds, point);
    await sleep(preClickDelayFor(pointName));
    await clickHere();
    await sleep(postClickDelayFor(pointName));
  }

  const counterText = await readPageCounterText(windowBounds, CHARACTER_PAGE_COUNTER_RECT);
  if (!/\d+\s*\/\s*\d+/.test(counterText)) {
    return { ok: false, reason: 'Could not confirm the Dice Roll Records table — page counter not found after navigating.' };
  }

  return { ok: true };
}

// Turns pages until the counter reports the last page, the top row is at
// or before `stopAtOrBeforeMs` (already-synced territory reached), or
// interrupted. rawSocketCapture.js is expected to already be running in the
// background — this function's only responsibility is pacing the clicks
// and reporting progress; it returns no row data at all.
//
// `banner` selects which rects to read (only 'arc' vs anything else
// matters — Standard Board reuses the exact same layout/rects as Limited,
// confirmed live) — `progressLabel` is purely cosmetic (what shows up in
// onProgress/logs), letting a Standard Board walk report itself distinctly
// from a Limited Board walk even though both use banner:'character' rects.
async function walkPages({ windowBounds, calibration, banner, progressLabel, isInterrupted, onProgress, stopAtOrBeforeMs, onPageBoundary, onVerifyPage }) {
  let pagesScanned = 0;
  const label = progressLabel ?? banner;
  const counterRect = banner === 'arc' ? ARC_PAGE_COUNTER_RECT : CHARACTER_PAGE_COUNTER_RECT;
  const topRowRect = banner === 'arc' ? ARC_TOP_ROW_RECT : CHARACTER_TOP_ROW_RECT;
  // Per-page real wall-clock timing (2026-07-14) — investigating a reported
  // "Arc looks slower than Character" observation despite identical
  // NEXT_BUTTON_PRE_CLICK_DELAY_MS/CLICK_DELAY_MS constants for all three
  // banners. Returned to the caller (not written to disk directly here) —
  // captureOrchestrator.js collects every banner's timings and writes them
  // all to one debug-log file at the very end, only on a fully completed
  // run (see debugLog.js's writeCaptureDebugLog).
  const pageTimings = [];
  let previousPageStartMs = null;
  // Boundary timestamp for the NEXT page, set at the moment its triggering
  // Next click actually fires (see the click sequence below) rather than
  // recomputed fresh at the top of the next loop iteration. Page 1 has no
  // preceding click, so it's seeded with "now."
  //
  // 2026-07-14: confirmed live via strictVerifyCapture.js's forensic log
  // that recording the boundary at loop-top was too late — page 2's real
  // response arrived 73ms BEFORE the loop-top Date.now() call that marked
  // its boundary (that call only runs after the FULL post-click settle
  // delay elapses, well after the click that actually triggers the request
  // was dispatched), so pageIndexForCaptureTimeMs's "latest boundary <= ms"
  // lookup found no boundary for page 2 yet and silently attributed page
  // 2's entire real response to page 1 instead — a 0-found "capture gap"
  // that was actually a bucketing bug, not lost data. Same root cause as
  // the board-phase-boundary race fixed in captureOrchestrator.js.
  let nextPageBoundaryMs = Date.now();

  while (true) {
    if (isInterrupted?.()) {
      return { interrupted: true, pagesScanned, pageTimings };
    }

    const pageStartMs = nextPageBoundaryMs;
    const sinceLastPageMs = previousPageStartMs != null ? pageStartMs - previousPageStartMs : null;
    previousPageStartMs = pageStartMs;

    pagesScanned += 1;
    onProgress?.({ banner: label, pagesScanned });
    // Records the wall-clock moment this page became current — lets
    // captureOrchestrator.js map decoded records back to which page they
    // came from after the fact (same technique as passStartedAtMs/
    // boardPhaseBoundaries), so it can verify every page actually yielded
    // its full 5 records and re-walk if any came up short. Recorded before
    // the early-stop check below since this page's response was already
    // requested/captured regardless of whether the walk stops here.
    onPageBoundary?.({ pageIndex: pagesScanned, ms: pageStartMs });

    let earlyStopReadMs = null;
    if (stopAtOrBeforeMs != null) {
      const t0 = Date.now();
      const topRowMs = await readTopRowTimestampMs(windowBounds, topRowRect);
      earlyStopReadMs = Date.now() - t0;
      if (topRowMs != null && topRowMs <= stopAtOrBeforeMs) {
        console.log(`[nte capture] ${label} page ${pagesScanned} top row (${new Date(topRowMs).toISOString()}) at or before last synced (${new Date(stopAtOrBeforeMs).toISOString()}) — stopping early`);
        pageTimings.push({ pageIndex: pagesScanned, sinceLastPageMs, earlyStopReadMs, counterReadMs: null, clickMs: null, stoppedEarly: true });
        return { interrupted: false, pagesScanned, pageTimings };
      }
    }

    const counterT0 = Date.now();
    const counterText = await readPageCounterText(windowBounds, counterRect);
    const counterReadMs = Date.now() - counterT0;
    console.log(`[nte capture] ${label} page ${pagesScanned} counter read: "${counterText}"`);

    // Verifies the real on-screen page actually matches what we THINK we're
    // on (pagesScanned, our own loop counter) — added 2026-07-14 to find out
    // whether a desync here (a click that silently failed to register, or
    // registered more than once) is the real cause of the page-count
    // discrepancies seen across repeated single-pass captures, now that
    // capture itself (rawSocketCapture.js) is validated reliable on its own.
    // Detection only for now — logs and records the mismatch, doesn't yet
    // retry or self-correct, so a real run can first confirm or rule out
    // this theory with direct per-page evidence instead of inferring it
    // from post-hoc total counts.
    const counter = parsePageCounter(counterText);
    let pageMismatch = null;
    if (counter == null) {
      console.log(`[nte capture] ${label} page ${pagesScanned}: could not parse page counter from "${counterText}"`);
      pageMismatch = { expected: pagesScanned, actual: null, reason: 'unparseable' };
    } else if (counter.current !== pagesScanned) {
      console.log(`[nte capture] ${label} page ${pagesScanned}: MISMATCH — on-screen counter reports page ${counter.current}, expected ${pagesScanned}`);
      pageMismatch = { expected: pagesScanned, actual: counter.current, reason: 'desync' };
    }

    // Per-page live verification — runs BEFORE the last-page check/Next
    // click, while this page's table is still the one on screen. Passed
    // whether this is the true last page (a short page is only ever
    // expected there) so the caller can tell a genuine capture gap apart
    // from an ordinary partial final page. Awaited so the page doesn't turn
    // before the check completes.
    //
    // The callback's return value can additionally request an early stop —
    // `{ stop: true }` — used by captureOrchestrator.js's sequence-alignment
    // dedup tracker (pullLogEngine.js's createAlignmentTracker) to end the
    // walk once it's confident this banner has re-entered already-synced
    // territory, without needing to reach the true last page. This is a
    // SEPARATE mechanism from stopAtOrBeforeMs above (that one still exists,
    // untouched, for any caller that wants the older single-timestamp
    // early-stop instead) — a caller only gets whichever one it actually
    // wires up via its own onVerifyPage/stopAtOrBeforeMs arguments.
    const pageIsLast = isLastPage(counterText);
    const verifyResult = onVerifyPage ? await onVerifyPage(pagesScanned, pageStartMs, pageIsLast) : null;
    const requestedStop = Boolean(verifyResult?.stop);

    if (pageIsLast || requestedStop) {
      pageTimings.push({ pageIndex: pagesScanned, sinceLastPageMs, earlyStopReadMs, counterReadMs, clickMs: null, lastPage: pageIsLast, stoppedByAlignment: requestedStop && !pageIsLast, pageMismatch });
      return { interrupted: false, pagesScanned, pageTimings };
    }

    if (isInterrupted?.()) {
      pageTimings.push({ pageIndex: pagesScanned, sinceLastPageMs, earlyStopReadMs, counterReadMs, clickMs: null, interruptedBeforeClick: true, pageMismatch });
      return { interrupted: true, pagesScanned, pageTimings };
    }
    const clickT0 = Date.now();
    moveToCalibrated(windowBounds, calibration.nextButton);
    await sleep(NEXT_BUTTON_PRE_CLICK_DELAY_MS);
    await clickHere();
    // Marks the NEXT page's boundary right here — the moment the click that
    // actually triggers its request fires — not after the settle delay
    // below. See the header comment on nextPageBoundaryMs for why the old
    // "recompute at loop-top" timing lost real races.
    nextPageBoundaryMs = Date.now();
    await sleep(CLICK_DELAY_MS);
    const clickMs = Date.now() - clickT0;

    pageTimings.push({ pageIndex: pagesScanned, sinceLastPageMs, earlyStopReadMs, counterReadMs, clickMs, pageMismatch });
  }
}

// Navigates to the Standard Board's Dice Roll Records — REPLACES the old
// switchToStandardBoard, which switched board type via an on-screen
// dropdown without ever leaving the Dice Roll Records screen. That approach
// is suspected (per the user) to be the reason Standard consistently came
// back 5 short of its true total across every real capture so far: unlike
// Limited, which always gets a genuine fresh navigation into the table (see
// navigateToCharacterRecords's header on why that specifically matters —
// page 1's response has to happen AFTER capture starts), the dropdown
// switch may not produce an equivalent full fresh page-1 load. Standard is
// now treated as its own independent entry point, exactly like Limited and
// Arc: close whatever's currently open, select the Standard banner itself
// (a new dedicated banner icon, not a dropdown), then reuse the same
// Board Details -> Dice Roll Records path Limited already uses. Mirrors
// navigateToArcRecords's shape (leading close-click, same click-instead-of-
// ESC reasoning) rather than the old in-place dropdown switch.
async function navigateToStandardRecords(windowBounds, calibration, isInterrupted) {
  await sleep(POST_CAPTURE_SETTLE_MS);

  {
    const point = calibration.characterRecordsCloseButton;
    if (!point) return { ok: false, reason: 'missing calibration point: characterRecordsCloseButton' };
    moveToCalibrated(windowBounds, point);
    await sleep(PRE_CLICK_DELAY_MS);
    await clickHere();
    await sleep(ESC_POST_DELAY_MS);
  }

  for (const pointName of ['standardBannerIcon', 'characterBoardDetailsButton', 'characterDiceRollRecordsTab']) {
    if (isInterrupted?.()) return { ok: false, reason: 'interrupted' };
    const point = calibration[pointName];
    if (!point) return { ok: false, reason: `missing calibration point: ${pointName}` };

    moveToCalibrated(windowBounds, point);
    await sleep(preClickDelayFor(pointName));
    await clickHere();
    await sleep(postClickDelayFor(pointName));
  }

  const counterText = await readPageCounterText(windowBounds, CHARACTER_PAGE_COUNTER_RECT);
  if (!/\d+\s*\/\s*\d+/.test(counterText)) {
    return { ok: false, reason: 'Could not confirm the Standard Board Dice Roll Records table after navigating.' };
  }

  return { ok: true };
}

// Backs all the way out from the Arc Records table to the pull screen, so
// runCapture can do a full second pass (redundancy against random UDP
// loss — see captureOrchestrator.js header) by simply re-running the same
// navigate+walk sequence again under the same capture. Timing is exactly
// what the user identified from direct experience: without the initial
// 500ms settle, the first ESC can fire before the game's UI is ready to
// receive it and gets swallowed. 1200ms between each of the 3 ESC presses.
async function exitToPullScreen(windowBounds, calibration, isInterrupted) {
  await sleep(500);
  // Same click-instead-of-ESC swap as navigateToArcRecords — three X-button
  // clicks backing out one screen layer at a time, replacing the three
  // synthetic ESC presses this used to send.
  for (const pointName of ['arcRecordsCloseButton', 'arcHistoryCloseButton', 'arcMenuCloseButton']) {
    if (isInterrupted?.()) return { ok: false, reason: 'interrupted' };
    const point = calibration[pointName];
    if (!point) return { ok: false, reason: `missing calibration point: ${pointName}` };
    moveToCalibrated(windowBounds, point);
    await sleep(PRE_CLICK_DELAY_MS);
    await clickHere();
    await sleep(1200);
  }
  return { ok: true };
}

function walkCharacterTable(opts) {
  return walkPages({ ...opts, banner: 'character' });
}

function walkArcTable(opts) {
  return walkPages({ ...opts, banner: 'arc' });
}

module.exports = {
  navigateToCharacterRecords,
  navigateToArcRecords,
  navigateToStandardRecords,
  walkCharacterTable,
  walkArcTable,
  exitToPullScreen,
  CHARACTER_NAME_COLUMN_RECT,
  ARC_NAME_COLUMN_RECT,
  readTopRowTimestampMs,
  CHARACTER_TOP_ROW_RECT,
  ARC_TOP_ROW_RECT,
};
