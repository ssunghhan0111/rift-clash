// Unit passives — the system that replaced every castable unit ability.
//
// The whole design rests on one claim: a unit's ability should happen because the unit is
// there and fighting, not because someone clicked it. That claim is only true if the
// passives actually FIRE without anyone asking, so almost every check here drives the real
// _hit / _passiveAura on real units and asserts the state that came out the other side.
//
// The rest of the suite is about the ways this kind of system goes wrong, each of which
// this codebase has already hit at least once:
//   · a healing aura that heals other healers becomes an immortal blob (kids waves 11 -> 7)
//   · lifesteal that drinks from buildings makes a swarm on your base unkillable
//   · a chain that arcs off its own arc, or thorns that reflect thorns, recurses forever
//   · a cosmetic drawn with Math.random() silently reshuffles the seeded sim
const path = require('path');
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'kids', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
function head(s) { console.log('\n' + s); }

const DT = 1 / 30;
function makeGame() {
  const g = new RC.Game();
  g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.over = null;
  g.teamMap = { 1: 0, 2: 1 };            // owner 1 vs owner 2 — enemies
  return g;
}
function unit(g, type, x, y, owner) {
  const u = new RC.Unit(type, x, y, owner == null ? 1 : owner);
  u.facing = 0;
  g.units.push(u);
  return u;
}
function bld(g, type, x, y, owner) {
  const b = new RC.Building(type, x, y, owner == null ? 1 : owner, true);
  g.buildings.push(b);
  return b;
}
// A unit with an arbitrary passive bolted on, so a mechanic can be tested without
// dragging in whatever else the real unit that carries it happens to do.
function withPassive(g, type, p, x, y, owner) {
  const u = unit(g, type, x, y, owner);
  u.def = Object.assign({}, u.def, { passive: p });
  return u;
}

// ── The catalogue is complete and reachable ────────────────────────────────
// A passive whose id the engine does not handle is invisible: no error, no effect, and a
// unit description that promises something the game never does.
head('Every unit has a passive, and every passive is real');
{
  const units = Object.keys(RC.UNITS);
  const missing = units.filter(k => !RC.UNITS[k].passive);
  ok(missing.length === 0, 'every unit has a passive, missing [' + missing.join(',') + ']');

  const unknown = units.filter(k => !RC.PASSIVE[RC.UNITS[k].passive.id]);
  ok(unknown.length === 0, 'every passive id has a catalogue entry, unknown [' + unknown.join(',') + ']');

  const entries = Object.keys(RC.PASSIVE);
  const used = new Set(units.map(k => RC.UNITS[k].passive.id));
  const orphan = entries.filter(k => !used.has(k));
  ok(orphan.length === 0, 'no catalogue entry is unused, orphans [' + orphan.join(',') + ']');
  ok(entries.every(k => RC.PASSIVE[k].ic && RC.PASSIVE[k].name && RC.PASSIVE[k].kid && RC.PASSIVE[k].desc),
     'every catalogue entry has an icon, a name, a kid line and a grown-up line');

  // The engine handles it, or it does nothing at all. Driving each one through a real hit
  // and a real aura tick is the only way to tell those two apart.
  const g = makeGame();
  const unhandled = [];
  for (const id of entries) {
    const g2 = makeGame();
    const a = withPassive(g2, 'volt', Object.assign({ id }, RC.UNITS[Object.keys(RC.UNITS)
      .find(k => RC.UNITS[k].passive.id === id)].passive), 1000, 1000, 1);
    const b = unit(g2, 'volt', 1030, 1000, 2);
    const ally = unit(g2, 'shielder', 1010, 1000, 1);
    ally.hp = 10;
    const before = JSON.stringify([b.hp, b.slow, b.frozen, b.venomStk, b.shredStk, b.markT,
                                   b.x, a.hp, a.haste, ally.hp, ally.auraArmorT, ally.shield]);
    a._hit(b, 20, g2);
    a._passiveAura(0.25, g2);
    const after = JSON.stringify([b.hp, b.slow, b.frozen, b.venomStk, b.shredStk, b.markT,
                                  b.x, a.hp, a.haste, ally.hp, ally.auraArmorT, ally.shield]);
    if (before === after) unhandled.push(id);
  }
  ok(unhandled.length === 0, 'every passive changes something when it fires, inert [' + unhandled.join(',') + ']');
  void g;
}

