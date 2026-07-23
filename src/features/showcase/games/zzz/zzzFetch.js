// ZZZ-specific normalization of raw Enka API responses.
// API endpoint: https://enka.network/api/zzz/uid/{uid}/
// Showcase characters are in PlayerInfo.ShowcaseDetail.AvatarList.

import {
  loadZzzData,
  getZzzAvatarData, getZzzWeaponData, getZzzEquipData, getZzzSuitData,
  getZzzNamecards, zzzNamecardIcon,
  zzzText, zzzAsset, isZzzPctProp, getZzzStatInfo,
  CORE_ENHANCEMENT_IDX, ZZZ_DISC_SLOT, ZZZ_SLOT_ORDER,
  DISC_RARITY_SCALE, WEP_MAIN_A, WEP_MAIN_B, WEP_SEC_B,
  formatZzzStat, ZZZ_SKILL_ICONS, zzzProfessionIcon,
} from './zzzData';

export async function normalizeZzzShowcase(raw) {
  await loadZzzData();
  const list = raw.PlayerInfo?.ShowcaseDetail?.AvatarList ?? [];
  return list.filter(a => !a.IsHidden).map(normalizeAvatar);
}

export function zzzPlayerInfo(raw) {
  const pd = raw.PlayerInfo?.SocialDetail?.ProfileDetail ?? {};
  return {
    nickname:   pd.Nickname   ?? '',
    worldLevel: pd.Level      ?? 0,
    signature:  raw.PlayerInfo?.SocialDetail?.Desc ?? '',
    ttl: raw.ttl ?? 0,
  };
}

// Builds the display object for a single stat value described by getZzzStatInfo
// (weapon substat, disc mainstat, or disc substat).
function buildZzzStat(propId, value, info) {
  return {
    label:     info.label,
    short:     info.short,
    value,
    pct:       info.pct,
    iconKey:   info.iconKey,
    formatted: formatZzzStat(propId, value),
    _propId:   propId,
  };
}

// ── Per-character normalization ───────────────────────────────────────────────

