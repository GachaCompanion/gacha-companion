import React from 'react';
import './genshin.card.css';
import WeaponBlock from '../../components/CharacterCard/WeaponBlock';
import TalentRow from '../../components/CharacterCard/TalentRow';
import ArtifactSlot from '../../components/CharacterCard/ArtifactSlot';
import GenshinStatIcon from './GenshinStatIcon';
import { CARD_STATS } from './genshinData';
import { useGameFont } from '../../../../hooks/useGameFont';

const GENSHIN_SLOTS = ['flower', 'feather', 'sands', 'goblet', 'circlet'];

export default function GenshinCard({ build }) {
  const {
    name, level, rarity,
    constellation,
    icon, namecardUrl, talents, constIcons,
    weapon, stats, bestDmgBonus,
    artifacts, artifactSets,
    element,
  } = build;

  const gameFont = useGameFont('genshin');
  const hasStats = stats && Object.keys(stats).length > 0;

  const displayStats = hasStats
    ? CARD_STATS.map(key => stats[key] ? { ...stats[key], key } : null).filter(Boolean)
    : [];

  const artifactBySlot = {};
  for (const art of artifacts) artifactBySlot[art.slot] = art;

  const levelLabel = `Lv. ${level} · C${constellation}`;
  const rarityClass  = rarity === 5 ? ' char-card--r5' : rarity === 4 ? ' char-card--r4' : '';
  const elementClass = element ? ` char-card--elem-${element.toLowerCase()}` : '';

  return (
    <div className={`char-card${rarityClass}${elementClass}`} style={gameFont ? { fontFamily: gameFont } : undefined}>

      {namecardUrl && (
        <div className="char-card__bg" style={{ backgroundImage: `url(${namecardUrl})` }} />
      )}

      {/* ── LEFT: portrait + constellations + talents ── */}
      <div className="char-card__left">
        <div className="char-card__consts">
          {constIcons.map((c, i) => (
            <div
              key={i}
              className={`char-card__const${c.unlocked ? ' char-card__const--unlocked' : ' char-card__const--locked'}`}
            >
              {c.icon && <img src={c.icon} alt="" draggable={false} />}
            </div>
          ))}
        </div>

        {icon && (
          <img
            className="char-card__portrait"
            src={icon}
            alt={name}
            draggable={false}
          />
        )}

        <div className="char-card__talents">
          <TalentRow talents={talents} />
        </div>
      </div>

      {/* Identity block — spans left + center columns, centered */}
      <div className="char-card__identity">
        <div className="char-card__identity-line">
          {rarity >= 4 && (
            <>
              <span className="char-card__char-stars">{'★'.repeat(rarity)}</span>
              <span className="char-card__identity-sep">·</span>
            </>
          )}
          <span className="char-card__name">{name}</span>
          <span className="char-card__identity-sep">·</span>
          <span className="char-card__level">{levelLabel}</span>
          {build.friendship > 0 && (
            <>
              <span className="char-card__identity-sep">·</span>
              <span className="char-card__friendship">♡ {build.friendship}</span>
            </>
          )}
        </div>
      </div>

      {/* ── CENTER: weapon + stats + artifact sets ── */}
      <div className="char-card__center">
        <WeaponBlock weapon={weapon} StatIcon={GenshinStatIcon} />

        {hasStats && (
          <div className="char-card__stats">
            {displayStats.map(stat => (
              <div key={stat.label} className="char-card__stat-row">
                {stat.key && <GenshinStatIcon statKey={stat.key} size={14} />}
                <span className="char-card__stat-label">{stat.label}</span>
                <span className="char-card__stat-value">{stat.formatted}</span>
              </div>
            ))}
            {bestDmgBonus && (
              <div className="char-card__stat-row char-card__stat-row--dmg">
                {bestDmgBonus.key && <GenshinStatIcon statKey={bestDmgBonus.key} size={14} />}
                <span className="char-card__stat-label">{bestDmgBonus.label}</span>
                <span className="char-card__stat-value">{bestDmgBonus.formatted}</span>
              </div>
            )}
          </div>
        )}

        {artifactSets.length > 0 && (
          <div className={`char-card__sets${!hasStats ? ' char-card__sets--flush' : ''}`}>
            {artifactSets.map(s => (
              <span key={s.name} className="char-card__set-tag">
                {s.count}× {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: artifact slots ── */}
      <div className="char-card__right">
        {GENSHIN_SLOTS.map(slot => (
          <ArtifactSlot
            key={slot}
            artifact={artifactBySlot[slot] ?? null}
            StatIcon={GenshinStatIcon}
          />
        ))}
      </div>

    </div>
  );
}