// ── Nothing but a hero can cast ────────────────────────────────────────────
head('Units have no buttons at all');
{
  const g = makeGame();
  for (const type of ['volt', 'patch', 'pulse', 'dropship', 'oracle', 'wrench']) {
    const u = unit(g, type, 1000, 1000, 1);
    u.energy = u.maxEnergy;
    ok(u.canCast(g) === false && u.cast(g, 'a') === false, type + ' cannot cast anything');
  }
}

// ── Chill → freeze ─────────────────────────────────────────────────────────
// The one status that stops a unit dead. It has to be reachable by stacking (so the
// enemy can see it coming) and it has to actually stop the unit, not merely slow it.
head('Chill stacks into a freeze, and a frozen unit is stopped');
{
  const g = makeGame();
  const coil = unit(g, 'pulse', 1000, 1000, 1);
  const foe = unit(g, 'volt', 1040, 1000, 2);
  const p = coil.def.passive;

  coil._hit(foe, 5, g);
  ok(foe.slow > 0, 'one hit slows');
  ok(foe.frozen === 0, 'but one hit does not freeze');
  ok(foe.chillStk === 1, 'and it left a chill stack');

  for (let i = 1; i < p.max; i++) coil._hit(foe, 5, g);
  ok(foe.frozen > 0, 'the ' + p.max + 'th stack freezes it (' + foe.frozen.toFixed(1) + 's)');
  ok(foe.chillStk === 0, 'and the stacks are spent, so it is a countdown rather than a permanent stun');

  ok(foe.effSpeed(g) === 0, 'a frozen unit cannot move');
  foe.cd = 0; foe.hp = foe.maxHp;
  const victim = unit(g, 'volt', 1050, 1000, 1);
  const vhp = victim.hp;
  foe.foe = victim; foe.state = 'attack';
  foe._attack(DT, g);
  ok(victim.hp === vhp, 'and a frozen unit cannot shoot');

  for (let i = 0; i < 30 * 4; i++) foe.update(DT, g);
  ok(foe.frozen === 0 && foe.effSpeed(g) > 0, 'the freeze wears off');

  // Buildings are never frozen — there is nothing to stop, and a frozen wall reads as broken.
  const wall = bld(g, 'cell', 1400, 1000, 2);
  coil._hit(wall, 5, g);
  ok(!wall.frozen && !wall.chillStk, 'buildings cannot be chilled or frozen');
}

