// RIFT CLASH — Dev / Test mode
// A self-contained cheat panel for testing the whole game quickly: unlimited shards,
// no population limit, instant buildings and units, max upgrades, fast-forward, and
// one-click squad spawning.
//
// DEV MODE IS OFF BY DEFAULT, ALWAYS. There is exactly one way in:
//
//   tap the "Made in ... Game Studio" credit on the start screen 5 times,
//   then enter the PASSCODE.
//
// That is deliberately the only door. The unlock is NOT remembered: every page
// load starts locked, so a machine that was used for testing yesterday is an
// ordinary player's machine today. The URL-parameter shortcut was removed too —
// it put the plaintext code in the address bar and the browser history.
// The ` key only shows/hides the panel once it has already been unlocked in
// this session; while locked it does nothing at all, so a curious player never
// learns dev mode exists.
//
// The code itself is deliberately NOT written anywhere in this file — only a
// hash of it — so it can't be read straight out of the source. To set your own:
// run  RC.Dev.hashOf('yournewcode')  in the browser console and paste the number
// into CODE_HASH below. (A browser game can never truly hide a secret; this just
// keeps curious players out.)
//
// OFFLINE ONLY. Online matches run on the server's authoritative simulation, so these
// switches would do nothing there anyway — the panel refuses to run rather than
// pretending to work. Deleting this file (and its <script> tag) removes dev mode
// entirely with no other changes needed.
window.RC = window.RC || {};

