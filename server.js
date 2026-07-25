// RIFT CLASH — Online server (zero-dependency Node.js)
//   Run:  node server.js            (PORT env supported)
//   Deploy behind an HTTPS host (e.g. Render) and the client auto-uses wss://.
// Serves the game files AND hosts MANY concurrent games (public + private "rooms")
// over WebSocket, each with its own authoritative 30 Hz simulation.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Load the game core (DOM-free) with a window shim ──
global.window = global;
require('./config.js');
require('./maps.js');
require('./pathfind.js');
require('./entities.js');
require('./game.js');
require('./ai.js');
require('./daily.js');          // Daily Challenge seed + twist table (shared with the client)
require('./weather.js');        // per-planet weather — derived from game.time, so no sync needed
require('./survival.js');       // online co-op Survival wave director
require('./net_core.js');
const RC = global.RC;
RC.CFG.FOG_ENABLED = false;               // server is omniscient; clients compute their own fog

const PORT = process.env.PORT || 8080;
const DIR = __dirname;

// ══ Global Survival leaderboard ═══════════════════════════════════════════
// Top scores per difficulty, kept in a JSON file next to the server.
// NOTE: on a free Render instance the filesystem is EPHEMERAL — the board
// survives restarts of the process but is wiped by a redeploy. That's fine for
// a friendly high-score board; swap in a hosted DB later if it needs to persist.
const SCORES_FILE = path.join(DIR, 'scores.json');
// 'daily' is a board like any other, except rows carry the UTC day they were set
// on and only today's are ever shown. That means the daily board "resets" every
// midnight UTC with no scheduled job and no cleanup step — yesterday's rows just
// stop matching. They're pruned on write so the file can't grow forever.
const DIFFS = ['easy', 'medium', 'insane', 'daily'];
const MAX_ROWS = 100;                    // rows kept per difficulty
const MAX_BODY = 4096;                   // reject oversized POST bodies

// Must match RC.Daily.EPOCH / dayNumber() in daily.js — the client and server
// have to agree on which day it is or nobody's score shows up on their own board.
const DAILY_EPOCH = Date.UTC(2026, 0, 1);
const DAY_MS = 86400000;
function dayNumber(now) { return Math.floor(((now == null ? Date.now() : now) - DAILY_EPOCH) / DAY_MS); }

