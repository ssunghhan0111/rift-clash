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
      this.dead = false;
    }

    get done() { return this.buildProgress >= 1; }

    // 건설 진행 — 일꾼이 붙어있는 만큼 빨라짐
    advanceBuild(dt, workers) {
      if (this.done) return;
      const rate = (1 / this.def.time) * (1 + (workers - 1) * 0.5);
      this.buildProgress = Math.min(1, this.buildProgress + rate * dt);
      this.hp = Math.max(this.hp, this.maxHp * (0.1 + 0.9 * this.buildProgress));
      if (this.buildProgress >= 1) this.hp = this.maxHp;
    }

    update(dt, game) {
      // 산성 지속 피해 (건설 중에도 진행)
      if (this.acidStacks > 0) {
        this.acidT -= dt;
        this.damage(this.acidStacks * this.acidDmg * dt);
        if (this.acidT <= 0) this.acidStacks = 0;
      }
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
          game.hurt(this.foe, this.def.dmg, this.owner, this);
          if (this.def.splash) {
            for (const u of game.units) {
              if (u.dead || u === this.foe || !game.areEnemies(u.owner, this.owner)) continue;
              if (!this.def.air && u.def.flying) continue;
              if (RC.dist(fx, fy, u.x, u.y) <= this.def.splash) game.hurt(u, this.def.dmg * 0.5, this.owner, this);
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
        const u = new Unit(job.type, this.x, this.y + this.h / 2 + 24, this.owner);
        // 코어 밖으로 살짝 밀어내기
        u.x += (Math.random() - 0.5) * 40;
        if (game.initUnit) game.initUnit(u);      // 강화 골격 등 스폰 시 패시브 적용
        game.units.push(u);
        u.moveTo(this.rally.x, this.rally.y);
      }
    }

    contains(px, py) {
      return px >= this.x - this.w / 2 && px <= this.x + this.w / 2 &&
             py >= this.y - this.h / 2 && py <= this.y + this.h / 2;
    }

    damage(amount) {
      this.hp -= amount;
      if (this.hp <= 0) { this.hp = 0; this.dead = true; }
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
      this.carry = 0;
      this.gatherTimer = 0;
      this.hitFlash = 0;
      // 산성 중첩 (글룹 피격 시) — 방어 감소 + 지속 피해
      this.acidStacks = 0; this.acidT = 0; this.acidDmg = 0; this.acidShred = 0;

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
      return null;
    }
    _effSkill(sk, rank) {
      const ab = Object.assign({}, sk);
      if (sk.dmgPerRank) ab.dmg = (sk.dmg || 0) + (rank - 1) * sk.dmgPerRank;
      if (sk.healPerRank) ab.heal = (sk.heal || 0) + (rank - 1) * sk.healPerRank;
      if (sk.distPerRank) ab.dist = (sk.dist || 0) + (rank - 1) * sk.distPerRank;
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
      }
      if (this.level >= RC.HERO.maxLevel) this.xp = 0;
    }

    moveTo(x, y) {
      this.state = 'move';
      this.target = { x, y };
      this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = false; this.amoveGoal = null;
    }
    // 공격-이동: 목적지로 진군하되 경로상의 적을 자동 교전하고, 처치 후 계속 이동
    attackMoveTo(x, y) {
      this.state = 'move';
      this.target = { x, y };
      this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = true; this.amoveGoal = { x, y };
    }
    attackTarget(e) {
      this.state = 'attack';
      this.foe = e; this.target = null; this.node = null; this.site = null; this.path = null;
    }
    gatherFrom(node) {
      if (!this.def.worker) return;
      this.state = 'toNode';
      this.node = node; this.foe = null; this.site = null; this.path = null;
    }
    buildAt(b) {
      if (!this.def.worker) return;
      this.state = 'build';
      this.site = b; this.foe = null; this.node = null; this.path = null;
      this.target = { x: b.x, y: b.y };
    }
    stop() {
      this.state = 'idle';
      this.target = null; this.foe = null; this.node = null; this.site = null; this.path = null;
      this.attackMove = false; this.amoveGoal = null;
    }
    boardTarget(ship) {
      if (this.def.flying) return;           // 공중 유닛은 탑승 불가
      this.state = 'toBoard';
      this.transportTarget = ship;
      this.foe = null; this.node = null; this.site = null; this.target = null;
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

    // ── 업그레이드 단계 조회 ──
    _up(game, kind) {
      const u = game && game.upgrades && game.upgrades[this.owner];
      return u ? (u[kind] || 0) : 0;
    }
    // ── 효과가 반영된 실효 스탯 ──
    effAtk(game) {
      let d = this.def.dmg + this._up(game, 'atk') * RC.CFG.UP_ATK_STEP;
      if (this.hero) d += (this.level - 1) * ((this.def.grow && this.def.grow.dmg) || 0);
      if (this.rail > 0 && this.def.ability) d += this.def.ability.dmgBonus || 0;
      if (this.surge > 0) d *= 1.5;
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
      if (this.def.worker || this.def.transport) return;   // 일꾼·수송선은 알아서 싸우지 않음
      const e = game.findNearestEnemy(this, CFG.AGGRO_RANGE);
      if (e) { this.attackTarget(e); return; }
      // 공격-이동: 근처 적이 없으면 목적지로 계속 진군
      if (this.attackMove && this.amoveGoal) {
        if (RC.dist(this.x, this.y, this.amoveGoal.x, this.amoveGoal.y) > 8) this.attackMoveTo(this.amoveGoal.x, this.amoveGoal.y);
        else { this.attackMove = false; this.amoveGoal = null; }
      }
    }

    _move(dt, game) {
      if (!this.target) { this.state = 'idle'; return; }
      // 이동 중에도 적이 가까우면 반응 (일꾼·수송선 제외). 공격-이동이면 더 넓게 감지.
      if (!this.def.worker && !this.def.transport) {
        const range = this.attackMove ? CFG.AGGRO_RANGE : CFG.AGGRO_RANGE * 0.65;
        const e = game.findNearestEnemy(this, range);
        if (e) { this.attackTarget(e); return; }   // attackMove/amoveGoal persist → resumes after the kill
      }
      // 길찾기 — 직선 경로가 막혔을 때만 경유점을 따라간다 (지상 유닛). 공중은 직진.
      let aim = this.target;
      if (!this.def.flying && RC.Path) {
        if (this.path == null) this.path = RC.Path.find(game, this.x, this.y, this.target.x, this.target.y);
        if (this.path && this.path.length) {
          aim = this.path[0];
          if (RC.dist(this.x, this.y, aim.x, aim.y) <= this.r + 8) { this.path.shift(); aim = this.path[0] || this.target; }
        }
      }
      const atGoal = (aim === this.target);
      if (this.step(dt, aim.x, aim.y, 4) && atGoal) this.stop();
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
        this.step(dt, ship.x, ship.y, ship.r + this.r + 4);
      }
    }

    _attack(dt, game) {
      if (!this.foe) {
        const e = game.findNearestEnemy(this, CFG.AGGRO_RANGE);
        if (e) { this.foe = e; } else { this.state = 'idle'; return; }
      }
      const reach = this.effRange(game) + (this.foe.kind === 'building' ? this.foe.r * 0.8 : this.foe.r);
      const d = dist(this.x, this.y, this.foe.x, this.foe.y);
      if (d > reach) {
        this.step(dt, this.foe.x, this.foe.y, reach - 2);
        return;
      }
      this.facing = Math.atan2(this.foe.y - this.y, this.foe.x - this.x);
      if (this.cd <= 0) {
        this.cd = this.effCd(game);
        const foe = this.foe;
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
    }

    // 한 대상에게 피해 적용 (방어력 반영, 반격 유발)
    _hit(foe, dmg, game) {
      const armor = foe.kind === 'unit' ? foe.effArmor(game)
                  : (foe.def && foe.def.armor ? foe.def.armor : 0);
      const dealt = Math.max(1, dmg - armor);
      if (this.def.acid) RC.applyAcid(foe, this.def.acid);   // 글룹 — 산성 중첩
      if (foe.kind === 'unit') {
        foe.hp -= dealt;
        foe.hitFlash = 0.12;
        // 동결 탄자 업그레이드 — 피격 시 둔화
        if (this._up(game, 'frost') > 0) foe.slow = Math.max(foe.slow, RC.CFG.FROST_DUR);
        if (foe.hp <= 0) foe.dead = true;
        else if (foe.state === 'idle' && !foe.def.worker && !foe.def.transport) foe.attackTarget(this);
      } else {
        foe.damage(dealt);
      }
    }

    _toNode(dt, game) {
      if (!this.node) { this.node = game.findNearestNode(this.x, this.y); }
      if (!this.node) { this.state = 'idle'; return; }
      if (this.step(dt, this.node.x, this.node.y, this.node.r + this.r)) {
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
      this.step(dt, drop.x, drop.y, 0);
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
        this.step(dt, this.site.x, this.site.y, 0);
        return;
      }
      this.site.__builders = (this.site.__builders || 0) + 1;
    }

    // ── 스킬 시전 ────────────────────────────────────
    canCast(game, key) {
      if (this.hero) {
        if (this.downed) return false;
        const s = this._skillByKey((key || '').toLowerCase());
        if (!s || this.heroRank(s.idx) <= 0) return false;
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
        const rank = this.heroRank(s.idx);
        const kk = s.sk.key.toLowerCase();
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
            if (RC.dist(this.x, this.y, u.x, u.y) <= ab.radius) u.attackTarget(this);
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
        case 'mend': {   // 패치봇 — 나노 치유 (범위)
          let any = false;
          for (const u of game.units) {
            if (u.dead || u.owner !== this.owner) continue;
            if (u.hp >= u.maxHp) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > ab.radius) continue;
            u.hp = Math.min(u.maxHp, u.hp + ab.heal);
            any = true;
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