// ── Venom / burn ───────────────────────────────────────────────────────────
head('Venom keeps killing after the shot lands');
{
  const g = makeGame();
  const hydra = unit(g, 'hydra', 1000, 1000, 1);
  const foe = unit(g, 'volt', 1100, 1000, 2);
  foe.def = Object.assign({}, foe.def, { regen: 0 });

  hydra._hit(foe, 1, g);
  ok(foe.venomStk === 1, 'a hit applies venom');
  const hp0 = foe.hp;
  for (let i = 0; i < 30; i++) foe.update(DT, g);        // one second, no further hits
  ok(foe.hp < hp0, 'it keeps losing health with nothing attacking it (' + Math.round(hp0) + ' -> ' + Math.round(foe.hp) + ')');

  // Stacks matter, and they are capped.
  const g2 = makeGame();
  const h2 = unit(g2, 'hydra', 1000, 1000, 1);
  const f2 = unit(g2, 'volt', 1100, 1000, 2);
  f2.def = Object.assign({}, f2.def, { regen: 0 });
  for (let i = 0; i < 20; i++) h2._hit(f2, 1, g2);
  ok(f2.venomStk === h2.def.passive.max, 'stacks cap at ' + h2.def.passive.max + ', got ' + f2.venomStk);

  const g3 = makeGame();
  const h3 = unit(g3, 'hydra', 1000, 1000, 1);
  const f3 = unit(g3, 'volt', 1100, 1000, 2);
  f3.def = Object.assign({}, f3.def, { regen: 0 });
  h3._hit(f3, 1, g3); h3._hit(f3, 1, g3); h3._hit(f3, 1, g3);
  const one = hp0 - foe.hp;
  const three0 = f3.hp;
  for (let i = 0; i < 30; i++) f3.update(DT, g3);
  ok((three0 - f3.hp) > one * 2, 'three stacks hurt much more than one');

  // It runs out.
  for (let i = 0; i < 30 * 10; i++) f3.update(DT, g3);
  ok(f3.venomStk === 0, 'and venom expires');

  // A siege should still rot a wall.
  const g4 = makeGame();
  const h4 = unit(g4, 'hydra', 1000, 1000, 1);
  const wall = bld(g4, 'cell', 1100, 1000, 2);
  h4._hit(wall, 1, g4);
  const w0 = wall.hp;
  for (let i = 0; i < 30; i++) wall.update(DT, g4);
  ok(wall.hp < w0, 'venom eats buildings too (' + Math.round(w0) + ' -> ' + Math.round(wall.hp) + ')');

  // Burn is venom in a different colour — same maths, so the renderer can tell them apart.
  const g5 = makeGame();
  const heli = unit(g5, 'heli', 1000, 1000, 1);
  const f5 = unit(g5, 'volt', 1100, 1000, 2);
  heli._hit(f5, 1, g5);
  ok(f5.venomStk > 0 && f5.venomFire === true, 'the Rattler burns rather than poisons');
}

// ── Shred ──────────────────────────────────────────────────────────────────
head('Shred peels armour off, for everyone');
{
  const g = makeGame();
  const gun = unit(g, 'chaingunner', 1000, 1000, 1);
  const foe = unit(g, 'shielder', 1050, 1000, 2);
  const a0 = foe.effArmor(g);
  gun._hit(foe, 1, g);
  const a1 = foe.effArmor(g);
  ok(a1 < a0, 'one hit lowers the target\'s armour (' + a0 + ' -> ' + a1 + ')');

  for (let i = 0; i < 20; i++) gun._hit(foe, 1, g);
  ok(foe.shredStk === gun.def.passive.max, 'stacks cap at ' + gun.def.passive.max);
  ok(foe.effArmor(g) >= 0, 'armour never goes negative');

  // The point of shred is that the whole army benefits, not just the shredder.
  const other = unit(g, 'volt', 1060, 1000, 1);
  const clean = unit(g, 'shielder', 1200, 1000, 2);
  const hurtShredded = (() => { const h = foe.hp; other._hit(foe, 20, g); return h - foe.hp; })();
  const hurtClean = (() => { const h = clean.hp; other._hit(clean, 20, g); return h - clean.hp; })();
  ok(hurtShredded > hurtClean, 'a third unit hits the shredded target harder (' +
     Math.round(hurtShredded) + ' vs ' + Math.round(hurtClean) + ')');

  for (let i = 0; i < 30 * 8; i++) foe.update(DT, g);
  ok(foe.shredStk === 0, 'and shred wears off');
}

// ── Mark ───────────────────────────────────────────────────────────────────
// Mark is the one status that is a message to the PLAYER. If only the marker benefited it
// would just be a damage buff with extra steps.
head('A mark makes everyone hit harder, not just the marker');
{
  const g = makeGame();
  const spark = unit(g, 'spark', 1000, 1000, 1);
  const plain = unit(g, 'volt', 1010, 1000, 1);
  const marked = unit(g, 'volt', 1100, 1000, 2);
  const clean = unit(g, 'volt', 1200, 1000, 2);
  marked.def = Object.assign({}, marked.def, { regen: 0 });
  clean.def = Object.assign({}, clean.def, { regen: 0 });

  spark._hit(marked, 1, g);
  ok(marked.markT > 0, 'the siege shell leaves a mark');

  const a = (() => { const h = marked.hp; plain._hit(marked, 30, g); return h - marked.hp; })();
  const b = (() => { const h = clean.hp; plain._hit(clean, 30, g); return h - clean.hp; })();
  ok(a > b * 1.1, 'a completely different unit hits the marked target harder (' +
     Math.round(a) + ' vs ' + Math.round(b) + ')');

  for (let i = 0; i < 30 * 8; i++) marked.update(DT, g);
  ok(marked.markT === 0, 'the mark expires');
}

