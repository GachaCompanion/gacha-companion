import React, { useState, useRef, useEffect } from 'react';
import { Home, Camera } from 'lucide-react';
import DiamondIcon from '../../shared/components/DiamondIcon';
import { resolveGameLabels, resolveGameCurrency } from '../gacha-tracker/engine/gameSchema';
import { canClaimDailyPass } from '../gacha-tracker/engine/pullUtils';
import { useT } from '../../shared/i18n';
import './Overview.css';

import genshinPrimogem from '../../assets/currencies/genshin/primogem.png';
import genshinIntertwinedFate from '../../assets/currencies/genshin/intertwined-fate.png';
import hsrStellarJade from '../../assets/currencies/hsr/stellar-jade.png';
import hsrSpecialPass from '../../assets/currencies/hsr/star-rail-special-pass.png';
import zzzPolychrome from '../../assets/currencies/zzz/polychrome.png';
import zzzEncryptedMasterTape from '../../assets/currencies/zzz/encrypted-master-tape.png';
import nteAnnulith from '../../assets/currencies/nte/annulith.png';
import nteSolidDice from '../../assets/currencies/nte/solid-dice.png';
import nteTriKey from '../../assets/currencies/nte/tri-key.png';
import wuwaAstrite from '../../assets/currencies/wuwa/astrite.png';
import wuwaRadiantTide from '../../assets/currencies/wuwa/radiant-tide.png';
import wuwaForgingTide from '../../assets/currencies/wuwa/forging-tide.png';

// Per-database currency/pull-item icons — keyed the same way as
// DB_CURRENCY_OVERRIDES in gameSchema.js, since these images map 1:1 to
// those entries. Unlinked/custom games have no icon, so CarouselCard falls
// back to showing the text name for those instead.
const CURRENCY_ICONS = {
  genshin: { currency: genshinPrimogem, pullItem: genshinIntertwinedFate },
  hsr:     { currency: hsrStellarJade,  pullItem: hsrSpecialPass },
  zzz:     { currency: zzzPolychrome,   pullItem: zzzEncryptedMasterTape },
  nte:     { currency: nteAnnulith,     pullItem: nteSolidDice,   weaponPullItem: nteTriKey },
  wuwa:    { currency: wuwaAstrite,     pullItem: wuwaRadiantTide, weaponPullItem: wuwaForgingTide },
};

const CARDS_PER_ROW = 5;
const CARD_HEIGHT = 320; // matches .overview-carousel-card's height in Overview.css
// Must exceed the 40px edge-fade inset (see .overview-carousel-grid) — otherwise
// the next row's top edge lands inside the fade zone even at rest and shows
// through instead of being fully hidden until it's actually being scrolled to.
const ROW_GAP = 48;      // matches .overview-carousel-grid's gap in Overview.css
const ROW_STEP = CARD_HEIGHT + ROW_GAP; // vertical distance between consecutive rows' snap points

const FLIP_DURATION_MS = 550; // matches .overview-carousel-flip's animation-duration in Overview.css

