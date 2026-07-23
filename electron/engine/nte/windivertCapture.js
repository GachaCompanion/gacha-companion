// WinDivert-based packet capture — a genuine kernel-level alternative to
// both pktmon (packetCapture.js, ETW-based, suspected of dropping events
// under load) and the raw SIO_RCVALL socket (rawSocketCapture.js, confirmed
// via research to be a structurally unreliable mechanism on Windows: it
// sits on top of the normal Winsock/AFD socket layer, where packets can be
// reordered or dropped under load before the raw socket ever sees them,
// independent of anything this app controls — see captureOrchestrator.js's
// header for the investigation that led here). Neither prior method is
// deleted — this is a new, third option, kept alongside them so nothing is
// lost if this one doesn't pan out either.
//
// WinDivert is a real NDIS/WFP-level kernel driver (same category as
// Npcap, which Wireshark/tcpdump rely on for reliable capture), but
// LGPL-licensed rather than Npcap's paid OEM-redistribution model — the
// specific reason it was chosen over Npcap for this app. The official
// pre-built, pre-signed binaries (WinDivert.dll/WinDivert64.sys, from
// https://github.com/basil00/WinDivert release v2.2.2) are vendored
// directly in ./windivert/ — no separate installer, no user-facing setup
// step. WinDivertOpen() installs the driver silently on first use, but
// only from an already-elevated process (same requirement this app's
// elevated worker already satisfies via the Scheduled Task mechanism — see
// elevatedWorker.js).
//
// Critical correctness point, verified against the official docs before
// writing any of this: WinDivert's DEFAULT behavior is to actually
// INTERCEPT matching traffic — a diverted packet is not delivered to its
// real destination unless the application explicitly re-injects it via
// WinDivertSend(). Opened without WINDIVERT_FLAG_SNIFF, this module would
// silently break NTE's own network connection (or any other UDP traffic
// matching the filter) by consuming packets that were never reaching their
// destination. WINDIVERT_FLAG_SNIFF makes it purely passive — "copied-and-
// diverted" rather than "dropped-and-diverted" — the packet still reaches
// its real destination on its own, we just get a copy. Combined with
// WINDIVERT_FLAG_RECV_ONLY (belt-and-suspenders — this handle is never used
// for WinDivertSend at all).
//
// Filtering happens at the kernel level via WinDivert's own filter
// language ("udp") rather than capturing everything and filtering in JS —
// a real efficiency advantage over the raw-socket approach, which had no
// equivalent capability and had to decode every captured packet
// unconditionally.
//
// 2026-07-14 update: a real capture found a large multi-pull batch (~16
// items spanning several response packets) getting cut off partway through,
// right at the tail of a page walk — verified genuinely absent (not
// misattributed elsewhere) by grepping the full debug log for that batch's
// timestamp. Three changes made together to address this:
//   1. Real driver-level capture timestamps: WINDIVERT_ADDRESS.Timestamp is
//      set by the driver at the actual moment of interception (not when our
//      JS callback gets around to processing it, unlike the Date.now()
//      placeholder used before) — converted from QueryPerformanceCounter
//      ticks to a wall-clock ms value via a reference pair captured once at
//      startCapture(). This is strictly more accurate than the previous
//      approximation, not just a diagnostic nicety.
//   2. Multiple concurrent WinDivertRecv calls posted on the SAME handle
//      (RECV_CONCURRENCY, set to 5 per the user) instead of one serialized
//      recv-process-recv loop — closes the small window after each packet
//      where nothing was listening while the JS callback ran, which
//      matters specifically for a burst of several packets landing within
//      that same tiny window. Confirmed before relying on this: koffi's
//      async worker pool scales with CPU core count (not a small fixed
//      pool like libuv's default), so 5 concurrent calls genuinely run in
//      parallel rather than silently queuing behind a smaller pool.
//      (Opening multiple separate WinDivert HANDLES would NOT achieve the
//      same thing — in sniff mode each handle gets its own independent
//      copy of every matching packet, so 2 handles means 2x duplicated
//      data, not split load. Concurrency has to happen via multiple
//      pending receives on one handle instead.)
//   3. WinDivertSetParam raised to the documented maximums for queue
//      length/time/size, so the driver itself has more headroom to hold
//      packets if all 5 receivers are still momentarily busy.

const koffi = require('koffi');
const path = require('path');

let _windivertDll = null;
function windivertDll() {
  if (!_windivertDll) _windivertDll = koffi.load(path.join(__dirname, 'windivert', 'WinDivert.dll'));
  return _windivertDll;
}

let _kernel32 = null;
function kernel32() {
  if (!_kernel32) _kernel32 = koffi.load('kernel32.dll');
  return _kernel32;
}

