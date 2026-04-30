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
  PORTAL_SPAWN_INTERVAL, PORTAL_MAX_SPAWN, T_PORTAL_CLAIMED,
  NEED_HUNGER_RATE, NEED_SLEEP_RATE, NEED_CRITICAL, NEED_SATISFIED,
  EAT_DURATION, SLEEP_DURATION, HATCHERY_REGROW,
  HERO_SIGHT, SPECIES, AFFINITY,
  DISTRESS_RADIUS, DISTRESS_TTL, DISTRESS_MAX_RESPONDERS,
  PAY_DAY_INTERVAL, PAY_DAY_BANNER_DURATION,
  LEAVING_HAPPINESS, LEAVING_TIMEOUT,
} from './constants.js';
import { grid, creatures, portals, heroes, stats, treasuries, rally, rooms, sim, payDay } from './state.js';
import { creatureGroup } from './scene.js';
import {
  FLY_BODY_MAT, FLY_WING_MAT, FLY_EYE_MAT,
  BEETLE_CARAPACE_MAT, BEETLE_UNDER_MAT, BEETLE_EYE_MAT,
  GOBLIN_SKIN_MAT, GOBLIN_CLOTH_MAT, GOBLIN_BLADE_MAT, GOBLIN_EYE_MAT,
  WARLOCK_ROBE_MAT, WARLOCK_TRIM_MAT, WARLOCK_EYE_MAT, WARLOCK_STAFF_MAT,
  TROLL_SKIN_MAT, TROLL_APRON_MAT, TROLL_EYE_MAT, TROLL_HAMMER_MAT,
  NEED_HUNGER_MAT, NEED_SLEEP_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { findPath, isWalkable } from './pathfinding.js';
import { setLairOccupied, syncRoomChickenVisuals } from './rooms.js';
import { createLevelBadge } from './xp.js';
import { takeDamage } from './combat.js';
import { hasSlapBuff, SLAP_SPEED_MUL } from './slap.js';
import { createMoodBadge } from './mood.js';
import { pushEvent } from './hud.js';
import { createIntentBadge, setIntent, removeIntentBadgeFor } from './intent.js';

const THREE = window.THREE;

// ============================================================
// SPECIES MESH BUILDERS
// ============================================================
// Each species returns a THREE.Group with the body, and fills `parts` with
// the animation handles the updater uses (head, wings, legs, body). Species
// that don't have wings leave wingL/wingR null; the updater guards on that.

// A flat ring mesh parented to the creature group that becomes visible while
// the creature is actively benefiting from a room (training / studying / working).
// Color is updated per-frame from `roomBenefitKind` so the same ring can show
// red for training, blue for library, orange for workshop.
function _makeWorkAura() {
  const geo = new THREE.RingGeometry(0.38, 0.52, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mat.userData = { perInstance: true };
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  ring.visible = false;
  return ring;
}

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

export function createTroll() {
  // Broad-shouldered blacksmith with a huge hammer. Wears a leather apron.
  const group = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.26), TROLL_APRON_MAT);
  legs.position.y = 0.3;
  legs.castShadow = true;
  group.add(legs);
  // Torso — big, hunched
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.3), TROLL_SKIN_MAT);
  torso.position.y = 0.65;
  torso.castShadow = true;
  group.add(torso);
  // Apron — dark leather plate covering chest/legs
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.05), TROLL_APRON_MAT);
  apron.position.set(0, 0.55, 0.16);
  group.add(apron);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), TROLL_SKIN_MAT);
  head.scale.set(1.05, 1, 1);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);
  // Tusks
  const tuskGeo = new THREE.ConeGeometry(0.025, 0.08, 5);
  const tuskL = new THREE.Mesh(tuskGeo, TROLL_HAMMER_MAT);
  tuskL.position.set(-0.05, 0.94, 0.14);
  group.add(tuskL);
  const tuskR = tuskL.clone();
  tuskR.position.set(0.05, 0.94, 0.14);
  group.add(tuskR);
  // Eyes
  const eyeGeo = new THREE.SphereGeometry(0.032, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeo, TROLL_EYE_MAT);
  eyeL.position.set(-0.06, 1.03, 0.14);
  group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, TROLL_EYE_MAT);
  eyeR.position.set(0.06, 1.03, 0.14);
  group.add(eyeR);
  // Arms (large)
  const armGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.4, 6);
  const armL = new THREE.Mesh(armGeo, TROLL_SKIN_MAT);
  armL.position.set(-0.28, 0.62, 0);
  armL.rotation.z = 0.15;
  armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, TROLL_SKIN_MAT);
  armR.position.set(0.28, 0.62, 0);
  armR.rotation.z = -0.15;
  armR.castShadow = true;
  group.add(armR);
  // Big hammer in right hand
  const hammerPivot = new THREE.Group();
  hammerPivot.position.set(0.32, 0.4, 0);
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.48, 6), TROLL_APRON_MAT);
  haft.position.y = 0.18;
  hammerPivot.add(haft);
  const head2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.12), TROLL_HAMMER_MAT);
  head2.position.y = 0.45;
  head2.castShadow = true;
  hammerPivot.add(head2);
  group.add(hammerPivot);
  // Legs
  const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.28, 6);
  const legL = new THREE.Mesh(legGeo, TROLL_APRON_MAT);
  legL.position.set(-0.1, 0.16, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, TROLL_APRON_MAT);
  legR.position.set(0.1, 0.16, 0);
  group.add(legR);
  return { group, parts: { head, torso, armL, armR, legL, legR, hammer: hammerPivot, walks: true } };
}

