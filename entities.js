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

  // ── 상태이상 / Passive statuses ─────────────────────────────────────────
  // Every unit passive that touches an enemy lands as one of four statuses. They share
  // one rule: a fresh hit REFRESHES the timer and adds at most one stack, so a stream of
  // fire keeps a status topped up but can never run away with it. Acid above is the
  // fifth and oldest of these; shred is deliberately the same currency, so a Gloop army
  // and a Chaingunner stack into each other instead of each doing their own thing.
  //
  // Buildings can be venomed and shredded (a siege should still rot a wall) but never
  // chilled or frozen — there is nothing to slow down, and a frozen building would read
  // as broken rather than as controlled.
  function applyChill(foe, p) {
    if (!p || !foe || foe.dead || foe.kind !== 'unit') return;
    foe.slow = Math.max(foe.slow || 0, p.slow || 1.5);
    foe.chillStk = (foe.chillStk || 0) + 1;
    foe.chillT = p.slow || 1.5;
    // Full stacks cash themselves in for a freeze and reset — so chill is a countdown
    // the enemy can watch, not a slow that silently becomes a stun.
    if (foe.chillStk >= (p.max || 4)) {
      foe.chillStk = 0; foe.chillT = 0;
      foe.frozen = Math.max(foe.frozen || 0, p.freeze || 1);
      foe.freezeFx = 0.3;
    }
  }
  function applyVenom(foe, p) {
    if (!p || !foe || foe.dead) return;
    foe.venomStk = Math.min(p.max || 4, (foe.venomStk || 0) + 1);
    foe.venomT = p.dur || 4;
    foe.venomDmg = p.dmg || 4;
    foe.venomFire = !!p.fire;          // burn vs venom — identical maths, different colour
  }
  function applyShred(foe, p) {
    if (!p || !foe || foe.dead) return;
    foe.shredStk = Math.min(p.max || 5, (foe.shredStk || 0) + 1);
    foe.shredT = p.dur || 4;
    foe.shredAmt = p.amt || 1;
  }
  function applyMark(foe, p) {
    if (!p || !foe || foe.dead) return;
    foe.markT = Math.max(foe.markT || 0, p.dur || 4);
    foe.markAmp = Math.max(foe.markAmp || 0, p.amp || 0.2);
  }
  RC.applyChill = applyChill;
  RC.applyVenom = applyVenom;
  RC.applyShred = applyShred;
  RC.applyMark = applyMark;

  // 방어 상태 초기화 — 유닛과 건물이 같은 필드를 쓰기 때문에 한 곳에서 만든다.
  function initStatus(e) {
    e.acidStacks = 0; e.acidT = 0; e.acidDmg = 0; e.acidShred = 0;
    e.venomStk = 0; e.venomT = 0; e.venomDmg = 0; e.venomFire = false;
    e.shredStk = 0; e.shredT = 0; e.shredAmt = 0;
    e.chillStk = 0; e.chillT = 0; e.frozen = 0; e.freezeFx = 0;
    e.markT = 0; e.markAmp = 0;
    e.auraArmor = 0; e.auraArmorT = 0;
  }
  RC.initStatus = initStatus;

  // 서로를 살려내는 고리 차단 / The healer-on-healer rule.
  //
  // A healing aura that heals other healing auras is a closed loop: nine Patch Bots keep
  // each other topped up faster than an early wave can kill any one of them, so they
  // never die, they fill the population cap, and the army never turns over into anything
  // that deals damage. A Crystal Guard run that used to reach wave 11 stalled out at 7
  // holding a pile of immortal medics. So healers mend the ARMY, never each other — one
  // rule, stated once, rather than a heal number tuned down until the loop is merely slow.
  const HEAL_AURA = { mender: 1, bloom: 1 };
  function isHealer(e) { return !!(e && e.def && e.def.passive && HEAL_AURA[e.def.passive.id]); }

  // 상태이상 감쇠 + 지속 피해. 반환값은 이번 틱에 입은 지속 피해량.
  // Units and buildings both call this, which is the only reason venom works on a wall.
  function tickStatus(e, dt) {
    let dot = 0;
    if (e.acidStacks > 0) {
      e.acidT = Math.max(0, e.acidT - dt);
      dot += e.acidStacks * e.acidDmg * dt;
      if (!e.acidT) { e.acidStacks = 0; e.acidDmg = 0; e.acidShred = 0; }
    }
    if (e.venomStk > 0) {
      e.venomT = Math.max(0, e.venomT - dt);
      dot += e.venomStk * e.venomDmg * dt;
      if (!e.venomT) { e.venomStk = 0; e.venomDmg = 0; }
    }
    if (e.shredT > 0) { e.shredT = Math.max(0, e.shredT - dt); if (!e.shredT) { e.shredStk = 0; e.shredAmt = 0; } }
    if (e.markT > 0)  { e.markT  = Math.max(0, e.markT  - dt); if (!e.markT)  e.markAmp = 0; }
    if (e.chillT > 0) { e.chillT = Math.max(0, e.chillT - dt); if (!e.chillT) e.chillStk = 0; }
    if (e.frozen > 0) e.frozen = Math.max(0, e.frozen - dt);
    if (e.freezeFx > 0) e.freezeFx = Math.max(0, e.freezeFx - dt);
    if (e.auraArmorT > 0) { e.auraArmorT -= dt; if (e.auraArmorT <= 0) e.auraArmor = 0; }
    return dot;
  }
  RC.tickStatus = tickStatus;

  // ── 플라즈마 실드 (Aether) ────────────────────────────
  // Single choke point for post-armor damage so units, buildings, towers and
  // splash all obey the same rule: shields soak first, HP takes the remainder.
  // Any hit resets the recharge delay, so shields only regrow out of combat.
  function dealDamage(foe, dealt) {
    if (!foe || dealt <= 0) return 0;
    // ── Guard (the Warden's dome) ──
    // A temporary pool that sits IN FRONT of shields and hp and works on units and
    // buildings alike, which is what lets one ability cover the crystal and, upgraded,
    // everything standing near it. Hooked here because every damage path in the game —
    // unit attacks, towers, death bursts, abilities — funnels through this function.
    if (foe.guard && foe.guard.hp > 0) {
      const g = Math.min(foe.guard.hp, dealt);
      foe.guard.hp -= g;
      dealt -= g;
      foe.guard.fx = 0.2;                     // renderer flashes the dome where it was hit
      if (dealt <= 0) return 0;
    }
    // Taking a hit charges a hero's signature. Tanking is participation too, and without
    // this the only way to fill the meter would be to deal damage — which punishes the
    // defensive hero for playing defensively.
    if (foe.hero && foe.charge != null && foe.charge < 1) {
      foe.charge = Math.min(1, foe.charge + dealt * RC.HERO.chargeTaken);
    }
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

  // Guard countdown. Returns true on the tick it expires, so the caller can fire the
  // Shatter upgrade — the dome has to know when it ENDED, not merely that it is gone.
  function tickGuard(e, dt) {
    if (!e.guard) return false;
    if (e.guard.fx > 0) e.guard.fx = Math.max(0, e.guard.fx - dt);
    e.guard.t -= dt;
    if (e.guard.t > 0 && e.guard.hp > 0) return false;
    e.guard = null;
    return true;
  }
  RC.tickGuard = tickGuard;

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
      RC.initStatus(this);                       // 산성/맹독/장갑파쇄/표식 (유닛과 동일)
      // 플라즈마 실드 (Aether) — 건설이 끝나야 완충된다
      this.maxShield = d.shield || 0;
      this.shield = prebuilt ? this.maxShield : 0;
      this.shieldT = 0; this.shieldFx = 0;
      this.hitFlash = 0;        // 피격 섬광 (연출 전용)
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
      if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);   // 피격 섬광 감쇠
      // The Warden's dome sits on a building far more often than on a unit, so the
      // Shatter detonation lives here. tickGuard reports the tick it ENDS on, which is
      // the only moment the explosion can fire — a guard that is merely absent tells us
      // nothing about whether it expired or was never cast.
      if (this.guard) {
        const g = this.guard;
        if (RC.tickGuard(this, dt) && g.shatterDmg) {
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, g.owner)) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > (g.radius || 300)) continue;
            game.hurt(u, g.shatterDmg, g.owner, this);
            u.slow = Math.max(u.slow || 0, g.shatterSlow || 0);
          }
          game.fx.push({ abil: 'dome', ax: this.x, ay: this.y, t: 0.7, radius: g.radius || 300, owner: g.owner });
          if (game.shake) game.shake(0.4);
        }
      }
      // 산성 지속 피해 (건설 중에도 진행)
      const dot = RC.tickStatus(this, dt);
      if (dot > 0) this.damage(dot);
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
      this.curSpeed = d.speed;
      // ── 버프 타이머 (초) ──
      // `haste` is any move/fire-rate boost (the Hoverwing's Strafe Run passive today,
      // and anything a hero grants later). Generic on purpose: the source no longer has
      // to be a def.ability that the stat getters can read the numbers back out of.
      this.haste = 0; this.hasteSpd = 1; this.hasteFire = 1;
      this.slow = 0;       // 둔화 — 냉기/충격 계열 피격
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
      // 공격/피격 연출 타이머 — 순수 그리기용. 1에서 0으로 감쇠하며 sim/동기화엔 영향 없다.
      // atkAnim: 공격하는 순간의 돌진(근접)/반동(원거리) 모션.
      // hurt: 맞은 순간 뒤로 밀리는 반응. hurtDir는 공격자→피격자 방향(밀려나는 쪽).
      this.atkAnim = 0; this.hurt = 0; this.hurtDir = 0;
      // 상태이상 — 산성/맹독/장갑파쇄/냉기·동결/표식 (RC.initStatus 참조)
      RC.initStatus(this);
      this._auraT = 0;                       // 오라 패시브 갱신 주기
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
        this.skillCd = {};        // retained for the wire format; heroes now charge instead
        this.charge = 0;          // 0..1 signature charge — fills by FIGHTING (see RC.HERO)
        this.sigCd = 0;           // brief lockout after a cast so a double-tap cannot double-fire
        this.sigUp = {};          // upgrade id -> true (Crystal Guard cards; levels elsewhere)
        this.downed = false;      // slain, waiting to revive (kept in play, inert)
        this.reviveT = 0;
        this.reviveCost = 0;
      }
    }

    // ── 영웅: 레벨 / 시그니처 헬퍼 ─────────────────────
    // heroRank / _skillByKey / _effSkill / _effUlt used to live here. They served the
    // three-skills-plus-an-ultimate panel, which the signature ability replaced: one
    // ability per hero, charged by fighting, with three upgrades unique to that hero.
    xpToNext() { return RC.HERO.xpBase + (this.level - 1) * RC.HERO.xpStep; }

    // Outside Crystal Guard there are no reward cards to pick upgrades from, so the three
    // unlock at levels instead. Same three upgrades either way; only the route differs,
    // and this is the single place that knows that.
    hasUp(id) {
      const sig = this.def.sig;
      if (!sig || !sig.ups) return false;
      if (this.sigUp && this.sigUp[id]) return true;
      if (this._cardUps) return false;              // Crystal Guard: cards are the only route
      const i = sig.ups.findIndex(u => u.id === id);
      if (i < 0) return false;
      const lv = (RC.HERO.upLevels || [])[i];
      return lv != null && this.level >= lv;
    }
    // Crystal Guard hands upgrades out as cards, so it turns the level route OFF —
    // otherwise a hero would collect the same upgrade twice through two different doors.
    useCardUpgrades() { this._cardUps = true; }
    grantUp(id) { if (this.sigUp) this.sigUp[id] = true; }
    sigReady() { return !!(this.hero && this.def.sig && !this.downed && this.sigCd <= 0 && this.charge >= 1); }

    // Q/E after level scaling. Deliberately much simpler than effSig: the tactical two
    // carry no upgrades, so "the numbers grow with level" is the whole of it.
    effSkill(sk) {
      if (!sk) return null;
      if (sk.ult) return this.effSig();
      const a = Object.assign({}, sk);
      const lv = this.level - 1;
      if (sk.dmgPerLevel)    a.dmg    = (sk.dmg || 0) + sk.dmgPerLevel * lv;
      if (sk.shieldPerLevel) a.shield = (sk.shield || 0) + sk.shieldPerLevel * lv;
      return a;
    }

    // The signature's numbers after level scaling and whichever upgrades are held.
    effSig() {
      const sig = this.def.sig;
      if (!sig) return null;
      const a = Object.assign({}, sig);
      const lv = this.level - 1;
      if (sig.shieldPerLevel) a.shield = sig.shield + sig.shieldPerLevel * lv;
      if (sig.dmgPerLevel)    a.dmg    = sig.dmg + sig.dmgPerLevel * lv;
      if (sig.countPerLevel)  a.count  = Math.min(sig.maxCount || 99, sig.count + sig.countPerLevel * lv);
      // Upgrades carry uniquely-named fields (durAdd, countAdd, radiusMul, ...), so this
      // merge never has to know WHICH upgrade it holds. Add one to config.js with a new
      // field name and it lands here without touching this code.
      a.held = {};
      for (const up of (sig.ups || [])) {
        if (!this.hasUp(up.id)) continue;
        a.held[up.id] = true;
        if (up.durAdd)    a.dur    = (a.dur || 0) + up.durAdd;
        if (up.countAdd)  a.count  = (a.count || 0) + up.countAdd;
        if (up.radiusMul) a.radius = (a.radius || 0) * up.radiusMul;
        if (up.dmgMul)    a.dmg    = (a.dmg || 0) * up.dmgMul;
        if (up.slowSet)   a.slowDur = Math.max(a.slowDur || 0, up.slowSet);
        if (up.healAdd)   a.heal   = (a.heal || 0) + up.healAdd;
        if (up.shieldAdd) a.shieldGrant = (a.shieldGrant || 0) + up.shieldAdd;
        if (up.allyShare) a.allyShare = up.allyShare;
        if (up.shatterDmg) { a.shatterDmg = up.shatterDmg; a.shatterSlow = up.shatterSlow || 0; }
        if (up.burstDmg)   { a.burstDmg = up.burstDmg; a.burstRadius = up.burstRadius || 90; }
        if (up.hatchSpd)  a.hatchSpd = up.hatchSpd;
        if (up.hatchDmg)  a.hatchDmg = up.hatchDmg;
      }
      return a;
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
      if (this.dmgMul) d *= this.dmgMul;                            // 소환 강화 (Angry Brood 등)
      const t = this.terr(game);                                   // 고지대 = 화력 우위
      if (t && t.high) d *= (RC.CFG.TERRAIN.high.atk || 1);
      return d;
    }
    effArmor(game) {
      let a = (this.def.armor || 0) + this._up(game, 'arm') * RC.CFG.UP_ARM_STEP;
      if (this.hero) a += (this.level - 1) * ((this.def.grow && this.def.grow.armor) || 0);
      if (this.auraArmorT > 0) a += this.auraArmor || 0;                // 실드러/드롭십 오라
      if (this.acidStacks > 0) a -= this.acidStacks * this.acidShred;   // 산성 = 갑옷 부식
      if (this.shredStk > 0) a -= this.shredStk * this.shredAmt;        // 장갑 파쇄 (같은 화폐)
      return Math.max(0, a);
    }
    effRange(game) {
      let r = this.def.range;
      const t = this.terr(game);                                   // 고지대 = 사거리 우위
      if (t && t.high) r *= (RC.CFG.TERRAIN.high.range || 1);
      else if (t && t.low) r *= (RC.CFG.TERRAIN.low.range || 1);   // 저지대 = 사거리 손해
      return r;
    }
    effSplash(game) {
      return this.def.splash || 0;
    }
    effCd(game) {
      let c = this.def.cd;
      if (this.haste > 0) c *= this.hasteFire || 1;
      if (this.slow > 0) c *= 1.5;
      c /= (1 + this._up(game, 'spd') * RC.CFG.UP_SPD_ATK);   // 기동 강화 = 공속↑
      return c;
    }
    effSpeed(game) {
      let s = this.speed;
      if (this.frozen > 0) return 0;                           // 동결 — 완전 정지
      if (this.haste > 0) s *= this.hasteSpd || 1;
      if (this.slow > 0) s *= 0.5;
      s *= (1 + this._up(game, 'spd') * RC.CFG.UP_SPD_MOVE);  // 기동 강화 = 이속↑
      const t = this.terr(game);                               // 늪 = 진창에 발이 묶인다
      if (t && t.mud) s *= (RC.CFG.TERRAIN.mud.speed || 1);
      if (this.speedMul) s *= this.speedMul;                   // 데일리 챌린지 변형 (스프린터 등)
      // 행성 중력 + 날씨 — 순수하게 game.time과 맵 id에서 나오므로 서버/클라 동일.
      // Ceres scoots, Jupiter crawls, and a blizzard slows everyone equally.
      if (RC.Weather) s *= RC.Weather.speedMul(game, this.def.flying);
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
      // 연출 감쇠 — atkAnim은 0.22초, hurt는 0.18초에 걸쳐 1→0
      if (this.atkAnim > 0) this.atkAnim = Math.max(0, this.atkAnim - dt / 0.22);
      if (this.hurt > 0)    this.hurt    = Math.max(0, this.hurt    - dt / 0.18);
      if (this.hero) {
        this.sigCd = Math.max(0, this.sigCd - dt);
        for (const k in this.skillCd) if (this.skillCd[k] > 0) this.skillCd[k] = Math.max(0, this.skillCd[k] - dt);
        // The idle trickle. Everything else about the charge rewards fighting; this is
        // the floor that stops a player who is losing badly — few units, little damage —
        // from being locked out of the one button that could turn it around.
        if (this.charge < 1) this.charge = Math.min(1, this.charge + (RC.HERO.chargeIdle || 0) * dt);
      }
      // A unit's guard just runs out — only the dome's host building shatters (see
      // Building.update), because that is the one the ability was actually aimed at.
      if (this.guard) RC.tickGuard(this, dt);
      this.castFx = Math.max(0, this.castFx - dt);
      this.critFx = Math.max(0, this.critFx - dt);
      this.haste = Math.max(0, this.haste - dt);
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

      // 글룹 — 타고난 재생 (전투 중엔 절반). 독에 타 죽는 중이면 멈춤
      if (this.def.regen && this.hp < this.maxHp && this.acidStacks <= 0 && this.venomStk <= 0) {
        const inCombat = this.state === 'attack' || !!this.foe;
        this.hp = Math.min(this.maxHp, this.hp + this.def.regen * (inCombat ? 0.5 : 1) * dt);
      }

      // 상태이상 감쇠 + 지속 피해 (산성 / 맹독·화상)
      const dot = RC.tickStatus(this, dt);
      if (dot > 0) {
        this.hp -= dot;
        if (this.hp <= 0) { this.hp = 0; this.dead = true; }
      }

      // 아우라 패시브 — 초당 4회만 갱신한다. 매 프레임 전군을 훑으면 큰 교전에서
      // 이것 하나가 프레임을 잡아먹고, 0.25초 해상도로도 눈에는 똑같이 보인다.
      if (this.def.passive) {
        this._auraT -= dt;
        if (this._auraT <= 0) { const step = 0.25; this._auraT = step; this._passiveAura(step, game); }
      }

      this.curSpeed = this.effSpeed(game);

      // AI 영웅 자동 시전 — 유닛은 더 이상 시전할 것이 없다 (전부 패시브)
      if (this.def.hero && game.isAI && game.isAI(this.owner)) this._autoCast(dt, game);

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
      if (this.navigate(dt, game, this.target.x, this.target.y, 4)) {
        // 수송선 — 목적지에 닿으면 알아서 내린다. Unload used to be the one unit ability
        // you actually had to press, which made it the one unit ability people forgot.
        // "Go there" already means "go there and let them out"; there is no other reason
        // to send a loaded dropship somewhere.
        if (this.cargo && this.cargo.length) this._applyAbility(game, { id: 'unload' });
        this.stop();
      }
    }

    // 이동 중 응사 — 명령을 바꾸지 않고, 사거리 안에 있고 쿨타임이 찼을 때만 한 발.
    _returnFire(game) {
      if (this.cd > 0 || this.frozen > 0) return;
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
      if (this.cd <= 0 && this.frozen <= 0) this._fireAt(this.foe, game);   // 동결 중엔 못 쏜다
    }

    // 한 발 발사 — 사거리/방향 판정은 호출한 쪽 책임. _attack과 이동 중 응사가 공유한다.
    _fireAt(foe, game) {
      if (!foe || foe.dead) return;
      this.cd = this.effCd(game);
      this.atkAnim = 1;                        // 공격 모션 트리거 (근접=돌진 / 원거리=반동)
      this.facing = Math.atan2(foe.y - this.y, foe.x - this.x);
      let dmg = this.effAtk(game);
      const pas = this.def.passive;
      // 마무리 일격 (Falcon Jet) — 이미 다친 대상에게 훨씬 크게 들어간다. 방어력 계산
      // 전에 곱해야 장갑 높은 적에게도 "끝내주는" 느낌이 남는다.
      if (pas && pas.id === 'execute' && foe.maxHp && foe.hp / foe.maxHp <= (pas.below || 0.35)) {
        dmg *= pas.mul || 1.8;
      }
      // 공성 (Bastion) — 건물에 대한 추가 피해
      if (pas && pas.siege && foe.kind === 'building') dmg *= pas.siege;
      // 치명 타격 업그레이드 — 확률적 2배
      const critLvl = this._up(game, 'crit');
      let crit = false;
      // 고유 치명 (Bladesworn) — 업그레이드와 별개로 굴린다. 둘 다 터져도 배수는 한 번만
      // 적용된다: 두 배의 두 배는 암살자가 아니라 사고다.
      if (pas && pas.id === 'crit' && Math.random() < (pas.chance || 0.3)) {
        dmg *= pas.mul || 2; crit = true; this.critFx = 0.25;
        if (RC.Audio) RC.Audio.play('crit');
      } else if (critLvl > 0 && Math.random() < critLvl * RC.CFG.UP_CRIT_CHANCE) {
        dmg *= RC.CFG.UP_CRIT_MULT; crit = true; this.critFx = 0.25;
        if (RC.Audio) RC.Audio.play('crit');
        // A small screen "punch" on YOUR own crits — throttled so a crit-stacked
        // army doesn't shake the camera to pieces.
        if (game.playerOwner === this.owner) {
          if (!game._lastCritShake || game.time - game._lastCritShake > 0.35) {
            game.shake(0.12); game._lastCritShake = game.time;
          }
        }
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
      // 스트레이프 (Hoverwing) — 쏜 직후 가속. 치고 빠지는 기체라 발사가 곧 이탈이다.
      if (pas && pas.id === 'swift') {
        this.haste = pas.dur || 1.8; this.hasteSpd = pas.mul || 1.35; this.hasteFire = 1;
      }
      if (game.marks && (crit || this.hero)) game.marks.push({ dmg: Math.round(dmg), x: foe.x, y: foe.y - (foe.r || 10) - 4, crit: crit, t: 0.8 });
      if (this.foe && this.foe.dead) this.foe = null;
    }

    // 한 대상에게 피해 적용 (방어력 반영, 반격 유발)
    _hit(foe, dmg, game) {
      // Damage is applied in TWO places — here for unit attacks, and game.hurt() for
      // towers and death bursts — so the under-attack alert has to be raised from both
      // or it would miss the majority of the game. See game._maybeAlert.
      if (game._maybeAlert && !foe.dead) game._maybeAlert(foe, this.owner);
      // 건물도 산성/파쇄로 장갑이 깎인다 — 유닛만 깎이면 공성에서 두 상태이상이 사라진다.
      const armor = foe.kind === 'unit' ? foe.effArmor(game)
                  : Math.max(0, ((foe.def && foe.def.armor) || 0)
                               - (foe.acidStacks || 0) * (foe.acidShred || 0)
                               - (foe.shredStk || 0) * (foe.shredAmt || 0));
      const cover = game.coverMul ? game.coverMul(foe) : 1;   // 숲에 숨은 대상은 덜 아프다
      // 표식 — 표식을 찍은 유닛만이 아니라 모두가 더 아프게 때린다. 그래서 Spark Cannon
      // 한 기가 군대 전체의 화력을 올리는 유닛이 된다.
      const amp = (foe.markT > 0) ? (1 + (foe.markAmp || 0)) : 1;
      const dealt = Math.max(1, (dmg - armor) * cover * amp);
      // Dealing damage charges the signature, and a kill is worth a visible jump — the
      // meter should move when the player can see why it moved.
      if (this.hero && this.charge != null && this.charge < 1) {
        const wasAlive = !foe.dead;
        this.charge = Math.min(1, this.charge + dealt * RC.HERO.chargeDealt);
        if (wasAlive && foe.hp - dealt <= 0) this.charge = Math.min(1, this.charge + (RC.HERO.chargeKill || 0));
      }
      if (this.def.acid) RC.applyAcid(foe, this.def.acid);   // 글룹 — 산성 중첩
      this._passiveHit(foe, dealt, game);                    // 고유 패시브 (냉기/맹독/파쇄/…)
      // 가시 껍질 — 방어자의 패시브다. _hit을 되부르지 않고 직접 피해를 넣는 것은
      // 서로 가시를 가진 두 유닛이 무한히 되받아치는 것을 막기 위해서다.
      const fp = foe.def && foe.def.passive;
      const thorn = fp && (fp.id === 'thorns' ? fp.pct : fp.thorns);
      if (thorn && this.kind === 'unit' && !this.dead && RC.dist(this.x, this.y, foe.x, foe.y) < 220) {
        RC.dealDamage(this, dealt * thorn);
        this.hitFlash = 0.1;
        if (this.hp <= 0) { this.hp = 0; this.dead = true; }
      }
      if (foe.kind === 'unit') {
        RC.dealDamage(foe, dealt);                            // 실드 우선 흡수
        foe.hitFlash = 0.12;
        foe.hurt = 1;                                         // 피격 반응 — 뒤로 움찔
        foe.hurtDir = Math.atan2(foe.y - this.y, foe.x - this.x);
        // 동결 탄자 업그레이드 — 피격 시 둔화
        if (this._up(game, 'frost') > 0) foe.slow = Math.max(foe.slow, RC.CFG.FROST_DUR);
        // 반격 — 가만히 서 있다가 맞았으면 되받아친다. 일꾼도 마찬가지지만,
        // 채집·건설 중(state가 idle이 아님)이면 하던 일을 계속한다.
        if (!foe.dead && foe.state === 'idle' && foe.canFight && foe.canFight()) foe.engage(this);
      } else {
        foe.damage(dealt);
        foe.hitFlash = 0.09;                                  // 건물 피격 섬광
      }
    }

    // ── 고유 패시브 ─────────────────────────────────────────────────────
    // Two entry points and that is the whole system: _passiveHit runs on every landed
    // attack, _passiveAura runs four times a second on units whose passive is a presence
    // rather than an event. Anything a unit does beyond attacking goes through one of
    // these — there is no third path and no button.
    _passiveHit(foe, dealt, game) {
      const p = this.def.passive;
      if (!p || !foe || foe.dead) return;
      switch (p.id) {
        case 'chill': RC.applyChill(foe, p); break;
        case 'venom': RC.applyVenom(foe, p); break;
        // Burn is venom with a different colour. Keeping it a separate id costs one line
        // here and buys a Rattler that reads as incendiary instead of as a snake.
        case 'burn':  RC.applyVenom(foe, { dmg: p.dmg, dur: p.dur, max: p.max, fire: true }); break;
        case 'shred': RC.applyShred(foe, p); break;
        case 'mark':  RC.applyMark(foe, p); break;
        case 'lifesteal': {
          // 건물에서는 못 빤다. You cannot drink from a wall, and more to the point a
          // swarm that heals off whatever it is chewing becomes unkillable exactly when
          // it is chewing the thing you need it to stop chewing: one Globling on the Rift
          // Crystal out-healed a Volt Trooper shooting it, forever.
          if (foe.kind !== 'unit') break;
          const gain = dealt * (p.pct || 0.3);
          if (p.toShield && this.maxShield && this.shield < this.maxShield) RC.restoreShield(this, gain);
          else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + gain);
          break;
        }
        case 'knock': {
          if (foe.kind !== 'unit' || foe.def.flying) break;
          const a = Math.atan2(foe.y - this.y, foe.x - this.x);
          const d = p.dist || 24;
          foe.x = Math.max(foe.r, Math.min(RC.CFG.WORLD_W - foe.r, foe.x + Math.cos(a) * d));
          foe.y = Math.max(foe.r, Math.min(RC.CFG.WORLD_H - foe.r, foe.y + Math.sin(a) * d));
          break;
        }
        // Chain and cleave re-enter _hit, so they are fenced behind _arc. Without it a
        // chain would arc off its own arc and one Volt Trooper would clear a map.
        case 'chain': {
          if (this._arc || foe.kind !== 'unit') break;
          this._arc = true;
          let jumps = p.jumps || 1;
          let from = foe;
          const struck = new Set([foe.id]);
          while (jumps-- > 0) {
            let best = null, bd = p.range || 90;
            for (const u of game.units) {
              if (u.dead || struck.has(u.id) || !game.areEnemies(u.owner, this.owner)) continue;
              const d = RC.dist(from.x, from.y, u.x, u.y);
              if (d < bd) { bd = d; best = u; }
            }
            if (!best) break;
            struck.add(best.id);
            game.fx.push({ x: from.x, y: from.y, tx: best.x, ty: best.y, t: 0.12, owner: this.owner, arc: true });
            this._hit(best, dealt * (p.pct || 0.4), game);
            from = best;
          }
          this._arc = false;
          break;
        }
        case 'cleave': {
          if (this._arc) break;
          this._arc = true;
          for (const u of game.units) {
            if (u === foe || u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(foe.x, foe.y, u.x, u.y) > (p.radius || 60)) continue;
            this._hit(u, dealt * (p.pct || 0.5), game);
          }
          this._arc = false;
          break;
        }
      }
    }

    _passiveAura(dt, game) {
      const p = this.def.passive;
      if (!p) return;
      const R = p.radius || 0;
      switch (p.id) {
        // Field Repair — the old Emergency Weld, minus the button. It still reaches
        // BUILDINGS, which is the whole reason a worker was worth selecting in a siege.
        case 'mender': {
          const want = p.targets || 1;
          const pool = [];
          const scan = (e) => {
            if (e.dead || e === this || e.owner !== this.owner) return;
            if (isHealer(e)) return;                       // 힐러끼리는 못 살린다 — HEAL_AURA 참조
            if (RC.dist(this.x, this.y, e.x, e.y) > R) return;
            const missing = (e.maxHp - e.hp) + (p.shield && e.maxShield ? (e.maxShield - e.shield) : 0);
            if (missing > 0) pool.push({ e, missing });
          };
          game.units.forEach(scan);
          game.buildings.forEach(b => { if (b.done) scan(b); });
          if (!pool.length) return;
          pool.sort((a, b) => b.missing - a.missing);
          for (let i = 0; i < Math.min(want, pool.length); i++) {
            const e = pool[i].e;
            if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + (p.hps || 6) * dt);
            if (p.shield && e.maxShield) RC.restoreShield(e, p.shield * dt);
            // Deterministic, NOT Math.random(). Cosmetics must never draw from the RNG:
            // the sim is seeded and shared, so one stray roll here silently reshuffles
            // crits, wave composition and every other random decision downstream.
            if (Math.floor(game.time * 4) % 3 === 0) {
              game.fx.push({ abil: 'heal', ax: e.x, ay: e.y, t: 0.3, radius: (e.r || 14) + 4, owner: this.owner });
            }
          }
          return;
        }
        case 'bloom': {
          for (const u of game.units) {
            if (u.dead || u.owner !== this.owner || u.hp >= u.maxHp) continue;
            if (isHealer(u)) continue;                     // 힐러끼리는 못 살린다
            if (RC.dist(this.x, this.y, u.x, u.y) > R) continue;
            u.hp = Math.min(u.maxHp, u.hp + (p.hps || 4) * dt);
          }
          return;
        }
        case 'shieldaura': {
          for (const u of game.units) {
            if (u.dead || u.owner !== this.owner || !u.maxShield || u.shield >= u.maxShield) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > R) continue;
            RC.restoreShield(u, (p.sps || 12) * dt);
          }
          return;
        }
        // Armour auras write a SHORT-LIVED field rather than a permanent one, so the buff
        // falls off on its own the moment the source dies or walks away. Nothing has to
        // remember to remove it.
        case 'guardaura':
        case 'ferry': {
          if (p.cargoHeal && this.cargo) {
            for (const u of this.cargo) { if (u && !u.dead && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + p.cargoHeal * dt); }
          }
          if (!p.armor) return;
          for (const u of game.units) {
            if (u.dead || u === this || u.owner !== this.owner) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > R) continue;
            u.auraArmor = Math.max(u.auraArmor || 0, p.armor);
            u.auraArmorT = 0.35;                 // 갱신 주기(0.25s)보다 살짝 길게
          }
          return;
        }
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
    // Only heroes cast. Every other unit's ability is a passive (see _passiveHit /
    // _passiveAura), so canCast on a Volt Trooper is false and always will be — the
    // HUD, the hotkeys and the AI all read this one answer.
    skills() { return this.def.skills || (this.def.sig ? [this.def.sig] : []); }

    skillByKey(key) {
      if (!this.hero) return null;
      const list = this.skills();
      if (!key) return null;
      const k = String(key).toLowerCase();
      return list.find(s => (s.key || '').toLowerCase() === k) || null;
    }

    // The ultimate answers to the charge meter; Q and E answer to energy and a cooldown.
    // Two currencies on purpose: the cheap buttons should be pressed constantly, and the
    // expensive one should be the thing you are saving for.
    skillReady(sk) {
      if (!sk || !this.hero || this.downed) return false;
      if (sk.ult) return this.sigCd <= 0 && this.charge >= 1;
      return (this.skillCd[sk.id] || 0) <= 0 && this.energy >= (sk.cost || 0);
    }

    canCast(game, key) {
      if (!this.hero) return false;
      if (key) return this.skillReady(this.skillByKey(key));
      return this.skills().some(s => this.skillReady(s));
    }

    cast(game, key) {
      if (!this.hero) return false;
      // No key means "the signature" — the kid button and the AI both call it that way.
      const sk = this.skillByKey(key) || (key ? null : this.def.sig);
      if (!sk || !this.skillReady(sk)) return false;
      const ab = sk.ult ? this.effSig() : this.effSkill(sk);
      if (!ab || !this._applyAbility(game, ab)) return false;
      if (sk.ult) {
        // Charge is spent whether or not it killed anything. A refund on a "bad" cast
        // would quietly teach the player to only ever fire it at a perfect moment, which
        // is the opposite of the decision this ability is for.
        this.charge = 0;
        this.sigCd = RC.HERO.sigCd || 1.5;
        this.castFx = 0.9;
      } else {
        this.energy -= sk.cost || 0;
        this.skillCd[sk.id] = sk.cd || 0;
        this.castFx = 0.5;
      }
      game.shake(ab.shake || 0.4);
      game.notify(this.def.name + ' — ' + ab.name + '!');
      return true;
    }

    _applyAbility(game, ab) {
      switch (ab.id) {
        // ── Q: Ground Slam (Ironclad Warden) ──
        // A gap-closer that ends in a freeze. The Warden's whole answer is "hold on", and
        // the thing it lacked was any way to REACH the fight it was supposed to hold.
        case 'slam': {
          let tx = this.x + Math.cos(this.facing) * (ab.dist || 190);
          let ty = this.y + Math.sin(this.facing) * (ab.dist || 190);
          if (this.foe && !this.foe.dead) {
            const a = Math.atan2(this.foe.y - this.y, this.foe.x - this.x);
            const reach = Math.min(RC.dist(this.x, this.y, this.foe.x, this.foe.y), ab.dist || 190);
            tx = this.x + Math.cos(a) * reach; ty = this.y + Math.sin(a) * reach;
          }
          tx = Math.max(this.r, Math.min(RC.CFG.WORLD_W - this.r, tx));
          ty = Math.max(this.r, Math.min(RC.CFG.WORLD_H - this.r, ty));
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.3, radius: this.r, owner: this.owner });
          this.x = tx; this.y = ty;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(tx, ty, u.x, u.y) > (ab.radius || 150)) continue;
            this._hit(u, ab.dmg || 55, game);
            u.frozen = Math.max(u.frozen || 0, ab.freeze || 1.1);
            u.freezeFx = 0.3;
          }
          for (const b of game.buildings) {
            if (b.dead || !b.done || !game.areEnemies(b.owner, this.owner)) continue;
            if (RC.dist(tx, ty, b.x, b.y) > (ab.radius || 150) + b.r) continue;
            this._hit(b, (ab.dmg || 55) * 0.6, game);
          }
          game.fx.push({ abil: 'salvo', ax: tx, ay: ty, t: 0.45, radius: ab.radius || 150, owner: this.owner });
          return true;                     // 이동기 — 적이 없어도 시전된다
        }

        // ── E: Crystal Shockwave (Ironclad Warden) ──
        // Bulwark's twin, and deliberately built out of the same parts: it is centred on
        // whatever the hero is defending (_domeHost — the crystal in Crystal Guard, the
        // hero itself otherwise) and it shoves outward FROM that point, never from the
        // Warden. Pushing away from the hero scatters enemies wherever the hero happens to
        // be standing; pushing away from the objective always clears the thing you care
        // about, which is the only thing the button is for.
        //
        // Flyers are shoved too. They are above the terrain, not above a pressure wave,
        // and a shockwave that politely ignored the air wing would read as broken to the
        // six-year-old who just watched everything else get thrown.
        case 'shock': {
          const from = this._domeHost(game) || this;
          const R = ab.radius || 340;
          let hit = 0;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(from.x, from.y, u.x, u.y) > R) continue;
            this._hit(u, ab.dmg || 35, game);
            u.slow = Math.max(u.slow || 0, ab.slowDur || 1.5);
            // Direction is measured from the origin, so a unit standing exactly on it has
            // no direction to be thrown in — fall back to its own facing rather than NaN.
            const a2 = (u.x === from.x && u.y === from.y)
                     ? u.facing : Math.atan2(u.y - from.y, u.x - from.x);
            const push = ab.push || 170;
            u.x = Math.max(u.r, Math.min(RC.CFG.WORLD_W - u.r, u.x + Math.cos(a2) * push));
            u.y = Math.max(u.r, Math.min(RC.CFG.WORLD_H - u.r, u.y + Math.sin(a2) * push));
            // Whatever it was walking towards is now behind it — drop the order so it has
            // to re-approach instead of teleporting its target back into range next tick.
            u.path = null; u._pathGoal = null;
            hit++;
          }
          if (!hit) return false;          // 밀어낼 적이 없으면 소모하지 않는다
          game.fx.push({ abil: 'aegis', ax: from.x, ay: from.y, t: 0.9, radius: R, owner: this.owner });
          return true;
        }

        // ── Q: Venom Spray (Brood Matriarch) ──
        // Almost no burst. It is a bet that the fight lasts six more seconds, which is
        // exactly the bet the whole Gloop faction is built on.
        case 'spray': {
          let any = false;
          const apply = (e) => {
            this._hit(e, ab.dmg || 34, game);
            RC.applyVenom(e, ab.venom || { dmg: 9, dur: 6, max: 4 });
            RC.applyVenom(e, ab.venom || { dmg: 9, dur: 6, max: 4 });   // 두 겹 — 즉시 체감되도록
            any = true;
          };
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) <= (ab.radius || 175)) apply(u);
          }
          for (const b of game.buildings) {
            if (b.dead || !b.done || !game.areEnemies(b.owner, this.owner)) continue;
            if (RC.dist(this.x, this.y, b.x, b.y) <= (ab.radius || 175) + b.r) apply(b);
          }
          if (!any) return false;
          game.fx.push({ abil: 'nova', ax: this.x, ay: this.y, t: 0.5, radius: ab.radius || 175, owner: this.owner });
          return true;
        }

        // ── Q: Phase Shift (Radiant Archon) ──
        // The reposition doubles as the sustain: the shield comes back on ARRIVAL, so the
        // escape and the heal are the same button and cannot be greedily separated.
        case 'blink': {
          const nx = this.x + Math.cos(this.facing) * (ab.dist || 265);
          const ny = this.y + Math.sin(this.facing) * (ab.dist || 265);
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.35, radius: this.r, owner: this.owner });
          this.x = Math.max(this.r, Math.min(RC.CFG.WORLD_W - this.r, nx));
          this.y = Math.max(this.r, Math.min(RC.CFG.WORLD_H - this.r, ny));
          game.fx.push({ abil: 'warp', ax: this.x, ay: this.y, t: 0.35, radius: this.r, owner: this.owner });
          if (ab.shield && this.maxShield) RC.restoreShield(this, ab.shield);
          return true;
        }

        // ── E: Static Prison (Radiant Archon) ──
        // Lands on the thickest knot rather than under the hero, for the same reason the
        // Rift Nova does: the player is choosing WHEN, and the sim should not waste that
        // choice on whichever two stragglers happen to be underfoot.
        case 'prison': {
          const at = this._pressurePoint(game, (ab.radius || 175) * 2.4) || { x: this.x, y: this.y };
          let any = false;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(at.x, at.y, u.x, u.y) > (ab.radius || 175)) continue;
            this._hit(u, ab.dmg || 30, game);
            u.frozen = Math.max(u.frozen || 0, ab.freeze || 1.8);
            u.freezeFx = 0.35;
            any = true;
          }
          if (!any) return false;
          game.fx.push({ abil: 'nova', ax: at.x, ay: at.y, t: 0.6, radius: ab.radius || 175, owner: this.owner });
          return true;
        }

        case 'devour': {   // 매트리아크 E — 포식 (주변 적을 물어뜯고 그만큼 회복)
          // 주변 적에게 광역 피해(+매트리아크 산성은 _hit이 자동 적용). 명중한 적 수만큼 자신을 회복한다.
          let hits = 0;
          for (const u of game.units) {
            if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
            if (RC.dist(this.x, this.y, u.x, u.y) > ab.radius) continue;
            this._hit(u, ab.dmg, game);
            u.slow = Math.max(u.slow || 0, ab.slowDur || 0);
            hits++;
          }
          if (!hits) return false;   // 적이 없으면 소모 안 함
          const healed = (ab.heal || 0) * Math.min(hits, ab.healCap || 4);
          if (healed > 0 && this.hp < this.maxHp) {
            this.hp = Math.min(this.maxHp, this.hp + healed);
            if (game.marks) game.marks.push({ dmg: Math.round(healed), heal: true, x: this.x, y: this.y - (this.r || 10) - 4, t: 0.8 });
          }
          game.fx.push({ abil: 'nova', ax: this.x, ay: this.y, t: 0.5, radius: ab.radius, owner: this.owner });
          return true;
        }
        // ── SIGNATURE: Bulwark (Ironclad Warden) ──
        // Throws a guard dome over the thing being defended, not over the hero. In
        // Crystal Guard that is the crystal; in a normal match it falls back to the
        // nearest friendly core, and to the Warden itself if it is somehow alone.
        case 'dome': {
          const host = this._domeHost(game);
          if (!host) return false;
          const amount = Math.round(ab.shield || 600);
          host.guard = { hp: amount, max: amount, t: ab.dur || 6, fx: 0.25,
                         owner: this.owner, radius: ab.radius || 300,
                         shatterDmg: ab.shatterDmg || 0, shatterSlow: ab.shatterSlow || 0 };
          // Wider Dome — allies standing inside get a smaller guard of their own.
          if (ab.allyShare) {
            const share = Math.round(amount * ab.allyShare);
            for (const u of game.units) {
              if (u.dead || u.owner !== this.owner || u.hero) continue;
              if (RC.dist(host.x, host.y, u.x, u.y) > (ab.radius || 300)) continue;
              u.guard = { hp: share, max: share, t: ab.dur || 6, fx: 0.2, owner: this.owner, radius: u.r + 6 };
            }
          }
          game.fx.push({ abil: 'dome', ax: host.x, ay: host.y, t: 0.8, radius: ab.radius || 300, owner: this.owner });
          return true;
        }

        // ── SIGNATURE: Hatch the Brood (Brood Matriarch) ──
        // Hatches at the thickest knot of enemies rather than under the hero's feet, so
        // the babies arrive where the fight actually is instead of needing to walk there.
        case 'brood': {
          const type = ab.spawn || 'globling';
          if (!RC.UNITS[type]) return false;
          const at = this._pressurePoint(game, 900) || { x: this.x, y: this.y };
          const n = Math.max(1, Math.round(ab.count || 5));
          for (let i = 0; i < n; i++) {
            const a2 = (i / n) * Math.PI * 2;
            const d = (ab.radius || 130) * (0.4 + 0.6 * ((i % 3) / 2));
            const nx = Math.max(20, Math.min(RC.CFG.WORLD_W - 20, at.x + Math.cos(a2) * d));
            const ny = Math.max(20, Math.min(RC.CFG.WORLD_H - 20, at.y + Math.sin(a2) * d));
            const u = new RC.Unit(type, nx, ny, this.owner);
            u.temp = ab.life || 26;      // free, but they expire — no supply, no upkeep
            u.free = true;
            u.summoned = true;
            if (ab.hatchSpd) u.speedMul = (u.speedMul || 1) * ab.hatchSpd;
            if (ab.hatchDmg) u.dmgMul = (u.dmgMul || 1) * ab.hatchDmg;
            if (ab.burstDmg) u.deathBurst = { radius: ab.burstRadius || 90, dmg: ab.burstDmg };
            if (game.initUnit) game.initUnit(u);
            game.units.push(u);
            game.fx.push({ abil: 'warp', ax: nx, ay: ny, t: 0.4, radius: u.r + 8, owner: this.owner });
          }
          game.fx.push({ abil: 'swarm', ax: at.x, ay: at.y, t: 0.9, radius: ab.radius || 130, owner: this.owner });
          return true;
        }

        // ── SIGNATURE: Rift Nova (Radiant Archon) ──
        // The shove is measured from the CRYSTAL, not from the Archon. Pushing away from
        // the hero scatters enemies wherever the hero happens to stand; pushing away from
        // the objective always clears the thing you are defending.
        // NB the id is 'riftnova', not 'nova' — the Spitter's Corrosive Spray already owns
        // 'nova', and a duplicate case label is silently unreachable rather than an error.
        case 'riftnova': {
          const at = this._pressurePoint(game, ab.radius * 2.2) || { x: this.x, y: this.y };
          const from = this._domeHost(game) || this;
          const R = ab.radius || 240;
          let hit = 0;
          for (const u of game.units) {
            if (u.dead) continue;
            if (RC.dist(at.x, at.y, u.x, u.y) > R) continue;
            if (game.areEnemies(u.owner, this.owner)) {
              this._hit(u, ab.dmg || 60, game);
              u.slow = Math.max(u.slow || 0, ab.slowDur || 1.5);
              const a2 = Math.atan2(u.y - from.y, u.x - from.x);
              const push = ab.push || 95;
              u.x = Math.max(u.r, Math.min(RC.CFG.WORLD_W - u.r, u.x + Math.cos(a2) * push));
              u.y = Math.max(u.r, Math.min(RC.CFG.WORLD_H - u.r, u.y + Math.sin(a2) * push));
              hit++;
            } else if (u.owner === this.owner && (ab.heal || ab.shieldGrant)) {
              if (ab.heal && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + ab.heal);
              if (ab.shieldGrant && u.maxShield) RC.restoreShield(u, ab.shieldGrant);
            }
          }
          game.fx.push({ abil: 'aegis', ax: at.x, ay: at.y, t: 1.0, radius: R, owner: this.owner });
          void hit;                       // fires even on an empty field — see cast()
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

    // What the hero is defending: the crystal if the mode has one, otherwise the hero
    // itself. Both signatures that need an origin read this — the dome goes over it, and
    // the nova shoves enemies away from it.
    //
    // It used to fall back to the nearest friendly CORE, which was wrong in every mode
    // without a crystal: the hero pushes out, the core sits at the far end of the map, and
    // an AI Warden measured pressure at an empty base and so never fired at all. "Hold on"
    // has to mean the place that is actually in danger, and that place is where the hero
    // is standing. With Wider Dome that covers the squad standing with it.
    _domeHost(game) {
      if (game.crystal && !game.crystal.dead) return game.crystal;
      return this;
    }

    // The thickest knot of enemies within `range` — where the fight actually is. Scored
    // by how many other enemies sit near each candidate, so a lone scout never outranks a
    // clump. This is the whole of the auto-targeting: the player chooses WHEN, not where.
    _pressurePoint(game, range) {
      const home = this._domeHost(game);
      const ox = home ? home.x : this.x, oy = home ? home.y : this.y;
      let best = null, bestScore = 0;
      for (const u of game.units) {
        if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
        if (RC.dist(ox, oy, u.x, u.y) > range) continue;
        let n = 0;
        for (const v of game.units) {
          if (v.dead || !game.areEnemies(v.owner, this.owner)) continue;
          if (RC.dist(u.x, u.y, v.x, v.y) <= 150) n++;
        }
        // Tie-break towards the objective, so an equal clump closer to the crystal wins.
        const score = n * 1000 - RC.dist(ox, oy, u.x, u.y);
        if (score > bestScore || !best) { bestScore = score; best = u; }
      }
      return best ? { x: best.x, y: best.y } : null;
    }

    // AI 영웅 자동 시전 — 스킬마다 "지금 쓸 값어치가 있나"를 따로 묻는다.
    // Q and E are cheap and come back, so their bar is low: a real fight is enough. The
    // ultimate is the one thing worth holding, so it keeps the higher bar it always had.
    _heroAutoCast(game) {
      const home = this._domeHost(game);
      for (const sk of this.skills()) {
        if (!this.skillReady(sk)) continue;
        const r = sk.radius || sk.dist || 240;
        // Defensive skills are judged by pressure on what they protect; everything else by
        // pressure near the hero, which is where it will land.
        const guarding = (sk.id === 'dome' || sk.id === 'shock');
        const ax = (guarding && home) ? home.x : this.x;
        const ay = (guarding && home) ? home.y : this.y;
        let foes = 0;
        for (const u of game.units) {
          if (u.dead || !game.areEnemies(u.owner, this.owner)) continue;
          if (RC.dist(ax, ay, u.x, u.y) <= r) foes++;
        }
        // The brood is reinforcement — worth it the moment a real fight starts. A moment
        // spent on two stragglers is a moment wasted for everything else.
        const need = sk.ult ? (sk.id === 'brood' ? 2 : 4) : 2;
        if (foes >= need && this.cast(game, sk.key)) return;   // 한 번에 하나씩
      }
    }

    // AI 자동 시전 — 영웅만 시전할 것이 있다. 나머지는 전부 패시브라 부를 일이 없다.
    _autoCast(dt, game) {
      this._castTry -= dt;
      if (this._castTry > 0) return;
      this._castTry = 0.5;
      if (this.hero) this._heroAutoCast(game);
    }
  }

  RC.ShardNode = ShardNode;
  RC.Building = Building;
  RC.Unit = Unit;
})();
