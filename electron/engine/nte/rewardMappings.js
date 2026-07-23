// Reward-key -> display-name lookup. The wire protocol only ever gives us a
// stable internal key (a numeric character ID as a short digit string, or a
// "fork_<id>" arc key) — never the display name shown in-game — confirmed
// directly from decoded real traffic tonight (e.g. character ID "1021" and
// arc key "fork_vine" both decode cleanly from real packets, but neither
// string is human-readable on its own).
//
// This table's facts (which ID/key corresponds to which real display name)
// come directly from nte.nanoka.cc's live character/weapon browse pages
// (nte.nanoka.cc/character, nte.nanoka.cc/weapon), fetched and cross-checked
// entry-by-entry against real decoded traffic — e.g. fork_vine -> "Be
// Happy", fork_appliance -> "Real Music", character ID 1021 -> "Edgar" all
// matched names that showed up in this app's own captured real history.
// These are factual ID-to-name associations (the game's own internal
// naming, not creative content).
//
// Nanoka's live data caught real drift from an earlier snapshot this file
// was originally built from (nte-exporter's bundled mapping, since
// superseded): that snapshot listed "Lacrimosa" twice under two different
// IDs (1004 and 1056) — nanoka has no 1056 at all, and lists ID 1075 as a
// distinct character, "Iroi", instead. It also had three arc keys that no
// longer match nanoka's live data at all (fork_Qiaoqiao / fork_Quanjitang /
// fork_Baozhatang — old Chinese-pinyin internal codenames, apparently
// renamed since) and was missing "The Wrong Gate" (fork_Door) entirely.
// Since the reward-key encoding is byte-exact, a stale/wrong key is not a
// "close enough" — it will never match real traffic at all, so this
// matters more than it would for an ordinary lookup table.
//
// Written in our own structure rather than any particular tool's file
// format. Will need extending as new characters/arcs release — the decoder
// still surfaces the raw key even when it's not in this table (see
// resolveRewardName below), so nothing breaks for an unmapped ID, it just
// won't have a friendly name yet.

// name + rank (S/A/B, matching this app's existing S-Class/A-Class/B-Class
// rarity convention from the OCR-based nte/ pipeline) per entry.
const CHARACTER_NAMES = {
  1003: { name: 'Sakiri', rank: 'S' },
  1004: { name: 'Lacrimosa', rank: 'S' },
  1008: { name: 'Skia', rank: 'A' },
  1010: { name: 'Nanally', rank: 'S' },
  1019: { name: 'Mint', rank: 'A' },
  1020: { name: 'Haniel', rank: 'A' },
  1021: { name: 'Edgar', rank: 'A' },
  1023: { name: 'Baicang', rank: 'S' },
  1025: { name: 'Hathor', rank: 'S' },
  1033: { name: 'Adler', rank: 'A' },
  1039: { name: 'Fadia', rank: 'S' },
  1046: { name: 'Zero', rank: 'S' },
  1051: { name: 'Zero', rank: 'S' },
  1052: { name: 'Hotori', rank: 'S' },
  1054: { name: 'Daffodill', rank: 'S' },
  1055: { name: 'Jiuyuan', rank: 'S' },
  1070: { name: 'Aurelia', rank: 'A' },
  1071: { name: 'Chaos', rank: 'S' },
  1073: { name: 'Chiz', rank: 'S' },
  1075: { name: 'Iroi', rank: 'S' },
  1076: { name: 'Shinku', rank: 'S' },
};

