import { useState, useEffect, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { appendNewPulls, recomputeRolls } from './engine/pullUtils';
import { parseUid } from './engine/uidUtils';
import { computeGameStats } from './engine/computeGameStats';
import { enrichApiPulls } from './games/genshin/genshinImport';
import { enrichHsrApiPulls } from './games/hsr/hsrImport';
import { enrichZzzApiPulls } from './games/zzz/zzzImport';
import { enrichWuwaApiPulls } from './games/wuwa/wuwaImport';
import { resyncLockedDefaults } from './engine/gameSchema';

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'chronicledFatePoints',
  'dailyPassActive', 'dailyPassLastClaimedAt',
  'currency', 'currentCurrency', 'pullItems', 'charPullItems', 'weaponPullItems',
  'goals', 'wishList', 'history', 'stats', 'lastSynced',
  'excelImported', 'jsonImported',
]);

// Compares a linked game's stored banner data against the current locked
// defaults. Returns the SAME game reference when nothing changed (matters
// for useStorage.js's save() — untouched games must keep reference identity).
function computeBannerResync(g) {
  if (!g.linkedDatabase) return { changed: false, game: g };
  const next = resyncLockedDefaults(g);
  const changed =
    JSON.stringify(next.charBanner) !== JSON.stringify(g.charBanner) ||
    JSON.stringify(next.weaponBanner) !== JSON.stringify(g.weaponBanner) ||
    next.pullItemName !== g.pullItemName ||
    next.weaponPullItemName !== g.weaponPullItemName ||
    next.dailyPassName !== g.dailyPassName ||
    JSON.stringify(next.state) !== JSON.stringify(g.state);
  return { changed, game: changed ? next : g };
}

