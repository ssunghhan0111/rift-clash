f_in = "antopia_v26.html"
f_out = "antopia_v27.html"
s = open(f_in, encoding="utf-8").read()

def one(old, new, s):
    c = s.count(old)
    if c != 1:
        raise SystemExit("FAILED (count=%d): %r" % (c, old[:80]))
    return s.replace(old, new)

# 1) ROOMS: add infirmary
s = one(
"""  laser: {name:'Laser Attack Tower', emoji:'📡', unlockLvl:8, base:100, cbase:20, desc:'An automated turret by the tunnels — scorches raiders with a laser before they ever reach the throne.'},
};""",
"""  laser: {name:'Laser Attack Tower', emoji:'📡', unlockLvl:8, base:100, cbase:20, desc:'An automated turret by the tunnels — scorches raiders with a laser before they ever reach the throne.'},
  infirmary: {name:'Infirmary', emoji:'💊', unlockLvl:2, base:35, cbase:0, desc:'A recovery ward — wounded fighters rest here and heal at a steady rate until fit for duty again. Upgrade to speed up recovery.'},
};""", s)

# 2) freshState rooms default
s = one(
"""    rooms:{armory:0, trap:0, tower:0, aphid:0, laser:0},""",
"""    rooms:{armory:0, trap:0, tower:0, aphid:0, laser:0, infirmary:0},""", s)

# 3) applySave rooms default
s = one(
"""  S.rooms=Object.assign({armory:0,trap:0,tower:0,aphid:0,laser:0}, d.S.rooms);""",
"""  S.rooms=Object.assign({armory:0,trap:0,tower:0,aphid:0,laser:0,infirmary:0}, d.S.rooms);""", s)

# 4) healthyCount() helper next to woundFrac()
s = one(
"""function woundFrac(k){ return Math.max(0.05, (S.wounded[k]??100)/100); }
const MELEE_FRONT=['soldier','guard','bomber'];""",
"""function woundFrac(k){ return Math.max(0.05, (S.wounded[k]??100)/100); }
// only fully-recovered ants are fit to deploy — wounded ones stay resting in the Infirmary
function healthyCount(k){ return Math.max(0, Math.min(S.units[k]||0, Math.round((S.units[k]||0)*((S.wounded[k]??100)/100)))); }
const MELEE_FRONT=['soldier','guard','bomber'];""", s)

# 5) armyStatsOf: drop the wf discount (only healthy ants are ever selected now)
s = one(
"""    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    const wf=woundFrac(k);
    hp+=u.hp*c*gb*wf; shield+=(u.shield+shieldBonus())*c*gb;""",
"""    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    hp+=u.hp*c*gb; shield+=(u.shield+shieldBonus())*c*gb; // only fully-healed ants are ever sent, so no wound discount here anymore""", s)

# 6) setupBattleUnits: same
s = one(
"""    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    const wf=woundFrac(k);
    const maxHp=u.hp*gb*groupSize*wf;""",
"""    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    const maxHp=u.hp*gb*groupSize; // only fully-healed ants are ever sent to battle now""", s)

# 7) roomRow extra description — add infirmary case
s = one(
"""  const extra=k==='armory'?'+'+Math.round(S.rooms.armory*8)+'% dmg for Archers & Bombers'
    :k==='trap'?'-'+Math.round(trapDefBonus()*100)+'% raider strength on arrival'
    :k==='tower'?'+'+Math.round(towerWarnBonus())+'s early warning before a raid'
    :k==='aphid'?'+'+honeydewRate().toFixed(2)+' 🍮/s honeydew'
    :k==='laser'?'-'+laserDefDmg()+' raider HP burned off before the fight'
    :'';""",
"""  const extra=k==='armory'?'+'+Math.round(S.rooms.armory*8)+'% dmg for Archers & Bombers'
    :k==='trap'?'-'+Math.round(trapDefBonus()*100)+'% raider strength on arrival'
    :k==='tower'?'+'+Math.round(towerWarnBonus())+'s early warning before a raid'
    :k==='aphid'?'+'+honeydewRate().toFixed(2)+' 🍮/s honeydew'
    :k==='laser'?'-'+laserDefDmg()+' raider HP burned off before the fight'
    :k==='infirmary'?'+'+infirmaryHealRate().toFixed(2)+' hp/s healing for wounded fighters'
    :'';""", s)

