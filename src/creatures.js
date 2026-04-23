// ============================================================
// CREATURES — Flies, spawned from claimed portals, driven by needs
// ============================================================
// A creature wanders, gets hungry → seeks hatchery, gets tired → seeks lair.
// Much lighter than imps: they don't touch the job system, they just care for
// themselves. The player's reward for building more rooms is happier creatures
// (and, later, combat-effective ones).
//
// This module also owns the portal spawn tick and the per-tile hatchery
// regrowth animation (wobbling egg → hatch).

import {
  GRID_SIZE,
  FACTION_PLAYER, ROOM_LAIR, ROOM_HATCHERY,
  T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
  CREATURE_SPEED, CREATURE_WANDER_SPEED,
  PORTAL_SPAWN_INTERVAL, PORTAL_MAX_SPAWN,
  NEED_HUNGER_RATE, NEED_SLEEP_RATE, NEED_CRITICAL, NEED_SATISFIED,
  EAT_DURATION, SLEEP_DURATION, HATCHERY_REGROW,
  CREATURE_HP_FLY, CREATURE_ATK_FLY, CREATURE_ATK_COOLDOWN, CREATURE_ATK_RANGE,
  HERO_SIGHT,
} from './constants.js';
import { grid, creatures, portals, heroes, stats } from './state.js';
import { scene, creatureGroup } from './scene.js';
import {
  FLY_BODY_MAT, FLY_WING_MAT, FLY_EYE_MAT,
  NEED_HUNGER_MAT, NEED_SLEEP_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { findPath, isWalkable } from './pathfinding.js';
import { setLairOccupied } from './rooms.js';
import { createLevelBadge } from './xp.js';
import { takeDamage } from './combat.js';
import { hasSlapBuff, SLAP_SPEED_MUL } from './slap.js';

const THREE = window.THREE;

export function createFly() {
  const group = new THREE.Group();

  // Segmented body: thorax + abdomen
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), FLY_BODY_MAT);
  thorax.position.y = 0.7;
  thorax.castShadow = true;
  group.add(thorax);

  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), FLY_BODY_MAT);
  abdomen.scale.set(1, 0.85, 1.3);
  abdomen.position.set(0, 0.68, -0.18);
  abdomen.castShadow = true;
  group.add(abdomen);

  // Head with compound eyes
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), FLY_BODY_MAT);
  head.position.set(0, 0.72, 0.14);
  head.castShadow = true;
  group.add(head);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), FLY_EYE_MAT);
  eyeL.position.set(-0.055, 0.75, 0.18);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), FLY_EYE_MAT);
  eyeR.position.set(0.055, 0.75, 0.18);
  group.add(eyeR);

  // Wings — twin planes that flap
  const wingGeo = new THREE.PlaneGeometry(0.24, 0.14);
  const wingL = new THREE.Mesh(wingGeo, FLY_WING_MAT);
  wingL.position.set(-0.12, 0.78, -0.05);
  wingL.rotation.y = 0.3;
  group.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, FLY_WING_MAT);
  wingR.position.set(0.12, 0.78, -0.05);
  wingR.rotation.y = -0.3;
  group.add(wingR);

  // Need icon — hidden until critical. Reused geometry across creatures.
  const iconGroup = new THREE.Group();
  iconGroup.position.y = 1.15;
  iconGroup.visible = false;
  const iconBg = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x180808, transparent: true, opacity: 0.6 }));
  iconGroup.add(iconBg);
  // The glyph itself — a child so we can swap material by need type
  const iconGlyph = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), NEED_HUNGER_MAT);
  iconGlyph.rotation.x = Math.PI / 2;
  iconGroup.add(iconGlyph);
  group.add(iconGroup);

  group.userData = {
    state: 'wandering',     // 'wandering' | 'moving' | 'eating' | 'sleeping' | 'fighting'
    faction: FACTION_PLAYER,
    hp: CREATURE_HP_FLY, maxHp: CREATURE_HP_FLY,
    atk: CREATURE_ATK_FLY, atkCooldown: 0, atkRange: CREATURE_ATK_RANGE,
    // Levelling — creatures gain XP by killing heroes
    level: 1, xp: 0,
    fightTarget: null,       // hero entity we're chasing/attacking
    damageFlash: 0,          // seconds of red flash remaining after a hit
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    target: null,           // {x, z, kind: 'eat' | 'sleep'} or wander tile
    lair: null,              // {x, z} — "owned" lair tile if any
    needs: { hunger: 0, sleep: 0 },
    timer: 0,                // countdown for eating/sleeping
    wanderCooldown: 0,       // seconds until next wander target pick
    facing: 0,
    bobPhase: Math.random() * Math.PI * 2,
    wingPhase: 0,
    wingL, wingR, thorax, abdomen, head,
    iconGroup, iconGlyph
  };
  return group;
}

