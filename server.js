// RIFT CLASH — Online server (zero-dependency Node.js)
//   Run:  node server.js            (PORT env supported)
//   Deploy behind an HTTPS host (e.g. Render) and the client auto-uses wss://.
// Serves the game files AND hosts MANY concurrent games (public + private "rooms")
// over WebSocket, each with its own authoritative 30 Hz simulation.
//
// ── Operational environment variables ──────────────────────────────────────
//   PORT              listen port (default 8080)
//   DATA_DIR          writable directory for scores.json. On Render, attach a
//                     Persistent Disk mounted at /var/data and set DATA_DIR=/var/data.
//                     Without it the board lives next to the server and is WIPED
//                     by every redeploy, which is what used to happen.
//   RUN_SECRET        HMAC key for leaderboard run tokens. Set it in production; a
//                     random per-boot key is used if absent, which only means runs
//                     opened before a restart cannot be submitted after it.
//   ALLOWED_ORIGINS   comma-separated origins allowed to open a WebSocket. Default
//                     is "same host as the request", which is correct for Render.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Load the game core (DOM-free) with a window shim ──
global.window = global;
require('./config.js');
require('./maps.js');
require('./weather.js');        // planet feel + weather — must match the client exactly
require('./pathfind.js');
require('./entities.js');
require('./game.js');
require('./ai.js');
require('./daily.js');          // Daily Challenge seed + twist table (shared with the client)
require('./survival.js');       // online co-op Survival wave director
require('./kids.js');           // online co-op Crystal Guard wave director
require('./net_core.js');
const RC = global.RC;
RC.CFG.FOG_ENABLED = false;               // server is omniscient; clients compute their own fog

const PORT = process.env.PORT || 8080;
const DIR = __dirname;

// ══ Abuse limits ══════════════════════════════════════════════════════════
// Every one of these guards something a single unauthenticated client could
// previously do without any limit at all. They are deliberately generous — a real
// player never comes close to any of them.
const LIMITS = {
  MAX_FRAME: 64 * 1024,       // largest WebSocket frame accepted (a command is ~100 bytes)
  MAX_BUFFER: 256 * 1024,     // largest partial-frame buffer held per socket
  MAX_SOCKETS: 400,           // total concurrent connections
  MAX_PER_IP: 8,              // concurrent connections from one address
  MAX_ROOMS: 120,             // total live rooms
  MAX_ROOMS_PER_CLIENT: 3,    // rooms one client may have created and still own
  ROOM_CREATE_MS: 2000,       // minimum gap between one client's room creations
  MSG_PER_SEC: 60,            // sustained message rate per socket (commands + chat)
  MSG_BURST: 180,             // token-bucket ceiling
  MAX_QUEUED_CMDS: 240,       // per room, per tick — anything beyond is dropped
  CHAT_PER_10S: 8,            // chat messages per client per 10 seconds
  CHAT_LEN: 200,              // characters
};

// ══ Global Survival leaderboard ═══════════════════════════════════════════
// Top scores per difficulty. Lives in DATA_DIR when one is configured (a Render
// Persistent Disk), so it survives redeploys; otherwise next to the server, which
// is fine locally and is the old behaviour.
const DATA_DIR = process.env.DATA_DIR || DIR;
try { if (DATA_DIR !== DIR) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* falls back to reads failing, handled below */ }
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
// 'daily' is a board like any other, except rows carry the UTC day they were set
// on and only today's are ever shown. That means the daily board "resets" every
// midnight UTC with no scheduled job and no cleanup step — yesterday's rows just
// stop matching. They're pruned on write so the file can't grow forever.
const DIFFS = ['easy', 'medium', 'insane', 'daily'];
const MAX_ROWS = 100;                    // rows kept per difficulty
const MAX_BODY = 8192;                   // reject oversized POST bodies

// Must match RC.Daily.EPOCH / dayNumber() in daily.js — the client and server
// have to agree on which day it is or nobody's score shows up on their own board.
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;
function dayNumber(now) { return Math.floor(((now == null ? Date.now() : now) - DAILY_EPOCH) / DAY_MS); }

let scores = { easy: [], medium: [], insane: [], daily: [] };
try {
  const raw = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  DIFFS.forEach(d => { if (Array.isArray(raw[d])) scores[d] = raw[d].slice(0, MAX_ROWS); });
  console.log('leaderboard loaded from ' + SCORES_FILE + ':', DIFFS.map(d => d + '=' + scores[d].length).join(' '));
} catch (e) { /* first run, or unreadable/corrupt file — start with an empty board */ }

let saveTimer = null;
function saveScores() {                  // debounced + atomic (write temp, then rename)
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = SCORES_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(scores));
      fs.renameSync(tmp, SCORES_FILE);
    } catch (e) { console.log('leaderboard save failed:', e.message); }
  }, 1500);
}

