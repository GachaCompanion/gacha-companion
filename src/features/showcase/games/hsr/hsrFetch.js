// HSR-specific normalization of raw Enka API responses.
// API endpoint: https://enka.network/api/hsr/uid/{uid}/
// Showcase characters are in detailInfo.avatarDetailList.
// Relic stat values computed from affixes.json (not _flat.props — see computeRelicProps).
// _flat is still used for name/setName lookups only.

import {
  loadHsrData,
  getHsrCharacterData, getHsrSkillData, getHsrRankData,
  getHsrWeaponData, getHsrRelicData, getHsrRelicSetData, getHsrTreeData,
  getHsrMainAffix, getHsrSubAffix,
  hsrText, hsrAsset,
  HSR_RELIC_SLOT, HSR_SLOT_ORDER, HSR_STAT, formatHsrStat,
} from './hsrData';

export async function normalizeHsrShowcase(raw) {
  await loadHsrData();
  const list = raw.detailInfo?.avatarDetailList ?? [];
  return list.map(normalizeAvatar);
}

export function hsrPlayerInfo(raw) {
  const p = raw.detailInfo ?? {};
  return {
    nickname:    p.nickname   ?? '',
    worldLevel:  p.worldLevel ?? 0,
    signature:   p.signature  ?? '',
    profileIcon: null,
    ttl: raw.ttl ?? 0,
  };
}

// Builds the display object for a single HSR_STAT-described stat value
// (light cone substat, relic mainstat, or relic substat).
function buildHsrStat(type, value, desc) {
  return {
    label:     desc.label,
    short:     desc.short,
    value,
    pct:       desc.pct,
    formatted: formatHsrStat(type, value),
    _type:     type,
  };
}

// ── Per-character normalization ───────────────────────────────────────────────