export function spawnCreature(x, z) {
  const c = createFly();
  c.position.set(x, 0, z);
  c.userData.gridX = x;
  c.userData.gridZ = z;
  creatureGroup.add(c);
  creatures.push(c);
  stats.creatures += 1;
  // Birth effect
  spawnPulse(x, z, 0xff6040, 0.5, 1.1);
  spawnSparkBurst(x, z, 0xffa060, 18, 1.0);
  playSfx('spawn', { minInterval: 200 });
  // Level badge floats next to the fly's body
  createLevelBadge(c, 1.15, 0.3);
  return c;
}

// --- Room-finding helpers ---
// Find the nearest claimed-floor tile of a given room type. For hatchery, also
// skip tiles that are currently "depleted" (recently eaten from).
function findNearestRoomTile(fromX, fromZ, roomType, skipDepleted) {
  let best = null, bestLen = Infinity;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = grid[x][z];
      if (cell.roomType !== roomType) continue;
      if (skipDepleted && cell.depletedUntil && cell.depletedUntil > performance.now() / 1000) continue;
      // For lair, skip if owned by another creature
      if (roomType === ROOM_LAIR && cell.lairOwner && cell.lairOwner !== null) continue;
      const p = findPath(fromX, fromZ, x, z);
      if (p && p.length < bestLen) {
        best = { x, z, path: p };
        bestLen = p.length;
      }
    }
  }
  return best;
}

// Pick a random walkable tile within wander radius for idle wandering
function pickWanderTile(fromX, fromZ) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = 2 + Math.floor(Math.random() * 4);
    const ang = Math.random() * Math.PI * 2;
    const x = Math.round(fromX + Math.cos(ang) * r);
    const z = Math.round(fromZ + Math.sin(ang) * r);
    if (!isWalkable(x, z)) continue;
    const p = findPath(fromX, fromZ, x, z);
    if (p) return { x, z, path: p };
  }
  return null;
}

// ============================================================
// CREATURE COMBAT EXTENSION
// ============================================================
// Called at the TOP of updateCreature — if a hero is in range, override any
// current state with 'fighting' and handle the combat logic here.
// Returns true if handled (caller should early-return), false otherwise.
function _creatureCombatTick(c, dt) {
  const ud = c.userData;
  if (ud.state === 'held') return false;
  const slapMul = hasSlapBuff(c) ? SLAP_SPEED_MUL : 1;
  // Buffed creatures cool down faster (same effect as more attacks per second).
  ud.atkCooldown = Math.max(0, ud.atkCooldown - dt * slapMul);

  // Find nearest alive hero within sight
  let nearest = null, nearestD = HERO_SIGHT;
  for (const h of heroes) {
    if (h.userData.hp <= 0) continue;
    const d = Math.hypot(h.position.x - c.position.x, h.position.z - c.position.z);
    if (d < nearestD) { nearestD = d; nearest = h; }
  }

  if (!nearest) {
    if (ud.state === 'fighting') {
      // No target — drop back to wandering
      ud.state = 'wandering';
      ud.fightTarget = null;
      ud.wanderCooldown = 0.3;
    }
    return false;
  }

  ud.fightTarget = nearest;
  ud.state = 'fighting';

  const dx = nearest.position.x - c.position.x;
  const dz = nearest.position.z - c.position.z;
  const d = Math.hypot(dx, dz);
  ud.facing = Math.atan2(dx, dz);

  if (d > ud.atkRange) {
    // Dive toward target
    const sp = 2.6 * slapMul;
    c.position.x += (dx / d) * sp * dt;
    c.position.z += (dz / d) * sp * dt;
    c.position.y = 0.15 + Math.abs(Math.sin(performance.now() * 0.02)) * 0.1;
  } else {
    // In range — attack on cooldown
    if (ud.atkCooldown <= 0) {
      takeDamage(nearest, ud.atk, c);
      ud.atkCooldown = CREATURE_ATK_COOLDOWN;
      // Lunge animation impulse
      ud.timer = 0.15;
    }
  }
  // Turn toward target
  let diff = ud.facing - c.rotation.y;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.rotation.y += diff * Math.min(1, dt * 12);
  // Wing flap on combat
  ud.wingPhase += dt * 70;
  if (ud.wingL) ud.wingL.rotation.z =  0.3 + Math.sin(ud.wingPhase) * 0.9;
  if (ud.wingR) ud.wingR.rotation.z = -0.3 - Math.sin(ud.wingPhase) * 0.9;
  return true;
}

