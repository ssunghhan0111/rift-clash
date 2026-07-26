// RIFT CLASH — Survival wave director (offline)
// ---------------------------------------------------------------------------
// Enemy waves march from g.enemySpawn to the Rift Crystal. A wave spawns in full,
// and the NEXT wave only begins a few seconds AFTER the current wave has been
// completely wiped out — so enemies never pile up.
//
// DIFFICULTY CURVE — rewritten so the run opens as a real warm-up and the
// pressure compounds from there, instead of dropping a half-formed army on the
// player at wave 1. Three dials move together, all anchored so wave 1 is the
// true floor of the run:
//
//   1. COUNT  — size + sizeGrow * (w-1)^sizeExp. The exponent (1.15) means the
//               opening waves add about one enemy each while the late ones add
//               three or four. Medium now reads 2, 3, 4, 5, 7, 8, 10 ... 16 by
//               wave 10 and 34 by wave 20. The old straight line opened at SIX
//               and was already at 12 by wave 5.
//   2. HP     — enemies use their printed stats for the first few waves
//               (hpFree), then climb steadily. The old formula handed wave 1 a
//               +12% health bonus before the player had built anything.
//   3. ROSTER — a newly unlocked enemy type enters at a QUARTER of its weight
//               and reaches full weight RAMP waves later, so each new threat
//               arrives as one or two scouts before it becomes a real part of
//               the horde. Previously a type jumped from absent to ~1/5 of the
//               wave the instant it unlocked, which is what made waves 7 and 9
//               feel like walls rather than steps.
//
// Late-game numbers are deliberately close to the old curve (Medium wave 20 is
// still ~34 enemies) — what changed is the SHAPE of the ramp, not the ceiling,
// so deep runs and leaderboard scores stay broadly comparable.
window.RC = window.RC || {};