function normalizeAvatar(avatar) {
  const {
    avatarId,
    level         = 1,
    promotion     = 0,
    rank          = 0,   // eidolons unlocked
    skillTreeList = [],
    equipment     = null,
    relicList     = [],
  } = avatar;

  const charData = getHsrCharacterData(avatarId);

  const nameHash = charData?.AvatarName?.Hash;
  const resolvedName = nameHash ? hsrText(nameHash) : '';
  const resolutionFailed = !resolvedName;
  const name   = resolvedName || `Avatar ${avatarId}`;
  const rarity = charData?.Rarity ?? 4;

  const icon      = hsrAsset(charData?.AvatarCutinFrontImgPath ?? null);
  const smallIcon = hsrAsset(charData?.AvatarSideIconPath ?? null);

  // ── Skills ────────────────────────────────────────────────────────────────
  // Map node suffix (last 3 digits) → base level from the API skillTreeList.
  // Some characters report pointIds with an extra leading digit (e.g. Firefly's
  // 11310001 vs avatars.json's 1310001). Match on the suffix (unique per
  // character), but only accept a node once the 4 digits before it confirm this
  // character's avatarId — so a stray node from another base can't be matched.
  const aid = String(avatarId);
  const skillLevelMap = {};
  for (const node of skillTreeList) {
    const id = String(node.pointId);
    if (id.slice(0, -3).endsWith(aid)) {
      skillLevelMap[id.slice(-3)] = node.level ?? 1;
    }
  }

  // Build eidolon skill boost map — E3 and E5 each add to specific skills
  const skillBoostMap = {};
  const allRankIds = charData?.RankIDList ?? [];
  for (let i = 0; i < Math.min(rank, allRankIds.length); i++) {
    const rankData = getHsrRankData(allRankIds[i]);
    for (const [pointId, boost] of Object.entries(rankData?.SkillAddLevelList ?? {})) {
      skillBoostMap[pointId] = (skillBoostMap[pointId] ?? 0) + boost;
    }
  }

  // All combat skills: AvatarSkills + SummonSkills (flattened)
  const avatarSkillIds  = (charData?.SkillTree?.['0']?.AvatarSkills ?? [])
    .map(id => ({ id, isSummon: false }));
  const summonSkillIds  = (charData?.SkillTree?.['0']?.SummonSkills ?? [])
    .flat().map(id => ({ id, isSummon: true }));

  // ── Traces (skill tree visual) ────────────────────────────────────────────
  // PropSkills[i] = trace nodes for AvatarSkills[i], positionally matched.
  // First node in each group is the ability trace (SkillTree icon); rest are stat nodes.
  const propSkills = charData?.SkillTree?.['0']?.PropSkills ?? [];

  const skillLevel = (id) => skillLevelMap[String(id).slice(-3)];

  const traces = avatarSkillIds.map(({ id: pointId }, i) => {
    const skillData = getHsrSkillData(pointId);
    const base      = skillLevel(pointId) ?? 1;
    const boost     = skillBoostMap[pointId] ?? 0;
    const nodes = (propSkills[i] ?? []).map(nodeId => {
      const nodeData = getHsrSkillData(nodeId);
      return {
        icon:      hsrAsset(nodeData?.IconPath ?? null),
        unlocked:  (skillLevel(nodeId) ?? 0) >= 1,
        isAbility: !!(nodeData?.IconPath?.includes('SkillTree')),
      };
    });
    return {
      icon:    hsrAsset(skillData?.IconPath ?? null),
      level:   base + boost,
      boosted: boost > 0,
      nodes,
    };
  });

  const talents = [...avatarSkillIds, ...summonSkillIds].map(({ id: pointId, isSummon }) => {
    const skillData = getHsrSkillData(pointId);
    const base      = skillLevel(pointId) ?? 1;
    const boost     = skillBoostMap[pointId] ?? 0;
    return {
      icon:     hsrAsset(skillData?.IconPath ?? null),
      level:    base + boost,
      boosted:  boost > 0,
      isSummon,
    };
  });

  // ── Eidolons ──────────────────────────────────────────────────────────────
  const constIcons = allRankIds.slice(0, 6).map((rankId, i) => {
    const rankData = getHsrRankData(rankId);
    return {
      icon:     hsrAsset(rankData?.IconPath ?? null),
      unlocked: i < rank,
    };
  });
  while (constIcons.length < 6) constIcons.push({ icon: null, unlocked: false });

  // ── Light cone ────────────────────────────────────────────────────────────
  const weapon = equipment ? normalizeLightCone(equipment) : null;

  // ── Relics ────────────────────────────────────────────────────────────────
  const rawRelics = Array.isArray(relicList) ? relicList : [];
  const artifacts = rawRelics.map(normalizeRelic).filter(Boolean);
  artifacts.sort((a, b) => HSR_SLOT_ORDER.indexOf(a.slot) - HSR_SLOT_ORDER.indexOf(b.slot));

  const setCounts = {};
  for (const art of artifacts) {
    if (art.setName) setCounts[art.setName] = (setCounts[art.setName] ?? 0) + 1;
  }
  const artifactSets = Object.entries(setCounts)
    .filter(([, c]) => c >= 2)
    .map(([n, count]) => ({ name: n, count }))
    .sort((a, b) => b.count - a.count);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = buildStats({
    rawRelics,
    rawEquip: equipment,
    charData,
    level,
    promotion,
    skillTreeList,
    weapon,
  });

  return {
    game: 'hsr',
    resolutionFailed,
    avatarId,
    name,
    level,
    maxLevel:   promotionMaxLevel(promotion),
    eidolon:    rank,
    friendship: 0,
    element:    charData?.Element ?? null,
    path:       charData?.AvatarBaseType ?? null,
    rarity,
    icon,
    smallIcon,
    talents,
    traces,
    constIcons,
    weapon,
    stats,
    bestDmgBonus: null,
    artifacts,
    artifactSets,
  };
}

// ── Light cone ────────────────────────────────────────────────────────────────

// Full light cone art, keyed by tid — pre-downloaded/cached by the main process
// (electron/charImages.js's ensureCharIcon, called from HsrCard.js) instead of
// hitting nanoka live on every render.
export const nanokaLightConeUrl = (tid) => `https://static.nanoka.cc/assets/hsr/lightconemaxfigures/${tid}.webp`;