// ── Lifesteal ──────────────────────────────────────────────────────────────
head('Leech feeds on flesh, never on walls');
{
  const g = makeGame();
  const gob = unit(g, 'globling', 1000, 1000, 1);
  const foe = unit(g, 'volt', 1020, 1000, 2);
  gob.hp = 20;
  gob._hit(foe, 30, g);
  ok(gob.hp > 20, 'hitting a unit heals it (' + Math.round(gob.hp) + ')');

  // The bug this rule exists for: a Globling parked on the Rift Crystal healed off the
  // crystal faster than a defender could shoot it, so it could never be removed.
  const g2 = makeGame();
  const gob2 = unit(g2, 'globling', 1000, 1000, 1);
  const wall = bld(g2, 'cell', 1030, 1000, 2);
  gob2.hp = 20;
  gob2._hit(wall, 30, g2);
  ok(gob2.hp === 20, 'chewing a building heals it for nothing');

  // Aether leeches into its shield instead, which is the faction's whole identity.
  const g3 = makeGame();
  const ardent = unit(g3, 'ardent', 1000, 1000, 1);
  const f3 = unit(g3, 'volt', 1020, 1000, 2);
  ardent.shield = 0;
  ardent._hit(f3, 40, g3);
  ok(ardent.shield > 0, 'the Ardent pours its leech into its shield instead (' + Math.round(ardent.shield) + ')');
}

// ── Thorns ─────────────────────────────────────────────────────────────────
head('Caustic hide hurts the attacker, and two of them do not loop forever');
{
  const g = makeGame();
  const bloat = unit(g, 'bloat', 1000, 1000, 2);
  const attacker = unit(g, 'volt', 1020, 1000, 1);
  const a0 = attacker.hp;
  attacker._hit(bloat, 30, g);
  ok(attacker.hp < a0, 'the attacker took some of its own damage back (' +
     Math.round(a0 - attacker.hp) + ')');

  // Two thorned units hitting each other must terminate. If the reflect ran back through
  // _hit this would recurse until the stack blew up rather than failing an assertion.
  const g2 = makeGame();
  const b1 = unit(g2, 'bloat', 1000, 1000, 1);
  const b2 = unit(g2, 'bloat', 1030, 1000, 2);
  let exploded = false;
  try { b1._hit(b2, 40, g2); } catch (e) { exploded = true; }
  ok(!exploded, 'two thorned units trading hits does not recurse');

  // Out of reach, out of luck — a siege unit shelling from range is not standing in the acid.
  const g3 = makeGame();
  const b3 = unit(g3, 'bloat', 1000, 1000, 2);
  const sniper = unit(g3, 'spark', 1600, 1000, 1);
  const s0 = sniper.hp;
  sniper._hit(b3, 30, g3);
  ok(sniper.hp === s0, 'a distant attacker takes nothing back');
}

