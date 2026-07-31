// Five heroes, none of them owned by a race — and the two numbers called "level"
// ---------------------------------------------------------------------------
// This suite covers the roster rework described in HERO_DESIGN.md. It is organised
// around the three claims that rework makes, because those are the three that a later
// refactor is most likely to quietly break:
//
//   1. DECOUPLED — any hero deploys with any faction, summons nothing factional, and
//      never double-dips an aura it shares with a race's own unit.
//   2. TWO TRACKS — Match Level (1-10, resets, carries the stats) and Mastery (1-30,
//      persists, carries NOTHING the simulation reads). The load-bearing assertion in
//      the whole file is that a Mastery-30 hero and a Mastery-1 hero have identical
//      stats: that is what lets them queue against each other with no bracket.
//   3. STARS PAY FOR LOOKS — never for power, on a loss as well as a win, capped, and
//      with the daily bonus landing exactly once per day.
//
// Runs headless. The sim half drives real RC.Unit / RC.Game; the profile half runs
// against a mocked localStorage, the same way profile_test does.
const path = require('path');
global.window = global;

// localStorage has to exist BEFORE profile.js is required.
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'kids', 'net_core', 'progress', 'profile']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
function head(s) { console.log('\n' + s); }
function clearStore() { for (const k of Object.keys(store)) delete store[k]; }

function makeGame() {
  const g = new RC.Game();
  g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.hazards = []; g.over = null;
  g.teamMap = { 1: 0, 2: 1 };
  return g;
}
function hero(g, type, x, y, lvl) {
  const h = new RC.Unit(type, x, y, 1);
  h.level = lvl || 1; h.facing = 0;
  h.charge = 1; h.sigCd = 0; h.energy = h.maxEnergy;
  g.units.push(h);
  return h;
}
function foe(g, type, x, y) { const e = new RC.Unit(type || 'volt', x, y, 2); g.units.push(e); return e; }
function mate(g, type, x, y) { const e = new RC.Unit(type || 'volt', x, y, 1); g.units.push(e); return e; }

// ══ 1. The roster ═══════════════════════════════════════════════════════════
head('Five heroes, and the roster is the single source of truth');
{
  ok(RC.HEROES.length === 5, 'RC.HEROES lists five heroes, got ' + RC.HEROES.length);
  RC.HEROES.forEach(id => {
    const d = RC.UNITS[id];
    ok(!!d && d.hero, id + ' exists and is flagged a hero');
    ok(d.skills && d.skills.length === 3, id + ' has a three-slot bar');
    ok(d.skills[2] === d.sig, id + "'s R slot IS the signature object, not a copy");
    ok(d.skills.map(s => s.key).join('') === 'QER', id + ' binds Q, E, R in that order');
  });

  // The decoupling, asserted at its source. If a race ever grows a `hero` key again,
  // three spawn sites quietly start ignoring the player's pick.
  const bound = Object.values(RC.RACES).filter(r => r.hero);
  ok(bound.length === 0, 'no faction owns a hero any more, bound [' + bound.map(r => r.id).join(',') + ']');
  const tagged = RC.HEROES.filter(id => RC.UNITS[id].race);
  ok(tagged.length === 0, 'no hero carries a race tag, tagged [' + tagged.join(',') + ']');

  // Every hero needs its own tint, or two of them silently render identically.
  const seen = {};
  let dupe = null;
  RC.HEROES.forEach(id => {
    const sigId = RC.UNITS[id].sig.id;
    if (seen[sigId]) dupe = sigId; seen[sigId] = 1;
  });
  ok(!dupe, 'no two heroes share a signature id' + (dupe ? ' (' + dupe + ')' : ''));

  // Old saves must still resolve. A returning player finding their hero gone is the one
  // class of change players genuinely resent.
  ok(RC.resolveHero('warden') === 'rook', 'the old warden id resolves to Rook');
  ok(RC.resolveHero('matriarch') === 'thorn', 'the old matriarch id resolves to Thorn');
  ok(RC.resolveHero('archon') === 'prism', 'the old archon id resolves to Prism');
  ok(RC.resolveHero('nonsense') === RC.DEFAULT_HERO, 'an unknown id falls back rather than throwing');
  ok(RC.resolveHero(null) === RC.DEFAULT_HERO, 'so does a missing one');
}

