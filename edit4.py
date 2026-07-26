f = "antopia_v24.html"
s = open(f, encoding="utf-8").read()

# 1) countdown UI + reset-on-interaction inside renderPrep/renderFormationDeploy
old = """function renderPrep(){
  const C=el('bpCmds');
  const clsMap={line:'retreat', wedge:'charge', turtle:'wall', ambush:'cry'};
  C.innerHTML='<div style="grid-column:1/-1; text-align:center; font-weight:800; font-size:12px; color:#ffd7a8">🐜 Choose your formation</div>'+
    Object.keys(FORMS).map(k=>
      `<button class="cmd ${clsMap[k]} ${B.form===k?'active':''}" data-form="${k}">${FORMS[k].name}<small>${FORMS[k].sub}</small></button>`
    ).join('');
  C.querySelectorAll('[data-form]').forEach(b=>b.onclick=()=>{ B.form=b.dataset.form; renderPrep(); });
  const ch=el('bpChoices');
  ch.innerHTML=`<button class="btn red" id="beginBtn" style="font-size:15px; padding:12px">⚔️ Begin Battle!</button>`+
    (B.canCancel?'<button class="btn ghost" id="cancelBtn">↩️ Fall back (no losses)</button>':'');
  el('beginBtn').onclick=beginBattle;
  if(B.canCancel) el('cancelBtn').onclick=()=>{ closeBattlePage(); if(panelOpen==='map') renderPanel(); };
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
    c.addEventListener('dragstart',e=>{ dragType=c.dataset.type; e.dataTransfer&&e.dataTransfer.setData('text/plain',dragType); });
    // touch devices can't drag-and-drop with HTML5 DnD — tapping a chip flips its row instead
    c.addEventListener('click',()=>{
      const k=c.dataset.type;
      B.rows[k]=(B.rows[k]||defaultRow(k))==='front'?'back':'front';
      renderFormationDeploy();
    });
  });
  D.querySelectorAll('.drow').forEach(z=>{
    z.addEventListener('dragover',e=>{ e.preventDefault(); z.classList.add('dragover'); });
    z.addEventListener('dragleave',()=>z.classList.remove('dragover'));
    z.addEventListener('drop',e=>{
      e.preventDefault(); z.classList.remove('dragover');
      const t=dragType||(e.dataTransfer&&e.dataTransfer.getData('text/plain'));
      if(t){ B.rows[t]=z.dataset.row; renderFormationDeploy(); }
    });
  });
}"""

new = """function resetPrepTimer(){ if(B&&B.phase==='prep') B.prepT=B.prepMax||10; }
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
}"""

assert s.count(old) == 1, "prep block not found: %d" % s.count(old)
s = s.replace(old, new)
open(f, "w", encoding="utf-8").write(s)
print("edit4 OK")
