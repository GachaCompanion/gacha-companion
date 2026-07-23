// Builds a zzz.rng.moe-compatible JSON backup from our internal ZZZ pull log,
// so the user can import it back into rng.moe ("Load backup" on the website).
// Unlike HSR's .dat export, rng.moe backups are pure JSON containing only
// pull history + stats — no profile/calculator data — so we generate the
// file from scratch rather than patching a base backup.

const BANNER_TO_GACHA_TYPE = { standard: 1001, character: 2001, weapon: 3001, bangboo: 5001 };
// One fixed banner-instance id per category — rng.moe uses these to bucket
// per-banner stats. We don't have rng.moe's own per-event banner ids, so we
// collapse everything per category. The import still works fine; only the
// per-banner granularity is lost.
const BANNER_TO_GACHA_ID   = { standard: 1001001, character: 2001001, weapon: 3001001, bangboo: 5001001 };
const RATE_UP_BANNERS      = new Set(['character', 'weapon']);

// Inverse of zzzImport.js's ZZZ_CHAR_NAMES / ZZZ_WEAPON_NAMES / ZZZ_BANGBOO_NAMES.
// Maps item name → numeric rng.moe item id.
const NAME_TO_ID = {
  // Characters
  'Anby':1011,'Nekomata':1021,'Nicole':1031,'Soldier 11':1041,'Yidhari':1051,
  'Corin':1061,'Caesar':1071,'Billy':1081,'Miyabi':1091,'Koleda':1101,
  'Anton':1111,'Ben':1121,'Soukaku':1131,'Lycaon':1141,'Lucy':1151,
  'Lighter':1161,'Burnice':1171,'Grace':1181,'Ellen':1191,'Harumasa':1201,
  'Rina':1211,'Yanagi':1221,'Rokudou Sariel':1231,'Zhu Yuan':1241,'Qingyi':1251,
  'Jane Doe':1261,'Seth':1271,'Piper':1281,'Hugo Vlad':1291,'Orphie & Magus':1301,
  'Astra Yao':1311,'Evelyn':1321,'Vivian':1331,'Zhao':1341,'Pulchra':1351,
  'Trigger':1361,'Yi Xuan':1371,'Silver Anby':1381,'Ju Fufu':1391,'Alice':1401,
  'Yuzuha':1411,'Pan Yinhu':1421,'Ye Shunguang':1431,'Komano Manato':1441,'Lucia':1451,
  'Seed':1461,'Banyue':1471,'Dialyn':1481,'Sunna':1491,'Aria':1501,
  'Nangong Yu':1511,'Cissia':1521,'Billy SP':1531,'Promeia':1541,'Pyrois':1551,
  'Velina':1561,'Norma':1571,'Remielle':1581,
  'Wise':2011,'Belle':2021,
  // W-Engines
  '[Lunar] Pleniluna':12001,'[Lunar] Decrescent':12002,'[Lunar] Noviluna':12003,
  '[Reverb] Mark I':12004,'[Reverb] Mark II':12005,'[Reverb] Mark III':12006,
  '[Vortex] Revolver':12007,'[Vortex] Arrow':12008,'[Vortex] Hatchet':12009,
  '[Magnetic Storm] Alpha':12010,'[Magnetic Storm] Bravo':12011,'[Magnetic Storm] Charlie':12012,
  '[Identity] Base':12013,'[Identity] Inflection':12014,'[Cinder] Cobalt':12015,
  'Street Superstar':13001,'Slice of Time':13002,'Rainforest Gourmet':13003,
  'Starlight Engine':13004,'Steam Oven':13005,'Precious Fossilized Core':13006,
  'Original Transmorpher':13007,'Weeping Gemini':13008,'Electro-Lip Gloss':13009,
  'Bunny Band':13010,'Spring Embrace':13011,'Puzzle Sphere':13012,
  'Gilded Blossom':13013,'Radiowave Journey':13014,'Marcato Desire':13015,
  'Reel Projector':13016,'Boisterous Echoes':13018,'Cauldron of Clarity':13019,
  'The Simmering Pot':13020,'Demara Battery Mark II':13101,'The Vault':13103,
  'Housekeeper':13106,'Starlight Engine Replica':13108,'Drill Rig - Red Axis':13111,
  'Big Cylinder':13112,'Bashful Demon':13113,'Kaboom the Cannon':13115,
  'Peacekeeper - Specialized':13127,'Roaring Ride':13128,'Box Cutter':13135,
  'Tremor Trigram Vessel':13142,'Grill O\'Wisp':13144,
  'Cannon Rotor':14001,'Unfettered Game Ball':14002,'Six Shooter':14003,
  'Steel Cushion':14102,'The Brimstone':14104,'Kraken\'s Cradle':14105,
  'Tusks of Fury':14107,'Hailstorm Shrine':14109,'Hellfire Gears':14110,
  'The Restrained':14114,'Blazing Laurel':14116,'Flamemaker Shaker':14117,
  'Fusion Compiler':14118,'Deep Sea Visitor':14119,'Zanshin Herb Case':14120,
  'Weeping Cradle':14121,'Timeweaver':14122,'Riot Suppressor Mark VI':14124,
  'Ice-Jade Teapot':14125,'Sharpened Stinger':14126,'Myriad Eclipse':14129,
  'Bellicose Blaze':14130,'Elegant Vanity':14131,'Heartstring Nocturne':14132,
  'Flight of Fancy':14133,'Half-Sugar Bunny':14134,'Spectral Gaze':14136,
  'Qingming Birdcage':14137,'Severed Innocence':14138,'Roaring Fur-nace':14139,
  'Practiced Perfection':14140,'Metanukimorphosis':14141,'Cloudcleave Radiance':14143,
  'Dreamlit Hearth':14145,'Cordis Germina':14146,'Wrathful Vajra':14147,
  'Yesterday Calls':14148,'Thoughtbop':14149,'Angel in the Shell':14150,
  'Neon Fantasies':14151,'Serpentine Seeker':14152,'Starlight Rider Faceplate':14153,
  'Frostfall Sickle':14154,'Sol Exuvia':14155,'Joyau Dore':14156,
  'Chief Sidekick':14157,
  // Bangboo
  'Penguinboo':53001,'Luckyboo':53002,'Exploreboo':53003,'Sumoboo':53004,
  'Paperboo':53005,'Bagboo':53006,'Cryboo':53007,'Avocaboo':53008,
  'Boollseye':53009,'Electroboo':53010,'Magnetiboo':53011,'Booressure':53012,
  'Baddieboo':53013,'Overtimeboo':53014,'Brawlerboo':53015,'Excaliboo':53016,
  'Knightboo':53017,'Bild N. Boolok':53019,'Booltergeist':53021,
  'Sharkboo':54001,'Safety':54002,'Devilboo':54003,'Butler':54004,
  'Amillion':54005,'Rocketboo':54006,'Plugboo':54008,'Resonaboo':54009,
  'Biggest Fan':54010,'Red Moccus':54011,'Officer Cui':54012,'Bangvolver':54013,
  'Agent Gulliver':54014,'Snap':54015,'Robin':54016,'Belion':54017,
  'Miss Esme':54018,'Mercury':54019,'Birkblick':54020,'Sprout':54021,
  'Ultra Jake':54022,
};

