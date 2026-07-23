// Win32 FFI primitives for the NTE gacha-history capture mechanism: locating
// the game window, moving the mouse, and staging captured pull data to a
// temp file before it's accepted into the permanent record.
//
// Uses koffi (already a project dependency — see hookNchittest/applyDwmRoundedCorners
// in electron/main.js for the established pattern) instead of a mouse-automation
// package: nut.js dropped its prebuilt npm binaries (paid subscription or build-
// from-source only) and robotjs is effectively unmaintained. SetCursorPos/SendInput
// are two more user32.dll calls in the same style already used in this codebase.

const koffi = require('koffi');
const fs = require('fs');
const path = require('path');

let _user32 = null;
function user32() {
  if (!_user32) _user32 = koffi.load('user32.dll');
  return _user32;
}

let _fns = null;
function fns() {
  if (_fns) return _fns;
  const u = user32();
  _fns = {
    GetClientRect:  u.func('bool __stdcall GetClientRect(intptr hwnd, void* lpRect)'),
    ClientToScreen: u.func('bool __stdcall ClientToScreen(intptr hwnd, void* lpPoint)'),
    SetCursorPos:   u.func('bool __stdcall SetCursorPos(int x, int y)'),
    GetCursorPos:   u.func('bool __stdcall GetCursorPos(void* lpPoint)'),
    SendInput:      u.func('uint32 __stdcall SendInput(uint32 cInputs, void* pInputs, int cbSize)'),
    IsWindow:       u.func('bool __stdcall IsWindow(intptr hwnd)'),
    IsWindowVisible: u.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
    SetForegroundWindow: u.func('bool __stdcall SetForegroundWindow(intptr hwnd)'),
    GetForegroundWindow: u.func('intptr __stdcall GetForegroundWindow()'),
    IsIconic:       u.func('bool __stdcall IsIconic(intptr hwnd)'),
    ShowWindow:     u.func('bool __stdcall ShowWindow(intptr hwnd, int nCmdShow)'),
    EnumWindows:    u.func('bool __stdcall EnumWindows(intptr lpEnumFunc, intptr lParam)'),
    GetWindowThreadProcessId: u.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, void* lpdwProcessId)'),
    MonitorFromWindow: u.func('intptr __stdcall MonitorFromWindow(intptr hwnd, uint32 dwFlags)'),
    GetMonitorInfoW:   u.func('bool __stdcall GetMonitorInfoW(intptr hMonitor, void* lpmi)'),
  };
  return _fns;
}

let _kernel32 = null;
function kernel32() {
  if (!_kernel32) _kernel32 = koffi.load('kernel32.dll');
  return _kernel32;
}

let _procFns = null;
function procFns() {
  if (_procFns) return _procFns;
  const k = kernel32();
  _procFns = {
    OpenProcess: k.func('intptr __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'),
    QueryFullProcessImageNameW: k.func('bool __stdcall QueryFullProcessImageNameW(intptr hProcess, uint32 dwFlags, void* lpExeName, void* lpdwSize)'),
    CloseHandle: k.func('bool __stdcall CloseHandle(intptr hObject)'),
  };
  return _procFns;
}

// NOTE: an earlier version wrapped every coordinate call here in
// SetThreadDpiAwarenessContext, theorizing Electron's System-DPI-Aware
// default was silently scaling these values (window measured as 1280x720
// against a real 1920x1080 resolution — exactly /1.5, matching 150% display
// scaling). That fix was abandoned as both unreliable (SetThreadDpiAwareness
// Context/GetThreadDpiAwarenessContext didn't round-trip sane values through
// koffi's intptr type for these negative pointer-sentinel constants) and
// wrong: the real cause turned out to be that FindWindowW(NULL, "NTE") was
// matching a DIFFERENT window than the actual fullscreen game — the launcher
// (NTEGlobalGame.exe) apparently keeps a window around that also matches the
// "NTE" title even while the real game is running. Title matching is
// replaced below with matching by owning PROCESS instead, which is
// unambiguous regardless of what any window happens to be titled.

