import React, { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { computeWuwa, successChance, averagePulls } from './wuwaSimulation';
import { resolveGameCurrency, resolveGameLabels } from '../../engine/gameSchema';
import './WuwaCalculator.css';

function buildCharTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 7 }, (_, i) => ({ label: `${letter}${i}`, copies: i + 1 }))];
}

function buildWeaponTargets(letter) {
  return [{ label: 'None', copies: 0 },
    ...Array.from({ length: 5 }, (_, i) => ({ label: `${letter}${i + 1}`, copies: i + 1 }))];
}

export default function WuwaCalculator({ game, color }) {
  const gameColor = color;
  const costPerPull = game.charBanner?.costPerPull ?? 160;
  const { currencyName, pullItemName: radiantTideLabel, weaponPullItemName: forgingTideLabel } = resolveGameCurrency(game);
  const { charName, weaponName, charCopyLabel, weaponCopyLabel, charCopyLetter, weaponCopyLetter } = resolveGameLabels(game);
  const CHAR_TARGETS = buildCharTargets(charCopyLetter);
  const WEAPON_TARGETS = buildWeaponTargets(weaponCopyLetter);

  const [astrite, setAstrite] = useState('');
  const [charTides, setCharTides] = useState('');
  const [weaponTides, setWeaponTides] = useState('');
  const [charPity, setCharPity] = useState('');
  const [charGuaranteed, setCharGuaranteed] = useState(false);
  const [weaponPity, setWeaponPity] = useState('');
  const [weaponGuaranteed, setWeaponGuaranteed] = useState(false);
  const [charTarget, setCharTarget] = useState(0);
  const [weaponTarget, setWeaponTarget] = useState(0);
  const [result, setResult] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    setAstrite('');
    setCharTides('');
    setWeaponTides('');
    setCharPity('');
    setCharGuaranteed(false);
    setWeaponPity('');
    setWeaponGuaranteed(false);
    setCharTarget(0);
    setWeaponTarget(0);
    setResult(null);
  }, [game.id]);

  const astriteNum = parseInt(astrite, 10) || 0;
  const charTidesNum = parseInt(charTides, 10) || 0;
  const weaponTidesNum = parseInt(weaponTides, 10) || 0;
  const charPityNum = Math.min(79, parseInt(charPity, 10) || 0);
  const weaponPityNum = Math.min(79, parseInt(weaponPity, 10) || 0);
  const affordablePulls = Math.floor(astriteNum / costPerPull);
  const charTotalPulls = affordablePulls + charTidesNum;
  const weaponTotalPulls = affordablePulls + weaponTidesNum;
  const canRun = charTarget > 0 || weaponTarget > 0;

  function clearResult() { setResult(null); }

  function calculate() {
    if (!canRun) return;
    const data = computeWuwa({
      charCopies: charTarget,
      weaponCopies: weaponTarget,
      startCharPity: charPityNum,
      startCharGuaranteed: charGuaranteed,
      startWeaponPity: weaponPityNum,
      startWeaponGuaranteed: weaponGuaranteed,
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

  const weaponRows = result
    ? result.weaponMilestones.map((m, i) => ({
        label: WEAPON_TARGETS[i + 1].label,
        avg: averagePulls(m.pmf),
        chance: successChance(m.cdf, weaponTotalPulls),
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
                label={currencyName || 'Astrite'}
                value={astrite}
                onChange={v => { setAstrite(v); clearResult(); }}
              />
              <ZcNumberField
                label={radiantTideLabel || 'Radiant Tide'}
                value={charTides}
                onChange={v => { setCharTides(v); clearResult(); }}
              />
              <ZcNumberField
                label={forgingTideLabel || 'Forging Tide'}
                value={weaponTides}
                onChange={v => { setWeaponTides(v); clearResult(); }}
              />
            </div>
          </div>

          <div className="zc-vsep" />

          <div className="zc-state-wrap">
            <div className="zc-state">

              <div className="zc-state-col">
                <p className="section-title">{charName}</p>
                <div className="zc-field">
                  <span className="zc-field-label">Pity</span>
                  <ZcNumberField
                    value={charPity}
                    onChange={v => { setCharPity(v); clearResult(); }}
                    max={79} compact
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
                    value={weaponPity}
                    onChange={v => { setWeaponPity(v); clearResult(); }}
                    max={79} compact
                  />
                </div>
                {/* No Guaranteed toggle here — WuWa's weapon banner has no 50/50,
                    every 5-star weapon is already guaranteed to be featured. */}
              </div>

            </div>
            <div className="zc-pull-count">
              <strong style={{ color: gameColor }}>{charTotalPulls.toLocaleString()}</strong>
              {` ${charName.toLowerCase()} pulls available`}
            </div>
            <div className="zc-pull-count">
              <strong style={{ color: gameColor }}>{weaponTotalPulls.toLocaleString()}</strong>
              {' weapon pulls available'}
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
              label={weaponCopyLabel}
              options={WEAPON_TARGETS}
              value={weaponTarget}
              onChange={v => { setWeaponTarget(v); clearResult(); }}
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
        <div className="zc-results-header">
          <p className="section-title">Results</p>
          <button className="zc-info-btn" onClick={() => setInfoOpen(true)} title="About these results">
            <Info size={14} />
          </button>
        </div>

        {result && (charRows.length > 0 || weaponRows.length > 0) ? (<>
          <div className="zc-results-cols">
            <span className="zc-col-goal">Goal</span>
            <span className="zc-col-right">Avg pulls</span>
            <span className="zc-col-right">Success chance</span>
          </div>

          <div className="zc-results-scroll">
            {charRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={charTotalPulls > 0} />
            ))}
            {charRows.length > 0 && weaponRows.length > 0 && (
              <div className="zc-row-sep" />
            )}
            {weaponRows.map(row => (
              <ResultRow key={row.label} row={row} color={gameColor} showChance={weaponTotalPulls > 0} />
            ))}
          </div>

          {(() => {
            const lastChar = charRows.length > 0 ? charRows[charRows.length - 1] : null;
            const lastWeapon = weaponRows.length > 0 ? weaponRows[weaponRows.length - 1] : null;
            const combined = lastChar && lastWeapon
              ? { label: lastChar.label + lastWeapon.label, avg: lastChar.avg + lastWeapon.avg, chance: lastChar.chance * lastWeapon.chance }
              : (lastChar ?? lastWeapon);
            const showChance = charTotalPulls > 0 && weaponTotalPulls > 0;
            return (
              <div className="zc-results-footer">
                <span className="zc-footer-label">Target</span>
                <ResultRow row={combined} color={gameColor} showChance={lastChar && lastWeapon ? showChance : (lastChar ? charTotalPulls > 0 : weaponTotalPulls > 0)} isTarget />
              </div>
            );
          })()}
        </>) : (
          <div className="zc-results-placeholder">
            Select a target and calculate.
          </div>
        )}
      </div>

      {infoOpen && <WuwaInfoModal onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

function WuwaInfoModal({ onClose }) {
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
          Standard 50/50 applies to Resonators and 75/25 applies to Weapons,
          using community-sourced rates (Kuro Games does not publish exact figures).
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
