// ============================================================
// HERO MODEL + SPAWNING + AI + WAVES + BOSS
// ============================================================
// Knights march on the heart via A*. They engage any creature/imp within
// sight and attack it. When adjacent to the heart, they bash it.
// The Knight Commander (boss) appears on FINAL_WAVE — scaled-up knight with
// red plume, cape, gold trim, and rebalanced stats.

import {
  GRID_SIZE, FINAL_WAVE,
  FACTION_HERO, T_PORTAL_NEUTRAL, HEART_X, HEART_Z,
  HERO_HP_KNIGHT, HERO_ATK_KNIGHT, HERO_SPEED, HERO_ATK_RANGE,
  HERO_ATK_COOLDOWN, HERO_ATK_HEART, HERO_SIGHT,
  BOSS_HP, BOSS_ATK, BOSS_ATK_HEART, BOSS_SPEED,
  BOSS_ATK_COOLDOWN, BOSS_ATK_RANGE, BOSS_SIGHT,
  WAVE_INTERVAL_BASE, WAVE_WARN_LEAD,
} from './constants.js';
import { heroes, invasion, GAME, creatures, imps, grid, heartRef } from './state.js';
import { scene } from './scene.js';
import {
  HERO_ARMOR_MAT, HERO_CLOTH_MAT, HERO_SKIN_MAT,
  HERO_SWORD_MAT, HERO_HILT_MAT, HERO_SHIELD_MAT, HERO_SHIELD_TRIM_MAT,
  HP_BAR_FILL_HERO_MAT, HP_BAR_FILL_BOSS_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { findPath, isWalkable } from './pathfinding.js';
import { createHpBar, takeDamage } from './combat.js';
import { showWaveWarning, showWaveBanner, showBossBanner } from './heart.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

export function createHero() {
  const g = new THREE.Group();
  // Legs (cloth)
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.22), HERO_CLOTH_MAT);
  legs.position.y = 0.32;
  legs.castShadow = true;
  g.add(legs);
  // Chest — armored
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.36, 0.26), HERO_ARMOR_MAT);
  chest.position.y = 0.66;
  chest.castShadow = true;
  g.add(chest);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), HERO_SKIN_MAT);
  head.position.y = 0.95;
  head.castShadow = true;
  g.add(head);
  // Helmet cap
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.1), HERO_ARMOR_MAT);
  helmet.position.y = 0.95;
  g.add(helmet);
  const helmBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 10), HERO_ARMOR_MAT);
  helmBrim.position.y = 0.92;
  g.add(helmBrim);
  // Right arm + sword
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), HERO_ARMOR_MAT);
  armR.position.set(0.24, 0.65, 0);
  armR.castShadow = true;
  g.add(armR);
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.24, 0.48, 0);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), HERO_HILT_MAT);
  hilt.position.y = 0.05;
  swordPivot.add(hilt);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.04), HERO_HILT_MAT);
  guard.position.y = 0.11;
  swordPivot.add(guard);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.02), HERO_SWORD_MAT);
  blade.position.y = 0.32;
  blade.castShadow = true;
  swordPivot.add(blade);
  g.add(swordPivot);
  // Left arm + shield
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), HERO_ARMOR_MAT);
  armL.position.set(-0.24, 0.65, 0);
  armL.castShadow = true;
  g.add(armL);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.26), HERO_SHIELD_MAT);
  shield.position.set(-0.32, 0.62, 0);
  shield.castShadow = true;
  g.add(shield);
  const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), HERO_SHIELD_TRIM_MAT);
  shieldBoss.position.set(-0.35, 0.62, 0);
  g.add(shieldBoss);
  const shieldCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.28, 0.04), HERO_SHIELD_TRIM_MAT);
  shieldCrossV.position.set(-0.32, 0.62, 0);
  g.add(shieldCrossV);
  const shieldCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.05, 0.22), HERO_SHIELD_TRIM_MAT);
  shieldCrossH.position.set(-0.32, 0.65, 0);
  g.add(shieldCrossH);

  g.userData = {
    state: 'marching',       // 'marching' | 'fighting' | 'attacking_heart'
    faction: FACTION_HERO,
    hp: HERO_HP_KNIGHT, maxHp: HERO_HP_KNIGHT,
    atk: HERO_ATK_KNIGHT, atkCooldown: 0, atkRange: HERO_ATK_RANGE,
    // Tunables read by updateHero — boss overrides these in createBoss
    speed: HERO_SPEED,
    sight: HERO_SIGHT,
    atkHeartDps: HERO_ATK_HEART,
    atkCooldownTime: HERO_ATK_COOLDOWN,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    repathCooldown: 0,
    fightTarget: null,
    chestBody: chest, head, armR, swordPivot,
    walkPhase: Math.random() * Math.PI * 2,
    swingPhase: 0,
    facing: 0
  };
  // Always-visible HP bar for heroes (telegraphs threat)
  createHpBar(g, 1.35, 0.5, HP_BAR_FILL_HERO_MAT, false);
  return g;
}

