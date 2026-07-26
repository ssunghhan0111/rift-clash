// On a tablet or phone the map must move ONLY under two fingers. One finger
// selects; edge-scroll is a mouse affordance and must never arm from a touch.
// Driven with real touch events in a real phone-sized Chromium.
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
const { chromium, devices } = requirePlaywright();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8850 + (process.pid % 100);
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

  // A tablet-shaped context with touch on and no mouse.
  async function tabletPage() {
    const ctx = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      hasTouch: true, isMobile: false, deviceScaleFactor: 2,
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Jayden'); } catch (e) {} });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    await page.click('#ss-start');
    await page.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(500);
    await page.evaluate(() => { window.GAME.paused = true; });   // isolate the camera from the sim
    page.__errs = errs;
    return page;
  }
  const cam = p => p.evaluate(() => ({ x: Math.round(window.GAME.camera.x), y: Math.round(window.GAME.camera.y) }));
  const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // A one-finger drag, expressed as real touch events.
  async function oneFinger(page, from, to, steps) {
    await page.evaluate(async ([f, t, n]) => {
      const cv = document.getElementById('screen');
      const mk = (type, pts) => {
        const touches = pts.map((p, i) => new Touch({
          identifier: i + 1, target: cv, clientX: p.x, clientY: p.y,
          radiusX: 8, radiusY: 8, force: 1,
        }));
        cv.dispatchEvent(new TouchEvent(type, {
          bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: touches,
        }));
      };
      const pd = (type, p, id) => cv.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        isPrimary: id === 1, clientX: p.x, clientY: p.y, button: 0, buttons: 1,
      }));
      pd('pointerdown', f, 1); mk('touchstart', [f]);
      for (let i = 1; i <= n; i++) {
        const p = { x: f.x + (t.x - f.x) * i / n, y: f.y + (t.y - f.y) * i / n };
        pd('pointermove', p, 1); mk('touchmove', [p]);
        await new Promise(r => setTimeout(r, 16));
      }
      pd('pointerup', t, 1); mk('touchend', [t]);
    }, [from, to, steps || 12]);
  }
  // Two fingers moving together.
  async function twoFingers(page, from, to, steps) {
    await page.evaluate(async ([f, t, n]) => {
      const cv = document.getElementById('screen');
      const pd = (type, p, id) => cv.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        isPrimary: id === 1, clientX: p.x, clientY: p.y, button: 0, buttons: 1,
      }));
      const off = { x: 90, y: 40 };
      pd('pointerdown', f, 1);
      pd('pointerdown', { x: f.x + off.x, y: f.y + off.y }, 2);
      for (let i = 1; i <= n; i++) {
        const p = { x: f.x + (t.x - f.x) * i / n, y: f.y + (t.y - f.y) * i / n };
        pd('pointermove', p, 1);
        pd('pointermove', { x: p.x + off.x, y: p.y + off.y }, 2);
        await new Promise(r => setTimeout(r, 16));
      }
      pd('pointerup', t, 1);
      pd('pointerup', { x: t.x + off.x, y: t.y + off.y }, 2);
    }, [from, to, steps || 12]);
  }

  // ── 1. one finger must not move the map ─────────────────────────────────
  console.log('=== one finger ===');
  {
    const p = await tabletPage();
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    const before = await cam(p);
    await oneFinger(p, { x: 400, y: 300 }, { x: 780, y: 560 });
    await sleep(300);
    const after = await cam(p);
    ok(moved(before, after) < 2, 'a one-finger drag moved the camera by ' + Math.round(moved(before, after)) + 'px');
    console.log('  drag across the map: camera ' + before.x + ',' + before.y + ' → ' + after.x + ',' + after.y + ' ✓');

    // and it must have drawn a selection box instead
    ok(await p.evaluate(() => RC.Input.getScheme() === 'box'), 'the touch scheme is not box-select');
    console.log('  one finger draws a selection box, never pans ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. the killer: a finger near the edge must not start edge-scroll ────
  console.log('\n=== edge-scroll must not arm from touch ===');
  {
    const p = await tabletPage();
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    // drag right into the left edge zone and lift — the old build kept scrolling
    await oneFinger(p, { x: 400, y: 300 }, { x: 6, y: 300 });
    const atLift = await cam(p);
    await p.evaluate(() => { window.GAME.paused = false; });   // let the camera update run
    await sleep(1200);                                          // ...for over a second
    const later = await cam(p);
    ok(moved(atLift, later) < 2,
       'the camera kept sliding after the finger lifted (' + Math.round(moved(atLift, later)) + 'px in 1.2s)');
    ok((await p.evaluate(() => RC.Input.state.mouseInside)) === false,
       'a touch left edge-scroll armed (mouseInside is true)');
    console.log('  finger lifted at the left edge → camera still ' + later.x + ',' + later.y + ' after 1.2s ✓');

    // tapping near every edge in turn must also leave it alone
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    const start = await cam(p);
    for (const pt of [{ x: 4, y: 300 }, { x: 1020, y: 300 }, { x: 500, y: 4 }, { x: 500, y: 560 }]) {
      await oneFinger(p, pt, pt, 2);
      await sleep(250);
    }
    const end = await cam(p);
    ok(moved(start, end) < 3, 'tapping the screen edges drifted the camera ' + Math.round(moved(start, end)) + 'px');
    console.log('  taps at all four edges: no drift ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2b. the synthetic mouse event a tablet fires after every touch ──────
  // iOS/iPadOS emits mousemove/mousedown after a touch for old-page compatibility.
  // Playwright's dispatched PointerEvents do NOT produce those, so the only honest
  // way to test this is to fire the synthetic event ourselves, exactly as Safari
  // would, and check it cannot arm edge-scroll.
  console.log('\n=== synthetic mouse events from a touch ===');
  {
    const p = await tabletPage();
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    await p.evaluate(() => {
      const cv = document.getElementById('screen');
      const r = cv.getBoundingClientRect();
      // a finger lands mid-screen...
      cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1,
        pointerType: 'touch', isPrimary: true, clientX: r.left + 400, clientY: r.top + 300 }));
      cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1,
        pointerType: 'touch', isPrimary: true, clientX: r.left + 8, clientY: r.top + 300 }));
      // ...and Safari then synthesises a mouse event at the lift point, near the edge
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true,
        clientX: r.left + 8, clientY: r.top + 300 }));
    });
    const armed = await p.evaluate(() => RC.Input.state.mouseInside);
    ok(armed === false, 'a synthetic mouse event from a touch armed edge-scroll');
    await p.evaluate(() => { window.GAME.paused = false; });
    const before = await cam(p);
    await sleep(1200);
    const after = await cam(p);
    ok(moved(before, after) < 2,
       'the synthetic mouse event scrolled the map ' + Math.round(moved(before, after)) + 'px in 1.2s');
    console.log('  synthetic mousemove after a touch: ignored, camera still ' + after.x + ',' + after.y + ' ✓');
    await p.context().close();
  }

  // ── 2c. a stored one-finger-pan preference must not survive ─────────────
  // The old build had a ⬚/✋ button that switched to a legacy scheme where ONE
  // finger panned, and remembered it. A player who tapped it once had a map that
  // slid whenever they tried to select.
  console.log('\n=== a stored legacy pan preference ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('riftclash_name', 'Jayden'); localStorage.setItem('rc_touch_scheme', 'pan'); } catch (e) {}
    });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(400);
    await p.evaluate(() => { window.GAME.paused = true; window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    ok((await p.evaluate(() => RC.Input.getScheme())) === 'box', 'a stored "pan" preference is still in force');
    ok((await p.evaluate(() => localStorage.getItem('rc_touch_scheme'))) === null, 'the stale preference was left in storage');
    const before = await cam(p);
    await oneFinger(p, { x: 400, y: 300 }, { x: 780, y: 560 });
    await sleep(250);
    const after = await cam(p);
    ok(moved(before, after) < 2, 'one finger still pans for a player who had the legacy scheme saved (' +
       Math.round(moved(before, after)) + 'px)');
    console.log('  legacy "one finger pans" preference ignored and wiped ✓');
    await ctx.close();
  }

  // ── 3. two fingers DO move the map ──────────────────────────────────────
  console.log('\n=== two fingers ===');
  {
    const p = await tabletPage();
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    const before = await cam(p);
    await twoFingers(p, { x: 600, y: 400 }, { x: 300, y: 250 });
    await sleep(200);
    const after = await cam(p);
    ok(moved(before, after) > 150, 'a two-finger drag barely moved the camera (' + Math.round(moved(before, after)) + 'px)');
    // dragging the fingers left/up should push the camera right/down
    ok(after.x > before.x && after.y > before.y, 'the two-finger pan went the wrong way');
    console.log('  two fingers dragged 300,150 → camera moved ' + Math.round(moved(before, after)) + 'px the right way ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 4. the minimap is still a legitimate one-finger way to travel ───────
  console.log('\n=== minimap scrub ===');
  {
    const p = await tabletPage();
    await p.evaluate(() => { window.GAME.camera.x = 100; window.GAME.camera.y = 100; });
    const before = await cam(p);
    const box = await p.evaluate(() => {
      const r = document.getElementById('minimap').getBoundingClientRect();
      return { x: r.left + r.width * 0.8, y: r.top + r.height * 0.8 };
    });
    await p.evaluate(pt => {
      const m = document.getElementById('minimap');
      m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: pt.x, clientY: pt.y }));
      m.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, pointerType: 'touch', clientX: pt.x, clientY: pt.y }));
    }, box);
    await sleep(200);
    const after = await cam(p);
    ok(moved(before, after) > 200, 'the minimap no longer jumps the camera (' + Math.round(moved(before, after)) + 'px)');
    console.log('  minimap tap still travels ' + Math.round(moved(before, after)) + 'px ✓');
    await p.context().close();
  }

  // ── 5. a real mouse still gets edge-scroll ──────────────────────────────
  console.log('\n=== desktop is untouched ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Jayden'); } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(400);
    await p.evaluate(() => { window.GAME.camera.x = 600; window.GAME.camera.y = 500; });
    const before = await cam(p);
    const stage = await p.evaluate(() => {
      const r = document.getElementById('screen').getBoundingClientRect();
      return { x: r.left + 5, y: r.top + r.height / 2 };
    });
    await p.mouse.move(stage.x, stage.y);
    await sleep(700);
    const after = await cam(p);
    ok(before.x - after.x > 30, 'edge-scroll stopped working for a real mouse (' + (before.x - after.x) + 'px)');
    console.log('  mouse parked at the left edge scrolled ' + (before.x - after.x) + 'px ✓');
    await ctx.close();
  }

  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
