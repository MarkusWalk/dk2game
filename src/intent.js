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
const INTENT_TTL = 2.4;   // seconds a badge is visible (doubled for readability)

// Glyph set — single chars that read at small sizes without antialiasing pain.
// `label` is the human-readable word shown next to the glyph so players can
// tell at a glance what the creature just decided to do.
const GLYPHS = {
  eat:    { char: '\u{1F374}', color: '#80d070', label: 'EAT' },
  sleep:  { char: 'z',         color: '#70a0ff', label: 'SLEEP' },
  fight:  { char: '⚔',    color: '#ff4020', label: 'FIGHT' },
  flee:   { char: '!',         color: '#ffc040', label: 'FLEE' },
  pay:    { char: '¤',    color: '#ffcc44', label: 'PAY' },
  help:   { char: '+',         color: '#ff8040', label: 'HELP' },
  train:  { char: '⚡',    color: '#ff5040', label: 'TRAIN' },
  study:  { char: '♪',    color: '#7090ff', label: 'STUDY' },
  work:   { char: '⚒',    color: '#ff8020', label: 'WORK' },
  wander: { char: '~',         color: '#a89070', label: 'IDLE' },
  rally:  { char: '▲',    color: '#ff6040', label: 'RALLY' },
};

const intentBadges = [];  // { target, sprite, mat, tex, canvas, lastKey, expiresAt }

function _drawGlyph(canvas, key) {
  const W = 192, H = 72;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const g = GLYPHS[key];
  if (!g) return;
  // Dark rounded-rect background
  const r = 22;
  ctx.fillStyle = 'rgba(14, 8, 6, 0.88)';
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.lineTo(W - r, 4);
  ctx.quadraticCurveTo(W - 4, 4, W - 4, r + 4);
  ctx.lineTo(W - 4, H - r - 4);
  ctx.quadraticCurveTo(W - 4, H - 4, W - r - 4, H - 4);
  ctx.lineTo(r, H - 4);
  ctx.quadraticCurveTo(4, H - 4, 4, H - r - 4);
  ctx.lineTo(4, r + 4);
  ctx.quadraticCurveTo(4, 4, r, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Glyph on the left
  ctx.fillStyle = g.color;
  ctx.font = 'bold 42px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(g.char, 36, H / 2 + 2);
  // Label on the right
  ctx.font = 'bold 30px Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText(g.label || key.toUpperCase(), 66, H / 2 + 2);
}

export function createIntentBadge(target, yOffset) {
  const canvas = document.createElement('canvas');
  canvas.width = 192; canvas.height = 72;  // blank until first setIntent
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0 });
  const sprite = new THREE.Sprite(mat);
  // Wide sprite: preserves 192:72 ≈ 2.67:1 aspect so the label is readable.
  sprite.scale.set(1.0, 0.375, 1);
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
    // Fade based on remaining TTL (stay solid for most of life, fade last ~0.8s)
    const remaining = b.expiresAt - now;
    const opacity = remaining > 0.8 ? 1 : Math.max(0, remaining / 0.8);
    b.mat.opacity = opacity;
    b.sprite.visible = opacity > 0.02 && ud.state !== 'held' && ud.state !== 'leaving';
    // Position above the creature, slight bob so it feels like a thought bubble
    const bob = Math.sin(now * 6) * 0.03;
    b.sprite.position.set(
      b.target.position.x,
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
