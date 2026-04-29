// ============================================================
// PRISONERS — captured heroes in prison cages or on torture racks.
// ============================================================
// On non-boss hero death, tryCapture() looks for a free prison tile and, if
// one exists, repurposes the hero's Group as a prisoner instead of removing
// it. The hero leaves the heroes[] array, joins prisoners[], and is teleported
// onto the cage tile with a visible struggle animation.
//
// Conversion outcomes:
//   - state='imprisoned' on a prison tile → starves after PRISON_STARVE_DURATION
//     and a Skeleton spawns in their place (player faction).
//   - state='tortured' on a torture tile (set when the player drops them on
//     a torture cell via the Hand) → flips after TORTURE_DURATION into a
//     Vampire on the player side.
//
// The Hand can pick up prisoners via the existing pickUpEntity flow — they're
// just another entity. Dropping on a prison or torture tile re-anchors them.

import {
  ROOM_PRISON, ROOM_TORTURE, FACTION_HERO,
  PRISON_STARVE_DURATION, TORTURE_DURATION, GRID_SIZE,
} from './constants.js';
import { grid, prisoners, heroes, sim } from './state.js';
import { scene } from './scene.js';
import { spawnPulse, spawnSparkBurst } from './effects.js';
import { playSfx } from './audio.js';
import { pushEvent } from './hud.js';
import { spawnCreature } from './creatures.js';

// ---- Free-tile lookup helpers ----
// A "free" cage / rack tile has no prisoner currently anchored to it. We tag
// occupied cells via cell._prisoner so the lookup is O(rooms) without a
// per-frame scan of every prisoner.
function _findFreeTile(roomType) {
  let best = null, bestDist = Infinity;
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let z = 0; z < GRID_SIZE; z++) {
      const cell = grid[x][z];
      if (cell.roomType !== roomType) continue;
      if (cell._prisoner) continue;
      // Prefer the first usable cell — order doesn't matter for v1.
      if (bestDist === Infinity) { best = { x, z }; bestDist = 0; break; }
    }
    if (best) break;
  }
  return best;
}

// Try to convert a dying hero into a prisoner. Returns true if captured (the
// caller should then SKIP the normal hero-removal path).
export function tryCaptureHero(entity) {
  const ud = entity.userData;
  if (!ud || ud.faction !== FACTION_HERO) return false;
  if (ud.isBoss) return false;                  // boss is always a kill
  const slot = _findFreeTile(ROOM_PRISON);
  if (!slot) return false;                      // no prison cage available

  // Snap to the cage tile. Force HP to 1 so combat code stops targeting it,
  // and flip faction so heroes / creatures alike ignore the prisoner.
  entity.position.set(slot.x, 0.1, slot.z);
  ud.gridX = slot.x; ud.gridZ = slot.z;
  ud.faction = 'prisoner';
  ud.captured = true;
  ud.hp = 1;
  ud.maxHp = Math.max(1, ud.maxHp);
  ud.path = null;
  ud.fightTarget = null;
  ud.state = 'imprisoned';
  ud.captureTimer = 0;
  ud.captureRoomType = ROOM_PRISON;
  ud.cageX = slot.x; ud.cageZ = slot.z;

  // Clear from heroes[] so updateHero doesn't tick it; add to prisoners[].
  const hi = heroes.indexOf(entity);
  if (hi >= 0) heroes.splice(hi, 1);
  prisoners.push(entity);

  // Mark cage occupied so the next capture finds a different cell.
  grid[slot.x][slot.z]._prisoner = entity;

  // Effects + log line
  spawnPulse(slot.x, slot.z, 0x9098b0, 0.3, 1.2);
  spawnSparkBurst(slot.x, slot.z, 0xa0a8c0, 18, 1.0);
  playSfx('reinforce', { minInterval: 200 });
  pushEvent('Hero captured');
  return true;
}

