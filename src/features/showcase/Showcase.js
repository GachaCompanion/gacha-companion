import React, { useState, useRef, useEffect } from 'react';
import TitleBar from '../../shared/components/TitleBar';
import UidLookup from './components/UidLookup';
import CharacterFilter from './components/CharacterFilter';
import CharacterCard from './components/CharacterCard';
import HsrCardMenu from './games/hsr/HsrCardMenu';
import ZzzCardMenu from './games/zzz/ZzzCardMenu';
import { preloadLive2d, needsPreload } from './live2d/preloadLive2d';
import './Showcase.css';

// Main content only — the sidebar is now a single persistent instance
// mounted once in App.js (see shared/components/sidebar/) and shared with
// GachaTracker, so switching between them never unmounts it. `showcase` is
// useShowcaseState()'s return value, now owned by App.js (hoisted so the
// sidebar can read savedBuilds from the same instance) and passed down
// here as a prop. `collapsed`/`selectedSavedId` and the delete-confirm flow
// are similarly lifted to App.js, since the sidebar (which triggers
// selection/deletion) is now a sibling of this component, not a child.
export default function Showcase({ revealed, showcase, onGoHome, collapsed, selectedSavedId, onSelectSaved, activeIndex, onActiveIndexChange }) {
  const {
    ready,
    savedBuilds,
    cardMode,
    setCardMode,
    cardDimension,
    setCardDimension,
    fetchStatus,
    fetchError,
    liveResult,
    fetchShowcase,
  } = showcase;

  // The card-menu strip is positioned in the collapsed-sidebar area but must
  // line up vertically with the card, which lives in the (separate) right
  // column — so measure the card-wrap's bounds and pass them to the menu.
  const cardWrapRef = useRef(null);
  const [menuBox,   setMenuBox] = useState(null);

  // After a search, preload every fetched HSR character's Live2D into the engine
  // cache and hold the card view behind a loading state until they're all ready,
  // so the first character switch isn't laggy.
  const [preparing, setPreparing] = useState(false);

  const liveBuilds         = liveResult?.builds ?? [];
  const selectedSavedEntry = savedBuilds.find(b => b.id === selectedSavedId);
  const savedBuildData     = selectedSavedEntry?.build ?? null;

  // The card shown: saved build takes priority; otherwise the selected live character
  const currentBuild = selectedSavedEntry
    ? savedBuildData
    : (liveBuilds[activeIndex] ?? null);

  const playerInfo = liveResult?.playerInfo ?? null;

  function handleSearch(uid, game) {
    onSelectSaved(null);
    onActiveIndexChange(0);
    fetchShowcase(uid, game ?? 'genshin');
  }

  function handleSelectLive(i) {
    onSelectSaved(null); // deselect sidebar
    onActiveIndexChange(i);
  }

  const showFilter  = liveBuilds.length > 0 || !!selectedSavedEntry;
  const hasContent  = ready && !!currentBuild;
  const showLivePrep = preparing && !selectedSavedEntry;   // gate live view, not saved builds
  // Mounted whenever an HSR or ZZZ card is shown; visibility (fade) is driven by collapse.
  const showCardMenu = hasContent && !showLivePrep && (currentBuild?.game === 'hsr' || currentBuild?.game === 'zzz');

  // Preload all fetched HSR Live2D models when viewing live in Live2D mode.
  useEffect(() => {
    if (!liveResult || liveResult.game !== 'hsr' || cardMode !== 'live2d') { setPreparing(false); return; }
    const ids = liveResult.builds.map(b => b.avatarId).filter(Boolean);
    if (!needsPreload('hsr', ids)) { setPreparing(false); return; }
    let cancelled = false;
    setPreparing(true);
    preloadLive2d('hsr', ids).then(() => { if (!cancelled) setPreparing(false); });
    return () => { cancelled = true; };
  }, [liveResult, cardMode]);


  useEffect(() => {
    if (!showCardMenu) { setMenuBox(null); return; }
    const measure = () => {
      const cw = cardWrapRef.current;
      if (!cw) return;
      // Viewport-relative — the card menu is position:fixed (see HsrCardMenu.css/
      // ZzzCardMenu.css) since the Sidebar it aligns with now lives outside
      // this page's own DOM subtree, so there's no shared positioned
      // ancestor to measure page-relative offsets against anymore.
      const c = cw.getBoundingClientRect();
      setMenuBox({ top: c.top, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (cardWrapRef.current) ro.observe(cardWrapRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [showCardMenu, currentBuild]);

  return (
    <div className={`app-ui showcase-page${revealed ? '' : ' app-ui--hidden'}`}>
      {/* Card menu — fills the strip the sidebar reveals when collapsed, aligned
          to the card's height. HSR and ZZZ only for now (Live2D-capable games). */}
      {showCardMenu && menuBox && currentBuild?.game === 'hsr' && (
        <HsrCardMenu
          cardMode={cardMode}
          onChange={setCardMode}
          dimension={cardDimension}
          onDimensionChange={setCardDimension}
          visible={collapsed}
          style={{ top: menuBox.top, height: menuBox.height }}
        />
      )}
      {showCardMenu && menuBox && currentBuild?.game === 'zzz' && (
        <ZzzCardMenu
          cardMode={cardMode}
          onChange={setCardMode}
          visible={collapsed}
          style={{ top: menuBox.top, height: menuBox.height }}
        />
      )}

      <div className="app-right">
        <TitleBar onHome={onGoHome} />

        <div className="showcase-main">
          <div className="showcase-header">
            <UidLookup
              onSearch={handleSearch}
              status={fetchStatus}
              error={fetchError}
            />
            {playerInfo && liveResult && (
              <div className="showcase-player-info">
                <span className="showcase-player-name">{playerInfo.nickname}</span>
                <span className="showcase-player-meta">
                  WL {playerInfo.worldLevel} · UID {liveResult.uid}
                </span>
              </div>
            )}
          </div>

          {showLivePrep ? (
            <div className="showcase-loading">
              <div className="showcase-loading__spinner" />
              <p>Loading Live2D models…</p>
            </div>
          ) : (
            <>
              {showFilter && (
                <CharacterFilter
                  savedBuild={savedBuildData}
                  savedSelected={!!selectedSavedEntry}
                  onSelectSaved={() => {
                    // If there's a saved build, re-select it; used when user wants to go back
                    if (selectedSavedEntry) onSelectSaved(selectedSavedEntry.id);
                  }}
                  liveBuilds={liveBuilds}
                  liveIndex={activeIndex}
                  onSelectLive={handleSelectLive}
                />
              )}

              {hasContent && (
                <div className="showcase-card-wrap" ref={cardWrapRef}>
                  {/* API-fetched characters are cached by the engine; saved builds
                      load/unload (cacheable=false). */}
                  <CharacterCard build={currentBuild} cardMode={cardMode} cacheable={!selectedSavedEntry} dimension={cardDimension} />
                </div>
              )}

              {ready && liveBuilds.length === 0 && fetchStatus === 'idle' && !selectedSavedId && (
                <div className="showcase-empty">
                  <p>Enter a UID above to view their character showcase.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
