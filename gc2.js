
/* ==========================================================================
   ANTOPIA — Rise of the Queen (v7)
   long-term progression rebalance + battle formations + prep phase
   ========================================================================== */
const SAVE_KEY='antopia_save_v5';

/* ---------------- DIFFICULTY ---------------- */
const DIFFS={
  easy:  {name:'Easy',   desc:'Gentler raiders, more time between attacks, cheaper everything. Good for a relaxed first dynasty.', enemyMult:0.75, freqMult:1.3,  costMult:0.85},
  normal:{name:'Normal', desc:'Balanced challenge — the default Antopia experience.',                                            enemyMult:1,    freqMult:1,    costMult:1},
  hard:  {name:'Hard',   desc:'Fiercer raiders, more frequent attacks, steeper prices. For veteran queens only.',                enemyMult:1.35, freqMult:0.75, costMult:1.15},
};
let pendingDifficulty='normal';
function diff(){ return DIFFS[S.difficulty||'normal']; }

/* ---------------- UNIT DEFINITIONS ---------------- */
const UNITS = {
  worker:  {name:'Forager', emoji:'🐜', color:'#6b4a2b', combat:false, hatchT:14, minLvl:1,
            hp:12, dmg:1,  armor:0, shield:0, food:4,  crystal:0,
            blurb:'Forages above ground & hauls food to the Granary.'},
  nurse:   {name:'Nurse',   emoji:'🍼', color:'#c98bbd', combat:false, hatchT:12, minLvl:1,
            hp:10, dmg:0,  armor:0, shield:0, food:5,  crystal:0,
            blurb:'Carries eggs to the Nursery & speeds up growth.'},
  soldier: {name:'Soldier', emoji:'⚔️', color:'#b5462f', combat:true, hatchT:18, minLvl:1,
            hp:34, dmg:6,  armor:2, shield:0, food:8,  crystal:0,
            blurb:'Cheap, sturdy melee bruiser. The backbone.'},
  spitter: {name:'Spitter', emoji:'🟢', color:'#5a9e3a', combat:true, hatchT:20, minLvl:1,
            hp:16, dmg:13, armor:0, shield:0, food:9,  crystal:3,
            blurb:'Ranged acid. High damage, fragile.'},
  guard:   {name:'Guard',   emoji:'🛡️', color:'#3f78c0', combat:true, hatchT:24, minLvl:1,
            hp:46, dmg:3,  armor:4, shield:24,food:10, crystal:6,
            blurb:'Shielded tank. Extra tough defending home.'},
  medic:   {name:'Medic',   emoji:'⛑️', color:'#e0688a', combat:true, hatchT:22, minLvl:5,
            hp:20, dmg:0,  armor:1, shield:0, food:14, crystal:6, medic:true,
            blurb:'Battle healer — runs to hurt fighters and patches them up mid-fight.'},
  archer:  {name:'Archer',  emoji:'🏹', color:'#c9932f', combat:true, hatchT:30, minLvl:6,
            hp:22, dmg:19, armor:1, shield:0, food:16, crystal:8,
            blurb:'Long-range volleys. Expensive but devastating.'},
  siege:   {name:'Boulder Beetle', emoji:'🪨', color:'#8a7a5a', combat:true, hatchT:34, minLvl:11,
            hp:44, dmg:20, armor:3, shield:0, food:26, crystal:16, splash:true,
            blurb:'Slow siege bug — lobs boulders that SPLASH nearby enemies too.'},
  zapper:  {name:'Spark Ant', emoji:'⚡', color:'#d9c22e', combat:true, hatchT:36, minLvl:13,
            hp:22, dmg:15, armor:0, shield:8, food:32, crystal:22, chain:true,
            blurb:'Chain lightning leaps from its antennae across up to 3 enemies.'},
  bomber:  {name:'Bomber',  emoji:'💣', color:'#7a3fb5', combat:true, hatchT:38, minLvl:12,
            hp:30, dmg:32, armor:0, shield:6, food:30, crystal:20, suicide:true, splash:true,
            blurb:'Kamikaze siege ant — detonates on impact for a huge blast, then is gone. One shot, big boom.'},
  wasp:    {name:'Wasp Strafer', emoji:'🐝', color:'#d99a1e', combat:true, hatchT:26, minLvl:9, flying:true,
            hp:18, dmg:15, armor:0, shield:4, food:20, crystal:12,
            blurb:'Fast flying skirmisher — swoops in from above the tunnels.'},
  monarch: {name:'Monarch Bomber', emoji:'🦋', color:'#c04fb0', combat:true, hatchT:42, minLvl:16, flying:true,
            hp:26, dmg:26, armor:1, shield:10, food:40, crystal:28,
            blurb:'Heavy aerial bomber. Devastating payload, very costly.'},
};
const PRINCESS={name:'Princess', emoji:'👸', hatchT:45, food:60, crystal:15};
const UORDER=['worker','nurse','soldier','spitter','guard','medic','archer','bomber','wasp','siege','zapper','monarch'];
const FIGHTERS=['soldier','spitter','guard','medic','archer','bomber','wasp','siege','zapper','monarch'];
const QUEEN_LIFE=960;    // 10 minutes of active play per reign (960 = 600s * 1.6 age mult) — reigns are short, secure an heir fast!
const QUEEN_AGE_MULT=1.6; // Queens age faster now — secure a Princess heir sooner or risk the throne
const HARVEST_MULT=0.25; // ants haul a quarter of what they used to per harvest tick

/* ---------------- GAME STATE ---------------- */
let eggId=0;
function freshState(keepMeta){
  const meta = keepMeta || {jelly:0, missionsClaimed:[], stats:{hatched:Object.fromEntries(UORDER.map(k=>[k,0])),upgrades:0,raidsWon:0,defWins:0,boss:0,queens:1}};
  UORDER.forEach(k=>{ if(!meta.stats.hatched[k]) meta.stats.hatched[k]=0; });
  const d=DIFFS[pendingDifficulty]||DIFFS.normal;
  return {
    food:45, crystal:8,
    difficulty:pendingDifficulty,
    eggQueue:[],
    units:Object.assign(Object.fromEntries(UORDER.map(k=>[k,0])), {worker:3, nurse:1}),
    up:{attack:0,skill:0,carapace:0,shield:0,harvest:0,speed:0,carry:0,capacity:0,fertility:0,nursery:0,granary:0,venom:0,frenzy:0,dodge:0},
    rooms:{armory:0, trap:0, tower:0, aphid:0, laser:0},
    research:null,                       // {k, total, remain} — army training in progress
    queen:{lvl:1, xp:0, age:0, hp:100},
    princessReady:false, noQueen:0, levelBoss:null,
    wounded:Object.fromEntries(FIGHTERS.map(k=>[k,100])),
    legacy:{pts:meta.legacyPts||0, perks:Object.assign({fertility:0,harvest:0,valor:0,resilience:0}, meta.legacyPerks||{})},
    honeydew:0, veterans:[],
    goldenT:0, eventTimer:0, nextEvent:100+Math.random()*80,
    weather:'sun', wT:60+Math.random()*40,
    jelly:meta.jelly, missionsClaimed:meta.missionsClaimed, stats:meta.stats,
    founded:Date.now(),
    lastTick:0, eggTimer:0, elapsed:0, spawnTimer:0,
    defTimer:0, nextDef:(300+Math.random()*180)*d.freqMult,
    bossTimer:0, nextBoss:(600+Math.random()*300)*d.freqMult,
  };
}
let S=freshState();
const SPAWN_EVERY=75, MAX_TARGETS=6, THRONE_CAP=8;

/* ---------------- DERIVED STATS ---------------- */
const cost=(base,lvl,mult=1.6)=>Math.floor(base*Math.pow(mult,lvl)*diff().costMult);
function jellyMult(){ return 1 + S.jelly*0.05; }
function pop(){ return UORDER.reduce((s,k)=>s+S.units[k],0); }
function popCap(){ return 12 + S.up.capacity*8; }
function foodCapAt(l){ return Math.floor(200*Math.pow(1.55,l)); }
function crysCapAt(l){ return Math.floor(40*Math.pow(1.5,l)); }
function foodCap(){ return foodCapAt(S.up.granary); }
function crysCap(){ return crysCapAt(S.up.granary); }
// egg costs grow with colony size — a big colony is expensive to feed
function unitCost(k){
  const u=UNITS[k], m=(1+pop()*0.05)*diff().costMult;
  return {food:Math.ceil(u.food*m), crystal:u.crystal?Math.ceil(u.crystal*m):0};
}
// each new dynasty demands a grander princess
function princessCost(){
  const m=Math.pow(1.5, Math.max(0, S.stats.queens-1))*diff().costMult;
  return {food:Math.ceil(PRINCESS.food*m), crystal:Math.ceil(PRINCESS.crystal*m)};
}
function nurseryCap(){ return 4 + S.up.nursery*2; }
function nurseryFull(){ return nurseryEggs().length + transitEggs().length >= nurseryCap(); }
// eggs are laid one at a time with a 10s base gap — a wounded Queen lays even slower
function eggInterval(){
  const base=Math.max(4, (10 - S.up.fertility*0.6)*(1-legacyLvl('fertility')*0.08));
  const hpFactor=0.4 + 0.6*Math.max(0,Math.min(100,S.queen.hp))/100;
  return base/hpFactor;
}
function workers(){ return S.units.worker; }
function nurses(){ return S.units.nurse; }
function weatherMult(){ return S.weather==='snow'?0:(S.weather==='rain'?0.5:(S.weather==='windy'?0.7:1)); }
function foodRate(){ return workers()*(0.5 + S.up.harvest*0.18 + S.up.speed*0.15 + S.up.carry*0.15)*jellyMult()*weatherMult()*HARVEST_MULT*(1+legacyLvl('harvest')*0.1)*(S.goldenT>0?2:1); }
function crystalRate(){ return workers()*(0.05 + S.up.harvest*0.02 + S.up.carry*0.015)*jellyMult()*HARVEST_MULT; }
function growSpeed(){ return 1 + nurses()*0.08; }
function dmgBonus(){ return S.up.attack*2 + S.up.venom*3 + Math.floor(S.jelly*0.5) + (S.legacy?S.legacy.perks.valor:0); }
function legacyLvl(k){ return S.legacy?S.legacy.perks[k]||0:0; }
function honeydewRate(){ return S.rooms.aphid*0.05; } // 🍮 trickles in from the Aphid Meadow
function honeydewCap(){ return 30+S.rooms.aphid*20; }
function critChance(){ return Math.min(0.6, S.up.skill*0.05); }
function critDmgMult(){ return Math.min(4, 2 + S.up.skill*0.15); } // Precision also sharpens the killing blow
function dodgeChance(){ return Math.min(0.4, S.up.dodge*0.04); }
function frenzyBonus(){ return S.up.frenzy*0.04; }
function armorBonus(){ return S.up.carapace*1; }
function shieldBonus(){ return S.up.shield*10; }
function trainTime(k){ return Math.floor(60*Math.pow(1.5, S.up[k])); } // 1m → minutes → hours
function gainFood(x){ S.food=Math.min(foodCap(), S.food+x); }
function gainCrys(x){ S.crystal=Math.min(crysCap(), S.crystal+x); }

// ---- Colony rooms: Armory / Trap Workshop / Watchtower ----
const ROOMS={
  armory:{name:'Armory',    emoji:'🏮', unlockLvl:6,  base:80,  cbase:20, desc:'Unlocks Archer & Bomber recruitment and strengthens elite fighters.'},
  trap:  {name:'Trap Workshop', emoji:'🵸', unlockLvl:3, base:50, cbase:8,  desc:'Rig the tunnels with traps that maul raiders before they reach the throne.'},
  tower: {name:'Watchtower', emoji:'🗼', unlockLvl:4, base:60,  cbase:10, desc:'Spot raiders earlier, giving you more time to prepare the defense.'},
  aphid: {name:'Aphid Meadow', emoji:'🐛', unlockLvl:5, base:70, cbase:12, desc:'Farm aphids for 🍮 honeydew — spend it on powerful royal boons. Watch out for ladybugs!'},
  laser: {name:'Laser Attack Tower', emoji:'📡', unlockLvl:8, base:100, cbase:20, desc:'An automated turret by the tunnels — scorches raiders with a laser before they ever reach the throne.'},
};
function laserDefDmg(){ return S.rooms.laser*18; } // flat HP chipped off a raider before the defense fight begins
function roomCost(k){ const r=ROOMS[k], lvl=S.rooms[k]; return {food:cost(r.base,lvl), crystal:r.cbase?cost(r.cbase,lvl):0}; }
function trapDefBonus(){ return Math.min(0.6, S.rooms.trap*0.08); } // % raider hp/dps shaved off before defense battle
function towerWarnBonus(){ return S.rooms.tower*2; } // extra seconds of alarm countdown

function woundFrac(k){ return Math.max(0.05, (S.wounded[k]??100)/100); }
const MELEE_FRONT=['soldier','guard','bomber'];
function defaultRow(k){ return MELEE_FRONT.includes(k) ? 'front' : 'back'; }
// enemy ranks get more organized (armor from coordinated formation) as their tier climbs
function enemyFormed(tier){ return tier>=5; }
function armyStatsOf(sel, home){
  let hp=0, shield=0, dps=0, armorSum=0, n=0;
  FIGHTERS.forEach(k=>{
    const u=UNITS[k]; const c=sel[k]||0; if(!c) return;
    n+=c;
    const gb=(home&&k==='guard')?1.5:1;
    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    const wf=woundFrac(k);
    hp+=u.hp*c*gb*wf; shield+=(u.shield+shieldBonus())*c*gb;
    dps+=(u.dmg+dmgBonus())*(1+critChance()*(critDmgMult()-1)+frenzyBonus()+vetBonus(k))*(1-dodgeChance()*0.3)*c*eliteB;
    armorSum+=(u.armor+armorBonus())*c;
  });
  let armor=n?armorSum/n:0; if(home) armor*=1.25;
  return {hp,shield,dps,armor,n};
}
// nurses treat the wounded: total healing throughput scales with nurse count —
// 1 nurse restores about 1% of a single ant's health per second, shared across the whole army
function healArmy(dt){
  const nurseCount=S.units.nurse;
  if(nurseCount<=0) return;
  const healBudget=nurseCount*dt*(1+legacyLvl('resilience')*0.15); // in ant-percent units
  let totalMissing=0;
  FIGHTERS.forEach(k=>{ totalMissing+=S.units[k]*(100-(S.wounded[k]??100))/100; });
  if(totalMissing<=0.02) return;
  FIGHTERS.forEach(k=>{
    const cur=S.wounded[k]??100; if(cur>=100||!S.units[k]) return;
    const typeMissing=S.units[k]*(100-cur)/100;
    const share=typeMissing/totalMissing;
    const healPts=(healBudget*share)/Math.max(1,S.units[k]);
    S.wounded[k]=Math.min(100, cur+healPts);
    // visible treatment: a nurse tending a patient of this type in the Nursery sparks a heal fx
    if(healPts>0 && Math.random()<dt*1.5){
      const nurseHere=agents.find(x=>x.type==='nurse'&&x.room==='nursery');
      const patient=agents.find(x=>x.type===k&&x.room==='nursery');
      if(nurseHere&&patient) healFx.push({x:patient.x,y:patient.y-14,life:0.9,total:0.9});
    }
  });
}

/* ---------------- QUEEN XP / LIFE ---------------- */
function xpNeed(l){ return Math.floor(60*Math.pow(l,1.6)); }
function addXP(x){
  S.queen.xp+=x;
  if(!S.levelBoss && S.queen.xp>=xpNeed(S.queen.lvl)){
    S.levelBoss=makeLevelBoss(S.queen.lvl+1);
    toast('⭐ Level '+(S.queen.lvl+1)+' awaits! Defeat the '+S.levelBoss.name+' in the Queen tab to ascend.');
    float('⭐','#ffd34e');
  }
  updateHUD(); updateDots();
}
function queenDies(){
  if(S.princessReady){
    S.princessReady=false;
    S.queen.age=0; S.queen.hp=100;
    S.stats.queens++;
    S.jelly+=1;
    addXP(30);
    toast('👸→👑 The Princess ascends the throne! +1 Royal Jelly. Long live the Queen!');
    float('👑','#ffd34e');
  } else {
    S.noQueen=45;
    S.food=Math.max(0,S.food*0.85);
    toast('💔 The Queen has passed with no heir… The colony halts while elders raise an emergency queen (45s).');
  }
  save();
}

/* ---------------- MISSIONS ---------------- */
const MISSIONS=[
  {id:'w3',  t:'Hatch 3 Foragers',          c:()=>S.stats.hatched.worker>=3,   r:{food:40,xp:10}},
  {id:'n1',  t:'Hatch a Nurse',             c:()=>S.stats.hatched.nurse>=1,    r:{food:30,xp:10}},
  {id:'f1',  t:'Hatch your first fighter',  c:()=>S.stats.hatched.soldier+S.stats.hatched.spitter+S.stats.hatched.guard>=1, r:{food:30,xp:10}},
  {id:'f5',  t:'Hatch 5 fighters',          c:()=>S.stats.hatched.soldier+S.stats.hatched.spitter+S.stats.hatched.guard>=5, r:{crystal:5,xp:15}},
  {id:'e1',  t:'Complete a training',       c:()=>S.stats.upgrades>=1,         r:{food:50,xp:15}},
  {id:'r1',  t:'Win your first Raid',       c:()=>S.stats.raidsWon>=1,         r:{crystal:8,xp:25}},
  {id:'p15', t:'Reach population 15',       c:()=>pop()>=15,                   r:{food:80,xp:20}},
  {id:'d1',  t:'Defend the nest once',      c:()=>S.stats.defWins>=1,          r:{crystal:10,xp:25}},
  {id:'r5',  t:'Win 5 Raids',               c:()=>S.stats.raidsWon>=5,         r:{food:150,xp:40}},
  {id:'q5',  t:'Reach Queen level 5',       c:()=>S.queen.lvl>=5,              r:{crystal:15,xp:0}},
  {id:'b1',  t:'Defeat a Boss',             c:()=>S.stats.boss>=1,             r:{crystal:25,xp:60}},
  {id:'qq2', t:'Crown a 2nd Queen',         c:()=>S.stats.queens>=2,           r:{crystal:20,xp:50}},
  {id:'e8',  t:'Complete 8 trainings',      c:()=>S.stats.upgrades>=8,         r:{food:200,xp:50}},
  {id:'p30', t:'Reach population 30',       c:()=>pop()>=30,                   r:{crystal:20,xp:60}},
  {id:'p50', t:'Reach population 50',       c:()=>pop()>=50,                   r:{crystal:40,xp:150}},
  {id:'q10', t:'Reach Queen level 10',      c:()=>S.queen.lvl>=10,             r:{crystal:50,xp:0}},
  {id:'r25', t:'Win 25 Raids',              c:()=>S.stats.raidsWon>=25,        r:{food:600,xp:200}},
  {id:'b5',  t:'Defeat 5 Bosses',           c:()=>S.stats.boss>=5,             r:{crystal:80,xp:250}},
  {id:'e20', t:'Complete 20 trainings',     c:()=>S.stats.upgrades>=20,        r:{food:800,xp:300}},
  {id:'qq5', t:'Crown a 5th Queen',         c:()=>S.stats.queens>=5,           r:{crystal:100,xp:300}},
  {id:'j10', t:'Collect 10 Royal Jelly',    c:()=>S.jelly>=10,                 r:{crystal:150,xp:400}},
  {id:'p80', t:'Reach population 80',       c:()=>pop()>=80,                   r:{crystal:150,xp:500}},
  {id:'q20', t:'Reach Queen level 20',      c:()=>S.queen.lvl>=20,             r:{crystal:200,xp:0}},
  {id:'r100',t:'Win 100 Raids',             c:()=>S.stats.raidsWon>=100,       r:{food:3000,xp:1000}},
  {id:'qq10',t:'Crown a 10th Queen',        c:()=>S.stats.queens>=10,          r:{crystal:400,xp:1200}},
];
function missionClaimable(){ return MISSIONS.filter(m=>m.c()&&!S.missionsClaimed.includes(m.id)).length; }
function claimMission(id){
  const m=MISSIONS.find(x=>x.id===id);
  if(!m||S.missionsClaimed.includes(id)||!m.c()) return;
  S.missionsClaimed.push(id);
  if(m.r.food) gainFood(m.r.food);
  if(m.r.crystal) gainCrys(m.r.crystal);
  if(m.r.xp) addXP(m.r.xp);
  float('🎁','#ffd34e'); toast('Mission complete! Reward claimed 🎁');
  renderPanel(); updateHUD(); updateDots(); save();
}

/* ---------------- ENEMY COLONIES + BOSSES (they evolve too!) ---------------- */
const ENEMY_NAMES=['Redback Raiders','Sugar Thieves','The Mud Kings','Beetle Bunker',
  'Termite Tower','Wasp Nest Alpha','Grubby Hollow','The Black Legion','Ironjaw Clan',
  'Nectar Barons','Dune Skitterers','The Pale Swarm'];
const ENEMY_NAMES_EVOLVED=['The Chitin Dominion','Hivemind Ascendant','The Broodswarm Empire',
  'Nightfang Legion','The Obsidian Colony'];
const ENEMY_FACE=['🪲','🐝','🕷️','🐛','🦗','🐌'];
const ENEMY_FACE_EVOLVED=['🦂','🦟','🦇','🐍','🐜'];
const AIR_ENEMY_FACES=['🦟','🐝','🦋','🪰'];
const BOSSES=[
  {name:'Giant Beetle', face:'🪳', mult:3.2, minTier:1,  mech:'shielded', mechDesc:'🔷 Hardened shell — its shield regrows until its minions fall'},
  {name:'Greedy Anteater', face:'🦔', mult:4.2, minTier:1,  mech:'rage',     mechDesc:'🔥 Grows angrier — damage ramps up over time. Kill it fast!'},
  {name:'Spider Queen', face:'🕸️', mult:3.6, minTier:1,  mech:'stun',     mechDesc:'🕸️ Webs your front line — periodically freezes them mid-fight'},
  {name:'Ancient Hive Mother', face:'👾', mult:5.5, minTier:9,  mech:'summon',   mechDesc:'🐣 Births fresh broodlings mid-battle. Endless swarm!'},
  {name:'The Devourer', face:'🐙', mult:6.5, minTier:14, mech:'rage',     mechDesc:'🔥 Feeds on the fallen — damage ramps up over time'},
];
// every level must be earned — a Trial Guardian stands between the Queen and her next level
const LEVEL_BOSSES=[
  {name:'Trial Sentinel', face:'🛡️', mech:'shielded', mechDesc:'🔷 Regrowing shield until its minions fall'},
  {name:'Ironclad Behemoth', face:'🪲', mech:'rage', mechDesc:'🔥 Damage ramps up over time — kill it fast'},
  {name:"Queen's Rival", face:'👑', mech:'stun', mechDesc:'🕸️ Periodically freezes your front line'},
  {name:'The Old Warden', face:'🦂', mech:'summon', mechDesc:'🐣 Summons broodlings mid-battle'},
];
function makeLevelBoss(forLvl){
  const b=LEVEL_BOSSES[Math.floor(Math.random()*LEVEL_BOSSES.length)];
  const tier=Math.max(1, Math.round(forLvl*0.8));
  const em=diff().enemyMult;
  const hp=Math.floor(50*tier*2.4*em);
  return { id:-1, forLvl, levelChallenge:true, name:b.name, face:b.face, tier,
    hp, shield:Math.floor(hp*0.18), dps:5*tier*1.3*em, armor:Math.floor(tier*0.9),
    food:0, crystal:0, boss:true, expires:0, mech:b.mech, mechDesc:b.mechDesc };
}
let targets=[], enemyId=0;
// enemies evolve with playtime, queen level, and how many dynasties you've survived —
// the longer & further you play, the fiercer the rival colonies become.
function tierNow(){
  const timeBonus=Math.floor(S.elapsed/1200);          // +1 tier every ~20 min of active play
  const dynastyBonus=Math.floor((S.stats.queens-1)*0.6);
  return Math.max(1, Math.floor(S.queen.lvl*0.7) + Math.floor(S.jelly*0.5) + timeBonus + dynastyBonus + Math.floor(Math.random()*3));
}
function enemyEvolved(tier){ return tier>=9; }
function makeTarget(){
  const tier=tierNow();
  const evo=enemyEvolved(tier);
  const em=diff().enemyMult;
  const hp=Math.floor(45*tier*(0.85+Math.random()*0.4)*(evo?1.15:1)*em);
  return { id:++enemyId,
    name:evo?ENEMY_NAMES_EVOLVED[Math.floor(Math.random()*ENEMY_NAMES_EVOLVED.length)]:ENEMY_NAMES[Math.floor(Math.random()*ENEMY_NAMES.length)],
    face:evo?ENEMY_FACE_EVOLVED[Math.floor(Math.random()*ENEMY_FACE_EVOLVED.length)]:ENEMY_FACE[Math.floor(Math.random()*ENEMY_FACE.length)],
    tier, hp, shield:Math.floor(hp*0.15*Math.random()),
    dps:4.5*tier*(0.8+Math.random()*0.5)*(evo?1.15:1)*em, armor:Math.floor(tier*0.7*(evo?1.2:1)),
    food:Math.floor(28*tier*(0.8+Math.random()*0.6)), crystal:Math.floor(tier*(1+Math.random()*2)),
    boss:false, evolved:evo, expires:0, scouted:false, scoutT:0 };
}
function makeBoss(){
  const tier=Math.max(2,tierNow());
  const pool=BOSSES.filter(b=>tier>=b.minTier);
  const b=pool[Math.floor(Math.random()*pool.length)];
  const em=diff().enemyMult;
  const hp=Math.floor(45*tier*b.mult*em);
  return { id:++enemyId, name:b.name, face:b.face, tier,
    hp, shield:Math.floor(hp*0.2), dps:4.5*tier*1.6*em, armor:Math.floor(tier*1.1),
    food:Math.floor(60*tier*b.mult*0.6), crystal:Math.floor(tier*5), boss:true, expires:240, mech:b.mech, mechDesc:b.mechDesc };
}
function initTargets(){ targets=[makeTarget(),makeTarget(),makeTarget()]; targets.forEach(t=>t.scouted=true); }
function removeTarget(t){ targets=targets.filter(x=>x.id!==t.id); }

