import React, { useState, useEffect } from 'react';
import './zzz.card.css';
import ArtifactSlot from '../../components/CharacterCard/ArtifactSlot';
import ZzzDiscSpinner from './ZzzDiscSpinner';
import SpineViewer from '../../live2d/SpineViewer';
import ZzzElementIcon, { getZzzElementColor } from './ZzzElementIcon';
import ZzzStatIcon from './ZzzStatIcon';
import ZzzArtifactStatIcon from './ZzzArtifactStatIcon';
import { useGameFont } from '../../../../hooks/useGameFont';
import { ZZZ_STAT_LEFT_KEYS, ZZZ_STAT_RIGHT_KEYS, ZZZ_STAT_EXTRA_KEYS } from './zzzFetch';
import { ZZZ_SLOT_ORDER } from './zzzData';

// ZZZ rank letters (no star system): 4 = S, 3 = A, 2 = B.
const RANK_LETTER = { 4: 'S', 3: 'A', 2: 'B' };

// Vertical fit for ZZZ's Live2D: anchor the model's topmost point (head/hair —
// no face-detection needed, so this works the same for human and non-human
// characters) near the top of the canvas, then zoom to a fixed fraction of
// the model's total height. ZZZ Live2D rigs are built for the game's own
// bust-up UI card, so legs/feet are frequently incomplete or missing — rather
// than trying (and failing) to fit an unreliable "bottom", this zooms in
// enough that only head+torso are ever shown, and whatever's below simply
// falls outside the frame. Both tunable to taste.
const ZZZ_FIT_TOP_FRAC = 0.06;
const ZZZ_TOP_SPAN_FRAC = 0.55;

// Horizontal placement: fraction of the FULL CARD width (not just the left
// column — the Live2D canvas now spans the whole card so it can bleed into
// center without being clipped) where the character's horizontal center
// should land. Checked across all characters — holds up.
const ZZZ_HOLE_X = 0.18;

// Fills a fixed column's slots from `stats`; a slot whose stat is absent (no
// increase over base, e.g. a character with no Anomaly Mastery substat) is
// backfilled from `extraQueue` instead of just leaving a gap — e.g. Yixuan's
// Sheer Force W-engine substat taking the place of a missing standard stat.
function buildStatColumn(keys, stats, extraQueue) {
  const column = [];
  for (const key of keys) {
    if (stats[key]) {
      column.push({ ...stats[key], key });
    } else if (extraQueue.length) {
      const extraKey = extraQueue.shift();
      column.push({ ...stats[extraKey], key: extraKey });
    }
  }
  return column;
}

function renderZzzStatRow(stat) {
  return (
    <div key={stat.key} className="zzz-card__stat-row">
      <span className="zzz-card__stat-label">
        {stat.key === 'elemDmg'
          ? <ZzzElementIcon elementType={stat.elementType} className="zzz-card__stat-icon" />
          : <ZzzStatIcon statKey={stat.key} className="zzz-card__stat-icon" />}
        {stat.label}
      </span>
      <span className="zzz-card__stat-value">{stat.formatted}</span>
    </div>
  );
}

