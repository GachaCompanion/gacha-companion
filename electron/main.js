const { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { checkAndBackupPullLog } = require('../src/features/gacha-tracker/engine/pullLogBackup.js');

// Node's fetch() (undici) tries a host's IPv6 address first when DNS returns
// both families, and its fallback-to-IPv4 on a stalled/blackholed IPv6 route
// is much slower/less reliable than a browser's. On networks where IPv6 is
// broken (confirmed on this machine — enka.network's IPv6 address timed out
// while the same request over IPv4 succeeded instantly), every fetch() call
// in the main process (enkaFetch.js, framingSync.js, etc.) hangs until the
// connection times out. Forcing IPv4-first here — before anything else in
// this file runs — fixes it without depending on the network ever repairing
// IPv6 on its own.
dns.setDefaultResultOrder('ipv4first');

const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { parsePaimonMoe, parseExcelMoe, detectMismatch, mergeJsonIntoExcel } = require('./engine/genshin/genshinParse');
const { fetchGenshinBanners } = require('./engine/genshin/bannerFetch');
const { parseHsrExcel } = require('./engine/hsr/hsrParse');
const { fetchRepoFile, fetchRepoBuffer, fetchRepoFileConditional } = require('./engine/dataRepo');
const { buildPaimonExport, buildExcelExport } = require('./engine/genshin/genshinHistoryExport');
const { buildHsrDatExport } = require('./engine/hsr/hsrHistoryExport');
const { buildZzzRngMoeExport } = require('./engine/zzz/zzzHistoryExport');
const { buildWuwaTrackerExport } = require('./engine/wuwa/wuwaHistoryExport');
const releasedIds = require('./engine/releasedIds');
const { fetchEnkaUid: _fetchEnkaUid, fetchByGame: _fetchByGame } = require('./engine/showcase/enkaFetch');
const { fetchAndNormalizeHsr } = require('./engine/showcase/hsrNormalizer');
const live2d = require('./live2d');
const { ensureCharImage, ensureCharIcon } = require('./charImages');
const { syncFraming } = require('./framingSync');
const fonts = require('./Fonts');
const nteCapture = require('./engine/nte/capture');
const nteOverlay = require('./engine/nte/overlay');
const nteMouseWatcher = require('./engine/nte/mouseWatcher');
const nteTaskScheduler = require('./engine/nte/taskSchedulerSetup');

// ─── Elevated worker mode ───────────────────────────────────────────────────
// If launched with --nte-elevated-worker=<jobFilePath>, this process IS the
// Scheduled-Task-triggered elevated worker (see engine/nte/elevatedWorker.js
// and engine/nte/taskSchedulerSetup.js) — a completely separate concern from
// a normal app launch, used to run NTE captures without a UAC prompt on
// every sync (the task itself is authorized once, up front). Checked BEFORE
// app.requestSingleInstanceLock() below on purpose: the portable .exe
// relaunched this way is a literal second OS process, and the single-
// instance lock would otherwise just forward it into the already-running
// main window instead of letting it do its actual job. Runs the job,
// writes its result, exits — no window, no menu, no normal bootstrap.
const elevatedWorkerArg = process.argv.find(a => a.startsWith('--nte-elevated-worker='));
if (elevatedWorkerArg) {
  const jobPath = elevatedWorkerArg.slice('--nte-elevated-worker='.length);
  const { runElevatedWorker } = require('./engine/nte/elevatedWorker');
  app.whenReady().then(async () => {
    await runElevatedWorker(jobPath);
    app.exit(0);
  });
} else {

Menu.setApplicationMenu(null);

// Cap the compositor frame rate to 60fps on all displays.
// Fixes a 1px vertical background shift that only appears on 240Hz monitors,
// caused by subpixel rounding differences at high vsync rates.
app.commandLine.appendSwitch('max-fps', '60');

let mainWindow    = null;

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.whenReady().then(showAlreadyRunningPopup);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const dataRoot = path.join(app.getPath('userData'), 'storage');
    fs.mkdirSync(dataRoot, { recursive: true });

    // One-time migration for installs that predate multi-profile support.
    if (!fs.existsSync(getProfilesIndexPath(dataRoot))) migrateToProfiles(dataRoot);

    const profilesIndex = readProfilesIndex(dataRoot);
    app.dataRoot          = dataRoot;
    app.profilesIndexPath = getProfilesIndexPath(dataRoot);
    app.activeProfileId   = profilesIndex.activeProfileId;

    const profileDir = getProfileDir(dataRoot, app.activeProfileId);
    const storagePath = path.join(profileDir, 'user.json');
    ensureStorage(storagePath);
    app.storagePath = storagePath;

    const bgDir = path.join(profileDir, 'backgrounds');
    if (!fs.existsSync(bgDir)) fs.mkdirSync(bgDir, { recursive: true });
    app.backgroundsDir = bgDir;
    app.iconsDir       = path.join(profileDir, 'icons');

    // Per-account game data (pull history, pity, backups) — scoped to the
    // active profile. Re-fetchable caches (banner schedules, banner images)
    // are NOT profile-scoped — see app.*CacheDir below.
    app.activeProfileDataDir = path.join(profileDir, 'data');
    app.genshinCacheDir = path.join(dataRoot, 'cache', 'genshin');
    app.hsrCacheDir     = path.join(dataRoot, 'cache', 'hsr');
    app.zzzCacheDir     = path.join(dataRoot, 'cache', 'zzz');
    app.nteCacheDir     = path.join(dataRoot, 'cache', 'nte');
    app.wuwaCacheDir    = path.join(dataRoot, 'cache', 'wuwa');

    releasedIds.init({ hsr: app.hsrCacheDir, zzz: app.zzzCacheDir });

    // Shared across all profiles — Live2D downloads, showcase images, HSR
    // asset cache. Not account-specific, so re-downloading per-profile would
    // be wasteful.
    app.showcasesDir   = path.join(dataRoot, 'showcases');
    app.live2dDir      = path.join(app.showcasesDir, 'live2d');
    app.pngDir         = path.join(app.showcasesDir, 'png');

    // One-time migration: move old flat live2d/ into showcases/live2d/.
    const oldLive2dDir = path.join(dataRoot, 'live2d');
    if (fs.existsSync(oldLive2dDir) && !fs.existsSync(app.live2dDir)) {
      fs.mkdirSync(app.showcasesDir, { recursive: true });
      fs.renameSync(oldLive2dDir, app.live2dDir);
    }
    fs.mkdirSync(app.live2dDir, { recursive: true });
    fs.mkdirSync(app.pngDir,    { recursive: true });

    // Create the window (and register it as a native OS drag-and-drop target) before
    // starting any local servers or network fetches below. Windows registers OLE
    // drag-and-drop on the HWND at creation time, and running concurrent async I/O
    // (multiple http servers binding + a GitHub fetch) at that exact moment corrupts
    // the registration — every dragged file then shows the "blocked" cursor app-wide,
    // even though nothing in the renderer or window config itself is wrong. Content
    // isn't loaded into the window until loadWindowContent() runs, after startup work
    // below finishes, so the servers are already up by the time the renderer needs them.
    createWindow();

    // Sync pre-computed framing data from GitHub in the background — no blocking.
    syncFraming(app.live2dDir, app.pngDir).catch(() => {});

    // Start the local background file server and store the port so the renderer
    // can fetch it via IPC. The server must be ready before loadWindowContent() so
    // the renderer never calls background:server-port before it exists.
    const { server: bgSrv, port: bgPort } = await startBgServer(bgDir);
    app.bgServer     = bgSrv;
    app.bgServerPort = bgPort;
    app.on('before-quit', () => bgSrv.close());

    // Live2D assets ride the same local-server pattern (CORS + webp mime),
    // served from app.live2dDir so spine-webgl can load them by URL.
    const { server: l2dSrv, port: l2dPort } = await startBgServer(app.live2dDir);
    app.live2dServer     = l2dSrv;
    app.live2dServerPort = l2dPort;
    app.on('before-quit', () => l2dSrv.close());

    // Showcases assets server — serves images/zzz/*.png for character backgrounds.
    const { server: scSrv, port: scPort } = await startBgServer(app.showcasesDir);
    app.showcasesServer     = scSrv;
    app.showcasesServerPort = scPort;
    app.on('before-quit', () => scSrv.close());

    // Per-game auto-detected font server (see electron/Fonts.js) — streams a game's
    // own real font from its install folder, if installed; falls back to the app's
    // default (Lato) in the renderer when a request 404s.
    const { server: fontSrv, port: fontPort } = await fonts.startFontServer();
    app.fontsServer     = fontSrv;
    app.fontsServerPort = fontPort;
    app.on('before-quit', () => fontSrv.close());

    // Live2D download + framing is now driven by the loading screen (renderer
    // loops live2d:ensure per character so it can show progress), not here.

    // One-time cleanup: remove deprecated files left over from older versions.
    const deprecated = [
      path.join(app.hsrCacheDir, 'banner-schedule.json'),
      path.join(app.hsrCacheDir, 'name-id-map.json'),
    ];
    for (const f of deprecated) {
      try { fs.unlinkSync(f); } catch (_) {}
    }

    loadWindowContent();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
} // close the elevated-worker-mode / normal-app-bootstrap branch from the top of this file

// ─── Background HTTP server ───────────────────────────────────────────────────
// Serves files from app.backgroundsDir over a local-only HTTP server.
// Using a real HTTP server instead of a custom Electron protocol gives <video>
// elements proper range-request (206 Partial Content) support, which is required
// for buffering, seeking, and hardware decode. Bound to 127.0.0.1 only — not
// reachable from outside the machine. Port 0 lets the OS pick a free port.
function startBgServer(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const filename = decodeURIComponent(
          new URL(req.url, 'http://localhost').pathname.slice(1)
        );
        // Prevent path traversal: resolved path must stay inside dir.
        const filePath = path.resolve(dir, filename);
        if (!filePath.startsWith(dir + path.sep) && filePath !== dir) {
          res.writeHead(403); res.end(); return;
        }
        if (!fs.existsSync(filePath)) {
          res.writeHead(404); res.end(); return;
        }
        const stat  = fs.statSync(filePath);
        const total = stat.size;
        const ext   = path.extname(filename).toLowerCase().slice(1);
        const mime  = ({
          mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
        })[ext] ?? 'application/octet-stream';

        // Allow canvas.toDataURL() on video frames drawn from this server.
        // Without this header the canvas is "tainted" (cross-origin) and toDataURL throws.
        const cors = { 'Access-Control-Allow-Origin': '*' };

        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          // Parse "bytes=start-end" — end is optional (means last byte).
          const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(startStr, 10);
          const end   = endStr ? parseInt(endStr, 10) : total - 1;
          res.writeHead(206, {
            ...cors,
            'Content-Range':  `bytes ${start}-${end}/${total}`,
            'Accept-Ranges':  'bytes',
            'Content-Length': end - start + 1,
            'Content-Type':   mime,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            ...cors,
            'Content-Length': total,
            'Content-Type':   mime,
            'Accept-Ranges':  'bytes',
          });
          fs.createReadStream(filePath).pipe(res);
        }
      } catch (_) {
        try { res.writeHead(500); res.end(); } catch (__) {}
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ─── Window helpers ───────────────────────────────────────────────────────────

// Ask Windows 11 DWM to round this window's corners.
// thickFrame:false removes WS_THICKFRAME — the style Windows 11 uses as a signal to auto-round.
// The opt-in API (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2) explicitly requests
// rounding even without WS_THICKFRAME.
// Uses koffi (N-API based FFI — ABI-stable, no electron-rebuild needed) for a synchronous
// in-process DLL call. Silently no-ops on Windows 10 (DWM returns an error, we ignore it).
// Intercept WM_NCHITTEST and return HTCLIENT for every position.
// Without this, Windows claims the right and bottom edge pixels as non-client
// resize/border areas even with resizable:false + thickFrame:false.
// Window dragging is unaffected — it is handled by JS in TitleBar.js.
let _originalWndProc  = null;
let _wndProcCallback  = null;

function hookNchittest(win) {
  if (process.platform !== 'win32') return;
  try {
    const koffi   = require('koffi');
    const user32  = koffi.load('user32.dll');
    const gdi32   = koffi.load('gdi32.dll');

    const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)');
    const SetWindowLongPtrW = user32.func('intptr __stdcall SetWindowLongPtrW(intptr hwnd, int index, intptr newLong)');
    const CallWindowProcW   = user32.func('intptr __stdcall CallWindowProcW(intptr prev, intptr hwnd, uint32 msg, uintptr wParam, intptr lParam)');
    const GetClientRect     = user32.func('bool __stdcall GetClientRect(intptr hwnd, void* lpRect)');
    const FillRect          = user32.func('int __stdcall FillRect(intptr hDC, void* lprc, intptr hbr)');
    const CreateSolidBrush  = gdi32.func('intptr __stdcall CreateSolidBrush(uint32 crColor)');
    const SetCursorFn_p     = user32.func('intptr __stdcall SetCursor(intptr hCursor)');

    const WndProcType = koffi.proto('intptr __stdcall WndProc(intptr hwnd, uint32 msg, uintptr wParam, intptr lParam)');

    const GWLP_WNDPROC  = -4;
    const WM_ERASEBKGND = 0x0014;
    const WM_NCCALCSIZE = 0x0083;
    const WM_NCHITTEST  = 0x0084;
    const WM_SETCURSOR  = 0x0020;
    const HTCLIENT      = 1;

    const hwndBuf = win.getNativeWindowHandle();
    const hwnd    = Number(hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0) : hwndBuf.readInt32LE(0));

    // Create a persistent dark brush (#0f0f13 as Win32 COLORREF = 0x00BBGGRR).
    // Used to fill the window background before Chromium's first paint, preventing
    // the default white WM_ERASEBKGND fill that causes a white flash on window show.
    const DARK_BG = 0x00130F0F; // #0f0f13 in BGR order
    const _darkBrush = CreateSolidBrush(DARK_BG);

    _originalWndProc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);

    _wndProcCallback = koffi.register((h, msg, wp, lp) => {
      // Returning 0 when wParam=1 tells Windows the entire window rectangle is
      // client area — no implicit DWM frame inset on right/bottom edges.
      if (msg === WM_NCCALCSIZE && wp !== 0) return 0;
      if (msg === WM_NCHITTEST) return HTCLIENT;
      // Hide the OS cursor on the main HWND (including DWM-managed edge strip).
      // SetCursor(NULL) actively removes the cursor from screen; returning TRUE
      // tells Windows the message is handled so DefWindowProc doesn't restore it.
      if (msg === WM_SETCURSOR) { SetCursorFn_p(0); return 1; }
      // Fill with dark color on erase so the window is never white before Chromium paints.
      if (msg === WM_ERASEBKGND) {
        const rectBuf = Buffer.alloc(16);
        GetClientRect(h, rectBuf);
        FillRect(Number(wp), rectBuf, _darkBrush);
        return 1;
      }
      return CallWindowProcW(_originalWndProc, h, msg, wp, lp);
    }, koffi.pointer(WndProcType));

    SetWindowLongPtrW(hwnd, GWLP_WNDPROC, koffi.address(_wndProcCallback));
  } catch (e) {
    console.error('[hookNchittest] failed:', e);
  }
}


