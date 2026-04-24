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
  FACTION_PLAYER, ROOM_LAIR, ROOM_HATCHERY, ROOM_TRAINING,
  T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
  PORTAL_SPAWN_INTERVAL, PORTAL_MAX_SPAWN,
  NEED_HUNGER_RATE, NEED_SLEEP_RATE, NEED_CRITICAL, NEED_SATISFIED,
  EAT_DURATION, SLEEP_DURATION, HATCHERY_REGROW,
  HERO_SIGHT, SPECIES, AFFINITY,
  DISTRESS_RADIUS, DISTRESS_TTL, DISTRESS_MAX_RESPONDERS,
} from './constants.js';
import { grid, creatures, portals, heroes, stats, treasuries, rally } from './state.js';
import { creatureGroup } from './scene.js';
import {
  FLY_BODY_MAT, FLY_WING_MAT, FLY_EYE_MAT,
  BEETLE_CARAPACE_MAT, BEETLE_UNDER_MAT, BEETLE_EYE_MAT,
  GOBLIN_SKIN_MAT, GOBLIN_CLOTH_MAT, GOBLIN_BLADE_MAT, GOBLIN_EYE_MAT,
  WARLOCK_ROBE_MAT, WARLOCK_TRIM_MAT, WARLOCK_EYE_MAT, WARLOCK_STAFF_MAT,
  NEED_HUNGER_MAT, NEED_SLEEP_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { findPath, isWalkable } from './pathfinding.js';
import { setLairOccupied } from './rooms.js';
import { createLevelBadge } from './xp.js';
import { takeDamage } from './combat.js';
import { hasSlapBuff, SLAP_SPEED_MUL } from './slap.js';
import { createMoodBadge } from './mood.js';
import { pushEvent } from './hud.js';
import { createIntentBadge, setIntent } from './intent.js';

const THREE = window.THREE;

// ============================================================
// SPECIES MESH BUILDERS
// ============================================================
// Each species returns a THREE.Group with the body, and fills `parts` with
// the animation handles the updater uses (head, wings, legs, body). Species
// that don't have wings leave wingL/wingR null; the updater guards on that.

function _makeNeedIcon() {
  // Shared between species — hidden until a need hits critical.
  const iconGroup = new THREE.Group();
  iconGroup.position.y = 1.15;
  iconGroup.visible = false;
  const iconBg = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x180808, transparent: true, opacity: 0.6 }));
  iconGroup.add(iconBg);
  const iconGlyph = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), NEED_HUNGER_MAT);
  iconGlyph.rotation.x = Math.PI / 2;
  iconGroup.add(iconGlyph);
  return { iconGroup, iconGlyph };
}

export function createFly() {
  const group = new THREE.Group();
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), FLY_BODY_MAT);
  thorax.position.y = 0.7;
  thorax.castShadow = true;
  group.add(thorax);
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), FLY_BODY_MAT);
  abdomen.scale.set(1, 0.85, 1.3);
  abdomen.position.set(0, 0.68, -0.18);
  abdomen.castShadow = true;
  group.add(abdomen);
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
  const wingGeo = new THREE.PlaneGeometry(0.24, 0.14);
  const wingL = new THREE.Mesh(wingGeo, FLY_WING_MAT);
  wingL.position.set(-0.12, 0.78, -0.05);
  wingL.rotation.y = 0.3;
  group.add(wingL);
  const wingR = new THREE.Mesh(wingGeo, FLY_WING_MAT);
  wingR.position.set(0.12, 0.78, -0.05);
  wingR.rotation.y = -0.3;
  group.add(wingR);
  return { group, parts: { thorax, abdomen, head, wingL, wingR, flies: true, hovers: true } };
}

export function createBeetle() {
  // Low-slung, armoured, walks. Carapace is flat-shaded with a metallic gleam.
  const group = new THREE.Group();
  const abdomen = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), BEETLE_CARAPACE_MAT);
  abdomen.scale.set(1.2, 0.55, 1.5);
  abdomen.position.set(0, 0.25, -0.1);
  abdomen.castShadow = true;
  group.add(abdomen);
  // Split elytra line on top — two thin cylinders to sell the segmented shell.
  const seam = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.04, 0.45),
    BEETLE_UNDER_MAT
  );
  seam.position.set(0, 0.44, -0.1);
  group.add(seam);
  // Thorax (narrower than abdomen) + head
  const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), BEETLE_CARAPACE_MAT);
  thorax.scale.set(1, 0.7, 1);
  thorax.position.set(0, 0.3, 0.2);
  thorax.castShadow = true;
  group.add(thorax);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), BEETLE_CARAPACE_MAT);
  head.position.set(0, 0.32, 0.38);
  head.castShadow = true;
  group.add(head);
  // Yellow compound eyes
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), BEETLE_EYE_MAT);
  eyeL.position.set(-0.07, 0.36, 0.44);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), BEETLE_EYE_MAT);
  eyeR.position.set(0.07, 0.36, 0.44);
  group.add(eyeR);
  // Horns on the thorax — two curved cones forward
  const hornGeo = new THREE.ConeGeometry(0.04, 0.18, 6);
  const hornL = new THREE.Mesh(hornGeo, BEETLE_CARAPACE_MAT);
  hornL.position.set(-0.1, 0.42, 0.3);
  hornL.rotation.set(-0.5, 0, -0.3);
  group.add(hornL);
  const hornR = new THREE.Mesh(hornGeo, BEETLE_CARAPACE_MAT);
  hornR.position.set(0.1, 0.42, 0.3);
  hornR.rotation.set(-0.5, 0, 0.3);
  group.add(hornR);
  // Six stubby legs — three per side. Kept short because the body is low.
  const legGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.22, 5);
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const forward = [-0.15, 0.05, 0.25][Math.floor(i / 2)];
    const leg = new THREE.Mesh(legGeo, BEETLE_UNDER_MAT);
    leg.position.set(side * 0.26, 0.11, forward);
    leg.rotation.z = side * 0.6;
    group.add(leg);
    legs.push(leg);
  }
  return { group, parts: { head, thorax, abdomen, legs, walks: true } };
}

