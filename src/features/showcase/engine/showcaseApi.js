// Generic enka.network fetch layer — zero game-specific logic here.
// In Electron, requests route through the main process via window.api.fetchEnkaUid
// to avoid renderer-process network restrictions.

export class ShowcaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'ShowcaseError';
  }
}

function throwForStatus(status) {
  switch (status) {
    case 400: throw new ShowcaseError('invalid_uid',  'Invalid UID format.');
    case 404: throw new ShowcaseError('not_found',    'Player not found.');
    case 424: throw new ShowcaseError('maintenance',  'Game is under maintenance.');
    case 429: throw new ShowcaseError('rate_limited', 'Too many requests. Please wait a moment.');
    case 500: throw new ShowcaseError('server_error', 'Enka server error. Try again later.');
    case 503: throw new ShowcaseError('server_error', 'Enka service unavailable. Try again later.');
    default:
      if (status !== 0 && (status < 200 || status >= 300)) {
        throw new ShowcaseError('server_error', `Unexpected error (${status}).`);
      }
  }
}

export async function fetchEnkaUid(uid) {
  return fetchEnkaByGame(uid, 'genshin');
}

function parseIpcResult(result) {
  if (!result.ok) {
    throwForStatus(result.status);
    throw new ShowcaseError('network', result.error ?? 'Network error.');
  }
  return JSON.parse(result.body);
}

export async function fetchEnkaByGame(uid, game) {
  if (typeof window !== 'undefined') {
    // Preferred: multi-game IPC (requires updated preload)
    if (window.api?.fetchEnka) {
      return parseIpcResult(await window.api.fetchEnka(uid, game));
    }
    // Legacy: Genshin-only IPC (old preload without fetchEnka)
    if (game === 'genshin' && window.api?.fetchEnkaUid) {
      return parseIpcResult(await window.api.fetchEnkaUid(uid));
    }
  }

  // Browser / dev fallback
  const gamePathMap = {
    genshin: `https://enka.network/api/uid/${uid}/`,
    hsr:     `https://enka.network/api/hsr/uid/${uid}/`,
    zzz:     `https://enka.network/api/zzz/uid/${uid}/`,
  };
  const url = gamePathMap[game];
  if (!url) throw new ShowcaseError('network', `Unknown game: ${game}`);
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ShowcaseError('network', 'Network error. Check your connection.');
  }
  throwForStatus(res.status);
  return res.json();
}
