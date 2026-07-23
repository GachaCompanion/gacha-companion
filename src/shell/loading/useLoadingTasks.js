// Owns the app's entire boot-loading pipeline: figuring out what needs to load
// (banners, banner images, Live2D downloads + framing, ZZZ character art, any
// background videos in use), running it all in parallel, and turning per-task
// progress into one weighted 0-100 number for the loading bar in HomePage.js.
//
// Extracted out of App.js so this ~250-line orchestrator has its own home
// instead of living inline next to unrelated App state (theme/accent/settings/
// background-image handling) — see taskDefs.js for the actual task list, and
// measureBannerPanelWidths.js for the canvas-based width helper this also runs
// once banner schedules come back.
//
// Inputs:
//   ready           — true once storage has been read (from useStorage)
//   loadingUnlocked — true once HomePage's bar-entrance animation has finished
//                     and it's safe to actually start running tasks
//   dataRef         — ref mirroring the latest storage data (owned by App.js,
//                     read here only to find which background videos are in use)
//
// Returns everything HomePage/GachaTracker need to render loading state and
// banner data — see the return statement at the bottom for the full shape.
import { useState, useEffect, useRef } from 'react';
import { bannerImageCache } from '../../shared/utils/bannerImageCache';
import { loadHsrData, getHsrAllAvatarIds, getHsrAllWeaponIds, getHsrWeaponData } from '../../features/showcase/games/hsr/hsrData';
import { nanokaLightConeUrl } from '../../features/showcase/games/hsr/hsrFetch';
import { loadHsrPngFraming } from '../../features/showcase/games/hsr/hsrPngFraming';
import { loadZzzData, getZzzAvatarData, getZzzAllAvatarIds, zzzAsset } from '../../features/showcase/games/zzz/zzzData';
import { loadGameFont } from '../../hooks/useGameFont';
import { measureBannerPanelWidths } from './measureBannerPanelWidths';
import { TASK_DEFS, buildVideoTaskDefs } from './taskDefs';

const MIN_TASK_MS = 400;

