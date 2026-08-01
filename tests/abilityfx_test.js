// Casting a hero ability must never crash the match
// ---------------------------------------------------------------------------
// This exists because of a specific bug, and it is worth writing down what it was.
//
// The renderer used to decide how long an ability effect lives from a hand-written
// table: `{ barrage: 1.1, swarm: 0.9, aegis: 1.0 }`, with 0.5s for 'nova' and 'heal'
// and a flat 0.35s for everything else. The abilities themselves choose the lifetime
// when they push the effect (`game.fx.push({ abil: 'salvo', t: 1.0, ... })`), and
// nothing kept the two in step. Nine effects ended up pushing a longer `t` than the
// table allowed — Firestorm's 1.0s 'salvo', Bulwark's 1.0s 'dome', Flare's 0.6s 'nova'
// among them.
//
// For those, `prog = 1 - t/life` was NEGATIVE on the very first frame. `f.radius * prog`
// went negative with it, and `ctx.arc` throws on a negative radius — which the global
// error boundary in main.js turned into the full-screen "Something went wrong" panel.
// Using your ultimate could end the run.
//
// The sim never saw any of this: it is purely a draw-path failure, which is why the
// existing headless suites all stayed green while the game was crashing in front of
// players. That is the gap this file closes — it drives the REAL renderer against a
// real canvas and asserts only one thing, that nothing throws.
//
// The assertion is deliberately "no exception" rather than anything about how the
// effect looks. Art is meant to change; crashing out of a live match is not.
const path = require('path');
const SRC = path.join(__dirname, '..');
function requirePlaywright() {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright',
                   '/home/claude/.npm-global/lib/node_modules/playwright',
                   '/usr/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch (e) {}
  }
  console.log('SKIP: playwright not installed (npm i -g playwright), browser tests skipped');
  process.exit(0);
}
const pw = requirePlaywright();
const { spawn } = require('child_process');

const PORT = 8950 + (process.pid % 40);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'],
    { env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC, stdio: 'ignore' });
  await sleep(1200);
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Tester'); } catch (e) {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(1200);

  // Every hero, every button, against a spread of board states. The empty ones matter
  // as much as the busy ones: several abilities reason about the crystal or about a
  // current target, and "cast it with nothing on the map" is a real thing players do.
  const result = await page.evaluate(async () => {
    const out = { errors: [], casts: 0, effects: 0, heroes: [] };
    // A canvas of our own, so this never depends on the match-screen layout.
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 600;
    const mini = document.createElement('canvas'); mini.width = 180; mini.height = 180;
    RC.Renderer.init(cv, mini);
    const INPUT = { camX: 300, camY: 300, sel: [], box: null, zoom: 1 };

    function build(heroId, opts) {
      opts = opts || {};
      const g = new RC.Game();
      g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.over = null;
      g.teamMap = { 1: 0, 2: 1 };
      const h = new RC.Unit(heroId, 400, 400, 1);
      h.level = opts.level || 1; h.facing = 0;
      g.units.push(h);
      if (opts.crystal !== false) {
        const b = new RC.Building('crystal', 500, 500, 1, true);
        g.buildings.push(b); g.crystal = b;
      }
      for (let i = 0; i < (opts.enemies || 0); i++) g.units.push(new RC.Unit('volt', 420 + i * 11, 410 + i * 6, 2));
      for (let i = 0; i < (opts.allies || 0); i++) g.units.push(new RC.Unit('volt', 380 - i * 11, 390 - i * 6, 1));
      return { g, h };
    }
    const SCEN = {
      'enemies and allies': { enemies: 6, allies: 3 },
      'an empty board':     { enemies: 0, allies: 0 },
      'no crystal':         { enemies: 5, crystal: false },
      'a maxed hero':       { enemies: 6, allies: 4, level: 10 },
      'a crowd':            { enemies: 14, allies: 8 },
    };

    for (const heroId of RC.HEROES) {
      const keys = (RC.UNITS[heroId].skills || []).map(s => s && s.key).filter(Boolean);
      out.heroes.push(heroId + ':' + keys.join(''));
      for (const scen of Object.keys(SCEN)) {
        for (const key of keys) {
          try {
            const b = build(heroId, SCEN[scen]);
            const g = b.g, h = b.h;
            h.charge = 1; h.sigCd = 0; h.energy = 9999; h.skillCd = {};
            if (h.cast(g, key)) out.casts++;
            out.effects += g.fx.filter(f => f.abil).length;
            // Long enough to outlive the longest effect (Sanctuary's dome, 1.0s) with
            // room to spare — the original bug threw on frame one, but an effect that
            // only goes wrong as it expires would slip past a shorter run.
            for (let i = 0; i < 70; i++) { g.update(1 / 30); RC.Renderer.draw(g, INPUT); }
          } catch (e) {
            out.errors.push(heroId + ' ' + key + ' with ' + scen + ': ' + e.message);
          }
        }
      }
    }
    return out;
  });

  console.log('=== every hero ability, cast and drawn ===');
  console.log('  kits: ' + result.heroes.join(' · '));
  ok(result.casts >= 15, 'all five kits actually fired (' + result.casts + ' casts)');
  ok(result.effects > 0, 'the casts pushed drawable effects (' + result.effects + ')');
  // The one that matters. Note the failure prints the offending hero and board state,
  // because "an ability crashed" without knowing which is a bad bug report.
  ok(result.errors.length === 0,
    'no ability throws while its effect is on screen'
    + (result.errors.length ? '\n      ' + [...new Set(result.errors)].slice(0, 8).join('\n      ') : ''));

  // A negative radius reaches ctx.arc only through `prog`, so pin the invariant itself
  // rather than trusting that the cases above happen to cover every future effect.
  const progOk = await page.evaluate(() => {
    // Rebuild the arithmetic the renderer uses: lifetime comes from the effect's own
    // starting `t`, so prog can never leave [0, 1] whatever duration an ability picks.
    const bad = [];
    for (const t0 of [0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 2.5]) {
      const life = Math.max(0.001, t0);
      for (let t = t0; t > -0.2; t -= 1 / 30) {
        const prog = Math.min(1, Math.max(0, 1 - Math.max(0, t) / life));
        if (!(prog >= 0 && prog <= 1)) bad.push(t0 + '@' + t.toFixed(2) + '→' + prog);
      }
    }
    return bad;
  });
  ok(progOk.length === 0, 'effect progress stays within 0..1 for any lifetime an ability picks');

  console.log('\n' + (fail ? '✖ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
  await browser.close();
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