// SKELETON — bone-white reanimated hero. Spawns from prison starvation.
export function createSkeleton() {
  const group = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xd0c8b0, roughness: 0.85, flatShading: true,
    emissive: 0x1a1410, emissiveIntensity: 0.15,
  });
  boneMat.userData = { perInstance: true };
  // Pelvis + ribcage stylized as stacked boxes
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.18), boneMat);
  pelvis.position.y = 0.35; pelvis.castShadow = true;
  group.add(pelvis);
  const ribcage = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.20), boneMat);
  ribcage.position.y = 0.62; ribcage.castShadow = true;
  group.add(ribcage);
  // Skull
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), boneMat);
  skull.position.y = 0.92; skull.castShadow = true;
  group.add(skull);
  // Eye sockets — two black voids
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x602030, emissiveIntensity: 1.4 });
  const eL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), socketMat);
  eL.position.set(-0.045, 0.94, 0.11); group.add(eL);
  const eR = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), socketMat);
  eR.position.set( 0.045, 0.94, 0.11); group.add(eR);
  // Arms — thin bones
  const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.32, 6);
  const armL = new THREE.Mesh(armGeo, boneMat);
  armL.position.set(-0.2, 0.58, 0); group.add(armL);
  const armR = new THREE.Mesh(armGeo, boneMat);
  armR.position.set( 0.2, 0.58, 0); group.add(armR);
  // Rusted blade in right hand
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.2, 0.42, 0);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.36, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.7, metalness: 0.5 })
  );
  blade.position.y = 0.2; swordPivot.add(blade);
  group.add(swordPivot);
  // Legs
  const legGeo = new THREE.CylinderGeometry(0.045, 0.04, 0.32, 6);
  const legL = new THREE.Mesh(legGeo, boneMat);
  legL.position.set(-0.08, 0.16, 0); group.add(legL);
  const legR = new THREE.Mesh(legGeo, boneMat);
  legR.position.set( 0.08, 0.16, 0); group.add(legR);
  return { group, parts: { head: skull, torso: ribcage, armL, armR, legL, legR, sword: swordPivot, walks: true } };
}

// VAMPIRE — dark robed predator with red cape and pale skin. Spawns from torture.
export function createVampire() {
  const group = new THREE.Group();
  const robeMat = new THREE.MeshStandardMaterial({
    color: 0x140810, roughness: 0.85, flatShading: true,
    emissive: 0x080004, emissiveIntensity: 0.2,
  });
  robeMat.userData = { perInstance: true };
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd8c0b0, roughness: 0.6, flatShading: true,
    emissive: 0x401020, emissiveIntensity: 0.12,
  });
  skinMat.userData = { perInstance: true };
  const capeMat = new THREE.MeshStandardMaterial({
    color: 0x701010, roughness: 0.85, flatShading: true,
    emissive: 0x200404, emissiveIntensity: 0.2, side: THREE.DoubleSide
  });
  capeMat.userData = { perInstance: true };
  // Long robe (cone)
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 8), robeMat);
  robe.position.y = 0.35; robe.castShadow = true;
  group.add(robe);
  // Torso
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.22), robeMat);
  chest.position.y = 0.7; chest.castShadow = true;
  group.add(chest);
  // Cape — plane behind shoulders
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.85), capeMat);
  cape.position.set(0, 0.55, -0.13);
  cape.rotation.x = 0.1;
  cape.castShadow = true;
  group.add(cape);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skinMat);
  head.position.y = 0.96; head.castShadow = true;
  group.add(head);
  // Slick black hair cap
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2),
    new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.7 })
  );
  hair.position.y = 0.96; group.add(hair);
  // Glowing red eyes
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff2030, emissive: 0xff0010, emissiveIntensity: 2.2,
  });
  const eyeGeo = new THREE.SphereGeometry(0.022, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.045, 0.97, 0.11); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set( 0.045, 0.97, 0.11); group.add(eyeR);
  // Arms folded out
  const armGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
  const armL = new THREE.Mesh(armGeo, robeMat);
  armL.position.set(-0.22, 0.65, 0); group.add(armL);
  const armR = new THREE.Mesh(armGeo, robeMat);
  armR.position.set( 0.22, 0.65, 0); group.add(armR);
  // Soft red point light at chest — vampires read at night
  const aura = new THREE.PointLight(0xc02030, 0.45, 2.5, 2);
  aura.position.y = 0.7;
  group.add(aura);
  return { group, parts: { head, torso: chest, armL, armR, cape, walks: true } };
}

// BILE DEMON — fat, gluttonous green-skinned brute. AoE poison cloud secondary.
export function createBileDemon() {
  const group = new THREE.Group();
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x507030, roughness: 0.85, flatShading: true,
    emissive: 0x102008, emissiveIntensity: 0.15,
  });
  skinMat.userData = { perInstance: true };
  // Massive belly
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.36, 12, 8), skinMat);
  belly.position.y = 0.4; belly.scale.set(1.0, 0.85, 1.0);
  belly.castShadow = true;
  group.add(belly);
  // Head — small, set on top of belly
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), skinMat);
  head.position.y = 0.85; head.castShadow = true;
  group.add(head);
  // Tusks
  const tuskMat = new THREE.MeshStandardMaterial({ color: 0xe0d0a0, roughness: 0.5 });
  for (const tx of [-0.05, 0.05]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.09, 5), tuskMat);
    tusk.position.set(tx, 0.78, 0.13);
    group.add(tusk);
  }
  // Yellow eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xfff080, emissive: 0xc0a020, emissiveIntensity: 1.4 });
  const eyeGeo = new THREE.SphereGeometry(0.025, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.05, 0.88, 0.13); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set( 0.05, 0.88, 0.13); group.add(eyeR);
  // Stubby arms
  const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.24, 6);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.32, 0.42, 0); armL.rotation.z = 0.4;
  armL.castShadow = true; group.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set( 0.32, 0.42, 0); armR.rotation.z = -0.4;
  armR.castShadow = true; group.add(armR);
  // Tiny legs
  const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.16, 6);
  const legL = new THREE.Mesh(legGeo, skinMat);
  legL.position.set(-0.12, 0.08, 0); group.add(legL);
  const legR = new THREE.Mesh(legGeo, skinMat);
  legR.position.set( 0.12, 0.08, 0); group.add(legR);
  return { group, parts: { head, torso: belly, armL, armR, legL, legR, walks: true } };
}