// Keep names friendly: letters/digits/spaces and a few marks, nothing else.
function cleanName(s) {
  const t = String(s == null ? '' : s)
    .replace(/[^\p{L}\p{N} _\-.!]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return t || 'Anonymous';
}

// ══ Run tokens ════════════════════════════════════════════════════════════
// A Survival score used to be a bare POST of {wave, kills}. The server recomputed
// the SCORE from those, which stopped a client inventing the number — but nothing
// stopped it inventing the wave and kill counts themselves. One request could put
// the maximum possible score (wave 500, 200k kills = 1,050,000) on the board, and
// because only a HIGHER score replaces a name's row, that entry could never be
// displaced by anyone. The board was one request away from being permanently dead.
//
// A run must now be opened before it can be submitted:
//   POST /api/run/start  ->  { token }        HMAC-signed, single use, 6h TTL
//   POST /api/score      <-  { token, wave, kills, waveTimes[] }
// and the submission has to be physically consistent with the wave director that
// actually ships in survival.js: wave N cannot have started before wave N-1 finished
// spawning plus the between-wave gap, and the run cannot claim more game time than
// has passed on the wall clock since the token was issued.
//
// This is not unforgeable and does not try to be — someone determined can drive the
// real client for real hours. It only has to cost more than the reward, and now it does.
const RUN_SECRET = process.env.RUN_SECRET || crypto.randomBytes(32).toString('hex');
const RUN_TTL = 6 * 3600 * 1000;         // a run token is good for six hours
const runTokens = new Map();             // id -> { diff, issuedAt, used }
const MAX_RUN_TOKENS = 20000;

function signRun(id, issuedAt, diff) {
  return crypto.createHmac('sha256', RUN_SECRET)
    .update(id + '.' + issuedAt + '.' + diff).digest('base64url').slice(0, 24);
}
function issueRunToken(diff) {
  if (runTokens.size >= MAX_RUN_TOKENS) pruneRunTokens(true);
  const id = crypto.randomBytes(9).toString('base64url');
  const issuedAt = Date.now();
  runTokens.set(id, { diff, issuedAt, used: false });
  return id + '.' + issuedAt + '.' + signRun(id, issuedAt, diff);
}
// Returns the token record, or a string describing why it is not acceptable.
function checkRunToken(tok, diff) {
  if (typeof tok !== 'string' || tok.length > 120) return 'missing run token';
  const parts = tok.split('.');
  if (parts.length !== 3) return 'malformed run token';
  const id = parts[0], issuedAt = Number(parts[1]), sig = parts[2];
  if (!isFinite(issuedAt)) return 'malformed run token';
  const want = signRun(id, issuedAt, diff);
  // constant-time compare so the signature cannot be probed byte by byte
  if (sig.length !== want.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return 'run token does not match this run';
  const rec = runTokens.get(id);
  if (!rec) return 'that run has expired — play it again to post a score';
  if (rec.used) return 'that run was already submitted';
  if (rec.diff !== diff) return 'run token does not match this run';
  if (Date.now() - rec.issuedAt > RUN_TTL) { runTokens.delete(id); return 'that run has expired — play it again to post a score'; }
  return rec;
}
function consumeRunToken(tok) {
  const rec = runTokens.get(String(tok).split('.')[0]);
  if (rec) rec.used = true;
}
function pruneRunTokens(force) {
  const now = Date.now();
  for (const entry of [...runTokens]) {
    const id = entry[0], r = entry[1];
    if (now - r.issuedAt > RUN_TTL || (r.used && now - r.issuedAt > 60000)) runTokens.delete(id);
  }
  if (force && runTokens.size >= MAX_RUN_TOKENS) {
    // still full of live tokens — drop the oldest half rather than refuse new runs
    const byAge = [...runTokens.entries()].sort((a, b) => a[1].issuedAt - b[1].issuedAt);
    for (let i = 0; i < byAge.length / 2; i++) runTokens.delete(byAge[i][0]);
  }
}
setInterval(() => pruneRunTokens(false), 600000).unref?.();

// The physical floor on how fast wave w can be followed by wave w+1 comes from the
// wave director itself (RC.Survival.minSpacing) rather than from copies of its
// constants kept here. A daily run is reconstructed for the day it was STARTED on,
// not the day it was submitted: a run can be posted up to six hours later and the
// twist changes at UTC midnight. This matters — the Blitz twist cuts the gap to 30%
// and Elite Guard shrinks the waves, so a fixed floor would have rejected honest
// runs on two days out of every seven.
function minWaveSpacing(w, diff, startedAt) {
  if (!RC.Survival || !RC.Survival.minSpacing) return 0;
  const gameLike = { survivalDiff: diff === 'daily' ? 'medium' : diff };
  if (diff === 'daily' && RC.Daily && RC.Daily.today) gameLike.daily = RC.Daily.today(startedAt);
  return RC.Survival.minSpacing(w, gameLike);
}

// The client is not trusted: the score is RECOMPUTED here from waves+kills, the run
// has to have been opened here, and its pacing has to be possible.
function validate(b) {
  if (!b || typeof b !== 'object') return 'bad payload';
  if (DIFFS.indexOf(b.diff) < 0) return 'bad difficulty';
  const wave = Math.floor(Number(b.wave));
  const kills = Math.floor(Number(b.kills));
  if (!isFinite(wave) || wave < 1 || wave > 500) return 'bad wave';
  if (!isFinite(kills) || kills < 0 || kills > 200000) return 'bad kills';
  if (kills > wave * 400 + 200) return 'kills do not match waves';

  const rec = checkRunToken(b.token, b.diff);
  if (typeof rec === 'string') return rec;

  // ── pacing ──
  const times = Array.isArray(b.waveTimes) ? b.waveTimes.map(Number) : null;
  if (!times || times.length !== wave) return 'run log does not match the wave count';
  for (let i = 0; i < times.length; i++) if (!isFinite(times[i]) || times[i] < 0) return 'bad run log';
  for (let i = 1; i < times.length; i++) {
    if (times[i] <= times[i - 1]) return 'run log out of order';
    const need = minWaveSpacing(i, b.diff, rec.issuedAt);   // spacing between wave i and wave i+1
    if (times[i] - times[i - 1] < need * 0.9) return 'run log is faster than the game allows';
  }
  const elapsed = times[times.length - 1];
  const wall = (Date.now() - rec.issuedAt) / 1000;
  // Backgrounding a tab freezes game time but not the clock, so wall >= elapsed
  // always holds for an honest run. The reverse means the run was fast-forwarded —
  // which also closes the dev-mode panel as a route onto the world board.
  if (elapsed > wall * 1.1 + 5) return 'run finished faster than real time';

  const mode = (b.mode === 'coop') ? 'coop' : 'solo';
  const race = (RC.RACES && RC.RACES[b.race]) ? b.race : 'forge';
  const entry = { diff: b.diff, wave, kills, mode, race,
                  score: wave * 100 + kills * 5, name: cleanName(b.name), at: Date.now() };
  if (b.diff === 'daily') {
    // The day is stamped SERVER-side. A client claiming a different day would
    // otherwise be able to park a score on tomorrow's board.
    entry.day = dayNumber(entry.at);
  }
  entry._token = b.token;
  return entry;
}

// One row per name per difficulty — keeps the board varied instead of letting a
// single player occupy every slot.
function submitScore(entry) {
  // Daily board: drop everything that isn't today's challenge before comparing,
  // so yesterday's leader doesn't block today's players out of the top spot.
  if (entry.diff === 'daily') {
    const today = dayNumber();
    scores.daily = scores.daily.filter(r => r.day === today);
  }
  const list = scores[entry.diff];
  const key = entry.name.toLowerCase();
  const prev = list.findIndex(r => String(r.name).toLowerCase() === key);
  let improved = true;
  if (prev >= 0) {
    if (list[prev].score >= entry.score) { improved = false; }
    else list.splice(prev, 1);
  }
  const row = { diff: entry.diff, wave: entry.wave, kills: entry.kills, mode: entry.mode,
                race: entry.race, score: entry.score, name: entry.name, at: entry.at };
  if (entry.day != null) row.day = entry.day;
  if (improved) list.push(row);
  list.sort((a, b) => b.score - a.score || a.at - b.at);
  scores[entry.diff] = list.slice(0, MAX_ROWS);
  saveScores();
  const rank = scores[entry.diff].findIndex(r =>
    String(r.name).toLowerCase() === key && r.score >= entry.score);
  return { improved, rank: rank >= 0 ? rank + 1 : null, total: scores[entry.diff].length };
}

// Light per-IP rate limit so nobody can spam the board.
const rate = new Map();
function rateOk(ip, cap, win) {
  const now = Date.now();
  cap = cap || 40; win = win || 3600000;
  const r = rate.get(ip);
  if (!r || now > r.reset) { rate.set(ip, { n: 1, reset: now + win }); return true; }
  if (r.n >= cap) return false;
  r.n++; return true;
}
setInterval(() => {                                    // drop expired buckets
  const now = Date.now();
  for (const entry of [...rate]) if (now > entry[1].reset) rate.delete(entry[0]);
}, 600000).unref?.();

function ipOf(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         (req.socket && req.socket.remoteAddress) || 'unknown';
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, res, cb) {
  let body = '', aborted = false;
  req.on('data', c => {
    body += c;
    if (body.length > MAX_BODY) { aborted = true; sendJson(res, 413, { ok: false, error: 'too large' }); req.destroy(); }
  });
  req.on('end', () => {
    if (aborted) return;
    let parsed;
    try { parsed = JSON.parse(body || '{}'); } catch (e) { sendJson(res, 400, { ok: false, error: 'bad json' }); return; }
    cb(parsed);
  });
}

// ── Static file server (+ leaderboard API) ──
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
               '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
               '.txt': 'text/plain' };
// Never served, however the path is spelled. The server source and the score file
// have no business going out to every visitor, and neither does the test suite.
const PRIVATE_FILES = new Set(['server.js', 'scores.json', 'scores.json.tmp', 'package.json']);
const PRIVATE_DIRS = ['tests'];

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  let p = decodeURIComponent(url.split('?')[0]);

  // ── API ──
  if (p === '/api/scores' && req.method === 'GET') {
    const q = new URLSearchParams(url.split('?')[1] || '');
    const diff = DIFFS.indexOf(q.get('diff')) >= 0 ? q.get('diff') : 'medium';
    const limit = Math.max(1, Math.min(MAX_ROWS, parseInt(q.get('limit') || '25', 10) || 25));
    if (diff === 'daily') {
      const today = dayNumber();
      sendJson(res, 200, { diff, day: today, rows: scores.daily.filter(r => r.day === today).slice(0, limit) });
      return;
    }
    sendJson(res, 200, { diff, rows: scores[diff].slice(0, limit) });
    return;
  }
  // Open a run. Called when Survival wave 1 starts; the token comes back at the end.
  if (p === '/api/run/start' && req.method === 'POST') {
    const ip = ipOf(req);
    if (!rateOk('run:' + ip, 120, 3600000)) { sendJson(res, 429, { ok: false, error: 'too many runs — try again later' }); return; }
    readBody(req, res, (b) => {
      const diff = DIFFS.indexOf(b && b.diff) >= 0 ? b.diff : 'medium';
      sendJson(res, 200, { ok: true, token: issueRunToken(diff), diff });
    });
    return;
  }
  if (p === '/api/score' && req.method === 'POST') {
    const ip = ipOf(req);
    if (!rateOk(ip)) { sendJson(res, 429, { ok: false, error: 'too many submissions — try again later' }); return; }
    readBody(req, res, (parsed) => {
      const entry = validate(parsed);
      if (typeof entry === 'string') { sendJson(res, 400, { ok: false, error: entry }); return; }
      consumeRunToken(entry._token);
      const r = submitScore(entry);
      sendJson(res, 200, {
        ok: true, rank: r.rank, improved: r.improved, score: entry.score,
        name: entry.name, rows: scores[entry.diff].slice(0, 25),
      });
    });
    return;
  }

  // ── static ──
  if (p === '/') p = '/index.html';
  const file = path.join(DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIR)) { res.writeHead(403); res.end(); return; }
  const rel = path.relative(DIR, file).split(path.sep);
  if (PRIVATE_FILES.has(rel[rel.length - 1]) || PRIVATE_DIRS.indexOf(rel[0]) >= 0) {
    res.writeHead(404); res.end('not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(data);
  });
});

