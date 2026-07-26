const FIGHTERS=['soldier','spitter','guard'];
let S, B;
function updateWoundedFromBattle(sel, win){
  if(!B||!B.meUnits) return;
  if(win===false){
    // a lost battle takes a heavy toll — every ant that fought comes home badly hurt (10% hp),
    // never healing someone who was already worse off than that
    FIGHTERS.forEach(k=>{ if((sel[k]||0)>0) S.wounded[k]=Math.max(1, Math.min(S.wounded[k]??100, 10)); });
    return;
  }
  const missing={}, sent={};
  FIGHTERS.forEach(k=>{ missing[k]=0; sent[k]=0; });
  B.meUnits.forEach(u=>{
    if(!u.groupSize||!sent.hasOwnProperty(u.type)) return;
    sent[u.type]+=u.groupSize;
    if(u.alive) missing[u.type]+=u.groupSize*(1-Math.max(0,u.hp)/u.maxHp);
    // dead units don't factor into the wound average of the survivors
  });
  FIGHTERS.forEach(k=>{
    const survivingSent=Math.max(0, (sel[k]||0));
    if(!survivingSent || !sent[k]) return;
    const woundFrac=missing[k]/sent[k]; // 0..1 average damage taken by this type
    const newPct=Math.round((1-woundFrac)*100);
    // blend with existing wound state (already-wounded units stay wounded, fresh damage stacks in)
    S.wounded[k]=Math.max(1, Math.min(S.wounded[k]??100, newPct));
  });
}
function test(label, initialWounded, sel, win, expect){
  S = {wounded: {...initialWounded}};
  B = {meUnits:[{type:'soldier',groupSize:3,hp:34*3,maxHp:34*3,alive:true}]};
  updateWoundedFromBattle(sel, win);
  const ok = JSON.stringify(S.wounded) === JSON.stringify(expect);
  console.log(`${ok?'ok  ':'FAIL'} ${label}: got ${JSON.stringify(S.wounded)} expect ${JSON.stringify(expect)}`);
}

// Loss: soldiers sent, should drop to 10% regardless of prior state (unless already worse)
test('loss, previously full health', {soldier:100,spitter:100,guard:100}, {soldier:5,spitter:0,guard:0}, false, {soldier:10,spitter:100,guard:100});
test('loss, previously already worse (5%) stays worse, not healed to 10', {soldier:5,spitter:100,guard:100}, {soldier:5}, false, {soldier:5,spitter:100,guard:100});
test('loss, previously 50% drops to 10', {soldier:50,spitter:100,guard:100}, {soldier:5}, false, {soldier:10,spitter:100,guard:100});
test('loss, type not sent stays untouched', {soldier:100,spitter:100,guard:100}, {spitter:4}, false, {soldier:100,spitter:10,guard:100});
console.log('win=undefined path falls through to normal calc (no throw):');
try{
  S={wounded:{soldier:100}};
  B={meUnits:[{type:'soldier',groupSize:3,hp:34*3*0.6,maxHp:34*3,alive:true}]};
  updateWoundedFromBattle({soldier:3});
  console.log('ok  win path ran, wounded =', S.wounded.soldier);
}catch(e){ console.log('FAIL win path threw:', e.message); }
