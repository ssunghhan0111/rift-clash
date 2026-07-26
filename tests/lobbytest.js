// End-to-end over the REAL server and REAL WebSockets: nickname propagation,
// the online player list, and direct invites for 1v1 / 2v2 / Survival.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PORT = 8231;
const srv = spawn(process.execPath, [SRC + '/server.js'], {
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvErr = '';
srv.stderr.on('data', d => { srvErr += d.toString(); });

// A tiny test client: connects, records every message by type.
function client(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    const c = {
      label, ws, id: null, log: [], byType: {},
      send: o => ws.send(JSON.stringify(o)),
      last: t => c.byType[t] && c.byType[t][c.byType[t].length - 1],
      count: t => (c.byType[t] || []).length,
      clear: () => { c.log.length = 0; c.byType = {}; },
      // resolve as soon as a message of type t arrives (or reject on timeout)
      wait: (t, ms) => new Promise((res, rej) => {
        const have = c.last(t);
        if (have) return res(have);
        const started = Date.now();
        const iv = setInterval(() => {
          const m = c.last(t);
          if (m) { clearInterval(iv); res(m); }
          else if (Date.now() - started > (ms || 3000)) { clearInterval(iv); rej(new Error(label + ' never got "' + t + '"')); }
        }, 15);
      }),
      close: () => ws.close(),
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      c.log.push(m);
      (c.byType[m.t] = c.byType[m.t] || []).push(m);
      if (m.t === 'welcome') c.id = m.id;
    };
    ws.onopen = () => resolve(c);
    ws.onerror = e => reject(new Error(label + ' socket error'));
  });
}

const nameOf = (list, id) => (list.find(p => p.id === id) || {}).name;
const statusOf = (list, id) => (list.find(p => p.id === id) || {}).status;