const ARC_NAMES = {
  fork_yuren: { name: 'Umbrella', rank: 'A' },
  fork_yaodao: { name: 'Drawn Blade', rank: 'A' },
  // CONFIRMED against real decoded traffic (capital W): nte-exporter's
  // original casing was correct, not nanoka's lowercase slug — this was the
  // one entry in this table that had been guessed rather than verified; the
  // guess was wrong.
  fork_Wushoutieyu: { name: 'Raging Flames', rank: 'S' },
  fork_wuhuakuang: { name: 'The Forgotten', rank: 'A' },
  fork_worldrain: { name: 'The Rain That Shook the World', rank: 'S' },
  fork_Whale: { name: 'Song of the Whale', rank: 'S' },
  fork_vine: { name: 'Be Happy', rank: 'B' },
  fork_tuansanlang: { name: 'The Great Thief', rank: 'A' },
  fork_Time: { name: 'Marching Beyond Time', rank: 'S' },
  fork_TigerTally: { name: 'Ready-Ready', rank: 'S' },
  fork_ThiefCandy: { name: 'Fluff of Finesse', rank: 'S' },
  fork_spider: { name: 'Failing You, Heavy in My Heart', rank: 'A' },
  fork_snowman: { name: "The Fools' Spring", rank: 'A' },
  fork_Rose: { name: 'The Last Rose', rank: 'S' },
  fork_rishi: { name: 'Day Off', rank: 'S' },
  fork_Prokaryon: { name: 'Us.', rank: 'B' },
  fork_PoliceRat: { name: "Hethereau's Keeper", rank: 'S' },
  fork_PaperPlane: { name: 'Clear Skies', rank: 'A' },
  fork_oulaquantao: { name: 'Oraora!', rank: 'A' },
  fork_nonos: { name: 'First Step to Success', rank: 'B' },
  fork_NestBird: { name: 'Tears Beneath the Mask', rank: 'S' },
  fork_Nakupeda: { name: 'Your Happiness is Priceless', rank: 'S' },
  fork_MotorCandy: { name: 'Fluff of Fleetness', rank: 'S' },
  fork_moon: { name: 'Stellar Veil', rank: 'S' },
  fork_mofeikesi: { name: "Good Boy's Grand Adventure", rank: 'S' },
  fork_mamen: { name: 'Contemplative Cat', rank: 'S' },
  fork_LunarPhase: { name: 'Blushing Mirage', rank: 'S' },
  fork_lingganzhongjiezhe: { name: 'Mind Royale', rank: 'A' },
  fork_koinobori: { name: 'A Time Will Come', rank: 'A' },
  fork_KnightCandy: { name: 'Fluff of Ferocity', rank: 'S' },
  fork_Kite: { name: 'Watch Your Heads!', rank: 'A' },
  fork_jingmotingyuan: { name: 'Camellia Society', rank: 'S' },
  fork_jiaojuan: { name: 'Shiny Days', rank: 'A' },
  fork_GoldWool: { name: "What's Desired", rank: 'S' },
  fork_dustbin: { name: 'Dangerous Game', rank: 'B' },
  fork_Door: { name: 'The Wrong Gate', rank: 'S' },
  fork_Crowbar: { name: 'Time Bandit', rank: 'A' },
  fork_Castle: { name: 'Call of the Twisted City', rank: 'A' },
  fork_Butterfly: { name: 'Reality Refuge', rank: 'S' },
  fork_BoxingCandy: { name: 'Fluff of Fortitude', rank: 'S' },
  fork_bopu: { name: 'Cosmos Daze, Wild Reverie', rank: 'A' },
  fork_BlastCandy: { name: 'Fluff of Fearlessness', rank: 'S' },
  fork_BlackBook: { name: 'Youthful Fantasy', rank: 'S' },
  fork_BitterCake: { name: 'The Good, The Bad, The Bitter', rank: 'A' },
  fork_BitGame: { name: 'Blow up the Crowd', rank: 'S' },
  fork_Arachne: { name: 'Eternal Waltz', rank: 'S' },
  fork_appliance: { name: '"Real Music"', rank: 'B' },
};

const RANK_TO_RARITY = { S: 5, A: 4, B: 3 };

// Structural/pool-tag fields, not actual rewards — "CardPool_Character"
// showed up repeatedly near real records during decoding and matches the
// item-key shape, but it's metadata (which pool a record belongs to), not
// something the player received. Excluded so it doesn't show up as a fake
// item in the output. Add other CardPool_* variants here if they surface
// for other banners.
const NON_REWARD_KEYS = new Set(['CardPool_Character', 'CardPool_Arc']);

// From nte-exporter's mappings/items.json — fetched directly (not from
// nanoka; this is separate from the character/arc nanoka check). Confirmed
// against real decoded traffic tonight: Dice_ticket_01/02 and Dicelimite
// all showed up in a real capture. Note "Dicelimite"/"DiceNormal" have no
// underscore at all — they wouldn't have matched the word-shaped fallback
// pattern below, which is exactly why "Dicelimite" was silently falling
// into 'unknown' instead of 'item' before this table existed.
const ITEM_NAMES = {
  DiceNormal: { name: 'Fabricated Dice', rank: 'S' },
  Dice_ticket_01: { name: 'Warp Piece', rank: 'S' },
  Dice_ticket_02: { name: 'Lost Piece', rank: 'A' }, // A-Class, not S — corrected per the user
  Dicelimite: { name: 'Solid Dice', rank: 'A' },
  // Fashion rarity rule confirmed directly by the user against real
  // on-screen colors, 2026-07-14: Character Skins and (vehicle) Liveries
  // are always Gold (S-Class); Gliders are always Pink (A-Class). Applied
  // categorically to every existing Fashion_* entry below by key shape
  // (Fashion_character_*/Fashion_vehicle_* -> S, Fashion_Glide_* -> A) —
  // these previously all had `rank: null` (silently defaulting to
  // B-Class), which was never actually verified and confirmed wrong for
  // both a skin (Fashion_character_1076_01) and a glider
  // (Fashion_Glide_1076) directly by the user before this rule was given.
  Fashion_Glide_1010: { name: 'Glider - Underboss-of-the-Underboss', rank: 'A' },
  Fashion_vehicle_1010_V008: { name: 'Mod Parts - Tiger Incoming! - Livery', rank: 'S' },
  Fashion_character_1010: { name: 'Character Skin - Phoenix Kick', rank: 'S' },
  Fashion_Glide_1052: { name: 'Glider - Orchid Breeze', rank: 'A' },
  Fashion_vehicle_1052_V024: { name: 'Mod Parts - Autumn Haze - Livery', rank: 'S' },
  Fashion_character_1052_01: { name: 'Character Skin - Priceless Orchid', rank: 'S' },
  Fashion_Glide_1004: { name: 'Glider - Tomato Duo', rank: 'A' },
  Fashion_vehicle_1004_V021: { name: 'Mod Parts - Tomato Cruise - Livery', rank: 'S' },
  Fashion_character_1004_01: { name: 'Character Skin - Gilded Rhapsody', rank: 'S' },
  Fashion_Glide_1071: { name: 'Glider - Skyrider', rank: 'A' },
  Fashion_vehicle_1071_V010: { name: 'Mod Parts - Novis ST-X 950 - Livery', rank: 'S' },
  Fashion_character_1071_01: { name: 'Character Skin - Clear Skies', rank: 'S' },
  Fashion_Glide_1076: { name: 'Glider - Overcast Canopy', rank: 'A' },
  Fashion_vehicle_1076_V024: { name: 'Mod Parts - Hidden Dragon - Livery', rank: 'S' },
  Fashion_character_1076_01: { name: 'Character Skin - Student of Terrasea', rank: 'S' },
};