/* ==========================================================================
   SAVE / LOAD / OFFLINE
   ========================================================================== */
function save(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify({t:Date.now(), S, targets, enemyId, eggId})); }catch(e){}
}
function loadSave(){
  try{ const raw=localStorage.getItem(SAVE_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function eraseSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }
function applySave(d){
  const fresh=freshState();
  S=Object.assign(fresh,d.S);
  S.units=Object.assign(Object.fromEntries(UORDER.map(k=>[k,0])), {worker:3,nurse:1}, d.S.units);
  S.up=Object.assign(freshState().up, d.S.up);
  S.rooms=Object.assign({armory:0,trap:0,tower:0,aphid:0,laser:0}, d.S.rooms);
  S.difficulty=d.S.difficulty||'normal';
  S.levelBoss=d.S.levelBoss||null;
  S.wounded=Object.assign(Object.fromEntries(FIGHTERS.map(k=>[k,100])), d.S.wounded);
  S.legacy=d.S.legacy?{pts:d.S.legacy.pts||0, perks:Object.assign({fertility:0,harvest:0,valor:0,resilience:0}, d.S.legacy.perks)}:{pts:0,perks:{fertility:0,harvest:0,valor:0,resilience:0}};
  S.honeydew=d.S.honeydew||0;
  S.veterans=(d.S.veterans||[]).slice(0,5);
  S.goldenT=d.S.goldenT||0;
  S.eventTimer=0; S.nextEvent=100+Math.random()*80;
  S.queen=Object.assign({lvl:1,xp:0,age:0,hp:100}, d.S.queen);
  S.stats=Object.assign(freshState().stats, d.S.stats||{});
  S.stats.hatched=Object.assign(Object.fromEntries(UORDER.map(k=>[k,0])),(d.S.stats||{}).hatched||{});
  S.missionsClaimed=d.S.missionsClaimed||[];
  S.eggQueue=(d.S.eggQueue||[]).slice(0,20);
  // agents (and the Nurse currently carrying it) are not persisted — any egg that was
  // mid-carry when the game saved goes back to the Throne Room for a fresh Nurse to claim
  S.eggQueue.forEach(e=>{ if(e.stage==='transit'){ e.stage='throne'; e.prog=0; e.carrierId=null; } });
  // weather migration (old saves used a boolean 'rain')
  if(!S.weather){ S.weather=d.S.rain?'rain':'sun'; }
  if(!S.wT||S.wT<0) S.wT=35;
  if(d.S.research && d.S.research.k) S.research={...d.S.research}; else S.research=null;
  targets=(d.targets||[]).filter(t=>!t.boss);
  targets.forEach(t=>{ if(t.scouted===undefined) t.scouted=true; if(t.scoutT===undefined) t.scoutT=0; });
  enemyId=d.enemyId||100; eggId=d.eggId||100;
  if(targets.length<2) targets.push(makeTarget());
  const away=Math.min(24*3600, Math.max(0,(Date.now()-d.t)/1000));
  if(away>30){
    const f=Math.min(Math.floor(foodRate()*away*0.6), Math.max(0,foodCap()-Math.floor(S.food)));
    const c=Math.min(Math.floor(crystalRate()*away*0.6), Math.max(0,crysCap()-Math.floor(S.crystal)));
    gainFood(f); gainCrys(c);
    let hatchedAway=0;
    // Nurses keep ferrying eggs while you're away too — approximate their throughput
    // since individual agents aren't saved between sessions
    if(S.units.nurse>0){
      let trips=Math.floor(away/6)*S.units.nurse;
      while(trips-->0){
        const te=S.eggQueue.find(e=>e.stage==='throne');
        if(!te) break;
        if(nurseryEggs().length+transitEggs().length>=nurseryCap()) break;
        te.stage='nursery'; te.prog=0;
      }
    }
    S.eggQueue.forEach(e=>{ if(e.stage==='nursery'&&e.type){ e.prog+=away*0.5; } });
    hatchedAway=processHatches(true);
    if(S.research){ S.research.remain-=away; if(S.research.remain<=0){ S.up[S.research.k]++; S.stats.upgrades++; S.research=null; } }
    S.queen.age=Math.min(S.queen.age+away*0.064*QUEEN_AGE_MULT, QUEEN_LIFE*0.95);
    return {away,f,c,hatchedAway};
  }
  return null;
}
function fmtAway(s){
  if(s>=3600) return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
  if(s>=60) return Math.floor(s/60)+' minutes';
  return Math.floor(s)+' seconds';
}
function fmtDur(s){
  s=Math.max(0,Math.floor(s));
  if(s>=3600) return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m';
  if(s>=60) return Math.floor(s/60)+'m '+(s%60)+'s';
  return s+'s';
}

/* ==========================================================================
   EGG PIPELINE
   ========================================================================== */
function throneEggs(){ return S.eggQueue.filter(e=>e.stage==='throne'); }
function transitEggs(){ return S.eggQueue.filter(e=>e.stage==='transit'); }
function nurseryEggs(){ return S.eggQueue.filter(e=>e.stage==='nursery'); }
function assignEgg(id, type){
  const e=S.eggQueue.find(x=>x.id===id);
  if(!e||e.stage!=='nursery'||e.type) return;
  if(type==='princess'){
    if(S.princessReady || S.eggQueue.some(x=>x.type==='princess')){ toast('You already have an heir on the way! 👸'); return; }
    const pc=princessCost();
    if(S.food<pc.food||S.crystal<pc.crystal){ toast('Need 🍯'+pc.food+' 💎'+pc.crystal+' for a Princess'); return; }
    S.food-=pc.food; S.crystal-=pc.crystal;
    e.type='princess'; e.prog=0;
    toast('👸 A Princess egg! She will secure your dynasty.');
  } else {
    const u=UNITS[type], uc=unitCost(type);
    if((u.minLvl||1)>S.queen.lvl){ toast('🔒 '+u.name+' needs Queen level '+u.minLvl+'.'); return; }
    if((type==='archer'||type==='bomber')&&S.rooms.armory<1){ toast('🏮 Build the Armory first!'); return; }
    if(pop()>=popCap()){ toast('Colony is at max ants — evolve 👑 Royal Growth!'); return; }
    if(S.food<uc.food||S.crystal<uc.crystal){ toast('Not enough resources for '+u.name); return; }
    S.food-=uc.food; S.crystal-=uc.crystal;
    e.type=type; e.prog=0;
  }
  renderPanel(); updateHUD(); save();
}
function hatchTimeFor(type){ return type==='princess'?PRINCESS.hatchT:UNITS[type].hatchT; }
// Eggs no longer teleport to the Nursery on a timer — a real Nurse ant must physically
// walk to the Throne Room, pick one up, and carry it back. See claimThroneEgg()/deliverEgg().
function tickEggs(dt){
  // eggs grow, then crack open (short animation) before the ant actually emerges
  nurseryEggs().forEach(e=>{
    if(!e.type) return;
    if(e.hatching){ e.hatchFx=Math.max(0,(e.hatchFx||0)-dt); return; }
    e.prog+=dt*growSpeed();
    if(e.prog>=hatchTimeFor(e.type)){ e.hatching=true; e.hatchFx=1.1; spawnHatchCrack(e); }
  });
  processHatches(false);
}
function spawnHatchCrack(e){
  if(!LAY) return;
  const nur=LAY.nursery;
  hatchFx.push({x:nur.x+nur.w*0.5+(Math.random()*22-11), y:nur.y+nur.h*0.55,
    emoji:e.type==='princess'?'👸':UNITS[e.type].emoji, life:1.1, total:1.1});
}
function processHatches(silent){
  let count=0;
  S.eggQueue=S.eggQueue.filter(e=>{
    if(e.stage!=='nursery'||!e.type) return true;
    if(silent){
      if(e.prog<hatchTimeFor(e.type)) return true;
    } else {
      if(!e.hatching||e.hatchFx>0) return true;
    }
    count++;
    if(e.type==='princess'){
      S.princessReady=true;
      if(!silent){ toast('👸 The Princess has grown! Your dynasty is safe.'); float('👸','#ff9de0'); }
    } else if(pop()<popCap()){
      S.units[e.type]++; S.stats.hatched[e.type]++;
      addXP(2); syncAgents();
      if(!silent){ float(UNITS[e.type].emoji, UNITS[e.type].color); }
    } else { return true; }
    return false;
  });
  return count;
}

/* ==========================================================================
   LAYOUT + CURVED TUNNEL PATHS (4 rooms)
   ========================================================================== */
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
const bcv=document.getElementById('battleCv'), bctx=bcv.getContext('2d');
function resizeBattleCv(){
  if(!bcv) return;
  const r=bcv.parentElement.getBoundingClientRect();
  bcv.width=Math.max(50,Math.floor(r.width)); bcv.height=Math.max(50,Math.floor(r.height));
  if(B&&B.phase==='fight') layoutBattleUnits();
}
let W=0,H=0,DPR=1, LAY=null, PATHS=null;
function resize(){
  DPR=Math.min(2,window.devicePixelRatio||1);
  const r=cv.parentElement.getBoundingClientRect();
  W=r.width; H=r.height; cv.width=W*DPR; cv.height=H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  computeLayout();
  spawnCritters();
}
function setMobileVH(){
  try{ document.documentElement.style.setProperty('--vh', (window.innerHeight*0.01)+'px'); }catch(e){}
}
setMobileVH();
window.addEventListener('resize',setMobileVH);
window.addEventListener('orientationchange',setMobileVH);
window.addEventListener('resize',resize);
window.addEventListener('resize',resizeBattleCv);
window.addEventListener('orientationchange',()=>{ setTimeout(()=>{ resize(); resizeBattleCv(); },120); });
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{ setMobileVH(); resize(); resizeBattleCv(); });
}

function cubic(p0,c1,c2,p1,n){
  const pts=[];
  for(let i=0;i<=n;i++){
    const t=i/n, u=1-t;
    pts.push({
      x:u*u*u*p0.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*p1.x,
      y:u*u*u*p0.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*p1.y,
    });
  }
  return pts;
}
function computeLayout(){
  const gy=H*0.28;
  const tw=Math.min(280,W*0.40), th=Math.min(130,(H-gy)*0.30);
  const throne={x:W*0.5-tw/2, y:gy+(H-gy)*0.24-th*0.30, w:tw, h:th};
  const sw=Math.min(165,W*0.25), sh=Math.min(108,(H-gy)*0.26);
  const nursery={x:8, y:H-sh-12, w:sw, h:sh};
  const granary={x:W-sw-8, y:H-sh-12, w:sw, h:sh};
  const bw=Math.min(190,W*0.30), bh=Math.min(96,(H-gy)*0.23);
  // raised so the Lay Egg button never covers it
  const by=Math.max(throne.y+throne.h+8, H-bh-74);
  const barracks={x:W*0.5-bw/2, y:by, w:bw, h:bh};
  const rrw=Math.min(72,W*0.12), rrh=Math.min(58,bh*0.85);
  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom};
  const thTop={x:throne.x+throne.w/2, y:throne.y+14};
  const thBL={x:throne.x+30, y:throne.y+throne.h-14};
  const thBR={x:throne.x+throne.w-30, y:throne.y+throne.h-14};
  const thBC={x:throne.x+throne.w/2, y:throne.y+throne.h-10};
  const surf={x:W*0.5, y:gy-6};
  const surf2={x:W*0.24, y:gy-6};
  const surf3={x:W*0.76, y:gy-6};
  PATHS={
    surface: cubic(thTop, {x:W*0.34,y:(gy+thTop.y)/2+22}, {x:W*0.66,y:gy+18}, surf, 16),
    surfaceB: cubic(thTop, {x:W*0.30,y:(gy+thTop.y)/2+30}, {x:W*0.28,y:gy+22}, surf2, 16),
    surfaceC: cubic(thTop, {x:W*0.70,y:(gy+thTop.y)/2+30}, {x:W*0.72,y:gy+22}, surf3, 16),
    nursery: cubic(thBL, {x:W*0.42,y:H*0.66}, {x:W*0.02,y:H*0.60}, {x:nursery.x+nursery.w*0.62, y:nursery.y+12}, 16),
    granary: cubic(thBR, {x:W*0.58,y:H*0.66}, {x:W*0.98,y:H*0.60}, {x:granary.x+granary.w*0.38, y:granary.y+12}, 16),
    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
  };
  PATHS.surfaceVariants=['surface','surfaceB','surfaceC'];
}
function roomRect(room){
  if(room==='surface') return {x:16,y:LAY.gy-16,w:W-32,h:12};
  const r=LAY[room];
  return {x:r.x+16,y:r.y+22,w:r.w-32,h:r.h-38};
}
function pickSurfaceKey(){
  const v=PATHS.surfaceVariants||['surface'];
  return v[Math.floor(Math.random()*v.length)];
}
function buildRoute(from,to){
  if(from===to) return null;
  const rk=r=> r==='surface' ? pickSurfaceKey() : r;
  const segTo=r=>PATHS[rk(r)].slice();
  const segFrom=r=>PATHS[rk(r)].slice().reverse();
  if(from==='throne') return segTo(to);
  if(to==='throne') return segFrom(from);
  return segFrom(from).concat(segTo(to));
}

/* ==========================================================================
   CRITTERS — worms underground, hoppers/ladybug on the surface
   ========================================================================== */
