const DEFAULT_RUNS = 100_000;

function getPullRate(baseRate, softPity, hardPity, currentPity) {
  if (currentPity < softPity) return baseRate;
  if (currentPity >= hardPity) return 1;
  const range = hardPity - softPity;
  const progress = currentPity - softPity;
  return baseRate + (1 - baseRate) * (progress / range);
}

function simulateOneFeatured(banner, startPity = 0, startGuaranteed = false) {
  const { baseRate, softPity, hardPity, has5050, featuredChance = 0.5, guaranteeCarryOver } = banner;
  let pity = startPity;
  let guaranteed = startGuaranteed;
  let pulls = 0;

  while (true) {
    pulls++;
    pity++;
    const rate = getPullRate(baseRate, softPity, hardPity, pity);
    if (Math.random() < rate || pity >= hardPity) {
      pity = 0;
      if (!has5050) return pulls;
      if (guaranteed) { guaranteed = false; return pulls; }
      if (Math.random() < featuredChance) {
        if (guaranteeCarryOver) guaranteed = false;
        return pulls;
      } else {
        if (guaranteeCarryOver) guaranteed = true;
        continue;
      }
    }
  }
}

export function pullsToCurrency(pulls, costPerPull) {
  return pulls * costPerPull;
}

// Simulate total pulls needed to hit charCopies on charBanner AND weaponCopies on weaponBanner.
// Either copies count can be 0 to skip that banner.
export function simulateCombined({
  charBanner,
  weaponBanner,
  charCopies = 0,
  weaponCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startWeaponPity = 0,
  startWeaponGuaranteed = false,
  runs = DEFAULT_RUNS,
}) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    let total = 0;
    for (let c = 0; c < charCopies; c++) {
      total += simulateOneFeatured(charBanner, c === 0 ? startCharPity : 0, c === 0 ? startCharGuaranteed : false);
    }
    for (let w = 0; w < weaponCopies; w++) {
      total += simulateOneFeatured(weaponBanner, w === 0 ? startWeaponPity : 0, w === 0 ? startWeaponGuaranteed : false);
    }
    results.push(total);
  }
  results.sort((a, b) => a - b);
  return results;
}

// Given a sorted results array from simulateCombined, return the pulls at or below `probability` (0–1).
export function pullsAtProbability(sortedResults, probability) {
  const idx = Math.min(Math.floor(sortedResults.length * probability), sortedResults.length - 1);
  return sortedResults[idx];
}

// ─── Exact math (no sampling) ──────────────────────────────────────────────
// Same mechanics as simulateOneFeatured above — reused so the Wish List's
// numbers don't drift from what the Monte Carlo fallback would produce.
// Only guaranteeCarryOver:true (every built-in database's setting) is
// computed exactly; guaranteeCarryOver:false falls back to simulateCombined.

// pmf[k] = P(next 5★ in exactly k more pulls | current pity = startPity).
function build5StarPmf(banner, startPity) {
  const { baseRate, softPity, hardPity } = banner;
  const len = Math.max(hardPity - startPity + 1, 1);
  const pmf = new Float64Array(len);
  let survival = 1.0;
  for (let k = 1; k < len; k++) {
    const rate = getPullRate(baseRate, softPity, hardPity, startPity + k);
    pmf[k] = survival * rate;
    survival *= (1 - rate);
  }
  return pmf;
}

// pmf[k] = P(next featured copy in exactly k more pulls). Returns null when
// the banner uses guaranteeCarryOver:false, which isn't computed exactly here.
function buildFeaturedPmf(banner, startPity, startGuaranteed) {
  const { has5050, featuredChance = 0.5, guaranteeCarryOver } = banner;
  const pmf5 = build5StarPmf(banner, startPity);
  if (!has5050 || startGuaranteed) return pmf5;
  if (!guaranteeCarryOver) return null;

  const pmf5fresh = build5StarPmf(banner, 0);
  const result = new Float64Array(pmf5.length + pmf5fresh.length);
  for (let k = 1; k < pmf5.length; k++) {
    if (pmf5[k] === 0) continue;
    result[k] += featuredChance * pmf5[k];
    const pLoss = (1 - featuredChance) * pmf5[k];
    for (let j = 1; j < pmf5fresh.length; j++) {
      result[k + j] += pLoss * pmf5fresh[j];
    }
  }
  return result;
}

function convolvePmf(a, b) {
  const result = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0) continue;
      result[i + j] += a[i] * b[j];
    }
  }
  return result;
}

// pmf of pulls needed to reach `copies` featured copies, chaining independent
// fresh draws after the first. copies <= 0 returns the identity pmf (0 pulls).
function chainCopiesPmf(banner, copies, startPity, startGuaranteed) {
  if (copies <= 0) return new Float64Array([1]);
  const fresh = buildFeaturedPmf(banner, 0, false);
  let cum = buildFeaturedPmf(banner, startPity, startGuaranteed);
  if (!cum || !fresh) return null;
  for (let c = 1; c < copies; c++) {
    cum = convolvePmf(cum, fresh);
  }
  return cum;
}

// Exact CDF of total pulls needed to hit charCopies AND weaponCopies. Returns
// null if either banner can't be computed exactly (see buildFeaturedPmf) —
// callers should fall back to simulateCombined + pullsAtProbability in that case.
export function computeCombinedExact({
  charBanner,
  weaponBanner,
  charCopies = 0,
  weaponCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startWeaponPity = 0,
  startWeaponGuaranteed = false,
}) {
  const charPmf = chainCopiesPmf(charBanner, charCopies, startCharPity, startCharGuaranteed);
  const weaponPmf = weaponBanner
    ? chainCopiesPmf(weaponBanner, weaponCopies, startWeaponPity, startWeaponGuaranteed)
    : new Float64Array([1]);
  if (!charPmf || !weaponPmf) return null;

  const combined = convolvePmf(charPmf, weaponPmf);
  const cdf = new Float64Array(combined.length);
  let acc = 0;
  for (let i = 0; i < combined.length; i++) {
    acc = Math.min(1, acc + combined[i]);
    cdf[i] = acc;
  }
  return cdf;
}

// Smallest pull count N such that cdf[N] >= probability.
export function pullsAtProbabilityFromCdf(cdf, probability) {
  for (let i = 0; i < cdf.length; i++) {
    if (cdf[i] >= probability) return i;
  }
  return cdf.length - 1;
}
