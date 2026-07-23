import { processHsrApiPulls, enrichHsrApiPulls } from './hsrImport';
import { appendNewPulls, recomputeRolls } from '../../engine/pullUtils';
import { parseUid } from '../../engine/uidUtils';

export function useHsrSync({ setSyncState, syncCancelRef, handleUpdateGame, activeRequestIdRef }) {
  const GACHA_TO_BANNER = {
    '11': 'character', '12': 'weapon', '1': 'standard', '2': 'beginner',
    '21': 'charCollab', '22': 'weaponCollab',
  };
  const BANNER_TYPES = [
    { type: '11', label: 'Character'  },
    { type: '12', label: 'Light Cone' },
    { type: '1',  label: 'Stellar'    },
    { type: '2',  label: 'Departure'  },
  ];
  // Collaboration banners (Saber/Archer, Rin Tohsaka/Gilgamesh, etc.) live on
  // a genuinely separate HoYoverse endpoint (getLdGachaLog, captured as
  // logResult.collabUrl by hsr:readLog) — only fetched when that URL was
  // actually found, since the player only needs to have visited that tab
  // in-game once, not every sync. See project_hsr_dat_export memory.
  const COLLAB_BANNER_TYPES = [
    { type: '21', label: 'Character Collab'  },
    { type: '22', label: 'Light Cone Collab' },
  ];
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function handleStartHsrSync(game) {
    syncCancelRef.current = false;
    const requestId = crypto.randomUUID();
    if (activeRequestIdRef) activeRequestIdRef.current = requestId;

    function ifCancelled() {
      if (syncCancelRef.current) {
        setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
        return true;
      }
      return false;
    }

    setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: 'Retrieving warp URL… (open your Warp History in-game first)' });

    try {
      const logResult = await window.api.readHsrLog();
      if (ifCancelled()) return;
      if (!logResult.ok) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: logResult.error });
        return;
      }

      const { url } = logResult;
      // hsr:readLog now looks for BOTH the normal wish-history URL and the
      // separate collab-banner one (getLdGachaLog) — see project_hsr_dat_export
      // memory for why they're distinct. Collab syncing isn't wired up yet
      // (logResult.collabUrl is currently unused), so if the player's last
      // visited screen in-game was the collab tab specifically, `url` comes
      // back null and we still need to ask them to visit the normal screen.
      if (!url) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: 'Open Star Rail and visit your normal Warp History (not the collaboration banner), then try again.' });
        return;
      }
      const existingLog = game.state.pullLog ?? [];
      const apiBackup   = game.state.apiBackup ?? [];
      const workingLog  = appendNewPulls([...apiBackup], existingLog);

      const latestIdByBanner = {};
      for (const p of workingLog) {
        if (!p.id || p.source !== 'api') continue;
        if (!latestIdByBanner[p.banner] || p.id > latestIdByBanner[p.banner])
          latestIdByBanner[p.banner] = p.id;
      }

      await delay(2000);
      if (ifCancelled()) return;

      const results   = {};
      let totalPulls  = 0;
      let currentLabel = '';

      const unsubProgress = window.api.onFetchProgress(({ count }) => {
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${currentLabel} banner… (${totalPulls + count} pulls so far)` });
      });

      for (const { type, label } of BANNER_TYPES) {
        if (ifCancelled()) { unsubProgress(); return; }
        currentLabel = label;
        const cutoffId = latestIdByBanner[GACHA_TO_BANNER[type]] ?? null;
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${label} banner… (${totalPulls} pulls so far)` });
        const r = await window.api.fetchWishHistory(url, type, null, { pageDelay: '300', cutoffId, requestId });
        if (ifCancelled()) { unsubProgress(); return; }
        if (!r.ok) {
          unsubProgress();
          setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: r.error });
          return;
        }
        results[type] = r;
        totalPulls += r.pulls?.length ?? 0;
        await delay(2000);
        if (ifCancelled()) { unsubProgress(); return; }
      }

      // Collab banners only if the player visited that tab in-game this
      // session (collabUrl found) — not required every sync.
      if (logResult.collabUrl) {
        for (const { type, label } of COLLAB_BANNER_TYPES) {
          if (ifCancelled()) { unsubProgress(); return; }
          currentLabel = label;
          const cutoffId = latestIdByBanner[GACHA_TO_BANNER[type]] ?? null;
          setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${label} banner… (${totalPulls} pulls so far)` });
          const r = await window.api.fetchWishHistory(logResult.collabUrl, type, null, { pageDelay: '300', cutoffId, requestId });
          if (ifCancelled()) { unsubProgress(); return; }
          if (!r.ok) {
            unsubProgress();
            setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: r.error });
            return;
          }
          results[type] = r;
          totalPulls += r.pulls?.length ?? 0;
          await delay(2000);
          if (ifCancelled()) { unsubProgress(); return; }
        }
      }

      unsubProgress();

      const scheduleFetch  = await window.api.fetchHsrBanners().catch(() => ({ ok: false, bannerSchedule: [] }));
      const bannerSchedule = scheduleFetch.ok ? (scheduleFetch.bannerSchedule ?? []) : [];

      const processed = processHsrApiPulls(
        results['11']?.pulls ?? [],
        results['12']?.pulls ?? [],
        results['1']?.pulls  ?? [],
        results['2']?.pulls  ?? [],
        workingLog,
        results['21']?.pulls ?? [],
        results['22']?.pulls ?? [],
      );

      const { serverOffset: derivedOffset } = parseUid(game.uid ?? '', 'hsr');
      const serverOffset = derivedOffset ?? game.state.serverOffset ?? 8;

      const merged       = appendNewPulls(workingLog, processed.pullLog);
      const enriched     = enrichHsrApiPulls(merged, bannerSchedule, serverOffset);
      const finalLog     = recomputeRolls(enriched);
      const newApiBackup = appendNewPulls(apiBackup, processed.pullLog.filter(p => p.source === 'api'));
      const lastSynced   = new Date().toISOString();

      handleUpdateGame({
        ...game,
        state: {
          ...game.state,
          serverOffset,
          pullLog:    finalLog,
          apiBackup:  newApiBackup,
          charPity:         processed.charPity,
          weaponPity:       processed.weaponPity,
          charCollabPity:   processed.charCollabPity,
          weaponCollabPity: processed.weaponCollabPity,
          lastSynced,
        },
      });

      const newCount = totalPulls > 0 ? `${totalPulls} new pull${totalPulls === 1 ? '' : 's'}` : 'already up to date';
      setSyncState({ running: false, gameId: game.id, statusType: 'success', statusText: `Sync complete — ${newCount}` });

    } catch (err) {
      if (!syncCancelRef.current) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: err.message });
      }
    }
  }

  return { handleStartHsrSync };
}
