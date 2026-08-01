// RIFT CLASH — THE KEEP
// ─────────────────────────────────────────────────────────────────────────────
// Crystal Defense used to be a tower-defence game that happened to contain walls.
// This turns it into a *building* game that happens to contain a siege — which is
// the thing children actually do with sand, blocks and Minecraft: build a place,
// together, and then invent a reason it has to hold.
//
// Four ideas carry the whole change, and each one is a direct answer to a reason
// the old mode did not feel like building:
//
//  1. **A grid, and pieces that join.** You could already place a wall anywhere,
//     which sounds more free and is much worse: two walls at 44px apart look like
//     two sheds, and a child cannot make a straight line with a mouse. On a grid,
//     a row IS a row — and because neighbouring pieces are drawn joined, with
//     corner posts and battlements on the exposed edges, twelve blocks read as a
//     castle wall rather than as twelve blocks. Free-placement was never the
//     feature; *looking like what you meant* was.
//
//  2. **One keep, one pile of shards.** Two players each had a wallet, a builder,
//     a slot budget and a private "finish that one first" rule, which produced two
//     people building next to each other. Everything structural now belongs to the
//     keep rather than to a player, and everyone spends from the same pile. That
//     single change is what turns "my fort" into "our fort".
//
//  3. **You draw, the builders build.** Drag along a row and the whole line is
//     planned at once; the builders walk it and put it up. The old rule — one
//     building at a time, per player — existed because a single builder trudging
//     between five foundations finished none of them. The answer was not to forbid
//     the plan, it was to make builders finish what they start and then move to the
//     next thing without being told.
//
//  4. **The keep persists, and losing does not take it away.** A sandcastle is
//     worth building because you remember last time's. The layout is saved, it is
//     restored next session, and when the crystal falls the keep is damaged rather
//     than deleted. A child who loses an hour of building to one bad night does not
//     build again.
//
// This file owns the grid, the plan, the piece catalogue, the save file and the
// day/night state. kids.js still owns the waves; game.js still owns the world.
window.RC = window.RC || {};

