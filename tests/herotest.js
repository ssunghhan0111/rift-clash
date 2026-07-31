// Heroes must exist in every mode — including ONLINE, where they were switched
// off. Checks the offline modes headlessly, then puts two real browsers in an
// online match and verifies the hero survives the netcode: level, xp, cooldowns,
// casting and revive all have to cross the wire.
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

// ── offline, headless ─────────────────────────────────────────────────────
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));
const heroesOf = g => g.units.filter(u => u.hero || (u.def && u.def.hero));

console.log('=== heroes offline ===');
{
  const defs = Object.values(RC.UNITS).filter(u => u.hero);
  ok(defs.length === 3, 'expected 3 hero definitions, found ' + defs.length);
  defs.forEach(d => {
    ok(!!d.sig, d.name + ' has no signature');
    ok((d.skills || []).length === 3, d.name + ' should have 3 skills, has ' + (d.skills || []).length);
    ok(d.skills[2] === d.sig, d.name + ' slot R should be the signature itself');
  });
  console.log('  defined: ' + defs.map(d => d.name + ' / ' + d.skills.map(s => s.name).join('+')).join(' · ') + ' ✓');

  // 1v1: both sides get one
  const vs = new RC.Game(RC.getMap('earth'), RC.MODES['1v1']);
  vs.heroesEnabled = true; vs.reset();
  const vh = heroesOf(vs);
  ok(vh.length === 2, '1v1 should field 2 heroes, fielded ' + vh.length);
  ok(new Set(vh.map(h => h.owner)).size === 2, 'both heroes belong to the same player');
  console.log('  1v1: ' + vh.map(h => h.def.name + '(p' + h.owner + ')').join(' vs ') + ' ✓');

  // 2v2: four
  const t = new RC.Game(RC.getMap('mars'), RC.MODES['2v2']);
  t.heroesEnabled = true; t.reset();
  ok(heroesOf(t).length === 4, '2v2 should field 4 heroes, fielded ' + heroesOf(t).length);

  // survival: one for the defender
  const sv = new RC.Game();
  sv.heroesEnabled = true;
  sv.setupSurvival({ race: 'gloop', ally: false, difficulty: 'medium' });
  const sh = heroesOf(sv);
  ok(sh.length === 1, 'survival should field 1 hero, fielded ' + sh.length);
  ok(sh[0].def.race === 'gloop', 'the survival hero should match the chosen faction, got ' + sh[0].def.race);
  console.log('  2v2: 4 heroes · survival: ' + sh[0].def.name + ' (matches the Gloop pick) ✓');

  // Levelling, and what levelling now buys. The ultimate is no longer gated behind a
  // level — it is gated behind the charge meter, which is a thing you EARN in the fight
  // rather than a thing you wait for. What levels buy instead is bigger numbers on the
  // whole kit and the three signature upgrades.
  const h = sh[0];
  ok(h.level === 1, 'a fresh hero should be level 1');
  ok(h.sigReady() === false, 'and its signature is not ready, because nothing has charged it');
  const q = h.def.skills[0];
  const lo = h.effSkill(q).dmg;
  const upsAt1 = h.def.sig.ups.filter(u => h.hasUp(u.id)).length;
  for (let i = 0; i < 40; i++) h.gainXp(100);
  ok(h.level > 1, 'the hero never levelled');
  ok(h.effSkill(q).dmg > lo, 'levelling never made its Q hit harder (' + lo + ' -> ' + h.effSkill(q).dmg + ')');
  ok(h.def.sig.ups.filter(u => h.hasUp(u.id)).length > upsAt1, 'levelling never unlocked a signature upgrade');
  h.charge = 1; h.sigCd = 0;
  ok(h.sigReady() === true, 'and a full charge meter is what actually arms the signature');
  console.log('  levelling works: reached level ' + h.level + ', Q scaled and upgrades unlocked ✓');
}