export function createGoblin() {
  // Small wiry humanoid — bent knees, headband, curved blade.
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.18), GOBLIN_SKIN_MAT);
  torso.position.y = 0.5;
  torso.castShadow = true;
  group.add(torso);
  // Loincloth
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.2), GOBLIN_CLOTH_MAT);
  cloth.position.y = 0.34;
  group.add(cloth);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), GOBLIN_SKIN_MAT);
  head.scale.set(1, 1.05, 0.95);
  head.position.y = 0.74;
  head.castShadow = true;
  group.add(head);
  // Big ears
  const earGeo = new THREE.ConeGeometry(0.045, 0.14, 5);
  const earL = new THREE.Mesh(earGeo, GOBLIN_SKIN_MAT);
  earL.position.set(-0.12, 0.78, 0);
  earL.rotation.z = Math.PI / 2 + 0.3;
  group.add(earL);
  const earR = earL.clone();
  earR.rotation.z = -Math.PI / 2 - 0.3;
  earR.position.set(0.12, 0.78, 0);
  group.add(earR);
  // Eyes
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), GOBLIN_EYE_MAT);
  eyeL.position.set(-0.045, 0.76, 0.1);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), GOBLIN_EYE_MAT);
  eyeR.position.set(0.045, 0.76, 0.1);
  group.add(eyeR);
  // Red headband
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 5, 14), GOBLIN_CLOTH_MAT);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.83;
  group.add(band);
  // Arms
  const armGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.3, 5);
  const armL = new THREE.Mesh(armGeo, GOBLIN_SKIN_MAT);
  armL.position.set(-0.17, 0.48, 0);
  armL.rotation.z = 0.4;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, GOBLIN_SKIN_MAT);
  armR.position.set(0.17, 0.48, 0);
  armR.rotation.z = -0.4;
  group.add(armR);
  // Curved blade in right hand
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.35, 0.025), GOBLIN_BLADE_MAT);
  blade.position.set(0.24, 0.56, 0.06);
  blade.rotation.z = -0.5;
  group.add(blade);
  // Legs (bent knees)
  const legGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.28, 5);
  const legL = new THREE.Mesh(legGeo, GOBLIN_SKIN_MAT);
  legL.position.set(-0.07, 0.17, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, GOBLIN_SKIN_MAT);
  legR.position.set(0.07, 0.17, 0);
  group.add(legR);
  return { group, parts: { head, torso, armL, armR, legL, legR, blade, walks: true } };
}

export function createWarlock() {
  // Hooded robed caster that floats. Robe hides legs, staff held in right hand.
  const group = new THREE.Group();
  // Robe — a wide cone
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.6, 8), WARLOCK_ROBE_MAT);
  robe.position.y = 0.3;
  robe.castShadow = true;
  group.add(robe);
  // Trim ring at the hem
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 18), WARLOCK_TRIM_MAT);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = 0.08;
  group.add(hem);
  // Hood (oversized, covers head)
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), WARLOCK_ROBE_MAT);
  hood.scale.set(1, 1.15, 1);
  hood.position.y = 0.72;
  group.add(hood);
  // Glowing eye under hood — single occluded glow
  const head = new THREE.Group();
  head.position.y = 0.68;
  group.add(head);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), WARLOCK_EYE_MAT);
  eye.position.set(0, 0, 0.1);
  head.add(eye);
  // Sleeves — two small trim rings at arm positions
  const sleeveGeo = new THREE.TorusGeometry(0.05, 0.015, 5, 12);
  const sleeveL = new THREE.Mesh(sleeveGeo, WARLOCK_TRIM_MAT);
  sleeveL.rotation.x = Math.PI / 2;
  sleeveL.position.set(-0.16, 0.45, 0.05);
  group.add(sleeveL);
  const sleeveR = new THREE.Mesh(sleeveGeo, WARLOCK_TRIM_MAT);
  sleeveR.rotation.x = Math.PI / 2;
  sleeveR.position.set(0.16, 0.45, 0.05);
  group.add(sleeveR);
  // Staff
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 5), WARLOCK_STAFF_MAT);
  staff.position.set(0.24, 0.5, 0.04);
  staff.rotation.z = -0.12;
  group.add(staff);
  // Crystal on top of staff
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), WARLOCK_TRIM_MAT);
  crystal.position.set(0.29, 0.9, 0.04);
  group.add(crystal);
  // Faint glow light
  const light = new THREE.PointLight(0xa060ff, 0.4, 1.5, 2);
  light.position.set(0.29, 0.9, 0.04);
  group.add(light);
  return { group, parts: { head, hood, robe, staff, crystal, eye, light, hovers: true } };
}

// Dispatcher — returns { group, parts } for the chosen species.
function _createSpeciesBody(species) {
  if (species === 'beetle')  return createBeetle();
  if (species === 'goblin')  return createGoblin();
  if (species === 'warlock') return createWarlock();
  return createFly();
}