export function spawnHero(x, z) {
  const h = createHero();
  h.position.set(x, 0, z);
  h.userData.gridX = x;
  h.userData.gridZ = z;
  scene.add(h);
  heroes.push(h);
  spawnPulse(x, z, 0xff4040, 0.5, 1.2);
  spawnSparkBurst(x, z, 0xff6060, 20, 1.1);
  return h;
}

// ---------- KNIGHT COMMANDER (boss) ----------
// Scaled-up knight with red plume, cape, gold trim, bigger sword + shield.
// All AI tunables live in userData so updateHero handles him without special cases.
// Killing him ends the game with a victory state.
export function createBoss() {
  const g = new THREE.Group();
  // Dedicated materials so per-boss damage flash / tints don't bleed into regular knights
  const bossArmor = new THREE.MeshStandardMaterial({
    color: 0x40454e, roughness: 0.4, metalness: 0.85, flatShading: true
  });
  const bossTrim = new THREE.MeshStandardMaterial({
    color: 0xd0a040, metalness: 0.95, roughness: 0.25,
    emissive: 0x503000, emissiveIntensity: 0.35
  });
  const bossCloth = new THREE.MeshStandardMaterial({
    color: 0x801a24, roughness: 0.9, flatShading: true
  });
  const bossCape = new THREE.MeshStandardMaterial({
    color: 0x8a1020, roughness: 0.85,
    emissive: 0x200404, emissiveIntensity: 0.15,
    flatShading: true, side: THREE.DoubleSide
  });
  const bossSword = new THREE.MeshStandardMaterial({
    color: 0xf0f0f8, emissive: 0x606080, emissiveIntensity: 0.6,
    metalness: 0.95, roughness: 0.15
  });
  // Legs (cloth) — bigger than knight
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.44, 0.3), bossCloth);
  legs.position.y = 0.42; legs.castShadow = true;
  g.add(legs);
  // Chest — armored
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.48, 0.36), bossArmor);
  chest.position.y = 0.88; chest.castShadow = true;
  g.add(chest);
  // Gold chest trim belt
  const trimBelt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.06, 0.38), bossTrim);
  trimBelt.position.y = 0.65; g.add(trimBelt);
  // Shoulder pads
  for (const sx of [-0.32, 0.32]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), bossArmor);
    pad.position.set(sx, 1.08, 0);
    pad.rotation.x = Math.PI;
    pad.castShadow = true;
    g.add(pad);
  }
  // Head (skin)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), HERO_SKIN_MAT);
  head.position.y = 1.22; head.castShadow = true;
  g.add(head);
  // Helmet cap with visor line
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.1),
    bossArmor
  );
  helmet.position.y = 1.22;
  g.add(helmet);
  const helmBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 10), bossTrim);
  helmBrim.position.y = 1.18;
  g.add(helmBrim);
  // Red plume — fan of 3 cones sprouting from top of helmet
  for (let i = 0; i < 3; i++) {
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.3, 5), bossCloth);
    plume.position.set(0, 1.48 + i * 0.02, -0.05);
    plume.rotation.z = (i - 1) * 0.18;
    plume.rotation.x = -0.25;
    g.add(plume);
  }
  // Cape — plane attached to back, slight forward tilt
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95), bossCape);
  cape.position.set(0, 0.72, -0.21);
  cape.rotation.x = 0.12;
  cape.castShadow = true;
  g.add(cape);
  // Right arm
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.13), bossArmor);
  armR.position.set(0.33, 0.86, 0);
  armR.castShadow = true;
  g.add(armR);
  // Sword (longer, glowing edge)
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.33, 0.62, 0);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 6), HERO_HILT_MAT);
  hilt.position.y = 0.08;
  swordPivot.add(hilt);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.06), bossTrim);
  guard.position.y = 0.17;
  swordPivot.add(guard);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.025), bossSword);
  blade.position.y = 0.5;
  blade.castShadow = true;
  swordPivot.add(blade);
  g.add(swordPivot);
  // Left arm
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.13), bossArmor);
  armL.position.set(-0.33, 0.86, 0);
  armL.castShadow = true;
  g.add(armL);
  // Large tower shield
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.42), bossCloth);
  shield.position.set(-0.44, 0.82, 0);
  shield.castShadow = true;
  g.add(shield);
  const shieldBoss = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), bossTrim);
  shieldBoss.position.set(-0.48, 0.82, 0);
  g.add(shieldBoss);
  const shieldCrossV = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.48, 0.055), bossTrim);
  shieldCrossV.position.set(-0.44, 0.82, 0);
  g.add(shieldCrossV);
  const shieldCrossH = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.055, 0.36), bossTrim);
  shieldCrossH.position.set(-0.44, 0.86, 0);
  g.add(shieldCrossH);

  g.userData = {
    state: 'marching',
    faction: FACTION_HERO,
    isBoss: true,
    hp: BOSS_HP, maxHp: BOSS_HP,
    atk: BOSS_ATK, atkCooldown: 0, atkRange: BOSS_ATK_RANGE,
    speed: BOSS_SPEED,
    sight: BOSS_SIGHT,
    atkHeartDps: BOSS_ATK_HEART,
    atkCooldownTime: BOSS_ATK_COOLDOWN,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    repathCooldown: 0,
    fightTarget: null,
    chestBody: chest, head, armR, swordPivot,
    walkPhase: Math.random() * Math.PI * 2,
    swingPhase: 0,
    facing: 0,
  };
  // In-world HP bar — wider to read as a boss
  createHpBar(g, 1.9, 0.95, HP_BAR_FILL_BOSS_MAT, false);
  return g;
}