// MISTRESS — slim, leather-clad, pale skin, whip in hand. High-DPS striker.
export function createMistress() {
  const group = new THREE.Group();
  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x180810, roughness: 0.5, metalness: 0.2, flatShading: true
  });
  leatherMat.userData = { perInstance: true };
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xe0c0b8, roughness: 0.55, flatShading: true
  });
  skinMat.userData = { perInstance: true };
  // Legs
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.18), leatherMat);
  legs.position.y = 0.32; legs.castShadow = true;
  group.add(legs);
  // Torso — corseted
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.2), leatherMat);
  chest.position.y = 0.7; chest.castShadow = true;
  group.add(chest);
  // Bare arms (skin)
  const armGeo = new THREE.BoxGeometry(0.07, 0.32, 0.07);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.2, 0.66, 0); group.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set( 0.2, 0.66, 0); group.add(armR);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), skinMat);
  head.position.y = 0.95; head.castShadow = true;
  group.add(head);
  // Long black hair
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x080606, roughness: 0.7 })
  );
  hair.position.y = 0.98;
  group.add(hair);
  // Red eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3050, emissive: 0xc01020, emissiveIntensity: 1.4 });
  const eyeGeo = new THREE.SphereGeometry(0.018, 6, 4);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.04, 0.96, 0.10); group.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set( 0.04, 0.96, 0.10); group.add(eyeR);
  // Whip — coiled rope in right hand
  const whipPivot = new THREE.Group();
  whipPivot.position.set(0.22, 0.5, 0);
  const whipMat = new THREE.MeshStandardMaterial({ color: 0x301010, roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.10, 5), whipMat);
    seg.position.y = -0.05 - i * 0.08;
    seg.rotation.z = (i % 2 === 0 ? 0.18 : -0.18);
    whipPivot.add(seg);
  }
  group.add(whipPivot);
  return { group, parts: { head, torso: chest, armL, armR, sword: whipPivot, walks: true } };
}

// DARK KNIGHT — heavy plate armor, two-handed greatsword. Hero-counter unit.
export function createDarkKnight() {
  const group = new THREE.Group();
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x282028, roughness: 0.45, metalness: 0.85, flatShading: true,
    emissive: 0x100010, emissiveIntensity: 0.18,
  });
  plateMat.userData = { perInstance: true };
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x803020, roughness: 0.5, metalness: 0.6, flatShading: true,
    emissive: 0x300808, emissiveIntensity: 0.4,
  });
  trimMat.userData = { perInstance: true };
  // Legs
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.4, 0.26), plateMat);
  legs.position.y = 0.32; legs.castShadow = true;
  group.add(legs);
  // Chest — armored
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.3), plateMat);
  chest.position.y = 0.74; chest.castShadow = true;
  group.add(chest);
  // Crimson trim across chest
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.32), trimMat);
  trim.position.y = 0.55;
  group.add(trim);
  // Shoulder pads (spiked)
  for (const sx of [-0.26, 0.26]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), plateMat);
    pad.position.set(sx, 0.92, 0); pad.rotation.x = Math.PI;
    pad.castShadow = true;
    group.add(pad);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 5), trimMat);
    spike.position.set(sx, 1.04, 0);
    group.add(spike);
  }
  // Helmet — closed, with horns
  const helm = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.5),
    plateMat
  );
  helm.position.y = 1.0; helm.castShadow = true;
  group.add(helm);
  for (const hx of [-0.13, 0.13]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.18, 5), trimMat);
    horn.position.set(hx, 1.1, 0);
    horn.rotation.z = hx > 0 ? -0.7 : 0.7;
    group.add(horn);
  }
  // Glowing visor slit
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.02, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 2.0 })
  );
  visor.position.set(0, 1.0, 0.14);
  group.add(visor);
  // Greatsword in right hand
  const swordPivot = new THREE.Group();
  swordPivot.position.set(0.28, 0.55, 0);
  const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 6), trimMat);
  hilt.position.y = 0.06; swordPivot.add(hilt);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), trimMat);
  guard.position.y = 0.15; swordPivot.add(guard);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.7, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x404048, roughness: 0.4, metalness: 0.9, flatShading: true })
  );
  blade.position.y = 0.52; blade.castShadow = true;
  swordPivot.add(blade);
  group.add(swordPivot);
  // Arms
  const armGeo = new THREE.BoxGeometry(0.1, 0.32, 0.1);
  const armL = new THREE.Mesh(armGeo, plateMat);
  armL.position.set(-0.26, 0.7, 0); armL.castShadow = true;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, plateMat);
  armR.position.set( 0.26, 0.7, 0); armR.castShadow = true;
  group.add(armR);
  return { group, parts: { head: helm, torso: chest, armL, armR, sword: swordPivot, walks: true } };
}

