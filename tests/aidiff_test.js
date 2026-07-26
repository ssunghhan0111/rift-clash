// Versus (1v1 / 2v2) bot difficulty — Easy / Normal / Hard.
//
// Proves the three levers that make the setting real, each of which FAILS on the
// pre-change code (which had no RC.AI_DIFF, no game.aiProfile, and an addShard that
// never scaled AI income):
//   1. RC.AI_DIFF.normal reproduces the historical AI_* constants EXACTLY, so Normal
//      is a no-op vs the old behaviour.
//   2. game.aiProfile only tunes the human's opponents — an allied bot stays Normal.
//   3. addShard scales an enemy bot's income by the profile (Hard bank > Easy bank),
//      and never touches the human's income.
//   4. End-to-end: a Hard bot out-economises an Easy bot in a real headless match.
const path = require('path');
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// ── 1. Normal == the old constants (choosing Normal changes nothing) ────────
console.log('Normal profile reproduces the historical AI tuning');
{
  const K = RC.CFG, N = RC.AI_DIFF.normal;
  ok(N.workerCap === K.AI_WORKER_CAP, 'workerCap matches AI_WORKER_CAP (' + N.workerCap + ')');
  ok(N.firstWave === K.AI_FIRST_WAVE, 'firstWave matches AI_FIRST_WAVE (' + N.firstWave + ')');
  ok(N.waveSize === K.AI_WAVE_SIZE, 'waveSize matches AI_WAVE_SIZE (' + N.waveSize + ')');
  ok(N.waveGap === K.AI_WAVE_GAP, 'waveGap matches AI_WAVE_GAP (' + N.waveGap + ')');
  ok(N.secondFactory === K.AI_SECOND_FACTORY, 'secondFactory matches AI_SECOND_FACTORY (' + N.secondFactory + ')');
  ok(N.income === 1, 'income is 1.0 (no economy cheat on Normal)');
}

// ── 2. The difficulties are ordered the way the labels promise ──────────────
console.log('Easy / Normal / Hard are ordered sensibly');
{
  const E = RC.AI_DIFF.easy, N = RC.AI_DIFF.normal, H = RC.AI_DIFF.hard;
  ok(E.workerCap < N.workerCap && N.workerCap < H.workerCap, 'workerCap Easy<Normal<Hard (' + E.workerCap + '<' + N.workerCap + '<' + H.workerCap + ')');
  ok(E.firstWave > N.firstWave && N.firstWave > H.firstWave, 'Hard attacks soonest, Easy latest');
  // Easy keeps a hard cap on its army so it can never mass a death-ball; Normal/Hard are uncapped.
  ok(E.armyCap < N.armyCap && E.armyCap < H.armyCap, 'Easy caps its army (' + E.armyCap + ') while Normal/Hard do not');
  ok(E.armyCap <= 6, 'the Easy army cap is small enough to be defensible (' + E.armyCap + ')');
  ok(E.income < 1 && H.income > 1, 'Easy economy penalised, Hard economy boosted');
}

// ── 3. aiProfile only tunes the human's opponents; income scales for them ───
console.log('Difficulty targets opponents only, and scales their income');
{
  const g = new RC.Game();
  g.aiDiff = 'hard';
  g.playerOwner = 1;
  g.teamMap = { 1: 0, 3: 0, 2: 1, 4: 1 };          // 2v2: you+ally(3) vs bots(2,4)
  g.players = [{ owner: 1, ai: false }, { owner: 3, ai: true }, { owner: 2, ai: true }, { owner: 4, ai: true }];
  g.res = { 1: { shard: 0 }, 2: { shard: 0 }, 3: { shard: 0 }, 4: { shard: 0 } };
  ok(g.aiProfile(2).id === 'hard', 'enemy bot 2 gets the chosen difficulty');
  ok(g.aiProfile(4).id === 'hard', 'enemy bot 4 too');
  ok(g.aiProfile(3).id === 'normal', 'allied bot 3 stays Normal on Hard (Easy would not nerf your teammate either)');
  ok(g.aiProfile(1).id === 'normal', 'the human is never scaled');

  const hardBank = 100 * RC.AI_DIFF.hard.income;      // enemy on Hard
  g.addShard(2, 100); ok(g.res[2].shard === hardBank, 'Hard enemy banks 100 → ' + hardBank + ' (×' + RC.AI_DIFF.hard.income + ')');
  g.addShard(3, 100); ok(g.res[3].shard === 100, 'allied bot banks 100 → 100 (Normal)');
  g.addShard(1, 100); ok(g.res[1].shard === 100, 'the human banks 100 → 100 (untouched)');
  g.aiDiff = 'easy';
  const easyBank = hardBank + 100 * RC.AI_DIFF.easy.income;   // enemy on Easy banks less
  g.addShard(2, 100); ok(g.res[2].shard === easyBank, 'Easy enemy banks 100 → +' + (100 * RC.AI_DIFF.easy.income) + ' (×' + RC.AI_DIFF.easy.income + '), total ' + easyBank);
}

// ── 4. End-to-end: a Hard bot out-economises an Easy bot in a real match ────
console.log('A Hard bot out-grows an Easy bot in a headless 1v1');
{
  const MAP = RC.MAPS[0].id;
  function runEco(diff, seconds) {
    const g = new RC.Game();
    g.playerOwner = 1;                               // human (idle) — pure economy race
    g.setup(RC.getMap(MAP), RC.MODES['1v1'], { 1: 'forge', 2: 'forge' }, diff);
    if (RC.AI.reset) RC.AI.reset();
    const dt = 1 / 30;
    for (let i = 0; i < seconds * 30; i++) g.update(dt);
    return {
      workers: g.units.filter(u => u.owner === 2 && u.def.worker).length,
      army: g.units.filter(u => u.owner === 2 && !u.def.worker && !u.def.hero).length,
    };
  }
  // Math.random drives AI placement, so average a few runs to shake out variance.
  let easySum = 0, hardSum = 0, easyArmyMax = 0, trials = 3;
  for (let t = 0; t < trials; t++) {
    const e = runEco('easy', 150), h = runEco('hard', 150);
    easySum += e.workers; hardSum += h.workers; easyArmyMax = Math.max(easyArmyMax, e.army);
  }
  const easyAvg = easySum / trials, hardAvg = hardSum / trials;
  console.log('  bot workers after 150s — Easy avg ' + easyAvg.toFixed(1) + ' vs Hard avg ' + hardAvg.toFixed(1) + ' · Easy peak army ' + easyArmyMax);
  ok(hardAvg > easyAvg, 'the Hard bot fields more workers than the Easy bot (' + hardAvg.toFixed(1) + ' > ' + easyAvg.toFixed(1) + ')');
  ok(easyAvg <= RC.AI_DIFF.easy.workerCap + 0.01, 'the Easy bot respects its lower worker cap (' + easyAvg.toFixed(1) + ' ≤ ' + RC.AI_DIFF.easy.workerCap + ')');
  // The core balance fix: Easy must never hoard a death-ball — its trained army stays at/under the cap.
  ok(easyArmyMax <= RC.AI_DIFF.easy.armyCap, 'the Easy bot never masses past its army cap (peak ' + easyArmyMax + ' ≤ ' + RC.AI_DIFF.easy.armyCap + ')');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
