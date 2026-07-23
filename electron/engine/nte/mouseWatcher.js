// Manages the mouseWatcherProcess.js child process — spawns it for the
// duration of a capture run (physical-mouse-movement abort), relays its
// detections to the caller, and kills it on stop. See mouseWatcherProcess.js
// for why the actual hook has to run in a separate process rather than
// here.
//
// Used to also drive calibration (a 'click' mode watching for a right-click
// anywhere on screen) — removed once confirmed live that NTE's own window
// never passes a right-click through the hook chain to this process at all
// (consistent with the game installing its own input hook ahead of others,
// a common basic anti-macro measure). Calibration now catches the click on
// our own overlay window instead — see main.js's nte:calibrate:start and
// overlay.js's enableCalibrationMode.

const { fork } = require('child_process');
const path = require('path');

let child = null;

function startWatchingPhysicalMouse(onDetected) {
  if (child) return; // already watching — only one run at a time

  child = fork(path.join(__dirname, 'mouseWatcherProcess.js'), [], { silent: true });
  child.on('message', (msg) => {
    if (msg === 'mouse-moved') {
      onDetected();
    } else if (typeof msg === 'string' && msg.startsWith('hook-failed')) {
      console.error(`[nte capture] mouse-watcher child failed to install its hook — ${msg}. Physical mouse movement will NOT be detected this run.`);
    }
  });
  child.stderr?.on('data', (d) => console.error('[nte capture] mouse-watcher child stderr:', d.toString()));
  child.on('error', (e) => console.error('[nte capture] mouse-watcher child process error:', e.message));
}

function stopWatching() {
  if (!child) return;
  child.kill();
  child = null;
}

module.exports = {
  startWatchingPhysicalMouse,
  stopWatchingPhysicalMouse: stopWatching,
};
