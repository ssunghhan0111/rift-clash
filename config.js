// RIFT CLASH — 설정 / Config
// 밸런스 숫자는 전부 여기 모아둠. 게임 느낌 바꾸려면 이 파일만 만지면 됨.
window.RC = window.RC || {};

RC.CFG = {
  TILE: 40,
  WORLD_W: 3200,
  WORLD_H: 2400,

  POP_CAP: 100,         // 인구 상한 — 대규모 교전용 (was 30)
  START_SHARD: 250,

  GATHER_AMOUNT: 5,     // 한 번 캘 때 샤드
  GATHER_TIME: 2.4,     // 채집에 걸리는 초
  NODE_START: 1200,     // 결정 무더기 매장량

  // ── 확대/축소 (zoom) ──
  // Deliberately a narrow band. A wide zoom range on an RTS makes units tiny and
  // click targets unreliable; this is only enough to take in a bigger fight or to
  // lean into a base. 1.0 is the design scale everything was drawn for.
  ZOOM_MIN: 0.72,       // 축소 한계 (더 넓게)
  ZOOM_MAX: 1.30,       // 확대 한계 (더 가깝게)
  ZOOM_STEP: 1.10,      // 휠 한 칸
  ZOOM_PINCH: 1.0,      // 핀치 감도 배수

  CAM_SPEED: 2200,      // px/sec (max, at the true screen edge)
  EDGE_PAN: 56,         // 화면 가장자리 감지 픽셀 (edge-scroll zone width; ramps up to CAM_SPEED)

  // ── 자동 교전 (auto-engagement) ──
  // A unit acquires targets out to its OWN sight radius (def.sight, modified by the
  // terrain it stands on), not a single global number — so a Hoverwing notices an
  // enemy long before a Globling does. AGGRO_RANGE is only the fallback for a def
  // with no sight of its own.
  AGGRO_RANGE: 190,     // 시야가 정의되지 않은 유닛의 예비 인식 거리 (fallback only)
  ACQUIRE_PAD: 24,      // 인식 거리는 최소 (사거리 + 이 값) — 쏠 수 있으면 반드시 인식한다
  CHASE_PAD: 150,       // 자동 교전 시 초소(post)에서 벗어날 수 있는 추가 거리 (leash)
  BUILD_RANGE: 34,      // 일꾼이 건설하려고 접근하는 거리

  // ── 플라즈마 실드 (Aether) ──
  // Shields are a second HP pool that soaks damage BEFORE hit points and
  // recharges quickly once the unit has been out of combat for SHIELD_DELAY.
  SHIELD_REGEN: 16,     // 초당 실드 회복량
  SHIELD_DELAY: 4.5,    // 마지막 피격 후 회복 시작까지 대기(초)
  WARP_RANGE: 300,      // 워프 소환이 가능한 워프 도관 반경

  // ── 에너지 / 스킬 ──
  ENERGY_REGEN: 5,      // 초당 에너지 재생 (기본)
  ENERGY_START: 0.5,    // 생산 시 시작 에너지 비율

  // ── 업그레이드 (아크 랩에서 연구) ──
  UP_ATK_STEP: 2,       // 공격 업그레이드 단계당 +공격력
  UP_ARM_STEP: 1,       // 장갑 업그레이드 단계당 +방어력
  UP_ENG_MAXE: 20,      // 에너지 업그레이드 단계당 +최대에너지
  UP_ENG_REGEN: 2,      // 에너지 업그레이드 단계당 +재생
  UP_SPD_MOVE: 0.08,    // 기동 업그레이드 단계당 +이동속도(비율)
  UP_SPD_ATK: 0.10,     // 기동 업그레이드 단계당 +공격속도(비율)
  UP_CRIT_CHANCE: 0.12, // 치명타 단계당 확률
  UP_CRIT_MULT: 2,      // 치명타 배수
  FROST_DUR: 1.4,       // 동결 탄자 피격 둔화 지속(초)
  UP_TOUGH_HP: 0.12,    // 골격 단계당 +최대체력(비율)
  UP_TOUGH_REGEN: 2.5,  // 골격 단계당 비전투 초당 체력회복
  UP_MAX_TIER: 3,       // (기본값; 실제 상한은 각 업그레이드 costs 길이)

  // ── 전술 지형 (Tactical terrain) ──
  // Map zones that actually change a fight, so WHERE you stand matters as much as what
  // you build. Ground units only — flyers are above all of it.
  TERRAIN: {
    // 고지대 — 위에서 내려다보며 싸우면 유리
    high:   { atk: 1.25, range: 1.15, sight: 1.35,
              name: 'High Ground', blurb: '+25% attack · +15% range · sees further' },
    // 숲 — 몸을 숨겨 피해를 덜 받는다
    forest: { taken: 0.75,
              name: 'Forest Cover', blurb: 'takes 25% less damage' },
    // 늪 — 진창에 빠져 느려진다
    mud:    { speed: 0.55,
              name: 'Marsh', blurb: 'moves at 55% speed' },
    // 저지대 — 움푹 팬 곳. 시야가 막히고 사거리가 짧아진다 (고지대의 반대)
    low:    { range: 0.9, sight: 0.72,
              name: 'Hollow', blurb: '-10% range · poor visibility' },
    // 리프트 분출구 — 에너지와 체력을 서서히 회복
    vent:   { energy: 14, heal: 7,
              name: 'Rift Vent', blurb: 'restores energy and health' },
  },

  // 행성별 지형 이름 — 규칙은 어느 맵에서나 같고, 겉모습과 이름만 달라진다.
  BIOMES: {
    earth: { high: 'Hilltop',   low: 'Valley Floor', forest: 'Woods',
             mud: 'River Shallows', vent: 'Rift Spring' },
    ember: { high: 'Mesa',      low: 'Sink',         forest: 'Boulder Field',
             mud: 'Deep Sand',      vent: 'Magma Vent' },
    ice:   { high: 'Ice Ridge', low: 'Crevasse',     forest: 'Frozen Spires',
             mud: 'Deep Snow',      vent: 'Hot Spring' },
    rust:  { high: 'Caldera Rim', low: 'Canyon Floor', forest: 'Rockfall',
             mud: 'Polar Frost',    vent: 'Fumarole' },
    storm: { high: 'Cloud Tower', low: 'Storm Shadow', forest: 'Crystal Cloud',
             mud: 'Jet Stream',     vent: 'The Red Spot' },
    ring:  { high: 'Shepherd Moon', low: 'Cassini Gap', forest: 'Ice Thicket',
             mud: 'Debris Arc',     vent: 'Ice Geyser' },
  },

  // ── 전장의 안개 (Fog of War) ──
  FOG_ENABLED: true,    // 안개 on/off (끄면 전맵이 보인다)
  VIS_CELL: 40,         // 시야 격자 한 칸 크기(px) — 작을수록 안개 경계가 곱다
  VIS_INTERVAL: 0.12,   // 시야 재계산 주기(초)
  SIGHT_WORKER: 130,    // 일꾼 시야 반경
  SIGHT_GROUND: 190,    // 지상 전투 유닛 시야
  SIGHT_AIR: 240,       // 공중 유닛 시야 (높이 나는 만큼 넓게)
  SIGHT_BUILDING: 175,  // 일반 건물 시야
  SIGHT_CORE: 300,      // 본진 코어 시야
  SIGHT_TOWER_PAD: 40,  // 타워 시야 = 사거리 + 이 값

  // ── AI 난이도 ──
  AI_FIRST_WAVE: 210,
  AI_WAVE_GAP: 120,
  AI_WAVE_SIZE: 5,
  AI_WAVE_GROWTH: 2,
  AI_WORKER_CAP: 8,
  AI_SECOND_FACTORY: 300,
  AI_ARCLAB: 260,
  AI_TOWER: 150,        // 이 시간 이후 방어 타워 건설
};

