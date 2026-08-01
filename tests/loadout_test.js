// The Hero Bay — Mastery as breadth, never as budget
// ---------------------------------------------------------------------------
// HERO_DESIGN.md §2 states the rule this whole feature lives or dies by:
//
//     "Breadth persists. Budget doesn't."
//
// A player who has ground to Mastery 30 may bring DIFFERENT things than a player
// on Mastery 1. They must never bring MORE, and nothing they bring may be bigger.
// The moment that stops being true the game is pay-to-grind, and no amount of
// balance work anywhere else can undo it.
//
// That rule is not enforceable by reading the code — it is enforceable by these
// assertions, which is why they exist and why they are deliberately blunt:
//
//   1. THE COUNT NEVER MOVES — one Q, one E and exactly upSlots upgrades, at
//      Mastery 1 and at Mastery 30, for every hero.
//   2. THE NUMBERS NEVER MOVE — a Mastery-1 hero and a Mastery-30 hero with their
//      DEFAULT loadouts are byte-for-byte the same unit. This is the assertion
//      that would fail if anyone ever wired Mastery to a stat.
//   3. THE DEFAULT IS TODAY'S HERO — a player who never opens the Bay gets the
//      hero they had before any of this shipped.
//   4. LOCKED PICKS SUBSTITUTE, THEY DO NOT REFUSE — a save claiming an option
//      its Mastery has not earned quietly gets the base one.
//   5. A VARIANT IS A TRADE — it may only change fields the base skill already
//      declares, so it can never introduce a new mechanic the enemy cannot read.
//   6. WHAT YOU BROUGHT IS WHAT YOU GET — hasUp, effSig and the Crystal Defense
//      card pool all agree on the three you actually chose.
//
// Headless, against the real RC.Unit and the real RC.Profile, the same way
// roster_test and profile_test do.
global.window = global;

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
['config', 'maps', 'weather', 'pathfind', 'entities', 'game', 'ai', 'daily', 'keep', 'survival', 'kids', 'profile']
  .forEach(m => require('../' + m + '.js'));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const head = s => console.log('\n' + s);
const clearStore = () => { for (const k of Object.keys(store)) delete store[k]; };

const MAXM = RC.MASTERY.maxLevel;
const SLOTS = RC.LOADOUT.upSlots;

// A hero unit at a given level, optionally carrying a loadout.
function hero(type, level, lo) {
  const h = new RC.Unit(type, 500, 500, 1);
  if (lo !== undefined && h.setLoadout) h.setLoadout(lo);
  for (let i = 1; i < (level || 1); i++) h.level++;
  return h;
}

// ── 1. The count never moves ───────────────────────────────────────────────
head('1. The count never moves');
{
  let same = true, detail = '';
  for (const id of RC.HEROES) {
    const lo1 = RC.validLoadout(id, 1, null, false);
    const lo30 = RC.validLoadout(id, MAXM, null, false);
    if (lo1.ups.length !== SLOTS || lo30.ups.length !== SLOTS) { same = false; detail = id; }
    if (typeof lo1.q !== 'string' || typeof lo1.e !== 'string') { same = false; detail = id; }
  }
  ok(same, 'every hero brings 1 Q, 1 E and exactly ' + SLOTS + ' upgrades at M1 and M' + MAXM + (detail ? ' (' + detail + ')' : ''));

  // And the pool GROWS while the count stays put — that is the whole trade.
  const p1 = RC.loadoutPool('rook', 1, false);
  const p30 = RC.loadoutPool('rook', MAXM, false);
  const open = p => p.q.filter(o => o.open).length + p.e.filter(o => o.open).length + p.ups.filter(o => o.open).length;
  ok(open(p30) > open(p1), 'a Mastery ' + MAXM + ' rook has more options open (' + open(p30) + ') than a Mastery 1 one (' + open(p1) + ')');
  ok(p1.upSlots === p30.upSlots, 'the number of upgrade sockets is the same at both');
}

