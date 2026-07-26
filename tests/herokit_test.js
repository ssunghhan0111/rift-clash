// Each hero's SIGNATURE skill is mechanically distinct — not just a renamed copy of a
// shared engine. This test drives the real RC.Unit.cast on real heroes and asserts the
// behaviour that makes each signature unique:
//
//   Warden   'leap'      (LoL Malphite: Unstoppable Force) — dashes AND deals area damage
//                        that leaves enemies reeling (slow). The old 'Warp Charge' was a
//                        pure blink: it moved the hero but dealt ZERO damage.
//   Matriarch 'devour'   (LoL Cassiopeia: Twin Fang) — damages nearby foes AND heals the
//                        Matriarch for each one hit. The old 'Corrosive Nova' damaged but
//                        never healed the caster.
//   Archon   'riftblast' (LoL Kassadin: Riftwalk) — blinks AND erupts for area damage at
//                        the arrival point. The old 'Rift Walk' was a pure blink: no damage.
//
// So this suite FAILS on the pre-change code (see the tests/oldcode run in the commit body):
// on the old kits the enemies take no damage from the blinks and the Matriarch never heals.
const path = require('path');
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

function makeGame() {
  const g = new RC.Game();
  g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.over = null;
  g.teamMap = { 1: 0, 2: 1 };        // owner 1 vs owner 2 — enemies
  return g;
}
function hero(g, type, x, y, lvl) {
  const h = new RC.Unit(type, x, y, 1);
  h.level = lvl; h.energy = 999; h.skillCd = {}; h.facing = 0;   // facing +x
  g.units.push(h);
  return h;
}
function enemy(g, x, y) {
  const e = new RC.Unit('volt', x, y, 2);
  g.units.push(e);
  return e;
}
// index of the skill whose def.id === id, and the key to cast it
function keyOf(def, id) {
  const s = (def.skills || []).find(sk => sk.id === id);
  return s ? s.key.toLowerCase() : null;
}

// ── Warden — Leap Slam: dash + area damage + reeling ───────────────────────
console.log('Warden — Leap Slam (Malphite: Unstoppable Force)');
{
  const g = makeGame();
  const h = hero(g, 'warden', 1000, 1000, 5);
  const k = keyOf(h.def, 'leap');
  ok(k === 'c', 'the Warden actually has a "leap" signature skill');
  const es = [enemy(g, 1245, 985), enemy(g, 1250, 1000), enemy(g, 1255, 1015)];
  const hp0 = es.map(e => e.hp);
  const x0 = h.x;
  const cast = h.cast(g, k);
  ok(cast === true, 'the leap fires');
  ok(h.x - x0 > 100, 'the Warden dashed forward (' + Math.round(h.x - x0) + 'px)');
  const dmgd = es.filter((e, i) => e.hp < hp0[i]).length;
  ok(dmgd === 3, 'all 3 enemies at the landing point took damage (' + dmgd + '/3) — a pure blink would deal none');
  ok(es.every(e => e.slow > 0), 'the landing left enemies reeling (slowed)');
}

// ── Matriarch — Devouring Acid: damage + self-heal (feeds on the fallen) ────
console.log('Matriarch — Devouring Acid (Cassiopeia: Twin Fang)');
{
  const g = makeGame();
  const h = hero(g, 'matriarch', 1000, 1000, 3);
  const k = keyOf(h.def, 'devour');
  ok(k === 'a', 'the Matriarch actually has a "devour" signature skill');
  h.hp = Math.round(h.maxHp * 0.5);          // wounded so healing is observable
  const hpBefore = h.hp;
  const es = [enemy(g, 1090, 1000), enemy(g, 1000, 1090), enemy(g, 920, 1000)];
  const hp0 = es.map(e => e.hp);
  const cast = h.cast(g, k);
  ok(cast === true, 'the devour fires');
  const dmgd = es.filter((e, i) => e.hp < hp0[i]).length;
  ok(dmgd === 3, 'all 3 nearby enemies took acid damage (' + dmgd + '/3)');
  ok(h.hp > hpBefore, 'the Matriarch FED and healed (' + hpBefore + ' → ' + h.hp + ') — the old Nova never healed the caster');
  ok(es.some(e => e.acidStacks > 0), 'devour applied acid stacks');
}

// ── Archon — Rift Surge: blink + area damage on arrival ────────────────────
console.log('Archon — Rift Surge (Kassadin: Riftwalk)');
{
  const g = makeGame();
  const h = hero(g, 'archon', 1000, 1000, 5);
  const k = keyOf(h.def, 'riftblast');
  ok(k === 'c', 'the Archon actually has a "riftblast" signature skill');
  const x0 = h.x;
  const es = [enemy(g, 1245, 1000), enemy(g, 1260, 1020)];
  const hp0 = es.map(e => e.hp);
  const cast = h.cast(g, k);
  ok(cast === true, 'the rift surge fires');
  ok(h.x - x0 > 100, 'the Archon blinked forward (' + Math.round(h.x - x0) + 'px)');
  const dmgd = es.filter((e, i) => e.hp < hp0[i]).length;
  ok(dmgd === es.length, 'enemies at the arrival point took the eruption damage (' + dmgd + '/' + es.length + ') — a pure blink would deal none');
}

// ── The three signatures are genuinely different engines, not one shared id ─
console.log('The three signature skills are distinct mechanics');
{
  const ids = ['warden', 'matriarch', 'archon'].map(h => {
    const d = RC.UNITS[h];
    return (d.skills || []).map(s => s.id);
  });
  const sig = [ids[0].includes('leap'), ids[1].includes('devour'), ids[2].includes('riftblast')];
  ok(sig.every(Boolean), 'Warden=leap, Matriarch=devour, Archon=riftblast are all present');
  // no hero should still be carrying the old shared "warp" blink as its signature
  ok(!ids[0].includes('warp') && !ids[2].includes('warp'), 'no hero reuses the generic "warp" blink anymore');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
