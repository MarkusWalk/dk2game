// ============================================================
// PATHFINDING (A*)
// ============================================================
// 8-connected grid (orthogonal cost 1, diagonal cost √2) with octile heuristic.
// Diagonals are corner-cut blocked: a creature can only step diagonally if both
// adjacent orthogonal cells are walkable, so it can't squeeze through the
// pinch point between two rocks. Small open list (linear min scan) is fine for
// our 30x30 grid; switching to a binary heap would buy <1ms on this scale.
//
// Earlier 4-connected version produced visibly L-shaped detours when going
// around corners; switching to 8-connected straightens those.

import {
  GRID_SIZE, T_FLOOR, T_CLAIMED, T_HEART, T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
} from './constants.js';
import { grid } from './state.js';

export function isWalkable(x, z) {
  if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return false;
  const t = grid[x][z].type;
  return t === T_FLOOR || t === T_CLAIMED || t === T_HEART
      || t === T_PORTAL_NEUTRAL || t === T_PORTAL_CLAIMED;
}

const DIRS = [
  { dx:  1, dz:  0, cost: 1 },
  { dx: -1, dz:  0, cost: 1 },
  { dx:  0, dz:  1, cost: 1 },
  { dx:  0, dz: -1, cost: 1 },
  { dx:  1, dz:  1, cost: Math.SQRT2 },
  { dx: -1, dz:  1, cost: Math.SQRT2 },
  { dx:  1, dz: -1, cost: Math.SQRT2 },
  { dx: -1, dz: -1, cost: Math.SQRT2 },
];
function octile(dx, dz) {
  const adx = Math.abs(dx), adz = Math.abs(dz);
  return (Math.SQRT2 - 1) * Math.min(adx, adz) + Math.max(adx, adz);
}

export function findPath(sx, sz, ex, ez) {
  if (sx === ex && sz === ez) return [{ x: sx, z: sz }];
  if (!isWalkable(ex, ez)) return null;

  const open = [];
  const came = new Map();
  const gScore = new Map();
  const startKey = sx + ',' + sz;
  gScore.set(startKey, 0);
  open.push({ x: sx, z: sz, f: octile(sx - ex, sz - ez) });

  while (open.length > 0) {
    // Extract min f
    let minIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[minIdx].f) minIdx = i;
    const cur = open.splice(minIdx, 1)[0];
    const curKey = cur.x + ',' + cur.z;

    if (cur.x === ex && cur.z === ez) {
      const path = [];
      let k = curKey;
      while (k) {
        const [px, pz] = k.split(',').map(Number);
        path.unshift({ x: px, z: pz });
        k = came.get(k);
      }
      return path;
    }

    for (const dir of DIRS) {
      const nx = cur.x + dir.dx, nz = cur.z + dir.dz;
      if (!isWalkable(nx, nz)) continue;
      // No corner-cutting through walls: a diagonal step requires both
      // orthogonal squares around the corner to be walkable too.
      if (dir.dx !== 0 && dir.dz !== 0) {
        if (!isWalkable(cur.x + dir.dx, cur.z)) continue;
        if (!isWalkable(cur.x, cur.z + dir.dz)) continue;
      }
      const nKey = nx + ',' + nz;
      const tentative = gScore.get(curKey) + dir.cost;
      if (!gScore.has(nKey) || tentative < gScore.get(nKey)) {
        came.set(nKey, curKey);
        gScore.set(nKey, tentative);
        const f = tentative + octile(nx - ex, nz - ez);
        // Replace or push
        const existing = open.find(n => n.x === nx && n.z === nz);
        if (existing) existing.f = f;
        else open.push({ x: nx, z: nz, f });
      }
    }
  }
  return null;
}

export function findPathToAdjacent(sx, sz, tx, tz) {
  const candidates = [[1,0],[-1,0],[0,1],[0,-1]]
    .map(([dx, dz]) => ({ x: tx + dx, z: tz + dz }))
    .filter(p => isWalkable(p.x, p.z));
  if (candidates.length === 0) return null;
  let best = null;
  for (const c of candidates) {
    const p = findPath(sx, sz, c.x, c.z);
    if (p && (!best || p.length < best.length)) best = p;
  }
  return best;
}
