// ZZZ standard 5-star pool — characters and W-engines that count as a 50/50 loss
// when pulled on a limited banner. Each entry maps a slugged name to the UTC+8
// datetime from which that item became standard. Launch items use a sentinel date
// well before the game existed.
//
// W-engine names are talent_title strings as returned by the HoYoverse API,
// not the display names shown in-game.

function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// prettier-ignore
const ZZZ_STANDARD_POOL = new Map([
  // Characters — launch
  [slugKey('Soldier 11'),                 '2000-01-01 00:00:00'],
  [slugKey('Rina'),                       '2000-01-01 00:00:00'],
  [slugKey('Grace'),                      '2000-01-01 00:00:00'],
  [slugKey('Koleda'),                     '2000-01-01 00:00:00'],
  [slugKey('Nekomata'),                   '2000-01-01 00:00:00'],
  [slugKey('Lycaon'),                     '2000-01-01 00:00:00'],
  // W-Engines (talent_title) — launch
  [slugKey('Scorching Breath'),           '2000-01-01 00:00:00'],
  [slugKey('Passionate Construction'),    '2000-01-01 00:00:00'],
  [slugKey('Binding Chains'),             '2000-01-01 00:00:00'],
  [slugKey('Metal Cat Claws'),            '2000-01-01 00:00:00'],
  [slugKey('Punishment'),                 '2000-01-01 00:00:00'],
  [slugKey('Data Flood'),                 '2000-01-01 00:00:00'],
]);

// Returns true if this item was in the standard pool at the time of the pull.
// pullTime: "YYYY-MM-DD HH:mm:ss" UTC+8 (same format used throughout the app).
export function isZzzStandardAt(name, pullTime) {
  const effectiveDate = ZZZ_STANDARD_POOL.get(slugKey(name));
  if (effectiveDate === undefined) return false;
  return (pullTime ?? '') >= effectiveDate;
}
