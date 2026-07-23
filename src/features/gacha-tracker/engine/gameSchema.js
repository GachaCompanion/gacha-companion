export const DB_CURRENCY_OVERRIDES = {
  genshin: { currencyName: 'Primogems',    pullItemName: 'Intertwined Fates' },
  hsr:     { currencyName: 'Stellar Jade', pullItemName: 'Star Rail Special Passes' },
  zzz:     { currencyName: 'Polychrome',   pullItemName: 'Encrypted Master Tape' },
  nte:     { currencyName: 'Annulith',     pullItemName: 'Solid Dice', weaponPullItemName: 'Tri-Key' },
  wuwa:    { currencyName: 'Astrite',      pullItemName: 'Radiant Tide', weaponPullItemName: 'Forging Tide' },
};

// Per-database "daily login pass" name (Blessing of the Welkin Moon / Express
// Supply Pass / Inter-Knot Membership / Riftcrystal Permit). The claim amount
// itself is NOT per-game — every database uses the same DAILY_CLAIM_AMOUNT
// (always available) plus DAILY_PASS_BONUS (only while the pass is active).
export const DB_DAILY_PASS = {
  genshin: { name: 'Blessing of the Welkin Moon' },
  hsr:     { name: 'Express Supply Pass' },
  zzz:     { name: 'Inter-Knot Membership' },
  nte:     { name: 'Riftcrystal Permit' },
  wuwa:    { name: 'Lunite Subscription' },
};

export const DAILY_CLAIM_AMOUNT = 60;
export const DAILY_PASS_BONUS = 90;

// Returns the effective daily-pass name for a game, using the linked
// database override when present. Unlinked/custom games use their own field.
export function resolveDailyPass(game) {
  const override = DB_DAILY_PASS[game?.linkedDatabase];
  return {
    name: override?.name ?? game?.dailyPassName ?? '',
  };
}

// Per-database locked mechanics for the character and weapon/arc banners.
// costPerPull is shared by both banners for every currently-linked database.
// featuredChance for genshin's char banner is unused by the actual calculator
// (Capturing Radiance in genshinSimulation.js overrides it) but is still stored
// here so the locked-field UI has a real number to display.
export const DB_BANNER_DEFAULTS = {
  genshin: {
    costPerPull: 160,
    charBanner:   { baseRate: 0.006, softPity: 74, hardPity: 90, has5050: true,  featuredChance: 0.5,  guaranteeCarryOver: true },
    weaponBanner: { baseRate: 0.007, softPity: 63, hardPity: 80, has5050: true,  featuredChance: 0.75, guaranteeCarryOver: true, specialMechanicId: 'epitomized_path', specialMechanicConfig: { fatePointsNeeded: 1 } },
  },
  hsr: {
    costPerPull: 160,
    charBanner:   { baseRate: 0.006, softPity: 75, hardPity: 90, has5050: true,  featuredChance: 0.5,  guaranteeCarryOver: true },
    weaponBanner: { baseRate: 0.008, softPity: 65, hardPity: 80, has5050: true,  featuredChance: 0.75, guaranteeCarryOver: true, specialMechanicId: 'none', specialMechanicConfig: {} },
  },
  zzz: {
    costPerPull: 160,
    charBanner:   { baseRate: 0.006, softPity: 75, hardPity: 90, has5050: true,  featuredChance: 0.5,  guaranteeCarryOver: true },
    weaponBanner: { baseRate: 0.01,  softPity: 65, hardPity: 80, has5050: true,  featuredChance: 0.75, guaranteeCarryOver: true, specialMechanicId: 'none', specialMechanicConfig: {} },
  },
  nte: {
    costPerPull: 160,
    charBanner:   { baseRate: 0.0099, softPity: 70, hardPity: 90, has5050: false, featuredChance: 1.0,  guaranteeCarryOver: true },
    // Arc banner losses do NOT carry a guarantee into the next S-Class pull
    // — every S-Class draw independently re-rolls the 25% featured chance,
    // so several different non-featured S-Class Arcs can come up in a row
    // before the featured one (confirmed by the user). guaranteeCarryOver
    // false means engine/simulation.js's exact-math path returns null for
    // this banner and falls back to simulateCombined, which already
    // respects this flag correctly (see simulateOneFeatured).
    weaponBanner: { baseRate: 0.03,   softPity: 60, hardPity: 80, has5050: true,  featuredChance: 0.25, guaranteeCarryOver: false, specialMechanicId: 'none', specialMechanicConfig: {} },
  },
  wuwa: {
    costPerPull: 160,
    // Official rates (Kuro's in-game Rates panel): base 5-star 0.8%, hard
    // pity 80 for both banners. Character banner is a standard 50/50 with
    // guarantee carry-over. Weapon banner has NO 50/50 — every 5-star weapon
    // pull is guaranteed to be the featured weapon (featuredChance: 1.0,
    // has5050: false), unlike genshin/hsr/zzz's 75/25 weapon banners.
    charBanner:   { baseRate: 0.008, softPity: 70, hardPity: 80, has5050: true,  featuredChance: 0.5, guaranteeCarryOver: true },
    weaponBanner: { baseRate: 0.008, softPity: 70, hardPity: 80, has5050: false, featuredChance: 1.0, guaranteeCarryOver: true, specialMechanicId: 'none', specialMechanicConfig: {} },
  },
};

