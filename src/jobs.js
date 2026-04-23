// ============================================================
// JOB QUEUE
// ============================================================
// Jobs describe atomic work units an imp can perform. Types: dig, claim,
// claim_wall, reinforce. The queue lives in state.jobs; claimJob() is the
// priority-aware picker called from the imp AI.
//
// Cascading territory rules:
//   - Claiming a tile queues reinforce jobs on rock neighbors,
//     claim_wall on enemy wall neighbors, flips enemy floor to neutral,
//     and auto-claims neutral portals on contact.
//   - Capturing an enemy wall isolates any newly-orphaned neighbors, which
//     defect instantly (cascading conversion).

import {
  GRID_SIZE, JOB_PRIORITY, WORK_DURATIONS,
  T_ROCK, T_FLOOR, T_CLAIMED, T_GOLD, T_REINFORCED,
  T_ENEMY_FLOOR, T_ENEMY_WALL, T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
  BEACON_COLORS, XP_PER_DIG, XP_PER_CLAIM,
} from './constants.js';
import { grid, jobs, portals, stats } from './state.js';
import { setTile, createMarker } from './tiles.js';
import { scene } from './scene.js';
import { findPath, findPathToAdjacent } from './pathfinding.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst, spawnGoldBurst } from './effects.js';
import { awardXp } from './xp.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

export function markForDig(x, z) {
  const cell = grid[x][z];
  if (cell.type !== T_ROCK && cell.type !== T_GOLD && cell.type !== T_REINFORCED) return;
  // Already a dig job on this tile? skip
  const existing = jobs.find(j => j.x === x && j.z === z);
  if (existing && existing.type === 'dig') return;
  // If some other job type exists (e.g. reinforce), evict it so dig can take over
  if (existing) removeJobForTile(x, z);
  jobs.push({ x, z, type: 'dig', claimedBy: null });
  const m = createMarker(x, z);
  scene.add(m);
  cell.marker = m;
}

export function queueClaimJob(x, z) {
  if (jobs.some(j => j.x === x && j.z === z)) return;
  jobs.push({ x, z, type: 'claim', claimedBy: null });
  // no visible marker — auto-task
}

export function queueBorderJobsAround(cx, cz) {
  // Called after a tile becomes T_CLAIMED. Inspect each neighbor and queue
  // whatever territorial work is appropriate: reinforce plain rock, claim enemy
  // walls, liberate enemy floors, and claim neutral portals on contact.
  const neighbors = [[1,0],[-1,0],[0,1],[0,-1]];
  for (const [dx, dz] of neighbors) {
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
    const ncell = grid[nx][nz];
    if (jobs.some(j => j.x === nx && j.z === nz)) continue;
    if (ncell.type === T_ROCK) {
      jobs.push({ x: nx, z: nz, type: 'reinforce', claimedBy: null });
    } else if (ncell.type === T_ENEMY_WALL) {
      jobs.push({ x: nx, z: nz, type: 'claim_wall', claimedBy: null });
    } else if (ncell.type === T_ENEMY_FLOOR) {
      // Enemy's floor flips to neutral the instant your territory touches it;
      // your imps then claim it normally via the standard floor-claim flow.
      setTile(nx, nz, T_FLOOR);
      jobs.push({ x: nx, z: nz, type: 'claim', claimedBy: null });
    } else if (ncell.type === T_PORTAL_NEUTRAL) {
      // Portals don't need to be "built" — touching them with claimed territory
      // claims them instantly. A claimed portal will begin spawning creatures.
      claimPortal(nx, nz);
    }
  }
}

export function claimPortal(x, z) {
  setTile(x, z, T_PORTAL_CLAIMED);
  const portal = portals.find(p => p.x === x && p.z === z);
  if (portal) {
    portal.claimed = true;
    // Give the first spawn a short delay so the player sees the conversion effect first
    portal.spawnTimer = 4.0;
  }
  spawnPulse(x, z, 0xff4020, 0.1, 1.2);
  spawnSparkBurst(x, z, 0xff6040, 30, 1.2);
  playSfx('whoosh');
  playSfx('confirm', { minInterval: 400 });
  pushEvent('Portal claimed');
  // Cascade like any other claimed tile — surrounding rocks want to be reinforced,
  // surrounding enemy walls/floors get the usual conversion treatment. This matters
  // when a portal has been dug out through a narrow corridor: we want a safe shell.
  queueBorderJobsAround(x, z);
}