// ── Versus AI difficulty (1v1 / 2v2 vs bots) ──────────────────────────────
// One profile per level. `normal` reproduces the historical AI tuning EXACTLY
// (see the AI_* constants above), so choosing Normal changes nothing from before.
// Difficulty only ever tunes the human's OPPONENTS — an allied bot always plays
// Normal (see game.aiProfile), so picking Easy never nerfs your teammate.
//   income        : multiplier on shards an AI worker banks (the one economy cheat)
//   workerCap     : how many workers the bot saturates to
//   firstWave     : seconds before the bot's first attack push
//   waveSize      : army size the bot masses before it attacks (smaller = pushier)
//   waveGrowth    : how much bigger each successive wave demands to be
//   waveGap       : seconds between attack waves
//   armyCap       : hard ceiling on combat units the bot will build (stops Easy from
//                   hoarding a death-ball while it waits for its first wave)
//   maxBarracks   : how many production buildings the bot expands to
//   secondFactory : seconds before the bot expands to a 2nd production building / air
//   tower / tech  : whether the bot builds defensive towers / researches upgrades
//
// Note: Normal used to mirror the historical 8-worker / no-research economy, which
// the AI could never actually spend (it sat at 5–70 shards for whole matches and
// never teched). That made every match end before the mid/late game existed. Normal
// and Hard now run a REAL economy — more workers, research reserved up front — so the
// pop cap, upgrades, air tier and hero levels get used. Easy is deliberately shallow.
RC.AI_DIFF = {
  easy:   { id: 'easy',   name: 'Easy',   income: 0.70, workerCap: 5,  firstWave: 240, waveSize: 3, waveGrowth: 1, waveGap: 160, armyCap: 6,   maxBarracks: 1, secondFactory: 400, tower: false, tech: false },
  normal: { id: 'normal', name: 'Normal', income: 1.00, workerCap: 13, firstWave: 210, waveSize: 5, waveGrowth: 2, waveGap: 120, armyCap: 999, maxBarracks: 2, secondFactory: 280, tower: true,  tech: true  },
  hard:   { id: 'hard',   name: 'Hard',   income: 1.30, workerCap: 18, firstWave: 120, waveSize: 4, waveGrowth: 2, waveGap: 75,  armyCap: 999, maxBarracks: 3, secondFactory: 180, tower: true,  tech: true  },
};
// Minimum shards the bot keeps in reserve to guarantee it can afford research when a
// lab is up (the old economy never saved this, so it never teched).
RC.AI_RESEARCH_MIN = 140;
RC.AI_DIFF_ORDER = ['easy', 'normal', 'hard'];

// ── Bot personalities ─────────────────────────────────────────────────────
// Layered ON TOP of the difficulty profile (see game.aiProfile). Difficulty sets
// the overall strength; personality sets the STYLE, so two Hard bots can feel
// completely different. `*Mul` scale the matching difficulty field; flags/bias are
// read by ai.js to change build order. Only ever applied to the human's opponents.
RC.AI_PERSONA = {
  balanced: { id: 'balanced', name: 'Balanced', label: '' },
  rusher:   { id: 'rusher',   name: 'Rusher',   label: '⚔ Rusher',
              firstWaveMul: 0.42, waveSizeMul: 0.6, waveGapMul: 0.6, waveGrowthMul: 0.6,
              workerCapMul: 0.85, tower: false, tech: false, bias: 'ground' },
  turtler:  { id: 'turtler',  name: 'Turtler',  label: '🛡 Turtler',
              firstWaveMul: 1.6, waveSizeMul: 1.7, waveGapMul: 1.25, workerCapMul: 1.15,
              tower: true, tech: true, towerEarly: true },
  skylord:  { id: 'skylord',  name: 'Skylord',  label: '✈ Skylord',
              firstWaveMul: 1.15, waveSizeMul: 1.1, secondFactoryMul: 0.5, tech: true, bias: 'air' },
  macro:    { id: 'macro',    name: 'Macro',    label: '📈 Macro',
              firstWaveMul: 1.5, waveSizeMul: 1.6, workerCapMul: 1.3, incomeMul: 1.1, tech: true },
};
RC.AI_PERSONA_ORDER = ['balanced', 'rusher', 'turtler', 'skylord', 'macro'];
// Personalities the game rolls for a random enemy (balanced excluded so matches vary).
RC.AI_PERSONA_POOL = ['rusher', 'turtler', 'skylord', 'macro'];

