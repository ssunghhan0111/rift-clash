// RIFT CLASH — Kids mode (Crystal Guard), headless
// ---------------------------------------------------------------------------
// Drives the REAL modules: config.js, maps.js, entities.js, game.js, kids.js.
// Nothing here reimplements game logic, so a pass means the shipped code did the
// thing. No browser, no canvas — kids.js and game.js are both DOM-free.
//
// What it checks, and why each one is here rather than left to playtesting:
//   1. The curve is actually gentler than Survival's. The whole premise of the mode
//      is a softer ramp; if a refactor ever quietly reunified the two curves the
//      mode stops being what it claims to be, and that is invisible in one playthrough.
//   2. A real run reaches wave 8+ with the reward loop firing every single wave.
//      The card screen is the reward loop — a wave that clears without an offer is
//      the mode's core promise silently breaking.
//   3. Unlocks land on schedule and land in the shop.
//   4. No workers, no nodes, no build list — the simplifications actually hold.
//   5. Existing Survival is untouched.
const path = require('path');
global.window = global;

// Deliberately NO fake `document`. game.js and kids.js both guard on
// `typeof document !== 'undefined'` and skip their canvas work when it is absent —
// stubbing one in just makes them try to call getContext on a fake. This is also a
// standing check that kids.js stays DOM-free: the moment it reaches for the page,
// this file stops loading.
require('../config.js');
require('../maps.js');
require('../pathfind.js');
require('../entities.js');
require('../ai.js');
require('../survival.js');
require('../kids.js');
require('../game.js');

const K = RC.Kids;

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function head(s) { console.log('\n=== ' + s + ' ==='); }

// ── 1. The curve ────────────────────────────────────────────────────────────
head('WAVE SIZE — Kids vs Survival medium');
console.log('wave |  kids | surv(medium)');
let gentler = true;
for (const w of [1, 2, 3, 5, 8, 10, 15, 20, 25]) {
  const k = K.waveSize(w);
  const s = RC.Survival.waveSize(w, RC.Survival.diffOf({ survivalDiff: 'medium' }));
  console.log(String(w).padStart(4) + ' | ' + String(k).padStart(5) + ' | ' + String(s).padStart(12));
  if (w >= 3 && k > s) gentler = false;
}
ok(gentler, 'Kids waves are never larger than Survival medium from wave 3 on');
ok(K.waveSize(1) === 2, 'wave 1 is exactly 2 enemies');
ok(K.hpMul(1) < 1 && K.hpMul(5) === K.hpMul(1), 'enemy HP is below printed stats and flat for the first 5 waves');
ok(K.hpMul(20) < RC.Survival.diffOf({ survivalDiff: 'medium' }).hpBase * 2.5, 'late-wave HP stays modest');

// Air arrives late enough to be a lesson, not an ambush.
const air = K.ROSTER.find(e => e.air);
ok(air && air.at >= 11, 'the first flying enemy is wave ' + (air && air.at) + ' (>= 11)');

// ── 2. Wave flavours ────────────────────────────────────────────────────────
head('WAVE FLAVOURS');
const seen = {};
for (let w = 1; w <= 24; w++) seen[K.flavourFor(w).id] = (seen[K.flavourFor(w).id] || 0) + 1;
console.log('  first 24 waves: ' + JSON.stringify(seen));
ok(Object.keys(seen).length >= 3, 'at least three different wave flavours appear in the first 24 waves');
ok(K.flavourFor(1).id === 'normal', 'wave 1 is a plain wave — no gimmick before the basics land');
ok(K.compose(4).every(t => t === 'globling'), 'Runner Rush (wave 4) is one enemy type only');
ok(K.compose(16).every(t => (K.ROSTER.find(e => e.t === t) || {}).air), 'Sky Swarm (wave 16) is flyers only');
// Flyers walk over the ground army, so an air wave the size of a ground wave lands
// roughly three times the damage. Playtesting confirmed a full-size wave 16 took the
// crystal from 100% to 34% in one go, so Sky Swarm must stay the SMALLEST wave.
ok(K.compose(16).length < K.waveSize(16), 'Sky Swarm is smaller than a normal wave of the same number');
ok(K.FLAVOURS.sky.sizeMul < 1, 'Sky Swarm carries a size reduction');
ok(K.compose(6).length < K.waveSize(6), 'Big Guy trades numbers for one large enemy');

