// ─────────────────────────────────────────────────────────────────────────
// STANDING RULE (set 2026-07-12, following a data-loss incident): do not
// modify the logic in this file unless the user explicitly asks you to
// change something here specifically. This exists as an independent safety
// net BECAUSE a bug in the normal save path silently destroyed pull-log
// data — the whole point is that it must not be touched incidentally while
// working on other things, however reasonable that edit seems in the
// moment. If a future change elsewhere seems to require touching this file,
// stop and ask first.
//
// CommonJS on purpose (not import/export) — required directly by
// electron/main.js (plain Node, not bundled by CRA's webpack), independent
// of the renderer's save pipeline in src/hooks/useStorage.js.
//
// What this does: keeps a small rotating history of timestamped pull-log
// snapshots per game/account, and only ever accepts a new snapshot if it's
// a proper superset of the last one (every entry that was in the last
// snapshot is still present, plus optionally more). A pull log that shrinks
// or has entries replaced is rejected — nothing is written, and the
// existing snapshots are left exactly as they are.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const MAX_SNAPSHOTS = 5;
const SNAPSHOT_DIR_NAME = 'pull-log-backups';

// Pull entries don't share one universal id field across all 4 games, so
// build a stable composite key from whatever identifying fields are present.
function entryKey(entry) {
  return JSON.stringify([
    entry?.id ?? null,
    entry?.time ?? null,
    entry?.name ?? null,
    entry?.roll ?? null,
    entry?.pity ?? null,
  ]);
}

function isSupersetOf(newLog, oldLog) {
  if (!Array.isArray(oldLog) || oldLog.length === 0) return true;
  if (!Array.isArray(newLog) || newLog.length < oldLog.length) return false;
  const newKeys = new Set(newLog.map(entryKey));
  return oldLog.every(e => newKeys.has(entryKey(e)));
}

function listSnapshots(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter(f => f.endsWith('.json')).sort();
}

function readLatestSnapshot(backupDir) {
  const files = listSnapshots(backupDir);
  if (files.length === 0) return [];
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir, files[files.length - 1]), 'utf8'));
  } catch {
    // Existing snapshot unreadable — treat as no prior data, but never delete it.
    return [];
  }
}

// gameDataDir: the game/account's own data directory (same one data.json lives in).
// pullLog: the array about to be considered for backup.
// Returns { ok, reason } — ok:false means nothing was written, on-disk snapshots untouched.
function checkAndBackupPullLog(gameDataDir, pullLog) {
  if (!Array.isArray(pullLog)) return { ok: false, reason: 'pullLog is not an array — skipped' };

  const backupDir = path.join(gameDataDir, SNAPSHOT_DIR_NAME);
  fs.mkdirSync(backupDir, { recursive: true });

  const existing = readLatestSnapshot(backupDir);

  if (existing.length > 0 && !isSupersetOf(pullLog, existing)) {
    return {
      ok: false,
      reason: `rejected — new pull log (${pullLog.length} entries) is not a superset of the last snapshot (${existing.length} entries); leaving existing snapshots untouched`,
    };
  }
  if (existing.length > 0 && pullLog.length === existing.length) {
    return { ok: true, reason: 'unchanged since last snapshot — nothing to write' };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(backupDir, `pullLog-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(pullLog, null, 2));

  const files = listSnapshots(backupDir);
  while (files.length > MAX_SNAPSHOTS) {
    fs.unlinkSync(path.join(backupDir, files.shift()));
  }

  return { ok: true, reason: `snapshot written (${pullLog.length} entries)` };
}

module.exports = { checkAndBackupPullLog, isSupersetOf, entryKey };
