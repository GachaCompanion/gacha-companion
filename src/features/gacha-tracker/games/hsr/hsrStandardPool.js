// HSR standard 5-star pool — characters and light cones that count as a 50/50 loss
// when pulled on a limited banner. Each entry maps a slugged name to the UTC+8
// datetime from which that item became standard. Launch items use a sentinel date
// well before the game existed.

function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// prettier-ignore
const HSR_STANDARD_POOL = new Map([
  // Characters — launch
  [slugKey('Himeko'),                     '2000-01-01 00:00:00'],
  [slugKey('Welt'),                       '2000-01-01 00:00:00'],
  [slugKey('Bronya'),                     '2000-01-01 00:00:00'],
  [slugKey('Gepard'),                     '2000-01-01 00:00:00'],
  [slugKey('Clara'),                      '2000-01-01 00:00:00'],
  [slugKey('Yanqing'),                    '2000-01-01 00:00:00'],
  [slugKey('Bailu'),                      '2000-01-01 00:00:00'],
  // Characters — added later
  [slugKey('Seele'),                      '2025-04-09 10:00:00'], // v3.2
  [slugKey('Fu Xuan'),                    '2025-04-09 10:00:00'], // v3.2
  [slugKey('Blade'),                      '2025-04-09 10:00:00'], // v3.2
  [slugKey('Argenti'),                    '2026-04-22 10:00:00'], // v4.2
  [slugKey('Silver Wolf'),                '2026-04-22 10:00:00'], // v4.2
  [slugKey('Yunli'),                      '2026-04-22 10:00:00'], // v4.2
  // Light Cones — launch
  [slugKey("But the Battle Isn't Over"), '2000-01-01 00:00:00'],
  [slugKey('In the Name of the World'),  '2000-01-01 00:00:00'],
  [slugKey('Moment of Victory'),         '2000-01-01 00:00:00'],
  [slugKey('Night on the Milky Way'),    '2000-01-01 00:00:00'],
  [slugKey('Sleep Like the Dead'),       '2000-01-01 00:00:00'],
  [slugKey('Something Irreplaceable'),   '2000-01-01 00:00:00'],
  [slugKey('Time Waits for No One'),     '2000-01-01 00:00:00'],
]);

// Returns true if this item was in the standard pool at the time of the pull.
// pullTime: "YYYY-MM-DD HH:mm:ss" UTC+8 (same format used throughout the app).
export function isHsrStandardAt(name, pullTime) {
  const effectiveDate = HSR_STANDARD_POOL.get(slugKey(name));
  if (effectiveDate === undefined) return false;
  return (pullTime ?? '') >= effectiveDate;
}
