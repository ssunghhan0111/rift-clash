// RIFT CLASH — Campaign / scripted missions
// A short PvE ladder that funnels new players into the mechanics before online.
// Each mission is a normal 1v1 with a scripted map/opponent, custom win/lose
// OBJECTIVES, and optional rules. Progress unlocks the next mission.
window.RC = window.RC || {};

RC.MISSIONS = [
  {
    id: 'm1_landfall', name: 'Landfall', planet: 'earth', race: 'forge',
    enemy: { race: 'gloop', diff: 'easy', persona: 'balanced' },
    brief: 'Welcome, Commander. A Gloop scout force has taken the far hill on Earth. ' +
           'Build an economy, raise an army, and wipe them out. Destroy their Biocore to win.',
    objectives: [
      { type: 'destroyCore', desc: 'Destroy the enemy base' },
    ],
  },
  {
    id: 'm2_hold', name: 'Hold the Line', planet: 'neptune', race: 'forge',
    enemy: { race: 'aether', diff: 'normal', persona: 'rusher' },
    brief: 'Aether raiders will hit you fast and early on Neptune. You do not need to kill them — ' +
           'just SURVIVE. Hold your base for four minutes and reinforcements arrive. Towers are your friend.',
    objectives: [
      { type: 'survive', seconds: 240, desc: 'Survive for 4:00' },
    ],
  },
  {
    id: 'm3_swarm', name: 'Swarmbreak', planet: 'ceres', race: 'forge',
    enemy: { race: 'gloop', diff: 'hard', persona: 'rusher' },
    brief: 'The quarry world Ceres is tight and vicious, and a Gloop swarm floods it from every side. ' +
           'Wall up, hold the center, and crack their hatchery. Kill 40 of the swarm and level their core.',
    objectives: [
      { type: 'kills', count: 40, desc: 'Destroy 40 swarm units' },
      { type: 'destroyCore', desc: 'Destroy the enemy base' },
    ],
  },
  {
    id: 'm4_sky', name: 'Skyfall', planet: 'venus', race: 'forge',
    enemy: { race: 'aether', diff: 'hard', persona: 'skylord' },
    brief: 'An Aether Skylord commands the air over Venus. Build anti-air, keep your economy alive, ' +
           'and ground their fleet by destroying the Nexus. Bring guard towers — they hit air.',
    objectives: [
      { type: 'destroyCore', desc: 'Destroy the enemy base' },
      { type: 'timeLimit', seconds: 720, lose: true, desc: 'Win within 12:00' },
    ],
  },
  {
    id: 'm5_rift', name: "Rift's Edge", planet: 'jupiter', race: 'forge',
    enemy: { race: 'gloop', diff: 'hard', persona: 'macro' },
    brief: 'The final push. A Gloop macro-lord out-produces everyone on the storm decks of Jupiter. ' +
           'Out-tech, out-fight, and end it. Field an army of 20 and destroy their core before they bury you.',
    objectives: [
      { type: 'army', count: 20, desc: 'Field an army of 20' },
      { type: 'destroyCore', desc: 'Destroy the enemy base' },
    ],
  },
];

RC.Missions = (function () {
  function fmt(s) {
    s = Math.max(0, Math.ceil(s));
    const m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function enemyCoreLeft(g) {
    return g.buildings.some(b => b.def.isCore && !b.dead && g.areEnemies(b.owner, g.playerOwner));
  }
  function evalOne(g, o) {
    switch (o.type) {
      case 'destroyCore':
        return { done: !enemyCoreLeft(g), progress: null, fail: false };
      case 'survive': {
        return { done: g.time >= o.seconds, progress: fmt(o.seconds - g.time) + ' left', fail: false };
      }
      case 'kills': {
        const k = g.missionKills || 0;
        return { done: k >= o.count, progress: Math.min(k, o.count) + '/' + o.count, fail: false };
      }
      case 'buildCount': {
        const n = g.buildings.filter(b => b.owner === g.playerOwner && b.type === o.building && b.done).length;
        return { done: n >= o.count, progress: Math.min(n, o.count) + '/' + o.count, fail: false };
      }
      case 'army': {
        const n = g.units.filter(u => u.owner === g.playerOwner && !u.dead && !u.def.worker).length;
        return { done: n >= o.count, progress: Math.min(n, o.count) + '/' + o.count, fail: false };
      }
      case 'timeLimit':
        return { done: false, progress: fmt(o.seconds - g.time) + ' left', fail: g.time > o.seconds };
      default:
        return { done: false, progress: null, fail: false };
    }
  }
  // Called from game.update while a mission is running. Sets g.over on win/lose.
  function evaluate(g) {
    if (!g.mission) return;
    // Default lose: your base is gone.
    if (!g.core(g.playerOwner)) { g.over = 'lose'; return; }
    let allWin = true, anyFail = false;
    for (const st of g.mission.objectives) {
      const r = evalOne(g, st.def);
      st.done = r.done; st.progress = r.progress; st.fail = r.fail;
      if (st.def.lose) { if (r.fail) anyFail = true; }
      else if (!r.done) allWin = false;
    }
    if (anyFail) { g.over = 'lose'; return; }
    if (allWin) { g.over = 'win'; return; }
  }

  // ── Progression (localStorage) ──
  const KEY = 'rc_campaign';
  function loadDone() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; }
  }
  function isDone(id) { return loadDone().indexOf(id) >= 0; }
  function markDone(id) {
    const d = loadDone();
    if (d.indexOf(id) < 0) { d.push(id); try { window.localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  }
  // A mission is unlocked if it's the first, already done, or the previous one is done.
  function isUnlocked(idx) {
    if (idx <= 0) return true;
    const prev = RC.MISSIONS[idx - 1];
    return prev ? isDone(prev.id) : true;
  }
  function get(id) { return RC.MISSIONS.find(m => m.id === id); }

  return { evaluate, isDone, markDone, isUnlocked, get, fmt };
})();
