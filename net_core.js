// RIFT CLASH — Shared netcode core (DOM-free; used by both the Node server and the browser client)
// RC.Net.applyCommand : apply a player's command to the authoritative game
// RC.Net.serialize    : pack the game state into a compact snapshot
// RC.Net.applySnapshot: reconcile a client-side game to match a snapshot (by entity id)
window.RC = window.RC || {};

(function () {
  const RC = window.RC;

  function ownUnits(game, owner, ids) {
    const set = new Set(ids);
    // A worker mid-construction is locked: it ignores new commands until the build finishes or is cancelled.
    return game.units.filter(u => u.owner === owner && set.has(u.id) && !u.dead && !u.boarded && u.state !== 'build');
  }
  function byId(arr, id) { return arr.find(e => e.id === id && !e.dead); }

  // ── Apply one command from `owner` to the authoritative game ──
  function applyCommand(game, owner, c) {
    if (!c || !c.t) return;
    switch (c.t) {
      case 'move': {
        const us = ownUnits(game, owner, c.ids);
        us.forEach((u, i) => {
          const ring = Math.floor(i / 6), a = (i % 6) / 6 * Math.PI * 2;
          const off = ring === 0 && us.length === 1 ? 0 : 26 + ring * 26;
          u.moveTo(c.x + Math.cos(a) * off, c.y + Math.sin(a) * off);
        });
        break;
      }
      case 'attack': {
        const us = ownUnits(game, owner, c.ids);
        const tgt = byId(game.units, c.tid) || byId(game.buildings, c.tid);
        if (tgt && game.areEnemies(tgt.owner, owner)) us.forEach(u => u.attackTarget(tgt));
        break;
      }
      case 'amove': {   // attack-move: march to a point, engaging enemies met on the way
        const us = ownUnits(game, owner, c.ids);
        us.forEach((u, i) => {
          const ring = Math.floor(i / 6), a = (i % 6) / 6 * Math.PI * 2;
          const off = ring === 0 && us.length === 1 ? 0 : 26 + ring * 26;
          u.attackMoveTo(c.x + Math.cos(a) * off, c.y + Math.sin(a) * off);
        });
        break;
      }
      case 'gather': {
        const us = ownUnits(game, owner, c.ids);
        const node = byId(game.nodes, c.nid);
        if (node) us.forEach(u => { if (u.def.worker) u.gatherFrom(node); });
        break;
      }
      case 'buildSite': {   // send workers to keep building an existing unfinished building
        const us = ownUnits(game, owner, c.ids);
        const site = game.buildings.find(b => b.id === c.bid && !b.dead && !b.done);
        if (site) us.forEach(u => { if (u.def.worker) u.buildAt(site); });
        break;
      }
      case 'build': {
        const us = ownUnits(game, owner, c.ids);
        const workers = us.filter(u => u.def.worker);
        game.placeBuilding(c.bt, c.x, c.y, owner, workers.length ? [workers[0]] : []);
        break;
      }
      case 'train': { const b = byId(game.buildings, c.bid); if (b && b.owner === owner) game.train(b, c.ut); break; }
      case 'research': { const b = byId(game.buildings, c.bid); if (b && b.owner === owner) game.research(b, c.k); break; }
      case 'cancelQueue': { const b = byId(game.buildings, c.bid); if (b && b.owner === owner) game.cancelQueueAt(b, c.i); break; }
      case 'cancelBuild': { const b = game.buildings.find(x => x.id === c.bid && !x.dead); if (b && b.owner === owner) game.cancelBuild(b); break; }
      case 'cast': {
        const us = ownUnits(game, owner, c.ids);
        us.forEach(u => {
          if (u.def.hero) u.cast(game, c.key);
          else if (u.def.ability && u.def.ability.key.toLowerCase() === c.key) u.cast(game);
        });
        break;
      }
      case 'rally': {
        c.ids.forEach(id => { const b = byId(game.buildings, id); if (b && b.owner === owner) b.rally = { x: c.x, y: c.y }; });
        break;
      }
      case 'board': {
        const us = ownUnits(game, owner, c.ids);
        const ship = byId(game.units, c.sid);
        if (ship && ship.owner === owner && ship.def.transport) us.forEach(u => { if (u !== ship && !u.def.flying) u.boardTarget(ship); });
        break;
      }
      case 'stop': { ownUnits(game, owner, c.ids).forEach(u => u.stop()); break; }
      // ── Crystal Guard ──
      // The mode has no build placement and no train-from-a-selected-building, so its two
      // player actions need their own commands. Both are authoritative here for the same
      // reason `train` is: the shard cost, the queue cap and the "was this card actually
      // offered to you" check all live server-side, so a hand-rolled client cannot buy
      // what it cannot afford or take a card it was never dealt.
      case 'kbuy': { if (game.kids && RC.Kids) RC.Kids.buy(game, c.ut, owner); break; }
      case 'kcard': { if (game.kids && RC.Kids) RC.Kids.choose(game, c.id, owner); break; }
    }
  }

  // ── Wire dictionaries ──
  // The snapshot is a full state dump at 15 Hz, so every byte per unit is paid
  // ~15 times a second by every client. With the population cap at 100 a 2v2 can
  // put 300+ units on the field, where a fat row turns into megabits. Two cheap
  // wins, both loss-free: unit/building type ids and unit states travel as
  // integers instead of strings, and any field sitting at its default is left
  // out of the row entirely (the reader fills the default back in).
  // Both sides run THIS file, so the tables can never disagree. An id that
  // somehow isn't in the table falls back to the plain string.
  const STATES = ['idle', 'move', 'attack', 'gather', 'build'];
  let UTYPES = null, BTYPES = null;             // built lazily — RC.UNITS is defined by config.js
  function utypes() { return UTYPES || (UTYPES = Object.keys(RC.UNITS)); }
  function btypes() { return BTYPES || (BTYPES = Object.keys(RC.BUILDINGS)); }
  function packType(list, t) { const i = list.indexOf(t); return i < 0 ? t : i; }
  function unpackType(list, v) { return typeof v === 'number' ? list[v] : v; }

  // ── Serialize the authoritative game into a compact snapshot ──
  function serialize(game) {
    const UT = utypes(), BT = btypes();
    const U = game.units.map(u => {
      const st = STATES.indexOf(u.state);
      const d = {
        i: u.id, t: packType(UT, u.type), o: u.owner,
        x: Math.round(u.x), y: Math.round(u.y),
        h: Math.round(u.hp), m: Math.round(u.maxHp),
        f: Math.round(u.facing * 128),
      };
      if (st > 0) d.s = st;                                   // 0 = idle, the default
      else if (st < 0) d.s = u.state;
      const carry = u.carry || 0;            if (carry) d.c = carry;
      const en = Math.round(u.energy || 0);  if (en) d.e = en;
      const b = (u.surge > 0 ? 1 : 0) | (u.rail > 0 ? 2 : 0) | (u.bulwark > 0 ? 4 : 0) | (u.slow > 0 ? 8 : 0);
      if (b) d.b = b;
      if (u.acidStacks) d.a = u.acidStacks;
      if (u.cargo && u.cargo.length) d.cg = u.cargo.length;
      if (u.hitFlash > 0) d.hf = 1;
      if (u.maxShield) { d.sh = Math.round(u.shield); d.sm = Math.round(u.maxShield); }
      // 영웅 상태 — 레벨/경험치/스킬 쿨다운이 없으면 클라이언트 스킬 패널이 항상 1레벨로 보인다
      if (u.hero) {
        const cd = {};
        for (const k in u.skillCd) if (u.skillCd[k] > 0) cd[k] = Math.round(u.skillCd[k] * 10);
        // ch/sc/up carry the signature: charge 0..255, the post-cast lockout, and which
        // upgrades are held. Without them an online player's charge ring would sit empty
        // and their upgrade icons would never appear — the server owns all three.
        d.hr = { l: u.level, xp: Math.round(u.xp), cd,
                 ch: Math.round((u.charge || 0) * 255),
                 sc: u.sigCd > 0 ? Math.round(u.sigCd * 10) : 0,
                 up: Object.keys(u.sigUp || {}) };
        if (u.downed) d.hr.d = 1;
        if (u.reviveT) d.hr.rt = Math.round(u.reviveT * 10);
        if (u.reviveCost) d.hr.rc = u.reviveCost;
      }
      if (u.temp != null) d.tp = 1;          // 궁극기 소환 유닛 (임시)
      return d;
    });
    const B = game.buildings.map(b => ({
      i: b.id, t: packType(BT, b.type), o: b.owner, x: b.x, y: b.y,
      h: Math.round(b.hp), m: b.maxHp, p: Math.round(b.buildProgress * 1000),
      q: b.queue.map(j => ({ t: j.type, l: Math.round(j.timeLeft * 100), n: j.total })),
      r: b.research ? { k: b.research.kind, l: Math.round(b.research.timeLeft * 100), n: b.research.total } : null,
      fa: b.foe ? Math.round(Math.atan2(b.foe.y - b.y, b.foe.x - b.x) * 128) : null,
      rx: Math.round(b.rally.x), ry: Math.round(b.rally.y),
      sh: b.maxShield ? Math.round(b.shield) : 0, sm: b.maxShield ? Math.round(b.maxShield) : 0,
    }));
    const N = game.nodes.map(n => ({ i: n.id, x: Math.round(n.x), y: Math.round(n.y), a: n.amount, m: n.max }));
    const FX = game.fx.map(f => Object.assign({}, f));
    const res = {}, up = {};
    for (const o in game.res) res[o] = Math.round(game.res[o].shard);
    for (const o in game.upgrades) up[o] = game.upgrades[o];
    // 생존 모드 상태 — 웨이브/처치수/크리스탈 식별자 (HUD와 종료 화면에 필요)
    const sv = game.survival
      ? { w: game.survivalWave || 0, k: game.survivalKills || 0,
          d: game.survivalDiff || 'medium', c: game.crystal ? game.crystal.id : null }
      : null;
    // Crystal Guard — the whole wave director, so a client that never ticks the sim
    // still has a live wave counter, its own reward cards and its own shop.
    const kd = (game.kids && RC.Kids && RC.Kids.netState) ? RC.Kids.netState(game) : null;
    return { tm: game.time, ov: game.over, res, up, U, B, N, FX, sv, kd };
  }

  // ── Reconcile a client game to a snapshot (entities are real RC.Unit/Building instances) ──
  function applySnapshot(game, s) {
    game.time = s.tm; game.over = s.ov;
    game.res = game.res || {};
    for (const o in s.res) { if (!game.res[o]) game.res[o] = { shard: 0 }; game.res[o].shard = s.res[o]; }
    game.upgrades = s.up;

    const UT = utypes(), BT = btypes();
    const umap = game._umap || (game._umap = new Map());
    const useen = new Set();
    for (const d of s.U) {
      useen.add(d.i);
      const type = unpackType(UT, d.t);
      let u = umap.get(d.i);
      if (!u || u.type !== type) { u = new RC.Unit(type, d.x, d.y, d.o); u.id = d.i; umap.set(d.i, u); }
      u.owner = d.o; u.x = d.x; u.y = d.y; u.hp = d.h; u.maxHp = d.m; u.facing = d.f / 128;
      // anything the sender left out is at its default — that is how the row stays small
      u.state = (typeof d.s === 'number') ? STATES[d.s] : (d.s || 'idle');
      u.carry = d.c || 0; u.energy = d.e || 0;
      const bf = d.b || 0;
      u.surge = (bf & 1) ? 1 : 0; u.rail = (bf & 2) ? 1 : 0; u.bulwark = (bf & 4) ? 1 : 0; u.slow = (bf & 8) ? 1 : 0;
      u.acidStacks = d.a || 0; u.hitFlash = d.hf ? 0.12 : 0;
      // 실드는 서버가 권위 — 클라이언트는 값만 반영하고 반짝임만 로컬로 연출
      if (d.sm) { if (d.sh < u.shield) u.shieldFx = 0.18; u.shield = d.sh; u.maxShield = d.sm; }
      u.cargo = u.def.transport ? new Array(d.cg || 0) : null;
      // 영웅 — 서버가 권위. 레벨/부활/쿨다운을 그대로 반영해야 스킬·궁극기 버튼이 맞는다
      if (d.hr && u.hero) {
        u.level = d.hr.l; u.xp = d.hr.xp;
        u.charge = (d.hr.ch || 0) / 255;
        u.sigCd = (d.hr.sc || 0) / 10;
        u.sigUp = {};
        for (const k of (d.hr.up || [])) u.sigUp[k] = true;
        if ((d.hr.up || []).length) u.useCardUpgrades();
        u.downed = !!d.hr.d; u.reviveT = (d.hr.rt || 0) / 10; u.reviveCost = d.hr.rc || 0;
        u.skillCd = {};
        for (const k in d.hr.cd) u.skillCd[k] = d.hr.cd[k] / 10;
      }
      // 소환 유닛은 표시만 다르게 (수명은 서버가 관리 — 클라이언트에 temp를 세팅하면
      // 로컬에서 수명이 흘러 스냅샷과 어긋나므로 표시 전용 플래그만 쓴다)
      u.summoned = !!d.tp;
      u.dead = false;
    }
    for (const [id, u] of umap) if (!useen.has(id)) umap.delete(id);
    game.units = Array.from(umap.values());
    // Rebuild heroOf. A client replaces its whole unit list from the snapshot, so the
    // objects game.heroOf was pointing at are no longer on the field — leaving the hero
    // button, the charge ring and the Crystal Guard signature button all reading a stale
    // corpse that never updates again.
    game.heroOf = game.heroOf || {};
    for (const o in game.heroOf) if (game.heroOf[o] && !umap.has(game.heroOf[o].id)) delete game.heroOf[o];
    for (const u of game.units) if (u.hero && !u.dead) game.heroOf[u.owner] = u;

    const bmap = game._bmap || (game._bmap = new Map());
    const bseen = new Set();
    for (const d of s.B) {
      bseen.add(d.i);
      const btype = unpackType(BT, d.t);
      let b = bmap.get(d.i);
      if (!b || b.type !== btype) { b = new RC.Building(btype, d.x, d.y, d.o, true); b.id = d.i; bmap.set(d.i, b); }
      b.owner = d.o; b.x = d.x; b.y = d.y; b.hp = d.h; b.maxHp = d.m; b.buildProgress = d.p / 1000;
      b.queue = d.q.map(j => ({ type: j.t, timeLeft: j.l / 100, total: j.n }));
      b.research = d.r ? { kind: d.r.k, timeLeft: d.r.l / 100, total: d.r.n } : null;
      b.foe = (d.fa != null) ? { x: b.x + Math.cos(d.fa / 128) * 10, y: b.y + Math.sin(d.fa / 128) * 10 } : null;
      b.rally = { x: d.rx, y: d.ry };
      if (d.sm) { if (d.sh < b.shield) b.shieldFx = 0.18; b.shield = d.sh; b.maxShield = d.sm; }
      b.dead = false;
    }
    for (const [id, b] of bmap) if (!bseen.has(id)) bmap.delete(id);
    game.buildings = Array.from(bmap.values());

    const nmap = game._nmap || (game._nmap = new Map());
    const nseen = new Set();
    for (const d of s.N) {
      nseen.add(d.i);
      let n = nmap.get(d.i);
      if (!n) { n = new RC.ShardNode(d.x, d.y); n.id = d.i; nmap.set(d.i, n); }
      n.x = d.x; n.y = d.y; n.amount = d.a; n.max = d.m;
    }
    for (const [id, n] of nmap) if (!nseen.has(id)) nmap.delete(id);
    game.nodes = Array.from(nmap.values());

    // 생존 모드 — 웨이브/처치수/크리스탈 참조를 서버 상태로 맞춘다.
    // (건물 맵을 다시 만든 뒤여야 크리스탈을 id로 찾을 수 있다)
    if (s.sv) {
      game.survival = true;
      game.survivalWave = s.sv.w;
      game.survivalKills = s.sv.k;
      game.survivalDiff = s.sv.d || game.survivalDiff || 'medium';
      game.crystal = (s.sv.c != null) ? (bmap.get(s.sv.c) || null) : null;
    }
    if (s.kd && RC.Kids && RC.Kids.applyNetState) {
      game.kids = true;
      RC.Kids.applyNetState(game, s.kd);
    }

    // 궁극기 화면 흔들림은 서버가 보내지 않는다 (순수 연출). 스냅샷의 이펙트 중
    // 처음 보는 궁극기 이펙트를 만나면 클라이언트가 스스로 흔든다.
    const ULT_SHAKE = { barrage: 1.0, swarm: 0.55, aegis: 0.8 };
    const seenFx = game._ultFx || (game._ultFx = new Set());
    const nowKeys = new Set();
    for (const f of (s.FX || [])) {
      // 건물 파괴(boom:2)도 궁극기처럼 클라이언트가 스스로 흔든다 (서버는 연출 상태를 보내지 않음)
      const amt = ULT_SHAKE[f.abil] || (f.boom === 2 ? 0.35 : 0);
      if (!amt) continue;
      const k = (f.abil || 'boom' + f.boom) + ':' + Math.round(f.ax) + ':' + Math.round(f.ay);
      nowKeys.add(k);
      if (!seenFx.has(k) && game.shake) game.shake(amt);
    }
    game._ultFx = nowKeys;

    // 흔들림 감쇠 — 온라인 클라이언트는 game.update()를 돌리지 않으므로 여기서 줄인다
    if (game.shakeT > 0) {
      const step = Math.max(0, s.tm - (game._lastShakeTm != null ? game._lastShakeTm : s.tm));
      game.shakeT = Math.max(0, game.shakeT - step);
      if (game.shakeT === 0) game.shakeMax = 0;
    }
    game._lastShakeTm = s.tm;

    game.fx = s.FX || [];
  }

  RC.Net = { applyCommand, serialize, applySnapshot };

  // Offline default for RC.cmd. net.js — browser only — replaces this with a version that
  // routes to the server while RC.online. Defining the fallback HERE, in the DOM-free
  // half, means every module that issues a command can rely on RC.cmd existing: kidsui.js
  // now sends its buys and card picks through it, and it must not explode in a headless
  // test or anywhere else net.js was never loaded.
  // net_core.js is loaded BEFORE net.js (see index.html), so the browser version still wins.
  if (!RC.cmd) RC.cmd = function (game, cmd) { applyCommand(game, game.playerOwner, cmd); };
})();
