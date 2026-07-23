// console.log truncates large arrays ("... N more items"), which made it
// impossible to actually see a full scan result once it grew past ~100
// entries. Anything that might be long gets written here instead, so the
// full contents are always inspectable after the fact rather than guessed at
// from a truncated console dump.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function debugDir() {
  const dir = path.join(app.activeProfileDataDir, 'nte', 'debug');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Ascending per-run file numbers (nte-debug-1.log, nte-debug-2.log, ...) —
// simpler to cross-reference a specific run against than one ever-growing
// appended file, per the user's explicit ask. Scans existing files rather
// than persisting a counter anywhere, so it stays correct even if files get
// manually deleted/renamed.
function nextDebugLogPath() {
  const dir = debugDir();
  const existing = fs.readdirSync(dir).filter(f => /^nte-debug-\d+\.log$/.test(f));
  const maxN = existing.reduce((max, f) => {
    const n = Number(f.match(/^nte-debug-(\d+)\.log$/)[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return path.join(dir, `nte-debug-${maxN + 1}.log`);
}

// Writes one file for a fully completed capture run: a totals header, a
// page-counter-mismatch summary, then per-banner per-page timing AND the
// actual decoded records captured on each page (name/category/rarity/
// rewardKey/time, plus where it came from — source ip:port, real capture
// timestamp, which pass). The point of including the real records (not just
// timing) is comparing two runs' logs page-by-page: a good run and a bad
// run should be identical except for the specific page(s) where they
// diverge, which pins down exactly what's different (an extra entry, a
// missing one, a different reward) instead of only knowing the final totals
// don't match. Deliberately only ever called by captureOrchestrator.js on a
// `status: 'completed'` result — an interrupted/errored run writes nothing,
// since a partial run's numbers would just be noise when scanning past runs
// for real gaps.
function writeCaptureDebugLog(totals, pageTimingsByBanner, recordsByBannerAndPage) {
  try {
    const filePath = nextDebugLogPath();
    // Pulled to the top of the file, above the raw per-page JSON, so a
    // page-counter desync (see navigation.js's pageMismatch check) is
    // visible at a glance instead of requiring a scan through hundreds of
    // page entries per banner.
    const mismatches = [];
    for (const [banner, timings] of Object.entries(pageTimingsByBanner)) {
      for (const t of timings ?? []) {
        if (t.pageMismatch) mismatches.push({ banner, ...t.pageMismatch, pageIndex: t.pageIndex });
      }
    }
    const lines = [
      `[${new Date().toISOString()}] Totals — Limited: ${totals.characterLimited}, Standard: ${totals.characterStandard}, Arc: ${totals.arc}`,
      `Page-counter mismatches: ${mismatches.length}`,
      ...mismatches.map(m => `  ${m.banner} page ${m.pageIndex}: expected ${m.expected}, on-screen reported ${m.actual ?? '(unparseable)'} (${m.reason})`),
      '',
    ];
    for (const [banner, timings] of Object.entries(pageTimingsByBanner)) {
      const recordsByPage = recordsByBannerAndPage?.[banner] ?? {};
      lines.push(`[${banner}] page timings`, JSON.stringify(timings, null, 2), '');
      lines.push(`[${banner}] captured records by page`, JSON.stringify(recordsByPage, null, 2), '');
    }
    fs.writeFileSync(filePath, lines.join('\n'));
    return filePath;
  } catch (e) {
    console.log('[nte debug log] failed to write', e.message);
    return null;
  }
}

module.exports = { writeCaptureDebugLog, debugDir };
