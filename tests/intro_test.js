// The introduction film — in a real browser
// ---------------------------------------------------------------------------
// The film is the first thing a new player ever sees, and it sits directly in
// front of the one action they have to complete to use the product at all:
// naming themselves. That makes its failure mode uniquely expensive. A bug that
// merely looks wrong costs a nice moment; a bug that leaves the overlay mounted,
// or throws before `after()` runs, leaves a brand-new player staring at a black
// rectangle with no way into the game. There is no in-game symptom to notice
// later, because they never get in.
//
// So this test is not about whether the film is pretty. It is about the two
// promises the projector makes to the rest of the app:
//
//   1. It always gives the screen back — on skip, on Escape, on reaching the
//      end, and on every path where three.js or WebGL is missing entirely.
//   2. It plays exactly once, unprompted. The trigger is the FIRST name a
//      player ever commits, not every name, or every returning player watches
//      three minutes of film each time they change their nickname.
//
// It also pins the timing, because that regressed once in the obvious way:
// advancing the film by accumulated frame deltas with a per-frame clamp turns a
// slow device into slow motion, and the score — which runs on the audio clock
// and cannot be slowed — walks out of sync with the picture inside a chapter.
// The assertion is deliberately about wall-clock rate, not about frame count.
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

const PORT = 8960 + (process.pid % 30);
const BASE = 'http://127.0.0.1:' + PORT + '/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

