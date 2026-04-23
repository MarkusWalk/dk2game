// ============================================================
// SPELLS — direct player combat agency
// ============================================================
// Two spells in v1:
//   LIGHTNING — click a tile; deals SPELL_LIGHTNING_DMG to everything in an AoE.
//               Good for nuking a hero or a cluster. Expensive + long cooldown
//               so it isn't spammed.
//   HEAL      — click a player creature/imp; restores SPELL_HEAL_AMOUNT HP (capped
//               at maxHp). Saves a fly from a hero or patches up an imp that got
//               caught out.
//
// Each spell mode behaves like Hand mode: single click/tap commits, no drag.
// Insufficient gold or active cooldown: play a failure tone, no charge.
//
// Visuals: lightning is a zigzag bolt from sky + impact flash; heal is a green
// pulse + spark burst on the target. Both hook into the shared audio.

import {
  FACTION_PLAYER,
  SPELL_LIGHTNING_COST, SPELL_LIGHTNING_COOLDOWN, SPELL_LIGHTNING_DMG, SPELL_LIGHTNING_AOE,
  SPELL_HEAL_COST, SPELL_HEAL_COOLDOWN, SPELL_HEAL_AMOUNT,
} from './constants.js';
import {
  heroes, creatures, imps, stats, spells, floatingDamageNumbers,
  _lightningBolts, spellBtnRefs,
} from './state.js';
import { scene } from './scene.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { takeDamage } from './combat.js';

const THREE = window.THREE;

export function spellCooldownFrac(name) {
  const s = spells[name];
  const nowSec = performance.now() / 1000;
  const def = name === 'lightning' ? SPELL_LIGHTNING_COOLDOWN : SPELL_HEAL_COOLDOWN;
  return Math.min(1, (nowSec - s.lastCast) / def);
}
export function spellReady(name) {
  const cost = name === 'lightning' ? SPELL_LIGHTNING_COST : SPELL_HEAL_COST;
  return spellCooldownFrac(name) >= 1 && stats.goldTotal >= cost;
}

export function castLightning(x, z) {
  if (!spellReady('lightning')) {
    playSfx('spell_fail', { minInterval: 250 });
    return false;
  }
  stats.goldTotal -= SPELL_LIGHTNING_COST;
  spells.lightning.lastCast = performance.now() / 1000;

  // Collect victims in AoE — any live entity from any faction
  const victims = [];
  const scanAoE = (list) => {
    for (const e of list) {
      if (!e.userData || e.userData.hp <= 0) continue;
      if (e.userData.state === 'held') continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d < SPELL_LIGHTNING_AOE) victims.push(e);
    }
  };
  scanAoE(heroes);
  scanAoE(creatures);
  scanAoE(imps);
  // Apply damage — iterate from a snapshot since takeDamage may remove entries
  for (const v of victims) takeDamage(v, SPELL_LIGHTNING_DMG, { x, y: 0, z });

  spawnLightningBolt(x, z);
  spawnPulse(x, z, 0xc0e0ff, 0.2, 1.6);
  spawnSparkBurst(x, z, 0xe0f0ff, 34, 1.5);
  playSfx('lightning');
  return true;
}

export function castHeal(target) {
  if (!target || !target.userData) { playSfx('spell_fail'); return false; }
  if (target.userData.faction !== FACTION_PLAYER) {
    playSfx('spell_fail'); return false;
  }
  if (target.userData.hp <= 0) { playSfx('spell_fail'); return false; }
  if (!spellReady('heal')) { playSfx('spell_fail', { minInterval: 250 }); return false; }
  stats.goldTotal -= SPELL_HEAL_COST;
  spells.heal.lastCast = performance.now() / 1000;

  const ud = target.userData;
  const before = ud.hp;
  ud.hp = Math.min(ud.maxHp, ud.hp + SPELL_HEAL_AMOUNT);
  const healed = ud.hp - before;

  // Visual: green pulse at feet + upward spark shower
  spawnPulse(target.position.x, target.position.z, 0x80ff80, 0.1, 1.2);
  spawnSparkBurst(target.position.x, target.position.z, 0xa0ffa0, 22, 1.2);
  // Floating "+N" number
  spawnHealNumber(target.position.x, target.position.y + 1.0, target.position.z, healed);
  playSfx('heal');
  return true;
}

