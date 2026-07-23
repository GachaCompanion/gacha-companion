// Registers, queries, triggers, and unregisters the Windows Scheduled Task
// that lets NTE captures run elevated (mouse-focus control + pktmon) WITHOUT
// a UAC prompt on every single sync. Empirically proven live before this was
// built: a task registered with /RL HIGHEST (one real elevation prompt, the
// same Start-Process -Verb RunAs pattern packetCapture.js already uses) can
// afterward be triggered via `schtasks /run` an unlimited number of times
// with zero further prompts, confirmed across several repeat triggers.
//
// Task Scheduler does NOT support passing different arguments to `/run` per
// invocation — a task's action (full command line, including arguments) is
// fixed at registration time. So instead of a per-sync job file path, this
// uses ONE fixed, well-known job file that the caller overwrites before each
// trigger (fine — captures already can't run concurrently, guarded by
// nteCaptureActive in main.js) and polls a sibling result file for
// completion (see elevatedWorker.js for the file-based protocol itself).
//
// The task's action points at PORTABLE_EXECUTABLE_FILE (electron-builder's
// env var for the REAL, stable path of the portable .exe the user actually
// double-clicks) rather than process.execPath — this app ships as a
// portable .exe (see package.json's build.win.target), which re-extracts to
// a NEW temp directory on every launch, so process.execPath would point at
// a directory that's already gone by the time the task runs again later. In
// dev (npm start/run dev), PORTABLE_EXECUTABLE_FILE isn't set at all, so
// this falls back to process.execPath (node_modules/electron's own
// electron.exe) plus the app directory as its first argument, matching
// `electron .`.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app } = require('electron');

const TASK_NAME = 'GachaCompanionNteWorker';

function jobPath() {
  return path.join(app.getPath('temp'), 'gacha-companion-nte-elevated-job.json');
}

function resultPath() { return jobPath().replace(/\.json$/, '.result.json'); }
function progressPath() { return jobPath().replace(/\.json$/, '.progress.json'); }
function cancelPath() { return jobPath().replace(/\.json$/, '.cancel'); }
function escSuppressPath() { return jobPath().replace(/\.json$/, '.esc-suppress'); }

// The capture sequence itself sends synthetic ESC presses (via SendInput —
// see navigation.js's navigateToArcRecords/exitToPullScreen) to close the
// game's own Records modal mid-run. Those are indistinguishable, at the
// Windows global-hotkey level, from a real ESC keypress: main.js registers
// globalShortcut('Escape') for the whole capture duration so the USER can
// cancel by pressing Escape, and RegisterHotKey (what globalShortcut uses
// under the hood) fires on synthetic SendInput-injected keystrokes exactly
// the same as real ones. Confirmed as the actual cause of "Capture
// interrupted" firing every time right after the standard-board walk — that
// is the first point navigateToArcRecords sends its own ESC, which was
// self-triggering the user-cancel handler and writing a cancel marker
// tagged with the run's own (correctly matching) id. The earlier stale-
// marker/run-id fix didn't address this — it solved a different, real but
// not-the-actual-culprit race.
//
// elevatedWorker.js calls markSyntheticEscape() immediately before every
// synthetic ESC it sends; requestCancel() ignores an Escape-triggered
// cancel that lands within SUPPRESS_WINDOW_MS of one of those marks, since
// within that window an incoming Escape is overwhelmingly the capture's own
// injected key rather than the user's.
const SUPPRESS_WINDOW_MS = 1000;

function markSyntheticEscape() {
  try { fs.writeFileSync(escSuppressPath(), String(Date.now())); } catch (_) {}
}

function isWithinSyntheticEscapeSuppressWindow() {
  try {
    const markedAt = Number(fs.readFileSync(escSuppressPath(), 'utf8'));
    return Number.isFinite(markedAt) && (Date.now() - markedAt) < SUPPRESS_WINDOW_MS;
  } catch (_) {
    return false;
  }
}

// The job/result/progress/cancel files are a single fixed path shared by
// every capture attempt (Task Scheduler can't take per-invocation args — see
// the file header). Without a way to tell "this cancel is for the run
// happening right now" apart from "this cancel is a leftover from an earlier,
// already-finished attempt", a Cancel/ESC press whose marker write landed
// just after one run ended could get silently picked up by the NEXT run
// instead — the bug behind "Capture interrupted" firing on a run the user
// never touched. activeRunId tracks whichever run is currently in flight so
// requestCancel can tag the marker with it, and elevatedWorker.js only
// honors a cancel marker whose id matches its own job's id.
let activeRunId = null;

