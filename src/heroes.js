// ============================================================
// HERO MODEL + SPAWNING + AI + WAVES + BOSS
// ============================================================
// Knights march on the heart via A*. They engage any creature/imp within
// sight and attack it. When adjacent to the heart, they bash it.
// The Knight Commander (boss) appears on FINAL_WAVE — scaled-up knight with
// red plume, cape, gold trim, and rebalanced stats.

import {
  GRID_SIZE, FINAL_WAVE,
  FACTION_HERO, T_PORTAL_NEUTRAL, T_ENEMY_FLOOR, T_ENEMY_WALL, HEART_X, HEART_Z,
  HERO_HP_KNIGHT, HERO_ATK_KNIGHT, HERO_SPEED, HERO_ATK_RANGE,
  HERO_ATK_COOLDOWN, HERO_ATK_HEART, HERO_SIGHT,
  HERO_HP_ARCHER, HERO_ATK_ARCHER, HERO_RANGE_ARCHER,
  HERO_HP_PRIEST, HERO_ATK_PRIEST, HERO_HEAL_PRIEST, HERO_HEAL_RADIUS_PRIEST,
  HERO_HP_DWARF, HERO_ATK_DWARF, HERO_SPEED_DWARF,
  BOSS_HP, BOSS_ATK, BOSS_ATK_HEART, BOSS_SPEED,
  BOSS_ATK_COOLDOWN, BOSS_ATK_RANGE, BOSS_SIGHT,
  WAVE_INTERVAL_BASE, WAVE_WARN_LEAD, WAVE_TABLES,
  HERO_TERRITORY_RADIUS, HERO_LAIRS,
  ROOM_TREASURY,
} from './constants.js';
import { heroes, invasion, GAME, creatures, imps, grid, heartRef, treasuries, stats } from './state.js';
import { setTile } from './tiles.js';
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
import { doorAt, damageDoor } from './doors.js';

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

// ============================================================
// HERO VARIANTS — Archer, Priest, Dwarf
// ============================================================
// Shared silhouette language with the Knight (legs/chest/head/arms) but with
// distinct props + materials so each reads at a glance. Each keeps the same
// userData shape as Knight so updateHero handles them without special cases
// (except role flags: isArcher / isPriest / isDwarf drive behavior tweaks).

export function createArcher() {
  const g = new THREE.Group();
  // Body — more leather tones, no heavy plate
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.2), HERO_CLOTH_MAT);
  legs.position.y = 0.3;
  legs.castShadow = true;
  g.add(legs);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.22), HERO_CLOTH_MAT);
  chest.position.y = 0.6;
  chest.castShadow = true;
  g.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), HERO_SKIN_MAT);
  head.position.y = 0.88;
  head.castShadow = true;
  g.add(head);
  // Hood — green-tinted fabric
  const hoodMat = new THREE.MeshStandardMaterial({
    color: 0x2a4028, roughness: 0.85, flatShading: true
  });
  hoodMat.userData = { perInstance: true };
  const hood = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    hoodMat
  );
  hood.position.y = 0.88;
  g.add(hood);
  // Arms
  const armGeo = new THREE.BoxGeometry(0.08, 0.28, 0.08);
  const armL = new THREE.Mesh(armGeo, HERO_CLOTH_MAT);
  armL.position.set(-0.2, 0.6, 0);
  g.add(armL);
  const armR = new THREE.Mesh(armGeo, HERO_CLOTH_MAT);
  armR.position.set(0.2, 0.6, 0);
  g.add(armR);
  // Bow — a curved arc in the left hand
  const bowPivot = new THREE.Group();
  bowPivot.position.set(-0.25, 0.55, 0);
  const bowMat = new THREE.MeshStandardMaterial({
    color: 0x3a2418, roughness: 0.85, flatShading: true
  });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.015, 5, 10, Math.PI), bowMat);
  bow.rotation.set(0, 0, Math.PI / 2);
  bowPivot.add(bow);
  // String
  const stringMat = new THREE.LineBasicMaterial({ color: 0xe0e0d0 });
  const stringGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -0.24, 0), new THREE.Vector3(0, 0.24, 0),
  ]);
  const bowString = new THREE.Line(stringGeo, stringMat);
  bowPivot.add(bowString);
  g.add(bowPivot);
  // Quiver on back
  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 6), bowMat);
  quiver.position.set(-0.08, 0.78, -0.13);
  quiver.rotation.x = 0.4;
  g.add(quiver);

  g.userData = {
    state: 'marching',
    faction: FACTION_HERO,
    isArcher: true,
    hp: HERO_HP_ARCHER, maxHp: HERO_HP_ARCHER,
    atk: HERO_ATK_ARCHER, atkCooldown: 0, atkRange: HERO_RANGE_ARCHER,
    speed: HERO_SPEED * 1.05,
    sight: HERO_RANGE_ARCHER,
    atkHeartDps: HERO_ATK_HEART * 0.6,
    atkCooldownTime: HERO_ATK_COOLDOWN * 1.1,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    repathCooldown: 0,
    fightTarget: null,
    chestBody: chest, head, armR,
    walkPhase: Math.random() * Math.PI * 2,
    swingPhase: 0,
    facing: 0,
    bowPivot,
  };
  createHpBar(g, 1.3, 0.45, HP_BAR_FILL_HERO_MAT, false);
  return g;
}

