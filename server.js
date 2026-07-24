// RIFT CLASH — LAN server (zero-dependency Node.js)
//   Run:  node server.js         (optionally: PORT=9000 node server.js)
//   Then open the printed http://<your-ip>:<port> on each device on the same WiFi.
// It serves the game files AND runs the authoritative match over WebSocket.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Load the game core (DOM-free) with a window shim ──
global.window = global;
require('./config.js');
require('./maps.js');
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

function wsSend(socket, str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  try { socket.write(Buffer.concat([header, payload])); } catch (e) { /* closed */ }
}

// Frame parser (handles masking, 7/16/64-bit lengths). Calls onMsg(text) / onClose().
function makeParser(onMsg, onClose) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b1 = buf[1];
      const opcode = buf[0] & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
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
      if (opcode === 0x1) onMsg(payload.toString('utf8'));
    }
  };
}

// ── Lobby + match state ──
let clients = [];            // { socket, id, name, race, host }
let nextId = 1;
let game = null, loop = null, tickN = 0, cmdQueue = [];
let ownerOf = new Map();     // socket -> owner (during a match)
let teamOf = {};             // owner -> team (during a match)
let lobby = { mapId: RC.MAPS[0].id, modeId: '1v1', started: false };

function send(c, obj) { wsSend(c.socket, JSON.stringify(obj)); }
function broadcast(obj) { const s = JSON.stringify(obj); clients.forEach(c => wsSend(c.socket, s)); }

function lobbyState() {
  return {
    t: 'lobby', mapId: lobby.mapId, modeId: lobby.modeId, started: lobby.started,
    hostId: clients.length ? clients[0].id : null,
    players: clients.map(c => ({ id: c.id, name: c.name, race: c.race })),
  };
}
function pushLobby() { if (!lobby.started) broadcast(lobbyState()); }

function onConnect(socket) {
  const c = { socket, id: nextId++, name: 'Player ' + nextId, race: 'forge', host: clients.length === 0 };
  clients.push(c);
  send(c, { t: 'welcome', id: c.id, host: c.host, maps: RC.MAPS.map(m => ({ id: m.id, name: m.name })),
            modes: Object.values(RC.MODES).map(m => ({ id: m.id, name: m.name })),
            races: RC.RACE_ORDER.map(r => ({ id: r, name: RC.RACES[r].name })) });
  pushLobby();

  const parse = makeParser(
    (text) => { let m; try { m = JSON.parse(text); } catch (e) { return; } onMsg(c, m); },
    () => onClose(c)
  );
  socket.on('data', parse);
  socket.on('error', () => onClose(c));
  socket.on('close', () => onClose(c));
}

function isHost(c) { return clients.length && clients[0] === c; }

function onMsg(c, m) {
  switch (m.t) {
    case 'name': c.name = String(m.name || '').slice(0, 16) || c.name; pushLobby(); break;
    case 'race': if (RC.RACES[m.race]) c.race = m.race; pushLobby(); break;
    case 'map': if (isHost(c) && RC.getMap(m.mapId)) { lobby.mapId = m.mapId; pushLobby(); } break;
    case 'mode': if (isHost(c) && RC.MODES[m.modeId]) { lobby.modeId = m.modeId; pushLobby(); } break;
    case 'start': if (isHost(c) && !lobby.started) startMatch(); break;
    case 'cmd': { const owner = ownerOf.get(c.socket); if (owner != null && game && !game.over) cmdQueue.push({ owner, cmd: m.c }); break; }
    case 'restart': if (isHost(c) && lobby.started) { stopMatch(); pushLobby(); } break;
  }
}

function onClose(c) {
  const wasIn = clients.indexOf(c) >= 0;
  clients = clients.filter(x => x !== c);
  if (lobby.started && game) {
    // hand the disconnected player's seat to the AI
    const owner = ownerOf.get(c.socket);
    if (owner != null) { const p = game.players.find(pp => pp.owner === owner); if (p) p.ai = true; ownerOf.delete(c.socket); }
    if (ownerOf.size === 0) stopMatch();     // everyone left → back to lobby
  }
  if (wasIn) pushLobby();
}

function startMatch() {
  const mode = RC.MODES[lobby.modeId];
  const seats = mode.players.map(p => ({ owner: p.owner, team: p.team }));
  const humans = clients.slice(0, seats.length);           // join order fills seats
  const racePick = {};
  ownerOf = new Map(); teamOf = {};
  seats.forEach((seat, i) => {
    const human = humans[i];
    seat.ai = !human;
    teamOf[seat.owner] = seat.team;
    if (human) { ownerOf.set(human.socket, seat.owner); racePick[seat.owner] = human.race; }
  });
  // AI seats: match an ally human's race if any, else the opposite of the host's race
  const hostRace = clients[0] ? clients[0].race : 'forge';
  seats.forEach(seat => {
    if (seat.ai) {
      const allyHuman = humans.find((h, i) => h && seats[i].team === seat.team);
      racePick[seat.owner] = allyHuman ? allyHuman.race : (hostRace === 'forge' ? 'gloop' : 'forge');
    }
  });
  const customMode = { id: mode.id, name: mode.name, count: seats.length, players: seats };

  game = new RC.Game();
  game.setup(RC.getMap(lobby.mapId), customMode, racePick);
  RC.AI.reset();
  lobby.started = true;
  cmdQueue = []; tickN = 0;

  // tell each client their seat + everyone's factions, then start streaming
  const rosters = seats.map(s => ({ owner: s.owner, team: s.team, race: racePick[s.owner], ai: s.ai }));
  clients.forEach(cl => {
    send(cl, { t: 'start', mapId: lobby.mapId, modeId: lobby.modeId, owner: ownerOf.get(cl.socket),
               team: teamOf[ownerOf.get(cl.socket)], rosters });
  });

  const DT = 1 / 30;
  loop = setInterval(() => {
    game.over = null;              // server decides the end by TEAM elimination, not one player's view
    const q = cmdQueue; cmdQueue = [];
    for (const item of q) RC.Net.applyCommand(game, item.owner, item.cmd);
    game.update(DT);
    tickN++;
    if (tickN % 2 === 0) broadcast({ t: 'snap', s: RC.Net.serialize(game) });
    const alive = new Set(game.buildings.filter(b => b.def.isCore && !b.dead).map(b => teamOf[b.owner]));
    if (alive.size <= 1) {
      broadcast({ t: 'over', team: alive.size === 1 ? [...alive][0] : null });
      clearInterval(loop); loop = null;
    }
  }, 1000 / 30);
}

function stopMatch() {
  if (loop) { clearInterval(loop); loop = null; }
  game = null; lobby.started = false; ownerOf = new Map(); cmdQueue = [];
  broadcast({ t: 'toLobby' });
}

function lanIPs() {
  const n = os.networkInterfaces(); const out = [];
  for (const k in n) for (const a of n[k]) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
server.listen(PORT, () => {
  console.log('\nRIFT CLASH LAN server running.');
  console.log('On THIS computer open:   http://localhost:' + PORT);
  lanIPs().forEach(ip => console.log('On OTHER devices open:   http://' + ip + ':' + PORT));
  console.log('(All devices must be on the same WiFi/LAN.)\n');
});