let scores = { easy: [], medium: [], insane: [], daily: [] };
try {
  const raw = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  DIFFS.forEach(d => { if (Array.isArray(raw[d])) scores[d] = raw[d].slice(0, MAX_ROWS); });
  console.log('leaderboard loaded:', DIFFS.map(d => d + '=' + scores[d].length).join(' '));
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

// The client is not trusted: the score is RECOMPUTED here from waves+kills, and
// implausible runs are rejected outright. This is a friendly game, so the goal is
// to stop casual tampering, not to be unforgeable.
function validate(b) {
  if (!b || typeof b !== 'object') return 'bad payload';
  if (DIFFS.indexOf(b.diff) < 0) return 'bad difficulty';
  const wave = Math.floor(Number(b.wave));
  const kills = Math.floor(Number(b.kills));
  if (!isFinite(wave) || wave < 1 || wave > 500) return 'bad wave';
  if (!isFinite(kills) || kills < 0 || kills > 200000) return 'bad kills';
  if (kills > wave * 400 + 200) return 'kills do not match waves';
  const mode = (b.mode === 'coop') ? 'coop' : 'solo';
  const race = (RC.RACES && RC.RACES[b.race]) ? b.race : 'forge';
  const entry = { diff: b.diff, wave, kills, mode, race,
                  score: wave * 100 + kills * 5, name: cleanName(b.name), at: Date.now() };
  if (b.diff === 'daily') {
    // The day is stamped SERVER-side. A client claiming a different day would
    // otherwise be able to park a score on tomorrow's board.
    entry.day = dayNumber(entry.at);
  }
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
  if (improved) list.push(entry);
  list.sort((a, b) => b.score - a.score || a.at - b.at);
  scores[entry.diff] = list.slice(0, MAX_ROWS);
  saveScores();
  const rank = scores[entry.diff].findIndex(r =>
    String(r.name).toLowerCase() === key && r.score >= entry.score);
  return { improved, rank: rank >= 0 ? rank + 1 : null, total: scores[entry.diff].length };
}

// Light per-IP rate limit so nobody can spam the board.
const rate = new Map();
function rateOk(ip) {
  const now = Date.now(), win = 3600000, cap = 40;
  const r = rate.get(ip);
  if (!r || now > r.reset) { rate.set(ip, { n: 1, reset: now + win }); return true; }
  if (r.n >= cap) return false;
  r.n++; return true;
}
setInterval(() => {                                    // drop expired buckets
  const now = Date.now();
  for (const [ip, r] of rate) if (now > r.reset) rate.delete(ip);
}, 600000).unref?.();

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

// ── Static file server (+ leaderboard API) ──
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
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
  if (p === '/api/score' && req.method === 'POST') {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
               req.socket.remoteAddress || 'unknown';
    if (!rateOk(ip)) { sendJson(res, 429, { ok: false, error: 'too many submissions — try again later' }); return; }
    let body = '';
    let aborted = false;
    req.on('data', c => {
      body += c;
      if (body.length > MAX_BODY) { aborted = true; sendJson(res, 413, { ok: false, error: 'too large' }); req.destroy(); }
    });
    req.on('end', () => {
      if (aborted) return;
      let parsed;
      try { parsed = JSON.parse(body); } catch (e) { sendJson(res, 400, { ok: false, error: 'bad json' }); return; }
      const entry = validate(parsed);
      if (typeof entry === 'string') { sendJson(res, 400, { ok: false, error: entry }); return; }
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
  if (path.basename(file) === 'scores.json') { res.writeHead(404); res.end('not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── Minimal RFC6455 WebSocket ──
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
               'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  onConnect(socket);
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
function wsPing(socket) { try { socket.write(Buffer.from([0x89, 0x00])); } catch (e) { } }   // opcode 0x9, empty
function wsPong(socket) { try { socket.write(Buffer.from([0x8A, 0x00])); } catch (e) { } }   // opcode 0xA, empty

// Frame parser (masking, 7/16/64-bit lengths). Handles text + close + ping/pong.
function makeParser(onMsg, onClose, onPing, onPong) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
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

function onConnect(socket) {
  const c = { socket, id: nextClientId++, name: 'Player ' + nextClientId, race: 'forge', room: null };
  sockets.add(c);
  send(c, {
    t: 'welcome', id: c.id,
    maps: RC.MAPS.map(m => ({ id: m.id, name: m.name })),
    modes: Object.values(RC.MODES).map(m => ({ id: m.id, name: m.name })),
    races: RC.RACE_ORDER.map(r => ({ id: r, name: RC.RACES[r].name })),
  });
  sendRoomList(c);
  send(c, presencePayload());
  broadcastPresence();

  const parse = makeParser(
    (text) => { let m; try { m = JSON.parse(text); } catch (e) { return; } onMsg(c, m); },
    () => onClose(c),
    () => wsPong(socket),        // reply to client ping
    () => { }                    // pong received — connection is alive
  );
  socket.on('data', parse);
  socket.on('error', () => onClose(c));
  socket.on('close', () => onClose(c));
}

function onClose(c) {
  sockets.delete(c);
  if (c.room) leaveRoom(c);
  broadcastPresence();
}

// ── Room lifecycle ──
// 방 정원 — 대전은 모드 인원수, 생존은 방어자 최대 4명(맵의 base 수)
const SURVIVAL_CAP = 4;
const SURVIVAL_SEATS = [1, 3, 4, 5];       // owner 2 is reserved for the wave horde
function roomCap(room) {
  if (room.lobby.gameMode === 'survival') return SURVIVAL_CAP;
  return (RC.MODES[room.lobby.modeId] || {}).count || 4;
}

function createRoom(host, name, isPublic, gameMode) {
  const room = {
    id: nextRoomId++, code: makeCode(),
    name: (String(name || '').slice(0, 20) || (host.name + "'s Game")),
    public: !!isPublic,
    clients: [],
    game: null, loop: null, tickN: 0, cmdQueue: [],
    ownerOf: new Map(), teamOf: {},
    // gameMode: 'vs' (map + 1v1/2v2) | 'survival' (co-op vs endless waves, difficulty instead of map)
    lobby: {
      mapId: RC.MAPS[0].id, modeId: '1v1', started: false,
      gameMode: (gameMode === 'survival' ? 'survival' : 'vs'), diff: 'medium',
    },
  };
  rooms.set(room.id, room);
  joinRoom(host, room);
  return room;
}

function joinRoom(c, room) {
  if (c.room) leaveRoom(c);
  c.room = room;
  room.clients.push(c);
  send(c, { t: 'joined', roomId: room.id, code: room.code, name: room.name, public: room.public });
  pushLobby(room);
  broadcastRoomList();
  broadcastPresence();
}

function leaveRoom(c) {
  const room = c.room;
  if (!room) return;
  c.room = null;
  room.clients = room.clients.filter(x => x !== c);
  if (room.lobby.started && room.game) {
    const owner = room.ownerOf.get(c.socket);
    if (owner != null) { const p = room.game.players.find(pp => pp.owner === owner); if (p) p.ai = true; room.ownerOf.delete(c.socket); }
    if (room.ownerOf.size === 0) stopMatch(room);   // everyone left → end match
  }
  if (room.clients.length === 0) destroyRoom(room);
  else pushLobby(room);
  broadcastRoomList();
  broadcastPresence();
}

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
    hostId: room.clients.length ? room.clients[0].id : null,
    players: room.clients.map(c => ({ id: c.id, name: c.name, race: c.race })),
  };
}
function pushLobby(room) { if (!room.lobby.started) roomBroadcast(room, lobbyState(room)); }

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

// ── Message handling ──
function onMsg(c, m) {
  switch (m.t) {
    case 'setName':
      c.name = String(m.name || '').slice(0, 16) || c.name;
      if (c.room) pushLobby(c.room);
      broadcastPresence();
      break;
    case 'list': sendRoomList(c); send(c, presencePayload()); break;
    case 'create': createRoom(c, m.name, m.public, m.gameMode); break;

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
      const hasKind = (m.kind === 'vs' || m.kind === 'survival');
      const gm = (m.kind === 'survival') ? 'survival' : 'vs';
      const modeId = RC.MODES[m.modeId] ? m.modeId : '1v1';
      let room = c.room;
      if (!room) room = createRoom(c, c.name + "'s Game", false, gm);
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
    case 'join': {
      const code = String(m.code || '').toUpperCase();
      const room = m.roomId ? rooms.get(m.roomId) : roomByCode(code);
      if (!room) { send(c, { t: 'joinError', msg: 'Game not found — check the code.' }); break; }
      if (room.lobby.started) { send(c, { t: 'joinError', msg: 'That game has already started.' }); break; }
      if (room.clients.length >= roomCap(room)) { send(c, { t: 'joinError', msg: 'That game is full.' }); break; }
      joinRoom(c, room);
      break;
    }
    case 'leave': if (c.room) leaveRoom(c); sendRoomList(c); break;

    // in-room actions
    case 'race': if (c.room && RC.RACES[m.race]) { c.race = m.race; pushLobby(c.room); } break;
    case 'map': if (isHost(c) && RC.getMap(m.mapId)) { c.room.lobby.mapId = m.mapId; pushLobby(c.room); broadcastRoomList(); } break;
    case 'mode': if (isHost(c) && RC.MODES[m.modeId]) { c.room.lobby.modeId = m.modeId; pushLobby(c.room); broadcastRoomList(); } break;
    // Survival co-op: host picks the difficulty instead of a map/mode.
    case 'diff': if (isHost(c) && ['easy', 'medium', 'insane'].includes(m.diff)) { c.room.lobby.diff = m.diff; pushLobby(c.room); broadcastRoomList(); } break;
    case 'gamemode': {
      if (!isHost(c) || c.room.lobby.started) break;
      const gm = (m.gameMode === 'survival') ? 'survival' : 'vs';
      c.room.lobby.gameMode = gm;
      // switching to a tighter cap could leave the room over-full — drop the newest joiners
      while (c.room.clients.length > roomCap(c.room)) {
        const evicted = c.room.clients[c.room.clients.length - 1];
        send(evicted, { t: 'joinError', msg: 'The host switched game mode and the room got smaller.' });
        leaveRoom(evicted);
      }
      pushLobby(c.room); broadcastRoomList();
      break;
    }
    case 'start': if (isHost(c) && c.room && !c.room.lobby.started) { startMatch(c.room); } break;
    case 'cmd': { const room = c.room; if (!room || !room.game || room.game.over) break; const owner = room.ownerOf.get(c.socket); if (owner != null) room.cmdQueue.push({ owner, cmd: m.c }); break; }
    case 'restart': if (isHost(c) && c.room && c.room.lobby.started) { stopMatch(c.room); pushLobby(c.room); } break;
  }
}

// ── Match run (per room) ──
function startMatch(room) {
  if (room.lobby.gameMode === 'survival') return startSurvivalMatch(room);
  const mode = RC.MODES[room.lobby.modeId];
  const seats = mode.players.map(p => ({ owner: p.owner, team: p.team }));
  const humans = room.clients.slice(0, seats.length);      // join order fills seats
  const racePick = {};
  room.ownerOf = new Map(); room.teamOf = {};
  seats.forEach((seat, i) => {
    const human = humans[i];
    seat.ai = !human;
    room.teamOf[seat.owner] = seat.team;
    if (human) { room.ownerOf.set(human.socket, seat.owner); racePick[seat.owner] = human.race; }
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
  room.game.heroesEnabled = false;                 // online has no heroes (kept off the authoritative sim)
  room.game.setup(RC.getMap(room.lobby.mapId), customMode, racePick);
  room.lobby.started = true;
  room.cmdQueue = []; room.tickN = 0;

  const rosters = seats.map(s => ({ owner: s.owner, team: s.team, race: racePick[s.owner], ai: s.ai }));
  room.clients.forEach(cl => {
    send(cl, { t: 'start', mapId: room.lobby.mapId, modeId: room.lobby.modeId, owner: room.ownerOf.get(cl.socket),
               team: room.teamOf[room.ownerOf.get(cl.socket)], rosters });
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
    if (room.tickN % 2 === 0) roomBroadcast(room, { t: 'snap', s: RC.Net.serialize(g) });
    const alive = new Set(g.buildings.filter(b => b.def.isCore && !b.dead).map(b => room.teamOf[b.owner]));
    if (alive.size <= 1) {
      roomBroadcast(room, { t: 'over', team: alive.size === 1 ? [...alive][0] : null });
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

  room.ownerOf = new Map(); room.teamOf = {};
  humans.forEach((h, i) => room.ownerOf.set(h.socket, seats[i].owner));
  seats.forEach(s => { room.teamOf[s.owner] = 1; });
  room.teamOf[2] = 2;

  room.game = new RC.Game();
  room.game.heroesEnabled = false;                 // online has no heroes (kept off the authoritative sim)
  room.game.setupSurvival({ difficulty: room.lobby.diff, players: seats });
  room.lobby.started = true;
  room.cmdQueue = []; room.tickN = 0;

  const rosters = seats.map(s => ({ owner: s.owner, team: 1, race: s.race, ai: s.ai }));
  room.clients.forEach(cl => {
    send(cl, {
      t: 'start', survival: true, diff: room.lobby.diff,
      owner: room.ownerOf.get(cl.socket), team: 1, rosters,
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
    if (room.tickN % 2 === 0) roomBroadcast(room, { t: 'snap', s: RC.Net.serialize(g) });
    if (!g.crystal || g.crystal.dead) {
      roomBroadcast(room, {
        t: 'over', survival: true, team: null,
        wave: g.survivalWave || 0, kills: g.survivalKills || 0, diff: g.survivalDiff,
      });
      clearInterval(room.loop); room.loop = null;
    }
  }, 1000 / 30);
}

function stopMatch(room) {
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
  room.game = null; room.lobby.started = false; room.ownerOf = new Map(); room.cmdQueue = [];
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
  console.log('Deployed behind HTTPS, players just open the site URL.\n');
});
