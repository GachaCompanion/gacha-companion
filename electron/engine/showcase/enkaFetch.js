// Uses Node 18+ built-in fetch (available in Electron 28).
// Handles redirects and sends browser-like headers automatically.

const BASE = 'https://enka.network/api';
const UA   = 'GachaCompanion/1.0';

const GAME_PATH = {
  genshin: uid => `${BASE}/uid/${uid}/`,
  hsr:     uid => `${BASE}/hsr/uid/${uid}/`,
  zzz:     uid => `${BASE}/zzz/uid/${uid}/`,
};

async function fetchByGame(uid, game = 'genshin') {
  const urlFn = GAME_PATH[game];
  if (!urlFn) throw new Error(`Unknown game: ${game}`);
  const res = await fetch(urlFn(uid), {
    headers: { 'User-Agent': UA, 'Accept': 'application/json' },
  });
  return { status: res.status, body: await res.text() };
}

// Keep legacy export for backward compat
async function fetchEnkaUid(uid) { return fetchByGame(uid, 'genshin'); }

module.exports = { fetchEnkaUid, fetchByGame };
