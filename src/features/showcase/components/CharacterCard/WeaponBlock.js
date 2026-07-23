import React from 'react';

export default function WeaponBlock({ weapon, StatIcon }) {
  if (!weapon) return <div className="weapon-block weapon-block--empty">No weapon equipped</div>;

  const rankLabel = weapon.overclock != null
    ? `OC${weapon.overclock}`
    : weapon.superimposition != null
      ? `S${weapon.superimposition}`
      : `R${weapon.refinement}`;

  return (
    <div className="weapon-block">
      <div className="weapon-block__header">
        {weapon.icon && (
          <img
            className="weapon-block__icon"
            src={weapon.icon}
            alt={weapon.name}
            draggable={false}
          />
        )}
        <div className="weapon-block__info">
          <div className="weapon-block__badges">
            {weapon.baseAtk > 0 && (
              <span className="weapon-block__badge">
                {StatIcon && <StatIcon statKey="atk" size={13} />}
                {Math.round(weapon.baseAtk)}
              </span>
            )}
            {weapon.baseAtk > 0 && weapon.subStat && (
              <span className="weapon-block__sep">·</span>
            )}
            {weapon.subStat && (
              <span className="weapon-block__badge">
                {StatIcon && weapon.subStat.iconKey && <StatIcon statKey={weapon.subStat.iconKey} size={13} />}
                {weapon.subStat.formatted}
              </span>
            )}
          </div>
          <div className="weapon-block__chips">
            <span className="weapon-block__chip">{rankLabel}</span>
            <span className="weapon-block__sep">·</span>
            <span className="weapon-block__chip">Lv. {weapon.level}/{weapon.maxLevel}</span>
          </div>
          <div className={`weapon-block__stars weapon-block__stars--r${weapon.rarity}`}>
            {'★'.repeat(weapon.rarity)}
          </div>
        </div>
      </div>
      <span className="weapon-block__name">{weapon.name}</span>
    </div>
  );
}