// ── Chain and cleave ───────────────────────────────────────────────────────
head('Arc chain and splatter reach past the target — and stop');
{
  const g = makeGame();
  const volt = unit(g, 'volt', 1000, 1000, 1);
  const near = unit(g, 'volt', 1060, 1000, 2);
  const next = unit(g, 'volt', 1100, 1000, 2);
  const far = unit(g, 'volt', 1900, 1000, 2);
  [near, next, far].forEach(u => { u.def = Object.assign({}, u.def, { regen: 0 }); });
  const n0 = next.hp, f0 = far.hp;
  volt._hit(near, 20, g);
  ok(next.hp < n0, 'the bolt arced to a second enemy');
  ok(far.hp === f0, 'but not to one across the map');
  ok(next.hp > n0 - 20, 'and the arc lands for less than the original hit');

  // A crowd must not turn one shot into a chain reaction.
  const g2 = makeGame();
  const v2 = unit(g2, 'volt', 1000, 1000, 1);
  const crowd = [];
  for (let i = 0; i < 10; i++) {
    const u = unit(g2, 'volt', 1050 + i * 30, 1000, 2);
    u.def = Object.assign({}, u.def, { regen: 0 });
    crowd.push(u);
  }
  const before = crowd.map(u => u.hp);
  v2._hit(crowd[0], 20, g2);
  const struck = crowd.filter((u, i) => u.hp < before[i]).length;
  ok(struck <= 1 + (v2.def.passive.jumps || 1),
     'a chain in a crowd hits the target plus its jumps only, hit ' + struck);

  // Cleave splatters onto neighbours of the TARGET, not neighbours of the shooter.
  const g3 = makeGame();
  const spit = unit(g3, 'spitter', 1000, 1000, 1);
  const t = unit(g3, 'volt', 1300, 1000, 2);
  const beside = unit(g3, 'volt', 1330, 1000, 2);
  const behind = unit(g3, 'volt', 1030, 1000, 2);
  [t, beside, behind].forEach(u => { u.def = Object.assign({}, u.def, { regen: 0 }); });
  const b0 = beside.hp, h0 = behind.hp;
  spit._hit(t, 20, g3);
  ok(beside.hp < b0, 'the splatter caught the enemy standing beside the target');
  ok(behind.hp === h0, 'and not one standing beside the shooter');
}

// ── Crit, finisher, concussive, strafe ─────────────────────────────────────
head('The self-and-shot passives');
{
  // Crit is a roll, so it is asserted over many shots rather than on one.
  const g = makeGame();
  const blade = unit(g, 'bladesworn', 1000, 1000, 1);
  const dummy = unit(g, 'volt', 1015, 1000, 2);
  dummy.maxHp = dummy.hp = 1e7;
  dummy.def = Object.assign({}, dummy.def, { regen: 0, armor: 0 });
  let crits = 0;
  for (let i = 0; i < 400; i++) {
    const h = dummy.hp;
    blade.cd = 0; blade.critFx = 0;
    blade._fireAt(dummy, g);
    if (blade.critFx > 0) crits++;
    void h;
  }
  const rate = crits / 400;
  ok(rate > 0.15 && rate < 0.5, 'the Bladesworn crits about a third of the time, saw ' + Math.round(rate * 100) + '%');

  // Finisher: the same jet, the same target, different health.
  const g2 = makeGame();
  const jet = unit(g2, 'jet', 1000, 1000, 1);
  const healthy = unit(g2, 'shielder', 1050, 1000, 2);
  const wounded = unit(g2, 'shielder', 1060, 1000, 2);
  [healthy, wounded].forEach(u => { u.def = Object.assign({}, u.def, { regen: 0 }); u.shield = 0; u.maxShield = 0; });
  wounded.hp = wounded.maxHp * 0.2;
  const dHealthy = (() => { const h = healthy.hp; jet.cd = 0; jet._fireAt(healthy, g2); return h - healthy.hp; })();
  const dWounded = (() => { const h = wounded.hp; jet.cd = 0; jet._fireAt(wounded, g2); return h - wounded.hp; })();
  ok(dWounded > dHealthy * 1.4, 'the Falcon hits a wounded target far harder (' +
     Math.round(dHealthy) + ' vs ' + Math.round(dWounded) + ')');

  // Concussive: shoved back, and buildings take the worse of it.
  const g3 = makeGame();
  const bastion = unit(g3, 'bastion', 1000, 1000, 1);
  const shoved = unit(g3, 'volt', 1100, 1000, 2);
  const x0 = shoved.x;
  bastion._hit(shoved, 10, g3);
  ok(shoved.x > x0 + 10, 'the shell shoved the target back (' + Math.round(shoved.x - x0) + 'px)');
  const flyer = unit(g3, 'hover', 1100, 1200, 2);
  const fx0 = flyer.x;
  bastion._hit(flyer, 10, g3);
  ok(flyer.x === fx0, 'but a flyer is not pushed around by a ground shell');

  const g4 = makeGame();
  const b4 = unit(g4, 'bastion', 1000, 1000, 1);
  const wall = bld(g4, 'cell', 1100, 1000, 2);
  const soft = unit(g4, 'volt', 1100, 1200, 2);
  soft.def = Object.assign({}, soft.def, { armor: wall.def.armor || 0, regen: 0 });
  b4.cd = 0; const w0 = wall.hp; b4._fireAt(wall, g4);
  b4.cd = 0; const s0 = soft.hp; b4._fireAt(soft, g4);
  ok((w0 - wall.hp) > (s0 - soft.hp), 'and it tears buildings up harder than flesh (' +
     Math.round(w0 - wall.hp) + ' vs ' + Math.round(s0 - soft.hp) + ')');

  // Strafe run: firing is what accelerates it.
  const g5 = makeGame();
  const hov = unit(g5, 'hover', 1000, 1000, 1);
  const mark = unit(g5, 'volt', 1050, 1000, 2);
  const base = hov.effSpeed(g5);
  hov.cd = 0; hov._fireAt(mark, g5);
  ok(hov.haste > 0 && hov.effSpeed(g5) > base, 'the Hoverwing speeds up the moment it shoots (' +
     Math.round(base) + ' -> ' + Math.round(hov.effSpeed(g5)) + ')');
  // Take the target away, or it simply keeps shooting and keeps the boost topped up —
  // which is the intended behaviour, and not what this line is checking.
  mark.dead = true; g5.units = g5.units.filter(u => !u.dead); hov.foe = null; hov.stop();
  for (let i = 0; i < 30 * 4; i++) hov.update(DT, g5);
  ok(hov.haste === 0, 'and settles back down once it stops firing');
}

