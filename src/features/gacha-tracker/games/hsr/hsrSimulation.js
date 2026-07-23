// HSR character banner: base 0.6%, soft pity +6%/pull from pull 74, hard pity 90.
function getCharRate(pity) {
  return Math.min(1.0, 0.006 + 0.06 * Math.max(0, pity - 73));
}

// HSR light cone banner: base 0.8%, soft pity +7%/pull from pull 63, hard pity 80.
function getLCRate(pity) {
  return Math.min(1.0, 0.008 + 0.07 * Math.max(0, pity - 62));
}

const CHAR_HARD_PITY = 90;
const LC_HARD_PITY = 80;

// Featured rates derived from GGanalysis research (OneBST / 15M pulls):
// Character: 50% base + 1/8 * 50% = 56.25%
// Light Cone: 75% base + 1/8 * 25% = 78.125%
const CHAR_FEATURED_RATE = 0.5625;
const LC_FEATURED_RATE = 0.78125;

// pmf[k] = P(next 5-star in exactly k more pulls | current pity = startPity).
// Index 0 is always 0; meaningful values start at index 1.
function build5StarPmf(startPity, hardPity, getRateFn) {
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
// If startGuaranteed: the next 5-star is guaranteed to be the featured unit.
// Otherwise: pFeatured chance to win directly; on a loss the guarantee kicks in for the next cycle.
function buildCopyPmf(startPity, startGuaranteed, pFeatured, hardPity, getRateFn) {
  const pmf5 = build5StarPmf(startPity, hardPity, getRateFn);

  if (startGuaranteed) {
    return pmf5;
  }

  const pmf5fresh = build5StarPmf(0, hardPity, getRateFn);
  const result = new Float64Array(pmf5.length + pmf5fresh.length);

  for (let k = 1; k < pmf5.length; k++) {
    if (pmf5[k] === 0) continue;
    result[k] += pFeatured * pmf5[k];
    const pLoss = (1 - pFeatured) * pmf5[k];
    for (let j = 1; j < pmf5fresh.length; j++) {
      result[k + j] += pLoss * pmf5fresh[j];
    }
  }

  return result;
}

// Convolve two pmfs to get the distribution of their sum (sequential independent copies).
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
// Returns { charMilestones, lcMilestones } where each milestone is { pmf, cdf }.
export function computeHSR({
  charCopies = 0,
  lcCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startLCPity = 0,
  startLCGuaranteed = false,
}) {
  const charMilestones = [];
  const lcMilestones = [];

  if (charCopies > 0) {
    const freshCharPmf = buildCopyPmf(0, false, CHAR_FEATURED_RATE, CHAR_HARD_PITY, getCharRate);
    let cumPmf = buildCopyPmf(startCharPity, startCharGuaranteed, CHAR_FEATURED_RATE, CHAR_HARD_PITY, getCharRate);
    charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let c = 1; c < charCopies; c++) {
      cumPmf = convolvePmf(cumPmf, freshCharPmf);
      charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  if (lcCopies > 0) {
    const freshLCPmf = buildCopyPmf(0, false, LC_FEATURED_RATE, LC_HARD_PITY, getLCRate);
    let cumPmf = buildCopyPmf(startLCPity, startLCGuaranteed, LC_FEATURED_RATE, LC_HARD_PITY, getLCRate);
    lcMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let l = 1; l < lcCopies; l++) {
      cumPmf = convolvePmf(cumPmf, freshLCPmf);
      lcMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  return { charMilestones, lcMilestones };
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
