// RIFT CLASH — Kids mode screen (Crystal Guard), DOM level
// ---------------------------------------------------------------------------
// The other Kids test (kidstest.js) proves the RULES. This one proves the SCREEN:
// that kidsui.js actually assembles, that the three buy buttons appear and spend
// shards when pressed, that the reward cards appear and can only be picked once,
// and that the grown-up HUD is hidden.
//
// It runs the REAL index.html in jsdom with the REAL scripts, so a missing element
// id, a typo in a selector or a script tag left out of index.html fails here rather
// than in front of a child. jsdom has no canvas, so renderer.js and the canvas
// parts of ui.js are stubbed — everything Kids-specific is genuine.
//
// Needs jsdom:  npm i -D jsdom   (skips cleanly with a notice if it is absent)
const path = require('path');
const fs = require('fs');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('\n⚠ kidsuitest: jsdom is not installed — skipping the DOM checks.');
  console.log('  Install it with:  npm i -D jsdom\n');
  process.exit(0);
}

const SRC = path.join(__dirname, '..');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function head(s) { console.log('\n=== ' + s + ' ==='); }

// ── Boot ────────────────────────────────────────────────────────────────────
// index.html is loaded for its MARKUP only (runScripts is off) so a missing
// element id is still caught, then the game scripts we care about are evaluated by
// hand. Loading main.js is deliberately avoided: it owns the menu, fullscreen,
// audio and the rAF loop, none of which jsdom can honour.
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
// runScripts: 'outside-only' is the important bit — it gives us a real window.eval
// (so the game files see `window`) WITHOUT executing the <script src> tags in
// index.html, which jsdom would not be able to fetch anyway.
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

head('INDEX.HTML WIRING');
ok(html.includes('src="kids.js"'), 'index.html loads kids.js');
ok(html.includes('src="kidsui.js"'), 'index.html loads kidsui.js');
ok(html.indexOf('src="kids.js"') > html.indexOf('src="game.js"'), 'kids.js loads after game.js');
ok(html.indexOf('src="kidsui.js"') > html.indexOf('src="ui.js"'), 'kidsui.js loads after ui.js');
ok(!!window.document.getElementById('ss-kids'), 'the Play Crystal Guard button exists');
ok(!!window.document.getElementById('act-kids'), 'the Kids action row exists');
ok(!!window.document.getElementById('ss-kidshint'), 'the Kids hint block exists');
ok(!!window.document.getElementById('stage'), 'the #stage the HUD attaches to exists');

// Canvas is the one thing jsdom cannot do. Stub just enough for game.js's fog
// canvas and ui.js's portrait canvas.
const stubCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'canvas') return { width: 1, height: 1 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'createPattern') return () => null;
    return () => {};
  },
  set: () => true,
});
window.HTMLCanvasElement.prototype.getContext = () => stubCtx;

// The game files are plain scripts that hang everything off `window`, so eval them
// in the jsdom window rather than require()ing them.
function load(f) {
  window.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}
// net_core.js is in the list because the shop buttons issue COMMANDS now (RC.cmd) rather
// than calling RC.Kids.buy directly — one path that works offline and online both.
['config.js', 'maps.js', 'pathfind.js', 'entities.js', 'ai.js', 'keep.js', 'survival.js',
 'kids.js', 'game.js', 'net_core.js', 'kidsui.js'].forEach(load);

const RC = window.RC;
const K = RC.Kids;
ok(!!K, 'RC.Kids loaded in the browser environment');
ok(!!RC.KidsUI, 'RC.KidsUI loaded in the browser environment');

// ── Start a run ─────────────────────────────────────────────────────────────
head('HUD ASSEMBLY');
const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
g.heroesEnabled = true;
g.setupKids({ race: 'forge' });
RC.KidsUI.init(g);
RC.KidsUI.update();

const doc = window.document;
const $ = s => doc.querySelector(s);

