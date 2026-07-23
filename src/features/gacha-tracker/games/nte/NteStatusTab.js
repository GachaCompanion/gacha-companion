import React from 'react';
import { resolveGameCurrency, resolveDailyPass, DAILY_CLAIM_AMOUNT, DAILY_PASS_BONUS } from '../../engine/gameSchema';
import { ResourceCard, PullItemsStepper, IncomeRow, DailyPassRow } from '../../components/StatusFields';
import { useT } from '../../../../shared/i18n';
import { canClaimDailyPass, incrementTodayField, setTodayTotal } from '../../engine/pullUtils';

// NTE's Solid Dice (character) and Tri-Keys (arc) aren't interchangeable, so
// unlike the shared StatusTab (one currency + one pull-item pool), this tracks
// them as two separate pull-item counts against the same Annulith currency.
export default function NteStatusTab({ game, onUpdate, color }) {
  const t = useT();
  const { state, charBanner } = game;
  const costPerPull = charBanner.costPerPull;
  const { currencyName, pullItemName: diceLabel, weaponPullItemName: keyLabel } = resolveGameCurrency(game);

  const currency = state.currency ?? state.currentCurrency ?? 0;
  const charPullItems = state.charPullItems ?? 0;
  const weaponPullItems = state.weaponPullItems ?? 0;
  const affordablePulls = Math.floor(currency / costPerPull);
  const charTotalPulls = affordablePulls + charPullItems;
  const weaponTotalPulls = affordablePulls + weaponPullItems;

  const { name: dailyPassName } = resolveDailyPass(game);
  const dailyClaimAmount = DAILY_CLAIM_AMOUNT + (state.dailyPassActive ? DAILY_PASS_BONUS : 0);

  // History (the day-by-day ledger the shared HistoryTab/IncomeHistoryView
  // reads) tracks currency changes as 'income' and dice/key-item changes as
  // 'pulls' (both dice types share the one 'pulls' column — the ledger UI
  // only has a single pull-items column). 'total' is just the running
  // currency balance — unlike the shared StatusTab's genshin-style total
  // (currency + pullItems*costPerPull), NTE's two separate pull-item pools
  // both compete for the same currency rather than combining into one
  // affordable-pulls figure, so there's no single meaningful combined total
  // beyond the currency itself (matching what NTE's own Status tab already
  // treats as "the" total — see the total-bar above).
  function addIncome(amount) {
    const newCurrency = Math.max(0, currency + amount);
    const history = incrementTodayField(state.history ?? [], 'income', amount, newCurrency);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function toggleDailyPassActive() {
    onUpdate({ ...game, state: { ...state, dailyPassActive: !state.dailyPassActive } });
  }

  const dailyPassClaimable = canClaimDailyPass(state.dailyPassLastClaimedAt);

  function claimDailyPass() {
    if (!canClaimDailyPass(state.dailyPassLastClaimedAt)) return; // already claimed since the last reset — button should be disabled, this is defense in depth
    const newCurrency = Math.max(0, currency + dailyClaimAmount);
    const history = incrementTodayField(state.history ?? [], 'income', dailyClaimAmount, newCurrency);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history, dailyPassLastClaimedAt: new Date().toISOString() } });
  }

  function addCharPullItems(count) {
    const next = Math.max(0, charPullItems + count);
    const history = incrementTodayField(state.history ?? [], 'pulls', count, currency);
    onUpdate({ ...game, state: { ...state, charPullItems: next, history } });
  }

  function addWeaponPullItems(count) {
    const next = Math.max(0, weaponPullItems + count);
    const history = incrementTodayField(state.history ?? [], 'pulls', count, currency);
    onUpdate({ ...game, state: { ...state, weaponPullItems: next, history } });
  }

  function setCurrencyDirect(value) {
    const newCurrency = Math.max(0, value);
    const history = setTodayTotal(state.history ?? [], newCurrency);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function setCharPullItemsDirect(value) {
    onUpdate({ ...game, state: { ...state, charPullItems: Math.max(0, value) } });
  }

  function setWeaponPullItemsDirect(value) {
    onUpdate({ ...game, state: { ...state, weaponPullItems: Math.max(0, value) } });
  }

  const cLabel = currencyName || t('Pull Currency');
  const dLabel = diceLabel || t('Character Pull Items');
  const kLabel = keyLabel || t('Arc Pull Items');

  return (
    <div className="status-tab">
      <div className="status-section">
        <p className="section-title">{t('Current Resources')}</p>
        <div className="resources-grid resources-grid--triple">
          <ResourceCard
            label={cLabel}
            value={currency}
            sub={`${affordablePulls} ${t('pulls')}`}
            color={color}
            onSet={setCurrencyDirect}
          />
          <ResourceCard
            label={dLabel}
            value={charPullItems}
            sub={`${charTotalPulls} ${t('character pulls')}`}
            color={color}
            onSet={setCharPullItemsDirect}
            isInt
          />
          <ResourceCard
            label={kLabel}
            value={weaponPullItems}
            sub={`${weaponTotalPulls} ${t('arc pulls')}`}
            color={color}
            onSet={setWeaponPullItemsDirect}
            isInt
          />
        </div>
        <div className="total-bar">
          <div className="total-bar-item">
            <span className="total-bar-label">{t('Total')} {cLabel}</span>
            <span className="total-bar-value" style={{ color }}>{currency.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--center">
            <span className="total-bar-label">{t('Character pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{charTotalPulls.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--right">
            <span className="total-bar-label">{t('Arc pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{weaponTotalPulls.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="status-section">
        <p className="section-title">{t('Add Income')}</p>
        <div className="income-panel">
          <div className="income-panel-row">
            <IncomeRow
              label={cLabel}
              color={color}
              onAdd={addIncome}
            />
            <div className="income-panel-sep" />
            <div className="income-panel-right">
              <PullItemsStepper
                label={dLabel}
                value={charPullItems}
                color={color}
                onStep={addCharPullItems}
              />
              <div className="income-panel-sep" />
              <PullItemsStepper
                label={kLabel}
                value={weaponPullItems}
                color={color}
                onStep={addWeaponPullItems}
              />
            </div>
          </div>
          {dailyPassName && (
            <>
              <div className="income-panel-sep-h" />
              <div className="income-panel-row">
                <DailyPassRow
                  label={dailyPassName}
                  amount={dailyClaimAmount}
                  active={state.dailyPassActive ?? false}
                  claimable={dailyPassClaimable}
                  onToggleActive={toggleDailyPassActive}
                  onClaim={claimDailyPass}
                  color={color}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
