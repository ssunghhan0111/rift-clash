import re
f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """  const wob=Math.sin(t*10+a.wob)*0.6;
  const col=u.color, col2=shade(u.color,18);
  if(a.type==='guard'&&(u.shield+shieldBonus())>0){
    ctx.fillStyle='rgba(120,200,255,0.18)'; ctx.strokeStyle='rgba(150,220,255,0.5)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(-2,wob,13*s,0,6.28); ctx.fill(); ctx.stroke();
  }"""

new = """  const wob=Math.sin(t*10+a.wob)*0.6;
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
  }"""

assert s.count(old) == 1, "old block not found or not unique: %d" % s.count(old)
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("edit1 OK")
