import { useState, useRef } from 'react';
import { useGenshinSync } from './games/genshin/useGenshinSync';
import { useHsrSync } from './games/hsr/useHsrSync';
import { useZzzSync } from './games/zzz/useZzzSync';
import { useNteSync } from './games/nte/useNteSync';
import { useWuwaSync } from './games/wuwa/useWuwaSync';

export function useSyncRouter({ handleUpdateGame, bannerDataRef, nteOverlayEnabled, nteCalibration, gamesRef }) {
  const [syncState, setSyncState] = useState({
    running: false, gameId: null, statusType: null, statusText: null,
  });
  const syncCancelRef = useRef(false);
  // NTE's capture runs in the main process (mouse automation), not a
  // cancellable promise chain here — cancelling it needs an actual IPC
  // message, not just resetting local state, or the mouse keeps moving for
  // the rest of the run while the UI already looks idle.
  const activeIsNteRef = useRef(false);
  // Genshin/HSR/ZZZ funnel through the shared gacha:fetchWishHistory IPC
  // handler, which loops through up to 250 pages internally in ONE call
  // before ever returning — syncCancelRef alone was only checked BETWEEN
  // separate fetchWishHistory calls (whole banner categories), so Cancel did
  // nothing until the in-flight category finished. Each sync hook generates
  // a fresh id per sync and stores it here; Cancel sends it to the main
  // process so the page loop itself can stop early — see gacha:cancelFetch.
  const activeRequestIdRef = useRef(null);

  const deps = { setSyncState, syncCancelRef, handleUpdateGame, bannerDataRef, gamesRef, activeRequestIdRef };

  const { handleStartGenshinSync } = useGenshinSync(deps);
  const { handleStartHsrSync }     = useHsrSync(deps);
  const { handleStartZzzSync }     = useZzzSync(deps);
  const { handleStartWuwaSync }    = useWuwaSync(deps);
  const { handleStartNteSync, cancelNteCapture, nteConsentModal } =
    useNteSync({ setSyncState, handleUpdateGame, nteOverlayEnabled, nteCalibration });

  function handleStartSync(game) {
    if (syncState.running) return;
    activeIsNteRef.current = game.linkedDatabase === 'nte';
    if (game.linkedDatabase === 'hsr') {
      handleStartHsrSync(game);
    } else if (game.linkedDatabase === 'zzz') {
      handleStartZzzSync(game);
    } else if (game.linkedDatabase === 'nte') {
      handleStartNteSync(game);
    } else if (game.linkedDatabase === 'wuwa') {
      handleStartWuwaSync(game);
    } else {
      handleStartGenshinSync(game);
    }
  }

  function handleCancelSync() {
    if (activeIsNteRef.current) {
      cancelNteCapture();
      return;
    }
    syncCancelRef.current = true;
    if (activeRequestIdRef.current) {
      window.api.cancelFetch(activeRequestIdRef.current);
    }
    setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
  }

  function formatSyncTime(isoStr) {
    const d = new Date(isoStr);
    const dd   = String(d.getDate()).padStart(2, '0');
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}, ${hh}:${min}`;
  }

  return { syncState, handleStartSync, handleCancelSync, formatSyncTime, nteConsentModal };
}