function normalizeAvatar(avatar) {
  const {
    Id,
    Level           = 1,
    PromotionLevel  = 0,
    TalentLevel     = 0,   // mindscape cinema level (0–6)
    CoreSkillEnhancement = '',
    SkillLevelList  = {},
    Weapon          = null,
    EquippedList    = [],
  } = avatar;

  const charData   = getZzzAvatarData(Id);
  const name       = zzzText(charData?.Name) || `Agent ${Id}`;
  const rarity     = charData?.Rarity ?? 4;   // 4=S, 3=A
  // A few characters (Miyabi, Yixuan, Ye Shunguang) carry a second, generic
  // element as a fallback entry after their true/special one (e.g. Miyabi:
  // ["FireFrost", "Ice"]) — the first entry is the real, displayed element.
  // ZzzElementIcon.js has an icon (and derives 3D-text colors) for every
  // element, special or not, so there's no need to fall back to the generic
  // entry here.
  const element    = (charData?.ElementTypes ?? [])[0] ?? null;
  const profession = charData?.ProfessionType ?? null;

  const icon          = zzzAsset(charData?.Image ?? null);
  const smallIcon     = zzzAsset(charData?.CircleIcon ?? null);
  const namecard      = zzzNamecardIcon(Id, TalentLevel, getZzzNamecards());
  const professionIcon = zzzProfessionIcon(profession);

  // ── Skills ────────────────────────────────────────────────────────────────
  // Mindscape 3 → all skills +2; mindscape 5 → additional +2 (total +4)
  const skillBoost = TalentLevel >= 5 ? 4 : TalentLevel >= 3 ? 2 : 0;
  // SkillLevelList is [{Level, Index}, ...] array, not a dict
  const skillMap = {};
  for (const s of Array.isArray(SkillLevelList) ? SkillLevelList : []) skillMap[s.Index] = s.Level;
  // Grid render order: row 1 = Basic/Dodge/Assist, row 2 = Special/Chain(Ultimate)/Core
  // (index 4 is unused — see ENKA_SHOWCASE_REFERENCE.md's skill index map).
  const SKILL_INDICES = [0, 2, 6, 1, 3, 5];
  // Core Skill (index 5) doesn't level up like the others — it's shown as an
  // A–F enhancement rank instead, unaffected by the mindscape level boost.
  const CORE_LETTERS = ['0', 'A', 'B', 'C', 'D', 'E', 'F'];
  const coreIdx = typeof CoreSkillEnhancement === 'number'
    ? CoreSkillEnhancement
    : (CORE_ENHANCEMENT_IDX[CoreSkillEnhancement ?? ''] ?? 0);
  const talents = SKILL_INDICES.map(idx => idx === 5 ? ({
    icon:    ZZZ_SKILL_ICONS[idx] ?? null,
    level:   CORE_LETTERS[coreIdx] ?? '0',
    boosted: false,
  }) : ({
    icon:    ZZZ_SKILL_ICONS[idx] ?? null,
    level:   (skillMap[idx] ?? 1) + skillBoost,
    boosted: skillBoost > 0,
  }));

  // ── Mindscape icons (show 6 slots, filled by TalentLevel) ────────────────
  const constIcons = Array.from({ length: 6 }, (_, i) => ({
    icon:     null,
    unlocked: i < TalentLevel,
  }));

  // ── W-Engine ──────────────────────────────────────────────────────────────
  const weapon = Weapon ? normalizeWeapon(Weapon) : null;

  // ── Drive Discs ───────────────────────────────────────────────────────────
  const rawDiscs = Array.isArray(EquippedList) ? EquippedList : [];
  const artifacts = rawDiscs.map(e => normalizeDisc(e)).filter(Boolean);
  artifacts.sort((a, b) => ZZZ_SLOT_ORDER.indexOf(a.slot) - ZZZ_SLOT_ORDER.indexOf(b.slot));

  const setCounts = {};
  for (const disc of artifacts) {
    if (disc.setName) setCounts[disc.setName] = (setCounts[disc.setName] ?? 0) + 1;
  }
  const artifactSets = Object.entries(setCounts)
    .filter(([, c]) => c >= 2)
    .map(([n, count]) => ({ name: n, count }))
    .sort((a, b) => b.count - a.count);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = buildStats({ charData, Level, PromotionLevel, CoreSkillEnhancement, weapon, rawDiscs });

  return {
    game:         'zzz',
    avatarId:     Id,
    name,
    level:        Level,
    mindscape:    TalentLevel,
    friendship:   0,
    element,
    profession,
    professionIcon,
    rarity,
    icon,
    smallIcon,
    namecard,
    talents,
    constIcons,
    weapon,
    stats,
    bestDmgBonus: null,
    artifacts,
    artifactSets,
  };
}

// ── W-Engine ──────────────────────────────────────────────────────────────────

function normalizeWeapon(weapon) {
  const { Id, Level = 1, BreakLevel = 0, UpgradeLevel = 0 } = weapon;
  const wepData = getZzzWeaponData(Id);
  const name    = zzzText(wepData?.ItemName) || `W-Engine ${Id}`;
  const icon    = zzzAsset(wepData?.ImagePath ?? null);
  const rarity  = wepData?.Rarity ?? 4;

  // Approximate formula: main * (1 + A * Level + B * BreakLevel)
  const mainId  = wepData?.MainStat?.PropertyId;
  const mainBase = wepData?.MainStat?.PropertyValue ?? 0;
  const mainValue = mainBase > 0
    ? mainBase * (1 + WEP_MAIN_A * Level + WEP_MAIN_B * BreakLevel)
    : 0;

  const secId    = wepData?.SecondaryStat?.PropertyId;
  const secBase  = wepData?.SecondaryStat?.PropertyValue ?? 0;
  const secValue = secBase > 0
    ? secBase * (1 + WEP_SEC_B * BreakLevel)
    : 0;

  const secInfo = secId != null ? getZzzStatInfo(secId) : null;

  const subStat = secId != null && secInfo ? buildZzzStat(secId, secValue, secInfo) : null;

  // baseAtk is shown in WeaponBlock — use mainValue for ATK-based weapons
  const baseAtk = mainId === 12101 ? Math.round(mainValue) : 0;

  return {
    itemId:      Id,
    name,
    icon,
    rarity,
    level:       Level,
    maxLevel:    maxLevelForBreak(BreakLevel),
    overclock:   UpgradeLevel,  // UpgradeLevel = refinement/superimposition equivalent
    baseAtk,
    _mainId:     mainId,
    _mainValue:  mainValue,
    _secId:      secId,
    subStat,
  };
}

