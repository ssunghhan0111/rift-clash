// Each hero's SIGNATURE ability is mechanically distinct — not three renames of one
// shared engine. This drives the real RC.Unit.cast on real heroes and asserts the
// behaviour that makes each one a different ANSWER to the same problem:
//
//   Rook    'dome'     HOLD ON      — puts a guard pool on the thing being defended.
//                                       Creates no units and deals no damage.
//   Thorn 'brood'    MORE BODIES  — hatches free, expiring fighters at the fight.
//                                       Grants no guard and deals no damage itself.
//   Prism    'riftnova' MAKE SPACE   — damages and hurls enemies away from the OBJECTIVE
//                                       (not away from the hero). Creates nothing.
//
// If a refactor ever collapsed them back into "three area-damage abilities with different
// icons", the cross-checks in the middle are what fail: each hero is asserted to do its own
// thing AND to not do the other two's.
//
// The signature sits at slot R of a three-button kit. Q and E are the TACTICAL pair: they
// run on energy plus a cooldown so they are pressed constantly, while R runs on the charge
// meter so it is the one thing worth saving. This suite covers both currencies, and both
// routes by which the nine signature upgrades are earned (reward cards in Crystal Guard,
// levels everywhere else).
const path = require('path');
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'keep', 'survival', 'kids', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
function head(s) { console.log('\n' + s); }

function makeGame() {
  const g = new RC.Game();
  g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.over = null;
  g.teamMap = { 1: 0, 2: 1 };        // owner 1 vs owner 2 — enemies
  return g;
}
function hero(g, type, x, y, lvl) {
  const h = new RC.Unit(type, x, y, 1);
  h.level = lvl || 1; h.facing = 0;
  h.charge = 1; h.sigCd = 0;         // fully charged; the economy is tested separately
  g.units.push(h);
  return h;
}
function enemy(g, x, y) { const e = new RC.Unit('volt', x, y, 2); g.units.push(e); return e; }
// A crystal to defend, so the abilities have an objective to reason about.
function crystal(g, x, y) {
  const b = new RC.Building('crystal', x, y, 1, true);
  g.buildings.push(b); g.crystal = b;
  return b;
}

// ── Every hero has exactly one signature ───────────────────────────────────
head('One signature per hero, and the old panel is gone');
{
  const defs = ['rook', 'thorn', 'prism'].map(t => RC.UNITS[t]);
  for (const d of defs) {
    ok(!!d.sig, d.name + ' has a signature ability');
    // ── The three-button kit ──
    ok((d.skills || []).length === 3, d.name + ' has a three-button kit, has ' + (d.skills || []).length);
    ok(d.skills[2] === d.sig, d.name + ' slot R IS the signature — the same object, not a copy');
    ok(d.skills[2].ult === true, d.name + ' slot R is flagged as the ultimate');
    ok(d.skills.slice(0, 2).every(s => !s.ult), d.name + ' Q and E are not ultimates');
    ok(d.skills.map(s => s.key).join('') === 'QER', d.name + ' kit is bound to Q/E/R, got ' + d.skills.map(s => s.key).join(''));
    ok(d.skills.slice(0, 2).every(s => s.cost > 0 && s.cd > 0),
       d.name + ' Q and E both cost energy AND take a cooldown — two brakes, not one');
    ok(d.sig.cost == null && d.sig.cd == null,
       d.name + ' the ultimate has neither, because it runs on the charge meter instead');
    ok(d.skills.every(s => s.kid && s.kid.length < 70 && s.ic && s.desc),
       d.name + ' every button has an icon, a kid line and a grown-up line');
    ok(new Set(d.skills.map(s => s.id)).size === 3, d.name + ' its three ability ids are distinct');
    ok(!!d.sig.kid && d.sig.kid.length < 60, d.name + ' has a short kid-facing line: "' + d.sig.kid + '"');
    ok((d.sig.ups || []).length === 3, d.name + ' has three upgrades, has ' + (d.sig.ups || []).length);
    ok(new Set(d.sig.ups.map(u => u.id)).size === 3, d.name + ' upgrade ids are distinct');
    ok(d.sig.ups.every(u => u.kid && u.ic), d.name + ' every upgrade has a kid line and an icon');
  }
  const ids = defs.map(d => d.sig.id);
  ok(new Set(ids).size === 3, 'the three signatures are different abilities: ' + ids.join(', '));
  ok(new Set(defs.map(d => d.sig.key)).size === 1, 'they all share one hotkey, so there is one key to learn');
  // Every id in the game reaches the same switch in _applyAbility, and a DUPLICATE case
  // label there is silently unreachable rather than an error — which is exactly how this
  // broke the first time ('riftnova' had to be renamed off the Spitter's old 'nova').
  const allSkillIds = defs.flatMap(d => d.skills.map(s => s.id));
  ok(new Set(allSkillIds).size === allSkillIds.length,
     'no two abilities anywhere share an id (' + allSkillIds.join(',') + ')');
  // And nothing outside a hero can reach that switch at all: units are passive-only now.
  const casters = Object.keys(RC.UNITS).filter(k => RC.UNITS[k].ability);
  ok(casters.length === 0, 'no unit has a castable ability any more, found [' + casters.join(',') + ']');
}

