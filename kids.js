// RIFT CLASH — Kids mode rules (pure sim, no DOM)
// ---------------------------------------------------------------------------
// Survival with the RTS taken out of it. The whole mode is one sentence a
// six-year-old can repeat back: "bad guys walk at my crystal, I buy fighters to
// stop them, and I get a present after every wave."
//
// What is DELIBERATELY absent, and why:
//   · no workers, no shard nodes, no gathering  — income just ticks up. A kid who
//     forgets to mine should never quietly lose ten minutes later for a mistake
//     they made in minute one.
//   · no base building, no supply buildings, no tech tree — three concepts a kid
//     has to hold at once before the first fight, all of them invisible to the
//     actual goal.
//   · no build placement — nothing to put down means nothing to put down wrong.
//
// What replaces them:
//   · THREE buttons. Tank / Archer / Support, per faction, bought straight from
//     the base. More types unlock on a fixed wave schedule so the roster grows on
//     its own without the kid going looking for it.
//   · ONE choice after every wave, from three cards. This is the reward loop and
//     it is the point of the mode — the game stops, says well done, and hands
//     over a decision small enough to make in four seconds.
//   · WAVE FLAVOURS. Every wave has a name and a colour. Runner Rush, Big Guy,
//     Sky Swarm. Variety a kid can see coming rather than a number going up.
//
// This file is pure logic and holds no DOM references, exactly like survival.js,
// so tests/kidstest.js can drive a whole run headlessly under Node. The screen
// half lives in kidsui.js.
window.RC = window.RC || {};