// ══ 2. Any hero, any race ═══════════════════════════════════════════════════
head('Any hero deploys with any faction');
{
  let threw = null;
  for (const hid of RC.HEROES) {
    for (const race of ['forge', 'gloop', 'aether']) {
      try {
        const g = new RC.Game();
        g.heroesEnabled = true;
        g.setHeroPick({ 1: hid });
        g.setup(RC.MAPS[0], RC.MODES['1v1'], { 1: race, 2: 'forge' }, 'normal');
        const h = g.heroOf[1];
        if (!h || h.type !== hid) threw = hid + ' did not spawn for ' + race;
      } catch (e) { threw = hid + '/' + race + ': ' + e.message; }
    }
  }
  ok(!threw, 'all five spawn with all three factions' + (threw ? ' — ' + threw : ''));

  // The bot's hero follows its personality, so the label the player saw on the pre-game
  // screen is borne out by what walks onto the map.
  const g2 = new RC.Game();
  g2.heroesEnabled = true;
  g2._personaPick = { 2: 'turtler' };
  g2.setHeroPick({ 1: 'ember' });
  g2.setup(RC.MAPS[0], RC.MODES['1v1'], { 1: 'gloop', 2: 'aether' }, 'normal');
  ok(g2.heroOf[1].type === 'ember', 'the human seat takes the profile pick');
  ok(g2.heroOf[2].type === RC.AI_PERSONA_HERO.turtler, 'the Turtler bot brings ' + RC.AI_PERSONA_HERO.turtler);

  // Online seats carry the pick too. The server stores whatever the client sent AFTER
  // passing it through resolveHero, and hands the map to setHeroPick before setup —
  // which is the only ordering that works, because setup() is what spawns the heroes.
  const g3 = new RC.Game();
  g3.heroesEnabled = true;
  g3.setHeroPick({ 1: 'vale', 3: 'thorn' });
  g3.setup(RC.MAPS[0], RC.MODES['2v2'], { 1: 'forge', 2: 'gloop', 3: 'aether', 4: 'forge' }, 'normal');
  ok(g3.heroOf[1].type === 'vale' && g3.heroOf[3].type === 'thorn', 'two human seats each get their own pick');
  ok(!!g3.heroOf[2] && !!g3.heroOf[4], 'and the bot seats still get a hero');

  // A seat with no pick must not be handed an undefined — it falls through to the default.
  const g4 = new RC.Game();
  g4.heroesEnabled = true;
  g4.setHeroPick({ 1: undefined });
  g4.setup(RC.MAPS[0], RC.MODES['1v1'], { 1: 'forge', 2: 'gloop' }, 'normal');
  ok(!!g4.heroOf[1] && RC.HEROES.indexOf(g4.heroOf[1].type) >= 0, 'a seat with no pick still gets a real hero');

  // setHeroPick merges rather than replaces — setting one seat must not clear the others.
  const g5 = new RC.Game();
  g5.setHeroPick({ 1: 'ember' });
  g5.setHeroPick({ 3: 'rook' });
  ok(g5._heroPick[1] === 'ember' && g5._heroPick[3] === 'rook', 'setHeroPick merges seats rather than replacing them');

  // Thorn's summon must not be a faction unit.
  const spawn = RC.UNITS.thorn.sig.spawn;
  ok(spawn === 'thornling', "Thorn hatches thornlings, not a faction's unit (got " + spawn + ')');
  ok(!RC.UNITS[spawn].race, 'and the thornling belongs to no race');
  const buildable = [].concat.apply([], Object.values(RC.RACES).map(r => (r.ai && r.ai.barracksUnits) || []));
  ok(buildable.indexOf('thornling') < 0, 'and no faction can build one');
}

head('Auras with the same id do not stack');
{
  // Prism's passive is `shieldaura` and so is the Aether Ardent's. Before the rule, a
  // Prism deploying with Aether restored shields twice as fast as either alone.
  const g = makeGame();
  const p = hero(g, 'prism', 1000, 1000, 1);
  const ardent = mate(g, 'ardent', 1010, 1000);
  const patient = mate(g, 'lancer', 1040, 1000);
  patient.shield = 0;
  p._passiveAura(0.25, g); ardent._passiveAura(0.25, g);
  RC.tickStatus(patient, 0.25);
  const both = patient.shield;

  const g2 = makeGame();
  const p2 = hero(g2, 'prism', 1000, 1000, 1);
  const solo = mate(g2, 'lancer', 1040, 1000);
  solo.shield = 0;
  p2._passiveAura(0.25, g2);
  RC.tickStatus(solo, 0.25);

  ok(both > 0, 'the shield aura still works at all (' + both.toFixed(2) + ')');
  ok(Math.abs(both - solo.shield) < 1e-6, 'a Prism in an Aether army does not double-dip');
}

