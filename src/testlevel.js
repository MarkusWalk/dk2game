// ============================================================
// TESTING LEVEL — quick-start scenario for perf / behavior testing
// ============================================================
// Triggered from the start screen's "Testing Level" button. Runs AFTER the
// normal initDungeon() has built the world, so it operates on the same grid
// the regular game uses (GRID_SIZE stays 64 — changing that requires invasive
// refactors). Carves a 32×32 dug-out area centered on the heart, designates
// one cluster of every room type, spawns a roster of creatures, and reveals
// the whole carved area so the player can immediately see + interact.

import {
  GRID_SIZE, HEART_X, HEART_Z,
  T_ROCK, T_GOLD, T_CLAIMED,
  ROOM_TREASURY, ROOM_LAIR, ROOM_HATCHERY,
  ROOM_TRAINING, ROOM_LIBRARY, ROOM_WORKSHOP,
} from './constants.js';
import { grid, stats } from './state.js';
import { setTile } from './tiles.js';
import { revealTile } from './fog.js';
import { designateTile, flushDirtyRooms } from './rooms.js';
import { spawnCreature } from './creatures.js';

// Half-extent of the test play area. A value of 16 yields a 32×32 carved-out
// dungeon — small enough to load fast, big enough to host one cluster of
// every room type with breathing space between them.
const HALF = 16;

// Where each room cluster sits relative to the heart and how big it is. Kept
// tiny on purpose: 3×3 is enough to trigger the room-tier visuals (large
// inlay, central light) without dominating the test area. Offsets fan out
// into all four quadrants so adjacent rooms don't accidentally merge.
const ROOM_BLOCKS = [
  { type: ROOM_TREASURY, ox:  4, oz: -8, w: 3, h: 3 },
  { type: ROOM_LAIR,     ox: -8, oz: -8, w: 3, h: 3 },
  { type: ROOM_HATCHERY, ox: -8, oz:  4, w: 3, h: 3 },
  { type: ROOM_TRAINING, ox:  4, oz:  4, w: 3, h: 3 },
  { type: ROOM_LIBRARY,  ox: -3, oz: -8, w: 2, h: 2 },
  { type: ROOM_WORKSHOP, ox: -3, oz:  6, w: 2, h: 2 },
];

const SPECIES_ROSTER = ['fly', 'beetle', 'goblin', 'warlock'];

export function seedTestingLevel() {
  // 1) Carve & claim the 32×32 area. Walk every tile in the play area; rocks
  //    and gold veins flip to claimed floor. Existing claimed tiles, the
  //    heart, portals, and hero compounds are left alone.
  for (let dx = -HALF; dx < HALF; dx++) {
    for (let dz = -HALF; dz < HALF; dz++) {
      const x = HEART_X + dx, z = HEART_Z + dz;
      if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
      const cell = grid[x][z];
      if (!cell) continue;
      if (cell.type === T_ROCK || cell.type === T_GOLD) {
        setTile(x, z, T_CLAIMED);
      }
    }
  }

  // 2) Reveal fog over the whole carved area so the test player isn't fogged
  //    out at start.
  for (let dx = -HALF; dx < HALF; dx++) {
    for (let dz = -HALF; dz < HALF; dz++) {
      revealTile(HEART_X + dx, HEART_Z + dz);
    }
  }

  // 3) Designate the room clusters. designateTile marks each tile dirty;
  //    flushDirtyRooms below builds plates, props, and inlays in one pass.
  for (const r of ROOM_BLOCKS) {
    for (let dx = 0; dx < r.w; dx++) {
      for (let dz = 0; dz < r.h; dz++) {
        const x = HEART_X + r.ox + dx;
        const z = HEART_Z + r.oz + dz;
        if (x < 0 || x >= GRID_SIZE || z < 0 || z >= GRID_SIZE) continue;
        const cell = grid[x][z];
        if (!cell || cell.type !== T_CLAIMED) continue;
        designateTile(x, z, r.type);
      }
    }
  }
  flushDirtyRooms();

  // 4) Pre-spawn a roster of creatures so the simulation has something to
  //    chew on immediately. Spread them around the heart in a ring so they
  //    don't all overlap on the same tile.
  const ringRadius = 3;
  const total = 12;
  for (let i = 0; i < total; i++) {
    const species = SPECIES_ROSTER[i % SPECIES_ROSTER.length];
    const angle = (i / total) * Math.PI * 2;
    const x = Math.round(HEART_X + Math.cos(angle) * ringRadius);
    const z = Math.round(HEART_Z + Math.sin(angle) * ringRadius);
    if (x === HEART_X && z === HEART_Z) continue;
    spawnCreature(x, z, species);
  }

  // 5) Top up resources so the tester can build / cast spells without first
  //    farming gold.
  stats.goldTotal = 5000;
  stats.mana = stats.manaMax;
}
