// RIFT CLASH — Kids mode rules (pure sim, no DOM)
// ---------------------------------------------------------------------------
// Survival with the RTS taken out of it. The whole mode is one sentence a
// six-year-old can repeat back: "bad guys walk at my crystal, I buy fighters to
// stop them, and I get a present after every wave."
//
// What is DELIBERATELY absent, and why:
//   · no shard nodes, no gathering — income just ticks up. A kid who forgets to mine
//     should never quietly lose ten minutes later for a mistake made in minute one.
//   · no supply buildings, no tech tree, no production buildings — concepts a kid has
//     to hold all at once before the first fight, all invisible to the actual goal.
//
// What CHANGED, and why it does not break the above:
//   · There is now ONE worker per player, and it only BUILDS — towers and walls, inside
//     a ring around the crystal. Kids want to build; that is most of why Minecraft is
//     Minecraft, and without it this mode is a shop and a health bar. Income stays
//     automatic, so the failure the mode exists to prevent — an economy you can forget —
//     is still prevented. Losing the builder is a pause, not a run-ender: it walks back
//     out free after a few seconds.
//   · Placement can still go wrong, so it is made hard to get wrong instead of absent:
//     you may only build near the crystal, slots are limited, and every refusal returns
//     a sentence saying what to do differently rather than a silent no.
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
    // Income used to be a flat trickle, which was right when the between-wave gap was
    // four seconds and wrong the moment Build Day became untimed: a player who took
    // five minutes over their castle was paid 2,250 shards for the wait, and a measured
    // run finished night twelve holding EIGHTY THOUSAND. Everything was affordable, so
    // nothing was a choice — the exact failure the old 15/s halving was written to fix,
    // reintroduced a hundredfold by a phase that removed the clock.
    //
    // So the shards follow the danger. You earn at the full rate while a raid is
    // actually happening, and a slow trickle by day that stops after DAY_PAID seconds.
    // Build for as long as you like — the day is still untimed, and taking longer is
    // still free — it just does not pay. The raid pays for the castle.
    INCOME: 9,              // shards per second DURING A RAID, before card upgrades
    DAY_INCOME: 2.6,        // ...and while building, for a while
    DAY_PAID: 90,           // seconds of Build Day that earn anything at all
    START_SHARD: 140,       // one fighter and a wall, or two fighters — a choice from second one
    // Was 40, which let the army SNOWBALL: fighters survive waves and accumulate, so by
    // wave 8 thirty defenders met a wave of nine and the outcome stopped being in doubt.
    // A tighter cap keeps every wave a fight — and because towers and walls cost no
    // supply, it is also what makes building worth doing rather than a decoration.
    POP: 20,                // fixed population cap — no supply buildings to think about
    // Room to make mistakes, but the mistakes have to SHOW. At 5200hp healing 7% a wave,
    // every scratch was erased between waves and the bar read 100% right up until the run
    // collapsed in one wave — a cliff, with no warning a kid could act on. Smaller pool,
    // smaller heal: the bar now drifts down as waves leak, which is the feedback that
    // says "do something" while there is still time to do it.
    CRYSTAL_HP: 4400,
    WAVE_HEAL: 0.03,        // crystal heals this fraction of max on every wave cleared
    COST_MUL: 0.55,         // kid prices, as a fraction of the normal card cost
    TIME_MUL: 0.35,         // kid build times, likewise — waiting is not the fun part
    QUEUE_MAX: 6,
    BOSS_HP: 5,             // Big Guy health multiplier
    CELEB: 2.6,             // seconds the wave-clear celebration holds the screen
    PICK: 15,               // co-op only: seconds to pick a reward before one is picked for you

    // ── Building ──
    // One worker per defender that ONLY builds. Income stays automatic, so there is still
    // no economy to forget — the thing this mode has always refused to make a kid manage —
    // but the build-your-fort loop that makes it worth replaying is now there.
    // The grid, the catalogue, the caps and the save file live in keep.js now; what
    // is left here is the clock. Note DAY_MAX is not the LENGTH of a Build Day — a
    // Build Day is untimed and ends when the players press Ready. It is the backstop
    // that stops an abandoned co-op run sitting on a build screen until the tab shuts.
    DAY_MAX: 300,           // seconds before night falls whether anyone is ready or not
    DAY_MIN: 6,             // ...and the earliest it may end, so a stray tap cannot skip it
    DAWN: 2.2,              // seconds the sky takes to come back up after a night
    // ONE builder per player. It is the only thing on the map that is only ever
    // yours, and one of it is what makes losing it matter — a crew of two is a
    // resource, a single builder is a character. The cost is that a long wall takes
    // real time to go up, which Build Day is untimed precisely to absorb: the walk
    // is something to watch rather than something to wait through.
    BUILDERS: 1,
    WORKER_RESPAWN: 20,     // seconds before a lost builder walks back out, free
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

  // ── Building ──────────────────────────────────────────────────────────────
  // Everything a kid may put on the map, and where. The ring exists because most of this
  // map is nowhere near the fight: without it a kid scatters towers across 3400px and
  // never understands why none of them ever shoot. Around the crystal, everything built
  // is doing something, and "build your fort around the crystal" is a rule you can say
  // in one sentence.
  function buildRing(g) { return RC.Keep.ring(g); }
  function inBuildRing(g, x, y) { return RC.Keep.inRing(g, x, y); }
  // Only TOWERS are capped now. The old cap counted every piece and topped out at
  // fourteen, which meant a keep could never be bigger than a shed — and the whole
  // reason to come back to this mode is that the thing you built last time gets
  // bigger. Walls and decorations are limited by what they cost, which is a real
  // limit and a legible one. Towers are the mode's damage and still need a ceiling,
  // or a patient player puts up twenty and removes the tension the walls create.
  function buildCap(g) { return RC.Keep.towerCap(g); }
  function buildUsed(g) { return RC.Keep.towerUsed(g); }
  // The build list depends on the race, because the tower does: a Gloop kid should be
  // putting up Venom Spires, not somebody else's Stonethrower. The walls are shared —
  // they are the mode's own toys rather than faction equipment.
  // The catalogue lives in keep.js now — walls, the gate, the race's own tower and
  // the decorations, in the order a castle actually gets made. RC.KID_BUILD stays in
  // config.js untouched for anything still asking the old question.
  function kitBuild(g, owner) {
    const race = (g && g.raceOf) ? g.raceOf(owner == null ? g.playerOwner : owner) : 'forge';
    return RC.Keep.menuFor(race);
  }
  function buildDefOf(g, t, owner) { return kitBuild(g, owner).find(b => b.t === t) || null; }

  // Why a build would be refused, as a sentence a six-year-old can act on. Returning the
  // REASON rather than a bare false is what lets the screen say "too far from the crystal"
  // instead of leaving a kid tapping a spot that will never work.
  // The one thing under construction, or null. There is a single builder per defender, so
  // "is it busy" is a property of the RUN, not of the button that was pressed.
  // The piece closest to finishing, and how many are still going up. With a shared
  // keep and a whole dragged row in flight, "what is being built" is a property of
  // the plan rather than of a player — and an owner test would have left the second
  // player watching an empty progress pill while their own builder worked.
  function buildingNow(g) {
    let best = null;
    for (const b of (g.buildings || [])) {
      if (b.dead || b.done || !RC.Keep.isPiece(b)) continue;
      if (!best || b.buildProgress > best.buildProgress) best = b;
    }
    return best;
  }
  function buildingCount(g) {
    let n = 0;
    for (const b of (g.buildings || [])) if (!b.dead && !b.done && RC.Keep.isPiece(b)) n++;
    return n;
  }

  // The old "Finish the X first!" rule is gone. It existed because one builder
  // trudging between five foundations finished none of them — but the fix for that
  // was never to forbid the plan, it was to make builders finish what they start and
  // walk to the next thing unprompted (RC.Keep.tickBuilders). With that in place
  // there is nothing to wait for, and so nothing to refuse on those grounds.
  function canBuild(g, t, x, y, owner) {
    const bd = buildDefOf(g, t, owner);
    if (!bd) return 'You cannot build that';
    if (!RC.Keep.afford(g, bd.cost)) return 'Not enough shards yet';
    return RC.Keep.why(g, t, x, y);
  }

  // A tap and a dragged row come through the same door: a tap is a plan one cell
  // long. `cells` arrives already snapped from the client and is re-snapped here,
  // because the server must never trust a coordinate it was handed.
  function build(g, t, x, y, owner, cells) {
    const mine = owner == null || owner === g.playerOwner;
    const list = ((cells && cells.length) ? cells : [{ x: x, y: y }])
      .slice(0, 40)
      .map(c => RC.Keep.snap(+c.x || 0, +c.y || 0));
    const bd = buildDefOf(g, t, owner);
    if (!bd) return false;
    if (!RC.Keep.afford(g, bd.cost)) { if (mine) g.notify('Not enough shards yet'); return false; }
    // The plan is judged as a WHOLE, and this matters more than it sounds. Validating
    // the first cell and refusing the row on it looks reasonable until you watch a
    // child draw a rectangle: the second wall starts on the corner the first one
    // already occupies, so every side after the first was silently refused in full.
    // A row that runs into something should build up to it, not evaporate.
    const n = RC.Keep.plan(g, t, list);
    if (!n) {
      if (mine) g.notify(RC.Keep.why(g, t, list[0].x, list[0].y) || 'No room there');
      return false;
    }
    if (mine && RC.Audio) RC.Audio.play('build');
    return true;
  }

  // Cancel what is going up, mark what is already up. One gesture, two meanings,
  // because from where a child is standing they are the same intention — "not that
  // one" — and splitting them across two buttons would make them learn a distinction
  // the game is making for its own reasons rather than for theirs.
  function remove(g, x, y, owner, cells) {
    const mine = owner == null || owner === g.playerOwner;
    const list = ((cells && cells.length) ? cells : [{ x: x, y: y }])
      .slice(0, 40)
      .map(c => RC.Keep.snap(+c.x || 0, +c.y || 0));
    let cancelled = 0, marked = 0, spared = 0;
    for (const c of list) {
      const r = RC.Keep.removeAt(g, c.x, c.y);
      if (r === 'cancelled') cancelled++;
      else if (r === 'marked') marked++;
      else if (r === 'spared') spared++;
    }
    if (!cancelled && !marked && !spared) return false;
    if (mine) {
      if (RC.Audio) RC.Audio.play('build');
      // Only the demolition needs explaining — a cancel is its own feedback,
      // because the thing vanishes as you touch it.
      if (marked) g.notify(marked === 1 ? 'Marked for the wrecking crew'
                                        : marked + ' pieces marked — the builder is on the way');
    }
    return true;
  }

  // The builder. One per defender, and it does nothing but build: no mining, no dropoff,
  // no gathering to forget about. If it dies it walks back out of the base for free after
  // a few seconds, because a kid losing the ability to build for the rest of a run because
  // a globling wandered past is a punishment out of all proportion to the mistake.
  function workerOf(g, owner) {
    if (owner == null) owner = g.playerOwner;
    for (const u of (g.units || [])) if (u.owner === owner && u.def.worker && !u.dead) return u;
    return null;
  }
  function workersOf(g, owner) {
    if (owner == null) owner = g.playerOwner;
    const out = [];
    for (const u of (g.units || [])) if (u.owner === owner && u.def.worker && !u.dead) out.push(u);
    return out;
  }
  function spawnWorker(g, owner) {
    // From the crystal, not from the base. The builders' job is the keep, the keep is
    // built around the crystal, and starting them at a base off on one flank meant
    // every first piece of every wall began with a long diagonal walk.
    const home = g.crystal || baseOf(g, owner);
    if (!home) return null;
    const race = g.raceOf ? g.raceOf(owner) : 'forge';
    const type = (RC.RACES[race] || RC.RACES.forge).worker;
    if (!RC.UNITS[type]) return null;
    const u = new RC.Unit(type, home.x - 40, home.y + home.h / 2 + 30, owner);
    u.free = true;                       // costs no supply — it is a tool, not an army slot
    if (g.initUnit) g.initUnit(u);
    g.units.push(u);
    g.fx.push({ abil: 'warp', ax: u.x, ay: u.y, t: 0.45, radius: u.r + 10, owner });
    return u;
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
    // `name` is the REAL unit name and it is what the button shows. Crystal Guard used to
    // label these Tank / Archer / Support, which is easier to read at six — and which meant
    // a kid who graduated to Versus had never heard of a Shieldbearer and could not find
    // the thing they had been playing for weeks. The role survives as the subtitle, so the
    // shorthand is still there; it is just no longer the only word on the button.
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
  // Still gentler than Survival medium at every wave (kidstest asserts it), but no longer
  // a formality: wave 3 is a handful rather than four stragglers, and by wave 8 there are
  // enough bodies that some of them get through if nobody is watching.
  // The curve was too gentle, and the untimed Build Day made it gentler still — a
  // player arrives at every night with more of everything than the night asks for.
  // The exponent is what changed: the first three waves are untouched, because the
  // on-ramp is the one part of this mode that was right, and the climb steepens from
  // there. Every value stays under Survival medium at the same wave — kidstest holds
  // that line, and it should: this is the gentler of the two modes by design, not the
  // trivial one.
  //
  //   wave    4   6   8  10  12  15  20  25  30
  //   was     5   7   9  11  14  17  22  27  30
  //   now     6   8  11  14  17  21  29  37  45
  //   surv    6   8  11  15  18  23  32  41  50
  function waveSize(w) {
    return Math.max(2, Math.min(48, Math.round(2 + 1.05 * Math.pow(Math.max(0, w - 1), 1.10))));
  }

  // Enemy health. Flat for the first five waves so the opening is a genuine
  // warm-up, then a shallow climb.
  // Enemies used to arrive at 70% of their printed health, flat for the first five waves.
  // Combined with a small wave that meant almost nothing survived the walk to the crystal,
  // and a passive player sat at 100% crystal health through wave 12 — the "too easy at the
  // beginning" the mode was reported for. They now start near their real stats and climb
  // sooner, so a wave that is ignored actually costs something.
  function hpMul(w) { return 1.0 * (1 + 0.105 * Math.max(0, w - 3)); }

  // ── The raid answers the keep ──────────────────────────────────────────────
  //
  // A castle that has been growing for twenty nights meets the same wave a bare
  // crystal does, which is the other half of why the mode goes soft: the reward for
  // building was that the fight stopped happening. So a bigger keep draws a bigger
  // raid — capped, and deliberately sub-linear, so a wall is always worth more than
  // the raid it adds and building is never a trap.
  //
  // Structure only. A banner, a torch and a flowerbox are not a provocation, and a
  // child should never learn that decorating their castle made the night harder.
  const KEEP_SCALE = 260, KEEP_SCALE_MAX = 0.40;
  function keepMul(g) {
    if (!g || !RC.Keep) return 1;
    let n = 0;
    for (const b of (g.buildings || [])) {
      if (b.dead || !RC.Keep.isPiece(b) || !b.done) continue;
      if (b.def.decor) continue;
      n += b.def.keepTower ? 3 : 1;                   // a tower is worth three walls
    }
    return 1 + Math.min(KEEP_SCALE_MAX, n / KEEP_SCALE);
  }

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

  function compose(w, g) {
    const f = flavourFor(w);
    let count = Math.max(1, Math.round(waveSize(w) * (f.sizeMul || 1) * keepMul(g)));

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

  // ── Hero upgrade cards ────────────────────────────────────────────────────
  // Built from the player's OWN hero rather than written out here, so the three cards a
  // Warden player sees can never be the three a Matriarch player sees. Adding a fourth
  // upgrade to a hero in config.js puts a fourth card in that hero's pool with no change
  // here. They ride in the same after-wave pool as everything else: no second screen, no
  // second currency, and hero cards have to compete with Sharper Shots for the pick.
  function heroOf(g, owner) {
    const o = (owner == null) ? g.playerOwner : owner;
    // The unit list rather than g.heroOf, because it is the one thing an online client
    // and the server always agree on — see the heroOf rebuild in net_core applySnapshot.
    for (const u of (g.units || [])) if (u.hero && u.owner === o && !u.dead && u.def && u.def.sig) return u;
    const h = g.heroOf && g.heroOf[o];
    return (h && !h.dead && h.def && h.def.sig) ? h : null;
  }
  function heroCards(g, owner) {
    const h = heroOf(g, owner);
    if (!h) return [];
    return (h.def.sig.ups || []).map(up => ({
      id: 'sig_' + up.id, ic: up.ic, name: up.name,
      desc: up.kid || up.desc, max: 1, hero: true, up: up.id,
      apply: (gg, o) => { const hh = heroOf(gg, o); if (hh) { hh.useCardUpgrades(); hh.grantUp(up.id); } },
    }));
  }

  // How many times a card has already been taken this run BY THIS DEFENDER. Per player,
  // so one kid maxing out Sharper Shots does not empty the other kid's card pool.
  function taken(g, id, owner) { const p = per(g, owner); return (p.taken && p.taken[id]) || 0; }

  // Three distinct cards the player can still benefit from. `heal` is filtered out
  // at full health — offering a repair to an undamaged crystal is a wasted choice,
  // and a wasted choice teaches a kid that the cards do not matter.
  function offer(g, owner) {
    const pool = CARDS.concat(heroCards(g, owner)).filter(c => {
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
                           tier: taken(g, c.id, owner) + 1, max: c.max,
                           shared: !!c.shared, hero: !!c.hero }));
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
    const card = CARDS.find(c => c.id === id) || heroCards(g, owner).find(c => c.id === id);
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
    dayBreaks(g);
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
    if (!RC.Keep.afford(g, cost)) { say('Not enough shards yet'); return false; }
    const sup = g.supply(owner);
    const d = RC.UNITS[type];
    if (sup.used + d.supply > sup.max) { say('Your army is full!'); return false; }
    RC.Keep.purse(g).shard -= cost;                 // one pile pays for walls AND fighters
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
        wave: 0, phase: 'build', timer: CFG.DAY_MAX, dayT: 0, ready: {}, cracks: 0,
        queue: [], spawnT: 0, dawnT: 0,
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
    s.queue = compose(s.wave, g);
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

  // ── Build Day ↔ Raid Night ────────────────────────────────────────────────
  //
  // Ready is per player and unanimous. A single "start" button in co-op means the
  // faster child ends the slower one's turn, which is the specific unfairness that
  // makes two kids stop playing together; and an auto-start timer would put the
  // clock back that this whole phase exists to remove.
  function allReady(g) {
    const d = defenders(g);
    if (!d.length) return false;
    return d.every(o => !!st(g).ready[o]);
  }
  function setReady(g, owner, on) {
    const s = st(g);
    if (s.phase !== 'build') return false;
    if (owner == null) owner = g.playerOwner;
    s.ready[owner] = on == null ? !s.ready[owner] : !!on;
    return true;
  }
  function dayBreaks(g) {
    const s = st(g);
    s.phase = 'build';
    s.dayT = 0;
    s.dawnT = 0;
    s.timer = CFG.DAY_MAX;
    s.ready = {};
    if (RC.Keep) RC.Keep.syncGates(g);
    const nf = flavourFor(s.wave + 1);
    s.preview = nf.id === 'normal' ? null : { ic: nf.ic, name: nf.name, tip: nf.tip, col: nf.col };
    banner(g, '🌅', 'BUILD DAY', 'Build as long as you like — press Ready when you are', '#ffd68a', 3.0);
  }
  function nightFalls(g) {
    const s = st(g);
    s.ready = {};
    banner(g, '🌙', 'NIGHT ' + (s.wave + 1), 'Here they come!', '#8fb6ff', 2.2);
    startWave(g);
    // AFTER startWave, not before: the gate reads the phase to decide whether it is
    // open, and startWave is what moves the phase off 'build'. Shutting the gates
    // first left them standing open into the first tick of the raid — and out of the
    // nav grid, which is a hole in the wall exactly where the wall has a door.
    if (RC.Keep) RC.Keep.syncGates(g);
  }

  // ── The crack ─────────────────────────────────────────────────────────────
  //
  // The old rule ended the run when the crystal fell. For a mode whose point is
  // that you build something over weeks, that is the one outcome you cannot have:
  // a child who loses an hour of building to one bad night does not build again.
  //
  // So the crystal cracks instead. The night ends there and then, the raid is
  // swept away, the crystal comes back at under half, anything the raid knocked
  // down is put back from the save at a fraction of its health, and the SAME
  // night has to be faced again. It still costs something — the night, the
  // repair, and the shard cost of doing better — but never the castle.
  function crack(g) {
    const s = st(g);
    const c = g.crystal;
    if (!c) return;
    c.dead = false;
    c.hp = Math.max(1, c.maxHp * 0.45);
    c.shield = c.maxShield || 0;
    RC.initStatus && RC.initStatus(c);
    s.cracks = (s.cracks || 0) + 1;

    for (const u of (g.units || [])) if (u.owner === ENEMY && !u.dead) u.dead = true;
    s.queue = [];
    s.spawnT = 0;

    const back = (RC.Keep && RC.Keep.rebuild) ? RC.Keep.rebuild(g, 0.4) : 0;
    for (const b of (g.buildings || [])) {
      if (b.dead || !RC.Keep.isPiece(b) || !b.done) continue;
      b.hp = Math.max(b.hp, b.maxHp * 0.4);     // scarred, not ruined
    }
    g.fx.push({ abil: 'nova', ax: c.x, ay: c.y, t: 0.7, radius: 260, owner: c.owner });
    g.shake(0.5);
    if (RC.Audio) RC.Audio.play('lose');
    dayBreaks(g);
    banner(g, '💔', 'THE CRYSTAL CRACKED',
           back ? 'The keep is patched up — try that night again' : 'Patch it up and try that night again',
           '#ff8a9a', 3.6);
  }

  // "Stop for today" — the deliberate end of a session. Saves and hands the run to
  // the normal end screen. A mode with no losing still needs a way to STOP.
  function stopForToday(g) {
    if (RC.Keep && RC.Keep.capture) RC.Keep.capture(g);
    g.over = 'lose';                   // the end screen's kid branch reads waves, not outcome
    return true;
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

    // Save the keep the moment a night is survived, never mid-raid: a snapshot
    // taken while the walls are coming down would record the rubble instead of
    // the castle, and the whole promise is that what you built is still there
    // tomorrow.
    if (RC.Keep && RC.Keep.capture) RC.Keep.capture(g);

    banner(g, '🎉', 'NIGHT ' + s.wave + ' SURVIVED!', 'The keep held — pick your reward', '#ffd24a', CFG.CELEB);
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

    // Automatic income, into ONE pile. Two children building one castle should not
    // be running two banks: the first thing that happens with separate wallets is
    // that neither can afford the Steel Wall and both are certain the other should
    // pay for it. Each defender still contributes their own Shard Rush multiplier,
    // so a card either of them picks makes the shared pile fill faster for both.
    const keepBank = RC.Keep.bank(g);
    let mul = 0;
    for (const o of defenders(g)) mul += (per(g, o).incomeMul || 1);
    const rate = s.phase === 'build'
      ? ((s.dayT || 0) < CFG.DAY_PAID ? CFG.DAY_INCOME : 0)
      : CFG.INCOME;
    if (g.res[keepBank]) g.res[keepBank].shard += rate * mul * dt;

    const crew = [];
    for (const o of defenders(g)) {
      // Replace a lost builder. Free, and after a pause long enough that losing it still
      // stings without ending the kid's ability to build for the rest of the run.
      const p = per(g, o);
      const ws = workersOf(g, o);
      if (ws.length < CFG.BUILDERS) {
        p.workerT = (p.workerT || 0) + dt;
        if (p.workerT >= CFG.WORKER_RESPAWN) { p.workerT = 0; spawnWorker(g, o); }
      } else p.workerT = 0;
      for (const w of ws) crew.push(w);
    }
    // Every builder on the map works the same plan, nearest piece first. This is what
    // pays for dropping the one-at-a-time rule: you draw a whole wall and both
    // builders walk it and put it up, without anyone deciding which bit is theirs.
    RC.Keep.tickBuilders(g, crew, dt);
    RC.Keep.syncGates(g);

    if (s.banner) { s.banner.t -= dt; if (s.banner.t <= 0) s.banner = null; }
    // Checked HERE, ahead of everything, because game.update() tests the crystal a
    // few lines later and would end the run. In Crystal Defense the crystal does not
    // die — it cracks. See crack().
    if (g.crystal && g.crystal.dead) { crack(g); return; }
    if (!g.crystal) return;

    switch (s.phase) {
      // ── BUILD DAY ────────────────────────────────────────────────────────
      // The change that makes this a building game. It used to be 22 seconds
      // before the first wave and 4 between them, which is not enough time to
      // build anything and is exactly enough time to feel harried — so the
      // building always lost to the fighting, every single wave. Now the day
      // simply does not end until the players say it does. Nothing attacks,
      // nothing is on a clock a child can see, and the only thing to do is
      // build. The night is something you CHOOSE to start.
      case 'build':
        if (!s.said) {
          s.said = 1;
          banner(g, '🏰', 'BUILD YOUR KEEP', 'Drag to lay a wall. Press Ready when night can come.', '#ffd68a', 4.0);
        }
        s.dayT += dt;
        s.dawnT = Math.min(CFG.DAWN, (s.dawnT || 0) + dt);
        s.timer = Math.max(0, CFG.DAY_MAX - s.dayT);
        // DAY_MIN stops a mis-tap on the Ready button skipping the day entirely.
        if (s.dayT >= CFG.DAY_MIN && allReady(g)) { nightFalls(g); break; }
        // The backstop exists for the abandoned co-op run, not for the player in
        // front of the screen — five minutes is far past any honest build.
        if (s.timer <= 0) nightFalls(g);
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
          if (!any) { dayBreaks(g); }
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
      // One number, because there is one pile. Both players watch the same total
      // go up and the same total go down, which is most of what makes it feel
      // like one castle rather than two adjacent ones.
      shard: RC.Keep.shards(g),
      queue: (b && b.queue) || [],
      lanes: s.lanes || 1, laneMax: lanesOf(g).length,
      sig: sigHud(g, owner),
      // What the player has tapped, and therefore which panel is open. The build bar used
      // to live permanently in the bottom-left corner, on top of the end-match button; it
      // is now a panel that opens when you tap the thing it belongs to — the builder for
      // walls and towers, the base for fighters — which is also how the grown-up game
      // works. Selection is the existing mechanism; nothing new had to be invented.
      focus: focusOf(g, owner),
      busy: busyHud(g, owner),
      build: {
        items: kitBuild(g, owner).map(b => ({
          t: b.t, ic: b.ic, cost: b.cost, kid: b.kid, group: b.group || 'wall',
          // The real building name, for the same reason the shop shows the real unit
          // name: a kid who learns "Venom Spire" here knows what it is in Versus too.
          role: (RC.BUILDINGS[b.t] || {}).name || b.role,
        })),
        used: buildUsed(g), cap: buildCap(g),
        ring: buildRing(g),
        ringAt: g.crystal ? { x: g.crystal.x, y: g.crystal.y } : null,
        worker: !!workerOf(g, owner),
        pieces: RC.Keep.pieceCount(g), max: RC.Keep.PIECE_MAX,
        removing: g.placing === RC.Keep.DEMO,
        marked: RC.Keep.demoCount(g),
      },
      // Build Day, the ready vote, and the name over the gate.
      day: {
        on: s.phase === 'build',
        remain: s.phase === 'build' ? Math.max(0, s.timer) : 0,
        elapsed: s.dayT || 0,
        canStart: (s.dayT || 0) >= CFG.DAY_MIN,
        // Shards stop after DAY_PAID. Said out loud, because a number that quietly
        // stops moving is the kind of thing a child notices, cannot explain, and
        // concludes is broken.
        paying: (s.dayT || 0) < CFG.DAY_PAID,
        ready: !!s.ready[owner],
        readyCount: defenders(g).filter(o => s.ready[o]).length,
        need: defenders(g).length,
        night: RC.Keep.nightAmt(g),
        cracks: s.cracks || 0,
        name: (g._keepSave && g._keepSave.name) || 'My Keep',
      },
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
             dt: s.dayT || 0, rd: s.ready || {}, ck: s.cracks || 0, dw: s.dawnT || 0,
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
    s.dayT = n.dt || 0; s.ready = n.rd || {}; s.cracks = n.ck || 0; s.dawnT = n.dw || 0;
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

  // Which of the two panels the player is looking at. The builder wins a tie, because a
  // box-drag that caught both was almost certainly aimed at the thing you were about to
  // move rather than at the base you cannot move.
  function focusOf(g, owner) {
    const sel = (g && g.selection) || [];
    if (!sel.length) return null;
    const w = workerOf(g, owner);
    if (w && sel.includes(w)) return 'builder';
    const b = baseOf(g, owner);
    if (b && sel.includes(b)) return 'base';
    return null;
  }

  // The building currently going up, as a progress pill. This is the whole explanation for
  // why the build buttons are greyed out, so it has to be visible whenever they are.
  function busyHud(g, owner) {
    const b = buildingNow(g);
    if (!b) return null;
    const n = buildingCount(g);
    return { name: (b.def.name || 'Building') + (n > 1 ? '  (+' + (n - 1) + ' more)' : ''),
             ic: (kitBuild(g, owner).find(i => i.t === b.type) || {}).ic || '🧱',
             pct: Math.max(0, Math.min(1, b.buildProgress || 0)) };
  }

  // Everything the hero buttons need, or null when this player has no hero.
  // `skills` is the two small tactical buttons (Q/E); the big ring is still the
  // signature, kept separate because it is the only one with a story attached to it.
  function sigHud(g, owner) {
    const h = heroOf(g, owner);
    if (!h) return null;
    const sig = h.def.sig;
    return {
      id: sig.id, ic: sig.ic, name: sig.name, kid: sig.kid,
      charge: Math.max(0, Math.min(1, h.charge || 0)),
      ready: h.sigReady(), downed: !!h.downed, level: h.level,
      ups: (sig.ups || []).filter(u => h.hasUp(u.id)).map(u => u.ic),
      skills: (h.def.skills || []).filter(sk => !sk.ult).map(sk => ({
        key: sk.key, ic: sk.ic, name: sk.name, kid: sk.kid,
        ready: h.skillReady(sk),
        // A fraction rather than seconds — a six-year-old reads a shrinking wedge much
        // faster than they read a number, and it drives the same CSS ring as the charge.
        cd: sk.cd ? Math.max(0, 1 - (h.skillCd[sk.id] || 0) / sk.cd) : 1,
      })),
    };
  }

  return {
    CFG, CARDS, KITS, ROSTER, UNLOCK_WAVES, FLAVOURS, LANE_AT,
    heroCards, sigHud,
    buildRing, inBuildRing, buildCap, buildUsed, canBuild, build, kitBuild,
    workerOf, workersOf, spawnWorker, remove,
    netState, applyNetState,
    kitOf, costOf, timeOf, roster, waveSize, hpMul, weightAt, compose, keepMul,
    flavourFor, waveLabel, offer, choose, autoPick, buy, freeSquad,
    laneCount, lanesOf, openLanes, laneName, defenders, per, baseOf, buildingNow,
    allReady, setReady, dayBreaks, nightFalls, crack, stopForToday,
    update, hud, banner, st,
  };
})();