// ══ 3. The new kits ═════════════════════════════════════════════════════════
head('Ember — the ground is the ability');
{
  const g = makeGame();
  const e = hero(g, 'ember', 1000, 1000, 5);
  const enemy = foe(g, 'volt', 1150, 1000);          // straight ahead (facing 0)
  const behind = foe(g, 'volt', 800, 1000);
  const hp0 = enemy.hp;
  ok(e.cast(g, 'q') === true, 'Cinder Line fires');
  ok(enemy.hp < hp0, 'and what it swept took damage');
  ok(behind.hp === behind.maxHp, 'but nothing behind the hero did');
  ok(g.hazards.some(h => h.kind === 'fire'), 'it leaves fire on the ground');

  // The fire keeps working after the cast, on enemies only.
  const ally = mate(g, 'volt', 1150, 1000);
  const ehp = enemy.hp, ahp = ally.hp;
  for (let i = 0; i < 10; i++) g._tickHazards(0.1);
  ok(enemy.hp < ehp, 'standing in it keeps hurting (' + Math.round(ehp - enemy.hp) + ' over 1s)');
  ok(ally.hp === ahp, 'and it never burns your own army');

  // Flare reuses the existing mark status, so it has to apply to EVERY damage path —
  // an amp that only worked on basic attacks would be a lie told to the player.
  const g2 = makeGame();
  const e2 = hero(g2, 'ember', 1000, 1000, 5);
  const t2 = foe(g2, 'volt', 1080, 1000);
  ok(e2.cast(g2, 'e') === true, 'Flare fires');
  ok(t2.markT > 0 && t2.markAmp > 0, 'and it marks the target (+' + Math.round(t2.markAmp * 100) + '% taken)');
  const plain = makeGame(); const pt = foe(plain, 'volt', 1000, 1000);
  const ampd = g2.hurt(t2, 100, 1, null);
  const base = plain.hurt(pt, 100, 1, null);
  ok(ampd > base, 'a marked target takes more from a tower/ability hit too (' + Math.round(base) + ' -> ' + Math.round(ampd) + ')');

  // Flare refuses on an empty field: it is aimed AT enemies, unlike the two ground abilities.
  const g3 = makeGame();
  const e3 = hero(g3, 'ember', 1000, 1000, 5);
  ok(e3.cast(g3, 'e') === false, 'Flare refuses with nothing to mark');
  ok(e3.energy === e3.maxEnergy, 'and costs nothing when it refuses');

  // Firestorm — the only ultimate that is not an event.
  const g4 = makeGame();
  const e4 = hero(g4, 'ember', 1000, 1000, 5);
  const v = foe(g4, 'volt', 1000, 1000);
  ok(e4.cast(g4, 'r') === true, 'Firestorm fires');
  const storm = g4.hazards.find(h => h.kind === 'fire');
  ok(!!storm && storm.t > 5, 'and leaves a fire that lasts seconds, not a frame');
  const vhp = v.hp;
  for (let i = 0; i < 10; i++) g4._tickHazards(0.1);
  ok(v.hp < vhp, 'which burns whatever is standing in it');
  ok(e4.charge === 0, 'and it spent the charge meter');
}