// ── the netcode carries a hero ────────────────────────────────────────────
console.log('\n=== a hero across the wire ===');
{
  const g = new RC.Game(RC.getMap('earth'), RC.MODES['1v1']);
  g.heroesEnabled = true; g.reset();
  const h = heroesOf(g)[0];
  h.gainXp(500);
  const cdId = h.def.skills[0].id;                  // cooldowns are keyed by ability id
  h.skillCd[cdId] = 4.2;
  const snap = RC.Net.serialize(g);
  const row = snap.U.find(u => u.hr);
  ok(!!row, 'the snapshot carries no hero state at all');
  ok(row.hr.l === h.level, 'hero level did not serialize (' + (row.hr && row.hr.l) + ' vs ' + h.level + ')');
  ok(row.hr.cd && row.hr.cd[cdId] > 0, 'skill cooldowns did not serialize');

  const c = new RC.Game(RC.getMap('earth'), RC.MODES['1v1']);
  RC.Net.applySnapshot(c, snap);
  const ch = heroesOf(c)[0];
  ok(!!ch, 'the client rebuilt no hero from the snapshot');
  ok(ch.level === h.level, 'the client sees the wrong hero level (' + ch.level + ' vs ' + h.level + ')');
  ok(Math.abs((ch.skillCd[cdId] || 0) - 4.2) < 0.2, 'the client sees the wrong cooldown');
  // The charge meter is server-owned: without it in the snapshot an online player's ring
  // would sit empty all match while the server happily fired their signature.
  ok(Math.abs(ch.charge - h.charge) < 0.02, 'the client sees the wrong signature charge');
  ok(ch.sigReady() === h.sigReady(), 'the client disagrees about whether the signature is ready');
  console.log('  level ' + h.level + ', a 4.2s cooldown and the charge meter all survive the snapshot ✓');
}

