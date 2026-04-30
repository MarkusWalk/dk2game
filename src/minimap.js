// ============================================================
// CARTOGRAPH — bottom-right canvas minimap.
// ============================================================
// Pixels-per-tile is computed from canvas size / GRID_SIZE, so the canvas
// dimensions in HTML drive the resolution. Undiscovered tiles render flat
// black; discovered tiles get a per-type color. Live entities are dots —
// imps amber, creatures magenta, heroes red, heart pulsing red, portals
// purple. Camera viewport is overlaid as a rectangle. Click to recenter.

import {
  GRID_SIZE, T_ROCK, T_FLOOR, T_CLAIMED, T_HEART, T_GOLD, T_REINFORCED,
  T_ENEMY_FLOOR, T_ENEMY_WALL, T_PORTAL_NEUTRAL, T_PORTAL_CLAIMED,
} from './constants.js';
import {
  grid, discovered, imps, creatures, heroes, prisoners, portals,
  cameraControls, sightPulses, sim,
} from './state.js';
import { isDiscovered } from './fog.js';

let _canvas = null;
let _ctx = null;
let _meta = null;
let _scale = 1;
let _lastDraw = 0;
const DRAW_INTERVAL_MS = 90;     // ~11 Hz, plenty for a minimap

const TILE_COLOR = {
  [T_ROCK]:          '#1a1014',
  [T_FLOOR]:         '#3a2820',
  [T_CLAIMED]:       '#5a2018',
  [T_HEART]:         '#ff3030',
  [T_GOLD]:          '#c89030',
  [T_REINFORCED]:    '#8a4028',
  [T_ENEMY_FLOOR]:   '#1a3060',
  [T_ENEMY_WALL]:    '#2050a0',
  [T_PORTAL_NEUTRAL]:'#604070',
  [T_PORTAL_CLAIMED]:'#a040c0',
};

function _ensureRefs() {
  if (_canvas) return true;
  _canvas = document.getElementById('cartoCanvas');
  _meta   = document.getElementById('cartoMeta');
  if (!_canvas) return false;
  _ctx = _canvas.getContext('2d');
  _scale = _canvas.width / GRID_SIZE;
  _canvas.addEventListener('click', (ev) => {
    const rect = _canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width * GRID_SIZE;
    const z = (ev.clientY - rect.top)  / rect.height * GRID_SIZE;
    cameraControls.target.x = Math.max(0, Math.min(GRID_SIZE - 1, x));
    cameraControls.target.z = Math.max(0, Math.min(GRID_SIZE - 1, z));
  });
  return true;
}

export function tickMinimap() {
  if (!_ensureRefs()) return;
  const now = performance.now();
  if (now - _lastDraw < DRAW_INTERVAL_MS) return;
  _lastDraw = now;

  const w = _canvas.width, h = _canvas.height;
  const s = _scale;
  _ctx.fillStyle = '#050204';
  _ctx.fillRect(0, 0, w, h);

  // Tile pass — only discovered tiles get color.
  let discCount = 0;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      if (!isDiscovered(x, z)) continue;
      discCount++;
      const cell = grid[x] && grid[x][z];
      if (!cell) continue;
      const c = TILE_COLOR[cell.type] || '#2a1818';
      _ctx.fillStyle = c;
      _ctx.fillRect(x * s, z * s, Math.ceil(s), Math.ceil(s));
    }
  }

  // Sight-of-Evil pulses — translucent purple ring.
  for (const p of sightPulses) {
    if (sim.time > p.expiresAt) continue;
    _ctx.strokeStyle = 'rgba(192,128,255,0.55)';
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.arc(p.x * s, p.z * s, p.radius * s, 0, Math.PI * 2);
    _ctx.stroke();
  }

  // Entity dots
  _drawEntities(creatures, '#e040ff', 1.6);
  _drawEntities(imps, '#ffa030', 1.4);
  _drawEntities(heroes, '#ff4030', 1.8);
  _drawEntities(prisoners, '#a0a0c0', 1.4);

  // Portals — small open circles. Always visible if discovered.
  for (const p of portals) {
    if (!isDiscovered(p.x, p.z)) continue;
    _ctx.strokeStyle = p.claimed ? '#ff80ff' : '#8060a0';
    _ctx.lineWidth = 1.5;
    _ctx.beginPath();
    _ctx.arc((p.x + 0.5) * s, (p.z + 0.5) * s, 2.2, 0, Math.PI * 2);
    _ctx.stroke();
  }

  // Heart — pulsing red dot at the centroid.
  const pulse = 0.6 + 0.4 * Math.sin(sim.time * 4);
  const hx = (32 + 0.5) * s, hz = (32 + 0.5) * s;
  _ctx.fillStyle = `rgba(255,60,40,${pulse})`;
  _ctx.beginPath();
  _ctx.arc(hx, hz, 3.5, 0, Math.PI * 2);
  _ctx.fill();

  // Camera viewport rectangle — approximates iso ortho's frustum on the floor
  // plane. We don't have the exact projected corners; use a fixed proportion
  // tied to zoomMul so it shrinks/grows with the player's zoom.
  const t = cameraControls.target;
  const span = 14 / Math.max(0.4, cameraControls.zoomMul);
  const cx = t.x * s, cz = t.z * s;
  _ctx.strokeStyle = 'rgba(255,200,120,0.7)';
  _ctx.lineWidth = 1.2;
  _ctx.strokeRect(cx - span * s, cz - span * s, span * 2 * s, span * 2 * s);

  // Meta readout: "discovered / total"
  if (_meta) {
    _meta.textContent = `${discCount} / ${GRID_SIZE * GRID_SIZE}`;
  }
}

function _drawEntities(list, color, size) {
  _ctx.fillStyle = color;
  for (const e of list) {
    if (!e.userData || e.userData.hp <= 0) continue;
    const x = Math.round(e.position.x);
    const z = Math.round(e.position.z);
    if (!isDiscovered(x, z)) continue;
    _ctx.beginPath();
    _ctx.arc((e.position.x + 0.5) * _scale, (e.position.z + 0.5) * _scale, size, 0, Math.PI * 2);
    _ctx.fill();
  }
}