export function removeJobForTile(x, z) {
  const idx = jobs.findIndex(j => j.x === x && j.z === z);
  if (idx >= 0) {
    const job = jobs[idx];
    if (job.claimedBy && job.claimedBy.userData.job === job) {
      removeWorkBeacon(job.claimedBy.userData);
      job.claimedBy.userData.state = 'idle';
      job.claimedBy.userData.job = null;
    }
    jobs.splice(idx, 1);
  }
}

export function unmarkTile(x, z) {
  const cell = grid[x][z];
  if (cell.marker) {
    scene.remove(cell.marker);
    cell.marker = null;
  }
}

// Return the path target for a job (adjacent for dig/reinforce, on-tile for claim)
function jobPath(imp, job) {
  if (job.type === 'claim') {
    return findPath(imp.userData.gridX, imp.userData.gridZ, job.x, job.z);
  }
  return findPathToAdjacent(imp.userData.gridX, imp.userData.gridZ, job.x, job.z);
}

export function claimJob(imp) {
  // Priority: dig (user-commanded) > claim (expand) > reinforce (fortify)
  for (const type of JOB_PRIORITY) {
    let best = null;
    let bestLen = Infinity;
    for (const job of jobs) {
      if (job.type !== type) continue;
      if (job.claimedBy) continue;
      const path = jobPath(imp, job);
      if (path && path.length < bestLen) {
        bestLen = path.length;
        best = { job, path };
      }
    }
    if (best) {
      best.job.claimedBy = imp;
      return best;
    }
  }
  return null;
}

// Is a job's target tile still in a state where the job makes sense?
export function isJobStillValid(job) {
  const cell = grid[job.x][job.z];
  if (job.type === 'dig') return cell.type === T_ROCK || cell.type === T_GOLD || cell.type === T_REINFORCED;
  if (job.type === 'claim') return cell.type === T_FLOOR;
  if (job.type === 'reinforce') return cell.type === T_ROCK;
  if (job.type === 'claim_wall') return cell.type === T_ENEMY_WALL;
  return false;
}