// ── Auras ──────────────────────────────────────────────────────────────────
head('Auras — presence, not events');
{
  // Field Repair reaches buildings, which is the whole reason a worker was worth keeping
  // near a besieged base back when this was a button.
  const g = makeGame();
  const patch = unit(g, 'patch', 1000, 1000, 1);
  const hurt = unit(g, 'volt', 1030, 1000, 1);
  const away = unit(g, 'volt', 1900, 1000, 1);
  const foe = unit(g, 'volt', 1030, 1050, 2);
  [hurt, away, foe].forEach(u => { u.def = Object.assign({}, u.def, { regen: 0 }); u.hp = 20; });
  patch._passiveAura(0.25, g);
  ok(hurt.hp > 20, 'a wounded ally in range is mended (' + hurt.hp.toFixed(1) + ')');
  ok(away.hp === 20, 'one out of range is not');
  ok(foe.hp === 20, 'and an enemy standing right there is certainly not');

  const g2 = makeGame();
  const wrench = unit(g2, 'wrench', 1000, 1000, 1);
  const wall = bld(g2, 'cell', 1050, 1000, 1);
  wall.hp = 100;
  wrench._passiveAura(0.25, g2);
  ok(wall.hp > 100, 'workers repair buildings without being told to');

  // The healer-on-healer rule. Without it a knot of Patch Bots is unkillable and fills the
  // population cap with medics, which is exactly how a Crystal Guard run stalled at wave 7.
  const g3 = makeGame();
  const p1 = unit(g3, 'patch', 1000, 1000, 1);
  const p2 = unit(g3, 'patch', 1030, 1000, 1);
  const grunt = unit(g3, 'volt', 1030, 1010, 1);
  [p2, grunt].forEach(u => { u.def = Object.assign({}, u.def, u.def.passive ? {} : {}); u.hp = 20; });
  p1._passiveAura(0.25, g3);
  ok(p2.hp === 20, 'a healer never heals another healer');
  ok(grunt.hp > 20, 'but it does heal an ordinary fighter standing in the same spot');

  const g4 = makeGame();
  const slug = unit(g4, 'slug', 1000, 1000, 1);
  const slug2 = unit(g4, 'slug', 1020, 1000, 1);
  const gob = unit(g4, 'globling', 1020, 1010, 1);
  [slug2, gob].forEach(u => { u.def = Object.assign({}, u.def, { regen: 0 }); u.hp = 20; });
  slug._passiveAura(0.25, g4);
  ok(slug2.hp === 20, 'the same rule holds for the Gloop bloom');
  ok(gob.hp > 20, 'which still feeds the swarm');

  // Bulwark Field: armour that follows the Shieldbearer around and falls off on its own.
  const g5 = makeGame();
  const shield = unit(g5, 'shielder', 1000, 1000, 1);
  const buddy = unit(g5, 'volt', 1050, 1000, 1);
  const stranger = unit(g5, 'volt', 1050, 1000, 2);
  const base = buddy.effArmor(g5);
  shield._passiveAura(0.25, g5);
  ok(buddy.effArmor(g5) > base, 'an ally beside the Shieldbearer is better armoured (' +
     base + ' -> ' + buddy.effArmor(g5) + ')');
  ok(stranger.auraArmorT === 0, 'an enemy standing in the same place gets nothing');
  // Nothing has to remember to remove it — the buff is short-lived and simply lapses.
  for (let i = 0; i < 30; i++) buddy.update(DT, g5);
  ok(buddy.effArmor(g5) === base, 'and it lapses by itself once the Shieldbearer stops radiating');

  // Shield Font.
  const g6 = makeGame();
  const oracle = unit(g6, 'oracle', 1000, 1000, 1);
  const lancer = unit(g6, 'lancer', 1050, 1000, 1);
  lancer.shield = 0;
  oracle._passiveAura(0.25, g6);
  ok(lancer.shield > 0, 'the Oracle recharges a nearby shield (' + lancer.shield.toFixed(1) + ')');

  // Field hospital: the dropship patches up whoever is riding inside.
  const g7 = makeGame();
  const ship = unit(g7, 'dropship', 1000, 1000, 1);
  const rider = unit(g7, 'volt', 1000, 1000, 1);
  rider.def = Object.assign({}, rider.def, { regen: 0 });
  rider.hp = 20; rider.boarded = true;
  ship.cargo = [rider];
  ship._passiveAura(0.25, g7);
  ok(rider.hp > 20, 'the dropship heals its passengers (' + rider.hp.toFixed(1) + ')');
}