RC.Keep = (function () {
  'use strict';

  // ── The grid ───────────────────────────────────────────────────────────────
  //
  // 56 is not arbitrary. Game.canPlace rejects two buildings whose centres are
  // closer than (w1 + w2) / 2 + pad, and the pieces are 42 (walls, decor) and 52
  // (towers). 56 clears every pairing on its own — 47 for a tower beside a wall,
  // 52 for two towers — which means **every piece is exactly one cell** and the
  // placement code never has to think about footprints, parity or multi-cell
  // anchors. One cell, one thing, is also the only rule a six-year-old needs.
  //
  // The 14px that leaves between two 42px walls is not a gap in the fiction: the
  // renderer bridges neighbours (see joinMask), so the seam is where the stones
  // interlock rather than where the wall stops.
  const GRID = 56;

  // Cells are indexed from the world origin, so both players, the server and the
  // save file agree on which cell is which without exchanging anything.
  const cellX = x => Math.floor(x / GRID);
  const cellY = y => Math.floor(y / GRID);
  const centerX = cx => (cx + 0.5) * GRID;
  const centerY = cy => (cy + 0.5) * GRID;
  const keyOf = (cx, cy) => cx + ',' + cy;

  function snap(x, y) {
    return { x: centerX(cellX(x)), y: centerY(cellY(y)) };
  }
  function cellOf(x, y) { return { cx: cellX(x), cy: cellY(y) }; }

  // A dragged plan, axis-locked. Locking to the dominant axis is the whole point
  // of the request — "so that it can snap and be one line". A free diagonal drag
  // produces a staircase, which is neither a line nor something a child meant.
  function line(ax, ay, bx, by, max) {
    const a = cellOf(ax, ay), b = cellOf(bx, by);
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const n = Math.min(horiz ? Math.abs(dx) : Math.abs(dy), (max || 40) - 1);
    const step = (horiz ? Math.sign(dx) : Math.sign(dy)) || 1;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const cx = horiz ? a.cx + step * i : a.cx;
      const cy = horiz ? a.cy : a.cy + step * i;
      out.push({ cx: cx, cy: cy, x: centerX(cx), y: centerY(cy) });
    }
    return out;
  }

  // ── What counts as a keep piece ────────────────────────────────────────────
  // Set by the building defs (`snap: true`). Anything with it grid-snaps, joins
  // its neighbours visually, belongs to the keep rather than to a player, and is
  // written to the save file.
  const isPiece = b => !!(b && b.def && b.def.snap);
  const joins = b => !!(b && b.def && (b.def.wall || b.def.gate || b.def.keepTower));

  // Cell → building index, rebuilt only when the set of standing buildings
  // changes. The renderer asks four neighbour questions per piece per frame, so
  // on a keep of two hundred blocks this is the difference between a lookup and
  // eighty thousand distance tests.
  function index(g) {
    let sig = 0;
    for (const b of (g.buildings || [])) if (!b.dead) sig = (sig * 31 + b.id + (b.done ? 7 : 0)) | 0;
    const c = g._keepIx;
    if (c && c.sig === sig) return c.map;
    const map = new Map();
    for (const b of (g.buildings || [])) {
      if (b.dead || !isPiece(b)) continue;
      map.set(keyOf(cellX(b.x), cellY(b.y)), b);
    }
    g._keepIx = { sig: sig, map: map };
    return map;
  }
  function at(g, cx, cy) { return index(g).get(keyOf(cx, cy)) || null; }

  // N=1 E=2 S=4 W=8, so the renderer can pick one of sixteen wall shapes the way
  // a tileset would. Corners, ends and straight runs all fall out of the mask.
  function joinMask(g, b) {
    if (!joins(b)) return 0;
    const cx = cellX(b.x), cy = cellY(b.y);
    let m = 0;
    const n = at(g, cx, cy - 1), e = at(g, cx + 1, cy), s = at(g, cx, cy + 1), w = at(g, cx - 1, cy);
    if (joins(n)) m |= 1;
    if (joins(e)) m |= 2;
    if (joins(s)) m |= 4;
    if (joins(w)) m |= 8;
    return m;
  }

  // ── The shared pile ────────────────────────────────────────────────────────
  //
  // One bank, held by the lowest-numbered defender. Deliberately NOT the local
  // player: the server runs the same code and has no local player, and a bank
  // that moved with the viewer would let two clients disagree about who paid.
  //
  // Everything structural is also *owned* by this seat, which is what makes the
  // keep genuinely one object — both players' units defend it, both builders can
  // work on it, and the mender aura repairs it regardless of who placed it.
  function bank(g) {
    if (g._keepBank != null) return g._keepBank;
    let lo = null;
    for (const p of (g.players || [])) {
      if (p.owner === 2 || p.waveEnemy) continue;
      if (lo == null || p.owner < lo) lo = p.owner;
    }
    g._keepBank = lo == null ? (g.playerOwner || 1) : lo;
    return g._keepBank;
  }
  function purse(g) { return g.res[bank(g)] || { shard: 0 }; }
  function shards(g) { return Math.floor(purse(g).shard || 0); }
  function afford(g, cost) { return purse(g).shard >= cost; }

  // ── The catalogue ──────────────────────────────────────────────────────────
  //
  // Structure first, then the things that exist only because a child wants to put
  // a flag on their castle. The decorations are not filler: "I made this and it
  // looks like mine" is most of why anyone builds anything twice, and none of it
  // costs a balance decision because none of it fights.
  //
  // `snap: true` on every entry — a decoration off the grid would break the line
  // it is standing in.
  RC.BUILDINGS.keepgate = {
    id: 'keepgate', name: 'Gate', hp: 900, w: 42, h: 42,
    cost: 35, time: 5, supplyGiven: 0, produces: [], wall: true, gate: true,
    snap: true, kidOnly: true, decorOf: null,
    desc: 'Stands open while you build and swings shut when night falls. Your fighters walk through; the raid has to break it.'
  };
  RC.BUILDINGS.banner = {
    id: 'banner', name: 'Banner', hp: 120, w: 42, h: 42,
    cost: 8, time: 2, supplyGiven: 0, produces: [], snap: true, decor: true, kidOnly: true,
    desc: 'Your colours, on a pole. Does nothing. That is the point.'
  };
  RC.BUILDINGS.torch = {
    id: 'torch', name: 'Torch', hp: 120, w: 42, h: 42,
    cost: 10, time: 2, supplyGiven: 0, produces: [], snap: true, decor: true, kidOnly: true, light: 90,
    desc: 'Burns through the night and lights the ground around it.'
  };
  RC.BUILDINGS.planter = {
    id: 'planter', name: 'Planter', hp: 140, w: 42, h: 42,
    cost: 8, time: 2, supplyGiven: 0, produces: [], snap: true, decor: true, kidOnly: true,
    desc: 'A box of flowers. A keep should be somewhere you would want to live.'
  };
  RC.BUILDINGS.signpost = {
    id: 'signpost', name: 'Signpost', hp: 140, w: 42, h: 42,
    cost: 12, time: 2, supplyGiven: 0, produces: [], snap: true, decor: true, kidOnly: true, names: true,
    desc: 'Put up a sign and the keep gets a name. Tap it to change what it says.'
  };

  // Existing walls and the race towers become keep pieces. Done here rather than
  // in config.js so every fact about the grid lives in one file, and so a build of
  // the game without keep.js still has a working Versus rampart.
  ['logwall', 'rampart', 'steelwall', 'treadwall', 'spikewall', 'carapace', 'aegiswall'].forEach(t => {
    if (RC.BUILDINGS[t]) RC.BUILDINGS[t].snap = true;
  });
  ['stonethrower', 'venomspire', 'prismlaser'].forEach(t => {
    if (RC.BUILDINGS[t]) { RC.BUILDINGS[t].snap = true; RC.BUILDINGS[t].keepTower = true; }
  });

  // The build menu, in the order a castle actually gets made: the wall you can
  // afford now, then better walls, then the gate that turns a wall into a keep,
  // then the tower, then the things that are purely yours.
  // Build times are shorter than the old Crystal Guard ones. When you placed one
  // wall at a time the wait WAS the cost; now that a gesture places twelve, the real
  // cost is the crew walking the line, and leaving the old per-piece times on top of
  // that turns a Build Day into watching. Prices are unchanged — the shards are still
  // the decision.
  const MENU = [
    { t: 'logwall',   ic: '🪵', cost: 12, time: 2, group: 'wall',  kid: 'Super cheap! Breaks fast though.' },
    { t: 'rampart',   ic: '🧱', cost: 25, time: 3, group: 'wall',  kid: 'A good solid wall. Drag to build a whole row!' },
    { t: 'steelwall', ic: '🛡️', cost: 70, time: 6, group: 'wall',  kid: 'SUPER strong. Costs a lot.' },
    { t: 'treadwall', ic: '🌀', cost: 40, time: 4, group: 'wall',  kid: 'Makes bad guys walk really slowly!' },
    { t: 'spikewall', ic: '🌵', cost: 45, time: 4, group: 'wall',  kid: 'Ouch! It hurts anything that bites it.' },
    { t: 'keepgate',  ic: '🚪', cost: 35, time: 4, group: 'wall',  kid: 'Open by day, shut at night. Your guys walk through!' },
    { t: null, race: true, ic: '🗼', cost: 70, time: 7, group: 'tower', kid: 'Shoots bad guys all by itself.' },
    { t: 'banner',    ic: '🚩', cost: 8,  time: 2, group: 'decor', kid: 'Your flag! Just for looking good.' },
    { t: 'torch',     ic: '🔥', cost: 10, time: 2, group: 'decor', kid: 'Lights up the dark at night.' },
    { t: 'planter',   ic: '🌷', cost: 8,  time: 2, group: 'decor', kid: 'Flowers. Every castle needs flowers.' },
    { t: 'signpost',  ic: '🪧', cost: 12, time: 2, group: 'decor', kid: 'Give your keep a NAME!' },
  ];

  function menuFor(raceId) {
    const race = RC.RACES[raceId] || RC.RACES.forge;
    const tower = (race.ai && race.ai.tower) || 'stonethrower';
    return MENU.map(m => m.race ? Object.assign({}, m, { t: tower }) : m);
  }
  function itemOf(raceId, t) { return menuFor(raceId).find(m => m.t === t) || null; }

  // ── Caps ───────────────────────────────────────────────────────────────────
  //
  // The old rule capped EVERYTHING at 3 + half a wave, ceiling 14, so a keep could
  // never be bigger than fourteen blocks — which is a shed. Walls and decorations
  // are now limited only by what they cost, because a wall is a decision about
  // where the fight happens rather than a source of damage, and because the entire
  // point of this mode is now that the thing you build gets big.
  //
  // Towers still need a ceiling: they are the mode's damage, and unlimited towers
  // is the turtle that removes the tension the walls exist to create.
  // Four, not two. A first castle is a rectangle, a rectangle has four corners, and
  // a turret on each corner is the shape every child draws — starting at two meant
  // the very first thing anyone tries to build is refused halfway through.
  const TOWER_BASE = 4, TOWER_PER_WAVE = 0.34, TOWER_MAX = 14;
  function towerCap(g) {
    const w = (g._kd && g._kd.wave) || 0;
    return Math.min(TOWER_MAX, Math.floor(TOWER_BASE + TOWER_PER_WAVE * w));
  }
  function towerUsed(g) {
    let n = 0;
    for (const b of (g.buildings || [])) if (!b.dead && b.def.keepTower) n++;
    return n;
  }
  // A soft ceiling on the whole keep, for the browser rather than for balance:
  // every piece is a nav-grid stamp and a draw call, and a tablet should not be
  // asked to path around a thousand of them.
  const PIECE_MAX = 420;
  function pieceCount(g) {
    let n = 0;
    for (const b of (g.buildings || [])) if (!b.dead && isPiece(b)) n++;
    return n;
  }

  // ── The gate ───────────────────────────────────────────────────────────────
  //
  // A gate that friendly units path through and enemies do not would need a
  // per-owner nav grid, which is a real cost for a decoration. So the gate is
  // honest instead: it is a wall that is OPEN — not in the nav grid, not solid —
  // during Build Day, and shuts when night falls. That is also a better toy: a
  // child gets to decide when the castle is closed.
  function gateOpen(g, b) {
    if (!b || !b.def.gate || b.dead || !b.done) return false;
    if (b.gateForced != null) return b.gateForced;
    return phase(g) === 'build';
  }
  function syncGates(g) {
    let changed = false;
    for (const b of (g.buildings || [])) {
      if (b.dead || !b.def.gate) continue;
      const open = gateOpen(g, b);
      if (!!b.passable !== !!open) { b.passable = !!open; changed = true; }
    }
    // Pathfinding stamps every standing building; an opened gate has to leave the
    // grid or units keep walking around a doorway that is standing open.
    if (changed && RC.Path && RC.Path.invalidate) RC.Path.invalidate(g);
    return changed;
  }
  function toggleGate(g, b) {
    if (!b || !b.def.gate) return false;
    b.gateForced = !gateOpen(g, b);
    syncGates(g);
    return true;
  }

  // ── Day and night ──────────────────────────────────────────────────────────
  const phase = g => (g._kd && g._kd.phase) || 'build';
  const isBuildDay = g => phase(g) === 'build';
  // 0 = full day, 1 = full night. Drives the renderer's tint and the torches.
  function nightAmt(g) {
    const s = g._kd;
    if (!s) return 0;
    const p = s.phase;
    if (p === 'build') return 0;
    if (p === 'celebrate' || p === 'reward') return Math.max(0, 1 - (s.dawnT || 0) / 2.2);
    return 1;
  }

  // ── The seal ───────────────────────────────────────────────────────────────
  //
  // Does the wall actually go all the way round?
  //
  // This is the one thing a castle-building game has to be able to answer, and
  // until now the game could not. Every wall was worth the same whether it was
  // part of a ring or a lonely stub in a field, so the SHAPE of the keep — the
  // part a child is actually thinking about while they build — meant nothing.
  // A pile of forty walls in a heap and a neat ring of forty walls played
  // identically, which is a strange thing for a building game to say.
  //
  // A flood fill from the crystal answers it exactly. If the fill can reach open
  // ground beyond the build ring, there is a way in and the keep is open; if it
  // is boxed in, it is sealed. There is no scoring, no "70% enclosed" — a wall
  // with a gap in it is not a wall, and the honest answer is yes or no.
  //
  // A GATE COUNTS AS SEALED, unless the player has propped it open themselves.
  // A door is not a hole; that is the whole idea of a door, and a game that told
  // a child their gate ruined their castle would be teaching them not to build
  // one. Forcing it open at night is a choice, and then it does count.
  // WHAT COUNTS AS THE WALL. Deliberately not "keep pieces" — anything a unit
  // cannot walk through is part of your perimeter, and this mirrors the rule the
  // PATHFINDER uses (pathfind.js: standing, not passable, not an unfinished site)
  // so that "sealed" means the same thing to the game as it does to the player.
  // Your Fighter Hall plugging the east side of the ring really is a closed ring;
  // telling a child otherwise, while nothing can get in, would be a lie they can
  // see through.
  //
  // Two exceptions, both about not lying the other way:
  //  · An unfinished piece is a hologram, so it seals nothing.
  //  · A GATE counts as sealed unless the player has propped it open themselves.
  //    A door is not a hole — that is the whole idea of a door, and a game that
  //    told a child their gate ruined their castle would teach them not to build one.
  const solidPart = b => {
    if (!b || b.dead || !b.done) return false;
    if (b.def && b.def.gate) return b.gateForced !== true;
    return !b.passable;
  };
  // How far out the fill is allowed to look. One cell past the build ring, so
  // "escaped" genuinely means escaped: nothing can be built out there to plug it.
  function sealRadius() { return Math.ceil(RING / GRID) + 2; }

  // Every cell something solid stands in. A keep piece is exactly one cell; the
  // Fighter Hall, the towers and the map's own boulders are bigger, so the footprint
  // is walked.
  //
  // ANY overlap counts, and that threshold is chosen to match `canPlace`, not to
  // approximate physics. The rule this has to keep is: a cell the player CANNOT put
  // a wall in must never be a cell the game then calls a gap. Anything else is a keep
  // that reads as broken with no way to fix it — which is precisely what happened
  // here first time round, on the cells beside the Fighter Hall, and it is the
  // cruellest possible version of this feature: a child hunting a hole that is not
  // there. The 1px inset is only so a piece sitting exactly on its own cell claims
  // that cell and not its neighbours.
  //
  // The crystal is excluded on purpose. It sits in the middle of every keep, it is
  // the thing being protected rather than part of the protection, and counting it
  // could only ever make a leaky keep read as sealed.
  function solidSet(g) {
    const out = new Set();
    const M = 1;
    const box = (x, y, w, h) => {
      const x0 = cellX(x - w / 2 + M), x1 = cellX(x + w / 2 - M);
      const y0 = cellY(y - h / 2 + M), y1 = cellY(y + h / 2 - M);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) out.add(keyOf(cx, cy));
    };
    for (const b of (g.buildings || [])) {
      if (b === g.crystal || !solidPart(b)) continue;
      box(b.x, b.y, b.w, b.h);
    }
    // Terrain the pathfinder blocks on. A boulder in the wall line is a wall — you
    // cannot build there and nothing can walk through it, so it is part of the ring.
    for (const o of (g.obstacles || [])) box(o.x, o.y, o.w, o.h);
    return out;
  }

  // { sealed, area, yard } — yard is the Set of enclosed cell keys, which the
  // renderer tints and the Build Day bar counts. Cached against a signature of every
  // standing building, because this runs every frame on the client and 1300-odd
  // cells per frame for nothing is rude.
  function enclosure(g) {
    if (!g.crystal) return { sealed: false, area: 0, yard: new Set() };
    let sig = 0;
    for (const b of (g.buildings || [])) {
      if (b.dead) continue;
      sig = (sig * 31 + b.id + (b.done ? 7 : 0) + (b.passable ? 3 : 0) + (b.gateForced === true ? 5 : 0)) | 0;
    }
    const c = g._keepSeal;
    if (c && c.sig === sig) return c.val;

    const solid = solidSet(g);
    const ox = cellX(g.crystal.x), oy = cellY(g.crystal.y);
    const R = sealRadius();
    const yard = new Set();
    const q = [[ox, oy]];
    yard.add(keyOf(ox, oy));
    let sealed = true;
    while (q.length) {
      const [cx, cy] = q.pop();
      // Reached the edge of the world we care about: there is a way out.
      if (Math.abs(cx - ox) > R || Math.abs(cy - oy) > R) { sealed = false; break; }
      const nb = [[cx, cy - 1], [cx + 1, cy], [cx, cy + 1], [cx - 1, cy]];
      for (const [nx, ny] of nb) {
        const k = keyOf(nx, ny);
        if (yard.has(k)) continue;
        if (solid.has(k)) continue;                  // the wall stops the flood
        yard.add(k);
        q.push([nx, ny]);
      }
    }
    // A broken ring floods the whole box, and that is not a yard — do not hand the
    // renderer thirteen hundred cells to tint when the answer is "you are not
    // enclosed". Only a sealed keep has an inside.
    const val = { sealed: sealed, area: sealed ? yard.size : 0, yard: sealed ? yard : new Set() };
    g._keepSeal = { sig: sig, val: val };
    return val;
  }
  const isSealed = g => enclosure(g).sealed;

  // ── The save file ──────────────────────────────────────────────────────────
  //
  // Cells are stored RELATIVE TO THE CRYSTAL, not in world coordinates, so a keep
  // survives the map moving underneath it — and so the same layout could be
  // dropped onto a second map later without a migration.
  const KEY = 'riftclash_keep';
  const NAMES = ['Sunrise Keep', 'Bright Hold', 'The Round Fort', 'Little Bastion', 'Hilltop Keep', 'Shard Watch'];

  function blank() {
    return {
      v: 1,
      name: NAMES[Math.floor(Math.random() * NAMES.length)],
      best: 0, nights: 0, built: 0,
      pieces: [],
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const k = JSON.parse(raw);
      if (!k || !Array.isArray(k.pieces)) return blank();
      k.v = 1;
      k.name = String(k.name || 'My Keep').slice(0, 22);
      k.best = k.best | 0; k.nights = k.nights | 0; k.built = k.built | 0;
      // Drop anything whose building type no longer exists rather than throwing
      // on load — a saved keep must survive the game being updated under it.
      k.pieces = k.pieces.filter(p => Array.isArray(p) && p.length >= 3 && RC.BUILDINGS[p[0]]).slice(0, PIECE_MAX);
      return k;
    } catch (e) { return blank(); }
  }
  function store(k) {
    try { localStorage.setItem(KEY, JSON.stringify(k)); } catch (e) {}
    return k;
  }
  function rename(name) {
    const k = load();
    k.name = String(name || '').trim().slice(0, 22) || k.name;
    return store(k);
  }

  // Snapshot the standing keep. Called after every night survived and when the
  // player stops for the day, never mid-raid — a save taken while the walls are
  // being knocked down would record the rubble rather than the castle.
  function capture(g) {
    if (!g || !g.crystal) return null;
    const k = (g._keepSave = g._keepSave || load());
    const ox = cellX(g.crystal.x), oy = cellY(g.crystal.y);
    const out = [];
    for (const b of (g.buildings || [])) {
      if (b.dead || !isPiece(b) || !b.done) continue;
      out.push([b.type, cellX(b.x) - ox, cellY(b.y) - oy]);
      if (out.length >= PIECE_MAX) break;
    }
    k.pieces = out;
    k.built = out.length;
    k.best = Math.max(k.best | 0, (g._kd && g._kd.best) || (g.survivalWave || 0));
    return store(k);
  }

  // Put the saved keep back on the map, finished and paid for. Restoring a keep as
  // a pile of foundations would make every session start with twenty minutes of
  // watching a builder walk, which is the opposite of the point.
  function restore(g) {
    const k = (g._keepSave = g._keepSave || load());
    if (!g.crystal || !k.pieces.length) return 0;
    const ox = cellX(g.crystal.x), oy = cellY(g.crystal.y);
    const o = bank(g);
    let n = 0;
    for (const p of k.pieces) {
      const d = RC.BUILDINGS[p[0]];
      if (!d) continue;
      const x = centerX(ox + (p[1] | 0)), y = centerY(oy + (p[2] | 0));
      if (!g.canPlace(p[0], x, y, o)) continue;
      const b = new RC.Building(p[0], x, y, o, true);   // built = true
      g.buildings.push(b);
      n++;
    }
    if (n && RC.Path && RC.Path.invalidate) RC.Path.invalidate(g);
    return n;
  }

  // Put back whatever the raid knocked down, at a fraction of its health and for
  // free. This is the mechanical half of "losing never destroys your keep": the
  // save is the source of truth for the LAYOUT, so a night that flattens a wall
  // costs you the night and the repair, not the wall.
  function rebuild(g, hpFrac) {
    const k = (g._keepSave = g._keepSave || load());
    if (!g.crystal || !k.pieces.length) return 0;
    const ox = cellX(g.crystal.x), oy = cellY(g.crystal.y);
    const o = bank(g);
    const have = index(g);
    let n = 0;
    for (const p of k.pieces) {
      const d = RC.BUILDINGS[p[0]];
      if (!d) continue;
      const cx = ox + (p[1] | 0), cy = oy + (p[2] | 0);
      if (have.get(keyOf(cx, cy))) continue;                 // still standing
      const x = centerX(cx), y = centerY(cy);
      if (!g.canPlace(p[0], x, y, o)) continue;
      const b = new RC.Building(p[0], x, y, o, true);
      b.hp = Math.max(1, b.maxHp * (hpFrac == null ? 0.4 : hpFrac));
      g.buildings.push(b);
      n++;
    }
    if (n) {
      g._keepIx = null;
      if (RC.Path && RC.Path.invalidate) RC.Path.invalidate(g);
    }
    return n;
  }

  // ── Placement ──────────────────────────────────────────────────────────────
  //
  // The refusal is a sentence, not a false, for the same reason kids.js already
  // did that: a child tapping a spot that will never work needs to be told which
  // rule they hit, in words they can act on.
  function why(g, t, x, y) {
    const d = RC.BUILDINGS[t];
    if (!d) return 'You cannot build that';
    if (!inRing(g, x, y)) return 'Build closer to the crystal!';
    if (d.keepTower && towerUsed(g) >= towerCap(g)) return 'That is all the towers for now — survive a night for another';
    if (pieceCount(g) >= PIECE_MAX) return 'The keep is as big as it can get!';
    if (!g.canPlace(t, x, y, bank(g))) return 'Something is already there';
    return null;
  }
  const RING = 900;                    // was 620 — a keep needs somewhere to be a keep
  function ring(g) { return RING; }
  function inRing(g, x, y) {
    if (!g.crystal) return false;
    return RC.dist(g.crystal.x, g.crystal.y, x, y) <= RING;
  }

  // Place one piece, at kid prices, owned by the keep. Returns the building or null.
  function place(g, t, x, y) {
    const o = bank(g);
    const race = g.raceOf ? g.raceOf(g.playerOwner || o) : 'forge';
    const it = itemOf(race, t) || itemOf('forge', t);
    if (!it) return null;
    if (!afford(g, it.cost)) return null;
    if (why(g, t, x, y)) return null;
    const d = RC.BUILDINGS[t];
    const rc = d.cost, rt = d.time;
    d.cost = it.cost; d.time = it.time;
    let b = null;
    try { b = g.placeBuilding(t, x, y, o, []); }
    finally { d.cost = rc; d.time = rt; }
    // Decorations are not worth a walk. They go up instantly so that dressing the
    // keep never queues behind the wall that actually has to be finished.
    // `done` is a getter over buildProgress, so the progress is what gets set.
    if (b && d.decor) { b.buildProgress = 1; b.hp = b.maxHp; b.shield = b.maxShield || 0; }
    return b;
  }

  // The whole dragged plan, in one call, so the client sends one command and the
  // server does one loop. Stops at the first cell it cannot afford rather than
  // skipping ahead — a plan that filled in with holes wherever the money ran out
  // would be worse than a short wall.
  function plan(g, t, cells) {
    let n = 0;
    for (const c of (cells || [])) {
      if (!place(g, t, c.x, c.y)) {
        if (!afford(g, (itemOf('forge', t) || { cost: 0 }).cost)) break;
        continue;                     // this cell was blocked; the next may not be
      }
      n++;
    }
    return n;
  }

  // ── Taking it down again ───────────────────────────────────────────────────
  //
  // Building without unbuilding is not building, it is committing. Every child who
  // has made anything out of blocks has put a piece in the wrong place within the
  // first minute, and a castle you can only add to is one where the first mistake is
  // permanent — which is exactly the thing that stops someone building at all.
  //
  // The two halves are deliberately NOT the same action, because they are not the
  // same thing:
  //
  //  · Cancelling something still going up is instant and pays back in full. It is a
  //    hologram; nothing has been built, so there is nothing to take down and nothing
  //    to lose. This is undo, and undo must be free or it does not get used.
  //
  //  · Demolishing something already standing is a JOB. A builder has to walk over
  //    and knock it down, and that takes about as long as putting it up did. That
  //    cost is what makes the wall you already built feel like a real object rather
  //    than a UI element — and it is what stops "move the whole castle two cells
  //    left" from being free. Half the shards come back, so remodelling is affordable
  //    and thoughtless churn is not.
  const DEMO = '__remove';           // the pseudo-type the remove tool arms
  const DEMO_REFUND = 0.5;           // half back for something that actually got built
  const DEMO_GIVEUP = 25;            // seconds before an unreachable job is abandoned

  function priceOf(g, type) {
    const race = (g && g.raceOf) ? g.raceOf(g.playerOwner || bank(g)) : 'forge';
    const it = itemOf(race, type) || itemOf('forge', type);
    return it ? it.cost : ((RC.BUILDINGS[type] || {}).cost || 0);
  }
  function demoTime(g, type) {
    const race = (g && g.raceOf) ? g.raceOf(g.playerOwner || bank(g)) : 'forge';
    const it = itemOf(race, type) || itemOf('forge', type);
    // A log fence comes down faster than a steel wall, for the same reason it went up
    // faster. Deriving it from the build time rather than typing a second number
    // means a price change can never leave the two disagreeing.
    return Math.max(1.5, (it ? it.time : 4) * 0.9);
  }

  // Cancelling an unfinished site. Note the refund is the KID price rather than
  // `def.cost`: game.cancelBuild pays back the Versus number, which for a Rampart is
  // 40 against the 25 that was actually charged — a coin-press, and one that was
  // already reachable through the builder's own give-up path before any of this.
  function cancelSite(g, b) {
    if (!b || b.dead || b.done) return false;
    purse(g).shard += priceOf(g, b.type);
    b.dead = true;
    if (g.selection) g.selection = g.selection.filter(e => e !== b);
    g._keepIx = null;
    if (RC.Path && RC.Path.invalidate) RC.Path.invalidate(g);
    return true;
  }
  function finishDemo(g, b) {
    if (!b || b.dead) return false;
    purse(g).shard += Math.round(priceOf(g, b.type) * DEMO_REFUND);
    b.dead = true;
    if (g.selection) g.selection = g.selection.filter(e => e !== b);
    g._keepIx = null;
    if (RC.Path && RC.Path.invalidate) RC.Path.invalidate(g);
    g.fx.push({ abil: 'nova', ax: b.x, ay: b.y, t: 0.35, radius: 34, owner: b.owner });
    if (RC.Audio) RC.Audio.play('explode');
    return true;
  }

  // One cell of the remove gesture. Returns what happened, so the caller can say it.
  function removeAt(g, x, y) {
    const b = at(g, cellX(x), cellY(y));
    if (!b || b.dead) return null;
    if (!b.done) { return cancelSite(g, b) ? 'cancelled' : null; }
    // Tapping a marked piece again unmarks it — changing your mind has to be as easy
    // as making it up, or the tool is a trap rather than an undo.
    if (b.demo) { b.demo = false; b.demoT = 0; b.demoWait = 0; return 'spared'; }
    b.demo = true; b.demoT = 0; b.demoWait = 0;
    return 'marked';
  }
  function unmarkAll(g) {
    for (const b of (g.buildings || [])) if (b.demo) { b.demo = false; b.demoT = 0; }
  }
  function demoCount(g) {
    let n = 0;
    for (const b of (g.buildings || [])) if (!b.dead && b.demo) n++;
    return n;
  }

  // ── The builders ───────────────────────────────────────────────────────────
  //
  // The rule this replaces was "one building at a time, per player", which existed
  // because a lone builder trudging between five foundations finished none of them.
  // The fix is not to forbid the plan — it is to make builders finish what they
  // start and then walk to the next thing on their own. A child draws the castle;
  // the builders build it. That is the loop the mode was missing.
  // A job is either a piece that is not up yet or a piece that has been marked to
  // come down. Nearest first, and no priority between the two kinds: a builder that
  // preferred one would walk past the thing it is standing next to, which reads as
  // the builder being broken rather than as the builder having an opinion.
  function nextSite(g, u) {
    let best = null, bd = Infinity;
    for (const b of (g.buildings || [])) {
      if (b.dead || !isPiece(b)) continue;
      if (b.done && !b.demo) continue;
      const d = RC.dist(u.x, u.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  const atWork = (u, b) => RC.dist(u.x, u.y, b.x, b.y) <= b.w / 2 + u.r + 16;

  function tickBuilders(g, workers, dt) {
    dt = dt || 0;
    for (const u of workers) {
      if (!u || u.dead) continue;

      // Already putting something up: leave it alone.
      if (u.state === 'build' && u.site && !u.site.dead && !u.site.done) { u.demoJob = null; continue; }

      // Already knocking something down.
      if (u.demoJob && (u.demoJob.dead || !u.demoJob.demo)) u.demoJob = null;
      if (u.demoJob) {
        const b = u.demoJob;
        if (atWork(u, b)) {
          b.demoWait = 0;
          b.demoT = (b.demoT || 0) + dt;
          if (b.demoT >= demoTime(g, b.type)) { finishDemo(g, b); u.demoJob = null; }
        } else {
          // Walk to the EDGE, not the centre: the centre of a finished wall is inside
          // a solid building and inside the nav grid, so a builder aimed at it grinds
          // against the thing it came to demolish.
          b.demoWait = (b.demoWait || 0) + dt;
          if (b.demoWait > DEMO_GIVEUP) {
            b.demo = false; b.demoT = 0; u.demoJob = null;
            if (g.notify) g.notify('Cannot get to that one to take it down');
          } else if (u.state !== 'move') {
            const dx = u.x - b.x, dy = u.y - b.y;
            const len = Math.max(1, Math.hypot(dx, dy));
            const off = b.w / 2 + u.r + 6;
            u.moveTo(b.x + dx / len * off, b.y + dy / len * off);
          }
        }
        continue;
      }

      const s = nextSite(g, u);
      if (!s) continue;
      if (!s.done) u.buildAt(s);
      else { u.demoJob = s; u.state = 'idle'; }      // picked up on the next tick
    }
  }

  return {
    GRID: GRID, RING: RING, PIECE_MAX: PIECE_MAX,
    snap: snap, cellOf: cellOf, keyOf: keyOf, line: line,
    centerX: centerX, centerY: centerY, cellX: cellX, cellY: cellY,
    isPiece: isPiece, joins: joins, index: index, at: at, joinMask: joinMask,
    bank: bank, purse: purse, shards: shards, afford: afford,
    MENU: MENU, menuFor: menuFor, itemOf: itemOf,
    towerCap: towerCap, towerUsed: towerUsed, pieceCount: pieceCount,
    gateOpen: gateOpen, syncGates: syncGates, toggleGate: toggleGate,
    phase: phase, isBuildDay: isBuildDay, nightAmt: nightAmt,
    load: load, store: store, blank: blank, rename: rename,
    capture: capture, restore: restore, rebuild: rebuild,
    why: why, ring: ring, inRing: inRing, place: place, plan: plan,
    enclosure: enclosure, isSealed: isSealed, sealRadius: sealRadius, solidSet: solidSet,
    nextSite: nextSite, tickBuilders: tickBuilders,
    DEMO: DEMO, DEMO_REFUND: DEMO_REFUND,
    priceOf: priceOf, demoTime: demoTime, removeAt: removeAt, unmarkAll: unmarkAll,
    demoCount: demoCount, cancelSite: cancelSite, finishDemo: finishDemo,
  };
})();
