import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '../../../../shared/i18n';
import { getToday } from '../../../../shared/utils/dateHelpers';
import { resolveGameCurrency } from '../../engine/gameSchema';
import { UMA_RESET, applyBalanceEdits } from './umamusumeLedger';
import { ScrollArea } from '../../../../shared/components/ScrollArea';
import '../../components/HistoryTab.css';
import './UmamusumeHistoryTab.css';

// Day-by-day ledger for Umamusume — the shared IncomeHistoryView
// (components/HistoryTab.js) only understands {income, pulls, total}, so this
// reads the four-field entries umamusumeLedger.js writes instead. Read-only
// Editing overrides each day's end-of-day BALANCES (see applyBalanceEdits in
// umamusumeLedger.js); the table normally shows each day's changes. Reuses
// HistoryTab.css's classes for the look.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function emptyDay(date, last) {
  return {
    date, freeDelta: 0, paidDelta: 0, traineeDelta: 0, supportDelta: 0,
    freeTotal: last?.freeTotal ?? 0, paidTotal: last?.paidTotal ?? 0,
    traineeTotal: last?.traineeTotal ?? 0, supportTotal: last?.supportTotal ?? 0,
    total: last?.total ?? 0,
  };
}

// One row per calendar day in [startDate, endDate], carrying the last known
// balances through days with no activity.
function fillGaps(history, startDate, endDate) {
  if (history.length === 0) return [];
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map(e => [e.date, e]));
  let last = [...sorted].reverse().find(e => e.date < startDate) ?? null;
  const rows = [];
  const cur = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  while (cur <= end) {
    const key = localDateKey(cur);
    const entry = byDate.get(key);
    if (entry) { last = entry; rows.push(entry); } else rows.push(emptyDay(key, last));
    cur.setDate(cur.getDate() + 1);
  }
  return rows;
}

function DeltaCell({ value }) {
  if (!value) return <span className="history-zero">—</span>;
  return <span className={value < 0 ? 'history-negative' : undefined}>{value.toLocaleString()}</span>;
}

const FIELDS = [['free', 'freeTotal'], ['paid', 'paidTotal'], ['trainee', 'traineeTotal'], ['support', 'supportTotal']];