ok(!!$('#kids-ui'), 'the Kids overlay was inserted into the page');
ok($('#kids-ui').classList.contains('on'), 'the overlay is switched on for a Kids run');
ok(doc.body.classList.contains('kids-mode'), 'body carries the kids-mode class');
ok(!!$('#kid-shop'), 'the shop bar exists');
ok(!!$('#kid-top'), 'the top strip exists');
ok(!!$('#kid-reward'), 'the reward screen exists');
ok(!$('#kid-reward').classList.contains('on'), 'the reward screen starts hidden');

// The grown-up HUD must be hidden by a rule that actually made it into the page.
const sheets = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\n');
ok(/body\.kids-mode\s+#hud\s*\{[^}]*display\s*:\s*none/.test(sheets), 'a CSS rule hides #hud in kids mode');
ok(/body\.kids-mode\s+#minimap\s*\{[^}]*display\s*:\s*none/.test(sheets), 'a CSS rule hides the minimap in kids mode');

// ── The three buttons ───────────────────────────────────────────────────────
head('THE THREE BUY BUTTONS');
let buys = doc.querySelectorAll('#kid-shop .kid-buy');
ok(buys.length === 3, 'exactly three buttons are rendered, got ' + buys.length);
const labels = Array.from(buys).map(b => b.querySelector('.role').textContent);
ok(labels.join('/') === 'Tank/Archer/Support', 'the labels read Tank/Archer/Support, got ' + labels.join('/'));
ok(Array.from(buys).every(b => /💎\s*\d+/.test(b.querySelector('.cost').textContent)), 'every button shows a shard price');
ok(Array.from(buys).every(b => b.dataset.t && RC.UNITS[b.dataset.t]), 'every button maps to a real unit');

// Press one for real, through the DOM, the way a finger would.
function press(node) {
  node.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}
const shardBefore = g.res[1].shard;
const qBefore = g.kidsBase.queue.length;
press(buys[0]);
ok(g.kidsBase.queue.length === qBefore + 1, 'pressing a button queues a fighter');
ok(g.res[1].shard < shardBefore, 'pressing a button spends shards');
ok(g.kidsBase.queue[0].type === buys[0].dataset.t, 'it queued the fighter on the button that was pressed');

// Too poor → refused, and the button says so.
g.res[1].shard = 0;
RC.KidsUI.update();
buys = doc.querySelectorAll('#kid-shop .kid-buy');
ok(Array.from(buys).every(b => b.classList.contains('poor')), 'with no shards every button is greyed out');
const q2 = g.kidsBase.queue.length;
press(buys[1]);
ok(g.kidsBase.queue.length === q2, 'a greyed-out button cannot be bought');
ok(g.res[1].shard === 0, 'and it did not push the balance negative');

// ── Crystal bar ─────────────────────────────────────────────────────────────
head('CRYSTAL HEALTH BAR');
g.crystal.hp = g.crystal.maxHp;
RC.KidsUI.update();
ok($('#kid-chp').textContent === '100%', 'full crystal reads 100%');
ok($('#kid-cfill').className === '', 'a healthy bar has no warning class');
g.crystal.hp = g.crystal.maxHp * 0.4;
RC.KidsUI.update();
ok($('#kid-cfill').className === 'hurt', 'a damaged crystal turns the bar amber');
ok($('#kid-chp').textContent === '40%', 'the percentage follows the damage');
g.crystal.hp = g.crystal.maxHp * 0.1;
RC.KidsUI.update();
ok($('#kid-cfill').className === 'bad', 'a nearly-dead crystal turns the bar red');
g.crystal.hp = g.crystal.maxHp;

// ── The reward screen ───────────────────────────────────────────────────────
head('REWARD SCREEN');
// The offer belongs to a DEFENDER now, not to the run — in co-op each player is dealt
// their own three, and the screen renders whichever set belongs to the local player.
const s = K.st(g);
s.wave = 4;
s.phase = 'reward';
K.per(g, 1).offer = K.offer(g, 1);
K.per(g, 1).picked = false;
RC.KidsUI.update();

ok($('#kid-reward').classList.contains('on'), 'the reward screen shows when a pick is pending');
const cards = doc.querySelectorAll('#kid-cards .kid-card');
ok(cards.length === 3, 'exactly three cards, got ' + cards.length);
ok(Array.from(cards).every(c => c.querySelector('.nm').textContent.trim().length > 0), 'every card has a name');
ok(Array.from(cards).every(c => c.querySelector('.ds').textContent.trim().length > 0), 'every card explains itself');
ok(/WAVE 4 CLEARED/.test($('#kid-rtitle').textContent), 'the heading names the wave just cleared');

// Picking must be idempotent — a kid double-tapping must not spend two rewards.
const mine = K.per(g, 1);
const takenBefore = JSON.stringify(mine.taken);
const pickedId = mine.offer[0].id;
press(cards[0]);
ok(s.phase === 'build', 'picking a card hands back a Build Day');
ok((mine.taken[pickedId] || 0) === 1, 'the card was counted exactly once');
press(cards[0]);
press(cards[0]);
ok((mine.taken[pickedId] || 0) === 1, 'a double-tap still only spends one reward');
ok(takenBefore !== JSON.stringify(mine.taken), 'the pick was actually recorded');
RC.KidsUI.update();
ok(!$('#kid-reward').classList.contains('on'), 'the reward screen closes after a pick');

// ── Next-wave warning ───────────────────────────────────────────────────────
head('NEXT-WAVE WARNING');
{
  // Wave 4 was just cleared, so wave 5 is next — a plain wave, nothing to warn about.
  ok(s.preview == null, 'no warning before an ordinary wave');
  // Clear wave 5 instead: wave 6 is a Big Guy, which should be announced.
  s.wave = 5; s.phase = 'reward';
  K.per(g, 1).offer = K.offer(g, 1); K.per(g, 1).picked = false;
  K.choose(g, K.per(g, 1).offer[0].id, 1);
  ok(s.preview && s.preview.name === 'Big Guy', 'a special wave is announced one wave ahead');
  s.phase = 'reward';                             // reopen so the UI renders the notice
  K.per(g, 1).offer = K.offer(g, 1); K.per(g, 1).picked = false;
  RC.KidsUI.update();
  ok(/Big Guy/.test($('#kid-next').textContent), 'the warning is on screen while the reward is still unspent');
  // And again during the countdown after the card is picked, when the reward screen
  // is gone and the top strip is the only thing left saying it.
  s.phase = 'gap'; K.per(g, 1).offer = null; s.timer = 4;
  RC.KidsUI.update();
  ok(/Big Guy/.test($('#kid-wave').textContent), 'the top strip advertises what is coming during the countdown');
  ok(/\d+s/.test($('#kid-timer').textContent), 'the countdown shows seconds remaining');
  // Once the wave starts, the strip goes back to reporting the present.
  s.phase = 'spawning'; s.wave = 6; s.preview = null; s.timer = 0;
  RC.KidsUI.update();
  ok(!/Next:/.test($('#kid-wave').textContent), 'once the wave lands the strip stops saying "Next"');
}

// ── Unlocks reach the shop ──────────────────────────────────────────────────
head('UNLOCKS REACH THE SHOP');
{
  const st2 = K.st(g);
  st2.phase = 'gap';
  const p1 = K.per(g, 1);
  p1.offer = null;
  p1.unlocked = ['volt'];
  p1.freshUnlock = 'volt';
  g.res[1].shard = 9999;
  RC.KidsUI.update();
  const b2 = doc.querySelectorAll('#kid-shop .kid-buy');
  ok(b2.length === 4, 'an unlock adds a fourth button, got ' + b2.length);
  const newBadge = Array.from(b2).find(b => b.querySelector('.new'));
  ok(!!newBadge, 'the newly unlocked button carries a NEW! badge');
  ok(newBadge && newBadge.dataset.t === 'volt', 'the badge is on the unit that just unlocked');
  const q3 = g.kidsBase.queue.length;
  press(b2[3]);
  ok(g.kidsBase.queue.length === q3 + 1, 'the newly unlocked fighter is buyable');
}

// ── Banners ─────────────────────────────────────────────────────────────────
head('BANNERS');
K.banner(g, '🎉', 'WAVE 9 CLEARED!', 'Nice work', '#ffd24a', 2);
RC.KidsUI.update();
ok($('#kid-banner').classList.contains('on'), 'a banner shows when one is set');
ok($('#kid-btitle').textContent === 'WAVE 9 CLEARED!', 'the banner shows the right text');
K.st(g).banner = null;
RC.KidsUI.update();
ok(!$('#kid-banner').classList.contains('on'), 'the banner clears when it expires');

// ── Leaving Kids mode tidies up ─────────────────────────────────────────────
head('LEAVING KIDS MODE');
g.setupSurvival({ race: 'forge', ally: false, difficulty: 'medium' });
RC.KidsUI.update();
ok(!doc.body.classList.contains('kids-mode'), 'the kids-mode body class is removed for a Survival run');
ok(!$('#kids-ui').classList.contains('on'), 'the Kids overlay hides itself for a Survival run');

// ── The confetti fx is a shape the renderer understands ─────────────────────
head('CELEBRATION FX');
{
  const g3 = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
  g3.setupKids({ race: 'forge' });
  const st3 = K.st(g3);
  st3.wave = 1; st3.phase = 'fighting';
  g3.fx.length = 0;
  K.update(1 / 30, g3);                   // no enemies alive → clears the wave
  const p = g3.fx.filter(f => f.party);
  ok(p.length >= 1, 'clearing a wave pushes a confetti fx');
  ok(p.every(f => f.t > 0 && f.n > 0 && typeof f.ax === 'number' && typeof f.ay === 'number'),
     'the confetti fx carries the fields renderer.js reads');
  ok(st3.phase === 'celebrate', 'the run enters the celebration phase');
  const rend = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8');
  ok(/if \(f\.party\)/.test(rend), 'renderer.js dispatches on f.party');
  ok(/function drawParty/.test(rend), 'renderer.js has a drawParty');
}

// ── The whole path, from the menu button ────────────────────────────────────
// Everything above drove RC.KidsUI directly. This does what a child does: load the
// page, load EVERY script index.html loads (main.js included), press the mode card,
// press Play, and tick real frames. It is the one check that catches a missing
// script tag, a menu id typo or a throw inside startKids.
head('FROM THE MENU BUTTON');
{
  const d2 = new JSDOM(html, { runScripts: 'outside-only' });
  const w2 = d2.window;
  w2.requestAnimationFrame = () => 0;             // no render loop in a static check
  w2.cancelAnimationFrame = () => {};
  w2.HTMLCanvasElement.prototype.getContext = () => stubCtx;
  w2.matchMedia = w2.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));

  // The script list is read out of index.html rather than hard-coded, so a file
  // added to the page later is exercised here automatically.
  const srcs = Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g)).map(m => m[1]);
  ok(srcs.length > 10, 'found the script list in index.html (' + srcs.length + ' files)');
  const loadErrs = [];
  srcs.forEach(f => {
    try { w2.eval(fs.readFileSync(path.join(SRC, f), 'utf8')); }
    catch (e) { loadErrs.push(f + ': ' + e.message); }
  });
  ok(loadErrs.length === 0, 'every script index.html loads evaluates cleanly' +
     (loadErrs.length ? ' — ' + loadErrs.join(' | ') : ''));

  const dd = w2.document;
  // Crystal Guard and Survival now live behind ONE card — Crystal Defense — with the depth
  // chosen inside it. Both routes have to still work from that single card, which is the
  // whole reason the two were merged.
  const card = Array.from(dd.querySelectorAll('#ss-gamemodes .gmcard')).find(c => c.dataset.m === 'defend');
  ok(!!card, 'the Crystal Defense mode card is on the start screen');
  ok(card && card.querySelector('.gm-name').textContent === 'Crystal Defense', 'the card is named Crystal Defense');
  ok(!dd.querySelector('#ss-gamemodes .gmcard[data-m="survival"]'),
     'Survival no longer has a second competing card');
  ok(dd.querySelectorAll('#ss-gamemodes .gmcard').length === 4, 'the front page is down to four mode cards');

  // ── Two rows: Tutorial alone, then the three modes ───────────────────────
  // A flex row wraps wherever the width happens to run out, so the split is forced with
  // an explicit break element. This asserts the arrangement rather than the widths.
  {
    const kids2 = Array.from(dd.querySelectorAll('#ss-gamemodes > *'));
    const rows = [[]];
    for (const el of kids2) {
      if (/gm-break/.test(el.className)) { rows.push([]); continue; }
      rows[rows.length - 1].push(el.dataset.m);
    }
    console.log('  mode rows: ' + rows.map(r => '[' + r.join(', ') + ']').join('  '));
    ok(rows.length === 2, 'there are exactly two rows, got ' + rows.length);
    ok(rows[0].join() === 'tutorial', 'Tutorial sits alone on the first row, got [' + rows[0].join(', ') + ']');
    ok(rows[1].length === 3, 'the three modes share the second row, got ' + rows[1].length);
    ok(rows[1].indexOf('defend') >= 0 && rows[1].indexOf('vs') >= 0 && rows[1].indexOf('campaign') >= 0,
       'and they are Crystal Defense, Versus and Campaign');
    const brk = dd.querySelector('#ss-gamemodes .gm-break');
    ok(!!brk && w2.getComputedStyle(brk).flexBasis === '100%', 'the break is a full-width flex item');
  }

  // ── Every action button is the same size ──────────────────────────────────
  // "Play Crystal Guard" shipped with NO css rule of its own, so it rendered at the
  // browser's default size next to a full-size "Online Co-op" beside it, and every
  // existing test passed the whole time — none of them look at how anything is sized.
  // The metrics all come from one class now, and this is what keeps it that way: add a
  // button to an action row without giving it .ss-act/.ss-act2 and this fails.
  {
    const acts = ['ss-start', 'ss-online', 'ss-kids', 'ss-kids-online',
                  'ss-survival', 'ss-survival-online', 'ss-leaderboard'];
    const cs = acts.map(id => {
      const el = dd.getElementById(id);
      ok(!!el, 'action button #' + id + ' exists');
      const c = el && w2.getComputedStyle(el);
      return { id, cls: el && el.className, font: c && c.fontSize, minH: c && c.minHeight, rad: c && c.borderRadius };
    });
    console.log('  action buttons: ' + cs.map(c => c.id + '(' + c.font + '/' + c.minH + ')').join(' '));
    ok(cs.every(c => /ss-act2?\b/.test(c.cls || '')),
       'every action button carries the shared size class — missing on: ' +
       cs.filter(c => !/ss-act2?\b/.test(c.cls || '')).map(c => c.id).join(', '));
    const font = cs[0].font, minH = cs[0].minH;
    ok(!!font && !!minH, 'the shared class actually resolves to a font size and a height');
    ok(cs.every(c => c.font === font), 'all action buttons share one font size, saw ' +
       [...new Set(cs.map(c => c.font))].join(' / '));
    ok(cs.every(c => c.minH === minH), 'all action buttons share one height, saw ' +
       [...new Set(cs.map(c => c.minH))].join(' / '));
    ok(cs.every(c => c.rad === cs[0].rad), 'all action buttons share one corner radius');
    // The row owns the vertical margin, so no button can knock its neighbours out of line.
    ok(cs.every(c => {
      const m = w2.getComputedStyle(dd.getElementById(c.id)).marginTop;
      return m === '0px' || m === '' || m == null;
    }), 'no action button carries its own top margin');
    for (const row of ['act-vs', 'act-kids', 'act-survival']) {
      ok(w2.getComputedStyle(dd.getElementById(row)).marginTop === '22px',
         row + ' carries the row margin instead');
    }
    // And the depth picker lays out as a centred row, not the stacked column it inherits.
    const dep = w2.getComputedStyle(dd.getElementById('ss-depths'));
    ok(dep.display === 'flex' && dep.justifyContent === 'center', 'the depth picker is a centred row');
  }
  card.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  ok(dd.getElementById('sec-depth').style.display === 'flex', 'the depth picker appears');
  const depths = Array.from(dd.querySelectorAll('#ss-depths .modebtn'));
  ok(depths.length === 2, 'there are exactly two depths, got ' + depths.length);

  // Full RTS reveals Survival's controls...
  depths[1].dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  ok(dd.getElementById('act-survival').style.display === 'flex', 'Full RTS reveals the Survival buttons');
  ok(dd.getElementById('sec-diff').style.display === 'flex', 'Full RTS has a difficulty picker');
  ok(dd.getElementById('act-kids').style.display === 'none', 'and hides the Crystal Guard button');

  // ...and Simple reveals Crystal Guard's, with none of the pickers a kid can trip on.
  depths[0].dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
  ok(dd.getElementById('act-kids').style.display === 'flex', 'Simple reveals the Play button');
  ok(dd.getElementById('act-survival').style.display === 'none', 'and hides the Survival buttons');
  ok(dd.getElementById('sec-diff').style.display === 'none', 'no difficulty picker to get stuck on');
  ok(dd.getElementById('sec-map').style.display === 'none', 'and no map picker either');
  ok(dd.getElementById('sec-race').style.display === 'flex', 'faction can still be chosen');
  ok(!!dd.getElementById('ss-kids-online'), 'there is a play-with-a-friend button');

  // ── The buttons say who you are playing with, and against ────────────────
  // "Start Battle" / "Play Crystal Guard" told a new player nothing about whether they
  // were about to face a computer or a person.
  {
    const txt = id => (dd.getElementById(id).textContent || '').trim();
    for (const id of ['ss-start', 'ss-kids', 'ss-survival']) {
      ok(/computer/i.test(txt(id)), id + ' says it is against the computer — "' + txt(id) + '"');
    }
    for (const id of ['ss-online', 'ss-kids-online', 'ss-survival-online']) {
      ok(/friend/i.test(txt(id)), id + ' says it involves a friend — "' + txt(id) + '"');
    }
    ok(/3 vs computer/i.test(txt('ss-kids-online')), 'Crystal Defense co-op states it is 3 vs the computer');
  }

  // ── The explanatory paragraphs are prose, not flex columns ───────────────
  // They carried .mode-sec (display:flex; flex-direction:column), which turned every
  // inline <b> into its own flex item — the text rendered one fragment per line.
  {
    depths[1].dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));   // show the survival note
    for (const id of ['ss-survivalhint', 'ss-onlinehint', 'ss-kidshint']) {
      const e = dd.getElementById(id);
      ok(!!e && /ss-note/.test(e.className), id + ' uses the prose class');
      ok(!/mode-sec/.test(e.className), id + ' is no longer a flex column');
      const disp = w2.getComputedStyle(e).display;
      ok(disp === 'block' || disp === 'none', id + ' renders as a block, got ' + disp);
      ok(e.querySelectorAll('b').length > 0, id + ' still has its bold phrases');
    }
    depths[0].dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));   // back to Simple
  }

  // ── Campaign is parked ───────────────────────────────────────────────────
  {
    const camp = Array.from(dd.querySelectorAll('#ss-gamemodes .gmcard')).find(c => c.dataset.m === 'campaign');
    ok(!!camp, 'the Campaign card is still on the page');
    ok(/\bsoon\b/.test(camp.className), 'it is marked as parked');
    ok(/COMING SOON/i.test(camp.textContent), 'and says COMING SOON');
    // Clicking it must not switch the screen to a mode that is not ready.
    camp.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
    ok(dd.getElementById('panel-campaign').style.display === 'none', 'clicking it does not open the campaign panel');
    ok(dd.getElementById('sec-depth').style.display !== 'none', 'and the screen stays on a playable mode');
  }

  // ── The Crystal Guard shop is one row on a phone ─────────────────────────
  // jsdom does not evaluate media queries, so this reads the rule. The roster grows from
  // three buttons to nine as things unlock, and a wrapping shop turned into a tall column
  // straight up the middle of a portrait screen — covering the crystal being defended.
  {
    const kui = fs.readFileSync(path.join(SRC, 'kidsui.js'), 'utf8');
    const mq = kui.slice(kui.indexOf('@media (max-width:760px)'));
    ok(mq.length > 0, 'kidsui has a phone media query');
    ok(/#kid-shop\s*\{[^}]*flex-wrap:\s*nowrap/.test(mq), 'the phone shop does not wrap');
    ok(/#kid-shop\s*\{[^}]*overflow-x:\s*auto/.test(mq), 'it scrolls sideways instead');
    ok(/padding-right:\s*\d+px/.test(mq), 'and leaves room for the charge button');
  }

  const thrown = [];
  w2.onerror = m => thrown.push(String(m));
  try { dd.getElementById('ss-kids').dispatchEvent(new w2.MouseEvent('click', { bubbles: true })); }
  catch (e) { thrown.push('threw: ' + e.message); }
  ok(thrown.length === 0, 'pressing Play does not throw' + (thrown.length ? ' — ' + thrown.join(' | ') : ''));

  const G = w2.GAME;
  ok(G && G.kids === true, 'a Kids run actually started');
  // ONE worker, and it only builds — the mode gained a fort-building loop without gaining
  // an economy to forget. See the BUILDING section in kidstest.js.
  ok(G && G.units.filter(u => u.def.worker).length === w2.RC.Kids.CFG.BUILDERS,
     'the started run has a crew of ' + w2.RC.Kids.CFG.BUILDERS + ' builders');
  ok(G && G.nodes.length === 0, 'and nothing to mine, so they can only build');
  // The build panel is selection-driven: it opens when the BUILDER is the thing you
  // are looking at, exactly as tapping the builder on the map does. Without this the
  // panel renders empty and every assertion below it reads zero — which is what this
  // test did for as long as jsdom was missing and nobody could see it fail.
  G.selection = [w2.RC.Kids.workerOf(G, G.playerOwner)];
  w2.RC.KidsUI.update();          // one frame, so the build bar has been rendered
  ok(!!dd.getElementById('kid-build'), 'the build bar is on screen');
  // The catalogue moved to keep.js when Crystal Guard became the keep — walls, the
  // gate, the race's tower and the decorations. RC.KID_BUILD is still in config.js
  // for anything asking the old question, but the panel is built from the new list.
  ok(dd.querySelectorAll('#kid-build .kid-bb').length === RC.Keep.MENU.length,
     'with a button per buildable, got ' + dd.querySelectorAll('#kid-build .kid-bb').length);
  // Tapping one arms placement; tapping it again puts it back.
  {
    const bb = dd.querySelector('#kid-build .kid-bb');
    press(bb);
    ok(G.placing === bb.dataset.t, 'tapping a build button arms that building');
    w2.RC.KidsUI.update();
    ok(dd.getElementById('kid-placing').classList.contains('on'), 'and the tap-where-you-want-it hint shows');
    press(bb);
    ok(!G.placing, 'tapping it again disarms — a kid who changed their mind is never stuck');
  }
  ok(G && G.nodes.length === 0, 'the started run has no shard nodes');
  ok(dd.getElementById('startscreen').classList.contains('hidden'), 'the start screen got out of the way');

  // Real frames through the real UI, the way the rAF loop would drive them.
  let frameErr = null;
  try {
    for (let i = 0; i < 60; i++) { G.update(1 / 30); w2.RC.UI.update(); w2.RC.KidsUI.update(); }
  } catch (e) { frameErr = e.message; }
  ok(!frameErr, '60 frames through UI.update + KidsUI.update run clean' + (frameErr ? ' — ' + frameErr : ''));
  ok(dd.querySelectorAll('#kid-shop .kid-buy').length === 3, 'the three buttons are on screen after a real start');
  ok(dd.body.classList.contains('kids-mode'), 'the grown-up HUD is switched off');
}

console.log('\n' + (fail ? '✖ ' : '✔ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
