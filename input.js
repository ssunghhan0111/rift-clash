// RIFT CLASH — 입력 / Input (마우스 + 터치 통합, Pointer Events)
window.RC = window.RC || {};

RC.Input = (function () {
  const CFG = RC.CFG;
  let g, cv, mini;
  let amoveArmed = false;                      // next ground order is an attack-move
  function snd(n) { if (RC.Audio) RC.Audio.play(n); }

  // ── Unit voices ───────────────────────────────────────────────────────────
  // Selecting / ordering units answers in the FACTION's own timbre. The race is
  // taken from whatever is actually selected (unit or building) so it's always
  // the thing that "spoke"; defs with no .race belong to Forge.
  function raceOfSel() {
    const s = g && g.selection && g.selection[0];
    if (s && s.def) return s.def.race || 'forge';
    return (g && g.playerRace && g.playerRace[g.playerOwner]) || 'forge';
  }
  function vsnd(n) {
    if (RC.Audio && RC.Audio.playRace) RC.Audio.playRace(raceOfSel(), n);
    else snd(n);
  }
  function mark(x, y, type) { if (g.marks) g.marks.push({ mark: type, x, y, t: 0.6 }); }

  const state = {
    screen: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
    dragging: false,
    dragStart: { x: 0, y: 0 },
    dragTouch: false,       // the active selection box was started by a finger, not a mouse
    boxCount: 0,            // live count of your units inside the box (drawn above the finger)
    keys: {},
    mouseInside: false,
  };

  // ── Touch control scheme ──────────────────────────────────────────────────
  // ONE RULE ON TOUCH: only two fingers move the map. One finger selects, boxes
  // or commands — never pans. There used to be a switchable legacy scheme where a
  // single finger panned; it is gone, and any stored preference for it is wiped,
  // because "the map wanders while I am trying to select" is worse than any
  // convenience it bought.
  const SCHEME_KEY = 'rc_touch_scheme';
  try { window.localStorage.removeItem(SCHEME_KEY); } catch (e) {}

  function getScheme() { return 'box'; }
  function setScheme() { return 'box'; }
  function toggleScheme() { return 'box'; }

  // Which input the player is ACTUALLY using. Only a genuine pointer event can
  // set this — a synthetic mouse event is not a pointer event, so it cannot lie
  // its way into re-enabling edge-scroll on a tablet.
  let lastPointerType = '';
  let lastTouchAt = -1e9;
  const SYNTH_MS = 900;          // how long after a touch synthetic mouse events keep arriving
  function notePointer(e) {
    if (!e || !e.pointerType) return;
    lastPointerType = e.pointerType;
    if (e.pointerType !== 'mouse') {
      lastTouchAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      state.mouseInside = false;          // a finger must never leave edge-scroll armed
    }
  }
  // True while we should treat this as a touch session and ignore mouse input.
  function isTouchSession() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastTouchAt < SYNTH_MS) return true;      // synthetic echo of a real touch
    return lastPointerType !== '' && lastPointerType !== 'mouse';
  }

  // 활성 포인터(마우스/터치) 추적 — 2개 이상이면 두 손가락 팬
  const pointers = new Map();
  let primaryId = null;
  let panMode = false;       // camera-drag active (two-finger, single-finger touch, or middle mouse)
  let panSingle = false;     // pan driven by a single pointer (touch or middle mouse)
  let panMoved = false;      // the pan pointer actually moved (→ it was navigation, not a tap)
  let panLast = null;
  let longPressTimer = null;
  let longPressFired = false;

  function toWorld(sx, sy) {
    return { x: sx + g.camera.x, y: sy + g.camera.y };
  }

  function rectPoint(e, r) {
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function init(game, canvas, minimap) {
    g = game; cv = canvas; mini = minimap;

    cv.style.touchAction = 'none';
    mini.style.touchAction = 'none';

    cv.addEventListener('contextmenu', e => e.preventDefault());

    cv.addEventListener('pointerdown', onPointerDown);
    cv.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    // Track the mouse from the window (so the position stays correct even while a
    // drag runs off the canvas), but only ARM edge-scroll while the cursor is
    // actually over the battlefield. Parking the mouse on the bottom command
    // panel, the minimap or the touchbar must NOT keep scrolling the map.
    // A tablet fires SYNTHETIC mouse events after every touch, for compatibility
    // with old pages. Those were setting mouseInside and the cursor position, so
    // edge-scroll armed itself from a finger — and then never disarmed, because
    // a finger produces no mouseout. That is why the map crept on its own on an
    // iPad. Synthetic events land within a few hundred ms of the touch, so
    // anything that close to one is ignored outright.
    window.addEventListener('mousemove', e => {
      if (isTouchSession()) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      state.screen.x = x;
      state.screen.y = y;
      state.mouseInside = (x >= 0 && x <= r.width && y >= 0 && y <= r.height);
    });
    window.addEventListener('mouseout', e => {
      if (!e.relatedTarget && !e.toElement) state.mouseInside = false;   // left the browser window
    });

    // 미니맵 — 탭으로 점프, 드래그로 계속 스크럽 (한 손가락 팬 대체 수단)
    // Dragging on the minimap scrubs the camera continuously. This is what makes
    // two-finger panning acceptable: long-distance travel never needs the map
    // surface at all.
    let miniDrag = false;
    const jump = e => {
      const r = mini.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      g.camera.x = fx * CFG.WORLD_W - cv.width / 2;
      g.camera.y = fy * CFG.WORLD_H - cv.height / 2;
      clampCam();
    };
    mini.addEventListener('pointerdown', e => {
      miniDrag = true;
      if (mini.setPointerCapture) { try { mini.setPointerCapture(e.pointerId); } catch (err) {} }
      jump(e);
    });
    mini.addEventListener('pointermove', e => { if (miniDrag) jump(e); });
    const endMini = () => { miniDrag = false; };
    mini.addEventListener('pointerup', endMini);
    mini.addEventListener('pointercancel', endMini);
    window.addEventListener('pointerup', endMini);
    mini.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      state.keys[e.key.toLowerCase()] = true;
      onKey(e);
    });
    window.addEventListener('keyup', e => { state.keys[e.key.toLowerCase()] = false; });
  }

  function onPointerDown(e) {
    notePointer(e);
    const r = cv.getBoundingClientRect();
    const p = rectPoint(e, r);

    if (e.pointerType === 'mouse') {
      if (e.button === 2) {              // right-click = immediate command
        state.screen.x = p.x; state.screen.y = p.y;
        const w = toWorld(p.x, p.y); state.world.x = w.x; state.world.y = w.y;
        onRight();
        return;
      }
      if (e.button === 1) {              // middle-drag = free camera pan (desktop)
        e.preventDefault();
        panMode = true; panSingle = true; panMoved = false; panLast = { x: p.x, y: p.y };
        primaryId = e.pointerId; pointers.set(e.pointerId, { x: p.x, y: p.y });
        return;
      }
      if (e.button !== 0) return;
    }

    pointers.set(e.pointerId, { x: p.x, y: p.y });

    if (pointers.size >= 2) {            // two fingers → pan
      panMode = true; panSingle = false; panMoved = false;
      clearLongPress();
      // A second finger landing mid-drag means the player wanted to navigate,
      // not select — abandon the box silently rather than selecting on release.
      state.dragging = false; state.dragTouch = false; state.boxCount = 0;
      panLast = centroid();
      return;
    }

    primaryId = e.pointerId;
    state.screen.x = p.x; state.screen.y = p.y;
    const w = toWorld(p.x, p.y); state.world.x = w.x; state.world.y = w.y;

    if (g.placing) { placeAt(e); return; }

    state.dragStart.x = p.x; state.dragStart.y = p.y;

    if (e.pointerType !== 'mouse') {
      // Touch: one finger draws a selection box. It does NOT pan, ever — the map
      // moves only under two fingers, plus the minimap scrub and the group/home
      // buttons for long trips. A tap without movement still means select/command.
      state.dragging = true; state.dragTouch = true; state.boxCount = 0;
      longPressFired = false;
      clearLongPress();
      return;
    }

    // Mouse left-drag = selection box
    state.dragging = true; state.dragTouch = false; state.boxCount = 0;
  }

  function onPointerMove(e) {
    notePointer(e);
    const r = cv.getBoundingClientRect();
    const p = rectPoint(e, r);

    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: p.x, y: p.y });

    if (panMode) {
      const c = panSingle ? { x: p.x, y: p.y } : centroid();
      if (panLast && c) {
        g.camera.x -= (c.x - panLast.x);
        g.camera.y -= (c.y - panLast.y);
        clampCam();
      }
      panLast = c;
      if (Math.abs(p.x - state.dragStart.x) > 6 || Math.abs(p.y - state.dragStart.y) > 6) { panMoved = true; clearLongPress(); }
      return;
    }

    // 마우스 호버는 버튼과 무관하게 항상 갱신 (건설 미리보기용)
    if (e.pointerType === 'mouse' || e.pointerId === primaryId) {
      state.screen.x = p.x; state.screen.y = p.y;
      const w = toWorld(p.x, p.y); state.world.x = w.x; state.world.y = w.y;
    }

    if (state.dragging && e.pointerId === primaryId) {
      const dx = Math.abs(p.x - state.dragStart.x), dy = Math.abs(p.y - state.dragStart.y);
      if (dx > 6 || dy > 6) clearLongPress();
      // On a phone your fingertip covers the units you're trying to select, so
      // keep a live count that the renderer can draw clear of the finger.
      if (state.dragTouch) state.boxCount = countInBox().length;
    }
  }

  // Units of yours currently inside the drag rectangle.
  function countInBox() {
    if (!g || !state.dragging) return [];
    const me = ME();
    const a = toWorld(state.dragStart.x, state.dragStart.y);
    const b = state.world;
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    return g.units.filter(u =>
      u.owner === me && u.x >= x1 && u.x <= x2 && u.y >= y1 && u.y <= y2 && u.state !== 'build');
  }

  function onPointerUp(e) {
    const wasPrimary = e.pointerId === primaryId;
    pointers.delete(e.pointerId);

    if (panMode) {
      // a single-finger touch that didn't move was actually a tap → select/command
      if (panSingle && wasPrimary && !panMoved && !longPressFired && e.pointerType !== 'mouse') handleTap(e);
      if (pointers.size < 2) { panMode = false; panSingle = false; panLast = null; }
      if (wasPrimary) primaryId = null;
      clearLongPress();
      return;
    }

    if (!wasPrimary) return;
    primaryId = null;
    clearLongPress();

    if (!state.dragging) return;
    const wasTouch = state.dragTouch;
    state.dragging = false; state.dragTouch = false; state.boxCount = 0;

    const dx = Math.abs(state.screen.x - state.dragStart.x);
    const dy = Math.abs(state.screen.y - state.dragStart.y);

    if (dx < 6 && dy < 6) {
      if (longPressFired) return;
      handleTap(e);
      return;
    }

    boxSelect(e, wasTouch);
  }

  function clearLongPress() { clearTimeout(longPressTimer); longPressTimer = null; }

  function centroid() {
    let x = 0, y = 0, n = 0;
    pointers.forEach(pt => { x += pt.x; y += pt.y; n++; });
    return n ? { x: x / n, y: y / n } : null;
  }

  function ME() { return g.playerOwner; }

  function placeAt(e) {
    const type = g.placing, me = ME();
    const workers = g.selection.filter(s => s.kind === 'unit' && s.def.worker);
    const w = workers.length ? [workers[0]] : g.units.filter(u => u.owner === me && u.def.worker).slice(0, 1);
    RC.cmd(g, { t: 'build', bt: type, x: state.world.x, y: state.world.y, ids: w.map(u => u.id) });
    if (RC.Audio) RC.Audio.play('build');
    if (!(e.pointerType === 'mouse' && e.shiftKey)) g.placing = null;
  }

  function handleTap(e) {
    const me = ME();
    let ent = g.entityAt(state.world.x, state.world.y, null);
    if (ent && ent.owner !== me && g.areEnemies(ent.owner, me) && !g.visibleAt(ent.x, ent.y)) ent = null;   // hidden enemies can't be selected
    if (ent && ent.owner === me && ent.kind === 'unit' && ent.def.worker && ent.state === 'build') ent = null;   // busy builder is unavailable

    if (e.pointerType === 'mouse') {
      if (!ent) { if (!e.shiftKey) g.selection = []; return; }
      if (e.shiftKey && ent.owner === me) {
        if (g.selection.includes(ent)) g.selection = g.selection.filter(s => s !== ent);
        else g.selection.push(ent);
      } else {
        g.selection = [ent];
      }
      if (ent.owner === me && g.selection.length) vsnd('select');   // your own units answer
      return;
    }

    // touch/pen — smart tap: select if it's mine, otherwise issue a command
    if (ent && ent.owner === me) { g.selection = [ent]; vsnd('select'); return; }
    const mine = g.selection.some(s => s.owner === me);
    if (mine) { onRight(); return; }
    g.selection = [];
  }

  function boxSelect(e, wasTouch) {
    state.dragging = true;                  // countInBox reads the live drag rect
    const hits = countInBox();
    state.dragging = false;

    // On touch, a box that caught nothing must NOT wipe the selection — with a
    // one-finger box the map surface is now covered in "accidental" drags, and
    // losing your whole army to a stray swipe is far worse than having to press
    // ✕ to deselect deliberately. Mouse keeps the familiar clear-on-empty.
    if (wasTouch && !hits.length) return;

    if (e.pointerType === 'mouse' && e.shiftKey) hits.forEach(h => { if (!g.selection.includes(h)) g.selection.push(h); });
    else g.selection = hits;

    const hasFighter = g.selection.some(s => s.kind === 'unit' && !s.def.worker);
    if (hasFighter) g.selection = g.selection.filter(s => s.kind !== 'unit' || !s.def.worker);
    if (g.selection.length) vsnd('select');
  }

  function onRight() {
    if (g.placing) { g.placing = null; return; }
    const me = ME();
    const mine = g.selection.filter(s => s.owner === me);
    if (!mine.length) return;
    const wx = state.world.x, wy = state.world.y;

    const bld = mine.filter(s => s.kind === 'building');
    const units = mine.filter(s => s.kind === 'unit');

    // buildings only → set rally point
    if (bld.length && !units.length) {
      RC.cmd(g, { t: 'rally', ids: bld.map(b => b.id), x: wx, y: wy });
      bld.forEach(b => { b.rally = { x: wx, y: wy }; });   // instant local feedback
      return;
    }

    const ids = units.map(u => u.id);
    const workerIds = units.filter(u => u.def.worker).map(u => u.id);
    const otherIds = units.filter(u => !u.def.worker).map(u => u.id);

    // board a friendly transport
    const ship = g.units.find(u => u.owner === me && u.def.transport && u.cargo &&
      RC.dist(wx, wy, u.x, u.y) <= u.r + 12);
    if (ship && units.some(u => u !== ship && !u.def.flying)) {
      RC.cmd(g, { t: 'board', ids: units.filter(u => u !== ship && !u.def.flying).map(u => u.id), sid: ship.id });
      return;
    }

    let enemy = g.entityAt(wx, wy, null);
    if (enemy && (!g.areEnemies(enemy.owner, me) || !g.visibleAt(enemy.x, enemy.y))) enemy = null;
    const node = g.nodeAt(wx, wy);
    const site = g.buildings.find(b => b.owner === me && !b.done && b.contains(wx, wy));

    if (enemy) { RC.cmd(g, { t: 'attack', ids, tid: enemy.id }); mark(enemy.x, enemy.y, 'attack'); vsnd('attack'); amoveArmed = false; return; }
    if (site && workerIds.length) {
      RC.cmd(g, { t: 'buildSite', ids: workerIds, bid: site.id });
      if (otherIds.length) RC.cmd(g, { t: 'move', ids: otherIds, x: wx, y: wy });
      mark(wx, wy, 'move'); vsnd('move'); amoveArmed = false; return;
    }
    if (node && workerIds.length) {
      RC.cmd(g, { t: 'gather', ids: workerIds, nid: node.id });
      if (otherIds.length) RC.cmd(g, { t: 'move', ids: otherIds, x: wx, y: wy });
      mark(node.x, node.y, 'move'); vsnd('move'); amoveArmed = false; return;
    }
    // plain ground order — attack-move (armed) engages enemies on the way; workers still just move
    if (amoveArmed && otherIds.length) {
      RC.cmd(g, { t: 'amove', ids: otherIds, x: wx, y: wy });
      if (workerIds.length) RC.cmd(g, { t: 'move', ids: workerIds, x: wx, y: wy });
      mark(wx, wy, 'amove'); vsnd('attack');
    } else {
      RC.cmd(g, { t: 'move', ids, x: wx, y: wy });
      mark(wx, wy, 'move'); vsnd('move');
    }
    amoveArmed = false;
  }

  function onKey(e) {
    const k = e.key.toLowerCase();

    const me = g.playerOwner;
    if (k === 'escape') { g.placing = null; g.selection = []; return; }
    if (k === ' ') {
      e.preventDefault();
      const c = g.core(me);
      if (c) centerOn(c.x, c.y);
      return;
    }
    // 일시정지 — 온라인은 서버가 계속 돌기 때문에 막는다. 버튼 모양도 같이 바뀌도록 UI를 통한다.
    if (k === 'p') { if (RC.UI && RC.UI.togglePause) RC.UI.togglePause(); else if (!RC.online) g.paused = !g.paused; return; }
    if (k === 's') {
      const ids = g.selection.filter(u => u.kind === 'unit' && u.owner === me).map(u => u.id);
      if (ids.length) RC.cmd(g, { t: 'stop', ids });
      return;
    }

    // find an idle worker
    if (k === 'f') {
      const idle = g.units.find(u => u.owner === me && u.def.worker && u.state === 'idle');
      if (idle) { g.selection = [idle]; centerOn(idle.x, idle.y); vsnd('select'); }
      return;
    }

    // select your hero (and jump to it)
    if (k === 'h') {
      const hero = g.heroOf && g.heroOf[me];
      if (hero && !hero.dead) { g.selection = [hero]; if (!hero.downed) centerOn(hero.x, hero.y); vsnd('select'); }
      return;
    }

    // ability / hero-skill hotkey — cast on selected units of mine whose (skill) key matches
    const casters = g.selection.filter(s =>
      s.kind === 'unit' && s.owner === me && (
        (s.def.ability && s.def.ability.key.toLowerCase() === k) ||
        (s.def.hero && (s.def.skills || []).some(sk => sk.key.toLowerCase() === k)) ||
        (s.def.hero && s.def.ult && s.def.ult.key.toLowerCase() === k)     // ultimate (R)
      ));
    if (casters.length) { RC.cmd(g, { t: 'cast', ids: casters.map(u => u.id), key: k }); snd('cast'); return; }

    // attack-move: 'A' then click (only when no selected unit uses 'A' for an ability)
    if (k === 'a') {
      const combat = g.selection.some(s => s.kind === 'unit' && s.owner === me && !s.def.worker);
      if (combat) { amoveArmed = true; g.notify('Attack-move — click a destination'); snd('select'); return; }
    }

    // build hotkey — with a worker selected, start placing the matching building
    const hasWorker = g.selection.some(s => s.kind === 'unit' && s.def.worker && s.owner === me);
    if (hasWorker) {
      const list = (g.buildableFor ? g.buildableFor(me) : null) || RC.BUILDABLE || [];
      const bt = list.find(t => RC.BUILDINGS[t].key.toLowerCase() === k);
      if (bt) { g.placing = bt; return; }
    }

    // produce hotkey — from a selected building whose produce list has this key
    const bsel = g.selection.find(s => s.kind === 'building' && s.owner === me && s.done);
    if (bsel) {
      const type = bsel.def.produces.find(t => RC.UNITS[t].key.toLowerCase() === k);
      if (type) { RC.cmd(g, { t: 'train', bid: bsel.id, ut: type }); return; }
    }

    // 컨트롤 그룹 1~4
    if ('1234'.includes(k)) {
      if (e.ctrlKey) {
        g.groups = g.groups || {};
        g.groups[k] = g.selection.slice();
      } else {
        const grp = (g.groups || {})[k];
        if (grp) { g.selection = grp.filter(u => !u.dead); if (g.selection.length) vsnd('select'); }
      }
    }
  }

  function centerOn(x, y) {
    g.camera.x = x - cv.width / 2;
    g.camera.y = y - cv.height / 2;
    clampCam();
  }

  function clampCam() {
    g.camera.x = Math.max(0, Math.min(CFG.WORLD_W - cv.width, g.camera.x));
    g.camera.y = Math.max(0, Math.min(CFG.WORLD_H - cv.height, g.camera.y));
  }

  // 카메라 이동 — 키보드 + 화면 가장자리 (마우스만, 터치는 두 손가락 드래그로 팬)
  // Keyboard moves at a flat CAM_SPEED. Edge-scroll ramps from EDGE_PAN_FLOOR
  // (a strong starting speed, so it's already fast the instant the cursor
  // enters the zone) up to full CAM_SPEED right at the screen edge.
  const EDGE_PAN_FLOOR = 0.6;  // fraction of CAM_SPEED applied as soon as the zone is entered
  function updateCamera(dt) {
    let dx = 0, dy = 0;
    const k = state.keys;
    let kx = 0, ky = 0;
    if (k['arrowleft']) kx -= 1;
    if (k['arrowright']) kx += 1;
    if (k['arrowup']) ky -= 1;
    if (k['arrowdown']) ky += 1;
    if (kx || ky) {
      const len = Math.hypot(kx, ky) || 1;
      dx += (kx / len) * CFG.CAM_SPEED * dt;
      dy += (ky / len) * CFG.CAM_SPEED * dt;
    }

    // Edge-scroll is a MOUSE affordance. On a tablet there is no resting cursor,
    // so a finger anywhere near an edge would slide the map forever.
    if (state.mouseInside && !isTouchSession()) {
      const zone = CFG.EDGE_PAN;
      const sx = state.screen.x, sy = state.screen.y;
      let ex = 0, ey = 0;
      if (sx < zone) ex = -(EDGE_PAN_FLOOR + (1 - EDGE_PAN_FLOOR) * (zone - sx) / zone);
      else if (sx > cv.width - zone) ex = (EDGE_PAN_FLOOR + (1 - EDGE_PAN_FLOOR) * (sx - (cv.width - zone)) / zone);
      if (sy < zone) ey = -(EDGE_PAN_FLOOR + (1 - EDGE_PAN_FLOOR) * (zone - sy) / zone);
      else if (sy > cv.height - zone) ey = (EDGE_PAN_FLOOR + (1 - EDGE_PAN_FLOOR) * (sy - (cv.height - zone)) / zone);
      ex = Math.max(-1, Math.min(1, ex));
      ey = Math.max(-1, Math.min(1, ey));
      dx += ex * CFG.CAM_SPEED * dt;
      dy += ey * CFG.CAM_SPEED * dt;
    }

    if (dx || dy) {
      g.camera.x += dx;
      g.camera.y += dy;
      clampCam();
    }
  }

  function armAttackMove() { amoveArmed = true; if (g) g.notify('Attack-move — tap a destination'); snd('select'); }

  // Snap the camera onto a control group's centre of mass (double-tap a group button).
  function centerOnGroup(gid) {
    const grp = ((g && g.groups) || {})[String(gid)];
    const live = (grp || []).filter(u => !u.dead);
    if (!live.length) return false;
    let x = 0, y = 0;
    live.forEach(u => { x += u.x; y += u.y; });
    centerOn(x / live.length, y / live.length);
    return true;
  }

  return {
    init, state, updateCamera, centerOn, centerOnGroup, clampCam,
    armAttackMove, getScheme, setScheme, toggleScheme,
  };
})();
