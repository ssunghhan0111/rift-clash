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
      };
    } catch (e) { return blank(); }
  }
  function save(p) { try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }
  function reset() { save(blank()); }

  // Call once when a match ends (game.over just became set). Returns the updated profile.
  // Practice/tutorial matches and matches with no result are ignored.
  function recordMatchEnd(game) {
    if (!game || game.practice || !game.over) return null;
    const p = get();
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
    } else {
      const race = (game._racePick && game._racePick[game.playerOwner]) || 'forge';
      if (!p.faction[race]) p.faction[race] = { w: 0, l: 0 };
      if (game.over === 'win') { p.wins++; p.faction[race].w++; }
      else if (game.over === 'lose') { p.losses++; p.faction[race].l++; }
    }
    save(p);
    return p;
  }

  // Best wave the player has reached on TODAY's daily (0 if they haven't run it today).
  function dailyBest() {
    const p = get();
    if (RC.Daily && p.daily.day === RC.Daily.dayNumber()) return p.daily.wave;
    return 0;
  }

  return { get, save, reset, recordMatchEnd, dailyBest };
})();
