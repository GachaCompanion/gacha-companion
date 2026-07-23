import { useState, useEffect, useCallback, useRef } from 'react';

const EMPTY = { games: [] };

const isElectron = typeof window !== 'undefined' && !!window.api;

const UID_STATE_FIELDS = new Set([
  'pullLog', 'charPity', 'charGuaranteed', 'weaponPity', 'weaponGuaranteed',
  'chronicledPity', 'chronicledGuaranteed', 'fatePoints', 'chronicledFatePoints',
  'dailyPassActive', 'dailyPassLastClaimedAt',
  'currency', 'currentCurrency', 'pullItems', 'charPullItems', 'weaponPullItems',
  'goals', 'wishList', 'history', 'stats', 'lastSynced',
  'excelImported', 'jsonImported',
]);

function readLocal() {
  try {
    const raw = localStorage.getItem('gacha-tracker');
    return raw ? JSON.parse(raw) : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeLocal(data) {
  localStorage.setItem('gacha-tracker', JSON.stringify(data));
}

export function useStorage() {
  const [data, setData] = useState(EMPTY);
  const [ready, setReady] = useState(false);
  // Tracks the previously-saved games so save() can skip re-writing a game's
  // per-uid files when that specific game object hasn't changed — see save().
  const prevGamesRef = useRef(EMPTY.games);

  useEffect(() => {
    async function load() {
      if (isElectron) {
        // storage:read now returns fully assembled data (UID files merged in by main process)
        const result = await window.api.readStorage();
        setData(result || EMPTY);
      } else {
        setData(readLocal());
      }
      setReady(true);
    }
    load();
  }, []);

  const save = useCallback(async (newData) => {
    // Auto-assign uid='default' for any linked game that has no uid yet.
    const gamesWithUid = (newData.games ?? []).map(g =>
      (g.linkedDatabase && !g.uid) ? { ...g, uid: 'default' } : g
    );

    // Save new icons to files (only when iconFilename not yet set, i.e. freshly uploaded).
    // Keeps base64 iconPath in React state for display; strips it from user.json.
    // Skipped entirely (not just resolved-with-nothing-to-do) when no game actually
    // needs it — an unconditional `await Promise.all(...)` here, even one that
    // resolves near-instantly, still defers setData() below past a microtask
    // boundary. That's invisible for most callers, but the sidebar's (see
    // shared/components/sidebar/Sidebar.js) dnd-kit reorder handler wraps its
    // call into save() in ReactDOM.flushSync
    // specifically so the drop-animation math sees the reordered position
    // synchronously — a deferred setData made flushSync commit with the STALE
    // order instead, so the dragged item visibly snapped back to its old spot
    // before jumping to the real one a moment later once setData finally ran.
    const needsIconSave = isElectron && gamesWithUid.some(g => g.iconPath?.startsWith('data:') && !g.iconFilename);
    const processedGames = needsIconSave
      ? await Promise.all(gamesWithUid.map(async g => {
          if (!g.iconPath?.startsWith('data:') || g.iconFilename) return g;
          const result = await window.api.saveIcon(g.id, g.iconPath, g.name);
          if (!result?.ok) return g;
          return { ...g, iconFilename: result.filename };
        }))
      : gamesWithUid;

    const normalized = { ...newData, games: processedGames };
    setData(normalized);

    if (isElectron) {
      // Editing one game reuses the same object reference for every OTHER
      // game (see useTrackerState's handleUpdateGame — only the matching id
      // gets replaced). So diffing against the previous save's games by
      // reference tells us exactly which game(s) actually changed.
      const prevById = new Map(prevGamesRef.current.map(g => [g.id, g]));

      const leanGames = processedGames.map(g => {
        // Always strip runtime iconPath — stored as a file, not in user.json
        const { iconPath: _ip, ...gNoIcon } = g;

        if (!gNoIcon.uid || !gNoIcon.linkedDatabase) return gNoIcon;

        // apiBackup is intentionally kept out of configState/uidState and never
        // written to disk (see below) — it still lives in memory for the
        // current session (useGenshinSync.js etc. read/update game.state.apiBackup
        // as their working merge base) and gets recomputed fresh from the API
        // on the next sync regardless. pullLog itself is what matters long-term,
        // and that's independently protected by pullLogBackup.js's rotating
        // snapshots — apiBackup no longer needs its own persisted copy.
        const { apiBackup: _apiBackup, ...rest } = gNoIcon.state ?? {};
        const configState = {};
        const uidState    = {};
        for (const [k, v] of Object.entries(rest)) {
          if (UID_STATE_FIELDS.has(k)) uidState[k] = v;
          else configState[k] = v;
        }

        // Only re-write this game's per-uid files if it actually changed.
        // Every edit used to re-serialize + IPC-dispatch EVERY linked game's
        // full pull log unconditionally — ipcRenderer.invoke structured-clones
        // its arguments synchronously before the call returns, so re-sending
        // several games' worth of pull history on every toggle/keystroke was
        // a real (measured ~400-500ms) freeze, unrelated to disk I/O speed.
        const prevGame = prevById.get(g.id);
        if (prevGame !== g) {
          // Even for the one game that DID change, pullLog/history/stats can
          // still dwarf every other field — a currency or toggle edit
          // doesn't touch any of them. Omit whichever is unchanged from the
          // IPC payload; game:writeState merges onto the existing file
          // instead of overwriting, so the omitted field's on-disk value
          // survives. Fire-and-forget — write errors are non-fatal.
          const pullLogUnchanged = prevGame && g.state?.pullLog === prevGame.state?.pullLog;
          const historyUnchanged = prevGame && g.state?.history === prevGame.state?.history;
          const statsUnchanged   = prevGame && g.state?.stats   === prevGame.state?.stats;
          const omitFields = [
            ...(pullLogUnchanged ? ['pullLog'] : []),
            ...(historyUnchanged ? ['history'] : []),
            ...(statsUnchanged   ? ['stats']   : []),
          ];
          const uidStateToWrite = omitFields.length
            ? Object.fromEntries(Object.entries(uidState).filter(([k]) => !omitFields.includes(k)))
            : uidState;
          window.api.writeGameState(gNoIcon.linkedDatabase, gNoIcon.uid, uidStateToWrite);
        }

        return { ...gNoIcon, state: configState };
      });
      prevGamesRef.current = processedGames;
      await window.api.writeStorage({ ...normalized, games: leanGames });
    } else {
      writeLocal(normalized);
    }
  }, []);

  return { data, save, ready };
}
