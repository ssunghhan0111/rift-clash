// RIFT CLASH — Survival wave director (offline)
// Endless, escalating waves march from g.enemySpawn to the Rift Crystal.
// A wave spawns, trickles in, and 5 seconds after it has finished spawning the next wave begins.
// Each wave is bigger, unlocks tougher units, and enemy HP/upgrades scale up without limit.
window.RC = window.RC || {};

RC.Survival = (function () {
  const PREP = 18;          // seconds of setup time before wave 1
  const GAP = 5;            // seconds between waves (after a wave finishes spawning)
  const SPAWN_STEP = 0.22;  // seconds between individual unit spawns within a wave
  const ENEMY = 2;          // owner id of the attacking horde

  let s = null;

  function reset() {
    s = { wave: 0, timer: PREP, queue: [], spawnT: 0 };
  }

  // Which unit types make up wave w (harder types unlock as waves rise)
  function compose(w) {
    const pool = ['globling', 'volt'];
    if (w >= 3) pool.push('spitter');
    if (w >= 5) pool.push('shielder');
    if (w >= 7) pool.push('bloat');
    if (w >= 9) pool.push('floater');    // air — the player now needs anti-air towers
    if (w >= 12) pool.push('heli');
    const count = 4 + Math.round(w * 1.6);
    const list = [];
    for (let i = 0; i < count; i++) list.push(pool[(Math.random() * pool.length) | 0]);
    if (w % 5 === 0) { list.push('bloat', 'bloat'); }   // heavier push every 5th wave
    return list;
  }

  // Endless HP growth per wave (applied on spawn)
  function scaleHp(u, w) {
    const f = 1 + w * 0.12;
    u.baseMaxHp = u.def.hp * f;
    u.maxHp = Math.round(u.def.hp * f);
    u.hp = u.maxHp;
  }

  function startWave(g) {
    s.wave++;
    g.survivalWave = s.wave;
    s.queue = compose(s.wave);
    s.spawnT = 0;
    // enemy damage/armor creeps up too (reuses the normal upgrade system)
    if (g.upgrades[ENEMY]) {
      g.upgrades[ENEMY].atk = Math.min(3, Math.floor(s.wave / 4));
      g.upgrades[ENEMY].arm = Math.min(3, Math.floor(s.wave / 6));
    }
    g.notify('⚠ Wave ' + s.wave + ' incoming!');
  }

  function spawnOne(g) {
    const type = s.queue.shift();
    const o = g.enemySpawn;
    const u = new RC.Unit(type, o.x + (Math.random() * 120 - 60), o.y + (Math.random() * 500 - 250), ENEMY);
    scaleHp(u, s.wave);
    g.units.push(u);
    u.moveTo(g.crystal.x, g.crystal.y);
    if (s.queue.length === 0) s.timer = GAP;   // wave fully spawned → count down to the next
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

    // trickle the current wave in
    if (s.queue.length) {
      s.spawnT -= dt;
      if (s.spawnT <= 0) { spawnOne(g); s.spawnT = SPAWN_STEP; }
    } else {
      s.timer -= dt;
      if (s.timer <= 0) startWave(g);
    }

    steer(g);
  }

  return { reset, update, compose, scaleHp };
})();
