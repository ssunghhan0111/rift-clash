// RIFT CLASH — Audio (procedural Web Audio; no asset files, browser-only)
// Synthesizes short SFX and a soft ambient music loop. Must be started from a user gesture
// (browser autoplay policy) — main.js calls init()/resume() on the first Start/tap.
window.RC = window.RC || {};

RC.Audio = (function () {
  let ctx = null, master = null, enabled = true, musicTimer = null;

  function init() {
    if (ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.32 : 0;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function tone(freq, dur, type, vol, slideTo) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol || 0.3), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol) {
    if (!ctx || !enabled) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const g = ctx.createGain(); g.gain.value = vol || 0.3;
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(g); g.connect(master);
    n.start(t);
  }
  function seq(list) { list.forEach(s => setTimeout(() => tone(s[0], s[1], s[2] || 'square', s[3] || 0.2, s[4]), s[5] || 0)); }

  // ── Richer voice primitives (used by the per-race unit voices below) ───────
  // vtone: an oscillator with an optional attack ramp, pitch slide, detune and
  // scheduled start offset — enough to build bells, chirps and servo blips.
  function vtone(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.1;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + dur);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);
    const vol = Math.max(0.0001, o.vol == null ? 0.1 : o.vol);
    const atk = Math.min(o.attack || 0.004, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let tail = g;
    if (o.lp) {                                   // optional tone-shaping filter
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), t0 + dur);
      g.connect(f); tail = f;
    }
    osc.connect(g); tail.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  // vnoise: filtered noise burst — the basis for servo clicks and wet squelches.
  function vnoise(o) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.08;
    const src = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.max(1, Math.ceil(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;
    const g = ctx.createGain();
    const vol = Math.max(0.0001, o.vol == null ? 0.1 : o.vol);
    const atk = Math.min(o.attack || 0.003, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = src;
    if (o.hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.setValueAtTime(o.hp, t0);
      node.connect(f); node = f;
    }
    if (o.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.lp, t0);
      if (o.lpTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpTo), t0 + dur);
      if (o.q) f.Q.setValueAtTime(o.q, t0);
      node.connect(f); node = f;
    }
    node.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  // ── Per-race unit voices ──────────────────────────────────────────────────
  // Each faction answers in its own timbre, StarCraft-style, so you can tell who
  // you've grabbed without looking:
  //   Forge  — machines: servo clicks and clean square-wave radio blips.
  //   Gloop  — organic swarm: wet squelches and rising chitinous chirps.
  //   Aether — psionic aliens: detuned crystal bells with a long shimmer.
  const RACE_SFX = {
    forge: {
      select: () => {
        vnoise({ dur: 0.03, vol: 0.09, hp: 1400, lp: 5200 });                       // servo click
        vtone({ f: 880,  dur: 0.05, type: 'square', vol: 0.095, delay: 0.022 });
        vtone({ f: 1320, dur: 0.07, type: 'square', vol: 0.075, delay: 0.072 });    // confirm chirp
      },
      move: () => {
        vtone({ f: 620, to: 940, dur: 0.09, type: 'square', vol: 0.10 });
        vnoise({ dur: 0.045, vol: 0.045, hp: 900, lp: 3000, delay: 0.02 });
      },
      attack: () => {
        vtone({ f: 360, to: 190, dur: 0.12, type: 'sawtooth', vol: 0.13 });
        vnoise({ dur: 0.07, vol: 0.07, hp: 500, lp: 2200, delay: 0.01 });
      },
    },
    gloop: {
      select: () => {
        vnoise({ dur: 0.13, vol: 0.11, lp: 1700, lpTo: 300, q: 7 });                // wet squelch
        vtone({ f: 300, to: 165, dur: 0.14, type: 'sine', vol: 0.10, lp: 1200 });
        vtone({ f: 620, to: 430, dur: 0.07, type: 'triangle', vol: 0.05, delay: 0.05 });
      },
      move: () => {
        vtone({ f: 240, to: 520, dur: 0.11, type: 'triangle', vol: 0.10, lp: 2200 });  // rising chirp
        vnoise({ dur: 0.07, vol: 0.06, lp: 1100, lpTo: 480, q: 5 });
      },
      attack: () => {
        vnoise({ dur: 0.16, vol: 0.13, lp: 2600, lpTo: 420, q: 4 });                // screech
        vtone({ f: 520, to: 210, dur: 0.15, type: 'sawtooth', vol: 0.09, lp: 1800 });
      },
    },
    aether: {
      select: () => {
        vtone({ f: 1046, dur: 0.52, type: 'sine', vol: 0.085, attack: 0.014 });     // crystal bell
        vtone({ f: 1568, dur: 0.44, type: 'sine', vol: 0.05,  attack: 0.02,  delay: 0.028 });
        vtone({ f: 2093, dur: 0.34, type: 'sine', vol: 0.028, attack: 0.03,  delay: 0.06, detune: 9 });
      },
      move: () => {
        vtone({ f: 784,  dur: 0.30, type: 'sine', vol: 0.075, attack: 0.01 });
        vtone({ f: 1175, dur: 0.34, type: 'sine', vol: 0.05,  attack: 0.014, delay: 0.05 });
        vtone({ f: 1568, dur: 0.30, type: 'sine', vol: 0.03,  attack: 0.02,  delay: 0.10, detune: -7 });
      },
      attack: () => {
        vtone({ f: 1320, to: 420, dur: 0.24, type: 'triangle', vol: 0.10, attack: 0.006 });
        vtone({ f: 660,  to: 210, dur: 0.28, type: 'sine',     vol: 0.07, attack: 0.01, delay: 0.02 });
      },
    },
  };

  const SFX = {
    select:  () => tone(680, 0.05, 'square', 0.12),
    move:    () => tone(440, 0.06, 'triangle', 0.11, 560),
    attack:  () => tone(300, 0.07, 'sawtooth', 0.14, 190),
    shoot:   () => tone(760, 0.035, 'square', 0.06, 520),
    explode: () => noise(0.28, 0.22),
    build:   () => seq([[500, 0.08, 'square', 0.18, 720, 0]]),
    ready:   () => seq([[680, 0.09, 'square', 0.18, null, 0], [900, 0.12, 'square', 0.18, null, 95]]),
    cast:    () => tone(420, 0.2, 'sine', 0.18, 920),
    levelup: () => seq([[600, 0.11, 'square', 0.2, null, 0], [760, 0.11, 'square', 0.2, null, 70], [920, 0.11, 'square', 0.2, null, 140], [1150, 0.16, 'square', 0.2, null, 210]]),
    wave:    () => seq([[400, 0.22, 'sawtooth', 0.22, 300, 0], [400, 0.22, 'sawtooth', 0.22, 300, 260]]),
    win:     () => seq([[523, 0.16, 'square', 0.22, null, 0], [659, 0.16, 'square', 0.22, null, 120], [784, 0.16, 'square', 0.22, null, 240], [1047, 0.24, 'square', 0.22, null, 360]]),
    lose:    () => seq([[400, 0.24, 'sawtooth', 0.2, 320, 0], [330, 0.24, 'sawtooth', 0.2, 264, 160], [262, 0.34, 'sawtooth', 0.2, 200, 320]]),
  };

  const _last = {};
  function play(name) {
    if (!ctx || !enabled) return;
    // throttle spammy combat sounds so many units don't create a wall of noise
    if (name === 'shoot' || name === 'explode' || name === 'attack' || name === 'move' || name === 'select') {
      const now = ctx.currentTime;
      // != null, not truthiness — currentTime is legitimately 0 on the very first sound
      if (_last[name] != null && now - _last[name] < 0.06) return;
      _last[name] = now;
    }
    const f = SFX[name]; if (f) f();
  }

  // Play a unit voice in the given faction's timbre. Falls back to the generic
  // SFX for unknown races or sounds that have no racial variant.
  function playRace(race, name) {
    if (!ctx || !enabled) return;
    const now = ctx.currentTime;
    const key = 'r:' + name;
    if (_last[key] != null && now - _last[key] < 0.09) return;   // voices are longer — throttle harder
    _last[key] = now;
    const set = RACE_SFX[race];
    const f = set && set[name];
    if (f) f(); else { const gsfx = SFX[name]; if (gsfx) gsfx(); }
  }

  // soft, slow arpeggio pad — low volume, easy to ignore
  function startMusic() {
    if (!ctx || !enabled || musicTimer) return;
    const scale = [196, 262, 294, 330, 392, 330, 294, 262];
    let i = 0;
    musicTimer = setInterval(() => {
      if (!enabled || !ctx) return;
      tone(scale[i % scale.length], 0.6, 'triangle', 0.04);
      if (i % 4 === 0) tone(scale[i % scale.length] / 2, 0.9, 'sine', 0.05);
      i++;
    }, 560);
  }
  function stopMusic() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } }

  function setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = v ? 0.32 : 0;
    if (v) { resume(); startMusic(); } else stopMusic();
  }
  function toggle() { setEnabled(!enabled); return enabled; }

  return { init, resume, play, playRace, startMusic, stopMusic, setEnabled, toggle,
           get enabled() { return enabled; } };
})();
