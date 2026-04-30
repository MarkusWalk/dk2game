// ============================================================
// FOG OF WAR — discovered/undiscovered tile mask + reveal logic.
// ============================================================
// Tiles begin undiscovered. A tile is revealed when any player imp / creature
// stands within REVEAL_RADIUS of it, or when a Sight-of-Evil spell pulse
// sweeps over it. Once revealed, a tile stays revealed permanently — DK2's
// "you've explored this" semantic, distinct from active line-of-sight.
//
// Visual treatment: undiscovered tile meshes are kept invisible; entities
// (creatures, heroes, prisoners) on undiscovered tiles are also hidden so the
// player doesn't see hero compound occupants until they actually dig in.

import {
  GRID_SIZE, HEART_X, HEART_Z, INITIAL_RADIUS, FACTION_PLAYER, T_ROCK,
  PORTAL_FOOTPRINT,
} from './constants.js';
import { discovered, sightPulses, grid, imps, creatures, heroes, prisoners, portals, sim } from './state.js';
import { markMinimapDirty } from './minimap.js';
import { setFloorInstanceVisible } from './tiles.js';

// How far an imp/creature reveals around itself (Manhattan-ish, in tiles).
// Bumped from 4 → 7 so the dungeon doesn't feel like a flashlight beam.
const REVEAL_RADIUS = 7;
// Tile types that are always visible regardless of discovery state. Raw rock
// outside the dungeon shows the world's silhouette without leaking content
// (claimed floors, gold veins, hero compounds, portals all stay hidden).
const ALWAYS_VISIBLE = new Set([T_ROCK]);
// Periodic reveal sweep cadence — running every frame is wasteful; 4 Hz is
// imperceptible at the player's scale and ~60× cheaper.
const REVEAL_INTERVAL = 0.25;
let _revealAccum = 0;

// Discovery-state version counter. Bumped whenever a tile flips from undiscovered
// → discovered, a sight pulse is cast, or a sight pulse expires. Per-entity
// visibility cache keys off (lastTile, lastVersion) so unmoved entities under
// stable fog skip the visibility check entirely.
let _fogVersion = 0;

export function initFog() {
  for (let x = 0; x < GRID_SIZE; x++) {
    discovered[x] = [];
    for (let z = 0; z < GRID_SIZE; z++) {
      discovered[x][z] = false;
    }
  }
  // Seed reveal: the starting claimed area + 1-tile margin around the heart.
  const seed = INITIAL_RADIUS + 2;
  for (let dx = -seed; dx <= seed; dx++) {
    for (let dz = -seed; dz <= seed; dz++) {
      const x = HEART_X + dx, z = HEART_Z + dz;
      if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
      discovered[x][z] = true;
    }
  }
  _applyDiscoveryToTiles();
}

export function isDiscovered(x, z) {
  if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return false;
  if (discovered[x] && discovered[x][z]) return true;
  // Active Sight-of-Evil pulse counts as visible without committing the tile.
  for (const p of sightPulses) {
    if (sim.time > p.expiresAt) continue;
    if (Math.hypot(x - p.x, z - p.z) <= p.radius) return true;
  }
  return false;
}

// Force a tile to discovered. Used by the player-side dig/claim work paths so
// just touching a tile reveals it even if no entity stands inside REVEAL_RADIUS.
export function revealTile(x, z) {
  if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) return;
  if (!discovered[x]) discovered[x] = [];
  if (discovered[x][z]) return;
  discovered[x][z] = true;
  _fogVersion++;
  markMinimapDirty();
  const cell = grid[x] && grid[x][z];
  if (cell && cell.mesh) cell.mesh.visible = true;
  if (cell && cell.roomMesh) cell.roomMesh.visible = true;
  // Instanced floor cells have cell.mesh === null — flip them via the
  // InstancedMesh slot matrix instead. Returns false (no-op) if the cell
  // isn't currently an instanced floor type.
  setFloorInstanceVisible(x, z, true);
  // Portals own a single big swirl decor for the whole 4×4 footprint that
  // isn't tied to any single cell.mesh. First reveal of any tile in the
  // footprint flips the whole decor visible.
  const F = PORTAL_FOOTPRINT;
  for (const p of portals) {
    if (!p.decorMesh || p.decorMesh.visible) continue;
    if (x >= p.ax && x < p.ax + F && z >= p.az && z < p.az + F) {
      p.decorMesh.visible = true;
    }
  }
}

