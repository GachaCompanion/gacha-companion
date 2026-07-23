// Standalone script — always run as a separate forked process (see
// mouseWatcher.js), never required directly into electron/main.js.
//
// Installs a WH_MOUSE_LL observer hook (never blocks anything, just detects
// real physical mouse input — see the flag check below) and runs a manual
// Win32 message pump. Both pieces have to live outside Electron's own
// process: a low-level hook's callback is delivered via the classic
// GetMessage/DispatchMessage dispatch mechanism on the installing thread,
// and Chromium wraps that in its own MessagePumpForUI rather than using it
// directly — a documented cause of the exact "hook installs with no error
// but its callback never fires" symptom when done from inside Electron.
// Forked via child_process.fork(), which Electron auto-runs as plain Node
// (ELECTRON_RUN_AS_NODE=1) — no Chromium involved in this process at all.
//
// Single mode: reports every non-injected mouse event during an actual
// capture run, so the caller can abort on physical interference. Used to
// also support a 'click' mode for calibration (watching for a right-click
// anywhere on screen) — removed once confirmed live that NTE's own window
// never passes a right-click through the hook chain to this process at all
// (consistent with the game installing its own input hook ahead of others,
// a common basic anti-macro measure). Calibration now catches the click on
// the app's own overlay window instead — see overlay.js/overlay-glow.html.

const koffi = require('koffi');

const user32   = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const SetWindowsHookExW   = user32.func('intptr __stdcall SetWindowsHookExW(int idHook, intptr lpfn, intptr hmod, uint32 dwThreadId)');
const CallNextHookEx      = user32.func('intptr __stdcall CallNextHookEx(intptr hhk, int nCode, uintptr wParam, void* lParam)');
const GetMessageW         = user32.func('int __stdcall GetMessageW(void* lpMsg, intptr hWnd, uint32 wMsgFilterMin, uint32 wMsgFilterMax)');
const TranslateMessage    = user32.func('bool __stdcall TranslateMessage(const void* lpMsg)');
const DispatchMessageW    = user32.func('intptr __stdcall DispatchMessageW(const void* lpMsg)');
const GetModuleHandleW    = kernel32.func('intptr __stdcall GetModuleHandleW(str16 lpModuleName)');
const GetLastError        = kernel32.func('uint32 __stdcall GetLastError()');

const WH_MOUSE_LL    = 14;
const LLMHF_INJECTED = 0x00000001;

const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt:          POINT,
  mouseData:   'uint32',
  flags:       'uint32',
  time:        'uint32',
  dwExtraInfo: 'uint64',
});

const HookProcType = koffi.proto('intptr __stdcall HookProc(int nCode, uintptr wParam, void* lParam)');

let hookHandle = null;

const hookCallback = koffi.register((nCode, wParam, lParam) => {
  if (nCode >= 0) {
    const info = koffi.decode(lParam, MSLLHOOKSTRUCT);
    const injected = !!(info.flags & LLMHF_INJECTED);
    if (!injected) process.send?.('mouse-moved');
  }
  return CallNextHookEx(hookHandle ?? 0, nCode, wParam, lParam); // always pass through — never blocks
}, koffi.pointer(HookProcType));

const hInstance = GetModuleHandleW(null);
hookHandle = SetWindowsHookExW(WH_MOUSE_LL, koffi.address(hookCallback), hInstance, 0);

if (!hookHandle) {
  process.send?.(`hook-failed:${GetLastError()}`);
  process.exit(1);
}

process.send?.('ready');

// Manual message pump — required for the hook callback above to ever fire.
// GetMessageW blocks until the next message; this loop's only job is to
// keep calling it for as long as this process lives (killed externally by
// mouseWatcher.js when the capture run ends — Windows cleans up the hook
// automatically on process exit, so no unhook call is needed here).
// MSG is small (~48 bytes on x64); 64 is a safe oversized allocation since
// we never read its fields ourselves, just pass the buffer through.
const msgBuf = Buffer.alloc(64);
while (true) {
  const ret = GetMessageW(msgBuf, 0, 0, 0);
  if (ret === 0 || ret === -1) break; // WM_QUIT or error
  TranslateMessage(msgBuf);
  DispatchMessageW(msgBuf);
}
