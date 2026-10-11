import React, { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { computeConstellation, resolveId, fetchBannerImage } from '../engine/costCalc';
import { useRoster } from '../engine/useRoster';
import RosterManageModal from './RosterManageModal';
import { useT } from '../../../shared/i18n';
import './CostCalculatorTab.css';

// Roster — a flat, element-grouped list of maxed characters (5-star/S-rank
// with 7+ owned copies — C6/E6/M6/S6), read straight off the pull log, plus
// any names the user manually added (state.rosterManual — e.g. a 4-star, or
// a 5-star not yet maxed). Standard-pool characters are auto-excluded from
// the maxed list per game (see engine/rosterGameConfig.js) but CAN be added
// manually — that exclusion is a heuristic for the automatic list, not a
// hard rule. Portraits reuse the same nanoka id -> gc-data image pipeline as
// the rest of the app (see engine/costCalc.js). Per-game element data/order/
// colors/icons all come from rosterGameConfig.js — NTE has no usable element
// icon asset, so its groups render as text instead. State/logic itself lives
// in engine/useRoster.js.
//
// Adding/removing characters both happen only inside RosterManageModal.js —
// no edit mode, no per-card remove control in the grid itself. The "Manage
// Roster" button is absolutely positioned (top-right of this tab's own
// content, not a row of its own) specifically so it never needs to share a
// line with GameDashboard.js's tab strip — two earlier attempts at that
// (hardcoded into the tab bar, and portaled into a slot there) both got
// rejected because sharing `.dashboard-tabs`' row/border-bottom reads as
// "part of the tabs" regardless of how it's wired up. This way nothing
// outside this component is touched.
export default function CostCalculatorTab({ game, onUpdate, color }) {
  const t = useT();
  const r = useRoster(game, onUpdate);
  const [manageOpen, setManageOpen] = useState(false);

  if (!r.config) return null;

  if (r.displayed.length === 0 && r.candidates.length === 0) {
    return (
      <div className="teams-tab">
        <p className="teams-empty">{t('No pull data yet for this game.')}</p>
      </div>
    );
  }

  return (
    <div className="teams-tab">
      <button type="button" className="teams-manage-btn" onClick={() => setManageOpen(true)}>
        <Settings2 size={12} /> {t('Manage')}
      </button>
      <div className="teams-columns">
        {[...r.groups.entries()].filter(([, chars]) => chars.length > 0).map(([element, chars]) => (
          <ElementGroup key={element} element={element} chars={chars} linkedDatabase={r.linkedDatabase} roster={r.roster} config={r.config} />
        ))}
        {r.other.length > 0 && (
          <ElementGroup element={null} chars={r.other} linkedDatabase={r.linkedDatabase} roster={r.roster} config={r.config} color={color} label={t('Other')} />
        )}
      </div>
      {manageOpen && <RosterManageModal r={r} onClose={() => setManageOpen(false)} />}
    </div>
  );
}

function ElementGroup({ element, chars, linkedDatabase, roster, config, color, label }) {
  const groupColor = element ? config.elementColors[element] : color;
  const icon = element && config.elementIcons ? config.elementIcons[element] : null;
  return (
    <div className="teams-group">
      <h3 className="teams-group-title" title={label ?? element} style={!icon ? { color: groupColor } : undefined}>
        {icon
          ? <img className="teams-group-icon" src={icon} alt={element} draggable={false} />
          : (label ?? element)}
      </h3>
      <div className="teams-grid">
        {chars.map(char => (
          <TeamsCharacter key={char.name} name={char.name} rarity={char.rarity} constellation={computeConstellation(char.count)}
            linkedDatabase={linkedDatabase} roster={roster} color={groupColor} />
        ))}
      </div>
    </div>
  );
}

// Badge color follows the app's existing rarity convention (see
// HistoryTab.js's RARITY_COLORS): gold for 5-star/S-rank, purple for 4-star.
const BADGE_COLORS = { 5: { bg: '#eab942', fg: '#3a2a00' }, 4: { bg: '#9573c8', fg: '#1f1430' } };

function TeamsCharacter({ name, rarity, constellation, linkedDatabase, roster, color }) {
  const [portrait, setPortrait] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const id = resolveId(name, roster.characters);
    fetchBannerImage(linkedDatabase, id).then(img => { if (!cancelled) setPortrait(img); });
    return () => { cancelled = true; };
  }, [name, linkedDatabase, roster]);

  const badge = BADGE_COLORS[rarity] ?? BADGE_COLORS[5];

  return (
    <div className="teams-character" style={{ '--elem-color': color }}>
      <div className="teams-portrait">
        {portrait
          ? <img src={portrait} alt={name} draggable={false} />
          : <div className="teams-portrait-empty" />}
        <span className="teams-constellation-badge" style={{ background: badge.bg, color: badge.fg }}>{constellation}</span>
      </div>
      <span className="teams-name">{name}</span>
    </div>
  );
}
