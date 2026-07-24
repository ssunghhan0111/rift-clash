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
require('./net_core.js');
const RC = global.RC;
RC.CFG.FOG_ENABLED = false;               // server is omniscient; clients compute their own fog

const PORT = process.env.PORT || 8080;
const DIR = __dirname;

// ── Static file server ──
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
               '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIR)) { res.writeHead(403); res.end(); return; }
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
}

// ── Room lifecycle ──
function createRoom(host, name, isPublic) {
  const room = {
    id: nextRoomId++, code: makeCode(),
    name: (String(name || '').slice(0, 20) || (host.name + "'s Game")),
    public: !!isPublic,
    clients: [],
    game: null, loop: null, tickN: 0, cmdQueue: [],
    ownerOf: new Map(), teamOf: {},
    lobby: { mapId: RC.MAPS[0].id, modeId: '1v1', started: false },
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
    hostId: room.clients.length ? room.clients[0].id : null,
    players: room.clients.map(c => ({ id: c.id, name: c.name, race: c.race })),
  };
}
function pushLobby(room) { if (!room.lobby.started) roomBroadcast(room, lobbyState(room)); }

function roomListPayload() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.public && !room.lobby.started) {
      const mode = RC.MODES[room.lobby.modeId];
      list.push({
        id: room.id, name: room.name, players: room.clients.length,
        cap: mode ? mode.count : 4, mapId: room.lobby.mapId, modeId: room.lobby.modeId,
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

// ── Message handling ──
function onMsg(c, m) {
  switch (m.t) {
    case 'setName': c.name = String(m.name || '').slice(0, 16) || c.name; if (c.room) pushLobby(c.room); break;
    case 'list': sendRoomList(c); break;
    case 'create': createRoom(c, m.name, m.public); break;
    case 'join': {
      const code = String(m.code || '').toUpperCase();
      const room = m.roomId ? rooms.get(m.roomId) : roomByCode(code);
      if (!room) { send(c, { t: 'joinError', msg: 'Game not found — check the code.' }); break; }
      if (room.lobby.started) { send(c, { t: 'joinError', msg: 'That game has already started.' }); break; }
      const cap = (RC.MODES[room.lobby.modeId] || {}).count || 4;
      if (room.clients.length >= cap) { send(c, { t: 'joinError', msg: 'That game is full.' }); break; }
      joinRoom(c, room);
      break;
    }
    case 'leave': if (c.room) leaveRoom(c); sendRoomList(c); break;

    // in-room actions
    case 'race': if (c.room && RC.RACES[m.race]) { c.race = m.race; pushLobby(c.room); } break;
    case 'map': if (isHost(c) && RC.getMap(m.mapId)) { c.room.lobby.mapId = m.mapId; pushLobby(c.room); broadcastRoomList(); } break;
    case 'mode': if (isHost(c) && RC.MODES[m.modeId]) { c.room.lobby.modeId = m.modeId; pushLobby(c.room); broadcastRoomList(); } break;
    case 'start': if (isHost(c) && c.room && !c.room.lobby.started) { startMatch(c.room); } break;
    case 'cmd': { const room = c.room; if (!room || !room.game || room.game.over) break; const owner = room.ownerOf.get(c.socket); if (owner != null) room.cmdQueue.push({ owner, cmd: m.c }); break; }
    case 'restart': if (isHost(c) && c.room && c.room.lobby.started) { stopMatch(c.room); pushLobby(c.room); } break;
  }
}

// ── Match run (per room) ──
function startMatch(room) {
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
      racePick[seat.owner] = allyHuman ? allyHuman.race : (hostRace === 'forge' ? 'gloop' : 'forge');
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

function stopMatch(room) {
  if (room.loop) { clearInterval(room.loop); room.loop = null; }
  room.game = null; room.lobby.started = false; room.ownerOf = new Map(); room.cmdQueue = [];
  roomBroadcast(room, { t: 'toLobby' });
  broadcastRoomList();
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