let _fns = null;
function fns() {
  if (_fns) return _fns;
  const w = windivertDll();
  const k = kernel32();
  _fns = {
    WinDivertOpen: w.func('intptr __stdcall WinDivertOpen(str filter, int32 layer, int16 priority, uint64 flags)'),
    WinDivertRecv: w.func('bool __stdcall WinDivertRecv(intptr handle, void* pPacket, uint32 packetLen, void* pRecvLen, void* pAddr)'),
    WinDivertSetParam: w.func('bool __stdcall WinDivertSetParam(intptr handle, int32 param, uint64 value)'),
    WinDivertClose: w.func('bool __stdcall WinDivertClose(intptr handle)'),
    GetLastError: k.func('uint32 __stdcall GetLastError()'),
    QueryPerformanceCounter: k.func('bool __stdcall QueryPerformanceCounter(void* lpPerformanceCount)'),
    QueryPerformanceFrequency: k.func('bool __stdcall QueryPerformanceFrequency(void* lpFrequency)'),
  };
  return _fns;
}

const WINDIVERT_LAYER_NETWORK = 0;
const WINDIVERT_FLAG_SNIFF = 0x0001;
const WINDIVERT_FLAG_RECV_ONLY = 0x0004;
const WINDIVERT_PRIORITY_DEFAULT = 0;
// 40 (max IP header incl. options) + 0xFFFF (max IP total-length field) —
// the documented upper bound for any single packet WinDivertRecv can hand
// back at the network layer.
const WINDIVERT_MTU_MAX = 40 + 0xffff;
// Real struct size per windivert.h: INT64 Timestamp(8) + packed bitfield
// UINT32(4) + UINT32 Reserved2(4) + a union whose largest member
// (Reserved3[64]) is 64 bytes = 80 bytes total.
const WINDIVERT_ADDRESS_SIZE = 80;

// Documented maximums (windivert.h) — raised from the (already reasonable)
// defaults to give the driver's own queue as much headroom as it supports,
// on top of the 5-concurrent-receiver change below.
const WINDIVERT_PARAM_QUEUE_LENGTH = 0;
const WINDIVERT_PARAM_QUEUE_TIME = 1;
const WINDIVERT_PARAM_QUEUE_SIZE = 2;
const WINDIVERT_PARAM_QUEUE_LENGTH_MAX = 16384; // packets
const WINDIVERT_PARAM_QUEUE_TIME_MAX = 16000;   // ms
const WINDIVERT_PARAM_QUEUE_SIZE_MAX = 33554432; // bytes (32MB)

// Number of WinDivertRecv calls kept posted concurrently on the single
// capture handle — see this file's header for why this has to be
// concurrent receives on ONE handle, not multiple handles. Cost is
// negligible (each is just an idle OS thread waiting on the driver, not
// spinning) — 5 was chosen as generously more than the observed largest
// batch's packet count needed, not a tightly-tuned minimum.
const RECV_CONCURRENCY = 5;

// Parses one raw captured IPv4 payload down to its UDP fields — same logic
// as rawSocketCapture.js's parseUdpFrame/parseIpUdp (WinDivert at
// WINDIVERT_LAYER_NETWORK hands back the complete packet including all
// headers, same as a raw IP socket — no link layer either way, confirmed
// against the official docs before relying on it).
function parseIpUdp(data) {
  if (data.length < 20) return null;
  const versionIhl = data[0];
  if ((versionIhl >> 4) !== 4) return null;
  const ihl = (versionIhl & 0x0f) * 4;
  if (data[9] !== 17) return null; // UDP only
  if (data.length < ihl + 8) return null;

  const srcIp = `${data[12]}.${data[13]}.${data[14]}.${data[15]}`;
  const dstIp = `${data[16]}.${data[17]}.${data[18]}.${data[19]}`;
  const srcPort = data.readUInt16BE(ihl);
  const dstPort = data.readUInt16BE(ihl + 2);
  const udpLength = data.readUInt16BE(ihl + 4);
  const payloadStart = ihl + 8;
  const payloadLength = Math.max(0, Math.min(udpLength - 8, data.length - payloadStart));
  const payload = data.subarray(payloadStart, payloadStart + payloadLength);
  return { srcIp, dstIp, srcPort, dstPort, payload };
}

let session = null; // { handle, packets, stopped, qpcRef, qpcFreq, wallClockRefMs }

// Converts a WINDIVERT_ADDRESS.Timestamp (QueryPerformanceCounter ticks,
// the driver's own real interception time) to a wall-clock millisecond
// value, using the reference pair captured once at startCapture(). Strictly
// more accurate than stamping Date.now() at the moment our JS callback
// happens to run, which only reflects when we got around to processing a
// packet, not when it actually arrived.
function qpcToWallClockMs(sess, qpcTicks) {
  const elapsedSeconds = Number(qpcTicks - sess.qpcRef) / Number(sess.qpcFreq);
  return sess.wallClockRefMs + elapsedSeconds * 1000;
}

