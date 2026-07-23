// Genshin standard 5-star pool — characters and weapons that count as a 50/50 loss
// when pulled on a limited banner. Each entry maps a slugged name to the UTC+8
// datetime from which that item became standard. Launch items use a sentinel date
// well before the game existed.

function slugKey(s) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// prettier-ignore
const GENSHIN_STANDARD_POOL = new Map([
  // Characters — launch
  [slugKey('Diluc'),                      '2000-01-01 00:00:00'],
  [slugKey('Jean'),                       '2000-01-01 00:00:00'],
  [slugKey('Keqing'),                     '2000-01-01 00:00:00'],
  [slugKey('Mona'),                       '2000-01-01 00:00:00'],
  [slugKey('Qiqi'),                       '2000-01-01 00:00:00'],
  // Characters — added later
  [slugKey('Tighnari'),                   '2022-09-28 07:00:00'], // v3.1
  [slugKey('Dehya'),                      '2023-04-12 07:00:00'], // v3.6
  [slugKey('Yumemizuki Mizuki'),          '2025-03-26 07:00:00'], // v5.5
  // Weapons — launch
  [slugKey("Amos' Bow"),                  '2000-01-01 00:00:00'],
  [slugKey('Aquila Favonia'),             '2000-01-01 00:00:00'],
  [slugKey('Lost Prayer to the Sacred Winds'), '2000-01-01 00:00:00'],
  [slugKey('Primordial Jade Winged-Spear'),    '2000-01-01 00:00:00'],
  [slugKey('Skyward Atlas'),              '2000-01-01 00:00:00'],
  [slugKey('Skyward Blade'),              '2000-01-01 00:00:00'],
  [slugKey('Skyward Harp'),               '2000-01-01 00:00:00'],
  [slugKey('Skyward Pride'),              '2000-01-01 00:00:00'],
  [slugKey('Skyward Spine'),              '2000-01-01 00:00:00'],
  [slugKey('Wolf\'s Gravestone'),         '2000-01-01 00:00:00'],
]);

// Returns true if this item was in the standard pool at the time of the pull.
// pullTime: "YYYY-MM-DD HH:mm:ss" UTC+8 (same format used throughout the app).
export function isGenshinStandardAt(name, pullTime) {
  const effectiveDate = GENSHIN_STANDARD_POOL.get(slugKey(name));
  if (effectiveDate === undefined) return false;
  return (pullTime ?? '') >= effectiveDate;
}
