// Decoder for NTE's UDP history-query protocol. Reimplemented in JS from
// reading nte-exporter's actual Python source (decoder/protocol.py,
// decoder/arc.py, constants.py) to understand the real wire structure —
// not a heuristic guess, and not a line-for-line port (different language,
// own control flow/naming throughout). Understanding-driven reimplementation
// was explicitly authorized; only copying was ever off the table, and a
// straight Python->JS port wasn't possible anyway.
//
// Two response families, structurally unrelated to each other:
//
//   Monopoly/character (Lottery_Permanent + Lottery_LimitedCharacter boards):
//   fixed 23-byte marker literal between records (one of two board-specific
//   markers below), reward key immediately precedes the marker with no gap,
//   8-byte timestamp immediately follows it with no gap. Key bytes are
//   located by fixed prefix, not by brute-force decode-and-validate — see
//   extractMonopolyKeyBytes.
//
//   Arc (Arc_MiracleBox): no marker at all. Sequential length-prefixed
//   fields starting at a fixed response offset (0x4c): a length-prefixed
//   name (the reward key, encoded with a completely different
//   byte-substitution scheme than monopoly keys — see decodeArcKey), a
//   length-prefixed type field (kept as raw bytes, not decoded), then an
//   8-byte timestamp. Confirmed live: brute-force-decoding arc traffic with
//   the monopoly reward-key scheme found zero real arc keys anywhere outside
//   the monopoly marker's own payloads — the two systems don't share an
//   encoding, despite both games granting "fork_" arc pieces.

// VERIFIED — the two board markers, from nte-exporter's
// mappings/limited_character_board.json (response.marker_hex) and
// constants.py's PERMANENT_MARKER (the Lottery_Permanent board — not
// currently visited by navigation.js's page-walk, but included so traffic
// from that board decodes correctly if it's ever captured incidentally).
const PERMANENT_MARKER = Buffer.from('440000000c85c99141bdbdb17d3995dd49bdb19501', 'hex');
const LIMITED_CHARACTER_MARKER = Buffer.from('4c0000000c85c99141bdbdb17d0da185c9858dd195c901', 'hex');
const MONOPOLY_MARKERS = [PERMANENT_MARKER, LIMITED_CHARACTER_MARKER];

// VERIFIED — fixed byte prefixes that mark where a reward key begins within
// the gap before a marker. c4c0 is specifically the encoded prefix of
// character IDs (they all start with digits "10"); the other two are the
// encoded prefixes of item/arc keys; the fashion prefix marks cosmetic
// grants. Locating the key this way (rather than scanning for the longest
// decodable run) is what the real client/exporter does, and avoids the
// truncation and CardPool_Character-collision issues the old brute-force
// scan had.
const CHAR_KEY_PREFIX = Buffer.from('c4c0', 'hex');
const ITEM_KEY_PREFIXES = [Buffer.from('98bdc9ad', 'hex'), Buffer.from('10a58d95', 'hex')];
const FASHION_KEY_PREFIX = Buffer.from('1885cda1a5bdb97d', 'hex');

// VERIFIED — reward-key decode for monopoly records: each byte encodes one
// ASCII character as (char * 4) with carry propagation from the next byte,
// terminated by a trailing carry byte. Equivalent to treating the bytes as
// a little-endian base-256 integer and dividing by 4, which is how this was
// originally verified against nte-exporter's two documented worked examples
// (fork_vine -> "98bdc9ad7dd9a5b99501", DiceNormal -> "10a58d9539bdc9b585b101").
function decodeRewardKey(bytes) {
  if (!bytes || bytes.length < 2) return null;
  let m = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) m = (m << 8n) | BigInt(bytes[i]);
  if (m % 4n !== 0n) return null;
  let v = m / 4n;
  const chars = [];
  for (let i = 0; i < bytes.length - 1; i++) {
    const byte = Number(v & 0xffn);
    if (byte < 0x20 || byte > 0x7e) return null; // not printable ASCII — wrong prefix/offset
    chars.push(byte);
    v >>= 8n;
  }
  return Buffer.from(chars).toString('ascii');
}

