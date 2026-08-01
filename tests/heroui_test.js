// The start screen IS the hero pick — in a real browser
// ---------------------------------------------------------------------------
// roster_test covers the rules; this covers the surface the player actually touches,
// and it exists because of how this particular screen fails. The start screen is built
// once at load time, so a single thrown error does not degrade it — it blanks it. The
// race-face portraits did exactly that once (see the note at the top of heroidle_test),
// and the fix was invisible until someone opened the page.
//
// So the assertions here are deliberately shallow and broad: five cards, the right
// names, the pick persists, the wardrobe opens, buying and wearing do what they say,
// and the console stayed clean through all of it.
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

const PORT = 8890 + (process.pid % 60);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'],
    { env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC, stdio: 'ignore' });
  await sleep(1200);
  const browser = await pw.chromium.launch();
  // A desktop-shaped viewport, so the start screen is in its two-column layout —
  // which is where the wardrobe panel overflowed its column and put its own ✕ under
  // the right-hand one. That click failing is what had been truncating this suite:
  // every assertion after the wardrobe simply never ran, and the run still looked
  // like a harness hiccup rather than the layout bug it was.
  const page = await browser.newPage({ viewport: { width: 1680, height: 1200 } });

  // Missing icons/og-image in a partial checkout are not what this test is about.
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text());
  });
  // Seed a nickname so the first-run modal is not sitting over the start screen.
  await page.addInitScript(() => { try { localStorage.setItem('riftclash_name', 'Tester'); } catch (e) {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(1400);

  console.log('=== the hero row ===');
  ok(errs.length === 0, 'the start screen builds with no console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  const n = await page.locator('.herocard').count();
  ok(n === 5, 'five hero cards, got ' + n);
  const names = await page.locator('.hc-name').allTextContents();
  ok(names.join(',') === 'Rook,Thorn,Prism,Ember,Vale', 'in roster order: ' + names.join(','));
  const plate0 = await page.locator('#hero-plate').textContent();
  ok(/Rook/.test(plate0) && /Mastery/.test(plate0), 'the plate names the hero AND its Mastery: ' + plate0.trim());

  console.log('\n=== the pick ===');
  await page.locator('.herocard').nth(4).click();
  await sleep(350);
  ok(/Vale/.test(await page.locator('#hero-plate').textContent()), 'clicking a card switches the hero on the stage');
  ok(await page.evaluate(() => localStorage.getItem('riftclash_hero')) === 'vale', 'and the pick is written to the profile');
  // The front page IS the pick: what the player is looking at is what deploys.
  const deployed = await page.evaluate(() => {
    const g = window.GAME;
    if (!g) return null;
    g.heroesEnabled = true;
    g.setHeroPick({ 1: RC.Profile.heroPick() });
    g.setup(RC.getMap('earth'), RC.MODES['1v1'], { 1: 'gloop', 2: 'aether' }, 'normal');
    return g.heroOf[1] && g.heroOf[1].type;
  });
  ok(deployed === 'vale', 'and it is the hero that actually spawns — with a Gloop army (' + deployed + ')');

  console.log('\n=== the wardrobe ===');
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  await page.locator('#wardrobe-toggle').click();
  await sleep(300);
  ok(await page.locator('.wd-item').count() > 10, 'the wardrobe opens with items in it');
  ok(/★/.test(await page.locator('#star-count').textContent()), 'and the star balance is on screen');

  // With no stars, an item cannot be bought — and the click must not throw.
  const before = await page.evaluate(() => RC.Profile.cosmeticsOf(RC.Profile.heroPick()).hat);
  await page.locator('.wd-item', { hasText: 'Crown' }).first().click();
  await sleep(250);
  ok(await page.evaluate(() => RC.Profile.cosmeticsOf(RC.Profile.heroPick()).hat) === before,
     'clicking an unaffordable item changes nothing');

  await page.evaluate(() => { const w = RC.Profile.wallet(); w.stars = 999; RC.Profile.saveWallet(w); });
  await page.locator('#wardrobe-close').click();
  await page.locator('#wardrobe-toggle').click();
  await sleep(300);
  const crown = page.locator('.wd-item', { hasText: 'Crown' }).first();
  await crown.click(); await sleep(250);      // buy
  ok(await page.evaluate(() => RC.Profile.owns('hat', 'crown')), 'with stars, the crown is bought');
  ok(await page.evaluate(() => RC.Profile.cosmeticsOf(RC.Profile.heroPick()).hat) === 'none',
     'and buying does NOT silently dress the hero');
  await crown.click(); await sleep(250);      // wear
  const worn = await page.evaluate(() => RC.Profile.cosmeticsOf(RC.Profile.heroPick()).hat);
  ok(worn === 'crown', 'clicking an owned item wears it (' + worn + ')');
  const others = await page.evaluate(() => RC.HEROES.filter(h => RC.Profile.cosmeticsOf(h).hat === 'crown'));
  ok(others.length === 1, 'and only that hero is wearing it — equipment is per hero');

  console.log('\n=== the loadout ===');
  // The Hero Bay's other drawer. loadout_test covers the rules exhaustively and
  // headlessly; what only a browser can prove is that the panel renders, that a click
  // reaches the profile, and that a locked option cannot be clicked into the loadout
  // no matter how hard the pointer tries.
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  await page.locator('#loadout-toggle').click();
  await sleep(300);
  ok(await page.locator('.lo-opt').count() >= 9, 'the loadout panel opens with every option in it');
  ok(await page.locator('.lo-opt.locked').count() > 0, 'and the locked ones are drawn, not hidden');
  ok(await page.locator('.lo-opt.locked .lo-at').first().textContent().then(t => /Mastery/.test(t)),
     'each locked option says which Mastery level opens it');
  ok(await page.locator('.lo-opt.on').count() === 1 + 1 + 3, 'exactly one Q, one E and three upgrades are lit');

  // A locked option is inert. Not "shows a message" — inert.
  const beforeQ = await page.evaluate(() => RC.Profile.loadoutOf(RC.Profile.heroPick()).q);
  await page.locator('.lo-opt.locked').first().click({ force: true });
  await sleep(250);
  ok(await page.evaluate(() => RC.Profile.loadoutOf(RC.Profile.heroPick()).q) === beforeQ,
     'clicking a locked option changes nothing at all');

  // Now earn it, and the same click sticks.
  await page.evaluate(() => { const hs = RC.Profile.heroes(); hs[RC.Profile.heroPick()].mastery = 30; RC.Profile.saveHeroes(hs); });
  await page.reload({ waitUntil: 'load' });
  await sleep(1200);
  await page.locator('#loadout-toggle').click();
  await sleep(300);
  ok(await page.locator('.lo-opt.locked').count() === 0, 'at Mastery 30 nothing is locked any more');
  const secondQ = page.locator('.lo-slot').first().locator('.lo-opt').nth(1);
  const wantQ = await secondQ.getAttribute('data-id');
  await secondQ.click(); await sleep(250);
  ok(await page.evaluate(() => RC.Profile.loadoutOf(RC.Profile.heroPick()).q) === wantQ,
     'picking a Q variant writes it to the profile (' + wantQ + ')');

  // …and it is the hero that actually deploys. This is the assertion the whole
  // feature is for: what you chose in the Bay is what walks onto the map.
  const flown = await page.evaluate(() => {
    const g = window.GAME;
    g.heroesEnabled = true;
    g.setHeroPick({ 1: RC.Profile.heroPick() });
    g.setHeroLoadout({ 1: RC.Profile.loadoutOf(RC.Profile.heroPick()) });
    g.setup(RC.getMap('earth'), RC.MODES['1v1'], { 1: 'forge', 2: 'aether' }, 'normal');
    const h = g.heroOf[1];
    return h && h._lo ? h._lo.q : null;
  });
  ok(flown === wantQ, 'and the hero that spawns is carrying it (' + flown + ')');

  ok(/Mastery|unlocked/.test(await page.locator('#hero-next').textContent()),
     'the start screen names the next unlock rather than promising nothing');

  ok(errs.length === 0, 'no console errors through any of it' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));

  await browser.close();
  srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.message); process.exit(1); });
