// HSR showcase normalization using starrail.js (Node.js main process only).
// Returns plain serializable objects — no starrail.js class instances cross IPC.

const { StarRail } = require('starrail.js');

// Force all assets through enka.network — the other CDNs (FortOfFans, Mar-7th)
// are blocked or unreliable in the Electron webview.
const ENKA_ONLY_IMAGE_BASE = [
  {
    filePath: 'UPPER_CAMEL_CASE',
    priority: 5,
    format: 'PNG',
    regexList: [/.*/],
    url: 'https://enka.network/ui/hsr',
  },
];

let _client = null;
function getClient() {
  if (!_client) _client = new StarRail({ imageBaseUrls: ENKA_ONLY_IMAGE_BASE });
  return _client;
}

const ENKA = 'https://enka.network/ui/hsr/SpriteOutput';

// Construct enka CDN URLs directly from IDs — avoids relying on starrail.js
// URL generation which uses wrong subdirectory paths for several asset types.
function enkaPortrait(id)        { return `${ENKA}/AvatarDrawCard/${id}.png`; }
function enkaRoundIcon(id)       { return `${ENKA}/AvatarRoundIcon/${id}.png`; }
function enkaEidolonIcon(charId, rank) { return `${ENKA}/SkillIcons/SkillIcon_${charId}_Rank${rank}.png`; }
function enkaLcIcon(lcId)        { return `${ENKA}/LightConeFigures/${lcId}.png`; }
// Skill icons have the right filename from starrail.js but are nested inside a
// wrong /Avatar/{id}/ subdirectory — strip that and use the flat SkillIcons path.
function enkaSkillIcon(url) {
  if (!url) return null;
  const match = url.match(/SkillIcon_\d+_\w+\.png$/);
  return match ? `${ENKA}/SkillIcons/${match[0]}` : url;
}

const SLOT_MAP = {
  HEAD: 'head', HAND: 'hands', BODY: 'body',
  FOOT: 'feet', NECK: 'sphere', OBJECT: 'rope',
};

const SLOT_ORDER = ['head', 'hands', 'body', 'feet', 'sphere', 'rope'];

async function fetchAndNormalizeHsr(uid) {
  const client = getClient();
  const user = await client.fetchUser(Number(uid));

  const playerInfo = {
    nickname:    user.nickname          ?? '',
    worldLevel:  user.equilibriumLevel  ?? 0,
    signature:   user.signature         ?? '',
    profileIcon: null,
    ttl:         0,
  };

  const builds = user.getCharacters().map(normalizeCharacter);
  return { playerInfo, builds };
}

