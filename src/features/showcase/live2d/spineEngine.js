// Persistent Spine (Live2D) engine for the showcase.
//
// One long-lived WebGL context + one <canvas>, reused across every character.
// Previously each SpineViewer mount created its own context, re-fetched the
// assets over HTTP, re-decoded the webp pages and re-uploaded them to the GPU,
// then tore it all down on unmount — so every character switch and every
// PNG↔Live2D toggle paid the full cost. Here the canvas is "adopted" by whichever
// card is showing, and loaded characters are kept in an LRU so re-viewing one is
// instant.
//
// Cache policy: API-fetched characters are cached (LRU, CACHE_CAP). Saved builds
// pass cacheable:false — they load on view and dispose on leave, as before.

import {
  ManagedWebGLRenderingContext, SceneRenderer, AssetManager,
  AtlasAttachmentLoader, SkeletonBinary, Skeleton,
  AnimationState, AnimationStateData, Vector2,
  TextureFilter, TextureWrap,
} from '@esotericsoftware/spine-webgl';

const PREMULTIPLIED_ALPHA = false;   // HSR/ZZZ exports are non-premultiplied
const CACHE_CAP = 12;                // max API-fetched characters kept resident

// Global presentation transform (same for every character). ZOOM crops in;
// MOVE_UP shifts the subject up by a fraction of its size.
const ZOOM = 2.5;
// MOVE_UP shifts the subject up by a fraction of the VIEWPORT. Since the viewport
// is now face-based (see FACE_SPAN), this shift scales with the face, not the whole
// Live2D — so it's consistent across characters. Higher = more upward shift.
const MOVE_UP = 0.20;
// For detected faces, the viewport is FACE_SPAN face-heights tall, so every
// character's face is the same on-screen size (~1/FACE_SPAN of the frame)
// regardless of their Live2D's overall scale. Higher = smaller face. Tunable.
const FACE_SPAN = 8;

let canvas = null, gl = null, context = null, renderer = null;
let active = null;                   // currently-drawn entry
let raf = 0, running = false, lastTime = 0;
const cache = new Map();             // key -> entry (insertion order = LRU)

function init() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  context = new ManagedWebGLRenderingContext(gl);
  renderer = new SceneRenderer(canvas, context);
}

function pickAnimation(skeletonData) {
  const names = skeletonData.animations.map((a) => a.name);
  return names.find((n) => /idle|standby|talk|loop|大招/i.test(n)) ?? names[0] ?? null;
}

// Bounds-center fallback when a character has no precomputed framing.
function measureBounds(built) {
  const off = new Vector2(), size = new Vector2();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { skeleton } of built) {
    skeleton.setToSetupPose();
    skeleton.updateWorldTransform();
    skeleton.getBounds(off, size, []);
    minX = Math.min(minX, off.x); minY = Math.min(minY, off.y);
    maxX = Math.max(maxX, off.x + size.x); maxY = Math.max(maxY, off.y + size.y);
  }
  if (!isFinite(minX)) return null;
  const w = maxX - minX, h = maxY - minY;
  return { cx: minX + w / 2, cy: minY + h / 2, max: Math.max(w, h) };
}

// Load + build a character's skeletons. Returns an entry { key, am, built, frame }.
async function loadEntry(key, baseUrl, skeletons, framing) {
  const am = new AssetManager(context, baseUrl);
  for (const { skel, atlas } of skeletons) {
    am.loadBinary(skel);
    am.loadTextureAtlas(atlas);
  }
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (am.isLoadingComplete()) {
        am.hasErrors() ? reject(new Error(JSON.stringify(am.getErrors()))) : resolve();
      } else {
        requestAnimationFrame(tick);
      }
    };
    tick();
  });

  const built = [];
  for (const { skel, atlas } of skeletons) {
    const atlasObj = am.require(atlas);
    // Force NPOT-safe texture params. Some HSR atlases declare MipMap filters,
    // but WebGL can't build mipmaps for non-power-of-two pages — the texture stays
    // incomplete and renders blank (e.g. Anaxa 1405). Linear + ClampToEdge is valid
    // for any size; mipmaps add nothing at card zoom.
    for (const page of atlasObj.pages) {
      page.texture.setFilters(TextureFilter.Linear, TextureFilter.Linear);
      page.texture.setWraps(TextureWrap.ClampToEdge, TextureWrap.ClampToEdge);
    }
    const data = new SkeletonBinary(new AtlasAttachmentLoader(atlasObj)).readSkeletonData(am.require(skel));
    const skeleton = new Skeleton(data);
    const state = new AnimationState(new AnimationStateData(data));
    const anim = pickAnimation(data);
    if (anim) state.setAnimation(0, anim, true);
    built.push({ skeleton, state });
  }
  return { key, am, built, frame: framing ?? measureBounds(built) };
}

function disposeEntry(entry) {
  try { entry.am.dispose(); } catch { /* ignore */ }
}

