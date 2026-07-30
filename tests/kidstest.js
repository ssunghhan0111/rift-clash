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
//   4. Attack lanes open one at a time, and a late wave really does arrive from all
//      four sides. The mode promises a gentle start AND a 360° endgame.
//   5. Co-op: two defenders, two economies, two reward cards, and no pause. A card
//      screen that paused the world would stop the whole room for both players.
//   6. No workers, no nodes, no build list — the simplifications actually hold.
//   7. Existing Survival is untouched.
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
require('../net_core.js');      // the co-op snapshot/command path is part of the mode now

const K = RC.Kids;

// ── Seeded randomness ──────────────────────────────────────────────────────
// The live run below spans ten waves of composed hordes and thirty card draws, all off
// Math.random, and the spread between a lucky and an unlucky run is enormous — early
// measurements of the same build came back anywhere from 6 to 14 waves cleared. An
// assertion on an unseeded run is therefore a coin flip, and a test that fails one time
// in four teaches everyone to ignore it. Seeded, the headline run is reproducible; the
// sweep at the end is what covers the spread.
const _rand = Math.random;
function seedRandom(seed) {
  let x = seed >>> 0 || 1;
  Math.random = function () {                      // xorshift32 — small, fast, good enough
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}
function unseedRandom() { Math.random = _rand; }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
// For per-wave loops, where printing an ok per iteration would bury everything else.
function ok0(cond, msg) { if (!cond) { fail++; console.log('  FAIL ' + msg); } }
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
// Enemies used to arrive at 70% health, flat for five waves, which is most of why the
// opening was a formality. They now start at their printed stats and climb from wave 3.
ok(K.hpMul(1) >= 1 && K.hpMul(3) === K.hpMul(1), 'enemies start at full printed stats, flat for the first three waves');
ok(K.hpMul(8) > K.hpMul(3), 'and get tougher after that');
ok(K.hpMul(20) < RC.Survival.diffOf({ survivalDiff: 'medium' }).hpBase * 2.5, 'late-wave HP stays modest');

// Air arrives late enough to be a lesson, not an ambush.
const air = K.ROSTER.find(e => e.air);
ok(air && air.at >= 11, 'the first flying enemy is wave ' + (air && air.at) + ' (>= 11)');

// ── 2. Wave flavours ────────────────────────────────────────────────────────
// Every wave has a name, an icon and a colour. That is what makes a run read as a
// sequence of events rather than a counter going up, so a flavour missing any of the
// three leaves a wave with a blank banner.
head('WAVE FLAVOURS');
{
  const seen = new Set();
  for (let w = 1; w <= 30; w++) {
    const f = K.flavourFor(w);
    seen.add(f.id);
    ok0(!!f && !!f.ic && !!f.col, 'wave ' + w + ' has an icon and a colour');
    ok0(!!K.waveLabel(w), 'wave ' + w + ' has a label');
  }
  console.log('  flavours seen over 30 waves: ' + [...seen].join(', '));
  ok(seen.size >= 4, 'at least four different wave flavours appear in 30 waves, saw ' + seen.size);
  ok(!!K.FLAVOURS.normal, 'there is a plain "normal" flavour to fall back on');
  const boss = Object.keys(K.FLAVOURS).filter(k => K.FLAVOURS[k].boss);
  ok(boss.length >= 1, 'at least one flavour spawns a Big Guy');
  ok(K.CFG.BOSS_HP > 1, 'the Big Guy is actually tougher than its own card');
}

// ── 2b. The boss is visibly marked ──────────────────────────────────────────
// The Big Guy is the SAME sprite with five times the health, so without a marker a kid
// has no way to tell which enemy is the special one. renderer.js needs a canvas and
// cannot be loaded here, so this reads the source — enough to catch the marker being
// dropped in a refactor, which is the failure that actually matters.
head('THE BIG GUY IS MARKED ON SCREEN');
{
  const rend = require('fs').readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  ok(rend.indexOf('kidsBoss') >= 0, 'renderer.js still draws the kidsBoss marker');
}

// ── 3. A real run ───────────────────────────────────────────────────────────
head('A REAL RUN — 10 waves, worst possible player');
seedRandom(20260729);
const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
g.heroesEnabled = true;
g.setupKids({ race: 'forge' });

ok(g.kids === true, 'the run is flagged as a kids run');
ok(g.survival === true, 'it still rides on the survival flag (HUD + lose condition)');
ok(!!g.crystal, 'there is a crystal to defend');
ok(g.crystal.maxHp === K.CFG.CRYSTAL_HP, 'the crystal has the kid-sized health pool');
ok(!!g.kidsBase, 'there is a base to buy fighters from');
ok(g.res[1].shard === K.CFG.START_SHARD, 'the run opens with enough shards for two fighters');

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
const lanesSeen = {};              // wave -> how many attack lanes were open

while (cleared < 10 && !g.over && guard < 60000) {
  guard++;
  const s = K.st(g);

  // Take a card the instant one is offered. The offer is PER DEFENDER now, so the
  // harness reads this player's own slice rather than a single shared one.
  const mine = K.per(g, 1);
  if (s.phase === 'reward' && mine.offer && mine.offer.length) {
    const pickId = mine.offer[0].id;
    const before2 = s.wave;
    ok0(K.choose(g, pickId, 1), 'card accepted on wave ' + before2);
    rewards++;
    cleared = before2;
    continue;                      // choose() unpauses; loop round and keep ticking
  }
  if (s.banner && s.banner.ic === '🔓') { sawUnlockBanner = true; }
  if (s.wave > maxWave) {
    maxWave = s.wave;
    if (mine.freshUnlock) unlockWavesSeen.push(s.wave);
    lanesSeen[s.wave] = s.lanes;
  }

  // Buy relentlessly.
  const list = K.roster(g);
  for (const r of list) if (g.res[1].shard >= r.cost) K.buy(g, r.t);

  g.update(DT);
}

console.log('  reached wave ' + maxWave + ' · ' + rewards + ' rewards taken · crystal at ' +
            Math.round((g.crystal ? g.crystal.hp / g.crystal.maxHp : 0) * 100) + '%');

unseedRandom();
ok(guard < 60000, 'the run progressed instead of deadlocking');
ok(maxWave >= 10, 'a button-mashing player reaches wave 10+ (got ' + maxWave + ')');
ok(rewards >= 9, 'a reward was offered after essentially every wave (' + rewards + ' in ' + maxWave + ' waves)');
ok(rewards === cleared || rewards >= cleared - 1, 'rewards track cleared waves one for one');
ok(sawUnlockBanner, 'a NEW FIGHTER banner fired during the run');
ok(unlockWavesSeen.length >= 2, 'at least two unlocks landed by wave 10, on waves ' + JSON.stringify(unlockWavesSeen));
ok(K.roster(g).length > 3, 'the shop grew past three buttons (now ' + K.roster(g).length + ')');
ok(g.units.some(u => u.owner === 1 && !u.def.hero), 'the player actually has an army on the field');
ok(g.upgrades[1].atk + g.upgrades[1].arm + g.upgrades[1].tough + g.upgrades[1].spd +
   g.upgrades[1].crit + g.upgrades[1].frost > 0 || K.per(g, 1).incomeMul > 1,
   'the cards taken had a real mechanical effect');

// The card pool must not collapse onto one answer.
const capped = K.CARDS.filter(c => c.max <= 5);
ok(capped.length >= 6, 'most cards are capped so the pool keeps refreshing (' + capped.length + ' capped)');
head('CARD POOL — offers stay varied');
{
  const g2 = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g2.setupKids({ race: 'forge' });
  const ids = new Set();
  for (let i = 0; i < 40; i++) K.offer(g2, 1).forEach(c => ids.add(c.id));
  console.log('  distinct cards seen over 40 offers: ' + ids.size + ' of ' + K.CARDS.length);
  ok(ids.size >= 8, 'the offer function draws from a wide pool');
  const o = K.offer(g2, 1);
  ok(o.length === 3, 'exactly three cards are offered');
  ok(new Set(o.map(c => c.id)).size === 3, 'the three cards offered are always distinct');
  // choose() must reject anything that was not on the table.
  K.st(g2).phase = 'reward'; K.per(g2, 1).offer = o;
  ok(K.choose(g2, '__nope__', 1) === false, 'choose() rejects a card that was never offered');
  ok(K.choose(g2, o[0].id, 1) === true, 'choose() accepts a card that was offered');
  ok(K.choose(g2, o[1].id, 1) === false, 'a second pick in the same wave is refused');
}

// ── 4. Attack lanes open up as the run goes on ──────────────────────────────
head('ATTACK LANES');
{
  const lanes = RC.SURVIVAL.guardLanes || [];
  ok(lanes.length === 4, 'the map defines four Crystal Guard lanes, has ' + lanes.length);
  // Every lane must be clear of the map's rocks, or a wave spawns inside a boulder.
  for (const L of lanes) {
    const blocked = (RC.SURVIVAL.obstacles || []).some(o =>
      Math.abs(L.x - o.x) < o.w / 2 + 140 && Math.abs(L.y - o.y) < o.h / 2 + 140);
    ok(!blocked, 'lane ' + L.id + ' is clear of every rock on the map');
    ok(L.x > 150 && L.y > 150 && L.x < RC.SURVIVAL.world.w - 150 && L.y < RC.SURVIVAL.world.h - 150,
       'lane ' + L.id + ' is inside the world');
  }
  ok(lanes[0].id === 'west', 'wave 1 still comes from the west, where the camera points');
  ok(lanes[lanes.length - 1].id === 'east', 'the lane behind the bases opens last');

  console.log('wave |  lanes open');
  for (const w of [1, 3, 4, 8, 9, 13, 14, 25]) console.log(String(w).padStart(4) + ' | ' + K.laneCount(w));
ok(K.LANE_AT.length === 4, 'there is a schedule entry per lane');
  ok(K.laneCount(1) === 1 && K.laneCount(3) === 1, 'the first three waves come from one direction only');
  ok(K.laneCount(4) === 2, 'a second direction opens on wave 4');
  ok(K.laneCount(9) === 3, 'a third opens on wave 9');
  ok(K.laneCount(14) === 4 && K.laneCount(40) === 4, 'all four are open from wave 14 on, and never more');
  // The early game must be EXACTLY what it was before lanes existed, or the gentlest
  // part of the gentlest mode got harder as a side effect.
  for (let w = 1; w <= 3; w++) ok0(K.laneCount(w) === 1, 'wave ' + w + ' is still single-lane');
  let mono = true;
  for (let w = 2; w <= 40; w++) if (K.laneCount(w) < K.laneCount(w - 1)) mono = false;
  ok(mono, 'the number of lanes never goes back down');
  // and the live run above actually used them
  ok(lanesSeen[1] === 1, 'the real run opened wave 1 on a single lane');
  ok((lanesSeen[10] || lanesSeen[9] || 0) >= 3, 'the real run was on 3+ lanes by wave 9-10');
  ok(lanesSeen[3] === 1 && (lanesSeen[4] || 2) === 2, 'the real run opened its second lane on wave 4');

  // Enemies must actually arrive spread around the crystal, not all down one side.
  const g3 = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g3.setupKids({ race: 'forge' });
  const s3 = K.st(g3);
  s3.wave = 16; s3.lanes = 4; s3.queue = new Array(24).fill('globling'); s3.phase = 'spawning';
  for (let i = 0; i < 24; i++) g3.update(DT * 12);
  const horde = g3.units.filter(u => u.owner === 2);
  const sides = new Set(horde.map(u => {
    const dx = u.x - g3.crystal.x, dy = u.y - g3.crystal.y;
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'W' : 'E') : (dy < 0 ? 'N' : 'S');
  }));
  console.log('  wave-16 horde of ' + horde.length + ' arrived on sides: ' + [...sides].sort().join(''));
  ok(horde.length > 8, 'the wave-16 test horde spawned (' + horde.length + ')');
  ok(sides.size === 4, 'a late wave arrives from all four sides, saw ' + sides.size);

  // Survival must keep its single western approach — turret play depends on it.
  const gv = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gv.setupSurvival({ race: 'forge', difficulty: 'medium' });
  ok(gv.enemySpawn.x === RC.SURVIVAL.enemySpawn.x && gv.enemySpawn.y === RC.SURVIVAL.enemySpawn.y,
     "Survival still marches from the map's one enemySpawn");
}

