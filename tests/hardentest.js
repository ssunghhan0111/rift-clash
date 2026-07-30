// RIFT CLASH — hardening, leaderboard integrity and reconnect
// ---------------------------------------------------------------------------
// Pure Node. No Playwright, no browser, nothing to install — it speaks HTTP and
// RFC6455 to the REAL server.js in a child process, so everything it asserts is
// asserted against shipped code.
//
// Every check in here FAILS on the pre-change server:
//   · an oversized declared frame length used to be buffered forever
//   · rooms could be created without limit
//   · any origin could open a socket
//   · server.js and tests/ were served to every visitor
//   · a bare POST of {wave, kills} was accepted, so one request could own the board
//   · there was no 'resume' message at all — a dropped seat was gone for good
//
// Run:  node tests/hardentest.js
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8600 + (process.pid % 300);
const HOST = '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-scores-'));

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '   → ' + detail : '')); }
}
function head(t) { console.log('\n=== ' + t + ' ==='); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── minimal HTTP helpers ────────────────────────────────────────────────────
function req(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const r = http.request({
      host: HOST, port: PORT, path: urlPath, method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}, headers || {}),
    }, res => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(out); } catch (e) {}
        resolve({ status: res.statusCode, body: out, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── minimal RFC6455 client ──────────────────────────────────────────────────
// Client frames MUST be masked. Server frames are not.
function frame(str) {
  const payload = Buffer.from(str, 'utf8');
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x81, 0x80 | len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function wsConnect(opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST);
    const key = crypto.randomBytes(16).toString('base64');
    let handshook = false, buf = Buffer.alloc(0);
    const client = {
      sock, messages: [], closed: false, status: 0,
      send(o) { try { sock.write(frame(JSON.stringify(o))); } catch (e) {} },
      raw(b) { try { sock.write(b); } catch (e) {} },
      close() { try { sock.destroy(); } catch (e) {} },
      // wait for a message of type t (or any message matching a predicate)
      wait(t, ms) {
        const test = typeof t === 'function' ? t : (m => m.t === t);
        const found = this.messages.find(test);
        if (found) return Promise.resolve(found);
        return new Promise((res, rej) => {
          const started = Date.now();
          const iv = setInterval(() => {
            const f = this.messages.find(test);
            if (f) { clearInterval(iv); res(f); }
            else if (Date.now() - started > (ms || 4000)) { clearInterval(iv); rej(new Error('timeout waiting for ' + t)); }
          }, 15);
        });
      },
      clear() { this.messages.length = 0; },
    };
    sock.on('error', () => { client.closed = true; });
    sock.on('close', () => { client.closed = true; });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshook) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const headText = buf.slice(0, i).toString();
        client.status = parseInt((headText.split(' ')[1] || '0'), 10);
        buf = buf.slice(i + 4);
        handshook = true;
        if (client.status !== 101) { resolve(client); return; }
        resolve(client);
      }
      // parse unmasked server frames
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (opcode === 0x1) {
          try { client.messages.push(JSON.parse(payload.toString('utf8'))); } catch (e) {}
        } else if (opcode === 0x8) { client.closed = true; }
      }
    });
    sock.on('connect', () => {
      const extra = opts.origin ? ('Origin: ' + opts.origin + '\r\n') : '';
      sock.write(
        'GET / HTTP/1.1\r\n' +
        'Host: ' + HOST + ':' + PORT + '\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n' + extra + '\r\n');
    });
    setTimeout(() => reject(new Error('ws connect timeout')), 5000).unref?.();
  });
}

async function hello(name) {
  const c = await wsConnect();
  await c.wait('welcome');
  if (name) c.send({ t: 'setName', name });
  return c;
}

// ── server lifecycle ────────────────────────────────────────────────────────
let child = null;
function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DATA_DIR, RUN_SECRET: 'test-secret-for-hardentest',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => { out += d; if (/server running/i.test(out)) resolve(); });
    child.stderr.on('data', d => process.stderr.write('[server] ' + d));
    child.on('exit', code => { if (code) reject(new Error('server exited ' + code)); });
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}
function stopServer() { if (child) { try { child.kill(); } catch (e) {} child = null; } }

