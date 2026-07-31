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
// `income` is a straight multiplier on everything the bot mines (see game.addShard).
// The human is always 1.00, so anything above that is the bot mining shards that were
// never in the ground — it compounds into more workers, more production and a bigger
// army, and it is by far the strongest knob in this table. Keep it close to 1.
// ── 행성별 감각 / Planet feel ──────────────────────────────────────────────
// The permanent character of each world, independent of its weather. This is the
// thing a player should notice within five seconds of landing: Ceres is a pebble
// with almost no gravity so everything scoots, Jupiter is crushing and slow.
// `speed` multiplies ground AND air movement. Keep the spread modest — this is
// flavour that must never make a planet strictly better to fight on, and both
// sides always play under the same sky.
RC.PLANET_FEEL = {
  _default: { speed: 1.00, grav: 'Standard gravity' },
  earth:    { speed: 1.00, grav: 'Standard gravity' },
  venus:    { speed: 0.96, grav: 'Thick, heavy air' },
  mars:     { speed: 1.06, grav: 'Low gravity' },
  jupiter:  { speed: 0.92, grav: 'Crushing gravity' },
  saturn:   { speed: 1.04, grav: 'Light gravity' },
  neptune:  { speed: 0.98, grav: 'Dense cold air' },
  pluto:    { speed: 1.08, grav: 'Barely any gravity' },
  ceres:    { speed: 1.12, grav: 'Almost no gravity' },
};
// 날씨 주기 / Weather cycle. Derived from game.time, never sent over the wire.
RC.WEATHER = { cycle: 105, ramp: 0.16 };
RC.WEATHER_ENABLED = true;

RC.AI_DIFF = {
  easy:   { id: 'easy',   name: 'Easy',   income: 0.70, workerCap: 5,  firstWave: 240, waveSize: 3, waveGrowth: 1, waveGap: 160, armyCap: 6,   maxBarracks: 1, secondFactory: 400, tower: false, tech: false },
  normal: { id: 'normal', name: 'Normal', income: 1.00, workerCap: 12, firstWave: 240, waveSize: 4, waveGrowth: 2, waveGap: 135, armyCap: 999, maxBarracks: 2, secondFactory: 300, tower: true,  tech: true  },
  hard:   { id: 'hard',   name: 'Hard',   income: 1.08, workerCap: 14, firstWave: 165, waveSize: 4, waveGrowth: 2, waveGap: 110, armyCap: 999, maxBarracks: 3, secondFactory: 240, tower: true,  tech: true  },
};
// Hard ceiling on the mined-shard multiplier after difficulty and personality have both
// been applied. Without it a Macro bot on Hard stacked 1.30 × 1.10 = 1.43× income, which
// no amount of good play on the human's side can trade against.
RC.AI_INCOME_CAP = 1.15;
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
  // A personality is meant to change the SHAPE of the pressure, not add more of it, so
  // each one pays for what it gains: the Rusher hits early but with a smaller, slower-
  // growing army, the Turtler masses more but arrives much later. Multipliers that were
  // pure upside (Macro's extra income on top of an already larger worker count) are gone.
  rusher:   { id: 'rusher',   name: 'Rusher',   label: '⚔ Rusher',
              firstWaveMul: 0.55, waveSizeMul: 0.65, waveGapMul: 0.7, waveGrowthMul: 0.6,
              workerCapMul: 0.85, tower: false, tech: false, bias: 'ground' },
  turtler:  { id: 'turtler',  name: 'Turtler',  label: '🛡 Turtler',
              firstWaveMul: 1.6, waveSizeMul: 1.45, waveGapMul: 1.25, workerCapMul: 1.1,
              tower: true, tech: true, towerEarly: true },
  skylord:  { id: 'skylord',  name: 'Skylord',  label: '✈ Skylord',
              firstWaveMul: 1.15, waveSizeMul: 1.1, secondFactoryMul: 0.5, tech: true, bias: 'air' },
  macro:    { id: 'macro',    name: 'Macro',    label: '📈 Macro',
              firstWaveMul: 1.5, waveSizeMul: 1.6, workerCapMul: 1.15, tech: true },
};
RC.AI_PERSONA_ORDER = ['balanced', 'rusher', 'turtler', 'skylord', 'macro'];

// Which hero a bot brings. Personality-flavoured rather than random, so a Turtler that
// plants banners and a Rusher that dives with the gap-closer reinforce the label the
// player already saw on the pre-game screen — the bot's hero should be evidence of its
// personality, not a coin flip that contradicts it.
RC.AI_PERSONA_HERO = {
  balanced: 'prism',
  rusher:   'thorn',
  turtler:  'rook',
  skylord:  'ember',
  macro:    'vale',
};
// Personalities the game rolls for a random enemy. `balanced` is in the pool: leaving it
// out meant every single match was against a bot carrying personality multipliers, so the
// plain difficulty profile the numbers above are tuned around was never actually played.
RC.AI_PERSONA_POOL = ['balanced', 'rusher', 'turtler', 'skylord', 'macro'];

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

