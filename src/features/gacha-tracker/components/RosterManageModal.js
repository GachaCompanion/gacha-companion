import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { useT } from '../../../shared/i18n';
import { ScrollArea } from '../../../shared/components/ScrollArea';
import '../../../shared/components/Modal.css';
import './RosterManageModal.css';

// Lowercase substring match anywhere in the name — "kami"/"ay"/"aya" all
// find "Kamisato Ayaka" (not word-prefix — see CostCalculatorTab.js memory).
function matches(name, query) {
  return name.toLowerCase().includes(query.toLowerCase());
}

// One combined list of every owned character — each row is either "Add" (not
// currently on the Roster) or "Remove" (currently shown, auto-maxed or
// manual alike). Replaces the old separate "Edit mode" toggle + inline
// search combobox: one surface for both directions, consistent with this
// app's existing modal pattern (AddGameModal/EditGameModal/ConfirmDialog)
// instead of fighting the tab bar for header space.
export default function RosterManageModal({ r, onClose }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  function close() { setIsClosing(true); }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  const shownNames = new Set(r.displayed.map(c => c.name));
  // Already-on-the-Roster characters first (so removing one is a quick scan
  // at the top), alphabetical within each block.
  const rows = [...r.displayed, ...r.candidates].sort((a, b) =>
    (shownNames.has(b.name) - shownNames.has(a.name)) || a.name.localeCompare(b.name));
  const filtered = query ? rows.filter(c => matches(c.name, query)) : rows;

  return (
    <motion.div
      className="modal-overlay modal-overlay--motion"
      initial={{ opacity: 0 }}
      animate={{ opacity: isClosing ? 0 : 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onAnimationComplete={() => { if (isClosing) onClose(); }}
      onMouseDown={e => { if (e.target === e.currentTarget) close(); }}
    >
      <motion.div
        className="modal roster-manage-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">{t('Manage Roster')}</h2>
          <button className="modal-close" onClick={close} title={t('Close')}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body roster-manage-body">
          <input
            autoFocus
            className="input"
            type="text"
            value={query}
            placeholder={t('Search characters...')}
            onChange={e => setQuery(e.target.value)}
          />
          <ScrollArea className="roster-manage-list-wrap" viewportClassName="roster-manage-list">
            {filtered.length === 0 && (
              <p className="roster-manage-empty">{t('No matches')}</p>
            )}
            {filtered.map(c => {
              const shown = shownNames.has(c.name);
              return (
                <div key={c.name} className="roster-manage-row">
                  <span className="roster-manage-name">{c.name}</span>
                  <button
                    type="button"
                    className={`btn ${shown ? 'btn-danger' : 'btn-primary'} roster-manage-action`}
                    onClick={() => (shown ? r.removeCharacter(c.name) : r.addCharacter(c.name))}
                  >
                    {shown ? t('Remove') : t('Add')}
                  </button>
                </div>
              );
            })}
          </ScrollArea>
        </div>
      </motion.div>
    </motion.div>
  );
}