# 8) healArmy(dt) tick + infirmary heal functions
s = one(
"""    if(healPts>0 && Math.random()<dt*1.5){
      const nurseHere=agents.find(x=>x.type==='nurse'&&x.room==='nursery');
      const patient=agents.find(x=>x.type===k&&x.room==='nursery');
      if(nurseHere&&patient) healFx.push({x:patient.x,y:patient.y-14,life:0.9,total:0.9});
    }
  });
}

/* ---------------- QUEEN XP / LIFE ---------------- */""",
"""    if(healPts>0 && Math.random()<dt*1.5){
      const nurseHere=agents.find(x=>x.type==='nurse'&&x.room==='nursery');
      const patient=agents.find(x=>x.type===k&&x.room==='nursery');
      if(nurseHere&&patient) healFx.push({x:patient.x,y:patient.y-14,life:0.9,total:0.9});
    }
  });
}
// Infirmary: a dedicated recovery ward with a flat HP/sec heal rate (upgradeable), starting at
// 1 HP per 10 seconds at level 1 — works alongside Nurses, and is the only healing source if you have no Nurses at all
function infirmaryHealRate(){ return S.rooms.infirmary*0.1; }
function healInfirmary(dt){
  if(S.rooms.infirmary<=0) return;
  const hpBudget=infirmaryHealRate()*dt*(1+legacyLvl('resilience')*0.15);
  let totalMissingHp=0;
  FIGHTERS.forEach(k=>{ totalMissingHp+=S.units[k]*UNITS[k].hp*(100-(S.wounded[k]??100))/100; });
  if(totalMissingHp<=0.02) return;
  FIGHTERS.forEach(k=>{
    const cur=S.wounded[k]??100; if(cur>=100||!S.units[k]) return;
    const missingHp=S.units[k]*UNITS[k].hp*(100-cur)/100;
    const share=missingHp/totalMissingHp;
    const hpGain=hpBudget*share;
    const pctGain=(hpGain/(S.units[k]*UNITS[k].hp))*100;
    S.wounded[k]=Math.min(100, cur+pctGain);
  });
}

/* ---------------- QUEEN XP / LIFE ---------------- */""", s)

# 9) tick(): call healInfirmary
s = one(
"""  healArmy(dt);
  if(S.rooms.aphid>0) S.honeydew=Math.min(honeydewCap(), S.honeydew+honeydewRate()*dt);""",
"""  healArmy(dt);
  healInfirmary(dt);
  if(S.rooms.aphid>0) S.honeydew=Math.min(honeydewCap(), S.honeydew+honeydewRate()*dt);""", s)

# 10) deploySel initial assignment — both openDeploy and openLevelBossDeploy share this exact line
old10 = "deploySel={}; FIGHTERS.forEach(k=>deploySel[k]=S.units[k]);"
c10 = s.count(old10)
if c10 != 2:
    raise SystemExit("expected 2 occurrences of deploySel init, found %d" % c10)
s = s.replace(old10, "deploySel={}; FIGHTERS.forEach(k=>deploySel[k]=healthyCount(k));")

