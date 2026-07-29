// RIFT CLASH — Weather + planet feel
// ---------------------------------------------------------------------------
// Every planet cycles through its own weather. A cycle is derived ENTIRELY from
// game.time and the map id, which is what makes this safe: the server and every
// client compute the identical pattern from state they already share, so nothing
// new goes on the wire and nothing can desync. There is no weather RNG, no
// weather message, no weather field in the snapshot.
//
// Weather does three things:
//   sight — how far units see (fog reveal + when they notice an enemy)
//   speed — how fast everything moves on the ground
//   wind  — a constant push on ground units, in a fixed direction
// Every one of them is announced in the HUD and drawn on screen. A player must
// never wonder why their army suddenly went blind or started sliding sideways.
//
// On top of the cycle each planet has a permanent FEEL (see RC.PLANET_FEEL in
// config.js) — Ceres is low gravity so everything is quick, Jupiter is heavy and
// slow. That is the part you notice within five seconds of landing.
//
// Timeline of one cycle, per event:
//   0 ─── ramp in ─── full strength ─── ramp out ─── 1   then the next event
window.RC = window.RC || {};

RC.Weather = (function () {
  const CFG = () => RC.WEATHER || {};
  const CYCLE = () => CFG().cycle || 105;      // seconds per weather event
  const RAMP = () => CFG().ramp || 0.16;       // fraction of the cycle fading in / out

  // sight/speed are multipliers at full strength and ease with intensity.
  // wind is [dx, dy] in px/sec at full strength — a push, not a teleport.
  // vis names the drawing style in renderer.js.
  const CLEAR = { id: 'clear', name: 'Clear', icon: '☀', desc: 'Clear skies.', calm: true };

  const PATTERNS = {
    earth: [
      CLEAR,
      { id: 'rain',    name: 'Rainfall',     icon: '☂', desc: 'Rain sweeps the valley — the ground is soft.',
        sight: 0.90, speed: 0.95, vis: 'rain' },
      { id: 'mist',    name: 'Morning Mist', icon: '≈', desc: 'Mist settles in the low ground.',
        sight: 0.78, vis: 'mist' },
      { id: 'sunbeam', name: 'Sunbreak',     icon: '☼', desc: 'The clouds break open.',
        sight: 1.08, calm: true, vis: 'sun' },
    ],
    ember: [
      CLEAR,
      { id: 'heat',    name: 'Heat Haze',    icon: '≋', desc: 'The air ripples — engines labour in the heat.',
        sight: 0.92, speed: 0.94, vis: 'heat' },
      { id: 'ashfall', name: 'Ashfall',      icon: '▲', desc: 'Ash rains from the vents.',
        sight: 0.74, speed: 0.92, vis: 'ash' },
      { id: 'emberwind', name: 'Ember Wind', icon: '»', desc: 'Burning embers stream across the rock.',
        sight: 0.88, wind: [26, -8], vis: 'ember' },
    ],
    ice: [
      CLEAR,
      { id: 'snow',    name: 'Snowfall',     icon: '*', desc: 'Heavy snow drifts down.',
        sight: 0.85, speed: 0.93, vis: 'snow' },
      { id: 'blizzard', name: 'Blizzard',    icon: '❆', desc: 'A whiteout — nobody can see, and the wind shoves.',
        sight: 0.60, speed: 0.88, wind: [-34, 10], vis: 'blizzard' },
      { id: 'aurora',  name: 'Aurora',       icon: '~', desc: 'Light ripples across the sky.',
        sight: 1.06, calm: true, vis: 'aurora' },
    ],
    rust: [
      CLEAR,
      { id: 'dust',    name: 'Dust Devils',  icon: '๑', desc: 'Dust devils wander the plain.',
        sight: 0.90, vis: 'devils' },
      { id: 'duststorm', name: 'Dust Storm', icon: '▓', desc: 'A planet-wide dust storm — visibility is gone.',
        sight: 0.55, speed: 0.90, wind: [22, 6], vis: 'duststorm' },
      { id: 'frostfall', name: 'Frost Fall', icon: '·', desc: 'Carbon-dioxide frost drifts off the caps.',
        sight: 0.82, vis: 'frost' },
    ],
    storm: [
      { id: 'lightning', name: 'Lightning',  icon: '⚡', desc: 'The sky is tearing itself apart.',
        sight: 0.86, vis: 'lightning' },
      { id: 'bands',   name: 'Band Shear',   icon: '»', desc: 'The jet streams are screaming — hold your line.',
        sight: 0.92, wind: [48, 0], vis: 'shear' },
      { id: 'redspot', name: 'Spot Surge',   icon: '◉', desc: 'The Great Red Spot flares.',
        sight: 0.80, speed: 0.9, wind: [-30, 14], vis: 'spot' },
      { id: 'calmband', name: 'Slack Air',   icon: '○', desc: 'A rare quiet band.',
        sight: 1.05, calm: true },
    ],
    ring: [
      CLEAR,
      { id: 'meteor',  name: 'Meteor Shower', icon: '☄', desc: 'Ring debris burns overhead.',
        sight: 0.95, vis: 'meteor' },
      { id: 'ringshadow', name: 'Ring Shadow', icon: '◗', desc: 'The rings throw the world into shadow.',
        sight: 0.72, vis: 'ringshadow' },
      { id: 'icefog',  name: 'Ice Fog',      icon: '≈', desc: 'A cloud of ring crystals drifts through.',
        sight: 0.80, speed: 0.95, vis: 'icefog' },
    ],
  };

  function biomeOf(g) {
    return (g && g.mapDef && g.mapDef.biome) || (g && g.biome) || 'earth';
  }
  function mapIdOf(g) { return (g && g.mapDef && g.mapDef.id) || 'x'; }

  // A tiny hash of the map id, so two planets sharing a biome still get a
  // different running order — Pluto and Neptune are both 'ice' but never in step.
  function mapSalt(g) {
    const id = mapIdOf(g);
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 7;
  }

  // The permanent character of the planet, independent of weather.
  function feel(g) {
    const F = (RC.PLANET_FEEL || {});
    return F[mapIdOf(g)] || F._default || { speed: 1, name: '' };
  }

  // The current event plus how far into it we are. Pure function of game.time.
  function at(g) {
    const list = PATTERNS[biomeOf(g)];
    if (!list || !list.length || !g) return { ev: CLEAR, phase: 0, intensity: 0, n: 0 };
    const cyc = CYCLE(), ramp = RAMP();
    const t = Math.max(0, g.time || 0);
    const n = Math.floor(t / cyc);
    const phase = (t % cyc) / cyc;
    const ev = list[(n + mapSalt(g)) % list.length];
    // ease in, hold, ease out — nothing appears or vanishes on a single frame
    let intensity;
    if (phase < ramp) intensity = phase / ramp;
    else if (phase > 1 - ramp) intensity = (1 - phase) / ramp;
    else intensity = 1;
    intensity = intensity * intensity * (3 - 2 * intensity);      // smoothstep
    return { ev, phase, intensity, n };
  }

  function enabled() { return RC.WEATHER_ENABLED !== false; }
  // Blend a multiplier toward 1 by how strong the event currently is.
  function ease(val, intensity) { return 1 + ((val == null ? 1 : val) - 1) * intensity; }

  // What vision is multiplied by right now. 1 when nothing is happening.
  function sightMul(g) {
    if (!g || !enabled()) return 1;
    const w = at(g);
    return ease(w.ev.sight, w.intensity);
  }

  // Ground movement multiplier — the planet's permanent feel times the weather.
  // Air units ignore weather drag but keep the planet's gravity.
  function speedMul(g, flying) {
    if (!g) return 1;
    const base = feel(g).speed || 1;
    if (!enabled()) return base;
    if (flying) return base;
    const w = at(g);
    return base * ease(w.ev.speed, w.intensity);
  }

  // Wind push in px/sec, [dx, dy]. Ground units only — a gale that moved aircraft
  // and not tanks would read as a bug rather than as weather.
  function wind(g, flying) {
    if (!g || flying || !enabled()) return null;
    const w = at(g);
    const v = w.ev.wind;
    if (!v || w.intensity <= 0.02) return null;
    return [v[0] * w.intensity, v[1] * w.intensity];
  }

  // For the HUD: "⚡ Lightning" plus what it is doing to you.
  function label(g) { const w = at(g); return w.ev.icon + ' ' + w.ev.name; }
  function effectLine(g) {
    const w = at(g), e = w.ev, out = [];
    if (e.sight && e.sight !== 1) out.push((e.sight < 1 ? '−' : '+') + Math.round(Math.abs(1 - e.sight) * 100) + '% sight');
    if (e.speed && e.speed !== 1) out.push((e.speed < 1 ? '−' : '+') + Math.round(Math.abs(1 - e.speed) * 100) + '% speed');
    if (e.wind) out.push('wind');
    return out.join(' · ');
  }
  function secondsLeft(g) {
    const t = Math.max(0, (g && g.time) || 0);
    return Math.max(0, CYCLE() - (t % CYCLE()));
  }
  // True while an event is doing something a player should be told about.
  function notable(g) {
    const w = at(g);
    return !w.ev.calm && w.ev.id !== 'clear' && w.intensity > 0.15;
  }

  return { at, sightMul, speedMul, wind, feel, label, effectLine, secondsLeft, notable,
           PATTERNS, CYCLE, biomeOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RC.Weather;
