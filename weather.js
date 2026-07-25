// RIFT CLASH — Weather
// ---------------------------------------------------------------------------
// Every planet cycles through its own weather. A cycle is derived ENTIRELY from
// game.time and the map id, which is what makes this safe: the server and every
// client compute the identical pattern from state they already share, so nothing
// new goes on the wire and nothing can desync. There is no weather RNG, no
// weather message, no weather field in the snapshot.
//
// Most of what weather does is look good. One thing it actually does: some
// events cut how far units can see (`sight`), which changes when your army
// notices an enemy and how much of the map your fog reveals. That is why the
// effect is always announced and always shown in the HUD — a player must never
// wonder why their army suddenly went blind.
//
// Timeline of one cycle, per event:
//   0 ─── ramp in ─── full strength ─── ramp out ─── 1   then the next event
window.RC = window.RC || {};

RC.Weather = (function () {
  const CYCLE = 105;          // seconds per weather event
  const RAMP = 0.16;          // fraction of the cycle spent fading in / out

  // `sight` is a multiplier on every unit's vision while the event is at full
  // strength; it eases in and out with the intensity, so nothing snaps.
  // `calm` events are the breathing room between the dramatic ones.
  const CLEAR = { id: 'clear', name: 'Clear', icon: '☀️', desc: 'Clear skies.', sight: 1, calm: true };

  const PATTERNS = {
    earth: [
      CLEAR,
      { id: 'rain',    name: 'Rainfall',    icon: '🌧️', desc: 'Rain sweeps the valley.', sight: 0.9 },
      { id: 'mist',    name: 'Morning Mist', icon: '🌫️', desc: 'Mist settles in the low ground.', sight: 0.78 },
      { id: 'sunbeam', name: 'Sunbreak',    icon: '🌤️', desc: 'The clouds break open.', sight: 1.08, calm: true },
    ],
    ember: [
      CLEAR,
      { id: 'heat',    name: 'Heat Haze',   icon: '🔥', desc: 'The air ripples with heat.', sight: 0.92 },
      { id: 'ashfall', name: 'Ashfall',     icon: '🌋', desc: 'Ash rains from the vents.', sight: 0.74 },
      { id: 'emberwind', name: 'Ember Wind', icon: '💨', desc: 'Burning embers stream across the rock.', sight: 0.88 },
    ],
    ice: [
      CLEAR,
      { id: 'snow',    name: 'Snowfall',    icon: '🌨️', desc: 'Heavy snow drifts down.', sight: 0.85 },
      { id: 'blizzard', name: 'Blizzard',   icon: '❄️', desc: 'A whiteout — nobody can see.', sight: 0.6 },
      { id: 'aurora',  name: 'Aurora',      icon: '🌌', desc: 'Light ripples across the sky.', sight: 1.06, calm: true },
    ],
    rust: [
      CLEAR,
      { id: 'dust',    name: 'Dust Devils', icon: '🌪️', desc: 'Dust devils wander the plain.', sight: 0.9 },
      { id: 'duststorm', name: 'Dust Storm', icon: '🟤', desc: 'A planet-wide dust storm — visibility is gone.', sight: 0.55 },
      { id: 'frostfall', name: 'Frost Fall', icon: '🌫️', desc: 'Carbon-dioxide frost drifts off the caps.', sight: 0.82 },
    ],
    storm: [
      { id: 'lightning', name: 'Lightning', icon: '⚡', desc: 'The sky is tearing itself apart.', sight: 0.86 },
      { id: 'bands',   name: 'Band Shear',  icon: '💨', desc: 'The jet streams are screaming.', sight: 0.92 },
      { id: 'redspot', name: 'Spot Surge',  icon: '🔴', desc: 'The Great Red Spot flares.', sight: 0.8 },
      { id: 'calmband', name: 'Slack Air',  icon: '☁️', desc: 'A rare quiet band.', sight: 1.05, calm: true },
    ],
    ring: [
      CLEAR,
      { id: 'meteor',  name: 'Meteor Shower', icon: '☄️', desc: 'Debris burns overhead.', sight: 0.95 },
      { id: 'ringshadow', name: 'Ring Shadow', icon: '🪐', desc: 'The rings throw the world into shadow.', sight: 0.72 },
      { id: 'icefog',  name: 'Ice Fog',     icon: '🌫️', desc: 'A cloud of ring crystals drifts through.', sight: 0.8 },
    ],
  };

  function biomeOf(g) {
    return (g && g.mapDef && g.mapDef.biome) || (g && g.biome) || 'earth';
  }
  // A tiny hash of the map id, so two planets sharing a biome would still get a
  // different running order.
  function mapSalt(g) {
    const id = (g && g.mapDef && g.mapDef.id) || 'x';
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 7;
  }

  // The current event plus how far into it we are. Pure function of game.time.
  function at(g) {
    const list = PATTERNS[biomeOf(g)];
    if (!list || !list.length || !g) return { ev: CLEAR, phase: 0, intensity: 0 };
    const t = Math.max(0, g.time || 0);
    const n = Math.floor(t / CYCLE);
    const phase = (t % CYCLE) / CYCLE;
    const ev = list[(n + mapSalt(g)) % list.length];
    // ease in, hold, ease out — nothing appears or vanishes on a single frame
    let intensity;
    if (phase < RAMP) intensity = phase / RAMP;
    else if (phase > 1 - RAMP) intensity = (1 - phase) / RAMP;
    else intensity = 1;
    intensity = intensity * intensity * (3 - 2 * intensity);      // smoothstep
    return { ev, phase, intensity, n };
  }

  // What vision is multiplied by right now. 1 when nothing is happening.
  function sightMul(g) {
    if (!g || !RC.CFG || RC.CFG.WEATHER_ENABLED === false) return 1;
    const w = at(g);
    const s = w.ev.sight == null ? 1 : w.ev.sight;
    return 1 + (s - 1) * w.intensity;
  }

  // For the HUD: "🌪️ Dust Storm" plus how long is left of it.
  function label(g) {
    const w = at(g);
    return w.ev.icon + ' ' + w.ev.name;
  }
  function secondsLeft(g) {
    const t = Math.max(0, (g && g.time) || 0);
    return Math.max(0, CYCLE - (t % CYCLE));
  }
  // True while an event is doing something a player should be told about.
  function notable(g) {
    const w = at(g);
    return !w.ev.calm && w.ev.id !== 'clear' && w.intensity > 0.15;
  }

  return { at, sightMul, label, secondsLeft, notable, PATTERNS, CYCLE, biomeOf };
})();
