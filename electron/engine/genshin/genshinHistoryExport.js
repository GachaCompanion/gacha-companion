// Reverses genshinParse.js's parsePaimonMoe() — builds a paimon.moe-compatible
// import JSON from our own internal pull log, so a user can re-upload their
// history to paimon.moe (or hand it to someone migrating away from us) without
// depending on us as the only place their history lives.
//
// Deliberately kept separate from genshinParse.js (import-only) so the two
// directions can be pointed at independently.

// Inverse of buildPaimonEntries()'s won5050 mapping.
function won5050ToRate(won5050) {
  if (won5050 === 'won')        return 1;
  if (won5050 === 'lost')       return 0;
  if (won5050 === 'guaranteed') return 2;
  return undefined;
}

// Inverse of lookupSlug() in genshinParse.js: turns a resolved display name
// back into the underscore slug paimon.moe's own export uses as `id`.
// Traveler is a special case on import (any traveler_* slug collapses to the
// generic "Traveler" name) — we lose which element was pulled, so re-export
// falls back to the bare "traveler" slug. This is a known, unavoidable gap:
// the element isn't retained anywhere in our stored pull data.
function nameToSlug(name) {
  if (name === 'Traveler') return 'traveler';
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/\s+/g, '_');
}

// Inverse of serverNameToOffset() in genshinParse.js. Multiple server names
// map to the same UTC+8 offset on import (Asia/China/TW-HK-MO all do), so this
// can only recover a representative name, not necessarily the original one.
function serverOffsetToName(offset) {
  if (offset === 1)  return 'Europe';
  if (offset === -5) return 'America';
  return 'Asia';
}

// ─── Shared chronological pass ────────────────────────────────────────────
// paimon.moe's per-pull `pity` field is NOT a single running counter reset
// only by 5-stars (that's our own internal `pull.pity`, used for our own
// pity UI) — it's rarity-tier-specific, straight from import.svelte's own
// import loop (`rare++; legendary++;` every pull, unconditionally):
//   rarity 5: pity = legendary-pity counter, then that counter resets to 0
//   rarity 4: pity = rare-pity counter, then THAT counter resets to 0
//             (crucially NOT reset by a 5-star pull — the `// rare = 0;`
//             line in the 5-star branch is commented out in their source)
//   rarity 3 (or anything else): pity is hardcoded to 1, always — 3-stars
//             have no pity mechanic in paimon.moe's data model
// This single pass also derives each sheet's final `legendary`/`rare`
// running-pity state (for the JSON counter object) and, for the Excel sheet,
// the banner-relative #Roll/Group numbering paimon.moe's own export uses —
// both reset at every banner-name change, unlike our internal `pull.roll`
// which counts across the whole banner category regardless of which banner
// instance a pull belongs to.
function computeExportSequence(entries) {
  const sorted = [...entries].sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0));

  let legendaryPity = 0;
  let rarePity = 0;
  let bannerRoll = 0;
  let groupNum = 0;
  let lastBannerName;
  let lastTime = null;
  let sawBanner = false;

  const rows = sorted.map(pull => {
    legendaryPity++;
    let paimonPity;
    if (pull.rarity === 5) {
      paimonPity = legendaryPity;
      legendaryPity = 0;
    } else {
      rarePity++;
      if (pull.rarity === 4) {
        paimonPity = rarePity;
        rarePity = 0;
      } else {
        paimonPity = 1;
      }
    }

    if (!sawBanner || pull.bannerName !== lastBannerName) {
      bannerRoll = 0;
      groupNum = 0;
      lastBannerName = pull.bannerName;
      lastTime = null;
      sawBanner = true;
    }
    bannerRoll++;
    if (pull.time !== lastTime) { groupNum++; lastTime = pull.time; }

    return { pull, paimonPity, bannerRoll, groupNum };
  });

  return { rows, finalLegendary: legendaryPity, finalRare: rarePity };
}

function buildExportPull({ pull, paimonPity }) {
  return {
    id:   nameToSlug(pull.name),
    type: pull.type,
    time: pull.time,
    rate: won5050ToRate(pull.won5050),
    pity: paimonPity,
    code: pull.code ?? null,
  };
}

// Was the LAST 5-star on this banner type a loss? If so the next one is
// guaranteed — mirrors how paimon.moe tracks `guaranteed.legendary` itself.
function deriveGuaranteed(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].pull.rarity === 5) return rows[i].pull.won5050 === 'lost';
  }
  return false;
}

const BANNER_TO_COUNTER_KEY = {
  character:  'wish-counter-character-event',
  weapon:     'wish-counter-weapon-event',
  chronicled: 'wish-counter-chronicled',
  standard:   'wish-counter-standard',
  beginner:   'wish-counter-beginners',
};