let critters=[];
let raiderApproach=null;
function spawnRaiderApproach(){
  if(!LAY||W<50) return;
  const fromLeft=Math.random()<0.5;
  const exitKey=PATHS?pickSurfaceKey():'surface';
  const ent=(PATHS&&PATHS[exitKey])?PATHS[exitKey][PATHS[exitKey].length-1]:{x:W*0.5,y:LAY.gy-6};
  raiderApproach={
    x: fromLeft? -24 : W+24, y: LAY.gy-11,
    tx: ent.x, ty: LAY.gy-11,
    face:['🪲','🐝','🦗','🦂'][Math.floor(Math.random()*4)],
    spd:(Math.hypot(ent.x-(fromLeft?-24:W+24),0))/9.5,
  };
}
function updateRaiderApproach(dt){
  if(!raiderApproach) return;
  const r=raiderApproach;
  const dx=r.tx-r.x, d=Math.abs(dx)||1;
  r.x+=Math.sign(dx)*Math.min(d, r.spd*dt);
}
function drawRaiderApproach(t){
  if(!raiderApproach||!LAY) return;
  const r=raiderApproach;
  ctx.save(); ctx.translate(r.x, r.y+Math.sin(t*8)*2);
  ctx.font='22px sans-serif'; ctx.textAlign='center';
  ctx.fillText(r.face, 0, 0);
  ctx.font='700 9px Trebuchet MS'; ctx.fillStyle='#ff8080';
  ctx.fillText('⚠️', 0, -18);
  ctx.restore();
}
function validDirt(x,y){
  if(!LAY) return false;
  if(y<LAY.gy+34||y>H-16||x<12||x>W-12) return false;
  for(const key of ['throne','nursery','granary','barracks']){
    const r=LAY[key];
    if(x>r.x-16&&x<r.x+r.w+16&&y>r.y-16&&y<r.y+r.h+16) return false;
  }
  for(const key in PATHS){
    for(const p of PATHS[key]){ if(Math.hypot(p.x-x,p.y-y)<24) return false; }
  }
  return true;
}
function makeWorm(){
  let x=0,y=0,tries=0;
  do{ x=20+Math.random()*(W-40); y=LAY.gy+44+Math.random()*(H-LAY.gy-80); tries++; }
  while(!validDirt(x,y)&&tries<120);
  return {kind:'worm', x, y, ang:Math.random()*6.28, spd:6+Math.random()*5,
    ph:Math.random()*6.28, trail:[], col:['#c9857a','#b8756a','#d494a0'][Math.floor(Math.random()*3)]};
}
function makeHopper(kind){
  return {kind, x:30+Math.random()*(W-60), dir:Math.random()<0.5?1:-1,
    jump:0, jt:1+Math.random()*3, ph:Math.random()*6.28};
}
function spawnCritters(){
  if(!LAY||W<50) return;
  critters=[];
  for(let i=0;i<4;i++) critters.push(makeWorm());
  critters.push(makeHopper('hopper'));
  critters.push(makeHopper('hopper'));
  critters.push(makeHopper('ladybug'));
}
function updateCritters(dt,t){
  critters.forEach(c=>{
    if(c.kind==='worm'){
      c.ang+=Math.sin(t*0.7+c.ph)*0.02;
      const nx=c.x+Math.cos(c.ang)*c.spd*dt;
      const ny=c.y+Math.sin(c.ang)*c.spd*dt*0.5;
      if(validDirt(nx,ny)){ c.x=nx; c.y=ny; }
      else { c.ang+=Math.PI+(Math.random()-0.5)*0.8; }
      if(!c.lastT||t-c.lastT>0.12){ c.trail.unshift({x:c.x,y:c.y}); if(c.trail.length>8)c.trail.pop(); c.lastT=t; }
    } else if(c.kind==='hopper'){
      c.jt-=dt;
      if(c.jt<=0&&c.jump<=0){ c.jump=0.55; c.jt=1.2+Math.random()*3; if(Math.random()<0.3)c.dir*=-1; }
      if(c.jump>0){
        c.jump-=dt;
        c.x+=c.dir*55*dt;
        if(c.x<16||c.x>W-16){ c.dir*=-1; c.x=Math.max(16,Math.min(W-16,c.x)); }
      }
    } else { // ladybug crawls
      c.x+=c.dir*9*dt;
      if(c.x<14||c.x>W-14) c.dir*=-1;
    }
  });
}
function drawCritters(t, layer){
  critters.forEach(c=>{
    if(layer==='under'&&c.kind==='worm'){
      const pts=[{x:c.x,y:c.y},...c.trail];
      for(let i=pts.length-1;i>=0;i--){
        const r=4.2-i*0.38;
        if(r<=0.8) continue;
        ctx.fillStyle=i===0?shade(c.col,14):c.col;
        ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y+Math.sin(t*3+c.ph+i)*1.2, r, 0, 6.28); ctx.fill();
      }
      ctx.fillStyle='#3a1c14';
      ctx.beginPath(); ctx.arc(c.x+Math.cos(c.ang)*3, c.y-1, 0.9, 0, 6.28); ctx.fill();
    }
    if(layer==='over'&&c.kind==='hopper'){
      const jy=c.jump>0?Math.sin((1-c.jump/0.55)*Math.PI)*20:0;
      const y=LAY.gy-11-jy;
      ctx.save(); ctx.translate(c.x,y); if(c.dir<0) ctx.scale(-1,1);
      ctx.fillStyle='#69c94f';
      ctx.beginPath(); ctx.ellipse(0,0,6,3,0,0,6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(5,-1.5,2.4,0,6.28); ctx.fill();
      ctx.strokeStyle='#4a9a35'; ctx.lineWidth=1.4;
      ctx.beginPath(); ctx.moveTo(-2,2); ctx.lineTo(-6,-4); ctx.lineTo(-9,3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6,-3); ctx.lineTo(9,-6); ctx.stroke();
      ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(6,-2,0.8,0,6.28); ctx.fill();
      ctx.restore();
    }
    if(layer==='over'&&c.kind==='ladybug'){
      const y=LAY.gy-9+Math.sin(t*6+c.ph)*0.6;
      ctx.save(); ctx.translate(c.x,y); if(c.dir<0) ctx.scale(-1,1);
      ctx.fillStyle='#d93c2f'; ctx.beginPath(); ctx.ellipse(0,0,4.5,3.2,0,0,6.28); ctx.fill();
      ctx.fillStyle='#000';
      ctx.beginPath(); ctx.arc(4,0,1.8,0,6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(-1.5,-1.2,0.8,0,6.28); ctx.fill();
      ctx.beginPath(); ctx.arc(0.5,1.2,0.8,0,6.28); ctx.fill();
      ctx.strokeStyle='#000'; ctx.lineWidth=0.7;
      ctx.beginPath(); ctx.moveTo(4,-3); ctx.lineTo(0,0); ctx.stroke();
      ctx.restore();
    }
  });
}

/* ==========================================================================
   AGENTS — ants that walk the tunnels
   ========================================================================== */
const agents=[];
// a Nurse standing in the Throne Room claims the oldest unclaimed egg, if the Nursery has room
function claimThroneEgg(agent){
  if(nurseryEggs().length+transitEggs().length>=nurseryCap()) return false;
  const e=S.eggQueue.find(x=>x.stage==='throne'&&!x.carrierId);
  if(!e) return false;
  e.stage='transit'; e.prog=0; e.carrierId=agent.id;
  agent.eggId=e.id;
  return true;
}
// a Nurse arriving at the Nursery hands off whatever egg she's carrying
function deliverEgg(agent){
  if(!agent.eggId) return;
  const e=S.eggQueue.find(x=>x.id===agent.eggId&&x.stage==='transit');
  if(e){ e.stage='nursery'; e.prog=0; e.carrierId=null; }
  agent.eggId=null; agent.hasEgg=false;
}
let nurseAgentSeq=1;
function newAgent(type){
  const rr=LAY?roomRect('nursery'):{x:100,y:200,w:80,h:40};
  return {id:nurseAgentSeq++, type, room:'nursery', route:null, ridx:0, dest:null,
    x:rr.x+Math.random()*rr.w, y:rr.y+Math.random()*rr.h,
    wx:null, wy:null, pause:0.7+Math.random()*1.4,
    spd:(type==='guard'?26:34)+Math.random()*14, wob:Math.random()*6.28,
    carry:false, hasEgg:false, hatchIn:0.6, eggId:null};
}
function syncAgents(){
  UORDER.forEach(type=>{
    let have=agents.filter(a=>a.type===type).length;
    const want=Math.min(S.units[type], 40);
    while(have<want){ agents.push(newAgent(type)); have++; }
    while(have>want){ agents.splice(agents.findIndex(a=>a.type===type),1); have--; }
  });
}
function chooseNext(a){
  if(a.type==='worker'){
    if(a.room==='surface'){ a.dest='granary'; a.carry=true; }
    else if(a.room==='granary'){ a.dest='surface'; a.carry=false; }
    else { a.dest=Math.random()<0.7?'surface':'granary'; a.carry=a.dest==='granary'; }
  } else if(a.type==='nurse'){
    if(a.room==='nursery'){
      a.dest='throne'; a.hasEgg=false;
    } else if(a.room==='throne'){
      if(claimThroneEgg(a)){ a.dest='nursery'; a.hasEgg=true; }
      else { a.pause=1+Math.random()*1.5; return; } // no egg waiting — stay put until one arrives
    } else {
      a.dest='throne'; a.hasEgg=false;
    }
  } else {
    // fighters: during training they flock to the barracks; wounded fighters seek the Nursery for care
    const wounded=UNITS[a.type].combat && (S.wounded[a.type]??100)<99.5;
    const opts=S.research?['barracks','barracks','barracks','throne']
                         :wounded?['nursery','nursery','nursery','throne']
                         :['throne','barracks','barracks','surface','granary','nursery'];
    a.dest=opts[Math.floor(Math.random()*opts.length)];
    if(a.dest===a.room){ a.pause=wounded?2.5+Math.random()*2.5:1+Math.random()*2; return; }
  }
  a.route=buildRoute(a.room,a.dest);
  a.ridx=0;
}
function weatherHazardRoll(){
  const wx=S.weather;
  if(wx==='sun') return false;
  const chance=0.10+Math.random()*0.05; // 10-15% per forager per arrival on the surface
  return Math.random()<chance;
}
function updateAgents(dt,t){
  const weatherCasualties=[];
  agents.forEach(a=>{
    if(a.route){
      const wp=a.route[a.ridx];
      const dx=wp.x-a.x, dy=wp.y-a.y, d=Math.hypot(dx,dy)||1;
      a.x+=dx/d*a.spd*dt; a.y+=dy/d*a.spd*dt;
      if(d<7){
        a.ridx++;
        if(a.ridx>=a.route.length){
          a.route=null; a.room=a.dest;
          a.pause=0.8+Math.random()*2;
          a.wx=null;
          if(a.type==='nurse'&&a.dest==='nursery'&&a.eggId) deliverEgg(a);
          if(a.type==='worker'&&a.room==='surface'&&weatherHazardRoll()) weatherCasualties.push(a);
        }
      }
    } else {
      const rr=roomRect(a.room);
      if(a.wx===null || Math.hypot(a.wx-a.x,a.wy-a.y)<6){
        a.wx=rr.x+Math.random()*rr.w; a.wy=rr.y+Math.random()*rr.h;
      }
      const dx=a.wx-a.x, dy=a.wy-a.y, d=Math.hypot(dx,dy)||1;
      a.x+=dx/d*a.spd*0.45*dt; a.y+=dy/d*a.spd*0.45*dt;
      a.pause-=dt;
      if(a.pause<=0) chooseNext(a);
    }
    if(a.hatchIn>0) a.hatchIn=Math.max(0,a.hatchIn-dt);
  });
  eggFx=eggFx.filter(e=>{e.life-=dt; e.y-=dt*10; return e.life>0;});
  hatchFx=hatchFx.filter(e=>{e.life-=dt; return e.life>0;});
  equipFx=equipFx.filter(e=>{e.life-=dt; return e.life>0;});
  if(weatherCasualties.length){
    const wx=S.weather;
    const msg=wx==='rain'?'🌊 A forager was washed away by the rain!'
      :wx==='snow'?'🥶 A forager froze to death in the snow!'
      :wx==='windy'?'💨 A forager was blown away by the wind!'
      :'A forager was lost to the weather!';
    weatherCasualties.forEach(a=>{
      const idx=agents.indexOf(a);
      if(idx>=0) agents.splice(idx,1);
      S.units.worker=Math.max(0,S.units.worker-1);
    });
    toast(weatherCasualties.length>1?msg+' (x'+weatherCasualties.length+')':msg);
    float('💀','#9be0ff');
  }
}

/* ==========================================================================
   DRAWING
   ========================================================================== */
function cloudShape(x,y,r){ctx.beginPath();ctx.arc(x,y,r,0,6.28);ctx.arc(x+r,y+4,r*0.8,0,6.28);ctx.arc(x-r,y+4,r*0.7,0,6.28);ctx.fill();}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function chamber(x,y,w,h,label,emoji){
  ctx.fillStyle='#3a2314'; roundRect(x,y,w,h,20); ctx.fill();
  ctx.fillStyle='#2b1a0f'; roundRect(x+5,y+5,w-10,h-10,16); ctx.fill();
  ctx.font='700 10px Trebuchet MS'; ctx.fillStyle='#c9b596'; ctx.textAlign='center';
  ctx.fillText(emoji+' '+label, x+w/2, y+14);
}
function drawExpansionRoom(r,key,lvl,emoji){
  if(!r) return;
  if(lvl<1){
    ctx.setLineDash([4,4]);
    ctx.strokeStyle='#6b4a2b80'; ctx.lineWidth=2;
    roundRect(r.x,r.y,r.w,r.h,14); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.globalAlpha=0.5;
    ctx.fillText('🔒', r.x+r.w/2, r.y+r.h/2+6);
    ctx.globalAlpha=1;
    return;
  }
  ctx.fillStyle='#3a2314'; roundRect(r.x,r.y,r.w,r.h,14); ctx.fill();
  ctx.fillStyle='#2b1a0f'; roundRect(r.x+4,r.y+4,r.w-8,r.h-8,10); ctx.fill();
  ctx.font='700 16px sans-serif'; ctx.textAlign='center';
  ctx.fillText(emoji, r.x+r.w/2, r.y+r.h/2+2);
  ctx.font='700 9px Trebuchet MS'; ctx.fillStyle='#ffd34e';
  ctx.fillText('Lv'+lvl, r.x+r.w/2, r.y+r.h-6);
}
function strokePath(pts,width,color,alpha){
  ctx.strokeStyle=color; ctx.globalAlpha=alpha; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round';
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.stroke(); ctx.globalAlpha=1;
}
function drawTree(x,gy,t,wx,mirror){
  const m=mirror?-1:1;
  const sway=(wx==='windy'?Math.sin(t*3)*11:Math.sin(t*0.8+ (mirror?1.6:0))*3)*m;
  const trunkH=46, trunkW=7;
  // roots fan out under the dirt
  ctx.save();
  ctx.strokeStyle='#3a2414'; ctx.globalAlpha=0.75; ctx.lineWidth=3; ctx.lineCap='round';
  [[-14,26],[-6,36],[7,33],[16,22]].forEach(([rx,ry])=>{
    ctx.beginPath(); ctx.moveTo(x,gy+1);
    ctx.quadraticCurveTo(x+rx*0.5,gy+ry*0.55, x+rx, gy+ry);
    ctx.stroke();
  });
  ctx.restore();
  // trunk, swaying at the crown
  ctx.save(); ctx.translate(x,gy);
  ctx.strokeStyle='#5a3820'; ctx.lineWidth=trunkW; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(0,0); ctx.quadraticCurveTo(sway*0.3,-trunkH*0.5, sway, -trunkH); ctx.stroke();
  const cx=sway, cy=-trunkH-3;
  // canopy — a cluster of leafy blobs
  ctx.fillStyle=wx==='snow'?'#5c8a63':'#4a9b3f';
  [[0,0,16],[-12,6,12],[12,6,12],[0,-11,13]].forEach(([ox,oy,r])=>{
    ctx.beginPath(); ctx.arc(cx+ox,cy+oy,r,0,6.28); ctx.fill();
  });
  if(wx==='snow'){
    // snow caps resting on top of the canopy
    ctx.fillStyle='rgba(255,255,255,0.92)';
    [[0,-11,9.5],[-12,6,7],[12,6,7],[0,0,10]].forEach(([ox,oy,r])=>{
      ctx.beginPath(); ctx.arc(cx+ox,cy+oy-r*0.55,r*0.62,0,6.28); ctx.fill();
    });
  }
  if(wx==='windy'){
    // leaves peeling off and blowing away
    ctx.fillStyle='#6fc75a';
    for(let i=0;i<3;i++){
      const lp=((t*1.3+i*0.6)%2)/2;
      const lx=cx+(18+lp*30)*m, ly=cy-4+Math.sin(t*4+i)*6+lp*16;
      ctx.globalAlpha=Math.max(0,1-lp);
      ctx.save(); ctx.translate(lx,ly); ctx.rotate(lp*4);
      ctx.beginPath(); ctx.ellipse(0,0,3,1.6,0,0,6.28); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha=1;
  }
  if(wx==='rain'){
    // raindrops dripping off the leaves
    ctx.fillStyle='rgba(180,220,255,0.75)';
    [[-6,4],[9,7],[-1,-7]].forEach(([ox,oy],i)=>{
      const drip=(t*2.2+i*0.7)%1;
      ctx.globalAlpha=Math.max(0,1-drip);
      ctx.beginPath(); ctx.arc(cx+ox,cy+oy+drip*12,1.5,0,6.28); ctx.fill();
    });
    ctx.globalAlpha=1;
  }
  if(wx==='sun'){
    ctx.fillStyle='rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(cx-5,cy-6,4,0,6.28); ctx.fill();
  }
  ctx.restore();
}
function drawGround(t){
  const {gy,throne,nursery,granary,barracks}=LAY;
  const wx=S.weather;
  // sky
  ctx.fillStyle=wx==='rain'?'#6b93b8':wx==='snow'?'#aebfd0':wx==='windy'?'#a9c2b8':'#8fd3ff';
  ctx.fillRect(0,0,W,gy);
  // sun on clear days
  if(wx==='sun'){
    const sx=W*0.85, sy=gy*0.32;
    const rg=ctx.createRadialGradient(sx,sy,4,sx,sy,46);
    rg.addColorStop(0,'#fff6c8'); rg.addColorStop(0.55,'#ffd34e'); rg.addColorStop(1,'rgba(255,211,78,0)');
    ctx.fillStyle=rg; ctx.beginPath(); ctx.arc(sx,sy,46,0,6.28); ctx.fill();
    ctx.fillStyle='#fff2b0'; ctx.beginPath(); ctx.arc(sx,sy,18,0,6.28); ctx.fill();
  }
  ctx.fillStyle=wx==='sun'?'#ffffffcc':'#8fa8bf';
  cloudShape(W*0.2,gy*0.4,18); cloudShape(W*0.62,gy*0.3,22);
  if(wx==='rain'){
    ctx.strokeStyle='rgba(190,220,255,0.55)'; ctx.lineWidth=1.4;
    for(let i=0;i<46;i++){
      const rx=((i*127)+(t*260))%(W+40)-20;
      const ry=((i*73)+(t*340))%gy;
      ctx.beginPath(); ctx.moveTo(rx,ry); ctx.lineTo(rx-3,ry+9); ctx.stroke();
    }
  }
  if(wx==='snow'){
    ctx.fillStyle='rgba(255,255,255,0.9)';
    for(let i=0;i<36;i++){
      const sx2=((i*127)+(t*40)+Math.sin(t*1.5+i)*18)%(W+20)-10;
      const sy2=((i*89)+(t*55))%gy;
      ctx.beginPath(); ctx.arc(sx2,sy2,1.6+(i%3)*0.6,0,6.28); ctx.fill();
    }
  }
  // grass (snow-dusted when snowing)
  ctx.fillStyle=wx==='snow'?'#cfe0e8':(wx==='rain'?'#4da03f':'#5bbd4a');
  ctx.fillRect(0,gy-10,W,16);
  ctx.fillStyle=wx==='snow'?'#e8f2f6':(wx==='rain'?'#3f8834':'#4aa53c');
  for(let x=0;x<W;x+=14){ctx.beginPath();ctx.moveTo(x,gy-8);ctx.lineTo(x+4,gy-18);ctx.lineTo(x+8,gy-8);ctx.fill();}
  // food crumbs (hidden under snow)
  if(wx!=='snow'){
    ctx.fillStyle='#7ccf4a';
    [[W*0.15],[W*0.35],[W*0.65],[W*0.85]].forEach(([fx],i)=>{
      ctx.beginPath(); ctx.arc(fx, gy-14-(i%2)*3, 4,0,6.28); ctx.fill();
    });
  }
  // dirt
  const g=ctx.createLinearGradient(0,gy,0,H); g.addColorStop(0,'#7a4a26'); g.addColorStop(1,'#4a2c17');
  ctx.fillStyle=g; ctx.fillRect(0,gy,W,H-gy);
  ctx.fillStyle='#00000018';
  for(let i=0;i<20;i++){const px=(i*97%W),py=gy+16+((i*53)%(H-gy-16));ctx.beginPath();ctx.arc(px,py,3+(i%3),0,6.28);ctx.fill();}
  // worms live in the dirt (under tunnels/rooms)
  drawCritters(t,'under');
  // trees flank the colony — roots dig into the dirt, canopies react to the weather above
  drawTree(W*0.065, gy, t, wx, false);
  drawTree(W*0.935, gy, t, wx, true);
  // crystals
  ctx.fillStyle='#7fe0ff'; ctx.strokeStyle='#3fa8d0'; ctx.lineWidth=1.5;
  [[W*0.1,gy-6],[W*0.9,gy-6]].forEach(([cx,cy])=>{
    for(let k=-1;k<=1;k++){ctx.beginPath();ctx.moveTo(cx+k*7,cy);ctx.lineTo(cx+k*7-3,cy-12);ctx.lineTo(cx+k*7+3,cy-12);ctx.closePath();ctx.fill();ctx.stroke();}
  });
  // curved tunnels
  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks']){
    strokePath(PATHS[key], 24, '#2b1a0f', 0.45);
  }
  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks']){
    strokePath(PATHS[key], 14, '#54331c', 0.5);
  }
  // chambers
  chamber(throne.x,throne.y,throne.w,throne.h,'Throne Room','👑');
  chamber(nursery.x,nursery.y,nursery.w,nursery.h,'Nursery '+nurseryEggs().length+'/'+nurseryCap(),'🍼');
  chamber(granary.x,granary.y,granary.w,granary.h,'Granary','🌾');
  chamber(barracks.x,barracks.y,barracks.w,barracks.h,S.research?'Training…':'Barracks','🗡️');
  // barracks: training dummy + progress
  const dx0=barracks.x+barracks.w-30, dy0=barracks.y+barracks.h-24;
  ctx.strokeStyle='#8a6a48'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.moveTo(dx0,dy0+12); ctx.lineTo(dx0,dy0-6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(dx0-8,dy0); ctx.lineTo(dx0+8,dy0); ctx.stroke();
  ctx.fillStyle='#c9a227'; ctx.beginPath(); ctx.arc(dx0,dy0-10,5,0,6.28); ctx.fill();
  if(S.research){
    const p=1-S.research.remain/S.research.total;
    ctx.fillStyle='#00000060'; roundRect(barracks.x+14, barracks.y+barracks.h-12, barracks.w-28, 6, 3); ctx.fill();
    ctx.fillStyle='#e05252'; roundRect(barracks.x+14, barracks.y+barracks.h-12, (barracks.w-28)*p, 6, 3); ctx.fill();
    if(Math.floor(t*2)%2===0){ ctx.font='11px sans-serif'; ctx.textAlign='center';
      ctx.fillText('⚔️', barracks.x+barracks.w/2, barracks.y+barracks.h/2+6); }
  }
  // expansion rooms flanking the barracks — built via the 🏗️ Build tab
  drawExpansionRoom(LAY.armory,'armory',S.rooms.armory,'🏮');
  drawExpansionRoom(LAY.towerRoom,'tower',S.rooms.tower,'🗼');
  // laser tower — a turret perched over a side tunnel, pulsing red, level shown underneath
  if(S.rooms.laser>0){
    const lent=(PATHS.surfaceC&&PATHS.surfaceC.length)?PATHS.surfaceC[PATHS.surfaceC.length-1]:{x:W*0.76,y:gy-6};
    const tx=lent.x, ty=gy-6;
    ctx.fillStyle='#3a2314';
    ctx.beginPath(); ctx.moveTo(tx-9,ty); ctx.lineTo(tx+9,ty); ctx.lineTo(tx+5,ty-17); ctx.lineTo(tx-5,ty-17); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#5a3820'; ctx.fillRect(tx-2,ty-24,4,8);
    const pulse=0.5+0.5*Math.sin(t*3.2);
    ctx.save(); ctx.globalAlpha=0.55+0.35*pulse; ctx.fillStyle='#ff3b3b';
    ctx.beginPath(); ctx.arc(tx,ty-26,3.5+pulse*1.5,0,6.28); ctx.fill();
    ctx.restore();
    ctx.fillStyle='#c0392b'; ctx.beginPath(); ctx.arc(tx,ty-26,2.4,0,6.28); ctx.fill();
    ctx.font='700 8px Trebuchet MS'; ctx.fillStyle='#ffd34e'; ctx.textAlign='center';
    ctx.fillText('Lv'+S.rooms.laser, tx, ty-34);
  }
  // trap spikes along the surface entrance — more traps, more spikes
  if(S.rooms.trap>0){
    const ent=PATHS.surface[PATHS.surface.length-1];
    ctx.fillStyle='#8a8a8a'; ctx.strokeStyle='#4a4a4a'; ctx.lineWidth=1;
    const n=Math.min(6,S.rooms.trap);
    for(let i=0;i<n;i++){
      const sx=ent.x-14+i*(28/Math.max(1,n-1||1));
      ctx.beginPath(); ctx.moveTo(sx-3,gy-2); ctx.lineTo(sx,gy-14); ctx.lineTo(sx+3,gy-2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }
  // nursery eggs
  const nE=nurseryEggs(); const sw=nursery.w;
  for(let i=0;i<Math.min(nE.length,8);i++){
    const e=nE[i];
    const ex=nursery.x+26+(i%4)*(sw-52)/3, ey=nursery.y+38+Math.floor(i/4)*32;
    ctx.fillStyle=e.type?'#ffe9c8':'#fff6e0'; ctx.strokeStyle='#e8d3a8'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.ellipse(ex,ey,7,9,0,0,6.28); ctx.fill(); ctx.stroke();
    if(e.type){
      const T=e.type==='princess'?PRINCESS.hatchT:UNITS[e.type].hatchT;
      const p=Math.min(1,e.prog/T);
      ctx.strokeStyle='#5bbd4a'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(ex,ey,12,-1.57,-1.57+6.28*p); ctx.stroke();
      ctx.font='9px sans-serif'; ctx.textAlign='center';
      ctx.fillText(e.type==='princess'?'👸':UNITS[e.type].emoji, ex, ey-14);
    }
  }
  // granary: a growing feast that mirrors the real stockpile
  {
    const fillF=Math.max(0,Math.min(1,S.food/foodCap()));
    const floorY=granary.y+granary.h-10;
    const cxG=granary.x+granary.w*0.44;
    if(fillF>0.02){
      // golden mound — grows with the actual food stored
      const mw=(granary.w-46)*(0.4+0.6*fillF);
      const mh=Math.max(6,(granary.h-46)*(0.2+0.8*fillF));
      const grd=ctx.createLinearGradient(0,floorY-mh*1.6,0,floorY);
      grd.addColorStop(0,'#f2c464'); grd.addColorStop(1,'#c98c2e');
      ctx.fillStyle=grd;
      ctx.beginPath(); ctx.moveTo(cxG-mw/2,floorY);
      ctx.quadraticCurveTo(cxG,floorY-mh*1.9,cxG+mw/2,floorY);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle='#a06a1e'; ctx.globalAlpha=0.35; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cxG-mw/2,floorY);
      ctx.quadraticCurveTo(cxG,floorY-mh*1.9,cxG+mw/2,floorY); ctx.stroke();
      ctx.globalAlpha=1;
      // tasty bits stacked on the mound — more food, bigger feast
      const items=['🌰','🍇','🍯','🫐','🌾','🍃'];
      const nItems=Math.max(1,Math.round(fillF*9));
      ctx.font='10px sans-serif'; ctx.textAlign='center';
      for(let i=0;i<nItems;i++){
        const row=Math.floor(i/4), colI=i%4;
        const ix=cxG+((colI-1.5)+(row%2)*0.5)*11*(1-row*0.22);
        const iy=floorY-5-row*9-mh*0.25;
        ctx.fillText(items[(i*3+row)%items.length], ix, iy);
      }
    } else {
      ctx.font='10px sans-serif'; ctx.textAlign='center'; ctx.fillStyle='#c9b596';
      ctx.fillText('🕸️ empty…', cxG, floorY-8);
    }
    // stored amount label (glows when full)
    ctx.font='700 9px Trebuchet MS'; ctx.textAlign='center';
    ctx.fillStyle=fillF>=0.98?'#ffd34e':'#c9b596';
    ctx.fillText('🍯 '+Math.floor(S.food)+'/'+foodCap()+(fillF>=0.98?' FULL!':''), granary.x+granary.w/2, granary.y+26);
    if(fillF>=0.98 && Math.floor(t*2)%2===0){
      ctx.font='12px sans-serif'; ctx.fillText('✨', cxG-granary.w*0.3, floorY-granary.h*0.45);
    }
    // crystal cache on the right — one shard per stash step
    const fillC=Math.max(0,Math.min(1,S.crystal/crysCap()));
    ctx.fillStyle='#7fe0ff'; ctx.strokeStyle='#3fa8d0'; ctx.lineWidth=1;
    for(let i=0;i<Math.round(fillC*5);i++){
      const cx0=granary.x+granary.w-20-i*8, h2=8+(i%3)*3;
      ctx.beginPath(); ctx.moveTo(cx0-3.5,floorY); ctx.lineTo(cx0,floorY-h2); ctx.lineTo(cx0+3.5,floorY); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }
  // surface critters on top of grass
  drawCritters(t,'over');
  drawRaiderApproach(t);
}

function drawQueen(cx,cy,t){
  const s=1.1; ctx.save(); ctx.translate(cx,cy);
  const ageF=Math.min(1, S.queen.age/QUEEN_LIFE);
  const old=ageF>0.72, mid=ageF>0.42&&!old;
  if(S.noQueen>0) ctx.globalAlpha=0.25;
  const laying=queenLayFx>0;
  const layP=laying?1-(queenLayFx/QUEEN_LAY_DUR):0;
  const squint=laying?Math.sin(Math.min(1,layP)*Math.PI):0; // 0→1→0 hump across the whole animation
  const br=Math.sin(t*(old?1.2:2))*(old?0.8:1.5) - squint*2.2;
  const bodyA=old?'#6e5a48':'#7b3f1e', bodyB=old?'#7d6a55':'#8f4d27';
  if(squint>0.02) ctx.scale(1+squint*0.08, 1-squint*0.07); // whole body visibly strains/squeezes
  ctx.fillStyle=bodyA; ctx.beginPath(); ctx.ellipse(0,10+br,34*s,24*s,0,0,6.28); ctx.fill();
  ctx.fillStyle=bodyB; ctx.beginPath(); ctx.ellipse(-6,4+br,26*s,18*s,0,0,6.28); ctx.fill();
  ctx.strokeStyle=old?'#57493b':'#5e2f16'; ctx.lineWidth=3;
  for(let i=-1;i<=2;i++){ctx.beginPath();ctx.ellipse(0,10+br,34*s-i*8,24*s-i*6,0,0.6,2.5);ctx.stroke();}
  ctx.fillStyle=old?'#5f5245':'#6b3517'; ctx.beginPath(); ctx.ellipse(-30*s,-4,12*s,10*s,0,0,6.28); ctx.fill();
  ctx.fillStyle=old?'#584a3d':'#5e2f14'; ctx.beginPath(); ctx.arc(-46*s,-8,11*s,0,6.28); ctx.fill();
  if(old){
    ctx.strokeStyle='#d8d0c4'; ctx.lineWidth=1.4;
    for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(-52*s+i*4,-18); ctx.quadraticCurveTo(-54*s+i*4,-24,-50*s+i*4,-26); ctx.stroke(); }
  }
  ctx.save(); if(old) ctx.rotate(-0.12);
  const cxk=-46*s, cyk=-20*s;
  ctx.fillStyle='#ffd34e'; ctx.strokeStyle='#e0a71f'; ctx.lineWidth=1.5; ctx.beginPath();
  ctx.moveTo(cxk-10,cyk+8);ctx.lineTo(cxk-10,cyk);ctx.lineTo(cxk-5,cyk+5);ctx.lineTo(cxk,cyk-4);
  ctx.lineTo(cxk+5,cyk+5);ctx.lineTo(cxk+10,cyk);ctx.lineTo(cxk+10,cyk+8);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#e05252'; ctx.beginPath(); ctx.arc(cxk,cyk-1,2.2,0,6.28); ctx.fill();
  ctx.restore();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-49*s,-9,2.6,0,6.28); ctx.fill();
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(-49.5*s,-9+(old?0.8:0),1.3,0,6.28); ctx.fill();
  if(mid||old){
    ctx.fillStyle=old?'#584a3d':'#5e2f14';
    ctx.fillRect(-49*s-3.2,-9-3.2, 6.4, old?3.6:2.2);
  }
  if(squint>0.1){
    // straining to lay — eyes squeeze fully shut
    ctx.save(); ctx.globalAlpha=Math.min(1,squint*1.6);
    ctx.fillStyle=bodyA; ctx.beginPath(); ctx.arc(-49*s,-9,4.2*s,0,6.28); ctx.fill();
    ctx.strokeStyle='#1a0f08'; ctx.lineWidth=2.2; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-53.5*s,-9); ctx.quadraticCurveTo(-49*s,-9+4*squint,-44.5*s,-9); ctx.stroke();
    // furrowed brow lines pressing down on the closed eye
    ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-53*s,-14-squint); ctx.lineTo(-45*s,-13-squint); ctx.stroke();
    ctx.restore();
  }
  if(old){
    ctx.strokeStyle='#463b30'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(-53*s,-14); ctx.lineTo(-49*s,-13.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-42*s,-3); ctx.quadraticCurveTo(-40*s,-1,-41*s,1); ctx.stroke();
  }
  ctx.strokeStyle=old?'#2e261e':'#3a1c0c'; ctx.lineWidth=1.4; ctx.beginPath();
  if(!mid&&!old){ ctx.arc(-46*s,-4,4,0.1,2.9); }
  else if(mid){ ctx.moveTo(-49*s,-2); ctx.lineTo(-43*s,-2); }
  else { ctx.arc(-46*s,1,4,3.5,5.9); }
  ctx.stroke();
  const droop=ageF*14;
  ctx.strokeStyle=old?'#463b30':'#3a1c0c'; ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(-50*s,-16);ctx.quadraticCurveTo(-60*s,-30+droop,-54*s,-34+droop*1.6);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-44*s,-17);ctx.quadraticCurveTo(-48*s,-32+droop,-40*s,-36+droop*1.6);ctx.stroke();
  ctx.strokeStyle=old?'#4c4136':'#4a2410'; ctx.lineWidth=2.5;
  for(let i=0;i<3;i++){const lx=-34*s+i*10;const w=Math.sin(t*(old?2:4)+i)*(old?1.5:3);
    ctx.beginPath();ctx.moveTo(lx,4);ctx.lineTo(lx-6,20+w);ctx.stroke();
    ctx.beginPath();ctx.moveTo(lx,4);ctx.lineTo(lx+6+w,22);ctx.stroke();}
  if(laying){
    // an egg visibly emerges from the rear of her body as she lays it
    const pushP=Math.min(1,layP/0.7);
    const eggScale=Math.min(1,pushP/0.6);
    if(eggScale>0.04){
      const eggX=26*s+pushP*10, eggY=12+br+Math.max(0,layP-0.72)*46;
      ctx.save();
      ctx.globalAlpha=Math.max(0,1-Math.max(0,layP-0.86)/0.14);
      ctx.fillStyle='#fff6e0'; ctx.strokeStyle='#e8d3a8'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.ellipse(eggX,eggY,6.5*eggScale,8.5*eggScale,0,0,6.28); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore(); ctx.globalAlpha=1;
}

function drawAnt(a,t){
  const u=UNITS[a.type];
  let s=(a.type==='guard'?1.15:a.type==='soldier'?1.05:a.type==='spitter'?0.92:a.type==='archer'?0.95:a.type==='bomber'?1.1:a.type==='wasp'?0.9:a.type==='monarch'?1.05:a.type==='siege'?1.12:a.type==='medic'?0.92:a.type==='zapper'?0.9:0.88);
  if(a.hatchIn>0) s*=Math.max(0.15,1-a.hatchIn/0.6);
  const woundPct=u.combat?(S.wounded[a.type]??100):100;
  const wounded=woundPct<99.5;
  const flyBob=u.flying?Math.sin(t*5+a.wob)*3:0;
  ctx.save(); ctx.translate(a.x,a.y+flyBob);
  if(wounded){ ctx.globalAlpha=0.55+0.45*(woundPct/100); }
  if(u.flying){
    ctx.save(); ctx.globalAlpha=0.18; ctx.fillStyle='#000';
    ctx.beginPath(); ctx.ellipse(0,-flyBob+6,6,2,0,0,6.28); ctx.fill(); ctx.restore();
  }
  const tx=a.route?a.route[Math.min(a.ridx,a.route.length-1)].x:(a.wx??a.x+1);
  const ty=a.route?a.route[Math.min(a.ridx,a.route.length-1)].y:(a.wy??a.y);
  ctx.rotate(Math.atan2(ty-a.y,tx-a.x));
  const wob=Math.sin(t*10+a.wob)*0.6;
  const col=u.color, col2=shade(u.color,18);
  if(a.type==='guard'&&(u.shield+shieldBonus())>0){
    const pulse=0.14+Math.sin(t*3+a.wob)*0.04;
    ctx.save(); ctx.rotate(t*1.2);
    ctx.fillStyle='rgba(120,200,255,'+pulse+')'; ctx.strokeStyle='rgba(180,230,255,0.65)'; ctx.lineWidth=1.2;
    ctx.beginPath();
    for(let i=0;i<6;i++){ const ang=i/6*6.28, r=13.5*s; const px=Math.cos(ang)*r, py=Math.sin(ang)*r*0.7;
      i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  if(a.type==='zapper'){
    // crackling static aura -- little sparks orbiting the Spark Ant
    ctx.save(); ctx.strokeStyle='#ffe985'; ctx.lineWidth=1;
    for(let i=0;i<3;i++){
      const ang=t*6+i*2.1+a.wob, r=9*s;
      const sx=Math.cos(ang)*r, sy=Math.sin(ang)*r*0.6+wob;
      ctx.globalAlpha=0.55+Math.sin(t*9+i)*0.35;
      ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(ang+1.4)*2.5,sy+Math.sin(ang+1.4)*2.5); ctx.stroke();
    }
    ctx.globalAlpha=1; ctx.restore();
  }
  if(a.type==='monarch'||a.type==='wasp'){
    // flapping wings -- Monarch gets showy stained-glass wings, the Wasp gets fast blurred strafer wings
    const flap=Math.sin(t*(a.type==='wasp'?26:14)+a.wob);
    const wingSpan=(a.type==='monarch'?11:8)*s, wingLift=Math.abs(flap)*0.5+0.5;
    ctx.save(); ctx.globalAlpha=(a.type==='wasp'?0.55:0.85)*wingLift;
    [-1,1].forEach(side=>{
      ctx.save(); ctx.translate(-2,wob-2); ctx.rotate(side*(0.5+flap*0.35));
      if(a.type==='monarch'){
        ctx.fillStyle=side>0?'#f5a623':'#c04fb0'; ctx.strokeStyle='#2b1a0f'; ctx.lineWidth=0.8;
        ctx.beginPath(); ctx.ellipse(side*wingSpan*0.55,-2,wingSpan,wingSpan*0.62,0,0,6.28); ctx.fill(); ctx.stroke();
        ctx.fillStyle='#2b1a0f';
        for(let d=0;d<3;d++){ ctx.beginPath(); ctx.arc(side*(wingSpan*0.3+d*3),-2+d*2-2,0.9,0,6.28); ctx.fill(); }
      } else {
        ctx.fillStyle='rgba(255,255,255,0.55)'; ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=0.6;
        ctx.beginPath(); ctx.ellipse(side*wingSpan*0.6,-3,wingSpan,wingSpan*0.4,0,0,6.28); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    });
    ctx.restore();
  }
  ctx.strokeStyle=col; ctx.lineWidth=1.6;
  for(let i=0;i<3;i++){const lx=-4+i*5;const w=Math.sin(t*14+i+a.wob)*2.2;
    ctx.beginPath();ctx.moveTo(lx,0);ctx.lineTo(lx-3,6+w);ctx.stroke();
    ctx.beginPath();ctx.moveTo(lx,0);ctx.lineTo(lx-3,-6-w);ctx.stroke();}
  ctx.fillStyle=col; ctx.beginPath(); ctx.ellipse(-9*s,wob,7*s,5*s,0,0,6.28); ctx.fill();
  ctx.fillStyle=col2; ctx.beginPath(); ctx.ellipse(-1,wob,4*s,3.4*s,0,0,6.28); ctx.fill();
  ctx.fillStyle=col; ctx.beginPath(); ctx.arc(6*s,wob,4*s,0,6.28); ctx.fill();
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(8*s,wob-1,1.3,0,6.28); ctx.fill();
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(8.4*s,wob-1,0.7,0,6.28); ctx.fill();
  ctx.strokeStyle=col; ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(9*s,wob-2);ctx.lineTo(13*s,wob-6);ctx.stroke();
  ctx.beginPath();ctx.moveTo(9*s,wob+2);ctx.lineTo(13*s,wob-3);ctx.stroke();
  if(a.type==='soldier'){
    ctx.strokeStyle='#eaeaea'; ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(9*s,wob-2);ctx.lineTo(15*s,wob-5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(9*s,wob+2);ctx.lineTo(15*s,wob+5);ctx.stroke();
    if(Math.sin(t*3+a.wob)>0.85){ ctx.strokeStyle='#fff'; ctx.lineWidth=0.9; ctx.globalAlpha=0.8;
      ctx.beginPath(); ctx.moveTo(12*s,wob-4); ctx.lineTo(14*s,wob-6); ctx.stroke(); ctx.globalAlpha=1; }
  } else if(a.type==='spitter'){
    ctx.fillStyle='#aef27a'; ctx.beginPath(); ctx.arc(13*s,wob,2.4,0,6.28); ctx.fill();
    // acid drips trailing off the jaw
    const dp=(t*1.6+a.wob)%1;
    ctx.fillStyle='rgba(174,242,122,'+(1-dp)*0.8+')';
    ctx.beginPath(); ctx.arc(13*s,wob+dp*7,1.3*(1-dp*0.4),0,6.28); ctx.fill();
  } else if(a.type==='guard'){
    ctx.fillStyle='#bcd8ff'; ctx.strokeStyle='#5f8fce'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(11*s,wob,2.5,4.5,0,0,6.28); ctx.fill(); ctx.stroke();
  } else if(a.type==='medic'){
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-2,wob-7,3,0,6.28); ctx.fill();
    ctx.strokeStyle='#e05252'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-3.6,wob-7); ctx.lineTo(-0.4,wob-7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2,wob-8.6); ctx.lineTo(-2,wob-5.4); ctx.stroke();
    // gentle pulsing aid-ring — this one's here to keep everyone patched up
    const hp=0.3+((Math.sin(t*2+a.wob)+1)/2)*0.4;
    ctx.strokeStyle='rgba(255,140,170,'+hp+')'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(-2,wob,10*s+Math.sin(t*2+a.wob)*1.5,0,6.28); ctx.stroke();
  } else if(a.type==='siege'){
    ctx.fillStyle='#9a8a6a'; ctx.strokeStyle='#6a5a3a'; ctx.lineWidth=1;
    ctx.save(); ctx.translate(-13*s,wob-6+Math.abs(Math.sin(t*6+a.wob))*-1.5);
    ctx.beginPath(); ctx.arc(0,0,5,0,6.28); ctx.fill(); ctx.stroke();
    ctx.strokeStyle='#4a3f2a'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.arc(-1.5,-1.5,1.6,0,6.28); ctx.stroke();
    ctx.restore();
  } else if(a.type==='zapper'){
    ctx.strokeStyle='#ffe27a'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-2,wob-9); ctx.lineTo(1,wob-6); ctx.lineTo(-1,wob-5); ctx.lineTo(2,wob-2); ctx.stroke();
  } else if(a.type==='archer'){
    // a little bow slung over the back, string thrumming
    ctx.strokeStyle='#c9932f'; ctx.lineWidth=1.3;
    ctx.beginPath(); ctx.arc(10*s,wob,5,-1.1,1.1); ctx.stroke();
    ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=0.7;
    ctx.beginPath(); ctx.moveTo(10*s+Math.cos(-1.1)*5,wob+Math.sin(-1.1)*5);
    ctx.lineTo(10*s+Math.cos(1.1)*5,wob+Math.sin(1.1)*5); ctx.stroke();
  } else if(a.type==='bomber'){
    // a fizzing bomb clutched underneath — Elite siege ant, huge payload
    const fuse=(Math.sin(t*10+a.wob)+1)/2;
    ctx.fillStyle='#2b1a2b'; ctx.beginPath(); ctx.arc(-3,wob+6,4.6,0,6.28); ctx.fill();
    ctx.strokeStyle='#7a3fb5'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(-3,wob+2); ctx.lineTo(-1,wob-1); ctx.stroke();
    ctx.fillStyle='rgba(255,210,120,'+(0.5+fuse*0.5)+')';
    ctx.beginPath(); ctx.arc(-1,wob-1,1.4+fuse,0,6.28); ctx.fill();
  } else if(a.type==='nurse'&&a.hasEgg){
    ctx.fillStyle='#fff6e0'; ctx.strokeStyle='#e8d3a8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(12*s,wob-2,3.5,4.5,0,0,6.28); ctx.fill(); ctx.stroke();
  } else if(a.type==='worker'&&a.carry){
    ctx.fillStyle='#7ccf4a'; ctx.beginPath(); ctx.arc(11*s,wob-3,3,0,6.28); ctx.fill();
  }
  if(wounded){
    ctx.globalAlpha=1;
    ctx.fillStyle='#ff5c5c'; ctx.beginPath(); ctx.arc(-2,wob-8,2.2,0,6.28); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(-3.2,wob-8); ctx.lineTo(-0.8,wob-8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2,wob-9.2); ctx.lineTo(-2,wob-6.8); ctx.stroke();
  }
  ctx.restore();
}
function shade(hex,amt){
  const n=parseInt(hex.slice(1),16); let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt;
  r=Math.min(255,r);g=Math.min(255,g);b=Math.min(255,b);
  return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0');
}

let eggFx=[];
let hatchFx=[];
let equipFx=[];
let healFx=[];
let animT=0;
const QUEEN_LAY_DUR=2.2;
let queenLayFx=0; // seconds remaining of the "laying an egg" animation
function spawnQueenLayAnim(){
  queenLayFx=QUEEN_LAY_DUR;
  if(LAY&&LAY.throne){ eggFx.push({x:LAY.throne.x+LAY.throne.w*0.62, y:LAY.throne.y+LAY.throne.h*0.5, life:1}); }
}
function render(dt){
  animT+=dt; ctx.clearRect(0,0,W,H);
  if(queenLayFx>0) queenLayFx=Math.max(0,queenLayFx-dt);
  updateCritters(dt,animT);
  drawGround(animT);
  updateAgents(dt,animT);
  agents.filter(a=>!UNITS[a.type].combat).forEach(a=>drawAnt(a,animT));
  drawQueen(LAY.throne.x+LAY.throne.w/2, LAY.throne.y+LAY.throne.h*0.45, animT);
  if(queenLayFx>0){
    // an unmistakable floating cue that she's straining to lay, independent of the tiny in-body eye detail
    const qcx=LAY.throne.x+LAY.throne.w/2, qcy=LAY.throne.y+LAY.throne.h*0.45;
    const layP=1-(queenLayFx/QUEEN_LAY_DUR);
    const hump=Math.sin(Math.min(1,layP)*Math.PI);
    ctx.save();
    ctx.globalAlpha=hump;
    ctx.font=(18+hump*6)+'px sans-serif'; ctx.textAlign='center';
    ctx.fillText('😣', qcx-38, qcy-56-hump*6);
    ctx.restore();
  }
  agents.filter(a=>UNITS[a.type].combat).forEach(a=>drawAnt(a,animT));
  eggFx.forEach(e=>{ctx.globalAlpha=Math.max(0,e.life);ctx.font='16px sans-serif';ctx.fillText('✨',e.x,e.y);ctx.globalAlpha=1;});
  hatchFx.forEach(e=>{
    const p=1-e.life/e.total, wob=Math.sin(p*20)*3*(1-p);
    ctx.save(); ctx.translate(e.x+wob,e.y); ctx.globalAlpha=Math.min(1,e.life*2);
    ctx.font=(12+p*10)+'px sans-serif'; ctx.textAlign='center';
    ctx.fillText(p<0.5?'🥚':e.emoji, 0, 0);
    if(p>=0.15&&p<0.85){ ctx.font='10px sans-serif'; ctx.fillText('✨', 8, -8); }
    ctx.globalAlpha=1; ctx.restore();
  });
  equipFx.forEach(e=>{
    const p=1-e.life/e.total;
    ctx.save(); ctx.globalAlpha=Math.max(0,e.life/e.total);
    ctx.translate(e.x,e.y-p*14);
    ctx.strokeStyle='#ffd34e'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(0,0,10+p*16,0,6.28); ctx.stroke();
    ctx.font='700 10px Trebuchet MS'; ctx.fillStyle='#ffd34e'; ctx.textAlign='center';
    ctx.fillText('⚡ Equipped!', 0, -18-p*6);
    ctx.globalAlpha=1; ctx.restore();
  });
  healFx=healFx.filter(e=>{
    e.life-=dt;
    const p=1-e.life/e.total;
    ctx.save(); ctx.globalAlpha=Math.max(0,e.life/e.total);
    ctx.font='13px sans-serif'; ctx.textAlign='center';
    ctx.fillText('💚', e.x, e.y-p*16);
    ctx.globalAlpha=1; ctx.restore();
    return e.life>0;
  });
}

/* ==========================================================================
   GAME LOOP
   ========================================================================== */
let running=false, saveIV=null;
function bootGame(){
  document.getElementById('intro').classList.add('hidden');
  resize(); syncAgents();
  running=true; S.lastTick=performance.now();
  requestAnimationFrame(loop);
  saveIV=setInterval(save, 5000);
  updateHUD(); updateDots(); updateWeatherHUD();
}
function loop(now){
  const rawDt=(now-S.lastTick)/1000; S.lastTick=now;
  const dt=Number.isFinite(rawDt)?Math.max(0,Math.min(0.05,rawDt)):0.016;
  try{ tick(dt); }catch(e){ console.error('tick() error (frame skipped, game continues):', e); }
  try{ render(dt); }catch(e){ console.error('render() error (frame skipped, game continues):', e); }
  if(B&&B.phase==='fight'){
    try{ battleRender(dt); }catch(e){ console.error('battleRender() error (frame skipped, game continues):', e); }
  }
  if(B&&B.phase==='prep'){
    try{
      B.prepT=Math.max(0,(B.prepT??10)-dt);
      const timerEl=document.getElementById('bpAutoTimer');
      if(timerEl){
        const secs=Math.ceil(B.prepT);
        timerEl.textContent = secs>0
          ? '⏱️ No orders — auto-battle in '+secs+'s'
          : '⏱️ Auto-battle!';
        timerEl.style.color = secs<=3 ? '#ff9d9d' : '#c9b596';
      }
      if(B.prepT<=0) beginBattle();
    }catch(e){ console.error('auto-battle timer error (frame skipped, game continues):', e); }
  }
  if(running) requestAnimationFrame(loop);
}
function battleBusy(){ return el('battlePage').classList.contains('show')||el('deploy').classList.contains('show')||el('welcome').classList.contains('show'); }

function nextWeather(){
  const bad=['rain','snow','windy'];
  if(S.weather==='sun') return bad[Math.floor(Math.random()*bad.length)];
  if(Math.random()<0.7) return 'sun';
  const others=bad.filter(w=>w!==S.weather);
  return others[Math.floor(Math.random()*others.length)];
}
let alarmCount=0;
function tick(dt){
  gainFood(foodRate()*dt);
  gainCrys(crystalRate()*dt);
  healArmy(dt);
  if(S.rooms.aphid>0) S.honeydew=Math.min(honeydewCap(), S.honeydew+honeydewRate()*dt);
  if(S.goldenT>0) S.goldenT=Math.max(0,S.goldenT-dt);
  S.elapsed+=dt;

  // weather cycle: sun / rain (half food) / snow (no food)
  S.wT-=dt;
  if(S.wT<=0){
    S.weather=nextWeather();
    S.wT=S.weather==='sun'?(60+Math.random()*60):S.weather==='windy'?(20+Math.random()*20):S.weather==='rain'?(30+Math.random()*30):(20+Math.random()*25);
    toast(S.weather==='rain'?'🌧️ Rain! Foragers bring home half as much food — and risk being washed away!'
        :S.weather==='snow'?'❄️ Snow! It is too cold to forage — foragers risk freezing to death!'
        :S.weather==='windy'?'💨 Windy! Gusts cut the harvest and may blow foragers away!'
        :'☀️ The sun is out — full harvest!');
    updateWeatherHUD();
  }

  // army training research
  if(S.research){
    S.research.remain-=dt;
    if(S.research.remain<=0){
      const k=S.research.k;
      S.up[k]++; S.stats.upgrades++; S.research=null;
      addXP(10); float('🗡️','#ffb0a0');
      toast('🗡️ Training complete! Your fighters head to the Barracks to equip their new skill.');
      if(LAY&&LAY.barracks){
        equipFx.push({x:LAY.barracks.x+LAY.barracks.w/2, y:LAY.barracks.y+LAY.barracks.h*0.4, life:1.8, total:1.8});
      }
      if(panelOpen==='evolve') renderPanel();
      updateDots();
    } else if(panelOpen==='evolve' && Math.random()<0.06){ renderPanel(); }
  }

  // queen life
  if(S.noQueen>0){
    S.noQueen-=dt;
    if(S.noQueen<=0){ S.queen.age=0; S.queen.hp=100; S.stats.queens++; toast('👑 An emergency queen has been crowned! The colony lives on.'); }
  } else {
    S.queen.age+=dt*QUEEN_AGE_MULT;
    S.queen.hp=Math.min(100, S.queen.hp+dt*0.2);
    if(S.queen.age>=QUEEN_LIFE || S.queen.hp<=0) queenDies();
    S.eggTimer+=dt;
    if(S.eggTimer>=eggInterval()){
      S.eggTimer=0;
      // the Queen only lays a fresh egg once the Nursery is completely empty —
      // she keeps pace with the colony instead of flooding the throne room
      if(nurseryEggs().length===0 && throneEggs().length<THRONE_CAP){
        S.eggQueue.push({id:++eggId, stage:'throne', type:null, prog:0});
        spawnQueenLayAnim();
      }
    }
  }

  tickEggs(dt);

  S.spawnTimer+=dt;
  if(S.spawnTimer>=SPAWN_EVERY){
    S.spawnTimer=0;
    if(targets.filter(t=>!t.boss).length<MAX_TARGETS){
      const nt=makeTarget(); targets.push(nt);
      toast('🚩 Scouts spot an unknown mound on the horizon…');
      if(panelOpen==='map') renderPanel();
    }
  }
  S.bossTimer+=dt;
  if(S.bossTimer>=S.nextBoss && !targets.some(t=>t.boss)){
    S.bossTimer=0; S.nextBoss=(900+Math.random()*600)*diff().freqMult;
    const b=makeBoss(); targets.push(b);
    toast('🚨 '+b.face+' A wild '+b.name+' appeared! Huge loot — but tough!');
    if(panelOpen==='map') renderPanel();
  }
  targets.forEach(t=>{ if(t.boss) t.expires-=dt; });
  targets.forEach(t=>{
    if(t.scoutT>0){
      t.scoutT-=dt;
      if(t.scoutT<=0){
        t.scouted=true; t.scoutT=0;
        toast('🔭 Scouts report back: '+t.name+' is T'+t.tier+(t.evolved?' — EVOLVED!':'!'));
        addXP(3);
        if(panelOpen==='map') renderPanel();
      }
    }
  });
  const gone=targets.filter(t=>t.boss&&t.expires<=0);
  if(gone.length){ targets=targets.filter(t=>!(t.boss&&t.expires<=0)); toast('The '+gone[0].name+' wandered off…'); if(panelOpen==='map') renderPanel(); }

  // ---- random events: little surprises that break the routine ----
  S.eventTimer+=dt;
  if(S.eventTimer>=S.nextEvent && !battleBusy() && !eventOpen){
    S.eventTimer=0; S.nextEvent=110+Math.random()*100;
    fireRandomEvent();
  }

  S.defTimer+=dt;
  if(S.defTimer>=S.nextDef && !battleBusy()){
    S.defTimer=0; S.nextDef=(300+Math.random()*240)*diff().freqMult;
    startAlarm();
  }
  if(alarmCount>0){
    alarmCount-=dt;
    updateRaiderApproach(dt);
    el('alarmT').textContent=Math.max(0,Math.ceil(alarmCount));
    if(alarmCount<=0){ el('alarm').classList.remove('show'); triggerDefense(); }
  }
  updateHUD();
}
let eventOpen=false;
function closeEvent(){ eventOpen=false; el('eventOv').classList.remove('show'); updateHUD(); save(); }
function showEvent(html){ eventOpen=true; el('ecard').innerHTML=html; el('eventOv').classList.add('show'); }
function fireRandomEvent(){
  const pool=['merchant','golden','minstrel'];
  if(S.rooms.aphid>0&&S.honeydew>=5) pool.push('ladybug','ladybug'); // meadows attract trouble
  const ev=pool[Math.floor(Math.random()*pool.length)];
  if(ev==='merchant'){
    // a traveling merchant offers a trade — sometimes great, sometimes meh
    const sellFood=Math.random()<0.5;
    const amtF=Math.floor(30+Math.random()*50), amtC=Math.max(2,Math.floor(amtF*(0.08+Math.random()*0.08)));
    showEvent(`<h2 style="margin:0 0 6px">🪲 Traveling Merchant</h2>
      <div class="sub" style="margin-bottom:10px">A beetle trader stops by your mound, wares glinting.</div>
      ${sellFood
        ?`<button class="btn" id="evYes">Trade 🍯${amtF} → 💎${amtC}</button>`
        :`<button class="btn" id="evYes">Trade 💎${amtC} → 🍯${amtF}</button>`}
      <button class="btn ghost" id="evNo" style="margin-top:6px">Send him away</button>`);
    el('evYes').onclick=()=>{
      if(sellFood){ if(S.food>=amtF){ S.food-=amtF; gainCrys(amtC); toast('🪲 Deal! +💎'+amtC);} else toast('Not enough honey!'); }
      else { if(S.crystal>=amtC){ S.crystal-=amtC; gainFood(amtF); toast('🪲 Deal! +🍯'+amtF);} else toast('Not enough crystal!'); }
      closeEvent();
    };
    el('evNo').onclick=closeEvent;
  } else if(ev==='golden'){
    showEvent(`<h2 style="margin:0 0 6px">✨ Golden Bloom</h2>
      <div class="sub" style="margin-bottom:10px">A rare flower bursts into bloom above — nectar everywhere! Double food for 45 seconds.</div>
      <button class="btn" id="evOk">🍯 Gather it all!</button>`);
    el('evOk').onclick=()=>{ S.goldenT=45; toast('✨ GOLDEN BLOOM — double harvest!'); closeEvent(); };
  } else if(ev==='minstrel'){
    showEvent(`<h2 style="margin:0 0 6px">🦗 Wandering Minstrel</h2>
      <div class="sub" style="margin-bottom:10px">A cricket bard plays for the colony. Spirits soar! (+10 XP, wounded heal a little)</div>
      <button class="btn" id="evOk">🎶 Lovely!</button>`);
    el('evOk').onclick=()=>{
      addXP(10);
      FIGHTERS.forEach(k=>{ if((S.wounded[k]??100)<100) S.wounded[k]=Math.min(100,S.wounded[k]+8); });
      toast('🎶 The colony hums with new energy!');
      closeEvent();
    };
  } else if(ev==='ladybug'){
    const guarded=S.rooms.tower>0||S.units.guard>2;
    const loss=guarded?Math.floor(S.honeydew*0.15):Math.floor(S.honeydew*0.45);
    showEvent(`<h2 style="margin:0 0 6px">🐞 Ladybug Raid!</h2>
      <div class="sub" style="margin-bottom:10px">Ladybugs swarm the Aphid Meadow after your honeydew!
      ${guarded?'Your defenses drive most of them off — only 🍮'+loss+' lost.':'With little defense, they gorge themselves — 🍮'+loss+' lost! (Guards or a Watchtower would help…)'}</div>
      <button class="btn" id="evOk">😤 Shoo them off</button>`);
    el('evOk').onclick=()=>{ S.honeydew=Math.max(0,S.honeydew-loss); closeEvent(); };
  }
}
function startAlarm(){
  alarmCount=10+towerWarnBonus();
  spawnRaiderApproach();
  el('alarm').classList.add('show');
  toast('⚠️ Raiders are coming for YOUR nest!'+(towerWarnBonus()>0?' (Watchtower spotted them early!)':''));
}
function updateWeatherHUD(){
  el('weatherIc').textContent=S.weather==='rain'?'🌧️':S.weather==='snow'?'❄️':S.weather==='windy'?'💨':'☀️';
  el('weatherLbl').textContent=S.weather==='rain'?'raining':S.weather==='snow'?'snowing':S.weather==='windy'?'windy':'sunny';
}

/* ==========================================================================
   HUD & PANELS
   ========================================================================== */
const el=id=>document.getElementById(id);
function updateHUD(){
  el('rFood').textContent=Math.floor(S.food);
  el('rFoodCap').textContent=foodCap();
  el('rFood').classList.toggle('maxed', Math.floor(S.food)>=foodCap());
  el('rCrys').textContent=Math.floor(S.crystal);
  el('rCrysCap').textContent=crysCap();
  el('rCrys').classList.toggle('maxed', Math.floor(S.crystal)>=crysCap());
  el('rEgg').textContent=S.eggQueue.length;
  el('rEgg').classList.toggle('maxed', nurseryFull());
  el('rPop').textContent=pop();
  el('rCap').textContent=popCap();
  el('rPop').classList.toggle('maxed', pop()>=popCap());
  el('rLvl').textContent=S.queen.lvl;
  el('dewRes').style.display=S.rooms.aphid>0?'flex':'none';
  el('rDew').textContent=Math.floor(S.honeydew);
  const xpPct=S.levelBoss?100:Math.max(0,Math.min(100,S.queen.xp/xpNeed(S.queen.lvl)*100));
  el('qxpBar').firstElementChild.style.width=xpPct+'%';
  el('qxpBar').classList.toggle('trialReady', !!S.levelBoss);
  el('qxpBar').title=S.levelBoss?'⭐ Trial ready — beat the Guardian to level up!':Math.floor(S.queen.xp)+' / '+xpNeed(S.queen.lvl)+' XP';
  el('qhpBar').firstElementChild.style.width=Math.max(0,S.queen.hp)+'%';
  el('qageBar').firstElementChild.style.width=Math.max(0,100-(S.queen.age/QUEEN_LIFE*100))+'%';
  const qs=el('qsucc');
  if(S.noQueen>0){ qs.textContent='mourning… '+Math.ceil(S.noQueen)+'s'; qs.className='warn'; }
  else if(S.princessReady){ qs.textContent='👸 heir ready'; qs.className='ready'; }
  else if(S.eggQueue.some(e=>e.type==='princess')){ qs.textContent='👸 heir growing'; qs.className=''; }
  else if(S.queen.age>QUEEN_LIFE*0.6){ qs.textContent='⚠️ raise a Princess!'; qs.className='warn'; }
  else { qs.textContent='no heir yet'; qs.className=''; }
}
function updateDots(){
  el('dot-queen').classList.toggle('on', missionClaimable()>0 || !!S.levelBoss);
  el('dot-nursery').classList.toggle('on', nurseryEggs().some(e=>!e.type));
  el('dot-evolve').classList.toggle('on', !!S.research);
  el('dot-build').classList.toggle('on', S.queen.lvl>=3 && S.rooms.armory<1 && S.queen.lvl>=6);
}

let panelOpen=null;
document.querySelectorAll('.tab').forEach(tb=>tb.addEventListener('click',()=>{
  const p=tb.dataset.p;
  if(panelOpen===p){closePanel();return;}
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  tb.classList.add('active'); openPanel(p);
}));
function closePanel(){panelOpen=null;el('panel').classList.remove('open');document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));}
function openPanel(p){panelOpen=p;renderPanel();el('panel').classList.add('open');}
function renderPanel(){
  let body='';
  if(panelOpen==='nursery') body=nurseryPanel();
  else if(panelOpen==='evolve') body=evolvePanel();
  else if(panelOpen==='build') body=buildPanel();
  else if(panelOpen==='map') body=mapPanel();
  else if(panelOpen==='queen') body=queenPanel();
  el('panel').innerHTML=`<div class="phead"><button class="pclose" onclick="closePanel()">✕</button></div><div class="pbody">${body}</div>`;
  bindPanel();
}

