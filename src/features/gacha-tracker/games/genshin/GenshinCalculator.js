import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { simulateGenshinFull, successChance, averagePulls } from './genshinSimulation';
import { resolveGameCurrency, resolveGameLabels } from '../../engine/gameSchema';
import './GenshinCalculator.css';

const RUNS = 100_000;

const CHAR_TARGETS = [
  { label: 'None', copies: 0 },
  { label: 'C0',   copies: 1 },
  { label: 'C1',   copies: 2 },
  { label: 'C2',   copies: 3 },
  { label: 'C3',   copies: 4 },
  { label: 'C4',   copies: 5 },
  { label: 'C5',   copies: 6 },
  { label: 'C6',   copies: 7 },
];

const WEAPON_TARGETS = [
  { label: 'None', copies: 0 },
  { label: 'R1',   copies: 1 },
  { label: 'R2',   copies: 2 },
  { label: 'R3',   copies: 3 },
  { label: 'R4',   copies: 4 },
  { label: 'R5',   copies: 5 },
];

// Derive current Capturing Radiance counter from pull log.
// All players start at 1 after version 5.0.
// Lose 50/50: counter +1. Win 50/50: counter -1 (min 0). Guaranteed: no change.
// At counter=3, win was CR (resets to 1); counter=2 both paths lead to 1 anyway.
function computeRadiance(pullLog) {
  const relevant = (pullLog ?? [])
    .filter(p =>
      p.rarity === 5 &&
      p.banner === 'character' &&
      p.won5050 != null &&
      p.version != null &&
      parseFloat(p.version) >= 5.0
    )
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  let counter = 1;
  for (const p of relevant) {
    if (p.won5050 === 'lost') {
      counter = Math.min(3, counter + 1);
    } else if (p.won5050 === 'won') {
      counter = counter === 3 ? 1 : Math.max(0, counter - 1);
    }
    // 'guaranteed' does not change the radiance counter
  }
  return counter;
}

