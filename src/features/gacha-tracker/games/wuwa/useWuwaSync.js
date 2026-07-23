import { processWuwaApiPulls, enrichWuwaApiPulls, WUWA_CARD_POOL_TYPE, WUWA_STANDARD_WEAPON_CARD_POOL_TYPE } from './wuwaImport';
import { appendNewPulls, recomputeRolls } from '../../engine/pullUtils';

// Kuro's gacha API returns each banner's FULL history in a single call (no
// pagination, no cursor) — unlike miHoYo's cursor-paginated API, so there's
// no cutoffId/pageDelay-per-page loop here, just one request per banner.
export function useWuwaSync({ setSyncState, syncCancelRef, handleUpdateGame, gamesRef }) {
  const BANNER_TYPES = [
    { banner: 'character', label: 'Featured Resonator',    cardPoolType: WUWA_CARD_POOL_TYPE.character },
    { banner: 'weapon',    label: 'Featured Weapon',       cardPoolType: WUWA_CARD_POOL_TYPE.weapon },
    { banner: 'standard3', label: 'Standard Resonator', cardPoolType: WUWA_CARD_POOL_TYPE.standard },
    { banner: 'standard4', label: 'Standard Weapon',    cardPoolType: WUWA_STANDARD_WEAPON_CARD_POOL_TYPE },
  ];
  const delay = ms => new Promise(r => setTimeout(r, ms));

  async function handleStartWuwaSync(game) {
    syncCancelRef.current = false;

    function ifCancelled() {
      if (syncCancelRef.current) {
        setSyncState({ running: false, gameId: null, statusType: null, statusText: null });
        return true;
      }
      return false;
    }

    setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: 'Retrieving Convene History URL… (open Convene History in-game first)' });

    try {
      const logResult = await window.api.readWuwaLog();
      if (ifCancelled()) return;
      if (!logResult.ok) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: logResult.error });
        return;
      }

      const { url } = logResult;

      await delay(1000);
      if (ifCancelled()) return;

      const results = {};
      let totalPulls = 0;

      for (const { banner, label, cardPoolType } of BANNER_TYPES) {
        if (ifCancelled()) return;
        setSyncState({ running: true, gameId: game.id, statusType: 'loading', statusText: `Fetching ${label} banner…` });
        const r = await window.api.fetchWuwaGachaLog(url, cardPoolType);
        if (ifCancelled()) return;
        if (!r.ok) {
          setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: r.error });
          return;
        }
        results[banner] = r.pulls ?? [];
        totalPulls += r.pulls?.length ?? 0;
        await delay(300);
        if (ifCancelled()) return;
      }

      // Read the freshest game right before merging/saving, not the snapshot
      // passed in when the sync started. A multi-second sync (network calls +
      // delays) leaves plenty of time for an import or another sync to land
      // in the meantime; reusing a stale `game.state.pullLog` here would
      // silently overwrite that newer data with this sync's stale base.
      const freshGame    = gamesRef?.current?.find(g => g.id === game.id) ?? game;
      const existingLog  = freshGame.state.pullLog ?? [];

      // Fetched before processWuwaApiPulls (not after, as before) so the
      // schedule is available to it as a weapon/character classification
      // source — see normalizeWuwaResourceType's schedule tier in
      // wuwaImport.js — needed to type newly-released featured content
      // correctly on the very sync that first fetches it.
      const wuwaScheduleFetch = await window.api.fetchWuwaBanners().catch(() => ({ ok: false, bannerSchedule: [] }));
      const wuwaSchedule      = wuwaScheduleFetch.ok ? (wuwaScheduleFetch.bannerSchedule ?? []) : [];

      const processed = processWuwaApiPulls(
        results.character ?? [],
        results.weapon ?? [],
        results.standard3 ?? [],
        results.standard4 ?? [],
        existingLog,
        wuwaSchedule,
      );

      const merged     = appendNewPulls(existingLog, processed.pullLog);
      const enriched   = enrichWuwaApiPulls(merged, wuwaSchedule);
      const finalLog   = recomputeRolls(enriched);
      const newCount   = merged.length - existingLog.length;
      const lastSynced = new Date().toISOString();

      handleUpdateGame({
        ...freshGame,
        state: {
          ...freshGame.state,
          pullLog:    finalLog,
          charPity:   processed.charPity,
          weaponPity: processed.weaponPity,
          lastSynced,
        },
      });

      const countText = newCount > 0 ? `${newCount} new pull${newCount === 1 ? '' : 's'}` : 'already up to date';
      setSyncState({ running: false, gameId: game.id, statusType: 'success', statusText: `Sync complete — ${countText}` });

    } catch (err) {
      if (!syncCancelRef.current) {
        setSyncState({ running: false, gameId: game.id, statusType: 'error', statusText: err.message });
      }
    }
  }

  return { handleStartWuwaSync };
}
