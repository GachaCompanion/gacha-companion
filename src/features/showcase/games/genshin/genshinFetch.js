// Genshin-specific normalization of raw enka.network API responses.
// Input: raw JSON from fetchEnkaUid(). Output: array of normalized builds.

import {
  loadGenshinData, getCharacterData, getCharacterIconName, getCharacterSmallIconName,
  getNamecardUrl, resolveText, getElementName, FIGHT_PROP, APPEND_PROP,
  EQUIP_SLOT, SLOT_ORDER, weaponMaxLevel,
  formatFightProp, formatSubstat, pickBestDmgBonus, setNameFromIcon,
} from './genshinData';
import { enkaAsset } from '../../utils/assetResolver';

export async function normalizeGenshinShowcase(raw) {
  await loadGenshinData();
  const list = raw.avatarInfoList ?? [];
  return list.map(normalizeAvatar);
}

export function genshinPlayerInfo(raw) {
  const p = raw.playerInfo ?? {};
  return {
    nickname:    p.nickname    ?? '',
    worldLevel:  p.worldLevel  ?? 0,
    signature:   p.signature   ?? '',
    profileIcon: p.profilePicture?.avatarId
      ? enkaAsset(getCharacterIconName(p.profilePicture.avatarId))
      : null,
    ttl: raw.ttl ?? 0,
  };
}

// Builds the display object for a single APPEND_PROP-described stat
// (weapon substat, artifact mainstat, or artifact substat).
function buildAppendStat(desc, value) {
  return {
    label:     desc.label,
    short:     desc.short,
    iconKey:   desc.iconKey ?? null,
    value,
    pct:       desc.pct,
    formatted: formatSubstat(value, desc.pct),
  };
}

// ── Per-character normalization ───────────────────────────────────────────────

function normalizeAvatar(avatar) {
  const {
    avatarId,
    propMap                 = {},
    fightPropMap            = {},
    equipList               = [],
    talentIdList            = [],
    skillLevelMap           = {},
    proudSkillExtraLevelMap = {},
    fetterInfo,
    costumeId,
  } = avatar;

  const charData = getCharacterData(avatarId);

  const level         = Number(propMap['4001']?.val ?? propMap['4001']?.ival ?? 0);
  const constellation = talentIdList.length;
  const friendship    = fetterInfo?.expLevel ?? 0;
  const rarity        = charData?.QualityType === 'QUALITY_ORANGE' ? 5 : 4;
  const element       = getElementName(charData?.Element);
  const nameHash      = charData?.NameTextMapHash;
  const name          = nameHash ? resolveText(nameHash) : `Avatar ${avatarId}`;
  const iconName      = getCharacterIconName(avatarId, costumeId ?? null);
  const icon          = enkaAsset(iconName);
  const smallIcon     = enkaAsset(getCharacterSmallIconName(avatarId));
  const namecardUrl   = getNamecardUrl(avatarId);

  // Talents — SkillOrder gives [normalAttack, skill, burst] skill IDs.
  // ProudMap maps skill ID → proud skill group ID; proudSkillExtraLevelMap
  // carries the +3 constellation bonus (C3 or C5) keyed by proud skill group ID.
  const skillOrder = charData?.SkillOrder ?? [];
  const skills     = charData?.Skills     ?? {};
  const proudMap   = charData?.ProudMap   ?? {};
  const talents    = skillOrder.slice(0, 3).map(skillId => {
    const proudId  = proudMap[String(skillId)];
    const extra    = proudId ? (proudSkillExtraLevelMap[String(proudId)] ?? 0) : 0;
    return {
      icon:    enkaAsset(skills[String(skillId)] ?? null),
      level:   (skillLevelMap[String(skillId)] ?? 1) + extra,
      boosted: extra > 0,
    };
  });

  // Constellation icons
  const constIcons = (charData?.Consts ?? []).map((iconName, i) => ({
    icon:     enkaAsset(iconName),
    unlocked: i < constellation,
  }));

  // Stats from fightPropMap
  const stats = {};
  for (const [numKey, descriptor] of Object.entries(FIGHT_PROP)) {
    const raw = fightPropMap[numKey];
    if (raw !== undefined) {
      stats[descriptor.key] = {
        key:       descriptor.key,
        label:     descriptor.label,
        value:     raw,
        pct:       descriptor.pct,
        formatted: formatFightProp(raw, descriptor.pct),
      };
    }
  }

  // Weapon and artifacts
  let weapon    = null;
  const artifacts = [];

  for (const equip of equipList) {
    const { flat } = equip;
    if (!flat) continue;

    if (flat.itemType === 'ITEM_WEAPON') {
      weapon = normalizeWeapon(equip);
    } else if (flat.itemType === 'ITEM_RELIQUARY') {
      const art = normalizeArtifact(equip);
      if (art) artifacts.push(art);
    }
  }

  // Sort artifacts in canonical slot order
  artifacts.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  // Artifact set counts — derive set name from icon, group, then filter to 2+
  const setCounts = {};
  for (const art of artifacts) {
    if (art.setName) setCounts[art.setName] = (setCounts[art.setName] ?? 0) + 1;
  }
  const artifactSets = Object.entries(setCounts)
    .filter(([, c]) => c >= 2)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return {
    avatarId,
    game: 'genshin',
    name,
    level,
    constellation,
    friendship,
    element,
    rarity,
    icon,
    smallIcon,
    namecardUrl,
    talents,
    constIcons,
    weapon,
    stats,
    bestDmgBonus: pickBestDmgBonus(stats),
    artifacts,
    artifactSets,
  };
}