function assignBtn(eid,k){
  const u=UNITS[k], uc=unitCost(k);
  const locked=(u.minLvl||1)>S.queen.lvl;
  const needsArmory=(k==='archer'||k==='bomber')&&S.rooms.armory<1;
  const can=!locked&&!needsArmory&&S.food>=uc.food&&S.crystal>=uc.crystal&&pop()<popCap();
  if(locked) return `<button class="abtn" data-assign="${eid}:${k}" disabled>🔒 ${u.name}<br><span style="font-size:9px">Queen Lv${u.minLvl}</span></button>`;
  if(needsArmory) return `<button class="abtn" data-assign="${eid}:${k}" disabled>🔒 ${u.name}<br><span style="font-size:9px">Build Armory</span></button>`;
  return `<button class="abtn" data-assign="${eid}:${k}" ${can?'':'disabled'}>${u.emoji} ${u.name}<br><span style="font-size:9px">🍯${uc.food}${uc.crystal?' 💎'+uc.crystal:''}</span></button>`;
}
function nurseryPanel(){
  const th=throneEggs().length, tr=transitEggs().length, nE=nurseryEggs();
  const hasHeir=S.princessReady||S.eggQueue.some(e=>e.type==='princess');
  const pc=princessCost();
  const canP=!hasHeir&&S.food>=pc.food&&S.crystal>=pc.crystal;
  const unassigned=nE.filter(e=>!e.type), growing=nE.filter(e=>e.type);
  const uRows=unassigned.map(e=>`
    <div class="eggrow">
      <div class="top"><div class="eface">🥚</div>
        <div class="einfo">Fresh egg <span class="esub">— choose its destiny!</span></div></div>
      <div class="assignbtns">
        ${UORDER.map(k=>assignBtn(e.id,k)).join('')}
        <button class="abtn princess" data-assign="${e.id}:princess" ${canP?'':'disabled'}>👸 Princess<br><span style="font-size:9px">🍯${pc.food} 💎${pc.crystal}</span></button>
      </div>
    </div>`).join('');
  const gRows=growing.map(e=>{
    const T=e.type==='princess'?PRINCESS.hatchT:UNITS[e.type].hatchT;
    const p=Math.min(100,e.prog/T*100);
    const nm=e.type==='princess'?'👸 Princess':UNITS[e.type].emoji+' '+UNITS[e.type].name;
    return `<div class="eggrow">
      <div class="top"><div class="eface">${e.type==='princess'?'👸':UNITS[e.type].emoji}</div>
        <div class="einfo">${nm} <span class="esub">growing… ${Math.floor(p)}%</span></div></div>
      <div class="growbar"><i style="width:${p}%"></i></div>
    </div>`;
  }).join('');
  return `<h2>🍼 Nursery</h2>
  <div class="sub">👑 Throne eggs: <b>${th}</b> · 🍼 in transit: <b>${tr}</b> · slots ${nE.length}/${nurseryCap()} ${nurseryFull()?'<span style="color:#ffb0b0">(FULL — the Queen stops laying!)</span>':''} · Nurses ×${nurses()} · Max ants ${pop()}/${popCap()}</div>
  ${nurses()===0?'<div class="sub" style="color:#ffb0b0">⚠️ No Nurses! Eggs cannot reach the nursery without them. Assign a nursery egg as a Nurse ASAP!</div>':''}
  ${unassigned.length?'<div class="secttl">🥚 Assign new eggs</div>'+uRows:''}
  ${growing.length?'<div class="secttl">🐣 Growing</div>'+gRows:''}
  ${!nE.length?'<div class="sub">No eggs in the nursery yet. The Queen lays eggs in the Throne Room — Nurses carry them here along the tunnel.</div>':''}
  ${woundedRows()}
  <div class="secttl">Your ants</div>
  ${UORDER.map(k=>`<div class="card"><div class="emoji">${UNITS[k].emoji}</div>
    <div class="body"><div class="title">${UNITS[k].name} ×${S.units[k]}</div>
    <div class="desc">${UNITS[k].blurb}</div></div></div>`).join('')}`;
}

