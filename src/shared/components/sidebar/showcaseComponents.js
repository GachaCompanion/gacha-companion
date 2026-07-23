// Everything specific to the Showcase sidebar: the saved builds list, the
// Gacha Tracker cross-nav header button, and the Save Build footer button
// (including its inline name-entry row and the per-item rename flow).
// Bundled into props for the shared baseline Sidebar.js via
// useShowcaseSidebarContent().
import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Bookmark, Check, X, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import DiamondIcon from '../DiamondIcon';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './showcaseComponents.css';

export function useShowcaseSidebarContent({
  savedBuilds, selectedBuildId, onSelectBuild, onSaveBuild, onDeleteBuild, onRenameBuild, onReorderBuilds, onTracker,
  canSaveBuild, defaultSaveName,
}) {
  const [saving,    setSaving]    = useState(false);
  const [saveName,  setSaveName]  = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName,  setEditName]  = useState('');

  function startSave() {
    setSaveName(defaultSaveName ?? '');
    setSaving(true);
  }
  function confirmSave() {
    if (saveName.trim()) onSaveBuild(saveName.trim());
    setSaving(false);
    setSaveName('');
  }
  function cancelSave() { setSaving(false); setSaveName(''); }

  function startEdit(id, currentName) {
    setEditingId(id);
    setEditName(currentName);
  }
  function confirmEdit() {
    if (editName.trim()) onRenameBuild(editingId, editName.trim());
    setEditingId(null);
  }
  function cancelEdit() { setEditingId(null); }

  const crossNav = (
    <button className="sidebar-tracker" title="Gacha Tracker" onClick={onTracker}>
      <span className="sidebar-tracker-icon"><DiamondIcon size={16.5} /></span>
    </button>
  );

  function BoundItemRow({ item, selected, ghost, onSelect, onOpenKebab }) {
    return (
      <SortableBuildItem
        build={item}
        selected={selected}
        ghost={ghost}
        editing={editingId === item.id}
        editName={editName}
        onEditNameChange={setEditName}
        onConfirmEdit={confirmEdit}
        onCancelEdit={cancelEdit}
        onSelect={onSelect}
        onOpenKebab={onOpenKebab}
      />
    );
  }

  function BoundDragClone({ item, collapsed, selected }) {
    return <DragCloneBuildItem build={item} collapsed={collapsed} selected={selected} />;
  }

  function BoundKebabMenu({ id, position, onClose }) {
    const build = savedBuilds.find(b => b.id === id);
    return (
      <BuildKebabMenu
        position={position}
        onRename={() => { startEdit(id, build?.name ?? ''); onClose(); }}
        onDelete={() => { onDeleteBuild(id); onClose(); }}
        onClose={onClose}
      />
    );
  }

  const footerAlternate = saving ? (
    <div className="showcase-sidebar-save-row">
      <input
        className="showcase-sidebar-save-input"
        value={saveName}
        onChange={e => setSaveName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') confirmSave();
          if (e.key === 'Escape') cancelSave();
        }}
        placeholder="Build name…"
        autoFocus
      />
      <button className="showcase-sidebar-inline-btn showcase-sidebar-inline-btn--confirm" onClick={confirmSave} disabled={!saveName.trim()} title="Save">
        <Check size={13} />
      </button>
      <button className="showcase-sidebar-inline-btn" onClick={cancelSave} title="Cancel">
        <X size={13} />
      </button>
    </div>
  ) : null;

  return {
    items: savedBuilds,
    selectedId: selectedBuildId,
    onSelectItem: onSelectBuild,
    onReorderItems: onReorderBuilds,
    ItemRow: BoundItemRow,
    DragClone: BoundDragClone,
    KebabMenu: BoundKebabMenu,
    emptyMessage: 'No saved builds.',
    footerIcon: <Bookmark size={16} />,
    footerLabel: 'Save Build',
    footerOnClick: startSave,
    footerDisabled: !canSaveBuild,
    footerAlternate,
    crossNav,
  };
}

// ─── Item row ──────────────────────────────────────────────────────────────

function SortableBuildItem({
  build, selected, ghost,
  editing, editName, onEditNameChange, onConfirmEdit, onCancelEdit,
  onSelect, onOpenKebab,
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: build.id });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity:    ghost ? 0 : 1,
  };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="sidebar-item-row showcase-sidebar-item-row--editing" {...attributes}>
        <BuildIcon icon={build.build?.smallIcon} name={build.name} />
        <input
          className="showcase-sidebar-edit-input"
          value={editName}
          onChange={e => onEditNameChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onConfirmEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
        <button className="showcase-sidebar-inline-btn showcase-sidebar-inline-btn--confirm" onClick={onConfirmEdit} disabled={!editName.trim()} title="Save">
          <Check size={12} />
        </button>
        <button className="showcase-sidebar-inline-btn" onClick={onCancelEdit} title="Cancel">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className="sidebar-item-row" {...attributes}>
      <button className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`} onClick={onSelect} title={build.name} {...listeners}>
        <BuildIcon icon={build.build?.smallIcon} name={build.name} />
        <span className="sidebar-item-name">{build.name}</span>
        {selected && <span className="sidebar-item-indicator" />}
      </button>
      <button className="sidebar-kebab" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onOpenKebab(e); }} title="Options">
        <MoreVertical size={14} />
      </button>
    </div>
  );
}

function DragCloneBuildItem({ build, collapsed, selected }) {
  return (
    <div className="sidebar-item-row drag-clone">
      <button className={`sidebar-item ${selected ? 'sidebar-item--active' : ''}`} title={build.name}>
        <BuildIcon icon={build.build?.smallIcon} name={build.name} />
        {!collapsed && <span className="sidebar-item-name">{build.name}</span>}
      </button>
      {!collapsed && (
        <div className="sidebar-kebab" style={{ opacity: 0.4, pointerEvents: 'none' }}>
          <MoreVertical size={14} />
        </div>
      )}
    </div>
  );
}

function BuildIcon({ icon, name }) {
  return (
    <span className="sidebar-item-icon showcase-sidebar-build-icon">
      {icon
        ? <img src={icon} alt={name} className="sidebar-item-icon-img" decoding="sync" />
        : <span className="showcase-sidebar-build-icon__fallback">{name?.[0]?.toUpperCase()}</span>
      }
    </span>
  );
}

function BuildKebabMenu({ position, onRename, onDelete, onClose }) {
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
      <button className="kebab-option" onClick={onRename}>
        <Edit2 size={13} /> Rename
      </button>
      <button className="kebab-option kebab-option--danger" onClick={onDelete}>
        <Trash2 size={13} /> Delete
      </button>
    </div>,
    document.body
  );
}
