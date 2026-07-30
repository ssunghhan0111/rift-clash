// Can a ground unit ordered to attack a building actually damage it?
const path = require('path');
const SRC = path.join(__dirname, '..');      // the game files live one level up
global.window = global;
['config', 'maps', 'pathfind', 'entities', 'game', 'ai', 'daily', 'survival', 'net_core']
  .forEach(m => require('../' + m + '.js'));

const BUILDINGS = ['core', 'crystal', 'factory', 'cell', 'stonethrower'].filter(b => RC.BUILDINGS[b]);
const GROUND = Object.keys(RC.UNITS).filter(k => {
  const d = RC.UNITS[k];
  return !d.flying && !d.transport && (d.dmg || 0) > 0;
});

const broken = [];
let tested = 0;
for (const bt of BUILDINGS) {
  const row = [];
  for (const ut of GROUND) {
    const g = new RC.Game();
    g.units = []; g.buildings = []; g.nodes = []; g.fx = []; g.marks = []; g.over = null;
    const b = new RC.Building(bt, 1700, 800, 2, true);
    g.buildings.push(b);
    const u = new RC.Unit(ut, 1700 - 300, 800, 1);
    g.units.push(u);
    u.attackTarget(b);
    const hp0 = b.hp;
    for (let i = 0; i < 30 * 25; i++) { u.update(1 / 30, g); g.separate(); if (b.hp < hp0) break; }
    tested++;
    if (b.hp >= hp0) { row.push(ut); broken.push(bt + ' ← ' + ut); }
  }
  console.log(bt.padEnd(11) + (row.length ? ' CANNOT BE HIT BY: ' + row.join(', ') : ' — all ground units can hit it'));
}
console.log('\n' + (tested - broken.length) + ' of ' + tested + ' unit/building pairs connect');
if (broken.length) {
  console.log('  FAIL: these pairs cannot connect — ' + broken.join(', '));
  console.log('\n0 passed, ' + broken.length + ' failed');
  process.exit(1);
}
console.log('\n' + tested + ' passed, 0 failed');