// ── Minimal RFC6455 WebSocket ──
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// A browser always sends Origin. A non-browser client (our own test harness) may
// not, and that is allowed — the point of this check is to stop a page on someone
// else's domain from driving this server, not to authenticate anybody.
function originOk(req) {
  const o = String(req.headers.origin || '').trim().toLowerCase();
  if (!o) return true;
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS.indexOf(o) >= 0;
  const host = String(req.headers.host || '').toLowerCase();
  if (!host) return false;
  return o === 'http://' + host || o === 'https://' + host;
}

const ipSockets = new Map();             // ip -> count
function ipCount(ip, delta) {
  const n = (ipSockets.get(ip) || 0) + delta;
  if (n <= 0) ipSockets.delete(ip); else ipSockets.set(ip, n);
  return n;
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  if (!originOk(req)) { try { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch (e) {} socket.destroy(); return; }
  const ip = ipOf(req);
  if (sockets.size >= LIMITS.MAX_SOCKETS) { try { socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); } catch (e) {} socket.destroy(); return; }
  if ((ipSockets.get(ip) || 0) >= LIMITS.MAX_PER_IP) { try { socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n'); } catch (e) {} socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
               'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnect(socket, ip);
});

function wsFrame(str, opcode) {
  opcode = opcode || 0x1;                       // 0x1 text
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  return Buffer.concat([header, payload]);
}
function wsSend(socket, str) { try { socket.write(wsFrame(str, 0x1)); } catch (e) { /* closed */ } }
function wsSendBuf(socket, buf) { try { socket.write(buf); } catch (e) { /* closed */ } }
function wsPing(socket) { try { socket.write(Buffer.from([0x89, 0x00])); } catch (e) { } }   // opcode 0x9, empty
function wsPong(socket) { try { socket.write(Buffer.from([0x8A, 0x00])); } catch (e) { } }   // opcode 0xA, empty

// Frame parser (masking, 7/16/64-bit lengths). Handles text + close + ping/pong.
//
// The length field is 64 bits wide and used to be trusted: a client could declare a
// 4 GB frame and this parser would keep Buffer.concat-ing chunks until the process
// died. Both the declared length and the accumulated buffer are now bounded, and
// breaching either kills that one connection instead of the server.
function makeParser(onMsg, onClose, onPing, onPong, onAbuse) {
  let buf = Buffer.alloc(0);
  let dead = false;
  return (chunk) => {
    if (dead) return;
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > LIMITS.MAX_BUFFER) { dead = true; onAbuse('frame buffer overflow'); return; }
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(LIMITS.MAX_FRAME)) { dead = true; onAbuse('oversized frame'); return; }
        len = Number(big); off = 10;
      }
      if (len > LIMITS.MAX_FRAME) { dead = true; onAbuse('oversized frame'); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let ps = off, mask = null;
      if (masked) { mask = buf.slice(off, off + 4); ps = off + 4; }
      const payload = Buffer.from(buf.slice(ps, ps + len));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.slice(need);
      if (opcode === 0x8) { onClose(); return; }
      else if (opcode === 0x9) { if (onPing) onPing(); }
      else if (opcode === 0xA) { if (onPong) onPong(); }
      else if (opcode === 0x1) onMsg(payload.toString('utf8'));
    }
  };
}

// ── Rooms + clients ──
let nextClientId = 1, nextRoomId = 1;
const rooms = new Map();      // roomId -> room
const sockets = new Set();    // all connected client objects

function makeCode() {
  const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no ambiguous chars
  let c = '';
  do { c = ''; for (let i = 0; i < 4; i++) c += s[(Math.random() * s.length) | 0]; }
  while (roomByCode(c));
  return c;
}
function roomByCode(code) { for (const r of rooms.values()) if (r.code === code) return r; return null; }

function send(c, obj) { wsSend(c.socket, JSON.stringify(obj)); }
function roomBroadcast(room, obj) { const s = JSON.stringify(obj); room.clients.forEach(c => wsSend(c.socket, s)); }
function isHost(c) { return c.room && c.room.clients.length && c.room.clients[0] === c; }