RC.Dev = (function () {
  const UNLOCK_KEY = 'riftclash_devmode';
  const MONEY = 999999;

  // Passcode, stored as an FNV-1a hash of the lower-cased code (never the code itself).
  // Generate a new one with RC.Dev.hashOf('yourcode') and paste the number here.
  const CODE_HASH = 1028267028;
  const MAX_TRIES = 5;              // wrong guesses before a cool-down
  const LOCK_MS = 30000;

  function hashOf(str) {
    let h = 0x811c9dc5;
    const t = String(str == null ? '' : str).trim().toLowerCase();
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  function codeOk(str) { return hashOf(str) === CODE_HASH; }

  let tries = 0, lockedUntil = 0;

  let unlocked = false;      // panel is available
  let open = false;          // panel is on screen
  let panel = null;
  let game = null;           // set on first tick

  // Individual switches — the money/pop/instant ones are the big time savers, so on by default.
  const T = {
    money: true,       // keep shards pinned at 999,999
    pop: true,         // ignore the population cap
    build: true,       // buildings finish the moment they're placed
    train: true,       // units pop out instantly
    reveal: false,     // no fog of war
  };
  let speed = 1;       // 1 / 2 / 4 — extra simulation steps per frame

  function isOnline() { return !!RC.online; }

  // ── styles (injected so index.html only needs the <script> tag) ──
  function injectStyles() {
    if (document.getElementById('dev-style')) return;
    const s = document.createElement('style');
    s.id = 'dev-style';
    s.textContent = `
    #dev-panel{position:fixed;top:56px;right:12px;z-index:90;width:212px;
      background:rgba(10,16,24,.95);border:2px solid #f0a02a;border-radius:9px;
      padding:10px 11px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      color:#e8f1fa;box-shadow:0 10px 30px rgba(0,0,0,.6)}
    #dev-panel.hidden{display:none}
    #dev-panel h4{margin:0 0 7px;font-size:12px;letter-spacing:.14em;color:#f0a02a;
      font-family:ui-monospace,Menlo,Consolas,monospace}
    #dev-panel .row{display:flex;align-items:center;gap:7px;font-size:12.5px;
      padding:3px 0;cursor:pointer;user-select:none}
    #dev-panel .row:hover{color:#fff}
    #dev-panel .box{width:15px;height:15px;flex:none;border:2px solid #43566b;border-radius:4px;
      display:flex;align-items:center;justify-content:center;font-size:11px;color:#0d1219}
    #dev-panel .box.on{background:#5ddc7a;border-color:#5ddc7a}
    #dev-panel .sep{height:1px;background:#2a3a4d;margin:8px 0}
    #dev-panel .btn{display:block;width:100%;margin:4px 0;padding:6px 8px;font-size:12px;
      font-weight:700;border:1px solid #43566b;border-radius:5px;background:#18232f;
      color:#dbe7f3;cursor:pointer;font-family:inherit;text-align:left}
    #dev-panel .btn:hover{background:#233241}
    #dev-panel .spd{display:flex;gap:5px;margin:5px 0}
    #dev-panel .spd b{flex:1;text-align:center;padding:5px 0;font-size:12px;border-radius:5px;
      border:1px solid #43566b;background:#18232f;cursor:pointer;font-weight:700}
    #dev-panel .spd b.on{background:#f0a02a;color:#12181f;border-color:#f0a02a}
    #dev-panel .note{font-size:10.5px;color:#7f93a8;margin-top:7px;line-height:1.35}
    #dev-panel .exit{border-color:#8a4a3a;color:#ffb0a0}
    #dev-badge{position:fixed;top:56px;right:12px;z-index:89;background:#f0a02a;color:#12181f;
      font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:11px;
      letter-spacing:.12em;padding:4px 9px;border-radius:5px;cursor:pointer}
    #dev-badge.hidden{display:none}
    #dev-gate{position:fixed;inset:0;z-index:200;background:rgba(5,9,15,.72);
      display:flex;align-items:center;justify-content:center;
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    #dev-gate.hidden{display:none}
    #dev-gate .card{background:#101923;border:2px solid #f0a02a;border-radius:11px;
      padding:22px 24px;width:290px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.7)}
    #dev-gate h4{margin:0 0 4px;font-size:13px;letter-spacing:.16em;color:#f0a02a;
      font-family:ui-monospace,Menlo,Consolas,monospace}
    #dev-gate .sub{font-size:12.5px;color:#8ba0b6;margin-bottom:13px}
    #dev-gate input{width:100%;padding:10px 12px;font-size:16px;text-align:center;
      letter-spacing:.14em;border-radius:6px;border:1px solid #43566b;background:#0a1119;
      color:#e8f1fa;font-family:ui-monospace,Menlo,Consolas,monospace}
    #dev-gate #dev-code-msg{min-height:17px;font-size:12px;color:#8ba0b6;margin-top:8px}
    #dev-gate #dev-code-msg.bad{color:#ff8f7d}
    #dev-gate .acts{display:flex;gap:8px;margin-top:10px}
    #dev-gate .btn{flex:1;padding:9px 0;font-size:13px;font-weight:700;border-radius:6px;
      border:1px solid #43566b;background:#18232f;color:#dbe7f3;cursor:pointer;font-family:inherit}
    #dev-gate .btn.go{background:#f0a02a;color:#12181f;border-color:#f0a02a}
    #dev-gate .card.shake{animation:devshake .32s}
    @keyframes devshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}
      40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}`;
    document.head.appendChild(s);
  }

  // ── passcode gate ──
  function promptCode() {
    injectStyles();
    let box = document.getElementById('dev-gate');
    if (box) { box.classList.remove('hidden'); focusInput(); return; }
    box = document.createElement('div');
    box.id = 'dev-gate';
    box.innerHTML =
      `<div class="card">
         <h4>🛠 DEV / TEST MODE</h4>
         <div class="sub">Enter the passcode</div>
         <input id="dev-code" type="password" autocomplete="off" maxlength="32" placeholder="passcode">
         <div id="dev-code-msg"></div>
         <div class="acts">
           <button class="btn go" data-g="ok">Unlock</button>
           <button class="btn" data-g="cancel">Cancel</button>
         </div>
       </div>`;
    document.body.appendChild(box);
    box.querySelector('[data-g="ok"]').addEventListener('click', trySubmit);
    box.querySelector('[data-g="cancel"]').addEventListener('click', closeGate);
    const inp = box.querySelector('#dev-code');
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); trySubmit(); }
      if (e.key === 'Escape') { e.preventDefault(); closeGate(); }
    });
    focusInput();
  }
  function focusInput() {
    const i = document.getElementById('dev-code');
    if (i) { i.value = ''; setTimeout(() => i.focus(), 30); }
  }
  function closeGate() {
    const box = document.getElementById('dev-gate');
    if (box) box.classList.add('hidden');
  }
  function gateMsg(text, bad) {
    const m = document.getElementById('dev-code-msg');
    if (m) { m.textContent = text || ''; m.className = bad ? 'bad' : ''; }
  }
  function trySubmit() {
    const inp = document.getElementById('dev-code');
    if (!inp) return;
    const now = Date.now();
    if (now < lockedUntil) {
      gateMsg('Too many tries — wait ' + Math.ceil((lockedUntil - now) / 1000) + 's', true);
      return;
    }
    if (codeOk(inp.value)) {
      tries = 0;
      closeGate();
      enable();
      return;
    }
    tries++;
    inp.value = '';
    const card = document.querySelector('#dev-gate .card');
    if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
    if (tries >= MAX_TRIES) {
      lockedUntil = now + LOCK_MS;
      tries = 0;
      gateMsg('Too many tries — locked for ' + (LOCK_MS / 1000) + 's', true);
    } else {
      gateMsg('Wrong passcode (' + (MAX_TRIES - tries) + ' left)', true);
    }
  }

  function row(label, key) {
    return `<div class="row" data-t="${key}"><span class="box${T[key] ? ' on' : ''}">${T[key] ? '✓' : ''}</span>${label}</div>`;
  }

  function render() {
    if (!panel) return;
    panel.innerHTML =
      `<h4>🛠 DEV / TEST</h4>` +
      row('💰 Shards 999,999', 'money') +
      row('👥 No population cap', 'pop') +
      row('⚡ Instant buildings', 'build') +
      row('🏭 Instant units', 'train') +
      row('👁 Reveal whole map', 'reveal') +
      `<div class="sep"></div>` +
      `<div class="spd">` +
        [1, 2, 4].map(v => `<b data-s="${v}" class="${speed === v ? 'on' : ''}">x${v}</b>`).join('') +
      `</div>` +
      `<div class="sep"></div>` +
      `<button class="btn" data-a="upgrades">⬆ Max all upgrades</button>` +
      `<button class="btn" data-a="army">🧪 Spawn one of each unit</button>` +
      `<button class="btn" data-a="enemy">👾 Spawn enemy squad</button>` +
      `<button class="btn" data-a="wipe">💥 Kill all enemy units</button>` +
      `<button class="btn" data-a="win">🏆 Force win</button>` +
      `<button class="btn" data-a="lose">💀 Force lose</button>` +
      `<button class="btn exit" data-a="off">✖ Exit dev mode</button>` +
      `<div class="note">Press \` to hide/show this panel. Offline only — online games run on the server.</div>`;

    panel.querySelectorAll('.row').forEach(el => el.addEventListener('click', () => {
      const k = el.dataset.t;
      T[k] = !T[k];
      if (k === 'reveal') applyReveal();
      if (k === 'pop') applyPop();
      render();
    }));
    panel.querySelectorAll('.spd b').forEach(el => el.addEventListener('click', () => {
      speed = parseInt(el.dataset.s, 10) || 1;
      render();
    }));
    panel.querySelectorAll('.btn').forEach(el => el.addEventListener('click', () => action(el.dataset.a)));
  }

  function ensurePanel() {
    injectStyles();
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'dev-panel';
      document.body.appendChild(panel);
      const badge = document.createElement('div');
      badge.id = 'dev-badge';
      badge.textContent = '🛠 DEV';
      badge.title = 'Open the dev panel (Ctrl+Shift+D)';
      badge.addEventListener('click', () => setOpen(true));
      document.body.appendChild(badge);
    }
    render();
  }

  function setOpen(v) {
    open = v;
    ensurePanel();
    panel.classList.toggle('hidden', !open);
    const badge = document.getElementById('dev-badge');
    if (badge) badge.classList.toggle('hidden', open || !unlocked);
  }

  // ── cheats that need to be (un)applied rather than ticked ──
  function applyReveal() {
    if (!RC.CFG) return;
    RC.CFG.FOG_ENABLED = !(unlocked && T.reveal);
    if (game && game.updateVision && RC.CFG.FOG_ENABLED) game.updateVision();
  }
  // supply() caps max at the buildings you own; wrap it rather than editing the engine.
  function applyPop() {
    if (!game) return;
    if (unlocked && T.pop) {
      if (!game.__devSupply) {
        game.__devSupply = game.supply.bind(game);
        game.supply = function (owner) {
          const s = game.__devSupply(owner);
          return { used: s.used, max: 999 };
        };
      }
    } else if (game.__devSupply) {
      delete game.supply;                 // fall back to the prototype method
      game.__devSupply = null;
    }
  }

  function me() { return game ? game.playerOwner : 1; }
  function myRace() {
    return (game && game.playerRace && game.playerRace[me()]) || 'forge';
  }
  // Centre of the current view, in world coordinates.
  function viewCentre() {
    const cv = document.getElementById('screen');
    const w = cv ? cv.width : 1200, h = cv ? cv.height : 600;
    return { x: game.camera.x + w / 2, y: game.camera.y + h / 2 };
  }
  function unitsOfRace(race) {
    return Object.keys(RC.UNITS).filter(k => {
      const d = RC.UNITS[k];
      return !d.hero && (d.race || 'forge') === race;
    });
  }
  function spawnSquad(owner, types, at) {
    let n = 0;
    types.forEach((t, i) => {
      const a = (i / Math.max(1, types.length)) * Math.PI * 2;
      const rad = 70 + (i % 3) * 46;
      const u = new RC.Unit(t, at.x + Math.cos(a) * rad, at.y + Math.sin(a) * rad, owner);
      if (game.initUnit) game.initUnit(u);
      game.units.push(u);
      n++;
    });
    return n;
  }

  function action(a) {
    if (!game) return;
    if (a === 'off') { disable(); return; }
    if (isOnline()) { game.notify('Dev mode is offline-only'); return; }

    if (a === 'upgrades') {
      const kinds = RC.UPGRADE_ORDER || Object.keys(RC.UPGRADES);
      kinds.forEach(k => {
        const max = RC.UPGRADES[k].costs.length;
        for (let i = game.upLevel(me(), k); i < max; i++) game.applyUpgrade(me(), k);
      });
      game.notify('All upgrades maxed');
    } else if (a === 'army') {
      const n = spawnSquad(me(), unitsOfRace(myRace()), viewCentre());
      game.notify('Spawned ' + n + ' units (one of each ' + (RC.RACES[myRace()] || {}).name + ')');
    } else if (a === 'enemy') {
      const foe = game.players.find(p => game.areEnemies(p.owner, me()));
      if (!foe) { game.notify('No enemy in this game'); return; }
      const race = game.playerRace[foe.owner] || 'gloop';
      const c = viewCentre();
      const n = spawnSquad(foe.owner, unitsOfRace(race), { x: c.x + 320, y: c.y });
      game.notify('Spawned ' + n + ' enemy units');
    } else if (a === 'wipe') {
      // Remove them outright rather than just zeroing HP: heroes go "downed" and
      // auto-revive instead of dying, so a plain kill would leave one standing.
      const gone = [];
      game.units = game.units.filter(u => {
        if (!u.dead && game.areEnemies(u.owner, me())) { gone.push(u); return false; }
        return true;
      });
      gone.forEach(u => {
        u.dead = true;
        if (u.hero && game.heroOf) delete game.heroOf[u.owner];
      });
      game.selection = game.selection.filter(e => gone.indexOf(e) < 0);
      game.notify('Removed ' + gone.length + ' enemy units');
    } else if (a === 'win') {
      game.over = 'win';
    } else if (a === 'lose') {
      game.over = 'lose';
    }
  }

  // ── per-frame application, called from main.js ──
  function tick(g, dt) {
    game = g;
    if (!unlocked || isOnline() || !g) return;
    if (g.over) return;

    if (T.money && g.res && g.res[g.playerOwner]) g.res[g.playerOwner].shard = MONEY;
    if (T.pop && !g.__devSupply) applyPop();

    if (T.build) {
      for (const b of g.buildings) {
        if (b.owner !== g.playerOwner || b.dead || b.done) continue;
        b.buildProgress = 1;
        b.hp = b.maxHp;
        b.shield = b.maxShield || 0;
      }
    }
    if (T.train) {
      for (const b of g.buildings) {
        if (b.owner !== g.playerOwner || b.dead || !b.queue.length) continue;
        b.queue[0].timeLeft = Math.min(b.queue[0].timeLeft, 0.001);   // let the normal path finish it
        if (b.research) b.research.timeLeft = Math.min(b.research.timeLeft, 0.001);
      }
    }
    // Fast-forward: main.js already ran one update this frame, so add the rest.
    for (let i = 1; i < speed; i++) g.update(dt);
  }

  // ── enable / disable ──
  function enable(quiet) {
    unlocked = true;
    // Deliberately NOT persisted. Dev mode lasts for this page load only.
    try { window.localStorage.removeItem(UNLOCK_KEY); } catch (e) {}
    ensurePanel();
    setOpen(true);
    applyReveal();
    applyPop();
    if (game && !quiet) game.notify('🛠 Dev mode ON');
  }
  function disable() {
    unlocked = false;
    T.reveal = false;
    try { window.localStorage.removeItem(UNLOCK_KEY); } catch (e) {}
    applyReveal();
    applyPop();
    speed = 1;
    setOpen(false);
    const badge = document.getElementById('dev-badge');
    if (badge) badge.classList.add('hidden');
    if (game) game.notify('Dev mode off');
  }

  function init() {
    // Start locked, every single time. Older builds remembered the unlock in
    // localStorage and switched dev mode on at load; wipe that so anyone carrying
    // the old flag comes back as a normal player.
    unlocked = false;
    try { window.localStorage.removeItem(UNLOCK_KEY); } catch (e) {}

    // Backtick/tilde only shows/hides an ALREADY unlocked panel. While locked it
    // is inert — no prompt, no hint that dev mode is there at all.
    window.addEventListener('keydown', e => {
      if (e.key !== '`' && e.key !== '~' && e.code !== 'Backquote') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!unlocked) return;             // locked: the key does nothing
      e.preventDefault();
      setOpen(!open);
    });

    // The one way in: five deliberate taps on the studio credit, then the passcode.
    // Works with a mouse or a finger, so a tablet needs no keyboard.
    const credit = document.getElementById('ss-credit');
    if (credit) {
      let taps = 0, last = 0;
      credit.style.cursor = 'default';
      credit.addEventListener('click', () => {
        const now = new Date().getTime();
        taps = (now - last < 3000) ? taps + 1 : 1;      // must be a deliberate run of taps
        last = now;
        if (taps >= 5) {
          taps = 0;
          if (unlocked) setOpen(!open); else promptCode();
        }
      });
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return {
    tick, enable, disable, hashOf, promptCode,
    get enabled() { return unlocked; },
    get speed() { return speed; },
    toggles: T,
  };
})();
