// RIFT CLASH — Crystal Guard first-run coach (browser only)
// ---------------------------------------------------------------------------
// Crystal Guard's best mechanic is the one nobody is told about: DRAG lays a whole
// row of wall in a single gesture. A child who never discovers it places blocks
// one at a time, concludes castle-building is slow, and plays the mode as a shop
// with a health bar — which is exactly the thing kids.js was written to avoid.
//
// So it is taught, once, by showing it. A translucent hand traces the gesture over
// the real screen while the game carries on underneath. Nothing here blocks input:
// every step ADVANCES when the player does the thing themselves, and each one also
// times out, so a child who ignores the hand entirely is never stuck behind it and
// a child who was already mid-action is not interrupted twice.
//
// Design rules this file holds itself to:
//   · No modal. A dialog that must be dismissed is a wall between a kid and a game.
//   · No text-only step. Every step is a picture, a gesture, or both; the sentence
//     is support, and it is read aloud when RC.KidVoice is on.
//   · Shows ONCE, keyed in localStorage, and is replayable from the start screen.
//   · Skippable at all times, by one clearly-labelled button.
//   · Never fatal. Any missing element, absent module or thrown error ends the
//     coach silently and leaves the game exactly as it was.
window.RC = window.RC || {};

RC.KidCoach = (function () {
  const KEY = 'riftclash_coached';
  let root = null, hand = null, bubble = null, ring = null;
  let step = 0, timer = null, raf = null, running = false;
  let onDone = null;

  function seen() {
    try { return window.localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { window.localStorage.setItem(KEY, '1'); } catch (e) {}
  }
  function reset() {
    try { window.localStorage.removeItem(KEY); } catch (e) {}
  }

  const CSS = `
#kid-coach { position:absolute; inset:0; z-index:55; pointer-events:none;
             font-family:inherit; display:none; }
#kid-coach.on { display:block; }

/* The hand. A big soft pointer that is obviously a demonstration rather than a
   real cursor — filled, ringed, and slightly transparent so the thing it is
   pointing at is never hidden by the thing pointing at it. */
#kc-hand { position:absolute; width:58px; height:58px; margin:-29px 0 0 -29px;
           font-size:44px; line-height:58px; text-align:center;
           filter:drop-shadow(0 4px 12px rgba(0,0,0,.7));
           opacity:0; transition:opacity .3s; will-change:transform; }
#kc-hand.on { opacity:.92; }
#kc-hand.press { transform:scale(.82); }

/* The trail the hand leaves while dragging — this is the part that actually
   communicates "one gesture, a whole row" rather than "several taps". */
#kc-trail { position:absolute; height:16px; margin-top:-8px; border-radius:9px;
            background:linear-gradient(90deg, rgba(127,233,255,0), rgba(127,233,255,.75));
            box-shadow:0 0 18px rgba(127,233,255,.55); opacity:0;
            transition:opacity .25s; pointer-events:none; }
#kc-trail.on { opacity:1; }

/* Highlight ring, for steps that point at a button rather than at the ground. */
#kc-ring { position:absolute; border-radius:16px; border:4px solid #ffd24a;
           box-shadow:0 0 0 4px rgba(255,210,74,.22), 0 0 26px rgba(255,210,74,.5);
           opacity:0; transition:opacity .25s, all .25s; pointer-events:none; }
#kc-ring.on { opacity:1; animation:kc-pulse 1.5s ease-in-out infinite; }
@keyframes kc-pulse { 0%,100% { box-shadow:0 0 0 4px rgba(255,210,74,.22), 0 0 26px rgba(255,210,74,.5); }
                      50%     { box-shadow:0 0 0 10px rgba(255,210,74,.06), 0 0 34px rgba(255,210,74,.7); } }

/* The sentence. Bottom-centre, above the dock, never over the play area a child
   is being asked to touch. */
#kc-bubble { position:absolute; left:50%; transform:translateX(-50%);
             bottom:min(28vh, 240px); max-width:min(560px, 88vw);
             background:rgba(10,16,26,.93); border:3px solid #7fe9ff;
             border-radius:20px; padding:15px 22px; color:#eaf2ff;
             font-size:19px; font-weight:800; line-height:1.35; text-align:center;
             box-shadow:0 16px 44px rgba(0,0,0,.6); opacity:0;
             transition:opacity .3s, transform .3s; pointer-events:auto; }
#kc-bubble.on { opacity:1; }
#kc-bubble .ic { font-size:30px; display:block; margin-bottom:4px; }
#kc-skip { display:inline-block; margin-top:11px; background:rgba(255,255,255,.09);
           color:#9fb4d0; border:1px solid rgba(255,255,255,.18); border-radius:999px;
           padding:7px 18px; font-family:inherit; font-size:13px; font-weight:700;
           cursor:pointer; }
#kc-skip:hover { background:rgba(255,255,255,.16); color:#eaf2ff; }

@media (max-width: 620px) {
  #kc-bubble { font-size:16px; padding:12px 16px; bottom:min(30vh, 200px); }
  #kc-hand { font-size:36px; }
}`;

  function build() {
    if (root) return true;
    try {
      if (!document.getElementById('kid-coach-css')) {
        const st = document.createElement('style');
        st.id = 'kid-coach-css';
        st.textContent = CSS;
        document.head.appendChild(st);
      }
      root = document.createElement('div');
      root.id = 'kid-coach';
      root.innerHTML =
        '<div id="kc-trail"></div>' +
        '<div id="kc-hand">👆</div>' +
        '<div id="kc-ring"></div>' +
        '<div id="kc-bubble"><span class="ic"></span><span class="tx"></span>' +
        '<br><button id="kc-skip" type="button">Skip</button></div>';
      const stage = document.getElementById('stage') || document.body;
      stage.appendChild(root);
      hand = root.querySelector('#kc-hand');
      bubble = root.querySelector('#kc-bubble');
      ring = root.querySelector('#kc-ring');
      root.querySelector('#kc-skip').addEventListener('click', ev => {
        ev.preventDefault(); ev.stopPropagation();
        finish();
      });
      return true;
    } catch (e) { return false; }
  }

  // ── Primitives ────────────────────────────────────────────────────────────
  function say(icon, text) {
    if (!bubble) return;
    bubble.querySelector('.ic').textContent = icon || '';
    bubble.querySelector('.tx').textContent = text || '';
    bubble.classList.add('on');
    // Read aloud rides on the same switch the reward cards use, so a child who
    // turned it on for the cards gets the tutorial spoken too, and one who did
    // not is not talked at.
    if (RC.KidVoice && RC.KidVoice.enabled()) RC.KidVoice.speak(text);
  }
  function hideBubble() { if (bubble) bubble.classList.remove('on'); }

  function ringAt(el) {
    if (!ring) return;
    if (!el) { ring.classList.remove('on'); return; }
    try {
      const stage = document.getElementById('stage') || document.body;
      const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
      if (!r.width || !r.height) { ring.classList.remove('on'); return; }
      ring.style.left = (r.left - s.left - 6) + 'px';
      ring.style.top = (r.top - s.top - 6) + 'px';
      ring.style.width = (r.width + 12) + 'px';
      ring.style.height = (r.height + 12) + 'px';
      ring.classList.add('on');
    } catch (e) { ring.classList.remove('on'); }
  }

  // Animate the hand from a to b over `ms`, optionally drawing the drag trail.
  // Positions are fractions of the stage (0..1) so this survives any screen size
  // without knowing anything about the map or the camera.
  function sweep(a, b, ms, dragging, done) {
    const stage = document.getElementById('stage') || document.body;
    const W = stage.clientWidth || window.innerWidth;
    const H = stage.clientHeight || window.innerHeight;
    const x0 = a[0] * W, y0 = a[1] * H, x1 = b[0] * W, y1 = b[1] * H;
    const trail = root.querySelector('#kc-trail');
    const t0 = (window.performance || Date).now();
    hand.classList.add('on');
    if (dragging) {
      hand.classList.add('press');
      trail.style.left = x0 + 'px';
      trail.style.top = y0 + 'px';
      trail.style.width = '0px';
      trail.classList.add('on');
    }
    cancelAnimationFrame(raf);
    (function tick() {
      const t = Math.min(1, ((window.performance || Date).now() - t0) / ms);
      // ease-in-out, so the gesture reads as deliberate rather than mechanical
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
      hand.style.transform = 'translate(' + x + 'px,' + y + 'px)' +
                             (dragging ? ' scale(.82)' : '');
      if (dragging) trail.style.width = Math.abs(x - x0) + 'px';
      if (t < 1 && running) raf = requestAnimationFrame(tick);
      else {
        hand.classList.remove('press');
        if (dragging) setTimeout(() => { trail.classList.remove('on'); }, 450);
        if (done) done();
      }
    })();
  }

  function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

  // ── The script ────────────────────────────────────────────────────────────
  // Each step: what to say, what to demonstrate, what counts as "they did it",
  // and how long to wait before moving on anyway. `check` is polled; returning
  // true advances immediately, which is what makes this feel like a nudge rather
  // than a cutscene.
  function steps(g) {
    const shopBtn = () => document.querySelector('#kid-shop .kid-bb');
    const buildTab = () => document.querySelector('.kid-tab[data-focus="builder"]');
    const wallBtn = () => document.querySelector('#kid-build .kid-bb');
    const myUnits = () => {
      try { return (g.units || []).filter(u => u.owner === g.playerOwner && !u.dead && !u.def.worker).length; }
      catch (e) { return 0; }
    };
    const myWalls = () => {
      try { return (g.buildings || []).filter(b => b.owner === g.playerOwner && !b.dead).length; }
      catch (e) { return 0; }
    };
    let unitsAtStart = 0, wallsAtStart = 0;

    return [
      {
        ic: '💎', tx: 'This is your crystal. Keep it safe!',
        ms: 4200,
        show() { ringAt(document.getElementById('kid-crystal')); },
      },
      {
        ic: '⚔️', tx: 'Tap a fighter to buy one. They protect the crystal for you.',
        ms: 9000,
        show() { unitsAtStart = myUnits(); ringAt(shopBtn()); },
        check() { return myUnits() > unitsAtStart; },
      },
      {
        ic: '🔨', tx: 'Now tap Build.',
        ms: 8000,
        show() { ringAt(buildTab()); },
        check() { return !!wallBtn(); },
      },
      {
        ic: '🧱', tx: 'Pick a wall — then DRAG to build a whole row at once!',
        ms: 12000,
        show() {
          wallsAtStart = myWalls();
          ringAt(wallBtn());
          // The gesture itself, looped until they do it. This is the one thing
          // this whole file exists to convey.
          const loop = () => {
            if (!running || step !== 3) return;
            sweep([0.34, 0.46], [0.62, 0.46], 1500, true, () => {
              timer = setTimeout(loop, 900);
            });
          };
          timer = setTimeout(loop, 700);
        },
        check() { return myWalls() > wallsAtStart + 1; },
      },
      {
        ic: '🎉', tx: 'You built a wall! Press Ready when your castle is finished.',
        ms: 5200,
        show() { ringAt(document.getElementById('kid-daybtn')); },
      },
    ];
  }

  function runStep(g, list) {
    if (!running) return;
    if (step >= list.length) { finish(); return; }
    const s = list[step];
    hideBubble();
    ringAt(null);
    if (hand) hand.classList.remove('on');
    // A beat of nothing between steps, so two bubbles never cross-fade into each
    // other and the child's eye has somewhere to land.
    timer = setTimeout(() => {
      if (!running) return;
      say(s.ic, s.tx);
      try { if (s.show) s.show(); } catch (e) {}
      const started = Date.now();
      const poll = () => {
        if (!running) return;
        let done = false;
        try { done = !!(s.check && s.check()); } catch (e) { done = false; }
        if (done || Date.now() - started > s.ms) {
          clearTimer();
          step++;
          runStep(g, list);
          return;
        }
        timer = setTimeout(poll, 250);
      };
      timer = setTimeout(poll, 250);
    }, 380);
  }

  // ── Public ────────────────────────────────────────────────────────────────
  function start(g, opts) {
    if (running) return false;
    if (!g) return false;
    if (!(opts && opts.force) && seen()) return false;
    if (!build()) return false;
    running = true;
    step = 0;
    onDone = (opts && opts.onDone) || null;
    root.classList.add('on');
    markSeen();
    try { runStep(g, steps(g)); } catch (e) { finish(); }
    return true;
  }

  function finish() {
    running = false;
    clearTimer();
    cancelAnimationFrame(raf);
    if (RC.KidVoice) RC.KidVoice.cancel();
    if (root) root.classList.remove('on');
    if (hand) hand.classList.remove('on');
    if (ring) ring.classList.remove('on');
    hideBubble();
    const f = onDone; onDone = null;
    if (f) { try { f(); } catch (e) {} }
  }

  return { start, finish, seen, reset, get running() { return running; } };
})();