export function createPriest() {
  const g = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({
    color: 0xe4d0a4, roughness: 0.85, flatShading: true,
    emissive: 0x201808, emissiveIntensity: 0.15
  });
  robeMat.userData = { perInstance: true };
  // Long robe (cone reads like flowing cloth)
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.74, 8), robeMat);
  robe.position.y = 0.37;
  robe.castShadow = true;
  g.add(robe);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.22), robeMat);
  chest.position.y = 0.7;
  chest.castShadow = true;
  g.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), HERO_SKIN_MAT);
  head.position.y = 0.95;
  g.add(head);
  // Halo — warm ring above
  const haloMat = new THREE.MeshStandardMaterial({
    color: 0xffe890, emissive: 0xffb040, emissiveIntensity: 1.6,
    transparent: true, opacity: 0.85
  });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 16), haloMat);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 1.15;
  g.add(halo);
  // Staff with glowing tip
  const staffMat = new THREE.MeshStandardMaterial({
    color: 0x3a2414, roughness: 0.85
  });
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), staffMat);
  staff.position.set(0.22, 0.6, 0);
  staff.rotation.z = -0.08;
  g.add(staff);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), haloMat);
  orb.position.set(0.25, 1.05, 0);
  g.add(orb);
  const healLight = new THREE.PointLight(0xffd090, 0.7, 2.5, 2);
  healLight.position.set(0, 0.6, 0);
  g.add(healLight);

  g.userData = {
    state: 'marching',
    faction: FACTION_HERO,
    isPriest: true,
    hp: HERO_HP_PRIEST, maxHp: HERO_HP_PRIEST,
    atk: HERO_ATK_PRIEST, atkCooldown: 0, atkRange: 1.1,
    speed: HERO_SPEED * 0.95,
    sight: HERO_SIGHT,
    atkHeartDps: HERO_ATK_HEART * 0.3,
    atkCooldownTime: HERO_ATK_COOLDOWN * 1.4,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    repathCooldown: 0,
    fightTarget: null,
    chestBody: chest, head,
    walkPhase: Math.random() * Math.PI * 2,
    swingPhase: 0,
    facing: 0,
    halo, orb, healLight,
  };
  createHpBar(g, 1.45, 0.48, HP_BAR_FILL_HERO_MAT, false);
  return g;
}