// ── 유닛 고유 능력 (unit passives) ────────────────────────────────────────
// Units have NO buttons. Everything a unit "does" beyond attacking is a passive that
// fires off its own attacks, its presence, or its death. Three reasons:
//
//   · An active on a unit is a cooldown to babysit, PER UNIT. Twelve Volt Troopers meant
//     twelve Overcharges, and in practice nobody ever pressed them — the AI auto-cast was
//     the only code path that used them at all.
//   · Passives move the decision to COMPOSITION. Bringing Pulse Coils means your army
//     freezes things; bringing Chaingunners means it strips armour. You decide once, at
//     the factory, and then you fight.
//   · It leaves the clicking to the hero, who is one unit and can carry the attention.
//
// A passive is `passive: { id, ...numbers }` on the unit def. `id` selects the behaviour
// in Unit._passiveHit / _passiveAura / _passiveShot (entities.js); every other field is
// that behaviour's tuning. RC.PASSIVE below is the display half only — icon, name, and
// the two descriptions — so adding a number to a unit never means touching the UI.
//
// Statuses a passive can inflict, all of which stack and all of which the renderer draws:
//   chill  → slow, and enough stacks freeze the target solid for a moment
//   venom  → damage over time, refreshed on every hit
//   shred  → armour reduction (the same currency Gloop's acid spends)
//   mark   → the target takes MORE damage from everyone, not just from the marker
RC.PASSIVE = {
  mender:     { ic: '🔧', name: 'Field Repair',  kid: 'Fixes your hurt guys nearby.',
                desc: 'Continuously repairs the most-damaged nearby ally — no button, it just works.' },
  bloom:      { ic: '🌱', name: 'Spore Bloom',   kid: 'Nearby friends heal up.',
                desc: 'Leaks regenerative spores that heal every nearby ally at once.' },
  shieldaura: { ic: '🔷', name: 'Shield Font',   kid: 'Nearby friends get their bubbles back.',
                desc: 'Bathes nearby allies in energy, recharging their plasma shields even mid-fight.' },
  guardaura:  { ic: '🛡️', name: 'Bulwark Field', kid: 'Friends next to it are tougher.',
                desc: 'Nearby allies gain armour, and attackers take a share of their own hit back.' },
  mendaura:   { ic: '💚', name: 'Field Mend',    kid: 'Friends nearby slowly heal up.',
                desc: 'A steady mend on every nearby ally — quiet, constant, and it never stops.' },
  scorch:     { ic: '🔥', name: 'Scorch',        kid: 'Its shots set things on fire.',
                desc: 'Every shot leaves the target burning, and the burns stack up as it keeps firing.' },
  chill:      { ic: '❄️', name: 'Cryo Coils',    kid: 'Its shots make enemies slow — then FROZEN.',
                desc: 'Every hit chills. Enough stacked chill freezes the target solid for a moment.' },
  venom:      { ic: '🧪', name: 'Venom',         kid: 'Its bite keeps hurting after it hits.',
                desc: 'Hits inject venom that eats away at health for several seconds and stacks.' },
  burn:       { ic: '🔥', name: 'Incendiary',    kid: 'Sets enemies on fire.',
                desc: 'Rounds ignite the target, burning it for a few seconds after impact.' },
  shred:      { ic: '🪚', name: 'Armour Shred',  kid: 'Chews through enemy armour.',
                desc: 'Sustained fire peels armour off the target, so everything else hits harder too.' },
  mark:       { ic: '🎯', name: 'Ranging Mark',  kid: 'Paints a target so everyone hurts it more.',
                desc: 'Whatever it hits takes extra damage from your entire army for a few seconds.' },
  chain:      { ic: '⚡', name: 'Arc Chain',     kid: 'Its zap jumps to another enemy.',
                desc: 'Each shot arcs to a second nearby enemy for part of the damage.' },
  cleave:     { ic: '💦', name: 'Splatter',      kid: 'Splashes on the guys standing next to it.',
                desc: 'Hits splatter onto enemies packed around the target — acid and all.' },
  lifesteal:  { ic: '🩸', name: 'Leech',         kid: 'Heals itself when it hits.',
                desc: 'Converts part of every hit into its own health.' },
  thorns:     { ic: '🌵', name: 'Caustic Hide',  kid: 'Hurts anything that hits it.',
                desc: 'Attackers take a share of their own damage back through its caustic hide.' },
  crit:       { ic: '🗡️', name: 'Killing Edge',  kid: 'Sometimes hits SUPER hard.',
                desc: 'A large chance for any strike to land as a critical hit.' },
  execute:    { ic: '☠️', name: 'Finisher',      kid: 'Finishes off hurt enemies fast.',
                desc: 'Deals far more damage to enemies already low on health.' },
  knock:      { ic: '💥', name: 'Concussive',    kid: 'Punches enemies backwards.',
                desc: 'Shells shove the target back, and hit buildings far harder than flesh.' },
  swift:      { ic: '💨', name: 'Strafe Run',    kid: 'Speeds up right after it shoots.',
                desc: 'Accelerates for a moment after every attack — built to hit and run.' },
  ferry:      { ic: '🚁', name: 'Field Hospital', kid: 'Heals whoever is riding inside.',
                desc: 'Patches up the units it is carrying, and stiffens the armour of anyone nearby.' },
  // Buildings draw from the same vocabulary — a tower with `venom` behaves exactly like a
  // Venom Hydra, which is the point. `mire` is the one entry no unit carries: it belongs
  // to a wall, because slowing everything that walks past you is a thing a wall can do and
  // a thing a unit standing in a fight should not.
  mire:       { ic: '🌀', name: 'Sludge Field', kid: 'Bad guys walking near it go really slow.',
                desc: 'Churns the ground around it, so every enemy that comes near crawls.' },
};

