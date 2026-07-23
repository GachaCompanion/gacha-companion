import React, { useState, useEffect, useRef, startTransition } from 'react';
import { Settings, Minus, X, User } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useStorage } from './hooks/useStorage';
import { useSoftwareCursor } from './hooks/useSoftwareCursor';
import { AccentContext } from './shared/contexts/AccentContext';
import { ThemeContext } from './shared/contexts/ThemeContext';
import { LangContext } from './shared/i18n';
import { clampColorForTheme } from './shared/utils/color';
import GachaTracker from './features/gacha-tracker/GachaTracker';
import { useTrackerState } from './features/gacha-tracker/useTrackerState';
import Showcase from './features/showcase/Showcase';
import { useShowcaseState } from './features/showcase/useShowcaseState';
import Sidebar from './shared/components/sidebar/Sidebar';
import { useTrackerSidebarContent } from './shared/components/sidebar/trackerComponents';
import { useShowcaseSidebarContent } from './shared/components/sidebar/showcaseComponents';
import ConfirmDialog from './shared/components/ConfirmDialog';
import OverviewPage from './features/overview/OverviewPage';
import HomePage from './shell/HomePage';
import SettingsModal from './shell/SettingsModal';
import ProfileModal from './shell/ProfileModal';
import { useLoadingTasks } from './shell/loading/useLoadingTasks';
import './App.css';

const DEFAULT_SETTINGS = {
  accentColor: '#5A82D1',
  theme: 'dark',
  textSize: 115,
  language: 'en',
  minimizeOnClose: false,
  nteOverlayEnabled: true,
  nteCalibration: {},
};

// ─── CSS application ──────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyAccent(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r},${g},${b},0.15)`);
  document.documentElement.style.setProperty('--accent-dim', `rgb(${Math.round(r * 0.5)},${Math.round(g * 0.5)},${Math.round(b * 0.5)})`);
}

function applyAccentForTheme(rawHex, activeTheme) {
  applyAccent(clampColorForTheme(rawHex, activeTheme === 'dark'));
}

