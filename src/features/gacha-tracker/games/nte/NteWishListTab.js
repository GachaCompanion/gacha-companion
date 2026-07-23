import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { simulateCombined, pullsAtProbability, computeCombinedExact, pullsAtProbabilityFromCdf } from '../../engine/simulation';
import { resolveGameLabels } from '../../engine/gameSchema';
import {
  PityCard, PityBar, CopiesInput, ProbSnapper,
} from '../../components/WishListTab';
import ConfirmDialog from '../../../../shared/components/ConfirmDialog';
import { useT } from '../../../../shared/i18n';
import '../../components/WishListTab.css';

const PROB_SNAPS = [0, 0.15, 0.25, 0.50, 0.75, 0.99, 1.00];
const PROB_LABELS = ['0%', '15%', '25%', '50%', '75%', '99%', '100%'];
const RUNS = 10_000;

// Solid Dice and Tri-Keys aren't fungible with each other, but Annulith
// currency IS fungible with both until converted — so the combined total
// pool for a wishlist goal (which sums char + arc draws needed) is the
// currency-derived pulls plus whatever of each item is already held.
function totalPullsFromGame(game) {
  const currency = game.state.currency ?? 0;
  const charPullItems = game.state.charPullItems ?? 0;
  const weaponPullItems = game.state.weaponPullItems ?? 0;
  const costPerPull = game.charBanner.costPerPull;
  return Math.floor(currency / costPerPull) + charPullItems + weaponPullItems;
}