// ── 2. The numbers never move ──────────────────────────────────────────────
head('2. The numbers never move — Mastery grants no stats');
{
  // The load-bearing assertion of the entire feature. Two units of the same hero at
  // the same match level, one built as if by a brand-new account and one as if by a
  // maxed one, compared field by field on everything that decides a fight.
  const STATS = ['hp', 'maxHp', 'dmg', 'armor', 'shield', 'maxShield', 'range', 'speed',
                 'atkSpeed', 'energy', 'maxEnergy', 'sight', 'dr'];
  let bad = [];
  for (const id of RC.HEROES) {
    for (const lv of [1, 5, 10]) {
      const fresh = hero(id, lv, RC.validLoadout(id, 1, null, false));
      const vet = hero(id, lv, RC.validLoadout(id, MAXM, null, false));
      for (const k of STATS) {
        if ((fresh[k] || 0) !== (vet[k] || 0)) bad.push(id + '.' + k + ' @L' + lv);
      }
    }
  }
  ok(bad.length === 0, 'no stat differs between a Mastery 1 and a Mastery ' + MAXM + ' hero' + (bad.length ? ' — ' + bad.join(', ') : ''));

  // Cooldowns and energy costs are budget too, and a variant is explicitly forbidden
  // from touching them (config.js says so; this is the check that keeps it true).
  bad = [];
  for (const id of RC.HEROES) {
    const def = RC.UNITS[id];
    const pool = RC.loadoutPool(id, MAXM, true);
    for (const slot of ['q', 'e']) {
      const base = (def.skills || []).find(s => s.slot === slot);
      if (!base) continue;
      for (const v of pool[slot]) {
        if (v.base) continue;
        const h = hero(id, 6, { q: slot === 'q' ? v.id : 'base', e: slot === 'e' ? v.id : 'base', ups: [] });
        const eff = h.effSkill(base);
        if (eff.cd !== base.cd) bad.push(id + ' ' + v.id + ' cd');
        if (eff.cost !== base.cost) bad.push(id + ' ' + v.id + ' cost');
        if (eff.key !== base.key) bad.push(id + ' ' + v.id + ' key');
        if (eff.slot !== base.slot) bad.push(id + ' ' + v.id + ' slot');
      }
    }
  }
  ok(bad.length === 0, 'no skill variant changes cooldown, energy cost, key or slot' + (bad.length ? ' — ' + bad.join(', ') : ''));

  // And Mastery must not be able to REACH the unit. entities.js knowing about the
  // profile at all is the shape of the bug this rule exists to prevent.
  // Comments are stripped first: the file TALKS about Mastery a good deal (it has to,
  // the rule lives there), and what must not exist is a code path, not a mention.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'entities.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/RC\.Profile|mastery/i.test(src), 'no code in entities.js can reach Mastery or the profile');
}

// ── 3. The default is today's hero ─────────────────────────────────────────
head('3. The default is exactly the hero that shipped before this');
{
  let bad = [];
  for (const id of RC.HEROES) {
    const def = RC.UNITS[id];
    const d = RC.defaultLoadout(id);
    if (d.q !== 'base' || d.e !== 'base') bad.push(id + ' not base kit');
    const want = (def.sig.ups || []).slice(0, SLOTS).map(u => u.id);
    if (d.ups.join(',') !== want.join(',')) bad.push(id + ' ups ' + d.ups.join(',') + ' != ' + want.join(','));
  }
  ok(bad.length === 0, 'defaultLoadout is base Q, base E and the hero\'s own three upgrades' + (bad.length ? ' — ' + bad.join('; ') : ''));

  // A unit with no loadout at all and a unit with the default must be indistinguishable.
  // This is what makes the whole feature safe for every save, bot and mode that has
  // never heard of loadouts.
  bad = [];
  for (const id of RC.HEROES) {
    const def = RC.UNITS[id];
    for (const lv of [1, 4, 8]) {
      const old = hero(id, lv);                              // never told about loadouts
      const neu = hero(id, lv, RC.defaultLoadout(id));
      for (const sk of (def.skills || [])) {
        const a = JSON.stringify(old.effSkill(sk)), b = JSON.stringify(neu.effSkill(sk));
        if (a !== b) bad.push(id + '.' + sk.id + ' @L' + lv);
      }
      if (JSON.stringify(old.effSig()) !== JSON.stringify(neu.effSig())) bad.push(id + '.sig @L' + lv);
      for (const u of (def.sig.ups || [])) {
        if (old.hasUp(u.id) !== neu.hasUp(u.id)) bad.push(id + '.hasUp(' + u.id + ') @L' + lv);
      }
    }
  }
  ok(bad.length === 0, 'a hero with the default loadout is identical to one with no loadout' + (bad.length ? ' — ' + bad.join(', ') : ''));
}

