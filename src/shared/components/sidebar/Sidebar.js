// Baseline sidebar shell — the single persistent sidebar, mounted once and
// shared by GachaTracker and Showcase via a `mode` prop. Owns everything
// that's identical between the two: the layout/background/border, the
// collapse animation, the Home/Overview header buttons, and the generic
// drag-and-drop + kebab-menu mechanics. Everything that actually differs
// per mode (the list of games vs saved builds, the cross-nav header
// button, and what the footer button does) is supplied as props built by
// trackerComponents.js / showcaseComponents.js — see those files' own
// `useTrackerSidebarContent`/`useShowcaseSidebarContent` hooks.
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Home, LayoutDashboard } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import './Sidebar.css';
import { ScrollArea } from '../ScrollArea';

export default function Sidebar({
  mode, // 'tracker' | 'showcase' — only used to key the content fade below
  active, // whether the sidebar is actually visible right now (false on Home/Overview) — see the mode-switch transition below for why this matters
  collapsed, onToggleCollapse,
  onHome, onOverview,
  // Supplied by trackerComponents.js / showcaseComponents.js — see this
  // file's top comment.
  crossNav,        // ReactNode — the Showcase/Gacha Tracker header button
  items,           // array of { id, ... }
  selectedId,
  onSelectItem,
  onReorderItems,
  ItemRow,         // component({ item, selected, ghost, onSelect, onOpenKebab })
  DragClone,       // component({ item, collapsed, selected })
  KebabMenu,       // component({ id, position, onClose })
  emptyMessage,
  // Footer button — the actual <button> element lives here (not in
  // trackerComponents.js/showcaseComponents.js) because it must stay a
  // direct flex child of .sidebar-footer to get the width-stretch it needs;
  // buttons default to inline-block and shrink to their content otherwise.
  // Only the icon/label/click-target/alternate-content are supplied per mode.
  footerIcon,      // ReactNode
  footerLabel,     // string
  footerOnClick,   // () => void
  footerDisabled,  // bool
  footerAlternate, // ReactNode | null — replaces the button entirely (e.g. showcase's inline save row)
}) {
  const [phase,  setPhase]  = useState('idle'); // 'idle' | 'expanding' | 'collapsing'
  const [dragId, setDragId] = useState(null);
  const [kebab,  setKebab]  = useState(null);

  // Two-phase mode-switch transition — 'out' fades the OUTGOING mode's
  // content (a snapshot, since the live props already reflect the new mode
  // by the time this component re-renders), then 'in' swaps to the live
  // content and fades it in. 0.25s each, sequential — matches the main
  // content area's own fade-out-then-fade-in timing (see App.css/App.js),
  // so both sides of the screen move in lockstep instead of the sidebar
  // snapping to the new mode while the main page is still fading.
  // ItemRow/DragClone/KebabMenu are snapshotted too — they're mode-specific
  // (tracker's expects a game object, showcase's a saved build), so without
  // this the 'out' phase would render the OLD mode's items through the NEW
  // mode's ItemRow, a real data-shape mismatch, not just a cosmetic one.
  const [contentPhase, setContentPhase] = useState('idle'); // 'idle' | 'out' | 'in'
  const liveContent = {
    crossNav, items, itemIds: items.map(i => i.id), selectedId,
    footerIcon, footerLabel, footerAlternate, emptyMessage,
    ItemRow, DragClone, KebabMenu,
  };
  const lastContentRef     = useRef(liveContent);
  const outgoingContentRef = useRef(null);
  const prevModeRef        = useRef(mode);
  const prevActiveRef      = useRef(active);

  // Sidebar never unmounts, even while hidden behind Home/Overview (see
  // .sidebar-slot in App.css) — so `mode` can silently change while nobody
  // can see it (e.g. last on Tracker, visit Overview, then jump straight to
  // Showcase). Without this, that registers as a real tracker->showcase
  // change and plays a genuine fade-out of Tracker content nobody actually
  // just saw. Re-becoming active resyncs prevModeRef to the current mode
  // WITHOUT going through the normal change-detection block below, so nothing
  // animates — it just shows the right content immediately, same as a
  // fresh mount would.
  if (prevActiveRef.current !== active) {
    if (active) {
      prevModeRef.current = mode;
      outgoingContentRef.current = null;
      if (contentPhase !== 'idle') setContentPhase('idle');
    }
    prevActiveRef.current = active;
  } else if (prevModeRef.current !== mode) {
    // Set synchronously during render (not in a useEffect) — an effect runs
    // one tick after the render that changed `mode`, so there'd be a commit
    // where displayContent (below) falls through to the NEW live content
    // (since contentPhase is still 'idle' from before) before the effect
    // corrects it back to the old snapshot to actually fade out. That
    // showed up as a one-frame flash of the new content right at the click.
    outgoingContentRef.current = lastContentRef.current;
    prevModeRef.current = mode;
    setContentPhase('out');
  }
  lastContentRef.current = liveContent;

  useEffect(() => {
    if (contentPhase !== 'out') return;
    const t = setTimeout(() => {
      outgoingContentRef.current = null;
      setContentPhase('in');
    }, 250);
    return () => clearTimeout(t);
  }, [contentPhase]);

  useEffect(() => {
    if (contentPhase !== 'in') return;
    const t = setTimeout(() => setContentPhase('idle'), 250);
    return () => clearTimeout(t);
  }, [contentPhase]);

  const displayContent = contentPhase === 'out' && outgoingContentRef.current
    ? outgoingContentRef.current
    : liveContent;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  // Adjusted during render (not in a useEffect) so React resolves the phase
  // change before ever painting — an effect runs one tick after the render
  // that changed `collapsed`, so there'd be a commit where collapsed=true
  // but phase is still 'idle'. addBtnClass reads that combination as the
  // already-finished collapsed state (sidebar-add--idle-collapsed, no
  // animation, instant snap), which the browser would paint for exactly one
  // frame before the effect corrected phase — the flash the user reported.
  const prevCollapsed = useRef(collapsed);
  if (prevCollapsed.current !== collapsed) {
    setPhase(collapsed ? 'collapsing' : 'expanding');
    prevCollapsed.current = collapsed;
  }

  function handleAnimationEnd(e) {
    if (e.target === e.currentTarget && phase !== 'idle') setPhase('idle');
  }

  function restrictToYAxis({ transform }) { return { ...transform, x: 0 }; }

  function handleDragStart({ active }) { setDragId(active.id); setKebab(null); }
  function handleDragEnd({ active, over }) {
    // flushSync forces the reorder to commit to the DOM synchronously, before
    // dnd-kit measures the drop-animation's target rect — without this, the
    // dragged item visibly snaps back to its old spot before jumping to the
    // real new one on the next render.
    ReactDOM.flushSync(() => {
      setDragId(null);
      if (over && active.id !== over.id) onReorderItems(active.id, over.id);
    });
  }

  function openKebab(id, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const popH = 84;
    const y = rect.top + popH > window.innerHeight ? rect.bottom - popH : rect.top;
    setKebab({ id, x: rect.right + 6, y });
  }

  // 'outgoing' is a stable key while fading out the snapshot, so React
  // doesn't remount (and interrupt) that fade-out mid-flight; once the
  // phase flips to 'in' this becomes `mode` again, which — being a fresh
  // key value — remounts the content with the live data and restarts the
  // fade-in animation, same as the old key={mode} behavior did directly.
  const contentKey    = contentPhase === 'out' ? 'outgoing' : mode;
  const contentFadeClass = contentPhase === 'out' ? 'sidebar-content-fade--out' : 'sidebar-content-fade';
  const { crossNav: displayCrossNav, items: displayItems, itemIds: displayItemIds, selectedId: displaySelectedId,
          footerIcon: displayFooterIcon, footerLabel: displayFooterLabel, footerAlternate: displayFooterAlternate,
          emptyMessage: displayEmptyMessage,
          ItemRow: DisplayItemRow, DragClone: DisplayDragClone, KebabMenu: DisplayKebabMenu } = displayContent;
  const activeItem = displayItems.find(i => i.id === dragId);

  const layoutClass = `sidebar-layout${collapsed ? ' sidebar-layout--collapsed' : ''}`;
  const panelClass  = [
    'sidebar-panel',
    phase === 'expanding'  ? 'sidebar-panel--expanding'  : '',
    phase === 'collapsing' ? 'sidebar-panel--collapsing' : '',
  ].filter(Boolean).join(' ');
  const toggleShapeClass = [
    'sidebar-toggle-shape',
    phase === 'expanding'  ? 'sidebar-toggle-shape--expanding'  :
    phase === 'collapsing' ? 'sidebar-toggle-shape--collapsing' :
    !collapsed              ? 'sidebar-toggle-shape--expanded'   : '',
  ].filter(Boolean).join(' ');
  const toggleOutlineClass = [
    'sidebar-toggle-outline',
    phase === 'expanding'  ? 'sidebar-toggle-outline--expanding'  :
    phase === 'collapsing' ? 'sidebar-toggle-outline--collapsing' :
    !collapsed              ? 'sidebar-toggle-outline--expanded'   : '',
  ].filter(Boolean).join(' ');
  const addBtnClass = [
    'sidebar-add',
    collapsed && phase === 'idle' ? 'sidebar-add--idle-collapsed' : '',
    phase === 'expanding'  ? 'sidebar-add--expanding'  : '',
    phase === 'collapsing' ? 'sidebar-add--collapsing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={layoutClass}>
      <div className="sidebar-base" />
      <div className="sidebar-border-right" />
      <div className={panelClass} onAnimationEnd={handleAnimationEnd} />

      <div className="sidebar-content">
        <div className="sidebar-header">
          <button className="sidebar-toggle" onClick={onToggleCollapse}>
            <svg width="16" height="16" viewBox="0 0 16 16" overflow="visible" xmlns="http://www.w3.org/2000/svg">
              <path className={toggleOutlineClass} d="M 8 -5 L 21 8 L 8 21 L -5 8 Z" fill="none" />
              <path className={toggleShapeClass}   d="M 8 -1 L 17 8 L 8 17 L -1 8 Z" fill="currentColor" />
            </svg>
          </button>
          <button className="sidebar-home" title="Home" onClick={onHome}>
            <span className="sidebar-home-icon"><Home size={16} /></span>
          </button>
          <button className="sidebar-overview" title="Overview" onClick={onOverview}>
            <span className="sidebar-overview-icon"><LayoutDashboard size={16.5} /></span>
          </button>
          {/* key forces the whole button to remount on a mode switch (its
              className/onClick differ per mode — sidebar-showcase vs
              sidebar-tracker — so without a key React would just patch the
              existing node in place with no fade at all). The fade class is
              merged onto crossNav's own className here (not left inside its
              JSX in trackerComponents.js/showcaseComponents.js) so it can
              switch between fade-in and fade-out along with everything
              else's contentPhase. */}
          {React.cloneElement(displayCrossNav, {
            key: contentKey,
            className: `${displayCrossNav.props.className} ${contentFadeClass}`,
          })}
        </div>

        <DndContext
          sensors={sensors}
          modifiers={[restrictToYAxis]}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <ScrollArea style={{ flex: 1 }} viewportClassName="sidebar-nav">
            <div key={contentKey} className={contentFadeClass}>
              {displayItems.length === 0 && !collapsed && (
                <p className="sidebar-empty">{displayEmptyMessage}</p>
              )}
              <SortableContext items={displayItemIds} strategy={verticalListSortingStrategy}>
                {displayItems.map(item => (
                  <DisplayItemRow
                    key={item.id}
                    item={item}
                    selected={displaySelectedId === item.id}
                    ghost={dragId === item.id}
                    onSelect={() => { setKebab(null); onSelectItem(item.id); }}
                    onOpenKebab={e => openKebab(item.id, e)}
                  />
                ))}
              </SortableContext>
            </div>
          </ScrollArea>

          <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeItem ? (
              <DisplayDragClone item={activeItem} collapsed={collapsed} selected={displaySelectedId === dragId} />
            ) : null}
          </DragOverlay>
        </DndContext>

        <div className="sidebar-footer">
          {displayFooterAlternate ? (
            <div key={contentKey} className={contentFadeClass}>{displayFooterAlternate}</div>
          ) : (
            <button
              className={addBtnClass}
              onClick={footerOnClick}
              disabled={footerDisabled}
            >
              <span className="sidebar-add-icon">{displayFooterIcon}</span>
              {/* The mode-switch fade lives on this INNER span, not
                  .sidebar-add-text itself — .sidebar-add-text already has its
                  own collapse/expand position animation (addTextIn/Out in
                  Sidebar.css), and putting both on the same element made the
                  CSS engine see the winning `animation-name` flip back to
                  the fade-in one every time a collapse/expand finished,
                  restarting it and causing a visible flash/jump on every
                  toggle — not just on an actual mode switch. */}
              <span className="sidebar-add-text">
                <span key={contentKey} className={contentFadeClass}>{displayFooterLabel}</span>
              </span>
            </button>
          )}
        </div>

        {kebab && (
          <DisplayKebabMenu
            id={kebab.id}
            position={{ x: kebab.x, y: kebab.y }}
            onClose={() => setKebab(null)}
          />
        )}
      </div>
    </div>
  );
}