head('Vale — the only kit pointed at your own army');
{
  const g = makeGame();
  const v = hero(g, 'vale', 1000, 1000, 5);
  const hurt = mate(g, 'volt', 1050, 1000); hurt.hp = 10;
  const wall = new RC.Building('crystal', 1060, 1000, 1, true);
  wall.hp = Math.max(1, wall.maxHp - 400);
  g.buildings.push(wall);
  const enemy = foe(g, 'volt', 1050, 1010); enemy.hp = 10;
  const whp = wall.hp;
  ok(v.cast(g, 'q') === true, 'Mend Pulse fires');
  ok(hurt.hp > 10, 'it heals a hurt ally');
  ok(wall.hp > whp, 'and REPAIRS a building — including the crystal');
  ok(enemy.hp === 10, 'and does nothing for the enemy');

  // Slipstream: the cleanse is the half that matters. It is the game's only answer to
  // Rook's Ground Slam and Prism's Static Prison.
  const g2 = makeGame();
  const v2 = hero(g2, 'vale', 1000, 1000, 5);
  const frozen = mate(g2, 'volt', 1050, 1000);
  frozen.frozen = 3; frozen.slow = 3;
  ok(v2.cast(g2, 'e') === true, 'Slipstream fires');
  ok(frozen.frozen === 0 && frozen.slow === 0, 'and unfreezes the army');
  ok(frozen.haste > 0 && frozen.hasteSpd > 1, 'and speeds it up');

  // Sanctuary: damage reduction plus one save each, applied continuously so a unit that
  // walks in halfway through is covered.
  const g3 = makeGame();
  const v3 = hero(g3, 'vale', 1000, 1000, 5);
  const inside = mate(g3, 'volt', 1010, 1000);
  ok(v3.cast(g3, 'r') === true, 'Sanctuary fires');
  g3._tickHazards(0.1);
  ok(inside.wardT > 0 && inside.wardDr > 0, 'allies inside are warded');

  const plain = makeGame(); const bare = mate(plain, 'volt', 1000, 1000);
  const warded = RC.dealDamage(inside, 40);
  const naked = RC.dealDamage(bare, 40);
  ok(warded < naked, 'and take less (' + Math.round(naked) + ' -> ' + Math.round(warded) + ')');

  // The save is a reprieve, not immortality: once each, and it does not heal.
  const g4 = makeGame();
  const v4 = hero(g4, 'vale', 1000, 1000, 5);
  const doomed = mate(g4, 'volt', 1010, 1000);
  v4.cast(g4, 'r');
  g4._tickHazards(0.1);
  RC.dealDamage(doomed, 99999);
  ok(!doomed.dead && doomed.hp === 1, 'a lethal hit leaves it at 1 hp instead of killing it');
  RC.dealDamage(doomed, 99999);
  ok(doomed.dead, 'but the SECOND lethal hit kills it — a reprieve, not immortality');

  // Nothing has to clean up: the ward lapses on its own once the sanctuary ends.
  const g5 = makeGame();
  const v5 = hero(g5, 'vale', 1000, 1000, 5);
  const m5 = mate(g5, 'volt', 1010, 1000);
  v5.cast(g5, 'r');
  const dur = RC.UNITS.vale.sig.dur;
  for (let i = 0; i < Math.ceil(dur / 0.1) + 4; i++) { g5._tickHazards(0.1); RC.tickStatus(m5, 0.1); }
  ok(!g5.hazards.some(h => h.kind === 'ward'), 'the sanctuary expires');
  ok(!m5.wardT && !m5.wardDr, 'and the ward on the unit lapses with it');
}

