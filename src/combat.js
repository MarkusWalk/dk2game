// ============================================================
// COMBAT — shared primitives for heroes, creatures, imps, heart
// ============================================================
// Every combatant has { faction, hp, maxHp, atkCooldown?, damageFlash? }.
// takeDamage handles HP deduction, damage-flash timing, floating numbers,
// and death dispatch. Death dispatch is specialised per entity type so we
// can drop gold (heroes) / clear lair ownership (creatures) / etc.
//
// Keeping this decoupled from the AI loops lets us add new combatants
// (future: orcs, warlocks, beetles) without touching the resolver.

import {
  FACTION_PLAYER, FACTION_HERO,
  XP_PER_HERO_KILL, XP_PER_BOSS_KILL,
} from './constants.js';
import {
  heartRef, heroes, creatures, imps, stats,
  GAME, invasion, droppedGold, hpBars, floatingDamageNumbers, sim,
} from './state.js';
import { scene, creatureGroup, impGroup } from './scene.js';
import {
  HP_BAR_GEO, HP_BAR_BG_MAT, HP_BAR_FILL_MAT, COIN_MAT,
} from './materials.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { setLairOccupied } from './rooms.js';
import { removeMoodBadgeFor } from './mood.js';
import { removeIntentBadgeFor } from './intent.js';
import { grid } from './state.js';
import { showGameOver, showVictory, flashHeartVignette } from './heart.js';
import { awardXp } from './xp.js';
import { addScreenShake } from './camera-controls.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

// ============================================================
// HP BARS
// ============================================================
export function createHpBar(target, yOffset, width, fillMat, hideUntilHurt) {
  const bg = new THREE.Mesh(HP_BAR_GEO, HP_BAR_BG_MAT);
  bg.scale.set(width * 1.05, 1, 1);
  const fill = new THREE.Mesh(HP_BAR_GEO, fillMat || HP_BAR_FILL_MAT);
  fill.scale.set(width, 0.75, 1);
  fill.position.z = 0.001;
  const group = new THREE.Group();
  group.add(bg);
  group.add(fill);
  group.renderOrder = 999;
  if (hideUntilHurt) group.visible = false;
  // Bars live in world space so parent rotation doesn't fight the billboard
  scene.add(group);
  const bar = { mesh: group, fill, target, yOffset, maxScale: width, hideUntilHurt };
  hpBars.push(bar);
  return bar;
}

export function updateHpBars(cam) {
  for (let i = hpBars.length - 1; i >= 0; i--) {
    const b = hpBars[i];
    // Drop bars whose targets have been removed from the scene / died
    if (!b.target.parent || (b.target.userData && b.target.userData.hp !== undefined && b.target.userData.hp <= 0)) {
      scene.remove(b.mesh);
      hpBars.splice(i, 1);
      continue;
    }
    const ud = b.target.userData;
    const frac = ud && ud.maxHp ? Math.max(0, ud.hp / ud.maxHp) : 0;
    b.fill.scale.x = b.maxScale * frac;
    if (b.hideUntilHurt) b.mesh.visible = frac < 1;
    // Position above target in world space
    b.mesh.position.set(
      b.target.position.x,
      b.target.position.y + b.yOffset,
      b.target.position.z
    );
    b.mesh.quaternion.copy(cam.quaternion);
  }
}

// --- Floating damage numbers ---
// Tiny sprites that float up and fade. Cheap visual proof of damage dealt.
export function spawnFloatingDamage(x, y, z, amount, color) {
  const size = 256, h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 48px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.strokeStyle = '#1a0508';
  ctx.lineWidth = 6;
  const text = '' + Math.max(1, Math.round(amount));
  ctx.strokeText(text, size / 2, h / 2);
  ctx.fillText(text, size / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.2, 0.3, 1);
  sprite.position.set(x, y, z);
  sprite.renderOrder = 1000;
  scene.add(sprite);
  floatingDamageNumbers.push({ mesh: sprite, vy: 1.4, life: 0.9, maxLife: 0.9, tex });
}
export function updateFloatingDamage(dt) {
  for (let i = floatingDamageNumbers.length - 1; i >= 0; i--) {
    const d = floatingDamageNumbers[i];
    d.life -= dt;
    d.mesh.position.y += d.vy * dt;
    d.vy *= 0.97;
    const t = d.life / d.maxLife;
    d.mesh.material.opacity = Math.max(0, t);
    if (d.life <= 0) {
      scene.remove(d.mesh);
      d.tex.dispose();
      d.mesh.material.dispose();
      floatingDamageNumbers.splice(i, 1);
    }
  }
}