(async () => {
  const srv = spawn(process.execPath, [SRC + '/server.js'],
    { env: Object.assign({}, process.env, { PORT: String(PORT) }), cwd: SRC, stdio: 'ignore' });
  await sleep(1200);

  // Software GL, so the test does not depend on the machine having a GPU that
  // headless Chromium is willing to use. It is slow, which is precisely why the
  // timing assertion below has to be about wall time.
  const browser = await pw.chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text());
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await sleep(1200);

  console.log('=== it is wired in, and it costs nothing until it is watched ===');
  ok(await page.evaluate(() => !!(window.RC && RC.Intro && RC.Intro.play)), 'RC.Intro exists');
  ok(await page.evaluate(() => !window.THREE),
     'three.js is NOT loaded on a cold start — 600KB a player who skips never pays for');
  ok(await page.evaluate(() => fetch('vendor/three.min.js', { method: 'HEAD' }).then(r => r.ok)),
     'but vendor/three.min.js is served, so it works offline and from file://');
  const supported = await page.evaluate(() => RC.Intro.supported());
  ok(await page.isVisible('#nickname'), 'a player with no name gets the nickname prompt');
  ok(await page.evaluate(() => !RC.Intro.seen()), 'and has not seen the film');

  if (!supported) {
    // The whole point of `supported()` is that this path is survivable.
    ok(await page.evaluate(() => document.getElementById('intro-btn').classList.contains('hidden')),
       'no WebGL: the button hides itself rather than offering a dead action');
    await page.fill('#nick-input', 'Tester');
    await page.click('#nick-go');
    await sleep(800);
    ok(!(await page.isVisible('#nickname')), 'no WebGL: naming still completes and the game is reachable');
    await browser.close(); srv.kill();
    console.log('\n' + pass + ' passed, ' + fail + ' failed  (WebGL unavailable — reduced run)');
    process.exit(fail ? 1 : 0);
  }
  ok(await page.isVisible('#intro-btn'), 'with WebGL, the replay button is offered');
  ok(/Watch the Intro/.test(await page.textContent('#intro-btn')), 'labelled for someone who has not seen it');

  console.log('\n=== naming yourself for the first time plays it ===');
  await page.fill('#nick-input', 'Jayden');
  await page.click('#nick-go');
  await sleep(4000);
  ok(!(await page.isVisible('#nickname')), 'the prompt closes');
  ok((await page.textContent('#who-name')) === 'Jayden', 'the name is saved before the film, not after');
  ok(await page.evaluate(() => !!document.getElementById('rc-intro')), 'the film mounts');
  ok(await page.evaluate(() => !!window.THREE), 'three.js is fetched on demand');
  ok(await page.evaluate(() => {
    const c = document.querySelector('#rc-intro canvas');
    return !!c && c.width > 100 && c.height > 100;
  }), 'the canvas is sized and drawing');
  ok(await page.evaluate(() => !!document.querySelector('#rc-intro .skip')
    && !!document.querySelector('#rc-intro .bar.top')
    && !!document.querySelector('#rc-intro .prog')), 'skip, letterbox and progress are all there');

  // A key pressed during the film must not reach the game underneath it.
  const pausedBefore = await page.evaluate(() => !!(RC.game && RC.game.paused));
  await page.keyboard.press('p');
  await sleep(250);
  ok((await page.evaluate(() => !!(RC.game && RC.game.paused))) === pausedBefore,
     'game hotkeys are swallowed while the film is up');

  console.log('\n=== it runs on wall time, not on frames ===');
  const prog = () => page.evaluate(() => parseFloat(document.querySelector('#rc-intro .prog').style.width) || 0);
  const p1 = await prog();
  await sleep(5000);
  const p2 = await prog();
  ok(p2 > p1, 'progress advances (' + p1.toFixed(2) + '% → ' + p2.toFixed(2) + '%)');
  const total = await page.evaluate(() => 170);
  const rate = ((p2 - p1) / 100) * total / 5;
  // Under software GL this browser renders a small fraction of 60fps. A frame-
  // delta clock would land near 0.1x here; a wall clock lands near 1.0x.
  ok(rate > 0.7 && rate < 1.35,
     'and does so at roughly 1x real time under software GL (measured ' + rate.toFixed(2) + 'x)');

  console.log('\n=== it always gives the screen back ===');
  await page.click('#rc-intro .skip');
  await sleep(1400);
  ok(await page.evaluate(() => !document.getElementById('rc-intro')), 'skip removes the overlay entirely');
  ok(await page.evaluate(() => !RC.Intro.playing), 'and clears the playing flag');
  ok(await page.evaluate(() => RC.Intro.seen()), 'skipping still counts as seen — it is not a punishment');
  ok(/Again/.test(await page.textContent('#intro-btn')), 'the button relabels itself');
  ok(await page.isVisible('#ss-gamemodes'), 'the start screen is usable');

  await page.click('#intro-btn');
  await sleep(1800);
  ok(await page.evaluate(() => !!document.getElementById('rc-intro')), 'the button replays it');
  await page.keyboard.press('Escape');
  await sleep(1200);
  ok(await page.evaluate(() => !document.getElementById('rc-intro')), 'Escape skips too');

  console.log('\n=== it plays once, and only once ===');
  await page.click('#who-edit');
  await sleep(400);
  await page.fill('#nick-input', 'Jayden2');
  await page.click('#nick-go');
  await sleep(1800);
  ok(await page.evaluate(() => !document.getElementById('rc-intro')),
     'changing your name does NOT replay it — only the first name ever does');
  ok((await page.textContent('#who-name')) === 'Jayden2', 'and the rename still works');

  await page.reload({ waitUntil: 'load' });
  await sleep(1400);
  ok(!(await page.isVisible('#nickname')), 'a returning player is not asked to name themselves');
  ok(await page.evaluate(() => !document.getElementById('rc-intro')), 'and is not shown the film');

  console.log('\n=== reaching the end tears down as cleanly as skipping ===');
  await page.evaluate(() => RC.Intro.jump(6));           // finale only
  // Polled rather than slept: this is the one start that has to re-fetch
  // three.js after a reload, and how long that takes is the machine's business.
  let mounted = false;
  for (let i = 0; i < 40 && !mounted; i++) {
    await sleep(250);
    mounted = await page.evaluate(() => !!document.getElementById('rc-intro'));
  }
  ok(mounted, 'jump() starts mid-film');
  // Speed the clock up rather than waiting out the chapter: the projector reads
  // performance.now() in one place precisely so this is possible.
  await page.evaluate(() => {
    const real = performance.now.bind(performance);
    const t0 = real();
    performance.now = () => t0 + (real() - t0) * 8;
  });
  await sleep(9000);
  ok(await page.evaluate(() => !document.getElementById('rc-intro')), 'the film ends on its own and unmounts');
  ok(await page.evaluate(() => !RC.Intro.playing), 'and clears the playing flag');
  ok(await page.evaluate(() => !document.querySelector('#rc-intro canvas')), 'leaving no canvas behind');
  ok(await page.evaluate(() => RC.HEROES.length === 5),
     'and jump() put the chapter list back the way it found it');

  ok(errs.length === 0, 'no console errors through any of it' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));

  await browser.close();
  srv.kill();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('HARNESS ERROR: ' + e.message); process.exit(1); });
