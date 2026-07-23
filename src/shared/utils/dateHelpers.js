// ─── Daily reset boundary ──────────────────────────────────────────────────
// All 4 games' in-game "day" resets at a fixed wall-clock instant — 05:00
// Europe/Vienna — not local midnight and not a fixed UTC offset. Intl-based
// conversion keeps this correct across DST automatically, and correct
// regardless of the system's own timezone: it's the same absolute reset
// moment everywhere, it just displays as a different local hour depending
// on where the app happens to be running (e.g. ~13:00 in Japan).
const DAILY_RESET_HOUR = 5;
const DAILY_RESET_TIMEZONE = 'Europe/Vienna';

function getTzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

// Converts a Y/M/D/H wall-clock time in `timeZone` to the equivalent UTC
// Date. Two-pass offset lookup so it stays correct across a DST boundary.
function zonedWallTimeToUtc(year, month, day, hour, timeZone) {
  let guessMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = getTzOffsetMinutes(new Date(guessMs), timeZone);
    guessMs = Date.UTC(year, month - 1, day, hour, 0, 0) - offsetMin * 60000;
  }
  return new Date(guessMs);
}

// Y/M/D (in DAILY_RESET_TIMEZONE) of the most recent daily-reset boundary
// that has already passed as of `now`.
function getMostRecentResetYmd(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DAILY_RESET_TIMEZONE, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  }).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  let year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  if (Number(parts.hour) < DAILY_RESET_HOUR) {
    const d = new Date(Date.UTC(year, month - 1, day));
    d.setUTCDate(d.getUTCDate() - 1);
    year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; day = d.getUTCDate();
  }
  return { year, month, day };
}

// Returns the most recent daily-reset boundary (a Date, in UTC) that has
// already passed as of `now`, per DAILY_RESET_HOUR/DAILY_RESET_TIMEZONE.
// Used by pullUtils.js's canClaimDailyPass for Daily Pass claim gating.
export function getMostRecentDailyReset(now = new Date()) {
  const { year, month, day } = getMostRecentResetYmd(now);
  return zonedWallTimeToUtc(year, month, day, DAILY_RESET_HOUR, DAILY_RESET_TIMEZONE);
}

// Y-M-D key of the current in-game day, per the same reset boundary as
// getMostRecentDailyReset — so History ledger rows line up with the Daily
// Pass claim button's day boundary instead of local midnight.
export function getToday() {
  const { year, month, day } = getMostRecentResetYmd(new Date());
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}
