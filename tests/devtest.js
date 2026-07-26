// Dev mode must be OFF by default and reachable only by five taps on the studio
// credit followed by the passcode. Driven by clicking the real page in Chromium.
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
// Playwright is a dev-only dependency and is not vendored into the repo.
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
const PORT = 8600 + (process.pid % 150);
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Jayden'); } catch (e) {} });
    if (pre) await ctx.addInitScript(pre);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.Dev, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }
  const vis = (p, sel) => p.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);
  const tapCredit = (p, n) => p.evaluate(count => {
    const c = document.getElementById('ss-credit');
    for (let i = 0; i < count; i++) c.click();
  }, n);

  // ── 1. a fresh player gets no dev mode ──────────────────────────────────
  console.log('=== off by default ===');
  {
    const p = await newPage();
    ok((await p.evaluate(() => RC.Dev.enabled)) === false, 'dev mode was already on for a fresh player');
    ok(!(await p.evaluate(() => !!document.getElementById('dev-panel'))) ||
       !(await vis(p, '#dev-panel')), 'the dev panel is on screen for a fresh player');
    ok(!(await vis(p, '#dev-gate')), 'the passcode prompt is showing unprompted');
    // cheats must not be applied
    await p.click('#ss-start');
    await p.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(600);
    const shards = await p.evaluate(() => Math.floor(window.GAME.res[window.GAME.playerOwner].shard));
    ok(shards < 5000, 'a fresh player started with cheat money (' + shards + ' shards)');
    console.log('  fresh player: dev off, no panel, ' + shards + ' shards (not 999999) ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. the old remembered unlock must not resurrect it ──────────────────
  console.log('\n=== a previously unlocked machine ===');
  {
    const p = await newPage(() => { try { localStorage.setItem('riftclash_devmode', '1'); } catch (e) {} });
    ok((await p.evaluate(() => RC.Dev.enabled)) === false,
       'the old localStorage unlock switched dev mode straight back on');
    const left = await p.evaluate(() => localStorage.getItem('riftclash_devmode'));
    ok(left === null, 'the stale unlock flag was left in storage (' + left + ')');
    console.log('  legacy "riftclash_devmode=1" is ignored and wiped ✓');
    await p.context().close();
  }

  // ── 3. the backtick key gives nothing away while locked ─────────────────
  console.log('\n=== the ` key while locked ===');
  {
    const p = await newPage();
    for (let i = 0; i < 3; i++) { await p.keyboard.press('`'); await sleep(80); }
    ok((await p.evaluate(() => RC.Dev.enabled)) === false, 'the ` key enabled dev mode');
    ok(!(await vis(p, '#dev-gate')), 'the ` key revealed the passcode prompt while locked');
    ok(!(await vis(p, '#dev-panel')), 'the ` key opened the panel while locked');
    console.log('  ` does nothing at all — dev mode stays invisible ✓');
    await p.context().close();
  }

  // ── 4. five taps on the credit opens the passcode gate ──────────────────
  console.log('\n=== five taps on the studio credit ===');
  {
    const p = await newPage();
    const credit = await p.textContent('#ss-credit');
    ok(/Jayden/i.test(credit), 'the studio credit is not where the gate is bound (' + credit + ')');

    await tapCredit(p, 4);
    await sleep(150);
    ok(!(await vis(p, '#dev-gate')), 'four taps already opened the gate');
    console.log('  4 taps: nothing ✓');

    await tapCredit(p, 1);
    await sleep(250);
    ok(await vis(p, '#dev-gate'), 'five taps did not open the passcode prompt');
    ok((await p.evaluate(() => RC.Dev.enabled)) === false, 'five taps enabled dev mode without a passcode');
    console.log('  5th tap: passcode prompt, still locked ✓');

    // a wrong code is refused and counted
    await p.fill('#dev-code', 'definitely-not-it');
    await p.keyboard.press('Enter');
    await sleep(250);
    ok((await p.evaluate(() => RC.Dev.enabled)) === false, 'a wrong passcode unlocked dev mode');
    const msg = await p.evaluate(() => {
      const e = document.getElementById('dev-code-msg');
      return e ? e.textContent.trim() : '(no message element)';
    });
    ok(/wrong/i.test(msg), 'a wrong passcode gave no feedback ("' + msg + '")');
    ok(/\d+ left/.test(msg), 'the remaining-attempts counter is missing ("' + msg + '")');
    const bad = await p.evaluate(() => document.getElementById('dev-code-msg').classList.contains('bad'));
    ok(bad, 'the wrong-passcode message is not styled as an error');
    ok(await vis(p, '#dev-gate'), 'the gate closed after a wrong passcode');
    console.log('  wrong passcode refused: "' + msg + '" ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 5. an unlock lasts for this page load only ──────────────────────────
  console.log('\n=== the unlock is not remembered ===');
  {
    const p = await newPage();
    await p.evaluate(() => RC.Dev.enable(true));       // simulate a correct passcode
    await sleep(200);
    ok((await p.evaluate(() => RC.Dev.enabled)) === true, 'enable() did not unlock');
    ok(await vis(p, '#dev-panel'), 'unlocking did not show the panel');
    // ` now toggles the panel, since we are unlocked
    await p.keyboard.press('`');
    await sleep(200);
    ok(!(await vis(p, '#dev-panel')), 'the ` key did not hide the panel once unlocked');
    await p.keyboard.press('`');
    await sleep(200);
    ok(await vis(p, '#dev-panel'), 'the ` key did not bring the panel back');
    console.log('  once unlocked, ` toggles the panel ✓');

    const stored = await p.evaluate(() => localStorage.getItem('riftclash_devmode'));
    ok(stored === null, 'unlocking wrote a persistent flag (' + stored + ')');

    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => window.RC && window.RC.Dev, null, { timeout: 10000 });
    ok((await p.evaluate(() => RC.Dev.enabled)) === false, 'dev mode survived a reload');
    ok(!(await vis(p, '#dev-panel')), 'the dev panel survived a reload');
    console.log('  reload → locked again, nothing stored ✓');
    await p.context().close();
  }

  // ── 6. the passcode itself is still not in any served file ──────────────
  console.log('\n=== the code is not in the source ===');
  {
    const p = await newPage();
    const src = await p.evaluate(async () => (await fetch('dev.js')).text());
    ok(src.indexOf('CODE_HASH') > 0, 'dev.js was not served');
    ok(!/[?&]dev=/.test(src), 'the URL-parameter back door is still in the source');
    ok(src.indexOf('location.search') < 0, 'dev.js still reads the address bar');
    console.log('  no URL back door, only the hash ✓');
    await p.context().close();
  }

  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