export default function ZzzCard({ build, cardMode = 'live2d' }) {
  const showLive2d = cardMode !== 'png';
  const {
    avatarId,
    name, level, rarity, mindscape,
    element, profession, professionIcon,
    icon, namecard, talents, weapon, stats, artifacts, artifactSets,
  } = build;

  const hasStats = stats && Object.keys(stats).length > 0;
  const extraQueue = hasStats ? ZZZ_STAT_EXTRA_KEYS.filter(key => stats[key]) : [];
  const leftStats  = hasStats ? buildStatColumn(ZZZ_STAT_LEFT_KEYS,  stats, extraQueue) : [];
  const rightStats = hasStats ? buildStatColumn(ZZZ_STAT_RIGHT_KEYS, stats, extraQueue) : [];

  const discBySlot = {};
  for (const d of artifacts) discBySlot[d.slot] = d;

  const rankClass = rarity === 4 ? ' zzz-card--s' : ' zzz-card--a';

  const effectiveAvatarId = avatarId;

  // Per-element accent color for the name/level/mindscape 3D text effect's
  // shadow layer — derived from that element's own icon gradient, so the
  // color always matches the icon exactly with no separate source to keep in sync.
  const elemColor = element ? getZzzElementColor(element) : null;
  const gameFont = useGameFont('zzz');

  // Local background image — downloaded, cropped, and cached by the main process.
  const [showcasesPort, setShowcasesPort] = useState(null);
  useEffect(() => {
    window.api?.getShowcasesServerPort?.().then(setShowcasesPort).catch(() => {});
  }, []);

  const [bgPath, setBgPath] = useState(null);
  useEffect(() => {
    if (!effectiveAvatarId || !showcasesPort) return;
    window.api?.ensureCharImage?.('zzz', effectiveAvatarId)
      .then(rel => { if (rel) setBgPath(`http://127.0.0.1:${showcasesPort}/${rel}`); })
      .catch(() => {});
  }, [effectiveAvatarId, showcasesPort]);

  const [iconPath, setIconPath] = useState(null);
  useEffect(() => {
    if (!effectiveAvatarId || !showcasesPort || !icon) return;
    window.api?.ensureCharIcon?.('zzz', effectiveAvatarId, icon)
      .then(rel => { if (rel) setIconPath(`http://127.0.0.1:${showcasesPort}/${rel}`); })
      .catch(() => {});
  }, [effectiveAvatarId, showcasesPort, icon]);

  return (
    <div
      className={`zzz-card${rankClass}${showLive2d ? '' : ' zzz-card--png'}`}
      style={{
        ...(elemColor ? { '--zzz-elem-dark': elemColor } : null),
        ...(gameFont ? { fontFamily: gameFont } : null),
      }}
    >
      {/* Lowest layer — diamond texture + fade, below even the namecard bg. */}
      <div className="zzz-card__texture" />

      {/* Background — namecard image (shimmer unless M6). */}
      {bgPath && <div className="zzz-card__bg" style={{ backgroundImage: `url(${bgPath})` }} />}

      {/* Black right-edge strip; the CD is centred on its inner (left) edge. */}
      <div className="zzz-card__strip">
        <span className="zzz-card__strip-text">
          <span className="zzz-card__strip-zzz">ZZZ</span>
          <span className="zzz-card__strip-dot"> · </span>
          <span className="zzz-card__strip-zzz">ZZZ</span>
          <span className="zzz-card__strip-dot"> · </span>
          <span className="zzz-card__strip-zzz">ZZZ</span>
          <span className="zzz-card__strip-dot"> · </span>
          <span className="zzz-card__strip-zzz">ZZZ</span>
          <span className="zzz-card__strip-dot"> · </span>
          <span className="zzz-card__strip-zzz">ZZZ</span>
        </span>
      </div>

      {/* Spinning drive-disc CD at the right edge (behind the 6 disc rows). */}
      <ZzzDiscSpinner discs={artifacts} sets={artifactSets} />

      {/* Live2D — spans the FULL card, not just the left column, so the
          character can bleed rightward into the center column without ever
          being clipped. The camera's horizontal field of view widens to match
          the card's actual (non-square) shape; vertical framing is unchanged. */}
      {showLive2d && effectiveAvatarId && (
        <div className="zzz-card__live2d-clip">
          <SpineViewer
            game="zzz"
            characterId={effectiveAvatarId}
            className="zzz-card__live2d"
            cacheable={false}
            cameraConfig={{
              holeX: ZZZ_HOLE_X,
              fitTopFrac: ZZZ_FIT_TOP_FRAC,
              topSpanFrac: ZZZ_TOP_SPAN_FRAC,
            }}
          />
        </div>
      )}

      {/* ── LEFT: identity overlay (Live2D mode) or plain portrait (PNG mode) ── */}
      <div className="zzz-card__left">
        {showLive2d ? (
          <div className="zzz-card__screen-label">
            <div className="zzz-card__identity">
              {element && <ZzzElementIcon elementType={element} className="zzz-card__elem-icon" />}
              {professionIcon && <img className="zzz-card__prof-icon" src={professionIcon} alt={profession ?? ''} draggable={false} />}
              <span className="zzz-card__name">{name}</span>
            </div>
            <div className="zzz-card__sub">
              {RANK_LETTER[rarity] && <span className="zzz-card__rank">{RANK_LETTER[rarity]}</span>}
              <span className="zzz-card__level">Lv. {level}</span>
              <span className="zzz-card__mindscape">M{mindscape}</span>
            </div>
          </div>
        ) : (
          (iconPath || icon) && (
            <img
              className="zzz-card__portrait"
              src={iconPath ?? icon}
              alt={name}
              draggable={false}
            />
          )
        )}
      </div>

      {/* ── CENTER: W-Engine + stats + skills ── */}
      <div className="zzz-card__center">
        {weapon && (
          <div className="zzz-card__weng">
            {weapon.icon && <img className="zzz-card__weng-icon" src={weapon.icon} alt={weapon.name} draggable={false} />}
            <div className="zzz-card__weng-info">
              <span className="zzz-card__weng-name">{weapon.name}</span>
              <div className="zzz-card__weng-meta">
                {RANK_LETTER[weapon.rarity] && <span className="zzz-card__weng-rank">{RANK_LETTER[weapon.rarity]}</span>}
                <span className="zzz-card__sep">·</span>
                <span>OC {weapon.overclock}</span>
                <span className="zzz-card__sep">·</span>
                <span>Lv. {weapon.level}/{weapon.maxLevel}</span>
              </div>
              {weapon.subStat && (
                <span className="zzz-card__weng-sub">{weapon.subStat.short} {weapon.subStat.formatted}</span>
              )}
            </div>
          </div>
        )}

        {hasStats && (
          <div className="zzz-card__stats">
            <div className="zzz-card__stats-col">{leftStats.map(renderZzzStatRow)}</div>
            <div className="zzz-card__stats-col">{rightStats.map(renderZzzStatRow)}</div>
          </div>
        )}

        <div className="zzz-card__skills">
          {talents.map((t, i) => (
            <div key={i} className={`zzz-card__skill${t.boosted ? ' zzz-card__skill--boosted' : ''}`}>
              {t.icon && <img src={t.icon} alt="" draggable={false} />}
              <span className="zzz-card__skill-lv">{t.level}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: 6 drive discs ── */}
      <div className="zzz-card__right">
        {ZZZ_SLOT_ORDER.map(slot => (
          <ArtifactSlot key={slot} artifact={discBySlot[slot] ?? null} StatIcon={ZzzArtifactStatIcon} />
        ))}
        {artifactSets.length > 0 && (
          <div className="zzz-card__sets">
            {artifactSets.map(s => (
              <span key={s.name} className="zzz-card__set-tag">
                {s.count}× {s.name}
              </span>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
