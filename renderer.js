// RIFT CLASH — 렌더러 / Renderer
window.RC = window.RC || {};

RC.Renderer = (function () {
  const C = RC.COLORS;
  const CFG = RC.CFG;

  let cv, ctx, mini, mctx;
  // Some players get motion sick from constant secondary movement, and some just want
  // it off. Everything decorative (walk bob, breathing, death pop) checks this; nothing
  // that carries information — health bars, hit flashes, selection rings — ever does.
  const REDUCED = (() => {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  })();

  function init(canvas, minimap) {
    cv = canvas; ctx = cv.getContext('2d');
    mini = minimap; mctx = mini.getContext('2d');
  }

  function pal(owner) {
    // Per-owner chosen colors (set by game.reset from the player's pick) take
    // precedence; otherwise fall back to the fixed p1..p4 defaults.
    const pc = RC.playerColors;
    if (pc && pc[owner]) return pc[owner];
    const o = (owner >= 1 && owner <= 4) ? owner : 1;
    return { body: C['p' + o + '_body'], trim: C['p' + o + '_trim'], dark: C['p' + o + '_dark'] };
  }

  // 플레이어 기준 팀 색 (아군/적군 구분용) — g 있으면 사용
  function teamColor(g, owner) {
    if (!g || owner === g.playerOwner) return null;        // 내 유닛은 링 없음
    return g.allied(owner, g.playerOwner) ? C.team1 : C.team2;
  }

  // 색상 밝기 조절 — pct 양수면 밝게, 음수면 어둡게
  // Takes '#rrggbb' OR 'rgb(r,g,b)'. It used to slice a leading '#' unconditionally, so
  // shade(shade(x)) — which several sprites do — parsed 'gb(12,20,30)' as hex, got NaN and
  // returned 'rgb(NaN,NaN,NaN)'. Canvas silently ignores an invalid fillStyle, so those
  // shapes were quietly inheriting whatever colour happened to be set last.
  function shade(col, pct) {
    const p = parseRGB(col);
    let r = p[0], gc = p[1], b = p[2];
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

  // ── 발광 스프라이트 캐시 ────────────────────────────
  // createRadialGradient를 매 프레임 만들면 소프트웨어 래스터에서 매우 비싸다 (특히
  // 모바일). 색별 소프트 글로우를 64px 캔버스에 한 번만 구워 drawImage로 찍는다.
  const _spr = {};
  function glowSprite(key, mk) {
    let s = _spr[key];
    if (!s) { s = document.createElement('canvas'); mk(s); _spr[key] = s; }
    return s;
  }
  // 'r,g,b' 문자열 → 중심 불투명, 가장자리 투명한 원형 글로우 스프라이트
  function softGlow(rgb, mid) {
    // rgb is pasted raw into an rgba() string, so a missing palette key would otherwise
    // reach addColorStop as 'rgba(undefined,1)' and throw. One unglowing sprite is a far
    // better failure than a dead canvas.
    if (!/^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/.test(String(rgb))) {
      console.warn('softGlow: bad rgb triplet', rgb);
      rgb = '255,255,255';
    }
    return glowSprite('g:' + rgb + (mid ? ':' + mid[0] + ',' + mid[1] : ''), (s) => {
      s.width = s.height = 64;
      const g2 = s.getContext('2d');
      const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)');
      if (mid) gr.addColorStop(mid[0], 'rgba(' + rgb + ',' + mid[1] + ')');
      gr.addColorStop(1, 'rgba(' + rgb + ',0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    });
  }
  // 스프라이트를 (x,y) 중심의 rx×ry 타원으로 찍는다
  function blitGlow(sprite, x, y, rx, ry, alpha) {
    if (ry == null) ry = rx;
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite, x - rx, y - ry, rx * 2, ry * 2);
  }

  // 둥근 사각형 경로
  // Corner radius is deliberately generous — softer corners are most of what separates
  // a cartoon shape from a technical one. The clamp keeps it safe: a radius larger than
  // half the box simply becomes a capsule rather than breaking the path.
  const RRECT_ROUND = 1.9;
  function rrect(x, y, w, h, r) {
    r = Math.min(r * RRECT_ROUND, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // 화면 흔들림 오프셋 — 궁극기가 터졌을 때만. 남은 시간에 비례해 감쇠한다.
  // Cosmetic only: it shifts the drawn frame, never g.camera, so orders and
  // hit-testing are unaffected and a shaking client stays in sync.
  function shakeOffset(g) {
    const t = g.shakeT || 0;
    if (t <= 0) return null;
    const amp = 16 * (t / (g.shakeMax || 1));
    const p = performance.now() / 1000;
    return { x: Math.sin(p * 61) * amp, y: Math.cos(p * 47) * amp * 0.8 };
  }

  // 카메라 배율. 클라이언트 전용 — 시뮬레이션에는 절대 영향을 주지 않는다.
  function camZoom(g) {
    const z = g && g.camera ? g.camera.z : 1;
    return (typeof z === 'number' && z > 0) ? z : 1;
  }

  function draw(g, input) {
    const W = cv.width, H = cv.height;
    const z = camZoom(g);
    // How much WORLD the canvas shows. At zoom 1 this is just the canvas size;
    // every world-space pass below culls and tiles against these, not W/H, or the
    // grid, clouds and fog stop short of the screen edge the moment you zoom out.
    const VW = W / z, VH = H / z;
    const shk = shakeOffset(g);
    if (shk) { ctx.save(); ctx.translate(shk.x, shk.y); }
    // 행성마다 하늘/땅 색이 다르다 (지구=초록, 작열=붉음, 얼음=검푸름)
    ctx.fillStyle = (g.mapDef && g.mapDef.ground) || C.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    // 표면 질감 (카메라를 따라 흘러가도록 패턴 원점을 이동)
    const tex = groundTexture(g);
    if (tex) {
      // 반점 + 대규모 명암이 한 타일에 구워져 있어 채우기 한 번이면 된다.
      // 오프셋은 화면 픽셀 기준 — 배율을 곱해야 지면과 같은 속도로 흐른다.
      ctx.save();
      ctx.translate(-Math.round(g.camera.x * z) % 512, -Math.round(g.camera.y * z) % 512);
      ctx.fillStyle = tex;
      ctx.fillRect(0, 0, W + 512, H + 512);
      ctx.restore();
    }

    ctx.save();
    // Snap the translation to whole SCREEN pixels (hence the *z ... /z) so the
    // world layer stays crisp instead of landing on a half pixel.
    ctx.scale(z, z);
    ctx.translate(-Math.round(g.camera.x * z) / z, -Math.round(g.camera.y * z) / z);

    drawTerrain(g, VW, VH);
    drawZones(g);                     // 전술 지형 (고지/숲/늪/분출구)
    drawClouds(g, VW, VH);            // 흘러가는 구름 그림자 (지면 위, 유닛 아래)
    drawKeepYard(g);                  // the ground inside a sealed wall
    (g.obstacles || []).forEach(o => drawObstacle(o));
    g.nodes.forEach(n => drawNode(n));
    g.buildings.forEach(b => drawBuilding(g, b));
    drawKeepTrim(g);                  // battlements, corner posts, open gates
    g.fx.forEach(f => drawShot(f));
    g.units.forEach(u => drawUnit(g, u));
    drawKeepNight(g, VW, VH);         // 밤 — Build Day is bright, the raid is not
    drawFog(g, VW, VH);               // 전장의 안개 — 적/지형을 덮는다
    drawSelection(g);
    drawMarks(g);                     // 명령 표식 + 데미지 숫자
    if (g.placing) { drawBuildRing(g); drawKeepGrid(g, input); drawGhost(g, input); }

    ctx.restore();

    drawAmbient(g, W, H);          // 대기 입자 (꽃가루 / 불티 / 눈발)
    drawIllusion(g, W, H);         // 행성 고유 착시 (토성 고리 / 목성 밴드 / 화성 아지랑이)
    drawGrade(g, W, H);            // 비네트 + 바이옴 색 보정 (영화적 톤)
    drawWeather(g, W, H);          // 날씨 — 비/눈/재/모래폭풍/번개 (HUD 아래, 월드 위)
    if (shk) ctx.restore();        // HUD 요소는 흔들리지 않는다
    drawDragBox(input);
    drawAlertArrows(g, W, H);
    drawMinimap(g, W, H);
  }

  // ── 전술 지형 ────────────────────────────────────────
  // 같은 규칙, 다른 행성. 색과 장식만 바이옴별로 갈린다.
  const BIOME = {
    earth: {
      high:   { fill: 'rgba(122,158,96,0.20)',  edge: '#8fbf6a', deco: 'peaks',  cap: '#dfe9d2' },
      low:    { fill: 'rgba(22,44,36,0.34)',    edge: '#3d6b52', deco: 'basin' },
      forest: { fill: 'rgba(46,120,68,0.24)',   edge: '#3f9b58', deco: 'trees' },
      mud:    { fill: 'rgba(58,132,180,0.30)',  edge: '#5aa9dd', deco: 'water' },
      vent:   { fill: 'rgba(120,220,200,0.18)', edge: '#7ce0c6', deco: 'spring' },
    },
    ember: {
      high:   { fill: 'rgba(214,142,74,0.24)',  edge: '#e8a760', deco: 'mesa',   cap: '#f2c48b' },
      low:    { fill: 'rgba(80,32,18,0.36)',    edge: '#8c4a2c', deco: 'basin' },
      forest: { fill: 'rgba(128,80,52,0.30)',   edge: '#a9704a', deco: 'rocks' },
      mud:    { fill: 'rgba(226,178,104,0.26)', edge: '#e8c67d', deco: 'dunes' },
      vent:   { fill: 'rgba(255,120,40,0.24)',  edge: '#ff8b3c', deco: 'lava' },
    },
    ice: {
      high:   { fill: 'rgba(150,205,238,0.20)', edge: '#9fd8f5', deco: 'ridge',  cap: '#e8f6ff' },
      low:    { fill: 'rgba(10,26,46,0.42)',    edge: '#2f5f86', deco: 'basin' },
      forest: { fill: 'rgba(120,180,220,0.18)', edge: '#8fc6e8', deco: 'spires' },
      mud:    { fill: 'rgba(214,232,248,0.22)', edge: '#cfe6f7', deco: 'snow' },
      vent:   { fill: 'rgba(120,230,220,0.20)', edge: '#79e6dc', deco: 'steam' },
    },
    // 화성 — 산화철 붉은 대지, 극관의 흰 서리, 협곡 바닥의 그늘
    rust: {
      high:   { fill: 'rgba(198,110,66,0.24)',  edge: '#e0854f', deco: 'mesa',   cap: '#f0b083' },
      low:    { fill: 'rgba(48,18,10,0.42)',    edge: '#7d3a22', deco: 'basin' },
      forest: { fill: 'rgba(120,66,44,0.30)',   edge: '#a3663f', deco: 'rocks' },
      mud:    { fill: 'rgba(226,214,206,0.22)', edge: '#e6dcd4', deco: 'snow' },
      vent:   { fill: 'rgba(255,150,70,0.22)',  edge: '#ffa14a', deco: 'lava' },
    },
    // 목성 — 보랏빛 구름 갑판, 흐르는 제트기류, 대적점의 붉은 눈
    storm: {
      high:   { fill: 'rgba(196,168,224,0.20)', edge: '#cbb0e8', deco: 'peaks',  cap: '#f2e8ff' },
      low:    { fill: 'rgba(20,10,30,0.44)',    edge: '#5a3f74', deco: 'basin' },
      forest: { fill: 'rgba(150,190,230,0.18)', edge: '#a8cbe8', deco: 'spires' },
      mud:    { fill: 'rgba(150,120,200,0.26)', edge: '#b79ae0', deco: 'water' },
      vent:   { fill: 'rgba(255,90,80,0.24)',   edge: '#ff6f5c', deco: 'lava' },
    },
    // 토성 — 얼음 고리 파편, 목자 위성의 흰 능선, 카시니 간극의 어둠
    ring: {
      high:   { fill: 'rgba(190,206,236,0.20)', edge: '#c3d4f0', deco: 'ridge',  cap: '#f0f6ff' },
      low:    { fill: 'rgba(4,8,20,0.48)',      edge: '#33456e', deco: 'basin' },
      forest: { fill: 'rgba(150,190,225,0.17)', edge: '#a6c9e6', deco: 'spires' },
      mud:    { fill: 'rgba(206,220,244,0.20)', edge: '#cddbf2', deco: 'debris' },
      vent:   { fill: 'rgba(140,235,235,0.20)', edge: '#8bebeb', deco: 'steam' },
    },
  };
  function styleOf(g, t) {
    const b = BIOME[(g.mapDef && g.mapDef.biome) || g.biome || 'earth'] || BIOME.earth;
    return b[t];
  }

  function zonePath(z) {
    ctx.beginPath();
    if (z.poly) {
      // smooth the polygon with midpoint curves so edges read as natural, not faceted
      const p = z.poly, n = p.length;
      let mx = (p[n - 1][0] + p[0][0]) / 2, my = (p[n - 1][1] + p[0][1]) / 2;
      ctx.moveTo(mx, my);
      for (let i = 0; i < n; i++) {
        const cur = p[i], nx = p[(i + 1) % n];
        ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + nx[0]) / 2, (cur[1] + nx[1]) / 2);
      }
      ctx.closePath();
    } else if (z.r) ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    else ctx.rect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
  }
  function zoneBB(z) {
    return z.bb || (z.r ? [z.x - z.r, z.y - z.r, z.x + z.r, z.y + z.r]
                        : [z.x - z.w / 2, z.y - z.h / 2, z.x + z.w / 2, z.y + z.h / 2]);
  }
  function inPoly(x, y, poly) {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }
  // 지형 넓이에 맞춰 장식 개수를 정한다 (넓은 지형일수록 더 촘촘하게)
  // one prop per `per` square pixels, clamped — so a 3500px river gets a river's worth of ripples
  function decoCount(z, per, min, max) {
    const bb = zoneBB(z);
    const area = Math.max(0, bb[2] - bb[0]) * Math.max(0, bb[3] - bb[1]) * 0.72;
    return Math.max(min, Math.min(max, Math.round(area / per)));
  }
  // deterministic scatter of points inside a zone, for placing trees/rocks/peaks
  function scatter(z, count, seed) {
    const bb = zoneBB(z);
    let s = seed >>> 0 || 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
    const rx = (bb[2] - bb[0]) / 2, ry = (bb[3] - bb[1]) / 2;
    const out = [];
    for (let i = 0; i < count * 8 && out.length < count; i++) {
      const x = bb[0] + rnd() * (bb[2] - bb[0]);
      const y = bb[1] + rnd() * (bb[3] - bb[1]);
      const r = rnd();
      // polygon zones get an exact containment test; circles/rects fall back to the inscribed ellipse
      if (z.poly ? inPoly(x, y, z.poly) : (((x - cx) / (rx || 1)) ** 2 + ((y - cy) / (ry || 1)) ** 2 <= 0.92)) {
        out.push([x, y, r]);
      }
    }
    return out;
  }

  function drawZones(g) {
    const zs = g.zones;
    if (!zs || !zs.length) return;
    const t = performance.now() / 1000;
    for (const z of zs) {
      const st = styleOf(g, z.t); if (!st) continue;
      const seed = ((z.bb ? z.bb[0] + z.bb[1] * 7 : z.x + z.y * 7) | 0) + 13;
      ctx.save();
      ctx.fillStyle = st.fill; zonePath(z); ctx.fill();

      // 고지/저지는 단차선을 그려 "오르막·내리막"이 보이게 한다
      if (z.t === 'high' || z.t === 'low') {
        ctx.save(); zonePath(z); ctx.clip();
        ctx.strokeStyle = st.edge; ctx.globalAlpha = 0.30; ctx.lineWidth = 2;
        const bb = z.bb || [z.x - 200, z.y - 200, z.x + 200, z.y + 200];
        for (let k = 1; k <= 3; k++) {          // 등고선
          ctx.save();
          ctx.translate((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2);
          ctx.scale(1 - k * 0.17, 1 - k * 0.17);
          ctx.translate(-(bb[0] + bb[2]) / 2, -(bb[1] + bb[3]) / 2);
          zonePath(z); ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      }

      ctx.strokeStyle = st.edge; ctx.lineWidth = z.t === 'high' ? 4 : 3;
      ctx.globalAlpha = 0.8; zonePath(z); ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.save(); zonePath(z); ctx.clip();      // 장식은 지형 안쪽에만
      const DENS = {
        peaks: [15000, 6, 26], ridge: [15000, 6, 26], mesa: [15000, 6, 26],
        trees: [7000, 10, 60], spires: [8000, 10, 52], rocks: [11000, 8, 40],
        water: [13000, 8, 110], dunes: [17000, 8, 80], snow: [14000, 8, 90],
        debris: [9000, 10, 70],
      };
      const dn = DENS[st.deco] || [18000, 6, 30];
      const pts = scatter(z, decoCount(z, dn[0], dn[1], dn[2]), seed);

      if (st.deco === 'peaks' || st.deco === 'ridge' || st.deco === 'mesa') {
        // 산봉우리 / 빙벽 / 메사 — 위로 솟은 실루엣 + 밝은 꼭대기
        // 뒤쪽(위)부터 그려야 앞의 봉우리가 겹쳐 보인다
        pts.sort((a, b) => a[1] - b[1]).forEach(([px, py, r], i) => {
          const h = 26 + r * 26, w = 20 + r * 20;
          ctx.fillStyle = 'rgba(0,0,0,0.28)';   // 바닥 그림자로 입체감
          ctx.beginPath(); ctx.ellipse(px + w * 0.22, py + h * 0.48, w * 0.95, w * 0.3, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = st.edge; ctx.globalAlpha = 0.72;
          ctx.beginPath();
          if (st.deco === 'mesa') {             // 평평한 꼭대기
            ctx.moveTo(px - w, py + h * 0.5); ctx.lineTo(px - w * 0.55, py - h * 0.5);
            ctx.lineTo(px + w * 0.55, py - h * 0.5); ctx.lineTo(px + w, py + h * 0.5);
          } else {                              // 뾰족한 봉우리
            ctx.moveTo(px - w, py + h * 0.5); ctx.lineTo(px, py - h * 0.6); ctx.lineTo(px + w, py + h * 0.5);
          }
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 0.85; ctx.fillStyle = st.cap || '#fff';
          ctx.beginPath();
          ctx.moveTo(px - w * 0.34, py - h * 0.16);
          ctx.lineTo(px, py - h * (st.deco === 'mesa' ? 0.5 : 0.6));
          ctx.lineTo(px + w * 0.34, py - h * 0.16);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        });
      } else if (st.deco === 'trees') {
        pts.sort((a, b) => a[1] - b[1]).forEach(([px, py, r]) => {
          const s2 = 0.8 + r * 0.5;               // 나무마다 크기를 달리해 숲처럼
          ctx.fillStyle = 'rgba(0,0,0,0.26)';
          ctx.beginPath(); ctx.ellipse(px + 5, py + 12, 13 * s2, 4.5 * s2, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2c5a38'; ctx.fillRect(px - 2.5 * s2, py + 3, 5 * s2, 12 * s2);
          ctx.fillStyle = r > 0.5 ? '#3f9b58' : '#4fb069';
          ctx.beginPath();
          ctx.moveTo(px, py - (20 + r * 6) * s2); ctx.lineTo(px + 14 * s2, py + 5); ctx.lineTo(px - 14 * s2, py + 5);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.16)';   // 햇빛 받는 쪽
          ctx.beginPath();
          ctx.moveTo(px, py - (20 + r * 6) * s2); ctx.lineTo(px + 14 * s2, py + 5); ctx.lineTo(px + 2 * s2, py + 5);
          ctx.closePath(); ctx.fill();
        });
      } else if (st.deco === 'spires') {
        pts.sort((a, b) => a[1] - b[1]).forEach(([px, py, r]) => {
          ctx.fillStyle = 'rgba(190,228,250,0.75)';
          ctx.beginPath();
          ctx.moveTo(px, py - 24 - r * 12); ctx.lineTo(px + 8, py + 8); ctx.lineTo(px - 8, py + 8);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.moveTo(px, py - 24 - r * 12); ctx.lineTo(px + 3, py + 8); ctx.lineTo(px - 1, py + 8);
          ctx.closePath(); ctx.fill();
        });
      } else if (st.deco === 'rocks') {
        pts.sort((a, b) => a[1] - b[1]).forEach(([px, py, r]) => {
          const w = 15 + r * 18;
          ctx.fillStyle = 'rgba(0,0,0,0.30)';    // 바위 그림자
          ctx.beginPath(); ctx.ellipse(px + w * 0.28, py + w * 0.42, w * 1.05, w * 0.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#6b3f28';
          ctx.beginPath(); ctx.ellipse(px, py + 3, w, w * 0.72, r * 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#95633f';
          ctx.beginPath(); ctx.ellipse(px - w * 0.16, py - w * 0.1, w * 0.74, w * 0.5, r * 2, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(226,176,124,0.75)';   // 위쪽 하이라이트
          ctx.beginPath(); ctx.ellipse(px - w * 0.28, py - w * 0.26, w * 0.36, w * 0.22, r * 2, 0, Math.PI * 2); ctx.fill();
        });
      } else if (st.deco === 'water') {
        // 강 — 흐르는 물결
        ctx.strokeStyle = 'rgba(190,230,255,0.55)'; ctx.lineWidth = 2.4;
        pts.forEach(([px, py, r], i) => {
          const off = ((t * 34 + i * 40) % 90) - 45;
          ctx.beginPath();
          ctx.moveTo(px - 26, py + off * 0.24);
          ctx.quadraticCurveTo(px, py + off * 0.24 - 9, px + 26, py + off * 0.24);
          ctx.stroke();
        });
      } else if (st.deco === 'dunes') {
        ctx.strokeStyle = 'rgba(255,226,170,0.5)'; ctx.lineWidth = 2.6;
        pts.forEach(([px, py, r]) => {
          ctx.beginPath();
          ctx.moveTo(px - 30, py + 8);
          ctx.quadraticCurveTo(px, py - 12 - r * 8, px + 30, py + 8);
          ctx.stroke();
        });
      } else if (st.deco === 'snow') {
        // 눈더미 — 가장자리가 흐릿해야 눈처럼 보인다 (딱딱한 타원은 얼룩처럼 보임)
        // 그라디언트는 스프라이트로 한 번만 굽는다 — 눈밭 하나에 수십 개씩 찍히기 때문
        const snowSpr = softGlow('247,251,255', [0.55, 0.5]);
        pts.forEach(([px, py, r]) => {
          const rw = 24 + r * 26;
          blitGlow(snowSpr, px, py, rw, rw * 0.42, 0.42);
        });
        ctx.globalAlpha = 1;
      } else if (st.deco === 'debris') {
        // 고리 파편 — 각진 얼음 조각. 자갈밭처럼 촘촘하되 하나하나는 날카롭다.
        pts.sort((a, b) => a[1] - b[1]).forEach(([px, py, r], i) => {
          const s2 = 5 + r * 11;
          const spin = r * 6.28 + i * 0.7;
          ctx.save();
          ctx.translate(px, py); ctx.rotate(spin);
          ctx.fillStyle = 'rgba(0,0,0,0.30)';
          ctx.beginPath(); ctx.ellipse(s2 * 0.3, s2 * 0.5, s2 * 1.05, s2 * 0.4, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = st.edge; ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(0, -s2); ctx.lineTo(s2 * 0.9, -s2 * 0.15);
          ctx.lineTo(s2 * 0.5, s2 * 0.8); ctx.lineTo(-s2 * 0.7, s2 * 0.5);
          ctx.lineTo(-s2 * 0.85, -s2 * 0.3);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.moveTo(0, -s2); ctx.lineTo(s2 * 0.9, -s2 * 0.15); ctx.lineTo(0, -s2 * 0.1);
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.restore();
        });
      } else if (st.deco === 'basin') {
        // 저지대 — 안쪽으로 파인 그림자
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        zonePath(z); ctx.fill();
      } else if (st.deco === 'lava' || st.deco === 'spring' || st.deco === 'steam') {
        const pulse = 0.45 + 0.35 * Math.abs(Math.sin(t * 1.5));
        const bb = z.bb || [z.x - 100, z.y - 100, z.x + 100, z.y + 100];
        const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
        const rr = Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2;
        ctx.globalAlpha = pulse; ctx.strokeStyle = st.edge; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, rr * (0.42 + 0.12 * Math.sin(t * 1.5)), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = st.edge;
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9 + t * 0.5;
          const rise = ((t * 46 + i * 29) % (rr * 0.95));
          ctx.globalAlpha = pulse * (1 - rise / (rr * 0.95)) * 0.9;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr * 0.34, cy + Math.sin(a) * rr * 0.3 - rise * 0.55, 3.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.restore();
    }
  }

  // 땅 표면 질감 — 바이옴 색에서 만든 반점 타일을 한 번만 굽고 패턴으로 재사용
  let _texKey = null, _texPat = null;
  function groundTexture(g) {
    const ground = (g.mapDef && g.mapDef.ground) || '#18232f';
    const biome = (g.mapDef && g.mapDef.biome) || 'earth';
    const key = ground + '|' + biome;
    if (key === _texKey && _texPat) return _texPat;
    const S = 128;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const t = c.getContext('2d');
    t.fillStyle = ground; t.fillRect(0, 0, S, S);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const light = shade(ground, biome === 'ice' ? 0.16 : 0.13);
    const dark = shade(ground, -0.17);
    for (let i = 0; i < 340; i++) {
      const x = rnd() * S, y = rnd() * S, r = 0.7 + rnd() * (biome === 'ember' ? 2.6 : 1.9);
      t.fillStyle = rnd() > 0.5 ? light : dark;
      t.globalAlpha = 0.2 + rnd() * 0.3;
      t.beginPath(); t.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2); t.fill();
    }
    t.globalAlpha = 1;

    // 대규모 명암 얼룩 — 512px 타일에 반점 텍스처를 깔고, 그 위에 넓고 부드러운
    // 밝음/그늘 패치를 한 번만 굽는다. 두 레이어를 한 타일로 합쳐 매 프레임
    // 패턴 채우기가 한 번으로 끝난다. 작은 반점 + 큰 명암이 겹치면 땅이
    // 균일한 타일이 아니라 실제 지표처럼 읽힌다.
    const M = 512;
    const mc = document.createElement('canvas'); mc.width = M; mc.height = M;
    const mt = mc.getContext('2d');
    mt.globalAlpha = 0.85;                       // 기존 반점 레이어의 알파를 그대로 승계
    mt.fillStyle = mt.createPattern(c, 'repeat');
    mt.fillRect(0, 0, M, M);
    mt.globalAlpha = 1;
    let ms = 98765;
    const mrnd = () => { ms = (ms * 1103515245 + 12345) & 0x7fffffff; return ms / 0x7fffffff; };
    for (let i = 0; i < 26; i++) {
      const px = mrnd() * M, py = mrnd() * M, pr = 60 + mrnd() * 120;
      const lightPatch = mrnd() > 0.5;
      const col = lightPatch ? '255,255,255' : '0,0,10';
      const a = (lightPatch ? 0.05 : 0.07) + mrnd() * 0.04;
      // 타일 이음새가 보이지 않도록 네 방향으로 감싸 그린다
      [[0, 0], [M, 0], [-M, 0], [0, M], [0, -M]].forEach(([wx, wy]) => {
        const gx = px + wx, gy = py + wy;
        if (gx + pr < 0 || gx - pr > M || gy + pr < 0 || gy - pr > M) return;
        const gr2 = mt.createRadialGradient(gx, gy, 0, gx, gy, pr);
        gr2.addColorStop(0, 'rgba(' + col + ',' + a.toFixed(3) + ')');
        gr2.addColorStop(1, 'rgba(' + col + ',0)');
        mt.fillStyle = gr2;
        mt.beginPath(); mt.arc(gx, gy, pr, 0, Math.PI * 2); mt.fill();
      });
    }
    _texKey = key; _texPat = ctx.createPattern(mc, 'repeat');
    return _texPat;
  }

  // 대기 입자 — 지구는 꽃가루, 금성은 불티와 먼지, 명왕성은 눈발
  const AMB = {
    earth: { n: 34, col: '#cde89a', size: 2.2, vx: 14, vy: -7, wob: 16, alpha: 0.5 },
    ember: { n: 40, col: '#ffb066', size: 2.4, vx: 26, vy: -20, wob: 14, alpha: 0.55 },
    ice:   { n: 52, col: '#eaf6ff', size: 2.6, vx: 16, vy: 26, wob: 22, alpha: 0.6 },
    rust:  { n: 44, col: '#e2a074', size: 2.3, vx: 34, vy: 5,  wob: 18, alpha: 0.45 },  // 붉은 먼지
    storm: { n: 38, col: '#d7c2f0', size: 2.8, vx: 46, vy: -4, wob: 12, alpha: 0.42 },  // 찢긴 구름 조각
    ring:  { n: 58, col: '#dbe7ff', size: 2.4, vx: 22, vy: 10, wob: 20, alpha: 0.5 },   // 떠다니는 얼음 알갱이
  };
  function drawAmbient(g, W, H) {
    const a = AMB[(g.mapDef && g.mapDef.biome) || 'earth'];
    if (!a) return;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.fillStyle = a.col;
    for (let i = 0; i < a.n; i++) {
      const seed = i * 97.13;
      const spanX = W + 200, spanY = H + 200;
      let x = ((seed * 37 + t * a.vx) % spanX + spanX) % spanX - 100;
      let y = ((seed * 61 + t * a.vy) % spanY + spanY) % spanY - 100;
      x += Math.sin(t * 0.8 + seed) * a.wob;
      y += Math.cos(t * 0.6 + seed * 1.3) * a.wob * 0.5;
      ctx.globalAlpha = a.alpha * (0.35 + 0.65 * Math.abs(Math.sin(t * 0.7 + seed)));
      const r = a.size * (0.5 + (i % 3) * 0.35);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 근경 레이어 — 더 크고 빠르고 흐린 입자가 카메라 가까이를 스쳐가 깊이감을 만든다
    for (let i = 0; i < (a.n >> 1); i++) {
      const seed = i * 151.7 + 40;
      const spanX = W + 300, spanY = H + 300;
      let x = ((seed * 43 + t * a.vx * 1.9) % spanX + spanX) % spanX - 150;
      let y = ((seed * 71 + t * a.vy * 1.9) % spanY + spanY) % spanY - 150;
      x += Math.sin(t * 0.7 + seed) * a.wob * 1.4;
      ctx.globalAlpha = a.alpha * 0.22 * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.5 + seed)));
      ctx.beginPath(); ctx.arc(x, y, a.size * 2.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 구름 그림자 — 거대한 부드러운 그늘이 맵 위를 천천히 흘러간다 (월드 좌표계)
  function drawClouds(g, W, H) {
    const t = performance.now() / 1000;
    const camX = g.camera.x, camY = g.camera.y;
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const rw = 380 + i * 150, rh = rw * 0.55;
      const span = CFG.WORLD_W + rw * 2;
      const cx = ((i * 1531 + t * (9 + i * 4)) % span + span) % span - rw;
      const cy = (i * 977) % CFG.WORLD_H;
      if (cx + rw < camX || cx - rw > camX + W || cy + rh < camY || cy - rh > camY + H) continue;
      blitGlow(softGlow('2,4,10', [0.65, 0.6]), cx, cy, rw, rh, 0.085);
    }
    ctx.restore();
  }

  // ── 행성 고유 연출 (illusions) ──────────────────────────
  // 날씨와 별개로 늘 깔려 있는 착시 레이어. 토성은 고리 안에 들어와 있다는 느낌,
  // 목성은 밴드가 옆으로 흐르는 시차, 화성은 지평선의 먼지 아지랑이.
  // 전부 화면 좌표계라 카메라를 따라오지 않는다 — 그게 "훨씬 먼 것"처럼 보이게 한다.
  function drawIllusion(g, W, H) {
    const biome = (g.mapDef && g.mapDef.biome) || 'earth';
    const t = performance.now() / 1000;
    const camX = g.camera.x || 0, camY = g.camera.y || 0;
    ctx.save();
    if (biome === 'ring') {
      // 하늘을 가로지르는 거대한 고리 — 카메라보다 훨씬 느리게 흐른다 (시차)
      for (let i = 0; i < 4; i++) {
        const base = H * (0.12 + i * 0.24) - camY * 0.06;
        const y = ((base % (H * 1.6)) + H * 1.6) % (H * 1.6) - H * 0.3;
        const th = 26 + i * 14;
        const gr = ctx.createLinearGradient(0, y - th, 0, y + th);
        gr.addColorStop(0, 'rgba(190,210,245,0)');
        gr.addColorStop(0.5, 'rgba(200,220,255,' + (0.055 + i * 0.012).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(190,210,245,0)');
        ctx.fillStyle = gr;
        ctx.save();
        ctx.translate(0, 0); ctx.transform(1, -0.05, 0, 1, -camX * 0.03, 0);
        ctx.fillRect(-100, y - th, W + 200, th * 2);
        ctx.restore();
      }
      // 카시니 간극처럼 고리에 뚫린 검은 틈
      const gapY = H * 0.55 - camY * 0.06;
      ctx.fillStyle = 'rgba(0,2,10,0.10)';
      ctx.fillRect(-100, gapY - 7, W + 200, 14);
    } else if (biome === 'storm') {
      // 목성의 밴드 — 화면 위를 옆으로 흐르는 넓고 흐릿한 띠
      for (let i = 0; i < 5; i++) {
        const y = (H / 5) * i + Math.sin(t * 0.13 + i) * 16 - camY * 0.05;
        const th = 40 + (i % 3) * 22;
        const warm = i % 2 === 0;
        const gr = ctx.createLinearGradient(0, y - th, 0, y + th);
        const c = warm ? '236,190,150' : '150,130,200';
        gr.addColorStop(0, 'rgba(' + c + ',0)');
        gr.addColorStop(0.5, 'rgba(' + c + ',0.045)');
        gr.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = gr;
        ctx.fillRect(-50, y - th, W + 100, th * 2);
      }
    } else if (biome === 'rust') {
      // 화성의 먼 먼지 아지랑이 — 화면 위쪽이 옅게 붉다
      const gr = ctx.createLinearGradient(0, 0, 0, H * 0.5);
      gr.addColorStop(0, 'rgba(224,150,96,0.10)');
      gr.addColorStop(1, 'rgba(224,150,96,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H * 0.5);
    }
    ctx.restore();
  }

  // 비네트 + 바이옴 색 보정 — 화면 가장자리를 살짝 눌러 시선을 중앙으로 모은다.
  // 두 그라디언트를 한 장의 오버레이 캔버스에 구워, 매 프레임 drawImage 한 번으로 끝낸다.
  let _gradeKey = null, _gradeCv = null;
  const GRADE_TINT = {
    earth: ['rgba(150,220,150,0.045)', 'rgba(10,20,40,0.10)'],
    ember: ['rgba(255,150,70,0.06)',   'rgba(60,10,5,0.12)'],
    ice:   ['rgba(150,205,255,0.055)', 'rgba(5,15,40,0.12)'],
    rust:  ['rgba(255,150,90,0.055)',  'rgba(40,10,4,0.13)'],
    storm: ['rgba(200,150,255,0.06)',  'rgba(16,6,28,0.15)'],
    ring:  ['rgba(180,205,255,0.05)',  'rgba(3,6,18,0.16)'],
  };
  function drawGrade(g, W, H) {
    const biome = (g.mapDef && g.mapDef.biome) || 'earth';
    const key = W + 'x' + H + '|' + biome;
    if (key !== _gradeKey) {
      _gradeCv = document.createElement('canvas');
      _gradeCv.width = W; _gradeCv.height = H;
      const gg = _gradeCv.getContext('2d');
      const tc = GRADE_TINT[biome] || GRADE_TINT.earth;
      const tint = gg.createLinearGradient(0, 0, 0, H);
      tint.addColorStop(0, tc[0]);           // 위쪽 — 대기광
      tint.addColorStop(0.55, 'rgba(0,0,0,0)');
      tint.addColorStop(1, tc[1]);           // 아래쪽 — 그늘
      gg.fillStyle = tint; gg.fillRect(0, 0, W, H);
      const vig = gg.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
      vig.addColorStop(0, 'rgba(0,0,8,0)');
      vig.addColorStop(1, 'rgba(0,0,8,0.30)');
      gg.fillStyle = vig; gg.fillRect(0, 0, W, H);
      _gradeKey = key;
    }
    ctx.drawImage(_gradeCv, 0, 0);
  }

  function drawTerrain(g, W, H) {
    // 맵 지형 패치 (원형 색 얼룩) — 그리드 아래
    (g.terrain || []).forEach(p => {
      ctx.fillStyle = p.color;
      if (p.poly) { zonePath(p); ctx.fill(); }
      else if (p.r) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      else if (p.w) { ctx.fillRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h); }
    });

    // The tile grid used to be drawn here. It read as a spreadsheet under the art and
    // fought the cartoon look — terrain zones, the rift and the map border already
    // give the ground all the structure it needs, and building placement snaps on its
    // own without a visible lattice to line up against.

    // 맵 경계
    ctx.strokeStyle = '#2b3a4d';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CFG.WORLD_W - 4, CFG.WORLD_H - 4);

    // 중앙 리프트 — 소용돌이치는 차원 균열 (맵의 중심을 잡아주는 볼거리)
    const cx = CFG.WORLD_W / 2, cy = CFG.WORLD_H / 2;
    const rt = performance.now() / 1000;
    ctx.save();
    // 바닥 광휘
    const rp = 0.5 + 0.5 * Math.sin(rt * 1.1);
    blitGlow(softGlow('166,104,255', [0.6, 0.45]), cx, cy, 185, 185, 0.10 + 0.05 * rp);
    ctx.globalAlpha = 1;
    // 서로 반대로 도는 이중 호 — 회전문 같은 차원 고리
    ctx.lineCap = 'round';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rt * 0.45);
    ctx.strokeStyle = C.rift; ctx.lineWidth = 3; ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath(); ctx.arc(0, 0, 150, 0, 1.45); ctx.stroke();
    }
    ctx.rotate(-rt * 0.45 * 2.6);
    ctx.strokeStyle = '#cfa9ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.4;
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath(); ctx.arc(0, 0, 118, 0, 1.1); ctx.stroke();
    }
    ctx.restore();
    // 안으로 빨려드는 입자들
    ctx.fillStyle = '#cfa9ff';
    for (let i = 0; i < 9; i++) {
      const ph = (rt * 0.14 + i * 0.117) % 1;
      const rr = 165 * (1 - ph);
      const a = i * 0.7 - rt * 1.1 - ph * 2.2;      // 나선을 그리며 수렴
      ctx.globalAlpha = ph * 0.65;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.4 * (0.5 + ph), 0, Math.PI * 2);
      ctx.fill();
    }
    // 중심핵
    fireball(cx, cy, 26, 'rgba(240,225,255,0.95)', 'rgba(166,104,255,0.45)', 0.55 + 0.3 * rp);
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
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    rrect(o.x - o.w / 2 + 5, o.y - o.h / 2 + 7, o.w, o.h, 7); ctx.fill();
    ctx.restore();
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

  // ── A block of the keep ────────────────────────────────────────────────────
  //
  // The generic building body is a rounded box with a four-pixel ink outline and a
  // trim rectangle inside it. That is right for a factory, which is one object a
  // player looks at; it is badly wrong for a wall, which is twenty objects a player
  // is supposed to see as ONE. Rounded corners plus an outline per block is the
  // exact recipe for "a row of bubbles", and that is what it looked like.
  //
  // So a keep piece draws square, extends itself half a cell into every occupied
  // neighbour, and — the part that actually does the work — outlines only the edges
  // with nothing beyond them. No inner edges are ever stroked, so a run of twelve
  // reads as one continuous stretch of wall with a single line around the outside,
  // which is what a castle wall is.
  function keepBody(g, b, p, x, y) {
    const m = RC.Keep.joinMask(g, b);
    const G = RC.Keep.GRID, half = G / 2;
    const ink = shade(p.body, -0.72), light = shade(p.body, 0.30), dk = shade(p.body, -0.4);
    // The footprint, grown into each neighbour so the two halves meet in the middle
    // of the cell boundary and the seam disappears.
    const L = (m & 8) ? b.x - half : x, R = (m & 2) ? b.x + half : x + b.w;
    const T = (m & 1) ? b.y - half : y, B = (m & 4) ? b.y + half : y + b.h;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(L + 3, T + 6, R - L, B - T);
    ctx.fillStyle = dk;
    ctx.fillRect(L, T, R - L, B - T);
    ctx.fillStyle = p.body;
    ctx.fillRect(L, T, R - L, (B - T) * 0.78);
    ctx.fillStyle = light; ctx.globalAlpha = 0.5;
    ctx.fillRect(L + 2, T + 2, R - L - 4, (B - T) * 0.22);
    ctx.globalAlpha = 1;
    // Courses of stone. Two lines per block, offset by the cell so the joints stagger
    // along a run the way brickwork does instead of lining up into one long seam.
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(L, b.y - b.h * 0.16); ctx.lineTo(R, b.y - b.h * 0.16);
    ctx.moveTo(L, b.y + b.h * 0.2); ctx.lineTo(R, b.y + b.h * 0.2);
    const odd = (RC.Keep.cellX(b.x) + RC.Keep.cellY(b.y)) % 2 ? 0.3 : -0.3;
    ctx.moveTo(b.x + b.w * odd, b.y - b.h * 0.16); ctx.lineTo(b.x + b.w * odd, b.y + b.h * 0.2);
    ctx.stroke();
    // Outer edges only. This is the whole trick.
    ctx.strokeStyle = ink; ctx.lineWidth = 3; ctx.lineCap = 'square';
    ctx.beginPath();
    if (!(m & 1)) { ctx.moveTo(L, T); ctx.lineTo(R, T); }
    if (!(m & 4)) { ctx.moveTo(L, B); ctx.lineTo(R, B); }
    if (!(m & 8)) { ctx.moveTo(L, T); ctx.lineTo(L, B); }
    if (!(m & 2)) { ctx.moveTo(R, T); ctx.lineTo(R, B); }
    ctx.stroke();
    ctx.restore();
  }

  function drawBuilding(g, b) {
    if (fogged(g, b)) return;
    const p = pal(b.owner);
    const x = b.x - b.w / 2, y = b.y - b.h / 2;

    if (!b.done) {
      // 홀로그램 건설 — 청사진 위로 스캔선이 지나가고, 완성된 만큼 아래에서부터 실체화된다
      const t = performance.now() / 1000;
      const holo = b.def.race === 'gloop' ? '#7dff9e' : b.def.race === 'aether' ? '#c9a6ff' : '#8fe3ff';
      const fh = b.h * b.buildProgress;
      const ey = y + b.h - fh;                     // 실체화 경계선
      ctx.save();
      // 청사진 바탕
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = holo; ctx.fillRect(x, y, b.w, b.h);
      // 실체화된 부분 (아래에서 위로 차오른다)
      ctx.globalAlpha = 0.24;
      ctx.fillRect(x, ey, b.w, fh);
      // 홀로그램 주사선
      ctx.globalAlpha = 0.15;
      for (let yy = y + ((t * 24) % 6); yy < y + b.h; yy += 6) ctx.fillRect(x, yy, b.w, 1);
      // 실체화 경계 — 밝은 조립선 + 흐르는 스파크
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = mix(holo, '#ffffff', 0.55);
      ctx.fillRect(x, ey - 1, b.w, 2);
      for (let i = 0; i < 3; i++) {
        const sx = x + ((t * (46 + i * 21) + i * 57 + (b.id || 0) * 13) % b.w);
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 21 + i * 2.4);
        ctx.beginPath(); ctx.arc(sx, ey, 2.1, 0, Math.PI * 2); ctx.fill();
      }
      // 행진하는 점선 외곽 + 모서리 브래킷 (타깃팅 UI 느낌)
      ctx.globalAlpha = 0.85;
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -t * 26;
      ctx.strokeStyle = holo; ctx.lineWidth = 1.6;
      ctx.strokeRect(x, y, b.w, b.h);
      ctx.setLineDash([]);
      ctx.strokeStyle = p.trim; ctx.lineWidth = 2.2;
      const L = Math.min(12, b.w * 0.2);
      [[x, y, 1, 1], [x + b.w, y, -1, 1], [x, y + b.h, 1, -1], [x + b.w, y + b.h, -1, -1]].forEach(([cx2, cy2, dx, dy]) => {
        ctx.beginPath();
        ctx.moveTo(cx2 + dx * L, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 + dy * L);
        ctx.stroke();
      });
      ctx.restore();
    } else {
      // 완공 건물 — 발밑의 은은한 동력광 (몸체보다 먼저 깔린다)
      {
        const t = performance.now() / 1000;
        const glowCol = b.def.race === 'gloop' ? '125,255,158' : b.def.race === 'aether' ? '201,166,255' : '143,227,255';
        const pp = 0.5 + 0.5 * Math.sin(t * 1.3 + (b.id || 0) * 0.9);
        const gy = y + b.h * 0.9;
        ctx.save();
        blitGlow(softGlow(glowCol), b.x, gy, b.w * 0.85, b.h * 0.42, 0.10 + 0.06 * pp);
        ctx.restore();
      }
      if (g.kids && b.def.decor) {
        // A decoration is a prop, not a structure. Wrapping a flowerbox in the full
        // building body — rounded shell, ink outline, rivets, power glow — made a
        // planter look like a bunker with a plant painted on it, which is the
        // opposite of the point. It gets a flagstone to stand on and nothing else.
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,.26)';
        ctx.beginPath(); ctx.ellipse(b.x, b.y + b.h * 0.28, b.w * 0.34, b.h * 0.16, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(p.dark, -0.15);
        rrect(b.x - b.w * 0.32, b.y + b.h * 0.06, b.w * 0.64, b.h * 0.26, 4); ctx.fill();
        ctx.restore();
      } else if (g.kids && RC.Keep && RC.Keep.joins(b)) {
        // A keep piece is masonry, not a machine — see keepBody.
        keepBody(g, b, p, x, y);
      } else if (b.def.race === 'gloop') {
        // 글룹 — 유기적 점액 덩어리 본체 (둥글둥글, 초록빛)
        gloopBody(b, p, x, y);
      } else if (b.def.race === 'aether') {
        // Aether — 각진 결정 구조 + 부유 파편 (보랏빛)
        aetherBody(b, p, x, y);
      } else {
        // 포지 — 각진 금속 본체 + 굵은 잉크 외곽선 + 셀 하이라이트 (메나싱 카툰)
        // Cartoon pass: softer corners, a heavier outline, a wider flat top-light and
        // chunkier rivets, so buildings sit in the same drawn world as the units rather
        // than looking like technical boxes the units happen to stand next to.
        const inkc = shade(p.body, -0.72), light = shade(p.body, 0.32), dk = shade(p.body, -0.4);
        const rad = Math.max(9, Math.min(b.w, b.h) * 0.22);
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        rrect(x + 4, y + 7, b.w, b.h, rad); ctx.fill();
        ctx.fillStyle = dk;
        rrect(x, y, b.w, b.h, rad); ctx.fill();
        ctx.fillStyle = p.body;
        rrect(x, y, b.w, b.h * 0.8, rad); ctx.fill();
        // flat top-light — one broad band, not a gradient. Cel shading, not realism.
        ctx.fillStyle = light; ctx.globalAlpha = 0.66;
        rrect(x + 5, y + 5, b.w - 10, b.h * 0.3, rad * 0.7); ctx.fill(); ctx.globalAlpha = 1;
        // fat rivets with a tiny highlight each
        const rv = Math.max(3.2, b.w * 0.045);
        [[x + 10, y + 10], [x + b.w - 10, y + 10], [x + 10, y + b.h - 10], [x + b.w - 10, y + b.h - 10]].forEach(([rx, ry]) => {
          ctx.fillStyle = inkc; ctx.beginPath(); ctx.arc(rx, ry, rv, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = light; ctx.globalAlpha = 0.6;
          ctx.beginPath(); ctx.arc(rx - rv * 0.3, ry - rv * 0.3, rv * 0.38, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
        });
        // bold cartoon ink outline
        ctx.lineJoin = 'round'; ctx.strokeStyle = inkc; ctx.lineWidth = Math.max(4, b.w * 0.07);
        rrect(x, y, b.w, b.h, rad); ctx.stroke();
        // trim accent
        ctx.strokeStyle = p.trim; ctx.lineWidth = 2.4;
        rrect(x + 6, y + 6, b.w - 12, b.h - 12, rad * 0.6); ctx.stroke();
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
        // 굴뚝 연기 — 가동 중이라는 생활감 (상태 없는 시간 함수)
        {
          const t = performance.now() / 1000;
          ctx.save();
          [b.x - 11.5, b.x + 11.5].forEach((chX, ci) => {
            for (let k2 = 0; k2 < 3; k2++) {
              const rise = (t * 17 + k2 * 21 + ci * 9 + (b.id || 0) * 7) % 58;
              const fade = 1 - rise / 58;
              ctx.globalAlpha = fade * 0.24;
              ctx.fillStyle = 'rgba(150,155,165,1)';
              ctx.beginPath();
              ctx.arc(chX + Math.sin(rise * 0.14 + k2 * 2) * 3.2, b.y - 22 - rise, 2.6 + rise * 0.12, 0, Math.PI * 2);
              ctx.fill();
            }
          });
          ctx.restore();
        }
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
      } else if (b.type === 'nexus') {
        // Aether 넥서스 — 공중에 뜬 회전 사이오닉 프리즘 + 궤도 파편 (본진)
        const t = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        blitGlow(softGlow('201,166,255'), 0, 0, 32, 32, 0.24 + 0.1 * Math.sin(t * 1.6));
        ctx.save(); ctx.rotate(t * 0.6);
        const prism = (rot, R2, col) => {
          ctx.save(); ctx.rotate(rot); ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(0, -R2); ctx.lineTo(R2 * 0.7, 0); ctx.lineTo(0, R2); ctx.lineTo(-R2 * 0.7, 0); ctx.closePath(); ctx.fill();
          ctx.restore();
        };
        prism(0, 21, mix(AETHER_TINT, '#160a24', 0.15));
        prism(Math.PI / 4, 14, PSI);
        ctx.restore();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 2.2));
        ctx.globalAlpha = pulse; ctx.fillStyle = PSI_HOT;
        ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.fillStyle = PSI;
        for (let i = 0; i < 3; i++) {
          const a = -t * 1.4 + i * (Math.PI * 2 / 3);
          const px = Math.cos(a) * 27, py = Math.sin(a) * 18;
          ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px + 3, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 3, py); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      } else if (b.type === 'conduit') {
        // 워프 도관 — 짧은 결정 기둥 + 발밑을 도는 워프 소용돌이 (인구 + 워프 비콘)
        const t = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.fillStyle = mix(AETHER_TINT, '#160a24', 0.2);
        ctx.beginPath(); ctx.moveTo(-7, 12); ctx.lineTo(-4, -15); ctx.lineTo(4, -15); ctx.lineTo(7, 12); ctx.closePath(); ctx.fill();
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.4));
        ctx.globalAlpha = pulse; ctx.fillStyle = PSI;
        ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(-1.5, -13); ctx.lineTo(1.5, -13); ctx.lineTo(3, 10); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.75; ctx.strokeStyle = PSI; ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 20;
        ctx.beginPath(); ctx.ellipse(0, 13, 15, 5, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else if (b.type === 'warpgate') {
        // 워프 게이트 — 회전하는 사이오닉 포털 링 (지상 유닛이 여기로 워프인)
        const t = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        blitGlow(softGlow('201,166,255'), 0, 0, 24, 16, 0.3);
        ctx.strokeStyle = PSI; ctx.lineWidth = 3; ctx.globalAlpha = 0.9;
        ctx.setLineDash([9, 6]); ctx.lineDashOffset = -t * 34;
        ctx.beginPath(); ctx.ellipse(0, 0, 20, 13, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3);
        ctx.fillStyle = mix(AETHER_TINT, PSI, 0.5);
        ctx.beginPath(); ctx.ellipse(0, 0, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
      } else if (b.type === 'astralgate') {
        // 아스트랄 게이트 — 위로 솟은 결정 첨탑 + 떠 있는 후광 링 (공중 유닛)
        const t = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.fillStyle = mix(AETHER_TINT, '#160a24', 0.15);
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PSI; ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(t * 2));
        ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.8; ctx.strokeStyle = PSI; ctx.lineWidth = 2;
        const ry = 6 + Math.sin(t * 1.8) * 1.5;
        ctx.beginPath(); ctx.ellipse(0, -20, 11, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      } else if (b.type === 'conclave') {
        // 아이테르 콘클라베 — 회전하는 삼중 결정 호 + 발광 핵 (연구)
        const tt = performance.now() / 1000;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.strokeStyle = PSI; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.stroke();
        ctx.rotate(tt * 1.15);
        ctx.strokeStyle = AETHER_TINT; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.arc(0, 0, 22, -0.5, 0.5); ctx.stroke(); }
        ctx.restore();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 420));
        ctx.globalAlpha = pulse; ctx.fillStyle = PSI;
        ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(b.x - 2, b.y - 2, 3, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'prismlaser') {
        // 포톤 프리즘 — 표적을 향해 도는 결정 렌즈 포탑 (지상·공중)
        const ang = b.foe ? Math.atan2(b.foe.y - b.y, b.foe.x - b.x) : -Math.PI / 2;
        ctx.save(); ctx.translate(b.x, b.y);
        ctx.fillStyle = mix(AETHER_TINT, '#160a24', 0.18);
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(ang);
        // 각진 결정 렌즈 (앞으로 뻗은 마름모)
        ctx.fillStyle = mix(AETHER_TINT, PSI, 0.35);
        ctx.beginPath(); ctx.moveTo(4, -7); ctx.lineTo(22, 0); ctx.lineTo(4, 7); ctx.lineTo(-2, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PSI_HOT;
        ctx.beginPath(); ctx.arc(19, 0, 2.6, 0, Math.PI * 2); ctx.fill();
        // 방금 쏜 빔의 잔상 — 이것 하나로 "레이저"가 읽힌다. 쿨다운 직후에만 짙다.
        const hot = Math.max(0, 1 - (b.cd || 0) / Math.max(0.001, (b.def.cd || 1) * 0.35));
        if (hot > 0 && b.foe) {
          ctx.globalAlpha = hot * 0.75;
          ctx.strokeStyle = PSI_HOT; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
          const reach = RC.dist(b.x, b.y, b.foe.x, b.foe.y);
          ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(reach, 0); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        const pulse = 0.6 + 0.4 * Math.abs(Math.sin(performance.now() / 400));
        ctx.globalAlpha = pulse; ctx.fillStyle = PSI;
        ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.type === 'stonethrower') {
        // 투석기 — 표적을 향해 도는 팔에 바위를 얹고 있다. 총신이 아니라 팔이라는 것이
        // 요점: 화약 냄새가 나는 포탑과 한눈에 구분되어야 한다.
        const ang = b.foe ? Math.atan2(b.foe.y - b.y, b.foe.x - b.x) : -Math.PI / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.fillStyle = p.dark;                                  // 받침대
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(ang);
        // 던지는 팔 — 발사 직후에는 뒤로 젖혀져 있다가 서서히 되감긴다
        const wind = Math.max(0, Math.min(1, (b.cd || 0) / (b.def.cd || 1)));
        ctx.rotate(-0.5 * wind);
        ctx.strokeStyle = shade(p.body, -0.2); ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(17, -7); ctx.stroke();
        // 얹혀 있는 바위 — 되감기는 동안에만 보인다
        ctx.globalAlpha = 1 - wind * 0.85;
        ctx.fillStyle = '#8d8577';
        ctx.beginPath(); ctx.arc(19, -8, 5.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a9a294';
        ctx.beginPath(); ctx.arc(17.5, -9.5, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();
        // 돌더미 — 다음에 던질 것들
        ctx.fillStyle = '#6f675c';
        ctx.beginPath(); ctx.arc(b.x - 9, b.y + 8, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x - 2, b.y + 10, 3.2, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'venomspire') {
        // 맹독 첨탑 — 자라난 것. 맥동하는 독주머니 위에 표적을 향해 굽는 목이 달려 있다.
        const tt = performance.now() / 1000;
        const ang = b.foe ? Math.atan2(b.foe.y - b.y, b.foe.x - b.x) : -Math.PI / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        const breathe = 1 + 0.06 * Math.sin(tt * 2.1);
        ctx.fillStyle = shade(GLOOP_TINT, -0.42);                // 뿌리
        ctx.beginPath(); ctx.ellipse(0, 4, 15, 11, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = shade(GLOOP_TINT, -0.18);                // 독주머니
        ctx.beginPath(); ctx.ellipse(0, 0, 11 * breathe, 12 * breathe, 0, 0, Math.PI * 2); ctx.fill();
        ctx.rotate(ang);
        ctx.fillStyle = shade(GLOOP_TINT, -0.05);                // 굽은 목
        ctx.beginPath();
        ctx.moveTo(-2, -5); ctx.quadraticCurveTo(14, -9, 20, -2);
        ctx.quadraticCurveTo(14, 2, -2, 5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c07dff';                                // 독니 끝
        ctx.beginPath(); ctx.arc(19, -2, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // 방울져 떨어지는 독
        ctx.globalAlpha = 0.5 + 0.4 * Math.abs(Math.sin(tt * 1.7));
        ctx.fillStyle = '#a25cff';
        ctx.beginPath(); ctx.arc(b.x, b.y - 1, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (b.def.decor) {
        // ── Decorations ──
        // None of these fight, and that is exactly why they are here. A keep a
        // child wants to come back to is one that looks like theirs, and the
        // cheapest way to buy that is four things that cost almost nothing, do
        // nothing, and are unmistakably a choice somebody made.
        const tt = performance.now() / 1000;
        const col = pal(b.owner);
        ctx.save();
        ctx.translate(b.x, b.y);
        if (b.type === 'banner') {
          ctx.strokeStyle = '#8a7f70'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(-4, -16); ctx.stroke();
          const wv = Math.sin(tt * 2.4) * 3;
          ctx.fillStyle = col.body;
          ctx.beginPath();
          ctx.moveTo(-3, -15);
          ctx.quadraticCurveTo(7 + wv, -11, 15, -14 + wv);
          ctx.lineTo(15, -2 + wv);
          ctx.quadraticCurveTo(7 - wv, -5, -3, -1);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = col.trim;
          ctx.fillRect(-3, -10, 12, 2.4);
        } else if (b.type === 'torch') {
          ctx.fillStyle = '#6b5442'; ctx.fillRect(-3, -2, 6, 16);
          const f = 0.75 + 0.25 * Math.sin(tt * 9 + b.id);
          ctx.fillStyle = '#ff9a3a';
          ctx.beginPath(); ctx.ellipse(0, -9, 6 * f, 10 * f, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffe9a0';
          ctx.beginPath(); ctx.ellipse(0, -10, 2.8 * f, 5.4 * f, 0, 0, Math.PI * 2); ctx.fill();
        } else if (b.type === 'planter') {
          ctx.fillStyle = '#7a5a3c'; ctx.fillRect(-13, 2, 26, 11);
          ctx.fillStyle = '#5c4229'; ctx.fillRect(-13, 2, 26, 3);
          const petals = ['#ff8ab0', '#ffd45e', '#9ae86a', '#8fc6ff'];
          for (let i = 0; i < 4; i++) {
            const px = -9 + i * 6, sway = Math.sin(tt * 1.6 + i) * 1.4;
            ctx.strokeStyle = '#3f8a46'; ctx.lineWidth = 1.6;
            ctx.beginPath(); ctx.moveTo(px, 2); ctx.lineTo(px + sway, -7); ctx.stroke();
            ctx.fillStyle = petals[(i + b.id) % 4];
            ctx.beginPath(); ctx.arc(px + sway, -9, 3.2, 0, Math.PI * 2); ctx.fill();
          }
        } else if (b.type === 'signpost') {
          ctx.fillStyle = '#6b5442'; ctx.fillRect(-2.5, -4, 5, 18);
          ctx.fillStyle = '#c8a97a'; rrect(-17, -16, 34, 14, 3); ctx.fill();
          ctx.strokeStyle = '#8a6c47'; ctx.lineWidth = 1.6; ctx.stroke();
          // The keep's name, on the sign, in the world. A name in a menu is a
          // setting; a name on a post in the middle of your castle is a place.
          const nm = (g._keepSave && g._keepSave.name) || 'My Keep';
          ctx.fillStyle = '#4a3521';
          ctx.font = 'bold 8px system-ui, sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(nm.length > 13 ? nm.slice(0, 12) + '…' : nm, 0, -9);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
        ctx.restore();
      } else if (b.def.gate) {
        // ── Gate ──
        // Two leaves that actually swing. A gate that changed colour to say it was
        // open would be a status light; a gate that opens is a thing a child can
        // point at and understand from the far side of the map.
        const open = RC.Keep && RC.Keep.gateOpen(g, b);
        const col = pal(b.owner);
        const hw = b.w / 2, hh = b.h / 2;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.fillStyle = col.dark;
        ctx.fillRect(-hw, -hh, 5, b.h);
        ctx.fillRect(hw - 5, -hh, 5, b.h);
        const swing = open ? 0.95 : 0;
        [-1, 1].forEach(s => {
          ctx.save();
          ctx.translate(s * (hw - 3), 0);
          ctx.rotate(s * swing);
          ctx.fillStyle = '#7a5a3c';
          ctx.fillRect(s > 0 ? -hw + 3 : -3, -hh + 3, hw - 4, b.h - 6);
          ctx.fillStyle = 'rgba(0,0,0,.22)';
          for (let i = 0; i < 3; i++) ctx.fillRect(s > 0 ? -hw + 3 : -3, -hh + 6 + i * 10, hw - 4, 1.8);
          ctx.restore();
        });
        ctx.fillStyle = col.trim;
        ctx.beginPath(); ctx.arc(0, -hh + 3, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (b.def.wall) {
        // ── 벽 ──
        // The body underneath is already drawn and already race-tinted, so each wall only
        // needs the few marks that say what it is MADE of. That is the whole job: a kid
        // laying a fort has to tell the cheap wall from the expensive one at a glance,
        // from across the map, without reading anything.
        const tt = performance.now() / 1000;
        ctx.save();
        ctx.translate(b.x, b.y);
        const hw = b.w / 2, hh = b.h / 2;
        if (b.type === 'logwall') {
          // 통나무 — 끝면의 나이테. 가장 싸고 가장 약하다.
          ctx.fillStyle = '#6b4a2c';
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath(); ctx.arc(i * hw * 0.58, 0, hw * 0.28, 0, Math.PI * 2); ctx.fill();
          }
          ctx.strokeStyle = '#8a6238'; ctx.lineWidth = 1.6;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath(); ctx.arc(i * hw * 0.58, 0, hw * 0.14, 0, Math.PI * 2); ctx.stroke();
          }
        } else if (b.type === 'steelwall') {
          // 강철 — 두꺼운 테두리와 큼직한 리벳. 비싸 보여야 한다.
          ctx.strokeStyle = '#cfd8e4'; ctx.lineWidth = 3.5;
          ctx.strokeRect(-hw + 4, -hh + 4, b.w - 8, b.h - 8);
          ctx.fillStyle = '#e6edf6';
          for (const [rx, ry] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            ctx.beginPath(); ctx.arc(rx * (hw - 8), ry * (hh - 8), 2.6, 0, Math.PI * 2); ctx.fill();
          }
          ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-hw + 7, -hh + 9); ctx.lineTo(hw - 7, -hh + 9); ctx.stroke();
        } else if (b.type === 'treadwall') {
          // 진창 — 느리게 도는 벨트와 바깥으로 번지는 진흙. 반경이 눈에 보여야
          // 아이가 "여기 밟으면 느려진다"를 배운다.
          const R = (b.def.passive && b.def.passive.radius) || 96;
          ctx.globalAlpha = 0.13 + 0.05 * Math.sin(tt * 1.6);
          ctx.fillStyle = '#7a6a3f';
          ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.5; ctx.strokeStyle = '#b6a05c'; ctx.lineWidth = 2;
          ctx.setLineDash([6, 7]); ctx.lineDashOffset = -tt * 14;
          ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]); ctx.globalAlpha = 1;
          ctx.fillStyle = '#4a4128';
          ctx.fillRect(-hw + 3, -hh + 5, b.w - 6, b.h - 10);
          ctx.strokeStyle = '#9c8a4e'; ctx.lineWidth = 2.4;
          for (let i = 0; i < 4; i++) {
            const off = ((tt * 12 + i * 9) % (b.w - 8)) - (hw - 4);
            ctx.beginPath(); ctx.moveTo(off, -hh + 6); ctx.lineTo(off, hh - 6); ctx.stroke();
          }
        } else if (b.type === 'spikewall') {
          // 가시 — 사방으로 뻗은 뾰족한 것들. 만지면 아프다는 뜻은 이 한 가지 모양이면 된다.
          ctx.fillStyle = '#d8dde6';
          const spike = (ax, ay, dx, dy) => {
            ctx.beginPath();
            ctx.moveTo(ax - dy * 3.2, ay + dx * 3.2);
            ctx.lineTo(ax + dx * 8, ay + dy * 8);
            ctx.lineTo(ax + dy * 3.2, ay - dx * 3.2);
            ctx.closePath(); ctx.fill();
          };
          for (let i = -1; i <= 1; i++) {
            spike(i * hw * 0.5, -hh, 0, -1);
            spike(i * hw * 0.5, hh, 0, 1);
            spike(-hw, i * hh * 0.5, -1, 0);
            spike(hw, i * hh * 0.5, 1, 0);
          }
        } else {
          // 기본 벽 (Rampart / Carapace / Aegis Barrier) — 벽돌 이음매.
          ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(-hw + 3, 0); ctx.lineTo(hw - 3, 0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -hh + 3); ctx.lineTo(0, -1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-hw * 0.45, 1); ctx.lineTo(-hw * 0.45, hh - 3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(hw * 0.45, 1); ctx.lineTo(hw * 0.45, hh - 3); ctx.stroke();
        }
        ctx.restore();
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

      // 항법등 — 모서리에서 천천히 깜빡이는 붉은 점 (건물마다 위상이 다르다)
      {
        const t = performance.now() / 1000;
        const blink = (Math.sin(t * 2.1 + (b.id || 0) * 2.63) + 1) / 2;
        if (blink > 0.68) {
          const ba = (blink - 0.68) / 0.32;
          const bx2 = x + b.w - 6, by2 = y + 6;
          ctx.save();
          blitGlow(softGlow('255,93,93'), bx2, by2, 7, 7, ba * 0.5);
          ctx.globalAlpha = ba;
          ctx.fillStyle = '#ff8484';
          ctx.beginPath(); ctx.arc(bx2, by2, 1.8, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // 손상 연출 — 반파되면 연기, 위험 수위면 불꽃까지 (시드는 건물 id로 고정)
      {
        const dfrac = b.hp / b.maxHp;
        if (dfrac < 0.55) {
          const t = performance.now() / 1000;
          let s = ((b.id || 1) * 2654435761) >>> 0 || 7;
          const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
          ctx.save();
          const spots = dfrac < 0.28 ? 3 : 2;
          for (let i = 0; i < spots; i++) {
            const px = x + 8 + rnd() * (b.w - 16), py = y + 6 + rnd() * (b.h * 0.6);
            // 피어오르는 연기
            for (let k2 = 0; k2 < 3; k2++) {
              const rise = (t * 15 + k2 * 19 + i * 31) % 46;
              ctx.globalAlpha = (1 - rise / 46) * 0.34;
              ctx.fillStyle = 'rgba(30,30,34,1)';
              ctx.beginPath();
              ctx.arc(px + Math.sin(rise * 0.16 + k2) * 3, py - rise, 3 + rise * 0.16, 0, Math.PI * 2);
              ctx.fill();
            }
            // 위험 수위 — 불꽃 혀가 일렁인다
            if (dfrac < 0.28) {
              const fl = 0.6 + 0.4 * Math.sin(t * 13 + i * 2.7);
              blitGlow(softGlow('255,170,60'), px, py, 9, 9, 0.55 * fl);
              ctx.globalAlpha = 0.85 * fl;
              ctx.fillStyle = '#ffb648';
              ctx.beginPath();
              ctx.moveTo(px - 3.2, py + 2);
              ctx.quadraticCurveTo(px - 1.5, py - 4 - fl * 4, px + Math.sin(t * 17 + i) * 1.6, py - 7 - fl * 3);
              ctx.quadraticCurveTo(px + 2.4, py - 3, px + 3.2, py + 2);
              ctx.closePath(); ctx.fill();
            }
          }
          ctx.restore();
        }
      }
    }

    // 피격 섬광 — 몸체 위로 짧게 번쩍 (건설 중 포함)
    if (b.hitFlash > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, b.hitFlash * 4);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#fff';
      rrect(x, y, b.w, b.h, 7); ctx.fill();
      ctx.restore();
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
    guardDome(b);
    shieldBar(b, b.x, y - 25, b.w * 0.8);
    healthBar(b.x, y - 20, b.w * 0.8, b.hp / b.maxHp,
              b.hp < b.maxHp || !b.done || b.def.isCrystal || (b.maxShield > 0 && b.shield < b.maxShield));
  }

  // 유닛 색상(소유자색 + 종족 색조) — drawUnit / drawPortrait 공용
  function unitColors(u, flash) {
    const p = pal(u.owner);
    const c = {
      body:  flash ? '#ffffff' : p.body,
      light: flash ? '#ffffff' : shade(p.body, 0.34),
      dark:  flash ? '#e6e6e6' : shade(p.body, -0.42),
      trim:  flash ? '#ffe6c0' : p.trim,
      steel: flash ? '#ffffff' : '#b6c3d6',
      eye:   flash ? '#ffffff' : '#ff5a3c',   // menacing red optic (Forge)
      ink:   flash ? '#dfe6ef' : shade(p.body, -0.72),   // bold cartoon outline
      opticRGB: '255,90,60',
    };
    // 종족 색조 — 글룹은 유기적 초록빛, 포지는 차가운 강철빛 (소유자 색은 유지)
    if (!flash) {
      // Keep the OWNER's color dominant (blue you / red enemy / green ally / purple) for
      // readability — the faction only tints lightly, staying identifiable via green acid
      // accents (eyes, drips) for Gloop and cool steel highlights for Forge.
      if (u.def.race === 'gloop') {
        c.body = mix(c.body, GLOOP_TINT, 0.14); c.light = mix(c.light, GLOOP_TINT, 0.16);
        c.dark = mix(c.dark, GLOOP_TINT, 0.14); c.steel = mix(c.steel, GLOOP_TINT, 0.30);
        c.eye = '#b6ff4a'; c.opticRGB = '150,255,90';   // toxic-green glare
      } else if (u.def.race === 'aether') {
        // Aether — 광택 있는 보랏빛 크리스탈 표면 + 하얗게 빛나는 사이오닉 코어
        c.body = mix(c.body, AETHER_TINT, 0.16); c.light = mix(c.light, PSI, 0.24);
        c.dark = mix(c.dark, AETHER_TINT, 0.18); c.steel = mix(c.steel, AETHER_TINT, 0.34);
        c.eye = PSI_HOT; c.psi = PSI; c.opticRGB = '210,170,255';   // psionic glare
      } else {
        c.steel = mix(c.steel, FORGE_TINT, 0.22);
        c.eye = '#ff5a3c'; c.opticRGB = '255,90,60';   // hostile red glare
      }
      if (!c.psi) c.psi = PSI;
      // A hero's cosmetic palette, CLAMPED. Applied here rather than at each call site so
      // every in-match path — the battlefield, the portrait, the minimap blip — gets the
      // same clamped colour and none of them can forget. The clamp is the ownership rule:
      // player colour has to stay dominant or a player cannot tell their hero from the
      // enemy's at a glance. See applyCosmeticPalette.
      if (u.cos) applyCosmeticPalette(c, u.cos, RC.COSMETIC_SAFE);
    }
    return c;
  }

  // ── Menacing cartoon primitives (shared by every redesigned sprite) ──
  // Bold ink outlines, hostile glowing optics, angled visor slits, cel highlights.
  const TAU = Math.PI * 2;

  // ── Cartoon dials ──────────────────────────────────────────────────────────
  // Every one of the 20-plus unit sprites is drawn from these same few primitives,
  // so the whole roster can be pushed toward a chunkier, friendlier read by tuning
  // them in one place instead of hand-editing every draw function. Raising INK is
  // what does most of the work: a heavy, even outline is the single strongest cue
  // that something is drawn rather than rendered.
  const INK = 1.65;          // outline weight multiplier
  const EYE = 1.34;          // optic / visor scale — bigger eyes read younger and cuter
  const ROUND = 1.9;         // corner-radius multiplier on every rounded rectangle
  const CEL = 0.62;          // strength of the flat top-light

  // ── 3D 일러스트 셰이딩 ─────────────────────────────────────────────────────
  // Every sprite in the roster is assembled from flat fills, so the cheapest way to make
  // the whole cast read as rendered-and-painted rather than stamped is to replace those
  // flat colours with a spherical gradient: a hot specular near the light, the base tone
  // across the middle, and a cool falloff on the far side. Warm highlight against cool
  // shadow is what does the illustrated look — a purely lighter/darker ramp of the same
  // hue still reads flat no matter how strong you push it.
  // The base tone has to hold the middle of the shape or the unit stops reading as its
  // owner's colour — the highlight is a SPOT near the light, not a wash over the whole body.
  const HI_TINT = '#fff3d2', HI_MIX = 0.16, HI_LIFT = 0.34;   // sunlit side
  const SH_TINT = '#131e33', SH_MIX = 0.22, SH_DROP = -0.32;  // sky-bounce shadow side
  // createRadialGradient per fill per frame is brutal on software rasterizers, and there
  // are twenty-odd fills per sprite. Gradients are immutable once built, and the only
  // things that vary are the base colour and the sprite radius (fixed per unit type), so
  // the whole roster collapses to a few dozen cached objects.
  let _ctxSeq = 0;
  const _vol = new Map();
  function volGrad(base, R) {
    if (!ctx.__rcVol) ctx.__rcVol = ++_ctxSeq;    // gradients belong to the ctx that made them
    const key = ctx.__rcVol + '|' + base + '|' + (R * 4 | 0);
    let g = _vol.get(key);
    if (g) return g;
    // Light source sits OUTSIDE the sprite, up and to the left, with a broad falloff. Putting
    // it inside the body — the obvious first guess — floods the whole shape with highlight and
    // the unit stops reading as its owner's colour. The base tone has to land on the middle of
    // the form (hence the 0.55 stop ≈ the distance from the lamp to the sprite's centre).
    g = ctx.createRadialGradient(-R * 0.80, -R * 0.92, R * 0.10, -R * 0.80, -R * 0.92, R * 2.45);
    g.addColorStop(0,    mix(shade(base, HI_LIFT * 1.45), HI_TINT, HI_MIX * 1.7));
    g.addColorStop(0.24, mix(shade(base, HI_LIFT * 0.60), HI_TINT, HI_MIX));
    g.addColorStop(0.55, base);
    g.addColorStop(1,    mix(shade(base, SH_DROP), SH_TINT, SH_MIX));
    if (_vol.size > 600) _vol.clear();
    _vol.set(key, g);
    return g;
  }
  // Volumetric copy of a unit palette. Structural tones become gradients; anything that is
  // meant to GLOW (eye, psi, ink) stays flat — a gradient on an emissive surface reads as
  // dirt, and c.ink doubles as the outline colour where a gradient would just look muddy.
  // The originals survive as _body/_dark/_light for the few sprites that re-shade them.
  function volPal(c, R) {
    const v = {
      _body: c.body, _dark: c.dark, _light: c.light,
      body: volGrad(c.body, R), dark: volGrad(c.dark, R), light: volGrad(c.light, R),
      steel: volGrad(c.steel, R), trim: volGrad(c.trim, R),
      eye: c.eye, ink: c.ink, opticRGB: c.opticRGB, psi: c.psi,
    };
    return v;
  }

  function inkLine(c, w) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = c.ink; ctx.lineWidth = w * INK; ctx.stroke();
  }
  function sglow(x, y, r, rgb, a) { blitGlow(softGlow(rgb), x, y, r, r, a); }
  function celTop(c, x, y, w, h, r) {
    ctx.fillStyle = c.light; ctx.globalAlpha = CEL; rrect(x, y, w, h, r * ROUND); ctx.fill(); ctx.globalAlpha = 1;
  }
  // Big rounded eye with a fat catch-light. The catch-light is the cartoon tell —
  // without it an optic is a lamp; with it, the thing looks alive and is looking AT you.
  function optic(c, x, y, r) {
    r *= EYE;
    sglow(x, y, r * 2.1, c.opticRGB, 0.5);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = c.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fillStyle = c.eye; ctx.fill();
    // main catch-light, upper left
    ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(x - r * 0.24, y - r * 0.27, r * 0.32, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
    // tiny secondary spark, lower right — sells the glassy dome
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(x + r * 0.3, y + r * 0.28, r * 0.13, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Forward-pointing visor. Kept angled so it still reads as a fighter, but taller and
  // softer-cornered than before so it looks like a helmet rather than a razor slot.
  function visorSlit(c, x, y, w, h) {
    h *= EYE;
    sglow(x + w * 0.5, y, w * 1.35, c.opticRGB, 0.5);
    ctx.fillStyle = c.ink; rrect(x - w * 0.18, y - h * 1.0, w * 1.36, h * 2.0, h); ctx.fill();
    ctx.fillStyle = c.eye;
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.52); ctx.lineTo(x + w, y - h * 0.26);
    ctx.lineTo(x + w, y + h * 0.26); ctx.lineTo(x, y + h * 0.52);
    ctx.closePath(); ctx.fill();
    // glass highlight along the top edge
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x + w * 0.08, y - h * 0.38); ctx.lineTo(x + w * 0.92, y - h * 0.18);
    ctx.lineTo(x + w * 0.92, y - h * 0.06); ctx.lineTo(x + w * 0.08, y - h * 0.22);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 유닛 스프라이트 본체 — 원점 기준으로 그림(+x 방향을 바라봄). drawUnit / drawPortrait 공용
  function drawUnitSprite(u, c) {
    // Draw the body larger than the collision radius so units read as solid shapes
    // rather than small blobs sitting on their owner disc. Pushed up from 1.18 for the
    // cartoon pass: a chunkier body over the same footprint is what gives the roster
    // its stubby hero proportions without touching collision or pathing.
    const R = u.r * 1.30;
    // One swap here lights the entire roster: every draw function below fills with c.body /
    // c.dark / c.steel, so handing them gradients instead of hex turns all twenty-odd
    // sprites volumetric without touching a single shape.
    c = volPal(c, R);
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
    else if (u.type === 'thornling') drawGlobling(R, c);   // 소환수 — 글로블링 실루엣 재사용
    // Heroes. `u.cos` is what the player has equipped (see drawCosmetics); it is absent
    // on every non-hero and on any hero nobody has dressed, so the two calls cost one
    // undefined check each in the hot path.
    else if (HERO_RIG[u.type]) {
      drawCosmetics(R, c, u.type, u.cos, 'under');
      if (u.type === 'rook') drawWarden(R, c);
      else if (u.type === 'thorn') drawMatriarch(R, c);
      else if (u.type === 'prism') drawArchon(R, c);
      else if (u.type === 'ember') drawEmber(R, c);
      else drawVale(R, c);
      drawCosmetics(R, c, u.type, u.cos, 'over');
    }
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
    // Heavy ink around the crystal silhouette, to match the units' outlines.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = mix(AETHER_TINT, '#0a0714', 0.55);
    ctx.lineWidth = Math.max(4, b.w * 0.065);
    oct(x, y, b.w, b.h, 0); ctx.stroke();
    ctx.fillStyle = body; oct(x + 5, y + 5, b.w - 10, b.h - 10, 0.3); ctx.fill();
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
    ctx.fillStyle = c.dark; rrect(-R * 0.62, -R * 0.62, R * 1.2, R * 1.24, 5); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.body; rrect(-R * 0.52, -R * 0.54, R * 1.0, R * 1.08, 4); ctx.fill(); inkLine(c, R * 0.16);
    celTop(c, -R * 0.5, -R * 0.5, R * 0.9, R * 0.32, 4);
    ctx.fillStyle = c.dark; rrect(-R * 0.34, -R * 1.0, R * 0.7, R * 0.42, 4); ctx.fill(); inkLine(c, R * 0.13);
    rrect(-R * 0.34, R * 0.58, R * 0.7, R * 0.42, 4); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.steel; rrect(R * 0.3, -R * 0.44, R * 1.2, R * 0.26, 3); ctx.fill(); inkLine(c, R * 0.12);
    rrect(R * 0.3, R * 0.18, R * 1.2, R * 0.26, 3); ctx.fill(); inkLine(c, R * 0.12);
    ctx.fillStyle = c.ink; ctx.fillRect(R * 1.44, -R * 0.48, R * 0.14, R * 0.34); ctx.fillRect(R * 1.44, R * 0.14, R * 0.14, R * 0.34);
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.arc(-R * 0.5, 0, R * 0.38, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.trim; ctx.beginPath(); ctx.arc(-R * 0.5, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    visorSlit(c, R * 0.14, -R * 0.02, R * 0.34, R * 0.15);
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
    ctx.fillStyle = c.trim;
    [-1, 1].forEach(function (s) { ctx.beginPath(); ctx.moveTo(s * R * 0.82, -R * 0.6); ctx.lineTo(s * R * 1.32, -R * 1.02); ctx.lineTo(s * R * 0.98, -R * 0.48); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.1); });
    ctx.fillStyle = c.dark; rrect(-R * 0.72, -R * 0.52, R * 1.44, R * 1.12, 5); ctx.fill(); inkLine(c, R * 0.16);
    ctx.fillStyle = c.body; rrect(-R * 0.62, -R * 0.66, R * 1.24, R * 1.3, 6); ctx.fill(); inkLine(c, R * 0.24);
    celTop(c, -R * 0.58, -R * 0.6, R * 1.14, R * 0.36, 5);
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(-R * 0.12, -R * 0.74, R * 0.34, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.12);
    ctx.beginPath(); ctx.arc(-R * 0.12, R * 0.74, R * 0.34, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.12);
    ctx.fillStyle = c.steel; rrect(R * 0.2, -R * 0.26, R * 1.2, R * 0.52, 3); ctx.fill(); inkLine(c, R * 0.16);
    ctx.fillStyle = c.ink; rrect(R * 1.38, -R * 0.3, R * 0.2, R * 0.6, 3); ctx.fill();
    sglow(R * 1.5, 0, R * 0.55, c.opticRGB, 0.6);
    visorSlit(c, R * 0.05, -R * 0.02, R * 0.5, R * 0.2);
  }

  // ══ EMBER — the Kindler ══════════════════════════════════════════════════
  // Ember and Rook used to be the same silhouette wearing different palettes: both a
  // wide rounded torso with a long horizontal barrel out to the right and a muzzle glow
  // at the end of it. At gameplay zoom that is one sprite, and a player who cannot tell
  // their zoner from their tank at a glance cannot play either of them.
  //
  // So the two are now built from opposite parts. Rook keeps the wide box, the shoulder
  // pauldrons and the level barrel. Ember is narrow and hunched, its weapon is a stubby
  // mortar angled UP over the shoulder rather than a barrel pointing forward, and it
  // stands on thin digitigrade legs instead of a solid chassis. Nothing about the two
  // outlines overlaps: Rook is a horizontal rectangle, Ember a forward-leaning wedge
  // with a diagonal tube crossing it.
  //
  // The fire is the second read. Rook has one cool optic; Ember has a coal seam down the
  // chest, vent slots that pulse, and embers drifting up off the mortar mouth — so even
  // in silhouette-only conditions the glowing one is the zoner.
  //
  // Flicker is driven off performance.now(), never Math.random: the sim is seeded and
  // shared, and cosmetics must never draw from the RNG (see the note in _passiveAura).
  function drawEmber(R, c) {
    const t = performance.now() / 1000;
    const flick = 0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 3.1);
    const breathe = Math.sin(t * 1.6) * R * 0.03;

    // ── 다리 — 가늘고 굽은 2족. 룩의 육중한 차대와 정반대되는 실루엣의 시작점 ──
    ctx.strokeStyle = c.ink; ctx.lineWidth = R * 0.17; ctx.lineCap = 'round';
    [-1, 1].forEach(function (s) {
      ctx.beginPath();
      ctx.moveTo(-R * 0.1, s * R * 0.3);
      ctx.lineTo(-R * 0.34, s * R * 0.66);
      ctx.lineTo(R * 0.06, s * R * 0.95);
      ctx.stroke();
    });
    ctx.fillStyle = c.steel;
    [-1, 1].forEach(function (s) {
      ctx.beginPath(); ctx.ellipse(R * 0.1, s * R * 0.95, R * 0.2, R * 0.13, 0, 0, TAU);
      ctx.fill(); inkLine(c, R * 0.09);
    });

    // ── 몸통 — 앞으로 기울어진 쐐기. 사각형이 아니라는 점이 핵심 ──
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.moveTo(R * 0.52, -R * 0.16 + breathe);   // 앞으로 내민 가슴
    ctx.lineTo(R * 0.3, R * 0.42);
    ctx.lineTo(-R * 0.3, R * 0.5);
    ctx.lineTo(-R * 0.46, -R * 0.34 + breathe);  // 뒤로 솟은 등
    ctx.lineTo(-R * 0.02, -R * 0.56 + breathe);
    ctx.closePath(); ctx.fill(); inkLine(c, R * 0.22);

    // ── 가슴 석탄층 — 안에서 타는 불이 갈라진 틈으로 보인다 ──
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(R * 0.52, -R * 0.16 + breathe); ctx.lineTo(R * 0.3, R * 0.42);
    ctx.lineTo(-R * 0.3, R * 0.5); ctx.lineTo(-R * 0.46, -R * 0.34 + breathe);
    ctx.lineTo(-R * 0.02, -R * 0.56 + breathe); ctx.closePath();
    ctx.clip();
    ctx.globalAlpha = 0.6 + 0.35 * flick;
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.moveTo(R * 0.36, -R * 0.1); ctx.lineTo(R * 0.12, R * 0.34);
    ctx.lineTo(-R * 0.04, R * 0.3); ctx.lineTo(R * 0.2, -R * 0.16);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    // Glows stay deliberately low. Ember is the only hero carrying three light sources
    // (chest seam, muzzle, embers) and at menu scale a bright one washes the wedge body
    // out into the same orange blob Rook already is — which is the bug being fixed.
    sglow(R * 0.16, R * 0.08, R * 0.62, c.opticRGB, 0.16 + 0.14 * flick);

    // ── 등 배기 슬롯 세 개 — 룩의 둥근 어깨 대신 각진 핀 ──
    ctx.fillStyle = c.dark;
    for (let i = 0; i < 3; i++) {
      const yy = -R * 0.34 + i * R * 0.26;
      rrect(-R * 0.56, yy + breathe * 0.5, R * 0.24, R * 0.13, 2); ctx.fill();
    }

    // ── 어깨 위로 꺾어 올린 박격포 — 룩의 수평 포신과 절대 겹치지 않는 대각선 ──
    ctx.save();
    ctx.translate(-R * 0.12, -R * 0.42 + breathe);
    ctx.rotate(-0.72);
    ctx.fillStyle = c.steel; rrect(-R * 0.16, -R * 0.26, R * 1.0, R * 0.52, 4); ctx.fill(); inkLine(c, R * 0.16);
    // 포구 링
    ctx.fillStyle = c.ink; rrect(R * 0.78, -R * 0.32, R * 0.16, R * 0.64, 3); ctx.fill();
    ctx.globalAlpha = 0.5 + 0.4 * flick;
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.ellipse(R * 0.82, 0, R * 0.1, R * 0.24, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    // 포구 불빛은 회전 밖에서 — 대각선 끝을 월드 좌표로 근사
    sglow(R * 0.46, -R * 0.98 + breathe, R * 0.5, c.opticRGB, 0.26 + 0.2 * flick);

    // ── 떠오르는 불티 세 점. 정지 화면에서도 "불"이라고 읽히게 하는 마지막 신호 ──
    ctx.fillStyle = c.trim;
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.75 + i * 0.37) % 1;            // 0→1 상승 후 리셋
      const ex = R * 0.4 + Math.sin((t + i * 2.1) * 2.3) * R * 0.16;
      const ey = -R * 0.9 - ph * R * 0.85 + breathe;
      ctx.globalAlpha = (1 - ph) * 0.8;
      ctx.beginPath(); ctx.arc(ex, ey, R * 0.07 * (1 - ph * 0.5), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── 머리 — 작고 낮게 파묻힌 단안. 룩의 넓은 바이저와 다른 종류의 얼굴 ──
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.arc(R * 0.34, -R * 0.02 + breathe, R * 0.27, 0, TAU); ctx.fill(); inkLine(c, R * 0.12);
    optic(c, R * 0.38, -R * 0.02 + breathe, R * 0.17);
  }

  // ══ VALE — the Mender ════════════════════════════════════════════════════
  // The support reads as the opposite of Ember: tall, narrow, unarmoured, with a lantern
  // out in FRONT instead of a gun. The halo ring is the tell — it is the only sprite in
  // the roster whose silhouette is mostly empty space, which is what makes a Vale in a
  // crowd findable at a glance when you need to protect it.
  function drawVale(R, c) {
    const t = performance.now() / 1000;
    const pulse = 0.55 + 0.45 * Math.sin(t * 2.2);
    // 뒤로 흐르는 로브 자락
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, -R * 0.62); ctx.lineTo(-R * 1.18, -R * 0.2);
    ctx.lineTo(-R * 1.18, R * 0.2); ctx.lineTo(-R * 0.2, R * 0.62);
    ctx.closePath(); ctx.fill(); inkLine(c, R * 0.14);
    ctx.fillStyle = c.body; rrect(-R * 0.44, -R * 0.6, R * 0.92, R * 1.2, 8); ctx.fill(); inkLine(c, R * 0.22);
    celTop(c, -R * 0.38, -R * 0.54, R * 0.8, R * 0.3, 5);
    // 치유 고리 — 발치를 도는 얇은 링
    ctx.strokeStyle = c.trim; ctx.lineWidth = R * 0.09;
    ctx.globalAlpha = 0.5 + 0.3 * pulse;
    ctx.beginPath(); ctx.ellipse(0, R * 0.86, R * 1.0, R * 0.3, 0, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    // 앞으로 내민 등불 — 총이 아니라 등불이라는 점이 이 영웅의 전부다
    ctx.strokeStyle = c.ink; ctx.lineWidth = R * 0.13; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.3, -R * 0.1); ctx.lineTo(R * 1.05, -R * 0.34); ctx.stroke();
    sglow(R * 1.12, -R * 0.36, R * 0.85, c.opticRGB, 0.35 + 0.3 * pulse);
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.arc(R * 1.12, -R * 0.36, R * 0.26 + R * 0.04 * pulse, 0, TAU); ctx.fill();
    inkLine(c, R * 0.1);
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(R * 1.05, -R * 0.44, R * 0.09, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    optic(c, R * 0.04, -R * 0.12, R * 0.24);
  }

  // ══ Cosmetics ════════════════════════════════════════════════════════════
  // Hats, costumes and shoes are drawn GENERICALLY against a per-hero rig — a handful of
  // anchor points in the hero's own local space — instead of being written into each
  // hero's draw function.
  //
  // That choice is the whole cosmetic system. Five heroes x three slots x N items is a
  // combinatorial trap, and it is where most procedural wardrobe systems die at about
  // item eight. With a rig, one hat draws correctly on all five heroes and adding an item
  // is one entry in RC.COSMETICS plus one small function here — never five.
  //
  // The rig is a table rather than a return value from the draw functions on purpose:
  // drawUnitSprite runs for every unit every frame, and allocating an anchor object per
  // sprite per frame to serve the handful that wear anything would be a poor trade.
  //
  // Anchors are in units of R (the drawn radius), so they scale with the sprite whether
  // it is on the menu at 312px or on the battlefield at 22px.
  // head.x/y are in units of R and are consumed as `R * a.x`; torso.w/h and feet.r are
  // fractions of R too. Every number here was read off the matching draw function above,
  // so moving a shoulder means moving its anchor in the same commit.
  const HERO_RIG = {
    rook:  { head: { x: 0.05, y: -0.92, r: 0.56 }, torso: { x: -0.62, y: -0.2, w: 1.24, h: 0.9 },
             feet: [{ x: -0.12, y: 0.74, r: 0.34 }, { x: -0.12, y: -0.74, r: 0.34 }] },
    thorn: { head: { x: 0, y: -1.02, r: 0.5 }, torso: { x: -0.5, y: -0.16, w: 1.0, h: 0.86 },
             feet: [{ x: -0.5, y: 0.86, r: 0.24 }, { x: 0.28, y: 0.9, r: 0.24 }] },
    prism: { head: { x: 0, y: -0.98, r: 0.52 }, torso: { x: -0.46, y: -0.2, w: 0.92, h: 0.84 },
             feet: [{ x: -0.3, y: 0.82, r: 0.26 }, { x: 0.3, y: 0.82, r: 0.26 }] },
    ember: { head: { x: -0.02, y: -0.96, r: 0.54 }, torso: { x: -0.6, y: -0.2, w: 1.2, h: 0.9 },
             feet: [{ x: -0.2, y: 0.82, r: 0.3 }, { x: 0.24, y: 0.86, r: 0.3 }] },
    vale:  { head: { x: 0, y: -0.9, r: 0.46 }, torso: { x: -0.44, y: -0.18, w: 0.88, h: 0.82 },
             feet: [{ x: -0.18, y: 0.86, r: 0.24 }, { x: 0.22, y: 0.88, r: 0.24 }] },
  };
  function heroRig(type) { return HERO_RIG[type] || null; }

  // Every item function receives anchors already converted to PIXELS by drawCosmetics,
  // so an item never has to remember to multiply by R. One conversion, one place.
  //
  // ── Hats ── drawn last, over the head anchor
  const HATS = {
    crown(R, c, a) {
      const w = a.r * 1.5, h = a.r * 0.8;
      ctx.fillStyle = c.trim;
      ctx.beginPath();
      ctx.moveTo(a.x - w * 0.5, a.y + h * 0.5);
      ctx.lineTo(a.x - w * 0.5, a.y - h * 0.2);
      ctx.lineTo(a.x - w * 0.22, a.y + h * 0.1);
      ctx.lineTo(a.x, a.y - h * 0.6);
      ctx.lineTo(a.x + w * 0.22, a.y + h * 0.1);
      ctx.lineTo(a.x + w * 0.5, a.y - h * 0.2);
      ctx.lineTo(a.x + w * 0.5, a.y + h * 0.5);
      ctx.closePath(); ctx.fill(); inkLine(c, R * 0.1);
    },
    horns(R, c, a) {
      const s = a.r;
      ctx.fillStyle = c.trim;
      [-1, 1].forEach(function (k) {
        ctx.beginPath();
        ctx.moveTo(a.x + k * s * 0.3, a.y + s * 0.35);
        ctx.quadraticCurveTo(a.x + k * s * 1.25, a.y + s * 0.1, a.x + k * s * 0.95, a.y - s * 0.95);
        ctx.quadraticCurveTo(a.x + k * s * 0.6, a.y - s * 0.15, a.x + k * s * 0.05, a.y + s * 0.35);
        ctx.closePath(); ctx.fill(); inkLine(c, R * 0.08);
      });
    },
    halo(R, c, a) {
      const s = a.r;
      sglow(a.x, a.y - s * 0.7, s * 2.0, c.opticRGB, 0.4);
      ctx.strokeStyle = c.trim; ctx.lineWidth = R * 0.11;
      ctx.beginPath(); ctx.ellipse(a.x, a.y - s * 0.7, s * 0.95, s * 0.34, 0, 0, TAU); ctx.stroke();
    },
    cap(R, c, a) {
      const w = a.r * 1.45, h = a.r * 0.62;
      ctx.fillStyle = c.dark;
      rrect(a.x - w * 0.5, a.y - h * 0.35, w, h, 4); ctx.fill(); inkLine(c, R * 0.1);
      ctx.fillStyle = c.steel;
      rrect(a.x + w * 0.28, a.y + h * 0.05, w * 0.55, h * 0.3, 3); ctx.fill(); inkLine(c, R * 0.07);
    },
  };

  // ── Costumes ── drawn first, so the body and the hat both sit over them
  const SUITS = {
    cloak(R, c, a) {
      ctx.fillStyle = c.dark; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - a.h * 0.5);
      ctx.lineTo(a.x - a.w * 0.6, a.y + a.h * 0.9);
      ctx.lineTo(a.x + a.w * 0.5, a.y + a.h * 1.15);
      ctx.lineTo(a.x + a.w, a.y - a.h * 0.5);
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; inkLine(c, R * 0.12);
    },
    plate(R, c, a) {
      ctx.fillStyle = c.steel;
      rrect(a.x + a.w * 0.12, a.y - a.h * 0.15, a.w * 0.76, a.h * 0.95, 4);
      ctx.fill(); inkLine(c, R * 0.14);
      ctx.strokeStyle = c.ink; ctx.lineWidth = R * 0.06;
      for (let i = 1; i < 3; i++) {
        const y = a.y - a.h * 0.15 + a.h * 0.95 * (i / 3);
        ctx.beginPath(); ctx.moveTo(a.x + a.w * 0.14, y); ctx.lineTo(a.x + a.w * 0.86, y); ctx.stroke();
      }
    },
    sash(R, c, a) {
      ctx.fillStyle = c.trim;
      ctx.beginPath();
      ctx.moveTo(a.x + a.w * 0.05, a.y - a.h * 0.2);
      ctx.lineTo(a.x + a.w * 0.42, a.y - a.h * 0.35);
      ctx.lineTo(a.x + a.w * 0.95, a.y + a.h * 0.75);
      ctx.lineTo(a.x + a.w * 0.58, a.y + a.h * 0.9);
      ctx.closePath(); ctx.fill(); inkLine(c, R * 0.09);
    },
  };

  // ── Shoes ── one function, called once per foot, so a six-legged hero wears six
  const SHOES = {
    tread(R, c, f) {
      ctx.fillStyle = c.ink;
      rrect(f.x - f.r * 0.9, f.y - f.r * 0.35, f.r * 1.8, f.r * 0.95, 3); ctx.fill();
      ctx.fillStyle = c.steel;
      rrect(f.x - f.r * 0.75, f.y - f.r * 0.2, f.r * 1.5, f.r * 0.3, 2); ctx.fill();
    },
    greave(R, c, f) {
      ctx.fillStyle = c.steel;
      rrect(f.x - f.r * 0.7, f.y - f.r * 1.1, f.r * 1.4, f.r * 1.5, 3); ctx.fill(); inkLine(c, R * 0.09);
    },
    spark(R, c, f) {
      sglow(f.x, f.y + f.r * 0.4, f.r * 2.2, c.opticRGB, 0.45);
      ctx.fillStyle = c.trim;
      rrect(f.x - f.r * 0.8, f.y - f.r * 0.2, f.r * 1.6, f.r * 0.7, 4); ctx.fill(); inkLine(c, R * 0.08);
    },
  };

  // What this hero is wearing. Called from drawUnitSprite around the body, so a costume
  // sits under it and a hat over it. Does nothing for a unit that is not a hero or is
  // wearing nothing, which is almost every unit on the map.
  //
  // `phase` is 'under' (costume) or 'over' (shoes, hat) — one function, called twice,
  // rather than two functions that could drift apart about which slot draws when.
  function drawCosmetics(R, c, type, cos, phase) {
    if (!cos) return;
    const rig = heroRig(type);
    if (!rig) return;
    if (phase === 'under') {
      if (cos.suit && cos.suit !== 'none' && SUITS[cos.suit] && rig.torso) {
        const t = rig.torso;
        SUITS[cos.suit](R, c, { x: t.x * R, y: t.y * R, w: t.w * R, h: t.h * R });
      }
      return;
    }
    if (cos.shoes && cos.shoes !== 'none' && SHOES[cos.shoes] && rig.feet) {
      for (const f of rig.feet) SHOES[cos.shoes](R, c, { x: f.x * R, y: f.y * R, r: f.r * R });
    }
    if (cos.hat && cos.hat !== 'none' && HATS[cos.hat] && rig.head) {
      const h = rig.head;
      HATS[cos.hat](R, c, { x: h.x * R, y: h.y * R, r: h.r * R });
    }
  }

  // Apply a cosmetic palette to a colour set.
  //
  // `strength` is the whole ownership-readability rule in one argument. On the menu there
  // is no enemy to be confused with, so a skin runs at 1 — full strength, exactly the
  // colour the player bought. In a MATCH the same skin is blended only RC.COSMETIC_SAFE
  // of the way from the player's colour, because a player has to tell their units from
  // the enemy's instantly and player colour is what does that. Give someone free rein
  // over colour and they will eventually build a hero that reads as the opponent's.
  function applyCosmeticPalette(c, cos, strength) {
    if (!cos || !cos.palette || cos.palette === 'none') return c;
    const item = RC.cosmetic ? RC.cosmetic('palette', cos.palette) : null;
    if (!item || !item.tint) return c;
    const k = strength == null ? 1 : strength;
    c.body = mix(c.body, item.tint, k);
    c.light = mix(c.light, shade(item.tint, 0.32), k);
    c.dark = mix(c.dark, shade(item.tint, -0.46), k);
    c.trim = mix(c.trim, shade(item.tint, 0.55), k);
    c.ink = mix(c.ink, shade(item.tint, -0.72), k);
    return c;
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
      // The portrait is a camera feed of a unit standing still, so the Gloop creatures idle
      // here: legs shift and settle rather than march. _walking stays false for that.
      _ph = t * 2.0; _walking = false;
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
    const tNow = performance.now() / 1000;

    // ── 공격 모션 — 준비동작 → 타격 → 복귀 ──
    // atkAnim fires at the MOMENT the shot leaves, so a true anticipation ahead of the
    // hit would need simulation state. Reading the first slice of the animation as a
    // wind-up gets the same read on screen for free: the unit rocks back, then drives
    // forward. Purely cosmetic — nothing here touches u.x/u.y.
    let lunge = 0;
    if (u.atkAnim > 0) {
      const ph = 1 - u.atkAnim;                                   // 0(발사)→1(끝)
      const melee = (u.def.range || 0) <= 45;
      let strike;
      if (ph < 0.16) strike = -(ph / 0.16) * 0.34;                // 준비 — 살짝 뒤로
      else if (ph < 0.42) strike = ((ph - 0.16) / 0.26);          // 타격 — 빠르게 앞으로
      else strike = 1 - (ph - 0.42) / 0.58;                       // 복귀 — 천천히
      lunge = strike * (melee ? u.r * 0.68 : -u.r * 0.26);
    }

    // ── 보행/호흡 애니메이션 ──────────────────────────────
    // Ground units used to slide across the map in a single fixed pose. The gait is
    // driven by DISTANCE ACTUALLY TRAVELLED rather than wall-clock time, so a slowed
    // unit takes slower steps and a stopped one stops stepping — tying it to time
    // alone makes units moonwalk. All of this lives in render-only fields (_px/_py/
    // _gait/_idle) that the simulation never reads, so it cannot desync an online match.
    let bobY = 0, sqX = 1, sqY = 1, gaitPh = 0, gaitOn = false;
    if (!u.def.flying) {
      const moved = (u._px == null) ? 0 : RC.dist(u.x, u.y, u._px, u._py);
      u._px = u.x; u._py = u.y;
      u._gait = (u._gait || 0) + moved;
      const walking = moved > 0.02;
      const stride = Math.max(9, u.r * 1.5);                      // bigger units, longer steps
      gaitOn = walking && !REDUCED;
      gaitPh = (u._gait / stride) * Math.PI;                      // shared with the leg cycle below
      if (gaitOn) {
        const ph = gaitPh;
        bobY = -Math.abs(Math.sin(ph)) * u.r * 0.16;              // up on the step, down on the plant
        const plant = Math.max(0, -Math.sin(ph * 2)) * 0.10;      // squash as the foot lands
        sqX = 1 + plant; sqY = 1 - plant;
      } else if (!REDUCED) {
        // Idle breathing — offset per unit so a standing army doesn't pulse in unison.
        const br = Math.sin(tNow * 1.7 + (u.id || 0) * 1.3);
        sqY = 1 + br * 0.022; sqX = 1 - br * 0.018;
        bobY = br * u.r * 0.03;
      }
    }

    // 공중 유닛 고도 — 살짝 떠 있는 듯한 부유 흔들림 (순수 연출: 그리기 위치만 움직이고
    // u.x/u.y는 그대로라 명령·피격 판정·동기화에 영향 없음)
    const bob = u.def.flying ? Math.sin(tNow * 2.6 + (u.id || 0) * 1.7) * 2.4 : 0;
    const alt = u.def.flying ? 15 + bob : 0;

    ctx.save();
    ctx.translate(u.x, u.y);

    // 그림자 (공중 유닛은 아래쪽에 더 흐리게)
    // A soft-edged blob instead of the old hard ellipse: a crisp shadow rim reads as a
    // decal stuck to the ground, while a diffuse one with a darker core is what makes the
    // unit look like it is standing ON the terrain rather than pasted over it.
    const shSpr = softGlow('0,0,0', [0.55, 0.55]);
    blitGlow(shSpr, 2, u.r * 0.78 + alt * 0.5, u.r * 1.5, u.r * 0.66, alt ? 0.20 : 0.34);
    ctx.globalAlpha = 1;

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
    // 궁극기로 소환된 임시 유닛 — 점선 링으로 "잠시 뒤 사라짐"을 알린다
    if (u.summoned || u.temp != null) {
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#a9ffc4'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.ellipse(0, oy, rx + 3.5, ry + 2, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 팀 구분 보조 링 (아군=파랑 / 적군=주황) — 내 유닛엔 없음
    const tc = teamColor(g, u.owner);
    if (tc) {
      ctx.strokeStyle = tc; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(0, oy, rx * 1.2, ry * 1.2, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // Aether — 유닛 발밑에 은은한 사이오닉 광원 (에너지 존재라는 인상)
    if (u.def.race === 'aether' && !flash) {
      const pp = 0.5 + 0.5 * Math.sin(tNow * 1.8 + (u.id || 0) * 0.9);
      blitGlow(softGlow('201,166,255'), 0, oy, rx * 1.35, ry * 1.5, 0.13 + 0.07 * pp);
    }
    ctx.restore();

    // 피격 움찔 — 몸체만 hurtDir 방향으로 살짝 밀린다 (발밑 원반은 제자리)
    if (u.hurt > 0) {
      const k = u.hurt * u.r * 0.38;
      ctx.translate(Math.cos(u.hurtDir) * k, Math.sin(u.hurtDir) * k);
    }

    // Bob and squash are applied in SCREEN space, before the facing rotation, so a
    // landing squashes downward no matter which way the unit happens to be looking.
    ctx.translate(0, -alt + bobY);
    if (sqX !== 1 || sqY !== 1) ctx.scale(sqX, sqY);
    ctx.rotate(u.facing);
    if (lunge) ctx.translate(lunge, 0);   // 공격 돌진/반동 (바라보는 방향 기준)
    // 공중 유닛 — 기체 후미의 엔진 광 (이동 중엔 더 길고 밝은 분사 꼬리)
    if (u.def.flying && !flash) {
      const eng = u.def.race === 'gloop' ? '125,255,158' : u.def.race === 'aether' ? '226,198,255' : '140,211,255';
      const R = u.r * 1.18;
      const pulse = 0.6 + 0.4 * Math.sin(tNow * 16 + (u.id || 0) * 2.1);
      const moving = u.state === 'move' || u.state === 'attack';
      const spr = softGlow(eng);
      blitGlow(spr, -R * 0.9, 0, R * 0.7, R * 0.7, 0.5 * pulse);
      // 분사 꼬리 — 이동 중엔 뒤로 길게 늘어난다
      if (moving) blitGlow(spr, -R * 1.6, 0, R * 1.53, R * 0.5, 0.28 * pulse);
      ctx.globalAlpha = 1;
    }
    // Hand the gait to the sprite layer. The Gloop creatures walk on legs, and a leg cycle
    // driven by wall-clock time makes a standing animal paddle the air; driven by distance
    // travelled it plants when the unit stops. Module-level because the draw functions take
    // only (R, c) — and render-only, so it can never desync a match.
    _ph = gaitPh; _walking = gaitOn;
    drawUnitSprite(u, c);

    ctx.restore();

    // 버프/디버프 표시 링 + 시전 섬광
    drawBuffs(u);

    // 영웅 표식 — 금색 링 + 레벨 배지 (+ 은은한 맥동 광채)
    if (u.hero) {
      ctx.save();
      const hp2 = 0.5 + 0.5 * Math.sin(tNow * 2.2);
      blitGlow(softGlow('255,210,63'), u.x, u.y + u.r * 0.5, u.r * 1.9, u.r * 0.95, 0.10 + 0.07 * hp2);
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(u.x, u.y + u.r * 0.5, u.r * 1.4, u.r * 0.64, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(10,16,22,0.9)';
      ctx.beginPath(); ctx.arc(u.x - u.r - 3, u.y - u.r - 3, 8.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffd23f'; ctx.font = 'bold 11px ui-monospace, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.level || 1), u.x - u.r - 3, u.y - u.r - 3);
      // Signature charge — an arc around the hero's feet, drawn on the SAME ellipse as
      // the gold hero ring so it reads as that ring filling up rather than as a second
      // ring competing with it. Full means the button is live.
      if (u.def.sig) {
        const c01 = Math.max(0, Math.min(1, u.charge || 0));
        const full = c01 >= 1;
        if (full) blitGlow(softGlow('79,214,232'), u.x, u.y + u.r * 0.5, u.r * 2.1, u.r * 1.05, 0.16 + 0.10 * hp2);
        ctx.globalAlpha = full ? 1 : 0.85;
        ctx.strokeStyle = full ? '#8ff4ff' : '#4fd6e8';
        ctx.lineWidth = full ? 3.4 : 2.6;
        ctx.beginPath();
        ctx.ellipse(u.x, u.y + u.r * 0.5, u.r * 1.4, u.r * 0.64, 0, -Math.PI / 2, -Math.PI / 2 + c01 * Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
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
    guardDome(u);
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
    // Kids mode "Big Guy" — a crown and a pulsing ring. The boss has five times the
    // health of its own card and is otherwise the SAME sprite, so without a marker a
    // kid has no way to tell which one is the special enemy and no reason to gang up
    // on it. The wave banner promises a big one; this is what makes good on it.
    if (u.kidsBoss) {
      ctx.save();
      const pulse = 0.72 + 0.28 * Math.sin(tNow * 4);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(u.x, u.y, u.r * 1.65, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = 'bold ' + Math.round(u.r * 1.5) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('👑', u.x, u.y - u.r - 20);
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
    if (u.haste > 0) ring('#ff6b57');           // 가속 = 빨강
    else if (u.auraArmorT > 0) {                // 장갑 오라 = 파란 실드 아크
      ctx.strokeStyle = '#6fd3ff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.25 * Math.sin(t * 5);
      ctx.beginPath(); ctx.arc(0, 0, u.r + 5, -Math.PI * 0.75, Math.PI * 0.75); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ── 동결 ── The one status that stops a unit dead, so it gets the loudest tell in
    // the game: a solid ice shell rather than a ring you have to look for.
    if (u.frozen > 0) {
      ctx.fillStyle = 'rgba(150,225,255,0.42)';
      ctx.beginPath(); ctx.arc(0, 0, u.r + 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#bff0ff'; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.4; ctx.globalAlpha = 0.8;
      for (let i = 0; i < 6; i++) {              // 성에 결정
        const a = i * (Math.PI / 3) + 0.3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * u.r * 0.35, Math.sin(a) * u.r * 0.35);
        ctx.lineTo(Math.cos(a) * (u.r + 2), Math.sin(a) * (u.r + 2));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (u.slow > 0 || u.chillStk > 0) {   // 둔화/냉기 = 하늘색 점선
      ctx.strokeStyle = u.chillStk > 0 ? '#8fd8ff' : '#c88bff';
      ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // ── 표식 ── Drawn as a bracket rather than another ring: mark is the one status that
    // is a message to the PLAYER ("hit this one"), not a thing happening to the unit.
    if (u.markT > 0) {
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.85;
      const rr = u.r + 7;
      for (let i = 0; i < 4; i++) {
        const a0 = i * (Math.PI / 2) + 0.25;
        ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 0.5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // ── 맹독 / 화상 ── Same maths as acid, so it gets the same shape and a different
    // hue: purple for venom, orange for fire. Three statuses that all mean "it is still
    // dying" should look related.
    if (u.venomStk > 0) {
      const k = Math.min(1, u.venomStk / 4);
      const hot = u.venomFire;
      ctx.strokeStyle = hot ? '#ffab4a' : '#c07dff';
      ctx.lineWidth = 1.5 + k * 1.5; ctx.globalAlpha = 0.35 + 0.45 * k;
      ctx.beginPath(); ctx.arc(0, 0, u.r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hot ? '#ff8a3d' : '#a25cff'; ctx.globalAlpha = 0.75;
      for (let i = 0; i < u.venomStk; i++) {
        const a = -t * 2.4 + i * (Math.PI * 2 / 4);
        ctx.beginPath(); ctx.arc(Math.cos(a) * (u.r + 6), Math.sin(a) * (u.r + 6), 1.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // ── 장갑 파쇄 ── Chips flaking off the outline. Reads as "its armour is coming apart"
    // without adding a fourth coloured ring to an already busy unit.
    if (u.shredStk > 0) {
      ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
      for (let i = 0; i < u.shredStk; i++) {
        const a = t * 1.1 + i * (Math.PI * 2 / 5);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (u.r + 1), Math.sin(a) * (u.r + 1));
        ctx.lineTo(Math.cos(a + 0.22) * (u.r + 5), Math.sin(a + 0.22) * (u.r + 5));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
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
    ctx.fillStyle = c.dark; rrect(-R * 0.9, -R * 1.0, R * 1.7, R * 0.32, 4); ctx.fill(); inkLine(c, R * 0.14);
    rrect(-R * 0.9, R * 0.68, R * 1.7, R * 0.32, 4); ctx.fill(); inkLine(c, R * 0.14);
    ctx.fillStyle = c.body; rrect(-R * 0.7, -R * 0.72, R * 1.35, R * 1.44, 5); ctx.fill(); inkLine(c, R * 0.2);
    celTop(c, -R * 0.66, -R * 0.66, R * 1.25, R * 0.42, 4);
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.moveTo(R * 0.55, -R * 0.28); ctx.lineTo(R * 1.3, -R * 0.1); ctx.lineTo(R * 1.3, R * 0.1); ctx.lineTo(R * 0.55, R * 0.28); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.16);
    ctx.strokeStyle = c.trim; ctx.lineWidth = R * 0.16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(R * 1.34, 0, R * 0.24, -2, 2); ctx.stroke();
    optic(c, R * 0.08, 0, R * 0.28);
  }

  // ── 볼트병 (보병) — 어깨 장갑 + 라이플 로봇 ──
  function drawVolt(R, c) {
    ctx.fillStyle = c.dark; rrect(-R * 0.95, -R * 0.5, R * 0.4, R * 1.0, 3); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.moveTo(-R * 0.62, -R * 0.66); ctx.lineTo(R * 0.5, -R * 0.6); ctx.lineTo(R * 0.66, 0); ctx.lineTo(R * 0.5, R * 0.6); ctx.lineTo(-R * 0.62, R * 0.66); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.dark;
    [-0.72, 0.72].forEach(function (s) { ctx.beginPath(); ctx.moveTo(-R * 0.35, s * R * 0.5); ctx.lineTo(R * 0.1, s * R * 0.95); ctx.lineTo(R * 0.35, s * R * 0.55); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.13); });
    ctx.fillStyle = c.steel; rrect(R * 0.2, -R * 0.66, R * 1.35, R * 0.2, 3); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.trim; ctx.fillRect(R * 1.4, -R * 0.68, R * 0.16, R * 0.24);
    visorSlit(c, R * 0.3, -R * 0.05, R * 0.4, R * 0.2);
  }

  // ── 실드러 (방패 탱커) — 무거운 장갑 + 대형 방패 ──
  function drawShielder(R, c) {
    // 무거운 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.8, -R * 1.02, R * 1.4, R * 0.42, 4); ctx.fill();
    rrect(-R * 0.8,  R * 0.6,  R * 1.4, R * 0.42, 4); ctx.fill();
    // 캐터필러 볼트
    ctx.fillStyle = shade(c._dark, 0.25);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(i * R * 0.28, -R * 0.81, R * 0.06, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(i * R * 0.28,  R * 0.81, R * 0.06, 0, Math.PI * 2); ctx.fill();
    }
    // 몸체
    ctx.fillStyle = c.body;
    rrect(-R * 0.75, -R * 0.78, R * 1.4, R * 1.56, 6); ctx.fill(); inkLine(c, R * 0.22);
    celTop(c, -R * 0.7, -R * 0.72, R * 1.3, R * 0.44, 5);
    // 대형 방패 (앞면, 각진 모서리)
    ctx.fillStyle = c.steel;
    ctx.beginPath(); ctx.moveTo(R * 0.45, -R * 1.05); ctx.lineTo(R * 1.05, -R * 0.85); ctx.lineTo(R * 1.05, R * 0.85); ctx.lineTo(R * 0.45, R * 1.05); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.22);
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.moveTo(R * 0.75, -R * 0.35); ctx.lineTo(R * 0.92, 0); ctx.lineTo(R * 0.75, R * 0.35); ctx.lineTo(R * 0.58, 0); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.1);
    visorSlit(c, -R * 0.1, -R * 0.02, R * 0.42, R * 0.18);
  }

  // ── 스파크캐논 (공성) — 궤도 위 대형 포신 ──
  function drawSpark(R, c) {
    // 캐터필러
    ctx.fillStyle = c.dark;
    rrect(-R * 0.75, -R * 0.95, R * 1.35, R * 0.4, 4); ctx.fill();
    rrect(-R * 0.75,  R * 0.55, R * 1.35, R * 0.4, 4); ctx.fill();
    ctx.fillStyle = shade(c._dark, 0.25);
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.arc(i * R * 0.26, -R * 0.75, R * 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(i * R * 0.26,  R * 0.75, R * 0.055, 0, Math.PI * 2); ctx.fill();
    }
    // 차체
    ctx.fillStyle = c.body; rrect(-R * 0.66, -R * 0.58, R * 1.1, R * 1.16, 5); ctx.fill(); inkLine(c, R * 0.2);
    celTop(c, -R * 0.62, -R * 0.52, R * 1.0, R * 0.36, 4);
    // 포탑 베이스
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.4, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.16);
    // 대형 포신
    ctx.fillStyle = c.steel; rrect(R * 0.1, -R * 0.19, R * 1.55, R * 0.38, 3); ctx.fill(); inkLine(c, R * 0.18);
    ctx.fillStyle = c.ink; rrect(R * 1.5, -R * 0.24, R * 0.2, R * 0.48, 3); ctx.fill();   // 포구
    sglow(R * 1.6, 0, R * 0.5, c.opticRGB, 0.6);
    optic(c, 0, 0, R * 0.24);
  }

  // ── 호버윙 (공중) — 회전 로터 달린 비행체 ──
  function drawHover(R, c) {
    const spin = performance.now() / 40;
    // 로터 (양옆, 회전하는 날)
    ctx.strokeStyle = shade(c._body, -0.1); ctx.lineWidth = 1.6;
    [[-R * 0.15, -R * 0.75], [-R * 0.15, R * 0.75]].forEach(([px, py]) => {
      ctx.fillStyle = c.dark;
      ctx.beginPath(); ctx.arc(px, py, R * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.translate(px, py); ctx.rotate(spin);
      ctx.strokeStyle = shade(c._light, 0.1); ctx.lineWidth = 2;
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
    ctx.moveTo(R * 1.18, 0);
    ctx.lineTo(R * 0.1, -R * 0.52);
    ctx.lineTo(-R * 0.7, -R * 0.3);
    ctx.lineTo(-R * 0.7, R * 0.3);
    ctx.lineTo(R * 0.1, R * 0.52);
    ctx.closePath(); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.light; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(R * 1.1, 0); ctx.lineTo(R * 0.1, -R * 0.5); ctx.lineTo(-R * 0.2, -R * 0.14); ctx.lineTo(R * 0.3, 0); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    optic(c, R * 0.42, 0, R * 0.22);
  }

  // ── 패치봇 (정비 지원) — 둥근 몸체 + 십자 + 스프레이 노즐 ──
  function drawPatch(R, c) {
    ctx.fillStyle = c.dark; rrect(-R * 0.8, -R * 0.92, R * 1.5, R * 0.3, 3); ctx.fill(); inkLine(c, R * 0.13);
    rrect(-R * 0.8, R * 0.62, R * 1.5, R * 0.3, 3); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.body; ctx.beginPath(); ctx.arc(0, 0, R * 0.8, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.light; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(-R * 0.22, -R * 0.24, R * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#eef6ff'; ctx.beginPath(); ctx.arc(0, 0, R * 0.44, 0, Math.PI * 2); ctx.fill(); inkLine(c, R * 0.12);
    ctx.fillStyle = C.heal; ctx.fillRect(-R * 0.1, -R * 0.34, R * 0.2, R * 0.68); ctx.fillRect(-R * 0.34, -R * 0.1, R * 0.68, R * 0.2);
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.moveTo(R * 0.6, -R * 0.16); ctx.lineTo(R * 1.15, -R * 0.05); ctx.lineTo(R * 1.15, R * 0.05); ctx.lineTo(R * 0.6, R * 0.16); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.13);
    optic(c, R * 0.95, 0, R * 0.15);
  }

  // ── 펄스코일 (교란 캐스터) — 삼각 동체 + 상단 코일 안테나 ──
  function drawPulse(R, c) {
    const t = performance.now() / 1000;
    ctx.fillStyle = c.dark; rrect(-R * 0.75, -R * 0.9, R * 1.4, R * 0.3, 3); ctx.fill(); inkLine(c, R * 0.13);
    rrect(-R * 0.75, R * 0.6, R * 1.4, R * 0.3, 3); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.body; ctx.beginPath(); ctx.moveTo(R * 0.98, 0); ctx.lineTo(-R * 0.6, -R * 0.64); ctx.lineTo(-R * 0.6, R * 0.64); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.light; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(R * 0.9, 0); ctx.lineTo(-R * 0.55, -R * 0.6); ctx.lineTo(-R * 0.2, -R * 0.12); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.28, 0, Math.PI * 2); ctx.fill();
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(t * 5));
    ctx.globalAlpha = pulse; ctx.fillStyle = '#8fe3ff'; ctx.beginPath(); ctx.arc(-R * 0.05, 0, R * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#bfefff'; ctx.lineWidth = 1.6;
    for (let k = 0; k < 4; k++) { const a = t * 2 + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(-R * 0.05, 0); ctx.lineTo(-R * 0.05 + Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55); ctx.stroke(); }
    ctx.globalAlpha = 1;
    optic(c, R * 0.52, 0, R * 0.15);
  }

  // ── 래틀러 헬기 — 로터 + 로켓 포드 ──
  function drawHeli(R, c) {
    const spin = performance.now() / 22;
    ctx.fillStyle = c.dark; rrect(-R * 1.15, -R * 0.12, R * 0.9, R * 0.24, 3); ctx.fill(); inkLine(c, R * 0.1);
    ctx.save(); ctx.translate(-R * 1.15, 0); ctx.rotate(spin * 1.4);
    ctx.strokeStyle = c.trim; ctx.lineWidth = R * 0.1; ctx.beginPath(); ctx.moveTo(0, -R * 0.3); ctx.lineTo(0, R * 0.3); ctx.stroke(); ctx.restore();
    ctx.fillStyle = c.body; ctx.beginPath(); ctx.moveTo(R * 1.0, 0); ctx.lineTo(R * 0.2, -R * 0.56); ctx.lineTo(-R * 0.55, -R * 0.4); ctx.lineTo(-R * 0.55, R * 0.4); ctx.lineTo(R * 0.2, R * 0.56); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.dark; rrect(-R * 0.1, -R * 0.68, R * 0.5, R * 0.18, 2); ctx.fill(); inkLine(c, R * 0.11);
    rrect(-R * 0.1, R * 0.5, R * 0.5, R * 0.18, 2); ctx.fill(); inkLine(c, R * 0.11);
    optic(c, R * 0.4, 0, R * 0.18);
    ctx.save(); ctx.rotate(spin);
    ctx.strokeStyle = shade(c._light, 0.1); ctx.lineWidth = R * 0.09;
    ctx.beginPath(); ctx.moveTo(-R * 1.1, 0); ctx.lineTo(R * 1.1, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -R * 1.1); ctx.lineTo(0, R * 1.1); ctx.stroke(); ctx.restore();
    ctx.fillStyle = c.trim; ctx.beginPath(); ctx.arc(0, 0, R * 0.12, 0, Math.PI * 2); ctx.fill();
  }

  // ── 팰컨 제트 — 날카로운 화살형 전투기 ──
  function drawJet(R, c) {
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.moveTo(-R * 0.1, 0); ctx.lineTo(-R * 0.6, -R * 0.9); ctx.lineTo(-R * 0.2, -R * 0.15); ctx.lineTo(-R * 0.2, R * 0.15); ctx.lineTo(-R * 0.6, R * 0.9); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.13);
    ctx.fillStyle = c.body; ctx.beginPath(); ctx.moveTo(R * 1.28, 0); ctx.lineTo(-R * 0.2, -R * 0.28); ctx.lineTo(-R * 0.7, -R * 0.16); ctx.lineTo(-R * 0.7, R * 0.16); ctx.lineTo(-R * 0.2, R * 0.28); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.light; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(R * 1.2, 0); ctx.lineTo(-R * 0.2, -R * 0.26); ctx.lineTo(R * 0.2, 0); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    optic(c, R * 0.5, 0, R * 0.16);
    ctx.fillStyle = c.trim; ctx.beginPath(); ctx.moveTo(-R * 0.7, -R * 0.1); ctx.lineTo(-R * 1.05, 0); ctx.lineTo(-R * 0.7, R * 0.1); ctx.closePath(); ctx.fill();
  }

  // ── 페리 수송선 — 넓적한 화물 왕복선 ──
  function drawDropship(R, c) {
    ctx.fillStyle = c.dark; rrect(-R * 0.85, -R * 0.6, R * 1.7, R * 1.2, 8); ctx.fill(); inkLine(c, R * 0.2);
    ctx.fillStyle = c.body; rrect(-R * 0.75, -R * 0.5, R * 1.5, R * 1.0, 7); ctx.fill(); inkLine(c, R * 0.16);
    celTop(c, -R * 0.75, -R * 0.5, R * 1.5, R * 0.34, 7);
    ctx.fillStyle = c.dark; ctx.beginPath(); ctx.moveTo(R * 0.75, -R * 0.42); ctx.lineTo(R * 1.15, 0); ctx.lineTo(R * 0.75, R * 0.42); ctx.closePath(); ctx.fill(); inkLine(c, R * 0.14);
    optic(c, R * 0.82, 0, R * 0.16);
    ctx.fillStyle = c.trim; rrect(-R * 0.5, -R * 0.74, R * 0.5, R * 0.2, 3); ctx.fill(); inkLine(c, R * 0.11);
    rrect(-R * 0.5, R * 0.54, R * 0.5, R * 0.2, 3); ctx.fill(); inkLine(c, R * 0.11);
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
    // 굵은 잉크 외곽선 — the thin 2px rim read as a technical stroke next to the
    // heavy outlines the units now carry. Gloop keeps a darker, organic ink.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = mix(GLOOP_TINT, '#050c09', 0.55);
    ctx.lineWidth = Math.max(4, b.w * 0.065);
    rrect(x, y, b.w, b.h, rad); ctx.stroke();
  }
  // ══ 외계 동물 해부학 (글룹 공용) ═══════════════════════════════════════════
  // The swarm used to be wobbling blobs with a single eye stuck on the front, which read as
  // slime rather than as living things. These primitives are what turn them into ANIMALS:
  // limbs that plant and push against the ground, jaws that open, vertical slit pupils,
  // segmented chitin, whipping tails. Everything fills from the volumetric palette, so the
  // creatures pick up the same rendered shading as the machines.
  let _ph = 0, _walking = false;      // 보행 위상 / 실제로 움직이는 중인지 (drawUnit이 설정)

  // 울렁이는 살덩이 외곽 — 정점을 시간에 따라 흔들고 중점 보간으로 매끄럽게 잇는다.
  // cx/cy로 몸통을 앞뒤로 밀 수 있고 ky로 납작하게 눌러, 하나의 함수로 흉부·복부·머리를
  // 모두 만든다. 정점 버퍼는 미리 할당해 둔다 — 매 프레임 수천 개의 배열을 새로 만들면
  // 그리기보다 GC가 더 비싸진다.
  const _bp = new Float64Array(40);
  function blob(R, wob, seed, cx, cy, ky) {
    const t = performance.now() / 380 + seed;
    const n = 14; cx = cx || 0; cy = cy || 0; ky = (ky == null) ? 1 : ky;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = R * (1 + Math.sin(a * 3 + t) * wob + Math.cos(a * 2 - t * 0.7) * wob * 0.6);
      _bp[i * 2] = cx + Math.cos(a) * rr;
      _bp[i * 2 + 1] = cy + Math.sin(a) * rr * ky;
    }
    ctx.beginPath();
    ctx.moveTo((_bp[(n - 1) * 2] + _bp[0]) / 2, (_bp[(n - 1) * 2 + 1] + _bp[1]) / 2);
    for (let i = 0; i < n; i++) {
      const j = ((i + 1) % n) * 2;
      ctx.quadraticCurveTo(_bp[i * 2], _bp[i * 2 + 1], (_bp[i * 2] + _bp[j]) / 2, (_bp[i * 2 + 1] + _bp[j + 1]) / 2);
    }
    ctx.closePath();
  }

  // 살갗 한 겹 — 어두운 아래층, 본체, 유기적 잉크 외곽선.
  // 굵은 외곽선이 글룹에 없던 "그려진 그림" 느낌을 만든다.
  function hide(R, c, rad, wob, seed, cx, cy, ky) {
    ctx.fillStyle = c.dark; blob(rad * 1.07, wob, seed, cx, cy, ky); ctx.fill();
    ctx.fillStyle = c.body; blob(rad, wob, seed, cx, cy, ky); ctx.fill();
    inkLine(c, R * 0.07);
  }

  // 키틴 — 껍질·왕관·등판에 쓰는 어두운 각질색. c.steel(차가운 금속빛)을 그대로 쓰면
  // 유기체에 강판을 붙인 것처럼 보여서, 소유자 색을 어둡게 깔고 이끼빛을 섞는다.
  function chitin(c, R) { return volGrad(shade(mix(c._dark, '#1b2a1a', 0.55), -0.18), R); }
  const BONE = '#e8f0d6';        // 이빨·발톱·뿔 — 살보다 밝아야 아가리가 읽힌다
  const BONE_DIM = '#a8b894';    // 등가시 끝 — 이빨만큼 밝으면 등에 이빨이 난 것처럼 보인다
  // 사지·턱·날개막은 그라디언트를 쓰지 않는다. 광원이 스프라이트 왼쪽 위에 있으니, 가는
  // 부속지에 같은 그라디언트를 물리면 왼쪽 다리는 하이라이트를 받아 밝게 떠 버리고 실루엣이
  // 무너진다. 덩어리(몸통·머리)만 입체로 칠하고 부속지는 납작한 어두운 색으로 받친다 —
  // 일러스트에서 팔다리를 어둡게 깔아 몸통을 앞으로 밀어내는 것과 같은 이유다.
  function limbCol(c) { return mix(c._dark, '#0a1611', 0.36); }

  // 마디진 몸통 — 뒤에서 앞으로 겹쳐 놓은 여러 개의 살덩이.
  // 하나의 큰 덩이로 그리면 아무리 잘 칠해도 '다리 달린 공'으로 읽힌다. 크기가 줄어드는
  // 덩이를 겹쳐 놓는 것만으로 흉부와 복부가 생기고, 어디가 앞인지가 형태만으로 드러난다.
  // 뒤쪽 마디부터 그려서 앞 마디가 위로 올라오게 한다.
  function segBody(R, c, n, xr, xf, radR, radF, wob, seed, ky) {
    const rad = (i) => R * (radR + (radF - radR) * ((n === 1) ? 0 : i / (n - 1)));
    const cx  = (i) => R * (xr + (xf - xr) * ((n === 1) ? 0 : i / (n - 1)));
    // 외곽선은 '조금 더 큰 어두운 덩이'로 만든다. 마디마다 선을 두르면 앞 마디의 닫힌
    // 테두리가 뒤 마디 위에 검은 초승달로 남아 몸에 구멍이 뚫린 것처럼 보인다. 칠해서
    // 겹친 도형은 내부 경계가 사라지므로, 밑층을 전부 깐 뒤 살색을 전부 얹는다.
    ctx.fillStyle = c.dark;
    for (let i = 0; i < n; i++) { blob(rad(i) * 1.09, wob, seed + i * 3.7, cx(i), 0, ky); ctx.fill(); }
    ctx.fillStyle = c.body;
    for (let i = 0; i < n; i++) { blob(rad(i), wob, seed + i * 3.7, cx(i), 0, ky); ctx.fill(); }
    // 마디 이음매 — 뒤쪽을 향한 짧은 호만 그린다. 닫힌 원이 아니라 주름으로 읽힌다.
    ctx.strokeStyle = c.ink; ctx.globalAlpha = 0.38; ctx.lineWidth = R * 0.055; ctx.lineCap = 'round';
    for (let i = 1; i < n; i++) {
      ctx.beginPath();
      ctx.ellipse(cx(i), 0, rad(i) * 0.97, rad(i) * 0.97 * ky, 0, Math.PI * 0.60, Math.PI * 1.40);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 젖은 표면 반사 — 점액질 생물이라는 인상을 주는 하이라이트
  function gloss(x, y, rx, ry, rot, a) {
    ctx.globalAlpha = (a == null) ? 0.30 : a;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot || 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 생체발광 낭 — 산성 체액이 차 있는 반투명 주머니
  function sac(x, y, r, a) {
    const k = (a == null) ? 1 : a;
    sglow(x, y, r * 2.5, '150,255,90', 0.28 * k);
    ctx.globalAlpha = 0.70 * k; ctx.fillStyle = ACID;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.55 * k; ctx.fillStyle = '#f2ffdc';
    ctx.beginPath(); ctx.arc(x - r * 0.30, y - r * 0.33, r * 0.36, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 수직 동공을 가진 짐승 눈 — 이 종족이 기계가 아니라 생물임을 알리는 가장 강한 신호.
  // 둥근 광학 렌즈(optic)와 나란히 두면 차이가 한눈에 보인다.
  function beastEye(c, x, y, r, tilt) {
    r *= EYE * 0.92;
    sglow(x, y, r * 1.7, c.opticRGB, 0.30);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = c.ink; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r * 0.76, 0, TAU); ctx.fillStyle = c.eye; ctx.fill();
    ctx.fillStyle = c.ink;                                   // 수직으로 째진 동공
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.20, r * 0.62, tilt || 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.fillStyle = '#ffffff';        // 촉촉한 반사광
    ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.34, r * 0.20, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 송곳니 한 개 — (px,py)에서 ang 방향으로 뻗은 삼각 이빨
  function fang(px, py, ang, len, wid, col) {
    ctx.fillStyle = col || BONE;
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(ang + 1.5708) * wid, py + Math.sin(ang + 1.5708) * wid);
    ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
    ctx.lineTo(px + Math.cos(ang - 1.5708) * wid, py + Math.sin(ang - 1.5708) * wid);
    ctx.closePath(); ctx.fill();
  }
  // 턱선(along)을 따라 박힌 이빨 줄. point는 이빨이 향하는 방향 — 위턱과 아래턱의 이빨은
  // 서로 아가리 안쪽을 향해야 한다. 부호를 잘못 주면 이빨이 밖으로 뻗쳐 수염처럼 보인다.
  function fangRow(x, y, along, point, span, n, len, wid, col) {
    for (let i = 0; i < n; i++) {
      const d = span * ((n === 1) ? 0.5 : i / (n - 1));
      fang(x + Math.cos(along) * d, y + Math.sin(along) * d, point, len, wid, col);
    }
  }

  // 다리 한 짝 — 무릎에서 꺾이고 발끝으로 갈수록 얇아지며, 발톱이 두 갈래로 벌어진다.
  // 변형(transform) 없이 그리는 게 중요하다: 그라디언트는 사용 시점의 좌표계에서 평가되므로
  // 여기서 회전시키면 사지마다 광원이 따로 놀게 된다.
  function limb(hx, hy, kx, ky, fx, fy, w, col, claw) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = col;
    ctx.lineWidth = w;         ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = w * 0.60;  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    if (claw) {
      const a = Math.atan2(fy - ky, fx - kx);
      ctx.lineWidth = w * 0.26;
      for (let s = -1; s <= 1; s += 2) {
        ctx.beginPath(); ctx.moveTo(fx, fy);
        ctx.lineTo(fx + Math.cos(a + s * 0.55) * w * 1.15, fy + Math.sin(a + s * 0.55) * w * 1.15);
        ctx.stroke();
      }
    }
  }

  // 다리 여러 쌍 — 좌우가 엇갈리는 교대 보행. 멈추면 발이 땅에 붙는다.
  // 무릎은 앞쪽 바깥으로, 발은 다시 뒤로 쓸린다. 무릎과 발을 같은 방향으로 뻗으면 다리가
  // 아니라 더듬이처럼 보인다 — 꺾이는 방향이 곤충 다리를 만든다.
  function legs(R, c, n, x0, x1, spread, w, reach) {
    const amp = _walking ? 1 : 0.20;
    reach = (reach == null) ? -0.12 : reach;
    const col = limbCol(c);
    for (let i = 0; i < n; i++) {
      const bx = R * (x0 + (x1 - x0) * ((n === 1) ? 0 : i / (n - 1)));
      for (let s = -1; s <= 1; s += 2) {
        const sw = Math.sin(_ph + i * 2.1 + (s > 0 ? Math.PI : 0)) * amp;
        const lift = Math.max(0, sw) * R * 0.10;          // 들어올린 발은 안쪽으로 당겨진다
        limb(bx, s * R * 0.20,
             bx + R * 0.24 + sw * R * 0.14, s * (R * spread * 0.66 - lift),
             bx + R * reach + sw * R * 0.40, s * (R * spread - lift),
             R * w, col, true);
      }
    }
  }

  // 등을 따라 솟은 가시 — 실루엣을 톱니처럼 만들어 멀리서도 위협적으로 읽힌다.
  // 뼈색으로 칠한다: 살색과 같은 색이면 30px 스프라이트에서 몸통에 묻혀 사라진다.
  // 가시는 등마루(flank)에서 바깥으로 솟아야 한다. 몸통 중심에서 그리면 등에 난 뿔이 아니라
  // 배에서 자란 창처럼 보인다. base는 가시가 박히는 옆구리 높이.
  function spines(R, c, x0, x1, n, len, base) {
    const by = R * (base == null ? 0.28 : base);
    for (let i = 0; i < n; i++) {
      const k = (n === 1) ? 0.5 : i / (n - 1);
      const px = R * (x0 + (x1 - x0) * k);
      const h = by + R * len * (0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.76 * k)));
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.moveTo(px - R * 0.075, -by * 0.55);
      ctx.lineTo(px + R * 0.02, -h);
      ctx.lineTo(px + R * 0.095, -by * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = BONE_DIM;                  // 가시 끝만 뼈색 — 톱니 실루엣이 살아난다
      ctx.beginPath();
      ctx.moveTo(px - R * 0.040, -(h - (h - by) * 0.34));
      ctx.lineTo(px + R * 0.02, -h);
      ctx.lineTo(px + R * 0.055, -(h - (h - by) * 0.34));
      ctx.closePath(); ctx.fill();
    }
  }

  // 체절 능선 — 껍질을 가로지르는 갈비 선. 한 덩이 살을 마디진 몸으로 보이게 한다.
  // 선이 많거나 진하면 마디가 아니라 줄무늬 공처럼 보인다 — 적게, 옅게.
  function segRibs(R, c, x0, x1, n, hw, w, alpha) {
    ctx.strokeStyle = c.ink; ctx.lineCap = 'round';
    ctx.lineWidth = R * w; ctx.globalAlpha = (alpha == null) ? 0.26 : alpha;
    for (let i = 0; i < n; i++) {
      const k = (n === 1) ? 0.5 : i / (n - 1);
      const px = R * (x0 + (x1 - x0) * k);
      const h = R * hw * (0.5 + 0.5 * Math.sin(Math.PI * (0.16 + 0.7 * k)));
      ctx.beginPath(); ctx.moveTo(px, -h); ctx.quadraticCurveTo(px + R * 0.10, 0, px, h); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 꼬리 — 뒤로 뻗으며 좌우로 휘두른다 (마디마다 얇아진다)
  function tail(R, c, len, w, seg, from) {
    const sway = Math.sin(_ph * 0.5 + 0.7) * (_walking ? 0.44 : 0.18);
    ctx.strokeStyle = limbCol(c); ctx.lineCap = 'round';
    let px = R * (from == null ? -0.45 : from), py = 0, ang = Math.PI;
    const step = R * len / seg;
    for (let i = 0; i < seg; i++) {
      ang += sway * 0.34;
      const nx = px + Math.cos(ang) * step, ny = py + Math.sin(ang) * step;
      ctx.lineWidth = R * w * (1 - (i / seg) * 0.82);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny;
    }
    return [px, py];
  }

  // 늘어진 촉수 — 물결치며 흔들린다
  function tentacle(x, y, ang, len, w, phase, col, seg) {
    const t = performance.now() / 300 + phase;
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    let px = x, py = y, a = ang;
    const step = len / seg;
    for (let i = 0; i < seg; i++) {
      a += Math.sin(t + i * 0.9) * 0.30;
      const nx = px + Math.cos(a) * step, ny = py + Math.sin(a) * step;
      ctx.lineWidth = w * (1 - (i / seg) * 0.75);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
      px = nx; py = ny;
    }
  }

  // 두개골 윤곽 — 뒤통수는 넓고 주둥이로 갈수록 좁아지는 쐐기.
  // 위에서 내려다본 짐승 머리는 타원이 아니다. 타원으로 그리면 눈 두 개가 얼굴 정면에
  // 나란히 붙은 것처럼 보여 방향을 읽을 수 없다. 좁아지는 주둥이가 곧 시선의 방향이다.
  function skullWedge(x, y, ang, s, back, halfw) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const px = (f, l) => [x + ca * f * s - sa * l * s, y + sa * f * s + ca * l * s];
    const a = px(-back, -halfw), b = px(0.30, -halfw * 0.86), tip = px(1.15, 0);
    const d = px(0.30, halfw * 0.86), e = px(-back, halfw), f = px(-back * 1.55, 0);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(b[0], b[1], tip[0], tip[1]);
    ctx.quadraticCurveTo(d[0], d[1], e[0], e[1]);
    ctx.quadraticCurveTo(f[0], f[1], a[0], a[1]);
    ctx.closePath();
  }

  // 아가리 있는 머리 — 두개골 + 벌어지는 위/아래 턱 + 이빨 + 짐승 눈.
  // (x,y)를 중심으로 ang 방향을 물어뜯는다. open은 턱이 벌어진 각도.
  // 필드에서 이 머리는 15px 남짓이다. 그래서 이빨은 턱마다 두 개, 혀는 옵션, 콧구멍은 없다 —
  // 작게 줄었을 때 살아남는 건 '벌어진 밝은 아가리 + 노려보는 눈' 뿐이다.
  function beastHead(R, c, x, y, ang, s, open, tongue) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const jx = x + ca * s * 0.30, jy = y + sa * s * 0.30;        // 턱 관절
    // 벌어진 아가리 속 — 어두운 목구멍에 산성 체액이 고여 있다
    ctx.fillStyle = c.ink;
    ctx.beginPath(); ctx.ellipse(x + ca * s * 0.95, y + sa * s * 0.95, s * 1.05, s * 0.80, ang, 0, TAU); ctx.fill();
    sac(x + ca * s * 1.00, y + sa * s * 1.00, s * 0.34, 0.9);
    if (tongue) {                                               // 두 갈래 혀
      const wig = Math.sin(performance.now() / 130) * 0.28;
      ctx.strokeStyle = '#ff7a9c'; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round';
      for (let k = -1; k <= 1; k += 2) {
        ctx.beginPath();
        ctx.moveTo(x + ca * s * 0.95, y + sa * s * 0.95);
        ctx.lineTo(x + Math.cos(ang + wig + k * 0.30) * s * 2.1, y + Math.sin(ang + wig + k * 0.30) * s * 2.1);
        ctx.stroke();
      }
    }
    // 위/아래 턱 — 벌어질수록 넓은 쐐기로 열린다. 두개골보다 훨씬 앞으로 나가야
    // 뒤에 그려지는 두개골에 먹히지 않는다 (아가리가 사라지는 가장 흔한 원인).
    const jawCol = limbCol(c);
    for (let k = -1; k <= 1; k += 2) {
      const a2 = ang + k * (open + 0.22);
      const px = Math.cos(a2 + k * 1.5708), py = Math.sin(a2 + k * 1.5708);
      ctx.fillStyle = jawCol;
      ctx.beginPath();
      ctx.moveTo(jx + px * s * 0.58, jy + py * s * 0.58);
      ctx.lineTo(jx + Math.cos(a2) * s * 2.05, jy + Math.sin(a2) * s * 2.05);
      ctx.lineTo(jx - px * s * 0.14, jy - py * s * 0.14);
      ctx.closePath(); ctx.fill();
      fangRow(jx + Math.cos(a2) * s * 0.95, jy + Math.sin(a2) * s * 0.95,
              a2, a2 - k * 1.5708, s * 0.85, 2, s * 0.42, s * 0.13, BONE);
    }
    // 두개골 — 좁아지는 주둥이가 얼굴 방향을 만든다
    ctx.fillStyle = c.dark; skullWedge(x, y, ang, s, 0.80, 0.86); ctx.fill();
    inkLine(c, R * 0.05);
    ctx.fillStyle = c.body; skullWedge(x - ca * s * 0.06, y - sa * s * 0.06, ang, s * 0.86, 0.78, 0.82); ctx.fill();
    gloss(x - ca * s * 0.30, y - sa * s * 0.26, s * 0.30, s * 0.13, ang, 0.22);
    // 눈 — 뒤통수 양옆에 얕게 박힌다. 크고 앞쪽에 두면 머리 전체가 눈으로 덮여 아가리가 사라진다.
    for (let k = -1; k <= 1; k += 2) {
      beastEye(c, x - ca * s * 0.26 - sa * s * k * 0.46, y - sa * s * 0.26 + ca * s * k * 0.46, s * 0.19, ang);
    }
  }

  // ── 슬러그 (일꾼) — 껍질을 짊어진 외계 복족류. 촉수로 광석을 녹여 빨아들인다 ──
  function drawSlug(R, c) {
    const t = performance.now() / 700;
    legs(R, c, 3, 0.30, -0.54, 0.72, 0.135, 0.04);      // 짧고 많은 관족
    tail(R, c, 0.5, 0.18, 3, -0.62);
    // 넓적한 몸통 — 뒤가 크고 앞이 작은 두 마디
    segBody(R, c, 2, -0.30, 0.16, 0.60, 0.44, 0.07, 0, 1.06);
    segRibs(R, c, -0.44, 0.10, 3, 0.48, 0.055);
    // 등껍질 — 일꾼만의 실루엣. 마디진 돔이라 전투 유닛과 확실히 구분된다.
    ctx.fillStyle = c.dark;
    ctx.beginPath(); ctx.ellipse(-R * 0.28, -R * 0.10, R * 0.58, R * 0.48, -0.24, 0, TAU); ctx.fill();
    inkLine(c, R * 0.06);
    ctx.fillStyle = chitin(c, R);
    ctx.beginPath(); ctx.ellipse(-R * 0.30, -R * 0.13, R * 0.47, R * 0.37, -0.24, 0, TAU); ctx.fill();
    // 성장 능선 — 껍질 정점에서 뻗어나온 방사 갈비. 동심원이나 나선은 과녁·웃는 입으로 읽힌다.
    ctx.strokeStyle = c.ink; ctx.globalAlpha = 0.24; ctx.lineWidth = R * 0.045; ctx.lineCap = 'round';
    for (let i = -1; i <= 2; i++) {
      const a = -0.24 + i * 0.7;
      ctx.beginPath();
      ctx.moveTo(-R * 0.30 + Math.cos(a) * R * 0.10, -R * 0.13 + Math.sin(a) * R * 0.08);
      ctx.lineTo(-R * 0.30 + Math.cos(a) * R * 0.36, -R * 0.13 + Math.sin(a) * R * 0.28);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    gloss(-R * 0.46, -R * 0.28, R * 0.14, R * 0.07, -0.5, 0.24);
    sac(-R * 0.62, R * 0.10, R * 0.09, 0.45 + 0.2 * Math.sin(t * 2));   // 껍질 틈의 산성 저장낭
    // 작은 머리 + 채집 촉수 (광석을 녹여 빨아들인다)
    ctx.fillStyle = c.dark; skullWedge(R * 0.54, 0, 0, R * 0.28, 0.72, 0.86); ctx.fill();
    inkLine(c, R * 0.05);
    ctx.fillStyle = c.body; skullWedge(R * 0.52, -R * 0.02, 0, R * 0.24, 0.70, 0.82); ctx.fill();
    tentacle(R * 0.82, 0, -0.10, R * 0.46, R * 0.19, 0, limbCol(c), 3);
    sac(R * 1.20, -R * 0.06, R * 0.13, 0.9);
    // 눈자루 두 가닥 — 머리에 붙은 짧고 굵은 자루라야 몸의 일부로 읽힌다
    for (let s = -1; s <= 1; s += 2) {
      const wob = Math.sin(t * 1.6 + s) * R * 0.05;
      ctx.strokeStyle = limbCol(c); ctx.lineWidth = R * 0.13; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(R * 0.44, s * R * 0.14);
      ctx.quadraticCurveTo(R * 0.60, s * R * 0.34, R * 0.56, s * R * 0.42 + wob);
      ctx.stroke();
      beastEye(c, R * 0.56, s * R * 0.44 + wob, R * 0.12, 1.4);
    }
  }

  // ── 글로블링 (스웜 근접) — 네 발로 달려드는 외계 사냥개 ──
  function drawGlobling(R, c) {
    const t = performance.now() / 200;
    const snap = 0.52 + 0.22 * Math.sin(t * 1.6);       // 계속 씹어대는 아가리
    legs(R, c, 2, 0.30, -0.44, 0.74, 0.165, 0.14);
    tail(R, c, 0.90, 0.20, 4, -0.5);
    // 목 — 몸통보다 먼저 깔아야 어깨에 묻힌다. 나중에 그리면 등판에 검은 막대가 남는다.
    ctx.strokeStyle = limbCol(c); ctx.lineWidth = R * 0.32; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(R * 0.10, 0); ctx.lineTo(R * 0.56, 0); ctx.stroke();
    // 낮게 웅크린 몸통 — 뒤가 크고 어깨가 작은 두 마디 (개처럼 달리는 실루엣)
    segBody(R, c, 2, -0.34, 0.14, 0.52, 0.40, 0.10, 7, 0.86);
    segRibs(R, c, -0.44, 0.02, 3, 0.40, 0.055);
    gloss(-R * 0.34, -R * 0.22, R * 0.22, R * 0.09, -0.4, 0.26);
    spines(R, c, -0.50, 0.04, 4, 0.24, 0.30);          // 옆구리에서 솟은 등 가시
    beastHead(R, c, R * 0.82, 0, 0, R * 0.40, snap, false);
  }

  // ── 스피터 (원거리) — 목을 치켜들고 산을 뱉는 외계 도마뱀 ──
  function drawSpitter(R, c) {
    const t = performance.now() / 420;
    const swell = 0.86 + 0.22 * Math.sin(t * 1.4);      // 부풀었다 꺼지는 목주머니
    legs(R, c, 2, -0.06, -0.48, 0.82, 0.16, 0.00);      // 뒷다리 두 쌍이 몸을 받친다
    tail(R, c, 1.0, 0.20, 4, -0.55);
    // 뒤로 앉은 몸통 — 두 마디
    segBody(R, c, 2, -0.40, 0.04, 0.52, 0.42, 0.08, 3, 0.96);
    segRibs(R, c, -0.50, -0.04, 3, 0.44, 0.055);
    gloss(-R * 0.40, -R * 0.26, R * 0.22, R * 0.09, -0.4, 0.26);
    // 앞발 — 짧게 접혀 가슴에 붙는다
    for (let s = -1; s <= 1; s += 2) {
      limb(R * 0.14, s * R * 0.22, R * 0.42, s * R * 0.38, R * 0.60, s * R * 0.22, R * 0.115, limbCol(c), true);
    }
    // 치켜든 목 + 부푼 산성 주머니
    ctx.strokeStyle = limbCol(c); ctx.lineWidth = R * 0.30; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(R * 0.05, -R * 0.05);
    ctx.quadraticCurveTo(R * 0.40, -R * 0.34, R * 0.56, -R * 0.60);
    ctx.stroke();
    ctx.fillStyle = c.body;
    ctx.beginPath(); ctx.ellipse(R * 0.34, -R * 0.34, R * 0.28 * swell, R * 0.23 * swell, 0.6, 0, TAU); ctx.fill();
    inkLine(c, R * 0.05);
    sac(R * 0.34, -R * 0.32, R * 0.12 * swell, 0.7);
    // 머리 — 위로 들고 앞으로 뱉는다
    beastHead(R, c, R * 0.74, -R * 0.74, -0.26, R * 0.36, 0.58, true);
  }

  // ── 블로트 (탱커) — 껍질을 두른 거대 외계 두꺼비. 죽을 때 산성으로 터진다 ──
  function drawBloat(R, c) {
    const t = performance.now() / 500;
    const breathe = 1 + 0.03 * Math.sin(t * 1.1);
    legs(R, c, 3, 0.34, -0.56, 0.84, 0.215, 0.02);      // 굵고 짧은 여섯 다리
    // 거대한 몸통
    hide(R, c, R * 0.76 * breathe, 0.06, 1, -R * 0.10, 0, 1.02);
    // 등껍질 — 어두운 각질 돔. 갈비선은 뒤쪽 절반에만 넣어 마디로 읽히게 한다.
    ctx.fillStyle = chitin(c, R);
    ctx.beginPath(); ctx.ellipse(-R * 0.10, 0, R * 0.73, R * 0.70, 0, 0, TAU); ctx.fill();
    inkLine(c, R * 0.06);
    segRibs(R, c, -0.66, 0.12, 5, 0.58, 0.06, 0.26);
    gloss(-R * 0.40, -R * 0.34, R * 0.24, R * 0.11, -0.4, 0.22);
    // 부글대는 산성 물집 — 터질 준비가 된 압력
    for (let i = 0; i < 3; i++) {
      const a = t * 0.6 + i * (TAU / 3);
      sac(Math.cos(a) * R * 0.32 - R * 0.16, Math.sin(a) * R * 0.28,
          R * 0.115 * (0.8 + 0.3 * Math.sin(t * 2 + i)), 0.8);
    }
    // 두툼한 머리 + 아래로 휜 엄니
    const hs = R * 0.34;
    ctx.fillStyle = c.dark; skullWedge(R * 0.74, 0, 0, hs, 0.80, 0.92); ctx.fill();
    inkLine(c, R * 0.06);
    ctx.fillStyle = c.body; skullWedge(R * 0.72, -R * 0.02, 0, hs * 0.86, 0.78, 0.88); ctx.fill();
    ctx.fillStyle = c.ink; ctx.globalAlpha = 0.75;      // 다물린 입선
    ctx.beginPath(); ctx.ellipse(R * 1.06, 0, R * 0.05, R * 0.13, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    for (let s = -1; s <= 1; s += 2) {                  // 밖으로 휜 엄니 — 실루엣을 넓힌다
      fang(R * 1.00, s * R * 0.18, s * 0.72, R * 0.22, R * 0.075, BONE);
      beastEye(c, R * 0.64, s * R * 0.24, R * 0.145, 0);
    }
  }

  // ── 베놈 하이드라 (공성) — 세 개의 목을 곧추세운 외계 독사 ──
  function drawHydra(R, c) {
    const t = performance.now() / 420;
    legs(R, c, 2, 0.16, -0.44, 0.78, 0.16, 0.04);
    tail(R, c, 0.9, 0.20, 4, -0.5);
    // 굵은 몸통 — 두 마디
    segBody(R, c, 2, -0.38, 0.02, 0.56, 0.46, 0.07, 5, 1.0);
    segRibs(R, c, -0.50, -0.02, 3, 0.48, 0.055);
    gloss(-R * 0.34, -R * 0.26, R * 0.22, R * 0.09, -0.4, 0.26);
    // 세 개의 목 + 머리 — 각자 다른 위상으로 흔들린다
    for (let i = -1; i <= 1; i++) {
      const sway = Math.sin(t + i * 1.7) * 0.17;
      const a = i * 0.55 + sway;
      const ca = Math.cos(a), sa2 = Math.sin(a);
      ctx.strokeStyle = limbCol(c); ctx.lineWidth = R * 0.26; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ca * R * 0.16, sa2 * R * 0.16);
      ctx.quadraticCurveTo(ca * R * 0.60, sa2 * R * 0.60, ca * R * 0.84, sa2 * R * 0.84);
      ctx.stroke();
      beastHead(R, c, ca * R * 1.00, sa2 * R * 1.00, a, R * 0.28, 0.50 + 0.14 * Math.sin(t * 2 + i), true);
    }
    // 목 밑동에서 흘러내리는 독액
    for (let i = 0; i < 3; i++) {
      const a = t * 0.8 + i * 2.1;
      sac(Math.cos(a) * R * 0.38 - R * 0.18, Math.sin(a * 1.3) * R * 0.30 + R * 0.18, R * 0.095, 0.65);
    }
  }

  // ── 플로터 (공중 폭격) — 막을 펄럭이며 떠다니는 외계 가오리 ──
  function drawFloater(R, c) {
    const t = performance.now() / 300;
    const flap = Math.sin(t * 1.3);
    // 늘어진 촉수 — 몸 밑으로 흔들린다
    for (let i = -1; i <= 1; i++) {
      tentacle(i * R * 0.26 - R * 0.34, R * 0.10, 1.5708 + i * 0.24, R * 1.0, R * 0.14, i * 1.4, limbCol(c), 4);
    }
    // 막날개 — 가오리처럼 한 장으로 이어진 마름모 지느러미. 좌우를 따로 그리면 두 장의
    // 판자가 겹쳐 보인다. 펄럭임은 좌우 폭을 엇갈리게 흔들어서 만든다.
    const spanL = R * (1.10 - 0.26 * flap), spanR = R * (1.10 + 0.26 * flap);
    ctx.fillStyle = limbCol(c);
    ctx.beginPath();
    ctx.moveTo(R * 0.66, 0);
    ctx.quadraticCurveTo(R * 0.30, -spanL * 0.66, -R * 0.44, -spanL);
    ctx.quadraticCurveTo(-R * 0.52, -spanL * 0.30, -R * 0.86, 0);
    ctx.quadraticCurveTo(-R * 0.52, spanR * 0.30, -R * 0.44, spanR);
    ctx.quadraticCurveTo(R * 0.30, spanR * 0.66, R * 0.66, 0);
    ctx.closePath(); ctx.fill();
    inkLine(c, R * 0.06);
    // 막을 지탱하는 뼈대
    ctx.strokeStyle = c.ink; ctx.globalAlpha = 0.28; ctx.lineWidth = R * 0.05;
    for (let s = -1; s <= 1; s += 2) {
      const span = s < 0 ? spanL : spanR;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath(); ctx.moveTo(R * 0.10, 0);
        ctx.lineTo(R * (0.26 - k * 0.32), s * span * (0.70 - k * 0.04));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // 가스 주머니 몸통 — 앞뒤로 긴 유선형
    hide(R, c, R * 0.50, 0.06, 5, -R * 0.02, 0, 0.78);
    segRibs(R, c, -0.30, 0.16, 3, 0.34, 0.05);
    gloss(-R * 0.20, -R * 0.20, R * 0.22, R * 0.09, -0.4, 0.30);
    sac(-R * 0.18, R * 0.04, R * 0.13, 0.75);           // 포자낭
    // 앞으로 뻗은 머리 + 눈 한 쌍 + 흡입구
    ctx.fillStyle = c.dark; skullWedge(R * 0.46, 0, 0, R * 0.30, 0.70, 0.80); ctx.fill();
    inkLine(c, R * 0.05);
    ctx.fillStyle = c.body; skullWedge(R * 0.44, -R * 0.02, 0, R * 0.26, 0.68, 0.76); ctx.fill();
    for (let s = -1; s <= 1; s += 2) beastEye(c, R * 0.38, s * R * 0.15, R * 0.135, 0);
    ctx.fillStyle = c.ink; ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.ellipse(R * 0.76, 0, R * 0.07, R * 0.12, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── 영웅: 브루드 매트리아크 (글룹) — 알을 품은 거대 여왕 곤충 ──
  function drawMatriarch(R, c) {
    const t = performance.now() / 600;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    legs(R, c, 3, 0.30, -0.50, 0.92, 0.165, 0.06);      // 여섯 다리
    // 복부 — 알로 가득 차 무겁게 늘어진다
    hide(R, c, R * 0.60, 0.06, 2, -R * 0.66, 0, 1.06);
    segRibs(R, c, -1.00, -0.42, 4, 0.52, 0.06, 0.24);
    for (let i = 0; i < 3; i++) {                       // 속에서 빛나는 알
      sac(-R * (0.48 + i * 0.22), Math.sin(t + i) * R * 0.10, R * 0.12, 0.5 + 0.3 * pulse);
    }
    // 흉부
    hide(R, c, R * 0.46, 0.07, 4, R * 0.08, 0, 0.92);
    gloss(-R * 0.04, -R * 0.22, R * 0.22, R * 0.09, -0.4, 0.28);
    // 왕관 뿔 — 실루엣만으로 영웅임을 알린다. 세 개만: 가늘고 많으면 왕관이 아니라 빗이 된다.
    for (let i = -1; i <= 1; i++) {
      const h = R * (0.72 - Math.abs(i) * 0.18);
      const bx = R * (0.08 + i * 0.24), tx = R * (0.20 + i * 0.30);
      ctx.fillStyle = chitin(c, R);
      ctx.beginPath();
      ctx.moveTo(bx - R * 0.10, -R * 0.26);
      ctx.lineTo(tx, -h - R * 0.26);
      ctx.lineTo(bx + R * 0.14, -R * 0.22);
      ctx.closePath(); ctx.fill();
      inkLine(c, R * 0.05);
      ctx.fillStyle = BONE_DIM;                        // 뿔 끝
      ctx.beginPath();
      ctx.moveTo(tx - R * 0.055 - (tx - bx) * 0.22, -h * 0.66 - R * 0.26);
      ctx.lineTo(tx, -h - R * 0.26);
      ctx.lineTo(tx + R * 0.055 - (tx - bx) * 0.22, -h * 0.64 - R * 0.26);
      ctx.closePath(); ctx.fill();
    }
    // 머리
    const ms = R * 0.32;
    ctx.fillStyle = c.dark; skullWedge(R * 0.64, 0, 0, ms, 0.82, 0.95); ctx.fill();
    inkLine(c, R * 0.055);
    ctx.fillStyle = c.body; skullWedge(R * 0.62, -R * 0.02, 0, ms * 0.86, 0.80, 0.90); ctx.fill();
    for (let s = -1; s <= 1; s += 2) {                  // 벌어지는 큰턱 — 안쪽으로 휘어 집는다
      const open = 0.34 + 0.12 * Math.sin(t * 2.2);
      ctx.strokeStyle = chitin(c, R); ctx.lineWidth = R * 0.14; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(R * 0.90, s * R * 0.20);
      ctx.quadraticCurveTo(R * 1.28, s * R * (0.26 + open * 0.6), R * 1.34, s * R * 0.06);
      ctx.stroke();
      fang(R * 1.34, s * R * 0.06, -s * 0.7, R * 0.26, R * 0.08, BONE);
    }
    // 산성 분사구 + 눈
    sac(R * 0.96, 0, R * 0.11, 0.85);
    for (let s = -1; s <= 1; s += 2) beastEye(c, R * 0.52, s * R * 0.19, R * 0.15, 0);
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

  // 실드 껍질 — 평상시엔 돌아가는 미광 호(弧), 피격 순간엔 육각 면이 드러나는 에너지 셸
  // The Warden's dome. Drawn as a ring plus a soft fill rather than a solid disc so the
  // thing underneath stays readable — a kid has to keep watching the crystal's health
  // bar while the dome is up, and an opaque bubble would hide the very thing it protects.
  function guardDome(e) {
    const gd = e.guard;
    if (!gd || gd.hp <= 0) return;
    const t = performance.now() / 1000;
    const R = gd.radius || 120;
    const frac = Math.max(0, Math.min(1, gd.hp / (gd.max || gd.hp)));
    const hit = gd.fx > 0 ? gd.fx / 0.2 : 0;
    // Fades as the pool drains, so "nearly gone" is visible before it pops.
    const a = 0.16 + 0.24 * frac + hit * 0.35;
    blitGlow(softGlow('120,220,255'), e.x, e.y, R, R, 0.10 + 0.10 * frac + hit * 0.25);
    ctx.save();
    ctx.strokeStyle = '#9fe6ff';
    ctx.lineWidth = 2 + 2.4 * frac + hit * 3;
    ctx.globalAlpha = Math.min(1, a + 0.15 * Math.sin(t * 4));
    ctx.beginPath(); ctx.arc(e.x, e.y, R, 0, Math.PI * 2); ctx.stroke();
    // A second, tighter ring turning the other way — one static circle reads as a
    // decal, two counter-rotating ones read as a field being held in place.
    ctx.globalAlpha *= 0.5;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([R * 0.16, R * 0.10]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath(); ctx.arc(e.x, e.y, R * 0.93, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function shieldFlare(e) {
    if (!e.maxShield || e.shield <= 0) return;
    const a = e.shieldFx > 0 ? Math.min(1, e.shieldFx / 0.18) : 0;
    const frac = e.shield / e.maxShield;
    const idle = 0.10 * frac;
    if (Math.max(idle, a * 0.55) <= 0.02) return;
    const rad = (e.kind === 'building' ? Math.max(e.w, e.h) * 0.62 : e.r + 5);
    const t = performance.now() / 1000;
    ctx.save();
    // 기본 껍질
    ctx.globalAlpha = Math.max(idle, a * 0.55);
    ctx.strokeStyle = PSI; ctx.lineWidth = a > 0 ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, rad, 0, Math.PI * 2); ctx.stroke();
    // 돌아가는 미광 — 껍질 위를 흐르는 하이라이트 (SF 영화의 포스필드)
    const sa = (t * 0.9 + (e.id || 0) * 0.7) % (Math.PI * 2);
    ctx.globalAlpha = Math.min(0.4, idle * 3 + a * 0.3);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, rad, sa, sa + 1.1); ctx.stroke();
    // 피격 — 육각 면 분할이 잠깐 드러난다
    if (a > 0.03) {
      ctx.strokeStyle = PSI; ctx.lineWidth = 1.6;
      for (let i = 0; i < 6; i++) {
        const g0 = i * Math.PI / 3 + t * 0.35;
        ctx.globalAlpha = a * (0.3 + 0.4 * Math.abs(Math.sin(t * 9 + i * 1.9)));
        ctx.beginPath(); ctx.arc(e.x, e.y, rad + 2.5, g0 + 0.09, g0 + Math.PI / 3 - 0.09); ctx.stroke();
      }
      // 안쪽 섬광 — 가장자리로 갈수록 밝아지는 링 스프라이트 (한 번만 굽는다)
      const ring = glowSprite('shieldring', (s) => {
        s.width = s.height = 64;
        const g2 = s.getContext('2d');
        const gr = g2.createRadialGradient(32, 32, 32 * 0.4, 32, 32, 32);
        gr.addColorStop(0, 'rgba(226,198,255,0)');
        gr.addColorStop(1, 'rgba(226,198,255,1)');
        g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
      });
      blitGlow(ring, e.x, e.y, rad, rad, a * 0.3);
    }
    ctx.restore();
  }

  // ── 죽음 폭발 (boom fx) ──────────────────────────────
  // 시뮬레이션은 {boom, ax, ay, r, race, t}만 만든다. 나머지는 전부 시간의 함수 —
  // 결정적 시드에서 파편 궤적을 뽑으므로 상태 저장 없이 매 프레임 같은 그림이 나온다.
  function boomRng(f) {
    let s = ((f.ax * 73856093) ^ (f.ay * 19349663)) >>> 0 || 7;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  function fireball(x, y, r, hot, mid, alpha) {
    const s = glowSprite('f:' + hot + '|' + mid, (cn) => {
      cn.width = cn.height = 64;
      const g2 = cn.getContext('2d');
      const gr = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, hot); gr.addColorStop(0.4, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = gr; g2.fillRect(0, 0, 64, 64);
    });
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
  }
  function drawBoom(f) {
    const life = f.boom === 2 ? 1.6 : 0.8;
    const prog = Math.min(1, Math.max(0, 1 - f.t / life));
    const rnd = boomRng(f);
    ctx.save();

    if (f.boom === 2) {
      // ── 건물 파괴 — 다단 폭발 + 충격파 + 연기 기둥 + 그을음 ──
      const R = f.r;
      // 그을린 바닥 — 폭발 내내 남았다가 마지막에 옅어진다
      ctx.globalAlpha = 0.4 * (1 - Math.max(0, prog - 0.72) / 0.28);
      ctx.fillStyle = '#0a0a0c';
      ctx.beginPath(); ctx.ellipse(f.ax, f.ay + R * 0.2, R * 1.25, R * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      // 첫 섬광
      if (prog < 0.14) fireball(f.ax, f.ay, R * 1.7, 'rgba(255,255,255,0.95)', 'rgba(255,236,180,0.7)', 1 - prog / 0.14);
      // 주 화구
      if (prog < 0.5) {
        const k = prog / 0.5;
        fireball(f.ax, f.ay - R * 0.2 * k, R * (0.7 + k * 1.1), 'rgba(255,244,200,0.95)', 'rgba(255,138,51,0.8)', 1 - k * 0.85);
      }
      // 다단 2차 폭발 — 시차를 두고 터져야 "무너져 내리는" 느낌이 난다
      for (let i = 0; i < 5; i++) {
        const ox = (rnd() - 0.5) * R * 1.5, oy = (rnd() - 0.5) * R * 0.9;
        const start = 0.08 + i * 0.11, dur = 0.3;
        const k = (prog - start) / dur;
        if (k <= 0 || k >= 1) continue;
        fireball(f.ax + ox, f.ay + oy, R * (0.3 + k * 0.55), 'rgba(255,240,190,0.95)', 'rgba(255,122,47,0.75)', 1 - k);
      }
      // 충격파 링
      if (prog < 0.55) {
        const k = prog / 0.55;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = '#ffe9c4'; ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.4 + k * 2.3), 0, Math.PI * 2); ctx.stroke();
      }
      // 불꽃 파편 — 포물선을 그리며 튄다
      for (let i = 0; i < 10; i++) {
        const a = rnd() * Math.PI * 2, sp = 0.6 + rnd() * 0.9, g0 = rnd();
        const k = Math.min(1, prog * 1.7);
        if (k >= 1) continue;
        const dx = Math.cos(a) * R * 2.1 * sp * k;
        const dy = Math.sin(a) * R * 1.2 * sp * k + R * 1.4 * k * k * g0;   // 유사 중력
        ctx.globalAlpha = (1 - k) * 0.95;
        ctx.strokeStyle = i % 3 ? '#ffc86e' : '#fff1cf'; ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(f.ax + dx, f.ay + dy);
        ctx.lineTo(f.ax + dx * 0.86, f.ay + dy * 0.86 - R * 0.06);
        ctx.stroke();
      }
      // 연기 기둥 — 위로 피어오르며 흩어진다
      if (prog > 0.12) {
        const k = (prog - 0.12) / 0.88;
        for (let i = 0; i < 6; i++) {
          const sx = (rnd() - 0.5) * R * 0.9;
          const rise = (k * 0.75 + rnd() * 0.25) * R * 2.1;
          const puff = R * (0.32 + k * 0.5 + rnd() * 0.2);
          ctx.globalAlpha = Math.max(0, (1 - k) * 0.4);
          ctx.fillStyle = i % 2 ? 'rgba(40,40,46,1)' : 'rgba(66,62,58,1)';
          ctx.beginPath();
          ctx.arc(f.ax + sx + Math.sin(rise * 0.02 + i) * R * 0.2, f.ay - rise, puff, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (f.race === 'gloop') {
      // ── 글룹 — 산성 점액 파열 (불 대신 초록 점액이 터진다) ──
      const R = f.r * 1.2;
      ctx.globalAlpha = (1 - prog) * 0.5;
      ctx.fillStyle = '#3f9b58';
      ctx.beginPath(); ctx.ellipse(f.ax, f.ay + R * 0.3, R * (0.8 + prog * 1.2), R * (0.35 + prog * 0.5), 0, 0, Math.PI * 2); ctx.fill();
      if (prog < 0.2) fireball(f.ax, f.ay, R * 1.4, 'rgba(220,255,225,0.9)', 'rgba(125,255,158,0.6)', 1 - prog / 0.2);
      ctx.fillStyle = '#7dff9e';
      for (let i = 0; i < 8; i++) {
        const a = rnd() * Math.PI * 2, sp = 0.5 + rnd();
        const k = Math.min(1, prog * 1.4);
        const dx = Math.cos(a) * R * 1.8 * sp * k;
        const dy = Math.sin(a) * R * sp * k - R * 1.1 * k * (1 - k) * 2;   // 위로 튀었다 떨어진다
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.beginPath(); ctx.arc(f.ax + dx, f.ay + dy, (2.6 + rnd() * 2.4) * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    } else if (f.race === 'aether') {
      // ── Aether — 사이오닉 내파: 안으로 무너졌다가 빛으로 흩어진다 ──
      const R = f.r * 1.35;
      if (prog < 0.3) {              // 수축
        const k = prog / 0.3;
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = PSI; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (1.6 - k * 1.3), 0, Math.PI * 2); ctx.stroke();
      } else {                       // 방출
        const k = (prog - 0.3) / 0.7;
        if (k < 0.3) fireball(f.ax, f.ay, R * 1.5, 'rgba(255,255,255,0.95)', 'rgba(226,198,255,0.7)', 1 - k / 0.3);
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = '#e2c6ff'; ctx.lineWidth = 3.5 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.3 + k * 2), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = PSI;
        for (let i = 0; i < 6; i++) {
          const a = rnd() * Math.PI * 2;
          const px = f.ax + Math.cos(a) * R * 1.9 * k, py = f.ay + Math.sin(a) * R * 1.9 * k;
          ctx.globalAlpha = (1 - k) * 0.85;
          ctx.save(); ctx.translate(px, py); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(0, -2.4); ctx.lineTo(5, 0); ctx.lineTo(0, 2.4);
          ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
    } else {
      // ── 포지/기본 — 화구 + 충격파 + 금속 파편 + 연기 ──
      const R = f.r * (f.fly ? 1.5 : 1.25);
      if (prog < 0.16) fireball(f.ax, f.ay, R * 1.6, 'rgba(255,255,255,0.95)', 'rgba(255,232,170,0.7)', 1 - prog / 0.16);
      if (prog < 0.55) {
        const k = prog / 0.55;
        fireball(f.ax, f.ay - R * 0.15 * k, R * (0.6 + k * 0.9), 'rgba(255,246,210,0.95)', 'rgba(255,138,51,0.8)', 1 - k * 0.8);
      }
      if (prog < 0.45) {
        const k = prog / 0.45;
        ctx.globalAlpha = (1 - k) * 0.75;
        ctx.strokeStyle = '#ffe9c4'; ctx.lineWidth = 4 * (1 - k) + 0.8;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.35 + k * 1.9), 0, Math.PI * 2); ctx.stroke();
      }
      for (let i = 0; i < 7; i++) {
        const a = rnd() * Math.PI * 2, sp = 0.55 + rnd() * 0.8, g0 = rnd();
        const k = Math.min(1, prog * 1.5);
        if (k >= 1) continue;
        const dx = Math.cos(a) * R * 2 * sp * k;
        const dy = Math.sin(a) * R * 1.1 * sp * k + R * 1.2 * k * k * g0;
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.strokeStyle = i % 3 ? '#ffc86e' : '#e8eef4'; ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(f.ax + dx, f.ay + dy);
        ctx.lineTo(f.ax + dx * 0.84, f.ay + dy * 0.84 - R * 0.05);
        ctx.stroke();
      }
      if (prog > 0.3) {
        const k = (prog - 0.3) / 0.7;
        for (let i = 0; i < 3; i++) {
          const sx = (rnd() - 0.5) * R * 0.8;
          ctx.globalAlpha = (1 - k) * 0.32;
          ctx.fillStyle = 'rgba(46,44,48,1)';
          ctx.beginPath();
          ctx.arc(f.ax + sx, f.ay - (k * 0.7 + rnd() * 0.3) * R * 1.5, R * (0.28 + k * 0.35), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  // ── Confetti (Kids mode wave-clear) ─────────────────────────────────────────
  // Deliberately bright, deliberately over the top. The wave-clear moment is the
  // reward the whole mode is built around, so it gets a real burst rather than a
  // line of text. Every particle is derived from the fx's own seed, so it is
  // recomputed identically each frame without storing per-particle state.
  const PARTY_COLS = ['#ffd24a', '#ff6ba8', '#63c7ff', '#5ddc7a', '#b98cff', '#ff9b3d', '#ffffff'];
  function drawParty(f) {
    const life = f.life || 2.2;
    // Clamped low as well as high, for the same reason as the ability effects above:
    // an fx pushed with a t longer than its own `life` would otherwise drive negative
    // particle radii straight into ctx.arc.
    const prog = Math.min(1, Math.max(0, 1 - Math.max(0, f.t) / life));
    if (prog >= 1) return;
    const n = f.n || 40;
    const rnd = boomRng(f);
    ctx.save();
    // Bright flash on the first instant, so the burst has a bang and not just a drift.
    if (prog < 0.2) {
      const k = prog / 0.2;
      ctx.globalAlpha = (1 - k) * 0.55;
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(f.ax, f.ay, 40 + k * 150, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const sp = 130 + rnd() * 320;                    // px/sec outward
      const spin = rnd() * Math.PI * 2;
      const col = PARTY_COLS[Math.floor(rnd() * PARTY_COLS.length)];
      const t = prog * life;
      // Ballistic: out fast, then gravity takes over. Reads as thrown, not exploded.
      const x = f.ax + Math.cos(a) * sp * t * (1 - prog * 0.45);
      const y = f.ay + Math.sin(a) * sp * 0.62 * t * (1 - prog * 0.45) + 240 * t * t;
      ctx.globalAlpha = Math.min(1, (1 - prog) * 1.8);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin + t * 9);
      ctx.fillStyle = col;
      ctx.fillRect(-3.5, -2, 7, 4);                    // little rectangles = paper streamers
      ctx.restore();
    }
    // Expanding ring so the burst has a readable centre even in a busy frame.
    if (prog < 0.6) {
      const k = prog / 0.6;
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.ax, f.ay, 30 + k * 210, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShot(f) {
    if (f.boom) { drawBoom(f); return; }
    // 유닛 사망 팝 — 확장 링 + 흩어지는 파편
    if (f.pop) { drawPop(f); return; }
    // Kids mode wave-clear confetti
    if (f.party) { drawParty(f); return; }
    // 스킬 이펙트 (범위 파동 / 치유 / 점멸)
    if (f.abil) {
      // `t` counts DOWN from the lifetime the ability picked when it pushed the effect
      // (game.js decays it every tick and drops the entry at zero), so the first frame
      // we see an effect tells us how long it was meant to run. Stamp that once and
      // derive `prog` from it.
      //
      // This replaces a hand-written lifetime table that had drifted badly out of step
      // with the abilities it was describing. It gave every unlisted effect 0.35s, while
      // Firestorm pushes a 'salvo' for 1.0s, Bulwark a 'dome' for 1.0s, Ember's Flare a
      // 'nova' for 0.6s against a 0.5s entry, and so on — nine of the ability effects
      // pushed a longer `t` than the table allowed. For those, `1 - t/life` was NEGATIVE
      // on the very first frame, `f.radius * prog` came out negative with it, and
      // ctx.arc threw "The radius provided (-321.619) is negative". The global error
      // boundary caught that as "Something went wrong" and ended the match — so using a
      // hero's ultimate could kill the run outright.
      //
      // Deriving the lifetime from the effect itself means an ability can pick any
      // duration it likes and the table can never fall out of date again.
      if (f._life === undefined) f._life = Math.max(0.001, f.t);
      // Clamped as well as fixed, deliberately. `prog` feeds a radius or an alpha in
      // every branch below, and a crash out of a live match is far too high a price to
      // pay for one bad frame of artwork.
      const prog = Math.min(1, Math.max(0, 1 - Math.max(0, f.t) / f._life));
      ctx.save();
      if (f.abil === 'barrage') {
        // 궤도 폭격 — 하늘에서 떨어지는 광선 다발 + 확장하는 충격파 + 화구
        const R = f.radius;
        ctx.globalAlpha = (1 - prog) * 0.55; ctx.fillStyle = '#ffb765';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.25 + prog * 0.85), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = (1 - prog) * 0.95; ctx.strokeStyle = '#fff0c2'; ctx.lineWidth = 6 * (1 - prog) + 1;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.2 + prog), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ff7a2f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.05 + prog * 1.05), 0, Math.PI * 2); ctx.stroke();
        // 낙하하는 포탄 광선 — 한 발씩 시차를 두고 떨어져야 "궤도 폭격"으로 읽힌다
        for (let i = 0; i < 12; i++) {
          const a = i * 0.5236 + 0.3;
          const rr = R * (0.22 + (i % 4) * 0.22);
          const bx = f.ax + Math.cos(a) * rr, by = f.ay + Math.sin(a) * rr;
          const fall = Math.min(1, Math.max(0, (prog - i * 0.045) * 2.6));
          if (fall <= 0) continue;
          if (fall < 1) {                       // 아직 떨어지는 중 — 하늘에서 내려오는 광선
            const head = by - 520 * (1 - fall);
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = '#fff6d8'; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.moveTo(bx, head); ctx.lineTo(bx, head - 150); ctx.stroke();
            ctx.globalAlpha = 0.4;
            ctx.strokeStyle = '#ffb765'; ctx.lineWidth = 12;
            ctx.beginPath(); ctx.moveTo(bx, head); ctx.lineTo(bx, head - 190); ctx.stroke();
          } else {                              // 착탄 — 화구가 부풀었다 사그라든다
            const age = Math.min(1, (prog - i * 0.045) * 2.6 - 1);
            ctx.globalAlpha = (1 - age) * 0.95; ctx.fillStyle = '#fff0c2';
            ctx.beginPath(); ctx.arc(bx, by, 12 + age * 16, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = (1 - age) * 0.55; ctx.fillStyle = '#ff8a33';
            ctx.beginPath(); ctx.arc(bx, by, 20 + age * 34, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (f.abil === 'swarm') {
        // 무리 부화 — 갈라지는 땅 + 튀어나오는 포자
        const R = f.radius;
        ctx.globalAlpha = (1 - prog) * 0.5; ctx.fillStyle = '#4bd97a';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.3 + prog * 0.8), 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = (1 - prog) * 0.9; ctx.strokeStyle = '#8dffae'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * (0.15 + prog), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#a9ffc4';
        for (let i = 0; i < 14; i++) {
          const a = i * 0.449;
          const rr = R * prog * (0.5 + (i % 5) * 0.12);
          ctx.globalAlpha = (1 - prog) * 0.85;
          ctx.beginPath();
          ctx.arc(f.ax + Math.cos(a) * rr, f.ay + Math.sin(a) * rr - prog * 26, 4.5 * (1 - prog) + 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.abil === 'aegis') {
        // 이지스 폭풍 — 퍼져나가는 이중 링 + 빛나는 파편
        const R = f.radius;
        ctx.globalAlpha = (1 - prog) * 0.42; ctx.fillStyle = '#7fd8ff';
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * prog, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = (1 - prog); ctx.strokeStyle = '#eaf9ff'; ctx.lineWidth = 7 * (1 - prog) + 1.5;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * prog, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = (1 - prog) * 0.8; ctx.strokeStyle = '#9ad4ff'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(f.ax, f.ay, R * Math.max(0, prog - 0.22), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#dff3ff';
        for (let i = 0; i < 12; i++) {
          const a = i * 0.5236 + prog * 0.9;
          const rr = R * prog;
          ctx.globalAlpha = (1 - prog) * 0.9;
          ctx.save();
          ctx.translate(f.ax + Math.cos(a) * rr, f.ay + Math.sin(a) * rr);
          ctx.rotate(a);
          ctx.fillRect(-7, -1.6, 14, 3.2);
          ctx.restore();
        }
      } else if (f.abil === 'nova') {
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
    // 연쇄 번개 — 본 사격이 아니라 튄 것이므로 총구 화염도, 탄착도 그리지 않는다.
    if (f.arc) {
      const a = Math.max(0, Math.min(1, f.t / 0.12));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = a;
      ctx.strokeStyle = 'rgba(190,235,255,0.9)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(f.x, f.y);
      // A couple of kinks, seeded off the endpoints so the same bolt doesn't jitter.
      const seg = 3, dx = (f.tx - f.x) / seg, dy = (f.ty - f.y) / seg;
      for (let i = 1; i <= seg; i++) {
        const j = (i < seg) ? ((Math.sin((f.x + i * 7.3 + f.ty) * 1.7) * 7)) : 0;
        ctx.lineTo(f.x + dx * i - dy / 40 * j, f.y + dy * i + dx / 40 * j);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }
    const col = f.crit ? C.crit : pal(f.owner).trim;
    const k = Math.min(1, f.t / 0.12);
    ctx.save();
    ctx.lineCap = 'round';
    // 바깥 광선 (넓고 흐린 에너지 빔) — 그 위에 뜨거운 심을 겹쳐 광선처럼 보이게 한다
    ctx.globalAlpha = k * 0.3;
    ctx.strokeStyle = col;
    ctx.lineWidth = f.crit ? 10 : (f.splash ? 9 : 6.5);
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
    // 심 — 흰빛에 가까운 중심선
    ctx.globalAlpha = k * 0.95;
    ctx.strokeStyle = mix(col, '#ffffff', 0.65);
    ctx.lineWidth = f.crit ? 2.6 : 1.7;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
    // 총구 섬광 — 발사 직후에만 (수명 앞 40%)
    if (k > 0.6) {
      const mf = (k - 0.6) / 0.4;
      ctx.globalAlpha = mf * 0.9;
      ctx.fillStyle = mix(col, '#ffffff', 0.5);
      const ang = Math.atan2(f.ty - f.y, f.tx - f.x);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, -3.2); ctx.lineTo(9 + mf * 4, 0); ctx.lineTo(0, 3.2); ctx.lineTo(-2.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // 착탄 불꽃 — 명중 지점에서 튀는 스파크
    {
      const ia = Math.atan2(f.ty - f.y, f.tx - f.x);
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = mix(col, '#ffffff', 0.4);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 4; i++) {
        const sa = ia + Math.PI + (i - 1.5) * 0.55;
        const len = 5 + (i % 2) * 4 + (1 - k) * 7;
        ctx.beginPath();
        ctx.moveTo(f.tx + Math.cos(sa) * 2, f.ty + Math.sin(sa) * 2);
        ctx.lineTo(f.tx + Math.cos(sa) * len, f.ty + Math.sin(sa) * len);
        ctx.stroke();
      }
      ctx.globalAlpha = k * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(f.tx, f.ty, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // 공성 스플래시 — 화구 그라디언트 + 팽창 링 (평평한 원반 대신)
    if (f.splash) {
      const sp = 1 - k;                      // 수명이 줄어드는 만큼 커진다
      fireball(f.tx, f.ty, f.splash * (0.5 + sp * 0.7), 'rgba(255,244,205,0.85)', 'rgba(255,150,60,0.5)', k);
      ctx.globalAlpha = k * 0.8;
      ctx.strokeStyle = '#ffd9a0'; ctx.lineWidth = 2.5 * k + 0.5;
      ctx.beginPath(); ctx.arc(f.tx, f.ty, f.splash * (0.4 + sp * 0.8), 0, Math.PI * 2); ctx.stroke();
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
    // soft pass — dims ground you have explored but cannot currently see
    ctx.drawImage(g.fogCanvas, 0, 0, g.visCols, g.visRows, 0, 0, CFG.WORLD_W, CFG.WORLD_H);
    // hard pass — solid black over ground never discovered, drawn twice so the
    // smoothed upscale can't leave terrain faintly showing through
    if (g.fogHard) {
      ctx.drawImage(g.fogHard, 0, 0, g.visCols, g.visRows, 0, 0, CFG.WORLD_W, CFG.WORLD_H);
      ctx.drawImage(g.fogHard, 0, 0, g.visCols, g.visRows, 0, 0, CFG.WORLD_W, CFG.WORLD_H);
    }
    // beyond the map edge is unknown too — keep it black rather than bare ground
    ctx.fillStyle = '#000';
    const cx = g.camera.x, cy = g.camera.y;
    if (cx < 0) ctx.fillRect(cx, cy, -cx, H);
    if (cy < 0) ctx.fillRect(cx, cy, W, -cy);
    if (cx + W > CFG.WORLD_W) ctx.fillRect(CFG.WORLD_W, cy, cx + W - CFG.WORLD_W, H);
    if (cy + H > CFG.WORLD_H) ctx.fillRect(cx, CFG.WORLD_H, W, cy + H - CFG.WORLD_H);
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
        ctx.save();                     // 바깥쪽 부드러운 광륜 → 안쪽 선명한 링
        ctx.globalAlpha = 0.30;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(e.x, e.y + e.r * 0.5, e.r * 1.25, e.r * 0.6, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
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

  // The ghost shows the WHOLE plan, not one block. A child dragging out a wall has
  // to see the row they are about to get before they let go — otherwise "drag to
  // build" is just a click with extra steps, and the first thing they learn is that
  // it does something they did not predict.
  //
  // Every cell is coloured independently, because the interesting case is the row
  // that is fine for nine blocks and runs into a rock on the tenth: greying that one
  // cell teaches the rule, where refusing the whole line teaches nothing.
  // The remove tool's own preview. It cannot reuse the build ghost, because the
  // question it is answering is the opposite one: not "does this cell fit something"
  // but "what is IN this cell, and what will happen to it". So it highlights the
  // pieces the gesture would touch and says which of the two things it would do —
  // an empty cell simply does not light up.
  function drawRemoveGhost(g, input) {
    const cells = (RC.Input && RC.Input.planCells) ? RC.Input.planCells()
                                                  : [RC.Keep.snap(input.world.x, input.world.y)];
    const t = performance.now() / 1000;
    let hit = 0, back = 0, standing = 0;
    ctx.save();
    for (const c of cells) {
      const b = RC.Keep.at(g, RC.Keep.cellX(c.x), RC.Keep.cellY(c.y));
      if (!b || b.dead) continue;
      hit++;
      const price = RC.Keep.priceOf(g, b.type);
      back += b.done ? Math.round(price * RC.Keep.DEMO_REFUND) : price;
      if (b.done) standing++;
      const hw = b.w / 2 + 3, pulse = 0.55 + 0.25 * Math.sin(t * 6);
      ctx.globalAlpha = pulse * 0.5;
      ctx.fillStyle = C.hpBad;
      ctx.fillRect(b.x - hw, b.y - hw, hw * 2, hw * 2);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffd0d6'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - hw * 0.55, b.y - hw * 0.55); ctx.lineTo(b.x + hw * 0.55, b.y + hw * 0.55);
      ctx.moveTo(b.x + hw * 0.55, b.y - hw * 0.55); ctx.lineTo(b.x - hw * 0.55, b.y + hw * 0.55);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (hit) {
      const a = cells[0], z = cells[cells.length - 1];
      const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2 - 40;
      // Two different words on purpose. "Undo" is free and instant; "take down" is a
      // job somebody has to walk to and do, and a child deciding between them should
      // be told which one they are about to buy.
      const label = standing ? ('⛏ take down ' + hit + '  ·  +' + back + '💎')
                             : ('↩ undo ' + hit + '  ·  +' + back + '💎 back');
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width + 18;
      ctx.fillStyle = 'rgba(8,14,22,.85)';
      rrect(mx - w / 2, my - 12, w, 24, 8); ctx.fill();
      ctx.fillStyle = '#ffc2ca';
      ctx.fillText(label, mx, my);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  function drawGhost(g, input) {
    if (RC.Keep && g.placing === RC.Keep.DEMO) { drawRemoveGhost(g, input); return; }
    const d = RC.BUILDINGS[g.placing];
    const snap = RC.Input && RC.Input.snapMode && RC.Input.snapMode();
    const cells = snap && RC.Input.planCells ? RC.Input.planCells()
                                            : [{ x: input.world.x, y: input.world.y }];
    const owner = g.playerOwner;
    const price = (g.kids && RC.Keep) ? ((RC.Keep.itemOf(g.raceOf ? g.raceOf(owner) : 'forge', g.placing) || {}).cost || d.cost) : d.cost;
    let purse = (g.kids && RC.Keep) ? RC.Keep.shards(g) : Math.floor((g.res[owner] || {}).shard || 0);
    let spent = 0, okCount = 0;

    ctx.save();
    for (const c of cells) {
      // Each cell is tested against the money that would be LEFT by the time the
      // plan reaches it, so a row you cannot finish shows you exactly where it stops
      // rather than promising twelve blocks and building seven.
      const afford = purse - spent >= price;
      const ok = afford && ((g.kids && RC.Kids && RC.Kids.canBuild)
        ? !RC.Keep.why(g, g.placing, c.x, c.y)
        : (g.canPlace(g.placing, c.x, c.y, owner) && g.canAfford(owner, d.cost)));
      if (ok) { spent += price; okCount++; }
      ctx.globalAlpha = ok ? 0.45 : 0.28;
      ctx.fillStyle = ok ? C.p1_body : C.hpBad;
      ctx.fillRect(c.x - d.w / 2, c.y - d.h / 2, d.w, d.h);
      ctx.globalAlpha = ok ? 0.95 : 0.6;
      ctx.strokeStyle = ok ? C.select : C.hpBad;
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - d.w / 2, c.y - d.h / 2, d.w, d.h);
    }
    ctx.globalAlpha = 1;

    // The tally, on the line itself. A price you have to look away to read is a
    // price nobody reads.
    if (snap && cells.length > 1) {
      const a = cells[0], z = cells[cells.length - 1];
      const mx = (a.x + z.x) / 2, my = (a.y + z.y) / 2 - d.h / 2 - 16;
      const label = okCount + ' × ' + price + '💎  =  ' + (okCount * price);
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w = ctx.measureText(label).width + 18;
      ctx.fillStyle = 'rgba(8,14,22,.82)';
      rrect(mx - w / 2, my - 12, w, 24, 8); ctx.fill();
      ctx.fillStyle = okCount ? '#bff0ff' : '#ff9aa8';
      ctx.fillText(label, mx, my);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  // The grid, drawn only while something is armed. Permanent grid lines would turn
  // a warm hand-drawn map into a spreadsheet; a grid that appears the moment you
  // pick up a wall and vanishes when you put it down is a tool rather than décor,
  // and it is what makes "one line" something you can see before you commit to it.
  // ── The yard ───────────────────────────────────────────────────────────────
  //
  // The ground inside a sealed keep, drawn as ground and not as an overlay: it sits
  // under the buildings and the units, so it reads as a floor somebody laid rather
  // than as a status light somebody switched on.
  //
  // It appears ONLY when the ring is actually unbroken (RC.Keep.enclosure), which is
  // what makes it worth having. There is no partial state and no percentage — you lay
  // the last wall and the whole inside of your castle turns into a courtyard, in one
  // moment, which is the reward. A child who has one gap left will go and find it.
  function drawKeepYard(g) {
    if (!g.kids || !RC.Keep || !RC.Keep.enclosure) return;
    const e = RC.Keep.enclosure(g);
    if (!e.sealed || !e.yard.size) return;
    const G = RC.Keep.GRID;
    const z = camZoom(g);
    const cam = g.camera, VW = cv.width / z, VH = cv.height / z;
    const t = performance.now() / 1000;
    ctx.save();
    // Warm and very faint. This is a hint that the floor is yours, not a highlight.
    ctx.fillStyle = 'rgba(255, 226, 168, 0.14)';
    for (const k of e.yard) {
      const p = k.split(',');
      const x = (+p[0]) * G, y = (+p[1]) * G;
      if (x + G < cam.x - 40 || x > cam.x + VW + 40 || y + G < cam.y - 40 || y > cam.y + VH + 40) continue;
      ctx.fillRect(x, y, G, G);
    }
    // The boundary: every yard edge that has no yard beyond it, which traces the
    // inside face of the wall exactly. Drawn as one path so the glow is a single
    // continuous line around the castle rather than 200 separate outlines.
    ctx.beginPath();
    for (const k of e.yard) {
      const p = k.split(',');
      const cx = +p[0], cy = +p[1];
      const x = cx * G, y = cy * G;
      if (x + G < cam.x - 60 || x > cam.x + VW + 60 || y + G < cam.y - 60 || y > cam.y + VH + 60) continue;
      if (!e.yard.has(cx + ',' + (cy - 1))) { ctx.moveTo(x, y); ctx.lineTo(x + G, y); }
      if (!e.yard.has(cx + ',' + (cy + 1))) { ctx.moveTo(x, y + G); ctx.lineTo(x + G, y + G); }
      if (!e.yard.has((cx - 1) + ',' + cy)) { ctx.moveTo(x, y); ctx.lineTo(x, y + G); }
      if (!e.yard.has((cx + 1) + ',' + cy)) { ctx.moveTo(x + G, y); ctx.lineTo(x + G, y + G); }
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 216, 142, ' + (0.46 + 0.14 * Math.sin(t * 1.6)).toFixed(3) + ')';
    ctx.stroke();
    ctx.restore();
  }

  function drawKeepGrid(g, input) {
    if (!RC.Keep || !RC.Input || !RC.Input.snapMode || !RC.Input.snapMode()) return;
    const G = RC.Keep.GRID;
    const cx = input.world.x, cy = input.world.y;
    const R = 5;                                   // cells of grid drawn around the cursor
    const c = RC.Keep.cellOf(cx, cy);
    ctx.save();
    ctx.strokeStyle = 'rgba(180,232,255,.20)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -R; i <= R + 1; i++) {
      const x = (c.cx + i) * G, y = (c.cy + i) * G;
      ctx.moveTo(x, (c.cy - R) * G); ctx.lineTo(x, (c.cy + R + 1) * G);
      ctx.moveTo((c.cx - R) * G, y); ctx.lineTo((c.cx + R + 1) * G, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Night. The reason this exists is not atmosphere, it is legibility of STATE: a
  // child needs to know at a glance whether it is safe to be building or whether
  // something is coming, and a clock cannot tell them that from across a room.
  // Bright means build, dark means fight — which is also why the torches are worth
  // buying, because they are the only thing that pushes the dark back.
  function drawKeepNight(g, VW, VH) {
    if (!RC.Keep || !g.kids) return;
    const n = RC.Keep.nightAmt(g);
    if (n <= 0.01) return;
    const cam = g.camera;
    ctx.save();
    ctx.globalAlpha = n * 0.42;
    ctx.fillStyle = '#0b1430';
    ctx.fillRect(cam.x - 40, cam.y - 40, VW + 80, VH + 80);
    // ...and then carve the light back out of it. Additive, so a torch beside a
    // wall lights the wall rather than painting a disc on top of it.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (const b of g.buildings) {
      if (b.dead || !b.done) continue;
      const R = b.def.light || (b === g.crystal ? 260 : 0);
      if (!R) continue;
      const f = 0.85 + 0.15 * Math.sin(performance.now() / 320 + b.id);
      blitGlow(softGlow(b === g.crystal ? '150,230,255' : '255,180,90'),
               b.x, b.y, R * f, R * f, n * (b === g.crystal ? 0.30 : 0.42));
    }
    ctx.restore();
  }

  // ── Joining the keep together ──────────────────────────────────────────────
  //
  // This is the single change that turns a row of blocks into a castle wall, and it
  // is worth being explicit about why it is a RENDERING problem rather than a
  // gameplay one. Twelve walls in a line already behaved like a wall: they blocked,
  // they had health, the pathfinder respected them. They just did not LOOK like one,
  // because there was 14px of grass between each pair, and a child looking at twelve
  // separate squares does not think "I built a wall", they think "I put down twelve
  // things". Nothing about the simulation had to change — only whether the game
  // draws what the player meant.
  //
  // Drawn UNDER the buildings, so each piece's own art (the rivets, the spikes, the
  // logs) still reads on top of the masonry that joins it to its neighbours.
  function drawKeepTrim(g) {
    if (!RC.Keep || !g.kids) return;
    const t = performance.now() / 1000;
    ctx.save();
    // Decorations do not join, so drawKeepTrim's main loop skips them — but they can
    // still be marked, and a condemned flowerbox has to say so like everything else.
    for (const b of g.buildings) {
      if (b.dead || !b.demo || !b.def.decor || fogged(g, b)) continue;
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 6);
      ctx.strokeStyle = '#ff6b7d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - 12, b.y - 12); ctx.lineTo(b.x + 12, b.y + 12);
      ctx.moveTo(b.x + 12, b.y - 12); ctx.lineTo(b.x - 12, b.y + 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const b of g.buildings) {
      if (b.dead || !b.done || !RC.Keep.joins(b) || fogged(g, b)) continue;
      const m = RC.Keep.joinMask(g, b);
      const col = pal(b.owner);
      const hw = b.w / 2, hh = b.h / 2;
      // Crenellations go on the edges with NOTHING beyond them — which is exactly the
      // outside of the castle. The teeth therefore trace the perimeter of whatever
      // shape the player actually built, and nobody had to decide what "outside" is.
      const ink = shade(col.body, -0.72);
      const teeth = (ax, ay, horiz) => {
        for (let i = -1; i <= 1; i++) {
          const px = b.x + (horiz ? i * hw * 0.58 : ax);
          const py = b.y + (horiz ? ay : i * hh * 0.58);
          ctx.fillStyle = col.body; ctx.fillRect(px - 4, py - 4, 8, 8);
          ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(px - 4, py - 4, 8, 8);
        }
      };
      if (!(m & 1)) teeth(0, -hh, true);
      if (!(m & 4)) teeth(0, hh, true);
      if (!(m & 8)) teeth(-hw, 0, false);
      if (!(m & 2)) teeth(hw, 0, false);
      // A turret post wherever the wall turns. Corners are where a wall looks most
      // like a fence and least like a castle, and the mask already knows where they
      // are, so this costs one test and buys the whole silhouette.
      if (m === 3 || m === 6 || m === 12 || m === 9 || m === 15) {
        ctx.fillStyle = col.dark;
        ctx.beginPath(); ctx.arc(b.x, b.y, hw * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col.trim;
        ctx.beginPath(); ctx.arc(b.x, b.y - 1.5, hw * 0.44, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = ink; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(b.x, b.y, hw * 0.62, 0, Math.PI * 2); ctx.stroke();
      }
      // Condemned. A piece with a builder on the way has to look different from a
      // piece that is fine, or a child marks something, wanders off, and comes back
      // to a castle with a hole in it they have no memory of asking for. The ring
      // fills as the demolition does, so the wait is legible rather than mysterious.
      if (b.demo) {
        const need = RC.Keep.demoTime(g, b.type);
        const k = Math.max(0, Math.min(1, (b.demoT || 0) / need));
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 6);
        ctx.strokeStyle = '#ff6b7d'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x - hw * 0.5, b.y - hh * 0.5); ctx.lineTo(b.x + hw * 0.5, b.y + hh * 0.5);
        ctx.moveTo(b.x + hw * 0.5, b.y - hh * 0.5); ctx.lineTo(b.x - hw * 0.5, b.y + hh * 0.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (k > 0) {
          ctx.strokeStyle = '#ffd0d6'; ctx.lineWidth = 3.4;
          ctx.beginPath();
          ctx.arc(b.x, b.y, hw + 5, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
          ctx.stroke();
        }
      }

      // An open gate should read as a doorway from across the map.
      if (b.def.gate && RC.Keep.gateOpen(g, b)) {
        ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 2);
        ctx.strokeStyle = '#ffe0a0'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(b.x, b.y, hw * 0.9, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  // The build ring — "you may build in here". A rule a kid cannot see is a rule they will
  // break repeatedly and never understand, so it is drawn on the ground rather than left
  // to a refusal message. Only while something is armed, so it is not permanent clutter.
  function drawBuildRing(g) {
    if (!g.kids || !g.placing || !g.crystal || !RC.Kids || !RC.Kids.buildRing) return;
    const R = RC.Kids.buildRing(g);
    const t = performance.now() / 1000;
    ctx.save();
    blitGlow(softGlow('120,220,255'), g.crystal.x, g.crystal.y, R, R, 0.05);
    ctx.strokeStyle = '#8fe3ff';
    ctx.globalAlpha = 0.5 + 0.15 * Math.sin(t * 2.4);
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 18]);
    ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.arc(g.crystal.x, g.crystal.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawDragBox(input) {
    if (!input.dragging) return;
    const a = input.dragStart, b = input.screen;
    const touch = !!input.dragTouch;
    ctx.save();
    ctx.strokeStyle = C.select;
    ctx.fillStyle = 'rgba(142,242,176,0.12)';
    ctx.lineWidth = touch ? 2.5 : 1.5;      // thicker on touch — a thin line vanishes on a phone
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Live "N selected" badge. Your fingertip sits on top of the units you're
    // trying to box, so the count is drawn clear of the finger — above it when
    // there's room, otherwise below.
    if (touch) {
      const n = input.boxCount | 0;
      const label = n === 1 ? '1 unit' : n + ' units';
      ctx.font = 'bold 15px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const bw = tw + 22, bh = 28;
      let bx = b.x - bw / 2;
      let by = b.y - 74;                    // clear of the fingertip
      if (by < 6) by = b.y + 46;            // near the top edge → put it below instead
      bx = Math.max(6, Math.min(cv.width - bw - 6, bx));
      by = Math.max(6, Math.min(cv.height - bh - 6, by));
      ctx.fillStyle = n ? 'rgba(16,32,24,0.92)' : 'rgba(32,20,20,0.92)';
      ctx.strokeStyle = n ? C.select : 'rgba(200,120,120,0.9)';
      ctx.lineWidth = 2;
      rrect(bx, by, bw, bh, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = n ? '#dfffe9' : '#ffd6d6';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 0.5);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
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

    // ── Under-attack markers ──
    // Drawn ON TOP of the fog overlay on purpose: you are told that something of yours
    // is being killed even where you currently have no vision, because losing a mineral
    // line silently is exactly the failure this exists to prevent.
    (g.alerts || []).forEach(a => {
      const age = g.time - a.born;
      const pulse = 0.5 + 0.5 * Math.sin(age * 7);
      const r = 4 + pulse * 5;
      mctx.strokeStyle = 'rgba(255,80,60,' + (0.55 + pulse * 0.45) + ')';
      mctx.lineWidth = 2;
      mctx.beginPath(); mctx.arc(a.x * sx, a.y * sy, r, 0, Math.PI * 2); mctx.stroke();
    });

    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 1;
    // 뷰포트 사각형 — 확대/축소하면 보이는 월드 크기가 달라진다
    const z = camZoom(g);
    mctx.strokeRect(g.camera.x * sx, g.camera.y * sy, (W / z) * sx, (H / z) * sy);
  }

  // ── 날씨 / Weather ─────────────────────────────────────
  // Drawn in SCREEN space over the finished world. Everything is a pure function of
  // game.time, so what you see matches the sight and speed penalties the simulation
  // is applying — the storm on screen IS the storm in the rules.
  //
  // Particles drift with the camera at a fraction of its speed, which is what makes
  // falling snow feel like it is in the world rather than stuck to the glass.
  function wRnd(i, salt) {                    // cheap deterministic hash → 0..1
    let h = (i * 374761393 + salt * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Falling particles: n of them, given colour/size/speed/slant.
  function fall(g, W, H, t, k, o) {
    const camX = g.camera.x || 0, camY = g.camera.y || 0;
    const par = o.par == null ? 0.35 : o.par;
    ctx.globalAlpha = o.alpha * k;
    ctx.fillStyle = o.color;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.wide || 1;
    const span = H + 120;
    for (let i = 0; i < o.n; i++) {
      const sx = wRnd(i, 1) * (W + 200) - 100;
      const speed = o.speed * (0.7 + wRnd(i, 2) * 0.6);
      const y = ((wRnd(i, 3) * span + t * speed) % span) - 60;
      const x = sx + (y * (o.slant || 0)) - (camX * par) % (W + 200);
      const px = ((x % (W + 200)) + (W + 200)) % (W + 200) - 100;
      const py = y - (camY * par * 0.25) % span;
      const yy = ((py % span) + span) % span - 60;
      if (o.streak) {
        ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + o.streak * (o.slant || 0.2), yy + o.streak); ctx.stroke();
      } else {
        const r = o.size * (0.6 + wRnd(i, 4) * 0.8);
        ctx.beginPath(); ctx.arc(px, yy, r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // A moving veil of haze — bands that slide across the screen.
  function veil(g, W, H, t, k, col, bands, speed, alpha) {
    ctx.globalAlpha = alpha * k;
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha * k * 0.55;
    for (let i = 0; i < bands; i++) {
      const h = H * (0.14 + wRnd(i, 7) * 0.2);
      const y = ((wRnd(i, 8) * H + t * speed * (0.5 + wRnd(i, 9))) % (H + h * 2)) - h;
      ctx.beginPath();
      ctx.ellipse(W / 2 + Math.sin(t * 0.3 + i) * W * 0.2, y, W * 0.75, h * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawWeather(g, W, H) {
    if (REDUCED || !RC.Weather || !g || g.over) return;
    const w = RC.Weather.at(g);
    const k = w.intensity;
    if (!k || k < 0.02) return;
    const vis = w.ev.vis;
    if (!vis) return;
    const t = g.time || 0;
    ctx.save();
    switch (vis) {
      case 'rain':
        fall(g, W, H, t, k, { n: 150, color: '#9fd4ff', alpha: 0.5, speed: 900, slant: 0.22, streak: 16, wide: 1.4 });
        veil(g, W, H, t, k, 'rgba(40,70,100,0.16)', 2, 20, 0.5);
        break;
      case 'mist':
        veil(g, W, H, t, k, 'rgba(196,214,226,0.20)', 5, 9, 0.85);
        break;
      case 'sun': {
        const gr = ctx.createLinearGradient(0, 0, W * 0.7, H);
        gr.addColorStop(0, 'rgba(255,240,190,' + (0.20 * k).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(255,240,190,0)');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        break;
      }
      case 'heat': {
        // rising shimmer bars — cheap stand-in for refraction
        ctx.globalAlpha = 0.10 * k; ctx.fillStyle = '#ffd9a0';
        for (let i = 0; i < 26; i++) {
          const x = (i / 26) * W + Math.sin(t * 1.6 + i) * 10;
          const h = H * (0.2 + wRnd(i, 11) * 0.5);
          ctx.fillRect(x, H - h - ((t * 26 + i * 40) % H) * 0.2, 3, h);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'ash':
        veil(g, W, H, t, k, 'rgba(60,50,46,0.26)', 3, 16, 0.8);
        fall(g, W, H, t, k, { n: 130, color: '#c9bfb4', alpha: 0.55, speed: 120, slant: 0.35, size: 1.8 });
        break;
      case 'ember':
        fall(g, W, H, t, k, { n: 90, color: '#ff9a4a', alpha: 0.65, speed: 260, slant: -0.9, size: 1.9 });
        veil(g, W, H, t, k, 'rgba(120,40,10,0.12)', 2, 26, 0.6);
        break;
      case 'snow':
        fall(g, W, H, t, k, { n: 140, color: '#eef6ff', alpha: 0.75, speed: 150, slant: 0.25, size: 2.1 });
        break;
      case 'blizzard':
        veil(g, W, H, t, k, 'rgba(226,238,250,0.30)', 4, 46, 0.9);
        fall(g, W, H, t, k, { n: 240, color: '#ffffff', alpha: 0.85, speed: 520, slant: -0.85, streak: 12, wide: 1.6 });
        break;
      case 'aurora': {
        for (let i = 0; i < 3; i++) {
          const gr = ctx.createLinearGradient(0, H * (0.05 + i * 0.12), 0, H * (0.42 + i * 0.12));
          gr.addColorStop(0, 'rgba(120,255,200,0)');
          gr.addColorStop(0.5, 'rgba(120,255,200,' + (0.13 * k).toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(150,180,255,0)');
          ctx.fillStyle = gr;
          ctx.save();
          ctx.translate(Math.sin(t * 0.22 + i) * W * 0.12, 0);
          ctx.fillRect(-W * 0.2, 0, W * 1.4, H);
          ctx.restore();
        }
        break;
      }
      case 'devils': {
        ctx.globalAlpha = 0.30 * k; ctx.fillStyle = '#c89a6a';
        for (let i = 0; i < 4; i++) {
          const cx2 = ((wRnd(i, 21) * W + t * (30 + i * 12)) % (W + 200)) - 100;
          const cy2 = H * (0.3 + wRnd(i, 22) * 0.5);
          for (let s = 0; s < 9; s++) {
            const rr = 6 + s * 4.5;
            ctx.beginPath();
            ctx.ellipse(cx2 + Math.sin(t * 3 + s * 0.7 + i) * s * 2.2, cy2 - s * 13, rr, rr * 0.5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'duststorm':
        veil(g, W, H, t, k, 'rgba(160,104,54,0.38)', 5, 60, 0.95);
        fall(g, W, H, t, k, { n: 170, color: '#e0b184', alpha: 0.5, speed: 700, slant: 0.9, streak: 22, wide: 1.2 });
        break;
      case 'frost':
        fall(g, W, H, t, k, { n: 110, color: '#dfeaf2', alpha: 0.55, speed: 110, slant: 0.1, size: 1.5 });
        break;
      case 'lightning': {
        veil(g, W, H, t, k, 'rgba(40,44,72,0.26)', 3, 34, 0.7);
        // strikes on a fixed cadence — same moment for everyone watching
        const beat = Math.floor(t * 0.7);
        const f = t * 0.7 - beat;
        if (wRnd(beat, 31) > 0.45 && f < 0.16) {
          const flash = (1 - f / 0.16);
          ctx.globalAlpha = 0.5 * flash * k; ctx.fillStyle = '#e8f0ff';
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = 0.9 * flash * k;
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
          const bx = wRnd(beat, 32) * W;
          ctx.beginPath(); ctx.moveTo(bx, 0);
          let yy = 0, xx = bx;
          while (yy < H * 0.7) { yy += H * 0.13; xx += (wRnd(beat + yy, 33) - 0.5) * 70; ctx.lineTo(xx, yy); }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        break;
      }
      case 'shear': {
        ctx.globalAlpha = 0.22 * k; ctx.strokeStyle = '#dbe6ff'; ctx.lineWidth = 2;
        for (let i = 0; i < 34; i++) {
          const y = wRnd(i, 41) * H;
          const len = 70 + wRnd(i, 42) * 190;
          const x = ((wRnd(i, 43) * W + t * (420 + wRnd(i, 44) * 260)) % (W + 300)) - 150;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + 5); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'spot':
        veil(g, W, H, t, k, 'rgba(150,52,40,0.30)', 4, 40, 0.85);
        fall(g, W, H, t, k, { n: 120, color: '#ffb890', alpha: 0.4, speed: 560, slant: -0.7, streak: 18, wide: 1.3 });
        break;
      case 'meteor': {
        ctx.globalAlpha = 0.9 * k; ctx.strokeStyle = '#ffe9c0'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const per = 3.4 + wRnd(i, 51) * 3;
          const f = ((t + wRnd(i, 52) * per) % per) / per;
          if (f > 0.55) continue;
          const a = f / 0.55;
          const x = -120 + a * (W + 260) + wRnd(i, 53) * 120;
          const y = wRnd(i, 54) * H * 0.7 + a * 130;
          ctx.globalAlpha = 0.9 * k * Math.sin(a * Math.PI);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 46, y - 26); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'ringshadow': {
        // hard-edged bands of shade, as if the rings were between you and the sun
        ctx.globalAlpha = 0.30 * k; ctx.fillStyle = '#0a1020';
        for (let i = 0; i < 5; i++) {
          const h = H * (0.05 + wRnd(i, 61) * 0.07);
          const y = ((wRnd(i, 62) * H + t * 7) % (H + h * 2)) - h;
          ctx.save(); ctx.translate(W / 2, y); ctx.rotate(-0.22);
          ctx.fillRect(-W, 0, W * 2, h);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'icefog':
        veil(g, W, H, t, k, 'rgba(198,224,240,0.24)', 4, 14, 0.85);
        fall(g, W, H, t, k, { n: 80, color: '#eaf6ff', alpha: 0.5, speed: 90, slant: 0.05, size: 1.4 });
        break;
    }
    ctx.restore();
  }

  // ── Death pop ─────────────────────────────────────────
  // A quick ring that expands and fades, plus a few chunks thrown outward in the
  // faction's colour. Short on purpose (0.34s): long enough to register the kill,
  // short enough that a big fight doesn't turn into soup.
  const POP_LIFE = 0.34;
  function drawPop(f) {
    if (REDUCED) return;
    const prog = 1 - Math.max(0, f.t) / POP_LIFE;      // 0 → 1
    if (prog < 0 || prog > 1) return;
    const tint = (RC.RACES[f.race] && RC.RACES[f.race].tint) || '#cfd8e4';
    const R = f.r || 10;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.globalAlpha = (1 - prog) * 0.75;
    ctx.strokeStyle = tint;
    ctx.lineWidth = Math.max(1, 2.6 * (1 - prog));
    ctx.beginPath(); ctx.arc(0, 0, R * (0.5 + prog * 1.5), 0, Math.PI * 2); ctx.stroke();
    // chunks — deterministic per-fx so they don't jitter from frame to frame
    const seed = (f.x * 7 + f.y * 13) | 0;
    ctx.fillStyle = tint;
    ctx.globalAlpha = (1 - prog) * 0.85;
    for (let i = 0; i < 5; i++) {
      const a = ((seed + i * 73) % 360) * Math.PI / 180;
      const d = R * (0.4 + prog * 1.35);
      const s = Math.max(0.6, R * 0.2 * (1 - prog));
      ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(a) * d * 0.7, s, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Off-screen attack arrows ──────────────────────────
  // A minimap ring only helps a player who is looking at the minimap. When the fight is
  // outside the viewport, put a red chevron on the screen edge pointing at it, so the
  // information reaches someone whose eyes are on their own base.
  function drawAlertArrows(g, W, H) {
    if (!g.alerts || !g.alerts.length) return;
    const z = camZoom(g);
    const vw = W / z, vh = H / z, pad = 46;
    ctx.save();
    for (const a of g.alerts) {
      const sxp = (a.x - g.camera.x) * z, syp = (a.y - g.camera.y) * z;
      if (sxp >= 0 && sxp <= W && syp >= 0 && syp <= H) continue;   // already on screen
      const cx = W / 2, cy = H / 2;
      let dx = sxp - cx, dy = syp - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const ex = Math.max(pad, Math.min(W - pad, cx + dx * (W / 2 - pad)));
      const ey = Math.max(pad, Math.min(H - pad, cy + dy * (H / 2 - pad)));
      const pulse = 0.5 + 0.5 * Math.sin((g.time - a.born) * 7);
      ctx.globalAlpha = 0.55 + pulse * 0.45;
      ctx.translate(ex, ey); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#ff5a3c';
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -11); ctx.lineTo(-10, 11); ctx.closePath(); ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── 종족 얼굴 (시작 화면 종족 선택용) ────────────────
  // Draws a faction's hero as a neutral "face" so players can see who they're
  // picking. Colours come from the RACE TINT rather than a player colour, so the
  // three factions read as visually distinct on the picker.
  function raceFaceColors(raceId) {
    const r = RC.RACES[raceId] || RC.RACES.forge;
    const base = r.tint;
    // Must carry EVERY key the sprite functions read, because these menu portraits go
    // through the same drawUnitSprite() path as in-match units. Two were missing:
    //   ink      — inkLine()'s outline colour. An undefined strokeStyle is silently
    //              ignored by canvas, so outlines were drawn in whatever colour
    //              happened to be left over from the previous shape.
    //   opticRGB — softGlow() interpolates it straight into 'rgba(' + rgb + ',1)'.
    //              Undefined produced the literal string 'rgba(undefined,1)', which
    //              addColorStop rejects with a SyntaxError — and since these faces are
    //              built during buildStartScreen(), that threw before the menu finished
    //              wiring up and tripped the global error boundary on every load.
    const c = {
      body:  base,
      light: shade(base, 0.32),
      dark:  shade(base, -0.46),
      trim:  shade(base, 0.55),
      steel: '#9fb1c6',
      eye:   C.node,
      ink:   shade(base, -0.72),
      opticRGB: '255,90,60',
      psi:   PSI,
    };
    if (raceId === 'gloop')       { c.steel = mix(c.steel, GLOOP_TINT, 0.42);  c.eye = '#c9ff8f'; c.opticRGB = '150,255,90'; }
    else if (raceId === 'aether') { c.steel = mix(c.steel, AETHER_TINT, 0.46); c.eye = PSI_HOT;   c.opticRGB = '210,170,255'; }
    else                          { c.steel = mix(c.steel, FORGE_TINT, 0.30); c.opticRGB = '255,90,60'; }
    return c;
  }

  // ── 행성 지구본 (맵 선택용) ─────────────────────────
  // The map picker used to show a flat top-down thumbnail of the playfield. It was
  // honest but unreadable at 224x150 — eight dark rectangles with dots on them, none
  // of which said "this is Mars". A lit globe makes each map instantly recognisable
  // from across the room, which is what a picker is actually for. The tactical layout
  // is still one click away on the map itself.
  //
  // Everything is seeded off the map id, so a planet looks identical on every visit
  // and never shimmers between frames.
  function seedRnd(seed) {
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  // Per-planet identity. Falls back to the map's own ground/bg colours for anything
  // not listed, so a new map still gets a sensible globe with no extra work.
  const PLANET = {
    earth:   { base: '#1d4e78', land: '#2f7a45', land2: '#245f36', cap: '#dceaf2', air: '#7fc4ff', look: 'continents', spin: 0.10 },
    venus:   { base: '#b8792c', land: '#d8a34a', land2: '#8f5520', cap: null,      air: '#ffd08a', look: 'swirl',      spin: 0.05 },
    mars:    { base: '#9c4526', land: '#7d3419', land2: '#c2683a', cap: '#f0e6dc', air: '#ff9c6b', look: 'craters',    spin: 0.11 },
    jupiter: { base: '#b98a5e', land: '#8d6340', land2: '#dcb98a', cap: null,      air: '#ffca94', look: 'bands',      spin: 0.16 },
    saturn:  { base: '#c9a870', land: '#a8874f', land2: '#e3ca9a', cap: null,      air: '#ffe0aa', look: 'bands',      spin: 0.14, ring: true },
    neptune: { base: '#2a4f9e', land: '#1e3b78', land2: '#4a74c6', cap: null,      air: '#8fb6ff', look: 'bands',      spin: 0.12 },
    pluto:   { base: '#8a7d70', land: '#6d6055', land2: '#cbbfae', cap: '#e8e2d8', air: '#cfd8e4', look: 'patches',    spin: 0.07 },
    ceres:   { base: '#6d6a66', land: '#565350', land2: '#8b8783', cap: null,      air: '#b8bec6', look: 'craters',    spin: 0.09 },
  };

  function planetStyle(map) {
    const p = PLANET[map.id];
    if (p) return p;
    const base = map.ground || '#3a4757';
    return { base, land: shade(base, -0.28), land2: shade(base, 0.26), cap: null,
             air: shade(base, 0.5), look: 'patches', spin: 0.09 };
  }

  // canvas: any 2D canvas. t: seconds (drives the spin). Safe to call every frame.
  function drawPlanet(canvas, map, t) {
    if (!canvas || !map) return;
    const c2 = canvas.getContext('2d');
    if (!c2) return;
    const W = canvas.width, H = canvas.height;
    const S = planetStyle(map);
    const rnd = seedRnd(map.id || 'x');
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * (S.ring ? 0.33 : 0.40);
    const spin = (t || 0) * S.spin;

    c2.clearRect(0, 0, W, H);
    // ── space + stars ──
    c2.fillStyle = '#05080f';
    c2.fillRect(0, 0, W, H);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W, y = rnd() * H, a = 0.18 + rnd() * 0.62, s = rnd() < 0.85 ? 0.8 : 1.5;
      c2.globalAlpha = a; c2.fillStyle = '#dfe9ff';
      c2.beginPath(); c2.arc(x, y, s, 0, Math.PI * 2); c2.fill();
    }
    c2.globalAlpha = 1;

    // ── ring, back half (behind the planet) ──
    if (S.ring) drawRing(c2, cx, cy, R, S, true);

    // ── globe body ──
    c2.save();
    c2.beginPath(); c2.arc(cx, cy, R, 0, Math.PI * 2); c2.clip();
    c2.fillStyle = S.base;
    c2.fillRect(cx - R, cy - R, R * 2, R * 2);

    // Surface features live in a band of longitudes; drawing each twice, one wrap
    // apart, makes the surface scroll seamlessly as the planet turns.
    const span = R * 2.6;
    const off = ((spin * span) % span);
    for (const pass of [0, 1]) {
      const dx = off - pass * span;
      c2.save(); c2.translate(dx, 0);
      surface(c2, cx, cy, R, S, seedRnd((map.id || 'x') + pass));
      c2.restore();
    }

    // polar caps sit still — they don't rotate with the surface
    if (S.cap) {
      c2.fillStyle = S.cap; c2.globalAlpha = 0.9;
      c2.beginPath(); c2.ellipse(cx, cy - R * 0.98, R * 0.62, R * 0.24, 0, 0, Math.PI * 2); c2.fill();
      c2.beginPath(); c2.ellipse(cx, cy + R * 1.0, R * 0.54, R * 0.2, 0, 0, Math.PI * 2); c2.fill();
      c2.globalAlpha = 1;
    }

    // ── lighting: lit from upper-left, hard terminator on the lower-right limb ──
    const lit = c2.createRadialGradient(cx - R * 0.42, cy - R * 0.44, R * 0.1, cx, cy, R * 1.16);
    lit.addColorStop(0, 'rgba(255,255,255,0.30)');
    lit.addColorStop(0.42, 'rgba(255,255,255,0.02)');
    lit.addColorStop(0.72, 'rgba(0,0,0,0.34)');
    lit.addColorStop(1, 'rgba(0,0,0,0.80)');
    c2.fillStyle = lit;
    c2.fillRect(cx - R, cy - R, R * 2, R * 2);
    c2.restore();

    // ── atmosphere rim ──
    c2.save();
    c2.globalAlpha = 0.55;
    c2.strokeStyle = S.air; c2.lineWidth = Math.max(1.5, R * 0.05);
    c2.beginPath(); c2.arc(cx, cy, R - c2.lineWidth * 0.3, 0, Math.PI * 2); c2.stroke();
    c2.globalAlpha = 0.18;
    c2.lineWidth = Math.max(2, R * 0.13);
    c2.beginPath(); c2.arc(cx, cy, R + c2.lineWidth * 0.4, 0, Math.PI * 2); c2.stroke();
    c2.restore();

    // ── ring, front half ──
    if (S.ring) drawRing(c2, cx, cy, R, S, false);

    // ── start positions — still the one piece of tactical information worth keeping ──
    const cols = [C.p1_body, C.p2_body, C.p3_body, C.p4_body];
    const sp = map.spawns || [];
    const wsz = (map.world && map.world.w) || 3200, hsz = (map.world && map.world.h) || 2400;
    sp.slice(0, 4).forEach((s, i) => {
      // place each spawn on the visible face, keeping its rough quadrant
      const u = (s.x / wsz - 0.5) * 1.35, v = (s.y / hsz - 0.5) * 1.35;
      const x = cx + u * R, y = cy + v * R;
      c2.fillStyle = cols[i % 4];
      c2.globalAlpha = 0.95;
      c2.beginPath(); c2.arc(x, y, Math.max(2.6, R * 0.075), 0, Math.PI * 2); c2.fill();
      c2.globalAlpha = 0.35;
      c2.beginPath(); c2.arc(x, y, Math.max(4.5, R * 0.13), 0, Math.PI * 2); c2.fill();
      c2.globalAlpha = 1;
    });
  }

  // Surface detail, clipped to the globe by the caller.
  function surface(c2, cx, cy, R, S, rnd) {
    if (S.look === 'bands') {
      // Horizontal cloud belts, thickest at the equator like a real gas giant.
      for (let i = 0; i < 9; i++) {
        const yy = cy - R + (i + 0.5) * (R * 2 / 9);
        const h = R * (0.09 + rnd() * 0.11);
        c2.fillStyle = i % 2 ? S.land : S.land2;
        c2.globalAlpha = 0.5 + rnd() * 0.3;
        c2.beginPath(); c2.ellipse(cx, yy, R * 1.25, h, 0, 0, Math.PI * 2); c2.fill();
      }
      // the storm
      c2.globalAlpha = 0.85; c2.fillStyle = shade(S.land, -0.25);
      c2.beginPath(); c2.ellipse(cx + R * 0.28, cy + R * 0.24, R * 0.3, R * 0.16, 0, 0, Math.PI * 2); c2.fill();
      c2.globalAlpha = 1;
    } else if (S.look === 'swirl') {
      for (let i = 0; i < 7; i++) {
        c2.globalAlpha = 0.28 + rnd() * 0.3;
        c2.fillStyle = i % 2 ? S.land : S.land2;
        const yy = cy - R + rnd() * R * 2;
        c2.beginPath();
        c2.ellipse(cx + (rnd() - 0.5) * R, yy, R * (0.5 + rnd() * 0.7), R * (0.07 + rnd() * 0.1),
                   (rnd() - 0.5) * 0.5, 0, Math.PI * 2);
        c2.fill();
      }
      c2.globalAlpha = 1;
    } else if (S.look === 'craters') {
      c2.globalAlpha = 0.5;
      for (let i = 0; i < 7; i++) {
        c2.fillStyle = S.land;
        const x = cx + (rnd() - 0.5) * R * 1.7, y = cy + (rnd() - 0.5) * R * 1.7;
        const r = R * (0.1 + rnd() * 0.2);
        c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill();
        c2.fillStyle = S.land2; c2.globalAlpha = 0.35;
        c2.beginPath(); c2.arc(x - r * 0.18, y - r * 0.2, r * 0.62, 0, Math.PI * 2); c2.fill();
        c2.globalAlpha = 0.5;
      }
      c2.globalAlpha = 1;
    } else if (S.look === 'continents') {
      // lumpy landmasses built from overlapping discs, then a few cloud streaks
      c2.fillStyle = S.land;
      for (let i = 0; i < 5; i++) {
        const bx = cx + (rnd() - 0.5) * R * 1.6, by = cy + (rnd() - 0.5) * R * 1.5;
        c2.globalAlpha = 0.92;
        for (let k = 0; k < 5; k++) {
          c2.beginPath();
          c2.arc(bx + (rnd() - 0.5) * R * 0.6, by + (rnd() - 0.5) * R * 0.5, R * (0.12 + rnd() * 0.17), 0, Math.PI * 2);
          c2.fill();
        }
      }
      c2.fillStyle = S.land2; c2.globalAlpha = 0.5;
      for (let i = 0; i < 3; i++) {
        c2.beginPath();
        c2.arc(cx + (rnd() - 0.5) * R * 1.4, cy + (rnd() - 0.5) * R * 1.4, R * (0.08 + rnd() * 0.12), 0, Math.PI * 2);
        c2.fill();
      }
      c2.fillStyle = '#ffffff'; c2.globalAlpha = 0.22;
      for (let i = 0; i < 4; i++) {
        c2.beginPath();
        c2.ellipse(cx + (rnd() - 0.5) * R * 1.6, cy + (rnd() - 0.5) * R * 1.6,
                   R * (0.24 + rnd() * 0.3), R * 0.07, (rnd() - 0.5) * 0.6, 0, Math.PI * 2);
        c2.fill();
      }
      c2.globalAlpha = 1;
    } else {
      c2.globalAlpha = 0.55;
      for (let i = 0; i < 8; i++) {
        c2.fillStyle = i % 2 ? S.land : S.land2;
        c2.beginPath();
        c2.ellipse(cx + (rnd() - 0.5) * R * 1.6, cy + (rnd() - 0.5) * R * 1.6,
                   R * (0.14 + rnd() * 0.22), R * (0.1 + rnd() * 0.16), rnd() * 3, 0, Math.PI * 2);
        c2.fill();
      }
      c2.globalAlpha = 1;
    }
  }

  // Saturn's rings, split so the planet sits between the far and near halves.
  function drawRing(c2, cx, cy, R, S, back) {
    const rx = R * 2.05, ry = R * 0.52, tilt = -0.34;
    c2.save();
    c2.translate(cx, cy); c2.rotate(tilt);
    c2.beginPath();
    c2.rect(-rx * 1.2, back ? -ry * 1.4 : 0, rx * 2.4, ry * 1.4);
    c2.clip();
    const bands = [[1.00, 0.55, S.land2], [0.90, 0.30, S.base], [0.80, 0.5, S.land], [0.70, 0.22, S.land2]];
    for (const [k, a, col] of bands) {
      c2.strokeStyle = col;
      c2.globalAlpha = back ? a * 0.55 : a;
      c2.lineWidth = R * 0.12;
      c2.beginPath(); c2.ellipse(0, 0, rx * k, ry * k, 0, 0, Math.PI * 2); c2.stroke();
    }
    c2.globalAlpha = 1;
    c2.restore();
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

  // ── 메뉴 히어로 (시작 화면 아이들 애니메이션) ────────────────
  // The player's own hero, alive on the main menu: it looks around, breathes, and
  // waves at you every few seconds. This is the one place the menu says "this is
  // YOURS" rather than "here are the factions", so it is worth the frames.
  //
  // Heroes are no longer bound to a race, so the palette is built in two layers:
  // the HERO owns its identity colours (body/light/dark/trim/ink) and the RACE only
  // tints the shared hardware (steel/eye/optic/psi). Starting from raceFaceColors()
  // rather than an object literal is deliberate — that function is the one place
  // guaranteed to emit all nine keys, and a missing key here would reach softGlow()
  // as 'rgba(undefined,1)' and throw out of the menu build. See its comment.
  // One signature colour per hero, and every hero in RC.HEROES needs an entry or
  // heroIdleColors falls back to Rook's and two heroes silently look identical.
  const HERO_TINT = {
    rook: '#c8703a', thorn: '#7cc23f', prism: '#9a7cf0',
    ember: '#e0562b', vale: '#3fc2b8',
  };
  function heroIdleColors(heroId, raceId, cos) {
    const c = raceFaceColors(raceId || 'forge');
    const base = HERO_TINT[heroId] || HERO_TINT.rook;
    c.body = base;
    c.light = shade(base, 0.32);
    c.dark = shade(base, -0.46);
    c.trim = shade(base, 0.55);
    c.ink = shade(base, -0.72);
    // Full strength on the menu: there is no enemy here to be confused with, so the
    // player sees exactly the colour they bought. In a match the same skin is clamped —
    // see applyCosmeticPalette and RC.COSMETIC_SAFE.
    return applyCosmeticPalette(c, cos, 1);
  }

  // The waving arm. Drawn OVER the sprite rather than inside each hero's draw
  // function, so all three heroes (and any hero added later) get the wave for free
  // and none of the in-match sprite code has to know the menu exists.
  //
  // Angles are canvas convention (y down). The raise interpolates BACKWARD through
  // ~pi rather than forward through 0: both paths end in the same place, but the
  // forward one sweeps the hand out through the hero's face on the way up.
  function drawMenuWave(R, c, wave, t) {
    if (wave <= 0.001) return;
    const sx = -R * 0.34, sy = -R * 0.34;      // shoulder, on the near side
    const REST = 1.95, UP = 4.35;
    const e = wave * wave * (3 - 2 * wave);    // smoothstep, so the raise has weight
    const a1 = REST + (UP - REST) * e;
    const ex = sx + Math.cos(a1) * R * 0.62, ey = sy + Math.sin(a1) * R * 0.62;
    const a2 = a1 - 0.5 + Math.sin(t * 9) * 0.5 * e;
    const hx = ex + Math.cos(a2) * R * 0.56, hy = ey + Math.sin(a2) * R * 0.56;

    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = c.ink; ctx.lineWidth = R * 0.34;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.strokeStyle = c.dark; ctx.lineWidth = R * 0.23;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = c.body; ctx.lineWidth = R * 0.21;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.fillStyle = c.trim;
    ctx.beginPath(); ctx.arc(hx, hy, R * 0.19, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c.ink; ctx.lineWidth = R * 0.07; ctx.stroke();
    ctx.restore();
  }

  // canvas: any sized canvas. heroId: any id in RC.HEROES.
  // raceId only tints the hardware — the hero is the same hero whichever race it
  // deploys with, which is the whole point of decoupling the two.
  // cos: what this hero is wearing, { hat, suit, shoes, palette }; optional.
  function drawHeroIdle(canvas, heroId, raceId, cos) {
    const def = RC.UNITS[heroId];
    if (!canvas || !def) return;
    const pctx = canvas.getContext('2d');
    if (!pctx) return;
    const W = canvas.width, H = canvas.height;
    const race = RC.RACES[raceId] || RC.RACES.forge;
    const saved = ctx;
    ctx = pctx;                                // 스프라이트 함수들이 쓰는 모듈 ctx를 잠시 교체
    try {
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W / 2, H * 0.46, 2, W / 2, H * 0.5, H * 0.92);
      bg.addColorStop(0, mix(race.tint, '#05080e', 0.70));
      bg.addColorStop(1, 'rgba(5,8,14,0)');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

      const c = heroIdleColors(heroId, raceId, cos);
      const t = performance.now() / 1000;

      // Wave envelope — a 5.2s cycle that is mostly REST. A hero waving continuously
      // reads as a broken loop; one that waves occasionally reads as alive.
      const PERIOD = 5.2, HOLD = 2.3, EDGE = 0.5;
      const ph = t % PERIOD;
      const wave = ph >= HOLD ? 0
        : Math.max(0, Math.min(1, Math.min(ph / EDGE, (HOLD - ph) / EDGE)));
      const look = Math.sin(t * 0.75);         // head/body turn, left to right

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      ctx.translate(W / 2, H * 0.62 + Math.sin(t * 1.9) * H * 0.018);   // 숨쉬는 듯한 흔들림
      const scale = (Math.min(W, H) * 0.30) / Math.max(7, def.r);
      ctx.scale(scale, scale);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';                               // 바닥 그림자
      ctx.beginPath(); ctx.ellipse(0, def.r * 1.28, def.r * 1.2, def.r * 0.4, 0, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(look * def.r * 0.10, 0);
      ctx.rotate(look * 0.07);
      drawUnitSprite({ type: heroId, def: def, r: def.r, cos: cos }, c);
      drawMenuWave(def.r * 1.30, c, wave, t);   // same R the sprite body was drawn at
      ctx.restore();
      ctx.restore();
    } finally {
      ctx = saved;
    }
  }

  return { init, draw, drawPortrait, drawRaceFace, drawPlanet, drawHeroIdle, heroRig };
})();
