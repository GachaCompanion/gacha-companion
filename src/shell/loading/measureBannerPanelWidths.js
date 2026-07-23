// Measures how wide each game's banner panel needs to be to fit its longest
// banner name + version text, using an offscreen canvas (so it matches the
// real rendered font's metrics instead of guessing a fixed width). Used once
// per loading pass by useLoadingTasks, after banner schedules are fetched.
export function measureBannerPanelWidths(schedules) {
  const canvas = document.createElement('canvas');
  const ctx    = canvas.getContext('2d');
  ctx.font     = 'bold 11px Lato, sans-serif';
  const IMAGE_W        = 25;
  const INFO_PAD       = 16;
  const NAME_VER_GAP   = 16;
  const PANEL_OVERHEAD = 22;
  const SAFETY         = 10;
  const result = {};
  for (const [game, schedule] of Object.entries(schedules)) {
    let maxText = 0;
    for (const entry of (schedule ?? [])) {
      const nameW = ctx.measureText(entry.name ?? '').width;
      const verW  = entry.version ? ctx.measureText(entry.version).width + NAME_VER_GAP : 0;
      const w = nameW + verW;
      if (w > maxText) maxText = w;
    }
    result[game] = Math.ceil(IMAGE_W * 2 + INFO_PAD + maxText + PANEL_OVERHEAD + SAFETY);
  }
  return result;
}
