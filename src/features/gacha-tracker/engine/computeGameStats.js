// ─── Computed pull-log stats (stats.json) ──────────────────────────────────────
// Game-agnostic — groups purely by each pull's own `.banner` string, so it
// works unmodified across every game's differently-named banners (Genshin/HSR/
// ZZZ's character+weapon pair, NTE's character-limited/character-standard/arc,
// WuWa's resonator+weapon, ...). See useTrackerState.js for where this gets
// invoked (only when a game's pullLog reference actually changes) and
// electron/main.js for where the result is persisted (its own stats.json,
// same split as pullLog.json/history.json).

// 50/50 is specifically the literal `.banner === 'character'` group — NOT
// every character-type pull game-wide. Genshin's Chronicled Wish
// (`.banner === 'chronicled'`) is a real, separate limited banner with its
// own independent 50/50 track; folding it in inflated the combined count
// past what a banner-scoped reference (e.g. Paimon.moe's own character-
// banner-only figures) shows. `.type` was tried here first and was wrong
// for the same reason — it's genuinely broader than "the character banner".
function fiftyFiftyFor(pulls) {
  const fiveStars = pulls.filter(p => p.rarity === 5);
  const won  = fiveStars.filter(p => p.won5050 === 'won'  || p.won5050 === true).length;
  const lost = fiveStars.filter(p => p.won5050 === 'lost' || p.won5050 === false).length;
  const guaranteed = fiveStars.filter(p => p.won5050 === 'guaranteed').length;
  return { won, lost, guaranteed, rate: (won + lost) > 0 ? won / (won + lost) : null };
}

function statsForBannerGroup(pulls) {
  // Sort ascending by roll (recomputeRolls in pullUtils.js already assigns
  // these sequentially per banner) — pity/streak math only makes sense in
  // actual pull order, and roll is the stable, already-tie-broken ordering
  // the rest of the app uses for the same purpose.
  const sorted = pulls.slice().sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0));

  const count5 = sorted.filter(p => p.rarity === 5).length;
  const count4 = sorted.filter(p => p.rarity === 4).length;

  // 5-star pity: gap (in rolls) since the previous 5-star, or since the
  // start of the log for the very first one.
  const fiveStarGaps = [];
  let lastFive = 0;
  for (const p of sorted) {
    if (p.rarity !== 5) continue;
    fiveStarGaps.push((p.roll ?? 0) - lastFive);
    lastFive = p.roll ?? 0;
  }

  // 4-star pity resets on EITHER a 4-star or a 5-star pull (standard gacha
  // convention — a 5-star still occupies that pull's "slot", so it resets
  // the 4-star guarantee counter too, it just isn't itself counted as a
  // completed 4-star draw).
  const fourStarGaps = [];
  let lastFourOrFive = 0;
  for (const p of sorted) {
    if (p.rarity !== 4 && p.rarity !== 5) continue;
    const gap = (p.roll ?? 0) - lastFourOrFive;
    if (p.rarity === 4) fourStarGaps.push(gap);
    lastFourOrFive = p.roll ?? 0;
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    totalPulls: sorted.length,
    count5,
    count4,
    avg5StarPity: avg(fiveStarGaps),
    avg4StarPity: avg(fourStarGaps),
    // Kept per-banner for completeness/debugging, but no longer what the UI
    // actually reads for 50/50 — see characterFiftyFifty below and its
    // comment on fiftyFiftyFor for why grouping this by `.banner` isn't
    // reliable across every game.
    fiftyFifty: fiftyFiftyFor(sorted),
  };
}

// Sums several banners' worth of statsForBannerGroup-shaped stats back into
// one combined view — used for the `combined` key below, added purely as a
// convenience for a consumer that just wants one number for the whole game
// rather than picking through individual banners itself.
function combineStats(perBanner) {
  const all = Object.values(perBanner);
  if (all.length === 0) {
    return { totalPulls: 0, count5: 0, count4: 0, avg5StarPity: null, avg4StarPity: null, fiftyFifty: { won: 0, lost: 0, guaranteed: 0, rate: null } };
  }
  const sum = key => all.reduce((a, s) => a + s[key], 0);
  const won  = all.reduce((a, s) => a + s.fiftyFifty.won,  0);
  const lost = all.reduce((a, s) => a + s.fiftyFifty.lost, 0);
  const guaranteed = all.reduce((a, s) => a + s.fiftyFifty.guaranteed, 0);
  // Pity averages are weighted by how many 5-star/4-star pulls actually
  // fed into each banner's average, not a flat mean-of-means — a banner
  // with 40 five-stars shouldn't count the same as one with 2.
  const weightedAvg = (pityKey, countKey) => {
    let totalWeight = 0, totalSum = 0;
    for (const s of all) {
      if (s[pityKey] == null) continue;
      totalWeight += s[countKey];
      totalSum += s[pityKey] * s[countKey];
    }
    return totalWeight > 0 ? totalSum / totalWeight : null;
  };
  return {
    totalPulls: sum('totalPulls'),
    count5: sum('count5'),
    count4: sum('count4'),
    avg5StarPity: weightedAvg('avg5StarPity', 'count5'),
    avg4StarPity: weightedAvg('avg4StarPity', 'count4'),
    fiftyFifty: { won, lost, guaranteed, rate: (won + lost) > 0 ? won / (won + lost) : null },
  };
}

export function computeGameStats(pullLog) {
  const log = pullLog ?? [];

  const byBanner = {};
  for (const p of log) {
    if (!byBanner[p.banner]) byBanner[p.banner] = [];
    byBanner[p.banner].push(p);
  }
  const perBanner = {};
  for (const [banner, pulls] of Object.entries(byBanner)) {
    perBanner[banner] = statsForBannerGroup(pulls);
  }

  // The one true 50/50 rate — literally the 'character' banner group, and
  // nothing else. See fiftyFiftyFor's comment for why this can't be
  // widened to "every character-type pull" (Chronicled Wish, etc.).
  const characterFiftyFifty = fiftyFiftyFor(byBanner.character ?? []);

  return { combined: combineStats(perBanner), byBanner: perBanner, characterFiftyFifty };
}
