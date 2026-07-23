// WuWa Featured Resonator/Weapon banners share the same 5-star curve: base
// 0.8%, soft pity from pull 70, hard pity 80 (per Kuro's in-game Rates panel).
function getCharRate(pity) {
  return Math.min(1.0, 0.008 + 0.1 * Math.max(0, pity - 69));
}

function getWeaponRate(pity) {
  return Math.min(1.0, 0.008 + 0.1 * Math.max(0, pity - 69));
}

const CHAR_HARD_PITY = 80;
const WEAPON_HARD_PITY = 80;

const CHAR_FEATURED_RATE = 0.5;
// Weapon banner has NO 50/50 — every 5-star weapon is guaranteed to be the
// featured one, so buildCopyPmf's loss branch never triggers at pFeatured=1.
const WEAPON_FEATURED_RATE = 1.0;

// pmf[k] = P(next 5-star in exactly k more pulls | current pity = startPity).
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

export function computeWuwa({
  charCopies = 0,
  weaponCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startWeaponPity = 0,
  startWeaponGuaranteed = false,
}) {
  const charMilestones = [];
  const weaponMilestones = [];

  if (charCopies > 0) {
    const freshCharPmf = buildCopyPmf(0, false, CHAR_FEATURED_RATE, CHAR_HARD_PITY, getCharRate);
    let cumPmf = buildCopyPmf(startCharPity, startCharGuaranteed, CHAR_FEATURED_RATE, CHAR_HARD_PITY, getCharRate);
    charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let c = 1; c < charCopies; c++) {
      cumPmf = convolvePmf(cumPmf, freshCharPmf);
      charMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  if (weaponCopies > 0) {
    const freshWeaponPmf = buildCopyPmf(0, false, WEAPON_FEATURED_RATE, WEAPON_HARD_PITY, getWeaponRate);
    let cumPmf = buildCopyPmf(startWeaponPity, startWeaponGuaranteed, WEAPON_FEATURED_RATE, WEAPON_HARD_PITY, getWeaponRate);
    weaponMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    for (let w = 1; w < weaponCopies; w++) {
      cumPmf = convolvePmf(cumPmf, freshWeaponPmf);
      weaponMilestones.push({ pmf: cumPmf, cdf: buildCdf(cumPmf) });
    }
  }

  return { charMilestones, weaponMilestones };
}

export function successChance(cdf, totalPulls) {
  if (totalPulls <= 0) return 0;
  if (totalPulls >= cdf.length) return 1;
  return cdf[totalPulls];
}

export function averagePulls(pmf) {
  let avg = 0;
  for (let k = 1; k < pmf.length; k++) avg += k * pmf[k];
  return Math.round(avg);
}