function onConnect(socket, ip) {
  const c = {
    socket, ip, id: nextClientId++, name: 'Player ' + nextClientId, race: 'forge', room: null,
    voice: false,
    tokens: LIMITS.MSG_BURST, lastRefill: Date.now(), chatTimes: [],
  };
  sockets.add(c);
  ipCount(ip, +1);
  send(c, {
    t: 'welcome', id: c.id,
    maps: RC.MAPS.map(m => ({ id: m.id, name: m.name })),
    modes: Object.values(RC.MODES).map(m => ({ id: m.id, name: m.name })),
    races: RC.RACE_ORDER.map(r => ({ id: r, name: RC.RACES[r].name })),
  });
  sendRoomList(c);
  send(c, presencePayload());
  broadcastPresence();

  const kill = () => {
    try { socket.write(Buffer.from([0x88, 0x00])); } catch (e) {}
    try { socket.destroy(); } catch (e) {}
    onClose(c);
  };

  // A close frame has to be answered with a close frame, and then the socket has to
  // actually end. Without this the peer sits in CLOSING until its own timeout fires:
  // a browser that closed cleanly never gets its `onclose` event, so the client's
  // reconnect never even starts. Invisible until there was something to reconnect TO.
  const closeHandshake = () => {
    try { socket.write(Buffer.from([0x88, 0x00])); } catch (e) {}
    try { socket.end(); } catch (e) {}
    onClose(c);
  };

  const parse = makeParser(
    (text) => {
      if (!allowMsg(c)) { kill(); return; }
      let m; try { m = JSON.parse(text); } catch (e) { return; }
      try { onMsg(c, m); } catch (e) { console.log('message handler error:', e && e.message); }
    },
    closeHandshake,
    () => wsPong(socket),        // reply to client ping
    () => { },                   // pong received — connection is alive
    () => kill()
  );
  socket.on('data', parse);
  socket.on('error', () => onClose(c));
  socket.on('close', () => onClose(c));
}

// Token bucket: a normal client sends a handful of messages a second; a flooder
// drains the bucket in well under a second and gets disconnected.
function allowMsg(c) {
  const now = Date.now();
  const refill = (now - c.lastRefill) / 1000 * LIMITS.MSG_PER_SEC;
  if (refill > 0) { c.tokens = Math.min(LIMITS.MSG_BURST, c.tokens + refill); c.lastRefill = now; }
  if (c.tokens < 1) return false;
  c.tokens -= 1;
  return true;
}

const closing = new WeakSet();
function onClose(c) {
  if (closing.has(c)) return;
  closing.add(c);
  sockets.delete(c);
  ipCount(c.ip, -1);
  if (c.room) leaveRoom(c);
  broadcastPresence();
}

// ── Room lifecycle ──
// 방 정원 — 대전은 모드 인원수, 생존은 방어자 최대 4명(맵의 base 수)
const SURVIVAL_CAP = 4;
const SURVIVAL_SEATS = [1, 3, 4, 5];       // owner 2 is reserved for the wave horde
// Crystal Guard co-op is a pair. It is the mode a grown-up plays sitting next to a kid,
// and the map gives each defender their own base ringed around the one crystal; four
// bases around it leaves no room to fight in. Two also keeps the wave curve honest —
// the whole appeal is a gentle ramp, and it is tuned for one or two armies, not four.
const KIDS_CAP = 2;
const KIDS_SEATS = [1, 3];
const RESUME_GRACE_MS = 90000;             // how long a dropped seat is held open
function roomCap(room) {
  if (room.lobby.gameMode === 'survival') return SURVIVAL_CAP;
  if (room.lobby.gameMode === 'kids') return KIDS_CAP;
  return (RC.MODES[room.lobby.modeId] || {}).count || 4;
}
const WAVE_MODES = ['survival', 'kids'];
function isWaveMode(room) { return WAVE_MODES.indexOf(room.lobby.gameMode) >= 0; }

// Names and room names are rendered in OTHER players' browsers, so they must never
// carry markup. The client's cleanName already strips this, but a hand-rolled
// WebSocket client can skip the client entirely — so we re-sanitize here, at the
// trust boundary. Blocks stored XSS via nicknames / room names.
function sanitizeName(s, max) {
  return String(s || '')
    .replace(/[<>&"'`\\]/g, '')                  // hard-block HTML/attribute delimiters
    .replace(/[^\p{L}\p{N} _\-.!?]/gu, '')        // keep letters, numbers, basic punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 16);
}

function createRoom(host, name, isPublic, gameMode) {
  const room = {
    id: nextRoomId++, code: makeCode(),
    name: (sanitizeName(name, 20) || (host.name + "'s Game")),
    public: !!isPublic,
    clients: [],
    game: null, loop: null, tickN: 0, cmdQueue: [],
    ownerOf: new Map(), teamOf: {},
    seats: new Map(),                      // owner -> { token, name, race, clientId, goneAt }
    creator: host.id,
    // gameMode: 'vs' (map + 1v1/2v2) | 'survival' (co-op vs endless waves, difficulty
    //           instead of map) | 'kids' (Crystal Guard co-op, no pickers at all)
    lobby: {
      mapId: RC.MAPS[0].id, modeId: '1v1', started: false,
      gameMode: (gameMode === 'survival' || gameMode === 'kids') ? gameMode : 'vs', diff: 'medium',
      // Host switch. Voice is available in every room, but the host can turn it off
      // for everyone — which matters the moment a public room turns unpleasant.
      voice: true,
    },
  };
  rooms.set(room.id, room);
  joinRoom(host, room);
  return room;
}

// ── Readiness ──────────────────────────────────────────────────────────────
// Only the host can start a match (see isHost / case 'start'), but the host used to
// be able to do it the instant someone appeared — before they had picked a faction,
// or while they were still reading the map. Guests now arm the start explicitly.
// The host is exempt: pressing Start *is* their consent, so asking them to also tick
// Ready would just be an extra click every single match.
function isReadyToStart(room) {
  if (!room || !room.clients.length) return false;
  // Crystal Guard is the one mode where a lone host has nothing to gain by starting:
  // solo Crystal Guard is complete OFFLINE and needs no server, there is no bot to fill
  // the second seat, and a one-player co-op run is just the offline mode with latency.
  if (room.lobby.gameMode === 'kids' && room.clients.length < 2) return false;
  // A host ALONE in the room may start: startMatch() fills every empty seat with a bot
  // (seat.ai = !human), so a solo online game is a real, supported match. Requiring a
  // second human here was wrong — with nobody else online it left the only available
  // path, "create a game", at a lobby that could never be started.
  // The gate exists to stop a host starting before HUMANS who are present have agreed,
  // and slice(1) is vacuously true when there is nobody else, which is exactly right.
  return room.clients.slice(1).every(g => g.ready);
}
// Anything that changes what game you agreed to play invalidates that agreement.
// Faction is deliberately excluded — that's each player's own business and resetting
// on it would make a 4-player co-op lobby almost impossible to ever start.
function clearReady(room) {
  if (!room) return;
  room.clients.forEach(g => { g.ready = false; });
}

function joinRoom(c, room) {
  if (c.room) leaveRoom(c);
  c.room = room;
  c.voice = false;                       // voice never starts live for a new arrival
  c.ready = false;                       // every arrival starts un-readied
  room.clients.push(c);
  send(c, {
    t: 'joined', roomId: room.id, code: room.code, name: room.name, public: room.public,
    voiceAllowed: room.lobby.voice,
  });
  send(c, voiceRoster(room));            // who is already on the call
  pushLobby(room);
  broadcastRoomList();
  broadcastPresence();
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  c.voice = false;                       // leaving the room leaves the call
  c.ready = false;                       // and un-arms them, so a re-join starts clean
  room.clients = room.clients.filter(x => x !== c);
  if (room.lobby.started && room.game) {
    const owner = room.ownerOf.get(c.socket);
    if (owner != null) {
      // The seat is NOT given away. Its army is handed to the AI so the match keeps
      // moving, and the seat is held open for RESUME_GRACE_MS so a player whose wifi
      // blinked — or who backgrounded the browser on a phone — can come back to it.
      // This used to be a permanent conversion with no way home, and it is the flaw
      // a real player hits in their first few online games.
      const p = room.game.players.find(pp => pp.owner === owner);
      if (p) p.ai = true;
      room.ownerOf.delete(c.socket);
      const seat = room.seats.get(owner);
      if (seat) { seat.goneAt = Date.now(); seat.clientId = null; }
      roomBroadcast(room, { t: 'seat', owner, status: 'disconnected', name: seat ? seat.name : '', graceMs: RESUME_GRACE_MS });
    }
    if (room.ownerOf.size === 0 && !hasReservedSeat(room)) stopMatch(room);
  }
  // A room with nobody in it is normally destroyed — unless a match is running and a
  // seat is still being held for someone, in which case the simulation has to keep
  // ticking or there is nothing to come back to.
  if (room.clients.length === 0 && !(room.lobby.started && hasReservedSeat(room))) destroyRoom(room);
  else { pushLobby(room); pushVoiceRoster(room); }
  broadcastRoomList();
  broadcastPresence();
}

function hasReservedSeat(room) {
  const now = Date.now();
  for (const s of room.seats.values()) {
    if (s.goneAt && now - s.goneAt < RESUME_GRACE_MS) return true;
  }
  return false;
}

// Sweeper: release seats whose grace has run out, then clean up rooms that are left
// empty. Without this a room whose players all dropped would tick forever.
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!room.lobby.started) continue;
    let changed = false;
    for (const entry of [...room.seats]) {
      const owner = entry[0], s = entry[1];
      if (s.goneAt && now - s.goneAt >= RESUME_GRACE_MS) {
        room.seats.delete(owner);
        changed = true;
        roomBroadcast(room, { t: 'seat', owner, status: 'gone', name: s.name });
      }
    }
    if (room.clients.length === 0 && !hasReservedSeat(room)) { stopMatch(room); destroyRoom(room); changed = true; }
    if (changed) broadcastRoomList();
  }
}, 5000).unref?.();