export function spawnBoss(x, z) {
  const b = createBoss();
  b.position.set(x, 0, z);
  b.userData.gridX = x;
  b.userData.gridZ = z;
  scene.add(b);
  heroes.push(b);
  invasion.boss = b;
  // Dramatic entrance
  spawnPulse(x, z, 0x801030, 0.8, 2.0);
  spawnSparkBurst(x, z, 0xff3040, 40, 1.5);
  spawnSparkBurst(x, z, 0xd0a040, 20, 1.8);
  return b;
}

export function spawnBossWave() {
  const anchor = findHeroSpawnTile();
  if (!anchor) return;
  spawnBoss(anchor.x, anchor.z);
  // Two escort knights flanking the commander
  spawnHero(anchor.x + 0.6, anchor.z + 0.1);
  spawnHero(anchor.x - 0.6, anchor.z - 0.1);
  // Stop the wave timer — the game ends one way or the other from here
  invasion.nextWaveAt = Infinity;
  showBossBanner();
  playSfx('alarm');
  pushEvent('The Knight Commander has arrived');
}

// Pick a spawn tile for a hero party.
// Strategy: BFS from the heart through walkable tiles; spawn at the FARTHEST
// tile reachable (prefer unclaimed-portal tiles if available for thematic flavor).
// This guarantees the spawn is actually connected to the heart and gives the
// player the maximum lead time to react to the invasion.
export function findHeroSpawnTile() {
  const dist = new Map();
  const q = [{ x: HEART_X, z: HEART_Z, d: 0 }];
  dist.set(HEART_X + ',' + HEART_Z, 0);
  let head = 0;
  let farthest = { x: HEART_X, z: HEART_Z, d: 0 };
  let bestPortal = null;
  while (head < q.length) {
    const cur = q[head++];
    // Track farthest walkable tile seen
    if (cur.d > farthest.d) farthest = cur;
    const cellType = grid[cur.x][cur.z].type;
    if (cellType === T_PORTAL_NEUTRAL && (!bestPortal || cur.d > bestPortal.d)) {
      bestPortal = cur;
    }
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) continue;
      const k = nx + ',' + nz;
      if (dist.has(k)) continue;
      if (!isWalkable(nx, nz)) continue;
      dist.set(k, cur.d + 1);
      q.push({ x: nx, z: nz, d: cur.d + 1 });
    }
  }
  // Prefer a neutral portal as the thematic vector
  if (bestPortal && bestPortal.d > 3) return { x: bestPortal.x, z: bestPortal.z };
  if (farthest.d >= 5) return { x: farthest.x, z: farthest.z };
  return null;
}

