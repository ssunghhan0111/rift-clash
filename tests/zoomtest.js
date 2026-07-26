// Zoom: mouse wheel on PC, two-finger pinch on tablet. The thing that actually
// matters is that the world under your cursor does not move, and that a click
// still lands where you aimed it — a zoom that breaks toWorld() breaks every
// order in the game. Also checks the population cap, since the two shipped
// together and the bigger armies are what zoom is for.
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
const { spawn } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── headless: the cap and the wire format ─────────────────────────────────
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

console.log('=== population cap ===');
{
  ok(RC.CFG.POP_CAP === 100, 'POP_CAP is ' + RC.CFG.POP_CAP + ', expected 100');
  const g = new RC.Game(RC.getMap('earth'), RC.MODES['1v1']);
  g.reset();
  const start = g.supply(1);
  ok(start.max === 10, 'a fresh base should give 10 supply, gives ' + start.max);

  // enough Power Cells to blow through the old cap of 30
  for (let i = 0; i < 14; i++) {
    const b = new RC.Building('cell', 300 + i * 70, 300, 1, true);
    b.done = true; b.buildProgress = 1;
    g.buildings.push(b);
  }
  const grown = g.supply(1);
  ok(grown.max > 30, 'supply is still capped near the old limit (' + grown.max + ')');
  ok(grown.max === Math.min(10 + 14 * 8, 100), 'supply cap maths is off: ' + grown.max);
  console.log('  14 Power Cells → ' + grown.max + ' supply (old cap was 30) ✓');

  // ...and the cap really is the ceiling
  for (let i = 0; i < 20; i++) {
    const b = new RC.Building('cell', 300 + i * 70, 500, 1, true);
    b.done = true; b.buildProgress = 1;
    g.buildings.push(b);
  }
  ok(g.supply(1).max === 100, 'the cap is not holding at 100 (' + g.supply(1).max + ')');
  console.log('  34 Power Cells → still ' + g.supply(1).max + ', the cap holds ✓');
}

// The snapshot is a full dump 15x a second, so 100 supply x 4 players is where a
// fat wire format starts costing real bandwidth. Rows must stay lean.
console.log('\n=== the wire format carries the bigger armies ===');
{
  const g = new RC.Game(RC.getMap('earth'), RC.MODES['2v2']);
  g.reset();
  const types = ['volt', 'shielder', 'chaingunner', 'globling', 'ardent', 'heli'];
  while (g.units.length < 300) {
    const u = new RC.Unit(types[g.units.length % types.length],
                          400 + (g.units.length % 40) * 30, 400 + Math.floor(g.units.length / 40) * 30,
                          1 + (g.units.length % 4));
    if (g.initUnit) g.initUnit(u);
    g.units.push(u);
  }
  const snap = RC.Net.serialize(g);
  const bytes = JSON.stringify(snap).length;
  const perUnit = bytes / g.units.length;
  ok(perUnit < 110, 'a unit costs ' + perUnit.toFixed(0) + ' bytes on the wire — too fat for 100 supply');
  console.log('  300 units → ' + (bytes / 1024).toFixed(1) + ' kB (' + perUnit.toFixed(0) + ' B/unit, ' +
              (bytes * 15 / 1024).toFixed(0) + ' kB/s per client) ✓');

  // and it must still round-trip perfectly — omitted fields mean DEFAULTS, not lost state
  const a = g.units[7];
  a.state = 'attack'; a.carry = 3; a.energy = 41; a.acidStacks = 2; a.slow = 1; a.hitFlash = 0.1;
  const s2 = RC.Net.serialize(g);
  const c = new RC.Game(RC.getMap('earth'), RC.MODES['2v2']);
  RC.Net.applySnapshot(c, s2);
  ok(c.units.length === g.units.length, 'snapshot lost units (' + g.units.length + ' → ' + c.units.length + ')');
  const b = c.units.find(u => u.id === a.id);
  ok(!!b, 'the modified unit vanished from the snapshot');
  ok(b.type === a.type, 'unit type did not survive the packed wire format (' + b.type + ' vs ' + a.type + ')');
  ok(b.state === 'attack', 'unit state did not survive (' + b.state + ')');
  ok(b.carry === 3 && b.energy === 41 && b.acidStacks === 2, 'a non-default field was dropped');
  ok(b.slow > 0, 'the status bitmask did not survive');
  const plain = g.units.find(u => u !== a && u.state === 'idle' && !u.carry && !u.acidStacks);
  const idle = plain && c.units.find(u => u.id === plain.id);
  ok(!!idle, 'the untouched unit vanished from the snapshot');
  ok(idle && idle.state === 'idle' && idle.carry === 0 && idle.acidStacks === 0 && !idle.slow,
     'an omitted field did not read back as its default (' + (idle && idle.state) + '/' +
     (idle && idle.carry) + '/' + (idle && idle.acidStacks) + ')');
  const bl = c.buildings.find(x => x.id === g.buildings[0].id);
  ok(bl && bl.type === g.buildings[0].type, 'building type did not survive the packed wire format');
  console.log('  types, states and every non-default field round-trip; omitted fields read back as defaults ✓');
}

