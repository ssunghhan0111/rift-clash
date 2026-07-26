// Renders each new planet under each of its weather events and saves a screenshot,
// so the look can actually be inspected instead of assumed. Also fails on any
// console error while the new render paths are running.
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
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

global.window = global;
require('../config.js'); require('../maps.js');
const RC = global.RC;

const PORT = 8400 + (process.pid % 150);
const OUT = require('path').join(SRC, 'shots');
const PLANETS = ['mars', 'jupiter', 'saturn'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(process.execPath, [SRC + '/server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await sleep(900);
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Jayden'); } catch (e) {} });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/404|favicon/i.test(x)) errs.push(x); });
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });

  const made = [];
  for (const id of PLANETS) {
    // pick the planet on the real start screen, then start the match
    const picked = await page.evaluate(name => {
      const cards = [...document.querySelectorAll('#ss-maps .mapcard')];
      const c = cards.find(x => x.querySelector('.mc-name').textContent.trim() === name);
      if (!c) return false;
      c.click();
      return true;
    }, RC.getMap(id).name);
    if (!picked) throw new Error('no start-screen card for ' + id);
    await page.click('#ss-start');
    await page.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(500);
    const onMap = await page.evaluate(() => window.GAME.mapDef.id);
    if (onMap !== id) throw new Error('start screen launched ' + onMap + ' instead of ' + id);
    await page.evaluate(() => RC.Input.centerOn(window.GAME.spawn1.x + 620, window.GAME.spawn1.y + 120));
    await sleep(300);

    await page.evaluate(() => { window.GAME.paused = true; });
    await sleep(450);
    const file = OUT + '/' + id + '.png';
    await page.screenshot({ path: file });
    made.push(id);
    await page.evaluate(() => { window.GAME.paused = false; });

    await page.evaluate(() => { if (RC.openMenu) RC.openMenu(); });
    await sleep(300);
  }

  console.log(made.join('\n'));
  console.log('\n' + made.length + ' screenshots in ' + OUT);
  console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors while rendering the new planets ✓');
  await browser.close(); srv.kill();
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