// ── Rook — Bulwark: a guard pool on the objective ────────────────────────
head('Rook — Bulwark (hold on)');
{
  const g = makeGame();
  const c = crystal(g, 1000, 1000);
  const h = hero(g, 'rook', 1100, 1000, 5);
  ok(h.def.sig.id === 'dome', 'Rook signature is the dome');
  ok(!c.guard, 'the crystal starts unguarded');
  ok(h.cast(g, 'r') === true, 'the dome fires');
  ok(!!c.guard && c.guard.hp > 0, 'the crystal now has a guard pool of ' + Math.round((c.guard || {}).hp || 0));
  ok(c.guard.t > 0, 'and it is on a timer (' + c.guard.t + 's)');
  // The pool has to actually absorb — a shield that does not soak is a decal.
  const hp0 = c.hp, pool = c.guard.hp;
  g.hurt(c, 200, 2, null);
  ok(c.hp === hp0, 'damage hit the dome, not the crystal');
  ok(c.guard.hp < pool, 'and the dome pool went down (' + Math.round(pool) + ' -> ' + Math.round(c.guard.hp) + ')');
  // It expires.
  for (let i = 0; i < 30 * 12; i++) c.update(1 / 30, g);
  ok(!c.guard, 'the dome expires on its own');
  const hp1 = c.hp;
  g.hurt(c, 200, 2, null);
  ok(c.hp < hp1, 'and once it is gone the crystal takes damage again');
}

// ── Thorn — Hatch the Brood: free, expiring bodies ─────────────────────
head('Thorn — Hatch the Brood (more bodies)');
{
  const g = makeGame();
  crystal(g, 1000, 1000);
  const h = hero(g, 'thorn', 1100, 1000, 5);
  for (let i = 0; i < 6; i++) enemy(g, 700 + i * 18, 1000);
  ok(h.def.sig.id === 'brood', 'Thorn signature is the brood');
  const mine0 = g.units.filter(u => u.owner === 1).length;
  ok(h.cast(g, 'r') === true, 'the brood hatches');
  const hatchlings = g.units.filter(u => u.owner === 1 && u.summoned);
  ok(hatchlings.length >= 4, 'it hatched ' + hatchlings.length + ' fighters');
  ok(g.units.filter(u => u.owner === 1).length > mine0, 'the army actually grew');
  ok(hatchlings.every(u => u.free), 'hatchlings are free — they cost no supply');
  ok(hatchlings.every(u => u.temp > 0), 'and they expire rather than being permanent');
  // They arrive AT the fight, not on top of the hero — that is the auto-targeting.
  const foe = g.units.find(u => u.owner === 2);
  const dHero = hatchlings.reduce((a, u) => a + RC.dist(u.x, u.y, h.x, h.y), 0) / hatchlings.length;
  const dFoe = hatchlings.reduce((a, u) => a + RC.dist(u.x, u.y, foe.x, foe.y), 0) / hatchlings.length;
  console.log('    mean distance to hero ' + Math.round(dHero) + 'px vs to the enemy clump ' + Math.round(dFoe) + 'px');
  ok(dFoe < dHero, 'they hatch at the enemy clump, not under the hero');
}