RC.Survival = (function () {
  const PREP = 18;          // setup time before wave 1
  const GAP = 5;            // seconds after a wave is fully cleared before the next one
  const SPAWN_STEP = 0.22;  // seconds between individual unit spawns within a wave
  const ENEMY = 2;          // owner id of the attacking horde
  const RAMP = 4;           // waves for a newly unlocked type to reach full weight

  // Difficulty presets — count, HP and upgrade pace scale with the level.
  //   size/sizeGrow/sizeExp  wave-size curve (see waveSize)
  //   sizeCap                hard ceiling on wave size, a performance guard that
  //                          only bites deep into a run; difficulty keeps rising
  //                          through HP and roster after it does
  //   hpBase/hpGrow/hpFree   HP multiplier — flat at hpBase for the first
  //                          hpFree waves, then +hpGrow per wave
  //   unlock                 shifts every non-starter enemy type later (+) or
  //                          earlier (-)
  const DIFF = {
    easy: {
      name: 'Easy',
      size: 2, sizeGrow: 0.55, sizeExp: 1.15, sizeCap: 55,
      hpBase: 0.80, hpGrow: 0.08, hpFree: 4,
      atkEvery: 6, armEvery: 10, unlock: 2,
    },
    medium: {
      name: 'Medium',
      size: 2, sizeGrow: 1.00, sizeExp: 1.15, sizeCap: 70,
      hpBase: 1.00, hpGrow: 0.135, hpFree: 3,
      atkEvery: 4, armEvery: 6, unlock: 0,
    },
    insane: {
      name: 'Crazy Hard',
      size: 3, sizeGrow: 1.60, sizeExp: 1.15, sizeCap: 85,
      hpBase: 1.35, hpGrow: 0.18, hpFree: 1,
      atkEvery: 3, armEvery: 4, unlock: -2,
    },
  };

  // The horde roster. `at` is the wave a type first appears on Medium, `w` its
  // share of the wave once fully ramped in. `core` types ignore the difficulty
  // unlock shift so wave 1 is never empty on Easy.
  const ROSTER = [
    { t: 'globling', at: 1,  w: 3.0, core: true },
    { t: 'volt',     at: 2,  w: 2.4, core: true },
    { t: 'spitter',  at: 4,  w: 1.9 },
    { t: 'shielder', at: 6,  w: 1.5 },
    { t: 'bloat',    at: 8,  w: 1.2, heavy: true },
    { t: 'ardent',   at: 9,  w: 1.2 },   // Aether — shielded melee, needs sustained damage
    { t: 'floater',  at: 10, w: 1.1, air: true },   // the player now needs anti-air
    { t: 'lancer',   at: 12, w: 1.0 },   // shielded ranged
    { t: 'heli',     at: 13, w: 0.9, air: true },
    { t: 'seraph',   at: 16, w: 0.8, air: true },   // shielded air
    { t: 'bastion',  at: 19, w: 0.7, heavy: true }, // late-game shielded siege
  ];
  const HEAVY_ORDER = ['bastion', 'bloat'];   // milestone pushes prefer the first unlocked

  // Daily Challenge always runs on the Medium curve with the day's twist applied
  // on top, so the only thing separating two players on the daily board is how
  // they played — not which difficulty they picked.
  function diffOf(g) {
    const base = DIFF[g && g.survivalDiff] || DIFF.medium;
    const m = g && g.daily && g.daily.mod;
    if (!m) return base;
    const d = Object.assign({}, DIFF.medium);
    if (m.size) {
      d.size = Math.max(2, Math.round(d.size * m.size));
      d.sizeGrow = d.sizeGrow * m.size;
      d.sizeCap = Math.min(90, Math.round(d.sizeCap * m.size));
    }
    if (m.hp) { d.hpBase = d.hpBase * m.hp; d.hpGrow = d.hpGrow * m.hp; }
    if (m.upgradePace) {
      d.atkEvery = Math.max(1, Math.round(d.atkEvery * m.upgradePace));
      d.armEvery = Math.max(1, Math.round(d.armEvery * m.upgradePace));
    }
    // Skyfall — air types only, and EARLIER. The old code did `unlock + 6`,
    // which pushed every type six waves LATER: the twist was doing the exact
    // opposite of its own description, and to the whole roster rather than air.
    if (m.airEarly) d.airShift = -5;
    d.name = m.name;
    return d;
  }
  function prepOf(g) { const m = g && g.daily && g.daily.mod; return PREP * ((m && m.prep) || 1); }
  function gapOf(g) { const m = g && g.daily && g.daily.mod; return GAP * ((m && m.gap) || 1); }
  // Daily runs draw from a seeded stream so every player faces the same waves;
  // ordinary runs stay pleasantly unpredictable.
  function rnd(g) { return (RC.Daily && g && g.daily) ? RC.Daily.rand(g) : Math.random(); }

  // Wave state lives on the GAME (g._sv), not in module scope, so the server can run
  // many survival rooms at once without them sharing a wave counter. Cleared in
  // game.reset(). reset() is kept for the offline caller but is a no-op now.
  function st(g) {
    if (!g._sv) g._sv = { wave: 0, timer: prepOf(g), queue: [], spawnT: 0, clearing: false };
    return g._sv;
  }
  function reset() { }

  // ── The curve ─────────────────────────────────────────────────────────────

  // How many enemies wave w contains. Accelerating rather than linear: the early
  // waves are a warm-up, the pressure compounds later.
  function waveSize(w, D) {
    const n = D.size + D.sizeGrow * Math.pow(Math.max(0, w - 1), D.sizeExp);
    return Math.max(2, Math.min(D.sizeCap, Math.round(n)));
  }

  // A type's share of wave w — 0 before it unlocks, a quarter on its debut wave,
  // full weight RAMP waves after that. This is what turns "a new enemy type" from
  // a cliff into a slope.
  function weightAt(e, w, D) {
    let at = e.at;
    if (!e.core) at += (D.unlock || 0);
    if (e.air) at += (D.airShift || 0);
    at = Math.max(1, at);
    if (w < at) return 0;
    return e.w * Math.min(1, 0.25 + 0.75 * (w - at) / RAMP);
  }

  function poolFor(w, D) {
    const pool = [];
    let total = 0;
    for (const e of ROSTER) {
      const wt = weightAt(e, w, D);
      if (wt > 0) { pool.push({ t: e.t, wt }); total += wt; }
    }
    if (!pool.length) { pool.push({ t: 'globling', wt: 1 }); total = 1; }
    return { pool, total };
  }

  function pickFrom(pool, total, g) {
    let r = rnd(g) * total;
    for (const e of pool) { r -= e.wt; if (r <= 0) return e.t; }
    return pool[pool.length - 1].t;
  }

  // The heaviest type that has FULLY ramped in — a milestone push should reinforce
  // a threat the player has already met, not introduce a brand-new one three at a
  // time. Falls back to any unlocked heavy, then to nothing.
  function heaviestUnlocked(w, D) {
    for (const pass of [RAMP, 0]) {
      for (const t of HEAVY_ORDER) {
        for (const e of ROSTER) {
          if (e.t !== t) continue;
          const at = Math.max(1, e.at + (e.core ? 0 : (D.unlock || 0)));
          if (weightAt(e, w, D) > 0 && w >= at + pass) return t;
        }
      }
    }
    return null;
  }

  // Which unit types make up wave w (tougher types unlock sooner on higher difficulty)
  function compose(w, g) {
    const D = diffOf(g);
    const { pool, total } = poolFor(w, D);
    const count = waveSize(w, D);
    const list = [];
    for (let i = 0; i < count; i++) list.push(pickFrom(pool, total, g));

    // Milestone push — every fifth wave from 10 on, a few of the heaviest
    // unlocked type arrive behind the horde. Held back until wave 10 on purpose:
    // the old version forced two Bloats into wave 5, two waves BEFORE Bloats were
    // supposed to exist at all, which is why wave 5 used to end so many runs.
    if (w >= 10 && w % 5 === 0) {
      const heavy = heaviestUnlocked(w, D);
      if (heavy) {
        const n = 1 + Math.floor(w / 10);
        for (let i = 0; i < n; i++) list.push(heavy);
      }
    }
    return list;
  }

  // Enemy HP growth per wave, scaled by difficulty (applied on spawn).
  // Flat at hpBase for the first hpFree waves — wave 1 enemies are exactly as
  // tough as the unit card says, no more.
  function scaleHp(u, w, g) {
    const D = diffOf(g);
    const f = D.hpBase * (1 + D.hpGrow * Math.max(0, w - (D.hpFree || 0)));
    u.baseMaxHp = u.def.hp * f;
    u.maxHp = Math.round(u.def.hp * f);
    u.hp = u.maxHp;
    // Aether 유닛은 실드도 같은 비율로 — 안 그러면 후반 웨이브에서 실드가 무의미해진다
    if (u.maxShield) {
      u.baseMaxShield = u.def.shield * f;
      u.maxShield = Math.round(u.def.shield * f);
      u.shield = u.maxShield;
    }
  }

  function countEnemies(g) {
    let n = 0;
    for (const u of g.units) if (u.owner === ENEMY && !u.dead) n++;
    return n;
  }

  function startWave(g) {
    const s = st(g);
    s.wave++;
    g.survivalWave = s.wave;
    // Run log — the game time each wave began at. The leaderboard checks a submitted
    // run against it: this director cannot start wave N+1 before wave N has finished
    // spawning and the between-wave gap has passed, so a claimed run that outruns its
    // own spawn timings never happened. Recorded HERE rather than in the client so a
    // solo run and a server-simulated co-op run produce the same log from the same code.
    if (!g.waveTimes) g.waveTimes = [];
    if (g.waveTimes.length < 600) g.waveTimes.push(Math.round((g.time || 0) * 100) / 100);
    s.queue = compose(s.wave, g);
    s.spawnT = 0;
    s.clearing = false;
    const D = diffOf(g);
    if (g.upgrades[ENEMY]) {
      // wave-1 relative, so the horde does not open the run already upgraded
      const w0 = Math.max(0, s.wave - 1);
      g.upgrades[ENEMY].atk = Math.min(3, Math.floor(w0 / D.atkEvery));
      g.upgrades[ENEMY].arm = Math.min(3, Math.floor(w0 / D.armEvery));
    }
    g.notify('⚠ Wave ' + s.wave + ' incoming!');
    if (RC.Audio) RC.Audio.play('wave');
  }

  function spawnOne(g) {
    const s = st(g);
    const type = s.queue.shift();
    const o = g.enemySpawn;
    const u = new RC.Unit(type, o.x + (rnd(g) * 120 - 60), o.y + (rnd(g) * 500 - 250), ENEMY);
    scaleHp(u, s.wave, g);
    // 데일리 '스프린터' — 호드 전체가 빨라진다 (유닛별 이동속도 배율)
    const m = g.daily && g.daily.mod;
    if (m && m.speed) u.speedMul = m.speed;
    if (g.initUnit) g.initUnit(u);
    g.units.push(u);
    u.attackMoveTo(g.crystal.x, g.crystal.y);   // fight through defenders, but keep pressing the crystal
  }

  // Keep idle horde units marching toward the crystal
  function steer(g) {
    if (!g.crystal || g.crystal.dead) return;
    for (const u of g.units) {
      if (u.owner !== ENEMY || u.dead) continue;
      if (u.state === 'idle') u.attackMoveTo(g.crystal.x, g.crystal.y);
    }
  }

  function update(dt, g) {
    const s = st(g);
    if (g.over) return;
    if (!g.crystal || g.crystal.dead) return;

    if (s.queue.length) {
      // still spawning the current wave
      s.spawnT -= dt;
      if (s.spawnT <= 0) { spawnOne(g); s.spawnT = SPAWN_STEP; }
    } else if (s.wave === 0) {
      // initial prep before the very first wave
      s.timer -= dt;
      if (s.timer <= 0) startWave(g);
    } else if (countEnemies(g) === 0) {
      // current wave fully cleared → short breather, then the next (heavier) wave
      if (!s.clearing) {
        s.clearing = true;
        s.timer = gapOf(g);
        g.notify('Wave ' + s.wave + ' cleared — next in ' + Math.max(1, Math.round(s.timer)) + 's');
      }
      s.timer -= dt;
      if (s.timer <= 0) startWave(g);
    }
    // else: enemies still alive → wait (no new wave spawns, so they can't pile up)

    steer(g);
  }

  // ── The pacing floor ──────────────────────────────────────────────────────
  // The shortest possible time between the start of wave w and the start of wave
  // w+1: every unit in wave w has to spawn (SPAWN_STEP apart), the wave has to be
  // wiped out, and only then does the gap run. Killing takes more than zero time,
  // so this is a floor no run can beat.
  //
  // The leaderboard uses it to check a submitted run's wave log. It lives HERE
  // rather than in the server because it is made entirely of this file's own
  // constants — the server used to carry its own copies of SPAWN_STEP and GAP with
  // a "must match survival.js" comment, which is the kind of duplication that
  // silently drifts. `g` is any object the director understands, so daily twists
  // that change wave size or the gap (Blitz cuts it to 30%, Elite Guard shrinks
  // the waves) are accounted for instead of failing honest runs.
  function minSpacing(w, g) {
    return waveSize(w, diffOf(g)) * SPAWN_STEP + gapOf(g);
  }

  return { reset, update, compose, scaleHp, diffOf, prepOf, gapOf, waveSize, weightAt, minSpacing, ROSTER,
           SPAWN_STEP, GAP,
           diffName: k => (DIFF[k] || DIFF.medium).name };
})();
