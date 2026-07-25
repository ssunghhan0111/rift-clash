// RIFT CLASH — 엔티티 / Entities
window.RC = window.RC || {};

(function () {
  const CFG = RC.CFG;
  let NEXT_ID = 1;

  function dist(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }
  RC.dist = dist;

  // 유닛이 건물에 "닿았는지" — 건물은 사각형이라 반지름 거리로 재면
  // 충돌 밀어내기(separate)와 어긋나서 영원히 도착 못 하는 교착이 생긴다.
  function touching(u, b, slack) {
    const hw = b.w / 2 + u.r + (slack || 0);
    const hh = b.h / 2 + u.r + (slack || 0);
    return Math.abs(u.x - b.x) <= hw && Math.abs(u.y - b.y) <= hh;
  }
  RC.touching = touching;

  // 산성 중첩 적용 — 대상(유닛/건물)에 스택을 쌓고 지속시간 갱신
  function applyAcid(foe, a) {
    if (!a || !foe || foe.dead) return;
    foe.acidStacks = Math.min(a.max || 5, (foe.acidStacks || 0) + 1);
    foe.acidT = a.dur;
    foe.acidDmg = a.dmg;
    foe.acidShred = a.shred || 0;
  }
  RC.applyAcid = applyAcid;

  // ── 플라즈마 실드 (Aether) ────────────────────────────
  // Single choke point for post-armor damage so units, buildings, towers and
  // splash all obey the same rule: shields soak first, HP takes the remainder.
  // Any hit resets the recharge delay, so shields only regrow out of combat.
  function dealDamage(foe, dealt) {
    if (!foe || dealt <= 0) return 0;
    if (foe.maxShield > 0) {
      foe.shieldT = RC.CFG.SHIELD_DELAY;
      if (foe.shield > 0) {
        const absorbed = Math.min(foe.shield, dealt);
        foe.shield -= absorbed;
        dealt -= absorbed;
        foe.shieldFx = 0.18;                  // brief shield-flare for the renderer
        if (dealt <= 0) return 0;
      }
    }
    foe.hp -= dealt;
    if (foe.hp <= 0) { foe.hp = 0; foe.dead = true; }
    return dealt;
  }
  RC.dealDamage = dealDamage;

  // 실드 회복 — 피격 후 SHIELD_DELAY 초가 지나야 재충전 시작
  function tickShield(e, dt) {
    if (!e.maxShield) return;
    if (e.shieldFx > 0) e.shieldFx = Math.max(0, e.shieldFx - dt);
    if (e.shieldT > 0) { e.shieldT = Math.max(0, e.shieldT - dt); return; }
    if (e.shield < e.maxShield) e.shield = Math.min(e.maxShield, e.shield + RC.CFG.SHIELD_REGEN * dt);
  }
  RC.tickShield = tickShield;

  // 실드 회복 스킬 (오라클 / 아콘) — 실드를 우선 채우고 남은 값을 반환
  function restoreShield(e, amount) {
    if (!e || !e.maxShield || amount <= 0) return amount;
    const room = e.maxShield - e.shield;
    const used = Math.min(room, amount);
    e.shield += used;
    if (used > 0) e.shieldFx = 0.18;
    return amount - used;
  }
  RC.restoreShield = restoreShield;

  // ── 워프 소환 지점 (Aether) ───────────────────────────
  // Combat units produced by an Aether structure materialize at the owner's
  // most FORWARD completed Warp Conduit (the one nearest the enemy) rather than
  // walking out of the production building. Workers always spawn at home so the
  // mining loop isn't broken. Returns null when the normal spawn should be used.
  function warpSite(bld, unitType, game) {
    if (!bld || !bld.def || bld.def.race !== 'aether') return null;
    const ud = RC.UNITS[unitType];
    if (!ud || ud.worker) return null;
    if (!game || !game.buildings) return null;

    const beacons = game.buildings.filter(b =>
      !b.dead && b.done && b.owner === bld.owner && b.def && b.def.warpBeacon);
    if (!beacons.length) return null;

    // 적 본진 방향 = "앞". 적 코어를 못 찾으면 자기 코어에서 가장 먼 도관.
    let ref = null;
    for (const b of game.buildings) {
      if (b.dead || !b.def.isCore) continue;
      if (game.areEnemies && game.areEnemies(b.owner, bld.owner)) {
        const d = RC.dist(bld.x, bld.y, b.x, b.y);
        if (!ref || d < ref.d) ref = { x: b.x, y: b.y, d: d, toward: true };
      }
    }
    if (!ref) {
      const own = game.core ? game.core(bld.owner) : null;
      if (!own) return beacons[0];
      ref = { x: own.x, y: own.y, toward: false };
    }

    let best = null, bestScore = null;
    for (const b of beacons) {
      const d = RC.dist(b.x, b.y, ref.x, ref.y);
      const score = ref.toward ? d : -d;      // 적 쪽이면 가까울수록, 아니면 멀수록 좋다
      if (bestScore === null || score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }
  RC.warpSite = warpSite;

  // ── 샤드 결정 무더기 ────────────────────────────────
  class ShardNode {
    constructor(x, y) {
      this.id = NEXT_ID++;
      this.kind = 'node';
      this.x = x; this.y = y;
      this.r = 20;
      this.amount = CFG.NODE_START;
      this.max = CFG.NODE_START;
    }
    get dead() { return this.amount <= 0; }
  }

  // ── 건물 ────────────────────────────────────────────
  class Building {
    constructor(type, x, y, owner, prebuilt) {
      const d = RC.BUILDINGS[type];
      this.id = NEXT_ID++;
      this.kind = 'building';
      this.type = type;
      this.def = d;
      this.x = x; this.y = y;
      this.w = d.w; this.h = d.h;
      this.r = Math.max(d.w, d.h) / 2;
      this.owner = owner;
      this.maxHp = d.hp;
      this.buildProgress = prebuilt ? 1 : 0;
      this.hp = prebuilt ? d.hp : Math.max(1, d.hp * 0.1);
      this.queue = [];          // {type, timeLeft, total}
      this.research = null;     // {kind, timeLeft, total} — 아크 랩 연구
      this.cd = 0;              // 타워 공격 쿨타임
      this.foe = null;          // 타워 현재 표적
      this.rally = { x: x, y: y + d.h / 2 + 50 };
      this.acidStacks = 0; this.acidT = 0; this.acidDmg = 0; this.acidShred = 0;  // 산성 중첩
      // 플라즈마 실드 (Aether) — 건설이 끝나야 완충된다
      this.maxShield = d.shield || 0;
      this.shield = prebuilt ? this.maxShield : 0;
      this.shieldT = 0; this.shieldFx = 0;
      this.dead = false;
    }

    get done() { return this.buildProgress >= 1; }

    // 건설 진행 — 일꾼이 붙어있는 만큼 빨라짐
    advanceBuild(dt, workers) {
      if (this.done) return;
      const rate = (1 / this.def.time) * (1 + (workers - 1) * 0.5);
      this.buildProgress = Math.min(1, this.buildProgress + rate * dt);
      this.hp = Math.max(this.hp, this.maxHp * (0.1 + 0.9 * this.buildProgress));
      if (this.buildProgress >= 1) { this.hp = this.maxHp; this.shield = this.maxShield; }
    }

    update(dt, game) {
      // 산성 지속 피해 (건설 중에도 진행)
      if (this.acidStacks > 0) {
        this.acidT -= dt;
        this.damage(this.acidStacks * this.acidDmg * dt);
        if (this.acidT <= 0) this.acidStacks = 0;
      }
      if (this.done) RC.tickShield(this, dt);   // 실드 재충전 (완공된 건물만)
      if (!this.done) return;
      // 연구 진행 (아크 랩)
      if (this.research) {
        this.research.timeLeft -= dt;
        if (this.research.timeLeft <= 0) {
          game.applyUpgrade(this.owner, this.research.kind);
          this.research = null;
        }
      }

      // 타워 자동 공격
      if (this.def.tower) {
        this.cd = Math.max(0, this.cd - dt);
        if (this.foe && (this.foe.dead || RC.dist(this.x, this.y, this.foe.x, this.foe.y) > this.def.range + this.foe.r)) this.foe = null;
        if (!this.foe) this.foe = game.towerTarget(this);
        if (this.foe && this.cd <= 0) {
          this.cd = this.def.cd;
          const fx = this.foe.x, fy = this.foe.y;
          // 고지대에 세운 포탑도 화력 보너스를 받는다
          const tz = game.terrainAt ? game.terrainAt(this.x, this.y) : null;
          const tdmg = this.def.dmg * ((tz && tz.high) ? (RC.CFG.TERRAIN.high.atk || 1) : 1);
          game.hurt(this.foe, tdmg, this.owner, this);
          if (this.def.splash) {
            for (const u of game.units) {
              if (u.dead || u === this.foe || !game.areEnemies(u.owner, this.owner)) continue;
              if (!this.def.air && u.def.flying) continue;
              if (RC.dist(fx, fy, u.x, u.y) <= this.def.splash) game.hurt(u, tdmg * 0.5, this.owner, this);
            }
          }
          game.fx.push({ x: this.x, y: this.y - this.h * 0.3, tx: fx, ty: fy, t: 0.1, owner: this.owner, splash: this.def.splash || 0, tower: true });
        }
      }

      const job = this.queue[0];
      if (!job) return;
      job.timeLeft -= dt;
      if (job.timeLeft <= 0) {
        this.queue.shift();
        // Aether 워프 소환 — 전투 유닛은 가장 앞선 워프 도관에서 나타난다.
        // 일꾼은 항상 본진에서 (자원 채집 동선을 지키기 위해).
        const site = RC.warpSite ? RC.warpSite(this, job.type, game) : null;
        const from = site || this;
        const u = new Unit(job.type, from.x, from.y + from.h / 2 + 24, this.owner);
        // 코어 밖으로 살짝 밀어내기
        u.x += (Math.random() - 0.5) * 40;
        if (game.initUnit) game.initUnit(u);      // 강화 골격 등 스폰 시 패시브 적용
        game.units.push(u);
        if (site) {
          // 워프 연출 + 도관 근처 집결 (멀리 있는 생산 건물 집결점으로 되돌아가지 않게)
          game.fx.push({ abil: 'warp', ax: u.x, ay: u.y, t: 0.4, radius: u.r * 2, owner: this.owner });
          u.moveTo(site.x + (Math.random() - 0.5) * 70, site.y + site.h / 2 + 60);
        } else {
          u.moveTo(this.rally.x, this.rally.y);
        }
      }
    }

    contains(px, py) {
      return px >= this.x - this.w / 2 && px <= this.x + this.w / 2 &&
             py >= this.y - this.h / 2 && py <= this.y + this.h / 2;
    }

    damage(amount) {
      RC.dealDamage(this, amount);
    }
  }

  // ── 유닛 ────────────────────────────────────────────
  class Unit {
    constructor(type, x, y, owner) {
      const d = RC.UNITS[type];
      this.id = NEXT_ID++;
      this.kind = 'unit';
      this.type = type;
      this.def = d;
      this.x = x; this.y = y;
      this.r = d.r;
      this.owner = owner;
      this.maxHp = d.hp;
      this.baseMaxHp = d.hp;
      this.hp = d.hp;
      this.speed = d.speed;
      this.facing = 0;
      this.cd = 0;
      this.dead = false;

      // 에너지 / 스킬
      this.maxEnergy = d.energy || 0;
      this.energy = this.maxEnergy * (RC.CFG.ENERGY_START || 0.5);
      this.abilityCd = 0;
      this.curSpeed = d.speed;
      // 버프/디버프 타이머 (초)
      this.surge = 0;      // 볼트병 과부하 사격 (공속·이속↑)
      this.bulwark = 0;    // 실드러 방벽 (방어력↑)
      this.rail = 0;       // 스파크캐논 조준 사격 (사거리·위력↑, 이동불가)
      this.slow = 0;       // 펄스코일 정전 파동 피격 (느려짐)
      this.castFx = 0;     // 시전 연출 타이머
      this.critFx = 0;     // 치명타 연출 타이머
      this._castTry = 0;   // AI 자동시전 시도 간격
      this.cargo = d.transport ? [] : null;  // 수송선 탑승 목록
      this.boarded = false;                  // 수송선에 타 있는 상태
      this.transportTarget = null;           // 탑승하려는 수송선

      this.state = 'idle';      // idle | move | attack | toNode | gather | toDrop | build
      this.target = null;       // 이동 목표 {x,y}
      this.foe = null;          // 공격 대상 엔티티
      this.node = null;         // 채집 중인 무더기
      this.site = null;         // 건설 현장(건물)
      this.path = null;         // 길찾기 경유점 목록 (null = 직선 이동)
      this.attackMove = false;  // 공격-이동 (경로상 적 자동 교전 후 계속 진군)
      this.amoveGoal = null;    // 공격-이동 최종 목적지
      // 자동 교전 — 플레이어가 시킨 게 아니라 스스로 문 싸움인지, 그리고 그때 서 있던 자리.
      // A self-initiated fight is leashed to `post`; a player-ordered attack never is.
      this.auto = false;
      this.post = null;
      this.carry = 0;
      this.gatherTimer = 0;
      this.hitFlash = 0;
      // 산성 중첩 (글룹 피격 시) — 방어 감소 + 지속 피해
      this.acidStacks = 0; this.acidT = 0; this.acidDmg = 0; this.acidShred = 0;
      // 플라즈마 실드 (Aether) — 체력보다 먼저 소모되고 전투 이탈 후 빠르게 재충전
      this.maxShield = d.shield || 0;
      this.baseMaxShield = d.shield || 0;
      this.shield = this.maxShield;
      this.shieldT = 0; this.shieldFx = 0;

      // 영웅 — 경험치 / 레벨 / 스킬 쿨다운 / 부활 상태
      if (d.hero) {
        this.hero = true;
        this.level = 1;
        this.xp = 0;
        this.skillCd = {};        // skill key -> cooldown seconds
        this.downed = false;      // slain, waiting to revive (kept in play, inert)
        this.reviveT = 0;
        this.reviveCost = 0;
      }
    }

    // ── 영웅: 레벨/스킬 헬퍼 ──────────────────────────
    xpToNext() { return RC.HERO.xpBase + (this.level - 1) * RC.HERO.xpStep; }
    // i번째 스킬의 현재 랭크(0=미습득). 레벨 i+1에 습득, 이후 3레벨마다 +1, 최대 3.
    heroRank(i) {
      if (this.level < i + 1) return 0;
      return Math.min(3, 1 + Math.floor((this.level - (i + 1)) / 3));
    }
    _skillByKey(key) {
      const list = this.def.skills || [];
      for (let i = 0; i < list.length; i++) if (list[i].key.toLowerCase() === key) return { sk: list[i], idx: i };
      const ult = this.def.ult;
      if (ult && ult.key.toLowerCase() === key) return { sk: ult, idx: -1, ult: true };
      return null;
    }
    // Ultimates unlock at a level rather than ranking up, so they get their own
    // gate. Returns 0 when still locked, otherwise the hero's level.
    ultRank() {
      const u = this.def.ult;
      if (!u || !this.hero) return 0;
      return this.level >= (u.minLevel || 6) ? this.level : 0;
    }
    ultReady() {
      const u = this.def.ult;
      if (!u || this.downed || !this.ultRank()) return false;
      return (this.skillCd[u.key.toLowerCase()] || 0) <= 0 && this.energy >= u.cost;
    }
    _effSkill(sk, rank) {
      const ab = Object.assign({}, sk);
      if (sk.dmgPerRank) ab.dmg = (sk.dmg || 0) + (rank - 1) * sk.dmgPerRank;
      if (sk.healPerRank) ab.heal = (sk.heal || 0) + (rank - 1) * sk.healPerRank;
      if (sk.distPerRank) ab.dist = (sk.dist || 0) + (rank - 1) * sk.distPerRank;
      if (sk.shieldHealPerRank) ab.shieldHeal = (sk.shieldHeal || 0) + (rank - 1) * sk.shieldHealPerRank;
      return ab;
    }
    // Ultimates scale off the hero's level above the unlock level, not a rank.
    _effUlt(u) {
      const ab = Object.assign({}, u);
      const over = Math.max(0, this.level - (u.minLevel || 6));
      if (u.dmgPerLevel) ab.dmg = (u.dmg || 0) + over * u.dmgPerLevel;
      if (u.shieldPerLevel) ab.shieldGrant = (u.shieldGrant || 0) + over * u.shieldPerLevel;
      if (u.countPerLevel) ab.count = Math.min(u.maxCount || 99, Math.floor((u.count || 0) + over * u.countPerLevel));
      return ab;
    }
    gainXp(n) {
      if (!this.hero || this.level >= RC.HERO.maxLevel) return;
      this.xp += n;
      while (this.level < RC.HERO.maxLevel && this.xp >= this.xpToNext()) {
        this.xp -= this.xpToNext();
        this.level++;
        const g = this.def.grow || {};
        const ratio = this.maxHp ? this.hp / this.maxHp : 1;
        this.baseMaxHp = this.def.hp + (this.level - 1) * (g.hp || 0);
        this.maxHp = this.baseMaxHp;
        this.hp = Math.min(this.maxHp, this.maxHp * ratio + (g.hp || 0));   // small heal on level up
        // Aether 영웅 — 실드 용량도 레벨마다 성장하고, 성장분만큼 즉시 충전
        if (this.baseMaxShield && g.shield) {
          this.maxShield = this.baseMaxShield + (this.level - 1) * g.shield;
          this.shield = Math.min(this.maxShield, this.shield + g.shield);
        }
      }
      if (this.level >= RC.HERO.maxLevel) this.xp = 0;
    }

    moveTo(x, y) {
      this.state = 'move';
      this.target = { x, y };
      this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = false; this.amoveGoal = null;
      this.auto = false; this.post = null;
    }
    // 공격-이동: 목적지로 진군하되 경로상의 적을 자동 교전하고, 처치 후 계속 이동
    attackMoveTo(x, y) {
      this.state = 'move';
      this.target = { x, y };
      this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = true; this.amoveGoal = { x, y };
      this.auto = false; this.post = null;
    }
    // 플레이어(또는 AI)가 명시적으로 지시한 공격 — 목줄(leash) 없이 끝까지 쫓는다
    attackTarget(e) {
      this.state = 'attack';
      this.foe = e; this.target = null; this.node = null; this.site = null; this.path = null;
      this.auto = false; this.post = null;
    }
    // 스스로 발견해서 시작한 교전 — 지금 서 있는 자리를 초소로 삼고 그 주변에서만 싸운다.
    // Without this leash, widening acquisition to a unit's full sight would let an
    // army dribble across the map one sighting at a time.
    engage(e) {
      const px = this.x, py = this.y;
      const am = this.attackMove, goal = this.amoveGoal;
      this.attackTarget(e);
      this.auto = true;
      this.post = { x: px, y: py };
      this.attackMove = am; this.amoveGoal = goal;   // 공격-이동은 처치 후 계속되어야 한다
    }
    gatherFrom(node) {
      if (!this.def.worker) return;
      this.state = 'toNode';
      this.node = node; this.foe = null; this.site = null; this.path = null;
      this.auto = false; this.post = null;
    }
    buildAt(b) {
      if (!this.def.worker) return;
      this.state = 'build';
      this.site = b; this.foe = null; this.node = null; this.path = null;
      this.target = { x: b.x, y: b.y };
      this.auto = false; this.post = null;
    }
    stop() {
      this.state = 'idle';
      this.target = null; this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = false; this.amoveGoal = null;
      this.auto = false; this.post = null;
    }
    boardTarget(ship) {
      if (this.def.flying) return;           // 공중 유닛은 탑승 불가
      this.state = 'toBoard';
      this.transportTarget = ship;
      this.foe = null; this.node = null; this.site = null; this.target = null;
      this.auto = false; this.post = null;
    }

    // ── 자동 교전 판정 ────────────────────────────────
    // 수송선과 무장이 없는 유닛은 절대 스스로 싸우지 않는다.
    canFight() { return !this.def.transport && (this.def.dmg || 0) > 0; }

    // 이 유닛의 실효 시야 — 유닛마다 다르고, 서 있는 지형이 다시 보정한다.
    // 고지대에 오르면 더 멀리 보고, 그만큼 더 멀리서 적을 문다.
    effSight(game) {
      let s = this.def.sight;
      if (!s) s = this.def.worker ? RC.CFG.SIGHT_WORKER
              : this.def.flying ? RC.CFG.SIGHT_AIR : RC.CFG.SIGHT_GROUND;
      const t = this.terr(game);                                 // 공중 유닛은 null → 보정 없음
      if (t && t.high) s *= (RC.CFG.TERRAIN.high.sight || 1);
      else if (t && t.low) s *= (RC.CFG.TERRAIN.low.sight || 1);
      return s;
    }
    // 자동으로 적을 인식하는 거리. 시야가 기준이지만, 사거리보다 짧아질 수는 없다 —
    // 그러면 쏠 수 있는데도 가만히 서 있는 유닛이 생긴다 (조준 사격 중인 공성 유닛 등).
    acquireRange(game) {
      return Math.max(this.effSight(game), this.effRange(game) + (RC.CFG.ACQUIRE_PAD || 0),
                      this.def.sight ? 0 : (RC.CFG.AGGRO_RANGE || 0));
    }
    // 초소에서 이만큼 벗어나면 추격을 포기하고 돌아온다
    leashRange(game) { return this.acquireRange(game) + (RC.CFG.CHASE_PAD || 0); }

    // ── 사거리 판정 ───────────────────────────────────
    // 건물은 사각형이다. 반지름(r = max(w,h)/2)으로 재면 _pushOutBox가 유닛을
    // 밀어내는 거리(w/2 + u.r)와 어긋나서, 근접 유닛이 건물에 딱 붙고도 영원히
    // "사거리 밖"으로 판정되는 교착이 생긴다 — 실제로 글로블링·블로트·아덴트·
    // 실드러·워든은 코어와 리프트 크리스탈을 절대 때리지 못했다.
    // 그래서 건물에는 사각형 가장자리까지의 거리를 쓴다.
    _inReach(foe, game) {
      const r = this.effRange(game);
      if (foe.kind === 'building') {
        const dx = Math.max(Math.abs(this.x - foe.x) - foe.w / 2, 0);
        const dy = Math.max(Math.abs(this.y - foe.y) - foe.h / 2, 0);
        // 지상 유닛은 가장자리에서 this.r 보다 가까이 갈 수 없다 — 그보다 짧은
        // 사거리를 요구하면 물리적으로 영원히 도달할 수 없는 조건이 된다.
        const need = this.def.flying ? r : Math.max(r, this.r + 2);
        return Math.hypot(dx, dy) <= need;
      }
      return dist(this.x, this.y, foe.x, foe.y) <= r + (foe.r || 0);
    }
    // 접근할 때 겨냥할 지점 — 건물이면 가장 가까운 가장자리 위의 점
    _aimPoint(foe) {
      if (foe.kind !== 'building') return { x: foe.x, y: foe.y };
      return {
        x: Math.max(foe.x - foe.w / 2, Math.min(this.x, foe.x + foe.w / 2)),
        y: Math.max(foe.y - foe.h / 2, Math.min(this.y, foe.y + foe.h / 2)),
      };
    }

    // 목표 지점으로 한 스텝 이동. 도착하면 true
    step(dt, x, y, stopDist) {
      const dx = x - this.x, dy = y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= stopDist) return true;
      const v = this.curSpeed * dt;
      if (v <= 0) return false;              // 뿌리내림(조준 사격 등) — 이동 불가
      this.facing = Math.atan2(dy, dx);
      this.x += (dx / d) * Math.min(v, d);
      this.y += (dy / d) * Math.min(v, d);
      return false;
    }

    // ── 길찾기 이동 (지상 유닛 공용) ────────────────────
    // Every ground order — move, gather, drop off, build, board, chase — goes through
    // here so obstacles and buildings are routed AROUND instead of walked into. Plain
    // step() is a straight line and would just grind against a wall until separate()
    // shoved the unit sideways, which is what made units look like they were struggling.
    // Re-plans when the goal moves or when we stop making progress.
    navigate(dt, game, tx, ty, stopDist) {
      if (this.def.flying || !RC.Path) return this.step(dt, tx, ty, stopDist);

      const gl = this._pathGoal;
      if (!gl || Math.abs(gl.x - tx) > 30 || Math.abs(gl.y - ty) > 30) {
        this._pathGoal = { x: tx, y: ty };     // goal moved → the old route is stale
        this.path = null; this._planT = 0; this._stuckT = 0; this._blockedN = 0;
      }

      this._planT = (this._planT || 0) - dt;
      if (this.path == null && this._planT <= 0) {
        this.path = RC.Path.find(game, this.x, this.y, tx, ty) || [];   // [] = straight line is fine
        this._planT = 0.4;                      // never run A* every frame
      }

      let aim = null;
      if (this.path && this.path.length) {
        // drop waypoints already reached
        while (this.path.length && RC.dist(this.x, this.y, this.path[0].x, this.path[0].y) <= this.r + 10) this.path.shift();
        if (this.path.length) aim = this.path[0];
      }
      const final = !aim;
      if (final) aim = { x: tx, y: ty };

      const px = this.x, py = this.y;
      const arrived = this.step(dt, aim.x, aim.y, final ? stopDist : 4);

      // Stuck? Something is in the way that the current route didn't account for
      // (another unit, a building that just went up) — throw the route away and re-plan.
      const moved = Math.hypot(this.x - px, this.y - py);
      if (!arrived && this.curSpeed > 0 && moved < this.curSpeed * dt * 0.35) {
        this._stuckT = (this._stuckT || 0) + dt;
        if (this._stuckT > 0.45) {
          this._stuckT = 0; this.path = null; this._planT = 0;
          this._blockedN = (this._blockedN || 0) + 1;    // consecutive failures to progress
        }
      } else if (moved > 1.5) {
        this._stuckT = 0; this._blockedN = 0;
      }
      return arrived && final;
    }

    // ── 업그레이드 단계 조회 ──
    _up(game, kind) {
      const u = game && game.upgrades && game.upgrades[this.owner];
      return u ? (u[kind] || 0) : 0;
    }
    // 서 있는 지형 (공중 유닛은 지형 영향을 받지 않는다)
    terr(game) {
      if (this.def.flying) return null;
      if (this._terr) return this._terr;
      return (game && game.terrainAt) ? game.terrainAt(this.x, this.y) : null;
    }

    // ── 효과가 반영된 실효 스탯 ──
    effAtk(game) {
      let d = this.def.dmg + this._up(game, 'atk') * RC.CFG.UP_ATK_STEP;
      if (this.hero) d += (this.level - 1) * ((this.def.grow && this.def.grow.dmg) || 0);
      if (this.rail > 0 && this.def.ability) d += this.def.ability.dmgBonus || 0;
      if (this.surge > 0) d *= 1.5;
      const t = this.terr(game);                                   // 고지대 = 화력 우위
      if (t && t.high) d *= (RC.CFG.TERRAIN.high.atk || 1);
      return d;
    }
    effArmor(game) {
      let a = (this.def.armor || 0) + this._up(game, 'arm') * RC.CFG.UP_ARM_STEP;
      if (this.hero) a += (this.level - 1) * ((this.def.grow && this.def.grow.armor) || 0);
      if (this.bulwark > 0 && this.def.ability) a += this.def.ability.armorBonus || 0;
      if (this.acidStacks > 0) a -= this.acidStacks * this.acidShred;   // 산성 = 갑옷 부식
      return Math.max(0, a);
    }
    effRange(game) {
      let r = this.def.range;
      if (this.rail > 0 && this.def.ability) r += this.def.ability.rangeBonus || 0;
      const t = this.terr(game);                                   // 고지대 = 사거리 우위
      if (t && t.high) r *= (RC.CFG.TERRAIN.high.range || 1);
      else if (t && t.low) r *= (RC.CFG.TERRAIN.low.range || 1);   // 저지대 = 사거리 손해
      return r;
    }
    effSplash(game) {
      let s = this.def.splash || 0;
      if (this.rail > 0 && this.def.ability) s += this.def.ability.splashBonus || 0;
      return s;
    }
    effCd(game) {
      let c = this.def.cd;
      if (this.surge > 0 && this.def.ability) c *= (this.def.ability.fire || 0.5);
      if (this.slow > 0) c *= 1.5;
      c /= (1 + this._up(game, 'spd') * RC.CFG.UP_SPD_ATK);   // 기동 강화 = 공속↑
      return c;
    }
    effSpeed(game) {
      let s = this.speed;
      if (this.surge > 0 && this.def.ability) s *= (this.def.ability.spd || 1.3);
      if (this.slow > 0) s *= 0.5;
      s *= (1 + this._up(game, 'spd') * RC.CFG.UP_SPD_MOVE);  // 기동 강화 = 이속↑
      const t = this.terr(game);                               // 늪 = 진창에 발이 묶인다
      if (t && t.mud) s *= (RC.CFG.TERRAIN.mud.speed || 1);
      if (this.speedMul) s *= this.speedMul;                   // 데일리 챌린지 변형 (스프린터 등)
      return s;
    }
    effMaxEnergy(game) { return this.maxEnergy + this._up(game, 'eng') * RC.CFG.UP_ENG_MAXE; }
    effRegen(game) { return RC.CFG.ENERGY_REGEN + this._up(game, 'eng') * RC.CFG.UP_ENG_REGEN; }

    update(dt, game) {
      // 영웅 전사 상태 — 부활 대기(전투/이동 정지), 시간이 되면 부활
      if (this.downed) {
        this.reviveT -= dt;
        if (this.reviveT <= 0 && game.reviveHero) game.reviveHero(this);
        return;
      }
      // 궁극기로 소환된 임시 유닛 — 수명이 다하면 사라진다 (전리품/경험치 없음)
      if (this.temp != null) {
        this.temp -= dt;
        if (this.temp <= 0) {
          this.dead = true;
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.3, radius: this.r, owner: this.owner });
          return;
        }
      }
      this.cd = Math.max(0, this.cd - dt);
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      this.abilityCd = Math.max(0, this.abilityCd - dt);
      if (this.hero) { for (const k in this.skillCd) if (this.skillCd[k] > 0) this.skillCd[k] = Math.max(0, this.skillCd[k] - dt); }
      this.castFx = Math.max(0, this.castFx - dt);
      this.critFx = Math.max(0, this.critFx - dt);
      this.surge = Math.max(0, this.surge - dt);
      this.bulwark = Math.max(0, this.bulwark - dt);
      this.rail = Math.max(0, this.rail - dt);
      this.slow = Math.max(0, this.slow - dt);

      // 에너지 재생
      if (this.maxEnergy) this.energy = Math.min(this.effMaxEnergy(game), this.energy + this.effRegen(game) * dt);

      // 강화 골격 — 비전투 시 체력 재생
      const tough = this._up(game, 'tough');
      if (tough > 0 && this.hp < this.maxHp && this.state !== 'attack' && !this.foe && this.hitFlash <= 0) {
        this.hp = Math.min(this.maxHp, this.hp + tough * RC.CFG.UP_TOUGH_REGEN * dt);
      }

      // 전술 지형 — 이번 틱에 서 있는 지형을 한 번만 조회해 재사용
      this._terr = (game.terrainAt && !this.def.flying) ? game.terrainAt(this.x, this.y) : null;
      // 리프트 분출구 — 그 위에 서 있으면 에너지와 체력이 서서히 찬다
      if (this._terr && this._terr.vent) {
        const v = RC.CFG.TERRAIN.vent;
        if (this.maxEnergy) this.energy = Math.min(this.effMaxEnergy(game), this.energy + (v.energy || 0) * dt);
        if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + (v.heal || 0) * dt);
      }

      // Aether — 플라즈마 실드 재충전 (마지막 피격 후 SHIELD_DELAY 초 경과 시)
      RC.tickShield(this, dt);

      // 글룹 — 타고난 재생 (전투 중엔 절반). 산성에 타 죽는 중이면 멈춤
      if (this.def.regen && this.hp < this.maxHp && this.acidStacks <= 0) {
        const inCombat = this.state === 'attack' || !!this.foe;
        this.hp = Math.min(this.maxHp, this.hp + this.def.regen * (inCombat ? 0.5 : 1) * dt);
      }

      // 산성 지속 피해 + 만료
      if (this.acidStacks > 0) {
        this.acidT -= dt;
        this.hp -= this.acidStacks * this.acidDmg * dt;
        if (this.hp <= 0) { this.hp = 0; this.dead = true; }
        if (this.acidT <= 0) { this.acidStacks = 0; this.acidDmg = 0; this.acidShred = 0; }
      }

      // 이동 속도 갱신 (뿌리내림 시 0)
      this.curSpeed = this.rail > 0 ? 0 : this.effSpeed(game);

      // AI 유닛 자동 스킬 시전 (영웅 포함)
      if ((this.def.ability || this.def.hero) && game.isAI && game.isAI(this.owner)) this._autoCast(dt, game);

      // 죽은 대상 정리
      if (this.foe && this.foe.dead) this.foe = null;
      if (this.node && this.node.dead) this.node = null;
      if (this.site && (this.site.dead || this.site.done)) {
        this.site = null;
        if (this.state === 'build') this.state = 'idle';
      }

      switch (this.state) {
        case 'idle':      this._idle(game); break;
        case 'move':      this._move(dt, game); break;
        case 'attack':    this._attack(dt, game); break;
        case 'toNode':    this._toNode(dt, game); break;
        case 'gather':    this._gather(dt, game); break;
        case 'toDrop':    this._toDrop(dt, game); break;
        case 'build':     this._build(dt, game); break;
        case 'toBoard':   this._toBoard(dt, game); break;
      }
    }

    _idle(game) {
      // 유휴 상태에서는 일꾼도 스스로를 지킨다 (채집/건설 중일 때는 여전히 일을 계속한다 —
      // 그 상태들은 이 함수를 거치지 않는다). 수송선과 비무장 유닛만 예외.
      if (!this.def.transport) {
        const e = this.canFight() ? game.findNearestEnemy(this, this.acquireRange(game)) : null;
        if (e) { this.engage(e); return; }
      }
      // 공격-이동: 근처 적이 없으면 목적지로 계속 진군
      if (this.attackMove && this.amoveGoal) {
        if (RC.dist(this.x, this.y, this.amoveGoal.x, this.amoveGoal.y) > 8) this.attackMoveTo(this.amoveGoal.x, this.amoveGoal.y);
        else { this.attackMove = false; this.amoveGoal = null; }
      }
    }

    _move(dt, game) {
      if (!this.target) { this.state = 'idle'; return; }
      if (this.canFight()) {
        if (this.attackMove) {
          // 공격-이동 — 시야에 들어온 적을 향해 교전을 시작한다
          const e = game.findNearestEnemy(this, this.acquireRange(game));
          if (e) { this.engage(e); return; }   // attackMove/amoveGoal persist → resumes after the kill
        } else {
          // 일반 이동(Move)은 적을 향해 방향을 틀지 않는다 — 그래야 후퇴가 가능하다.
          // 다만 그냥 얻어맞고만 가지는 않는다: 사거리 안에 적이 들어오면 이동을
          // 멈추지 않은 채 응사한다. Return fire never changes the move order.
          this._returnFire(game);
        }
      }
      // 길찾기 — 장애물/건물을 우회한다 (지상). 공중은 직진.
      if (this.navigate(dt, game, this.target.x, this.target.y, 4)) this.stop();
    }

    // 이동 중 응사 — 명령을 바꾸지 않고, 사거리 안에 있고 쿨타임이 찼을 때만 한 발.
    _returnFire(game) {
      if (this.cd > 0 || this.rail > 0) return;
      const reach = this.effRange(game);
      if (reach <= 0) return;
      const e = game.findNearestEnemy(this, reach + 26);
      if (!e || !this._inReach(e, game)) return;
      this._fireAt(e, game);
    }

    _toBoard(dt, game) {
      const ship = this.transportTarget;
      if (!ship || ship.dead || !ship.cargo) { this.state = 'idle'; return; }
      const used = ship.cargo.reduce((s, u) => s + u.def.supply, 0);
      if (used + this.def.supply > ship.def.transport) { this.state = 'idle'; return; }  // 정원 초과
      if (RC.dist(this.x, this.y, ship.x, ship.y) <= ship.r + this.r + 6) {
        ship.cargo.push(this);
        this.boarded = true;
        this.state = 'idle';
        this.transportTarget = null;
      } else {
        this.navigate(dt, game, ship.x, ship.y, ship.r + this.r + 4);
      }
    }

    _attack(dt, game) {
      if (!this.foe) {
        const e = this.canFight() ? game.findNearestEnemy(this, this.acquireRange(game)) : null;
        if (e) { this.foe = e; } else { this.state = 'idle'; return; }
      }
      // 목줄 — 스스로 시작한 싸움이라면 초소에서 너무 멀어졌을 때 추격을 포기한다.
      // 플레이어가 직접 지시한 공격(auto=false)은 어디까지든 쫓아간다.
      if (this.auto && this.post && dist(this.x, this.y, this.post.x, this.post.y) > this.leashRange(game)) {
        const p = this.post;
        if (this.attackMove && this.amoveGoal) this.attackMoveTo(this.amoveGoal.x, this.amoveGoal.y);
        else this.moveTo(p.x, p.y);
        return;
      }
      if (!this._inReach(this.foe, game)) {
        if (this.foe.kind === 'building') {
          // 사각형 가장자리를 향해 붙는다 (중심을 향하면 벽에 갈려 제자리걸음)
          const p = this._aimPoint(this.foe);
          this.navigate(dt, game, p.x, p.y, Math.max(2, this.effRange(game) - this.r));
        } else {
          const reach = this.effRange(game) + this.foe.r;
          this.navigate(dt, game, this.foe.x, this.foe.y, reach - 2);
        }
        return;
      }
      this.facing = Math.atan2(this.foe.y - this.y, this.foe.x - this.x);
      if (this.cd <= 0) this._fireAt(this.foe, game);
    }

    // 한 발 발사 — 사거리/방향 판정은 호출한 쪽 책임. _attack과 이동 중 응사가 공유한다.
    _fireAt(foe, game) {
      if (!foe || foe.dead) return;
      this.cd = this.effCd(game);
      let dmg = this.effAtk(game);
      // 치명 타격 업그레이드 — 확률적 2배
      const critLvl = this._up(game, 'crit');
      let crit = false;
      if (critLvl > 0 && Math.random() < critLvl * RC.CFG.UP_CRIT_CHANCE) {
        dmg *= RC.CFG.UP_CRIT_MULT; crit = true; this.critFx = 0.25;
      }
      const splash = this.effSplash(game);
      const hx = foe.x, hy = foe.y;           // 착탄 지점 (스플래시 중심)
      this._hit(foe, dmg, game);

      // 공성 유닛 스플래시 — 주변 적에게도 피해
      if (splash) {
        const half = dmg * 0.5;
        for (const u of game.units) {
          if (u === foe || u.dead || u.owner === this.owner) continue;
          if (RC.dist(hx, hy, u.x, u.y) <= splash) this._hit(u, half, game);
        }
      }

      game.fx.push({ x: this.x, y: this.y, tx: hx, ty: hy,
                     t: crit ? 0.14 : 0.09, owner: this.owner, splash: splash, crit: crit });
      if (RC.Audio) RC.Audio.play('shoot');
      if (game.marks && (crit || this.hero)) game.marks.push({ dmg: Math.round(dmg), x: foe.x, y: foe.y - (foe.r || 10) - 4, crit: crit, t: 0.8 });
      if (this.foe && this.foe.dead) this.foe = null;
    }

    // 한 대상에게 피해 적용 (방어력 반영, 반격 유발)
    _hit(foe, dmg, game) {
      const armor = foe.kind === 'unit' ? foe.effArmor(game)
                  : (foe.def && foe.def.armor ? foe.def.armor : 0);
      const cover = game.coverMul ? game.coverMul(foe) : 1;   // 숲에 숨은 대상은 덜 아프다
      const dealt = Math.max(1, (dmg - armor) * cover);
      if (this.def.acid) RC.applyAcid(foe, this.def.acid);   // 글룹 — 산성 중첩
      if (foe.kind === 'unit') {
        RC.dealDamage(foe, dealt);                            // 실드 우선 흡수
        foe.hitFlash = 0.12;
        // 동결 탄자 업그레이드 — 피격 시 둔화
        if (this._up(game, 'frost') > 0) foe.slow = Math.max(foe.slow, RC.CFG.FROST_DUR);
        // 반격 — 가만히 서 있다가 맞았으면 되받아친다. 일꾼도 마찬가지지만,
        // 채집·건설 중(state가 idle이 아님)이면 하던 일을 계속한다.
        if (!foe.dead && foe.state === 'idle' && foe.canFight && foe.canFight()) foe.engage(this);
      } else {
        foe.damage(dealt);
      }
    }

    _toNode(dt, game) {
      if (!this.node) { this.node = game.findNearestNode(this.x, this.y); }
      if (!this.node) { this.state = 'idle'; return; }
      if (this.navigate(dt, game, this.node.x, this.node.y, this.node.r + this.r)) {
        this.state = 'gather';
        this.gatherTimer = CFG.GATHER_TIME;
      }
    }

    _gather(dt, game) {
      if (!this.node) { this.state = 'idle'; return; }
      this.gatherTimer -= dt;
      if (this.gatherTimer <= 0) {
        const took = Math.min(CFG.GATHER_AMOUNT, this.node.amount);
        this.node.amount -= took;
        this.carry = took;
        this.state = 'toDrop';
      }
    }

    _toDrop(dt, game) {
      const drop = game.findDropoff(this);
      if (!drop) { this.state = 'idle'; return; }
      this.navigate(dt, game, drop.x, drop.y, 0);
      if (touching(this, drop, 5)) {
        game.addShard(this.owner, this.carry);
        this.carry = 0;
        if (this.node && !this.node.dead) this.state = 'toNode';
        else {
          const n = game.findNearestNode(this.x, this.y);
          if (n) { this.node = n; this.state = 'toNode'; }
          else this.state = 'idle';
        }
      }
    }

    _build(dt, game) {
      if (!this.site) { this.state = 'idle'; return; }
      if (!touching(this, this.site, 6)) {
        this.navigate(dt, game, this.site.x, this.site.y, 0);
        // The worker used to walk in a dead straight line here, so a rock or building in
        // the way meant grinding against it forever with the worker locked — the "freeze".
        // Now it routes around, and if it genuinely can't get there it gives up rather
        // than standing still, refunding an untouched site so no shards are lost.
        this._buildT = (this._buildT || 0) + dt;
        const cutOff = (this._blockedN || 0) >= 4 || this._buildT > 25;
        if (cutOff) {
          const site = this.site;
          this.site = null; this.state = 'idle';
          this._buildT = 0; this._blockedN = 0; this.path = null; this._pathGoal = null;
          if (site && !site.dead && !site.done && site.buildProgress < 0.05 && game.cancelBuild) {
            game.cancelBuild(site);
            if (site.owner === game.playerOwner) game.notify('Can’t reach that spot — build cancelled, shards refunded');
          } else if (site && site.owner === game.playerOwner) {
            game.notify('Worker couldn’t reach the building site');
          }
        }
        return;
      }
      this._buildT = 0; this._blockedN = 0;
      this.site.__builders = (this.site.__builders || 0) + 1;
    }

    // ── 스킬 시전 ────────────────────────────────────
    canCast(game, key) {
      if (this.hero) {
        if (this.downed) return false;
        const s = this._skillByKey((key || '').toLowerCase());
        if (!s) return false;
        if (s.ult) return this.ultReady();
        if (this.heroRank(s.idx) <= 0) return false;
        return (this.skillCd[s.sk.key.toLowerCase()] || 0) <= 0 && this.energy >= s.sk.cost;
      }
      const ab = this.def.ability;
      return !!ab && this.abilityCd <= 0 && this.energy >= ab.cost;
    }

    cast(game, key) {
      if (this.hero) {
        if (this.downed) return false;
        const s = this._skillByKey((key || '').toLowerCase());
        if (!s) return false;
        const kk = s.sk.key.toLowerCase();

        if (s.ult) {                                   // ULTIMATE
          if (!this.ultReady()) return false;
          const ab = this._effUlt(s.sk);
          if (!this._applyAbility(game, ab)) return false;
          this.energy -= s.sk.cost;
          this.skillCd[kk] = s.sk.cd;
          this.castFx = 0.9;                           // longer glow than a normal skill
          game.shake(ab.shake || 0.8);
          game.notify(this.def.name + ' — ' + s.sk.name + '!');
          return true;
        }

        const rank = this.heroRank(s.idx);
        if (rank <= 0 || (this.skillCd[kk] || 0) > 0 || this.energy < s.sk.cost) return false;
        const ab = this._effSkill(s.sk, rank);
        if (!this._applyAbility(game, ab)) return false;   // 대상 없으면 소모 안 함
        this.energy -= s.sk.cost;
        this.skillCd[kk] = s.sk.cd;
        this.castFx = 0.4;
        return true;
      }
      const ab = this.def.ability;
      if (!ab || this.abilityCd > 0 || this.energy < ab.cost) return false;
      if (!this._applyAbility(game, ab)) return false;   // 대상이 없으면 소모 안 함
      this.energy -= ab.cost;
      this.abilityCd = ab.cd;
      this.castFx = 0.4;
      return true;
    }

    _applyAbility(game, ab) {
      switch (ab.id) {
        case 'weld': {   // 렌치봇 — 가장 다친 근처 아군 수리
          let best = null, worst = 0;
          const scan = (e) => {
            if (e.dead || e === this || e.owner !== this.owner) return;
            if (RC.dist(this.x, this.y, e.x, e.y) > ab.radius) return;
            const missing = e.maxHp - e.hp;
            if (missing > worst) { worst = missing; best = e; }
          };
          game.units.forEach(scan);
          game.buildings.forEach(b => { if (b.done) scan(b); });
          if (!best || worst <= 0) return false;
          best.hp = Math.min(best.maxHp, best.hp + ab.heal);
          game.fx.push({ abil: 'heal', ax: best.x, ay: best.y, t: 0.5, radius: 22, owner: this.owner });
          if (game.marks) game.marks.push({ dmg: ab.heal, heal: true, x: best.x, y: best.y - (best.r || 10) - 4, t: 0.8 });
          return true;
        }
        case 'surge': {  // 볼트병 — 과부하 사격
          this.surge = ab.dur;
          this.hp = Math.max(1, this.hp - (ab.hpCost || 0));
          return true;
        }
        case 'bulwark': { // 실드러 — 방벽 전개 + 도발
          this.bulwark = ab.dur;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            // 도발은 그 유닛의 주인이 내린 명령이 아니다 — 목줄이 걸린 자동 교전으로 취급한다
            if (RC.dist(this.x, this.y, u.x, u.y) <= ab.radius && u.canFight()) u.engage(this);
          }
          return true;
        }
        case 'raillock': { // 스파크캐논 — 조준 사격 (고정 폭격)
          this.rail = ab.dur;
          return true;
        }
        case 'warp': {   // 호버윙 — 점멸 부스터
          const nx = this.x + Math.cos(this.facing) * ab.dist;
          const ny = this.y + Math.sin(this.facing) * ab.dist;
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.35, radius: this.r, owner: this.owner });
          this.x = Math.max(this.r, Math.min(RC.CFG.WORLD_W - this.r, nx));
          this.y = Math.max(this.r, Math.min(RC.CFG.WORLD_H - this.r, ny));
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.35, radius: this.r, owner: this.owner });
          return true;
        }
        case 'mend': {   // 패치봇 나노 치유 / 오라클·아콘 실드 재충전 (범위)
          let any = false;
          for (const u of game.units) {
            if (u.dead || u.owner !== this.owner) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > ab.radius) continue;
            // Aether 계열 — 실드를 먼저 채우고, 체력이 빈 만큼 추가로 회복
            if (ab.shieldHeal && u.maxShield && u.shield < u.maxShield) {
              RC.restoreShield(u, ab.shieldHeal);
              any = true;
            }
            if (u.hp < u.maxHp) {
              u.hp = Math.min(u.maxHp, u.hp + ab.heal);
              any = true;
            }
          }
          if (!any) return false;
          game.fx.push({ abil: 'heal', ax: this.x, ay: this.y, t: 0.45, radius: ab.radius, owner: this.owner });
          if (game.marks) game.marks.push({ dmg: ab.heal, heal: true, x: this.x, y: this.y - (this.r || 10) - 4, t: 0.8 });
          return true;
        }
        case 'nova': {   // 펄스코일 — 정전 파동 (범위 교란)
          let any = false;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > ab.radius) continue;
            this._hit(u, ab.dmg, game);
            if (u.maxEnergy) u.energy = Math.max(0, u.energy - (ab.drain || 0));
            u.slow = Math.max(u.slow, ab.slowDur || 0);
            any = true;
          }
          game.fx.push({ abil: 'nova', ax: this.x, ay: this.y, t: 0.5, radius: ab.radius, owner: this.owner });
          return any;
        }
        case 'salvo': {   // 래틀러 헬기 — 로켓 일제사 (범위 폭격)
          let cx = this.x + Math.cos(this.facing) * 90, cy = this.y + Math.sin(this.facing) * 90;
          if (this.foe && !this.foe.dead) { cx = this.foe.x; cy = this.foe.y; }
          let any = false;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(cx, cy, u.x, u.y) <= ab.radius) { this._hit(u, ab.dmg, game); any = true; }
          }
          game.fx.push({ abil: 'salvo', ax: cx, ay: cy, t: 0.4, radius: ab.radius, owner: this.owner });
          return any;
        }
        case 'afterburn': {   // 팰컨 제트 — 애프터버너 (자가 가속)
          this.surge = ab.dur;
          return true;
        }
        // ── ULTIMATES ─────────────────────────────────────────────────────
        case 'barrage': {   // 아이언클래드 워든 — 궤도 폭격
          // Lands on the current foe if there is one, otherwise straight ahead.
          let cx = this.x + Math.cos(this.facing) * 150, cy = this.y + Math.sin(this.facing) * 150;
          if (this.foe && !this.foe.dead) { cx = this.foe.x; cy = this.foe.y; }
          cx = Math.max(0, Math.min(RC.CFG.WORLD_W, cx));
          cy = Math.max(0, Math.min(RC.CFG.WORLD_H, cy));
          let any = false;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(cx, cy, u.x, u.y) > ab.radius) continue;
            this._hit(u, ab.dmg, game);
            u.slow = Math.max(u.slow || 0, ab.stun || 0);   // survivors are left reeling
            any = true;
          }
          for (const b of game.buildings) {
            if (b.dead || !b.done || !game.areEnemies(b.owner, this.owner)) continue;
            if (RC.dist(cx, cy, b.x, b.y) > ab.radius) continue;
            this._hit(b, ab.dmg * 0.6, game);             // buildings take a reduced share
            any = true;
          }
          // The ult always fires — a miss is the player's call, not a refund case.
          game.fx.push({ abil: 'barrage', ax: cx, ay: cy, t: 1.1, radius: ab.radius, owner: this.owner });
          return true;
        }
        case 'swarm': {   // 브루드 매트리아크 — 무리 부화
          const type = ab.spawn || 'globling';
          if (!RC.UNITS[type]) return false;
          const n = Math.max(1, ab.count | 0);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + this.facing;
            const d = (ab.radius || 100) * (0.45 + 0.55 * ((i % 3) / 2));
            const nx = Math.max(20, Math.min(RC.CFG.WORLD_W - 20, this.x + Math.cos(a) * d));
            const ny = Math.max(20, Math.min(RC.CFG.WORLD_H - 20, this.y + Math.sin(a) * d));
            const u = new RC.Unit(type, nx, ny, this.owner);
            u.temp = ab.life || 25;      // hatchlings are free but expire (no supply, no upkeep)
            u.free = true;
            u.summoned = true;           // 렌더러가 임시 유닛임을 표시
            game.units.push(u);
            game.fx.push({ abil: 'warp', ax: nx, ay: ny, t: 0.4, radius: u.r + 8, owner: this.owner });
          }
          game.fx.push({ abil: 'swarm', ax: this.x, ay: this.y, t: 0.9, radius: ab.radius, owner: this.owner });
          return true;
        }
        case 'aegis': {   // 레이디언트 아콘 — 이지스 폭풍
          let hitAny = false;
          for (const u of game.units) {
            if (u.dead) continue;
            const d = RC.dist(this.x, this.y, u.x, u.y);
            if (d > ab.radius) continue;
            if (game.areEnemies(u.owner, this.owner)) {
              this._hit(u, ab.dmg, game);
              // blast them outward from the Archon
              const a = Math.atan2(u.y - this.y, u.x - this.x);
              const push = (1 - d / ab.radius) * 70;
              u.x = Math.max(u.r, Math.min(RC.CFG.WORLD_W - u.r, u.x + Math.cos(a) * push));
              u.y = Math.max(u.r, Math.min(RC.CFG.WORLD_H - u.r, u.y + Math.sin(a) * push));
              hitAny = true;
            } else if (u.owner === this.owner) {
              if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + (ab.heal || 0));
              if (u.maxShield) RC.restoreShield(u, ab.shieldGrant || 0);
            }
          }
          for (const b of game.buildings) {
            if (b.dead || b.owner !== this.owner || !b.done) continue;
            if (RC.dist(this.x, this.y, b.x, b.y) > ab.radius) continue;
            if (b.maxShield) RC.restoreShield(b, ab.shieldGrant || 0);
          }
          void hitAny;   // the ult fires whether or not an enemy was in range
          game.fx.push({ abil: 'aegis', ax: this.x, ay: this.y, t: 1.0, radius: ab.radius, owner: this.owner });
          return true;
        }
        case 'unload': {   // 페리 수송선 — 전원 하차
          if (!this.cargo || !this.cargo.length) return false;
          const list = this.cargo.slice();
          this.cargo.length = 0;
          list.forEach((u, i) => {
            u.boarded = false;
            const a = (i / list.length) * Math.PI * 2;
            u.x = Math.max(u.r, Math.min(RC.CFG.WORLD_W - u.r, this.x + Math.cos(a) * (this.r + 20)));
            u.y = Math.max(u.r, Math.min(RC.CFG.WORLD_H - u.r, this.y + Math.sin(a) * (this.r + 20)));
            u.stop();
            game.units.push(u);
          });
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.35, radius: this.r + 10, owner: this.owner });
          return true;
        }
      }
      return false;
    }

    // AI 영웅 자동 시전 — 습득한 스킬을 상황에 맞게
    _heroAutoCast(game) {
      // 궁극기 — 값이 비싸므로 정말 값어치할 때만 (적이 여럿 몰려 있을 때)
      const ult = this.def.ult;
      if (ult && this.ultReady()) {
        const r = ult.radius || 200;
        let foes = 0;
        for (const u of game.units) {
          if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
          if (RC.dist(this.x, this.y, u.x, u.y) <= r) foes++;
        }
        // 'swarm' is a reinforcement ult — worth using whenever a real fight starts.
        const need = ult.id === 'swarm' ? 2 : 4;
        if (foes >= need) { this.cast(game, ult.key.toLowerCase()); return; }
      }

      const list = this.def.skills || [];
      for (let i = 0; i < list.length; i++) {
        const sk = list[i];
        if (this.heroRank(i) <= 0) continue;
        const key = sk.key.toLowerCase();
        if ((this.skillCd[key] || 0) > 0 || this.energy < sk.cost) continue;
        if (sk.id === 'mend' || sk.id === 'weld') {
          if (this.hp < this.maxHp * 0.6) this.cast(game, key);
        } else if (sk.id === 'warp') {
          // 자동 점멸은 하지 않음
        } else if (this.foe && !this.foe.dead) {
          this.cast(game, key);          // 공격 스킬 — 교전 중일 때
        }
      }
    }

    // AI 유닛 자동 시전 — 상황에 맞을 때만
    _autoCast(dt, game) {
      this._castTry -= dt;
      if (this._castTry > 0) return;
      this._castTry = 0.5;
      if (this.hero) { this._heroAutoCast(game); return; }
      if (!this.canCast(game)) return;
      const id = this.def.ability.id;
      if (id === 'unload') return;                                            // 수송선은 자동 하차 안 함
      const fighting = this.foe && !this.foe.dead;
      if (id === 'mend' || id === 'weld') { this.cast(game); return; }       // 대상 없으면 내부에서 취소됨
      if (id === 'nova' || id === 'bulwark' || id === 'salvo') {              // 적이 여럿 근처일 때
        let near = 0;
        for (const u of game.units) {
          if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
          if (RC.dist(this.x, this.y, u.x, u.y) <= this.def.ability.radius) near++;
        }
        if (near >= 2) this.cast(game);
        return;
      }
      if (fighting) this.cast(game);   // surge / raillock / warp — 교전 중
    }
  }

  RC.ShardNode = ShardNode;
  RC.Building = Building;
  RC.Unit = Unit;
})();
