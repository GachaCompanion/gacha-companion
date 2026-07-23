import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Camera, LayoutDashboard } from 'lucide-react';
import TitleBar from '../shared/components/TitleBar';
import DiamondIcon from '../shared/components/DiamondIcon';
import splashLogo from '../assets/logo/logo_opening_screen.png';
import showcasesIcon from '../assets/icon/Showcases_Icon.png';
import gachaTrackerIcon from '../assets/icon/GachaTracker_Icon.png';
import overviewIcon from '../assets/icon/Overview_Icon.png';
import tileBgVideoOverview from '../assets/backgrounds/GachaCompanion_Homescreen_Button_Background_1.mp4';
import tileBgVideoAurora from '../assets/backgrounds/GachaCompanion_Homescreen_Button_Background_2.mp4';
import './HomePage.css';

// Same technique as the splash's loading-% text (see below) — CSS
// background-clip:text + color:transparent wasn't actually rendering the
// gradient in this app's environment, just a black smear. Real SVG fill/
// stroke/paint-order is reliable here, unlike that CSS hack.
function TileLabel({ text, gradientId, width = 198, height = 36, fontSize = 15, strokeWidth = 4, baselineOffset = 0.35 }) {
  // Sizes the white backing pill to this label's actual rendered text
  // bounds (via getBBox) rather than a hardcoded value — "SHOWCASES" and
  // "GACHA TRACKER" are very different lengths, and the text itself grows
  // ~18% on hover (HOVER_SCALE below, matching .homepage-tile-label-text's
  // own font-size multiplier in HomePage.css).
  //
  // The hover-size box is computed by scaling the rest-measured box, NOT by
  // re-measuring getBBox() after the fact — re-measuring on 'transitionend'
  // meant the box's own grow animation only STARTED once the text's animation
  // had already FINISHED, leaving the enlarged text without a backing box
  // for the whole 0.25s in between. Precomputing the target lets both the
  // text (via CSS) and the box (via the matching transition in HomePage.css)
  // animate toward their final sizes in parallel instead of sequentially.
  const HOVER_SCALE = 1.18;
  const textRef = useRef(null);
  const [bg, setBg] = useState(null);

  function boxFromBBox(box) {
    const padX = 5;
    const padTop = 2;
    const padBottom = 4;
    // getBBox() reserves descender space (for g/j/p/q/y) as part of the
    // font's own metrics even though this text is always .toUpperCase()
    // and has no actual descenders — that reserved space pads the BOTTOM
    // specifically, making it look uneven against an equal top pad.
    // Trimmed back out here, then padBottom is added on top of the
    // corrected (tight) edge.
    const descenderTrim = 2;
    const top    = box.y - padTop;
    const bottom = box.y + box.height - descenderTrim + padBottom;
    return { x: box.x - padX, y: top, width: box.width + padX * 2, height: bottom - top };
  }

  function scaleAroundCenter(b, scale) {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const width = b.width * scale;
    const height = b.height * scale;
    return { x: cx - width / 2, y: cy - height / 2, width, height };
  }

  // useLayoutEffect (not useEffect) — attaches the hover listeners
  // synchronously before the browser paints, so a mouseenter that happens
  // right after this component mounts (e.g. returning to the homescreen
  // and immediately hovering a tile) can never race ahead of them. With
  // useEffect, that race meant the CSS-driven text scale could kick in via
  // :hover before this state's mouseenter listener was attached, growing
  // the text without the matching white backing box.
  useLayoutEffect(() => {
    const el = textRef.current;
    const btn = el?.closest('button');
    if (!el || !btn) return;
    const restBg = boxFromBBox(el.getBBox());
    const hoverBg = scaleAroundCenter(restBg, HOVER_SCALE);
    setBg(restBg);
    function onEnter() { setBg(hoverBg); }
    function onLeave() { setBg(restBg); }
    btn.addEventListener('mouseenter', onEnter);
    btn.addEventListener('mouseleave', onLeave);
    return () => {
      btn.removeEventListener('mouseenter', onEnter);
      btn.removeEventListener('mouseleave', onLeave);
    };
  }, [text]); // eslint-disable-line

  return (
    <svg className="homepage-tile-label" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#D164BB" />
          <stop offset="50%" stopColor="#A764D6" />
          <stop offset="100%" stopColor="#643991" />
        </linearGradient>
      </defs>
      {bg && (
        <rect
          className="homepage-tile-label-bg"
          x={bg.x} y={bg.y} width={bg.width} height={bg.height}
          rx={8} ry={8}
          fill="#fff"
        />
      )}
      <text
        ref={textRef}
        className="homepage-tile-label-text"
        x={width / 2} y={height / 2 + fontSize * baselineOffset}
        textAnchor="middle"
        fontWeight="700"
        fill={`url(#${gradientId})`}
        stroke="none"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        paintOrder="stroke fill"
        style={{ fontFamily: 'var(--font-ui)', letterSpacing: '0.04em', '--label-font-size': `${fontSize}px` }}
      >
        {text.toUpperCase()}
      </text>
    </svg>
  );
}

