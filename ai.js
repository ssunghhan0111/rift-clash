// RIFT CLASH — 적/동맹 AI (다중 owner 지원, 팀전 대응)
// 각 AI owner가 독립적으로 경제→인구→병영→웨이브 공격을 수행한다.
window.RC = window.RC || {};

RC.AI = (function () {
  const K = RC.CFG;

  // Per-game AI memory lives on game._ai so multiple concurrent games (server rooms)
  // never share owner state. It is cleared in game.reset(). reset() is kept for the
  // offline caller but is a harmless no-op now.
  function reset() { }

  function st(g, own) {
    if (!g._ai) g._ai = {};
    if (!g._ai[own]) g._ai[own] = { think: 0, waveTimer: K.AI_FIRST_WAVE, waveNum: 0 };
    return g._ai[own];
  }

  function myUnits(g, own, type) {
    return g.units.filter(u => u.owner === own && (!type || u.type === type));
  }
  function myBuildings(g, own, type) {
    return g.buildings.filter(b => b.owner === own && (!type || b.type === type));
  }

  function findSpot(g, type, near, own) {
    // Search an expanding ring: close in first, then further out as tries grow. A base
    // near the pop cap is crowded, and the old fixed 130–350px band would fill up and
    // the bot would simply stop building — no lab, no supply, a stalled economy.
    for (let tries = 0; tries < 90; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rad = 120 + Math.random() * (200 + tries * 4);   // grows to ~120–680px
      const x = near.x + Math.cos(a) * rad;
      const y = near.y + Math.sin(a) * rad;
      if (g.canPlace(type, x, y, own)) return { x, y };
    }
    return null;
  }

  // 이 owner의 종족 역할 맵 (role → 실제 타입 id)
  function roles(g, own) {
    const r = g.raceDef ? g.raceDef(own) : RC.RACES.forge;
    return r.ai;
  }

  // 목록에서 가장 부족한(수가 적은) 유닛을 하나 생산 — 종족 무관
  function trainFromList(g, own, bld, list, shard) {
    if (!list || !list.length || bld.queue.length > 0) return false;
    let best = null;
    for (const t of list) {
      const d = RC.UNITS[t];
      if (!d || shard < d.cost) continue;
      const cnt = g.units.filter(u => u.owner === own && u.type === t).length;
      if (!best || cnt < best.cnt) best = { t, cnt };
    }
    return best ? g.train(bld, best.t) : false;
  }

  // 이 owner의 코어에서 가장 가까운 적 팀 코어
  function nearestEnemyCore(g, own, from) {
    let best = null, bd = Infinity;
    for (const b of g.buildings) {
      if (b.dead || !b.def.isCore || !g.areEnemies(b.owner, own)) continue;
      const d = RC.dist(from.x, from.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ── Survival: garrison the Rift Crystal ───────────────────────────────────
  // The horde has no base, so nearestEnemyCore() finds nothing and the normal
  // attack wave (section 6) sends the army to its OWN core — where it stands and
  // watches the crystal get eaten. In Survival the ally holds the crystal instead
  // and answers anything that comes near it.
  const DEF_RING = 210;      // where the reserve waits between waves
  const DEF_ALERT = 1000;    // how far out a horde unit is worth intercepting
  function defendCrystal(g, own) {
    const c = g.crystal;
    const army = g.units.filter(u => u.owner === own && !u.dead && !u.def.worker && u.canFight());
    if (!army.length) return;

    let threat = null, td = Infinity;
    for (const u of g.units) {
      if (u.dead || !g.areEnemies(u.owner, own)) continue;
      const d = RC.dist(u.x, u.y, c.x, c.y);
      if (d < td) { td = d; threat = u; }
    }

    army.forEach((u, i) => {
      if (u.state === 'build' || u.boarded) return;
      if (u.foe && !u.foe.dead) return;                       // already fighting — leave it alone
      const a = (i / army.length) * Math.PI * 2;
      if (threat && td <= DEF_ALERT) {
        u.attackMoveTo(threat.x + Math.cos(a) * 60, threat.y + Math.sin(a) * 60);
      } else if (u.state === 'idle' && RC.dist(u.x, u.y, c.x, c.y) > DEF_RING + 80) {
        u.moveTo(c.x + Math.cos(a) * DEF_RING, c.y + Math.sin(a) * DEF_RING);
      }
    });
  }

  function update(dt, g) {
    if (g.over) return;
    for (const p of g.players) {
      if (p.ai) think(dt, g, p.owner);
    }
  }

  function think(dt, g, own) {
    const s = st(g, own);
    // 난이도 프로필 — 없으면(온라인 드롭 등) 기존 CFG 상수와 동일한 Normal 값으로 폴백
    const P = (g.aiProfile && g.aiProfile(own)) || (RC.AI_DIFF && RC.AI_DIFF.normal) || {
      workerCap: K.AI_WORKER_CAP, firstWave: K.AI_FIRST_WAVE, waveSize: K.AI_WAVE_SIZE,
      waveGrowth: K.AI_WAVE_GROWTH, waveGap: K.AI_WAVE_GAP, armyCap: 999,
      maxBarracks: 2, secondFactory: K.AI_SECOND_FACTORY, tower: true, tech: true,
    };
    const armyCap = P.armyCap == null ? 999 : P.armyCap;   // 전투 유닛 상한 (Easy 데스볼 방지)
    if (!s.diffInit) { s.waveTimer = P.firstWave; s.diffInit = true; }   // 첫 공격 타이밍은 난이도가 정한다
    s.think -= dt;
    s.waveTimer -= dt;
    if (s.think > 0) return;
    s.think = 1.0;

    const core = g.core(own);
    if (!core) return;
    const R = roles(g, own);                    // 종족 역할 맵
    const sup = g.supply(own);
    const workers = myUnits(g, own, R.worker);
    const barracks = myBuildings(g, own, R.barracks).filter(b => b.done);
    const shard = g.res[own].shard;
    const labCost = (R.tech && RC.BUILDINGS[R.tech]) ? RC.BUILDINGS[R.tech].cost : 200;
    const idleWorker = () => workers.find(u => u.state !== 'build') || workers[0];
    // The research lab is the LAST building in the priority list, so extra barracks,
    // air and towers used to grab every spare shard and it was never built. Once the
    // bot is ready to tech, hold the lab's cost back from those optional buildings.
    const wantsLab = P.tech && R.tech && myBuildings(g, own, R.tech).length === 0 &&
                     g.time > K.AI_ARCLAB && workers.length >= 6;
    const techReserve = wantsLab ? labCost : 0;

    // Defence runs BEFORE the economy branches — several of those `return` early
    // after placing a building, and the crystal cannot be left undefended for a
    // turn just because a Power Cell went down this second.
    const defending = g.survival && g.crystal && !g.crystal.dead;
    if (defending) defendCrystal(g, own);

    // 1) 유휴 일꾼 채집
    workers.forEach(w => {
      if (w.state === 'idle') { const n = g.findNearestNode(w.x, w.y); if (n) w.gatherFrom(n); }
    });

    // 2) 인구 여유
    // (Tried widening this buffer when the cap went to 100 — measured no gain over
    // 8 AI-vs-AI runs. The AI is gated on shard income, not on the buffer, so the
    // simple rule stays.)
    const buildingSupply = myBuildings(g, own, R.supply).some(b => !b.done);
    if (sup.max - sup.used <= 3 && sup.max < K.POP_CAP && !buildingSupply && shard >= 80) {
      const spot = findSpot(g, R.supply, core, own);
      if (spot) { g.placeBuilding(R.supply, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 3) 일꾼 보충
    if (workers.length < P.workerCap && core.queue.length === 0 && shard >= 50) g.train(core, R.worker);

    // 4) 병영 — 첫 병영은 우선(병력을 뽑아야 하므로), 추가 병영은 랩 자금을 남기고 짓는다
    const barracksAll = myBuildings(g, own, R.barracks);
    const barracksCap = g.time > P.secondFactory ? (P.maxBarracks || 2) : 1;
    const firstBarracks = barracksAll.length === 0;
    const barBudget = firstBarracks ? shard : shard - techReserve;
    if (barracksAll.length < barracksCap && barBudget >= 150 && workers.length >= 5) {
      const spot = findSpot(g, R.barracks, core, own);
      if (spot) { g.placeBuilding(R.barracks, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.5) 공중 건물 — Skylord는 이른 시점에 공중부터 올린다 (bias 'air')
    const airGate = P.bias === 'air' ? 0 : P.secondFactory;
    const airWorkers = P.bias === 'air' ? 5 : 6;
    if (R.air && myBuildings(g, own, R.air).length === 0 && g.time > airGate && (shard - techReserve) >= 180 && workers.length >= airWorkers) {
      const spot = findSpot(g, R.air, core, own);
      if (spot) { g.placeBuilding(R.air, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.6) 테크/연구 건물
    if (R.tech && P.tech && myBuildings(g, own, R.tech).length === 0 && g.time > K.AI_ARCLAB && shard >= labCost && workers.length >= 6) {
      const spot = findSpot(g, R.tech, core, own);
      if (spot) { g.placeBuilding(R.tech, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.7) 방어 타워 (본진 방어) — Turtler는 일찍, 더 많이 짓는다 (towerEarly)
    const towerGate = P.towerEarly ? 25 : K.AI_TOWER;
    const towerCap  = P.towerEarly ? 4 : 2;
    if (R.tower && P.tower && g.time > towerGate && myBuildings(g, own, R.tower).length < towerCap && (shard - techReserve) >= 130 && workers.length >= (P.towerEarly ? 4 : 5)) {
      const spot = findSpot(g, R.tower, core, own);
      if (spot) { g.placeBuilding(R.tower, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.8) 연구 — 유닛 생산보다 먼저 처리한다. 예전엔 병력 생산이 자원을 다 쓴 뒤에야
    //      연구를 시도해 20분 동안 업그레이드를 하나도 못 하는 문제가 있었다. 이제
    //      랩이 서 있고 여유분(AI_RESEARCH_MIN)이 있으면 유닛보다 먼저 연구를 건다.
    if (P.tech) {
      const rmin = RC.AI_RESEARCH_MIN || 140;
      myBuildings(g, own, R.tech).filter(b => b.done && b.def.research && !b.research).forEach(lab => {
        if (shard < rmin) return;
        const order = ['atk', 'spd', 'arm', 'crit', 'tough', 'eng', 'frost'];
        for (const kind of order) {
          if (g.upLevel(own, kind) < RC.UPGRADES[kind].costs.length) { if (g.research(lab, kind)) break; }
        }
      });
    }

    // 자원 규율 — 유닛 생산이 랩·연구 자금까지 먹어버리지 않게 여유분을 남긴다.
    // 랩이 아직 없으면 랩값만큼, 있으면 남은 업그레이드가 있는 동안 연구비만큼 비축.
    let reserveFloor = 0;
    if (P.tech && R.tech) {
      const labs = myBuildings(g, own, R.tech);
      if (labs.length === 0 && g.time > K.AI_ARCLAB && workers.length >= 6) reserveFloor = labCost;
      else if (labs.some(b => b.done)) {
        let upgradesLeft = false;
        for (const k of (RC.UPGRADE_ORDER || [])) { if (g.upLevel(own, k) < RC.UPGRADES[k].costs.length) { upgradesLeft = true; break; } }
        if (upgradesLeft) reserveFloor = RC.AI_RESEARCH_MIN || 140;
      }
    }
    const spendable = Math.max(0, shard - reserveFloor);

    // 5) 지상 유닛 생산 (공중/상급 유닛용 인구 예약)
    // 난이도 상한 — Easy는 병력을 소규모로 묶어 데스볼을 만들지 못하게 한다.
    const combatNow = g.units.filter(u => u.owner === own && !u.def.worker).length;
    const underCap = combatNow < armyCap;
    const hasAir = R.air && myBuildings(g, own, R.air).some(b => b.done);
    const hasTech = R.tech && (R.techUnits || []).length && myBuildings(g, own, R.tech).some(b => b.done);
    const reserve = (hasAir ? (P.bias === 'air' ? 12 : 5) : 0) + (hasTech ? 4 : 0);
    if (underCap) barracks.forEach(f => {
      if (sup.used >= sup.max - reserve) return;   // 공중/캐스터가 들어갈 인구 남겨둠
      trainFromList(g, own, f, R.barracksUnits, spendable);
    });

    // 5.5) 공중 유닛
    if (R.air && underCap) myBuildings(g, own, R.air).filter(b => b.done).forEach(pad => {
      trainFromList(g, own, pad, R.airUnits, spendable);
    });

    // 5.6) 테크 — 상급 유닛 (연구는 위 4.8에서 유닛보다 먼저 처리했다)
    if (R.tech) myBuildings(g, own, R.tech).filter(b => b.done).forEach(lab => {
      if (underCap && combatNow >= 4) trainFromList(g, own, lab, R.techUnits, spendable);
    });

    // 6) 공격 웨이브 — 가장 가까운 적 팀 코어로
    if (defending) return;                      // survival allies hold the crystal; they never march out
    const army = g.units.filter(u => u.owner === own && !u.def.worker);
    if (s.waveTimer <= 0) {
      const need = Math.min(armyCap, P.waveSize + s.waveNum * (P.waveGrowth != null ? P.waveGrowth : K.AI_WAVE_GROWTH));
      if (army.length >= need) {
        const target = nearestEnemyCore(g, own, core) || { x: core.x, y: core.y };
        // Send the WAVE, not the whole army. `need` used to be only a gate: once the bot
        // had enough units it threw every single one at you, so waveSize described when
        // the attack came but never how big it was. On Normal that meant a first knock at
        // 4 minutes with everything the bot owned — unanswerable if you were still setting
        // up. The remainder now stays home as a garrison, so waves are the size the
        // difficulty table says and grow wave over wave the way waveGrowth intends.
        const strike = army.slice(0, need);
        strike.forEach((u, i) => {
          const a = (i / strike.length) * Math.PI * 2;
          u.attackMoveTo(target.x + Math.cos(a) * 70, target.y + Math.sin(a) * 70);   // engage defenders on the way
        });
        s.waveNum++;
        s.waveTimer = P.waveGap;
        if (own !== g.playerOwner && g.areEnemies(own, g.playerOwner)) g.notify((P.label ? P.label + ' — ' : '') + 'Enemy forces incoming!');
      } else {
        s.waveTimer = 12;
      }
    } else {
      // 대기 병력은 본진 앞에 집결
      army.forEach((u, i) => {
        if (u.state === 'idle' && RC.dist(u.x, u.y, core.x, core.y) > 320) {
          u.moveTo(core.x + (i % 5 - 2) * 34, core.y + 150 + Math.floor(i / 5) * 34);
        }
      });
    }
  }

  return { update, reset };
})();