function destroyRoom(room) {
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
  rooms.delete(room.id);
}

// ── Lobby + room-list payloads ──
function lobbyState(room) {
  return {
    t: 'lobby', roomId: room.id, code: room.code, name: room.name, public: room.public,
    mapId: room.lobby.mapId, modeId: room.lobby.modeId, started: room.lobby.started,
    gameMode: room.lobby.gameMode, diff: room.lobby.diff, cap: roomCap(room),
    voiceAllowed: room.lobby.voice,
    hostId: room.clients.length ? room.clients[0].id : null,
    canStart: isReadyToStart(room),
    players: room.clients.map(c => ({ id: c.id, name: c.name, race: c.race, voice: c.voice, ready: !!c.ready })),
  };
}
function pushLobby(room) { if (!room.lobby.started) roomBroadcast(room, lobbyState(room)); }

// Who in this room has their microphone on. Sent to the whole room (including
// players who are not in voice) so the lobby can show who is talkable-to, and
// sent whether or not the match has started — voice outlives the lobby screen.
function voiceRoster(room) {
  return {
    t: 'voicePeers',
    allowed: room.lobby.voice,
    peers: room.clients.filter(c => c.voice).map(c => ({ id: c.id, name: c.name })),
  };
}
function pushVoiceRoster(room) { if (room) roomBroadcast(room, voiceRoster(room)); }

function roomListPayload() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.public && !room.lobby.started) {
      list.push({
        id: room.id, name: room.name, players: room.clients.length,
        cap: roomCap(room), mapId: room.lobby.mapId, modeId: room.lobby.modeId,
        gameMode: room.lobby.gameMode, diff: room.lobby.diff,
      });
    }
  }
  return { t: 'rooms', rooms: list };
}
function sendRoomList(c) { send(c, roomListPayload()); }
function broadcastRoomList() {                     // push to everyone currently browsing (not in a room)
  const s = JSON.stringify(roomListPayload());
  sockets.forEach(c => { if (!c.room) wsSend(c.socket, s); });
}

// ── Presence ──
// Who else is actually here. The room list alone never answered that: a player
// could be online and idle in the menu and be completely invisible to everyone.
const PRESENCE_CAP = 60;                           // payload guard, not a player cap
function clientById(id) { for (const c of sockets) if (c.id === id) return c; return null; }
function statusOf(c) { return c.room ? (c.room.lobby.started ? 'ingame' : 'lobby') : 'idle'; }
function presencePayload() {
  const players = [];
  for (const c of sockets) {
    if (players.length >= PRESENCE_CAP) break;
    players.push({ id: c.id, name: c.name, status: statusOf(c) });
  }
  return { t: 'presence', players, total: sockets.size };
}
// Anyone in a running match is already getting 30 Hz snapshots — don't add to it.
function broadcastPresence() {
  const s = JSON.stringify(presencePayload());
  sockets.forEach(c => { if (!c.room || !c.room.lobby.started) wsSend(c.socket, s); });
}

// ── Text chat ──
// There was no way to say anything to anyone without a live microphone. Text is the
// safe default among strangers, and it is what makes voice optional rather than
// necessary. Control characters are stripped, length is capped, and a burst limit
// applies per client.
const CTRL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;
function cleanChat(s) {
  return String(s == null ? '' : s)
    .replace(CTRL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.CHAT_LEN);
}
function chatAllowed(c) {
  const now = Date.now();
  c.chatTimes = (c.chatTimes || []).filter(t => now - t < 10000);
  if (c.chatTimes.length >= LIMITS.CHAT_PER_10S) return false;
  c.chatTimes.push(now);
  return true;
}