// ── Prism — Rift Nova: damage + a shove away from the objective ───────────
head('Prism — Rift Nova (make space)');
{
  const g = makeGame();
  const c = crystal(g, 1000, 1000);
  const h = hero(g, 'prism', 1000, 1120, 5);
  // Enemies pressing the crystal from the far side of the hero.
  const es = [enemy(g, 880, 1000), enemy(g, 900, 1020), enemy(g, 915, 980), enemy(g, 890, 1040)];
  const hp0 = es.map(e => e.hp);
  const d0 = es.map(e => RC.dist(c.x, c.y, e.x, e.y));
  ok(h.def.sig.id === 'riftnova', 'Prism signature is the rift nova');
  ok(h.cast(g, 'r') === true, 'the nova fires');
  ok(es.every((e, i) => e.hp < hp0[i]), 'every enemy in the blast took damage');
  const pushed = es.filter((e, i) => RC.dist(c.x, c.y, e.x, e.y) > d0[i] + 1).length;
  ok(pushed === es.length, 'all ' + es.length + ' were shoved AWAY FROM THE CRYSTAL, not away from the hero');
  ok(es.every(e => e.slow > 0), 'and left reeling');
}

// ── The three are genuinely different engines ──────────────────────────────
head('The three signatures do not overlap');
{
  const seen = {};
  for (const type of ['rook', 'thorn', 'prism']) {
    const g = makeGame();
    const c = crystal(g, 1000, 1000);
    const h = hero(g, type, 1080, 1000, 5);
    const es = [enemy(g, 900, 1000), enemy(g, 920, 1020), enemy(g, 880, 985), enemy(g, 905, 1045)];
    const hp0 = es.map(e => e.hp);
    const n0 = g.units.length;
    h.cast(g, 'r');
    seen[type] = {
      guard: !!c.guard,
      spawned: g.units.length - n0,
      damaged: es.filter((e, i) => e.hp < hp0[i]).length,
    };
  }
  console.log('    ' + Object.keys(seen).map(k =>
    k + '{guard:' + (seen[k].guard ? 'Y' : 'n') + ' spawned:' + seen[k].spawned + ' damaged:' + seen[k].damaged + '}').join('  '));
  ok(seen.rook.guard && !seen.thorn.guard && !seen.prism.guard, 'ONLY Rook creates a guard');
  ok(seen.thorn.spawned > 0 && seen.rook.spawned === 0 && seen.prism.spawned === 0, 'ONLY Thorn creates units');
  ok(seen.prism.damaged > 0 && seen.rook.damaged === 0 && seen.thorn.damaged === 0, 'ONLY Prism deals damage');
}