// One of RECV_CONCURRENCY independent receive loops running against the
// same handle — each has its OWN buffers (no sharing between loops, so no
// data races), and each only recurses into its next receive from inside its
// own previous callback. Having several of these posted at once is what
// closes the gap a single serialized loop has: with only one loop, there's
// a window after every packet where nothing is listening while the JS
// callback runs; with several, the driver always has an idle receiver
// ready regardless of how many land in a tight burst.
function runRecvLoop(sess) {
  const { WinDivertRecv } = fns();
  const packetBuf = Buffer.alloc(WINDIVERT_MTU_MAX);
  const recvLenBuf = Buffer.alloc(4);
  const addrBuf = Buffer.alloc(WINDIVERT_ADDRESS_SIZE);

  function step() {
    if (sess.stopped) return;
    WinDivertRecv.async(sess.handle, packetBuf, packetBuf.length, recvLenBuf, addrBuf, (_err, ok) => {
      if (sess.stopped) return;
      if (ok) {
        const recvLen = recvLenBuf.readUInt32LE(0);
        const parsed = parseIpUdp(packetBuf.subarray(0, recvLen));
        if (parsed && parsed.payload.length > 0) {
          const qpcTicks = addrBuf.readBigInt64LE(0); // WINDIVERT_ADDRESS.Timestamp, offset 0
          sess.packets.push({
            timestampMicros: qpcToWallClockMs(sess, qpcTicks) * 1000,
            srcIp: parsed.srcIp,
            dstIp: parsed.dstIp,
            srcPort: parsed.srcPort,
            dstPort: parsed.dstPort,
            payload: Buffer.from(parsed.payload), // clone — packetBuf is reused next call
          });
        }
      }
      step();
    });
  }
  step();
}

// Starts a fresh capture. Only one capture can be active at a time (matches
// packetCapture.js/rawSocketCapture.js's contract).
async function startCapture() {
  if (session) throw new Error('WinDivert capture already running');

  const { WinDivertOpen, WinDivertSetParam, GetLastError, QueryPerformanceCounter, QueryPerformanceFrequency } = fns();
  const flags = BigInt(WINDIVERT_FLAG_SNIFF | WINDIVERT_FLAG_RECV_ONLY);
  const handle = WinDivertOpen('udp', WINDIVERT_LAYER_NETWORK, WINDIVERT_PRIORITY_DEFAULT, flags);
  // INVALID_HANDLE_VALUE is all-bits-set, which round-trips through koffi's
  // intptr as -1 (same convention already confirmed for SOCKET handles in
  // rawSocketCapture.js).
  if (handle === -1 || handle === 0) {
    throw new Error(`WinDivertOpen failed, GetLastError=${GetLastError()}`);
  }

  WinDivertSetParam(handle, WINDIVERT_PARAM_QUEUE_LENGTH, BigInt(WINDIVERT_PARAM_QUEUE_LENGTH_MAX));
  WinDivertSetParam(handle, WINDIVERT_PARAM_QUEUE_TIME, BigInt(WINDIVERT_PARAM_QUEUE_TIME_MAX));
  WinDivertSetParam(handle, WINDIVERT_PARAM_QUEUE_SIZE, BigInt(WINDIVERT_PARAM_QUEUE_SIZE_MAX));

  // Reference pair for converting future WINDIVERT_ADDRESS.Timestamp (QPC
  // ticks) values to wall-clock time — captured once, right after opening,
  // rather than per-packet.
  const qpcBuf = Buffer.alloc(8);
  const freqBuf = Buffer.alloc(8);
  QueryPerformanceCounter(qpcBuf);
  QueryPerformanceFrequency(freqBuf);
  const qpcRef = qpcBuf.readBigInt64LE(0);
  const qpcFreq = freqBuf.readBigInt64LE(0);
  const wallClockRefMs = Date.now();

  session = { handle, packets: [], stopped: false, qpcRef, qpcFreq, wallClockRefMs };
  for (let i = 0; i < RECV_CONCURRENCY; i++) runRecvLoop(session);
  return { ok: true };
}

// Stops the capture and returns everything captured, in the same shape
// pcapParser.js/rawSocketCapture.js return ({ timestampMicros, srcIp,
// dstIp, srcPort, dstPort, payload }[]) so callers don't need to know
// which capture backend produced them.
async function stopCapture() {
  if (!session) return { packets: [] };
  const sess = session;
  session = null;
  sess.stopped = true;
  fns().WinDivertClose(sess.handle);
  // Real capture-time order isn't guaranteed here — with RECV_CONCURRENCY
  // receivers each appending to this array from their own callback, two
  // packets can finish (and get pushed) out of the order they were actually
  // captured in. Every downstream consumer (captureOrchestrator.js) already
  // sorts/reverses by its own logic rather than trusting array order, so
  // this doesn't need fixing here — noted so it isn't mistaken for a bug
  // later.
  return { packets: sess.packets };
}

// Snapshot of everything captured so far, WITHOUT stopping the session —
// lets the per-page verification loop (see navigation.js/captureOrchestrator.js)
// check whether a page's expected records have actually arrived yet before
// deciding it came up short and needs the OCR fallback. Returns a shallow
// copy of the array (not a live reference) since concurrent receive loops
// keep pushing to the real one after this returns.
function peekPackets() {
  if (!session) return [];
  return session.packets.slice();
}

module.exports = { startCapture, stopCapture, peekPackets };
