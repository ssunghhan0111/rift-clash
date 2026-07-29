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
  };

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
  function roster(g) {
    const race = g.raceOf ? g.raceOf(g.playerOwner) : 'forge';
    const kit = kitOf(race);
    const out = kit.starters.map(s => ({
      t: s.t, role: s.role, ic: s.ic, blurb: s.blurb,
      name: (RC.UNITS[s.t] || {}).name || s.t,
      cost: costOf(s.t), time: timeOf(s.t), isNew: false,
    }));
    const s = st(g);
    for (const t of (s.unlocked || [])) {
      const d = RC.UNITS[t];
      if (!d) continue;
      out.push({
        t, role: d.role || 'Fighter', ic: d.flying ? '✈️' : '⭐', blurb: d.desc || '',
        name: d.name, cost: costOf(t), time: timeOf(t), isNew: s.freshUnlock === t,
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
  const CARDS = [
    { id: 'atk',    ic: '⚔️', name: 'Sharper Shots',  desc: 'All your fighters hit harder.',      max: 3,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'atk') },
    { id: 'arm',    ic: '🛡️', name: 'Thicker Armour', desc: 'All your fighters take less damage.', max: 3,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'arm') },
    { id: 'tough',  ic: '❤️', name: 'Bigger Hearts',  desc: 'All your fighters get more health.',  max: 3,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'tough') },
    { id: 'spd',    ic: '⚡', name: 'Speed Boost',    desc: 'All your fighters move and shoot faster.', max: 2,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'spd') },
    { id: 'crit',   ic: '🎯', name: 'Lucky Hits',     desc: 'Sometimes your shots do double damage!', max: 3,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'crit') },
    { id: 'frost',  ic: '❄️', name: 'Frosty Shots',   desc: 'Your shots freeze enemies slow.',     max: 2,
      apply: (g) => g.applyUpgrade(g.playerOwner, 'frost') },
    { id: 'income', ic: '💎', name: 'Shard Rush',     desc: 'Shards come in 25% faster, forever.', max: 5,
      apply: (g) => { const s = st(g); s.incomeMul = (s.incomeMul || 1) + 0.25; } },
    { id: 'heal',   ic: '💖', name: 'Crystal Mend',   desc: 'Repair the crystal right now.',       max: 99,
      apply: (g) => { const c = g.crystal; if (c) c.hp = Math.min(c.maxHp, c.hp + c.maxHp * 0.35); } },
    { id: 'shell',  ic: '✨', name: 'Crystal Shell',  desc: 'The crystal gets more maximum health.', max: 4,
      apply: (g) => { const c = g.crystal; if (!c) return; const add = Math.round(CFG.CRYSTAL_HP * 0.15); c.maxHp += add; c.hp += add; } },
    { id: 'squad',  ic: '🎁', name: 'Free Squad',     desc: 'Three free fighters, right away!',    max: 99,
      apply: (g) => freeSquad(g, 3) },
    { id: 'bank',   ic: '🏦', name: 'Shard Chest',    desc: 'A big pile of shards, right now.',    max: 99,
      apply: (g) => { if (g.res[g.playerOwner]) g.res[g.playerOwner].shard += 350; } },
  ];

  // How many times a card has already been taken this run.
  function taken(g, id) { const s = st(g); return (s.taken && s.taken[id]) || 0; }

  // Three distinct cards the player can still benefit from. `heal` is filtered out
  // at full health — offering a repair to an undamaged crystal is a wasted choice,
  // and a wasted choice teaches a kid that the cards do not matter.
  function offer(g) {
    const pool = CARDS.filter(c => {
      if (taken(g, c.id) >= c.max) return false;
      if (c.id === 'heal' && g.crystal && g.crystal.hp >= g.crystal.maxHp * 0.95) return false;
      return true;
    });
    const out = [];
    const bag = pool.slice();
    while (out.length < 3 && bag.length) {
      out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
    }
    return out.map(c => ({ id: c.id, ic: c.ic, name: c.name, desc: c.desc, tier: taken(g, c.id) + 1, max: c.max }));
  }

  function choose(g, id) {
    const s = st(g);
    if (s.phase !== 'reward') return false;
    const card = CARDS.find(c => c.id === id);
    if (!card) return false;
    if (!s.offer || !s.offer.some(o => o.id === id)) return false;   // only from what was offered
    card.apply(g);
    s.taken = s.taken || {};
    s.taken[id] = (s.taken[id] || 0) + 1;
    s.offer = null;
    s.phase = 'gap';
    s.timer = CFG.GAP;
    if (g.paused && s.autoPaused) { g.paused = false; s.autoPaused = false; }
    banner(g, '🎁', card.name + '!', card.desc, '#ffd24a', 2.0);
    if (RC.Audio) RC.Audio.play('ready');
    // Tell the kid what is coming BEFORE it arrives. A tip that appears at the same
    // moment as the wave is a caption, not a warning — no time to act on it.
    const nf = flavourFor(s.wave + 1);
    s.preview = nf.id === 'normal' ? null : { ic: nf.ic, name: nf.name, tip: nf.tip, col: nf.col };
    return true;
  }

  // Free Squad — one of each currently affordable-to-exist type, cycled, dropped
  // straight onto the field rather than into the build queue. Instant gratification
  // is the entire appeal of the card.
  function freeSquad(g, n) {
    const list = roster(g);
    if (!list.length) return;
    const home = g.kidsBase || g.crystal;
    if (!home) return;
    for (let i = 0; i < n; i++) {
      const pick = list[i % list.length].t;
      const u = new RC.Unit(pick, home.x + (Math.random() * 120 - 60), home.y + home.h / 2 + 40 + Math.random() * 40, g.playerOwner);
      if (g.initUnit) g.initUnit(u);
      u.free = true;                     // does not count against the population cap
      g.units.push(u);
    }
    g.fx.push({ abil: 'warp', ax: home.x, ay: home.y, t: 0.5, radius: 90, owner: g.playerOwner });
  }

  // ── Buying ────────────────────────────────────────────────────────────────
  // Deliberately NOT g.train(): kid prices and kid build times live here, and the
  // production building is the base the kid is already looking at.
  function buy(g, type) {
    const s = st(g);
    const allowed = roster(g).some(r => r.t === type);
    if (!allowed) return false;
    const b = g.kidsBase;
    if (!b || b.dead || !b.done) return false;
    if (b.queue.length >= CFG.QUEUE_MAX) { g.notify('Too many on the way — wait a moment'); return false; }
    const cost = costOf(type);
    const me = g.playerOwner;
    if (!g.res[me] || g.res[me].shard < cost) { g.notify('Not enough shards yet'); return false; }
    const sup = g.supply(me);
    const d = RC.UNITS[type];
    if (sup.used + d.supply > sup.max) { g.notify('Your army is full!'); return false; }
    g.res[me].shard -= cost;
    const t = timeOf(type);
    b.queue.push({ type, timeLeft: t, total: t });
    if (RC.Audio) RC.Audio.play('build');
    s.bought = (s.bought || 0) + 1;
    return true;
  }

  // ── Run state ─────────────────────────────────────────────────────────────
  // Lives on the game (g._kd), never in module scope, so two runs can never share
  // a wave counter. Cleared by game.reset().
  function st(g) {
    if (!g._kd) {
      g._kd = {
        wave: 0, phase: 'prep', timer: CFG.PREP, queue: [], spawnT: 0,
        unlocked: [], freshUnlock: null, taken: {}, offer: null, preview: null,
        incomeMul: 1, celebT: 0, banner: null, bought: 0, best: 0, autoPaused: false,
      };
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

    // A new unit type, if this wave is on the ladder.
    const slot = UNLOCK_WAVES.indexOf(s.wave);
    if (slot >= 0) {
      const race = g.raceOf ? g.raceOf(g.playerOwner) : 'forge';
      const t = kitOf(race).unlocks[slot];
      if (t && RC.UNITS[t] && s.unlocked.indexOf(t) < 0) {
        s.unlocked.push(t);
        s.freshUnlock = t;
        banner(g, '🔓', 'NEW FIGHTER!', RC.UNITS[t].name + ' unlocked — check your buttons', '#5ddc7a', 3.2);
        if (RC.Audio) RC.Audio.play('levelup');
      }
    }

    const f = flavourFor(s.wave);
    if (!s.freshUnlock) banner(g, f.ic, waveLabel(s.wave), f.tip || 'Here they come!', f.col, 2.4);
    g.notify(f.ic + ' ' + waveLabel(s.wave));
    if (RC.Audio) RC.Audio.play('wave');
  }

  function spawnOne(g) {
    const s = st(g);
    const type = s.queue.shift();
    const f = flavourFor(s.wave);
    const o = g.enemySpawn;
    const u = new RC.Unit(type, o.x + (Math.random() * 120 - 60), o.y + (Math.random() * 460 - 230), ENEMY);

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
    const b = g.kidsBase;
    if (b) g.fx.push({ party: 1, ax: b.x, ay: b.y - 30, t: 1.8, life: 1.8, n: 26 });
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
    // a kid: there is no economy to forget about.
    if (g.res[g.playerOwner]) g.res[g.playerOwner].shard += CFG.INCOME * (s.incomeMul || 1) * dt;

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
          s.offer = offer(g);
          if (!s.offer.length) { s.phase = 'gap'; s.timer = CFG.GAP; }   // pool exhausted — skip straight on
          else { s.phase = 'reward'; g.paused = true; s.autoPaused = true; }
        }
        break;

      case 'reward':
        // Held here until choose() is called. If something else unpaused the game
        // (the P key, the pause button) put it back — the card screen is modal.
        if (!g.paused) { g.paused = true; s.autoPaused = true; }
        break;

      case 'gap':
        s.timer -= dt;
        if (s.timer <= 0) startWave(g);
        break;
    }

    steer(g);
  }

  // What the screen needs, in one object, so kidsui.js never reaches into state.
  function hud(g) {
    const s = st(g);
    let next = 0;
    if (s.phase === 'prep' || s.phase === 'gap') next = Math.max(0, s.timer);
    return {
      wave: s.wave,
      phase: s.phase,
      label: s.wave ? waveLabel(s.wave) : 'Get ready!',
      nextIn: next,
      left: s.phase === 'spawning' ? s.queue.length + countEnemies(g) : countEnemies(g),
      preview: (s.phase === 'gap' || s.phase === 'reward' || s.phase === 'celebrate') ? s.preview : null,
      offer: s.offer,
      banner: s.banner,
      roster: roster(g),
      shard: Math.floor((g.res[g.playerOwner] || {}).shard || 0),
      queue: (g.kidsBase && g.kidsBase.queue) || [],
      crystal: g.crystal ? { hp: Math.max(0, Math.round(g.crystal.hp)), max: Math.round(g.crystal.maxHp) } : null,
    };
  }

  return {
    CFG, CARDS, KITS, ROSTER, UNLOCK_WAVES, FLAVOURS,
    kitOf, costOf, timeOf, roster, waveSize, hpMul, weightAt, compose,
    flavourFor, waveLabel, offer, choose, buy, freeSquad,
    update, hud, banner, st,
  };
})();
