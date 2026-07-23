import React, { useState, useMemo, useEffect } from 'react';
import { bannerImageCache } from '../../../../shared/utils/bannerImageCache';
import { ScrollArea } from '../../../../shared/components/ScrollArea';
import './NtePullLogTab.css';

// Same value as HistoryTab.js's PAGE_SIZE — kept in sync deliberately, not
// because the two files share code, but so the two history views behave
// identically from the user's perspective.
const PAGE_SIZE = 50;

// NTE's own history view — not a reuse of the genshin/hsr/zzz HistoryTab,
// which is deeply tied to concepts NTE doesn't have (50/50 "fate"
// indicators, dual same-type banners, Hoyoverse-API-sourced schedules).
// The banner-card row below IS a simplified port of HistoryTab.js's
// PairedBannerCard/SelectedGroupBadge (same CSS classes, same click-to-filter
// idea) — NTE's schedule always has exactly one character + one arc per
// phase, so it never needs the multi-image marquee HSR's 3-4-character
// phases require. Rarity tiers ARE numeric here too
// (5/4/3), confirmed by the user: S-Class = 5-star (gold), A-Class =
// 4-star (pink), B-Class = 3-star (neither highlight color) — see
// tableParser.js's sampleRowRarity, the actual pixel-color-based source of
// truth this only displays. Filter labels show the actual in-game class
// name (S/A/B-Class), not stars, per the user's explicit correction.
//
// Banner and rarity filter interaction deliberately matches HistoryTab.js's
// toggleBanner/toggleRarity exactly (same "isolate on click when all
// active, reset to all when clicking the sole active one, otherwise plain
// toggle" pattern) — the user asked for behavioral parity with the other
// three games, not just a visually similar filter bar.
const RARITY_COLORS = { 5: '#FDB50B', 4: '#E73FBD', 3: '#8a8a9a' };
const RARITY_LABELS = { 5: 'S-Class', 4: 'A-Class', 3: 'B-Class' };
const RARITY_LETTERS = { 5: 'S', 4: 'A', 3: 'B' };
const RARITY_TIERS = [5, 4, 3];
const BANNER_KEYS = ['character-limited', 'arc', 'character-standard'];
const BANNER_LABELS = { 'character-limited': 'Limited', 'character-standard': 'Standard', arc: 'Arc' };
const CATEGORY_KEYS = ['Character', 'Arc', 'Item'];

// "Slumberland" — Dice_ticket_01 ("Warp Piece") only. Corrected per the user:
// Dice_ticket_02 ("Lost Piece") is NOT a Slumberland-only freebie — it's a
// real possible roll result, and counts toward both Pity and the 10-roll
// Points Gift cycle like any other pull (its category is 'Item', so it was
// never going to trigger a pity-reset anyway — it just needs to not be
// skipped/excluded anymore). Warp Piece counts toward Roll but never toward
// Pity, and doesn't consume a slot in the 10-roll cycle either (see
// realPityById's cyclePos below).
const SLUMBERLAND_KEYS = new Set(['Dice_ticket_01']);

