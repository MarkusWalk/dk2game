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
  SPELL_LIGHTNING_MANA, SPELL_LIGHTNING_COOLDOWN, SPELL_LIGHTNING_DMG, SPELL_LIGHTNING_AOE,
  SPELL_HEAL_MANA, SPELL_HEAL_COOLDOWN, SPELL_HEAL_AMOUNT,
  SPELL_CTA_MANA, SPELL_CTA_COOLDOWN, SPELL_CTA_DURATION, SPELL_CTA_RANGE,
  SPELL_HASTE_MANA, SPELL_HASTE_COOLDOWN, SPELL_HASTE_DURATION,
  SPELL_CREATE_IMP_MANA, SPELL_CREATE_IMP_COOLDOWN,
  SPELL_POSSESS_MANA, SPELL_POSSESS_COOLDOWN,
  SPELL_SIGHT_MANA, SPELL_SIGHT_COOLDOWN, SPELL_SIGHT_RADIUS, SPELL_SIGHT_DURATION,
  SPELL_RESEARCH_COST,
} from './constants.js';
import { spawnImp } from './imps.js';
import { isWalkable } from './pathfinding.js';
import {
  heroes, creatures, imps, stats, spells, floatingDamageNumbers,
  _lightningBolts, spellBtnRefs, rally, sim,
} from './state.js';
import { scene } from './scene.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { takeDamage } from './combat.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

// Central lookup so UI / ready-checks / cast-commits all read the same numbers.
const SPELL_DEFS = {
  lightning:  { mana: SPELL_LIGHTNING_MANA,  cooldown: SPELL_LIGHTNING_COOLDOWN  },
  heal:       { mana: SPELL_HEAL_MANA,       cooldown: SPELL_HEAL_COOLDOWN       },
  callToArms: { mana: SPELL_CTA_MANA,        cooldown: SPELL_CTA_COOLDOWN        },
  haste:      { mana: SPELL_HASTE_MANA,      cooldown: SPELL_HASTE_COOLDOWN      },
  createImp:  { mana: SPELL_CREATE_IMP_MANA, cooldown: SPELL_CREATE_IMP_COOLDOWN },
  possess:    { mana: SPELL_POSSESS_MANA,    cooldown: SPELL_POSSESS_COOLDOWN    },
  sight:      { mana: SPELL_SIGHT_MANA,      cooldown: SPELL_SIGHT_COOLDOWN      },
};
export function spellCooldownFrac(name) {
  const s = spells[name];
  const def = SPELL_DEFS[name];
  if (!s || !def) return 1;
  const nowSec = performance.now() / 1000;
  return Math.min(1, (nowSec - s.lastCast) / def.cooldown);
}
export function spellResearched(name) {
  return !!(stats.spellsResearched && stats.spellsResearched[name]);
}
export function spellReady(name) {
  const def = SPELL_DEFS[name];
  if (!def) return false;
  if (!spellResearched(name)) return false;
  return spellCooldownFrac(name) >= 1 && stats.mana >= def.mana;
}

export function castLightning(x, z) {
  if (!spellReady('lightning')) {
    playSfx('spell_fail', { minInterval: 250 });
    return false;
  }
  stats.mana -= SPELL_LIGHTNING_MANA;
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
  // Refuse (don't charge) if already at full HP — old behavior spent the gold
  // and played a success sound with no visible heal, feeling broken.
  if (target.userData.hp >= target.userData.maxHp) {
    playSfx('spell_fail', { minInterval: 250 });
    pushEvent('Target at full HP');
    return false;
  }
  if (!spellReady('heal')) { playSfx('spell_fail', { minInterval: 250 }); return false; }
  stats.mana -= SPELL_HEAL_MANA;
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

// ---------- Call to Arms ----------
// Drops a rally flag at (x, z) that lives for SPELL_CTA_DURATION. Creatures
// within SPELL_CTA_RANGE path toward it (the creature AI reads `rally` in
// state.js and overrides their wander target). A single flag at a time —
// recasting replaces the old one.
export function castCallToArms(x, z) {
  if (!spellReady('callToArms')) {
    playSfx('spell_fail', { minInterval: 250 });
    return false;
  }
  stats.mana -= SPELL_CTA_MANA;
  spells.callToArms.lastCast = performance.now() / 1000;

  // Remove any existing rally visual before placing a new one.
  _clearRallyMesh();
  rally.active = true;
  rally.x = x;
  rally.z = z;
  rally.expiresAt = performance.now() / 1000 + SPELL_CTA_DURATION;
  rally.mesh = _makeRallyFlag(x, z);
  scene.add(rally.mesh);

  // Immediate pull — closer creatures react right now via their next tick;
  // we also spray a pulse to advertise the flag's position.
  spawnPulse(x, z, 0xff6040, 0.3, 1.6);
  spawnSparkBurst(x, z, 0xffa070, 26, 1.2);
  playSfx('confirm', { minInterval: 120 });
  pushEvent('Rally flag raised');
  void SPELL_CTA_RANGE;  // reserved for future radius-limited pull
  return true;
}

function _makeRallyFlag(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.8 })
  );
  pole.position.set(x, 0.6, z);
  g.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0xff4020, emissive: 0xff2010, emissiveIntensity: 1.2,
      side: THREE.DoubleSide, transparent: true, opacity: 0.95
    })
  );
  flag.position.set(x + 0.28, 1.05, z);
  g.add(flag);
  const light = new THREE.PointLight(0xff6040, 1.2, 4.5, 2);
  light.position.set(x, 1.2, z);
  g.add(light);
  g.userData = { pole, flag, light, birth: performance.now() };
  return g;
}
function _clearRallyMesh() {
  if (rally.mesh) {
    scene.remove(rally.mesh);
    rally.mesh.traverse(o => {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
    });
    rally.mesh = null;
  }
}
export function tickRally(t) {
  if (!rally.active) return;
  const now = performance.now() / 1000;
  if (now >= rally.expiresAt) {
    rally.active = false;
    _clearRallyMesh();
    return;
  }
  // Flag flutters, light pulses.
  if (rally.mesh && rally.mesh.userData.flag) {
    rally.mesh.userData.flag.rotation.y = Math.sin(t * 4) * 0.35;
    rally.mesh.userData.light.intensity = 1.0 + Math.sin(t * 6) * 0.4;
  }
}