// ---------- Lightning bolt visuals ----------
export function spawnLightningBolt(x, z) {
  const segments = 9;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const y = 10 - (10 * i / segments);
    const isEnd = i === 0 || i === segments;
    const jx = isEnd ? 0 : (Math.random() - 0.5) * 0.9;
    const jz = isEnd ? 0 : (Math.random() - 0.5) * 0.9;
    points.push(new THREE.Vector3(x + jx, y, z + jz));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  // Bright white core
  const coreMat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 1, linewidth: 3, depthTest: false
  });
  const core = new THREE.Line(geo, coreMat);
  core.renderOrder = 990;
  scene.add(core);
  // Cyan halo (slightly offset copy for glow effect)
  const haloMat = new THREE.LineBasicMaterial({
    color: 0x80c0ff, transparent: true, opacity: 0.7, linewidth: 6, depthTest: false
  });
  const halo = new THREE.Line(geo, haloMat);
  halo.renderOrder = 989;
  scene.add(halo);
  // Bright flash light at impact
  const light = new THREE.PointLight(0xc0e0ff, 12, 10, 2);
  light.position.set(x, 3, z);
  scene.add(light);
  _lightningBolts.push({ core, coreMat, halo, haloMat, light, geo, life: 0.4, maxLife: 0.4 });
}
export function updateLightningBolts(dt) {
  for (let i = _lightningBolts.length - 1; i >= 0; i--) {
    const b = _lightningBolts[i];
    b.life -= dt;
    const t = b.life / b.maxLife;
    b.coreMat.opacity = t;
    b.haloMat.opacity = t * 0.7;
    b.light.intensity = 12 * t * t;
    if (b.life <= 0) {
      scene.remove(b.core);
      scene.remove(b.halo);
      scene.remove(b.light);
      b.geo.dispose();
      b.coreMat.dispose();
      b.haloMat.dispose();
      _lightningBolts.splice(i, 1);
    }
  }
}

// ---------- Heal number: "+25" floating up in green ----------
// Mirrors spawnFloatingDamage but with a leading "+" and green color.
function spawnHealNumber(x, y, z, amount) {
  const size = 256, h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 48px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#60ff80';
  ctx.strokeStyle = '#081a0c';
  ctx.lineWidth = 6;
  const text = '+' + Math.max(1, Math.round(amount));
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

// ---------- Per-frame spell UI tick ----------
// Updates cooldown bars + affordability appearance on the toolbar buttons.
function _getSpellBtnRefs() {
  if (spellBtnRefs.cache) return spellBtnRefs.cache;
  const lightning = document.querySelector('[data-mode="lightning"]');
  const heal = document.querySelector('[data-mode="heal"]');
  if (!lightning || !heal) return null;
  spellBtnRefs.cache = {
    lightning: { btn: lightning, bar: lightning.querySelector('.cd-bar') },
    heal:      { btn: heal,      bar: heal.querySelector('.cd-bar') },
  };
  return spellBtnRefs.cache;
}
export function tickSpellUi() {
  const refs = _getSpellBtnRefs();
  if (!refs) return;
  for (const name of ['lightning', 'heal']) {
    const frac = spellCooldownFrac(name);
    const cost = name === 'lightning' ? SPELL_LIGHTNING_COST : SPELL_HEAL_COST;
    const affordable = stats.goldTotal >= cost;
    refs[name].bar.style.width = (frac * 100).toFixed(1) + '%';
    refs[name].btn.classList.toggle('on-cooldown', frac < 1);
    refs[name].btn.classList.toggle('unaffordable', frac >= 1 && !affordable);
  }
}
