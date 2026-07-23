// Single source of truth for every font the app uses:
//   1) DEFAULT_FONT_FAMILY / DEFAULT_FONT_WEIGHT — the app-wide default (Lato Bold 700).
//      Mirrored in src/index.css (--font-ui / --font-mono), public/index.html (#pre-title),
//      electron/already-running.html, and the canvas measurement in src/App.js. If the
//      default ever changes, update all of those alongside this constant.
//   2) Per-game auto-detected "real" game font — reads the actual character/UI font
//      straight out of a game's own install folder (StreamingAssets\...\font\<locale>.ttf),
//      IF that game is installed. Nothing is ever bundled/shipped/redistributed — this
//      only ever reads a file that's already sitting on the user's own machine because
//      they installed the game themselves, same file whether it's on C:, D:, F:, wherever.
//      Locale is per-game (see GAME_FONT_CONFIG.locale): Genshin/HSR don't ship an
//      English-specific font file in that folder at all (only CJK supplements), and
//      zh-cn.ttf's glyph set covers Latin/English text fine there (verified locally) — but
//      ZZZ does ship a proper en-us.ttf, which renders Latin text better than its zh-cn.ttf
//      (also verified locally), so ZZZ uses that instead.
//
// Detection has no fixed install-path dependency: each game writes a startup log to a
// FIXED per-user location (AppData\LocalLow\...), and Unity itself logs at least one line
// early on referencing the game's own "<Name>_Data" folder in an absolute path — we read
// that path back out of the log, regardless of what drive/folder the user installed to.
// (Older Unity builds like Genshin's 2017.4.30f1 don't log the "[Subsystems] Discovering
// subsystems" line newer engines do, so we search for the "_Data" folder reference instead
// — that line is present in all 3 games' logs, so one method covers all of them.)
//
// Font files are large (Genshin/HSR ~11-12MB, ZZZ ~1.6MB) so they're served over the local
// HTTP server (see startFontServer, same pattern as the background/Live2D/showcases servers
// in main.js) and streamed straight from disk — never base64'd through IPC.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const DEFAULT_FONT_FAMILY = 'Lato';
const DEFAULT_FONT_WEIGHT = 700;

const LOCALLOW = path.join(os.homedir(), 'AppData', 'LocalLow');

// Per-game: candidate startup log files (tried in order — first one that exists AND
// yields a valid, still-present font file wins), the game's own "<Name>_Data" folder
// name (used both to find the install root in the log text and to rebuild the font
// path), and which locale file to grab from StreamingAssets\...\font\ (see comment above).
const GAME_FONT_CONFIG = {
  genshin: {
    logCandidates: [path.join(LOCALLOW, 'miHoYo', 'Genshin Impact', 'output_log.txt')],
    dataFolderName: 'GenshinImpact_Data',
    locale: 'zh-cn',
  },
  hsr: {
    logCandidates: [
      path.join(LOCALLOW, 'Cognosphere', 'Star Rail', 'Player.log'),
      path.join(LOCALLOW, 'Cognosphere', 'Star Rail', 'Player-prev.log'),
    ],
    dataFolderName: 'StarRail_Data',
    locale: 'zh-cn',
  },
  zzz: {
    logCandidates: [
      path.join(LOCALLOW, 'miHoYo', 'ZenlessZoneZero', 'Player.log'),
      path.join(LOCALLOW, 'miHoYo', 'ZenlessZoneZero', 'Player-prev.log'),
    ],
    dataFolderName: 'ZenlessZoneZero_Data',
    locale: 'en-us',
  },
};

const FONT_SUBPATH = ['StreamingAssets', 'MiHoYoSDKRes', 'HttpServerResources', 'font'];

// Only the log's first LOG_PEEK_BYTES are read — these logs can grow to tens of MB over
// a play session, so reading the whole file would be wasteful. 64KB seemed like plenty
// (HSR/ZZZ's "_Data" folder reference shows up within the first few hundred bytes) until
// Genshin: its log writes one huge single-line JSON blob (a download-prefs dump) near the
// very top that alone pushes past 64KB, so its first "_Data" reference doesn't show up
// until ~byte 97,000 — 512KB gives comfortable headroom over that without reading the
// whole (often 1MB-38MB+) file.
const LOG_PEEK_BYTES = 524288;

// Reads the start of a (potentially huge) log file without loading the whole thing.
function peekFile(filePath, maxBytes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = Math.min(fs.fstatSync(fd).size, maxBytes);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// Pulls the game's real install root out of a log line referencing its "_Data" folder,
// e.g. ".../DeserializeBinary (F:/Program Files/Star Rail/Games/StarRail_Data/...)"
// -> "F:\Program Files\Star Rail\Games". Handles both "/" and "\" path separators.
function extractInstallRoot(logText, dataFolderName) {
  const re = new RegExp(`([A-Za-z]:[\\\\/][^"'\\r\\n]*?)[\\\\/]${dataFolderName}\\b`, 'i');
  const match = logText.match(re);
  if (!match) return null;
  return match[1].replace(/\//g, path.sep);
}

// gameId -> Promise<absolutePath|null>, cached for the app's lifetime once resolved —
// re-reading a log + stat'ing a file is cheap, but there's no reason to redo it every
// time a Showcase card or Tracker screen for the same game asks.
const _fontPathCache = {};

function resolveGameFontPath(gameId) {
  if (_fontPathCache[gameId]) return _fontPathCache[gameId];

  const config = GAME_FONT_CONFIG[gameId];
  if (!config) return Promise.resolve(null);

  _fontPathCache[gameId] = (async () => {
    for (const logPath of config.logCandidates) {
      if (!fs.existsSync(logPath)) continue;
      let installRoot;
      try {
        const logText = peekFile(logPath, LOG_PEEK_BYTES);
        installRoot = extractInstallRoot(logText, config.dataFolderName);
      } catch (_) {
        continue;
      }
      if (!installRoot) continue;

      const fontPath = path.join(installRoot, config.dataFolderName, ...FONT_SUBPATH, `${config.locale}.ttf`);
      if (fs.existsSync(fontPath)) return fontPath;
    }
    return null;
  })();

  return _fontPathCache[gameId];
}

// Local-only HTTP server (127.0.0.1, OS-assigned port) that streams a resolved game font
// by id — GET /genshin.ttf, /hsr.ttf, /zzz.ttf. Same rationale as startBgServer in main.js:
// a real HTTP response (vs. a custom Electron protocol) is the simplest way to hand the
// browser a font URL, and streaming from disk avoids holding an 11-12MB buffer in memory.
function startFontServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const gameId = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.replace(/^\/|\.ttf$/g, ''));
        const fontPath = await resolveGameFontPath(gameId);
        if (!fontPath || !fs.existsSync(fontPath)) {
          res.writeHead(404); res.end(); return;
        }
        const stat = fs.statSync(fontPath);
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'font/ttf',
          'Content-Length': stat.size,
          'Cache-Control': 'no-cache', // game could be (un)installed between launches
        });
        fs.createReadStream(fontPath).pipe(res);
      } catch (_) {
        try { res.writeHead(500); res.end(); } catch (__) {}
      }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

module.exports = {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_WEIGHT,
  resolveGameFontPath,
  startFontServer,
};