// ── Cosmetics never touch the RNG ──────────────────────────────────────────
// The sim is seeded and shared between the server and every client. One stray Math.random()
// in a decoration silently reshuffles crits, wave composition and card offers downstream —
// and it does it invisibly, which is what makes it worth a test of its own.
head('Aura decorations do not draw from the seeded RNG');
{
  const g = makeGame();
  const patch = unit(g, 'patch', 1000, 1000, 1);
  const hurt = unit(g, 'volt', 1030, 1000, 1);
  hurt.hp = 10;
  const real = Math.random;
  let rolls = 0;
  // Counted only around the aura ticks — building the game and the units legitimately
  // rolls for map scatter, and that happens identically on every peer.
  Math.random = () => { rolls++; return real(); };
  try {
    for (let i = 0; i < 50; i++) { g.time += 0.25; patch._passiveAura(0.25, g); }
    ok(rolls === 0, 'fifty aura ticks rolled the dice ' + rolls + ' times');
  } finally { Math.random = real; }
}

// ── The whole thing still runs ─────────────────────────────────────────────
head('A real match runs with every passive live');
{
  const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  let boom = null;
  try { for (let i = 0; i < 30 * 120; i++) g.update(DT); } catch (e) { boom = e; }
  ok(!boom, 'two minutes of a real 1v1 with passives on both sides: ' + (boom ? boom.message : 'no errors'));
  ok(g.units.length > 0, 'and there are still units on the field');
}

console.log('\n' + (fail ? '✖ ' : '✔ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