let _dwmSetWindowAttribute = null;
function applyDwmRoundedCorners(win) {
  if (process.platform !== 'win32') return;
  try {
    if (!_dwmSetWindowAttribute) {
      const koffi = require('koffi');
      const dwmapi = koffi.load('dwmapi.dll');
      // hwnd is declared as intptr (pointer-sized integer) — NOT void*.
      // Passing a Buffer as void* gives koffi the JS heap address of the buffer,
      // not the HWND value stored inside it. intptr lets us pass the raw integer.
      _dwmSetWindowAttribute = dwmapi.func('int DwmSetWindowAttribute(intptr hwnd, uint32 attr, void* pvAttr, uint32 cbAttr)');
    }
    const hwndBuf = win.getNativeWindowHandle();
    // Extract the actual HWND integer from the Buffer (8-byte LE on 64-bit Windows).
    const hwnd = Number(hwndBuf.length >= 8 ? hwndBuf.readBigInt64LE(0) : hwndBuf.readInt32LE(0));
    const pref = Buffer.alloc(4);
    pref.writeInt32LE(2, 0); // DWMWCP_ROUND = 2
    _dwmSetWindowAttribute(hwnd, 33, pref, 4); // 33 = DWMWA_WINDOW_CORNER_PREFERENCE
  } catch (_) {
    // Silently ignore — corners stay square but nothing breaks.
  }
}

// Reads a JSON file, stripping a leading UTF-8 BOM if present.
// PowerShell -Encoding UTF8 on Windows adds a BOM that JSON.parse rejects.
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, ''));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    frame: false,
    resizable: false,
    thickFrame: false,       // removes WS_THICKFRAME non-client border strips
    // transparent: true is intentionally omitted. With transparent:true, the DWM surface starts
    // fully transparent and there is a 1-2 frame gap before Chromium's compositor delivers the
    // first painted frame, causing an intermittent transparent flash on startup that cannot be
    // eliminated by any CSS or ready-to-show trick. With transparent:false, backgroundColor fills
    // the DWM surface buffer immediately and synchronously — the window is never transparent.
    // DWM rounded corners (DWMWCP_ROUND, set via applyDwmRoundedCorners below) still make the
    // corner pixels transparent to the desktop — no visual difference from the user's perspective.
    backgroundColor: '#0f0f13', // pre-paint buffer fill — window shows this dark color from frame 0
    hasShadow: false,        // without this Windows adds a rectangular drop shadow that fills the
                             // transparent corners and makes them visually opaque
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Apply DWM rounded corners immediately — window is still hidden (show:false) so there is
  // no visible flash. koffi makes this a synchronous in-process call (~microseconds), so the
  // corners are set before the window is ever shown. Must be called AFTER Electron's internal
  // window setup (which erroneously sets DWMWCP_DONOTROUND when resizable:false — bug #32981),
  // and new BrowserWindow() completes that setup synchronously, so calling here is correct.
  applyDwmRoundedCorners(mainWindow);
  hookNchittest(mainWindow);

  // Show the window only once React has rendered — prevents any white flash.
  mainWindow.once('ready-to-show', () => {
    // Start invisible so the Win32 window exists (Chromium needs it) but the user
    // sees nothing. Opacity 1 is set only when the renderer explicitly signals that
    // React has mounted and painted — at that point Chromium's frame has already
    // been in DWM's buffer for at least one vsync, so there is nothing to flash.
    mainWindow.setOpacity(0);
    mainWindow.show();
  });

  // F12 opens DevTools (menu is null so Ctrl+Shift+I doesn't work).
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && input.key === 'F12')
      mainWindow.webContents.toggleDevTools();
  });

  // Renderer sends 'app:ready' from its first useEffect (after first DOM paint).
  // Only then do we make the window visible — the renderer handshake guarantees
  // DWM already has the correct frame, eliminating the white-flash race entirely.
  ipcMain.once('app:ready', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setOpacity(1);
  });
}

// Loads the app's content into the already-created window. Kept separate from
// createWindow() so the window (and its native OS drag-and-drop registration)
// exists well before the local servers/GitHub sync in app.whenReady() start —
// see the comment above the createWindow() call there for why.
function loadWindowContent() {
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:3000');
  }
}


