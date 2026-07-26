// Drives the REAL survival.js module and reports the new difficulty curve.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
global.window = global;
require('../survival.js');
const S = RC.Survival;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); } }

// ── old curve, for side-by-side comparison ────────────────────────────────
const OLD = {
  easy:   { size: 3, sizeGrow: 0.9, hpBase: 0.80, hpGrow: 0.07 },
  medium: { size: 4, sizeGrow: 1.5, hpBase: 1.00, hpGrow: 0.12 },
  insane: { size: 5, sizeGrow: 2.3, hpBase: 1.35, hpGrow: 0.18 },
};
const oldCount = (w, d) => Math.max(3, OLD[d].size + Math.round(w * OLD[d].sizeGrow)) + (w % 5 === 0 ? 2 : 0);
const oldHp = (w, d) => OLD[d].hpBase * (1 + w * OLD[d].hpGrow);

// A fake game object — only survivalDiff / daily are read by the curve fns.
const G = d => ({ survivalDiff: d });

function newCount(w, d) { return S.compose(w, G(d)).length; }
function newHp(w, d) {
  const u = { def: { hp: 100 } };
  S.scaleHp(u, w, G(d));
  return u.maxHp / 100;
}

console.log('\n=== WAVE SIZE: old → new ===');
console.log('wave |        easy        |       medium       |       insane');
for (const w of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40]) {
  const row = ['easy', 'medium', 'insane'].map(d => {
    const o = oldCount(w, d), n = newCount(w, d);
    return (String(o) + ' → ' + String(n)).padStart(9) + ' ' + (n < o ? '↓' : n > o ? '↑' : '=');
  });
  console.log(String(w).padStart(4) + ' | ' + row.join(' | '));
}

console.log('\n=== ENEMY HP MULTIPLIER: old → new ===');
console.log('wave |        easy        |       medium       |       insane');
for (const w of [1, 2, 3, 5, 10, 15, 20, 30]) {
  const row = ['easy', 'medium', 'insane'].map(d => {
    const o = oldHp(w, d), n = newHp(w, d);
    return (o.toFixed(2) + ' → ' + n.toFixed(2)).padStart(13) + ' ' + (n < o ? '↓' : n > o ? '↑' : '=');
  });
  console.log(String(w).padStart(4) + ' | ' + row.join(' | '));
}

console.log('\n=== MEDIUM WAVE COMPOSITION (first appearance of each type) ===');
const seen = {};
for (let w = 1; w <= 30; w++) {
  const list = S.compose(w, G('medium'));
  const tally = {};
  for (const t of list) tally[t] = (tally[t] || 0) + 1;
  for (const t of Object.keys(tally)) if (!seen[t]) seen[t] = w;
  if (w <= 14 || w % 5 === 0) {
    const s = Object.keys(tally).sort((a, b) => tally[b] - tally[a]).map(t => t + '×' + tally[t]).join(', ');
    console.log(String(w).padStart(3) + ' (' + String(list.length).padStart(2) + '): ' + s);
  }
}
console.log('\nfirst appearance:', JSON.stringify(seen));

// ── assertions ────────────────────────────────────────────────────────────
console.log('\n=== CHECKS ===');

// 1. wave 1 is a genuine warm-up on every difficulty
ok(newCount(1, 'easy') <= 3, 'easy wave 1 should be <=3, got ' + newCount(1, 'easy'));
ok(newCount(1, 'medium') <= 3, 'medium wave 1 should be <=3, got ' + newCount(1, 'medium'));
ok(newCount(1, 'insane') <= 4, 'insane wave 1 should be <=4, got ' + newCount(1, 'insane'));

// 2. wave 1 is strictly easier than before on every difficulty
for (const d of ['easy', 'medium', 'insane']) {
  ok(newCount(1, d) < oldCount(1, d), d + ' wave 1 not easier than old');
  ok(newHp(1, d) < oldHp(1, d), d + ' wave 1 HP not lower than old');
}

