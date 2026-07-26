// Wraps electron-updater's autoUpdater. On launch, checks GitHub Releases
// (via the same publish config electron-builder uses to publish them — see
// package.json's build.publish) and silently downloads a newer version in
// the background if one exists. Actually installing is deferred until the
// user clicks the "Update ready" banner next to the Profile button (see
// App.js) — never forced automatically, so it doesn't interrupt whatever
// they're doing.
const { autoUpdater } = require('electron-updater');

function checkForUpdates(mainWindow) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update:ready');
  });

  // Errors (offline, no releases yet, etc.) should never surface to the
  // user — this is a background best-effort check, not a required step.
  autoUpdater.checkForUpdates().catch(() => {});
}

function installUpdate() {
  autoUpdater.quitAndInstall();
}

module.exports = { checkForUpdates, installUpdate };
