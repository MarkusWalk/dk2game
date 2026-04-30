// ============================================================
// MAIN — entry point + animation loop
// ============================================================
// Orchestrates per-frame updates. Imports every module that owns a tick and
// calls them in the same order the original IIFE ran.

import {
  ROOM_LAIR, TREASURY_PILE_VISUAL_CAP, ROOM_TREASURY,
  MANA_PER_CLAIMED_TILE_PER_SEC, MANA_BASE_REGEN_PER_SEC,
} from './constants.js';
import {
  imps, creatures, heroes, treasuries, rooms, goldBursts, pulses,
  sparkBursts, torches, previewMeshes, heartRef, sim, markersList,
  stats,
} from './state.js';
import { scene, renderer } from './scene.js';
import { cameraRef } from './camera-controls.js';
import {
  RUNE_MAT, SEAM_MAT, ENEMY_RUNE_MAT, ENEMY_SEAM_MAT,
  LAIR_RUNE_MAT, LAIR_PUPA_MAT,
} from './materials.js';
import { initDungeon } from './init.js';
import { updateImp } from './imps.js';
import { updateCreature, tickPortals, tickHatcheryRegrowth, animatePortals, tickBrawls, tickPayDay } from './creatures.js';
import { tickImpRespawn } from './imps.js';
import { updateHero, tickWaves } from './heroes.js';
import { updateHeartState } from './heart.js';
import {
  updateDamageFlashes, updateHpBars, updateFloatingDamage, tickDroppedGold,
} from './combat.js';
import { updateLevelBadges } from './xp.js';
import { updateMoodBadges } from './mood.js';
import { updateIntentBadges } from './intent.js';
import { updateLightningBolts, tickSpellUi, tickRally } from './spells.js';
import { updateHeldEntity } from './hand.js';
import { tickCamera } from './camera-controls.js';
import { handState } from './state.js';
import { updateHUD, updateCombatHud, installHud, tickEventFeed, updateRoster, tickInfoPanel, tickPaydayHud, tickThreatsPanel } from './hud.js';
import { installCameraInput } from './camera-controls.js';
import { installInput } from './input.js';
import { updateWanderChicken, tickRoomBenefits, flushDirtyRooms } from './rooms.js';
import { tickDoors } from './doors.js';
import { tickTraps } from './traps.js';
import { tickPossession, installPossessionInput, onPossessionResize } from './possession.js';
import { installMenu, showStartScreen } from './menu.js';
import { GAME } from './state.js';
import { tryCaptureHero, tickPrisoners } from './prisoners.js';
import { registerCaptureHook } from './combat.js';
import { tickFog } from './fog.js';
import { tickMinimap } from './minimap.js';
import { applyToolbarIcons } from './icons.js';

const THREE = window.THREE;

// ============================================================
// ANIMATION LOOP
// ============================================================
// The clock MUST be declared before bootstrap() runs, because bootstrap
// kicks off animate() and the first animate frame reads `clock`. In the
// `readyState !== 'loading'` branch, bootstrap fires synchronously; a
// declaration below it would hit the temporal dead zone.
const clock = new THREE.Clock();

