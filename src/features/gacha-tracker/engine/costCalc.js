// ─── Teams (maxed-roster list) ──────────────────────────────────────────────
// A flat, element-grouped list of every character the player has fully
// invested in — "C6" for Genshin (base copy + 6 extra = C0-C6), derived
// entirely from the pull log. Nothing here is user-editable; owning 7 copies
// of a 5-star is what puts a character on the list.

export const MAX_CHAR_COST = 7;

// Per-game pull-log field adapter. Genshin/HSR/ZZZ/WuWa all share the same
// {type: 'character'|'weapon', name, rarity} shape (see gameSchema.js's
// state.pullLog comment). NTE's pull log instead uses {category:
// 'Character'|'Arc', name, rarity} (see NtePullLogTab.js).
const ADAPTERS = {
  nte: { characterMatch: e => e.category === 'Character' },
};
const DEFAULT_ADAPTER = { characterMatch: e => e.type === 'character' };

function getAdapter(linkedDatabase) {
  return ADAPTERS[linkedDatabase] ?? DEFAULT_ADAPTER;
}

// Groups matching pull-log entries by name, counting owned copies. Keeps the
// highest rarity seen per name (rarity is stable per name in practice, but
// this avoids ever under-counting due to an unverified/fallback entry — see
// genshinParse.js's rarity verification).
function groupByName(entries) {
  const byName = new Map();
  for (const e of entries) {
    const existing = byName.get(e.name);
    if (existing) {
      existing.count += 1;
      existing.rarity = Math.max(existing.rarity, e.rarity ?? 0);
    } else {
      byName.set(e.name, { name: e.name, count: 1, rarity: e.rarity ?? 0 });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getOwnedCharacters(pullLog, linkedDatabase) {
  return groupByName((pullLog ?? []).filter(getAdapter(linkedDatabase).characterMatch));
}

// rarity < 5 never counts as maxed, regardless of copies owned (see file header).
export function computeCharCost(count, rarity) {
  return rarity < 5 ? 0 : Math.min(count, MAX_CHAR_COST);
}

// Actual constellation/eidolon/mindscape/sequence level (C0-C6 etc.) — unlike
// computeCharCost, this is NOT gated to rarity >= 5: a manually-added 4-star
// still has a real constellation value from its own owned copy count (base
// copy = C0, each extra copy up to 6 extra = C1-C6).
export function computeConstellation(count) {
  return Math.max(0, Math.min(count, MAX_CHAR_COST) - 1);
}

// Fetches the name->id->element roster for a game (see
// electron/engine/nanokaRoster.js — resolved via nanoka.cc, cached to disk).
// Call once per game and reuse the result rather than re-fetching per character.
export function fetchRoster(linkedDatabase) {
  return window.api.getNanokaRoster(linkedDatabase);
}

// Resolves an owned character name to its nanoka id, for fetching its
// portrait via the existing window.api.get<Game>BannerImage IPC (the image
// bytes themselves still come from gc-data, not nanoka directly — see
// gc-data's scripts/updaters/update-nanoka-images.js).
export function resolveId(name, idsByName) {
  return idsByName?.[name] ?? null;
}

// Dispatches to the correct per-game banner-image IPC call — each returns a
// data: URI directly (or null on failure), no local server/port needed.
export function fetchBannerImage(linkedDatabase, featuredId) {
  if (featuredId == null) return Promise.resolve(null);
  switch (linkedDatabase) {
    case 'genshin': return window.api.getGenshinBannerImageById(featuredId);
    case 'hsr':     return window.api.getHsrBannerImage(featuredId);
    case 'zzz':     return window.api.getZzzBannerImage(featuredId);
    case 'wuwa':    return window.api.getWuwaBannerImage(featuredId);
    case 'nte':     return window.api.getNteBannerImage(featuredId);
    default:        return Promise.resolve(null);
  }
}
