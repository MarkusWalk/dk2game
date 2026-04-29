// ============================================================
// IMP MODEL + AI + RESPAWN
// ============================================================
// Imp = player's workforce. Pickaxe, glowing eyes, carried gold nugget.
// States: idle → moving → working → (seeking_treasury → hauling) → idle.
// The respawn system trickles in fresh imps at heart cost IMP_SPAWN_MANA_COST
// whenever the count drops below IMP_MIN_COUNT, so the game can't stall — but
// it stalls if mana runs dry, so over-claiming becomes the way out of trouble.

import {
  IMP_HP, IMP_SPEED, IMP_SPAWN_MANA_COST, IMP_SPAWN_DELAY, IMP_MIN_COUNT,
  FACTION_PLAYER, WORK_DURATIONS,
  HEART_X, HEART_Z,
} from './constants.js';
import {
  imps, stats, GAME, impRespawn,
} from './state.js';
import { scene, impGroup } from './scene.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { isWalkable } from './pathfinding.js';
import {
  claimJob, completeJob, spawnWorkBeacon, removeWorkBeacon,
  isJobStillValid,
} from './jobs.js';
import { findNearestTreasury, depositGold } from './treasury.js';
import { createLevelBadge } from './xp.js';
import { hasSlapBuff, SLAP_SPEED_MUL } from './slap.js';

const THREE = window.THREE;

export function createImp() {
  const group = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x8a4a2a, roughness: 0.85, flatShading: true
  });
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x3a1808, roughness: 0.9
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xffee44, emissive: 0xffaa11, emissiveIntensity: 3
  });

  // Body (squashed sphere)
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), skinMat);
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.22;
  body.castShadow = true;
  group.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skinMat);
  head.position.y = 0.5;
  head.position.z = 0.02;
  head.castShadow = true;
  group.add(head);

  // Pointy ears
  const earGeo = new THREE.ConeGeometry(0.06, 0.18, 4);
  const earL = new THREE.Mesh(earGeo, skinMat);
  earL.position.set(-0.13, 0.6, -0.02);
  earL.rotation.z = 0.5; earL.rotation.x = -0.2;
  group.add(earL);
  const earR = new THREE.Mesh(earGeo, skinMat);
  earR.position.set(0.13, 0.6, -0.02);
  earR.rotation.z = -0.5; earR.rotation.x = -0.2;
  group.add(earR);

  // Glowing eyes
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
  eyeL.position.set(-0.07, 0.5, 0.15);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), eyeMat);
  eyeR.position.set(0.07, 0.5, 0.15);
  group.add(eyeR);

  // Loincloth (small dark band)
  const cloth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.22, 0.1, 8),
    darkMat
  );
  cloth.position.y = 0.15;
  group.add(cloth);

  // Arms — tiny side nubs
  const armGeo = new THREE.SphereGeometry(0.08, 6, 5);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.22, 0.28, 0);
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set(0.22, 0.28, 0);
  armR.castShadow = true;
  group.add(armR);

  // Pickaxe (always carried)
  const pickShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.35, 5),
    new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.9 })
  );
  const pickHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.7 })
  );
  pickHead.position.y = 0.17;
  const pickGroup = new THREE.Group();
  pickGroup.add(pickShaft);
  pickGroup.add(pickHead);
  pickGroup.position.set(0.28, 0.3, 0);
  pickGroup.rotation.z = -0.4;
  group.add(pickGroup);

  // Carried gold nugget (hidden until imp picks up gold)
  const carriedGold = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.13, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffcc44, emissive: 0xffaa22, emissiveIntensity: 1.6,
      metalness: 0.8, roughness: 0.25, flatShading: true
    })
  );
  carriedGold.position.set(0, 0.78, -0.05);
  carriedGold.visible = false;
  carriedGold.castShadow = true;
  group.add(carriedGold);

  group.userData = {
    state: 'idle',
    faction: FACTION_PLAYER,
    hp: IMP_HP, maxHp: IMP_HP,
    damageFlash: 0,
    // Levelling — imps gain XP by working and scale HP + work speed
    level: 1, xp: 0, workMultiplier: 1,
    gridX: 0, gridZ: 0,
    path: [],
    pathIdx: 0,
    job: null,
    workTimer: 0,
    bobPhase: Math.random() * Math.PI * 2,
    walkPhase: 0,
    body, head, pickGroup, armL, armR,
    carrying: 0,
    targetTreasury: null,
    carriedGold,
    facing: 0
  };
  return group;
}

export function spawnImp(x, z) {
  const imp = createImp();
  imp.position.set(x, 0, z);
  imp.userData.gridX = x;
  imp.userData.gridZ = z;
  impGroup.add(imp);
  imps.push(imp);
  // Level badge above-right of the imp's head
  createLevelBadge(imp, 1.25, 0.32);
  return imp;
}