// ── 유닛 ──────────────────────────────────────────────
// hp, dmg, range, cd(공격 쿨), speed, r, cost, time, supply, energy
// passive: { id, ... }  — see RC.PASSIVE above. Units have no castable abilities.
RC.UNITS = {
  wrench: {
    id: 'wrench', name: 'Wrench Bot', role: 'Worker',
    hp: 60, dmg: 4, range: 18, cd: 1.2, speed: 100, r: 12, sight: 120,
    cost: 50, time: 11, supply: 1, armor: 0, energy: 60,
    worker: true, key: 'Q',
    passive: { id: 'mender', hps: 6, radius: 130 },
    desc: 'Mines shards and constructs buildings. Trickle-repairs the most damaged thing beside it.'
  },
  volt: {
    id: 'volt', name: 'Volt Trooper', role: 'Infantry',
    hp: 110, dmg: 9, range: 78, cd: 0.85, speed: 88, r: 14, sight: 200,
    cost: 60, time: 15, supply: 1, armor: 0, energy: 60, key: 'Q',
    passive: { id: 'chain', pct: 0.45, range: 92, jumps: 1 },
    desc: 'Basic ranged infantry. Its bolts arc to a second enemy, so massed Volts shred packed lines.'
  },
  shielder: {
    id: 'shielder', name: 'Shieldbearer', role: 'Shield Tank',
    hp: 260, dmg: 7, range: 24, cd: 1.1, speed: 64, r: 18, sight: 170,
    cost: 110, time: 24, supply: 2, armor: 3, energy: 70, key: 'W',
    passive: { id: 'guardaura', armor: 2, radius: 150, thorns: 0.25 },
    desc: 'Frontline damage-soaker. Everything standing behind it is armoured, and hitting it hurts.'
  },
  spark: {
    id: 'spark', name: 'Spark Cannon', role: 'Siege',
    hp: 90, dmg: 26, range: 150, cd: 2.2, speed: 52, r: 16, sight: 185,
    cost: 150, time: 30, supply: 2, armor: 0, energy: 70, splash: 42, key: 'E',
    passive: { id: 'mark', amp: 0.25, dur: 5 },
    desc: 'Long-range siege unit. Its shells paint a target that your whole army then hits harder.'
  },
  hover: {
    id: 'hover', name: 'Hoverwing', role: 'Air',
    hp: 90, dmg: 12, range: 90, cd: 0.8, speed: 130, r: 14,
    cost: 120, time: 22, supply: 2, armor: 0, energy: 60, flying: true, sight: 300, key: 'Q',
    passive: { id: 'swift', mul: 1.35, dur: 1.8 },
    desc: 'Fast air unit that accelerates the instant it fires — it is always leaving as it shoots.'
  },
  patch: {
    id: 'patch', name: 'Patch Bot', role: 'Repair Support',
    hp: 100, dmg: 5, range: 60, cd: 1.0, speed: 96, r: 14, sight: 205,
    cost: 90, time: 20, supply: 2, armor: 1, energy: 110, key: 'Q',
    passive: { id: 'mender', hps: 13, radius: 175, targets: 2 },
    desc: 'Support unit. Constantly mends the three most-wounded allies around it.'
  },
  pulse: {
    id: 'pulse', name: 'Pulse Coil', role: 'Disruptor',
    hp: 85, dmg: 6, range: 105, cd: 1.3, speed: 82, r: 15, sight: 215,
    cost: 130, time: 24, supply: 2, armor: 0, energy: 130, key: 'W',
    passive: { id: 'chill', slow: 1.6, max: 4, freeze: 1.1 },
    desc: 'Disruptor. Every coil-shot chills; four stacks and the target freezes where it stands.'
  },
  chaingunner: {
    id: 'chaingunner', name: 'Chaingunner', role: 'Heavy Gunner',
    hp: 145, dmg: 6, range: 100, cd: 0.32, speed: 78, r: 15, sight: 195,
    cost: 95, time: 19, supply: 2, armor: 1, energy: 70, key: 'R',
    passive: { id: 'shred', amt: 1, dur: 4, max: 5 },
    desc: 'Twin-gun trooper. Its stream of fire peels armour clean off whatever it is pointed at.'
  },
  // ── 신규 항공 ──
  heli: {
    id: 'heli', name: 'Rattler Heli', role: 'Gunship',
    hp: 150, dmg: 17, range: 105, cd: 1.0, speed: 118, r: 16, sight: 255,
    cost: 150, time: 24, supply: 3, armor: 1, energy: 80, flying: true, splash: 20, key: 'W',
    passive: { id: 'burn', dmg: 5, dur: 4, max: 3 },
    desc: 'Ground-attack gunship firing incendiary rockets that leave the target burning.'
  },
  jet: {
    id: 'jet', name: 'Falcon Jet', role: 'Air Superiority',
    hp: 120, dmg: 20, range: 120, cd: 0.7, speed: 170, r: 15,
    cost: 175, time: 26, supply: 3, armor: 0, energy: 70, flying: true, sight: 300, key: 'E',
    passive: { id: 'execute', below: 0.35, mul: 1.8 },
    desc: 'Very fast fighter. Falls on anything already wounded and finishes it outright.'
  },
  dropship: {
    id: 'dropship', name: 'Ferry Dropship', role: 'Transport',
    hp: 220, dmg: 0, range: 0, cd: 1, speed: 130, r: 19, sight: 270,
    cost: 150, time: 24, supply: 3, armor: 1, energy: 0, flying: true, transport: 8, key: 'R',
    passive: { id: 'ferry', cargoHeal: 14, armor: 1, radius: 140 },
    desc: 'Carries ground units over obstacles and enemies, healing them on the way. Select units, then right-click (tap) the dropship to board.'
  },

  // ══ Gloop faction units — Acid & Regeneration ══════════
  // Shared identity: def.regen (HP/sec self-heal) + def.acid (attacks stack acid: -armor + damage over time)
  slug: {
    id: 'slug', name: 'Slug', role: 'Worker',
    hp: 60, dmg: 4, range: 18, cd: 1.2, speed: 104, r: 12, sight: 120,
    cost: 50, time: 11, supply: 1, armor: 0, energy: 60,
    worker: true, regen: 2, race: 'gloop', key: 'Q',
    passive: { id: 'bloom', hps: 4, radius: 140 },
    desc: 'Mines shards and grows structures. Regenerates, and leaks spores that heal the swarm around it.'
  },
  globling: {
    id: 'globling', name: 'Globling', role: 'Swarm Melee',
    hp: 70, dmg: 7, range: 20, cd: 0.7, speed: 132, r: 12, sight: 160,
    cost: 40, time: 8, supply: 1, armor: 0, energy: 50, regen: 5, race: 'gloop',
    acid: { dmg: 2, dur: 4, shred: 1, max: 5 }, key: 'Q',
    passive: { id: 'lifesteal', pct: 0.35 },
    desc: 'Cheap, fast swarm melee. Bites apply acid and feed it — a big enough swarm never stops healing.'
  },
  spitter: {
    id: 'spitter', name: 'Spitter', role: 'Acid Ranged',
    hp: 90, dmg: 11, range: 120, cd: 1.0, speed: 86, r: 14, sight: 205,
    cost: 65, time: 14, supply: 1, armor: 0, energy: 80, regen: 3, race: 'gloop',
    acid: { dmg: 4, dur: 5, shred: 2, max: 5 }, key: 'W',
    passive: { id: 'cleave', pct: 0.5, radius: 62 },
    desc: 'Ranged acid-spitter. Its spray splatters onto everything crowded around the target.'
  },
  bloat: {
    id: 'bloat', name: 'Bloat', role: 'Acid Tank',
    hp: 300, dmg: 10, range: 22, cd: 1.3, speed: 58, r: 18, sight: 150,
    cost: 105, time: 22, supply: 2, armor: 2, energy: 0, regen: 6, race: 'gloop',
    acid: { dmg: 3, dur: 4, shred: 1, max: 5 }, deathBurst: { radius: 110, dmg: 40 }, key: 'E',
    passive: { id: 'thorns', pct: 0.35 },
    desc: 'Giant slime that soaks damage. Regenerates fast, splashes back at whatever bites it, and bursts with acid on death.'
  },
  hydra: {
    id: 'hydra', name: 'Venom Hydra', role: 'Venom Artillery',
    hp: 165, dmg: 15, range: 150, cd: 1.35, speed: 72, r: 17, sight: 185,
    cost: 120, time: 24, supply: 2, armor: 1, energy: 90, regen: 4, race: 'gloop',
    acid: { dmg: 7, dur: 6, shred: 3, max: 6 }, key: 'R',
    passive: { id: 'venom', dmg: 8, dur: 6, max: 4 },
    desc: 'Three-headed serpent that hurls venom from far away. What it hits keeps dying long after the shot lands.'
  },
  floater: {
    id: 'floater', name: 'Floater', role: 'Air Bomber',
    hp: 130, dmg: 16, range: 100, cd: 1.1, speed: 122, r: 16,
    cost: 135, time: 22, supply: 2, armor: 0, energy: 80, regen: 3, race: 'gloop',
    flying: true, sight: 255, splash: 18, acid: { dmg: 3, dur: 4, shred: 1, max: 4 }, key: 'Q',
    passive: { id: 'burn', dmg: 4, dur: 5, max: 3 },
    desc: 'Drifting air unit that drops caustic spores which keep eating after they land.'
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
    passive: { id: 'mender', hps: 6, radius: 130, shield: 8 },
    desc: 'Mines shards and warps structures into place. Channels a steady mend into whatever is hurt beside it.'
  },
  ardent: {
    id: 'ardent', name: 'Ardent', role: 'Melee Vanguard',
    hp: 105, dmg: 17, range: 22, cd: 0.8, speed: 96, r: 14, sight: 175,
    cost: 80, time: 16, supply: 2, armor: 1, energy: 60,
    shield: 70, race: 'aether', key: 'Q',
    passive: { id: 'lifesteal', pct: 0.3, toShield: true },
    desc: 'Shielded melee warrior. Every blow pours back into its own plasma shield.'
  },
  lancer: {
    id: 'lancer', name: 'Void Lancer', role: 'Ranged Support',
    hp: 100, dmg: 19, range: 128, cd: 1.15, speed: 82, r: 15, sight: 215,
    cost: 125, time: 22, supply: 2, armor: 1, energy: 80,
    shield: 90, race: 'aether', key: 'W',
    passive: { id: 'mark', amp: 0.22, dur: 4 },
    desc: 'Long-range shielded striker whose lance-fire leaves a target the rest of your army carves open.'
  },
  bastion: {
    id: 'bastion', name: 'Bastion', role: 'Heavy Siege',
    hp: 190, dmg: 42, range: 140, cd: 2.0, speed: 56, r: 18, sight: 180,
    cost: 195, time: 32, supply: 4, armor: 3, energy: 70,
    shield: 160, splash: 38, race: 'aether', key: 'E',
    passive: { id: 'knock', dist: 26, siege: 1.5 },
    desc: 'Walking siege platform with an enormous shield bank. Its shells hurl infantry back and tear buildings apart.'
  },
  seraph: {
    id: 'seraph', name: 'Seraph', role: 'Air Superiority',
    hp: 110, dmg: 23, range: 118, cd: 0.75, speed: 158, r: 15,
    cost: 185, time: 26, supply: 4, armor: 0, energy: 80,
    shield: 110, flying: true, sight: 300, race: 'aether', key: 'Q',
    passive: { id: 'chain', pct: 0.4, range: 95, jumps: 1 },
    desc: 'Swift shielded interceptor. Its beam forks to a second target on every pass.'
  },
  bladesworn: {
    id: 'bladesworn', name: 'Bladesworn', role: 'Blade Assassin',
    hp: 95, dmg: 24, range: 24, cd: 0.55, speed: 122, r: 13, sight: 200,
    cost: 110, time: 18, supply: 2, armor: 0, energy: 70,
    shield: 65, race: 'aether', key: 'R',
    passive: { id: 'crit', chance: 0.3, mul: 2.2 },
    desc: 'Lightning-fast duellist with two razor knives. Fragile, but a third of its cuts land lethal.'
  },
  oracle: {
    id: 'oracle', name: 'Oracle', role: 'Shield Support',
    hp: 95, dmg: 8, range: 100, cd: 1.2, speed: 92, r: 14, sight: 240,
    cost: 140, time: 24, supply: 2, armor: 0, energy: 140,
    shield: 80, race: 'aether', key: 'W',
    passive: { id: 'shieldaura', sps: 14, radius: 185 },
    desc: 'Support caster whose mere presence recharges the whole army’s shields, even mid-fight.'
  },

  // ══ Heroes — FIVE, and none of them belongs to a race. ══════════════════════
  //
  //    Any hero can deploy with any faction: the player picks the hero on the start
  //    screen and the race separately, so `RC.RACES[x].hero` is gone and no hero def
  //    carries a `race:` tag. Two consequences the rest of the code has to honour:
  //
  //      · PALETTE — the hero owns body/light/dark/trim/ink, the race owns
  //        steel/eye/opticRGB/psi. See heroIdleColors() in renderer.js.
  //      · SUMMONS — anything a hero creates must be race-free too, which is why
  //        Thorn hatches `thornling` and not the Gloop Globling it used to.
  //
  //    Levelling is TWO numbers and they are not the same (see HERO_DESIGN.md §2):
  //      · Match Level 1–10, below — XP from enemies dying nearby, carries the stats,
  //        RESETS every match.
  //      · Mastery 1–30, in RC.MASTERY — persists per hero in the profile, unlocks
  //        options and cosmetics, and NEVER touches a stat.
  //
  //    ROOK   the Anchor  — stand in front of the thing you cannot afford to lose
  //    THORN  the Reaper  — feed on the fight and outlast it
  //    PRISM  the Weaver  — be where the fight isn't, and stop it where it is
  //    EMBER  the Kindler — make ground the enemy cannot stand on
  //    VALE   the Mender  — keep the army alive through the push that should have killed it
  rook: {
    id: 'rook', name: 'Rook', title: 'the Anchor', role: 'Hero', hero: true,
    hp: 620, dmg: 22, range: 30, cd: 1.0, speed: 78, r: 22, sight: 230,
    cost: 0, time: 0, supply: 0, armor: 3, energy: 200, key: 'H',
    grow: { hp: 70, dmg: 4, armor: 0.5 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    passive: { id: 'guardaura', armor: 2, radius: 170, thorns: 0.2 },
    // ── KIT ── Three buttons. Q and E are tactical: they cost energy and come back on a
    //    cooldown, so they are used often and cheaply. R is the signature — it charges
    //    from FIGHTING and is the moment you save for. See RC.SIG below.
    q: {
      id: 'slam', ic: '🔨', name: 'Ground Slam', key: 'Q', slot: 'q', cost: 45, cd: 9,
      kid: 'Jumps in and freezes everyone!',
      desc: 'Leaps at the fight and lands hard enough to freeze everything around the impact.',
      dist: 190, radius: 150, dmg: 55, dmgPerLevel: 5, freeze: 1.1, shake: 0.35,
    },
    // Hold the Line replaced the old Crystal Shockwave, which was measured from the
    // crystal and answered the same question as Bulwark: "the crystal is about to die".
    // A hero whose E and R mean the same thing has wasted a button. The banner answers a
    // different question — "I need this ground for five seconds" — and it is the only
    // ability in the kit that helps the ARMY rather than the objective.
    e: {
      id: 'banner', ic: '🚩', name: 'Hold the Line', key: 'E', slot: 'e', cost: 50, cd: 14,
      kid: 'Plants a flag — your team gets tougher, theirs gets slower!',
      desc: 'Drives a banner into the ground. Enemies around it wade; allies around it fight behind heavier armour.',
      radius: 200, dur: 5, armor: 3, armorPerLevel: 0.2, slowDur: 0.6, dmg: 0, shake: 0.3,
    },
    sig: {
      id: 'dome', ic: '🛡️', name: 'Bulwark', key: 'R', slot: 'r', ult: true,
      // Kid-facing. One line, present tense, says what you will SEE happen.
      kid: 'Puts a big shield bubble on the crystal!',
      desc: 'Slams the ground and throws a shield dome over the crystal, soaking every hit for a few seconds.',
      shield: 900, shieldPerLevel: 80, dur: 6, radius: 300, shake: 0.55,
      ups: [
        { id: 'wide',    ic: '🧱', name: 'Wider Dome',  kid: 'Your fighters get a bubble too!',
          desc: 'Allies inside the dome get a shield of their own, a third as strong.', allyShare: 0.34 },
        { id: 'long',    ic: '⏳', name: 'Longer Hold', kid: 'The bubble lasts longer.',
          desc: 'The dome holds for three extra seconds.', durAdd: 3 },
        { id: 'shatter', ic: '💥', name: 'Shatter',     kid: 'The bubble EXPLODES when it pops!',
          desc: 'When the dome ends it detonates, damaging and reeling everything around the crystal.', shatterDmg: 70, shatterSlow: 1.6 },
      ],
    },
    desc: 'A towering war machine that stands where you tell it to and refuses to move.'
  },
  thorn: {
    id: 'thorn', name: 'Thorn', title: 'the Reaper', role: 'Hero', hero: true, regen: 4,
    hp: 500, dmg: 18, range: 120, cd: 1.0, speed: 84, r: 21, sight: 240,
    cost: 0, time: 0, supply: 0, armor: 1, energy: 220, key: 'H',
    acid: { dmg: 4, dur: 5, shred: 2, max: 6 },
    grow: { hp: 55, dmg: 4, armor: 0.4 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    passive: { id: 'lifesteal', pct: 0.3 },
    // ── KIT ── Q poisons, E eats, R hatches. See Rook above for why Q/E run on
    //    energy and a cooldown while R runs on the fight-charge meter.
    q: {
      id: 'spray', ic: '🧪', name: 'Venom Spray', key: 'Q', slot: 'q', cost: 40, cd: 8,
      kid: 'Sprays poison that keeps hurting!',
      desc: 'A wide venom spray — light on impact, but what it coats keeps dying for six seconds.',
      radius: 175, dmg: 34, dmgPerLevel: 3, venom: { dmg: 9, dur: 6, max: 4 }, shake: 0.25,
    },
    e: {
      id: 'devour', ic: '🩸', name: 'Devour', key: 'E', slot: 'e', cost: 50, cd: 12,
      kid: 'Eats the bad guys to heal herself!',
      desc: 'Rips into everything around her and feeds — the more it hits, the more she heals.',
      radius: 165, dmg: 40, dmgPerLevel: 4, slowDur: 1.2, heal: 45, healCap: 4, shake: 0.3,
    },
    sig: {
      id: 'brood', ic: '🥚', name: 'Hatch the Brood', key: 'R', slot: 'r', ult: true,
      kid: 'Hatches a bunch of babies to fight for you!',
      desc: 'Splits the ground open where the fight is thickest and hatches free globlings that fight for a while.',
      // spawn is `thornling`, NOT the Gloop Globling it used to be. A race-free hero that
      // summoned a faction unit would look wrong in a Forge army and would quietly hand
      // one of Gloop's units to everybody.
      count: 5, countPerLevel: 0.4, maxCount: 12, spawn: 'thornling', life: 26, radius: 130, shake: 0.5,
      ups: [
        { id: 'many',   ic: '🐛', name: 'Bigger Brood', kid: 'Three more babies!',
          desc: 'Three extra hatchlings every time.', countAdd: 3 },
        { id: 'acid',   ic: '🧪', name: 'Acid Babies',  kid: 'The babies pop with acid when they die!',
          desc: 'Every hatchling bursts in an acid cloud when it dies.', burstDmg: 34, burstRadius: 95 },
        { id: 'fierce', ic: '😤', name: 'Angry Brood',  kid: 'The babies come out ANGRY. Fast and strong.',
          desc: 'Hatchlings arrive enraged — faster, and they bite much harder.', hatchSpd: 1.35, hatchDmg: 1.4 },
      ],
    },
    desc: 'Acid-spewing brood queen. Feeds on the fallen — the longer the fight, the stronger she is.'
  },
  prism: {
    id: 'prism', name: 'Prism', title: 'the Weaver', role: 'Hero', hero: true,
    hp: 440, dmg: 26, range: 95, cd: 0.95, speed: 88, r: 22, sight: 250,
    cost: 0, time: 0, supply: 0, armor: 2, energy: 220, shield: 320, key: 'H',
    grow: { hp: 45, dmg: 5, armor: 0.4, shield: 55 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    passive: { id: 'shieldaura', sps: 10, radius: 170 },
    // ── KIT ── Q repositions, E locks a group down, R clears the crystal. See Rook
    //    above for why Q/E run on energy and a cooldown while R runs on fight-charge.
    q: {
      id: 'blink', ic: '🌀', name: 'Phase Shift', key: 'Q', slot: 'q', cost: 35, cd: 7,
      kid: 'Zaps somewhere else and gets a new bubble!',
      desc: 'Folds space to reappear ahead — and comes out the other side with its shield restored.',
      dist: 265, shield: 120, shieldPerLevel: 16, shake: 0.15,
    },
    e: {
      id: 'prison', ic: '❄️', name: 'Static Prison', key: 'E', slot: 'e', cost: 55, cd: 13,
      kid: 'Freezes a whole group of bad guys!',
      desc: 'Snaps a lattice of static shut around a knot of enemies, freezing every one of them solid.',
      radius: 175, dmg: 30, dmgPerLevel: 3, freeze: 1.8, shake: 0.35,
    },
    // ── SIGNATURE ── Prism's answer is MAKE SPACE. The shove is measured from the
    //    CRYSTAL rather than from the hero, so it always clears the thing you are
    //    defending instead of scattering enemies wherever the hero happens to stand.
    sig: {
      id: 'riftnova', ic: '⚡', name: 'Rift Nova', key: 'R', slot: 'r', ult: true,
      kid: 'Blasts the bad guys away from the crystal!',
      desc: 'A radiant shockwave that damages every enemy caught in it and hurls them back away from the crystal.',
      radius: 240, dmg: 70, dmgPerLevel: 8, push: 95, slowDur: 1.5, shake: 0.8,
      ups: [
        { id: 'bigger', ic: '🌀', name: 'Wider Nova', kid: 'A much bigger blast!',
          desc: 'Forty percent more range and damage.', radiusMul: 1.4, dmgMul: 1.4 },
        { id: 'ward',   ic: '✨', name: 'Warding Nova', kid: 'Your fighters get shields too!',
          desc: 'Allies caught in the blast are healed and given a fresh shield.', healAdd: 60, shieldAdd: 140 },
        { id: 'mire',   ic: '🕸️', name: 'Rift Mire', kid: 'The bad guys get stuck in slow goo.',
          desc: 'Leaves the ground churning — everything hit stays slowed far longer.', slowSet: 4 },
      ],
    },
    desc: 'A being of pure energy wrapped in a colossal shield. Never where you swung.'
  },

  // ── EMBER — the Kindler ────────────────────────────────────────────────────
  // The zoner. Every other hero answers "a push is landing" by absorbing it, removing
  // it or outlasting it; Ember answers by making the ground it is standing on cost
  // something. Two mechanics no other unit has — a persistent ground HAZARD that ticks
  // on whoever stands in it, and a damage-AMP debuff — and both are deliberately generic
  // (see game.js `hazards` and `RC.ampMul`) so future content can reuse them.
  ember: {
    id: 'ember', name: 'Ember', title: 'the Kindler', role: 'Hero', hero: true,
    hp: 460, dmg: 20, range: 150, cd: 1.1, speed: 82, r: 20, sight: 260,
    cost: 0, time: 0, supply: 0, armor: 1, energy: 210, key: 'H',
    grow: { hp: 50, dmg: 5, armor: 0.3 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    // Longest basic range in the roster, and the attacks stack a burn — Ember is worth
    // leaving on auto-attack in a way no other hero is.
    passive: { id: 'scorch', dmg: 4, dur: 4, max: 3 },
    q: {
      id: 'line', ic: '🔥', name: 'Cinder Line', key: 'Q', slot: 'q', cost: 40, cd: 8,
      kid: 'Draws a line of fire — don’t step on it!',
      desc: 'Rakes a burning line across the ground ahead. What it touches burns, and the line keeps burning after.',
      len: 300, width: 60, dmg: 30, dmgPerLevel: 3, hazDps: 8, hazDur: 4, shake: 0.25,
    },
    e: {
      id: 'flare', ic: '🎯', name: 'Flare', key: 'E', slot: 'e', cost: 45, cd: 12,
      kid: 'Paints the bad guys — everyone hits them harder!',
      desc: 'Bursts a flare over the thickest knot of enemies. Everything caught in it takes more damage from every source.',
      radius: 180, dur: 6, amp: 0.25, ampPerLevel: 0.01, dmg: 0, shake: 0.2,
    },
    sig: {
      id: 'firestorm', ic: '🌋', name: 'Firestorm', key: 'R', slot: 'r', ult: true,
      kid: 'Sets the whole place on fire!',
      desc: 'Drops a slow, spreading fire over the fight that keeps burning long after the wave arrives.',
      radius: 220, dur: 8, dps: 26, dpsPerLevel: 2.5, shake: 0.7,
      ups: [
        { id: 'wildfire', ic: '🌪️', name: 'Wildfire',  kid: 'The fire gets MUCH bigger!',
          desc: 'Forty percent more ground covered.', radiusMul: 1.4 },
        { id: 'longburn', ic: '⏳', name: 'Long Burn',  kid: 'The fire lasts way longer.',
          desc: 'The fire burns for four extra seconds.', durAdd: 4 },
        { id: 'backdraft', ic: '💨', name: 'Backdraft', kid: 'Running out of the fire HURTS.',
          desc: 'Anything that leaves the fire takes a parting burst and is left reeling.', exitDmg: 45, exitSlow: 1.6 },
      ],
    },
    desc: 'An artillery caster who fights by deciding where the enemy is not allowed to stand.'
  },

  // ── VALE — the Mender ──────────────────────────────────────────────────────
  // The support, and the only hero whose whole kit points at the ARMY rather than at
  // the enemy. Vale is what makes co-op Survival feel different rather than just harder.
  // Note the Q repairs BUILDINGS as well as units, which includes the crystal — it is
  // the only hero ability in the game that can undo objective damage.
  vale: {
    id: 'vale', name: 'Vale', title: 'the Mender', role: 'Hero', hero: true,
    hp: 470, dmg: 16, range: 110, cd: 1.05, speed: 90, r: 20, sight: 250,
    cost: 0, time: 0, supply: 0, armor: 1, energy: 240, key: 'H',
    grow: { hp: 55, dmg: 3, armor: 0.3 },
    revive: { base: 6, perLevel: 12, cost: 80, costPerLevel: 22 },
    passive: { id: 'mendaura', hps: 5, radius: 175 },
    q: {
      id: 'mend', ic: '💚', name: 'Mend Pulse', key: 'Q', slot: 'q', cost: 40, cd: 7,
      kid: 'Heals your whole team — and fixes the crystal!',
      desc: 'A pulse of repair across everything friendly nearby, walls and crystal included.',
      radius: 190, heal: 60, healPerLevel: 8, shake: 0.15,
    },
    e: {
      id: 'slip', ic: '💨', name: 'Slipstream', key: 'E', slot: 'e', cost: 45, cd: 13,
      kid: 'Everyone runs super fast and gets un-frozen!',
      desc: 'Drags the air along behind your army — faster for a few seconds, and whatever was holding them lets go.',
      radius: 200, dur: 4, speedMul: 1.35, cleanse: true, shake: 0.2,
    },
    sig: {
      id: 'sanctuary', ic: '🕊️', name: 'Sanctuary', key: 'R', slot: 'r', ult: true,
      kid: 'Nobody on your team can die for a bit!',
      desc: 'Raises a still place over the fight — everything friendly inside heals, takes far less, and survives the blow that would have killed it.',
      radius: 280, dur: 6, dr: 0.35, hps: 20, hpsPerLevel: 2, guardOnce: true, shake: 0.6,
      ups: [
        { id: 'widesanct', ic: '⭕', name: 'Wide Sanctuary', kid: 'The safe circle gets bigger!',
          desc: 'Thirty-five percent more ground covered.', radiusMul: 1.35 },
        { id: 'grace',     ic: '⏳', name: 'Longer Grace',   kid: 'It lasts longer!',
          desc: 'The sanctuary holds for three extra seconds.', durAdd: 3 },
        { id: 'rally',     ic: '⚔️', name: 'Rally',          kid: 'Your team attacks faster too!',
          desc: 'Allies inside also swing a quarter faster.', hasteMul: 1.25 },
      ],
    },
    desc: 'A field mender. Turns the push that should have killed you into one you walk away from.'
  },

  // ── Thornling — Thorn's summon, and deliberately NOT a faction unit ─────────
  // Hatched by 'brood' and nothing else: no race can build it, it costs nothing, it
  // takes no supply and it expires (`temp` is set at the spawn site). It exists so a
  // race-free hero can summon without borrowing Gloop's Globling — which would both
  // look wrong in a Forge army and hand one faction's unit to all three.
  //
  // Statted a shade under the Globling on purpose: a free, expiring body should lose
  // to a body someone paid 40 shards and a supply for.
  thornling: {
    id: 'thornling', name: 'Thornling', role: 'Summon',
    hp: 62, dmg: 6, range: 20, cd: 0.7, speed: 128, r: 11, sight: 160,
    cost: 0, time: 0, supply: 0, armor: 0, energy: 0, regen: 4,
    summonOnly: true,
    passive: { id: 'lifesteal', pct: 0.35 },
    desc: 'A short-lived hatchling. Free, hungry, and gone in half a minute.'
  },
};

// ── The hero roster ──────────────────────────────────────────────────────────
// FIVE heroes, all unlocked from the first launch. There are no hero slots to buy:
// the player toggles between them on the start screen and each keeps its own Mastery,
// so switching costs you options you have not earned on THAT hero — never power.
//
// Order is the order they appear in the start-screen toggle row.
RC.HEROES = ['rook', 'thorn', 'prism', 'ember', 'vale'];
RC.DEFAULT_HERO = 'rook';

// Old ids, so a stored `riftclash_hero` from before the roster grew still resolves.
// Cheap to keep and the alternative is a player coming back to find their hero gone.
RC.HERO_ALIAS = { warden: 'rook', matriarch: 'thorn', archon: 'prism' };
RC.resolveHero = function (id) {
  const a = RC.HERO_ALIAS[id] || id;
  return (RC.UNITS[a] && RC.UNITS[a].hero) ? a : RC.DEFAULT_HERO;
};

// ── Hero skill bars ──────────────────────────────────────────────────────────
// `def.skills` is the ordered bar the HUD and the hotkeys read: [Q, E, R]. The R entry
// is the SAME OBJECT as `def.sig`, not a copy — the ultimate IS the signature, so every
// place that already reasoned about `def.sig` (Crystal Guard's upgrade cards, the kid
// charge button, the AI's "is it worth it yet" check) keeps working untouched.
// Driven off RC.HEROES rather than a hand-written list, so adding a sixth hero is one
// entry in one array and never "why does the new hero have no Q button?".
for (const _hid of RC.HEROES) {
  const _h = RC.UNITS[_hid];
  if (!_h) throw new Error('RC.HEROES lists an unknown hero: ' + _hid);
  _h.skills = [_h.q, _h.e, _h.sig];
  delete _h.q; delete _h.e;
}

// ── Hero signature abilities ──────────────────────────────────────────────────
// The signature is the hero's ULTIMATE — one per hero, slot R, and the only ability in
// the game that does not run on a cooldown. Two things make it different from Q and E:
//
//   · It charges from FIGHTING, not from time. Spending it early costs nothing when a
//     meter refills on its own schedule, so "now or save it?" is only a real question
//     when the meter fills fastest in the fight you are already in.
//   · It carries the three upgrades. Q and E are constants you learn once; the signature
//     is the thing that grows, and it is what makes the Warden hold, the Matriarch swarm
//     and the Archon shove rather than three flavours of "area damage".
//
// Q and E sit beside it on energy plus a cooldown, so the hero always has SOMETHING to
// press — the old single-button hero spent most of a match with nothing to do.
//
// Shared shape:
//   sig.key      hotkey — always R, so the ultimate is one key across every hero
//   sig.kid      one line a six-year-old can read — what you will SEE happen
//   sig.desc     the grown-up line
//   sig.ups[]    three upgrades unique to that hero. In Crystal Guard they arrive as
//                reward cards; everywhere else they unlock at the levels in upLevels.
//
// The ability charges from FIGHTING rather than ticking back on a cooldown — see
// RC.HERO.charge* below and the accrual in entities.js.
RC.SIG_KEY = 'R';

// Hero progression tuning
RC.HERO = {
  maxLevel: 10, xpBase: 100, xpStep: 60, killXp: 12, killXpPerSupply: 8, workerXp: 6, heroXp: 55, xpRange: 620,
  // ── Signature charge ──
  // Time-charging (the old energy bar) collapses into "use it the moment it is up",
  // because spending early costs nothing — the meter refills at the same rate either
  // way. Charging from participation is what makes "now or save it?" a real question:
  // the meter fills fastest in a big fight, so holding it through a small wave is a
  // genuine sacrifice. The idle trickle is the floor that stops a losing player from
  // being locked out of their own comeback button.
  chargeIdle: 1 / 95,        // full in ~95s doing nothing at all
  chargeDealt: 1 / 2600,     // per point of damage the hero deals
  chargeTaken: 1 / 1500,     // per point taken — tanking charges it too
  chargeKill: 0.02,          // per enemy that dies near the hero
  killRange: 260,
  sigCd: 1.5,                // brief lockout after a cast, so a double-tap cannot double-fire
  upLevels: [3, 6, 9],       // where the three upgrades unlock OUTSIDE Crystal Guard
  // Q/E scale with level the same way the signature does, so a level-10 hero's whole bar
  // is worth pressing rather than just its ultimate.
  skillKeys: ['Q', 'E', 'R'],
};

// ── Mastery — the OTHER level, and the one that persists ─────────────────────
// Read HERO_DESIGN.md §2 before changing anything here. The whole design rests on one
// rule, and it is a rule about what this number may NOT do:
//
//   Mastery persists forever, per hero, and NEVER changes hp, damage, armour, shields,
//   cooldowns, energy or any other simulated quantity. It unlocks OPTIONS.
//
// That is what lets a Mastery-28 player and a Mastery-1 player queue against each other
// with no matchmaking bracket — which matters enormously while the online population is
// small, because every extra bracket is a longer queue.
//
// The enforcement is structural, not documentary: nothing under RC.MASTERY is read by
// entities.js or game.js, and `RC.Unit` has no reference to the profile. If a reviewer
// can find a path from a Mastery value to a stat, the design has been violated.
RC.MASTERY = {
  maxLevel: 30,
  // Cost of level N is xpBase + (N-1) * xpStep, so the curve is linear rather than
  // exponential: a player who plays twice as much is roughly twice as far along, not
  // ten times. Exponential curves are for games that sell the skip.
  xpBase: 260, xpStep: 90,
  // What each match is worth, paid on a LOSS as well as a win for the same reason
  // profile XP is (see Profile.recordMatchEnd). Survival pays per wave.
  matchXp: 55, winBonus: 45, wavePer: 7,
};

// ── Stars — the cosmetic currency ────────────────────────────────────────────
// Paid at the end of every match, spent only on how a hero LOOKS. Stars must never buy
// power; the moment they do, every balance guarantee above is void.
//
// Each clause below is here for a reason worth keeping:
//   · finish/loss pay — a player rewarded only for winning quits the first time they
//     meet someone better. Profile XP already works this way.
//   · performance is capped and shallow (about 2x between a great match and a poor one,
//     not 10x) — a steep curve turns a cosmetic economy into a skill-gated one, and the
//     players who most need a reason to return are the ones losing.
//   · `daily` is the single biggest line — coming back tomorrow should beat grinding
//     tonight. This is the clause that does the retention work.
//   · NOTHING scales with match length, because that pays a player to stall a won game,
//     which is the most corrosive incentive an RTS economy can have.
RC.STARS = {
  finish: 3,          // just for reaching the end screen, win or lose
  win: 5,
  wavePer2: 1,        // survival: +1 per 2 waves cleared …
  waveCap: 12,        // … capped, so wave 60 is not a payday
  levelPer2: 1,       // +1 per 2 Match Levels the hero reached …
  levelCap: 5,        // … capped at 5
  crystalHeld: 3,     // objective never dropped below half
  daily: 10,          // first finished match of the UTC day
  cap: 30,            // hard ceiling per match
};

// ── Cosmetics ────────────────────────────────────────────────────────────────
// Bought once with Stars into a SHARED account inventory, then equipped PER HERO. Buy
// the crown once and decide separately whether Rook or Vale wears it: five heroes worth
// of personality without five times the Stars, and no purchase is wasted when the
// player changes favourites.
//
// Items are drawn generically against the rig each hero's draw function returns (see
// `heroRig` in renderer.js), so one hat lands correctly on all five heroes and adding an
// item is one entry here plus one small draw function — never five.
//
// `pal` items recolour ACCENT channels only. Ownership readability is non-negotiable:
// a player must be able to tell their units from the enemy's instantly, and player
// colour is what does that. See RC.COSMETIC_SAFE below.
RC.COSMETICS = {
  hat: [
    { id: 'none',   name: 'Bare',        stars: 0 },
    { id: 'crown',  name: 'Crown',       stars: 90 },
    { id: 'horns',  name: 'Horns',       stars: 60 },
    { id: 'halo',   name: 'Halo',        stars: 75 },
    { id: 'cap',    name: 'Field Cap',   stars: 40 },
  ],
  suit: [
    { id: 'none',   name: 'Standard',    stars: 0 },
    { id: 'cloak',  name: 'Cloak',       stars: 120 },
    { id: 'plate',  name: 'Heavy Plate', stars: 180 },
    { id: 'sash',   name: 'Sash',        stars: 90 },
  ],
  shoes: [
    { id: 'none',   name: 'Standard',    stars: 0 },
    { id: 'tread',  name: 'Treads',      stars: 55 },
    { id: 'greave', name: 'Greaves',     stars: 80 },
    { id: 'spark',  name: 'Sparkboots',  stars: 90 },
  ],
  palette: [
    { id: 'none',   name: 'Signature',   stars: 0 },
    { id: 'ash',    name: 'Ash',         stars: 25, tint: '#8d939c' },
    { id: 'coal',   name: 'Coal',        stars: 25, tint: '#4a4f5a' },
    { id: 'rust',   name: 'Rust',        stars: 25, tint: '#b5502e' },
    { id: 'jade',   name: 'Jade',        stars: 25, tint: '#2fae86' },
    { id: 'plum',   name: 'Plum',        stars: 25, tint: '#8a5bb8' },
    { id: 'gold',   name: 'Gold',        stars: 40, tint: '#d8a521' },
  ],
};
RC.COSMETIC_SLOTS = ['hat', 'suit', 'shoes', 'palette'];

// In a match a cosmetic palette is blended only this far toward the player's colour
// before it is clamped back. On the MENU there is no enemy to confuse it with, so the
// skin runs at full strength there — the same item, louder where it is safe to be.
RC.COSMETIC_SAFE = 0.55;

// Item lookup that never returns undefined, because a stored id can outlive an item we
// removed and a menu that throws is worse than a hero wearing the default hat.
RC.cosmetic = function (slot, id) {
  const list = RC.COSMETICS[slot] || [];
  return list.find(i => i.id === id) || list[0] || { id: 'none', name: '—', stars: 0 };
};

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
  // ── Defence: one tower per race ──────────────────────────────────────────
  // Forge used to have two (a cheap all-rounder plus a long-range siege battery) and the
  // other two races had one each, which meant "how do I defend" had a different answer
  // depending on who you picked — and the Forge answer was "both". One each, at the SAME
  // hp / cost / damage / range / rate (RC.TOWER_BASE below), so the choice of race changes
  // what your defence DOES, never how much of it you get:
  //
  //   Forge      hurls rock      — splash and a shove, good against a packed push
  //   Gloop      spits venom     — little on impact, lethal to anything that lingers
  //   Aether     fires a laser   — strips armour, so the army behind it hits harder too
  //
  // The passive is the entire difference, and it is the same passive vocabulary the units
  // use (RC.PASSIVE), so a tower reads as a member of its faction rather than as furniture.
  stonethrower: {
    id: 'stonethrower', name: 'Stonethrower', hp: 520, w: 52, h: 52,
    cost: 130, time: 16, supplyGiven: 0, produces: [], key: 'U',
    tower: true, dmg: 18, range: 165, cd: 0.95, air: true, splash: 32,
    passive: { id: 'knock', dist: 22 },
    desc: 'Hurls boulders that burst on impact and shove survivors back. Hits ground and air.'
  },
  // ── Defence: one wall per race ───────────────────────────────────────────
  // A wall is the cheapest thing in the game and the most fun to place. It shoots nothing;
  // it exists to decide WHERE a fight happens, which is the only decision a defender
  // really gets to make. Small footprint on purpose so a row reads as a wall rather than
  // as four sheds, and high hp per shard so blocking a lane is worth doing.
  //
  // Ranged units shoot straight over one — a wall is 42 deep and the shortest-ranged
  // shooter in the game reaches 78 — so the intended shape is a wall with archers behind
  // it, not a wall instead of an army.
  rampart: {
    id: 'rampart', name: 'Rampart', hp: 700, w: 42, h: 42,
    cost: 40, time: 6, supplyGiven: 0, produces: [], key: 'I', wall: true,
    desc: 'A block of riveted plate. Does not shoot — it just gets in the way.'
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
  venomspire: {
    id: 'venomspire', name: 'Venom Spire', hp: 520, w: 52, h: 52,
    cost: 130, time: 16, supplyGiven: 0, produces: [], race: 'gloop', key: 'U',
    tower: true, dmg: 18, range: 165, cd: 0.95, air: true, regen: 4,
    passive: { id: 'venom', dmg: 6, dur: 5, max: 4 },
    desc: 'Living spire that spits venom at ground and air. What it hits keeps dying after it stops.'
  },
  carapace: {
    id: 'carapace', name: 'Carapace Wall', hp: 620, w: 42, h: 42,
    cost: 40, time: 6, supplyGiven: 0, produces: [], race: 'gloop', key: 'I', wall: true, regen: 7,
    desc: 'A slab of grown chitin. Thinner than plate, but it knits itself back together.'
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
  prismlaser: {
    id: 'prismlaser', name: 'Prism Laser', hp: 260, shield: 260, w: 52, h: 52,
    cost: 130, time: 16, supplyGiven: 0, produces: [], race: 'aether', key: 'U',
    tower: true, dmg: 18, range: 165, cd: 0.95, air: true,
    passive: { id: 'shred', amt: 1, dur: 4, max: 4 },
    desc: 'Focused beam turret. Cuts armour off whatever it touches, so your whole army hits it harder.'
  },
  aegiswall: {
    id: 'aegiswall', name: 'Aegis Barrier', hp: 340, shield: 360, w: 42, h: 42,
    cost: 40, time: 6, supplyGiven: 0, produces: [], race: 'aether', key: 'I', wall: true,
    desc: 'A plate of hard light. Little substance behind the shield — but the shield comes back.'
  },

  // ── Survival objective ──
  crystal: {
    id: 'crystal', name: 'Rift Crystal', hp: 4000, w: 84, h: 84,
    cost: 0, time: 0, supplyGiven: 0, produces: [], isCrystal: true,
    desc: 'The universal crystal. Protect it — if it shatters, your run ends.'
  },
};

// ── Crystal Guard walls ───────────────────────────────────────────────────────
// Five walls that are not just five hp numbers. A kid building a fort should be making a
// CHOICE at every segment — cheap now or strong later, hurt them or hold them — and the
// only way that is a choice is if the options are bad at different things.
//
// These live in Crystal Guard only. Dropping five wall types into Versus and Survival
// would rebalance two tuned modes by accident; those two get the one plain race wall
// (rampart / carapace / aegiswall above) and nothing else.
//
// hp per shard is deliberately NOT flat. The Log Fence is the worst value in the mode and
// the Steel Wall is the best, because "save up for the good one" is a lesson worth
// building into the prices. What the cheap one buys you is a wall RIGHT NOW.
RC.BUILDINGS.logwall = {
  id: 'logwall', name: 'Log Fence', hp: 300, w: 42, h: 42,
  cost: 12, time: 3, supplyGiven: 0, produces: [], wall: true, kidOnly: true,
  desc: 'Lashed-together logs. Cheap, quick, and it will not last.'
};
RC.BUILDINGS.steelwall = {
  id: 'steelwall', name: 'Steel Wall', hp: 1900, w: 42, h: 42,
  cost: 70, time: 9, supplyGiven: 0, produces: [], wall: true, kidOnly: true, armor: 3,
  desc: 'Solid plate. The toughest thing you can put in front of the crystal, and the priciest.'
};
// Enemies bog down in the mud it churns out. Almost no health of its own: it is not there
// to be hit, it is there to make the ground in front of the REAL wall miserable.
RC.BUILDINGS.treadwall = {
  id: 'treadwall', name: 'Sludge Belt', hp: 380, w: 42, h: 42,
  cost: 40, time: 6, supplyGiven: 0, produces: [], wall: true, kidOnly: true,
  passive: { id: 'mire', slow: 1.2, radius: 96 },
  desc: 'Churns the ground into sludge. Anything walking near it crawls.'
};
// The one wall that fights back. Attacking it costs you, so it punishes exactly the
// enemies that stop to chew rather than the ones that walk past.
RC.BUILDINGS.spikewall = {
  id: 'spikewall', name: 'Spike Wall', hp: 480, w: 42, h: 42,
  cost: 45, time: 6, supplyGiven: 0, produces: [], wall: true, kidOnly: true,
  passive: { id: 'thorns', pct: 0.45 },
  desc: 'Bristling with spikes. Whatever bites it gets a mouthful back.'
};

// Order of buildings a worker can construct (default = Forge)
RC.BUILDABLE = ['cell', 'factory', 'hoverpad', 'arclab', 'stonethrower', 'rampart'];

// ── What a Crystal Guard player may build ─────────────────────────────────────
// Defence only. A kid gets the build-your-fort loop that makes the mode worth replaying
// without any of the base-building tree the mode exists to avoid: no production buildings,
// no supply, no tech. Prices are the kid prices, not the Versus ones, because these compete
// for the same shards as fighters.
//
// The tower entry has no `t`: it resolves to whichever tower the chosen race builds, so a
// Gloop kid gets a Venom Spire and an Aether kid gets a Prism Laser without this list
// having to know that. See RC.kidBuildFor().
RC.KID_BUILD = [
  { t: null, race: true, ic: '🗼', role: 'Tower', cost: 70, time: 7,
    kid: 'Shoots bad guys all by itself.' },
  { t: 'logwall',   ic: '🪵', role: 'Log Fence',  cost: 12, time: 3,
    kid: 'Super cheap! Breaks fast though.' },
  { t: 'rampart',   ic: '🧱', role: 'Stone Wall', cost: 25, time: 4,
    kid: 'A good solid wall. Build a fence!' },
  { t: 'steelwall', ic: '🛡️', role: 'Steel Wall', cost: 70, time: 9,
    kid: 'SUPER strong. Costs a lot.' },
  { t: 'treadwall', ic: '🌀', role: 'Sludge Belt', cost: 40, time: 6,
    kid: 'Makes bad guys walk really slowly!' },
  { t: 'spikewall', ic: '🌵', role: 'Spike Wall', cost: 45, time: 6,
    kid: 'Ouch! It hurts anything that bites it.' },
];

// The kid build list with the race's tower filled in. One place knows how to do this, so
// adding a fourth race means adding a tower to RC.RACES and nothing else.
RC.kidBuildFor = function (raceId) {
  const race = RC.RACES[raceId] || RC.RACES.forge;
  const tower = (race.ai && race.ai.tower) || 'stonethrower';
  return RC.KID_BUILD.map(b => b.race ? Object.assign({}, b, { t: tower }) : b);
};

// ── Factions ─────────────────────────────────────────
// Each faction's core, worker, build list + AI role map (role -> actual type id).
// The AI plays either faction using only this role map.
RC.RACES = {
  forge: {
    id: 'forge', name: 'Forge', tint: '#f08a2a',
    blurb: 'Machine legion — the balanced all-rounder. The widest roster, army upgrades and towers, with Patch Bot / Pulse Coil support. Strong everywhere, extreme nowhere.',
    core: 'core', worker: 'wrench',
    buildable: ['cell', 'factory', 'hoverpad', 'arclab', 'stonethrower', 'rampart'],
    ai: {
      worker: 'wrench', supply: 'cell',
      barracks: 'factory', barracksUnits: ['volt', 'shielder', 'spark', 'chaingunner'],
      air: 'hoverpad', airUnits: ['hover', 'heli', 'jet'],
      tech: 'arclab', techUnits: ['patch', 'pulse'],
      tower: 'stonethrower',
    },
  },
  gloop: {
    id: 'gloop', name: 'Gloop', tint: '#5ddc7a',
    blurb: 'Acid swarm — cheap, fast, self-healing units you field in overwhelming numbers. Low supply means far bigger armies; attacks melt armor and no healers are needed. Quantity IS the strategy.',
    core: 'biocore', worker: 'slug',
    buildable: ['membrane', 'hatchery', 'spire', 'evochamber', 'venomspire', 'carapace'],
    ai: {
      worker: 'slug', supply: 'membrane',
      barracks: 'hatchery', barracksUnits: ['globling', 'spitter', 'bloat', 'hydra'],
      air: 'spire', airUnits: ['floater'],
      tech: 'evochamber', techUnits: [],
      tower: 'venomspire',
    },
  },
  aether: {
    id: 'aether', name: 'Aether', tint: '#b98cff',
    blurb: 'Alien ascendants — a handful of shielded elites that warp in at forward Warp Conduits and hit like a siege. Heavy units eat supply, so you field FEW units — but each one is devastating.',
    core: 'nexus', worker: 'acolyte',
    buildable: ['conduit', 'warpgate', 'astralgate', 'conclave', 'prismlaser', 'aegiswall'],
    ai: {
      worker: 'acolyte', supply: 'conduit',
      barracks: 'warpgate', barracksUnits: ['ardent', 'lancer', 'bastion', 'bladesworn'],
      air: 'astralgate', airUnits: ['seraph'],
      tech: 'conclave', techUnits: ['oracle'],
      tower: 'prismlaser',
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