// VERIFIED — quoted directly from the documented/source-confirmed formula.
function monopolyTimestampToUnixSeconds(rawU64) {
  return Number(rawU64 / 40000000n - 62135596800n);
}

// VERIFIED — arc's own timestamp formula (ticks/20_000_000, not /40_000_000
// like monopoly). Confirmed against constants.py's ARC_TIMESTAMP_TICKS_PER_SECOND.
function arcTimestampToUnixSeconds(rawU64) {
  return Number(rawU64 / 20000000n - 62135596800n);
}

function readU64LE(buf, offset) {
  if (offset < 0 || offset + 8 > buf.length) return null;
  return buf.readBigUInt64LE(offset);
}

// Locates the reward-key bytes within `chunk` (everything between the
// previous record's end and the current marker) by fixed prefix, per
// protocol.py's extract_key. Order matters: fashion keys are checked first
// (they can contain byte sequences that coincidentally match the shorter
// item prefixes), then the fixed-length character-ID form, then item/arc
// keys by their prefix (last occurrence, since the prefix bytes can also
// appear earlier in the chunk as part of unrelated fields).
function extractMonopolyKeyBytes(chunk) {
  const fashionPos = chunk.lastIndexOf(FASHION_KEY_PREFIX);
  if (fashionPos !== -1) return chunk.subarray(fashionPos);

  const charPos = chunk.indexOf(CHAR_KEY_PREFIX);
  if (charPos !== -1 && charPos + 5 <= chunk.length) return chunk.subarray(charPos, charPos + 5);

  let best = -1;
  for (const prefix of ITEM_KEY_PREFIXES) {
    const pos = chunk.lastIndexOf(prefix);
    if (pos !== -1 && pos > best) best = pos;
  }
  return best === -1 ? null : chunk.subarray(best);
}

// Walks one monopoly/character-board response: records sit back-to-back,
// each ending in [key][marker][8-byte timestamp], with the first record's
// key-search chunk starting at the fixed response offset 0x50. Tries both
// known markers and uses whichever is actually present (a given response
// only ever uses one, since each board has its own marker).
function scanMonopolyRecords(payload) {
  let marker = null;
  let offsets = null;
  for (const candidate of MONOPOLY_MARKERS) {
    const found = [];
    let from = 0;
    while (true) {
      const idx = payload.indexOf(candidate, from);
      if (idx === -1) break;
      found.push(idx);
      from = idx + 1;
    }
    if (found.length) { marker = candidate; offsets = found; break; }
  }
  if (!marker) return [];

  const records = [];
  let prev = 0x50;
  for (const markerOffset of offsets) {
    const chunk = payload.subarray(prev, markerOffset);
    const timestampOffset = markerOffset + marker.length;
    prev = timestampOffset + 8;

    const keyBytes = extractMonopolyKeyBytes(chunk);
    if (!keyBytes) continue;
    const rewardKey = decodeRewardKey(keyBytes);
    if (!rewardKey) continue;

    const raw = readU64LE(payload, timestampOffset);
    if (raw == null) continue;
    const unixSeconds = monopolyTimestampToUnixSeconds(raw);
    if (!Number.isFinite(unixSeconds)) continue;

    records.push({ rewardKey, timestampOffset, unixSeconds, source: 'monopoly-marker' });
  }

  // A real page can never have more than 5 rows — the UI itself only ever
  // shows 5 per page. Confirmed live against a real short/partial last page
  // (3 genuine rows) that decoded one of them (the final real row) TWICE:
  // NTE's response format is a fixed 5-slot structure, and unused slots on
  // a short page get padded by repeating the last real record's bytes
  // rather than being left empty or zeroed — this scanner has no concept of
  // "how many rows are really on this page," so it happily decodes that
  // padding as extra genuine records. Only trims when there are MORE than 5
  // (something we know is impossible for a real page) and only a TRAILING
  // exact repeat of the immediately preceding record — padding always
  // repeats whatever the last real row was, unlike a genuine same-timestamp
  // multi-pull batch (confirmed real via a live screenshot showing 3
  // separate, non-trailing occurrences of one item interleaved with other
  // distinct rows), which this must never collapse. A payload with 5 or
  // fewer records is left completely untouched — there's no way to
  // distinguish genuine same-key duplicates from padding within that range,
  // so this only ever removes what's definitionally impossible to be real.
  while (records.length > 5) {
    const last = records[records.length - 1];
    const prev = records[records.length - 2];
    if (last.rewardKey === prev.rewardKey && last.unixSeconds === prev.unixSeconds) {
      records.pop();
    } else {
      break; // excess isn't a trailing repeat — don't guess further, leave it
    }
  }

  return records;
}