// Dispatcher — returns { group, parts } for the chosen species.
function _createSpeciesBody(species) {
  if (species === 'beetle')     return createBeetle();
  if (species === 'goblin')     return createGoblin();
  if (species === 'warlock')    return createWarlock();
  if (species === 'troll')      return createTroll();
  if (species === 'skeleton')   return createSkeleton();
  if (species === 'vampire')    return createVampire();
  if (species === 'biledemon')  return createBileDemon();
  if (species === 'mistress')   return createMistress();
  if (species === 'darkknight') return createDarkKnight();
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

  // Aura ring that lights up while the creature is actively using a room.
  const workAura = _makeWorkAura();
  group.add(workAura);

  group.userData = {
    state: 'wandering',
    faction: FACTION_PLAYER,
    species,                       // 'fly' | 'beetle' | 'goblin' | 'warlock'
    favoriteRoom: def.favoriteRoom,
    hp: def.hp, maxHp: def.hp,
    atk: def.atk, atkCooldown: 0, atkRange: def.atkRange,
    baseSpeed: def.speed, baseWanderSpeed: def.wanderSpeed, baseAtkCooldown: def.atkCooldown,
    secondaryCooldown: 0, secondaryAnnounced: false,
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
    workAura,
    roomBenefitKind: null, roomBenefitUntil: 0,
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
      // Hatchery food: only consider tiles that still have chickens to eat.
      // Legacy `depletedUntil` is no longer used — `chickens === 0` is the
      // true depleted signal.
      if (skipDepleted && cell.roomType === ROOM_HATCHERY && (cell.chickens || 0) <= 0) continue;
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
  ud.secondaryCooldown = Math.max(0, (ud.secondaryCooldown || 0) - dt * speedMul);

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
      _attackChoose(c, nearest, def, d);
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
      _attackChoose(c, nearest, def, d);
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

// Pick primary vs. secondary on a strike. Secondary becomes available at
// SPECIES[*].secondaryMove.learnedAt (level 3 by default), respects its own
// cooldown, and applies via _applyAttackKind for AoE/chain/dash effects.
function _attackChoose(c, target, def, dist) {
  const ud = c.userData;
  const sec = def.secondaryMove;
  const canSecondary = sec && ud.level >= sec.learnedAt && ud.secondaryCooldown <= 0 && dist <= sec.range;
  if (canSecondary) {
    _applyAttackKind(c, target, sec);
    ud.secondaryCooldown = sec.cooldown;
    // Primary cooldown still nudges so the creature doesn't spam-stack a primary
    // immediately after a secondary in the same frame on the next tick.
    ud.atkCooldown = ud.baseAtkCooldown * 0.6;
    ud.timer = 0.2;
    return;
  }
  // Primary attack — preserves the original takeDamage call path.
  takeDamage(target, ud.atk, c);
  ud.atkCooldown = ud.baseAtkCooldown;
  ud.timer = 0.15;
}

// Apply a secondary move's effect by `kind`. Each kind layers on top of the
// base damage with a flavor-specific twist (AoE, second jump, dash, etc.) and
// a distinct visual cue so the player reads the new ability at a glance.
function _applyAttackKind(c, target, move) {
  const tx = target.position.x, tz = target.position.z;
  switch (move.kind) {
    case 'crit': {
      // Single big hit on the primary target. Goblin's "cheap shot".
      takeDamage(target, move.atk, c);
      spawnSparkBurst(tx, tz, 0xffe04a, 18, 1.1);
      break;
    }
    case 'ram': {
      // Beetle "shell ram": damage + small knockback.
      takeDamage(target, move.atk, c);
      const ddx = tx - c.position.x, ddz = tz - c.position.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      target.position.x += (ddx / dd) * 0.35;
      target.position.z += (ddz / dd) * 0.35;
      spawnSparkBurst(tx, tz, 0xc89a60, 22, 1.2);
      break;
    }
    case 'dash': {
      // Fly "swarm dive": small forward dash, then strike.
      const ddx = tx - c.position.x, ddz = tz - c.position.z;
      const dd = Math.hypot(ddx, ddz) || 1;
      c.position.x += (ddx / dd) * 0.5;
      c.position.z += (ddz / dd) * 0.5;
      takeDamage(target, move.atk, c);
      spawnSparkBurst(tx, tz, 0x8aff80, 20, 1.0);
      break;
    }
    case 'chain': {
      // Warlock "chain zap": primary hit, then jump to the nearest other hero
      // within move.range for half damage, with a lightning-bolt visual.
      takeDamage(target, move.atk, c);
      let next = null, nextD = move.range;
      for (const h of heroes) {
        if (h === target || !h.userData || h.userData.hp <= 0) continue;
        const d = Math.hypot(h.position.x - tx, h.position.z - tz);
        if (d < nextD) { nextD = d; next = h; }
      }
      if (next) {
        takeDamage(next, Math.round(move.atk * 0.5), c);
        spawnSparkBurst(next.position.x, next.position.z, 0xc080ff, 16, 1.0);
      }
      spawnPulse(tx, tz, 0xa060ff, 0.25, 1.1);
      break;
    }
    case 'cleave': {
      // Troll "cleave": damage all heroes within move.range of the primary target.
      let hitCount = 0;
      for (const h of heroes) {
        if (!h.userData || h.userData.hp <= 0) continue;
        const d = Math.hypot(h.position.x - tx, h.position.z - tz);
        if (d <= move.range) { takeDamage(h, move.atk, c); hitCount++; }
      }
      void hitCount;
      spawnPulse(tx, tz, 0xff8040, 0.3, 1.4);
      spawnSparkBurst(tx, tz, 0xffa860, 24, 1.2);
      break;
    }
    case 'lifesteal': {
      // Vampire bite: full damage AND heal half of damage dealt to the caster.
      const before = target.userData ? target.userData.hp : 0;
      takeDamage(target, move.atk, c);
      const dealt = before - (target.userData ? target.userData.hp : before);
      const heal = Math.max(0, Math.round(dealt * 0.5));
      const cu = c.userData;
      if (cu && heal > 0) cu.hp = Math.min(cu.maxHp, cu.hp + heal);
      spawnPulse(c.position.x, c.position.z, 0xc02030, 0.25, 1.2);
      spawnSparkBurst(tx, tz, 0xff2040, 18, 1.0);
      break;
    }
    default: {
      // Unknown kind — just deal flat damage.
      takeDamage(target, move.atk, c);
      break;
    }
  }
  playSfx('strike_special', { minInterval: 120 });
}

// Drop-on-portal kick-out animation. Lifecycle: 'leaving' state for
// LEAVE_DURATION seconds — fade material opacity, shrink scale, spin slowly,
// then remove from scene + creatures[]. We never restore opacity afterward
// because the entity is destroyed at the end.
const LEAVE_DURATION = 1.0;
function _tickLeavingCreature(c, dt) {
  const ud = c.userData;
  ud.leaveProgress = (ud.leaveProgress || 0) + dt / LEAVE_DURATION;
  const t = Math.min(1, ud.leaveProgress);
  const inv = 1 - t;
  // Spin + lift while shrinking
  c.rotation.y += dt * 6;
  c.position.y = 0.3 + t * 0.6;
  c.scale.setScalar(Math.max(0.05, inv));
  // Fade every material on every part. Materials must be cloned per-instance
  // ahead of time (most species mats already have userData.perInstance set);
  // we set transparent + opacity defensively so a shared base mat doesn't
  // bleed into siblings — when in doubt, clone on first leave.
  c.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m._leaveCloned && !(m.userData && m.userData.perInstance)) {
        const clone = m.clone();
        if (Array.isArray(o.material)) {
          const i = o.material.indexOf(m);
          o.material[i] = clone;
        } else {
          o.material = clone;
        }
        clone._leaveCloned = true;
        clone.transparent = true;
        clone.opacity = inv;
      } else {
        m.transparent = true;
        m.opacity = inv;
      }
    }
  });
  if (t >= 1) {
    // Fully gone — remove the creature.
    creatureGroup.remove(c);
    const idx = creatures.indexOf(c);
    if (idx >= 0) creatures.splice(idx, 1);
    // Dispose any geometry/material the creature owns. Shared materials
    // (no perInstance flag, no _leaveCloned) are skipped — same convention
    // the rest of the codebase uses.
    c.traverse((o) => {
      if (o.geometry && o.geometry.dispose && !o.geometry._shared) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m._leaveCloned || (m.userData && m.userData.perInstance)) {
            m.dispose();
          }
        }
      }
    });
    removeIntentBadgeFor(c);
    if (typeof stats.creatures === 'number') stats.creatures = Math.max(0, stats.creatures - 1);
  }
}

