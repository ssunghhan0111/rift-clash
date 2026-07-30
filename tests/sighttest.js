// Per-unit sight + auto-engagement. Drives the REAL modules, no reimplementation.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function arena() {
  const g = new RC.Game();
  g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = [];
  g.over = null;
  return g;
}
function put(g, type, x, y, owner) {
  const u = new RC.Unit(type, x, y, owner);
  if (g.initUnit) g.initUnit(u);
  g.units.push(u);
  return u;
}
const tick = (g, u, dt) => u.update(dt == null ? 1 / 30 : dt, g);

// ── 1. every unit has its own sight, and they genuinely differ ─────────────
console.log('=== per-unit sight ===');
{
  const keys = Object.keys(RC.UNITS);
  const vals = keys.map(k => RC.UNITS[k].sight);
  ok(vals.every(v => typeof v === 'number' && v > 0), 'some unit is missing a sight value');
  ok(new Set(vals).size >= 12, 'sight is barely differentiated (' + new Set(vals).size + ' distinct values)');
  console.log('  ' + new Set(vals).size + ' distinct sight values across ' + keys.length + ' units, ' +
              Math.min(...vals) + '–' + Math.max(...vals));

  // a unit must always be able to acquire anything it could shoot, or it will
  // stand there being outranged by something inside its own weapon range
  const g = arena();
  for (const k of keys) {
    const u = put(g, k, 500, 500, 1);
    ok(u.acquireRange(g) >= u.effRange(g), k + ': acquire (' + Math.round(u.acquireRange(g)) + ') < weapon range (' + Math.round(u.effRange(g)) + ')');
    // There used to be a second pass here for Focus Fire / Anchor Field, the two abilities
    // that temporarily extended a unit's range. Nothing extends range any more — unit
    // abilities are all passives — so a unit's reach is a constant and one pass covers it.
  }
  console.log('  every unit can acquire at least as far as it can shoot ✓');
}

// ── 2. sight drives acquisition: a far-seeing unit bites first ─────────────
console.log('\n=== acquisition uses the unit\'s OWN sight ===');
{
  const cases = [['hover', 'globling'], ['lancer', 'bloat'], ['oracle', 'wrench']];
  for (const [far, near] of cases) {
    const gapDist = (RC.UNITS[far].sight + RC.UNITS[near].sight) / 2;   // between the two sights
    const g1 = arena(), g2 = arena();
    const a = put(g1, far, 500, 500, 1); put(g1, 'volt', 500, 500 + gapDist, 2);
    const b = put(g2, near, 500, 500, 1); put(g2, 'volt', 500, 500 + gapDist, 2);
    tick(g1, a); tick(g2, b);
    ok(a.state === 'attack', far + ' (sight ' + RC.UNITS[far].sight + ') did not engage at ' + Math.round(gapDist) + 'px');
    ok(b.state !== 'attack', near + ' (sight ' + RC.UNITS[near].sight + ') engaged at ' + Math.round(gapDist) + 'px — beyond its sight');
    console.log('  at ' + Math.round(gapDist) + 'px: ' + far + ' engages, ' + near + ' does not ✓');
  }
}

// ── 3. no user command needed — an idle unit opens fire by itself ──────────
console.log('\n=== auto-engage with no order given ===');
{
  const g = arena();
  const me = put(g, 'volt', 500, 500, 1);
  const foe = put(g, 'globling', 500, 560, 2);
  const hp0 = foe.hp;
  ok(me.state === 'idle', 'unit did not start idle');
  for (let i = 0; i < 60; i++) { tick(g, me); tick(g, foe); }
  ok(me.state === 'attack', 'idle unit never engaged an enemy in its sight');
  ok(foe.hp < hp0, 'idle unit engaged but never actually dealt damage');
  console.log('  Volt Trooper opened fire unprompted: ' + Math.round(hp0 - foe.hp) + ' damage ✓');
}

