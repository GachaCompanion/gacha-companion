import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { computeNTE, successChance, averagePulls } from './nteSimulation';
import { resolveGameCurrency, resolveGameLabels } from '../../engine/gameSchema';
import './NTECalculator.css';

function buildTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 7 }, (_, i) => ({ label: `${letter}${i}`, copies: i + 1 }))];
}

export default function NTECalculator({ game, color }) {
  const gameColor = color;
  const costPerPull = game.charBanner?.costPerPull ?? 160;
  const { currencyName, pullItemName: diceLabel, weaponPullItemName: keyLabel } = resolveGameCurrency(game);
  const { charName, weaponName: arcName, charCopyLabel, weaponCopyLabel: arcCopyLabel, charCopyLetter, weaponCopyLetter: arcCopyLetter } = resolveGameLabels(game);
  const CHAR_TARGETS = buildTargets(charCopyLetter);
  const ARC_TARGETS = buildTargets(arcCopyLetter);

  const [annulith, setAnnulith] = useState('');
  const [solidDice, setSolidDice] = useState('');
  const [triKey, setTriKey] = useState('');
  const [charPity, setCharPity] = useState('');
  const [arcPity, setArcPity] = useState('');
  const [charTarget, setCharTarget] = useState(0);
  const [arcTarget, setArcTarget] = useState(0);
  const [result, setResult] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setAnnulith('');
    setSolidDice('');
    setTriKey('');
    setCharPity('');
    setArcPity('');
    setCharTarget(0);
    setArcTarget(0);
    setResult(null);
  }, [game.id]);

  const annulithNum = parseInt(annulith, 10) || 0;
  const solidDiceNum = parseInt(solidDice, 10) || 0;
  const triKeyNum = parseInt(triKey, 10) || 0;
  const charPityNum = Math.min(89, parseInt(charPity, 10) || 0);
  const arcPityNum = Math.min(79, parseInt(arcPity, 10) || 0);
  // Annulith is fungible currency shared by both banners — it isn't spent
  // until converted, so it counts toward both totals optimistically. Solid
  // Dice and Tri-Keys, once converted, are not interchangeable with each other.
  const affordablePulls = Math.floor(annulithNum / costPerPull);
  const charTotalPulls = affordablePulls + solidDiceNum;
  const arcTotalPulls = affordablePulls + triKeyNum;
  const canRun = charTarget > 0 || arcTarget > 0;

  function clearResult() { setResult(null); }

  function calculate() {
    if (!canRun) return;
    const data = computeNTE({
      charCopies: charTarget,
      arcCopies: arcTarget,
      startCharPity: charPityNum,
      startArcPity: arcPityNum,
    });
    setResult(data);
  }

  const charRows = result
    ? result.charMilestones.map((m, i) => ({
        label: CHAR_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, charTotalPulls),
      }))
    : [];

  const arcRows = result
    ? result.arcMilestones.map((m, i) => ({
        label: ARC_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, arcTotalPulls),
      }))
    : [];

  return (
    <div className="ntec">
      <div className="ntec-panel">

        {/* ── Settings row: resources | divider | state columns ── */}
        <div className="ntec-settings">

          <div className="ntec-resources">
            <p className="section-title">Resources</p>
            <div className="ntec-resource-fields">
              <NtecNumberField
                label={currencyName}
                value={annulith}
                onChange={v => { setAnnulith(v); clearResult(); }}
              />
              <NtecNumberField
                label={diceLabel || 'Solid Dice'}
                value={solidDice}
                onChange={v => { setSolidDice(v); clearResult(); }}
              />
              <NtecNumberField
                label={keyLabel || 'Tri-Key'}
                value={triKey}
                onChange={v => { setTriKey(v); clearResult(); }}
              />
            </div>
          </div>

          <div className="ntec-vsep" />

          <div className="ntec-state-wrap">
            <div className="ntec-state">

              <div className="ntec-state-col">
                <p className="section-title">{charName}</p>
                <div className="ntec-field">
                  <span className="ntec-field-label">Pity</span>
                  <NtecNumberField
                    value={charPity}
                    onChange={v => { setCharPity(v); clearResult(); }}
                    max={89} compact
                  />
                </div>
              </div>

              <div className="ntec-state-col">
                <p className="section-title">{arcName}</p>
                <div className="ntec-field">
                  <span className="ntec-field-label">Pity</span>
                  <NtecNumberField
                    value={arcPity}
                    onChange={v => { setArcPity(v); clearResult(); }}
                    max={79} compact
                  />
                </div>
                {/* No Guaranteed toggle — Arc banner losses don't carry a
                    guarantee into the next S-Class pull, see nteSimulation.js. */}
              </div>

            </div>
            <div className="ntec-pull-count">
              <strong style={{ color: gameColor }}>{charTotalPulls.toLocaleString()}</strong>
              {` ${charName.toLowerCase()} pulls`}
            </div>
            <div className="ntec-pull-count">
              <strong style={{ color: gameColor }}>{arcTotalPulls.toLocaleString()}</strong>
              {` ${arcName.toLowerCase()} pulls`}
            </div>
          </div>
        </div>

        {/* ── Targets ── */}
        <div>
          <p className="section-title">Target</p>
          <div className="ntec-targets-row">
            <NtecDropdown
              label={charCopyLabel}
              options={CHAR_TARGETS}
              value={charTarget}
              onChange={v => { setCharTarget(v); clearResult(); }}
              color={gameColor}
            />
            <NtecDropdown
              label={arcCopyLabel}
              options={ARC_TARGETS}
              value={arcTarget}
              onChange={v => { setArcTarget(v); clearResult(); }}
              color={gameColor}
            />
          </div>
        </div>

        {/* ── Calculate ── */}
        <button
          className="ntec-run-btn"
          onClick={calculate}
          disabled={!canRun}
          style={{ background: gameColor }}
        >
          Calculate
        </button>
        {!canRun && (
          <p className="ntec-run-hint">Select a target above to calculate.</p>
        )}

      </div>

      {/* ── Results ── */}
      <div className="ntec-results-panel">
        {/* 1 — Fixed title row */}
        <div className="ntec-results-header">
          <p className="section-title">Results</p>
          <button className="ntec-info-btn" onClick={() => setInfoOpen(true)} title="About these results">
            <Info size={14} />
          </button>
        </div>

        {result && (charRows.length > 0 || arcRows.length > 0) ? (<>
          {/* 2 — Fixed column headers */}
          <div className="ntec-results-cols">
            <span className="ntec-col-goal">Goal</span>
            <span className="ntec-col-right">Avg pulls</span>
            <span className="ntec-col-right">Success</span>
          </div>

          {/* 3 — Scrollable milestone rows */}
          <div className="ntec-results-scroll">
            {charRows.map(row => (
              <ResultRow key={`char-${row.label}`} row={row} color={gameColor} showChance={charTotalPulls > 0} />
            ))}
            {charRows.length > 0 && arcRows.length > 0 && (
              <div className="ntec-row-sep" />
            )}
            {arcRows.map(row => (
              <ResultRow key={`arc-${row.label}`} row={row} color={gameColor} showChance={arcTotalPulls > 0} />
            ))}
          </div>

          {/* 4 — Fixed footer: combined target */}
          {(() => {
            const lastChar = charRows.length > 0 ? charRows[charRows.length - 1] : null;
            const lastArc = arcRows.length > 0 ? arcRows[arcRows.length - 1] : null;
            const combined = lastChar && lastArc
              ? { label: lastChar.label + lastArc.label, avg: lastChar.avg + lastArc.avg, chance: lastChar.chance * lastArc.chance }
              : (lastChar ?? lastArc);
            const combinedHasChance = (lastChar ? charTotalPulls > 0 : true) && (lastArc ? arcTotalPulls > 0 : true);
            return (
              <div className="ntec-results-footer">
                <span className="ntec-footer-label">Target</span>
                <ResultRow row={combined} color={gameColor} showChance={combinedHasChance} isTarget />
              </div>
            );
          })()}
        </>) : (
          <div className="ntec-results-placeholder">
            Select a target and calculate.
          </div>
        )}
      </div>

      {infoOpen && <NTEInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function NTEInfoModal({ onClose }) {
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
      className={`ntec-modal-overlay${closing ? ' ntec-modal-overlay--closing' : ''}`}
      ref={overlayRef}
      onClick={handleOverlayClick}
      onAnimationEnd={handleAnimEnd}
    >
      <div className="ntec-modal">
        <div className="ntec-modal-header">
          <span className="ntec-modal-title">About these results</span>
          <button className="ntec-modal-close" onClick={close}>✕</button>
        </div>
        <p className="ntec-modal-body">
          Results use exact probability math, not simulations — no sampling error.
          The Character banner has no 50/50: every S-Class pull is the featured
          character. The Arc banner uses the advertised 25% featured chance with
          a guarantee on the next S-Class Arc after a loss. Solid Dice and Tri-Keys
          are tracked separately since they aren't interchangeable — Annulith
          counts toward both totals until you convert it.
        </p>
      </div>
    </div>
  );
}

function NtecDropdown({ label, options, value, onChange, color }) {
  return (
    <div className="ntec-dropdown-col">
      <span className="ntec-target-label">{label}</span>
      <select
        className="ntec-select"
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
    <div className={`ntec-result-row${isTarget ? ' ntec-result-row--target' : ''}`}>
      <span className="ntec-col-goal ntec-col-goal--value" style={{ color }}>{row.label}</span>
      <span className="ntec-col-right ntec-col-num">{row.avg}</span>
      <span className="ntec-col-right ntec-col-chance" style={{ color: showChance ? color : 'var(--text-muted)' }}>
        {showChance ? pct : '—'}
      </span>
    </div>
  );
}

function NtecNumberField({ label, value, onChange, max, compact = false }) {
  return (
    <div className={`ntec-numfield${compact ? ' ntec-numfield--compact' : ''}`}>
      {label && <span className="ntec-numfield-label">{label}</span>}
      <input
        className="ntec-numfield-input"
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
