// Every task the loading screen's progress bar waits on, with its weight (how
// much of the total bar it accounts for — bigger number = bigger visual chunk).
// This is the list to edit when adding/removing/reweighting a loading task —
// the actual running/progress-tracking logic lives in useLoadingTasks.js.
export const TASK_DEFS = [
  { id: 'genshin_banners', weight: 10 },
  { id: 'hsr_banners',     weight: 10 },
  { id: 'zzz_banners',     weight: 10 },
  { id: 'nte_banners',     weight: 10 },
  { id: 'wuwa_banners',    weight: 10 },
  { id: 'genshin_images',  weight: 12 },
  { id: 'hsr_images',      weight:  8 },
  { id: 'zzz_images',      weight:  8 },
  { id: 'nte_images',      weight:  4 },   // NTE's roster is much smaller than the others' (~67 images total)
  { id: 'wuwa_images',     weight:  8 },   // WuWa's full roster (56 characters + 128 weapons) via nanoka.cc
  { id: 'enka_hsr',        weight:  8 },   // showcase character definitions (off lazy-load)
  { id: 'live2d_hsr',      weight: 40 },   // download + frame every HSR Live2D (slow on first run)
  { id: 'live2d_zzz',      weight: 40 },   // download + frame every ZZZ Live2D (slow on first run)
  { id: 'char_images_zzz', weight:  8 },   // download + crop ZZZ character background images
  { id: 'char_icons_zzz',  weight:  8 },   // download + top-crop ZZZ character portrait icons
  { id: 'char_images_hsr', weight:  8 },   // download + crop HSR character background images (nanoka)
  { id: 'char_lc_hsr',     weight:  6 },   // download + crop HSR light cone art images (nanoka)
  { id: 'game_fonts',      weight:  5 },   // per-game auto-detected font (see hooks/useGameFont.js)
];

// Video readiness tasks are dynamic — one per background video file actually in
// use (app background + any per-game backgrounds), so they're built separately
// from the static list above and merged in by useLoadingTasks.
export function buildVideoTaskDefs(videoFilenames) {
  return videoFilenames.map(f => ({ id: `video_${f}`, weight: 8 }));
}
