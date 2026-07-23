import React from 'react';
import { hsrAsset } from './hsrData';

// Stat key → enka icon file name (under /ui/hsr/SpriteOutput/UI/Avatar/Icon/).
// Resolved at render time so saved builds get icons without a re-fetch.
const ICON_NAME = {
  hp:       'IconMaxHP',
  atk:      'IconAttack',
  def:      'IconDefence',
  spd:      'IconSpeed',
  critRate: 'IconCriticalChance',
  critDmg:  'IconCriticalDamage',
  be:       'IconBreakUp',
  ehr:      'IconStatusProbability',
  eres:     'IconStatusResistance',
  err:      'IconEnergyRecovery',
  ohb:      'IconHealRatio',
};

// Path-based DMG icon by path. Elation is internally "Joy".
const PATH_DMG_NAME = {
  Elation: 'IconJoy',
};

// elemDmg is per-element: Icon<Element>AddedRatio.
const ELEM_DMG_NAME = {
  Fire:      'IconFireAddedRatio',
  Ice:       'IconIceAddedRatio',
  Thunder:   'IconThunderAddedRatio',
  Wind:      'IconWindAddedRatio',
  Quantum:   'IconQuantumAddedRatio',
  Imaginary: 'IconImaginaryAddedRatio',
  Physical:  'IconPhysicalAddedRatio',
};

// Raw enka property type → icon name, for relic main/sub stats.
const TYPE_ICON = {
  HPDelta:               'IconMaxHP',
  HPAddedRatio:          'IconMaxHP',
  AttackDelta:           'IconAttack',
  AttackAddedRatio:      'IconAttack',
  DefenceDelta:          'IconDefence',
  DefenceAddedRatio:     'IconDefence',
  SpeedDelta:            'IconSpeed',
  CriticalChance:        'IconCriticalChance',
  CriticalChanceBase:    'IconCriticalChance',
  CriticalDamage:        'IconCriticalDamage',
  CriticalDamageBase:    'IconCriticalDamage',
  StatusProbability:     'IconStatusProbability',
  StatusProbabilityBase: 'IconStatusProbability',
  StatusResistance:      'IconStatusResistance',
  StatusResistanceBase:  'IconStatusResistance',
  BreakDamageAddedRatio:     'IconBreakUp',
  BreakDamageAddedRatioBase: 'IconBreakUp',
  HealRatio:             'IconHealRatio',
  HealRatioBase:         'IconHealRatio',
  SPRatio:               'IconEnergyRecovery',
  SPRatioBase:           'IconEnergyRecovery',
  FireAddedRatio:        'IconFireAddedRatio',
  IceAddedRatio:         'IconIceAddedRatio',
  ThunderAddedRatio:     'IconThunderAddedRatio',
  WindAddedRatio:        'IconWindAddedRatio',
  QuantumAddedRatio:     'IconQuantumAddedRatio',
  ImaginaryAddedRatio:   'IconImaginaryAddedRatio',
  PhysicalAddedRatio:    'IconPhysicalAddedRatio',
};

export default function HsrStatIcon({ statKey, element, path, size, className }) {
  const name = statKey === 'elemDmg' ? ELEM_DMG_NAME[element]
             : statKey === 'pathDmg' ? PATH_DMG_NAME[path]
             : ICON_NAME[statKey] ?? TYPE_ICON[statKey];
  if (!name) return null;
  const src = hsrAsset(`/ui/hsr/SpriteOutput/UI/Avatar/Icon/${name}.png`);
  const style = size ? { width: size, height: size } : undefined;
  return <img className={className} style={style} src={src} alt="" draggable={false} />;
}
