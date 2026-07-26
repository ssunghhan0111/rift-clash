f_in = "antopia_v30.html"
f_out = "antopia_v31.html"
s = open(f_in, encoding="utf-8").read()

def one(old, new, s, expect=1):
    c = s.count(old)
    if c != expect:
        raise SystemExit("FAILED (count=%d, expected %d): %r" % (c, expect, old[:120]))
    return s.replace(old, new)

# updateWoundedFromBattle now takes an optional `win` flag — losing a battle is rough on
# survivors regardless of how much damage the sim tracked, so cap everyone who fought at 10% hp
s = one(
"""function updateWoundedFromBattle(sel){
  if(!B||!B.meUnits) return;
  const missing={}, sent={};""",
"""function updateWoundedFromBattle(sel, win){
  if(!B||!B.meUnits) return;
  if(win===false){
    // a lost battle takes a heavy toll — every ant that fought comes home badly hurt (10% hp),
    // never healing someone who was already worse off than that
    FIGHTERS.forEach(k=>{ if((sel[k]||0)>0) S.wounded[k]=Math.max(1, Math.min(S.wounded[k]??100, 10)); });
    return;
  }
  const missing={}, sent={};""", s)

# --- finishRaid: retreat + full defeat are both losses ---
s = one(
"""  } else if(how==='retreat'){
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel,0.15));
    addXP(5);
    bpLog('You escaped with most of the war-party. +5 XP');
    ch.innerHTML='<button class="btn" id="ok">🏳️ Back to the nest</button>';
    el('ok').onclick=()=>afterRaid(t,false);
  } else {
    const foodLost=Math.floor(S.food*0.12);
    S.food=Math.max(0,S.food-foodLost);
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel,0.35));""",
"""  } else if(how==='retreat'){
    updateWoundedFromBattle(sel,false);
    reportCasualties(applyRealCasualties(sel,0.15));
    addXP(5);
    bpLog('You escaped with most of the war-party. +5 XP');
    ch.innerHTML='<button class="btn" id="ok">🏳️ Back to the nest</button>';
    el('ok').onclick=()=>afterRaid(t,false);
  } else {
    const foodLost=Math.floor(S.food*0.12);
    S.food=Math.max(0,S.food-foodLost);
    updateWoundedFromBattle(sel,false);
    reportCasualties(applyRealCasualties(sel,0.35));""", s)

# --- finishLevelBoss: retreat + full defeat are both losses ---
s = one(
"""  } else if(how==='retreat'){
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel,0.1));
    bpLog('🏳️ You called off the trial. The Guardian still awaits.');
    ch.innerHTML='<button class="btn" id="ok">↩️ Regroup</button>';
    el('ok').onclick=()=>{ closeBattlePage(); if(panelOpen==='queen') renderPanel(); updateHUD(); updateDots(); save(); };
  } else {
    // fixed penalty, as promised: a quarter of the army falls — but the Queen herself is safe
    updateWoundedFromBattle(sel);""",
"""  } else if(how==='retreat'){
    updateWoundedFromBattle(sel,false);
    reportCasualties(applyRealCasualties(sel,0.1));
    bpLog('🏳️ You called off the trial. The Guardian still awaits.');
    ch.innerHTML='<button class="btn" id="ok">↩️ Regroup</button>';
    el('ok').onclick=()=>{ closeBattlePage(); if(panelOpen==='queen') renderPanel(); updateHUD(); updateDots(); save(); };
  } else {
    // fixed penalty, as promised: a quarter of the army falls — but the Queen herself is safe
    updateWoundedFromBattle(sel,false);""", s)

# --- finishDefense: the whole `else` branch (win===false) covers both retreat and defeat ---
s = one(
"""    const f=Math.floor(S.food*0.15), c=Math.floor(S.crystal*0.15);
    S.food-=f; S.crystal-=c;
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel, how==='retreat'?0.2:0.35));""",
"""    const f=Math.floor(S.food*0.15), c=Math.floor(S.crystal*0.15);
    S.food-=f; S.crystal-=c;
    updateWoundedFromBattle(sel,false);
    reportCasualties(applyRealCasualties(sel, how==='retreat'?0.2:0.35));""", s)

open(f_out, "w", encoding="utf-8").write(s)
print("EDIT OK, length", len(s))