function maxLevelForBreak(breakLevel) {
  return [10, 20, 30, 40, 50, 60][breakLevel] ?? 60;
}

// ── Drive Disc ────────────────────────────────────────────────────────────────

function normalizeDisc(equippedEntry) {
  const { Slot, Equipment } = equippedEntry;
  if (!Equipment) return null;

  const slot = ZZZ_DISC_SLOT[Slot];
  if (!slot) return null;

  const { Id, Level = 0, MainPropertyList = [], RandomPropertyList = [] } = Equipment;
  const equipData = getZzzEquipData(Id);
  const rarity    = equipData?.Rarity ?? 4;
  const suitId    = equipData?.SuitId ?? null;

  const suitData = suitId != null ? getZzzSuitData(suitId) : null;
  const setName  = suitData ? (zzzText(suitData.Name) || `Set ${suitId}`) : '';
  const setIcon  = suitData?.Icon ? zzzAsset(suitData.Icon) : null;

  const rarityScale = DISC_RARITY_SCALE[rarity] ?? 0.2;

  // Main stat (index 0 of MainPropertyList)
  const mainEntry = MainPropertyList[0] ?? null;
  const mainPropId = mainEntry?.PropertyId;
  const mainValue  = mainEntry
    ? mainEntry.PropertyValue * (1 + Level * rarityScale)
    : 0;
  const mainInfo = mainPropId != null ? getZzzStatInfo(mainPropId) : null;

  // Substats (RandomPropertyList) — PropertyValue * PropertyLevel for total value
  const substats = RandomPropertyList.map(sub => {
    const { PropertyId, PropertyValue, PropertyLevel = 1 } = sub;
    const info  = getZzzStatInfo(PropertyId);
    const value = PropertyValue * PropertyLevel;
    return buildZzzStat(PropertyId, value, info);
  });

  return {
    slot,
    setName,
    name:  setName,
    icon:  setIcon,
    // ArtifactSlot's star display (shared with Genshin/HSR) expects rarity to equal
    // star count directly. ZZZ's raw API Rarity is a B/A/S grade (2/3/4, see
    // RANK_LETTER) that's one lower than its star-rank equivalent (B=3★, A=4★,
    // S=5★) — +1 here converts it, without touching the raw value used above for
    // the DISC_RARITY_SCALE stat-formula lookup.
    rarity: rarity + 1,
    level: Level,
    mainStat: mainInfo && mainEntry ? buildZzzStat(mainPropId, mainValue, mainInfo) : null,
    substats,
  };
}

// ── Stat computation ──────────────────────────────────────────────────────────

const ELEM_DMG_PROP_IDS = [31501, 31503, 31601, 31603, 31701, 31703, 31801, 31803, 31901, 31903];
// propId -> ZzzElementIcon element key, so the elemental DMG Bonus stat row can
// reuse the character element badge icon instead of needing its own.
const ELEM_DMG_ELEMENT = {
  31501: 'Physics', 31503: 'Physics',
  31601: 'Fire',    31603: 'Fire',
  31701: 'Ice',     31703: 'Ice',
  31801: 'Elec',    31803: 'Elec',
  31901: 'Ether',   31903: 'Ether',
};
// Fixed 2-column layout for the card's stat block — 6 slots each, left = offense/
// core, right = utility/elemental. sheerForce isn't in either list: it's a rare
// substat (e.g. Yixuan's W-engine) that only shows up by filling a gap left by
// one of the 12 standard stats being absent (see ZZZ_STAT_EXTRA_KEYS below).
const ZZZ_STAT_LEFT_KEYS  = ['hp', 'atk', 'def', 'impact', 'critRate', 'critDmg'];
const ZZZ_STAT_RIGHT_KEYS = ['anomalyProficiency', 'anomalyMastery', 'penRatio', 'penDelta', 'energyRegen', 'elemDmg'];
const ZZZ_STAT_EXTRA_KEYS = ['sheerForce'];
export { ZZZ_STAT_LEFT_KEYS, ZZZ_STAT_RIGHT_KEYS, ZZZ_STAT_EXTRA_KEYS };