// --- The damage resolver ---
// `attacker` is the entity that dealt the damage (or null for spells / ambient
// damage). When a target dies, the attacker earns XP if it's a player entity.
export function takeDamage(entity, amount, attacker) {
  if (!entity || !entity.userData) return;
  const ud = entity.userData;
  if (ud.hp <= 0) return;  // already dead
  ud.hp -= amount;
  ud.damageFlash = 0.18;   // red flash duration
  // Distress stamp: creature broadcasts "I'm under attack" for a few seconds.
  // Nearby friendly creatures in wander state path over to help. Set on any
  // player-faction entity including imps so imps under attack also summon help.
  if (ud.faction === FACTION_PLAYER) {
    ud.distressAt = sim.time;
  }
  const pos = entity.position;
  const color =
    ud.faction === FACTION_HERO   ? 0xff4040 :
    ud.faction === FACTION_PLAYER ? 0xffcc60 :
                                     0xff8844;
  spawnFloatingDamage(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 1.0, pos.z, amount, color);
  // Route hit SFX by target type. Heart throttled heavily because hero attack is
  // per-frame * dt, not per-swing, so it'd fire continuously otherwise.
  const heart = heartRef.heart;
  if (entity === heart) {
    playSfx('heart_hit', { minInterval: 700 });
    flashHeartVignette();
    // Shake scales with fractional damage dealt — bigger hits, bigger kick.
    const frac = Math.min(1, amount / Math.max(1, ud.maxHp * 0.05));
    addScreenShake(0.35 * frac + 0.15, 0.18);
  } else if (ud.faction === FACTION_HERO) {
    playSfx('hit_metal', { minInterval: 60 });
  } else {
    playSfx('hit_soft', { minInterval: 60 });
  }
  if (ud.hp <= 0) {
    ud.hp = 0;
    // XP bounty for killing an enemy — goes to the attacker if it's one of ours
    if (attacker && attacker.userData && attacker.userData.faction === FACTION_PLAYER) {
      const bounty = ud.isBoss ? XP_PER_BOSS_KILL
                  : ud.faction === FACTION_HERO ? XP_PER_HERO_KILL
                  : 0;
      if (bounty > 0) awardXp(attacker, bounty);
    }
    onEntityDie(entity);
  }
}

// Route death to the right cleanup. Keeps spawn arrays + grid bookkeeping correct.
export function onEntityDie(entity) {
  const ud = entity.userData;
  // Particle burst
  const burstColor =
    ud.faction === FACTION_HERO   ? 0xc04040 :
    ud.faction === FACTION_PLAYER ? 0x9080c0 :
                                     0xf0e0a0;
  spawnSparkBurst(entity.position.x, entity.position.z, burstColor, 26, 1.2);

  const heart = heartRef.heart;
  if (entity === heart) {
    if (!GAME.over) {
      GAME.over = true;
      GAME.won = false;
      showGameOver();
    }
    return;
  }

  // Boss killed → win the game
  if (ud.isBoss) {
    invasion.boss = null;
    // Big celebratory effect at the boss's feet
    spawnPulse(entity.position.x, entity.position.z, 0xffd040, 1.2, 2.4);
    spawnSparkBurst(entity.position.x, entity.position.z, 0xffe080, 50, 1.8);
    spawnSparkBurst(entity.position.x, entity.position.z, 0xffffff, 30, 2.2);
    // Extra bounty for the kill
    droppedGold.push({
      x: entity.position.x, z: entity.position.z, amount: 500, age: 0,
      mesh: _makeDroppedGold(entity.position.x, entity.position.z)
    });
    if (!GAME.over) {
      GAME.over = true;
      GAME.won = true;
      showVictory();
    }
  } else {
    playSfx('death', { minInterval: 40 });
  }

  // Heroes drop gold on death (boss gold already queued above).
  // Dwarves that plundered a treasury spill that gold here too — kills you
  // before he escapes, recover his loot.
  if (ud.faction === FACTION_HERO && !ud.isBoss) {
    const bounty = 35 + Math.floor(Math.random() * 25) + (ud.plunderedGold || 0);
    droppedGold.push({
      x: entity.position.x, z: entity.position.z, amount: bounty, age: 0,
      mesh: _makeDroppedGold(entity.position.x, entity.position.z)
    });
  }

  // Remove from its owning array + scene
  if (ud.faction === FACTION_HERO) {
    pushEvent(ud.isBoss ? 'Knight Commander slain' : 'Hero slain');
    const i = heroes.indexOf(entity);
    if (i >= 0) heroes.splice(i, 1);
    scene.remove(entity);
  } else if (ud.faction === FACTION_PLAYER) {
    // Fly creatures
    const i = creatures.indexOf(entity);
    if (i >= 0) {
      creatures.splice(i, 1);
      creatureGroup.remove(entity);
      stats.creatures = Math.max(0, stats.creatures - 1);
      // Clean up tracked sprite badges so they don't leak
      removeMoodBadgeFor(entity);
      removeIntentBadgeFor(entity);
      // Free up any lair it owned
      if (ud.lair) {
        const lc = grid[ud.lair.x][ud.lair.z];
        if (lc && lc.lairOwner === entity) {
          lc.lairOwner = null;
          if (lc.roomType === 'lair') setLairOccupied(lc, false);
        }
      }
      pushEvent('Creature fell');
    } else {
      // Imp — was leaking before this fix: scene.remove() didn't actually detach
      // the imp because its parent is impGroup, so the corpse stayed visible
      // and its per-instance materials never got freed.
      const j = imps.indexOf(entity);
      if (j >= 0) {
        imps.splice(j, 1);
        impGroup.remove(entity);
        // Imp parts use locally-allocated materials (see createImp in imps.js),
        // so a blanket traverse-dispose is safe — no shared materials in here.
        entity.traverse(o => {
          if (o.isMesh) {
            if (o.geometry && o.geometry.dispose) o.geometry.dispose();
            if (o.material && o.material.dispose) o.material.dispose();
          }
        });
        // Return any claimed job to the pool
        if (ud.job) ud.job.claimedBy = null;
        pushEvent('Imp died');
      }
    }
  }
}