export function updateCreature(c, dt) {
  const ud = c.userData;

  // When held by the Hand, skip AI — but still tick needs so long-held creatures
  // get hungry and give the player tactile feedback about the cost of carrying them.
  if (ud.state === 'held') {
    ud.needs.hunger = Math.min(1, ud.needs.hunger + NEED_HUNGER_RATE * dt);
    ud.needs.sleep  = Math.min(1, ud.needs.sleep  + NEED_SLEEP_RATE  * dt);
    return;
  }

  // COMBAT — if a hero is near, drop everything and fight.
  // Returns true when in fighting state so we skip need/wander AI for this tick.
  if (_creatureCombatTick(c, dt)) return;

  // --- Needs tick up over time regardless of state ---
  if (ud.state !== 'eating')  ud.needs.hunger = Math.min(1, ud.needs.hunger + NEED_HUNGER_RATE * dt);
  if (ud.state !== 'sleeping') ud.needs.sleep  = Math.min(1, ud.needs.sleep  + NEED_SLEEP_RATE  * dt);

  // --- Need-icon display ---
  const hungerCrit = ud.needs.hunger >= NEED_CRITICAL;
  const sleepCrit  = ud.needs.sleep  >= NEED_CRITICAL;
  if (hungerCrit || sleepCrit) {
    ud.iconGroup.visible = true;
    // Show whichever need is higher
    const showSleep = sleepCrit && ud.needs.sleep >= ud.needs.hunger;
    ud.iconGlyph.material = showSleep ? NEED_SLEEP_MAT : NEED_HUNGER_MAT;
    // Float gently
    ud.iconGroup.position.y = 1.15 + Math.sin(performance.now() * 0.004) * 0.04;
    ud.iconGroup.rotation.y += dt * 1.5;
  } else {
    ud.iconGroup.visible = false;
  }

  // --- Wing flap (always, faster when moving) ---
  const flapRate = ud.state === 'moving' ? 55 : 30;
  ud.wingPhase += dt * flapRate;
  ud.wingL.rotation.z = Math.sin(ud.wingPhase) * 0.8;
  ud.wingR.rotation.z = -Math.sin(ud.wingPhase) * 0.8;

  // --- Hover bob (always; taller when moving) ---
  ud.bobPhase += dt * 3;
  const bobAmp = ud.state === 'moving' ? 0.08 : 0.04;
  c.position.y = Math.sin(ud.bobPhase) * bobAmp;

  // --- State machine ---
  if (ud.state === 'wandering' || ud.state === 'moving') {
    // Priority 1: critical need → switch to seeking. Guard against
    // re-targeting a creature already en route to eat/sleep so we don't
    // re-path every frame; the distinction is carried in ud.target.kind.
    const alreadySeeking = ud.state === 'moving' && ud.target &&
      (ud.target.kind === 'eat' || ud.target.kind === 'sleep');
    if (hungerCrit && !alreadySeeking) {
      const t = findNearestRoomTile(ud.gridX, ud.gridZ, ROOM_HATCHERY, true);
      if (t) {
        ud.target = { x: t.x, z: t.z, kind: 'eat' };
        ud.path = t.path;
        ud.pathIdx = 0;
        ud.state = 'moving';
        return;
      }
    }
    if (sleepCrit && !alreadySeeking) {
      // Prefer previously-owned lair, else find a free one
      let t = null;
      if (ud.lair) {
        const p = findPath(ud.gridX, ud.gridZ, ud.lair.x, ud.lair.z);
        if (p) t = { x: ud.lair.x, z: ud.lair.z, path: p };
      }
      if (!t) t = findNearestRoomTile(ud.gridX, ud.gridZ, ROOM_LAIR, false);
      if (t) {
        // Reserve this lair tile — also flip the visual bed to occupied
        if (!grid[t.x][t.z].lairOwner) {
          grid[t.x][t.z].lairOwner = c;
          setLairOccupied(grid[t.x][t.z], true);
        }
        ud.lair = { x: t.x, z: t.z };
        ud.target = { x: t.x, z: t.z, kind: 'sleep' };
        ud.path = t.path;
        ud.pathIdx = 0;
        ud.state = 'moving';
        return;
      }
    }
  }

  if (ud.state === 'wandering') {
    ud.wanderCooldown -= dt;
    if (ud.wanderCooldown <= 0) {
      const t = pickWanderTile(ud.gridX, ud.gridZ);
      if (t) {
        ud.target = { x: t.x, z: t.z, kind: 'wander' };
        ud.path = t.path;
        ud.pathIdx = 0;
        ud.state = 'moving';
      }
      ud.wanderCooldown = 2 + Math.random() * 3;
    }
    return;
  }

  if (ud.state === 'moving') {
    if (!ud.path || ud.pathIdx >= ud.path.length) {
      // Arrived at target
      if (ud.target && ud.target.kind === 'eat') {
        const cell = grid[ud.target.x][ud.target.z];
        // Verify still a hatchery tile and not depleted by another creature
        if (cell.roomType === ROOM_HATCHERY &&
            !(cell.depletedUntil && cell.depletedUntil > performance.now() / 1000)) {
          ud.state = 'eating';
          ud.timer = EAT_DURATION;
        } else {
          ud.state = 'wandering';  // room changed, re-search next tick
        }
      } else if (ud.target && ud.target.kind === 'sleep') {
        const cell = grid[ud.target.x][ud.target.z];
        if (cell.roomType === ROOM_LAIR) {
          ud.state = 'sleeping';
          ud.timer = SLEEP_DURATION;
        } else {
          // Lair was undesignated under us
          if (ud.lair) {
            const lc = grid[ud.lair.x][ud.lair.z];
            if (lc) {
              lc.lairOwner = null;
              if (lc.roomType === ROOM_LAIR) setLairOccupied(lc, false);
            }
            ud.lair = null;
          }
          ud.state = 'wandering';
        }
      } else {
        ud.state = 'wandering';
        ud.wanderCooldown = 1 + Math.random() * 2;
      }
      ud.path = null;
      ud.target = null;
      return;
    }
    const next = ud.path[ud.pathIdx];
    const tx = next.x, tz = next.z;
    const dx = tx - c.position.x, dz = tz - c.position.z;
    const dist = Math.hypot(dx, dz);
    const baseSpeed = (ud.target && ud.target.kind === 'wander') ? CREATURE_WANDER_SPEED : CREATURE_SPEED;
    const speed = baseSpeed * (hasSlapBuff(c) ? SLAP_SPEED_MUL : 1);
    if (dist < 0.08) {
      c.position.x = tx; c.position.z = tz;
      ud.gridX = tx; ud.gridZ = tz;
      ud.pathIdx += 1;
    } else {
      const nx = dx / dist, nz = dz / dist;
      c.position.x += nx * speed * dt;
      c.position.z += nz * speed * dt;
      ud.facing = Math.atan2(nx, nz);
    }
    // Smooth facing
    let diff = ud.facing - c.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.rotation.y += diff * Math.min(1, dt * 8);
    return;
  }

  if (ud.state === 'eating') {
    ud.timer -= dt;
    // Gentle head bob — "pecking"
    ud.head.position.y = 0.72 + Math.sin(performance.now() * 0.01) * 0.03;
    if (ud.timer <= 0) {
      // Deplete this hatchery tile for a while
      const cell = grid[ud.gridX][ud.gridZ];
      if (cell.roomType === ROOM_HATCHERY) {
        cell.depletedUntil = performance.now() / 1000 + HATCHERY_REGROW;
        // Show the egg prop on this tile; the wandering chickens are per-room so
        // we don't hide any specific one — just puff feathers to sell the moment.
        const rm = cell.roomMesh;
        if (rm && rm.userData.egg) {
          rm.userData.egg.visible = true;
          spawnSparkBurst(ud.gridX, ud.gridZ, 0xf0e8d8, 14, 0.8);
        }
      }
      ud.needs.hunger = NEED_SATISFIED;
      ud.state = 'wandering';
      ud.wanderCooldown = 0.5;
      ud.head.position.y = 0.72;
      // Content effect
      spawnPulse(ud.gridX, ud.gridZ, 0x70c050, 0.3, 0.7);
    }
    return;
  }

  if (ud.state === 'sleeping') {
    ud.timer -= dt;
    // Lower to the ground, slow breath, wings still
    c.position.y = 0.02 + Math.abs(Math.sin(performance.now() * 0.002)) * 0.02;
    ud.wingL.rotation.z = 0.1;
    ud.wingR.rotation.z = -0.1;
    if (ud.timer <= 0) {
      ud.needs.sleep = NEED_SATISFIED;
      ud.state = 'wandering';
      ud.wanderCooldown = 0.5;
    }
    return;
  }
}

