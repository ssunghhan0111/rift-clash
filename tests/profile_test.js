// Local player profile (profile.js) — matches, per-faction W/L, best Survival wave,
// today's daily best. Pure client logic over a mocked localStorage.
global.window = global;
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
let DAY = 100;
// profile.js now owns the per-hero Mastery record and the Star wallet, so it needs the
// roster (RC.HEROES / RC.resolveHero / RC.MASTERY / RC.STARS) that config.js defines.
require('../config.js');
require('../profile.js');
RC.Daily = { dayNumber: () => DAY };
const P = RC.Profile;

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }

P.reset();
ok(P.get().matches === 0, 'a fresh profile has no matches');

// versus wins/losses per faction
P.recordMatchEnd({ over: 'win',  _racePick: { 1: 'forge' },  playerOwner: 1 });
P.recordMatchEnd({ over: 'lose', _racePick: { 1: 'forge' },  playerOwner: 1 });
P.recordMatchEnd({ over: 'win',  _racePick: { 1: 'gloop' },  playerOwner: 1 });
let p = P.get();
ok(p.matches === 3, 'three matches recorded');
ok(p.wins === 2 && p.losses === 1, 'wins/losses tallied (2–1)');
ok(p.faction.forge.w === 1 && p.faction.forge.l === 1, 'Forge record is 1W/1L');
ok(p.faction.gloop.w === 1 && p.faction.gloop.l === 0, 'Gloop record is 1W/0L');

// survival best wave per difficulty keeps the maximum
P.recordMatchEnd({ survival: true, over: 'lose', survivalDiff: 'medium', survivalWave: 12 });
P.recordMatchEnd({ survival: true, over: 'lose', survivalDiff: 'medium', survivalWave: 8 });   // lower — must not lower the best
P.recordMatchEnd({ survival: true, over: 'lose', survivalDiff: 'easy',   survivalWave: 20 });
p = P.get();
ok(p.bestWave.medium === 12, 'best Medium wave stays at the higher 12 (not overwritten by 8)');
ok(p.bestWave.easy === 20, 'best Easy wave recorded (20)');
ok(p.matches === 6, 'survival runs also count as matches');

// daily best resets when the UTC day rolls over
P.recordMatchEnd({ survival: true, over: 'lose', daily: true, survivalDiff: 'medium', survivalWave: 5 });
ok(P.dailyBest() === 5, "today's daily best is 5");
DAY = 101;                                   // next day
ok(P.dailyBest() === 0, 'daily best resets to 0 on a new day');

// practice/tutorial and result-less games are ignored
const before = P.get().matches;
P.recordMatchEnd({ practice: true, over: 'win', _racePick: { 1: 'forge' }, playerOwner: 1 });
P.recordMatchEnd({ over: null });
ok(P.get().matches === before, 'practice matches and unfinished games are not recorded');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