// ── Message handling ──
function onMsg(c, m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'setName':
      c.name = sanitizeName(m.name, 16) || c.name;
      if (c.room) pushLobby(c.room);
      broadcastPresence();
      break;
    case 'list': sendRoomList(c); send(c, presencePayload()); break;
    case 'create': {
      const now = Date.now();
      if (now - (c.lastCreate || 0) < LIMITS.ROOM_CREATE_MS) { send(c, { t: 'joinError', msg: 'Give it a second before creating another game.' }); break; }
      if (rooms.size >= LIMITS.MAX_ROOMS) { send(c, { t: 'joinError', msg: 'The server is busy — try again in a moment.' }); break; }
      const owned = [...rooms.values()].filter(r => r.creator === c.id).length;
      if (owned >= LIMITS.MAX_ROOMS_PER_CLIENT) { send(c, { t: 'joinError', msg: 'You already have a game open.' }); break; }
      c.lastCreate = now;
      createRoom(c, m.name, m.public, m.gameMode);
      break;
    }

    case 'chat': {
      if (!c.room) break;
      const text = cleanChat(m.msg);
      if (!text) break;
      if (!chatAllowed(c)) { send(c, { t: 'chat', system: true, msg: 'Slow down a moment.' }); break; }
      roomBroadcast(c.room, { t: 'chat', from: c.id, name: c.name, msg: text, at: Date.now() });
      break;
    }

    // ── Direct invites ──
    // Pull a named player straight into a game: no code to read out, no room to
    // find. The inviter's room is created on demand and shaped to the invite.
    case 'invite': {
      const now = Date.now();
      if (now - (c.lastInvite || 0) < 1500) { send(c, { t: 'inviteError', msg: 'Give it a second before inviting again.' }); break; }
      const target = clientById(m.to);
      if (!target || target === c) { send(c, { t: 'inviteError', msg: 'That player is no longer online.' }); break; }
      if (target.room && target.room.lobby.started) { send(c, { t: 'inviteError', msg: target.name + ' is already in a match.' }); break; }
      if (c.room && c.room.lobby.started) { send(c, { t: 'inviteError', msg: 'Leave your current match first.' }); break; }
      c.lastInvite = now;

      // A kind is only sent from the browser screen ("invite them to a 2v2"). An
      // invite sent from inside a lobby carries none, because the room already has
      // a game type and rewriting it out from under the host would be a surprise.
      const hasKind = (m.kind === 'vs' || m.kind === 'survival' || m.kind === 'kids');
      const gm = (m.kind === 'survival' || m.kind === 'kids') ? m.kind : 'vs';
      const modeId = RC.MODES[m.modeId] ? m.modeId : '1v1';
      let room = c.room;
      if (!room) {
        if (rooms.size >= LIMITS.MAX_ROOMS) { send(c, { t: 'inviteError', msg: 'The server is busy — try again in a moment.' }); break; }
        room = createRoom(c, c.name + "'s Game", false, gm);
      }
      // Only reshape a room we actually host — otherwise we'd rewrite someone else's lobby.
      if (hasKind && isHost(c) && !room.lobby.started) {
        room.lobby.gameMode = gm;
        if (gm === 'vs') room.lobby.modeId = modeId;
        pushLobby(room); broadcastRoomList();
      }
      if (room.clients.length >= roomCap(room)) { send(c, { t: 'inviteError', msg: 'Your game is already full.' }); break; }
      send(target, {
        t: 'invited', from: c.id, fromName: c.name,
        roomId: room.id, code: room.code,
        gameMode: room.lobby.gameMode, modeId: room.lobby.modeId,
      });
      send(c, { t: 'inviteSent', name: target.name });
      break;
    }
    case 'inviteAccept': {
      const room = rooms.get(m.roomId);
      if (!room) { send(c, { t: 'joinError', msg: 'That game no longer exists.' }); break; }
      if (room.lobby.started) { send(c, { t: 'joinError', msg: 'That game has already started.' }); break; }
      if (room.clients.length >= roomCap(room)) { send(c, { t: 'joinError', msg: 'That game filled up.' }); break; }
      joinRoom(c, room);
      break;
    }
    case 'inviteDecline': {
      const target = clientById(m.to);
      if (target) send(target, { t: 'inviteDeclined', name: c.name });
      break;
    }

    // ── Voice chat signalling ──
    // The server never carries any audio. It relays the WebRTC handshake between
    // two players in the SAME room and nothing else — the media itself goes
    // peer-to-peer, so a call costs this process a handful of small messages.
    case 'voiceJoin':
      if (!c.room) break;
      if (!c.room.lobby.voice) { send(c, { t: 'voiceDenied', msg: 'The host has turned voice chat off for this game.' }); break; }
      c.voice = true;
      pushVoiceRoster(c.room);
      pushLobby(c.room);
      break;
    case 'voiceLeave':
      if (!c.voice) break;
      c.voice = false;
      if (c.room) { pushVoiceRoster(c.room); pushLobby(c.room); }
      break;
    // Host switch for the whole room. Turning it off hangs everyone up.
    case 'roomVoice': {
      if (!isHost(c) || !c.room) break;
      c.room.lobby.voice = !!m.on;
      if (!c.room.lobby.voice) c.room.clients.forEach(x => { x.voice = false; });
      pushVoiceRoster(c.room);
      pushLobby(c.room);
      roomBroadcast(c.room, { t: 'chat', system: true,
        msg: c.room.lobby.voice ? 'Voice chat enabled by the host.' : 'Voice chat turned off by the host.' });
      break;
    }
    case 'rtc': {
      // Relay an offer / answer / ICE candidate. Both ends must be in the same
      // room with voice on, or this becomes a way to spray messages at strangers.
      if (!c.room || !c.voice || !c.room.lobby.voice) break;
      const target = clientById(m.to);
      if (!target || target === c || target.room !== c.room || !target.voice) break;
      if (m.kind !== 'offer' && m.kind !== 'answer' && m.kind !== 'ice') break;
      const payload = { t: 'rtc', from: c.id, fromName: c.name, kind: m.kind };
      if (m.kind === 'ice') payload.ice = m.ice; else payload.sdp = m.sdp;
      send(target, payload);
      break;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().slice(0, 8);
      const room = m.roomId ? rooms.get(m.roomId) : roomByCode(code);
      if (!room) { send(c, { t: 'joinError', msg: 'Game not found — check the code.' }); break; }
      if (room.lobby.started) { send(c, { t: 'joinError', msg: 'That game has already started.' }); break; }
      if (room.clients.length >= roomCap(room)) { send(c, { t: 'joinError', msg: 'That game is full.' }); break; }
      joinRoom(c, room);
      break;
    }

    // ── Reconnect ──
    // The client kept the resume token it was handed at match start. If the seat is
    // still being held, it gets it straight back: same owner, same army, mid-match.
    case 'resume': {
      const room = rooms.get(m.roomId);
      if (!room || !room.lobby.started || !room.game) { send(c, { t: 'resumeFailed', msg: 'That match has ended.' }); break; }
      let foundOwner = null, foundSeat = null;
      for (const entry of room.seats) {
        if (entry[1].token && m.token && entry[1].token === m.token) { foundOwner = entry[0]; foundSeat = entry[1]; break; }
      }
      if (!foundSeat) { send(c, { t: 'resumeFailed', msg: 'That seat is no longer available.' }); break; }
      if (foundSeat.clientId != null) { send(c, { t: 'resumeFailed', msg: 'Someone is already playing that seat.' }); break; }
      if (foundSeat.goneAt && Date.now() - foundSeat.goneAt >= RESUME_GRACE_MS) {
        room.seats.delete(foundOwner);
        send(c, { t: 'resumeFailed', msg: 'You were away too long — the seat was released.' });
        break;
      }
      if (c.room && c.room !== room) leaveRoom(c);
      c.room = room;
      c.voice = false;
      if (room.clients.indexOf(c) < 0) room.clients.push(c);
      room.ownerOf.set(c.socket, foundOwner);
      foundSeat.clientId = c.id;
      foundSeat.goneAt = null;
      const p = room.game.players.find(pp => pp.owner === foundOwner);
      if (p) p.ai = false;
      const rosters = room.game.players.map(pp => ({
        owner: pp.owner, team: room.teamOf[pp.owner] != null ? room.teamOf[pp.owner] : pp.team,
        race: pp.race, ai: !!pp.ai,
      }));
      send(c, {
        t: 'resumed',
        roomId: room.id, token: foundSeat.token,
        survival: isWaveMode(room),
        kids: room.lobby.gameMode === 'kids',
        diff: room.lobby.diff, mapId: room.lobby.mapId, modeId: room.lobby.modeId,
        owner: foundOwner, team: room.teamOf[foundOwner], rosters,
      });
      roomBroadcast(room, { t: 'seat', owner: foundOwner, status: 'back', name: foundSeat.name });
      roomBroadcast(room, { t: 'chat', system: true, msg: foundSeat.name + ' reconnected.' });
      broadcastPresence();
      break;
    }

    case 'leave': if (c.room) leaveRoom(c); sendRoomList(c); break;

    // in-room actions
    case 'race': if (c.room && RC.RACES[m.race]) { c.race = m.race; pushLobby(c.room); } break;
    // A guest arming/disarming the start. The host has no ready flag to set.
    case 'ready': {
      if (!c.room || c.room.lobby.started || isHost(c)) break;
      const want = !!m.ready;
      if (c.ready === want) break;
      c.ready = want;
      pushLobby(c.room);
      break;
    }
    case 'map': if (isHost(c) && RC.getMap(m.mapId)) { c.room.lobby.mapId = m.mapId; clearReady(c.room); pushLobby(c.room); broadcastRoomList(); } break;
    case 'mode': if (isHost(c) && RC.MODES[m.modeId]) { c.room.lobby.modeId = m.modeId; clearReady(c.room); pushLobby(c.room); broadcastRoomList(); } break;
    // Survival co-op: host picks the difficulty instead of a map/mode.
    case 'diff': if (isHost(c) && ['easy', 'medium', 'insane'].includes(m.diff)) { c.room.lobby.diff = m.diff; clearReady(c.room); pushLobby(c.room); broadcastRoomList(); } break;
    case 'gamemode': {
      if (!isHost(c) || c.room.lobby.started) break;
      const gm = (m.gameMode === 'survival' || m.gameMode === 'kids') ? m.gameMode : 'vs';
      c.room.lobby.gameMode = gm;
      clearReady(c.room);
      // switching to a tighter cap could leave the room over-full — drop the newest joiners
      while (c.room.clients.length > roomCap(c.room)) {
        const evicted = c.room.clients[c.room.clients.length - 1];
        send(evicted, { t: 'joinError', msg: 'The host switched game mode and the room got smaller.' });
        leaveRoom(evicted);
      }
      pushLobby(c.room); broadcastRoomList();
      break;
    }
    // Authoritative on both counts: a non-host is ignored outright, and even the host
    // is refused until every guest has readied. The client greys its own button out
    // too, but that is a courtesy — this is the check that actually holds.
    case 'start': {
      if (!isHost(c) || !c.room || c.room.lobby.started) break;
      if (!isReadyToStart(c.room)) {
        send(c, { t: 'startDenied', msg: 'Everyone needs to press Ready first.' });
        break;
      }
      startMatch(c.room);
      break;
    }
    case 'cmd': {
      const room = c.room;
      if (!room || !room.game || room.game.over) break;
      const owner = room.ownerOf.get(c.socket);
      if (owner == null) break;
      if (room.cmdQueue.length >= LIMITS.MAX_QUEUED_CMDS) break;   // flood guard: drops rather than grows
      room.cmdQueue.push({ owner, cmd: m.c });
      break;
    }
    case 'restart': if (isHost(c) && c.room && c.room.lobby.started) { stopMatch(c.room); pushLobby(c.room); } break;
  }
}

