let battleAnimT = 0;
const UNITS = {
  soldier:{color:'#b5462f'}, spitter:{color:'#5a9e3a'}, guard:{color:'#3f78c0'},
  medic:{color:'#e0688a', medic:true}, archer:{color:'#c9932f'}, siege:{color:'#8a7a5a'},
  zapper:{color:'#d9c22e', chain:true}, bomber:{color:'#7a3fb5'}, wasp:{color:'#d99a1e'}, monarch:{color:'#c04fb0', splash:true},
};
let callCount=0;
function makeCtx(){
  const noop=()=>callCount++;
  const handler={ get(t,p){ if(p in t) return t[p];
    if(['shadowColor','shadowBlur','globalAlpha','fillStyle','strokeStyle','lineWidth','lineCap','font','textAlign'].includes(p)) return t['_'+p];
    return function(){ callCount++; return undefined; }; },
    set(t,p,v){ t['_'+p]=v; return true; } };
  return new Proxy({}, handler);
}
global.bctx = makeCtx();
function drawBattleAntBody(u){
  const t=battleAnimT;
  const bt=UNITS[u.type]; if(!bt) return;
  const dir=u.side==='me'?1:-1;
  const col=bt.color, col2=shade(bt.color,18);
  const wobSeed=u._wob||(u._wob=Math.random()*6.28);
  const wob=Math.sin(t*10+wobSeed)*0.6;
  bctx.strokeStyle=col; bctx.lineWidth=1.8;
  for(let i=0;i<3;i++){ const lx=dir*(-4+i*5); const w=Math.sin(t*14+i+wobSeed)*2.2;
    bctx.beginPath();bctx.moveTo(lx,0);bctx.lineTo(lx-dir*3,6+w);bctx.stroke();
    bctx.beginPath();bctx.moveTo(lx,0);bctx.lineTo(lx-dir*3,-6-w);bctx.stroke();}
  bctx.fillStyle=col; bctx.beginPath(); bctx.ellipse(dir*-9,wob,7,5,0,0,6.28); bctx.fill();
  bctx.fillStyle=col2; bctx.beginPath(); bctx.ellipse(dir*-1,wob,4,3.4,0,0,6.28); bctx.fill();
  bctx.fillStyle=col; bctx.beginPath(); bctx.arc(dir*6,wob,4,0,6.28); bctx.fill();
  bctx.fillStyle='#fff'; bctx.beginPath(); bctx.arc(dir*8,wob-1,1.3,0,6.28); bctx.fill();
  bctx.fillStyle='#000'; bctx.beginPath(); bctx.arc(dir*8.4,wob-1,0.7,0,6.28); bctx.fill();
  bctx.strokeStyle=col; bctx.lineWidth=1;
  bctx.beginPath();bctx.moveTo(dir*9,wob-2);bctx.lineTo(dir*13,wob-6);bctx.stroke();
  bctx.beginPath();bctx.moveTo(dir*9,wob+2);bctx.lineTo(dir*13,wob-3);bctx.stroke();
  if(u.type==='soldier'){
    // an actual sword — blade, crossguard and pommel, held forward with an occasional glint
    bctx.strokeStyle='#e8e8ec'; bctx.lineWidth=2; bctx.lineCap='round';
    bctx.beginPath(); bctx.moveTo(dir*10,wob-1); bctx.lineTo(dir*21,wob-7); bctx.stroke();
    bctx.strokeStyle='#9a8358'; bctx.lineWidth=2.4; bctx.lineCap='round';
    bctx.beginPath(); bctx.moveTo(dir*8.5,wob-3); bctx.lineTo(dir*8.5,wob+1); bctx.stroke();
    bctx.fillStyle='#7a6a48'; bctx.beginPath(); bctx.arc(dir*8,wob-1,1,0,6.28); bctx.fill();
    if(Math.sin(t*3+wobSeed)>0.8){
      bctx.strokeStyle='#fff'; bctx.lineWidth=1; bctx.globalAlpha=0.85;
      bctx.beginPath(); bctx.moveTo(dir*14,wob-4); bctx.lineTo(dir*17,wob-5.5); bctx.stroke(); bctx.globalAlpha=1;
    }
  } else if(u.type==='spitter'){
    bctx.fillStyle='#aef27a'; bctx.beginPath(); bctx.arc(dir*13,wob,2.4,0,6.28); bctx.fill();
    const dp=(t*1.6+wobSeed)%1;
    bctx.fillStyle='rgba(174,242,122,'+(1-dp)*0.8+')';
    bctx.beginPath(); bctx.arc(dir*13,wob+dp*7,1.3*(1-dp*0.4),0,6.28); bctx.fill();
  } else if(u.type==='guard'){
    bctx.fillStyle='#bcd8ff'; bctx.strokeStyle='#3f78c0'; bctx.lineWidth=1.4;
    bctx.beginPath(); bctx.ellipse(dir*11,wob,3.2,5.6,0,0,6.28); bctx.fill(); bctx.stroke();
    bctx.strokeStyle='#5f8fce'; bctx.lineWidth=0.8;
    bctx.beginPath(); bctx.moveTo(dir*11,wob-5.6); bctx.lineTo(dir*11,wob+5.6); bctx.stroke();
  } else if(u.type==='medic'){
    bctx.fillStyle='#fff'; bctx.beginPath(); bctx.arc(dir*-2,wob-7,3,0,6.28); bctx.fill();
    bctx.strokeStyle='#e05252'; bctx.lineWidth=1.4;
    bctx.beginPath(); bctx.moveTo(dir*-3.6,wob-7); bctx.lineTo(dir*-0.4,wob-7); bctx.stroke();
    bctx.beginPath(); bctx.moveTo(dir*-2,wob-8.6); bctx.lineTo(dir*-2,wob-5.4); bctx.stroke();
  } else if(u.type==='siege'){
    bctx.fillStyle='#9a8a6a'; bctx.strokeStyle='#6a5a3a'; bctx.lineWidth=1;
    bctx.save(); bctx.translate(dir*-13,wob-6+Math.abs(Math.sin(t*6+wobSeed))*-1.5);
    bctx.beginPath(); bctx.arc(0,0,5,0,6.28); bctx.fill(); bctx.stroke();
    bctx.strokeStyle='#4a3f2a'; bctx.lineWidth=0.8;
    bctx.beginPath(); bctx.arc(-1.5,-1.5,1.6,0,6.28); bctx.stroke();
    bctx.restore();
  } else if(u.type==='zapper'){
    bctx.strokeStyle='#ffe27a'; bctx.lineWidth=1.4;
    bctx.beginPath(); bctx.moveTo(dir*-2,wob-9); bctx.lineTo(dir*1,wob-6); bctx.lineTo(dir*-1,wob-5); bctx.lineTo(dir*2,wob-2); bctx.stroke();
  } else if(u.type==='archer'){
    bctx.strokeStyle='#c9932f'; bctx.lineWidth=1.3;
    bctx.beginPath(); bctx.arc(dir*10,wob,5,dir>0?-1.1:Math.PI-1.1,dir>0?1.1:Math.PI+1.1); bctx.stroke();
    bctx.strokeStyle='rgba(255,255,255,0.8)'; bctx.lineWidth=0.7;
    bctx.beginPath(); bctx.moveTo(dir*10+Math.cos(-1.1)*5*dir,wob+Math.sin(-1.1)*5);
    bctx.lineTo(dir*10+Math.cos(1.1)*5*dir,wob+Math.sin(1.1)*5); bctx.stroke();
  } else if(u.type==='bomber'){
    const fuse=(Math.sin(t*10+wobSeed)+1)/2;
    bctx.fillStyle='#2b1a2b'; bctx.beginPath(); bctx.arc(dir*-3,wob+6,4.6,0,6.28); bctx.fill();
    bctx.strokeStyle='#7a3fb5'; bctx.lineWidth=0.8;
    bctx.beginPath(); bctx.moveTo(dir*-3,wob+2); bctx.lineTo(dir*-1,wob-1); bctx.stroke();
    bctx.fillStyle='rgba(255,210,120,'+(0.5+fuse*0.5)+')';
    bctx.beginPath(); bctx.arc(dir*-1,wob-1,1.4+fuse,0,6.28); bctx.fill();
  }
}

