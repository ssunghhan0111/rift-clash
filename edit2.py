f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """  if(a.type==='soldier'){
    ctx.strokeStyle='#eaeaea'; ctx.lineWidth=1.8;
    ctx.beginPath();ctx.moveTo(9*s,wob-2);ctx.lineTo(15*s,wob-5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(9*s,wob+2);ctx.lineTo(15*s,wob+5);ctx.stroke();
  } else if(a.type==='spitter'){
    ctx.fillStyle='#aef27a'; ctx.beginPath(); ctx.arc(13*s,wob,2.4,0,6.28); ctx.fill();
  } else if(a.type==='guard'){
    ctx.fillStyle='#bcd8ff'; ctx.strokeStyle='#5f8fce'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(11*s,wob,2.5,4.5,0,0,6.28); ctx.fill(); ctx.stroke();
  } else if(a.type==='medic'){
    ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(-2,wob-7,3,0,6.28); ctx.fill();
    ctx.strokeStyle='#e05252'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-3.6,wob-7); ctx.lineTo(-0.4,wob-7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2,wob-8.6); ctx.lineTo(-2,wob-5.4); ctx.stroke();
  } else if(a.type==='siege'){
    ctx.fillStyle='#9a8a6a'; ctx.strokeStyle='#6a5a3a'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(-9*s,wob-6,4,0,6.28); ctx.fill(); ctx.stroke();
  } else if(a.type==='zapper'){
    ctx.strokeStyle='#ffe27a'; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-2,wob-9); ctx.lineTo(1,wob-6); ctx.lineTo(-1,wob-5); ctx.lineTo(2,wob-2); ctx.stroke();
  } else if(a.type==='nurse'&&a.hasEgg){
    ctx.fillStyle='#fff6e0'; ctx.strokeStyle='#e8d3a8'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(12*s,wob-2,3.5,4.5,0,0,6.28); ctx.fill(); ctx.stroke();
  } else if(a.type==='worker'&&a.carry){
    ctx.fillStyle='#7ccf4a'; ctx.beginPath(); ctx.arc(11*s,wob-3,3,0,6.28); ctx.fill();
  }"""

new = """  if(a.type==='soldier'){
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
  }"""

assert s.count(old) == 1, "old block2 not found or not unique: %d" % s.count(old)
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("edit2 OK")