// Returns the locked banner-mechanics defaults for a linked database, or null
// when the game is unlinked (custom games keep their own editable values).
export function resolveGameBannerDefaults(game) {
  return DB_BANNER_DEFAULTS[game?.linkedDatabase] ?? null;
}

// Per-database state field adjustments layered on top of EMPTY_GAME_CONFIG's
// shared defaults — some fields only correspond to a real mechanic for one
// specific game's actual Calculator/simulation logic, not every database.
const DB_STATE_ADDITIONS = {
  // Genshin's Chronicled Wish banner + its own Path of Resonance fate-points
  // counter (kept separate from the weapon banner's Epitomized Path counter
  // — see chronicledFatePoints' original comment). No other linked database
  // has an equivalent banner/mechanic (confirmed against each game's actual
  // Calculator.js — HSR/ZZZ/NTE never read or write these fields).
  genshin: { chronicledPity: 0, chronicledGuaranteed: false, fatePoints: 0, chronicledFatePoints: 0 },
};

// Fields to omit from the shared base state for specific databases whose
// actual banner mechanics make them meaningless — listed explicitly per
// database rather than inferred, so resyncLockedDefaults actually strips
// already-persisted stale values instead of silently copying them through.
const CHRONICLED_FIELDS = ['chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'chronicledFatePoints'];
const DB_STATE_REMOVALS = {
  // No Chronicled Wish equivalent on these — confirmed against each game's
  // actual Calculator.js, none of them read or write these 4 fields.
  hsr:  CHRONICLED_FIELDS,
  zzz:  CHRONICLED_FIELDS,
  // NTE's char banner is always featured (has5050: false, featuredChance:
  // 1.0 — buildCopyPmf short-circuits at pFeatured=1) and its Arc/weapon
  // banner has guaranteeCarryOver: false (every S-Class draw independently
  // re-rolls the 25% featured chance, confirmed by a comment in
  // NTECalculator.js) — no guarantee state exists to persist for either
  // banner. Neither field is even declared as state in NTECalculator.js.
  nte:  [...CHRONICLED_FIELDS, 'charGuaranteed', 'weaponGuaranteed'],
  // WuWa's weapon banner has no 50/50 (every 5-star weapon is already
  // guaranteed featured, see WuwaCalculator.js/wuwaSimulation.js's
  // WEAPON_FEATURED_RATE = 1.0), so weaponGuaranteed never has any effect
  // there, on top of the same missing Chronicled equivalent.
  wuwa: [...CHRONICLED_FIELDS, 'weaponGuaranteed'],
};

function applyDbStateAdjustments(state, dbId) {
  const next = { ...state, ...(DB_STATE_ADDITIONS[dbId] ?? {}) };
  for (const field of DB_STATE_REMOVALS[dbId] ?? []) delete next[field];
  return next;
}

// Applies (or clears) a database link to a game, overwriting currency/pull-item
// names and both banners' mechanics with the DB's locked values. Used whenever
// linkedDatabase changes so the stored game object stays correct even before
// the user opens the Edit wizard.
export function applyDatabaseLink(game, dbId) {
  const override = DB_CURRENCY_OVERRIDES[dbId];
  const bannerDefaults = DB_BANNER_DEFAULTS[dbId];
  const dailyPass = DB_DAILY_PASS[dbId];
  if (!override || !bannerDefaults) {
    return { ...game, linkedDatabase: dbId ?? null, enabledFeatures: {} };
  }
  return {
    ...game,
    linkedDatabase: dbId,
    enabledFeatures: {},
    pullItemName: override.pullItemName,
    weaponPullItemName: override.weaponPullItemName ?? override.pullItemName,
    dailyPassName: dailyPass?.name ?? game.dailyPassName,
    charBanner: {
      ...game.charBanner,
      currencyName: override.currencyName,
      costPerPull: bannerDefaults.costPerPull,
      ...bannerDefaults.charBanner,
    },
    weaponBanner: {
      ...game.weaponBanner,
      currencyName: override.currencyName,
      costPerPull: bannerDefaults.costPerPull,
      ...bannerDefaults.weaponBanner,
    },
    state: applyDbStateAdjustments(game.state, dbId),
  };
}

// Re-applies the locked currency/banner-mechanics values to an ALREADY-linked
// game, without touching enabledFeatures/linkedDatabase. applyDatabaseLink
// only runs at the moment a database gets linked — if DB_BANNER_DEFAULTS,
// DB_CURRENCY_OVERRIDES, or DB_STATE_ADDITIONS/DB_STATE_REMOVALS is corrected
// later (e.g. a soft pity number fixed, or a dead state field identified,
// after games were already linked), those existing games keep the stale
// values forever unless something re-syncs them. This is that re-sync,
// meant to run as a one-time migration on load — including stripping
// already-persisted dead state fields (see computeBannerResync's
// state-inclusive diff check in useTrackerState.js, without which this
// function's corrected `state` would be computed but never actually saved).
export function resyncLockedDefaults(game) {
  if (!game.linkedDatabase) return game;
  const override = DB_CURRENCY_OVERRIDES[game.linkedDatabase];
  const bannerDefaults = DB_BANNER_DEFAULTS[game.linkedDatabase];
  const dailyPass = DB_DAILY_PASS[game.linkedDatabase];
  if (!override || !bannerDefaults) return game;
  return {
    ...game,
    pullItemName: override.pullItemName,
    weaponPullItemName: override.weaponPullItemName ?? override.pullItemName,
    dailyPassName: dailyPass?.name ?? game.dailyPassName,
    charBanner: {
      ...game.charBanner,
      currencyName: override.currencyName,
      costPerPull: bannerDefaults.costPerPull,
      ...bannerDefaults.charBanner,
    },
    weaponBanner: {
      ...game.weaponBanner,
      currencyName: override.currencyName,
      costPerPull: bannerDefaults.costPerPull,
      ...bannerDefaults.weaponBanner,
    },
    state: applyDbStateAdjustments(game.state, game.linkedDatabase),
  };
}

// Per-database canonical label definitions.
// charName/weaponName: what the entity type is called (used as column/section headers).
// charCopyLabel/weaponCopyLabel: what copies are called (used in target dropdown headers).
// charCopyLetter/weaponCopyLetter: short prefix used in copy option labels (C0-C6, R1-R5, etc.).
export const DB_GAME_LABELS = {
  genshin: {
    charName: 'Character', weaponName: 'Weapon',
    charCopyLabel: 'Constellation', weaponCopyLabel: 'Refinement',
    charCopyLetter: 'C', weaponCopyLetter: 'R',
  },
  hsr: {
    charName: 'Character', weaponName: 'Light Cone',
    charCopyLabel: 'Eidolon', weaponCopyLabel: 'Superimposition',
    charCopyLetter: 'E', weaponCopyLetter: 'S',
  },
  zzz: {
    charName: 'Character', weaponName: 'W-Engine',
    charCopyLabel: 'Mindscape Cinema', weaponCopyLabel: 'Overclock',
    charCopyLetter: 'M', weaponCopyLetter: 'P',
  },
  nte: {
    charName: 'Character', weaponName: 'Arc',
    charCopyLabel: 'Awakening', weaponCopyLabel: 'Mixing',
    charCopyLetter: 'A', weaponCopyLetter: 'M',
  },
  wuwa: {
    charName: 'Resonator', weaponName: 'Weapon',
    charCopyLabel: 'Resonance Chain', weaponCopyLabel: 'Refinement',
    charCopyLetter: 'RC', weaponCopyLetter: 'R',
  },
};

export function resolveGameLabels(game) {
  const db = DB_GAME_LABELS[game?.linkedDatabase];
  return {
    charName:          db?.charName          ?? 'Character',
    weaponName:        db?.weaponName        ?? 'Weapon',
    charCopyLabel:     db?.charCopyLabel     ?? game?.charCopyLabel     ?? 'Constellation',
    weaponCopyLabel:   db?.weaponCopyLabel   ?? game?.weaponCopyLabel   ?? 'Refinement',
    charCopyLetter:    db?.charCopyLetter    ?? 'C',
    weaponCopyLetter:  db?.weaponCopyLetter  ?? 'R',
  };
}

// Returns the effective currency/pull-item names for a game,
// using the linked-database override when present.
export function resolveGameCurrency(game) {
  const override = DB_CURRENCY_OVERRIDES[game?.linkedDatabase];
  return {
    currencyName: override?.currencyName ?? game?.charBanner?.currencyName ?? '',
    pullItemName: override?.pullItemName ?? game?.pullItemName ?? '',
    weaponPullItemName: override?.weaponPullItemName ?? game?.weaponPullItemName ?? override?.pullItemName ?? game?.pullItemName ?? '',
  };
}

export const EMPTY_GAME_CONFIG = {
  id: '',
  name: '',
  color: '#7c6af7',
  iconPath: '',
  deleted: false,
  usesAppColor: true,
  pullItemName: '',
  weaponPullItemName: '',
  dailyPassName: '',
  charCopyLabel: 'Constellation',
  weaponCopyLabel: 'Refinement',

  charBanner: {
    baseRate: 0.006,
    softPity: 74,
    hardPity: 90,
    has5050: true,
    featuredChance: 0.5,
    guaranteeCarryOver: true,
    costPerPull: 160,
    currencyName: '',
  },

  weaponBanner: {
    baseRate: 0.007,
    softPity: 63,
    hardPity: 80,
    has5050: true,
    featuredChance: 0.75,
    guaranteeCarryOver: true,
    costPerPull: 160,
    currencyName: '',
    specialMechanicId: 'none',
    specialMechanicConfig: {},
  },

  // Only active when linkedDatabase = 'genshin'
  chronicledBanner: {
    baseRate: 0.006,
    softPity: 74,
    hardPity: 90,
    has5050: true,
    featuredChance: 0.5,
    guaranteeCarryOver: false,
    costPerPull: 160,
    currencyName: '',
    specialMechanicId: 'path_of_resonance',
    specialMechanicConfig: { fatePointsNeeded: 1 },
  },

  state: {
    currency: 0,
    pullItems: 0,
    // Used only by dual-currency databases (nte, future wuwa) whose two pull
    // items aren't fungible — see resolveGameCurrency's weaponPullItemName.
    // Single-currency games keep using pullItems above.
    charPullItems: 0,
    weaponPullItems: 0,
    charPity: 0,
    charGuaranteed: false,
    weaponPity: 0,
    // Generic default for a 2-banner pity system — not every linked database's
    // weapon banner actually has a 50/50 (see DB_STATE_REMOVALS below for the
    // ones that don't and never set/read this field).
    weaponGuaranteed: false,
    // Chronicled Wish's pity/guarantee/fate-points fields are NOT in this
    // shared default — only Genshin has an equivalent banner. See
    // DB_STATE_ADDITIONS below, applied only when linkedDatabase === 'genshin'.
    // Whether the user currently has this game's daily login pass active —
    // gates the "Claim" button (see resolveDailyPass / DailyPassRow).
    dailyPassActive: false,
    history: [],
    wishList: [],
    pullLog: [],
  },
};

export function createGame(overrides = {}) {
  const id = crypto.randomUUID();
  return deepMerge(EMPTY_GAME_CONFIG, { ...overrides, id });
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}
