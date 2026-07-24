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
  function diffOf(g) { return DIFF[g && g.survivalDiff] || DIFF.medium; }

  let s = null;
  function reset() { s = { wave: 0, timer: PREP, queue: [], spawnT: 0, clearing: false }; }

  // Which unit types make up wave w (tougher types unlock sooner on higher difficulty)
  function compose(w, g) {
    const D = diffOf(g);
    const u = D.unlock;
    const pool = ['globling', 'volt'];
    if (w >= 3 + u) pool.push('spitter');
    if (w >= 5 + u) pool.push('shielder');
    if (w >= 7 + u) pool.push('bloat');
    if (w >= 9 + u) pool.push('floater');    // air — the player now needs anti-air towers
    if (w >= 12 + u) pool.push('heli');
    const count = Math.max(3, D.size + Math.round(w * D.sizeGrow));
    const list = [];
    for (let i = 0; i < count; i++) list.push(pool[(Math.random() * pool.length) | 0]);
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
  }

  function countEnemies(g) {
    let n = 0;
    for (const u of g.units) if (u.owner === ENEMY && !u.dead) n++;
    return n;
  }

  function startWave(g) {
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
    const type = s.queue.shift();
    const o = g.enemySpawn;
    const u = new RC.Unit(type, o.x + (Math.random() * 120 - 60), o.y + (Math.random() * 500 - 250), ENEMY);
    scaleHp(u, s.wave, g);
    g.units.push(u);
    u.moveTo(g.crystal.x, g.crystal.y);
  }

  // Keep idle horde units marching toward the crystal
  function steer(g) {
    if (!g.crystal || g.crystal.dead) return;
    for (const u of g.units) {
      if (u.owner !== ENEMY || u.dead) continue;
      if (u.state === 'idle') u.moveTo(g.crystal.x, g.crystal.y);
    }
  }

  function update(dt, g) {
    if (!s) reset();
    if (g.over) return;

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
        s.timer = GAP;
        g.notify('Wave ' + s.wave + ' cleared — next in ' + GAP + 's');
      }
      s.timer -= dt;
      if (s.timer <= 0) startWave(g);
    }
    // else: enemies still alive → wait (no new wave spawns, so they can't pile up)

    steer(g);
  }

  return { reset, update, compose, scaleHp, diffName: k => (DIFF[k] || DIFF.medium).name };
})();