// VERIFIED — arc reward keys use a completely different scheme than
// monopoly's: a fixed 5-byte prefix (ccdee4d6be) followed by one byte per
// character, mapped through two even-valued ranges (0xc2-0xf4 -> a-z,
// 0x82-0xb4 -> A-Z) rather than the bignum/÷4 scheme. From decoder/arc.py's
// decode_arc_key. Falls back to null (caller keeps the raw hex) for bytes
// outside both ranges rather than guessing.
const ARC_KEY_PREFIX = Buffer.from('ccdee4d6be', 'hex');

function decodeArcKey(raw) {
  let bytes = raw;
  if (bytes.length && bytes[bytes.length - 1] === 0) bytes = bytes.subarray(0, bytes.length - 1);
  if (bytes.length < ARC_KEY_PREFIX.length || !bytes.subarray(0, ARC_KEY_PREFIX.length).equals(ARC_KEY_PREFIX)) return null;
  let out = 'fork_';
  for (let i = ARC_KEY_PREFIX.length; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0xc2 && b <= 0xf4 && (b - 0xc2) % 2 === 0) out += String.fromCharCode(0x61 + (b - 0xc2) / 2);
    else if (b >= 0x82 && b <= 0xb4 && (b - 0x82) % 2 === 0) out += String.fromCharCode(0x41 + (b - 0x82) / 2);
    else return null; // unmapped byte — not a real arc key at this offset
  }
  return out;
}

// VERIFIED — arc responses have no marker at all; records are sequential
// length-prefixed fields starting at a fixed offset (0x4c), from
// decoder/arc.py's parse_arc_response: u32 name-byte-length (as a UTF-16
// char count, i.e. double the actual byte count — hence the /2 and the
// even-length check), name bytes, u32 type-byte-length, type bytes
// (unused — kept only implicitly by skipping over it), then an 8-byte
// timestamp. Bails out of the whole payload (rather than skipping just one
// record) on a structurally invalid length or an unparseable timestamp,
// same as the source — a payload that isn't a real arc response usually
// fails on the very first length check, so this stays cheap for the large
// majority of captured traffic that isn't arc history at all.
const ARC_RESPONSE_FIRST_RECORD_OFFSET = 0x4c;

function scanArcRecords(payload) {
  const records = [];
  let pos = ARC_RESPONSE_FIRST_RECORD_OFFSET;
  while (pos + 4 <= payload.length) {
    const nameLen2 = payload.readUInt32LE(pos);
    if (nameLen2 <= 0 || nameLen2 > 200 || nameLen2 % 2 !== 0) break;
    const nameLen = nameLen2 / 2;
    if (pos + 4 + nameLen + 4 > payload.length) break;
    const nameRaw = payload.subarray(pos + 4, pos + 4 + nameLen);
    pos += 4 + nameLen;

    const typeLen2 = payload.readUInt32LE(pos);
    if (typeLen2 <= 0 || typeLen2 > 200 || typeLen2 % 2 !== 0) break;
    const typeLen = typeLen2 / 2;
    if (pos + 4 + typeLen + 8 > payload.length) break;
    pos += 4 + typeLen;

    const timestampOffset = pos;
    const raw = readU64LE(payload, timestampOffset);
    pos += 8;
    if (raw == null) break;
    const unixSeconds = arcTimestampToUnixSeconds(raw);
    if (!Number.isFinite(unixSeconds)) break;

    const rewardKey = decodeArcKey(nameRaw) || nameRaw.toString('hex');
    records.push({ rewardKey, timestampOffset, unixSeconds, source: 'arc-miracle-box' });
  }
  return records;
}

