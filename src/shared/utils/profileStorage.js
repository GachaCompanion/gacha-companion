// Scopes a localStorage key to the active profile, so per-profile UI prefs
// (last-used showcase UIDs, HSR card mode/dimension, etc.) don't leak across
// profiles — localStorage itself is shared across all profiles, only
// storage/profiles/<uuid>/user.json is actually profile-separated.
// Profile switches always relaunch the app (see electron/main.js), so
// there's no need to react to activeProfileId changing at runtime — it's
// only ever read once per app session.
let _activeProfileIdPromise = null;

export function getActiveProfileId() {
  if (!_activeProfileIdPromise) {
    _activeProfileIdPromise = (async () => {
      try {
        const res = await window.api?.listProfiles();
        return res?.activeProfileId ?? 'default';
      } catch {
        return 'default';
      }
    })();
  }
  return _activeProfileIdPromise;
}

export function scopedKey(baseKey, profileId) {
  return `${baseKey}::${profileId}`;
}
