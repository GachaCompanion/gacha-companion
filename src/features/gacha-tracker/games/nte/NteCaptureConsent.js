import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import '../../../../shared/components/Modal.css';
import './NteCaptureConsent.css';

// Consent gate before a capture run takes control of the mouse. The
// GATE_SECONDS countdown (Start disabled for a few seconds) was removed at
// the user's explicit request for faster testing iteration — the game
// window's presence is still checked live (not trusted from a stale prop)
// before allowing a run.
export default function NteCaptureConsent({ onStart, onCancel }) {
  const [isClosing, setIsClosing] = useState(false);
  const [windowStatus, setWindowStatus] = useState('checking'); // checking | found | not-found | bad-aspect-ratio
  const pendingAction = useRef(null);

  useEffect(() => {
    let cancelled = false;
    window.api?.nteFindCaptureWindow().then(result => {
      if (cancelled) return;
      if (!result?.found) setWindowStatus('not-found');
      else if (!result.aspectRatioOk) setWindowStatus('bad-aspect-ratio');
      else setWindowStatus('found');
    });
    return () => { cancelled = true; };
  }, []);

  function handleAction(cb) {
    pendingAction.current = cb;
    setIsClosing(true);
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleAction(onCancel); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]); // eslint-disable-line

  const gated = windowStatus !== 'found';
  const startLabel = windowStatus === 'not-found'
    ? 'Game not found'
    : windowStatus === 'bad-aspect-ratio'
      ? 'Unsupported window shape'
      : windowStatus === 'checking'
        ? 'Checking...'
        : 'Start Capture';

  return (
    <motion.div
      className="modal-overlay confirm-overlay modal-overlay--motion"
      initial={{ opacity: 0 }}
      animate={{ opacity: isClosing ? 0 : 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (isClosing && pendingAction.current) pendingAction.current();
      }}
    >
      <motion.div
        className="modal confirm-modal nte-consent-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">Start NTE Capture?</h2>
        </div>
        <div className="modal-body">
          <p className="confirm-message">
            This will take control of your mouse for a few seconds to read your
            gacha history directly from the game window. Your physical mouse
            isn't locked — keep your hands off it, or the run aborts automatically
            the moment it detects movement that wasn't its own.
          </p>
          <div className="nte-consent-warning">
            <AlertTriangle size={15} />
            <span>Press <strong>Esc</strong> at any time to interrupt it immediately.</span>
          </div>
          <p className="confirm-message nte-consent-note">
            Captured data is held in a temporary file and is only added to your
            permanent history if the run finishes without being interrupted.
          </p>
          {windowStatus === 'not-found' && (
            <p className="field-error">NTE isn't running — start the game first.</p>
          )}
          {windowStatus === 'bad-aspect-ratio' && (
            <p className="field-error">NTE window has an unsupported aspect ratio (expected 16:9 or 16:10).</p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => handleAction(onCancel)}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            disabled={gated}
            onClick={() => handleAction(onStart)}
          >
            {startLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
