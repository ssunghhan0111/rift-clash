f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """  bctx.font=(u.isBoss?'40px':u.structure?'30px':'26px')+' sans-serif'; bctx.textAlign='center';
  bctx.fillText(u.face||(UNITS[u.type]?UNITS[u.type].emoji:'🐜'), 0, 0);
  if(u.stunT>0){ bctx.font='16px sans-serif'; bctx.fillText('🕸️', 0, -14); }
  bctx.shadowBlur=0;
  bctx.restore();"""

new = """  if(u.alive&&!u.structure&&UNITS[u.type]){
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

assert s.count(old) == 1, "old block3 not found: %d" % s.count(old)
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("edit3 OK")
