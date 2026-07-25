// RIFT CLASH — 맵 정의 / Maps
// 세 개의 행성: 지구형(산·강·숲) / 작열 행성(사막·메사·용암) / 얼음 행성(빙벽·눈·온천).
// 규칙은 어느 행성에서나 같고 (고지/저지/엄폐/감속/분출구), 겉모습과 이름만 바뀐다.
// 지형 외곽선은 원이 아니라 흔들린 다각형이라 자연스럽게 보인다.
window.RC = window.RC || {};

// ── 자연스러운 외곽선 만들기 ───────────────────────────
// 시드 기반이라 클라이언트와 서버가 항상 같은 모양을 만든다 (통신 불필요).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
// 울퉁불퉁한 덩어리 — 언덕, 숲, 바위밭 등
function blob(cx, cy, r, seed, wob, n) {
  const rnd = rng(seed);
  const pts = [];
  n = n || 13; wob = wob == null ? 0.34 : wob;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 - wob * 0.5 + rnd() * wob);
    pts.push([Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr)]);
  }
  return pts;
}
// 구불구불한 띠 — 강, 모래 능선, 눈길 등 (중심선을 따라 폭을 흔든다)
function ribbon(line, halfW, seed, wob) {
  const rnd = rng(seed);
  const left = [], right = [];
  wob = wob == null ? 0.4 : wob;
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const w = halfW * (1 - wob * 0.5 + rnd() * wob);
    left.push([Math.round(p[0] + nx * w), Math.round(p[1] + ny * w)]);
    right.unshift([Math.round(p[0] - nx * w), Math.round(p[1] - ny * w)]);
  }
  return left.concat(right);
}
// 흩어진 바위 — 자연스럽게 어질러진 장애물 무리
function rocks(cx, cy, spread, count, size, seed) {
  const rnd = rng(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * spread;
    const s = size * (0.6 + rnd() * 0.8);
    out.push({
      x: Math.round(cx + Math.cos(a) * d), y: Math.round(cy + Math.sin(a) * d),
      w: Math.round(s), h: Math.round(s * (0.7 + rnd() * 0.6)),
    });
  }
  return out;
}
// 지형 다각형에 바운딩 박스를 붙인다 (game이 매 틱 조회하므로 미리 계산)
RC.prepZone = function (z) {
  if (z.poly && !z.bb) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of z.poly) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    z.bb = [x0, y0, x1, y1];
  }
  return z;
};