export function updateImp(imp, dt) {
  const ud = imp.userData;

  // If picked up by the Hand of Keeper, ignore all AI this frame — position is
  // driven by updateHeldEntity instead.
  if (ud.state === 'held') return;

  // Slap buff is a flat speed multiplier for both movement and work.
  const slapMul = hasSlapBuff(imp) ? SLAP_SPEED_MUL : 1;

  if (ud.state === 'idle') {
    const claim = claimJob(imp);
    if (claim) {
      ud.job = claim.job;
      ud.path = claim.path;
      ud.pathIdx = 0;
      ud.state = 'moving';
    } else {
      // Idle bob + occasional random wander within claimed area
      ud.bobPhase += dt * 2;
      imp.position.y = Math.abs(Math.sin(ud.bobPhase)) * 0.02;
    }
  }

  if (ud.state === 'moving') {
    // reached end of path?
    if (ud.pathIdx >= ud.path.length) {
      ud.state = 'working';
      ud.workTimer = WORK_DURATIONS[ud.job.type] || 1.5;
      ud.workBeacon = spawnWorkBeacon(ud.job);
      if (ud.job.type === 'claim') {
        // Imp is standing ON the tile; no meaningful facing — keep current
        ud.facing = imp.rotation.y;
      } else {
        // Face the target rock/wall
        const dx = ud.job.x - ud.gridX;
        const dz = ud.job.z - ud.gridZ;
        ud.facing = Math.atan2(dx, dz);
      }
      return;
    }

    const next = ud.path[ud.pathIdx];
    const tx = next.x, tz = next.z;
    const curX = imp.position.x, curZ = imp.position.z;
    const dx = tx - curX, dz = tz - curZ;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.06) {
      imp.position.x = tx;
      imp.position.z = tz;
      ud.gridX = tx;
      ud.gridZ = tz;
      ud.pathIdx += 1;
    } else {
      const nx = dx / dist, nz = dz / dist;
      imp.position.x += nx * IMP_SPEED * slapMul * dt;
      imp.position.z += nz * IMP_SPEED * slapMul * dt;
      // face direction (smoothed)
      const targetFace = Math.atan2(nx, nz);
      ud.facing = targetFace;
      // walk bob
      ud.walkPhase += dt * 12;
      imp.position.y = Math.abs(Math.sin(ud.walkPhase)) * 0.06;
      // arm swing
      ud.armL.position.z = Math.sin(ud.walkPhase) * 0.04;
      ud.armR.position.z = -Math.sin(ud.walkPhase) * 0.04;
    }
    // smooth rotation
    const curFace = imp.rotation.y;
    let diff = ud.facing - curFace;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    imp.rotation.y += diff * Math.min(1, dt * 10);
  }

  if (ud.state === 'working') {
    // Validity guard: the target tile may have changed (e.g. another imp finished it, or user re-marked)
    if (!ud.job || !isJobStillValid(ud.job)) {
      removeWorkBeacon(ud);
      ud.state = 'idle';
      ud.job = null;
      ud.pickGroup.rotation.z = -0.4;
      return;
    }
    ud.workTimer -= dt * (ud.workMultiplier || 1) * slapMul;

    // Pulse the beacon above the tile
    if (ud.workBeacon) {
      const bud = ud.workBeacon.userData;
      bud.phase += dt * 4;
      const s = 1 + Math.sin(bud.phase) * 0.18;
      bud.orb.scale.setScalar(s);
      bud.halo.scale.setScalar(1 + Math.sin(bud.phase + 0.5) * 0.3);
      bud.light.intensity = 1.5 + Math.sin(bud.phase) * 0.6;
      ud.workBeacon.position.y = 1.7 + Math.sin(bud.phase * 0.5) * 0.08;
    }

    const jt = ud.job.type;
    const now = performance.now();
    if (jt === 'dig') {
      // Full pickaxe swing
      const swing = Math.sin(now * 0.018);
      ud.pickGroup.rotation.z = -0.4 + swing * 0.9;
      imp.position.y = Math.abs(Math.sin(now * 0.018)) * 0.05;
    } else if (jt === 'reinforce') {
      // Channeling pose — pickaxe held high, body rocking; clearly different from digging
      ud.pickGroup.rotation.z = -1.5;
      const channel = Math.sin(now * 0.008);
      imp.position.y = 0.04 + Math.abs(channel) * 0.04;
      ud.armL.position.z = channel * 0.05;
      ud.armR.position.z = -channel * 0.05;
    } else if (jt === 'claim') {
      // Pickaxe held aloft; gentle arm sway
      ud.pickGroup.rotation.z = -1.3;
      const sway = Math.sin(now * 0.006) * 0.04;
      imp.position.y = 0.02 + Math.abs(sway);
      ud.armL.position.z = sway;
      ud.armR.position.z = -sway;
    }
    imp.rotation.y = ud.facing;

    if (ud.workTimer <= 0) {
      completeJob(ud.job, imp);
      removeWorkBeacon(ud);
      ud.job = null;
      ud.pickGroup.rotation.z = -0.4;
      ud.armL.position.z = 0;
      ud.armR.position.z = 0;
      if (ud.carrying > 0) {
        ud.state = 'seeking_treasury';
      } else {
        ud.state = 'idle';
      }
    }
  }

  if (ud.state === 'seeking_treasury') {
    const best = findNearestTreasury(imp);
    if (best) {
      ud.targetTreasury = best.treasury;
      ud.path = best.path;
      ud.pathIdx = 0;
      ud.state = 'hauling';
    } else {
      // No reachable treasury — fallback: absorb into total so progress isn't lost
      stats.goldTotal += ud.carrying;
      ud.carrying = 0;
      ud.carriedGold.visible = false;
      ud.state = 'idle';
    }
  }

  if (ud.state === 'hauling') {
    if (ud.pathIdx >= ud.path.length) {
      // Arrived adjacent to pile — face it and deposit
      const dx = ud.targetTreasury.x - ud.gridX;
      const dz = ud.targetTreasury.z - ud.gridZ;
      imp.rotation.y = Math.atan2(dx, dz);
      depositGold(imp, ud.targetTreasury);
      ud.targetTreasury = null;
      ud.state = 'idle';
      return;
    }
    const next = ud.path[ud.pathIdx];
    const tx = next.x, tz = next.z;
    const curX = imp.position.x, curZ = imp.position.z;
    const dx = tx - curX, dz = tz - curZ;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.06) {
      imp.position.x = tx;
      imp.position.z = tz;
      ud.gridX = tx;
      ud.gridZ = tz;
      ud.pathIdx += 1;
    } else {
      const nx = dx / dist, nz = dz / dist;
      // Imp is a bit slower while carrying gold
      imp.position.x += nx * IMP_SPEED * 0.75 * slapMul * dt;
      imp.position.z += nz * IMP_SPEED * 0.75 * slapMul * dt;
      ud.facing = Math.atan2(nx, nz);
      ud.walkPhase += dt * 10;
      imp.position.y = Math.abs(Math.sin(ud.walkPhase)) * 0.05;
      ud.armL.position.z = Math.sin(ud.walkPhase) * 0.03;
      ud.armR.position.z = -Math.sin(ud.walkPhase) * 0.03;
    }
    // smooth rotation
    const curFace = imp.rotation.y;
    let diff = ud.facing - curFace;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    imp.rotation.y += diff * Math.min(1, dt * 10);
    // gold nugget spins while being carried
    ud.carriedGold.rotation.y += dt * 2.5;
    ud.carriedGold.position.y = 0.78 + Math.sin(ud.walkPhase) * 0.02;
  }
}

