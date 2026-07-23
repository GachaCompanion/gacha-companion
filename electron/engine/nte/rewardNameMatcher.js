// OCR-fallback name resolution: given text read off the Dice Roll Records
// table (e.g. from the flood-fill-cleaned column crop), find the closest
// known reward name in rewardMappings.js and return its reward key. This
// exists because OCR on the in-game font occasionally confuses single
// glyphs (e.g. "I" -> "["), so an exact-string lookup would reject a
// perfectly readable result over one bad character. Since real reward
// names rarely resemble each other, a fuzzy match against the full known
// list recovers the intended entry with high confidence.
const { CHARACTER_NAMES, ARC_NAMES, ITEM_NAMES, RANK_TO_RARITY } = require('./rewardMappings');

// name -> reward key, built once. Duplicate names (e.g. "Zero" at both 1046
// and 1051) keep whichever is seen last — fine here since this table is
// only used to resolve a display name back to *a* valid key, and duplicate
// display names are already ambiguous by definition.
function buildCandidates() {
  const candidates = [];
  for (const [id, entry] of Object.entries(CHARACTER_NAMES)) {
    candidates.push({ kind: 'character', id: Number(id), name: entry.name, rarity: RANK_TO_RARITY[entry.rank] ?? 3 });
  }
  for (const [key, entry] of Object.entries(ARC_NAMES)) {
    candidates.push({ kind: 'arc', id: key, name: entry.name, rarity: RANK_TO_RARITY[entry.rank] ?? 3 });
  }
  for (const [key, entry] of Object.entries(ITEM_NAMES)) {
    candidates.push({ kind: 'item', id: key, name: entry.name, rarity: RANK_TO_RARITY[entry.rank] ?? 3 });
  }
  return candidates;
}

let candidatesCache = null;
function getCandidates() {
  if (!candidatesCache) candidatesCache = buildCandidates();
  return candidatesCache;
}

// Strips the "Item - "/"Arc - " category prefix the table shows before the
// actual reward name, since the mapping tables store names without it. The
// prefix word itself is matched loosely (not just the literal "item"/"arc"/
// "character") because OCR sometimes mangles its first glyph (e.g. "Item"
// -> "[tem") without touching the rest of the line — falling back to "text
// after the first ' - '" recovers the actual name regardless of what the
// prefix word came out as.
function stripCategoryPrefix(text) {
  const stripped = text.replace(/^\s*(item|arc|character)\s*-\s*/i, '').trim();
  if (stripped !== text.trim()) return stripped;
  const dashIndex = text.indexOf(' - ');
  return dashIndex === -1 ? text.trim() : text.slice(dashIndex + 3).trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function normalize(text) {
  return text.toLowerCase().replace(/["“”]/g, '"').replace(/\s+/g, ' ').trim();
}

// Minimum similarity (1 - distance/maxLen) required to accept a fuzzy match
// rather than reporting no match at all. 0.6 tolerates a couple of
// single-glyph OCR mistakes on a short name without accepting a genuinely
// different item.
const MIN_CONFIDENCE = 0.6;

// Resolves OCR'd item-name-column text to the closest known reward entry.
// Returns { kind, id, name, rarity, confidence } on an acceptable match, or
// { kind: null, id: null, name: null, rarity: null, confidence } with the
// best score found (for logging) when nothing clears MIN_CONFIDENCE.
function matchOcrRewardName(ocrText) {
  const cleaned = normalize(stripCategoryPrefix(ocrText));
  let best = null;
  let bestScore = -1;
  for (const candidate of getCandidates()) {
    const target = normalize(candidate.name);
    const maxLen = Math.max(cleaned.length, target.length) || 1;
    const score = 1 - levenshtein(cleaned, target) / maxLen;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best && bestScore >= MIN_CONFIDENCE) {
    return { kind: best.kind, id: best.id, name: best.name, rarity: best.rarity, confidence: bestScore };
  }
  return { kind: null, id: null, name: null, rarity: null, confidence: bestScore };
}

module.exports = { matchOcrRewardName, MIN_CONFIDENCE };