// ── 4. high ground sees further, so it bites first ────────────────────────
console.log('\n=== terrain modifies sight, and therefore reach ===');
{
  const g = arena();
  const flat = put(g, 'volt', 500, 500, 1);
  const base = flat.effSight(g);
  g.terrainAt = () => ({ high: true });
  flat._terr = null;
  const high = flat.effSight(g);
  ok(high > base, 'high ground did not extend sight (' + base + ' → ' + high + ')');
  ok(Math.abs(high / base - RC.CFG.TERRAIN.high.sight) < 0.01, 'high-ground sight multiplier is wrong');
  g.terrainAt = () => ({ low: true });
  flat._terr = null;
  ok(flat.effSight(g) < base, 'low ground did not shorten sight');
  console.log('  flat ' + Math.round(base) + ' → high ' + Math.round(high) + ' → low ' + Math.round(flat.effSight(g)) + ' ✓');
}

// ── 5. the leash: a self-started chase gives up and goes home ─────────────
console.log('\n=== leash on self-started fights ===');
{
  const g = arena();
  const me = put(g, 'volt', 1200, 1200, 1);
  const bait = put(g, 'hover', 1200, 1200 + me.effSight(g) - 20, 2);
  bait.maxHp = bait.hp = 99999;
  tick(g, me);
  ok(me.state === 'attack' && me.auto === true, 'unit did not self-engage');
  ok(!!me.post, 'no post recorded for a self-started fight');
  const post = { x: me.post.x, y: me.post.y };
  const leash = me.leashRange(g);

  let gaveUp = false, maxStray = 0;
  for (let i = 0; i < 900; i++) {
    bait.y += 6;                      // the bait keeps running
    tick(g, me);
    maxStray = Math.max(maxStray, D(me, post));
    if (me.state === 'move' && !me.auto) { gaveUp = true; break; }
  }
  ok(gaveUp, 'unit chased forever — the leash never fired');
  ok(maxStray < leash * 1.35, 'unit strayed ' + Math.round(maxStray) + 'px, well past its ' + Math.round(leash) + 'px leash');
  console.log('  gave up after straying ' + Math.round(maxStray) + 'px (leash ' + Math.round(leash) + 'px) and headed home ✓');

  // and it does head home, not somewhere random
  ok(me.target && D(me.target, post) < 2, 'unit did not head back to its post');
  for (let i = 0; i < 3000 && D(me, post) > 12; i++) tick(g, me);
  ok(D(me, post) < 40, 'unit never made it home (' + Math.round(D(me, post)) + 'px away)');
  console.log('  returned to its post ✓');
}

// ── 6. a PLAYER-ordered attack is never leashed ───────────────────────────
console.log('\n=== player orders are not leashed ===');
{
  const g = arena();
  const me = put(g, 'volt', 1200, 1200, 1);
  const bait = put(g, 'hover', 1250, 1250, 2);
  bait.maxHp = bait.hp = 99999;
  RC.Net.applyCommand(g, 1, { t: 'attack', ids: [me.id], tid: bait.id });
  ok(me.state === 'attack' && me.auto === false, 'a commanded attack was marked as self-started');
  const start = { x: me.x, y: me.y };
  for (let i = 0; i < 900; i++) { bait.y += 6; tick(g, me); }
  ok(me.state === 'attack', 'a commanded attack was abandoned');
  ok(D(me, start) > me.leashRange(g), 'a commanded chase stopped short as if leashed');
  console.log('  chased ' + Math.round(D(me, start)) + 'px on a direct order, no leash ✓');
}