// Same idea as the splash outline's own <rect rx ry stroke="url(#...)">  —
// SVG stroke follows rounded corners natively and precisely, unlike the CSS
// masked-pseudo-element ring this replaced (which needed a fiddly manual
// inset to sit flush with the tile's actual edge).
function TileRing({ gradientId, width = 198, height = 119, rx = 22.5, padX = 7, padY = padX, extraWidth = 0, extraHeight = 0, strokeWidth = 3 }) {
  // insetX/insetY reproduce the original hardcoded tile ring exactly when
  // extraWidth/extraHeight are 0 (pad - strokeWidth/2 centers the stroke
  // path strokeWidth/2 outside the button's own edge). extraWidth/Height
  // then grow the rect symmetrically past that same base position — the
  // canvas shifts by the same extraWidth/2 the rect does, so it cancels
  // out of insetX/insetY and only shows up in the rect's actual width.
  const insetX = padX - strokeWidth / 2;
  const insetY = padY - strokeWidth / 2;
  const rectW = width + strokeWidth + extraWidth;
  const rectH = height + strokeWidth + extraHeight;
  const shiftX = padX + extraWidth / 2;
  const shiftY = padY + extraHeight / 2;
  return (
    <svg
      className="homepage-tile-ring"
      viewBox={`0 0 ${width + extraWidth + padX * 2} ${height + extraHeight + padY * 2}`}
      style={{
        top: `-${shiftY}px`, left: `-${shiftX}px`,
        width: `calc(100% + ${shiftX * 2}px)`, height: `calc(100% + ${shiftY * 2}px)`,
      }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D164BB" />
          <stop offset="50%" stopColor="#A764D6" />
          <stop offset="100%" stopColor="#643991" />
        </linearGradient>
      </defs>
      <rect
        x={insetX} y={insetY} width={rectW} height={rectH} rx={rx} ry={rx}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={strokeWidth}
      />
    </svg>
  );
}

// How long the logo sits alone, before the loading outline starts fading in.
const SPLASH_HOLD_MS = 3000;
// After loading finishes: hold at 100% before starting the exit fade.
const SPLASH_DONE_HOLD_MS = 500;
// Home content starts fading in this far into the splash's own fade-out —
// a genuine crossfade, not a sequential hand-off.
const HOME_FADE_IN_DELAY_MS = 300;


export default function HomePage({
  appBgUrl,
  isReady,
  onBeforeEnterTracker,
  onEnterTracker,
  onBeforeEnterShowcase,
  onEnterShowcase,
  onBeforeEnterOverview,
  onEnterOverview,
  loadingProgress   = 0,
  loadingDone       = false,
  offlineError      = false,
  skipLoadingPhase  = false,
  onLoadingUnlock,
  onMenuVisible,
}) {
  const [btnVisible, setBtnVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [mountVisible, setMountVisible] = useState(false);

  // titlePhase drives the splash→home sequence:
  //   'splash'         — logo alone, centered, held for SPLASH_HOLD_MS
  //   'outline-in'     — outline fades in around the logo; loading NOT unlocked yet
  //   'splash-loading' — outline fully faded in, real tasks unlocked, fills with loadingProgress
  //   'home'           — title + Enter buttons fade in
  // The splash overlay's own fade-out is tracked separately (splashFading/
  // splashMounted below) — titlePhase reaches 'home' partway through that
  // fade so the two crossfade instead of handing off sequentially.
  const [titlePhase, setTitlePhase] = useState(
    skipLoadingPhase ? 'home' : 'splash'
  );
  const [splashFading, setSplashFading]   = useState(false);
  const [splashMounted, setSplashMounted] = useState(!skipLoadingPhase);

  // One animation frame after mount — lets CSS establish the opacity:0 baseline
  // before we add the visible classes, so transitions actually fire on return.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMountVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Hide the pre-React title in index.html — React now renders the title at the
  // same center position, so the swap is invisible.
  useEffect(() => {
    if (skipLoadingPhase) return;
    const el = document.getElementById('pre-title');
    if (el) el.style.opacity = '0';
  }, []); // eslint-disable-line

  // Hold the logo alone for a fixed duration, then start fading the outline in.
  // Loading is NOT unlocked yet — that only happens once the outline has fully
  // faded in (see the animationend handler on the outline below).
  useEffect(() => {
    if (skipLoadingPhase || titlePhase !== 'splash') return;
    const t = setTimeout(() => setTitlePhase('outline-in'), SPLASH_HOLD_MS);
    return () => clearTimeout(t);
  }, [skipLoadingPhase, titlePhase]); // eslint-disable-line

  // When loading completes → hold at 100%, then start the exit fade. Home
  // content begins fading in partway through that fade (crossfade), while
  // the splash keeps fading out on its own schedule regardless.
  useEffect(() => {
    if (!loadingDone || titlePhase !== 'splash-loading') return;
    const holdTimer = setTimeout(() => {
      setSplashFading(true);
      setTimeout(() => setTitlePhase('home'), HOME_FADE_IN_DELAY_MS);
    }, SPLASH_DONE_HOLD_MS);
    return () => clearTimeout(holdTimer);
  }, [loadingDone, titlePhase]); // eslint-disable-line

  // Show the button once the title has settled AND backgrounds are ready AND
  // the mount frame has passed (so opacity:0 baseline is painted first).
  useEffect(() => {
    if (!isReady) return;
    if (!mountVisible) return;
    if (!skipLoadingPhase && titlePhase !== 'home') return;
    setBtnVisible(true);
    onMenuVisible?.();
  }, [isReady, titlePhase, skipLoadingPhase, mountVisible]); // eslint-disable-line

  function handleEnter(destination) {
    if (!isReady || exiting) return;
    setExiting(true);
    if (destination === 'showcase') {
      setTimeout(() => onBeforeEnterShowcase?.(), 200);
      setTimeout(onEnterShowcase, 500);
    } else if (destination === 'overview') {
      setTimeout(() => onBeforeEnterOverview?.(), 200);
      setTimeout(onEnterOverview, 500);
    } else {
      setTimeout(() => onBeforeEnterTracker?.(), 200);
      setTimeout(onEnterTracker, 500);
    }
  }

  const hasBg           = !!appBgUrl;
  const isOutlineIn     = titlePhase === 'outline-in';
  const isSplashLoading = titlePhase === 'splash-loading';
  const showOutline     = titlePhase !== 'splash'; // outline-in / splash-loading / home-while-still-mounted
  const outlinePct      = Math.min(100, Math.max(0, loadingProgress));

  return (
    <div className={[
      'homepage',
      hasBg            ? 'homepage--has-bg'    : '',
      exiting          ? 'homepage--exiting'    : '',
      skipLoadingPhase ? 'homepage--returning'  : 'homepage--no-intro',
    ].filter(Boolean).join(' ')}>

      <TitleBar />

      {/* Splash: logo held alone, then the outline fades in, then it fills with real progress.
          Fades out on its own schedule (splashFading/splashMounted), independent of titlePhase,
          so it can keep fading while the home content underneath starts fading in early. */}
      {!skipLoadingPhase && splashMounted && (
        <div
          className={['homepage-splash', splashFading ? 'homepage-splash--exit' : ''].filter(Boolean).join(' ')}
          onTransitionEnd={() => { if (splashFading) setSplashMounted(false); }}
        >
          <div className="homepage-splash-frame">
            {showOutline && (
              <svg
                className="homepage-splash-outline"
                viewBox="0 0 348 348" width="348" height="348"
                onAnimationEnd={() => { if (isOutlineIn) { setTitlePhase('splash-loading'); onLoadingUnlock?.(); } }}
              >
                <defs>
                  <linearGradient id="splashOutlineGradient" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#52C7FA" />
                    <stop offset="50%" stopColor="#402BB6" />
                    <stop offset="100%" stopColor="#EE96B5" />
                  </linearGradient>
                </defs>
                <rect className="homepage-splash-outline-track" x="2" y="2" width="344" height="344" rx="44" ry="44" />
                <rect
                  className="homepage-splash-outline-fill"
                  x="2" y="2" width="344" height="344" rx="44" ry="44"
                  style={{ clipPath: `inset(${100 - outlinePct}% 0% 0% 0%)` }}
                />
              </svg>
            )}
            {/* Sits behind the image but in front of the loading bar — 1px
                sharper corner radius (43 vs the outline's 44) so it can't
                poke past the outline's own corner curve; straight edges land
                at the exact same inset position regardless of radius. */}
            <div className="homepage-splash-backing" />
            <img src={splashLogo} alt="" className="homepage-splash-logo" />
            {isSplashLoading && (
              // Real SVG text instead of CSS background-clip:text — that
              // technique (gradient fill via a transparent `color` +
              // background-clip) wasn't actually rendering the gradient at
              // all in this app's environment, just leaving a smear of
              // whatever black outline was layered on top of it. SVG fill/
              // stroke/paint-order are natively reliable for this.
              <svg className="homepage-splash-progress" width="120" height="40" viewBox="0 0 120 40">
                <defs>
                  <linearGradient id="splashProgressGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#52C7FA" />
                    <stop offset="50%" stopColor="#6F68DD" />
                    <stop offset="100%" stopColor="#EE96B5" />
                  </linearGradient>
                </defs>
                <text
                  x="60" y="29"
                  textAnchor="middle"
                  fontWeight="600"
                  fill="url(#splashProgressGradient)"
                  stroke="#000"
                  strokeWidth="5"
                  paintOrder="stroke fill"
                  style={{ fontFamily: 'var(--font-ui)', fontSize: '26px', filter: 'drop-shadow(4px 4px 1px rgba(0, 0, 0, 0.6))' }}
                >
                  {Math.round(outlinePct)}%
                </text>
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Content block */}
      <div className="homepage-content">

        {/* Title */}
        <h1 className={[
          'homepage-title',
          (skipLoadingPhase && mountVisible && !exiting) ? 'homepage-title--visible' : '',
          (titlePhase === 'home' && !skipLoadingPhase && !exiting)
                                               ? 'homepage-title--visible' : '',
          exiting                              ? 'homepage-title--exit'    : '',
        ].filter(Boolean).join(' ')}>
          Gacha Companion
        </h1>

        {/* Offline message */}
        {offlineError && !skipLoadingPhase && (
          <p className={`homepage-offline-msg${isSplashLoading ? ' homepage-offline-msg--visible' : ''}`}>
            No internet connection — Could not update
          </p>
        )}

        {/* Enter buttons */}
        <div className="homepage-btn-stack">
          <div className={[
            'homepage-btn-row',
            (btnVisible || (skipLoadingPhase && mountVisible && isReady)) ? 'homepage-btn-row--visible' : '',
            exiting ? 'homepage-btn-row--exit' : '',
          ].filter(Boolean).join(' ')}>
            <button
              className="homepage-tile"
              onClick={() => handleEnter('showcase')}
              disabled={!isReady || !btnVisible}
            >
              <div className="homepage-tile-clip">
                <video className="homepage-tile-bg" src={tileBgVideoAurora} autoPlay loop muted playsInline />
                <div className="homepage-tile-icon-float" style={{ animationDelay: '0s' }}>
                  <img src={showcasesIcon} alt="" className="homepage-tile-icon" />
                </div>
                <div className="homepage-tile-overlay" />
                <TileLabel text="Showcases" gradientId="tileLabelGradientShowcases" />
                <span className="homepage-tile-glyph"><Camera size={32} /></span>
              </div>
              <TileRing gradientId="tileRingGradientShowcases" />
            </button>
            <button
              className="homepage-tile"
              onClick={() => handleEnter('overview')}
              disabled={!isReady || !btnVisible}
            >
              <div className="homepage-tile-clip">
                <video className="homepage-tile-bg" src={tileBgVideoOverview} autoPlay loop muted playsInline />
                <div className="homepage-tile-icon-float" style={{ animationDelay: '-1.5s' }}>
                  <img src={overviewIcon} alt="" className="homepage-tile-icon" />
                </div>
                <div className="homepage-tile-overlay" />
                <TileLabel text="Overview" gradientId="tileLabelGradientOverviewTile" />
                <span className="homepage-tile-glyph"><LayoutDashboard size={32} /></span>
              </div>
              <TileRing gradientId="tileRingGradientOverviewTile" />
            </button>
            <button
              className="homepage-tile"
              onClick={() => handleEnter('tracker')}
              disabled={!isReady || !btnVisible}
            >
              <div className="homepage-tile-clip">
                <video className="homepage-tile-bg" src={tileBgVideoAurora} autoPlay loop muted playsInline />
                <div className="homepage-tile-icon-float" style={{ animationDelay: '-3s' }}>
                  <img src={gachaTrackerIcon} alt="" className="homepage-tile-icon homepage-tile-icon--tracker" />
                </div>
                <div className="homepage-tile-overlay" />
                <TileLabel text="Gacha Tracker" gradientId="tileLabelGradientTracker" />
                <span className="homepage-tile-glyph"><DiamondIcon size={32} /></span>
              </div>
              <TileRing gradientId="tileRingGradientTracker" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