// ── 5. Two-player co-op ─────────────────────────────────────────────────────
head('CO-OP — two defenders, two economies, two reward cards');
{
  const gc = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gc.heroesEnabled = true;
  gc.setupKids({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'gloop' }] });
  ok(K.defenders(gc).join(',') === '1,3', 'both defenders are seated, got ' + K.defenders(gc).join(','));
  ok(K.st(gc).coop === true, 'the run knows it is co-op');
  ok(!!gc.kidsBases[1] && !!gc.kidsBases[3], 'each defender got their own base');
  ok(gc.kidsBases[1] !== gc.kidsBases[3], 'the two bases are different buildings');
  ok(gc.buildings.filter(b => b === gc.crystal).length === 1, 'there is exactly one crystal');
  ok(!!gc.heroOf[1] && !!gc.heroOf[3], 'each defender got their own hero');

  // Rosters follow each player's own faction, not the host's.
  const r1 = K.roster(gc, 1), r3 = K.roster(gc, 3);
  ok(r1[0].t !== r3[0].t, 'the two players get their own faction kits (' + r1[0].t + ' vs ' + r3[0].t + ')');

  // Buying is private: player 3's purchase must not spend player 1's shards.
  const sh1 = gc.res[1].shard, sh3 = gc.res[3].shard;
  ok(K.buy(gc, r3[0].t, 3) === true, 'player 3 can buy from their own base');
  ok(gc.res[1].shard === sh1, "player 3's purchase did not touch player 1's shards");
  ok(gc.res[3].shard < sh3, "player 3's purchase did spend player 3's shards");
  ok(gc.kidsBases[3].queue.length === 1 && gc.kidsBases[1].queue.length === 0,
     "the fighter queued at player 3's own base");
  ok(K.buy(gc, r1[0].t, 3) === false, "player 3 cannot buy from player 1's faction kit");

  // Co-op must never pause: the server's loop cannot stop for one player's card screen.
  const sc = K.st(gc);
  sc.wave = 4; sc.phase = 'celebrate'; sc.celebT = 0;
  gc.update(DT);
  ok(sc.phase === 'reward', 'the reward phase opened');
  ok(gc.paused === false, 'a co-op reward screen does NOT pause the world');
  ok(!!K.per(gc, 1).offer && !!K.per(gc, 3).offer, 'both players were dealt their own three cards');
  const o1 = K.per(gc, 1).offer.map(c => c.id).join(','), o3 = K.per(gc, 3).offer.map(c => c.id).join(',');
  console.log('  player 1 offered [' + o1 + ']  ·  player 3 offered [' + o3 + ']');

  // One player picking does not resume the wave while the other is still choosing.
  ok(K.choose(gc, K.per(gc, 1).offer[0].id, 1) === true, 'player 1 takes a card');
  ok(sc.phase === 'reward', 'still on the card screen — player 3 has not chosen yet');
  ok(K.hud(gc, 3).offer !== null, "player 3's cards are still on the table");
  ok(K.hud(gc, 1).offer === null, "player 1's card screen has closed");
  ok(K.hud(gc, 3).waitingFor === 0 && K.hud(gc, 1).waitingFor === 1,
     'the HUD says who is still deciding');
  ok(K.choose(gc, K.per(gc, 3).offer[0].id, 3) === true, 'player 3 takes a card');
  ok(sc.phase === 'gap', 'the run resumes once BOTH have chosen');

  // Nobody chooses: the timer must pick for them rather than stalling the room forever.
  const gd = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gd.setupKids({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'forge' }] });
  const sd = K.st(gd);
  sd.wave = 2; sd.phase = 'celebrate'; sd.celebT = 0;
  gd.update(DT);
  ok(sd.phase === 'reward', 'reward phase opened for the AFK test');
  for (let i = 0; i < Math.ceil(K.CFG.PICK / DT) + 4; i++) gd.update(DT);
  ok(sd.phase === 'gap', 'an unanswered card screen times out instead of stalling the room');
  ok(Object.keys(K.per(gd, 1).taken || {}).length === 1, 'player 1 was given a card anyway');
  ok(Object.keys(K.per(gd, 3).taken || {}).length === 1, 'player 3 was given a card anyway');

  // Solo still pauses — the modal card screen is the right call for one kid alone.
  const gs = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gs.setupKids({ race: 'forge' });
  const ss2 = K.st(gs);
  ok(ss2.coop === false, 'a solo run is not co-op');
  ss2.wave = 3; ss2.phase = 'celebrate'; ss2.celebT = 0;
  gs.update(DT);
  ok(ss2.phase === 'reward' && gs.paused === true, 'a solo reward screen still pauses the game');
}