// Full record extraction for a captured response payload: tries both known
// response shapes and returns whatever each finds (a payload only ever
// matches one, in practice, since they're different endpoints' responses,
// but nothing here assumes that).
function decodeRecords(payload) {
  return [...scanMonopolyRecords(payload), ...scanArcRecords(payload)];
}

// --- Encoders — true inverses of the decoders above ---
//
// Built so strictVerifyCapture.js's OCR fallback can synthesize a payload
// for a record it only ever saw as on-screen text: run it back through this
// same math and the result is a real, structurally valid packet that
// scanMonopolyRecords/scanArcRecords would decode back to the exact same
// rewardKey/unixSeconds — not a placeholder or a dummy value, an actual
// encoding of that data in the real wire format. Per the user's explicit
// ask: a record recovered via OCR should be indistinguishable, in the
// strict-verify log, from one WinDivert captured directly. The one thing
// this can never reconstruct is the SOURCE bytes of a real transmitted
// packet (there wasn't one to capture) — srcIp/srcPort are filled in by the
// caller from the session's own known endpoint, not by anything here.

// Inverse of decodeRewardKey: given the ASCII string, reconstructs the
// exact byte sequence that would decode back to it. decodeRewardKey treats
// `bytes` as a little-endian base-256 integer m, requires m % 4 === 0, sets
// v = m / 4, then reads v's low N bytes (N = bytes.length - 1) as the
// string's chars. So: build v with byte i = charCode(i) for i in
// [0, str.length), multiply by 4 to get m (always exactly reversible — the
// low N bytes of v/hence v*4/4 round-trip exactly), then emit m as
// str.length + 1 little-endian bytes (always enough room: v uses at most
// str.length * 8 bits, so m = v * 4 uses at most str.length * 8 + 2 bits,
// which always fits in str.length + 1 bytes).
//
// Accepts non-string input defensively (via String(rawStr)) — confirmed
// live this matters: matchOcrRewardName (rewardNameMatcher.js) and
// resolveRewardName (rewardMappings.js) both return a character pull's `id`
// as a NUMBER (e.g. 1021, not "1021"), and a Number has no .length/
// .charCodeAt, so passing one straight through silently produced
// `Buffer.alloc(undefined + 1)` = `Buffer.alloc(NaN)`, crashing the sync
// the moment OCR ever recovered a character pull. Real characters' reward
// keys are digit strings anyway (resolveRewardName's own
// `/^\d+$/.test(rawKey)` check), so String(1021) -> "1021" round-trips
// correctly either way.
function encodeRewardKey(rawStr) {
  const str = String(rawStr);
  let v = 0n;
  for (let i = 0; i < str.length; i++) v |= BigInt(str.charCodeAt(i)) << BigInt(8 * i);
  const m = v * 4n;
  const buf = Buffer.alloc(str.length + 1);
  let mm = m;
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Number(mm & 0xffn);
    mm >>= 8n;
  }
  return buf;
}

// Inverse of monopolyTimestampToUnixSeconds. BigInt throughout — the real
// raw values are large enough (unix-seconds-scale * 40,000,000) that plain
// double arithmetic would lose precision.
function encodeMonopolyTimestamp(unixSeconds) {
  return (BigInt(Math.round(unixSeconds)) + 62135596800n) * 40000000n;
}

// Inverse of arcTimestampToUnixSeconds — same reasoning, different tick rate.
function encodeArcTimestamp(unixSeconds) {
  return (BigInt(Math.round(unixSeconds)) + 62135596800n) * 20000000n;
}

