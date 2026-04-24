// ============================================================
// INTENT BADGES — tiny sprite showing what a creature just decided to do
// ============================================================
// Hops above a creature's head for ~1.2s whenever it picks a new high-level
// goal (eat / sleep / fight / flee / pay / train / help). Players read these
// as "the creature is thinking about X" and stop perceiving the AI as random.
//
// Reuses the levelBadge pattern (canvas + sprite + tracked list). Each intent
// is a single glyph drawn on a 64×64 canvas; the badge is hidden when no
// intent is active, visible with a short fade while showing one.

import { scene } from './scene.js';

const THREE = window.THREE;
const INTENT_TTL = 1.2;   // seconds a badge is visible

// Glyph set — single chars that read at small sizes without antialiasing pain.
const GLYPHS = {
  eat:    { char: '\u{1F374}', color: '#80d070' },   // fork & knife
  sleep:  { char: 'z',         color: '#70a0ff' },
  fight:  { char: '⚔',    color: '#ff4020' },   // crossed swords
  flee:   { char: '!',         color: '#ffc040' },
  pay:    { char: '¤',    color: '#ffcc44' },   // generic currency
  help:   { char: '+',         color: '#ff8040' },
  train:  { char: '⚡',    color: '#ff5040' },   // lightning
  study:  { char: '♪',    color: '#7090ff' },   // eighth note (books are ugly at 32px)
  wander: { char: '~',         color: '#a89070' },
  rally:  { char: '▲',    color: '#ff6040' },
};

const intentBadges = [];  // { target, sprite, mat, tex, canvas, lastKey, expiresAt }

function _drawGlyph(canvas, key) {
  const size = 64;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const g = GLYPHS[key];
  if (!g) return;
  // Dark disc background
  ctx.fillStyle = 'rgba(14, 8, 6, 0.82)';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  // Glyph itself
  ctx.fillStyle = g.color;
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(g.char, size / 2, size / 2 + 2);
}

export function createIntentBadge(target, yOffset) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;  // blank until first setIntent
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.32, 0.32, 1);
  sprite.renderOrder = 996;
  scene.add(sprite);
  const badge = { target, yOffset, canvas, tex, mat, sprite, lastKey: null, expiresAt: 0 };
  intentBadges.push(badge);
  return badge;
}

// Called whenever a creature picks a new high-level goal. Throttled so
// re-setting the same intent back-to-back doesn't redraw the canvas.
export function setIntent(target, key) {
  if (!target || !target.userData || !GLYPHS[key]) return;
  const badge = intentBadges.find(b => b.target === target);
  if (!badge) return;
  const now = performance.now() / 1000;
  // If the same intent is already displayed and not expired, just extend it.
  if (badge.lastKey === key && badge.expiresAt > now) {
    badge.expiresAt = now + INTENT_TTL;
    return;
  }
  _drawGlyph(badge.canvas, key);
  badge.tex.needsUpdate = true;
  badge.lastKey = key;
  badge.expiresAt = now + INTENT_TTL;
}

export function updateIntentBadges() {
  const now = performance.now() / 1000;
  for (let i = intentBadges.length - 1; i >= 0; i--) {
    const b = intentBadges[i];
    const ud = b.target.userData;
    if (!b.target.parent || !ud || ud.hp <= 0) {
      scene.remove(b.sprite);
      b.tex.dispose();
      b.mat.dispose();
      intentBadges.splice(i, 1);
      continue;
    }
    // Fade based on remaining TTL
    const remaining = b.expiresAt - now;
    const opacity = remaining > 0 ? Math.min(1, remaining * 1.5) : 0;
    b.mat.opacity = opacity;
    b.sprite.visible = opacity > 0.02 && ud.state !== 'held';
    // Position above the creature, slight bob so it feels like a thought bubble
    const bob = Math.sin(now * 6) * 0.03;
    b.sprite.position.set(
      b.target.position.x + 0.25,
      b.target.position.y + b.yOffset + bob,
      b.target.position.z
    );
  }
}

export function removeIntentBadgeFor(target) {
  for (let i = intentBadges.length - 1; i >= 0; i--) {
    if (intentBadges[i].target === target) {
      scene.remove(intentBadges[i].sprite);
      intentBadges[i].tex.dispose();
      intentBadges[i].mat.dispose();
      intentBadges.splice(i, 1);
    }
  }
}