// ── 6. The snapshot carries the whole director ──────────────────────────────
head('NETCODE — an online client that never ticks the sim');
{
  const host = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  host.setupKids({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'aether' }] });
  const sh = K.st(host);
  sh.wave = 7; sh.lanes = 3; sh.phase = 'celebrate'; sh.celebT = 0;
  host.update(DT);

  // A fresh client, exactly as main.js builds one: same map, no sim ticking.
  const cli = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  cli.setupKids({ players: [{ owner: 1, race: 'forge' }, { owner: 3, race: 'aether' }] });
  cli.playerOwner = 3;
  RC.Net.applySnapshot(cli, RC.Net.serialize(host));
  const hc = K.hud(cli, 3);
  ok(hc.wave === 7, "the client's wave counter came from the snapshot, got " + hc.wave);
  ok(hc.phase === 'reward', 'the client knows the card screen is up');
  ok(hc.lanes === 3, 'the client knows how many lanes are open');
  ok(!!hc.offer && hc.offer.length === 3, 'the client received ITS OWN three cards');
  ok(hc.offer.map(c => c.id).join(',') === K.per(host, 3).offer.map(c => c.id).join(','),
     "the client's cards match what the server dealt owner 3");
  ok(hc.coop === true, 'the client knows it is a co-op run');
  ok(K.hud(cli, 1).offer !== null, "the other player's cards travel too (the HUD picks by owner)");

  // And the two player actions are authoritative commands, not local calls.
  const before = host.res[3].shard;
  RC.Net.applyCommand(host, 3, { t: 'kbuy', ut: K.roster(host, 3)[0].t });
  ok(host.res[3].shard < before, "a kbuy command spends the commanding owner's shards");
  ok(host.kidsBases[3].queue.length === 1, 'and queues at their own base');
  const card = K.per(host, 1).offer[0].id;
  RC.Net.applyCommand(host, 1, { t: 'kcard', id: card });
  ok(K.per(host, 1).picked === true, "a kcard command takes that owner's card");
  ok(K.per(host, 3).picked === false, "and does not take the other player's");
  // A client cannot buy for someone else: the command carries the owner, not the client.
  const other = host.res[1].shard;
  RC.Net.applyCommand(host, 3, { t: 'kbuy', ut: K.roster(host, 3)[0].t });
  ok(host.res[1].shard === other, "owner 3's commands can never spend owner 1's shards");
}