RC.MAPS = [
  // ══ 1. 지구형 행성 — 초록 들판, 푸른 강, 산등성이 ══════
  {
    id: 'earth',
    biome: 'earth',
    name: 'Earth',
    desc: 'Home. Green hills, deep woods and a winding river — cross the water slowly, or hold the high ground.',
    world: { w: 3200, h: 2400 },
    bg: '#0c1a18', ground: '#1b3a2c',
    spawns: [
      { x: 460, y: 1940 }, { x: 2740, y: 460 },
      { x: 460, y: 460 }, { x: 2740, y: 1940 },
    ],
    // 배경 얼룩 — 풀밭과 얕은 못
    terrain: [
      { poly: blob(900, 700, 420, 101, 0.5), color: '#20452f' },
      { poly: blob(2350, 1750, 460, 102, 0.5), color: '#20452f' },
      { poly: blob(2500, 620, 260, 103, 0.55), color: '#1d4a45' },
      { poly: blob(700, 1800, 240, 104, 0.55), color: '#1d4a45' },
    ],
    zones: [
      // 지도를 남북으로 가르는 강 — 건너려면 느려진다
      { t: 'mud', poly: ribbon([[1600, -60], [1500, 500], [1670, 1000], [1560, 1500], [1680, 2000], [1580, 2460]], 130, 11) },
      // 강 양쪽의 산등성이 (고지)
      { t: 'high', poly: blob(1000, 1000, 250, 21, 0.36) },
      { t: 'high', poly: blob(2200, 1420, 250, 22, 0.36) },
      // 움푹 팬 골짜기 (저지)
      { t: 'low', poly: blob(2180, 760, 200, 23, 0.4) },
      { t: 'low', poly: blob(1020, 1660, 200, 24, 0.4) },
      // 측면의 숲
      { t: 'forest', poly: blob(640, 1450, 250, 25, 0.42) },
      { t: 'forest', poly: blob(2560, 1000, 250, 26, 0.42) },
      // 강 한가운데의 리프트 샘
      { t: 'vent', poly: blob(1600, 1200, 165, 27, 0.3) },
    ],
    // 산비탈의 바위 — 자연스럽게 흩어진 장애물
    obstacles: [].concat(
      rocks(1010, 1010, 150, 4, 105, 31),
      rocks(2210, 1430, 150, 4, 105, 32),
      rocks(1600, 560, 120, 3, 90, 33),
      rocks(1600, 1860, 120, 3, 90, 34)
    ),
    midNodes: [
      { x: 1600, y: 1200, n: 4, rad: 130 },
      { x: 880, y: 1000, n: 3, rad: 95 },
      { x: 2320, y: 1420, n: 3, rad: 95 },
    ],
  },

  // ══ 2. 작열 행성 — 붉은 사막, 메사, 용암 분출구 ════════
  {
    id: 'venus',
    biome: 'ember',
    name: 'Venus',
    desc: 'The hottest planet. Scorched orange rock and not a drop of water — climb the mesas, avoid the deep sand.',
    world: { w: 3400, h: 2400 },
    bg: '#3a1a10', ground: '#7a4028',
    spawns: [
      { x: 520, y: 520 }, { x: 2880, y: 1880 },
      { x: 2880, y: 520 }, { x: 520, y: 1880 },
    ],
    terrain: [
      { poly: blob(1700, 1200, 520, 201, 0.45), color: '#8c4b2c' },
      { poly: blob(900, 1700, 330, 202, 0.5), color: '#8a4d2e' },
      { poly: blob(2500, 700, 330, 203, 0.5), color: '#8a4d2e' },
      { poly: blob(1700, 400, 280, 204, 0.5), color: '#6d3620' },
      { poly: blob(1700, 2000, 280, 205, 0.5), color: '#6d3620' },
    ],
    zones: [
      // 사막을 가로지르는 깊은 모래 — 발이 푹푹 빠진다
      { t: 'mud', poly: ribbon([[-60, 1500], [700, 1380], [1500, 1560], [2300, 1380], [3060, 1520], [3460, 1440]], 150, 41) },
      { t: 'mud', poly: ribbon([[-60, 820], [800, 900], [1600, 720], [2400, 900], [3460, 800]], 120, 42) },
      // 평평한 꼭대기의 메사 (고지)
      { t: 'high', poly: blob(1700, 760, 245, 43, 0.3) },
      { t: 'high', poly: blob(1700, 1640, 245, 44, 0.3) },
      { t: 'high', poly: blob(700, 1200, 215, 45, 0.32) },
      { t: 'high', poly: blob(2700, 1200, 215, 46, 0.32) },
      // 꺼진 웅덩이 (저지)
      { t: 'low', poly: blob(1150, 480, 200, 47, 0.42) },
      { t: 'low', poly: blob(2250, 1920, 200, 48, 0.42) },
      // 바위밭 — 사막의 엄폐물
      { t: 'forest', poly: blob(1120, 1180, 235, 49, 0.46) },
      { t: 'forest', poly: blob(2280, 1220, 235, 50, 0.46) },
      // 한가운데의 마그마 분출구
      { t: 'vent', poly: blob(1700, 1200, 170, 51, 0.28) },
    ],
    obstacles: [].concat(
      rocks(1120, 1180, 170, 5, 100, 61),
      rocks(2280, 1220, 170, 5, 100, 62),
      rocks(1700, 760, 130, 3, 115, 63),
      rocks(1700, 1640, 130, 3, 115, 64),
      rocks(700, 1200, 110, 3, 95, 65),
      rocks(2700, 1200, 110, 3, 95, 66)
    ),
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 140 },
      { x: 1150, y: 1650, n: 3, rad: 95 },
      { x: 2250, y: 750, n: 3, rad: 95 },
    ],
  },

  // ══ 3. 얼음 행성 — 검푸른 하늘, 빙벽, 온천 ═════════════
  {
    id: 'pluto',
    biome: 'ice',
    name: 'Pluto',
    desc: 'Frozen and far from the sun. Deep snow drags you down; the ice ridges and hot springs are worth fighting for.',
    world: { w: 3400, h: 2400 },
    bg: '#050a12', ground: '#101d2e',
    spawns: [
      { x: 520, y: 1200 }, { x: 2880, y: 1200 },
      { x: 1700, y: 480 }, { x: 1700, y: 1920 },
    ],
    terrain: [
      { poly: blob(1700, 1200, 500, 301, 0.45), color: '#16293e' },
      { poly: blob(760, 620, 320, 302, 0.5), color: '#1b3348' },
      { poly: blob(2640, 1780, 320, 303, 0.5), color: '#1b3348' },
      { poly: blob(760, 1780, 300, 304, 0.5), color: '#14263a' },
      { poly: blob(2640, 620, 300, 305, 0.5), color: '#14263a' },
    ],
    zones: [
      // 깊은 눈 — 허벅지까지 빠진다
      { t: 'mud', poly: ribbon([[-60, 1200], [600, 1080], [1150, 1260], [1700, 1080], [2250, 1260], [2800, 1100], [3460, 1220]], 140, 71) },
      // 솟아오른 빙벽 (고지)
      { t: 'high', poly: blob(1180, 700, 240, 72, 0.34) },
      { t: 'high', poly: blob(2220, 1700, 240, 73, 0.34) },
      { t: 'high', poly: blob(2220, 700, 215, 74, 0.34) },
      { t: 'high', poly: blob(1180, 1700, 215, 75, 0.34) },
      // 크레바스 (저지)
      { t: 'low', poly: ribbon([[820, 1560], [1200, 1720], [1560, 1600]], 110, 76) },
      { t: 'low', poly: ribbon([[2580, 840], [2200, 680], [1840, 800]], 110, 77) },
      // 얼음 첨탑 숲 — 몸을 숨길 수 있다
      { t: 'forest', poly: blob(700, 1200, 235, 78, 0.44) },
      { t: 'forest', poly: blob(2700, 1200, 235, 79, 0.44) },
      // 얼음 한가운데의 온천
      { t: 'vent', poly: blob(1700, 1200, 168, 80, 0.3) },
    ],
    obstacles: [].concat(
      rocks(1180, 700, 150, 4, 100, 91),
      rocks(2220, 1700, 150, 4, 100, 92),
      rocks(2220, 700, 130, 3, 95, 93),
      rocks(1180, 1700, 130, 3, 95, 94),
      rocks(1700, 1200, 210, 4, 85, 95)
    ),
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 140 },
      { x: 1000, y: 1200, n: 3, rad: 95 },
      { x: 2400, y: 1200, n: 3, rad: 95 },
    ],
  },
];