function normalizeLightCone(equip) {
  const { tid, rank = 1, level = 1, promotion = 0, _flat = {} } = equip;

  const props    = _flat.props ?? [];
  const weapData = getHsrWeaponData(tid);
  const nameHash = _flat.name ?? weapData?.EquipmentName?.Hash;
  const name     = nameHash ? hsrText(nameHash) : `LC ${tid}`;
  const icon     = hsrAsset(weapData?.ImagePath ?? null);
  const rarity   = weapData?.Rarity ?? 3;

  // _flat.props has pre-computed base stats (BaseHP, BaseAttack, BaseDefence)
  const hpProp   = props.find(p => p.type === 'BaseHP');
  const atkProp  = props.find(p => p.type === 'BaseAttack');
  const defProp  = props.find(p => p.type === 'BaseDefence');

  // LC passive stat from EquipmentSkill[superimposition]
  const skillProps = weapData?.EquipmentSkill?.[String(rank)]?.props ?? {};
  const subEntry   = Object.entries(skillProps)[0] ?? null;
  const subStat    = subEntry ? (() => {
    const [type, value] = subEntry;
    const desc = HSR_STAT[type] ?? { label: type, short: type, pct: false };
    return buildHsrStat(type, value, desc);
  })() : null;

  return {
    itemId:          tid,
    name,
    icon,
    artUrl:          nanokaLightConeUrl(tid),
    rarity,
    level,
    maxLevel:        promotionMaxLevel(promotion),
    superimposition: rank,
    baseHp:          hpProp?.value  ?? 0,
    baseAtk:         atkProp?.value ?? 0,
    baseDef:         defProp?.value ?? 0,
    subStat,
  };
}

// ── Relic ─────────────────────────────────────────────────────────────────────

// Compute relic stat props from affixes.json (avoids _flat.props floating point imprecision).
// Returns [{ type, value }] — index 0 is main stat, 1+ are substats.
function computeRelicProps(relic) {
  const { tid, level = 0, mainAffixId, subAffixList = [] } = relic;
  const relicData = getHsrRelicData(tid);
  const rarity    = relicData?.Rarity ?? 5;
  const props     = [];

  // Main stat
  const mainAffixGroup = relicData?.MainAffixGroup;
  if (mainAffixGroup && mainAffixId != null) {
    const affix = getHsrMainAffix(mainAffixGroup, mainAffixId);
    if (affix) {
      props.push({ type: affix.Property, value: affix.BaseValue + affix.LevelAdd * level });
    }
  }

  // Substats
  for (const sub of subAffixList) {
    const affix = getHsrSubAffix(rarity, sub.affixId);
    if (affix) {
      const value = affix.BaseValue * (sub.cnt ?? 1) + affix.StepValue * (sub.step ?? 0);
      props.push({ type: affix.Property, value });
    }
  }

  return props;
}

function normalizeRelic(relic) {
  const { tid, type, level = 0, _flat = {} } = relic;
  const slot = HSR_RELIC_SLOT[type];
  if (!slot) return null;

  const relicData = getHsrRelicData(tid);
  const setNameHash = _flat.setName;
  const setName   = setNameHash ? (hsrText(setNameHash) || '') : (() => {
    const setId = relicData?.SetID;
    const setData = setId != null ? getHsrRelicSetData(setId) : null;
    return setData?.Name ? (hsrText(setData.Name) || '') : '';
  })();
  const icon   = hsrAsset(relicData?.Icon ?? null);
  const rarity = relicData?.Rarity ?? 5;

  // Use affixes.json-computed values — no _flat.props for stat values
  const props    = computeRelicProps(relic);
  const mainProp = props[0] ?? null;
  const subProps = props.slice(1);

  const mainDesc = mainProp ? (HSR_STAT[mainProp.type] ?? null) : null;
  const substats = subProps.map(p => {
    const desc = HSR_STAT[p.type] ?? { label: p.type, short: p.type, pct: false };
    return buildHsrStat(p.type, p.value, desc);
  });

  return {
    slot,
    setName,
    name:     '',
    icon,
    rarity,
    level,
    mainStat: mainDesc && mainProp ? buildHsrStat(mainProp.type, mainProp.value, mainDesc) : null,
    substats,
    _props: props,
  };
}