// Begin the leaving sequence — exposed so hand.js can trigger it on portal drop.
export function startCreatureLeaving(c) {
  const ud = c.userData;
  ud.state = 'leaving';
  ud.leaveProgress = 0;
  // Cancel any reservations / behaviors so other systems don't keep targeting it.
  ud.fightTarget = null;
  ud.path = null;
  ud.target = null;
  if (ud.handGlow) ud.handGlow.visible = false;
}

// Combined speed multiplier from slap, haste, rally. Read by combat + movement.
function _speedMul(ud) {
  let m = 1;
  if (hasSlapBuff({ userData: ud })) m *= SLAP_SPEED_MUL;
  if (ud.hasteUntil && sim.time < ud.hasteUntil) m *= 1.5;
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

  const nowSec = sim.time;
  const def = SPECIES[ud.species] || SPECIES.fly;
  const hunger = ud.needs.hunger;
  const sleep  = ud.needs.sleep;
  const overdue = Math.max(0, (ud.paySince - 90) / 90);
  const happy = ud.happiness != null ? ud.happiness : 1;
  const currentKind = ud.target ? ud.target.kind : null;
  // Wound pressure pulls creatures toward Lair to heal even when not tired —
  // 0 at full HP, 1 at 0 HP. Folded into the sleep score below.
  const woundPress = Math.max(0, 1 - ud.hp / ud.maxHp);

  // Bonus for the current goal — prevents jittery flip-flops between close scores.
  const stick = (kind) => (currentKind === kind ? 0.08 : 0);

  // --- Score each candidate; cache the resolver so we only pathfind for winner ---
  const candidates = [
    { kind: 'eat',      score: hunger * 1.05 + stick('eat') },
    { kind: 'sleep',    score: Math.max(sleep, woundPress * 0.9) * 0.95 + stick('sleep') },
    { kind: 'pay',      score: (overdue > 0 ? 0.65 + overdue * 0.2 : 0) + stick('pay') },
    { kind: 'help',     score: _distressScore(c, nowSec) + stick('help') },
    { kind: 'rally',    score: (rally.active && nowSec < rally.expiresAt ? 0.55 : 0) + stick('rally') },
    { kind: 'train',    score: (happy > 0.55 && hunger < 0.6 && sleep < 0.6 ? 0.35 : 0) + stick('train') },
    { kind: 'study',    score: (ud.species === 'warlock' && happy > 0.4 ? 0.45 : 0) + stick('study') },
    { kind: 'work',     score: (ud.species === 'troll' && happy > 0.35 ? 0.55 : 0) + stick('work') },
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
  if (kind === 'work') return 'work';
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
    const nowSec = sim.time;
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
  if (kind === 'work') {
    return findNearestRoomTile(ud.gridX, ud.gridZ, 'workshop', false);
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
const PAY_INTERVAL = 90;           // seconds between wages
const PAY_BASE_AMOUNT = 8;          // gold per level (scales with creature.level)
// Anger curves rebalanced 2026-04-29: previous rates flipped a creature angry
// after ~25 s of overdue pay or a few seconds standing near a disliked friend.
// Halved gain rates + faster passive decay so mood is forgiving by default and
// only persistent neglect breaks it.
const ANGER_DECAY_PER_SEC = 0.04;   // calm down faster (was 0.02)
const ANGER_UNPAID_PER_SEC = 0.02;  // rise while pay overdue (was 0.04)
const ANGER_PAY_RELIEF = 0.5;       // drop when finally paid (was 0.3)
const ANGER_OVERDUE_GRACE = 30;     // grace past PAY_INTERVAL before anger climbs (was 15)

export function computeHappiness(ud) {
  // Lighter weights so a single bad day doesn't ruin the mood. Needs still
  // dominate but no longer single-handedly tip the creature into "angry" —
  // it now takes either two factors at once, or one extreme one.
  const needPress = Math.max(ud.needs.hunger, ud.needs.sleep);
  const overdue = Math.max(0, (ud.paySince - PAY_INTERVAL) / PAY_INTERVAL);
  const h = 1 - needPress * 0.4 - (ud.anger || 0) * 0.35 - overdue * 0.15;
  return Math.max(0, Math.min(1, h));
}

// Affinity check — adjacent disliked species push anger up, friends calm it down.
// Kept simple: just scan the creatures array with an early distance filter.
// Called inside tickCreatureSocial with the same dt.
const AFFINITY_RANGE = 1.8;             // tiles
const AFFINITY_ANGER_PER_SEC = 0.03;     // dislike pair close together (halved 2026-04-29)
const AFFINITY_CALM_PER_SEC  = 0.025;    // friends close together (slight buff to balance)
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

// Affinity scan is O(creatures) per call; running it every frame for every
// creature is O(n²). Stagger it on a per-creature timer (~0.5 s) and feed the
// elapsed window in as dt so the per-second anger rates stay unchanged.
const AFFINITY_TICK_INTERVAL = 0.5;
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
  // Random-offset initial value spreads the work across frames instead of
  // every creature spiking on the same tick.
  if (ud._affinityTimer == null) ud._affinityTimer = Math.random() * AFFINITY_TICK_INTERVAL;
  ud._affinityTimer += dt;
  if (ud._affinityTimer >= AFFINITY_TICK_INTERVAL) {
    _applyAffinity(c, ud._affinityTimer);
    ud._affinityTimer = 0;
  }
  ud.happiness = computeHappiness(ud);

  // Angry-leaving check — sustained low happiness packs the creature up.
  // `angryFor` accumulates seconds the creature has been below the threshold;
  // resets if happiness recovers. Once it crosses LEAVING_TIMEOUT, the
  // creature flips to leaving_angry and walks to the nearest claimed portal.
  if (ud.state !== 'leaving' && ud.state !== 'leaving_angry' && ud.state !== 'held' && ud.state !== 'possessed') {
    if (ud.happiness < LEAVING_HAPPINESS) {
      ud.angryFor = (ud.angryFor || 0) + dt;
      if (ud.angryFor >= LEAVING_TIMEOUT) {
        _startAngryLeaving(c);
      }
    } else {
      // Recover quickly so a brief dip doesn't queue an exit.
      ud.angryFor = Math.max(0, (ud.angryFor || 0) - dt * 2);
    }
  }
}

// Begin the "angry, packing my bags" flow. Path to the nearest claimed portal
// and walk there manually; once adjacent, trigger the existing leave fade.
function _startAngryLeaving(c) {
  const ud = c.userData;
  ud.state = 'leaving_angry';
  ud.path = null;
  ud.target = null;
  ud.fightTarget = null;
  removeIntentBadgeFor(c);
  pushEvent(`${ud.species || 'Creature'} is leaving — too unhappy`);
  playSfx('whoosh', { minInterval: 200 });
}

// Locate the closest claimed portal reachable from (x, z). Returns
// {x, z, path} or null. Reused by the angry-leaving walker.
function _findNearestClaimedPortal(fromX, fromZ) {
  let best = null, bestLen = Infinity;
  for (const p of portals) {
    if (!p.claimed) continue;
    const path = findPath(fromX, fromZ, p.x, p.z);
    if (path && path.length < bestLen) {
      bestLen = path.length;
      best = { x: p.x, z: p.z, path };
    }
  }
  return best;
}

// Per-frame tick for a creature in leaving_angry state — walks toward portal,
// then drops into the existing leaving (kick-out) fade animation.
function _tickAngryLeaving(c, dt) {
  const ud = c.userData;
  // Re-plan path if we don't have one or have arrived at the end.
  if (!ud.path || ud.pathIdx >= (ud.path ? ud.path.length : 0)) {
    const tgt = _findNearestClaimedPortal(ud.gridX, ud.gridZ);
    if (!tgt) {
      // No claimed portal reachable — just dissolve in place.
      ud.state = 'leaving';
      ud.leaveProgress = 0;
      return;
    }
    ud.path = tgt.path;
    ud.pathIdx = 0;
    ud.angryPortalX = tgt.x;
    ud.angryPortalZ = tgt.z;
  }
  // Walk along the path.
  const next = ud.path[ud.pathIdx];
  const dx = next.x - c.position.x;
  const dz = next.z - c.position.z;
  const dist = Math.hypot(dx, dz);
  const speed = ud.baseSpeed * 1.1;   // marches with purpose
  if (dist < 0.1) {
    c.position.x = next.x; c.position.z = next.z;
    ud.gridX = next.x; ud.gridZ = next.z;
    ud.pathIdx++;
  } else {
    c.position.x += (dx / dist) * speed * dt;
    c.position.z += (dz / dist) * speed * dt;
    ud.facing = Math.atan2(dx, dz);
    let diff = ud.facing - c.rotation.y;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    c.rotation.y += diff * Math.min(1, dt * 8);
  }
  // Arrived at portal? Trigger the kick-out fade.
  const pdx = ud.angryPortalX - c.position.x;
  const pdz = ud.angryPortalZ - c.position.z;
  if (Math.hypot(pdx, pdz) < 0.6) {
    ud.state = 'leaving';
    ud.leaveProgress = 0;
    spawnPulse(ud.angryPortalX, ud.angryPortalZ, 0xa060ff, 0.35, 1.4);
    spawnSparkBurst(ud.angryPortalX, ud.angryPortalZ, 0xc080ff, 26, 1.3);
    playSfx('portal_dismiss');
  }
}

// ============================================================
// PAY DAY — global wage event every PAY_DAY_INTERVAL seconds.
// ============================================================
// On fire: every creature is forced overdue (paySince spikes) so their AI
// scoring drives them to the nearest treasury. Each creature attempts a real
// payment via tryPayCreature; failures are tallied and announced.
export function tickPayDay() {
  const now = sim.time;
  if (now < payDay.nextAt) return;
  // Fire pay day.
  payDay.lastAt = now;
  payDay.nextAt = now + PAY_DAY_INTERVAL;
  payDay.bannerUntil = now + PAY_DAY_BANNER_DURATION;
  payDay.unpaidCount = 0;

  let paid = 0, unpaid = 0, totalGold = 0;
  for (const c of creatures) {
    const ud = c.userData;
    if (!ud || ud.hp <= 0) continue;
    // Force overdue — AI picks up the pay goal next tick. tryPayCreature also
    // executes here as a same-frame deduction so fast-resolved cycles don't
    // need the creature to physically arrive at a treasury.
    ud.paySince = PAY_DAY_INTERVAL;
    const ok = tryPayCreature(c, treasuries);
    if (ok) {
      paid++;
      const wage = (ud.lastWage || 0);
      totalGold += wage;
    } else {
      unpaid++;
      // Bigger anger spike for missed pay-day vs. ordinary overdue.
      ud.anger = Math.min(1, (ud.anger || 0) + 0.35);
    }
  }
  payDay.unpaidCount = unpaid;
  pushEvent(unpaid === 0
    ? `Pay day — ${paid} paid (${totalGold}g)`
    : `Pay day — ${unpaid} UNPAID, anger rising`);
  playSfx(unpaid === 0 ? 'coin' : 'alarm', { minInterval: 200 });
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
      ud.lastWage = taken;
      playSfx('coin', { minInterval: 120 });
      return true;
    }
  }
  // No gold available — creature remains unpaid; anger will climb.
  return false;
}

