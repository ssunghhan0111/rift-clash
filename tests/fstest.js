// Fullscreen: on by default from the first gesture, toggled by a button, and an
// explicit exit is remembered so the page never grabs the screen back uninvited.
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
const { chromium } = requirePlaywright();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8900 + (process.pid % 90);
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
  async function newPage(pre) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Jayden'); } catch (e) {} });
    if (pre) await ctx.addInitScript(pre);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.Fullscreen, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }
  const vis = (p, sel) => p.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);
  const st = p => p.evaluate(() => RC.Fullscreen.status());

  // ── 1. the toggle exists in both places ─────────────────────────────────
  console.log('=== the button ===');
  {
    const p = await newPage();
    ok(await vis(p, '#fs-btn2'), 'the start screen has no fullscreen button');
    const s0 = await st(p);
    ok(s0.supported === true, 'this browser reports no Fullscreen API');
    ok(s0.on === false, 'the page claims to be fullscreen before anything happened');
    ok(s0.wanted === true, 'fullscreen is not the default preference');
    const label = await p.textContent('#fs-btn2');
    ok(/fullscreen/i.test(label), 'the button label is odd: ' + label);
    console.log('  start screen offers "' + label.trim() + '", default preference is ON ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. clicking it enters, clicking it again leaves ─────────────────────
  console.log('\n=== toggling ===');
  {
    const p = await newPage();
    await p.click('#fs-btn2');
    await sleep(500);
    const onNow = await st(p);
    ok(onNow.on === true, 'the button did not enter fullscreen');
    const label = await p.textContent('#fs-btn2');
    ok(/leave/i.test(label), 'the button still says "Fullscreen" while fullscreen: ' + label);
    const cls = await p.evaluate(() => document.getElementById('fs-btn2').classList.contains('on'));
    ok(cls, 'the button is not highlighted while fullscreen');
    console.log('  click 1 → fullscreen, button reads "' + label.trim() + '" ✓');

    await p.click('#fs-btn2');
    await sleep(500);
    const offNow = await st(p);
    ok(offNow.on === false, 'the button did not leave fullscreen');
    ok((await p.textContent('#fs-btn2')).match(/^⛶ Fullscreen/), 'the label did not reset');
    console.log('  click 2 → back to a window ✓');

    // and an explicit exit must be remembered
    ok(offNow.wanted === false, 'leaving via the button did not turn the default off');
    ok((await p.evaluate(() => localStorage.getItem('rc_fullscreen'))) === '0', 'the opt-out was not saved');
    console.log('  the opt-out is remembered — the page will not grab the screen back ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 3. default on: the first gesture arms it ────────────────────────────
  console.log('\n=== fullscreen by default ===');
  {
    const p = await newPage();
    ok((await st(p)).on === false, 'fullscreen somehow applied before any gesture');
    // any tap counts — here, starting a match
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(600);
    ok((await st(p)).on === true, 'the first gesture did not put the game in fullscreen');
    ok(await vis(p, '#fs-btn'), 'the in-match top bar has no fullscreen button');
    ok(await p.evaluate(() => document.getElementById('fs-btn').classList.contains('on')),
       'the in-match button does not show the fullscreen state');
    console.log('  first interaction → fullscreen, top-bar button lit ✓');

    // and it must SURVIVE going back to the menu (it used to drop out)
    await p.evaluate(() => RC.openMenu());
    await sleep(600);
    ok((await st(p)).on === true, 'returning to the menu dropped out of fullscreen');
    console.log('  still fullscreen after quitting to the menu ✓');
    await p.context().close();
  }

  // ── 4. someone who opted out is left alone ──────────────────────────────
  console.log('\n=== a player who opted out ===');
  {
    const p = await newPage(() => { try { localStorage.setItem('rc_fullscreen', '0'); } catch (e) {} });
    ok((await st(p)).wanted === false, 'the stored opt-out was ignored');
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(600);
    ok((await st(p)).on === false, 'the game forced fullscreen on a player who had opted out');
    console.log('  starting a match does NOT force fullscreen on them ✓');

    // ...but the button still works, and re-arms the default
    await p.click('#fs-btn');
    await sleep(500);
    ok((await st(p)).on === true, 'the button did not work for an opted-out player');
    ok((await st(p)).wanted === true, 'using the button did not re-enable the default');
    console.log('  pressing the button opts them back in ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 5. Esc / F11 out is treated as an opt-out, not a glitch ─────────────
  console.log('\n=== leaving with Esc ===');
  {
    const p = await newPage();
    await p.click('#fs-btn2');
    await sleep(500);
    ok((await st(p)).on === true, 'setup: expected fullscreen');
    // the browser can drop fullscreen without going through our button
    await p.evaluate(() => document.exitFullscreen());
    await sleep(500);
    const after = await st(p);
    ok(after.on === false, 'the browser-side exit did not take');
    ok(after.wanted === false, 'an Esc-style exit was not remembered — the next click would grab the screen back');
    ok(!(await p.evaluate(() => document.getElementById('fs-btn2').classList.contains('on'))),
       'the button still shows fullscreen after the browser left it');
    console.log('  Esc-style exit is remembered and the button updates itself ✓');
    await p.context().close();
  }

  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