const NTE_GAME_EXE_NAME = 'htgame.exe';
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

// Named "...2" for historical reasons: koffi.proto() registers type names
// globally in the process, and this file used to be loaded alongside a
// second, now-removed copy of capture.js that already registered a type
// under the plain "EnumWindowsProc" name, which collided ("Duplicate type
// name"). Only one copy of capture.js exists now, so the collision can't
// happen anymore — left named as-is since renaming a live FFI proto type
// isn't worth the risk for a purely internal, never-user-visible string.
const EnumWindowsProcType = koffi.proto('bool __stdcall EnumWindowsProc2(intptr hwnd, intptr lParam)');

// Returns the full path of the executable that owns hwnd, or null.
function getWindowExePath(hwnd) {
  const { GetWindowThreadProcessId } = fns();
  const pidBuf = Buffer.alloc(4);
  GetWindowThreadProcessId(hwnd, pidBuf);
  const pid = pidBuf.readUInt32LE(0);
  if (!pid) return null;

  const { OpenProcess, QueryFullProcessImageNameW, CloseHandle } = procFns();
  const hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!hProcess) return null;

  try {
    const nameBuf = Buffer.alloc(1024); // 512 WCHARs
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(512, 0); // capacity in CHARACTERS, not bytes — per docs
    if (!QueryFullProcessImageNameW(hProcess, 0, nameBuf, sizeBuf)) return null;
    const charsWritten = sizeBuf.readUInt32LE(0); // excludes null terminator, per docs
    return nameBuf.toString('utf16le', 0, charsWritten * 2);
  } finally {
    CloseHandle(hProcess);
  }
}

// Enumerates all top-level VISIBLE windows and returns the handle of the
// first one owned by a process whose executable filename matches (case-
// insensitive, filename only — not the full path, so this keeps working
// regardless of which drive/folder the game is installed in).
function findWindowByProcessExeName(targetExeName) {
  const { EnumWindows, IsWindowVisible } = fns();
  let found = null;

  const callback = koffi.register((hwnd) => {
    if (!IsWindowVisible(hwnd)) return true; // skip hidden windows, keep going
    const exePath = getWindowExePath(hwnd);
    if (exePath && path.basename(exePath).toLowerCase() === targetExeName) {
      found = hwnd;
      return false; // stop enumeration
    }
    return true;
  }, koffi.pointer(EnumWindowsProcType));

  EnumWindows(koffi.address(callback), 0);
  return found;
}

// ─── Window lookup ──────────────────────────────────────────────────────────

// Locates the NTE game window and returns its screen-space bounds, or null if
// it isn't currently running.
//
// Bounds come from the CLIENT area (GetClientRect + ClientToScreen), not the
// full window rect — the client area is exactly the game's own renderable
// viewport, excluding title bar/borders, so it's correct in both fullscreen
// and windowed mode without needing to compare against the monitor's
// resolution at all (see isSupportedAspectRatio, which replaced an earlier
// exact-fullscreen requirement).
//
// These numbers may not match the game's own reported resolution (e.g. they
// can come back DPI-virtualized by Windows) — that's expected and doesn't
// matter here, since moveMouseTo/getCursorPos below run through the exact
// same virtualization, so window measurement and cursor control stay
// consistent with each other regardless of the absolute values.
function findNteWindow() {
  const hwnd = findWindowByProcessExeName(NTE_GAME_EXE_NAME);
  if (!hwnd) return null;

  const { GetClientRect, ClientToScreen } = fns();

  // GetClientRect always returns left=top=0 — right/bottom already are the
  // client area's width/height.
  const clientBuf = Buffer.alloc(16);
  if (!GetClientRect(hwnd, clientBuf)) return null;
  const width  = clientBuf.readInt32LE(8);
  const height = clientBuf.readInt32LE(12);

  // ClientToScreen converts the client origin (0,0) into screen coordinates
  // — an in/out POINT, so pre-fill it with (0,0) first.
  const originBuf = Buffer.alloc(8);
  originBuf.writeInt32LE(0, 0);
  originBuf.writeInt32LE(0, 4);
  if (!ClientToScreen(hwnd, originBuf)) return null;
  const x = originBuf.readInt32LE(0);
  const y = originBuf.readInt32LE(4);

  return {
    hwnd,
    bounds: { x, y, width, height },
  };
}