// Pick a species for the next portal spawn. Uses SPECIES.spawnWeight, but
// honours `requiresRoom` (e.g. Warlocks only appear once a Library exists).
// Guarantees at least a Fly is always in the pool.
function _pickSpawnSpecies() {
  const pool = [];
  for (const key of Object.keys(SPECIES)) {
    const s = SPECIES[key];
    if (s.requiresRoom && !_hasAnyRoomOfType(s.requiresRoom)) continue;
    pool.push({ key, w: s.spawnWeight || 1 });
  }
  if (pool.length === 0) return 'fly';
  const total = pool.reduce((n, p) => n + p.w, 0);
  let r = Math.random() * total;
  for (const p of pool) { r -= p.w; if (r <= 0) return p.key; }
  return pool[pool.length - 1].key;
}
function _hasAnyRoomOfType(roomType) {
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      if (grid[x][z].roomType === roomType) return true;
    }
  }
  return false;
}

export function spawnCreature(x, z, forcedSpecies) {
  const species = forcedSpecies || _pickSpawnSpecies();
  const def = SPECIES[species] || SPECIES.fly;
  const { group, parts } = _createSpeciesBody(species);

  const { iconGroup, iconGlyph } = _makeNeedIcon();
  group.add(iconGroup);

  group.userData = {
    state: 'wandering',
    faction: FACTION_PLAYER,
    species,                       // 'fly' | 'beetle' | 'goblin' | 'warlock'
    favoriteRoom: def.favoriteRoom,
    hp: def.hp, maxHp: def.hp,
    atk: def.atk, atkCooldown: 0, atkRange: def.atkRange,
    baseSpeed: def.speed, baseWanderSpeed: def.wanderSpeed, baseAtkCooldown: def.atkCooldown,
    level: 1, xp: 0,
    perks: [],                     // list of earned perk names
    fightTarget: null,
    damageFlash: 0,
    gridX: 0, gridZ: 0,
    path: null, pathIdx: 0,
    target: null,
    lair: null,
    needs: { hunger: 0, sleep: 0 },
    timer: 0,
    wanderCooldown: 0,
    facing: 0,
    bobPhase: Math.random() * Math.PI * 2,
    wingPhase: 0,
    // Animation handles — some are null on species without that part.
    wingL: parts.wingL || null, wingR: parts.wingR || null,
    thorax: parts.thorax || null, abdomen: parts.abdomen || null, head: parts.head || null,
    parts,                         // full handle bag for species-specific animation
    iconGroup, iconGlyph,
    paySince: 0, anger: 0, happiness: 1, slapBuffUntil: 0,
    twitchCooldown: 1 + Math.random() * 3,
    wingBeatPhase: Math.random() * Math.PI * 2,
    hasteUntil: 0,                 // perf-time ms; set by the Haste spell
    rallyTarget: null,             // {x,z} — transient override from Call to Arms
  };
  group.position.set(x, 0, z);
  group.userData.gridX = x;
  group.userData.gridZ = z;
  creatureGroup.add(group);
  creatures.push(group);
  stats.creatures += 1;
  // Birth effect — color-tinted per species so the first frame telegraphs what hatched.
  spawnPulse(x, z, def.color, 0.5, 1.1);
  spawnSparkBurst(x, z, 0xffa060, 18, 1.0);
  playSfx('spawn', { minInterval: 200 });
  createLevelBadge(group, 1.15, 0.3);
  createMoodBadge(group, 1.5);
  createIntentBadge(group, 1.75);
  pushEvent(`${def.name} arrived`);
  return group;
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
// The combat tick picks one of four sub-behaviors per frame:
//   FLEE  — HP below species threshold → run away from hero, path to lair.
//   KITE  — ranged species with hero too close → back off while firing.
//   CHASE — hero out of attack range → close the gap.
//   STRIKE — in range + cooldown elapsed → land a hit.
// Flee ends automatically once HP recovers past fleeBelow + 0.15 hysteresis.
function _creatureCombatTick(c, dt) {
  const ud = c.userData;
  if (ud.state === 'held') return false;
  const speedMul = _speedMul(ud);
  ud.atkCooldown = Math.max(0, ud.atkCooldown - dt * speedMul);

  // --- Find nearest alive hero within sight ---
  let nearest = null, nearestD = HERO_SIGHT;
  for (const h of heroes) {
    if (h.userData.hp <= 0) continue;
    const d = Math.hypot(h.position.x - c.position.x, h.position.z - c.position.z);
    if (d < nearestD) { nearestD = d; nearest = h; }
  }

  // --- Flee state: exit or continue even without a visible hero ---
  const hpFrac = ud.hp / ud.maxHp;
  const def = SPECIES[ud.species] || SPECIES.fly;
  if (ud.state === 'fleeing') {
    // No hero visible → break the flee; natural needs can take over (seek Lair
    // to heal, etc). Also break if HP has recovered well past the threshold.
    if (!nearest || hpFrac > def.fleeBelow + 0.2) {
      ud.state = 'wandering';
      ud.wanderCooldown = 0.3;
      return false;
    }
    // Still fleeing — run directly away from the hero.
    const fdx = c.position.x - nearest.position.x;
    const fdz = c.position.z - nearest.position.z;
    const fd = Math.hypot(fdx, fdz) || 1;
    const sp = (ud.baseSpeed + 0.4) * speedMul;
    c.position.x += (fdx / fd) * sp * dt;
    c.position.z += (fdz / fd) * sp * dt;
    ud.facing = Math.atan2(fdx, fdz);
    let diff = ud.facing - c.rotation.y;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.rotation.y += diff * Math.min(1, dt * 14);
    if (ud.parts && ud.parts.flies) {
      c.position.y = 0.15 + Math.abs(Math.sin(performance.now() * 0.025)) * 0.12;
    }
    return true;
  }

  if (!nearest) {
    if (ud.state === 'fighting') {
      ud.state = 'wandering';
      ud.fightTarget = null;
      ud.wanderCooldown = 0.3;
    }
    return false;
  }

  // --- Enter flee: HP below species threshold → break combat and run ---
  if (def.fleeBelow > 0 && hpFrac < def.fleeBelow) {
    ud.state = 'fleeing';
    ud.fightTarget = null;
    setIntent(c, 'flee');
    // Stop any active path — the flee branch will drive movement next tick.
    ud.path = null;
    ud.target = null;
    return true;
  }

  ud.fightTarget = nearest;
  if (ud.state !== 'fighting') setIntent(c, 'fight');
  ud.state = 'fighting';

  const dx = nearest.position.x - c.position.x;
  const dz = nearest.position.z - c.position.z;
  const d = Math.hypot(dx, dz);
  ud.facing = Math.atan2(dx, dz);

  // --- KITE: ranged species with hero inside their kite-min distance ---
  // Back away while keeping the target in sight; still attack on cooldown so
  // the player sees bolts even mid-retreat.
  if (def.kiteMin > 0 && d < def.kiteMin) {
    const sp = ud.baseSpeed * speedMul;
    c.position.x -= (dx / d) * sp * dt;
    c.position.z -= (dz / d) * sp * dt;
    if (ud.atkCooldown <= 0 && d <= ud.atkRange) {
      takeDamage(nearest, ud.atk, c);
      ud.atkCooldown = ud.baseAtkCooldown;
      ud.timer = 0.15;
    }
  } else if (d > ud.atkRange) {
    // CHASE
    const sp = (ud.baseSpeed + 0.5) * speedMul;
    c.position.x += (dx / d) * sp * dt;
    c.position.z += (dz / d) * sp * dt;
    if (ud.parts && ud.parts.flies) {
      c.position.y = 0.15 + Math.abs(Math.sin(performance.now() * 0.02)) * 0.1;
    }
  } else {
    // STRIKE
    if (ud.atkCooldown <= 0) {
      takeDamage(nearest, ud.atk, c);
      ud.atkCooldown = ud.baseAtkCooldown;
      ud.timer = 0.15;
    }
  }
  // Turn toward target
  let diff = ud.facing - c.rotation.y;
  while (diff >  Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.rotation.y += diff * Math.min(1, dt * 12);
  // Wing flap on combat — flyers only
  if (ud.wingL && ud.wingR) {
    ud.wingPhase += dt * 70;
    ud.wingL.rotation.z =  0.3 + Math.sin(ud.wingPhase) * 0.9;
    ud.wingR.rotation.z = -0.3 - Math.sin(ud.wingPhase) * 0.9;
  }
  return true;
}

// Combined speed multiplier from slap, haste, rally. Read by combat + movement.
function _speedMul(ud) {
  let m = 1;
  if (hasSlapBuff({ userData: ud })) m *= SLAP_SPEED_MUL;
  if (ud.hasteUntil && performance.now() < ud.hasteUntil) m *= 1.5;
  return m;
}

// ============================================================
// UTILITY SCORING — pick the highest-utility goal per decision tick
// ============================================================
// Each candidate goal is assigned a 0..1+ score. The winner becomes the new
// committed target; ties favor the current goal (hysteresis) so creatures
// don't flip-flop between two close scores every evaluation.
//
// Goal families:
//   'eat'      — hunger need, pulls toward Hatchery
//   'sleep'    — sleep need, pulls toward Lair (remembered own lair preferred)
//   'pay'      — paySince > PAY_INTERVAL, pulls toward any Treasury with gold
//   'help'     — ally distress within DISTRESS_RADIUS, pulls toward them
//   'rally'    — Call to Arms flag active
//   'train'    — happy + not needy, pulls toward Training Room if any
//   'study'    — warlock-only, pulls toward Library if any
//   'favorite' — drift toward favorite room (soft preference)
//   'wander'   — fallback: pick a random walkable tile
function _reevaluateGoal(c) {
  const ud = c.userData;
  if (ud.state === 'fighting' || ud.state === 'fleeing' ||
      ud.state === 'eating' || ud.state === 'sleeping' || ud.state === 'held') return;

  const nowSec = performance.now() / 1000;
  const def = SPECIES[ud.species] || SPECIES.fly;
  const hunger = ud.needs.hunger;
  const sleep  = ud.needs.sleep;
  const overdue = Math.max(0, (ud.paySince - 90) / 90);
  const happy = ud.happiness != null ? ud.happiness : 1;
  const currentKind = ud.target ? ud.target.kind : null;

  // Bonus for the current goal — prevents jittery flip-flops between close scores.
  const stick = (kind) => (currentKind === kind ? 0.08 : 0);

  // --- Score each candidate; cache the resolver so we only pathfind for winner ---
  const candidates = [
    { kind: 'eat',      score: hunger * 1.05 + stick('eat') },
    { kind: 'sleep',    score: sleep  * 0.95 + stick('sleep') },
    { kind: 'pay',      score: (overdue > 0 ? 0.65 + overdue * 0.2 : 0) + stick('pay') },
    { kind: 'help',     score: _distressScore(c, nowSec) + stick('help') },
    { kind: 'rally',    score: (rally.active && nowSec < rally.expiresAt ? 0.55 : 0) + stick('rally') },
    { kind: 'train',    score: (happy > 0.55 && hunger < 0.6 && sleep < 0.6 ? 0.35 : 0) + stick('train') },
    { kind: 'study',    score: (ud.species === 'warlock' && happy > 0.4 ? 0.45 : 0) + stick('study') },
    { kind: 'favorite', score: (ud.favoriteRoom ? 0.25 : 0) + stick('favorite') },
    { kind: 'wander',   score: 0.1 + stick('wander') },
  ];
  candidates.sort((a, b) => b.score - a.score);

  // Walk candidates in score order until one resolves to a reachable tile.
  for (const cand of candidates) {
    const resolved = _resolveGoalTarget(c, cand.kind);
    if (!resolved) continue;
    // Skip if same cell as current target — don't re-commit needlessly.
    if (ud.target && ud.target.kind === cand.kind &&
        ud.target.x === resolved.x && ud.target.z === resolved.z) return;
    ud.target = { x: resolved.x, z: resolved.z, kind: cand.kind };
    ud.path = resolved.path;
    ud.pathIdx = 0;
    ud.state = 'moving';
    // Commit pause: freeze + face target for species.commitPause. Reads as
    // "deciding before acting" instead of instant snap-to-path.
    ud.commitUntil = nowSec + (def.commitPause || 0.2);
    setIntent(c, _intentForKind(cand.kind));
    // Reserve lair tile if we just picked sleep
    if (cand.kind === 'sleep' && resolved.x != null) {
      const lc = grid[resolved.x][resolved.z];
      if (lc && !lc.lairOwner) {
        lc.lairOwner = c;
        setLairOccupied(lc, true);
        ud.lair = { x: resolved.x, z: resolved.z };
      }
    }
    return;
  }
}

// Map a goal kind → its intent-glyph key for the bubble.
function _intentForKind(kind) {
  if (kind === 'eat') return 'eat';
  if (kind === 'sleep') return 'sleep';
  if (kind === 'pay') return 'pay';
  if (kind === 'help') return 'help';
  if (kind === 'rally') return 'rally';
  if (kind === 'train') return 'train';
  if (kind === 'study') return 'study';
  return 'wander';
}

// Resolve a goal kind to a concrete { x, z, path } or null if unreachable.
function _resolveGoalTarget(c, kind) {
  const ud = c.userData;
  if (kind === 'eat') {
    return findNearestRoomTile(ud.gridX, ud.gridZ, ROOM_HATCHERY, true);
  }
  if (kind === 'sleep') {
    // Prefer own lair tile first
    if (ud.lair) {
      const p = findPath(ud.gridX, ud.gridZ, ud.lair.x, ud.lair.z);
      if (p) return { x: ud.lair.x, z: ud.lair.z, path: p };
    }
    return findNearestRoomTile(ud.gridX, ud.gridZ, ROOM_LAIR, false);
  }
  if (kind === 'pay') {
    // Pick the nearest treasury with gold
    let best = null, bestLen = Infinity;
    for (const tr of treasuries) {
      if (tr.amount <= 0) continue;
      const p = findPath(ud.gridX, ud.gridZ, tr.x, tr.z);
      if (p && p.length < bestLen) { best = { x: tr.x, z: tr.z, path: p }; bestLen = p.length; }
    }
    return best;
  }
  if (kind === 'help') {
    // Path toward the nearest distressed ally
    const nowSec = performance.now() / 1000;
    let best = null, bestLen = Infinity;
    for (const other of creatures) {
      if (other === c) continue;
      const oud = other.userData;
      if (!oud || oud.hp <= 0 || !oud.distressAt) continue;
      if (nowSec - oud.distressAt > DISTRESS_TTL) continue;
      const d = Math.hypot(other.position.x - c.position.x, other.position.z - c.position.z);
      if (d > DISTRESS_RADIUS) continue;
      const p = findPath(ud.gridX, ud.gridZ, Math.round(other.position.x), Math.round(other.position.z));
      if (p && p.length < bestLen) {
        best = { x: Math.round(other.position.x), z: Math.round(other.position.z), path: p };
        bestLen = p.length;
      }
    }
    return best;
  }
  if (kind === 'rally') {
    if (!rally.active) return null;
    const d = Math.hypot(rally.x - ud.gridX, rally.z - ud.gridZ);
    if (d < 1.5) return null;   // already near the flag
    const p = findPath(ud.gridX, ud.gridZ, rally.x, rally.z);
    return p ? { x: rally.x, z: rally.z, path: p } : null;
  }
  if (kind === 'train') {
    return findNearestRoomTile(ud.gridX, ud.gridZ, ROOM_TRAINING, false);
  }
  if (kind === 'study') {
    return findNearestRoomTile(ud.gridX, ud.gridZ, 'library', false);
  }
  if (kind === 'favorite') {
    if (!ud.favoriteRoom) return null;
    return findNearestRoomTile(ud.gridX, ud.gridZ, ud.favoriteRoom, false);
  }
  if (kind === 'wander') {
    return pickWanderTile(ud.gridX, ud.gridZ);
  }
  return null;
}

// Distress score = strongest call within DISTRESS_RADIUS, freshness-weighted.
// Capped by DISTRESS_MAX_RESPONDERS so you don't get every creature swarming
// one wounded imp — the first few responders already count, after that the
// score decays.
function _distressScore(c, nowSec) {
  let best = 0;
  let responders = 0;
  for (const other of creatures) {
    if (other === c) continue;
    const oud = other.userData;
    if (!oud || oud.hp <= 0 || !oud.distressAt) continue;
    const age = nowSec - oud.distressAt;
    if (age > DISTRESS_TTL) continue;
    const d = Math.hypot(other.position.x - c.position.x, other.position.z - c.position.z);
    if (d > DISTRESS_RADIUS) continue;
    responders++;
    if (responders > DISTRESS_MAX_RESPONDERS) break;
    const fresh = 1 - (age / DISTRESS_TTL);
    const score = 0.6 * fresh * (1 - d / DISTRESS_RADIUS);
    if (score > best) best = score;
  }
  return best;
}

// ============================================================
// FIGHT-IN-LAIR — angry creatures brawl with each other
// ============================================================
// Runs once per second per creature (cheap polling). Two sufficiently-angry
// creatures standing within brawl range roll to start a fight. Damage is
// capped so brawls never kill — the creature with lower HP flees first.
// A slap from the player (or a hero appearing) breaks the fight up via
// the existing _creatureCombatTick, which overrides state to 'fighting'.
const BRAWL_ANGER_THRESHOLD = 0.5;
const BRAWL_PAIR_CHANCE = 0.08;       // per check, per candidate pair
const BRAWL_RANGE = 1.6;              // tile distance
const BRAWL_HP_FLOOR = 0.3;           // don't drop below 30% maxHp in a brawl
const BRAWL_CHECK_INTERVAL = 1.0;     // seconds between pair-roll attempts
let _brawlCheckTimer = 0;

export function tickBrawls(dt) {
  _brawlCheckTimer += dt;
  if (_brawlCheckTimer < BRAWL_CHECK_INTERVAL) return;
  _brawlCheckTimer = 0;
  // Only idle/wander/sleep/eat states are brawl-eligible — fighting creatures
  // are already busy with a hero, and held creatures are in the player's hand.
  const candidates = creatures.filter(c => {
    const ud = c.userData;
    if (ud.hp <= 0) return false;
    if (ud.state === 'held' || ud.state === 'fighting' || ud.state === 'fleeing') return false;
    return (ud.anger || 0) >= BRAWL_ANGER_THRESHOLD;
  });
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i], b = candidates[j];
      const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (d > BRAWL_RANGE) continue;
      if (Math.random() > BRAWL_PAIR_CHANCE) continue;
      _commitBrawlHit(a, b);
      _commitBrawlHit(b, a);
    }
  }
}