// ── 7. workers defend themselves when idle, but never abandon their job ───
console.log('\n=== workers ===');
{
  const g = arena();
  const w = put(g, 'wrench', 500, 500, 1);
  put(g, 'globling', 500, 560, 2);
  for (let i = 0; i < 10; i++) tick(g, w);
  ok(w.state === 'attack', 'an idle worker just stood there while an enemy walked up');
  console.log('  idle worker fights back ✓');

  // a worker that is actually working keeps working (needs a real drop-off, or it
  // finishes a haul, finds nowhere to put it, and legitimately goes idle)
  const g2 = arena();
  const core = new RC.Building('core', 1000, 1000, 1, true);
  g2.buildings.push(core);
  const node = new RC.ShardNode(1200, 1000); g2.nodes.push(node);
  const w2 = put(g2, 'wrench', 1190, 1000, 1);
  w2.gatherFrom(node);
  const pest = put(g2, 'globling', 1215, 1015, 2);
  pest.maxHp = pest.hp = 99999;
  const states = new Set();
  for (let i = 0; i < 30 * 30; i++) { tick(g2, w2); g2.separate(); states.add(w2.state); }
  ok(!states.has('attack'), 'a gathering worker abandoned the mineral line to fight');
  ok(w2.carry > 0 || g2.res[1].shard > 0 || states.has('toDrop'), 'the worker never actually mined');
  console.log('  gathering worker keeps mining through 30s of harassment (states seen: ' +
              [...states].join('/') + ') ✓');

  // transports never fight, ever
  const g3 = arena();
  const ship = put(g3, 'dropship', 500, 500, 1);
  put(g3, 'volt', 500, 540, 2);
  for (let i = 0; i < 30; i++) tick(g3, ship);
  ok(ship.state !== 'attack', 'a Dropship tried to fight');
  console.log('  Dropship stays out of it ✓');
}

// ── 8. return fire while moving, without losing the move order ────────────
console.log('\n=== return fire while retreating ===');
{
  const g = arena();
  const me = put(g, 'volt', 1200, 1200, 1);
  const foe = put(g, 'globling', 1200, 1240, 2);
  foe.maxHp = foe.hp = 9999;
  const goal = { x: 1200, y: 400 };
  me.moveTo(goal.x, goal.y);
  const hp0 = foe.hp;
  const y0 = me.y;
  for (let i = 0; i < 40; i++) tick(g, me);
  ok(me.state === 'move', 'a retreating unit turned around to fight (state ' + me.state + ')');
  ok(me.y < y0 - 20, 'a retreating unit stopped moving');
  ok(foe.hp < hp0, 'a retreating unit never returned fire');
  console.log('  kept retreating ' + Math.round(y0 - me.y) + 'px AND dealt ' + Math.round(hp0 - foe.hp) + ' damage on the way ✓');

  // retreat is still possible — the unit does not get dragged into a fight
  ok(me.foe == null, 'return fire wrongly latched the unit onto a target');
  console.log('  retreat still works — no target latched ✓');
}

// ── 9. attack-move still engages and still resumes ────────────────────────
console.log('\n=== attack-move ===');
{
  const g = arena();
  const me = put(g, 'volt', 1200, 1600, 1);
  const foe = put(g, 'globling', 1200, 1500, 2);
  me.attackMoveTo(1200, 900);
  for (let i = 0; i < 20; i++) { tick(g, me); tick(g, foe); }
  ok(me.state === 'attack', 'attack-move did not engage an enemy on the way');
  ok(me.auto === true && !!me.post, 'attack-move engagement was not treated as self-started');
  for (let i = 0; i < 900 && !foe.dead; i++) { tick(g, me); tick(g, foe); }
  ok(foe.dead, 'attack-move never finished the kill');
  for (let i = 0; i < 30; i++) tick(g, me);
  ok(me.state === 'move' && me.attackMove, 'attack-move did not resume after the kill');
  ok(me.amoveGoal && me.amoveGoal.y === 900, 'attack-move lost its destination');
  console.log('  engaged, killed, resumed the march ✓');
}

// ── 10. stop / move / gather all clear the auto-engagement bookkeeping ────
console.log('\n=== order bookkeeping ===');
{
  const g = arena();
  const me = put(g, 'volt', 500, 500, 1);
  put(g, 'globling', 500, 560, 2);
  tick(g, me);
  ok(me.auto && me.post, 'setup: expected a self-started fight');
  me.stop();
  ok(!me.auto && !me.post, 'stop() left stale auto-engagement state');
  tick(g, me);
  me.moveTo(100, 100);
  ok(!me.auto && !me.post, 'moveTo() left stale auto-engagement state');
}