const MONITOR_DEFAULTTONEAREST = 2;

// Diagnostic only: reports the monitor's full bounds (rcMonitor) and its
// work-area bounds (rcWork, which excludes the taskbar) for the monitor
// hwnd is on. Used to determine whether a short measurement is coming from
// the game window itself or from something downstream clamping to the work
// area — MONITORINFO layout is cbSize(4) + rcMonitor RECT(16) + rcWork
// RECT(16) + dwFlags(4) = 40 bytes, per Microsoft's struct docs.
function getMonitorInfoForWindow(hwnd) {
  const { MonitorFromWindow, GetMonitorInfoW } = fns();
  const hMonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  if (!hMonitor) return null;

  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(40, 0); // cbSize must be set before calling, per docs
  if (!GetMonitorInfoW(hMonitor, buf)) return null;

  const rect = (offset) => ({
    left: buf.readInt32LE(offset),
    top: buf.readInt32LE(offset + 4),
    right: buf.readInt32LE(offset + 8),
    bottom: buf.readInt32LE(offset + 12),
  });

  return { rcMonitor: rect(4), rcWork: rect(20) };
}

function isWindowValid(hwnd) {
  const { IsWindow } = fns();
  return !!IsWindow(hwnd);
}

// Brings the NTE window to the foreground before a run starts. Necessary in
// windowed mode: if NTE isn't actually the active/focused window, our
// synthetic clicks can't be trusted to land where the bounds math assumes
// they do.
//
// SetForegroundWindow alone reliably fails here: Windows has blocked a
// process from stealing foreground focus from an unrelated process since
// XP (our Electron app didn't create NTE's window and wasn't the last to
// receive input, so it doesn't qualify). The documented, widely-used
// workaround — verified before using it, not assumed — is that a real Alt
// keypress makes Windows itself grant the next SetForegroundWindow call,
// because Alt is treated as a signal the user wants to switch context.
//
// Needs a short delay between the two calls, not zero: multiple sources
// flag a timing race where Windows hasn't finished processing the Alt
// keypress yet if SetForegroundWindow is called in the same tick.
//
// SetForegroundWindow also silently does nothing if the target window is
// minimized (documented Win32 behavior, confirmed before relying on it) —
// IsWindow/IsWindowVisible both still report true for a minimized window,
// so findNteWindow() can't detect this case on its own. ShowWindow with
// SW_RESTORE has to run first whenever IsIconic reports minimized.
const SW_RESTORE = 9;

async function focusWindow(hwnd) {
  const { IsIconic, ShowWindow, SetForegroundWindow, GetForegroundWindow } = fns();

  const wasMinimized = !!IsIconic(hwnd);
  const showResult = wasMinimized ? !!ShowWindow(hwnd, SW_RESTORE) : null;
  tapAltKey();
  await new Promise(r => setTimeout(r, 80));
  const setResult = !!SetForegroundWindow(hwnd);
  const actualForeground = GetForegroundWindow();

  // Temporary diagnostic: focusWindow has silently failed to actually bring
  // NTE on screen twice in a row (debug hook still showed Discord/our own
  // app afterwards) despite SetForegroundWindow supposedly succeeding —
  // logging every step's real return value instead of guessing further.
  console.log('[nte focusWindow]', {
    targetHwnd: hwnd,
    wasMinimized,
    showResult,
    setForegroundResult: setResult,
    actualForegroundHwnd: actualForeground,
    matchesTarget: actualForeground === hwnd,
  });

  return setResult;
}

function isForegroundWindow(hwnd) {
  const { GetForegroundWindow } = fns();
  return GetForegroundWindow() === hwnd;
}

