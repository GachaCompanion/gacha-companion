import React, { useState } from 'react';
import { Pencil } from 'lucide-react';

// Shared resource/income UI primitives used by both the generic StatusTab
// (in GameDashboard.js) and NteStatusTab.js. Pulled into their own file so
// the two can both import them without a circular dependency.

export function ResourceCard({ label, value, sub, color, onSet, isInt }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function startEdit() { setDraft(String(value)); setEditing(true); }
  function commitEdit() {
    const v = isInt ? parseInt(draft, 10) : Number(draft);
    if (!isNaN(v)) onSet(v);
    setEditing(false);
  }

  return (
    <div className="resource-card">
      <div className="resource-card-top">
        <span className="stat-label">{label}</span>
        <button className="resource-edit-btn" onClick={startEdit} title="Edit directly">
          <Pencil size={12} />
        </button>
      </div>
      {editing ? (
        <input className="stat-edit-input resource-edit-input" value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          autoFocus />
      ) : (
        <span className="stat-value resource-value" style={{ color }}>{value.toLocaleString()}</span>
      )}
      <span className="stat-sub">{sub}</span>
    </div>
  );
}

export function PullItemsStepper({ label, value, color, onStep }) {
  return (
    <div className="pull-stepper">
      <span className="pull-stepper-label">{label}</span>
      <div className="pull-stepper-btns">
        <button className="pull-stepper-btn" onClick={() => onStep(-1)} disabled={value <= 0}>−</button>
        <button className="pull-stepper-btn" onClick={() => onStep(1)} style={{ color }}>+</button>
      </div>
    </div>
  );
}

export function DailyPassRow({ label, amount, active, claimable = true, onToggleActive, onClaim, color }) {
  return (
    <div className="daily-pass-row">
      <span className="income-row-label">{label}</span>
      <label className="toggle-switch">
        <input type="checkbox" checked={active} onChange={onToggleActive} />
        <span className="toggle-track" />
      </label>
      <button
        className="daily-pass-claim-btn"
        style={{ background: color }}
        onClick={onClaim}
        disabled={!claimable}
        title={claimable ? undefined : 'Already claimed — resets at 05:00'}
      >
        {claimable ? `Claim +${amount.toLocaleString()}` : 'Claimed'}
      </button>
    </div>
  );
}

export function IncomeRow({ label, color, onAdd, isInt }) {
  const [draft, setDraft] = useState('');
  const parsed = isInt ? parseInt(draft, 10) : Number(draft);
  const canAdd = draft !== '' && draft !== '-' && !isNaN(parsed) && parsed !== 0;

  function commit() {
    if (canAdd) { onAdd(parsed); setDraft(''); }
  }

  return (
    <div className="income-row">
      <span className="income-row-label">{label}</span>
      <input
        className="income-row-input"
        type="number"
        placeholder="0"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
      />
      <button
        className="income-row-btn"
        style={{ background: color }}
        onClick={commit}
        disabled={!canAdd}
      >
        Add
      </button>
    </div>
  );
}