function normalizeCharacter(c) {
  const charData         = c.characterData;
  const name             = charData.name.get('en') ?? '';
  const unlockedEidolons = c.eidolons ?? 0;

  // All 6 eidolon icons — locked ones render dimmed in the card UI
  const constIcons = charData.eidolons.slice(0, 6).map((e, i) => ({
    icon:     enkaEidolonIcon(charData.id, e.rank),
    unlocked: i < unlockedEidolons,
  }));
  while (constIcons.length < 6) constIcons.push({ icon: null, unlocked: false });

  // Main combat skills (non-servant): Basic, Skill, Ultimate, Talent, Technique
  const mainSkills = c.skills.filter(s => !s.isServant).slice(0, 5);
  const traces = mainSkills.map(sk => ({
    icon:    enkaSkillIcon(sk.skillIcon?.url),
    level:   sk.level?.value ?? (typeof sk.level === 'number' ? sk.level : 1),
    boosted: false,
    nodes:   [],
  }));

  // Computed total stats (base + LC + relics + skill tree)
  const os = c.stats?.overallStats ?? {};
  const pct = v => ((v ?? 0) * 100).toFixed(1) + '%';

  const BE_VAL   = os.breakEffect?.value           ?? 0;
  const ERR_VAL  = os.energyRegenRate?.value        ?? 1.0;
  const EHR_VAL  = os.effectHitRate?.value          ?? 0;
  const ERES_VAL = os.effectResistance?.value        ?? 0;
  const OHB_VAL     = os.outgoingHealingBoost?.value ?? 0;
  const ELATION_VAL = os.elation?.value              ?? 0;

  const ELEM_DMGS = [
    { label: 'Physical DMG', value: os.physicalDamageBonus?.value   ?? 0 },
    { label: 'Fire DMG',     value: os.fireDamageBonus?.value        ?? 0 },
    { label: 'Ice DMG',      value: os.iceDamageBonus?.value         ?? 0 },
    { label: 'Lightning DMG',value: os.lightningDamageBonus?.value   ?? 0 },
    { label: 'Wind DMG',     value: os.windDamageBonus?.value        ?? 0 },
    { label: 'Quantum DMG',  value: os.quantumDamageBonus?.value     ?? 0 },
    { label: 'Imaginary DMG',value: os.imaginaryDamageBonus?.value   ?? 0 },
  ];
  const bestElem = ELEM_DMGS.reduce((b, e) => e.value > (b?.value ?? 0) ? e : b, null);

  const stats = {
    hp:       { label: 'HP',        formatted: Math.round(os.maxHP?.value  ?? 0).toLocaleString() },
    atk:      { label: 'ATK',       formatted: Math.round(os.attack?.value ?? 0).toLocaleString() },
    def:      { label: 'DEF',       formatted: Math.round(os.defense?.value ?? 0).toLocaleString() },
    spd:      { label: 'SPD',       formatted: (os.speed?.value ?? 0).toFixed(1) },
    critRate: { label: 'CRIT Rate', formatted: pct(os.critRate?.value) },
    critDmg:  { label: 'CRIT DMG',  formatted: pct(os.critDamage?.value) },
    ...(BE_VAL   > 0    ? { be:       { label: 'Break Effect',    formatted: pct(BE_VAL)   } } : {}),
    ...(ERR_VAL  > 1.0  ? { err:      { label: 'Energy Regen',    formatted: pct(ERR_VAL)  } } : {}),
    ...(EHR_VAL  > 0    ? { ehr:      { label: 'Effect Hit Rate', formatted: pct(EHR_VAL)  } } : {}),
    ...(ERES_VAL > 0    ? { effectRes:{ label: 'Effect RES',      formatted: pct(ERES_VAL) } } : {}),
    ...(OHB_VAL      > 0 ? { ohb:     { label: 'Outgoing Healing', formatted: pct(OHB_VAL)      } } : {}),
    ...(ELATION_VAL  > 0 ? { elation: { label: 'Elation',          formatted: pct(ELATION_VAL)  } } : {}),
    ...(bestElem && bestElem.value > 0 ? { elemDmg: { label: bestElem.label, formatted: pct(bestElem.value) } } : {}),
  };

  const weapon    = c.lightCone ? normalizeLightCone(c.lightCone) : null;
  const artifacts = c.relics.map(normalizeRelic).filter(Boolean);
  artifacts.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));

  const setCounts = {};
  for (const art of artifacts) {
    if (art.setName) setCounts[art.setName] = (setCounts[art.setName] ?? 0) + 1;
  }
  const artifactSets = Object.entries(setCounts)
    .filter(([, n]) => n >= 2)
    .map(([n, count]) => ({ name: n, count }))
    .sort((a, b) => b.count - a.count);

  return {
    game:            'hsr',
    resolutionFailed: !name,
    avatarId:         charData.id,
    name:             name || `Avatar ${charData.id}`,
    level:            c.level ?? 1,
    constellation:    unlockedEidolons,
    friendship:       0,
    element:          null,
    rarity:           charData.stars ?? 4,
    icon:             enkaPortrait(charData.id),
    smallIcon:        enkaRoundIcon(charData.id),
    traces,
    constIcons,
    weapon,
    stats,
    bestDmgBonus:     null,
    artifacts,
    artifactSets,
  };
}

function normalizeLightCone(lc) {
  const lcData          = lc.lightConeData;
  const superimposition = lc.superimposition?.level ?? 1;
  const atkStat         = (lc.basicStats ?? []).find(s => s.type === 'BaseAttack');
  const supStats        = lc.superimposition?.stats ?? [];

  // Format the LC substat using the same HSR_STAT pct logic (duplicated here to avoid
  // importing renderer-side hsrData.js into the main process).
  const PCT_TYPES = new Set([
    'HPAddedRatio','AttackAddedRatio','DefenceAddedRatio','SpeedAddedRatio',
    'CriticalChance','CriticalDamage','StatusProbability','StatusResistance',
    'BreakDamageAddedRatio','HealRatio','SPRatio',
    'CriticalChanceBase','CriticalDamageBase','StatusProbabilityBase',
    'StatusResistanceBase','BreakDamageAddedRatioBase','HealRatioBase','EnergyRecoveryBase',
    'FireAddedRatio','IceAddedRatio','ThunderAddedRatio','WindAddedRatio',
    'QuantumAddedRatio','ImaginaryAddedRatio','PhysicalAddedRatio',
  ]);

  const SUB_LABELS = {
    HPAddedRatio: 'HP%', AttackAddedRatio: 'ATK%', DefenceAddedRatio: 'DEF%',
    CriticalChance: 'CRIT Rate', CriticalDamage: 'CRIT DMG',
    BreakDamageAddedRatio: 'Break Effect', HealRatio: 'Outgoing Healing',
    SPRatio: 'Energy Regen', StatusProbability: 'Effect Hit Rate',
  };

  const rawSub = supStats[0] ?? null;
  const subStat = rawSub ? (() => {
    const pct = PCT_TYPES.has(rawSub.type);
    return {
      label:     SUB_LABELS[rawSub.type] ?? rawSub.type,
      short:     rawSub.type,
      value:     rawSub.value,
      pct,
      formatted: pct ? (rawSub.value * 100).toFixed(1) + '%' : Math.round(rawSub.value).toLocaleString(),
    };
  })() : null;

  return {
    itemId:     lcData.id,
    name:       lcData.name.get('en') ?? 'Light Cone',
    icon:       enkaLcIcon(lcData.id),
    rarity:     lcData.stars ?? 3,
    level:      lc.level ?? 1,
    maxLevel:   promotionMaxLevel(lc.ascension ?? 0),
    refinement: superimposition,
    baseAtk:    atkStat?.value ?? 0,
    subStat,
  };
}