// ══ 4. Two tracks ═══════════════════════════════════════════════════════════
head('Mastery persists and never becomes power');
{
  clearStore();
  const P = RC.Profile;
  const all = P.heroes();
  ok(Object.keys(all).length === 5, 'a fresh profile has all five heroes — none are locked');
  ok(RC.HEROES.every(id => all[id].mastery === 1), 'and every one starts at Mastery 1');

  // THE assertion. Mastery is stored, unlocks options, and touches no stat — which is
  // the entire reason a veteran and a rookie can be put in the same match.
  const rec = P.heroes();
  rec.rook.mastery = 30; rec.rook.xp = 0;
  P.saveHeroes(rec);
  ok(P.heroes().rook.mastery === 30, 'Mastery survives a reload');

  const g = makeGame();
  const veteran = hero(g, 'rook', 1000, 1000, 1);
  const rookieG = makeGame();
  const rookie = hero(rookieG, 'rook', 1000, 1000, 1);
  const same = ['maxHp', 'hp', 'maxShield', 'maxEnergy'].every(k => veteran[k] === rookie[k]);
  ok(same, 'a Mastery-30 hero and a Mastery-1 hero have identical stats');
  ok(veteran.effArmor(g) === rookie.effArmor(rookieG), 'identical armour');
  ok(veteran.effAtk(g) === rookie.effAtk(rookieG), 'identical damage');
  ok(veteran.effSig().dmg === rookie.effSig().dmg, 'and an identical ultimate');
  ok(veteran.mastery === undefined, 'the Unit does not even carry a mastery field');

  // Match Level is the one that DOES carry stats, and it starts at 1 every match.
  // Levelled through the real gainXp path, not by assigning `level` — assigning it
  // skips the grow maths, which is exactly the trap this assertion is guarding.
  const lvG = makeGame();
  const climber = hero(lvG, 'rook', 1000, 1000, 1);
  const hp1 = climber.maxHp, atk1 = climber.effAtk(lvG), ult1 = climber.effSig().shield;
  for (let i = 0; i < 40 && climber.level < RC.HERO.maxLevel; i++) climber.gainXp(climber.xpToNext());
  ok(climber.level === RC.HERO.maxLevel, 'a hero climbs to Match Level ' + RC.HERO.maxLevel + ' in a match');
  ok(climber.maxHp > hp1, 'and gets tougher doing it (' + hp1 + ' -> ' + climber.maxHp + ')');
  ok(climber.effAtk(lvG) > atk1, 'and hits harder');
  ok(climber.effSig().shield > ult1, 'and its ultimate grows too — that is what Match Level is FOR');

  // The Mastery curve is linear, not exponential: each level costs the same amount more
  // than the last, so twice the play is roughly twice as far along.
  const gaps = [1, 5, 12, 25].map(n => P.masteryToNext(n + 1) - P.masteryToNext(n));
  ok(gaps.every(g => g === gaps[0]), 'the Mastery curve is linear, gaps [' + gaps.join(',') + ']');
  ok(P.masteryToNext(20) > P.masteryToNext(1), 'and it does get more expensive');

  // Levelling rolls, and stops at the cap rather than running away.
  const r2 = { mastery: 1, xp: 0 };
  P.addMasteryXp(r2, P.masteryToNext(1) + P.masteryToNext(2));
  ok(r2.mastery === 3, 'enough XP rolls two levels at once, got ' + r2.mastery);
  const r3 = { mastery: RC.MASTERY.maxLevel, xp: 0 };
  P.addMasteryXp(r3, 999999);
  ok(r3.mastery === RC.MASTERY.maxLevel && r3.xp === 0, 'and it caps at ' + RC.MASTERY.maxLevel);
}

// ══ 5. Stars ════════════════════════════════════════════════════════════════
head('Stars pay for looks, on a loss as well as a win');
{
  clearStore();
  const P = RC.Profile;
  let DAY = 500;
  RC.Daily = { dayNumber: () => DAY };

  const fakeGame = (over, extra) => Object.assign({
    over, survival: false, practice: false, playerOwner: 1,
    heroOf: { 1: { type: 'rook', level: 6 } },
    crystal: null, _racePick: { 1: 'forge' }, aiDiff: 'normal', aiPersona: {}, mapDef: { id: 'x' },
  }, extra || {});

  const lose = P.recordMatchEnd(fakeGame('lose'));
  ok(lose.stars > 0, 'a LOSS still pays (' + lose.stars + ')');
  ok(lose.starLines.some(l => /first match today/i.test(l.why)), 'and the first match of the day carries the daily bonus');
  ok(lose.masteryUp >= 0 && lose.hero === 'rook', 'mastery went to the hero that was actually deployed');

  const win = P.recordMatchEnd(fakeGame('win'));
  ok(!win.starLines.some(l => /first match today/i.test(l.why)), 'the daily bonus does not pay twice in one day');
  ok(win.stars > 0, 'the second match still pays something');

  // A win is worth more than a loss, all else equal — but not by a landslide.
  clearStore(); DAY = 501;
  const l2 = P.recordMatchEnd(fakeGame('lose')).stars;
  clearStore();
  const w2 = P.recordMatchEnd(fakeGame('win')).stars;
  ok(w2 > l2, 'a win beats a loss (' + l2 + ' -> ' + w2 + ')');
  ok(w2 < l2 * 2, 'but by less than double — the payout must not be skill-gated');

  // The cap holds even on a perfect run. Without it, a long survival run is a payday and
  // the optimal play becomes "stall".
  clearStore();
  const huge = P.recordMatchEnd(fakeGame('win', {
    survival: true, survivalWave: 500,
    heroOf: { 1: { type: 'rook', level: 10 } },
    crystal: { hp: 100, maxHp: 100 },
  }));
  ok(huge.stars <= RC.STARS.cap + RC.STARS.daily, 'a perfect 500-wave run is still capped at ' + (RC.STARS.cap + RC.STARS.daily) + ', got ' + huge.stars);

  // Practice never pays.
  clearStore();
  ok(P.recordMatchEnd(fakeGame('win', { practice: true })) === null, 'practice matches pay nothing');

  // The daily bonus rolls over.
  clearStore();
  P.recordMatchEnd(fakeGame('win'));
  DAY = 502;
  const tomorrow = P.recordMatchEnd(fakeGame('lose'));
  ok(tomorrow.starLines.some(l => /first match today/i.test(l.why)), 'and it comes back the next day');
}

