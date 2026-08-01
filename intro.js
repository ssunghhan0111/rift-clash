// intro.js — RIFT CLASH: "The Rift"
// ─────────────────────────────────────────────────────────────────────────────
// The introduction film. ~2:40, wordless except for hero name cards, shown once
// the very first time a player commits a name, and re-playable forever after
// from the button in the start-screen footer.
//
// Why it exists: a new player arrives at a screen with three factions, five
// heroes, six building types and twenty-odd units, and no idea why any of it
// matters. The film answers the only question that makes the rest land — *what
// are we fighting over* — and then shows, from inside each hero's own eyes, the
// loop the game is actually made of: mine shards → raise buildings → train an
// army → point it at the enemy → spend your signature at the moment it counts.
//
// Deliberate choices, and what they cost:
//
//  · **First person.** A top-down RTS teaches "you are a cursor". The film
//    teaches "you are the hero standing in front of the crystal", which is the
//    feeling the hero system is trying to sell. The cost is that first person
//    hides the army, so every chapter has a beat where the hero *turns to look
//    at its own base* — that turn is doing the exposition a narrator would.
//
//  · **No subtitles, no narration.** Reading is a wall for the youngest players
//    and localisation is a wall for everyone else. Everything is carried by
//    image, colour and score. The only text is a hero's name and title, which
//    is a credit rather than a line of dialogue.
//
//  · **three.js, vendored.** The rest of the game is hand-rolled 2D canvas with
//    zero dependencies, and that is worth protecting — but hand-rolling a
//    software 3D renderer good enough for this would be more code than the film
//    itself. `vendor/three.min.js` is checked in rather than pulled from a CDN
//    so the game still runs from `file://` and on a plane, and it is loaded
//    lazily: a player who never watches the film never downloads the 600KB.
//    If the load fails for any reason the film is skipped, never blocked on.
//
//  · **No post-processing.** The core three.js build has no EffectComposer, so
//    bloom is faked with additive sprites parented to anything that glows, and
//    the grade and vignette are a CSS layer over the canvas. Both are cheaper
//    than the real thing on the tablets this game is actually played on.
//
// Everything here is namespaced under RC.Intro and touches no game state.
window.RC = window.RC || {};