// Play a real Survival game headlessly with the shipped modules and return the wave
// log it produces. Nothing here reimplements the wave director — it IS the director.
function loadCore() {
  global.window = global;
  ['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
    .forEach(m => require(path.join(ROOT, m + '.js')));
  global.RC.CFG.FOG_ENABLED = false;
  return global.RC;
}
function realSurvivalWaveTimes(waves, opts) {
  const RC = loadCore();
  const g = new RC.Game();
  g.heroesEnabled = true;
  g.setupSurvival(Object.assign({ race: 'forge', ally: true, difficulty: 'medium' }, opts || {}));
  g.players.forEach(p => { if (p.owner === 1) p.ai = true; });   // let the bot defend
  RC.CFG.WORLD_W = g.world.w; RC.CFG.WORLD_H = g.world.h;
  const DT = 1 / 30;
  let t = 0;
  while (t < 3600 && (g.waveTimes || []).length < waves && !(g.crystal && g.crystal.dead)) {
    g.over = null; g.update(DT); t += DT;
  }
  return { times: (g.waveTimes || []).slice(), game: g };
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  await startServer();
  console.log('server up on ' + PORT + ', DATA_DIR=' + DATA_DIR);

  // ── 1. static file exposure ───────────────────────────────────────────────
  head('the server no longer hands out its own source');
  {
    const idx = await req('GET', '/index.html');
    ok(idx.status === 200, 'index.html is still served', 'got ' + idx.status);

    const srv = await req('GET', '/server.js');
    ok(srv.status === 404, 'GET /server.js is refused', 'got ' + srv.status);

    const tst = await req('GET', '/tests/hardentest.js');
    ok(tst.status === 404, 'GET /tests/… is refused', 'got ' + tst.status);

    const sc = await req('GET', '/scores.json');
    ok(sc.status === 404, 'GET /scores.json is refused', 'got ' + sc.status);

    const trav = await req('GET', '/../server.js');
    ok(trav.status === 404 || trav.status === 403, 'path traversal is refused', 'got ' + trav.status);

    const priv = await req('GET', '/privacy.html');
    ok(priv.status === 200 && /Privacy Policy/.test(priv.body), 'privacy.html is reachable', 'got ' + priv.status);
    const terms = await req('GET', '/terms.html');
    ok(terms.status === 200 && /Terms of Service/.test(terms.body), 'terms.html is reachable', 'got ' + terms.status);
  }

  // ── 2. WebSocket origin check ─────────────────────────────────────────────
  head('WebSocket rejects a foreign origin');
  {
    const evil = await wsConnect({ origin: 'http://evil.example' });
    ok(evil.status === 403, 'Origin: evil.example is refused', 'status ' + evil.status);
    evil.close();

    const good = await wsConnect({ origin: 'http://' + HOST + ':' + PORT });
    ok(good.status === 101, 'the game\'s own origin is accepted', 'status ' + good.status);
    good.close();

    const none = await wsConnect();
    ok(none.status === 101, 'a client with no Origin header still works', 'status ' + none.status);
    none.close();
  }

  // ── 3. oversized frame ────────────────────────────────────────────────────
  head('an oversized declared frame kills the connection, not the server');
  {
    const c = await hello();
    // Declare a 4 GB payload (64-bit length) and send nothing else. The old parser
    // would sit in Buffer.concat forever waiting for it.
    const hdr = Buffer.alloc(14);
    hdr[0] = 0x81; hdr[1] = 0x80 | 127;
    hdr.writeBigUInt64BE(BigInt(4 * 1024 * 1024 * 1024), 2);
    crypto.randomBytes(4).copy(hdr, 10);
    c.raw(hdr);
    await sleep(400);
    ok(c.closed, 'the connection is closed', 'still open');

    // and the server is still healthy afterwards
    const still = await req('GET', '/index.html');
    ok(still.status === 200, 'the server survives it', 'got ' + still.status);
  }

  // ── 4. room-creation limits ───────────────────────────────────────────────
  head('rooms cannot be created without limit');
  {
    const c = await hello('Spammer');
    await c.wait('rooms');
    c.clear();
    for (let i = 0; i < 6; i++) c.send({ t: 'create', name: 'r' + i, public: true, gameMode: 'vs' });
    await sleep(500);
    const joined = c.messages.filter(m => m.t === 'joined').length;
    const errs = c.messages.filter(m => m.t === 'joinError').length;
    ok(joined === 1, 'a burst of 6 create messages makes exactly 1 room', 'made ' + joined);
    ok(errs >= 1, 'the rest are refused with a message', 'errors ' + errs);
    c.close();
    await sleep(150);
  }

  // ── 5. leaderboard integrity ──────────────────────────────────────────────
  head('the leaderboard refuses a run it never saw');
  {
    // Opened first, then submitted at the end of this block. A run token records the
    // moment it was issued and the submission has to fit inside the real time that
    // has passed since — so an honest test has to actually let some pass, exactly
    // like an honest player does.
    const honestToken = (await req('POST', '/api/run/start', { diff: 'medium' })).json.token;

    // (a) the old attack: a bare POST with the maximum possible numbers
    const bare = await req('POST', '/api/score',
      { name: 'Forger', diff: 'medium', wave: 500, kills: 200000, race: 'forge', mode: 'solo' });
    ok(bare.status === 400, 'a bare {wave, kills} POST is rejected', 'got ' + bare.status + ' ' + bare.body);

    const board0 = await req('GET', '/api/scores?diff=medium');
    ok(!(board0.json.rows || []).some(r => r.name === 'Forger'), 'and nothing lands on the board');

    // (b) a made-up token
    const forged = await req('POST', '/api/score',
      { name: 'Forger', diff: 'medium', wave: 40, kills: 900, token: 'aaa.1700000000000.bbbbbbbbbbbbbbbbbbbbbbbb',
        waveTimes: Array.from({ length: 40 }, (_, i) => 20 + i * 40) });
    ok(forged.status === 400, 'an invented token is rejected', 'got ' + forged.status + ' ' + forged.body);

    // (c) a real token, but claiming impossible pacing (40 waves in 40 seconds)
    const t1 = await req('POST', '/api/run/start', { diff: 'medium' });
    ok(t1.status === 200 && t1.json.token, 'a run can be opened', JSON.stringify(t1.json));
    const fast = await req('POST', '/api/score',
      { name: 'Speedy', diff: 'medium', wave: 40, kills: 900, token: t1.json.token,
        waveTimes: Array.from({ length: 40 }, (_, i) => 1 + i) });
    ok(fast.status === 400 && /faster|real time/i.test(fast.json.error || ''),
       'a real token with impossible pacing is rejected', JSON.stringify(fast.json));

    // (d) a real token with plausible pacing, but claiming more game time than has
    //     actually elapsed on the wall clock since it was issued
    const t2 = await req('POST', '/api/run/start', { diff: 'medium' });
    const slow = await req('POST', '/api/score',
      { name: 'Timelord', diff: 'medium', wave: 30, kills: 700, token: t2.json.token,
        waveTimes: Array.from({ length: 30 }, (_, i) => 20 + i * 60) });
    ok(slow.status === 400 && /real time/i.test(slow.json.error || ''),
       'a run longer than the wall clock is rejected', JSON.stringify(slow.json));

    // (e) the pacing floor must accept what the REAL wave director produces. This is
    //     the check that would catch a floor set too aggressively: it plays an actual
    //     survival game headlessly and submits its own wave log. The sim runs far
    //     faster than real time, so the wall-clock rule will still refuse it — but it
    //     must refuse it for THAT reason and never for the spacing rule.
    const realLog = realSurvivalWaveTimes(9).times;
    const tReal = await req('POST', '/api/run/start', { diff: 'medium' });
    const realRun = await req('POST', '/api/score',
      { name: 'RealRun', diff: 'medium', wave: realLog.length, kills: realLog.length * 6,
        token: tReal.json.token, waveTimes: realLog });
    ok(!/faster than the game allows|out of order|run log/i.test((realRun.json || {}).error || ''),
       'a genuine ' + realLog.length + '-wave log from the real director passes the pacing rule',
       JSON.stringify(realRun.json));

    // (f) an honest short run, submitted after real time has passed
    await sleep(6500);
    const honest = { name: 'Honest', diff: 'medium', wave: 3, kills: 9, race: 'forge', mode: 'solo',
                     token: honestToken, waveTimes: [0.5, 5.5, 10.7] };
    const good = await req('POST', '/api/score', honest);
    ok(good.status === 200 && good.json.ok, 'a plausible run IS accepted', JSON.stringify(good.json));
    ok(good.json.score === 3 * 100 + 9 * 5, 'and the score is recomputed server-side', 'got ' + good.json.score);

    // (g) the same token cannot be spent twice
    const replay = await req('POST', '/api/score', Object.assign({}, honest, { wave: 3, kills: 9 }));
    ok(replay.status === 400 && /already/i.test(replay.json.error || ''),
       'a token is single use', JSON.stringify(replay.json));

    // (h) a token issued for one difficulty cannot be spent on another board
    const t4 = await req('POST', '/api/run/start', { diff: 'easy' });
    const wrongBoard = await req('POST', '/api/score',
      { name: 'Switcher', diff: 'insane', wave: 3, kills: 9, token: t4.json.token, waveTimes: [0.5, 6.5, 13.0] });
    ok(wrongBoard.status === 400, 'a token cannot be moved to another difficulty', JSON.stringify(wrongBoard.json));
  }

  // ── 5b. the pacing floor vs every daily twist ─────────────────────────────
  // The floor is only safe if it is below what the director actually produces on
  // EVERY day, not just today's. Two twists change the numbers it is built from —
  // Blitz cuts the between-wave gap to 30%, Elite Guard shrinks the waves — and a
  // fixed floor would have rejected honest runs on two days in seven.
  head('the pacing floor fits every Daily Challenge twist');
  {
    const RC = loadCore();
    const DAY_MS = 86400000, EPOCH = Date.UTC(2026, 0, 1);
    const twists = [];
    for (let day = 0; day < 7; day++) {
      const now = EPOCH + day * DAY_MS + 3600000;
      const info = RC.Daily.today(now);
      const run = realSurvivalWaveTimes(6, { daily: true, dailyNow: now });
      const times = run.times;
      let worst = Infinity, worstWave = 0;
      for (let i = 1; i < times.length; i++) {
        const need = RC.Survival.minSpacing(i, run.game);
        const slack = (times[i] - times[i - 1]) - need;
        if (slack < worst) { worst = slack; worstWave = i; }
      }
      twists.push({ name: info.name, waves: times.length, worst, worstWave });
      ok(times.length >= 3, info.name + ': the run reached at least 3 waves', 'got ' + times.length);
      ok(worst >= 0, info.name + ': every real wave gap clears the floor',
         'wave ' + worstWave + ' was ' + worst.toFixed(2) + 's under it');
    }
    twists.forEach(t => console.log('  ' + t.name.padEnd(16) +
      t.waves + ' waves, tightest gap ' + t.worst.toFixed(2) + 's above the floor'));
  }

  // ── 6. persistent store ───────────────────────────────────────────────────
  head('the board is written to DATA_DIR, not next to the server');
  {
    await sleep(1800);        // the save is debounced by 1.5s
    ok(fs.existsSync(path.join(DATA_DIR, 'scores.json')), 'scores.json is in DATA_DIR');
    ok(!fs.existsSync(path.join(ROOT, 'scores.json')), 'and NOT beside server.js');
    const saved = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scores.json'), 'utf8'));
    ok((saved.medium || []).some(r => r.name === 'Honest'), 'the accepted run is in the file');
    ok(!(saved.medium || []).some(r => r.name === 'Forger'), 'the forged run is not');
  }

  // ── 7. reconnect ──────────────────────────────────────────────────────────
  head('a dropped player gets their seat back');
  {
    const host = await hello('Hosty');
    await host.wait('rooms');
    host.send({ t: 'create', name: 'Resume Test', public: false, gameMode: 'vs' });
    const joined = await host.wait('joined');

    const guest = await hello('Guesty');
    await guest.wait('welcome');
    guest.send({ t: 'join', roomId: joined.roomId });
    await guest.wait('joined');

    // Guests arm the start themselves now (isReadyToStart on the server); without this the
    // host only gets startDenied and this whole section waits for a match that never begins.
    guest.send({ t: 'ready', ready: true });
    await sleep(150);
    host.send({ t: 'start' });
    const gStart = await guest.wait('start');
    ok(!!gStart.resume, 'the match start hands each player a resume token', JSON.stringify(gStart).slice(0, 120));
    ok(gStart.roomId === joined.roomId, 'and the room id to come back to');
    const guestOwner = gStart.owner;

    await guest.wait('snap');                 // the match is really running
    // Yank the guest's connection the way a wifi drop would.
    guest.close();
    await sleep(300);

    const seatMsg = await host.wait(m => m.t === 'seat' && m.status === 'disconnected', 3000)
      .catch(() => null);
    ok(!!seatMsg, 'the other player is told the seat is being held',
       seatMsg ? '' : 'no seat message');

    // The match must still be running for there to be anything to come back to.
    host.clear();
    const stillTicking = await host.wait('snap', 2000).catch(() => null);
    ok(!!stillTicking, 'the simulation keeps running while the seat is held');

    // Wrong token: refused.
    const impostor = await hello('Impostor');
    impostor.send({ t: 'resume', roomId: joined.roomId, token: 'not-the-right-token' });
    const refused = await impostor.wait('resumeFailed', 3000).catch(() => null);
    ok(!!refused, 'a wrong resume token is refused', refused ? '' : 'no resumeFailed');
    impostor.close();

    // Right token: back in, same seat.
    const back = await hello('Guesty');
    back.send({ t: 'resume', roomId: joined.roomId, token: gStart.resume });
    const resumed = await back.wait('resumed', 4000).catch(e => null);
    ok(!!resumed, 'the real token gets the player back in', resumed ? '' : 'no resumed message');
    ok(resumed && resumed.owner === guestOwner, 'into the SAME seat',
       resumed ? ('owner ' + resumed.owner + ' vs ' + guestOwner) : '');
    const snapBack = await back.wait('snap', 3000).catch(() => null);
    ok(!!snapBack, 'and snapshots start flowing again');

    // The seat is no longer resumable by a second client while it is occupied.
    const second = await hello('Second');
    second.send({ t: 'resume', roomId: joined.roomId, token: gStart.resume });
    const taken = await second.wait('resumeFailed', 3000).catch(() => null);
    ok(!!taken, 'the seat cannot be taken twice', taken ? '' : 'no refusal');
    second.close();

    back.close(); host.close();
    await sleep(200);
  }

  // ── 8. chat ───────────────────────────────────────────────────────────────
  head('text chat reaches the room, and only the room');
  {
    const a = await hello('Alice');
    await a.wait('rooms');
    a.send({ t: 'create', name: 'Chat Test', public: false, gameMode: 'vs' });
    const room = await a.wait('joined');
    const b = await hello('Bob');
    b.send({ t: 'join', roomId: room.roomId });
    await b.wait('joined');
    const outsider = await hello('Nosy');

    b.clear(); outsider.clear();
    a.send({ t: 'chat', msg: 'hello everyone' });
    const heard = await b.wait('chat', 2500).catch(() => null);
    ok(heard && heard.msg === 'hello everyone', 'a player in the room receives it',
       heard ? JSON.stringify(heard) : 'nothing arrived');
    await sleep(200);
    ok(!outsider.messages.some(m => m.t === 'chat'), 'a player outside the room does not');

    // control characters are stripped rather than relayed
    b.clear();
    a.send({ t: 'chat', msg: 'line\u0001one\u001b[31m two' });
    const cleaned = await b.wait('chat', 2500).catch(() => null);
    ok(cleaned && !/[\u0000-\u001f]/.test(cleaned.msg), 'control characters are stripped',
       cleaned ? JSON.stringify(cleaned.msg) : 'nothing arrived');

    // and a burst is throttled instead of relayed in full
    b.clear();
    for (let i = 0; i < 15; i++) a.send({ t: 'chat', msg: 'spam ' + i });
    await sleep(500);
    const got = b.messages.filter(m => m.t === 'chat' && !m.system).length;
    ok(got <= 8, 'a 15-message burst is throttled', 'relayed ' + got);

    a.close(); b.close(); outsider.close();
    await sleep(150);
  }

  // ── 9. voice policy ───────────────────────────────────────────────────────
  head('the host can turn voice off for the whole room');
  {
    const a = await hello('Host2');
    await a.wait('rooms');
    a.send({ t: 'create', name: 'Voice Test', public: true, gameMode: 'vs' });
    const room = await a.wait('joined');
    ok(room.voiceAllowed === true, 'a new room allows voice by default');

    const b = await hello('Guest2');
    b.send({ t: 'join', roomId: room.roomId });
    await b.wait('joined');

    a.send({ t: 'roomVoice', on: false });
    await sleep(250);
    b.clear();
    b.send({ t: 'voiceJoin' });
    const denied = await b.wait('voiceDenied', 2500).catch(() => null);
    ok(!!denied, 'a guest cannot join voice once the host disabled it', denied ? '' : 'no voiceDenied');

    // a non-host cannot turn it back on
    b.send({ t: 'roomVoice', on: true });
    await sleep(250);
    b.clear();
    b.send({ t: 'voiceJoin' });
    const stillDenied = await b.wait('voiceDenied', 2500).catch(() => null);
    ok(!!stillDenied, 'and a guest cannot switch it back on', stillDenied ? '' : 'guest re-enabled voice');

    a.close(); b.close();
    await sleep(150);
  }

  // ── done ──────────────────────────────────────────────────────────────────
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  stopServer();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('\nharness error:', e && e.stack || e);
  stopServer();
  process.exit(1);
});
