import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { computeHSR, successChance, averagePulls } from './hsrSimulation';
import { resolveGameCurrency, resolveGameLabels } from '../../engine/gameSchema';
import './HSRCalculator.css';

function buildCharTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 7 }, (_, i) => ({ label: `${letter}${i}`, copies: i + 1 }))];
}

function buildWeaponTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 5 }, (_, i) => ({ label: `${letter}${i + 1}`, copies: i + 1 }))];
}

export default function HSRCalculator({ game, color }) {
  const gameColor = color;
  const costPerPull = game.charBanner?.costPerPull ?? 160;
  const { currencyName, pullItemName: passesLabel } = resolveGameCurrency(game);
  const { charName, weaponName, charCopyLabel, weaponCopyLabel: lcCopyLabel, charCopyLetter, weaponCopyLetter: lcCopyLetter } = resolveGameLabels(game);
  const CHAR_TARGETS = buildCharTargets(charCopyLetter);
  const LC_TARGETS = buildWeaponTargets(lcCopyLetter);

  const [stellarJade, setStellarJade] = useState('');
  const [passes, setPasses] = useState('');
  const [charPity, setCharPity] = useState('');
  const [charGuaranteed, setCharGuaranteed] = useState(false);
  const [lcPity, setLCPity] = useState('');
  const [lcGuaranteed, setLCGuaranteed] = useState(false);
  const [charTarget, setCharTarget] = useState(0);
  const [lcTarget, setLCTarget] = useState(0);
  const [result, setResult] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setStellarJade('');
    setPasses('');
    setCharPity('');
    setCharGuaranteed(false);
    setLCPity('');
    setLCGuaranteed(false);
    setCharTarget(0);
    setLCTarget(0);
    setResult(null);
  }, [game.id]);

  const jadeNum = parseInt(stellarJade, 10) || 0;
  const passesNum = parseInt(passes, 10) || 0;
  const charPityNum = Math.min(89, parseInt(charPity, 10) || 0);
  const lcPityNum = Math.min(79, parseInt(lcPity, 10) || 0);
  const totalPulls = Math.floor(jadeNum / costPerPull) + passesNum;
  const canRun = charTarget > 0 || lcTarget > 0;

  function clearResult() { setResult(null); }

  function calculate() {
    if (!canRun) return;
    const data = computeHSR({
      charCopies: charTarget,
      lcCopies: lcTarget,
      startCharPity: charPityNum,
      startCharGuaranteed: charGuaranteed,
      startLCPity: lcPityNum,
      startLCGuaranteed: lcGuaranteed,
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

  const lcRows = result
    ? result.lcMilestones.map((m, i) => ({
        label: LC_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, totalPulls),
      }))
    : [];

  return (
    <div className="hc">
      <div className="hc-panel">

        {/* ── Settings row: resources | divider | state columns ── */}
        <div className="hc-settings">

          <div className="hc-resources">
            <p className="section-title">Resources</p>
            <div className="hc-resource-fields">
              <HcNumberField
                label={currencyName}
                value={stellarJade}
                onChange={v => { setStellarJade(v); clearResult(); }}
              />
              <HcNumberField
                label={passesLabel || 'Star Rail Special Passes'}
                value={passes}
                onChange={v => { setPasses(v); clearResult(); }}
              />
            </div>
            <div className="hc-pull-count">
              <strong style={{ color: gameColor }}>{totalPulls.toLocaleString()}</strong>
              {' pulls available'}
            </div>
          </div>

          <div className="hc-vsep" />

          <div className="hc-state">

            <div className="hc-state-col">
              <p className="section-title">{charName}</p>
              <div className="hc-field">
                <span className="hc-field-label">Pity</span>
                <HcNumberField
                  value={charPity}
                  onChange={v => { setCharPity(v); clearResult(); }}
                  max={89} compact
                />
              </div>
              <div className="hc-field">
                <span className="hc-field-label">Guaranteed</span>
                <div className="hc-seg">
                  <button
                    className={`hc-seg-btn ${!charGuaranteed ? 'hc-seg-btn--active' : ''}`}
                    style={!charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setCharGuaranteed(false); clearResult(); }}>✗</button>
                  <button
                    className={`hc-seg-btn ${charGuaranteed ? 'hc-seg-btn--active' : ''}`}
                    style={charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setCharGuaranteed(true); clearResult(); }}>✓</button>
                </div>
              </div>
            </div>

            <div className="hc-state-col">
              <p className="section-title">{weaponName}</p>
              <div className="hc-field">
                <span className="hc-field-label">Pity</span>
                <HcNumberField
                  value={lcPity}
                  onChange={v => { setLCPity(v); clearResult(); }}
                  max={79} compact
                />
              </div>
              <div className="hc-field">
                <span className="hc-field-label">Guaranteed</span>
                <div className="hc-seg">
                  <button
                    className={`hc-seg-btn ${!lcGuaranteed ? 'hc-seg-btn--active' : ''}`}
                    style={!lcGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setLCGuaranteed(false); clearResult(); }}>✗</button>
                  <button
                    className={`hc-seg-btn ${lcGuaranteed ? 'hc-seg-btn--active' : ''}`}
                    style={lcGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setLCGuaranteed(true); clearResult(); }}>✓</button>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Targets ── */}
        <div>
          <p className="section-title">Target</p>
          <div className="hc-targets-row">
            <HcDropdown
              label={charCopyLabel}
              options={CHAR_TARGETS}
              value={charTarget}
              onChange={v => { setCharTarget(v); clearResult(); }}
              color={gameColor}
            />
            <HcDropdown
              label={lcCopyLabel}
              options={LC_TARGETS}
              value={lcTarget}
              onChange={v => { setLCTarget(v); clearResult(); }}
              color={gameColor}
            />
          </div>
        </div>

        {/* ── Calculate ── */}
        <button
          className="hc-run-btn"
          onClick={calculate}
          disabled={!canRun}
          style={{ background: gameColor }}
        >
          Calculate
        </button>
        {!canRun && (
          <p className="hc-run-hint">Select a target above to calculate.</p>
        )}

      </div>

      {/* ── Results ── */}
      <div className="hc-results-panel">
        {/* 1 — Fixed title row */}
        <div className="hc-results-header">
          <p className="section-title">Results</p>
          <button className="hc-info-btn" onClick={() => setInfoOpen(true)} title="About these results">
            <Info size={14} />
          </button>
        </div>

        {result && (charRows.length > 0 || lcRows.length > 0) ? (<>
          {/* 2 — Fixed column headers */}
          <div className="hc-results-cols">
            <span className="hc-col-goal">Goal</span>
            <span className="hc-col-right">Avg pulls</span>
            <span className="hc-col-right">
              {totalPulls > 0 ? `Success (${totalPulls} pulls)` : 'Success chance'}
            </span>
          </div>

          {/* 3 — Scrollable milestone rows */}
          <div className="hc-results-scroll">
            {charRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
            {charRows.length > 0 && lcRows.length > 0 && (
              <div className="hc-row-sep" />
            )}
            {lcRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
          </div>

          {/* 4 — Fixed footer: combined target */}
          {(() => {
            const lastChar = charRows.length > 0 ? charRows[charRows.length - 1] : null;
            const lastLC = lcRows.length > 0 ? lcRows[lcRows.length - 1] : null;
            const combined = lastChar && lastLC
              ? { label: lastChar.label + lastLC.label, avg: lastChar.avg + lastLC.avg, chance: lastChar.chance * lastLC.chance }
              : (lastChar ?? lastLC);
            return (
              <div className="hc-results-footer">
                <span className="hc-footer-label">Target</span>
                <ResultRow row={combined} color={gameColor} showChance={totalPulls > 0} isTarget />
              </div>
            );
          })()}
        </>) : (
          <div className="hc-results-placeholder">
            Select a target and calculate.
          </div>
        )}
      </div>

      {infoOpen && <HSRInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function HSRInfoModal({ onClose }) {
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
      className={`hc-modal-overlay${closing ? ' hc-modal-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={handleOverlayClick}
      onAnimationEnd={handleAnimEnd}
    >
      <div className="hc-modal">
        <div className="hc-modal-header">
          <span className="hc-modal-title">About these results</span>
          <button className="hc-modal-close" onClick={close}>✕</button>
        </div>
        <p className="hc-modal-body">
          Results use exact probability math, not simulations — no sampling error.
          Featured rates are 56.25% for characters and 78.125% for light cones,
          derived from GGanalysis research across 15 million pulls.
          These differ from the commonly assumed 50/50 and 75/25.
        </p>
        <div className="hc-modal-sources">
          <p className="hc-modal-sources-title">Sources</p>
          <button className="hc-modal-link" onClick={() => window.api.openExternal('https://www.reddit.com/r/HonkaiStarRail/comments/1cib3kb/the_pity_system_of_honkai_star_rail_is_actually/')}>
            HSR Pity System Research (56.25% / 78.125%)
          </button>
        </div>
      </div>
    </div>
  );
}

function HcDropdown({ label, options, value, onChange, color }) {
  return (
    <div className="hc-dropdown-col">
      <span className="hc-target-label">{label}</span>
      <select
        className="hc-select"
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
    <div className={`hc-result-row${isTarget ? ' hc-result-row--target' : ''}`}>
      <span className="hc-col-goal hc-col-goal--value" style={{ color }}>{row.label}</span>
      <span className="hc-col-right hc-col-num">{row.avg}</span>
      <span className="hc-col-right hc-col-chance" style={{ color: showChance ? color : 'var(--text-muted)' }}>
        {showChance ? pct : '—'}
      </span>
    </div>
  );
}

function HcNumberField({ label, value, onChange, max, compact = false }) {
  return (
    <div className={`hc-numfield${compact ? ' hc-numfield--compact' : ''}`}>
      {label && <span className="hc-numfield-label">{label}</span>}
      <input
        className="hc-numfield-input"
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