RC.getMap = function (id) {
  return RC.MAPS.find(m => m.id === id) || RC.MAPS[0];
};

// 대전 모드: 어떤 owner가 어느 팀인지 + 누가 AI인지
// 1v1: 나(1) vs 봇(2).  2v2: 나(1)+동맹봇(3) vs 봇(2)+봇(4).
RC.MODES = {
  '1v1': {
    id: '1v1', name: '1 vs 1', count: 2,
    players: [
      { owner: 1, team: 1, ai: false },
      { owner: 2, team: 2, ai: true },
    ],
  },
  '2v2': {
    id: '2v2', name: '2 vs 2 (Team)', count: 4,
    players: [
      { owner: 1, team: 1, ai: false },
      { owner: 3, team: 1, ai: true },
      { owner: 2, team: 2, ai: true },
      { owner: 4, team: 2, ai: true },
    ],
  },
};

// ── Survival map — 얼음 협곡. 웨이브가 왼쪽에서 크리스탈로 진군한다.
RC.SURVIVAL = {
  id: 'sv_gorge', name: 'Pluto — Crystal Gorge',
  biome: 'ice',
  world: { w: 3400, h: 1600 },
  bg: '#060c14', ground: '#132133',
  enemySpawn: { x: 250, y: 800 },     // waves appear here and head for the crystal
  crystal: { x: 2430, y: 800 },       // the objective to protect
  bases: [                            // defender start positions (up to 4 — online co-op)
    { x: 2960, y: 620 },
    { x: 2960, y: 980 },
    { x: 3160, y: 800 },
    { x: 2760, y: 800 },
  ],
  nodeClusters: [
    { x: 3120, y: 400, n: 4, rad: 90 },
    { x: 3120, y: 1200, n: 4, rad: 90 },
    { x: 2560, y: 320, n: 3, rad: 80 },
    { x: 2560, y: 1280, n: 3, rad: 80 },
  ],
  terrain: [
    { poly: blob(2430, 800, 340, 401, 0.42), color: '#17304a' },
    { poly: blob(1500, 800, 260, 402, 0.5), color: '#152a40' },
  ],
  // 크리스탈 앞 빙벽에 포탑을 세우는 게 핵심 전략
  zones: [
    { t: 'high', poly: blob(2180, 520, 225, 411, 0.34) },
    { t: 'high', poly: blob(2180, 1080, 225, 412, 0.34) },
    { t: 'mud', poly: ribbon([[1180, 180], [1120, 800], [1200, 1420]], 165, 413) },
    { t: 'forest', poly: blob(1700, 360, 205, 414, 0.44) },
    { t: 'forest', poly: blob(1700, 1240, 205, 415, 0.44) },
    { t: 'low', poly: blob(1500, 800, 190, 416, 0.4) },
    { t: 'vent', poly: blob(2900, 800, 155, 417, 0.3) },
  ],
  // 위/아래 가장자리의 얼음 바위 — 가운데 통로(y ~400–1200)는 항상 열려 있다
  obstacles: [].concat(
    rocks(1480, 190, 130, 4, 105, 421),
    rocks(1480, 1410, 130, 4, 105, 422),
    rocks(900, 200, 110, 3, 95, 423),
    rocks(900, 1400, 110, 3, 95, 424)
  ),
};