// ---------- Create Imp ----------
// Click a walkable tile to spawn an imp there. Manual workforce growth on top
// of the auto-respawn floor — useful for digging surges or replacing a wave's
// casualties faster than the 10s respawn timer. Tile must be walkable; falls
// back nowhere (returns false so input.js can play spell_fail).
export function castCreateImp(x, z) {
  if (!spellReady('createImp')) {
    playSfx('spell_fail', { minInterval: 250 });
    return false;
  }
  if (!isWalkable(x, z)) {
    playSfx('spell_fail', { minInterval: 250 });
    pushEvent('Need a walkable tile');
    return false;
  }
  stats.mana -= SPELL_CREATE_IMP_MANA;
  spells.createImp.lastCast = performance.now() / 1000;
  spawnImp(x, z);
  spawnPulse(x, z, 0xff8050, 0.3, 1.4);
  spawnSparkBurst(x, z, 0xffa060, 22, 1.1);
  playSfx('spawn', { minInterval: 120 });
  pushEvent('Imp summoned');
  return true;
}

// ---------- Sight of Evil ----------
// Reveals an AoE on the fog-of-war for SIGHT_DURATION seconds. Fog module
// also commits any tile inside the radius to permanent-discovered, so the
// player keeps the map info even after the pulse fades.
export function castSightOfEvil(x, z) {
  if (!spellReady('sight')) {
    playSfx('spell_fail', { minInterval: 250 });
    return false;
  }
  stats.mana -= SPELL_SIGHT_MANA;
  spells.sight.lastCast = performance.now() / 1000;
  // Lazy import — fog.js doesn't import spells, but spells.js → fog.js direct
  // import would create a cycle through state.js. Lazy keeps it clean.
  import('./fog.js').then(m => m.castSightOfEvil(x, z, SPELL_SIGHT_RADIUS, SPELL_SIGHT_DURATION));
  spawnPulse(x, z, 0xc0a0ff, 0.4, 1.6);
  spawnSparkBurst(x, z, 0xe0c0ff, 30, 1.4);
  playSfx('whoosh', { minInterval: 100 });
  pushEvent('Sight of Evil revealed');
  return true;
}

// ---------- Possession ----------
// Click a player creature to ride it. spells.js stays decoupled from the
// rendering side — possession.js owns the camera + key handling.
export function castPossess(target) {
  if (!target || !target.userData) { playSfx('spell_fail'); return false; }
  if (target.userData.faction !== FACTION_PLAYER) { playSfx('spell_fail'); return false; }
  if (target.userData.hp <= 0) { playSfx('spell_fail'); return false; }
  if (!spellReady('possess')) { playSfx('spell_fail', { minInterval: 250 }); return false; }
  // Lazy import to avoid creating a spell↔possession cycle at module-load.
  return import('./possession.js').then(mod => {
    const ok = mod.beginPossession(target);
    if (!ok) { playSfx('spell_fail'); return false; }
    stats.mana -= SPELL_POSSESS_MANA;
    spells.possess.lastCast = performance.now() / 1000;
    return true;
  });
}

