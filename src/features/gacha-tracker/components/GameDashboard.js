import React, { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import PullCalculator from './PullCalculator';
import GenshinCalculator from '../games/genshin/GenshinCalculator';
import HSRCalculator from '../games/hsr/HSRCalculator';
import ZZZCalculator from '../games/zzz/ZZZCalculator';
import NTECalculator from '../games/nte/NTECalculator';
import WuwaCalculator from '../games/wuwa/WuwaCalculator';
import HistoryTab, { PullLogView } from './HistoryTab';
import NtePullLogTab from '../games/nte/NtePullLogTab';
import NteStatusTab from '../games/nte/NteStatusTab';
import WuwaStatusTab from '../games/wuwa/WuwaStatusTab';
import WishListTab from './WishListTab';
import NteWishListTab from '../games/nte/NteWishListTab';
import { ResourceCard, PullItemsStepper, IncomeRow, DailyPassRow } from './StatusFields';
import { useAccent } from '../../../shared/contexts/AccentContext';
import { useTheme } from '../../../shared/contexts/ThemeContext';
import { useT } from '../../../shared/i18n';
import { clampColorForTheme } from '../../../shared/utils/color';
import { resolveGameCurrency, resolveDailyPass, DAILY_CLAIM_AMOUNT, DAILY_PASS_BONUS } from '../engine/gameSchema';
import { canClaimDailyPass, setTodayTotal, incrementTodayField } from '../engine/pullUtils';
import './GameDashboard.css';
import { ScrollArea } from '../../../shared/components/ScrollArea';

function resolveColor(game, accentColor, activeTheme) {
  const raw = game.usesAppColor ? accentColor : game.color;
  return clampColorForTheme(raw, activeTheme === 'dark');
}

export function getCurrency(state) {
  return state.currency ?? state.currentCurrency ?? 0;
}

function getTotal(currency, pullItems, costPerPull) {
  return currency + pullItems * costPerPull;
}

export default function GameDashboard({ game, onUpdate, onOpenSettings, bannerPanelWidths, bannerSchedule }) {
  const t = useT();
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const [tab, setTab] = useState('status');

  // ── Settings hint animation (pulsating border on the Game Settings button) ──
  // Triggered when user hovers over a missing-file indicator in HistoryTab.
  const hintBorderRef  = useRef(null);
  const hintTimerRef   = useRef(null);
  const hintPhaseRef   = useRef('idle');   // 'idle' | 'waiting' | 'active' | 'fading'
  const hintCountRef   = useRef(0);        // number of concurrent hover sources

  function startHintAnimation() {
    const el = hintBorderRef.current;
    if (!el) return;
    // Cancel any in-progress fade-out, reset to clean state
    clearTimeout(hintTimerRef.current);
    el.style.transition = '';
    el.style.opacity    = '';
    el.classList.remove('active');

    hintPhaseRef.current = 'waiting';
    hintTimerRef.current = setTimeout(() => {
      if (hintPhaseRef.current !== 'waiting') return;
      hintPhaseRef.current = 'active';
      if (hintBorderRef.current) hintBorderRef.current.classList.add('active');
    }, 500);
  }

  function stopHintAnimation() {
    clearTimeout(hintTimerRef.current);
    const el = hintBorderRef.current;
    if (!el) { hintPhaseRef.current = 'idle'; return; }

    if (hintPhaseRef.current === 'active') {
      // Capture the current animated opacity and start a 0.3s fade to zero
      const curOpacity = parseFloat(getComputedStyle(el).opacity) || 0;
      el.classList.remove('active');
      el.style.opacity    = String(curOpacity);
      el.getBoundingClientRect(); // force reflow so the transition starts from curOpacity
      el.style.transition = 'opacity 0.3s ease-out';
      el.style.opacity    = '0';
      hintPhaseRef.current = 'fading';
      hintTimerRef.current = setTimeout(() => {
        if (hintPhaseRef.current === 'fading' && hintBorderRef.current) {
          hintBorderRef.current.style.transition = '';
          hintBorderRef.current.style.opacity    = '';
          hintPhaseRef.current = 'idle';
        }
      }, 350);
    } else {
      hintPhaseRef.current = 'idle';
    }
  }

  // When the import state changes (e.g. Excel is uploaded and disabled banner cards
  // are removed from the DOM), mouseLeave events won't fire for the removed elements,
  // leaving hintCountRef stuck at > 0. Reset everything when the flags change.
  useEffect(() => {
    hintCountRef.current = 0;
    clearTimeout(hintTimerRef.current);
    const el = hintBorderRef.current;
    if (el) {
      el.classList.remove('active');
      el.style.transition = '';
      el.style.opacity    = '';
    }
    hintPhaseRef.current = 'idle';
  }, [game.state.excelImported, game.state.jsonImported]);

  // Multiple banner cards can each trigger enter/leave — track count to avoid
  // stopping the animation prematurely when moving between cards.
  function onSettingsHintEnter() {
    hintCountRef.current++;
    if (hintCountRef.current === 1) startHintAnimation();
  }

  function onSettingsHintLeave() {
    hintCountRef.current = Math.max(0, hintCountRef.current - 1);
    if (hintCountRef.current === 0) stopHintAnimation();
  }
  const { state, charBanner, weaponBanner } = game;
  const color = resolveColor(game, accentColor, activeTheme);
  const costPerPull = charBanner.costPerPull;
  const { currencyName, pullItemName } = resolveGameCurrency(game);

  const currency = getCurrency(state);
  const pullItems = state.pullItems ?? 0;
  const total = getTotal(currency, pullItems, costPerPull);
  const totalPulls = Math.floor(total / costPerPull);

  function addIncome(amount) {
    const newCurrency = Math.max(0, currency + amount);
    const newTotal = getTotal(newCurrency, pullItems, costPerPull);
    const history = incrementTodayField(state.history ?? [], 'income', amount, newTotal);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function addPullItems(count) {
    const newPullItems = Math.max(0, pullItems + count);
    const newTotal = getTotal(currency, newPullItems, costPerPull);
    const history = incrementTodayField(state.history ?? [], 'pulls', count, newTotal);
    onUpdate({ ...game, state: { ...state, pullItems: newPullItems, history } });
  }

  function setCurrencyDirect(value) {
    const newCurrency = Math.max(0, value);
    const newTotal = getTotal(newCurrency, pullItems, costPerPull);
    const history = setTodayTotal(state.history ?? [], newTotal);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history } });
  }

  function setPullItemsDirect(value) {
    const newPullItems = Math.max(0, value);
    const newTotal = getTotal(currency, newPullItems, costPerPull);
    const history = setTodayTotal(state.history ?? [], newTotal);
    onUpdate({ ...game, state: { ...state, pullItems: newPullItems, history } });
  }

  const { name: dailyPassName } = resolveDailyPass(game);
  const dailyClaimAmount = DAILY_CLAIM_AMOUNT + (state.dailyPassActive ? DAILY_PASS_BONUS : 0);

  function toggleDailyPassActive() {
    onUpdate({ ...game, state: { ...state, dailyPassActive: !state.dailyPassActive } });
  }

  const dailyPassClaimable = canClaimDailyPass(state.dailyPassLastClaimedAt);

  function claimDailyPass() {
    if (!canClaimDailyPass(state.dailyPassLastClaimedAt)) return; // already claimed since the last reset — button should be disabled, this is defense in depth
    const newCurrency = Math.max(0, currency + dailyClaimAmount);
    const newTotal = getTotal(newCurrency, pullItems, costPerPull);
    const history = incrementTodayField(state.history ?? [], 'income', dailyClaimAmount, newTotal);
    onUpdate({ ...game, state: { ...state, currency: newCurrency, history, dailyPassLastClaimedAt: new Date().toISOString() } });
  }

  const TABS = [
    ['status', t('Status')],
    ['history', t('History')],
    ...(game.linkedDatabase ? [['pulllog', t('Pull Log')]] : []),
    ['wishlist', t('Wish List')],
    ['calculator', t('Calculator')],
  ];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="dashboard-title-row">
          <div className="dashboard-icon" style={{ background: game.iconPath ? 'transparent' : color }}>
            {game.iconPath
              ? <img src={game.iconPath} alt={game.name} className="dashboard-icon-img" />
              : game.name[0]?.toUpperCase()
            }
          </div>
          <h1 className="dashboard-title">{game.name}</h1>
          <button className="dashboard-settings-btn" onClick={onOpenSettings} title="Game Settings">
            {/* Pulsating hint border — shown when a file import is needed */}
            <span ref={hintBorderRef} className="dashboard-settings-hint-border" />
            <Pencil size={15} />
            <span className="dashboard-settings-label">Game Settings</span>
          </button>
        </div>
        <div
          className="dashboard-tabs"
          style={{
            borderBottomColor: color + '44',
            '--tab-color': color,
          }}
        >
          {TABS.map(([key, label]) => (
            <button key={key}
              className={`dashboard-tab ${tab === key ? 'dashboard-tab--active' : ''}`}
              style={tab === key ? { borderBottomColor: color, color } : {}}
              onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} viewportClassName="dashboard-content">
        {tab === 'status' && (
          game.linkedDatabase === 'nte' ? (
            <NteStatusTab game={game} onUpdate={onUpdate} color={color} />
          ) : game.linkedDatabase === 'wuwa' ? (
            <WuwaStatusTab game={game} onUpdate={onUpdate} color={color} />
          ) : (
            <StatusTab
              game={game} charBanner={charBanner}
              currencyName={currencyName} pullItemName={pullItemName}
              currency={currency} pullItems={pullItems} total={total} totalPulls={totalPulls}
              color={color} costPerPull={costPerPull}
              onAddIncome={addIncome}
              onAddPullItems={addPullItems}
              onSetCurrency={setCurrencyDirect}
              onSetPullItems={setPullItemsDirect}
              dailyPassName={dailyPassName}
              dailyClaimAmount={dailyClaimAmount}
              dailyPassActive={state.dailyPassActive ?? false}
              dailyPassClaimable={dailyPassClaimable}
              onToggleDailyPass={toggleDailyPassActive}
              onClaimDailyPass={claimDailyPass}
            />
          )
        )}
        {tab === 'history' && (
          <HistoryTab game={game} onUpdate={onUpdate} color={color} />
        )}
        {game.linkedDatabase && (
          <div style={{ display: tab !== 'pulllog' ? 'none' : 'contents' }}>
            {game.linkedDatabase === 'nte' ? (
              <NtePullLogTab game={game} color={color} prefetchedSchedule={bannerSchedule} />
            ) : (
              <div className="history-tab history-tab--pulls">
                <PullLogView
                  key={game.id}
                  game={game}
                  onUpdate={onUpdate}
                  color={color ?? 'var(--accent)'}
                  bannerPanelWidths={bannerPanelWidths}
                  prefetchedSchedule={bannerSchedule}
                  onSettingsHintEnter={onSettingsHintEnter}
                  onSettingsHintLeave={onSettingsHintLeave}
                />
              </div>
            )}
          </div>
        )}
        {tab === 'wishlist' && (
          game.linkedDatabase === 'nte' ? (
            <NteWishListTab game={game} onUpdate={onUpdate} color={color} />
          ) : (
            <WishListTab game={game} onUpdate={onUpdate} color={color} />
          )
        )}
        {tab === 'calculator' && (
          game.linkedDatabase === 'genshin'
            ? <GenshinCalculator game={game} color={color} />
            : game.linkedDatabase === 'hsr'
              ? <HSRCalculator game={game} color={color} />
              : game.linkedDatabase === 'zzz'
                ? <ZZZCalculator game={game} color={color} />
                : game.linkedDatabase === 'nte'
                  ? <NTECalculator game={game} color={color} />
                  : game.linkedDatabase === 'wuwa'
                    ? <WuwaCalculator game={game} color={color} />
                    : <PullCalculator game={game} color={color} />
        )}
      </ScrollArea>
    </div>
  );
}

