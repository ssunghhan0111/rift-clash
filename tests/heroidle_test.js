// Menu hero test — RC.Renderer.drawHeroIdle()
// ---------------------------------------------------------------------------
// The start-screen hero goes through the SAME drawUnitSprite() path as an in-match
// unit, which is exactly how the race-face portraits broke the menu once before: a
// palette missing `opticRGB` reaches softGlow() as the literal string
// 'rgba(undefined,1)', addColorStop rejects it with a SyntaxError, and because the
// portraits are built during menu construction the global error boundary swallowed
// the whole start screen. See raceFaceColors() in renderer.js.
//
// So this test does not check that the hero *looks* right — it checks the two things
// that turn a drawing bug into a blank game:
//   1. every colour handed to canvas is a syntactically valid colour (canvas silently
//      ignores a bad fillStyle but THROWS on a bad addColorStop, so a bad colour can
//      hide for a long time and then kill a frame)
//   2. every coordinate is finite (a NaN angle from the wave maths would poison the
//      transform for everything drawn after it)
//
// Runs headless with a recording 2D-context stub — no browser, no canvas package.
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + m); } };

// ── Colour validation ──────────────────────────────────────────────────────
// Deliberately strict: anything that is not a hex triple/quad, an rgb()/rgba() with
// finite numbers, or a CanvasGradient is a failure. 'undefined' and 'NaN' inside an
// rgba() are the two shapes that have actually shipped.
const BAD = [];
function checkColor(v, where) {
  if (v && typeof v === 'object' && v.__gradient) return v;    // gradients checked at their stops
  if (typeof v !== 'string') { BAD.push(where + ': non-string ' + String(v)); return v; }
  if (/undefined|NaN|null/i.test(v)) { BAD.push(where + ': ' + v); return v; }
  const okHex = /^#[0-9a-f]{3,8}$/i.test(v);
  const okFn = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/i.test(v);
  if (!okHex && !okFn) BAD.push(where + ': unparseable "' + v + '"');
  return v;
}
function checkNums(name, args) {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) { BAD.push(name + ': non-finite arg'); return; }
  }
}

function makeGradient() {
  return { __gradient: true, addColorStop: (o, c) => { checkNums('addColorStop', [o]); checkColor(c, 'addColorStop'); } };
}

function makeCtx() {
  const c = {
    canvas: null,
    _fill: '#000', _stroke: '#000',
    get fillStyle() { return this._fill; },
    set fillStyle(v) { this._fill = checkColor(v, 'fillStyle'); },
    get strokeStyle() { return this._stroke; },
    set strokeStyle(v) { this._stroke = checkColor(v, 'strokeStyle'); },
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '', textAlign: 'left',
    textBaseline: 'alphabetic', shadowBlur: 0, shadowColor: '#000',
    filter: 'none', imageSmoothingEnabled: true, lineDashOffset: 0,
    createRadialGradient() { checkNums('createRadialGradient', arguments); return makeGradient(); },
    createLinearGradient() { checkNums('createLinearGradient', arguments); return makeGradient(); },
    createPattern() { return makeGradient(); },
    measureText() { return { width: 10 }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
    putImageData() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
    setLineDash() {}, getLineDash() { return []; },
    setTransform() {}, resetTransform() {}, getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    isPointInPath() { return false; },
  };
  // Every geometry call records nothing but validates its numbers.
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke', 'clip',
                   'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
                   'quadraticCurveTo', 'bezierCurveTo', 'translate', 'rotate', 'scale',
                   'transform', 'fillRect', 'strokeRect', 'clearRect', 'fillText',
                   'strokeText', 'drawImage']) {
    c[m] = function () { checkNums(m, arguments); };
  }
  return c;
}

function makeCanvas(w, h) {
  const ctx = makeCtx();
  const cv = {
    width: w, height: h, style: {}, isConnected: true,
    getContext: () => ctx,
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h }),
  };
  ctx.canvas = cv;
  return cv;
}

// ── Minimal browser globals ────────────────────────────────────────────────
global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0;
global.document = {
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(64, 64) : { style: {}, appendChild() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {}, style: {} },
};

require(path.join(__dirname, '..', 'config.js'));
require(path.join(__dirname, '..', 'renderer.js'));

const RC = global.RC;

console.log('menu hero (drawHeroIdle)');

ok(!!(RC.Renderer && RC.Renderer.drawHeroIdle), 'RC.Renderer.drawHeroIdle is exported');

if (RC.Renderer && RC.Renderer.drawHeroIdle) {
  const HEROES = Object.keys(RC.UNITS).filter(k => RC.UNITS[k].hero);
  ok(HEROES.length >= 3, 'found the hero roster (got ' + HEROES.length + ')');

  // Every hero against every race, because decoupling the two is the point: a hero
  // must survive being drawn in a race palette it was never designed for.
  const RACES = RC.RACE_ORDER || Object.keys(RC.RACES);
  let combos = 0;
  for (const hid of HEROES) {
    for (const rid of RACES) {
      const cv = makeCanvas(312, 312);
      // Sample the whole 5.2s wave cycle rather than one frame — the arm angles are
      // time-driven, and a NaN that only appears at the top of the raise is exactly
      // the kind of thing a single-frame test waves through.
      for (let i = 0; i < 60; i++) {
        const t = i * 0.09;
        global.performance.now = () => t * 1000;
        try {
          RC.Renderer.drawHeroIdle(cv, hid, rid);
        } catch (e) {
          BAD.push(hid + '/' + rid + ' @t=' + t.toFixed(2) + ' threw: ' + e.message);
          break;
        }
      }
      combos++;
    }
  }
  ok(combos === HEROES.length * RACES.length, 'drew every hero x race combination (' + combos + ')');

  // Unknown ids must be inert, not fatal. The stored hero pick comes from
  // localStorage, so a stale or hand-edited value has to degrade to "draw nothing".
  const cv2 = makeCanvas(120, 120);
  let threw = false;
  try {
    RC.Renderer.drawHeroIdle(cv2, 'nosuchhero', 'forge');
    RC.Renderer.drawHeroIdle(cv2, 'rook', 'nosuchrace');
    RC.Renderer.drawHeroIdle(null, 'rook', 'forge');
  } catch (e) { threw = true; console.log('  (threw: ' + e.message + ')'); }
  ok(!threw, 'unknown hero / unknown race / null canvas are all no-ops, not throws');

  ok(BAD.length === 0, 'no invalid colours or non-finite coordinates');
  if (BAD.length) {
    const seen = new Set();
    for (const b of BAD) { if (!seen.has(b) && seen.size < 12) { seen.add(b); console.log('    · ' + b); } }
    if (BAD.length > seen.size) console.log('    · … and ' + (BAD.length - seen.size) + ' more');
  }
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