function _commitBrawlHit(attacker, target) {
  const ud = target.userData;
  const floor = ud.maxHp * BRAWL_HP_FLOOR;
  if (ud.hp <= floor) return;    // already below the brawl floor; don't pile on
  const dmg = 2 + Math.floor(Math.random() * 3);
  ud.hp = Math.max(floor, ud.hp - dmg);
  ud.damageFlash = 0.14;
  // Brawling raises anger further for a moment — creatures remember who hit them.
  ud.anger = Math.min(1, (ud.anger || 0) + 0.05);
  playSfx('hit_soft', { minInterval: 70 });
}

// ============================================================
// CREATURE SOCIAL — pay, anger, happiness
// ============================================================
// Every creature expects to be paid PAY_INTERVAL seconds after its last
// payment. On arrival at that threshold, it pauses its current AI to go
// raid a treasury; if gold is available it collects the wage and anger
// drops. Empty coffers → anger climbs; persistently angry creatures
// cause trouble downstream (fight-in-lair, future desertion).
//
// Happiness is a derived read, not a stored state — computed each tick
// from 1 − need pressure − anger. Face icon reads happiness; brawl
// system reads anger directly.
const PAY_INTERVAL = 90;          // seconds between wages
const PAY_BASE_AMOUNT = 8;         // gold per level (scales with creature.level)
const ANGER_DECAY_PER_SEC = 0.02;  // calm down slowly if needs are met
const ANGER_UNPAID_PER_SEC = 0.04; // rise while pay is overdue
const ANGER_PAY_RELIEF = 0.3;      // drop when finally paid
const ANGER_OVERDUE_GRACE = 15;    // seconds past PAY_INTERVAL before anger climbs