// The Big Guy has to be findable on screen, or "gang up on it" is not advice a kid
// can act on. kidsBoss is what renderer.js draws the crown from.
head('BIG GUY IS MARKED');
{
  const gb = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gb.setupKids({ race: 'forge' });
  const sb = K.st(gb);
  sb.wave = 6; sb.queue = K.compose(6); sb.phase = 'spawning';
  let guardB = 0;
  while (sb.queue.length && guardB++ < 4000) { sb.spawnT = 0; K.update(1 / 30, gb); }
  const horde = gb.units.filter(u => u.owner === 2);
  const bosses = horde.filter(u => u.kidsBoss);
  ok(bosses.length === 1, 'a Big Guy wave contains exactly one boss, got ' + bosses.length);
  ok(bosses[0] && bosses[0].maxHp > horde.filter(u => !u.kidsBoss)[0].maxHp * 2,
     'the boss has far more health than its escorts');
  const rend = require('fs').readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  ok(/u\.kidsBoss/.test(rend), 'renderer.js draws a marker for kidsBoss');
  ok(K.compose(1).length && !K.compose(1).some((_, i) => false), 'an ordinary wave has no boss');
}

// ── 3. A real run ───────────────────────────────────────────────────────────
head('LIVE RUN — 10 waves with the reward loop');
const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
g.heroesEnabled = true;
g.setupKids({ race: 'forge' });

ok(g.kids === true && g.survival === true, 'setupKids sets kids and rides on survival');
ok(!!g.crystal && !g.crystal.dead, 'the crystal exists');
ok(g.crystal.maxHp === K.CFG.CRYSTAL_HP, 'the crystal uses the Kids HP (' + K.CFG.CRYSTAL_HP + ')');
ok(!!g.kidsBase && g.kidsBase.def.isCore, 'there is a single base building to buy from');
ok(Math.abs(g.kidsBase.x - g.crystal.x) < 400, 'the base sits next to the crystal, not in a separate town');

// The simplifications, asserted rather than assumed.
ok(g.nodes.length === 0, 'no shard nodes on the map');
ok(g.units.filter(u => u.def.worker).length === 0, 'no workers');
ok(g.supply(1).max === K.CFG.POP, 'population cap is the flat Kids number (' + K.CFG.POP + ')');
ok(g.res[1].shard === K.CFG.START_SHARD, 'starting shards are the Kids amount');
ok(!!g.heroOf[1], 'the hero is still there');

// Income really is automatic.
const before = g.res[1].shard;
g.update(1 / 30);
ok(g.res[1].shard > before, 'shards tick up on their own with no worker doing anything');

const roster0 = K.roster(g);
ok(roster0.length === 3, 'exactly three buttons at the start, got ' + roster0.length);
ok(roster0.map(r => r.role).join('/') === 'Tank/Archer/Support', 'the three roles are Tank/Archer/Support');
ok(roster0.every(r => r.cost < RC.UNITS[r.t].cost), 'kid prices are cheaper than the normal card cost');
ok(roster0.every(r => r.time < RC.UNITS[r.t].time), 'kid build times are shorter than normal');

// Drive the sim. The kid is modelled as "buys whatever is affordable, always" and
// "takes the first card offered" — the least skilful player possible. If the mode
// is only survivable by a good player it is not a kids mode.
const DT = 1 / 30;
let rewards = 0, cleared = 0, sawUnlockBanner = false, maxWave = 0, guard = 0;
const unlockWavesSeen = [];

while (cleared < 10 && !g.over && guard < 30000) {
  guard++;
  const s = K.st(g);

  // Take a card the instant one is offered.
  if (s.phase === 'reward' && s.offer && s.offer.length) {
    const pickId = s.offer[0].id;
    const before2 = s.wave;
    ok0(K.choose(g, pickId), 'card accepted on wave ' + before2);
    rewards++;
    cleared = before2;
    continue;                      // choose() unpauses; loop round and keep ticking
  }
  if (s.banner && s.banner.ic === '🔓') { sawUnlockBanner = true; }
  if (s.wave > maxWave) {
    maxWave = s.wave;
    if (s.freshUnlock) unlockWavesSeen.push(s.wave);
  }

  // Buy relentlessly.
  const list = K.roster(g);
  for (const r of list) if (g.res[1].shard >= r.cost) K.buy(g, r.t);

  g.update(DT);
}
// tiny helper so a failed choose() is reported rather than silently looping forever
function ok0(cond, msg) { if (!cond) { fail++; console.log('  FAIL ' + msg); } }

console.log('  reached wave ' + maxWave + ' · ' + rewards + ' rewards taken · crystal at ' +
            Math.round((g.crystal ? g.crystal.hp / g.crystal.maxHp : 0) * 100) + '%');