function buildStats({ charData, Level, PromotionLevel, CoreSkillEnhancement, weapon, rawDiscs }) {
  const acc = {};
  function add(propId, value) {
    if (propId != null && value != null) {
      acc[propId] = (acc[propId] ?? 0) + value;
    }
  }

  // ── Agent base stats ─────────────────────────────────────────────────────
  // Formula: floor(BaseProps[id]) + floor(GrowthProps[id]*(Level-1)/10000)
  //          + floor(PromotionProps[PromotionLevel-1][id])
  //          + floor(CoreEnhancementProps[coreIdx][id])
  // NOTE: All values used as-is — percent stats are in per-10000 units throughout.
  const baseProps  = charData?.BaseProps  ?? {};
  const growthProps = charData?.GrowthProps ?? {};
  const promoProps = charData?.PromotionProps ?? [];
  const coreProps  = charData?.CoreEnhancementProps ?? [];
  // API sends CoreSkillEnhancement as either an integer (0–6) or string ("A"–"F")
  const coreIdx = typeof CoreSkillEnhancement === 'number'
    ? CoreSkillEnhancement
    : (CORE_ENHANCEMENT_IDX[CoreSkillEnhancement ?? ''] ?? 0);
  const promoEntry = PromotionLevel > 0 ? (promoProps[PromotionLevel - 1] ?? {}) : {};
  const coreEntry  = coreProps[coreIdx] ?? {};

  for (const [idStr, baseVal] of Object.entries(baseProps)) {
    const id = Number(idStr);
    const growth = Math.floor((growthProps[idStr] ?? 0) * (Level - 1) / 10000);
    const promo  = Math.floor(promoEntry[idStr] ?? 0);
    const core   = Math.floor(coreEntry[idStr]  ?? 0);
    add(id, Math.floor(baseVal) + growth + promo + core);
  }

  // ── W-Engine stats ───────────────────────────────────────────────────────
  if (weapon) {
    if (weapon._mainId  != null) add(weapon._mainId,  weapon._mainValue);
    if (weapon._secId   != null) add(weapon._secId,   weapon.subStat?.value);
  }

  // ── Drive Disc main stats + substats + set bonuses ───────────────────────
  const suitCounts = {};
  for (const entry of rawDiscs) {
    const { Equipment } = entry;
    if (!Equipment) continue;
    const { Id, Level: discLevel = 0, MainPropertyList = [], RandomPropertyList = [] } = Equipment;
    const equipData = getZzzEquipData(Id);
    const rarity    = equipData?.Rarity ?? 4;
    const scale     = DISC_RARITY_SCALE[rarity] ?? 0.2;
    const suitId    = equipData?.SuitId;

    for (const main of MainPropertyList) {
      const val = main.PropertyValue * (1 + discLevel * scale);
      add(main.PropertyId, val);
    }
    for (const sub of RandomPropertyList) {
      add(sub.PropertyId, sub.PropertyValue * (sub.PropertyLevel ?? 1));
    }
    if (suitId != null) suitCounts[suitId] = (suitCounts[suitId] ?? 0) + 1;
  }
  // 2-piece set bonuses
  for (const [suitId, count] of Object.entries(suitCounts)) {
    if (count < 2) continue;
    const suitData = getZzzSuitData(suitId);
    const bonusProps = suitData?.SetBonusProps ?? {};
    for (const [propIdStr, value] of Object.entries(bonusProps)) {
      add(Number(propIdStr), value);
    }
  }

  // ── Build final stat object ───────────────────────────────────────────────
  // pct is an alias of flat: percent stats need the same raw sum, the actual
  // /100 + "%" conversion happens at each call site below.
  function flat(propIds) {
    return propIds.reduce((sum, id) => sum + (acc[id] ?? 0), 0);
  }
  const pct = flat;

  const stats = {};

  const hpBase  = acc[11101] ?? 0;
  const hpDelta = acc[11103] ?? 0;
  const hpRatio = acc[11102] ?? 0;
  const hp = Math.round(hpBase + Math.ceil(hpBase * hpRatio / 10000) + hpDelta);
  if (hp > 0) stats.hp = { label: 'HP', value: hp, formatted: hp.toLocaleString() };

  const atkBase  = acc[12101] ?? 0;
  const atkRatio = acc[12102] ?? 0;
  const atkDelta = acc[12103] ?? 0;
  const atk = Math.round(atkBase + Math.floor(atkBase * atkRatio / 10000) + atkDelta);
  if (atk > 0) stats.atk = { label: 'ATK', value: atk, formatted: atk.toLocaleString() };

  const defBase  = acc[13101] ?? 0;
  const defRatio = acc[13102] ?? 0;
  const defDelta = acc[13103] ?? 0;
  const def = Math.round(defBase + Math.floor(defBase * defRatio / 10000) + defDelta);
  if (def > 0) stats.def = { label: 'DEF', value: def, formatted: def.toLocaleString() };

  const impact = flat([12201]);
  if (impact > 0) stats.impact = { label: 'Impact', value: impact, formatted: Math.round(impact).toLocaleString() };

  const critRate = pct([20101, 20103]);
  if (critRate > 0) stats.critRate = { label: 'CRIT Rate', value: critRate, formatted: `${(critRate / 100).toFixed(1)}%` };

  const critDmg = pct([21101, 21103]);
  if (critDmg > 0) stats.critDmg = { label: 'CRIT DMG', value: critDmg, formatted: `${(critDmg / 100).toFixed(1)}%` };

  const sheerForce = flat([12301, 12303]);
  if (sheerForce > 0) stats.sheerForce = { label: 'Sheer Force', value: sheerForce, formatted: Math.round(sheerForce).toLocaleString() };

  const anomalyMastery = flat([31401, 31403]);
  // Abbreviated (not the full "Anomaly Mastery") — the card is narrower than
  // enka's own layout, so the full-length label doesn't fit next to a value.
  if (anomalyMastery > 0) stats.anomalyMastery = { label: 'AM', value: anomalyMastery, formatted: Math.round(anomalyMastery).toLocaleString() };

  const anomalyProficiency = flat([31201, 31203]);
  if (anomalyProficiency > 0) stats.anomalyProficiency = { label: 'AP', value: anomalyProficiency, formatted: Math.round(anomalyProficiency).toLocaleString() };

  const energyRegen = flat([30501, 30503]);
  // ER stored per-100 (120 = 1.20), no percent sign
  if (energyRegen > 0) stats.energyRegen = { label: 'ER', value: energyRegen, formatted: (energyRegen / 100).toFixed(2) };

  const penRatio = pct([23101, 23103]);
  if (penRatio > 0) stats.penRatio = { label: 'PEN Ratio', value: penRatio, formatted: `${(penRatio / 100).toFixed(1)}%` };

  const penDelta = flat([23201, 23203]);
  if (penDelta > 0) stats.penDelta = { label: 'PEN', value: penDelta, formatted: Math.round(penDelta).toLocaleString() };

  let bestElem = null;
  for (const id of ELEM_DMG_PROP_IDS) {
    const v = acc[id] ?? 0;
    if (v > 0 && (!bestElem || v > bestElem.value)) {
      bestElem = { label: getZzzStatInfo(id).label, value: v, elementType: ELEM_DMG_ELEMENT[id] };
    }
  }
  if (bestElem) {
    stats.elemDmg = {
      label: bestElem.label,
      value: bestElem.value,
      elementType: bestElem.elementType,
      formatted: `${(bestElem.value / 100).toFixed(1)}%`,
    };
  }

  return stats;
}
