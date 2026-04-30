// ============================================================
// INIT — one-time grid + dungeon setup
// ============================================================
// Runs after DOM/modules are ready. Fills the grid array with rock/gold,
// carves the initial claimed area around the heart, places the enemy
// dungeon, seeds portals, spawns initial imps, and queues border jobs.

import {
  GRID_SIZE, HEART_X, HEART_Z, INITIAL_RADIUS,
  T_ROCK, T_FLOOR, T_CLAIMED, T_HEART, T_GOLD,
  T_PORTAL_NEUTRAL,
  TREASURY_POSITIONS, ROOM_TREASURY,
} from './constants.js';
import { grid, portals, heartRef, torches } from './state.js';
import { scene, tileGroup } from './scene.js';
import { setTile, createTileMesh } from './tiles.js';
import { createDungeonHeart } from './heart.js';
import { createTorch } from './torches.js';
import { designateTile } from './rooms.js';
import { queueBorderJobsAround } from './jobs.js';
import { spawnImp } from './imps.js';
import { placeHeroLairs } from './heroes.js';
import { initFog } from './fog.js';

export function initWorld() {
  for (let x = 0; x < GRID_SIZE; x++) {
    grid[x] = [];
    for (let z = 0; z < GRID_SIZE; z++) {
      grid[x][z] = { type: T_ROCK, mesh: null, marker: null, goldAmount: 0, roomType: null, roomMesh: null };
    }
  }

  // Sprinkle gold veins (clusters) in the outer rock
  // 64×64 has ~4× the area of the original 30×30, so scale up vein count.
  const veinCount = 32;
  for (let v = 0; v < veinCount; v++) {
    let cx, cz, dist;
    do {
      cx = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
      cz = 2 + Math.floor(Math.random() * (GRID_SIZE - 4));
      dist = Math.hypot(cx - HEART_X, cz - HEART_Z);
    } while (dist < 6);
    const size = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < size; i++) {
      const ox = cx + Math.floor((Math.random() - 0.5) * 3);
      const oz = cz + Math.floor((Math.random() - 0.5) * 3);
      if (ox >= 0 && ox < GRID_SIZE && oz >= 0 && oz < GRID_SIZE) {
        grid[ox][oz].type = T_GOLD;
        grid[ox][oz].goldAmount = 50 + Math.floor(Math.random() * 100);
      }
    }
  }

  // Build all tiles
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const t = grid[x][z].type;
      setTile(x, z, t);
    }
  }

  // Carve initial dungeon around heart
  for (let dx = -INITIAL_RADIUS; dx <= INITIAL_RADIUS; dx++) {
    for (let dz = -INITIAL_RADIUS; dz <= INITIAL_RADIUS; dz++) {
      const x = HEART_X + dx, z = HEART_Z + dz;
      if (dx === 0 && dz === 0) continue;
      setTile(x, z, T_CLAIMED);
    }
  }
  // Heart tile marker (no tile mesh — heart model replaces it)
  grid[HEART_X][HEART_Z].type = T_HEART;
  if (grid[HEART_X][HEART_Z].mesh) {
    tileGroup.remove(grid[HEART_X][HEART_Z].mesh);
    grid[HEART_X][HEART_Z].mesh = null;
  }
  // Put a claimed floor under the heart
  const floorBeneathHeart = createTileMesh(HEART_X, HEART_Z, T_CLAIMED);
  tileGroup.add(floorBeneathHeart);
  grid[HEART_X][HEART_Z].mesh = floorBeneathHeart;
  grid[HEART_X][HEART_Z].type = T_HEART;
}

export function initDungeon() {
  // Fog-of-war must initialize BEFORE initWorld so setTile() during the world
  // build can read discovered[] and hide undiscovered meshes from the start.
  initFog();
  initWorld();

  // Place dungeon heart
  const heart = createDungeonHeart(HEART_X, HEART_Z);
  scene.add(heart);
  heartRef.heart = heart;

  // Place torches around heart
  const torchPositions = [
    [HEART_X - 2, HEART_Z - 2],
    [HEART_X + 2, HEART_Z - 2],
    [HEART_X - 2, HEART_Z + 2],
    [HEART_X + 2, HEART_Z + 2],
  ];
  for (const [tx, tz] of torchPositions) {
    const t = createTorch(tx, tz);
    scene.add(t);
    torches.push(t);
  }

  // Designate initial treasury tiles via the rooms system (same 8 positions as before,
  // but now each is a first-class ROOM_TREASURY designation — more can be added by the
  // player, and they can all be un-designated when empty).
  for (const [dx, dz] of TREASURY_POSITIONS) {
    const tx = HEART_X + dx, tz = HEART_Z + dz;
    designateTile(tx, tz, ROOM_TREASURY);
  }

  // Hero lairs (4 quadrant strongholds + 1 boss stronghold) are placed by
  // placeHeroLairs() in heroes.js — called below after portals so portals can
  // be relocated if a lair landed on top of them.

  // Place four portals on the map — buried in rock, waiting to be discovered.
  // Spread across all four quadrants of the 64×64 map so the player has to
  // expand in multiple directions to grow their creature pool.
  (function placePortals() {
    const portalSites = [
      { x: HEART_X + 12, z: HEART_Z - 10 },  // NE
      { x: HEART_X + 14, z: HEART_Z + 12 },  // SE
      { x: HEART_X - 15, z: HEART_Z + 9  },  // SW
      { x: HEART_X - 11, z: HEART_Z - 13 },  // NW
    ];
    for (const site of portalSites) {
      // Clear any gold here and place the portal tile (starts neutral)
      grid[site.x][site.z].goldAmount = 0;
      setTile(site.x, site.z, T_PORTAL_NEUTRAL);
      portals.push({ x: site.x, z: site.z, claimed: false, spawnTimer: 0, spawnedCount: 0 });
    }
  })();

  // Place hero strongholds — 4 quadrant lairs + 1 boss lair at the far edge.
  placeHeroLairs();

  // Spawn initial imps
  spawnImp(HEART_X - 1, HEART_Z);
  spawnImp(HEART_X + 1, HEART_Z);
  spawnImp(HEART_X, HEART_Z - 1);
  spawnImp(HEART_X, HEART_Z + 1);

  // Seed border jobs (reinforce, claim_wall, enemy-floor liberation) for every tile of the initial claimed area.
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      if (grid[x][z].type === T_CLAIMED) {
        queueBorderJobsAround(x, z);
      }
    }
  }
}
