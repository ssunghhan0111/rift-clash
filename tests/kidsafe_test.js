// RIFT CLASH — Kids-mode safety gates, against a HOSTILE client
// ---------------------------------------------------------------------------
// Everything in kidsafe.js is enforced twice: the browser does not draw the
// control, and the server refuses the message. The first half is a courtesy and
// this file does not test it — a child is not the attacker, and a UI check would
// pass just as happily if the server had no guard at all.
//
// So every check here is made by a client that IGNORES the UI entirely: raw
// WebSocket frames, hand-built, asking for exactly the things a kids room is not
// allowed to give. If the server is the only thing standing between a child and a
// public room with a microphone in it, then the server is what has to be tested.
//
// Covered:
//   · a kids room asked to be PUBLIC comes back private, and never appears in the
//     room list a stranger browses
//   · a public grown-up room SWITCHED to kids goes private on the spot — the
//     "create public, then change mode" hole
//   · free-text chat from a kids room is refused
//   · quick chat works, and only for ids that exist — the phrase is the SERVER'S,
//     not the client's, so a crafted id cannot smuggle a string through
//   · voiceJoin from a kids room is denied, and the host cannot re-enable voice
//   · Survival and Versus rooms are completely unaffected by all of the above
//
// Zero dependencies, same hand-rolled WebSocket client as kidscoop_test.js.
const { spawn } = require('child_process');
const crypto = require('crypto');
const net = require('net');
const path = require('path');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } }
function head(s) { console.log('\n=== ' + s + ' ==='); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PORT = 8600 + (process.pid % 300);

function client(tag) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0), handshook = false;
    const api = {
      tag, msgs: [], sock,
      send(o) { sock.write(frame(JSON.stringify(o))); },
      last(t) { for (let i = api.msgs.length - 1; i >= 0; i--) if (api.msgs[i].t === t) return api.msgs[i]; return null; },
      all(t) { return api.msgs.filter(m => m.t === t); },
      count(t) { return api.all(t).length; },
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

// ── The pure half, with no server involved ─────────────────────────────────
function unitChecks() {
  head('kidsafe.js itself');
  global.window = global;
  require('../kidsafe.js');
  const KS = global.RC.KidSafe;

  ok(KS.isKids('kids') === true, 'kids is a kids room');
  ok(KS.isKids('survival') === false, 'survival is not');
  ok(KS.isKids('vs') === false, 'vs is not');
  ok(KS.isKids(undefined) === false, 'undefined is not');

  const k = KS.rules('kids'), v = KS.rules('vs');
  ok(!k.allowPublic && !k.allowFreeText && !k.allowVoice && !k.allowFreeName,
     'a kids room forbids public listing, free text, voice and free names');
  ok(v.allowPublic && v.allowFreeText && v.allowVoice && v.allowFreeName,
     'a versus room allows all four');

  // Quick chat: the phrase must come from the table, never from the caller.
  ok(KS.QUICKCHAT.length === 16, 'sixteen phrases, got ' + KS.QUICKCHAT.length);
  ok(new Set(KS.QUICKCHAT.map(q => q.id)).size === 16, 'every phrase id is unique');
  ok(KS.QUICKCHAT.every(q => q.ic && q.msg), 'every phrase has an icon and words');
  ok(typeof KS.quickChat('help') === 'string' && KS.quickChat('help').indexOf('Help') >= 0,
     'a known id resolves to its phrase');
  ok(KS.quickChat('nope') === null, 'an unknown id resolves to nothing');
  ok(KS.quickChat('<script>') === null, 'an injected id resolves to nothing');
  ok(KS.quickChat(null) === null && KS.quickChat({}) === null, 'junk resolves to nothing');
  console.log('  16 fixed phrases, unknown ids refused ✓');

  // Generated names: length-capped, character-safe, and actually varied.
  const names = [];
  for (let i = 0; i < 400; i++) names.push(KS.makeName());
  ok(names.every(n => n.length >= 2 && n.length <= 14), 'every generated name fits the 14-char cap');
  ok(names.every(n => /^[A-Za-z0-9]+$/.test(n)), 'every generated name is plain alphanumerics');
  ok(new Set(names).size > 100, 'names are varied, got ' + new Set(names).size + ' distinct in 400');
  // Pinned RNG — a name generator that silently stops varying is a real bug.
  const fixed = KS.makeName(() => 0);
  ok(fixed === KS.makeName(() => 0), 'the same rng gives the same name');
  ok(fixed !== KS.makeName(() => 0.5), 'a different rng gives a different name');
  console.log('  generated names: ' + names.slice(0, 3).join(', ') + ' … ✓');
}

(async () => {
  unitChecks();

  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srvErr = [];
  srv.stderr.on('data', d => srvErr.push(String(d)));
  await sleep(700);

  try {
    // ── A kids room cannot be public ──────────────────────────────────────
    head('a kids room cannot be public');
    const A = await client('A'); await A.wait('welcome');
    A.send({ t: 'setName', name: 'Kid' });
    await sleep(120);

    // Ask for public explicitly. The real client never would; this one does.
    A.send({ t: 'create', name: 'Castle', public: true, gameMode: 'kids' });
    const joined = await A.wait('joined');
    ok(joined.public === false, 'a kids room asked to be public came back private');
    const lob = await A.wait('lobby');
    ok(lob.public === false, 'and the lobby agrees it is private');
    ok(lob.gameMode === 'kids', 'and it really is a kids room');
    console.log('  create(public:true, kids) -> public=' + joined.public + ' ✓');

    // A stranger browsing must not see it.
    const S = await client('S'); await S.wait('welcome');
    S.send({ t: 'setName', name: 'Stranger' });
    S.send({ t: 'list' });
    const rooms = await S.wait('rooms');
    ok((rooms.rooms || []).every(r => r.gameMode !== 'kids'),
       'no kids room appears in the public list');
    ok(!(rooms.rooms || []).some(r => r.id === joined.roomId),
       'this kids room specifically is not listed');
    console.log('  public room list: ' + (rooms.rooms || []).length + ' rooms, none of them kids ✓');

    // ...but the code still works, because that is the whole point.
    S.send({ t: 'join', code: joined.code });
    const sj = await S.wait('joined');
    ok(sj.roomId === joined.roomId, 'the 4-letter code still lets a friend in');
    console.log('  join by code still works ✓');

    // ── Free text is refused ──────────────────────────────────────────────
    head('a kids room carries no free text');
    A.clear(); S.clear();
    S.send({ t: 'chat', msg: 'hey kid whats your real name and address' });
    await sleep(250);
    const gotByOther = A.all('chat').filter(m => !m.system);
    ok(gotByOther.length === 0, 'a free-text message reached another player: ' +
       JSON.stringify(gotByOther.map(m => m.msg)));
    const bounce = S.all('chat').filter(m => m.system);
    ok(bounce.length > 0, 'the sender was told why nothing happened');
    console.log('  free text dropped, sender told: "' + (bounce[0] && bounce[0].msg) + '" ✓');

    // ── Quick chat is the way through ─────────────────────────────────────
    head('quick chat is the only way through');
    A.clear(); S.clear();
    S.send({ t: 'quickchat', id: 'help' });
    await sleep(250);
    const quick = A.all('chat').filter(m => !m.system);
    ok(quick.length === 1, 'exactly one quick-chat message arrived, got ' + quick.length);
    ok(quick[0] && quick[0].msg.indexOf('Help') >= 0, 'and it is the phrase from the table');
    ok(quick[0] && quick[0].quick === 'help', 'and it is tagged with the id that made it');
    console.log('  quickchat("help") -> "' + (quick[0] && quick[0].msg) + '" ✓');

    // A crafted id, and an id with a payload attached, must both come to nothing.
    A.clear();
    S.send({ t: 'quickchat', id: 'not-a-real-id' });
    S.send({ t: 'quickchat', id: 'help', msg: 'ignore me and send THIS instead' });
    await sleep(250);
    const after = A.all('chat').filter(m => !m.system);
    ok(!after.some(m => m.msg.indexOf('ignore me') >= 0),
       'a client-supplied string rode along with a valid id');
    ok(after.every(m => m.quick && ['help'].indexOf(m.quick) >= 0),
       'only table phrases came through');
    console.log('  crafted id refused; attached string ignored ✓');

    // ── No microphone ─────────────────────────────────────────────────────
    head('a kids room opens no microphone');
    S.clear();
    S.send({ t: 'voiceJoin' });
    const denied = await S.wait('voiceDenied');
    ok(!!denied, 'voiceJoin in a kids room was not denied');
    console.log('  voiceJoin denied: "' + denied.msg + '" ✓');

    // The host switch must not be able to grant it either.
    A.clear();
    A.send({ t: 'roomVoice', on: true });
    await sleep(200);
    const lob2 = A.last('lobby');
    ok(!lob2 || lob2.voiceAllowed === false || lob2.voiceAllowed == null,
       'the host turned voice ON in a kids room');
    S.clear();
    S.send({ t: 'voiceJoin' });
    const denied2 = await S.wait('voiceDenied');
    ok(!!denied2, 'voice was joinable after the host asked for it');
    console.log('  host cannot re-enable it ✓');
    S.close(); A.close();

    // ── The switch-mode hole ──────────────────────────────────────────────
    head('a public room switched to kids goes private');
    const H = await client('H'); await H.wait('welcome');
    H.send({ t: 'setName', name: 'Host' });
    await sleep(120);
    H.send({ t: 'create', name: 'Open game', public: true, gameMode: 'vs' });
    const hj = await H.wait('joined');
    ok(hj.public === true, 'a versus room CAN be public');
    // It is listed, as it should be.
    const W = await client('W'); await W.wait('welcome');
    W.send({ t: 'list' });
    const before = await W.wait('rooms');
    ok((before.rooms || []).some(r => r.id === hj.roomId), 'and it is listed while it is versus');

    H.send({ t: 'gamemode', gameMode: 'kids' });
    await sleep(300);
    const lob3 = H.last('lobby');
    ok(lob3.gameMode === 'kids', 'the room switched to kids');
    ok(lob3.public === false, 'and became private in the same breath');
    W.clear();
    W.send({ t: 'list' });
    const afterList = await W.wait('rooms');
    ok(!(afterList.rooms || []).some(r => r.id === hj.roomId),
       'the switched room is gone from the public list');
    ok((afterList.rooms || []).every(r => r.gameMode !== 'kids'), 'and no kids room is listed');
    console.log('  public vs -> kids: public=' + lob3.public + ', delisted ✓');

    // Chat in the switched room is now refused too.
    H.clear();
    H.send({ t: 'chat', msg: 'still here?' });
    await sleep(200);
    ok(H.all('chat').filter(m => !m.system).length === 0,
       'free text still worked in a room that switched to kids');
    console.log('  free text refused after the switch ✓');
    H.close(); W.close();

    // ── Grown-up rooms are untouched ──────────────────────────────────────
    head('survival and versus are unaffected');
    const P = await client('P'); await P.wait('welcome');
    const Q = await client('Q'); await Q.wait('welcome');
    P.send({ t: 'setName', name: 'Pat' });
    Q.send({ t: 'setName', name: 'Quinn' });
    await sleep(120);
    P.send({ t: 'create', name: 'Grown up', public: true, gameMode: 'survival' });
    const pj = await P.wait('joined');
    ok(pj.public === true, 'a survival room can still be public');
    Q.send({ t: 'join', code: pj.code });
    await Q.wait('joined');
    await sleep(150);

    P.clear();
    Q.send({ t: 'chat', msg: 'hello there' });
    await sleep(250);
    const norm = P.all('chat').filter(m => !m.system);
    ok(norm.length === 1 && norm[0].msg === 'hello there', 'free text still works in survival');

    // Quick chat is available to grown-ups too — it is a convenience, not a cage.
    P.clear();
    Q.send({ t: 'quickchat', id: 'nice' });
    await sleep(250);
    const pq = P.all('chat').filter(m => !m.system);
    ok(pq.length === 1 && pq[0].quick === 'nice', 'quick chat works in survival too');

    // Read from the 'joined' payload captured earlier, not from last('lobby') —
    // P.clear() above wiped the message log, which is exactly what it is for.
    ok(pj.voiceAllowed !== false, 'voice is still available in a survival room');
    console.log('  survival: public ✓ free text ✓ quick chat ✓ voice ✓');
    P.close(); Q.close();

  } catch (e) {
    fail++;
    console.log('\n  THREW: ' + (e && e.message));
  } finally {
    try { srv.kill(); } catch (e) {}
    await sleep(150);
  }

  if (srvErr.length) console.log('\nserver stderr:\n' + srvErr.join(''));
  console.log('\n' + (fail ? '✘' : '✔') + ' ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