function drawBattleUnit(u,dt){
  u._bobT=(u._bobT||Math.random()*6.28)+dt*(u.flying?4:0);
  u._wob=u._wob||Math.random()*6.28;
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
    // ambient skill flair layered behind the ant body, so the battlefield reads at a glance
    const bt=UNITS[u.type];
    if(bt.chain){
      bctx.strokeStyle='#ffe985'; bctx.lineWidth=1;
      for(let i=0;i<3;i++){ const ang=(battleAnimT+u._wob)*4+i*2.1;
        bctx.globalAlpha=0.5+Math.sin((battleAnimT+u._wob)*7+i)*0.35;
        bctx.beginPath(); bctx.moveTo(Math.cos(ang)*13,Math.sin(ang)*9); bctx.lineTo(Math.cos(ang)*17,Math.sin(ang)*12); bctx.stroke(); }
      bctx.globalAlpha=1;
    } else if(bt.medic){
      const hp=0.25+((Math.sin((battleAnimT+u._wob)*2)+1)/2)*0.35;
      bctx.strokeStyle='rgba(255,140,170,'+hp+')'; bctx.lineWidth=1.3;
      bctx.beginPath(); bctx.arc(0,0,15+Math.sin((battleAnimT+u._wob)*2)*1.5,0,6.28); bctx.stroke();
    } else if(u.type==='guard'){
      bctx.strokeStyle='rgba(150,220,255,0.55)'; bctx.fillStyle='rgba(120,200,255,0.12)'; bctx.lineWidth=1;
      bctx.beginPath(); bctx.arc(0,0,16,0,6.28); bctx.fill(); bctx.stroke();
    } else if(u.type==='siege'){
      bctx.fillStyle='rgba(154,138,106,0.35)';
      bctx.beginPath(); bctx.arc(-12,10,3+Math.sin((battleAnimT+u._wob)*6)*1,0,6.28); bctx.fill();
    } else if(u.type==='monarch'||u.type==='wasp'){
      bctx.strokeStyle=u.type==='monarch'?'rgba(240,166,35,0.5)':'rgba(255,255,255,0.4)'; bctx.lineWidth=1;
      const wf=Math.sin((battleAnimT+u._wob)*(u.type==='wasp'?24:12));
      bctx.beginPath(); bctx.ellipse(-6*Math.sign(wf||1),-2,7,3,wf*0.4,0,6.28); bctx.stroke();
      bctx.beginPath(); bctx.ellipse(6*Math.sign(wf||1),-2,7,3,-wf*0.4,0,6.28); bctx.stroke();
    }
  }
  if(!u.structure&&UNITS[u.type]){
    drawBattleAntBody(u);
  } else {
    bctx.font=(u.isBoss?'40px':u.structure?'30px':'26px')+' sans-serif'; bctx.textAlign='center';
    bctx.fillText(u.face||(UNITS[u.type]?UNITS[u.type].emoji:'🐜'), 0, 0);
  }
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