// --- Dropped gold (hero bounty) ---
// Simple pickup: any imp adjacent claims it into the treasury pipeline.
// Visually a chunky coin stack with a light.
export function _makeDroppedGold(x, z) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.22, 0.08, 10),
    COIN_MAT
  );
  base.position.y = 0.18;
  base.castShadow = true;
  g.add(base);
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 8), COIN_MAT);
    const a = i * 1.5;
    c.position.set(Math.cos(a) * 0.08, 0.22 + (i * 0.01), Math.sin(a) * 0.08);
    c.rotation.x = i * 0.3;
    g.add(c);
  }
  const light = new THREE.PointLight(0xffaa44, 0.9, 2.2, 2);
  light.position.y = 0.4;
  g.add(light);
  g.position.set(x, 0, z);
  g.userData = { light, base };
  scene.add(g);
  return g;
}
export function tickDroppedGold(dt, t) {
  for (let i = droppedGold.length - 1; i >= 0; i--) {
    const d = droppedGold[i];
    d.age += dt;
    // Idle bob
    d.mesh.userData.base.position.y = 0.18 + Math.sin(t * 3 + d.x) * 0.03;
    d.mesh.userData.light.intensity = 0.7 + Math.sin(t * 5 + d.x) * 0.25;
    // Pickup: any imp adjacent claims it
    let claimed = false;
    for (const imp of imps) {
      if (Math.hypot(imp.position.x - d.x, imp.position.z - d.z) < 0.7) {
        imp.userData.carrying = (imp.userData.carrying || 0) + d.amount;
        if (imp.userData.carriedGold) imp.userData.carriedGold.visible = true;
        // Treasure message
        spawnFloatingDamage(d.x, 1.0, d.z, d.amount, 0xffcc44);
        claimed = true;
        break;
      }
    }
    if (claimed) {
      scene.remove(d.mesh);
      droppedGold.splice(i, 1);
    }
    // Auto-collect after 60s so corpses don't pile up indefinitely
    else if (d.age > 60) {
      stats.goldTotal += d.amount;
      scene.remove(d.mesh);
      droppedGold.splice(i, 1);
    }
  }
}

// Damage flash: brief scale-punch on the entity group so shared materials
// aren't mutated. Combined with floating numbers + color burst, this reads
// clearly as "I was hit" without any per-material cloning.
export function updateDamageFlashes(dt) {
  const pulse = (ent) => {
    const ud = ent.userData;
    if (ud.damageFlash > 0) {
      ud.damageFlash = Math.max(0, ud.damageFlash - dt);
      const t = ud.damageFlash / 0.18;
      const s = 1 + t * 0.18;      // quick puff outward
      ent.scale.setScalar(s);
    } else if (ent.scale.x !== 1) {
      ent.scale.setScalar(1);
    }
  };
  for (const c of creatures) pulse(c);
  for (const imp of imps) pulse(imp);
  for (const h of heroes) pulse(h);
}