export function updateCreature(c, dt) {
  const ud = c.userData;

  // Possessed: player drives this creature directly via possession.js. AI is
  // paused; needs still tick so the ride has consequences (hunger climbs).
  if (ud.state === 'possessed') {
    ud.needs.hunger = Math.min(1, ud.needs.hunger + NEED_HUNGER_RATE * dt);
    ud.needs.sleep  = Math.min(1, ud.needs.sleep  + NEED_SLEEP_RATE  * dt);
    return;
  }

  // Angry-leaving — walking to a portal of their own accord. Splits from
  // the kicked-out 'leaving' state because we still need pathfinding here;
  // 'leaving' is the dissolve animation only.
  if (ud.state === 'leaving_angry') {
    _tickAngryLeaving(c, dt);
    return;
  }

  // Leaving the dungeon (kicked out via portal, or arrived at one angrily).
  // Fade + shrink + spin, then despawn.
  if (ud.state === 'leaving') {
    _tickLeavingCreature(c, dt);
    return;
  }

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

  // Slow passive HP regen out of combat — minor wounds knit on their own,
  // but it isn't enough to substitute for a Lair stay or the Heal spell.
  if (ud.hp > 0 && ud.hp < ud.maxHp &&
      ud.state !== 'fighting' && ud.state !== 'fleeing' && ud.state !== 'sleeping') {
    ud.hp = Math.min(ud.maxHp, ud.hp + ud.maxHp * 0.01 * dt);
  }

  // --- Work-aura display — visible while actively benefiting from a room ---
  // Ring color + pulse read across the table: red = train, blue = study,
  // orange = work. Fades out the instant they step off the room tile.
  if (ud.workAura) {
    const nowS = sim.time;
    const active = ud.roomBenefitUntil && nowS < ud.roomBenefitUntil;
    if (active) {
      const col = ud.roomBenefitKind === 'study' ? 0x6080ff
                : ud.roomBenefitKind === 'work'  ? 0xff8020
                : 0xff5040;                                    // train
      ud.workAura.material.color.setHex(col);
      const pulse = 0.55 + Math.sin(performance.now() * 0.008) * 0.25;
      ud.workAura.material.opacity = pulse;
      ud.workAura.visible = true;
      ud.workAura.rotation.z += dt * 1.6;
      const s = 1 + Math.sin(performance.now() * 0.004) * 0.08;
      ud.workAura.scale.setScalar(s);
    } else if (ud.workAura.visible) {
      ud.workAura.visible = false;
      ud.workAura.material.opacity = 0;
    }
  }

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
      if (ud.commitUntil && sim.time < ud.commitUntil) return;
    }
  }

  // Commit pause: once a new path is chosen, freeze for commitPause seconds
  // while the creature turns to face the target. Reads as deliberate thought.
  if (ud.commitUntil && sim.time < ud.commitUntil) {
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
        // Verify still a hatchery tile and still has chickens to eat
        if (cell.roomType === ROOM_HATCHERY && (cell.chickens || 0) > 0) {
          // Consume one chicken at the moment eating begins so concurrent
          // eaters don't all snag the same bird.
          cell.chickens = Math.max(0, (cell.chickens || 0) - 1);
          if (!cell.chickenRegrowAt) {
            cell.chickenRegrowAt = sim.time + HATCHERY_REGROW_PER_CHICKEN;
          }
          ud.state = 'eating';
          ud.timer = EAT_DURATION;
        } else {
          ud.state = 'wandering';  // tile out of food, re-search next tick
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
      // Chicken was already deducted when 'eating' began (see kind:'eat' arrival
      // branch above), so no further inventory change here. Egg-prop visual
      // still flips on if the tile has run dry, signalling "needs to regrow".
      if (cell.roomType === ROOM_HATCHERY) {
        const rm = cell.roomMesh;
        if (rm && rm.userData.egg && (cell.chickens || 0) <= 0) {
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
    // Regenerate HP while asleep. Full-sleep duration (SLEEP_DURATION) heals
    // roughly 70% of maxHp — substantial recovery from a Lair stay, while
    // still leaving room for the Heal spell to top off the rest.
    if (ud.hp < ud.maxHp) {
      const healPerSec = ud.maxHp * 0.70 / SLEEP_DURATION;
      ud.hp = Math.min(ud.maxHp, ud.hp + healPerSec * dt);
    }
    if (ud.timer <= 0) {
      ud.needs.sleep = NEED_SATISFIED;
      ud.state = 'wandering';
      ud.wanderCooldown = 0.5;
    }
    return;
  }
}

// Tick the hatchery: regrow chicken inventory + animate eggs on tiles whose
// pen has been emptied. Each tile grows one chicken per HATCHERY_REGROW_PER_CHICKEN
// seconds while under HATCHERY_TILE_CAP. The room's wandering chicken meshes
// are resynced any time the count changes so the visible flock matches stock.
export function tickHatcheryRegrowth() {
  const now = sim.time;
  for (const room of rooms) {
    if (room.type !== ROOM_HATCHERY) continue;
    let countChanged = false;
    for (const key of room.tiles) {
      const [x, z] = key.split(',').map(Number);
      const cell = grid[x][z];
      if (cell.chickens == null) cell.chickens = HATCHERY_TILE_CAP;
      const rm = cell.roomMesh;
      const egg = rm && rm.userData ? rm.userData.egg : null;

      // Regrow logic — only schedule + advance while under the cap.
      if ((cell.chickens || 0) < HATCHERY_TILE_CAP) {
        if (!cell.chickenRegrowAt) {
          cell.chickenRegrowAt = now + HATCHERY_REGROW_PER_CHICKEN;
        } else if (cell.chickenRegrowAt <= now) {
          cell.chickens = (cell.chickens || 0) + 1;
          countChanged = true;
          if (cell.chickens < HATCHERY_TILE_CAP) {
            cell.chickenRegrowAt = now + HATCHERY_REGROW_PER_CHICKEN;
          } else {
            cell.chickenRegrowAt = null;
          }
          spawnPulse(x, z, 0xffd060, 0.2, 0.7);
          spawnSparkBurst(x, z, 0xf0e8d8, 12, 0.7);
        }
      } else {
        cell.chickenRegrowAt = null;
      }

      // Egg prop: visible when the tile is fully depleted (no chickens left)
      // — telegraphs "needs to regrow" without intruding on the steady-state.
      if (egg) {
        const isEmpty = (cell.chickens || 0) <= 0;
        egg.visible = isEmpty;
        if (isEmpty && cell.chickenRegrowAt) {
          const remaining = Math.max(0, cell.chickenRegrowAt - now);
          if (remaining < 1.5) {
            const phase = performance.now() * 0.018 + (egg.userData ? egg.userData.basePhase : 0);
            const intensity = 1 - (remaining / 1.5);
            egg.rotation.z = Math.sin(phase * 3) * 0.3 * intensity;
            egg.rotation.x = Math.cos(phase * 2.7) * 0.2 * intensity;
            egg.position.y = 0.18 + Math.abs(Math.sin(phase * 2)) * 0.03 * intensity;
          } else {
            const phase = performance.now() * 0.002 + (egg.userData ? egg.userData.basePhase : 0);
            egg.rotation.z = Math.sin(phase) * 0.06;
            egg.position.y = 0.18 + Math.sin(phase * 1.3) * 0.01;
          }
        }
      }
    }
    // Always sync visuals — also catches consumption events (which decrement
    // cell.chickens elsewhere) on the next frame without needing extra hooks.
    syncRoomChickenVisuals(room);
    void countChanged;
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

// Animate portal swirls every frame (rotation feels alive). Iterate the
// portals registry directly — used to scan all 900 grid cells for the few
// portal tiles, which is wasteful.
export function animatePortals(t) {
  for (const portal of portals) {
    const cell = grid[portal.x][portal.z];
    const m = cell.mesh;
    if (!m || !m.userData.swirl) continue;
    m.userData.swirl.rotation.z = t * 0.9;
    m.userData.swirl2.rotation.z = -t * 1.5;
    // Active (claimed) portals pulse stronger
    const pulseRate = portal.claimed ? 3.5 : 1.8;
    const pulseAmp  = portal.claimed ? 0.6 : 0.25;
    m.userData.portalLight.intensity = 1.0 + Math.sin(t * pulseRate) * pulseAmp;
  }
}
