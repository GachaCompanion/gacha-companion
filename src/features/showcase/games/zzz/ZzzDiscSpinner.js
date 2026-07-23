import React, { useEffect, useMemo, useRef, useState } from 'react';

// Big "CD" at the right edge: a circular window showing the character's drive-disc
// SET icons, slow-spinning CCW, with a periodic fast CCW burst that motion-blurs
// and crossfades to the next set. Sits behind the 6 disc rows.

const BURST_MS    = 800;   // duration of the fast spin
const INTERVAL_MS = 4500;  // time between bursts
const TURNS       = 3;     // full CCW rotations per burst

const ECHO_COUNT    = 6;    // trailing copies during the burst
const ECHO_STEP_DEG = 6;    // degrees each echo lags behind the one before it
const ECHO_OPACITY  = 0.35; // opacity of the first (closest) echo, fading out after

export default function ZzzDiscSpinner({ discs = [], sets = [] }) {
  // Distinct set icons the character runs. Icons live on the discs, names on `sets`.
  const cycle = useMemo(() => {
    const iconByName = {};
    for (const d of discs) {
      if (d.setName && d.icon && !iconByName[d.setName]) iconByName[d.setName] = d.icon;
    }
    let icons = sets.map(s => iconByName[s.name]).filter(Boolean);
    if (icons.length === 0) {
      const first = discs.find(d => d.icon);
      if (first) icons = [first.icon];
    }
    return icons;
  }, [discs, sets]);

  const [idx, setIdx]           = useState(0);
  const [spinning, setSpinning] = useState(false);
  const burstRef = useRef(null);
  const angleRef = useRef(0);

  useEffect(() => {
    if (cycle.length <= 1) return undefined;
    let settle;
    const id = setInterval(() => {
      setSpinning(true);
      angleRef.current -= 360 * TURNS;                          // several CCW turns
      if (burstRef.current) burstRef.current.style.transform = `rotate(${angleRef.current}deg)`;
      settle = setTimeout(() => {
        setIdx(i => (i + 1) % cycle.length);
        setSpinning(false);
      }, BURST_MS);
    }, INTERVAL_MS);
    return () => { clearInterval(id); clearTimeout(settle); };
  }, [cycle.length]);

  if (cycle.length === 0) return null;

  const cur = cycle[idx];
  const nxt = cycle[(idx + 1) % cycle.length];

  return (
    <>
    <div className="zzz-disc__backdrop" aria-hidden="true" />
    <div className="zzz-disc" aria-hidden="true">
      {/* Mild unsharp-mask: the source set icons are small game UI sprites with no
          larger variant, so this recovers perceived edge crispness without upscaling. */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="zzz-disc-sharpen" color-interpolation-filters="sRGB">
          {/* Blur first to smooth over the pixel-level blockiness, then sharpen
              the smoothed result so silhouette/edge contours stay crisp. */}
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="softened" />
          <feConvolveMatrix in="softened" order="3" preserveAlpha="true"
            kernelMatrix="-0.15 -0.5 -0.15  -0.5 3.6 -0.5  -0.15 -0.5 -0.15" />
        </filter>
      </svg>
      <div ref={burstRef} className={`zzz-disc__burst${spinning ? ' is-spinning' : ''}`}>
        <div className="zzz-disc__slow">
          {spinning && Array.from({ length: ECHO_COUNT }).map((_, i) => (
            <img
              key={`echo-${i}`}
              className="zzz-disc__echo"
              src={cur}
              alt=""
              draggable={false}
              style={{
                transform: `rotate(${(i + 1) * ECHO_STEP_DEG}deg)`,
                opacity: ECHO_OPACITY * (1 - i / ECHO_COUNT),
              }}
            />
          ))}
          <img className="zzz-disc__img" src={cur} alt="" draggable={false}
               style={{ opacity: spinning ? 0 : 1, transition: spinning ? 'opacity 0.4s ease 0.2s' : 'none' }} />
          <img className="zzz-disc__img" src={nxt} alt="" draggable={false}
               style={{ opacity: spinning ? 1 : 0, transition: spinning ? 'opacity 0.4s ease 0.2s' : 'none' }} />
        </div>
      </div>
    </div>
    </>
  );
}