// ── 11. fog of war still runs off the same numbers ────────────────────────
console.log('\n=== fog uses the same per-unit sight ===');
{
  const g = new RC.Game();
  const u = g.units.find(x => x.owner === g.playerOwner) || g.units[0];
  if (u) {
    ok(Math.abs(g._sightOf(u) - u.effSight(g)) < 0.01,
       'fog sight (' + Math.round(g._sightOf(u)) + ') and combat sight (' + Math.round(u.effSight(g)) + ') disagree');
    console.log('  fog and acquisition read the same value (' + Math.round(g._sightOf(u)) + ') ✓');
  }
  ok(g._baseSight({ kind: 'building', def: RC.BUILDINGS.core }) === RC.CFG.SIGHT_CORE, 'building sight fallback broke');
  ok(g._baseSight({ kind: 'building', def: RC.BUILDINGS.stonethrower }) === RC.BUILDINGS.stonethrower.range + RC.CFG.SIGHT_TOWER_PAD, 'tower sight fallback broke');
}

// ── 12. a real match runs, and units fight without being told to ──────────
console.log('\n=== live 1v1 match, no orders issued ===');
{
  const g = new RC.Game();
  g.players.forEach(p => { p.ai = true; });
  let steps = 0, kills = 0;
  const before = g.units.length;
  for (let i = 0; i < 30 * 240 && !g.over; i++) { g.update(1 / 30); steps++; }
  console.log('  simulated ' + Math.round(steps / 30) + 's, ' + before + ' → ' + g.units.length + ' units, over=' + g.over);
  ok(steps > 100, 'the match crashed almost immediately');
  ok(g.units.length > 0, 'every unit vanished');
}

// ── 13. melee units can actually reach a building (pre-existing deadlock) ─
console.log('\n=== melee vs buildings ===');
{
  for (const [ut, bt] of [['globling', 'crystal'], ['bloat', 'core'], ['ardent', 'core'], ['warden', 'crystal'], ['shielder', 'factory']]) {
    const g = arena();
    const b = new RC.Building(bt, 1700, 800, 2, true);
    g.buildings.push(b);
    const u = put(g, ut, 1400, 800, 1);
    u.attackTarget(b);
    const hp0 = b.hp;
    for (let i = 0; i < 30 * 25 && b.hp >= hp0; i++) { tick(g, u); g.separate(); }
    ok(b.hp < hp0, ut + ' still cannot damage a ' + bt);
  }
  console.log('  every melee unit can now connect with cores, crystals and factories ✓');
}

// ── 14. survival: the melee horde can finally threaten the crystal ────────
console.log('\n=== survival ===');
{
  // left completely alone, the run must be losable — wave 1 is all Globlings, and
  // before the reach fix they stood next to the crystal forever without scratching it
  const g = new RC.Game();
  g.setupSurvival({ difficulty: 'medium', race: 'forge', ally: true });
  for (let i = 0; i < 30 * 400 && !g.over; i++) g.update(1 / 30);
  ok(g.crystal.hp < g.crystal.maxHp, 'the all-melee first wave never damaged the Rift Crystal');
  console.log('  unattended run: crystal ' + Math.round(g.crystal.hp) + '/' + g.crystal.maxHp + ', outcome ' + g.over + ' ✓');

  // defended, the waves progress
  const d = new RC.Game();
  d.setupSurvival({ difficulty: 'medium', race: 'forge', ally: true });
  for (let i = 0; i < 30 * 400 && !d.over; i++) {
    d.update(1 / 30);
    if (i % 60 === 0) {   // keep the army parked on the crystal, as a player would
      for (const u of d.units) {
        if (u.owner === 2 || u.dead || u.def.worker || !u.canFight()) continue;
        if (u.state === 'idle' && Math.hypot(u.x - d.crystal.x, u.y - d.crystal.y) > 260) {
          u.attackMoveTo(d.crystal.x - 150, d.crystal.y);
        }
      }
    }
  }
  console.log('  defended run: reached wave ' + d.survivalWave + ', crystal ' +
              Math.round(d.crystal.hp) + '/' + d.crystal.maxHp + ', outcome ' + (d.over || 'still going') + ' ✓');
  ok(d.survivalWave >= 3, 'a defended survival run did not get past wave 2 (got ' + d.survivalWave + ')');
}

