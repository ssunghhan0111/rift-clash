f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

old = """function startBattlePage(cfg){
  const rows={}; FIGHTERS.forEach(k=>{ rows[k]=defaultRow(k); });
  B={...cfg, tactic:'balanced', tacticTicks:0, over:false, tickN:0, phase:'prep', form:'line', meUnits:[], enUnits:[], rows};"""

new = """function startBattlePage(cfg){
  const rows={}; FIGHTERS.forEach(k=>{ rows[k]=defaultRow(k); });
  B={...cfg, tactic:'balanced', tacticTicks:0, over:false, tickN:0, phase:'prep', form:'line', meUnits:[], enUnits:[], rows, prepMax:10, prepT:10};"""

assert s.count(old) == 1
s = s.replace(old, new)

old2 = """  if(B&&B.phase==='fight'){
    try{ battleRender(dt); }catch(e){ console.error('battleRender() error (frame skipped, game continues):', e); }
  }
  if(running) requestAnimationFrame(loop);
}"""

new2 = """  if(B&&B.phase==='fight'){
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
}"""

assert s.count(old2) == 1
s = s.replace(old2, new2)

open(f, "w", encoding="utf-8").write(s)
print("edit5 OK")
