// Entry point for the elevated, Scheduled-Task-triggered worker process —
// see taskSchedulerSetup.js for how the task itself gets registered/
// triggered, and main.js's very top for the --nte-elevated-worker argv
// branch that routes a launch here instead of the normal app bootstrap.
//
// Runs standalone: no BrowserWindow (except whatever nteOverlay.js itself
// creates for the capture's click-glow), no single-instance lock, no
// renderer, no profile/settings bootstrap. Communicates with the main
// (non-elevated, always-running) app entirely through files — reads a job
// file, writes a result file (and periodic progress snapshots) to sibling
// paths, then exits. This file-based handoff exists because a Scheduled
// Task has no live IPC pipe back to whatever triggered it.

const fs = require('fs');
const { app } = require('electron');

function resultPathFor(jobPath) { return jobPath.replace(/\.json$/, '.result.json'); }
function progressPathFor(jobPath) { return jobPath.replace(/\.json$/, '.progress.json'); }
function cancelPathFor(jobPath) { return jobPath.replace(/\.json$/, '.cancel'); }

// Runs the actual capture, entirely within this elevated process — this is
// the whole point of the mechanism: SetForegroundWindow-based focus
// stealing (needed before any click can be trusted to land correctly) only
// works reliably from an elevated caller (confirmed live — see
// captureOrchestrator.js's header for the full investigation), so THIS
// process, not the always-running non-elevated main app, has to be the one
// that finds the window, focuses it, and drives every click. Mirrors
// main.js's 'nte:capture:start' in-process handler almost exactly, since
// that handler is the already-proven-working version of this same flow —
// only the outer plumbing (file-based job/result/progress instead of
// direct function calls and IPC) differs.
async function runCaptureJob(job, writeProgress, cancelPath) {
  const nteCapture = require('./capture');
  const nteOverlay = require('./overlay');
  const nteMouseWatcher = require('./mouseWatcher');
  const nteOrchestrator = require('./captureOrchestrator');

  // Set up just the one app.* property this pipeline actually needs
  // (packetCapture.js/debugLog.js) — everything else the normal app
  // bootstrap sets up (profiles, settings, windows) is deliberately skipped
  // in worker mode, since none of it is needed here.
  app.activeProfileDataDir = job.profileDataDir;

  const found = nteCapture.findNteWindow();
  if (!found) return { status: 'error', error: 'NTE window not found. Make sure the game is running.' };
  if (!nteCapture.isSupportedAspectRatio(found.bounds)) {
    return { status: 'error', error: 'NTE window has an unsupported aspect ratio (expected 16:9 or 16:10).' };
  }

  await nteCapture.focusWindow(found.hwnd);
  await new Promise(r => setTimeout(r, 200));

  if (job.overlayEnabled) nteOverlay.createOverlay(found.bounds);

  let interrupted = false;
  let abortReason = null;
  nteMouseWatcher.startWatchingPhysicalMouse(() => {
    interrupted = true;
    abortReason = 'mouse-moved';
  });

  // Deliberately does NOT check foreground/focus status — see main.js's
  // isRunAborted for why that check was tried, reverted, and never
  // belonged here either: it's a pre-existing Windows foreground-tracking
  // flakiness unrelated to whether clicks actually land correctly.
  //
  // The cancel-marker file check is this process's only way to learn about
  // a Cancel click or ESC press — those happen in the main (non-elevated)
  // app's own process, which has no live IPC/shared memory with this one,
  // only the same file-based protocol used for the job/result/progress
  // handoff (see taskSchedulerSetup.js's requestCancel).
  //
  // The job/cancel files are a single fixed path shared by every capture
  // attempt (Task Scheduler can't take per-invocation args), so the marker's
  // mere existence isn't enough — a Cancel from an earlier, already-finished
  // run could otherwise still be sitting there when THIS run starts polling,
  // aborting a capture the user never touched. taskSchedulerSetup.js tags
  // every cancel request with the run it was meant for; only honor it if it
  // matches this job's own id.
  function isRunAborted() {
    if (fs.existsSync(cancelPath)) {
      try {
        const markedFor = fs.readFileSync(cancelPath, 'utf8').trim();
        if (markedFor && markedFor === job.runId) {
          interrupted = true;
          abortReason = 'cancelled';
        }
      } catch (_) {}
    }
    return interrupted || !nteCapture.isWindowValid(found.hwnd);
  }

  try {
    const result = await nteOrchestrator.runCapture({
      windowBounds: found.bounds,
      calibration: job.calibration,
      isInterrupted: isRunAborted,
      onProgress: writeProgress,
      existingHistory: job.existingHistory,
    });

    if (result.status === 'completed') {
      return {
        status: 'completed',
        characterLimitedMerged: result.characterLimitedMerged,
        characterStandardMerged: result.characterStandardMerged,
        arcMerged: result.arcMerged,
        characterLimitedAdded: result.characterLimitedAdded,
        characterStandardAdded: result.characterStandardAdded,
        arcAdded: result.arcAdded,
      };
    }

    if (result.status === 'interrupted' || isRunAborted()) {
      const message = !interrupted
        ? 'Game window closed during capture.'
        : abortReason === 'mouse-moved'
          ? 'Physical mouse movement detected — capture aborted, nothing was saved.'
          : 'Capture interrupted — nothing was saved.';
      return { status: interrupted ? 'interrupted' : 'error', error: message };
    }

    return { status: 'error', error: result.error || 'Capture failed.' };
  } finally {
    nteOverlay.destroyOverlay();
    nteMouseWatcher.stopWatchingPhysicalMouse();
  }
}

async function runElevatedWorker(jobPath) {
  const resultPath = resultPathFor(jobPath);
  const progressPath = progressPathFor(jobPath);
  const cancelPath = cancelPathFor(jobPath);
  try { fs.unlinkSync(cancelPath); } catch (_) {} // clear any stale marker from a prior run

  let job;
  try {
    job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  } catch (e) {
    fs.writeFileSync(resultPath, JSON.stringify({ status: 'error', error: `Could not read job file: ${e.message}` }));
    return;
  }

  const writeProgress = (p) => {
    try { fs.writeFileSync(progressPath, JSON.stringify(p)); } catch (_) {}
  };

  try {
    if (job.type === 'capture') {
      const result = await runCaptureJob(job, writeProgress, cancelPath);
      fs.writeFileSync(resultPath, JSON.stringify(result));
      return;
    }

    fs.writeFileSync(resultPath, JSON.stringify({ status: 'error', error: `Unknown job type: ${job.type}` }));
  } catch (e) {
    fs.writeFileSync(resultPath, JSON.stringify({ status: 'error', error: e.message }));
  }
}

module.exports = { runElevatedWorker };
