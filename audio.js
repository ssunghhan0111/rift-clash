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
      if (_last[name] && now - _last[name] < 0.06) return;
      _last[name] = now;
    }
    const f = SFX[name]; if (f) f();
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

  return { init, resume, play, startMusic, stopMusic, setEnabled, toggle, get enabled() { return enabled; } };
})();
