// RIFT CLASH — 진입점 / Main
window.RC = window.RC || {};

(function () {
  const cv = document.getElementById('screen');
  const mini = document.getElementById('minimap');
  const game = new RC.Game();

  function resize() {
    const wrap = document.getElementById('stage');
    cv.width = wrap.clientWidth;
    cv.height = wrap.clientHeight;
    RC.Input.clampCam();
  }

  RC.Renderer.init(cv, mini);
  RC.Input.init(game, cv, mini);
  RC.UI.init(game);
  window.addEventListener('resize', resize);
  resize();

  // ── 닉네임 ────────────────────────────────────────
  // One name for everything: the online player list, lobby chips and the world
  // leaderboard all read it. Stored under the key leaderboard.js already used, so
  // anyone who has posted a score keeps the name they picked and is never asked.
  const nickEl = document.getElementById('nickname');
  function myName() {
    const raw = (RC.Leaderboard && RC.Leaderboard.getName && RC.Leaderboard.getName()) || '';
    return raw.trim();
  }
  function saveName(n) {
    const clean = RC.Leaderboard && RC.Leaderboard.cleanName ? RC.Leaderboard.cleanName(n) : String(n || '').slice(0, 14);
    if (RC.Leaderboard && RC.Leaderboard.setName) RC.Leaderboard.setName(clean);
    if (RC.NetClient && RC.NetClient.connected) RC.NetClient.send({ t: 'setName', name: clean });
    return clean;
  }
  function renderWho() {
    const n = myName() || '—';
    const el = document.getElementById('who-name');
    if (el) el.textContent = n;
    const b = document.getElementById('browser-name');
    if (b) b.textContent = n;
  }
  // afterFn runs once a name is committed — used to resume whatever the player was doing.
  let nickAfter = null;
  function openNickname(after) {
    nickAfter = after || null;
    const input = document.getElementById('nick-input');
    const msg = document.getElementById('nick-msg');
    if (msg) { msg.textContent = ''; msg.className = ''; }
    if (input) { input.value = myName(); }
    if (nickEl) nickEl.classList.remove('hidden');
    // focus after the element is actually visible, or mobile keyboards ignore it
    setTimeout(() => { if (input) { input.focus(); input.select(); } }, 30);
  }
  function commitNickname() {
    const input = document.getElementById('nick-input');
    const msg = document.getElementById('nick-msg');
    const clean = RC.Leaderboard && RC.Leaderboard.cleanName
      ? RC.Leaderboard.cleanName(input ? input.value : '')
      : String((input && input.value) || '').slice(0, 14);
    if (clean.length < 2) {
      if (msg) { msg.textContent = 'Give yourself at least two characters.'; msg.className = 'warn'; }
      if (input) input.focus();
      return;
    }
    saveName(clean);
    renderWho();
    if (nickEl) nickEl.classList.add('hidden');
    const after = nickAfter; nickAfter = null;
    if (after) after();
  }
  (function initNickname() {
    const go = document.getElementById('nick-go');
    const input = document.getElementById('nick-input');
    if (go) go.addEventListener('click', commitNickname);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitNickname(); } });
    const edit = document.getElementById('who-edit');
    if (edit) edit.addEventListener('click', () => openNickname(null));
  })();

  // ── 시작 화면 ─────────────────────────────────────
  const ss = document.getElementById('startscreen');
  const overlay = document.getElementById('overlay');
  let started = false;
  let selMap = RC.MAPS[0].id;
  let selMode = '1v1';
  let selRace = 'forge';
  let selGameMode = 'vs';       // 'tutorial' | 'vs' | 'survival'
  let selSquad = 'solo';        // survival: 'solo' | 'ally'
  let selDiff = 'medium';       // survival: 'easy' | 'medium' | 'insane'
  let practiceHints = null;

  // 종족 얼굴 캔버스 목록 (시작 화면 + 온라인 로비). 메뉴가 떠 있는 동안만 다시 그린다.
  const raceFaces = [];
  function drawRaceFaces() {
    if (!RC.Renderer.drawRaceFace) return;
    for (const f of raceFaces) {
      if (f.cv && f.cv.isConnected) RC.Renderer.drawRaceFace(f.cv, f.race);
    }
  }

  function drawMapPreview(canvas, map) {
    const g2 = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const sx = W / map.world.w, sy = H / map.world.h;
    g2.fillStyle = map.ground || '#152029';
    g2.fillRect(0, 0, W, H);
    (map.terrain || []).forEach(t => {
      g2.fillStyle = t.color;
      if (t.r) { g2.beginPath(); g2.arc(t.x * sx, t.y * sy, t.r * sx, 0, Math.PI * 2); g2.fill(); }
    });
    g2.fillStyle = RC.COLORS.obstacleDark;
    (map.obstacles || []).forEach(o => g2.fillRect((o.x - o.w / 2) * sx, (o.y - o.h / 2) * sy, o.w * sx, o.h * sy));
    g2.fillStyle = RC.COLORS.node;
    (map.midNodes || []).forEach(m => { g2.beginPath(); g2.arc(m.x * sx, m.y * sy, 2.5, 0, Math.PI * 2); g2.fill(); });
    // 시작 지점 (4개 색)
    const cols = [RC.COLORS.p1_body, RC.COLORS.p2_body, RC.COLORS.p3_body, RC.COLORS.p4_body];
    map.spawns.forEach((s, i) => {
      g2.fillStyle = cols[i % 4];
      g2.fillRect(s.x * sx - 4, s.y * sy - 4, 8, 8);
    });
  }

  function buildStartScreen() {
    const mapWrap = document.getElementById('ss-maps');
    mapWrap.innerHTML = '';
    RC.MAPS.forEach(map => {
      const card = document.createElement('div');
      card.className = 'mapcard' + (map.id === selMap ? ' sel' : '');
      card.innerHTML = `<canvas width="224" height="150"></canvas>
        <div class="mc-name">${map.name}</div>
        <div class="mc-desc">${map.desc}</div>`;
      card.addEventListener('click', () => {
        selMap = map.id;
        mapWrap.querySelectorAll('.mapcard').forEach(c => c.classList.remove('sel'));
        card.classList.add('sel');
      });
      mapWrap.appendChild(card);
      drawMapPreview(card.querySelector('canvas'), map);
    });

    const modeWrap = document.getElementById('ss-modes');
    modeWrap.innerHTML = '';
    Object.values(RC.MODES).forEach(m => {
      const btn = document.createElement('div');
      btn.className = 'modebtn' + (m.id === selMode ? ' sel' : '');
      const sub = m.id === '1v1' ? 'You vs 1 bot' : 'You + ally bot vs 2 bots';
      btn.innerHTML = `<div class="mb-name">${m.name}</div><div class="mb-sub">${sub}</div>`;
      btn.addEventListener('click', () => {
        selMode = m.id;
        modeWrap.querySelectorAll('.modebtn').forEach(c => c.classList.remove('sel'));
        btn.classList.add('sel');
      });
      modeWrap.appendChild(btn);
    });

    // 종족 선택 — 각 종족의 영웅 얼굴을 함께 보여준다
    const raceWrap = document.getElementById('ss-races');
    if (raceWrap) {
      raceWrap.innerHTML = '';
      raceFaces.length = 0;
      RC.RACE_ORDER.forEach(rid => {
        const r = RC.RACES[rid];
        const btn = document.createElement('div');
        btn.className = 'modebtn racebtn' + (rid === selRace ? ' sel' : '');
        btn.style.borderTopColor = r.tint;
        btn.innerHTML = `<canvas class="race-face" width="150" height="120"></canvas>` +
                        `<div class="mb-name" style="color:${r.tint}">${r.name}</div>` +
                        `<div class="mb-sub">${r.blurb}</div>`;
        btn.addEventListener('click', () => {
          selRace = rid;
          raceWrap.querySelectorAll('.modebtn').forEach(c => c.classList.remove('sel'));
          btn.classList.add('sel');
        });
        raceWrap.appendChild(btn);
        raceFaces.push({ cv: btn.querySelector('canvas'), race: rid });
      });
      drawRaceFaces();
    }

    buildGameModes();
    buildSquad();
    buildDiff();
  }

  const DIFFS = [
    { id: 'easy', name: 'Easy', sub: 'Smaller, weaker waves. Learn the ropes.' },
    { id: 'medium', name: 'Medium', sub: 'A steady, rising challenge.' },
    { id: 'insane', name: 'Crazy Hard', sub: 'Huge, brutal waves. Good luck.' },
  ];
  function buildDiff() {
    const wrap = document.getElementById('ss-diff');
    if (!wrap) return;
    wrap.innerHTML = '';
    DIFFS.forEach(d => {
      const b = document.createElement('div');
      b.className = 'modebtn' + (d.id === selDiff ? ' sel' : '');
      b.innerHTML = `<div class="mb-name">${d.name}</div><div class="mb-sub">${d.sub}</div>`;
      b.addEventListener('click', () => {
        selDiff = d.id;
        wrap.querySelectorAll('.modebtn').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
      });
      wrap.appendChild(b);
    });
  }

  // ── Game-mode cards (Tutorial / Versus / Survival) ──
  const GAMEMODES = [
    { id: 'tutorial', ic: '🎓', name: 'Tutorial', sub: 'Learn the game, then a guided practice match.' },
    { id: 'vs', ic: '⚔️', name: 'Versus', sub: '1v1 or 2v2 vs bots — or online vs friends.' },
    { id: 'survival', ic: '🛡️', name: 'Survival', sub: 'Defend the Rift Crystal from endless waves.' },
  ];
  function buildGameModes() {
    const wrap = document.getElementById('ss-gamemodes');
    if (!wrap) return;
    wrap.innerHTML = '';
    GAMEMODES.forEach(gm => {
      const c = document.createElement('div');
      c.className = 'gmcard' + (gm.id === selGameMode ? ' sel' : '');
      c.dataset.m = gm.id;
      c.innerHTML = `<div class="gm-ic">${gm.ic}</div><div class="gm-name">${gm.name}</div><div class="gm-sub">${gm.sub}</div>`;
      c.addEventListener('click', () => applyGameMode(gm.id));
      wrap.appendChild(c);
    });
  }
  const SQUADS = [
    { id: 'solo', name: 'Solo', sub: 'You alone vs the horde.' },
    { id: 'ally', name: 'Co-op + Ally Bot', sub: 'An allied AI defends with you.' },
  ];
  function buildSquad() {
    const wrap = document.getElementById('ss-squad');
    if (!wrap) return;
    wrap.innerHTML = '';
    SQUADS.forEach(sq => {
      const b = document.createElement('div');
      b.className = 'modebtn' + (sq.id === selSquad ? ' sel' : '');
      b.innerHTML = `<div class="mb-name">${sq.name}</div><div class="mb-sub">${sq.sub}</div>`;
      b.addEventListener('click', () => {
        selSquad = sq.id;
        wrap.querySelectorAll('.modebtn').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
      });
      wrap.appendChild(b);
    });
  }

  // Show/hide start-screen sections for the chosen game mode
  function applyGameMode(m) {
    selGameMode = m;
    document.querySelectorAll('#ss-gamemodes .gmcard').forEach(c => c.classList.toggle('sel', c.dataset.m === m));
    const show = (id, on, disp) => { const e = document.getElementById(id); if (e) e.style.display = on ? (disp || 'flex') : 'none'; };
    show('panel-tutorial', m === 'tutorial');
    show('sec-map', m === 'vs');
    show('sec-mode', m === 'vs');
    show('sec-diff', m === 'survival');
    show('sec-squad', m === 'survival');
    show('sec-race', m !== 'tutorial');
    show('act-vs', m === 'vs', 'flex');
    show('act-survival', m === 'survival', 'flex');
    show('ss-onlinehint', m === 'vs');
    show('ss-survivalhint', m === 'survival');
    show('ss-daily', m === 'survival', 'block');
    if (m === 'survival') renderDailyCard();
    const rh = document.getElementById('race-h');
    if (rh) rh.textContent = m === 'survival' ? 'Your faction' : 'Faction (enemy AI takes the other)';
  }

  function audioGo() { if (RC.Audio) { RC.Audio.init(); RC.Audio.resume(); RC.Audio.startMusic(); } }

  // ── Fullscreen ────────────────────────────────────
  // Browsers require fullscreen to be requested synchronously from a user
  // gesture (click/tap), so this is called right at the top of each
  // "start the match" handler. Best-effort: silently no-ops if the browser
  // blocks it (e.g. no gesture in the chain, or unsupported like iPhone Safari).
  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!req) return;
    try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }
  function exitFullscreenIfActive() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    if (!fsEl) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (!exit) return;
    try { const p = exit.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  function startGame() {
    RC.online = false;
    game.practice = false;
    game.heroesEnabled = true;
    goFullscreen();
    audioGo();
    game.playerOwner = 1;
    // my faction = selection; each AI takes one of the OTHER factions at random,
    // so you always face a different race than your own (and 2v2 can mix them).
    const mode = RC.MODES[selMode];
    const racePick = {};
    mode.players.forEach(p => { racePick[p.owner] = p.ai ? RC.otherRace(selRace) : selRace; });
    game.setup(RC.getMap(selMap), mode, racePick);
    RC.AI.reset();
    resize();
    RC.Input.centerOn(game.spawn1.x, game.spawn1.y);
    ss.classList.add('hidden');
    overlay.classList.add('hidden');
    started = true;
  }

  // ── Survival ──
  function startSurvival() {
    RC.online = false;
    game.practice = false;
    game.heroesEnabled = true;
    goFullscreen();
    audioGo();
    game.setupSurvival({ race: selRace, ally: selSquad === 'ally', difficulty: selDiff });
    RC.AI.reset();
    resize();
    if (game.crystal) RC.Input.centerOn(game.crystal.x, game.crystal.y);
    ss.classList.add('hidden');
    overlay.classList.add('hidden');
    started = true;
  }

  // Daily Challenge — same map, same seed, same twist for everyone today.
  // Deliberately solo and offline: a co-op run isn't comparable to a solo one,
  // so letting both onto the same board would make it meaningless.
  function startDaily() {
    RC.online = false;
    game.practice = false;
    game.heroesEnabled = true;
    goFullscreen();
    audioGo();
    game.setupSurvival({ race: selRace, ally: false, difficulty: 'medium', daily: true });
    RC.AI.reset();
    resize();
    if (game.crystal) RC.Input.centerOn(game.crystal.x, game.crystal.y);
    ss.classList.add('hidden');
    overlay.classList.add('hidden');
    started = true;
    if (game.daily) game.notify(game.daily.icon + ' ' + game.daily.name + ' — ' + game.daily.desc);
  }

  // ── Tutorial: interactive practice match ──
  const PRACTICE_HINTS = [
    { t: 1,  msg: 'Welcome! Drag a box over your workers to select them.' },
    { t: 8,  msg: 'Right-click a glowing shard cluster to mine shards.' },
    { t: 16, msg: 'Select your Core, press Q to train another Wrench Bot.' },
    { t: 28, msg: 'Select a worker, then build a Power Cell (E) for more population.' },
    { t: 44, msg: 'Build a Bolt Factory (R), then train Volt Troopers.' },
    { t: 66, msg: 'Right-click the enemy to attack. Destroy their Core to win!' },
  ];
  function startPractice() {
    selMap = 'basin'; selMode = '1v1';
    startGame();
    game.practice = true;
    practiceHints = PRACTICE_HINTS.map(h => ({ t: h.t, msg: h.msg, done: false }));
  }

  // ── Tutorial: reference screens ──
  const TUT_TABS = ['Overview', 'Modes', 'Factions', 'Units'];
  // 종족 판정 — race가 없는 정의는 기본(Forge) 소속. 3종족 이상에서도 동작한다.
  const raceOf = d => d.race || 'forge';
  function unitCard(d) {
    const bits = [`HP ${d.hp}`];
    if (d.shield) bits.push(`SHLD ${d.shield}`);
    if (d.dmg) bits.push(`ATK ${d.dmg}`);
    if (d.range > 20) bits.push(`RNG ${d.range}`);
    if (d.armor) bits.push(`ARM ${d.armor}`);
    bits.push(`${d.cost} shards`, `pop ${d.supply}`);
    if (d.regen) bits.push(`regen ${d.regen}/s`);
    if (d.acid) bits.push('applies acid');
    return `<div class="tut-card ${raceOf(d)}">
      <div><span class="tc-name">${d.name}</span><span class="tc-role">${d.role || ''}</span></div>
      <div class="tc-stats">${bits.join(' · ')}</div>
      <div class="tc-desc">${d.desc || ''}</div>
      ${d.ability ? `<div class="tc-abil">✦ ${d.ability.name} — ${d.ability.desc || ''}</div>` : ''}
    </div>`;
  }
  function bldCard(d) {
    const bits = [`HP ${d.hp}`];
    if (d.shield) bits.push(`SHLD ${d.shield}`);
    bits.push(d.cost ? `${d.cost} shards` : 'free');
    if (d.supplyGiven) bits.push(`+${d.supplyGiven} pop`);
    if (d.warpBeacon) bits.push('warp beacon');
    if (d.tower) bits.push(`turret · ${d.dmg} dmg · rng ${d.range}`);
    return `<div class="tut-card ${raceOf(d)}">
      <div><span class="tc-name">${d.name}</span></div>
      <div class="tc-stats">${bits.join(' · ')}</div>
      <div class="tc-desc">${d.desc || ''}</div>
    </div>`;
  }
  function tutRender(tab) {
    const body = document.getElementById('tut-body');
    if (!body) return;
    if (tab === 'Overview') {
      body.innerHTML =
        `<h3>Goal</h3><p>Gather <b>shards</b>, build structures, grow an army, and destroy the enemy — or, in Survival, protect the Rift Crystal.</p>
         <h3>Economy</h3><p>Workers (Wrench Bot / Slug / Acolyte) mine shard clusters and carry them back to your Core. Shards pay for everything.</p>
         <h3>Population</h3><p>Every unit costs population. Build <b>Power Cells</b> / <b>Spore Membranes</b> / <b>Warp Conduits</b> to raise your population cap.</p>
         <h3>Faction identity</h3><p>Forge leans on upgrades, repair support and towers. Gloop units self-heal and their attacks melt armor. <b>Aether</b> units carry recharging plasma shields that soak damage before health — and their combat units <b>warp in at any Warp Conduit</b>, so a conduit built near the enemy becomes a forward staging point.</p>
         <h3>Build order</h3><p class="muted">Core → workers → Power Cell → Factory → army → upgrades &amp; air. Right-click to move, attack, gather or assist a build. Press &amp; hold any command button to see what it does.</p>
         <h3>Controls</h3><p class="muted">Left-click / drag to select · right-click to command · Q/W/E to produce · number keys for control groups · minimap and screen edges to pan.</p>`;
    } else if (tab === 'Modes') {
      body.innerHTML =
        `<h3>🎓 Tutorial</h3><p>These reference screens plus a guided practice match against a gentle bot.</p>
         <h3>⚔️ Versus</h3><p><b>1 vs 1</b> — you against one bot. <b>2 vs 2</b> — you and an allied bot against two bots. Also playable online against friends on iPad/tablet.</p>
         <h3>🛡️ Survival</h3><p>Defend the <b>Rift Crystal</b> from waves of enemies that march in from the far side. A new wave arrives every few seconds and each is stronger than the last. Build defense towers and an army to hold out as long as you can — it never ends, so chase a high wave count. Play solo or with an allied bot.</p>`;
    } else if (tab === 'Factions') {
      body.innerHTML = RC.RACE_ORDER.map(rid => {
        const r = RC.RACES[rid];
        const units = Object.values(RC.UNITS).filter(u => raceOf(u) === rid).map(u => u.name).join(', ');
        const blds = Object.values(RC.BUILDINGS).filter(b => !b.isCrystal && raceOf(b) === rid).map(b => b.name).join(', ');
        return `<h3 style="color:${r.tint}">${r.name}</h3><p>${r.blurb}</p>
          <p class="muted"><b>Units:</b> ${units}</p>
          <p class="muted"><b>Buildings:</b> ${blds}</p>`;
      }).join('');
    } else { // Units
      body.innerHTML = RC.RACE_ORDER.map(rid => {
        const r = RC.RACES[rid];
        const units = Object.values(RC.UNITS).filter(u => raceOf(u) === rid);
        const blds = Object.values(RC.BUILDINGS).filter(b => !b.isCrystal && raceOf(b) === rid);
        return `<h3 style="color:${r.tint}">${r.name} — Units</h3>${units.map(unitCard).join('')}` +
               `<h3 style="color:${r.tint}">${r.name} — Buildings</h3>${blds.map(bldCard).join('')}`;
      }).join('');
    }
    document.querySelectorAll('#tut-tabs .tut-tab').forEach(b => b.classList.toggle('sel', b.dataset.t === tab));
  }
  function openTutorial() {
    const tabs = document.getElementById('tut-tabs');
    if (tabs && !tabs.dataset.built) {
      tabs.dataset.built = '1';
      TUT_TABS.forEach((t, i) => {
        const b = document.createElement('div');
        b.className = 'tut-tab' + (i === 0 ? ' sel' : '');
        b.dataset.t = t; b.textContent = t;
        b.addEventListener('click', () => tutRender(t));
        tabs.appendChild(b);
      });
    }
    tutRender('Overview');
    document.getElementById('tutorial').classList.remove('hidden');
  }

  function openMenu() {
    started = false;
    if (RC.Voice && RC.Voice.joined) RC.Voice.leave(false);   // quitting to the menu hangs up, but keeps auto-join armed
    if (RC.online) { RC.NetClient.close(); RC.online = false; }
    document.getElementById('lobby').classList.add('hidden');
    document.getElementById('browser').classList.add('hidden');
    const bd = document.getElementById('board');
    if (bd) bd.classList.add('hidden');
    overlay.classList.add('hidden');
    exitFullscreenIfActive();
    buildStartScreen();
    applyGameMode(selGameMode);
    renderWho();
    ss.classList.remove('hidden');
  }
  // The ⏹ end-match dialog in ui.js needs a way home without reaching into this closure.
  RC.openMenu = openMenu;

  // ── World leaderboard screen ────────────────────────────
  const boardEl = document.getElementById('board');
  let boardDiff = 'medium';

  function renderBoardTabs() {
    const tabs = document.getElementById('board-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    // The Daily board sits alongside the difficulty boards. It's the fairest of
    // the four — everyone on it played the exact same run.
    const list = DIFFS.concat([{ id: 'daily', name: '⭐ Daily' }]);
    list.forEach(d => {
      const b = document.createElement('div');
      b.className = 'modebtn' + (d.id === boardDiff ? ' sel' : '');
      b.innerHTML = `<div class="mb-name">${d.name}</div>`;
      b.addEventListener('click', () => { boardDiff = d.id; renderBoardTabs(); loadBoard(); });
      tabs.appendChild(b);
    });
  }

  function loadBoard() {
    const list = document.getElementById('board-list');
    const status = document.getElementById('board-status');
    list.innerHTML = '';
    if (!RC.Leaderboard || !RC.Leaderboard.available()) {
      status.textContent = 'The world leaderboard needs the online version of the game — open it from the web address instead of a local file.';
      return;
    }
    status.textContent = 'Loading…';
    const myName = (RC.Leaderboard.getName() || '').toLowerCase();
    RC.Leaderboard.top(boardDiff, 25).then(res => {
      list.innerHTML = '';
      const daily = boardDiff === 'daily';
      const dinfo = (daily && RC.Daily) ? RC.Daily.today() : null;
      if (!res.rows || !res.rows.length) {
        status.textContent = '';
        list.innerHTML = daily
          ? `<div id="board-empty">Nobody has finished today's challenge yet — ${dinfo ? dinfo.icon + ' ' + dinfo.name : ''} is wide open. Board resets in ${RC.Daily ? RC.Daily.timeLeftLabel() : 'a while'}.</div>`
          : '<div id="board-empty">No scores yet on this difficulty — be the first!</div>';
        return;
      }
      status.textContent = daily
        ? `${dinfo ? dinfo.icon + ' ' + dinfo.name + ' · ' + dinfo.date : "Today's run"} — everyone here played the exact same waves. Resets in ${RC.Daily ? RC.Daily.timeLeftLabel() : 'a while'}.`
        : 'Top ' + res.rows.length + ' — beat them and your name goes up here.';
      res.rows.forEach((r, i) => {
        const rank = i + 1;
        const race = RC.RACES[r.race] || RC.RACES.forge;
        const mine = String(r.name || '').toLowerCase() === myName;
        const row = document.createElement('div');
        row.className = 'lbrow' + (rank <= 3 ? ' top' + rank : '') + (mine ? ' me' : '');
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        row.innerHTML =
          `<div class="rk">${medal}</div>` +
          `<div><div class="nm">${esc(r.name)}${mine ? ' <span style="color:var(--orange);font-size:11px">(you)</span>' : ''}</div>` +
          `<div class="meta">Wave ${r.wave} · ${r.kills} slain · <span style="color:${race.tint}">${race.name}</span>${r.mode === 'coop' ? ' · co-op' : ''}</div></div>` +
          `<div class="sc">${r.score}</div>`;
        list.appendChild(row);
      });
    }).catch(e => { status.textContent = 'Could not load the leaderboard (' + e.message + ').'; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openBoard() {
    ss.classList.add('hidden');
    boardEl.classList.remove('hidden');
    renderBoardTabs();
    loadBoard();
  }
  const lbBtn = document.getElementById('ss-leaderboard');
  if (lbBtn) lbBtn.addEventListener('click', openBoard);
  const lbBack = document.getElementById('board-back');
  if (lbBack) lbBack.addEventListener('click', () => {
    boardEl.classList.add('hidden');
    ss.classList.remove('hidden');
  });

  document.getElementById('ss-start').addEventListener('click', startGame);
  document.getElementById('ss-survival').addEventListener('click', startSurvival);

  // ── Daily Challenge card ────────────────────────────────
  // Rendered fresh each time the start screen opens, so a player who leaves the
  // tab open overnight sees the new day's twist rather than a stale card.
  function renderDailyCard() {
    if (!RC.Daily) return;
    const d = RC.Daily.today();
    const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
    set('daily-date', d.date + ' · UTC');
    set('daily-name', d.icon + '  ' + d.name);
    set('daily-desc', d.desc);
    set('daily-timer', 'New challenge in ' + RC.Daily.timeLeftLabel());
  }
  const dailyBtn = document.getElementById('ss-daily-start');
  if (dailyBtn) dailyBtn.addEventListener('click', startDaily);
  document.getElementById('tut-learn').addEventListener('click', openTutorial);
  document.getElementById('tut-practice').addEventListener('click', startPractice);
  document.getElementById('tut-close').addEventListener('click', () => document.getElementById('tutorial').classList.add('hidden'));
  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) btnMenu.addEventListener('click', openMenu);

  // ── Online (internet — public & private rooms) ──────────
  const lobbyEl = document.getElementById('lobby');
  const browserEl = document.getElementById('browser');
  const N = RC.NetClient;
  let myId = null, isHost = false, lobbyData = null, myRace = 'forge', myTeam = null, firstSnap = false;
  let roomCode = '', roomPublic = true;
  // Which kind of online game the browser is currently creating ('vs' | 'survival').
  // Set when you press Online from either the Versus or the Survival panel.
  let onlineKind = 'vs';

  function showBrowser() { ss.classList.add('hidden'); overlay.classList.add('hidden'); lobbyEl.classList.add('hidden'); browserEl.classList.remove('hidden'); }
  function showLobby() { ss.classList.add('hidden'); overlay.classList.add('hidden'); browserEl.classList.add('hidden'); lobbyEl.classList.remove('hidden'); }
  function setStatus(msg) { document.getElementById('lobby-status').textContent = msg; }
  function setBrowserStatus(msg) { document.getElementById('browser-status').textContent = msg; }
  function roomName() { return (document.getElementById('room-name').value || '').trim(); }

  function renderRooms(list) {
    const rl = document.getElementById('room-list');
    rl.innerHTML = '';
    if (!list || !list.length) { rl.innerHTML = '<div id="room-empty">No public games right now — create one above!</div>'; return; }
    list.forEach(r => {
      const cap = r.cap || 4, full = r.players >= cap;
      let sub;
      if (r.gameMode === 'survival') {
        const dn = RC.Survival ? RC.Survival.diffName(r.diff) : (r.diff || 'Medium');
        sub = `🛡️ Survival Co-op · ${dn} · ${r.players}/${cap} players`;
      } else {
        const modeName = (RC.MODES[r.modeId] || {}).name || r.modeId;
        const mapName = (RC.getMap(r.mapId) || {}).name || r.mapId;
        sub = `⚔️ ${mapName} · ${modeName} · ${r.players}/${cap} players`;
      }
      const row = document.createElement('div');
      row.className = 'roomrow' + (full ? ' full' : '');
      row.innerHTML = `<div><div class="rr-name">${r.name}</div><div class="rr-sub">${sub}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = full ? 'Full' : 'Join';
      if (!full) btn.addEventListener('click', () => N.send({ t: 'join', roomId: r.id }));
      row.appendChild(btn);
      rl.appendChild(row);
    });
  }

  // ── Who's online + direct invites ───────────────────────
  // The room browser only ever showed rooms, so you could not tell whether anyone
  // else was even connected. This lists every player on the server and lets you
  // pull one of them straight into a game without either of you typing a code.
  let presence = [];
  const INVITE_KINDS = [
    { id: '1v1', label: '⚔️ 1v1', kind: 'vs', modeId: '1v1' },
    { id: '2v2', label: '⚔️ 2v2', kind: 'vs', modeId: '2v2' },
    { id: 'survival', label: '🛡️ Survival', kind: 'survival', modeId: '1v1' },
  ];
  const STATUS_TEXT = { idle: 'In the menu', lobby: 'Waiting in a game lobby', ingame: 'In a match' };

  // Rendered into TWO places: the browser (pick the game type as you invite) and
  // the lobby (pull more people into the game you are already sitting in — without
  // which a 2v2 or a 4-player co-op could never be filled by invite).
  function renderPresence() {
    renderPresenceInto('online-list', 'online-count', false);
    renderPresenceInto('lobby-online', 'lobby-online-count', true);
  }
  function renderPresenceInto(listId, countId, inLobby) {
    const wrap = document.getElementById(listId);
    const count = document.getElementById(countId);
    if (!wrap) return;
    wrap.innerHTML = '';
    const others = presence.filter(p => p.id !== myId && (!inLobby || p.status !== 'lobby' || !inRoomWithMe(p.id)));
    if (count) {
      count.textContent = presence.length <= 1
        ? 'just you for now'
        : presence.length + ' online · ' + others.length + ' other' + (others.length === 1 ? '' : 's');
    }
    if (!others.length) {
      wrap.innerHTML = '<div id="online-empty">' + (inLobby
        ? 'Nobody else is online to invite yet. Empty seats are filled by bots.'
        : 'Nobody else is online right now. Create a public game and it will show up for the next player who arrives.')
        + '</div>';
      return;
    }
    others.forEach(p => {
      const row = document.createElement('div');
      row.className = 'prow';
      const busy = p.status === 'ingame';
      const info = document.createElement('div');
      info.innerHTML = `<div class="pnm">${esc(p.name)}</div><div class="pst">${STATUS_TEXT[p.status] || 'Online'}</div>`;
      const btns = document.createElement('div');
      btns.className = 'pinv';
      // In the lobby there is nothing to choose — the room already has a game type,
      // and sending a kind here would silently rewrite the host's own settings.
      const kinds = inLobby ? [{ id: 'this game', label: '✉️ Invite', kind: null }] : INVITE_KINDS;
      kinds.forEach(k => {
        const b = document.createElement('button');
        b.textContent = k.label;
        b.disabled = busy;
        b.title = busy ? p.name + ' is in a match' : 'Invite ' + p.name + ' to ' + k.id;
        if (!busy) b.addEventListener('click', () => {
          const msg = { t: 'invite', to: p.id };
          if (k.kind) { msg.kind = k.kind; msg.modeId = k.modeId; }
          N.send(msg);
          const note = 'Invite sent to ' + p.name + ' — waiting for them to accept…';
          if (inLobby) setStatus(note); else setBrowserStatus(note);
        });
        btns.appendChild(b);
      });
      row.appendChild(info); row.appendChild(btns);
      wrap.appendChild(row);
    });
  }
  function inRoomWithMe(id) {
    return !!(lobbyData && (lobbyData.players || []).some(p => p.id === id));
  }

  // Incoming invite — one at a time; a newer invite replaces the one on screen.
  let pendingInvite = null;
  function showInvite(m) {
    pendingInvite = m;
    const pop = document.getElementById('invite-pop');
    const txt = document.getElementById('invite-text');
    if (!pop || !txt) return;
    const what = m.gameMode === 'survival' ? 'Survival co-op' : (m.modeId === '2v2' ? 'a 2v2' : 'a 1v1');
    txt.innerHTML = `<b>${esc(m.fromName)}</b> invites you to ${what}.`;
    pop.classList.remove('hidden');
  }
  function hideInvite() { pendingInvite = null; const p = document.getElementById('invite-pop'); if (p) p.classList.add('hidden'); }
  (function initInvite() {
    const a = document.getElementById('inv-accept');
    const d = document.getElementById('inv-decline');
    if (a) a.addEventListener('click', () => {
      if (!pendingInvite) return;
      const inv = pendingInvite; hideInvite();
      N.send({ t: 'inviteAccept', roomId: inv.roomId });
    });
    if (d) d.addEventListener('click', () => {
      if (!pendingInvite) return;
      const inv = pendingInvite; hideInvite();
      N.send({ t: 'inviteDecline', to: inv.from });
    });
  })();

  // ── Voice chat panel (lobby) ────────────────────────────
  // The in-match control is the 🎤 touchbar button; this is where you actually
  // join, leave, mute and see who is on the call.
  let voiceRoster = [];
  function renderVoice() {
    const panel = document.getElementById('voice-panel');
    if (!panel || !RC.Voice) return;
    const st = RC.Voice.status();
    const show = (id, on) => { const e = document.getElementById(id); if (e) e.classList.toggle('hidden', !on); };
    show('voice-join', !st.joined);
    show('voice-mic', st.joined);
    show('voice-deaf', st.joined);
    show('voice-leave', st.joined);

    const note = document.getElementById('voice-note');
    if (note) note.textContent = st.joined
      ? 'Mic and speaker are on — audio goes straight between players, not through the server.'
      : (st.reason || (st.auto
          ? 'Voice turns on by itself when you join a game. Press Join Voice to start it now.'
          : 'Voice is off because you left the call. Press Join Voice to turn it back on.'));

    const mic = document.getElementById('voice-mic');
    if (mic) { mic.textContent = st.micOn ? 'Mute mic' : 'Unmute mic'; mic.classList.toggle('on', !st.micOn); }
    const deaf = document.getElementById('voice-deaf');
    if (deaf) { deaf.textContent = st.deaf ? 'Undeafen' : 'Deafen'; deaf.classList.toggle('on', st.deaf); }
    const join = document.getElementById('voice-join');
    if (join) { join.disabled = !!st.reason; join.title = st.reason || 'Turn the mic and speaker on'; }

    const err = document.getElementById('voice-error');
    if (err) err.textContent = st.error || '';
    // A blocked-playback state is the one failure a player can actually fix, so
    // it gets a banner rather than a line of small grey text.
    const tap = document.getElementById('voice-tap');
    if (tap) {
      const blocked = st.joined && (st.needsGesture || st.peers.some(p => p.state === 'connected' && !p.playing));
      tap.classList.toggle('hidden', !blocked);
    }

    const list = document.getElementById('voice-list');
    if (!list) return;
    // everyone in the room who has voice on, us first
    const rows = [];
    if (st.joined) rows.push({ me: true, name: myName() || 'You', state: 'connected', speaking: st.speaking, micOn: st.micOn });
    st.peers.forEach(p => rows.push({
      me: false, name: p.name, state: p.state, speaking: p.speaking, micOn: true,
      trouble: RC.Voice.troubleWith(p),
      detail: p.state === 'connected'
        ? ((p.receiving ? 'receiving' : 'no audio in') + ' · ' + (p.playing ? 'playing' : 'not playing'))
        : '',
    }));
    // people in the room who have NOT joined voice yet — worth showing, so you
    // know whether to wait for them or just type
    const onCall = new Set(st.peers.map(p => p.id));
    (lobbyData ? lobbyData.players : []).forEach(pl => {
      if (pl.id === myId || onCall.has(pl.id)) return;
      if (voiceRoster.some(v => v.id === pl.id)) return;
      rows.push({ me: false, name: pl.name, state: 'off', speaking: false, micOn: false });
    });
    if (!rows.length) { list.innerHTML = '<div id="voice-empty">Nobody is on the call yet — press Join Voice.</div>'; return; }
    const STATE_TEXT = { connected: 'connected', connecting: 'connecting…', reconnecting: 'reconnecting…',
                         failed: 'could not connect', off: 'not on voice' };
    list.innerHTML = rows.map(r => {
      const right = r.me ? (r.micOn ? 'mic on' : 'mic muted')
                         : (r.trouble || r.detail || STATE_TEXT[r.state] || r.state);
      return '<div class="vrow' + (r.speaking ? ' talking' : '') +
        ((r.state === 'failed' || r.trouble) ? ' failed' : '') + '">' +
        '<div class="vdot"></div>' +
        '<div class="vnm">' + esc(r.name) + (r.me ? ' (you)' : '') + '</div>' +
        '<div class="vst">' + esc(right) + '</div>' +
        '</div>';
    }).join('');
  }
  (function initVoicePanel() {
    if (!RC.Voice) return;
    RC.Voice.init(null, m => N.send(m));
    RC.Voice.on(() => { renderVoice(); if (RC.UI && RC.UI.syncVoice) RC.UI.syncVoice(); });
    const j = document.getElementById('voice-join');
    if (j) j.addEventListener('click', async () => { j.disabled = true; await RC.Voice.join(); j.disabled = false; renderVoice(); });
    const m = document.getElementById('voice-mic');
    if (m) m.addEventListener('click', () => { RC.Voice.toggleMic(); renderVoice(); });
    const d = document.getElementById('voice-deaf');
    if (d) d.addEventListener('click', () => { RC.Voice.toggleDeaf(); renderVoice(); });
    const l = document.getElementById('voice-leave');
    if (l) l.addEventListener('click', () => { RC.Voice.leave(true); renderVoice(); });
    // The banner's job is simply to BE a user gesture — the click handler in
    // voice.js does the retry; this just gives the player somewhere to press.
    const tap = document.getElementById('voice-tap');
    if (tap) tap.addEventListener('click', () => setTimeout(renderVoice, 250));
    renderVoice();
  })();
  // Not an explicit hang-up: the room ended or the socket dropped, so auto-join stays armed.
  function leaveVoice() { if (RC.Voice && RC.Voice.joined) RC.Voice.leave(false); voiceRoster = []; renderVoice(); }

  function openBrowser(kind) {
    // No nickname yet? Ask first — other players are about to see this name.
    if (!myName()) { openNickname(() => openBrowser(kind)); return; }
    renderWho();
    onlineKind = kind;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    const title = document.getElementById('browser-title');
    if (title) title.innerHTML = kind === 'survival'
      ? 'RIFT<b>CLASH</b> · Online Co-op'
      : 'RIFT<b>CLASH</b> · Online';
    showBrowser(); setBrowserStatus('Connecting…');
    presence = []; renderPresence();
    RC.online = false;
    if (RC.Audio) { RC.Audio.init(); RC.Audio.resume(); }
    N.connect(url);
  }
  document.getElementById('ss-online').addEventListener('click', () => openBrowser('vs'));
  const svOnlineBtn = document.getElementById('ss-survival-online');
  if (svOnlineBtn) svOnlineBtn.addEventListener('click', () => openBrowser('survival'));

  document.getElementById('create-public').addEventListener('click', () => N.send({ t: 'create', name: roomName(), public: true, gameMode: onlineKind }));
  document.getElementById('create-private').addEventListener('click', () => N.send({ t: 'create', name: roomName(), public: false, gameMode: onlineKind }));
  document.getElementById('refresh-rooms').addEventListener('click', () => N.send({ t: 'list' }));
  document.getElementById('join-code-btn').addEventListener('click', () => {
    const code = (document.getElementById('join-code').value || '').trim().toUpperCase();
    if (code.length >= 3) { setBrowserStatus('Joining ' + code + '…'); N.send({ t: 'join', code }); }
  });
  document.getElementById('browser-back').addEventListener('click', () => {
    leaveVoice();
    N.close(); RC.online = false; started = false;
    presence = []; hideInvite();
    browserEl.classList.add('hidden'); openMenu();
  });
  document.getElementById('btn-menu2').addEventListener('click', () => {
    leaveVoice();                       // leaving the room leaves the call
    N.send({ t: 'leave' });
    lobbyEl.classList.add('hidden'); showBrowser(); setBrowserStatus('Pick or create a game.');
  });
  document.getElementById('lobby-start').addEventListener('click', () => { goFullscreen(); N.send({ t: 'start' }); });

  // ── Invite link ────────────────────────────────────────
  // One link that drops a friend straight into THIS game. Pasting a room code and
  // talking someone through the browser screen is the friction that stops most
  // people ever playing together.
  function inviteLink() {
    try {
      const base = location.origin + location.pathname;
      return base + '?join=' + encodeURIComponent(roomCode || '');
    } catch (e) { return ''; }
  }
  const linkBtn = document.getElementById('lobby-link');
  if (linkBtn) linkBtn.addEventListener('click', async () => {
    const url = inviteLink();
    if (!url || !roomCode) { setStatus('No invite link yet — the game is still being created.'); return; }
    let done = false;
    try {
      if (navigator.share) { await navigator.share({ title: 'RIFT CLASH', text: 'Join my game', url }); done = true; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (!done) {
      try { await navigator.clipboard.writeText(url); done = true; } catch (e) {}
    }
    setStatus(done ? 'Invite link copied — send it to anyone and they land straight in this game.'
                   : 'Copy this link: ' + url);
  });

  N.on('__open', () => {
    setBrowserStatus('Connected. Invite someone below, or create a game.');
    N.send({ t: 'setName', name: myName() });     // claim our name before anyone sees the list
    N.send({ t: 'list' });
  });
  N.on('__error', () => setBrowserStatus('Could not connect — the server may be waking up. Wait ~30s, then press Back and Online again.'));
  N.on('__close', () => { presence = []; renderPresence(); hideInvite(); leaveVoice(); if (!started) setBrowserStatus('Disconnected. Press Back, then Online to reconnect.'); });

  N.on('welcome', m => {
    myId = m.id;
    if (RC.Voice) RC.Voice.init(myId, msg => N.send(msg));   // the id decides who offers
    renderPresence();
  });
  N.on('voicePeers', m => { voiceRoster = m.peers || []; if (RC.Voice) RC.Voice.setRoster(voiceRoster); renderVoice(); });
  N.on('rtc', m => { if (RC.Voice) RC.Voice.onSignal(m); });
  N.on('rooms', m => renderRooms(m.rooms));
  N.on('presence', m => { presence = m.players || []; renderPresence(); });
  N.on('invited', m => showInvite(m));
  N.on('inviteSent', m => setBrowserStatus('Invite sent to ' + m.name + ' — waiting for them to accept…'));
  N.on('inviteDeclined', m => setBrowserStatus(m.name + ' declined the invite.'));
  N.on('inviteError', m => setBrowserStatus(m.msg || 'That invite could not be sent.'));
  N.on('joined', m => {
    roomCode = m.code; roomPublic = m.public; myRace = 'forge'; lobbyData = null;
    showLobby();
    // Mic and speaker come up automatically on entering a room.
    if (RC.Voice) { RC.Voice.resetAuto(); RC.Voice.autoJoin().then(renderVoice); }
  });
  N.on('joinError', m => setBrowserStatus(m.msg || 'Could not join that game.'));
  N.on('lobby', m => { lobbyData = m; isHost = (m.hostId === myId); RC.isHost = isHost; if (m.code) roomCode = m.code; roomPublic = m.public; renderLobby(); renderPresence(); renderVoice(); });
  N.on('toLobby', () => { started = false; game.over = null; overlayShown = false; overlay.classList.add('hidden'); showLobby(); });

  N.on('start', m => {
    startOnline(m);
    if (RC.Voice) RC.Voice.autoJoin().then(renderVoice);
  });
  N.on('snap', m => {
    if (!started || !RC.online) return;
    RC.Net.applySnapshot(game, m.s);
    if (firstSnap) {
      firstSnap = false;
      const c = game.buildings.find(b => b.owner === game.playerOwner && b.def.isCore);
      if (c) RC.Input.centerOn(c.x, c.y);
    }
  });
  N.on('over', m => {
    if (m.survival) {
      // Co-op run ended — the crystal fell. Everyone sees the same wave/score.
      game.survival = true;
      game.survivalWave = m.wave || game.survivalWave || 0;
      game.survivalKills = m.kills || game.survivalKills || 0;
      game.survivalDiff = m.diff || game.survivalDiff || 'medium';
      game.over = 'lose';
      return;
    }
    game.over = (m.team === myTeam) ? 'win' : 'lose';
  });

  function renderLobby() {
    if (!lobbyData) return;
    const codeEl = document.getElementById('lobby-code');
    if (codeEl) codeEl.textContent = roomPublic ? '🌐 Public game' : ('🔒 Private — share code: ' + (roomCode || ''));
    // players
    const pw = document.getElementById('lobby-players');
    pw.innerHTML = '';
    (lobbyData.players || []).forEach(p => {
      const el = document.createElement('div');
      el.className = 'pchip' + (p.id === myId ? ' me' : '');
      const rn = RC.RACES[p.race] ? RC.RACES[p.race].name : p.race;
      el.innerHTML = `<div class="pn">${p.name}${p.id === lobbyData.hostId ? ' 👑' : ''}</div><div class="pr">${rn}</div>`;
      pw.appendChild(el);
    });
    // my faction — 시작 화면과 같은 얼굴 카드
    const rw = document.getElementById('lobby-races');
    rw.innerHTML = '';
    raceFaces.length = 0;
    RC.RACE_ORDER.forEach(rid => {
      const r = RC.RACES[rid];
      const b = document.createElement('div');
      b.className = 'modebtn racebtn' + (rid === myRace ? ' sel' : '');
      b.style.borderTopColor = r.tint;
      b.innerHTML = `<canvas class="race-face" width="150" height="120"></canvas>` +
                    `<div class="mb-name" style="color:${r.tint}">${r.name}</div><div class="mb-sub">${r.blurb}</div>`;
      b.addEventListener('click', () => { myRace = rid; N.send({ t: 'race', race: rid }); renderLobby(); });
      rw.appendChild(b);
      raceFaces.push({ cv: b.querySelector('canvas'), race: rid });
    });
    drawRaceFaces();
    // Survival co-op lobbies swap the map/mode pickers for a difficulty picker.
    const isSurvival = lobbyData.gameMode === 'survival';
    const vsOpts = document.getElementById('lobby-vs-opts');
    const svOpts = document.getElementById('lobby-sv-opts');
    // These two carry an inline display:flex, and there is no generic .hidden rule —
    // so toggling the class never hid them. A versus lobby was showing an empty
    // "Difficulty" heading, and a survival lobby was showing Map and Mode pickers
    // that do nothing. Set display directly so the inline style is the one changing.
    if (vsOpts) vsOpts.style.display = isSurvival ? 'none' : 'flex';
    if (svOpts) svOpts.style.display = isSurvival ? 'flex' : 'none';
    const codeLine = document.getElementById('lobby-code');
    if (codeLine && isSurvival) {
      codeLine.textContent = (roomPublic ? '🌐 Public co-op' : ('🔒 Private co-op — share code: ' + (roomCode || ''))) +
                             `  ·  ${(lobbyData.players || []).length}/${lobbyData.cap || 4} defenders`;
    }

    // host controls
    const hostBox = document.getElementById('lobby-host');
    const startBtn = document.getElementById('lobby-start');
    if (isHost) {
      hostBox.classList.remove('hidden'); startBtn.classList.remove('hidden');
      startBtn.textContent = isSurvival ? 'Start Survival' : 'Start Match';
      if (isSurvival) {
        const dw = document.getElementById('lobby-diffs'); dw.innerHTML = '';
        DIFFS.forEach(d => {
          const c = document.createElement('div');
          c.className = 'modebtn' + (d.id === lobbyData.diff ? ' sel' : '');
          c.innerHTML = `<div class="mb-name">${d.name}</div><div class="mb-sub">${d.sub}</div>`;
          c.addEventListener('click', () => N.send({ t: 'diff', diff: d.id }));
          dw.appendChild(c);
        });
        setStatus('You are the host. Pick a difficulty and press Start. Everyone defends one shared crystal.');
      } else {
        const mw = document.getElementById('lobby-maps'); mw.innerHTML = '';
        RC.MAPS.forEach(map => {
          const c = document.createElement('div');
          c.className = 'modebtn' + (map.id === lobbyData.mapId ? ' sel' : '');
          c.innerHTML = `<div class="mb-name">${map.name}</div>`;
          c.addEventListener('click', () => N.send({ t: 'map', mapId: map.id }));
          mw.appendChild(c);
        });
        const mo = document.getElementById('lobby-modes'); mo.innerHTML = '';
        Object.values(RC.MODES).forEach(mm => {
          const c = document.createElement('div');
          c.className = 'modebtn' + (mm.id === lobbyData.modeId ? ' sel' : '');
          c.innerHTML = `<div class="mb-name">${mm.name}</div>`;
          c.addEventListener('click', () => N.send({ t: 'mode', modeId: mm.id }));
          mo.appendChild(c);
        });
        setStatus('You are the host. Pick map/mode and press Start. Empty seats are filled by AI.');
      }
    } else {
      hostBox.classList.add('hidden'); startBtn.classList.add('hidden');
      setStatus(isSurvival ? 'Waiting for the host to start the run…' : 'Waiting for the host to start…');
    }
  }

  function startOnline(m) {
    RC.online = true;
    goFullscreen();
    audioGo();
    game.heroesEnabled = false;      // online matches run on the server, which has no heroes

    if (m.survival) {
      // Co-op Survival — build the survival map locally so terrain/fog/nav exist, then
      // let snapshots drive every entity (the server owns the wave director and crystal).
      game.setupSurvival({
        difficulty: m.diff,
        players: (m.rosters || []).map(r => ({ owner: r.owner, race: r.race, ai: r.ai })),
      });
    } else {
      const map = RC.getMap(m.mapId);
      const mode = RC.MODES[m.modeId] || RC.MODES['1v1'];
      game.setup(map, mode);               // builds world/terrain/obstacles + fog grid
    }

    game.units = []; game.buildings = []; game.nodes = [];
    game._umap = new Map(); game._bmap = new Map(); game._nmap = new Map();
    game.crystal = null;                   // re-linked from the first snapshot by id
    game.playerOwner = m.owner;
    game.teamMap = {}; (m.rosters || []).forEach(r => { game.teamMap[r.owner] = r.team; });
    if (m.survival) game.teamMap[2] = 2;   // the wave horde
    myTeam = m.team; firstSnap = true;
    game.over = null; overlayShown = false;
    resize();
    lobbyEl.classList.add('hidden'); ss.classList.add('hidden'); overlay.classList.add('hidden');
    started = true;
  }

  // ── ?join=CODE ─────────────────────────────────────────
  // Someone clicked a friend's invite link. Skip the menu entirely: connect and
  // join that room. If they have no nickname yet we ask for it first, then carry
  // on to the same place.
  let pendingJoinCode = null;
  (function readJoinLink() {
    try {
      const m = /[?&]join=([^&]*)/.exec(location.search || '');
      if (!m) return;
      const code = decodeURIComponent(m[1] || '').trim().toUpperCase().slice(0, 8);
      if (code.length >= 3) pendingJoinCode = code;
      // Clean the address bar so a refresh does not try to re-join a dead room.
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', location.pathname);
      }
    } catch (e) {}
  })();
  function followJoinLink() {
    if (!pendingJoinCode) return false;
    const code = pendingJoinCode;
    if (!myName()) { openNickname(() => followJoinLink()); return true; }
    pendingJoinCode = null;
    openBrowser('vs');
    setBrowserStatus('Joining your friend\u2019s game (' + code + ')…');
    // The socket is not open yet; go as soon as it is.
    const send = () => N.send({ t: 'join', code });
    if (N.connected) send();
    else {
      let tries = 0;
      const iv = setInterval(() => {
        if (N.connected) { clearInterval(iv); send(); }
        else if (++tries > 60) { clearInterval(iv); setBrowserStatus('Could not reach the server — press Back and try again.'); }
      }, 250);
    }
    return true;
  }

  buildStartScreen();
  applyGameMode(selGameMode);
  renderWho();
  // First launch — ask who they are before the menu. Anyone who already has a name
  // (including from posting a leaderboard score) walks straight past this.
  if (!myName() && !pendingJoinCode) openNickname(null);
  followJoinLink();          // an invite link overrides the menu

  // ── 루프 ──────────────────────────────────────────
  let last = performance.now();
  let overlayShown = false;
  let faceAcc = 0;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    if (started) {
      RC.Input.updateCamera(dt);
      if (!RC.online) {
        game.update(dt);
        // Dev/test mode cheats + fast-forward (offline only; no-op if dev.js is absent)
        if (RC.Dev) RC.Dev.tick(game, dt);
        if (game.practice && practiceHints) {
          for (const h of practiceHints) { if (!h.done && game.time >= h.t) { h.done = true; game.notify(h.msg); } }
        }
      } else {
        // online: server ticks the sim; here we just keep selection valid + recompute local fog
        const uset = new Set(game.units), bset = new Set(game.buildings);
        game.selection = game.selection.filter(e => uset.has(e) || bset.has(e));
        if (RC.CFG.FOG_ENABLED && game.visNow) game.updateVision();
      }
      if (game.marks && game.marks.length) { for (const m of game.marks) m.t -= dt; game.marks = game.marks.filter(m => m.t > 0); }
      RC.Renderer.draw(game, RC.Input.state);
      RC.UI.update();

      if (game.over && !overlayShown) {
        overlayShown = true;
        RC.UI.showOverlay(game.over);
        if (RC.Audio) RC.Audio.play(game.over === 'win' ? 'win' : 'lose');
      }
      if (!game.over) overlayShown = false;
    } else {
      // 메뉴 화면 — 종족 얼굴만 가볍게 애니메이션 (초당 ~20프레임)
      faceAcc += dt;
      if (faceAcc >= 0.05) { faceAcc = 0; drawRaceFaces(); }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.GAME = game;
})();
