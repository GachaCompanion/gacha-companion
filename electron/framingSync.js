// Downloads pre-computed framing data from GitHub releases on app startup.
// Compares the remote version to the local one; downloads only when newer.
// Writes to the same framing.json path that live2d.js reads (Live2D) or that
// pngFraming.js reads (PNG).

const fs   = require('fs');
const path = require('path');

const RELEASE_BASE = 'https://github.com/GachaCompanion/gc-data/releases/download/framing-data';
const GAMES     = ['hsr', 'zzz']; // Live2D — both games
const PNG_GAMES = ['hsr'];        // PNG — HSR only; ZZZ has its own separate, working approach

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Shared by both passes below — each game's version is checked independently
// (never against another game's number, or another pass's version file), so
// one game/pass being ahead can never mask another needing an update.
async function syncOne({ label, games, versionUrl, fileUrl, destPath }) {
  let remote;
  try {
    remote = await fetchJson(versionUrl);
  } catch (e) {
    console.log(`[framingSync] ${label} version check failed (offline?): ${e.message}`);
    return;
  }

  for (const game of games) {
    const localPath = destPath(game);
    let localVersion = 0;
    try {
      const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      localVersion = local.version ?? 0;
    } catch {}

    const remoteVersion = remote[game] ?? 0;
    if (remoteVersion <= localVersion) {
      console.log(`[framingSync] ${label} ${game} up to date (v${localVersion})`);
      continue;
    }

    try {
      console.log(`[framingSync] ${label} ${game} downloading v${remoteVersion} (have v${localVersion})`);
      const data = await fetchJson(fileUrl(game));
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, JSON.stringify({ ...data, version: remoteVersion }));
      console.log(`[framingSync] ${label} ${game} updated to v${remoteVersion}`);
    } catch (e) {
      console.warn(`[framingSync] ${label} ${game} download failed: ${e.message}`);
    }
  }
}

async function syncFraming(live2dDir, pngDir) {
  await syncOne({
    label:      'live2d',
    games:      GAMES,
    versionUrl: `${RELEASE_BASE}/framing_version.json`,
    fileUrl:    (game) => `${RELEASE_BASE}/framing_${game}.json`,
    destPath:   (game) => path.join(live2dDir, game, 'framing.json'),
  });

  if (pngDir) {
    await syncOne({
      label:      'png',
      games:      PNG_GAMES,
      versionUrl: `${RELEASE_BASE}/framing_version_png.json`,
      fileUrl:    (game) => `${RELEASE_BASE}/framing_${game}_png.json`,
      destPath:   (game) => path.join(pngDir, game, 'framing.json'),
    });
  }
}

module.exports = { syncFraming };
