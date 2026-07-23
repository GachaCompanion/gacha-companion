// Whitelist of released character/weapon IDs for nanoka.cc downloads, built from
// HoYoverse's own banner-schedule data (see dataRepo.js / bannerFetch.js). nanoka
// sometimes lists datamined/unreleased characters before they've officially
// shipped — this gates hsr/zzz nanoka fetches (live2d.js, charImages.js) so we
// only ever download content HoYoverse has actually released.
const fs = require('fs');
const path = require('path');

const _dirs = {};   // game -> cache dir, set once via init()
const _cache = {};  // game -> Set<string> | null

function init(dirs) { Object.assign(_dirs, dirs); }

function load(game) {
  const dir = _dirs[game];
  if (!dir) return null;
  try {
    const schedule = JSON.parse(fs.readFileSync(path.join(dir, `banner-schedule-${game}.json`), 'utf-8'));
    const now = Date.now();
    const ids = new Set();
    for (const b of schedule) {
      if (b.featuredId == null) continue;
      const start = b.start ? Date.parse(b.start.replace(' ', 'T') + 'Z') : NaN;
      if (!Number.isNaN(start) && start > now) continue; // pre-announced, not live yet
      ids.add(String(b.featuredId));
    }
    return ids;
  } catch {
    return null;
  }
}

// Call after a fresh banner-schedule download so the whitelist picks it up
// immediately instead of waiting for the next app restart.
function refresh(game) { _cache[game] = load(game); }

function isReleased(game, id) {
  if (!(game in _cache)) _cache[game] = load(game);
  const set = _cache[game];
  if (!set) return false; // no schedule on disk yet — nothing to sync until it loads
  return set.has(String(id));
}

module.exports = { init, refresh, isReleased };
