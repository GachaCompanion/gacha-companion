import React, { useEffect, useState } from 'react';
import { Crosshair, XCircle, CheckCircle2 } from 'lucide-react';

// The fixed set of UI elements the arc-side navigation sequence needs a
// screen position for. `nextButton` is shared between the character and
// arc record tables — their pagination buttons sit close enough together
// that one calibrated point works for both (confirmed against real
// screenshots of both tables).
const CALIBRATION_POINTS = [
  { id: 'characterBoardDetailsButton', label: 'Character: Board Details Button (from pull screen, press F3 first)' },
  { id: 'characterDiceRollRecordsTab', label: 'Character: Dice Roll Records Tab' },
  { id: 'characterRecordsCloseButton', label: 'Character: X button to close Records/Board Details (replaces ESC)' },
  { id: 'limitedBannerIcon', label: 'Limited Banner Icon (selects Limited as its own banner, from the pull screen)' },
  { id: 'standardBannerIcon', label: 'Standard Banner Icon (selects Standard as its own banner, from the pull screen)' },
  { id: 'arcMenuButton', label: 'Arc: Menu Button' },
  { id: 'arcBannerIcon', label: 'Arc: Banner Icon' },
  { id: 'arcHistoryButton', label: 'Arc: History Button' },
  { id: 'arcRecordsTab', label: 'Arc: Records Tab' },
  { id: 'arcRecordsCloseButton', label: 'Arc: X button to close Records Tab (1st of 3 back-out clicks, replaces ESC)' },
  { id: 'arcHistoryCloseButton', label: 'Arc: X button to close History (2nd of 3 back-out clicks, replaces ESC)' },
  { id: 'arcMenuCloseButton', label: 'Arc: X button to close Menu, back to pull screen (3rd of 3 back-out clicks, replaces ESC)' },
  { id: 'nextButton', label: 'Next Page Button (shared)' },
];

// Per-point calibration: click Calibrate next to a target, right-click the
// spot in-game, the resulting window-relative fraction (0-1 on both axes —
// portable across resolutions) is stored under that point's id via
// onCaptured. Values are persisted by the caller (App.js settings).
export default function NteCalibrateButton({ values = {}, onCaptured }) {
  const [activeId, setActiveId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | waiting | error | interrupted
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsub = window.api?.onNteCalibrateStatus(({ pointId, status: s, x, y, error: err }) => {
      if (pointId !== activeId) return;
      setStatus(s);
      if (s === 'captured') {
        onCaptured?.(pointId, { x, y });
        setActiveId(null);
        setStatus('idle');
      }
      if (s === 'error' || s === 'interrupted') setError(err);
    });
    return unsub;
  }, [activeId]); // eslint-disable-line

  function handleClick(pointId) {
    if (activeId === pointId) {
      window.api?.nteCancelCalibrate();
      setActiveId(null);
      setStatus('idle');
      return;
    }
    if (activeId) return; // one calibration at a time
    setError(null);
    setActiveId(pointId);
    setStatus('waiting');
    window.api?.nteStartCalibrate(pointId);
  }

  return (
    <div className="gs-field">
      <label
        className="gs-field-label"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setExpanded(v => !v)}
      >
        Calibrate
        <span style={{ fontSize: 10, lineHeight: 1 }}>{expanded ? '▼' : '▲'}</span>
      </label>
      {expanded && (
        <>
          <p className="gs-field-hint">
            Brings NTE to the foreground, then right-click the spot in-game you want to record.
          </p>
          <div className="gs-import-btns" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            {CALIBRATION_POINTS.map(({ id, label }) => {
              const isActive = activeId === id;
              const isCaptured = !!values[id];
              return (
                <button
                  key={id}
                  className={`gs-import-btn ${isActive ? 'gs-import-btn--cancel' : 'gs-import-btn--sync'}`}
                  onClick={() => handleClick(id)}
                  disabled={!isActive && !!activeId}
                >
                  {isActive
                    ? <><XCircle size={14} /> Waiting for right-click... (click to cancel)</>
                    : isCaptured
                      ? <><CheckCircle2 size={14} /> {label} — x={values[id].x.toFixed(4)}, y={values[id].y.toFixed(4)}</>
                      : <><Crosshair size={14} /> {label}</>
                  }
                </button>
              );
            })}
          </div>
        </>
      )}
      {status === 'error' && error && <p className="field-error">{error}</p>}
      {status === 'interrupted' && error && <p className="field-error">{error}</p>}
    </div>
  );
}
