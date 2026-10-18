import React from 'react';
import { resolveGameCurrency } from '../../engine/gameSchema';
import { ResourceCard, PullItemsStepper, IncomeRow, DailyPassRow } from '../../components/StatusFields';
import { useT } from '../../../../shared/i18n';
import { canClaimDailyPass } from '../../engine/pullUtils';
import { getBalances, applyDeltas, setBalance, spendCarats, UMA_RESET } from './umamusumeLedger';

// Daily login: 75 Free Carats, +50 Free Carats while the Daily Pass is active
// (amounts from the user). Paid Carats are manual-only — there's no way to
// know what was bought. The claim gating reuses the shared daily reset
// (engine/pullUtils.js canClaimDailyPass), which is 05:00 Europe/Vienna —
// chosen for the other games, NOT confirmed as Umamusume's reset time.
const DAILY_BASE_CARATS = 75;
const DAILY_PASS_BONUS_CARATS = 50;

// Four separately tracked values (see umamusumeLedger.js): Free Carats and
// Paid Carats are two currencies whose SUM is the carat total used for pull
// planning; Trainee and Support Card Scout Tickets are two non-fungible pull
// items. Every change goes through the ledger helper so the day-by-day
// history and the combined `state.currency` stay in sync.
export default function UmamusumeStatusTab({ game, onUpdate, color }) {
  const t = useT();
  const { state, charBanner } = game;
  const costPerPull = charBanner.costPerPull;
  const { pullItemName: traineeLabel, weaponPullItemName: supportLabel } = resolveGameCurrency(game);

  const { free, paid, trainee, support } = getBalances(state);
  const totalCarats = free + paid;
  const affordablePulls = Math.floor(totalCarats / costPerPull);
  const traineeTotalPulls = affordablePulls + trainee;
  const supportTotalPulls = affordablePulls + support;

  const apply = next => onUpdate({ ...game, state: next });

  const dailyAmount = DAILY_BASE_CARATS + (state.dailyPassActive ? DAILY_PASS_BONUS_CARATS : 0);
  const dailyClaimable = canClaimDailyPass(state.dailyPassLastClaimedAt, new Date(), UMA_RESET);

  function claimDaily() {
    if (!canClaimDailyPass(state.dailyPassLastClaimedAt, new Date(), UMA_RESET)) return; // button is disabled too; this is defense in depth
    apply({ ...applyDeltas(state, { free: dailyAmount }), dailyPassLastClaimedAt: new Date().toISOString() });
  }

  const freeLabel = t('Free Carats');
  const paidLabel = t('Paid Carats');
  const tLabel = traineeLabel || t('Trainee Scout Ticket');
  const sLabel = supportLabel || t('Support Card Scout Ticket');

  return (
    <div className="status-tab">
      <div className="status-section">
        <p className="section-title">{t('Current Resources')}</p>
        <div className="resources-grid">
          <ResourceCard label={freeLabel} value={free} sub={`${Math.floor(free / costPerPull)} ${t('pulls')}`}
            color={color} onSet={v => apply(setBalance(state, 'free', v))} isInt />
          <ResourceCard label={paidLabel} value={paid} sub={`${Math.floor(paid / costPerPull)} ${t('pulls')}`}
            color={color} onSet={v => apply(setBalance(state, 'paid', v))} isInt />
          <ResourceCard label={tLabel} value={trainee} sub={`${traineeTotalPulls} ${t('trainee pulls')}`}
            color={color} onSet={v => apply(setBalance(state, 'trainee', v))} isInt />
          <ResourceCard label={sLabel} value={support} sub={`${supportTotalPulls} ${t('support card pulls')}`}
            color={color} onSet={v => apply(setBalance(state, 'support', v))} isInt />
        </div>
        <div className="total-bar">
          <div className="total-bar-item">
            <span className="total-bar-label">{t('Total Carats')}</span>
            <span className="total-bar-value" style={{ color }}>{totalCarats.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--center">
            <span className="total-bar-label">{t('Trainee pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{traineeTotalPulls.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--right">
            <span className="total-bar-label">{t('Support Card pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{supportTotalPulls.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="status-section">
        <p className="section-title">{t('Add Income')}</p>
        <div className="income-panel">
          <div className="income-panel-row">
            <DailyPassRow
              label={t('Daily Pass')}
              amount={dailyAmount}
              active={state.dailyPassActive ?? false}
              claimable={dailyClaimable}
              onToggleActive={() => onUpdate({ ...game, state: { ...state, dailyPassActive: !state.dailyPassActive } })}
              onClaim={claimDaily}
              color={color}
            />
          </div>
          <div className="income-panel-sep-h" />
          <div className="income-panel-row">
            <IncomeRow label={freeLabel} color={color} isInt
              onAdd={amount => apply(applyDeltas(state, { free: amount }))} />
          </div>
          <div className="income-panel-sep-h" />
          <div className="income-panel-row">
            <IncomeRow label={paidLabel} color={color} isInt
              onAdd={amount => apply(applyDeltas(state, { paid: amount }))} />
          </div>
          <div className="income-panel-sep-h" />
          <div className="income-panel-row">
            <IncomeRow label={t('Spend Carats (Free first)')} color={color} isInt buttonLabel={t('Spend')}
              onAdd={amount => apply(spendCarats(state, Math.abs(amount)))} />
          </div>
          <div className="income-panel-sep-h" />
          <div className="income-panel-row">
            <PullItemsStepper label={tLabel} value={trainee} color={color}
              onStep={d => apply(applyDeltas(state, { trainee: d }))} />
            <div className="income-panel-sep" />
            <PullItemsStepper label={sLabel} value={support} color={color}
              onStep={d => apply(applyDeltas(state, { support: d }))} />
          </div>
        </div>
      </div>
    </div>
  );
}
