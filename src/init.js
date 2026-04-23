// ============================================================
// INIT — one-time grid + dungeon setup
// ============================================================
// Runs after DOM/modules are ready. Fills the grid array with rock/gold,
// carves the initial claimed area around the heart, places the enemy
// dungeon, seeds portals, spawns initial imps, and queues border jobs.

import {
  GRID_SIZE, HEART_X, HEART_Z, INITIAL_RADIUS,
  T_ROCK, T_FLOOR, T_CLAIMED, T_HEART, T_GOLD,
  T_ENEMY_FLOOR, T_ENEMY_WALL, T_PORTAL_NEUTRAL,
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

export function initWorld() {
  for (let x = 0; x < GRID_SIZE; x++) {
    grid[x] = [];
    for (let z = 0; z < GRID_SIZE; z++) {
      grid[x][z] = { type: T_ROCK, mesh: null, marker: null, goldAmount: 0, roomType: null, roomMesh: null };
    }
  }

  // Sprinkle gold veins (clusters) in the outer rock
  const veinCount = 8;
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

  // Place a small enemy dungeon. 3x3 blue floor surrounded by a 1-tile wall ring.
  // Centered at (HEART_X - 7, HEART_Z - 7) — roughly 10 tiles from your heart.
  (function placeEnemyDungeon() {
    const EX = HEART_X - 7, EZ = HEART_Z - 7;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const x = EX + dx, z = EZ + dz;
        if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
        // Clear any gold vein that was randomly placed here
        grid[x][z].goldAmount = 0;
        if (Math.abs(dx) === 2 || Math.abs(dz) === 2) {
          setTile(x, z, T_ENEMY_WALL);
        } else {
          setTile(x, z, T_ENEMY_FLOOR);
        }
      }
    }
  })();

  // Place two portals on the map — buried in rock, waiting to be discovered.
  // Positioned so the player has to dig outward from their starting territory.
  // First is NE (away from enemy, easy find); second is SE (forces a longer expansion).
  (function placePortals() {
    const portalSites = [
      { x: HEART_X + 6, z: HEART_Z - 5 },
      { x: HEART_X + 7, z: HEART_Z + 6 },
    ];
    for (const site of portalSites) {
      // Clear any gold here and place the portal tile (starts neutral)
      grid[site.x][site.z].goldAmount = 0;
      setTile(site.x, site.z, T_PORTAL_NEUTRAL);
      portals.push({ x: site.x, z: site.z, claimed: false, spawnTimer: 0, spawnedCount: 0 });
    }
  })();

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