// ── the browser ───────────────────────────────────────────────────────────
const { chromium } = requirePlaywright();
const PORT = 8830 + (process.pid % 60);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(900);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  async function match(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {}));
    await ctx.addInitScript(() => {
      try { localStorage.setItem('riftclash_name', 'Jayden'); localStorage.setItem('rc_fullscreen', '0'); } catch (e) {}
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.Input, null, { timeout: 10000 });
    await page.click('#ss-start');
    await page.waitForFunction(() => window.GAME && window.GAME.units.length > 0, null, { timeout: 10000 });
    await sleep(600);
    page.__errs = errs;
    return page;
  }
  const z = p => p.evaluate(() => RC.Input.zoom());
  // The world span the canvas covers — this is what actually has to change.
  const span = p => p.evaluate(() => {
    const cv = document.getElementById('screen');
    const a = RC.Input.toWorld(0, 0), b = RC.Input.toWorld(cv.width, cv.height);
    return { w: b.x - a.x, h: b.y - a.y };
  });
  const wheel = (p, dy, x, y) => p.evaluate(([dy, x, y]) => {
    const cv = document.getElementById('screen');
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new WheelEvent('wheel', {
      deltaY: dy, clientX: r.left + x, clientY: r.top + y, bubbles: true, cancelable: true,
    }));
  }, [dy, x, y]);

  // ── 1. the wheel zooms, and it is anchored on the cursor ────────────────
  console.log('\n=== the mouse wheel ===');
  {
    const p = await match();
    ok(await z(p) === 1, 'a new match should start at zoom 1, started at ' + await z(p));
    const s0 = await span(p);
    ok(Math.abs(s0.w - 1280) < 2, 'at zoom 1 the canvas should span its own width in world units, spans ' + s0.w.toFixed(0));

    // the world point under the cursor must not move
    const at = { x: 900, y: 300 };
    const before = await p.evaluate(a => RC.Input.toWorld(a.x, a.y), at);
    await wheel(p, -100, at.x, at.y);
    await sleep(120);
    const zIn = await z(p);
    const after = await p.evaluate(a => RC.Input.toWorld(a.x, a.y), at);
    ok(zIn > 1.05, 'wheel up did not zoom in (' + zIn.toFixed(3) + ')');
    ok(Math.abs(after.x - before.x) < 3 && Math.abs(after.y - before.y) < 3,
       'zoom was not anchored on the cursor — the ground slid ' +
       Math.round(Math.hypot(after.x - before.x, after.y - before.y)) + 'px');
    const sIn = await span(p);
    ok(sIn.w < s0.w - 50, 'zooming in did not narrow the view (' + s0.w.toFixed(0) + ' → ' + sIn.w.toFixed(0) + ')');
    console.log('  wheel up → zoom ' + zIn.toFixed(2) + ', view ' + s0.w.toFixed(0) + ' → ' + sIn.w.toFixed(0) +
                ' world px, ground stayed under the cursor ✓');

    for (let i = 0; i < 6; i++) { await wheel(p, 100, at.x, at.y); await sleep(60); }
    const zOut = await z(p);
    const sOut = await span(p);
    ok(zOut < 0.95, 'wheel down did not zoom out (' + zOut.toFixed(3) + ')');
    ok(sOut.w > s0.w + 50, 'zooming out did not widen the view');
    console.log('  wheel down → zoom ' + zOut.toFixed(2) + ', view now ' + sOut.w.toFixed(0) + ' world px ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. the range is deliberately narrow, and it never leaves the map ────
  console.log('\n=== the limits ===');
  {
    const p = await match();
    for (let i = 0; i < 40; i++) await wheel(p, -100, 640, 400);
    await sleep(150);
    const hi = await z(p);
    ok(Math.abs(hi - RC.CFG.ZOOM_MAX) < 0.01, 'zoom-in did not stop at ZOOM_MAX (' + hi.toFixed(3) + ')');

    for (let i = 0; i < 60; i++) await wheel(p, 100, 640, 400);
    await sleep(150);
    const lo = await z(p);
    const lim = await p.evaluate(() => RC.Input.minZoom());
    ok(Math.abs(lo - lim) < 0.01, 'zoom-out did not stop at the limit (' + lo.toFixed(3) + ' vs ' + lim.toFixed(3) + ')');
    ok(lo >= 0.5 && hi <= 1.6, 'the zoom band is too wide to keep units clickable (' + lo.toFixed(2) + '–' + hi.toFixed(2) + ')');
    console.log('  band is ' + lo.toFixed(2) + '–' + hi.toFixed(2) + '× — tight enough to stay controllable ✓');

    // fully zoomed out, the camera must still be inside the map
    const cam = await p.evaluate(() => {
      const cv = document.getElementById('screen'), g = window.GAME, zz = RC.Input.zoom();
      return { x: g.camera.x, y: g.camera.y, right: g.camera.x + cv.width / zz, bottom: g.camera.y + cv.height / zz,
               W: RC.CFG.WORLD_W, H: RC.CFG.WORLD_H };
    });
    ok(cam.x >= -1 && cam.y >= -1, 'zoomed out, the camera walked off the top-left of the map');
    ok(cam.right <= cam.W + 1 && cam.bottom <= cam.H + 1,
       'zoomed out, the view runs past the map edge (' + Math.round(cam.right) + ' > ' + cam.W + ')');
    console.log('  fully zoomed out the view is still inside the map ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 3. a click still lands where you aimed it ───────────────────────────
  // This is the one that matters: toWorld() feeds every order in the game.
  console.log('\n=== clicking while zoomed ===');
  {
    const p = await match();
    for (const [label, turns] of [['zoomed in', -4], ['zoomed out', 6]]) {
      for (let i = 0; i < Math.abs(turns); i++) { await wheel(p, turns < 0 ? -100 : 100, 640, 400); await sleep(40); }
      await sleep(150);
      const hit = await p.evaluate(async () => {
        const g = window.GAME, cv = document.getElementById('screen');
        const zz = RC.Input.zoom();
        const mine = g.units.find(u => u.owner === g.playerOwner);
        RC.Input.centerOn(mine.x, mine.y);                       // make sure it is on screen
        await new Promise(r => setTimeout(r, 60));
        const sx = (mine.x - g.camera.x) * zz, sy = (mine.y - g.camera.y) * zz;
        const r = cv.getBoundingClientRect();
        const opt = { clientX: r.left + sx, clientY: r.top + sy, pointerId: 1, pointerType: 'mouse',
                      button: 0, buttons: 1, bubbles: true, cancelable: true, isPrimary: true };
        g.selection = [];
        cv.dispatchEvent(new PointerEvent('pointerdown', opt));
        window.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, opt, { buttons: 0 })));
        await new Promise(r => setTimeout(r, 80));
        return { z: zz, want: mine.id, got: g.selection.length ? g.selection[0].id : null,
                 name: g.selection.length ? g.selection[0].def.name : null };
      });
      ok(hit.got === hit.want, 'at zoom ' + hit.z.toFixed(2) + ' a click on a unit selected ' + hit.got + ' instead of ' + hit.want);
      console.log('  ' + label + ' (' + hit.z.toFixed(2) + '×): clicked the ' + hit.name + ' and got it ✓');
    }
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 4. the frame is still fully painted at both extremes ───────────────
  // Zooming out is where a missed W/z shows up: the grid, fog and terrain stop
  // short and you get a band of bare background down the right-hand side.
  console.log('\n=== the frame is still painted ===');
  {
    const p = await match();
    const sample = () => p.evaluate(() => {
      const cv = document.getElementById('screen');
      const c = cv.getContext('2d');
      // three columns down the right-hand edge, where a short-drawn world layer shows
      const pts = [[cv.width - 6, 60], [cv.width - 6, cv.height / 2], [cv.width - 6, cv.height - 60],
                   [cv.width / 2, cv.height - 6]];
      return pts.map(([x, y]) => { const d = c.getImageData(x, y, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; });
    });
    const at1 = await sample();
    for (let i = 0; i < 8; i++) { await wheel(p, 100, 640, 400); await sleep(50); }
    await sleep(400);
    const atOut = await sample();
    ok(atOut.every(c => c !== '0,0,0'), 'zoomed out, the edge of the frame is unpainted black: ' + atOut.join(' | '));
    ok(atOut.some((c, i) => c !== at1[i]), 'the frame did not change at all when zooming out — is the world layer scaling?');
    console.log('  edges still painted zoomed out (' + atOut[0] + ') ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 5. pinch on a tablet ───────────────────────────────────────────────
  console.log('\n=== two-finger pinch ===');
  {
    const p = await match({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });
    const pinch = (from, to) => p.evaluate(async ([from, to]) => {
      const cv = document.getElementById('screen');
      const r = cv.getBoundingClientRect();
      const cx = 512, cy = 384;
      const mk = (type, id, x, y) => new PointerEvent(type, {
        pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y,
        bubbles: true, cancelable: true, isPrimary: id === 1, buttons: 1,
      });
      cv.dispatchEvent(mk('pointerdown', 1, cx - from / 2, cy));
      cv.dispatchEvent(mk('pointerdown', 2, cx + from / 2, cy));
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const d = from + (to - from) * (i / steps);
        cv.dispatchEvent(mk('pointermove', 1, cx - d / 2, cy));
        cv.dispatchEvent(mk('pointermove', 2, cx + d / 2, cy));
        await new Promise(r2 => setTimeout(r2, 16));
      }
      window.dispatchEvent(mk('pointerup', 1, cx - to / 2, cy));
      window.dispatchEvent(mk('pointerup', 2, cx + to / 2, cy));
      await new Promise(r2 => setTimeout(r2, 60));
      return RC.Input.zoom();
    }, [from, to]);

    const z0 = await z(p);
    const zSpread = await pinch(200, 460);          // fingers apart → zoom in
    ok(zSpread > z0 + 0.05, 'spreading two fingers did not zoom in (' + z0.toFixed(2) + ' → ' + zSpread.toFixed(2) + ')');
    const zPinch = await pinch(460, 180);           // fingers together → zoom out
    ok(zPinch < zSpread - 0.05, 'pinching two fingers together did not zoom out (' + zSpread.toFixed(2) + ' → ' + zPinch.toFixed(2) + ')');
    console.log('  spread → ' + zSpread.toFixed(2) + '×, pinch → ' + zPinch.toFixed(2) + '× ✓');

    // and a pinch must not leave a selection box behind or fire a stray order
    const clean = await p.evaluate(() => ({ sel: window.GAME.selection.length, dragging: !!RC.Input.state.dragging }));
    ok(!clean.dragging, 'the pinch left a selection box open');
    console.log('  no stray selection box after the gesture ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