export function createDwarf() {
  const g = new THREE.Group();
  const dwarfArmorMat = new THREE.MeshStandardMaterial({
    color: 0x7a6848, roughness: 0.5, metalness: 0.6, flatShading: true
  });
  dwarfArmorMat.userData = { perInstance: true };
  const beardMat = new THREE.MeshStandardMaterial({
    color: 0xc84820, roughness: 0.85, flatShading: true
  });
  beardMat.userData = { perInstance: true };
  // Squat body
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.26), HERO_CLOTH_MAT);
  legs.position.y = 0.22;
  legs.castShadow = true;
  g.add(legs);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.32), dwarfArmorMat);
  chest.position.y = 0.54;
  chest.castShadow = true;
  g.add(chest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), HERO_SKIN_MAT);
  head.position.y = 0.82;
  g.add(head);
  // Huge beard
  const beard = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 6), beardMat);
  beard.position.set(0, 0.68, 0.1);
  beard.rotation.x = Math.PI;
  g.add(beard);
  // Horned helm
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.1),
    dwarfArmorMat
  );
  helm.position.y = 0.82;
  g.add(helm);
  for (const hx of [-0.16, 0.16]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 5), dwarfArmorMat);
    horn.position.set(hx, 0.92, 0);
    horn.rotation.z = hx > 0 ? -1.1 : 1.1;
    g.add(horn);
  }
  // Axe — large double-head
  const axePivot = new THREE.Group();
  axePivot.position.set(0.3, 0.45, 0);
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.85 }));
  haft.position.y = 0.2;
  axePivot.add(haft);
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xb0b4c0, roughness: 0.3, metalness: 0.9, flatShading: true }));
  axeHead.position.y = 0.42;
  axePivot.add(axeHead);
  g.add(axePivot);

  g.userData = {
    state: 'marching',
    faction: FACTION_HERO,
    isDwarf: true,
    hp: HERO_HP_DWARF, maxHp: HERO_HP_DWARF,
    atk: HERO_ATK_DWARF, atkCooldown: 0, atkRange: HERO_ATK_RANGE,
    speed: HERO_SPEED_DWARF,
    sight: HERO_SIGHT,
    atkHeartDps: HERO_ATK_HEART * 1.1,
    atkCooldownTime: HERO_ATK_COOLDOWN * 1.25,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    repathCooldown: 0,
    fightTarget: null,
    plunderedGold: 0,
    targetedTreasury: null,
    chestBody: chest, head,
    walkPhase: Math.random() * Math.PI * 2,
    swingPhase: 0,
    facing: 0,
    swordPivot: axePivot,
  };
  createHpBar(g, 1.35, 0.5, HP_BAR_FILL_HERO_MAT, false);
  return g;
}