// 3. enemies use printed stats early (no HP bonus at all on wave 1 medium)
ok(Math.abs(newHp(1, 'medium') - 1.0) < 0.001, 'medium wave 1 HP multiplier should be exactly 1.00');

// 4. never empty, never below 2
for (const d of ['easy', 'medium', 'insane']) {
  for (let w = 1; w <= 60; w++) ok(newCount(w, d) >= 2, d + ' wave ' + w + ' had ' + newCount(w, d) + ' enemies');
}

// 5. monotonic non-decreasing size curve (milestone waves may bump, never dip below the base curve)
for (const d of ['easy', 'medium', 'insane']) {
  const D = S.diffOf(G(d));
  let prev = 0;
  for (let w = 1; w <= 60; w++) {
    const n = S.waveSize(w, D);
    ok(n >= prev, d + ' base size dipped at wave ' + w + ' (' + prev + ' → ' + n + ')');
    prev = n;
  }
}

// 6. HP curve is non-decreasing
for (const d of ['easy', 'medium', 'insane']) {
  let prev = 0;
  for (let w = 1; w <= 60; w++) { const h = newHp(w, d); ok(h >= prev - 1e-9, d + ' HP dipped at wave ' + w); prev = h; }
}

// 7. the ramp is GENTLE early and STEEPER late (that is the whole point)
const D_STEP = S.diffOf(G('medium'));
const earlyStep = S.waveSize(5, D_STEP) - S.waveSize(1, D_STEP);
const lateStep = S.waveSize(24, D_STEP) - S.waveSize(20, D_STEP);
ok(lateStep > earlyStep, 'late 4-wave step (' + lateStep + ') should exceed early 4-wave step (' + earlyStep + ')');

// 8. no enemy type appears before its unlock wave; each debuts sparsely
const D_MED = S.diffOf(G('medium'));
for (const e of S.ROSTER) {
  ok(S.weightAt(e, e.at - 1, D_MED) === 0 || e.at <= 1, e.t + ' has weight before its unlock wave');
  ok(S.weightAt(e, e.at, D_MED) < e.w, e.t + ' debuts at full weight instead of ramping in');
  ok(Math.abs(S.weightAt(e, e.at + 4, D_MED) - e.w) < 1e-9, e.t + ' never reaches full weight');
}

// 9. wave 5 no longer force-spawns Bloats before Bloats unlock
for (let w = 1; w <= 9; w++) {
  const list = S.compose(w, G('medium'));
  const bloatUnlocked = S.weightAt(S.ROSTER.find(e => e.t === 'bloat'), w, D_MED) > 0;
  ok(bloatUnlocked || !list.includes('bloat'), 'wave ' + w + ' spawned a Bloat before it unlocks');
}

// 10. milestone waves still exist from 10 on
for (const w of [10, 15, 20, 25]) {
  const D = S.diffOf(G('medium'));
  ok(S.compose(w, G('medium')).length > S.waveSize(w, D), 'wave ' + w + ' missing its milestone push');
}
for (const w of [5]) {
  const D = S.diffOf(G('medium'));
  ok(S.compose(w, G('medium')).length === S.waveSize(w, D), 'wave 5 should no longer get a milestone push');
}

// 11. difficulty ordering holds at every wave
for (let w = 1; w <= 40; w++) {
  ok(newCount(w, 'easy') <= newCount(w, 'medium'), 'easy >= medium count at wave ' + w);
  ok(newCount(w, 'medium') <= newCount(w, 'insane'), 'medium >= insane count at wave ' + w);
  ok(newHp(w, 'easy') < newHp(w, 'medium'), 'easy HP >= medium at wave ' + w);
  ok(newHp(w, 'medium') < newHp(w, 'insane'), 'medium HP >= insane at wave ' + w);
}

