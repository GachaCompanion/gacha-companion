// GitHub-precomputed PNG face-detection framing for HSR (see electron/framingSync.js)
// — loaded once during the loading screen and cached
// here, so HsrCard's first render already has the right position instead of showing
// the image centered and then popping to the correct spot once an IPC call resolves.

let _framing = null;

export async function loadHsrPngFraming() {
  if (_framing) return;
  try {
    _framing = (await window.api?.getAllPngFraming?.('hsr')) ?? {};
  } catch {
    _framing = {};
  }
}

// Synchronous — safe to call during render. Returns null if the cache hasn't
// loaded yet (offline, or somehow reached before the loading screen finished)
// or this character has no entry, in which case the caller's CSS default
// (50%/50%, geometric center) applies.
export function getHsrPngFraming(avatarId) {
  return _framing?.[String(avatarId)] ?? null;
}