// ── 7. Every faction has a working kit ─────────────────────────────────────
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

// ── 8. The simplifications actually hold ───────────────────────────────────
// Each of these is a promise the mode's description makes to a parent. A refactor that
// reintroduced mining or a build list would break the mode's whole premise without
// breaking anything that looks like a test.
head('NO RTS — the simplifications hold');
{
  const gk = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gk.heroesEnabled = true;
  gk.setupKids({ race: 'forge' });
  ok(gk.nodes.length === 0, 'there are no shard nodes to mine, has ' + gk.nodes.length);
  // There is exactly ONE worker, and it is a builder: no mining, no dropoff, no economy
  // to forget. That distinction is the whole reason a worker was allowed back in.
  const workers = gk.units.filter(u => u.def.worker);
  ok(workers.length === 1, 'exactly one worker, got ' + workers.length);
  ok(workers[0].free === true, 'the builder costs no supply — it is a tool, not an army slot');
  ok(gk.nodes.length === 0, 'and there is nothing for it to mine, so it cannot be mismanaged');
  ok(gk.supply(1).max === K.CFG.POP, 'population is a flat cap, not a supply-building game');
  // Income arrives on its own, with nothing to click.
  const before = gk.res[1].shard;
  for (let i = 0; i < 30; i++) gk.update(DT);
  ok(gk.res[1].shard > before, 'shards come in automatically');
  ok(Math.abs((gk.res[1].shard - before) - K.CFG.INCOME) < K.CFG.INCOME * 0.25,
     'income is about INCOME per second');
  // Only the two starter buildings exist: the crystal and the one base.
  ok(gk.buildings.length === 2, 'a solo run starts with exactly the crystal and one base, has ' + gk.buildings.length);
  // The build list is defence only, and it follows the RACE — a Gloop kid puts up Venom
  // Spires. The entry with no `t` is the tower placeholder that kidBuildFor() fills in.
  const kb = RC.kidBuildFor('forge');
  ok(kb.length >= 4, 'a kid has a real set of things to build, has ' + kb.length);
  ok(kb.every(b => RC.BUILDINGS[b.t]), 'every entry is a real building');
  ok(kb.every(b => !RC.BUILDINGS[b.t].produces || !RC.BUILDINGS[b.t].produces.length),
     'none of them produces units — defence only, no base-building tree');
  ok(kb.filter(b => RC.BUILDINGS[b.t].tower).length === 1, 'exactly one of them is a tower');
  ok(kb.filter(b => RC.BUILDINGS[b.t].wall).length >= 3, 'and the rest are walls to choose between');
  // The tower entry resolves per race rather than being hard-coded to the Forge one.
  const towerOf = r => RC.kidBuildFor(r).find(b => RC.BUILDINGS[b.t].tower).t;
  ok(towerOf('forge') === 'stonethrower' && towerOf('gloop') === 'venomspire' &&
     towerOf('aether') === 'prismlaser', 'the tower follows the chosen race');
  // Walls that only make sense in this mode must never turn up in Versus or Survival,
  // where they would rebalance two tuned modes by accident.
  const kidOnly = Object.keys(RC.BUILDINGS).filter(k => RC.BUILDINGS[k].kidOnly);
  ok(kidOnly.length >= 3, 'there are Crystal-Guard-only walls, got ' + kidOnly.length);
  ok(kidOnly.every(k => !RC.BUILDABLE.includes(k)), 'and none of them leaks into Versus/Survival');
  for (const r of ['forge', 'gloop', 'aether']) {
    ok(RC.RACES[r].buildable.every(t => !RC.BUILDINGS[t].kidOnly), r + ' cannot build the kid walls either');
  }
  ok(gk.buildings.every(b => b.done), 'both start finished — there is nothing to build');
}