// ── The charge economy ─────────────────────────────────────────────────────
head('Charge — fills by fighting, faster than by waiting');
{
  const DT = 1 / 30;
  const g1 = makeGame();
  const h1 = hero(g1, 'rook', 1000, 1000, 1);
  h1.charge = 0;
  let idle = 0;
  while (h1.charge < 1 && idle < 300) { h1.update(DT, g1); idle += DT; }
  ok(idle > 60, 'idling alone takes a long time to charge (' + idle.toFixed(0) + 's)');
  ok(Math.abs(idle - 1 / RC.HERO.chargeIdle) < 3, 'and it matches the configured idle rate');

  // Taking damage charges it too — the defensive hero must not be punished for defending.
  const g2 = makeGame();
  const h2 = hero(g2, 'rook', 1000, 1000, 1);
  h2.charge = 0;
  g2.hurt(h2, 400, 2, null);
  ok(h2.charge > 0, 'taking a hit charges the signature (' + h2.charge.toFixed(3) + ')');

  // Dealing damage charges it fastest.
  const g3 = makeGame();
  const h3 = hero(g3, 'rook', 1000, 1000, 1);
  h3.charge = 0;
  const foe = enemy(g3, 1020, 1000);
  foe.maxHp = foe.hp = 1e6;
  h3.engage(foe);
  let fight = 0;
  while (h3.charge < 1 && fight < 300) { h3.update(DT, g3); fight += DT; }
  console.log('    idle ' + idle.toFixed(0) + 's  ·  fighting ' + fight.toFixed(0) + 's');
  ok(fight < idle * 0.75, 'a hero in a real fight charges much faster than one standing still');

  // Spending empties it, and the lockout stops a double-tap firing twice.
  const g4 = makeGame();
  crystal(g4, 1000, 1000);
  const h4 = hero(g4, 'rook', 1050, 1000, 1);
  ok(h4.sigReady(), 'a full hero is ready');
  ok(h4.cast(g4, 'r') === true, 'it fires');
  ok(h4.charge === 0, 'and the charge is spent');
  ok(h4.sigReady() === false, 'it is not immediately ready again');
  h4.charge = 1;
  ok(h4.sigReady() === false, 'even at full charge the post-cast lockout still holds');
  ok(h4.cast(g4, 'r') === false, 'so a double-tap cannot fire it twice');
  for (let i = 0; i < 30 * 3; i++) h4.update(1 / 30, g4);
  ok(h4.sigReady() === true, 'and it comes back once the lockout passes');

  // A downed hero has nothing to press.
  const g5 = makeGame();
  crystal(g5, 1000, 1000);
  const h5 = hero(g5, 'rook', 1050, 1000, 1);
  h5.downed = true;
  ok(h5.sigReady() === false && h5.cast(g5, 'r') === false, 'a downed hero cannot cast');
}

// ── The tactical pair: Q and E ─────────────────────────────────────────────
// The ultimate has its own economy and its own suite above. These two share a different
// one — energy plus a cooldown — and the point of testing them separately is that the two
// economies must not leak into each other: spending Q must never touch the charge meter,
// and a full charge meter must never make Q free.
head('Q and E — energy plus a cooldown, and nothing to do with the charge meter');
{
  const g = makeGame();
  crystal(g, 1000, 1000);
  const h = hero(g, 'rook', 1050, 1000, 1);
  const q = h.def.skills[0], e = h.def.skills[1];
  for (let i = 0; i < 8; i++) enemy(g, 1000 + i * 12, 1010);   // something to hit

  h.energy = h.maxEnergy; h.charge = 1;
  ok(h.skillReady(q), 'a full hero can press Q');
  const charge0 = h.charge;
  ok(h.cast(g, 'q') === true, 'Q fires');
  ok(h.charge === charge0, 'and it did NOT spend the ultimate\'s charge');
  ok(h.energy < h.maxEnergy, 'it spent energy instead (' + Math.round(h.energy) + '/' + h.maxEnergy + ')');
  ok(h.skillCd[q.id] > 0, 'and it went on cooldown (' + h.skillCd[q.id] + 's)');
  ok(h.skillReady(q) === false && h.cast(g, 'q') === false, 'so it cannot be pressed again straight away');

  // Energy alone is not enough — the cooldown is a second, independent brake.
  h.energy = h.maxEnergy;
  ok(h.skillReady(q) === false, 'refilling energy does not skip the cooldown');
  h.skillCd[q.id] = 0;
  h.energy = (q.cost || 0) - 1;
  ok(h.skillReady(q) === false, 'and clearing the cooldown does not conjure the energy');
  ok(h.charge === charge0, 'a full charge meter never pays for Q either');

  // The ultimate is unaffected by any of that.
  ok(h.sigReady() === true, 'pressing Q left the ultimate ready — the two economies are separate');

  // Cooldowns tick down on their own.
  h.skillCd[q.id] = 2; h.energy = h.maxEnergy;
  for (let i = 0; i < 30 * 3; i++) h.update(1 / 30, g);
  ok((h.skillCd[q.id] || 0) === 0 && h.skillReady(q), 'a cooldown runs out by itself');

  // Level scaling reaches Q and E, not just the signature.
  const lo = hero(makeGame(), 'rook', 0, 0, 1).effSkill(q);
  const hi = hero(makeGame(), 'rook', 0, 0, 10).effSkill(q);
  ok(hi.dmg > lo.dmg, 'Q hits harder at level 10 than at level 1 (' + lo.dmg + ' -> ' + hi.dmg + ')');

  // A downed hero has no buttons at all, not just no ultimate.
  const gd = makeGame(); crystal(gd, 1000, 1000);
  const hd = hero(gd, 'rook', 1050, 1000, 1);
  hd.downed = true;
  ok(hd.def.skills.every(sk => hd.skillReady(sk) === false), 'a downed hero cannot press anything');
}

