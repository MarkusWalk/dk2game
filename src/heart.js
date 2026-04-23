// ============================================================
// DUNGEON HEART
// ============================================================
// Core game-loss entity. Pedestal + glowing icosahedron core + wireframe shell
// + rotating particle swarm + point light. updateHeartState animates the
// shell color/opacity (redder as HP drops) and applies a shake-on-hit.

import { HEART_MAX_HP, HEART_X, HEART_Z, WAVE_WARN_LEAD } from './constants.js';
import { invasion, portals } from './state.js';
import { playSfx } from './audio.js';

const THREE = window.THREE;

export function createDungeonHeart(x, z) {
  const group = new THREE.Group();

  // Pedestal (3 stacked rings)
  const ped1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.65, 0.2, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a1410, roughness: 0.95 })
  );
  ped1.position.y = 0.1; ped1.castShadow = true; ped1.receiveShadow = true;
  group.add(ped1);

  const ped2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.55, 0.15, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a1c14, roughness: 0.9 })
  );
  ped2.position.y = 0.275; ped2.castShadow = true; ped2.receiveShadow = true;
  group.add(ped2);

  // Core crystal
  const coreGeo = new THREE.IcosahedronGeometry(0.35, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xff2818, emissive: 0xff1808, emissiveIntensity: 2.2,
    roughness: 0.25, metalness: 0.4, flatShading: true
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = 0.85;
  group.add(core);

  // Wireframe shell
  const shellGeo = new THREE.IcosahedronGeometry(0.52, 1);
  const shellMat = new THREE.MeshBasicMaterial({
    color: 0xff6828, wireframe: true, transparent: true, opacity: 0.35
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.y = 0.85;
  group.add(shell);

  // Floor glyph beneath (glowing circle)
  const glyphGeo = new THREE.RingGeometry(0.6, 0.9, 32);
  const glyphMat = new THREE.MeshBasicMaterial({
    color: 0xff4818, transparent: true, opacity: 0.35, side: THREE.DoubleSide
  });
  const glyph = new THREE.Mesh(glyphGeo, glyphMat);
  glyph.rotation.x = -Math.PI / 2;
  glyph.position.y = 0.1;
  group.add(glyph);

  // Main point light
  const heartLight = new THREE.PointLight(0xff4818, 3.5, 14, 1.6);
  heartLight.position.y = 0.85;
  heartLight.castShadow = true;
  heartLight.shadow.mapSize.set(512, 512);
  group.add(heartLight);

  // Orbital particles
  const particleCount = 30;
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const particleData = [];
  for (let i = 0; i < particleCount; i++) {
    particleData.push({
      angle: (i / particleCount) * Math.PI * 2,
      radius: 0.8 + Math.random() * 0.6,
      height: 0.4 + Math.random() * 1.0,
      speed: 0.3 + Math.random() * 0.5
    });
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xff8a3a, size: 0.08, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const particles = new THREE.Points(particleGeo, particleMat);
  group.add(particles);

  group.position.set(x, 0, z);
  group.userData = {
    core, shell, glyph, heartLight, particles, particleData,
    hp: HEART_MAX_HP, maxHp: HEART_MAX_HP,
    damageFlash: 0,
    shakeUntil: 0
  };
  return group;
}

// Visible damage tiers on the heart — mirrored as a CSS class on the tier
// vignette so the whole viewport tints deeper red as HP drops. Each tier
// latches once entered; we don't un-tint if HP is somehow restored mid-run.
const HEART_TIER_THRESHOLDS = [0.66, 0.33, 0.10];  // frac boundaries
function _updateHeartTierVignette(frac) {
  const el = document.getElementById('vignetteTier');
  if (!el) return;
  let tier = 0;
  if (frac < HEART_TIER_THRESHOLDS[0]) tier = 1;
  if (frac < HEART_TIER_THRESHOLDS[1]) tier = 2;
  if (frac < HEART_TIER_THRESHOLDS[2]) tier = 3;
  // Only touch the class if it actually changed — avoids re-triggering the
  // transition on every frame.
  const current = el.dataset.tier ? parseInt(el.dataset.tier, 10) : 0;
  if (tier === current) return;
  el.classList.remove('tier-1', 'tier-2', 'tier-3');
  if (tier > 0) el.classList.add('tier-' + tier);
  el.dataset.tier = String(tier);
}

// Called from combat.js when the heart takes damage. Pulses the red vignette
// so hits feel kinetic even while HP slides slowly.
export function flashHeartVignette() {
  const el = document.getElementById('vignetteRed');
  if (!el) return;
  el.classList.add('visible');
  // Fade starts as soon as we remove the class; CSS transition handles the
  // 0.4s decay. Rapid re-hits reset the opacity to 1 immediately.
  clearTimeout(flashHeartVignette._t);
  flashHeartVignette._t = setTimeout(() => el.classList.remove('visible'), 80);
}

export function updateHeartState(heart, dt, t) {
  const ud = heart.userData;
  if (ud.damageFlash > 0) ud.damageFlash = Math.max(0, ud.damageFlash - dt);
  const frac = Math.max(0, ud.hp / ud.maxHp);
  _updateHeartTierVignette(frac);

  // Heart shell is a wireframe MeshBasicMaterial — its visuals come from color+opacity.
  // As HP drops, color shifts from bright orange → deep red, opacity rises slightly
  // so the wireframe feels more jagged and present. Flash white briefly on hit.
  if (ud.shell && ud.shell.material) {
    const mat = ud.shell.material;
    if (ud.damageFlash > 0) {
      mat.color.setHex(0xffffff);
      mat.opacity = 0.85;
    } else {
      const hurt = 1 - frac;
      // Lerp color 0xff6828 (bright) → 0x801810 (dark red)
      const r = 0xff - Math.floor(0x7f * hurt);
      const g = 0x68 - Math.floor(0x50 * hurt);
      const b = 0x28 - Math.floor(0x18 * hurt);
      mat.color.setRGB(r / 255, g / 255, b / 255);
      mat.opacity = 0.35 + hurt * 0.3;
      // Flicker when critical
      if (frac < 0.25) mat.opacity *= 0.5 + Math.random() * 0.7;
    }
  }
  if (ud.heartLight) {
    ud.heartLight.intensity = (2.8 + Math.sin(t * 2.5) * 0.8) * (0.4 + 0.6 * frac);
    // Redder and dimmer as it dies
    ud.heartLight.color.setRGB(1, 0.28 * (0.3 + 0.7 * frac), 0.09 * (0.2 + 0.8 * frac));
  }

  // Shake on recent hit — offsets from the heart's canonical position
  if (ud.shakeUntil > t) {
    const k = (ud.shakeUntil - t) * 8;
    heart.position.x = HEART_X + (Math.random() - 0.5) * 0.08 * k;
    heart.position.z = HEART_Z + (Math.random() - 0.5) * 0.08 * k;
  } else {
    heart.position.x = HEART_X;
    heart.position.z = HEART_Z;
  }
}

export function showGameOver() {
  const overlay = document.getElementById('gameOverOverlay');
  if (overlay) overlay.style.display = 'flex';
  // Scatter creatures: set to wandering, stop spawning
  for (const p of portals) p.claimed = false;
  playSfx('game_over');
}
export function showWaveWarning() {
  const el = document.getElementById('waveWarning');
  if (!el) return;
  el.textContent = '⚠ INVASION INCOMING ⚠';
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), (WAVE_WARN_LEAD + 1.5) * 1000);
  playSfx('alarm');
}
export function showWaveBanner(n, count) {
  const el = document.getElementById('waveWarning');
  if (!el) return;
  el.textContent = `WAVE ${n} — ${count} HEROES`;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
  playSfx('drum');
}
export function showBossBanner() {
  const el = document.getElementById('waveWarning');
  if (!el) return;
  el.textContent = '⚔ KNIGHT COMMANDER ⚔';
  el.classList.add('visible', 'boss');
  setTimeout(() => el.classList.remove('visible', 'boss'), 3500);
}
export function showVictory() {
  const overlay = document.getElementById('victoryOverlay');
  if (overlay) overlay.style.display = 'flex';
  // Scatter: stop spawns, freeze the boss-timer
  for (const p of portals) p.claimed = false;
  invasion.nextWaveAt = Infinity;
  playSfx('victory');
}
