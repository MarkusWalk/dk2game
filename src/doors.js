// ============================================================
// DOORS — Workshop output; funnels heroes through chokepoints
// ============================================================
// Doors are placed on claimed floor tiles. Heroes treat an occupied door
// tile as an obstacle and attack the door until it breaks; player units
// pass through freely (the AI treats the tile as walkable).
//
// Implementation: the door is a mesh + HP owned by entries in `doors`.
// The hero AI consults `doorAt(x, z)` in its movement tick — if the next
// path tile has a door, it halts there and swings at it. Once the door's
// HP hits zero, the mesh is cleaned up and the array entry is removed.

import {
  DOOR_WOOD_HP, DOOR_STEEL_HP,
  DOOR_WOOD_COST, DOOR_STEEL_COST,
  T_CLAIMED, T_FLOOR, FACTION_PLAYER,
} from './constants.js';
import { doors, grid, stats } from './state.js';
import { scene } from './scene.js';
import {
  DOOR_WOOD_MAT, DOOR_WOOD_BAND_MAT,
  DOOR_STEEL_MAT, DOOR_STEEL_STUD_MAT,
  DOOR_RUNE_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { pushEvent } from './hud.js';
import { spawnSparkBurst } from './effects.js';

const THREE = window.THREE;

export function doorAt(x, z) {
  for (const d of doors) if (d.x === x && d.z === z && d.hp > 0) return d;
  return null;
}

function _buildWoodDoor(x, z) {
  const g = new THREE.Group();
  // Main plank slab
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.9, 0.12), DOOR_WOOD_MAT);
  slab.position.set(0, 0.55, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  g.add(slab);
  // Iron bands
  for (const by of [0.25, 0.85]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.14), DOOR_WOOD_BAND_MAT);
    band.position.set(0, by, 0);
    g.add(band);
  }
  // Single rune in the middle
  const rune = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 14), DOOR_RUNE_MAT);
  rune.rotation.y = Math.PI / 2;
  rune.position.set(0, 0.55, 0.07);
  g.add(rune);
  g.position.set(x, 0, z);
  return g;
}

function _buildSteelDoor(x, z) {
  const g = new THREE.Group();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.96, 0.14), DOOR_STEEL_MAT);
  slab.position.set(0, 0.56, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  g.add(slab);
  // Cross bars
  for (const by of [0.25, 0.85]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.08, 0.16), DOOR_STEEL_STUD_MAT);
    band.position.set(0, by, 0);
    g.add(band);
  }
  // Corner studs
  for (const [sx, sy] of [[-0.38, 0.18], [0.38, 0.18], [-0.38, 0.9], [0.38, 0.9]]) {
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 8), DOOR_STEEL_STUD_MAT);
    stud.rotation.x = Math.PI / 2;
    stud.position.set(sx, sy, 0.08);
    g.add(stud);
  }
  // Rune emblem
  const rune = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.025, 6, 16), DOOR_RUNE_MAT);
  rune.rotation.y = Math.PI / 2;
  rune.position.set(0, 0.56, 0.09);
  g.add(rune);
  g.position.set(x, 0, z);
  return g;
}

// Place a door at (x,z). Returns true on success. Requires manufacturing
// points + walkable player floor (claimed OR unclaimed dug floor) + no
// existing door / room on the tile.
export function placeDoor(x, z, kind) {
  if (!grid[x] || !grid[x][z]) return false;
  const cell = grid[x][z];
  if (cell.type !== T_CLAIMED && cell.type !== T_FLOOR) {
    pushEvent('Doors go on dug floor only');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  if (cell.roomType) {
    pushEvent('Can\'t place door on a room tile');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  if (doorAt(x, z)) {
    pushEvent('Door already here');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  const cost = kind === 'steel' ? DOOR_STEEL_COST : DOOR_WOOD_COST;
  if ((stats.manufacturing || 0) < cost) {
    pushEvent(`Need ${cost} mfg (have ${Math.floor(stats.manufacturing || 0)}). Build a Workshop + Troll.`);
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  const hp = kind === 'steel' ? DOOR_STEEL_HP : DOOR_WOOD_HP;
  const mesh = kind === 'steel' ? _buildSteelDoor(x, z) : _buildWoodDoor(x, z);
  scene.add(mesh);
  const door = {
    x, z, kind, mesh,
    hp, maxHp: hp,
    // userData shape matches combatant so takeDamage() works on us
    userData: {
      faction: 'door',
      hp, maxHp: hp,
      damageFlash: 0,
    },
    position: mesh.position,
  };
  door.userData.entity = door;
  doors.push(door);
  stats.manufacturing -= cost;
  playSfx('confirm', { minInterval: 80 });
  pushEvent(kind === 'steel' ? 'Steel door forged' : 'Wooden door placed');
  return true;
}

export function removeDoor(door) {
  const idx = doors.indexOf(door);
  if (idx < 0) return;
  doors.splice(idx, 1);
  scene.remove(door.mesh);
  door.mesh.traverse(o => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
  });
}

// Heroes deal damage to a door adjacent to them. Called from hero AI.
export function damageDoor(door, amount) {
  if (door.hp <= 0) return;
  door.hp -= amount;
  door.userData.hp = door.hp;
  door.userData.damageFlash = 0.18;
  if (door.hp <= 0) {
    spawnSparkBurst(door.x, door.z, 0xcf8a40, 26, 1.2);
    playSfx('swing', { minInterval: 80 });
    pushEvent('Door broken');
    removeDoor(door);
  } else {
    playSfx('hit_metal', { minInterval: 60 });
  }
}

// Per-frame: gentle breathing on the rune, damage-flash visual.
export function tickDoors(dt) {
  const now = performance.now() / 1000;
  for (const d of doors) {
    if (d.userData.damageFlash > 0) {
      d.userData.damageFlash = Math.max(0, d.userData.damageFlash - dt);
      const k = d.userData.damageFlash / 0.18;
      d.mesh.scale.setScalar(1 + k * 0.12);
    } else if (d.mesh.scale.x !== 1) {
      d.mesh.scale.setScalar(1);
    }
    // Slight rune pulse
    void now; // (no persistent animation state yet)
  }
}

// Sanity helper: does this tile currently block hero foot-traffic?
// Player units can always pass — they're friendly.
export function heroBlockedByDoor(x, z, faction) {
  if (faction === FACTION_PLAYER) return false;
  const d = doorAt(x, z);
  return !!(d && d.hp > 0);
}
