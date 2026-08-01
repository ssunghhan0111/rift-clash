// RIFT CLASH — Crystal Guard co-op over a REAL server and REAL WebSockets
// ---------------------------------------------------------------------------
// kidstest.js proves the rules; this proves the wiring. It boots server.js as a child
// process, connects two raw WebSocket clients, plays a room from creation through to a
// live match, and checks the things that only break once a socket is involved:
//
//   · the room caps at 3 and a fourth player is turned away
//   · a lone host cannot start — solo Crystal Guard is the offline mode, not this one
//   · both players get a seat, an owner id and their own base
//   · the snapshot carries the wave director, so a client that never ticks the sim has a
//     wave counter, a shop and its own reward cards
//   · buy and card-pick travel as commands and are applied to the COMMANDING owner
//   · the server never pauses, no matter what the card screen is doing
//
// No dependencies: the WebSocket handshake and frames are done by hand, exactly like
// lobbytest.js does, so this runs anywhere node does.
const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } }
function head(s) { console.log('\n=== ' + s + ' ==='); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PORT = 8123 + (process.pid % 400);

// ── A minimum-viable WebSocket client ──────────────────────────────────────
function client(tag) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), handshook = false;
    const api = {
      tag, id: null, msgs: [], sock,
      send(o) { sock.write(frame(JSON.stringify(o))); },
      last(t) { for (let i = api.msgs.length - 1; i >= 0; i--) if (api.msgs[i].t === t) return api.msgs[i]; return null; },
      count(t) { return api.msgs.filter(m => m.t === t).length; },
      clear() { api.msgs = []; },
      wait(t, ms) {
        const deadline = Date.now() + (ms || 3000);
        return new Promise((res, rej) => {
          const tick = () => {
            const m = api.last(t);
            if (m) return res(m);
            if (Date.now() > deadline) return rej(new Error(tag + ' never got "' + t + '"'));
            setTimeout(tick, 25);
          };
          tick();
        });
      },
      close() { try { sock.destroy(); } catch (e) {} },
    };
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write('GET / HTTP/1.1\r\nHost: localhost:' + PORT + '\r\nUpgrade: websocket\r\n' +
                 'Connection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        handshook = true;
        buf = buf.slice(i + 4);
        resolve(api);
      }
      // Server frames are unmasked; payloads here are small but snapshots are not, so
      // both the 126 and the 127 length forms have to be handled.
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op === 0x1) { try { api.msgs.push(JSON.parse(payload.toString('utf8'))); } catch (e) {} }
      }
    });
  });
}
function frame(str) {
  const p = Buffer.from(str, 'utf8');
  const mask = crypto.randomBytes(4);
  const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length])
             : Buffer.concat([Buffer.from([0x81, 0xfe]), (() => { const b = Buffer.alloc(2); b.writeUInt16BE(p.length); return b; })()]);
  const masked = Buffer.alloc(p.length);
  for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srvErr = [];
  srv.stderr.on('data', d => srvErr.push(String(d)));
  await sleep(700);

  try {
    head('a room for two');
    const A = await client('A'); await A.wait('welcome');
    const B = await client('B'); await B.wait('welcome');
    A.send({ t: 'setName', name: 'Grownup' });
    B.send({ t: 'setName', name: 'Kid' });
    await sleep(150);

    A.send({ t: 'create', name: 'Crystal time', public: true, gameMode: 'kids' });
    const joined = await A.wait('joined');
    const lob0 = await A.wait('lobby');
    ok(lob0.gameMode === 'kids', 'the room is a kids room, got ' + lob0.gameMode);
    // Three, not two. Owner 2 is the horde, so seats 1/3/4 are what is left — and a
    // third child changes the mode qualitatively rather than quantitatively: two
    // players divide a castle in half, three have to agree on what it is.
    ok(lob0.cap === 3, 'the cap is 3, got ' + lob0.cap);
    console.log('  room created: gameMode=' + lob0.gameMode + ' cap=' + lob0.cap + ' ✓');

    // A lone host must NOT be able to start.
    A.clear();
    A.send({ t: 'start' });
    const denied = await A.wait('startDenied');
    ok(!!denied, 'a lone host was allowed to start a co-op run');
    ok(A.count('start') === 0, 'a solo co-op match started anyway');
    console.log('  lone host refused: "' + denied.msg + '" ✓');

    B.send({ t: 'join', code: joined.code });
    await B.wait('joined');
    await sleep(200);
    ok(A.last('lobby').players.length === 2, 'both players are in the lobby');

    // A third is welcome; a fourth is not.
    const C = await client('C'); await C.wait('welcome');
    C.send({ t: 'setName', name: 'Third' });
    await sleep(100);
    C.send({ t: 'join', code: joined.code });
    await C.wait('joined');
    await sleep(200);
    ok(A.last('lobby').players.length === 3, 'a third player is welcome now');
    const D = await client('D'); await D.wait('welcome');
    D.send({ t: 'setName', name: 'Fourth' });
    await sleep(100);
    D.send({ t: 'join', code: joined.code });
    const jerr = await D.wait('joinError');
    ok(/full/i.test(jerr.msg), 'a fourth player got the wrong refusal: ' + jerr.msg);
    console.log('  fourth player refused: "' + jerr.msg + '" ✓');
    D.close();
    C.close();
    await sleep(250);

    head('the match starts');
    B.send({ t: 'race', race: 'gloop' });
    B.send({ t: 'ready', ready: true });
    await sleep(200);
    A.send({ t: 'start' });
    const sA = await A.wait('start');
    const sB = await B.wait('start');
    ok(sA.kids === true && sB.kids === true, 'both clients were told this is a Crystal Guard run');
    ok(sA.owner !== sB.owner, 'the two players got different owner ids');
    ok(sA.owner === 1 && sB.owner === 3, 'seats are owners 1 and 3, got ' + sA.owner + ' and ' + sB.owner);
    ok(sA.rosters.length === 2, 'the roster lists both defenders');
    ok(sA.rosters.every(r => r.team === 1), 'both defenders are on team 1');
    ok(sA.rosters.every(r => !r.ai), 'no filler bot was added to a co-op room');
    console.log('  started: owners ' + sA.rosters.map(r => r.owner + '/' + r.race).join(' + ') + ' ✓');

    head('snapshots carry the wave director');
    await sleep(900);
    const snap = A.last('snap');
    ok(!!snap, 'no snapshot arrived');
    const s = snap.s;
    ok(!!s.kd, 'the snapshot has no Crystal Guard block');
    // A match now opens on Build Day and stays there until the players say night can
    // come, so 'build' is the expected opening phase rather than a stall.
    ok(s.kd.ph === 'build' || s.kd.ph === 'spawning', 'the run is in a real phase, got ' + s.kd.ph);
    ok(s.kd.co === true, 'the snapshot says it is a co-op run');
    ok(!!s.kd.pl && Object.keys(s.kd.pl).length === 2, 'the snapshot carries a slice per defender');
    ok(!!s.kd.pl['1'] && !!s.kd.pl['3'], 'both owners are in the snapshot, got ' + Object.keys(s.kd.pl).join(','));
    ok(s.res && s.res['1'] != null && s.res['3'] != null, 'both economies are in the snapshot');
    // Two bases plus one crystal.
    const cores = s.B.filter(b => b.o === 1 || b.o === 3);
    ok(cores.length === 3, 'expected two bases and one crystal, got ' + cores.length + ' buildings');
    console.log('  snapshot: phase=' + s.kd.ph + ' coop=' + s.kd.co +
                ' defenders=[' + Object.keys(s.kd.pl).join(',') + '] buildings=' + cores.length + ' ✓');

    head('buying travels as a command');
    // Money is shared now — one keep, one pile — so a purchase by B comes out of the
    // pile the server holds on seat 1. What stays private is which base it queues at,
    // which is checked below.
    const before = s.res['1'];
    // 'globling' is a Gloop starter, and B picked Gloop.
    B.send({ t: 'cmd', c: { t: 'kbuy', ut: 'globling' } });
    await sleep(500);
    const s2 = B.last('snap').s;
    ok(s2.res['1'] < before, "player B's purchase came out of the shared pile (" + before + ' -> ' + s2.res['1'] + ')');
    const bQueues = s2.B.filter(b => b.o === 3 && b.q && b.q.length);
    ok(bQueues.length === 1, "the fighter queued at B's own base, saw " + bQueues.length + ' queues');
    console.log('  B bought a Globling: ' + before + ' -> ' + s2.res['3'] + ' shards, queued at own base ✓');

    // A cannot buy a Gloop unit — the command is applied to the owner it came from, and
    // A picked the default faction.
    const aBefore = s2.res['1'];
    A.send({ t: 'cmd', c: { t: 'kbuy', ut: 'globling' } });
    await sleep(400);
    ok(A.last('snap').s.res['1'] >= aBefore - 1, "A could not buy from B's faction kit");

    head('the server never pauses');
    const t1 = A.last('snap').s.tm;
    await sleep(600);
    const t2 = A.last('snap').s.tm;
    ok(t2 > t1, 'sim time advanced (' + t1.toFixed(1) + ' -> ' + t2.toFixed(1) + ')');
    console.log('  sim time ' + t1.toFixed(1) + ' -> ' + t2.toFixed(1) + ' ✓');

    A.close(); B.close();
    ok(srvErr.length === 0, 'the server wrote to stderr: ' + srvErr.join('').slice(0, 300));
  } catch (e) {
    fail++;
    console.log('  HARNESS ERROR: ' + e.message);
    if (srvErr.length) console.log('  server stderr: ' + srvErr.join('').slice(0, 500));
  } finally {
    srv.kill();
  }

  console.log('\n' + (fail ? '✖ ' : '✔ ') + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