function buildPaimonExport(pullLog, serverOffset = 8) {
  const byBanner = { character: [], weapon: [], chronicled: [], standard: [], beginner: [] };
  for (const pull of (pullLog ?? [])) {
    if (byBanner[pull.banner]) byBanner[pull.banner].push(pull);
  }

  const result = { server: serverOffsetToName(serverOffset) };

  for (const [banner, counterKey] of Object.entries(BANNER_TO_COUNTER_KEY)) {
    const { rows, finalLegendary, finalRare } = computeExportSequence(byBanner[banner]);
    const counter = {
      total:     rows.length,
      legendary: finalLegendary,
      rare:      finalRare,
      pulls:     rows.map(buildExportPull),
    };
    if (banner === 'character' || banner === 'weapon' || banner === 'chronicled') {
      // guaranteed.rare (4-star rate-up state) isn't derivable — we never
      // track won/lost for 4-star pulls anywhere in our own data model, only
      // 5-star. Defaults to false, a known gap.
      counter.guaranteed = { legendary: deriveGuaranteed(rows), rare: false };
    }
    result[counterKey] = counter;
  }

  return result;
}

// ─── Paimon.moe Excel export ───────────────────────────────────────────────
// Reverses parseExcelMoe(). Paimon.moe's own Excel export never includes
// Chronicled Wish (parseExcelMoe's detectMismatch comment notes this same
// gap on import), so that banner type is skipped here too — matches the
// real file's sheet list: Character Event / Weapon Event / Standard /
// Beginners' Wish / Banner List / Information.

const EXCEL_SHEET_FOR_BANNER = {
  character: 'Character Event',
  weapon:    'Weapon Event',
  standard:  'Standard',
  beginner:  "Beginners' Wish",
};

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function buildExcelRows(entries) {
  const { rows } = computeExportSequence(entries);
  return rows.map(({ pull, paimonPity, bannerRoll, groupNum }) => ({
    Type:     capitalize(pull.type),
    Name:     pull.name,
    Time:     pull.time,
    '⭐':      pull.rarity,
    Pity:     paimonPity,
    '#Roll':  bannerRoll,
    Group:    groupNum,
    Banner:   pull.bannerName ?? '',
    Part:     pull.part ?? '',
  }));
}

// Best-effort reconstruction from observed pull timestamps per banner name —
// our stored pulls don't retain each banner's official schedule window, only
// the resolved bannerName on each pull. Not consumed by our own importer
// (parseExcelMoe reads this sheet but the result is unused elsewhere in the
// app), included only so paimon.moe's own site import has something to read.
function buildBannerListRows(allEntries) {
  const ranges = new Map();
  for (const pull of allEntries) {
    if (!pull.bannerName || !pull.time) continue;
    const r = ranges.get(pull.bannerName);
    if (!r) ranges.set(pull.bannerName, { start: pull.time, end: pull.time });
    else {
      if (pull.time < r.start) r.start = pull.time;
      if (pull.time > r.end)   r.end   = pull.time;
    }
  }
  return [...ranges.entries()].map(([name, r]) => ({ Name: name, Start: r.start, End: r.end }));
}

// Column widths matching the real paimon.moe Excel export (checked against a
// sample file's !cols). Note: cell fill colors (the alternating light-gray
// row shading per pull-group in the real export) can't be replicated here —
// the 'xlsx' package (SheetJS Community Edition) silently drops cell style
// writes; only Pro/exceljs support that. Left unstyled rather than adding a
// new dependency for it.
const PULL_SHEET_COLS = [
  null,               // Type
  { wch: 32 },        // Name
  { wch: 22 },        // Time
  { wch: 2.5 },        // ⭐
  { wch: 4 },          // Pity
  { wch: 7 },          // #Roll
  { wch: 7 },          // Group
  { wch: 30 },         // Banner
];

function buildExcelExport(pullLog) {
  const XLSX = require('xlsx');
  const byBanner = { character: [], weapon: [], standard: [], beginner: [] };
  for (const pull of (pullLog ?? [])) {
    if (byBanner[pull.banner]) byBanner[pull.banner].push(pull);
  }

  const wb = XLSX.utils.book_new();
  const allEntries = [];
  for (const [banner, sheetName] of Object.entries(EXCEL_SHEET_FOR_BANNER)) {
    const entries = byBanner[banner];
    allEntries.push(...entries);
    const ws = XLSX.utils.json_to_sheet(buildExcelRows(entries));
    ws['!cols'] = PULL_SHEET_COLS;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const bannerListWs = XLSX.utils.json_to_sheet(buildBannerListRows(allEntries));
  XLSX.utils.book_append_sheet(wb, bannerListWs, 'Banner List');

  const infoRows = [
    { 'Paimon.moe Wish History Export': 'Version',     __EMPTY: '3' },
    { 'Paimon.moe Wish History Export': 'Export Date', __EMPTY: new Date().toISOString().slice(0, 19).replace('T', ' ') },
  ];
  const infoWs = XLSX.utils.json_to_sheet(infoRows);
  XLSX.utils.book_append_sheet(wb, infoWs, 'Information');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildPaimonExport, buildExcelExport };
