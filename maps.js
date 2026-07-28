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
    // 시작 지점은 네 모서리로. 예전에는 좌/우 시작점이 '깊은 눈'(이동속도 55%) 띠와
    // 얼음 첨탑 숲 한가운데 있었다 — 1v1 두 진영 모두 본진 전체가 늪 위였다.
    spawns: [
      { x: 520, y: 620 }, { x: 2880, y: 1780 },
      { x: 2880, y: 620 }, { x: 520, y: 1780 },
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
  // ══ 4. 화성 — 붉은 먼지, 거대 협곡, 극관 서리 ═══════════
  // The gimmick is the canyon: a huge Hollow scar across the middle that costs you
  // range and sight to cross, with the Olympus caldera as the one piece of high
  // ground everybody wants. Dust storms roll through and blind the whole map.
  {
    id: 'mars',
    biome: 'rust',
    name: 'Mars',
    desc: 'The red planet. A canyon splits the world in two and dust storms blind everyone — take the caldera before the next one hits.',
    world: { w: 3400, h: 2400 },
    bg: '#1e0d08', ground: '#6b3320',
    spawns: [
      { x: 500, y: 500 }, { x: 2900, y: 1900 },
      { x: 2900, y: 500 }, { x: 500, y: 1900 },
    ],
    terrain: [
      { poly: blob(1700, 1200, 540, 501, 0.44), color: '#7a3b24' },
      { poly: blob(700, 1200, 300, 502, 0.5), color: '#5f2c1b' },
      { poly: blob(2700, 1200, 300, 503, 0.5), color: '#5f2c1b' },
      { poly: blob(1700, 260, 340, 504, 0.5), color: '#8a5240' },   // 북극관
      { poly: blob(1700, 2140, 340, 505, 0.5), color: '#8a5240' },  // 남극관
    ],
    zones: [
      // 발레스 마리네리스 — 지도를 가로지르는 협곡. 안에서는 사거리와 시야를 잃는다.
      { t: 'low', poly: ribbon([[-60, 1180], [620, 1300], [1240, 1120], [1700, 1260], [2180, 1100], [2780, 1280], [3460, 1160]], 165, 511) },
      // 올림푸스 칼데라 — 지도에서 가장 높은 곳
      { t: 'high', poly: blob(1700, 1200, 250, 512, 0.3) },
      // 협곡 양옆 대지
      { t: 'high', poly: blob(1080, 640, 215, 513, 0.34) },
      { t: 'high', poly: blob(2320, 1760, 215, 514, 0.34) },
      // 극관 서리 — 발이 미끄러진다
      { t: 'mud', poly: blob(1700, 250, 300, 515, 0.42) },
      { t: 'mud', poly: blob(1700, 2150, 300, 516, 0.42) },
      // 무너진 바위 지대 — 엄폐물
      { t: 'forest', poly: blob(760, 1720, 230, 517, 0.46) },
      { t: 'forest', poly: blob(2640, 680, 230, 518, 0.46) },
      // 협곡 바닥의 지열 분출구
      { t: 'vent', poly: blob(1150, 1220, 150, 519, 0.3) },
      { t: 'vent', poly: blob(2250, 1180, 150, 520, 0.3) },
    ],
    obstacles: [].concat(
      rocks(1700, 1200, 200, 4, 100, 531),
      rocks(1080, 640, 140, 3, 100, 532),
      rocks(2320, 1760, 140, 3, 100, 533),
      rocks(760, 1720, 160, 4, 90, 534),
      rocks(2640, 680, 160, 4, 90, 535)
    ),
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 140 },
      { x: 1150, y: 1220, n: 3, rad: 95 },
      { x: 2250, y: 1180, n: 3, rad: 95 },
    ],
  },

  // ══ 5. 목성 — 구름 갑판, 번개, 대적점 ═══════════════════
  // No solid ground anywhere: you fight on cloud decks between jet-stream bands.
  // The bands are the map — crossing one costs you real time, so the fastest route
  // is rarely a straight line.
  {
    id: 'jupiter',
    biome: 'storm',
    name: 'Jupiter',
    desc: 'No ground, only cloud decks. Jet-stream bands drag you sideways and lightning lights the whole sky — the Great Red Spot is the prize.',
    world: { w: 3400, h: 2400 },
    bg: '#160e1e', ground: '#3d2a3f',
    spawns: [
      { x: 520, y: 620 }, { x: 2880, y: 1780 },
      { x: 2880, y: 620 }, { x: 520, y: 1780 },
    ],
    terrain: [
      { poly: blob(1700, 1200, 560, 601, 0.4), color: '#5a3444' },   // 대적점 언저리
      { poly: ribbon([[-60, 880], [900, 820], [1900, 900], [3460, 840]], 190, 602, 0.3), color: '#4a3350' },
      { poly: ribbon([[-60, 1560], [900, 1620], [1900, 1520], [3460, 1580]], 190, 603, 0.3), color: '#4a3350' },
      { poly: blob(700, 1200, 280, 604, 0.5), color: '#463049' },
      { poly: blob(2700, 1200, 280, 605, 0.5), color: '#463049' },
    ],
    zones: [
      // 제트기류 띠 — 맞바람에 걸리면 기어가게 된다
      { t: 'mud', poly: ribbon([[-60, 880], [900, 820], [1900, 900], [3460, 840]], 150, 611) },
      { t: 'mud', poly: ribbon([[-60, 1560], [900, 1620], [1900, 1520], [3460, 1580]], 150, 612) },
      // 솟아오른 구름탑 — 위에 올라서면 폭풍 위로 나온다
      { t: 'high', poly: blob(1150, 1200, 235, 613, 0.33) },
      { t: 'high', poly: blob(2250, 1200, 235, 614, 0.33) },
      { t: 'high', poly: blob(1700, 620, 205, 615, 0.33) },
      { t: 'high', poly: blob(1700, 1780, 205, 616, 0.33) },
      // 폭풍 그늘 — 구름 아래로 가라앉는 곳
      { t: 'low', poly: blob(760, 620, 210, 617, 0.42) },
      { t: 'low', poly: blob(2640, 1780, 210, 618, 0.42) },
      // 암모니아 결정운 — 몸을 감출 수 있다
      { t: 'forest', poly: blob(760, 1780, 235, 619, 0.44) },
      { t: 'forest', poly: blob(2640, 620, 235, 620, 0.44) },
      // 대적점 — 폭풍의 눈. 에너지가 솟는다.
      { t: 'vent', poly: blob(1700, 1200, 185, 621, 0.26) },
    ],
    obstacles: [].concat(
      rocks(1150, 1200, 150, 3, 95, 631),
      rocks(2250, 1200, 150, 3, 95, 632),
      rocks(1700, 620, 130, 3, 90, 633),
      rocks(1700, 1780, 130, 3, 90, 634)
    ),
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 150 },
      { x: 1150, y: 1200, n: 3, rad: 95 },
      { x: 2250, y: 1200, n: 3, rad: 95 },
    ],
  },

  // ══ 6. 토성 — 고리 파편, 목자 위성, 카시니 간극 ═════════
  // The widest map, and the most open. Cover is scarce, the ring arcs slow you
  // down, and the shepherd moons are the only high ground for a long way.
  {
    id: 'saturn',
    biome: 'ring',
    name: 'Saturn',
    desc: 'Fighting inside the rings. Debris arcs drag you to a crawl, cover is scarce, and the shepherd moons are the only high ground out here.',
    world: { w: 3600, h: 2400 },
    bg: '#080d18', ground: '#1c2438',
    spawns: [
      { x: 540, y: 1200 }, { x: 3060, y: 1200 },
      { x: 1800, y: 400 }, { x: 1800, y: 2020 },
    ],
    terrain: [
      { poly: ribbon([[-60, 1200], [900, 1130], [1800, 1240], [2700, 1130], [3660, 1210]], 300, 701, 0.25), color: '#25314b' },
      { poly: ribbon([[-60, 700], [900, 760], [1800, 660], [2700, 760], [3660, 690]], 150, 702, 0.3), color: '#212c44' },
      { poly: ribbon([[-60, 1700], [900, 1640], [1800, 1740], [2700, 1640], [3660, 1710]], 150, 703, 0.3), color: '#212c44' },
      { poly: blob(1800, 1200, 320, 704, 0.46), color: '#2b3856' },
    ],
    zones: [
      // 고리 파편대 — 촘촘한 얼음 자갈이 발목을 잡는다
      { t: 'mud', poly: ribbon([[-60, 700], [900, 760], [1800, 660], [2700, 760], [3660, 690]], 130, 711) },
      { t: 'mud', poly: ribbon([[-60, 1700], [900, 1640], [1800, 1740], [2700, 1640], [3660, 1710]], 130, 712) },
      // 목자 위성 — 이 근처의 유일한 고지
      { t: 'high', poly: blob(1200, 1200, 235, 713, 0.32) },
      { t: 'high', poly: blob(2400, 1200, 235, 714, 0.32) },
      { t: 'high', poly: blob(1800, 700, 200, 715, 0.32) },
      { t: 'high', poly: blob(1800, 1700, 200, 716, 0.32) },
      // 카시니 간극 — 고리가 끊긴 빈 골. 아래로 꺼져 시야가 나빠진다.
      { t: 'low', poly: ribbon([[700, 1200], [1200, 1080], [1800, 1220], [2400, 1080], [2900, 1200]], 105, 717) },
      // 얼음 결정 덤불 — 이 개활지에서 유일한 엄폐
      { t: 'forest', poly: blob(820, 1700, 225, 718, 0.44) },
      { t: 'forest', poly: blob(2780, 700, 225, 719, 0.44) },
      { t: 'forest', poly: blob(820, 700, 200, 720, 0.44) },
      { t: 'forest', poly: blob(2780, 1700, 200, 721, 0.44) },
      // 고리 한가운데의 얼음 간헐천
      { t: 'vent', poly: blob(1800, 1200, 170, 722, 0.3) },
    ],
    obstacles: [].concat(
      rocks(1200, 1200, 160, 4, 95, 731),
      rocks(2400, 1200, 160, 4, 95, 732),
      rocks(1800, 700, 110, 3, 90, 733),
      rocks(1800, 1700, 110, 3, 90, 734),
      rocks(820, 1700, 150, 3, 85, 735),
      rocks(2780, 700, 150, 3, 85, 736)
    ),
    midNodes: [
      { x: 1800, y: 1200, n: 4, rad: 145 },
      { x: 1200, y: 1200, n: 3, rad: 95 },
      { x: 2400, y: 1200, n: 3, rad: 95 },
    ],
  },

  // ══ 7. 해왕성 — 메탄 바다, 폭풍의 두 갈래 협로 ══════════
  // A twin-lane map: two frozen channels north and south split by a central mesa,
  // so armies commit to a lane. The hot springs on the ridge are the pivot.
  {
    id: 'neptune',
    biome: 'ice',
    name: 'Neptune',
    desc: 'A frozen ocean world. Two deep-snow channels split around a central ridge — pick a lane and the hot springs on top decide the fight.',
    world: { w: 3400, h: 2400 },
    bg: '#040a14', ground: '#0e1c30',
    spawns: [
      { x: 480, y: 1200 }, { x: 2920, y: 1200 },
      { x: 1700, y: 460 }, { x: 1700, y: 1940 },
    ],
    terrain: [
      { poly: blob(1700, 1200, 380, 801, 0.4), color: '#16304a' },
      { poly: blob(700, 1200, 300, 802, 0.5), color: '#12263c' },
      { poly: blob(2700, 1200, 300, 803, 0.5), color: '#12263c' },
    ],
    zones: [
      // 중앙 능선 (고지) — 두 협로 사이의 요충지
      { t: 'high', poly: blob(1700, 1200, 260, 811, 0.32) },
      // 위/아래 두 갈래 눈길 (감속)
      { t: 'mud', poly: ribbon([[-60, 620], [850, 560], [1700, 640], [2550, 560], [3460, 620]], 120, 812) },
      { t: 'mud', poly: ribbon([[-60, 1780], [850, 1840], [1700, 1760], [2550, 1840], [3460, 1780]], 120, 813) },
      // 측면 결정 첨탑 숲 (엄폐)
      { t: 'forest', poly: blob(760, 1200, 230, 814, 0.44) },
      { t: 'forest', poly: blob(2640, 1200, 230, 815, 0.44) },
      // 저지 웅덩이
      { t: 'low', poly: blob(1180, 620, 190, 816, 0.42) },
      { t: 'low', poly: blob(2220, 1780, 190, 817, 0.42) },
      // 능선 위 온천 (회복)
      { t: 'vent', poly: blob(1700, 1200, 150, 818, 0.3) },
    ],
    obstacles: [].concat(
      rocks(1700, 1200, 170, 4, 95, 831),
      rocks(760, 1200, 140, 3, 90, 832),
      rocks(2640, 1200, 140, 3, 90, 833),
      rocks(1700, 560, 120, 3, 80, 834),
      rocks(1700, 1840, 120, 3, 80, 835)
    ),
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 140 },
      { x: 1180, y: 620, n: 3, rad: 95 },
      { x: 2220, y: 1780, n: 3, rad: 95 },
    ],
  },

  // ══ 8. 세레스 — 소행성대의 채석장, 사방의 협소 교전 ══════
  // A small, tight four-corner brawl: little cover, a big central ore vein everyone
  // wants, and rubble walls that funnel every push through the middle.
  {
    id: 'ceres',
    biome: 'rust',
    name: 'Ceres',
    desc: 'A dwarf-planet quarry. Small and vicious — scarce cover, rubble walls that funnel every push through the middle, and one huge ore vein at the heart.',
    world: { w: 3000, h: 3000 },
    bg: '#180a06', ground: '#5a2c1a',
    spawns: [
      { x: 480, y: 480 }, { x: 2520, y: 2520 },
      { x: 2520, y: 480 }, { x: 480, y: 2520 },
    ],
    terrain: [
      { poly: blob(1500, 1500, 460, 901, 0.44), color: '#6b3620' },
      { poly: blob(1500, 1500, 240, 902, 0.4), color: '#7a4128' },
    ],
    zones: [
      // 중앙 노천 채굴장 (고지) — 사방에서 노리는 요지
      { t: 'high', poly: blob(1500, 1500, 240, 911, 0.32) },
      // 대각선 잔해 벽 사이의 좁은 협로 (저지 시야제한)
      { t: 'low', poly: ribbon([[700, 1500], [1500, 1350], [2300, 1500]], 120, 912) },
      { t: 'low', poly: ribbon([[1500, 700], [1350, 1500], [1500, 2300]], 120, 913) },
      // 네 모서리의 엄폐 바위밭
      { t: 'forest', poly: blob(820, 820, 200, 914, 0.46) },
      { t: 'forest', poly: blob(2180, 2180, 200, 915, 0.46) },
      { t: 'forest', poly: blob(2180, 820, 200, 916, 0.46) },
      { t: 'forest', poly: blob(820, 2180, 200, 917, 0.46) },
      // 중앙 광맥의 분출구 (회복)
      { t: 'vent', poly: blob(1500, 1500, 150, 918, 0.3) },
    ],
    obstacles: [].concat(
      rocks(1500, 900, 150, 4, 100, 931),
      rocks(1500, 2100, 150, 4, 100, 932),
      rocks(900, 1500, 150, 4, 100, 933),
      rocks(2100, 1500, 150, 4, 100, 934),
      rocks(1500, 1500, 120, 3, 80, 935)
    ),
    midNodes: [
      { x: 1500, y: 1500, n: 5, rad: 150 },
      { x: 900, y: 900, n: 3, rad: 90 },
      { x: 2100, y: 2100, n: 3, rad: 90 },
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

// ── 맵별 고유 크기 + 시그니처 강조 / Distinct dimensions + signature amplify ──
// Every map now has its OWN world size and aspect ratio, so they play differently
// (wide + open favors mobility and air; tall + compact favors rushes and choke
// fighting). One signature terrain feature per map is enlarged so the thing that
// makes each planet special actually dominates the fight.
RC.MAP_DIMS = {
  earth:   { w: 2800, h: 2600 },   // compact, near-square home
  venus:   { w: 3800, h: 2000 },   // wide-open scorched desert
  pluto:   { w: 2600, h: 3000 },   // tall vertical frozen canyon
  mars:    { w: 4000, h: 2000 },   // widest — the great canyon runs across it
  jupiter: { w: 3000, h: 2800 },   // tall storm columns
  saturn:  { w: 4200, h: 1800 },   // ultra-wide ring belt
  neptune: { w: 3800, h: 2200 },   // wide twin-lane ocean
  ceres:   { w: 2600, h: 2600 },   // small, vicious square brawl
};
// { t: zone type to amplify, s: enlarge factor } — the planet's signature terrain.
RC.MAP_SIGNATURE = {
  earth:   { t: 'mud', s: 1.25 },  // the river that splits the map north–south
  venus:   { t: 'mud', s: 1.30 },  // the deep sand you must go around
  pluto:   { t: 'mud', s: 1.30 },  // deep snow that drags you down
  mars:    { t: 'low', s: 1.32 },  // Valles Marineris — the canyon
  jupiter: { t: 'mud', s: 1.30 },  // the jet-stream bands
  saturn:  { t: 'mud', s: 1.28 },  // the debris arcs of the rings
  neptune: { t: 'mud', s: 1.25 },  // the twin snow channels
  ceres:   { t: 'high', s: 1.22 }, // the central ore mesa everyone fights for
};

(function reshapeMaps() {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  RC.MAPS.forEach(m => {
    const dim = RC.MAP_DIMS[m.id];
    if (!dim) return;
    const oldW = m.world.w, oldH = m.world.h;
    const sx = dim.w / oldW, sy = dim.h / oldH;
    const scalePoly = poly => { for (const p of poly) { p[0] = Math.round(p[0] * sx); p[1] = Math.round(p[1] * sy); } };

    (m.spawns || []).forEach(s => {
      s.x = clamp(Math.round(s.x * sx), 130, dim.w - 130);
      s.y = clamp(Math.round(s.y * sy), 130, dim.h - 130);
    });
    (m.terrain || []).forEach(t => { if (t.poly) scalePoly(t.poly); });
    (m.obstacles || []).forEach(o => {
      o.x = Math.round(o.x * sx); o.y = Math.round(o.y * sy);
      o.w = Math.round(o.w * sx); o.h = Math.round(o.h * sy);
    });
    (m.midNodes || []).forEach(n => {
      n.x = Math.round(n.x * sx); n.y = Math.round(n.y * sy);
      n.rad = Math.round(n.rad * (sx + sy) / 2);
    });

    const sig = RC.MAP_SIGNATURE[m.id];
    (m.zones || []).forEach(z => {
      if (z.poly) {
        scalePoly(z.poly);
        // Amplify the signature zone by scaling it around its own centroid.
        if (sig && z.t === sig.t) {
          let cx = 0, cy = 0;
          for (const p of z.poly) { cx += p[0]; cy += p[1]; }
          cx /= z.poly.length; cy /= z.poly.length;
          for (const p of z.poly) {
            p[0] = clamp(Math.round(cx + (p[0] - cx) * sig.s), -60, dim.w + 60);
            p[1] = clamp(Math.round(cy + (p[1] - cy) * sig.s), -60, dim.h + 60);
          }
        }
      }
      z.bb = null;
      RC.prepZone(z);
    });

    m.world = { w: dim.w, h: dim.h };
  });
})();
