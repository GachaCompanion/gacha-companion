// NTE character banner: base 0.99%, soft pity from pull 70, hard pity 90, no 50/50 —
// every S-Class pull on this banner is the featured character.
// NTE hasn't published an exact per-pull soft-pity increment (unlike HSR/ZZZ's
// documented 6%/7%), so this uses a linear ramp calibrated to reach exactly
// 100% at hard pity — the same shape as the other games' curves, just without
// a community-researched exact coefficient behind it.
const CHAR_BASE_RATE = 0.0099;
const CHAR_SOFT_PITY = 70;
const CHAR_HARD_PITY = 90;
const CHAR_INCREMENT = (1 - CHAR_BASE_RATE) / (CHAR_HARD_PITY - CHAR_SOFT_PITY + 1);

// NTE Arc (weapon) banner: base 3%, soft pity from pull 60, hard pity 80.
// Featured chance 25%, and — unlike HSR/ZZZ's weapon banners — a loss does
// NOT set a guarantee for the next S-Class Arc. Every S-Class pull on this
// banner independently re-rolls the 25% featured chance, so it's possible
// (if unlucky) to hit several different non-featured S-Class Arcs in a row
// before landing the featured one. Confirmed by the user; there is no
// "Guaranteed" state to track or toggle for this banner at all.
const ARC_BASE_RATE = 0.03;
const ARC_SOFT_PITY = 60;
const ARC_HARD_PITY = 80;
const ARC_INCREMENT = (1 - ARC_BASE_RATE) / (ARC_HARD_PITY - ARC_SOFT_PITY + 1);
const ARC_FEATURED_RATE = 0.25;

function getCharRate(pity) {
  return Math.min(1.0, CHAR_BASE_RATE + CHAR_INCREMENT * Math.max(0, pity - (CHAR_SOFT_PITY - 1)));
}

function getArcRate(pity) {
  return Math.min(1.0, ARC_BASE_RATE + ARC_INCREMENT * Math.max(0, pity - (ARC_SOFT_PITY - 1)));
}

// pmf[k] = P(next S-Class in exactly k more pulls | current pity = startPity).
function buildSClassPmf(startPity, hardPity, getRateFn) {
  const len = hardPity - startPity + 1;
  const pmf = new Float64Array(len);
  let survival = 1.0;
  for (let k = 1; k < len; k++) {
    const rate = getRateFn(startPity + k);
    pmf[k] = survival * rate;
    survival *= (1 - rate);
  }
  return pmf;
}

// pmf[k] = P(next featured copy in exactly k more pulls).
// Character banner has no 50/50 (pFeatured always 1).
// Arc banner: pFeatured chance to win on EACH S-Class pull, independently —
// no guarantee-after-loss (unlike HSR/ZZZ's weapon-banner math). Modeled as
// a geometric mixture over how many S-Class draws it takes: D_n = pmf of
// reaching the nth S-Class draw (D_1 = pmfS with the caller's starting pity,
// D_n>1 = D_{n-1} convolved with a fresh-pity S-Class pmf), weighted by
// (1-pFeatured)^(n-1) * pFeatured — the chance the first n-1 draws all missed
// and the nth hit. Truncated once the residual miss-probability is
// negligible (40 cycles is generous for pFeatured=0.25: 0.75^40 ≈ 1e-5).
const ARC_MAX_CYCLES = 40;

function buildCopyPmf(startPity, pFeatured, hardPity, getRateFn) {
  const pmfS = buildSClassPmf(startPity, hardPity, getRateFn);
  if (pFeatured >= 1) return pmfS;

  const pmfSfresh = buildSClassPmf(0, hardPity, getRateFn);

  let dN = pmfS;
  let weight = 1;
  let result = new Float64Array(0);
  for (let n = 1; n <= ARC_MAX_CYCLES; n++) {
    if (result.length < dN.length) {
      const grown = new Float64Array(dN.length);
      grown.set(result);
      result = grown;
    }
    const contrib = weight * pFeatured;
    for (let k = 0; k < dN.length; k++) result[k] += dN[k] * contrib;

    if (n < ARC_MAX_CYCLES) {
      dN = convolvePmf(dN, pmfSfresh);
      weight *= (1 - pFeatured);
    }
  }
  return result;
}

function convolvePmf(a, b) {
  const result = new Float64Array(a.length + b.length - 1);
  for (let i = 1; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 1; j < b.length; j++) {
      result[i + j] += a[i] * b[j];
    }
  }
  return result;
}

function buildCdf(pmf) {
  const cdf = new Float64Array(pmf.length);
  for (let i = 1; i < pmf.length; i++) {
    cdf[i] = Math.min(1, cdf[i - 1] + pmf[i]);
  }
  return cdf;
}

// Compute exact probability distributions for all requested milestones.
// Returns { charMilestones, arcMilestones } where each milestone is { pmf, cdf }.
export function computeNTE({
  charCopies = 0,
  arcCopies = 0,
  startCharPity = 0,
  startArcPity = 0,
}) {
  const charMilestones = [];
  const arcMilestones = [];

  if (charCopies > 0) {
    const freshCharPmf = buildCopyPmf(0, 1, CHAR_HARD_PITY, getCharRate);
    let cumPmf = buildCopyPmf(startCharPity, 1, CHAR_HARD_PITY, getCharRate);
    charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let c = 1; c < charCopies; c++) {
      cumPmf = convolvePmf(cumPmf, freshCharPmf);
      charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  if (arcCopies > 0) {
    const freshArcPmf = buildCopyPmf(0, ARC_FEATURED_RATE, ARC_HARD_PITY, getArcRate);
    let cumPmf = buildCopyPmf(startArcPity, ARC_FEATURED_RATE, ARC_HARD_PITY, getArcRate);
    arcMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let a = 1; a < arcCopies; a++) {
      cumPmf = convolvePmf(cumPmf, freshArcPmf);
      arcMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  return { charMilestones, arcMilestones };
}

// P(reaching milestone within totalPulls). Direct CDF lookup — O(1).
export function successChance(cdf, totalPulls) {
  if (totalPulls <= 0) return 0;
  if (totalPulls >= cdf.length) return 1;
  return cdf[totalPulls];
}

// Expected pulls to reach milestone (weighted mean of pmf).
export function averagePulls(pmf) {
  let avg = 0;
  for (let k = 1; k < pmf.length; k++) avg += k * pmf[k];
  return Math.round(avg);
}