export function completeJob(job, imp) {
  const idx = jobs.indexOf(job);
  if (idx >= 0) jobs.splice(idx, 1);

  const cell = grid[job.x][job.z];

  if (job.type === 'dig') {
    const wasGold = cell.type === T_GOLD;
    const goldAmount = cell.goldAmount || 0;
    unmarkTile(job.x, job.z);
    // Dug tile becomes UNCLAIMED floor — an imp must come back to claim it
    setTile(job.x, job.z, T_FLOOR);
    stats.tilesDug += 1;
    if (wasGold && imp) {
      imp.userData.carrying = goldAmount;
      imp.userData.carriedGold.visible = true;
      spawnGoldBurst(job.x, job.z);
      playSfx('coin');
    }
    playSfx('dig', { minInterval: 40 });
    if (imp) awardXp(imp, XP_PER_DIG);
    // Auto-queue a claim for the newly exposed floor
    queueClaimJob(job.x, job.z);
  } else if (job.type === 'claim') {
    setTile(job.x, job.z, T_CLAIMED);
    stats.tilesClaimed += 1;
    spawnPulse(job.x, job.z, 0xff3018, 0.06, 0.9);
    playSfx('claim', { minInterval: 80 });
    if (imp) awardXp(imp, XP_PER_CLAIM);
    // Newly claimed tile: rock neighbors → reinforce, enemy walls → claim_wall,
    // enemy floors → liberate into neutral floor + queue claim.
    queueBorderJobsAround(job.x, job.z);
  } else if (job.type === 'reinforce') {
    setTile(job.x, job.z, T_REINFORCED);
    stats.wallsReinforced += 1;
    spawnPulse(job.x, job.z, 0xff7028, 1.1, 0.7);
    spawnSparkBurst(job.x, job.z, 0xff8040, 18, 1.0);
    playSfx('reinforce', { minInterval: 100 });
    if (imp) awardXp(imp, XP_PER_DIG);
  } else if (job.type === 'claim_wall') {
    // Enemy wall becomes yours — use your REINFORCED tile type so it looks identical
    // to a wall you fortified from raw rock.
    setTile(job.x, job.z, T_REINFORCED);
    stats.wallsCaptured += 1;
    // Blue pulse/sparks to signal faction conversion (your red ones would look wrong here)
    spawnPulse(job.x, job.z, 0x40a0ff, 1.1, 0.9);
    spawnSparkBurst(job.x, job.z, 0x60c0ff, 22, 1.0);
    playSfx('reinforce', { minInterval: 100 });
    if (imp) awardXp(imp, XP_PER_DIG);
    // Adjacent enemy floor becomes neutral and gets queued for claiming —
    // this is the chain reaction that lets you eat into enemy territory.
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = job.x + dx, nz = job.z + dz;
      if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
      const ncell = grid[nx][nz];
      if (ncell.type === T_ENEMY_FLOOR) {
        setTile(nx, nz, T_FLOOR);
        if (!jobs.some(j => j.x === nx && j.z === nz)) {
          jobs.push({ x: nx, z: nz, type: 'claim', claimedBy: null });
        }
      }
    }
    // Cascade: any enemy wall that's now cut off from its faction defects instantly.
    // This is what makes corner walls fall after their edge neighbors are claimed —
    // without it, corners would stay blue forever, orphaned in your dungeon.
    captureIsolatedEnemyWallsAround(job.x, job.z);
  }
}

export function captureIsolatedEnemyWallsAround(x, z) {
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
    if (grid[nx][nz].type !== T_ENEMY_WALL) continue;
    // Does this wall still connect to its own faction (another enemy wall or enemy floor)?
    let stillConnected = false;
    for (const [ddx, ddz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nnx = nx + ddx, nnz = nz + ddz;
      if (nnx < 0 || nnx >= GRID_SIZE || nnz < 0 || nnz >= GRID_SIZE) continue;
      const t = grid[nnx][nnz].type;
      if (t === T_ENEMY_FLOOR || t === T_ENEMY_WALL) { stillConnected = true; break; }
    }
    if (!stillConnected) {
      // Isolated — it defects
      setTile(nx, nz, T_REINFORCED);
      stats.wallsCaptured += 1;
      spawnPulse(nx, nz, 0x40a0ff, 1.1, 0.7);
      spawnSparkBurst(nx, nz, 0x60c0ff, 14, 1.0);
      // Newly captured wall may have just isolated its own neighbors
      captureIsolatedEnemyWallsAround(nx, nz);
    }
  }
}

// ============================================================
// WORK BEACON — floats above a tile while an imp is actively working it
// ============================================================
// Color-coded per job type so you can tell at a glance what's happening.
export function spawnWorkBeacon(job) {
  const color = BEACON_COLORS[job.type] || 0xffffff;
  const group = new THREE.Group();
  const orb = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.18, 1),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  group.add(orb);
  const halo = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.32, 0),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  );
  group.add(halo);
  const light = new THREE.PointLight(color, 1.8, 4.5, 2);
  group.add(light);
  group.position.set(job.x, 1.7, job.z);
  group.userData = { orb, halo, light, phase: Math.random() * Math.PI * 2 };
  scene.add(group);
  return group;
}

export function removeWorkBeacon(ud) {
  if (!ud.workBeacon) return;
  scene.remove(ud.workBeacon);
  ud.workBeacon.userData.orb.geometry.dispose();
  ud.workBeacon.userData.orb.material.dispose();
  ud.workBeacon.userData.halo.geometry.dispose();
  ud.workBeacon.userData.halo.material.dispose();
  ud.workBeacon = null;
}