// Date-only display, per the user's explicit format spec — deliberately
// NOT the other three games' "Jul 10, 2026" style (HistoryTab.js's
// formatDate), which was considered and turned down in favor of a plain
// YYYY/MM/DD. Interprets the stored UTC instant in the viewer's own local
// timezone, matching "which day did I pull this" as a human would read it.
function formatDateOnly(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function NtePullRow({ pull, realPity }) {
  const color = RARITY_COLORS[pull.rarity] ?? RARITY_COLORS[3];
  const isHighlighted = pull.rarity >= 4;
  return (
    <div className={`nte-pl-row${isHighlighted ? ` nte-pl-row--r${pull.rarity}` : ''}`}>
      <span className="nte-pl-rarity" style={{ color }}>{RARITY_LETTERS[pull.rarity] ?? 'B'}</span>
      <span className="nte-pl-name" style={isHighlighted ? { color } : {}}>
        {pull.name || '—'}
      </span>
      <span className="nte-pl-banner">{BANNER_LABELS[pull.banner] ?? pull.banner ?? '—'}</span>
      <span className="nte-pl-category">{pull.category ?? '—'}</span>
      <span className="nte-pl-roll">
        {pull.isBonus ? <span className="nte-pl-bonus-tag">bonus</span> : (pull.pity ?? '—')}
      </span>
      <span className="nte-pl-pity">
        {pull.isBonus ? <span className="nte-pl-bonus-tag">bonus</span> : (realPity ?? '—')}
      </span>
      <span className="nte-pl-date">{formatDateOnly(pull.time)}</span>
    </div>
  );
}

// Converts a pull's stored UTC ISO timestamp into the same naive
// "YYYY-MM-DD HH:MM:SS" UTC+8 wall-clock string the banner schedule's
// start/end use (see the data repo's schedule.js) — needed so a selected
// banner card's date range can be compared against pull times directly via
// plain string comparison, matching HistoryTab.js's toUTC8 in spirit.
function isoToUtc8WallClock(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())} ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}`;
}

// A schedule "character" phase only ever corresponds to Limited pulls — the
// Standard board runs perpetually (gamewith.net lists it "Always Available",
// never phase-tied), so it has no banner-card entry and never matches here.
const BANNER_TYPE_TO_PULL_BANNER = { character: 'character-limited', arc: 'arc' };

function loadNteBannerImage(id) {
  if (!id) return Promise.resolve(null);
  return (window.api?.getNteBannerImage?.(id) ?? Promise.resolve(null)).catch(() => null);
}

// Simplified version of HistoryTab.js's PairedBannerCard — NTE never has
// more than one character/arc per phase (unlike HSR's occasional 3-4
// character banners), so there's no marquee/scroll case to handle. Still
// always renders 2 image slots (real image + blank placeholder), same as
// the other 3 games' single-character banners — that second slot is what
// gives the card its correct width; dropping it (as an earlier version of
// this file did) made the card visibly narrower than GI/HSR/ZZZ's.
function NteBannerCard({ group, selected, onClick, color }) {
  const [imgSrc, setImgSrc] = useState(() => bannerImageCache.get(`nte:${group.featuredId}`) ?? null);

  useEffect(() => {
    if (imgSrc || !group.featuredId) return;
    loadNteBannerImage(group.featuredId).then(src => {
      if (src) bannerImageCache.set(`nte:${group.featuredId}`, src);
      setImgSrc(src);
    });
  }, [group.featuredId]); // eslint-disable-line

  const accentColor = color ?? 'var(--accent)';

  return (
    <button
      className={`pl-bcard pl-bcard--${group.type}${selected ? ' pl-bcard--selected' : ''}`}
      style={selected ? { outline: `2px solid ${accentColor}`, outlineOffset: '2px' } : {}}
      onClick={onClick}
      title={group.name ?? ''}
    >
      <div className="pl-bcard-imgs">
        {Array.from({ length: 2 }, (_, i) => (
          i === 0 && imgSrc
            ? <img key={i} className="pl-bcard-img" src={imgSrc} alt="" style={{ objectPosition: 'center 20%' }} />
            : <div key={i} className="pl-bcard-placeholder" />
        ))}
      </div>
      <div className="pl-bcard-info">
        {group.version && <span className="pl-bcard-version">{group.version}</span>}
      </div>
    </button>
  );
}

function NteSelectedBannerBadge({ group, color, onClear }) {
  const [imgSrc, setImgSrc] = useState(() => bannerImageCache.get(`nte:${group.featuredId}`) ?? null);
  useEffect(() => {
    // This component instance persists across banner selections (it isn't
    // remounted/keyed per group) — reset to the new banner's own cached image
    // immediately rather than checking staleness against the *previous*
    // banner's imgSrc, which would wrongly look "already loaded" and never
    // fetch the new one. Same bug/fix as HistoryTab.js's SelectedGroupBadge.
    const cached = bannerImageCache.get(`nte:${group.featuredId}`) ?? null;
    setImgSrc(cached);
    if (cached || !group.featuredId) return;
    loadNteBannerImage(group.featuredId).then(src => {
      if (src) bannerImageCache.set(`nte:${group.featuredId}`, src);
      setImgSrc(src);
    });
  }, [group.featuredId]); // eslint-disable-line

  const borderColor = color ?? 'var(--accent)';
  return (
    <div className={`pl-selected-badge pl-selected-badge--${group.type}`} style={{ border: `1.5px solid ${borderColor}` }}>
      <div className="pl-bcard-imgs">
        {Array.from({ length: 2 }, (_, i) => (
          i === 0 && imgSrc
            ? <img key={i} className="pl-bcard-img" src={imgSrc} alt="" style={{ objectPosition: 'center 20%' }} />
            : <div key={i} className="pl-bcard-placeholder" />
        ))}
      </div>
      <div className="pl-bcard-info">
        {group.version && <span className="pl-bcard-version">{group.version}</span>}
      </div>
      <button className="pl-selected-badge-close" onClick={onClear}>✕</button>
    </div>
  );
}

function RarityToggle({ rarity, active, onToggle }) {
  const color = RARITY_COLORS[rarity];
  return (
    <button
      className={`pl-rarity-btn${active ? ' pl-rarity-btn--on' : ''}`}
      style={active ? { borderColor: color, color, '--btn-tint': color } : {}}
      onClick={onToggle}
    >
      {RARITY_LABELS[rarity]}
    </button>
  );
}

export default function NtePullLogTab({ game, color, prefetchedSchedule }) {
  const pullLog = game.state.pullLog ?? [];

  const [bannerFilter, setBannerFilter] = useState(
    () => Object.fromEntries(BANNER_KEYS.map(b => [b, true]))
  );
  const [rarityFilter, setRarityFilter] = useState({ 5: true, 4: true, 3: true });
  const [categoryFilter, setCategoryFilter] = useState(
    () => Object.fromEntries(CATEGORY_KEYS.map(c => [c, true]))
  );
  const [sortOrder, setSortOrder] = useState('desc'); // 'desc' = newest first, 'asc' = oldest first
  const [page, setPage] = useState(1);

  const [selectedBanner, setSelectedBanner] = useState(null);
  // Fallback schedule fetched via IPC only when App.js hasn't already
  // preloaded one (e.g. loading screen ran before window.api was ready) —
  // same fallback pattern as HistoryTab.js's PullLogView.
  const [fetchedSchedule, setFetchedSchedule] = useState(null);
  const bannerSchedule = prefetchedSchedule ?? fetchedSchedule;

  useEffect(() => {
    if (prefetchedSchedule) return;
    window.api?.fetchNteBanners?.().then(result => {
      if (result?.ok) setFetchedSchedule(result.bannerSchedule ?? []);
    }).catch(() => {});
  }, [prefetchedSchedule]);

  // One card per (type, start) — always exactly one character + one arc per
  // phase for NTE (no HSR-style multi-character phases), so this grouping
  // is simpler than HistoryTab.js's equivalent, but kept as a map for the
  // same reason: trivially extensible if that ever changes.
  const pairedBanners = useMemo(() => {
    if (!bannerSchedule) return [];
    return bannerSchedule
      .filter(b => (b.type === 'character' || b.type === 'arc') && b.name && b.featuredId != null)
      .sort((a, b) => (b.start ?? '').localeCompare(a.start ?? '') || (a.type === 'character' ? -1 : 1));
  }, [bannerSchedule]);

  // Same idea as HistoryTab.js's visiblePairedBanners — restrict the banner
  // panel to whichever type(s) the Limited/Arc/Standard filter row has
  // active, via the same character->character-limited mapping used for the
  // pull-list filter above (Standard never has cards to filter — see that
  // constant's comment). Missing before now, so e.g. pressing Limited would
  // correctly filter the pull list but the banner panel still showed Arc
  // cards alongside it.
  const visiblePairedBanners = useMemo(
    () => pairedBanners.filter(g => bannerFilter[BANNER_TYPE_TO_PULL_BANNER[g.type]] === true),
    [pairedBanners, bannerFilter],
  );

  // The stored `pity` field is really a plain per-banner roll counter — it
  // never resets (see NtePullRow's "Roll" column, which displays it as-is).
  // Real pity — the count since the last qualifying reset — isn't stored
  // anywhere, so it's computed fresh here, keyed by pull id:
  //  - character-limited / character-standard: resets on any S-Class pull
  //    whose category is Character (an S-Class item/arc obtained along the
  //    way does NOT reset it — matches the calculator's own pity rules).
  //    Every 10 real rolls also grants a "Points Gift" bonus item (always
  //    A-Class) alongside the 10th — an 11th same-timestamp entry that
  //    counts toward Roll but not Pity, same treatment as Slumberland
  //    tickets. Confirmed directly against a real capture: dumping the raw
  //    packet bytes for a known Points Gift entry (matched against the
  //    in-game history screen) found NO distinguishing flag anywhere in the
  //    wire data — the server's response is structurally identical for a
  //    bonus vs. a normal roll. It can only be identified by POSITION: the
  //    11th real-roll-cycle slot (10 real + 1 bonus, tickets excluded from
  //    the count), confirmed by simulating that exact cycle against the
  //    known example and landing exactly on slot 11.
  //  - arc: resets ONLY when the S-Class arc pulled is the featured/limited
  //    arc for that phase (per the earlier guarantee-flag fix, the arc
  //    banner can roll OTHER non-limited S-Class arcs without that being a
  //    "win") — determined by matching the pull's rewardKey against the
  //    schedule's featuredId for the arc phase active at the pull's time.
  //    No Points Gift/ticket mechanic on this board.
  const realPityById = useMemo(() => {
    const map = new Map();
    // Same-timestamp entries are stored in true chronological order as of
    // the captureOrchestrator.js reversal fix (2026-07-13) — the raw capture
    // is newest-first (page 1 first, top-to-bottom per page), and that whole
    // sequence gets reversed once before Roll numbers are assigned, so ties
    // now break on ASCENDING roll index, matching plain ascending time. (An
    // earlier version of this sort broke ties DESCENDING to compensate for
    // that same bug still being present in the backend — no longer needed
    // now that the root cause is fixed there instead of worked around here.)
    const ordered = [...pullLog].sort((a, b) =>
      (a.time ?? '').localeCompare(b.time ?? '') || (a.pity ?? 0) - (b.pity ?? 0)
    );
    const pityCounters = { 'character-limited': 0, 'character-standard': 0, arc: 0 };
    const cyclePos = { 'character-limited': 0, 'character-standard': 0 };
    const arcSchedule = (bannerSchedule ?? []).filter(b => b.type === 'arc' && b.featuredId != null);

    function featuredArcIdAt(isoTime) {
      const wallClock = isoToUtc8WallClock(isoTime);
      if (wallClock == null) return null;
      const match = arcSchedule.find(b => wallClock >= b.start && wallClock <= (b.end ?? wallClock));
      return match?.featuredId ?? null;
    }

    for (const p of ordered) {
      if (!(p.banner in pityCounters)) continue;

      if (p.banner !== 'arc' && SLUMBERLAND_KEYS.has(p.rewardKey)) {
        map.set(p.id, null); // Roll unaffected, Pity excluded, cycle not advanced
        continue;
      }

      let isPointsGift = false;
      if (p.banner !== 'arc') {
        cyclePos[p.banner] += 1;
        if (cyclePos[p.banner] === 11) {
          isPointsGift = true;
          cyclePos[p.banner] = 0;
        }
      }
      if (isPointsGift) {
        map.set(p.id, null);
        continue;
      }

      pityCounters[p.banner] += 1;
      map.set(p.id, pityCounters[p.banner]);
      const isQualifyingGold = p.rarity === 5 && (
        p.banner === 'arc'
          ? p.category === 'Arc' && p.rewardKey === featuredArcIdAt(p.time)
          : p.category === 'Character'
      );
      if (isQualifyingGold) pityCounters[p.banner] = 0;
    }
    return map;
  }, [pullLog, bannerSchedule]);

  function handleBannerCardClick(group) {
    setSelectedBanner(prev => (prev && prev.type === group.type && prev.start === group.start) ? null : group);
  }

  // Resets pagination whenever a filter/sort changes — same as
  // HistoryTab.js — otherwise "page 3 of 50-row chunks" could point past
  // the end of a newly-narrowed filtered list, or just show a confusingly
  // stale window into it.
  useEffect(() => {
    setPage(1);
  }, [rarityFilter, bannerFilter, categoryFilter, sortOrder, selectedBanner]);

  function toggleBanner(key) {
    setBannerFilter(prev => {
      const activeKeys = BANNER_KEYS.filter(b => prev[b]);
      if (activeKeys.length === BANNER_KEYS.length) {
        return Object.fromEntries(BANNER_KEYS.map(b => [b, b === key]));
      }
      if (activeKeys.length === 1 && prev[key]) {
        return Object.fromEntries(BANNER_KEYS.map(b => [b, true]));
      }
      return { ...prev, [key]: !prev[key] };
    });
  }

  function toggleRarity(r) {
    setRarityFilter(prev => {
      const activeRarities = RARITY_TIERS.filter(x => prev[x]);
      if (activeRarities.length === RARITY_TIERS.length) {
        return { 5: r === 5, 4: r === 4, 3: r === 3 };
      }
      if (activeRarities.length === 1 && prev[r]) {
        return { 5: true, 4: true, 3: true };
      }
      return { ...prev, [r]: !prev[r] };
    });
  }

  // Same isolate-on-click-when-all-active pattern as toggleBanner/toggleRarity.
  function toggleCategory(key) {
    setCategoryFilter(prev => {
      const activeKeys = CATEGORY_KEYS.filter(c => prev[c]);
      if (activeKeys.length === CATEGORY_KEYS.length) {
        return Object.fromEntries(CATEGORY_KEYS.map(c => [c, c === key]));
      }
      if (activeKeys.length === 1 && prev[key]) {
        return Object.fromEntries(CATEGORY_KEYS.map(c => [c, true]));
      }
      return { ...prev, [key]: !prev[key] };
    });
  }

  const bannerCounts = useMemo(() => {
    const counts = Object.fromEntries(BANNER_KEYS.map(b => [b, 0]));
    for (const p of pullLog) {
      if (p.banner in counts) counts[p.banner]++;
    }
    return counts;
  }, [pullLog]);

  const filtered = useMemo(() => {
    return [...pullLog]
      .sort((a, b) => {
        // Time-only comparison ties whenever multiple records share the
        // same timestamp (common — arc's 10-pull batches and monopoly
        // bonus items all land on the same second as the character/arc
        // pull they came with) — Array.sort is stable, so ties silently
        // fell back to storage order (oldest-first, i.e. ascending pity)
        // regardless of the chosen sortOrder, which is why "newest first"
        // still showed pity climbing within a tied group. Breaking ties by
        // pity itself, in the same direction as sortOrder, fixes that.
        const timeCompare = sortOrder === 'desc'
          ? (b.time ?? '').localeCompare(a.time ?? '')
          : (a.time ?? '').localeCompare(b.time ?? '');
        if (timeCompare !== 0) return timeCompare;
        const aPity = a.pity ?? -1;
        const bPity = b.pity ?? -1;
        return sortOrder === 'desc' ? bPity - aPity : aPity - bPity;
      })
      .filter(p =>
        rarityFilter[p.rarity ?? 3] === true &&
        bannerFilter[p.banner] === true &&
        categoryFilter[p.category] === true
      )
      .filter(p => {
        if (!selectedBanner) return true;
        if (p.banner !== BANNER_TYPE_TO_PULL_BANNER[selectedBanner.type]) return false;
        const wallClock = isoToUtc8WallClock(p.time);
        return wallClock != null && wallClock >= selectedBanner.start && wallClock <= (selectedBanner.end ?? wallClock);
      });
  }, [pullLog, rarityFilter, bannerFilter, categoryFilter, sortOrder, selectedBanner]);

  // Same S/A/B (5/4/3) + total-shown counters as HistoryTab.js's count5/
  // count4/count3 — counted against the filtered list, not the raw log, so
  // the numbers reflect whatever's currently visible.
  const countS = useMemo(() => filtered.filter(p => p.rarity === 5).length, [filtered]);
  const countA = useMemo(() => filtered.filter(p => p.rarity === 4).length, [filtered]);
  const countB = useMemo(() => filtered.filter(p => p.rarity === 3).length, [filtered]);

  // Renders only the first page*PAGE_SIZE rows rather than the whole
  // filtered list at once — with 1000+ total pulls not uncommon here (a
  // packet capture recovers full server-side history in one shot, unlike
  // the other three games' much smaller manually-accumulated logs),
  // mounting every row as an unvirtualized CSS grid row made any layout
  // event (e.g. the sidebar collapsing) force a reflow of the entire list
  // at once — confirmed live as the actual cause of a real lag complaint.
  const displayed = filtered.slice(0, page * PAGE_SIZE);
  const remaining = filtered.length - displayed.length;

  return (
    <div className="nte-pull-log-tab">
      <div className="pl-banner-bar">
        {BANNER_KEYS.map(key => {
          const on = bannerFilter[key] === true;
          const count = bannerCounts[key] ?? 0;
          return (
            <button
              key={key}
              className={`pl-banner-btn${on ? ' pl-banner-btn--on' : ''}`}
              style={on ? { borderColor: color, color, '--btn-tint': color } : {}}
              onClick={() => toggleBanner(key)}
            >
              {BANNER_LABELS[key]}
              {count > 0 && <span className="pl-banner-count">{count.toLocaleString()}</span>}
            </button>
          );
        })}

        <div className="pl-banner-bar-right">
          {selectedBanner ? (
            <NteSelectedBannerBadge group={selectedBanner} color={color} onClear={() => setSelectedBanner(null)} />
          ) : (
            <div className="pl-no-banner">No banner</div>
          )}
        </div>
      </div>

      {/* Two-column layout: left (filters + rows) + right (banner panel) — same structure as HistoryTab.js */}
      <div className="pl-lower">
        <div className="pl-left">
          <div className="pl-filter-bar">
            <div className="pl-filter-left">
              {RARITY_TIERS.map(r => (
                <RarityToggle key={r} rarity={r} active={rarityFilter[r]} onToggle={() => toggleRarity(r)} />
              ))}
              <span className="pl-stat-sep" />
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[5] }}>{countS}</span> S</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[4] }}>{countA}</span> A</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat"><span className="pl-stat-n" style={{ color: RARITY_COLORS[3] }}>{countB}</span> B</span>
              <span className="pl-stat-sep" />
              <span className="pl-stat">
                <span className="pl-stat-n">{filtered.length.toLocaleString()}</span>
                {filtered.length !== pullLog.length && (
                  <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>
                    /{pullLog.length.toLocaleString()}
                  </span>
                )}
                {' '}shown
              </span>
            </div>
            <div className="pl-filter-right" style={{ marginLeft: 'auto' }}>
              {CATEGORY_KEYS.map(key => {
                const on = categoryFilter[key] === true;
                return (
                  <button
                    key={key}
                    className={`pl-banner-btn nte-pl-category-btn${on ? ' pl-banner-btn--on' : ''}`}
                    style={on ? { borderColor: color, color } : {}}
                    onClick={() => toggleCategory(key)}
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          </div>

          <ScrollArea
            className="pl-scroll-area"
            viewportStyle={{ paddingRight: '10px' }}
            thumbWidth={10}
            thumbColor="rgba(255,255,255,0.18)"
            thumbHoverColor="rgba(255,255,255,0.30)"
          >
            {displayed.length === 0 ? (
              <p className="nte-pl-empty">
                {pullLog.length > 0
                  ? 'No pulls match the selected filters.'
                  : 'No pulls recorded yet — sync from the game to import your history.'}
              </p>
            ) : (
              <div className="pl-list">
                {/* Sticky first child, same as HistoryTab.js's .pl-header-row — scrolls
                    with, and shares exact grid columns with, the rows beneath it. */}
                <div className="nte-pl-header-row">
                  <span>Rarity</span>
                  <span>Name</span>
                  <span>Banner</span>
                  <span>Category</span>
                  <span style={{ textAlign: 'right' }}>Roll</span>
                  <span style={{ textAlign: 'right' }}>Pity</span>
                  <span className="nte-pl-date-header">
                    <button
                      className="pl-sort-btn"
                      onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
                      title={sortOrder === 'desc' ? 'Showing newest first' : 'Showing oldest first'}
                    >
                      {sortOrder === 'desc' ? '↓' : '↑'}
                    </button>
                    Date
                  </span>
                </div>
                {displayed.map(pull => (
                  <NtePullRow key={pull.id} pull={pull} realPity={realPityById.get(pull.id)} />
                ))}
              </div>
            )}
            {remaining > 0 && (
              <button className="pl-load-more" onClick={() => setPage(p => p + 1)}>
                Load more ({remaining.toLocaleString()} remaining)
              </button>
            )}
          </ScrollArea>
        </div>

        {/* Right sidebar — same ScrollArea usage/props as HistoryTab.js's banner panel */}
        <ScrollArea
          className="pl-banner-panel"
          style={{ padding: 0 }}
          viewportStyle={{
            paddingTop: '4px', paddingLeft: '8px', paddingRight: '8px', paddingBottom: '4px',
            display: 'flex', flexDirection: 'column', gap: '5px',
          }}
          thumbWidth={10}
          thumbColor="rgba(255,255,255,0.15)"
          thumbHoverColor="rgba(255,255,255,0.28)"
        >
          {visiblePairedBanners.length === 0 ? (
            <p className="pl-banner-panel-empty">No banners</p>
          ) : (
            visiblePairedBanners.map(group => (
              <NteBannerCard
                key={`${group.type}|${group.start}`}
                group={group}
                color={color}
                selected={selectedBanner?.type === group.type && selectedBanner?.start === group.start}
                onClick={() => handleBannerCardClick(group)}
              />
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
