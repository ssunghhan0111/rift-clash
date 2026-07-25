// RIFT CLASH — Survival wave director (offline)
// Enemy waves march from g.enemySpawn to the Rift Crystal. A wave spawns in full, and the
// NEXT wave only begins 5 seconds AFTER the current wave has been completely wiped out — so
// enemies never pile up. Each wave is bigger and stronger; three difficulty levels set the pace.
window.RC = window.RC || {};

RC.Survival = (function () {
  const PREP = 18;          // setup time before wave 1
  const GAP = 5;            // seconds after a wave is fully cleared before the next one
  const SPAWN_STEP = 0.22;  // seconds between individual unit spawns within a wave
  const ENEMY = 2;          // owner id of the attacking horde

  // Difficulty presets — enemy count, HP and upgrade pace scale with the level.
  const DIFF = {
    easy:   { name: 'Easy',       size: 3, sizeGrow: 0.9, hpBase: 0.80, hpGrow: 0.07, atkEvery: 6, armEvery: 10, unlock: 2 },
    medium: { name: 'Medium',     size: 4, sizeGrow: 1.5, hpBase: 1.00, hpGrow: 0.12, atkEvery: 4, armEvery: 6,  unlock: 0 },
    insane: { name: 'Crazy Hard', size: 5, sizeGrow: 2.3, hpBase: 1.35, hpGrow: 0.18, atkEvery: 3, armEvery: 4,  unlock: -2 },
  };
  // Daily Challenge always runs on the Medium curve with the day's twist applied
  // on top, so the only thing separating two players on the daily board is how
  // they played — not which difficulty they picked.
  function diffOf(g) {
    const base = DIFF[g && g.survivalDiff] || DIFF.medium;
    const m = g && g.daily && g.daily.mod;
    if (!m) return base;
    const d = Object.assign({}, DIFF.medium);
    if (m.size) { d.size = Math.max(2, Math.round(d.size * m.size)); d.sizeGrow = d.sizeGrow * m.size; }
    if (m.hp) { d.hpBase = d.hpBase * m.hp; d.hpGrow = d.hpGrow * m.hp; }
    if (m.upgradePace) {
      d.atkEvery = Math.max(1, Math.round(d.atkEvery * m.upgradePace));
      d.armEvery = Math.max(1, Math.round(d.armEvery * m.upgradePace));
    }
    if (m.airEarly) d.unlock = d.unlock + 6;   // air types unlock six waves sooner
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

  // Which unit types make up wave w (tougher types unlock sooner on higher difficulty)
  function compose(w, g) {
    const D = diffOf(g);
    const u = D.unlock;
    const pool = ['globling', 'volt'];
    if (w >= 3 + u) pool.push('spitter');
    if (w >= 5 + u) pool.push('shielder');
    if (w >= 7 + u) pool.push('bloat');
    if (w >= 8 + u) pool.push('ardent');     // Aether — shielded melee, needs sustained damage
    if (w >= 9 + u) pool.push('floater');    // air — the player now needs anti-air towers
    if (w >= 11 + u) pool.push('lancer');    // shielded ranged
    if (w >= 12 + u) pool.push('heli');
    if (w >= 15 + u) pool.push('seraph');    // shielded air
    if (w >= 18 + u) pool.push('bastion');   // late-game shielded siege
    const count = Math.max(3, D.size + Math.round(w * D.sizeGrow));
    const list = [];
    for (let i = 0; i < count; i++) list.push(pool[(rnd(g) * pool.length) | 0]);
    if (w % 5 === 0) list.push('bloat', 'bloat');   // heavier push every 5th wave
    return list;
  }

  // Enemy HP growth per wave, scaled by difficulty (applied on spawn)
  function scaleHp(u, w, g) {
    const D = diffOf(g);
    const f = D.hpBase * (1 + w * D.hpGrow);
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
    s.queue = compose(s.wave, g);
    s.spawnT = 0;
    s.clearing = false;
    const D = diffOf(g);
    if (g.upgrades[ENEMY]) {
      g.upgrades[ENEMY].atk = Math.min(3, Math.floor(s.wave / D.atkEvery));
      g.upgrades[ENEMY].arm = Math.min(3, Math.floor(s.wave / D.armEvery));
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
      // current wave fully cleared → 5s breather, then the next (heavier) wave
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

  return { reset, update, compose, scaleHp, diffOf, prepOf, gapOf,
           diffName: k => (DIFF[k] || DIFF.medium).name };
})();
