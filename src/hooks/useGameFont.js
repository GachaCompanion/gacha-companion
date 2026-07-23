// App-level hook for the per-game auto-detected font (see electron/Fonts.js for how the
// actual font file is found/served). Used anywhere a specific game's own real font should
// show instead of the app's default (Lato) — Showcase cards, Gacha Tracker screens once a
// game is connected, etc. Every caller for the same gameId shares one underlying load.
//
// preloadGameFont() is also called directly (no hook) by the boot-time loading pipeline
// (see shell/loading/taskDefs.js's "game_fonts" task) so all 3 games' fonts are already
// resolved by the time Showcase/Tracker ever mount — useGameFont's lazy useState initializer
// below reads that already-settled result synchronously, so the very first render already
// has the right font with no default-then-swap flash.
import { useState, useEffect } from 'react';

const isElectron = typeof window !== 'undefined' && !!window.api;

let _portPromise = null;
function getFontsServerPort() {
  if (!_portPromise) _portPromise = window.api.getFontsServerPort();
  return _portPromise;
}

// gameId -> Promise<string|null> — resolved CSS font-family name, or null if that game
// isn't installed / its font couldn't be found. Cached for the life of the renderer.
const _fontFamilyCache = {};

// gameId -> string|null, populated the moment the above promise settles — lets a fresh
// component read an already-known result synchronously instead of waiting a render+effect.
const _resolvedSync = {};

export function loadGameFont(gameId) {
  if (_fontFamilyCache[gameId]) return _fontFamilyCache[gameId];

  _fontFamilyCache[gameId] = (async () => {
    if (!isElectron) return null;
    try {
      const port = await getFontsServerPort();
      const family = `GameFont_${gameId}`;
      const face = new FontFace(family, `url(http://127.0.0.1:${port}/${gameId}.ttf)`, { weight: '700' });
      await face.load(); // rejects on 404 (game not installed) or any load error
      document.fonts.add(face);
      return family;
    } catch {
      return null;
    }
  })();

  _fontFamilyCache[gameId].then(family => { _resolvedSync[gameId] = family; });
  return _fontFamilyCache[gameId];
}

// Returns the resolved font-family string once ready, or null while loading / if that
// game's font isn't available (caller should fall back to the app default in that case,
// e.g. by only applying a style override when this is non-null).
export function useGameFont(gameId) {
  const [fontFamily, setFontFamily] = useState(() => _resolvedSync[gameId] ?? null);

  useEffect(() => {
    let cancelled = false;
    if (!gameId) return;
    loadGameFont(gameId).then(family => { if (!cancelled) setFontFamily(family); });
    return () => { cancelled = true; };
  }, [gameId]);

  return fontFamily;
}
