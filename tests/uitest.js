// Browser test: pause/play toggle, the ⏹ end-match dialog, the first-launch
// nickname prompt, and the online player list + invite popup — all driven by
// clicking the real DOM in a real Chromium against the real server.
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

global.window = global;
require('../config.js'); require('../maps.js');
const RC_MODE_2V2 = global.RC.MODES['2v2'].name;    // compare against the real label

const PORT = 8300 + (process.pid % 200);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    cwd: SRC, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvErr = '';
  srv.stderr.on('data', d => { srvErr += d.toString(); });
  await sleep(800);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  async function newPage(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon/i.test(t) && !/status of 404/.test(t)) errs.push(t); });
    if (name) await ctx.addInitScript(n => { try { localStorage.setItem('riftclash_name', n); } catch (e) {} }, name);
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }
  const vis = (page, sel) => page.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);

  // ── 1. nickname on first launch ────────────────────────────────────────
  console.log('=== nickname (first launch) ===');
  {
    const page = await newPage(null);              // no stored name
    ok(await vis(page, '#nickname'), 'first launch did not ask for a nickname');
    ok(!(await vis(page, '#startscreen')) || await vis(page, '#nickname'), 'nickname prompt is not covering the menu');

    await page.fill('#nick-input', 'J');
    await page.click('#nick-go');
    ok(await vis(page, '#nickname'), 'a one-character name was accepted');
    ok((await page.textContent('#nick-msg')).length > 0, 'no explanation was shown for the rejected name');

    await page.fill('#nick-input', 'Jayden');
    await page.click('#nick-go');
    await sleep(120);
    ok(!(await vis(page, '#nickname')), 'the nickname prompt did not close after a valid name');
    const stored = await page.evaluate(() => localStorage.getItem('riftclash_name'));
    ok(stored === 'Jayden', 'the name was not saved, got ' + stored);
    ok((await page.textContent('#who-name')) === 'Jayden', 'the start screen does not show the name');
    console.log('  rejected "J", accepted "Jayden", saved and shown ✓');

    // Enter key works too, and a returning player is never asked again
    const again = await newPage('Jayden');
    ok(!(await vis(again, '#nickname')), 'a returning player was asked for a name again');
    ok((await again.textContent('#who-name')) === 'Jayden', 'returning player name not shown');
    console.log('  returning player skips the prompt ✓');

    // "change" reopens it
    await again.click('#who-edit');
    ok(await vis(again, '#nickname'), 'the change button did not reopen the prompt');
    await again.fill('#nick-input', 'Renamed');
    await again.press('#nick-input', 'Enter');
    await sleep(120);
    ok((await again.evaluate(() => localStorage.getItem('riftclash_name'))) === 'Renamed', 'rename did not stick');
    console.log('  change → rename via Enter ✓');
    ok(page.__errs.length === 0, 'page errors: ' + page.__errs.join(' | '));
    await page.context().close(); await again.context().close();
  }

  // ── 2. pause ⇄ play toggle ─────────────────────────────────────────────
  console.log('\n=== pause / play toggle ===');
  {
    const page = await newPage('Jayden');
    await page.click('#ss-start');                       // straight into a 1v1 vs bot
    await page.waitForFunction(() => window.GAME && window.GAME.time >= 0 && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(300);

    const btn = async () => (await page.textContent('#tb-pause')).trim();
    ok(await btn() === '⏸', 'the button should start as pause, got ' + await btn());
    ok(!(await vis(page, '#paused-tag')), 'the PAUSED banner is showing before pausing');

    await page.click('#tb-pause');
    await sleep(150);
    ok(await page.evaluate(() => window.GAME.paused) === true, 'clicking pause did not pause the game');
    ok(await btn() === '▶', 'the button did not become a play button, got ' + await btn());
    ok(await vis(page, '#paused-tag'), 'no PAUSED banner while paused');
    ok((await page.getAttribute('#tb-pause', 'title')).indexOf('Resume') >= 0, 'the tooltip still says Pause while paused');

    // the clock really stops
    const t1 = await page.evaluate(() => window.GAME.time);
    await sleep(500);
    const t2 = await page.evaluate(() => window.GAME.time);
    ok(Math.abs(t2 - t1) < 0.05, 'the game kept running while paused (' + t1.toFixed(2) + ' → ' + t2.toFixed(2) + ')');

    await page.click('#tb-pause');
    await sleep(150);
    ok(await page.evaluate(() => window.GAME.paused) === false, 'clicking play did not resume');
    ok(await btn() === '⏸', 'the button did not go back to pause, got ' + await btn());
    ok(!(await vis(page, '#paused-tag')), 'the PAUSED banner stayed up after resuming');
    console.log('  ⏸ → ▶ → ⏸, banner and clock follow ✓');

    // the P key drives the same state
    await page.keyboard.press('p');
    await sleep(150);
    ok(await page.evaluate(() => window.GAME.paused) === true, 'the P key did not pause');
    ok(await btn() === '▶', 'the P key paused but the button did not change');
    await page.keyboard.press('p');
    await sleep(150);
    ok(await btn() === '⏸', 'the P key resumed but the button did not change back');
    console.log('  P key and the button stay in sync ✓');
    ok(page.__errs.length === 0, 'page errors: ' + page.__errs.join(' | '));
    await page.context().close();
  }

  // ── 3. ⏹ end-match dialog ──────────────────────────────────────────────
  console.log('\n=== ⏹ restart / quit dialog ===');
  {
    const page = await newPage('Jayden');
    await page.click('#ss-start');
    await page.waitForFunction(() => window.GAME && !document.getElementById('startscreen').offsetParent, null, { timeout: 8000 });
    await sleep(400);

    // the unit Stop button was removed; the game menu must be its own control
    ok(await page.evaluate(() => !document.getElementById('tb-stop')), 'the removed Stop button is back');
    ok(!(await vis(page, '#gamemenu')), 'the game menu is open before anything was pressed');

    // ⏹ opens the dialog and holds the game
    await page.click('#tb-gamemenu');
    await sleep(150);
    ok(await vis(page, '#gamemenu'), 'the ⏹ button did not open the dialog');
    ok(await page.evaluate(() => window.GAME.paused) === true, 'the dialog did not pause the match');
    for (const id of ['#gm-restart', '#gm-quit', '#gm-cancel']) ok(await vis(page, id), 'dialog is missing ' + id);
    console.log('  ⏹ → dialog with Restart / Quit / Keep Playing, match held ✓');

    // cancel resumes
    await page.click('#gm-cancel');
    await sleep(150);
    ok(!(await vis(page, '#gamemenu')), 'Keep Playing did not close the dialog');
    ok(await page.evaluate(() => window.GAME.paused) === false, 'Keep Playing left the game paused');
    console.log('  Keep Playing resumes ✓');

    // cancel must restore a pause the player set themselves
    await page.click('#tb-pause'); await sleep(100);
    await page.click('#tb-gamemenu'); await sleep(100);
    await page.click('#gm-cancel'); await sleep(150);
    ok(await page.evaluate(() => window.GAME.paused) === true, 'cancelling wiped out the pause the player had set');
    await page.click('#tb-pause'); await sleep(100);
    console.log('  cancelling restores the previous pause state ✓');

    // restart puts the match back to the beginning
    await page.evaluate(() => { window.GAME.time = 120; });
    await page.click('#tb-gamemenu'); await sleep(120);
    await page.click('#gm-restart'); await sleep(400);
    ok(await page.evaluate(() => window.GAME.time) < 5, 'Restart did not reset the match clock');
    ok(!(await vis(page, '#gamemenu')), 'Restart left the dialog open');
    ok(await page.evaluate(() => window.GAME.paused) === false, 'Restart left the game paused');
    ok(!(await vis(page, '#startscreen')), 'Restart kicked us out to the menu');
    console.log('  Restart resets the match and keeps playing ✓');

    // quit goes home
    await page.click('#tb-gamemenu'); await sleep(120);
    await page.click('#gm-quit'); await sleep(400);
    ok(await vis(page, '#startscreen'), 'Quit did not return to the menu');
    ok(!(await vis(page, '#gamemenu')), 'Quit left the dialog open');
    console.log('  Quit returns to the menu ✓');
    ok(page.__errs.length === 0, 'page errors: ' + page.__errs.join(' | '));
    await page.context().close();
  }

  // ── 4. who's online + invite, two real browsers ────────────────────────
  console.log('\n=== online players + invite (two browsers) ===');
  {
    const a = await newPage('Jayden');
    const b = await newPage('Mina');
    await a.click('#ss-online');
    await b.click('#ss-online');
    await a.waitForFunction(() => document.querySelectorAll('#online-list .prow').length > 0, null, { timeout: 8000 });
    await sleep(300);

    ok(await vis(a, '#browser'), 'Online did not open the browser screen');
    ok((await a.textContent('#browser-name')) === 'Jayden', 'the browser screen does not show my name');
    const rows = await a.$$('#online-list .prow');
    ok(rows.length === 1, 'A should see exactly one other player, saw ' + rows.length);
    ok((await a.textContent('#online-list .prow .pnm')) === 'Mina', "A does not see Mina's name");
    ok((await a.textContent('#online-count')).indexOf('2 online') >= 0, 'the online count is wrong: ' + await a.textContent('#online-count'));
    const btnLabels = await a.$$eval('#online-list .prow .pinv button', bs => bs.map(x => x.textContent.trim()));
    ok(btnLabels.length === 3, 'expected 3 invite buttons, got ' + btnLabels.length);
    ok(btnLabels.join(' ').indexOf('1v1') >= 0 && btnLabels.join(' ').indexOf('2v2') >= 0 && btnLabels.join(' ').indexOf('Survival') >= 0,
       'invite buttons are wrong: ' + btnLabels.join(', '));
    console.log('  A sees "Mina · In the menu" with ' + btnLabels.join(' / ') + ' ✓');

    // A invites Mina to 2v2
    await a.click('#online-list .prow .pinv button:nth-child(2)');
    await b.waitForFunction(() => { const p = document.getElementById('invite-pop'); return p && !p.classList.contains('hidden'); }, null, { timeout: 6000 });
    const txt = await b.textContent('#invite-text');
    ok(txt.indexOf('Jayden') >= 0 && txt.indexOf('2v2') >= 0, 'the invite popup text is wrong: ' + txt);
    console.log('  B sees: "' + txt.trim() + '" ✓');

    // decline first
    await b.click('#inv-decline');
    await sleep(400);
    ok(!(await vis(b, '#invite-pop')), 'declining did not dismiss the popup');
    ok((await a.textContent('#browser-status')).indexOf('declined') >= 0, 'A was not told about the decline: ' + await a.textContent('#browser-status'));
    console.log('  decline → "' + (await a.textContent('#browser-status')).trim() + '" ✓');

    // After inviting, the inviter is waiting in their own lobby — so the second
    // invite has to go out from the LOBBY, which is the path a 2v2 or a 4-player
    // co-op depends on.
    ok(await vis(a, '#lobby'), 'the inviter was not moved into their own lobby');
    await a.waitForFunction(() => document.querySelectorAll('#lobby-online .prow').length > 0, null, { timeout: 6000 });
    const lobBtns = await a.$$eval('#lobby-online .prow .pinv button', bs => bs.map(x => x.textContent.trim()));
    ok(lobBtns.length === 1, 'the lobby should offer one plain Invite button, got ' + lobBtns.length + ': ' + lobBtns.join(','));
    console.log('  inviter waits in the lobby and can invite more players from there ✓');

    await sleep(1700);                          // invite cooldown
    await a.click('#lobby-online .prow .pinv button');
    await b.waitForFunction(() => { const p = document.getElementById('invite-pop'); return p && !p.classList.contains('hidden'); }, null, { timeout: 6000 });
    await b.click('#inv-accept');
    await b.waitForFunction(() => { const l = document.getElementById('lobby'); return l && !l.classList.contains('hidden'); }, null, { timeout: 6000 });
    await sleep(400);
    ok(await vis(b, '#lobby'), 'accepting did not take B into the lobby');
    ok(await vis(a, '#lobby'), 'the inviter is not in the lobby');
    // a lobby invite must NOT rewrite the host's chosen game type
    const selMode = await a.evaluate(() => {
      const e = document.querySelector('#lobby-modes .modebtn.sel .mb-name');
      return e ? e.textContent.trim() : '(none selected)';
    });
    ok(selMode === RC_MODE_2V2, "the lobby invite changed the host's mode away from 2v2 (now: " + selMode + ')');
    const chips = await a.$$eval('#lobby-players .pchip .pn', ns => ns.map(n => n.textContent.replace('👑', '').trim()));
    ok(chips.length === 2, 'the lobby should hold 2 players, holds ' + chips.length + ': ' + chips.join(','));
    ok(chips.sort().join(',') === 'Jayden,Mina', 'lobby roster is wrong: ' + chips.join(','));
    console.log('  accept → shared lobby with ' + chips.join(' + ') + ' ✓');

    ok(a.__errs.length === 0, 'A page errors: ' + a.__errs.join(' | '));
    ok(b.__errs.length === 0, 'B page errors: ' + b.__errs.join(' | '));
    await a.context().close(); await b.context().close();
  }

  await browser.close();
  ok(!/Error|error:/i.test(srvErr), 'server logged errors:\n' + srvErr);
  srv.kill();

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
