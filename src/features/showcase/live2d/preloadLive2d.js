// Warm the spineEngine cache for a set of characters so the first view of each
// is instant (no per-switch load hitch). Used after a UID search to front-load
// the whole fetched set behind a loading state.

import * as engine from './spineEngine';

const keyOf = (game, id) => `${game}:${id}`;

// True if any of the given characters still needs loading (so the caller can
// decide whether to show a loading state at all).
export function needsPreload(game, ids) {
  return ids.some((id) => !engine.has(keyOf(game, id)));
}

// Load every character into the engine cache. Resolves when all are done;
// individual failures are swallowed so one bad character can't block the rest.
export async function preloadLive2d(game, ids) {
  if (!window.api?.ensureLive2d) return;
  const port = await window.api.getLive2dServerPort();
  await Promise.all(ids.map(async (id) => {
    const key = keyOf(game, id);
    if (engine.has(key)) return;
    try {
      const res = await window.api.ensureLive2d(game, id);
      if (!res?.ok) return;
      const baseUrl = `http://127.0.0.1:${port}/${res.relPath}/`;
      await engine.acquire({ key, cacheable: true, baseUrl, skeletons: res.skeletons, framing: res.framing });
    } catch { /* ignore individual failures */ }
  }));
}