// Tick the hatchery regrowth — bring depleted tiles back when their timer expires
export function tickHatcheryRegrowth() {
  const now = performance.now() / 1000;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = grid[x][z];
      if (cell.roomType !== ROOM_HATCHERY || !cell.depletedUntil) continue;

      const remaining = cell.depletedUntil - now;
      const rm = cell.roomMesh;
      if (!rm || !rm.userData.egg) continue;
      const egg = rm.userData.egg;

      if (remaining <= 0) {
        // HATCH — egg disappears with a bright pulse and feather burst.
        // Wandering per-room chickens provide the ongoing "life" — no per-tile
        // chicken to restore. The hatch effect is self-contained.
        cell.depletedUntil = null;
        egg.visible = false;
        egg.rotation.set(0, 0, 0);
        if (egg.userData && egg.userData.shell) {
          egg.userData.shell.scale.set(0.9, 1.25, 0.9);
        }
        spawnPulse(x, z, 0xffd060, 0.25, 0.9);
        spawnSparkBurst(x, z, 0xf0e8d8, 20, 1.0);
      } else if (remaining < 1.5) {
        // Hatching animation — egg wobbles rapidly, squashes, then hatches
        const phase = performance.now() * 0.018 + (egg.userData ? egg.userData.basePhase : 0);
        const intensity = 1 - (remaining / 1.5);  // 0..1 as we approach hatch
        egg.rotation.z = Math.sin(phase * 3) * 0.3 * intensity;
        egg.rotation.x = Math.cos(phase * 2.7) * 0.2 * intensity;
        egg.position.y = 0.18 + Math.abs(Math.sin(phase * 2)) * 0.03 * intensity;
      } else {
        // Calm idle wobble — the egg is "breathing"
        const phase = performance.now() * 0.002 + (egg.userData ? egg.userData.basePhase : 0);
        egg.rotation.z = Math.sin(phase) * 0.06;
        egg.position.y = 0.18 + Math.sin(phase * 1.3) * 0.01;
      }
    }
  }
}

