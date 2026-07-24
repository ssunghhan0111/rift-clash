// RIFT CLASH — HUD / UI
window.RC = window.RC || {};

RC.UI = (function () {
  let g, el = {};

  function init(game) {
    g = game;
    el.shard = document.getElementById('res-shard');
    el.pop = document.getElementById('res-pop');
    el.clock = document.getElementById('res-clock');
    el.wave = document.getElementById('res-wave');
    el.waveBox = document.getElementById('wave-box');
    el.selName = document.getElementById('sel-name');
    el.selInfo = document.getElementById('sel-info');
    el.selStats = document.getElementById('sel-stats');
    el.portrait = document.getElementById('portrait');
    el.portraitWrap = document.getElementById('portrait-wrap');
    el.cmds = document.getElementById('cmd-grid');
    el.queue = document.getElementById('queue-row');
    el.toast = document.getElementById('toast');
    el.overlay = document.getElementById('overlay');
    el.overlayText = document.getElementById('overlay-text');

    document.getElementById('btn-restart').addEventListener('click', () => {
      if (RC.online) { RC.NetClient.send({ t: 'restart' }); return; }   // host returns everyone to lobby
      g.reset(); RC.AI.reset(); RC.Input.clampCam();
      el.overlay.classList.add('hidden');
    });

    initTouchbar();
  }

  // 터치용 툴바 — 키보드 단축키(P/S/F/Space/Esc/컨트롤그룹)를 버튼으로 대체
  function initTouchbar() {
    document.getElementById('tb-pause').addEventListener('click', () => { g.paused = !g.paused; });

    document.getElementById('tb-stop').addEventListener('click', () => {
      const ids = g.selection.filter(u => u.kind === 'unit' && u.owner === g.playerOwner).map(u => u.id);
      if (ids.length) RC.cmd(g, { t: 'stop', ids });
    });

    document.getElementById('tb-idle').addEventListener('click', () => {
      const idle = g.units.find(u => u.owner === g.playerOwner && u.def.worker && u.state === 'idle');
      if (idle) { g.selection = [idle]; RC.Input.centerOn(idle.x, idle.y); }
    });

    document.getElementById('tb-home').addEventListener('click', () => {
      const c = g.core(g.playerOwner);
      if (c) RC.Input.centerOn(c.x, c.y);
    });

    document.getElementById('tb-cancel').addEventListener('click', () => {
      g.placing = null; g.selection = [];
    });

    document.querySelectorAll('.tb-groups .grp').forEach(btn => {
      let timer = null, longPressed = false;
      const gid = btn.dataset.g;

      const start = e => {
        e.preventDefault();
        longPressed = false;
        timer = setTimeout(() => {
          longPressed = true;
          g.groups = g.groups || {};
          g.groups[gid] = g.selection.slice();
          btn.classList.add('assigned');
        }, 500);
      };
      const end = () => {
        clearTimeout(timer);
        if (!longPressed) {
          const grp = (g.groups || {})[gid];
          if (grp) g.selection = grp.filter(u => !u.dead);
        }
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', () => clearTimeout(timer));
    });
  }

  let lastSig = '';

  function update() {
    const me = g.playerOwner;
    if (!g.res[me]) return;                 // online: state not received yet
    const s = g.supply(me);
    el.shard.textContent = Math.floor(g.res[me].shard);
    el.pop.textContent = `${s.used} / ${s.max}`;
    el.pop.className = (s.used >= s.max) ? 'val warn' : 'val';
    const m = Math.floor(g.time / 60), sec = Math.floor(g.time % 60);
    el.clock.textContent = `${m}:${String(sec).padStart(2, '0')}`;

    // 생존 모드 — 웨이브 표시
    if (el.waveBox) {
      if (g.survival) { el.waveBox.style.display = ''; el.wave.textContent = g.survivalWave || 0; }
      else el.waveBox.style.display = 'none';
    }

    // 알림
    el.toast.innerHTML = g.log.map(l => `<div>${l.msg}</div>`).join('');

    // 선택 패널 — 내용이 바뀔 때만 다시 그림
    const sel = g.selection;
    const up = g.upgrades && g.upgrades[me] ? RC.UPGRADE_ORDER.map(k => g.upgrades[me][k]).join('') : '';
    const sig = sel.map(e => {
      let t = e.id + ':' + (e.queue ? e.queue.length : 0) + ':' + Math.round(e.buildProgress * 20 || 0);
      if (e.kind === 'unit' && e.def.ability) t += ':' + (e.canCast(g) ? 1 : 0);
      if (e.research) t += ':r' + Math.ceil(e.research.timeLeft);
      else if (e.kind === 'building' && e.def.research) t += ':r0';
      return t;
    }).join(',') + '|' + g.res[me].shard.toFixed(0) + '|' + s.used + '/' + s.max + '|' + up;
    if (sig !== lastSig) { lastSig = sig; renderPanel(sel); }
    renderQueue(sel);
    updatePortrait(sel);
  }

  // 선택 유닛 초상화 — 매 프레임 갱신(애니메이션). 여러 종류가 섞이면 무작위 한 기를 보여줌.
  let portraitUnit = null, portraitTypes = '';
  function updatePortrait(sel) {
    if (!el.portraitWrap || !RC.Renderer.drawPortrait) return;
    const units = sel.filter(e => e.kind === 'unit' && !e.dead);
    if (!units.length) { el.portraitWrap.classList.add('hidden'); portraitUnit = null; portraitTypes = ''; return; }
    el.portraitWrap.classList.remove('hidden');
    const types = [...new Set(units.map(u => u.type))].sort().join(',');
    // 선택 구성이 바뀌었거나 대상이 사라졌을 때만 다시 고른다(깜빡임 방지)
    if (types !== portraitTypes || !portraitUnit || portraitUnit.dead || units.indexOf(portraitUnit) < 0) {
      portraitTypes = types;
      portraitUnit = units[(Math.random() * units.length) | 0];
    }
    RC.Renderer.drawPortrait(el.portrait, portraitUnit);
  }

  function renderPanel(sel) {
    if (!sel.length) {
      el.selName.textContent = 'Nothing selected';
      el.selInfo.textContent = 'Click or drag to select units.';
      el.selStats.innerHTML = '';
      el.cmds.innerHTML = '';
      return;
    }

    if (sel.length > 1) {
      const counts = {};
      sel.forEach(e => {
        const n = e.def.name;
        counts[n] = (counts[n] || 0) + 1;
      });
      el.selName.textContent = `${sel.length} selected`;
      el.selInfo.textContent = Object.entries(counts).map(([n, c]) => `${n} ×${c}`).join(' · ');
      el.selStats.innerHTML = '';
      el.cmds.innerHTML = '';
      const w = sel.filter(e => e.kind === 'unit' && e.def.worker);
      if (w.length) buildButtons();
      // 선택 안에 있는 유닛 종류별 스킬 버튼 (같은 종류 전부에게 시전)
      const byAbility = {};
      sel.forEach(e => {
        if (e.kind === 'unit' && e.owner === g.playerOwner && e.def.ability) {
          (byAbility[e.def.ability.id] = byAbility[e.def.ability.id] || []).push(e);
        }
      });
      Object.values(byAbility).forEach(list => {
        const ready = list.some(u => u.canCast(g));
        const ab = list[0].def.ability;
        abilityBtn(ab, ready, () => RC.cmd(g, { t: 'cast', ids: list.map(u => u.id), key: ab.key.toLowerCase() }));
      });
      return;
    }

    const e = sel[0];
    el.selName.textContent = e.def.name;
    el.selInfo.textContent = e.def.desc || '';
    const rows = [];
    rows.push(['Health', `${Math.ceil(e.hp)} / ${e.maxHp}`]);
    if (e.kind === 'unit') {
      const atk = e.effAtk ? Math.round(e.effAtk(g)) : e.def.dmg;
      rows.push(['Attack', atk]);
      rows.push(['Range', e.effRange ? e.effRange(g) : e.def.range]);
      const arm = e.effArmor ? e.effArmor(g) : (e.def.armor || 0);
      if (arm) rows.push(['Armor', arm]);
      if (e.maxEnergy) rows.push(['Energy', `${Math.floor(e.energy)} / ${Math.floor(e.effMaxEnergy(g))}`]);
      if (e.def.transport) rows.push(['Cargo', `${e.cargo ? e.cargo.length : 0} / ${e.def.transport}`]);
      rows.push(['State', stateName(e)]);
    } else if (!e.done) {
      rows.push(['Building', `${Math.floor(e.buildProgress * 100)}%`]);
      if (e.research) rows.push(['Researching', RC.UPGRADES[e.research.kind].name]);
    } else if (e.research) {
      rows.push(['Researching', `${RC.UPGRADES[e.research.kind].name} (${Math.ceil(e.research.timeLeft)}s)`]);
    }
    el.selStats.innerHTML = rows.map(([k, v]) =>
      `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');

    el.cmds.innerHTML = '';
    const me = g.playerOwner;
    if (e.owner !== me) return;
    if (e.kind === 'building' && e.done) {
      e.def.produces.forEach(t => {
        const d = RC.UNITS[t];
        addBtn(d.name, d.key, `${d.cost} shards · pop ${d.supply}`, g.canAfford(me, d.cost),
               () => RC.cmd(g, { t: 'train', bid: e.id, ut: t }), unitTip(d));
      });
      // research building — upgrade buttons
      if (e.def.research) {
        RC.UPGRADE_ORDER.forEach(kind => {
          const u = RC.UPGRADES[kind];
          const lvl = g.upLevel(me, kind);
          const maxed = lvl >= u.costs.length;
          const cost = maxed ? 0 : u.costs[lvl];
          const busy = !!e.research;
          const label = `${u.name} ${maxed ? 'MAX' : 'Tier ' + (lvl + 1)}`;
          const sub = maxed ? u.desc : `${cost} shards · ${u.time[lvl]}s`;
          addBtn(label, '', sub, !maxed && !busy && g.canAfford(me, cost),
                 () => RC.cmd(g, { t: 'research', bid: e.id, k: kind }), `${u.name} — ${u.desc}`);
        });
      }
    } else if (e.kind === 'building' && !e.done) {
      // unfinished building — cancel construction (full refund)
      addBtn('Cancel', '', 'Refund & stop building', true,
             () => { RC.cmd(g, { t: 'cancelBuild', bid: e.id }); g.selection = []; },
             'Cancel construction and refund the full cost.');
    } else if (e.kind === 'unit' && e.def.worker) {
      buildButtons();
    }

    // unit ability button
    if (e.kind === 'unit' && e.def.ability) {
      abilityBtn(e.def.ability, e.canCast(g), () => RC.cmd(g, { t: 'cast', ids: [e.id], key: e.def.ability.key.toLowerCase() }));
    }
  }

  // 스킬 버튼 — 에너지/쿨다운 반영
  function abilityBtn(ab, ready, fn) {
    const b = document.createElement('button');
    b.className = 'cmd ability' + (ready ? '' : ' off');
    b.innerHTML = `<kbd>${ab.key}</kbd><span class="l">✦ ${ab.name}</span>` +
                  `<span class="s">Energy ${ab.cost} · CD ${ab.cd}s</span>`;
    b.title = `${ab.name} — ${ab.desc || ''} (Energy ${ab.cost}, cooldown ${ab.cd}s)`;
    b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
    el.cmds.appendChild(b);
  }

  // 툴팁 문구 — 유닛/건물의 핵심 스탯 + 설명
  function unitTip(d) {
    const bits = [`HP ${d.hp}`];
    if (d.dmg) bits.push(`ATK ${d.dmg}`);
    if (d.range > 20) bits.push(`RNG ${d.range}`);
    if (d.armor) bits.push(`ARM ${d.armor}`);
    if (d.regen) bits.push(`regen ${d.regen}/s`);
    if (d.acid) bits.push('applies acid');
    return `${d.name} — ${d.desc}\n[${bits.join(' · ')}] · ${d.cost} shards · pop ${d.supply}`;
  }
  function bldTip(d) {
    return `${d.name} — ${d.desc}\n${d.cost ? d.cost + ' shards' : 'free'}${d.supplyGiven ? ' · +' + d.supplyGiven + ' pop' : ''}`;
  }

  function buildButtons() {
    const me = g.playerOwner;
    const list = (g.buildableFor ? g.buildableFor(me) : null) || RC.BUILDABLE || ['cell', 'factory'];
    list.forEach(t => {
      const d = RC.BUILDINGS[t];
      addBtn(d.name, d.key, `${d.cost} shards`, g.canAfford(me, d.cost), () => { g.placing = t; }, bldTip(d));
    });
  }

  function addBtn(label, key, sub, enabled, fn, title) {
    const b = document.createElement('button');
    if (title) b.title = title;
    b.className = 'cmd' + (enabled ? '' : ' off');
    b.innerHTML = `<kbd>${key}</kbd><span class="l">${label}</span><span class="s">${sub}</span>`;
    b.addEventListener('click', ev => { ev.stopPropagation(); fn(); });
    el.cmds.appendChild(b);
  }

  function renderQueue(sel) {
    const b = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
    if (!b || !b.queue.length) { el.queue.innerHTML = ''; return; }
    el.queue.innerHTML = b.queue.map((j, i) => {
      const pct = i === 0 ? Math.floor((1 - j.timeLeft / j.total) * 100) : 0;
      return `<div class="qslot" data-i="${i}" title="Click to cancel"><span>${RC.UNITS[j.type].name}</span>
              <i style="width:${pct}%"></i></div>`;
    }).join('');
    // 대기열 슬롯 클릭 = 해당 생산 취소 (환불)
    el.queue.querySelectorAll('.qslot').forEach(slot => {
      slot.addEventListener('click', ev => {
        ev.stopPropagation();
        RC.cmd(g, { t: 'cancelQueue', bid: b.id, i: parseInt(slot.dataset.i, 10) });
      });
    });
  }

  function stateName(u) {
    return ({
      idle: 'Idle', move: 'Moving', attack: 'Fighting',
      toNode: 'Heading to mine', gather: 'Mining',
      toDrop: 'Returning shards', build: 'Building', toBoard: 'Boarding',
    })[u.state] || u.state;
  }

  function showOverlay(kind) {
    if (g.survival) {
      const dn = (RC.Survival && RC.Survival.diffName) ? RC.Survival.diffName(g.survivalDiff) : '';
      el.overlayText.innerHTML =
        `<b class="lose">CRYSTAL SHATTERED</b><span>You held out for ${g.survivalWave || 0} waves${dn ? ' on ' + dn : ''}.</span>`;
    } else {
      el.overlayText.innerHTML = kind === 'win'
        ? '<b class="win">VICTORY</b><span>Enemy core destroyed.</span>'
        : '<b class="lose">DEFEAT</b><span>Your core has fallen.</span>';
    }
    el.overlay.classList.remove('hidden');
  }

  return { init, update, showOverlay };
})();