// 색상 — 플레이어 4명 각자 색
RC.COLORS = {
  bg:        '#131a24',
  grid:      '#1b2431',
  node:      '#4fd6e8',
  nodeDark:  '#1f7f8c',
  rift:      '#a668ff',
  obstacle:  '#3a4757',
  obstacleDark: '#232d3a',

  p1_body:   '#3a86e0', p1_trim: '#ffb04a', p1_dark: '#1e4a80',
  p2_body:   '#e6483f', p2_trim: '#ffd23f', p2_dark: '#8a221c',
  p3_body:   '#38c46a', p3_trim: '#d7f05a', p3_dark: '#1f6b3c',
  p4_body:   '#b46bff', p4_trim: '#e0a0ff', p4_dark: '#573a80',

  team1:     '#6fd3ff',
  team2:     '#ff8a5c',

  hpGood:    '#5ddc7a',
  hpBad:     '#e0503f',
  energy:    '#5ab8ff',
  heal:      '#7dff9e',
  crit:      '#ffd23f',
  select:    '#8ef2b0',
};

// ── 유닛 ──────────────────────────────────────────────
// hp, dmg, range, cd(공격 쿨), speed, r, cost, time, supply, energy
// ability: { id, name, key, cost(에너지), cd(재사용), ... }
RC.UNITS = {
  wrench: {
    id: 'wrench', name: 'Wrench Bot', role: 'Worker',
    hp: 60, dmg: 4, range: 18, cd: 1.2, speed: 100, r: 12, sight: 120,
    cost: 50, time: 11, supply: 1, armor: 0, energy: 60,
    worker: true, key: 'Q',
    ability: { id: 'weld', name: 'Emergency Weld', key: 'G', cost: 30, cd: 6, radius: 140, heal: 130, target: 'repair',
               desc: 'Instantly repairs the most-damaged nearby ally (unit or building).' },
    desc: 'Mines shards and constructs buildings. Can repair allies with Emergency Weld.'
  },
  volt: {
    id: 'volt', name: 'Volt Trooper', role: 'Infantry',
    hp: 110, dmg: 9, range: 78, cd: 0.85, speed: 88, r: 14, sight: 200,
    cost: 60, time: 15, supply: 1, armor: 0, energy: 60, key: 'Q',
    ability: { id: 'surge', name: 'Overcharge', key: 'D', cost: 25, cd: 10, dur: 5, hpCost: 15, spd: 1.3, fire: 0.5,
               desc: 'Greatly boosts attack and move speed for 5s (costs some HP).' },
    desc: 'Basic ranged infantry. Can briefly go into overdrive with Overcharge.'
  },
  shielder: {
    id: 'shielder', name: 'Shieldbearer', role: 'Shield Tank',
    hp: 260, dmg: 7, range: 24, cd: 1.1, speed: 64, r: 18, sight: 170,
    cost: 110, time: 24, supply: 2, armor: 3, energy: 70, key: 'W',
    ability: { id: 'bulwark', name: 'Bulwark', key: 'C', cost: 30, cd: 12, dur: 6, armorBonus: 6, radius: 210,
               desc: 'Sharply raises armor for 6s and taunts nearby enemies.' },
    desc: 'Frontline damage-soaker. Protects allies with Bulwark.'
  },
  spark: {
    id: 'spark', name: 'Spark Cannon', role: 'Siege',
    hp: 90, dmg: 26, range: 150, cd: 2.2, speed: 52, r: 16, sight: 185,
    cost: 150, time: 30, supply: 2, armor: 0, energy: 70, splash: 42, key: 'E',
    ability: { id: 'raillock', name: 'Focus Fire', key: 'V', cost: 35, cd: 8, dur: 5, rangeBonus: 80, dmgBonus: 14, splashBonus: 18,
               desc: 'Range and power surge for 5s, but cannot move.' },
    desc: 'Long-range siege unit. Bombards from afar with Focus Fire.'
  },
  hover: {
    id: 'hover', name: 'Hoverwing', role: 'Air',
    hp: 90, dmg: 12, range: 90, cd: 0.8, speed: 130, r: 14,
    cost: 120, time: 22, supply: 2, armor: 0, energy: 60, flying: true, sight: 300, key: 'Q',
    ability: { id: 'warp', name: 'Blink Booster', key: 'X', cost: 20, cd: 5, dist: 230,
               desc: 'Teleports in the direction it is facing.' },
    desc: 'Fast air unit. Dives in or escapes with Blink Booster.'
  },
  patch: {
    id: 'patch', name: 'Patch Bot', role: 'Repair Support',
    hp: 100, dmg: 5, range: 60, cd: 1.0, speed: 96, r: 14, sight: 205,
    cost: 90, time: 20, supply: 2, armor: 1, energy: 110, key: 'Q',
    ability: { id: 'mend', name: 'Nano Heal', key: 'Z', cost: 40, cd: 3, radius: 155, heal: 45,
               desc: 'Heals all nearby allied units at once.' },
    desc: 'Support unit that heals nearby allies.'
  },
  pulse: {
    id: 'pulse', name: 'Pulse Coil', role: 'Disruptor',
    hp: 85, dmg: 6, range: 105, cd: 1.3, speed: 82, r: 15, sight: 215,
    cost: 130, time: 24, supply: 2, armor: 0, energy: 130, key: 'W',
    ability: { id: 'nova', name: 'Static Pulse', key: 'A', cost: 45, cd: 9, radius: 170, dmg: 22, drain: 60, slowDur: 4,
               desc: 'Drains enemy energy, deals damage, and slows nearby foes.' },
    desc: 'Caster that disrupts enemies. Static Pulse neutralizes packed groups.'
  },
  chaingunner: {
    id: 'chaingunner', name: 'Chaingunner', role: 'Heavy Gunner',
    hp: 145, dmg: 6, range: 100, cd: 0.32, speed: 78, r: 15, sight: 195,
    cost: 95, time: 19, supply: 2, armor: 1, energy: 70, key: 'R',
    ability: { id: 'surge', name: 'Full Auto', key: 'D', cost: 30, cd: 11, dur: 5, hpCost: 0, spd: 0.9, fire: 0.45,
               desc: 'Opens up with both barrels — a huge burst of fire rate for 5s.' },
    desc: 'Twin-gun trooper that shreds groups with a stream of rapid fire. Slow, but relentless.'
  },
  // ── 신규 항공 ──
  heli: {
    id: 'heli', name: 'Rattler Heli', role: 'Gunship',
    hp: 150, dmg: 17, range: 105, cd: 1.0, speed: 118, r: 16, sight: 255,
    cost: 150, time: 24, supply: 3, armor: 1, energy: 80, flying: true, splash: 20, key: 'W',
    ability: { id: 'salvo', name: 'Rocket Salvo', key: 'B', cost: 40, cd: 9, radius: 95, dmg: 34,
               desc: 'Rains rockets around a target point for area damage.' },
    desc: 'Ground-attack gunship. Rocket Salvo wipes out clustered enemies.'
  },
  jet: {
    id: 'jet', name: 'Falcon Jet', role: 'Air Superiority',
    hp: 120, dmg: 20, range: 120, cd: 0.7, speed: 170, r: 15,
    cost: 175, time: 26, supply: 3, armor: 0, energy: 70, flying: true, sight: 300, key: 'E',
    ability: { id: 'afterburn', name: 'Afterburner', key: 'N', cost: 25, cd: 11, dur: 4, spd: 1.6, fire: 0.55,
               desc: 'Move and attack speed spike for 4s.' },
    desc: 'Very fast fighter. Hits and runs, striking both air and ground.'
  },
  dropship: {
    id: 'dropship', name: 'Ferry Dropship', role: 'Transport',
    hp: 220, dmg: 0, range: 0, cd: 1, speed: 130, r: 19, sight: 270,
    cost: 150, time: 24, supply: 3, armor: 1, energy: 0, flying: true, transport: 8, key: 'R',
    ability: { id: 'unload', name: 'Unload All', key: 'U', cost: 0, cd: 1,
               desc: 'Drops off every unit aboard.' },
    desc: 'Carries ground units over obstacles and enemies. Select units, then right-click (tap) the dropship to board.'
  },

  // ══ Gloop faction units — Acid & Regeneration ══════════
  // Shared identity: def.regen (HP/sec self-heal) + def.acid (attacks stack acid: -armor + damage over time)
  slug: {
    id: 'slug', name: 'Slug', role: 'Worker',
    hp: 60, dmg: 4, range: 18, cd: 1.2, speed: 104, r: 12, sight: 120,
    cost: 50, time: 11, supply: 1, armor: 0, energy: 60,
    worker: true, regen: 2, race: 'gloop', key: 'Q',
    ability: { id: 'weld', name: 'Slime Patch', key: 'G', cost: 30, cd: 6, radius: 140, heal: 120, target: 'repair',
               desc: 'Instantly seals the most-damaged nearby ally with slime.' },
    desc: 'Mines shards and grows structures. Slowly regenerates on its own.'
  },
  globling: {
    id: 'globling', name: 'Globling', role: 'Swarm Melee',
    hp: 70, dmg: 7, range: 20, cd: 0.7, speed: 132, r: 12, sight: 160,
    cost: 40, time: 8, supply: 1, armor: 0, energy: 50, regen: 5, race: 'gloop',
    acid: { dmg: 2, dur: 4, shred: 1, max: 5 }, key: 'Q',
    ability: { id: 'surge', name: 'Frenzy', key: 'D', cost: 25, cd: 10, dur: 5, hpCost: 0, spd: 1.4, fire: 0.55,
               desc: 'Move and attack speed surge for 5s.' },
    desc: 'Cheap, fast swarm melee. Bites apply acid and it heals itself.'
  },
  spitter: {
    id: 'spitter', name: 'Spitter', role: 'Acid Ranged',
    hp: 90, dmg: 11, range: 120, cd: 1.0, speed: 86, r: 14, sight: 205,
    cost: 65, time: 14, supply: 1, armor: 0, energy: 80, regen: 3, race: 'gloop',
    acid: { dmg: 4, dur: 5, shred: 2, max: 5 }, key: 'W',
    ability: { id: 'nova', name: 'Corrosive Spray', key: 'A', cost: 40, cd: 9, radius: 150, dmg: 16, drain: 0, slowDur: 2,
               desc: 'Sprays acid over nearby enemies, damaging and slowing them.' },
    desc: 'Ranged acid-spitter. Melts armor to amplify the whole army’s damage.'
  },
  bloat: {
    id: 'bloat', name: 'Bloat', role: 'Acid Tank',
    hp: 300, dmg: 10, range: 22, cd: 1.3, speed: 58, r: 18, sight: 150,
    cost: 105, time: 22, supply: 2, armor: 2, energy: 0, regen: 6, race: 'gloop',
    acid: { dmg: 3, dur: 4, shred: 1, max: 5 }, deathBurst: { radius: 110, dmg: 40 }, key: 'E',
    desc: 'Giant slime that soaks damage. Regenerates fast and bursts with acid on death.'
  },
  hydra: {
    id: 'hydra', name: 'Venom Hydra', role: 'Venom Artillery',
    hp: 165, dmg: 15, range: 150, cd: 1.35, speed: 72, r: 17, sight: 185,
    cost: 120, time: 24, supply: 2, armor: 1, energy: 90, regen: 4, race: 'gloop',
    acid: { dmg: 7, dur: 6, shred: 3, max: 6 }, key: 'R',
    ability: { id: 'nova', name: 'Venom Burst', key: 'A', cost: 45, cd: 9, radius: 165, dmg: 24, drain: 0, slowDur: 3,
               desc: 'Every head spits at once — a wide cloud that damages and slows.' },
    desc: 'Three-headed serpent that hurls venom from far away. Its bite melts armour faster than anything else in the swarm.'
  },
  floater: {
    id: 'floater', name: 'Floater', role: 'Air Bomber',
    hp: 130, dmg: 16, range: 100, cd: 1.1, speed: 122, r: 16,
    cost: 135, time: 22, supply: 2, armor: 0, energy: 80, regen: 3, race: 'gloop',
    flying: true, sight: 255, splash: 18, acid: { dmg: 3, dur: 4, shred: 1, max: 4 }, key: 'Q',
    ability: { id: 'salvo', name: 'Spore Barrage', key: 'B', cost: 40, cd: 9, radius: 95, dmg: 30,
               desc: 'Drops acid spores on a target point for area damage.' },
    desc: 'Drifting air unit that drops acid spores. Melts clumped enemies.'
  },

  // ══ Aether faction units — Plasma Shields & Warp-in ════
  // Shared identity: def.shield (a second HP pool that absorbs damage first and
  // recharges fast out of combat). Fewer, costlier, stronger units than the other
  // factions — and they warp in at any Warp Conduit instead of walking from base.
  acolyte: {
    id: 'acolyte', name: 'Acolyte', role: 'Worker',
    hp: 50, dmg: 5, range: 18, cd: 1.2, speed: 102, r: 12, sight: 125,
    cost: 55, time: 12, supply: 1, armor: 0, energy: 60,
    worker: true, shield: 30, race: 'aether', key: 'Q',
    ability: { id: 'weld', name: 'Restore Matrix', key: 'G', cost: 30, cd: 6, radius: 140, heal: 125, target: 'repair',
               desc: 'Channels energy to instantly mend the most-damaged nearby ally.' },
    desc: 'Mines shards and warps structures into place. Protected by a plasma shield.'
  },
  ardent: {
    id: 'ardent', name: 'Ardent', role: 'Melee Vanguard',
    hp: 105, dmg: 17, range: 22, cd: 0.8, speed: 96, r: 14, sight: 175,
    cost: 80, time: 16, supply: 2, armor: 1, energy: 60,
    shield: 70, race: 'aether', key: 'Q',
    ability: { id: 'surge', name: 'Zeal', key: 'D', cost: 25, cd: 10, dur: 5, hpCost: 0, spd: 1.45, fire: 0.5,
               desc: 'Blazing charge — big move and attack speed boost for 5s.' },
    desc: 'Shielded melee warrior. Hits far harder than swarm infantry and charges with Zeal.'
  },
  lancer: {
    id: 'lancer', name: 'Void Lancer', role: 'Ranged Support',
    hp: 100, dmg: 19, range: 128, cd: 1.15, speed: 82, r: 15, sight: 215,
    cost: 125, time: 22, supply: 2, armor: 1, energy: 80,
    shield: 90, race: 'aether', key: 'W',
    ability: { id: 'warp', name: 'Phase Step', key: 'X', cost: 20, cd: 6, dist: 235,
               desc: 'Blinks a short distance — dive in or slip out of a fight.' },
    desc: 'Long-range shielded striker. Phase Step makes it brutally hard to pin down.'
  },
  bastion: {
    id: 'bastion', name: 'Bastion', role: 'Heavy Siege',
    hp: 190, dmg: 42, range: 140, cd: 2.0, speed: 56, r: 18, sight: 180,
    cost: 195, time: 32, supply: 4, armor: 3, energy: 70,
    shield: 160, splash: 38, race: 'aether', key: 'E',
    ability: { id: 'raillock', name: 'Anchor Field', key: 'V', cost: 35, cd: 8, dur: 5, rangeBonus: 75, dmgBonus: 18, splashBonus: 16,
               desc: 'Locks down and unleashes vastly stronger long-range fire for 5s.' },
    desc: 'Walking siege platform with an enormous shield bank. The Aether battering ram.'
  },
  seraph: {
    id: 'seraph', name: 'Seraph', role: 'Air Superiority',
    hp: 110, dmg: 23, range: 118, cd: 0.75, speed: 158, r: 15,
    cost: 185, time: 26, supply: 4, armor: 0, energy: 80,
    shield: 110, flying: true, sight: 300, race: 'aether', key: 'Q',
    ability: { id: 'afterburn', name: 'Solar Wind', key: 'N', cost: 25, cd: 11, dur: 4, spd: 1.55, fire: 0.55,
               desc: 'Rides a solar current — move and attack speed spike for 4s.' },
    desc: 'Swift shielded interceptor. Strikes air and ground, then blazes back out.'
  },
  bladesworn: {
    id: 'bladesworn', name: 'Bladesworn', role: 'Blade Assassin',
    hp: 95, dmg: 24, range: 24, cd: 0.55, speed: 122, r: 13, sight: 200,
    cost: 110, time: 18, supply: 2, armor: 0, energy: 70,
    shield: 65, race: 'aether', key: 'R',
    ability: { id: 'warp', name: 'Shadow Step', key: 'X', cost: 20, cd: 5, dist: 260,
               desc: 'Flickers forward in a blink to land on a target — or slip away.' },
    desc: 'Lightning-fast duellist with two razor knives. Fragile, but nothing cuts faster.'
  },
  oracle: {
    id: 'oracle', name: 'Oracle', role: 'Shield Support',
    hp: 95, dmg: 8, range: 100, cd: 1.2, speed: 92, r: 14, sight: 240,
    cost: 140, time: 24, supply: 2, armor: 0, energy: 140,
    shield: 80, race: 'aether', key: 'W',
    ability: { id: 'mend', name: 'Shield Overflow', key: 'Z', cost: 40, cd: 3, radius: 160, heal: 55, shieldHeal: 70,
               desc: 'Floods nearby allies with energy, restoring shields and health.' },
    desc: 'Support caster that recharges the whole army’s shields mid-fight.'
  },

  // ══ Heroes — one per race. Gain XP from nearby enemy kills, level up (skills rank up
  //    automatically), and revive at your base after a delay + shard cost if slain. ══
  warden: {
    id: 'warden', name: 'Ironclad Warden', role: 'Hero', hero: true,
    hp: 600, dmg: 22, range: 30, cd: 1.0, speed: 80, r: 22, sight: 230,
    cost: 0, time: 0, supply: 0, armor: 3, energy: 200, key: 'H',
    grow: { hp: 70, dmg: 4, armor: 0.5 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    // 3 skills; each ranks up with level. All effects are self-contained (no passive stat plumbing).
    skills: [
      { id: 'salvo', name: 'Seismic Slam', key: 'F', cost: 40, cd: 8, radius: 120, dmg: 45, dmgPerRank: 28,
        desc: 'Smashes the ground for heavy area damage.' },
      { id: 'mend',  name: 'Repair Pulse', key: 'G', cost: 35, cd: 7, radius: 170, heal: 60, healPerRank: 40,
        desc: 'Repairs the Warden and nearby allies.' },
      // Signature (LoL: Malphite — Unstoppable Force): a dash that lands with AoE damage
      // and leaves enemies reeling. Turns the Warden into a true front-line initiator.
      { id: 'leap',  name: 'Leap Slam',    key: 'C', cost: 30, cd: 9, dist: 250, distPerRank: 30, radius: 135, dmg: 40, dmgPerRank: 22, stun: 1.3,
        desc: 'Vaults to the front line and smashes down — heavy area damage that leaves enemies reeling.' },
    ],
    // ── ULTIMATE ── one per hero. Unlocks at a level, costs most of the energy
    //    bar, very long cooldown, and is meant to be the moment of the match.
    ult: { id: 'barrage', name: 'Orbital Barrage', key: 'R', cost: 120, cd: 80, minLevel: 6,
      radius: 300, dmg: 180, dmgPerLevel: 15, stun: 2.2, shake: 1.0,
      desc: 'Calls down an orbital bombardment. Massive damage across a huge area, and survivors are left reeling.' },
    desc: 'A towering war machine. Grows stronger with every battle — you need it to win.'
  },
  matriarch: {
    id: 'matriarch', name: 'Brood Matriarch', role: 'Hero', hero: true, race: 'gloop', regen: 4,
    hp: 480, dmg: 18, range: 120, cd: 1.0, speed: 84, r: 21, sight: 240,
    cost: 0, time: 0, supply: 0, armor: 1, energy: 220, key: 'H',
    acid: { dmg: 4, dur: 5, shred: 2, max: 6 },
    grow: { hp: 55, dmg: 4, armor: 0.4 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    skills: [
      // Signature (LoL: Cassiopeia — Twin Fang): damages and corrodes nearby foes, and
      // the Matriarch feeds on each one she hits to heal — sustain built on her acid.
      { id: 'devour', name: 'Devouring Acid', key: 'A', cost: 40, cd: 8, radius: 170, dmg: 24, dmgPerRank: 15, heal: 20, healPerRank: 12, healCap: 4, slowDur: 2,
        desc: 'Sprays devouring acid: damages and corrodes nearby foes while the Matriarch feeds on them to heal.' },
      { id: 'salvo', name: 'Spore Storm',    key: 'F', cost: 45, cd: 9, radius: 115, dmg: 38, dmgPerRank: 24,
        desc: 'Rains acid spores over an area.' },
      { id: 'weld',  name: 'Regenerate',     key: 'G', cost: 35, cd: 7, radius: 180, heal: 90, healPerRank: 55, target: 'repair',
        desc: 'Rapidly heals the most-wounded nearby ally.' },
    ],
    ult: { id: 'swarm', name: 'Hatch the Brood', key: 'R', cost: 110, cd: 80, minLevel: 6,
      count: 6, countPerLevel: 0.5, maxCount: 12, spawn: 'globling', life: 26, radius: 110, shake: 0.55,
      desc: 'Splits open the ground and hatches a swarm of free globlings that fight for a short time.' },
    desc: 'Acid-spewing matriarch. Feeds on the fallen to grow — essential to victory.'
  },
  archon: {
    id: 'archon', name: 'Radiant Archon', role: 'Hero', hero: true, race: 'aether',
    hp: 420, dmg: 26, range: 95, cd: 0.95, speed: 88, r: 22, sight: 250,
    cost: 0, time: 0, supply: 0, armor: 2, energy: 220, shield: 320, key: 'H',
    grow: { hp: 45, dmg: 5, armor: 0.4, shield: 55 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    skills: [
      { id: 'salvo', name: 'Psionic Storm', key: 'F', cost: 45, cd: 9, radius: 130, dmg: 42, dmgPerRank: 27,
        desc: 'Tears open a storm of psionic energy over an area.' },
      { id: 'mend',  name: 'Shield Cascade', key: 'G', cost: 35, cd: 7, radius: 180, heal: 55, healPerRank: 35, shieldHeal: 90, shieldHealPerRank: 55,
        desc: 'Recharges the shields and health of the Archon and nearby allies.' },
      // Signature (LoL: Kassadin — Riftwalk): blinks through the rift and erupts on
      // arrival, blasting enemies where the Archon reappears. Reposition + burst in one.
      { id: 'riftblast', name: 'Rift Surge', key: 'C', cost: 30, cd: 7, dist: 250, distPerRank: 35, radius: 120, dmg: 34, dmgPerRank: 22,
        desc: 'Steps through the rift and erupts on arrival, blasting enemies where the Archon reappears.' },
    ],
    ult: { id: 'aegis', name: 'Aegis Storm', key: 'R', cost: 115, cd: 80, minLevel: 6,
      radius: 260, dmg: 95, dmgPerLevel: 9, shieldGrant: 200, shieldPerLevel: 22, heal: 80, shake: 0.8,
      desc: 'A radiant shockwave: enemies are blasted back while every nearby ally is healed and wrapped in a fresh shield.' },
    desc: 'A being of pure energy wrapped in a colossal shield. Grows radiant with every kill.'
  },
};

// Hero progression tuning
RC.HERO = { maxLevel: 10, xpBase: 100, xpStep: 60, killXp: 12, killXpPerSupply: 8, workerXp: 6, heroXp: 55, xpRange: 620 };

// ── Buildings ─────────────────────────────────────────
RC.BUILDINGS = {
  core: {
    id: 'core', name: 'Assembly Core', hp: 1200, w: 96, h: 96,
    cost: 0, time: 0, supplyGiven: 10, produces: ['wrench'], isCore: true, dropoff: true,
    desc: 'Your base. Lose it and you lose.'
  },
  cell: {
    id: 'cell', name: 'Power Cell', hp: 400, w: 56, h: 56,
    cost: 80, time: 13, supplyGiven: 8, produces: [], key: 'E',
    desc: '+8 population. Needed to train more units.'
  },
  factory: {
    id: 'factory', name: 'Bolt Factory', hp: 700, w: 80, h: 80,
    cost: 150, time: 21, supplyGiven: 0, produces: ['volt', 'shielder', 'spark', 'chaingunner'], key: 'R',
    desc: 'Produces ground combat units.'
  },
  hoverpad: {
    id: 'hoverpad', name: 'Hover Pad', hp: 600, w: 72, h: 72,
    cost: 180, time: 24, supplyGiven: 0, produces: ['hover', 'heli', 'jet', 'dropship'], key: 'T',
    desc: 'Produces air units (Hoverwing, Heli, Jet, Dropship).'
  },
  arclab: {
    id: 'arclab', name: 'Arc Lab', hp: 650, w: 80, h: 80,
    cost: 200, time: 26, supplyGiven: 0, produces: ['patch', 'pulse'], key: 'Y', research: true,
    desc: 'Builds Patch Bots and Pulse Coils, and researches army-wide upgrades.'
  },
  // ── Towers ──
  guardtower: {
    id: 'guardtower', name: 'Guard Tower', hp: 520, w: 52, h: 52,
    cost: 120, time: 16, supplyGiven: 0, produces: [], key: 'U',
    tower: true, dmg: 16, range: 155, cd: 0.9, air: true,
    desc: 'Defensive turret that auto-attacks ground and air.'
  },
  arcbattery: {
    id: 'arcbattery', name: 'Arc Battery', hp: 460, w: 60, h: 60,
    cost: 200, time: 22, supplyGiven: 0, produces: [], key: 'I',
    tower: true, dmg: 40, range: 235, cd: 2.4, splash: 46, air: false,
    desc: 'Long-range splash siege turret. Build forward to pound enemy bases.'
  },

  // ══ Gloop faction buildings ═══════════════════════════
  biocore: {
    id: 'biocore', name: 'Biocore', hp: 1200, w: 96, h: 96,
    cost: 0, time: 0, supplyGiven: 10, produces: ['slug'], isCore: true, dropoff: true, race: 'gloop',
    desc: 'Swarm base. Lose it and you lose.'
  },
  membrane: {
    id: 'membrane', name: 'Spore Membrane', hp: 400, w: 56, h: 56,
    cost: 80, time: 13, supplyGiven: 8, produces: [], race: 'gloop', key: 'E',
    desc: '+8 population. Needed to grow the swarm.'
  },
  hatchery: {
    id: 'hatchery', name: 'Hatchery', hp: 700, w: 80, h: 80,
    cost: 150, time: 21, supplyGiven: 0, produces: ['globling', 'spitter', 'bloat', 'hydra'], race: 'gloop', key: 'R',
    desc: 'Hatches ground swarm units.'
  },
  spire: {
    id: 'spire', name: 'Spore Spire', hp: 600, w: 72, h: 72,
    cost: 180, time: 24, supplyGiven: 0, produces: ['floater'], race: 'gloop', key: 'T',
    desc: 'Cultivates air units (Floater).'
  },
  evochamber: {
    id: 'evochamber', name: 'Evo Chamber', hp: 650, w: 80, h: 80,
    cost: 200, time: 26, supplyGiven: 0, produces: [], research: true, race: 'gloop', key: 'Y',
    desc: 'Evolves (upgrades) the entire swarm.'
  },
  acidtower: {
    id: 'acidtower', name: 'Acid Tower', hp: 500, w: 54, h: 54,
    cost: 120, time: 16, supplyGiven: 0, produces: [], race: 'gloop', key: 'U',
    tower: true, dmg: 15, range: 160, cd: 0.9, air: true, acid: { dmg: 3, dur: 4, shred: 1, max: 4 },
    desc: 'Defensive turret that spits acid at ground and air.'
  },

  // ══ Aether faction buildings ══════════════════════════
  // Structures carry plasma shields too. The Warp Conduit doubles as both the
  // population building AND the warp beacon combat units materialize at.
  nexus: {
    id: 'nexus', name: 'Aether Nexus', hp: 1000, shield: 500, w: 96, h: 96,
    cost: 0, time: 0, supplyGiven: 10, produces: ['acolyte'], isCore: true, dropoff: true, race: 'aether',
    desc: 'Aether base. Lose it and you lose.'
  },
  conduit: {
    id: 'conduit', name: 'Warp Conduit', hp: 300, shield: 250, w: 56, h: 56,
    cost: 90, time: 14, supplyGiven: 8, produces: [], race: 'aether', warpBeacon: true, key: 'E',
    desc: '+8 population — and Aether combat units warp in here instead of walking from base. Build them forward.'
  },
  warpgate: {
    id: 'warpgate', name: 'Warp Gate', hp: 550, shield: 350, w: 80, h: 80,
    cost: 160, time: 22, supplyGiven: 0, produces: ['ardent', 'lancer', 'bastion', 'bladesworn'], race: 'aether', key: 'R',
    desc: 'Warps in ground combat units at your furthest-forward Warp Conduit.'
  },
  astralgate: {
    id: 'astralgate', name: 'Astral Gate', hp: 500, shield: 300, w: 72, h: 72,
    cost: 200, time: 26, supplyGiven: 0, produces: ['seraph'], race: 'aether', key: 'T',
    desc: 'Warps in Seraph air superiority fighters.'
  },
  conclave: {
    id: 'conclave', name: 'Aether Conclave', hp: 520, shield: 320, w: 80, h: 80,
    cost: 210, time: 28, supplyGiven: 0, produces: ['oracle'], research: true, race: 'aether', key: 'Y',
    desc: 'Warps in Oracles and researches army-wide upgrades.'
  },
  photonprism: {
    id: 'photonprism', name: 'Photon Prism', hp: 380, shield: 320, w: 52, h: 52,
    cost: 140, time: 17, supplyGiven: 0, produces: [], race: 'aether', key: 'U',
    tower: true, dmg: 20, range: 165, cd: 0.95, air: true,
    desc: 'Shielded defensive turret. Hits ground and air, and its shield regrows between attacks.'
  },

  // ── Survival objective ──
  crystal: {
    id: 'crystal', name: 'Rift Crystal', hp: 4000, w: 84, h: 84,
    cost: 0, time: 0, supplyGiven: 0, produces: [], isCrystal: true,
    desc: 'The universal crystal. Protect it — if it shatters, your run ends.'
  },
};

// Order of buildings a worker can construct (default = Forge)
RC.BUILDABLE = ['cell', 'factory', 'hoverpad', 'arclab', 'guardtower', 'arcbattery'];

// ── Factions ─────────────────────────────────────────
// Each faction's core, worker, build list + AI role map (role -> actual type id).
// The AI plays either faction using only this role map.
RC.RACES = {
  forge: {
    id: 'forge', name: 'Forge', tint: '#f08a2a',
    blurb: 'Machine legion — the balanced all-rounder. The widest roster, army upgrades and towers, with Patch Bot / Pulse Coil support. Strong everywhere, extreme nowhere.',
    core: 'core', worker: 'wrench', hero: 'warden',
    buildable: ['cell', 'factory', 'hoverpad', 'arclab', 'guardtower', 'arcbattery'],
    ai: {
      worker: 'wrench', supply: 'cell',
      barracks: 'factory', barracksUnits: ['volt', 'shielder', 'spark', 'chaingunner'],
      air: 'hoverpad', airUnits: ['hover', 'heli', 'jet'],
      tech: 'arclab', techUnits: ['patch', 'pulse'],
      tower: 'guardtower',
    },
  },
  gloop: {
    id: 'gloop', name: 'Gloop', tint: '#5ddc7a',
    blurb: 'Acid swarm — cheap, fast, self-healing units you field in overwhelming numbers. Low supply means far bigger armies; attacks melt armor and no healers are needed. Quantity IS the strategy.',
    core: 'biocore', worker: 'slug', hero: 'matriarch',
    buildable: ['membrane', 'hatchery', 'spire', 'evochamber', 'acidtower'],
    ai: {
      worker: 'slug', supply: 'membrane',
      barracks: 'hatchery', barracksUnits: ['globling', 'spitter', 'bloat', 'hydra'],
      air: 'spire', airUnits: ['floater'],
      tech: 'evochamber', techUnits: [],
      tower: 'acidtower',
    },
  },
  aether: {
    id: 'aether', name: 'Aether', tint: '#b98cff',
    blurb: 'Alien ascendants — a handful of shielded elites that warp in at forward Warp Conduits and hit like a siege. Heavy units eat supply, so you field FEW units — but each one is devastating.',
    core: 'nexus', worker: 'acolyte', hero: 'archon',
    buildable: ['conduit', 'warpgate', 'astralgate', 'conclave', 'photonprism'],
    ai: {
      worker: 'acolyte', supply: 'conduit',
      barracks: 'warpgate', barracksUnits: ['ardent', 'lancer', 'bastion', 'bladesworn'],
      air: 'astralgate', airUnits: ['seraph'],
      tech: 'conclave', techUnits: ['oracle'],
      tower: 'photonprism',
    },
  },
};
RC.RACE_ORDER = ['forge', 'gloop', 'aether'];
RC.buildableOf = function (race) {
  return (RC.RACES[race] || RC.RACES.forge).buildable;
};
// 상대 종족 하나를 무작위로 — 내 종족을 제외한 나머지 중에서 고른다.
// (3종족이 되면서 "반대편 하나"가 성립하지 않으므로 중앙 집중 헬퍼로 뺐다.)
RC.otherRace = function (mine) {
  const pool = RC.RACE_ORDER.filter(r => r !== mine);
  if (!pool.length) return mine;
  return pool[Math.floor(Math.random() * pool.length)];
};

// ── Upgrades (research building) — each costs[] length = max tier ──
RC.UPGRADES = {
  atk:   { id: 'atk',   name: 'Reinforced Rounds', costs: [100, 150, 200], time: [24, 30, 36], desc: 'All units +2 attack (per tier)' },
  arm:   { id: 'arm',   name: 'Alloy Plating',     costs: [100, 150, 200], time: [24, 30, 36], desc: 'All units +1 armor (per tier)' },
  eng:   { id: 'eng',   name: 'Energy Core',       costs: [90, 140, 190],  time: [22, 28, 34], desc: 'More max energy and regen' },
  spd:   { id: 'spd',   name: 'Overdrive',         costs: [110, 170],       time: [26, 32],     desc: 'All units move and attack faster' },
  crit:  { id: 'crit',  name: 'Critical Strike',   costs: [120, 180, 240], time: [28, 34, 40], desc: 'Attacks have a chance to crit (2x)' },
  frost: { id: 'frost', name: 'Cryo Rounds',       costs: [130, 190],       time: [28, 34],     desc: 'Attacks briefly slow the enemy' },
  tough: { id: 'tough', name: 'Reinforced Frame',  costs: [110, 160, 210], time: [26, 32, 38], desc: 'All units gain max HP and regen' },
};
RC.UPGRADE_ORDER = ['atk', 'arm', 'eng', 'spd', 'crit', 'frost', 'tough'];

// ── 팀 색상 (선택 가능) / Selectable team colors ───────────
// After picking a race, the player picks one of these. Each entry carries the
// body / trim / dark triplet the renderer needs (renderer.pal reads RC.playerColors).
RC.TEAMCOLORS = [
  { id: 'azure',   name: 'Azure',   body: '#3a86e0', trim: '#ffb04a', dark: '#1e4a80' },
  { id: 'crimson', name: 'Crimson', body: '#e6483f', trim: '#ffd23f', dark: '#8a221c' },
  { id: 'jade',    name: 'Jade',    body: '#38c46a', trim: '#d7f05a', dark: '#1f6b3c' },
  { id: 'violet',  name: 'Violet',  body: '#b46bff', trim: '#e0a0ff', dark: '#573a80' },
  { id: 'teal',    name: 'Teal',    body: '#22c6c6', trim: '#9ff0e6', dark: '#125e5e' },
  { id: 'amber',   name: 'Amber',   body: '#f0872a', trim: '#ffd694', dark: '#8a4712' },
  { id: 'rose',    name: 'Rose',    body: '#ff6ba8', trim: '#ffc4dc', dark: '#8a2f55' },
  { id: 'gold',    name: 'Gold',    body: '#e8c53f', trim: '#fff2a6', dark: '#8a7016' },
];
RC.DEFAULT_COLOR = 'azure';
// Default color each owner falls back to when the player has not chosen (or for
// AI seats). Kept distinct so 2v2 never has two same-colored seats by default.
RC.OWNER_DEFAULT_COLOR = { 1: 'azure', 2: 'crimson', 3: 'jade', 4: 'violet' };

// ── 생존성 밸런스 패스 / Survivability pass ────────────────
// The attack numbers stayed the same; instead every unit's HP and every plasma
// shield (units AND buildings) is scaled up so fights last longer and units stop
// evaporating. Tweak HP_MULT / SHIELD_MULT here to retune the whole game at once.
RC.BALANCE = { HP_MULT: 1.35, SHIELD_MULT: 1.35 };
(function scaleSurvivability() {
  const hm = RC.BALANCE.HP_MULT, sm = RC.BALANCE.SHIELD_MULT;
  const R = (v, m) => Math.round(v * m);
  for (const k in RC.UNITS) {
    const u = RC.UNITS[k];
    if (u.hp) u.hp = R(u.hp, hm);
    if (u.shield) u.shield = R(u.shield, sm);
    if (u.grow) {
      if (u.grow.hp) u.grow.hp = R(u.grow.hp, hm);
      if (u.grow.shield) u.grow.shield = R(u.grow.shield, sm);
    }
  }
  // Buildings keep their HP (base race stays the same to break) but their plasma
  // shields scale so Aether structures stay proportionally tanky.
  for (const k in RC.BUILDINGS) {
    const b = RC.BUILDINGS[k];
    if (b.shield) b.shield = R(b.shield, sm);
  }
})();
