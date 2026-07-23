import React from 'react';

const STARS = [1,2,3,4,5];

export default function ArtifactSlot({ artifact, StatIcon }) {
  if (!artifact) {
    return (
      <div className="artifact-slot artifact-slot--empty">
        <span className="artifact-slot__empty-label">Empty</span>
      </div>
    );
  }

  const { icon, rarity, level, mainStat, substats } = artifact;
  const padded = [...substats, null, null, null, null].slice(0, 4);

  return (
    <div className="artifact-slot">

      {/* Icon with main stat + stars + level overlaid */}
      <div className="artifact-slot__thumb-col">
        {icon && (
          <img
            className="artifact-slot__icon"
            src={icon}
            alt={artifact.name}
            draggable={false}
          />
        )}
        <div className="artifact-slot__overlay">
          <div className="artifact-slot__main-row">
            {StatIcon && (mainStat?.iconKey ?? mainStat?._type) && (
              <StatIcon statKey={mainStat.iconKey ?? mainStat._type} size={13} />
            )}
            <span className="artifact-slot__main-value">{mainStat?.formatted ?? '—'}</span>
          </div>
          <div className="artifact-slot__meta">
            <span className="artifact-slot__stars">
              {STARS.filter(i => i <= rarity).map(i => (
                <span key={i} className="artifact-slot__star">★</span>
              ))}
            </span>
            <span className="artifact-slot__level">+{level}</span>
          </div>
        </div>
      </div>

      {/* Substats — 2-column grid of paired [icon value] flex items */}
      <div className="artifact-slot__substats">
        {padded.map((sub, i) => (
          <div key={i} className={`artifact-slot__sub-pair${!sub ? ' artifact-slot__sub--empty' : ''}`}>
            <span className="artifact-slot__sub-icon">
              {sub && StatIcon && (sub.iconKey ?? sub._type) && (
                <StatIcon statKey={sub.iconKey ?? sub._type} size={14} />
              )}
            </span>
            <span className="artifact-slot__sub-value">
              {sub ? sub.formatted : ''}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}
