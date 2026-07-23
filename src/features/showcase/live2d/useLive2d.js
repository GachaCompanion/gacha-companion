import { useEffect, useState } from 'react';

// Ensures a character's Live2D (Spine) assets are cached in the main process,
// then resolves the local-server base URL + skeleton file list for SpineViewer.
// Game-agnostic: pass game ('hsr' | 'zzz') and the character id.
//
// Returns { status, baseUrl, skeletons, framing }:
//   status  'loading' | 'ready' | 'none' (no Live2D for this character) | 'error'
//   framing { cx, cy, max, head } head-anchor camera framing, or null
export function useLive2d(game, characterId) {
  const [state, setState] = useState({ status: 'loading', baseUrl: null, skeletons: [], framing: null });

  useEffect(() => {
    let cancelled = false;
    if (!window.api?.ensureLive2d || !game || !characterId) {
      setState({ status: 'none', baseUrl: null, skeletons: [], framing: null });
      return;
    }
    setState({ status: 'loading', baseUrl: null, skeletons: [], framing: null });

    (async () => {
      try {
        const [res, port] = await Promise.all([
          window.api.ensureLive2d(game, characterId),
          window.api.getLive2dServerPort(),
        ]);
        if (cancelled) return;
        if (!res?.ok) {
          setState({ status: res?.reason === 'none' ? 'none' : 'error', baseUrl: null, skeletons: [], framing: null });
          return;
        }
        setState({
          status: 'ready',
          baseUrl: `http://127.0.0.1:${port}/${res.relPath}/`,
          skeletons: res.skeletons,
          framing: res.framing ?? null,
        });
      } catch {
        if (!cancelled) setState({ status: 'error', baseUrl: null, skeletons: [], framing: null });
      }
    })();

    return () => { cancelled = true; };
  }, [game, characterId]);

  return state;
}