// ── Stat computation ──────────────────────────────────────────────────────────
// Full calculation: char base + LC base + skill tree passives + relic contributions.

const ELEM_DMG_TYPES = {
  FireAddedRatio:      'Fire DMG',
  IceAddedRatio:       'Ice DMG',
  ThunderAddedRatio:   'Lightning DMG',
  WindAddedRatio:      'Wind DMG',
  QuantumAddedRatio:   'Quantum DMG',
  ImaginaryAddedRatio: 'Imaginary DMG',
  PhysicalAddedRatio:  'Physical DMG',
};

function buildStats({ rawRelics, rawEquip, charData, level, promotion, skillTreeList, weapon }) {
  const acc = {};
  function add(type, value) {
    if (type && value != null) acc[type] = (acc[type] ?? 0) + value;
  }

  // ── Skill tree passive bonuses ───────────────────────────────────────────
  // Each unlocked node (level >= 1) in skillTreeList may grant stat bonuses.
  for (const node of (skillTreeList ?? [])) {
    if ((node.level ?? 0) < 1) continue;
    const treeEntry = getHsrTreeData(node.pointId);
    if (!treeEntry) continue;
    const props = treeEntry[String(node.level)]?.props ?? treeEntry['1']?.props ?? {};
    for (const [type, value] of Object.entries(props)) add(type, value);
  }

  // ── Relic contributions (main stat + substats via affixes.json) ───────────
  for (const relic of rawRelics) {
    for (const p of computeRelicProps(relic)) add(p.type, p.value);
  }

  // ── Relic set bonuses (2-piece and 4-piece) ───────────────────────────────
  const setIdCounts = {};
  for (const relic of rawRelics) {
    const relicData = getHsrRelicData(relic.tid);
    const setId = relicData?.SetID;
    if (setId != null) setIdCounts[setId] = (setIdCounts[setId] ?? 0) + 1;
  }
  for (const [setId, count] of Object.entries(setIdCounts)) {
    const setData = getHsrRelicSetData(Number(setId));
    const skills  = setData?.SetSkills ?? {};
    for (const [threshold, skill] of Object.entries(skills)) {
      if (count >= Number(threshold)) {
        for (const [type, value] of Object.entries(skill.props ?? {})) add(type, value);
      }
    }
  }

  // ── LC passive stat from EquipmentSkill ─────────────────────────────────
  if (weapon?.subStat?._type) add(weapon.subStat._type, weapon.subStat.value);

  // ── Character base stats ─────────────────────────────────────────────────
  const charPromo = charData?.Promotion?.[String(promotion)] ?? charData?.Promotion?.['0'] ?? {};
  const charBaseHP  = (charPromo.HPBase  ?? 0) + (charPromo.HPAdd  ?? 0) * (level - 1);
  const charBaseATK = (charPromo.AttackBase  ?? 0) + (charPromo.AttackAdd  ?? 0) * (level - 1);
  const charBaseDEF = (charPromo.DefenceBase ?? 0) + (charPromo.DefenceAdd ?? 0) * (level - 1);
  const charBaseSPD = charPromo.SpeedBase ?? 0;
  const charBaseCR  = charPromo.CriticalChance ?? 0.05;
  const charBaseCD  = charPromo.CriticalDamage ?? 0.50;

  // ── LC base stats — read directly from Enka's pre-computed _flat.props ──
  let lcBaseHP = 0, lcBaseATK = 0, lcBaseDEF = 0;
  if (rawEquip) {
    for (const p of (rawEquip._flat?.props ?? [])) {
      if (p.type === 'BaseHP')      lcBaseHP  = p.value;
      if (p.type === 'BaseAttack')  lcBaseATK = p.value;
      if (p.type === 'BaseDefence') lcBaseDEF = p.value;
    }
  }

  // ── Final totals ─────────────────────────────────────────────────────────
  // Round to n decimal places to eliminate IEEE 754 floating point drift
  // before flooring — same approach as Fribbels' precisionRound.
  const pr = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
  const pct = v => `${(Math.floor(pr(v, 5) * 1000) / 10).toFixed(1)}%`;
  const num = v => Math.floor(pr(v, 2)).toLocaleString();
  const stats = {};

  const baseHP  = charBaseHP  + lcBaseHP;
  const baseATK = charBaseATK + lcBaseATK;
  const baseDEF = charBaseDEF + lcBaseDEF;

  const totalHP  = Math.floor(pr(baseHP  * (1 + (acc.HPAddedRatio      ?? 0)) + (acc.HPDelta      ?? 0), 2));
  const totalATK = Math.floor(pr(baseATK * (1 + (acc.AttackAddedRatio   ?? 0)) + (acc.AttackDelta   ?? 0), 2));
  const totalDEF = Math.floor(pr(baseDEF * (1 + (acc.DefenceAddedRatio  ?? 0)) + (acc.DefenceDelta  ?? 0), 2));
  const totalSPD = Math.floor(pr(charBaseSPD * (1 + (acc.SpeedAddedRatio ?? 0)) + (acc.SpeedDelta    ?? 0), 2));

  if (totalHP  > 0) stats.hp  = { label: 'HP',  value: totalHP,  formatted: num(totalHP)  };
  if (totalATK > 0) stats.atk = { label: 'ATK', value: totalATK, formatted: num(totalATK) };
  if (totalDEF > 0) stats.def = { label: 'DEF', value: totalDEF, formatted: num(totalDEF) };
  if (totalSPD > 0) stats.spd = { label: 'SPD', value: totalSPD, formatted: num(totalSPD) };

  const critRate = charBaseCR + (acc.CriticalChance ?? 0) + (acc.CriticalChanceBase ?? 0);
  const critDmg  = charBaseCD + (acc.CriticalDamage ?? 0) + (acc.CriticalDamageBase ?? 0);
  stats.critRate = { label: 'CRIT Rate', value: critRate, formatted: pct(critRate) };
  stats.critDmg  = { label: 'CRIT DMG',  value: critDmg,  formatted: pct(critDmg)  };

  const be = (acc.BreakDamageAddedRatio ?? 0) + (acc.BreakDamageAddedRatioBase ?? 0);
  if (be > 0) stats.be = { label: 'Break Effect', value: be, formatted: pct(be) };

  const ehr = (acc.StatusProbability ?? 0) + (acc.StatusProbabilityBase ?? 0);
  if (ehr > 0) stats.ehr = { label: 'Effect Hit Rate', value: ehr, formatted: pct(ehr) };

  const eres = (acc.StatusResistance ?? 0) + (acc.StatusResistanceBase ?? 0);
  if (eres > 0) stats.eres = { label: 'Effect RES', value: eres, formatted: pct(eres) };

  const errBonus = (acc.SPRatio ?? 0) + (acc.SPRatioBase ?? 0);
  if (errBonus > 0) stats.err = { label: 'Energy Regen', value: 1 + errBonus, formatted: pct(1 + errBonus) };

  const ohb = (acc.HealRatio ?? 0) + (acc.HealRatioBase ?? 0);
  if (ohb > 0) stats.ohb = { label: 'Outgoing Healing', value: ohb, formatted: pct(ohb) };

  let bestElem = null;
  for (const [type, label] of Object.entries(ELEM_DMG_TYPES)) {
    const v = acc[type] ?? 0;
    if (v > 0 && (!bestElem || v > bestElem.value)) bestElem = { label, value: v };
  }
  if (bestElem) stats.elemDmg = { label: bestElem.label, value: bestElem.value, formatted: pct(bestElem.value) };

  // Path-based DMG bonus (e.g. Elation DMG) — type is derived from the path.
  const baseType = charData?.AvatarBaseType;
  const pathDmg = (acc[`${baseType}DamageAddedRatio`] ?? 0) + (acc[`${baseType}DamageAddedRatioBase`] ?? 0);
  if (pathDmg > 0) stats.pathDmg = { label: `${baseType} DMG`, value: pathDmg, formatted: pct(pathDmg) };

  return stats;
}

function promotionMaxLevel(promotion) {
  return [20, 30, 40, 50, 60, 70, 80][promotion] ?? 80;
}