function normalizeRelic(relic) {
  const slot = SLOT_MAP[relic.relicData.type.id];
  if (!slot) return null;

  const PCT_TYPES = new Set([
    'HPAddedRatio','AttackAddedRatio','DefenceAddedRatio','SpeedAddedRatio',
    'CriticalChance','CriticalDamage','CriticalChanceBase','CriticalDamageBase',
    'StatusProbability','StatusProbabilityBase','StatusResistance','StatusResistanceBase',
    'BreakDamageAddedRatio','BreakDamageAddedRatioBase','HealRatio','HealRatioBase',
    'SPRatio','EnergyRecoveryBase',
    'FireAddedRatio','IceAddedRatio','ThunderAddedRatio','WindAddedRatio',
    'QuantumAddedRatio','ImaginaryAddedRatio','PhysicalAddedRatio',
  ]);

  const STAT_LABELS = {
    HPDelta: 'HP', AttackDelta: 'ATK', DefenceDelta: 'DEF', SpeedDelta: 'SPD',
    HPAddedRatio: 'HP%', AttackAddedRatio: 'ATK%', DefenceAddedRatio: 'DEF%',
    CriticalChance: 'CRIT Rate', CriticalDamageBase: 'CRIT DMG',
    CriticalChanceBase: 'CRIT Rate', CriticalDamage: 'CRIT DMG',
    StatusProbability: 'Effect Hit Rate', StatusProbabilityBase: 'Effect Hit Rate',
    StatusResistance: 'Effect RES', StatusResistanceBase: 'Effect RES',
    BreakDamageAddedRatio: 'Break Effect', BreakDamageAddedRatioBase: 'Break Effect',
    HealRatio: 'OHB', HealRatioBase: 'OHB',
    SPRatio: 'Energy Regen', EnergyRecoveryBase: 'Energy Regen',
  };

  const SHORT_LABELS = {
    HPDelta: 'HP', AttackDelta: 'ATK', DefenceDelta: 'DEF', SpeedDelta: 'SPD',
    HPAddedRatio: 'HP%', AttackAddedRatio: 'ATK%', DefenceAddedRatio: 'DEF%',
    CriticalChance: 'CR', CriticalDamage: 'CD',
    CriticalChanceBase: 'CR', CriticalDamageBase: 'CD',
    StatusProbability: 'EHR', StatusProbabilityBase: 'EHR',
    StatusResistance: 'ERES', StatusResistanceBase: 'ERES',
    BreakDamageAddedRatio: 'BE', BreakDamageAddedRatioBase: 'BE',
    HealRatio: 'OHB', HealRatioBase: 'OHB',
    SPRatio: 'ERR', EnergyRecoveryBase: 'ERR',
  };

  function fmtStat(type, value) {
    if (PCT_TYPES.has(type)) return (value * 100).toFixed(1) + '%';
    return Math.round(value).toLocaleString();
  }

  const mainProp = relic.mainStat ?? null;
  const mainStat = mainProp ? {
    label:     STAT_LABELS[mainProp.type] ?? mainProp.type,
    short:     SHORT_LABELS[mainProp.type] ?? STAT_LABELS[mainProp.type] ?? mainProp.type,
    value:     mainProp.value,
    pct:       PCT_TYPES.has(mainProp.type),
    formatted: fmtStat(mainProp.type, mainProp.value),
  } : null;

  const substats = (relic.subStats ?? []).map(s => ({
    label:     STAT_LABELS[s.type] ?? s.type,
    short:     SHORT_LABELS[s.type] ?? STAT_LABELS[s.type] ?? s.type,
    value:     s.value,
    pct:       PCT_TYPES.has(s.type),
    formatted: fmtStat(s.type, s.value),
  }));

  return {
    slot,
    setName: relic.relicData.set.name.get('en') ?? '',
    name:    '',
    icon:    relic.relicData.icon?.url ?? null,
    rarity:  relic.relicData.stars ?? 5,
    level:   relic.level ?? 0,
    mainStat,
    substats,
  };
}

function promotionMaxLevel(ascension) {
  return [20, 30, 40, 50, 60, 70, 80][ascension] ?? 80;
}

module.exports = { fetchAndNormalizeHsr };