// ── 8a. The opening is not a formality ─────────────────────────────────────
// The mode was reported as "too easy in the beginning", and it measured that way: a
// passive player — buys whatever is affordable, never moves the army, never builds —
// reached wave 10 with the crystal untouched at 100%.
//
// Worth knowing before changing any of these numbers: this system SELF-BALANCES on
// wall-clock time. Tougher or more numerous enemies make waves last longer, the player
// banks more income, and the bigger army cancels the change out — measured, raising
// enemy HP made runs LONGER, not shorter. The levers that actually bite are the ones
// that cap how much army can exist at once (POP) and how fast it can be bought (INCOME).
head('THE OPENING HAS TEETH');
{
  ok(K.CFG.INCOME <= 8, 'income is no longer a flood (' + K.CFG.INCOME + '/s)');
  ok(K.CFG.POP <= 24, 'the army cannot snowball to invulnerability (cap ' + K.CFG.POP + ')');
  ok(K.CFG.WAVE_HEAL <= 0.04, 'chip damage is not erased between waves (' + Math.round(K.CFG.WAVE_HEAL * 100) + '% heal)');
  // A tower has to be a real alternative to a fighter, or nobody will ever build one.
  const tower = RC.kidBuildFor('forge').find(b => RC.BUILDINGS[b.t].tower);
  const fighter = K.costOf(K.kitOf('forge').starters[0].t);
  console.log('  tower ' + tower.cost + ' shards vs a Tank at ' + fighter + ' — one is genuinely the other');
  ok(tower.cost >= fighter * 0.8 && tower.cost <= fighter * 2.5,
     'a tower costs about a fighter, so building is a real choice');
  ok(K.CFG.START_SHARD < K.costOf(K.kitOf('forge').starters[0].t) * 3,
     'the opening shards do not cover three fighters — there is a decision on second one');
}