RC.Kids = (function () {
  const ENEMY = 2;          // owner id of the horde (same as Survival)

  const CFG = {
    PREP: 22,               // seconds before wave 1 — long enough to buy a first squad
    GAP: 4,                 // seconds after the reward card is picked before the next wave
    SPAWN_STEP: 0.30,       // seconds between individual spawns (slower than Survival — easier to read)
    INCOME: 15,             // shards per second, before card upgrades
    START_SHARD: 220,       // enough for two fighters immediately
    POP: 40,                // fixed population cap — no supply buildings to think about
    CRYSTAL_HP: 5200,       // a bit beefier than Survival's 4000; a kid needs room to make mistakes
    WAVE_HEAL: 0.07,        // crystal heals this fraction of max on every wave cleared
    COST_MUL: 0.55,         // kid prices, as a fraction of the normal card cost
    TIME_MUL: 0.35,         // kid build times, likewise — waiting is not the fun part
    QUEUE_MAX: 6,
    BOSS_HP: 5,             // Big Guy health multiplier
    CELEB: 2.6,             // seconds the wave-clear celebration holds the screen
    PICK: 15,               // co-op only: seconds to pick a reward before one is picked for you
  };

  // ── Attack lanes ──────────────────────────────────────────────────────────
  // Which wave each lane on the map opens on. One direction at the start, because a
  // young player has to learn "they come from over there, I stand here" before anything
  // else. By wave 14 the crystal is surrounded and holding a single side stops being a
  // strategy. Every opening is announced: an unwatched flank is only unfair if nobody
  // told you it existed.
  //
  // The gaps are wide (3, then 5, then 5 waves) because a wider fight is a much harder
  // fight: measured against the old single-lane mode, a passive player who buys constantly
  // but never manoeuvres dropped from ~14 waves cleared to ~9 on the first schedule tried,
  // [1,3,6,10]. Stretching it puts the whole early game back where it was and leaves the
  // 360° squeeze for the deep run, where a kid has already learned to move their army.
  //
  // Survival is untouched and still uses the map's single western enemySpawn — a lane
  // you can wall off with turrets is the point of that mode.
  const LANE_AT = [1, 4, 9, 14];
  function laneCount(w) {
    let n = 1;
    for (let i = 0; i < LANE_AT.length; i++) if (w >= LANE_AT[i]) n = i + 1;
    return n;
  }
  function lanesOf(g) {
    const m = g.survivalMap || {};
    if (m.guardLanes && m.guardLanes.length) return m.guardLanes;
    return [g.enemySpawn || { id: 'west', x: 0, y: 0 }];     // a map with no lanes keeps one approach
  }
  function openLanes(g, w) {
    const all = lanesOf(g);
    return all.slice(0, Math.max(1, Math.min(laneCount(w), all.length)));
  }
  // Screen words, not compass words. The camera never rotates, so "look left" is
  // something a six-year-old can act on immediately and "look west" is not.
  const LANE_WORDS = { west: 'left', east: 'right', north: 'top', south: 'bottom' };
  function laneName(lane) { return (lane && (LANE_WORDS[lane.id] || lane.id)) || 'other side'; }

  // A spawn point on `lane`, spread ACROSS the approach rather than along it, so a
  // wave walks in line abreast instead of trickling out single file. The spread runs
  // perpendicular to the lane->crystal vector, which is what lets one helper serve a
  // lane on any side of the map instead of needing per-side special cases.
  function laneSpawn(g, lane) {
    const c = g.crystal || lane;
    let dx = c.x - lane.x, dy = c.y - lane.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const along = Math.random() * 120 - 60;
    const across = Math.random() * 440 - 220;
    const M = 120;                                           // stay clear of the world edge
    const W = (g.world && g.world.w) || 3400, H = (g.world && g.world.h) || 1600;
    return {
      x: Math.max(M, Math.min(W - M, lane.x + dx * along - dy * across)),
      y: Math.max(M, Math.min(H - M, lane.y + dy * along + dx * across)),
    };
  }

  // ── Roster ────────────────────────────────────────────────────────────────
  // Three starters per faction, then a fixed unlock ladder. The starters are
  // chosen so the three buttons read as three obviously different JOBS at a
  // glance — a fat slow one, a long-range one, and a helper — because that is the
  // first strategic idea in the game and it should arrive for free.
  //
  // Gloop has no healer by design (its identity is cheap self-healing swarms), so
  // its third slot is a Swarm rather than a Support. The label follows the unit.
  const KITS = {
    forge: {
      starters: [
        { t: 'shielder', role: 'Tank',    ic: '🛡️', blurb: 'Soaks up hits at the front.' },
        { t: 'spark',    role: 'Archer',  ic: '🏹', blurb: 'Hits hard from far away.' },
        { t: 'patch',    role: 'Support', ic: '💚', blurb: 'Heals your other fighters.' },
      ],
      unlocks: ['volt', 'chaingunner', 'hover', 'pulse', 'heli', 'jet'],
    },
    gloop: {
      starters: [
        { t: 'bloat',    role: 'Tank',   ic: '🛡️', blurb: 'Big and squishy. Explodes when it dies!' },
        { t: 'spitter',  role: 'Archer', ic: '🏹', blurb: 'Spits acid from far away.' },
        { t: 'globling', role: 'Swarm',  ic: '🐛', blurb: 'Cheap and fast. Bring lots.' },
      ],
      unlocks: ['hydra', 'floater'],
    },
    aether: {
      starters: [
        { t: 'ardent',  role: 'Tank',    ic: '🛡️', blurb: 'Shielded warrior. Charges in first.' },
        { t: 'lancer',  role: 'Archer',  ic: '🏹', blurb: 'Long-range shielded striker.' },
        { t: 'oracle',  role: 'Support', ic: '💚', blurb: 'Recharges your shields and health.' },
      ],
      unlocks: ['bladesworn', 'bastion', 'seraph'],
    },
  };
  // The wave each unlock slot opens on. Front-loaded: the first new toy arrives
  // at wave 3, while the mode still has a kid's full attention.
  const UNLOCK_WAVES = [3, 5, 8, 11, 14, 17];

  function kitOf(race) { return KITS[race] || KITS.forge; }

  // ── Defenders ─────────────────────────────────────────────────────────────
  // One offline, two in online co-op. Everything a defender owns PRIVATELY — income
  // rate, which fighters they have unlocked, which cards they have taken, and which
  // three they are currently being offered — hangs off per(g, owner). Only the wave
  // counter, the horde and the crystal are shared.
  //
  // Two kids sharing one reward pick was the alternative, and it makes the mode worse
  // for both: the slower one never gets to choose, and the whole appeal is being handed
  // a decision of your own after every wave.
  function defenders(g) {
    if (g.players && g.players.length) {
      const out = g.players.filter(p => p.owner !== ENEMY && !p.waveEnemy).map(p => p.owner);
      if (out.length) return out;
    }
    return [g.playerOwner];
  }
  function per(g, owner) {
    const s = st(g);
    if (owner == null) owner = g.playerOwner;
    s.pl = s.pl || {};
    return s.pl[owner] || (s.pl[owner] = {
      incomeMul: 1, unlocked: [], taken: {}, offer: null, freshUnlock: null,
      picked: false, bought: 0,
    });
  }
  // The building a given defender buys from. g.kidsBase stays pointed at the local
  // player's so existing UI and saves keep working untouched.
  function baseOf(g, owner) {
    if (owner == null) owner = g.playerOwner;
    return (g.kidsBases && g.kidsBases[owner]) || (owner === g.playerOwner ? g.kidsBase : null);
  }

  // Kid prices. Derived from the real card rather than hand-typed, so a balance
  // pass on config.js carries into Kids mode instead of silently drifting.
  function costOf(type) {
    const d = RC.UNITS[type];
    if (!d) return 50;
    return Math.max(25, Math.round(d.cost * CFG.COST_MUL / 5) * 5);
  }
  function timeOf(type) {
    const d = RC.UNITS[type];
    if (!d) return 5;
    return Math.max(3, Math.round(d.time * CFG.TIME_MUL));
  }

  // Everything the player is allowed to buy right now — the three starters plus
  // whatever the wave counter has opened up.
  function roster(g, owner) {
    if (owner == null) owner = g.playerOwner;
    const race = g.raceOf ? g.raceOf(owner) : 'forge';
    const kit = kitOf(race);
    const out = kit.starters.map(s => ({
      t: s.t, role: s.role, ic: s.ic, blurb: s.blurb,
      name: (RC.UNITS[s.t] || {}).name || s.t,
      cost: costOf(s.t), time: timeOf(s.t), isNew: false,
    }));
    const p = per(g, owner);
    for (const t of (p.unlocked || [])) {
      const d = RC.UNITS[t];
      if (!d) continue;
      out.push({
        t, role: d.role || 'Fighter', ic: d.flying ? '✈️' : '⭐', blurb: d.desc || '',
        name: d.name, cost: costOf(t), time: timeOf(t), isNew: p.freshUnlock === t,
      });
    }
    return out;
  }

  // ── Horde ─────────────────────────────────────────────────────────────────
  // A much later, much flatter unlock ladder than Survival's. Air arrives at wave
  // 11 rather than 10 and heavies at 18 rather than 8, because "I need a different
  // KIND of fighter now" is a lesson that has to land after the basic loop is
  // comfortable, not during it.
  const ROSTER = [
    { t: 'globling', at: 1,  w: 3.0 },
    { t: 'volt',     at: 3,  w: 2.2 },
    { t: 'spitter',  at: 5,  w: 1.8 },
    { t: 'shielder', at: 7,  w: 1.4 },
    { t: 'ardent',   at: 9,  w: 1.3 },
    { t: 'floater',  at: 11, w: 1.1, air: true },
    { t: 'bloat',    at: 13, w: 1.1, heavy: true },
    { t: 'heli',     at: 15, w: 0.9, air: true },
    { t: 'lancer',   at: 17, w: 0.9 },
    { t: 'bastion',  at: 20, w: 0.7, heavy: true },
  ];
  const RAMP = 4;           // waves for a new type to reach its full share

  // Wave size — near-linear and capped low. Wave 1 is 2 enemies, wave 10 is 10,
  // wave 20 is 18. Survival's medium curve is at 34 by wave 20; this is not that
  // game and is not trying to be.
  // Left alone on purpose. Shrinking the wave as lanes open was the obvious way to pay
  // for the harder 360° fight, and it measurably does not work: income is per-second, so
  // smaller waves end sooner, the player earns less between them, and the weaker army
  // cancels out the smaller horde almost exactly (~10 waves either way). What the extra
  // directions actually cost is COVERAGE, so that is what gets compensated — see the
  // rally point in game.js and the lane schedule above.
  function waveSize(w) {
    return Math.max(2, Math.min(30, Math.round(2 + 0.85 * Math.max(0, w - 1))));
  }

  // Enemy health. Flat for the first five waves so the opening is a genuine
  // warm-up, then a shallow climb.
  function hpMul(w) { return 0.70 * (1 + 0.06 * Math.max(0, w - 5)); }

  function weightAt(e, w) {
    if (w < e.at) return 0;
    return e.w * Math.min(1, 0.25 + 0.75 * (w - e.at) / RAMP);
  }

  // ── Wave flavours ─────────────────────────────────────────────────────────
  // Every wave gets a name, an icon and a colour. This is the cheapest possible
  // variety: the SIM barely changes, but the wave stops being "a bigger number"
  // and becomes a thing the kid recognises and has an opinion about.
  const FLAVOURS = {
    normal:  { id: 'normal',  name: 'Wave',        ic: '⚔️', col: '#63c7ff' },
    runners: { id: 'runners', name: 'Runner Rush', ic: '💨', col: '#5ddc7a',
               sizeMul: 1.5, hpMul: 0.55, speed: 1.35, only: 'globling',
               tip: 'Lots of fast little ones!' },
    big:     { id: 'big',     name: 'Big Guy',     ic: '🪨', col: '#ff9b3d',
               sizeMul: 0.6, boss: true,
               tip: 'One huge enemy. Gang up on it!' },
    // Sky Swarm is deliberately the SMALLEST wave. Flyers ignore terrain and walk
    // straight over the army the kid has parked in front of the crystal, so an
    // air wave of the same size as a ground wave lands roughly three times the
    // damage. Playtesting a relentless-buy run showed wave 16 taking the crystal
    // from 100% to 34% in one go at full size — a cliff, not a step.
    sky:     { id: 'sky',     name: 'Sky Swarm',   ic: '🕊️', col: '#b98cff',
               air: true, sizeMul: 0.55, tip: 'They fly right over your army!' },
  };

  // Most specific first. Sky only fires once flyers actually exist in the horde,
  // so the tip never lies about what is coming.
  function flavourFor(w) {
    if (w >= 12 && w % 8 === 0) return FLAVOURS.sky;
    if (w >= 6 && w % 6 === 0) return FLAVOURS.big;
    if (w >= 4 && w % 4 === 0) return FLAVOURS.runners;
    return FLAVOURS.normal;
  }
  function waveLabel(w) {
    const f = flavourFor(w);
    return f.id === 'normal' ? ('Wave ' + w) : (f.name + ' — Wave ' + w);
  }

  function compose(w) {
    const f = flavourFor(w);
    let count = Math.max(1, Math.round(waveSize(w) * (f.sizeMul || 1)));

    // Runner Rush is one type only — that is what makes it read as a rush.
    if (f.only) {
      const list = [];
      for (let i = 0; i < count; i++) list.push(f.only);
      return list;
    }

    const pool = [];
    let total = 0;
    for (const e of ROSTER) {
      if (f.air && !e.air) continue;                 // Sky Swarm — flyers only
      const wt = weightAt(e, w);
      if (wt > 0) { pool.push({ t: e.t, wt }); total += wt; }
    }
    if (!pool.length) { pool.push({ t: 'globling', wt: 1 }); total = 1; }

    const list = [];
    for (let i = 0; i < count; i++) {
      let r = Math.random() * total, pick = pool[pool.length - 1].t;
      for (const e of pool) { r -= e.wt; if (r <= 0) { pick = e.t; break; } }
      list.push(pick);
    }
    return list;
  }

  // ── Reward cards ──────────────────────────────────────────────────────────
  // Three offered, one taken, after every single wave. Each card is one sentence
  // and one visible effect. `max` caps how many times a card can ever be taken so
  // the pool keeps refreshing instead of collapsing onto one best answer — a kid
  // taking the same card nine times in a row is the mode failing, not the kid.
  //
  // `apply` takes the OWNER who picked it. Most cards are private — upgrades and income
  // land on that defender's own army — while `shared: true` marks the ones that act on
  // the crystal both players are standing on. Shared cards are still picked privately;
  // what shared changes is who benefits, and the card text says so.
  const CARDS = [
    { id: 'atk',    ic: '⚔️', name: 'Sharper Shots',  desc: 'All your fighters hit harder.',      max: 3,
      apply: (g, o) => g.applyUpgrade(o, 'atk') },
    { id: 'arm',    ic: '🛡️', name: 'Thicker Armour', desc: 'All your fighters take less damage.', max: 3,
      apply: (g, o) => g.applyUpgrade(o, 'arm') },
    { id: 'tough',  ic: '❤️', name: 'Bigger Hearts',  desc: 'All your fighters get more health.',  max: 3,
      apply: (g, o) => g.applyUpgrade(o, 'tough') },
    { id: 'spd',    ic: '⚡', name: 'Speed Boost',    desc: 'All your fighters move and shoot faster.', max: 2,
      apply: (g, o) => g.applyUpgrade(o, 'spd') },
    { id: 'crit',   ic: '🎯', name: 'Lucky Hits',     desc: 'Sometimes your shots do double damage!', max: 3,
      apply: (g, o) => g.applyUpgrade(o, 'crit') },
    { id: 'frost',  ic: '❄️', name: 'Frosty Shots',   desc: 'Your shots freeze enemies slow.',     max: 2,
      apply: (g, o) => g.applyUpgrade(o, 'frost') },
    { id: 'income', ic: '💎', name: 'Shard Rush',     desc: 'Shards come in 25% faster, forever.', max: 5,
      apply: (g, o) => { const p = per(g, o); p.incomeMul = (p.incomeMul || 1) + 0.25; } },
    { id: 'heal',   ic: '💖', name: 'Crystal Mend',   desc: 'Repair the crystal right now.',       max: 99, shared: true,
      apply: (g) => { const c = g.crystal; if (c) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.35); } },
    { id: 'shell',  ic: '✨', name: 'Crystal Shell',  desc: 'The crystal gets more maximum health.', max: 4, shared: true,
      apply: (g) => { const c = g.crystal; if (!c) return; const add = Math.round(CFG.CRYSTAL_HP * 0.15); c.maxHp += add; c.hp += add; } },
    { id: 'squad',  ic: '🎁', name: 'Free Squad',     desc: 'Three free fighters, right away!',    max: 99,
      apply: (g, o) => freeSquad(g, 3, o) },
    { id: 'bank',   ic: '🏦', name: 'Shard Chest',    desc: 'A big pile of shards, right now.',    max: 99,
      apply: (g, o) => { if (g.res[o]) g.res[o].shard += 350; } },
  ];

  // How many times a card has already been taken this run BY THIS DEFENDER. Per player,
  // so one kid maxing out Sharper Shots does not empty the other kid's card pool.
  function taken(g, id, owner) { const p = per(g, owner); return (p.taken && p.taken[id]) || 0; }

  // Three distinct cards the player can still benefit from. `heal` is filtered out
  // at full health — offering a repair to an undamaged crystal is a wasted choice,
  // and a wasted choice teaches a kid that the cards do not matter.
  function offer(g, owner) {
    const pool = CARDS.filter(c => {
      if (taken(g, c.id, owner) >= c.max) return false;
      if (c.id === 'heal' && g.crystal && g.crystal.hp >= g.crystal.maxHp * 0.95) return false;
      return true;
    });
    const out = [];
    const bag = pool.slice();
    while (out.length < 3 && bag.length) {
      out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    }
    return out.map(c => ({ id: c.id, ic: c.ic, name: c.name, desc: c.desc,
                           tier: taken(g, c.id, owner) + 1, max: c.max, shared: !!c.shared }));
  }

  // One defender takes their card. Everyone picks from their OWN three and nobody waits
  // on anybody; the wave only resumes once every defender has taken something (or the
  // co-op timer picked for them).
  function choose(g, id, owner) {
    const s = st(g);
    if (s.phase !== 'reward') return false;
    if (owner == null) owner = g.playerOwner;
    const p = per(g, owner);
    if (p.picked) return false;                                      // one card per wave, per player
    const card = CARDS.find(c => c.id === id);
    if (!card) return false;
    if (!p.offer || !p.offer.some(o => o.id === id)) return false;    // only from what was offered
    card.apply(g, owner);
    p.taken = p.taken || {};
    p.taken[id] = (p.taken[id] || 0) + 1;
    p.offer = null;
    p.picked = true;
    if (owner === g.playerOwner) {
      banner(g, '🎁', card.name + '!', card.desc, '#ffd24a', 2.0);
      if (RC.Audio) RC.Audio.play('ready');
    }
    finishReward(g);
    return true;
  }

  // Nobody chose in time. Taking the first offered card rather than nothing at all is
  // deliberate: a co-op run must not stall on an AFK player, and an empty-handed wave
  // reads to a kid as the game forgetting to give them their present.
  function autoPick(g, owner) {
    const p = per(g, owner);
    if (p.picked || !p.offer || !p.offer.length) { p.picked = true; return; }
    choose(g, p.offer[0].id, owner);
  }

  // Advance out of the reward phase once every defender holds a card.
  function finishReward(g) {
    const s = st(g);
    if (s.phase !== 'reward') return;
    if (!defenders(g).every(o => per(g, o).picked)) return;
    s.phase = 'gap';
    s.timer = CFG.GAP;
    if (g.paused && s.autoPaused) { g.paused = false; s.autoPaused = false; }
    // Tell the kid what is coming BEFORE it arrives. A tip that appears at the same
    // moment as the wave is a caption, not a warning — no time to act on it.
    const nf = flavourFor(s.wave + 1);
    s.preview = nf.id === 'normal' ? null : { ic: nf.ic, name: nf.name, tip: nf.tip, col: nf.col };
  }

  // Free Squad — one of each currently affordable-to-exist type, cycled, dropped
  // straight onto the field rather than into the build queue. Instant gratification
  // is the entire appeal of the card.
  function freeSquad(g, n, owner) {
    if (owner == null) owner = g.playerOwner;
    const list = roster(g, owner);
    if (!list.length) return;
    const home = baseOf(g, owner) || g.crystal;
    if (!home) return;
    for (let i = 0; i < n; i++) {
      const pick = list[i % list.length].t;
      const u = new RC.Unit(pick, home.x + (Math.random() * 120 - 60), home.y + home.h / 2 + 40 + Math.random() * 40, owner);
      if (g.initUnit) g.initUnit(u);
      u.free = true;                     // does not count against the population cap
      g.units.push(u);
    }
    g.fx.push({ abil: 'warp', ax: home.x, ay: home.y, t: 0.5, radius: 90, owner });
  }

  // ── Buying ────────────────────────────────────────────────────────────────
  // Deliberately NOT g.train(): kid prices and kid build times live here, and the
  // production building is the base the kid is already looking at.
  function buy(g, type, owner) {
    if (owner == null) owner = g.playerOwner;
    const s = st(g);
    // Only ever complain to the player who pressed the button. Online the other
    // defender's failed purchase would otherwise pop a notice on this screen.
    const mine = owner === g.playerOwner;
    const say = (m) => { if (mine) g.notify(m); };
    const allowed = roster(g, owner).some(r => r.t === type);
    if (!allowed) return false;
    const b = baseOf(g, owner);
    if (!b || b.dead || !b.done) return false;
    if (b.queue.length >= CFG.QUEUE_MAX) { say('Too many on the way — wait a moment'); return false; }
    const cost = costOf(type);
    if (!g.res[owner] || g.res[owner].shard < cost) { say('Not enough shards yet'); return false; }
    const sup = g.supply(owner);
    const d = RC.UNITS[type];
    if (sup.used + d.supply > sup.max) { say('Your army is full!'); return false; }
    g.res[owner].shard -= cost;
    const t = timeOf(type);
    b.queue.push({ type, timeLeft: t, total: t });
    if (RC.Audio && mine) RC.Audio.play('build');
    s.bought = (s.bought || 0) + 1;
    const p = per(g, owner);
    p.bought = (p.bought || 0) + 1;
    return true;
  }

  // ── Run state ─────────────────────────────────────────────────────────────
  // Lives on the game (g._kd), never in module scope, so two runs can never share
  // a wave counter. Cleared by game.reset().
  function st(g) {
    if (!g._kd) {
      g._kd = {
        wave: 0, phase: 'prep', timer: CFG.PREP, queue: [], spawnT: 0,
        preview: null, celebT: 0, banner: null, bought: 0, best: 0, autoPaused: false,
        lanes: 1, pl: {},
        // Two or more humans defending. Set here from the roster rather than read off
        // RC.online, so a headless test and the server agree with the browser.
        coop: false,
      };
      g._kd.coop = defenders(g).length > 1;
    }
    return g._kd;
  }

  // The big on-screen message. Pure presentation, read by kidsui.js; the sim never
  // branches on it, so a client that ignores it stays in sync.
  function banner(g, ic, title, sub, col, dur) {
    st(g).banner = { ic, title, sub: sub || '', col: col || '#63c7ff', t: dur || 2.4, max: dur || 2.4 };
  }

  function countEnemies(g) {
    let n = 0;
    for (const u of g.units) if (u.owner === ENEMY && !u.dead) n++;
    return n;
  }

  function startWave(g) {
    const s = st(g);
    s.wave++;
    g.survivalWave = s.wave;              // the HUD wave counter and end screen read this
    s.queue = compose(s.wave);
    s.spawnT = 0;
    s.phase = 'spawning';
    s.freshUnlock = null;
    s.preview = null;

    // A new unit type, if this wave is on the ladder. Each defender unlocks from their
    // OWN faction kit — in co-op the two players may not be the same race, and handing
    // one of them the other's fighter is both wrong and unbuildable.
    const slot = UNLOCK_WAVES.indexOf(s.wave);
    let myUnlock = null;
    if (slot >= 0) {
      for (const o of defenders(g)) {
        const p = per(g, o);
        p.freshUnlock = null;
        const race = g.raceOf ? g.raceOf(o) : 'forge';
        const t = kitOf(race).unlocks[slot];
        if (t && RC.UNITS[t] && p.unlocked.indexOf(t) < 0) {
          p.unlocked.push(t);
          p.freshUnlock = t;
          if (o === g.playerOwner) myUnlock = t;
        }
      }
    } else {
      for (const o of defenders(g)) per(g, o).freshUnlock = null;
    }
    if (myUnlock) {
      banner(g, '🔓', 'NEW FIGHTER!', RC.UNITS[myUnlock].name + ' unlocked — check your buttons', '#5ddc7a', 3.2);
      if (RC.Audio) RC.Audio.play('levelup');
    }

    // A lane opening outranks the wave name in the banner queue: being told the shape
    // of the fight has changed matters more than being told what it is called.
    const lanes = openLanes(g, s.wave);
    const opened = lanes.length > (s.lanes || 1) ? lanes[lanes.length - 1] : null;
    s.lanes = lanes.length;
    if (opened) {
      banner(g, '🧭', 'NEW DIRECTION!', 'They are coming from the ' + laneName(opened) + ' too — turn around!', '#ff9f43', 3.4);
      if (RC.Audio) RC.Audio.play('alarm');
      // An arrow the player can follow, not just a line of text. A flank that opens
      // off-screen is the one thing in this mode that can lose a run without warning.
      if (g.markAlert) g.markAlert(opened.x, opened.y, '🧭 They are coming from the ' + laneName(opened) + ' now!');
    }

    const f = flavourFor(s.wave);
    if (!myUnlock && !opened) banner(g, f.ic, waveLabel(s.wave), f.tip || 'Here they come!', f.col, 2.4);
    g.notify(f.ic + ' ' + waveLabel(s.wave));
    if (RC.Audio) RC.Audio.play('wave');
  }

  function spawnOne(g) {
    const s = st(g);
    const type = s.queue.shift();
    const f = flavourFor(s.wave);
    // Round-robin across the open lanes rather than picking at random, so a wave is
    // always split evenly. Randomising it means a four-lane wave regularly arrives
    // almost entirely down one side, which reads as the lanes not working.
    const lanes = openLanes(g, s.wave);
    const lane = lanes[(s.spawnN = (s.spawnN || 0) + 1) % lanes.length];
    const at = laneSpawn(g, lane);
    const u = new RC.Unit(type, at.x, at.y, ENEMY);

    const mul = hpMul(s.wave) * (f.hpMul || 1);
    u.baseMaxHp = u.def.hp * mul;
    u.maxHp = Math.round(u.def.hp * mul);
    u.hp = u.maxHp;
    if (u.maxShield) {
      u.baseMaxShield = u.def.shield * mul;
      u.maxShield = Math.round(u.def.shield * mul);
      u.shield = u.maxShield;
    }
    if (f.speed) u.speedMul = f.speed;

    // Big Guy — the last one out of the gate is the boss, so the kid sees the
    // little ones first and the big one arriving behind them.
    if (f.boss && !s.queue.length) {
      u.maxHp = Math.round(u.maxHp * CFG.BOSS_HP);
      u.baseMaxHp = u.maxHp;
      u.hp = u.maxHp;
      u.kidsBoss = true;
    }

    if (g.initUnit) g.initUnit(u);
    g.units.push(u);
    u.attackMoveTo(g.crystal.x, g.crystal.y);
  }

  function clearedWave(g) {
    const s = st(g);
    s.phase = 'celebrate';
    s.celebT = CFG.CELEB;
    s.best = Math.max(s.best || 0, s.wave);

    // Between-wave crystal repair. A kid who had a bad wave is not carrying that
    // damage for the rest of the run.
    const c = g.crystal;
    if (c && !c.dead) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * CFG.WAVE_HEAL);

    banner(g, '🎉', 'WAVE ' + s.wave + ' CLEARED!', 'Nice work — pick your reward', '#ffd24a', CFG.CELEB);
    party(g);
    if (RC.Audio) RC.Audio.play('win');
    g.shake(0.12);
  }

  // Confetti. Rendered by renderer.js drawParty(); purely cosmetic, so a client
  // that does not know the fx kind just draws nothing and stays in sync.
  function party(g) {
    const c = g.crystal;
    if (!c) return;
    g.fx.push({ party: 1, ax: c.x, ay: c.y - 40, t: 2.2, life: 2.2, n: 46 });
    for (const o of defenders(g)) {
      const b = baseOf(g, o);
      if (b) g.fx.push({ party: 1, ax: b.x, ay: b.y - 30, t: 1.8, life: 1.8, n: 26 });
    }
  }

  // Keep the horde walking at the crystal.
  function steer(g) {
    if (!g.crystal || g.crystal.dead) return;
    for (const u of g.units) {
      if (u.owner !== ENEMY || u.dead) continue;
      if (u.state === 'idle') u.attackMoveTo(g.crystal.x, g.crystal.y);
    }
  }

  // ── Tick ──────────────────────────────────────────────────────────────────
  function update(dt, g) {
    const s = st(g);
    if (g.over) return;

    // Automatic income. The single biggest thing that makes this mode playable by
    // a kid: there is no economy to forget about. Each defender earns on their own
    // Shard Rush multiplier, so one player's card never funds the other.
    for (const o of defenders(g)) {
      if (g.res[o]) g.res[o].shard += CFG.INCOME * (per(g, o).incomeMul || 1) * dt;
    }

    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    if (!g.crystal || g.crystal.dead) return;

    switch (s.phase) {
      case 'prep':
        s.timer -= dt;
        if (s.timer <= 0) startWave(g);
        break;

      case 'spawning':
        s.spawnT -= dt;
        if (s.spawnT <= 0) { spawnOne(g); s.spawnT = CFG.SPAWN_STEP; }
        if (!s.queue.length) s.phase = 'fighting';
        break;

      case 'fighting':
        if (countEnemies(g) === 0) clearedWave(g);
        break;

      case 'celebrate':
        s.celebT -= dt;
        if (s.celebT <= 0) {
          // Deal each defender their own three cards.
          let any = false;
          for (const o of defenders(g)) {
            const p = per(g, o);
            p.offer = offer(g, o);
            p.picked = !p.offer.length;                                  // pool exhausted for them
            if (!p.picked) any = true;
          }
          if (!any) { s.phase = 'gap'; s.timer = CFG.GAP; }
          else {
            s.phase = 'reward';
            s.timer = CFG.PICK;
            // Solo keeps the modal pause — a kid should be able to read three cards
            // with the world stopped. Co-op cannot: the server never stops ticking and
            // one player's card screen must not freeze the other player's fight. There
            // the pick runs on a timer instead.
            if (!s.coop) { g.paused = true; s.autoPaused = true; }
          }
        }
        break;

      case 'reward':
        if (s.coop) {
          s.timer -= dt;
          if (s.timer <= 0) for (const o of defenders(g)) autoPick(g, o);
        } else if (!g.paused) {
          // Something else unpaused the game (the P key, the pause button). The solo
          // card screen is modal, so put it back.
          g.paused = true; s.autoPaused = true;
        }
        finishReward(g);
        break;

      case 'gap':
        s.timer -= dt;
        if (s.timer <= 0) startWave(g);
        break;
    }

    steer(g);
  }

  // What the screen needs, in one object, so kidsui.js never reaches into state.
  function hud(g, owner) {
    const s = st(g);
    if (owner == null) owner = g.playerOwner;
    const p = per(g, owner);
    const b = baseOf(g, owner);
    let next = 0;
    if (s.phase === 'prep' || s.phase === 'gap') next = Math.max(0, s.timer);
    // In co-op the card screen counts down, and the other player may still be choosing.
    const others = defenders(g).filter(o => o !== owner);
    return {
      wave: s.wave,
      phase: s.phase,
      label: s.wave ? waveLabel(s.wave) : 'Get ready!',
      nextIn: next,
      left: s.phase === 'spawning' ? s.queue.length + countEnemies(g) : countEnemies(g),
      preview: (s.phase === 'gap' || s.phase === 'reward' || s.phase === 'celebrate') ? s.preview : null,
      offer: p.picked ? null : p.offer,
      pickIn: (s.phase === 'reward' && s.coop) ? Math.max(0, s.timer) : 0,
      waitingFor: (s.phase === 'reward' && s.coop) ? others.filter(o => !per(g, o).picked).length : 0,
      banner: s.banner,
      roster: roster(g, owner),
      shard: Math.floor((g.res[owner] || {}).shard || 0),
      queue: (b && b.queue) || [],
      lanes: s.lanes || 1, laneMax: lanesOf(g).length,
      coop: !!s.coop,
      crystal: g.crystal ? { hp: Math.max(0, Math.round(g.crystal.hp)), max: Math.round(g.crystal.maxHp) } : null,
    };
  }

  // ── Netcode ───────────────────────────────────────────────────────────────
  // An online client never runs game.update(), so its own copy of the run state would
  // sit frozen at wave 0 with no cards in it. The server ships the whole director state
  // in each snapshot and the client writes it straight back into st(g), which is why
  // hud() and the entire screen work online without a second code path.
  //
  // Every defender's slice travels to everyone, exactly like `res` and `upgrades` already
  // do. It is a few hundred bytes, and the alternative — a per-client tailored snapshot —
  // would mean the server could no longer broadcast one buffer to the whole room.
  function netState(g) {
    const s = st(g);
    const pl = {};
    for (const o of defenders(g)) {
      const p = per(g, o);
      pl[o] = { i: p.incomeMul, u: p.unlocked, k: p.taken, of: p.offer, fu: p.freshUnlock, pk: !!p.picked };
    }
    return { w: s.wave, ph: s.phase, tm: s.timer, ln: s.lanes, co: !!s.coop,
             pv: s.preview, bn: s.banner, pl };
  }
  // Which sound a freshly arrived banner should make. The server has no RC.Audio, so the
  // cues that fire beside banner() offline are simply absent online; deriving them from
  // the banner's icon keeps every one of them in this single spot instead of threading a
  // sound name through five call sites.
  const BANNER_SFX = { '🎉': 'win', '🔓': 'levelup', '🧭': 'alarm', '🎁': 'ready' };
  function applyNetState(g, n) {
    if (!n) return;
    const s = st(g);
    const wasBanner = s.banner && s.banner.title;
    s.wave = n.w; s.phase = n.ph; s.timer = n.tm;
    s.lanes = n.ln || 1; s.coop = !!n.co; s.preview = n.pv || null; s.banner = n.bn || null;
    s.pl = s.pl || {};
    for (const o in (n.pl || {})) {
      const q = n.pl[o], p = per(g, +o);
      p.incomeMul = q.i; p.unlocked = q.u || []; p.taken = q.k || {};
      p.offer = q.of || null; p.freshUnlock = q.fu || null; p.picked = !!q.pk;
    }
    if (s.banner && s.banner.title !== wasBanner && RC.Audio) {
      RC.Audio.play(BANNER_SFX[s.banner.ic] || 'wave');
    }
  }

  return {
    CFG, CARDS, KITS, ROSTER, UNLOCK_WAVES, FLAVOURS, LANE_AT,
    netState, applyNetState,
    kitOf, costOf, timeOf, roster, waveSize, hpMul, weightAt, compose,
    flavourFor, waveLabel, offer, choose, autoPick, buy, freeSquad,
    laneCount, lanesOf, openLanes, laneName, defenders, per, baseOf,
    update, hud, banner, st,
  };
})();