export default function UmamusumeHistoryTab({ game, onUpdate, color }) {
  const t = useT();
  const { pullItemName: traineeLabel, weaponPullItemName: supportLabel } = resolveGameCurrency(game);
  const history = game.state.history ?? [];
  const today = getToday(UMA_RESET);
  const nowYear = Number(today.slice(0, 4));
  const nowMonth = Number(today.slice(5, 7));

  const years = useMemo(() => {
    const seen = new Set(history.map(e => e.date.slice(0, 4)));
    seen.add(String(nowYear));
    return [...seen].sort();
  }, [history, nowYear]);

  const [filter, setFilter] = useState('latest');
  const [selMonth, setSelMonth] = useState(nowMonth);
  const [selYear, setSelYear] = useState(nowYear);

  const rows = useMemo(() => {
    if (history.length === 0) return [];
    if (filter === 'latest') return [...history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    const mm = String(selMonth).padStart(2, '0');
    const startDate = filter === 'month' ? `${selYear}-${mm}-01` : `${selYear}-01-01`;
    const rawEnd = filter === 'month'
      ? `${selYear}-${mm}-${String(new Date(selYear, selMonth, 0).getDate()).padStart(2, '0')}`
      : `${selYear}-12-31`;
    if (startDate > today) return [];
    return fillGaps(history, startDate, rawEnd > today ? today : rawEnd).reverse();
  }, [filter, history, selMonth, selYear, today]);

  const summary = useMemo(() => {
    if (filter === 'latest') return null;
    const sum = key => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
    return { free: sum('freeDelta'), paid: sum('paidDelta'), trainee: sum('traineeDelta'), support: sum('supportDelta') };
  }, [filter, rows]);

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});

  function enterEdit() {
    const initial = {};
    for (const row of rows) {
      initial[row.date] = Object.fromEntries(FIELDS.map(([k, totalKey]) => [k, String(row[totalKey] ?? 0)]));
    }
    setDrafts(initial);
    setEditing(true);
  }

  const cancelEdit = useCallback(() => { setEditing(false); setDrafts({}); }, []);

  // Only rows whose balances actually changed are sent — otherwise every
  // empty day in a month/year view would be turned into a real ledger entry.
  function saveEdit() {
    const edits = {};
    for (const row of rows) {
      const d = drafts[row.date];
      if (d && FIELDS.some(([k, totalKey]) => Number(d[k] || 0) !== (row[totalKey] ?? 0))) edits[row.date] = d;
    }
    if (Object.keys(edits).length > 0) onUpdate({ ...game, state: applyBalanceEdits(game.state, edits) });
    cancelEdit();
  }

  function patchDraft(date, field, value) {
    setDrafts(prev => ({ ...prev, [date]: { ...prev[date], [field]: value } }));
  }

  useEffect(() => {
    if (!editing) return;
    function onKey(e) { if (e.key === 'Escape') cancelEdit(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, cancelEdit]);

  return (
    <ScrollArea style={{ flex: 1, minHeight: 0, maxWidth: '760px' }} viewportClassName="history-tab">
      <div className="history-filter-bar">
        <div className="history-filter-row">
          <div className="history-filter-toggles">
            {[['latest', t('Latest')], ['month', t('By Month')], ['year', t('By Year')]].map(([key, label]) => (
              <button key={key}
                className={`history-filter-btn ${filter === key ? 'history-filter-btn--active' : ''}`}
                style={filter === key ? { borderBottomColor: color, color } : {}}
                onClick={() => { setFilter(key); if (editing) cancelEdit(); }}>
                {label}
              </button>
            ))}
          </div>
          <div className="history-edit-controls">
            {editing ? (
              <>
                <button className="history-action-btn history-action-btn--ghost" onClick={cancelEdit}>{t('Cancel')}</button>
                <button className="history-action-btn history-action-btn--primary" style={{ background: color }} onClick={saveEdit}>{t('Save')}</button>
              </>
            ) : (
              <button className="history-action-btn history-action-btn--ghost" onClick={enterEdit} disabled={rows.length === 0}>{t('Edit')}</button>
            )}
          </div>
        </div>
        {filter === 'month' && (
          <div className="history-dropdowns">
            <select className="history-select" value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
            </select>
            <select className="history-select" value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        {filter === 'year' && (
          <div className="history-dropdowns">
            <select className="history-select" value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
      </div>

      {summary && (
        <div className="history-summary">
          {[[t('Free Carats'), summary.free], [t('Paid Carats'), summary.paid],
            [traineeLabel, summary.trainee], [supportLabel, summary.support]].map(([label, value], i) => (
            <React.Fragment key={label}>
              {i > 0 && <span className="history-summary-sep" />}
              <span className="history-summary-item">
                <span className="history-summary-label">{label}</span>
                <span className="history-summary-value" style={{ color }}>{value.toLocaleString()}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="history-empty">{t('No history recorded yet.')}</p>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table uma-history-table">
            <thead>
              <tr>
                <th className="history-th-date">{t('Date')}</th>
                <th className="history-th-center">{t('Free')}</th>
                <th className="history-th-center">{t('Paid')}</th>
                <th className="history-th-center" title={traineeLabel}>{t('Trainee')}</th>
                <th className="history-th-center" title={supportLabel}>{t('Support')}</th>
                <th className="history-th-right">{t('Total Carats')}</th>
              </tr>
              {editing && (
                <tr>
                  <th colSpan={6} className="uma-history-edit-note">
                    {t('Editing end-of-day balances. Total = Free + Paid; changes recalculate from the day before.')}
                  </th>
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map(row => {
                const isToday = row.date === today;
                const draft = drafts[row.date];
                const editingRow = editing && draft;
                return (
                  <tr key={row.date} className={isToday ? 'history-row--today' : ''}>
                    <td className="history-date">
                      {formatDate(row.date)}
                      {isToday && <span className="history-today-badge">{t('today')}</span>}
                    </td>
                    {FIELDS.map(([k]) => (
                      <td key={k} className="history-td-center">
                        {editingRow
                          ? <input className="history-edit-input" type="number" min="0" value={draft[k]}
                              onChange={e => patchDraft(row.date, k, e.target.value)} />
                          : <DeltaCell value={row[k + 'Delta']} />}
                      </td>
                    ))}
                    <td className="history-td-right history-total" style={{ color }}
                      title={`${t('Free')}: ${(row.freeTotal ?? 0).toLocaleString()} · ${t('Paid')}: ${(row.paidTotal ?? 0).toLocaleString()}`}>
                      {(editingRow
                        ? (Number(draft.free) || 0) + (Number(draft.paid) || 0)
                        : (row.total ?? 0)).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ScrollArea>
  );
}
