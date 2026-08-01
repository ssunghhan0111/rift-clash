// The Keep — the gesture, in a real browser
// ---------------------------------------------------------------------------
// keep_test covers the rules; this covers the thing a child's hands actually do.
// The whole request that started this feature was "building wall should be aligned
// easily so that it can snap and be one line", and that is not a rule you can test
// in a simulation — it is a drag, on a canvas, with a camera under it. This suite
// performs the real gesture with a real pointer and checks what came out.
//
// It also exists because of how this particular feature fails. Placement used to
// commit on pointer DOWN, so a build press could never become a drag; moving the
// commit to pointer UP is what made a row possible, and it is the kind of change
// that works perfectly in one mode and silently breaks another. The first honest
// run of this test produced a vertical wall from a horizontal drag — edge-scroll
// had panned the map out from under the gesture — which is exactly the class of
// bug no headless test would ever have found.
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
const { chromium } = pw;
const { spawn } = require('child_process');
const PORT = 8940 + (process.pid % 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'], { env: { ...process.env, PORT: String(PORT) }, cwd: SRC, stdio: 'ignore' });
  await sleep(1200);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    // Start from no keep at all, or the previous run's castle is restored into this
  // one and every count in the test is measuring two sessions instead of one.
  // addInitScript runs on EVERY navigation, so the wipe is gated on a sentinel —
  // otherwise the reload that proves the keep survives is the thing that deletes it.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('riftclash_name', 'Tester');
      if (!sessionStorage.getItem('rc-wiped')) {
        localStorage.removeItem('riftclash_keep');
        sessionStorage.setItem('rc-wiped', '1');
      }
    } catch (e) {}
  });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await sleep(1400);

  console.log('=== the start screen ===');
  await page.click('#ss-gamemodes .gmcard[data-m="defend"]');
  await sleep(400);
  ok(await page.isVisible('#keep-card'), 'the keep card is on the front page');
  ok((await page.textContent('#ss-kids')).includes('Build'), 'the play button says Build & Defend');
  await page.click('#ss-kids');
  await sleep(2200);

  console.log('\n=== Build Day ===');
  const st = () => page.evaluate(() => RC.Kids.hud(RC.game, RC.game.playerOwner));
  let h = await st();
  ok(h.phase === 'build', 'the run opens on Build Day (' + h.phase + ')');
  ok(await page.isVisible('#kid-day'), 'the Build Day bar is up');
  ok(/Start the night/.test(await page.textContent('#kid-daybtn')), 'with a button that starts the night');
  ok(h.day.night === 0, 'and it is daytime');

  console.log('\n=== drag a wall ===');
  // Open the build panel the way a player does, then arm the stone wall.
  // dispatchEvent, not click: the tab carries a "come and tap me" bob animation
  // until the player has opened a panel once, and Playwright will not click a
  // moving target. The handler listens on pointerdown either way.
  //
  // Retried, because the tab is a no-op until the builder it selects has actually
  // walked out of the base — which under software rendering can be a second or two
  // after the match starts.
  let panel = false;
  for (let i = 0; i < 25 && !panel; i++) {
    await page.dispatchEvent('#kid-tabs .kid-tab[data-focus="builder"]', 'pointerdown');
    await sleep(400);
    panel = await page.isVisible('#kid-build');
  }
  ok(panel, 'tapping the builder opens the build panel');
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('#kid-build .kid-bb')).map(n => n.dataset.t));
  ok(btns.includes('rampart') && btns.includes('keepgate') && btns.includes('banner'),
     'walls, the gate and the decorations are all in the panel');
  await page.evaluate(() => { RC.game.placing = 'logwall'; });
  let hint = '';
  for (let i = 0; i < 20; i++) { await sleep(120); hint = await page.textContent('#kid-placing'); if (/DRAG/.test(hint)) break; }
  ok(/DRAG/.test(hint), 'the hint teaches the drag gesture: ' + JSON.stringify(hint));

  // Park the camera so the target ground is dead centre. The gesture has to stay
  // clear of the screen edges or edge-scroll pans the map underneath the drag —
  // which is exactly what turned the first attempt at this test into a vertical wall.
  await page.evaluate(() => { RC.Input.centerOn(RC.game.crystal.x - 300 + RC.Keep.GRID * 3, RC.game.crystal.y - 240); });
  await sleep(400);
  const geom = await page.evaluate(() => {
    const g = RC.game, cam = g.camera, z = cam.z || 1;
    const r = document.getElementById('screen').getBoundingClientRect();
    const toScreen = (wx, wy) => ({ x: r.left + (wx - cam.x) * z, y: r.top + (wy - cam.y) * z });
    const a = toScreen(g.crystal.x - 300, g.crystal.y - 240);
    const b = toScreen(g.crystal.x - 300 + RC.Keep.GRID * 6, g.crystal.y - 240 + 14);
    return { a, b, before: RC.Keep.shards(RC.game) };
  });
  await page.mouse.move(geom.a.x, geom.a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(geom.a.x + (geom.b.x - geom.a.x) * i / 8, geom.a.y + (geom.b.y - geom.a.y) * i / 8);
    await sleep(30);
  }
  const plan = await page.evaluate(() => RC.Input.planCells().map(c => [c.x, c.y]));
  ok(plan.length === 7, 'the ghost previews the whole row before you let go (' + plan.length + ' cells)');
  ok(plan.every(p => p[1] === plan[0][1]), 'and the preview is already one straight line');
  await page.mouse.up();
  await sleep(600);

  const after = await page.evaluate(() => {
    const g = RC.game;
    const w = g.buildings.filter(b => b.type === 'logwall' && !b.dead);
    return {
      n: w.length, shard: RC.Keep.shards(g),
      aligned: w.every(b => Math.abs(b.y - w[0].y) < 0.01),
      onGrid: w.every(b => Math.abs(((b.x / RC.Keep.GRID) % 1) - 0.5) < 1e-6),
      placing: g.placing,
    };
  });
  ok(after.n === plan.length, 'one drag laid all ' + plan.length + ' of them (' + after.n + ')');
  ok(after.aligned, 'and they are on ONE line');
  ok(after.onGrid, 'every one snapped to the grid');
    // Income is still trickling in during the gesture, so this is a band rather than
  // an equality — what matters is that ONE pile paid for all of them.
  const paid = geom.before - after.shard;
  ok(paid > plan.length * 12 - 60 && paid <= plan.length * 12,
     'the shared pile paid for all ' + plan.length + ' (net ' + Math.round(paid) + ' of ' + plan.length * 12 + ')');
  ok(after.placing === 'logwall', 'the tool stays armed so the next wall is one gesture away');

  console.log('\n=== it builds itself ===');
  ok((await page.evaluate(() => RC.Kids.workersOf(RC.game, RC.game.playerOwner).length)) === 1,
     'one builder, not a crew');
  let prog = { done: 0, started: 0 };
  for (let i = 0; i < 40 && prog.done < 1; i++) {
    await sleep(700);
    prog = await page.evaluate(() => {
      const w = RC.game.buildings.filter(b => b.type === 'logwall' && !b.dead);
      return { done: w.filter(b => b.done).length, started: w.filter(b => b.buildProgress > 0).length };
    });
  }
  ok(prog.done >= 1, 'a piece of the row went up without anyone being ordered to build it');
  // The claim worth testing is the CHAIN, not the throughput: when a piece finishes,
  // does the builder pick the next one up by itself? Tested by finishing the current
  // piece by hand and watching where the builder goes, which is deterministic —
  // waiting for a software-rendered browser to grind out seven walls is not.
  const chain = await page.evaluate(async () => {
    const g = RC.game;
    const w = RC.Kids.workersOf(g, g.playerOwner)[0];
    const was = w.site;
    if (was) was.buildProgress = 1;
    await new Promise(r => setTimeout(r, 900));
    return { had: !!was, moved: !!w.site && w.site !== was, state: w.state };
  });
  ok(chain.had, 'a builder had a piece assigned');
  ok(chain.moved, 'and when it finished, walked to the next one on its own (state ' + chain.state + ')');

  console.log('\n=== undo, and take down ===');
  // The remove tool is armed and dragged exactly like a wall, which is the point: one
  // gesture to learn, used in both directions.
  await page.evaluate(() => { RC.game.placing = RC.Keep.DEMO; });
  await sleep(400);
  ok(/Remove/.test(await page.textContent('#kid-placing')), 'arming Remove says so');
  ok(await page.evaluate(() => RC.Input.snapMode()), 'and it snaps to the same grid');

  // Drag it back along the row that is still going up: everything unfinished is undone.
  const un = await page.evaluate(() => ({ purse: RC.Keep.shards(RC.game),
    sites: RC.game.buildings.filter(b => b.type === 'logwall' && !b.dead && !b.done).length }));
  await page.mouse.move(geom.a.x, geom.a.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(geom.a.x + (geom.b.x - geom.a.x) * i / 8, geom.a.y + (geom.b.y - geom.a.y) * i / 8);
    await sleep(30);
  }
  await page.mouse.up();
  await sleep(700);
  const undone = await page.evaluate(() => ({
    sites: RC.game.buildings.filter(b => b.type === 'logwall' && !b.dead && !b.done).length,
    done: RC.game.buildings.filter(b => b.type === 'logwall' && !b.dead && b.done).length,
    marked: RC.Keep.demoCount(RC.game),
    purse: RC.Keep.shards(RC.game),
    placing: RC.game.placing,
  }));
  ok(undone.sites === 0, 'one drag undid every unfinished piece of the row (' + un.sites + ' -> 0)');
  ok(undone.purse > un.purse, 'and the shards came back (' + Math.round(un.purse) + ' -> ' + Math.round(undone.purse) + ')');
  ok(undone.marked === undone.done,
     'while the ' + undone.done + ' already standing were CONDEMNED, not vanished');
  ok(undone.placing === '__remove', 'the tool stays in hand');

  // And a condemned wall really does come down, on a builder's own time.
  if (undone.done) {
    const gone = await page.evaluate(async () => {
      const g = RC.game;
      const b = g.buildings.find(x => x.demo && !x.dead);
      const w = RC.Kids.workersOf(g, g.playerOwner)[0];
      const t0 = b.demoT || 0;
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 120));
        if (b.dead) return { dead: true, ticked: true };
      }
      return { dead: b.dead, ticked: (b.demoT || 0) > t0, job: w.demoJob === b };
    });
    ok(gone.dead || gone.ticked || gone.job,
       'a builder went to it and started knocking it down' + JSON.stringify(gone));
  }
  await page.evaluate(() => { RC.game.placing = null; RC.Keep.unmarkAll(RC.game); });

  console.log('\n=== a castle, joined ==='); 
  // Lay a rectangle by hand so the join art has corners to draw.
  await page.evaluate(async () => {
    const g = RC.game, G = RC.Keep.GRID, c = g.crystal;
    const x0 = c.x - G * 4, y0 = c.y - G * 3, x1 = c.x + G * 4, y1 = c.y + G * 3;
    g.res[RC.Keep.bank(g)].shard = 4000;
    const row = (ax, ay, bx, by, t) => {
      const cells = RC.Keep.line(ax, ay, bx, by);
      RC.Kids.build(g, t, cells[0].x, cells[0].y, g.playerOwner, cells);
    };
    row(x0, y0, x1, y0, 'rampart');
    row(x0, y1, x1, y1, 'rampart');
    row(x0, y0, x0, y1, 'rampart');
    row(x1, y0, x1, y1, 'rampart');
    // corners get towers, the south wall gets a gate, and the yard gets dressed
    [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(p => {
      const b = g.buildings.find(q => Math.abs(q.x - p[0]) < 2 && Math.abs(q.y - p[1]) < 2 && !q.dead);
      if (b) b.dead = true;
      g._keepIx = null;
      RC.Kids.build(g, 'stonethrower', p[0], p[1], g.playerOwner, [{ x: p[0], y: p[1] }]);
    });
    // A gate in the south wall: clear whatever is in that exact cell first.
    const gs = RC.Keep.snap(c.x, y1);
    const gb = g.buildings.find(q => Math.abs(q.x - gs.x) < 2 && Math.abs(q.y - gs.y) < 2 && !q.dead);
    if (gb) gb.dead = true;
    g._keepIx = null;
    RC.Kids.build(g, 'keepgate', gs.x, gs.y, g.playerOwner, [{ x: gs.x, y: gs.y }]);
    RC.Kids.build(g, 'banner', c.x - RC.Keep.GRID * 2, c.y + RC.Keep.GRID * 2, g.playerOwner, [{ x: c.x - RC.Keep.GRID * 2, y: c.y + RC.Keep.GRID * 2 }]);
    RC.Kids.build(g, 'torch', c.x + RC.Keep.GRID * 2, c.y + RC.Keep.GRID * 2, g.playerOwner, [{ x: c.x + RC.Keep.GRID * 2, y: c.y + RC.Keep.GRID * 2 }]);
    RC.Kids.build(g, 'planter', c.x + RC.Keep.GRID * 2, c.y - RC.Keep.GRID * 2, g.playerOwner, [{ x: c.x + RC.Keep.GRID * 2, y: c.y - RC.Keep.GRID * 2 }]);
    RC.Kids.build(g, 'signpost', c.x - RC.Keep.GRID * 2, c.y - RC.Keep.GRID * 2, g.playerOwner, [{ x: c.x - RC.Keep.GRID * 2, y: c.y - RC.Keep.GRID * 2 }]);
    g.buildings.forEach(b => { if (RC.Keep.isPiece(b) && !b.dead) b.buildProgress = 1; });
    g._keepIx = null;
    g.placing = null;
    g.selection = [];
    RC.Input.setZoom(0.62);
    RC.Input.centerOn(c.x, c.y);
  });
  await sleep(900);
  const mask = await page.evaluate(() => {
    const g = RC.game;
    const walls = g.buildings.filter(b => b.type === 'rampart' && !b.dead && b.done);
    const corners = walls.filter(b => { const m = RC.Keep.joinMask(g, b); return m === 3 || m === 6 || m === 9 || m === 12; });
    const runs = walls.filter(b => { const m = RC.Keep.joinMask(g, b); return m === 5 || m === 10; });
    return { walls: walls.length, corners: corners.length, runs: runs.length };
  });
  ok(mask.runs >= 6, mask.runs + ' wall pieces know they are mid-run and draw joined');
  ok(mask.walls > 14, 'the keep is ' + mask.walls + ' wall pieces — far past the old 14-slot ceiling');

  console.log('\n=== night falls ===');
  // The button stays disabled for the first few seconds of sim time so a stray tap
  // cannot skip the day — wait for it rather than assuming wall time matches.
  for (let i = 0; i < 40; i++) {
    if (!(await page.evaluate(() => document.getElementById('kid-daybtn').disabled))) break;
    await sleep(500);
  }
  ok(!(await page.evaluate(() => document.getElementById('kid-daybtn').disabled)), 'Ready becomes pressable');
  await page.dispatchEvent('#kid-daybtn', 'pointerdown');
  for (let i = 0; i < 30; i++) { h = await st(); if (h.phase !== 'build') break; await sleep(400); }
  ok(h.phase !== 'build', 'pressing Ready started the night (' + h.phase + ')');
  ok(h.day.night > 0.5 || h.phase === 'spawning' || h.phase === 'fighting', 'and the world went dark');
  const gate = await page.evaluate(() => {
    const g = RC.game, gt = g.buildings.find(b => b.def.gate && !b.dead);
    return gt ? { open: RC.Keep.gateOpen(g, gt), pass: !!gt.passable } : null;
  });
  ok(gate && gate.open === false, 'the gate shut on its own when night fell');
  ok(gate && gate.pass === false, 'and went back into the nav grid, so the raid has to break it');
  await sleep(2500);

  console.log('\n=== nothing you built is ever lost ===');
  await page.evaluate(() => { RC.game.crystal.hp = 0; RC.game.crystal.dead = true; });
  await sleep(900);
  const cracked = await page.evaluate(() => ({
    over: !!RC.game.over,
    hp: Math.round(100 * RC.game.crystal.hp / RC.game.crystal.maxHp),
    phase: RC.Kids.st(RC.game).phase,
    pieces: RC.Keep.pieceCount(RC.game),
  }));
  ok(!cracked.over, 'the crystal falling did NOT end the run');
  ok(cracked.phase === 'build', 'it cracked and handed back a Build Day');
  ok(cracked.pieces > 20, 'and the keep is still standing — ' + cracked.pieces + ' pieces');

  console.log('\n=== and it is there tomorrow ===');
  await page.evaluate(() => RC.Keep.capture(RC.game));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await sleep(1400);
  await page.click('#ss-gamemodes .gmcard[data-m="defend"]');
  await sleep(500);
  const card = await page.evaluate(() => ({
    name: document.getElementById('keep-name').textContent,
    stats: document.getElementById('keep-stats').textContent,
    drawn: (() => {
      const cv = document.getElementById('keep-mini');
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 200) lit++;
      return lit;
    })(),
  }));
  ok(/pieces standing/.test(card.stats), 'the front page shows the keep that survived: ' + card.stats.replace(/\s+/g, ' ').trim());
  ok(card.drawn > 400, 'and draws its plan (' + card.drawn + ' lit pixels)');

  ok(errs.length === 0, 'no console errors through any of it' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await browser.close();
  srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.message + '\n' + e.stack); process.exit(1); });