function _spawnHeroAt(x, z, kind) {
  let h;
  if      (kind === 'archer') h = createArcher();
  else if (kind === 'priest') h = createPriest();
  else if (kind === 'dwarf')  h = createDwarf();
  else                        h = createHero();
  h.position.set(x, 0, z);
  h.userData.gridX = x;
  h.userData.gridZ = z;
  scene.add(h);
  heroes.push(h);
  spawnPulse(x, z, 0xff4040, 0.5, 1.2);
  spawnSparkBurst(x, z, 0xff6060, 16, 1.0);
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

// ============================================================
// HERO LAIRS — pre-placed strongholds (DK2-style)
// ============================================================
// Build the 4 quadrant lairs + boss lair from HERO_LAIRS. Each lair is a 5×5
// box: outer ring T_ENEMY_WALL (with one entrance gap) and inner 3×3 T_ENEMY_FLOOR.
// Heroes are pre-placed inside, tagged with lairId/homeX/homeZ for territorial AI.
// Lair walls are tracked in `_lairs` so we can detect "lair breached" later.
export const _lairs = [];   // { id, cx, cz, walls: [{x,z}], heroes: [], breached: false }

export function placeHeroLairs() {
  for (const def of HERO_LAIRS) {
    const lair = { id: def.id, cx: def.cx, cz: def.cz, walls: [], heroes: [], breached: false };
    // Pick which wall cell to omit as the entrance (one of the 4 cardinal middles).
    const skipDoor = (() => {
      if (def.doorSide === 'north') return { dx: 0, dz: -2 };
      if (def.doorSide === 'south') return { dx: 0, dz:  2 };
      if (def.doorSide === 'east')  return { dx: 2, dz:  0 };
      return { dx: -2, dz: 0 };
    })();
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = def.cx + dx, z = def.cz + dz;
        if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
        // Clear any random gold vein on this tile so the lair reads cleanly.
        grid[x][z].goldAmount = 0;
        const isEdge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
        const isDoor = (dx === skipDoor.dx && dz === skipDoor.dz);
        if (isEdge && !isDoor) {
          setTile(x, z, T_ENEMY_WALL);
          lair.walls.push({ x, z });
        } else {
          setTile(x, z, T_ENEMY_FLOOR);
        }
      }
    }
    // Spawn the hero garrison inside the lair (3×3 inner cells, distributed).
    const innerCells = [
      { dx: -1, dz: -1 }, { dx: 1, dz: -1 }, { dx: -1, dz: 1 }, { dx: 1, dz: 1 },
      { dx: 0, dz: 0 }, { dx: -1, dz: 0 }, { dx: 1, dz: 0 },
    ];
    for (let i = 0; i < def.units.length; i++) {
      const slot = innerCells[i % innerCells.length];
      const sx = def.cx + slot.dx;
      const sz = def.cz + slot.dz;
      const kind = def.units[i];
      const h = (kind === 'boss') ? spawnBoss(sx, sz) : _spawnHeroAt(sx, sz, kind);
      // Tag hero for territorial AI
      h.userData.lairId = def.id;
      h.userData.homeX = def.cx;
      h.userData.homeZ = def.cz;
      h.userData.heroState = 'guarding';
      h.userData.territoryRadius = HERO_TERRITORY_RADIUS;
      h.userData.lairBroken = false;
      lair.heroes.push(h);
    }
    _lairs.push(lair);
  }
}