function showAlreadyRunningPopup() {
  const popup = new BrowserWindow({
    width: 380,
    height: 180,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  popup.loadFile(path.join(__dirname, 'already-running.html'));
  popup.once('closed', () => app.quit());
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ensureStorage(storagePath) {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(storagePath)) {
    fs.writeFileSync(storagePath, JSON.stringify({ games: [] }, null, 2));
  }
}

// ─── Profiles ──────────────────────────────────────────────────────────────
// Multi-profile support: each profile is a fully separate world (its own
// user.json, backgrounds/, icons/, and per-account game data). Profiles are
// identified by a UUID on disk — renaming a profile only ever edits its
// display name in profiles.json, never touches the filesystem (names may
// contain any characters, including ones illegal in filenames). Caches that
// aren't account-specific (banner schedules, banner images, Live2D
// downloads, showcase images) stay shared across every
// profile under storage/cache/<game> and storage/showcases.

function getProfilesIndexPath(dataRoot) {
  return path.join(dataRoot, 'profiles.json');
}

function readProfilesIndex(dataRoot) {
  return readJson(getProfilesIndexPath(dataRoot));
}

function writeProfilesIndex(dataRoot, index) {
  fs.writeFileSync(getProfilesIndexPath(dataRoot), JSON.stringify(index, null, 2));
}

function getProfileDir(dataRoot, profileId) {
  return path.join(dataRoot, 'profiles', profileId);
}

// One-time migration for installs that predate multi-profile support: moves
// the existing flat storage/ layout into storage/profiles/<uuid>/ (named
// "Profile 1"), and splits out the shared caches (banner schedules, banner
// images) that used to sit as siblings of per-account
// data into their own storage/cache/<game>/ tree so they aren't duplicated
// or lost when a profile is later deleted.
function migrateToProfiles(dataRoot) {
  const oldUserJson = path.join(dataRoot, 'user.json');
  const oldGames = fs.existsSync(oldUserJson) ? (readJson(oldUserJson).games ?? []) : [];

  const id = crypto.randomUUID();
  const profileDir = getProfileDir(dataRoot, id);
  fs.mkdirSync(profileDir, { recursive: true });

  const moveIfExists = (from, to) => {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  };

  moveIfExists(oldUserJson, path.join(profileDir, 'user.json'));
  moveIfExists(path.join(dataRoot, 'backgrounds'), path.join(profileDir, 'backgrounds'));
  moveIfExists(path.join(dataRoot, 'icons'), path.join(profileDir, 'icons'));

  for (const game of ['genshin', 'hsr', 'zzz']) {
    const oldGameDir = path.join(dataRoot, 'data', game);
    if (!fs.existsSync(oldGameDir)) continue;

    // Move only the specific uid subfolders this install's own games list
    // actually references — everything else left behind (banner-schedule*,
    // banner-images/, etc.) is shared cache, not account data, so it's
    // relocated (not per-profile) below instead.
    const thisGameEntries = oldGames.filter(g => g.linkedDatabase === game);
    const knownUids = new Set(thisGameEntries.map(g => g.uid || 'default'));

    for (const uid of knownUids) {
      moveIfExists(path.join(oldGameDir, uid), path.join(profileDir, 'data', game, uid));
    }

    // Whatever's left in dataRoot/data/<game> is shared cache — relocate it
    // wholesale to the new shared cache root.
    moveIfExists(oldGameDir, path.join(dataRoot, 'cache', game));
  }

  writeProfilesIndex(dataRoot, {
    activeProfileId: id,
    profiles: [{ id, name: 'Profile 1' }],
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));
ipcMain.handle('theme:get-system', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

nativeTheme.on('updated', () => {
  mainWindow?.webContents.send('theme:system-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.on('window:move-by', (_, dx, dy) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
});

ipcMain.handle('loginItem:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('loginItem:set', (_, enabled) => app.setLoginItemSettings({ openAtLogin: enabled }));


// ─── UID folder helpers ───────────────────────────────────────────────────────

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'currency', 'currentCurrency',
  'pullItems', 'goals', 'wishList', 'history', 'stats', 'hsrBannerList', 'lastSynced',
  'excelImported', 'jsonImported', 'apiBackup', 'dailyPassActive', 'dailyPassLastClaimedAt',
]);

function getGameDataDir(linkedDatabase, uid) {
  return path.join(app.activeProfileDataDir, linkedDatabase, uid || 'default');
}

// pullLog and history each live in their own file, separate from the rest
// of a UID's state (data.json) — both grow entry-by-entry over time (a pull
// log can reach tens of thousands of entries; history gets +1 entry every
// single day) while everything else (currency, pity, wishlist, ...) is
// static until manually changed. Keeping them apart means an unrelated edit
// (toggling the daily pass) never has to re-read-and-rewrite either
// ever-growing file, which it did when everything lived in one file.
// stats.json is a third, separate file for the same underlying reason even
// though it doesn't grow itself — it's DERIVED from pullLog (see
// computeGameStats.js) and gets rewritten every time pullLog changes, so it
// belongs with the other two "changes independently of the static config
// fields" files rather than in data.json.
function getPullLogFile(dir) {
  return path.join(dir, 'pullLog.json');
}
function getHistoryFile(dir) {
  return path.join(dir, 'history.json');
}
function getStatsFile(dir) {
  return path.join(dir, 'stats.json');
}

// Reads a UID's data.json + pullLog.json + history.json + stats.json and
// returns the merged state object — same shape callers got back before any
// of these splits existed. Self-healing migration: if data.json still has
// an embedded `pullLog`/`history` key (installs from before that field's
// split), splits it out into its own file and rewrites data.json without
// it, once, the first time this runs for that UID. Order matters for
// safety — the new file is written before data.json is rewritten, so a
// crash between the two still leaves the field recoverable from data.json's
// stale-but-intact copy. stats never existed embedded in data.json (it's a
// brand-new field), so it needs no such migration — just a plain read.
function loadUidState(dir) {
  const dataFile = path.join(dir, 'data.json');
  let uidState = fs.existsSync(dataFile) ? readJson(dataFile) : {};

  if ('pullLog' in uidState) {
    const { pullLog, ...rest } = uidState;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getPullLogFile(dir), JSON.stringify(pullLog ?? [], null, 2));
    fs.writeFileSync(dataFile, JSON.stringify(rest, null, 2));
    uidState = rest;
  }

  if ('history' in uidState) {
    const { history, ...rest } = uidState;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getHistoryFile(dir), JSON.stringify(history ?? [], null, 2));
    fs.writeFileSync(dataFile, JSON.stringify(rest, null, 2));
    uidState = rest;
  }

  const pullLogFile = getPullLogFile(dir);
  const pullLog = fs.existsSync(pullLogFile) ? readJson(pullLogFile) : [];
  const statsFile = getStatsFile(dir);
  const stats = fs.existsSync(statsFile) ? readJson(statsFile) : null;
  const historyFile = getHistoryFile(dir);
  const history = fs.existsSync(historyFile) ? readJson(historyFile) : [];
  return { ...uidState, pullLog, history, ...(stats != null ? { stats } : {}) };
}

ipcMain.handle('storage:read', () => {
  try {
    const raw = readJson(app.storagePath);
    let dirty = false;

    // ── App-wide background: clear a reference to a file that no longer
    // exists (e.g. manually deleted from backgrounds/ outside the app) so
    // the renderer/loading pipeline never tries to wait on it — see the
    // per-game equivalent below for why this can't just be handled by
    // gracefully failing to load it client-side (a stale video reference
    // stalls the boot loading bar forever with no error, since nothing
    // renders a <video> element for a file that isn't on disk to begin with). */
    if (raw.settings?.backgroundFilename) {
      const filePath = path.join(app.backgroundsDir, raw.settings.backgroundFilename);
      if (!fs.existsSync(filePath)) {
        raw.settings = { ...raw.settings, backgroundFilename: null };
        dirty = true;
      }
    }

    const games = (raw.games ?? []).map(game => {
      // ── Background: same missing-file reconciliation as the app-wide one
      // above, per game. Must happen here (not just client-side) because
      // useLoadingTasks.js's video preload tasks are built directly from
      // these raw filenames — a stale one creates a loading task with no
      // corresponding rendered <video> element to ever complete it.
      if (game.backgroundFilename) {
        const filePath = path.join(app.backgroundsDir, game.backgroundFilename);
        if (!fs.existsSync(filePath)) {
          game = { ...game, backgroundFilename: null };
          dirty = true;
        }
      }

      // ── Icon migration: inline base64 → file ─────────────────────────────
      if (game.iconPath?.startsWith('data:')) {
        try {
          const ext     = (game.iconPath.match(/data:image\/(\w+);/) ?? [])[1] ?? 'png';
          const safeExt = ext === 'jpeg' ? 'jpg' : ext;
          const filename = `${safeNamePrefix(game.name)}_${game.id}.${safeExt}`;
          const base64   = game.iconPath.replace(/^data:image\/\w+;base64,/, '');
          fs.mkdirSync(app.iconsDir, { recursive: true });
          fs.writeFileSync(path.join(app.iconsDir, filename), Buffer.from(base64, 'base64'));
          const { iconPath: _ip, ...gameNoIcon } = game;
          game = { ...gameNoIcon, iconFilename: filename };
        } catch (_) {}
        dirty = true;
      }

      // ── Icon load: file → runtime iconPath ───────────────────────────────
      if (game.iconFilename) {
        try {
          const filePath = path.join(app.iconsDir, game.iconFilename);
          if (fs.existsSync(filePath)) {
            const ext  = path.extname(game.iconFilename).slice(1);
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            game = { ...game, iconPath: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
          }
        } catch (_) {}
      }

      const db = game.linkedDatabase;
      if (!db) return game;

      let uid   = game.uid;
      let state = { ...(game.state ?? {}) };

      // Auto-migrate games without uid that have inline UID-scoped state.
      // apiBackup is intentionally dropped here — it's never persisted to
      // disk (see useStorage.js's save()), only ever kept in-memory for the
      // current session and recomputed fresh from the API on next sync.
      if (!uid && !state._migrated) {
        uid = 'default';
        const { apiBackup: _apiBackup, ...rest } = state;
        const uidState    = {};
        const configState = {};
        for (const [k, v] of Object.entries(rest)) {
          if (UID_STATE_FIELDS.has(k)) uidState[k] = v;
          else configState[k] = v;
        }
        const dir = getGameDataDir(db, uid);
        fs.mkdirSync(dir, { recursive: true });
        // Written as one file here — loadUidState() below splits pullLog
        // out into pullLog.json uniformly, whether it just arrived via this
        // migration or was already sitting in an existing data.json.
        fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(uidState, null, 2));
        state = { ...configState, _migrated: true };
        dirty = true;
      }

      if (!uid) return game;

      // Load UID-specific state from file(s) — see loadUidState() for the
      // pullLog.json split/migration this performs.
      const dir = getGameDataDir(db, uid);
      const uidState = loadUidState(dir);

      return { ...game, uid, state: { ...state, ...uidState } };
    });

    if (dirty) {
      const leanGames = games.map(g => {
        const { iconPath: _ip, ...gNoIcon } = g;          // always strip runtime iconPath
        if (!gNoIcon.uid || !gNoIcon.linkedDatabase) return gNoIcon;
        const configState = {};
        for (const [k, v] of Object.entries(gNoIcon.state ?? {})) {
          if (!UID_STATE_FIELDS.has(k)) configState[k] = v;
        }
        return { ...gNoIcon, state: configState };
      });
      fs.writeFileSync(app.storagePath, JSON.stringify({ ...raw, games: leanGames }, null, 2));
    }

    return { ...raw, games };
  } catch {
    return { games: [] };
  }
});

ipcMain.handle('storage:write', async (_, data) => {
  try {
    // Async — a sync write here blocks the whole main process (all windows,
    // all IPC) for as long as the disk write takes. This handler fires on
    // every single state edit in the renderer (unthrottled), so a large
    // pull log made that stall visible as a full app freeze.
    await fs.promises.writeFile(app.storagePath, JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Profile IPC handlers ─────────────────────────────────────────────────────
// Switching the active profile requires a full relaunch — every directory
// (storagePath, backgroundsDir, iconsDir, activeProfileDataDir) and all 4
// local HTTP servers are set up once at startup and never re-derived, so
// there's no safe way to hot-swap them mid-session. See app.whenReady() above.

ipcMain.handle('profiles:list', () => {
  try {
    return readProfilesIndex(app.dataRoot);
  } catch (e) {
    return { activeProfileId: null, profiles: [], error: e.message };
  }
});

ipcMain.handle('profiles:create', (_, name) => {
  try {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Name cannot be empty.' };
    const index = readProfilesIndex(app.dataRoot);
    if (index.profiles.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: 'This profile already exists.' };
    }
    const id = crypto.randomUUID();
    ensureStorage(path.join(getProfileDir(app.dataRoot, id), 'user.json'));
    index.profiles.push({ id, name: trimmed });
    writeProfilesIndex(app.dataRoot, index);
    return { ok: true, profiles: index.profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('profiles:rename', (_, { id, name }) => {
  try {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Name cannot be empty.' };
    const index = readProfilesIndex(app.dataRoot);
    if (index.profiles.some(p => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: 'This profile already exists.' };
    }
    const profile = index.profiles.find(p => p.id === id);
    if (!profile) return { ok: false, error: 'Profile not found.' };
    profile.name = trimmed;
    writeProfilesIndex(app.dataRoot, index);
    return { ok: true, profiles: index.profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('profiles:delete', (_, id) => {
  try {
    const index = readProfilesIndex(app.dataRoot);
    if (id === index.activeProfileId) {
      return { ok: false, error: 'Switch to a different profile before deleting this one.' };
    }
    if (index.profiles.length <= 1) {
      return { ok: false, error: 'At least one profile must exist.' };
    }
    fs.rmSync(getProfileDir(app.dataRoot, id), { recursive: true, force: true });
    index.profiles = index.profiles.filter(p => p.id !== id);
    writeProfilesIndex(app.dataRoot, index);
    return { ok: true, profiles: index.profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('profiles:switch', (_, id) => {
  try {
    const index = readProfilesIndex(app.dataRoot);
    if (!index.profiles.some(p => p.id === id)) return { ok: false, error: 'Profile not found.' };
    index.activeProfileId = id;
    writeProfilesIndex(app.dataRoot, index);
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Profile export / import ──────────────────────────────────────────────────
// Export bundles a profile's user.json + backgrounds/ + icons/ (never the
// shared caches) into a single zip, plus a manifest.json so import can show
// what it's about to do and — critically — verify the zip is actually one of
// our own exports before touching anything on disk.

ipcMain.handle('profiles:export', async (_, id) => {
  try {
    const index = readProfilesIndex(app.dataRoot);
    const profile = index.profiles.find(p => p.id === id);
    if (!profile) return { ok: false, error: 'Profile not found.' };

    const profileDir = getProfileDir(app.dataRoot, id);
    const zip = new AdmZip();

    const userJsonPath = path.join(profileDir, 'user.json');
    if (fs.existsSync(userJsonPath)) zip.addLocalFile(userJsonPath);

    const bgDir = path.join(profileDir, 'backgrounds');
    if (fs.existsSync(bgDir)) zip.addLocalFolder(bgDir, 'backgrounds');

    const iconsDirPath = path.join(profileDir, 'icons');
    if (fs.existsSync(iconsDirPath)) zip.addLocalFolder(iconsDirPath, 'icons');

    const manifest = {
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      profileName: profile.name,
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));

    const safeName = profile.name.replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Profile',
      defaultPath: `${safeName}-backup-${manifest.exportedAt.slice(0, 10)}.zip`,
      filters: [{ name: 'Zip Archive', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false, cancelled: true };

    zip.writeZip(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Only these top-level entries are ever allowed in an importable zip — an
// allow-list rather than trusting the zip's contents, which both rejects
// foreign/unrelated zips and blocks zip-slip path traversal (an entry can't
// escape into a top-level name we didn't expect).
const IMPORT_ALLOWED_TOP_LEVEL = new Set(['manifest.json', 'user.json', 'backgrounds', 'icons']);

function validateImportZip(zipPath) {
  if (!zipPath || !fs.existsSync(zipPath)) return { ok: false, error: 'File not found.' };
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch {
    return { ok: false, error: 'Not a valid zip file.' };
  }

  const entries = zip.getEntries();
  const manifestEntry = entries.find(e => e.entryName === 'manifest.json');
  if (!manifestEntry) return { ok: false, error: 'Not a recognized profile backup (missing manifest.json).' };

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch {
    return { ok: false, error: 'Backup manifest is corrupt.' };
  }
  if (typeof manifest.appVersion !== 'string' || typeof manifest.exportedAt !== 'string' || typeof manifest.profileName !== 'string') {
    return { ok: false, error: 'Backup manifest is missing required fields.' };
  }

  for (const entry of entries) {
    if (entry.entryName.includes('..')) return { ok: false, error: 'Invalid entry path in backup.' };
    const topLevel = entry.entryName.split('/')[0];
    if (!IMPORT_ALLOWED_TOP_LEVEL.has(topLevel)) {
      return { ok: false, error: `Unrecognized content in backup: ${entry.entryName}` };
    }
  }

  return { ok: true, zip, manifest };
}

ipcMain.handle('profiles:inspect-import', (_, zipPath) => {
  const result = validateImportZip(zipPath);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, profileName: result.manifest.profileName, exportedAt: result.manifest.exportedAt };
});

ipcMain.handle('profiles:import', (_, { zipPath, targetProfileId, newName }) => {
  try {
    const result = validateImportZip(zipPath);
    if (!result.ok) return { ok: false, error: result.error };
    const { zip } = result;

    const index = readProfilesIndex(app.dataRoot);
    let destId = targetProfileId;
    const overwritingActive = !!targetProfileId && targetProfileId === app.activeProfileId;

    if (destId) {
      if (!index.profiles.some(p => p.id === destId)) return { ok: false, error: 'Profile not found.' };
    } else {
      const trimmed = (newName ?? '').trim();
      if (!trimmed) return { ok: false, error: 'Name cannot be empty.' };
      if (index.profiles.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
        return { ok: false, error: 'This profile already exists.' };
      }
      destId = crypto.randomUUID();
      index.profiles.push({ id: destId, name: trimmed });
    }

    const destDir = getProfileDir(app.dataRoot, destId);
    fs.mkdirSync(destDir, { recursive: true });

    // Clean restore — wipe whatever's already there before extracting, so no
    // orphaned files survive from a previously-larger backgrounds/icons set.
    for (const name of ['user.json', 'backgrounds', 'icons']) {
      fs.rmSync(path.join(destDir, name), { recursive: true, force: true });
    }

    for (const entry of zip.getEntries()) {
      if (entry.entryName === 'manifest.json' || entry.isDirectory) continue;
      const destFile = path.join(destDir, entry.entryName);
      fs.mkdirSync(path.dirname(destFile), { recursive: true });
      fs.writeFileSync(destFile, entry.getData());
    }

    writeProfilesIndex(app.dataRoot, index);

    if (overwritingActive) {
      app.relaunch();
      app.exit(0);
      return { ok: true };
    }
    return { ok: true, profiles: index.profiles };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Icon IPC handlers ────────────────────────────────────────────────────────

// Prefixes icon/background filenames with the game's own name (sanitized for
// the filesystem) so files in icons/ and backgrounds/ are identifiable at a
// glance instead of being bare UUIDs/ids — same convention as the
// background:save filenames built in GameSettingsModal.js / SettingsModal.js.
function safeNamePrefix(name) {
  return (name || 'Game').replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_') || 'Game';
}

ipcMain.handle('icon:save', (_, { gameId, dataUrl, gameName }) => {
  try {
    const ext      = (dataUrl.match(/data:image\/(\w+);/) ?? [])[1] ?? 'png';
    const safeExt  = ext === 'jpeg' ? 'jpg' : ext;
    const filename = `${safeNamePrefix(gameName)}_${gameId}.${safeExt}`;
    const base64   = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.mkdirSync(app.iconsDir, { recursive: true });
    fs.writeFileSync(path.join(app.iconsDir, filename), Buffer.from(base64, 'base64'));
    return { ok: true, filename };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('icon:read', (_, filename) => {
  try {
    const filePath = path.join(app.iconsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const ext  = path.extname(filename).slice(1);
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
  } catch { return null; }
});

// No "Delete icon" UI action exists (a game always has some icon), but
// replacing one with a different-extension file produces a different
// filename (safeNamePrefix_gameId.ext) rather than overwriting in place,
// which orphaned the old file — this lets the replace flow clean it up.
ipcMain.handle('icon:delete', (_, filename) => {
  try {
    const filePath = path.join(app.iconsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('game:uidExists', (_, { linkedDatabase, uid }) => {
  const file = path.join(getGameDataDir(linkedDatabase, uid), 'data.json');
  return fs.existsSync(file);
});

ipcMain.handle('game:readState', (_, { linkedDatabase, uid }) => {
  try {
    return loadUidState(getGameDataDir(linkedDatabase, uid));
  } catch { return {}; }
});

ipcMain.handle('game:writeState', async (_, { linkedDatabase, uid, state }) => {
  try {
    const dir = getGameDataDir(linkedDatabase, uid);
    if (!fs.existsSync(dir)) {
      // Only skip creating the directory for a genuinely empty write (no
      // fields at all) — any real field (currency, pity, pullLog, etc.) on
      // a brand-new game must still persist. Previously this only checked
      // for a non-empty pullLog, which silently dropped every OTHER kind of
      // first-ever edit (e.g. setting currency before the first sync) with
      // a fake { ok: true } success response.
      if (!state || Object.keys(state).length === 0) return { ok: true };
      fs.mkdirSync(dir, { recursive: true });
    }
    // pullLog, history, and stats each go to their own file — the renderer
    // omits whichever is unchanged from `state` entirely (see useStorage.js's
    // save()), so most writes (a currency edit, a daily-pass toggle) now
    // only ever touch the small data.json, never any of the other files.
    const { pullLog, history, stats, ...restState } = state;

    // Merge onto the existing file rather than overwrite, so a write that
    // doesn't include every field (e.g. only `currency`) doesn't blow away
    // whatever else was already stored.
    const dataFile = path.join(dir, 'data.json');
    let existing = {};
    if (fs.existsSync(dataFile)) {
      try { existing = JSON.parse(await fs.promises.readFile(dataFile, 'utf8')); } catch { existing = {}; }
    }
    const merged = { ...existing, ...restState };
    // Async — a sync write here blocks the whole main process. See storage:write.
    await fs.promises.writeFile(dataFile, JSON.stringify(merged, null, 2));

    if (Array.isArray(pullLog)) {
      await fs.promises.writeFile(getPullLogFile(dir), JSON.stringify(pullLog, null, 2));

      // Independent growth-only backup — see pullLogBackup.js. Only runs
      // when pullLog was actually part of this write, and never overwrites
      // its own history with a shrunk/altered log — worst case it just
      // skips writing a new snapshot.
      const result = checkAndBackupPullLog(dir, pullLog);
      if (!result.ok) console.warn('[pullLogBackup]', linkedDatabase, uid, result.reason);
    }

    if (Array.isArray(history)) {
      await fs.promises.writeFile(getHistoryFile(dir), JSON.stringify(history, null, 2));
    }

    // stats is a plain object ({ combined, byBanner }), not an array — same
    // "only write when this write actually included it" guard, just an
    // existence check instead of Array.isArray.
    if (stats != null) {
      await fs.promises.writeFile(getStatsFile(dir), JSON.stringify(stats, null, 2));
    }

    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('game:clearUidState', (_, { linkedDatabase, uid }) => {
  try {
    const dir = getGameDataDir(linkedDatabase, uid);
    const dataFile    = path.join(dir, 'data.json');
    const pullLogFile = getPullLogFile(dir);
    const historyFile = getHistoryFile(dir);
    const statsFile   = getStatsFile(dir);
    if (fs.existsSync(dataFile))    fs.writeFileSync(dataFile,    JSON.stringify({}, null, 2));
    if (fs.existsSync(pullLogFile)) fs.writeFileSync(pullLogFile, JSON.stringify([], null, 2));
    if (fs.existsSync(historyFile)) fs.writeFileSync(historyFile, JSON.stringify([], null, 2));
    if (fs.existsSync(statsFile))   fs.writeFileSync(statsFile,   JSON.stringify(null, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// User-triggered "Clear Pull History" — an explicit, unconditional wipe.
// Deletes the rotating snapshot folder entirely, which the normal write
// path (game:writeState) can never do on its own: pullLogBackup.js's own
// protective logic (see its standing do-not-modify rule) refuses to accept
// a new snapshot that isn't a superset of the last one, specifically so an
// accidental/buggy shrink elsewhere can't silently take the safety net down
// with it. This handler doesn't touch that logic — it's a distinct, always-
// explicit action the user asked for, not a side effect of a normal save.
ipcMain.handle('game:clearPullHistory', (_, { linkedDatabase, uid }) => {
  try {
    const dir = getGameDataDir(linkedDatabase, uid);
    fs.writeFileSync(getPullLogFile(dir), JSON.stringify([], null, 2));
    const backupDir = path.join(dir, 'pull-log-backups');
    if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ─── Background IPC handlers ──────────────────────────────────────────────────

// Hashes the first 64 KB of a file + its total size.
// Fast for any file size; reliable enough that two different user video files
// will never collide in practice.
const BG_HASH_SAMPLE = 65536;
function sampleHash(buf, totalSize) {
  const sample = buf.length <= BG_HASH_SAMPLE ? buf : buf.subarray(0, BG_HASH_SAMPLE);
  return crypto.createHash('sha256').update(sample).update(String(totalSize)).digest('hex');
}

ipcMain.handle('background:save', (_, { filename, buffer }) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    const buf = Buffer.from(buffer);
    fs.writeFileSync(filePath, buf);
    return { ok: true, hash: sampleHash(buf, buf.length) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Reads only the first 64 KB from an existing file to compute its hash.
// Used for lazy migration of backgrounds saved before hash tracking was added.
// Completes in < 1 ms for any file size.
ipcMain.handle('background:hash', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const stat    = fs.statSync(filePath);
    const readLen = Math.min(BG_HASH_SAMPLE, stat.size);
    const sample  = Buffer.alloc(readLen);
    const fd      = fs.openSync(filePath, 'r');
    fs.readSync(fd, sample, 0, readLen, 0);
    fs.closeSync(fd);
    return sampleHash(sample, stat.size);
  } catch {
    return null;
  }
});

ipcMain.handle('background:read', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase().slice(1);
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', mp4: 'video/mp4' };
    const mime = mimeMap[ext] ?? 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

ipcMain.handle('background:list', () => {
  try {
    const files = fs.readdirSync(app.backgroundsDir);
    return files.map(filename => {
      const filePath = path.join(app.backgroundsDir, filename);
      const stats = fs.statSync(filePath);
      return { filename, sizeBytes: stats.size };
    });
  } catch {
    return [];
  }
});

// Lightweight existence + type check — returns { isVideo } or null if file not found.
// Used by the renderer before building a bg server URL so it knows whether to render
// an <img> or a <video> element without transferring any file data over IPC.
ipcMain.handle('background:info', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filename).toLowerCase().slice(1);
    return { isVideo: ['mp4', 'webm', 'mov'].includes(ext) };
  } catch {
    return null;
  }
});

ipcMain.handle('background:server-port', () => app.bgServerPort);
ipcMain.handle('fonts:server-port', () => app.fontsServerPort);

// ─── Live2D (Spine) IPC handlers ──────────────────────────────────────────────
ipcMain.handle('live2d:ensure', (_, { game, characterId }) =>
  live2d.ensure({ root: app.live2dDir, modelRoot: app.showcasesDir, game, characterId }));
ipcMain.handle('live2d:list-manifest', (_, { game }) =>
  live2d.listManifestIds(game).catch(() => []));
ipcMain.handle('live2d:list-local', (_, { game }) =>
  live2d.listLocalIds(game, app.live2dDir));
ipcMain.handle('live2d:clear-framing', (_, { game, id }) =>
  live2d.clearFraming(game, app.live2dDir, id ?? null));
ipcMain.handle('live2d:server-port',      () => app.live2dServerPort);
ipcMain.handle('showcases:server-port',   () => app.showcasesServerPort);
ipcMain.handle('showcase:ensure-char-image', async (_, { game, avatarId }) => {
  const absPath = await ensureCharImage(game, avatarId);
  if (!absPath) return null;
  return path.relative(app.showcasesDir, absPath).replace(/\\/g, '/');
});
ipcMain.handle('showcase:ensure-char-icon', async (_, { game, avatarId, iconUrl }) => {
  const absPath = await ensureCharIcon(game, avatarId, iconUrl);
  if (!absPath) return null;
  return path.relative(app.showcasesDir, absPath).replace(/\\/g, '/');
});
// PNG-mode face-detection framing — GitHub-precomputed only (see framingSync.js),
// never computed locally. Returns
// { cxFrac, cyFrac, hFrac } (0-1 fractions of the character's own PNG) or null
// if this character has no entry yet (falls back to fixed CSS positioning).
ipcMain.handle('showcase:get-png-framing', (_, { game, avatarId }) => {
  try {
    const raw = fs.readFileSync(path.join(app.pngDir, game, 'framing.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return (parsed.data ?? parsed)[String(avatarId)] ?? null;
  } catch {
    return null;
  }
});
// Whole-file variant — loaded once during the loading screen and cached in the
// renderer (see hsrPngFraming.js), so a card's first render already has the
// right --face-x/--face-y instead of popping in a render later after a
// per-character IPC round-trip.
ipcMain.handle('showcase:get-png-framing-all', (_, { game }) => {
  try {
    const raw = fs.readFileSync(path.join(app.pngDir, game, 'framing.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.data ?? parsed;
  } catch {
    return {};
  }
});
ipcMain.handle('background:delete', (_, filename) => {
  try {
    const filePath = path.join(app.backgroundsDir, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Genshin data IPC handlers ────────────────────────────────────────────────

ipcMain.handle('genshin:fetchBanners', async () => {
  try {
    return await fetchGenshinBanners(app.genshinCacheDir);
  } catch (e) {
    return { ok: false, banners: null, fromCache: false, offline: true, error: e.message };
  }
});

// Detect whether a buffer is WebP (RIFF....WEBP) so we can return the correct
// MIME type in the data URI — paimon.moe now serves newer banner images as WebP
// even though the URL still ends in .png.
function detectImageMime(buf) {
  if (buf.length >= 12 &&
      buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) { // WEBP
    return 'image/webp';
  }
  return 'image/png';
}


// ─── Gacha import IPC handlers ────────────────────────────────────────────────

ipcMain.handle('gacha:parsePaimonMoe', (_, { jsonText, existingLog }) => {
  try {
    return { ok: true, ...parsePaimonMoe(jsonText, existingLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:parseExcelMoe', (_, { buffer, existingLog }) => {
  try {
    return { ok: true, ...parseExcelMoe(Buffer.from(buffer), existingLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── Genshin: export history back to paimon.moe's import format ──────────────
// Paimon.moe's own import needs BOTH files together (JSON for 50/50 data,
// Excel for banner names) to fully reconstruct a wish history — matches
// parseExcelMoe/parsePaimonMoe's own mismatch-detection logic on the import
// side, which assumes both are present. So one button, one folder picked,
// both files written into it.
ipcMain.handle('genshin:exportHistory', async (_, { pullLog, serverOffset }) => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Export History — Choose a Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths?.[0]) return { ok: false, cancelled: true };

    const dateStr = new Date().toISOString().slice(0, 10);
    const jsonPath  = path.join(filePaths[0], `paimon-moe-local-data_export_${dateStr}.json`);
    const excelPath = path.join(filePaths[0], `paimonmoe_wish_history_export_${dateStr}.xlsx`);

    fs.writeFileSync(jsonPath, JSON.stringify(buildPaimonExport(pullLog, serverOffset), null, 2));
    fs.writeFileSync(excelPath, buildExcelExport(pullLog));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:detectMismatch', (_, { jsonLog, excelLog }) => {
  try {
    return { ok: true, diffs: detectMismatch(jsonLog, excelLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('gacha:mergeJsonIntoExcel', (_, { jsonLog, excelLog }) => {
  try {
    return { ok: true, merged: mergeJsonIntoExcel(jsonLog, excelLog) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── HSR warp-log URL extraction ─────────────────────────────────────────────

// Inline script — reads HSR's web cache directly without any network calls.
// Same technique as zzz:readLog below (Player.log -> webCaches version folder
// -> Cache_Data/data_2 -> split on "1/0/" -> getGachaLog match), ported from
// the StarRailStation warp-link script instead of fetching it at runtime.
ipcMain.handle('hsr:readLog', () => {
  return new Promise((resolve) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `hsr-link-${Date.now()}.ps1`);

    const scriptLines = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
      '',
      '$locallow = [IO.Path]::Combine([Environment]::GetFolderPath("ApplicationData"), "..", "LocalLow", "Cognosphere", "Star Rail")',
      '$logPath = Join-Path $locallow "Player.log"',
      'if ((-not [IO.File]::Exists($logPath)) -or ([string]::IsNullOrEmpty((Get-Content $logPath -First 11)))) { $logPath = Join-Path $locallow "Player-prev.log" }',
      'if (-not [IO.File]::Exists($logPath)) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      '$gamePath = ""',
      'foreach ($line in (Get-Content $logPath -First 11)) {',
      '  if ($line.StartsWith("Loading player data from ")) {',
      '    $gamePath = $line.Replace("Loading player data from ", "").Replace("data.unity3d", "")',
      '    break',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($gamePath)) { Write-Output "ERR:no_game_path"; exit 1 }',
      '',
      '$cacheFolders = Get-ChildItem (Join-Path $gamePath "webCaches") -Directory -ErrorAction SilentlyContinue',
      '$maxVer = [long]0',
      '$cachePath = ""',
      'foreach ($f in $cacheFolders) {',
      '  if ($f.Name -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$") {',
      '    $ver = [long](-join ($f.Name.Split(".") | ForEach-Object { $_.PadLeft(3, "0") }))',
      '    if ($ver -ge $maxVer) { $maxVer = $ver; $cachePath = Join-Path $f.FullName "Cache\\Cache_Data\\data_2" }',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($cachePath) -or -not [IO.File]::Exists($cachePath)) { Write-Output "ERR:no_cache"; exit 1 }',
      '',
      '$tmp = [IO.Path]::GetTempFileName()',
      'Copy-Item $cachePath $tmp -Force',
      '$data = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8)',
      'Remove-Item $tmp -Force',
      '',
      // getGachaLog = normal wish history (character/light-cone/standard/
      // departure). getLdGachaLog = collaboration banners (Saber/Archer,
      // Rin Tohsaka/Gilgamesh, etc.) — a genuinely separate HoYoverse API
      // endpoint, not just a different gacha_type on the same one (confirmed
      // via lgou2w/HoYo.Gacha's client). Whichever the player visited most
      // recently in-game is scanned for BOTH kinds (not just the single
      // most-recent match overall), since they can coexist in the cache.
      '$parts = $data -split "1/0/"',
      '$normalUrl = $null',
      '$collabUrl = $null',
      'for ($i = $parts.Length - 1; $i -ge 0; $i--) {',
      '  $p = $parts[$i]',
      '  if (-not $p.StartsWith("http")) { continue }',
      '  if ((-not $collabUrl) -and $p.Contains("getLdGachaLog")) { $collabUrl = ($p -split [char]0)[0] }',
      '  elseif ((-not $normalUrl) -and $p.Contains("getGachaLog")) { $normalUrl = ($p -split [char]0)[0] }',
      '  if ($normalUrl -and $collabUrl) { break }',
      '}',
      'if ($normalUrl) { Write-Output "NORMAL:$normalUrl" }',
      'if ($collabUrl) { Write-Output "COLLAB:$collabUrl" }',
      'if ((-not $normalUrl) -and (-not $collabUrl)) { Write-Output "ERR:no_url"; exit 1 }',
      'exit 0',
    ];

    try {
      fs.writeFileSync(tmpFile, scriptLines.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `Failed to write temp script: ${e.message}` });
      return;
    }

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

    const timer = setTimeout(() => {
      ps.kill();
      cleanup();
      resolve({ ok: false, error: 'Timed out retrieving warp URL. Make sure Star Rail is open and you have visited your Warp History in-game.' });
    }, 30000);

    // Strip to only the required auth/identity params, same as zzz:readLog.
    function cleanUrl(raw) {
      const parsed = new URL(raw.trim());
      const keep   = ['authkey', 'authkey_ver', 'sign_type', 'game_biz', 'lang'];
      const clean  = new URL(`${parsed.protocol}//${parsed.host}${parsed.pathname}`);
      for (const k of keep) {
        if (parsed.searchParams.has(k)) clean.searchParams.set(k, parsed.searchParams.get(k));
      }
      return clean.toString();
    }

    ps.on('close', () => {
      clearTimeout(timer);
      cleanup();
      const normalMatch = stdout.match(/^NORMAL:(https:\/\/\S+)$/m);
      const collabMatch = stdout.match(/^COLLAB:(https:\/\/\S+)$/m);
      if (normalMatch || collabMatch) {
        resolve({
          ok: true,
          url:       normalMatch ? cleanUrl(normalMatch[1]) : null,
          collabUrl: collabMatch ? cleanUrl(collabMatch[1]) : null,
        });
      } else {
        let errMsg = 'Could not find warp URL. Open Star Rail, visit your Warp History (any banner), then try again.';
        if (stdout.includes('ERR:no_log'))            errMsg = 'Could not find HSR log file. Make sure Star Rail has been launched at least once.';
        else if (stdout.includes('ERR:no_game_path')) errMsg = 'Could not find HSR install path. Make sure Star Rail has been launched recently.';
        else if (stdout.includes('ERR:no_cache'))      errMsg = 'Could not find HSR web cache. Open Star Rail, visit your Warp History (any banner), then try again.';
        resolve({ ok: false, error: errMsg });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── ZZZ signal-log URL extraction ───────────────────────────────────────────
// Inline script — reads ZZZ's web cache directly without any network calls.
// The original rng.moe script validated the URL via Invoke-WebRequest (no
// timeout), which caused the 30 s hang when the cached key was expired.
// Our fetchWishHistory handler already handles expired keys, so we skip that.

ipcMain.handle('zzz:readLog', () => {
  return new Promise((resolve) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `zzz-link-${Date.now()}.ps1`);

    const scriptLines = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
      '',
      '$locallow = [IO.Path]::Combine([Environment]::GetFolderPath("ApplicationData"), "..", "LocalLow", "miHoYo", "ZenlessZoneZero")',
      '$logPath = Join-Path $locallow "Player.log"',
      'if (-not [IO.File]::Exists($logPath)) { $logPath = Join-Path $locallow "Player-prev.log" }',
      'if (-not [IO.File]::Exists($logPath)) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      '$gamePath = ""',
      'foreach ($line in (Get-Content $logPath -First 16)) {',
      '  if ($line.StartsWith("[Subsystems] Discovering subsystems at path ")) {',
      '    $gamePath = $line.Replace("[Subsystems] Discovering subsystems at path ", "").Replace("UnitySubsystems", "")',
      '    break',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($gamePath)) { Write-Output "ERR:no_game_path"; exit 1 }',
      '',
      '$cacheFolders = Get-ChildItem (Join-Path $gamePath "webCaches") -Directory -ErrorAction SilentlyContinue',
      '$maxVer = [long]0',
      '$cachePath = ""',
      'foreach ($f in $cacheFolders) {',
      '  if ($f.Name -match "^\\d+\\.\\d+\\.\\d+\\.\\d+$") {',
      '    $ver = [long](-join ($f.Name.Split(".") | ForEach-Object { $_.PadLeft(3, "0") }))',
      '    if ($ver -ge $maxVer) { $maxVer = $ver; $cachePath = Join-Path $f.FullName "Cache\\Cache_Data\\data_2" }',
      '  }',
      '}',
      'if ([string]::IsNullOrEmpty($cachePath) -or -not [IO.File]::Exists($cachePath)) { Write-Output "ERR:no_cache"; exit 1 }',
      '',
      '$tmp = [IO.Path]::GetTempFileName()',
      'Copy-Item $cachePath $tmp -Force',
      '$data = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8)',
      'Remove-Item $tmp -Force',
      '',
      '$parts = $data -split "1/0/"',
      'for ($i = $parts.Length - 1; $i -ge 0; $i--) {',
      '  $p = $parts[$i]',
      '  if ($p.StartsWith("http") -and $p.Contains("getGachaLog")) {',
      '    $url = ($p -split [char]0)[0]',
      '    Write-Output $url',
      '    exit 0',
      '  }',
      '}',
      'Write-Output "ERR:no_url"',
      'exit 1',
    ];

    try {
      fs.writeFileSync(tmpFile, scriptLines.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `Failed to write temp script: ${e.message}` });
      return;
    }

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

    const timer = setTimeout(() => {
      ps.kill();
      cleanup();
      resolve({ ok: false, error: 'Timed out retrieving signal URL. Make sure Zenless Zone Zero is open and you have visited your Signal Search in-game.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      cleanup();
      const matches = [...stdout.matchAll(/https:\/\/\S+getGachaLog\S+/g)];
      if (matches.length) {
        // Strip the raw URL down to the 8 auth/identity params the API needs.
        // Keeping extra params like gacha_id, init_log_gacha_type, begin_id causes
        // the API to hang when gacha_type doesn't match them — confirmed by testing.
        const raw  = new URL(matches[matches.length - 1][0].trim());
        const keep = ['authkey_ver', 'sign_type', 'auth_appid', 'authkey', 'lang', 'region', 'game_biz', 'plat_type'];
        const clean = new URL(`${raw.protocol}//${raw.host}${raw.pathname}`);
        for (const k of keep) {
          if (raw.searchParams.has(k)) clean.searchParams.set(k, raw.searchParams.get(k));
        }
        resolve({ ok: true, url: clean.toString() });
      } else {
        let errMsg = 'Could not find signal URL. Open Zenless Zone Zero, visit your Signal Search (any banner), then try again.';
        if (stdout.includes('ERR:no_log'))       errMsg = 'Could not find ZZZ log file. Make sure Zenless Zone Zero has been launched at least once.';
        else if (stdout.includes('ERR:no_game_path')) errMsg = 'Could not find ZZZ install path. Make sure Zenless Zone Zero has been launched recently.';
        else if (stdout.includes('ERR:no_cache')) errMsg = 'Could not find ZZZ web cache. Open Zenless Zone Zero, visit your Signal Search (any banner), then try again.';
        resolve({ ok: false, error: errMsg });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── Wuthering Waves (Kuro Games) ──────────────────────────────────────────────
// Kuro exposes an official gacha-record API (unlike NTE), reached via a
// Convene History URL embedded in the game's own Client.log. There's no
// single reliable install path, so this locates the game folder the same
// way the log-URL itself is found for the other titles: a temp .ps1 script
// (registry scan, falling back to common drive-letter paths) that prints
// either the URL or an ERR:* sentinel, adapted from the zzz:readLog pattern
// above (reference: community open-source WuWa trackers use an equivalent
// registry+drive scan; this is a fresh implementation, not a port).
ipcMain.handle('wuwa:readLog', () => {
  return new Promise((resolve) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `wuwa-link-${Date.now()}.ps1`);

    const scriptLines = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      '',
      'function Test-WuwaRoot($root) {',
      '  if ([string]::IsNullOrWhiteSpace($root)) { return $null }',
      '  if ($root -match "(?i)onedrive") { return $null }',
      '  $log = Join-Path $root "Client\\Saved\\Logs\\Client.log"',
      '  if ([IO.File]::Exists($log)) { return $log }',
      '  return $null',
      '}',
      '',
      '$candidates = New-Object System.Collections.Generic.List[string]',
      '',
      '# Registry: MUI cache entries reference the game exe with its full path.',
      'try {',
      '  $mui = (Get-ItemProperty "HKCU:\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache" -ErrorAction SilentlyContinue).PSObject.Properties',
      '  foreach ($p in $mui) {',
      '    if ($p.Value -like "*Wuthering Waves*" -and $p.Name -like "*client-win64-shipping.exe*") {',
      '      $exePath = $p.Name -replace "\\.FriendlyAppName$", ""',
      '      $idx = $exePath.IndexOf("\\Client\\Binaries")',
      '      if ($idx -gt 0) { $candidates.Add($exePath.Substring(0, $idx)) }',
      '    }',
      '  }',
      '} catch {}',
      '',
      '# Registry: uninstall entries.',
      'try {',
      '  $paths = @("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*", "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*")',
      '  Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue |',
      '    Where-Object { $_.DisplayName -like "*Wuthering Waves*" } |',
      '    ForEach-Object { if ($_.InstallPath) { $candidates.Add($_.InstallPath) } }',
      '} catch {}',
      '',
      '# Fallback: common install locations on every present drive letter.',
      'foreach ($letter in [char[]]([char]"A"..[char]"Z")) {',
      '  $drive = "$letter`:"',
      '  if (-not (Test-Path "$drive\\")) { continue }',
      '  $bases = @(',
      '    "Wuthering Waves Game", "Wuthering Waves\\Wuthering Waves Game",',
      '    "Program Files\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Program Files (x86)\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Games\\Wuthering Waves Game", "Games\\Wuthering Waves\\Wuthering Waves Game",',
      // Steam installs put Client\ directly under "...common\Wuthering Waves"
      // — no extra "Wuthering Waves Game" subfolder (confirmed against a real
      // install). Both forms are still checked below since installer
      // conventions have varied historically.
      '    "SteamLibrary\\steamapps\\common\\Wuthering Waves",',
      '    "SteamLibrary\\steamapps\\common\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Program Files (x86)\\Steam\\steamapps\\common\\Wuthering Waves",',
      '    "Program Files (x86)\\Steam\\steamapps\\common\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Program Files\\Steam\\steamapps\\common\\Wuthering Waves",',
      '    "Program Files\\Steam\\steamapps\\common\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Steam\\steamapps\\common\\Wuthering Waves",',
      '    "Steam\\steamapps\\common\\Wuthering Waves\\Wuthering Waves Game",',
      '    "Program Files\\Epic Games\\WutheringWavesj3oFh\\Wuthering Waves Game",',
      '    "Program Files (x86)\\Epic Games\\WutheringWavesj3oFh\\Wuthering Waves Game"',
      '  )',
      '  foreach ($b in $bases) { $candidates.Add((Join-Path $drive $b)) }',
      '}',
      '',
      '$logFiles = @()',
      'foreach ($c in ($candidates | Select-Object -Unique)) {',
      '  $log = Test-WuwaRoot $c',
      '  if ($log) { $logFiles += (Get-Item $log) }',
      '}',
      'if ($logFiles.Count -eq 0) { Write-Output "ERR:no_game_path"; exit 1 }',
      '',
      '$newest = $logFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1',
      '',
      '# Client.log is locked while the game runs — copy to bypass, same as zzz:readLog.',
      '$tmpLog = [IO.Path]::GetTempFileName()',
      'try { Copy-Item $newest.FullName $tmpLog -Force } catch { Write-Output "ERR:no_log"; exit 1 }',
      '$bytes = [IO.File]::ReadAllBytes($tmpLog)',
      'Remove-Item $tmpLog -Force -ErrorAction SilentlyContinue',
      'if ($bytes.Length -eq 0) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      '# Client.log is byte-obfuscated (confirmed against a real install, not a',
      '# documented format): per byte, if the low nibble is odd XOR with 0xA5,',
      '# otherwise XOR with 0xEF. Plain-text search without this step matches',
      '# nothing even though the URL is genuinely in the file.',
      '$decoded = New-Object byte[] $bytes.Length',
      'for ($i = 0; $i -lt $bytes.Length; $i++) {',
      '  $b = $bytes[$i]',
      '  if (($b -band 0x0F) % 2 -eq 1) { $decoded[$i] = $b -bxor 0xA5 }',
      '  else { $decoded[$i] = $b -bxor 0xEF }',
      '}',
      '$content = [Text.Encoding]::UTF8.GetString($decoded)',
      'if ([string]::IsNullOrEmpty($content)) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      // PowerShell single-quoted string below (not double-quoted) — the
      // pattern needs a literal `"` inside its [^\s"] character class, and
      // PowerShell double-quoted strings have no backslash-escape for that
      // (unlike JS/C's \") — a \" inside a PS "..." string just terminates
      // the string early, corrupting the whole line. Confirmed broken this
      // way against a real install before switching to single quotes.
      '$matches = [regex]::Matches($content, \'https://aki-gm-resources(-oversea)?\\.aki-game\\.(net|com)/aki/gacha/index\\.html#/record[^\\s"]+\')',
      'if ($matches.Count -eq 0) { Write-Output "ERR:no_url"; exit 1 }',
      'Write-Output $matches[$matches.Count - 1].Value',
      'exit 0',
    ];

    try {
      fs.writeFileSync(tmpFile, scriptLines.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `Failed to write temp script: ${e.message}` });
      return;
    }

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });

    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

    const timer = setTimeout(() => {
      ps.kill();
      cleanup();
      resolve({ ok: false, error: 'Timed out retrieving Convene History URL. Make sure Wuthering Waves is installed and you have opened Convene History in-game.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      cleanup();
      const matches = [...stdout.matchAll(/https:\/\/aki-gm-resources(?:-oversea)?\.aki-game\.(?:net|com)\/aki\/gacha\/index\.html#\/record\S+/g)];
      if (matches.length) {
        resolve({ ok: true, url: matches[matches.length - 1][0].trim() });
      } else {
        let errMsg = 'Could not find Convene History URL. Open Wuthering Waves, view your Convene History (any banner), then try again.';
        if (stdout.includes('ERR:no_game_path')) errMsg = 'Could not find Wuthering Waves install folder. Make sure the game has been launched at least once.';
        else if (stdout.includes('ERR:no_log'))  errMsg = 'Could not read the Wuthering Waves Client.log file.';
        resolve({ ok: false, error: errMsg });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// Fetches one banner's full gacha record from Kuro's API. Unlike miHoYo's
// cursor-paginated endpoint, this returns the entire history in one call —
// cardPoolType must be sent as a NUMBER or the API 404s.
ipcMain.handle('wuwa:fetchGachaLog', (event, { url, cardPoolType }) => {
  return new Promise((resolve) => {
    let parsed;
    try {
      const fragment = url.split('#')[1] ?? '';
      const qs = fragment.split('?')[1] ?? '';
      const p = new URLSearchParams(qs);
      parsed = {
        apiBase:      url.includes('aki-game.net') ? 'https://gmserver-api.aki-game2.net' : 'https://gmserver-api.aki-game2.com',
        serverId:     p.get('svr_id') ?? '',
        playerId:     p.get('player_id') ?? '',
        recordId:     p.get('record_id') ?? '',
        languageCode: p.get('lang') ?? 'en',
        cardPoolId:   p.get('resources_id') ?? '',
      };
      if (!parsed.playerId || !parsed.recordId) {
        resolve({ ok: false, error: 'Convene History URL is missing player_id or record_id — re-open Convene History in-game for a fresh URL.' });
        return;
      }
    } catch (e) {
      resolve({ ok: false, error: `Invalid Convene History URL: ${e.message}` });
      return;
    }

    const body = JSON.stringify({
      cardPoolId:   parsed.cardPoolId,
      cardPoolType: Number(cardPoolType),
      languageCode: parsed.languageCode,
      playerId:     parsed.playerId,
      recordId:     parsed.recordId,
      serverId:     parsed.serverId,
    });

    const target = new URL(`${parsed.apiBase}/gacha/record/query`);
    const req = https.request({
      hostname: target.hostname,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code !== 0) {
            resolve({ ok: false, error: `Kuro API error ${json.code}: ${json.message}` });
            return;
          }
          resolve({ ok: true, pulls: json.data ?? [] });
        } catch (e) {
          resolve({ ok: false, error: `Failed to parse Kuro API response: ${e.message}` });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Kuro API request timed out.' }); });
    req.on('error', err => resolve({ ok: false, error: `Kuro API request failed: ${err.message}` }));
    req.write(body);
    req.end();
  });
});

// ─── NTE capture ──────────────────────────────────────────────────────────────
// Reads pull history directly from NTE's own network traffic (pktmon,
// requiring two admin/UAC prompts per sync) rather than OCR-scanning the
// screen — no local-cache or network-replay trick exists for NTE's gacha
// history (the engine's own log is encrypted and no webview backs the
// Record screen), and OCR proved unreliable for exact reward/timestamp
// identity. See electron/engine/nte/captureOrchestrator.js for the full
// history of what was tried (including the original OCR approach this
// replaced, and the raw-socket/retry-system attempts that were built and
// reverted before landing here) and electron/engine/nte/navigation.js for
// the click/scroll automation and its own double-pass redundancy against
// random UDP packet loss.
//
// Consent and the overlay-enabled toggle live in the renderer
// (useNteCapture.js) — this side grabs the mouse, runs the capture, and
// reports status back over IPC exactly like the original OCR-based capture
// did (same 'nte:capture:*' channel contract), just backed by the
// packet-capture orchestrator now instead of OCR table-scanning. ESC is a
// global shortcut for the run's duration only, since the game window (not
// this app) has focus while it's active.
//
// Physical mouse input is not blocked (two Win32 mechanisms were tried and
// both fell short — see git history if curious). Instead, a low-level hook
// running in a separate forked process (see mouseWatcher.js/
// mouseWatcherProcess.js) detects any non-injected mouse event the instant
// it happens and aborts exactly like an ESC-interrupt. NOTE: this only
// works cleanly when the app itself is already running elevated (so pktmon
// never needs to show its own UAC prompt mid-run) — for a normal,
// non-elevated install, clicking through the two pktmon UAC prompts IS a
// real physical mouse click and WILL trigger this abort. Fixing that
// properly needs pktmon's elevation to happen via a pre-authorized
// mechanism (e.g. a scheduled task registered once at install/first-run)
// instead of a fresh Start-Process -Verb RunAs every time — noted as
// follow-up work, not yet built.
//
// Both capture and calibrate check the window's client-area aspect ratio
// (isSupportedAspectRatio) rather than requiring exact fullscreen — an
// earlier version required the window to exactly match its monitor's
// resolution, which meant fighting Electron's System-DPI-Aware default
// (DwmGetWindowAttribute/MonitorFromWindow/GetMonitorInfoW all get silently
// virtualized) and proved unreliable in practice. Matches how a working,
// shipped tool doing the same kind of screen-coordinate automation
// (Inventory Kamera) actually handles this: support a sane aspect ratio,
// not a specific display mode — works in both fullscreen and windowed mode.

let nteCaptureActive = false;

let nteCalibrateActive = false;
let nteCalibrateInterrupted = false;

function sendNteStatus(status, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nte:capture:status', { status, ...payload });
  }
}

function sendNteCalibrateStatus(status, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('nte:calibrate:status', { status, ...payload });
  }
}

function stopNteCaptureRun() {
  nteCaptureActive = false;
}

ipcMain.handle('nte:capture:findWindow', () => {
  const found = nteCapture.findNteWindow();
  if (!found) return { found: false };
  return { found: true, bounds: found.bounds, aspectRatioOk: nteCapture.isSupportedAspectRatio(found.bounds) };
});

ipcMain.on('nte:capture:cancel', () => {
  if (!nteCaptureActive) return;
  // The capture runs in a completely separate, elevated OS process with no
  // shared memory — this file-based marker (see taskSchedulerSetup.js's
  // requestCancel) is the only way to actually reach it.
  nteTaskScheduler.requestCancel();
});

// Persists a completed capture's merged history and reports the newly-added
// entries back to the renderer. pullLog goes to its own pullLog.json (same
// split as the generic game:writeState path — see getPullLogFile), NOT
// embedded in data.json; a prior version of this function wrote pullLog
// straight into data.json, a leftover from before that split existed. That
// meant "Clear Pull History" (which only ever touches pullLog.json) never
// actually reached NTE's real copy of its history — data.json still had the
// full pre-clear pullLog sitting in it, so the very next sync read it back
// as "existing history" and early-stopped as if nothing had been cleared.
function persistNteCaptureResult(dataDir, existingState, result) {
  fs.mkdirSync(dataDir, { recursive: true });
  const newPullLog = [...result.characterLimitedMerged, ...result.characterStandardMerged, ...result.arcMerged];
  const dataFile = path.join(dataDir, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify({ ...existingState, lastSynced: new Date().toISOString() }, null, 2));
  fs.writeFileSync(getPullLogFile(dataDir), JSON.stringify(newPullLog, null, 2));
  const backupResult = checkAndBackupPullLog(dataDir, newPullLog);
  if (!backupResult.ok) console.warn('[pullLogBackup] nte', backupResult.reason);
  // Only the newly-added entries go back over IPC (matches the OCR flow's
  // old staged-entries contract) — useNteCapture.js appends these onto the
  // renderer's own copy of pullLog rather than needing the whole
  // (potentially large) history round-tripped.
  sendNteStatus('completed', { entries: [...result.characterLimitedAdded, ...result.characterStandardAdded, ...result.arcAdded] });
}

// Runs the capture via the pre-authorized Scheduled Task (see
// taskSchedulerSetup.js/elevatedWorker.js) — a completely separate process
// does the actual window-finding/focus/clicking/pktmon work, elevated, with
// zero UAC prompts once the task is registered. The only path now — the
// original in-process flow (reliable only when the main app itself was
// already launched elevated) was removed once this could guarantee a
// working, prompt-minimal path for every user regardless of how they
// launched the app; nte:capture:start below registers the task on first
// use automatically if it isn't already.
async function runNteCaptureViaElevatedTask({ overlayEnabled, calibration, dataDir }) {
  // loadUidState (not a raw data.json read) so an old pre-split install with
  // pullLog/history still embedded in data.json gets self-migrated out to
  // their own files here too, same as every other read path — see
  // persistNteCaptureResult for why writing pullLog straight into data.json
  // was the actual bug behind "Clear Pull History" seeming to not work.
  // history AND stats are dropped here too (not just pullLog) — this flow
  // only ever touches pull history, so the income ledger and computed stats
  // must stay untouched in their own files rather than getting re-embedded
  // into data.json by persistNteCaptureResult's `{ ...existingState, ... }`
  // write below. (stats gets recomputed fresh anyway once the renderer sees
  // the new pullLog — see useTrackerState.js — so dropping the stale copy
  // here is also just correct, not merely tidy.)
  const { pullLog: existingPullLog, history: _existingHistory, stats: _existingStats, ...existingState } = loadUidState(dataDir);

  sendNteStatus('running', {});

  // ESC is documented (NteCaptureConsent.js) as interrupting a run
  // immediately — routes to the same file-based cancel marker the Cancel
  // button uses, since (same as Cancel) there's no other way to reach the
  // separate elevated process actually running the capture.
  //
  // NOTE: Windows' RegisterHotKey (what globalShortcut uses) exclusively
  // consumes the key system-wide while registered — including our OWN
  // SendInput-injected ESC in navigation.js's navigateToArcRecords/
  // exitToPullScreen, which needs a real ESC to reach NTE to close its
  // Records modal mid-run. That conflict is real and still unresolved here;
  // per explicit instruction this shortcut is NOT to be removed as the fix
  // — a non-consuming solution (e.g. a low-level keyboard hook, mirroring
  // mouseWatcher.js's non-exclusive mouse hook) is needed instead so both
  // Escape-to-cancel and the scripted ESC can coexist.
  globalShortcut.register('Escape', () => { nteTaskScheduler.requestCancel(); });

  try {
    const result = await nteTaskScheduler.triggerTaskAndWaitForResult({
      type: 'capture',
      calibration,
      overlayEnabled,
      profileDataDir: app.activeProfileDataDir,
      existingHistory: {
        characterLimited: existingPullLog.filter(e => e.banner === 'character-limited'),
        characterStandard: existingPullLog.filter(e => e.banner === 'character-standard'),
        arc: existingPullLog.filter(e => e.banner === 'arc'),
      },
    }, {
      onProgress: p => mainWindow?.webContents.send('nte:capture:progress', p),
    });

    if (result.status === 'completed') {
      persistNteCaptureResult(dataDir, existingState, result);
      return;
    }
    if (result.status === 'interrupted') {
      sendNteStatus('interrupted', { error: result.error || 'Capture interrupted — nothing was saved.' });
      return;
    }
    console.log('[nte capture] elevated-task non-completed result:', result);
    sendNteStatus('error', { error: result.error || 'Capture failed.' });
  } catch (e) {
    console.log('[nte capture] elevated-task threw:', e);
    sendNteStatus('error', { error: e.message });
  } finally {
    try { globalShortcut.unregister('Escape'); } catch (_) {}
  }
}

ipcMain.on('nte:capture:start', async (_, { uid, overlayEnabled, calibration }) => {
  if (nteCaptureActive || nteCalibrateActive) return;
  nteCaptureActive = true;

  const REQUIRED_POINTS = ['characterBoardDetailsButton', 'characterDiceRollRecordsTab', 'characterRecordsCloseButton', 'limitedBannerIcon', 'standardBannerIcon', 'arcMenuButton', 'arcBannerIcon', 'arcHistoryButton', 'arcRecordsTab', 'nextButton'];
  const missingPoint = REQUIRED_POINTS.find(p => !calibration?.[p]);
  if (missingPoint) {
    nteCaptureActive = false;
    sendNteStatus('error', { error: `NTE calibration is incomplete (missing "${missingPoint}") — calibrate all points in Settings before syncing.` });
    return;
  }

  const dataDir = getGameDataDir('nte', uid);

  try {
    let useElevatedTask = await nteTaskScheduler.isTaskRegistered().catch(() => false);

    // Auto-register on first use rather than requiring the separate Settings
    // toggle to be clicked ahead of time — guarantees every user actually
    // gets the working (elevated) path instead of silently landing on the
    // in-process fallback's known focus-stealing limitation just because
    // they never noticed a manual setup button. One real UAC prompt, this
    // one time only; every sync after this (for anyone) hits the
    // already-registered task with zero prompts. If the user declines or it
    // fails, capture stops here with a clear reason rather than quietly
    // degrading to the broken path.
    if (!useElevatedTask) {
      try {
        await nteTaskScheduler.registerTask();
        useElevatedTask = true;
      } catch (e) {
        sendNteStatus('error', { error: `One-time setup failed: ${e.message}` });
        return;
      }
    }

    await runNteCaptureViaElevatedTask({ overlayEnabled, calibration, dataDir });
  } catch (e) {
    console.log('[nte capture] threw:', e);
    sendNteStatus('error', { error: e.message });
  } finally {
    // Guaranteed regardless of which branch above ran, or whether something
    // threw before reaching any of them. Just resets nteCaptureActive — the
    // actual capture resources (overlay, mouse-watcher) live and get
    // cleaned up inside the separate elevated worker process, not here.
    stopNteCaptureRun();
  }
});

// ─── NTE elevated-capture setup ─────────────────────────────────────────────
// One-time, user-initiated setup for the Scheduled-Task-based elevated
// capture path (see taskSchedulerSetup.js/elevatedWorker.js): registering
// the task needs one real elevation (a UAC prompt from Start-Process -Verb
// RunAs), after which nte:capture:start automatically prefers it over the
// in-process fallback for every future sync, with zero further prompts.
// Entirely optional — declining or skipping this leaves NTE capture working
// exactly as it does today (in-process), just requiring the app itself to
// be launched elevated for reliable focus-stealing.
ipcMain.handle('nte:elevatedSetup:status', async () => {
  const registered = await nteTaskScheduler.isTaskRegistered().catch(() => false);
  return { registered };
});

ipcMain.handle('nte:elevatedSetup:register', async () => {
  try {
    await nteTaskScheduler.registerTask();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('nte:elevatedSetup:unregister', async () => {
  try {
    await nteTaskScheduler.unregisterTask();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ─── NTE calibration ────────────────────────────────────────────────────────
// Lets the user teach the app where a specific UI element (e.g. "next page"
// button) is, instead of us guessing fixed coordinates that would break the
// moment layout/resolution/UI scale differs from whatever we assumed. Focus
// + aspect-ratio requirements match capture (see the comment above).
//
// The captured point is reported as a fraction of the window's own CLIENT
// AREA (0-1 on both axes), not raw pixels — this is what makes it portable
// across different resolutions/windowed-vs-fullscreen, as long as NTE's own
// UI scales proportionally with its viewport (standard for a modern engine).

ipcMain.on('nte:calibrate:cancel', () => {
  if (!nteCalibrateActive) return;
  nteCalibrateInterrupted = true;
});

ipcMain.on('nte:calibrate:start', async (_, { pointId } = {}) => {
  if (nteCaptureActive || nteCalibrateActive) return;
  nteCalibrateActive = true;
  nteCalibrateInterrupted = false;

  const found = nteCapture.findNteWindow();
  if (!found) {
    nteCalibrateActive = false;
    sendNteCalibrateStatus('error', { pointId, error: 'NTE window not found. Make sure the game is running.' });
    return;
  }

  if (!nteCapture.isSupportedAspectRatio(found.bounds)) {
    nteCalibrateActive = false;
    sendNteCalibrateStatus('error', { pointId, error: 'NTE window has an unsupported aspect ratio (expected 16:9 or 16:10).' });
    return;
  }

  await nteCapture.focusWindow(found.hwnd);
  await new Promise(r => setTimeout(r, 200));

  globalShortcut.register('Escape', () => { nteCalibrateInterrupted = true; });

  let capturedPoint = null;

  // Catches the click on our OWN overlay window (sized to exactly match
  // found.bounds) rather than the game's — confirmed live that a genuine
  // system-wide low-level mouse hook (the old mechanism, mouseWatcher.js's
  // 'click' mode) never sees a right-click that lands on NTE's own window,
  // consistent with the game installing its own input hook ahead of others
  // in the chain (a common basic anti-macro measure). Since the overlay is
  // our own renderer, the click coordinates come back already normalized
  // to its own viewport (0-1 fractions) — no bounds math needed here at
  // all, unlike the old hook-based path which had to diff absolute screen
  // coordinates against found.bounds itself.
  const onCalibrationClick = (_e, { x, y }) => {
    capturedPoint = { x, y };
    nteCalibrateInterrupted = true;
  };
  ipcMain.on('nte:overlay:calibration-click', onCalibrationClick);

  try {
    nteOverlay.createOverlay(found.bounds);
    nteOverlay.enableCalibrationMode();

    sendNteCalibrateStatus('waiting', { pointId });

    while (!nteCalibrateInterrupted) {
      if (!nteCapture.isWindowValid(found.hwnd)) {
        sendNteCalibrateStatus('error', { pointId, error: 'Game window closed during calibration.' });
        return;
      }
      await new Promise(r => setTimeout(r, 150));
    }

    if (capturedPoint) {
      sendNteCalibrateStatus('captured', { pointId, ...capturedPoint });
    } else {
      sendNteCalibrateStatus('interrupted', { pointId, error: 'Calibration cancelled — no point captured.' });
    }
  } finally {
    nteCalibrateActive = false;
    try { globalShortcut.unregister('Escape'); } catch (_) {}
    ipcMain.removeListener('nte:overlay:calibration-click', onCalibrationClick);
    nteOverlay.disableCalibrationMode();
    nteOverlay.destroyOverlay();
  }
});

app.on('before-quit', () => {
  try { globalShortcut.unregister('Escape'); } catch (_) {}
  nteOverlay.destroyOverlay();
  nteMouseWatcher.stopWatchingPhysicalMouse();
});

// ─── HSR import IPC handlers ──────────────────────────────────────────────────

ipcMain.handle('hsr:parseExcel', async (_, { buffer }) => {
  try {
    return { ok: true, ...parseHsrExcel(Buffer.from(buffer), null) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Fetches gc-data's HSR gachaId lookup table (built/refreshed by
// tools/hsr-gachaid-scan.js's repo-side counterpart, games/hsr/scripts/
// build-gachaid-table.js) — same conditional-fetch + local-cache-fallback
// shape as fetchHsrBannerData(), so the .dat export still works offline
// using whatever table was last fetched.
async function fetchHsrGachaIdTable() {
  fs.mkdirSync(app.hsrCacheDir, { recursive: true });
  const tablePath = path.join(app.hsrCacheDir, 'gachaid-table.json');
  const etagPath  = path.join(app.hsrCacheDir, 'gachaid-table.etag');

  let storedTable = {};
  if (fs.existsSync(tablePath)) {
    try { storedTable = readJson(tablePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('games/hsr/gachaid-table.json', storedEtag);
    if (result.notModified) return storedTable;

    const table = JSON.parse(result.body);
    fs.writeFileSync(tablePath, JSON.stringify(table));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    return table;
  } catch (_) {}

  return storedTable;
}

// ─── HSR: patch a real StarRailStation .dat backup with our pull history ─────
// The renderer's HsrBackupImportModal always supplies a real .dat the user
// downloaded from StarRailStation themselves (drag-drop or click-to-browse) —
// there's no more "I don't have one" path that silently falls back to a
// bundled empty-account template. That fallback was a real data-loss risk:
// if the user actually did have calculator/social data on StarRailStation but
// didn't realize it, their real data would silently never make it into the
// exported file. Now the user always gets StarRailStation's own "empty"
// export for a fresh account instead, so nothing can be silently skipped.
ipcMain.handle('hsr:exportDatBackup', async (_, { pullLog, serverOffset, baseBuffer }) => {
  try {
    if (!baseBuffer) return { ok: false, error: 'No backup file provided.' };
    const baseBufferNode = Buffer.from(baseBuffer);

    const gachaIdTable = await fetchHsrGachaIdTable();
    const { bannerSchedule } = await fetchHsrBannerData();

    const { buffer, gaps } = buildHsrDatExport(pullLog, baseBufferNode, gachaIdTable, bannerSchedule, serverOffset ?? 8);

    const dateStr = new Date().toISOString().slice(0, 10);
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Patched Backup',
      defaultPath: `starrailstation-backup_patched_${dateStr}.dat`,
      filters: [{ name: 'StarRailStation Backup', extensions: ['dat'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return { ok: false, cancelled: true };

    fs.writeFileSync(saveResult.filePath, buffer);

    // Diagnostic dump alongside the export — while chasing down remaining
    // gap causes, a bare count isn't enough to know WHY something was
    // skipped. Written every time; cheap and harmless once this is settled.
    if (gaps.length) {
      const gapsPath = saveResult.filePath.replace(/\.dat$/, '.gaps.json');
      fs.writeFileSync(gapsPath, JSON.stringify(
        gaps.map(g => ({ name: g.name, banner: g.banner, time: g.time, reason: g._gapReason })),
        null, 2,
      ));
    }

    const gapsByReason = {};
    for (const g of gaps) gapsByReason[g._gapReason] = (gapsByReason[g._gapReason] ?? 0) + 1;

    return { ok: true, gapCount: gaps.length, gapsByReason };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('zzz:exportRngMoeBackup', async (_, { pullLog, uid }) => {
  try {
    const { backup, gaps } = buildZzzRngMoeExport(pullLog, uid);
    const dateStr = new Date().toISOString().slice(0, 10);
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save zzz.rng.moe Backup',
      defaultPath: `zzz-rngmoe-backup_${dateStr}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return { ok: false, cancelled: true };

    fs.writeFileSync(saveResult.filePath, JSON.stringify(backup));

    if (gaps.length) {
      const gapsPath = saveResult.filePath.replace(/\.json$/, '.gaps.json');
      fs.writeFileSync(gapsPath, JSON.stringify(gaps, null, 2));
    }

    return { ok: true, gapCount: gaps.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wuwa:exportWuwaTrackerBackup', async (_, { pullLog, uid }) => {
  try {
    const { backup, gaps } = buildWuwaTrackerExport(pullLog, uid);
    const dateStr = new Date().toISOString().slice(0, 10);
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Save wuwatracker.com Backup',
      defaultPath: `${uid}_${dateStr}_wuwatracker-pulls.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return { ok: false, cancelled: true };

    fs.writeFileSync(saveResult.filePath, JSON.stringify(backup));

    if (gaps.length) {
      const gapsPath = saveResult.filePath.replace(/\.json$/, '.gaps.json');
      fs.writeFileSync(gapsPath, JSON.stringify(gaps, null, 2));
    }

    return { ok: true, gapCount: gaps.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('hsr:fetchBanners', async () => {
  try {
    const { bannerSchedule } = await fetchHsrBannerData().catch(() => ({ bannerSchedule: [] }));
    return { ok: true, bannerSchedule };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

ipcMain.handle('hsr:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.hsrCacheDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`games/hsr/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// Inline script — reads Genshin's web cache directly without any network
// calls. Same technique as zzz:readLog/hsr:readLog above, ported from
// paimon.moe's getlink.ps1 instead of fetching it at runtime. Global client
// only — no China-client (miHoYo/原神) path, matching the rest of this app.
ipcMain.handle('gacha:readGenshinLog', () => {
  return new Promise((resolve) => {
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), `genshin-link-${Date.now()}.ps1`);

    const scriptLines = [
      '$ErrorActionPreference = "SilentlyContinue"',
      '$ProgressPreference = "SilentlyContinue"',
      '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
      '',
      '$locallow = [IO.Path]::Combine([Environment]::GetFolderPath("ApplicationData"), "..", "LocalLow", "miHoYo", "Genshin Impact")',
      '$logPath = Join-Path $locallow "output_log.txt"',
      'if (-not [IO.File]::Exists($logPath)) { Write-Output "ERR:no_log"; exit 1 }',
      '',
      '$gamePath = ""',
      '$m = (Get-Content $logPath) -match ".:/.+GenshinImpact_Data"',
      'if ($m.Length -gt 0 -and ($m[0] -match "(.:/.+GenshinImpact_Data)")) { $gamePath = $matches[1] }',
      'if ([string]::IsNullOrEmpty($gamePath)) { Write-Output "ERR:no_game_path"; exit 1 }',
      '',
      '$cacheFolders = Get-ChildItem (Join-Path $gamePath "webCaches") -Directory -ErrorAction SilentlyContinue',
      '$newest = $cacheFolders | Sort-Object LastWriteTime -Descending | Select-Object -First 1',
      'if (-not $newest) { Write-Output "ERR:no_cache"; exit 1 }',
      '$cachePath = Join-Path $newest.FullName "Cache\\Cache_Data\\data_2"',
      'if (-not [IO.File]::Exists($cachePath)) { Write-Output "ERR:no_cache"; exit 1 }',
      '',
      '$tmp = [IO.Path]::GetTempFileName()',
      'Copy-Item $cachePath $tmp -Force',
      '$data = [IO.File]::ReadAllText($tmp, [Text.Encoding]::UTF8)',
      'Remove-Item $tmp -Force',
      '',
      '$parts = $data -split "1/0/"',
      'for ($i = $parts.Length - 1; $i -ge 0; $i--) {',
      '  $p = $parts[$i]',
      '  if ($p.StartsWith("http") -and $p.Contains("getGachaLog")) {',
      '    $url = ($p -split [char]0)[0]',
      '    Write-Output $url',
      '    exit 0',
      '  }',
      '}',
      'Write-Output "ERR:no_url"',
      'exit 1',
    ];

    try {
      fs.writeFileSync(tmpFile, scriptLines.join('\n'), 'utf8');
    } catch (e) {
      resolve({ ok: false, error: `Failed to write temp script: ${e.message}` });
      return;
    }

    const ps = spawn('powershell.exe', [
      '-NonInteractive',
      '-NoProfile',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', tmpFile,
    ], { windowsHide: true });

    let stdout = '';
    let stderr = '';
    ps.stdout.on('data', d => { stdout += d.toString(); });
    ps.stderr.on('data', d => { stderr += d.toString(); });

    const cleanup = () => { try { fs.unlinkSync(tmpFile); } catch (_) {} };

    const timer = setTimeout(() => {
      ps.kill();
      cleanup();
      resolve({ ok: false, error: 'Timed out retrieving wish URL. Make sure Genshin Impact is open and you have visited your wish history.' });
    }, 30000);

    ps.on('close', () => {
      clearTimeout(timer);
      cleanup();
      const matches = [...stdout.matchAll(/https:\/\/\S+getGachaLog\S+/g)];
      if (matches.length) {
        // Strip to only the required auth/identity params, same as hsr/zzz:readLog.
        const raw   = new URL(matches[matches.length - 1][0].trim());
        const keep  = ['authkey', 'authkey_ver', 'sign_type', 'game_biz', 'lang'];
        const clean = new URL(`${raw.protocol}//${raw.host}${raw.pathname}`);
        for (const k of keep) {
          if (raw.searchParams.has(k)) clean.searchParams.set(k, raw.searchParams.get(k));
        }
        resolve({ ok: true, url: clean.toString() });
      } else {
        let errMsg = 'Could not find wish history URL. Open Genshin Impact, visit your wish history, then try again.';
        if (stdout.includes('ERR:no_log'))            errMsg = 'Could not find Genshin log file. Make sure Genshin Impact has been launched at least once.';
        else if (stdout.includes('ERR:no_game_path')) errMsg = 'Could not find Genshin install path. Make sure Genshin Impact has been launched recently.';
        else if (stdout.includes('ERR:no_cache'))      errMsg = 'Could not find Genshin web cache. Open Genshin Impact, visit your wish history, then try again.';
        resolve({ ok: false, error: errMsg });
      }
    });

    ps.on('error', err => {
      clearTimeout(timer);
      cleanup();
      resolve({ ok: false, error: `PowerShell unavailable: ${err.message}` });
    });
  });
});

// ─── HSR banner data ──────────────────────────────────────────────────────────

// Fetches HSR banner data. Builds two things:
// Fetches HSR banner schedule from private repo, falling back to local cache.
async function fetchHsrBannerData() {
  fs.mkdirSync(app.hsrCacheDir, { recursive: true });
  const schedulePath = path.join(app.hsrCacheDir, 'banner-schedule-hsr.json');
  const etagPath     = path.join(app.hsrCacheDir, 'banner-schedule-hsr.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('games/hsr/banner-schedule-hsr.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    releasedIds.refresh('hsr');
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

// ─── ZZZ banner data ──────────────────────────────────────────────────────────

// Fetches ZZZ banner schedule from private repo, falling back to local cache.
async function fetchZzzBannerData() {
  fs.mkdirSync(app.zzzCacheDir, { recursive: true });
  const schedulePath = path.join(app.zzzCacheDir, 'banner-schedule-zzz.json');
  const etagPath     = path.join(app.zzzCacheDir, 'banner-schedule-zzz.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('games/zzz/banner-schedule-zzz.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    releasedIds.refresh('zzz');
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

ipcMain.handle('zzz:fetchBanners', async () => {
  try {
    return { ok: true, ...(await fetchZzzBannerData()) };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

// ─── NTE banner data ──────────────────────────────────────────────────────────
// Unlike GI/HSR/ZZZ, this schedule isn't pulled from the Hoyoverse API (NTE
// has none) — the private repo's copy is computed/scraped by a GitHub Action
// (nte/scripts/build.js in the data repo). This handler only fetches +
// caches it, identically to the other 3 games.

// Fetches NTE banner schedule from private repo, falling back to local cache.
async function fetchNteBannerData() {
  fs.mkdirSync(app.nteCacheDir, { recursive: true });
  const schedulePath = path.join(app.nteCacheDir, 'banner-schedule-nte.json');
  const etagPath     = path.join(app.nteCacheDir, 'banner-schedule-nte.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('games/nte/banner-schedule-nte.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

ipcMain.handle('nte:fetchBanners', async () => {
  try {
    return { ok: true, ...(await fetchNteBannerData()) };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

// Full character+arc id manifest (nte/roster-images.json in the data repo) —
// lets the loading screen preload every icon, not just the ones tied to a
// confirmed banner phase. Same ETag-conditional cache pattern as
// fetchNteBannerData, but no merge logic needed — it's just a flat id list.
ipcMain.handle('nte:fetchRosterImageIds', async () => {
  try {
    fs.mkdirSync(app.nteCacheDir, { recursive: true });
    const cachePath = path.join(app.nteCacheDir, 'roster-images.json');
    const etagPath  = path.join(app.nteCacheDir, 'roster-images.etag');

    let stored = [];
    if (fs.existsSync(cachePath)) {
      try { stored = readJson(cachePath); } catch (_) {}
    }

    try {
      let storedEtag = null;
      try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

      const result = await fetchRepoFileConditional('games/nte/roster-images.json', storedEtag);
      if (result.notModified) return { ok: true, ids: stored };

      const ids = JSON.parse(result.body);
      fs.writeFileSync(cachePath, JSON.stringify(ids));
      if (result.etag) fs.writeFileSync(etagPath, result.etag);
      return { ok: true, ids };
    } catch (_) {
      return { ok: true, ids: stored };
    }
  } catch (e) {
    return { ok: false, ids: [], error: e.message };
  }
});

// NTE banner image — disk cache → private repo. .webp, not .png (nanoka.cc,
// the source the data repo's build script downloads from, only serves
// .webp — see nte/README.md in the data repo for why this isn't converted).
ipcMain.handle('nte:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.nteCacheDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.webp`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`games/nte/images/${id}.webp`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// ─── WuWa banner data ─────────────────────────────────────────────────────────
// Like NTE, this schedule isn't pulled from an authenticated first-party
// calendar API (Kuro's equivalent has no lang/auth option) — the private
// repo's copy is built by a GitHub Action (wuwa/scripts/build.js in the data
// repo) from Kuro's own public live calendar + nanoka.cc name resolution.
// This handler only fetches + caches it, identically to the other games.

async function fetchWuwaBannerData() {
  fs.mkdirSync(app.wuwaCacheDir, { recursive: true });
  const schedulePath = path.join(app.wuwaCacheDir, 'banner-schedule-wuwa.json');
  const etagPath     = path.join(app.wuwaCacheDir, 'banner-schedule-wuwa.etag');

  let storedSchedule = [];
  if (fs.existsSync(schedulePath)) {
    try { storedSchedule = readJson(schedulePath); } catch (_) {}
  }

  try {
    let storedEtag = null;
    try { storedEtag = fs.readFileSync(etagPath, 'utf-8').trim(); } catch (_) {}

    const result = await fetchRepoFileConditional('games/wuwa/banner-schedule-wuwa.json', storedEtag);

    if (result.notModified) return { bannerSchedule: storedSchedule };

    const repoSchedule = JSON.parse(result.body);
    const dedupKey     = b => `${b.featuredId ?? b.name}|${(b.start ?? '').slice(0, 10)}`;
    const existingIds  = new Set(repoSchedule.map(dedupKey));
    const localOnly    = storedSchedule.filter(b => !existingIds.has(dedupKey(b)));
    const merged       = [...repoSchedule, ...localOnly];
    fs.writeFileSync(schedulePath, JSON.stringify(merged));
    if (result.etag) fs.writeFileSync(etagPath, result.etag);
    return { bannerSchedule: merged };
  } catch (_) {}

  return { bannerSchedule: storedSchedule };
}

ipcMain.handle('wuwa:fetchBanners', async () => {
  try {
    return { ok: true, ...(await fetchWuwaBannerData()) };
  } catch (e) {
    return { ok: false, bannerSchedule: [], error: e.message };
  }
});

// WuWa banner image — disk cache → private repo. .webp (nanoka.cc source,
// same as NTE's images).
ipcMain.handle('wuwa:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.wuwaCacheDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.webp`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`games/wuwa/images/${id}.webp`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// ─── Showcase / enka.network IPC handlers ────────────────────────────────────

ipcMain.handle('showcase:fetchEnkaUid', async (_, { uid }) => {
  try {
    const { status, body } = await _fetchEnkaUid(uid);
    return { ok: status >= 200 && status < 300, status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  }
});

ipcMain.handle('showcase:fetchEnka', async (_, { uid, game }) => {
  try {
    const { status, body } = await _fetchByGame(uid, game);
    return { ok: status >= 200 && status < 300, status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e.message };
  }
});

ipcMain.handle('showcase:fetchHsrBuilds', async (_, { uid }) => {
  try {
    const result = await fetchAndNormalizeHsr(uid);
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Fetch an arbitrary image URL as a base64 data URI (bypasses renderer CORS for SVG filters).
const _imageB64Cache = new Map();
ipcMain.handle('showcase:fetchImageB64', async (_, { url }) => {
  if (_imageB64Cache.has(url)) return _imageB64Cache.get(url);
  try {
    const buf = await new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'GachaTracker' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    });
    const dataUri = `data:${detectImageMime(buf)};base64,${buf.toString('base64')}`;
    _imageB64Cache.set(url, dataUri);
    return dataUri;
  } catch {
    return null;
  }
});

// ZZZ banner image — disk cache → private repo
ipcMain.handle('zzz:getBannerImage', async (_, { id }) => {
  try {
    const cacheDir  = path.join(app.zzzCacheDir, 'banner-images');
    fs.mkdirSync(cacheDir, { recursive: true });
    const cacheFile = path.join(cacheDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`games/zzz/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// ─── Genshin banner image by featuredId ───────────────────────────────────────

ipcMain.handle('genshin:getBannerImageById', async (_, { id }) => {
  try {
    const bannerImgDir = path.join(app.genshinCacheDir, 'banner-images');
    fs.mkdirSync(bannerImgDir, { recursive: true });
    const cacheFile = path.join(bannerImgDir, `${id}.png`);
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile);
      return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
    }
    const data = await fetchRepoBuffer(`games/genshin/images/${id}.png`);
    fs.writeFileSync(cacheFile, data);
    return `data:${detectImageMime(data)};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
});

// On app launch: refresh banner data (name→ID map + schedule), then sweep all
// HSR bannerLists and the stored schedule to pre-cache any missing images.
// Runs fire-and-forget after createWindow() so it never delays startup.

// Make a single HTTPS GET request and return a raw Buffer
function httpsGetBuffer(urlStr) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const req = lib.get(urlStr, { timeout: 20000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
  });
}

// Make a single HTTPS GET request and parse the JSON response
function httpsGet(urlStr, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = urlStr.startsWith('https') ? https : http;
    const options = {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://webstatic.hoyoverse.com/',
        ...extraHeaders,
      },
    };
    const req = lib.get(urlStr, options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (_) { reject(new Error('Invalid API response — try again.')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out.')); });
  });
}

// Tracks in-flight gacha:fetchWishHistory requests the renderer has asked to
// cancel — Cancel used to only be checked BETWEEN separate fetchWishHistory
// calls (i.e. between whole banner categories), never DURING one, since that
// handler loops through up to 250 pages internally before ever returning
// control. A large resync (10,000+ pulls) could take minutes to respond to
// Cancel. requestId is generated once per sync (renderer-side) and checked
// every page iteration below; cancelledFetchIds is cleaned up on every exit
// path (success, error, or cancel) so it can't grow unbounded.
const cancelledFetchIds = new Set();

ipcMain.handle('gacha:cancelFetch', (event, { requestId }) => {
  if (requestId) cancelledFetchIds.add(requestId);
  return { ok: true };
});

// Fetch all pulls for one banner type from the HoYoverse API (handles pagination)
// cutoffTime: "YYYY-MM-DD HH:MM:SS" — stop once we hit pulls at or before this timestamp
ipcMain.handle('gacha:fetchWishHistory', async (event, { url, gachaType, cutoffTime, extraParams }) => {
  const requestId = extraParams?.requestId ?? null;
  try {
    const base = new URL(url);
    base.searchParams.set('gacha_type', gachaType);
    base.searchParams.set('size', '20');
    const cutoffId = extraParams?.cutoffId ?? null;
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (k !== 'pageDelay' && k !== 'cutoffId' && k !== 'requestId') base.searchParams.set(k, v);
      }
    }

    const allPulls = [];
    let endId = '0';

    // HoYoverse uses cursor-based pagination: page is always 1, end_id advances.
    // Incrementing page alongside end_id causes the API to return overlapping results.
    base.searchParams.set('page', '1');

    for (let page = 1; page <= 250; page++) {
      if (requestId && cancelledFetchIds.has(requestId)) {
        return { ok: false, cancelled: true };
      }
      base.searchParams.set('end_id', endId);

      const requestUrl = base.toString();

      // Retry up to 3 times on timeout — HoYoverse API slows down during long fetches.
      let data;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          data = await httpsGet(requestUrl);
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
      }

      if (data.retcode !== 0) {
        if (data.retcode === -101 || data.retcode === -100) {
          return { ok: false, error: 'Auth key expired. Open Genshin Impact, visit your wish history, then try again.' };
        }
        return { ok: false, error: `API error: ${data.message} (code ${data.retcode})` };
      }

      // ZZZ uses list_v2; Genshin and HSR use list
      const list = data.data?.list?.length ? data.data.list : (data.data?.list_v2 ?? []);
      if (!list.length) break;

      // ID-based cutoff (subsequent syncs): API returns newest-first.
      // Stop as soon as we hit a pull whose id <= the latest known pull id.
      if (cutoffId) {
        const newPulls = list.filter(p => p.id > cutoffId);
        allPulls.push(...newPulls);
        if (newPulls.length < list.length) break; // reached known pull — done
      } else if (cutoffTime) {
        // Timestamp fallback — kept for safety but not reached in normal operation.
        const oldest = list[list.length - 1].time;
        if (oldest <= cutoffTime) {
          allPulls.push(...list.filter(p => p.time >= cutoffTime));
          break;
        }
        allPulls.push(...list);
      } else {
        allPulls.push(...list);
      }
      endId = list[list.length - 1].id;
      try { event.sender.send('gacha:fetchProgress', { count: allPulls.length }); } catch (_) {}

      const pageDelay = extraParams?.pageDelay ? parseInt(extraParams.pageDelay, 10) : 1000;
      await new Promise(r => setTimeout(r, pageDelay));
    }

    return { ok: true, pulls: allPulls };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (requestId) cancelledFetchIds.delete(requestId);
  }
});

