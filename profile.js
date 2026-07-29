// RIFT CLASH — local player profile
// ---------------------------------------------------------------------------
// A tiny, purely client-side record of what you've done: matches played, your
// win/loss per faction, and your best Survival wave per difficulty. Lives in
// localStorage, so it survives across sessions on the same browser and costs the
// server nothing. Everything degrades gracefully if storage is unavailable.
window.RC = window.RC || {};

RC.Profile = (function () {
  const KEY = 'riftclash_profile';

  function blank() {
    return {
      matches: 0, wins: 0, losses: 0,
      faction: { forge: { w: 0, l: 0 }, gloop: { w: 0, l: 0 }, aether: { w: 0, l: 0 } },
      bestWave: { easy: 0, medium: 0, insane: 0 },
      daily: { day: -1, wave: 0 },     // best wave on TODAY's daily (day = UTC day number)
      // ── Progression ──
      // All of the above was counted and then never spent on anything: you finished a
      // match and nothing you earned outlived it. These feed RC.Progress (levels and
      // the achievement checklist) and are deliberately *variety* counters — wins keyed
      // by planet, by bot personality, by difficulty — so the rewards pull a player
      // around the game instead of letting them grind one map forever.
      xp: 0,
      mapWins: {},        // mapId    -> wins
      foeWins: {},        // personaId-> wins  ('balanced' when the bot had no personality)
      diffWins: {},       // easy|normal|hard -> wins
      coop: 0,            // online co-op survival runs finished
      online: 0,          // online versus matches finished
      streak: { cur: 0, best: 0 },
      earned: [],         // achievement ids already awarded (so each only announces once)
    };
  }

  function get() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return blank();
      const p = JSON.parse(raw), b = blank();
      return {
        matches: p.matches | 0, wins: p.wins | 0, losses: p.losses | 0,
        faction: Object.assign(b.faction, p.faction || {}),
        bestWave: Object.assign(b.bestWave, p.bestWave || {}),
        daily: Object.assign(b.daily, p.daily || {}),
        // Anyone who played before progression existed keeps their record and simply
        // starts at level 1 — every one of these falls back to the blank default.
        xp: p.xp | 0,
        mapWins: Object.assign({}, p.mapWins || {}),
        foeWins: Object.assign({}, p.foeWins || {}),
        diffWins: Object.assign({}, p.diffWins || {}),
        coop: p.coop | 0,
        online: p.online | 0,
        streak: Object.assign(b.streak, p.streak || {}),
        earned: Array.isArray(p.earned) ? p.earned.slice() : [],
      };
    } catch (e) { return blank(); }
  }
  function save(p) { try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function reset() { save(blank()); }

  // Call once when a match ends (game.over just became set). Returns the updated profile.
  // Practice/tutorial matches and matches with no result are ignored.
  // Returns { profile, xpGained, levelUp, unlocked[] } so the end screen can show what
  // the match was worth. Losing still pays — a kid who only gets rewarded for winning
  // stops playing the moment they hit an opponent they can't beat.
  function recordMatchEnd(game) {
    if (!game || game.practice || !game.over) return null;
    const p = get();
    const beforeLevel = RC.Progress ? RC.Progress.levelOf(p.xp).level : 1;
    const won = game.over === 'win';
    let xp = 0;
    p.matches++;
    if (game.survival) {
      const diff = game.survivalDiff || 'medium';
      if (!(diff in p.bestWave)) p.bestWave[diff] = 0;
      const wave = game.survivalWave || 0;
      if (wave > p.bestWave[diff]) p.bestWave[diff] = wave;
      if (game.daily && RC.Daily) {
        const day = RC.Daily.dayNumber();
        if (p.daily.day !== day) { p.daily.day = day; p.daily.wave = 0; }
        if (wave > p.daily.wave) p.daily.wave = wave;
      }
      if (RC.online) p.coop++;
      xp = 20 + wave * 6;                       // survival pays per wave survived
    } else {
      const race = (game._racePick && game._racePick[game.playerOwner]) || 'forge';
      if (!p.faction[race]) p.faction[race] = { w: 0, l: 0 };
      if (RC.online) p.online++;
      if (won) {
        p.wins++; p.faction[race].w++;
        const mapId = game.mapDef && game.mapDef.id;
        if (mapId) p.mapWins[mapId] = (p.mapWins[mapId] || 0) + 1;
        const diff = game.aiDiff || 'normal';
        p.diffWins[diff] = (p.diffWins[diff] || 0) + 1;
        // Which personality did we actually beat? Any enemy bot's is representative.
        let foe = 'balanced';
        for (const k in (game.aiPersona || {})) {
          const per = game.aiPersona[k];
          if (per && per.id) { foe = per.id; break; }
        }
        p.foeWins[foe] = (p.foeWins[foe] || 0) + 1;
        p.streak.cur++;
        if (p.streak.cur > p.streak.best) p.streak.best = p.streak.cur;
        xp = 100 + (diff === 'hard' ? 60 : diff === 'normal' ? 30 : 0);
      } else if (game.over === 'lose') {
        p.losses++; p.faction[race].l++;
        p.streak.cur = 0;
        xp = 35;                                // showing up still counts for something
      }
    }
    p.xp += xp;
    let gained = xp;
    // Newly completed achievements — recorded here so each is announced exactly once.
    let unlocked = [];
    if (RC.Progress) {
      unlocked = RC.Progress.check(p).filter(a => p.earned.indexOf(a.id) < 0);
      unlocked.forEach(a => { p.earned.push(a.id); p.xp += a.xp || 0; gained += a.xp || 0; });
    }
    save(p);
    const afterLevel = RC.Progress ? RC.Progress.levelOf(p.xp).level : 1;
    return { profile: p, xpGained: gained, levelUp: afterLevel > beforeLevel ? afterLevel : 0, unlocked };
  }

  // Best wave the player has reached on TODAY's daily (0 if they haven't run it today).
  function dailyBest() {
    const p = get();
    if (RC.Daily && p.daily.day === RC.Daily.dayNumber()) return p.daily.wave;
    return 0;
  }

  return { get, save, reset, recordMatchEnd, dailyBest };
})();