// Inverse of decodeArcKey: 'fork_' + one char per mapped byte, lowercase
// a-z from the 0xc2-0xf4 even range, uppercase A-Z from the 0x82-0xb4 even
// range (mirrors decodeArcKey's own mapping exactly). Returns null for a
// key outside that scheme (same contract as decodeArcKey) — the caller
// falls back to the generic monopoly-style encoding for any key that isn't
// a real arc key when needed.
function encodeArcKey(rewardKey) {
  if (!rewardKey.startsWith('fork_')) return null;
  const bytes = [];
  for (const ch of rewardKey.slice(5)) {
    const code = ch.charCodeAt(0);
    if (code >= 97 && code <= 122) bytes.push(0xc2 + (code - 97) * 2); // a-z
    else if (code >= 65 && code <= 90) bytes.push(0x82 + (code - 65) * 2); // A-Z
    else return null;
  }
  // Trailing zero byte matches the shape real captured arc keys show
  // (decodeArcKey tolerates it either way, so this is cosmetic-but-accurate
  // rather than load-bearing).
  return Buffer.concat([ARC_KEY_PREFIX, Buffer.from(bytes), Buffer.from([0])]);
}

// Builds a real, structurally valid monopoly-marker response payload for
// one record — scanMonopolyRecords(this) decodes back to the exact same
// rewardKey/unixSeconds. `marker` defaults to the Limited Character board's
// marker (the only monopoly board this app's navigation.js actually visits
// for Limited/Standard — see this file's header on PERMANENT_MARKER).
function encodeMonopolyRecord({ rewardKey, unixSeconds }, marker = LIMITED_CHARACTER_MARKER) {
  const keyBytes = encodeRewardKey(rewardKey);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64LE(encodeMonopolyTimestamp(unixSeconds));
  // Leading padding up to the fixed 0x50 first-record search offset
  // scanMonopolyRecords assumes — content doesn't matter, only length.
  return Buffer.concat([Buffer.alloc(0x50), keyBytes, marker, tsBuf]);
}

// Builds a real, structurally valid arc-miracle-box response payload for
// one record — scanArcRecords(this) decodes back to the exact same
// rewardKey/unixSeconds. Falls back to the generic encodeRewardKey scheme
// (rather than encodeArcKey) for a rewardKey that isn't 'fork_'-shaped,
// matching decodeArcKey's own caller-side fallback (nameRaw.toString('hex')
// on a null result) as closely as an encoder reasonably can — real arc
// grants are always 'fork_'-shaped in practice, so this branch is a safety
// net, not the expected path.
function encodeArcRecord({ rewardKey, unixSeconds }) {
  const nameBytes = encodeArcKey(rewardKey) ?? encodeRewardKey(rewardKey);
  const nameLen2Buf = Buffer.alloc(4);
  nameLen2Buf.writeUInt32LE(nameBytes.length * 2);
  // Type field is never decoded by scanArcRecords (its bytes are skipped
  // over, not interpreted) — one dummy byte is enough to produce a
  // structurally valid, correctly-skippable field.
  const typeBytes = Buffer.from([0]);
  const typeLen2Buf = Buffer.alloc(4);
  typeLen2Buf.writeUInt32LE(typeBytes.length * 2);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64LE(encodeArcTimestamp(unixSeconds));
  return Buffer.concat([Buffer.alloc(ARC_RESPONSE_FIRST_RECORD_OFFSET), nameLen2Buf, nameBytes, typeLen2Buf, typeBytes, tsBuf]);
}

module.exports = {
  decodeRewardKey,
  monopolyTimestampToUnixSeconds,
  arcTimestampToUnixSeconds,
  decodeArcKey,
  decodeRecords,
  encodeRewardKey,
  encodeMonopolyTimestamp,
  encodeArcTimestamp,
  encodeArcKey,
  encodeMonopolyRecord,
  encodeArcRecord,
};
