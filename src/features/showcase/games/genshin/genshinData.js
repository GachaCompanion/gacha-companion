// Genshin-specific data mappings and lazy-loaded reference tables.
// Handles FIGHT_PROP keys, equipType, stat formatting, and CDN data fetching.

const AVATARS_URL = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/avatars.json';
const LOC_URL     = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/locs.json';
const RELICS_URL  = 'https://raw.githubusercontent.com/EnkaNetwork/API-docs/master/store/gi/relics.json';

let _chars     = null;
let _loc       = null;
let _relicSets = null; // setId -> display name
let _loading   = null;

export async function loadGenshinData() {
  if (_chars && _loc && _relicSets) return;
  if (_loading) return _loading;
  _loading = (async () => {
    const [charsRes, locRes, relicsRes] = await Promise.all([
      fetch(AVATARS_URL),
      fetch(LOC_URL),
      fetch(RELICS_URL),
    ]);
    _chars = await charsRes.json();
    const locAll = await locRes.json();
    _loc = locAll['en'] ?? locAll;

    const relicsData = await relicsRes.json();

    // Build setId -> display name from gi/relics.json Sets + gi/locs.json
    _relicSets = {};
    for (const [setId, s] of Object.entries(relicsData.Sets ?? {})) {
      const name = _loc[String(s.Name)];
      if (name) _relicSets[setId] = name;
    }
  })();
  await _loading;
}

// Extract setId from artifact icon name e.g. "UI_RelicIcon_15019_4" -> "15019"
export function setNameFromIcon(icon) {
  const m = icon?.match(/UI_RelicIcon_(\d+)_/);
  return m ? _relicSets?.[m[1]] ?? '' : '';
}

export function getCharacterData(avatarId) {
  return _chars?.[String(avatarId)] ?? null;
}