// Bootstrap the dungeon and install HUD wiring once the DOM is parsed.
function bootstrap() {
  // Install input listeners that own the canvas + global key handling
  installCameraInput();
  installInput();
  installPossessionInput();
  installMenu();
  installHud();
  // Inject SVG glyphs into every toolbar swatch — runs once after the DOM is
  // ready and the buttons exist.
  applyToolbarIcons();
  // Combat ↔ prisoners hook: when a hero dies, combat.js asks prisoners.js
  // whether a free cage exists; if so, the hero is captured instead of killed.
  registerCaptureHook(tryCaptureHero);
  initDungeon();
  window.addEventListener('resize', onPossessionResize);
  // Park the player on the start screen until they click "New Game". The
  // dungeon scene still renders behind it (paused) so they see the world.
  showStartScreen();
  animate();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

function animate() {
  requestAnimationFrame(animate);
  // Drain dt every frame so the clock doesn't accumulate during pause; that
  // would make the resume frame jump forward by the entire menu duration.
  const dt = Math.min(clock.getDelta(), 0.05);
  // Paused (start screen / pause menu / about): render a still frame and bail
  // before any sim ticks fire. Camera, AI, particles, audio — all frozen.
  if (GAME.paused || !GAME.started) {
    renderer.render(scene, cameraRef.camera);
    return;
  }
  // Sim-time accumulator: clamped-dt sum so a hidden tab can't desynchronize
  // sim-semantic deadlines (commitUntil, hasteUntil, depletedUntil) from the
  // dt-driven counters around them. Cosmetic anim still uses clock.elapsedTime
  // — drifting visuals are fine; logic decisions are not.
  sim.time += dt;
  const t = clock.elapsedTime;
  const heart = heartRef.heart;
  const camera = cameraRef.camera;

  // Camera ticks first so input events landing between frames see the camera
  // at the most recently-committed pose (including any active shake offset).
  tickCamera(dt);
  // Possession overrides the camera placement on its own — runs after tickCamera
  // so it gets the last word on cameraRef.camera position when active.
  tickPossession(dt);

  // Heart animation
  const hd = heart.userData;
  hd.core.rotation.y += dt * 0.7;
  hd.core.rotation.x += dt * 0.3;
  hd.shell.rotation.y -= dt * 0.4;
  hd.shell.rotation.z += dt * 0.2;
  const pulse = 1 + Math.sin(t * 2.2) * 0.08;
  hd.core.scale.setScalar(pulse);
  hd.heartLight.intensity = 3.0 + Math.sin(t * 2.2) * 0.7;
  hd.glyph.rotation.z += dt * 0.5;
  hd.glyph.material.opacity = 0.25 + Math.sin(t * 2.2) * 0.15;

  // Heart particles
  const pos = hd.particles.geometry.attributes.position.array;
  for (let i = 0; i < hd.particleData.length; i++) {
    const p = hd.particleData[i];
    p.angle += p.speed * dt;
    pos[i*3] = Math.cos(p.angle) * p.radius;
    pos[i*3+1] = p.height + Math.sin(t * 2 + i) * 0.1;
    pos[i*3+2] = Math.sin(p.angle) * p.radius;
  }
  hd.particles.geometry.attributes.position.needsUpdate = true;

  // Torches flicker
  for (const torch of torches) {
    const td = torch.userData;
    const flicker = 0.7 + Math.sin(t * 12 + td.flickerPhase) * 0.15 +
                    Math.sin(t * 23 + td.flickerPhase * 1.7) * 0.1 +
                    (Math.random() - 0.5) * 0.15;
    td.light.intensity = td.baseIntensity * flicker;
    td.flame.scale.setScalar(0.9 + flicker * 0.3);
    td.flame.position.y = 0.6 + (flicker - 1) * 0.02;
  }

  // Markers — iterate registry instead of scanning every grid cell.
  for (const m of markersList) {
    m.userData.phase += dt;
    m.userData.ring.rotation.z = m.userData.phase * 2;
    m.userData.ring.position.y = 1.35 + Math.sin(m.userData.phase * 3) * 0.1;
    m.userData.spike.position.y = 1.5 + Math.sin(m.userData.phase * 3) * 0.1;
  }

  // Treasury pile gentle shimmer — only rotate types that look good rotating
  for (const tr of treasuries) {
    if (tr.amount > 0 && tr.pile && tr.pile.userData) {
      const ud = tr.pile.userData;
      // Chests/gems/columns look bad when they spin; only shimmer the light.
      if (ud.variant === 'coin_carpet' || ud.variant === 'big_pile') {
        if (ud.propBuilder) ud.propBuilder.rotation.y += dt * 0.15;
      }
      const t01 = Math.min(1, tr.amount / TREASURY_PILE_VISUAL_CAP);
      ud.light.intensity = (0.4 + t01 * 1.3) * (0.85 + Math.sin(t * 3 + tr.x) * 0.15);
    }
  }

  // Per-room animations: chickens wander, braziers flicker, centre lights breathe
  for (const room of rooms) {
    if (room.chickens) {
      for (const ch of room.chickens) updateWanderChicken(ch, room, dt);
    }
    if (room.centerLight) {
      const baseI = room.type === ROOM_TREASURY ? 0.45
                  : room.type === ROOM_LAIR     ? 0.55
                                                : 0.50;
      const rate = room.type === ROOM_LAIR ? 1.3 : 2.2;
      room.centerLight.intensity = baseI + Math.sin(t * rate + room.centroid.x) * 0.12;
    }
  }
  // Lair brazier embers — flat per-room cache built at room construction so
  // we skip the (rooms × tiles × grid lookup) walk every frame. Two sine
  // terms at incommensurable frequencies replace the old Math.random() jitter,
  // which both reads cleaner and lets us drop a per-brazier RNG call.
  for (const room of rooms) {
    if (!room.braziers) continue;
    for (const { decor, bx } of room.braziers) {
      const flicker = 0.85
        + Math.sin(t * 14 + bx * 3) * 0.12
        + Math.sin(t * 31.7 + bx * 1.9) * 0.05;
      decor.userData.light.intensity = 0.8 * flicker;
      decor.userData.ember.scale.setScalar(0.9 + flicker * 0.2);
    }
  }

  // Drag-select preview pulse
  const previewPulse = 0.4 + Math.sin(t * 6) * 0.15;
  for (const mesh of previewMeshes.values()) {
    mesh.material.opacity = previewPulse;
  }

  // Imps
  for (const imp of imps) updateImp(imp, dt);

  // Pay-day fires globally before per-creature ticks so a wage spike is
  // visible the same frame the banner pops.
  tickPayDay();
  // Captured heroes — advances prison/torture timers and triggers conversions.
  // Runs before creature ticks so a same-frame conversion is visible immediately.
  tickPrisoners(dt);
  // Fog of war — reveals tiles around player entities and hides entities on
  // undiscovered tiles. Cheap (~4 Hz internal cadence).
  tickFog(dt);
  // Creatures + portals + hatchery regrowth
  for (const c of creatures) updateCreature(c, dt);
  tickPortals(dt);
  tickHatcheryRegrowth();
  animatePortals(t);
  tickBrawls(dt);
  // Apply any pending room-graph rebuilds from this frame's designations
  // before tickRoomBenefits reads rooms[].
  flushDirtyRooms();
  // Training Rooms feed XP, Library feeds research — both driven by who
  // is standing where, so this runs after creature movement for this frame.
  tickRoomBenefits(dt);

  // Doors + traps — tick before hero pathing so a newly-placed door is "seen"
  // this frame, and trap triggers fire on the current hero position.
  tickDoors(dt);
  tickTraps(dt, t);

  // Combat: heroes, waves, damage visuals, HP bars, floating numbers
  for (let i = heroes.length - 1; i >= 0; i--) updateHero(heroes[i], dt);
  tickWaves(dt, t);
  updateHeartState(heart, dt, t);
  updateDamageFlashes(dt);
  updateHpBars(camera);
  updateFloatingDamage(dt);
  tickDroppedGold(dt, t);
  updateCombatHud(t);

  // Mana regen — claimed-tile count drives the rate; baseline trickle keeps
  // an early dungeon casting at all. Reads stats.tilesClaimed (cached counter
  // maintained by jobs.js) so no per-frame grid scan is needed.
  if (stats.mana < stats.manaMax) {
    stats.mana = Math.min(
      stats.manaMax,
      stats.mana + dt * (MANA_BASE_REGEN_PER_SEC + stats.tilesClaimed * MANA_PER_CLAIMED_TILE_PER_SEC)
    );
  }

  // Levels + imp respawn
  updateLevelBadges();
  updateMoodBadges();
  updateIntentBadges();
  tickImpRespawn(dt);

  // Spells: fade lightning bolts, rally flag animation, update cooldown bars on toolbar
  updateLightningBolts(dt);
  tickRally(t);
  tickSpellUi();

  // Hand of Keeper — position held entity + pulse the drop indicator
  updateHeldEntity(dt);
  if (handState.dropIndicator && handState.dropIndicator.visible) {
    handState.dropIndicator.userData.phase += dt * 4;
    const s = 1 + Math.sin(handState.dropIndicator.userData.phase) * 0.12;
    handState.dropIndicator.userData.ring.scale.setScalar(s);
    handState.dropIndicator.userData.glow.rotation.y += dt * 2;
    handState.dropIndicator.userData.glow.position.y = 0.3 + Math.sin(handState.dropIndicator.userData.phase) * 0.08;
  }

  // Gold bursts
  for (let i = goldBursts.length - 1; i >= 0; i--) {
    const b = goldBursts[i];
    b.life -= dt;
    const arr = b.points.geometry.attributes.position.array;
    for (let j = 0; j < b.vel.length; j++) {
      arr[j*3]   += b.vel[j].x * dt;
      arr[j*3+1] += b.vel[j].y * dt;
      arr[j*3+2] += b.vel[j].z * dt;
      b.vel[j].y -= 6 * dt; // gravity
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.opacity = Math.max(0, b.life / 1.2);
    if (b.life <= 0) {
      scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      goldBursts.splice(i, 1);
    }
  }

  // Ring pulses (claim / reinforce feedback)
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i];
    p.life -= dt;
    const t01 = 1 - p.life / p.maxLife;
    p.mesh.scale.setScalar(0.4 + t01 * 3.0);
    p.mesh.material.opacity = Math.max(0, p.life / p.maxLife) * 0.9;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      pulses.splice(i, 1);
    }
  }

  // Spark bursts (reinforce completion)
  for (let i = sparkBursts.length - 1; i >= 0; i--) {
    const b = sparkBursts[i];
    b.life -= dt;
    const arr = b.points.geometry.attributes.position.array;
    for (let j = 0; j < b.vel.length; j++) {
      arr[j*3]   += b.vel[j].x * dt;
      arr[j*3+1] += b.vel[j].y * dt;
      arr[j*3+2] += b.vel[j].z * dt;
      b.vel[j].y -= 5 * dt; // gravity
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.material.opacity = Math.max(0, b.life / b.maxLife);
    if (b.life <= 0) {
      scene.remove(b.points);
      b.points.geometry.dispose();
      b.points.material.dispose();
      sparkBursts.splice(i, 1);
    }
  }

  // Reinforced-wall rune and seam breathe together (shared materials across all walls)
  const runePulse = 2.6 + Math.sin(t * 2.5) * 0.7;
  RUNE_MAT.emissiveIntensity = runePulse;
  SEAM_MAT.emissiveIntensity = 1.1 + Math.sin(t * 2.5 + 0.3) * 0.5;
  // Enemy wall materials pulse at a different rhythm so the two factions feel distinct
  ENEMY_RUNE_MAT.emissiveIntensity = 2.6 + Math.sin(t * 1.8 + 1.2) * 0.7;
  ENEMY_SEAM_MAT.emissiveIntensity = 1.1 + Math.sin(t * 1.8 + 1.5) * 0.5;
  // Lair chamber rune breathes slowly (like a quiet bedroom); pupa inside the nest
  // beats faster like a heartbeat — the two together sell "occupied lair."
  LAIR_RUNE_MAT.emissiveIntensity = 1.8 + Math.sin(t * 1.3) * 0.6;
  LAIR_PUPA_MAT.emissiveIntensity = 1.5 + Math.sin(t * 3.2) * 0.8;

  updateHUD();
  updateRoster(false);
  tickEventFeed();
  tickInfoPanel();
  tickPaydayHud();
  tickThreatsPanel();
  tickMinimap();
  renderer.render(scene, camera);
}