// ── 4. Locked picks substitute, they do not refuse ─────────────────────────
head('4. A claim your Mastery has not earned is substituted, never rejected');
{
  const greedy = { q: 'quake', e: 'tarpit', ups: ['deep', 'great', 'wide'] };   // all M9+
  const got = RC.validLoadout('rook', 1, greedy, false);
  ok(got.q === 'base' && got.e === 'base', 'a Mastery 1 rook claiming Deep Quake and Tar Standard gets the base kit');
  ok(got.ups.length === SLOTS, 'and still gets a full ' + SLOTS + ' upgrades rather than the one it was entitled to');
  ok(got.ups.indexOf('deep') < 0 && got.ups.indexOf('great') < 0, 'none of them are the locked ones');

  const mid = RC.validLoadout('rook', 11, greedy, false);
  ok(mid.q === 'quake', 'at Mastery 11 the same claim keeps Deep Quake');
  ok(mid.e === 'base', 'but Tar Standard (Mastery 16) is still substituted');
  ok(mid.ups.indexOf('deep') >= 0, 'and Deep Dome (Mastery 9) is honoured');

  // Public versus opens everything for everybody — the claim cannot matter there.
  const free = RC.validLoadout('rook', 1, greedy, true);
  ok(free.q === 'quake' && free.e === 'tarpit', 'in a free pool a Mastery 1 claim is granted in full');
  ok(free.ups.indexOf('deep') >= 0 && free.ups.indexOf('great') >= 0, 'including the upgrades');

  // Rubbish in, playable hero out. Never an exception, never an empty loadout.
  const junk = [null, undefined, {}, { q: 5, e: [], ups: 'nope' }, { ups: ['x', 'x', 'x', 'x', 'x'] }];
  let survived = true;
  for (const j of junk) {
    const r = RC.validLoadout('vale', 7, j, false);
    if (!r || r.q !== 'base' || r.ups.length !== SLOTS || new Set(r.ups).size !== SLOTS) survived = false;
  }
  ok(survived, 'garbage from the wire folds down to a legal loadout with no duplicates');
}

