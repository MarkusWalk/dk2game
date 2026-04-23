// ============================================================
// PARTICLE / PULSE EFFECTS
// ============================================================
// Shared visual feedback primitives — gold bursts (mining), expanding ring
// pulses (claim/reinforce completion), spark showers (reinforce, death,
// level-up). Each push into a state array that main.js ticks in the animation
// loop (gravity / life / cleanup).

import { goldBursts, pulses, sparkBursts } from './state.js';
import { scene } from './scene.js';

const THREE = window.THREE;

// Gold particle burst when mining gold
export function spawnGoldBurst(x, z) {
  const geo = new THREE.BufferGeometry();
  const n = 20;
  const pos = new Float32Array(n * 3);
  const vel = [];
  for (let i = 0; i < n; i++) {
    pos[i*3] = 0;
    pos[i*3+1] = 0.3;
    pos[i*3+2] = 0;
    vel.push({
      x: (Math.random() - 0.5) * 2,
      y: 2 + Math.random() * 2,
      z: (Math.random() - 0.5) * 2
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffcc44, size: 0.14, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const points = new THREE.Points(geo, mat);
  points.position.set(x, 0, z);
  scene.add(points);
  goldBursts.push({ points, vel, life: 1.2 });
}

// Expanding ring pulse (for claim / reinforce completion feedback)
export function spawnPulse(x, z, color, heightOffset = 0.05, lifetime = 0.8) {
  const ringGeo = new THREE.RingGeometry(0.1, 0.38, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 1, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, heightOffset, z);
  scene.add(ring);
  pulses.push({ mesh: ring, life: lifetime, maxLife: lifetime });
}

// Rising spark burst — used on reinforce completion to punctuate the moment
export function spawnSparkBurst(x, z, color = 0xff6028, count = 14, originY = 0.9) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = [];
  for (let i = 0; i < count; i++) {
    pos[i*3] = 0;
    pos[i*3+1] = originY;
    pos[i*3+2] = 0;
    vel.push({
      x: (Math.random() - 0.5) * 1.2,
      y: 1.5 + Math.random() * 1.5,
      z: (Math.random() - 0.5) * 1.2
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color, size: 0.12, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const points = new THREE.Points(geo, mat);
  points.position.set(x, 0, z);
  scene.add(points);
  sparkBursts.push({ points, vel, life: 0.9, maxLife: 0.9 });
}