# 11) renderDeploy rows — use healthyCount, show resting note
s = one(
"""  const rows=FIGHTERS.map(k=>{
    const u=UNITS[k], avail=S.units[k], c=sel[k];
    return `<div class="deprow">
      <div class="face">${u.emoji}</div>
      <div class="di"><div class="n">${u.name} <span style="color:#9a8a72;font-weight:600">(have ${avail})</span></div>
        <div class="s">${u.medic?'💚 heals allies':'🗡️'+(u.dmg+dmgBonus())} · ❤️${u.hp} · 🛡️${u.armor+armorBonus()}${(u.shield+shieldBonus())?' · 🔵'+(u.shield+shieldBonus()):''}</div></div>
      <div class="stepper">
        <button data-dec="${k}">−</button><span class="cnt">${c}/${avail}</span><button data-inc="${k}">+</button>
      </div>
    </div>`;
  }).join('');""",
"""  const rows=FIGHTERS.map(k=>{
    const u=UNITS[k], avail=healthyCount(k), resting=S.units[k]-avail, c=sel[k];
    return `<div class="deprow">
      <div class="face">${u.emoji}</div>
      <div class="di"><div class="n">${u.name} <span style="color:#9a8a72;font-weight:600">(have ${avail}${resting>0?', 🩹'+resting+' resting':''})</span></div>
        <div class="s">${u.medic?'💚 heals allies':'🗡️'+(u.dmg+dmgBonus())} · ❤️${u.hp} · 🛡️${u.armor+armorBonus()}${(u.shield+shieldBonus())?' · 🔵'+(u.shield+shieldBonus()):''}</div></div>
      <div class="stepper">
        <button data-dec="${k}">−</button><span class="cnt">${c}/${avail}</span><button data-inc="${k}">+</button>
      </div>
    </div>`;
  }).join('');""", s)

# 12) inc-button clamp uses healthyCount now
s = one(
"""  el('dcard').querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{const k=b.dataset.inc; if(deploySel[k]<S.units[k]){deploySel[k]++; renderDeploy();}});""",
"""  el('dcard').querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{const k=b.dataset.inc; if(deploySel[k]<healthyCount(k)){deploySel[k]++; renderDeploy();}});""", s)

# 13) triggerDefense — only healthy defenders answer the call
s = one(
"""  const home=armyStatsOf(S.units,true);
  if(home.n<1){
    const f=Math.floor(S.food*0.2), c=Math.floor(S.crystal*0.2);
    S.food-=f; S.crystal-=c; S.queen.hp=Math.max(1,S.queen.hp-10);
    toast('💔 '+raider.name+' raided your undefended nest! Lost 🍯'+f+' 💎'+c+'. The Queen was hurt!');
    save(); return;
  }
  const defSel=(()=>{const o={}; FIGHTERS.forEach(k=>o[k]=S.units[k]); return o;})();""",
"""  const defSel=(()=>{const o={}; FIGHTERS.forEach(k=>o[k]=healthyCount(k)); return o;})();
  const home=armyStatsOf(defSel,true);
  if(home.n<1){
    const f=Math.floor(S.food*0.2), c=Math.floor(S.crystal*0.2);
    S.food-=f; S.crystal-=c; S.queen.hp=Math.max(1,S.queen.hp-10);
    const allWounded=FIGHTERS.some(k=>S.units[k]>0);
    toast(allWounded?'💔 Every fighter was resting in the Infirmary! '+raider.name+' raided your undefended nest! Lost 🍯'+f+' 💎'+c+'.':'💔 '+raider.name+' raided your undefended nest! Lost 🍯'+f+' 💎'+c+'. The Queen was hurt!');
    save(); return;
  }""", s)

# 14) nurseryPanel: drop woundedRows() call, add a pointer to the Infirmary instead
s = one(
"""  ${woundedRows()}
  <div class="secttl">Your ants</div>""",
"""  ${FIGHTERS.some(k=>S.units[k]>0&&(S.wounded[k]??100)<99.5)?'<div class="sub">🩹 Wounded fighters are resting in the <b>Infirmary</b> (Build tab) until healed.</div>':''}
  <div class="secttl">Your ants</div>""", s)