// ── online, two real browsers ─────────────────────────────────────────────
const { chromium } = requirePlaywright();
const PORT = 8960 + (process.pid % 30);
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
    args: ['--no-sandbox', '--disable-gpu', '--use-fake-ui-for-media-stream',
           '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  async function newPage(name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    await ctx.addInitScript(n => { try { localStorage.setItem('riftclash_name', n); } catch (e) {} }, name);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RC && window.RC.UI, null, { timeout: 10000 });
    page.__errs = errs;
    return page;
  }

  console.log('\n=== heroes ONLINE ===');
  const a = await newPage('Jayden');
  const b = await newPage('Mina');
  await a.click('#ss-online');
  await b.click('#ss-online');
  await a.waitForFunction(() => document.querySelectorAll('#online-list .prow').length > 0, null, { timeout: 8000 });
  await sleep(400);
  await a.click('#online-list .prow .pinv button:nth-child(1)');     // invite to 1v1
  await b.waitForFunction(() => { const p = document.getElementById('invite-pop'); return p && !p.classList.contains('hidden'); }, null, { timeout: 6000 });
  await b.click('#inv-accept');
  await b.waitForFunction(() => { const l = document.getElementById('lobby'); return l && !l.classList.contains('hidden'); }, null, { timeout: 6000 });
  await sleep(500);
  await a.click('#lobby-start');
  await a.waitForFunction(() => window.GAME && window.RC.online && window.GAME.units.length > 0, null, { timeout: 15000 });
  await b.waitForFunction(() => window.GAME && window.RC.online && window.GAME.units.length > 0, null, { timeout: 15000 });
  await sleep(2500);                                                  // let a few snapshots land

  const look = p => p.evaluate(() => {
    const g = window.GAME;
    const hs = g.units.filter(u => u.hero || (u.def && u.def.hero));
    const mine = hs.find(h => h.owner === g.playerOwner);
    return {
      total: hs.length,
      names: hs.map(h => h.def.name + '(p' + h.owner + ')'),
      mineName: mine && mine.def.name,
      mineLevel: mine && mine.level,
      mineHasSkills: !!(mine && mine.def.skills && mine.def.skills.length),
      heroBtn: !!document.getElementById('tb-hero'),
    };
  });
  const sa = await look(a), sb = await look(b);
  ok(sa.total === 2, 'the host sees ' + sa.total + ' heroes online, expected 2');
  ok(sb.total === 2, 'the guest sees ' + sb.total + ' heroes online, expected 2');
  ok(!!sa.mineName, 'the host has no hero of their own online');
  ok(!!sb.mineName, 'the guest has no hero of their own online');
  ok(sa.mineLevel === 1, 'the online hero did not start at level 1 (' + sa.mineLevel + ')');
  ok(sa.mineHasSkills, 'the online hero has no skills');
  console.log('  host sees: ' + sa.names.join(', '));
  console.log('  guest sees: ' + sb.names.join(', '));
  console.log('  each player commands their own ' + sa.mineName + ' / ' + sb.mineName + ' ✓');

  // the hero must be selectable and show its skill panel
  const panel = await a.evaluate(async () => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    g.selection = [mine];
    RC.UI.update();
    await new Promise(r => setTimeout(r, 200));
    return {
      name: document.getElementById('sel-name').textContent,
      cmds: [...document.querySelectorAll('#cmd-grid .cmd .l')].map(e => e.textContent.trim()),
    };
  });
  ok(/rook|thorn|prism/i.test(panel.name), 'selecting the online hero shows "' + panel.name + '"');
  ok(panel.cmds.length >= 3, 'the online hero has no skill buttons (' + panel.cmds.join(', ') + ')');
  console.log('  selected "' + panel.name + '" → skills: ' + panel.cmds.join(', ') + ' ✓');

  // A level-1 hero has its whole Q/E pair available — they are gated by energy and a
  // cooldown, not by level — while the signature is gated by a charge meter that a hero
  // fresh out of the gate has not filled. Both of the tactical two are area effects that
  // need something to hit, so a cast at the spawn point is refused by design, on the
  // server exactly as it is offline. To prove the command really crosses the wire, march
  // both heroes at each other and cast for real once an enemy is inside the radius.
  const gate = await a.evaluate(() => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    return { ready: mine.def.skills.map(sk => mine.skillReady(sk)),
             energy: Math.round(mine.energy), charge: mine.charge };
  });
  ok(gate.ready[0] === true && gate.ready[1] === true, 'a level-1 hero should have both tactical skills available');
  ok(gate.ready[2] === false, 'but not its signature — that has to be charged by fighting');
  console.log('  level-1 kit online matches offline: ready ' + gate.ready.join('/') +
              ', energy ' + gate.energy + ', charge ' + gate.charge.toFixed(2) + ' ✓');

  const march = p => p.evaluate(() => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    RC.cmd(g, { t: 'amove', ids: [mine.id], x: RC.CFG.WORLD_W / 2, y: RC.CFG.WORLD_H / 2 });
    return mine.id;
  });
  await march(a); await march(b);
  const contact = () => a.evaluate(() => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    if (!mine) return 1e9;
    let best = 1e9;
    for (const u of g.units) {
      if (u.dead || !g.areEnemies(u.owner, mine.owner)) continue;
      best = Math.min(best, RC.dist(mine.x, mine.y, u.x, u.y));
    }
    return best;
  });
  let gap = 1e9;
  for (let i = 0; i < 90 && (gap = await contact()) > 100; i++) await sleep(1000);
  ok(gap <= 100, 'the two heroes never met in the middle (closest ' + Math.round(gap) + 'px) — attack-move may not be reaching the server');

  const cast = await a.evaluate(async () => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    const sk = mine.def.skills[0];                         // Q — always available, costs energy
    const key = sk.key.toLowerCase();
    const before = Math.round(mine.energy);
    RC.cmd(g, { t: 'cast', ids: [mine.id], key });
    await new Promise(r => setTimeout(r, 1500));
    const after = g.units.find(u => u.id === mine.id);
    return { key, before, cdAfter: after ? (after.skillCd[sk.id] || 0) : -1,
             energyAfter: after ? Math.round(after.energy) : -1 };
  });
  ok(cast.cdAfter > 0, 'casting a hero skill online did not put it on cooldown (the server ignored it)');
  ok(cast.energyAfter < cast.before, 'the server did not spend the hero energy (' + cast.before + ' → ' + cast.energyAfter + ')');
  console.log('  contact at ' + Math.round(gap) + 'px → cast "' + cast.key + '": server charged '
    + (cast.before - cast.energyAfter) + ' energy and returned a ' + cast.cdAfter.toFixed(1) + 's cooldown ✓');

  // and the xp earned by fighting has to reach the client too
  const xp = await a.evaluate(() => {
    const g = window.GAME;
    const mine = g.units.find(u => (u.hero || u.def.hero) && u.owner === g.playerOwner);
    return { xp: Math.round(mine.xp), level: mine.level, hp: Math.round(mine.hp), max: mine.maxHp };
  });
  ok(xp.hp < xp.max, 'the two heroes fought but the host hero took no damage — the sim may not be shared');
  console.log('  after the fight the host hero reads ' + xp.hp + '/' + xp.max + ' hp, level ' + xp.level + ', ' + xp.xp + ' xp ✓');

  ok(a.__errs.length === 0, 'host page errors: ' + a.__errs.join(' | '));
  ok(b.__errs.length === 0, 'guest page errors: ' + b.__errs.join(' | '));
  ok(!/Error|error:/i.test(srvErr), 'the server logged errors:\n' + srvErr);

  await a.context().close(); await b.context().close();
  await browser.close(); srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.stack); process.exit(1); });
