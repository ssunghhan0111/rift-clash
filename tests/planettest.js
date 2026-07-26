// New planets + weather, driven through the REAL modules.
// Map integrity (spawn clearance, reachability, resources), biome coverage, and
// the weather system's determinism and its actual effect on sight.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const NEW = ['mars', 'jupiter', 'saturn'];
const ALL = RC.MAPS.map(m => m.id);

function inPoly(x, y, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ── 1. the three new maps exist and are wired everywhere ──────────────────
console.log('=== new planets ===');
{
  ok(RC.MAPS.length === 6, 'expected 6 maps, got ' + RC.MAPS.length);
  for (const id of NEW) {
    const m = RC.getMap(id);
    ok(m && m.id === id, id + ' is missing from RC.MAPS');
    ok(!!m.name && !!m.desc, id + ' has no name/description');
    ok(m.spawns.length >= 4, id + ' has fewer than 4 spawns (2v2 needs 4), has ' + m.spawns.length);
    ok(!!RC.CFG.BIOMES[m.biome], id + ' uses biome "' + m.biome + '" with no terrain names');
    // every terrain type on the map must have a name in this biome
    const kinds = new Set((m.zones || []).map(z => z.t));
    for (const k of kinds) ok(!!RC.CFG.BIOMES[m.biome][k], m.biome + ' has no name for terrain "' + k + '"');
    ok(kinds.size === 5, id + ' should use all five terrain types, uses ' + [...kinds].join(','));
    console.log('  ' + m.name.padEnd(8) + ' biome=' + m.biome.padEnd(6) + ' ' + m.world.w + '×' + m.world.h +
                '  zones=' + m.zones.length + '  obstacles=' + m.obstacles.length +
                '  terrain=[' + [...kinds].join(' ') + ']');
  }
}

// ── 2. spawn clearance — the invariant that has bitten this project before ─
console.log('\n=== spawn clearance (every map) ===');
for (const id of ALL) {
  const m = RC.getMap(id);
  (m.zones || []).forEach(z => RC.prepZone(z));
  m.spawns.forEach((s, i) => {
    // no obstacle may sit on a start position
    for (const o of (m.obstacles || [])) {
      const hit = Math.abs(s.x - o.x) < o.w / 2 + 90 && Math.abs(s.y - o.y) < o.h / 2 + 90;
      ok(!hit, id + ' spawn ' + i + ' is blocked by an obstacle');
    }
    // and no high ground / marsh directly under a base
    for (const z of (m.zones || [])) {
      if (z.t !== 'high' && z.t !== 'mud') continue;
      if (!z.poly) continue;
      ok(!inPoly(s.x, s.y, z.poly), id + ' spawn ' + i + ' sits inside a ' + z.t + ' zone');
    }
    // spawns must be inside the world with room for a base
    ok(s.x > 220 && s.y > 220 && s.x < m.world.w - 220 && s.y < m.world.h - 220,
       id + ' spawn ' + i + ' is jammed against the world edge');
  });
}
console.log('  all ' + ALL.length + ' maps: no spawn blocked, buried in high ground, marsh, or the map edge ✓');

// ── 3. the maps actually boot and play ────────────────────────────────────
console.log('\n=== each new planet boots a real match ===');
for (const id of NEW) {
  const g = new RC.Game(RC.getMap(id), RC.MODES['2v2']);
  ok(g.units.length > 0, id + ' started with no units');
  ok(g.buildings.some(b => b.def.isCore), id + ' started with no core');
  ok(g.nodes.length > 0, id + ' has no shard nodes to mine');
  const cores = g.buildings.filter(b => b.def.isCore);
  ok(cores.length === 4, id + ' 2v2 should place 4 cores, placed ' + cores.length);
  g.players.forEach(p => { p.ai = true; });
  for (let i = 0; i < 30 * 150 && !g.over; i++) g.update(1 / 30);
  ok(g.units.length > 0, id + ' lost every unit in 150s');
  console.log('  ' + id.padEnd(8) + ' 150s of AI-vs-AI: ' + g.units.length + ' units, ' +
              g.buildings.length + ' buildings, over=' + (g.over || 'still going'));
}

// ── 4. pathfinding works on the new terrain ───────────────────────────────
console.log('\n=== units can cross the new maps ===');
for (const id of NEW) {
  const g = new RC.Game(RC.getMap(id), RC.MODES['1v1']);
  const m = RC.getMap(id);
  const u = new RC.Unit('volt', m.spawns[0].x, m.spawns[0].y + 120, 1);
  g.units.push(u);
  const goal = { x: m.spawns[1].x, y: m.spawns[1].y };
  const start = Math.hypot(u.x - goal.x, u.y - goal.y);
  u.moveTo(goal.x, goal.y);
  for (let i = 0; i < 30 * 200 && Math.hypot(u.x - goal.x, u.y - goal.y) > 120; i++) {
    u.update(1 / 30, g); g.separate();
  }
  const left = Math.hypot(u.x - goal.x, u.y - goal.y);
  ok(left < 200, id + ': a unit could not cross the map (' + Math.round(start) + 'px → ' + Math.round(left) + 'px left)');
  console.log('  ' + id.padEnd(8) + ' crossed ' + Math.round(start) + 'px corner to corner ✓');
}

// ── 5. weather is gone: sight is terrain-only again ──────────────────────
console.log('\n=== no weather ===');
{
  ok(typeof RC.Weather === 'undefined', 'the weather module is still being loaded');
  ok(RC.CFG.WEATHER_ENABLED === undefined, 'the weather config flag is still there');
  const g = new RC.Game(RC.getMap('mars'), RC.MODES['1v1']);
  const u = new RC.Unit('volt', 500, 500, 1); g.units.push(u);
  // sight must be the printed stat, and must not drift with the clock
  let flat = true;
  for (let t = 0; t < 600; t += 7) { g.time = t; if (Math.abs(u.effSight(g) - RC.UNITS.volt.sight) > 1e-9) flat = false; }
  ok(flat, 'unit sight still changes over time — something is still modulating it');
  ok(Math.abs(g._sightOf(u) - u.effSight(g)) < 0.001, 'fog sight and combat sight disagree');
  // terrain still works
  g.terrainAt = () => ({ high: true }); u._terr = null;
  ok(u.effSight(g) > RC.UNITS.volt.sight, 'high ground no longer extends sight');
  console.log('  sight is the printed stat, constant over time, still modified by terrain ✓');

  // the three original maps are untouched
  for (const id of ['earth', 'venus', 'pluto']) {
    const m = RC.getMap(id);
    ok(!!m && m.spawns.length >= 4, id + ' was damaged');
    const g2 = new RC.Game(m, RC.MODES['1v1']);
    g2.players.forEach(p => { p.ai = true; });
    for (let i = 0; i < 30 * 60 && !g2.over; i++) g2.update(1 / 30);
    ok(g2.units.length > 0, id + ' broke');
  }
  console.log('  earth / venus / pluto still play ✓');

  // survival still runs (it has its own map and biome)
  const sv = new RC.Game();
  sv.setupSurvival({ difficulty: 'medium', race: 'forge', ally: true });
  for (let i = 0; i < 30 * 90 && !sv.over; i++) sv.update(1 / 30);
  ok(sv.crystal != null, 'survival lost its crystal reference');
  console.log('  survival runs ✓');
}

// ── 6. netcode still round-trips on the new maps ──────────────────────────
console.log('\n=== wire format ===');
{
  const g = new RC.Game(RC.getMap('jupiter'), RC.MODES['1v1']);
  for (let i = 0; i < 200; i++) g.update(1 / 30);
  const snap = RC.Net.serialize(g);
  ok(JSON.stringify(snap).indexOf('weather') < 0, 'weather leaked into the snapshot');
  const c = new RC.Game(RC.getMap('jupiter'), RC.MODES['1v1']);
  RC.Net.applySnapshot(c, snap);
  ok(Math.abs(c.time - g.time) < 1e-9, 'the clock did not survive the snapshot');
  ok(c.units.length === g.units.length, 'snapshot lost units on Jupiter');
  console.log('  ' + c.units.length + ' units reconciled on Jupiter ✓');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
