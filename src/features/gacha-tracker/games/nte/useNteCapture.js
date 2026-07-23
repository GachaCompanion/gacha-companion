import React, { useState, useCallback, useEffect, useRef } from 'react';
import NteCaptureConsent from './NteCaptureConsent';

// Drives the NTE gacha-history capture mechanism: consent gate -> main-process
// mouse automation -> renderer-owned promotion of the staged result into the
// permanent pullLog. See electron/main.js's 'nte:capture:*' handlers and
// electron/engine/nte/capture.js for the Win32 FFI side that actually moves
// the mouse and stages results to a temp file during the run.
//
// nteOverlayEnabled is the persistent app setting (App.js DEFAULT_SETTINGS)
// — passed in rather than read here so this hook doesn't need to know about
// the settings object's shape.
export function useNteCapture({ handleUpdateGame, nteOverlayEnabled, nteCalibration }) {
  const [showConsent, setShowConsent]     = useState(false);
  const [captureStatus, setCaptureStatus] = useState('idle'); // idle | running | interrupted | error | completed
  const [captureError, setCaptureError]   = useState(null);
  const pendingGameRef = useRef(null);

  useEffect(() => {
    const unsub = window.api?.onNteCaptureStatus(({ status, error, entries }) => {
      setCaptureStatus(status);
      // 'interrupted' carries a reason too (e.g. physical mouse movement
      // detected vs. a plain ESC/cancel) — not just 'error'.
      if (status === 'error' || status === 'interrupted') setCaptureError(error ?? null);

      if (status === 'completed') {
        const game = pendingGameRef.current;
        // This is the promotion step: staged entries only ever become part of
        // the permanent pullLog here, after the main process has already
        // confirmed the run finished cleanly and deleted its own temp copy.
        if (game && entries?.length) {
          handleUpdateGame({
            ...game,
            state: {
              ...game.state,
              pullLog: [...(game.state.pullLog ?? []), ...entries],
              lastSynced: new Date().toISOString(),
            },
          });
        }
      }
      if (status === 'completed' || status === 'interrupted' || status === 'error') {
        pendingGameRef.current = null;
      }
    });
    return unsub;
  }, [handleUpdateGame]);

  // Opens the consent gate for the given game — does not start capture yet.
  const requestCapture = useCallback((game) => {
    pendingGameRef.current = game;
    setCaptureError(null);
    setShowConsent(true);
  }, []);

  const cancelConsent = useCallback(() => {
    setShowConsent(false);
    pendingGameRef.current = null;
  }, []);

  const confirmCapture = useCallback(() => {
    setShowConsent(false);
    window.api?.nteStartCapture(pendingGameRef.current?.uid, nteOverlayEnabled, nteCalibration);
  }, [nteOverlayEnabled, nteCalibration]);

  // Manual cancel from UI — ESC does the same thing globally while a run is active.
  const cancelRunningCapture = useCallback(() => {
    window.api?.nteCancelCapture();
  }, []);

  const consentModal = showConsent
    ? <NteCaptureConsent onStart={confirmCapture} onCancel={cancelConsent} />
    : null;

  return {
    requestCapture,
    cancelRunningCapture,
    captureStatus,
    captureError,
    consentModal,
  };
}