function normalizeWeapon(equip) {
  const { flat, weapon: w = {} } = equip;
  const promoteLevel = w.promoteLevel ?? 0;
  const affixMap     = w.affixMap ?? {};
  // affixMap has one entry; the value is 0-indexed refinement (0 = R1)
  const refinement   = (Object.values(affixMap)[0] ?? 0) + 1;

  const weaponStats  = flat.weaponStats ?? [];
  const baseAtkStat  = weaponStats.find(s => s.appendPropId === 'FIGHT_PROP_BASE_ATTACK');
  const substatEntry = weaponStats.find(s => s.appendPropId !== 'FIGHT_PROP_BASE_ATTACK');
  const subDesc      = substatEntry ? APPEND_PROP[substatEntry.appendPropId] : null;

  return {
    itemId:     equip.itemId,
    name:       resolveText(flat.nameTextMapHash),
    icon:       enkaAsset(flat.icon),
    rarity:     flat.rankLevel ?? 3,
    level:      w.level ?? 1,
    maxLevel:   weaponMaxLevel(promoteLevel),
    refinement,
    baseAtk:    baseAtkStat?.statValue ?? 0,
    subStat:    subDesc ? buildAppendStat(subDesc, substatEntry.statValue) : null,
  };
}

function normalizeArtifact(equip) {
  const { flat, reliquary: rel = {} } = equip;
  const slot = EQUIP_SLOT[flat.equipType];
  if (!slot) return null;

  const mainDesc = flat.reliquaryMainstat?.mainPropId
    ? APPEND_PROP[flat.reliquaryMainstat.mainPropId]
    : null;

  const substats = (flat.reliquarySubstats ?? []).map(sub => {
    const desc = APPEND_PROP[sub.appendPropId] ?? { label: sub.appendPropId, short: '?', pct: false };
    return buildAppendStat(desc, sub.statValue);
  });

  return {
    slot,
    setName:  setNameFromIcon(flat.icon),
    name:     resolveText(flat.nameTextMapHash),
    icon:     enkaAsset(flat.icon),
    rarity:   flat.rankLevel ?? 5,
    level:    (rel.level ?? 1) - 1,
    mainStat: mainDesc ? buildAppendStat(mainDesc, flat.reliquaryMainstat.statValue) : null,
    substats,
  };
}
