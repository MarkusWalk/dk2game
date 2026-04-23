// ============================================================
// PATHFINDING (A*)
// ============================================================
// Manhattan-distance heuristic, 4-connected grid, cost=1 per step. Small open
// list (linear min scan) is fine for our 30x30 grid; switching to a binary
// heap would buy <1ms on this scale.

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

export function findPath(sx, sz, ex, ez) {
  if (sx === ex && sz === ez) return [{ x: sx, z: sz }];
  if (!isWalkable(ex, ez)) return null;

  const open = [];
  const came = new Map();
  const gScore = new Map();
  const startKey = sx + ',' + sz;
  gScore.set(startKey, 0);
  open.push({ x: sx, z: sz, f: Math.abs(sx - ex) + Math.abs(sz - ez) });

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

    const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dz] of neighbors) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (!isWalkable(nx, nz)) continue;
      const nKey = nx + ',' + nz;
      const tentative = gScore.get(curKey) + 1;
      if (!gScore.has(nKey) || tentative < gScore.get(nKey)) {
        came.set(nKey, curKey);
        gScore.set(nKey, tentative);
        const f = tentative + Math.abs(nx - ex) + Math.abs(nz - ez);
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
