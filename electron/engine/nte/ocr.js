// Text extraction for NTE record-table regions via tesseract.js — pure
// JS/WASM, no native binary to bundle or rot, matching the same reasoning
// behind picking koffi over nut.js/robotjs for mouse control.

const { createWorker, PSM } = require('tesseract.js');

// The worker takes real time to spin up (loads the WASM engine + language
// data), so it's created once lazily and reused across OCR calls rather than
// per-call — but not reused forever. tesseract.js's worker.recognize() is
// documented to leak memory and to "adaptively drift" (Tesseract's adaptive
// classifier assumes later images resemble earlier ones, and degrades once
// that stops holding) when the same worker handles hundreds of calls in one
// session — see naptha/tesseract.js #678, #977, #446. A single character-
// table scan is ~260 recognize() calls (row table + page counter, per page,
// over 130 pages), squarely in the range those issues describe, and matches
// what was actually observed: rows silently dropping partway through a long
// run rather than the run failing outright. Recycling periodically resets
// both the accumulated memory and the adaptive state.
const RECYCLE_AFTER_CALLS = 40;
let _workerPromise = null;
let _callsSinceRecycle = 0;

function getWorker() {
  if (!_workerPromise) _workerPromise = createWorker('eng');
  return _workerPromise;
}

async function recycleWorkerIfDue() {
  _callsSinceRecycle += 1;
  if (_callsSinceRecycle < RECYCLE_AFTER_CALLS) return;
  _callsSinceRecycle = 0;
  const workerPromise = _workerPromise;
  _workerPromise = null;
  if (workerPromise) await (await workerPromise).terminate();
}

async function ocrText(pngBuffer) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(pngBuffer);
  await recycleWorkerIfDue();
  return text.trim();
}

// Dedicated reader for the 5-row record table specifically — separate from
// ocrText (still used as-is for the page counter, which is confirmed
// working correctly). Root-caused via a real debug screenshot: a bonus row
// shows "Slumberland"/"Points Gift" as plain text sitting far to the left of
// the rest of that row (replacing the usual dice icon), and Tesseract's
// default AUTO page-segmentation mode tries to detect separate columns/
// paragraphs — that isolated label is exactly the kind of thing AUTO
// misreads as its own zone, scrambling line order enough that the
// timestamp-anchored row splitter loses rows on pages containing one.
// SINGLE_BLOCK tells Tesseract to treat the whole crop as one uniform block
// instead of trying to detect layout structure, which this grid-like table
// actually is.
async function ocrTableText(pngBuffer) {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  let text;
  try {
    const result = await worker.recognize(pngBuffer);
    text = result.data.text;
  } finally {
    // Must finish resetting params on THIS worker instance before recycling
    // has any chance to terminate it — recycling used to run inside this
    // try block, so on the exact call where it triggered, this finally then
    // called setParameters on an already-terminated worker and hung
    // forever waiting for a reply that was never coming. Since the whole
    // capture run is one sequential await chain, that hang blocked
    // everything downstream, including the interruption checks ESC/Cancel
    // rely on — which is why neither could stop a run stuck here.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  }
  await recycleWorkerIfDue();
  return text.trim();
}

// Releases the worker. Call when a capture run ends — not after every OCR
// call, since re-creating it is the expensive part this caching avoids.
async function terminateOcr() {
  if (!_workerPromise) return;
  const workerPromise = _workerPromise;
  _workerPromise = null;
  const worker = await workerPromise;
  await worker.terminate();
}

module.exports = { ocrText, ocrTableText, terminateOcr };