// Extracts the character slug from SideIconName.
// Handles both old ("UI_AvatarIcon_Side_Hutao") and new ("/ui/UI_AvatarIcon_Side_Hutao.png") formats.
function sideIconSlug(sideIconName) {
  if (!sideIconName) return null;
  const base = sideIconName.replace(/^\/ui\//, '').replace(/\.png$/, '');
  return base.replace('UI_AvatarIcon_Side_', '') || null;
}

export function getCharacterSmallIconName(avatarId) {
  const char = getCharacterData(avatarId);
  const slug = sideIconSlug(char?.SideIconName);
  return slug ? `UI_AvatarIcon_${slug}` : null;
}

export function getNamecardUrl(avatarId) {
  const slug = sideIconSlug(getCharacterData(avatarId)?.SideIconName);
  return slug ? `https://enka.network/ui/UI_NameCardPic_${slug}_P.jpg` : null;
}

export function getCharacterIconName(avatarId, costumeId) {
  const char = getCharacterData(avatarId);
  if (!char) return null;
  if (costumeId && char.Costumes?.[String(costumeId)]?.art) {
    return char.Costumes[String(costumeId)].art;
  }
  const slug = sideIconSlug(char.SideIconName);
  return slug ? `UI_Gacha_AvatarImg_${slug}` : null;
}

export function resolveText(hash) {
  if (!hash) return '';
  return _loc?.[String(hash)] ?? '';
}

export function getElementName(elementStr) {
  const map = {
    Fire:     'Pyro',
    Water:    'Hydro',
    Wind:     'Anemo',
    Electric: 'Electro',
    Ice:      'Cryo',
    Rock:     'Geo',
    Grass:    'Dendro',
  };
  return map[elementStr] ?? elementStr ?? '';
}

// ── FIGHT_PROP numeric key → stat descriptor ─────────────────────────────────
// Values in fightPropMap are decimals; pct:true means ×100 to display.

export const FIGHT_PROP = {
  1:    { key: 'baseHp',       label: 'Base HP',          pct: false },
  4:    { key: 'baseAtk',      label: 'Base ATK',         pct: false },
  7:    { key: 'baseDef',      label: 'Base DEF',         pct: false },
  20:   { key: 'critRate',     label: 'CRIT Rate',        pct: true  },
  22:   { key: 'critDmg',      label: 'CRIT DMG',         pct: true  },
  23:   { key: 'er',           label: 'Energy Recharge',  pct: true  },
  26:   { key: 'healingBonus', label: 'Healing Bonus',    pct: true  },
  28:   { key: 'em',           label: 'Elem. Mastery',    pct: false },
  30:   { key: 'physDmg',      label: 'Phys DMG Bonus',   pct: true  },
  40:   { key: 'pyroDmg',      label: 'Pyro DMG Bonus',   pct: true  },
  41:   { key: 'electroDmg',   label: 'Electro DMG Bonus',pct: true  },
  42:   { key: 'hydroDmg',     label: 'Hydro DMG Bonus',  pct: true  },
  43:   { key: 'dendroDmg',    label: 'Dendro DMG Bonus', pct: true  },
  44:   { key: 'anemoDmg',     label: 'Anemo DMG Bonus',  pct: true  },
  45:   { key: 'geoDmg',       label: 'Geo DMG Bonus',    pct: true  },
  46:   { key: 'cryoDmg',      label: 'Cryo DMG Bonus',   pct: true  },
  2000: { key: 'hp',           label: 'HP',               pct: false },
  2001: { key: 'atk',          label: 'ATK',              pct: false },
  2002: { key: 'def',          label: 'DEF',              pct: false },
};

// Stats shown on the card CENTER column, in display order
export const CARD_STATS = [
  'hp', 'atk', 'def', 'critRate', 'critDmg', 'er', 'em',
];

const DMG_BONUS_KEYS = [
  'pyroDmg','electroDmg','hydroDmg','dendroDmg',
  'anemoDmg','geoDmg','cryoDmg','physDmg',
];

export function pickBestDmgBonus(stats) {
  let best = null;
  for (const k of DMG_BONUS_KEYS) {
    const s = stats[k];
    if (s && s.value > 0 && (!best || s.value > best.value)) best = s;
  }
  return best;
}

// ── appendProp string key → stat descriptor ───────────────────────────────────
// Values from reliquarySubstats are already in display format (3.5 not 0.035).

export const APPEND_PROP = {
  FIGHT_PROP_HP:                { label: 'HP',       short: 'HP',    pct: false, iconKey: 'hp'         },
  FIGHT_PROP_ATTACK:            { label: 'ATK',      short: 'ATK',   pct: false, iconKey: 'atk'        },
  FIGHT_PROP_DEFENSE:           { label: 'DEF',      short: 'DEF',   pct: false, iconKey: 'def'        },
  FIGHT_PROP_HP_PERCENT:        { label: 'HP',       short: 'HP%',   pct: true,  iconKey: 'hp'         },
  FIGHT_PROP_ATTACK_PERCENT:    { label: 'ATK',      short: 'ATK%',  pct: true,  iconKey: 'atk'        },
  FIGHT_PROP_DEFENSE_PERCENT:   { label: 'DEF',      short: 'DEF%',  pct: true,  iconKey: 'def'        },
  FIGHT_PROP_CRITICAL:          { label: 'CRIT Rate',short: 'CR',    pct: true,  iconKey: 'critRate'   },
  FIGHT_PROP_CRITICAL_HURT:     { label: 'CRIT DMG', short: 'CD',    pct: true,  iconKey: 'critDmg'    },
  FIGHT_PROP_CHARGE_EFFICIENCY: { label: 'ER',       short: 'ER',    pct: true,  iconKey: 'er'         },
  FIGHT_PROP_ELEMENT_MASTERY:   { label: 'EM',       short: 'EM',    pct: false, iconKey: 'em'         },
  FIGHT_PROP_HEAL_ADD:          { label: 'Healing',  short: 'Heal',  pct: true,  iconKey: 'healingBonus'},
  FIGHT_PROP_PHYSICAL_ADD_HURT: { label: 'Phys DMG', short: 'Phys',  pct: true,  iconKey: 'physDmg'    },
  FIGHT_PROP_FIRE_ADD_HURT:     { label: 'Pyro DMG', short: 'Pyro',  pct: true,  iconKey: 'pyroDmg'    },
  FIGHT_PROP_ELEC_ADD_HURT:     { label: 'Electro',  short: 'Elec',  pct: true,  iconKey: 'electroDmg' },
  FIGHT_PROP_WATER_ADD_HURT:    { label: 'Hydro DMG',short: 'Hydro', pct: true,  iconKey: 'hydroDmg'   },
  FIGHT_PROP_WIND_ADD_HURT:     { label: 'Anemo DMG',short: 'Anemo', pct: true,  iconKey: 'anemoDmg'   },
  FIGHT_PROP_ICE_ADD_HURT:      { label: 'Cryo DMG', short: 'Cryo',  pct: true,  iconKey: 'cryoDmg'    },
  FIGHT_PROP_ROCK_ADD_HURT:     { label: 'Geo DMG',  short: 'Geo',   pct: true,  iconKey: 'geoDmg'     },
  FIGHT_PROP_GRASS_ADD_HURT:    { label: 'Dendro',   short: 'Dend',  pct: true,  iconKey: 'dendroDmg'  },
  FIGHT_PROP_BASE_ATTACK:       { label: 'Base ATK', short: 'Base',  pct: false, iconKey: null          },
};

// ── equipType → canonical slot name ──────────────────────────────────────────

export const EQUIP_SLOT = {
  EQUIP_BRACER:   'flower',
  EQUIP_NECKLACE: 'feather',
  EQUIP_SHOES:    'sands',
  EQUIP_RING:     'goblet',
  EQUIP_DRESS:    'circlet',
};

export const SLOT_ORDER = ['flower','feather','sands','goblet','circlet'];

// ── Weapon max level from ascension (promoteLevel) ────────────────────────────

const MAX_LEVEL_BY_ASCENSION = [20, 40, 50, 60, 70, 80, 90];

export function weaponMaxLevel(promoteLevel) {
  return MAX_LEVEL_BY_ASCENSION[promoteLevel ?? 0] ?? 20;
}

// ── Value formatters ──────────────────────────────────────────────────────────

function formatStatValue(value, pct, pctScale) {
  if (pct) return `${(value * pctScale).toFixed(1)}%`;
  return Math.round(value).toLocaleString();
}

// fightPropMap values are decimal for percentages (0.311 = 31.1%)
export function formatFightProp(value, pct) {
  return formatStatValue(value, pct, 100);
}

// reliquarySubstats values are already in display format (3.5 for 3.5%)
export function formatSubstat(value, pct) {
  return formatStatValue(value, pct, 1);
}