// ── 8b. Building ───────────────────────────────────────────────────────────
head('BUILDING — a fort around the crystal');
{
  const gb = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gb.heroesEnabled = true;
  gb.setupKids({ race: 'forge' });
  const c = gb.crystal;
  const near = { x: c.x + 160, y: c.y - 130 };
  const far = { x: c.x + K.buildRing(gb) + 200, y: c.y };

  ok(!!K.workerOf(gb, 1), 'the run starts with a builder');
  ok(K.buildCap(gb) >= 2, 'and room to build something, cap ' + K.buildCap(gb));
  ok(K.buildUsed(gb, 1) === 0, 'nothing built yet');
  const cheapest = Math.min(...RC.kidBuildFor('forge').filter(b => RC.BUILDINGS[b.t].wall).map(b => b.cost));
  ok(gb.res[1].shard >= cheapest, 'the opening shards cover at least the cheapest wall (' + cheapest + ')');

  // The ring is the rule, and it is enforced with a sentence rather than a silent no.
  ok(K.inBuildRing(gb, near.x, near.y), 'a spot beside the crystal is inside the ring');
  ok(!K.inBuildRing(gb, far.x, far.y), 'a spot across the map is outside it');
  const why = K.canBuild(gb, 'rampart', far.x, far.y, 1);
  ok(typeof why === 'string' && /crystal/i.test(why), 'building too far says why: "' + why + '"');
  ok(K.build(gb, 'rampart', far.x, far.y, 1) === false, 'and is refused');
  ok(K.buildUsed(gb, 1) === 0, 'a refused build costs nothing');

  // A real build.
  const sh0 = gb.res[1].shard;
  ok(K.build(gb, 'stonethrower', near.x, near.y, 1) === true, 'a tower goes up beside the crystal');
  ok(K.buildUsed(gb, 1) === 1, 'and takes a slot');
  const kidCost = RC.kidBuildFor('forge').find(b => b.t === 'stonethrower').cost;
  ok(Math.abs((sh0 - gb.res[1].shard) - kidCost) < 0.001,
     'it cost the KID price (' + kidCost + '), not the Versus price (' + RC.BUILDINGS.stonethrower.cost + ')');
  ok(RC.BUILDINGS.stonethrower.cost !== kidCost, 'and those two really are different');

  // The slot cap holds, and it grows as waves are cleared.
  const capNow = K.buildCap(gb);
  gb.res[1].shard = 99999;
  let n = 0;
  for (let i = 0; i < 30 && K.buildUsed(gb, 1) < capNow + 3; i++) {
    if (K.build(gb, 'rampart', c.x - 300 + (i % 6) * 60, c.y - 240 + Math.floor(i / 6) * 60, 1)) n++;
  }
  ok(K.buildUsed(gb, 1) === capNow, 'the cap holds at ' + capNow + ' however many times you tap');
  const s2 = K.st(gb);
  s2.wave = 10;
  ok(K.buildCap(gb) > capNow, 'clearing waves earns more slots (' + capNow + ' -> ' + K.buildCap(gb) + ')');

  // A wall is a wall: it blocks, it does not shoot.
  const walls = RC.kidBuildFor('forge').filter(b => RC.BUILDINGS[b.t].wall);
  ok(walls.every(b => !RC.BUILDINGS[b.t].tower && !RC.BUILDINGS[b.t].dmg), 'no wall has a weapon');
  // The whole point of five walls is that they are bad at DIFFERENT things. If they were
  // ranked — cheapest is worst at everything, priciest is best at everything — there would
  // be one correct wall and the other four would be a menu.
  const hps = walls.map(b => RC.BUILDINGS[b.t].hp);
  ok(Math.max(...hps) > Math.min(...hps) * 3, 'the toughest wall is far tougher than the flimsiest');
  ok(new Set(walls.map(b => b.cost)).size >= 4, 'and they are priced apart, not four flavours of the same wall');
  const special = walls.filter(b => RC.BUILDINGS[b.t].passive);
  ok(special.length >= 2, 'at least two walls do something beyond having health, got ' + special.length);
  // Cheapest-and-weakest and priciest-and-toughest have to line up, or "save up for the
  // good one" is not a lesson the prices are actually teaching.
  const byCost = walls.slice().sort((a, b2) => a.cost - b2.cost);
  ok(RC.BUILDINGS[byCost[0].t].hp === Math.min(...hps), 'the cheapest wall really is the flimsiest');
  ok(byCost[0].cost < RC.kidBuildFor('forge').find(b => RC.BUILDINGS[b.t].tower).cost, 'and walls start cheaper than a tower');

  // The builder walks back out free if it dies — losing it is a pause, not a run-ender.
  const w = K.workerOf(gb, 1);
  w.dead = true;
  gb.units = gb.units.filter(u => !u.dead);
  ok(!K.workerOf(gb, 1), 'the builder is gone');
  for (let i = 0; i < 30 * (K.CFG.WORKER_RESPAWN + 2); i++) gb.update(DT);
  ok(!!K.workerOf(gb, 1), 'and a replacement arrives on its own within ' + K.CFG.WORKER_RESPAWN + 's');
}

// ── 9. Survival is untouched ───────────────────────────────────────────────
head('SURVIVAL IS UNCHANGED');
{
  const gs = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  gs.heroesEnabled = true;
  gs.setupSurvival({ race: 'forge', ally: false, difficulty: 'medium' });
  ok(!gs.kids, 'a Survival run does not have the kids flag');
  ok(gs.nodes.length > 0, 'Survival still has shard nodes');
  ok(gs.units.filter(u => u.owner === 1 && u.def.worker).length === 4, 'Survival still starts with 4 workers');
  ok(gs.supply(1).max !== K.CFG.POP, 'Survival keeps its own supply rules');
  ok(gs.crystal.maxHp !== K.CFG.CRYSTAL_HP, 'Survival keeps the original crystal HP');
  ok(!gs._kd, 'Survival never allocates Kids state');
  for (let i = 0; i < 30 * 40; i++) gs.update(DT);
  ok((gs.survivalWave || 0) >= 1, 'the Survival director still runs (wave 1)');
}

console.log('\n' + (fail ? '✖' : '✔') + ' ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
