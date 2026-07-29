// RIFT CLASH — commander level + achievements
// ---------------------------------------------------------------------------
// Everything the game already counted (matches, wins, factions, best wave) was
// written down and then never spent on anything. This turns that record into two
// things a player can carry between sessions: a commander LEVEL, and a checklist
// of GOALS.
//
// The goals are deliberately about VARIETY, not volume. "Win 50 matches" rewards
// grinding one easy map against one bot; "win on all eight planets" and "beat all
// four bot personalities" pull a player through the content they already own. That
// is the whole point — the game is much bigger than the slice most players see.
//
// Purely client-side and read-only over the profile: check() never mutates, so it
// is safe to call on every menu render. profile.js owns the writing.
window.RC = window.RC || {};

RC.Progress = (function () {

  // ── Levels ────────────────────────────────────────────────────────────────
  // Cost per level rises gently, so early levels arrive fast (a new player should
  // see level 2 after their first couple of matches) and later ones feel earned
  // without ever becoming a wall. A win is ~130 xp, a loss 35.
  // BASE is set so a player's FIRST win (100 base + 30 Normal + 60 First Blood = 190)
  // tips them straight into level 2. The first win is the moment the game either
  // hooks a kid or doesn't; it should visibly pay.
  const BASE = 180, GROWTH = 90, MAX = 50;

  // Total xp required to have REACHED level n (n = 1 means 0).
  function xpForLevel(n) {
    if (n <= 1) return 0;
    let total = 0;
    for (let i = 1; i < n && i < MAX; i++) total += BASE + (i - 1) * GROWTH;
    return total;
  }
  // → { level, into, need, pct } — `into`/`need` describe progress through the
  // CURRENT level, which is what a progress bar wants (not the running total).
  function levelOf(xp) {
    xp = Math.max(0, xp | 0);
    let level = 1;
    while (level < MAX && xp >= xpForLevel(level + 1)) level++;
    const floor = xpForLevel(level);
    const ceil = level >= MAX ? floor : xpForLevel(level + 1);
    const need = Math.max(1, ceil - floor);
    const into = Math.min(need, xp - floor);
    return { level, into, need, pct: level >= MAX ? 1 : into / need, max: level >= MAX };
  }

  // Ranks give the number a name. Kids remember "I'm a Rift Warden", not "level 22".
  const RANKS = [
    { at: 1,  name: 'Recruit' },
    { at: 5,  name: 'Cadet' },
    { at: 10, name: 'Lieutenant' },
    { at: 16, name: 'Commander' },
    { at: 24, name: 'Vanguard' },
    { at: 34, name: 'Warden' },
    { at: 44, name: 'Rift Marshal' },
  ];
  function rankOf(level) {
    let r = RANKS[0];
    for (const x of RANKS) if (level >= x.at) r = x;
    return r.name;
  }

  // ── Achievements ──────────────────────────────────────────────────────────
  // Each one reports progress (have/goal) so a half-finished goal still shows a
  // bar — "3 of 8 planets" is a far stronger pull than a blank checkbox.
  const count = o => Object.keys(o || {}).filter(k => (o[k] | 0) > 0).length;

  const LIST = [
    // Getting started
    { id: 'first_blood', icon: '⚔️', name: 'First Blood', xp: 60,
      desc: 'Win your first match.',
      have: p => Math.min(1, p.wins | 0), goal: 1 },
    { id: 'veteran', icon: '🎖️', name: 'Veteran', xp: 120,
      desc: 'Play 10 matches.',
      have: p => p.matches | 0, goal: 10 },

    // Variety — the reason this table exists
    { id: 'all_factions', icon: '🧬', name: 'Three Ways to Win', xp: 200,
      desc: 'Win a match with all three factions.',
      have: p => ['forge', 'gloop', 'aether'].filter(r => ((p.faction[r] || {}).w | 0) > 0).length, goal: 3 },
    { id: 'planet_hopper', icon: '🪐', name: 'Planet Hopper', xp: 150,
      desc: 'Win on 4 different planets.',
      have: p => count(p.mapWins), goal: 4 },
    { id: 'system_conquered', icon: '🌌', name: 'System Conquered', xp: 350,
      desc: 'Win on every planet in the game.',
      have: p => count(p.mapWins), goal: (RC.MAPS && RC.MAPS.length) || 8 },
    { id: 'know_your_enemy', icon: '🧠', name: 'Know Your Enemy', xp: 250,
      desc: 'Beat every bot personality — Rusher, Turtler, Skylord and Macro.',
      have: p => ['rusher', 'turtler', 'skylord', 'macro'].filter(k => (p.foeWins[k] | 0) > 0).length, goal: 4 },

    // Skill
    { id: 'step_up', icon: '📈', name: 'Step Up', xp: 120,
      desc: 'Win a match on Normal.',
      have: p => Math.min(1, p.diffWins.normal | 0), goal: 1 },
    { id: 'the_hard_way', icon: '🔥', name: 'The Hard Way', xp: 300,
      desc: 'Win a match on Hard.',
      have: p => Math.min(1, p.diffWins.hard | 0), goal: 1 },
    { id: 'on_a_roll', icon: '🏆', name: 'On a Roll', xp: 200,
      desc: 'Win 3 matches in a row.',
      have: p => (p.streak && p.streak.best) | 0, goal: 3 },

    // Survival
    { id: 'holdout', icon: '🛡️', name: 'Holdout', xp: 150,
      desc: 'Reach wave 10 in Survival.',
      have: p => Math.max(p.bestWave.easy | 0, p.bestWave.medium | 0, p.bestWave.insane | 0), goal: 10 },
    { id: 'last_stand', icon: '💎', name: 'Last Stand', xp: 300,
      desc: 'Reach wave 20 in Survival.',
      have: p => Math.max(p.bestWave.easy | 0, p.bestWave.medium | 0, p.bestWave.insane | 0), goal: 20 },

    // Together
    { id: 'wingman', icon: '🤝', name: 'Wingman', xp: 180,
      desc: 'Finish 3 online co-op runs.',
      have: p => p.coop | 0, goal: 3 },
    { id: 'contender', icon: '🌐', name: 'Contender', xp: 180,
      desc: 'Play 5 matches online against real people.',
      have: p => p.online | 0, goal: 5 },
  ];

  // Every achievement with its live progress. Read-only.
  function all(p) {
    return LIST.map(a => {
      const have = Math.max(0, a.have(p) | 0);
      const goal = Math.max(1, a.goal | 0);
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, xp: a.xp,
               have: Math.min(have, goal), goal, done: have >= goal, pct: Math.min(1, have / goal) };
    });
  }
  // Just the completed ones — profile.js diffs this against p.earned to find what's new.
  function check(p) { return all(p).filter(a => a.done); }

  function summary(p) {
    const lv = levelOf(p.xp);
    const list = all(p);
    return { level: lv.level, rank: rankOf(lv.level), into: lv.into, need: lv.need,
             pct: lv.pct, max: lv.max, xp: p.xp | 0,
             done: list.filter(a => a.done).length, total: list.length, list };
  }

  return { xpForLevel, levelOf, rankOf, all, check, summary, RANKS, LIST, MAX };
})();
