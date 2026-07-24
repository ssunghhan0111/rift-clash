// RIFT CLASH — 맵 정의 / Maps
// 각 맵: 4개의 시작 지점, 장애물(충돌), 지형 패치(시각), 자원 무더기 군집, 테마 색.
// 시작 지점은 game.setup()에서 무작위로 섞여 배정된다 (적 위치 랜덤).
window.RC = window.RC || {};

RC.MAPS = [
  {
    id: 'basin',
    name: 'Clash Basin',
    desc: 'Open ground with a central rock ring; four corners clash. Beginner-friendly.',
    world: { w: 3200, h: 2400 },
    bg: '#141d26', ground: '#18232f',
    spawns: [
      { x: 460, y: 1940 }, { x: 2740, y: 460 },
      { x: 460, y: 460 }, { x: 2740, y: 1940 },
    ],
    terrain: [
      { x: 1600, y: 1200, r: 380, color: '#1c2a39' },
      { x: 1600, y: 1200, r: 210, color: '#213244' },
    ],
    // 중앙 바위 고리 (사이 간격을 둬서 유닛이 통과 가능)
    obstacles: [
      { x: 1600, y: 980, w: 150, h: 90 },
      { x: 1600, y: 1420, w: 150, h: 90 },
      { x: 1360, y: 1200, w: 90, h: 150 },
      { x: 1840, y: 1200, w: 90, h: 150 },
    ],
    // 자원 군집 (game이 각 지점에 부채꼴 무더기를 만든다)
    midNodes: [
      { x: 1600, y: 1200, n: 4, rad: 120 },
      { x: 900, y: 900, n: 3, rad: 90 },
      { x: 2300, y: 1500, n: 3, rad: 90 },
    ],
  },
  {
    id: 'canyon',
    name: 'Fourway Canyon',
    desc: 'Rock walls split the map into quadrants. Battles rage over the chokes.',
    world: { w: 3600, h: 2600 },
    bg: '#1a1720', ground: '#241d2b',
    spawns: [
      { x: 500, y: 500 }, { x: 3100, y: 2100 },
      { x: 3100, y: 500 }, { x: 500, y: 2100 },
    ],
    terrain: [
      { x: 1800, y: 1300, r: 300, color: '#2a2033' },
    ],
    // 십자 벽 — 중앙과 각 변 중앙에 통로(간격)를 남김
    obstacles: [
      { x: 1800, y: 720, w: 130, h: 420 },
      { x: 1800, y: 1880, w: 130, h: 420 },
      { x: 980, y: 1300, w: 460, h: 130 },
      { x: 2620, y: 1300, w: 460, h: 130 },
    ],
    midNodes: [
      { x: 1800, y: 1300, n: 4, rad: 130 },
      { x: 1120, y: 620, n: 3, rad: 90 },
      { x: 2480, y: 1980, n: 3, rad: 90 },
    ],
  },
  {
    id: 'archipelago',
    name: 'Rift Archipelago',
    desc: 'Wide lanes open between scattered rock clusters. Great for mobile play.',
    world: { w: 3400, h: 2400 },
    bg: '#101c1e', ground: '#152829',
    spawns: [
      { x: 480, y: 1200 }, { x: 2920, y: 1200 },
      { x: 1700, y: 440 }, { x: 1700, y: 1960 },
    ],
    terrain: [
      { x: 1700, y: 1200, r: 340, color: '#173234' },
      { x: 850, y: 700, r: 150, color: '#173234' },
      { x: 2550, y: 1700, r: 150, color: '#173234' },
    ],
    // 흩어진 바위섬들
    obstacles: [
      { x: 1700, y: 1200, w: 130, h: 130 },
      { x: 1200, y: 780, w: 100, h: 100 },
      { x: 2200, y: 1620, w: 100, h: 100 },
      { x: 1150, y: 1650, w: 100, h: 100 },
      { x: 2250, y: 750, w: 100, h: 100 },
    ],
    midNodes: [
      { x: 1700, y: 1200, n: 4, rad: 120 },
      { x: 1050, y: 1200, n: 3, rad: 90 },
      { x: 2350, y: 1200, n: 3, rad: 90 },
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

// ── Survival map — a horizontal lane. Enemy waves march left→right toward the
//    Rift Crystal; the defender base(s) sit behind it. Endless, escalating waves.
RC.SURVIVAL = {
  id: 'sv_gorge', name: 'Crystal Gorge',
  world: { w: 3400, h: 1600 },
  bg: '#101820', ground: '#16232b',
  enemySpawn: { x: 250, y: 800 },     // waves appear here and head for the crystal
  crystal: { x: 2430, y: 800 },       // the objective to protect
  bases: [                            // defender start positions (player, then ally)
    { x: 2960, y: 620 },
    { x: 2960, y: 980 },
  ],
  // shard clusters near the defender side so you can gather and build
  nodeClusters: [
    { x: 3120, y: 400, n: 4, rad: 90 },
    { x: 3120, y: 1200, n: 4, rad: 90 },
    { x: 2560, y: 320, n: 3, rad: 80 },
    { x: 2560, y: 1280, n: 3, rad: 80 },
  ],
  terrain: [
    { x: 2430, y: 800, r: 300, color: '#123038' },
    { x: 1500, y: 800, r: 220, color: '#1a2630' },
  ],
  // rock walls forming a central choke to funnel the horde
  obstacles: [
    { x: 1480, y: 340, w: 150, h: 520 },
    { x: 1480, y: 1260, w: 150, h: 520 },
    { x: 1960, y: 800, w: 120, h: 120 },
  ],
};