// ============================================================
// HERO AI
// ============================================================
// Each hero marches toward the heart via A*. They interrupt the march when:
//   - A creature is within HERO_SIGHT → engage it
//   - They reach the heart → attack it in place
// Path is recomputed every second or when blocked.

export function updateHero(h, dt) {
  if (GAME.over) return;
  const heart = heartRef.heart;
  const ud = h.userData;
  ud.atkCooldown = Math.max(0, ud.atkCooldown - dt);
  ud.repathCooldown -= dt;
  ud.swingPhase = Math.max(0, ud.swingPhase - dt * 3);

  // Grid-align tracking for pathing convenience
  const gx = Math.round(h.position.x);
  const gz = Math.round(h.position.z);
  ud.gridX = gx; ud.gridZ = gz;

  // --- Target selection ---
  // Find nearest live creature / imp within sight. Skip held entities — they're
  // not on the battlefield (floating with the Hand of Keeper).
  let closest = null, closestD = ud.sight;
  const scan = (list) => {
    for (const c of list) {
      if (!c.userData || c.userData.hp <= 0) continue;
      if (c.userData.state === 'held') continue;
      const d = Math.hypot(c.position.x - h.position.x, c.position.z - h.position.z);
      if (d < closestD) { closestD = d; closest = c; }
    }
  };
  scan(creatures);
  scan(imps);
  ud.fightTarget = closest;

  // --- Decide action by priority: enemy in range > adjacent to heart > march ---
  if (ud.fightTarget) {
    // Move toward target if out of range; else attack
    const tgt = ud.fightTarget;
    const dx = tgt.position.x - h.position.x;
    const dz = tgt.position.z - h.position.z;
    const d = Math.hypot(dx, dz);
    ud.facing = Math.atan2(dx, dz);
    if (d > ud.atkRange) {
      _heroMoveToward(h, tgt.position.x, tgt.position.z, dt);
      ud.state = 'fighting';
    } else {
      ud.state = 'fighting';
      if (ud.atkCooldown <= 0) {
        takeDamage(tgt, ud.atk, h);
        ud.atkCooldown = ud.atkCooldownTime;
        ud.swingPhase = 1;
      }
    }
    _heroTurnTowardFacing(h, dt);
    _heroAnimate(h, dt, true);
    return;
  }

  // Near heart?
  const dHeart = Math.hypot(h.position.x - HEART_X, h.position.z - HEART_Z);
  const heartReach = ud.isBoss ? 1.6 : 1.3;   // boss has longer reach
  if (dHeart < heartReach) {
    ud.state = 'attacking_heart';
    ud.facing = Math.atan2(HEART_X - h.position.x, HEART_Z - h.position.z);
    _heroTurnTowardFacing(h, dt);
    takeDamage(heart, ud.atkHeartDps * dt, h);
    heart.userData.shakeUntil = performance.now() / 1000 + 0.2;
    ud.swingPhase = 1;
    _heroAnimate(h, dt, true);
    return;
  }

  // March toward heart
  ud.state = 'marching';
  if (!ud.path || ud.pathIdx >= (ud.path ? ud.path.length : 0) || ud.repathCooldown <= 0) {
    const p = findPath(gx, gz, HEART_X, HEART_Z);
    if (p) { ud.path = p; ud.pathIdx = 0; }
    ud.repathCooldown = 1.0 + Math.random() * 0.5;
  }
  if (ud.path && ud.pathIdx < ud.path.length) {
    const next = ud.path[ud.pathIdx];
    const dx = next.x - h.position.x;
    const dz = next.z - h.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.12) {
      ud.pathIdx++;
    } else {
      ud.facing = Math.atan2(dx, dz);
      h.position.x += (dx / d) * ud.speed * dt;
      h.position.z += (dz / d) * ud.speed * dt;
    }
  }
  _heroTurnTowardFacing(h, dt);
  _heroAnimate(h, dt, false);
}