function applyTextSize(size) {
  document.documentElement.style.setProperty('--text-zoom', size / 100);
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const { data, save, ready } = useStorage();
  const [showSettings, setShowSettings] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [activeProfileName, setActiveProfileName] = useState('Profile 1');
  function refreshActiveProfileName() {
    window.api?.listProfiles().then(res => {
      const active = res?.profiles?.find(p => p.id === res.activeProfileId);
      if (active) setActiveProfileName(active.name);
    });
  }
  useEffect(() => { refreshActiveProfileName(); }, []);
  const [activeTheme, setActiveTheme] = useState(DEFAULT_SETTINGS.theme);
  const [gameBgUrl, setGameBgUrl] = useState(null);
  const [appBgUrl, setAppBgUrl] = useState(null);
  const [bgList, setBgList] = useState([]);
  const [displayedFilename, setDisplayedFilename] = useState(null);
  const bgCache = useRef({});
  // Every background video stays mounted + autoplaying simultaneously (even
  // inactive ones, at opacity 0.001) so switching games feels instant instead
  // of waiting for a fresh load. Chromium's power-saving heuristics can decide
  // an "invisible" video isn't worth decoding and pause it internally — and
  // don't always reliably resume it when opacity flips back to visible,
  // leaving it stuck on a frozen frame until the whole process restarts.
  // Explicitly re-calling .play() whenever a background becomes the active
  // one is a defensive nudge against that, rather than trusting the browser
  // to resume it on its own.
  const bgVideoRefs = useRef({});
  const bgPortRef = useRef(0);
  useEffect(() => {
    window.api?.getBgServerPort().then(p => { bgPortRef.current = p ?? 0; });
    // Two rAFs ensure Chromium has composited the dark first frame into DWM before
    // we make the window visible — one rAF fires before paint, two fires after.
    requestAnimationFrame(() => requestAnimationFrame(() => window.api?.notifyReady()));
  }, []);
  const [videoPosters, setVideoPosters] = useState({});
  const [videoReady, setVideoReady] = useState({});
  const [showHomepage, setShowHomepage] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [bgOnHomepage, setBgOnHomepage] = useState(true);
  const [gameBgPending, setGameBgPending] = useState(true);
  const [appBgPending, setAppBgPending] = useState(true);

  const [trackerRevealed,  setTrackerRevealed]  = useState(false);
  const [trackerMounted,   setTrackerMounted]   = useState(false);
  const [showcaseRevealed, setShowcaseRevealed] = useState(false);
  const [showcaseMounted,  setShowcaseMounted]  = useState(false);
  const [overviewRevealed, setOverviewRevealed] = useState(false);
  const [overviewMounted,  setOverviewMounted]  = useState(false);
  // Whether the sidebar should be showing — tracked explicitly rather than
  // derived from trackerRevealed||showcaseRevealed, since goShowcase()/
  // goTracker() briefly set BOTH of those false during their 200ms cross-nav
  // gap (so the outgoing page can fade out before the incoming one reveals);
  // deriving from them made the sidebar flash hidden during that gap too,
  // fading exactly like a Home/Statistics transition when it shouldn't.
  const [sidebarActive, setSidebarActive] = useState(false);
  // Set explicitly by goTracker()/goShowcase() rather than derived from
  // trackerRevealed/showcaseRevealed — those both go false during the
  // 200ms cross-nav gap of EVERY transition away from Tracker/Showcase
  // (including to Overview/Home, which have no sidebar at all), so a
  // derived `trackerRevealed ? 'tracker' : 'showcase'` briefly fell through
  // to its 'showcase' fallback on every such transition, flashing the wrong
  // sidebar content/icons for that window even when heading to Overview.
  const [sidebarMode, setSidebarMode] = useState('tracker');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Sidebar-related state that used to live in Showcase.js — lifted here
  // since Sidebar is now a single instance mounted in App.js (a sibling of
  // GachaTracker/Showcase, not a child of either).
  const [selectedSavedBuildId, setSelectedSavedBuildId] = useState(null);
  const [deleteBuildTarget, setDeleteBuildTarget] = useState(null); // { id, name }
  const [showcaseActiveIndex, setShowcaseActiveIndex] = useState(0);

  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  const [loadingUnlocked, setLoadingUnlocked] = useState(false);
  const {
    calculationDone,
    loadingProgress,
    loadingDone,
    offlineError,
    bannerDataRef,
    bannerDataReady,
    bannerSchedules,
    bannerPanelWidths,
    completeVideoTask,
  } = useLoadingTasks({ ready, loadingUnlocked, dataRef });

  // Hoisted so Sidebar (a sibling of GachaTracker/Showcase, not a child of
  // either) can read/act on the same tracker games list and showcase saved
  // builds. Both hooks take data/save/ready as params rather than owning
  // their own useStorage() instance — see useShowcaseState.js's comment for
  // why two independent copies of the same file is a real correctness bug,
  // not just a style preference.
  const tracker  = useTrackerState({ data, save, ready, bannerDataRef, bannerDataReady, bannerSchedules });
  const showcase = useShowcaseState({ data, save, ready });

  const [bgHidden, setBgHidden] = useState(true);
  const hashingRef             = useRef(new Set());
  const prevBgOnHomeRef        = useRef(true);
  const isInitialLoadRef       = useRef(true);

  // Hidden while the loading screen is up — see useSoftwareCursor's own
  // comment for why (busy main thread during boot makes the custom cursor
  // stutter; hiding it entirely during that window sidesteps it cleanly).
  // Also gated on bgHidden so the cursor fades in at the same moment as the
  // home screen itself (bgHidden flips false 800ms after loadingDone — see
  // the effect below, timed to HomePage.js's own title/button fade-in).
  useSoftwareCursor(!loadingDone || bgHidden);

  const settings    = data.settings ?? DEFAULT_SETTINGS;
  const accentColor = settings.accentColor ?? DEFAULT_SETTINGS.accentColor;
  const themeSetting  = settings.theme ?? DEFAULT_SETTINGS.theme;
  const textSize      = settings.textSize ?? DEFAULT_SETTINGS.textSize;
  const language      = settings.language ?? DEFAULT_SETTINGS.language;

  // Resolve and apply theme on load / when setting changes
  useEffect(() => {
    if (!ready) return;
    async function init() {
      let resolved = themeSetting;
      if (themeSetting === 'system') {
        resolved = await window.api?.getSystemTheme() ?? 'dark';
      }
      setActiveTheme(resolved);
      applyTheme(resolved);
      applyAccentForTheme(accentColor, resolved);
    }
    init();
  }, [themeSetting, ready]); // eslint-disable-line

  useEffect(() => {
    if (!ready) return;
    applyAccentForTheme(accentColor, activeTheme);
  }, [accentColor, activeTheme, ready]);

  useEffect(() => {
    if (themeSetting !== 'system') return;
    const unsub = window.api?.onSystemThemeChange((sysTheme) => {
      setActiveTheme(sysTheme);
      applyTheme(sysTheme);
      applyAccentForTheme(accentColor, sysTheme);
    });
    return () => unsub?.();
  }, [themeSetting, accentColor]);

  useEffect(() => {
    if (!ready) return;
    applyTextSize(textSize);
  }, [textSize, ready]);

  // ─── Background: selected game ────────────────────────────────────────────
  const [displayedGameId, setDisplayedGameId] = useState(null);

  // Kept in sync with tracker.selectedId regardless of what changed it — not
  // just Sidebar clicks (handled directly where onSelectGame is wired
  // below), but also paths that reassign it programmatically (creating a
  // game, reassigning selection after a delete).
  useEffect(() => {
    if (tracker.selectedId) setDisplayedGameId(tracker.selectedId);
  }, [tracker.selectedId]); // eslint-disable-line

  useEffect(() => {
    if (!ready) return;
    const first = data.games.find(g => !g.deleted);
    if (first) setDisplayedGameId(first.id);
  }, [ready]); // eslint-disable-line

  useEffect(() => {
    const comingFromHome = prevBgOnHomeRef.current === true && bgOnHomepage === false;
    prevBgOnHomeRef.current = bgOnHomepage;

    if (!ready) return;
    if (!displayedGameId && data.games.some(g => !g.deleted)) return;
    if (bgOnHomepage) {
      setGameBgUrl(null);
      setGameBgPending(false);
      const appFilename = data.settings?.backgroundFilename ?? null;
      const game = data.games.find(g => g.id === displayedGameId);
      if (game?.backgroundFilename) lazyEnsureHash(game.backgroundFilename, 'game', game.id);
      if (appFilename) lazyEnsureHash(appFilename, 'app');
      const gameHash = game?.bgHash ?? null;
      const appHash  = data.settings?.bgHash ?? null;
      // Skip re-setting displayedFilename when content already matches what's
      // shown — but only if something is actually being shown right now. If
      // displayedFilename is empty (e.g. right after a remove), always fall
      // through and set it properly regardless of any hash coincidence.
      if (gameHash && appHash && gameHash === appHash && displayedFilename) return;
      if (!appFilename) setDisplayedFilename(null);
      else if (bgCache.current[appFilename]) setDisplayedFilename(appFilename);
      return;
    }
    const game = data.games.find(g => g.id === displayedGameId);
    const filename = game?.backgroundFilename;
    if (!filename) {
      setGameBgUrl(null);
      setGameBgPending(false);
      const appFilename = data.settings?.backgroundFilename ?? null;
      if (!appFilename) setDisplayedFilename(null);
      else if (bgCache.current[appFilename]) setDisplayedFilename(appFilename);
      return;
    }
    if (bgCache.current[filename]) {
      setGameBgUrl(bgCache.current[filename].url);
      setGameBgPending(false);
      const gameHash = game?.bgHash ?? null;
      const appHash  = data.settings?.bgHash ?? null;
      if (comingFromHome && gameHash && appHash && gameHash === appHash && displayedFilename) return;
      setDisplayedFilename(filename);
      return;
    }
    window.api?.getBackgroundInfo(filename).then(info => {
      if (!info) {
        setGameBgUrl(null);
        setGameBgPending(false);
        return;
      }
      const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
      bgCache.current[filename] = { url, isVideo: info.isVideo };
      setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      setGameBgUrl(url);
      setGameBgPending(false);
      const freshGame  = dataRef.current.games.find(g => g.id === displayedGameId);
      const gameHash   = freshGame?.bgHash ?? null;
      const appHash    = dataRef.current.settings?.bgHash ?? null;
      if (comingFromHome && gameHash && appHash && gameHash === appHash && displayedFilename) return;
      setDisplayedFilename(filename);
    });
  }, [displayedGameId, ready, data.games, bgOnHomepage]); // eslint-disable-line

  // ─── Background: app-wide ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const filename = settings.backgroundFilename;
    const currentGame = data.games.find(g => g.id === displayedGameId);
    const gameHasBg   = !!currentGame?.backgroundFilename;
    const appBgActive = !gameHasBg || bgOnHomepage;
    const gameHash = currentGame?.bgHash ?? null;
    const appHash  = data.settings?.bgHash ?? null;
    const sameContent = !!(gameHash && appHash && gameHash === appHash);
    if (!filename) {
      setAppBgUrl(null);
      setAppBgPending(false);
      if (appBgActive) setDisplayedFilename(null);
      return;
    }
    if (bgCache.current[filename]) {
      setAppBgUrl(bgCache.current[filename].url);
      setAppBgPending(false);
      lazyEnsureHash(filename, 'app');
      // Same "don't skip if nothing is actually displayed" guard as the
      // per-game effect above — sameContent alone isn't enough justification
      // to skip when displayedFilename is currently empty.
      if (appBgActive && (!sameContent || !displayedFilename)) setDisplayedFilename(filename);
      return;
    }
    window.api?.getBackgroundInfo(filename).then(info => {
      if (!info) {
        setAppBgUrl(null);
        setAppBgPending(false);
        return;
      }
      const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
      bgCache.current[filename] = { url, isVideo: info.isVideo };
      setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      const freshGame_    = dataRef.current.games.find(g => g.id === displayedGameId);
      const freshGameHash = freshGame_?.bgHash ?? null;
      const freshAppHash  = dataRef.current.settings?.bgHash ?? null;
      const freshSame     = !!(freshGameHash && freshAppHash && freshGameHash === freshAppHash);
      if (appBgActive && (!freshSame || !displayedFilename)) setDisplayedFilename(filename);
      setAppBgUrl(url);
      setAppBgPending(false);
    });
  }, [settings.backgroundFilename, ready, displayedGameId, data.games, bgOnHomepage]); // eslint-disable-line

  // ─── Background: eager preload all game backgrounds ───────────────────────
  useEffect(() => {
    if (!ready) return;
    data.games.filter(g => !g.deleted && g.backgroundFilename).forEach(game => {
      const filename = game.backgroundFilename;
      lazyEnsureHash(filename, 'game', game.id);
      if (bgCache.current[filename]) return;
      window.api?.getBackgroundInfo(filename).then(info => {
        if (!info) return;
        const url = `http://localhost:${bgPortRef.current}/${encodeURIComponent(filename)}`;
        bgCache.current[filename] = { url, isVideo: info.isVideo };
        setBgList(prev => prev.find(b => b.filename === filename) ? prev : [...prev, { filename, url, isVideo: info.isVideo }]);
      });
    });
    const appFilename = data.settings?.backgroundFilename;
    if (appFilename) lazyEnsureHash(appFilename, 'app');
  }, [ready, data.games]); // eslint-disable-line

  // Toggle html.has-bg class
  const activeBgUrl = gameBgUrl ?? appBgUrl;
  useEffect(() => {
    if (activeBgUrl && !bgHidden) {
      document.documentElement.classList.add('has-bg');
    } else {
      document.documentElement.classList.remove('has-bg');
    }
  }, [activeBgUrl, bgHidden]);

  // Fix for the frozen-background-video bug (see bgVideoRefs' own comment).
  // Root cause confirmed to NOT be Live2D/WebGL contention (reproduced with
  // Showcase never opened) — it's that every background video was left
  // `autoPlay`ing simultaneously regardless of visibility, so up to 5
  // <video> elements could be actively decoding at once. Most GPU/OS decode
  // pipelines only reliably guarantee 1-2 concurrent hardware-decoded
  // streams; going beyond that is undefined behavior, and a minimize/restore
  // cycle is exactly when decode sessions get renegotiated — if there isn't
  // room for all of them, some silently fail to reacquire a session and
  // freeze on their last decoded frame while others succeed. `autoPlay` was
  // removed from the <video> element itself (see the JSX below) — this
  // effect is now the ONLY thing that starts playback, and it explicitly
  // pauses every other background so at most one is ever actively decoding.
  useEffect(() => {
    for (const [filename, el] of Object.entries(bgVideoRefs.current)) {
      if (filename === displayedFilename) el.play().catch(() => {});
      else el.pause();
    }
  }, [displayedFilename, bgList]);

  useEffect(() => {
    function nudge() {
      if (document.visibilityState !== 'visible') return;
      bgVideoRefs.current[displayedFilename]?.play().catch(() => {});
    }
    document.addEventListener('visibilitychange', nudge);
    window.addEventListener('focus', nudge);
    return () => {
      document.removeEventListener('visibilitychange', nudge);
      window.removeEventListener('focus', nudge);
    };
  }, [displayedFilename]);

  useEffect(() => {
    if (!loadingDone) return;
    // Matches HomePage.js's SPLASH_DONE_HOLD_MS (500) + HOME_FADE_IN_DELAY_MS
    // (300) — the moment titlePhase reaches 'home' and the title/buttons start
    // fading in, so the shared background fades in together with them.
    const t = setTimeout(() => setBgHidden(false), 800);
    return () => clearTimeout(t);
  }, [loadingDone]);

  // Pre-mount the heavy sections (GachaTracker + Showcase) DURING the loading
  // phase, behind the loading overlay, so their cost (icons, history processing)
  // is paid before the bar finishes — no freeze when the homepage appears.
  // They stay hidden (revealed=false) until navigated to. startTransition lets
  // React time-slice the mount so the loading bar keeps animating smoothly.
  useEffect(() => {
    if (!ready || !loadingUnlocked || !calculationDone) return;
    const t = setTimeout(() => {
      startTransition(() => { setTrackerMounted(true); setShowcaseMounted(true); });
    }, 400);
    return () => clearTimeout(t);
  }, [ready, loadingUnlocked, calculationDone]); // eslint-disable-line

  // ─── Settings handlers ────────────────────────────────────────────────────

  function updateSettings(patch) {
    save({ ...data, settings: { ...settings, ...patch } });
  }

  function handleResetDefaults() {
    save({ ...data, settings: DEFAULT_SETTINGS });
  }

  function handleAccentChange(color)      { updateSettings({ accentColor: color }); }
  function handleThemeChange(theme)       { updateSettings({ theme }); }
  function handleTextSizeChange(size)     { updateSettings({ textSize: size }); }
  function handleLanguageChange(lang)     { updateSettings({ language: lang }); }
  function handleMinimizeOnCloseChange(v) { updateSettings({ minimizeOnClose: v }); }
  function handleNteOverlayEnabledChange(v) { updateSettings({ nteOverlayEnabled: v }); }
  function handleNteCalibrationChange(patch) {
    updateSettings({ nteCalibration: { ...(settings.nteCalibration ?? {}), ...patch } });
  }

  // ─── App background handlers ──────────────────────────────────────────────

  function lazyEnsureHash(filename, type, gameId) {
    if (!filename || hashingRef.current.has(filename)) return;
    const d = dataRef.current;
    if (type === 'app'  && d.settings?.bgHash) return;
    if (type === 'game' && d.games.find(g => g.id === gameId)?.bgHash) return;
    hashingRef.current.add(filename);
    window.api?.hashBackground(filename).then(hash => {
      if (!hash) return;
      const fresh = dataRef.current;
      if (type === 'app') {
        save({ ...fresh, settings: { ...fresh.settings, bgHash: hash } });
      } else {
        save({ ...fresh, games: fresh.games.map(g => g.id === gameId ? { ...g, bgHash: hash } : g) });
      }
    });
  }

  async function handleAppBgUpload({ filename, buffer }) {
    const result = await window.api?.saveBackground({ filename, buffer });
    const hash = result?.hash ?? null;
    const oldFilename = settings.backgroundFilename;
    if (oldFilename && oldFilename !== filename) {
      await window.api?.deleteBackground(oldFilename);
    }
    updateSettings({ backgroundFilename: filename, bgHash: hash });
  }

  async function handleAppBgRemove() {
    const filename = settings.backgroundFilename;
    if (filename) await window.api?.deleteBackground(filename);
    updateSettings({ backgroundFilename: null, bgHash: null });
  }

  async function handleRemoveAnyGameBackground(gameId) {
    const game = data.games.find(g => g.id === gameId);
    if (!game?.backgroundFilename) return;
    await window.api?.deleteBackground(game.backgroundFilename);
    save({ ...data, games: data.games.map(g => g.id === gameId ? { ...g, backgroundFilename: null, bgHash: null } : g) });
  }

  const activeGames  = data.games.filter(g => !g.deleted);
  const deletedGames = data.games.filter(g => g.deleted);

  // ─── Sidebar navigation ────────────────────────────────────────────────────
  // Sidebar is a single persistent instance (see shared/components/sidebar/),
  // so its Home/Statistics buttons and the Showcase<->Tracker cross-nav
  // button all live here rather than being duplicated per-page.
  // Each of these can be triggered from any of the three pages (Tracker's
  // Sidebar, Showcase's Sidebar, or Overview's own nav), so they all clear
  // every `*Revealed` flag unconditionally — harmless when a flag is
  // already false, but necessary so leaving Overview doesn't leave it
  // visibly stuck underneath the newly-revealed page.
  function goHome() {
    isInitialLoadRef.current = false;
    setSidebarActive(false);
    setTrackerRevealed(false);
    setShowcaseRevealed(false);
    setOverviewRevealed(false);
    setBgOnHomepage(true);
    setControlsVisible(false);
    setTimeout(() => setShowHomepage(true), 200);
  }
  function goOverview() {
    isInitialLoadRef.current = false;
    setSidebarActive(false);
    setTrackerRevealed(false);
    setShowcaseRevealed(false);
    setOverviewMounted(true);
    setTimeout(() => setOverviewRevealed(true), 200);
  }
  function goShowcase() {
    isInitialLoadRef.current = false;
    setSidebarActive(true);
    // Set immediately (not delayed) — Sidebar.js now runs its own fade-out/
    // fade-in around the mode swap, timed to start the instant this fires,
    // so it stays in lockstep with the main page's own fade-out starting
    // at the same moment (see goTracker's matching comment, and Sidebar.js).
    setSidebarMode('showcase');
    setTrackerRevealed(false);
    setOverviewRevealed(false);
    // Showcase always shows the app-wide background, never a per-game one —
    // without this, coming from Tracker left bgOnHomepage at whatever it was
    // (false, if a game background was showing), so the background-selection
    // effect kept resolving the last-viewed game's background instead of
    // switching to the app-wide one.
    setBgOnHomepage(true);
    // 250ms (not the old 200ms) — matches the main content area's fade
    // duration (0.25s, see App.css), now played fully sequentially (fade
    // OUT 0-0.25s, then fade IN 0.25-0.5s) instead of overlapping, so the
    // reveal starts exactly when the outgoing page has fully faded out.
    setTimeout(() => setShowcaseRevealed(true), 250);
  }
  function goTracker() {
    isInitialLoadRef.current = false;
    setSidebarActive(true);
    // Set immediately — see goShowcase's matching comment.
    setSidebarMode('tracker');
    setShowcaseRevealed(false);
    setOverviewRevealed(false);
    // Only entering Tracker directly from Home used to clear this (see
    // onBeforeEnterTracker below) — cross-navigating here from Showcase/Overview
    // left it stuck at whatever it was, which permanently gates the
    // background-selection effect above into always showing the app-wide
    // background instead of ever considering the selected game's own one.
    setBgOnHomepage(false);
    // 250ms — see goShowcase's matching comment.
    setTimeout(() => setTrackerRevealed(true), 250);
  }

  // ─── Showcase saved-build delete confirm ───────────────────────────────────
  // Lives here (not Showcase.js) since Sidebar — which triggers this — is a
  // sibling of Showcase, not a child of it.
  function requestDeleteBuild(id) {
    const build = showcase.savedBuilds.find(b => b.id === id);
    setDeleteBuildTarget({ id, name: build?.name ?? 'this build' });
  }
  function confirmDeleteBuild() {
    if (!deleteBuildTarget) return;
    showcase.deleteBuild(deleteBuildTarget.id);
    if (selectedSavedBuildId === deleteBuildTarget.id) setSelectedSavedBuildId(null);
    setDeleteBuildTarget(null);
  }

  // Mirrors Showcase.js's own currentBuild derivation — the sidebar's "Save
  // Build" button needs canSave/defaultName for the same currently-displayed
  // build, without threading a callback back up from Showcase.js.
  const showcaseLiveBuilds    = showcase.liveResult?.builds ?? [];
  const showcaseSelectedEntry = showcase.savedBuilds.find(b => b.id === selectedSavedBuildId);
  const showcaseCurrentBuild  = showcaseSelectedEntry
    ? showcaseSelectedEntry.build
    : (showcaseLiveBuilds[showcaseActiveIndex] ?? null);
  const canSaveBuild = !showcaseSelectedEntry && !!showcaseCurrentBuild && !!showcase.liveResult;

  // Both hooks are called unconditionally every render (rules of hooks) —
  // whichever one doesn't match the active mode just idles harmlessly.
  const trackerContent = useTrackerSidebarContent({
    games: tracker.activeGames,
    selectedGameId: tracker.selectedId,
    onSelectGame: (id) => { tracker.setSelectedId(id); setDisplayedGameId(id); },
    onAddGame: () => tracker.setShowAddModal(true),
    onEditGame: (id) => tracker.setEditingGameId(id),
    onDeleteGame: (id) => tracker.setPendingDeleteId(id),
    onReorderGames: tracker.handleReorder,
    onShowcase: goShowcase,
  });
  const showcaseContent = useShowcaseSidebarContent({
    savedBuilds: showcase.savedBuilds,
    selectedBuildId: selectedSavedBuildId,
    onSelectBuild: setSelectedSavedBuildId,
    onSaveBuild: (name) => { if (showcaseCurrentBuild) showcase.saveBuild(name, showcaseCurrentBuild); },
    onDeleteBuild: requestDeleteBuild,
    onRenameBuild: showcase.renameBuild,
    onReorderBuilds: showcase.reorderBuilds,
    onTracker: goTracker,
    canSaveBuild,
    defaultSaveName: showcaseCurrentBuild?.name ?? '',
  });
  const sidebarContent = sidebarMode === 'tracker' ? trackerContent : showcaseContent;
  const showingSidebarPage = sidebarActive;

  return (
    <MotionConfig reducedMotion="user">
    <LangContext.Provider value={language}>
    <ThemeContext.Provider value={activeTheme}>
    <AccentContext.Provider value={accentColor}>
      {/* ── Shared background layer ── */}
      <div className={`app-bg-layer${bgHidden ? ' app-bg-layer--loading' : ''}`}>
        {bgList.map(({ filename, url, isVideo }) => {
          const isActive = filename === displayedFilename;
          if (isVideo) {
            const poster = videoPosters[filename];
            const ready  = videoReady[filename];
            return (
              <React.Fragment key={filename}>
                {poster && (
                  <div
                    className="app-bg"
                    style={{ backgroundImage: `url(${poster})`, opacity: isActive && !ready ? 1 : 0 }}
                  />
                )}
                <video
                  ref={el => { if (el) bgVideoRefs.current[filename] = el; else delete bgVideoRefs.current[filename]; }}
                  className="app-bg app-bg--video"
                  src={url}
                  style={{ opacity: isActive && ready ? 1 : 0.001 }}
                  loop muted playsInline preload="auto" crossOrigin="anonymous"
                  onLoadedData={e => {
                    const v = e.target;
                    const capture = () => {
                      try {
                        const canvas = document.createElement('canvas');
                        canvas.width  = v.videoWidth  || 1920;
                        canvas.height = v.videoHeight || 1080;
                        canvas.getContext('2d').drawImage(v, 0, 0);
                        setVideoPosters(prev => ({ ...prev, [filename]: canvas.toDataURL('image/jpeg', 0.85) }));
                      } catch (_) {}
                    };
                    if (typeof requestIdleCallback === 'function') {
                      requestIdleCallback(capture, { timeout: 3000 });
                    } else {
                      setTimeout(capture, 200);
                    }
                  }}
                  onCanPlay={() => {
                    setVideoReady(prev => ({ ...prev, [filename]: true }));
                    completeVideoTask(filename);
                  }}
                  onError={() => {
                    // A background video referenced in user.json but missing from
                    // disk (e.g. manually deleted from backgrounds/) never fires
                    // onCanPlay, permanently stalling the loading bar below 100%
                    // with no console error. Treat a failed load as "done" so
                    // loading can still finish — the background itself just won't
                    // render, same as any other missing/broken background.
                    completeVideoTask(filename);
                  }}
                />
              </React.Fragment>
            );
          }
          return (
            <div key={filename} className="app-bg"
              style={{ backgroundImage: `url(${url})`, opacity: isActive ? 1 : 0 }} />
          );
        })}
      </div>

      <div className="app">
        {/* Single persistent sidebar — never unmounts while either Tracker
            or Showcase is active, only its swappable content (list/footer/
            cross-nav button) transitions on a mode switch (see Sidebar.js).
            Fades out only when leaving to Home/Overview (neither has a
            sidebar), same timing as everything else via .sidebar-slot. */}
        <div className={`sidebar-slot${showingSidebarPage ? '' : ' sidebar-slot--hidden'}`}>
          <Sidebar
            mode={sidebarMode}
            active={showingSidebarPage}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(c => !c)}
            onHome={goHome}
            onOverview={goOverview}
            {...sidebarContent}
          />
        </div>

        <div className="app-pages">
          {trackerMounted && (
            <GachaTracker
              revealed={trackerRevealed}
              tracker={tracker}
              data={data}
              bannerDataRef={bannerDataRef}
              bannerSchedules={bannerSchedules}
              bannerPanelWidths={bannerPanelWidths}
              gameBgUrl={gameBgUrl}
              nteOverlayEnabled={settings.nteOverlayEnabled ?? true}
              nteCalibration={settings.nteCalibration ?? {}}
              onNteCalibrationChange={handleNteCalibrationChange}
            />
          )}
          {showcaseMounted && (
            <Showcase
              revealed={showcaseRevealed}
              showcase={showcase}
              collapsed={sidebarCollapsed}
              selectedSavedId={selectedSavedBuildId}
              onSelectSaved={setSelectedSavedBuildId}
              activeIndex={showcaseActiveIndex}
              onActiveIndexChange={setShowcaseActiveIndex}
              onGoHome={goHome}
            />
          )}
        </div>
      </div>

      {/* Overview (Statistics) never has a sidebar, so it's a sibling of
          .app rather than nested inside .app-pages (which is always
          width: calc(100% - 220px) for the sidebar) — otherwise it would
          render visibly shifted right even with no sidebar showing. */}
      {overviewMounted && (
        <OverviewPage
          revealed={overviewRevealed}
          games={activeGames}
          onGoHome={goHome}
          onShowcase={goShowcase}
          onTracker={goTracker}
        />
      )}

      {deleteBuildTarget && (
        <ConfirmDialog
          title="Delete this build?"
          message={`"${deleteBuildTarget.name}" will be permanently removed from your saved builds. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDeleteBuild}
          onCancel={() => setDeleteBuildTarget(null)}
        />
      )}

      {/* ── Always-visible window controls ── */}
      <div className="title-bar-controls--fixed">
        <div className={`title-bar-controls--fade${controlsVisible ? ' title-bar-controls--fade-visible' : ''}`}>
          <button
            className="title-bar-btn title-bar-profile-btn"
            onClick={() => setShowProfileModal(true)}
            title={`Profile: ${activeProfileName}`}
          >
            <User size={14} />
            <span>{activeProfileName}</span>
          </button>
          <button className="title-bar-btn" onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={16} />
          </button>
          <button className="title-bar-btn" onClick={() => window.api?.minimizeWindow()} title="Minimize">
            <Minus size={16} />
          </button>
        </div>
        <button
          className="title-bar-btn title-bar-btn--close"
          onClick={() => (settings.minimizeOnClose ?? false) ? window.api?.minimizeWindow() : window.api?.closeWindow()}
          title={(settings.minimizeOnClose ?? false) ? 'Minimize' : 'Close'}
        >
          <X size={16} />
        </button>
      </div>

      {showHomepage && (
        <HomePage
          appBgUrl={activeBgUrl}
          isReady={!gameBgPending && !appBgPending && ready}
          onBeforeEnterTracker={() => { setSidebarActive(true); setSidebarMode('tracker'); setTrackerRevealed(true); setBgOnHomepage(false); }}
          onEnterTracker={() => setShowHomepage(false)}
          onBeforeEnterShowcase={() => { setSidebarActive(true); setSidebarMode('showcase'); setShowcaseRevealed(true); }}
          onEnterShowcase={() => setShowHomepage(false)}
          onBeforeEnterOverview={() => { setOverviewMounted(true); setOverviewRevealed(true); setBgOnHomepage(false); }}
          onEnterOverview={() => setShowHomepage(false)}
          loadingProgress={loadingProgress}
          loadingDone={loadingDone}
          offlineError={offlineError}
          skipLoadingPhase={!isInitialLoadRef.current}
          calculationDone={calculationDone}
          onLoadingUnlock={() => setLoadingUnlocked(true)}
          onMenuVisible={() => setControlsVisible(true)}
        />
      )}

      {showProfileModal && (
        <ProfileModal onClose={() => { setShowProfileModal(false); refreshActiveProfileName(); }} />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onAccentChange={handleAccentChange}
          onThemeChange={handleThemeChange}
          onTextSizeChange={handleTextSizeChange}
          onLanguageChange={handleLanguageChange}
          onMinimizeOnCloseChange={handleMinimizeOnCloseChange}
          onNteOverlayEnabledChange={handleNteOverlayEnabledChange}
          onResetDefaults={handleResetDefaults}
          deletedGames={deletedGames}
          onRestoreGame={(id) => save({ ...data, games: data.games.map(g => g.id === id ? { ...g, deleted: false } : g) })}
          onPermanentDelete={(id) => save({ ...data, games: data.games.filter(g => g.id !== id) })}
          appBgUrl={appBgUrl}
          onAppBgUpload={handleAppBgUpload}
          onAppBgRemove={handleAppBgRemove}
          activeGames={activeGames}
          onRemoveGameBackground={handleRemoveAnyGameBackground}
          onClose={() => setShowSettings(false)}
        />
      )}
    </AccentContext.Provider>
    </ThemeContext.Provider>
    </LangContext.Provider>
    </MotionConfig>
  );
}
