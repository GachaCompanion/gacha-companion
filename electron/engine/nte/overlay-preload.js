// Preload for overlay-glow.html — exposes just enough for calibration mode:
// main.js toggling the overlay's own click-hit-area on/off, and the overlay
// reporting back where a right-click landed (as a fraction of its own
// viewport, which is sized to exactly match the game window's bounds — see
// overlay.js's createOverlay). No node integration, contextIsolation stays
// on, same as every other renderer in this app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onEnableCalibration: (cb) => ipcRenderer.on('nte:overlay:enable-calibration', cb),
  onDisableCalibration: (cb) => ipcRenderer.on('nte:overlay:disable-calibration', cb),
  reportCalibrationClick: (x, y) => ipcRenderer.send('nte:overlay:calibration-click', { x, y }),
});
