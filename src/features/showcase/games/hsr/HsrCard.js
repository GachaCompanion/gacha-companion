import React, { useRef, useState, useEffect } from 'react';
import './hsr.card.css';
import cardPattern from '../../../../assets/hsr/card-pattern.svg';
import ArtifactSlot from '../../components/CharacterCard/ArtifactSlot';
import HsrStatIcon from './HsrStatIcon';
import SpineViewer from '../../live2d/SpineViewer';
import { useTilt } from '../../../../hooks/useTilt';
import { useGameFont } from '../../../../hooks/useGameFont';
import { getHsrPngFraming } from './hsrPngFraming';

const HSR_SLOTS      = ['head', 'hands', 'body', 'feet', 'sphere', 'rope'];
const HSR_STAT_ORDER = ['hp', 'atk', 'def', 'spd', 'critRate', 'critDmg', 'be', 'ehr', 'eres', 'err', 'ohb', 'elemDmg', 'pathDmg'];

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function adjustHex(hex, factor) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.min(255,Math.round(r*factor))},${Math.min(255,Math.round(g*factor))},${Math.min(255,Math.round(b*factor))})`;
}

function hexPts(w, h) {
  return [[w*0.14,0],[w*0.86,0],[w,h*0.5],[w*0.86,h],[w*0.14,h],[0,h*0.5]];
}

function insetPts(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const prev = pts[(i-1+n)%n], next = pts[(i+1)%n];
    const e1 = [p[0]-prev[0], p[1]-prev[1]], l1 = Math.hypot(e1[0],e1[1]);
    const n1 = [-e1[1]/l1, e1[0]/l1];
    const e2 = [next[0]-p[0], next[1]-p[1]], l2 = Math.hypot(e2[0],e2[1]);
    const n2 = [-e2[1]/l2, e2[0]/l2];
    const bis = [n1[0]+n2[0], n1[1]+n2[1]], bisL = Math.hypot(bis[0],bis[1]);
    const bisN = [bis[0]/bisL, bis[1]/bisL];
    const dist = d / (n1[0]*bisN[0] + n1[1]*bisN[1]);
    return [p[0]+bisN[0]*dist, p[1]+bisN[1]*dist];
  });
}

function ptsStr(pts) {
  return pts.map(([x,y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function lerpHex(hex1, hex2, t, darken = 1) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return `rgb(${Math.round((r1+(r2-r1)*t)*darken)},${Math.round((g1+(g2-g1)*t)*darken)},${Math.round((b1+(b2-b1)*t)*darken)})`;
}

// Element border gradient: [topColor, bottomColor] — applied inverted to SVG gradient
const ELEM_BORDER = {
  Fire:      ['#ff5030', '#7a1508'],
  Ice:       ['#50c8ff', '#104080'],
  Thunder:   ['#b060ff', '#3010a0'],
  Wind:      ['#30d890', '#0a5030'],
  Quantum:   ['#6060e8', '#200880'],
  Imaginary: ['#e8c830', '#704010'],
  Physical:  ['#b0b0b0', '#404040'],
};

const R  = 20;
const B  = 9;
const Ri = R + B;                       // = 25 for ALL inner arcs (both corners and notches)
const T  = Math.sqrt(Ri * Ri - B * B); // ≈ 24.495 — where inner arc meets inset edge

function mkRedPath(w, h, dx) {
  // Outer: 4-corner CW rectangle. TR = left quarter of top notch, BR = left quarter of bottom notch.
  const outer = [
    `M ${dx} ${R}`,
    `A ${R} ${R} 0 0 1 ${dx-R} 0`,    // TR corner (left quarter of top notch, CW)
    `L ${R} 0`,
    `A ${R} ${R} 0 0 1 0 ${R}`,        // TL corner
    `L 0 ${h-R}`,
    `A ${R} ${R} 0 0 1 ${R} ${h}`,     // BL corner
    `L ${dx-R} ${h}`,
    `A ${R} ${R} 0 0 1 ${dx} ${h-R}`,  // BR corner (left quarter of bottom notch, CW)
    `L ${dx} ${R} Z`,
  ].join(' ');
  // Inner: same 4-corner shape, 5px inside. Right edge at x=dx-B.
  const inner = [
    `M ${dx-B} ${T}`,
    `A ${Ri} ${Ri} 0 0 1 ${dx-T} ${B}`,   // inner TR corner
    `L ${T} ${B}`,
    `A ${Ri} ${Ri} 0 0 1 ${B} ${T}`,      // inner TL corner
    `L ${B} ${h-T}`,
    `A ${Ri} ${Ri} 0 0 1 ${T} ${h-B}`,    // inner BL corner
    `L ${dx-T} ${h-B}`,
    `A ${Ri} ${Ri} 0 0 1 ${dx-B} ${h-T}`, // inner BR corner
    `L ${dx-B} ${T} Z`,
  ].join(' ');
  return `${outer} ${inner}`;
}

function mkRedOuter(w, h, dx) {
  return [
    `M ${dx} ${R}`,
    `A ${R} ${R} 0 0 1 ${dx-R} 0`,
    `L ${R} 0`,
    `A ${R} ${R} 0 0 1 0 ${R}`,
    `L 0 ${h-R}`,
    `A ${R} ${R} 0 0 1 ${R} ${h}`,
    `L ${dx-R} ${h}`,
    `A ${R} ${R} 0 0 1 ${dx} ${h-R}`,
  ].join(' ');
}

function mkGoldOuter(w, h, dx) {
  return [
    `M ${dx} ${R}`,
    `A ${R} ${R} 0 0 0 ${dx+R} 0`,
    `L ${w-R} 0`,
    `A ${R} ${R} 0 0 0 ${w} ${R}`,
    `L ${w} ${h-R}`,
    `A ${R} ${R} 0 0 0 ${w-R} ${h}`,
    `L ${dx+R} ${h}`,
    `A ${R} ${R} 0 0 0 ${dx} ${h-R}`,
  ].join(' ');
}

function mkInnerStroke(w, h, dx) {
  // Two disconnected inner perimeters (red section + gold section).
  const red = [
    `M ${dx-B} ${T}`,
    `A ${Ri} ${Ri} 0 0 1 ${dx-T} ${B}`,
    `L ${T} ${B}`,
    `A ${Ri} ${Ri} 0 0 1 ${B} ${T}`,
    `L ${B} ${h-T}`,
    `A ${Ri} ${Ri} 0 0 1 ${T} ${h-B}`,
    `L ${dx-T} ${h-B}`,
    `A ${Ri} ${Ri} 0 0 1 ${dx-B} ${h-T}`,
    `Z`,
  ].join(' ');
  const gold = [
    `M ${dx+T} ${B}`,
    `L ${w-T} ${B}`,
    `A ${Ri} ${Ri} 0 0 0 ${w-B} ${T}`,
    `L ${w-B} ${h-T}`,
    `A ${Ri} ${Ri} 0 0 0 ${w-T} ${h-B}`,
    `L ${dx+T} ${h-B}`,
    `A ${Ri} ${Ri} 0 0 0 ${dx+B} ${h-T}`,
    `L ${dx+B} ${T}`,
    `A ${Ri} ${Ri} 0 0 0 ${dx+T} ${B}`,
    `Z`,
  ].join(' ');
  return `${red} ${gold}`;
}

function mkGoldPath(w, h, dx) {
  // Outer: 4-corner CCW rectangle. TL = right quarter of top notch, BL = right quarter of bottom notch.
  const outer = [
    `M ${dx} ${R}`,
    `A ${R} ${R} 0 0 0 ${dx+R} 0`,    // TL corner (right quarter of top notch, CCW)
    `L ${w-R} 0`,
    `A ${R} ${R} 0 0 0 ${w} ${R}`,    // TR corner
    `L ${w} ${h-R}`,
    `A ${R} ${R} 0 0 0 ${w-R} ${h}`,  // BR corner
    `L ${dx+R} ${h}`,
    `A ${R} ${R} 0 0 0 ${dx} ${h-R}`, // BL corner (right quarter of bottom notch, CCW)
    `L ${dx} ${R} Z`,
  ].join(' ');
  // Inner: same 4-corner shape, 5px inside. Left edge at x=dx+B.
  const inner = [
    `M ${dx+T} ${B}`,
    `L ${w-T} ${B}`,
    `A ${Ri} ${Ri} 0 0 0 ${w-B} ${T}`,    // inner TR corner
    `L ${w-B} ${h-T}`,
    `A ${Ri} ${Ri} 0 0 0 ${w-T} ${h-B}`,  // inner BR corner
    `L ${dx+T} ${h-B}`,
    `A ${Ri} ${Ri} 0 0 0 ${dx+B} ${h-T}`, // inner BL corner
    `L ${dx+B} ${T}`,
    `A ${Ri} ${Ri} 0 0 0 ${dx+T} ${B}`,   // inner TL corner
    `Z`,
  ].join(' ');
  return `${outer} ${inner}`;
}

export default function HsrCard({ build, cardMode = 'live2d', cacheable = true, dimension = '3d' }) {
  const showLive2d = cardMode !== 'png';
  const tiltEnabled = dimension !== '2d';
  const gameFont = useGameFont('hsr');
  const {
    avatarId,
    name, level, maxLevel, rarity, eidolon,
    element, path, icon, traces, talents, constIcons,
    weapon, stats, artifacts,
  } = build;

  const cardRef     = useRef(null);
  const leftRef     = useRef(null);
  const hexRef = useRef(null);
  const [cardSize,    setCardSize]    = useState({ w: 0, h: 0, divX: 0 });
  const [hexSize,     setHexSize]     = useState({ w: 0, h: 0 });

  const { ref: tiltRef, onMouseEnter, onMouseMove, onMouseLeave } = useTilt({
    maxTilt: 3,
    perspective: 1000,
    enabled: tiltEnabled,
  });
  useEffect(() => {
    const cardEl = cardRef.current;
    const leftEl = leftRef.current;
    if (!cardEl || !leftEl) return;
    const ro = new ResizeObserver((entries) => {
      setCardSize(prev => {
        let next = prev;
        for (const entry of entries) {
          if (entry.target === cardEl) next = { ...next, w: entry.contentRect.width, h: entry.contentRect.height };
          if (entry.target === leftEl) next = { ...next, divX: entry.contentRect.width };
        }
        return next;
      });
    });
    ro.observe(cardEl);
    ro.observe(leftEl);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = hexRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const bs = entry.borderBoxSize?.[0];
      setHexSize(bs
        ? { w: bs.inlineSize, h: bs.blockSize }
        : { w: entry.contentRect.width, h: entry.contentRect.height }
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);


  // Local portrait — downloaded from nanoka, cropped, and cached by the main
  // process (electron/charImages.js), same pattern as ZzzCard.js's bgPath/
  // iconPath. Falls back to the raw enka `icon` URL while it resolves (or
  // offline), so PNG mode never shows nothing.
  const [showcasesPort, setShowcasesPort] = useState(null);
  useEffect(() => {
    window.api?.getShowcasesServerPort?.().then(setShowcasesPort).catch(() => {});
  }, []);

  // Cleared to null on every character switch — without this, switching
  // characters could briefly keep showing the PREVIOUS character's image
  // (stale state) with the NEW character's face-framing coordinates applied
  // to it, which is exactly the kind of mismatch this is meant to avoid.
  const [imgPath, setImgPath] = useState(null);
  useEffect(() => {
    setImgPath(null);
    if (!avatarId || !showcasesPort) return;
    window.api?.ensureCharImage?.('hsr', avatarId)
      .then(rel => { if (rel) setImgPath(`http://127.0.0.1:${showcasesPort}/${rel}`); else setImgPath(icon ?? null); })
      .catch(() => setImgPath(icon ?? null));
  }, [avatarId, showcasesPort, icon]);

  // GitHub-precomputed PNG face-detection framing (see electron/framingSync.js)
  // — never computed locally. Read synchronously from the cache loaded once
  // during the loading screen (hsrPngFraming.js), so the portrait's first
  // render already has the right position instead of popping to it a render
  // later after a per-card IPC round-trip. null if this character has no
  // entry yet, in which case the CSS default (50%/50%, geometric center) applies.
  const pngFraming = getHsrPngFraming(avatarId);

  // Light cone art — same caching approach, reusing ensureCharIcon (it already
  // takes an explicit URL rather than building one internally like
  // ensureCharImage) under a 'hsr-lc' namespace so light cone IDs never collide
  // with character avatarIds in the local cache.
  const [lcPath, setLcPath] = useState(null);
  useEffect(() => {
    if (!weapon?.itemId || !weapon?.artUrl || !showcasesPort) return;
    window.api?.ensureCharIcon?.('hsr-lc', weapon.itemId, weapon.artUrl)
      .then(rel => { if (rel) setLcPath(`http://127.0.0.1:${showcasesPort}/${rel}`); })
      .catch(() => {});
  }, [weapon?.itemId, weapon?.artUrl, showcasesPort]);

  const elementIconUrl = element ? `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/element/${element}.png` : null;
  const pathIconUrl    = path    ? `https://sr.yatta.moe/hsr/assets/UI/profession/IconProfession${path}Small.png` : null;

  const svgId = name.replace(/[^a-zA-Z0-9]/g, '');

  const hasStats = stats && Object.keys(stats).length > 0;
  const displayStats = hasStats
    ? HSR_STAT_ORDER.map(k => stats[k] ? { ...stats[k], key: k } : null).filter(Boolean)
    : [];

  // Stat rows extracted so they can be rendered twice: once as a blackened,
  // transform-driven shadow clone behind, once as the real text.
  const statRows = displayStats.map(stat => (
    <div key={stat.key} className="hsr-card__stat-row">
      <span className="hsr-card__stat-label">
        <HsrStatIcon statKey={stat.key} element={element} path={path} className="hsr-card__stat-icon" />
        {stat.label}
      </span>
      <span className="hsr-card__stat-value">{stat.formatted}</span>
    </div>
  ));

  // Light-cone text extracted so it can be rendered twice (shadow clone + real).
  const lcInfo = weapon ? (
    <>
      <span className="hsr-lc__name">{weapon.name}</span>
      <div className="hsr-lc__meta">
        <span className={`hsr-lc__stars hsr-lc__stars--r${weapon.rarity}`}>{'★'.repeat(weapon.rarity)}</span>
        <span className="hsr-lc__sep">·</span>
        <span className="hsr-lc__rank">S{weapon.superimposition}</span>
        <span className="hsr-lc__sep">·</span>
        <span className="hsr-lc__level">Lv. {weapon.level}/{weapon.maxLevel}</span>
      </div>
      <div className="hsr-lc__stats">
        {weapon.baseHp  > 0 && <span className="hsr-lc__stat">HP {Math.round(weapon.baseHp)}</span>}
        {weapon.baseAtk > 0 && <span className="hsr-lc__stat">ATK {Math.round(weapon.baseAtk)}</span>}
        {weapon.baseDef > 0 && <span className="hsr-lc__stat">DEF {Math.round(weapon.baseDef)}</span>}
      </div>
    </>
  ) : null;

  const artifactBySlot = {};
  for (const art of artifacts) artifactBySlot[art.slot] = art;

  // Dominant set per relic group: cavity (first 4) and planar (last 2).
  function groupSet(slots) {
    const counts = {};
    for (const s of slots) {
      const n = artifactBySlot[s]?.setName;
      if (n) counts[n] = (counts[n] ?? 0) + 1;
    }
    const [top] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return top && top[1] >= 2 ? { name: top[0], count: top[1] } : null;
  }
  const cavitySet = groupSet(['head', 'hands', 'body', 'feet']);
  const planarSet = groupSet(['sphere', 'rope']);

  const rarityClass  = rarity === 5 ? ' hsr-card--r5' : ' hsr-card--r4';
  const elementClass = element ? ` hsr-card--elem-${element.toLowerCase()}` : '';

  // Element gradient like the identity hexagon (lighter top, darker bottom),
  // 50% darker overall — used behind the portrait.
  const [bgElTop, bgElBot] = ELEM_BORDER[element] ?? ELEM_BORDER.Physical;
  const leftBgGrad = `linear-gradient(${adjustHex(bgElTop, 0.8 * 0.5)}, ${adjustHex(bgElBot, 0.5 * 0.5)})`;

  return (
    <div
      className="hsr-card__tilt-wrapper"
      ref={tiltRef}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
    <div className={`hsr-card${rarityClass}${elementClass}`} ref={cardRef} style={gameFont ? { fontFamily: gameFont } : undefined}>

      {/* Left column — portrait + identity hex */}
      <div className="hsr-card__left" ref={leftRef}>
        <div className="hsr-card__left-inner">
          <div className="hsr-card__left-bg" style={{ background: leftBgGrad }} />
          {imgPath && !showLive2d && (
            <img
              className="hsr-card__portrait"
              src={imgPath}
              alt={name}
              draggable={false}
              style={pngFraming ? {
                '--face-x': `${(pngFraming.cxFrac * 100).toFixed(2)}%`,
                '--face-y': `${(pngFraming.cyFrac * 100).toFixed(2)}%`,
              } : undefined}
            />
          )}
          {showLive2d && (
            <SpineViewer game="hsr" characterId={avatarId} className="hsr-card__live2d" cacheable={false} />
          )}
        </div>
        {(() => {
          const [el, ed] = ELEM_BORDER[element] ?? ELEM_BORDER.Physical;
          const gradTop   = adjustHex(el, 0.8);
          const gradBot   = adjustHex(ed, 0.5);
          const ringColor = adjustHex(el, 2.0);
          const pts  = hexSize.w > 0 ? hexPts(hexSize.w, hexSize.h) : null;
          const ring = pts ? insetPts(pts, 4) : null;
          return (
            <div className="hsr-card__identity-hex-wrap">
            <div ref={hexRef} className="hsr-card__identity-hex">
              {pts && (
                <svg
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id={`${svgId}-hex-grad`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={gradTop} />
                      <stop offset="100%" stopColor={gradBot} />
                    </linearGradient>
                  </defs>
                  <polygon points={ptsStr(pts)}  fill={`url(#${svgId}-hex-grad)`} />
                  <polygon points={ptsStr(ring)} fill="none" stroke={ringColor} strokeWidth="2" />
                </svg>
              )}
              <div className="hsr-card__identity-hex-content">
                <div className="hsr-card__identity-hex-nameline">
                  {elementIconUrl && <img className="hsr-card__elem-icon" src={elementIconUrl} alt={element ?? ''} draggable={false} />}
                  {pathIconUrl    && <img className="hsr-card__path-icon" src={pathIconUrl}    alt={path ?? ''}    draggable={false} />}
                  <span className="hsr-card__name">{name}</span>
                </div>
                <div className="hsr-card__identity-sub">
                  {rarity >= 4 && (
                    <span className={`hsr-card__stars hsr-card__stars--r${rarity}`}>{'★'.repeat(rarity)}</span>
                  )}
                  <span className="hsr-card__level">Lv. {level}/{maxLevel ?? '—'}</span>
                </div>
              </div>
            </div>
            </div>
          );
        })()}
      </div>

      {/* ── Glass overlay (full card) ── */}
      <div className="hsr-card__glass" />

      {/* ── Background pattern (gold section) ── */}
      <div className="hsr-card__gold-inner">
        <img className="hsr-card__pattern" src={cardPattern} alt="" draggable={false} />
        <div className="hsr-card__gold-overlay" />
      </div>

      {/* ── Eidolons — absolutely positioned along divider holes 2–7 ── */}
      <div className="hsr-card__eidolons">
        {constIcons.map((c, i) => (
          <div
            key={i}
            className={`hsr-card__eidolon${c.unlocked ? ' hsr-card__eidolon--unlocked' : ' hsr-card__eidolon--locked'}`}
          >
            {c.icon && <img src={c.icon} alt="" draggable={false} />}
          </div>
        ))}
      </div>

      {/* ── Eidolon divider ── */}
      <div className="hsr-card__eidolon-divider" />

      {/* ── CENTER-LEFT: traces + light cone ── */}
      <div className="hsr-card__cl">

        <div className="hsr-card__traces">
          {traces.map((trace, i) => (
            <div key={i} className="hsr-trace-row">
              <div className="hsr-trace-row__skill-wrap">
                <div className={`hsr-trace-row__skill${trace.boosted ? ' hsr-trace-row__skill--boosted' : ''}`}>
                  {trace.icon && <img src={trace.icon} alt="" draggable={false} />}
                </div>
                <span className="hsr-trace-row__level">{trace.level}</span>
              </div>
              {trace.nodes.map((node, j) => (
                <React.Fragment key={j}>
                  <div className="hsr-trace-row__line" />
                  <div className={[
                    node.isAbility ? 'hsr-trace-row__node--ability' : 'hsr-trace-row__node--stat',
                    node.unlocked ? 'hsr-trace-row__node--unlocked' : 'hsr-trace-row__node--locked',
                  ].join(' ')}>
                    {node.icon && <img src={node.icon} alt="" draggable={false} />}
                  </div>
                </React.Fragment>
              ))}
            </div>
          ))}
          {talents.some(t => t.isSummon) && (
            <div className="hsr-trace-row hsr-trace-row--summon">
              {talents.filter(t => t.isSummon).map((t, i) => (
                <div key={i} className="hsr-trace-row__skill-wrap">
                  <div className={`hsr-trace-row__skill${t.boosted ? ' hsr-trace-row__skill--boosted' : ''}`}>
                    {t.icon && <img src={t.icon} alt="" draggable={false} />}
                  </div>
                  <span className="hsr-trace-row__level">{t.level}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {weapon && (
          <div className="hsr-lc">
            {(lcPath || weapon.icon) && (
              <div className="hsr-lc__icon-wrap">
                <img className="hsr-lc__icon-shadow" src={lcPath ?? weapon.icon} alt="" aria-hidden="true" draggable={false} />
                <img className="hsr-lc__icon" src={lcPath ?? weapon.icon} alt={weapon.name} draggable={false} />
              </div>
            )}
            <div className="hsr-lc__info">
              <div className="hsr-lc__info-shadow" aria-hidden="true">{lcInfo}</div>
              {lcInfo}
            </div>
          </div>
        )}

      </div>

      {/* ── CENTER-RIGHT: stats ── */}
      <div className="hsr-card__cr">
        <div className="hsr-card__cr-shadow" aria-hidden="true">{statRows}</div>
        {statRows}
      </div>

      {/* ── RIGHT: relics (single column: 4 cavity + gap + 2 planar) + set names ── */}
      <div className="hsr-card__right">
        <div className="hsr-card__relics">
          {HSR_SLOTS.map((slot, i) => (
            <React.Fragment key={slot}>
              <ArtifactSlot
                artifact={artifactBySlot[slot] ?? null}
                StatIcon={HsrStatIcon}
              />
              {i === 3 && cavitySet && (
                <span className="hsr-card__set-tag">
                  <span className="hsr-card__set-tag-shadow" aria-hidden="true">{cavitySet.count}× {cavitySet.name}</span>
                  {cavitySet.count}× {cavitySet.name}
                </span>
              )}
              {i === 5 && planarSet && (
                <span className="hsr-card__set-tag">
                  <span className="hsr-card__set-tag-shadow" aria-hidden="true">{planarSet.count}× {planarSet.name}</span>
                  {planarSet.count}× {planarSet.name}
                </span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

{cardSize.w > 0 && cardSize.h > 0 && (() => {
        const redPath    = mkRedPath(cardSize.w, cardSize.h, cardSize.divX);
        const goldPath   = mkGoldPath(cardSize.w, cardSize.h, cardSize.divX);
        const redOuter   = mkRedOuter(cardSize.w, cardSize.h, cardSize.divX);
        const goldOuter  = mkGoldOuter(cardSize.w, cardSize.h, cardSize.divX);
        const innerStroke = mkInnerStroke(cardSize.w, cardSize.h, cardSize.divX);
        return (
        <svg className="hsr-card__svg-outline" aria-hidden="true">
          <defs>
            <linearGradient id={`${svgId}-red`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={cardSize.h}>
              <stop offset="0%"   stopColor={(ELEM_BORDER[element] ?? ELEM_BORDER.Fire)[0]} />
              <stop offset="100%" stopColor={(ELEM_BORDER[element] ?? ELEM_BORDER.Fire)[1]} />
            </linearGradient>
            <linearGradient id={`${svgId}-gold`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={cardSize.h}>
              <stop offset="0%" stopColor="#e8c860" />
              <stop offset="100%" stopColor="#8c5510" />
            </linearGradient>
            <linearGradient id={`${svgId}-highlight-red`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={cardSize.h}>
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id={`${svgId}-highlight-gold`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={cardSize.h}>
              <stop offset="0%"   stopColor="#ffffff" stopOpacity="0.50" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id={`${svgId}-shadow`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={cardSize.h}>
              <stop offset="0%"   stopColor="#000000" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.15" />
            </linearGradient>
            <radialGradient id={`${svgId}-hole-ring`} cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#000000" stopOpacity="0.00" />
              <stop offset="60%"  stopColor="#000000" stopOpacity="0.60" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0.00" />
            </radialGradient>
            {/* Straight mask: full border donut minus corner boxes — used by 4px straight highlight */}
            <mask id={`${svgId}-straight-mask`} maskUnits="userSpaceOnUse">
              <path d={`${redPath} ${goldPath}`} fill="white" fillRule="evenodd" />
              <rect x={0}                    y={0}                    width={R+4}   height={R+4}   fill="black" />
              <rect x={cardSize.w-R-4}       y={0}                    width={R+4}   height={R+4}   fill="black" />
              <rect x={0}                    y={cardSize.h-R-4}        width={R+4}   height={R+4}   fill="black" />
              <rect x={cardSize.w-R-4}       y={cardSize.h-R-4}        width={R+4}   height={R+4}   fill="black" />
              <rect x={cardSize.divX-R-4}    y={0}                    width={R*2+8} height={R+4}   fill="black" />
              <rect x={cardSize.divX-R-4}    y={cardSize.h-R-4}        width={R*2+8} height={R+4}   fill="black" />
            </mask>
            {/* Arc corners clip — used by 7px arc highlight */}
            <clipPath id={`${svgId}-arc-corners`}>
              <rect x={0}                    y={0}                    width={R+4}   height={R+4}   />
              <rect x={cardSize.w-R-4}       y={0}                    width={R+4}   height={R+4}   />
              <rect x={0}                    y={cardSize.h-R-4}        width={R+4}   height={R+4}   />
              <rect x={cardSize.w-R-4}       y={cardSize.h-R-4}        width={R+4}   height={R+4}   />
              <rect x={cardSize.divX-R-4}    y={0}                    width={R*2+8} height={R+4}   />
              <rect x={cardSize.divX-R-4}    y={cardSize.h-R-4}        width={R*2+8} height={R+4}   />
            </clipPath>
            {[1/9,2/9,3/9,4/9,5/9,6/9,7/9,8/9].map((f, i) => {
              const [top, bot] = ELEM_BORDER[element] ?? ELEM_BORDER.Fire;
              return (
                <linearGradient key={i} id={`${svgId}-hole-${i}`} x1="0%" y1="50%" x2="100%" y2="50%">
                  <stop offset="50%"  stopColor={lerpHex(top, bot, f, 0.8)} stopOpacity="1" />
                  <stop offset="50%"  stopColor={lerpHex('#e8c860', '#8c5510', f, 0.8)} stopOpacity="1" />
                </linearGradient>
              );
            })}
            <clipPath id={`${svgId}-border-clip`}>
              <path d={redPath}  fillRule="evenodd" clipRule="evenodd" />
              <path d={goldPath} fillRule="evenodd" clipRule="evenodd" />
            </clipPath>
          </defs>
          <path d={redPath}  fill={`url(#${svgId}-red)`}  fillRule="evenodd" />
          <path d={goldPath} fill={`url(#${svgId}-gold)`} fillRule="evenodd" />
          <path d={redOuter}  fill="none" stroke={`url(#${svgId}-highlight-red)`}  strokeWidth="4" mask={`url(#${svgId}-straight-mask)`} />
          <path d={goldOuter} fill="none" stroke={`url(#${svgId}-highlight-gold)`} strokeWidth="4" mask={`url(#${svgId}-straight-mask)`} />
          <g clipPath={`url(#${svgId}-border-clip)`}>
            <path d={redOuter}  fill="none" stroke={`url(#${svgId}-highlight-red)`}  strokeWidth="7" clipPath={`url(#${svgId}-arc-corners)`} />
            <path d={goldOuter} fill="none" stroke={`url(#${svgId}-highlight-gold)`} strokeWidth="7" clipPath={`url(#${svgId}-arc-corners)`} />
          </g>
          <path d={innerStroke} fill="none" stroke={`url(#${svgId}-shadow)`} strokeWidth="4" clipPath={`url(#${svgId}-border-clip)`} />
          <g>
            {[1/9, 2/9, 3/9, 4/9, 5/9, 6/9, 7/9, 8/9].map((f, i) => (
              <React.Fragment key={i}>
                <circle cx={cardSize.divX} cy={cardSize.h * f} r={8} fill={`url(#${svgId}-hole-${i})`} />
                <circle cx={cardSize.divX} cy={cardSize.h * f} r={8} fill={`url(#${svgId}-hole-ring)`} />
              </React.Fragment>
            ))}
          </g>
        </svg>
        );
      })()}

    </div>

    </div>
  );
}