export default function NteWishListTab({ game, onUpdate, color }) {
  const t = useT();
  const { state, charBanner, weaponBanner } = game;
  const wishList = state.wishList ?? [];
  const totalPulls = totalPullsFromGame(game);

  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const confirmEntry = wishList.find(e => e.id === confirmRemoveId);

  function updateState(patch) {
    onUpdate({ ...game, state: { ...state, ...patch } });
  }

  function updateWishList(newList) {
    onUpdate({ ...game, state: { ...state, wishList: newList } });
  }

  function addEntry() {
    updateWishList([...wishList, {
      id: crypto.randomUUID(),
      label: '',
      charCopies: 0,
      weaponCopies: 0,
      probability: 0.50,
    }]);
  }

  function confirmRemove(id) { setConfirmRemoveId(id); }
  function doRemove() {
    updateWishList(wishList.filter(e => e.id !== confirmRemoveId));
    setConfirmRemoveId(null);
  }

  function patchEntry(id, patch) {
    updateWishList(wishList.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  const { charCopyLabel: charLabel, weaponCopyLabel: weaponLabel } = resolveGameLabels(game);

  return (
    <div className="wishlist-tab">

      {/* Banner pity sections */}
      <div className="wl-banner-section">
        <p className="section-title">{t('Character Banner')}</p>
        <div className="pity-row">
          <PityCard label={t('Pity')} value={state.charPity} max={charBanner.hardPity} color={color}
            onEdit={v => updateState({ charPity: Math.min(charBanner.hardPity - 1, Math.max(0, v)) })} />
        </div>
        <PityBar current={state.charPity} soft={charBanner.softPity} hard={charBanner.hardPity} color={color} />
      </div>

      <div className="wl-banner-section">
        <p className="section-title">{t('Arc Banner')}</p>
        <div className="pity-row">
          <PityCard label={t('Pity')} value={state.weaponPity} max={weaponBanner.hardPity} color={color}
            onEdit={v => updateState({ weaponPity: Math.min(weaponBanner.hardPity - 1, Math.max(0, v)) })} />
          {/* No Guaranteed toggle — Arc banner losses don't carry a
              guarantee into the next S-Class pull. */}
        </div>
        <PityBar current={state.weaponPity} soft={weaponBanner.softPity} hard={weaponBanner.hardPity} color={color} />
      </div>

      {/* Labels bar + Add goal (right-aligned) */}
      <div className="wishlist-labels-bar">
        <div className="wishlist-labels-group">
          <span className="wishlist-labels-hint">{t('Labels')}</span>
          <span className="wishlist-labels-hint">{charLabel} · {weaponLabel}</span>
        </div>
        <button className="wishlist-add-btn" onClick={addEntry}>
          <Plus size={14} /> {t('Add goal')}
        </button>
      </div>

      {/* Column header */}
      {wishList.length > 0 && (
        <div className="wishlist-header-row">
          <div className="wishlist-col-label">{t('Goal')}</div>
          <div className="wishlist-col-copies">{charLabel}</div>
          <div className="wishlist-col-copies">{weaponLabel}</div>
          <div className="wishlist-col-prob-snap">{t('Probability')}</div>
          <div className="wishlist-col-pulls">{t('Pulls Needed')}</div>
          <div className="wishlist-col-pulls">{t('Pulls Left')}</div>
          <div className="wishlist-col-del" />
        </div>
      )}

      {/* Entries */}
      <div className="wishlist-entries">
        {wishList.map(entry => (
          <WishListEntry
            key={entry.id}
            entry={entry}
            game={game}
            charLabel={charLabel}
            weaponLabel={weaponLabel}
            totalPulls={totalPulls}
            color={color}
            onPatch={patch => patchEntry(entry.id, patch)}
            onRemove={() => confirmRemove(entry.id)}
          />
        ))}
      </div>

      {confirmEntry && (
        <ConfirmDialog
          title={t('Remove goal?')}
          message={`"${confirmEntry.label || t('Unnamed')}" ${t('will be removed from your wish list.')}`}
          confirmLabel={t('Remove')} danger
          onConfirm={doRemove}
          onCancel={() => setConfirmRemoveId(null)}
        />
      )}
    </div>
  );
}

function WishListEntry({ entry, game, totalPulls, color, onPatch, onRemove }) {
  const t = useT();
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(entry.label || '');

  const probability = entry.probability ?? 0.50;
  const probIdx = PROB_SNAPS.indexOf(probability);
  const safeProbIdx = probIdx === -1 ? 3 : probIdx;

  const hasTarget = entry.charCopies > 0 || entry.weaponCopies > 0;

  // Exact math instead of a Monte Carlo simulation — see WishListTab.js's
  // WishListEntry for the full rationale. NTE's char banner has has5050:false,
  // which computeCombinedExact already handles (plain 5★ pmf, no featured split).
  let pullsNeeded = null;
  if (hasTarget) {
    const cdf = computeCombinedExact({
      charBanner: game.charBanner,
      weaponBanner: game.weaponBanner,
      charCopies: entry.charCopies,
      weaponCopies: entry.weaponCopies,
      startCharPity: game.state.charPity ?? 0,
      startCharGuaranteed: false,
      startWeaponPity: game.state.weaponPity ?? 0,
      startWeaponGuaranteed: false,
    });
    if (cdf) {
      pullsNeeded = pullsAtProbabilityFromCdf(cdf, probability);
    } else {
      const sorted = simulateCombined({
        charBanner: game.charBanner,
        weaponBanner: game.weaponBanner,
        charCopies: entry.charCopies,
        weaponCopies: entry.weaponCopies,
        startCharPity: game.state.charPity ?? 0,
        startCharGuaranteed: false,
        startWeaponPity: game.state.weaponPity ?? 0,
        startWeaponGuaranteed: false,
        runs: RUNS,
      });
      pullsNeeded = pullsAtProbability(sorted, probability);
    }
  }
  const pullsLeft = pullsNeeded !== null ? Math.max(0, totalPulls - pullsNeeded) : null;

  function commitLabel() {
    if (labelDraft.trim()) onPatch({ label: labelDraft.trim() });
    setEditingLabel(false);
  }

  return (
    <div className="wishlist-entry">
      <div className="wishlist-col-label">
        {editingLabel ? (
          <input className="wishlist-entry-label-input" placeholder={t('Goal name…')}
            value={labelDraft} onChange={e => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={e => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') setEditingLabel(false); }}
            autoFocus />
        ) : (
          <button className="wishlist-entry-label-btn"
            onClick={() => { setLabelDraft(entry.label); setEditingLabel(true); }}>
            {entry.label || <span className="wishlist-entry-label-empty">{t('Unnamed')}</span>}
          </button>
        )}
      </div>

      <div className="wishlist-col-copies">
        <CopiesInput value={entry.charCopies} onChange={v => onPatch({ charCopies: v })} color={color} />
      </div>

      <div className="wishlist-col-copies">
        <CopiesInput value={entry.weaponCopies} onChange={v => onPatch({ weaponCopies: v })} color={color} />
      </div>

      <div className="wishlist-col-prob-snap">
        <ProbSnapper idx={safeProbIdx} onChange={i => onPatch({ probability: PROB_SNAPS[i] })} color={color} />
      </div>

      <div className="wishlist-col-pulls">
        {pullsNeeded !== null ? <span className="wishlist-pulls-value" style={{ color }}>{pullsNeeded}</span>
          : <span className="wishlist-pulls-empty">—</span>}
      </div>

      <div className="wishlist-col-pulls">
        {pullsLeft !== null
            ? <span className={`wishlist-pulls-value ${pullsLeft === 0 ? 'wishlist-pulls-zero' : ''}`}
                style={pullsLeft > 0 ? { color } : {}}>{pullsLeft}</span>
            : <span className="wishlist-pulls-empty">—</span>}
      </div>

      <div className="wishlist-col-del">
        <button className="wishlist-del-btn" onClick={onRemove} title={t('Remove')}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
