import React, { useEffect, useRef } from 'react';
import { useLive2d } from './useLive2d';
import * as engine from './spineEngine';

// Thin React wrapper around the persistent spineEngine: it ensures the character
// is loaded (cached for API-fetched chars), adopts the shared canvas into this
// card's host element, and tears down on unmount. All the heavy WebGL state
// lives in the engine and survives across character switches / PNG toggles.
//
// cacheable: true for API-fetched characters (kept in the engine's LRU),
// false for saved builds (loaded on view, disposed on leave).
export default function SpineViewer({ game, characterId, className, cacheable = true, cameraConfig }) {
  const { status, baseUrl, skeletons, framing } = useLive2d(game, characterId);
  const hostRef = useRef(null);

  useEffect(() => {
    if (status !== 'ready' || !skeletons.length || !hostRef.current) return;
    const host = hostRef.current;
    const key = `${game}:${characterId}`;
    let cancelled = false;
    let acquired = null;

    (async () => {
      try {
        const entry = await engine.acquire({ key, cacheable, baseUrl, skeletons, framing });
        if (cancelled) { engine.detach(entry, cacheable); return; }
        acquired = entry;
        engine.activate(entry, host, className, cameraConfig);
      } catch (e) {
        console.error('[SpineViewer] load failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      if (acquired) engine.detach(acquired, cacheable);
    };
  }, [status, baseUrl, skeletons, framing, className, cacheable, game, characterId]);

  if (status !== 'ready') return null;
  return <div ref={hostRef} className="hsr-card__live2d-host" />;
}
