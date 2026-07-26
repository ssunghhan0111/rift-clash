// RIFT CLASH — the client half of reconnect, chat, and the voice policy.
// ---------------------------------------------------------------------------
// Real Chromium, real WebSockets, the real server. Playwright's setOffline() is
// used to yank the connection the way a wifi drop does, so the reconnect path is
// exercised end to end rather than simulated.
//
// Fails on the pre-change client:
//   · there is no #reconnect banner and no resume — a drop was permanent
//   · there is no chat at all
//   · voice auto-joined with a live mic in PUBLIC rooms
//   · keys typed into a text field were also fed to the game as hotkeys
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
const PORT = 8300 + (process.pid % 120);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvErr = ''; srv.stderr.on('data', d => { srvErr += d.toString(); });
  await sleep(900);

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-gpu',
           '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
           '--autoplay-policy=no-user-gesture-required'],
  });

  const contexts = [];
  async function newPage(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    contexts.push(ctx);
    await ctx.addInitScript(n => { try { localStorage.setItem('riftclash_name', n); } catch (e) {} }, name);
    // Playwright's setOffline() does not tear down an ALREADY-ESTABLISHED WebSocket in
    // this Chromium, so the first version of this test proved nothing — the socket
    // never dropped and every reconnect assertion passed vacuously. Instead, keep a
    // handle on the sockets the page opens and close one abruptly. That is the same
    // onclose the client sees when a phone loses signal.
    await ctx.addInitScript(() => {
      const Orig = window.WebSocket;
      window.__sockets = [];
      const Wrapped = function (url, protocols) {
        const s = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
        window.__sockets.push(s);
        return s;
      };
      Wrapped.prototype = Orig.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { Wrapped[k] = Orig[k]; });
      window.WebSocket = Wrapped;
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { const x = m.text(); if (m.type() === 'error' && !/404|favicon/i.test(x)) errs.push(x); });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    page.__ctx = ctx; page.__errs = errs;
    return page;
  }
  const vis = (p, sel) => p.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);
  // Wait for a predicate inside the page, returning false on timeout instead of throwing.
  async function until(p, fn, ms, arg) {
    try { await p.waitForFunction(fn, arg, { timeout: ms || 8000 }); return true; }
    catch (e) { return false; }
  }

  // Create a room of the given kind and get a second player into it.
  async function makeRoom(host, guest, isPublic) {
    await host.click('#ss-online');
    await host.waitForSelector('#browser:not(.hidden)', { timeout: 8000 });
    await host.click(isPublic ? '#create-public' : '#create-private');
    await host.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
    const code = await host.evaluate(() =>
      (document.getElementById('lobby-code').textContent.match(/[A-Z0-9]{4}/) || [''])[0]);
    if (!guest) return code;
    await guest.click('#ss-online');
    await guest.waitForSelector('#browser:not(.hidden)', { timeout: 8000 });
    await guest.fill('#join-code', code);
    await guest.click('#join-code-btn');
    await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 8000 });
    return code;
  }

  try {
    // ══ 1. Voice policy ═══════════════════════════════════════════════════
    console.log('\n=== voice does not go live by itself in a public game ===');
    {
      const a = await newPage('Pubby');
      await makeRoom(a, null, true);
      await sleep(1200);
      const st = await a.evaluate(() => RC.Voice.status());
      ok(st.joined === false, 'voice auto-joined in a PUBLIC room (mic went live uninvited)');
      ok(await vis(a, '#voice-join'), 'the Join Voice button is not offered in a public room');
      const note = await a.evaluate(() => document.getElementById('voice-note').textContent);
      ok(/public/i.test(note), 'the public-room note does not explain why voice is off: ' + note);

      // pressing the button still works — the feature is off by default, not removed
      await a.click('#voice-join');
      ok(await until(a, () => RC.Voice.status().joined, 8000), 'Join Voice did not start the call in a public room');
      console.log('  public room: mic stays off until asked, then joins on request ✓');
      await a.__ctx.close();
    }

    console.log('\n=== voice still comes up by itself in a private game ===');
    {
      const a = await newPage('Privvy');
      await makeRoom(a, null, false);
      ok(await until(a, () => RC.Voice.status().joined, 9000),
         'voice did NOT auto-join in a private room (that behaviour was meant to be kept)');
      console.log('  private room: auto-join preserved ✓');
      await a.__ctx.close();
    }

    console.log('\n=== the host can turn voice off for everyone ===');
    {
      const host = await newPage('Hosty');
      const guest = await newPage('Guesty');
      await makeRoom(host, guest, false);
      await sleep(900);
      ok(await vis(host, '#voice-room'), 'the host has no room-voice switch');
      ok(!(await vis(guest, '#voice-room')), 'a guest was offered the host-only room-voice switch');
      await host.click('#voice-room');
      ok(await until(guest, () => !RC.Voice.status().joined, 6000),
         'the guest stayed on the call after the host disabled voice');
      const gnote = await guest.evaluate(() => document.getElementById('voice-note').textContent);
      ok(/host/i.test(gnote), 'the guest is not told why voice stopped: ' + gnote);
      console.log('  host switch hangs everyone up ✓');
      await host.__ctx.close(); await guest.__ctx.close();
    }

    // ══ 2. Text chat ══════════════════════════════════════════════════════
    console.log('\n=== text chat ===');
    {
      const a = await newPage('Alice');
      const b = await newPage('Bob');
      await makeRoom(a, b, false);
      await sleep(600);

      await a.fill('#chat-input', 'good luck');
      await a.click('#chat-send');
      ok(await until(b, () => /good luck/.test(document.getElementById('chat-log').textContent), 5000),
         'a lobby chat message never reached the other player');
      ok(await until(a, () => /good luck/.test(document.getElementById('chat-log').textContent), 3000),
         'the sender does not see their own message');

      // …and it survives into the match
      await a.click('#lobby-start');
      await a.waitForFunction(() => window.GAME && window.GAME.units.length > 0, null, { timeout: 15000 });
      await b.waitForFunction(() => window.GAME && window.GAME.units.length > 0, null, { timeout: 15000 });

      ok(await vis(a, '#tb-chat'), 'the in-match chat button is missing');
      ok(!(await vis(a, '#gamechat')), 'the in-match chat box starts open (it should start closed)');
      await a.keyboard.press('Enter');
      ok(await vis(a, '#gamechat'), 'Enter did not open the in-match chat box');

      await a.fill('#gc-input', 'attacking now');
      await a.keyboard.press('Enter');
      ok(await until(b, () => /attacking now/.test(document.getElementById('gc-log').textContent), 5000),
         'an in-match chat message never reached the other player');

      // ── the typing guard ──
      // Every letter used to be a game hotkey as well: typing "pause" into a chat
      // box pressed P (pause), A (attack-move), U, S, E. This is the check.
      await a.evaluate(() => { RC.Input.state.keys = {}; });
      await a.click('#gc-input');
      await a.type('#gc-input', 'apes', { delay: 20 });
      const held = await a.evaluate(() => Object.keys(RC.Input.state.keys).filter(k => RC.Input.state.keys[k]));
      ok(held.length === 0, 'typing in the chat box still reaches the game as hotkeys: ' + JSON.stringify(held));
      const armed = await a.evaluate(() => !!(window.GAME && window.GAME.paused));
      ok(!armed, 'typing in the chat box paused the game');

      await a.keyboard.press('Escape');
      ok(!(await vis(a, '#gamechat')), 'Escape did not close the in-match chat box');
      console.log('  lobby + in-match chat deliver, and typing is no longer a hotkey ✓');
      await a.__ctx.close(); await b.__ctx.close();
    }

    // ══ 3. Reconnect ══════════════════════════════════════════════════════
    console.log('\n=== a dropped player gets back into the match ===');
    {
      const host = await newPage('Keeper');
      const guest = await newPage('Dropper');
      await makeRoom(host, guest, false);
      await sleep(500);
      await host.click('#lobby-start');
      await guest.waitForFunction(() => window.GAME && window.GAME.units.length > 0, null, { timeout: 15000 });

      const owner0 = await guest.evaluate(() => window.GAME.playerOwner);
      const stored = await guest.evaluate(() => sessionStorage.getItem('rc_resume'));
      ok(!!stored && /token/.test(stored), 'no resume token was stored at match start');

      // Watch the banner rather than polling for it: on a healthy server the whole
      // drop-and-resume cycle can finish inside a second, and a poll can walk straight
      // past it. The observer records that it was shown, and in which state.
      await guest.evaluate(() => {
        const box = document.getElementById('reconnect');
        window.__rcShown = false; window.__rcSpinning = false;
        const check = () => {
          if (box.classList.contains('hidden')) return;
          window.__rcShown = true;
          if (!document.getElementById('rc-spin').classList.contains('hidden') &&
              document.getElementById('rc-back').classList.contains('hidden')) window.__rcSpinning = true;
        };
        new MutationObserver(check).observe(box, { attributes: true, attributeFilter: ['class'] });
        check();
      });

      // Yank the connection.
      await guest.evaluate(() => {
        const s = window.__sockets[window.__sockets.length - 1];
        if (s) s.close();
      });

      ok(await until(guest, () => window.__rcShown === true, 12000),
         'the reconnect banner never appeared after the connection dropped');
      ok(await guest.evaluate(() => window.__rcSpinning === true),
         'the banner showed a failed state instead of retrying');

      // The host is told the seat is being held rather than gone.
      ok(await until(host, () => (window.GAME.log || []).some(l => /held/i.test(l.msg)), 8000),
         'the remaining player was never told the seat is being held');

      // The client retries by itself; nothing to put back.
      ok(await until(guest, () => {
        const e = document.getElementById('reconnect');
        return e && e.classList.contains('hidden') && window.RC.online === true;
      }, 25000), 'the client never reconnected by itself');

      const owner1 = await guest.evaluate(() => window.GAME.playerOwner);
      ok(owner1 === owner0, 'came back into a DIFFERENT seat (' + owner0 + ' → ' + owner1 + ')');
      ok(await guest.evaluate(() => RC.online === true), 'the client did not go back online');

      // Snapshots really are flowing again: game time advances.
      const t0 = await guest.evaluate(() => window.GAME.time);
      await sleep(1200);
      const t1 = await guest.evaluate(() => window.GAME.time);
      ok(t1 > t0, 'the match is not ticking on the reconnected client (' + t0 + ' → ' + t1 + ')');
      ok(await guest.evaluate(() => window.GAME.units.length > 0), 'the reconnected client has no units');

      // And it can still give orders — the seat is really back, not just visually.
      const moved = await guest.evaluate(() => {
        const g = window.GAME;
        const mine = g.units.filter(u => u.owner === g.playerOwner && !u.def.worker);
        const u = mine[0] || g.units.find(x => x.owner === g.playerOwner);
        if (!u) return null;
        RC.cmd(g, { t: 'move', ids: [u.id], x: u.x + 220, y: u.y });
        return { id: u.id, x: u.x };
      });
      ok(!!moved, 'the reconnected client owns no units to command');
      if (moved) {
        const shifted = await until(guest, (m) => {
          const u = window.GAME.units.find(x => x.id === m.id);
          return !!u && Math.abs(u.x - m.x) > 25;
        }, 8000, moved);
        ok(shifted, 'an order from the reconnected client was ignored by the server');
      }

      ok(await until(host, () => (window.GAME.log || []).some(l => /is back/i.test(l.msg)), 6000),
         'the remaining player was never told they came back');

      console.log('  drop → banner → auto-reconnect → same seat, still commandable ✓');
      await host.__ctx.close(); await guest.__ctx.close();
    }

    // ══ 4. Resume after a page reload ═════════════════════════════════════
    console.log('\n=== a refresh mid-match rejoins instead of losing the seat ===');
    {
      const host = await newPage('Steady');
      const guest = await newPage('Reloader');
      await makeRoom(host, guest, false);
      await sleep(500);
      await host.click('#lobby-start');
      await guest.waitForFunction(() => window.GAME && window.GAME.units.length > 0, null, { timeout: 15000 });
      const owner0 = await guest.evaluate(() => window.GAME.playerOwner);

      await guest.reload({ waitUntil: 'load' });
      await guest.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });

      const backIn = await until(guest, () => window.RC.online === true && window.GAME && window.GAME.units.length > 0, 20000);
      ok(backIn, 'a refresh did not rejoin the match');
      if (backIn) {
        const owner1 = await guest.evaluate(() => window.GAME.playerOwner);
        ok(owner1 === owner0, 'the refresh landed in a different seat (' + owner0 + ' → ' + owner1 + ')');
        ok(!(await vis(guest, '#startscreen')), 'the start screen is showing over the resumed match');
      }
      console.log('  reload → same seat ✓');
      await host.__ctx.close(); await guest.__ctx.close();
    }

    // ══ 5. A stale token fails politely ═══════════════════════════════════
    console.log('\n=== a stale resume token does not strand the player ===');
    {
      const p = await newPage('Ghost');
      await p.evaluate(() => sessionStorage.setItem('rc_resume',
        JSON.stringify({ roomId: 999999, token: 'nope', at: Date.now() })));
      await p.reload({ waitUntil: 'load' });
      await p.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
      ok(await until(p, () => {
        const b = document.getElementById('rc-back');
        return b && !b.classList.contains('hidden');
      }, 15000), 'a dead resume token left the player with no way out');
      await p.click('#rc-back');
      ok(await until(p, () => {
        const ss = document.getElementById('startscreen');
        return ss && !ss.classList.contains('hidden');
      }, 6000), 'the Back to menu button did not return to the menu');
      ok(await p.evaluate(() => !sessionStorage.getItem('rc_resume')), 'the dead token was not cleared');
      console.log('  dead token → clear message → back to the menu ✓');
      await p.__ctx.close();
    }

  } catch (e) {
    fail++;
    console.log('\nHARNESS ERROR: ' + (e && e.stack || e));
  }

  await browser.close();
  srv.kill();
  if (srvErr.trim()) console.log('server stderr:\n' + srvErr.trim());
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