// Fallback for item-shaped keys not yet in ITEM_NAMES above — readable
// formatting of the raw key (underscores -> spaces) rather than leaving it
// as an opaque programmer-key, since that's still more useful than nothing.
function formatItemKeyAsName(key) {
  return key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

// Resolves a decoded raw reward key to { kind, id, name, rarity }. `kind`
// is 'character' | 'arc' | 'item' | 'unknown'. Unknown/unmapped keys are
// returned with name: null (item-shaped ones get a formatted fallback name
// instead) rather than dropped, so the caller can still see the raw key.
// `rarity` follows this app's existing 5/4/3 (S/A/B) convention, matching
// tableParser.js's sampleRowRarity — defaults to 3 (B-Class) when the rank
// isn't known, same "neither highlight color" fallback logic.
function resolveRewardName(rawKey) {
  if (NON_REWARD_KEYS.has(rawKey)) {
    return { kind: 'pool-tag', id: rawKey, name: null, rarity: null };
  }
  if (/^\d+$/.test(rawKey)) {
    const id = Number(rawKey);
    const entry = CHARACTER_NAMES[id];
    return { kind: 'character', id, name: entry?.name ?? null, rarity: RANK_TO_RARITY[entry?.rank] ?? 3 };
  }
  if (rawKey.startsWith('fork_')) {
    const entry = ARC_NAMES[rawKey];
    return { kind: 'arc', id: rawKey, name: entry?.name ?? null, rarity: RANK_TO_RARITY[entry?.rank] ?? 3 };
  }
  if (ITEM_NAMES[rawKey]) {
    const entry = ITEM_NAMES[rawKey];
    return { kind: 'item', id: rawKey, name: entry.name, rarity: RANK_TO_RARITY[entry.rank] ?? 3 };
  }
  // Fashion rarity rule (user-confirmed, 2026-07-14 — see ITEM_NAMES'
  // comment above): Skins/Liveries are always Gold (S), Gliders always
  // Pink (A). Applied here too so a NEW character's fashion keys (not yet
  // added to ITEM_NAMES above) get the correct rarity automatically
  // instead of falling through to the generic 3/B-Class default below —
  // only the display name still needs a manual ITEM_NAMES entry once
  // added, rarity doesn't have to wait for that.
  if (rawKey.startsWith('Fashion_Glide_')) {
    return { kind: 'item', id: rawKey, name: formatItemKeyAsName(rawKey), rarity: RANK_TO_RARITY.A };
  }
  if (rawKey.startsWith('Fashion_character_') || rawKey.startsWith('Fashion_vehicle_')) {
    return { kind: 'item', id: rawKey, name: formatItemKeyAsName(rawKey), rarity: RANK_TO_RARITY.S };
  }
  // Word-shaped fallback for item keys not yet in ITEM_NAMES — either an
  // underscore-joined key like "Dice_ticket_03", or a single capitalized
  // word like "Dicelimite"/"DiceNormal" (confirmed real shapes, both
  // present in ITEM_NAMES already, but this catches future unmapped ones
  // of either shape rather than only the underscore form).
  if (/^[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*$/.test(rawKey) && rawKey.length >= 8 && /[A-Z]/.test(rawKey[0])) {
    return { kind: 'item', id: rawKey, name: formatItemKeyAsName(rawKey), rarity: 3 };
  }
  return { kind: 'unknown', id: rawKey, name: null, rarity: 3 };
}

module.exports = { CHARACTER_NAMES, ARC_NAMES, ITEM_NAMES, RANK_TO_RARITY, NON_REWARD_KEYS, resolveRewardName };
