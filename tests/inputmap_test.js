// RIFT CLASH — pointer-to-world mapping, in real jsdom
// ---------------------------------------------------------------------------
// The canvas is sized in CSS pixels but its BACKING STORE is set separately, and every
// pointer handler converts a click with `clientX - rect.left`. The moment those two sizes
// differ — a fractional layout, or any viewport change before the next resize() — that
// conversion is wrong by a factor that GROWS with distance from the top-left corner, so
// taps land progressively further from the finger the further down the screen you go.
//
// That shipped, and nothing caught it: no other test looks at where a click lands. This
// one drives the real input.js with a canvas whose display box deliberately disagrees with
// its backing store, and checks the arithmetic at the corners and in the middle.
const path = require('path');
const fs = require('fs');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  console.log('\n⚠ inputmap_test: jsdom is not installed — skipping.\n  Install it with:  npm i -D jsdom\n');
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
function head(s) { console.log('\n=== ' + s + ' ==='); }

const SRC = path.join(__dirname, '..');
const dom = new JSDOM('<!doctype html><body><div id="stage"><canvas id="screen"></canvas></div><canvas id="mini"></canvas></body>',
                      { pretendToBeVisual: true, runScripts: 'outside-only' });
const w = dom.window;
w.RC = w.RC || {};

// Canvas has no 2D context in jsdom; nothing in input.js needs one, but game.js asks.
const stubCtx = new Proxy({}, { get: () => () => {}, set: () => true });
w.HTMLCanvasElement.prototype.getContext = () => stubCtx;

for (const f of ['config.js', 'maps.js', 'pathfind.js', 'entities.js', 'ai.js', 'survival.js',
                 'kids.js', 'game.js', 'net_core.js', 'input.js']) {
  w.eval(fs.readFileSync(path.join(SRC, f), 'utf8'));
}
const RC = w.RC;

const cv = w.document.getElementById('screen');
const mini = w.document.getElementById('mini');

// The canvas is DISPLAYED at 800x600 but its backing store is 1000x750 — a 1.25x
// mismatch, the same shape of error a fractional layout or a stale resize produces.
const DISP = { left: 40, top: 90, width: 800, height: 600 };
cv.width = 1000; cv.height = 750;
cv.getBoundingClientRect = () => ({
  left: DISP.left, top: DISP.top, width: DISP.width, height: DISP.height,
  right: DISP.left + DISP.width, bottom: DISP.top + DISP.height, x: DISP.left, y: DISP.top,
});
mini.width = 120; mini.height = 120;
mini.getBoundingClientRect = () => ({ left: 0, top: 0, width: 120, height: 120, right: 120, bottom: 120, x: 0, y: 0 });

const g = new RC.Game(RC.MAPS[0], RC.MODES['1v1']);
g.camera.x = 0; g.camera.y = 0; g.camera.z = 1;
RC.Input.init(g, cv, mini);

function tap(clientX, clientY) {
  // jsdom has no PointerEvent, and `target` on a real Event is read-only — so the
  // coordinate fields are defined on the instance and the event is dispatched for real,
  // which means input.js's own listener runs exactly as it does in a browser.
  const ev = new w.Event('pointerdown', { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries({ clientX, clientY, pointerId: 1, pointerType: 'mouse',
                                        button: 0, buttons: 1, shiftKey: false, ctrlKey: false })) {
    Object.defineProperty(ev, k, { value: v, configurable: true });
  }
  cv.dispatchEvent(ev);
  return { x: RC.Input.state.screen.x, y: RC.Input.state.screen.y };
}

head('a click maps to the right point when display size != backing store');
{
  const sx = cv.width / DISP.width, sy = cv.height / DISP.height;
  console.log('  displayed ' + DISP.width + '×' + DISP.height + ', backing store ' +
              cv.width + '×' + cv.height + '  (scale ' + sx + '×' + sy + ')');

  // Top-left corner of the canvas — the one point a broken conversion still gets right,
  // which is exactly why this bug survives casual testing.
  let p = tap(DISP.left, DISP.top);
  ok(Math.abs(p.x) < 0.01 && Math.abs(p.y) < 0.01, 'the top-left corner maps to 0,0 — got ' + p.x + ',' + p.y);

  // Middle. An unscaled conversion is short by 20% here.
  p = tap(DISP.left + DISP.width / 2, DISP.top + DISP.height / 2);
  ok(Math.abs(p.x - cv.width / 2) < 0.5, 'the centre maps to the middle of the backing store (' + Math.round(p.x) + ' vs ' + cv.width / 2 + ')');
  ok(Math.abs(p.y - cv.height / 2) < 0.5, 'vertically too (' + Math.round(p.y) + ' vs ' + cv.height / 2 + ')');

  // Bottom-right — where the error is worst, and where the report came from.
  p = tap(DISP.left + DISP.width, DISP.top + DISP.height);
  ok(Math.abs(p.x - cv.width) < 0.5, 'the far corner maps to the far corner horizontally (' + Math.round(p.x) + ' vs ' + cv.width + ')');
  ok(Math.abs(p.y - cv.height) < 0.5, 'and vertically (' + Math.round(p.y) + ' vs ' + cv.height + ')');

  // The unscaled version would have landed 150px short vertically at the bottom edge.
  const naive = DISP.height;
  ok(Math.abs(p.y - naive) > 100, 'and it is genuinely different from the unscaled answer (' +
     Math.round(p.y) + ' vs the old ' + naive + ')');
}

head('the mapping still holds when the two sizes agree');
{
  cv.width = DISP.width; cv.height = DISP.height;
  const p = tap(DISP.left + 123, DISP.top + 456);
  ok(Math.abs(p.x - 123) < 0.01 && Math.abs(p.y - 456) < 0.01,
     'a 1:1 canvas is unaffected by the scaling — got ' + p.x + ',' + p.y);
}

head('camera and zoom still compose correctly');
{
  cv.width = 1000; cv.height = 750;
  g.camera.x = 500; g.camera.y = 400; g.camera.z = 1;
  tap(DISP.left + DISP.width / 2, DISP.top + DISP.height / 2);
  const world = RC.Input.state.world;
  ok(Math.abs(world.x - (500 + cv.width / 2)) < 1, 'world x accounts for the camera (' + Math.round(world.x) + ')');
  ok(Math.abs(world.y - (400 + cv.height / 2)) < 1, 'world y accounts for the camera (' + Math.round(world.y) + ')');
}

// ── The canvas is kept the same size as the box it is drawn in ─────────────
head('resize() keeps the backing store matching the display box');
{
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  ok(/getBoundingClientRect\(\)/.test(main.slice(main.indexOf('function resize()'), main.indexOf('function resize()') + 500)),
     'resize() measures the real rect, not the rounded clientWidth/clientHeight');
  ok(main.indexOf('ResizeObserver') > 0,
     'a ResizeObserver re-fits on stage changes that fire no window resize (address bar, fullscreen)');
}

console.log('\n' + (fail ? '✖ ' : '✔ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