// ── Match run (per room) ──
function seatToken() { return crypto.randomBytes(12).toString('base64url'); }

// One serialized snapshot, framed once and written to every client in the room.
function broadcastSnapshot(room, g) {
  const buf = wsFrame(JSON.stringify({ t: 'snap', s: RC.Net.serialize(g) }), 0x1);
  room.clients.forEach(c => wsSendBuf(c.socket, buf));
}

function startMatch(room) {
  if (room.lobby.gameMode === 'survival') return startSurvivalMatch(room);
  if (room.lobby.gameMode === 'kids') return startKidsMatch(room);
  const mode = RC.MODES[room.lobby.modeId];
  const seats = mode.players.map(p => ({ owner: p.owner, team: p.team }));
  const humans = room.clients.slice(0, seats.length);      // join order fills seats
  const racePick = {};
  room.ownerOf = new Map(); room.teamOf = {}; room.seats = new Map();
  seats.forEach((seat, i) => {
    const human = humans[i];
    seat.ai = !human;
    room.teamOf[seat.owner] = seat.team;
    if (human) {
      room.ownerOf.set(human.socket, seat.owner);
      racePick[seat.owner] = human.race;
      room.seats.set(seat.owner, { token: seatToken(), name: human.name, race: human.race, clientId: human.id, goneAt: null });
    }
  });
  const hostRace = room.clients[0] ? room.clients[0].race : 'forge';
  seats.forEach(seat => {
    if (seat.ai) {
      const allyHuman = humans.find((h, i) => h && seats[i].team === seat.team);
      // An AI seat mirrors its human ally's faction; a fully-AI enemy team takes any
      // faction other than the host's (3 factions now, so "the opposite one" no longer exists).
      racePick[seat.owner] = allyHuman ? allyHuman.race : RC.otherRace(hostRace);
    }
  });
  const customMode = { id: mode.id, name: mode.name, count: seats.length, players: seats };

  room.game = new RC.Game();
  room.game.heroesEnabled = true;                  // heroes are live online too — the snapshot carries their level, xp and cooldowns (see net_core `hr`)
  room.game.setup(RC.getMap(room.lobby.mapId), customMode, racePick);
  room.lobby.started = true;
  room.cmdQueue = []; room.tickN = 0;

  const rosters = seats.map(s => ({ owner: s.owner, team: s.team, race: racePick[s.owner], ai: s.ai }));
  room.clients.forEach(cl => {
    const owner = room.ownerOf.get(cl.socket);
    const seat = owner != null ? room.seats.get(owner) : null;
    send(cl, { t: 'start', roomId: room.id, resume: seat ? seat.token : null,
               mapId: room.lobby.mapId, modeId: room.lobby.modeId, owner,
               team: room.teamOf[owner], rosters });
  });
  broadcastRoomList();                             // it's no longer joinable — drop from the public list
  broadcastPresence();                             // everyone in it now reads as "In a match"

  const DT = 1 / 30;
  room.loop = setInterval(() => {
    const g = room.game;
    RC.CFG.WORLD_W = g.world.w; RC.CFG.WORLD_H = g.world.h;   // this room's world bounds for this tick
    g.over = null;                                            // server decides the end by TEAM elimination
    const q = room.cmdQueue; room.cmdQueue = [];
    for (const item of q) RC.Net.applyCommand(g, item.owner, item.cmd);
    g.update(DT);
    room.tickN++;
    if (room.tickN % 2 === 0) broadcastSnapshot(room, g);
    const alive = new Set(g.buildings.filter(b => b.def.isCore && !b.dead).map(b => room.teamOf[b.owner]));
    if (alive.size <= 1) {
      roomBroadcast(room, { t: 'over', team: alive.size === 1 ? [...alive][0] : null });
      room.seats = new Map();                       // the match is over; nothing left to resume into
      clearInterval(room.loop); room.loop = null;
    }
  }, 1000 / 30);
}

