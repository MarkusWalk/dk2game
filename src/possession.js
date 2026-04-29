// ============================================================
// POSSESSION — first-person ride along a player creature
// ============================================================
// Hop into a creature's head: WASD moves it, mouse turns its facing, Space
// triggers a melee swing at the closest hero, Escape (or its death) ends.
// While possessed:
//   - Normal creature AI is suspended (state='possessed').
//   - Camera switches from iso ortho to a perspective camera at eye-level.
//   - Pointer is locked so mouse delta steers the creature's yaw.
//   - HUD overlay (#possessHud) is shown; toolbar etc. stay visible underneath.
//
// Exits restore the iso camera state captured on entry.

import {
  POSSESS_CAM_HEIGHT, POSSESS_CAM_FORWARD,
  POSSESS_MOVE_SPEED, POSSESS_TURN_SPEED, POSSESS_ATTACK_RANGE,
  FACTION_PLAYER,
} from './constants.js';
import { possession, cameraControls, heroes, sim } from './state.js';
import { cameraRef } from './camera-controls.js';
import { renderer, scene, sun } from './scene.js';
import { takeDamage } from './combat.js';
import { spawnSparkBurst, spawnPulse } from './effects.js';
import { playSfx } from './audio.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

// Held movement keys while possessed. Independent of camKeys so the iso
// camera doesn't move when the player WASDs the creature.
const possKeys = new Set();

// Saved iso camera so we can rebuild it on exit.
let _savedCam = null;

// Aspect-aware perspective camera, recreated on resize.
function _makePerspectiveCam() {
  const cam = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.05, 200
  );
  return cam;
}
let _persCam = null;

function _showHud(show) {
  const el = document.getElementById('possessHud');
  if (el) el.classList.toggle('hidden', !show);
}

// Pointer-lock helpers — use the renderer canvas so movements over the toolbar
// don't leak into the game.
function _requestPointerLock() {
  const el = renderer.domElement;
  if (el.requestPointerLock) el.requestPointerLock();
}
function _exitPointerLock() {
  if (document.exitPointerLock) document.exitPointerLock();
}

export function isPossessing() {
  return possession.active;
}
export function possessedTarget() {
  return possession.active ? possession.target : null;
}

// Begin possession. The caller (spells.js) verifies the target is a player
// creature; we only check liveness here. Returns true on success.
export function beginPossession(target) {
  if (!target || !target.userData || target.userData.hp <= 0) return false;
  if (target.userData.faction !== FACTION_PLAYER) return false;
  if (possession.active) endPossession();

  possession.active = true;
  possession.target = target;
  possession.yaw = target.userData.facing || 0;
  possession.attackCooldown = 0;
  // Suspend AI by setting a state nothing else recognizes; updateCreature
  // checks for 'possessed' and short-circuits.
  target.userData._prevState = target.userData.state;
  target.userData.state = 'possessed';
  target.userData.path = null;
  target.userData.target = null;

  // Snapshot iso camera so exit can restore it.
  _savedCam = {
    yaw: cameraControls.yaw,
    distance: cameraControls.distance,
    height: cameraControls.height,
    zoomMul: cameraControls.zoomMul,
    targetX: cameraControls.target.x,
    targetZ: cameraControls.target.z,
  };

  // Swap to perspective camera.
  if (!_persCam) _persCam = _makePerspectiveCam();
  cameraRef.camera = _persCam;

  _showHud(true);
  _requestPointerLock();
  spawnPulse(target.position.x, target.position.z, 0xa060ff, 0.5, 1.6);
  spawnSparkBurst(target.position.x, target.position.z, 0xc080ff, 28, 1.4);
  playSfx('whoosh', { minInterval: 100 });
  pushEvent('Possessed ' + (target.userData.species || 'creature'));
  return true;
}

export function endPossession() {
  if (!possession.active) return;
  const t = possession.target;
  if (t && t.userData) {
    // Resume AI from a fresh wandering state — the saved _prevState may be stale.
    t.userData.state = 'wandering';
    t.userData.wanderCooldown = 0.4;
    delete t.userData._prevState;
  }
  possession.active = false;
  possession.target = null;
  possKeys.clear();

  // Restore iso camera state + rebuild ortho camera.
  if (_savedCam) {
    cameraControls.yaw = _savedCam.yaw;
    cameraControls.distance = _savedCam.distance;
    cameraControls.height = _savedCam.height;
    cameraControls.zoomMul = _savedCam.zoomMul;
    cameraControls.target.x = _savedCam.targetX;
    cameraControls.target.z = _savedCam.targetZ;
    _savedCam = null;
  }
  // makeCamera() lives in camera-controls; instead of importing it (cycle),
  // dispatch a hint via cameraRef and let the next frame's tickCamera pick up.
  // Simpler: dynamically import.
  import('./camera-controls.js').then(m => {
    cameraRef.camera = m.makeCamera();
    m.updateCameraProjection();
  });

  _showHud(false);
  _exitPointerLock();
}