// 12. late game stays comparable to the old curve (leaderboard continuity)
for (const d of ['easy', 'medium', 'insane']) {
  const ratio = newCount(30, d) / oldCount(30, d);
  ok(ratio > 0.8 && ratio < 1.35, d + ' wave-30 size drifted too far from old (' + ratio.toFixed(2) + '×)');
}

// 13. size cap holds (performance guard)
for (const d of ['easy', 'medium', 'insane']) {
  const D = S.diffOf(G(d));
  ok(S.waveSize(999, D) === D.sizeCap, d + ' size cap not enforced');
}

// ── daily twists ──────────────────────────────────────────────────────────
require('../daily.js');
function dailyGame(id) {
  const mod = RC.Daily.MODS.find(m => m.id === id);
  const g = { survivalDiff: 'medium', daily: { mod }, _dailyRng: RC.Daily.makeRng(12345) };
  return g;
}
console.log('\n=== DAILY TWISTS (wave 10, vs plain medium) ===');
const baseline = newCount(10, 'medium');
for (const m of RC.Daily.MODS) {
  const g = dailyGame(m.id);
  const n = S.compose(10, g).length;
  const u = { def: { hp: 100 } }; S.scaleHp(u, 10, g);
  console.log('  ' + m.name.padEnd(16) + ' count ' + String(n).padStart(3) + ' (base ' + baseline + ')   hp ×' + (u.maxHp / 100).toFixed(2));
}

// Skyfall must bring AIR EARLIER — the old code pushed everything later
const sky = S.diffOf(dailyGame('skyfall'));
const floater = S.ROSTER.find(e => e.t === 'floater');
const spitter = S.ROSTER.find(e => e.t === 'spitter');
ok(S.weightAt(floater, 6, sky) > 0, 'Skyfall should have air units by wave 6');
ok(S.weightAt(floater, 6, sky) > S.weightAt(floater, 6, D_MED), 'Skyfall air not earlier than baseline');
ok(S.weightAt(spitter, 4, sky) > 0, 'Skyfall wrongly delayed a GROUND type');
ok(S.compose(1, dailyGame('skyfall')).length >= 2, 'Skyfall wave 1 empty');

// Swarm = more but frailer; Elite = fewer but tougher
const swarmG = dailyGame('swarm'), eliteG = dailyGame('elite');
ok(S.compose(10, swarmG).length > baseline, 'Endless Swarm should out-number baseline');
ok(S.compose(10, eliteG).length < baseline, 'Elite Guard should under-number baseline');
{
  const a = { def: { hp: 100 } }, b = { def: { hp: 100 } };
  S.scaleHp(a, 10, swarmG); S.scaleHp(b, 10, eliteG);
  ok(a.maxHp < 100 * newHp(10, 'medium'), 'Endless Swarm enemies should be frailer');
  ok(b.maxHp > 100 * newHp(10, 'medium'), 'Elite Guard enemies should be tougher');
}
// every twist must still produce a playable wave 1
for (const m of RC.Daily.MODS) ok(S.compose(1, dailyGame(m.id)).length >= 2, m.name + ' wave 1 empty');

// 14. seeded determinism — same seed, identical run
{
  const a = dailyGame('blitz'), b = dailyGame('blitz');
  let same = true;
  for (let w = 1; w <= 20; w++) {
    if (S.compose(w, a).join(',') !== S.compose(w, b).join(',')) { same = false; break; }
  }
  ok(same, 'seeded daily composition is not reproducible');
}

// 15. exported API intact for the existing suites
for (const k of ['reset', 'update', 'compose', 'scaleHp', 'diffOf', 'prepOf', 'gapOf', 'diffName']) {
  ok(typeof S[k] === 'function', 'export missing: ' + k);
}
ok(S.diffName('insane') === 'Crazy Hard', 'diffName broken');
ok(S.prepOf({}) === 18, 'prepOf default changed');
ok(S.gapOf({}) === 5, 'gapOf default changed');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
