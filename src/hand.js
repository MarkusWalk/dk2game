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

import { HEART_X, HEART_Z, ROOM_LAIR, ROOM_PRISON, ROOM_TORTURE, T_PORTAL_CLAIMED } from './constants.js';
import { imps, grid, handState, buildModeRef } from './state.js';
import { scene } from './scene.js';
import { HAND_GLOW_MAT, DROP_RING_GEO, DROP_RING_MAT } from './materials.js';
import { setLairOccupied } from './rooms.js';
import { isWalkable } from './pathfinding.js';
import { removeWorkBeacon } from './jobs.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { startCreatureLeaving } from './creatures.js';
import { reanchorPrisoner, isPrisoner } from './prisoners.js';
import { playSfx } from './audio.js';
import { pushEvent } from './hud.js';

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

export function setDropIndicatorPos(x, z, valid, dismissTarget) {
  const d = ensureDropIndicator();
  d.visible = true;
  d.position.set(x, 0.08, z);
  // Tint:
  //   - purple = drop-on-portal kick-out target (creature only)
  //   - orange = valid drop tile
  //   - red    = invalid (not walkable)
  let color = 0xff4030;
  if (dismissTarget) color = 0xa060ff;
  else if (valid)    color = 0xffd88c;
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
  ud.isPrisoner = isPrisoner(entity);

  // Prisoners (captured heroes) skip both the imp + creature branches — they
  // have no jobs and no lairs. Their cage assignment is preserved by hand.js
  // drop logic so the conversion timer resumes cleanly.
  if (ud.isPrisoner) {
    ud.state = 'held';
    ud.path = null;
    ud.heldPhase = 0;
    if (!ud.handGlow) {
      ud.handGlow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 1), HAND_GLOW_MAT.clone());
      ud.handGlow.material.opacity = 0.25;
      ud.handGlow.position.y = 0.4;
      entity.add(ud.handGlow);
    }
    ud.handGlow.visible = true;
    spawnPulse(Math.round(entity.position.x), Math.round(entity.position.z), 0xffd88c, 0.4, 0.6);
    return;
  }

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

  // Prisoner re-anchor: dropping a captured hero on a prison or torture tile
  // re-seats them. A prison drop just keeps them on starve duty; a torture
  // drop flips them into the conversion-to-vampire timer. Falls through to
  // normal drop if not a prison/torture cell.
  if (atTile && isPrisoner(entity)) {
    const cell = grid[atTile.x] && grid[atTile.x][atTile.z];
    if (cell && (cell.roomType === ROOM_PRISON || cell.roomType === ROOM_TORTURE)) {
      const ok = reanchorPrisoner(entity, atTile.x, atTile.z);
      if (ok) {
        entity.position.y = 0.1;
        if (ud.handGlow) ud.handGlow.visible = false;
        ud.state = (cell.roomType === ROOM_TORTURE) ? 'tortured' : 'imprisoned';
        handState.heldEntity = null;
        hideDropIndicator();
        spawnPulse(atTile.x, atTile.z, cell.roomType === ROOM_TORTURE ? 0xff4040 : 0x9098b0, 0.3, 1.2);
        return;
      }
    }
    // No valid anchor — refuse the drop, snap back to current cage.
    if (ud.cageX != null) {
      entity.position.set(ud.cageX, 0.1, ud.cageZ);
      ud.gridX = ud.cageX; ud.gridZ = ud.cageZ;
    }
    if (ud.handGlow) ud.handGlow.visible = false;
    handState.heldEntity = null;
    hideDropIndicator();
    return;
  }

  // Kick-out: dropping a creature (not an imp) on a CLAIMED portal banishes it
  // through the swirl. Imps are exempt — they are essential workforce.
  if (atTile && !ud.isImp) {
    const cell = grid[atTile.x] && grid[atTile.x][atTile.z];
    if (cell && cell.type === T_PORTAL_CLAIMED) {
      // Snap to portal center for the dissolve animation.
      entity.position.x = atTile.x;
      entity.position.z = atTile.z;
      entity.position.y = 0.3;
      ud.gridX = atTile.x;
      ud.gridZ = atTile.z;
      if (ud.handGlow) ud.handGlow.visible = false;
      handState.heldEntity = null;
      hideDropIndicator();
      spawnPulse(atTile.x, atTile.z, 0xa060ff, 0.35, 1.4);
      spawnSparkBurst(atTile.x, atTile.z, 0xc080ff, 26, 1.3);
      playSfx('portal_dismiss');
      pushEvent(`${(ud.species || 'Creature')} sent away`);
      startCreatureLeaving(entity);
      return;
    }
  }

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