RC.Intro = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  const SEEN_KEY = 'riftclash_intro_seen';   // '1' once the film has been watched
  const THREE_SRC = 'vendor/three.min.js';

  // Faction tints, kept in step with RC.RACES so a colour change lands in both
  // the film and the game from one edit.
  function raceTint(id, fallback) {
    const r = (window.RC.RACES && window.RC.RACES[id]) || null;
    return (r && r.tint) || fallback;
  }

  const PAL = {
    get forge()  { return raceTint('forge',  '#f08a2a'); },
    get gloop()  { return raceTint('gloop',  '#5ddc7a'); },
    get aether() { return raceTint('aether', '#b98cff'); },
    crystal: '#7fe9ff',
    crystalDim: '#2d5a6b',
    shard: '#7fe9ff',
    rift: '#c0304f',
    riftDark: '#3a0a18',
    ember: '#ff7a2a',
    vale: '#6ef2b0',
    ink: '#0a0e14',
  };

  // Hero identity: the colour its chapter is graded toward, the name card, and
  // the one-line job. Titles match RC.UNITS[hero].title so the film and the
  // hero overview never disagree about who someone is.
  const HEROES = [
    { id: 'rook',  name: 'ROOK',  title: 'THE ANCHOR',  tint: '#4fb3ff', race: 'forge'  },
    { id: 'thorn', name: 'THORN', title: 'THE REAPER',  tint: '#7fe06a', race: 'gloop'  },
    { id: 'prism', name: 'PRISM', title: 'THE WEAVER',  tint: '#c79bff', race: 'aether' },
    { id: 'ember', name: 'EMBER', title: 'THE KINDLER', tint: '#ff8a3a', race: 'forge'  },
    { id: 'vale',  name: 'VALE',  title: 'THE MENDER',  tint: '#6ef2b0', race: 'aether' },
  ];

  // ── three.js: loaded once, lazily, and never fatally ───────────────────────

  let threePromise = null;
  function ensureThree() {
    if (window.THREE) return Promise.resolve(true);
    if (threePromise) return threePromise;
    threePromise = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = THREE_SRC;
      s.async = true;
      s.onload = () => resolve(!!window.THREE);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      // A hung request must not hang the film forever — a player staring at a
      // black screen has no way to know whether to wait or reload.
      setTimeout(() => resolve(!!window.THREE), 12000);
    });
    return threePromise;
  }

  // ── Small maths ────────────────────────────────────────────────────────────

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, u) => a + (b - a) * u;
  const smooth = u => u * u * (3 - 2 * u);
  const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);
  // 0 before `a`, 1 after `b`, eased between — the workhorse of every beat in
  // the film, because a beat is nearly always "this thing happens over there".
  const win = (t, a, b) => smooth(clamp((t - a) / Math.max(1e-4, b - a), 0, 1));
  // A single pulse: rises over `rise`, holds, falls. For flashes and impacts.
  function pulse(t, at, rise, fall) {
    if (t < at) return 0;
    const d = t - at;
    if (d < rise) return smooth(d / rise);
    if (d < rise + fall) return 1 - smooth((d - rise) / fall);
    return 0;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // A camera move written as keyframes: position, look-at target, and an
  // optional field of view. Everything in the film that is not hand-animated
  // is one of these, because a cut is cheap and a bad interpolation is not.
  function keyed(keys) {
    const look = new THREE.Vector3();
    return function (cam, time) {
      let i = 0;
      while (i < keys.length - 1 && time > keys[i + 1].t) i++;
      const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
      const span = Math.max(1e-4, b.t - a.t);
      let u = clamp((time - a.t) / span, 0, 1);
      u = a.linear ? u : smoother(u);
      cam.position.set(lerp(a.p[0], b.p[0], u), lerp(a.p[1], b.p[1], u), lerp(a.p[2], b.p[2], u));
      look.set(lerp(a.l[0], b.l[0], u), lerp(a.l[1], b.l[1], u), lerp(a.l[2], b.l[2], u));
      cam.lookAt(look);
      const fa = a.fov != null ? a.fov : 60;
      const fb = b.fov != null ? b.fov : fa;
      if (Math.abs(cam.fov - lerp(fa, fb, u)) > 0.01) {
        cam.fov = lerp(fa, fb, u);
        cam.updateProjectionMatrix();
      }
    };
  }

  // ── The score ──────────────────────────────────────────────────────────────
  //
  // Its own AudioContext rather than a hook into RC.Audio: the game's audio
  // module is a sound-effect bank with a background arpeggio, and a film needs
  // a bed that changes key on a cut. It reads RC.Audio's mute and volume so
  // there is still exactly one place a player turns the sound off.
  function makeScore() {
    let ac = null, master = null, running = false;
    let root = 196, mood = 'calm', beat = 0, next = 0, tempo = 0.5;

    function vol() {
      const A = window.RC.Audio;
      if (A && A.enabled === false) return 0;
      const v = A && A.getVolume ? A.getVolume() : 0.7;
      return clamp(v, 0, 1) * 0.85;
    }

    function start() {
      if (ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = vol();
        master.connect(ac.destination);
        if (ac.state === 'suspended') ac.resume().catch(() => {});
        running = true;
        next = ac.currentTime + 0.1;
      } catch (e) { ac = null; }
    }

    function note(f, dur, type, gain, when, opts) {
      if (!ac || !running) return;
      opts = opts || {};
      const t0 = when != null ? when : ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t0);
      if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
      if (opts.detune) o.detune.setValueAtTime(opts.detune, t0);
      const atk = opts.attack != null ? opts.attack : 0.02;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let tail = g;
      if (opts.lp) {
        const f2 = ac.createBiquadFilter();
        f2.type = 'lowpass';
        f2.frequency.setValueAtTime(opts.lp, t0);
        if (opts.lpTo) f2.frequency.exponentialRampToValueAtTime(Math.max(40, opts.lpTo), t0 + dur);
        g.connect(f2); tail = f2;
      }
      o.connect(g); tail.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }

    function noise(dur, gain, opts) {
      if (!ac || !running) return;
      opts = opts || {};
      const t0 = opts.when != null ? opts.when : ac.currentTime;
      const n = Math.max(1, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, n, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = ac.createBufferSource(); src.buffer = buf;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + (opts.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      let head = src, tail = g;
      if (opts.hp) { const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = opts.hp; head.connect(f); head = f; }
      if (opts.lp) {
        const f = ac.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(opts.lp, t0);
        if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.lpTo), t0 + dur);
        head.connect(f); head = f;
      }
      head.connect(g); tail.connect(master);
      src.start(t0); src.stop(t0 + dur + 0.05);
    }

    // Beat scheduler with a lookahead, so the bed does not stutter when a frame
    // runs long — which it will, on the frame a chapter builds its scene.
    function tick() {
      if (!ac || !running) return;
      master.gain.value = vol();
      const now = ac.currentTime;
      while (next < now + 0.35) {
        const t = next, b = beat % 16;
        const M = { calm: [0, 3, 7, 10], drive: [0, 3, 7, 12], bright: [0, 4, 7, 11], dark: [0, 1, 5, 8] }[mood] || [0, 3, 7, 10];
        const st = s => root * Math.pow(2, s / 12);
        if (b % 8 === 0) {                                  // chord bloom
          note(st(M[0]) / 2, tempo * 7, 'sine', 0.055, t, { attack: 0.5, lp: 700 });
          note(st(M[1]), tempo * 6.4, 'triangle', 0.030, t + 0.02, { attack: 0.7, lp: 1300 });
          note(st(M[2]), tempo * 6.0, 'triangle', 0.024, t + 0.05, { attack: 0.9, lp: 1500 });
        }
        if (mood === 'drive' || mood === 'dark') {
          if (b % 4 === 0) noise(0.18, 0.075, { when: t, lp: 260, lpTo: 70 });     // kick
          if (b % 4 === 2) noise(0.09, 0.030, { when: t, hp: 2600, lp: 8000 });    // tick
        }
        if (b % 2 === 0) {                                  // arpeggio
          const s = M[(beat >> 1) % M.length];
          note(st(s) * 2, tempo * 1.5, 'triangle', mood === 'dark' ? 0.016 : 0.026, t, { attack: 0.03, lp: 2600 });
        }
        beat++; next += tempo;
      }
    }

    return {
      start, tick,
      set: function (o) {
        if (!o) return;
        if (o.root) root = o.root;
        if (o.mood) mood = o.mood;
        if (o.tempo) tempo = o.tempo;
      },
      bell: function (f, g) { note(f || 1046, 1.5, 'sine', g || 0.10, null, { attack: 0.01, lp: 5200 });
                              note((f || 1046) * 1.5, 1.2, 'sine', (g || 0.10) * 0.5, null, { attack: 0.02, delay: 0.03 }); },
      boom: function (g) { noise(0.7, g || 0.16, { lp: 900, lpTo: 60 });
                           note(72, 0.8, 'sine', (g || 0.16) * 0.9, null, { to: 34, attack: 0.006 }); },
      whoosh: function (d, g) { noise(d || 0.6, g || 0.09, { hp: 300, lp: 900, lpTo: 4200 }); },
      riser: function (d, g) { note(120, d || 3, 'sawtooth', g || 0.05, null, { to: 1400, attack: 1.2, lp: 800, lpTo: 4000 }); },
      hit: function (g) { noise(0.22, g || 0.11, { lp: 3200, lpTo: 400 });
                          note(180, 0.24, 'square', (g || 0.11) * 0.6, null, { to: 60 }); },
      shimmer: function (g) { for (let i = 0; i < 5; i++)
                                note(1200 + i * 340, 0.5 + i * 0.1, 'sine', (g || 0.05) / (i + 1), (ac ? ac.currentTime : 0) + i * 0.045, { attack: 0.01 }); },
      stop: function () {
        running = false;
        if (ac) { try { ac.close(); } catch (e) {} ac = null; }
      },
    };
  }

  // ── The screen: canvas, grade, letterbox, name cards, skip ─────────────────
  //
  // Everything that is not geometry is DOM. Text drawn into WebGL would need a
  // font atlas and would look worse than the browser's own type at every size,
  // and the grade and vignette are one composited layer here versus a render
  // pass there. The canvas does the world; the DOM does the cinema.

  const CSS = `
#rc-intro { position: fixed; inset: 0; z-index: 400; background: #000; overflow: hidden;
  font-family: var(--sans, system-ui, sans-serif); -webkit-user-select: none; user-select: none;
  opacity: 0; transition: opacity .45s ease; }
#rc-intro.on { opacity: 1; }
#rc-intro canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
/* Grade + vignette. Multiply darkens the corners, screen lifts the centre — the
   two together are most of why the flat-shaded geometry reads as film. */
#rc-intro .grade { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 45%, rgba(255,255,255,.018) 0%, rgba(0,0,0,0) 42%, rgba(0,0,0,.30) 78%, rgba(0,0,0,.62) 100%); }
#rc-intro .tone { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light;
  opacity: .5; transition: background .9s ease; background: #4fb3ff; }
/* Letterbox. Not decoration: it crops the frame to a shape that reads as "watch
   this" rather than "play this", which is the whole contract of an intro. */
#rc-intro .bar { position: absolute; left: 0; right: 0; height: 8.5vh; background: #000; z-index: 3;
  transition: height .6s cubic-bezier(.2,.8,.2,1); }
#rc-intro .bar.top { top: 0; } #rc-intro .bar.bot { bottom: 0; }
#rc-intro .flash { position: absolute; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 2; }
#rc-intro .fade { position: absolute; inset: 0; background: #000; opacity: 1; pointer-events: none; z-index: 4; }

/* Name card. Mono and wide-tracked to match #ss-title, so the film and the
   front page are obviously the same product. */
#rc-intro .card { position: absolute; left: 0; right: 0; bottom: 15vh; text-align: center; z-index: 5;
  pointer-events: none; opacity: 0; }
#rc-intro .card .nm { font-family: var(--mono, ui-monospace, monospace); font-weight: 700;
  font-size: clamp(38px, 9vw, 104px); letter-spacing: .22em; color: #fff; margin-right: -.22em;
  text-shadow: 0 0 34px rgba(0,0,0,.85), 0 4px 0 rgba(0,0,0,.35); }
#rc-intro .card .ti { font-family: var(--mono, ui-monospace, monospace); font-weight: 700;
  font-size: clamp(11px, 2.1vw, 20px); letter-spacing: .52em; margin: 10px 0 0 .52em;
  text-shadow: 0 0 22px rgba(0,0,0,.9); }
#rc-intro .card .rule { height: 2px; width: 0; margin: 16px auto 0; border-radius: 2px; }
#rc-intro .card.show { opacity: 1; }
#rc-intro .card.show .nm { animation: rc-in .9s cubic-bezier(.16,1,.3,1) both; }
#rc-intro .card.show .ti { animation: rc-in .9s cubic-bezier(.16,1,.3,1) .12s both; }
#rc-intro .card.show .rule { animation: rc-rule 1.1s cubic-bezier(.16,1,.3,1) .2s both; }
@keyframes rc-in { from { opacity: 0; transform: translateY(26px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes rc-rule { from { width: 0; opacity: 0; } to { width: min(320px, 42vw); opacity: .9; } }

/* Logo card, finale only. */
#rc-intro .logo { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; z-index: 5; opacity: 0; pointer-events: none;
  transition: opacity 1s ease; }
#rc-intro .logo.show { opacity: 1; }
#rc-intro .logo .lg { font-family: var(--mono, ui-monospace, monospace); font-weight: 700;
  font-size: clamp(44px, 11vw, 132px); letter-spacing: .2em; color: #fff; margin-right: -.2em;
  text-shadow: 0 0 60px rgba(127,233,255,.55); }
#rc-intro .logo .lg b { color: var(--orange, #f08a2a); }

#rc-intro .skip { position: absolute; right: 18px; bottom: calc(8.5vh + 16px); z-index: 6;
  background: rgba(10,16,24,.55); color: rgba(255,255,255,.72); border: 1px solid rgba(255,255,255,.22);
  border-radius: 999px; padding: 9px 20px; font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: inherit; letter-spacing: .06em; backdrop-filter: blur(6px); transition: all .18s ease; }
#rc-intro .skip:hover { background: rgba(255,255,255,.92); color: #0a0e14; border-color: transparent; }
/* Progress hairline: a two-and-a-half minute film with no scrubber needs to say
   how much is left, or a restless player skips out of uncertainty rather than
   boredom. */
#rc-intro .prog { position: absolute; left: 0; bottom: 8.5vh; height: 2px; z-index: 6;
  background: linear-gradient(90deg, rgba(255,255,255,.15), rgba(255,255,255,.75)); width: 0; }
#rc-intro .load { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,.5); font-size: 13px; letter-spacing: .3em; z-index: 7; }
#rc-intro .load.gone { display: none; }
@media (max-width: 640px) { #rc-intro .bar { height: 6vh; } #rc-intro .prog { bottom: 6vh; }
  #rc-intro .skip { bottom: calc(6vh + 12px); right: 12px; padding: 8px 16px; font-size: 12px; } }
`;

  function buildScreen() {
    if (!document.getElementById('rc-intro-css')) {
      const st = document.createElement('style');
      st.id = 'rc-intro-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const root = document.createElement('div');
    root.id = 'rc-intro';
    root.innerHTML =
      '<canvas></canvas>' +
      '<div class="grade"></div><div class="tone"></div>' +
      '<div class="flash"></div>' +
      '<div class="card"><div class="nm"></div><div class="ti"></div><div class="rule"></div></div>' +
      '<div class="logo"><div class="lg">RIFT<b>CLASH</b></div></div>' +
      '<div class="bar top"></div><div class="bar bot"></div>' +
      '<div class="prog"></div>' +
      '<button class="skip" type="button">Skip ✕</button>' +
      '<div class="fade"></div>' +
      '<div class="load">LOADING</div>';
    document.body.appendChild(root);
    return {
      root: root,
      canvas: root.querySelector('canvas'),
      tone: root.querySelector('.tone'),
      flash: root.querySelector('.flash'),
      fade: root.querySelector('.fade'),
      card: root.querySelector('.card'),
      cardNm: root.querySelector('.card .nm'),
      cardTi: root.querySelector('.card .ti'),
      cardRule: root.querySelector('.card .rule'),
      logo: root.querySelector('.logo'),
      prog: root.querySelector('.prog'),
      skip: root.querySelector('.skip'),
      load: root.querySelector('.load'),
    };
  }

  // ── Textures, made in a canvas, made once ──────────────────────────────────

  const TEX = {};
  function radial(stops, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size || 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width / 2);
    stops.forEach(s => grd.addColorStop(s[0], s[1]));
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }
  function initTex() {
    if (TEX.glow) return;
    TEX.glow  = radial([[0, 'rgba(255,255,255,1)'], [0.22, 'rgba(255,255,255,.72)'], [0.55, 'rgba(255,255,255,.16)'], [1, 'rgba(255,255,255,0)']], 128);
    TEX.spark = radial([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']], 64);
    TEX.soft  = radial([[0, 'rgba(255,255,255,.55)'], [0.6, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']], 128);
    // A blob shadow. Real shadow maps cost more than they buy at this art
    // level — what the eye actually wants is proof a thing is touching ground.
    TEX.shadow = radial([[0, 'rgba(0,0,0,.55)'], [0.55, 'rgba(0,0,0,.26)'], [1, 'rgba(0,0,0,0)']], 128);
  }

  // ── The kit ────────────────────────────────────────────────────────────────
  //
  // Every solid in the film is one of six primitives with flat shading and a
  // Lambert material. Flat shading is the entire art direction: it gives chunky
  // readable facets at any distance, it is kind to a tablet GPU, and it means a
  // building and a unit that were never drawn by the same hand still look like
  // they belong to the same world.

  const MAT_CACHE = new Map();
  function mat(color, opts) {
    opts = opts || {};
    const key = color + '|' + (opts.emissive || '') + '|' + (opts.ei || 0) + '|' + (opts.opacity != null ? opts.opacity : 1) + '|' + (opts.flat === false ? 0 : 1);
    let m = MAT_CACHE.get(key);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(opts.emissive || '#000000'),
      emissiveIntensity: opts.ei != null ? opts.ei : 1,
      flatShading: opts.flat !== false,
      transparent: opts.opacity != null && opts.opacity < 1,
      opacity: opts.opacity != null ? opts.opacity : 1,
      side: opts.side || THREE.FrontSide,
    });
    MAT_CACHE.set(key, m);
    return m;
  }
  // A material nothing else shares — for anything the film animates per frame.
  function ownMat(color, opts) {
    const m = mat(color, opts).clone();
    m.transparent = true;
    return m;
  }

  const GEO = {};
  function geo(key, make) { return GEO[key] || (GEO[key] = make()); }
  const gBox   = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
  const gSph   = () => geo('sph', () => new THREE.SphereGeometry(0.5, 12, 9));
  const gIco   = () => geo('ico', () => new THREE.IcosahedronGeometry(0.5, 0));
  const gCone  = () => geo('cone', () => new THREE.ConeGeometry(0.5, 1, 7));
  const gCyl   = () => geo('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 9));
  const gTube  = () => geo('tube', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, true));
  const gRing  = () => geo('ring', () => new THREE.RingGeometry(0.62, 0.8, 40));
  const gPlane = () => geo('plane', () => new THREE.PlaneGeometry(1, 1));
  const gTorus = () => geo('torus', () => new THREE.TorusGeometry(0.5, 0.08, 6, 24));
  const gTetra = () => geo('tetra', () => new THREE.TetrahedronGeometry(0.5, 0));

  function put(parent, g, m, x, y, z, sx, sy, sz) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    o.scale.set(sx != null ? sx : 1, sy != null ? sy : sx, sz != null ? sz : sx);
    if (parent) parent.add(o);
    return o;
  }
  function box(p, c, x, y, z, w, h, d, opts) { return put(p, gBox(), opts && opts.own ? ownMat(c, opts) : mat(c, opts), x, y, z, w, h, d); }
  function sph(p, c, x, y, z, r, opts) { return put(p, gSph(), opts && opts.own ? ownMat(c, opts) : mat(c, opts), x, y, z, r * 2, r * 2, r * 2); }
  function cyl(p, c, x, y, z, r, h, opts) { return put(p, gCyl(), opts && opts.own ? ownMat(c, opts) : mat(c, opts), x, y, z, r * 2, h, r * 2); }
  function cone(p, c, x, y, z, r, h, opts) { return put(p, gCone(), opts && opts.own ? ownMat(c, opts) : mat(c, opts), x, y, z, r * 2, h, r * 2); }
  function ico(p, c, x, y, z, r, opts) { return put(p, gIco(), opts && opts.own ? ownMat(c, opts) : mat(c, opts), x, y, z, r * 2, r * 2, r * 2); }

  // A glow: an additive sprite, always facing the camera, that costs one quad.
  function glow(parent, color, size, opacity, tex) {
    const m = new THREE.SpriteMaterial({
      map: tex || TEX.glow, color: new THREE.Color(color),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
      transparent: true, opacity: opacity != null ? opacity : 0.85,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    if (parent) parent.add(s);
    return s;
  }
  function blobShadow(parent, size, x, z, op) {
    const m = new THREE.MeshBasicMaterial({ map: TEX.shadow, transparent: true, depthWrite: false, opacity: op != null ? op : 0.75 });
    const s = new THREE.Mesh(gPlane(), m);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x || 0, 0.06, z || 0);
    s.scale.set(size, size, 1);
    if (parent) parent.add(s);
    return s;
  }
  // Expanding ring, used for every shockwave, dome edge and pulse in the film.
  function ringFx(parent, color, op) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: op != null ? op : 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const r = new THREE.Mesh(gRing(), m);
    r.rotation.x = -Math.PI / 2;
    if (parent) parent.add(r);
    return r;
  }
  function beam(parent, color, w, h, op) {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: true, opacity: op != null ? op : 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const b = new THREE.Mesh(gTube(), m);
    b.scale.set(w, h, w);
    if (parent) parent.add(b);
    return b;
  }

  // A drifting point cloud — embers, spores, dust, snow, sparks. One draw call
  // for a few hundred particles, and the per-frame cost is a sine per point.
  function field(parent, opt) {
    const n = opt.count || 220;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = rnd(-opt.rx, opt.rx), y = rnd(opt.y0, opt.y1), z = rnd(-opt.rz, opt.rz);
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      seed[i * 3] = x; seed[i * 3 + 1] = y; seed[i * 3 + 2] = z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      map: TEX.spark, color: new THREE.Color(opt.color || '#ffffff'),
      size: opt.size || 0.5, sizeAttenuation: true, transparent: true,
      opacity: opt.opacity != null ? opt.opacity : 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const p = new THREE.Points(g, m);
    if (parent) parent.add(p);
    // Anything that drifts within `minDist` of the lens is banished below the
    // ground for that frame, where the terrain's own depth hides it. Without
    // this a single particle passing the near plane reads as a huge soft sun —
    // and it will, because the camera lives inside the field it is describing.
    const cam = opt.cam || null;
    const minD = opt.minDist != null ? opt.minDist : 11;
    const min2 = minD * minD;
    p.userData.tick = function (t) {
      const a = g.attributes.position.array;
      const rise = opt.rise || 0.6, sway = opt.sway || 0.5;
      const cx = cam ? cam.position.x : 1e9, cy = cam ? cam.position.y : 0, cz = cam ? cam.position.z : 0;
      const ox = p.position.x, oy = p.position.y, oz = p.position.z;
      for (let i = 0; i < n; i++) {
        const s = seed[i * 3], sy = seed[i * 3 + 1], sz = seed[i * 3 + 2];
        let y = sy + ((t * rise + i * 0.37) % (opt.y1 - opt.y0 + 0.001));
        if (y > opt.y1) y -= (opt.y1 - opt.y0);
        const px = s + Math.sin(t * 0.6 + i) * sway;
        const pz = sz + Math.cos(t * 0.5 + i * 1.3) * sway;
        a[i * 3] = px;
        a[i * 3 + 2] = pz;
        if (cam) {
          const dx = px + ox - cx, dy = y + oy - cy, dz = pz + oz - cz;
          a[i * 3 + 1] = (dx * dx + dy * dy + dz * dz) < min2 ? -400 : y;
        } else a[i * 3 + 1] = y;
      }
      g.attributes.position.needsUpdate = true;
    };
    return p;
  }

  // ── The world kit ──────────────────────────────────────────────────────────
  //
  // Three factions, six building shapes and five unit roles each. What matters
  // for a film that never names anything is that a *silhouette* carries the
  // meaning: Forge is boxes with corners, Gloop is blobs with spines, Aether is
  // slabs that float. A child who watches this and then plays should recognise
  // the thing they are clicking on because they saw its outline here.

  // Terrain: a plane pushed around by two sines and a hash, flat-shaded so the
  // facets read as chunky ground instead of a smooth carpet.
  function makeGround(o) {
    o = o || {};
    const size = o.size || 260, seg = o.seg || 46;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    const p = g.attributes.position;
    const amp = o.amp != null ? o.amp : 2.6, flat = o.flat != null ? o.flat : 26;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const d = Math.sqrt(x * x + y * y);
      // A flat apron in the middle so the action always has somewhere to stand.
      const k = clamp((d - flat) / 55, 0, 1);
      const h = (Math.sin(x * 0.06) * Math.cos(y * 0.055) * 1.0
               + Math.sin(x * 0.021 + 1.7) * 1.5
               + Math.cos(y * 0.017 - 0.9) * 1.3
               + (Math.sin(x * 0.31 + y * 0.27) * 0.35)) * amp;
      p.setZ(i, h * k);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(o.color || '#3f6b43'), flatShading: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    const grp = new THREE.Group();
    grp.add(mesh);
    // Scatter: rocks, and either trees or crystal spikes. Cheap depth cues that
    // stop a wide shot from reading as an empty stage.
    const n = o.scatter != null ? o.scatter : 44;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(flat + 8, size * 0.46);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (o.kind === 'spike') {
        const h = rnd(3, 11);
        const c = cone(grp, o.deco || '#5a4a86', x, h / 2, z, rnd(0.8, 2.0), h);
        c.rotation.z = rnd(-0.25, 0.25);
      } else if (o.kind === 'stalk') {
        const h = rnd(3, 9);
        cyl(grp, o.deco || '#2f6b3a', x, h / 2, z, rnd(0.35, 0.8), h);
        sph(grp, o.deco2 || '#77d878', x, h + 0.6, z, rnd(0.9, 1.8));
      } else if (o.kind === 'burnt') {
        const h = rnd(3, 8);
        const t = cyl(grp, o.deco || '#2a1f1c', x, h / 2, z, rnd(0.3, 0.7), h);
        t.rotation.z = rnd(-0.35, 0.35);
      } else {
        const h = rnd(3.5, 9);
        cyl(grp, o.deco || '#4a3628', x, h / 2, z, rnd(0.4, 0.8), h);
        const cr = rnd(2.2, 4.2);
        ico(grp, o.deco2 || '#2f7a44', x, h + cr * 0.55, z, cr);
      }
      if (i % 3 === 0) ico(grp, o.rock || '#5a5a52', rnd(-size * 0.4, size * 0.4), 0.4, rnd(-size * 0.4, size * 0.4), rnd(0.7, 2.2));
    }
    return grp;
  }

  // The Rift Crystal. The one object the whole film is about, so it is the one
  // object built out of more than four parts: a faceted core, a slow counter-
  // rotating shell, orbiting shards, a light that actually lights the scene,
  // and a glow sprite that sells the bloom the renderer has no pass for.
  function makeCrystal(scale, dim) {
    const g = new THREE.Group();
    const c = dim ? PAL.crystalDim : PAL.crystal;
    const core = ico(g, c, 0, 0, 0, 1, { emissive: c, ei: dim ? 0.2 : 0.55, own: true });
    core.scale.set(1.5, 3.4, 1.5);
    const shell = ico(g, '#cffaff', 0, 0, 0, 1, { emissive: c, ei: dim ? 0.08 : 0.3, opacity: 0.26, own: true });
    shell.scale.set(2.3, 4.3, 2.3);
    const foot = cyl(g, '#c2d2de', 0, -2.9, 0, 1.35, 0.7, { emissive: c, ei: dim ? 0.1 : 0.35 });
    const halo = ringFx(g, c, dim ? 0.2 : 0.45);
    halo.position.y = -3.1;
    halo.scale.setScalar(4.6);
    const gl = glow(g, c, dim ? 6 : 10, dim ? 0.28 : 0.5);
    const gl2 = glow(g, '#ffffff', dim ? 2.4 : 3.6, dim ? 0.22 : 0.42);
    const light = new THREE.PointLight(new THREE.Color(c), dim ? 0.35 : 1.5, 110, 2);
    light.position.y = 1;
    g.add(light);
    const shards = [];
    for (let i = 0; i < 7; i++) {
      const s = ico(g, c, 0, 0, 0, rnd(0.25, 0.5), { emissive: c, ei: 0.8, own: true });
      s.userData.a = (i / 7) * Math.PI * 2;
      s.userData.r = rnd(3.4, 5.2);
      s.userData.y = rnd(-1.2, 2.6);
      shards.push(s);
    }
    g.scale.setScalar(scale || 1);
    g.userData.tick = function (t, pulseAmt) {
      const p = 1 + Math.sin(t * 1.6) * 0.05 + (pulseAmt || 0);
      core.rotation.y = t * 0.25;
      core.scale.set(1.5 * p, 3.4 * p, 1.5 * p);
      shell.rotation.y = -t * 0.16;
      shell.rotation.x = Math.sin(t * 0.3) * 0.08;
      gl.scale.setScalar((dim ? 6 : 10) * (1 + Math.sin(t * 1.6) * 0.07 + (pulseAmt || 0) * 2));
      gl2.material.opacity = (dim ? 0.22 : 0.42) * (0.85 + Math.sin(t * 3.1) * 0.15);
      light.intensity = (dim ? 0.35 : 1.5) * (0.9 + Math.sin(t * 1.6) * 0.12) + (pulseAmt || 0) * 4;
      for (let i = 0; i < shards.length; i++) {
        const s = shards[i], a = s.userData.a + t * (0.32 + i * 0.03);
        s.position.set(Math.cos(a) * s.userData.r, s.userData.y + Math.sin(t * 0.9 + i) * 0.5, Math.sin(a) * s.userData.r);
        s.rotation.set(t * 0.8 + i, t * 0.6, 0);
      }
    };
    g.userData.core = core; g.userData.glow = gl; g.userData.light = light;
    return g;
  }

  // A shard node: what a worker mines. Same cyan as the crystal on purpose —
  // the economy is *made of* the thing you are protecting, which is a nicer
  // idea than a gold pile and takes one colour to say.
  function makeShardNode() {
    const g = new THREE.Group();
    ico(g, '#6b7a86', 0, 0.3, 0, 1.6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = ico(g, PAL.shard, Math.cos(a) * 1.1, rnd(0.9, 1.9), Math.sin(a) * 1.1, rnd(0.45, 0.8), { emissive: PAL.shard, ei: 0.75 });
      s.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    }
    glow(g, PAL.shard, 5, 0.4).position.y = 1.2;
    return g;
  }

  // ── Buildings ──────────────────────────────────────────────────────────────
  //
  // kind: core | supply | factory | air | lab | tower | wall
  // Same seven kinds for all three races, so the film can cut between factions
  // and a viewer still knows which building does what. Only the dialect changes.
  const RACE_SKIN = {
    forge:  { body: '#8d949c', dark: '#5b6169', trim: '#f08a2a', lit: '#ffd08a', eye: '#ffd08a' },
    gloop:  { body: '#4f9c5b', dark: '#2f6b3d', trim: '#9ae86a', lit: '#c6ff8a', eye: '#d9ff7a' },
    aether: { body: '#8f7fc4', dark: '#4b3f79', trim: '#b98cff', lit: '#e2d0ff', eye: '#d9c4ff' },
  };

  function makeBuilding(race, kind) {
    const S = RACE_SKIN[race] || RACE_SKIN.forge;
    const g = new THREE.Group();
    const org = race === 'gloop', air = race === 'aether';
    const tickers = [];

    function lamp(x, y, z, r) {
      const l = sph(g, S.lit, x, y, z, r || 0.4, { emissive: S.lit, ei: 1, own: true });
      const gl = glow(g, S.lit, (r || 0.4) * 4, 0.45);
      gl.position.set(x, y, z);
      tickers.push(t => {
        const k = 0.7 + Math.sin(t * 2.4 + x + z) * 0.3;
        l.material.emissiveIntensity = k;
        gl.material.opacity = 0.28 * k + 0.14;
      });
      return l;
    }

    if (kind === 'core') {
      // The base. Biggest, brightest, and the only building with a spire, so a
      // wide shot always tells you instantly where home is.
      if (org) {
        sph(g, S.dark, 0, 2.4, 0, 5.2).scale.set(1, 0.85, 1);
        sph(g, S.body, 0, 3.6, 0, 3.6);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const sp = cone(g, S.trim, Math.cos(a) * 3.4, 4.6, Math.sin(a) * 3.4, 0.6, rnd(2.4, 4.2));
          sp.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
        }
        const sac = sph(g, S.trim, 0, 6.6, 0, 1.9, { emissive: S.trim, ei: 0.5, own: true });
        tickers.push(t => { const k = 1 + Math.sin(t * 1.5) * 0.12; sac.scale.setScalar(3.8 * k); });
        lamp(0, 6.6, 0, 0.8);
      } else if (air) {
        const slab = box(g, S.body, 0, 3.6, 0, 8, 1.6, 8);
        box(g, S.dark, 0, 2.4, 0, 6.4, 1.2, 6.4);
        const ring = new THREE.Mesh(gTorus(), ownMat(S.trim, { emissive: S.trim, ei: 0.9 }));
        ring.rotation.x = Math.PI / 2; ring.scale.setScalar(11); ring.position.y = 3.6;
        g.add(ring);
        cone(g, S.trim, 0, 7.2, 0, 1.9, 5.2, { emissive: S.trim, ei: 0.35 });
        tickers.push(t => { ring.rotation.z = t * 0.5; slab.position.y = 3.6 + Math.sin(t * 0.9) * 0.22; });
        lamp(0, 9.6, 0, 0.85);
      } else {
        box(g, S.dark, 0, 1.1, 0, 10, 2.2, 10);
        box(g, S.body, 0, 3.4, 0, 8.4, 3.2, 8.4);
        box(g, S.dark, 0, 5.4, 0, 6.4, 1.2, 6.4);
        cyl(g, S.body, -2.6, 7.2, -2.6, 0.9, 5.2);
        cyl(g, S.body, 2.6, 6.4, -2.6, 0.7, 3.6);
        box(g, S.trim, 0, 3.4, 4.3, 5.2, 1.0, 0.5);
        cone(g, S.trim, 0, 7.0, 0, 2.2, 2.6);
        lamp(0, 8.6, 0, 0.75); lamp(-2.6, 9.9, -2.6, 0.4);
      }
    } else if (kind === 'supply') {
      // Population. Small, glowing, and there are always several — the film
      // uses a *row* of these to say "you had to build these to get the army".
      if (org) { const s = sph(g, S.body, 0, 1.6, 0, 1.9); sph(g, S.trim, 0, 3.0, 0, 1.1, { emissive: S.trim, ei: 0.5 });
                 tickers.push(t => s.scale.setScalar(3.8 * (1 + Math.sin(t * 2 + 1) * 0.06))); lamp(0, 3.0, 0, 0.5); }
      else if (air) { const s = box(g, S.body, 0, 2.6, 0, 2.6, 3.4, 2.6); cone(g, S.trim, 0, 0.9, 0, 1.5, 1.8, { emissive: S.trim, ei: 0.4 });
                      tickers.push(t => { s.position.y = 2.6 + Math.sin(t * 1.4) * 0.16; s.rotation.y = t * 0.3; }); lamp(0, 4.6, 0, 0.45); }
      else { box(g, S.dark, 0, 0.5, 0, 3.2, 1.0, 3.2); cyl(g, S.body, 0, 2.0, 0, 1.2, 3.0);
             cyl(g, S.trim, 0, 2.0, 0, 1.3, 1.0, { emissive: S.trim, ei: 0.55 }); lamp(0, 3.8, 0, 0.45); }
    } else if (kind === 'factory') {
      // Where the army comes from. Always has a lit doorway facing +Z, because
      // in every chapter a unit walks *out of it toward camera*.
      if (org) {
        sph(g, S.dark, 0, 1.8, 0, 3.4).scale.set(1.3, 0.9, 1.1);
        sph(g, S.body, 0, 3.2, 0, 2.3);
        for (let i = 0; i < 4; i++) cone(g, S.trim, rnd(-2, 2), 4.4, rnd(-2, 2), 0.4, rnd(1.4, 2.6));
        const mouth = box(g, S.trim, 0, 1.3, 3.3, 2.4, 2.0, 0.4, { emissive: S.trim, ei: 0.8, own: true });
        tickers.push(t => mouth.material.emissiveIntensity = 0.5 + Math.sin(t * 3) * 0.35);
      } else if (air) {
        const s = box(g, S.body, 0, 3.0, 0, 5.6, 2.4, 4.4);
        box(g, S.dark, 0, 1.2, 0, 4.4, 1.0, 3.6);
        const mouth = box(g, S.trim, 0, 2.6, 2.3, 3.0, 2.6, 0.4, { emissive: S.trim, ei: 0.9, own: true });
        tickers.push(t => { s.position.y = 3.0 + Math.sin(t * 1.1) * 0.18; mouth.material.emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.35; });
        lamp(-2.4, 4.6, 0, 0.4); lamp(2.4, 4.6, 0, 0.4);
      } else {
        box(g, S.dark, 0, 0.6, 0, 7.0, 1.2, 6.0);
        box(g, S.body, 0, 3.0, 0, 6.2, 3.6, 5.2);
        box(g, S.dark, 0, 5.2, 0, 4.6, 0.9, 4.0);
        cyl(g, S.dark, -2.0, 6.6, -1.4, 0.55, 3.0);
        cyl(g, S.dark, 2.0, 6.2, -1.4, 0.45, 2.2);
        const mouth = box(g, S.trim, 0, 2.0, 2.7, 3.2, 3.0, 0.4, { emissive: S.trim, ei: 0.9, own: true });
        tickers.push(t => mouth.material.emissiveIntensity = 0.55 + Math.sin(t * 3.4) * 0.4);
        lamp(-2.9, 5.2, 2.4, 0.35); lamp(2.9, 5.2, 2.4, 0.35);
      }
    } else if (kind === 'air') {
      if (org) { sph(g, S.dark, 0, 1.4, 0, 2.6); cyl(g, S.body, 0, 4.4, 0, 1.1, 6.0); sph(g, S.trim, 0, 7.8, 0, 1.7, { emissive: S.trim, ei: 0.5 }); lamp(0, 7.8, 0, 0.6); }
      else if (air) { const r = new THREE.Mesh(gTorus(), ownMat(S.trim, { emissive: S.trim, ei: 0.9 }));
                      r.rotation.x = Math.PI / 2; r.scale.setScalar(7); r.position.y = 3.4; g.add(r);
                      const s = cone(g, S.body, 0, 4.4, 0, 2.2, 4.4); tickers.push(t => { r.rotation.z = -t * 0.8; s.rotation.y = t * 0.4; }); lamp(0, 7.0, 0, 0.5); }
      else { cyl(g, S.dark, 0, 0.5, 0, 3.6, 1.0); cyl(g, S.body, 0, 1.6, 0, 3.0, 1.4);
             const r = new THREE.Mesh(gTorus(), ownMat(S.trim, { emissive: S.trim, ei: 0.8 }));
             r.rotation.x = Math.PI / 2; r.scale.setScalar(7.4); r.position.y = 2.5; g.add(r);
             tickers.push(t => r.rotation.z = t * 1.2); lamp(-2.6, 2.4, 0, 0.35); lamp(2.6, 2.4, 0, 0.35); }
    } else if (kind === 'lab') {
      if (org) { sph(g, S.dark, 0, 1.8, 0, 3.0); const b = sph(g, S.trim, 0, 4.4, 0, 2.2, { emissive: S.trim, ei: 0.5, own: true });
                 tickers.push(t => b.scale.setScalar(4.4 * (1 + Math.sin(t * 2.2) * 0.1))); lamp(0, 4.4, 0, 0.6); }
      else if (air) { const s = ico(g, S.body, 0, 4.0, 0, 2.6); box(g, S.dark, 0, 1.0, 0, 4.0, 1.6, 4.0);
                      tickers.push(t => { s.rotation.y = t * 0.6; s.position.y = 4.0 + Math.sin(t * 1.2) * 0.3; }); lamp(0, 4.0, 0, 0.6); }
      else { box(g, S.dark, 0, 0.6, 0, 5.6, 1.2, 5.0); cyl(g, S.body, 0, 2.8, 0, 2.4, 3.4);
             const d = sph(g, S.trim, 0, 4.8, 0, 2.3, { emissive: S.trim, ei: 0.45, own: true });
             tickers.push(t => d.material.emissiveIntensity = 0.3 + Math.sin(t * 1.8) * 0.2); lamp(0, 6.4, 0, 0.4); }
    } else if (kind === 'tower') {
      // The only building that moves on its own: the head tracks and the muzzle
      // flashes. In a film about an army, defence has to look awake.
      const head = new THREE.Group();
      if (org) { cyl(g, S.dark, 0, 1.6, 0, 1.5, 3.2); sph(head, S.body, 0, 0, 0, 1.5); cone(head, S.trim, 0, 0, 1.9, 0.55, 2.4, { emissive: S.trim, ei: 0.4 }).rotation.x = Math.PI / 2; }
      else if (air) { cyl(g, S.dark, 0, 1.4, 0, 1.0, 2.8); ico(head, S.body, 0, 0, 0, 1.5); cyl(head, S.trim, 0, 0, 1.7, 0.28, 2.4, { emissive: S.trim, ei: 0.7 }).rotation.x = Math.PI / 2; }
      else { box(g, S.dark, 0, 0.7, 0, 3.4, 1.4, 3.4); cyl(g, S.body, 0, 2.4, 0, 1.2, 2.6); box(head, S.body, 0, 0, 0, 2.4, 1.6, 2.4);
             cyl(head, S.dark, 0, 0.2, 1.8, 0.34, 2.6).rotation.x = Math.PI / 2; }
      head.position.y = org ? 3.6 : air ? 3.4 : 4.2;
      g.add(head);
      const mz = glow(head, S.lit, 3.4, 0);
      mz.position.set(0, 0.2, 3.0);
      g.userData.head = head; g.userData.muzzle = mz;
      tickers.push(t => { head.rotation.y = Math.sin(t * 0.7) * 0.5; mz.material.opacity = Math.max(0, Math.sin(t * 5.5)) > 0.93 ? 0.9 : mz.material.opacity * 0.82; });
    } else if (kind === 'wall') {
      if (org) { const b = box(g, S.dark, 0, 1.5, 0, 3.4, 3.0, 1.6); box(g, S.body, 0, 3.1, 0, 3.6, 0.5, 1.9);
                 for (let i = -1; i <= 1; i++) cone(g, S.trim, i * 1.1, 3.7, 0, 0.3, 1.1); b.rotation.y = rnd(-0.04, 0.04); }
      else if (air) { const b = box(g, S.trim, 0, 1.8, 0, 3.4, 3.4, 0.5, { emissive: S.trim, ei: 0.4, opacity: 0.62, own: true });
                      box(g, S.dark, -1.8, 1.4, 0, 0.5, 2.8, 0.9); box(g, S.dark, 1.8, 1.4, 0, 0.5, 2.8, 0.9);
                      tickers.push(t => b.material.opacity = 0.5 + Math.sin(t * 2 + b.position.x) * 0.14); }
      else { box(g, S.body, 0, 1.4, 0, 3.4, 2.8, 1.5); box(g, S.dark, 0, 2.95, 0, 3.6, 0.4, 1.7);
             box(g, S.dark, -1.3, 1.4, 0.8, 0.3, 2.2, 0.2); box(g, S.dark, 1.3, 1.4, 0.8, 0.3, 2.2, 0.2); }
    }

    g.userData.tick = t => { for (let i = 0; i < tickers.length; i++) tickers[i](t); };
    return g;
  }

  // ── Units ──────────────────────────────────────────────────────────────────
  //
  // role: worker | infantry | tank | siege | air
  // Each returns a Group whose `walk(t, moving)` does the bob, so a crowd of
  // forty is forty sine calls a frame rather than forty skeletal animations.
  function makeUnit(race, role, tint) {
    const S = RACE_SKIN[race] || RACE_SKIN.forge;
    const body = tint || S.body;
    const g = new THREE.Group();
    const legs = [];
    let hover = false, bobAmp = 0.12, spin = null;

    function leg(x, z, r, h) { const l = cyl(g, S.dark, x, (h || 0.7) / 2, z, r || 0.16, h || 0.7); legs.push(l); return l; }
    function eye(x, y, z, r) {
      sph(g, S.eye, x, y, z, r || 0.14, { emissive: S.eye, ei: 1 });
      glow(g, S.eye, (r || 0.14) * 3.2, 0.4).position.set(x, y, z);
    }

    if (race === 'gloop') {
      if (role === 'worker') { sph(g, body, 0, 0.5, 0, 0.55).scale.set(1.2, 0.8, 1.4); sph(g, S.trim, 0, 0.85, 0.35, 0.3); eye(-0.16, 0.9, 0.62, 0.1); eye(0.16, 0.9, 0.62, 0.1); bobAmp = 0.08; }
      else if (role === 'infantry') { sph(g, body, 0, 0.62, 0, 0.55); sph(g, S.dark, 0, 0.5, 0.42, 0.3); eye(-0.2, 0.78, 0.44, 0.11); eye(0.2, 0.78, 0.44, 0.11);
                                      cone(g, S.trim, -0.26, 0.34, 0.62, 0.12, 0.5).rotation.x = Math.PI / 2 + 0.5;
                                      cone(g, S.trim, 0.26, 0.34, 0.62, 0.12, 0.5).rotation.x = Math.PI / 2 + 0.5;
                                      leg(-0.34, 0.16, 0.1, 0.42); leg(0.34, 0.16, 0.1, 0.42); leg(-0.3, -0.24, 0.1, 0.42); leg(0.3, -0.24, 0.1, 0.42); }
      else if (role === 'tank') { sph(g, body, 0, 1.15, 0, 1.15).scale.set(1.1, 1, 1.05); sph(g, S.trim, 0, 1.9, 0, 0.55, { emissive: S.trim, ei: 0.4 });
                                  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; cone(g, S.trim, Math.cos(a) * 0.95, 1.6, Math.sin(a) * 0.95, 0.16, 0.7); }
                                  eye(-0.34, 1.3, 1.02, 0.14); eye(0.34, 1.3, 1.02, 0.14);
                                  leg(-0.7, 0.4, 0.2, 0.5); leg(0.7, 0.4, 0.2, 0.5); leg(-0.6, -0.5, 0.2, 0.5); leg(0.6, -0.5, 0.2, 0.5); }
      else if (role === 'siege') { sph(g, body, 0, 0.85, 0, 0.85).scale.set(1, 0.9, 1.2); cyl(g, S.dark, 0, 1.7, 0.2, 0.24, 1.6).rotation.x = -0.5;
                                   sph(g, S.trim, 0, 2.35, 0.55, 0.42, { emissive: S.trim, ei: 0.5 }); eye(0, 2.4, 0.9, 0.12);
                                   leg(-0.5, 0.3, 0.16, 0.6); leg(0.5, 0.3, 0.16, 0.6); leg(-0.45, -0.4, 0.16, 0.6); leg(0.45, -0.4, 0.16, 0.6); }
      else { hover = true; sph(g, body, 0, 1.7, 0, 0.9, { opacity: 0.92 }); sph(g, S.trim, 0, 2.2, 0, 0.5, { emissive: S.trim, ei: 0.4 });
             for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const tn = cyl(g, S.dark, Math.cos(a) * 0.45, 1.0, Math.sin(a) * 0.45, 0.08, 1.0); legs.push(tn); }
             eye(-0.24, 1.8, 0.8, 0.12); eye(0.24, 1.8, 0.8, 0.12); }
    } else if (race === 'aether') {
      if (role === 'worker') { hover = true; cone(g, body, 0, 1.0, 0, 0.44, 1.4); sph(g, S.dark, 0, 1.75, 0, 0.3); eye(0, 1.8, 0.28, 0.1);
                               const r = new THREE.Mesh(gTorus(), mat(S.trim, { emissive: S.trim, ei: 0.9 })); r.rotation.x = Math.PI / 2; r.scale.setScalar(1.5); r.position.y = 0.35; g.add(r); spin = r; }
      else if (role === 'infantry') { box(g, body, 0, 1.1, 0, 0.62, 1.1, 0.5); box(g, S.dark, 0, 1.85, 0, 0.44, 0.44, 0.44); eye(0, 1.88, 0.24, 0.1);
                                      box(g, S.trim, 0.5, 1.35, 0.25, 0.14, 1.5, 0.14, { emissive: S.trim, ei: 0.7 });
                                      leg(-0.2, 0, 0.13, 0.55); leg(0.2, 0, 0.13, 0.55); }
      else if (role === 'tank') { box(g, body, 0, 1.5, 0, 1.4, 1.7, 1.1); box(g, S.dark, 0, 2.55, 0, 0.8, 0.6, 0.7); eye(0, 2.6, 0.4, 0.13);
                                  box(g, S.trim, -1.0, 1.5, 0.2, 0.24, 1.9, 0.9, { emissive: S.trim, ei: 0.5 });
                                  box(g, S.trim, 1.0, 1.5, 0.2, 0.24, 1.9, 0.9, { emissive: S.trim, ei: 0.5 });
                                  leg(-0.44, 0.2, 0.22, 0.7); leg(0.44, 0.2, 0.22, 0.7); }
      else if (role === 'siege') { box(g, body, 0, 1.2, 0, 0.7, 1.2, 0.6); cyl(g, S.trim, 0, 1.6, 0.9, 0.13, 2.0, { emissive: S.trim, ei: 0.8 }).rotation.x = Math.PI / 2 - 0.2;
                                   sph(g, S.dark, 0, 1.95, 0, 0.3); eye(0, 2.0, 0.26, 0.1); leg(-0.22, 0, 0.13, 0.6); leg(0.22, 0, 0.13, 0.6); }
      else { hover = true; box(g, body, 0, 1.9, 0, 0.7, 0.5, 1.5); const w1 = box(g, S.trim, -1.0, 2.0, -0.1, 1.4, 0.1, 0.7, { emissive: S.trim, ei: 0.55 });
             const w2 = box(g, S.trim, 1.0, 2.0, -0.1, 1.4, 0.1, 0.7, { emissive: S.trim, ei: 0.55 }); legs.push(w1, w2); eye(0, 1.95, 0.76, 0.11); }
    } else {
      if (role === 'worker') { box(g, body, 0, 0.62, 0, 0.72, 0.68, 0.68); box(g, S.dark, 0, 1.12, 0.1, 0.5, 0.4, 0.5); eye(0, 1.14, 0.36, 0.11);
                               box(g, S.trim, 0.5, 0.7, 0.3, 0.16, 0.16, 0.7); cyl(g, S.dark, -0.5, 0.7, 0.3, 0.1, 0.7).rotation.x = Math.PI / 2;
                               leg(-0.26, 0, 0.14, 0.42); leg(0.26, 0, 0.14, 0.42); bobAmp = 0.09; }
      else if (role === 'infantry') { box(g, body, 0, 1.0, 0, 0.62, 0.9, 0.5); box(g, S.dark, 0, 1.62, 0, 0.46, 0.42, 0.46); eye(0, 1.64, 0.26, 0.1);
                                      cyl(g, S.dark, 0.42, 1.15, 0.42, 0.1, 1.0).rotation.x = Math.PI / 2 - 0.15;
                                      sph(g, S.trim, 0.42, 1.15, 0.95, 0.13, { emissive: S.trim, ei: 0.6 });
                                      leg(-0.2, 0, 0.14, 0.55); leg(0.2, 0, 0.14, 0.55); }
      else if (role === 'tank') { box(g, body, 0, 1.25, 0, 1.5, 1.5, 1.2); box(g, S.dark, 0, 2.2, 0, 0.8, 0.5, 0.7); eye(0, 2.22, 0.4, 0.13);
                                  box(g, S.trim, 0, 1.25, 0.85, 1.9, 2.1, 0.3);
                                  leg(-0.5, 0.2, 0.24, 0.55); leg(0.5, 0.2, 0.24, 0.55); }
      else if (role === 'siege') { box(g, S.dark, 0, 0.5, 0, 1.7, 0.8, 1.4); box(g, body, 0, 1.25, -0.1, 1.2, 0.9, 1.1);
                                   cyl(g, S.dark, 0, 1.5, 1.2, 0.16, 2.6).rotation.x = Math.PI / 2 - 0.12;
                                   sph(g, S.trim, 0, 1.65, 2.4, 0.18, { emissive: S.trim, ei: 0.6 }); eye(-0.4, 1.7, 0.3, 0.1); bobAmp = 0.05; }
      else { hover = true; box(g, body, 0, 2.0, 0, 0.9, 0.6, 1.7); const w1 = box(g, S.dark, -1.15, 2.1, 0, 1.5, 0.14, 0.8);
             const w2 = box(g, S.dark, 1.15, 2.1, 0, 1.5, 0.14, 0.8);
             const rot = box(g, S.trim, 0, 2.5, 0, 2.6, 0.08, 0.16, { emissive: S.trim, ei: 0.3 }); spin = rot;
             legs.push(w1, w2); eye(0, 2.0, 0.86, 0.11); }
    }

    const sh = blobShadow(g, hover ? 2.2 : 1.9, 0, 0, hover ? 0.42 : 0.7);
    const ph = rnd(0, 6.28);
    g.userData.walk = function (t, moving) {
      const s = moving === false ? 0.25 : 1;
      const b = Math.sin(t * 7 + ph);
      g.position.y = (hover ? 0.55 + Math.sin(t * 1.7 + ph) * 0.22 : 0) + (hover ? 0 : Math.abs(b) * bobAmp * s);
      if (!hover) g.rotation.z = b * 0.035 * s;
      for (let i = 0; i < legs.length; i++) {
        const l = legs[i];
        if (hover) l.rotation.z = Math.sin(t * 3 + i) * 0.14;
        else l.rotation.x = Math.sin(t * 7 + ph + i * Math.PI / 2) * 0.55 * s;
      }
      if (spin) spin.rotation.y = t * 22;
      sh.position.y = 0.06 - g.position.y;
      sh.material.opacity = (hover ? 0.42 : 0.7) * (hover ? 0.8 : 1);
    };
    g.userData.eyeAt = 1.6;
    return g;
  }

  // ── The enemy ──────────────────────────────────────────────────────────────
  //
  // Deliberately *not* another faction. If the film showed Forge killing Gloop,
  // the answer to "why are we fighting" would be "because they are the other
  // colour", which is a poor thing to hand a seven-year-old and a poor fit for
  // a game where you pick all three. So the enemy is the Rift itself: shapes
  // made of the same red the tear in the sky is made of, that come for the
  // crystal and nothing else. They are spiky and cross rather than gruesome.
  function makeRiftling(scale, big) {
    const g = new THREE.Group();
    const dark = '#3a1230', hot = '#ff3c62';
    const s = big ? 1.7 : 1;
    ico(g, dark, 0, 0.75 * s, 0, 0.62 * s);
    const eye = sph(g, hot, 0, 0.9 * s, 0.5 * s, 0.15 * s, { emissive: hot, ei: 1.2, own: true });
    glow(g, hot, 1.5 * s, 0.5).position.set(0, 0.9 * s, 0.5 * s);
    const spikes = [];
    for (let i = 0; i < (big ? 8 : 5); i++) {
      const a = (i / (big ? 8 : 5)) * Math.PI * 2;
      const sp = cone(g, hot, Math.cos(a) * 0.42 * s, (1.1 + rnd(0, 0.3)) * s, Math.sin(a) * 0.42 * s, 0.1 * s, rnd(0.5, 0.95) * s, { emissive: hot, ei: 0.35 });
      sp.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      spikes.push(sp);
    }
    const legs = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.6;
      legs.push(cyl(g, dark, Math.cos(a) * 0.4 * s, 0.25 * s, Math.sin(a) * 0.4 * s, 0.09 * s, 0.5 * s));
    }
    blobShadow(g, 1.7 * s, 0, 0, 0.6);
    // Frozen and marked states are additive sprites rather than a material
    // swap, because every riftling shares one cached material — recolouring
    // one would recolour the whole wave.
    const frost = glow(g, '#a8ecff', 2.2 * s, 0);
    frost.position.y = 0.8 * s;
    const markd = glow(g, '#ffb14a', 2.6 * s, 0);
    markd.position.y = 1.4 * s;
    g.userData.frost = frost;
    g.userData.mark = markd;
    g.scale.setScalar(scale || 1);
    const ph = rnd(0, 6.28);
    g.userData.walk = function (t, moving) {
      const b = Math.sin(t * 9 + ph);
      g.position.y = Math.abs(b) * 0.14 * (moving === false ? 0.3 : 1);
      g.rotation.z = b * 0.05;
      for (let i = 0; i < legs.length; i++) legs[i].rotation.x = Math.sin(t * 9 + ph + i) * 0.6;
      eye.material.emissiveIntensity = 1.0 + Math.sin(t * 6 + ph) * 0.4;
    };
    g.userData.die = function (u) {                  // u: 0 alive → 1 gone
      g.scale.setScalar((scale || 1) * (1 - u) * (1 + u * 0.5));
      g.rotation.y += 0.3 * u;
      g.visible = u < 0.99;
    };
    return g;
  }

  // ── Hands ──────────────────────────────────────────────────────────────────
  //
  // The single most important object in a first-person film. Without hands the
  // camera is a floating eye and the viewer is nobody; with them the viewer is
  // *this hero*, and every ability that follows belongs to them. They are
  // parented to the camera, so they need no tracking code — and the camera has
  // to be added to the scene, which is the one non-obvious requirement here.
  //
  // Each rig exposes `tick(t, st)` where st carries the two poses the film
  // needs: `cast` (0→1, the ability push) and `point` (0→1, the command).
  function makeHands(hero) {
    const g = new THREE.Group();
    // Everything lives on `rig` rather than on `g` directly, and the rig is
    // scaled and pushed away from the lens as one unit. Hands authored at a
    // comfortable size in local space sat far too close to a 62° camera and
    // read as grey slabs across the bottom third of frame rather than as arms;
    // one scale on one node fixes all five rather than renumbering every part.
    const rig = new THREE.Group();
    rig.scale.setScalar(0.44);
    rig.position.set(0, -0.16, -0.34);
    g.add(rig);
    const L = new THREE.Group(), R = new THREE.Group();
    rig.add(L); rig.add(R);
    L.position.set(-0.34, -0.26, -0.62);
    R.position.set(0.34, -0.26, -0.62);
    let extra = null;

    function pad(p, c, x, y, z, w, h, d) { return box(p, c, x, y, z, w, h, d); }

    if (hero === 'rook') {
      // Slab gauntlets and the top corner of the tower shield. Heavy, and the
      // shield edge cuts the left of frame so the viewer feels armoured.
      [L, R].forEach((h, i) => {
        const s = i ? 1 : -1;
        pad(h, '#6f7d8c', 0, 0, 0, 0.30, 0.20, 0.34);
        pad(h, '#4a5563', 0, 0.11, 0.02, 0.32, 0.07, 0.32);
        pad(h, '#4fb3ff', 0, 0.055, -0.17, 0.13, 0.06, 0.05, { emissive: '#4fb3ff', ei: 0.9 });
        for (let k = -1; k <= 1; k++) pad(h, '#8b97a5', k * 0.09, -0.09, -0.16, 0.07, 0.09, 0.10);
        h.rotation.y = s * 0.16;
      });
      const sh = new THREE.Group();
      pad(sh, '#5b6b7c', 0, 0, 0, 0.72, 0.9, 0.07);
      pad(sh, '#4fb3ff', 0, 0, 0.05, 0.16, 0.66, 0.05, { emissive: '#4fb3ff', ei: 0.6 });
      pad(sh, '#8b97a5', 0, 0.42, 0.02, 0.78, 0.09, 0.09);
      sh.position.set(-0.52, -0.30, -0.70);
      sh.rotation.set(0.12, 0.42, 0.10);
      rig.add(sh); extra = sh;
    } else if (hero === 'thorn') {
      [L, R].forEach((h, i) => {
        const s = i ? 1 : -1;
        cyl(h, '#4f9c5b', 0, 0, 0.06, 0.11, 0.34).rotation.x = Math.PI / 2;
        sph(h, '#3d7a48', 0, 0, -0.12, 0.11);
        for (let k = 0; k < 3; k++) {
          const a = -0.5 + k * 0.5;
          const c = cone(h, '#d8ff8a', Math.sin(a) * 0.1, Math.cos(a) * 0.02 - 0.02, -0.26, 0.032, 0.24, { emissive: '#9ae86a', ei: 0.35 });
          c.rotation.x = -Math.PI / 2 + 0.25;
          c.rotation.z = a * 0.5;
        }
        sph(h, '#9ae86a', 0, 0.03, -0.05, 0.05, { emissive: '#9ae86a', ei: 1 });
        h.rotation.y = s * 0.2;
      });
    } else if (hero === 'prism') {
      [L, R].forEach((h, i) => {
        const s = i ? 1 : -1;
        box(h, '#8f7fc4', 0, 0, 0, 0.20, 0.10, 0.30);
        box(h, '#c79bff', 0, 0.07, -0.02, 0.14, 0.04, 0.26, { emissive: '#c79bff', ei: 0.9 });
        for (let k = -1; k <= 1; k++) box(h, '#b0a0dd', k * 0.06, -0.03, -0.19, 0.04, 0.05, 0.10);
        h.rotation.set(-0.5, s * 0.24, 0);
      });
      const ring = new THREE.Mesh(gTorus(), ownMat('#c79bff', { emissive: '#c79bff', ei: 1 }));
      ring.scale.setScalar(0.34);
      ring.position.set(0, -0.30, -0.80);
      rig.add(ring);
      const gl = glow(rig, '#c79bff', 0.11, 0.45);
      gl.position.copy(ring.position);
      extra = { ring: ring, gl: gl };
    } else if (hero === 'ember') {
      // A cannon rather than a hand on the right — Ember's whole read is reach,
      // and a barrel in frame is the cheapest way to say "I outrange you".
      const c = new THREE.Group();
      box(c, '#6b4536', 0, 0, 0.10, 0.30, 0.26, 0.40);
      cyl(c, '#4a2f26', 0, 0.01, -0.34, 0.10, 0.62).rotation.x = Math.PI / 2;
      cyl(c, '#8a5a3f', 0, 0.01, -0.60, 0.13, 0.14).rotation.x = Math.PI / 2;
      const heat = cyl(c, '#ff7a2a', 0, 0.01, -0.66, 0.085, 0.05, { emissive: '#ff7a2a', ei: 0.8, own: true });
      heat.rotation.x = Math.PI / 2;
      const mz = glow(c, '#ffb14a', 0.05, 0.3);
      mz.position.set(0, 0.01, -0.72);
      for (let k = 0; k < 3; k++) box(c, '#ff8a3a', 0, 0.14, -0.10 - k * 0.13, 0.07, 0.05, 0.06, { emissive: '#ff8a3a', ei: 0.9 });
      c.position.set(0.34, -0.30, -0.52);
      c.rotation.set(0.06, -0.10, 0);
      rig.add(c);
      R.visible = false;
      box(L, '#6b4536', 0, 0, 0, 0.24, 0.14, 0.28);
      const flame = sph(L, '#ffb14a', 0, 0.16, -0.10, 0.07, { emissive: '#ffb14a', ei: 1.1, own: true });
      const fg = glow(L, '#ff9a3a', 0.06, 0.45);
      fg.position.set(0, 0.18, -0.10);
      L.position.set(-0.36, -0.30, -0.60);
      extra = { cannon: c, heat: heat, mz: mz, flame: flame, fg: fg };
    } else {
      // Vale carries a lantern, not a weapon. That is the whole character, and
      // it is worth a whole prop: the light it throws is a real PointLight, so
      // the ground under Vale is lit differently from the ground under Ember.
      const lant = new THREE.Group();
      cyl(lant, '#8a9aa8', 0, 0.30, 0, 0.018, 0.62);
      box(lant, '#6ef2b0', 0, 0, 0, 0.17, 0.22, 0.17, { emissive: '#6ef2b0', ei: 1.2, opacity: 0.9 });
      box(lant, '#8a9aa8', 0, 0.13, 0, 0.20, 0.04, 0.20);
      box(lant, '#8a9aa8', 0, -0.12, 0, 0.20, 0.04, 0.20);
      const lgl = glow(lant, '#6ef2b0', 0.11, 0.6);
      const lpt = new THREE.PointLight(new THREE.Color('#6ef2b0'), 1.1, 20, 2);
      lant.add(lpt);
      lant.position.set(-0.40, -0.34, -0.74);
      lant.rotation.z = 0.14;
      rig.add(lant);
      L.visible = false;
      box(R, '#7fa9c0', 0, 0, 0, 0.22, 0.10, 0.30);
      for (let k = -1; k <= 1; k++) box(R, '#7fa9c0', k * 0.07, 0.02, -0.19, 0.05, 0.06, 0.11);
      const motes = glow(R, '#6ef2b0', 0.05, 0.5);
      motes.position.set(0, 0.14, -0.12);
      R.rotation.set(-0.55, -0.2, 0);
      extra = { lant: lant, lgl: lgl, lpt: lpt, motes: motes };
    }

    g.userData.tick = function (t, st) {
      st = st || {};
      const cast = st.cast || 0, point = st.point || 0;
      const bob = Math.sin(t * 1.9) * 0.012, sway = Math.cos(t * 1.3) * 0.010;
      const push = smooth(cast) * 0.30;                 // hands drive forward on a cast
      const lift = smooth(point);                        // the command gesture
      g.position.set(sway, bob - push * 0.10, -push * 0.34);
      g.rotation.set(-push * 0.30 - lift * 0.16, 0, 0);
      L.rotation.z = lift * 0.5;
      R.rotation.z = -lift * 0.9;
      R.position.y = -0.26 + lift * 0.30;
      L.position.y = -0.26 + lift * 0.10;
      if (hero === 'prism' && extra) {
        extra.ring.rotation.z = t * 1.4;
        extra.ring.rotation.x = 0.4 + Math.sin(t * 0.8) * 0.15;
        extra.ring.scale.setScalar(0.34 * (1 + cast * 0.7));
        extra.gl.material.opacity = 0.4 + cast * 0.5;
        extra.gl.scale.setScalar(0.11 * (1 + cast));
      }
      if (hero === 'ember' && extra) {
        extra.heat.material.emissiveIntensity = 1.0 + cast * 3 + Math.sin(t * 5) * 0.3;
        extra.mz.material.opacity = 0.2 + cast * 0.8;
        extra.mz.scale.setScalar(0.05 * (1 + cast * 2.2));
        extra.flame.scale.setScalar(0.14 * (1 + Math.sin(t * 9) * 0.16 + cast * 0.7));
        extra.fg.material.opacity = 0.4 + Math.sin(t * 7) * 0.1 + cast * 0.3;
        extra.cannon.rotation.z = -cast * 0.10;
      }
      if (hero === 'vale' && extra) {
        extra.lant.rotation.z = 0.14 + Math.sin(t * 1.1) * 0.07;
        extra.lgl.scale.setScalar(0.11 * (1 + Math.sin(t * 2.2) * 0.08 + cast * 1.4));
        extra.lpt.intensity = 1.1 + cast * 3.2 + Math.sin(t * 2.2) * 0.2;
        extra.motes.material.opacity = 0.35 + cast * 0.6;
        extra.motes.scale.setScalar(0.05 * (1 + cast * 2));
      }
      if (hero === 'rook' && extra) {
        extra.rotation.z = 0.10 - lift * 0.25;
        extra.position.x = -0.52 + lift * 0.10;
      }
    };
    return g;
  }

  // ── Scene furniture ────────────────────────────────────────────────────────

  function skyDome(scene, top, bottom) {
    const g = new THREE.SphereGeometry(700, 20, 14);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { a: { value: new THREE.Color(top) }, b: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 a; uniform vec3 b; varying float h; void main(){ gl_FragColor = vec4(mix(b, a, clamp(h*0.5+0.5,0.0,1.0)), 1.0); }',
    });
    const s = new THREE.Mesh(g, m);
    scene.add(s);
    return s;
  }

  function lightRig(scene, o) {
    o = o || {};
    const hemi = new THREE.HemisphereLight(new THREE.Color(o.sky || '#bcd8ff'), new THREE.Color(o.ground || '#3a3020'), o.hemi != null ? o.hemi : 0.85);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(new THREE.Color(o.key || '#fff3dd'), o.keyI != null ? o.keyI : 1.15);
    key.position.set(o.kx != null ? o.kx : -40, 60, o.kz != null ? o.kz : 30);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(o.rim || '#7fb6ff'), o.rimI != null ? o.rimI : 0.5);
    rim.position.set(30, 22, -50);
    scene.add(rim);
    return { hemi: hemi, key: key, rim: rim };
  }

  // A base, laid out so a single slow pan reads left-to-right as the actual
  // build order of a real match: shards → core → supply → production → defence.
  function makeBase(race, o) {
    o = o || {};
    const g = new THREE.Group();
    const parts = {};
    parts.core = makeBuilding(race, 'core'); parts.core.position.set(0, 0, 0); g.add(parts.core);
    parts.supply = [];
    for (let i = 0; i < 3; i++) {
      const s = makeBuilding(race, 'supply');
      s.position.set(-14 + i * 0.6, 0, 9 + i * 5.5);
      g.add(s); parts.supply.push(s);
    }
    parts.factory = makeBuilding(race, 'factory'); parts.factory.position.set(13, 0, 6); parts.factory.rotation.y = -0.35; g.add(parts.factory);
    parts.air = makeBuilding(race, 'air'); parts.air.position.set(19, 0, -9); g.add(parts.air);
    parts.lab = makeBuilding(race, 'lab'); parts.lab.position.set(-15, 0, -8); g.add(parts.lab);
    parts.towers = [];
    [[-9, 22], [10, 23]].forEach(p => {
      const tw = makeBuilding(race, 'tower');
      tw.position.set(p[0], 0, p[1]); g.add(tw); parts.towers.push(tw);
    });
    parts.walls = [];
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const w = makeBuilding(race, 'wall');
      w.position.set(i * 4.4, 0, 20 + Math.abs(i) * 0.6);
      g.add(w); parts.walls.push(w);
    }
    // Shard patch and the workers on it. Kids read "gathering" instantly from a
    // loop of small things carrying bright things back and forth; nothing else
    // in the film explains the economy and nothing else needs to.
    parts.nodes = [];
    for (let i = 0; i < 3; i++) {
      const n = makeShardNode();
      n.position.set(-24 - i * 5, 0, -14 + i * 7);
      g.add(n); parts.nodes.push(n);
    }
    parts.workers = [];
    for (let i = 0; i < (o.workers || 6); i++) {
      const w = makeUnit(race, 'worker');
      const node = parts.nodes[i % parts.nodes.length];
      const carry = ico(w, PAL.shard, 0, 1.45, 0.15, 0.28, { emissive: PAL.shard, ei: 1, own: true });
      w.userData.node = node.position.clone();
      w.userData.carry = carry;
      w.userData.ph = rnd(0, 1);
      g.add(w); parts.workers.push(w);
    }
    parts.tick = function (t) {
      parts.core.userData.tick(t);
      parts.supply.forEach(s => s.userData.tick(t));
      parts.factory.userData.tick(t);
      parts.air.userData.tick(t);
      parts.lab.userData.tick(t);
      parts.towers.forEach(s => s.userData.tick(t));
      parts.walls.forEach(s => s.userData.tick(t));
      for (let i = 0; i < parts.workers.length; i++) {
        const w = parts.workers[i];
        // A sawtooth between node and core: out empty, back carrying.
        const u = (t * 0.14 + w.userData.ph) % 1;
        const outbound = u < 0.5;
        const k = outbound ? u * 2 : (1 - u) * 2;
        const from = w.userData.node, to = new THREE.Vector3(0, 0, 4);
        w.position.x = lerp(to.x, from.x, k);
        w.position.z = lerp(to.z, from.z, k);
        w.lookAt(outbound ? from.x : to.x, w.position.y, outbound ? from.z : to.z);
        w.userData.walk(t + i, true);
        w.userData.carry.visible = !outbound;
        w.userData.carry.rotation.y = t * 2;
      }
    };
    g.userData.parts = parts;
    return g;
  }

  // A block of units in ranks, facing +Z. `march(t, u)` slides the whole block
  // forward, which is how every "the army moves out" beat in the film is done.
  function makeArmy(race, spec, o) {
    o = o || {};
    const g = new THREE.Group();
    const units = [];
    let i = 0;
    spec.forEach(row => {
      for (let k = 0; k < row.n; k++) {
        const u = makeUnit(race, row.role, row.tint);
        const w = (row.n - 1) * (row.gap || 3.2);
        u.position.set(-w / 2 + k * (row.gap || 3.2) + rnd(-0.3, 0.3), 0, row.z + rnd(-0.4, 0.4));
        u.userData.home = u.position.clone();
        g.add(u); units.push(u); i++;
      }
    });
    g.userData.units = units;
    g.userData.tick = function (t, moving) {
      for (let k = 0; k < units.length; k++) units[k].userData.walk(t + k * 0.21, moving);
    };
    g.userData.march = function (t, dist) {
      for (let k = 0; k < units.length; k++) {
        const u = units[k];
        u.position.z = u.userData.home.z + dist * (1 + (k % 3) * 0.06);
      }
    };
    return g;
  }

  // ── Hero figures, for the finale ───────────────────────────────────────────
  //
  // The film is first person for two and a half minutes and then, exactly once,
  // it is not. Pulling out to see the five of them standing together is the pay
  // -off for having been each of them, so these are the only bodies in the film
  // that get built as characters rather than as crowd.
  function makeHeroFigure(id) {
    const g = new THREE.Group();
    const T = { rook: '#4fb3ff', thorn: '#7fe06a', prism: '#c79bff', ember: '#ff8a3a', vale: '#6ef2b0' }[id] || '#4fb3ff';
    const D = { rook: '#2c4d6b', thorn: '#2f6b3d', prism: '#4b3f79', ember: '#6b3a1e', vale: '#2f6b57' }[id] || '#2c4d6b';
    const arms = [];
    if (id === 'rook') {
      box(g, D, 0, 1.5, 0, 1.5, 1.9, 1.1); box(g, T, 0, 2.35, 0, 1.9, 0.5, 1.3, { emissive: T, ei: 0.35 });
      box(g, D, 0, 3.0, 0, 0.85, 0.75, 0.8); sph(g, T, 0, 3.05, 0.4, 0.16, { emissive: T, ei: 1.2 });
      const sh = box(g, D, -1.35, 1.6, 0.3, 0.28, 2.3, 1.5); box(g, T, -1.5, 1.6, 0.3, 0.1, 1.7, 0.4, { emissive: T, ei: 0.8 });
      arms.push(sh);
      box(g, D, -0.5, 0.4, 0, 0.5, 1.0, 0.5); box(g, D, 0.5, 0.4, 0, 0.5, 1.0, 0.5);
      const hm = box(g, D, 1.25, 1.9, 0, 0.6, 0.6, 0.6); arms.push(hm);
    } else if (id === 'thorn') {
      sph(g, D, 0, 1.5, 0, 0.95).scale.set(1, 1.15, 1); sph(g, T, 0, 2.4, 0.15, 0.5, { emissive: T, ei: 0.4 });
      sph(g, '#d9ff7a', -0.2, 2.5, 0.45, 0.11, { emissive: '#d9ff7a', ei: 1.3 });
      sph(g, '#d9ff7a', 0.2, 2.5, 0.45, 0.11, { emissive: '#d9ff7a', ei: 1.3 });
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; const c = cone(g, T, Math.cos(a) * 0.75, 2.1, Math.sin(a) * 0.75, 0.13, 0.9); c.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
      [-1, 1].forEach(s => { const a = cyl(g, D, s * 0.95, 1.6, 0.3, 0.16, 1.5); a.rotation.z = s * 0.5; cone(g, '#d9ff7a', s * 1.35, 0.95, 0.35, 0.1, 0.6, { emissive: T, ei: 0.4 }); arms.push(a); });
      for (let i = 0; i < 4; i++) { const s = i < 2 ? -1 : 1; cyl(g, D, s * 0.5, 0.4, (i % 2) * 0.5 - 0.25, 0.14, 0.9); }
    } else if (id === 'prism') {
      box(g, D, 0, 1.8, 0, 0.85, 2.1, 0.7); box(g, T, 0, 2.2, 0, 1.0, 0.35, 0.85, { emissive: T, ei: 0.4 });
      box(g, D, 0, 3.15, 0, 0.55, 0.6, 0.55); sph(g, T, 0, 3.2, 0.28, 0.13, { emissive: T, ei: 1.3 });
      const r = new THREE.Mesh(gTorus(), ownMat(T, { emissive: T, ei: 1 })); r.scale.setScalar(2.6); r.position.set(0, 2.0, 0.9); r.rotation.x = 0.6; g.add(r); arms.push(r);
      [-1, 1].forEach(s => { const a = box(g, D, s * 0.68, 1.8, 0.1, 0.26, 1.6, 0.26); arms.push(a); });
      box(g, D, -0.28, 0.5, 0, 0.34, 1.1, 0.34); box(g, D, 0.28, 0.5, 0, 0.34, 1.1, 0.34);
      g.userData.spin = r;
    } else if (id === 'ember') {
      box(g, D, 0, 1.35, 0, 1.5, 1.6, 1.2); box(g, T, 0, 1.35, 0, 0.7, 0.9, 1.3, { emissive: T, ei: 0.9 });
      box(g, D, 0, 2.4, 0, 0.75, 0.6, 0.7); sph(g, '#ffd08a', 0, 2.45, 0.36, 0.14, { emissive: '#ffd08a', ei: 1.3 });
      const bar = cyl(g, D, 1.15, 1.5, 0.6, 0.2, 2.6); bar.rotation.set(1.35, 0, -0.15);
      cyl(g, T, 1.32, 1.5, 1.75, 0.25, 0.3, { emissive: T, ei: 1.1 }).rotation.set(1.35, 0, -0.15);
      arms.push(bar);
      box(g, D, -0.42, 0.42, 0, 0.5, 1.0, 0.55); box(g, D, 0.42, 0.42, 0, 0.5, 1.0, 0.55);
      const a2 = box(g, D, -0.95, 1.5, 0.2, 0.3, 1.4, 0.3); arms.push(a2);
    } else {
      box(g, D, 0, 1.9, 0, 0.7, 2.2, 0.6); box(g, T, 0, 2.5, 0, 0.9, 0.3, 0.75, { emissive: T, ei: 0.4 });
      box(g, D, 0, 3.3, 0, 0.5, 0.6, 0.5); sph(g, T, 0, 3.35, 0.26, 0.12, { emissive: T, ei: 1.3 });
      const pole = cyl(g, '#8a9aa8', -0.9, 2.0, 0.35, 0.05, 3.4); arms.push(pole);
      const lan = box(g, T, -0.9, 3.5, 0.35, 0.4, 0.5, 0.4, { emissive: T, ei: 1.3, opacity: 0.92 });
      glow(g, T, 3.4, 0.7).position.set(-0.9, 3.5, 0.35);
      g.userData.lantern = lan;
      const a2 = box(g, D, 0.62, 1.9, 0.15, 0.24, 1.5, 0.24); arms.push(a2);
      box(g, D, -0.24, 0.5, 0, 0.32, 1.1, 0.32); box(g, D, 0.24, 0.5, 0, 0.32, 1.1, 0.32);
    }
    blobShadow(g, 4.2, 0, 0, 0.6);
    glow(g, T, 6, 0.16).position.y = 2;
    const ph = rnd(0, 6.28);
    g.userData.tick = function (t, raise) {
      g.position.y = Math.sin(t * 1.3 + ph) * 0.06;
      g.rotation.y = Math.sin(t * 0.5 + ph) * 0.05;
      const r = smooth(clamp(raise || 0, 0, 1));
      for (let i = 0; i < arms.length; i++) arms[i].rotation.z = (arms[i].userData.z0 || 0) - r * 0.5 * (i % 2 ? -1 : 1);
      if (g.userData.spin) g.userData.spin.rotation.z = t * 0.9;
    };
    return g;
  }

  // A wave of riftlings. `tick(t, advance, moving)` walks the whole wave toward
  // the camera; `kill(i, u)` retires one.
  function makeWave(n, o) {
    o = o || {};
    const g = new THREE.Group();
    const list = [];
    for (let i = 0; i < n; i++) {
      const r = makeRiftling(o.scale || 1.4, o.big && i === 0);
      r.position.set(rnd(-(o.w || 26), o.w || 26), 0, (o.z != null ? o.z : 70) + rnd(-(o.d || 16), o.d || 16));
      r.rotation.y = Math.PI;
      r.userData.home = r.position.clone();
      r.userData.deadAt = -1;
      g.add(r); list.push(r);
    }
    g.userData.list = list;
    g.userData.tick = function (t, advance, moving) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        r.position.z = r.userData.home.z - (advance || 0) * (1 + (i % 4) * 0.07);
        r.userData.walk(t + i * 0.3, moving);
      }
    };
    return g;
  }

  // ── Stage ──────────────────────────────────────────────────────────────────
  //
  // World convention, held by every chapter so the camera language stays the
  // same across a cut: **+Z is the front**, where the enemy comes from. −Z is
  // home — the crystal at z ≈ −20 and the base behind it at z ≈ −64. The hero
  // stands at the origin, between the two, which is literally the pitch of the
  // whole game and is worth being the literal geometry as well.
  function stage(o) {
    o = o || {};
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(new THREE.Color(o.fog || '#9dc4e0'), o.fogNear != null ? o.fogNear : 55, o.fogFar != null ? o.fogFar : 320);
    skyDome(scene, o.skyTop || '#7fb4e8', o.skyBot || '#dfe9f2');
    const lights = lightRig(scene, o.light);
    const cam = new THREE.PerspectiveCamera(o.fov || 60, 16 / 9, 0.1, 1400);
    scene.add(cam);
    return { scene: scene, cam: cam, lights: lights };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHAPTER 0 — THE RIFT
  //
  // The only chapter with no hero and no hands, and the only one that is not
  // first person, because it is the one thing none of the five could have seen:
  // what the world was like before, and what opened above it. Everything after
  // this is a consequence, so this is the chapter that has to land.
  // ═══════════════════════════════════════════════════════════════════════════
  const CH_OPEN = {
    id: 'open', dur: 25, tone: '#7fe9ff', mood: { root: 174, mood: 'calm', tempo: 0.62 },
    build: function (ctx) {
      const S = stage({ fog: '#a8cfe6', fogNear: 90, fogFar: 520, skyTop: '#5fa8e8', skyBot: '#eaf2f8', fov: 58,
                        light: { hemi: 0.62, keyI: 0.85, sky: '#cfe6ff', ground: '#3a4a2c' } });
      const scene = S.scene, cam = S.cam;

      const ground = makeGround({ size: 460, seg: 54, amp: 4.2, flat: 40, color: '#4d8a4f', deco: '#4a3628', deco2: '#2f8a4a', scatter: 90 });
      scene.add(ground);

      const crystal = makeCrystal(4.2);
      crystal.position.set(0, 16, 0);
      scene.add(crystal);
      // A pedestal, so the crystal reads as *placed* — something a world was
      // built around — rather than as a floating prop.
      const plinth = new THREE.Group();
      cyl(plinth, '#7d8b96', 0, 3, 0, 15, 6);
      cyl(plinth, '#5d6b76', 0, 6.4, 0, 12, 1.6);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; cyl(plinth, '#8d99a4', Math.cos(a) * 13, 8.4, Math.sin(a) * 13, 0.9, 5.2); }
      scene.add(plinth);

      // The world that the crystal keeps alive: three little settlements, one
      // per faction, going about their day. Small on purpose — you should read
      // "people live here" without being able to tell what they are yet.
      const towns = [];
      [['forge', -70, 42], ['gloop', 76, 30], ['aether', 8, -86]].forEach(t => {
        const b = new THREE.Group();
        const core = makeBuilding(t[0], 'core'); b.add(core);
        for (let i = 0; i < 3; i++) { const s = makeBuilding(t[0], 'supply'); s.position.set(-12 + i * 9, 0, 11); b.add(s); }
        const f = makeBuilding(t[0], 'factory'); f.position.set(15, 0, -6); b.add(f);
        const us = [];
        for (let i = 0; i < 5; i++) { const u = makeUnit(t[0], i ? 'infantry' : 'worker'); u.position.set(rnd(-16, 16), 0, rnd(14, 24)); b.add(u); us.push(u); }
        b.position.set(t[1], 0, t[2]);
        b.rotation.y = rnd(-0.5, 0.5);
        scene.add(b);
        towns.push({ g: b, core: core, f: f, us: us });
      });

      const motes = field(scene, { count: 320, rx: 120, rz: 120, y0: 2, y1: 70, color: PAL.shard, size: 0.9, opacity: 0.55, rise: 3, sway: 2, cam: cam, minDist: 16 });

      // The tear. Built as a fan of stretched, glowing shards around a black
      // slit, because a jagged silhouette reads as "wrong" instantly where a
      // smooth portal reads as "magic", and this is not supposed to look nice.
      const rift = new THREE.Group();
      const slit = box(rift, '#120207', 0, 0, 0, 3, 90, 3, { emissive: '#ff2a4a', ei: 0.15, own: true });
      for (let i = 0; i < 26; i++) {
        const y = -46 + (i / 25) * 92;
        const w = (1 - Math.abs(i / 25 - 0.5) * 2) * 14 + 2;
        const s = cone(rift, i % 2 ? '#c0304f' : '#ff3c62', rnd(-1.5, 1.5), y, rnd(-1.5, 1.5), rnd(1.2, 3.4), w, { emissive: '#ff2a4a', ei: 0.55, own: true });
        s.rotation.z = (i % 2 ? 1 : -1) * (Math.PI / 2) + rnd(-0.25, 0.25);
      }
      const rglow = glow(rift, '#ff3358', 120, 0.6);
      rift.position.set(30, 108, -160);
      rift.rotation.z = 0.28;
      rift.scale.set(0.001, 0.001, 0.001);
      scene.add(rift);
      const rlight = new THREE.PointLight(new THREE.Color('#ff3358'), 0, 400, 2);
      rlight.position.copy(rift.position);
      scene.add(rlight);

      // What comes through: a rain of riftlings that fall, land, and start
      // walking at the crystal. Nothing else has to be said about the stakes.
      const rain = [];
      for (let i = 0; i < 24; i++) {
        const r = makeRiftling(2.0);
        r.position.set(rnd(10, 60), 200, rnd(-200, -110));
        r.userData.t0 = rnd(0, 3.2);
        r.userData.land = new THREE.Vector3(rnd(-30, 90), 0, rnd(-130, -40));
        scene.add(r);
        rain.push(r);
      }

      // Five beams: the call that ends the chapter and starts the film.
      const beams = [];
      for (let i = 0; i < 5; i++) {
        const b = beam(scene, HEROES[i].tint, 3, 260, 0);
        const a = (i / 5) * Math.PI * 2 + 0.4;
        b.position.set(Math.cos(a) * 60, 130, Math.sin(a) * 60);
        b.rotation.z = Math.cos(a) * 0.28;
        b.rotation.x = -Math.sin(a) * 0.28;
        beams.push(b);
      }

      const track = keyed([
        { t: 0,    p: [-40, 120, 250], l: [0, 30, 0], fov: 48 },
        { t: 7.5,  p: [-26, 52, 118],  l: [0, 20, 0], fov: 52 },
        { t: 12,   p: [-14, 30, 62],   l: [0, 20, 0], fov: 58 },
        { t: 15,   p: [-10, 34, 52],   l: [24, 96, -120], fov: 62 },   // up, to the tear
        { t: 19,   p: [4, 26, 46],     l: [16, 60, -110], fov: 60 },
        { t: 22,   p: [10, 22, 54],    l: [0, 24, 0], fov: 56 },
        { t: 25,   p: [4, 26, 62],     l: [0, 26, 0], fov: 52 },
      ]);

      let doneBoom = false, doneBell = false, doneCall = false;
      return {
        scene: scene, cam: cam,
        update: function (t, dt, st) {
          track(cam, t);
          const dark = win(t, 12.5, 17.5);              // the sky turning
          const open = win(t, 13, 16.5);                // the tear widening
          const dim = win(t, 15.5, 20);                 // the crystal failing
          const call = win(t, 21, 24);                  // the five beams

          crystal.userData.tick(t, pulse(t, 21.4, 0.5, 1.6) * 0.35);
          crystal.userData.core.material.emissiveIntensity = lerp(0.55, 0.12, dim) + call * 1.0;
          crystal.userData.light.intensity = lerp(1.5, 0.35, dim) + call * 3.5;
          crystal.userData.glow.material.opacity = lerp(0.5, 0.2, dim) + call * 0.35;

          towns.forEach((tw, i) => {
            tw.core.userData.tick(t); tw.f.userData.tick(t);
            tw.us.forEach((u, k) => { u.userData.walk(t + k, dark < 0.4); });
          });
          motes.userData.tick(t);
          motes.material.opacity = lerp(0.55, 0.12, dim);

          S.lights.hemi.intensity = lerp(0.62, 0.20, dark);
          S.lights.key.intensity = lerp(0.85, 0.18, dark);
          S.lights.hemi.color.setStyle(dark > 0.5 ? '#5a4a66' : '#cfe6ff');
          scene.fog.color.lerpColors(new THREE.Color('#a8cfe6'), new THREE.Color('#43263a'), dark);
          if (scene.children[0] && scene.children[0].material && scene.children[0].material.uniforms) {
            scene.children[0].material.uniforms.a.value.lerpColors(new THREE.Color('#5fa8e8'), new THREE.Color('#2a1226'), dark);
            scene.children[0].material.uniforms.b.value.lerpColors(new THREE.Color('#eaf2f8'), new THREE.Color('#6b2436'), dark);
          }

          const os = 0.001 + open * 1.0;
          rift.scale.set(os * (1 + Math.sin(t * 6) * 0.03), os, os);
          rift.rotation.y = t * 0.12;
          rglow.material.opacity = open * (0.5 + Math.sin(t * 3) * 0.1);
          rlight.intensity = open * 9;
          slit.material.emissiveIntensity = 0.15 + open * 0.5;

          for (let i = 0; i < rain.length; i++) {
            const r = rain[i], rt = t - 15.2 - r.userData.t0;
            if (rt < 0) { r.visible = false; continue; }
            r.visible = true;
            const f = clamp(rt / 2.2, 0, 1);
            r.position.x = lerp(rift.position.x, r.userData.land.x, f);
            r.position.z = lerp(rift.position.z, r.userData.land.z, f);
            r.position.y = lerp(150, 0, f * f);
            if (f >= 1) { r.userData.walk(t + i, true); r.position.z += Math.min(6, (rt - 2.2) * 3); r.lookAt(0, 0, 0); }
            else r.rotation.set(rt * 4, rt * 2, 0);
          }

          for (let i = 0; i < beams.length; i++) {
            const b = beams[i];
            b.material.opacity = call * (0.55 + Math.sin(t * 9 + i) * 0.16);
            b.scale.set(3 + call * 4, 260, 3 + call * 4);
          }

          ctx.fx.tone(dark > 0.55 ? '#c0304f' : '#7fe9ff');
          ctx.fx.flash('#ffffff', call > 0.9 ? (call - 0.9) * 9 : 0);
          st.shake = pulse(t, 15.4, 0.15, 1.6) * 0.5 + call * 0.16;

          if (!doneBell && t > 7.2) { doneBell = true; ctx.score.bell(1046, 0.10); }
          if (!doneBoom && t > 13.1) { doneBoom = true; ctx.score.boom(0.24); ctx.score.riser(4, 0.05); ctx.score.set({ mood: 'dark', root: 146, tempo: 0.5 }); }
          if (!doneCall && t > 21) { doneCall = true; ctx.score.shimmer(0.09); ctx.score.bell(1568, 0.11); ctx.score.set({ mood: 'bright', root: 196, tempo: 0.46 }); }
        },
      };
    },
  };

  // ── Shared hero-chapter world ──────────────────────────────────────────────
  //
  // All five chapters stand in the same place with the same things around them:
  // crystal behind, base behind that, army between, enemy ahead. Building it
  // once is not only less code — it is what makes the five chapters feel like
  // five views of one war rather than five unrelated levels, and it means the
  // camera language ("turn left to see home, turn right to see the fight") is
  // learned once by the viewer and reused four times.
  function heroWorld(cfg) {
    const S = stage(cfg.stage);
    const scene = S.scene, cam = S.cam;
    const ground = makeGround(cfg.ground);
    scene.add(ground);
    const crystal = makeCrystal(2.4, cfg.dimCrystal);
    crystal.position.set(0, 9, -22);
    scene.add(crystal);
    const base = makeBase(cfg.race, { workers: 6 });
    base.position.set(0, 0, -50);
    scene.add(base);
    const army = makeArmy(cfg.race, cfg.army || [
      { role: 'infantry', n: 7, z: 0, gap: 3.4 },
      { role: 'tank', n: 3, z: -7, gap: 7 },
      { role: 'siege', n: 2, z: -14, gap: 9 },
    ]);
    army.position.set(0, 0, -28);
    scene.add(army);
    const wave = makeWave(cfg.waveN || 18, { z: cfg.waveZ != null ? cfg.waveZ : 74, w: 25, d: 13, scale: 1.5, big: true });
    scene.add(wave);
    const hands = makeHands(cfg.hero);
    cam.add(hands);
    return { S: S, scene: scene, cam: cam, ground: ground, crystal: crystal, base: base, army: army, wave: wave, hands: hands };
  }

  function makeDome(parent, color, radius) {
    const g = new THREE.Group();
    const sh = sph(g, color, 0, 0, 0, radius, { emissive: color, ei: 0.3, opacity: 0, own: true });
    sh.material.side = THREE.DoubleSide;
    sh.material.blending = THREE.AdditiveBlending;
    sh.material.depthWrite = false;
    const rings = [];
    [[0, 1.0], [radius * 0.5, 0.86], [radius * 0.8, 0.6]].forEach(p => {
      const r = new THREE.Mesh(gTorus(), ownMat(color, { emissive: color, ei: 1.2 }));
      r.material.blending = THREE.AdditiveBlending;
      r.material.depthWrite = false;
      r.rotation.x = Math.PI / 2;
      r.position.y = p[0];
      r.userData.k = p[1];
      g.add(r); rings.push(r);
    });
    if (parent) parent.add(g);
    g.userData.set = function (t, u) {
      g.visible = u > 0.01;
      if (!g.visible) return;
      const k = smooth(u), br = 0.85 + Math.sin(t * 3) * 0.15;
      sh.scale.setScalar(radius * 2 * k * (1 + Math.sin(t * 3) * 0.012));
      sh.material.opacity = u * 0.055 * br;
      for (let i = 0; i < rings.length; i++) {
        const r = rings[i];
        r.scale.setScalar(radius * 2 * r.userData.k * k);
        r.position.y = (i === 0 ? 0 : radius * (i === 1 ? 0.5 : 0.8)) * k;
        r.rotation.z = t * (0.3 + i * 0.2) * (i % 2 ? -1 : 1);
        r.material.opacity = u * (0.3 - i * 0.07) * br;
      }
    };
    return g;
  }

  function ringPop(r, t, t0, dur, x, y, z, r0, r1, op) {
    const u = clamp((t - t0) / dur, 0, 1);
    r.visible = u > 0.001 && u < 0.999;
    if (!r.visible) return 0;
    const k = smooth(u);
    r.position.set(x, y, z);
    r.scale.setScalar(lerp(r0, r1, k));
    r.material.opacity = (op != null ? op : 0.9) * (1 - u * u);
    return lerp(r0, r1, k);
  }

  // ═══ CHAPTER 1 — ROOK ══════════════════════════════════════════════════════
  // The teaching chapter. It is first, so it is the one that shows the whole
  // loop end to end — mine, build, train, command, spend the ultimate — while
  // the four after it can assume the viewer has seen a base before and spend
  // their time on what makes each hero different.
  const CH_ROOK = {
    id: 'rook', dur: 27, tone: '#4fb3ff', mood: { root: 196, mood: 'calm', tempo: 0.5 }, card: HEROES[0], cardAt: 1.4,
    build: function (ctx) {
      const W = heroWorld({
        hero: 'rook', race: 'forge',
        stage: { fog: '#9dc4e0', fogNear: 78, fogFar: 430, skyTop: '#5f9fd8', skyBot: '#e6eef4', fov: 62,
                 light: { hemi: 0.58, keyI: 0.82, sky: '#cfe6ff', ground: '#32402a' } },
        ground: { size: 420, seg: 50, amp: 3.0, flat: 46, color: '#4f8a52', deco: '#4a3628', deco2: '#2f8a4a', scatter: 66 },
      });
      const scene = W.scene, cam = W.cam;

      const dome = makeDome(scene, '#7fd6ff', 15);
      dome.position.set(0, 9, -22);
      const domeRing = ringFx(scene, '#9fe4ff', 0.7);
      const slamRing = ringFx(scene, '#a8ecff', 0.95);
      const slamRing2 = ringFx(scene, '#ffffff', 0.8);

      const banner = new THREE.Group();
      cyl(banner, '#8d949c', 0, 2.4, 0, 0.16, 4.8);
      box(banner, '#4fb3ff', 0.9, 3.9, 0, 1.9, 1.4, 0.08, { emissive: '#4fb3ff', ei: 0.7 });
      cone(banner, '#f08a2a', 0, 5.0, 0, 0.22, 0.7);
      banner.position.set(5.5, 0, 14);
      banner.visible = false;
      scene.add(banner);
      const bannerRing = ringFx(scene, '#4fb3ff', 0.5);
      bannerRing.visible = false;

      // Freshly trained infantry, walking out of the factory door and joining
      // the line. The one beat in the film that shows where an army comes from.
      const fresh = [];
      for (let i = 0; i < 4; i++) {
        const u = makeUnit('forge', 'infantry');
        u.position.set(13, 0, -60);
        scene.add(u); fresh.push(u);
      }

      const track = keyed([
        { t: 0,    p: [0, 3.4, 2],  l: [0.4, 1.0, 0.6], fov: 66 },     // your own hands
        { t: 2.6,  p: [0, 3.5, 1],  l: [0, 9, -22],     fov: 60 },     // the crystal
        { t: 6.5,  p: [0, 3.5, 0],  l: [-4, 8, -66],    fov: 58 },     // home
        { t: 9.5,  p: [0, 3.5, -1], l: [-24, 2, -76],   fov: 58 },     // the shard patch
        { t: 12.5, p: [0, 3.5, -1], l: [13, 4, -60],    fov: 58 },     // the factory door
        { t: 15.5, p: [0, 3.5, 0],  l: [4, 3, -30],     fov: 60 },     // the line forming
        { t: 17.5, p: [0, 3.5, 1],  l: [0, 3, 40],      fov: 64 },     // turn to the fight
        { t: 20.2, p: [0, 3.5, 3],  l: [0, 2.4, 34],    fov: 68 },
        { t: 21.4, p: [0, 2.2, 5],  l: [0, 1.2, 26],    fov: 76 },     // the slam
        { t: 22.4, p: [0, 3.4, 5],  l: [5.5, 3.4, 14],  fov: 62 },     // the banner goes in
        { t: 24.6, p: [0, 3.5, 4],  l: [0, 10, -22],    fov: 56 },     // back to the crystal
        { t: 27,   p: [0, 3.6, 6],  l: [0, 10, -22],    fov: 50 },
      ]);

      let s1 = 0, s2 = 0, s3 = 0;
      return {
        scene: scene, cam: cam, fp: true,
        update: function (t, dt, st) {
          track(cam, t);
          const march = win(t, 15.0, 19.5);
          const adv = win(t, 16.5, 21.2);
          const frozen = win(t, 21.4, 22.0) * (1 - win(t, 25.5, 26.6));
          const domeU = win(t, 24.4, 26.2);

          W.crystal.userData.tick(t, pulse(t, 24.2, 0.4, 1.2) * 0.2);
          W.base.userData.parts.tick(t);
          W.army.userData.tick(t, march > 0.02);
          W.army.userData.march(t, march * 48);
          W.wave.userData.tick(t, adv * 52, true);
          W.hands.userData.tick(t, { cast: pulse(t, 21.3, 0.18, 0.7) + pulse(t, 22.3, 0.2, 0.8) * 0.7 + pulse(t, 24.4, 0.3, 1.2) * 0.9,
                                     point: pulse(t, 14.6, 0.5, 1.4) });

          for (let i = 0; i < fresh.length; i++) {
            const u = fresh[i], k = clamp((t - 11.4 - i * 0.75) / 5.2, 0, 1);
            u.visible = k > 0;
            u.position.set(lerp(13, 4 - i * 3, k), 0, lerp(-58, -34, k));
            u.userData.walk(t + i, k < 1);
          }

          // Ground Slam: two rings, a camera drop, and the wave locked in ice.
          ringPop(slamRing, t, 21.35, 1.1, 0, 0.4, 8, 1, 34, 0.95);
          ringPop(slamRing2, t, 21.35, 0.7, 0, 0.5, 8, 1, 22, 0.9);
          for (let i = 0; i < W.wave.userData.list.length; i++) {
            const r = W.wave.userData.list[i];
            r.userData.frost.material.opacity = frozen * 0.85;
            if (frozen > 0.4) { r.position.y = 0; r.rotation.z = 0; }
          }

          // Hold the Line: the banner, and the ring that marks its field.
          banner.visible = t > 22.3;
          if (banner.visible) {
            const k = clamp((t - 22.3) / 0.6, 0, 1);
            banner.scale.setScalar(lerp(0.2, 1, smooth(k)));
            banner.rotation.y = Math.sin(t * 1.2) * 0.08;
            bannerRing.visible = true;
            bannerRing.position.set(5.5, 0.3, 14);
            bannerRing.scale.setScalar(lerp(2, 20, smooth(k)));
            bannerRing.material.opacity = 0.35 * k * (0.7 + Math.sin(t * 3) * 0.3);
          }

          // Bulwark: the dome over the crystal, which is the shot the whole
          // chapter has been walking toward.
          dome.userData.set(t, domeU);
          domeRing.visible = domeU > 0.01;
          domeRing.position.set(0, 0.4, -22);
          domeRing.scale.setScalar(lerp(2, 19, smooth(domeU)));
          domeRing.material.opacity = domeU * 0.6 * (0.7 + Math.sin(t * 4) * 0.3);

          ctx.fx.flash('#a8ecff', pulse(t, 21.4, 0.05, 0.35) * 0.55 + pulse(t, 24.5, 0.06, 0.5) * 0.4);
          st.shake = pulse(t, 21.4, 0.05, 0.8) * 1.5 + pulse(t, 24.5, 0.05, 0.7) * 0.7;

          if (!s1 && t > 14.6) { s1 = 1; ctx.score.set({ mood: 'drive', root: 196, tempo: 0.42 }); ctx.score.whoosh(0.7, 0.08); }
          if (!s2 && t > 21.35) { s2 = 1; ctx.score.boom(0.22); ctx.score.hit(0.12); }
          if (!s3 && t > 22.6) { s3 = 1; ctx.score.bell(1046, 0.11); ctx.score.shimmer(0.06); ctx.score.set({ mood: 'bright', tempo: 0.48 }); }
        },
      };
    },
  };

  // ═══ CHAPTER 2 — THORN ═════════════════════════════════════════════════════
  // Gloop's whole idea is *many, cheap, and it heals*. So this chapter has the
  // largest army in the film by a wide margin and the only ability that ends
  // with more friendly units on the field than it started with.
  const CH_THORN = {
    id: 'thorn', dur: 25, tone: '#7fe06a', mood: { root: 174, mood: 'drive', tempo: 0.44 }, card: HEROES[1], cardAt: 1.2,
    build: function (ctx) {
      const W = heroWorld({
        hero: 'thorn', race: 'gloop',
        stage: { fog: '#8fac74', fogNear: 76, fogFar: 350, skyTop: '#6f9a54', skyBot: '#dfeab4', fov: 64,
                 light: { hemi: 0.55, keyI: 0.7, sky: '#b8dc94', ground: '#22301a', key: '#e2f0b8', rim: '#9ae86a', rimI: 0.45 } },
        ground: { size: 400, seg: 48, amp: 2.4, flat: 44, color: '#355c2c', deco: '#27552f', deco2: '#9ae86a', kind: 'stalk', scatter: 72 },
        army: [{ role: 'infantry', n: 11, z: 0, gap: 2.4 }, { role: 'infantry', n: 10, z: -5, gap: 2.6 },
               { role: 'tank', n: 3, z: -11, gap: 7 }, { role: 'siege', n: 2, z: -17, gap: 9 }],
      });
      const scene = W.scene, cam = W.cam;

      const mist = field(scene, { count: 190, rx: 95, rz: 95, y0: 0.5, y1: 9, color: '#bce88a', size: 2.4, opacity: 0.12, rise: 0.5, sway: 1.4, cam: cam, minDist: 26 });
      const spores = field(scene, { count: 150, rx: 78, rz: 78, y0: 2, y1: 28, color: '#eaffa8', size: 0.6, opacity: 0.3, rise: 1.6, sway: 1.8, cam: cam, minDist: 12 });

      // Venom Spray: a cone of acid out of the claws, plus a puddle that stays.
      const spray = cone(scene, '#9ae86a', 0, 0, 0, 9, 30, { emissive: '#9ae86a', ei: 0.8, opacity: 0, own: true });
      spray.material.blending = THREE.AdditiveBlending;
      spray.material.depthWrite = false;
      spray.rotation.x = Math.PI / 2;
      const puddle = ringFx(scene, '#8ade5a', 0.5);
      const drops = field(scene, { count: 120, rx: 14, rz: 14, y0: 0.4, y1: 7, color: '#c6ff8a', size: 1.0, opacity: 0, rise: 0.8, sway: 0.8, cam: cam, minDist: 12 });
      drops.position.set(0, 0, 34);

      // Hatch the Brood: the ground splits and the babies come up out of it.
      const crack = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const c = box(crack, '#2c4a18', rnd(-13, 13), 0.1, rnd(-8, 8), rnd(0.9, 2.2), 0.16, rnd(7, 15), { emissive: '#a8e650', ei: 0.75, own: true });
        c.rotation.y = rnd(-0.6, 0.6);
      }
      crack.position.set(0, 0, 22);
      crack.visible = false;
      scene.add(crack);
      const brood = [];
      for (let i = 0; i < 14; i++) {
        const b = makeUnit('gloop', 'infantry', '#c6ff8a');
        b.scale.setScalar(0.85);
        b.position.set(rnd(-13, 13), -3, 22 + rnd(-8, 8));
        b.userData.t0 = rnd(0, 1.1);
        b.visible = false;
        scene.add(b); brood.push(b);
      }
      const devourRing = ringFx(scene, '#c6ff8a', 0.9);

      const track = keyed([
        { t: 0,    p: [0, 3.2, 2],  l: [0.3, 1.1, 0.7], fov: 68 },
        { t: 2.4,  p: [0, 3.3, 1],  l: [0, 8, -22],     fov: 62 },     // the crystal, seen from a swamp
        { t: 5.5,  p: [0, 3.3, 0],  l: [10, 3, -60],    fov: 60 },     // the hatchery
        { t: 9.0,  p: [0, 3.3, -1], l: [0, 3, -34],     fov: 62 },     // the swarm massing
        { t: 11.5, p: [0, 3.3, 0],  l: [0, 3, 40],      fov: 66 },     // turn on the enemy
        { t: 13.6, p: [0, 3.2, 3],  l: [0, 2.6, 36],    fov: 70 },     // spray
        { t: 16.6, p: [0, 3.2, 7],  l: [2, 2.0, 22],    fov: 74 },     // devour
        { t: 19.0, p: [0, 3.4, 6],  l: [0, 1.4, 22],    fov: 70 },     // the ground splits
        { t: 21.5, p: [0, 4.0, 2],  l: [0, 3.0, 26],    fov: 66 },
        { t: 25,   p: [0, 3.6, -2], l: [0, 3.4, 34],    fov: 62 },
      ]);

      let s1 = 0, s2 = 0, s3 = 0;
      return {
        scene: scene, cam: cam, fp: true,
        update: function (t, dt, st) {
          track(cam, t);
          const march = win(t, 8.8, 13.2);
          const adv = win(t, 10.5, 16.0);
          const sprayU = clamp((t - 13.4) / 1.9, 0, 1);
          const hatch = win(t, 18.9, 20.4);

          W.crystal.userData.tick(t, 0);
          W.base.userData.parts.tick(t);
          W.army.userData.tick(t, march > 0.02);
          W.army.userData.march(t, march * 56);
          W.wave.userData.tick(t, adv * 56, true);
          W.hands.userData.tick(t, { cast: (t > 13.3 && t < 15.4 ? 1 - Math.abs((t - 14.3) / 1.0) : 0) + pulse(t, 16.8, 0.15, 0.6) + pulse(t, 19.0, 0.25, 1.0),
                                     point: pulse(t, 9.4, 0.5, 1.5) });
          mist.userData.tick(t); spores.userData.tick(t);

          // Spray, then the puddle it leaves — the point of Venom Spray is that
          // what it coats keeps dying, so the puddle outlives the animation.
          const sv = t > 13.3 && t < 15.6;
          spray.visible = sv;
          if (sv) {
            const k = 1 - Math.abs((t - 14.4) / 1.2);
            spray.position.set(0, 3.0, 4 + sprayU * 12);
            spray.scale.set(0.3 + sprayU * 1.1, 0.6 + sprayU * 0.9, 0.3 + sprayU * 1.1);
            spray.material.opacity = clamp(k, 0, 1) * 0.42;
          }
          const pu = clamp((t - 14.2) / 8, 0, 1);
          puddle.visible = t > 14.2;
          puddle.position.set(0, 0.25, 34);
          puddle.scale.setScalar(lerp(3, 17, smooth(clamp((t - 14.2) / 1.2, 0, 1))));
          puddle.material.opacity = (1 - pu) * 0.45 * (0.75 + Math.sin(t * 4) * 0.25);
          drops.userData.tick(t);
          drops.material.opacity = (1 - pu) * 0.5;

          // Devour: a short, close ring, and the wave visibly thinning after it.
          ringPop(devourRing, t, 16.75, 0.9, 0, 1.2, 16, 1, 12, 0.9);
          const list = W.wave.userData.list;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const doom = i % 3 === 0 ? 15.0 : i % 3 === 1 ? 17.0 : 21.4;
            const d = clamp((t - doom) / 1.4, 0, 1);
            r.userData.die(d);
          }

          crack.visible = t > 18.85;
          if (crack.visible) {
            const k = clamp((t - 18.85) / 0.7, 0, 1);
            crack.scale.set(lerp(0.1, 1, smooth(k)), 1, lerp(0.1, 1, smooth(k)));
          }
          for (let i = 0; i < brood.length; i++) {
            const b = brood[i], k = clamp((t - 19.1 - b.userData.t0) / 0.9, 0, 1);
            b.visible = k > 0;
            b.position.y = lerp(-3, 0, smooth(k));
            if (k >= 1) { b.position.z += dt * 7; b.userData.walk(t + i, true); }
          }

          // Lifesteal, told the only way a first-person film can tell it: the
          // frame itself flushes green every time the hero lands a hit.
          ctx.fx.flash('#9ae86a', pulse(t, 14.4, 0.2, 1.0) * 0.22 + pulse(t, 16.9, 0.1, 0.9) * 0.34 + hatch * 0.18);
          st.shake = pulse(t, 16.85, 0.05, 0.5) * 0.8 + pulse(t, 19.0, 0.1, 1.2) * 1.4;

          if (!s1 && t > 9.4) { s1 = 1; ctx.score.whoosh(0.6, 0.08); ctx.score.set({ mood: 'drive', tempo: 0.4 }); }
          if (!s2 && t > 16.8) { s2 = 1; ctx.score.hit(0.13); }
          if (!s3 && t > 19.0) { s3 = 1; ctx.score.boom(0.24); ctx.score.set({ mood: 'dark', root: 155, tempo: 0.38 }); }
        },
      };
    },
  };

  // ═══ CHAPTER 3 — PRISM ═════════════════════════════════════════════════════
  // Aether's one structural idea is that its army does not walk to the fight —
  // it arrives at a Warp Conduit you built forward. That is genuinely hard to
  // notice while playing, so this chapter spends a whole beat on units
  // materialising in front of the camera, and then blinks the camera itself.
  const CH_PRISM = {
    id: 'prism', dur: 25, tone: '#c79bff', mood: { root: 220, mood: 'bright', tempo: 0.46 }, card: HEROES[2], cardAt: 1.2,
    build: function (ctx) {
      const W = heroWorld({
        hero: 'prism', race: 'aether',
        stage: { fog: '#6a5f9c', fogNear: 80, fogFar: 400, skyTop: '#3b2f6e', skyBot: '#c0a8ee', fov: 62,
                 light: { hemi: 0.55, keyI: 0.72, sky: '#b9a4f4', ground: '#221c42', key: '#e4d8ff', rim: '#b98cff', rimI: 0.55 } },
        ground: { size: 420, seg: 48, amp: 3.4, flat: 46, color: '#4a4478', deco: '#7a63b8', kind: 'spike', scatter: 74 },
        army: [{ role: 'infantry', n: 5, z: 0, gap: 4.4 }, { role: 'tank', n: 2, z: -8, gap: 9 }, { role: 'siege', n: 2, z: -15, gap: 9 }],
      });
      const scene = W.scene, cam = W.cam;

      const dust = field(scene, { count: 240, rx: 80, rz: 80, y0: 1, y1: 34, color: '#d4c0ff', size: 0.7, opacity: 0.55, rise: 1.1, sway: 1.6, cam: cam, minDist: 14 });

      // Three forward Warp Conduits and the squad that warps in at them.
      const conduits = [];
      [-16, 0, 16].forEach((x, i) => {
        const c = makeBuilding('aether', 'supply');
        c.position.set(x * 1.5, 0, -16 - i % 2 * 4);
        scene.add(c); conduits.push(c);
      });
      const warped = [];
      for (let i = 0; i < 8; i++) {
        const u = makeUnit('aether', i < 5 ? 'infantry' : 'tank');
        u.position.set(-24 + i * 6.8, 0, -13 + rnd(-3, 3));
        u.visible = false;
        scene.add(u);
        const bm = beam(scene, '#c79bff', 1.5, 26, 0);
        bm.position.set(u.position.x, 13, u.position.z);
        warped.push({ u: u, bm: bm, t0: 6.4 + i * 0.24 });
      }

      // Static Prison: a lattice cage. Built out of eight thin bars rather than
      // a wireframe box so the bars catch light and read as solid.
      const cage = new THREE.Group();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const b = box(cage, '#b9a4e8', Math.cos(a) * 9, 5, Math.sin(a) * 9, 0.42, 10, 0.42, { emissive: '#c79bff', ei: 0.5, own: true });
        b.rotation.y = -a;
      }
      const capT = new THREE.Mesh(gTorus(), ownMat('#b9a4e8', { emissive: '#c79bff', ei: 0.6 }));
      capT.rotation.x = Math.PI / 2; capT.scale.setScalar(19); capT.position.y = 10; cage.add(capT);
      const capB = capT.clone(); capB.position.y = 0.4; cage.add(capB);
      cage.position.set(0, 0, 50);
      cage.visible = false;
      scene.add(cage);

      const novaRing = ringFx(scene, '#e0ccff', 0.95);
      const novaRing2 = ringFx(scene, '#ffffff', 0.85);
      const blinkTrail = [];
      for (let i = 0; i < 5; i++) { const r = ringFx(scene, '#c79bff', 0.6); r.rotation.x = 0; blinkTrail.push(r); }

      const track = keyed([
        { t: 0,    p: [0, 3.4, 2],   l: [0.3, 1.2, 0.6], fov: 66 },
        { t: 2.4,  p: [0, 3.5, 1],   l: [0, 9, -22],     fov: 60 },
        { t: 5.2,  p: [0, 3.5, 4],   l: [0, 4, -16],     fov: 54 },    // the conduits, forward
        { t: 9.6,  p: [0, 3.5, 6],   l: [-16, 3, -13],   fov: 58 },    // the squad warping in
        { t: 12.0, p: [0, 3.5, 6],   l: [0, 3, 40],      fov: 64 },    // turn on the enemy
        { t: 13.9, p: [0, 3.5, 7],   l: [0, 3, 40],      fov: 88 },    // the blink stretch
        { t: 14.1, p: [0, 3.5, 33],  l: [0, 3, 62],      fov: 58 },    // — and out, 26 forward
        { t: 16.6, p: [0, 3.5, 34],  l: [0, 4, 50],      fov: 58 },    // the prison
        { t: 19.4, p: [0, 3.6, 30],  l: [0, 5, 48],      fov: 62 },
        { t: 20.6, p: [0, 4.2, 18],  l: [0, 6, -22],     fov: 70 },    // turn: the nova comes from home
        { t: 23.0, p: [0, 4.0, 22],  l: [0, 4, 30],      fov: 66 },
        { t: 25,   p: [0, 3.8, 26],  l: [0, 3.6, 34],    fov: 62 },
      ]);

      let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      return {
        scene: scene, cam: cam, fp: true,
        update: function (t, dt, st) {
          track(cam, t);
          const march = win(t, 11.0, 15.0);
          const adv = win(t, 10.0, 16.5);
          const blink = pulse(t, 13.55, 0.45, 0.5);
          const prison = win(t, 16.4, 17.1) * (1 - win(t, 21.4, 22.4));
          const nova = clamp((t - 20.7) / 2.2, 0, 1);

          W.crystal.userData.tick(t, pulse(t, 20.7, 0.3, 1.4) * 0.4);
          W.base.userData.parts.tick(t);
          W.army.userData.tick(t, march > 0.02);
          W.army.userData.march(t, march * 44);
          W.wave.userData.tick(t, adv * 46, prison < 0.4);
          W.hands.userData.tick(t, { cast: blink + pulse(t, 16.5, 0.2, 0.9) + pulse(t, 20.7, 0.3, 1.4),
                                     point: pulse(t, 11.0, 0.5, 1.4) });
          dust.userData.tick(t);
          conduits.forEach(c => c.userData.tick(t));

          for (let i = 0; i < warped.length; i++) {
            const w = warped[i], k = clamp((t - w.t0) / 0.9, 0, 1);
            w.u.visible = k > 0.04;
            w.u.scale.setScalar(lerp(0.2, 1, smooth(k)));
            w.bm.material.opacity = (k < 1 ? Math.sin(k * Math.PI) : 0) * 0.3;
            w.bm.scale.set(1.5 * (1 + (1 - k) * 0.8), 26, 1.5 * (1 + (1 - k) * 0.8));
            if (k >= 1) { w.u.position.z += dt * (march > 0.02 ? 9 : 0); w.u.userData.walk(t + i, march > 0.02); }
            else w.u.userData.walk(t + i, false);
          }

          // Phase Shift: the camera really does jump — the track has a 0.2s gap
          // between two positions 26 apart, and the flash covers the seam. A
          // blink you can see the join in is not a blink.
          for (let i = 0; i < blinkTrail.length; i++) {
            const r = blinkTrail[i];
            const u = clamp((t - 13.55 - i * 0.05) / 0.6, 0, 1);
            r.visible = u > 0.01 && u < 0.99;
            r.position.set(0, 2 + i * 0.5, lerp(8, 32, u));
            r.rotation.x = Math.PI / 2;
            r.scale.setScalar(lerp(3, 9, u));
            r.material.opacity = (1 - u) * 0.6;
          }

          cage.visible = prison > 0.01;
          if (cage.visible) {
            cage.scale.set(lerp(0.15, 1, prison), lerp(0.15, 1, prison), lerp(0.15, 1, prison));
            cage.rotation.y = t * 0.4;
            capT.rotation.z = t * 0.9; capB.rotation.z = -t * 0.9;
          }
          const list = W.wave.userData.list;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            r.userData.frost.material.opacity = prison * 0.7;
            // Rift Nova hurls what it catches away from the crystal.
            if (nova > 0) {
              const push = smooth(nova) * 26 * (1 + (i % 5) * 0.2);
              r.position.z = r.userData.home.z - adv * 46 + push;
              r.position.y = Math.sin(smooth(nova) * Math.PI) * 5 * (1 + (i % 3) * 0.3);
              r.rotation.x = smooth(nova) * 4;
              r.userData.die(clamp((nova - 0.45) / 0.5, 0, 1));
            }
          }

          const nr = ringPop(novaRing, t, 20.7, 2.4, 0, 1.0, -22, 2, 96, 0.9);
          ringPop(novaRing2, t, 20.7, 1.7, 0, 1.4, -22, 2, 64, 0.85);

          ctx.fx.flash('#e6d8ff', pulse(t, 13.6, 0.08, 0.4) * 0.85 + pulse(t, 20.75, 0.08, 0.7) * 0.5 + pulse(t, 16.5, 0.06, 0.4) * 0.25);
          st.shake = pulse(t, 20.75, 0.06, 1.2) * 1.6 + pulse(t, 16.5, 0.04, 0.4) * 0.5;

          if (!s1 && t > 6.4) { s1 = 1; ctx.score.shimmer(0.07); }
          if (!s2 && t > 13.55) { s2 = 1; ctx.score.whoosh(0.4, 0.11); ctx.score.set({ mood: 'drive', root: 233, tempo: 0.4 }); }
          if (!s3 && t > 16.5) { s3 = 1; ctx.score.hit(0.10); ctx.score.bell(1568, 0.06); }
          if (!s4 && t > 20.7) { s4 = 1; ctx.score.boom(0.26); ctx.score.shimmer(0.09); ctx.score.set({ mood: 'bright', root: 246, tempo: 0.44 }); }
        },
      };
    },
  };

  // ═══ CHAPTER 4 — EMBER ═════════════════════════════════════════════════════
  // Night, so that fire is the only light source and every ability is legible
  // by what it illuminates. This is also the chapter that shows towers and air
  // units doing work, which no other chapter has room for.
  const CH_EMBER = {
    id: 'ember', dur: 25, tone: '#ff8a3a', mood: { root: 155, mood: 'dark', tempo: 0.42 }, card: HEROES[3], cardAt: 1.2,
    build: function (ctx) {
      const W = heroWorld({
        hero: 'ember', race: 'forge',
        stage: { fog: '#241a22', fogNear: 46, fogFar: 265, skyTop: '#100b16', skyBot: '#4a2320', fov: 64,
                 light: { hemi: 0.30, keyI: 0.26, sky: '#4a2f3c', ground: '#120b0e', key: '#ffb488', rim: '#ff6a3a', rimI: 0.45 } },
        ground: { size: 400, seg: 48, amp: 3.6, flat: 44, color: '#33242a', deco: '#2a1f1c', kind: 'burnt', rock: '#3a2f2c', scatter: 70 },
        army: [{ role: 'infantry', n: 6, z: 0, gap: 3.6 }, { role: 'tank', n: 2, z: -7, gap: 8 }, { role: 'siege', n: 3, z: -14, gap: 8 }],
      });
      const scene = W.scene, cam = W.cam;

      const embers = field(scene, { count: 320, rx: 80, rz: 80, y0: 0.5, y1: 40, color: '#ff9a3a', size: 0.7, opacity: 0.7, rise: 2.6, sway: 1.6, cam: cam, minDist: 14 });

      // A hazard is a real mechanic in the game (Game.hazards), so the film
      // draws it the way the game does: a lit patch of ground that things are
      // standing in, not a puff of smoke in the air.
      function firePatch(w, d) {
        const g = new THREE.Group();
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a2a'), transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const p = new THREE.Mesh(gPlane(), m);
        p.rotation.x = -Math.PI / 2; p.scale.set(w, d, 1); p.position.y = 0.18;
        g.add(p);
        const li = new THREE.PointLight(new THREE.Color('#ff7a2a'), 0, 55, 2);
        li.position.y = 5; g.add(li);
        const tongues = [];
        for (let i = 0; i < 22; i++) {
          const c = cone(g, i % 2 ? '#ffb14a' : '#ff5a2a', rnd(-w / 2, w / 2), 1.4, rnd(-d / 2, d / 2), rnd(0.5, 1.5), rnd(2, 5), { emissive: '#ff7a2a', ei: 0.45, opacity: 0.6, own: true });
          c.material.blending = THREE.AdditiveBlending;
          c.material.depthWrite = false;
          c.userData.ph = rnd(0, 6.28);
          tongues.push(c);
        }
        g.userData.set = function (t, k) {
          g.visible = k > 0.01;
          m.opacity = k * 0.28;
          li.intensity = k * 3.6;
          for (let i = 0; i < tongues.length; i++) {
            const c = tongues[i], f = Math.sin(t * 7 + c.userData.ph) * 0.5 + 0.5;
            c.scale.y = (1.6 + f * 2.6) * k;
            c.position.y = c.scale.y * 0.5;
            c.material.opacity = k * (0.22 + f * 0.26);
          }
        };
        return g;
      }
      const line = firePatch(7, 40);
      line.position.set(0, 0, 36);
      scene.add(line);
      const storm = firePatch(48, 48);
      storm.position.set(0, 0, 52);
      scene.add(storm);
      const flareRing = ringFx(scene, '#ffb14a', 0.9);

      // Air support crossing the sky, silhouetted against the fire. One of the
      // two shots in the film that tells you air units exist at all.
      const air = [];
      for (let i = 0; i < 4; i++) {
        const a = makeUnit('forge', 'air');
        a.position.set(-70 + i * 9, 22 + i * 2.4, -30);
        scene.add(a); air.push(a);
      }

      const track = keyed([
        { t: 0,    p: [0, 3.4, 2],  l: [0.4, 1.6, 0.2], fov: 66 },     // the barrel
        { t: 2.6,  p: [0, 3.5, 1],  l: [0, 9, -22],     fov: 60 },
        { t: 5.4,  p: [0, 3.5, 0],  l: [-9, 4, -44],    fov: 60 },     // towers awake in the dark
        { t: 8.2,  p: [0, 3.5, 0],  l: [0, 14, -30],    fov: 62 },     // the air wing overhead
        { t: 10.6, p: [0, 3.5, 1],  l: [0, 3, 40],      fov: 66 },
        { t: 12.6, p: [0, 3.4, 2],  l: [0, 1.6, 26],    fov: 72 },     // the cinder line
        { t: 15.6, p: [0, 3.6, 3],  l: [4, 3, 44],      fov: 64 },     // the flare
        { t: 18.4, p: [0, 3.8, 2],  l: [0, 5, 52],      fov: 68 },     // firestorm
        { t: 21.6, p: [0, 6.2, -6], l: [0, 6, 46],      fov: 72 },
        { t: 25,   p: [0, 5.0, -2], l: [0, 5, 40],      fov: 64 },
      ]);

      let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      return {
        scene: scene, cam: cam, fp: true,
        update: function (t, dt, st) {
          track(cam, t);
          const march = win(t, 10.0, 14.0);
          const adv = win(t, 9.5, 16.0);
          const lineU = win(t, 12.5, 13.4) * (1 - win(t, 22.5, 24.5));
          const flare = win(t, 15.7, 16.3) * (1 - win(t, 21.0, 22.0));
          const stormU = win(t, 18.4, 19.6) * (1 - win(t, 24.0, 25.0));

          W.crystal.userData.tick(t, 0);
          W.base.userData.parts.tick(t);
          W.army.userData.tick(t, march > 0.02);
          W.army.userData.march(t, march * 34);
          W.wave.userData.tick(t, adv * 50, true);
          W.hands.userData.tick(t, { cast: pulse(t, 12.5, 0.2, 1.1) + pulse(t, 15.7, 0.15, 0.8) + pulse(t, 18.4, 0.3, 1.6),
                                     point: pulse(t, 10.0, 0.5, 1.4) });
          embers.userData.tick(t);

          line.userData.set(t, lineU);
          storm.userData.set(t, stormU);

          for (let i = 0; i < air.length; i++) {
            const a = air[i];
            a.position.x = -70 + i * 9 + ((t * 13 + i * 22) % 190);
            a.userData.walk(t + i, true);
          }

          // Flare marks the big one; everything else in frame then hits it.
          const list = W.wave.userData.list;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            r.userData.mark.material.opacity = (i === 0 ? flare : flare * 0.25) * 0.9;
            const zNow = r.userData.home.z - adv * 50;
            const inLine = Math.abs(r.position.x) < 5 && zNow > 6 && zNow < 48;
            const inStorm = zNow > 30 && zNow < 76;
            let doom = 99;
            if (i === 0) doom = 17.6;
            else if (inLine) doom = 13.6 + (i % 3) * 0.5;
            else if (inStorm) doom = 19.6 + (i % 5) * 0.5;
            r.userData.die(clamp((t - doom) / 1.3, 0, 1));
          }
          ringPop(flareRing, t, 15.7, 0.8, list[0] ? list[0].position.x : 0, 0.4, 40, 1, 13, 0.9);

          ctx.fx.flash('#ff9a3a', pulse(t, 12.55, 0.06, 0.5) * 0.28 + pulse(t, 18.45, 0.1, 0.9) * 0.55 + stormU * 0.10);
          st.shake = pulse(t, 18.45, 0.08, 1.4) * 1.7 + pulse(t, 12.55, 0.05, 0.5) * 0.6 + stormU * 0.12;

          if (!s1 && t > 10.0) { s1 = 1; ctx.score.whoosh(0.6, 0.08); }
          if (!s2 && t > 12.5) { s2 = 1; ctx.score.hit(0.11); ctx.score.set({ mood: 'drive', root: 164, tempo: 0.38 }); }
          if (!s3 && t > 15.7) { s3 = 1; ctx.score.bell(880, 0.07); }
          if (!s4 && t > 18.4) { s4 = 1; ctx.score.boom(0.30); ctx.score.riser(2.5, 0.05); }
        },
      };
    },
  };

  // ═══ CHAPTER 5 — VALE ══════════════════════════════════════════════════════
  // The turn. Every chapter so far opened on a hero already winning; this one
  // opens on the crystal nearly gone and the army on the floor, so that the
  // heal is the first thing in the film that changes the situation rather than
  // extending it. It is also the only chapter where the hero's ability is
  // pointed at their own side, which is the entire argument for a support hero.
  const CH_VALE = {
    id: 'vale', dur: 25, tone: '#6ef2b0', mood: { root: 130, mood: 'dark', tempo: 0.56 }, card: HEROES[4], cardAt: 1.2,
    build: function (ctx) {
      const W = heroWorld({
        hero: 'vale', race: 'aether', dimCrystal: true,
        stage: { fog: '#4a4250', fogNear: 62, fogFar: 310, skyTop: '#2b2542', skyBot: '#7d6a78', fov: 62,
                 light: { hemi: 0.46, keyI: 0.4, sky: '#7c72a0', ground: '#1e1a2c', key: '#cfc0e0', rim: '#6ef2b0', rimI: 0.35 } },
        ground: { size: 400, seg: 48, amp: 3.0, flat: 46, color: '#3d4442', deco: '#3a3340', kind: 'spike', rock: '#4a4a4e', scatter: 62 },
        army: [{ role: 'infantry', n: 6, z: 0, gap: 4.0 }, { role: 'tank', n: 2, z: -8, gap: 9 }, { role: 'siege', n: 2, z: -15, gap: 9 }],
        waveN: 22, waveZ: 54,
      });
      const scene = W.scene, cam = W.cam;

      // Cracks across the crystal, which close on the Mend Pulse. The crystal
      // is the one prop in the film the viewer has watched for two minutes, so
      // repairing it in close-up is worth four extra meshes.
      const cracks = [];
      for (let i = 0; i < 9; i++) {
        const c = box(W.crystal, '#22363f', rnd(-0.8, 0.8), rnd(-2.0, 2.0), 0.9, rnd(0.035, 0.075), rnd(0.6, 1.5), 0.7, { own: true });
        c.rotation.z = rnd(-0.8, 0.8);
        cracks.push(c);
      }
      const mendRing = ringFx(scene, '#6ef2b0', 0.95);
      const mendRing2 = ringFx(scene, '#ffffff', 0.7);
      const slipRing = ringFx(scene, '#a8ffe0', 0.8);

      const sanct = makeDome(scene, '#6ef2b0', 19);
      sanct.position.set(0, 0, 24);
      const sanctRing = ringFx(scene, '#a8ffe0', 0.8);
      const motes = field(scene, { count: 220, rx: 40, rz: 40, y0: 0.5, y1: 22, color: '#8effc8', size: 0.8, opacity: 0, rise: 1.8, sway: 1.2, cam: cam, minDist: 13 });
      motes.position.set(0, 0, 6);

      // Wounded: friendly units down on the ground until the pulse lands.
      const hurt = [];
      for (let i = 0; i < 7; i++) {
        const u = makeUnit('aether', i < 5 ? 'infantry' : 'tank');
        u.position.set(rnd(-13, 13), 0, rnd(5, 20));
        u.rotation.z = rnd(0.8, 1.15) * (i % 2 ? 1 : -1);
        u.rotation.y = rnd(-1, 1);
        scene.add(u); hurt.push(u);
      }

      const track = keyed([
        { t: 0,    p: [0, 3.4, 6],  l: [-1.2, 1.4, 4.4], fov: 66 },    // the lantern
        { t: 2.6,  p: [0, 3.4, 6],  l: [-6, 1.0, 14],    fov: 62 },    // your own, down
        { t: 5.4,  p: [0, 3.4, 4],  l: [0, 8, -22],      fov: 58 },    // the crystal, failing
        { t: 8.2,  p: [0, 3.2, -2], l: [0, 7, -20],      fov: 54 },    // close on the cracks
        { t: 11.9, p: [0, 3.3, 0],  l: [0, 8, -21],      fov: 52 },    // it comes back
        { t: 13.8, p: [0, 3.4, 2],  l: [0, 3, 22],       fov: 64 },    // turn: slipstream past you
        { t: 16.0, p: [0, 3.5, 3],  l: [0, 3, 30],       fov: 66 },
        { t: 18.2, p: [0, 3.7, 4],  l: [0, 4, 26],       fov: 68 },    // sanctuary
        { t: 21.0, p: [0, 5.2, -4], l: [0, 5, 26],       fov: 70 },
        { t: 23.2, p: [0, 5.6, -8], l: [0, 9, -22],      fov: 56 },    // a crystal that is lit
        { t: 25,   p: [0, 6.0, -4], l: [0, 9, -22],      fov: 52 },
      ]);

      let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
      return {
        scene: scene, cam: cam, fp: true,
        update: function (t, dt, st) {
          track(cam, t);
          const heal = win(t, 10.4, 12.6);            // Mend Pulse
          const slip = win(t, 14.2, 15.4);            // Slipstream
          const sanctU = win(t, 17.2, 18.6) * (1 - win(t, 21.4, 22.6));
          const adv = win(t, 3.0, 14.0);

          W.crystal.userData.tick(t, pulse(t, 10.6, 0.4, 1.4) * 0.3);
          // The crystal comes back: emissive, light and glow all ride `heal`.
          W.crystal.userData.core.material.emissiveIntensity = lerp(0.16, 0.6, heal);
          W.crystal.userData.light.intensity = lerp(0.35, 1.7, heal);
          W.crystal.userData.glow.material.opacity = lerp(0.22, 0.52, heal);
          for (let i = 0; i < cracks.length; i++) {
            cracks[i].material.opacity = 1 - heal;
            cracks[i].visible = heal < 0.98;
            cracks[i].scale.y = lerp(1, 0.1, heal);
          }
          W.S.lights.hemi.intensity = lerp(0.46, 0.66, heal);
          W.S.lights.key.intensity = lerp(0.4, 0.85, heal);
          scene.fog.color.lerpColors(new THREE.Color('#4a4250'), new THREE.Color('#9fc6d2'), heal);
          // The sky has to come back with the light, or the ground brightens
          // under a night sky and the shot reads as a lighting bug rather than
          // as dawn. Same idiom the cold open uses to take the sky away.
          const skyM = scene.children[0] && scene.children[0].material;
          if (skyM && skyM.uniforms) {
            skyM.uniforms.a.value.lerpColors(new THREE.Color('#2b2542'), new THREE.Color('#5f9ed0'), heal);
            skyM.uniforms.b.value.lerpColors(new THREE.Color('#7d6a78'), new THREE.Color('#ffdcb4'), heal);
          }

          W.base.userData.parts.tick(t);
          W.army.userData.tick(t, slip > 0.02);
          W.army.userData.march(t, slip * 62 + win(t, 15.4, 22) * 24);
          W.wave.userData.tick(t, adv * 30, true);
          W.hands.userData.tick(t, { cast: pulse(t, 10.5, 0.35, 1.6) + pulse(t, 14.2, 0.2, 0.9) + pulse(t, 17.2, 0.4, 1.8),
                                     point: pulse(t, 13.9, 0.4, 1.2) });

          for (let i = 0; i < hurt.length; i++) {
            const u = hurt[i], k = clamp((t - 10.7 - i * 0.14) / 0.9, 0, 1);
            u.rotation.z = lerp(u.rotation.z || 0, 0, k) * (1 - k);
            if (k > 0.5) { u.position.z += dt * (slip > 0.05 ? 26 : 2.5); u.userData.walk(t + i, true); }
          }

          ringPop(mendRing, t, 10.5, 2.0, 0, 0.5, 4, 2, 40, 0.9);
          ringPop(mendRing2, t, 10.5, 1.3, 0, 0.7, 4, 2, 26, 0.8);
          ringPop(slipRing, t, 14.2, 1.2, 0, 0.5, 10, 3, 32, 0.8);
          motes.userData.tick(t);
          motes.material.opacity = heal * 0.55;

          // Sanctuary, and the wave breaking on it — the only time in the film
          // an enemy is stopped by something that does no damage at all.
          sanct.userData.set(t, sanctU);
          sanctRing.visible = sanctU > 0.01;
          sanctRing.position.set(0, 0.4, 24);
          sanctRing.scale.setScalar(lerp(3, 26, smooth(sanctU)));
          sanctRing.material.opacity = sanctU * 0.55 * (0.7 + Math.sin(t * 4) * 0.3);

          const list = W.wave.userData.list;
          for (let i = 0; i < list.length; i++) {
            const r = list[i];
            const zNow = r.userData.home.z - adv * 30;
            if (sanctU > 0.3 && zNow < 46) {
              const bounce = smooth(clamp((t - 18.2 - (i % 5) * 0.18) / 0.7, 0, 1));
              r.position.z = zNow + bounce * 14;
              r.position.y = Math.sin(bounce * Math.PI) * 3.4;
              r.rotation.x = bounce * 3;
              r.userData.die(clamp((t - 18.6 - (i % 6) * 0.22) / 1.2, 0, 1));
            }
          }

          ctx.fx.flash('#a8ffe0', pulse(t, 10.6, 0.15, 1.2) * 0.42 + pulse(t, 17.3, 0.15, 1.0) * 0.30);
          st.shake = pulse(t, 17.3, 0.06, 0.7) * 0.9 + pulse(t, 18.4, 0.08, 0.8) * 0.5;

          if (!s1 && t > 5.4) { s1 = 1; ctx.score.set({ mood: 'dark', root: 123, tempo: 0.6 }); }
          if (!s2 && t > 10.5) { s2 = 1; ctx.score.bell(1046, 0.13); ctx.score.shimmer(0.09); ctx.score.set({ mood: 'bright', root: 174, tempo: 0.5 }); }
          if (!s3 && t > 14.2) { s3 = 1; ctx.score.whoosh(0.7, 0.10); ctx.score.set({ mood: 'drive', root: 196, tempo: 0.44 }); }
          if (!s4 && t > 17.3) { s4 = 1; ctx.score.boom(0.18); ctx.score.bell(1568, 0.10); }
        },
      };
    },
  };

  // ═══ CHAPTER 6 — THE FIVE ══════════════════════════════════════════════════
  // Third person, once, at the end. The camera leaving the hero's eyes is the
  // film handing the player back their own body — the next thing they see is
  // the start screen with a hero on it, and it should be one of these five.
  const CH_END = {
    id: 'end', dur: 18, tone: '#7fe9ff', mood: { root: 196, mood: 'bright', tempo: 0.46 },
    build: function (ctx) {
      const S = stage({ fog: '#9dd0e0', fogNear: 70, fogFar: 420, skyTop: '#4f9ede', skyBot: '#ffe8c4', fov: 48,
                        light: { hemi: 0.6, keyI: 0.88, sky: '#dff0ff', ground: '#33481f', key: '#fff0d0', rim: '#7fe9ff', rimI: 0.6 } });
      const scene = S.scene, cam = S.cam;

      const ground = makeGround({ size: 460, seg: 52, amp: 3.4, flat: 40, color: '#4f8f52', deco: '#4a3628', deco2: '#3a9a54', scatter: 88 });
      scene.add(ground);

      const crystal = makeCrystal(3.6);
      crystal.position.set(0, 15, -34);
      scene.add(crystal);
      const plinth = new THREE.Group();
      cyl(plinth, '#7d8b96', 0, 3, 0, 13, 6);
      cyl(plinth, '#5d6b76', 0, 6.4, 0, 10.5, 1.6);
      plinth.position.set(0, 0, -34);
      scene.add(plinth);

      // The three factions drawn up behind the five, so the last image of the
      // film is everyone on the same side of the frame.
      const backline = [];
      [['forge', -46], ['gloop', 0], ['aether', 46]].forEach(f => {
        const a = makeArmy(f[0], [{ role: 'infantry', n: 6, z: 0, gap: 4 }, { role: 'tank', n: 2, z: -7, gap: 9 }]);
        a.position.set(f[1], 0, -20);
        a.rotation.y = Math.PI;
        scene.add(a); backline.push(a);
      });

      const figs = [];
      HEROES.forEach((h, i) => {
        const f = makeHeroFigure(h.id);
        f.position.set((i - 2) * 7.4, 0, 4 + Math.abs(i - 2) * 1.6);
        f.rotation.y = Math.PI;
        f.scale.setScalar(1.5);
        scene.add(f); figs.push(f);
      });

      const motes = field(scene, { count: 340, rx: 90, rz: 90, y0: 1, y1: 60, color: PAL.shard, size: 0.9, opacity: 0.6, rise: 2.4, sway: 2, cam: cam, minDist: 16 });
      const burst = ringFx(scene, '#ffffff', 0.9);

      const track = keyed([
        { t: 0,   p: [0, 4.5, 40],  l: [0, 4, 0],    fov: 40 },        // behind them, low
        { t: 5,   p: [-16, 7, 34],  l: [0, 5, -6],   fov: 46 },
        { t: 9,   p: [-6, 10, 26],  l: [0, 8, -22],  fov: 52 },
        { t: 12.5,p: [0, 16, 30],   l: [0, 14, -34], fov: 50 },        // up and over, to the crystal
        { t: 18,  p: [0, 34, 62],   l: [0, 16, -34], fov: 44 },
      ]);

      let s1 = 0, s2 = 0;
      return {
        scene: scene, cam: cam,
        update: function (t, dt, st) {
          track(cam, t);
          const raise = win(t, 6.2, 7.6);
          const bloom = win(t, 8.0, 11.0);
          crystal.userData.tick(t, bloom * 0.25 + pulse(t, 8.2, 0.5, 2.0) * 0.3);
          crystal.userData.light.intensity = 1.5 + bloom * 3.2;
          crystal.userData.glow.material.opacity = 0.5 + bloom * 0.25;
          figs.forEach((f, i) => f.userData.tick(t + i * 0.4, raise));
          backline.forEach((a, i) => a.userData.tick(t + i, false));
          motes.userData.tick(t);
          motes.material.opacity = 0.5 + bloom * 0.4;
          ringPop(burst, t, 8.2, 3.2, 0, 1, -34, 3, 150, 0.85);
          ctx.fx.flash('#ffffff', pulse(t, 8.25, 0.1, 0.9) * 0.45);
          st.shake = pulse(t, 8.25, 0.06, 0.9) * 0.6;
          if (!s1 && t > 6.2) { s1 = 1; ctx.score.whoosh(0.8, 0.09); }
          if (!s2 && t > 8.2) { s2 = 1; ctx.score.boom(0.20); ctx.score.bell(1046, 0.14); ctx.score.shimmer(0.11); ctx.score.set({ mood: 'bright', root: 261, tempo: 0.5 }); }
        },
      };
    },
  };

  const FILM = [CH_OPEN, CH_ROOK, CH_THORN, CH_PRISM, CH_EMBER, CH_VALE, CH_END];

  // ── The projector ──────────────────────────────────────────────────────────

  let playing = false;

  function disposeScene(scene) {
    // Geometry and materials are shared through GEO / MAT_CACHE across every
    // chapter, so a blanket dispose on a cut would blank the rest of the film.
    // Only the things a chapter made for itself are freed.
    const keepG = new Set();
    for (const k in GEO) keepG.add(GEO[k]);
    const keepM = new Set(MAT_CACHE.values());
    scene.traverse(o => {
      if (o.geometry && !keepG.has(o.geometry)) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach(x => { if (x && !keepM.has(x)) { try { x.dispose(); } catch (e) {} } });
    });
    scene.clear ? scene.clear() : (scene.children.length = 0);
  }

  function play(opts) {
    opts = opts || {};
    if (playing) return Promise.resolve(false);
    playing = true;

    return ensureThree().then(ok => {
      if (!ok || !window.THREE) { playing = false; return false; }

      const UI = buildScreen();
      requestAnimationFrame(() => UI.root.classList.add('on'));

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: UI.canvas, antialias: true, alpha: false,
          powerPreference: 'high-performance', stencil: false,
        });
      } catch (e) { renderer = null; }
      if (!renderer) { UI.root.remove(); playing = false; return false; }

      if (THREE.sRGBEncoding != null) renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.setClearColor(0x000000, 1);
      const small = Math.min(window.innerWidth, window.innerHeight) < 700;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));

      initTex();

      const score = makeScore();
      // The game's own background arpeggio would fight the film's bed. It is
      // stopped for the duration and put back exactly as it was found.
      const hadMusic = !!(window.RC.Audio && window.RC.Audio.enabled);
      if (hadMusic && window.RC.Audio.stopMusic) { try { window.RC.Audio.stopMusic(); } catch (e) {} }
      score.start();

      const ctx = {
        score: score,
        fx: {
          flash: function (color, amt) {
            UI.flash.style.background = color || '#ffffff';
            UI.flash.style.opacity = String(clamp(amt || 0, 0, 1));
          },
          tone: function (color) { if (UI.tone.dataset.c !== color) { UI.tone.dataset.c = color; UI.tone.style.background = color; } },
        },
      };

      const total = FILM.reduce((a, c) => a + c.dur, 0);

      let idx = -1, cur = null, nextBuilt = null, chT = 0, elapsed = 0;
      let last = performance.now();
      let raf = 0, finished = false;
      const st = { shake: 0 };

      // ── The clock ────────────────────────────────────────────────────────
      // A film runs on wall time, not on frames. Driving `chT` off accumulated
      // frame deltas looks identical at 60fps and falls apart everywhere else:
      // any per-frame clamp (needed, or one long frame teleports the camera)
      // silently turns a slow device into slow motion, so a 2:50 film becomes
      // an eight-minute one and the score — which is on the audio clock and
      // cannot be slowed — drifts out of sync with the picture in the first
      // thirty seconds. So the clock is `performance.now()` minus whatever time
      // the tab spent hidden, and `dt` is only ever used for things that are
      // genuinely incremental. A slow device now drops frames, which is the
      // correct failure: the film is still the film, it is just choppier.
      let chStart = performance.now(), hiddenAt = 0, priorDur = 0;
      function onVis() {
        if (document.hidden) hiddenAt = performance.now();
        else if (hiddenAt) { chStart += performance.now() - hiddenAt; hiddenAt = 0; last = performance.now(); }
      }
      document.addEventListener('visibilitychange', onVis);

      function resize() {
        const w = UI.root.clientWidth || window.innerWidth;
        const h = UI.root.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        if (cur && cur.cam) { cur.cam.aspect = w / h; cur.cam.updateProjectionMatrix(); }
      }
      window.addEventListener('resize', resize);

      function showCard(ch) {
        if (!ch.card) { UI.card.classList.remove('show'); return; }
        UI.cardNm.textContent = ch.card.name;
        UI.cardTi.textContent = ch.card.title;
        UI.cardTi.style.color = ch.card.tint;
        UI.cardRule.style.background = ch.card.tint;
        UI.card.classList.remove('show');
        // Reflow so the CSS animations restart on the second and later chapters.
        void UI.card.offsetWidth;
        UI.card.classList.add('show');
      }

      // `startAt` keeps the schedule absolute across a cut. Zeroing the clock to
      // "now" instead makes every chapter start however late the previous one's
      // last frame happened to run, and seven of those in a row is real drift.
      // A stall longer than half a second is the exception: there, honesty
      // about the present beats catching up by fast-forwarding past a beat.
      function enter(i, startAt) {
        if (cur) { disposeScene(cur.scene); cur = null; }
        priorDur = FILM.slice(0, i).reduce((a, c) => a + c.dur, 0);
        idx = i;
        const ch = FILM[i];
        cur = nextBuilt && nextBuilt.i === i ? nextBuilt.obj : ch.build(ctx);
        nextBuilt = null;
        chStart = startAt != null ? startAt : performance.now();
        chT = 0;
        score.set(ch.mood);
        ctx.fx.tone(ch.tone || '#7fe9ff');
        UI.card.classList.remove('show');
        UI.logo.classList.remove('show');
        resize();
      }

      function finish(skipped) {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey, true);
        UI.skip.removeEventListener('click', onSkip);
        score.stop();
        UI.root.classList.remove('on');
        setTimeout(() => {
          if (cur) disposeScene(cur.scene);
          if (nextBuilt) disposeScene(nextBuilt.obj.scene);
          try { renderer.dispose(); } catch (e) {}
          try { renderer.forceContextLoss(); } catch (e) {}
          UI.root.remove();
          playing = false;
          if (hadMusic && window.RC.Audio && window.RC.Audio.startMusic) { try { window.RC.Audio.startMusic(); } catch (e) {} }
          if (opts.onDone) opts.onDone(!skipped);
        }, 460);
      }

      function onSkip() { markSeen(); finish(true); resolveOuter(true); }
      function onKey(e) {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSkip(); return; }
        // Nothing typed during the film should reach the game's hotkeys.
        e.stopPropagation();
      }
      document.addEventListener('keydown', onKey, true);
      UI.skip.addEventListener('click', onSkip);

      let resolveOuter = function () {};
      const done = new Promise(res => { resolveOuter = res; });

      enter(0);
      UI.load.classList.add('gone');
      UI.fade.style.transition = 'opacity .8s ease';
      requestAnimationFrame(() => { UI.fade.style.opacity = '0'; });

      // Reads the clock itself rather than trusting the rAF timestamp: the two
      // agree in a browser, but taking it from one place keeps every time in
      // the projector on the same source and makes the film scrubbable from
      // the console by stubbing `performance.now`.
      function frame() {
        raf = requestAnimationFrame(frame);
        const now = performance.now();
        const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
        last = now;
        if (document.hidden) return;                   // frozen, not skipped
        chT = (now - chStart) / 1000;
        elapsed = priorDur + chT;
        score.tick();

        const ch = FILM[idx];

        // Build the next chapter a beat before the cut, while the screen is
        // fading to black, so the frame it costs is a frame nobody can see.
        if (!nextBuilt && idx < FILM.length - 1 && chT > ch.dur - 1.15) {
          nextBuilt = { i: idx + 1, obj: FILM[idx + 1].build(ctx) };
          nextBuilt.obj.cam.aspect = cur.cam.aspect;
          nextBuilt.obj.cam.updateProjectionMatrix();
        }

        st.shake = 0;
        cur.update(chT, dt, st);

        // Head bob and hand-held drift, first-person chapters only. Applied
        // after the chapter's own camera work so a chapter never has to think
        // about it, and small enough to feel like a body rather than a bug.
        if (cur.fp) {
          const b = elapsed;
          cur.cam.position.y += Math.sin(b * 2.2) * 0.055;
          cur.cam.position.x += Math.sin(b * 1.3) * 0.045;
          cur.cam.rotation.z += Math.sin(b * 0.9) * 0.006;
        }
        if (st.shake > 0.001) {
          const s = st.shake;
          cur.cam.position.x += rnd(-s, s);
          cur.cam.position.y += rnd(-s, s) * 0.7;
          cur.cam.rotation.z += rnd(-s, s) * 0.012;
        }

        // Cards, fades and the progress hairline.
        if (ch.card && chT > (ch.cardAt || 1.2) && chT < (ch.cardAt || 1.2) + 5.2) {
          if (!UI.card.classList.contains('show')) showCard(ch);
        } else if (chT >= (ch.cardAt || 1.2) + 5.2) {
          UI.card.classList.remove('show');
        }
        if (ch.id === 'end') {
          UI.logo.classList.toggle('show', chT > 11.5);
          UI.prog.style.opacity = chT > 11.5 ? '0' : '1';
        }
        const fadeIn = clamp(1 - chT / 0.75, 0, 1);
        const fadeOut = clamp((chT - (ch.dur - 0.9)) / 0.9, 0, 1);
        UI.fade.style.transition = 'none';
        UI.fade.style.opacity = String(Math.max(fadeIn, fadeOut));
        UI.prog.style.width = (clamp(elapsed / total, 0, 1) * 100) + '%';

        renderer.render(cur.scene, cur.cam);

        if (chT >= ch.dur) {
          if (idx >= FILM.length - 1) { markSeen(); finish(false); resolveOuter(true); return; }
          const over = chT - ch.dur;
          enter(idx + 1, over < 0.5 ? chStart + ch.dur * 1000 : null);
        }
      }
      raf = requestAnimationFrame(frame);
      return done;
    });
  }

  // ── Public surface ─────────────────────────────────────────────────────────

  function seen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
  }
  // Cheap capability probe, so a device that cannot run the film never gets a
  // black screen and never gets an intro button that does nothing.
  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  return {
    play: play,
    seen: seen,
    markSeen: markSeen,
    supported: supported,
    get playing() { return playing; },
    // Exposed for the console and for dev.js: RC.Intro.jump(3) starts the film
    // at Prism's chapter rather than watching two minutes to check one shot.
    jump: function (i) {
      const keep = FILM.slice(clamp(i | 0, 0, FILM.length - 1));
      const all = FILM.slice();
      FILM.length = 0;
      keep.forEach(c => FILM.push(c));
      return play({ onDone: function () { FILM.length = 0; all.forEach(c => FILM.push(c)); } });
    },
  };
})();
