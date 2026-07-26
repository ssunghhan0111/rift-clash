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