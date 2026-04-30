// ============================================================
// INIT — one-time grid + dungeon setup
// ============================================================
// Runs after DOM/modules are ready. Fills the grid array with rock/gold,
// carves the initial claimed area around the heart, places the enemy
// dungeon, seeds portals, spawns initial imps, and queues border jobs.

import {
  GRID_SIZE, HEART_X, HEART_Z, INITIAL_RADIUS,
  T_ROCK, T_FLOOR, T_CLAIMED, T_HEART, T_GOLD,
  T_PORTAL_NEUTRAL, PORTAL_FOOTPRINT,
  TREASURY_POSITIONS, ROOM_TREASURY,
} from './constants.js';
import { grid, portals, heartRef, torches } from './state.js';
import { scene, tileGroup } from './scene.js';
import { setTile, createTileMesh } from './tiles.js';
import {
  PORTAL_NEUTRAL_SWIRL_MAT, PORTAL_CLAIMED_SWIRL_MAT,
} from './materials.js';

const THREE = window.THREE;

// Build the swirl + light decor that hovers over a 4×4 portal footprint. The
// per-cell tiles only render a flat dark base; this is the "portal" visual.
// Stored on `portal.decorMesh` and animated by creatures.animatePortals().
function _buildPortalDecor(claimed) {
  const g = new THREE.Group();
  const swirlMat = claimed ? PORTAL_CLAIMED_SWIRL_MAT : PORTAL_NEUTRAL_SWIRL_MAT;
  const swirl1 = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.14, 8, 32), swirlMat);
  swirl1.rotation.x = Math.PI / 2;
  swirl1.position.y = 0.5;
  g.add(swirl1);
  const swirl2 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.10, 6, 28), swirlMat);
  swirl2.rotation.x = Math.PI / 2;
  swirl2.position.y = 0.85;
  g.add(swirl2);
  const swirl3 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 6, 22), swirlMat);
  swirl3.rotation.x = Math.PI / 2;
  swirl3.position.y = 1.15;
  g.add(swirl3);
  const light = new THREE.PointLight(claimed ? 0xff4020 : 0x6060a0, 1.4, 9.0, 2);
  light.position.y = 1.0;
  g.add(light);
  g.userData = { swirl1, swirl2, swirl3, light, claimed };
  return g;
}

// Refresh the decor mesh's material/light when a portal flips claimed.
export function refreshPortalDecor(portal) {
  const d = portal.decorMesh;
  if (!d) return;
  const mat = portal.claimed ? PORTAL_CLAIMED_SWIRL_MAT : PORTAL_NEUTRAL_SWIRL_MAT;
  d.userData.swirl1.material = mat;
  d.userData.swirl2.material = mat;
  d.userData.swirl3.material = mat;
  d.userData.light.color.setHex(portal.claimed ? 0xff4020 : 0x6060a0);
  d.userData.claimed = portal.claimed;
}
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
  // Heart tile marker. Rocks are now stored in a shared InstancedMesh (rather
  // than a per-cell mesh), so we go through setTile first to release any rock
  // slot at this cell. setTile(T_HEART) leaves cell.mesh null (createTileMesh
  // has no T_HEART branch), then we override with a claimed-floor underlay so
  // the heart model rests on visible stone.
  setTile(HEART_X, HEART_Z, T_HEART);
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
  // Each portal is a 4×4 footprint anchored at its NW corner; the per-tile
  // floor is plain dark stone, with a single big swirling decor mesh hovering
  // over the centre. Spread across all four quadrants so the player has to
  // expand in multiple directions to grow their creature pool.
  (function placePortals() {
    const F = PORTAL_FOOTPRINT;
    // Anchor (NW corner) of each 4×4 footprint. Picked so the original 1×1
    // sites end up roughly inside the new pad.
    const portalSites = [
      { ax: HEART_X + 11, az: HEART_Z - 12 },  // NE
      { ax: HEART_X + 12, az: HEART_Z + 10 },  // SE
      { ax: HEART_X - 17, az: HEART_Z + 7  },  // SW
      { ax: HEART_X - 13, az: HEART_Z - 15 },  // NW
    ];
    for (const site of portalSites) {
      // Clamp so the 4-tile footprint stays in-grid.
      const ax = Math.max(0, Math.min(GRID_SIZE - F, site.ax));
      const az = Math.max(0, Math.min(GRID_SIZE - F, site.az));
      for (let dx = 0; dx < F; dx++) {
        for (let dz = 0; dz < F; dz++) {
          const x = ax + dx, z = az + dz;
          grid[x][z].goldAmount = 0;
          setTile(x, z, T_PORTAL_NEUTRAL);
        }
      }
      // Build a single swirl/light decor at footprint centre. Grid cells live
      // at integer coords so the centre of a 4-tile span is anchor + 1.5.
      const decor = _buildPortalDecor(false);
      decor.position.set(ax + (F - 1) / 2, 0, az + (F - 1) / 2);
      // Hidden until any tile in the footprint is discovered (fog.revealTile
      // flips this on first reveal). A claimed portal forces visible too.
      decor.visible = false;
      scene.add(decor);
      // Spawn-centre tile = inner NE-ish cell (ax+1, az+1). Existing creature
      // code reads portal.x/portal.z as the spawn/leave anchor — we keep
      // these populated so callers don't need to learn about ax/az.
      portals.push({
        ax, az,
        x: ax + 1, z: az + 1,
        claimed: false, spawnTimer: 0, spawnedCount: 0,
        decorMesh: decor,
      });
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