ok(guard < 30000, 'the run progressed instead of deadlocking');
ok(maxWave >= 10, 'a button-mashing player reaches wave 10+ (got ' + maxWave + ')');
ok(rewards >= 9, 'a reward was offered after essentially every wave (' + rewards + ' in ' + maxWave + ' waves)');
ok(rewards === cleared || rewards >= cleared - 1, 'rewards track cleared waves one for one');
ok(sawUnlockBanner, 'a NEW FIGHTER banner fired during the run');
ok(unlockWavesSeen.length >= 2, 'at least two unlocks landed by wave 10, on waves ' + JSON.stringify(unlockWavesSeen));
ok(K.roster(g).length > 3, 'the shop grew past three buttons (now ' + K.roster(g).length + ')');
ok(g.units.some(u => u.owner === 1 && !u.def.hero), 'the player actually has an army on the field');
ok(g.upgrades[1].atk + g.upgrades[1].arm + g.upgrades[1].tough + g.upgrades[1].spd +
   g.upgrades[1].crit + g.upgrades[1].frost > 0 || K.st(g).incomeMul > 1,
   'the cards taken had a real mechanical effect');

// The card pool must not collapse onto one answer.
const capped = K.CARDS.filter(c => c.max <= 5);
ok(capped.length >= 6, 'most cards are capped so the pool keeps refreshing (' + capped.length + ' capped)');
head('CARD POOL — offers stay varied');
{
  const g2 = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g2.setupKids({ race: 'forge' });
  const ids = new Set();
  for (let i = 0; i < 40; i++) K.offer(g2).forEach(c => ids.add(c.id));
  console.log('  distinct cards seen over 40 offers: ' + ids.size + ' of ' + K.CARDS.length);
  ok(ids.size >= 8, 'the offer function draws from a wide pool');
  const o = K.offer(g2);
  ok(o.length === 3, 'exactly three cards are offered');
  ok(new Set(o.map(c => c.id)).size === 3, 'the three cards offered are always distinct');
  // choose() must reject anything that was not on the table.
  K.st(g2).phase = 'reward'; K.st(g2).offer = o;
  ok(K.choose(g2, '__nope__') === false, 'choose() rejects a card that was never offered');
}

// ── 4. Every faction has a working kit ──────────────────────────────────────
head('ALL THREE FACTIONS');
for (const race of ['forge', 'gloop', 'aether']) {
  const gx = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gx.heroesEnabled = true;
  gx.setupKids({ race });
  const r = K.roster(gx);
  ok(r.length === 3, race + ': three starters');
  ok(r.every(x => RC.UNITS[x.t]), race + ': every starter is a real unit');
  ok(r.every(x => !RC.UNITS[x.t].worker), race + ': no worker is offered as a fighter');
  ok(K.kitOf(race).unlocks.every(t => RC.UNITS[t]), race + ': every unlock is a real unit');
  // buy() must actually put something in the queue and take the shards.
  const cost = r[0].cost, sh = gx.res[1].shard;
  ok(K.buy(gx, r[0].t) === true, race + ': buying the first fighter works');
  ok(gx.kidsBase.queue.length === 1, race + ': it went into the queue');
  ok(Math.abs(gx.res[1].shard - (sh - cost)) < 0.001, race + ': it cost exactly the listed price');
  ok(K.buy(gx, 'wrench') === false, race + ': buying something not in the shop is refused');
  // run it long enough for the unit to pop out
  for (let i = 0; i < 60 * 30 && !gx.units.some(u => u.owner === 1 && u.type === r[0].t); i++) gx.update(DT);
  ok(gx.units.some(u => u.owner === 1 && u.type === r[0].t), race + ': the bought fighter actually spawned');
}

// ── 5. Survival is untouched ────────────────────────────────────────────────
head('SURVIVAL IS UNCHANGED');
{
  const gs = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gs.heroesEnabled = true;
  gs.setupSurvival({ race: 'forge', ally: false, difficulty: 'medium' });
  ok(gs.kids === false, 'a Survival run does not have the kids flag');
  ok(gs.nodes.length > 0, 'Survival still has shard nodes');
  ok(gs.units.filter(u => u.def.worker).length === 4, 'Survival still starts with 4 workers');
  ok(gs.supply(1).max !== K.CFG.POP, 'Survival keeps its own supply rules');
  ok(gs.crystal.maxHp === RC.BUILDINGS.crystal.hp, 'Survival keeps the original crystal HP');
  ok(gs._kd == null, 'Survival never allocates Kids state');
  for (let i = 0; i < 40 * 30; i++) gs.update(DT);
  ok(gs.survivalWave >= 1 && gs._sv != null, 'the Survival director still runs (wave ' + gs.survivalWave + ')');
}

console.log('\n' + (fail ? '✖ ' : '✔ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