export default function GenshinCalculator({ game, color }) {
  const { state } = game;
  const gameColor = color;
  const costPerPull = game.charBanner?.costPerPull ?? 160;
  const { currencyName, pullItemName: fatesLabel } = resolveGameCurrency(game);
  const { charName, weaponName, charCopyLabel: charLabel, weaponCopyLabel: weaponLabel } = resolveGameLabels(game);

  // Resources
  const [primogems, setPrimogems] = useState('');
  const [fates, setFates] = useState('');

  // Character state
  const [charPity, setCharPity] = useState('');
  const [charGuaranteed, setCharGuaranteed] = useState(false);
  const [radianceOverride, setRadianceOverride] = useState(null);

  // Weapon state
  const [weaponPity, setWeaponPity] = useState('');
  const [weaponGuaranteed, setWeaponGuaranteed] = useState(false);
  const [epitomizedPoints, setEpitomizedPoints] = useState(0);

  // Targets
  const [charTarget, setCharTarget] = useState(0);
  const [weaponTarget, setWeaponTarget] = useState(0);

  // Simulation
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setPrimogems('');
    setFates('');
    setCharPity('');
    setCharGuaranteed(false);
    setRadianceOverride(null);
    setWeaponPity('');
    setWeaponGuaranteed(false);
    setEpitomizedPoints(0);
    setCharTarget(0);
    setWeaponTarget(0);
    setResult(null);
  }, [game.id]);

  const computedRadiance = useMemo(() => computeRadiance(state.pullLog), [state.pullLog]);
  const radiance = radianceOverride ?? computedRadiance;

  const primogemsNum = parseInt(primogems, 10) || 0;
  const fatesNum = parseInt(fates, 10) || 0;
  const charPityNum = Math.min(89, parseInt(charPity, 10) || 0);
  const weaponPityNum = Math.min(76, parseInt(weaponPity, 10) || 0);
  const totalPulls = Math.floor(primogemsNum / costPerPull) + fatesNum;
  const canRun = charTarget > 0 || weaponTarget > 0;

  function clearResult() { setResult(null); }

  const run = useCallback(() => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      const data = simulateGenshinFull({
        charCopies: charTarget,
        weaponCopies: weaponTarget,
        startCharPity: charPityNum,
        startCharGuaranteed: charGuaranteed,
        startRadiance: radiance,
        startWeaponPity: weaponPityNum,
        startWeaponGuaranteed: weaponGuaranteed,
        startEpitomizedPoints: epitomizedPoints,
        runs: RUNS,
      });
      setResult(data);
      setRunning(false);
    }, 10);
  }, [charTarget, weaponTarget, charPityNum, charGuaranteed, radiance, weaponPityNum, weaponGuaranteed, epitomizedPoints, canRun]);

  const charRows = result
    ? result.charMilestones.map((m, i) => ({
        label: CHAR_TARGETS[i + 1].label,
        avg: averagePulls(m),
        chance: successChance(m, totalPulls),
      }))
    : [];

  const weaponRows = result
    ? result.weaponMilestones.map((m, i) => ({
        label: WEAPON_TARGETS[i + 1].label,
        avg: averagePulls(m),
        chance: successChance(m, totalPulls),
      }))
    : [];

  return (
    <div className="gc">
      <div className="gc-panel">

        {/* ── Settings row: resources | divider | state columns ── */}
        <div className="gc-settings">

          <div className="gc-resources">
            <p className="section-title">Resources</p>
            <div className="gc-resource-fields">
              <GcNumberField
                label={currencyName}
                value={primogems}
                onChange={v => { setPrimogems(v); clearResult(); }}
              />
              <GcNumberField
                label={fatesLabel || 'Intertwined Fates'}
                value={fates}
                onChange={v => { setFates(v); clearResult(); }}
              />
            </div>
            <div className="gc-pull-count">
              <strong style={{ color: gameColor }}>{totalPulls.toLocaleString()}</strong>
              {' pulls available'}
            </div>
          </div>

          <div className="gc-vsep" />

          <div className="gc-state">

          <div className="gc-state-col">
            <p className="section-title">{charName}</p>
            <div className="gc-field">
              <span className="gc-field-label">Pity</span>
              <GcNumberField
                value={charPity}
                onChange={v => { setCharPity(v); clearResult(); }}
                max={89} compact
              />
            </div>
            <div className="gc-field">
              <span className="gc-field-label">Guaranteed</span>
              <div className="gc-seg">
                <button
                  className={`gc-seg-btn ${!charGuaranteed ? 'gc-seg-btn--active' : ''}`}
                  style={!charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                  onClick={() => { setCharGuaranteed(false); clearResult(); }}>✗</button>
                <button
                  className={`gc-seg-btn ${charGuaranteed ? 'gc-seg-btn--active' : ''}`}
                  style={charGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                  onClick={() => { setCharGuaranteed(true); clearResult(); }}>✓</button>
              </div>
            </div>
            <div className="gc-field gc-field--col">
              <span className="gc-field-label">
                Capturing Radiance
                {radianceOverride !== null && (
                  <button className="gc-reset-link" onClick={() => { setRadianceOverride(null); clearResult(); }}>
                    reset
                  </button>
                )}
              </span>
              <div className="gc-seg">
                {[0, 1, 2, 3].map(v => (
                  <button
                    key={v}
                    className={`gc-seg-btn ${radiance === v ? 'gc-seg-btn--active' : ''}`}
                    style={radiance === v ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setRadianceOverride(v === computedRadiance ? null : v); clearResult(); }}
                  >
                    {v === 3 ? '3 ★' : String(v)}
                  </button>
                ))}
              </div>
              {radianceOverride === null
                ? <span className="gc-computed-hint">computed from pull history</span>
                : <span className="gc-computed-hint">computed value: {computedRadiance}</span>
              }
            </div>
          </div>

          <div className="gc-state-col">
            <p className="section-title">{weaponName}</p>
            <div className="gc-field">
              <span className="gc-field-label">Pity</span>
              <GcNumberField
                value={weaponPity}
                onChange={v => { setWeaponPity(v); clearResult(); }}
                max={76} compact
              />
            </div>
            <div className="gc-field">
              <span className="gc-field-label">Guaranteed</span>
              <div className="gc-seg">
                <button
                  className={`gc-seg-btn ${!weaponGuaranteed ? 'gc-seg-btn--active' : ''}`}
                  style={!weaponGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                  onClick={() => { setWeaponGuaranteed(false); clearResult(); }}>✗</button>
                <button
                  className={`gc-seg-btn ${weaponGuaranteed ? 'gc-seg-btn--active' : ''}`}
                  style={weaponGuaranteed ? { color: gameColor, background: gameColor + '18' } : {}}
                  onClick={() => { setWeaponGuaranteed(true); clearResult(); }}>✓</button>
              </div>
            </div>
            <div className="gc-field gc-field--col">
              <span className="gc-field-label">Epitomized Path</span>
              <div className="gc-seg">
                {[0, 1].map(v => (
                  <button
                    key={v}
                    className={`gc-seg-btn ${epitomizedPoints === v ? 'gc-seg-btn--active' : ''}`}
                    style={epitomizedPoints === v ? { color: gameColor, background: gameColor + '18' } : {}}
                    onClick={() => { setEpitomizedPoints(v); clearResult(); }}
                  >{v}/1</button>
                ))}
              </div>
            </div>
          </div>

        </div>{/* end gc-state */}
        </div>{/* end gc-settings */}

        {/* ── Targets ── */}
        <div>
          <p className="section-title">Target</p>
          <div className="gc-targets-row">
            <GcDropdown
              label={charLabel}
              options={CHAR_TARGETS}
              value={charTarget}
              onChange={v => { setCharTarget(v); clearResult(); }}
              color={gameColor}
            />
            <GcDropdown
              label={weaponLabel}
              options={WEAPON_TARGETS}
              value={weaponTarget}
              onChange={v => { setWeaponTarget(v); clearResult(); }}
              color={gameColor}
            />
          </div>
        </div>

        {/* ── Run ── */}
        <button
          className="gc-run-btn"
          onClick={run}
          disabled={running || !canRun}
          style={{ background: gameColor }}
        >
          {running ? 'Simulating…' : 'Run simulation'}
        </button>
        {!canRun && (
          <p className="gc-run-hint">Select a target above to run the simulation.</p>
        )}

      </div>

      {/* ── Results ── */}
      <div className="gc-results-panel">
        {/* 1 — Fixed title row */}
        <div className="gc-results-header">
          <p className="section-title">Results</p>
          <button className="gc-info-btn" onClick={() => setInfoOpen(true)} title="About these results">
            <Info size={14} />
          </button>
        </div>

        {result && (charRows.length > 0 || weaponRows.length > 0) ? (<>
          {/* 2 — Fixed column headers */}
          <div className="gc-results-cols">
            <span className="gc-col-goal">Goal</span>
            <span className="gc-col-right">Avg pulls</span>
            <span className="gc-col-right">
              {totalPulls > 0 ? `Success (${totalPulls} pulls)` : 'Success chance'}
            </span>
          </div>

          {/* 3 — Scrollable milestone rows */}
          <div className="gc-results-scroll">
            {charRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
            {charRows.length > 0 && weaponRows.length > 0 && (
              <div className="gc-row-sep" />
            )}
            {weaponRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={totalPulls > 0} />
            ))}
          </div>

          {/* 4 — Fixed footer: combined target */}
          {(() => {
            const lastChar = charRows.length > 0 ? charRows[charRows.length - 1] : null;
            const lastWeapon = weaponRows.length > 0 ? weaponRows[weaponRows.length - 1] : null;
            const combined = lastChar && lastWeapon
              ? { label: lastChar.label + lastWeapon.label, avg: lastChar.avg + lastWeapon.avg, chance: lastChar.chance * lastWeapon.chance }
              : (lastChar ?? lastWeapon);
            return (
              <div className="gc-results-footer">
                <span className="gc-footer-label">Target</span>
                <ResultRow row={combined} color={gameColor} showChance={totalPulls > 0} isTarget />
              </div>
            );
          })()}
        </>) : (
          <div className="gc-results-placeholder">
            {running ? 'Simulating…' : 'Select a target and run the simulation.'}
          </div>
        )}
      </div>

      {/* ── Info modal ── */}
      {infoOpen && <GenshinInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function GenshinInfoModal({ onClose }) {
  const overlayRef = useRef(null);
  const [closing, setClosing] = useState(false);

  function close() {
    setClosing(true);
  }

  function handleAnimEnd() {
    if (closing) onClose();
  }

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
      className={`gc-modal-overlay${closing ? ' gc-modal-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={handleOverlayClick}
      onAnimationEnd={handleAnimEnd}
    >
      <div className="gc-modal">
        <div className="gc-modal-header">
          <span className="gc-modal-title">About these results</span>
          <button className="gc-modal-close" onClick={close}>✕</button>
        </div>
        <p className="gc-modal-body">
          Monte Carlo estimates using Genshin's actual pity rates, run across 100,000 simulations.
          Capturing Radiance at counter 2 uses a 55% win rate (empirical range: 52–60%).
          Actual results depend on luck.
        </p>
        <div className="gc-modal-sources">
          <p className="gc-modal-sources-title">Sources</p>
          <button className="gc-modal-link" onClick={() => window.api.openExternal('https://www.hoyolab.com/article/497840')}>
            Drop Rates
          </button>
          <button className="gc-modal-link" onClick={() => window.api.openExternal('https://www.reddit.com/r/Genshin_Impact/comments/1hd1sqa/understanding_genshin_impacts_capturing_radiance/')}>
            Capturing Radiance
          </button>
        </div>
      </div>
    </div>
  );
}

function GcDropdown({ label, options, value, onChange, color }) {
  return (
    <div className="gc-dropdown-col">
      <span className="gc-target-label">{label}</span>
      <select
        className="gc-select"
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
    <div className={`gc-result-row${isTarget ? ' gc-result-row--target' : ''}`}>
      <span className="gc-col-goal gc-col-goal--value" style={{ color }}>{row.label}</span>
      <span className="gc-col-right gc-col-num">{row.avg}</span>
      <span className="gc-col-right gc-col-chance" style={{ color: showChance ? color : 'var(--text-muted)' }}>
        {showChance ? pct : '—'}
      </span>
    </div>
  );
}

function GcNumberField({ label, value, onChange, max, compact = false }) {
  return (
    <div className={`gc-numfield${compact ? ' gc-numfield--compact' : ''}`}>
      {label && <span className="gc-numfield-label">{label}</span>}
      <input
        className="gc-numfield-input"
        type="number"
        min={0}
        max={max}
        placeholder="0"
        value={value}
        onChange={e => {
          const raw = e.target.value;
          if (raw === '' || raw === '-') {
            onChange('');
            return;
          }
          const v = parseInt(raw, 10);
          if (!isNaN(v) && v >= 0) {
            onChange(max !== undefined ? String(Math.min(max, v)) : String(v));
          }
        }}
      />
    </div>
  );
}
