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

// The update check starts immediately at app.whenReady, well before the
// renderer's React app has mounted and subscribed to onUpdateAvailable/
// onUpdateReady — confirmed live: the check can resolve in as little as ~1s,
// and there's no reliable guarantee it happens strictly before OR after the
// renderer is ready (confirmed both orderings happen across different
// launches). webContents.send() to a not-yet-listening renderer is simply
// lost (Electron doesn't queue/replay it), so relying on push delivery
// alone — even resent once at an "app is ready" handshake — is inherently
// racy in either direction.
//
// This tracks whatever the latest known state is (still pushed immediately
// when it changes, for the common case where the renderer's already up) AND
// exposes getPendingState() for the renderer to actively PULL once it mounts
// (see App.js) — a pull can never be "too early" or "too late" the way a
// push can, since it's the renderer itself asking "what's true right now?"
// after it's already guaranteed to be ready to act on the answer.
let pendingState = null; // { type: 'available', version } | { type: 'ready' } | null

function sendState(mainWindow, state) {
  if (!state) return;
  if (state.type === 'available') mainWindow?.webContents.send('update:available', { version: state.version });
  else if (state.type === 'ready') mainWindow?.webContents.send('update:ready');
}

function getPendingState() {
  return pendingState;
}

function checkForUpdates(mainWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  log(`App version ${app.getVersion()} — checking for updates...`);

  autoUpdater.on('checking-for-update', () => log('checking-for-update'));
  autoUpdater.on('update-available', (info) => {
    log(`update-available: ${info.version}`);
    pendingState = { type: 'available', version: info.version };
    sendState(mainWindow, pendingState);
  });
  autoUpdater.on('update-not-available', (info) => log(`update-not-available (current: ${info.version})`));
  autoUpdater.on('download-progress', (p) => log(`download-progress: ${Math.round(p.percent)}%`));
  autoUpdater.on('error', (err) => log(`ERROR: ${err?.stack || err?.message || err}`));

  autoUpdater.on('update-downloaded', (info) => {
    log(`update-downloaded: ${info.version} -> ${info.downloadedFile}`);
    pendingInstallerPath = info.downloadedFile;
    markAsDownloaded(pendingInstallerPath);
    pendingState = { type: 'ready' };
    sendState(mainWindow, pendingState);
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

module.exports = { checkForUpdates, downloadUpdate, installUpdate, logPath, getPendingState };