// ── 5. A variant is a trade, not an addition ───────────────────────────────
head('5. A variant may only move numbers the base skill already declares');
{
  // Fields the catalogue itself owns, which every variant carries and which are not
  // part of the skill's mechanics.
  const META = new Set(['id', 'at', 'ic', 'name', 'kid', 'desc', 'open', 'base', 'slot', 'key', 'cost', 'cd', 'ult']);
  const bad = [];
  for (const id of RC.HEROES) {
    const def = RC.UNITS[id];
    const vars = (RC.LOADOUT.vars[id] || {});
    for (const slot of ['q', 'e']) {
      const base = (def.skills || []).find(s => s.slot === slot);
      if (!base) continue;
      for (const v of (vars[slot] || [])) {
        for (const k of Object.keys(v)) {
          if (META.has(k)) continue;
          if (!(k in base)) bad.push(id + '.' + v.id + ' introduces "' + k + '"');
        }
      }
    }
  }
  ok(bad.length === 0, 'no variant introduces a field its base skill does not have' + (bad.length ? ' — ' + bad.join('; ') : ''));

  // And it really does take effect — a check that the merge is wired, not just legal.
  const plain = hero('rook', 3, RC.defaultLoadout('rook'));
  const vault = hero('rook', 3, { q: 'vault', e: 'base', ups: RC.defaultLoadout('rook').ups });
  const q = (RC.UNITS.rook.skills || []).find(s => s.slot === 'q');
  ok(vault.effSkill(q).dist > plain.effSkill(q).dist, 'Long Vault really does leap further than the base Q');
  ok(vault.effSkill(q).dmg < plain.effSkill(q).dmg, 'and really does hit softer — the trade is a trade');
  ok(vault.effSkill(q).cd === plain.effSkill(q).cd, 'on the same cooldown');
}

// ── 6. What you brought is what you get ────────────────────────────────────
head('6. The upgrades you brought are the ones you hold');
{
  const lv = RC.HERO.upLevels[SLOTS - 1] + 2;   // high enough to hold all three
  const dflt = hero('rook', lv, RC.defaultLoadout('rook'));
  ok(dflt.hasUp('wide') && !dflt.hasUp('deep'), 'a default rook holds its own upgrades and not the Mastery ones');

  const custom = hero('rook', lv, { q: 'base', e: 'base', ups: ['deep', 'great', 'wide'] });
  ok(custom.hasUp('deep') && custom.hasUp('great'), 'a rook that brought Deep Dome and Great Dome holds them');
  ok(!custom.hasUp('long') && !custom.hasUp('shatter'), 'and does NOT hold the two it left at home');

  // This is the bug the feature shipped with for about ten minutes: effSig looped over
  // def.sig.ups only, so a brought Mastery upgrade was held, displayed, and inert.
  const a = dflt.effSig(), b = custom.effSig();
  ok(b.shield > a.shield, 'Deep Dome actually multiplies the shield (it is not just held)');
  ok(b.radius > a.radius, 'Great Dome actually widens the dome');
  ok(!!b.held.deep && !!b.held.great, 'and both report as held');

  // Every Mastery upgrade on every hero must reach effSig, not just rook's two.
  const bad = [];
  for (const id of RC.HEROES) {
    for (const up of (RC.LOADOUT.ups[id] || [])) {
      const base = hero(id, lv, RC.defaultLoadout(id));
      const with_ = hero(id, lv, { q: 'base', e: 'base', ups: [up.id].concat(RC.defaultLoadout(id).ups.slice(0, SLOTS - 1)) });
      if (JSON.stringify(with_.effSig()) === JSON.stringify(base.effSig())) bad.push(id + '.' + up.id);
    }
  }
  ok(bad.length === 0, 'every Mastery upgrade changes something in effSig' + (bad.length ? ' — ' + bad.join(', ') + ' does nothing' : ''));

  // Crystal Defense hands upgrades out as cards. The Bay has to decide WHICH cards.
  const g = new RC.Game();
  g.heroesEnabled = true;
  g.setHeroPick({ 1: 'rook' });
  g.setHeroLoadout({ 1: { q: 'base', e: 'base', ups: ['deep', 'great', 'wide'] } });
  g.setupKids({ race: 'forge' });
  const cards = RC.Kids.heroCards(g, 1).map(c => c.up);
  ok(cards.length === SLOTS, 'the card pool offers exactly the ' + SLOTS + ' upgrades this hero brought');
  ok(cards.indexOf('deep') >= 0 && cards.indexOf('great') >= 0, 'including the Mastery ones');
  ok(cards.indexOf('long') < 0 && cards.indexOf('shatter') < 0, 'and never offers one that was left at home');

  // The default path still offers the fixed three, so nothing changes for a player
  // who has never opened the Bay.
  const g2 = new RC.Game();
  g2.heroesEnabled = true;
  g2.setHeroPick({ 1: 'rook' });
  g2.setupKids({ race: 'forge' });
  const c2 = RC.Kids.heroCards(g2, 1).map(c => c.up);
  ok(c2.join(',') === RC.defaultLoadout('rook').ups.join(','), 'with no loadout set, the card pool is the three it always was');
}

