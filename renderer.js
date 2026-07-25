// RIFT CLASH — 렌더러 / Renderer
window.RC = window.RC || {};

RC.Renderer = (function () {
  const C = RC.COLORS;
  const CFG = RC.CFG;

  let cv, ctx, mini, mctx;

  function init(canvas, minimap) {
    cv = canvas; ctx = cv.getContext('2d');
    mini = minimap; mctx = mini.getContext('2d');
  }

  function pal(owner) {
    const o = (owner >= 1 && owner <= 4) ? owner : 1;
    return { body: C['p' + o + '_body'], trim: C['p' + o + '_trim'], dark: C['p' + o + '_dark'] };
  }

  // 플레이어 기준 팀 색 (아군/적군 구분용) — g 있으면 사용
  function teamColor(g, owner) {
    if (!g || owner === g.playerOwner) return null;        // 내 유닛은 링 없음
    return g.allied(owner, g.playerOwner) ? C.team1 : C.team2;
  }

  // 색상 밝기 조절 — pct 양수면 밝게, 음수면 어둡게
  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, gc = (n >> 8) & 255, b = n & 255;
    if (pct >= 0) { r += (255 - r) * pct; gc += (255 - gc) * pct; b += (255 - b) * pct; }
    else { const k = 1 + pct; r *= k; gc *= k; b *= k; }
    return `rgb(${r | 0},${gc | 0},${b | 0})`;
  }

  // 색 문자열('#rrggbb' 또는 'rgb(...)')을 [r,g,b]로
  function parseRGB(s) {
    if (s[0] === '#') { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    const m = s.match(/\d+/g); return [+m[0], +m[1], +m[2]];
  }
  // 두 색을 t(0~1)만큼 섞는다
  function mix(a, b, t) {
    const A = parseRGB(a), B = parseRGB(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }

  // 둥근 사각형 경로
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(g, input) {
    const W = cv.width, H = cv.height;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-Math.round(g.camera.x), -Math.round(g.camera.y));

    drawTerrain(g, W, H);
    drawZones(g);                     // 전술 지형 (고지/숲/늪/분출구)
    (g.obstacles || []).forEach(o => drawObstacle(o));
    g.nodes.forEach(n => drawNode(n));
    g.buildings.forEach(b => drawBuilding(g, b));
    g.fx.forEach(f => drawShot(f));
    g.units.forEach(u => drawUnit(g, u));
    drawFog(g, W, H);                 // 전장의 안개 — 적/지형을 덮는다
    drawSelection(g);
    drawMarks(g);                     // 명령 표식 + 데미지 숫자
    if (g.placing) drawGhost(g, input);

    ctx.restore();

    drawDragBox(input);
    drawMinimap(g, W, H);
  }

  // ── 전술 지형 ────────────────────────────────────────
  // Each zone type gets an unmistakable look, because a tactical advantage the player
  // can't see at a glance may as well not exist.
  const ZONE_STYLE = {
    high:   { fill: 'rgba(196,168,110,0.16)', edge: '#c9a86a' },
    forest: { fill: 'rgba(64,150,86,0.20)',   edge: '#3f8f57' },
    mud:    { fill: 'rgba(120,88,54,0.26)',   edge: '#7b5a38' },
    vent:   { fill: 'rgba(166,104,255,0.16)', edge: '#a668ff' },
  };
  function zonePath(z) {
    ctx.beginPath();
    if (z.r) ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    else ctx.rect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
  }
  function drawZones(g) {
    const zs = g.zones;
    if (!zs || !zs.length) return;
    const t = performance.now() / 1000;
    for (const z of zs) {
      const st = ZONE_STYLE[z.t]; if (!st) continue;
      ctx.save();
      ctx.fillStyle = st.fill; zonePath(z); ctx.fill();
      ctx.strokeStyle = st.edge; ctx.lineWidth = 3; ctx.globalAlpha = 0.75;
      zonePath(z); ctx.stroke();
      ctx.globalAlpha = 1;

      if (z.t === 'high') {
        // 고지 — 안쪽 단차선 + 위로 솟은 삼각 표식
        ctx.strokeStyle = st.edge; ctx.globalAlpha = 0.35; ctx.lineWidth = 2;
        if (z.r) { ctx.beginPath(); ctx.arc(z.x, z.y, z.r - 13, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 0.75; ctx.fillStyle = st.edge;
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + (i - 1) * 0.5;
          const px = z.x + Math.cos(a) * (z.r ? z.r * 0.5 : 40);
          const py = z.y + Math.sin(a) * (z.r ? z.r * 0.5 : 40);
          ctx.beginPath();
          ctx.moveTo(px, py - 11); ctx.lineTo(px + 9, py + 6); ctx.lineTo(px - 9, py + 6);
          ctx.closePath(); ctx.fill();
        }
      } else if (z.t === 'forest') {
        // 숲 — 나무 무리
        const n = z.r ? 9 : 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.6;
          const rr = (z.r || Math.min(z.w, z.h) / 2) * (0.35 + (i % 3) * 0.22);
          const px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr;
          ctx.fillStyle = '#2c5a38';
          ctx.fillRect(px - 2.5, py + 2, 5, 11);
          ctx.fillStyle = i % 2 ? '#3f8f57' : '#4fa869';
          ctx.beginPath();
          ctx.moveTo(px, py - 18); ctx.lineTo(px + 13, py + 4); ctx.lineTo(px - 13, py + 4);
          ctx.closePath(); ctx.fill();
        }
      } else if (z.t === 'mud') {
        // 늪 — 느릿하게 번지는 웅덩이
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#9a7448'; ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = t * 0.35 + i * 1.6;
          const rr = (z.r || Math.min(z.w, z.h) / 2) * (0.3 + (i % 3) * 0.2);
          ctx.beginPath();
          ctx.ellipse(z.x + Math.cos(a) * rr * 0.7, z.y + Math.sin(a * 1.2) * rr * 0.6,
                      20 + (i % 2) * 12, 11 + (i % 2) * 6, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (z.t === 'vent') {
        // 분출구 — 맥동하는 고리 + 떠오르는 불티
        const pulse = 0.45 + 0.35 * Math.abs(Math.sin(t * 1.5));
        ctx.globalAlpha = pulse; ctx.strokeStyle = '#c79aff'; ctx.lineWidth = 2.5;
        const rr = (z.r || 90);
        ctx.beginPath(); ctx.arc(z.x, z.y, rr * (0.45 + 0.12 * Math.sin(t * 1.5)), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#dcbcff';
        for (let i = 0; i < 6; i++) {
          const a = i * 1.05 + t * 0.5;
          const rise = ((t * 40 + i * 33) % (rr * 0.9));
          ctx.globalAlpha = pulse * (1 - rise / (rr * 0.9)) * 0.9;
          ctx.beginPath();
          ctx.arc(z.x + Math.cos(a) * rr * 0.35, z.y + Math.sin(a) * rr * 0.3 - rise * 0.5, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawTerrain(g, W, H) {
    // 맵 지형 패치 (원형 색 얼룩) — 그리드 아래
    (g.terrain || []).forEach(p => {
      ctx.fillStyle = p.color;
      if (p.r) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      else if (p.w) { ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h); }
    });

    const t = CFG.TILE;
    const x0 = Math.floor(g.camera.x / t) * t;
    const y0 = Math.floor(g.camera.y / t) * t;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x < g.camera.x + W + t; x += t) {
      ctx.moveTo(x + 0.5, g.camera.y); ctx.lineTo(x + 0.5, g.camera.y + H);
    }
    for (let y = y0; y < g.camera.y + H + t; y += t) {
      ctx.moveTo(g.camera.x, y + 0.5); ctx.lineTo(g.camera.x + W, y + 0.5);
    }
    ctx.stroke();

    // 맵 경계
    ctx.strokeStyle = '#2b3a4d';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CFG.WORLD_W - 4, CFG.WORLD_H - 4);

    // 중앙 리프트 표시 (Phase 3에서 점령 목표로 사용)
    const cx = CFG.WORLD_W / 2, cy = CFG.WORLD_H / 2;
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = C.rift;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 150, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawNode(n) {
    const frac = n.amount / n.max;
    const size = 12 + 10 * frac;
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.fillStyle = C.nodeDark;
    ctx.beginPath(); ctx.ellipse(0, 8, size * 1.15, size * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.node;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * size * 0.55;
      const h = size * (i === 1 ? 1.35 : 0.95);
      ctx.beginPath();
      ctx.moveTo(ox, -h);
      ctx.lineTo(ox + size * 0.34, 4);
      ctx.lineTo(ox, 10);
      ctx.lineTo(ox - size * 0.34, 4);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // 바위 장애물 — 각진 돌덩이
  function drawObstacle(o) {
    const x = o.x - o.w / 2, y = o.y - o.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    rrect(x + 4, y + 5, o.w, o.h, 8); ctx.fill();
    ctx.fillStyle = C.obstacleDark;
    rrect(x, y, o.w, o.h, 8); ctx.fill();
    ctx.fillStyle = C.obstacle;
    rrect(x + 3, y + 3, o.w - 6, o.h * 0.55, 6); ctx.fill();
    // 균열 표시
    ctx.strokeStyle = C.obstacleDark; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(o.x - o.w * 0.2, y + 6); ctx.lineTo(o.x, o.y); ctx.lineTo(o.x + o.w * 0.15, y + o.h - 6);
    ctx.stroke();
  }

  // 안개에 가려진 적 건물은 그리지 않는다 (아군/내 건물은 항상 보임)
  function fogged(g, e) {
    return g.areEnemies(e.owner, g.playerOwner) && !g.visibleAt(e.x, e.y);
  }

  function drawBuilding(g, b) {
    if (fogged(g, b)) return;
    const p = pal(b.owner);
    const x = b.x - b.w / 2, y = b.y - b.h / 2;

    if (!b.done) {
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = p.trim; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, b.w, b.h);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y + b.h * (1 - b.buildProgress), b.w, b.h * b.buildProgress);
    } else {
      if (b.def.race === 'gloop') {
        // 글룹 — 유기적 점액 덩어리 본체 (둥글둥글, 초록빛)
        gloopBody(b, p, x, y);
      } else if (b.def.race === 'aether') {
        // Aether — 각진 결정 구조 + 부유 파편 (보랏빛)
        aetherBody(b, p, x, y);
      } else {
        // 포지 — 각진 금속 본체 + 리벳
        const light = shade(p.body, 0.26), dk = shade(p.body, -0.4);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        rrect(x + 4, y + 6, b.w, b.h, 6); ctx.fill();
        ctx.fillStyle = dk;
        rrect(x, y, b.w, b.h, 6); ctx.fill();
        ctx.fillStyle = p.body;
        rrect(x, y, b.w, b.h * 0.82, 6); ctx.fill();
        ctx.fillStyle = light;
        rrect(x + 3, y + 3, b.w - 6, b.h * 0.28, 5); ctx.fill();
        ctx.fillStyle = dk;
        [[x + 7, y + 7], [x + b.w - 7, y + 7], [x + 7, y + b.h - 7], [x + b.w - 7, y + b.h - 7]].forEach(([rx, ry]) => {
          ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, Math.PI * 2); ctx.fill();
        });
        ctx.strokeStyle = p.trim; ctx.lineWidth = 2.5;
        rrect(x + 5, y + 5, b.w - 10, b.h - 10, 4); ctx.stroke();
      }

      // 타입별 표식
      if (b.type === 'core') {
        // 회전하는 에너지 코어
        const t = (performance.now() / 1000);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(t * 0.8);
        ctx.fillStyle = p.trim;
        for (let i = 0; i < 6; i++) {
          ctx.rotate(Math.PI / 3);
          ctx.fillRect(-2.5, -19, 5, 8);
        }
        ctx.restore();
        // 코어 광채
        ctx.fillStyle = C.node;
        ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(b.x - 2.5, b.y - 2.5, 3.5, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'cell') {
        // 발광 에너지 셀
        ctx.fillStyle = p.dark;
        rrect(b.x - 11, b.y - 15, 22, 30, 4); ctx.fill();
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 500));
        ctx.globalAlpha = pulse;
        ctx.fillStyle = C.node;
        rrect(b.x - 6, b.y - 11, 12, 22, 3); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = p.trim;
        ctx.fillRect(b.x - 13, b.y - 3, 26, 6);
      } else if (b.type === 'factory') {
        // 공장 셔터문 + 굴뚝
        ctx.fillStyle = p.dark;
        rrect(b.x - 20, b.y - 6, 40, 26, 3); ctx.fill();
        ctx.strokeStyle = shade(p.body, -0.15); ctx.lineWidth = 2;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath(); ctx.moveTo(b.x - 20, b.y + i * 6 + 2); ctx.lineTo(b.x + 20, b.y + i * 6 + 2); ctx.stroke();
        }
        ctx.fillStyle = p.trim;
        ctx.fillRect(b.x - 16, b.y - 20, 9, 12);
        ctx.fillRect(b.x + 7, b.y - 20, 9, 12);
      } else if (b.type === 'arclab') {
        // 아크 랩 — 회전 링 + 발광 코어
        const tt = performance.now() / 1000;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.strokeStyle = p.trim; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
        ctx.rotate(tt * 1.2);
        ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.rotate((Math.PI * 2) / 3);
          ctx.beginPath(); ctx.arc(0, 0, 22, -0.5, 0.5); ctx.stroke();
        }
        ctx.restore();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 400));
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#8fe3ff';
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, 3, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'biocore') {
        // 바이오코어 — 맥동하는 초록 핵
        const t = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.fillStyle = p.dark; blob(20, 0.08, 0); ctx.fill();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 480));
        ctx.globalAlpha = pulse; ctx.fillStyle = '#7dff9e';
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(-2.5, -2.5, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (b.type === 'membrane') {
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 520));
        ctx.fillStyle = p.dark; ctx.beginPath(); ctx.arc(b.x, b.y, 15, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = pulse; ctx.fillStyle = '#7dff9e';
        ctx.beginPath(); ctx.arc(b.x, b.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.type === 'hatchery') {
        // 부화장 — 알 무더기
        ctx.fillStyle = p.dark; ctx.beginPath(); ctx.ellipse(b.x, b.y, 22, 16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5ddc7a';
        [[-10, -3], [9, -4], [0, 6], [-13, 7], [12, 8]].forEach(([ox, oy]) => {
          ctx.beginPath(); ctx.arc(b.x + ox, b.y + oy, 5.5, 0, Math.PI * 2); ctx.fill();
        });
      } else if (b.type === 'spire') {
        // 포자탑 — 위로 솟은 관 + 포자 구름
        ctx.fillStyle = p.dark; ctx.beginPath(); ctx.moveTo(b.x - 8, b.y + 14); ctx.lineTo(b.x - 4, b.y - 18); ctx.lineTo(b.x + 4, b.y - 18); ctx.lineTo(b.x + 8, b.y + 14); ctx.closePath(); ctx.fill();
        const pulse = 0.5 + 0.5 * Math.abs(Math.sin(performance.now() / 400));
        ctx.globalAlpha = pulse; ctx.fillStyle = '#7dff9e';
        ctx.beginPath(); ctx.arc(b.x, b.y - 18, 7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.type === 'evochamber') {
        // 진화소 — 회전 고리 + 초록 핵
        const tt = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.strokeStyle = '#7dff9e'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
        ctx.rotate(tt * 1.1);
        ctx.strokeStyle = ACID; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.arc(0, 0, 22, -0.5, 0.5); ctx.stroke(); }
        ctx.restore();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 420));
        ctx.globalAlpha = pulse; ctx.fillStyle = '#7dff9e';
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.type === 'guardtower' || b.type === 'arcbattery' || b.type === 'acidtower') {
        // 타워 — 표적을 향해 회전하는 포신
        const big = b.type === 'arcbattery';
        const acid = b.type === 'acidtower';
        const ang = b.foe ? Math.atan2(b.foe.y - b.y, b.foe.x - b.x) : -Math.PI / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        // 받침대
        ctx.fillStyle = p.dark;
        ctx.beginPath(); ctx.arc(0, 0, big ? 15 : 12, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(ang);
        // 포신
        ctx.fillStyle = shade(p.body, -0.15);
        ctx.fillRect(0, -(big ? 5 : 3.5), big ? 30 : 22, big ? 10 : 7);
        ctx.fillStyle = p.trim;
        ctx.fillRect(big ? 26 : 19, -(big ? 6 : 4.5), big ? 6 : 5, big ? 12 : 9);   // 총구
        ctx.restore();
        // 발광 코어
        ctx.fillStyle = acid ? '#7dff9e' : (big ? '#ffb24f' : C.node);
        ctx.beginPath(); ctx.arc(b.x, b.y, big ? 6 : 5, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'crystal') {
        // 리프트 크리스탈 — 맥동하는 청록 결정 (지켜야 할 목표)
        const tt = performance.now() / 1000;
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(tt * 1.5));
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.globalAlpha = 0.25 * pulse;                 // 광채
        ctx.fillStyle = C.node;
        ctx.beginPath(); ctx.arc(0, 0, 48, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        const shard = (ox, h, w2, col) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(ox, -h); ctx.lineTo(ox + w2, 8); ctx.lineTo(ox, 22); ctx.lineTo(ox - w2, 8);
          ctx.closePath(); ctx.fill();
        };
        shard(-21, 30, 12, '#2aa7c4');
        shard(21, 34, 13, '#2aa7c4');
        shard(0, 54, 17, C.node);
        ctx.globalAlpha = 0.85 * pulse;
        shard(0, 48, 6, '#e6fdff');
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // 연구 진행 바 (아크 랩) — 생산 바 위쪽에 하늘색으로
    if (b.research) {
      const w = b.w - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 4, y - 20, w, 6);
      ctx.fillStyle = C.energy;
      ctx.fillRect(x + 4, y - 20, w * (1 - b.research.timeLeft / b.research.total), 6);
    }

    // 생산 진행 바
    if (b.queue.length) {
      const j = b.queue[0];
      const w = b.w - 8;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 4, y - 12, w, 6);
      ctx.fillStyle = C.p1_trim;
      ctx.fillRect(x + 4, y - 12, w * (1 - j.timeLeft / j.total), 6);
    }

    // 팀 테두리 (아군/적군 구분)
    const tc = teamColor(g, b.owner);
    if (tc) {
      ctx.strokeStyle = tc; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8;
      ctx.strokeRect(x - 3, y - 3, b.w + 6, b.h + 6);
      ctx.globalAlpha = 1;
    }

    if (b.done) shieldFlare(b);
    shieldBar(b, b.x, y - 25, b.w * 0.8);
    healthBar(b.x, y - 20, b.w * 0.8, b.hp / b.maxHp,
              b.hp < b.maxHp || !b.done || b.def.isCrystal || (b.maxShield > 0 && b.shield < b.maxShield));
  }

  // 유닛 색상(소유자색 + 종족 색조) — drawUnit / drawPortrait 공용
  function unitColors(u, flash) {
    const p = pal(u.owner);
    const c = {
      body:  flash ? '#ffffff' : p.body,
      light: flash ? '#ffffff' : shade(p.body, 0.30),
      dark:  flash ? '#e6e6e6' : shade(p.body, -0.42),
      trim:  flash ? '#ffe6c0' : p.trim,
      steel: flash ? '#ffffff' : '#9fb1c6',
      eye:   C.node,
    };
    // 종족 색조 — 글룹은 유기적 초록빛, 포지는 차가운 강철빛 (소유자 색은 유지)
    if (!flash) {
      // Keep the OWNER's color dominant (blue you / red enemy / green ally / purple) for
      // readability — the faction only tints lightly, staying identifiable via green acid
      // accents (eyes, drips) for Gloop and cool steel highlights for Forge.
      if (u.def.race === 'gloop') {
        c.body = mix(c.body, GLOOP_TINT, 0.14); c.light = mix(c.light, GLOOP_TINT, 0.16);
        c.dark = mix(c.dark, GLOOP_TINT, 0.14); c.steel = mix(c.steel, GLOOP_TINT, 0.30);
        c.eye = '#c9ff8f';
      } else if (u.def.race === 'aether') {
        // Aether — 광택 있는 보랏빛 크리스탈 표면 + 하얗게 빛나는 사이오닉 코어
        c.body = mix(c.body, AETHER_TINT, 0.16); c.light = mix(c.light, PSI, 0.24);
        c.dark = mix(c.dark, AETHER_TINT, 0.18); c.steel = mix(c.steel, AETHER_TINT, 0.34);
        c.eye = PSI_HOT;
        c.psi = PSI;
      } else {
        c.steel = mix(c.steel, FORGE_TINT, 0.22);
      }
      if (!c.psi) c.psi = PSI;
    }
    return c;
  }

  // 유닛 스프라이트 본체 — 원점 기준으로 그림(+x 방향을 바라봄). drawUnit / drawPortrait 공용
  function drawUnitSprite(u, c) {
    // Draw the body slightly larger than the collision radius so units read as solid
    // shapes rather than small blobs sitting on their owner disc. Purely cosmetic.
    const R = u.r * 1.18;
    if (u.type === 'wrench') drawWrench(R, c);
    else if (u.type === 'volt') drawVolt(R, c);
    else if (u.type === 'shielder') drawShielder(R, c);
    else if (u.type === 'spark') drawSpark(R, c);
    else if (u.type === 'hover') drawHover(R, c);
    else if (u.type === 'patch') drawPatch(R, c);
    else if (u.type === 'pulse') drawPulse(R, c);
    else if (u.type === 'heli') drawHeli(R, c);
    else if (u.type === 'jet') drawJet(R, c);
    else if (u.type === 'dropship') drawDropship(R, c);
    else if (u.type === 'slug') drawSlug(R, c);
    else if (u.type === 'globling') drawGlobling(R, c);
    else if (u.type === 'spitter') drawSpitter(R, c);
    else if (u.type === 'bloat') drawBloat(R, c);
    else if (u.type === 'floater') drawFloater(R, c);
    else if (u.type === 'acolyte') drawAcolyte(R, c);
    else if (u.type === 'ardent') drawArdent(R, c);
    else if (u.type === 'lancer') drawLancer(R, c);
    else if (u.type === 'bastion') drawBastion(R, c);
    else if (u.type === 'seraph') drawSeraph(R, c);
    else if (u.type === 'oracle') drawOracle(R, c);
    else if (u.type === 'chaingunner') drawChaingunner(R, c);
    else if (u.type === 'hydra') drawHydra(R, c);
    else if (u.type === 'bladesworn') drawBladesworn(R, c);
    else if (u.type === 'warden') drawWarden(R, c);
    else if (u.type === 'matriarch') drawMatriarch(R, c);
    else if (u.type === 'archon') drawArchon(R, c);
    else { ctx.fillStyle = c.body; rrect(-R, -R, R * 2, R * 2, 3); ctx.fill(); }
  }

  // ══ Aether — 크리스탈 외골격 + 사이오닉 발광 ═══════════
  // 공통 모티프: 각진 결정면 몸통, 하얗게 빛나는 코어, 떠 있는 파편.

  // 떠도는 크리스탈 파편 (여러 유닛이 공유하는 장식)
  function psiShards(R, c, n, rad, spin) {
    const t = performance.now() / 1000 * (spin || 1);
    ctx.fillStyle = c.psi;
    ctx.globalAlpha = 0.75;
    for (let i = 0; i < n; i++) {
      const a = t + (i / n) * Math.PI * 2;
      const px = Math.cos(a) * R * rad, py = Math.sin(a) * R * rad;
      ctx.beginPath();
      ctx.moveTo(px, py - R * 0.17); ctx.lineTo(px + R * 0.11, py); ctx.lineTo(px, py + R * 0.17); ctx.lineTo(px - R * 0.11, py);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 각진 결정 몸통 (육각형에 가까운 다이아몬드)
  function crystalBody(R, c, sx, sy) {
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(R * sx, 0); ctx.lineTo(R * sx * 0.3, -R * sy); ctx.lineTo(-R * sx * 0.85, -R * sy * 0.72);
    ctx.lineTo(-R * sx, 0); ctx.lineTo(-R * sx * 0.85, R * sy * 0.72); ctx.lineTo(R * sx * 0.3, R * sy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * sx * 0.8, 0); ctx.lineTo(R * sx * 0.2, -R * sy * 0.78); ctx.lineTo(-R * sx * 0.68, -R * sy * 0.56);
    ctx.lineTo(-R * sx * 0.8, 0); ctx.lineTo(-R * sx * 0.68, R * sy * 0.56); ctx.lineTo(R * sx * 0.2, R * sy * 0.78);
    ctx.closePath(); ctx.fill();
    // 상단 결정면 하이라이트
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * sx * 0.2, -R * sy * 0.72); ctx.lineTo(-R * sx * 0.62, -R * sy * 0.5);
    ctx.lineTo(-R * sx * 0.2, -R * sy * 0.16); ctx.lineTo(R * sx * 0.45, -R * sy * 0.3);
    ctx.closePath(); ctx.fill();
  }

  function drawAcolyte(R, c) {
    crystalBody(R, c, 0.82, 0.72);
    // 채집용 에너지 집게
    ctx.strokeStyle = c.steel; ctx.lineWidth = R * 0.15; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.5, -R * 0.3); ctx.lineTo(R * 1.0, -R * 0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * 0.5, R * 0.3); ctx.lineTo(R * 1.0, R * 0.14); ctx.stroke();
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 1.05, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
    psiShards(R, c, 2, 0.95, 1.6);
  }

  function drawArdent(R, c) {
    crystalBody(R, c, 0.86, 0.8);
    // 쌍날 사이오닉 블레이드
    ctx.fillStyle = c.psi;
    ctx.globalAlpha = 0.9;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(R * 0.45, s * R * 0.34); ctx.lineTo(R * 1.5, s * R * 0.1);
      ctx.lineTo(R * 0.5, s * R * 0.06); ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1;
    // 발광 코어
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.2, 0, Math.PI * 2); ctx.fill();
  }

  function drawLancer(R, c) {
    crystalBody(R, c, 0.78, 0.76);
    // 삼각대 다리
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.13; ctx.lineCap = 'round';
    [-0.75, 0, 0.75].forEach(a => {
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(-Math.cos(a) * R * 0.95, Math.sin(a) * R * 1.05); ctx.stroke();
    });
    // 전면 위상 포신
    ctx.fillStyle = c.steel;
    ctx.beginPath();
    ctx.moveTo(R * 0.4, -R * 0.2); ctx.lineTo(R * 1.3, -R * 0.09);
    ctx.lineTo(R * 1.3, R * 0.09); ctx.lineTo(R * 0.4, R * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 1.28, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    psiShards(R, c, 3, 1.0, -1.2);
  }

  function drawBastion(R, c) {
    // 육중한 하부 + 이중 크리스탈 장갑
    ctx.fillStyle = c.dark; rrect(-R * 0.8, -R * 0.66, R * 1.6, R * 1.32, R * 0.22); ctx.fill();
    crystalBody(R, c, 0.72, 0.62);
    // 어깨 결정 방벽
    ctx.fillStyle = c.light;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(-R * 0.15, s * R * 0.62); ctx.lineTo(R * 0.3, s * R * 0.95);
      ctx.lineTo(R * 0.62, s * R * 0.55); ctx.lineTo(R * 0.1, s * R * 0.42);
      ctx.closePath(); ctx.fill();
    });
    // 대형 위상 캐논
    ctx.fillStyle = c.steel; ctx.fillRect(R * 0.35, -R * 0.24, R * 1.15, R * 0.48);
    ctx.fillStyle = c.psi; ctx.fillRect(R * 1.42, -R * 0.3, R * 0.2, R * 0.6);
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(-R * 0.1, 0, R * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  function drawSeraph(R, c) {
    // 날개 — 뒤로 젖혀진 에너지 깃
    ctx.fillStyle = c.dark;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(R * 0.1, s * R * 0.16); ctx.lineTo(-R * 1.05, s * R * 0.98);
      ctx.lineTo(-R * 0.55, s * R * 0.2); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = c.psi; ctx.globalAlpha = 0.55;
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(R * 0.05, s * R * 0.14); ctx.lineTo(-R * 0.82, s * R * 0.78);
      ctx.lineTo(-R * 0.5, s * R * 0.2); ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1;
    // 유선형 동체
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 1.25, 0); ctx.lineTo(-R * 0.3, -R * 0.4); ctx.lineTo(-R * 0.62, 0); ctx.lineTo(-R * 0.3, R * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * 1.0, 0); ctx.lineTo(-R * 0.15, -R * 0.22); ctx.lineTo(-R * 0.3, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.5, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }

  function drawOracle(R, c) {
    // 공중에 떠 있는 고리 + 중앙 코어
    const t = performance.now() / 1000;
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.85, R * 0.85, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.62, R * 0.62, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.arc(-R * 0.18, -R * 0.2, R * 0.26, 0, Math.PI * 2); ctx.fill();
    // 회전하는 지지 고리
    ctx.strokeStyle = c.psi; ctx.lineWidth = R * 0.11;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.05, R * 0.42 * (0.5 + 0.5 * Math.abs(Math.cos(t * 1.4))), t * 0.9, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.28, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
    psiShards(R, c, 3, 1.25, 0.8);
  }

  // ── 영웅: 래디언트 아콘 (Aether) — 순수 에너지 존재 ──
  function drawArchon(R, c) {
    const t = performance.now() / 1000;
    // 요동치는 에너지 코로나
    ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t * 3);
    ctx.fillStyle = c.psi;
    ctx.beginPath(); ctx.arc(0, 0, R * (1.15 + 0.08 * Math.sin(t * 2.4)), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 결정 껍질 — 갈라진 판 4장
    ctx.fillStyle = c.dark;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.5 + i * Math.PI / 2;
      ctx.save(); ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(R * 0.42, -R * 0.3); ctx.lineTo(R * 0.95, 0); ctx.lineTo(R * 0.42, R * 0.3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 내부 핵
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.arc(-R * 0.14, -R * 0.16, R * 0.28, 0, Math.PI * 2); ctx.fill();
    // 백열 중심
    ctx.fillStyle = PSI_HOT;
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 5);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 전방 사이오닉 창
    ctx.strokeStyle = c.psi; ctx.lineWidth = R * 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.7, 0); ctx.lineTo(R * 1.35, 0); ctx.stroke();
  }

  // Aether 건물 본체 — 각진 결정 구조 + 부유 파편
  function aetherBody(b, p, x, y) {
    const body = mix(p.body, AETHER_TINT, 0.22);
    const dk = mix(shade(p.body, -0.42), AETHER_TINT, 0.2);
    const lt = mix(shade(p.body, 0.3), PSI, 0.3);
    const t = performance.now() / 1000;
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    rrect(x + 4, y + 7, b.w, b.h, 5); ctx.fill();
    // 모서리를 자른 팔각 실루엣
    const cut = Math.min(b.w, b.h) * 0.24;
    const oct = (ox, oy, w, h, inset) => {
      const k = cut * (1 - inset * 0.5);
      ctx.beginPath();
      ctx.moveTo(ox + k, oy); ctx.lineTo(ox + w - k, oy); ctx.lineTo(ox + w, oy + k);
      ctx.lineTo(ox + w, oy + h - k); ctx.lineTo(ox + w - k, oy + h); ctx.lineTo(ox + k, oy + h);
      ctx.lineTo(ox, oy + h - k); ctx.lineTo(ox, oy + k);
      ctx.closePath();
    };
    ctx.fillStyle = dk; oct(x, y, b.w, b.h, 0); ctx.fill();
    ctx.fillStyle = body; oct(x + 4, y + 4, b.w - 8, b.h - 8, 0.3); ctx.fill();
    // 상단 결정면
    ctx.fillStyle = lt;
    ctx.beginPath();
    ctx.moveTo(x + b.w * 0.22, y + b.h * 0.14); ctx.lineTo(x + b.w * 0.72, y + b.h * 0.2);
    ctx.lineTo(x + b.w * 0.56, y + b.h * 0.44); ctx.lineTo(x + b.w * 0.2, y + b.h * 0.36);
    ctx.closePath(); ctx.fill();
    // 부유 파편 — 건물 위를 천천히 도는 결정
    ctx.fillStyle = PSI; ctx.globalAlpha = 0.6;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.6 + i * 2.09;
      const px = b.x + Math.cos(a) * b.w * 0.42, py = b.y + Math.sin(a) * b.h * 0.3;
      ctx.beginPath();
      ctx.moveTo(px, py - 4.5); ctx.lineTo(px + 3, py); ctx.lineTo(px, py + 4.5); ctx.lineTo(px - 3, py);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = mix(AETHER_TINT, '#140a20', 0.1); ctx.lineWidth = 2;
    oct(x + 2, y + 2, b.w - 4, b.h - 4, 0.2); ctx.stroke();
  }

  // ── 체인거너 (포지) — 쌍열 기관총 보병 ──
  // 실루엣 포인트: 넓은 어깨 + 앞으로 뻗은 두 개의 총열 + 옆구리 탄약 드럼.
  function drawChaingunner(R, c) {
    ctx.fillStyle = c.dark; rrect(-R * 0.62, -R * 0.6, R * 1.2, R * 1.2, 4); ctx.fill();
    ctx.fillStyle = c.body; rrect(-R * 0.52, -R * 0.52, R * 1.0, R * 1.04, 4); ctx.fill();
    ctx.fillStyle = c.light; rrect(-R * 0.52, -R * 0.52, R * 1.0, R * 0.32, 4); ctx.fill();
    // 어깨 패드 (위/아래로 크게 벌려 실루엣을 넓힌다)
    ctx.fillStyle = c.dark;
    rrect(-R * 0.34, -R * 0.98, R * 0.7, R * 0.42, 4); ctx.fill();
    rrect(-R * 0.34, R * 0.56, R * 0.7, R * 0.42, 4); ctx.fill();
    // 쌍열 총신
    ctx.fillStyle = c.steel;
    ctx.fillRect(R * 0.3, -R * 0.42, R * 1.15, R * 0.26);
    ctx.fillRect(R * 0.3, R * 0.16, R * 1.15, R * 0.26);
    ctx.fillStyle = c.trim;
    ctx.fillRect(R * 1.38, -R * 0.48, R * 0.2, R * 0.38);
    ctx.fillRect(R * 1.38, R * 0.1, R * 0.2, R * 0.38);
    // 탄약 드럼
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.5, 0, R * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.arc(-R * 0.5, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    // 바이저
    ctx.fillStyle = c.eye; ctx.fillRect(R * 0.16, -R * 0.12, R * 0.3, R * 0.24);
  }

  // ── 베놈 하이드라 (글룹) — 세 개의 머리를 가진 독사 ──
  // 실루엣 포인트: 굵은 몸통에서 뻗어 나온 세 개의 목 + 뚝뚝 떨어지는 독액.
  function drawHydra(R, c) {
    const t = performance.now() / 420;
    ctx.fillStyle = c.dark; blob(R * 0.92, 0.08, 5); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.76, 0.08, 5); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.ellipse(-R * 0.2, -R * 0.24, R * 0.3, R * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    // 세 개의 목 + 머리 (살짝 흔들린다)
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(t + i * 1.7) * 0.16;
      const a = i * 0.52 + sway;
      const nx = Math.cos(a), ny = Math.sin(a);
      ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.24; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nx * R * 0.32, ny * R * 0.32);
      ctx.lineTo(nx * R * 1.02, ny * R * 1.02);
      ctx.stroke();
      ctx.fillStyle = c.body;
      ctx.beginPath(); ctx.ellipse(nx * R * 1.12, ny * R * 1.12, R * 0.26, R * 0.19, a, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ACID;                                   // 벌어진 아가리
      ctx.beginPath(); ctx.arc(nx * R * 1.28, ny * R * 1.28, R * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c.eye;
      ctx.beginPath(); ctx.arc(nx * R * 1.06, ny * R * 1.06, R * 0.07, 0, Math.PI * 2); ctx.fill();
    }
    // 독액 방울
    ctx.fillStyle = ACID; ctx.globalAlpha = 0.55;
    for (let i = 0; i < 3; i++) {
      const a = t * 0.8 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.55, Math.sin(a * 1.3) * R * 0.5 + R * 0.3, R * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── 블레이드스원 (Aether) — 쌍검 암살자 ──
  // 실루엣 포인트: 가느다란 몸 + 앞으로 길게 뻗은 두 자루의 빛나는 칼날.
  function drawBladesworn(R, c) {
    // 낮게 웅크린 마름모 몸통
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(R * 0.62, 0); ctx.lineTo(-R * 0.1, -R * 0.56);
    ctx.lineTo(-R * 0.66, 0); ctx.lineTo(-R * 0.1, R * 0.56);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 0.48, 0); ctx.lineTo(-R * 0.08, -R * 0.42);
    ctx.lineTo(-R * 0.5, 0); ctx.lineTo(-R * 0.08, R * 0.42);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * 0.3, -R * 0.06); ctx.lineTo(-R * 0.06, -R * 0.32);
    ctx.lineTo(-R * 0.32, -R * 0.04); ctx.closePath(); ctx.fill();
    // 두 자루 장검 — 교차하며 앞으로
    [-1, 1].forEach(s => {
      ctx.fillStyle = c.psi;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.moveTo(R * 0.2, s * R * 0.3);       // 손잡이
      ctx.lineTo(R * 1.65, s * R * 0.12);     // 칼끝
      ctx.lineTo(R * 1.62, s * R * 0.3);
      ctx.lineTo(R * 0.22, s * R * 0.48);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.steel;                 // 손잡이 가드
      ctx.fillRect(R * 0.12, s * R * 0.24, R * 0.16, R * 0.3);
    });
    // 발광 코어 + 눈
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PSI_HOT;
    ctx.beginPath(); ctx.arc(R * 0.26, 0, R * 0.08, 0, Math.PI * 2); ctx.fill();
  }

  // ── 영웅: 아이언클래드 워든 (포지) — 거대 전투 메카 ──
  function drawWarden(R, c) {
    ctx.fillStyle = c.dark; rrect(-R * 0.72, -R * 0.5, R * 1.44, R * 1.1, 5); ctx.fill();
    ctx.fillStyle = c.body; rrect(-R * 0.58, -R * 0.62, R * 1.15, R * 1.05, 5); ctx.fill();
    ctx.fillStyle = c.light; rrect(-R * 0.58, -R * 0.62, R * 1.15, R * 0.34, 5); ctx.fill();
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.12, -R * 0.68, R * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-R * 0.12, R * 0.68, R * 0.34, 0, Math.PI * 2); ctx.fill();
    // 대형 팔포/해머 (앞으로)
    ctx.fillStyle = c.steel; ctx.fillRect(R * 0.2, -R * 0.26, R * 1.2, R * 0.52);
    ctx.fillStyle = c.trim; ctx.fillRect(R * 1.35, -R * 0.36, R * 0.28, R * 0.72);
    // 머리 + 바이저
    ctx.fillStyle = c.steel; ctx.beginPath(); ctx.arc(R * 0.22, 0, R * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.eye; ctx.fillRect(R * 0.36, -R * 0.13, R * 0.18, R * 0.26);
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.2;
    rrect(-R * 0.58, -R * 0.62, R * 1.15, R * 1.05, 5); ctx.stroke();
  }

  // ── 영웅: 브루드 매트리아크 (글룹) — 거대 여왕 점액 ──
  function drawMatriarch(R, c) {
    ctx.fillStyle = c.dark; blob(R * 1.05, 0.1, 2); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.9, 0.1, 2); ctx.fill();
    ctx.fillStyle = c.light; ctx.beginPath(); ctx.arc(-R * 0.2, -R * 0.24, R * 0.4, 0, Math.PI * 2); ctx.fill();
    // 왕관 가시
    ctx.fillStyle = ACID;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * R * 0.3, -R * 0.66); ctx.lineTo(i * R * 0.3 + R * 0.1, -R * 1.05); ctx.lineTo(i * R * 0.3 + R * 0.2, -R * 0.66);
      ctx.closePath(); ctx.fill();
    }
    // 분사 주둥이
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.moveTo(R * 0.5, -R * 0.26); ctx.lineTo(R * 1.1, 0); ctx.lineTo(R * 0.5, R * 0.26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ACID; ctx.beginPath(); ctx.arc(R * 1.02, 0, R * 0.17, 0, Math.PI * 2); ctx.fill();
    // 눈
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(R * 0.05, -R * 0.12, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }

  // 선택 유닛 초상화 — 작은 캔버스에 확대/애니메이션으로 '카메라 피드'처럼 보여준다
  function drawPortrait(canvas, u) {
    if (!canvas || !u) return;
    const pctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const saved = ctx;
    ctx = pctx;                       // 스프라이트 함수들이 쓰는 모듈 ctx를 잠시 교체
    try {
      ctx.clearRect(0, 0, W, H);
      // 배경 — 종족색 은은한 방사 그라디언트
      const tintBg = u.def.race === 'gloop' ? '#0c1f16'
                   : u.def.race === 'aether' ? '#16102a'
                   : '#0c1622';
      const bg = ctx.createRadialGradient(W / 2, H * 0.42, 3, W / 2, H * 0.52, H * 0.78);
      bg.addColorStop(0, tintBg); bg.addColorStop(1, '#05090e');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      const t = performance.now() / 1000;
      const bob = Math.sin(t * 2.3) * H * 0.02;      // 숨쉬는 듯한 위아래 흔들림
      const c = unitColors(u, false);
      ctx.translate(W / 2, H * 0.55 + bob);
      const scale = (Math.min(W, H) * 0.30) / Math.max(7, u.r);
      ctx.scale(scale, scale);
      ctx.rotate(Math.sin(t * 1.1) * 0.05);          // 미세한 좌우 흔들림
      ctx.fillStyle = 'rgba(0,0,0,0.32)';            // 바닥 그림자
      ctx.beginPath(); ctx.ellipse(0, u.r * 1.15, u.r * 1.15, u.r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      drawUnitSprite(u, c);
      ctx.restore();

      // 스캔라인 오버레이 (카메라 피드 느낌)
      ctx.save();
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#8fe3ff';
      for (let y = (performance.now() / 26) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      ctx.restore();
    } finally {
      ctx = saved;                    // 반드시 메인 캔버스 ctx로 복구
    }
  }

  function drawUnit(g, u) {
    if (u.downed) return;              // 전사한 영웅 — 필드에 표시하지 않음(부활 대기)
    if (fogged(g, u)) return;
    const flash = u.hitFlash > 0;
    const c = unitColors(u, flash);

    const alt = u.def.flying ? 15 : 0;   // 공중 유닛 고도

    ctx.save();
    ctx.translate(u.x, u.y);

    // 그림자 (공중 유닛은 아래쪽에 더 흐리게)
    ctx.fillStyle = alt ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(2, u.r * 0.8 + alt * 0.5, u.r * 1.05, u.r * 0.42, 0, 0, Math.PI * 2); ctx.fill();

    // 소유자 원반 — 모든 유닛 발밑에 주인 색 디스크를 항상 깐다.
    // 유닛 스프라이트만으로는 난전에서 누가 누구인지 알아보기 어려워서, 색 원반이
    // 가장 확실한 식별 수단이 된다 (내 유닛에도 그린다).
    const op = pal(u.owner);
    ctx.save();
    const rx = u.r * 1.12, ry = u.r * 0.5, oy = u.r * 0.72;
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = op.body;
    ctx.beginPath(); ctx.ellipse(0, oy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = op.body; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.ellipse(0, oy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    // 팀 구분 보조 링 (아군=파랑 / 적군=주황) — 내 유닛엔 없음
    const tc = teamColor(g, u.owner);
    if (tc) {
      ctx.strokeStyle = tc; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(0, oy, rx * 1.2, ry * 1.2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    ctx.translate(0, -alt);
    ctx.rotate(u.facing);
    drawUnitSprite(u, c);

    ctx.restore();

    // 버프/디버프 표시 링 + 시전 섬광
    drawBuffs(u);

    // 영웅 표식 — 금색 링 + 레벨 배지
    if (u.hero) {
      ctx.save();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(u.x, u.y + u.r * 0.5, u.r * 1.4, u.r * 0.64, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(10,16,22,0.9)';
      ctx.beginPath(); ctx.arc(u.x - u.r - 3, u.y - u.r - 3, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.level || 1), u.x - u.r - 3, u.y - u.r - 3);
      ctx.restore();
    }

    // 자원 운반 표시 — 등에 진 광석
    if (u.carry > 0) {
      ctx.save();
      ctx.fillStyle = C.node;
      ctx.beginPath(); ctx.arc(u.x + u.r * 0.7, u.y - u.r * 0.9, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(u.x + u.r * 0.7 - 1.3, u.y - u.r * 0.9 - 1.3, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 플라즈마 실드 (Aether) — 껍질 반짝임 + 체력바 위 실드 띠
    shieldFlare(u);
    shieldBar(u, u.x, u.y - u.r - 14, u.r * 2.3);
    healthBar(u.x, u.y - u.r - 10, u.r * 2.3, u.hp / u.maxHp, u.hp < u.maxHp || (u.maxShield > 0 && u.shield < u.maxShield));
    // 에너지 바 — 스킬 있는 유닛만, 체력바 바로 아래
    if (u.maxEnergy && (u.hp < u.maxHp || u.energy < u.maxEnergy)) {
      const w = u.r * 2.3, frac = Math.max(0, Math.min(1, u.energy / (u.effMaxEnergy ? u.effMaxEnergy(g) : u.maxEnergy)));
      const y = u.y - u.r - 5;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(u.x - w / 2, y, w, 3);
      ctx.fillStyle = C.energy;
      ctx.fillRect(u.x - w / 2, y, w * frac, 3);
    }
    // 수송선 탑승 인원 배지
    if (u.cargo && u.cargo.length) {
      ctx.save();
      ctx.fillStyle = 'rgba(10,16,22,0.85)';
      rrect(u.x + u.r - 2, u.y - u.r - 14, 20, 14, 4); ctx.fill();
      ctx.fillStyle = C.heal;
      ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.cargo.length), u.x + u.r + 8, u.y - u.r - 7);
      ctx.restore();
    }
  }

  // ── 버프/디버프 표시 ──
  function drawBuffs(u) {
    ctx.save();
    ctx.translate(u.x, u.y);
    const t = performance.now() / 1000;
    // 시전 순간 섬광
    if (u.castFx > 0) {
      ctx.globalAlpha = Math.min(1, u.castFx / 0.4) * 0.6;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 6 + (0.4 - u.castFx) * 40, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const ring = (col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t * 6);
      ctx.beginPath(); ctx.arc(0, 0, u.r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    };
    if (u.surge > 0) ring('#ff6b57');          // 과부하 = 빨강
    else if (u.rail > 0) ring('#f0a02a');      // 조준 사격 = 주황
    else if (u.bulwark > 0) {                  // 방벽 = 파란 실드 아크
      ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(0, 0, u.r + 5, -Math.PI * 0.75, Math.PI * 0.75); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (u.slow > 0) {                           // 정전 = 보라 점선
      ctx.strokeStyle = '#c88bff'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    if (u.acidStacks > 0) {                      // 산성 = 초록 방울 링 (중첩 수만큼 진하게)
      const k = Math.min(1, u.acidStacks / 5);
      ctx.strokeStyle = '#7dff9e'; ctx.lineWidth = 1.5 + k * 1.5; ctx.globalAlpha = 0.35 + 0.45 * k;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#5ddc7a'; ctx.globalAlpha = 0.7;
      for (let i = 0; i < u.acidStacks; i++) {
        const a = t * 2 + i * (Math.PI * 2 / 5);
        ctx.beginPath(); ctx.arc(Math.cos(a) * (u.r + 3), Math.sin(a) * (u.r + 3), 1.8, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ── 렌치봇 (일꾼) — 작은 정비 로봇, 집게팔 + 센서 눈 ──
  function drawWrench(R, c) {
    // 캐터필러 (위/아래)
    ctx.fillStyle = c.dark;
    rrect(-R * 0.85, -R * 0.98, R * 1.6, R * 0.34, 3); ctx.fill();
    rrect(-R * 0.85,  R * 0.64, R * 1.6, R * 0.34, 3); ctx.fill();
    // 몸체
    ctx.fillStyle = c.body;
    rrect(-R * 0.65, -R * 0.68, R * 1.3, R * 1.36, 4); ctx.fill();
    // 상단 하이라이트
    ctx.fillStyle = c.light;
    rrect(-R * 0.65, -R * 0.68, R * 1.3, R * 0.4, 4); ctx.fill();
    // 패널 라인
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(-R * 0.15, -R * 0.55); ctx.lineTo(-R * 0.15, R * 0.55); ctx.stroke();
    // 집게팔
    ctx.fillStyle = c.trim;
    ctx.fillRect(R * 0.55, -R * 0.13, R * 0.5, R * 0.26);
    ctx.lineWidth = R * 0.15; ctx.strokeStyle = c.trim;
    ctx.beginPath(); ctx.arc(R * 1.12, 0, R * 0.26, -Math.PI * 0.62, Math.PI * 0.62); ctx.stroke();
    // 센서 눈
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.3, 0, R * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(R * 0.24, -R * 0.06, R * 0.08, 0, Math.PI * 2); ctx.fill();
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    rrect(-R * 0.65, -R * 0.68, R * 1.3, R * 1.36, 4); ctx.stroke();
  }

  // ── 볼트병 (보병) — 어깨 장갑 + 라이플 로봇 ──
  function drawVolt(R, c) {
    // 후방 추진팩
    ctx.fillStyle = c.dark;
    rrect(-R * 0.92, -R * 0.5, R * 0.42, R * 1.0, 3); ctx.fill();
    // 몸체
    ctx.fillStyle = c.body;
    rrect(-R * 0.6, -R * 0.6, R * 1.15, R * 1.2, 4); ctx.fill();
    ctx.fillStyle = c.light;
    rrect(-R * 0.6, -R * 0.6, R * 1.15, R * 0.36, 4); ctx.fill();
    // 어깨 장갑
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.15, -R * 0.68, R * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(-R * 0.15,  R * 0.68, R * 0.28, 0, Math.PI * 2); ctx.fill();
    // 라이플 (오른쪽 어깨에서 앞으로)
    ctx.fillStyle = c.dark;
    ctx.fillRect(R * 0.2, -R * 0.62, R * 1.1, R * 0.2);
    ctx.fillStyle = c.trim;
    ctx.fillRect(R * 1.18, -R * 0.62, R * 0.18, R * 0.2); // 총구
    // 머리 돔
    ctx.fillStyle = c.steel;
    ctx.beginPath(); ctx.arc(R * 0.18, 0, R * 0.3, 0, Math.PI * 2); ctx.fill();
    // 바이저
    ctx.fillStyle = c.eye;
    ctx.fillRect(R * 0.3, -R * 0.14, R * 0.14, R * 0.28);
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    rrect(-R * 0.6, -R * 0.6, R * 1.15, R * 1.2, 4); ctx.stroke();
  }

  // ── 실드러 (방패 탱커) — 무거운 장갑 + 대형 방패 ──
  function drawShielder(R, c) {
    // 무거운 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.8, -R * 1.02, R * 1.4, R * 0.42, 4); ctx.fill();
    rrect(-R * 0.8,  R * 0.6,  R * 1.4, R * 0.42, 4); ctx.fill();
    // 캐터필러 볼트
    ctx.fillStyle = shade(c.dark, 0.25);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(i * R * 0.28, -R * 0.81, R * 0.06, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(i * R * 0.28,  R * 0.81, R * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    // 몸체
    ctx.fillStyle = c.body;
    rrect(-R * 0.72, -R * 0.72, R * 1.34, R * 1.44, 5); ctx.fill();
    ctx.fillStyle = c.light;
    rrect(-R * 0.72, -R * 0.72, R * 1.34, R * 0.42, 5); ctx.fill();
    // 바이저 슬릿
    ctx.fillStyle = c.eye;
    ctx.fillRect(R * 0.08, -R * 0.26, R * 0.14, R * 0.52);
    // 대형 방패 (앞면)
    ctx.fillStyle = c.steel;
    rrect(R * 0.5, -R * 0.98, R * 0.4, R * 1.96, 6); ctx.fill();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.2;
    rrect(R * 0.5, -R * 0.98, R * 0.4, R * 1.96, 6); ctx.stroke();
    // 방패 문양 + 리벳
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.arc(R * 0.7, 0, R * 0.24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.dark;
    [-0.7, -0.35, 0.35, 0.7].forEach(t => {
      ctx.beginPath(); ctx.arc(R * 0.7, t * R, R * 0.06, 0, Math.PI * 2); ctx.fill();
    });
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    rrect(-R * 0.72, -R * 0.72, R * 1.34, R * 1.44, 5); ctx.stroke();
  }

  // ── 스파크캐논 (공성) — 궤도 위 대형 포신 ──
  function drawSpark(R, c) {
    // 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.75, -R * 0.95, R * 1.35, R * 0.4, 4); ctx.fill();
    rrect(-R * 0.75,  R * 0.55, R * 1.35, R * 0.4, 4); ctx.fill();
    ctx.fillStyle = shade(c.dark, 0.25);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(i * R * 0.26, -R * 0.75, R * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(i * R * 0.26,  R * 0.75, R * 0.055, 0, Math.PI * 2); ctx.fill();
    }
    // 차체
    ctx.fillStyle = c.body;
    rrect(-R * 0.62, -R * 0.55, R * 1.05, R * 1.1, 4); ctx.fill();
    ctx.fillStyle = c.light;
    rrect(-R * 0.62, -R * 0.55, R * 1.05, R * 0.34, 4); ctx.fill();
    // 포탑 베이스
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.36, 0, Math.PI * 2); ctx.fill();
    // 대형 포신 (앞으로 길게)
    ctx.fillStyle = shade(c.body, -0.2);
    ctx.fillRect(R * 0.1, -R * 0.16, R * 1.4, R * 0.32);
    ctx.fillStyle = c.trim;
    ctx.fillRect(R * 1.4, -R * 0.2, R * 0.22, R * 0.4);   // 포구
    // 에너지 코일 (포신 뿌리 발광)
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.12, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    rrect(-R * 0.62, -R * 0.55, R * 1.05, R * 1.1, 4); ctx.stroke();
  }

  // ── 호버윙 (공중) — 회전 로터 달린 비행체 ──
  function drawHover(R, c) {
    const spin = performance.now() / 40;
    // 로터 (양옆, 회전하는 날)
    ctx.strokeStyle = shade(c.body, -0.1); ctx.lineWidth = 1.6;
    [[-R * 0.15, -R * 0.75], [-R * 0.15, R * 0.75]].forEach(([px, py]) => {
      ctx.fillStyle = c.dark;
      ctx.beginPath(); ctx.arc(px, py, R * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(px, py); ctx.rotate(spin);
      ctx.strokeStyle = shade(c.light, 0.1); ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 0.48, 0); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = c.trim;
      ctx.beginPath(); ctx.arc(px, py, R * 0.1, 0, Math.PI * 2); ctx.fill();
    });
    // 동체 (앞이 뾰족한 유선형)
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 1.05, 0);
    ctx.lineTo(R * 0.1, -R * 0.5);
    ctx.lineTo(-R * 0.7, -R * 0.32);
    ctx.lineTo(-R * 0.7, R * 0.32);
    ctx.lineTo(R * 0.1, R * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * 1.05, 0);
    ctx.lineTo(R * 0.1, -R * 0.5);
    ctx.lineTo(-R * 0.2, -R * 0.16);
    ctx.lineTo(R * 0.3, 0);
    ctx.closePath(); ctx.fill();
    // 콕핏 (발광 눈)
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.4, 0, R * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(R * 0.44, -R * 0.05, R * 0.08, 0, Math.PI * 2); ctx.fill();
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(R * 1.05, 0);
    ctx.lineTo(R * 0.1, -R * 0.5);
    ctx.lineTo(-R * 0.7, -R * 0.32);
    ctx.lineTo(-R * 0.7, R * 0.32);
    ctx.lineTo(R * 0.1, R * 0.5);
    ctx.closePath(); ctx.stroke();
  }

  // ── 패치봇 (정비 지원) — 둥근 몸체 + 십자 + 스프레이 노즐 ──
  function drawPatch(R, c) {
    // 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.8, -R * 0.9, R * 1.5, R * 0.32, 3); ctx.fill();
    rrect(-R * 0.8,  R * 0.58, R * 1.5, R * 0.32, 3); ctx.fill();
    // 둥근 몸체
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.arc(-R * 0.2, -R * 0.24, R * 0.42, 0, Math.PI * 2); ctx.fill();
    // 치유 십자 (흰 바탕 + 초록 십자)
    ctx.fillStyle = '#eef6ff';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.heal;
    ctx.fillRect(-R * 0.1, -R * 0.32, R * 0.2, R * 0.64);
    ctx.fillRect(-R * 0.32, -R * 0.1, R * 0.64, R * 0.2);
    // 앞쪽 스프레이 노즐
    ctx.fillStyle = c.trim;
    ctx.fillRect(R * 0.68, -R * 0.12, R * 0.4, R * 0.24);
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 1.02, 0, R * 0.1, 0, Math.PI * 2); ctx.fill();
    // 외곽선
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, Math.PI * 2); ctx.stroke();
  }

  // ── 펄스코일 (교란 캐스터) — 삼각 동체 + 상단 코일 안테나 ──
  function drawPulse(R, c) {
    const t = performance.now() / 1000;
    // 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.75, -R * 0.88, R * 1.4, R * 0.3, 3); ctx.fill();
    rrect(-R * 0.75,  R * 0.58, R * 1.4, R * 0.3, 3); ctx.fill();
    // 삼각 동체
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 0.95, 0);
    ctx.lineTo(-R * 0.6, -R * 0.62);
    ctx.lineTo(-R * 0.6, R * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * 0.95, 0);
    ctx.lineTo(-R * 0.6, -R * 0.62);
    ctx.lineTo(-R * 0.2, -R * 0.12);
    ctx.closePath(); ctx.fill();
    // 상단 테슬라 코일 (발광 구슬 + 스파크)
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.26, 0, Math.PI * 2); ctx.fill();
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 5));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#8fe3ff';
    ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // 스파크 가지
    ctx.strokeStyle = '#bfefff'; ctx.lineWidth = 1.3; ctx.globalAlpha = pulse;
    for (let k = 0; k < 4; k++) {
      const a = t * 2 + k * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.05, 0);
      ctx.lineTo(-R * 0.05 + Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // 콕핏 눈
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.5, 0, R * 0.13, 0, Math.PI * 2); ctx.fill();
  }

  // ── 래틀러 헬기 — 로터 + 로켓 포드 ──
  function drawHeli(R, c) {
    const spin = performance.now() / 22;
    // 꼬리 붐
    ctx.fillStyle = c.dark;
    rrect(-R * 1.15, -R * 0.12, R * 0.9, R * 0.24, 3); ctx.fill();
    // 꼬리 로터
    ctx.save(); ctx.translate(-R * 1.15, 0); ctx.rotate(spin * 1.4);
    ctx.strokeStyle = c.trim; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -R * 0.3); ctx.lineTo(0, R * 0.3); ctx.stroke();
    ctx.restore();
    // 동체
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 0.95, 0);
    ctx.lineTo(R * 0.2, -R * 0.55);
    ctx.lineTo(-R * 0.55, -R * 0.4);
    ctx.lineTo(-R * 0.55, R * 0.4);
    ctx.lineTo(R * 0.2, R * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.arc(R * 0.35, 0, R * 0.24, 0, Math.PI * 2); ctx.fill();
    // 로켓 포드 (양옆)
    ctx.fillStyle = c.dark;
    rrect(-R * 0.1, -R * 0.66, R * 0.5, R * 0.18, 2); ctx.fill();
    rrect(-R * 0.1,  R * 0.48, R * 0.5, R * 0.18, 2); ctx.fill();
    // 콕핏
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.5, 0, R * 0.14, 0, Math.PI * 2); ctx.fill();
    // 메인 로터 (머리 위, 회전)
    ctx.save(); ctx.rotate(spin);
    ctx.strokeStyle = shade(c.light, 0.1); ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(-R * 1.1, 0); ctx.lineTo(R * 1.1, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -R * 1.1); ctx.lineTo(0, R * 1.1); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.12, 0, Math.PI * 2); ctx.fill();
  }

  // ── 팰컨 제트 — 날카로운 화살형 전투기 ──
  function drawJet(R, c) {
    // 날개
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(-R * 0.1, 0);
    ctx.lineTo(-R * 0.6, -R * 0.9);
    ctx.lineTo(-R * 0.2, -R * 0.15);
    ctx.lineTo(-R * 0.2, R * 0.15);
    ctx.lineTo(-R * 0.6, R * 0.9);
    ctx.closePath(); ctx.fill();
    // 동체 (뾰족)
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 1.2, 0);
    ctx.lineTo(-R * 0.2, -R * 0.28);
    ctx.lineTo(-R * 0.7, -R * 0.16);
    ctx.lineTo(-R * 0.7, R * 0.16);
    ctx.lineTo(-R * 0.2, R * 0.28);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.moveTo(R * 1.2, 0);
    ctx.lineTo(-R * 0.2, -R * 0.28);
    ctx.lineTo(R * 0.2, 0);
    ctx.closePath(); ctx.fill();
    // 콕핏
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.ellipse(R * 0.45, 0, R * 0.18, R * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    // 엔진 불꽃
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(-R * 0.7, -R * 0.1);
    ctx.lineTo(-R * 1.0, 0);
    ctx.lineTo(-R * 0.7, R * 0.1);
    ctx.closePath(); ctx.fill();
  }

  // ── 페리 수송선 — 넓적한 화물 왕복선 ──
  function drawDropship(R, c) {
    // 하부 그림자 동체
    ctx.fillStyle = c.dark;
    rrect(-R * 0.85, -R * 0.6, R * 1.7, R * 1.2, 8); ctx.fill();
    // 본체
    ctx.fillStyle = c.body;
    rrect(-R * 0.75, -R * 0.5, R * 1.55, R * 1.0, 7); ctx.fill();
    ctx.fillStyle = c.light;
    rrect(-R * 0.75, -R * 0.5, R * 1.55, R * 0.34, 7); ctx.fill();
    // 앞쪽 조종석
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(R * 0.8, -R * 0.4);
    ctx.lineTo(R * 1.15, 0);
    ctx.lineTo(R * 0.8, R * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.eye;
    ctx.beginPath(); ctx.arc(R * 0.8, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    // 엔진 포드 (양옆)
    ctx.fillStyle = c.trim;
    rrect(-R * 0.5, -R * 0.72, R * 0.5, R * 0.2, 3); ctx.fill();
    rrect(-R * 0.5,  R * 0.52, R * 0.5, R * 0.2, 3); ctx.fill();
    // 화물칸 라인
    ctx.strokeStyle = c.dark; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-R * 0.4, -R * 0.5); ctx.lineTo(-R * 0.4, R * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(R * 0.1, -R * 0.5); ctx.lineTo(R * 0.1, R * 0.5); ctx.stroke();
  }

  // ══ 글룹(Gloop) — 산성 점액 유닛 ═══════════════════
  const ACID = '#7dff9e';
  const GLOOP_TINT = '#4fd06a';   // 유기적 초록빛 (종족 색조)
  const FORGE_TINT = '#8fb0d8';   // 차가운 강철빛 (종족 색조)
  const AETHER_TINT = '#b98cff';  // 사이오닉 보랏빛 (종족 색조)
  const PSI = '#e2c6ff';          // 발광 에너지 (실드 / 크리스탈 코어)
  const PSI_HOT = '#ffffff';

  // 글룹 건물 본체 — 둥근 점액 덩어리 + 방울 (금속 대신)
  function gloopBody(b, p, x, y) {
    const rad = Math.min(b.w, b.h) * 0.4;
    const body = mix(p.body, GLOOP_TINT, 0.24);
    const dk = mix(shade(p.body, -0.4), GLOOP_TINT, 0.18);
    const lt = mix(shade(p.body, 0.28), GLOOP_TINT, 0.26);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rrect(x + 4, y + 7, b.w, b.h, rad); ctx.fill();
    ctx.fillStyle = dk;
    rrect(x, y, b.w, b.h, rad); ctx.fill();
    ctx.fillStyle = body;
    rrect(x, y, b.w, b.h * 0.86, rad); ctx.fill();
    // 미끈한 하이라이트
    ctx.fillStyle = lt;
    ctx.beginPath(); ctx.ellipse(b.x - b.w * 0.16, b.y - b.h * 0.22, b.w * 0.26, b.h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    // 표면 방울
    ctx.fillStyle = ACID; ctx.globalAlpha = 0.4;
    const t = performance.now() / 700;
    for (let i = 0; i < 3; i++) {
      const a = t + i * 2.1;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(a) * b.w * 0.28, b.y + Math.sin(a * 1.3) * b.h * 0.24, 3 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 얇은 테두리
    ctx.strokeStyle = mix(GLOOP_TINT, '#0a1410', 0.15); ctx.lineWidth = 2;
    rrect(x + 2, y + 2, b.w - 4, b.h - 4, rad - 2); ctx.stroke();
  }
  // 울렁이는 블롭 외곽 (n개 정점을 시간에 따라 흔든다)
  function blob(R, wob, seed) {
    const t = performance.now() / 380 + seed;
    const n = 9;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = R * (1 + Math.sin(a * 3 + t) * wob + Math.cos(a * 2 - t * 0.7) * wob * 0.6);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function drawSlug(R, c) {
    ctx.fillStyle = c.dark; blob(R * 0.9, 0.08, 0); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.76, 0.08, 0); ctx.fill();
    // 등껍질 — 일꾼만의 실루엣 (전투 유닛과 확실히 구분된다)
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.ellipse(-R * 0.24, -R * 0.3, R * 0.58, R * 0.42, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.light;
    ctx.beginPath(); ctx.ellipse(-R * 0.28, -R * 0.36, R * 0.36, R * 0.24, -0.35, 0, Math.PI * 2); ctx.fill();
    // 더듬이 두 가닥
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.09; ctx.lineCap = 'round';
    [-1, 1].forEach(k => {
      ctx.beginPath(); ctx.moveTo(R * 0.34, k * R * 0.2);
      ctx.lineTo(R * 0.78, k * R * 0.55); ctx.stroke();
      ctx.fillStyle = ACID;
      ctx.beginPath(); ctx.arc(R * 0.8, k * R * 0.58, R * 0.09, 0, Math.PI * 2); ctx.fill();
    });
    // 채집 촉수
    ctx.strokeStyle = ACID; ctx.lineWidth = R * 0.15; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.36, 0); ctx.lineTo(R * 1.02, -R * 0.08); ctx.stroke();
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(R * 0.26, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }
  function drawGlobling(R, c) {
    ctx.fillStyle = c.dark; blob(R * 0.98, 0.14, 7); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.82, 0.14, 7); ctx.fill();
    ctx.fillStyle = c.light; ctx.beginPath(); ctx.arc(-R * 0.18, -R * 0.2, R * 0.3, 0, Math.PI * 2); ctx.fill();
    // 이빨
    ctx.fillStyle = '#eef6ff';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(R * (0.5 + i * 0.16), -R * 0.12);
      ctx.lineTo(R * (0.58 + i * 0.16), R * 0.14);
      ctx.lineTo(R * (0.42 + i * 0.16), R * 0.05);
      ctx.closePath(); ctx.fill();
    }
    // 앞으로 뻗은 두 개의 집게발 — 근접 돌격형 실루엣
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.17; ctx.lineCap = 'round';
    [-1, 1].forEach(k => {
      ctx.beginPath();
      ctx.moveTo(R * 0.3, k * R * 0.34);
      ctx.lineTo(R * 0.92, k * R * 0.62);
      ctx.lineTo(R * 1.22, k * R * 0.3);
      ctx.stroke();
    });
    // 등 가시
    ctx.fillStyle = c.dark;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-R * (0.2 + i * 0.22), -R * 0.5);
      ctx.lineTo(-R * (0.32 + i * 0.22), -R * 1.0);
      ctx.lineTo(-R * (0.04 + i * 0.22), -R * 0.56);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(R * 0.05, -R * 0.28, R * 0.14, 0, Math.PI * 2); ctx.fill();
  }
  function drawSpitter(R, c) {
    ctx.fillStyle = c.dark; blob(R * 0.95, 0.1, 3); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.8, 0.1, 3); ctx.fill();
    ctx.fillStyle = c.light; ctx.beginPath(); ctx.arc(-R * 0.2, -R * 0.22, R * 0.3, 0, Math.PI * 2); ctx.fill();
    // 위로 치켜든 목 + 긴 분사 주둥이 — 원거리형 실루엣
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.26; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.1, -R * 0.1); ctx.lineTo(R * 0.62, -R * 0.62); ctx.stroke();
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(R * 0.42, -R * 0.86); ctx.lineTo(R * 1.32, -R * 0.44);
    ctx.lineTo(R * 0.5, -R * 0.28); ctx.closePath(); ctx.fill();
    ctx.fillStyle = ACID;
    ctx.beginPath(); ctx.arc(R * 1.26, -R * 0.46, R * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }
  function drawBloat(R, c) {
    ctx.fillStyle = c.dark; blob(R * 1.0, 0.09, 1); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.88, 0.09, 1); ctx.fill();
    ctx.fillStyle = c.light; ctx.beginPath(); ctx.arc(-R * 0.24, -R * 0.26, R * 0.4, 0, Math.PI * 2); ctx.fill();
    // 부글대는 산성 물집
    const t = performance.now() / 500;
    ctx.fillStyle = ACID;
    for (let i = 0; i < 4; i++) {
      const a = t + i * Math.PI / 2;
      const bx = Math.cos(a) * R * 0.4, by = Math.sin(a) * R * 0.4;
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 2 + i);
      ctx.beginPath(); ctx.arc(bx, by, R * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(R * 0.2, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }
  function drawFloater(R, c) {
    // 늘어진 촉수
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.14; ctx.lineCap = 'round';
    const t = performance.now() / 300;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * R * 0.35, R * 0.3);
      ctx.quadraticCurveTo(i * R * 0.35 + Math.sin(t + i) * R * 0.2, R * 0.7, i * R * 0.35, R * 1.0);
      ctx.stroke();
    }
    // 가스 주머니 본체
    ctx.fillStyle = c.dark; blob(R * 0.92, 0.07, 5); ctx.fill();
    ctx.fillStyle = c.body; blob(R * 0.78, 0.07, 5); ctx.fill();
    ctx.fillStyle = c.light; ctx.beginPath(); ctx.arc(-R * 0.2, -R * 0.26, R * 0.34, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.6; ctx.fillStyle = ACID;
    ctx.beginPath(); ctx.arc(R * 0.15, R * 0.1, R * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = c.eye; ctx.beginPath(); ctx.arc(R * 0.05, -R * 0.1, R * 0.14, 0, Math.PI * 2); ctx.fill();
  }

  function healthBar(cx, y, w, frac, show) {
    if (!show) return;
    const h = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = frac > 0.35 ? C.hpGood : C.hpBad;
    ctx.fillRect(cx - w / 2, y, w * Math.max(0, frac), h);
  }

  // 플라즈마 실드 바 (Aether) — 체력바 바로 위에 얇은 하늘빛 띠
  function shieldBar(e, cx, y, w) {
    if (!e.maxShield) return;
    const frac = Math.max(0, Math.min(1, e.shield / e.maxShield));
    if (frac >= 1 && e.hp >= e.maxHp) return;    // 완전 무손상이면 숨김
    const h = 3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx - w / 2, y, w, h);
    ctx.fillStyle = PSI;
    ctx.fillRect(cx - w / 2, y, w * frac, h);
  }

  // 피격 순간 실드 껍질 반짝임
  function shieldFlare(e) {
    if (!e.maxShield || e.shield <= 0) return;
    const a = e.shieldFx > 0 ? Math.min(1, e.shieldFx / 0.18) : 0;
    const idle = 0.10 * (e.shield / e.maxShield);   // 은은한 상시 껍질
    const alpha = Math.max(idle, a * 0.55);
    if (alpha <= 0.02) return;
    const rad = (e.kind === 'building' ? Math.max(e.w, e.h) * 0.62 : e.r + 5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = PSI; ctx.lineWidth = a > 0 ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawShot(f) {
    // 스킬 이펙트 (범위 파동 / 치유 / 점멸)
    if (f.abil) {
      const life = f.abil === 'nova' ? 0.5 : (f.abil === 'heal' ? 0.5 : 0.35);
      const prog = 1 - Math.max(0, f.t) / life;
      ctx.save();
      if (f.abil === 'nova') {
        ctx.globalAlpha = (1 - prog) * 0.8;
        ctx.strokeStyle = '#c88bff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * prog, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = (1 - prog) * 0.25; ctx.fillStyle = '#8f5bff';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * prog, 0, Math.PI * 2); ctx.fill();
      } else if (f.abil === 'heal') {
        ctx.globalAlpha = (1 - prog) * 0.85;
        ctx.strokeStyle = C.heal; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, Math.max(10, f.radius) * (0.4 + prog), 0, Math.PI * 2); ctx.stroke();
        // 상승하는 십자
        ctx.fillStyle = C.heal;
        const yy = f.ay - prog * 22;
        ctx.fillRect(f.ax - 1.5, yy - 5, 3, 10); ctx.fillRect(f.ax - 5, yy - 1.5, 10, 3);
      } else if (f.abil === 'warp') {
        ctx.globalAlpha = (1 - prog) * 0.8;
        ctx.strokeStyle = '#8fe3ff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius + prog * 14, 0, Math.PI * 2); ctx.stroke();
      } else if (f.abil === 'salvo') {
        // 로켓 일제사 — 주황 폭발 링 + 불티
        ctx.globalAlpha = (1 - prog) * 0.85;
        ctx.strokeStyle = '#ff9b3d'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * (0.3 + prog), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = (1 - prog) * 0.3; ctx.fillStyle = '#ffcf5c';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * (0.3 + prog), 0, Math.PI * 2); ctx.fill();
      } else if (f.abil === 'acidburst') {
        // 산성 폭발 — 초록 폭발 링 + 튀는 방울
        ctx.globalAlpha = (1 - prog) * 0.85;
        ctx.strokeStyle = '#7dff9e'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * (0.3 + prog), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = (1 - prog) * 0.28; ctx.fillStyle = '#5ddc7a';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, f.radius * (0.3 + prog), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = (1 - prog) * 0.8; ctx.fillStyle = '#7dff9e';
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const rr = f.radius * (0.3 + prog);
          ctx.beginPath(); ctx.arc(f.ax + Math.cos(a) * rr, f.ay + Math.sin(a) * rr, 2.5 * (1 - prog), 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      return;
    }
    const col = f.crit ? C.crit : pal(f.owner).trim;
    ctx.save();
    ctx.globalAlpha = Math.min(1, f.t / 0.12);
    ctx.strokeStyle = col;
    ctx.lineWidth = f.crit ? 4 : (f.splash ? 3 : 2);
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
    // 공성 스플래시 폭발 링
    if (f.splash) {
      ctx.fillStyle = col;
      ctx.globalAlpha *= 0.4;
      ctx.beginPath(); ctx.arc(f.tx, f.ty, f.splash, 0, Math.PI * 2); ctx.fill();
    }
    // 치명타 — 노란 별 표시
    if (f.crit) {
      ctx.globalAlpha = Math.min(1, f.t / 0.14);
      ctx.fillStyle = C.crit;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const rr = i % 2 === 0 ? 9 : 4;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](f.tx + Math.cos(a) * rr, f.ty + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // 저해상도 안개 캔버스를 월드 전체에 늘려 덮는다 (부드러운 경계를 위해 스무딩 on)
  function drawFog(g, W, H) {
    if (!CFG.FOG_ENABLED || !g.fogCanvas) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(g.fogCanvas, 0, 0, g.visCols, g.visRows, 0, 0, CFG.WORLD_W, CFG.WORLD_H);
    ctx.restore();
  }

  // 명령 목적지 표식 + 떠오르는 데미지/치유 숫자 (클라이언트 전용 시각 피드백)
  function drawMarks(g) {
    if (!g.marks || !g.marks.length) return;
    for (const m of g.marks) {
      if (m.dmg != null) {
        const life = 0.8, k = Math.max(0, m.t / life);
        const y = m.y - (1 - k) * 26;
        ctx.globalAlpha = Math.min(1, k * 1.4);
        ctx.font = 'bold ' + (m.crit ? 16 : 13) + 'px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = m.heal ? C.heal : (m.crit ? C.crit : '#ffd9c0');
        ctx.fillText((m.heal ? '+' : '') + Math.round(m.dmg), m.x, y);
        ctx.globalAlpha = 1;
      } else {
        const life = 0.6, k = Math.max(0, m.t / life);
        const col = m.mark === 'attack' ? C.hpBad : (m.mark === 'amove' ? '#ffb24f' : C.select);
        const r = 6 + (1 - k) * 16;
        ctx.globalAlpha = k * 0.9;
        ctx.strokeStyle = col; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(m.x, m.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawSelection(g) {
    ctx.strokeStyle = C.select;
    ctx.lineWidth = 2;
    g.selection.forEach(e => {
      if (e.kind === 'unit') {
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + e.r * 0.5, e.r * 1.25, e.r * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(e.x - e.w / 2 - 4, e.y - e.h / 2 - 4, e.w + 8, e.h + 8);
        // 집결지
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rally.x, e.rally.y); ctx.stroke();
        ctx.restore();
      }
    });
  }

  function drawGhost(g, input) {
    const d = RC.BUILDINGS[g.placing];
    const x = input.world.x, y = input.world.y;
    const ok = g.canPlace(g.placing, x, y, 1) && g.canAfford(1, d.cost);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ok ? C.p1_body : C.hpBad;
    ctx.fillRect(x - d.w / 2, y - d.h / 2, d.w, d.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ok ? C.select : C.hpBad;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - d.w / 2, y - d.h / 2, d.w, d.h);
    ctx.restore();
  }

  function drawDragBox(input) {
    if (!input.dragging) return;
    const a = input.dragStart, b = input.screen;
    ctx.save();
    ctx.strokeStyle = C.select;
    ctx.fillStyle = 'rgba(142,242,176,0.12)';
    ctx.lineWidth = 1.5;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawMinimap(g, W, H) {
    const mw = mini.width, mh = mini.height;
    const sx = mw / CFG.WORLD_W, sy = mh / CFG.WORLD_H;
    mctx.fillStyle = '#0d131b';
    mctx.fillRect(0, 0, mw, mh);

    // 장애물
    mctx.fillStyle = C.obstacleDark;
    (g.obstacles || []).forEach(o => mctx.fillRect((o.x - o.w / 2) * sx, (o.y - o.h / 2) * sy, o.w * sx, o.h * sy));

    mctx.fillStyle = C.node;
    g.nodes.forEach(n => mctx.fillRect(n.x * sx - 1, n.y * sy - 1, 3, 3));

    g.buildings.forEach(b => {
      if (fogged(g, b)) return;
      mctx.fillStyle = pal(b.owner).body;
      mctx.fillRect(b.x * sx - 3, b.y * sy - 3, 6, 6);
    });
    g.units.forEach(u => {
      if (fogged(g, u)) return;
      mctx.fillStyle = pal(u.owner).body;
      mctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2.5, 2.5);
    });

    // 미니맵 안개 오버레이
    if (CFG.FOG_ENABLED && g.fogCanvas) {
      mctx.save();
      mctx.imageSmoothingEnabled = true;
      mctx.drawImage(g.fogCanvas, 0, 0, g.visCols, g.visRows, 0, 0, mw, mh);
      mctx.restore();
    }

    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 1;
    mctx.strokeRect(g.camera.x * sx, g.camera.y * sy, W * sx, H * sy);
  }

  // ── 종족 얼굴 (시작 화면 종족 선택용) ────────────────
  // Draws a faction's hero as a neutral "face" so players can see who they're
  // picking. Colours come from the RACE TINT rather than a player colour, so the
  // three factions read as visually distinct on the picker.
  function raceFaceColors(raceId) {
    const r = RC.RACES[raceId] || RC.RACES.forge;
    const base = r.tint;
    const c = {
      body:  base,
      light: shade(base, 0.32),
      dark:  shade(base, -0.46),
      trim:  shade(base, 0.55),
      steel: '#9fb1c6',
      eye:   C.node,
      psi:   PSI,
    };
    if (raceId === 'gloop')       { c.steel = mix(c.steel, GLOOP_TINT, 0.42);  c.eye = '#c9ff8f'; }
    else if (raceId === 'aether') { c.steel = mix(c.steel, AETHER_TINT, 0.46); c.eye = PSI_HOT; }
    else                          { c.steel = mix(c.steel, FORGE_TINT, 0.30); }
    return c;
  }

  function drawRaceFace(canvas, raceId) {
    const r = RC.RACES[raceId];
    if (!canvas || !r) return;
    const type = r.hero || r.worker;
    const def = RC.UNITS[type];
    if (!def) return;
    const pctx = canvas.getContext('2d');
    if (!pctx) return;
    const W = canvas.width, H = canvas.height;
    const saved = ctx;
    ctx = pctx;                          // 스프라이트 함수들이 쓰는 모듈 ctx를 잠시 교체
    try {
      ctx.clearRect(0, 0, W, H);
      // 종족색 방사 그라디언트 배경
      const bg = ctx.createRadialGradient(W / 2, H * 0.44, 2, W / 2, H * 0.5, H * 0.85);
      bg.addColorStop(0, mix(r.tint, '#05080e', 0.78));
      bg.addColorStop(1, '#05080e');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      const t = performance.now() / 1000;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      ctx.translate(W / 2, H * 0.58 + Math.sin(t * 1.9) * H * 0.022);   // 숨쉬는 듯한 흔들림
      const scale = (Math.min(W, H) * 0.33) / Math.max(7, def.r);
      ctx.scale(scale, scale);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';                                // 바닥 그림자
      ctx.beginPath(); ctx.ellipse(0, def.r * 1.2, def.r * 1.15, def.r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
      drawUnitSprite({ type: type, def: def, r: def.r }, raceFaceColors(raceId));
      ctx.restore();

      // 하단 비네트 — 이름표가 얹히는 자리
      const vg = ctx.createLinearGradient(0, H * 0.55, 0, H);
      vg.addColorStop(0, 'rgba(5,8,14,0)'); vg.addColorStop(1, 'rgba(5,8,14,0.85)');
      ctx.fillStyle = vg; ctx.fillRect(0, H * 0.55, W, H * 0.45);
    } finally {
      ctx = saved;
    }
  }

  return { init, draw, drawPortrait, drawRaceFace };
})();