// ---------- Haste ----------
// Clicks a player creature. Grants +50% speed/attack for SPELL_HASTE_DURATION.
// Stored on userData as `hasteUntil` (sim-time seconds); creature AI reads it.
export function castHaste(target) {
  if (!target || !target.userData) { playSfx('spell_fail'); return false; }
  if (target.userData.faction !== FACTION_PLAYER) { playSfx('spell_fail'); return false; }
  if (target.userData.hp <= 0) { playSfx('spell_fail'); return false; }
  if (!spellReady('haste')) { playSfx('spell_fail', { minInterval: 250 }); return false; }
  stats.mana -= SPELL_HASTE_MANA;
  spells.haste.lastCast = performance.now() / 1000;
  target.userData.hasteUntil = sim.time + SPELL_HASTE_DURATION;
  spawnPulse(target.position.x, target.position.z, 0xffe040, 0.1, 1.3);
  spawnSparkBurst(target.position.x, target.position.z, 0xfff080, 24, 1.1);
  playSfx('heal', { minInterval: 120 });
  pushEvent('Haste cast');
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
  const entries = {};
  for (const name of Object.keys(SPELL_DEFS)) {
    const btn = document.querySelector(`[data-mode="${name}"]`);
    if (!btn) return null;
    entries[name] = { btn, bar: btn.querySelector('.cd-bar') };
  }
  spellBtnRefs.cache = entries;
  return spellBtnRefs.cache;
}
export function tickSpellUi() {
  const refs = _getSpellBtnRefs();
  if (!refs) return;
  for (const name of Object.keys(SPELL_DEFS)) {
    const researched = spellResearched(name);
    const frac = spellCooldownFrac(name);
    const manaCost = SPELL_DEFS[name].mana;
    const affordable = stats.mana >= manaCost;
    const target = stats.researchTarget;
    if (researched) {
      // Researched: cooldown bar reflects spell readiness as before.
      refs[name].bar.style.width = (frac * 100).toFixed(1) + '%';
    } else if (target === name) {
      // Currently researching this spell — show research progress in the bar.
      const cost = SPELL_RESEARCH_COST[name] || 1;
      const prog = (stats.researchProgress[name] || 0) / cost;
      refs[name].bar.style.width = (Math.min(1, prog) * 100).toFixed(1) + '%';
    } else {
      // Locked, not the active target.
      refs[name].bar.style.width = '0%';
    }
    refs[name].btn.classList.toggle('locked', !researched);
    refs[name].btn.classList.toggle('researching', !researched && target === name);
    refs[name].btn.classList.toggle('on-cooldown', researched && frac < 1);
    refs[name].btn.classList.toggle('unaffordable', researched && frac >= 1 && !affordable);
  }
}

// ============================================================
// Research picker — DOM panel listing every locked spell with its cost.
// Click a row to set stats.researchTarget; closes itself afterward.
// ============================================================
let _researchPanel = null;

function _ensureResearchPanel() {
  if (_researchPanel) return _researchPanel;
  const root = document.createElement('div');
  root.id = 'researchPanel';
  root.className = 'research-panel hidden';
  // Build with vanilla DOM (no innerHTML injection since cost values come from constants).
  const title = document.createElement('div');
  title.className = 'research-title';
  title.textContent = 'Research a Spell';
  root.appendChild(title);
  const body = document.createElement('div');
  body.className = 'research-body';
  root.appendChild(body);
  const hint = document.createElement('div');
  hint.className = 'research-hint';
  hint.textContent = 'Library + idle Warlock = research progress';
  root.appendChild(hint);
  document.body.appendChild(root);
  // Click outside dismisses.
  document.addEventListener('pointerdown', (ev) => {
    if (!_researchPanel || _researchPanel.classList.contains('hidden')) return;
    if (_researchPanel.contains(ev.target)) return;
    if (ev.target.closest && ev.target.closest('[data-mode]')) return;
    _hideResearchPanel();
  });
  _researchPanel = root;
  return root;
}

function _hideResearchPanel() {
  if (_researchPanel) _researchPanel.classList.add('hidden');
}

export function openResearchPicker(initialName) {
  const root = _ensureResearchPanel();
  const body = root.querySelector('.research-body');
  body.innerHTML = '';
  const names = Object.keys(SPELL_DEFS);
  let any = false;
  for (const name of names) {
    if (stats.spellsResearched[name]) continue;
    any = true;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'research-row' + (stats.researchTarget === name ? ' active' : '');
    const cost = SPELL_RESEARCH_COST[name] || 0;
    const prog = Math.floor(stats.researchProgress[name] || 0);
    row.textContent = `${name}  —  ${prog}/${cost}`;
    row.addEventListener('click', () => {
      stats.researchTarget = name;
      pushEvent('Researching: ' + name);
      playSfx('confirm', { minInterval: 100 });
      _hideResearchPanel();
    });
    body.appendChild(row);
  }
  if (!any) {
    const done = document.createElement('div');
    done.className = 'research-done';
    done.textContent = 'All spells researched';
    body.appendChild(done);
  }
  root.classList.remove('hidden');
  void initialName;  // (reserved — could highlight the spell that triggered the picker)
}
