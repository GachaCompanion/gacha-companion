import React, { useState, useEffect } from 'react';
import { X, Pencil, Trash2, Check, Plus, Download } from 'lucide-react';
import ConfirmDialog from '../shared/components/ConfirmDialog';
import './ProfileModal.css';

export default function ProfileModal({ onClose }) {
  const [profiles, setProfiles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isClosing, setIsClosing] = useState(false);
  const [switching, setSwitching] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editError, setEditError] = useState('');

  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }
  const [switchTarget, setSwitchTarget] = useState(null); // { id, name }

  const [exportError, setExportError] = useState(null); // { id, message }

  // Import — dragging a backup zip onto the "Add profile" button.
  const [importDragging, setImportDragging] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { zipPath, profileName, exportedAt }
  const [importError, setImportError] = useState('');
  const [importMode, setImportMode] = useState('new'); // 'new' | 'overwrite'
  const [importNewName, setImportNewName] = useState('');
  const [importNewError, setImportNewError] = useState('');
  const [importTargetId, setImportTargetId] = useState('');
  const [importOverwriteConfirm, setImportOverwriteConfirm] = useState(null); // { id, name }

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    const res = await window.api?.listProfiles();
    if (res) {
      setProfiles(res.profiles ?? []);
      setActiveId(res.activeProfileId ?? null);
    }
  }

  function requestClose() { setIsClosing(true); }

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (deleteTarget || switchTarget || importOverwriteConfirm) return;
      if (importPreview) { cancelImport(); return; }
      requestClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteTarget, switchTarget, importOverwriteConfirm, importPreview]); // eslint-disable-line

  function handleSwitch(p) {
    if (p.id === activeId || switching) return;
    setSwitchTarget(p);
  }

  // Switching profiles relaunches the whole app (see electron/main.js) — every
  // storage directory and local server is only ever set up once at startup.
  async function confirmSwitch() {
    if (!switchTarget) return;
    setSwitching(true);
    setSwitchTarget(null);
    await window.api?.switchProfile(switchTarget.id);
  }

  function startRename(p) {
    setEditingId(p.id);
    setEditValue(p.name);
    setEditError('');
  }

  async function confirmRename(id) {
    const res = await window.api?.renameProfile(id, editValue);
    if (!res?.ok) { setEditError(res?.error ?? 'Could not rename.'); return; }
    setEditingId(null);
    await refresh();
  }

  function startAdd() {
    setAddingNew(true);
    setNewName('');
    setNewError('');
  }

  async function confirmAdd() {
    const res = await window.api?.createProfile(newName);
    if (!res?.ok) { setNewError(res?.error ?? 'Could not create profile.'); return; }
    setAddingNew(false);
    setNewName('');
    await refresh();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    await window.api?.deleteProfile(deleteTarget.id);
    setDeleteTarget(null);
    await refresh();
  }

  async function handleExport(p) {
    setExportError(null);
    const res = await window.api?.exportProfile(p.id);
    if (!res?.ok && !res?.cancelled) setExportError({ id: p.id, message: res?.error ?? 'Export failed.' });
  }

  // Dragging a backup zip onto "+ Add profile" imports instead of creating —
  // a plain click still just does the normal empty-new-profile flow.
  async function startImportFromPath(zipPath) {
    setImportError('');
    const res = await window.api?.inspectImportZip(zipPath);
    if (!res?.ok) { setImportError(res?.error ?? 'Not a valid profile backup.'); return; }
    setImportPreview({ zipPath, profileName: res.profileName, exportedAt: res.exportedAt });
    setImportMode('new');
    setImportNewName(res.profileName);
    setImportNewError('');
    setImportTargetId('');
  }

  function handleAddDragOver(e) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    // preventDefault() alone allows the drop, but the OS-drawn cursor icon
    // (plus/blocked) during the drag is driven separately by dropEffect —
    // without this it shows the "not allowed" icon even though dropping
    // would actually work fine.
    e.dataTransfer.dropEffect = 'copy';
    setImportDragging(true);
  }
  function handleAddDragLeave() { setImportDragging(false); }

  async function handleAddDrop(e) {
    e.preventDefault();
    setImportDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    await startImportFromPath(file.path);
  }

  function cancelImport() {
    setImportPreview(null);
    setImportError('');
  }

  async function submitImport() {
    if (!importPreview) return;
    if (importMode === 'new') {
      const trimmed = importNewName.trim();
      if (!trimmed) { setImportNewError('Name cannot be empty.'); return; }
      const res = await window.api?.importProfile({ zipPath: importPreview.zipPath, targetProfileId: null, newName: trimmed });
      if (!res?.ok) { setImportNewError(res?.error ?? 'Import failed.'); return; }
      setImportPreview(null);
      await refresh();
      return;
    }
    // Overwrite mode — always confirm first, it's destructive either way.
    const target = profiles.find(p => p.id === importTargetId);
    if (!target) { setImportNewError('Pick a profile to overwrite.'); return; }
    setImportOverwriteConfirm(target);
  }

  async function confirmImportOverwrite() {
    if (!importOverwriteConfirm || !importPreview) return;
    const res = await window.api?.importProfile({ zipPath: importPreview.zipPath, targetProfileId: importOverwriteConfirm.id });
    setImportOverwriteConfirm(null);
    if (!res?.ok) { setImportError(res?.error ?? 'Import failed.'); return; }
    // If we just overwrote the active profile, the app is already relaunching.
    if (importOverwriteConfirm.id !== activeId) {
      setImportPreview(null);
      await refresh();
    }
  }

  function handleOverlayClick(e) {
    if (e.target !== e.currentTarget) return;
    if (deleteTarget || switchTarget || importOverwriteConfirm) return;
    if (importPreview) { cancelImport(); return; }
    requestClose();
  }

  return (
    <div
      className={`modal-overlay${isClosing ? ' modal-overlay--closing' : ''}`}
      onMouseDown={handleOverlayClick}
    >
      <div
        className={`modal profile-modal${isClosing ? ' profile-modal--closing' : ''}`}
        onAnimationEnd={() => { if (isClosing) onClose(); }}
      >
        <div className="modal-header">
          <h2 className="modal-title">Profiles</h2>
          <button className="modal-close" onClick={requestClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          {switching && <p className="profile-switching-hint">Switching profile — the app will restart…</p>}

          <div className="profile-list">
            {profiles.map(p => (
              <div key={p.id} className={`profile-row${p.id === activeId ? ' profile-row--active' : ''}`}>
                {editingId === p.id ? (
                  <div className="profile-row__edit">
                    <input
                      className={`input${editError ? ' input--error' : ''}`}
                      value={editValue}
                      onChange={e => { setEditValue(e.target.value); setEditError(''); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') confirmRename(p.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      maxLength={40}
                    />
                    <button className="profile-row__icon-btn profile-row__icon-btn--confirm" onClick={() => confirmRename(p.id)} title="Save">
                      <Check size={14} />
                    </button>
                    {editError && <p className="field-error">{editError}</p>}
                  </div>
                ) : (
                  <>
                    <button
                      className="profile-row__name"
                      onClick={() => handleSwitch(p)}
                      disabled={switching}
                      title={p.id === activeId ? 'Current profile' : 'Switch to this profile'}
                    >
                      {p.name}
                      {p.id === activeId && <span className="profile-row__badge">Active</span>}
                    </button>
                    <button className="profile-row__icon-btn" onClick={() => startRename(p)} title="Rename" disabled={switching}>
                      <Pencil size={13} />
                    </button>
                    <button className="profile-row__icon-btn" onClick={() => handleExport(p)} title="Download backup" disabled={switching}>
                      <Download size={13} />
                    </button>
                    <button
                      className="profile-row__icon-btn profile-row__icon-btn--danger"
                      onClick={() => setDeleteTarget(p)}
                      title={p.id === activeId ? 'Switch away before deleting' : 'Delete'}
                      disabled={switching || p.id === activeId || profiles.length <= 1}
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
                {exportError?.id === p.id && <p className="field-error">{exportError.message}</p>}
              </div>
            ))}
          </div>

          {importPreview ? (
            <div className="profile-import">
              <p className="profile-import__title">Importing backup of "{importPreview.profileName}"</p>
              <p className="profile-import__date">Exported {new Date(importPreview.exportedAt).toLocaleDateString()}</p>

              <div className="toggle-group">
                <button
                  className={`toggle-btn${importMode === 'new' ? ' toggle-btn--active' : ''}`}
                  onClick={() => { setImportMode('new'); setImportNewError(''); }}
                >
                  New profile
                </button>
                <button
                  className={`toggle-btn${importMode === 'overwrite' ? ' toggle-btn--active' : ''}`}
                  onClick={() => { setImportMode('overwrite'); setImportNewError(''); }}
                >
                  Overwrite existing
                </button>
              </div>

              {importMode === 'new' ? (
                <input
                  className={`input${importNewError ? ' input--error' : ''}`}
                  placeholder="Profile name…"
                  value={importNewName}
                  onChange={e => { setImportNewName(e.target.value); setImportNewError(''); }}
                  maxLength={40}
                />
              ) : (
                <select
                  className={`input${importNewError ? ' input--error' : ''}`}
                  value={importTargetId}
                  onChange={e => { setImportTargetId(e.target.value); setImportNewError(''); }}
                >
                  <option value="">Select a profile…</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.id === activeId ? ' (active)' : ''}</option>
                  ))}
                </select>
              )}
              {importNewError && <p className="field-error">{importNewError}</p>}

              <div className="profile-add__actions">
                <button className="btn btn-ghost" onClick={cancelImport}>Cancel</button>
                <button className="btn btn-primary" onClick={submitImport}>Import</button>
              </div>
            </div>
          ) : addingNew ? (
            <div className="profile-add">
              <input
                className={`input${newError ? ' input--error' : ''}`}
                placeholder="Profile name…"
                value={newName}
                onChange={e => { setNewName(e.target.value); setNewError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAdd();
                  if (e.key === 'Escape') setAddingNew(false);
                }}
                autoFocus
                maxLength={40}
              />
              <div className="profile-add__actions">
                <button className="btn btn-ghost" onClick={() => setAddingNew(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={confirmAdd}>Save</button>
              </div>
              {newError && <p className="field-error">{newError}</p>}
            </div>
          ) : (
            <>
              <div className="profile-action-row">
                <button
                  type="button"
                  className={`btn btn-ghost profile-add-main-btn${importDragging ? ' profile-add-main-btn--drag' : ''}`}
                  onClick={startAdd}
                  disabled={switching}
                  onDragEnter={handleAddDragOver}
                  onDragOver={handleAddDragOver}
                  onDragLeave={handleAddDragLeave}
                  onDrop={handleAddDrop}
                  title="Add a new profile, or drop a backup .zip to import one"
                >
                  <span className="profile-add-main-btn__row">
                    <Plus size={15} />
                    Add profile
                  </span>
                  <span className="profile-import-hint">or drag a backup .zip here to import one</span>
                </button>
              </div>
              {importError && <p className="field-error">{importError}</p>}
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete this profile?"
          message={`"${deleteTarget.name}" and all of its data — settings, linked games, pull history, backgrounds, and icons — will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete profile"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {switchTarget && (
        <ConfirmDialog
          title="Switch profile?"
          message={`The app will restart to switch to "${switchTarget.name}".`}
          confirmLabel="Switch & restart"
          onConfirm={confirmSwitch}
          onCancel={() => setSwitchTarget(null)}
        />
      )}

      {importOverwriteConfirm && (
        <ConfirmDialog
          title="Overwrite this profile?"
          message={
            importOverwriteConfirm.id === activeId
              ? `"${importOverwriteConfirm.name}" is your active profile. Its settings, games, backgrounds, and icons will be replaced with the imported backup, and the app will restart to apply the change. This cannot be undone.`
              : `"${importOverwriteConfirm.name}" and all of its current data will be replaced with the imported backup. This cannot be undone.`
          }
          confirmLabel={importOverwriteConfirm.id === activeId ? 'Overwrite & restart' : 'Overwrite'}
          danger
          onConfirm={confirmImportOverwrite}
          onCancel={() => setImportOverwriteConfirm(null)}
        />
      )}
    </div>
  );
}
