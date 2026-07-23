import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { computeZZZ, successChance, averagePulls } from './zzzSimulation';
import { resolveGameCurrency, resolveGameLabels } from '../../engine/gameSchema';
import './ZZZCalculator.css';

function buildCharTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 7 }, (_, i) => ({ label: `${letter}${i}`, copies: i + 1 }))];
}

function buildWeaponTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 5 }, (_, i) => ({ label: `${letter}${i + 1}`, copies: i + 1 }))];
}

export default function ZZZCalculator({ game, color }) {
  const gameColor = color;
  const costPerPull = game.charBanner?.costPerPull ?? 160;
  const { currencyName, pullItemName: tapesLabel } = resolveGameCurrency(game);
  const { charName, weaponName, charCopyLabel, weaponCopyLabel: weCopyLabel, charCopyLetter, weaponCopyLetter: weCopyLetter } = resolveGameLabels(game);
  const CHAR_TARGETS = buildCharTargets(charCopyLetter);
  const WE_TARGETS = buildWeaponTargets(weCopyLetter);

  const [polychrome, setPolychrome] = useState('');
  const [tapes, setTapes] = useState('');
  const [charPity, setCharPity] = useState('');
  const [charGuaranteed, setCharGuaranteed] = useState(false);
  const [wePity, setWEPity] = useState('');
  const [weGuaranteed, setWEGuaranteed] = useState(false);
  const [charTarget, setCharTarget] = useState(0);
  const [weTarget, setWETarget] = useState(0);
  const [result, setResult] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setPolychrome('');
    setTapes('');
    setCharPity('');
    setCharGuaranteed(false);
    setWEPity('');
    setWEGuaranteed(false);
    setCharTarget(0);
    setWETarget(0);
    setResult(null);
  }, [game.id]);

  const polyNum = parseInt(polychrome, 10) || 0;
  const tapesNum = parseInt(tapes, 10) || 0;
  const charPityNum = Math.min(89, parseInt(charPity, 10) || 0);
  const wePityNum = Math.min(79, parseInt(wePity, 10) || 0);
  const totalPulls = Math.floor(polyNum / costPerPull) + tapesNum;
  const canRun = charTarget > 0 || weTarget > 0;

  function clearResult() { setResult(null); }

  function calculate() {
    if (!canRun) return;
    const data = computeZZZ({
      charCopies: charTarget,
      weCopies: weTarget,
      startCharPity: charPityNum,
      startCharGuaranteed: charGuaranteed,
      startWEPity: wePityNum,
      startWEGuaranteed: weGuaranteed,
    });
    setResult(data);
  }

  const charRows = result
    ? result.charMilestones.map((m, i) => ({
        label: CHAR_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, totalPulls),
      }))
    : [];

  const weRows = result
    ? result.weMilestones.map((m, i) => ({
        label: WE_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, totalPulls),
      }))
    : [];

  return (
    <div className="zc">
      <div className="zc-panel">

        {/* ── Settings row: resources | divider | state columns ── */}
        <div className="zc-settings">

          <div className="zc-resources">
            <p className="section-title">Resources</p>
            <div className="zc-resource-fields">
              <ZcNumberField
                label={currencyName || 'Polychrome'}
                value={polychrome}
                onChange={v => { setPolychrome(v); clearResult(); }}
              />
              <ZcNumberField
                label={tapesLabel || 'Encrypted Master Tape'}
                value={tapes}
                onChange={v => { setTapes(v); clearResult(); }}
              />
            </div>
            <div className="zc-pull-count">
              <strong style={{ color: gameColor }}>{totalPulls.toLocaleString()}</strong>
              {' pulls available'}
            </div>
          </div>

          <div className="zc-vsep" />

          <div className="zc-state">

            <div className="zc-state-col">
              <p className="section-title">{charName}</p>
              <div className="zc-field">
                <span className="zc-field-label">Pity</span>
                <ZcNumberField
                  value={charPity}
                  onChange={v => { setCharPity(v); clearResult(); }}
                  max={89} compact
                />
              </div>
              <div className="zc-field">
                <span className="zc-field-label">Guaranteed</span>
                <div className="zc-seg">
                  <button
                    className={`zc-seg-btn ${!charGuaranteed ? 'zc-seg-btn--active' : ''}`}
                    style={!charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setCharGuaranteed(false); clearResult(); }}>✗</button>
                  <button
                    className={`zc-seg-btn ${charGuaranteed ? 'zc-seg-btn--active' : ''}`}
                    style={charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setCharGuaranteed(true); clearResult(); }}>✓</button>
                </div>
              </div>
            </div>

            <div className="zc-state-col">
              <p className="section-title">{weaponName}</p>
              <div className="zc-field">
                <span className="zc-field-label">Pity</span>
                <ZcNumberField
                  value={wePity}
                  onChange={v => { setWEPity(v); clearResult(); }}
                  max={79} compact
                />
              </div>
              <div className="zc-field">
                <span className="zc-field-label">Guaranteed</span>
                <div className="zc-seg">
                  <button
                    className={`zc-seg-btn ${!weGuaranteed ? 'zc-seg-btn--active' : ''}`}
                    style={!weGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setWEGuaranteed(false); clearResult(); }}>✗</button>
                  <button
                    className={`zc-seg-btn ${weGuaranteed ? 'zc-seg-btn--active' : ''}`}
                    style={weGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setWEGuaranteed(true); clearResult(); }}>✓</button>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Targets ── */}
        <div>
          <p className="section-title">Target</p>
          <div className="zc-targets-row">
            <ZcDropdown
              label={charCopyLabel}
              options={CHAR_TARGETS}
              value={charTarget}
              onChange={v => { setCharTarget(v); clearResult(); }}
              color={gameColor}
            />
            <ZcDropdown
              label={weCopyLabel}
              options={WE_TARGETS}
              value={weTarget}
              onChange={v => { setWETarget(v); clearResult(); }}
              color={gameColor}
            />
          </div>
        </div>

        {/* ── Calculate ── */}
        <button
          className="zc-run-btn"
          onClick={calculate}
          disabled={!canRun}
          style={{ background: gameColor }}
        >
          Calculate
        </button>
        {!canRun && (
          <p className="zc-run-hint">Select a target above to calculate.</p>
        )}

      </div>

      {/* ── Results ── */}
      <div className="zc-results-panel">
        {/* 1 — Fixed title row */}
        <div className="zc-results-header">
          <p className="section-title">Results</p>
          <button className="zc-info-btn" onClick={() => setInfoOpen(true)} title="About these results">
            <Info size={14} />
          </button>
        </div>

        {result && (charRows.length > 0 || weRows.length > 0) ? (<>
          {/* 2 — Fixed column headers */}
          <div className="zc-results-cols">
            <span className="zc-col-goal">Goal</span>
            <span className="zc-col-right">Avg pulls</span>
            <span className="zc-col-right">
              {totalPulls > 0 ? `Success (${totalPulls} pulls)` : 'Success chance'}
            </span>
          </div>

          {/* 3 — Scrollable milestone rows */}
          <div className="zc-results-scroll">
            {charRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
            {charRows.length > 0 && weRows.length > 0 && (
              <div className="zc-row-sep" />
            )}
            {weRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
          </div>

          {/* 4 — Fixed footer: combined target */}
          {(() => {
            const lastChar = charRows.length > 0 ? charRows[charRows.length - 1] : null;
            const lastWE = weRows.length > 0 ? weRows[weRows.length - 1] : null;
            const combined = lastChar && lastWE
              ? { label: lastChar.label + lastWE.label, avg: lastChar.avg + lastWE.avg, chance: lastChar.chance * lastWE.chance }
              : (lastChar ?? lastWE);
            return (
              <div className="zc-results-footer">
                <span className="zc-footer-label">Target</span>
                <ResultRow row={combined} color={gameColor} showChance={totalPulls > 0} isTarget />
              </div>
            );
          })()}
        </>) : (
          <div className="zc-results-placeholder">
            Select a target and calculate.
          </div>
        )}
      </div>

      {infoOpen && <ZZZInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function ZZZInfoModal({ onClose }) {
  const overlayRef = useRef(null);
  const [closing, setClosing] = useState(false);

  function close() { setClosing(true); }
  function handleAnimEnd() { if (closing) onClose(); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) close();
  }

  return (
    <div
      className={`zc-modal-overlay${closing ? ' zc-modal-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={handleOverlayClick}
      onAnimationEnd={handleAnimEnd}
    >
      <div className="zc-modal">
        <div className="zc-modal-header">
          <span className="zc-modal-title">About these results</span>
          <button className="zc-modal-close" onClick={close}>✕</button>
        </div>
        <p className="zc-modal-body">
          Results use exact probability math, not simulations — no sampling error.
          Standard 50/50 applies to characters and 75/25 applies to W-Engines,
          using the rates as officially advertised by HoYoverse.
        </p>
      </div>
    </div>
  );
}

function ZcDropdown({ label, options, value, onChange, color }) {
  return (
    <div className="zc-dropdown-col">
      <span className="zc-target-label">{label}</span>
      <select
        className="zc-select"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={value !== 0 ? { color, borderColor: color } : {}}
      >
        {options.map(opt => (
          <option key={opt.label} value={opt.copies}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

function ResultRow({ row, color, showChance, isTarget = false }) {
  const pct = (row.chance * 100).toFixed(1) + '%';
  return (
    <div className={`zc-result-row${isTarget ? ' zc-result-row--target' : ''}`}>
      <span className="zc-col-goal zc-col-goal--value" style={{ color }}>{row.label}</span>
      <span className="zc-col-right zc-col-num">{row.avg}</span>
      <span className="zc-col-right zc-col-chance" style={{ color: showChance ? color : 'var(--text-muted)' }}>
        {showChance ? pct : '—'}
      </span>
    </div>
  );
}

function ZcNumberField({ label, value, onChange, max, compact = false }) {
  return (
    <div className={`zc-numfield${compact ? ' zc-numfield--compact' : ''}`}>
      {label && <span className="zc-numfield-label">{label}</span>}
      <input
        className="zc-numfield-input"
        type="number"
        min={0}
        max={max}
        placeholder="0"
        value={value}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '' || raw === '-') { onChange(''); return; }
          const v = parseInt(raw, 10);
          if (!isNaN(v) && v >= 0) {
            onChange(max !== undefined ? String(Math.min(max, v)) : String(v));
          }
        }}
      />
    </div>
  );
}