// "YYYY-MM-DD HH:mm:ss" UTC+8 → unix ms
function timeToMs(timeStr) {
  const [date, time] = timeStr.split(' ');
  const [y, m, d]   = date.split('-').map(Number);
  const [h, mi, s]  = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h - 8, mi, s);
}

function won5050ToResult(won5050, banner) {
  if (!RATE_UP_BANNERS.has(banner)) return 0;
  if (won5050 === 'won')       return 1;
  if (won5050 === 'lost')      return 2;
  if (won5050 === 'guaranteed') return 3;
  return 0;
}

// Build per-category item arrays + derived stats in one pass.
function buildCategoryData(sortedPulls, banner) {
  const gachaType = BANNER_TO_GACHA_TYPE[banner];
  const gachaId   = BANNER_TO_GACHA_ID[banner];
  const items     = [];

  let no       = 0;
  let pityS    = 0;   // running 5-star pity (resets after S-rank)
  let pityA    = 0;   // running 4-star pity (resets after A-rank, independent of S)
  let sumPityS = 0, count5 = 0;
  let sumPityA = 0, count4 = 0;
  let count3   = 0;
  let sWin = 0, sChallenge = 0;
  let curWinStreak = 0, curLoseStreak = 0;
  let lastUid  = '0';

  for (const pull of sortedPulls) {
    no++;
    pityS++;
    pityA++;

    const rarity = pull.rarity;           // our: 3/4/5
    const rngRarity = rarity - 1;         // rng.moe: 2/3/4
    const itemId  = NAME_TO_ID[pull.name] ?? 0;
    const result  = won5050ToResult(pull.won5050, banner);

    let pityField = 0;
    if (rarity === 5) {
      pityField = pityS;
      sumPityS += pityS;
      count5++;
      pityS = 0;
    } else if (rarity === 4) {
      pityField = pityA;
      sumPityA += pityA;
      count4++;
      pityA = 0;
    }
    // rarity === 3: pityField stays 0

    if (rarity === 3) count3++;

    // Win/lose streak tracking (5-star limited banners only)
    if (rarity === 5 && RATE_UP_BANNERS.has(banner)) {
      if (result === 1) {         // won
        sWin++;
        sChallenge++;
        curWinStreak++;
        curLoseStreak = 0;
      } else if (result === 2) {  // lost
        sChallenge++;
        curWinStreak = 0;
        curLoseStreak++;
      } else if (result === 3) {  // guaranteed (counts as win for winRate)
        sWin++;
        sChallenge++;
        curWinStreak++;
        curLoseStreak = 0;
      }
    }

    lastUid = String(pull.id);

    items.push({
      uid:       String(pull.id),
      id:        itemId,
      timestamp: timeToMs(pull.time),
      rarity:    rngRarity,
      gacha:     gachaId,
      gachaType,
      pity:      pityField,
      manual:    false,
      no,
      result,
    });
  }

  const avgPityS = count5 > 0 ? sumPityS / count5 : 0;
  const avgPityA = count4 > 0 ? sumPityA / count4 : 0;
  const winRate  = sChallenge > 0 ? sWin / sChallenge : 0;

  const bannerStats = {
    id:                    gachaId,
    gachaType,
    count2:                count3,
    count3:                count4,
    count4:                count5,
    avgPityS,
    avgPityA,
    sWinCount:             sWin,
    sChallengeCount:       sChallenge,
    winRate,
    s_challenge_win_streak:  curWinStreak,
    s_challenge_lose_streak: curLoseStreak,
  };

  const typeStats = {
    id:                    gachaType,
    lastItemId:            lastUid,
    count2:                count3,
    count3:                count4,
    count4:                count5,
    avgPityS,
    avgPityA,
    winRate,
    sWinCount:             sWin,
    sChallengeCount:       sChallenge,
    pity:                  { pityS, pityA },
    s_challenge_win_streak:  curWinStreak,
    s_challenge_lose_streak: curLoseStreak,
  };

  return { items, bannerStats, typeStats };
}

