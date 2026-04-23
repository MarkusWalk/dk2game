// ============================================================
// HAND OF KEEPER
// ============================================================
// The "hand" is the player's direct agency tool. In Hand mode:
//   - Tap an imp or creature → pick it up (entity levitates + glows, follows cursor)
//   - Tap a tile → drop held entity there (if walkable)
//   - Tap another entity while holding → drop current, pick up new (swap)
//   - Leaving hand mode or pressing Escape drops whatever's held.
//
// While held, the entity's normal AI is suspended. On drop, imps return to 'idle'
// (they'll pick up a new job); creatures return to 'wandering' (they'll re-evaluate needs).

import { HEART_X, HEART_Z, ROOM_LAIR } from './constants.js';
import { imps, grid, handState } from './state.js';
import { scene } from './scene.js';
import { HAND_GLOW_MAT, DROP_RING_GEO, DROP_RING_MAT } from './materials.js';
import { setLairOccupied } from './rooms.js';
import { isWalkable } from './pathfinding.js';
import { removeWorkBeacon } from './jobs.js';
import { spawnPulse } from './effects.js';

const THREE = window.THREE;

export function ensureDropIndicator() {
  if (handState.dropIndicator) return handState.dropIndicator;
  const ring = new THREE.Mesh(DROP_RING_GEO, DROP_RING_MAT);
  ring.rotation.x = -Math.PI / 2;
  const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), HAND_GLOW_MAT);
  const g = new THREE.Group();
  g.add(ring);
  g.add(glow);
  g.userData = { ring, glow, phase: 0 };
  scene.add(g);
  handState.dropIndicator = g;
  return g;
}

export function setDropIndicatorPos(x, z, valid) {
  const d = ensureDropIndicator();
  d.visible = true;
  d.position.set(x, 0.08, z);
  // Tint red when the target tile is invalid (not walkable)
  const color = valid ? 0xffd88c : 0xff4030;
  d.userData.ring.material.color.setHex(color);
  d.userData.glow.material.color.setHex(color);
}
export function hideDropIndicator() {
  if (handState.dropIndicator) handState.dropIndicator.visible = false;
}

export function pickUpEntity(entity) {
  if (handState.heldEntity) dropHeld();  // swap semantics
  handState.heldEntity = entity;
  const ud = entity.userData;
  // Save original classification so we know how to restore state on drop
  ud.isImp = imps.includes(entity);
  ud.wasHeld = true;

  // Cancel any in-progress work / job ownership (imps only) so other imps can claim it
  if (ud.isImp) {
    if (ud.job) {
      ud.job.claimedBy = null;
      ud.job = null;
    }
    removeWorkBeacon(ud);
    // Reset limbs to rest pose
    if (ud.pickGroup) ud.pickGroup.rotation.z = -0.4;
    if (ud.armL) ud.armL.position.z = 0;
    if (ud.armR) ud.armR.position.z = 0;
  } else {
    // Creatures: release a reserved lair tile if we had one; we'll re-reserve on drop
    if (ud.lair) {
      const cell = grid[ud.lair.x] && grid[ud.lair.x][ud.lair.z];
      if (cell && cell.lairOwner === entity) {
        cell.lairOwner = null;
        if (cell.roomType === ROOM_LAIR) setLairOccupied(cell, false);
      }
      // Keep ud.lair so the creature remembers its preferred bed
    }
  }

  ud.state = 'held';
  ud.path = null;
  ud.pathIdx = 0;
  ud.target = null;
  ud.heldPhase = 0;
  // Visual lift — the entity rises off the ground with a glow
  if (!ud.handGlow) {
    ud.handGlow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), HAND_GLOW_MAT.clone());
    ud.handGlow.material.opacity = 0.25;
    ud.handGlow.position.y = 0.4;
    entity.add(ud.handGlow);
  }
  ud.handGlow.visible = true;
  spawnPulse(Math.round(entity.position.x), Math.round(entity.position.z), 0xffd88c, 0.4, 0.6);
}

// Find the best drop tile: if the requested tile is walkable, use it; else search
// outward for the nearest walkable cell within a small radius. Returns {x, z} or null.
export function resolveDropTile(x, z) {
  if (isWalkable(x, z)) return { x, z };
  for (let r = 1; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;  // only the ring
        const nx = x + dx, nz = z + dz;
        if (isWalkable(nx, nz)) return { x: nx, z: nz };
      }
    }
  }
  return null;
}

export function dropHeld(atTile) {
  if (!handState.heldEntity) return;
  const entity = handState.heldEntity;
  const ud = entity.userData;

  let target = atTile ? resolveDropTile(atTile.x, atTile.z) : null;
  // Fall back to entity's current grid pos, then to the heart
  if (!target) target = resolveDropTile(ud.gridX, ud.gridZ);
  if (!target) target = { x: HEART_X, z: HEART_Z };

  // Teleport
  entity.position.x = target.x;
  entity.position.z = target.z;
  // Imps land on the floor; creatures start near ground and bob back up on their own.
  entity.position.y = ud.isImp ? 0 : 0.3;
  ud.gridX = target.x;
  ud.gridZ = target.z;

  // Hide the glow
  if (ud.handGlow) ud.handGlow.visible = false;

  // Restore AI state — start fresh rather than resuming interrupted work
  if (ud.isImp) {
    ud.state = 'idle';
  } else {
    ud.state = 'wandering';
    ud.wanderCooldown = 0.5;
  }

  // Landing effect
  spawnPulse(target.x, target.z, 0xffd88c, 0.1, 0.7);

  handState.heldEntity = null;
  hideDropIndicator();
}

// Called every frame while something is held — makes the entity follow the cursor
export function updateHeldEntity(dt) {
  if (!handState.heldEntity) return;
  const heldEntity = handState.heldEntity;
  const ud = heldEntity.userData;
  ud.heldPhase = (ud.heldPhase || 0) + dt * 3;
  // Hover target: the last pointer tile we have. If none (e.g. cursor off-canvas),
  // stay where we are.
  if (handState.handPointerTile) {
    const tx = handState.handPointerTile.x, tz = handState.handPointerTile.z;
    // Smoothly chase the pointer
    const dx = tx - heldEntity.position.x, dz = tz - heldEntity.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.02) {
      const step = Math.min(dist, dt * 12);
      heldEntity.position.x += (dx / dist) * step;
      heldEntity.position.z += (dz / dist) * step;
    }
    // Show drop indicator on the target tile
    const valid = isWalkable(tx, tz) || resolveDropTile(tx, tz) !== null;
    setDropIndicatorPos(tx, tz, valid);
  }
  // Levitate with a gentle bob
  heldEntity.position.y = 1.2 + Math.sin(ud.heldPhase) * 0.12;
  // Spin slowly so the player sees they're carrying something alive
  heldEntity.rotation.y += dt * 1.2;
  // Pulse the halo
  if (ud.handGlow) {
    const s = 1 + Math.sin(ud.heldPhase * 1.8) * 0.15;
    ud.handGlow.scale.setScalar(s);
    ud.handGlow.material.opacity = 0.25 + Math.sin(ud.heldPhase * 1.8) * 0.1;
  }
}