// ── Crystal Shockwave — the objective is the origin ────────────────────────
// The Rook's E is Bulwark's twin and has to obey Bulwark's rule: it is measured from the
// CRYSTAL, never from the hero. Shoving away from the hero scatters enemies wherever the
// hero happens to be standing; shoving away from the objective always clears the thing you
// are defending, which is the entire reason to press it.
head('Rook — Hold the Line (the banner is aimed at where the player STANDS)');
{
  // Hold the Line replaced Crystal Shockwave, which was measured from the crystal and
  // so answered the same question as Bulwark. The banner answers a different one, and
  // these assertions are what keep the two buttons from collapsing back together:
  // it buffs the ARMY, it is centred on the HERO, and it grants no guard.
  const g = makeGame();
  const c = crystal(g, 1000, 1000);
  const h = hero(g, 'rook', 1400, 1000, 5);
  h.energy = h.maxEnergy;
  const mate = new RC.Unit('volt', 1420, 1000, 1);   // ally, standing with the hero
  g.units.push(mate);
  const foe = enemy(g, 1440, 1000);
  const far = enemy(g, 1000, 1000);                  // way off by the crystal

  ok(h.cast(g, 'e') === true, 'the banner plants');
  ok((g.hazards || []).some(z => z.kind === 'banner'), 'and it leaves a hazard on the ground');
  const z = g.hazards.find(zz => zz.kind === 'banner');
  ok(Math.hypot(z.x - h.x, z.y - h.y) < 1, 'centred on the HERO, not on the crystal');

  g._tickHazards(0.1);
  ok(mate.auraArmor > 0 && mate.auraArmorT > 0, 'allies inside gain armour');
  ok(foe.slow > 0, 'enemies inside are slowed');
  ok(!far.slow, 'and an enemy outside the radius is untouched');
  ok(!c.guard, 'it grants no shield — that is Bulwark\'s job, and they must stay different');

  // Non-stacking, and it comes for free: the banner writes the SAME auraArmor field the
  // Shielder's aura does, so two sources give you the better one rather than the sum.
  const before = mate.auraArmor;
  const drop = new RC.Unit('shielder', 1420, 1010, 1);
  g.units.push(drop);
  g._tickHazards(0.1);
  ok(mate.auraArmor === before, 'a second armour source does not stack — strongest wins');

  // A field-buff button must fire on empty ground: it is not aimed at anyone, and a
  // version that refused without a target could not be used to PREPARE for a push.
  const g2 = makeGame();
  crystal(g2, 1000, 1000);
  const h2 = hero(g2, 'rook', 1050, 1000, 5);
  h2.energy = h2.maxEnergy;
  ok(h2.cast(g2, 'e') === true, 'it plants on empty ground too');
  ok(h2.energy < h2.maxEnergy, 'and it paid for it');

  // It expires on its own, and the buff falls off with it.
  const g3 = makeGame();
  const h3 = hero(g3, 'rook', 1000, 1000, 5);
  h3.energy = h3.maxEnergy;
  const m3 = new RC.Unit('volt', 1010, 1000, 1); g3.units.push(m3);
  h3.cast(g3, 'e');
  const dur = RC.UNITS.rook.skills[1].dur;
  for (let i = 0; i < Math.ceil(dur / 0.1) + 2; i++) g3._tickHazards(0.1);
  ok(!(g3.hazards || []).some(zz => zz.kind === 'banner'), 'the banner expires after ' + dur + 's');
}