// Loose aspect-ratio sanity check (16:9 or 16:10 — the same two standard
// ratios Inventory Kamera supports) rather than requiring an exact match to
// the monitor's resolution. This is deliberately permissive: it's a sanity
// check that catches "window is some arbitrary/tiny shape, calibration
// would be meaningless," not a strict fullscreen gate — it works identically
// in fullscreen and windowed mode and never touches monitor/DPI APIs.
function isSupportedAspectRatio(bounds) {
  if (!bounds.width || !bounds.height) return false;
  const ratio = bounds.width / bounds.height;
  const RATIOS = [16 / 9, 16 / 10];
  const TOL = 0.03;
  return RATIOS.some(r => Math.abs(ratio - r) <= TOL);
}

// ─── Mouse control ──────────────────────────────────────────────────────────

function moveMouseTo(x, y) {
  const { SetCursorPos } = fns();
  SetCursorPos(Math.round(x), Math.round(y));
}

// Reads the actual current cursor position. Used to detect physical mouse
// interference: the caller compares this against the position it last
// commanded via moveMouseTo — a mismatch means a real hand moved the mouse
// between steps, since nothing else in this loop touches the cursor.
function getCursorPos() {
  const { GetCursorPos } = fns();
  const buf = Buffer.alloc(8); // POINT = 2x LONG (x, y)
  if (!GetCursorPos(buf)) return null;
  return { x: buf.readInt32LE(0), y: buf.readInt32LE(4) };
}

const INPUT_MOUSE          = 0;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP   = 0x0004;

// Builds one mouse INPUT struct as a raw 40-byte buffer for SendInput.
//
// x64 layout: type(4) + pad(4) + dx(4) + dy(4) + mouseData(4) + dwFlags(4)
//           + time(4) + pad(4) + dwExtraInfo(8) = 40 bytes.
// The two 4-byte pads are NOT optional/guessed — MOUSEINPUT's trailing
// ULONG_PTR field forces 8-byte alignment on the union inside INPUT, which
// pushes the union to start at offset 8 (not immediately after `type` at
// offset 4) and pads dwExtraInfo's start to offset 32. Verified against
// Microsoft's INPUT/MOUSEINPUT struct docs plus independent confirmation
// that sizeof(INPUT) is 40 on x64 — a naive flat 32-byte layout silently
// sends garbage to SendInput.
function buildMouseInput(dwFlags, dx = 0, dy = 0) {
  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(INPUT_MOUSE, 0);   // type
  buf.writeInt32LE(dx, 8);             // mi.dx
  buf.writeInt32LE(dy, 12);            // mi.dy
  buf.writeUInt32LE(0, 16);            // mi.mouseData
  buf.writeUInt32LE(dwFlags, 20);      // mi.dwFlags
  buf.writeUInt32LE(0, 24);            // mi.time (0 = let the system stamp it)
  buf.writeBigUInt64LE(0n, 32);        // mi.dwExtraInfo
  return buf;
}

// Mousedown and mouseup need a real gap between them, not back-to-back
// SendInput calls — confirmed live (clicks on NTE's main-menu buttons
// weren't registering at all despite landing on the correct coordinates)
// and matches documented behavior: many games poll input state per-frame
// and can miss a down+up pair that both land inside the same poll. 80ms is
// a reasonable "hold" duration — long enough to register, short enough not
// to read as a drag.
const CLICK_HOLD_MS = 80;

// Clicks wherever the cursor currently is, without moving it first — split
// out from clickAt so callers can insert their own delay between arriving
// at a target and actually clicking it (confirmed live: some NTE menu
// buttons need a real pause after the cursor lands before they're
// interactive at all, not just a pause between mousedown and mouseup).
function clickHere() {
  const { SendInput } = fns();
  SendInput(1, buildMouseInput(MOUSEEVENTF_LEFTDOWN), 40);
  return new Promise(resolve => setTimeout(() => {
    SendInput(1, buildMouseInput(MOUSEEVENTF_LEFTUP), 40);
    resolve();
  }, CLICK_HOLD_MS));
}