(async () => {
  if (typeof WebSocket === 'undefined') { console.log('no global WebSocket in this Node — cannot run'); process.exit(1); }
  await sleep(700);

  // ── presence ───────────────────────────────────────────────────────────
  console.log('=== presence ===');
  const A = await client('A');
  await A.wait('welcome');
  ok(A.count('presence') >= 1, 'a fresh client got no presence list');
  ok(A.last('presence').players.length === 1, 'presence should list only A, got ' + A.last('presence').players.length);

  A.send({ t: 'setName', name: 'Jayden' });
  await sleep(120);
  ok(nameOf(A.last('presence').players, A.id) === 'Jayden', 'setName did not reach the presence list');
  console.log('  A joins and names itself → ' + JSON.stringify(A.last('presence').players));

  const B = await client('B');
  await B.wait('welcome');
  B.send({ t: 'setName', name: 'Mina' });
  await sleep(150);
  ok(A.last('presence').players.length === 2, 'A was not told that B arrived');
  ok(nameOf(A.last('presence').players, B.id) === 'Mina', "A does not see B's name");
  ok(nameOf(B.last('presence').players, A.id) === 'Jayden', "B does not see A's name");
  ok(statusOf(A.last('presence').players, B.id) === 'idle', 'a menu-idle player should read as idle');
  console.log('  B joins → both see each other ✓');

  const C = await client('C');
  await C.wait('welcome');
  C.send({ t: 'setName', name: 'Rae' });
  await sleep(150);
  ok(A.last('presence').players.length === 3, 'presence did not grow to 3');
  console.log('  3 players online ✓');

  // ── invite: 1v1 ────────────────────────────────────────────────────────
  console.log('\n=== invite to 1v1 ===');
  A.send({ t: 'invite', to: B.id, kind: 'vs', modeId: '1v1' });
  const inv = await B.wait('invited');
  ok(inv.fromName === 'Jayden', 'invite carried the wrong sender name: ' + inv.fromName);
  ok(inv.gameMode === 'vs' && inv.modeId === '1v1', 'invite carried the wrong game mode');
  ok(typeof inv.roomId === 'number', 'invite carried no room to join');
  ok(A.count('inviteSent') === 1, 'sender got no confirmation');
  ok(A.count('joined') === 1, 'inviting did not put the sender in a room');
  console.log('  B received: "' + inv.fromName + ' invites you to ' + inv.modeId + '" ✓');

  B.send({ t: 'inviteAccept', roomId: inv.roomId });
  await B.wait('joined');
  await sleep(150);
  const lob = A.last('lobby');
  ok(lob && lob.players.length === 2, 'accepting did not put both players in one lobby');
  ok(lob.players.map(p => p.name).sort().join(',') === 'Jayden,Mina', 'lobby roster is wrong: ' + JSON.stringify(lob.players));
  ok(lob.modeId === '1v1', 'lobby did not take the invited mode');
  ok(statusOf(C.last('presence').players, A.id) === 'lobby', 'a player in a lobby should read as lobby');
  console.log('  both in one lobby: ' + lob.players.map(p => p.name).join(' + ') + ' ✓');

  // ── decline ────────────────────────────────────────────────────────────
  console.log('\n=== decline ===');
  C.clear();
  await sleep(1600);                     // the sender-side invite cooldown
  A.send({ t: 'invite', to: C.id, kind: 'vs', modeId: '2v2' });
  const inv2 = await C.wait('invited');
  ok(inv2.modeId === '2v2', 'the 2v2 invite did not carry 2v2, got ' + inv2.modeId);
  ok(A.last('lobby').modeId === '2v2', "inviting to 2v2 did not reshape the host's lobby");
  C.send({ t: 'inviteDecline', to: inv2.from });
  const dec = await A.wait('inviteDeclined');
  ok(dec.name === 'Rae', 'decline came back with the wrong name');
  ok(A.last('lobby').players.length === 2, 'a decline should leave the existing lobby untouched');
  console.log('  2v2 invite declined by Rae, lobby intact ✓');

  // ── invite to survival ─────────────────────────────────────────────────
  console.log('\n=== invite to survival ===');
  C.clear();
  await sleep(1600);
  A.send({ t: 'invite', to: C.id, kind: 'survival' });
  const inv3 = await C.wait('invited');
  ok(inv3.gameMode === 'survival', 'survival invite did not carry survival');
  C.send({ t: 'inviteAccept', roomId: inv3.roomId });
  await sleep(200);
  ok(A.last('lobby').players.length === 3, 'survival lobby should hold 3, got ' + A.last('lobby').players.length);
  ok(A.last('lobby').gameMode === 'survival', 'lobby did not switch to survival');
  ok(A.last('lobby').cap === 4, 'survival cap should be 4, got ' + A.last('lobby').cap);
  console.log('  survival co-op lobby with ' + A.last('lobby').players.length + ' defenders ✓');

  // ── status flips to "in a match" ───────────────────────────────────────
  console.log('\n=== status while playing ===');
  const D = await client('D');
  await D.wait('welcome');
  D.send({ t: 'setName', name: 'Watcher' });
  await sleep(120);
  A.send({ t: 'start' });
  await sleep(600);
  const pres = D.last('presence');
  ok(statusOf(pres.players, A.id) === 'ingame', 'a playing host should read as ingame, got ' + statusOf(pres.players, A.id));
  ok(statusOf(pres.players, B.id) === 'ingame', 'a playing guest should read as ingame');
  ok(statusOf(pres.players, D.id) === 'idle', 'a bystander should still read as idle');
  console.log('  onlookers see: ' + pres.players.map(p => p.name + '(' + p.status + ')').join(', ') + ' ✓');

  // and you cannot invite someone who is mid-match
  D.clear();
  D.send({ t: 'invite', to: A.id, kind: 'vs', modeId: '1v1' });
  const err = await D.wait('inviteError');
  ok(/already in a match/.test(err.msg), 'wrong error for inviting a busy player: ' + err.msg);
  ok(D.count('invited') === 0, 'a busy player was still sent an invite');
  console.log('  inviting a busy player is refused: "' + err.msg + '" ✓');

  // ── invite spam is rate limited ────────────────────────────────────────
  console.log('\n=== abuse guards ===');
  const E = await client('E'); await E.wait('welcome'); E.send({ t: 'setName', name: 'Spammer' });
  const F = await client('F'); await F.wait('welcome'); F.send({ t: 'setName', name: 'Victim' });
  await sleep(120);
  for (let i = 0; i < 6; i++) E.send({ t: 'invite', to: F.id, kind: 'vs', modeId: '1v1' });
  await sleep(300);
  ok(F.count('invited') === 1, 'rate limit let ' + F.count('invited') + ' invites through instead of 1');
  ok(E.count('inviteError') >= 1, 'no rate-limit error was reported to the sender');
  console.log('  6 rapid invites → ' + F.count('invited') + ' delivered ✓');

  E.clear();
  await sleep(1600);                     // clear the cooldown so we test the RIGHT error
  E.send({ t: 'invite', to: 99999, kind: 'vs' });
  const gone = await E.wait('inviteError');
  ok(/no longer online/.test(gone.msg), 'wrong error for an unknown player: ' + gone.msg);
  E.clear();
  await sleep(1600);
  E.send({ t: 'invite', to: E.id, kind: 'vs' });
  const self = await E.wait('inviteError');
  ok(!!self, 'inviting yourself was allowed');
  console.log('  unknown target and self-invite both refused ✓');

  // ── leaving updates presence ───────────────────────────────────────────
  console.log('\n=== disconnect ===');
  const beforeN = D.last('presence').players.length;
  F.close(); E.close();
  await sleep(400);
  ok(D.last('presence').players.length === beforeN - 2, 'presence did not shrink when players left');
  console.log('  ' + beforeN + ' → ' + D.last('presence').players.length + ' after two disconnects ✓');

  // ── the room browser still works alongside all this ────────────────────
  console.log('\n=== room browser unaffected ===');
  const G = await client('G'); await G.wait('welcome');
  G.send({ t: 'setName', name: 'Browser' });
  G.send({ t: 'create', name: 'Open Game', public: true, gameMode: 'vs' });
  await G.wait('joined');
  await sleep(150);
  const H = await client('H'); await H.wait('welcome');
  H.send({ t: 'list' });
  await sleep(200);
  const rooms = H.last('rooms').rooms;
  ok(rooms.some(r => r.name === 'Open Game'), 'the public room list broke: ' + JSON.stringify(rooms));
  ok(H.count('presence') >= 1, 'the list request did not also return presence');
  console.log('  public rooms still listed (' + rooms.length + ') and presence rides along ✓');

  [A, B, C, D, G, H].forEach(c => { try { c.close(); } catch (e) {} });
  await sleep(200);
  ok(!/Error|error:/i.test(srvErr), 'the server logged errors:\n' + srvErr);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.log('HARNESS ERROR: ' + e.message);
  if (srvErr) console.log('server stderr:\n' + srvErr);
  srv.kill();
  process.exit(1);
});