function applyCamera() {
  if (!active?.frame) return;
  const f = active.frame;
  const cfg = active.cameraConfig ?? {};
  // holeX: fraction of the canvas (0–1, top-left origin) where the character's
  // horizontal center should land. Default 0.5 = canvas center.
  const holeX = cfg.holeX ?? 0.5;
  // The canvas can be non-square (e.g. ZZZ's spans the full card, not a
  // square column) — widen the horizontal field of view to match its actual
  // rendered shape rather than assuming square. For a square canvas (HSR)
  // this is exactly 1, so viewportWidth === viewportHeight, unchanged.
  const aspect = (canvas.clientWidth && canvas.clientHeight) ? canvas.clientWidth / canvas.clientHeight : 1;

  let view, camY;
  if (cfg.fitTopFrac != null && f.topY != null) {
    // Top-anchored fit (ZZZ): anchor the model's topmost world Y (head/hair,
    // whatever is highest — no face-detection needed, so this works the same
    // for human and non-human characters) at a fixed screen position, then
    // zoom to a fixed fraction of the model's total height. This deliberately
    // does NOT try to reach the character's true bottom — ZZZ Live2D rigs are
    // built for the game's own bust-up UI card, so legs/feet are frequently
    // incomplete or missing entirely. Zooming to show only head+torso means
    // whatever's below simply falls outside the frame instead of the fit
    // trying (and failing) to land on an unreliable "bottom".
    const { fitTopFrac: topFrac, topSpanFrac = 0.55 } = cfg;
    view = f.max * topSpanFrac;
    camY = f.topY - (0.5 - topFrac) * view;
  } else {
    const faceSpan = cfg.faceSpan ?? FACE_SPAN;
    // holeY: fraction of the canvas where the face center should land.
    // Default 0.5 = canvas center (used by HSR).
    const holeY = cfg.holeY ?? 0.5;
    // Detected faces zoom to a uniform size (faceSpan face-heights tall);
    // fallback (no detected face) uses the old bounds-based zoom.
    view = f.faceH ? f.faceH * faceSpan : (f.max * 1.05) / ZOOM;
    // Center-over-center: shift camera so face world-coord maps to hole screen-coord.
    // Spine Y is up, screen Y is down — so (holeY - 0.5) flips correctly.
    // MOVE_UP then nudges the subject up by a fraction of this face-based
    // viewport, so the shift reads the same across every character regardless
    // of their Live2D's overall scale.
    camY = f.cy + (holeY - 0.5 - MOVE_UP) * view;
  }

  const viewportWidth = view * aspect;
  renderer.camera.position.x = f.cx - (holeX - 0.5) * viewportWidth;
  renderer.camera.position.y = camY;
  renderer.camera.viewportWidth = viewportWidth;
  renderer.camera.viewportHeight = view;
  renderer.camera.update();
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    applyCamera();
  }
}

function loop(now) {
  if (!running) return;
  raf = requestAnimationFrame(loop);
  const delta = lastTime ? (now - lastTime) / 1000 : 0;
  lastTime = now;
  if (!active) return;
  resize();
  for (const { skeleton, state } of active.built) {
    state.update(delta);
    state.apply(skeleton);
    skeleton.updateWorldTransform();
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  renderer.begin();
  for (const { skeleton } of active.built) renderer.drawSkeleton(skeleton, PREMULTIPLIED_ALPHA);
  renderer.end();
}

function start() { if (!running) { running = true; lastTime = 0; raf = requestAnimationFrame(loop); } }
function stop()  { running = false; cancelAnimationFrame(raf); }

// ── Public API ────────────────────────────────────────────────────────────────

// Get (or load) a character entry. Cached characters return instantly.
export async function acquire({ key, cacheable, baseUrl, skeletons, framing }) {
  init();
  if (cacheable && cache.has(key)) {
    const entry = cache.get(key);
    cache.delete(key); cache.set(key, entry);   // LRU touch
    return entry;
  }
  const entry = await loadEntry(key, baseUrl, skeletons, framing);
  if (cacheable) {
    cache.set(key, entry);
    while (cache.size > CACHE_CAP) {
      const oldestKey = cache.keys().next().value;
      disposeEntry(cache.get(oldestKey));
      cache.delete(oldestKey);
    }
  }
  return entry;
}

// Whether a character is already loaded/resident in the cache.
export function has(key) { return cache.has(key); }

// Show a character: adopt the canvas into the card's host element and draw it.
export function activate(entry, hostEl, className, cameraConfig) {
  init();
  canvas.className = className;
  if (canvas.parentElement !== hostEl) hostEl.appendChild(canvas);
  active = entry;
  active.cameraConfig = cameraConfig ?? null;
  applyCamera();
  start();
}

// Stop showing a character (card unmounting / switching). Cached entries stay
// resident; non-cacheable (saved-build) entries are disposed here.
export function detach(entry, cacheable) {
  if (active === entry) {
    active = null;
    stop();
    if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
  }
  if (!cacheable) disposeEntry(entry);
}