/**
 * Builds a zzz.rng.moe backup JSON from the app's internal pull log.
 * @param {Array}  pullLog     Internal pull log (all banners mixed).
 * @param {string} uid         Player UID string.
 * @param {Array}  gaps        Populated with pulls whose item id couldn't be resolved.
 * @returns {object}           Parsed JSON object ready to be JSON.stringify'd.
 */
function buildZzzRngMoeExport(pullLog, uid) {
  const gaps = [];
  const byBanner = {};
  for (const p of pullLog) {
    if (!BANNER_TO_GACHA_TYPE[p.banner]) continue;
    (byBanner[p.banner] ??= []).push(p);
  }

  // Sort each category chronologically (time ascending, then id ascending for ties)
  for (const banner of Object.keys(byBanner)) {
    byBanner[banner].sort((a, b) => {
      const t = (a.time ?? '').localeCompare(b.time ?? '');
      return t !== 0 ? t : (a.id ?? '').localeCompare(b.id ?? '');
    });
  }

  // Track gaps (unknown item ids)
  for (const [banner, pulls] of Object.entries(byBanner)) {
    for (const p of pulls) {
      if (!NAME_TO_ID[p.name]) gaps.push({ name: p.name, banner, time: p.time });
    }
  }

  const itemsOut     = {};
  const gachaBanners = {};
  const gachaTypes   = {};

  // Emit all 4 categories (include empty entries for ones with no pulls)
  for (const banner of ['standard', 'character', 'weapon', 'bangboo']) {
    const pulls = byBanner[banner] ?? [];
    const gachaType = BANNER_TO_GACHA_TYPE[banner];
    const gachaId   = BANNER_TO_GACHA_ID[banner];

    if (pulls.length === 0) {
      itemsOut[String(gachaType)]   = [];
      gachaBanners[String(gachaId)] = {
        id: gachaId, gachaType,
        count2: 0, count3: 0, count4: 0,
        avgPityS: 0, avgPityA: 0,
        sWinCount: 0, sChallengeCount: 0, winRate: 0,
        s_challenge_win_streak: 0, s_challenge_lose_streak: 0,
      };
      gachaTypes[String(gachaType)] = {
        id: gachaType, lastItemId: '0',
        count2: 0, count3: 0, count4: 0,
        avgPityS: 0, avgPityA: 0, winRate: 0,
        sWinCount: 0, sChallengeCount: 0,
        pity: { pityS: 0, pityA: 0 },
        s_challenge_win_streak: 0, s_challenge_lose_streak: 0,
      };
      continue;
    }

    const { items, bannerStats, typeStats } = buildCategoryData(pulls, banner);
    itemsOut[String(gachaType)]   = items;
    gachaBanners[String(gachaId)] = bannerStats;
    gachaTypes[String(gachaType)] = typeStats;
  }

  // Also emit the two empty types rng.moe normally includes (12001, 13001)
  for (const extraType of [12001, 13001]) {
    gachaTypes[String(extraType)] = {
      id: extraType, lastItemId: '0',
      count2: 0, count3: 0, count4: 0,
      avgPityS: 0, avgPityA: 0, winRate: 0,
      sWinCount: 0, sChallengeCount: 0,
      pity: { pityS: 0, pityA: 0 },
      s_challenge_win_streak: 0, s_challenge_lose_streak: 0,
    };
  }

  const uidNum = Number(uid) || 0;
  const store0 = {
    identityHash:        'gc-export',
    gachaBanners,
    gachaTypes,
    items:               itemsOut,
    lastManualImportUid: 0,
    share:               { name: 'Proxy', profile: uidNum },
    itemAppend:          {},
    flags:               { full: true },
  };

  return {
    backup: {
      version: 1,
      game: 'zzz',
      data: {
        actionIdx:    Date.now(),
        profileIdx:   1,
        curProfileId: 1,
        profiles: {
          '1': {
            id:       1,
            name:     'Default',
            bindUid:  uidNum,
            version:  11,
            stores: {
              '0': store0,
              '1': { itemList: [] },
              '2': { version: 2, enabled: {}, arcadeEnabled: {}, poEnabled: {} },
              '3': { version: 1, settings: {} },
            },
          },
        },
      },
    },
    gaps,
  };
}

module.exports = { buildZzzRngMoeExport };