export function computeHappiness(ud) {
  // Weights: needs dominate (flies that are starving/exhausted are never happy),
  // anger is a hefty modifier, and overdue pay adds its own bite.
  const needPress = Math.max(ud.needs.hunger, ud.needs.sleep);
  const overdue = Math.max(0, (ud.paySince - PAY_INTERVAL) / PAY_INTERVAL);
  const h = 1 - needPress * 0.6 - (ud.anger || 0) * 0.5 - overdue * 0.2;
  return Math.max(0, Math.min(1, h));
}

// Affinity check — adjacent disliked species push anger up, friends calm it down.
// Kept simple: just scan the creatures array with an early distance filter.
// Called inside tickCreatureSocial with the same dt.
const AFFINITY_RANGE = 1.8;             // tiles
const AFFINITY_ANGER_PER_SEC = 0.06;     // dislike pair close together
const AFFINITY_CALM_PER_SEC  = 0.02;     // friends close together
function _applyAffinity(c, dt) {
  const ud = c.userData;
  if (!ud.species) return;
  const row = AFFINITY[ud.species];
  if (!row) return;
  for (const other of creatures) {
    if (other === c) continue;
    const oud = other.userData;
    if (!oud.species || oud.hp <= 0) continue;
    const affinity = row[oud.species];
    if (!affinity) continue;
    const dx = other.position.x - c.position.x;
    const dz = other.position.z - c.position.z;
    if (Math.abs(dx) > AFFINITY_RANGE || Math.abs(dz) > AFFINITY_RANGE) continue;
    const d = Math.hypot(dx, dz);
    if (d > AFFINITY_RANGE) continue;
    if (affinity < 0) {
      ud.anger = Math.min(1, (ud.anger || 0) + AFFINITY_ANGER_PER_SEC * dt);
    } else if (affinity > 0) {
      ud.anger = Math.max(0, (ud.anger || 0) - AFFINITY_CALM_PER_SEC * dt);
    }
  }
}