// Tick all claimed portals — count down, spawn when timer hits zero
export function tickPortals(dt) {
  for (const portal of portals) {
    if (!portal.claimed) continue;
    if (portal.spawnedCount >= PORTAL_MAX_SPAWN) continue;
    portal.spawnTimer -= dt;
    if (portal.spawnTimer <= 0) {
      spawnCreature(portal.x, portal.z);
      portal.spawnedCount += 1;
      portal.spawnTimer = PORTAL_SPAWN_INTERVAL;
    }
  }
}

// Animate portal swirls every frame (rotation feels alive)
export function animatePortals(t) {
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = grid[x][z];
      if (cell.type !== T_PORTAL_NEUTRAL && cell.type !== T_PORTAL_CLAIMED) continue;
      const m = cell.mesh;
      if (!m || !m.userData.swirl) continue;
      m.userData.swirl.rotation.z = t * 0.9;
      m.userData.swirl2.rotation.z = -t * 1.5;
      // Active (claimed) portals pulse stronger
      const pulseRate = cell.type === T_PORTAL_CLAIMED ? 3.5 : 1.8;
      const pulseAmp  = cell.type === T_PORTAL_CLAIMED ? 0.6 : 0.25;
      m.userData.portalLight.intensity = 1.0 + Math.sin(t * pulseRate) * pulseAmp;
    }
  }
}