// ── 7. The profile stores it, and the store cannot lie ─────────────────────
head('7. The profile round-trips a loadout, validated on the way out');
{
  clearStore();
  const id = 'rook';
  ok(JSON.stringify(RC.Profile.loadoutOf(id)) === JSON.stringify(RC.defaultLoadout(id)),
     'a fresh profile hands back the default loadout');

  RC.Profile.setSlot(id, 'q', 'vault');
  ok(RC.Profile.loadoutOf(id).q === 'base', 'a Mastery 1 rook cannot save Long Vault (Mastery 3)');

  // Raise the Mastery through the store, which is the only thing a match ultimately
  // does to it. (addMasteryXp takes a record, not an id — it is the internal step
  // recordMatchEnd runs, and calling it here would be testing the wrong seam.)
  { const hs = RC.Profile.heroes(); hs[id].mastery = 20; RC.Profile.saveHeroes(hs); }
  const m = RC.Profile.heroes()[id].mastery;
  ok(m === 20, 'a hero can reach Mastery 20 (now ' + m + ')');
  RC.Profile.setSlot(id, 'q', 'vault');
  ok(RC.Profile.loadoutOf(id).q === 'vault', 'and now the pick sticks');

  // Persistence: nothing here is cached in memory, so re-reading the store IS the
  // reload. Prove that by going round the raw record the way a new tab would.
  ok(JSON.parse(store['riftclash_heroes'])[id].loadout.q === 'vault', 'it is on disk, not just in memory');
  ok(RC.Profile.loadoutOf(id).q === 'vault', 'and it survives a reload');

  // Swapping a fourth upgrade in keeps the count at exactly SLOTS.
  RC.Profile.setSlot(id, 'ups', 'deep');
  RC.Profile.setSlot(id, 'ups', 'great');
  const ups = RC.Profile.loadoutOf(id).ups;
  ok(ups.length === SLOTS, 'bringing a fourth and a fifth upgrade still leaves exactly ' + SLOTS);
  ok(ups.indexOf('deep') >= 0 && ups.indexOf('great') >= 0, 'and the two most recent picks are the ones kept');

  // Cosmetic gifts: granted by Mastery, checked against the ACCOUNT's top hero because
  // the wardrobe inventory is shared.
  ok(RC.Profile.owns('palette', 'ash'), 'the Mastery 2 palette is owned outright, unbought');
  ok(RC.masteryGifts(1).length === 0, 'and a Mastery 1 account has been given nothing yet');
}

// ── 8. The promise on the start screen points at something real ────────────
head('8. nextUnlock always names a real thing, or nothing at all');
{
  let bad = [];
  for (const id of RC.HEROES) {
    let last = 0;
    for (let m = 1; m < MAXM; m++) {
      const n = RC.nextUnlock(id, m);
      if (!n) { bad.push(id + ' has nothing at M' + m); break; }
      if (n.at <= m) bad.push(id + ' @M' + m + ' points backwards to ' + n.at);
      if (n.at < last) bad.push(id + ' @M' + m + ' went backwards');
      if (!n.name) bad.push(id + ' @M' + m + ' unnamed');
      last = n.at;
    }
    if (RC.nextUnlock(id, MAXM)) bad.push(id + ' still promises something at the ceiling');
  }
  ok(bad.length === 0, 'every hero has a next unlock at every level below the cap, and none at it' + (bad.length ? ' — ' + bad.slice(0, 4).join('; ') : ''));
}

console.log('\n' + (fail ? '✗' : '✓') + ' loadout: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