// Re-anchor a prisoner onto a new tile (called from hand.js drops). If the
// destination is a torture tile and the prisoner is currently imprisoned,
// flip them to 'tortured' (timer resets). Same logic in reverse for prison.
export function reanchorPrisoner(entity, x, z) {
  const ud = entity.userData;
  const cell = grid[x][z];
  if (!cell) return false;
  if (cell.roomType !== ROOM_PRISON && cell.roomType !== ROOM_TORTURE) return false;
  if (cell._prisoner && cell._prisoner !== entity) return false;
  // Vacate previous cage/rack
  if (ud.cageX != null) {
    const prev = grid[ud.cageX] && grid[ud.cageX][ud.cageZ];
    if (prev && prev._prisoner === entity) prev._prisoner = null;
  }
  cell._prisoner = entity;
  ud.cageX = x; ud.cageZ = z;
  ud.gridX = x; ud.gridZ = z;
  entity.position.set(x, 0.1, z);
  // Reset conversion timer if room type changed.
  if (ud.captureRoomType !== cell.roomType) {
    ud.captureTimer = 0;
    ud.captureRoomType = cell.roomType;
    ud.state = (cell.roomType === ROOM_TORTURE) ? 'tortured' : 'imprisoned';
    if (cell.roomType === ROOM_TORTURE) {
      spawnSparkBurst(x, z, 0xff4040, 16, 1.0);
      playSfx('alarm', { minInterval: 800 });
      pushEvent('Hero on the rack');
    }
  }
  return true;
}

export function isPrisoner(entity) {
  return !!(entity && entity.userData && entity.userData.captured);
}

// Per-frame tick — advances each prisoner's timer toward their conversion.
// Called from main.js after creature ticks but before damage visuals.
export function tickPrisoners(dt) {
  for (let i = prisoners.length - 1; i >= 0; i--) {
    const p = prisoners[i];
    const ud = p.userData;
    // While the Hand is carrying a prisoner, freeze their timer + idle their
    // visuals — the hand renders them above the playfield separately.
    if (ud.state === 'held') continue;

    // Verify they're still on a valid cage / rack tile. If the cell got
    // un-designated under them, drop the conversion and treat them as an
    // escape (just remove).
    const cell = grid[ud.cageX] && grid[ud.cageX][ud.cageZ];
    if (!cell || (cell.roomType !== ROOM_PRISON && cell.roomType !== ROOM_TORTURE)) {
      _despawnPrisoner(p);
      pushEvent('Hero escaped — no cage');
      continue;
    }

    // Subtle struggle wobble — spin slightly, bob in place.
    const t = sim.time;
    p.rotation.y = Math.sin(t * 1.4 + ud.cageX * 0.7) * 0.4;
    p.position.y = 0.05 + Math.abs(Math.sin(t * 2)) * 0.04;

    // Advance timer.
    ud.captureTimer = (ud.captureTimer || 0) + dt;
    const isTorture = (ud.state === 'tortured');
    const limit = isTorture ? TORTURE_DURATION : PRISON_STARVE_DURATION;
    if (ud.captureTimer >= limit) {
      _convertPrisoner(p, isTorture);
    }
  }
}

function _convertPrisoner(p, isTorture) {
  const ud = p.userData;
  const x = ud.cageX, z = ud.cageZ;
  const species = isTorture ? 'vampire' : 'skeleton';
  // Big effect on conversion — the player should notice payoff.
  spawnPulse(x, z, isTorture ? 0xc02030 : 0xa0b0c8, 0.5, 1.6);
  spawnSparkBurst(x, z, isTorture ? 0xff4040 : 0xd0c8b0, 30, 1.4);
  playSfx(isTorture ? 'spawn' : 'death', { minInterval: 200 });
  pushEvent(isTorture ? 'A vampire rises from the rack' : 'A skeleton claws from the cage');
  _despawnPrisoner(p);
  // Spawn the new player-side creature in the cage tile.
  spawnCreature(x, z, species);
}

function _despawnPrisoner(p) {
  const ud = p.userData;
  if (ud.cageX != null) {
    const cell = grid[ud.cageX] && grid[ud.cageX][ud.cageZ];
    if (cell && cell._prisoner === p) cell._prisoner = null;
  }
  scene.remove(p);
  // Dispose any per-instance materials so we don't leak. Shared mats are skipped.
  p.traverse(o => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material && o.material.userData && o.material.userData.perInstance) {
      o.material.dispose();
    }
  });
  const i = prisoners.indexOf(p);
  if (i >= 0) prisoners.splice(i, 1);
}