head('Cosmetics — shared inventory, per-hero equipment');
{
  clearStore();
  const P = RC.Profile;
  const w0 = P.wallet();
  ok(w0.stars === 0 && w0.owned.length === 0, 'a new wallet is empty');

  ok(P.buy('hat', 'crown').ok === false, 'you cannot buy a crown with no stars');
  const w = P.wallet(); w.stars = 500; P.saveWallet(w);

  ok(P.buy('hat', 'crown').ok === true, 'with stars, you can');
  ok(P.owns('hat', 'crown'), 'and it lands in the inventory');
  ok(P.buy('hat', 'crown').ok === false, 'buying it twice is refused');
  ok(P.wallet().stars === 500 - RC.cosmetic('hat', 'crown').stars, 'and it cost exactly its price');

  // The 'none' options are free and owned by everybody — otherwise every new player
  // would start with four rows of inventory that mean "no hat".
  ok(P.owns('hat', 'none') && P.owns('suit', 'none'), 'the bare options are owned by default');

  // Buying does NOT equip: the player may well have bought it for a different hero.
  ok(P.cosmeticsOf('rook').hat === 'none', 'buying does not silently dress anyone');

  ok(P.equip('rook', 'hat', 'crown') === true, 'the crown can be worn by Rook');
  ok(P.cosmeticsOf('rook').hat === 'crown', 'and it sticks');
  ok(P.cosmeticsOf('vale').hat === 'none', 'while Vale is still bare — equipment is PER HERO');
  ok(P.equip('vale', 'hat', 'crown') === true, 'the same crown fits Vale too — inventory is SHARED');
  ok(P.wallet().stars === 500 - RC.cosmetic('hat', 'crown').stars, 'and dressing the second hero cost nothing more');

  ok(P.equip('rook', 'hat', 'halo') === false, 'an unowned item cannot be equipped');
  ok(P.cosmeticsOf('rook').hat === 'crown', 'and the refusal left the old one alone');
  ok(P.equip('rook', 'nonsense', 'crown') === false, 'an unknown slot is refused');

  // A stored id for an item we later removed must not throw the menu.
  ok(RC.cosmetic('hat', 'was-removed-in-a-patch').id === 'none', 'an unknown item id resolves to the default');

  // An equipped item the wallet does not back is not worn. equip() already refuses one,
  // so this only fires when the two disagree — an edited save, or an item we retired —
  // and without it the first is a free cosmetic and the second is an item the shop
  // charges for while the hero is visibly already wearing it.
  const raw = P.heroes();
  raw.rook.cosmetics.suit = 'plate';        // never bought
  P.saveHeroes(raw);
  ok(P.cosmeticsOf('rook').suit === 'none', 'an equipped-but-unowned item does not render');
  ok(P.cosmeticsOf('rook').hat === 'crown', 'while the item that WAS bought still does');
  // Filtered on read, not repaired on disk — so putting the item back restores the look
  // the player left, rather than confiscating it.
  const w2 = P.wallet(); w2.owned.push('suit.plate'); P.saveWallet(w2);
  ok(P.cosmeticsOf('rook').suit === 'plate', 'and it comes back if the item does');

  // The pick round-trips, and an old id still lands on the right hero.
  P.setHeroPick('ember');
  ok(P.heroPick() === 'ember', 'the hero pick persists');
  P.setHeroPick('archon');
  ok(P.heroPick() === 'prism', 'and an old stored id resolves forward to Prism');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