// ============================================================
// SKELETAL HAND VISUAL — the "Hand of Evil" rendered as a 3D mesh
// ============================================================
// A ghostly bone-white hand floats above the tile under the cursor while in
// hand mode. It opens (fingers extended) when nothing is held and clutches
// shut (fingers curled toward the palm) when carrying an entity. Built lazily
// the first time hand mode is entered so the cost only lands if the player
// uses it.

const _BONE_MAT = new THREE.MeshStandardMaterial({
  color: 0xe8e4d8, roughness: 0.65,
  emissive: 0x80a0c0, emissiveIntensity: 0.5,
  transparent: true, opacity: 0.9,
});
const _WISP_MAT = new THREE.MeshBasicMaterial({
  color: 0xa0c0ff, transparent: true, opacity: 0.35,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

// Build one finger as a 3-segment chain pivoting at the base joint, so a
// single rotation curls the whole finger toward the palm convincingly.
function _buildFinger(length, radius) {
  const root = new THREE.Group();
  const segLen = length / 3;
  let parent = root;
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    const r = radius * (1 - i * 0.18);
    const bone = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 0.85, segLen * 0.92, 6),
      _BONE_MAT,
    );
    bone.rotation.x = Math.PI / 2;
    bone.position.z = segLen / 2;
    pivot.add(bone);
    const knuckle = new THREE.Mesh(new THREE.SphereGeometry(r * 1.15, 6, 5), _BONE_MAT);
    pivot.add(knuckle);
    parent.add(pivot);
    // Each subsequent pivot lives at the tip of the previous segment so a
    // small rotation at every joint compounds into a believable curl.
    pivot.userData.segLen = segLen;
    pivot.userData.isFingerJoint = true;
    parent = new THREE.Group();
    parent.position.z = segLen;
    pivot.add(parent);
  }
  return root;
}

function _buildSkeletalHand() {
  const g = new THREE.Group();

  // Palm — flattened oval of bone, the "anchor" the fingers hang off of.
  const palm = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.18, 0.55),
    _BONE_MAT,
  );
  palm.position.y = 0;
  g.add(palm);

  // Wrist nub poking up out of the back of the hand — sells "no body, just a hand".
  const wrist = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.45, 8),
    _BONE_MAT,
  );
  wrist.position.set(0, 0.28, -0.34);
  wrist.rotation.x = -0.4;
  g.add(wrist);

  // Wisp halo — a translucent outer shell that gives the ghostly look without
  // requiring shaders. Sized slightly larger than the palm.
  const wisp = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 8),
    _WISP_MAT,
  );
  wisp.scale.set(1.6, 0.7, 1.4);
  wisp.position.y = 0.05;
  g.add(wisp);

  // Four fingers across the front edge of the palm.
  const fingers = [];
  const fingerOffsets = [-0.32, -0.11, 0.10, 0.31];
  const fingerLengths = [0.42, 0.50, 0.48, 0.40];
  for (let i = 0; i < 4; i++) {
    const finger = _buildFinger(fingerLengths[i], 0.06);
    finger.position.set(fingerOffsets[i], 0, 0.27);
    g.add(finger);
    fingers.push(finger);
  }

  // Thumb — angled out from the side of the palm and shorter.
  const thumb = _buildFinger(0.34, 0.07);
  thumb.position.set(-0.42, 0, 0.05);
  thumb.rotation.y = 0.9;
  g.add(thumb);

  // Faint inner light so the hand reads in dim corridors.
  const glow = new THREE.PointLight(0xa0c0ff, 0.7, 2.5, 2);
  glow.position.y = 0.4;
  g.add(glow);

  g.userData = { fingers, thumb, wisp, glow, curl: 0, bobPhase: 0 };
  return g;
}

