// OCR-fallback data source: when a page's packet capture comes up short
// (fewer than 5 decoded records for a page that isn't the last one), this
// reads the name column directly off the still-on-screen table via OCR
// instead of triggering any network retry/re-navigation. This is the piece
// the "hard requirement: one pass" constraint (see project memory
// feedback_hard_requirements_not_workarounds.md) explicitly allows — no
// second network round-trip, just squeezing more out of the page that's
// already loaded and visible.
//
// Pipeline (validated against 4 real screenshots — 3 Limited-board pages, 1
// Arc-board page — before being wired in here): captureRegion() grabs the
// name column at full desktop resolution (critical — a downscaled capture
// was confirmed to wreck OCR accuracy even after cleanup), rarityTextCleaner
// removes the dark outline stroke around gold/pink rarity-colored text
// (which otherwise scrambles Tesseract completely), a single long-lived
// Tesseract worker reads the cleaned column as one multi-line block, and
// each line is fuzzy-matched against the known reward-name database
// (rewardNameMatcher.js) to recover the intended name even through a
// residual single-glyph OCR mistake.
//
// Known simplification: every row on a page is tagged with the SAME
// timestamp (read once via navigation.js's existing top-row OCR read,
// already relied on elsewhere for early-stop detection) rather than OCR'd
// per-row from the Time/Acquisition-Time column. Real screenshots showed
// this holds for the vast majority of rows on a page; the one observed
// exception was a "Points Gift" bonus row landing a few seconds off from
// its page's other 4 rows. Acceptable for a fallback path that's already
// approximate by nature — exact per-row timestamps would need a second OCR
// column read for comparatively little accuracy gain.
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');
const { captureRegion } = require('./screenCapture');
const { floodFillCleanRegion } = require('./rarityTextCleaner');
const { matchOcrRewardName } = require('./rewardNameMatcher');
const {
  CHARACTER_NAME_COLUMN_RECT, ARC_NAME_COLUMN_RECT,
  CHARACTER_TOP_ROW_RECT, ARC_TOP_ROW_RECT,
  readTopRowTimestampMs,
} = require('./navigation');

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng').then(async worker => {
      await worker.setParameters({ tessedit_pageseg_mode: '6' });
      return worker;
    });
  }
  return workerPromise;
}

// Releases the Tesseract worker — call once at the very end of a capture
// run (successful or not) that ever used the OCR fallback, same lifecycle
// as windivertCapture's session. Safe to call even if the fallback was
// never triggered (no-ops, since workerPromise stays null).
async function shutdownOcrWorker() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

async function cleanedColumnPng(windowBounds, columnRect) {
  const { raw } = await captureRegion(windowBounds, columnRect);
  const cleaned = floodFillCleanRegion(raw);
  return sharp(cleaned.data, { raw: { width: cleaned.width, height: cleaned.height, channels: 1 } })
    .png()
    .toBuffer();
}

// Reads the name column for whichever table is currently on screen and
// returns up to 5 resolved records, tagged `source: 'ocr-fallback'` so
// downstream merge/debug-log code can tell them apart from wire-decoded
// records. `banner` is 'character' (shared by Limited/Standard, same as
// navigation.js's walkPages) or 'arc'. Rows the fuzzy matcher couldn't
// resolve above its confidence floor are omitted (better to under-report
// than silently record a wrong item).
//
// `fallbackUnixSeconds` (optional) is used ONLY if the top-row single-line
// timestamp OCR read itself fails. That read is a small, POSITION-FIXED
// crop calibrated against a full 5-row page's row-1 position — a genuinely
// short/partial page (a true final page with 1-4 real rows) can render
// those rows differently (observed live: on a real 2-3-row last page, this
// read consistently failed while the separate full-column name-block read
// below, which spans the entire table height regardless of exact row
// position, kept working). A version of this function used to treat that
// one read's failure as fatal for the WHOLE page (`return []`) even when
// the name column itself decoded fine — confirmed live via strict-verify
// logs that this was actively discarding real, correctly-read names on a
// partial last page purely because of the unrelated timestamp crop's
// layout assumption. The caller (an onVerifyPage hook that already knows
// this page's own wall-clock boundary time) can pass that as a fallback so
// a real page's rows are never thrown away for a reason unrelated to
// whether they were legible.
async function resolvePageViaOcr(windowBounds, banner, fallbackUnixSeconds = null) {
  const columnRect = banner === 'arc' ? ARC_NAME_COLUMN_RECT : CHARACTER_NAME_COLUMN_RECT;
  const topRowRect = banner === 'arc' ? ARC_TOP_ROW_RECT : CHARACTER_TOP_ROW_RECT;

  const [png, timestampMs] = await Promise.all([
    cleanedColumnPng(windowBounds, columnRect),
    readTopRowTimestampMs(windowBounds, topRowRect),
  ]);

  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(png);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5);

  const unixSeconds = timestampMs != null ? Math.round(timestampMs / 1000) : fallbackUnixSeconds;
  // Still can't store anything without SOME usable timestamp (toLogEntry
  // needs unixSeconds) — only truly gives up if the caller had no fallback
  // to offer either.
  if (unixSeconds == null) return [];

  const records = [];
  for (const line of lines) {
    const match = matchOcrRewardName(line);
    if (!match.kind) continue; // below confidence floor — omit rather than guess
    records.push({
      source: 'ocr-fallback',
      kind: match.kind,
      id: match.id,
      name: match.name,
      rarity: match.rarity,
      confidence: match.confidence,
      ocrText: line,
      unixSeconds,
    });
  }
  return records;
}

module.exports = { resolvePageViaOcr, shutdownOcrWorker };