function clickAt(x, y) {
  moveMouseTo(x, y);
  return clickHere();
}

// ─── Keyboard input (focusWindow's Alt-tap trick, and arc navigation's ESC) ─

const INPUT_KEYBOARD  = 1;
const KEYEVENTF_KEYUP = 0x0002;
const VK_MENU         = 0x12; // Alt
const VK_ESCAPE       = 0x1b;

// Builds one keyboard INPUT struct as a raw 40-byte buffer for SendInput.
// Same 40-byte union size as buildMouseInput (the union is sized to its
// largest member, MOUSEINPUT, regardless of which variant is populated —
// verified via Microsoft's KEYBDINPUT docs), but different field offsets:
// wVk/wScan are WORDs (2 bytes each) rather than MOUSEINPUT's all-DWORD
// layout. x64 layout: type(4) + pad(4) + wVk(2) + wScan(2) + dwFlags(4)
// + time(4) + pad(4) + dwExtraInfo(8) = 40 bytes.
function buildKeyboardInput(vk, dwFlags) {
  const buf = Buffer.alloc(40);
  buf.writeUInt32LE(INPUT_KEYBOARD, 0); // type
  buf.writeUInt16LE(vk, 8);             // ki.wVk
  buf.writeUInt16LE(0, 10);             // ki.wScan
  buf.writeUInt32LE(dwFlags, 12);       // ki.dwFlags
  buf.writeUInt32LE(0, 16);             // ki.time
  buf.writeBigUInt64LE(0n, 24);         // ki.dwExtraInfo
  return buf;
}

// Sends a synthetic key press+release for any virtual-key code — used both
// by focusWindow's Alt-tap trick and by the arc-navigation sequence's ESC
// key (closing the character Records modal before navigating away).
function tapKey(vk) {
  const { SendInput } = fns();
  SendInput(1, buildKeyboardInput(vk, 0), 40);                // key down
  SendInput(1, buildKeyboardInput(vk, KEYEVENTF_KEYUP), 40);  // key up
}

function tapAltKey() {
  tapKey(VK_MENU);
}

// Physical mouse detection (WH_MOUSE_LL observer hook) no longer lives here.
// It doesn't reliably fire when installed from inside Electron's own
// process — Chromium wraps the classic Win32 message loop in its own
// MessagePumpForUI, and low-level hooks depend on the classic
// GetMessage/DispatchMessage dispatch mechanism specifically (matches a
// reported Electron issue with the identical symptom: the same hook type
// works when installed from a separate process, not from inside Electron).
// See mouseWatcherProcess.js (forked as a genuine separate Node process,
// bypassing Chromium's pump entirely) and mouseWatcher.js (the manager
// that spawns it and relays detections back).

// ─── Temp-file staging ──────────────────────────────────────────────────────
// Captured pull entries are written here as a run progresses. They are only
// ever promoted into the permanent record by the renderer once a run
// completes cleanly (see useNteCapture.js) — discarded on interrupt/error/
// cancel so a crash or ESC mid-run never leaves partial data mistaken for
// real history.

function stagingPath(dataDir) {
  return path.join(dataDir, 'capture-tmp.json');
}

function writeStaging(dataDir, entries) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(stagingPath(dataDir), JSON.stringify(entries, null, 2));
}

function readStaging(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(stagingPath(dataDir), 'utf-8'));
  } catch {
    return [];
  }
}

function discardStaging(dataDir) {
  try { fs.unlinkSync(stagingPath(dataDir)); } catch (_) {}
}

module.exports = {
  findNteWindow,
  getMonitorInfoForWindow,
  isWindowValid,
  focusWindow,
  isForegroundWindow,
  isSupportedAspectRatio,
  moveMouseTo,
  getCursorPos,
  clickAt,
  clickHere,
  tapKey,
  VK_ESCAPE,
  writeStaging,
  readStaging,
  discardStaging,
};
