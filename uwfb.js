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