function _heroMoveToward(h, tx, tz, dt) {
  const dx = tx - h.position.x;
  const dz = tz - h.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  const sp = (h.userData.speed || HERO_SPEED) * 0.9;
  h.position.x += (dx / d) * sp * dt;
  h.position.z += (dz / d) * sp * dt;
}
function _heroTurnTowardFacing(h, dt) {
  let diff = h.userData.facing - h.rotation.y;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  h.rotation.y += diff * Math.min(1, dt * 10);
}
function _heroAnimate(h, dt, fighting) {
  const ud = h.userData;
  if (fighting) {
    // Sword swing — pivot rotates back then forward
    const s = ud.swingPhase;
    if (ud.swordPivot) {
      ud.swordPivot.rotation.x = -s * 1.2;
      ud.swordPivot.rotation.z = Math.sin(s * Math.PI) * 0.3;
    }
    h.position.y = 0;
  } else {
    ud.walkPhase += dt * 7;
    if (ud.swordPivot) ud.swordPivot.rotation.x = Math.sin(ud.walkPhase) * 0.15;
    h.position.y = Math.abs(Math.sin(ud.walkPhase)) * 0.04;
  }
}

// ============================================================
// WAVES
// ============================================================
// Every WAVE_INTERVAL seconds, spawn a party of N heroes. Wave N has
// ~floor(N/2)+1 heroes to ramp difficulty, capped reasonably.
export function tickWaves(dt, t) {
  if (GAME.over) return;
  // Arm warning band
  if (invasion.nextWaveAt - t < WAVE_WARN_LEAD && invasion.nextWaveAt > t && !invasion.warnShown) {
    invasion.warnShown = true;
    invasion.warnUntil = t + WAVE_WARN_LEAD + 1.5;
    showWaveWarning();
  }
  if (t >= invasion.nextWaveAt) {
    spawnWave();
    invasion.warnShown = false;
    invasion.nextWaveAt = t + WAVE_INTERVAL_BASE + invasion.waveNumber * 3;
  }
}

function spawnWave() {
  invasion.waveNumber++;
  if (invasion.waveNumber >= FINAL_WAVE) {
    spawnBossWave();
    return;
  }
  // Wave 1-2: 1 hero (tutorial). Wave 3-4: 2. Wave 5-6: 3. Wave 7-8: 4. Cap at 5.
  const n = Math.min(5, 1 + Math.floor((invasion.waveNumber - 1) / 2));
  const anchor = findHeroSpawnTile();
  if (!anchor) return;
  for (let i = 0; i < n; i++) {
    // Slight offset so they don't stack
    const ox = (i % 2) * 0.4 - 0.2;
    const oz = Math.floor(i / 2) * 0.4 - 0.2;
    spawnHero(anchor.x + ox, anchor.z + oz);
  }
  showWaveBanner(invasion.waveNumber, n);
  pushEvent(`Wave ${invasion.waveNumber} — ${n} hero${n === 1 ? '' : 'es'} incoming`);
}
