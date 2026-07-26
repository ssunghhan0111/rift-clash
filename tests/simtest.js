// Full-stack smoke test: boots REAL survival games with the real modules and
// simulates them wave by wave, wiping each wave as it finishes spawning, to prove
// the new difficulty curve survives contact with the actual entity, pathfinding
// and netcode paths — not just the arithmetic.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
global.window = global;
require('../config.js');
require('../maps.js');
require('../pathfind.js');
require('../entities.js');
require('../game.js');
require('../ai.js');
require('../daily.js');
require('../survival.js');
require('../net_core.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

const EPOCH = Date.UTC(2026, 0, 1), DAY = 86400000;

function boot(opts) {
  const g = new RC.Game();
  g.setupSurvival(opts || {});
  return g;
}

// Advance the sim until wave `n` has finished spawning, wiping each wave the
// moment it is fully on the field. Returns what actually spawned.
function runWaves(g, n, label) {
  const dt = 1 / 30;
  const seen = [];
  let guard = 0;
  while (seen.length < n) {
    RC.Survival.update(dt, g);
    g.time += dt;
    const s = g._sv;
    if (s && s.wave > 0 && !s.queue.length) {
      const alive = g.units.filter(u => u.owner === 2 && !u.dead);
      if (alive.length && seen.length < s.wave) {
        const ref = alive[0];
        seen.push({
          wave: s.wave, n: alive.length,
          hp: ref.maxHp / ref.def.hp,
          atk: g.upgrades[2] ? g.upgrades[2].atk : 0,
          types: alive.reduce((a, u) => (a[u.type || u.def.id] = (a[u.type || u.def.id] || 0) + 1, a), {}),
        });
        for (const u of alive) u.dead = true;
        g.units = g.units.filter(u => !u.dead);
      }
    }
    if (++guard > 2000000) { ok(false, label + ': sim stalled before wave ' + n); break; }
  }
  return seen;
}

console.log('=== FULL SIM: medium, waves 1-30 ===');
{
  const g = boot({ difficulty: 'medium', race: 'forge' });
  ok(!!g.crystal, 'survival game has no Rift Crystal');
  ok(!!g.enemySpawn, 'survival game has no enemy spawn');
  ok(g.survival === true, 'survival flag not set');

  const seen = runWaves(g, 30, 'medium');
  console.log('  ' + seen.filter(s => s.wave <= 12 || s.wave % 5 === 0)
    .map(s => 'w' + s.wave + ':' + s.n + '@×' + s.hp.toFixed(2)).join('  '));

  ok(seen.length === 30, 'expected 30 waves, saw ' + seen.length);
  ok(seen[0].n <= 3, 'wave 1 spawned ' + seen[0].n + ' enemies — not a warm-up');
  ok(Math.abs(seen[0].hp - 1.0) < 0.02, 'wave 1 enemies not at printed HP (×' + seen[0].hp.toFixed(2) + ')');
  ok(Object.keys(seen[0].types).length === 1 && seen[0].types.globling,
     'wave 1 should be Globlings only, got ' + JSON.stringify(seen[0].types));
  ok(seen[0].atk === 0, 'the horde opened wave 1 already weapon-upgraded');

  // real spawned units carry the scaled stats and a live order
  ok(seen[9].hp > seen[0].hp, 'HP did not grow by wave 10');
  ok(seen[29].n > seen[0].n * 5, 'wave 30 is not dramatically bigger than wave 1');

  // no wave shrinks (milestone waves aside)
  for (let i = 1; i < seen.length; i++) {
    if (seen[i].wave % 5 === 0 || seen[i - 1].wave % 5 === 0) continue;
    ok(seen[i].n >= seen[i - 1].n - 1, 'wave ' + seen[i].wave + ' (' + seen[i].n + ') smaller than wave ' + seen[i - 1].wave + ' (' + seen[i - 1].n + ')');
  }
  // Bloats must not appear before they unlock (the old wave-5 forced push)
  for (const s of seen) if (s.wave < 8) ok(!s.types.bloat, 'wave ' + s.wave + ' spawned a Bloat before wave 8');

  console.log('  atk upgrade by wave: ' + seen.slice(0, 16).map(s => s.atk).join(','));
}

console.log('\n=== FULL SIM: every difficulty reaches wave 25 ===');
for (const d of ['easy', 'medium', 'insane']) {
  const g = boot({ difficulty: d, race: 'gloop' });
  const seen = runWaves(g, 25, d);
  ok(seen.length === 25, d + ' did not reach wave 25');
  ok(seen.every(s => s.n >= 2), d + ' produced an empty wave');
  console.log('  ' + d.padEnd(7) + ' w1:' + String(seen[0].n).padStart(2) + '  w5:' + String(seen[4].n).padStart(2) +
              '  w10:' + String(seen[9].n).padStart(2) + '  w20:' + String(seen[19].n).padStart(2) +
              '  w25:' + String(seen[24].n).padStart(2) +
              '   hp ×' + seen[0].hp.toFixed(2) + ' → ×' + seen[24].hp.toFixed(2));
}

console.log('\n=== FULL SIM: every daily twist boots and runs 12 waves ===');
RC.Daily.MODS.forEach((m, idx) => {
  const g = boot({ daily: true, dailyNow: EPOCH + idx * DAY + 1000, race: 'aether' });
  ok(g.daily && g.daily.mod.id === m.id, 'twist ' + m.id + ' not armed (got ' + (g.daily && g.daily.mod.id) + ')');
  const seen = runWaves(g, 12, m.id);
  ok(seen.length === 12, m.name + ' did not reach wave 12');
  ok(seen.every(s => s.n >= 2), m.name + ' produced an empty wave');
  const air = seen.reduce((a, s) => a + (s.types.floater || 0) + (s.types.heli || 0) + (s.types.seraph || 0), 0);
  console.log('  ' + m.name.padEnd(17) + ' w1:' + String(seen[0].n).padStart(2) +
              '  w6:' + String(seen[5].n).padStart(2) + '  w12:' + String(seen[11].n).padStart(2) +
              '   hp ×' + seen[11].hp.toFixed(2) + '   air in 12 waves: ' + air);
  if (m.id === 'skyfall') ok(air > 0, 'Skyfall produced NO air units in 12 waves');
});

console.log('\n=== Skyfall vs baseline: air really does come earlier now ===');
{
  const sky = boot({ daily: true, dailyNow: EPOCH + 5 * DAY + 1000 });
  const base = boot({ difficulty: 'medium' });
  const a = runWaves(sky, 12, 'sky').reduce((x, s) => x + (s.types.floater || 0) + (s.types.heli || 0) + (s.types.seraph || 0), 0);
  const b = runWaves(base, 12, 'base').reduce((x, s) => x + (s.types.floater || 0) + (s.types.heli || 0) + (s.types.seraph || 0), 0);
  console.log('  air units in first 12 waves — Skyfall: ' + a + ',  plain Medium: ' + b);
  ok(a > b, 'Skyfall did not bring more air than baseline (' + a + ' vs ' + b + ')');
}

console.log('\n=== retry replays the identical daily run ===');
{
  const a = boot({ daily: true, dailyNow: EPOCH + 1 * DAY + 1000 });
  const first = runWaves(a, 8, 'daily-a').map(s => s.wave + ':' + s.n).join(' ');
  a.reset();
  const again = runWaves(a, 8, 'daily-a2').map(s => s.wave + ':' + s.n).join(' ');
  ok(first === again, 'daily retry did not reproduce the run\n    ' + first + '\n    ' + again);
}

console.log('\n=== netcode round-trip ===');
{
  const g = boot({ difficulty: 'medium' });
  runWaves(g, 3, 'net');
  const snap = RC.Net.serialize(g);
  ok(snap && snap.sv && snap.sv.w === 3, 'survival wave missing from snapshot');
  const g2 = boot({ difficulty: 'medium' });
  RC.Net.applySnapshot(g2, snap);
  ok(g2.survivalWave === 3, 'wave did not survive the snapshot round-trip');
}

console.log('\n=== per-room isolation (two rooms, different difficulties, one process) ===');
{
  const r1 = boot({ difficulty: 'easy' });
  const r2 = boot({ difficulty: 'insane' });
  const s1 = runWaves(r1, 6, 'room1');
  const s2 = runWaves(r2, 6, 'room2');
  ok(r1._sv !== r2._sv, 'two rooms share survival state');
  ok(s1[5].n < s2[5].n, 'easy room wave 6 not smaller than insane room wave 6');
  ok(r1.survivalWave === 6 && r2.survivalWave === 6, 'wave counters crossed between rooms');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