// Detect lair breach: when every wall tile of a lair is no longer T_ENEMY_WALL
// (claimed/dug by the player), all surviving heroes from that lair go aggressive
// (lairBroken=true) and march on the heart.
export function tickHeroLairs(_dt, _t) {
  if (GAME.over) return;
  for (const lair of _lairs) {
    if (lair.breached) continue;
    let anyWallLeft = false;
    for (const w of lair.walls) {
      if (grid[w.x][w.z].type === T_ENEMY_WALL) { anyWallLeft = true; break; }
    }
    if (!anyWallLeft) {
      lair.breached = true;
      for (const h of lair.heroes) {
        if (h && h.userData && h.userData.hp > 0) {
          h.userData.lairBroken = true;
          h.userData.heroState = 'engaging';
        }
      }
      pushEvent(`Lair "${lair.id}" breached!`);
      playSfx('alarm', { minInterval: 4000 });
      // If this is the boss lair, set invasion.boss for HUD readouts.
      if (lair.id === 'boss') {
        const boss = lair.heroes.find(h => h && h.userData && h.userData.isBoss);
        if (boss) invasion.boss = boss;
      }
    }
  }
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

  // --- Priest heals nearby heroes (passive aura) ---
  if (ud.isPriest && ud.hp > 0) {
    for (const other of heroes) {
      if (other === h || !other.userData || other.userData.hp <= 0) continue;
      if (other.userData.hp >= other.userData.maxHp) continue;
      const d = Math.hypot(other.position.x - h.position.x, other.position.z - h.position.z);
      if (d <= HERO_HEAL_RADIUS_PRIEST) {
        other.userData.hp = Math.min(other.userData.maxHp, other.userData.hp + HERO_HEAL_PRIEST * dt);
      }
    }
  }

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
    const tgt = ud.fightTarget;
    const dx = tgt.position.x - h.position.x;
    const dz = tgt.position.z - h.position.z;
    const d = Math.hypot(dx, dz);
    ud.facing = Math.atan2(dx, dz);
    ud.heroState = 'engaging';
    if (d > ud.atkRange) {
      // Archers hold ground and shoot, kiting away if too close.
      if (ud.isArcher && d < ud.atkRange * 0.7) {
        // Back-step one tile's distance
        h.position.x -= (dx / d) * (ud.speed * 0.6) * dt;
        h.position.z -= (dz / d) * (ud.speed * 0.6) * dt;
      } else if (!ud.isArcher) {
        _heroMoveToward(h, tgt.position.x, tgt.position.z, dt);
      }
      ud.state = 'fighting';
    } else {
      ud.state = 'fighting';
    }
    // Attack regardless (once in range). Archers / priests have longer atkRange
    // so this is the hit-scan "shot".
    if (ud.atkCooldown <= 0 && d <= ud.atkRange) {
      takeDamage(tgt, ud.atk, h);
      ud.atkCooldown = ud.atkCooldownTime;
      ud.swingPhase = 1;
    }
    _heroTurnTowardFacing(h, dt);
    _heroAnimate(h, dt, true);
    return;
  }

  // --- Check for door in front (attack it before moving through) ---
  const nextTile = (ud.path && ud.pathIdx < ud.path.length) ? ud.path[ud.pathIdx] : null;
  if (nextTile) {
    const d = doorAt(nextTile.x, nextTile.z);
    if (d) {
      const dx = nextTile.x - h.position.x;
      const dz = nextTile.z - h.position.z;
      const dist = Math.hypot(dx, dz);
      ud.facing = Math.atan2(dx, dz);
      if (dist > 0.6) {
        h.position.x += (dx / dist) * ud.speed * dt;
        h.position.z += (dz / dist) * ud.speed * dt;
      } else {
        ud.state = 'breaking_door';
        if (ud.atkCooldown <= 0) {
          damageDoor(d, ud.atk);
          ud.atkCooldown = ud.atkCooldownTime;
          ud.swingPhase = 1;
        }
      }
      _heroTurnTowardFacing(h, dt);
      _heroAnimate(h, dt, true);
      return;
    }
  }

  // --- Territorial AI ---
  // Heroes that haven't had their lair breached stay near home; they only chase
  // intruders within HERO_TERRITORY_RADIUS, then return when threats clear.
  // Once `lairBroken` is set, they revert to the classic march-on-heart behavior
  // (with dwarf plunder still active).
  if (!ud.lairBroken && ud.homeX !== undefined) {
    const dHome = Math.hypot(h.position.x - ud.homeX, h.position.z - ud.homeZ);
    const tr = ud.territoryRadius || HERO_TERRITORY_RADIUS;
    if (dHome > tr * 1.5) {
      // Wandered too far — return to lair.
      ud.heroState = 'returning';
      ud.state = 'returning';
      if (!ud.path || ud.pathIdx >= (ud.path ? ud.path.length : 0) || ud.repathCooldown <= 0) {
        const p = findPath(gx, gz, ud.homeX, ud.homeZ);
        if (p) { ud.path = p; ud.pathIdx = 0; }
        ud.repathCooldown = 1.0 + Math.random() * 0.5;
      }
      if (ud.path && ud.pathIdx < ud.path.length) {
        const next = ud.path[ud.pathIdx];
        const dx2 = next.x - h.position.x;
        const dz2 = next.z - h.position.z;
        const d2 = Math.hypot(dx2, dz2);
        if (d2 < 0.12) {
          ud.pathIdx++;
        } else {
          ud.facing = Math.atan2(dx2, dz2);
          h.position.x += (dx2 / d2) * ud.speed * dt;
          h.position.z += (dz2 / d2) * ud.speed * dt;
        }
      }
      _heroTurnTowardFacing(h, dt);
      _heroAnimate(h, dt, false);
      return;
    }
    // Otherwise idle-wander around home (DK2 "guarding" mood).
    ud.heroState = 'guarding';
    ud.state = 'guarding';
    // Slow drift toward a point ~1.5 tiles from home, chosen periodically.
    if (!ud.guardTarget || ud.guardTargetCooldown <= 0) {
      const ang = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.5;
      ud.guardTarget = { x: ud.homeX + Math.cos(ang) * r, z: ud.homeZ + Math.sin(ang) * r };
      ud.guardTargetCooldown = 3 + Math.random() * 3;
    }
    ud.guardTargetCooldown -= dt;
    const gdx = ud.guardTarget.x - h.position.x;
    const gdz = ud.guardTarget.z - h.position.z;
    const gd = Math.hypot(gdx, gdz);
    if (gd > 0.1) {
      ud.facing = Math.atan2(gdx, gdz);
      const sp = ud.speed * 0.4;  // amble, not march
      h.position.x += (gdx / gd) * sp * dt;
      h.position.z += (gdz / gd) * sp * dt;
    }
    _heroTurnTowardFacing(h, dt);
    _heroAnimate(h, dt, false);
    return;
  }

  // --- Lair-broken or untagged hero: classic heart-march behavior ---
  // Dwarf plunder target: hunt treasuries before the heart.
  let targetX = HEART_X, targetZ = HEART_Z;
  if (ud.isDwarf && !ud.plunderedGold) {
    const closestTr = _nearestTreasuryWithGold(h.position.x, h.position.z);
    if (closestTr) {
      targetX = closestTr.x;
      targetZ = closestTr.z;
      ud.targetedTreasury = closestTr;
    }
  }

  // Near target — treasury plunder OR heart attack?
  if (ud.isDwarf && ud.targetedTreasury && !ud.plunderedGold) {
    const tr = ud.targetedTreasury;
    const dTr = Math.hypot(h.position.x - tr.x, h.position.z - tr.z);
    if (dTr < 0.9 && tr.amount > 0) {
      const take = Math.min(100, tr.amount);
      tr.amount -= take;
      stats.goldTotal -= take;
      ud.plunderedGold += take;
      spawnSparkBurst(tr.x, tr.z, 0xffcc44, 18, 1.1);
      playSfx('coin', { minInterval: 120 });
      pushEvent('Dwarf plundered ' + take + 'g');
      ud.path = null;   // force repath now that priority changed
      return;
    }
  }

  const dHeart = Math.hypot(h.position.x - HEART_X, h.position.z - HEART_Z);
  const heartReach = ud.isBoss ? 1.6 : 1.3;
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

  // March toward target (heart, or a treasury for a dwarf mid-plunder)
  ud.state = 'marching';
  if (!ud.path || ud.pathIdx >= (ud.path ? ud.path.length : 0) || ud.repathCooldown <= 0) {
    const p = findPath(gx, gz, targetX, targetZ);
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

// Closest treasury tile with gold still in it. Null if every treasury is empty.
function _nearestTreasuryWithGold(px, pz) {
  let best = null, bestD = Infinity;
  for (const tr of treasuries) {
    if (tr.amount <= 0) continue;
    const d = Math.hypot(tr.x - px, tr.z - pz);
    if (d < bestD) { bestD = d; best = tr; }
  }
  return best;
  // Reference kept so unused-import linter is happy
  // (importer needs ROOM_TREASURY elsewhere)
}
// Silence no-unused warning for the ROOM_TREASURY import (used by intent
// matching in other modules; keep here if a future treasury-only filter wants
// to reference the constant name).
void ROOM_TREASURY;

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
// WAVES — DEPRECATED
// ============================================================
// Heroes are now pre-placed in HERO_LAIRS at game start; there is no timed
// wave invasion. tickWaves() forwards to tickHeroLairs() for breach detection.
// The legacy wave constants/imports are retained so save-state and unrelated
// systems don't break, but no spawning happens here.
export function tickWaves(dt, t) {
  tickHeroLairs(dt, t);
}
// Silence unused-import warnings for legacy wave symbols still imported above.
void WAVE_INTERVAL_BASE; void WAVE_WARN_LEAD; void WAVE_TABLES;
void FINAL_WAVE; void showWaveWarning; void showWaveBanner;
