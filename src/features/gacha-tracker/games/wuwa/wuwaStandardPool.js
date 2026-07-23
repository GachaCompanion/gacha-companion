// WuWa standard 5-star pool — resonators that count as a 50/50 loss when
// pulled on a limited banner. Each entry maps a slugged name to the UTC+8
// datetime from which that item became standard. Launch items use a
// sentinel date well before the game existed.
//
// Weapons are intentionally NOT tracked here — WuWa's weapon banner has no
// 50/50 mechanic (you can't "lose" to an off-banner weapon), and the app's
// 50/50 rate/W-L-G stat is character-only everywhere (see computeGameStats.js).

function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// prettier-ignore
const WUWA_STANDARD_POOL = new Map([
  // Resonators — launch
  [slugKey('Encore'),   '2000-01-01 00:00:00'],
  [slugKey('Lingyang'), '2000-01-01 00:00:00'],
  [slugKey('Calcharo'), '2000-01-01 00:00:00'],
  [slugKey('Jianxin'),  '2000-01-01 00:00:00'],
  [slugKey('Verina'),   '2000-01-01 00:00:00'],
]);

// Returns true if this item was in the standard pool at the time of the pull.
// pullTime: "YYYY-MM-DD HH:mm:ss" UTC+8 (same format used throughout the app).
export function isWuwaStandardAt(name, pullTime) {
  const effectiveDate = WUWA_STANDARD_POOL.get(slugKey(name));
  if (effectiveDate === undefined) return false;
  return (pullTime ?? '') >= effectiveDate;
}
