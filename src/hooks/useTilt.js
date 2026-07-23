import { useEffect, useRef, useCallback } from 'react';

export function useTilt({ maxTilt = 8, perspective = 1000, onApply, enabled = true } = {}) {
  const elRef        = useRef(null);
  const onApplyRef   = useRef(onApply);
  useEffect(() => { onApplyRef.current = onApply; }, [onApply]);
  const rafRef    = useRef(null);
  const curRef    = useRef({ x: 0, y: 0 });
  const targetRef = useRef({ x: 0, y: 0 });
  const activeRef = useRef(false);
  const enabledRef = useRef(enabled);

  const apply = useCallback((x, y) => {
    const el = elRef.current;
    if (!el) return;
    el.style.transform = `perspective(${perspective}px) rotateX(${(-y * maxTilt * 2).toFixed(3)}deg) rotateY(${(x * maxTilt * 2).toFixed(3)}deg)`;
    el.style.setProperty('--tilt-x', x.toFixed(4));
    el.style.setProperty('--tilt-y', y.toFixed(4));
    onApplyRef.current?.(x, y);
  }, [maxTilt, perspective]);

  const tick = useCallback(() => {
    const cur    = curRef.current;
    const target = targetRef.current;
    const LERP   = 0.10;
    cur.x += (target.x - cur.x) * LERP;
    cur.y += (target.y - cur.y) * LERP;
    apply(cur.x, cur.y);

    const stillMoving =
      Math.abs(target.x - cur.x) > 0.0005 ||
      Math.abs(target.y - cur.y) > 0.0005;

    if (activeRef.current || stillMoving) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      apply(target.x, target.y);
      rafRef.current = null;
    }
  }, [apply]);

  const startRAF = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  // Disable tilt (2D mode): ignore mouse input and ease the card back to flat.
  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      activeRef.current = false;
      targetRef.current = { x: 0, y: 0 };
      startRAF();
    }
  }, [enabled, startRAF]);

  const onMouseEnter = useCallback((e) => {
    if (!enabledRef.current) return;
    activeRef.current = true;
    startRAF();
  }, [startRAF]);

  const onMouseMove = useCallback((e) => {
    if (!enabledRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-zoom')) || 1;
    targetRef.current = {
      x: (e.clientX / zoom - rect.left) / rect.width  - 0.5,
      y: (e.clientY / zoom - rect.top)  / rect.height - 0.5,
    };
    // Activate here too, not only on mouseenter: when returning to a view the
    // cursor may already be over the card, so no enter event fires.
    activeRef.current = true;
    startRAF();
  }, [startRAF]);

  const onMouseLeave = useCallback(() => {
    activeRef.current = false;
    targetRef.current = { x: 0, y: 0 };
    startRAF();
  }, [startRAF]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  return { ref: elRef, onMouseEnter, onMouseMove, onMouseLeave };
}
