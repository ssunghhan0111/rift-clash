// RIFT CLASH — 게임 상태 / Game
// 최대 4인, 팀전 지원. 맵/모드는 setup()으로 주입.
window.RC = window.RC || {};

(function () {
  const CFG = RC.CFG;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 다각형 내부 판정 (ray casting) — 자연스러운 지형 외곽선을 위해
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  class Game {
    constructor(mapDef, mode) {
      this.mapDef = mapDef || RC.MAPS[0];
      this.mode = mode || RC.MODES['1v1'];
      this.reset();
    }

    // 맵/모드 교체 후 재시작. racePick = { owner: 'forge'|'gloop' } (선택)
    setup(mapDef, mode, racePick) {
      this.survival = false;
      this.mapDef = mapDef || this.mapDef;
      this.mode = mode || this.mode;
      if (racePick) this._racePick = racePick;
      this.reset();
    }

    // 생존 모드 시작.
    //   오프라인: opts = { race, ally(bool), difficulty }
    //   온라인 협동: opts = { difficulty, players: [{ owner, race, ai }] }  ← 방어자 전원
    setupSurvival(opts) {
      opts = opts || {};
      this.survival = true;
      this.survivalDiff = opts.difficulty || 'medium';
      // 데일리 챌린지 — 모두가 같은 시드와 같은 변형으로 플레이한다.
      // Armed BEFORE reset() so the seeded stream and the twist are in place
      // before the first wave, the crystal and starting shards are built.
      this.daily = null; this._dailyRng = null;
      if (opts.daily && RC.Daily) {
        RC.Daily.arm(this, opts.dailyNow);
        this.survivalDiff = 'medium';        // the twist replaces the difficulty choice
      }
      const pick = {};
      let players;
      if (opts.players && opts.players.length) {
        // 온라인 — 서버가 좌석을 정해서 넘겨준다 (전원 팀 1의 방어자)
        players = opts.players.map(p => ({ owner: p.owner, team: 1, ai: !!p.ai }));
        opts.players.forEach(p => { pick[p.owner] = p.race || 'forge'; });
      } else {
        const race = opts.race || 'forge';
        players = [{ owner: 1, team: 1, ai: false }];
        if (opts.ally) players.push({ owner: 3, team: 1, ai: true });
        pick[1] = race; pick[3] = race;
      }
      // 웨이브 호드는 항상 owner 2 — AI 빌드오더를 돌리지 않으므로 ai:false
      players.push({ owner: 2, team: 2, ai: false, waveEnemy: true });
      pick[2] = 'forge';
      this.mode = { id: 'survival', name: 'Survival', survival: true, count: players.length, players };
      this._racePick = pick;
      this.survivalMap = RC.SURVIVAL;
      this.mapDef = { world: RC.SURVIVAL.world, terrain: RC.SURVIVAL.terrain, obstacles: RC.SURVIVAL.obstacles, spawns: [{ x: 0, y: 0 }] };
      this.reset();
    }

    reset() {
      this.time = 0;
      this.over = null;              // null | 'win' | 'lose'
      this.units = [];
      this.buildings = [];
      this.nodes = [];
      this.obstacles = [];
      this.terrain = [];
      this.fx = [];
      this.selection = [];
      this.placing = null;
      this.camera = { x: 0, y: 0 };
      this.speed = 1;
      this.paused = false;
      this.log = [];
      this.groups = {};
      this.shakeT = 0; this.shakeMax = 0;
      // 데일리 재도전 — 시드 스트림을 처음부터 되감아야 같은 판이 다시 나온다
      if (this.daily && RC.Daily) this._dailyRng = RC.Daily.makeRng(this.daily.seed);

      // 플레이어 구성
      this.players = this.mode.players.map(p => ({ ...p }));
      // 기준 플레이어 — 웨이브 호드(owner 2)는 절대 고르지 않는다. 생존 모드에서
      // 방어자가 전부 AI여도 킬 집계/적대 판정이 뒤집히지 않도록.
      const ref = this.players.find(p => !p.ai && !p.waveEnemy)
               || this.players.find(p => !p.waveEnemy)
               || this.players[0];
      this.playerOwner = ref.owner;
      this.teamMap = {};
      this.playerRace = {};
      this.res = {};
      this.upgrades = {};
      const pick = this._racePick || {};
      this.players.forEach(p => {
        this.teamMap[p.owner] = p.team;
        p.race = pick[p.owner] || p.race || 'forge';
        this.playerRace[p.owner] = p.race;
        // 데일리 챌린지 변형 — 시작 자원이 바뀔 수 있다 (호드 소유자 2는 제외)
        const dmod = this.daily && this.daily.mod;
        const start = (dmod && dmod.startShards && !p.waveEnemy) ? dmod.startShards : CFG.START_SHARD;
        this.res[p.owner] = { shard: start };
        this.upgrades[p.owner] = { atk: 0, arm: 0, eng: 0, spd: 0, crit: 0, frost: 0, tough: 0 };
      });

      this.zones = this.zones || [];
      this.crystal = null;
      this.survivalWave = 0;
      this.survivalKills = 0;
      this.heroOf = {};
      this._ai = {};              // per-game AI memory (see ai.js) — reset with the game
      this._sv = null;            // per-game survival wave state (see survival.js) — same reason
      this._nav = null;           // pathfinding nav grid — rebuilt lazily for the new map
      this.marks = [];            // client-side visual feedback (command markers, damage numbers)
      if (this.survival) this._buildSurvivalMap();
      else this.buildMap();
    }

    notify(msg) {
      this.log.unshift({ msg, t: 4 });
      if (this.log.length > 4) this.log.pop();
    }

    // 화면 흔들림 — 궁극기 같은 큰 순간에만. 렌더러가 읽어 카메라를 흔든다.
    // Purely cosmetic and client-side: the server never needs to know, and a
    // client that ignores it stays perfectly in sync.
    shake(amount) {
      this.shakeT = Math.max(this.shakeT || 0, amount || 0);
      this.shakeMax = Math.max(this.shakeMax || 0.001, this.shakeT);
    }

    // ── 종족 ──────────────────────────────────────────
    raceOf(owner) { return (this.playerRace && this.playerRace[owner]) || 'forge'; }
    raceDef(owner) { return RC.RACES[this.raceOf(owner)] || RC.RACES.forge; }
    buildableFor(owner) { return this.raceDef(owner).buildable; }

    // ── 팀 관계 ───────────────────────────────────────
    teamOf(owner) { return this.teamMap[owner]; }
    allied(a, b) { return this.teamMap[a] === this.teamMap[b]; }
    areEnemies(a, b) { return this.teamMap[a] !== undefined && this.teamMap[b] !== undefined && this.teamMap[a] !== this.teamMap[b]; }
    isAI(owner) { const p = this.players.find(pp => pp.owner === owner); return !!(p && p.ai); }

    // ── 업그레이드 / 연구 ─────────────────────────────
    upLevel(owner, kind) { return (this.upgrades[owner] && this.upgrades[owner][kind]) || 0; }

    applyUpgrade(owner, kind) {
      if (!this.upgrades[owner]) return;
      const max = RC.UPGRADES[kind] ? RC.UPGRADES[kind].costs.length : CFG.UP_MAX_TIER;
      if (this.upgrades[owner][kind] < max) this.upgrades[owner][kind]++;
      if (kind === 'tough') this._rescaleTough(owner);
      if (owner === this.playerOwner) {
        const u = RC.UPGRADES[kind];
        this.notify(`${u.name} Tier ${this.upgrades[owner][kind]} complete!`);
      }
    }

    // 강화 골격 — 해당 owner 전 유닛(탑승 유닛 포함) 최대체력 재계산
    _rescaleTough(owner) {
      const f = 1 + this.upLevel(owner, 'tough') * CFG.UP_TOUGH_HP;
      const scale = u => {
        if (!u.baseMaxHp) return;
        const ratio = u.maxHp ? u.hp / u.maxHp : 1;
        u.maxHp = u.baseMaxHp * f;
        u.hp = u.maxHp * ratio;
      };
      this.units.forEach(u => {
        if (u.owner !== owner) return;
        scale(u);
        if (u.cargo) u.cargo.forEach(scale);
      });
    }

    // 스폰 시 패시브 적용 (강화 골격)
    initUnit(u) {
      const lvl = this.upLevel(u.owner, 'tough');
      if (lvl > 0 && u.baseMaxHp) { u.maxHp = u.baseMaxHp * (1 + lvl * CFG.UP_TOUGH_HP); u.hp = u.maxHp; }
      return u;
    }

    // ── 전술 지형 ─────────────────────────────────────
    // Which tactical zones cover this point? Zones are static map data, so the client
    // and the server always agree without anything crossing the wire.
    terrainAt(x, y) {
      const out = { high: false, forest: false, mud: false, vent: false, any: false };
      const zs = this.zones;
      if (!zs || !zs.length) return out;
      for (const z of zs) {
        let inside;
        if (z.poly) {
          // bounding box first — most points miss, and this is called every tick
          if (x < z.bb[0] || x > z.bb[2] || y < z.bb[1] || y > z.bb[3]) continue;
          inside = pointInPoly(x, y, z.poly);
        } else if (z.r) { const dx = x - z.x, dy = y - z.y; inside = dx * dx + dy * dy <= z.r * z.r; }
        else inside = Math.abs(x - z.x) <= z.w / 2 && Math.abs(y - z.y) <= z.h / 2;
        if (inside && out[z.t] === false) { out[z.t] = true; out.any = true; }
      }
      return out;
    }
    // Forest cover — a defender in the trees takes less damage. Flyers get nothing.
    coverMul(e) {
      if (!e || e.dead) return 1;
      if (e.kind === 'unit' && e.def.flying) return 1;
      const t = this.terrainAt(e.x, e.y);
      return t.forest ? (CFG.TERRAIN.forest.taken || 1) : 1;
    }

    // 타워/광역 피해 적용 (방어력·반격 처리)
    hurt(foe, dmg, owner, source) {
      if (!foe || foe.dead) return;
      if (source && source.def && source.def.acid) RC.applyAcid(foe, source.def.acid);  // 산성 포탑
      const armor = foe.kind === 'unit' ? foe.effArmor(this) : (foe.def && foe.def.armor ? foe.def.armor : 0);
      const dealt = Math.max(1, (dmg - armor) * this.coverMul(foe));   // 숲 엄폐
      if (foe.kind === 'unit') {
        RC.dealDamage(foe, dealt);                            // 실드 우선 흡수
        foe.hitFlash = 0.12;
        if (!foe.dead && foe.state === 'idle' && !foe.def.worker && !foe.def.transport && source) foe.attackTarget(source);
      } else if (foe.damage) {
        foe.damage(dealt);
      }
    }

    // 죽는 순간 산성 폭발 — 주변 적에게 피해 + 산성
    _deathBurst(u) {
      const b = u.def.deathBurst;
      for (const t of this.units) {
        if (t.dead || t.downed || t === u || !this.areEnemies(t.owner, u.owner)) continue;
        if (RC.dist(u.x, u.y, t.x, t.y) <= b.radius) {
          this.hurt(t, b.dmg, u.owner, u);
          if (u.def.acid) RC.applyAcid(t, u.def.acid);
        }
      }
      for (const bl of this.buildings) {
        if (bl.dead || !this.areEnemies(bl.owner, u.owner)) continue;
        if (RC.dist(u.x, u.y, bl.x, bl.y) - bl.r <= b.radius) this.hurt(bl, b.dmg, u.owner, u);
      }
      this.fx.push({ abil: 'acidburst', ax: u.x, ay: u.y, t: 0.45, radius: b.radius, owner: u.owner });
    }

    // ── 영웅: 경험치 / 전사 / 부활 ─────────────────────
    // 죽은 유닛 u 근처의 '적' 영웅(가장 가까운 하나)에게 경험치 지급
    _awardKillXp(u) {
      const H = RC.HERO; if (!H) return;
      const val = u.def.hero ? H.heroXp : (u.def.worker ? H.workerXp : H.killXp + (u.def.supply || 0) * H.killXpPerSupply);
      let best = null, bd = H.xpRange;
      for (const h of this.units) {
        if (!h.hero || h.dead || h.downed || !this.areEnemies(h.owner, u.owner)) continue;
        const d = RC.dist(h.x, h.y, u.x, u.y);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) {
        const lv = best.level;
        best.gainXp(val);
        if (best.level > lv && best.owner === this.playerOwner && RC.Audio) RC.Audio.play('levelup');
      }
    }

    // 영웅 전사 — 제거하지 않고 부활 대기 상태로. 부활 비용을 즉시 차감.
    _downHero(u) {
      u.dead = false;
      u.downed = true;
      u.hp = 0;
      const rv = u.def.revive || {};
      u.reviveT = (rv.base || 60) + (u.level - 1) * (rv.perLevel || 8);
      const cost = (rv.cost || 100) + (u.level - 1) * (rv.costPerLevel || 20);
      u.reviveCost = cost;
      if (this.res[u.owner]) this.res[u.owner].shard = Math.max(0, this.res[u.owner].shard - cost);
      u.foe = null; u.target = null; u.node = null; u.site = null;
      if (u.owner === this.playerOwner) this.notify(`${u.def.name} has fallen — reviving in ${Math.round(u.reviveT)}s`);
    }

    // 영웅 부활 — 본진 옆에 레벨/스킬을 유지한 채 완전 회복으로 재등장
    reviveHero(u) {
      const core = this.core(u.owner);
      if (!core) { u.reviveT = 5; return; }   // 본진이 없으면 잠시 후 재시도
      u.downed = false;
      u.dead = false;
      u._processedDeath = false;
      u.hp = u.maxHp;
      u.energy = u.maxEnergy || 0;
      u.acidStacks = 0; u.slow = 0; u.surge = 0; u.rail = 0; u.bulwark = 0;
      u.skillCd = {};
      u.x = core.x + (Math.random() * 40 - 20);
      u.y = core.y + core.h / 2 + 44;
      u.state = 'idle'; u.foe = null; u.target = null;
      if (u.owner === this.playerOwner) this.notify(`${u.def.name} has revived!`);
    }

    // 타워 표적 — 사거리 내 가장 가까운 적 (공중 가능 여부 반영)
    towerTarget(tower) {
      let best = null, bd = tower.def.range;
      for (const u of this.units) {
        if (u.dead || u.boarded || u.downed || !this.areEnemies(u.owner, tower.owner)) continue;
        if (!tower.def.air && u.def.flying) continue;
        const d = RC.dist(tower.x, tower.y, u.x, u.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return best;
      for (const b of this.buildings) {
        if (b.dead || !this.areEnemies(b.owner, tower.owner)) continue;
        const d = RC.dist(tower.x, tower.y, b.x, b.y) - b.r;
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }

    // 아크 랩에서 업그레이드 연구 시작
    research(building, kind) {
      const owner = building.owner;
      const def = RC.UPGRADES[kind];
      if (!def || !building.done || building.research) return false;
      const lvl = this.upLevel(owner, kind);
      if (lvl >= def.costs.length) { if (owner === this.playerOwner) this.notify('Already at max tier'); return false; }
      const cost = def.costs[lvl];
      if (!this.canAfford(owner, cost)) { if (owner === this.playerOwner) this.notify('Not enough shards'); return false; }
      this.res[owner].shard -= cost;
      const time = def.time[lvl];
      building.research = { kind, timeLeft: time, total: time };
      return true;
    }

    // ── 맵 생성 ───────────────────────────────────────
    buildMap() {
      const map = this.mapDef;
      CFG.WORLD_W = map.world.w;
      CFG.WORLD_H = map.world.h;
      this.world = { w: map.world.w, h: map.world.h };
      this.terrain = (map.terrain || []).map(t => ({ ...t }));
      this.zones = (map.zones || []).map(z => RC.prepZone({ ...z }));
      this.obstacles = (map.obstacles || []).map(o => ({ ...o, r: Math.max(o.w, o.h) / 2 }));

      // 시작 지점을 무작위로 섞어 배정 (적 위치 랜덤)
      const spots = shuffle(map.spawns).slice(0, this.players.length);
      const center = { x: map.world.w / 2, y: map.world.h / 2 };

      this.players.forEach((p, i) => {
        const s = spots[i] || map.spawns[i % map.spawns.length];
        p.spawn = s;
        const rdef = RC.RACES[p.race] || RC.RACES.forge;
        this.buildings.push(new RC.Building(rdef.core, s.x, s.y, p.owner, true));

        // 본진 옆 자원 부채꼴 (맵 중앙 방향)
        const dirX = center.x - s.x, dirY = center.y - s.y;
        for (let k = 0; k < 5; k++) {
          const a = Math.atan2(dirY, dirX) + (k - 2) * 0.34;
          this.nodes.push(new RC.ShardNode(s.x + Math.cos(a) * 210, s.y + Math.sin(a) * 210));
        }

        // 시작 일꾼 4기
        for (let w = 0; w < 4; w++) {
          const ux = s.x - 60 + w * 40;
          const uy = s.y + (s.y < center.y ? 90 : -90);
          const u = new RC.Unit(rdef.worker, ux, uy, p.owner);
          this.units.push(u);
          u.gatherFrom(this.findNearestNode(u.x, u.y));
        }

        // 영웅 (오프라인 전용)
        if (this.heroesEnabled && rdef.hero) {
          const hx = s.x + (s.x < center.x ? 95 : -95);
          const h = new RC.Unit(rdef.hero, hx, s.y, p.owner);
          this.units.push(h);
          this.heroOf[p.owner] = h;
        }
      });

      // 맵 중립 자원 군집
      (map.midNodes || []).forEach(m => {
        const n = m.n || 4, rad = m.rad || 100;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4;
          this.nodes.push(new RC.ShardNode(m.x + Math.cos(a) * rad, m.y + Math.sin(a) * rad));
        }
      });

      // 플레이어 본진 = 카메라 기준
      const me = this.core(this.playerOwner);
      this.spawn1 = me ? { x: me.x, y: me.y } : { x: map.world.w / 2, y: map.world.h / 2 };
      this.camera.x = this.spawn1.x - 640;
      this.camera.y = this.spawn1.y - 380;

      this._initVision();
    }

    // ── 생존 모드 맵 생성 ─────────────────────────────
    // 방어자 팀(1) 기지 + 지킬 크리스탈을 오른쪽에, 적 웨이브 스폰을 왼쪽에 배치.
    _buildSurvivalMap() {
      const map = this.survivalMap;
      CFG.WORLD_W = map.world.w;
      CFG.WORLD_H = map.world.h;
      this.world = { w: map.world.w, h: map.world.h };
      this.terrain = (map.terrain || []).map(t => ({ ...t }));
      this.zones = (map.zones || []).map(z => RC.prepZone({ ...z }));
      this.obstacles = (map.obstacles || []).map(o => ({ ...o, r: Math.max(o.w, o.h) / 2 }));

      // 자원 무더기 (일꾼 채집 대상) — 유닛 생성 전에 먼저 만든다
      (map.nodeClusters || []).forEach(m => {
        const n = m.n || 4, rad = m.rad || 100;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + 0.4;
          this.nodes.push(new RC.ShardNode(m.x + Math.cos(a) * rad, m.y + Math.sin(a) * rad));
        }
      });

      // 방어자(팀 1) 기지 + 시작 일꾼
      const team1 = this.players.filter(p => p.team === 1);
      team1.forEach((p, idx) => {
        const base = map.bases[idx] || map.bases[0];
        p.spawn = base;
        const rdef = RC.RACES[p.race] || RC.RACES.forge;
        this.buildings.push(new RC.Building(rdef.core, base.x, base.y, p.owner, true));
        for (let w = 0; w < 4; w++) {
          const u = new RC.Unit(rdef.worker, base.x - 60 + w * 40, base.y + 90, p.owner);
          this.units.push(u);
          const nn = this.findNearestNode(u.x, u.y);
          if (nn) u.gatherFrom(nn);
        }
        if (this.heroesEnabled && rdef.hero) {
          const h = new RC.Unit(rdef.hero, base.x + 95, base.y, p.owner);
          this.units.push(h);
          this.heroOf[p.owner] = h;
        }
      });

      // 지킬 크리스탈 (방어자 소유)
      const cOwner = team1[0].owner;
      this.crystal = new RC.Building('crystal', map.crystal.x, map.crystal.y, cOwner, true);
      // 데일리 '풍족하지만 약한' 변형 — 크리스탈이 더 잘 깨진다
      const cmod = this.daily && this.daily.mod;
      if (cmod && cmod.crystalHp) {
        this.crystal.maxHp = Math.max(1, Math.round(this.crystal.maxHp * cmod.crystalHp));
        this.crystal.hp = this.crystal.maxHp;
      }
      this.buildings.push(this.crystal);
      this.enemySpawn = { x: map.enemySpawn.x, y: map.enemySpawn.y };

      // 카메라 = 크리스탈 기준
      this.spawn1 = { x: map.bases[0].x, y: map.bases[0].y };
      this.camera.x = this.crystal.x - 640;
      this.camera.y = this.crystal.y - 380;

      this._initVision();
      if (RC.Survival) RC.Survival.reset();
    }

    // ── 전장의 안개 / Fog of War ───────────────────────
    // 격자 두 장: visSeen(한 번이라도 본 곳=탐사됨, 영구) / visNow(지금 보이는 곳, 매틱 갱신)
    _initVision() {
      const cell = CFG.VIS_CELL;
      this.visCell = cell;
      this.visCols = Math.ceil(CFG.WORLD_W / cell);
      this.visRows = Math.ceil(CFG.WORLD_H / cell);
      const n = this.visCols * this.visRows;
      this.visSeen = new Uint8Array(n);
      this.visNow = new Uint8Array(n);
      this._visAcc = 0;
      // 안개 렌더용 저해상도 캔버스 (격자 크기) — 브라우저에서만 생성
      this.fogCanvas = null; this.fogCtx = null; this.fogImg = null;
      if (typeof document !== 'undefined') {
        this.fogCanvas = document.createElement('canvas');
        this.fogCanvas.width = this.visCols;
        this.fogCanvas.height = this.visRows;
        this.fogCtx = this.fogCanvas.getContext('2d');
        this.fogImg = this.fogCtx.createImageData(this.visCols, this.visRows);
        // Second, HARD mask: solid black over anything never explored. The soft fog
        // gets smoothed when it is scaled up, which let terrain bleed through in
        // undiscovered ground — this pass guarantees it stays hidden.
        this.fogHard = document.createElement('canvas');
        this.fogHard.width = this.visCols;
        this.fogHard.height = this.visRows;
        this.fogHardCtx = this.fogHard.getContext('2d');
        this.fogHardImg = this.fogHardCtx.createImageData(this.visCols, this.visRows);
      }
      this.updateVision();
    }

    // 엔티티 시야 반경 — 지형과 날씨가 함께 보정한다.
    // 유닛의 effSight()와 반드시 같은 값을 내야 한다: 하나는 안개를, 다른 하나는
    // 자동 교전 거리를 결정하므로 어긋나면 "보이는데 안 쏜다"가 된다.
    _sightOf(e) {
      const w = RC.Weather ? RC.Weather.sightMul(this) : 1;
      return this._baseSight(e) * this._sightTerrainMul(e) * w;
    }
    // 고지대에 서면 더 멀리 본다 (공중 유닛은 해당 없음)
    _sightTerrainMul(e) {
      if (e.kind === 'unit' && e.def.flying) return 1;
      const t = this.terrainAt(e.x, e.y);
      if (t.high) return CFG.TERRAIN.high.sight || 1;
      if (t.low) return CFG.TERRAIN.low.sight || 1;
      return 1;
    }
    _baseSight(e) {
      if (e.def.sight) return e.def.sight;
      if (e.kind === 'building') {
        if (e.def.isCore) return CFG.SIGHT_CORE;
        if (e.def.tower) return (e.def.range || 0) + CFG.SIGHT_TOWER_PAD;
        return CFG.SIGHT_BUILDING;
      }
      if (e.def.worker) return CFG.SIGHT_WORKER;
      if (e.def.flying) return CFG.SIGHT_AIR;
      return CFG.SIGHT_GROUND;
    }

    // 내 팀 시야로 visNow/visSeen 갱신
    updateVision() {
      if (!CFG.FOG_ENABLED || !this.visNow) return;
      const cell = this.visCell, cols = this.visCols, rows = this.visRows;
      const now = this.visNow, seen = this.visSeen;
      now.fill(0);
      const me = this.playerOwner;
      const stamp = (x, y, r) => {
        if (r <= 0) return;
        const c0 = Math.max(0, Math.floor((x - r) / cell));
        const c1 = Math.min(cols - 1, Math.floor((x + r) / cell));
        const r0 = Math.max(0, Math.floor((y - r) / cell));
        const r1 = Math.min(rows - 1, Math.floor((y + r) / cell));
        const rr = r * r;
        for (let cy = r0; cy <= r1; cy++) {
          const wy = (cy + 0.5) * cell;
          const base = cy * cols;
          for (let cx = c0; cx <= c1; cx++) {
            const wx = (cx + 0.5) * cell;
            const dx = wx - x, dy = wy - y;
            if (dx * dx + dy * dy <= rr) { const i = base + cx; now[i] = 1; seen[i] = 1; }
          }
        }
      };
      for (const u of this.units) {
        if (u.dead || u.boarded || u.downed) continue;
        if (this.allied(u.owner, me)) stamp(u.x, u.y, this._sightOf(u));
      }
      for (const b of this.buildings) {
        if (b.dead) continue;
        if (this.allied(b.owner, me)) stamp(b.x, b.y, this._sightOf(b));
      }
      this._buildFogImage();
    }

    _buildFogImage() {
      if (!this.fogImg) return;
      const d = this.fogImg.data, n = this.visCols * this.visRows;
      const now = this.visNow, seen = this.visSeen;
      const hd = this.fogHardImg ? this.fogHardImg.data : null;
      for (let i = 0; i < n; i++) {
        const j = i << 2;
        d[j] = 3; d[j + 1] = 6; d[j + 2] = 10;
        d[j + 3] = now[i] ? 0 : (seen[i] ? 158 : 255);   // 보임=투명 / 탐사=기억(어둡게) / 미탐사=검정
        if (hd) {
          hd[j] = 0; hd[j + 1] = 0; hd[j + 2] = 0;
          hd[j + 3] = seen[i] ? 0 : 255;                 // 한 번도 못 본 곳만 완전 차단
        }
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      if (this.fogHardCtx) this.fogHardCtx.putImageData(this.fogHardImg, 0, 0);
    }

    _cellIdx(x, y) {
      const c = Math.floor(x / this.visCell), r = Math.floor(y / this.visCell);
      if (c < 0 || r < 0 || c >= this.visCols || r >= this.visRows) return -1;
      return r * this.visCols + c;
    }
    visibleAt(x, y) {
      if (!CFG.FOG_ENABLED || !this.visNow) return true;
      const i = this._cellIdx(x, y);
      return i < 0 ? false : this.visNow[i] === 1;
    }
    exploredAt(x, y) {
      if (!CFG.FOG_ENABLED || !this.visSeen) return true;
      const i = this._cellIdx(x, y);
      return i < 0 ? false : this.visSeen[i] === 1;
    }

    // ── 조회 헬퍼 ─────────────────────────────────────
    core(owner) {
      return this.buildings.find(b => b.owner === owner && b.def.isCore && !b.dead);
    }
    teamCores(team) {
      return this.buildings.filter(b => b.def.isCore && !b.dead && this.teamMap[b.owner] === team);
    }

    supply(owner) {
      let used = 0, max = 0;
      this.units.forEach(u => {
        if (u.owner === owner && !u.dead && !u.free) {   // 궁극기로 부화한 임시 유닛은 인구 미차지
          used += u.def.supply;
          if (u.cargo) u.cargo.forEach(c => used += c.def.supply);   // 탑승 유닛도 인구 차지
        }
      });
      this.buildings.forEach(b => { if (b.owner === owner && !b.dead && b.done) max += b.def.supplyGiven; });
      this.buildings.forEach(b => { if (b.owner === owner && !b.dead) b.queue.forEach(j => used += RC.UNITS[j.type].supply); });
      return { used, max: Math.min(max, CFG.POP_CAP) };
    }

    addShard(owner, n) { this.res[owner].shard += n; }
    canAfford(owner, cost) { return this.res[owner].shard >= cost; }

    findNearestNode(x, y) {
      let best = null, bd = Infinity;
      for (const n of this.nodes) {
        if (n.dead) continue;
        const d = RC.dist(x, y, n.x, n.y);
        if (d < bd) { bd = d; best = n; }
      }
      return best;
    }

    findDropoff(unit) {
      let best = null, bd = Infinity;
      for (const b of this.buildings) {
        if (b.owner !== unit.owner || b.dead || !b.done || !b.def.dropoff) continue;
        const d = RC.dist(unit.x, unit.y, b.x, b.y);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }

    // 팀이 다른 유닛/건물 중 가장 가까운 것
    findNearestEnemy(unit, range) {
      let best = null, bd = range;
      for (const u of this.units) {
        if (u.dead || u.downed || !this.areEnemies(u.owner, unit.owner)) continue;
        const d = RC.dist(unit.x, unit.y, u.x, u.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return best;
      for (const b of this.buildings) {
        if (b.dead || !this.areEnemies(b.owner, unit.owner)) continue;
        const d = RC.dist(unit.x, unit.y, b.x, b.y) - b.r;
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    }

    entityAt(x, y, owner) {
      for (const u of this.units) {
        if (u.dead || u.downed) continue;
        if (owner != null && u.owner !== owner) continue;
        if (RC.dist(x, y, u.x, u.y) <= u.r + 5) return u;
      }
      for (const b of this.buildings) {
        if (b.dead) continue;
        if (owner != null && b.owner !== owner) continue;
        if (b.contains(x, y)) return b;
      }
      return null;
    }

    nodeAt(x, y) {
      for (const n of this.nodes) {
        if (!n.dead && RC.dist(x, y, n.x, n.y) <= n.r + 8) return n;
      }
      return null;
    }

    // ── 배치 검사 ─────────────────────────────────────
    canPlace(type, x, y, owner) {
      const d = RC.BUILDINGS[type];
      const pad = 8;
      if (x - d.w / 2 < 0 || x + d.w / 2 > CFG.WORLD_W) return false;
      if (y - d.h / 2 < 0 || y + d.h / 2 > CFG.WORLD_H) return false;
      for (const b of this.buildings) {
        if (b.dead) continue;
        if (Math.abs(b.x - x) < (b.w + d.w) / 2 + pad &&
            Math.abs(b.y - y) < (b.h + d.h) / 2 + pad) return false;
      }
      for (const o of this.obstacles) {
        if (Math.abs(o.x - x) < (o.w + d.w) / 2 + pad &&
            Math.abs(o.y - y) < (o.h + d.h) / 2 + pad) return false;
      }
      for (const n of this.nodes) {
        if (n.dead) continue;
        if (Math.abs(n.x - x) < d.w / 2 + n.r + pad &&
            Math.abs(n.y - y) < d.h / 2 + n.r + pad) return false;
      }
      return true;
    }

    placeBuilding(type, x, y, owner, workers) {
      const d = RC.BUILDINGS[type];
      if (!this.canAfford(owner, d.cost)) { if (owner === this.playerOwner) this.notify('Not enough shards'); return null; }
      if (!this.canPlace(type, x, y, owner)) { if (owner === this.playerOwner) this.notify('Can’t build here'); return null; }
      // Refuse a spot no assigned worker can actually walk to — otherwise the worker
      // would trudge toward it forever and the shards would already be spent.
      const crew = (workers || []).filter(w => w && !w.dead);
      if (crew.length && RC.Path && RC.Path.reachable &&
          !crew.some(w => RC.Path.reachable(this, w.x, w.y, x, y))) {
        if (owner === this.playerOwner) this.notify('No way through — pick a reachable spot');
        return null;
      }
      this.res[owner].shard -= d.cost;
      const b = new RC.Building(type, x, y, owner, false);
      this.buildings.push(b);
      if (RC.Path && RC.Path.invalidate) RC.Path.invalidate(this);   // new blocker on the map
      crew.forEach(w => w.buildAt(b));
      return b;
    }

    train(building, type) {
      const owner = building.owner;
      const d = RC.UNITS[type];
      if (!building.done) return false;
      if (!this.canAfford(owner, d.cost)) { if (owner === this.playerOwner) this.notify('Not enough shards'); return false; }
      const s = this.supply(owner);
      if (s.used + d.supply > s.max) { if (owner === this.playerOwner) this.notify('Population full — build more supply'); return false; }
      if (building.queue.length >= 5) return false;
      this.res[owner].shard -= d.cost;
      building.queue.push({ type, timeLeft: d.time, total: d.time });
      return true;
    }

    cancelTrain(building) {
      const job = building.queue.pop();
      if (job) this.res[building.owner].shard += RC.UNITS[job.type].cost;
    }

    // 대기열에서 특정 순번의 생산을 취소하고 환불
    cancelQueueAt(building, i) {
      if (!building.queue || i < 0 || i >= building.queue.length) return false;
      const job = building.queue.splice(i, 1)[0];
      if (job) this.res[building.owner].shard += RC.UNITS[job.type].cost;
      return true;
    }

    // 건설 중인(미완성) 건물을 취소 — 전액 환불 후 제거
    cancelBuild(building) {
      if (!building || building.dead || building.done) return false;
      this.res[building.owner].shard += building.def.cost;
      building.dead = true;
      this.selection = this.selection.filter(e => e !== building);
      return true;
    }

    // ── 충돌 분리 ─────────────────────────────────────
    separate() {
      const us = this.units;
      for (let i = 0; i < us.length; i++) {
        const a = us[i];
        if (a.dead || a.downed) continue;
        const aFly = a.def.flying;
        for (let j = i + 1; j < us.length; j++) {
          const b = us[j];
          if (b.dead || b.downed) continue;
          if (aFly !== !!b.def.flying) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          const min = a.r + b.r;
          if (d2 > 0.0001 && d2 < min * min) {
            const d = Math.sqrt(d2);
            const push = (min - d) * 0.5;
            const nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
          }
        }
        if (!aFly) {
          // 건물 밖으로
          for (const bd of this.buildings) {
            if (bd.dead) continue;
            this._pushOutBox(a, bd);
          }
          // 장애물 밖으로
          for (const o of this.obstacles) this._pushOutBox(a, o);
        }
        a.x = Math.max(a.r, Math.min(CFG.WORLD_W - a.r, a.x));
        a.y = Math.max(a.r, Math.min(CFG.WORLD_H - a.r, a.y));
      }
    }

    _pushOutBox(a, box) {
      const hw = box.w / 2 + a.r, hh = box.h / 2 + a.r;
      const dx = a.x - box.x, dy = a.y - box.y;
      if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
        const ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
        if (ox < oy) a.x += (dx < 0 ? -ox : ox);
        else a.y += (dy < 0 ? -oy : oy);
      }
    }

    // ── 메인 업데이트 ─────────────────────────────────
    update(dt) {
      if (this.paused || this.over) return;
      dt *= this.speed;
      this.time += dt;

      this.buildings.forEach(b => { b.__builders = 0; });
      this.units.forEach(u => u.update(dt, this));
      this.buildings.forEach(b => {
        if (!b.done && b.__builders > 0) b.advanceBuild(dt, b.__builders);
        b.update(dt, this);
      });

      RC.AI.update(dt, this);
      if (this.survival && RC.Survival) RC.Survival.update(dt, this);
      this.separate();

      // 죽는 순간 폭발 (블로트 산성 폭발 등)
      for (const u of this.units) {
        if (u.dead && u.def.deathBurst && !u._burst) { u._burst = true; this._deathBurst(u); }
      }

      // 영웅 — 근처 아군 영웅에게 처치 경험치 지급 + 영웅은 제거 대신 '전사'로 전환
      for (const u of this.units) {
        if (!u.dead || u._processedDeath) continue;
        u._processedDeath = true;
        if (RC.Audio) RC.Audio.play('explode');
        this._awardKillXp(u);
        if (this.survival && !u.def.hero && this.areEnemies(u.owner, this.playerOwner)) this.survivalKills++;
        // 죽음 연출 — 순수 시각 이펙트. fx 스냅샷에 실려 온라인 클라이언트도 같은 폭발을 본다.
        // (영웅은 '전사' 상태로 남으므로 폭발 대신 별도 연출 없이 사라진다)
        if (!u.def.hero) {
          this.fx.push({ boom: 1, ax: Math.round(u.x), ay: Math.round(u.y), r: u.r,
                         fly: u.def.flying ? 1 : 0, race: u.def.race || 'forge', t: 0.8 });
        }
        if (u.def.hero) this._downHero(u);
      }

      // 건물 파괴 연출 — 다단 폭발 + 화면 흔들림 (오프라인 즉시, 온라인은 fx 스냅샷 경유)
      for (const b of this.buildings) {
        if (b.dead && !b._boomFx) {
          b._boomFx = true;
          this.fx.push({ boom: 2, ax: Math.round(b.x), ay: Math.round(b.y),
                         r: Math.max(b.w, b.h) * 0.62, race: b.def.race || 'forge', t: 1.6 });
          this.shake(Math.min(0.5, 0.2 + Math.max(b.w, b.h) / 400));
        }
      }

      this.units = this.units.filter(u => !u.dead && !u.boarded);   // 탑승 유닛은 화면에서 제외
      this.buildings = this.buildings.filter(b => !b.dead);
      this.nodes = this.nodes.filter(n => !n.dead);
      this.selection = this.selection.filter(e => !e.dead && !e.boarded);
      this.fx.forEach(f => f.t -= dt);
      this.fx = this.fx.filter(f => f.t > 0);
      this.log.forEach(l => l.t -= dt);
      this.log = this.log.filter(l => l.t > 0);
      if (this.shakeT > 0) {
        this.shakeT = Math.max(0, this.shakeT - dt);
        if (this.shakeT === 0) this.shakeMax = 0;
      }

      // 전장의 안개 — 주기적으로 시야 재계산
      if (CFG.FOG_ENABLED && this.visNow) {
        this._visAcc += dt;
        if (this._visAcc >= CFG.VIS_INTERVAL) { this._visAcc = 0; this.updateVision(); }
      }

      // 승패
      if (this.survival) {
        // 생존 모드 — 크리스탈이 깨지면 종료(무한 모드라 '승리'는 없음)
        if (!this.crystal || this.crystal.dead) this.over = 'lose';
      } else {
        // 대전 — 내 코어가 죽으면 패, 상대 팀 코어가 전멸하면 승
        const myCore = this.core(this.playerOwner);
        if (!myCore) this.over = 'lose';
        else {
          const enemyLeft = this.buildings.some(b =>
            b.def.isCore && !b.dead && this.areEnemies(b.owner, this.playerOwner));
          if (!enemyLeft) this.over = 'win';
        }
      }
    }
  }

  RC.Game = Game;
})();