function _ensureSkeletalHand() {
  if (handState.skeletalHand) return handState.skeletalHand;
  const h = _buildSkeletalHand();
  h.visible = false;
  scene.add(h);
  handState.skeletalHand = h;
  return h;
}

// Apply a curl factor (0 = open, 1 = full clutch) to every finger joint.
// Each segment rotates a fraction of the total so the fingers bend at every
// knuckle, not just the base — that's what makes it read as a "grab" instead
// of a stiff swing.
function _setFingerCurl(finger, curl) {
  let pivot = finger.children[0];
  const perJoint = curl * 0.85;
  for (let i = 0; i < 3 && pivot; i++) {
    if (pivot.userData && pivot.userData.isFingerJoint) {
      pivot.rotation.x = perJoint;
    }
    // Walk down the parent→child chain set up in _buildFinger.
    const next = pivot.children.find(c => !c.userData || !c.userData.isFingerJoint);
    pivot = next ? next.children[0] : null;
  }
}

export function tickHand(dt, t) {
  // Lazy-build the first time hand mode is active. Avoids a few hundred
  // verts of geometry for players who never use the hand.
  const inHandMode = buildModeRef.value === 'hand';
  if (!inHandMode && !handState.skeletalHand) return;
  const h = _ensureSkeletalHand();
  h.visible = inHandMode;
  if (!inHandMode) return;

  const ud = h.userData;
  // Smoothly chase the cursor's grid tile. If we don't have one yet (cursor
  // off-canvas, fresh mode-switch) park it above the heart so it isn't sitting
  // at the world origin.
  const tile = handState.handPointerTile;
  const targetX = tile ? tile.x : HEART_X;
  const targetZ = tile ? tile.z : HEART_Z;
  const dx = targetX - h.position.x, dz = targetZ - h.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.01) {
    const step = Math.min(dist, dt * 18);
    h.position.x += (dx / dist) * step;
    h.position.z += (dz / dist) * step;
  }
  // Hover at ~2.0 above ground with a gentle bob; if carrying, pull down a
  // little so the held entity (which floats at y=1.2) reads as being clutched
  // by the fingers rather than dangling below an empty palm.
  ud.bobPhase += dt * 1.6;
  const carrying = !!handState.heldEntity;
  const baseY = carrying ? 1.6 : 2.0;
  h.position.y = baseY + Math.sin(ud.bobPhase) * 0.08;

  // Smoothly drive the curl toward target — open when empty, clutched when carrying.
  const targetCurl = carrying ? 1.0 : 0.0;
  ud.curl += (targetCurl - ud.curl) * Math.min(1, dt * 8);
  for (const f of ud.fingers) _setFingerCurl(f, ud.curl);
  _setFingerCurl(ud.thumb, ud.curl * 0.7);

  // Pulse the wisp + light slightly so the hand visibly breathes.
  const pulse = 0.9 + Math.sin(ud.bobPhase * 1.7) * 0.1;
  ud.wisp.scale.set(1.6 * pulse, 0.7 * pulse, 1.4 * pulse);
  ud.glow.intensity = 0.55 + Math.sin(ud.bobPhase * 2.3) * 0.2;

  // Slow yaw so the hand always looks "alive" even if the cursor is still.
  h.rotation.y = Math.sin((t || 0) * 0.4) * 0.18;
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
    // Show drop indicator on the target tile. If hovering a CLAIMED portal
    // with a creature in hand → flag as kick-out target (purple ring).
    const cell = grid[tx] && grid[tx][tz];
    const isPortalDismiss = !!(cell && cell.type === T_PORTAL_CLAIMED && !ud.isImp);
    const valid = isWalkable(tx, tz) || resolveDropTile(tx, tz) !== null;
    setDropIndicatorPos(tx, tz, valid, isPortalDismiss);
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
