// ============================================================
// MOOD FACE ICONS — tiny sprite above a creature showing happiness
// ============================================================
// Canvas-rendered 3-state face (:) / :| / :-) attached per-creature.
// Tracked in a parallel array so the animation loop can reposition them
// after the creature moves each frame. Reuses the levelBadges pattern.
//
// Happiness thresholds chosen so "happy" is the default and "angry"
// requires actual mistreatment — unpaid, starving, slapped, etc.

import { scene } from './scene.js';
import { creatures } from './state.js';

const THREE = window.THREE;
const HAPPY_ABOVE = 0.7;
const ANGRY_BELOW = 0.35;

const moodBadges = []; // { target, sprite, mat, tex, canvas, lastMood }

function _drawFace(canvas, mood) {
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const color = mood === 'happy' ? '#80d070'
              : mood === 'angry' ? '#ff4020'
              :                    '#d8a860';

  // Background disc — dark ring with tinted fill so it reads at a glance.
  ctx.fillStyle = 'rgba(14,8,6,0.75)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Eyes
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(24, 28, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(40, 28, 3.2, 0, Math.PI * 2); ctx.fill();

  // Mouth — smile / flat / frown
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (mood === 'happy') {
    ctx.arc(size / 2, 34, 10, 0.15 * Math.PI, 0.85 * Math.PI);
  } else if (mood === 'angry') {
    ctx.arc(size / 2, 48, 10, 1.15 * Math.PI, 1.85 * Math.PI);
    // Brow furrow — two short angled lines
    ctx.moveTo(18, 22); ctx.lineTo(30, 26);
    ctx.moveTo(46, 22); ctx.lineTo(34, 26);
  } else {
    ctx.moveTo(22, 42); ctx.lineTo(42, 42);
  }
  ctx.stroke();
}

function _classify(happiness) {
  if (happiness >= HAPPY_ABOVE) return 'happy';
  if (happiness <= ANGRY_BELOW) return 'angry';
  return 'neutral';
}

export function createMoodBadge(target, yOffset) {
  const canvas = document.createElement('canvas');
  _drawFace(canvas, 'happy');
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.35, 0.35, 1);
  sprite.renderOrder = 997;
  scene.add(sprite);
  const badge = { target, yOffset, canvas, tex, mat, sprite, lastMood: 'happy' };
  moodBadges.push(badge);
  return badge;
}

// Tick all mood badges — reposition over their target, swap texture on mood change.
// Also culls badges whose target has died / left the scene.
export function updateMoodBadges() {
  for (let i = moodBadges.length - 1; i >= 0; i--) {
    const b = moodBadges[i];
    const ud = b.target.userData;
    if (!b.target.parent || !ud || ud.hp <= 0) {
      scene.remove(b.sprite);
      b.tex.dispose();
      b.mat.dispose();
      moodBadges.splice(i, 1);
      continue;
    }
    const mood = _classify(ud.happiness != null ? ud.happiness : 1);
    if (mood !== b.lastMood) {
      _drawFace(b.canvas, mood);
      b.tex.needsUpdate = true;
      b.lastMood = mood;
    }
    b.sprite.position.set(
      b.target.position.x,
      b.target.position.y + b.yOffset,
      b.target.position.z - 0.3  // slightly forward of level badge so they don't fight
    );
    // Hide when held (would clip through the hand)
    b.sprite.visible = ud.state !== 'held';
  }
}

// Called from combat-death cleanup so we don't leak sprites when a creature
// is removed via a path that doesn't naturally hit updateMoodBadges first.
export function removeMoodBadgeFor(target) {
  for (let i = moodBadges.length - 1; i >= 0; i--) {
    if (moodBadges[i].target === target) {
      scene.remove(moodBadges[i].sprite);
      moodBadges[i].tex.dispose();
      moodBadges[i].mat.dispose();
      moodBadges.splice(i, 1);
    }
  }
}

// Noop export used if main.js wants to know whether any creature-tracking
// badges remain (future: guarded tick-skip). Kept simple for v1.
export function moodBadgeCount() { return moodBadges.length; }
// Silence unused-import warnings in bundlers that don't tree-shake side imports.
void creatures;