function StatusTab({
  game, charBanner, currencyName, pullItemName, currency, pullItems, total, totalPulls, color, costPerPull,
  onAddIncome, onAddPullItems, onSetCurrency, onSetPullItems,
  dailyPassName, dailyClaimAmount, dailyPassActive, dailyPassClaimable, onToggleDailyPass, onClaimDailyPass,
}) {
  const t = useT();
  const cLabel = currencyName || t('Pull Currency');
  const pLabel = pullItemName || t('Pull Items');
  return (
    <div className="status-tab">
      <div className="status-section">
        <p className="section-title">{t('Current Resources')}</p>
        <div className="resources-grid">
          <ResourceCard
            label={cLabel}
            value={currency}
            sub={`${Math.floor(currency / costPerPull)} ${t('pulls')}`}
            color={color}
            onSet={onSetCurrency}
          />
          <ResourceCard
            label={pLabel}
            value={pullItems}
            sub={`${pullItems} ${t('pulls')}`}
            color={color}
            onSet={onSetPullItems}
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
            <span className="total-bar-label">{t('Total')} {pLabel}</span>
            <span className="total-bar-value" style={{ color }}>{pullItems.toLocaleString()}</span>
          </div>
          <div className="total-bar-sep" />
          <div className="total-bar-item total-bar-item--right">
            <span className="total-bar-label">{t('Total pulls')}</span>
            <span className="total-bar-value" style={{ color }}>{totalPulls.toLocaleString()}</span>
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
              onAdd={onAddIncome}
            />
            <div className="income-panel-sep" />
            <div className="income-panel-right">
              <PullItemsStepper
                label={pLabel}
                value={pullItems}
                color={color}
                onStep={onAddPullItems}
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
                  active={dailyPassActive}
                  claimable={dailyPassClaimable}
                  onToggleActive={onToggleDailyPass}
                  onClaim={onClaimDailyPass}
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