// wounded fighters recover under nurse care — shown in the Nursery since that's who does the healing
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
}
/* ---- LEGACY: permanent dynasty perks bought with Legacy points from great victories ---- */
const LEGACY_PERKS={
  fertility: {emoji:'🥚', name:'Ancestral Fertility', max:5, desc:l=>'Queens lay eggs '+(l*8)+'% faster. Forever.'},
  harvest:   {emoji:'🌾', name:'Ancient Granaries',   max:5, desc:l=>'All harvesting +'+(l*10)+'%. Forever.'},
  valor:     {emoji:'⚔️', name:'Bloodline Valor',     max:5, desc:l=>'All fighters +'+l+' damage. Forever.'},
  resilience:{emoji:'💚', name:'Healing Tradition',   max:5, desc:l=>'Nurses heal '+(l*15)+'% faster. Forever.'},
};
function legacyPerkCost(k){ return 3+legacyLvl(k)*3; }
/* ---- VETERANS: named survivors who make their whole cohort fight harder ---- */
const VET_NAMES=['Mandible','Thorax','Pincer','Dot','Scurry','Chitin','Antenna','Skitter','Bristle','Vigor','Redleg','Sixfoot'];
const VET_TITLES=['the Unbroken','of the Third Raid','Ironjaw','the Swift','Nest-Warden','the Scarred','Tunnel-Hero'];
function vetBonus(k){ return (S.veterans||[]).filter(v=>v.type===k).length*0.04; } // +4% dps per veteran of that type
function maybePromoteVeteran(sel,dead){
  if((S.veterans||[]).length>=5) return;
  if(Math.random()>0.45) return;
  const surviving=FIGHTERS.filter(k=>(sel[k]||0)>((dead&&dead[k])||0));
  if(!surviving.length) return;
  const k=surviving[Math.floor(Math.random()*surviving.length)];
  const name=VET_NAMES[Math.floor(Math.random()*VET_NAMES.length)]+' '+VET_TITLES[Math.floor(Math.random()*VET_TITLES.length)];
  S.veterans.push({name, type:k, battles:1});
  toast('🎖️ '+UNITS[k].emoji+' '+name+' distinguished themselves in battle! (+4% '+UNITS[k].name+' damage)');
  float('🎖️','#ffd34e');
}
function veteranAttrition(dead,sel){
  // bloody battles can claim even heroes
  (S.veterans||[]).slice().forEach(v=>{
    const sent=sel[v.type]||0, lost=(dead&&dead[v.type])||0;
    if(sent>0 && lost/Math.max(1,sent)>0.3 && Math.random()<0.35){
      S.veterans=S.veterans.filter(x=>x!==v);
      toast('🕯️ '+UNITS[v.type].emoji+' '+v.name+' fell in battle. The colony mourns.');
    } else if(sent>0 && lost<sent){
      v.battles++;
    }
  });
}
function awardLegacy(n,why){
  S.legacy.pts+=n;
  toast('🏛️ +'+n+' Legacy — '+why+' (spend it in the Queen tab)');
  float('🏛️+'+n,'#e8c66a');
}
const BOONS=[
  {k:'heal',  emoji:'💚', name:'Royal Salve',     cost:15, desc:'Instantly heal every wounded fighter to full.'},
  {k:'egg',   emoji:'🥚', name:'Royal Surge',     cost:10, desc:'The Queen immediately lays an egg (if there is room).'},
  {k:'golden',emoji:'✨', name:'Golden Harvest',  cost:20, desc:'Double food gathering for 60 seconds.'},
];
const UPG = {
  army:[
    {k:'attack',  emoji:'🗡️', title:'Acid Attack', base:30, cbase:2, minLvl:1, desc:()=>'+2 damage to all fighters. Now +'+dmgBonus()+' bonus dmg.'},
    {k:'skill',   emoji:'🎯', title:'Precision', base:34, cbase:2, minLvl:1, desc:()=>'+5% critical-hit chance AND +15% critical damage. Now '+Math.round(critChance()*100)+'% chance for '+critDmgMult().toFixed(1)+'x damage.'},
    {k:'carapace',emoji:'🛡️', title:'Carapace', base:32, cbase:2, minLvl:1, desc:()=>'+1 armor to all fighters. Now +'+armorBonus()+'.'},
    {k:'shield',  emoji:'🔵', title:'Bio-Shield', base:38, cbase:4, minLvl:1, desc:()=>'+10 shield to every fighter. Now +'+shieldBonus()+'.'},
    {k:'dodge',   emoji:'🌀', title:'Evasive Reflexes', base:40, cbase:3, minLvl:4, desc:()=>'Fighters may dodge an incoming attack entirely. Now '+Math.round(dodgeChance()*100)+'% dodge chance.'},
    {k:'venom',   emoji:'🧪', title:'Venom Coating', base:120, cbase:35, minLvl:8, desc:()=>'Expensive bio-tech: +3 dmg to all fighters. Now +'+dmgBonus()+' bonus dmg.'},
    {k:'frenzy',  emoji:'🔥', title:'Battle Frenzy', base:220, cbase:70, minLvl:14, desc:()=>'Elite conditioning: all fighters hit harder in prolonged fights. Now +'+Math.round(frenzyBonus()*100)+'% dmg.'},
  ],
  worker:[
    {k:'harvest', emoji:'🍃', title:'Rich Harvest', base:26, cbase:0, desc:()=>'Workers gather more. Food +'+foodRate().toFixed(1)+'/s.'},
    {k:'speed',   emoji:'⚡', title:'Swift Legs', base:24, cbase:0, desc:()=>'Workers run faster. Food +'+foodRate().toFixed(1)+'/s.'},
    {k:'carry',   emoji:'🎒', title:'Big Mandibles', base:28, cbase:1, desc:()=>'Bigger loads. 💎+'+crystalRate().toFixed(2)+'/s.'},
  ],
  colony:[
    {k:'capacity',  emoji:'👑', title:'Royal Growth', base:30, cbase:2, desc:()=>'The Queen commands more ants! Max ants '+popCap()+' → '+(popCap()+8)+'.'},
    {k:'fertility', emoji:'🥚', title:'Royal Fertility', base:22, cbase:0, desc:()=>'Queen lays eggs every '+eggInterval().toFixed(1)+'s.'},
    {k:'nursery',   emoji:'🍼', title:'Cozy Nursery', base:26, cbase:1, desc:()=>'Nursery slots '+nurseryCap()+' → '+(nurseryCap()+2)+'.'},
    {k:'granary',   emoji:'🌾', title:'Grand Granary', base:24, cbase:1, desc:()=>'Storage 🍯'+foodCap()+'→'+foodCapAt(S.up.granary+1)+' 💎'+crysCap()+'→'+crysCapAt(S.up.granary+1)+'.'},
  ],
};
function armyRow(u){
  const locked=(u.minLvl||1)>S.queen.lvl;
  const lvl=S.up[u.k], fc=cost(u.base,lvl), cc=u.cbase?cost(u.cbase,lvl):0;
  const tt=trainTime(u.k);
  const inProg=S.research&&S.research.k===u.k;
  const busy=!!S.research;
  const can=!locked&&!busy&&S.food>=fc&&S.crystal>=cc;
  const prog=inProg?Math.floor((1-S.research.remain/S.research.total)*100):0;
  return `<div class="card">
    <div class="emoji">${locked?'🔒':u.emoji}</div>
    <div class="body"><div class="title">${u.title}</div><div class="desc">${locked?'Requires Queen level '+u.minLvl+'.':u.desc()}</div>
      <div class="lvl">Level ${lvl}${inProg?' · training '+prog+'% ('+fmtDur(S.research.remain)+' left)':''}</div>
      ${inProg?'<div class="trainbar"><i style="width:'+prog+'%"></i></div>':''}
    </div>
    <div class="price">
      <button class="btn red" data-train="${u.k}" ${can?'':'disabled'}>${locked?'🔒 Lv'+u.minLvl:inProg?'⏳':'🗡️ Train'}</button>
      <div class="cost"><b>🍯${fc}</b>${cc?' · <span class="c">💎'+cc+'</span>':''} · ⏱️${fmtDur(tt)}</div>
    </div>
  </div>`;
}
function upgRow(u){
  const lvl=S.up[u.k], fc=cost(u.base,lvl), cc=u.cbase?cost(u.cbase,lvl):0;
  const can=S.food>=fc&&S.crystal>=cc;
  return `<div class="card">
    <div class="emoji">${u.emoji}</div>
    <div class="body"><div class="title">${u.title}</div><div class="desc">${u.desc()}</div><div class="lvl">Level ${lvl}</div></div>
    <div class="price"><button class="btn" data-up="${u.k}" ${can?'':'disabled'}>Evolve</button>
    <div class="cost"><b>🍯${fc}</b>${cc?' · <span class="c">💎'+cc+'</span>':''}</div></div>
  </div>`;
}
function evolvePanel(){
  const note=S.research?'<div class="sub" style="color:#ffd7a8">🗡️ Fighters are training in the Barracks — one course at a time!</div>':'' ;
  return `<h2>🧬 Evolution Chamber</h2>
  <div class="sub">Army skills are trained in the Barracks and take time — each level takes longer than the last, and training continues while you're away. Worker & colony evolutions are instant.</div>
  ${note}
  <div class="secttl">⚔️ Army Training (Barracks)</div>${UPG.army.map(armyRow).join('')}
  <div class="secttl">🍃 Worker Skills</div>${UPG.worker.map(upgRow).join('')}
  <div class="secttl">🏰 Colony & Rooms</div>${UPG.colony.map(upgRow).join('')}`;
}

function roomRow(k){
  const r=ROOMS[k], lvl=S.rooms[k];
  const locked=S.queen.lvl<r.unlockLvl;
  const c=roomCost(k);
  const can=!locked&&S.food>=c.food&&S.crystal>=c.crystal;
  const built=lvl>=1;
  const extra=k==='armory'?'+'+Math.round(S.rooms.armory*8)+'% dmg for Archers & Bombers'
    :k==='trap'?'-'+Math.round(trapDefBonus()*100)+'% raider strength on arrival'
    :k==='tower'?'+'+Math.round(towerWarnBonus())+'s early warning before a raid'
    :k==='aphid'?'+'+honeydewRate().toFixed(2)+' 🍮/s honeydew'
    :k==='laser'?'-'+laserDefDmg()+' raider HP burned off before the fight'
    :'';
  return `<div class="card">
    <div class="emoji">${locked?'🔒':r.emoji}</div>
    <div class="body"><div class="title">${r.name} ${built?'· Lv'+lvl:'(not built)'}</div>
      <div class="desc">${locked?'Unlocks at Queen level '+r.unlockLvl+'.':r.desc}</div>
      ${built?'<div class="lvl">'+extra+'</div>':''}
    </div>
    <div class="price"><button class="btn" data-room="${k}" ${can?'':'disabled'}>${locked?'🔒 Lv'+r.unlockLvl:built?'🔨 Upgrade':'🏗️ Build'}</button>
    <div class="cost"><b>🍯${c.food}</b>${c.crystal?' · <span class="c">💎'+c.crystal+'</span>':''}</div></div>
  </div>`;
}
function buildPanel(){
  return `<h2>🏗️ Colony Expansion</h2>
  <div class="sub">Dig new chambers off the Barracks and Throne tunnels. Each room can be upgraded further once built — bigger colonies need more than just a Nursery and Granary.</div>
  <div class="secttl">New Rooms</div>
  ${Object.keys(ROOMS).map(roomRow).join('')}`;
}
function estimate(t,stats){
  const me=stats.dps*(stats.hp+stats.shield+1), en=t.dps*(t.hp+t.shield+1);
  return me/(me+en);
}
function mapPanel(){
  const whole=armyStatsOf(S.units);
  const rows=targets.map(t=>{
    if(!t.boss && !t.scouted){
      // fog of war: an unknown mound on the horizon — send a scout to learn what lives there
      return `<div class="target"><div class="row">
        <div class="mound" style="filter:grayscale(1) brightness(0.6)">❓</div>
        <div class="info">
          <div class="nm">Unknown Colony</div>
          <div class="stat" style="color:#9a8a72">${t.scoutT>0?'🔭 Scouting… '+Math.ceil(t.scoutT)+'s':'Unexplored — strength and loot unknown.'}</div>
        </div>
        ${t.scoutT>0?'':'<button class="btn" data-scout="'+t.id+'">🔭 Scout</button>'}
      </div></div>`;
    }
    const p=estimate(t,whole);
    const cls=p>0.62?'good':p>0.42?'even':'bad';
    const label=p>0.62?'Favored':p>0.42?'Even':'Risky';
    const bossTag=t.boss?` <span style="color:#ff8080;font-weight:800">BOSS · ${Math.ceil(t.expires)}s!</span>`:(t.evolved?` <span style="color:#c99bf0;font-weight:800">🧬 EVOLVED</span>`:'');
    return `<div class="target ${t.boss?'boss':''}"><div class="row">
      <div class="mound">${t.face}</div>
      <div class="info">
        <div class="nm">${t.name} <span style="color:#c9b596;font-weight:600;font-size:11px">T${t.tier}</span>${bossTag}</div>
        ${t.boss&&t.mechDesc?`<div class="stat" style="color:#ffb0a0">${t.mechDesc}</div>`:''}
        <div class="stat">❤️${Math.round(t.hp)} ${t.shield?'🔵'+Math.round(t.shield)+' ':''}· 🗡️${t.dps.toFixed(0)} · 🛡️${t.armor}</div>
        <div class="stat">Loot 🍯${t.food}${t.crystal?' 💎'+t.crystal:''} · <span class="odds ${cls}">All-in ${label} ~${Math.round(p*100)}%</span></div>
      </div>
      <button class="btn red" data-raid="${t.id}" ${whole.n<1?'disabled':''}>⚔️ Raid</button>
    </div></div>`;
  }).join('');
  const note=whole.n<1?'<div class="sub" style="color:#ffb0b0">⚠️ You have no fighters. Assign eggs as Soldiers/Spitters/Guards in the Nursery.</div>':'';
  return `<h2>🗺️ Raid Rivals</h2>
  <div class="sub">Fighters — ${FIGHTERS.filter(k=>S.units[k]>0).map(k=>UNITS[k].emoji+S.units[k]).join(' ')||'none yet'}. Pick a target, choose your war-party, set your formation, then give the order to attack!</div>
  ${note}${targets.length?rows:'<div class="sub">No rivals right now — one will appear soon.</div>'}`;
}

function queenPanel(){
  const need=xpNeed(S.queen.lvl), pct=Math.min(100,S.queen.xp/need*100);
  const agePct=Math.max(0,100-(S.queen.age/QUEEN_LIFE*100));
  const missions=MISSIONS.map(m=>{
    const done=m.c(), claimed=S.missionsClaimed.includes(m.id);
    const r=[m.r.food?'🍯'+m.r.food:'',m.r.crystal?'💎'+m.r.crystal:'',m.r.xp?'⭐'+m.r.xp+'xp':''].filter(Boolean).join(' ');
    return `<div class="card ${claimed?'done':''}">
      <div class="emoji">${claimed?'✅':done?'🎁':'📜'}</div>
      <div class="body"><div class="title">${m.t}</div><div class="lvl">Reward: ${r}</div></div>
      ${claimed?'<span style="color:#7fc97f;font-weight:800;font-size:11px">Done!</span>'
        :done?`<button class="btn" data-claim="${m.id}">Claim!</button>`
        :'<span style="color:#9a8a72;font-weight:700;font-size:11px">…</span>'}
    </div>`;
  }).join('');
  const pcQ=princessCost();
  const heirState=S.princessReady?'👸 <b>Heir ready!</b> When this Queen passes, the Princess takes the throne (+1 Royal Jelly).'
    :S.eggQueue.some(e=>e.type==='princess')?'👸 A Princess is growing in the Nursery…'
    :'No heir yet. Assign a nursery egg as 👸 Princess (🍯'+pcQ.food+' 💎'+pcQ.crystal+') before the Queen grows old!';
  const days=Math.max(1, Math.floor((Date.now()-(S.founded||Date.now()))/86400000)+1);
  const lb=S.levelBoss;
  const trialCard=lb?`<div class="target boss" style="margin-bottom:12px">
    <div class="row">
      <div class="mound">${lb.face}</div>
      <div class="info">
        <div class="nm">${lb.name} <span style="color:#c9b596;font-weight:600;font-size:11px">Lv${lb.forLvl} Trial</span></div>
        <div class="stat">❤️${Math.round(lb.hp)} ${lb.shield?'🔵'+Math.round(lb.shield)+' ':''}· 🗡️${lb.dps.toFixed(0)} · 🛡️${lb.armor}</div>
        <div class="stat" style="color:#ffd7a8">⚠️ Win to reach level ${lb.forLvl}. Lose and 25% of your army falls.</div>
      </div>
      <button class="btn red" data-levelboss="1" ${FIGHTERS.reduce((a,k)=>a+S.units[k],0)<1?'disabled':''}>⚔️ Challenge</button>
    </div>
  </div>`:'';
  return `<h2>👑 The Queen — Reign #${S.stats.queens}</h2>
  <div class="sub">📅 Day ${days} of your dynasty. Every action earns XP, but leveling up must be earned in battle!</div>
  ${trialCard}
  <div class="xpwrap">
    <div class="xplbl"><span>👑 Level ${S.queen.lvl}</span><span>${lb?'⭐ Trial ready!':Math.floor(S.queen.xp)+' / '+need+' XP'}</span></div>
    <div class="xpbar"><i style="width:${pct}%; ${lb?'background:linear-gradient(#ffe27a,#ffd34e)':''}"></i></div>
    <div class="xplbl" style="margin-top:8px"><span>❤️ Health</span><span>${Math.floor(S.queen.hp)}/100</span></div>
    <div class="xpbar"><i style="width:${S.queen.hp}%; background:linear-gradient(#ff9d9d,#e05252)"></i></div>
    <div class="xplbl" style="margin-top:8px"><span>⏳ Life remaining</span><span>${fmtDur(QUEEN_LIFE-S.queen.age)}</span></div>
    <div class="xpbar"><i style="width:${agePct}%; background:linear-gradient(#ffe27a,#f5a623)"></i></div>
    ${S.jelly>0?`<div class="lvl" style="margin-top:6px;color:var(--jelly)">🍮 Royal Jelly ×${S.jelly} — +${S.jelly*5}% gathering, +${Math.floor(S.jelly*0.5)} dmg</div>`:''}
  </div>
  <div class="card"><div class="emoji">👸</div>
    <div class="body"><div class="title">Succession</div><div class="desc">${heirState}</div></div></div>
  ${(S.veterans&&S.veterans.length)?`<div class="secttl">🎖️ Veterans (${S.veterans.length}/5)</div>
  ${S.veterans.map(v=>`<div class="card"><div class="emoji">${UNITS[v.type].emoji}</div>
    <div class="body"><div class="title">🎖️ ${v.name}</div>
    <div class="desc">${UNITS[v.type].name} · ${v.battles} battle${v.battles>1?'s':''} survived · +4% ${UNITS[v.type].name} damage</div></div>
  </div>`).join('')}`:''}
  <div class="secttl">🏛️ Legacy — ${S.legacy.pts} pts <span style="font-weight:600;color:#9a8a72;font-size:10px">(permanent, survives every Queen)</span></div>
  ${Object.keys(LEGACY_PERKS).map(k=>{
    const P=LEGACY_PERKS[k], l=legacyLvl(k), c=legacyPerkCost(k), maxed=l>=P.max;
    return `<div class="card"><div class="emoji">${P.emoji}</div>
      <div class="body"><div class="title">${P.name} ${l>0?'Lv'+l:''}</div><div class="desc">${P.desc(Math.max(1,l))}</div></div>
      ${maxed?'<span style="color:#7fc97f;font-weight:800;font-size:11px">MAX</span>'
        :`<button class="btn" data-legacy="${k}" ${S.legacy.pts>=c?'':'disabled'}>🏛️${c}</button>`}
    </div>`;
  }).join('')}
  ${S.rooms.aphid>0?`<div class="secttl">🍮 Honeydew Boons — ${Math.floor(S.honeydew)}/${honeydewCap()}</div>
  ${BOONS.map(b=>`<div class="card"><div class="emoji">${b.emoji}</div>
    <div class="body"><div class="title">${b.name}</div><div class="desc">${b.desc}</div></div>
    <button class="btn" data-boon="${b.k}" ${S.honeydew>=b.cost?'':'disabled'}>🍮${b.cost}</button>
  </div>`).join('')}`:''}
  <div class="secttl">📜 Missions</div>
  ${missions}`;
}

