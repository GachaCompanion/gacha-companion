// Verifies that an expected screen state actually appeared after a
// synthetic click, since there's no OS API to confirm a SendInput click was
// acted on by the target app — a game rendered through Unreal doesn't
// expose a UI Automation tree the way a normal Win32/WPF control does. The
// only reliable signal is observing the resulting pixels (OCR text, or a
// specific color) with bounded retries, rather than trusting the click blindly.

const { captureRegion, regionContainsColor } = require('./screenCapture');
const { ocrText } = require('./ocr');

// Polls a fraction-rect region of the window until `predicate(text)` is
// true, or gives up after timeoutMs.
async function waitForText(windowBounds, fractionRect, predicate, { timeoutMs = 4000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastText = '';
  while (true) {
    const { png } = await captureRegion(windowBounds, fractionRect);
    lastText = await ocrText(png);
    if (predicate(lastText)) return { ok: true, lastText };
    if (Date.now() >= deadline) return { ok: false, lastText };
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Same idea, but for the #FDB50B-style color checks instead of text.
async function waitForColor(windowBounds, fractionRect, hex, { timeoutMs = 4000, intervalMs = 400, tolerance = 24 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const { raw } = await captureRegion(windowBounds, fractionRect);
    if (regionContainsColor(raw, hex, tolerance)) return { ok: true };
    if (Date.now() >= deadline) return { ok: false };
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

// Performs a click, then verifies it landed via waitForText; retries the
// click itself (not just the read) a bounded number of times, since a
// single missed SendInput event — not a systemic failure — is the expected
// failure mode here.
async function clickAndVerify(clickFn, windowBounds, fractionRect, predicate, opts = {}) {
  const { maxAttempts = 3, timeoutMs = 4000, intervalMs = 400 } = opts;
  let lastText = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    clickFn();
    const result = await waitForText(windowBounds, fractionRect, predicate, { timeoutMs, intervalMs });
    lastText = result.lastText;
    if (result.ok) return { ok: true, lastText, attempts: attempt };
  }
  return { ok: false, lastText, attempts: maxAttempts };
}

// Parses a page-counter string like "1 / 140" (OCR can introduce stray
// spaces) into { current, total }, or null if it doesn't look like one.
function parsePageCounter(text) {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return { current: parseInt(match[1], 10), total: parseInt(match[2], 10) };
}

// True once the counter reports we're on the last page (current === total).
function isLastPage(text) {
  const counter = parsePageCounter(text);
  return !!counter && counter.current === counter.total;
}

module.exports = { waitForText, waitForColor, clickAndVerify, parsePageCounter, isLastPage };