// ── 15. the survival ally actually defends the crystal ────────────────────
// The horde has no base. The normal AI attack wave looks for the nearest enemy
// core, finds none, sends the army to its OWN core and leaves it there — so an
// ally used to stand in its base while the Rift Crystal was eaten. Roughly one
// run in twenty died on wave 1 to two Globlings with a live ally on the field.
console.log('\n=== the survival ally defends ===');
{
  const g = new RC.Game();
  g.setupSurvival({ difficulty: 'medium', race: 'forge', ally: true });
  for (let i = 0; i < 30 * 40; i++) g.update(1 / 30);          // let the ally open its build

  // park an ally fighter far from the crystal and drop a Globling on the crystal
  const c = g.crystal;
  const far = new RC.Unit('volt', c.x - 700, c.y - 300, 3);
  if (g.initUnit) g.initUnit(far);
  g.units.push(far);
  far.stop();
  const gob = new RC.Unit('globling', c.x - 70, c.y, 2);
  if (g.initUnit) g.initUnit(gob);
  g.units.push(gob);
  gob.attackTarget(c);

  const d0 = Math.hypot(far.x - c.x, far.y - c.y);
  RC.AI.update(2.0, g);                                        // one AI think
  ok(far.state !== 'idle', 'the ally fighter ignored a Globling chewing the crystal');
  for (let i = 0; i < 30 * 25 && !gob.dead; i++) g.update(1 / 30);
  const d1 = Math.hypot(far.x - c.x, far.y - c.y);
  ok(d1 < d0 - 200, 'the ally never closed on the crystal (' + Math.round(d0) + 'px → ' + Math.round(d1) + 'px)');
  console.log('  ally answered the alarm: ' + Math.round(d0) + 'px → ' + Math.round(d1) + 'px from the crystal, ' +
              (gob.dead ? 'Globling killed' : 'Globling still up') + ' ✓');
  ok(gob.dead, 'the ally reached the crystal but never killed the Globling on it');

  // ...and with nothing to fight it garrisons the crystal rather than wandering home
  for (let i = 0; i < 30 * 30; i++) g.update(1 / 30);
  const guard = g.units.filter(u => u.owner === 3 && !u.dead && !u.def.worker && u.canFight());
  const near = guard.filter(u => Math.hypot(u.x - c.x, u.y - c.y) < 420).length;
  ok(guard.length === 0 || near >= Math.ceil(guard.length / 2),
     'between waves only ' + near + '/' + guard.length + ' allied fighters hold the crystal');
  console.log('  between waves ' + near + '/' + guard.length + ' allied fighters hold the crystal ✓');
}

// ── 14. netcode is unaffected (auto/post are server-side only) ────────────
console.log('\n=== netcode round-trip ===');
{
  const g = new RC.Game();
  for (let i = 0; i < 300; i++) g.update(1 / 30);
  const snap = RC.Net.serialize(g);
  const c = new RC.Game();
  RC.Net.applySnapshot(c, snap);
  ok(c.units.length === g.units.length, 'snapshot lost units (' + g.units.length + ' → ' + c.units.length + ')');
  ok(JSON.stringify(snap).indexOf('"post"') < 0, 'leash bookkeeping leaked into the wire format');
  console.log('  ' + c.units.length + ' units reconciled, wire format unchanged ✓');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