export function tickCreatureSocial(c, dt) {
  const ud = c.userData;
  ud.paySince = (ud.paySince || 0) + dt;
  // Attempt payment when due. v1 abstracts away the walk to the treasury —
  // a distant treasurer handles wages. Future: creature actually paths to a
  // treasury tile and takes the coin itself.
  if (ud.paySince >= PAY_INTERVAL) tryPayCreature(c, treasuries);
  // Anger rises while the creature is overdue on pay. Grace period prevents
  // slight scheduling noise (e.g., 91 s) from instantly making everyone hostile.
  if (ud.paySince > PAY_INTERVAL + ANGER_OVERDUE_GRACE) {
    ud.anger = Math.min(1, (ud.anger || 0) + ANGER_UNPAID_PER_SEC * dt);
  } else {
    // Slight passive decay when paid & needs aren't critical.
    const calm = ud.needs.hunger < NEED_CRITICAL && ud.needs.sleep < NEED_CRITICAL;
    if (calm) ud.anger = Math.max(0, (ud.anger || 0) - ANGER_DECAY_PER_SEC * dt);
  }
  _applyAffinity(c, dt);
  ud.happiness = computeHappiness(ud);
}

// Called from the hud/treasury deposit code once a frame for each unpaid
// creature in range of a treasury. Imps are not paid in v1.
// Returns true if paid (caller shouldn't keep trying this tick).
export function tryPayCreature(c, treasuries) {
  const ud = c.userData;
  if ((ud.paySince || 0) < PAY_INTERVAL) return false;
  const wage = PAY_BASE_AMOUNT * (ud.level || 1);
  // Find any treasury with gold, take wage (partial if not enough, still relieves anger).
  for (const tr of treasuries) {
    if (tr.amount > 0) {
      const taken = Math.min(wage, tr.amount);
      tr.amount -= taken;
      stats.goldTotal -= taken;  // treasury.amount is already counted in goldTotal
      ud.paySince = 0;
      ud.anger = Math.max(0, (ud.anger || 0) - ANGER_PAY_RELIEF);
      playSfx('coin', { minInterval: 120 });
      return true;
    }
  }
  // No gold available — creature remains unpaid; anger will climb.
  return false;
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

  // --- Pay / anger / happiness tick (social bookkeeping) ---
  tickCreatureSocial(c, dt);
  // Slap buff decay on the AI side — the buff itself is read by hasSlapBuff()
  // but we don't need to do anything here since timestamps auto-expire.

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

  // --- Idle animation (per-species) ---
  // Flies flap wings; walkers (beetle/goblin) shuffle legs; warlock has a
  // gentle float + staff-crystal flicker. Each branch short-circuits instead
  // of paying for the others' math.
  ud.wingBeatPhase += dt * 0.7;
  if (ud.parts && ud.parts.flies && ud.wingL && ud.wingR) {
    const beatJitter = 1 + Math.sin(ud.wingBeatPhase) * 0.1;
    const flapRate = (ud.state === 'moving' ? 55 : 30) * beatJitter;
    ud.wingPhase += dt * flapRate;
    ud.wingL.rotation.z = Math.sin(ud.wingPhase) * 0.8;
    ud.wingR.rotation.z = -Math.sin(ud.wingPhase) * 0.8;
  } else if (ud.parts && ud.parts.walks && ud.parts.legs) {
    // Beetle — tiny leg shuffle when moving; still when idle.
    if (ud.state === 'moving') {
      ud.wingPhase += dt * 18;
      for (let i = 0; i < ud.parts.legs.length; i++) {
        const leg = ud.parts.legs[i];
        const phase = ud.wingPhase + i * 0.9;
        leg.rotation.x = Math.sin(phase) * 0.4;
      }
    }
  } else if (ud.parts && ud.parts.walks && ud.parts.legL) {
    // Goblin — alternating leg + arm swing
    if (ud.state === 'moving') {
      ud.wingPhase += dt * 12;
      const k = Math.sin(ud.wingPhase);
      ud.parts.legL.rotation.x = k * 0.5;
      ud.parts.legR.rotation.x = -k * 0.5;
      if (ud.parts.armL) ud.parts.armL.rotation.x = -k * 0.4;
      if (ud.parts.armR) ud.parts.armR.rotation.x = k * 0.4;
    }
  }
  if (ud.parts && ud.parts.crystal) {
    // Warlock crystal bob
    ud.parts.crystal.position.y = 0.9 + Math.sin(performance.now() * 0.003) * 0.03;
  }

  // --- Grunt vocalization: rare idle sound, mood-sensitive ---
  // Budget is per-creature (ud.gruntCooldown) so SFX-layer throttling still
  // keeps the overall rate sane even if many flies want to vocalize at once.
  ud.gruntCooldown = (ud.gruntCooldown || 4 + Math.random() * 6) - dt;
  if (ud.gruntCooldown <= 0 && ud.state !== 'fighting' && ud.state !== 'held') {
    ud.gruntCooldown = 5 + Math.random() * 10;
    const h = ud.happiness != null ? ud.happiness : 1;
    // Angry → grumble; happy/neutral → buzz. Never both.
    if (h < 0.4) playSfx('grumble', { minInterval: 450 });
    else if (h > 0.55) playSfx('buzz', { minInterval: 300 });
  }

  // --- Twitch: occasional body waggle / head cock when idle ---
  // Only fires in wander/eat/sleep states — not mid-combat. Happy creatures
  // twitch more often (buzzing contentedly), angry ones less (tense).
  if (ud.state === 'wandering' || ud.state === 'eating' || ud.state === 'sleeping') {
    ud.twitchCooldown -= dt;
    if (ud.twitchCooldown <= 0) {
      const happy = ud.happiness != null ? ud.happiness : 1;
      ud.twitchCooldown = (1.5 + Math.random() * 3.5) * (1.4 - happy);
      ud.twitchStart = performance.now();
    }
    if (ud.twitchStart) {
      const age = (performance.now() - ud.twitchStart) / 1000;
      if (age < 0.35) {
        // Quick head cock and a brief body yaw offset
        const k = Math.sin(age * 12) * (1 - age / 0.35);
        if (ud.head) ud.head.rotation.z = k * 0.25;
        c.rotation.y = ud.facing + k * 0.15;
      } else {
        if (ud.head) ud.head.rotation.z = 0;
        ud.twitchStart = 0;
      }
    }
  } else if (ud.head) {
    ud.head.rotation.z = 0;
  }

  // --- Hover bob — flyers float, warlock drifts softer, walkers hug the ground ---
  ud.bobPhase += dt * 3;
  let bobAmp;
  if (ud.parts && ud.parts.flies)      bobAmp = ud.state === 'moving' ? 0.08 : 0.04;
  else if (ud.parts && ud.parts.hovers) bobAmp = 0.03;   // warlock glides
  else                                   bobAmp = 0;      // ground walkers
  c.position.y = Math.sin(ud.bobPhase) * bobAmp;

  // --- State machine ---
  // Re-evaluation cadence is per-species: skittish Flies re-plan every 1.2s,
  // Beetles every 3s. Between ticks the creature commits to its current goal,
  // which reads as "thinking" instead of "twitching."
  const speciesDef = SPECIES[ud.species] || SPECIES.fly;
  if (ud.state === 'wandering' || ud.state === 'moving') {
    ud.decisionCooldown = (ud.decisionCooldown || 0) - dt;
    if (ud.decisionCooldown <= 0) {
      ud.decisionCooldown = (speciesDef.decisionInterval || 1.5) * (0.85 + Math.random() * 0.3);
      _reevaluateGoal(c);
      // If the decision produced a new committed goal, skip the remaining
      // wander handler — the commit-pause below will kick it off.
      if (ud.commitUntil && performance.now() / 1000 < ud.commitUntil) return;
    }
  }

  // Commit pause: once a new path is chosen, freeze for commitPause seconds
  // while the creature turns to face the target. Reads as deliberate thought.
  if (ud.commitUntil && performance.now() / 1000 < ud.commitUntil) {
    if (ud.target) {
      const tx = ud.target.x, tz = ud.target.z;
      const pdx = tx - c.position.x, pdz = tz - c.position.z;
      ud.facing = Math.atan2(pdx, pdz);
      let diff = ud.facing - c.rotation.y;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.rotation.y += diff * Math.min(1, dt * 10);
    }
    return;
  }

  if (ud.state === 'wandering') {
    // No committed target — drift passively. Real goal selection happens in
    // _reevaluateGoal above; this just keeps the creature moving while idle.
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
      if (ud.target && ud.target.kind === 'rally') {
        ud.state = 'wandering';
        ud.wanderCooldown = 2 + Math.random() * 1.5;
      } else if (ud.target && ud.target.kind === 'eat') {
        const cell = grid[ud.target.x][ud.target.z];
        // Verify still a hatchery tile and not depleted by another creature
        if (cell.roomType === ROOM_HATCHERY &&
            !(cell.depletedUntil && cell.depletedUntil > performance.now() / 1000)) {
          ud.state = 'eating';
          ud.timer = EAT_DURATION;
        } else {
          ud.state = 'wandering';  // room changed, re-search next tick
        }
      } else if (ud.target && ud.target.kind === 'pay') {
        // Arrived at treasury — snag the wage directly so it feels like the
        // creature physically collected it, not abstractly got paid.
        tryPayCreature(c, treasuries);
        ud.state = 'wandering';
        ud.wanderCooldown = 0.8;
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
    const baseSpeed = (ud.target && ud.target.kind === 'wander')
      ? ud.baseWanderSpeed : ud.baseSpeed;
    const speed = baseSpeed * _speedMul(ud);
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
    // Gentle head bob — "pecking" (species that have a head handle)
    if (ud.head) {
      const baseY = ud.head.userData._baseY != null ? ud.head.userData._baseY : ud.head.position.y;
      if (ud.head.userData._baseY == null) ud.head.userData._baseY = baseY;
      ud.head.position.y = baseY + Math.sin(performance.now() * 0.01) * 0.03;
    }
    if (ud.timer <= 0) {
      const cell = grid[ud.gridX][ud.gridZ];
      if (cell.roomType === ROOM_HATCHERY) {
        cell.depletedUntil = performance.now() / 1000 + HATCHERY_REGROW;
        const rm = cell.roomMesh;
        if (rm && rm.userData.egg) {
          rm.userData.egg.visible = true;
          spawnSparkBurst(ud.gridX, ud.gridZ, 0xf0e8d8, 14, 0.8);
        }
      }
      ud.needs.hunger = NEED_SATISFIED;
      ud.state = 'wandering';
      ud.wanderCooldown = 0.5;
      if (ud.head && ud.head.userData._baseY != null) {
        ud.head.position.y = ud.head.userData._baseY;
      }
      spawnPulse(ud.gridX, ud.gridZ, 0x70c050, 0.3, 0.7);
    }
    return;
  }

  if (ud.state === 'sleeping') {
    ud.timer -= dt;
    // Settle to the ground, slow breath. Wings fold on flyers that have them.
    c.position.y = 0.02 + Math.abs(Math.sin(performance.now() * 0.002)) * 0.02;
    if (ud.wingL && ud.wingR) {
      ud.wingL.rotation.z = 0.1;
      ud.wingR.rotation.z = -0.1;
    }
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