// ── Survival co-op (per room) ──
// Every human is a DEFENDER on team 1; the endless horde is owner 2 on team 2 and is
// driven by the shared wave director rather than the build-order AI. There is no "win":
// the run ends when the Rift Crystal falls, and everyone gets the same wave/score.
function startSurvivalMatch(room) {
  const humans = room.clients.slice(0, SURVIVAL_CAP);
  const seats = humans.map((h, i) => ({ owner: SURVIVAL_SEATS[i], race: h.race || 'forge', ai: false }));
  // A solo host still gets one allied bot so the lane isn't hopeless; full rooms don't need it.
  if (seats.length === 1) seats.push({ owner: SURVIVAL_SEATS[1], race: seats[0].race, ai: true });

  room.ownerOf = new Map(); room.teamOf = {}; room.seats = new Map();
  humans.forEach((h, i) => {
    room.ownerOf.set(h.socket, seats[i].owner);
    room.seats.set(seats[i].owner, { token: seatToken(), name: h.name, race: seats[i].race, clientId: h.id, goneAt: null });
  });
  seats.forEach(s => { room.teamOf[s.owner] = 1; });
  room.teamOf[2] = 2;

  room.game = new RC.Game();
  room.game.heroesEnabled = true;                  // heroes are live online too — the snapshot carries their level, xp and cooldowns (see net_core `hr`)
  room.game.setupSurvival({ difficulty: room.lobby.diff, players: seats });
  room.lobby.started = true;
  room.cmdQueue = []; room.tickN = 0;

  const rosters = seats.map(s => ({ owner: s.owner, team: 1, race: s.race, ai: s.ai }));
  room.clients.forEach(cl => {
    const owner = room.ownerOf.get(cl.socket);
    const seat = owner != null ? room.seats.get(owner) : null;
    send(cl, {
      t: 'start', survival: true, diff: room.lobby.diff, roomId: room.id,
      resume: seat ? seat.token : null,
      owner, team: 1, rosters,
    });
  });
  broadcastRoomList();
  broadcastPresence();                             // co-op defenders now read as "In a match"

  const DT = 1 / 30;
  room.loop = setInterval(() => {
    const g = room.game;
    RC.CFG.WORLD_W = g.world.w; RC.CFG.WORLD_H = g.world.h;   // this room's world bounds for this tick
    g.over = null;                                            // the server decides when the run ends
    const q = room.cmdQueue; room.cmdQueue = [];
    for (const item of q) RC.Net.applyCommand(g, item.owner, item.cmd);
    g.update(DT);
    room.tickN++;
    if (room.tickN % 2 === 0) broadcastSnapshot(room, g);
    if (!g.crystal || g.crystal.dead) {
      // A co-op run is the one kind this process watched from the inside, so it hands
      // out a token backdated to when the run actually began plus the real wave log.
      // Nothing about the score depends on the client's word for it.
      roomBroadcast(room, {
        t: 'over', survival: true, team: null,
        wave: g.survivalWave || 0, kills: g.survivalKills || 0, diff: g.survivalDiff,
        waveTimes: (g.waveTimes || []).slice(0, 500),
        token: issueRunTokenBackdated(g),
      });
      room.seats = new Map();
      clearInterval(room.loop); room.loop = null;
    }
  }, 1000 / 30);
}

// ── Crystal Guard co-op (per room) ──
// The same shape as startSurvivalMatch — two defenders on team 1, the horde on owner 2,
// no "win", the run ends when the crystal falls — with three deliberate differences:
//
//   · No difficulty. The mode has one setting and it is "gentle"; a difficulty picker is
//     one more screen between a young player and the game.
//   · No filler bot. Solo Crystal Guard is a complete mode offline, so a host waiting in
//     a co-op room is waiting for a person, and an AI standing in would make the room
//     look full to the friend who was about to join.
//   · No run token and no leaderboard write. Crystal Guard scores never reach the world
//     board (see the end screen in ui.js), so there is nothing here to sign.
function startKidsMatch(room) {
  const humans = room.clients.slice(0, KIDS_CAP);
  const seats = humans.map((h, i) => ({ owner: KIDS_SEATS[i], race: h.race || 'forge', ai: false }));

  room.ownerOf = new Map(); room.teamOf = {}; room.seats = new Map();
  humans.forEach((h, i) => {
    room.ownerOf.set(h.socket, seats[i].owner);
    room.seats.set(seats[i].owner, { token: seatToken(), name: h.name, race: seats[i].race, clientId: h.id, goneAt: null });
  });
  seats.forEach(s => { room.teamOf[s.owner] = 1; });
  room.teamOf[2] = 2;

  room.game = new RC.Game();
  room.game.heroesEnabled = true;
  room.game.setupKids({ players: seats });
  room.lobby.started = true;
  room.cmdQueue = []; room.tickN = 0;

  const rosters = seats.map(s => ({ owner: s.owner, team: 1, race: s.race, ai: false }));
  room.clients.forEach(cl => {
    const owner = room.ownerOf.get(cl.socket);
    const seat = owner != null ? room.seats.get(owner) : null;
    send(cl, {
      t: 'start', survival: true, kids: true, diff: 'kids', roomId: room.id,
      resume: seat ? seat.token : null,
      owner, team: 1, rosters,
    });
  });
  broadcastRoomList();
  broadcastPresence();

  const DT = 1 / 30;
  room.loop = setInterval(() => {
    const g = room.game;
    RC.CFG.WORLD_W = g.world.w; RC.CFG.WORLD_H = g.world.h;
    g.over = null;                                            // the server decides when the run ends
    // The solo card screen pauses the world. Online it must not: the wave director sets
    // g.paused only when it is NOT a co-op run, but a stray pause from anywhere else
    // would silently stop the room, so the authoritative loop refuses to be paused.
    g.paused = false;
    const q = room.cmdQueue; room.cmdQueue = [];
    for (const item of q) RC.Net.applyCommand(g, item.owner, item.cmd);
    g.update(DT);
    room.tickN++;
    if (room.tickN % 2 === 0) broadcastSnapshot(room, g);
    if (!g.crystal || g.crystal.dead) {
      roomBroadcast(room, {
        t: 'over', survival: true, kids: true, team: null,
        wave: g.survivalWave || 0, kills: g.survivalKills || 0, diff: 'kids',
      });
      room.seats = new Map();
      clearInterval(room.loop); room.loop = null;
    }
  }, 1000 / 30);
}

// For a run this server actually simulated, stamp the token's record as if it were
// opened when the run began, so the pacing check compares against real elapsed time.
// The signature covers the timestamp inside the token string, which is what
// checkRunToken verifies; the record's issuedAt is what the pacing test reads.
function issueRunTokenBackdated(g) {
  const diff = DIFFS.indexOf(g.survivalDiff) >= 0 ? g.survivalDiff : 'medium';
  const tok = issueRunToken(diff);
  const rec = runTokens.get(tok.split('.')[0]);
  if (rec) rec.issuedAt = Date.now() - Math.round((g.time || 0) * 1000) - 1000;
  return tok;
}

function stopMatch(room) {
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
  room.game = null; room.lobby.started = false; room.ownerOf = new Map(); room.cmdQueue = [];
  room.seats = new Map();
  roomBroadcast(room, { t: 'toLobby' });
  broadcastRoomList();
  broadcastPresence();
}

// ── Heartbeat — keeps idle lobby sockets alive through proxies (fixes lobby disconnects) ──
setInterval(() => { sockets.forEach(c => wsPing(c.socket)); }, 20000);

function lanIPs() {
  const n = os.networkInterfaces(); const out = [];
  for (const k in n) for (const a of n[k]) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
server.listen(PORT, () => {
  console.log('\nRIFT CLASH server running (public + private rooms).');
  console.log('On THIS computer open:   http://localhost:' + PORT);
  lanIPs().forEach(ip => console.log('On the same network:     http://' + ip + ':' + PORT));
  console.log('Leaderboard file:        ' + SCORES_FILE + (DATA_DIR === DIR ? '   [not persistent — set DATA_DIR]' : ''));
  if (!process.env.RUN_SECRET) console.log('RUN_SECRET not set — using a per-boot key (runs opened before a restart cannot be posted after it).');
  console.log('Deployed behind HTTPS, players just open the site URL.\n');
});