function bindPanel(){
  const P=el('panel');
  P.querySelectorAll('[data-assign]').forEach(b=>b.onclick=()=>{
    const [eid,k]=b.dataset.assign.split(':');
    assignEgg(parseInt(eid), k);
  });
  P.querySelectorAll('[data-train]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.train;
    const def=UPG.army.find(u=>u.k===k);
    if((def.minLvl||1)>S.queen.lvl){ toast('🔒 Needs Queen level '+def.minLvl+'.'); return; }
    if(S.research) { toast('The Barracks is busy — one training at a time!'); return; }
    const fc=cost(def.base,S.up[k]), cc=def.cbase?cost(def.cbase,S.up[k]):0;
    if(S.food>=fc&&S.crystal>=cc){
      S.food-=fc; S.crystal-=cc;
      const tt=trainTime(k);
      S.research={k, total:tt, remain:tt};
      toast('🗡️ '+def.title+' training started! ('+fmtDur(tt)+') Fighters head to the Barracks.');
      renderPanel(); updateHUD(); updateDots(); save();
    }
  });
  P.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.up;
    const def=[...UPG.worker,...UPG.colony].find(u=>u.k===k);
    if(!def) return;
    const fc=cost(def.base,S.up[k]), cc=def.cbase?cost(def.cbase,S.up[k]):0;
    if(S.food>=fc&&S.crystal>=cc){ S.food-=fc; S.crystal-=cc; S.up[k]++;
      S.stats.upgrades++; addXP(10);
      float('🧬','#a0f0a0'); syncAgents(); renderPanel(); updateHUD(); updateDots(); }
  });
  P.querySelectorAll('[data-raid]').forEach(b=>b.onclick=()=>openDeploy(parseInt(b.dataset.raid)));
  P.querySelectorAll('[data-scout]').forEach(b=>b.onclick=()=>{
    const t=targets.find(x=>x.id===parseInt(b.dataset.scout));
    if(!t||t.scouted||t.scoutT>0) return;
    const hasFlyer=S.units.wasp>0||S.units.monarch>0;
    t.scoutT=hasFlyer?4:8;
    toast(hasFlyer?'🔭 A flyer zips off to scout — fast!':'🔭 A worker sneaks out to scout the unknown colony…');
    renderPanel();
  });
  P.querySelectorAll('[data-levelboss]').forEach(b=>b.onclick=()=>openLevelBossDeploy());
  P.querySelectorAll('[data-claim]').forEach(b=>b.onclick=()=>claimMission(b.dataset.claim));
  P.querySelectorAll('[data-legacy]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.legacy, c=legacyPerkCost(k);
    if(S.legacy.pts>=c && legacyLvl(k)<LEGACY_PERKS[k].max){
      S.legacy.pts-=c; S.legacy.perks[k]++;
      toast('🏛️ '+LEGACY_PERKS[k].name+' strengthened — this bonus is permanent!');
      float('🏛️','#e8c66a'); renderPanel(); updateHUD(); save();
    }
  });
  P.querySelectorAll('[data-boon]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.boon, def=BOONS.find(x=>x.k===k);
    if(S.honeydew<def.cost) return;
    if(k==='heal'){
      S.honeydew-=def.cost;
      FIGHTERS.forEach(f=>S.wounded[f]=100);
      toast('💚 Royal Salve! Every fighter is healed to full.');
    } else if(k==='egg'){
      if(nurseryFull()||throneEggs().length>=THRONE_CAP){ toast('🥚 No room for another egg right now!'); return; }
      S.honeydew-=def.cost;
      S.eggQueue.push({id:++eggId, type:null, prog:0, stage:'throne', carrierId:null});
      spawnQueenLayAnim();
      toast('🥚 Royal Surge — the Queen lays at once!');
    } else if(k==='golden'){
      S.honeydew-=def.cost;
      S.goldenT=60;
      toast('✨ GOLDEN HARVEST! Double food for 60 seconds!');
    }
    renderPanel(); updateHUD(); save();
  });
  P.querySelectorAll('[data-room]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.room, r=ROOMS[k];
    if(S.queen.lvl<r.unlockLvl){ toast('🔒 Needs Queen level '+r.unlockLvl+'.'); return; }
    const c=roomCost(k);
    if(S.food>=c.food&&S.crystal>=c.crystal){
      S.food-=c.food; S.crystal-=c.crystal;
      const wasBuilt=S.rooms[k]>=1;
      S.rooms[k]++;
      addXP(15);
      toast((wasBuilt?'🔨 '+r.name+' upgraded to Lv'+S.rooms[k]+'!':'🏗️ '+r.name+' built!'));
      float(r.emoji,'#a0f0a0');
      renderPanel(); updateHUD(); updateDots(); save();
    }
  });
}

/* ==========================================================================
   DEPLOY
   ========================================================================== */
let deployTarget=null, deploySel=null;
function openDeploy(id){
  const t=targets.find(x=>x.id===id); if(!t) return;
  if(FIGHTERS.reduce((a,k)=>a+S.units[k],0)<1){ toast('No fighters! Assign eggs in the Nursery first.'); return; }
  deployTarget=t;
  deploySel={}; FIGHTERS.forEach(k=>deploySel[k]=S.units[k]);
  renderDeploy();
  el('deploy').classList.add('show');
}
function openLevelBossDeploy(){
  if(!S.levelBoss) return;
  if(FIGHTERS.reduce((a,k)=>a+S.units[k],0)<1){ toast('No fighters! Assign eggs in the Nursery first.'); return; }
  deployTarget=S.levelBoss;
  deploySel={}; FIGHTERS.forEach(k=>deploySel[k]=S.units[k]);
  renderDeploy();
  el('deploy').classList.add('show');
}
function renderDeploy(){
  const t=deployTarget, sel=deploySel;
  const stats=armyStatsOf(sel);
  const p=estimate(t,stats);
  const cls=p>0.62?'good':p>0.42?'even':'bad';
  const label=stats.n<1?'—':(p>0.62?'Favored':p>0.42?'Even':'Risky')+' ~'+Math.round(p*100)+'%';
  const rows=FIGHTERS.map(k=>{
    const u=UNITS[k], avail=S.units[k], c=sel[k];
    return `<div class="deprow">
      <div class="face">${u.emoji}</div>
      <div class="di"><div class="n">${u.name} <span style="color:#9a8a72;font-weight:600">(have ${avail})</span></div>
        <div class="s">${u.medic?'💚 heals allies':'🗡️'+(u.dmg+dmgBonus())} · ❤️${u.hp} · 🛡️${u.armor+armorBonus()}${(u.shield+shieldBonus())?' · 🔵'+(u.shield+shieldBonus()):''}</div></div>
      <div class="stepper">
        <button data-dec="${k}">−</button><span class="cnt">${c}/${avail}</span><button data-inc="${k}">+</button>
      </div>
    </div>`;
  }).join('');
  const lootLine=t.levelChallenge?'Reward: 👑 Level '+t.forLvl+' · Lose and 25% of your army falls':
    'Loot 🍯'+t.food+(t.crystal?' 💎'+t.crystal:'');
  el('dcard').innerHTML=`
    <h2>${t.levelChallenge?'⭐ Trial for Level '+t.forLvl:'⚔️ Raid '+t.name}${t.boss?' 🚨':''}</h2>
    <div class="depsum">${t.levelChallenge?t.name+' — ':''}Enemy: ❤️${Math.round(t.hp)} ${t.shield?'🔵'+Math.round(t.shield)+' ':''}🗡️${t.dps.toFixed(0)} 🛡️${t.armor} · ${lootLine}</div>
    ${rows}
    <div class="depsum">War-party: <b>${stats.n}</b> ants · 🗡️${stats.dps.toFixed(0)} · ❤️${Math.round(stats.hp)} · 🔵${Math.round(stats.shield)} · <span class="odds ${cls}">${label}</span></div>
    <div class="choices">
      <button class="btn red" id="marchBtn" ${stats.n<1?'disabled':''}>⚔️ March!</button>
      <button class="btn ghost" id="cancelDeploy">Cancel</button>
    </div>`;
  el('dcard').querySelectorAll('[data-inc]').forEach(b=>b.onclick=()=>{const k=b.dataset.inc; if(deploySel[k]<S.units[k]){deploySel[k]++; renderDeploy();}});
  el('dcard').querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>{const k=b.dataset.dec; if(deploySel[k]>0){deploySel[k]--; renderDeploy();}});
  el('marchBtn').onclick=()=>{
    el('deploy').classList.remove('show');
    if(t.levelChallenge) startLevelBossBattle(t,{...deploySel});
    else startRaidBattle(deployTarget, {...deploySel});
  };
  el('cancelDeploy').onclick=()=>{ el('deploy').classList.remove('show'); };
}

/* ==========================================================================
   BATTLE ENGINE — full page with tactical commands + side status
   ========================================================================== */
