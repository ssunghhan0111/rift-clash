// The growth loop: icons and social preview, the share card, and the invite link
// that drops a friend straight into a game. Driven against the real server.
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
const PORT = 8700 + (process.pid % 150);
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
  async function newPage(name, url) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    if (name) await ctx.addInitScript(n => { try { localStorage.setItem('riftclash_name', n); } catch (e) {} }, name);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url || BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }
  const vis = (p, sel) => p.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none';
  }, sel);

  // ── 1. every icon and the manifest are actually served ──────────────────
  console.log('=== icons, manifest, social preview ===');
  {
    const p = await newPage('Jayden');
    const assets = ['icon.svg', 'favicon-32.png', 'favicon-64.png', 'apple-touch-icon.png',
                    'icon-192.png', 'icon-512.png', 'og-image.png', 'manifest.webmanifest'];
    for (const a of assets) {
      const r = await p.evaluate(async u => {
        const res = await fetch(u);
        return { s: res.status, ct: res.headers.get('content-type') || '', n: (await res.blob()).size };
      }, a);
      ok(r.s === 200, a + ' is not served (HTTP ' + r.s + ')');
      ok(r.n > 200, a + ' is suspiciously small (' + r.n + ' bytes)');
      if (a.endsWith('.svg')) ok(/svg/.test(r.ct), a + ' served as ' + r.ct);
      if (a.endsWith('.png')) ok(/png/.test(r.ct), a + ' served as ' + r.ct);
      if (a.endsWith('.webmanifest')) ok(/manifest/.test(r.ct), a + ' served as ' + r.ct);
    }
    console.log('  all ' + assets.length + ' assets served with the right content-type ✓');

    // the head has to actually point at them
    const head = await p.evaluate(() => ({
      icon: !!document.querySelector('link[rel="icon"][type="image/svg+xml"]'),
      apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
      manifest: !!document.querySelector('link[rel="manifest"]'),
      theme: (document.querySelector('meta[name="theme-color"]') || {}).content,
      ogImg: (document.querySelector('meta[property="og:image"]') || {}).content,
      ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content,
      twCard: (document.querySelector('meta[name="twitter:card"]') || {}).content,
      title: document.title,
      standalone: !!document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    }));
    ok(head.icon && head.apple && head.manifest, 'the head is missing an icon/apple-touch-icon/manifest link');
    ok(head.theme === '#0b1017', 'no theme-color (' + head.theme + ')');
    ok(!!head.ogImg && !!head.ogTitle, 'Open Graph title/image missing — a pasted link will not unfurl');
    ok(head.twCard === 'summary_large_image', 'twitter card type is wrong (' + head.twCard + ')');
    ok(head.standalone, 'iOS home-screen standalone flag missing');
    ok(head.title.length > 'RIFT CLASH'.length, 'the page title is still bare');
    console.log('  head: icons ✓ manifest ✓ og:image ✓ "' + head.title + '"');

    // the manifest must be valid and its icons must resolve
    const man = await p.evaluate(async () => (await fetch('manifest.webmanifest')).json());
    ok(!!man.name && !!man.icons && man.icons.length >= 3, 'the manifest is incomplete');
    ok(man.display === 'fullscreen' || man.display === 'standalone', 'manifest display mode is ' + man.display);
    ok(man.icons.some(i => /512/.test(i.sizes) && i.purpose === 'maskable'), 'no maskable 512 icon — Android will letterbox it');
    for (const i of man.icons) {
      const s = await p.evaluate(async u => (await fetch(u)).status, i.src);
      ok(s === 200, 'manifest icon ' + i.src + ' 404s');
    }
    console.log('  manifest: ' + man.icons.length + ' icons, all resolve, display=' + man.display + ' ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 2. the share card draws something real ──────────────────────────────
  console.log('\n=== share card ===');
  {
    const p = await newPage('Jayden');
    const card = await p.evaluate(() => {
      const run = { title: 'Pluto — Crystal Gorge', wave: 23, kills: 412, score: 4360,
                    chip: '🟤 Dust Storm', race: 'Aether', rankLine: 'New personal best', name: 'Jayden' };
      const c = RC.Share.drawCard(run);
      const x = c.getContext('2d');
      const d = x.getImageData(0, 0, c.width, c.height).data;
      // how much of the card is not the background — a blank card would be ~0
      let lit = 0;
      for (let i = 0; i < d.length; i += 4 * 37) if (d[i] + d[i + 1] + d[i + 2] > 190) lit++;
      return { w: c.width, h: c.height, lit, total: Math.floor(d.length / (4 * 37)),
               text: RC.Share.textFor(run), url: RC.Share.siteUrl() };
    });
    ok(card.w === 1000 && card.h === 560, 'the card is the wrong size (' + card.w + 'x' + card.h + ')');
    ok(card.lit / card.total > 0.02, 'the card looks blank (' + (100 * card.lit / card.total).toFixed(1) + '% lit)');
    ok(/Wave 23/.test(card.text), 'the text version has no wave number');
    ok(/Dust Storm/.test(card.text), 'the text version lost the twist');
    ok(card.text.indexOf(card.url) > 0, 'the text version has no link back to the game');
    console.log('  1000x560, ' + (100 * card.lit / card.total).toFixed(0) + '% inked, text ends with ' + card.url + ' ✓');

    // it must appear on a finished Survival run
    await p.evaluate(() => {
      document.querySelectorAll('#ss-gamemodes .gmcard').forEach(c => { if (c.dataset.m === 'survival') c.click(); });
    });
    await p.click('#ss-survival');
    await p.waitForFunction(() => window.GAME && window.GAME.survival, null, { timeout: 8000 });
    await p.evaluate(() => { window.GAME.survivalWave = 12; window.GAME.survivalKills = 140; window.GAME.over = 'lose'; });
    await p.waitForFunction(() => !document.getElementById('overlay').classList.contains('hidden'), null, { timeout: 8000 });
    await sleep(400);
    ok(await vis(p, '#share-go'), 'the end screen has no share button');
    const label = await p.textContent('#share-go');
    ok(/share|save/i.test(label), 'the share button label is odd: ' + label);
    console.log('  end-of-run screen offers "' + label.trim() + '" ✓');
    ok(p.__errs.length === 0, 'page errors: ' + p.__errs.join(' | '));
    await p.context().close();
  }

  // ── 3. the invite link actually drops a friend into the game ────────────
  console.log('\n=== invite link ===');
  {
    const a = await newPage('Jayden');
    await a.click('#ss-online');
    await a.waitForFunction(() => document.getElementById('browser') &&
      !document.getElementById('browser').classList.contains('hidden'), null, { timeout: 8000 });
    await sleep(500);
    await a.click('#create-private');
    await a.waitForFunction(() => { const l = document.getElementById('lobby'); return l && !l.classList.contains('hidden'); }, null, { timeout: 8000 });
    await sleep(400);
    ok(await vis(a, '#lobby-link'), 'the lobby has no copy-invite-link button');

    // grab what the button would put on the clipboard
    const link = await a.evaluate(() => {
      const code = (document.getElementById('lobby-code').textContent.match(/[A-Z0-9]{4}/) || [])[0];
      return { code, url: location.origin + location.pathname + '?join=' + code };
    });
    ok(!!link.code, 'no room code to build a link from');
    ok(/\?join=[A-Z0-9]{4}$/.test(link.url), 'the invite link is malformed: ' + link.url);
    console.log('  host lobby code ' + link.code + ' → ' + link.url + ' ✓');

    // a friend opens that link cold: no menu, straight into the game
    const b = await newPage('Mina', link.url);
    await b.waitForFunction(() => { const l = document.getElementById('lobby'); return l && !l.classList.contains('hidden'); }, null, { timeout: 15000 })
      .then(() => ok(true, '')).catch(() => ok(false, 'the invite link did not land the friend in the lobby'));
    await sleep(600);
    ok(await vis(b, '#lobby'), 'the friend is not in a lobby');
    ok(!(await vis(b, '#startscreen')), 'the friend was dumped on the start screen instead');
    const chips = await a.$$eval('#lobby-players .pchip .pn', ns => ns.map(n => n.textContent.replace('👑', '').trim()));
    ok(chips.length === 2, 'the host lobby should now hold 2 players, holds ' + chips.length);
    ok(chips.sort().join(',') === 'Jayden,Mina', 'wrong roster: ' + chips.join(','));
    console.log('  friend opened the link cold and landed in ' + chips.join(' + ') + "'s lobby ✓");

    // the ?join= must be scrubbed so a refresh does not chase a dead room
    const url = await b.evaluate(() => location.search);
    ok(url.indexOf('join=') < 0, 'the join code was left in the address bar (' + url + ')');
    console.log('  address bar cleaned to avoid a stale re-join on refresh ✓');

    ok(a.__errs.length === 0, 'host page errors: ' + a.__errs.join(' | '));
    ok(b.__errs.length === 0, 'friend page errors: ' + b.__errs.join(' | '));
    await a.context().close(); await b.context().close();
  }

  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
