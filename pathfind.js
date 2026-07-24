// RIFT CLASH — Pathfinding (A* around static obstacles for ground units)
// Cheap by design: units walk straight when the line to their goal is clear, and only run
// A* (on a coarse nav grid) when an obstacle is in the way. Paths are cached per unit until a
// new order. Flying units ignore this entirely. Shared by the browser client and the server.
window.RC = window.RC || {};

RC.Path = (function () {
  const TILE = 60;          // nav cell size (coarser than the render tile → fast searches)
  const PAD = 18;           // clearance baked around obstacles so units don't clip corners

  // Build (once per map) a blocked-cell grid from the game's obstacles. Cached on game._nav.
  function ensure(game) {
    if (game._nav) return game._nav;
    const W = game.world.w, H = game.world.h;
    const cols = Math.ceil(W / TILE), rows = Math.ceil(H / TILE);
    const blocked = new Uint8Array(cols * rows);
    for (const o of (game.obstacles || [])) {
      const x0 = Math.floor((o.x - o.w / 2 - PAD) / TILE), x1 = Math.floor((o.x + o.w / 2 + PAD) / TILE);
      const y0 = Math.floor((o.y - o.h / 2 - PAD) / TILE), y1 = Math.floor((o.y + o.h / 2 + PAD) / TILE);
      for (let cy = Math.max(0, y0); cy <= Math.min(rows - 1, y1); cy++)
        for (let cx = Math.max(0, x0); cx <= Math.min(cols - 1, x1); cx++)
          blocked[cy * cols + cx] = 1;
    }
    game._nav = { cols, rows, blocked, tile: TILE };
    return game._nav;
  }

  function cellBlocked(nav, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= nav.cols || cy >= nav.rows) return true;
    return nav.blocked[cy * nav.cols + cx] === 1;
  }

  // Line-of-sight: is the straight segment a→b free of blocked cells?
  function clear(game, ax, ay, bx, by) {
    const nav = ensure(game);
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / (nav.tile * 0.5)));
    for (let i = 1; i < steps; i++) {
      const x = ax + dx * i / steps, y = ay + dy * i / steps;
      if (cellBlocked(nav, Math.floor(x / nav.tile), Math.floor(y / nav.tile))) return false;
    }
    return true;
  }

  // Nearest non-blocked cell (spiral out) — start/goal may land inside padding.
  function nearestFree(nav, cx, cy) {
    if (!cellBlocked(nav, cx, cy)) return [cx, cy];
    for (let r = 1; r < 10; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && ny >= 0 && nx < nav.cols && ny < nav.rows && !cellBlocked(nav, nx, ny)) return [nx, ny];
        }
    return [cx, cy];
  }

  function astar(nav, sx, sy, tx, ty) {
    const cols = nav.cols, rows = nav.rows, N = cols * rows;
    const idx = (x, y) => y * cols + x;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const inOpen = new Uint8Array(N);
    const open = [];
    const h = (x, y) => Math.hypot(x - tx, y - ty);
    const start = idx(sx, sy), goal = idx(tx, ty);
    g[start] = 0; f[start] = h(sx, sy); open.push(start); inOpen[start] = 1;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      inOpen[cur] = 0;
      if (cur === goal) {
        const p = []; let n = cur;
        while (n !== -1) { p.push([n % cols, (n / cols) | 0]); n = came[n]; }
        return p.reverse();
      }
      closed[cur] = 1;
      const cx = cur % cols, cy = (cur / cols) | 0;
      for (const [ddx, ddy] of dirs) {
        const nx = cx + ddx, ny = cy + ddy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (nav.blocked[idx(nx, ny)]) continue;
        if (ddx && ddy && (nav.blocked[idx(cx + ddx, cy)] || nav.blocked[idx(cx, cy + ddy)])) continue;  // no corner cutting
        const ni = idx(nx, ny);
        if (closed[ni]) continue;
        const ng = g[cur] + (ddx && ddy ? 1.4142 : 1);
        if (ng < g[ni]) {
          came[ni] = cur; g[ni] = ng; f[ni] = ng + h(nx, ny);
          if (!inOpen[ni]) { open.push(ni); inOpen[ni] = 1; }
        }
      }
    }
    return null;
  }

  // Greedy string-pull: keep only waypoints that actually turn the corner.
  function smooth(game, sx, sy, pts) {
    const out = [];
    let cx = sx, cy = sy, i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      for (; j > i; j--) if (clear(game, cx, cy, pts[j].x, pts[j].y)) break;
      out.push(pts[j]); cx = pts[j].x; cy = pts[j].y; i = j + 1;
    }
    return out;
  }

  // Returns an array of {x,y} waypoints, or null when a straight line is already clear.
  function find(game, sx, sy, tx, ty) {
    const nav = ensure(game);
    if (clear(game, sx, sy, tx, ty)) return null;
    const s = nearestFree(nav, Math.floor(sx / nav.tile), Math.floor(sy / nav.tile));
    const t = nearestFree(nav, Math.floor(tx / nav.tile), Math.floor(ty / nav.tile));
    const cells = astar(nav, s[0], s[1], t[0], t[1]);
    if (!cells || cells.length < 2) return null;
    const pts = cells.map(c => ({ x: (c[0] + 0.5) * nav.tile, y: (c[1] + 0.5) * nav.tile }));
    pts.push({ x: tx, y: ty });
    return smooth(game, sx, sy, pts);
  }

  return { ensure, find, clear };
})();