let B=null;
const TACTICS={
  balanced:{dmg:1, take:1, armor:0},
  charge:  {dmg:1.5, take:1.25, armor:0},
  wall:    {dmg:0.65, take:1, armor:9},
  cry:     {dmg:1.2, take:1.1, armor:0, crit:true},
};
/* Formations — chosen BEFORE the battle begins, active for the whole fight */
const FORMS={
  line:  {name:'⚖️ Battle Line', sub:'balanced, no tricks',            dmg:1,    armor:0,  shield:1,   crit:0},
  wedge: {name:'🔺 Wedge',       sub:'+20% dmg · −2 armor',            dmg:1.2,  armor:-2, shield:1,   crit:0},
  turtle:{name:'🛡️ Turtle',      sub:'+4 armor · +30% shield · −15% dmg', dmg:0.85, armor:4,  shield:1.3, crit:0},
  ambush:{name:'🎯 Ambush',      sub:'+10% dmg · +15% crit',           dmg:1.1,  armor:0,  shield:1,   crit:0.15},
};
function formationPreview(){
  const sel=B.sel||{};
  const icons=[];
  FIGHTERS.forEach(k=>{
    for(let i=0;i<Math.min(sel[k]||0,6);i++) icons.push(UNITS[k].emoji);
  });
  if(!icons.length) icons.push('🐜');
  let lines;
  if(B.form==='wedge'){ lines=[icons.slice(0,1),icons.slice(1,3),icons.slice(3,8),icons.slice(8,14)]; }
  else if(B.form==='turtle'){
    const front=icons.filter(e=>e==='🛡️'||e==='⚔️'), back=icons.filter(e=>e==='🟢');
    lines=[front.slice(0,7), back.slice(0,7)];
  }
  else if(B.form==='ambush'){ lines=[icons.filter((_,i)=>i%2===0).slice(0,7), icons.filter((_,i)=>i%2===1).slice(0,7)]; }
  else { lines=[icons.slice(0,7), icons.slice(7,14)]; }
  return lines.filter(l=>l.length).map(l=>'<div>'+l.join('')+'</div>').join('');
}
function setBars(){
  const pc=(cur,max)=>max>0?Math.max(0,Math.min(100,cur/max*100)):0;
  el('bpMeHp').firstElementChild.style.width=pc(B.me.hp,B.me.maxHp)+'%';
  el('bpMeSh').firstElementChild.style.width=pc(B.me.shield,B.me.maxShield)+'%';
  el('bpMeSh').style.display=B.me.maxShield>0?'block':'none';
  el('bpEnHp').firstElementChild.style.width=pc(B.en.hp,B.en.maxHp)+'%';
  el('bpEnSh').firstElementChild.style.width=pc(B.en.shield,B.en.maxShield)+'%';
  el('bpEnSh').style.display=B.en.maxShield>0?'block':'none';
  el('bpMeNum').textContent='❤️'+Math.max(0,Math.round(B.me.hp))+(B.me.maxShield>0?' 🔵'+Math.max(0,Math.round(B.me.shield)):'');
  el('bpEnNum').textContent='❤️'+Math.max(0,Math.round(B.en.hp))+(B.en.maxShield>0?' 🔵'+Math.max(0,Math.round(B.en.shield)):'');
}
function bpLog(msg,cls){
  const L=el('bpLog');
  const d=document.createElement('div'); if(cls)d.className=cls; d.textContent=msg;
  L.prepend(d);
  while(L.children.length>9) L.removeChild(L.lastChild);
}
function renderCmds(){
  const C=el('bpCmds');
  if(B.over){ C.innerHTML=''; return; }
  const defs=[
    {k:'charge', cls:'charge', name:'⚡ Charge!', sub:'+50% dmg, take +25%'},
    {k:'wall',   cls:'wall',   name:'🛡️ Shield Wall', sub:'-35% dmg, +9 armor'},
    {k:'cry',    cls:'cry',    name:'📣 War Cry', sub:'+20% dmg & crits'},
    {k:'retreat',cls:'retreat',name:'🏳️ Retreat', sub:'flee, fewer losses'},
  ];
  C.innerHTML=defs.map(d=>`<button class="cmd ${d.cls} ${B.tactic===d.k?'active':''}" data-cmd="${d.k}">${d.name}<small>${d.sub}</small></button>`).join('');
  C.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>{
    const k=b.dataset.cmd;
    if(k==='retreat'){ doRetreat(); return; }
    B.tactic=k; B.tacticTicks=3;
    bpLog('👑 Command: '+(k==='charge'?'CHARGE!':k==='wall'?'SHIELD WALL!':'WAR CRY!'),'good');
    renderCmds();
  });
}
function startBattlePage(cfg){
  const rows={}; FIGHTERS.forEach(k=>{ rows[k]=defaultRow(k); });
  B={...cfg, tactic:'balanced', tacticTicks:0, over:false, tickN:0, phase:'prep', form:'line', meUnits:[], enUnits:[], rows, prepMax:10, prepT:10};
  battleDmgFx=[];
  el('bpScene').classList.remove('fighting');
  el('bpTitle').textContent=cfg.title;
  el('bpSubtitle').textContent=cfg.subtitle||'';
  el('bpMeLbl').textContent=cfg.meLabel;
  el('bpEnLbl').textContent=cfg.enemy.name;
  el('bpEn').textContent=cfg.enemy.face;
  el('bpLog').innerHTML='';
  bpLog(cfg.intro);
  bpLog('👑 Form your ranks, Commander — the battle waits for your order.');
  setBars(); renderPrep();
  el('battlePage').classList.add('show');
  resizeBattleCv();
  // NOTE: no ticking here — the battle only starts when the player presses Begin
}
// ---- battlefield: individual unit sprites (StarCraft-style squads) that walk in, target,
//      attack independently on their own cooldowns, and can actually die mid-fight ----
function setupBattleUnits(){
  B.meUnits=[]; B.enUnits=[];
  const sel=B.sel||{};
  const home=!!B.home;
  FIGHTERS.forEach(k=>{
    const sent=sel[k]||0; if(!sent) return;
    const visualCount=Math.min(sent,8);
    const groupSize=sent/visualCount;
    const u=UNITS[k];
    const gb=(home&&k==='guard')?1.5:1;
    const eliteB=(S.rooms.armory>0&&(k==='archer'||k==='bomber'))?(1+S.rooms.armory*0.08):1;
    const wf=woundFrac(k);
    const maxHp=u.hp*gb*groupSize*wf;
    const maxShield=(u.shield+shieldBonus())*gb*groupSize;
    const baseDmg=(u.dmg+dmgBonus())*(1+frenzyBonus()+vetBonus(k))*eliteB;
    const armor=u.armor+armorBonus();
    const flying=!!u.flying;
    const ranged=(k==='spitter'||k==='archer'||k==='siege'||k==='zapper');
    const speed=k==='guard'?95:k==='soldier'?80:k==='bomber'?60:k==='siege'?42:flying?120:70;
    const range=u.medic?55:ranged?(k==='siege'?250:175):30;
    const row=(B.rows&&B.rows[k])||defaultRow(k);
    for(let i=0;i<visualCount;i++){
      B.meUnits.push({
        type:k, side:'me', groupSize, hp:maxHp, maxHp, shield:maxShield, maxShield,
        dmg:baseDmg*0.5*groupSize, heal:u.medic?3.5*groupSize:0, medic:!!u.medic,
        splash:!!u.splash||k==='monarch', chain:!!u.chain, suicide:!!u.suicide,
        armor, ranged, flying, speed, range, row, alive:true, targetIdx:-1,
        atkCd:Math.random()*0.9, atkSpd:(ranged?0.9:1.05)+Math.random()*0.15,
        x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0
      });
    }
  });
  if(!B.meUnits.length){
    B.meUnits.push({type:'soldier',side:'me',groupSize:1,hp:1,maxHp:1,shield:0,maxShield:0,
      dmg:0,armor:0,ranged:false,flying:false,speed:70,range:30,row:'front',alive:true,targetIdx:-1,atkCd:1,atkSpd:1,
      x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  const enemyDef=B.enemy||{tier:1,face:'🪲',hp:20,dps:2,armor:0,shield:0};
  const bossMech=enemyDef.boss?enemyDef.mech:null;
  const tier=enemyDef.tier||1;
  const formed=enemyFormed(tier);
  const formBonus=formed?1+Math.min(0.45,(tier-4)*0.035):1; // organized ranks hit harder & tank more
  const n=Math.max(2,Math.min(10,Math.round(tier/2)+2));
  const enMaxHp=((enemyDef.hp||20)/n)*formBonus, enShield=(enemyDef.shield||0)/n, enDmg=((enemyDef.dps||2)/n)*0.5*formBonus;
  const enArmor=(enemyDef.armor||0)+(formed?Math.round(tier*0.25):0);
  // evolved/boss raiders bring more air power — enemies get squadrons of flyers too
  const airChance=(enemyDef.evolved||enemyDef.boss)?0.5:0.18;
  for(let i=0;i<n;i++){
    const isBossUnit=bossMech&&i===0; // the boss itself towers over its minions
    const flying=!isBossUnit&&Math.random()<airChance;
    const ranged=isBossUnit?false:(!flying&&Math.random()<0.4);
    const face=isBossUnit?enemyDef.face:(flying?AIR_ENEMY_FACES[Math.floor(Math.random()*AIR_ENEMY_FACES.length)]:enemyDef.face);
    const hpMul=isBossUnit?2.6:1, dmgMul=isBossUnit?1.8:1;
    B.enUnits.push({
      type:'enemy', side:'en', face, groupSize:1, hp:enMaxHp*hpMul, maxHp:enMaxHp*hpMul,
      shield:enShield*(isBossUnit?2:1), maxShield:enShield*(isBossUnit?2:1), dmg:enDmg*dmgMul, armor:enArmor, ranged,
      flying, speed:isBossUnit?40:(flying?115:68), range:ranged?165:30,
      row:isBossUnit?'front':(ranged?'back':'front'), isBoss:isBossUnit, alive:true, targetIdx:-1, atkCd:Math.random()*0.9, atkSpd:0.85+Math.random()*0.3,
      x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0
    });
  }
  if(bossMech){
    B.bossMech=bossMech;
    B.mechTimer=0;
    bpLog('⚠️ '+(enemyDef.mechDesc||'This boss fights differently…'),'hit');
  }
  // ---- battle support structures, unlocked at higher Queen level, echo the colony's Trap/Tower rooms ----
  if(S.rooms.trap>0){
    B.meUnits.push({type:'trap',side:'me',face:'🵸',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(6+S.rooms.trap*3)*0.5,armor:99,ranged:true,flying:false,row:'front',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.6,atkSpd:0.55,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  if(S.rooms.tower>0){
    B.meUnits.push({type:'tower',side:'me',face:'🗼',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(8+S.rooms.tower*3.5)*0.5,armor:99,ranged:true,flying:false,row:'back',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.3,atkSpd:0.7,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  if(S.rooms.laser>0){
    B.meUnits.push({type:'laser',side:'me',face:'📡',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(10+S.rooms.laser*4)*0.5,armor:99,ranged:true,flying:false,row:'back',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.2,atkSpd:0.85,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  if(tier>=10){
    B.enUnits.push({type:'entrap',side:'en',face:'🕸️',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(5+tier*0.7)*0.5,armor:99,ranged:true,flying:false,row:'front',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.6,atkSpd:0.55,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  if(tier>=13){
    B.enUnits.push({type:'entower',side:'en',face:'🏯',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(7+tier*0.8)*0.5,armor:99,ranged:true,flying:false,row:'back',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.3,atkSpd:0.7,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  if(tier>=16){
    B.enUnits.push({type:'enlaser',side:'en',face:'🔴',groupSize:1,hp:9999,maxHp:9999,shield:0,maxShield:0,
      dmg:(9+tier*0.9)*0.5,armor:99,ranged:true,flying:false,row:'back',structure:true,speed:0,range:2000,alive:true,targetIdx:-1,
      atkCd:0.2,atkSpd:0.85,x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }
  layoutBattleUnits();
  B.elapsed=0; B.logAcc=0;
  const noStruct=arr=>arr.filter(u=>!u.structure);
  B.me.maxHp=noStruct(B.meUnits).reduce((s,u)=>s+u.maxHp,0); B.me.maxShield=noStruct(B.meUnits).reduce((s,u)=>s+u.maxShield,0);
  B.en.maxHp=noStruct(B.enUnits).reduce((s,u)=>s+u.maxHp,0); B.en.maxShield=noStruct(B.enUnits).reduce((s,u)=>s+u.maxShield,0);
}
function layoutBattleUnits(){
  if(!bcv||!B) return;
  const w=bcv.width, h=bcv.height;
  const layoutSide=(arr,sideLeft)=>{
    if(!arr.length) return;
    const zoneW=w*0.36, startX=sideLeft? w*0.06 : w*0.94-zoneW;
    const startY=h*0.20, maxRows4=(h*0.6);
    ['front','back'].forEach(rowKind=>{
      const grp=arr.filter(u=>(u.row||'front')===rowKind);
      if(!grp.length) return;
      const cols=Math.min(5,Math.ceil(Math.sqrt(grp.length)));
      const nrows=Math.ceil(grp.length/cols);
      const stepY=Math.min(40,maxRows4/Math.max(1,nrows));
      // front row deploys nearer the no-man's-land (closer to the enemy); back row hangs behind it
      const laneW=zoneW*0.46;
      const laneX=sideLeft? (rowKind==='front'? startX+zoneW-laneW : startX)
                           : (rowKind==='front'? startX : startX+zoneW-laneW);
      grp.forEach((u,i)=>{
        const col=i%cols, r=Math.floor(i/cols);
        u.tx=laneX+(col+0.5)*(laneW/cols);
        u.ty=startY+r*stepY-(u.flying?18:0);
        if(u.x===undefined){ u.x=sideLeft?-30:w+30; u.y=u.ty; }
      });
    });
  };
  layoutSide(B.meUnits,true);
  layoutSide(B.enUnits,false);
}
let battleDmgFx=[];
let battleProjectiles=[];
function spawnDmgFx(x,y,val,crit){ battleDmgFx.push({x,y,val,crit:!!crit,life:0.8}); }
function spawnMissFx(x,y){ battleDmgFx.push({x,y,val:'MISS',miss:true,life:0.8}); }
let meleeFx=[];
let slashFx=[], stingFx=[], zapFx=[], laserFx=[], spikeFx=[], acidSplatFx=[], ringFx=[], healBeamFx=[];
function clearBattleFx(){ slashFx=[]; stingFx=[]; zapFx=[]; laserFx=[]; spikeFx=[]; acidSplatFx=[]; ringFx=[]; healBeamFx=[]; }
let battleShakeT=0, killFx=[];
function spawnMeleeFx(x,y){ meleeFx.push({x,y,life:0.22}); }
function spawnKillFx(x,y,side){
  battleShakeT=Math.min(0.35,battleShakeT+0.22);
  killFx.push({x,y,life:0.7,total:0.7,side});
}
function spawnProjectile(u,target){
  const kind = (u.type==='archer'||u.type==='tower'||u.type==='entower') ? 'arrow'
    : u.type==='spitter' ? 'spit'
    : u.type==='siege' ? 'rock'
    : 'bolt';
  const dirX=Math.sign(target.x-u.x)||1;
  const mx=u.x+dirX*10, my=u.y-4;
  if(kind==='spit') acidSplatFx.push({x:mx,y:my,life:0.18,total:0.18,small:true}); // acid bursts from the mouth
  battleProjectiles.push({x0:mx,y0:my,x:mx,y:my,tx:target.x,ty:target.y,t:0,
    dur:kind==='arrow'?0.16:kind==='rock'?0.45:0.26,
    arcH:kind==='spit'?22:kind==='rock'?52:0,
    color:u.side==='me'?'#aef27a':'#ffb0a0', kind});
}
// ---- real-time per-unit combat: every squad has its own cooldown, target & fate ----
function combatStep(dt){
  if(!B||B.phase!=='fight'||B.over) return;
  B.elapsed+=dt;
  const T=TACTICS[B.tactic]||TACTICS.balanced;
  const F=FORMS[B.form]||FORMS.line;
  if(B.tacticTicks>0){
    B.tacticTicks=Math.max(0,B.tacticTicks-dt);
    if(B.tacticTicks<=0&&B.tactic!=='balanced'){ B.tactic='balanced'; bpLog('Formation resets to balanced.'); renderCmds(); }
  }
  // ---- boss signature mechanics ----
  if(B.bossMech){
    B.mechTimer=(B.mechTimer||0)+dt;
    const bossU=B.enUnits.find(u=>u.isBoss&&u.alive);
    if(bossU){
      if(B.bossMech==='rage'){
        // damage ramps ~+8%/sec — long fights become deadly
        bossU.dmg*= (1+0.08*dt);
        if(Math.floor(B.elapsed)%10===0&&B.elapsed>1&&!B._rageWarned){ B._rageWarned=true; bpLog('🔥 The boss grows angrier!','hit'); }
        if(Math.floor(B.elapsed)%10!==0) B._rageWarned=false;
      } else if(B.bossMech==='shielded'){
        // shield regrows while minions still stand
        const minionsAlive=B.enUnits.some(u=>u.alive&&!u.isBoss);
        if(minionsAlive){ bossU.shield=Math.min(bossU.maxShield, bossU.shield+bossU.maxShield*0.06*dt); }
      } else if(B.bossMech==='stun'){
        if(B.mechTimer>=8){
          B.mechTimer=0;
          B.meUnits.filter(u=>u.alive&&(u.row||'front')==='front'&&!u.structure).forEach(u=>{ u.stunT=1.6; });
          bpLog('🕸️ Your front line is webbed — stunned!','hit');
        }
      } else if(B.bossMech==='summon'){
        if(B.mechTimer>=10&&B.enUnits.filter(u=>u.alive).length<12){
          B.mechTimer=0;
          const b=B.enUnits.find(u=>u.isBoss);
          B.enUnits.push({type:'enemy',side:'en',face:'🐛',groupSize:1,hp:b.maxHp*0.25,maxHp:b.maxHp*0.25,
            shield:0,maxShield:0,dmg:b.dmg*0.3,armor:0,ranged:false,flying:false,speed:75,range:30,row:'front',alive:true,targetIdx:-1,
            atkCd:0.5,atkSpd:1,x:bcv?bcv.width+20:400,y:bossU.y,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
          layoutBattleUnits();
          bpLog('🐣 The boss births a broodling!','hit');
        }
      }
    }
  }
  const moveToward=(u,x,y,spd)=>{
    const dx=x-u.x, dy=y-u.y, d=Math.hypot(dx,dy);
    if(d<2||!spd) return;
    const st=Math.min(d,spd*dt);
    u.x+=dx/d*st; u.y+=dy/d*st; u.movingT=0.15;
  };
  const dealDamage=(target,dealt,critMult)=>{
    if(target.shield>0){ target.shield-=dealt; if(target.shield<0){ target.hp+=target.shield; target.shield=0; } }
    else target.hp-=dealt;
    target.flashT=0.25;
    if(critMult>1) target.critFx=0.4;
    spawnDmgFx(target.x,target.y-14,Math.round(dealt),critMult>1);
    if(target.hp<=0&&target.alive){ target.alive=false; target.deathT=0.5; spawnKillFx(target.x,target.y,target.side); }
  };
  const stepSide=(arr,oppArr,isMe)=>{
    const dir=isMe?1:-1;
    arr.forEach(u=>{
      if(!u.alive) return;
      if(u.stunT>0){ u.stunT-=dt; return; } // webbed — can't act
      u.atkCd-=dt;
      // ---- Medics never attack: they run to the most-wounded ally and patch it up ----
      if(u.medic){
        const hurt=arr.filter(o=>o.alive&&!o.structure&&o!==u&&o.hp<o.maxHp*0.995);
        if(!hurt.length){ moveToward(u,u.tx,u.ty,u.speed); return; }
        const pat=hurt.reduce((a,b)=>(a.hp/a.maxHp<b.hp/b.maxHp?a:b));
        if(Math.hypot(pat.x-u.x,pat.y-u.y)>u.range){ moveToward(u,pat.x-dir*20,pat.y,u.speed); return; }
        if(u.atkCd>0) return;
        pat.hp=Math.min(pat.maxHp,pat.hp+u.heal);
        healBeamFx.push({x0:u.x,y0:u.y,x1:pat.x,y1:pat.y,life:0.35,total:0.35});
        battleDmgFx.push({x:pat.x,y:pat.y-16,val:'+'+Math.max(1,Math.round(u.heal)),heal:true,life:0.8});
        u.atkT=0.3;
        u.atkCd=1/u.atkSpd;
        return;
      }
      // ---- StarCraft-style targeting: go for the NEAREST living enemy ----
      let opps=oppArr.filter(o=>o.alive&&!o.structure);
      if(!opps.length) opps=oppArr.filter(o=>o.alive);
      if(!opps.length) return;
      let target=oppArr[u.targetIdx];
      if(!target||!target.alive||(target.structure&&opps.some(o=>!o.structure))){
        let best=null,bd=1e9;
        opps.forEach(o=>{ const d=Math.hypot(o.x-u.x,o.y-u.y); if(d<bd){bd=d;best=o;} });
        target=best; u.targetIdx=oppArr.indexOf(best);
      }
      const dist=Math.hypot(target.x-u.x,target.y-u.y);
      // ---- movement: melee marches in to swing, flyers swoop & pull back, ranged holds its distance ----
      if(!u.structure){
        if(u.flying){
          if(u.atkCd>0.5) moveToward(u,u.tx,u.ty,u.speed);              // buzz back up after a sting
          else moveToward(u,target.x-dir*14,target.y-4,u.speed*1.25);    // dive at the target!
        } else if(dist>u.range){
          moveToward(u,target.x-dir*20,target.y,u.speed);
        }
      }
      if(dist>u.range+10) return;  // not close enough to strike yet
      if(u.atkCd>0) return;
      // fighters trained in Evasive Reflexes can dodge an incoming attack outright
      if(target.side==='me' && dodgeChance()>0 && Math.random()<dodgeChance()){
        spawnMissFx(target.x,target.y-14);
        if(u.ranged||u.structure) spawnProjectile(u,target); else u.atkT=0.3;
        u.atkCd=1/u.atkSpd+(Math.random()*0.2-0.1);
        return;
      }
      let mult=1, armorAdd=0, critMult=1;
      if(isMe){
        mult=T.dmg*F.dmg;
        const critP=critChance()+(T.crit?0.35:0)+(F.crit||0);
        if(critP>0&&Math.random()<critP){ critMult=critDmgMult(); bpLog('🎯 Critical hit! ('+critMult.toFixed(1)+'x)','good'); }
      } else {
        mult=T.take||1; armorAdd=(T.armor||0)+(F.armor||0);
      }
      const defArmor=target.armor+(isMe?0:armorAdd);
      let dealt=u.dmg*mult*critMult*(1-defArmor/(defArmor+15));
      dealt=Math.max(1,dealt);
      dealDamage(target,dealt,critMult);
      // ---- attack visuals & specials per type ----
      if(u.structure){
        if(u.type==='laser'||u.type==='enlaser'){
          laserFx.push({x0:u.x,y0:u.y-12,x1:target.x,y1:target.y,life:0.18,total:0.18,color:u.side==='me'?'#ff4040':'#ff7070'});
        } else if(u.type==='tower'||u.type==='entower'){
          spawnProjectile(u,target);
        } else { // trap snaps shut under the enemy
          spikeFx.push({x:target.x,y:target.y+10,life:0.4,total:0.4});
        }
      } else if(u.ranged){
        if(u.chain){
          // ⚡ chain lightning leaps to up to 2 extra enemies near the first
          const extra=opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<90).slice(0,2);
          const pts=[{x:u.x,y:u.y-6},{x:target.x,y:target.y}];
          extra.forEach(o=>{ dealDamage(o,Math.max(1,dealt*0.5),1); pts.push({x:o.x,y:o.y}); });
          zapFx.push({pts,life:0.28,total:0.28});
        } else {
          spawnProjectile(u,target);
          if(u.splash){
            // 🪨 boulder splash — enemies packed near the target take half damage too
            opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<46)
                .forEach(o=>dealDamage(o,Math.max(1,dealt*0.5),1));
          }
        }
      } else {
        u.atkT=0.3;
        if(u.flying){
          stingFx.push({x:target.x,y:target.y-4,life:0.28,total:0.28});
          if(u.splash){ // monarch dive-bomb splashes the pack
            opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<40)
                .forEach(o=>dealDamage(o,Math.max(1,dealt*0.5),1));
            ringFx.push({x:target.x,y:target.y,life:0.4,total:0.4});
          }
        } else if(u.suicide){
          // 💣 kamikaze detonation — huge blast to everything nearby the target
          opps.filter(o=>o!==target&&o.alive&&Math.hypot(o.x-target.x,o.y-target.y)<55)
              .forEach(o=>dealDamage(o,Math.max(1,dealt*0.6),1));
          ringFx.push({x:target.x,y:target.y,life:0.5,total:0.5});
          ringFx.push({x:u.x,y:u.y,life:0.4,total:0.4});
        } else {
          slashFx.push({x:target.x,y:target.y,ang:Math.atan2(target.y-u.y,target.x-u.x),life:0.24,total:0.24});
          spawnMeleeFx(target.x,target.y);
        }
      }
      if(u.suicide&&u.alive){
        // the Bomber never survives its own explosion
        u.hp=0; u.alive=false; u.deathT=0.5; u.flashT=0.25;
        spawnKillFx(u.x,u.y,u.side);
        bpLog('💥 A Bomber detonates in a blast of shrapnel!',u.side==='me'?'good':'hit');
      }
      u.atkCd=1/u.atkSpd+(Math.random()*0.2-0.1);
    });
  };
  stepSide(B.meUnits,B.enUnits,true);
  stepSide(B.enUnits,B.meUnits,false);
  // gentle shoving so squads spread out instead of stacking on one pixel
  const crowd=B.meUnits.concat(B.enUnits).filter(u=>u.alive&&!u.structure);
  for(let i=0;i<crowd.length;i++)for(let j=i+1;j<crowd.length;j++){
    const a=crowd[i],b2=crowd[j];
    if(a.flying!==b2.flying) continue;
    const dx=b2.x-a.x,dy=b2.y-a.y,d=Math.hypot(dx,dy);
    if(d<15&&d>0.01){ const push=(15-d)*0.25; a.x-=dx/d*push; a.y-=dy/d*push; b2.x+=dx/d*push; b2.y+=dy/d*push; }
  }
  B.me.hp=B.meUnits.filter(u=>!u.structure).reduce((s,u)=>s+Math.max(0,u.hp),0);
  B.me.shield=B.meUnits.filter(u=>!u.structure).reduce((s,u)=>s+Math.max(0,u.shield),0);
  B.en.hp=B.enUnits.filter(u=>!u.structure).reduce((s,u)=>s+Math.max(0,u.hp),0);
  B.en.shield=B.enUnits.filter(u=>!u.structure).reduce((s,u)=>s+Math.max(0,u.shield),0);
  setBars();
  B.logAcc=(B.logAcc||0)+dt;
  if(B.logAcc>=1.5){ B.logAcc=0; bpLog('⚔️ Fighting… you: '+Math.round(B.me.hp)+' hp · enemy: '+Math.round(B.en.hp)+' hp',''); }
  const meAlive=B.meUnits.some(u=>u.alive&&!u.structure);
  const enAlive=B.enUnits.some(u=>u.alive&&!u.structure);
  if(B.elapsed>1.2 && (!meAlive||!enAlive||B.elapsed>60)){
    endBattleTicks();
    const win=!enAlive&&meAlive;
    B.done(win,B.me,'fought');
  }
}
function battleRender(dt){
  if(!bcv||!B||B.phase!=='fight') return;
  combatStep(dt);
  bctx.clearRect(0,0,bcv.width,bcv.height);
  bctx.save();
  if(battleShakeT>0){
    battleShakeT=Math.max(0,battleShakeT-dt);
    const mag=battleShakeT*14;
    bctx.translate((Math.random()-0.5)*mag,(Math.random()-0.5)*mag);
  }
  bctx.strokeStyle='rgba(255,255,255,0.08)'; bctx.lineWidth=2;
  bctx.beginPath(); bctx.moveTo(0,bcv.height*0.72); bctx.lineTo(bcv.width,bcv.height*0.72); bctx.stroke();
  B.meUnits.concat(B.enUnits).forEach(u=>drawBattleUnit(u,dt));
  battleProjectiles=battleProjectiles.filter(pr=>{
    pr.t+=dt/pr.dur;
    const tt=Math.min(1,pr.t);
    pr.x=pr.x0+(pr.tx-pr.x0)*tt;
    pr.y=pr.y0+(pr.ty-pr.y0)*tt-(pr.arcH||0)*Math.sin(tt*Math.PI);
    if(pr.t>=1){
      if(pr.kind==='spit') acidSplatFx.push({x:pr.tx,y:pr.ty,life:0.45,total:0.45});
      if(pr.kind==='rock'){ ringFx.push({x:pr.tx,y:pr.ty,life:0.45,total:0.45}); spawnMeleeFx(pr.tx,pr.ty); }
      return false;
    }
    if(pr.kind==='arrow'){
      const ang=Math.atan2(pr.ty-pr.y0,pr.tx-pr.x0);
      bctx.save(); bctx.translate(pr.x,pr.y); bctx.rotate(ang);
      bctx.strokeStyle='#d8b87e'; bctx.lineWidth=2; bctx.beginPath(); bctx.moveTo(-10,0); bctx.lineTo(4,0); bctx.stroke();
      bctx.fillStyle='#d8b87e'; bctx.beginPath(); bctx.moveTo(5,0); bctx.lineTo(-1,-3); bctx.lineTo(-1,3); bctx.closePath(); bctx.fill();
      bctx.restore();
    } else if(pr.kind==='spit'){
      bctx.save();
      bctx.globalAlpha=0.9; bctx.fillStyle='#8fd94f';
      bctx.beginPath(); bctx.ellipse(pr.x,pr.y,5,3.8,0,0,6.28); bctx.fill();
      bctx.fillStyle='#bef27a';
      bctx.beginPath(); bctx.arc(pr.x-1,pr.y-1,1.8,0,6.28); bctx.fill();
      bctx.globalAlpha=0.4; bctx.fillStyle='#8fd94f';
      bctx.beginPath(); bctx.arc(pr.x-(pr.tx-pr.x0)*0.06,pr.y-(pr.ty-pr.y0)*0.06+3,2.4,0,6.28); bctx.fill();
      bctx.beginPath(); bctx.arc(pr.x-(pr.tx-pr.x0)*0.12,pr.y-(pr.ty-pr.y0)*0.12+5,1.6,0,6.28); bctx.fill();
      bctx.restore();
    } else if(pr.kind==='rock'){
      bctx.save();
      bctx.fillStyle='#8a7a5a'; bctx.strokeStyle='#5a4a30'; bctx.lineWidth=1.5;
      bctx.beginPath(); bctx.arc(pr.x,pr.y,6,0,6.28); bctx.fill(); bctx.stroke();
      bctx.strokeStyle='#6a5a40'; bctx.lineWidth=1;
      bctx.beginPath(); bctx.moveTo(pr.x-3,pr.y-1); bctx.lineTo(pr.x+1,pr.y+2); bctx.stroke();
      bctx.restore();
    } else {
      bctx.fillStyle=pr.color; bctx.beginPath(); bctx.arc(pr.x,pr.y,3,0,6.28); bctx.fill();
    }
    return pr.t<1;
  });
  meleeFx=meleeFx.filter(f=>{
    f.life-=dt;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/0.22);
    bctx.font='700 18px sans-serif'; bctx.textAlign='center';
    bctx.fillText('💥', f.x, f.y-8);
    bctx.restore();
    return f.life>0;
  });
  slashFx=slashFx.filter(f=>{
    f.life-=dt;
    const p=1-f.life/f.total;
    bctx.save(); bctx.translate(f.x,f.y); bctx.rotate(f.ang);
    bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle='#ffffff'; bctx.lineWidth=3; bctx.lineCap='round';
    bctx.beginPath(); bctx.arc(0,0,15,-1.5+p*2.6,-0.4+p*2.6); bctx.stroke();
    bctx.strokeStyle='#ffe27a'; bctx.lineWidth=1.5;
    bctx.beginPath(); bctx.arc(0,0,11,-1.5+p*2.6,-0.4+p*2.6); bctx.stroke();
    bctx.restore();
    return f.life>0;
  });
  stingFx=stingFx.filter(f=>{
    f.life-=dt;
    const p=1-f.life/f.total;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle='#ffd34e'; bctx.lineWidth=2; bctx.lineCap='round';
    for(let i=0;i<6;i++){ const a=i/6*6.28+p*1.5; const r0=3+p*10;
      bctx.beginPath(); bctx.moveTo(f.x+Math.cos(a)*r0,f.y+Math.sin(a)*r0);
      bctx.lineTo(f.x+Math.cos(a)*(r0+5),f.y+Math.sin(a)*(r0+5)); bctx.stroke(); }
    bctx.restore();
    return f.life>0;
  });
  acidSplatFx=acidSplatFx.filter(f=>{
    f.life-=dt;
    const p=1-f.life/f.total, sc=f.small?0.45:1;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total)*0.9;
    bctx.fillStyle='#8fd94f';
    for(let i=0;i<5;i++){ const a=i/5*6.28+0.5;
      bctx.beginPath(); bctx.arc(f.x+Math.cos(a)*p*14*sc,f.y+Math.sin(a)*p*9*sc+p*5*sc,Math.max(0.5,(3-p*2))*sc,0,6.28); bctx.fill(); }
    bctx.fillStyle='#bef27a';
    bctx.beginPath(); bctx.arc(f.x,f.y,Math.max(0.5,(4.5-p*3.5))*sc,0,6.28); bctx.fill();
    bctx.restore();
    return f.life>0;
  });
  zapFx=zapFx.filter(f=>{
    f.life-=dt;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle='#ffe95c'; bctx.lineWidth=2.4; bctx.lineJoin='round';
    for(let i=0;i<f.pts.length-1;i++){
      const a=f.pts[i], b3=f.pts[i+1];
      bctx.beginPath(); bctx.moveTo(a.x,a.y);
      for(let sg=1;sg<=4;sg++){
        const tt2=sg/4;
        const jx=sg<4?(Math.random()*10-5):0, jy=sg<4?(Math.random()*10-5):0;
        bctx.lineTo(a.x+(b3.x-a.x)*tt2+jx, a.y+(b3.y-a.y)*tt2+jy);
      }
      bctx.stroke();
    }
    bctx.strokeStyle='#ffffff'; bctx.lineWidth=1;
    f.pts.slice(1).forEach(pt2=>{ bctx.beginPath(); bctx.arc(pt2.x,pt2.y,3,0,6.28); bctx.stroke(); });
    bctx.restore();
    return f.life>0;
  });
  laserFx=laserFx.filter(f=>{
    f.life-=dt;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle=f.color; bctx.lineWidth=4; bctx.shadowColor=f.color; bctx.shadowBlur=10; bctx.lineCap='round';
    bctx.beginPath(); bctx.moveTo(f.x0,f.y0); bctx.lineTo(f.x1,f.y1); bctx.stroke();
    bctx.strokeStyle='#fff'; bctx.lineWidth=1.5;
    bctx.beginPath(); bctx.moveTo(f.x0,f.y0); bctx.lineTo(f.x1,f.y1); bctx.stroke();
    bctx.shadowBlur=0;
    bctx.fillStyle=f.color; bctx.beginPath(); bctx.arc(f.x1,f.y1,5,0,6.28); bctx.fill();
    bctx.restore();
    return f.life>0;
  });
  spikeFx=spikeFx.filter(f=>{
    f.life-=dt;
    const p=1-f.life/f.total, up=Math.sin(p*Math.PI)*13;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.fillStyle='#9a9a9a'; bctx.strokeStyle='#4a4a4a'; bctx.lineWidth=1;
    for(let i=-1;i<=1;i++){
      bctx.beginPath(); bctx.moveTo(f.x+i*8-3,f.y); bctx.lineTo(f.x+i*8,f.y-up); bctx.lineTo(f.x+i*8+3,f.y); bctx.closePath();
      bctx.fill(); bctx.stroke();
    }
    bctx.restore();
    return f.life>0;
  });
  ringFx=ringFx.filter(f=>{
    f.life-=dt;
    const p=1-f.life/f.total;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle='#ffb060'; bctx.lineWidth=3*(1-p)+1;
    bctx.beginPath(); bctx.arc(f.x,f.y,6+p*40,0,6.28); bctx.stroke();
    bctx.restore();
    return f.life>0;
  });
  healBeamFx=healBeamFx.filter(f=>{
    f.life-=dt;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.strokeStyle='#7ce07c'; bctx.lineWidth=2; bctx.setLineDash([4,3]);
    bctx.beginPath(); bctx.moveTo(f.x0,f.y0); bctx.lineTo(f.x1,f.y1); bctx.stroke();
    bctx.setLineDash([]);
    bctx.font='12px sans-serif'; bctx.textAlign='center';
    bctx.fillText('💚', f.x1, f.y1-16);
    bctx.restore();
    return f.life>0;
  });
  battleDmgFx=battleDmgFx.filter(f=>{f.life-=dt; f.y-=dt*22; return f.life>0;});
  battleDmgFx.forEach(f=>{
    bctx.globalAlpha=Math.max(0,f.life/0.8);
    bctx.fillStyle=f.miss?'#9be0ff':(f.heal?'#7ce07c':(f.crit?'#ffd34e':'#ff8080'));
    const critPop=f.crit?(1+Math.max(0,f.life-0.5)*2.2):1; // crits slam in oversized then settle
    bctx.font=(f.crit?'900 '+Math.round(20*critPop)+'px':'700 13px')+' Trebuchet MS'; bctx.textAlign='center';
    bctx.fillText(f.miss?'MISS':(f.heal?f.val:(f.crit?'💥CRIT -'+f.val:'-'+f.val)), f.x, f.y); bctx.globalAlpha=1;
  });
  killFx=killFx.filter(f=>{
    f.life-=dt;
    const pr=1-f.life/f.total;
    bctx.save(); bctx.globalAlpha=Math.max(0,f.life/f.total);
    bctx.font=(14+pr*10)+'px sans-serif'; bctx.textAlign='center';
    bctx.fillText('💀', f.x, f.y-pr*20);
    // burst shards
    bctx.fillStyle=f.side==='en'?'#ffd34e':'#ff8080';
    for(let i=0;i<5;i++){
      const a=i/5*6.28, rr=Math.max(0,pr)*22;
      bctx.beginPath(); bctx.arc(f.x+Math.cos(a)*rr, f.y+Math.sin(a)*rr, Math.max(0,2*(1-pr)), 0, 6.28); bctx.fill();
    }
    bctx.restore();
    return f.life>0;
  });
  bctx.restore();
}
function drawBattleUnit(u,dt){
  u._bobT=(u._bobT||Math.random()*6.28)+dt*(u.flying?4:0);
  const bob=u.flying?Math.sin(u._bobT)*3:0;
  if(u.structure){ u.x+=(u.tx-u.x)*Math.min(1,dt*6); u.y+=(u.ty-u.y)*Math.min(1,dt*6); }
  if(u.movingT>0){ u.movingT-=dt; u._walkT=(u._walkT||0)+dt*15; }
  if(u.atkT>0) u.atkT=Math.max(0,u.atkT-dt);
  if(u.flashT>0) u.flashT=Math.max(0,u.flashT-dt);
  if(u.critFx>0) u.critFx=Math.max(0,u.critFx-dt);
  if(!u.alive){
    u.deathT=Math.max(0,(u.deathT||0)-dt);
    if(u.deathT<=0) return;
  }
  const lungeAmt = u.atkT>0 ? Math.sin((0.3-u.atkT)/0.3*Math.PI)*16*(u.side==='me'?1:-1) : 0;
  if(u.flying&&u.alive){
    bctx.save(); bctx.globalAlpha=0.22; bctx.fillStyle='#000';
    bctx.beginPath(); bctx.ellipse(u.x,u.y+22,10,3,0,0,6.28); bctx.fill(); bctx.restore();
  }
  bctx.save();
  const alpha = u.alive? 1 : Math.max(0,u.deathT/0.5);
  const scale = u.alive? 1 : Math.max(0.2,u.deathT/0.5);
  bctx.globalAlpha=alpha;
  const walkBob=(!u.flying&&!u.structure&&u.movingT>0)?Math.abs(Math.sin(u._walkT||0))*-2.5:0;
  bctx.translate(u.x+lungeAmt,u.y+bob+walkBob); bctx.scale(scale,scale);
  if(u.atkT>0&&!u.ranged&&!u.structure&&!u.medic){ bctx.rotate(Math.sin((0.3-u.atkT)/0.3*Math.PI)*0.55*(u.side==='me'?1:-1)); }
  if(u.critFx>0){ bctx.shadowColor='#ffd34e'; bctx.shadowBlur=22; }
  else if(u.flashT>0){ bctx.shadowColor='#ff4040'; bctx.shadowBlur=16; }
  if(u.alive&&!u.structure&&UNITS[u.type]){
    // ambient skill flair for each ant type, so the battlefield reads at a glance
    const bt=UNITS[u.type];
    if(bt.chain){
      bctx.strokeStyle='#ffe985'; bctx.lineWidth=1;
      for(let i=0;i<3;i++){ const ang=u._bobT*4+i*2.1;
        bctx.globalAlpha=0.5+Math.sin(u._bobT*7+i)*0.35;
        bctx.beginPath(); bctx.moveTo(Math.cos(ang)*13,Math.sin(ang)*9); bctx.lineTo(Math.cos(ang)*17,Math.sin(ang)*12); bctx.stroke(); }
      bctx.globalAlpha=1;
    } else if(bt.medic){
      const hp=0.25+((Math.sin(u._bobT*2)+1)/2)*0.35;
      bctx.strokeStyle='rgba(255,140,170,'+hp+')'; bctx.lineWidth=1.3;
      bctx.beginPath(); bctx.arc(0,0,15+Math.sin(u._bobT*2)*1.5,0,6.28); bctx.stroke();
    } else if(u.type==='guard'){
      bctx.strokeStyle='rgba(150,220,255,0.55)'; bctx.fillStyle='rgba(120,200,255,0.12)'; bctx.lineWidth=1;
      bctx.beginPath(); bctx.arc(0,0,16,0,6.28); bctx.fill(); bctx.stroke();
    } else if(u.type==='bomber'){
      const fuse=(Math.sin(u._bobT*10)+1)/2;
      bctx.fillStyle='rgba(255,180,90,'+(0.35+fuse*0.4)+')';
      bctx.beginPath(); bctx.arc(0,-16,2+fuse*1.6,0,6.28); bctx.fill();
    } else if(u.type==='siege'){
      bctx.fillStyle='rgba(154,138,106,0.35)';
      bctx.beginPath(); bctx.arc(-12,10,3+Math.sin(u._bobT*6)*1,0,6.28); bctx.fill();
    } else if(u.type==='spitter'){
      const dp=(u._bobT*1.4)%1;
      bctx.fillStyle='rgba(174,242,122,'+(1-dp)*0.75+')';
      bctx.beginPath(); bctx.arc(9,dp*10,1.6*(1-dp*0.3),0,6.28); bctx.fill();
    } else if(u.type==='monarch'||u.type==='wasp'){
      bctx.strokeStyle=u.type==='monarch'?'rgba(240,166,35,0.5)':'rgba(255,255,255,0.4)'; bctx.lineWidth=1;
      const wf=Math.sin(u._bobT*(u.type==='wasp'?24:12));
      bctx.beginPath(); bctx.ellipse(-6*Math.sign(wf||1),-2,7,3,wf*0.4,0,6.28); bctx.stroke();
      bctx.beginPath(); bctx.ellipse(6*Math.sign(wf||1),-2,7,3,-wf*0.4,0,6.28); bctx.stroke();
    }
  }
  bctx.font=(u.isBoss?'40px':u.structure?'30px':'26px')+' sans-serif'; bctx.textAlign='center';
  bctx.fillText(u.face||(UNITS[u.type]?UNITS[u.type].emoji:'🐜'), 0, 0);
  if(u.stunT>0){ bctx.font='16px sans-serif'; bctx.fillText('🕸️', 0, -14); }
  bctx.shadowBlur=0;
  bctx.restore();
  if(u.alive){
    const w=22,hh=4;
    bctx.fillStyle='rgba(0,0,0,0.4)'; bctx.fillRect(u.x-w/2,u.y+bob+13,w,hh);
    bctx.fillStyle=u.side==='me'?'#4fbf6a':'#e05252';
    bctx.fillRect(u.x-w/2,u.y+bob+13,w*Math.max(0,Math.min(1,u.hp/u.maxHp)),hh);
    if(u.groupSize>1.4){
      bctx.font='700 8px Trebuchet MS'; bctx.fillStyle='#ffd34e'; bctx.textAlign='center';
      bctx.fillText('x'+Math.round(u.groupSize), u.x+12, u.y+bob-10);
    }
  }
}
function resetPrepTimer(){ if(B&&B.phase==='prep') B.prepT=B.prepMax||10; }
function renderPrep(){
  const C=el('bpCmds');
  const clsMap={line:'retreat', wedge:'charge', turtle:'wall', ambush:'cry'};
  C.innerHTML='<div id="bpAutoTimer" style="grid-column:1/-1; text-align:center; font-weight:700; font-size:10.5px; color:#c9b596; margin-bottom:2px">⏱️ Auto-battle if no orders given…</div>'+
    '<div style="grid-column:1/-1; text-align:center; font-weight:800; font-size:12px; color:#ffd7a8">🐜 Choose your formation</div>'+
    Object.keys(FORMS).map(k=>
      `<button class="cmd ${clsMap[k]} ${B.form===k?'active':''}" data-form="${k}">${FORMS[k].name}<small>${FORMS[k].sub}</small></button>`
    ).join('');
  C.querySelectorAll('[data-form]').forEach(b=>b.onclick=()=>{ resetPrepTimer(); B.form=b.dataset.form; renderPrep(); });
  const ch=el('bpChoices');
  ch.innerHTML=`<button class="btn red" id="beginBtn" style="font-size:15px; padding:12px">⚔️ Begin Battle!</button>`+
    (B.canCancel?'<button class="btn ghost" id="cancelBtn">↩️ Fall back (no losses)</button>':'');
  el('beginBtn').onclick=beginBattle;
  if(B.canCancel) el('cancelBtn').onclick=()=>{ resetPrepTimer(); closeBattlePage(); if(panelOpen==='map') renderPanel(); };
  // formation preview replaces the swarm face until battle starts
  el('bpMe').innerHTML=`<div style="font-size:19px; line-height:1.4; text-align:center">${formationPreview()}</div>`;
  renderFormationDeploy();
}
// ---- manual formation: drag a fighter type between Front Line and Back Line before the fight ----
function renderFormationDeploy(){
  const D=el('bpDeploy'); if(!D) return;
  const sel=B.sel||{};
  const present=FIGHTERS.filter(k=>(sel[k]||0)>0);
  if(!present.length){ D.innerHTML=''; return; }
  const chip=k=>`<div class="fchip" draggable="true" data-type="${k}">${UNITS[k].emoji}<small>${sel[k]}</small></div>`;
  const rowHtml=(label,key)=>`<div class="drow" data-row="${key}">
    <div class="rowlbl">${label}</div>
    ${present.filter(k=>(B.rows[k]||defaultRow(k))===key).map(chip).join('')}
  </div>`;
  D.innerHTML='<div class="rowlbl" style="padding:0 2px">🖐️ Drag (or tap) a fighter to set your formation</div>'
    + rowHtml('⚔️ Front Line — tanks the enemy first', 'front')
    + rowHtml('🏹 Back Line — protected until the front falls', 'back');
  let dragType=null;
  D.querySelectorAll('.fchip').forEach(c=>{
    c.addEventListener('dragstart',e=>{ dragType=c.dataset.type; resetPrepTimer(); e.dataTransfer&&e.dataTransfer.setData('text/plain',dragType); });
    // touch devices can't drag-and-drop with HTML5 DnD — tapping a chip flips its row instead
    c.addEventListener('click',()=>{
      resetPrepTimer();
      const k=c.dataset.type;
      B.rows[k]=(B.rows[k]||defaultRow(k))==='front'?'back':'front';
      renderFormationDeploy();
    });
  });
  D.querySelectorAll('.drow').forEach(z=>{
    z.addEventListener('dragover',e=>{ e.preventDefault(); z.classList.add('dragover'); });
    z.addEventListener('dragleave',()=>z.classList.remove('dragover'));
    z.addEventListener('drop',e=>{
      e.preventDefault(); z.classList.remove('dragover'); resetPrepTimer();
      const t=dragType||(e.dataTransfer&&e.dataTransfer.getData('text/plain'));
      if(t){ B.rows[t]=z.dataset.row; renderFormationDeploy(); }
    });
  });
}
function beginBattle(){
  B.phase='fight';
  el('bpMe').textContent=B.meFace;
  el('bpChoices').innerHTML='';
  if(el('bpDeploy')) el('bpDeploy').innerHTML='';
  bpLog('⚔️ '+FORMS[B.form].name+' formation set — CHARGE!','good');
  resizeBattleCv();
  setupBattleUnits();
  const F=FORMS[B.form];
  B.meUnits.forEach(u=>{ u.shield=Math.round(u.shield*F.shield); u.maxShield=Math.round(u.maxShield*F.shield); });
  B.me.shield=B.meUnits.reduce((s,u)=>s+u.shield,0); B.me.maxShield=B.meUnits.reduce((s,u)=>s+u.maxShield,0);
  setBars(); renderCmds();
  el('bpScene').classList.add('fighting');
  battleDmgFx=[]; battleProjectiles=[]; meleeFx=[]; killFx=[]; battleShakeT=0; clearBattleFx();
}
function endBattleTicks(){ B.over=true; renderCmds(); }
function doRetreat(){
  endBattleTicks();
  bpLog('🏳️ You sound the retreat…');
  B.done(false,B.me,'retreat');
}
function closeBattlePage(){
  el('battlePage').classList.remove('show');
  el('bpScene').classList.remove('fighting');
  battleDmgFx=[]; battleProjectiles=[]; meleeFx=[]; killFx=[]; battleShakeT=0; clearBattleFx();
  B=null;
}

/* ---- RAID ---- */
function startRaidBattle(t, sel){
  const a=armyStatsOf(sel); if(a.n<1) return;
  startBattlePage({
    title:'⚔️ Raid: '+t.name,
    subtitle:'T'+t.tier+(t.boss?' BOSS':'')+' · Loot 🍯'+t.food+(t.crystal?' 💎'+t.crystal:''),
    meLabel:'War-party ('+FIGHTERS.reduce((a2,k)=>a2+(sel[k]||0),0)+')',
    meFace:'👑'+'🐜'.repeat(Math.min(3,Math.ceil(FIGHTERS.reduce((a2,k)=>a2+(sel[k]||0),0)/4))),
    sel:{...sel}, canCancel:true,
    enemy:t,
    me:{dps:a.dps,armor:a.armor,maxHp:a.hp,maxShield:a.shield,hp:a.hp,shield:a.shield},
    en:{dps:t.dps,armor:t.armor,maxHp:t.hp,maxShield:t.shield,hp:t.hp,shield:t.shield},
    intro:'The war-party marches through the winding tunnels to '+t.name+'!',
    done:(win,me,how)=>finishRaid(t,me,sel,win,how),
  });
}
function finishRaid(t,me,sel,win,how){
  const ch=el('bpChoices');
  if(win){
    S.stats.raidsWon++;
    const xp=t.boss?40+20*t.tier:12+8*t.tier;
    bpLog('🏆 VICTORY! '+t.name+' is conquered! +'+xp+' XP','good');
    ch.innerHTML=`
      <button class="btn" id="takeHalf">🤝 Take Half (+🍯${Math.floor(t.food/2)}${t.crystal?' +💎'+Math.floor(t.crystal/2):''})</button>
      <button class="btn red" id="takeAll">💰 Plunder All (+🍯${t.food}${t.crystal?' +💎'+t.crystal:''}, +1 soldier)</button>`;
    const legacyWin=()=>{ if(t.boss) awardLegacy(2,'Boss slain!'); else if(t.evolved) awardLegacy(1,'Evolved rival crushed!'); };
    el('takeHalf').onclick=()=>{ gainFood(Math.floor(t.food/2)); gainCrys(Math.floor(t.crystal/2));
      updateWoundedFromBattle(sel); const dd=applyRealCasualties(sel,0); reportCasualties(dd); veteranAttrition(dd,sel); maybePromoteVeteran(sel,dd); if(t.boss)S.stats.boss++; addXP(xp); legacyWin(); afterRaid(t,true); };
    el('takeAll').onclick=()=>{ gainFood(t.food); gainCrys(t.crystal);
      updateWoundedFromBattle(sel); const dd=applyRealCasualties(sel,0); reportCasualties(dd); veteranAttrition(dd,sel); maybePromoteVeteran(sel,dd); if(pop()<popCap())S.units.soldier++; if(t.boss)S.stats.boss++; addXP(xp); legacyWin(); syncAgents(); afterRaid(t,true); };
  } else if(how==='retreat'){
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
    reportCasualties(applyRealCasualties(sel,0.35));
    addXP(8);
    bpLog('💔 Defeat… lost most of the party & 🍯'+foodLost+'. The Queen does not survive this loss…','hit');
    queenDies();
    ch.innerHTML='<button class="btn" id="ok">😞 Retreat home</button>';
    el('ok').onclick=()=>afterRaid(t,false);
  }
}
function afterRaid(t,won){
  closeBattlePage();
  if(won) removeTarget(t);
  if(panelOpen==='map') renderPanel();
  updateHUD(); updateDots(); save();
}

/* ---- LEVEL-UP TRIAL — every level must be earned by beating its Guardian ---- */
function startLevelBossBattle(t, sel){
  const a=armyStatsOf(sel); if(a.n<1) return;
  const n=FIGHTERS.reduce((s,k)=>s+(sel[k]||0),0);
  startBattlePage({
    title:'⭐ Trial: '+t.name,
    subtitle:'For Level '+t.forLvl+' · Lose and 25% of your army falls',
    meLabel:'War-party ('+n+')',
    meFace:'👑'+'🐜'.repeat(Math.min(3,Math.ceil(n/4))),
    sel:{...sel}, canCancel:true,
    enemy:t,
    me:{dps:a.dps,armor:a.armor,maxHp:a.hp,maxShield:a.shield,hp:a.hp,shield:a.shield},
    en:{dps:t.dps,armor:t.armor,maxHp:t.hp,maxShield:t.shield,hp:t.hp,shield:t.shield},
    intro:'The '+t.name+' blocks the path to level '+t.forLvl+'!',
    done:(win,me,how)=>finishLevelBoss(t,sel,win,how),
  });
}
function finishLevelBoss(boss,sel,win,how){
  const ch=el('bpChoices');
  if(win){
    S.queen.xp=Math.max(0, S.queen.xp-xpNeed(S.queen.lvl));
    S.queen.lvl++;
    S.levelBoss=null;
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel,0));
    awardLegacy(1,'Trial Guardian defeated!');
    bpLog('🏆 VICTORY! The '+boss.name+' falls — the Queen ascends to level '+S.queen.lvl+'!','good');
    toast('👑 Level '+S.queen.lvl+' achieved!');
    float('👑 LVL '+S.queen.lvl,'#ffd34e');
    // enough banked XP for the next level too? another Guardian steps up immediately
    if(S.queen.xp>=xpNeed(S.queen.lvl)){
      S.levelBoss=makeLevelBoss(S.queen.lvl+1);
      bpLog('⭐ A new challenger, '+S.levelBoss.name+', approaches for level '+S.levelBoss.forLvl+'!');
    }
    ch.innerHTML='<button class="btn" id="ok">🎉 Continue</button>';
    el('ok').onclick=()=>{ closeBattlePage(); if(panelOpen==='queen') renderPanel(); updateHUD(); updateDots(); save(); };
  } else if(how==='retreat'){
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel,0.1));
    bpLog('🏳️ You called off the trial. The Guardian still awaits.');
    ch.innerHTML='<button class="btn" id="ok">↩️ Regroup</button>';
    el('ok').onclick=()=>{ closeBattlePage(); if(panelOpen==='queen') renderPanel(); updateHUD(); updateDots(); save(); };
  } else {
    // fixed penalty, as promised: a quarter of the army falls — but the Queen herself is safe
    updateWoundedFromBattle(sel);
    FIGHTERS.forEach(k=>{ const lost=Math.round(S.units[k]*0.25); S.units[k]=Math.max(0,S.units[k]-lost); });
    syncAgents();
    bpLog('💔 Defeated! The '+boss.name+' broke a quarter of your army. The Queen survives — regroup and try again.','hit');
    ch.innerHTML='<button class="btn" id="ok">😤 Regroup</button>';
    el('ok').onclick=()=>{ closeBattlePage(); if(panelOpen==='queen') renderPanel(); updateHUD(); updateDots(); save(); };
  }
}
// ---- casualties are read straight out of the real per-unit fight, not a random formula ----
function computeCasualties(sel){
  const dead={}; FIGHTERS.forEach(k=>dead[k]=0);
  if(!B||!B.meUnits) return dead;
  B.meUnits.forEach(u=>{
    if(!u.groupSize||u.structure) return;
    if(!u.alive) dead[u.type]+=Math.round(u.groupSize);
    else if(u.hp<u.maxHp*0.999) dead[u.type]+=Math.round((1-u.hp/u.maxHp)*u.groupSize*0.4);
  });
  const totalDead=FIGHTERS.reduce((s,k)=>s+dead[k],0);
  const totalSent=FIGHTERS.reduce((s,k)=>s+(sel[k]||0),0);
  // StarCraft rule of thumb: nobody wins a real fight completely unscathed
  if(totalDead===0 && totalSent>0){
    const pool=FIGHTERS.filter(k=>(sel[k]||0)>0);
    const k=pool[Math.floor(Math.random()*pool.length)];
    dead[k]=Math.max(1,Math.round((sel[k]||0)*0.04));
  }
  return dead;
}
function applyRealCasualties(sel,extraFrac){
  const dead=computeCasualties(sel);
  FIGHTERS.forEach(k=>{
    const sent=sel[k]||0, base=Math.min(sent,dead[k]||0);
    const extra=extraFrac?Math.round((sent-base)*extraFrac):0;
    const lost=Math.min(sent, base+extra);
    S.units[k]=Math.max(0, S.units[k]-lost);
    dead[k]=lost;
  });
  syncAgents();
  return dead;
}
// after a fight, survivors carry their wounds home — nurses will heal them over time
function updateWoundedFromBattle(sel){
  if(!B||!B.meUnits) return;
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
function reportCasualties(dead){
  const total=FIGHTERS.reduce((s,k)=>s+(dead[k]||0),0);
  if(total>0){
    const parts=FIGHTERS.filter(k=>dead[k]>0).map(k=>UNITS[k].emoji+(dead[k]>1?'×'+dead[k]:''));
    bpLog('💀 Casualties: '+parts.join(' '), 'hit');
  }
}

/* ---- DEFENSE ---- */
function triggerDefense(){
  raiderApproach=null;
  const tier=Math.max(1, Math.floor(S.queen.lvl*0.6)+Math.floor(S.jelly*0.4)+Math.floor(Math.random()*2));
  const em=diff().enemyMult;
  const hp=Math.floor(35*tier*(0.8+Math.random()*0.4)*em);
  const raider={
    name:['Bandit Beetles','Wasp Warband','Termite Raiders','Marauder Mantis'][Math.floor(Math.random()*4)],
    face:['🪲','🐝','🦗','🦂'][Math.floor(Math.random()*4)],
    tier, hp, shield:0, dps:4*tier*(0.8+Math.random()*0.4)*em, armor:Math.floor(tier*0.5),
  };
  const tb=trapDefBonus();
  if(tb>0){
    raider.hp=Math.floor(raider.hp*(1-tb)); raider.dps*=(1-tb);
    toast('🵸 Your traps mauled the raiders before they reached the throne!');
  }
  if(S.rooms.laser>0){
    const ld=laserDefDmg();
    raider.hp=Math.max(1,Math.floor(raider.hp-ld));
    toast('📡 The Laser Tower scorches '+raider.name+' before they arrive! (-'+ld+' HP)');
  }
  const home=armyStatsOf(S.units,true);
  if(home.n<1){
    const f=Math.floor(S.food*0.2), c=Math.floor(S.crystal*0.2);
    S.food-=f; S.crystal-=c; S.queen.hp=Math.max(1,S.queen.hp-10);
    toast('💔 '+raider.name+' raided your undefended nest! Lost 🍯'+f+' 💎'+c+'. The Queen was hurt!');
    save(); return;
  }
  const defSel=(()=>{const o={}; FIGHTERS.forEach(k=>o[k]=S.units[k]); return o;})();
  startBattlePage({
    title:'🛡️ DEFEND THE NEST!',
    subtitle:raider.name+' storm your tunnels!',
    meLabel:'Home Defenders ('+home.n+')',
    meFace:'🛡️🐜🐜',
    sel:defSel, home:true, canCancel:false,
    enemy:raider,
    me:{dps:home.dps,armor:home.armor,maxHp:home.hp,maxShield:home.shield,hp:home.hp,shield:home.shield},
    en:{dps:raider.dps,armor:raider.armor,maxHp:raider.hp,maxShield:0,hp:raider.hp,shield:0},
    intro:raider.face+' '+raider.name+' break into the colony! Guards to the front!',
    done:(win,me,how)=>finishDefense(raider,me,win,how,defSel),
  });
}
function finishDefense(raider,me,win,how,defSel){
  const ch=el('bpChoices');
  const sel=defSel||B.sel||{};
  if(win){
    S.stats.defWins++;
    const lootF=10+raider.tier*6+Math.floor(Math.random()*15), lootC=1+Math.floor(raider.tier*0.6)+Math.floor(Math.random()*3);
    updateWoundedFromBattle(sel);
    const ddDef=applyRealCasualties(sel,0); reportCasualties(ddDef); veteranAttrition(ddDef,sel); maybePromoteVeteran(sel,ddDef);
    gainFood(lootF); gainCrys(lootC); addXP(15+5*raider.tier);
    bpLog('🛡️ Nest defended! Raiders dropped 🍯'+lootF+' 💎'+lootC+'. +20 XP','good');
    ch.innerHTML='<button class="btn" id="ok">🏆 Collect & repair</button>';
    el('ok').onclick=()=>{ closeBattlePage(); updateHUD(); updateDots(); save(); };
  } else {
    const f=Math.floor(S.food*0.15), c=Math.floor(S.crystal*0.15);
    S.food-=f; S.crystal-=c;
    updateWoundedFromBattle(sel);
    reportCasualties(applyRealCasualties(sel, how==='retreat'?0.2:0.35));
    addXP(8);
    if(how==='retreat'){
      S.queen.hp=Math.max(1,S.queen.hp-15);
      bpLog('💔 You pulled the Queen to safety, but the raiders looted 🍯'+f+' 💎'+c+'. +8 XP','hit');
    } else {
      bpLog('💔 The raiders broke through to the throne room… stole 🍯'+f+' 💎'+c+'. The Queen does not survive this loss…','hit');
      queenDies();
    }
    ch.innerHTML='<button class="btn" id="ok">Rebuild 😤</button>';
    el('ok').onclick=()=>{ closeBattlePage(); updateHUD(); updateDots(); save(); };
  }
}

/* ==========================================================================
   FX + BOOT
   ========================================================================== */
function toast(msg){ const t=el('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2800); }
function float(txt,color){ const f=document.createElement('div'); f.className='floaty';
  f.textContent=txt; f.style.color=color||'#fff'; f.style.left=(45+Math.random()*10)+'%'; f.style.top='55%';
  document.getElementById('floaties').appendChild(f); setTimeout(()=>f.remove(),1100); }

document.querySelectorAll('#diffPick [data-diff]').forEach(b=>b.addEventListener('click',()=>{
  pendingDifficulty=b.dataset.diff;
  document.querySelectorAll('#diffPick [data-diff]').forEach(x=>x.classList.toggle('ghost', x.dataset.diff!==pendingDifficulty));
  el('diffDesc').textContent=DIFFS[pendingDifficulty].desc;
}));
window.addEventListener('load',()=>{
  resize();
  const d=loadSave();
  if(d){
    el('startBtn').textContent='🐜 Continue Colony';
    el('newLink').classList.remove('hidden');
  }
});
el('startBtn').addEventListener('click',()=>{
  const d=loadSave();
  if(d){
    const gains=applySave(d);
    bootGame();
    if(gains){
      el('welcome').classList.add('show');
      el('wcard').innerHTML=`<h2>👑 Welcome back!</h2>
        <div style="font-size:44px;margin:8px 0">🐜🍯</div>
        <div class="blog">You were away for <b>${fmtAway(gains.away)}</b>.<br>Your loyal workers kept gathering:</div>
        <div class="depsum">+🍯${gains.f} +💎${gains.c}${gains.hatchedAway>0?' · 🐣 '+gains.hatchedAway+' eggs hatched!':''}</div>
        <div class="choices"><button class="btn" id="wok">Collect! 🎉</button></div>`;
      el('wok').onclick=()=>el('welcome').classList.remove('show');
    }
  } else {
    S=freshState(); initTargets(); bootGame(); save();
    toast('The Queen lays eggs in the Throne Room — Nurses carry them through the tunnels to the Nursery!');
  }
});
el('newLink').addEventListener('click',()=>{
  if(confirm('Erase your saved colony and start over?')){
    eraseSave(); S=freshState(); initTargets(); bootGame(); save();
  }
});
window.addEventListener('visibilitychange',()=>{ if(document.hidden&&running) save(); });
window.addEventListener('beforeunload',()=>{ if(running) save(); });