export function useLoadingTasks({ ready, loadingUnlocked, dataRef }) {
  const [calculationDone, setCalculationDone] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDone, setLoadingDone]         = useState(false);
  const [offlineError, setOfflineError]       = useState(false);

  const bannerDataRef = useRef({ banners: null, bannersDual: null });
  const [bannerDataReady, setBannerDataReady] = useState(false);
  const [bannerPanelWidths, setBannerPanelWidths] = useState(null);
  const [bannerSchedules, setBannerSchedules]     = useState({ genshin: null, hsr: null, zzz: null, nte: null, wuwa: null });

  const tasksRef               = useRef(null);
  const totalWeightRef         = useRef(0);
  const loadingStartedRef      = useRef(false);
  const videoTaskFilenamesRef  = useRef([]);
  const taskFnsRef             = useRef(null);
  const pendingCompletionsRef  = useRef(new Set());
  const taskStartTimesRef      = useRef({});
  const loadingFiredRef        = useRef(false);
  const offlineTimeRef         = useRef(null);

  // ─── Pre-bar calculation phase ────────────────────────────────────────────
  // Figures out which background videos actually need a "video ready" task
  // before the bar can start — must happen before task-based loading below.
  useEffect(() => {
    if (!ready) return;
    const videoFilenames = new Set();
    const appBg = dataRef.current.settings?.backgroundFilename;
    if (appBg && /\.(mp4|webm|mov)$/i.test(appBg)) videoFilenames.add(appBg);
    dataRef.current.games
      .filter(g => !g.deleted && g.backgroundFilename)
      .forEach(g => {
        if (/\.(mp4|webm|mov)$/i.test(g.backgroundFilename)) videoFilenames.add(g.backgroundFilename);
      });
    videoTaskFilenamesRef.current = [...videoFilenames];
    setCalculationDone(true);
  }, [ready]); // eslint-disable-line

  // ─── Task-based loading ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !loadingUnlocked || !calculationDone) return;
    if (loadingStartedRef.current) return;
    loadingStartedRef.current = true;

    const taskDefs = [...TASK_DEFS, ...buildVideoTaskDefs(videoTaskFilenamesRef.current)];
    const tasks = {};
    let totalW = 0;
    const now = Date.now();
    for (const { id, weight } of taskDefs) {
      tasks[id] = { weight, progress: 0 };
      totalW += weight;
      taskStartTimesRef.current[id] = now;
    }
    for (const id of pendingCompletionsRef.current) {
      if (tasks[id]) tasks[id].progress = 1;
    }
    pendingCompletionsRef.current.clear();
    tasksRef.current     = tasks;
    totalWeightRef.current = totalW;

    function recompute() {
      const t = tasksRef.current;
      if (!t) return;
      let completed = 0;
      for (const task of Object.values(t)) completed += task.weight * task.progress;
      setLoadingProgress((completed / totalWeightRef.current) * 100);
    }

    function updateTask(id, progress) {
      if (!tasksRef.current?.[id]) return;
      tasksRef.current[id].progress = Math.min(1, Math.max(0, progress));
      recompute();
    }

    function completeTask(id) { updateTask(id, 1); }

    function smoothComplete(id) {
      const task = tasksRef.current?.[id];
      if (!task) return;
      const elapsed   = Date.now() - (taskStartTimesRef.current[id] ?? Date.now());
      const remaining = Math.max(0, MIN_TASK_MS - elapsed);
      if (remaining < 16) { completeTask(id); return; }
      const fromProgress = task.progress;
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (!tasksRef.current?.[id]) { clearInterval(iv); return; }
        const p = Math.min(1, (Date.now() - t0) / remaining);
        updateTask(id, fromProgress + (1 - fromProgress) * p);
        if (p >= 1) clearInterval(iv);
      }, 16);
      smoothIntervals.push(iv);
    }

    taskFnsRef.current = { completeTask, updateTask, smoothComplete };

    let cancelled = false;
    const smoothIntervals = [];

    async function fetchImagesForGame(images, taskId, fetchFn, cachePrefix) {
      if (images.length === 0) { smoothComplete(taskId); return; }
      const BATCH = 20;
      let done = 0;
      for (let i = 0; i < images.length; i += BATCH) {
        if (cancelled) return;
        const batch = images.slice(i, i + BATCH);
        const urls  = await Promise.all(batch.map(({ id }) => fetchFn(id).catch(() => null)));
        urls.forEach((url, j) => { if (url) bannerImageCache.set(`${cachePrefix}:${batch[j].id}`, url); });
        done += batch.length;
        updateTask(taskId, done / images.length);
      }
    }

    async function runLoading() {
      const [genshinResult, hsrResult, zzzResult, nteResult, wuwaResult] = await Promise.all([
        window.api?.fetchGenshinBanners?.() ?? Promise.resolve({ ok: false, offline: true }),
        window.api?.fetchHsrBanners?.()     ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
        window.api?.fetchZzzBanners?.()     ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
        window.api?.fetchNteBanners?.()     ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
        window.api?.fetchWuwaBanners?.()    ?? Promise.resolve({ ok: false, bannerSchedule: [] }),
      ]);
      if (cancelled) return;

      smoothComplete('genshin_banners');
      smoothComplete('hsr_banners');
      smoothComplete('zzz_banners');
      smoothComplete('nte_banners');
      smoothComplete('wuwa_banners');

      if (genshinResult.offline || !genshinResult.ok) {
        offlineTimeRef.current = Date.now();
        setOfflineError(true);
      }
      if (!cancelled && genshinResult.ok && genshinResult.banners) {
        bannerDataRef.current = { banners: genshinResult.banners, bannersDual: genshinResult.bannersDual ?? null };
        setBannerDataReady(true);
      }
      if (!cancelled) {
        setBannerSchedules({
          genshin: genshinResult.bannerSchedule ?? [],
          hsr:     hsrResult.bannerSchedule     ?? [],
          zzz:     zzzResult.bannerSchedule     ?? [],
          nte:     nteResult.bannerSchedule     ?? [],
          wuwa:    wuwaResult.bannerSchedule    ?? [],
        });
        setBannerPanelWidths(measureBannerPanelWidths({
          genshin: genshinResult.bannerSchedule ?? [],
          hsr:     hsrResult.ok  ? (hsrResult.bannerSchedule  ?? []) : [],
          zzz:     zzzResult.ok  ? (zzzResult.bannerSchedule  ?? []) : [],
        }));
      }

      if (cancelled) return;

      const genshinImages = [];
      if (genshinResult.ok && genshinResult.banners && window.api?.getGenshinBannerImageById) {
        const seen = new Set();
        const addImg = (b) => {
          if (!b.featuredId || seen.has(b.featuredId)) return;
          seen.add(b.featuredId);
          genshinImages.push({ id: b.featuredId });
        };
        for (const b of (genshinResult.banners.characters ?? [])) addImg(b);
        for (const b of (genshinResult.banners.weapons    ?? [])) addImg(b);
        if (genshinResult.bannersDual) {
          for (const pairs of Object.values(genshinResult.bannersDual)) {
            for (const b of pairs) addImg(b);
          }
        }
      }

      const hsrImages = [...new Set(
        (hsrResult.ok ? (hsrResult.bannerSchedule ?? []) : [])
          .filter(b => b.featuredId).map(b => b.featuredId)
      )].map(id => ({ id }));

      const zzzImages = [...new Set(
        (zzzResult.ok ? (zzzResult.bannerSchedule ?? []) : [])
          .filter(b => b.featuredId).map(b => b.featuredId)
      )].map(id => ({ id }));

      // NTE's schedule entries use featuredId too (numeric character id or
      // "fork_xxx" arc key — see the data repo's build.js), plus a full
      // roster manifest (nte/roster-images.json) covering every character
      // and arc, not just schedule-tied ones — unlike the other 3 games,
      // NTE's source (nanoka) already has the full roster available, so
      // there's no reason to only preload the ~10 banner-tied images.
      let nteRosterIds = [];
      try {
        const rosterResult = await window.api?.fetchNteRosterImageIds?.();
        if (rosterResult?.ok) nteRosterIds = rosterResult.ids ?? [];
      } catch { /* offline: falls back to schedule-tied ids only */ }
      if (cancelled) return;

      const nteScheduleIds = (nteResult.ok ? (nteResult.bannerSchedule ?? []) : [])
        .filter(b => b.featuredId).map(b => b.featuredId);
      const nteImages = [...new Set([...nteScheduleIds, ...nteRosterIds])].map(id => ({ id }));

      // WuWa: schedule-tied images only (like hsr/zzz), not a full-roster
      // preload — the data repo's wuwa/images/ has the full 184-character-
      // +weapon roster available via wuwa:getBannerImage, but there's no
      // dedicated "list all ids" IPC endpoint yet (NTE's fetchNteRosterImageIds
      // equivalent) to drive that without one, so this stays scoped to what's
      // actually shown in the Pull Log's banner panel for now.
      const wuwaImages = [...new Set(
        (wuwaResult.ok ? (wuwaResult.bannerSchedule ?? []) : [])
          .filter(b => b.featuredId).map(b => b.featuredId)
      )].map(id => ({ id }));

      if (cancelled) return;

      const imgStart = Date.now();
      taskStartTimesRef.current['genshin_images'] = imgStart;
      taskStartTimesRef.current['hsr_images']     = imgStart;
      taskStartTimesRef.current['zzz_images']     = imgStart;
      taskStartTimesRef.current['nte_images']     = imgStart;
      taskStartTimesRef.current['wuwa_images']    = imgStart;

      await Promise.all([
        fetchImagesForGame(genshinImages, 'genshin_images',
          id => window.api.getGenshinBannerImageById(id), 'genshin'),
        fetchImagesForGame(hsrImages,     'hsr_images',
          id => window.api.getHsrBannerImage(id),         'hsr'),
        fetchImagesForGame(zzzImages,     'zzz_images',
          id => window.api.getZzzBannerImage(id),          'zzz'),
        fetchImagesForGame(nteImages,     'nte_images',
          id => window.api.getNteBannerImage(id),          'nte'),
        fetchImagesForGame(wuwaImages,    'wuwa_images',
          id => window.api.getWuwaBannerImage(id),         'wuwa'),
      ]);
    }

    runLoading();

    // Showcase preload — runs in parallel with the banner work above.
    // Definitions (names/stats/icons) so a UID search needs no lazy fetch:
    loadHsrData()
      .then(() => { if (!cancelled) smoothComplete('enka_hsr'); })
      .catch(() => { if (!cancelled) completeTask('enka_hsr'); });
    // Download + frame every HSR/ZZZ Live2D. ensureLive2d is idempotent (skips cached
    // assets and already-framed characters), so warm launches fly through; the
    // first run downloads + runs face-detection framing, hence the heavy weight.
    (async () => {
      // Download + frame every HSR Live2D. Framing itself is precomputed
      // (framing.json, published by the GitHub Actions pipeline) — this just
      // downloads spine assets and reads the cached framing value, no local
      // face-detection model involved.
      let ids = [];
      try { ids = (await window.api?.listManifestLive2d?.('hsr')) ?? []; } catch { /* offline */ }
      if (cancelled) return;
      if (!ids.length) { completeTask('live2d_hsr'); return; }
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try { await window.api?.ensureLive2d?.('hsr', id); } catch { /* per-char failure is non-fatal */ }
        updateTask('live2d_hsr', ++done / ids.length);
      }
    })();
    (async () => {
      // Download + frame every ZZZ Live2D (same pipeline as HSR, static manifest).
      let ids = [];
      try { ids = (await window.api?.listManifestLive2d?.('zzz')) ?? []; } catch { /* offline */ }
      if (cancelled) return;
      if (!ids.length) { completeTask('live2d_zzz'); return; }
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try { await window.api?.ensureLive2d?.('zzz', id); } catch { /* per-char failure is non-fatal */ }
        updateTask('live2d_zzz', ++done / ids.length);
      }
    })();
    (async () => {
      // Download + crop ZZZ character background images.
      let ids = [];
      try { ids = (await window.api?.listManifestLive2d?.('zzz')) ?? []; } catch { /* offline */ }
      if (cancelled) return;
      if (!ids.length) { completeTask('char_images_zzz'); return; }
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try { await window.api?.ensureCharImage?.('zzz', id); } catch { /* per-char failure is non-fatal */ }
        updateTask('char_images_zzz', ++done / ids.length);
      }
    })();
    (async () => {
      // Download + top-crop ZZZ character portrait icons (all Enka avatars, not just Live2D ones).
      try { await loadZzzData(); } catch { completeTask('char_icons_zzz'); return; }
      if (cancelled) return;
      const ids = getZzzAllAvatarIds();
      if (!ids.length) { completeTask('char_icons_zzz'); return; }
      if (cancelled) return;
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try {
          const iconUrl = zzzAsset(getZzzAvatarData(id)?.Image);
          if (iconUrl) await window.api?.ensureCharIcon?.('zzz', id, iconUrl);
        } catch { /* per-char failure is non-fatal */ }
        updateTask('char_icons_zzz', ++done / ids.length);
      }
    })();
    (async () => {
      // Download + crop HSR character background images (nanoka), all characters —
      // not just Live2D ones, since PNG mode should work for every character.
      try { await loadHsrData(); } catch { completeTask('char_images_hsr'); return; }
      // PNG face-detection framing — loaded once here (not per-card) so a card's
      // first render already has the right position, no pop-in after the fact.
      await loadHsrPngFraming();
      if (cancelled) return;
      const ids = getHsrAllAvatarIds();
      if (!ids.length) { completeTask('char_images_hsr'); return; }
      const showcasesPort = await window.api?.getShowcasesServerPort?.();
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try {
          const rel = await window.api?.ensureCharImage?.('hsr', id);
          // Prefetch into the renderer's own HTTP cache now that the file is small
          // (JPEG, downscaled) — so HsrCard's <img> paints instantly instead of
          // decoding for the first time when a card is actually opened.
          if (rel && showcasesPort) {
            const img = new Image();
            img.src = `http://127.0.0.1:${showcasesPort}/${rel}`;
          }
        } catch { /* per-char failure is non-fatal */ }
        updateTask('char_images_hsr', ++done / ids.length);
      }
    })();
    (async () => {
      // Download + crop HSR light cone art (nanoka) — separate 'hsr-lc' cache
      // namespace so light cone tids never collide with character avatarIds.
      try { await loadHsrData(); } catch { completeTask('char_lc_hsr'); return; }
      if (cancelled) return;
      const ids = getHsrAllWeaponIds();
      if (!ids.length) { completeTask('char_lc_hsr'); return; }
      let done = 0;
      for (const id of ids) {
        if (cancelled) return;
        try {
          if (getHsrWeaponData(id)) await window.api?.ensureCharIcon?.('hsr-lc', id, nanokaLightConeUrl(id));
        } catch { /* per-char failure is non-fatal */ }
        updateTask('char_lc_hsr', ++done / ids.length);
      }
    })();
    (async () => {
      // Per-game auto-detected font (see hooks/useGameFont.js + electron/Fonts.js).
      // Resolved here so it's already in document.fonts + the module cache by the
      // time Showcase/Tracker ever mount — no default-font flash on first render.
      await Promise.allSettled([loadGameFont('genshin'), loadGameFont('hsr'), loadGameFont('zzz')]);
      if (!cancelled) smoothComplete('game_fonts');
    })();

    return () => {
      cancelled = true;
      smoothIntervals.forEach(clearInterval);
    };
  }, [ready, loadingUnlocked, calculationDone]); // eslint-disable-line

  // Bar hits 100% -> latch loadingDone (once).
  useEffect(() => {
    if (loadingProgress < 100 || loadingFiredRef.current) return;
    loadingFiredRef.current = true;
    setLoadingDone(true);
  }, [loadingProgress]);

  // Called by App.js when a background <video> fires onCanPlay — marks that
  // video's task complete if the task list has started, or queues it (the
  // video can become ready before loadingUnlocked/calculationDone flip true).
  const completeVideoTaskRef = useRef((filename) => {
    const taskId = `video_${filename}`;
    if (taskFnsRef.current) {
      taskFnsRef.current.smoothComplete(taskId);
    } else {
      pendingCompletionsRef.current.add(taskId);
    }
  });

  return {
    calculationDone,
    loadingProgress,
    loadingDone,
    offlineError,
    bannerDataRef,
    bannerDataReady,
    bannerSchedules,
    bannerPanelWidths,
    completeVideoTask: completeVideoTaskRef.current,
  };
}
