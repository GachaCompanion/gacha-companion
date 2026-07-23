import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Upload } from 'lucide-react';
import '../../../shared/components/Modal.css';
import './HsrBackupImportModal.css';

// Replaces the old native 3-button dialog (Use My Own Backup / Get Mine From
// StarRailStation / I Don't Have One) — that "I Don't Have One" path silently
// patched a bundled empty-account template, which was a real risk if the user
// actually had data on StarRailStation but didn't realize it (their real data
// would never make it into the exported file). Now there's exactly one path:
// the user always provides a real .dat downloaded from StarRailStation, even
// for a brand new account (its "empty" export is equivalent to what the old
// bundled template was standing in for) — nothing can be silently skipped.
export default function HsrBackupImportModal({ onSubmit, onCancel }) {
  const [isClosing, setIsClosing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);
  const pendingAction = useRef(null);

  function handleAction(cb) {
    pendingAction.current = cb;
    setIsClosing(true);
  }

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') handleAction(onCancel); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]); // eslint-disable-line

  async function handleFile(file) {
    if (!file || !file.name.toLowerCase().endsWith('.dat')) return;
    const buffer = await file.arrayBuffer();
    handleAction(() => onSubmit(buffer));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  function onFileInput(e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  }

  return (
    <motion.div
      className="modal-overlay confirm-overlay modal-overlay--motion"
      initial={{ opacity: 0 }}
      animate={{ opacity: isClosing ? 0 : 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (isClosing && pendingAction.current) pendingAction.current();
      }}
    >
      <motion.div
        className="modal confirm-modal hsr-backup-modal"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: isClosing ? 0 : 1, y: isClosing ? 12 : 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <div className="modal-header">
          <h2 className="modal-title">Export History</h2>
        </div>
        <div className="modal-body">
          <p className="confirm-message">
            Please download the latest .dat file on StarRailStation.{' '}
            <a
              href="#"
              className="hsr-backup-link"
              onClick={e => { e.preventDefault(); window.api.openExternal('https://starrailstation.com/en/warp#settings'); }}
            >
              Click this link
            </a>{' '}
            to open the website or navigate to it yourself. Once downloaded, please drop the file below here:
          </p>

          <div
            className={`icon-uploader hsr-backup-dropzone${dragging ? ' icon-uploader--drag' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input ref={inputRef} type="file" accept=".dat" style={{ display: 'none' }} onChange={onFileInput} />
            <div className="icon-empty-state">
              <Upload size={20} />
              <span>Drop your .dat file here, or click to browse</span>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => handleAction(onCancel)}>Cancel</button>
        </div>
      </motion.div>
    </motion.div>
  );
}
