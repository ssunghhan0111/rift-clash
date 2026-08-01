// The Keep — building a castle together
// ---------------------------------------------------------------------------
// Crystal Defense used to be a tower-defence game that happened to contain walls.
// The rework turns it into a building game that happens to contain a siege, and
// this suite is organised around the five promises that rework makes — because
// each of them is a rule a later change could quietly undo without breaking
// anything visible until a child notices their castle is gone.
//
//   1. A GRID, AND ONE LINE — every piece snaps to a cell, a drag lays a straight
//      row, and neighbouring pieces are allowed to touch. The load-bearing
//      assertion is that two adjacent cells are BOTH placeable: canPlace's 8px
//      breathing room is exactly what would stop a wall from being a wall.
//   2. ONE KEEP, ONE PILE — the crystal and every piece belong to one seat, both
//      players spend the same shards, and either builder can work any piece.
//   3. YOU DRAW, THEY BUILD — a plan goes down in one command and builders walk
//      it unprompted. Includes the deadlock that made this possible at all: an
//      unfinished piece must not block the path to itself.
//   4. BUILD DAY IS UNTIMED — it ends on a unanimous Ready, not on a clock, and
//      the gates shut only once the phase has actually changed.
//   5. NOTHING BUILT IS EVER LOST — the crystal cracks instead of ending the run,
//      the layout is saved, and it comes back next session.
//
// Runs headless against the real RC.Game with a mocked localStorage, the same way
// roster_test and profile_test do.
global.window = global;

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
['config', 'maps', 'weather', 'pathfind', 'entities', 'game', 'ai', 'daily', 'keep', 'survival', 'kids', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const head = s => console.log('\n' + s);
const clearStore = () => { for (const k of Object.keys(store)) delete store[k]; };

function run(opts) {
  const g = new RC.Game();
  g.setupKids(opts || { race: 'forge' });
  return g;
}
// Lay a row the way a dragged gesture does — one command, a list of cells.
function drag(g, type, ax, ay, bx, by, owner) {
  const cells = RC.Keep.line(ax, ay, bx, by);
  RC.Kids.build(g, type, cells[0].x, cells[0].y, owner == null ? g.playerOwner : owner, cells);
  return cells;
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 1 · a grid, and one line ===');
{
  clearStore();
  const G = RC.Keep.GRID;
  const s = RC.Keep.snap(1234.7, 987.2);
  ok(s.x % G === G / 2 && s.y % G === G / 2, 'snap lands on a cell centre');
  ok(RC.Keep.snap(s.x, s.y).x === s.x, 'and snapping an already-snapped point is a no-op');

  // Axis lock. A free diagonal drag makes a staircase, which is neither a line nor
  // anything a child meant to draw.
  const h = RC.Keep.line(1000, 1000, 1000 + G * 5 + 9, 1000 + 20);
  ok(h.length >= 6 && h.every(c => c.y === h[0].y), 'a mostly-horizontal drag is one straight row');
  const v = RC.Keep.line(1000, 1000, 1000 + 15, 1000 + G * 3);
  ok(v.length >= 4 && v.every(c => c.x === v[0].x), 'a mostly-vertical drag is one straight column');
  ok(RC.Keep.line(500, 500, 500, 500).length === 1, 'and a tap is simply a plan one cell long');

  // The whole grid rests on this: 56 must clear canPlace for every pairing of piece
  // sizes, or the pieces cannot sit in adjacent cells at all.
  const g = run();
  const c = g.crystal;
  const a = RC.Keep.snap(c.x - 300, c.y - 200);
  ok(g.canPlace('rampart', a.x, a.y, 1), 'a wall fits on an empty cell');
  RC.Kids.build(g, 'rampart', a.x, a.y, g.playerOwner, [a]);
  ok(g.canPlace('rampart', a.x + G, a.y, 1), 'and the very next cell is STILL placeable — walls may touch');
  ok(g.canPlace('stonethrower', a.x + G, a.y, 1), 'a tower fits beside a wall too');
  ok(!g.canPlace('rampart', a.x + 8, a.y, 1), 'but an overlapping spot is refused');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 2 · one keep, one pile of shards ===');
{
  clearStore();
  const g = run({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'gloop' }] });
  const bank = RC.Keep.bank(g);
  ok(bank === 1, 'the pile is held by the lowest-numbered defender');
  ok(g.crystal.owner === bank, 'the crystal belongs to the keep, not to "player one"');
  ok(RC.Keep.shards(g) === RC.Kids.CFG.START_SHARD,
     'the starting shards land in the pile once, not once per player (' + RC.Keep.shards(g) + ')');

  // Player 3 builds; player 1's pile pays and the keep owns the result.
  const before = RC.Keep.shards(g);
  const cells = drag(g, 'logwall', g.crystal.x - 300, g.crystal.y - 250,
                     g.crystal.x - 300 + RC.Keep.GRID * 3, g.crystal.y - 250, 3);
  const walls = g.buildings.filter(b => b.type === 'logwall' && !b.dead);
  ok(walls.length === cells.length, 'a drag by player three laid all ' + cells.length + ' pieces');
  ok(walls.every(b => b.owner === bank), 'and every one belongs to the keep, not to the builder');
  ok(before - RC.Keep.shards(g) === cells.length * 12, 'paid for out of the one shared pile');
  ok(walls.every(b => Math.abs(b.y - walls[0].y) < 0.001), 'in one straight line');

  // Both builders can work it, and both can repair it — the mender aura is what a
  // second player's builder uses to fix a wall the first player placed.
  const crew = [].concat(RC.Kids.workersOf(g, 1), RC.Kids.workersOf(g, 3));
  ok(crew.length >= 2, 'both players have builders (' + crew.length + ')');
  RC.Keep.tickBuilders(g, crew);
  ok(crew.every(w => w.state === 'build' && w.site && w.site.owner === bank),
     'and all of them accept work on the shared keep');

  // Only towers are capped. The old cap counted everything and stopped at fourteen.
  ok(RC.Kids.buildCap(g) === RC.Keep.towerCap(g), 'the cap is a TOWER cap now');
  ok(RC.Keep.PIECE_MAX > 100, 'and the keep itself may grow to ' + RC.Keep.PIECE_MAX + ' pieces');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 3 · you draw, the builders build ===');
{
  clearStore();
  const g = run();
  const cells = drag(g, 'logwall', g.crystal.x - 320, g.crystal.y - 220,
                     g.crystal.x - 320 + RC.Keep.GRID * 5, g.crystal.y - 220);
  ok(g.buildings.filter(b => b.type === 'logwall' && !b.dead).length === cells.length,
     'the whole plan goes down at once, in one command');

  // THE deadlock this feature could not exist without: a planned wall enters the
  // world as a site, the site used to block the nav grid, and the grid blocked the
  // only cells a builder could reach it from. One piece at a time hid it; a row
  // cannot be squeezed past. A foundation is not a wall yet.
  RC.Path.invalidate(g);
  const nav = RC.Path.ensure(g);
  const cell = c => nav.blocked[Math.floor(c.y / nav.tile) * nav.cols + Math.floor(c.x / nav.tile)];
  ok(!cell(cells[2]), 'an UNFINISHED piece does not block the path to itself');
  const site = g.buildings.find(b => b.type === 'logwall' && !b.dead);
  site.buildProgress = 1; site.hp = site.maxHp;
  RC.Path.invalidate(g);
  const nav2 = RC.Path.ensure(g);
  ok(nav2.blocked[Math.floor(cells[0].y / nav2.tile) * nav2.cols + Math.floor(cells[0].x / nav2.tile)],
     'and starts blocking the moment it is finished');

  // The chain: finish what you are on, then walk to the next thing unprompted.
  const w = RC.Kids.workersOf(g, 1)[0];
  RC.Keep.tickBuilders(g, [w]);
  const first = w.site;
  ok(!!first, 'a builder took a piece without being ordered to');
  first.buildProgress = 1;
  RC.Keep.tickBuilders(g, [w]);
  ok(w.site && w.site !== first, 'and moved to the next one the moment it was done');
  ok(RC.Kids.CFG.BUILDERS >= 2, 'there is a crew, not a lone builder');

  // Decorations skip the queue entirely — dressing the keep should never wait
  // behind the wall that actually has to be up before dark.
  const d = RC.Keep.snap(g.crystal.x + 200, g.crystal.y + 200);
  RC.Kids.build(g, 'banner', d.x, d.y, 1, [d]);
  const ban = g.buildings.find(b => b.type === 'banner' && !b.dead);
  ok(ban && ban.done, 'a banner goes up instantly');
  ok(RC.Keep.joinMask(g, ban) === 0, 'and never joins itself into the wall line');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 4 · Build Day is untimed, and ends on Ready ===');
{
  clearStore();
  const g = run({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'forge' }] });
  ok(RC.Kids.st(g).phase === 'build', 'a run opens on Build Day, not on a countdown');
  ok(RC.Kids.CFG.DAY_MAX >= 120, 'whose backstop is minutes, not seconds (' + RC.Kids.CFG.DAY_MAX + 's)');

  for (let i = 0; i < 200; i++) g.update(0.1);        // twenty seconds of doing nothing
  ok(RC.Kids.st(g).phase === 'build', 'twenty seconds pass and it is still Build Day');
  ok(RC.Kids.st(g).wave === 0, 'nothing has attacked');

  RC.Kids.setReady(g, 1, true);
  ok(!RC.Kids.allReady(g), 'one of two players ready is not enough — the vote is unanimous');
  for (let i = 0; i < 30; i++) g.update(0.1);
  ok(RC.Kids.st(g).phase === 'build', 'so the night does not start');
  RC.Kids.setReady(g, 3, true);
  ok(RC.Kids.allReady(g), 'both ready');
  for (let i = 0; i < 30; i++) g.update(0.1);
  ok(RC.Kids.st(g).phase !== 'build', 'and night falls (' + RC.Kids.st(g).phase + ')');
  ok(RC.Keep.nightAmt(g) > 0.9, 'the world goes dark, which is how a child knows to stop building');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 4b · the gate ===');
{
  clearStore();
  const g = run();
  const p = RC.Keep.snap(g.crystal.x - 250, g.crystal.y + 180);
  RC.Kids.build(g, 'keepgate', p.x, p.y, 1, [p]);
  const gate = g.buildings.find(b => b.type === 'keepgate' && !b.dead);
  ok(!!gate, 'a gate can be built');
  gate.buildProgress = 1; gate.hp = gate.maxHp;
  RC.Keep.syncGates(g);
  ok(RC.Keep.gateOpen(g, gate) && gate.passable, 'it stands open on Build Day and is out of the nav grid');

  RC.Kids.setReady(g, 1, true);
  for (let i = 0; i < 140; i++) g.update(0.1);   // past DAY_MIN, then the night
  // Ordering, and it was wrong once: the gate reads the phase to decide whether it
  // is open, and startWave is what moves the phase. Shutting the gates before that
  // left them standing open into the first tick of the raid — a hole in the wall
  // exactly where the wall has a door.
  ok(!RC.Keep.gateOpen(g, gate), 'night falls and it shuts');
  ok(gate.passable === false, 'back into the nav grid, so the raid has to break it');

  RC.Keep.toggleGate(g, gate);
  ok(RC.Keep.gateOpen(g, gate), 'and a player can open it by hand whenever they like');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 5 · nothing you built is ever lost ===');
{
  clearStore();
  const g = run();
  drag(g, 'rampart', g.crystal.x - 280, g.crystal.y - 200,
       g.crystal.x - 280 + RC.Keep.GRID * 5, g.crystal.y - 200);
  g.buildings.forEach(b => { if (RC.Keep.isPiece(b)) { b.buildProgress = 1; b.hp = b.maxHp; } });
  const built = RC.Keep.pieceCount(g);

  // The crystal does not die. A child who loses an hour of building to one bad
  // night does not build again, so a lost night costs the night and the repair.
  g.crystal.hp = 0; g.crystal.dead = true;
  g.update(0.1);
  ok(!g.over, 'the run does not end when the crystal falls');
  ok(!g.crystal.dead && g.crystal.hp > 0, 'the crystal cracked and came back at ' +
     Math.round(100 * g.crystal.hp / g.crystal.maxHp) + '%');
  ok(RC.Kids.st(g).phase === 'build', 'and handed back a Build Day');
  ok(RC.Keep.pieceCount(g) === built, 'with the keep entirely intact (' + built + ' pieces)');

  // Knocked-down pieces come back from the save, damaged rather than deleted.
  const victim = g.buildings.find(b => b.type === 'rampart' && !b.dead);
  RC.Keep.capture(g);
  victim.dead = true;
  g._keepIx = null;
  ok(RC.Keep.pieceCount(g) === built - 1, 'a wall is knocked down');
  const back = RC.Keep.rebuild(g, 0.4);
  ok(back === 1, 'and put back from the save');
  ok(RC.Keep.pieceCount(g) === built, 'so the layout survives the night that broke it');

  // Across sessions.
  const saved = RC.Keep.capture(g);
  ok(saved.pieces.length === built, 'capture wrote ' + saved.pieces.length + ' pieces');
  ok(saved.pieces[0].length === 3, 'as [type, cellX, cellY] relative to the crystal');
  ok(saved.pieces.every(p => Math.abs(p[1]) < 100 && Math.abs(p[2]) < 100),
     'relative, not absolute — so the keep survives the map moving under it');

  const g2 = run({ race: 'aether' });                 // a different faction entirely
  ok(RC.Keep.pieceCount(g2) === built, 'a new session restored all ' + built + ' pieces');
  ok(g2.buildings.filter(b => RC.Keep.isPiece(b)).every(b => b.done),
     'finished and paid for, not as foundations to rebuild');
  ok(g2.buildings.filter(b => RC.Keep.isPiece(b)).every(b => b.owner === RC.Keep.bank(g2)),
     'and still belonging to the keep');

  RC.Keep.rename('Fort Jayden');
  ok(RC.Keep.load().name === 'Fort Jayden', 'the keep has a name you choose');
  ok(RC.Keep.load().pieces.length === built, 'and renaming it does not disturb the castle');
}

// ═══════════════════════════════════════════════════════════════════════════
head('=== 6 · Versus is untouched ===');
{
  // Every wall def carries `snap`, which is exactly the kind of flag that leaks. It
  // must not put Versus on a grid, must not relax Versus placement spacing, and
  // must not route Versus builds through the Crystal-Defense-only command.
  clearStore();
  const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g.setup(RC.MAPS[0], RC.MODES['1v1'], { 1: 'forge', 2: 'gloop' });
  ok(!g.kids, 'a Versus match is not a keep');
  const core = g.buildings.find(b => b.def.isCore && b.owner === 1);
  // Find open ground rather than assuming it — the Versus maps have rocks.
  let x = 0, y = 0;
  for (let d = 200; d <= 420 && !x; d += 20) {
    for (const s of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1]]) {
      const px = core.x + s[0] * d, py = core.y + s[1] * d;
      if (g.canPlace('rampart', px, py, 1) && g.canPlace('rampart', px + 52, py, 1)) { x = px; y = py; break; }
    }
  }
  ok(!!x, 'a rampart places in Versus');
  const b1 = new RC.Building('rampart', x, y, 1, true);
  g.buildings.push(b1);
  ok(!g.canPlace('rampart', x + 44, y, 1),
     'and Versus keeps its 8px spacing — two walls 44 apart are still refused');
  ok(g.canPlace('rampart', x + 52, y, 1), 'while 52 apart is fine, exactly as before');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
