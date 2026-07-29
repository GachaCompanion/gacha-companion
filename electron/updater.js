// Wraps electron-updater's autoUpdater. On launch, checks GitHub Releases
// (via the same publish config electron-builder uses to publish them — see
// package.json's build.publish). Nothing downloads automatically — the user
// is asked first (see App.js's update banner), and the downloaded installer
// is launched the NORMAL way (see installUpdate below) rather than via
// electron-updater's own silent `/S` install, so Windows' real SmartScreen
// warning (if any) actually has a chance to show up with a "Run anyway" the
// user can click through, instead of a silent background execution that
// antivirus can block with nothing for them to override.
const { autoUpdater } = require('electron-updater');
const fs   = require('fs');
const path = require('path');
const { app, shell } = require('electron');

// A silent failure here is otherwise completely invisible — the packaged
// app has no visible console, and every failure mode used to just vanish
// into a swallowed .catch(() => {}). This file exists specifically so a
// "why didn't it update?" report can actually be diagnosed.
function logPath() {
  return path.join(app.getPath('userData'), 'update-log.txt');
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try { fs.appendFileSync(logPath(), line); } catch (_) {}
}

let pendingInstallerPath = null;

function checkForUpdates(mainWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  log(`App version ${app.getVersion()} — checking for updates...`);

  autoUpdater.on('checking-for-update', () => log('checking-for-update'));
  autoUpdater.on('update-available', (info) => {
    log(`update-available: ${info.version}`);
    mainWindow?.webContents.send('update:available', { version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => log(`update-not-available (current: ${info.version})`));
  autoUpdater.on('download-progress', (p) => log(`download-progress: ${Math.round(p.percent)}%`));
  autoUpdater.on('error', (err) => log(`ERROR: ${err?.stack || err?.message || err}`));

  autoUpdater.on('update-downloaded', (info) => {
    log(`update-downloaded: ${info.version} -> ${info.downloadedFile}`);
    pendingInstallerPath = info.downloadedFile;
    markAsDownloaded(pendingInstallerPath);
    mainWindow?.webContents.send('update:ready');
  });

  autoUpdater.checkForUpdates().catch((e) => log(`checkForUpdates() rejected: ${e?.message}`));
}

// Marks the downloaded installer with Windows' "downloaded from the
// internet" zone marker — the same NTFS alternate-data-stream a browser
// attaches to anything it downloads. Without this, launching the file never
// triggers SmartScreen's interactive "Windows protected your PC" warning at
// all (that warning only fires for internet-zone files) — it just runs
// silently, or gets silently blocked by antivirus with zero recourse.
function markAsDownloaded(filePath) {
  try {
    fs.writeFileSync(`${filePath}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');
  } catch (e) {
    log(`Failed to mark installer as downloaded: ${e.message}`);
  }
}

function downloadUpdate() {
  log('User confirmed — starting download...');
  autoUpdater.downloadUpdate().catch((e) => log(`downloadUpdate() rejected: ${e?.message}`));
}

// Launches the installer the normal way (equivalent to double-clicking it in
// Explorer) instead of electron-updater's own silent quitAndInstall(), then
// quits this app so the installer can overwrite its files — see the file
// header for why.
async function installUpdate() {
  if (!pendingInstallerPath) return;
  log(`Launching installer normally: ${pendingInstallerPath}`);
  await shell.openPath(pendingInstallerPath);
  app.quit();
}

module.exports = { checkForUpdates, downloadUpdate, installUpdate, logPath };
