// ============================================================
// XP + LEVELS — creatures and imps gain XP, level up, get stronger
// ============================================================
// Creatures earn XP by landing kills; imps earn XP by working (digging/claiming).
// Levelling grants HP + stat boosts and a full heal. Caps at 5 (creatures) /
// 4 (imps) so numbers don't spiral out of control. Every level-up fires a
// celebratory pulse + sound so the player feels the moment.
//
// Design: each imp/creature userData already has hp/maxHp/atk — we just mutate
// those on level-up. The level badge system renders the current level as a
// canvas sprite above the entity and updates automatically.

import {
  FACTION_PLAYER, LEVEL_CAP_CREATURE, LEVEL_CAP_IMP, SPECIES,
} from './constants.js';
import { imps, levelBadges } from './state.js';
import { scene } from './scene.js';
import { playSfx } from './audio.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { spawnFloatingDamage } from './combat.js';
import { pushEvent } from './hud.js';

const THREE = window.THREE;

// Escalating curve — base * 1.6^(level-1). Keeps early levels zippy and makes
// late training a real investment. L1→2 = 30, L2→3 = 48, L3→4 = 77, L4→5 = 123.
const XP_BASE = 30;
const XP_GROWTH = 1.6;
export function xpToNext(level) {
  return Math.round(XP_BASE * Math.pow(XP_GROWTH, level - 1));
}

export function awardXp(entity, amount) {
  if (!entity || !entity.userData) return;
  const ud = entity.userData;
  if (ud.faction !== FACTION_PLAYER) return;
  const cap = _isImp(entity) ? LEVEL_CAP_IMP : LEVEL_CAP_CREATURE;
  if (ud.level >= cap) return;
  ud.xp = (ud.xp || 0) + amount;
  while (ud.level < cap && ud.xp >= xpToNext(ud.level)) {
    ud.xp -= xpToNext(ud.level);
    ud.level += 1;
    applyLevelUp(entity);
  }
}

export function _isImp(entity) { return imps.includes(entity); }

// Perk roll — on each creature level-up we alternate between Hardy (HP) and
// Vicious (atk). Species bias: Beetle always rolls Hardy, Goblin always Vicious,
// others alternate so the player sees both kinds of growth.
// Returns { name, label } for event-feed output.
function _rollPerk(ud) {
  const species = ud.species;
  let pick;
  if (species === 'beetle')      pick = 'hardy';
  else if (species === 'goblin') pick = 'vicious';
  else                            pick = (ud.level % 2 === 0) ? 'hardy' : 'vicious';
  if (pick === 'hardy') {
    ud.maxHp = Math.round(ud.maxHp * 1.2);
    return { name: 'hardy', label: 'Hardy +20% HP' };
  }
  ud.atk = Math.max(ud.atk + 1, Math.round(ud.atk * 1.15));
  return { name: 'vicious', label: 'Vicious +15% atk' };
}

function applyLevelUp(entity) {
  const ud = entity.userData;
  const isImp = _isImp(entity);
  if (isImp) {
    // Imps: tougher + faster workers (faster dig/claim via ud.workMultiplier)
    ud.maxHp = Math.round(ud.maxHp * 1.3);
    ud.hp = ud.maxHp;
    ud.workMultiplier = (ud.workMultiplier || 1) * 1.3;
  } else {
    // Creatures: base bump + a perk of 2. Base bump keeps HP scaling coherent
    // across species; the perk adds the "pick a growth path" flavor.
    ud.maxHp = Math.round(ud.maxHp * 1.15);
    const perk = _rollPerk(ud);
    ud.perks = ud.perks || [];
    ud.perks.push(perk.name);
    ud.hp = ud.maxHp;
    pushEvent(`${ud.species || 'Creature'} L${ud.level}: ${perk.label}`);
    // Secondary-move unlock notice. SPECIES is imported from constants.
    const sp = SPECIES[ud.species];
    if (sp && sp.secondaryMove && ud.level === sp.secondaryMove.learnedAt && !ud.secondaryAnnounced) {
      ud.secondaryAnnounced = true;
      pushEvent(`${ud.species} learned ${sp.secondaryMove.name}`);
    }
  }
  // Visuals + audio
  spawnPulse(entity.position.x, entity.position.z, 0xffd060, 0.4, 1.4);
  spawnSparkBurst(entity.position.x, entity.position.z, 0xfff0a0, 30, 1.4);
  spawnFloatingDamage(
    entity.position.x, entity.position.y + 1.2, entity.position.z,
    ud.level, 0xffe060
  );
  playSfx('levelup', { minInterval: 80 });
}

// ---- Level badges: small numbered sprite above each player-faction entity
//  (the `levelBadges` array itself is declared in state.js so
//  init-time spawnImp calls at boot have somewhere to push to.)

function _drawLevelBadge(canvas, level) {
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  // Colour escalates with level — subtle at L1, fiery at L5
  const ring = level >= 5 ? '#ff8040'
              : level >= 4 ? '#ffc060'
              : level >= 3 ? '#ffe0a0'
              : level >= 2 ? '#d8c088'
              :              '#a89070';
  ctx.fillStyle = 'rgba(20, 10, 6, 0.88)';
  ctx.beginPath(); ctx.arc(size/2, size/2, 24, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = ring;
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(level), size/2, size/2 + 1);
}

export function createLevelBadge(target, yOffset, xOffset) {
  const canvas = document.createElement('canvas');
  _drawLevelBadge(canvas, 1);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.4, 0.4, 1);
  sprite.renderOrder = 998;
  scene.add(sprite);
  const badge = { target, yOffset, xOffset: xOffset || 0, level: 1, canvas, tex, mat, sprite };
  levelBadges.push(badge);
  return badge;
}

export function updateLevelBadges() {
  for (let i = levelBadges.length - 1; i >= 0; i--) {
    const b = levelBadges[i];
    const ud = b.target.userData;
    if (!b.target.parent || !ud || ud.hp <= 0) {
      scene.remove(b.sprite);
      b.tex.dispose();
      b.mat.dispose();
      levelBadges.splice(i, 1);
      continue;
    }
    // Refresh the canvas when level changes
    if (ud.level !== b.level) {
      b.level = ud.level;
      _drawLevelBadge(b.canvas, b.level);
      b.tex.needsUpdate = true;
    }
    b.sprite.position.set(
      b.target.position.x + b.xOffset,
      b.target.position.y + b.yOffset,
      b.target.position.z
    );
  }
}
