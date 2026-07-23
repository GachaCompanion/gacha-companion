// Transparent, click-through, always-on-top window that renders an edge-glow
// effect over the NTE game window while a capture run controls the mouse —
// a visible "automation is in control" indicator, matching how a computer-use
// agent shows a screen-edge glow while driving the user's PC. Purely cosmetic:
// setIgnoreMouseEvents means it never intercepts input, and showInactive()
// means it never steals focus from the game window the capture is driving.

const { BrowserWindow } = require('electron');
const path = require('path');

let overlayWindow = null;

function createOverlay(bounds) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    updateOverlayBounds(bounds);
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'overlay-preload.js'),
    },
  });

  // 'screen-saver' is the highest alwaysOnTop level Electron exposes on
  // Windows — best chance of rendering above a borderless/fullscreen game.
  // Not guaranteed against a true exclusive-fullscreen swapchain; untested
  // against NTE specifically until this ships and is run against the game.
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.loadFile(path.join(__dirname, 'overlay-glow.html'));
  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive();
    // Windows clamps a window's bounds to the monitor's work area (i.e.
    // excludes the taskbar) when it's first created/shown — a documented
    // Electron behavior, not something specific to this window. A setBounds
    // call issued after the window already exists isn't clamped the same
    // way, so re-assert the real bounds once show has happened.
    overlayWindow?.setBounds(bounds);
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });

  return overlayWindow;
}

function updateOverlayBounds(bounds) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setBounds(bounds);
}

// Switches the overlay from its normal click-through cosmetic mode into a
// real click target, for calibration only. setIgnoreMouseEvents(false) is
// what actually makes Windows route input to this window at all (without
// it, the window is fully transparent to clicks regardless of anything in
// the page itself); the page's own pointer-events toggle (see
// overlay-glow.html) then decides whether a specific element within it is
// hit-testable. Both are needed together.
function enableCalibrationMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(false);
  overlayWindow.webContents.send('nte:overlay:enable-calibration');
}

function disableCalibrationMode() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.webContents.send('nte:overlay:disable-calibration');
}

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  overlayWindow = null;
}

// Diagnostic only: what Electron actually gave the window, which may differ
// from the bounds passed to createOverlay if something downstream (the OS,
// or Electron itself) clamped it.
function getOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  return overlayWindow.getBounds();
}

// Diagnostic: briefly flashes the glow red the instant a synthetic click
// fires, so it's visible on screen exactly when (and whether) a click was
// actually sent — added to help distinguish "click never fired" from "click
// fired but the game didn't register it" during arc-navigation debugging.
// No IPC/preload plumbing needed — the overlay is a plain cosmetic page, so
// this just runs a tiny script directly in it via executeJavaScript.
function flashClickIndicator(durationMs = 250) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.executeJavaScript(`
    (function() {
      var el = document.querySelector('.glow-edge');
      if (!el) return;
      el.classList.add('glow-edge--click');
      setTimeout(function() { el.classList.remove('glow-edge--click'); }, ${durationMs});
    })();
  `).catch(() => {});
}

module.exports = {
  createOverlay,
  updateOverlayBounds,
  destroyOverlay,
  getOverlayBounds,
  flashClickIndicator,
  enableCalibrationMode,
  disableCalibrationMode,
};
