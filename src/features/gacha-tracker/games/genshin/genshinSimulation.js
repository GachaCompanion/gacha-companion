const DEFAULT_RUNS = 100_000;

// Win rate at each Capturing Radiance counter value (0–3).
// Counter 3: 100% guaranteed (CR fires). Counter 2: empirically 52–60%, using 55%.
// Counter 0 and 1 have no confirmed bonus; both use the base 50%.
const RADIANCE_WIN_RATE = [0.5, 0.5, 0.55, 1.0];

// Character soft pity: +6% per pull from pull 74 onward. Hard pity: pull 90.
function getCharRate(pity) {
  return Math.min(1.0, 0.006 + 0.06 * Math.max(0, pity - 73));
}

// Weapon soft pity: +7% per pull from pull 63 onward. Hard pity: pull 77.
function getWeaponRate(pity) {
  return Math.min(1.0, 0.007 + 0.07 * Math.max(0, pity - 62));
}

// Simulate pulling until one featured character copy is obtained.
// Tracks both the formal guarantee (lost last 50/50) and the Capturing Radiance counter.
// Formal guarantee: next 5-star is 100% featured, radiance counter unchanged.
// Contested 50/50: win decrements radiance (or CR fires at 3 → reset to 1), lose increments radiance + sets guarantee.
function simulateOneCharacter(startPity, startGuaranteed, radianceCounter) {
  let pity = startPity;
  let guaranteed = startGuaranteed;
  let radiance = radianceCounter;
  let pulls = 0;

  while (true) {
    pulls++;
    pity++;
    if (Math.random() < getCharRate(pity)) {
      pity = 0;
      if (guaranteed) {
        // Formal guarantee: win without contesting 50/50 — radiance counter unchanged
        return { pulls, nextGuaranteed: false, nextRadiance: radiance };
      }
      if (Math.random() < RADIANCE_WIN_RATE[radiance]) {
        // Won the 50/50 (or Capturing Radiance fired)
        const nextRadiance = radiance === 3 ? 1 : Math.max(0, radiance - 1);
        return { pulls, nextGuaranteed: false, nextRadiance };
      } else {
        // Lost the 50/50: set formal guarantee, increment radiance, continue pulling
        guaranteed = true;
        radiance = Math.min(3, radiance + 1);
      }
    }
  }
}

// Simulate pulling until one specific featured weapon copy is obtained.
// Tracks the featured-weapon guarantee (lost to off-banner) and epitomized path points (0–1).
// At ep=1: next featured 5-star is forced to be the marked weapon (changed from 2 in v5.x).
// At guarantee=true: next 5-star is forced to be a featured weapon (still 50/50 between the two).
function simulateOneWeapon(startPity, guaranteed, epitomizedPoints) {
  let pity = startPity;
  let pulls = 0;
  let guarantee = guaranteed;
  let ep = epitomizedPoints;

  while (true) {
    pulls++;
    pity++;
    if (Math.random() < getWeaponRate(pity)) {
      pity = 0;

      if (ep >= 1) {
        if (guarantee || Math.random() < 0.75) {
          return { pulls, nextGuarantee: false, nextEpitomized: 0 };
        } else {
          guarantee = true;
        }
      } else if (guarantee) {
        guarantee = false;
        if (Math.random() < 0.5) {
          return { pulls, nextGuarantee: false, nextEpitomized: 0 };
        } else {
          ep = 1;
        }
      } else {
        if (Math.random() < 0.75) {
          if (Math.random() < 0.5) {
            return { pulls, nextGuarantee: false, nextEpitomized: 0 };
          } else {
            ep = 1;
          }
        } else {
          guarantee = true;
        }
      }
    }
  }
}

// Simulate all milestones in a single pass.
// charMilestones[i] = sorted array of pulls needed to reach copy (i+1) from the starting state.
// weaponMilestones[i] = sorted array of pulls needed to reach refinement (i+1) from the starting state.
// Radiance counter and weapon state carry over between consecutive copies within a single run.
export function simulateGenshinFull({
  charCopies = 0,
  weaponCopies = 0,
  startCharPity = 0,
  startCharGuaranteed = false,
  startRadiance = 1,
  startWeaponPity = 0,
  startWeaponGuaranteed = false,
  startEpitomizedPoints = 0,
  runs = DEFAULT_RUNS,
}) {
  const charData = Array.from({ length: charCopies }, () => []);
  const weaponData = Array.from({ length: weaponCopies }, () => []);

  for (let i = 0; i < runs; i++) {
    let charTotal = 0;
    let radiance = startRadiance;
    let guaranteed = startCharGuaranteed;

    for (let c = 0; c < charCopies; c++) {
      const r = simulateOneCharacter(c === 0 ? startCharPity : 0, c === 0 ? guaranteed : false, radiance);
      charTotal += r.pulls;
      radiance = r.nextRadiance;
      charData[c].push(charTotal);
    }

    let weaponGuarantee = startWeaponGuaranteed;
    let epitomized = startEpitomizedPoints;

    for (let w = 0; w < weaponCopies; w++) {
      const r = simulateOneWeapon(w === 0 ? startWeaponPity : 0, weaponGuarantee, epitomized);
      weaponGuarantee = r.nextGuarantee;
      epitomized = r.nextEpitomized;
      weaponData[w].push(r.pulls);
    }
  }

  charData.forEach(m => m.sort((a, b) => a - b));
  weaponData.forEach(m => m.sort((a, b) => a - b));

  return { charMilestones: charData, weaponMilestones: weaponData };
}

// Fraction of runs that completed a milestone within totalPulls (0–1).
export function successChance(sortedMilestone, totalPulls) {
  if (totalPulls <= 0) return 0;
  let lo = 0, hi = sortedMilestone.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedMilestone[mid] <= totalPulls) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedMilestone.length;
}

// Mean of a sorted milestone array, rounded to nearest integer.
export function averagePulls(sortedMilestone) {
  if (!sortedMilestone.length) return 0;
  let sum = 0;
  for (let i = 0; i < sortedMilestone.length; i++) sum += sortedMilestone[i];
  return Math.round(sum / sortedMilestone.length);
}
