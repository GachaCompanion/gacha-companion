// All enka CDN URL construction lives here.
// Components must never hardcode enka paths directly.

const CDN = 'https://enka.network/ui';

// ── Genshin ───────────────────────────────────────────────────────────────────
// iconName can be a bare asset name ("UI_AvatarIcon_Hutao") or a full path
// from gi/avatars.json ("/ui/UI_AvatarIcon_Side_Hutao.png").
export function enkaAsset(iconName) {
  if (!iconName || iconName === 'None') return null;
  if (iconName.startsWith('/ui/')) return `https://enka.network${iconName}`;
  return `${CDN}/${iconName}.png`;
}
