import { getToday } from '../../../../shared/utils/dateHelpers';

// Umamusume tracks four values separately — Free Carats, Paid Carats (two
// currencies) and Trainee / Support Card Scout Tickets (two pull items). The
// shared day-by-day ledger (engine/pullUtils.js) only understands a single
// {income, pulls, total} row, so Umamusume keeps its own entry shape in the
// same `state.history` array — safe because only UmamusumeHistoryTab reads it
// for this game:
//
//   { date, freeDelta, paidDelta, traineeDelta, supportDelta,
//     freeTotal, paidTotal, traineeTotal, supportTotal, total }
//
// The *Delta fields are that day's net change, the *Total fields are the
// balance at the end of the day, and `total` is Free + Paid (the combined
// carat figure used for pull planning).
//
// `state.currency` is kept equal to Free + Paid every time a balance changes,
// so shared code that reads the single-currency field (Overview, Wish List)
// keeps working without knowing about the split.

// Umamusume's in-game day rolls over at 00:00 Japan time (= 17:00 in Vienna
// while Austria is on summer time, 16:00 in winter) — NOT the 05:00 Vienna
// boundary the other games share. Used for the ledger's day key and the daily
// claim gating.
export const UMA_RESET = { hour: 0, timeZone: 'Asia/Tokyo' };

const FIELD = { free: 'freeCarats', paid: 'paidCarats', trainee: 'charPullItems', support: 'weaponPullItems' };
const DELTA = { free: 'freeDelta', paid: 'paidDelta', trainee: 'traineeDelta', support: 'supportDelta' };
const TOTAL = { free: 'freeTotal', paid: 'paidTotal', trainee: 'traineeTotal', support: 'supportTotal' };
const KEYS = Object.keys(FIELD);

export function getBalances(state) {
  return {
    free: state.freeCarats ?? 0,
    paid: state.paidCarats ?? 0,
    trainee: state.charPullItems ?? 0,
    support: state.weaponPullItems ?? 0,
  };
}

function withTotals(entry, balances) {
  const next = { ...entry };
  for (const k of KEYS) next[TOTAL[k]] = balances[k];
  next.total = balances.free + balances.paid;
  return next;
}

// Returns history with today's entry updated: `deltas` (already clamped to
// what actually changed) are added onto today's running deltas, and the
// *Total fields are overwritten with the balances after the change.
function recordToday(history, deltas, before, after) {
  const today = getToday(UMA_RESET);
  const last = history[history.length - 1];
  const base = last?.date === today
    ? last
    : withTotals({ date: today, freeDelta: 0, paidDelta: 0, traineeDelta: 0, supportDelta: 0 }, before);
  const updated = { ...base };
  for (const k of KEYS) updated[DELTA[k]] = (updated[DELTA[k]] ?? 0) + (deltas[k] ?? 0);
  const finalEntry = withTotals(updated, after);
  return last?.date === today ? [...history.slice(0, -1), finalEntry] : [...history, finalEntry];
}

function applyBalances(state, after, history) {
  return {
    ...state,
    freeCarats: after.free,
    paidCarats: after.paid,
    charPullItems: after.trainee,
    weaponPullItems: after.support,
    currency: after.free + after.paid,
    history,
  };
}

// Adds signed per-field deltas (e.g. { free: 150 }, { trainee: -1 }). A
// balance never goes below 0, and the ledger records what actually changed.
export function applyDeltas(state, deltas) {
  const before = getBalances(state);
  const after = {};
  const actual = {};
  for (const k of KEYS) {
    after[k] = Math.max(0, before[k] + (deltas[k] ?? 0));
    actual[k] = after[k] - before[k];
  }
  return applyBalances(state, after, recordToday(state.history ?? [], actual, before, after));
}

// Overwrites one balance directly (the pencil "edit value" action). Not a
// delta — today's income/spend figures are left alone, only the end-of-day
// balances change, same as setTodayTotal in the shared ledger.
export function setBalance(state, key, value) {
  const before = getBalances(state);
  const after = { ...before, [key]: Math.max(0, Math.floor(Number(value) || 0)) };
  return applyBalances(state, after, recordToday(state.history ?? [], {}, before, after));
}

// Spending takes Free Carats first, and only dips into Paid Carats once Free
// runs out (the in-game order, per the user). Capped at what's available.
export function spendCarats(state, amount) {
  const before = getBalances(state);
  const wanted = Math.max(0, Math.floor(Number(amount) || 0));
  const fromFree = Math.min(before.free, wanted);
  const fromPaid = Math.min(before.paid, wanted - fromFree);
  return applyDeltas(state, { free: -fromFree, paid: -fromPaid });
}

// History editing: `edits` is { 'YYYY-MM-DD': { free, paid, trainee, support } }
// — what the player actually had at the END of that day. Those balances are
// the source of truth: each day's total is Free + Paid, and every day's
// change (the *Delta fields) is recomputed as its balance minus the previous
// day's. The balance before the ledger's first entry is the one that entry
// originally implied (its total minus its delta), kept constant so editing
// never invents or loses opening carats. A day with no entry yet gets one.
// Only when TODAY is edited do the live balances change to match — an edit to
// a past day never alters what you currently have.
export function applyBalanceEdits(state, edits) {
  const history = state.history ?? [];
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const first = [...history].sort(byDate)[0];
  const opening = Object.fromEntries(KEYS.map(k => [k, first ? (first[TOTAL[k]] ?? 0) - (first[DELTA[k]] ?? 0) : 0]));

  const entries = new Map(history.map(e => [e.date, e]));
  for (const [date, vals] of Object.entries(edits)) {
    const balances = Object.fromEntries(KEYS.map(k => [k, Math.max(0, Math.floor(Number(vals[k]) || 0))]));
    entries.set(date, withTotals(entries.get(date) ?? { date }, balances));
  }

  let prev = opening;
  const nextHistory = [...entries.values()].sort(byDate).map(e => {
    const cur = Object.fromEntries(KEYS.map(k => [k, e[TOTAL[k]] ?? 0]));
    const row = { ...e };
    for (const k of KEYS) row[DELTA[k]] = cur[k] - prev[k];
    prev = cur;
    return row;
  });

  const todayEdit = edits[getToday(UMA_RESET)];
  if (!todayEdit) return { ...state, history: nextHistory };
  const live = Object.fromEntries(KEYS.map(k => [k, Math.max(0, Math.floor(Number(todayEdit[k]) || 0))]));
  return applyBalances(state, live, nextHistory);
}