// Cancel/ESC in the main app have no way to reach the elevated worker
// directly — it's a separate OS process with no shared memory or live IPC,
// only this same file-based protocol. Creating this marker file is the
// entire mechanism; elevatedWorker.js's isRunAborted polls for it.
function requestCancel() {
  if (!activeRunId) return; // nothing running right now — nothing to cancel
  if (isWithinSyntheticEscapeSuppressWindow()) return; // this Escape was the capture's own synthetic keypress, not the user's
  try { fs.writeFileSync(cancelPath(), activeRunId); } catch (_) {}
}

function targetExePath() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

// Only needed in dev — the packaged portable .exe is self-contained and
// needs no extra argument to know what app to run.
function targetExeArgsPrefix() {
  return process.env.PORTABLE_EXECUTABLE_FILE ? [] : [path.join(__dirname, '..', '..', '..')];
}

function launcherVbsPath() {
  return path.join(app.getPath('temp'), 'gacha-companion-nte-worker-launcher.vbs');
}

// Doubles embedded quotes, per VBScript's own string-literal escaping rule
// (VBScript has no backslash-escape convention — a literal " inside a "
// string is written as two consecutive quote characters).
function vbsStringLiteral(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

// A launcher script, not an inline command line, is the task's actual
// action. Confirmed live this matters for two separate reasons:
//   1. Passing a "quoted exe path + quoted args" string as a single /tr
//      value goes through THREE layers of quoting (this file's JS template
//      string -> the .ps1 script -> schtasks.exe's own parsing of quoted
//      sub-parts within /tr) and silently mis-parsed somewhere in that
//      chain — schtasks reported success but the task never actually got
//      created with the intended action.
//   2. A .bat launcher fixed (1) but introduced its own visible problem:
//      Task Scheduler running a .bat directly always shows a real cmd.exe
//      console window — there's no flag to suppress it, confirmed live.
// A VBScript launcher invoked via wscript.exe fixes both: WScript.Shell's
// Run method takes a window-style argument (0 = hidden) that genuinely
// suppresses any window, and schtasks only ever needs a simple two-token
// /tr value (wscript.exe + a single quoted path to this script) rather
// than the original multi-part quoted command line.
function writeLauncherVbs() {
  const exe = targetExePath();
  const prefixArgs = targetExeArgsPrefix();
  const argParts = [exe, ...prefixArgs].map(a => `"${a}"`).concat([`--nte-elevated-worker="${jobPath()}"`]);
  const commandLine = argParts.join(' ');
  const content = [
    'Set objShell = CreateObject("WScript.Shell")',
    `objShell.Run ${vbsStringLiteral(commandLine)}, 0, False`,
  ].join('\r\n');
  fs.writeFileSync(launcherVbsPath(), content);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

async function isTaskRegistered() {
  const { code } = await run('schtasks', ['/query', '/tn', TASK_NAME]);
  return code === 0;
}

// Registration itself requires elevation (creating an /RL HIGHEST task is an
// administrative operation) — this is the ONE prompt the whole mechanism
// costs, ever, unless the task is later deleted/re-registered. Same
// elevated-script-plus-done-marker pattern as packetCapture.js's
// runElevatedPktmonScript, reused verbatim rather than re-invented.
async function registerTask() {
  const dir = path.join(app.getPath('temp'), 'gacha-companion-task-setup');
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'register.ps1');
  const logPath = path.join(dir, 'register.log');
  const donePath = path.join(dir, 'register.done');
  const failPath = path.join(dir, 'register.fail');
  try { fs.unlinkSync(donePath); } catch (_) {}
  try { fs.unlinkSync(failPath); } catch (_) {}

  writeLauncherVbs();

  // Explicitly checks $LASTEXITCODE after schtasks runs — confirmed live
  // that PowerShell does NOT stop a script or treat a non-zero exit from an
  // external command as an error by default, so without this check a
  // failing `schtasks /create` would silently fall through to the "ok"
  // marker below exactly as if it had succeeded (which is exactly what
  // happened the first time this was built: the elevated script itself ran
  // fine, so the done-marker existed, even though schtasks never actually
  // registered anything).
  const scriptLines = [
    `"" | Out-File -FilePath "${logPath}" -Encoding utf8`,
    `schtasks /create /tn "${TASK_NAME}" /tr "wscript.exe \`"${launcherVbsPath()}\`"" /sc once /st 00:00 /rl highest /f *>> "${logPath}"`,
    `if ($LASTEXITCODE -ne 0) { "fail" | Out-File -FilePath "${failPath}" -Encoding utf8 } else { "ok" | Out-File -FilePath "${donePath}" -Encoding utf8 }`,
  ];
  fs.writeFileSync(scriptPath, scriptLines.join('\r\n'));

  await new Promise((resolve, reject) => {
    const inner = `-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    const outer = spawn('powershell.exe', [
      '-NoProfile', '-Command',
      `Start-Process powershell -ArgumentList '${inner}' -Verb RunAs -Wait -WindowStyle Hidden`,
    ], { windowsHide: true });

    let stderr = '';
    outer.stderr.on('data', d => { stderr += d.toString(); });
    outer.on('error', reject);
    outer.on('close', code => {
      if (code !== 0) return reject(new Error(`Elevated task registration failed to launch (exit ${code}): ${stderr}`));
      resolve();
    });
  });

  if (fs.existsSync(failPath)) {
    let log = '';
    try { log = fs.readFileSync(logPath, 'utf8'); } catch (_) {}
    throw new Error(`schtasks /create failed. Log:\n${log}`);
  }

  if (!fs.existsSync(donePath)) {
    let log = '';
    try { log = fs.readFileSync(logPath, 'utf8'); } catch (_) {}
    throw new Error(`Task registration did not complete (UAC declined, or schtasks failed). Log:\n${log}`);
  }

  // Belt-and-suspenders: actually re-query the task rather than trusting
  // the done marker alone, given the done marker already lied once.
  const stillRegistered = await isTaskRegistered();
  if (!stillRegistered) {
    throw new Error('schtasks reported success but the task cannot be found afterward — registration did not actually take effect.');
  }
}

// Deletion also requires elevation (confirmed live: /delete on an /RL
// HIGHEST task returns "Access is denied" from a non-elevated caller) —
// same pattern again.
async function unregisterTask() {
  const dir = path.join(app.getPath('temp'), 'gacha-companion-task-setup');
  fs.mkdirSync(dir, { recursive: true });
  const scriptPath = path.join(dir, 'unregister.ps1');
  const logPath = path.join(dir, 'unregister.log');
  const donePath = path.join(dir, 'unregister.done');
  try { fs.unlinkSync(donePath); } catch (_) {}

  const scriptLines = [
    `"" | Out-File -FilePath "${logPath}" -Encoding utf8`,
    `schtasks /delete /tn "${TASK_NAME}" /f *>> "${logPath}"`,
    `"ok" | Out-File -FilePath "${donePath}" -Encoding utf8`,
  ];
  fs.writeFileSync(scriptPath, scriptLines.join('\r\n'));

  await new Promise((resolve, reject) => {
    const inner = `-NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
    const outer = spawn('powershell.exe', [
      '-NoProfile', '-Command',
      `Start-Process powershell -ArgumentList '${inner}' -Verb RunAs -Wait -WindowStyle Hidden`,
    ], { windowsHide: true });
    outer.on('error', reject);
    outer.on('close', () => resolve());
  });
}

// Writes the job, clears any stale result/progress from a prior run,
// triggers the pre-authorized task (no elevation, no prompt), then polls
// the result file until it appears or timeoutMs elapses. onProgress is
// called with each distinct progress snapshot the worker writes.
async function triggerTaskAndWaitForResult(job, { onProgress, timeoutMs = 20 * 60 * 1000, pollIntervalMs = 500 } = {}) {
  const jp = jobPath();
  const rp = resultPath();
  const pp = progressPath();

  const runId = crypto.randomUUID();
  activeRunId = runId;

  try { fs.unlinkSync(rp); } catch (_) {}
  try { fs.unlinkSync(pp); } catch (_) {}
  try { fs.unlinkSync(cancelPath()); } catch (_) {}
  try { fs.unlinkSync(escSuppressPath()); } catch (_) {}
  fs.writeFileSync(jp, JSON.stringify({ ...job, runId }));

  try {
    const { code, stderr } = await run('schtasks', ['/run', '/tn', TASK_NAME]);
    if (code !== 0) {
      throw new Error(`Failed to trigger elevated task (exit ${code}): ${stderr || 'unknown error'}`);
    }

    const startedAt = Date.now();
    let lastProgressJson = null;
    while (Date.now() - startedAt < timeoutMs) {
      if (fs.existsSync(rp)) {
        try {
          return JSON.parse(fs.readFileSync(rp, 'utf8'));
        } catch (_) {
          // Result file mid-write — try again next tick rather than fail on a
          // torn read.
        }
      }
      if (onProgress) {
        try {
          const raw = fs.readFileSync(pp, 'utf8');
          if (raw !== lastProgressJson) {
            lastProgressJson = raw;
            onProgress(JSON.parse(raw));
          }
        } catch (_) {}
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    throw new Error('Elevated capture task timed out waiting for a result — it may still be running.');
  } finally {
    // Only clear if nothing newer has already taken over (defensive — in
    // practice a new run can't start until this one's promise settles).
    if (activeRunId === runId) activeRunId = null;
  }
}

module.exports = {
  TASK_NAME,
  jobPath,
  resultPath,
  progressPath,
  cancelPath,
  markSyntheticEscape,
  requestCancel,
  isTaskRegistered,
  registerTask,
  unregisterTask,
  triggerTaskAndWaitForResult,
};
