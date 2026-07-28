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
    el.dailyBox = document.getElementById('daily-box');
    el.daily = document.getElementById('res-daily');
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
    el.pauseBtn = document.getElementById('tb-pause');
    el.pausedTag = document.getElementById('paused-tag');
    el.gameMenu = document.getElementById('gamemenu');

    document.getElementById('btn-restart').addEventListener('click', () => restartMatch());

    initGameMenu();
    initTouchbar();
    syncPause();
  }

  // ── Restart / quit ────────────────────────────────
  // Shared by the end-of-match overlay and the ⏹ end-match dialog so the two can
  // never drift apart.
  function restartMatch() {
    if (RC.online) { RC.NetClient.send({ t: 'restart' }); return; }   // host returns everyone to lobby
    g.reset();
    // reset() cleared the wave log and the run token with it. A restarted Survival
    // run is a new run, so it opens a new one — otherwise the second run of a session
    // could never be posted to the world board.
    if (g.survival && RC.openRunToken) RC.openRunToken(g.daily ? 'daily' : (g.survivalDiff || 'medium'));
    if (RC.AI) RC.AI.reset();
    RC.Input.clampCam();
    g.paused = false;
    el.overlay.classList.add('hidden');
    syncPause();
  }
  function quitToMenu() {
    g.paused = false;
    syncPause();
    if (RC.openMenu) RC.openMenu();
  }

  // ── ⏹ End-match dialog ───────────────────────────
  // Opening it pauses the match (offline) so nobody is being overrun while they
  // read the buttons. Cancelling restores whatever the pause state was before.
  let gmWasPaused = false;
  function openGameMenu() {
    if (!el.gameMenu) return;
    gmWasPaused = !!g.paused;
    if (!RC.online) g.paused = true;
    const sub = document.getElementById('gm-sub');
    const restartBtn = document.getElementById('gm-restart');
    if (RC.online) {
      // Online, only the host can send everyone back to the lobby; anyone can leave.
      const host = !!RC.isHost;
      if (restartBtn) {
        restartBtn.disabled = !host;
        restartBtn.textContent = host ? '↻ Back to Lobby (everyone)' : '↻ Back to Lobby — host only';
      }
      if (sub) sub.textContent = 'Online matches keep running — the game is not paused.';
    } else {
      if (restartBtn) { restartBtn.disabled = false; restartBtn.textContent = '↻ Restart'; }
      if (sub) sub.textContent = 'The match is paused while you decide.';
    }
    el.gameMenu.classList.remove('hidden');
    syncPause();
  }
  function closeGameMenu(restorePause) {
    if (!el.gameMenu) return;
    el.gameMenu.classList.add('hidden');
    if (restorePause && !RC.online) g.paused = gmWasPaused;
    syncPause();
  }
  function initGameMenu() {
    const menuBtn = document.getElementById('tb-gamemenu');
    if (menuBtn) menuBtn.addEventListener('click', openGameMenu);
    const r = document.getElementById('gm-restart');
    if (r) r.addEventListener('click', () => { closeGameMenu(false); restartMatch(); });
    const q = document.getElementById('gm-quit');
    if (q) q.addEventListener('click', () => { closeGameMenu(false); quitToMenu(); });
    const c = document.getElementById('gm-cancel');
    if (c) c.addEventListener('click', () => closeGameMenu(true));
  }

  // ── Pause ─────────────────────────────────────────
  // One place decides what the button looks like, so the P key, the touch button
  // and the end-match dialog can never disagree about the state.
  function syncPause() {
    const online = !!RC.online;
    if (online) g.paused = false;              // the server never stops ticking
    const on = !!g.paused;
    if (el.pauseBtn) {
      el.pauseBtn.textContent = on ? '▶' : '⏸';
      el.pauseBtn.title = online ? 'Pause is offline-only' : (on ? 'Resume (P)' : 'Pause (P)');
      el.pauseBtn.classList.toggle('on', on);
      el.pauseBtn.disabled = online;
      el.pauseBtn.style.opacity = online ? '.4' : '';
    }
    if (el.pausedTag) el.pausedTag.classList.toggle('hidden', !on);
  }
  function togglePause() {
    if (RC.online) return;                     // no pausing a live server match
    g.paused = !g.paused;
    syncPause();
  }

  // ── 음성 채팅 버튼 ────────────────────────────────
  // 경기 중에는 이 버튼 하나가 전부다: 처음 누르면 마이크 권한을 받아 통화에 들어가고,
  // 그 다음부터는 음소거 토글. 통화를 완전히 끊는 건 로비 패널에서 한다.
  function initVoiceButton() {
    const btn = document.getElementById('tb-voice');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!RC.Voice) return;
      const st = RC.Voice.status();
      if (!st.joined) {
        if (!RC.online) { g.notify('🎤 Voice chat works in online matches.'); return; }
        btn.disabled = true;
        const okJoin = await RC.Voice.join();
        btn.disabled = false;
        if (!okJoin) g.notify('🎤 ' + (RC.Voice.status().error || 'Could not start voice chat.'));
        else g.notify('🎤 Voice on — the others can hear you.');
      } else {
        const on = RC.Voice.toggleMic();
        g.notify(on ? '🎤 Mic on' : '🔇 Mic muted');
      }
      syncVoice();
    });
    if (RC.Voice && RC.Voice.on) RC.Voice.on(syncVoice);
    syncVoice();
  }
  // 버튼 모양 + "지금 누가 말하고 있는지" 표시. 매 프레임 호출되어도 싸다.
  function syncVoice() {
    const btn = document.getElementById('tb-voice');
    const hud = document.getElementById('voice-hud');
    if (!btn || !RC.Voice) return;
    const st = RC.Voice.status();
    btn.classList.toggle('live', st.joined && st.micOn);
    btn.classList.toggle('muted', st.joined && !st.micOn);
    btn.textContent = (st.joined && !st.micOn) ? '🔇' : '🎤';
    btn.title = !RC.online ? 'Voice chat — online matches only'
              : !st.joined ? 'Turn on voice chat'
              : (st.micOn ? 'Mute your mic' : 'Unmute your mic');
    btn.style.opacity = RC.online ? '' : '.45';
    if (!hud) return;
    const rows = st.peers.filter(p => p.state !== 'closed');
    if (!st.joined || !rows.length) { hud.classList.add('hidden'); hud.innerHTML = ''; return; }
    hud.classList.remove('hidden');
    const blocked = st.needsGesture || rows.some(p => p.state === 'connected' && !p.playing);
    const tapNote = blocked ? '<div class="warn">👆 Tap the screen to hear voice</div>' : '';
    hud.innerHTML = tapNote + rows.map(p => {
      const trouble = RC.Voice.troubleWith ? RC.Voice.troubleWith(p) : '';
      return '<div class="' + (p.speaking ? 'talking' : (trouble ? 'warn' : '')) + '">' +
        (p.speaking ? '🔊 ' : (trouble ? '⚠ ' : '· ')) + esc(p.name) +
        (trouble ? ' — ' + esc(trouble) : '') + '</div>';
    }).join('');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── 전체화면 토글 ─────────────────────────────────
  // Two buttons, one state: ⛶ in the top bar during a match, and the one on the
  // start screen. Both reflect whatever the browser is actually doing, so Esc or
  // F11 keeps them honest.
  function initFullscreen() {
    if (!RC.Fullscreen) return;
    const btns = ['fs-btn', 'fs-btn2'].map(id => document.getElementById(id)).filter(Boolean);
    if (!btns.length) return;
    btns.forEach(b => b.addEventListener('click', () => { RC.Fullscreen.toggle(); syncFullscreen(); }));
    RC.Fullscreen.on(syncFullscreen);
    window.addEventListener('resize', syncFullscreen);
    syncFullscreen();
  }
  function syncFullscreen() {
    if (!RC.Fullscreen) return;
    const st = RC.Fullscreen.status();
    const big = document.getElementById('fs-btn');
    const small = document.getElementById('fs-btn2');
    // Nothing to toggle on a browser with no Fullscreen API (iPhone Safari), or in
    // a home-screen app that is already fullscreen — hide rather than lie.
    const useless = !st.supported || st.standalone;
    if (big) {
      big.classList.toggle('hidden', useless);
      big.classList.toggle('on', st.on);
      big.textContent = '⛶';
      big.title = st.on ? 'Leave fullscreen' : 'Fullscreen';
    }
    if (small) {
      small.classList.toggle('hidden', useless);
      small.classList.toggle('on', st.on);
      small.textContent = st.on ? '⛶ Leave fullscreen' : '⛶ Fullscreen';
      small.title = small.textContent;
    }
  }

  // 터치용 툴바 — 키보드 단축키(P/F/Space/Esc/컨트롤그룹)를 버튼으로 대체.
  // 유닛 정지(S)는 버튼에서 뺐다 — 키보드에는 그대로 남아 있다.
  function initTouchbar() {
    document.getElementById('tb-pause').addEventListener('click', togglePause);
    initVoiceButton();
    initFullscreen();

    document.getElementById('tb-idle').addEventListener('click', () => {
      const idle = g.units.find(u => u.owner === g.playerOwner && u.def.worker && u.state === 'idle');
      if (idle) { g.selection = [idle]; RC.Input.centerOn(idle.x, idle.y); }
    });

    document.getElementById('tb-home').addEventListener('click', () => {
      const c = g.core(g.playerOwner);
      if (c) RC.Input.centerOn(c.x, c.y);
    });

    const heroBtn = document.getElementById('tb-hero');
    if (heroBtn) heroBtn.addEventListener('click', () => {
      const hero = g.heroOf && g.heroOf[g.playerOwner];
      if (hero && !hero.dead) { g.selection = [hero]; if (!hero.downed) RC.Input.centerOn(hero.x, hero.y); }
    });

    const muteBtn = document.getElementById('mute-btn');
    const volSlider = document.getElementById('vol-slider');
    if (volSlider && RC.Audio && RC.Audio.getVolume) volSlider.value = Math.round(RC.Audio.getVolume() * 100);
    if (muteBtn) muteBtn.addEventListener('click', () => {
      if (!RC.Audio) return;
      RC.Audio.init(); RC.Audio.resume();
      muteBtn.textContent = RC.Audio.toggle() ? '🔊' : '🔇';
    });
    if (volSlider) volSlider.addEventListener('input', () => {
      if (!RC.Audio) return;
      RC.Audio.init(); RC.Audio.resume();
      RC.Audio.setVolume(volSlider.value / 100);
      if (muteBtn) muteBtn.textContent = RC.Audio.enabled ? '🔊' : '🔇';
    });

    const amoveBtn = document.getElementById('tb-amove');
    if (amoveBtn) amoveBtn.addEventListener('click', () => { if (RC.Input.armAttackMove) RC.Input.armAttackMove(); });

    document.getElementById('tb-cancel').addEventListener('click', () => {
      g.placing = null; g.selection = [];
    });

    document.querySelectorAll('.tb-groups .grp').forEach(btn => {
      let timer = null, longPressed = false, lastTap = 0;
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
          // Double-tap the same group → jump the camera to it. With one-finger
          // box-select this is the main way to travel without touching the map.
          const now = performance.now();
          if (now - lastTap < 400) { if (RC.Input.centerOnGroup) RC.Input.centerOnGroup(gid); lastTap = 0; }
          else lastTap = now;
        }
      };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointerleave', () => clearTimeout(timer));
    });
  }

  let lastSig = '';

  function update() {
    // 일시정지 표시는 매 프레임 맞춘다 — P 키로 바꿔도 버튼이 따라온다
    syncPause();
    syncVoice();
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
    // 데일리 챌린지 — 오늘의 변형을 HUD에 계속 띄워 둔다 (뭘 대비해야 하는지 잊지 않도록)
    if (el.dailyBox) {
      if (g.daily) { el.dailyBox.style.display = ''; el.daily.textContent = g.daily.icon + ' ' + g.daily.name; }
      else el.dailyBox.style.display = 'none';
    }

    // 캠페인 미션 — 목표 추적기 (desc는 정적 설정 텍스트라 안전)
    const mhud = document.getElementById('mission-hud');
    if (mhud) {
      if (g.mission && !g.over) {
        mhud.classList.remove('hidden');
        const nm = document.getElementById('mh-name');
        if (nm) nm.textContent = (g.mission.def && g.mission.def.name) || 'Mission';
        const list = document.getElementById('mh-list');
        if (list) list.innerHTML = g.mission.objectives.map(o => {
          const cls = o.done ? ' done' : (o.fail ? ' fail' : '');
          const box = o.done ? '☑' : (o.fail ? '✖' : '☐');
          const prog = o.progress ? `<span class="mh-prog">${o.progress}</span>` : '';
          return `<div class="mh-obj${cls}"><span class="mh-box">${box}</span><span>${o.def.desc}</span>${prog}</div>`;
        }).join('');
      } else {
        mhud.classList.add('hidden');
      }
    }

    // 알림 — escape msg text (may include server-sent player names) before injecting
    el.toast.innerHTML = g.log.map(l =>
      `<div>${String(l.msg).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`).join('');

    // 선택 패널 — 내용이 바뀔 때만 다시 그림
    const sel = g.selection;
    const up = g.upgrades && g.upgrades[me] ? RC.UPGRADE_ORDER.map(k => g.upgrades[me][k]).join('') : '';
    const sig = sel.map(e => {
      let t = e.id + ':' + (e.queue ? e.queue.length : 0) + ':' + Math.round(e.buildProgress * 20 || 0);
      if (e.kind === 'unit' && e.def.ability) t += ':' + (e.canCast(g) ? 1 : 0);
      if (e.hero) t += ':H' + e.level + ':' + Math.floor(e.xp) + ':' + (e.downed ? 1 : 0) + ':' + Math.floor(g.time);
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
    rows.push(['Health', `${Math.ceil(e.hp)} / ${Math.round(e.maxHp)}`]);
    // 플라즈마 실드 (Aether) — 체력 바로 아래에 표시
    if (e.maxShield) rows.push(['Shield', `${Math.ceil(e.shield)} / ${Math.round(e.maxShield)}`]);
    if (e.kind === 'unit') {
      const atk = e.effAtk ? Math.round(e.effAtk(g)) : e.def.dmg;
      rows.push(['Attack', atk]);
      rows.push(['Range', Math.round(e.effRange ? e.effRange(g) : e.def.range)]);
      // 시야 — 이제 유닛마다 다르고, 이 거리 안에 적이 들어오면 알아서 교전한다
      rows.push(['Sight', Math.round(e.effSight ? e.effSight(g) : (e.def.sight || 0))]);
      const arm = e.effArmor ? e.effArmor(g) : (e.def.armor || 0);
      if (arm) rows.push(['Armor', arm]);
      if (e.maxEnergy) rows.push(['Energy', `${Math.floor(e.energy)} / ${Math.floor(e.effMaxEnergy(g))}`]);
      if (e.def.transport) rows.push(['Cargo', `${e.cargo ? e.cargo.length : 0} / ${e.def.transport}`]);
      if (e.hero) {
        rows.unshift(['Level', `${e.level}${e.level >= RC.HERO.maxLevel ? ' (MAX)' : ''}`]);
        if (e.level < RC.HERO.maxLevel) rows.push(['XP', `${Math.floor(e.xp)} / ${e.xpToNext()}`]);
      }
      // 서 있는 지형의 이점을 실시간으로 보여준다
      const tz = g.terrainAt ? g.terrainAt(e.x, e.y) : null;
      if (tz && tz.any && !e.def.flying) {
        const bio = RC.CFG.BIOMES[(g.mapDef && g.mapDef.biome) || 'earth'] || {};
        const names = ['high', 'low', 'forest', 'mud', 'vent']
          .filter(k => tz[k])
          .map(k => bio[k] || RC.CFG.TERRAIN[k].name);
        if (names.length) rows.push(['Terrain', names.join(' + ')]);
      }
      rows.push(['State', e.downed ? 'Reviving' : stateName(e)]);
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
    } else if (e.kind === 'unit' && e.def.hero) {
      heroSkills(e);
    }

    // unit ability button
    if (e.kind === 'unit' && e.def.ability) {
      abilityBtn(e.def.ability, e.canCast(g), () => RC.cmd(g, { t: 'cast', ids: [e.id], key: e.def.ability.key.toLowerCase() }));
    }
  }

  // 영웅 스킬 3개 버튼 (미습득=잠김, 부활 중=카운트다운)
  function heroSkills(h) {
    if (h.downed) {
      const b = document.createElement('div');
      b.className = 'cmd off';
      b.innerHTML = `<span class="l">Reviving…</span><span class="s">${Math.ceil(h.reviveT)}s · −${h.reviveCost} shards</span>`;
      el.cmds.appendChild(b);
      return;
    }
    (h.def.skills || []).forEach((sk, i) => {
      const rank = h.heroRank(i);
      const key = sk.key.toLowerCase();
      const cd = (h.skillCd && h.skillCd[key]) || 0;
      const locked = rank <= 0;
      const ready = !locked && cd <= 0 && h.energy >= sk.cost;
      const b = document.createElement('button');
      b.className = 'cmd ability' + (ready ? '' : ' off');
      const rankStr = locked ? 'Locked (Lv ' + (i + 1) + ')' : 'Rank ' + rank;
      b.innerHTML = `<kbd>${sk.key}</kbd><span class="l">✦ ${sk.name}</span>` +
                    `<span class="s">${rankStr} · E${sk.cost}${cd > 0 ? ' · ' + Math.ceil(cd) + 's' : ''}</span>`;
      b.title = `${sk.name} — ${sk.desc || ''}`;
      if (!locked) b.addEventListener('click', ev => { ev.stopPropagation(); RC.cmd(g, { t: 'cast', ids: [h.id], key }); });
      el.cmds.appendChild(b);
    });

    // 궁극기 — 레벨로 해금되고 쿨다운이 길다. 준비되면 눈에 띄게 강조.
    const ult = h.def.ult;
    if (ult) {
      const key = ult.key.toLowerCase();
      const cd = (h.skillCd && h.skillCd[key]) || 0;
      const locked = h.level < (ult.minLevel || 6);
      const ready = !locked && cd <= 0 && h.energy >= ult.cost;
      const b = document.createElement('button');
      b.className = 'cmd ability ult' + (ready ? ' ready' : ' off');
      const sub = locked ? 'Locked — reach Lv ' + (ult.minLevel || 6)
        : (cd > 0 ? 'Ready in ' + Math.ceil(cd) + 's'
          : (h.energy < ult.cost ? 'Energy ' + Math.floor(h.energy) + ' / ' + ult.cost : 'READY · E' + ult.cost));
      b.innerHTML = `<kbd>${ult.key}</kbd><span class="l">★ ${ult.name}</span><span class="s">${sub}</span>`;
      b.title = `ULTIMATE — ${ult.name}: ${ult.desc || ''} (Energy ${ult.cost}, cooldown ${ult.cd}s, unlocks at level ${ult.minLevel || 6})`;
      if (!locked) b.addEventListener('click', ev => { ev.stopPropagation(); RC.cmd(g, { t: 'cast', ids: [h.id], key }); });
      el.cmds.appendChild(b);
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
    if (d.shield) bits.push(`SHLD ${d.shield}`);
    if (d.dmg) bits.push(`ATK ${d.dmg}`);
    if (d.range > 20) bits.push(`RNG ${d.range}`);
    if (d.sight) bits.push(`SIGHT ${d.sight}`);
    if (d.armor) bits.push(`ARM ${d.armor}`);
    if (d.regen) bits.push(`regen ${d.regen}/s`);
    if (d.acid) bits.push('applies acid');
    return `${d.name} — ${d.desc}\n[${bits.join(' · ')}] · ${d.cost} shards · pop ${d.supply}`;
  }
  function bldTip(d) {
    const extra = (d.shield ? ` · shield ${d.shield}` : '') + (d.warpBeacon ? ' · warp beacon' : '');
    return `${d.name} — ${d.desc}\n${d.cost ? d.cost + ' shards' : 'free'}${d.supplyGiven ? ' · +' + d.supplyGiven + ' pop' : ''}${extra}`;
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

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeHtml(s) { return escapeAttr(s); }

  // Hook up the "submit my run" box on the Survival end screen.
  function wireScoreSubmit(run) {
    const input = document.getElementById('lb-name');
    const btn = document.getElementById('lb-send');
    const msg = document.getElementById('lb-msg');
    if (!input || !btn || !msg) return;
    let sent = false;
    const send = () => {
      if (sent) return;
      const name = RC.Leaderboard.cleanName(input.value);
      if (!name) { msg.textContent = 'Type a name first.'; msg.className = 'warn'; input.focus(); return; }
      sent = true;
      btn.disabled = true; input.disabled = true;
      msg.textContent = 'Sending…'; msg.className = '';
      RC.Leaderboard.submit({
        name: name, diff: run.diff, wave: run.waves, kills: run.kills,
        race: g.playerRace ? g.playerRace[g.playerOwner] : 'forge',
        mode: RC.online ? 'coop' : 'solo',
        // Proof the run was opened with the server, plus the wave-by-wave timings it
        // is checked against. Both come from the run itself: offline they are filled
        // in as the run plays, online the server sends its own with the `over` message.
        token: g.runToken || '', waveTimes: g.waveTimes || [],
      }).then(r => {
        const where = run.diff === 'daily'
          ? "today's Daily Challenge"
          : ((RC.Survival && RC.Survival.diffName) ? RC.Survival.diffName(run.diff) : run.diff);
        if (r.rank) {
          msg.innerHTML = r.improved
            ? `🏆 You are <b>#${r.rank}</b> in the world on ${where}!`
            : `Your best on ${where} is still <b>#${r.rank}</b> — beat it next run!`;
        } else {
          msg.textContent = 'Score sent! Keep climbing to reach the top 100.';
        }
        msg.className = 'good';
      }).catch(e => {
        sent = false; btn.disabled = false; input.disabled = false;
        msg.textContent = 'Could not reach the leaderboard (' + e.message + '). Try again?';
        msg.className = 'warn';
      });
    };
    btn.addEventListener('click', send);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  function showOverlay(kind) {
    if (g.survival) {
      // 데일리 챌린지 런은 난이도 보드가 아니라 전용 데일리 보드로 간다
      const isDaily = !!g.daily;
      const diff = isDaily ? 'daily' : (g.survivalDiff || 'medium');
      const dn = isDaily
        ? (g.daily.icon + ' ' + g.daily.name + ' · Daily Challenge')
        : ((RC.Survival && RC.Survival.diffName) ? RC.Survival.diffName(diff) : diff);
      const waves = g.survivalWave || 0, kills = g.survivalKills || 0;
      const score = waves * 100 + kills * 5;
      let best = 0, isNew = false;
      try {
        // the daily best is keyed by day, so a new challenge starts from zero
        const key = 'riftclash_hiscore_' + diff + (isDaily ? '_' + g.daily.day : '');
        best = parseInt(window.localStorage.getItem(key) || '0', 10) || 0;
        if (score > best) { best = score; isNew = true; window.localStorage.setItem(key, String(best)); }
      } catch (e) { /* localStorage unavailable (e.g. file://) — skip persistence */ }
      // Posting needs three things: an API to talk to, a run token the server issued
      // when this run began, and a wave log to check it against. A run played offline
      // or started while the server was asleep has no token, and says so plainly
      // instead of offering a Submit button that would always be refused.
      const apiUp = !!(RC.Leaderboard && RC.Leaderboard.available());
      const haveRun = !!(g.runToken && g.waveTimes && g.waveTimes.length);
      const canPost = apiUp && haveRun;
      el.overlayText.innerHTML =
        `<b class="lose">CRYSTAL SHATTERED</b>` +
        `<span>${dn} — reached <b style="color:var(--cyan)">Wave ${waves}</b> · ${kills} enemies slain</span>` +
        `<span style="font-size:26px;font-weight:700;color:var(--good)">Score ${score}${isNew ? '  🏆 NEW BEST!' : ''}</span>` +
        `<span style="color:var(--dim)">${isDaily ? "Your best on today's challenge" : 'Best on ' + dn}: ${best}</span>` +
        (isDaily && RC.Daily
          ? `<span style="color:#ffc857;font-size:12.5px">Everyone plays this exact run today — new challenge in ${RC.Daily.timeLeftLabel()}.</span>`
          : '') +
        (canPost
          ? `<div id="lb-post">
               <div class="lb-h">🌍 Send your score to the ${isDaily ? 'daily' : 'world'} leaderboard</div>
               <div class="lb-row">
                 <input id="lb-name" maxlength="14" placeholder="Your name"
                        value="${escapeAttr(RC.Leaderboard.getName())}">
                 <button id="lb-send">Submit</button>
               </div>
               <div id="lb-msg"></div>
             </div>`
          : `<div id="lb-post"><div class="lb-h" style="color:var(--dim)">${
                apiUp
                  ? 'This run could not be verified with the server, so it can’t go on the world board. Your personal best above is still saved.'
                  : 'Play the online version to post your score to the world leaderboard.'
             }</div></div>`);
      if (canPost) wireScoreSubmit({ diff, waves, kills, score });
      wireShare({
        title: dn,
        wave: waves, kills, score,
        chip: isDaily && g.daily ? g.daily.icon + ' ' + g.daily.name : null,
        race: (RC.RACES[g.raceOf(g.playerOwner)] || {}).name,
        rankLine: isNew ? 'New personal best' : (best > score ? 'Personal best: ' + best : null),
      });
    } else {
      el.overlayText.innerHTML = kind === 'win'
        ? '<b class="win">VICTORY</b><span>Enemy core destroyed.</span>'
        : '<b class="lose">DEFEAT</b><span>Your core has fallen.</span>';
    }
    el.overlay.classList.remove('hidden');
  }

  // ── Share the run ─────────────────────────────────
  // A finished run is the one moment a player actually wants to show someone.
  // The card is drawn locally, so this costs the server nothing.
  function wireShare(run) {
    if (!RC.Share || !el.overlayText) return;
    const box = document.createElement('div');
    box.id = 'share-box';
    const label = RC.Share.canShareImage() ? '📣 Share this run' : '📣 Save & copy this run';
    box.innerHTML = '<button id="share-go">' + label + '</button><div id="share-msg"></div>';
    el.overlayText.appendChild(box);
    const btn = box.querySelector('#share-go');
    const msg = box.querySelector('#share-msg');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = 'Preparing…';
      let how = 'downloaded';
      try {
        run.name = (RC.Leaderboard && RC.Leaderboard.getName()) || 'Anonymous';
        how = await RC.Share.share(run);
      } catch (e) { how = 'failed'; }
      msg.textContent = {
        'shared': 'Sent — thanks for spreading it.',
        'cancelled': '',
        'copied-image': 'Image copied — paste it anywhere.',
        'downloaded-and-copied': 'Image saved and the text copied.',
        'downloaded': 'Image saved to your downloads.',
        'failed': 'Could not share — try again.',
      }[how] || '';
      btn.disabled = false;
    });
  }

  return { init, update, showOverlay, syncPause, togglePause, openGameMenu, closeGameMenu, restartMatch, syncVoice, wireShare, syncFullscreen };
})();
