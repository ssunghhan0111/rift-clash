f_in = "antopia_v27.html"
f_out = "antopia_v28.html"
s = open(f_in, encoding="utf-8").read()

def one(old, new, s, expect=1):
    c = s.count(old)
    if c != expect:
        raise SystemExit("FAILED (count=%d, expected %d): %r" % (c, expect, old[:100]))
    return s.replace(old, new)

# ---------- PART A: physical Infirmary room + routing ----------

s = one(
"""  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom};""",
"""  const armory={x:Math.max(6,barracks.x-rrw-10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  const towerRoom={x:Math.min(W-rrw-6,barracks.x+barracks.w+10), y:barracks.y+barracks.h-rrh, w:rrw, h:rrh};
  // Infirmary: a small ward tucked just above the Nursery — wounded fighters rest here until healed
  const iw=Math.min(96,sw*0.72), ih=Math.min(54,sh*0.6);
  const infirmary={x:nursery.x+(nursery.w-iw)/2, y:Math.max(gy+30,nursery.y-ih-10), w:iw, h:ih};
  LAY={gy,throne,nursery,granary,barracks,armory,towerRoom,infirmary};""", s)

s = one(
"""    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
  };""",
"""    barracks: cubic(thBC, {x:W*0.5-40,y:(throne.y+throne.h+barracks.y)/2}, {x:W*0.5+40,y:barracks.y-8}, {x:barracks.x+barracks.w/2, y:barracks.y+12}, 12),
    infirmary: cubic(thBL, {x:W*0.30,y:H*0.50}, {x:W*0.05,y:H*0.38}, {x:infirmary.x+infirmary.w*0.5, y:infirmary.y+infirmary.h-8}, 14),
  };""", s)

s = one(
"""  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks']){
    strokePath(PATHS[key], 24, '#2b1a0f', 0.45);
  }
  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks']){
    strokePath(PATHS[key], 14, '#54331c', 0.5);
  }""",
"""  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks','infirmary']){
    strokePath(PATHS[key], 24, '#2b1a0f', 0.45);
  }
  for(const key of ['surface','surfaceB','surfaceC','nursery','granary','barracks','infirmary']){
    strokePath(PATHS[key], 14, '#54331c', 0.5);
  }""", s)

s = one(
"""  drawExpansionRoom(LAY.armory,'armory',S.rooms.armory,'🏮');
  drawExpansionRoom(LAY.towerRoom,'tower',S.rooms.tower,'🗼');""",
"""  drawExpansionRoom(LAY.armory,'armory',S.rooms.armory,'🏮');
  drawExpansionRoom(LAY.towerRoom,'tower',S.rooms.tower,'🗼');
  drawExpansionRoom(LAY.infirmary,'infirmary',S.rooms.infirmary,'💊');""", s)

s = one(
"""  for(const key of ['throne','nursery','granary','barracks']){""",
"""  for(const key of ['throne','nursery','granary','barracks','infirmary']){""", s)

s = one(
"""    const wounded=UNITS[a.type].combat && (S.wounded[a.type]??100)<99.5;
    const opts=S.research?['barracks','barracks','barracks','throne']
                         :wounded?['nursery','nursery','nursery','throne']
                         :['throne','barracks','barracks','surface','granary','nursery'];""",
"""    const wounded=UNITS[a.type].combat && (S.wounded[a.type]??100)<99.5;
    const healRoom=S.rooms.infirmary>=1?'infirmary':'nursery';
    const opts=S.research?['barracks','barracks','barracks','throne']
                         :wounded?[healRoom,healRoom,healRoom,'throne']
                         :['throne','barracks','barracks','surface','granary','nursery'];""", s)

# show each resting ant's real current/max HP over its head while it's in the Infirmary
s = one(
"""  if(wounded){
    ctx.globalAlpha=1;
    ctx.fillStyle='#ff5c5c'; ctx.beginPath(); ctx.arc(-2,wob-8,2.2,0,6.28); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(-3.2,wob-8); ctx.lineTo(-0.8,wob-8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2,wob-9.2); ctx.lineTo(-2,wob-6.8); ctx.stroke();
  }
  ctx.restore();
}
function shade(hex,amt){""",
"""  if(wounded){
    ctx.globalAlpha=1;
    ctx.fillStyle='#ff5c5c'; ctx.beginPath(); ctx.arc(-2,wob-8,2.2,0,6.28); ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(-3.2,wob-8); ctx.lineTo(-0.8,wob-8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2,wob-9.2); ctx.lineTo(-2,wob-6.8); ctx.stroke();
    if(a.room==='infirmary'){
      const curHp=Math.max(1,Math.round(u.hp*woundPct/100));
      ctx.font='700 8px Trebuchet MS'; ctx.fillStyle='#ffd7a8'; ctx.textAlign='center';
      ctx.fillText(curHp+'/'+u.hp+' hp', 0, wob-14);
    }
  }
  ctx.restore();
}
function shade(hex,amt){""", s)

# ---------- PART B: real vector ant bodies + gear in battle ----------

drawBattleAntBody = """
// Every battle fighter is a real drawn ant (legs, thorax, head, antennae), not a flat emoji —
// each type carries its own gear so its role reads at a glance: the Soldier literally swings a sword.
function drawBattleAntBody(u,t){
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
"""

old_dbu_head = "function drawBattleUnit(u,dt){"
assert s.count(old_dbu_head) == 1
s = s.replace(old_dbu_head, drawBattleAntBody + "\n" + old_dbu_head)

# Remove the redundant flat colour-tint disc and swap emoji-fillText for the real vector body
old_render = """  if(u.alive&&!u.structure&&UNITS[u.type]){
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
  bctx.restore();"""

new_render = """  if(u.alive&&!u.structure&&UNITS[u.type]){
    // ambient skill flair layered behind the ant body, so the battlefield reads at a glance
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
    } else if(u.type==='siege'){
      bctx.fillStyle='rgba(154,138,106,0.35)';
      bctx.beginPath(); bctx.arc(-12,10,3+Math.sin(u._bobT*6)*1,0,6.28); bctx.fill();
    } else if(u.type==='monarch'||u.type==='wasp'){
      bctx.strokeStyle=u.type==='monarch'?'rgba(240,166,35,0.5)':'rgba(255,255,255,0.4)'; bctx.lineWidth=1;
      const wf=Math.sin(u._bobT*(u.type==='wasp'?24:12));
      bctx.beginPath(); bctx.ellipse(-6*Math.sign(wf||1),-2,7,3,wf*0.4,0,6.28); bctx.stroke();
      bctx.beginPath(); bctx.ellipse(6*Math.sign(wf||1),-2,7,3,-wf*0.4,0,6.28); bctx.stroke();
    }
  }
  if(!u.structure&&UNITS[u.type]){
    drawBattleAntBody(u,t);
  } else {
    bctx.font=(u.isBoss?'40px':u.structure?'30px':'26px')+' sans-serif'; bctx.textAlign='center';
    bctx.fillText(u.face||(UNITS[u.type]?UNITS[u.type].emoji:'🐜'), 0, 0);
  }
  if(u.stunT>0){ bctx.font='16px sans-serif'; bctx.fillText('🕸️', 0, -14); }
  bctx.shadowBlur=0;
  bctx.restore();"""

s = one(old_render, new_render, s)

open(f_out, "w", encoding="utf-8").write(s)
print("ALL EDITS OK, length", len(s))
