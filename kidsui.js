// RIFT CLASH — Kids mode screen
// ---------------------------------------------------------------------------
// The DOM half of Kids mode. kids.js holds the rules and never touches the page;
// this file holds the page and never holds rules. Everything here reads from a
// single snapshot (RC.Kids.hud(g)) and writes back through exactly two calls
// (RC.Kids.buy / RC.Kids.choose), so there is no second copy of the run state to
// drift out of agreement with the simulation.
//
// Why this lives outside ui.js: the normal HUD is a selection panel plus a command
// grid, and Kids mode has neither. Bolting a fourth branch onto renderPanel would
// mean every future change to the grown-up HUD has to be re-checked against a mode
// with no workers, no build list and no research. A separate overlay that ui.js
// simply hides is far harder to break by accident.
//
// The markup is built here rather than in index.html so the whole feature is one
// file you can delete.
window.RC = window.RC || {};

RC.KidsUI = (function () {
  let g = null, root = null, built = false;
  let els = {};
  let lastRosterSig = '';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  function build() {
    if (built) return;
    built = true;

    const css = document.createElement('style');
    css.textContent = `
/* Kids mode — big targets, high contrast, no small text anywhere. Every button is
   at least 64px tall because these get pressed by a finger on a tablet. */
#kids-ui { position:absolute; inset:0; pointer-events:none; z-index:40;
           font-family:inherit; display:none; }
#kids-ui.on { display:block; }

/* Top strip — crystal health, wave name, timer. The only three numbers in the mode. */
#kid-top { position:absolute; top:10px; left:50%; transform:translateX(-50%);
           display:flex; gap:10px; align-items:center; pointer-events:none; }
.kid-chip { background:rgba(10,14,22,.82); border:2px solid rgba(255,255,255,.14);
            border-radius:14px; padding:7px 14px; color:#eaf2ff; font-size:15px;
            font-weight:700; white-space:nowrap; }
.kid-chip b { font-size:19px; }
#kid-crystal { min-width:210px; }
#kid-cbar { height:12px; border-radius:7px; background:rgba(255,255,255,.14);
            overflow:hidden; margin-top:5px; }
#kid-cfill { height:100%; width:100%; border-radius:7px;
             background:linear-gradient(90deg,#63c7ff,#9ae6ff);
             transition:width .25s linear; }
#kid-cfill.hurt { background:linear-gradient(90deg,#ffb03d,#ffd88a); }
#kid-cfill.bad  { background:linear-gradient(90deg,#ff5a4d,#ff9c8f); }

/* Bottom shop — the three (then more) unit buttons. This is the whole interface. */
#kid-shop { position:absolute; bottom:14px; left:50%; transform:translateX(-50%);
            display:flex; gap:12px; pointer-events:auto; flex-wrap:wrap;
            justify-content:center; max-width:min(96vw,1000px); }
.kid-buy { width:132px; min-height:96px; border-radius:18px; cursor:pointer;
           background:linear-gradient(180deg,#243354,#16203a);
           border:3px solid rgba(255,255,255,.20); color:#eaf2ff;
           display:flex; flex-direction:column; align-items:center; gap:2px;
           padding:9px 6px 8px; position:relative; transition:transform .08s, filter .12s;
           user-select:none; -webkit-tap-highlight-color:transparent; }
.kid-buy:hover { filter:brightness(1.14); }
.kid-buy:active { transform:scale(.95); }
.kid-buy .ic   { font-size:27px; line-height:1; }
.kid-buy .role { font-size:15px; font-weight:800; letter-spacing:.2px; }
.kid-buy .nm   { font-size:10.5px; color:#9fb2d0; line-height:1.1; text-align:center; }
.kid-buy .cost { font-size:14px; font-weight:800; color:#ffd24a; margin-top:2px; }
.kid-buy.poor { opacity:.45; }
.kid-buy.poor .cost { color:#ff8f7d; }
.kid-buy .new { position:absolute; top:-9px; right:-7px; background:#5ddc7a; color:#07120b;
                font-size:10px; font-weight:900; padding:2px 7px; border-radius:9px;
                animation:kidpop 1s ease-in-out infinite; }
@keyframes kidpop { 0%,100%{transform:scale(1)} 50%{transform:scale(1.16)} }

/* Production queue — dots, not a list. "Three on the way" needs no reading. */
#kid-queue { position:absolute; bottom:118px; left:50%; transform:translateX(-50%);
             display:flex; gap:7px; pointer-events:none; }
.kid-qd { width:13px; height:13px; border-radius:50%; background:rgba(255,255,255,.22);
          border:2px solid rgba(255,255,255,.35); }
.kid-qd.go { background:#ffd24a; border-color:#ffe9a8; }

/* Big centre banner — wave names, unlocks, celebrations. */
#kid-banner { position:absolute; top:22%; left:50%; transform:translateX(-50%);
              text-align:center; pointer-events:none; opacity:0; }
#kid-banner.on { opacity:1; animation:kidbanner .45s cubic-bezier(.2,1.5,.4,1); }
@keyframes kidbanner { from{transform:translateX(-50%) scale(.55); opacity:0}
                       to{transform:translateX(-50%) scale(1); opacity:1} }
#kid-bic { font-size:64px; line-height:1; filter:drop-shadow(0 4px 10px rgba(0,0,0,.6)); }
#kid-btitle { font-size:42px; font-weight:900; letter-spacing:.5px; margin-top:2px;
              text-shadow:0 3px 0 rgba(0,0,0,.45), 0 0 26px currentColor; }
#kid-bsub { font-size:17px; font-weight:700; color:#dce7f7; margin-top:4px;
            text-shadow:0 2px 6px rgba(0,0,0,.8); }

/* Reward screen — the game is paused behind this. Exactly three cards, one tap. */
#kid-reward { position:absolute; inset:0; background:rgba(6,10,18,.86);
              display:none; flex-direction:column; align-items:center;
              justify-content:center; gap:20px; pointer-events:auto; padding:20px; }
#kid-reward.on { display:flex; }
#kid-rh { text-align:center; }
#kid-rh .big { font-size:38px; font-weight:900; color:#ffd24a;
               text-shadow:0 3px 0 rgba(0,0,0,.5); }
#kid-rh .sub { font-size:17px; font-weight:700; color:#cfe0f5; margin-top:4px; }
#kid-cards { display:flex; gap:18px; flex-wrap:wrap; justify-content:center; }
.kid-card { width:206px; min-height:224px; border-radius:22px; cursor:pointer;
            background:linear-gradient(180deg,#2b3a5e,#151e36);
            border:3px solid rgba(255,255,255,.22); color:#eaf2ff;
            display:flex; flex-direction:column; align-items:center;
            justify-content:center; gap:9px; padding:20px 15px; text-align:center;
            transition:transform .1s, border-color .12s, box-shadow .12s;
            user-select:none; -webkit-tap-highlight-color:transparent; }
.kid-card:hover { transform:translateY(-7px) scale(1.03); border-color:#ffd24a;
                  box-shadow:0 14px 34px rgba(255,210,74,.28); }
.kid-card:active { transform:scale(.96); }
.kid-card .ic { font-size:52px; line-height:1; }
.kid-card .nm { font-size:20px; font-weight:900; }
.kid-card .ds { font-size:13.5px; color:#adc0dc; line-height:1.35; }
.kid-card .tr { font-size:11px; font-weight:800; color:#ffd24a; letter-spacing:.6px; }

/* Next-wave warning, shown under the cards while the game is still paused —
   a heads-up the kid can actually spend their reward on. */
#kid-next { min-height:26px; font-size:16px; font-weight:800; text-align:center; }
#kid-next .w { display:inline-block; background:rgba(255,255,255,.08);
               border:2px solid currentColor; border-radius:14px; padding:6px 16px; }
#kid-next .t { font-weight:700; color:#cfe0f5; font-size:14px; margin-left:6px; }

/* ── Build bar ──────────────────────────────────────────────────────────────
   Left of the fighter shop and visibly a different KIND of thing: fighters walk out
   of the base on their own, buildings get put somewhere by you. The slot counter is
   the whole economy of it — a kid can see they have two of three used. */
#kid-build { position:absolute; left:14px; bottom:14px; display:flex; gap:8px;
             align-items:flex-end; pointer-events:auto; }
.kid-bb { width:76px; min-height:78px; border-radius:16px; cursor:pointer;
          background:linear-gradient(180deg,#3a3050,#1d1830);
          border:3px solid rgba(255,255,255,.20); color:#eaf2ff;
          display:flex; flex-direction:column; align-items:center; gap:1px;
          padding:7px 5px 6px; position:relative; transition:transform .08s, filter .12s;
          user-select:none; -webkit-tap-highlight-color:transparent; }
.kid-bb:hover { filter:brightness(1.14); }
.kid-bb:active { transform:scale(.94); }
.kid-bb .ic   { font-size:24px; line-height:1; }
.kid-bb .role { font-size:13px; font-weight:800; }
.kid-bb .cost { font-size:12.5px; font-weight:800; color:#ffd24a; }
.kid-bb.poor  { opacity:.45; }
.kid-bb.poor .cost { color:#ff8f7d; }
.kid-bb.on    { border-color:#8fe3ff; box-shadow:0 0 0 3px rgba(143,227,255,.30), 0 0 22px rgba(143,227,255,.45); }
#kid-slots { font-size:11.5px; font-weight:800; color:#9fb2d0; text-align:center;
             background:rgba(10,16,26,.72); border-radius:10px; padding:3px 8px;
             align-self:center; white-space:nowrap; }
#kid-slots.full { color:#ff8f7d; }
/* Tap-to-place hint, shown only while a building is armed. */
#kid-placing { position:absolute; top:64px; left:50%; transform:translateX(-50%);
               background:rgba(10,16,26,.86); border:2px solid #8fe3ff; border-radius:14px;
               padding:7px 16px; font-size:15px; font-weight:800; color:#eaf2ff;
               display:none; pointer-events:none; white-space:nowrap; }
#kid-placing.on { display:block; }

/* ── The hero's one button ──────────────────────────────────────────────────
   Sits apart from the shop, on the right, because it is not a purchase — it is the
   one thing in the mode that is free and can only be spent once. The ring IS the
   decision: a kid can see it filling and knows they are saving something up. */
#kid-sig { position:absolute; right:18px; bottom:96px; width:120px; height:120px;
           border-radius:50%; cursor:pointer; pointer-events:auto; display:none;
           align-items:center; justify-content:center; flex-direction:column;
           background:radial-gradient(circle at 50% 38%, #2c3d63, #131c31);
           border:4px solid rgba(255,255,255,.18); color:#eaf2ff;
           user-select:none; -webkit-tap-highlight-color:transparent;
           transition:transform .1s, border-color .15s, box-shadow .2s; }
#kid-sig.on { display:flex; }
#kid-sig .ic { font-size:40px; line-height:1; filter:drop-shadow(0 2px 5px rgba(0,0,0,.6)); }
#kid-sig .lb { font-size:11px; font-weight:900; letter-spacing:.4px; margin-top:1px;
               color:#9fb2d0; text-transform:uppercase; }
/* The charge ring. A conic gradient means no canvas and no per-frame drawing —
   one CSS variable moves and the browser does the rest. */
#kid-sig .ring { position:absolute; inset:-4px; border-radius:50%; pointer-events:none;
                 background:conic-gradient(#4fd6e8 calc(var(--c,0) * 1turn),
                                           rgba(255,255,255,.10) 0); mask:radial-gradient(
                 farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
                 -webkit-mask:radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px)); }
#kid-sig.ready { border-color:#ffd24a; box-shadow:0 0 0 4px rgba(255,210,74,.22), 0 0 34px rgba(255,210,74,.5);
                 animation:kidsigpulse 1.15s ease-in-out infinite; }
#kid-sig.ready .lb { color:#ffd24a; }
#kid-sig.ready .ring { background:conic-gradient(#ffd24a 1turn, #ffd24a 0); }
#kid-sig:active { transform:scale(.93); }
#kid-sig.down { opacity:.4; }
@keyframes kidsigpulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.06)} }
/* ── The two small hero buttons ────────────────────────────────────────────
   Stacked above the big one, and deliberately half its size: the ring is the thing
   worth waiting for, and these two are the thing you press all the time. Same shape
   so a kid reads them as the same kind of object. */
#kid-qe { position:absolute; right:46px; bottom:230px; display:none;
          flex-direction:column; gap:8px; pointer-events:auto; }
#kid-qe.on { display:flex; }
#kid-qe .b { width:64px; height:64px; border-radius:50%; cursor:pointer; position:relative;
             display:flex; align-items:center; justify-content:center;
             background:radial-gradient(circle at 50% 38%, #2c3d63, #131c31);
             border:3px solid rgba(255,255,255,.16); color:#eaf2ff; font-size:26px;
             user-select:none; -webkit-tap-highlight-color:transparent;
             transition:transform .1s, border-color .15s, box-shadow .2s; }
#kid-qe .b .ring { position:absolute; inset:-3px; border-radius:50%; pointer-events:none;
                   background:conic-gradient(#4fd6e8 calc(var(--c,0) * 1turn),
                                             rgba(255,255,255,.10) 0);
                   mask:radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));
                   -webkit-mask:radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px)); }
#kid-qe .b.ready { border-color:#7ef0a0; box-shadow:0 0 0 3px rgba(126,240,160,.2), 0 0 20px rgba(126,240,160,.4); }
#kid-qe .b.off { opacity:.42; }
#kid-qe .b:active { transform:scale(.92); }
@media (max-width:820px), (max-height:560px) {
  #kid-qe { right:25px; bottom:104px; gap:6px; }
  #kid-qe .b { width:48px; height:48px; font-size:20px; }
}
/* Upgrade badges — the run's story in three emoji. */
#kid-sig .ups { position:absolute; top:-10px; left:50%; transform:translateX(-50%);
                display:flex; gap:3px; font-size:15px; filter:drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
/* Hero cards get a gold edge so an ability upgrade never looks like a generic buff. */
.kid-card.hero { border-color:rgba(255,210,74,.55);
                 background:linear-gradient(180deg,#4a3c1e,#221a10); }

/* Kids mode hides the grown-up HUD entirely. */
body.kids-mode #hud { display:none !important; }
body.kids-mode #minimap { display:none !important; }
body.kids-mode #hint { display:none !important; }
body.kids-mode #touchbar .tbtn#tb-idle,
body.kids-mode #touchbar .tb-groups { display:none !important; }

/* ── Phones and short screens ──────────────────────────────────────────────
   The shop WRAPS on a wide screen, which is right there and wrong everywhere else:
   the roster grows from three buttons to nine as things unlock, and on a portrait
   phone that wrapped into a tall column straight up the middle of the battlefield —
   the kid could no longer see the thing they were defending.
   One row that scrolls sideways instead. It is one card tall no matter how many
   fighters unlock, which is the property that actually matters. */
@media (max-width:760px), (max-height:560px) {
  #kid-shop { flex-wrap:nowrap; overflow-x:auto; overflow-y:hidden;
              max-width:100vw; width:100vw; left:0; transform:none;
              justify-content:flex-start; padding:0 10px 2px; gap:8px;
              scrollbar-width:none; -webkit-overflow-scrolling:touch;
              /* room for the charge button on the right, so they never overlap */
              padding-right:118px;
              /* the strip itself must not eat taps meant for the map beside it */
              scroll-padding:10px; }
  #kid-shop::-webkit-scrollbar { display:none; }
  .kid-buy { width:88px; min-height:74px; flex:0 0 auto; border-radius:14px;
             border-width:2px; padding:6px 4px 5px; }
  .kid-buy .ic   { font-size:20px; }
  .kid-buy .role { font-size:12px; }
  .kid-buy .nm   { display:none; }        /* the role and the price are the decision */
  .kid-buy .cost { font-size:12px; }
  #kid-queue { bottom:92px; }
  .kid-card { width:150px; min-height:180px; }
  .kid-card .ic { font-size:40px; }
  #kid-build { left:8px; bottom:96px; gap:6px; }
  .kid-bb { width:60px; min-height:62px; padding:5px 3px 4px; border-width:2px; border-radius:12px; }
  .kid-bb .ic { font-size:19px; }
  .kid-bb .role { font-size:11px; }
  .kid-bb .cost { font-size:11px; }
  #kid-slots { font-size:10px; padding:2px 6px; }
  #kid-sig { width:82px; height:82px; right:8px; bottom:14px; }
  #kid-sig .ic { font-size:28px; }
  #kid-sig .lb { font-size:10px; }
  #kid-btitle { font-size:30px; }
  #kid-bic { font-size:48px; }
  /* The top strip wraps on a narrow phone and pushed the wave banner over the map. */
  #kid-top { flex-wrap:wrap; justify-content:center; max-width:96vw; gap:6px; }
}`;
    document.head.appendChild(css);

    root = document.createElement('div');
    root.id = 'kids-ui';
    root.innerHTML = `
      <div id="kid-top">
        <div class="kid-chip" id="kid-crystal">💎 Crystal <b id="kid-chp">100%</b>
          <div id="kid-cbar"><div id="kid-cfill"></div></div>
        </div>
        <div class="kid-chip" id="kid-wave">⚔️ <b>Get ready!</b></div>
        <div class="kid-chip" id="kid-timer">⏳ <b>0s</b></div>
      </div>
      <div id="kid-queue"></div>
      <div id="kid-shop"></div>
      <div id="kid-build"></div>
      <div id="kid-placing">Tap where you want it!</div>
      <div id="kid-qe"></div>
      <div id="kid-sig">
        <div class="ring"></div>
        <div class="ups"></div>
        <div class="ic">✨</div>
        <div class="lb">—</div>
      </div>
      <div id="kid-banner">
        <div id="kid-bic">🎉</div>
        <div id="kid-btitle">—</div>
        <div id="kid-bsub">—</div>
      </div>
      <div id="kid-reward">
        <div id="kid-rh">
          <div class="big" id="kid-rtitle">WAVE CLEARED!</div>
          <div class="sub">Pick one reward</div>
        </div>
        <div id="kid-cards"></div>
        <div id="kid-next"></div>
      </div>`;

    const stage = document.getElementById('stage') || document.body;
    stage.appendChild(root);

    els = {
      chp: root.querySelector('#kid-chp'),
      cfill: root.querySelector('#kid-cfill'),
      wave: root.querySelector('#kid-wave'),
      timer: root.querySelector('#kid-timer'),
      queue: root.querySelector('#kid-queue'),
      shop: root.querySelector('#kid-shop'),
      banner: root.querySelector('#kid-banner'),
      bic: root.querySelector('#kid-bic'),
      btitle: root.querySelector('#kid-btitle'),
      bsub: root.querySelector('#kid-bsub'),
      reward: root.querySelector('#kid-reward'),
      rtitle: root.querySelector('#kid-rtitle'),
      cards: root.querySelector('#kid-cards'),
      next: root.querySelector('#kid-next'),
      sig: root.querySelector('#kid-sig'),
      sigIc: root.querySelector('#kid-sig .ic'),
      sigLb: root.querySelector('#kid-sig .lb'),
      sigRing: root.querySelector('#kid-sig .ring'),
      sigUps: root.querySelector('#kid-sig .ups'),
      qe: root.querySelector('#kid-qe'),
      build: root.querySelector('#kid-build'),
      placing: root.querySelector('#kid-placing'),
    };
    // One tap fires it at the smartest spot — there is nothing to aim. The mode has no
    // build placement for the same reason: nothing to put down means nothing to put down
    // wrong, and a mis-tap would waste a charge the kid waited two minutes for.
    els.sig.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const h = g && g.heroOf && g.heroOf[g.playerOwner];
      if (!h || h.dead || h.downed) return;
      RC.cmd(g, { t: 'cast', ids: [h.id], key: (h.def.sig && h.def.sig.key || 'R').toLowerCase() });
    });
  }

  function init(game) { g = game; build(); }

  // ── Shop ──────────────────────────────────────────────────────────────────
  // Rebuilt only when the ROSTER changes (an unlock), not every frame — the
  // affordability state is a class toggle on the existing nodes. Rebuilding a
  // button the moment a finger is on it is how a tap gets swallowed.
  function renderShop(h) {
    const sig = h.roster.map(r => r.t + (r.isNew ? '!' : '')).join(',');
    if (sig !== lastRosterSig) {
      lastRosterSig = sig;
      els.shop.innerHTML = '';
      h.roster.forEach(r => {
        const b = document.createElement('div');
        b.className = 'kid-buy';
        b.dataset.t = r.t;
        b.title = r.blurb || '';
        b.innerHTML =
          `<div class="ic">${esc(r.ic)}</div>` +
          `<div class="role">${esc(r.role)}</div>` +
          `<div class="nm">${esc(r.name)}</div>` +
          `<div class="cost">💎 ${r.cost}</div>` +
          (r.isNew ? `<div class="new">NEW!</div>` : '');
        // pointerdown, not click: on a tablet click waits ~300ms for a possible
        // double-tap, and that delay reads as the button not working.
        b.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          // Through RC.cmd, not RC.Kids.buy: offline that lands straight on the local
          // sim, online it goes to the server and comes back in the next snapshot. One
          // path for both, so a purchase can never be applied on a client the server
          // disagrees with. The squish plays either way — the server may still refuse
          // the buy, and a button that visibly does nothing reads as broken to a kid.
          RC.cmd(g, { t: 'kbuy', ut: r.t });
          // Element.animate is the Web Animations API, which older iOS WebViews do
          // not have. main.js turns ANY uncaught error into a full-screen overlay,
          // so an unguarded call here would end the game the first time a child
          // pressed a button on an old tablet. The squish is a nicety; the purchase
          // has already happened.
          if (typeof b.animate === 'function') {
            b.animate([{ transform: 'scale(.9)' }, { transform: 'scale(1)' }], { duration: 140 });
          }
        });
        els.shop.appendChild(b);
      });
    }
    // Affordability
    const kids = els.shop.children;
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      const r = h.roster[i];
      if (!r) continue;
      node.classList.toggle('poor', h.shard < r.cost);
    }
  }

  function renderQueue(h) {
    const n = h.queue.length;
    if (els.queue.children.length !== Math.max(n, 0)) {
      els.queue.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.className = 'kid-qd' + (i === 0 ? ' go' : '');
        els.queue.appendChild(d);
      }
    }
  }

  // ── Build bar ─────────────────────────────────────────────────────────────
  // Tap a button to ARM a building, then tap the map to put it down. Two taps, no drag,
  // no menus — and tapping the armed button again disarms it, so a kid who changed their
  // mind is never stuck holding a tower they cannot put back.
  let builtSig = '';
  function renderBuild(h) {
    const b = h.build;
    if (!b || !b.items.length) { els.build.style.display = 'none'; return; }
    els.build.style.display = 'flex';
    const sig = b.items.map(i => i.t).join(',');
    if (sig !== builtSig) {
      builtSig = sig;
      els.build.innerHTML = '';
      b.items.forEach(it => {
        const n = document.createElement('div');
        n.className = 'kid-bb';
        n.dataset.t = it.t;
        n.title = it.kid || '';
        n.innerHTML = `<div class="ic">${esc(it.ic)}</div>` +
                      `<div class="role">${esc(it.role)}</div>` +
                      `<div class="cost">💎 ${it.cost}</div>`;
        n.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          g.placing = (g.placing === it.t) ? null : it.t;   // tap again to change your mind
        });
        els.build.appendChild(n);
      });
      const slots = document.createElement('div');
      slots.id = 'kid-slots';
      els.build.appendChild(slots);
    }
    // Affordability, armed state, and the slot count.
    const nodes = els.build.querySelectorAll('.kid-bb');
    for (let i = 0; i < nodes.length; i++) {
      const it = b.items[i];
      if (!it) continue;
      const full = b.used >= b.cap;
      nodes[i].classList.toggle('poor', h.shard < it.cost || full);
      nodes[i].classList.toggle('on', g.placing === it.t);
    }
    const slots = els.build.querySelector('#kid-slots');
    if (slots) {
      slots.textContent = '🧰 ' + b.used + ' / ' + b.cap;
      slots.classList.toggle('full', b.used >= b.cap);
      slots.title = 'Buildings you have room for. Clear waves to earn more slots.';
    }
    const armed = !!g.placing;
    els.placing.classList.toggle('on', armed);
    if (armed) {
      const it = b.items.find(i => i.t === g.placing);
      els.placing.textContent = (it ? it.ic + ' ' + it.role + ' — ' : '') + 'tap near the crystal to place it';
    }
  }

  // ── The hero's charge button ──────────────────────────────────────────────
  let sigShown = '';
  function renderSig(h) {
    const s = h.sig;
    els.sig.classList.toggle('on', !!s);
    if (!s) { renderQE(null); return; }
    const sig2 = s.id + '|' + s.ic + '|' + s.ups.join('');
    if (sig2 !== sigShown) {
      sigShown = sig2;
      els.sigIc.textContent = s.ic;
      els.sigUps.textContent = s.ups.join('');
      els.sig.title = s.name + ' — ' + s.kid;
    }
    renderQE(s);
    els.sigRing.style.setProperty('--c', s.charge.toFixed(3));
    els.sig.classList.toggle('ready', !!s.ready);
    els.sig.classList.toggle('down', !!s.downed);
    // The label is the only text on the button, so it says the one thing that changes:
    // whether pressing it right now would do anything.
    els.sigLb.textContent = s.downed ? 'GONE' : s.ready ? 'TAP!' : Math.round(s.charge * 100) + '%';
  }

  // The two tactical buttons. Built once per hero and then only re-styled, because
  // rebuilding a node under a finger mid-tap swallows the tap.
  let qeShown = '';
  function renderQE(s) {
    const list = (s && !s.downed) ? (s.skills || []) : [];
    els.qe.classList.toggle('on', list.length > 0);
    const key = list.map(k => k.key + k.ic).join('|');
    if (key !== qeShown) {
      qeShown = key;
      els.qe.innerHTML = '';
      for (const sk of list) {
        const b = document.createElement('div');
        b.className = 'b';
        b.innerHTML = `<div class="ring"></div><span>${sk.ic}</span>`;
        b.title = sk.name + ' — ' + (sk.kid || '');
        b.addEventListener('pointerdown', ev => {
          ev.preventDefault();
          const h = g && g.heroOf && g.heroOf[g.playerOwner];
          if (!h || h.dead || h.downed) return;
          RC.cmd(g, { t: 'cast', ids: [h.id], key: sk.key.toLowerCase() });
        });
        els.qe.appendChild(b);
      }
    }
    const nodes = els.qe.children;
    for (let i = 0; i < list.length && i < nodes.length; i++) {
      nodes[i].classList.toggle('ready', !!list[i].ready);
      nodes[i].classList.toggle('off', !list[i].ready);
      nodes[i].querySelector('.ring').style.setProperty('--c', list[i].cd.toFixed(3));
    }
  }

  // ── Reward cards ──────────────────────────────────────────────────────────
  let shownOffer = null;
  function renderReward(h) {
    const on = !!h.offer;
    els.reward.classList.toggle('on', on);
    if (!on) { shownOffer = null; return; }
    // What's next, while the game is still paused and the reward is still unspent.
    if (h.preview) {
      els.next.innerHTML = `<span class="w" style="color:${esc(h.preview.col)}">` +
        `${esc(h.preview.ic)} Next up: ${esc(h.preview.name)}` +
        `<span class="t">${esc(h.preview.tip || '')}</span></span>`;
    } else {
      els.next.innerHTML = '';
    }
    const sig = h.offer.map(c => c.id).join(',');
    if (sig === shownOffer) return;
    shownOffer = sig;
    els.rtitle.textContent = 'WAVE ' + h.wave + ' CLEARED!';
    els.cards.innerHTML = '';
    h.offer.forEach(c => {
      const card = document.createElement('div');
      card.className = 'kid-card' + (c.hero ? ' hero' : '');
      card.innerHTML =
        `<div class="ic">${esc(c.ic)}</div>` +
        `<div class="nm">${esc(c.name)}</div>` +
        `<div class="ds">${esc(c.desc)}</div>` +
        (c.max <= 5 ? `<div class="tr">LEVEL ${c.tier} of ${c.max}</div>` : '');
      let used = false;
      card.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        if (used) return;                        // a double-tap must not spend two picks
        used = true;
        RC.cmd(g, { t: 'kcard', id: c.id });
      });
      els.cards.appendChild(card);
    });
  }

  // ── Per-frame sync ────────────────────────────────────────────────────────
  function update() {
    const on = !!(g && g.kids);
    document.body.classList.toggle('kids-mode', on);
    if (root) root.classList.toggle('on', on);
    if (!on || !RC.Kids || !g.res || !g.res[g.playerOwner]) return;

    const h = RC.Kids.hud(g);

    // Crystal
    if (h.crystal) {
      const pct = Math.max(0, Math.min(1, h.crystal.hp / h.crystal.max));
      els.chp.textContent = Math.round(pct * 100) + '%';
      els.cfill.style.width = (pct * 100) + '%';
      els.cfill.className = pct > 0.55 ? '' : (pct > 0.25 ? 'hurt' : 'bad');
    }

    // Wave + timer
    // Between waves the strip advertises what is COMING; during a wave, what is here.
    if (h.preview && h.nextIn > 0) {
      els.wave.innerHTML = esc(h.preview.ic) + ' <b>Next: ' + esc(h.preview.name) + '</b>';
      els.wave.style.borderColor = h.preview.col;
    } else {
      const f = h.wave ? RC.Kids.flavourFor(h.wave) : RC.Kids.FLAVOURS.normal;
      els.wave.innerHTML = esc(f.ic) + ' <b>' + esc(h.label) + '</b>';
      els.wave.style.borderColor = '';
    }
    if (h.nextIn > 0) {
      els.timer.innerHTML = '⏳ <b>' + Math.ceil(h.nextIn) + 's</b>';
      els.timer.style.display = '';
    } else if (h.left > 0) {
      els.timer.innerHTML = '👾 <b>' + h.left + ' left</b>';
      els.timer.style.display = '';
    } else {
      els.timer.style.display = 'none';
    }

    renderShop(h);
    renderQueue(h);
    renderSig(h);
    renderBuild(h);

    // Banner
    if (h.banner) {
      els.banner.classList.add('on');
      els.bic.textContent = h.banner.ic;
      els.btitle.textContent = h.banner.title;
      els.btitle.style.color = h.banner.col;
      els.bsub.textContent = h.banner.sub;
    } else {
      els.banner.classList.remove('on');
    }

    renderReward(h);
  }

  return { init, update };
})();