// null (no data yet — unlinked/custom game, or a linked game with an empty
// pull log) reads as an em dash rather than 0/0% — those would misleadingly
// imply "computed, and the answer is zero" instead of "nothing to compute".
function formatPity(avg) {
  return avg == null ? '—' : avg.toFixed(1);
}
function formatRate(rate) {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

// Rows are chunked in JS (not a CSS grid auto-wrapping) so each row is its
// own scroll-snap target — the scrollable viewport is exactly ONE row
// tall, so whichever row is currently snapped into view is the only thing
// showing, and since that box itself is centered by .overview-carousel's
// justify-content:center, the visible row is always vertically centered
// too, no matter how many rows exist above/below it.
function chunkIntoRows(games) {
  const rows = [];
  for (let i = 0; i < games.length; i += CARDS_PER_ROW) rows.push(games.slice(i, i + CARDS_PER_ROW));
  return rows;
}

export default function OverviewCarousel({ games, onBack, onShowcase, onTracker }) {
  const t = useT();
  const [activeRow, setActiveRow] = useState(0);
  // Only masked (top/bottom fade) while actually scrolling — at rest the
  // mask has no reveal-gap headroom (a card's own edge sits exactly where
  // the fade begins), so a card's flip "lift" animation would cross into
  // the fade zone and visibly fade out mid-flip. Turning the mask off at
  // rest sidesteps that entirely instead of trying to carve out headroom.
  const [scrolling, setScrolling] = useState(false);
  const scrollRef = useRef(null);
  const scrollEndTimer = useRef(null);

  const rows = chunkIntoRows(games);

  function handleScroll(e) {
    setActiveRow(Math.round(e.target.scrollTop / ROW_STEP));
    setScrolling(true);
    clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => setScrolling(false), 200);
  }

  function scrollToRow(row) {
    scrollRef.current?.scrollTo({ top: row * ROW_STEP, behavior: 'smooth' });
  }

  // { row, version } rather than a plain counter — CarouselCard only acts
  // when its own rowIndex matches, so "Flip All" only ever reaches the
  // currently-visible (active/on-screen) row's cards, never ones scrolled
  // out of view. version (not a boolean) so a second click on the same
  // row still registers as a new request even though `row` didn't change.
  const [flipAllRequest, setFlipAllRequest] = useState({ row: -1, version: 0 });
  function handleFlipAll() {
    setFlipAllRequest({ row: activeRow, version: Date.now() });
  }

  return (
    <div className="overview-carousel">
      <div className="overview-carousel-nav">
        <button className="overview-carousel-back" onClick={onShowcase} title={t('Showcase')}>
          <Camera size={24} />
        </button>
        <button className="overview-carousel-back overview-carousel-back--home" onClick={onBack} title={t('Home')}>
          <Home size={24} />
        </button>
        <button className="overview-carousel-back" onClick={onTracker} title={t('Gacha Tracker')}>
          <DiamondIcon size={24} />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="overview-carousel-empty">
          <p>{t('No games added yet')}</p>
        </div>
      ) : (
        <>
          <div className="overview-carousel-body">
            <div
              className={`overview-carousel-grid${scrolling ? ' overview-carousel-grid--scrolling' : ''}`}
              ref={scrollRef}
              onScroll={handleScroll}
            >
              {rows.map((rowGames, i) => (
                <div className="overview-carousel-grid-row" key={i}>
                  {rowGames.map(game => (
                    <CarouselCard key={game.id} game={game} rowIndex={i} flipAllRequest={flipAllRequest} />
                  ))}
                </div>
              ))}
            </div>

            {rows.length > 1 && (
              <div className="overview-carousel-row-dots">
                {rows.map((_, i) => (
                  <button
                    key={i}
                    className={`overview-carousel-row-dot ${i === activeRow ? 'overview-carousel-row-dot--active' : ''}`}
                    onClick={() => scrollToRow(i)}
                    aria-label={`${t('Row')} ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          <button className="overview-carousel-flip-all" onClick={handleFlipAll}>
            {t('Flip all')}
          </button>
        </>
      )}
    </div>
  );
}

// Icon replaces the text name when available (linked games); unlinked/custom
// games have no icon in CURRENCY_ICONS, so the name is shown as a fallback
// instead of leaving the row blank.
function CurrencyRow({ icon, name, value }) {
  return (
    <div className="overview-carousel-row-item overview-carousel-row-item--currency">
      {icon ? <img src={icon} alt={name} className="overview-carousel-currency-icon" /> : <span>{name}</span>}
      <span>{value}</span>
    </div>
  );
}

function CarouselCard({ game, rowIndex, flipAllRequest }) {
  const t = useT();
  // Counts flips rather than toggling a boolean — each click adds another
  // 180deg turn (0, 180, 360, 540...) instead of unwinding back to 0, so
  // flipping back to the front keeps rotating the same direction it flipped
  // in, rather than visually reversing.
  const [flipCount, setFlipCount] = useState(0);
  const flipped = flipCount % 2 === 1;
  // Blocks another flip until the current one has fully settled (matches
  // FLIP_DURATION_MS, the flip's total animation time in Overview.css —
  // 0.55s) — without this, spamming clicks mid-flip restarted the
  // animation-name/rotation every time, never letting the "lift" settle
  // back down and making the card look like it was glitching in place.
  const flipLockedRef = useRef(false);

  function handleFlip() {
    if (flipLockedRef.current) return;
    flipLockedRef.current = true;
    setFlipCount(c => c + 1);
    setTimeout(() => { flipLockedRef.current = false; }, FLIP_DURATION_MS);
  }

  // "Flip All" (see OverviewCarousel) only targets the currently-visible
  // row — every card in that row shares the same flipAllRequest object, so
  // each one flips itself via the same handleFlip() (still respecting the
  // lock above, and always advancing forward regardless of which face it's
  // currently showing, same as a direct click would).
  const appliedFlipAllVersionRef = useRef(null);
  useEffect(() => {
    if (flipAllRequest.row !== rowIndex) return;
    if (appliedFlipAllVersionRef.current === flipAllRequest.version) return;
    appliedFlipAllVersionRef.current = flipAllRequest.version;
    handleFlip();
  }, [flipAllRequest, rowIndex]); // eslint-disable-line

  const labels   = resolveGameLabels(game);
  const currency = resolveGameCurrency(game);
  const state    = game.state ?? {};
  const canClaim = canClaimDailyPass(state.dailyPassLastClaimedAt);

  // has5050 is the same signal the actual Calculator components already use
  // to decide whether a banner's Guaranteed toggle applies at all (e.g.
  // NTE's character banner and WuWa's weapon banner are always-featured,
  // see gameSchema.js's DB_BANNER_DEFAULTS) — reusing it here instead of
  // hardcoding per-game exceptions keeps this in sync with that logic.
  const showCharGuaranteed   = game.charBanner?.has5050   !== false;
  const showWeaponGuaranteed = game.weaponBanner?.has5050 !== false;

  // Derived from the game's own currency definition, not from whether the
  // saved state object happens to already contain charPullItems/weaponPullItems
  // — older WuWa/NTE saves predate those fields entirely (undefined, not 0),
  // which made a state-based check silently fall back to single-currency and
  // drop the second pull item (e.g. WuWa's Forging Tide) for those games.
  // Can't just check weaponPullItemName for truthiness either — resolveGameCurrency
  // falls back to pullItemName when a game has no separate weapon pull item,
  // so it's never actually empty. Comparing the two catches real dual-currency
  // games (the names genuinely differ) without that fallback producing a
  // false positive for every single-currency game.
  const isDualCurrency = !!currency.weaponPullItemName && currency.weaponPullItemName !== currency.pullItemName;
  const icons = CURRENCY_ICONS[game.linkedDatabase];
  // Only ever set for linked games (see useTrackerState.js's stats-recompute
  // effect, which skips unlinked/custom games entirely) — null here covers
  // both "custom game, will never have this" and "linked but not yet
  // computed" the same way, since there's nothing meaningful to show either.
  const stats = game.state?.stats?.combined ?? null;
  // 50/50 specifically uses characterFiftyFifty (the literal 'character'
  // banner only — see computeGameStats.js), not the totals/pity above
  // (which stay combined across every banner, including e.g. Genshin's
  // Chronicled Wish, a separate limited banner with its own 50/50 track).
  const fiftyFifty = game.state?.stats?.characterFiftyFifty ?? null;
  // NTE has no 50/50 mechanic at all — every S-rank is an outright win, so
  // there's nothing meaningful this row could ever show for it.
  const isNte = game.linkedDatabase === 'nte';
  const showFiftyFifty = !isNte;
  // NTE calls its top two rarity tiers S-rank/A-rank rather than 5-star/
  // 4-star — computeGameStats.js's count5/count4/avg5StarPity/avg4StarPity
  // fields are still rarity 5/4 under the hood either way, just labeled
  // per-game here for display.
  const fiveStarLabel = isNte ? t('S-rank') : t('5-star');
  const fourStarLabel = isNte ? t('A-rank') : t('4-star');

  return (
    <div
      className={`overview-carousel-flip${flipped ? ' overview-carousel-flip--flipped' : ''}`}
      style={flipCount > 0 ? { animationName: flipCount % 2 === 1 ? 'overviewCardLiftA' : 'overviewCardLiftB' } : undefined}
      onClick={handleFlip}
    >
      <div className="overview-carousel-flip-inner" style={{ transform: `rotateY(${flipCount * 180}deg)` }}>
        <div className="overview-carousel-card overview-carousel-card-front">
          <div className="overview-carousel-header">
            <span className="overview-carousel-icon">
              {game.iconPath && <img src={game.iconPath} alt={game.name} />}
            </span>
            <span className="overview-carousel-name">{game.name}</span>
          </div>

          <div className="overview-carousel-section">
            <CurrencyRow icon={icons?.currency} name={currency.currencyName || t('Currency')} value={state.currency ?? 0} />
            {isDualCurrency ? (
              <div className="overview-carousel-dual-row">
                <CurrencyRow icon={icons?.pullItem} name={currency.pullItemName} value={state.charPullItems ?? 0} />
                <CurrencyRow icon={icons?.weaponPullItem} name={currency.weaponPullItemName} value={state.weaponPullItems ?? 0} />
              </div>
            ) : (
              <CurrencyRow icon={icons?.pullItem} name={currency.pullItemName || t('Pull items')} value={state.pullItems ?? 0} />
            )}
          </div>

          <div className="overview-carousel-section">
            <div className="overview-carousel-row-item">
              <span>{labels.charName} {t('pity')}</span>
              <span>{state.charPity ?? 0} / {game.charBanner?.hardPity ?? 90}</span>
            </div>
            {showCharGuaranteed && (
              <div className="overview-carousel-row-item">
                <span>{t('Guaranteed')}</span>
                <span>{state.charGuaranteed ? t('Yes') : t('No')}</span>
              </div>
            )}
            <div className="overview-carousel-row-item">
              <span>{labels.weaponName} {t('pity')}</span>
              <span>{state.weaponPity ?? 0} / {game.weaponBanner?.hardPity ?? 80}</span>
            </div>
            {showWeaponGuaranteed && (
              <div className="overview-carousel-row-item">
                <span>{t('Guaranteed')}</span>
                <span>{state.weaponGuaranteed ? t('Yes') : t('No')}</span>
              </div>
            )}
          </div>

          <div className={`overview-carousel-daily ${canClaim ? 'overview-carousel-daily--open' : 'overview-carousel-daily--done'}`}>
            {canClaim ? t('Daily available') : t('Daily claimed')}
          </div>
        </div>

        <div className="overview-carousel-card overview-carousel-card-back">
          <div className="overview-carousel-header">
            <span className="overview-carousel-icon">
              {game.iconPath && <img src={game.iconPath} alt={game.name} />}
            </span>
            <span className="overview-carousel-name">{t('Stats')}</span>
          </div>

          {stats ? (
            <>
              <div className="overview-carousel-section">
                <div className="overview-carousel-row-item">
                  <span>{t('Total pulls')}</span>
                  <span>{stats.totalPulls}</span>
                </div>
                <div className="overview-carousel-row-item">
                  <span>{fiveStarLabel} {t('pulls')}</span>
                  <span>{stats.count5}</span>
                </div>
                <div className="overview-carousel-row-item">
                  <span>{fourStarLabel} {t('pulls')}</span>
                  <span>{stats.count4}</span>
                </div>
              </div>

              <div className="overview-carousel-section">
                <div className="overview-carousel-row-item">
                  <span>{t('Avg')} {fiveStarLabel} {t('pity')}</span>
                  <span>{formatPity(stats.avg5StarPity)}</span>
                </div>
                <div className="overview-carousel-row-item">
                  <span>{t('Avg')} {fourStarLabel} {t('pity')}</span>
                  <span>{formatPity(stats.avg4StarPity)}</span>
                </div>
              </div>

              {showFiftyFifty && (
                <div className="overview-carousel-section">
                  <div className="overview-carousel-row-item">
                    <span>{t('50/50 rate')}</span>
                    <span>{formatRate(fiftyFifty?.rate ?? null)}</span>
                  </div>
                  <div className="overview-carousel-row-item">
                    <span>{t('W/L/G')}</span>
                    <span>{fiftyFifty ? `${fiftyFifty.won} / ${fiftyFifty.lost} / ${fiftyFifty.guaranteed}` : '—'}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="overview-carousel-stats-empty">{t('No pull data yet')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
