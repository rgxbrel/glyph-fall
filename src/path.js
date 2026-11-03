/* Small deterministic grid pathfinder for the same tile map used by simulation. */
import { TILE } from './world.js';

export function nextPathStep(map, fromX, fromY, toX, toY, maxNodes = 180) {
  const start = tileOf(fromX, fromY), goal = tileOf(toX, toY);
  if (start.x === goal.x && start.y === goal.y) return null;
  const key = (x, y) => y * map.w + x;
  const open = [start], came = new Map(), g = new Map([[key(start.x, start.y), 0]]);
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  let visited = 0;
  while (open.length && visited++ < maxNodes) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (h(open[i].x, open[i].y) + (g.get(key(open[i].x, open[i].y)) || 0) < h(open[best].x, open[best].y) + (g.get(key(open[best].x, open[best].y)) || 0)) best = i;
    const cur = open.splice(best, 1)[0], ck = key(cur.x, cur.y);
    if (cur.x === goal.x && cur.y === goal.y) {
      let step = cur;
      while (came.has(key(step.x, step.y)) && key(came.get(key(step.x, step.y)).x, came.get(key(step.x, step.y)).y) !== key(start.x, start.y)) step = came.get(key(step.x, step.y));
      return { x: (step.x + 0.5) * TILE, y: (step.y + 0.5) * TILE };
    }
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 1 || ny < 1 || nx >= map.w - 1 || ny >= map.h - 1 || map.solidAt((nx + 0.5) * TILE, (ny + 0.5) * TILE)) continue;
      const nk = key(nx, ny), score = (g.get(ck) || 0) + 1;
      if (score >= (g.get(nk) ?? Infinity)) continue;
      came.set(nk, cur); g.set(nk, score);
      if (!open.some((n) => n.x === nx && n.y === ny)) open.push({ x: nx, y: ny });
    }
  }
  return null;
}

function tileOf(x, y) { return { x: Math.floor(x / TILE), y: Math.floor(y / TILE) }; }