// Whether a tile's mesh should currently render. Mirrors `discovered` plus the
// always-visible-types whitelist plus active sight pulses.
export function isTileMeshVisible(x, z) {
  const cell = grid[x] && grid[x][z];
  if (!cell) return false;
  if (ALWAYS_VISIBLE.has(cell.type)) return true;
  return isDiscovered(x, z);
}

// Drop a Sight-of-Evil pulse — reveals an AoE for `duration` seconds, then
// commits any tile actually inside the radius to permanent-discovered.
export function castSightOfEvil(x, z, radius, duration) {
  sightPulses.push({ x, z, radius, expiresAt: sim.time + duration });
  _fogVersion++;
  // Eager commit: tiles inside the pulse get permanently revealed too —
  // matches DK2 where Sight of Evil leaves the area mapped after expiring.
  const r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const tx = x + dx, tz = z + dz;
      if (Math.hypot(dx, dz) <= radius) revealTile(tx, tz);
    }
  }
}

// Per-frame: every REVEAL_INTERVAL, walk player-faction entities and reveal
// tiles around each. Cheap because GRID_SIZE * dt is small.
export function tickFog(dt) {
  _revealAccum += dt;
  _expireSightPulses();
  if (_revealAccum >= REVEAL_INTERVAL) {
    _revealAccum = 0;
    // Imps + creatures both reveal. (Heroes deliberately do NOT reveal — they
    // explore the player's dungeon as they march, but their position alone
    // doesn't unmask a tile from the player's perspective.)
    for (const imp of imps) _revealAround(imp.position.x, imp.position.z);
    for (const c of creatures) {
      if (!c.userData || c.userData.faction !== FACTION_PLAYER) continue;
      _revealAround(c.position.x, c.position.z);
    }
  }
  // One visibility pass per frame — the per-entity short-circuit makes this
  // O(moved-entities) when fog state is stable, not O(all-entities).
  _applyVisibility();
}

function _revealAround(px, pz) {
  const cx = Math.round(px), cz = Math.round(pz);
  const r = REVEAL_RADIUS;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      if (Math.hypot(dx, dz) > r) continue;
      revealTile(cx + dx, cz + dz);
    }
  }
}

// Drop expired pulses + (optionally) commit them. We already commit eagerly
// in castSightOfEvil so this is just a cleanup pass.
function _expireSightPulses() {
  let expired = 0;
  for (let i = sightPulses.length - 1; i >= 0; i--) {
    if (sim.time >= sightPulses[i].expiresAt) {
      sightPulses.splice(i, 1);
      expired++;
    }
  }
  // Bump fog version once if anything expired so cached entity visibility
  // re-evaluates on the next pass (a tile inside an expiring pulse may now be
  // hidden again, unless eagerly committed by castSightOfEvil).
  if (expired > 0) _fogVersion++;
}

// Hide tile meshes + entities on undiscovered tiles. Run every frame so an
// entity that wanders into an unrevealed area disappears on the next frame.
function _applyVisibility() {
  // Entity hide
  for (const e of creatures) _maybeHide(e);
  for (const e of heroes) _maybeHide(e);
  for (const e of prisoners) _maybeHide(e);
}
function _maybeHide(e) {
  const ud = e.userData;
  if (!ud) return;
  const x = Math.round(e.position.x);
  const z = Math.round(e.position.z);
  // Skip the discovery check entirely if neither the entity's tile nor the
  // global fog state has changed since we last computed visibility for it.
  if (ud._fogTileX === x && ud._fogTileZ === z && ud._fogVersion === _fogVersion) return;
  ud._fogTileX = x;
  ud._fogTileZ = z;
  ud._fogVersion = _fogVersion;
  e.visible = isDiscovered(x, z);
}

// One-time pass after init: apply visibility (raw rock stays visible; anything
// non-rock is governed by `discovered`).
function _applyDiscoveryToTiles() {
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = grid[x] && grid[x][z];
      if (!cell) continue;
      const vis = isTileMeshVisible(x, z);
      if (cell.mesh) cell.mesh.visible = vis;
      if (cell.roomMesh) cell.roomMesh.visible = vis;
      // Instanced floor cells (T_FLOOR / T_CLAIMED / T_ENEMY_FLOOR).
      setFloorInstanceVisible(x, z, vis);
    }
  }
}
