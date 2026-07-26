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
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2;
      const rad = 130 + Math.random() * 220;
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
    const idleWorker = () => workers.find(u => u.state !== 'build') || workers[0];

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
    const buildingSupply = myBuildings(g, own, R.supply).some(b => !b.done);
    if (sup.max - sup.used <= 3 && sup.max < K.POP_CAP && !buildingSupply && shard >= 80) {
      const spot = findSpot(g, R.supply, core, own);
      if (spot) { g.placeBuilding(R.supply, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 3) 일꾼 보충
    if (workers.length < K.AI_WORKER_CAP && core.queue.length === 0 && shard >= 50) g.train(core, R.worker);

    // 4) 병영
    const barracksAll = myBuildings(g, own, R.barracks);
    const barracksCap = g.time > K.AI_SECOND_FACTORY ? 2 : 1;
    if (barracksAll.length < barracksCap && shard >= 150 && workers.length >= 5) {
      const spot = findSpot(g, R.barracks, core, own);
      if (spot) { g.placeBuilding(R.barracks, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.5) 공중 건물 (후반)
    if (R.air && myBuildings(g, own, R.air).length === 0 && g.time > K.AI_SECOND_FACTORY && shard >= 180 && workers.length >= 6) {
      const spot = findSpot(g, R.air, core, own);
      if (spot) { g.placeBuilding(R.air, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.6) 테크/연구 건물
    if (R.tech && myBuildings(g, own, R.tech).length === 0 && g.time > K.AI_ARCLAB && shard >= 200 && workers.length >= 6) {
      const spot = findSpot(g, R.tech, core, own);
      if (spot) { g.placeBuilding(R.tech, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 4.7) 방어 타워 (본진 방어)
    if (R.tower && g.time > K.AI_TOWER && myBuildings(g, own, R.tower).length < 2 && shard >= 130 && workers.length >= 5) {
      const spot = findSpot(g, R.tower, core, own);
      if (spot) { g.placeBuilding(R.tower, spot.x, spot.y, own, [idleWorker()].filter(Boolean)); return; }
    }

    // 5) 지상 유닛 생산 (공중/상급 유닛용 인구 예약)
    const hasAir = R.air && myBuildings(g, own, R.air).some(b => b.done);
    const hasTech = R.tech && (R.techUnits || []).length && myBuildings(g, own, R.tech).some(b => b.done);
    const reserve = (hasAir ? 5 : 0) + (hasTech ? 4 : 0);
    barracks.forEach(f => {
      if (sup.used >= sup.max - reserve) return;   // 공중/캐스터가 들어갈 인구 남겨둠
      trainFromList(g, own, f, R.barracksUnits, shard);
    });

    // 5.5) 공중 유닛
    if (R.air) myBuildings(g, own, R.air).filter(b => b.done).forEach(pad => {
      trainFromList(g, own, pad, R.airUnits, shard);
    });

    // 5.6) 테크 — 연구 + 상급 유닛
    if (R.tech) myBuildings(g, own, R.tech).filter(b => b.done).forEach(lab => {
      // 여유 자원이 있으면 업그레이드 연구 (번갈아)
      if (lab.def.research && !lab.research && shard >= 200) {
        const order = ['atk', 'spd', 'arm', 'crit', 'tough', 'eng', 'frost'];
        for (const kind of order) {
          if (g.upLevel(own, kind) < RC.UPGRADES[kind].costs.length) { if (g.research(lab, kind)) break; }
        }
      }
      const army = g.units.filter(u => u.owner === own && !u.def.worker).length;
      if (army >= 4) trainFromList(g, own, lab, R.techUnits, shard);
    });

    // 6) 공격 웨이브 — 가장 가까운 적 팀 코어로
    if (defending) return;                      // survival allies hold the crystal; they never march out
    const army = g.units.filter(u => u.owner === own && !u.def.worker);
    if (s.waveTimer <= 0) {
      const need = K.AI_WAVE_SIZE + s.waveNum * K.AI_WAVE_GROWTH;
      if (army.length >= need) {
        const target = nearestEnemyCore(g, own, core) || { x: core.x, y: core.y };
        army.forEach((u, i) => {
          const a = (i / army.length) * Math.PI * 2;
          u.attackMoveTo(target.x + Math.cos(a) * 70, target.y + Math.sin(a) * 70);   // engage defenders on the way
        });
        s.waveNum++;
        s.waveTimer = K.AI_WAVE_GAP;
        if (own !== g.playerOwner && g.areEnemies(own, g.playerOwner)) g.notify('Enemy forces incoming!');
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
