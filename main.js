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

  // ── 시작 화면 ─────────────────────────────────────
  const ss = document.getElementById('startscreen');
  const overlay = document.getElementById('overlay');
  let started = false;
  let selMap = RC.MAPS[0].id;
  let selMode = '1v1';
  let selRace = 'forge';

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

    // 종족 선택
    const raceWrap = document.getElementById('ss-races');
    if (raceWrap) {
      raceWrap.innerHTML = '';
      RC.RACE_ORDER.forEach(rid => {
        const r = RC.RACES[rid];
        const btn = document.createElement('div');
        btn.className = 'modebtn racebtn' + (rid === selRace ? ' sel' : '');
        btn.style.borderTopColor = r.tint;
        btn.innerHTML = `<div class="mb-name" style="color:${r.tint}">${r.name}</div>` +
                        `<div class="mb-sub">${r.blurb}</div>`;
        btn.addEventListener('click', () => {
          selRace = rid;
          raceWrap.querySelectorAll('.modebtn').forEach(c => c.classList.remove('sel'));
          btn.classList.add('sel');
        });
        raceWrap.appendChild(btn);
      });
    }
  }

  function startGame() {
    RC.online = false;
    game.playerOwner = 1;
    // my faction = selection, AI takes the opposite (guarantees Forge vs Gloop)
    const other = selRace === 'forge' ? 'gloop' : 'forge';
    const mode = RC.MODES[selMode];
    const racePick = {};
    mode.players.forEach(p => { racePick[p.owner] = p.ai ? other : selRace; });
    game.setup(RC.getMap(selMap), mode, racePick);
    RC.AI.reset();
    resize();
    RC.Input.centerOn(game.spawn1.x, game.spawn1.y);
    ss.classList.add('hidden');
    overlay.classList.add('hidden');
    started = true;
  }

  function openMenu() {
    started = false;
    if (RC.online) { RC.NetClient.close(); RC.online = false; }
    document.getElementById('lobby').classList.add('hidden');
    overlay.classList.add('hidden');
    buildStartScreen();
    ss.classList.remove('hidden');
  }

  document.getElementById('ss-start').addEventListener('click', startGame);
  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) btnMenu.addEventListener('click', openMenu);

  // ── Online (LAN) ──────────────────────────────────
  const lobbyEl = document.getElementById('lobby');
  const N = RC.NetClient;
  let myId = null, isHost = false, lobbyData = null, myRace = 'forge', myTeam = null, firstSnap = false;

  function showLobby() { ss.classList.add('hidden'); overlay.classList.add('hidden'); lobbyEl.classList.remove('hidden'); }
  function setStatus(msg) { document.getElementById('lobby-status').textContent = msg; }

  document.getElementById('ss-online').addEventListener('click', () => {
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    showLobby(); setStatus('Connecting to ' + location.host + ' …');
    N.connect(url);
  });
  document.getElementById('btn-menu2').addEventListener('click', () => {
    N.close(); RC.online = false; started = false;
    lobbyEl.classList.add('hidden'); openMenu();
  });
  document.getElementById('lobby-start').addEventListener('click', () => N.send({ t: 'start' }));

  N.on('__open', () => setStatus('Connected. Waiting in lobby…'));
  N.on('__error', () => setStatus('Could not connect. Is the server running on this address?'));
  N.on('__close', () => { if (!started) setStatus('Disconnected from server.'); });

  N.on('welcome', m => { myId = m.id; isHost = m.host; lobbyData = lobbyData || {}; renderLobby(); });
  N.on('lobby', m => { lobbyData = m; isHost = (m.hostId === myId); renderLobby(); });
  N.on('toLobby', () => { started = false; game.over = null; overlayShown = false; overlay.classList.add('hidden'); showLobby(); });

  N.on('start', m => startOnline(m));
  N.on('snap', m => {
    if (!started || !RC.online) return;
    RC.Net.applySnapshot(game, m.s);
    if (firstSnap) {
      firstSnap = false;
      const c = game.buildings.find(b => b.owner === game.playerOwner && b.def.isCore);
      if (c) RC.Input.centerOn(c.x, c.y);
    }
  });
  N.on('over', m => { game.over = (m.team === myTeam) ? 'win' : 'lose'; });

  function renderLobby() {
    if (!lobbyData) return;
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
    // my faction
    const rw = document.getElementById('lobby-races');
    rw.innerHTML = '';
    RC.RACE_ORDER.forEach(rid => {
      const r = RC.RACES[rid];
      const b = document.createElement('div');
      b.className = 'modebtn racebtn' + (rid === myRace ? ' sel' : '');
      b.style.borderTopColor = r.tint;
      b.innerHTML = `<div class="mb-name" style="color:${r.tint}">${r.name}</div><div class="mb-sub">${r.blurb}</div>`;
      b.addEventListener('click', () => { myRace = rid; N.send({ t: 'race', race: rid }); renderLobby(); });
      rw.appendChild(b);
    });
    // host controls
    const hostBox = document.getElementById('lobby-host');
    const startBtn = document.getElementById('lobby-start');
    if (isHost) {
      hostBox.classList.remove('hidden'); startBtn.classList.remove('hidden');
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
    } else {
      hostBox.classList.add('hidden'); startBtn.classList.add('hidden');
      setStatus('Waiting for the host to start…');
    }
  }

  function startOnline(m) {
    RC.online = true;
    const map = RC.getMap(m.mapId);
    const mode = RC.MODES[m.modeId] || RC.MODES['1v1'];
    game.setup(map, mode);                 // builds world/terrain/obstacles + fog grid
    game.units = []; game.buildings = []; game.nodes = [];
    game._umap = new Map(); game._bmap = new Map(); game._nmap = new Map();
    game.playerOwner = m.owner;
    game.teamMap = {}; (m.rosters || []).forEach(r => { game.teamMap[r.owner] = r.team; });
    myTeam = m.team; firstSnap = true;
    game.over = null; overlayShown = false;
    resize();
    lobbyEl.classList.add('hidden'); ss.classList.add('hidden'); overlay.classList.add('hidden');
    started = true;
  }

  buildStartScreen();

  // ── 루프 ──────────────────────────────────────────
  let last = performance.now();
  let overlayShown = false;

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    if (started) {
      RC.Input.updateCamera(dt);
      if (!RC.online) {
        game.update(dt);
      } else {
        // online: server ticks the sim; here we just keep selection valid + recompute local fog
        const uset = new Set(game.units), bset = new Set(game.buildings);
        game.selection = game.selection.filter(e => uset.has(e) || bset.has(e));
        if (RC.CFG.FOG_ENABLED && game.visNow) game.updateVision();
      }
      RC.Renderer.draw(game, RC.Input.state);
      RC.UI.update();

      if (game.over && !overlayShown) { overlayShown = true; RC.UI.showOverlay(game.over); }
      if (!game.over) overlayShown = false;
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.GAME = game;
})();
