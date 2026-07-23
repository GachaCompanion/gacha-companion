import { useEffect, useRef } from 'react';
import { useNteCapture } from './useNteCapture';

// Adapts useNteCapture's own status (idle/running/interrupted/error/completed)
// into the shared syncState shape ({running, gameId, statusType, statusText})
// that useSyncRouter/GameSettingsModal already use for genshin/hsr/zzz — so
// NTE's Pull History section reuses the exact same status box/button styling
// instead of a bespoke display, and useSyncRouter can dispatch to it exactly
// like the other three games' sync hooks.
export function useNteSync({ setSyncState, handleUpdateGame, nteOverlayEnabled, nteCalibration }) {
  const nte = useNteCapture({ handleUpdateGame, nteOverlayEnabled, nteCalibration });
  const currentGameIdRef = useRef(null);

  useEffect(() => {
    const gameId = currentGameIdRef.current;
    if (!gameId) return;

    switch (nte.captureStatus) {
      case 'running':
        setSyncState({
          running: true, gameId, statusType: 'loading',
          statusText: "Capturing — don't touch your mouse (this aborts automatically if it detects movement)...",
        });
        break;
      case 'completed':
        setSyncState({ running: false, gameId, statusType: 'success', statusText: 'Capture complete.' });
        currentGameIdRef.current = null;
        break;
      case 'interrupted':
        setSyncState({
          running: false, gameId, statusType: 'error',
          statusText: nte.captureError ?? 'Capture interrupted — nothing was saved.',
        });
        currentGameIdRef.current = null;
        break;
      case 'error':
        setSyncState({
          running: false, gameId, statusType: 'error',
          statusText: nte.captureError ?? 'Capture failed.',
        });
        currentGameIdRef.current = null;
        break;
      default:
        break;
    }
  }, [nte.captureStatus, nte.captureError]); // eslint-disable-line

  function handleStartNteSync(game) {
    currentGameIdRef.current = game.id;
    nte.requestCapture(game);
  }

  return {
    handleStartNteSync,
    cancelNteCapture: nte.cancelRunningCapture,
    nteConsentModal: nte.consentModal,
  };
}
