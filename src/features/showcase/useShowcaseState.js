// Persistence strategy: useStorage (same bridge as the rest of the app).
// Showcase data lives at data.showcase in the shared user.json.
// savedBuilds stores individual character builds (not full showcases).

import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchEnkaByGame, ShowcaseError } from './engine/showcaseApi';
import { normalizeGenshinShowcase, genshinPlayerInfo } from './games/genshin/genshinFetch';
import { normalizeHsrShowcase, hsrPlayerInfo } from './games/hsr/hsrFetch';
import { normalizeZzzShowcase, zzzPlayerInfo } from './games/zzz/zzzFetch';
import { getActiveProfileId, scopedKey } from '../../shared/utils/profileStorage';

function uuid() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// data/save/ready are passed in from App.js's single top-level useStorage()
// call (shared with the tracker) rather than this hook owning its own
// independent instance. storage:write in main.js does a full raw overwrite
// of user.json, not a merge — two independent useStorage() copies of the
// same file can each hold a stale in-memory snapshot, and whichever one
// saves last (for ANY reason, not necessarily a showcase edit) silently
// wipes out whatever the other one had written, including savedBuilds.
export function useShowcaseState({ data, save, ready }) {
  const [fetchStatus, setFetchStatus] = useState('idle');
  const [fetchError,  setFetchError]  = useState(null);
  const [liveResult,  setLiveResult]  = useState(null); // { playerInfo, builds, uid, game }

  const savedBuilds = data.showcase?.savedBuilds ?? [];

  // HSR card portrait mode: 'png' | 'live2d' (default Live2D). Persisted in
  // localStorage, NOT the main user.json save — that save re-processes all games,
  // writes the whole file and re-renders every storage consumer, which made the
  // toggle lag. localStorage is synchronous, tiny and local to this state —
  // scoped per-profile (shared/utils/profileStorage.js) since localStorage
  // itself is shared across every profile, unlike storage/profiles/<uuid>/.
  const cardModeKeyRef      = useRef(null);
  const cardDimensionKeyRef = useRef(null);
  const [cardMode,      setCardModeState]      = useState('live2d');
  const [cardDimension, setCardDimensionState] = useState('3d');

  useEffect(() => {
    let cancelled = false;
    getActiveProfileId().then(profileId => {
      if (cancelled) return;
      const modeKey = scopedKey('hsrCardMode', profileId);
      const dimKey  = scopedKey('hsrCardDimension', profileId);
      cardModeKeyRef.current = modeKey;
      cardDimensionKeyRef.current = dimKey;
      try { setCardModeState(localStorage.getItem(modeKey) || 'live2d'); } catch { /* ignore */ }
      try { setCardDimensionState(localStorage.getItem(dimKey) || '3d'); } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, []);

  const setCardMode = useCallback((mode) => {
    setCardModeState(mode);
    if (!cardModeKeyRef.current) return;
    try { localStorage.setItem(cardModeKeyRef.current, mode); } catch { /* ignore */ }
  }, []);

  const setCardDimension = useCallback((dim) => {
    setCardDimensionState(dim);
    if (!cardDimensionKeyRef.current) return;
    try { localStorage.setItem(cardDimensionKeyRef.current, dim); } catch { /* ignore */ }
  }, []);

  // ── Fetch a UID live from enka ──────────────────────────────────────────────

  const fetchShowcase = useCallback(async (uid, game = 'genshin') => {
    const trimmed = uid.trim();
    if (!trimmed) {
      setFetchError('Please enter a UID.');
      setFetchStatus('error');
      return;
    }

    setFetchStatus('loading');
    setFetchError(null);
    setLiveResult(null);

    try {
      const raw = await fetchEnkaByGame(trimmed, game);
      let playerInfo, builds;

      if (game === 'hsr') {
        playerInfo = hsrPlayerInfo(raw);
        builds     = await normalizeHsrShowcase(raw);
      } else if (game === 'zzz') {
        playerInfo = zzzPlayerInfo(raw);
        builds     = await normalizeZzzShowcase(raw);
      } else {
        playerInfo = genshinPlayerInfo(raw);
        builds     = await normalizeGenshinShowcase(raw);
      }

      if (builds.length === 0) {
        setFetchError("This player's showcase is empty or disabled.");
        setFetchStatus('error');
        return;
      }

      setLiveResult({ uid: trimmed, game, playerInfo, builds });
      setFetchStatus('success');
    } catch (err) {
      setFetchError(err instanceof ShowcaseError ? err.message : 'Something went wrong.');
      setFetchStatus('error');
    }
  }, []);

  // ── Save a single character build ───────────────────────────────────────────

  const saveBuild = useCallback((name, build) => {
    const entry = {
      id:      uuid(),
      name:    name.trim() || build.name,
      savedAt: Date.now(),
      build,
    };
    const prev = data.showcase?.savedBuilds ?? [];
    save({ ...data, showcase: { ...data.showcase, savedBuilds: [entry, ...prev] } });
  }, [data, save]);

  // ── Delete a saved build ────────────────────────────────────────────────────

  const deleteBuild = useCallback((id) => {
    const prev = data.showcase?.savedBuilds ?? [];
    save({ ...data, showcase: { ...data.showcase, savedBuilds: prev.filter(b => b.id !== id) } });
  }, [data, save]);

  // ── Rename a saved build ────────────────────────────────────────────────────

  const renameBuild = useCallback((id, newName) => {
    const prev = data.showcase?.savedBuilds ?? [];
    save({
      ...data,
      showcase: {
        ...data.showcase,
        savedBuilds: prev.map(b => b.id === id ? { ...b, name: newName.trim() || b.name } : b),
      },
    });
  }, [data, save]);

  // ── Reorder saved builds ────────────────────────────────────────────────────

  const reorderBuilds = useCallback((activeId, overId) => {
    const prev = data.showcase?.savedBuilds ?? [];
    const oldIdx = prev.findIndex(b => b.id === activeId);
    const newIdx = prev.findIndex(b => b.id === overId);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = [...prev];
    const [item] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, item);
    save({ ...data, showcase: { ...data.showcase, savedBuilds: next } });
  }, [data, save]);

  // ── Clear live result ───────────────────────────────────────────────────────

  const clearLive = useCallback(() => {
    setLiveResult(null);
    setFetchStatus('idle');
    setFetchError(null);
  }, []);

  return {
    ready,
    savedBuilds,
    cardMode,
    setCardMode,
    cardDimension,
    setCardDimension,
    fetchStatus,
    fetchError,
    liveResult,
    fetchShowcase,
    saveBuild,
    deleteBuild,
    renameBuild,
    reorderBuilds,
    clearLive,
  };
}
