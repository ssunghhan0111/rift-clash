// RIFT CLASH — Shared netcode core (DOM-free; used by both the Node server and the browser client)
// RC.Net.applyCommand : apply a player's command to the authoritative game
// RC.Net.serialize    : pack the game state into a compact snapshot
// RC.Net.applySnapshot: reconcile a client-side game to match a snapshot (by entity id)
window.RC = window.RC || {};

(function () {
  const RC = window.RC;

  function ownUnits(game, owner, ids) {
    const set = new Set(ids);
    return game.units.filter(u => u.owner === owner && set.has(u.id) && !u.dead && !u.boarded);
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
        us.forEach(u => { if (u.def.ability && u.def.ability.key.toLowerCase() === c.key) u.cast(game); });
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
    }
  }

  // ── Serialize the authoritative game into a compact snapshot ──
  function serialize(game) {
    const U = game.units.map(u => ({
      i: u.id, t: u.type, o: u.owner,
      x: Math.round(u.x), y: Math.round(u.y),
      h: Math.round(u.hp), m: Math.round(u.maxHp),
      f: Math.round(u.facing * 128), s: u.state, c: u.carry, e: Math.round(u.energy),
      b: (u.surge > 0 ? 1 : 0) | (u.rail > 0 ? 2 : 0) | (u.bulwark > 0 ? 4 : 0) | (u.slow > 0 ? 8 : 0),
      a: u.acidStacks || 0, cg: (u.cargo ? u.cargo.length : 0), hf: u.hitFlash > 0 ? 1 : 0,
    }));
    const B = game.buildings.map(b => ({
      i: b.id, t: b.type, o: b.owner, x: b.x, y: b.y,
      h: Math.round(b.hp), m: b.maxHp, p: Math.round(b.buildProgress * 1000),
      q: b.queue.map(j => ({ t: j.type, l: Math.round(j.timeLeft * 100), n: j.total })),
      r: b.research ? { k: b.research.kind, l: Math.round(b.research.timeLeft * 100), n: b.research.total } : null,
      fa: b.foe ? Math.round(Math.atan2(b.foe.y - b.y, b.foe.x - b.x) * 128) : null,
      rx: Math.round(b.rally.x), ry: Math.round(b.rally.y),
    }));
    const N = game.nodes.map(n => ({ i: n.id, x: Math.round(n.x), y: Math.round(n.y), a: n.amount, m: n.max }));
    const FX = game.fx.map(f => Object.assign({}, f));
    const res = {}, up = {};
    for (const o in game.res) res[o] = Math.round(game.res[o].shard);
    for (const o in game.upgrades) up[o] = game.upgrades[o];
    return { tm: game.time, ov: game.over, res, up, U, B, N, FX };
  }

  // ── Reconcile a client game to a snapshot (entities are real RC.Unit/Building instances) ──
  function applySnapshot(game, s) {
    game.time = s.tm; game.over = s.ov;
    game.res = game.res || {};
    for (const o in s.res) { if (!game.res[o]) game.res[o] = { shard: 0 }; game.res[o].shard = s.res[o]; }
    game.upgrades = s.up;

    const umap = game._umap || (game._umap = new Map());
    const useen = new Set();
    for (const d of s.U) {
      useen.add(d.i);
      let u = umap.get(d.i);
      if (!u || u.type !== d.t) { u = new RC.Unit(d.t, d.x, d.y, d.o); u.id = d.i; umap.set(d.i, u); }
      u.owner = d.o; u.x = d.x; u.y = d.y; u.hp = d.h; u.maxHp = d.m; u.facing = d.f / 128;
      u.state = d.s; u.carry = d.c; u.energy = d.e;
      u.surge = (d.b & 1) ? 1 : 0; u.rail = (d.b & 2) ? 1 : 0; u.bulwark = (d.b & 4) ? 1 : 0; u.slow = (d.b & 8) ? 1 : 0;
      u.acidStacks = d.a; u.hitFlash = d.hf ? 0.12 : 0;
      u.cargo = u.def.transport ? new Array(d.cg) : null;
      u.dead = false;
    }
    for (const [id, u] of umap) if (!useen.has(id)) umap.delete(id);
    game.units = Array.from(umap.values());

    const bmap = game._bmap || (game._bmap = new Map());
    const bseen = new Set();
    for (const d of s.B) {
      bseen.add(d.i);
      let b = bmap.get(d.i);
      if (!b || b.type !== d.t) { b = new RC.Building(d.t, d.x, d.y, d.o, true); b.id = d.i; bmap.set(d.i, b); }
      b.owner = d.o; b.x = d.x; b.y = d.y; b.hp = d.h; b.maxHp = d.m; b.buildProgress = d.p / 1000;
      b.queue = d.q.map(j => ({ type: j.t, timeLeft: j.l / 100, total: j.n }));
      b.research = d.r ? { kind: d.r.k, timeLeft: d.r.l / 100, total: d.r.n } : null;
      b.foe = (d.fa != null) ? { x: b.x + Math.cos(d.fa / 128) * 10, y: b.y + Math.sin(d.fa / 128) * 10 } : null;
      b.rally = { x: d.rx, y: d.ry };
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

    game.fx = s.FX || [];
  }

  RC.Net = { applyCommand, serialize, applySnapshot };
})();
