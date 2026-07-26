s = open("gc2.js", encoding="utf-8").read()

edits = []

edits.append(("""const PRINCESS={name:'Princess', emoji:'👸', hatchT:45, food:60, crystal:15};""",
"""const PRINCESS={name:'Princess', emoji:'👸', hatchT:45, food:60, crystal:15};
// In the battle scene every fighter is drawn as an actual ant (not a sword/circle/tool glyph) — flying
// recruits keep their real-bug icon since they're genuinely wasps/butterflies, not ants in disguise.
const BATTLE_FACE={soldier:'🐜',spitter:'🐜',guard:'🐜',medic:'🐜',archer:'🐜',siege:'🐜',zapper:'🐜',bomber:'🐜'};
function battleFace(k){ return BATTLE_FACE[k]||UNITS[k].emoji; }"""))

edits.append(("""      B.meUnits.push({
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
  }""",
"""      B.meUnits.push({
        type:k, side:'me', face:battleFace(k), color:u.color, groupSize, hp:maxHp, maxHp, shield:maxShield, maxShield,
        dmg:baseDmg*0.5*groupSize, heal:u.medic?3.5*groupSize:0, medic:!!u.medic,
        splash:!!u.splash||k==='monarch', chain:!!u.chain, suicide:!!u.suicide,
        armor, ranged, flying, speed, range, row, alive:true, targetIdx:-1,
        atkCd:Math.random()*0.9, atkSpd:(ranged?0.9:1.05)+Math.random()*0.15,
        x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0
      });
    }
  });
  if(!B.meUnits.length){
    B.meUnits.push({type:'soldier',side:'me',face:battleFace('soldier'),color:UNITS.soldier.color,groupSize:1,hp:1,maxHp:1,shield:0,maxShield:0,
      dmg:0,armor:0,ranged:false,flying:false,speed:70,range:30,row:'front',alive:true,targetIdx:-1,atkCd:1,atkSpd:1,
      x:undefined,y:undefined,tx:0,ty:0,atkT:0,flashT:0,deathT:0});
  }"""))

edits.append(("""  if(u.alive&&!u.structure&&UNITS[u.type]){
    // ambient skill flair for each ant type, so the battlefield reads at a glance
    const bt=UNITS[u.type];
    if(bt.chain){""",
"""  if(u.alive&&!u.structure&&UNITS[u.type]){
    // every fighter is a real ant now (no more sword/circle glyphs) — a soft tint disc in the
    // unit's own colour keeps each type easy to tell apart at a glance despite sharing one icon
    if(u.color){
      const cn=parseInt(u.color.slice(1),16), cr=(cn>>16)&255, cg=(cn>>8)&255, cb=cn&255;
      bctx.fillStyle='rgba('+cr+','+cg+','+cb+',0.32)';
      bctx.beginPath(); bctx.arc(0,1,10,0,6.28); bctx.fill();
      bctx.strokeStyle='rgba('+cr+','+cg+','+cb+',0.55)'; bctx.lineWidth=1;
      bctx.beginPath(); bctx.arc(0,1,10,0,6.28); bctx.stroke();
    }
    // ambient skill flair for each ant type, so the battlefield reads at a glance
    const bt=UNITS[u.type];
    if(bt.chain){"""))

edits.append(("""function formationPreview(){
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
  return lines.filter(l=>l.length).map(l=>'<div>'+l.join('')+'</div>').join('');""",
"""function formationPreview(){
  const sel=B.sel||{};
  const icons=[];
  // every fighter previews as an actual ant icon — front/back grouping now follows the real
  // formation-row assignment instead of matching against old tool-glyph emoji
  FIGHTERS.forEach(k=>{
    for(let i=0;i<Math.min(sel[k]||0,6);i++) icons.push({e:battleFace(k), k});
  });
  if(!icons.length) icons.push({e:'🐜', k:null});
  let lines;
  if(B.form==='wedge'){ lines=[icons.slice(0,1),icons.slice(1,3),icons.slice(3,8),icons.slice(8,14)]; }
  else if(B.form==='turtle'){
    const front=icons.filter(o=>o.k&&(B.rows[o.k]||defaultRow(o.k))==='front');
    const back=icons.filter(o=>o.k&&(B.rows[o.k]||defaultRow(o.k))==='back');
    lines=[front.slice(0,7), back.slice(0,7)];
  }
  else if(B.form==='ambush'){ lines=[icons.filter((_,i)=>i%2===0).slice(0,7), icons.filter((_,i)=>i%2===1).slice(0,7)]; }
  else { lines=[icons.slice(0,7), icons.slice(7,14)]; }
  return lines.filter(l=>l.length).map(l=>'<div>'+l.map(o=>o.e).join('')+'</div>').join('');"""))

edits.append(("""  const chip=k=>`<div class="fchip" draggable="true" data-type="${k}">${UNITS[k].emoji}<small>${sel[k]}</small></div>`;""",
"""  const chip=k=>`<div class="fchip" draggable="true" data-type="${k}">${battleFace(k)}<small>${sel[k]}</small></div>`;"""))

for i,(old,new) in enumerate(edits):
    c = s.count(old)
    if c != 1:
        raise SystemExit("edit %d failed, count=%d" % (i, c))
    s = s.replace(old, new)

open("gc2_fixed.js","w",encoding="utf-8").write(s)
print("rebuild OK, length", len(s))