export function useTrackerState({ data, save, ready, bannerDataRef, bannerDataReady, bannerSchedules }) {
  const [selectedId, setSelectedId]         = useState(null);
  const [showAddModal, setShowAddModal]     = useState(false);
  const [editingGameId, setEditingGameId]   = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [showGameSettings, setShowGameSettings] = useState(false);

  // Derived
  const activeGames  = data.games.filter(g => !g.deleted);
  const deletedGames = data.games.filter(g => g.deleted);
  const selectedGame = data.games.find(g => g.id === selectedId) || null;
  const editingGame  = data.games.find(g => g.id === editingGameId) || null;

  // Auto-select first game on initial load
  useEffect(() => {
    if (!ready) return;
    const first = data.games.find(g => !g.deleted);
    if (first) setSelectedId(first.id);
  }, [ready]); // eslint-disable-line

  // On-load enrichment/migration — runs when the app is ready AND banner data has loaded.
  // Combines pull-log enrichment, server-offset fixes, and locked-banner-default
  // resyncing into a single effect/save() call — two separate effects both
  // reading+writing `data.games` from the same stale closure would race,
  // with whichever save() lands last silently discarding the other's fix.
  useEffect(() => {
    if (!ready || !bannerDataReady) return;
    const { banners, bannersDual } = bannerDataRef.current;
    const { hsr: hsrSchedule, zzz: zzzSchedule, wuwa: wuwaSchedule } = bannerSchedules;

    const needsRolls = data.games.some(g =>
      g.state?.pullLog?.some(p => p.roll == null)
    );
    const needsGenshinEnrich = banners && data.games.some(g =>
      g.linkedDatabase !== 'hsr' && g.linkedDatabase !== 'zzz' && g.linkedDatabase !== 'wuwa' &&
      g.state?.pullLog?.some(p => p.source === 'api')
    );
    const hasHsrGames = hsrSchedule?.length > 0 &&
      data.games.some(g => g.linkedDatabase === 'hsr' && g.state?.pullLog?.some(p => p.source === 'api'));
    const hasZzzGames = zzzSchedule?.length > 0 &&
      data.games.some(g => g.linkedDatabase === 'zzz' && g.state?.pullLog?.some(p => p.source === 'api'));
    const hasWuwaGames = wuwaSchedule?.length > 0 &&
      data.games.some(g => g.linkedDatabase === 'wuwa' && g.state?.pullLog?.some(p => p.source === 'api'));
    const needsServerOffsetFix = data.games.some(g => {
      const { serverOffset: derived } = parseUid(g.uid ?? '', g.linkedDatabase ?? '');
      return derived != null && derived !== g.state?.serverOffset;
    });
    const needsBannerResync = data.games.some(g => computeBannerResync(g).changed);

    if (!needsRolls && !needsGenshinEnrich && !hasHsrGames && !hasZzzGames && !hasWuwaGames && !needsServerOffsetFix && !needsBannerResync) return;

    const migratedGames = data.games.map(g => {
      const { changed: bannerChanged, game: base } = computeBannerResync(g);
      let log = base.state?.pullLog;
      const db = base.linkedDatabase;

      const { serverOffset: derivedOffset } = parseUid(base.uid ?? '', db ?? '');
      const serverOffset = derivedOffset ?? base.state?.serverOffset ?? 8;
      const serverOffsetChanged = derivedOffset != null && derivedOffset !== base.state?.serverOffset;

      if (!log?.length) {
        if (serverOffsetChanged || bannerChanged) return { ...base, state: { ...base.state, serverOffset } };
        return base;
      }

      if (needsGenshinEnrich && db !== 'hsr' && db !== 'zzz' && db !== 'wuwa') {
        log = enrichApiPulls(log, banners, bannersDual, serverOffset);
      }
      if (hasHsrGames && db === 'hsr') {
        log = enrichHsrApiPulls(log, hsrSchedule, serverOffset);
      }
      if (hasZzzGames && db === 'zzz') {
        log = enrichZzzApiPulls(log, zzzSchedule, serverOffset);
      }
      if (hasWuwaGames && db === 'wuwa') {
        log = enrichWuwaApiPulls(log, wuwaSchedule, serverOffset);
      }
      if (needsRolls && log.some(p => p.roll == null)) {
        log = recomputeRolls(log);
      }
      if (log === base.state.pullLog && !serverOffsetChanged && !bannerChanged) return base;
      return { ...base, state: { ...base.state, serverOffset, pullLog: log } };
    });

    const changed = migratedGames.some((g, i) => g !== data.games[i]);
    if (changed) save({ ...data, games: migratedGames });
  }, [ready, bannerDataReady, bannerSchedules]); // eslint-disable-line

  // ─── Computed stats (stats.json) ───────────────────────────────────────────────
  // Recomputes each linked game's stats whenever ITS OWN pullLog reference
  // actually changes (sync, import, manual edit, etc.) — not on every
  // unrelated save(). data.games gets a new array reference on every save
  // (even a game rename), so this effect re-runs constantly; the ref-keyed
  // "did this specific game's pullLog change" check keeps the actual
  // computeGameStats() call (an O(pullLog length) scan) from re-running for
  // edits that have nothing to do with pull history — the same cost concern
  // that originally justified splitting pullLog into its own file.
  const lastStatsPullLogRef = useRef(new Map());
  useEffect(() => {
    if (!ready) return;
    let anyChanged = false;
    const resynced = data.games.map(g => {
      if (!g.linkedDatabase) return g;
      const log = g.state?.pullLog;
      if (lastStatsPullLogRef.current.get(g.id) === log) return g;
      lastStatsPullLogRef.current.set(g.id, log);
      const stats = computeGameStats(log);
      if (JSON.stringify(stats) === JSON.stringify(g.state?.stats ?? null)) return g;
      anyChanged = true;
      return { ...g, state: { ...g.state, stats } };
    });
    if (anyChanged) save({ ...data, games: resynced });
  }, [ready, data.games]); // eslint-disable-line

  // ─── Game CRUD ────────────────────────────────────────────────────────────────

  function handleAddGame(newGame) {
    save({ ...data, games: [...data.games, newGame] });
    setSelectedId(newGame.id);
    setShowAddModal(false);
  }

  function handleUpdateGame(updatedGame) {
    save({ ...data, games: data.games.map(g => g.id === updatedGame.id ? updatedGame : g) });
    setEditingGameId(null);
  }

  function handleUpdateMultiple(updatedGames) {
    const patchMap = Object.fromEntries(updatedGames.map(g => [g.id, g]));
    save({ ...data, games: data.games.map(g => patchMap[g.id] ?? g) });
  }

  function handleDeleteGame(id) {
    save({ ...data, games: data.games.map(g =>
      g.id === id
        ? { ...g, deleted: true, linkedDatabase: null, enabledFeatures: {} }
        : g
    )});
    if (selectedId === id) {
      const next = activeGames.find(g => g.id !== id);
      setSelectedId(next ? next.id : null);
    }
  }

  function handleRestoreGame(id) {
    save({ ...data, games: data.games.map(g => g.id === id ? { ...g, deleted: false } : g) });
  }

  function handlePermanentDelete(id) {
    save({ ...data, games: data.games.filter(g => g.id !== id) });
  }

  function handleReorder(activeId, overId) {
    const games = data.games;
    const oldIndex = games.findIndex(g => g.id === activeId);
    const newIndex = games.findIndex(g => g.id === overId);
    if (oldIndex !== -1 && newIndex !== -1) {
      save({ ...data, games: arrayMove(games, oldIndex, newIndex) });
    }
  }

  async function handleGameUidChange(game, newUid) {
    const db = game.linkedDatabase;
    const exists = db ? await window.api?.uidExists(db, newUid) : false;

    const configState = {};
    const currentUidState = {};
    const { apiBackup: currentBackup, ...rest } = game.state ?? {};
    for (const [k, v] of Object.entries(rest)) {
      if (UID_STATE_FIELDS.has(k)) currentUidState[k] = v;
      else configState[k] = v;
    }
    configState._migrated = true;
    const { serverOffset: derivedOffset } = parseUid(newUid, db ?? '');
    if (derivedOffset != null) configState.serverOffset = derivedOffset;

    // apiBackup is never persisted to disk (in-memory-only, recomputed
    // fresh on next sync — see useStorage.js's save()), so switching to an
    // existing uid starts with none; switching to a brand-new uid just
    // carries the current session's along.
    let uidState, apiBackup;
    if (exists) {
      uidState  = await window.api.readGameState(db, newUid);
      apiBackup = [];
    } else {
      uidState  = currentUidState;
      apiBackup = currentBackup ?? [];
    }

    const updatedGame = { ...game, uid: newUid, state: { ...configState, ...uidState, apiBackup } };
    save({ ...data, games: data.games.map(g => g.id === game.id ? updatedGame : g) });

    if (db && game.uid === 'default' && newUid !== 'default') {
      window.api?.clearUidState?.(db, 'default');
    }
  }

  // ─── Game background handlers ──────────────────────────────────────────────

  async function handleGameBgUpload({ filename, buffer }) {
    const result = await window.api?.saveBackground({ filename, buffer });
    const hash = result?.hash ?? null;
    const oldFilename = selectedGame?.backgroundFilename;
    if (oldFilename && oldFilename !== filename) {
      await window.api?.deleteBackground(oldFilename);
    }
    handleUpdateGame({ ...selectedGame, backgroundFilename: filename, bgHash: hash });
  }

  async function handleGameBgRemove() {
    const filename = selectedGame?.backgroundFilename;
    if (filename) await window.api?.deleteBackground(filename);
    handleUpdateGame({ ...selectedGame, backgroundFilename: null, bgHash: null });
  }

  return {
    // State
    selectedId, setSelectedId,
    showAddModal, setShowAddModal,
    editingGameId, setEditingGameId,
    pendingDeleteId, setPendingDeleteId,
    showGameSettings, setShowGameSettings,
    // Derived
    activeGames, deletedGames, selectedGame, editingGame,
    // Handlers
    handleAddGame, handleUpdateGame, handleUpdateMultiple,
    handleDeleteGame, handleRestoreGame, handlePermanentDelete,
    handleReorder, handleGameUidChange,
    handleGameBgUpload, handleGameBgRemove,
  };
}
