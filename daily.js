// RIFT CLASH — Daily Challenge
// ---------------------------------------------------------------------------
// One Survival run per day that is IDENTICAL for everybody: same seed, same
// wave composition, same twist. Because every player faces the same run, the
// daily board is a fair comparison in a way the normal board can never be
// (there, one player can farm Easy while another grinds Crazy Hard).
//
// The day is derived from UTC so a player in Seoul and a player in New York
// are on the same challenge at the same moment, and the board rolls over for
// everyone at once. Nothing is scheduled or cleaned up server-side — a row
// simply stops being shown once its day number is no longer today.
window.RC = window.RC || {};

RC.Daily = (function () {
  const EPOCH = Date.UTC(2026, 0, 1);      // day 0 — fixed so the number is stable forever
  const DAY_MS = 86400000;

  // Whole UTC days since the epoch. Passing a timestamp keeps this testable.
  function dayNumber(now) {
    const t = (now == null) ? Date.now() : now;
    return Math.floor((t - EPOCH) / DAY_MS);
  }
  function msUntilNext(now) {
    const t = (now == null) ? Date.now() : now;
    const next = EPOCH + (dayNumber(t) + 1) * DAY_MS;
    return Math.max(0, next - t);
  }
  // "in 3h 12m" — for the countdown under the daily board
  function timeLeftLabel(now) {
    const ms = msUntilNext(now);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm';
    return 'under a minute';
  }
  // A readable UTC date for the header
  function dateLabel(day) {
    const d = new Date(EPOCH + day * DAY_MS);
    return d.toUTCString().slice(5, 16);        // "25 Jul 2026"
  }

  // ── The twists ────────────────────────────────────────────────────────────
  // Deliberately small in number and blunt in effect, so a player can read the
  // name and immediately know how to change their build. Every field is a plain
  // multiplier consumed by survival.js — no new systems, nothing to desync.
  const MODS = [
    { id: 'blitz',    name: 'Blitz',       icon: '⏩',
      desc: 'No breathing room — the next wave is already on its way.',
      prep: 0.45, gap: 0.3 },
    { id: 'swarm',    name: 'Endless Swarm', icon: '🐛',
      desc: 'Far more enemies, but each one is frail.',
      size: 1.7, hp: 0.68 },
    { id: 'elite',    name: 'Elite Guard',  icon: '🛡',
      desc: 'Fewer enemies — every one of them a monster.',
      size: 0.6, hp: 1.9 },
    { id: 'sprint',   name: 'Sprinters',    icon: '💨',
      desc: 'The horde moves frighteningly fast.',
      speed: 1.4 },
    { id: 'bounty',   name: "Rich but Fragile", icon: '💎',
      desc: 'You start rich, but the Rift Crystal is brittle.',
      startShards: 1500, crystalHp: 0.65 },
    { id: 'skyfall',  name: 'Skyfall',      icon: '🦅',
      desc: 'Air units come early and often — build anti-air fast.',
      airEarly: true, size: 1.15 },
    { id: 'ironclad', name: 'Ironclad',     icon: '⚙',
      desc: 'The horde upgrades its weapons and armour twice as fast.',
      upgradePace: 0.5 },
  ];

  function modFor(day) { return MODS[((day % MODS.length) + MODS.length) % MODS.length]; }

  // ── Seeded RNG ────────────────────────────────────────────────────────────
  // Wave composition and spawn scatter must be identical for every player, so
  // the daily run uses this instead of Math.random(). Same seed → same run.
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }
  function seedFor(day) {
    // scramble the day number so consecutive days don't produce similar streams
    let h = 2166136261 ^ (day + 0x9e3779b9);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // Everything a daily run needs, in one object hung on the game as g.daily.
  function today(now) {
    const day = dayNumber(now);
    const mod = modFor(day);
    return {
      day, mod,
      seed: seedFor(day),
      date: dateLabel(day),
      name: mod.name,
      desc: mod.desc,
      icon: mod.icon,
    };
  }

  // Attach a fresh seeded stream to a game. Called once at setup so a run is
  // reproducible from its first wave; re-attaching mid-run would desync it.
  function arm(g, now) {
    const d = today(now);
    g.daily = d;
    g._dailyRng = makeRng(d.seed);
    return d;
  }

  // survival.js calls this instead of Math.random() so daily runs are identical
  // for everyone while normal runs stay pleasantly unpredictable.
  function rand(g) {
    return (g && g._dailyRng) ? g._dailyRng() : Math.random();
  }

  return { dayNumber, msUntilNext, timeLeftLabel, dateLabel, today, arm, rand, modFor, seedFor, makeRng, MODS };
})();
