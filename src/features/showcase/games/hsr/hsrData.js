// HSR data loading from EnkaNetwork API store files (non-deprecated files only).
// Files starting with "honker_" are deprecated — use avatars/weapons/skills/ranks/relics.

const BASE = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/hsr';

let _chars      = null; // avatars.json
let _skills     = null; // skills.json
let _ranks      = null; // ranks.json
let _loc        = null; // hsr.json (en locale)
let _weps       = null; // weapons.json
let _relics     = null; // relics.json { Items, Sets }
let _tree       = null; // tree.json — skill tree passive stat bonuses
let _affixes    = null; // affixes.json — MainAffix + SubAffix base/step values
let _loading    = null;

export async function loadHsrData() {
  if (_chars) return;
  if (_loading) return _loading;
  _loading = (async () => {
    const [chars, skills, ranks, locRaw, weps, relicsRaw, tree, affixes] = await Promise.all([
      fetch(`${BASE}/avatars.json`).then(r => r.json()),
      fetch(`${BASE}/skills.json`).then(r => r.json()),
      fetch(`${BASE}/ranks.json`).then(r => r.json()),
      fetch(`${BASE}/hsr.json`).then(r => r.json()),
      fetch(`${BASE}/weapons.json`).then(r => r.json()),
      fetch(`${BASE}/relics.json`).then(r => r.json()),
      fetch(`${BASE}/tree.json`).then(r => r.json()),
      fetch(`${BASE}/affixes.json`).then(r => r.json()),
    ]);
    _chars      = chars;
    _skills     = skills;
    _ranks      = ranks;
    _loc        = locRaw['en'] ?? locRaw;
    _weps       = weps;
    _relics     = relicsRaw;
    _tree       = tree;
    _affixes    = affixes;
  })();
  return _loading;
}

export function getHsrCharacterData(avatarId) {
  return _chars?.[String(avatarId)] ?? null;
}

export function getHsrAllAvatarIds() {
  return _chars ? Object.keys(_chars) : [];
}

export function getHsrSkillData(pointId) {
  return _skills?.[String(pointId)] ?? null;
}

export function getHsrRankData(rankId) {
  return _ranks?.[String(rankId)] ?? null;
}

export function getHsrWeaponData(tid) {
  return _weps?.[String(tid)] ?? null;
}

export function getHsrAllWeaponIds() {
  return _weps ? Object.keys(_weps) : [];
}

export function getHsrRelicData(tid) {
  return _relics?.Items?.[String(tid)] ?? null;
}

export function getHsrRelicSetData(setId) {
  return _relics?.Sets?.[String(setId)] ?? null;
}

export function getHsrTreeData(pointId) {
  return _tree?.[String(pointId)] ?? null;
}

// affixes.json — MainAffix[group][affixId] and SubAffix[rarity][affixId]
export function getHsrMainAffix(group, affixId) {
  return _affixes?.MainAffix?.[String(group)]?.[String(affixId)] ?? null;
}

export function getHsrSubAffix(rarity, affixId) {
  return _affixes?.SubAffix?.[String(rarity)]?.[String(affixId)] ?? null;
}

// AvatarName.Hash in avatars.json is already a string, matching hsr.json keys directly.
export function hsrText(hash) {
  if (!_loc || hash == null) return '';
  return _loc[String(hash)] ?? '';
}

// Paths in non-deprecated files already include the /ui/hsr/ prefix.
export function hsrAsset(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return `https://enka.network${path}`;
  return `https://enka.network/ui/hsr/${path}`;
}

// ── Slot / stat tables ────────────────────────────────────────────────────────

export const HSR_RELIC_SLOT = {
  1: 'head', 2: 'hands', 3: 'body',
  4: 'feet', 5: 'sphere', 6: 'rope',
};

export const HSR_SLOT_ORDER = ['head', 'hands', 'body', 'feet', 'sphere', 'rope'];

export const HSR_STAT = {
  HPDelta:                   { label: 'HP',               short: 'HP',    pct: false },
  AttackDelta:               { label: 'ATK',              short: 'ATK',   pct: false },
  DefenceDelta:              { label: 'DEF',              short: 'DEF',   pct: false },
  SpeedDelta:                { label: 'SPD',              short: 'SPD',   pct: false },
  HPAddedRatio:              { label: 'HP%',              short: 'HP%',   pct: true  },
  AttackAddedRatio:          { label: 'ATK%',             short: 'ATK%',  pct: true  },
  DefenceAddedRatio:         { label: 'DEF%',             short: 'DEF%',  pct: true  },
  SpeedAddedRatio:           { label: 'SPD%',             short: 'SPD%',  pct: true  },
  CriticalChance:            { label: 'CRIT Rate',        short: 'CR',    pct: true  },
  CriticalDamage:            { label: 'CRIT DMG',         short: 'CD',    pct: true  },
  CriticalChanceBase:        { label: 'CRIT Rate',        short: 'CR',    pct: true  },
  CriticalDamageBase:        { label: 'CRIT DMG',         short: 'CD',    pct: true  },
  StatusProbability:         { label: 'Effect Hit Rate',  short: 'EHR',   pct: true  },
  StatusProbabilityBase:     { label: 'Effect Hit Rate',  short: 'EHR',   pct: true  },
  StatusResistance:          { label: 'Effect RES',       short: 'ERES',  pct: true  },
  StatusResistanceBase:      { label: 'Effect RES',       short: 'ERES',  pct: true  },
  BreakDamageAddedRatio:     { label: 'Break Effect',     short: 'BE',    pct: true  },
  BreakDamageAddedRatioBase: { label: 'Break Effect',     short: 'BE',    pct: true  },
  HealRatio:                 { label: 'Outgoing Healing', short: 'OHB',   pct: true  },
  HealRatioBase:             { label: 'Outgoing Healing', short: 'OHB',   pct: true  },
  SPRatio:                   { label: 'Energy Regen',     short: 'ERR',   pct: true  },
  SPRatioBase:               { label: 'Energy Regen',     short: 'ERR',   pct: true  },
  FireAddedRatio:            { label: 'Fire DMG',         short: 'Fire%', pct: true  },
  IceAddedRatio:             { label: 'Ice DMG',          short: 'Ice%',  pct: true  },
  ThunderAddedRatio:         { label: 'Lightning DMG',    short: 'Lgtn%', pct: true  },
  WindAddedRatio:            { label: 'Wind DMG',         short: 'Wind%', pct: true  },
  QuantumAddedRatio:         { label: 'Quantum DMG',      short: 'Qnt%',  pct: true  },
  ImaginaryAddedRatio:       { label: 'Imaginary DMG',    short: 'Img%',  pct: true  },
  PhysicalAddedRatio:        { label: 'Physical DMG',     short: 'Phys%', pct: true  },
};

const PCT_STAT_TYPES = new Set(
  Object.entries(HSR_STAT).filter(([, v]) => v.pct).map(([k]) => k)
);

export function formatHsrStat(type, value) {
  if (PCT_STAT_TYPES.has(type)) {
    const pr = Math.round(value * 100000) / 100000;
    return `${(Math.floor(pr * 1000) / 10).toFixed(1)}%`;
  }
  return Math.floor(value).toLocaleString();
}
