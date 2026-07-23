// Everything specific to the Gacha Tracker sidebar: the games list, the
// Showcase cross-nav header button, and the Add Game footer button. Bundled
// into props for the shared baseline Sidebar.js (see that file) via
// useTrackerSidebarContent().
import React, { useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useAccent } from '../../contexts/AccentContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useT } from '../../i18n';
import { clampColorForTheme } from '../../utils/color';
import { Plus, MoreVertical, Edit2, Trash2, Camera } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function useTrackerSidebarContent({
  games, selectedGameId, onSelectGame, onAddGame, onEditGame, onDeleteGame, onReorderGames, onShowcase,
}) {
  const t = useT();

  const crossNav = (
    <button className="sidebar-showcase" title="Showcase" onClick={onShowcase}>
      <span className="sidebar-showcase-icon"><Camera size={16.5} /></span>
    </button>
  );

  function BoundKebabMenu({ id, position, onClose }) {
    return (
      <KebabMenu
        position={position}
        onEdit={() => { onEditGame(id); onClose(); }}
        onDelete={() => { onDeleteGame(id); onClose(); }}
        onClose={onClose}
      />
    );
  }

  return {
    items: games,
    selectedId: selectedGameId,
    onSelectItem: onSelectGame,
    onReorderItems: onReorderGames,
    ItemRow: SortableGameItem,
    DragClone: DragCloneGameItem,
    KebabMenu: BoundKebabMenu,
    emptyMessage: t('No games yet.'),
    footerIcon: <Plus size={16} />,
    footerLabel: t('Add game'),
    footerOnClick: onAddGame,
    footerDisabled: false,
    footerAlternate: null,
    crossNav,
  };
}

// ─── Item row ──────────────────────────────────────────────────────────────

function SortableGameItem({ item: game, selected, ghost, onSelect, onOpenKebab }) {
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const raw = game.usesAppColor ? accentColor : game.color;
  const gameColor = clampColorForTheme(raw, activeTheme === 'dark');
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: game.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: ghost ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="sidebar-item-row" {...attributes}>
      <button className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`} onClick={onSelect} title={game.name} {...listeners}>
        <span className="sidebar-item-icon" style={{ background: game.iconPath ? 'transparent' : gameColor }}>
          {game.iconPath
            ? <img src={game.iconPath} alt={game.name} className="sidebar-item-icon-img" decoding="sync" />
            : game.name[0]?.toUpperCase()}
        </span>
        <span className="sidebar-item-name">{game.name}</span>
        {selected && <span className="sidebar-item-indicator" />}
      </button>
      <button className="sidebar-kebab" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpenKebab(e); }} title="Options">
        <MoreVertical size={14} />
      </button>
    </div>
  );
}

function DragCloneGameItem({ item: game, collapsed, selected }) {
  const accentColor = useAccent();
  const activeTheme = useTheme();
  const raw = game.usesAppColor ? accentColor : game.color;
  const gameColor = clampColorForTheme(raw, activeTheme === 'dark');

  return (
    <div className="sidebar-item-row drag-clone">
      <button className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`} title={game.name}>
        <span className="sidebar-item-icon" style={{ background: game.iconPath ? 'transparent' : gameColor }}>
          {game.iconPath
            ? <img src={game.iconPath} alt={game.name} className="sidebar-item-icon-img" decoding="sync" />
            : game.name[0]?.toUpperCase()}
        </span>
        {!collapsed && <span className="sidebar-item-name">{game.name}</span>}
      </button>
      {!collapsed && (
        <div className="sidebar-kebab" style={{ opacity: 0.4, pointerEvents: 'none' }}>
          <MoreVertical size={14} />
        </div>
      )}
    </div>
  );
}

function KebabMenu({ position, onEdit, onDelete, onClose }) {
  const t = useT();
  const ref = useRef();

  useEffect(() => {
    function onPointer(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div ref={ref} className="kebab-popup" style={{ top: position.y, left: position.x }}>
      <button className="kebab-option" onClick={onEdit}>
        <Edit2 size={13} />
        {t('Edit')}
      </button>
      <button className="kebab-option kebab-option--danger" onClick={onDelete}>
        <Trash2 size={13} />
        {t('Delete')}
      </button>
    </div>,
    document.body
  );
}