// ============================================================
// IMP RESPAWN — keep a minimum workforce so the game can't stall
// ============================================================
// If imps die faster than they respawn, digging stops and the dungeon can't
// recover. This system maintains a minimum imp count, trickling in new ones
// at the heart as long as the player has mana. Respawns aren't free, so
// losing imps still stings — but the cost is paid from the magical economy
// (mana = claimed area), not from gold (which now buys rooms).

export function tickImpRespawn(dt) {
  if (GAME.over) return;
  if (imps.length >= IMP_MIN_COUNT) { impRespawn.timer = 0; return; }
  if (stats.mana < IMP_SPAWN_MANA_COST) { impRespawn.timer = 0; return; }
  impRespawn.timer += dt;
  if (impRespawn.timer >= IMP_SPAWN_DELAY) {
    impRespawn.timer = 0;
    const pos = _findImpSpawnTile();
    if (!pos) return;
    stats.mana -= IMP_SPAWN_MANA_COST;
    spawnImp(pos.x, pos.z);
    spawnPulse(pos.x, pos.z, 0xff6040, 0.4, 1.1);
    spawnSparkBurst(pos.x, pos.z, 0xffa060, 16, 0.9);
    playSfx('spawn', { minInterval: 200 });
  }
}
function _findImpSpawnTile() {
  // Prefer tiles adjacent to heart (walkable). Fall back to any walkable tile nearby.
  const offsets = [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1],
                   [2,0],[-2,0],[0,2],[0,-2]];
  for (const [dx, dz] of offsets) {
    const x = HEART_X + dx, z = HEART_Z + dz;
    if (isWalkable(x, z)) return { x, z };
  }
  return null;
}
