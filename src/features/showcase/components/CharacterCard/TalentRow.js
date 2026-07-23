import React from 'react';

export default function TalentRow({ talents }) {
  if (!talents?.length) return null;

  return (
    <div className="talent-row">
      {talents.map((t, i) => (
        <div key={i} className={`talent-badge${t.boosted ? ' talent-badge--boosted' : ''}${t.isSummon ? ' talent-badge--summon' : ''}`}>
          {t.icon && (
            <img
              className="talent-badge__icon"
              src={t.icon}
              alt=""
              draggable={false}
            />
          )}
          <span className="talent-badge__level">{t.level}</span>
        </div>
      ))}
    </div>
  );
}
