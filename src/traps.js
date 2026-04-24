// ============================================================
// TRAPS — Workshop output; space-denial placed on claimed tiles
// ============================================================
// Spike: triggers once when a hero steps on the tile, deals TRAP_SPIKE_DMG,
// then is consumed. Lightning: AoE discharge when a hero crosses, deals
// TRAP_LIGHTNING_DMG to everyone nearby, then enters a cooldown (reusable).
//
// Implementation: traps are passive meshes on claimed floor tiles. tickTraps
// scans living heroes vs placed traps on each frame and fires triggers.

import {
  TRAP_SPIKE_COST, TRAP_LIGHTNING_COST,
  TRAP_SPIKE_DMG, TRAP_LIGHTNING_DMG, TRAP_LIGHTNING_AOE,
  TRAP_LIGHTNING_COOLDOWN, TRAP_TRIGGER_RADIUS,
  T_CLAIMED, T_FLOOR, FACTION_HERO,
} from './constants.js';
import { traps, grid, stats, heroes, creatures, imps } from './state.js';
import { scene } from './scene.js';
import {
  TRAP_PLATE_MAT, TRAP_SPIKE_MAT, TRAP_COIL_MAT, TRAP_SPARK_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { pushEvent } from './hud.js';
import { takeDamage } from './combat.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { doorAt } from './doors.js';

const THREE = window.THREE;

export function trapAt(x, z) {
  for (const t of traps) if (t.x === x && t.z === z) return t;
  return null;
}

function _buildSpikeTrap(x, z) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.04, 0.84), TRAP_PLATE_MAT);
  plate.position.set(0, 0.1, 0);
  plate.receiveShadow = true;
  g.add(plate);
  // 4 spikes recessed into the plate (scale up on trigger via userData.spikes)
  const spikeGeo = new THREE.ConeGeometry(0.06, 0.28, 5);
  const spikes = [];
  for (const [sx, sz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    const s = new THREE.Mesh(spikeGeo, TRAP_SPIKE_MAT);
    s.position.set(sx, 0.2, sz);
    s.scale.y = 0.15; // recessed until triggered
    g.add(s);
    spikes.push(s);
  }
  g.position.set(x, 0, z);
  g.userData = { spikes, triggered: false };
  return g;
}

function _buildLightningTrap(x, z) {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.04, 0.84), TRAP_PLATE_MAT);
  plate.position.set(0, 0.1, 0);
  plate.receiveShadow = true;
  g.add(plate);
  // Central coil — torus rising from the plate
  const coil1 = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 5, 14), TRAP_COIL_MAT);
  coil1.rotation.x = Math.PI / 2;
  coil1.position.y = 0.18;
  g.add(coil1);
  const coil2 = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 5, 12), TRAP_COIL_MAT);
  coil2.rotation.x = Math.PI / 2;
  coil2.position.y = 0.22;
  g.add(coil2);
  // Glowing core
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), TRAP_SPARK_MAT);
  core.position.y = 0.22;
  g.add(core);
  // Faint light
  const light = new THREE.PointLight(0x80c0ff, 0.5, 1.8, 2);
  light.position.y = 0.35;
  g.add(light);
  g.position.set(x, 0, z);
  g.userData = { core, light, phase: Math.random() * Math.PI * 2 };
  return g;
}