// ── Upgrades: two routes, never both ───────────────────────────────────────
head('Upgrades — cards in Crystal Guard, levels everywhere else');
{
  const g = makeGame();
  const h = hero(g, 'prism', 1000, 1000, 1);
  const ups = h.def.sig.ups;
  ok(!h.hasUp(ups[0].id), 'a level-1 hero has no upgrades');
  h.level = RC.HERO.upLevels[0];
  ok(h.hasUp(ups[0].id), 'the first unlocks at level ' + RC.HERO.upLevels[0]);
  ok(!h.hasUp(ups[2].id), 'but not the third');
  h.level = RC.HERO.upLevels[2];
  ok(h.hasUp(ups[2].id), 'the third unlocks at level ' + RC.HERO.upLevels[2]);

  // Cards: Crystal Guard turns the level route OFF so nothing is earned twice.
  const g2 = makeGame();
  const h2 = hero(g2, 'prism', 1000, 1000, 10);
  h2.useCardUpgrades();
  ok(!h2.hasUp(ups[0].id), 'with cards in play a level-10 hero starts with nothing');
  h2.grantUp(ups[1].id);
  ok(h2.hasUp(ups[1].id) && !h2.hasUp(ups[0].id), 'and gets exactly the one card it was given');

  // Every upgrade has to change the numbers, or it is a card that does nothing.
  for (const type of ['rook', 'thorn', 'prism']) {
    const base = hero(makeGame(), type, 0, 0, 5);
    base.useCardUpgrades();
    const b = base.effSig();
    for (const up of base.def.sig.ups) {
      const t = hero(makeGame(), type, 0, 0, 5);
      t.useCardUpgrades(); t.grantUp(up.id);
      const e = t.effSig();
      const changed = Object.keys(e).some(k => k !== 'held' && JSON.stringify(e[k]) !== JSON.stringify(b[k]));
      ok(changed, type + ' / ' + up.name + ' actually changes the ability');
    }
  }
}

// ── Crystal Guard surfaces it ──────────────────────────────────────────────
head('Crystal Guard — the button and the cards');
{
  const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g.heroesEnabled = true;
  g.setupKids({ race: 'gloop' });
  const K = RC.Kids;
  const h = g.heroOf[1];
  ok(!!h && !!h.def.sig, 'a Crystal Guard run gives the player a hero with a signature');
  const hud = K.hud(g, 1);
  ok(!!hud.sig, 'the HUD carries the signature');
  ok(hud.sig.ic === h.def.sig.ic && hud.sig.charge === 0 && hud.sig.ready === false, 'and it starts uncharged');
  h.charge = 1;
  ok(K.hud(g, 1).sig.ready === true, 'a full charge reads as ready');

  // The hero's three upgrades appear as cards, and only that hero's.
  const cards = K.heroCards(g, 1);
  ok(cards.length === 3, 'three hero cards, got ' + cards.length);
  ok(cards.every(c => c.hero), 'they are flagged as hero cards so the screen can style them');
  // The cards offered are THIS hero's, whichever race the player picked — that is the
  // decoupling working. It used to assert the opposite (a Gloop player never sees Rook's
  // cards) because the race chose the hero; now the player does.
  const mine = h.def.sig.ups.map(u => 'sig_' + u.id);
  ok(cards.every(c => mine.includes(c.id)), 'the cards are the deployed hero\'s own, not the race\'s');

  // Taking one grants the upgrade through the card route.
  const s = K.st(g);
  s.phase = 'reward';
  K.per(g, 1).offer = cards.map(c => ({ id: c.id, ic: c.ic, name: c.name, desc: c.desc, tier: 1, max: 1, hero: true }));
  K.per(g, 1).picked = false;
  const pick = cards[0];
  ok(K.choose(g, pick.id, 1) === true, 'the card can be taken');
  ok(h.hasUp(pick.up), 'and it granted ' + pick.name + ' to the hero');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