// ============================================================
// INPUT HANDLERS
// ============================================================
// Installed once at boot. Keys are gated on isPossessing() so they're inert
// outside possession mode and don't conflict with camera/build keys.
export function installPossessionInput() {
  window.addEventListener('keydown', (ev) => {
    if (!possession.active) return;
    const k = ev.key.toLowerCase();
    if (k === 'escape') {
      endPossession();
      ev.preventDefault();
      ev.stopPropagation();   // beat input.js's "drop + reset to dig" handler
      return;
    }
    if (['w','a','s','d',' '].includes(k)) {
      possKeys.add(k);
      ev.preventDefault();
      // Prevent camera-control keydown handler from also acting on WASD.
      ev.stopPropagation();
    }
  }, true /* capture so we beat camera-controls.js */);
  window.addEventListener('keyup', (ev) => {
    if (!possession.active) return;
    const k = ev.key.toLowerCase();
    possKeys.delete(k);
  }, true);
  window.addEventListener('blur', () => possKeys.clear());

  // Mouse-look while pointer is locked.
  window.addEventListener('mousemove', (ev) => {
    if (!possession.active) return;
    if (document.pointerLockElement !== renderer.domElement) return;
    possession.yaw -= ev.movementX * 0.0025;
  });

  // Pointer-lock loss → soft-exit (e.g., user hit Esc browser-side).
  document.addEventListener('pointerlockchange', () => {
    if (possession.active && document.pointerLockElement !== renderer.domElement) {
      endPossession();
    }
  });
}

// ============================================================
// PER-FRAME TICK
// ============================================================
export function tickPossession(dt) {
  if (!possession.active) return;
  const t = possession.target;
  if (!t || !t.userData || t.userData.hp <= 0) {
    endPossession();
    return;
  }
  const ud = t.userData;
  // If something else stole state (e.g. hand pickup), end possession to keep
  // the ride consistent — better than a half-controlled levitating mount.
  if (ud.state !== 'possessed') {
    endPossession();
    return;
  }

  // Yaw: also accept Q/E as keyboard turn for non-pointer-lock users.
  if (possKeys.has('q')) possession.yaw += POSSESS_TURN_SPEED * dt;
  if (possKeys.has('e')) possession.yaw -= POSSESS_TURN_SPEED * dt;

  // Move vector in creature-local space: forward = -z, strafe = +x.
  let mf = 0, mr = 0;
  if (possKeys.has('w')) mf += 1;
  if (possKeys.has('s')) mf -= 1;
  if (possKeys.has('a')) mr -= 1;
  if (possKeys.has('d')) mr += 1;
  const len = Math.hypot(mf, mr);
  if (len > 0) {
    mf /= len; mr /= len;
    const cos = Math.cos(possession.yaw), sin = Math.sin(possession.yaw);
    // Map (mf, mr) by yaw: forward direction in XZ where yaw=0 looks toward -Z.
    const dx = sin * mf + cos * mr;
    const dz = cos * mf - sin * mr;
    const sp = POSSESS_MOVE_SPEED;
    t.position.x += dx * sp * dt;
    t.position.z += dz * sp * dt;
    ud.gridX = Math.round(t.position.x);
    ud.gridZ = Math.round(t.position.z);
  }
  // Update facing so the model points where you look.
  t.rotation.y = possession.yaw;
  ud.facing = possession.yaw;

  // Attack on Space — single-target swing at the closest hero in front.
  possession.attackCooldown = Math.max(0, possession.attackCooldown - dt);
  if (possKeys.has(' ') && possession.attackCooldown <= 0) {
    const fx = Math.sin(possession.yaw), fz = Math.cos(possession.yaw);
    let best = null, bestD = POSSESS_ATTACK_RANGE;
    for (const h of heroes) {
      if (!h.userData || h.userData.hp <= 0) continue;
      const dx = h.position.x - t.position.x;
      const dz = h.position.z - t.position.z;
      // Only count enemies within a forward 120° cone.
      const dist = Math.hypot(dx, dz);
      if (dist > bestD) continue;
      const dotFwd = (dx * fx + dz * fz) / Math.max(0.01, dist);
      if (dotFwd < 0.3) continue;
      bestD = dist; best = h;
    }
    const dmg = ud.atk || 5;
    if (best) {
      takeDamage(best, dmg, t);
      spawnSparkBurst(best.position.x, best.position.z, 0xffe080, 14, 0.9);
      playSfx('strike_special', { minInterval: 80 });
    } else {
      // Whiff still costs the swing animation slot.
      playSfx('swing', { minInterval: 80 });
    }
    possession.attackCooldown = (ud.baseAtkCooldown || 0.7);
  }

  // Camera follow: eye-level, slightly behind the model so the creature is
  // visible at the bottom of the frame (third-person-cam feel keeps the
  // possessed avatar legible vs. pure first-person).
  const cam = cameraRef.camera;
  const fx = Math.sin(possession.yaw), fz = Math.cos(possession.yaw);
  cam.position.set(
    t.position.x - fx * POSSESS_CAM_FORWARD,
    POSSESS_CAM_HEIGHT,
    t.position.z - fz * POSSESS_CAM_FORWARD
  );
  cam.lookAt(t.position.x + fx * 4, POSSESS_CAM_HEIGHT - 0.1, t.position.z + fz * 4);

  // Move sun light with the player so shadows stay populated.
  sun.position.set(t.position.x + 15, 30, t.position.z + 15);
  sun.target.position.set(t.position.x, 0, t.position.z);

  // Track sim-time so cooldowns derived from sim.time still tick when needed.
  void sim;
  void scene;
}

export function onPossessionResize() {
  if (!_persCam) return;
  _persCam.aspect = window.innerWidth / window.innerHeight;
  _persCam.updateProjectionMatrix();
}