export function placeTrap(x, z, kind) {
  if (!grid[x] || !grid[x][z]) return false;
  const cell = grid[x][z];
  if (cell.type !== T_CLAIMED && cell.type !== T_FLOOR) {
    pushEvent('Traps go on dug floor only');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  if (cell.roomType) {
    pushEvent('Can\'t place trap on a room tile');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  if (trapAt(x, z)) {
    pushEvent('Trap already here');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  if (doorAt(x, z)) {
    pushEvent('Door is in the way');
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  const cost = kind === 'lightning' ? TRAP_LIGHTNING_COST : TRAP_SPIKE_COST;
  if ((stats.manufacturing || 0) < cost) {
    pushEvent(`Need ${cost} mfg (have ${Math.floor(stats.manufacturing || 0)}). Build a Workshop + Troll.`);
    playSfx('spell_fail', { minInterval: 200 });
    return false;
  }
  const mesh = kind === 'lightning' ? _buildLightningTrap(x, z) : _buildSpikeTrap(x, z);
  scene.add(mesh);
  traps.push({
    x, z, kind, mesh,
    armed: true,
    cooldown: 0,
  });
  stats.manufacturing -= cost;
  playSfx('confirm', { minInterval: 80 });
  pushEvent(kind === 'lightning' ? 'Lightning trap placed' : 'Spike trap placed');
  return true;
}

function _removeTrap(trap) {
  const idx = traps.indexOf(trap);
  if (idx < 0) return;
  traps.splice(idx, 1);
  scene.remove(trap.mesh);
  trap.mesh.traverse(o => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
  });
}

function _triggerSpike(trap, hero) {
  if (!trap.armed) return;
  trap.armed = false;
  // Animate spikes popping up
  if (trap.mesh.userData.spikes) {
    for (const s of trap.mesh.userData.spikes) s.scale.y = 1.0;
  }
  spawnSparkBurst(trap.x, trap.z, 0xd0d8e0, 18, 1.0);
  spawnPulse(trap.x, trap.z, 0xffffff, 0.15, 1.2);
  playSfx('hit_metal', { minInterval: 60 });
  takeDamage(hero, TRAP_SPIKE_DMG, null);
  pushEvent('Spike trap triggered');
  // Consumed after a brief display — wait 0.6s then remove
  setTimeout(() => _removeTrap(trap), 600);
}

function _triggerLightning(trap) {
  if (trap.cooldown > 0) return;
  trap.cooldown = TRAP_LIGHTNING_COOLDOWN;
  // AoE — damages heroes (not your own units) within radius
  for (const h of heroes) {
    if (!h.userData || h.userData.hp <= 0) continue;
    const d = Math.hypot(h.position.x - trap.x, h.position.z - trap.z);
    if (d <= TRAP_LIGHTNING_AOE) takeDamage(h, TRAP_LIGHTNING_DMG, null);
  }
  // Shouldn't friendly-fire, but visual carnage is welcome
  void creatures; void imps;
  spawnSparkBurst(trap.x, trap.z, 0x80c0ff, 30, 1.3);
  spawnPulse(trap.x, trap.z, 0xc0e0ff, 0.2, 1.8);
  playSfx('lightning', { minInterval: 200 });
  pushEvent('Lightning trap discharged');
}

export function tickTraps(dt, t) {
  for (let i = traps.length - 1; i >= 0; i--) {
    const trap = traps[i];
    if (trap.kind === 'lightning') {
      trap.cooldown = Math.max(0, trap.cooldown - dt);
      // Core + light breathe based on readiness.
      const ready = trap.cooldown <= 0;
      const phase = trap.mesh.userData.phase + t * 3;
      if (trap.mesh.userData.core) {
        trap.mesh.userData.core.scale.setScalar(ready ? 1 + Math.sin(phase) * 0.15 : 0.6);
      }
      if (trap.mesh.userData.light) {
        trap.mesh.userData.light.intensity = ready ? (0.5 + Math.sin(phase) * 0.2) : 0.12;
      }
      // Check for hero in radius
      if (ready) {
        for (const h of heroes) {
          if (!h.userData || h.userData.hp <= 0) continue;
          const d = Math.hypot(h.position.x - trap.x, h.position.z - trap.z);
          if (d <= TRAP_TRIGGER_RADIUS + 0.1) {
            _triggerLightning(trap);
            break;
          }
        }
      }
    } else if (trap.kind === 'spike') {
      if (!trap.armed) continue;
      for (const h of heroes) {
        if (!h.userData || h.userData.hp <= 0) continue;
        const d = Math.hypot(h.position.x - trap.x, h.position.z - trap.z);
        if (d <= TRAP_TRIGGER_RADIUS) {
          _triggerSpike(trap, h);
          break;
        }
      }
    }
  }
  void FACTION_HERO;
}