function shade(hex,amt){
  const n=parseInt(hex.slice(1),16); let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt;
  r=Math.min(255,r);g=Math.min(255,g);b=Math.min(255,b);
  return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0');
}
const types=['soldier','spitter','guard','medic','archer','siege','zapper','bomber','wasp','monarch'];
let errors=0;
for(const type of types){
  for(const side of ['me','en']){
    for(let frame=0; frame<20; frame++){
      battleAnimT += 0.05;
      const u = {
        type, side, x:100, y:100, hp: frame<15?10:0, maxHp:10, groupSize: frame%7===0?3:1,
        alive: frame<15, deathT: frame<15?undefined:0.5, atkT: frame%5===0?0.2:0, flashT: frame%6===0?0.1:0,
        critFx: frame%9===0?0.2:0, structure:false, ranged:(type==='spitter'||type==='archer'||type==='siege'||type==='zapper'),
        flying:(type==='wasp'||type==='monarch'), medic:type==='medic', movingT: frame%3===0?0.1:0, stunT: frame%11===0?0.2:0,
      };
      try{ drawBattleUnit(u, 0.05); }
      catch(e){ errors++; console.log('ERROR', type, side, frame, ':', e.message); }
    }
  }
}
// also exercise the enemy/structure fallback path
try{ drawBattleUnit({type:'enemy', side:'en', x:1,y:1, hp:5,maxHp:5,alive:true,groupSize:1, structure:false, face:'🪲'}, 0.05); }
catch(e){ errors++; console.log('ERROR enemy:', e.message); }
try{ drawBattleUnit({type:'trap', side:'me', x:1,y:1, hp:5,maxHp:5,alive:true,groupSize:1, structure:true, face:'🵸'}, 0.05); }
catch(e){ errors++; console.log('ERROR structure:', e.message); }

console.log(errors===0 ? 'ALL OK, calls: '+callCount : errors+' ERRORS');