# 15) rewrite woundedRows() -> infirmaryRows() with real HP numbers
s = one(
"""// wounded fighters recover under nurse care — shown in the Nursery since that's who does the healing
function woundedRows(){
  const hurt=FIGHTERS.filter(k=>S.units[k]>0 && (S.wounded[k]??100)<99.5);
  if(!hurt.length) return '';
  const rate=S.units.nurse>0?('+'+S.units.nurse+'%/s army-wide, '+(S.units.nurse/Math.max(1,S.units[hurt[0]])).toFixed(2)+'%/s per '+UNITS[hurt[0]].name):'no Nurses — recovery stalled!';
  return `<div class="secttl">🩹 Recovering (Nurses ×${S.units.nurse} treating)</div>
  <div class="sub">${S.units.nurse>0?'Wounded ants heal as Nurses tend them — more Nurses means faster recovery.':'⚠️ No Nurses on duty — wounded ants will not heal!'}</div>
  ${hurt.map(k=>{
    const pct=Math.round(S.wounded[k]??100);
    const color=pct<40?'#ff6b6b':pct<75?'#ffb347':'#8fd68f';
    return `<div class="eggrow"><div class="top"><div class="eface">${UNITS[k].emoji}</div>
      <div class="einfo">${UNITS[k].name} <span class="esub">${pct}% health</span></div></div>
      <div class="growbar"><i style="width:${pct}%;background:${color}"></i></div>
    </div>`;
  }).join('')}`;
}""",
"""// wounded fighters must rest in the Infirmary until fully healed — Nurses and the Infirmary
// room both contribute to recovery; every injured ant's real HP is shown here until it's back to full
function infirmaryRows(){
  const hurt=FIGHTERS.filter(k=>S.units[k]>0 && (S.wounded[k]??100)<99.5);
  if(!hurt.length) return '<div class="secttl">🩹 Infirmary Ward</div><div class="sub">No injuries — every fighter is fit for duty.</div>';
  const infRate=infirmaryHealRate();
  return `<div class="secttl">🩹 Infirmary Ward — Recovering</div>
  <div class="sub">Nurses ×${S.units.nurse}${S.units.nurse>0?' tending':''} · Infirmary ${S.rooms.infirmary>0?('Lv'+S.rooms.infirmary+' (+'+infRate.toFixed(2)+' hp/s)'):'not built yet — recovery is slower'}
  ${(S.units.nurse<=0&&S.rooms.infirmary<=0)?'<br><span style="color:#ffb0b0">⚠️ No Nurses and no Infirmary — wounded ants will not heal at all!</span>':''}</div>
  ${hurt.map(k=>{
    const pct=Math.round(S.wounded[k]??100);
    const maxHp=UNITS[k].hp, curHp=Math.max(1,Math.round(maxHp*pct/100));
    const resting=S.units[k]-healthyCount(k);
    const color=pct<40?'#ff6b6b':pct<75?'#ffb347':'#8fd68f';
    return `<div class="eggrow"><div class="top"><div class="eface">${UNITS[k].emoji}</div>
      <div class="einfo">${UNITS[k].name} <span class="esub">${curHp}/${maxHp} hp${resting>0?' · '+resting+' resting':''}</span></div></div>
      <div class="growbar"><i style="width:${pct}%;background:${color}"></i></div>
    </div>`;
  }).join('')}`;
}""", s)

# 16) buildPanel: show the infirmary ward list under the rooms list
s = one(
"""function buildPanel(){
  return `<h2>🏗️ Colony Expansion</h2>
  <div class="sub">Dig new chambers off the Barracks and Throne tunnels. Each room can be upgraded further once built — bigger colonies need more than just a Nursery and Granary.</div>
  <div class="secttl">New Rooms</div>
  ${Object.keys(ROOMS).map(roomRow).join('')}`;
}""",
"""function buildPanel(){
  return `<h2>🏗️ Colony Expansion</h2>
  <div class="sub">Dig new chambers off the Barracks and Throne tunnels. Each room can be upgraded further once built — bigger colonies need more than just a Nursery and Granary.</div>
  <div class="secttl">New Rooms</div>
  ${Object.keys(ROOMS).map(roomRow).join('')}
  ${infirmaryRows()}`;
}""", s)

open(f_out, "w", encoding="utf-8").write(s)
print("ALL EDITS OK, length", len(s))
