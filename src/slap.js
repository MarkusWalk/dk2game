// ============================================================
// SLAP — player-direct kinetic feedback on own units
// ============================================================
// DK2-style slap: click your own imp/creature in a non-hand mode and you
// smack them. Costs HP (small), boosts work/attack speed briefly, raises
// anger on creatures (they remember). Satisfying, tactile, punishing.
//
// Buff is stored on userData as `slapBuffUntil` (absolute perf-time ms).
// AI modules check this to scale their speed:
//   - imps.js: work-timer progress and movement speed
//   - creatures.js: attack cooldown and movement speed

import { takeDamage } from './combat.js';
import { playSfx } from './audio.js';
import { imps, creatures } from './state.js';
import { pushEvent } from './hud.js';

const SLAP_DAMAGE = 2;
const SLAP_BUFF_DURATION_MS = 10_000;  // 10 s of +50% speed
const SLAP_ANGER_DELTA = 0.12;          // creatures only — imps don't sulk
export const SLAP_SPEED_MUL = 1.5;

export function slapEntity(entity) {
  if (!entity || !entity.userData) return;
  const ud = entity.userData;
  if (ud.hp <= 0) return;
  if (ud.state === 'held') return;  // can't slap while you're holding them
  // Only slap our own units — imps or creatures. Heroes are attacked, not slapped.
  if (!imps.includes(entity) && !creatures.includes(entity)) return;

  // Buff: set a future expiry. Each slap resets, never stacks.
  ud.slapBuffUntil = performance.now() + SLAP_BUFF_DURATION_MS;

  // Creature-only: bump anger. Imps don't carry anger in v1.
  if (creatures.includes(entity)) {
    ud.anger = Math.min(1, (ud.anger || 0) + SLAP_ANGER_DELTA);
    // If already mid-fight, slap can push a creature over the edge —
    // the fight-in-lair system reads `anger` each tick.
  }

  // Damage last — takeDamage can trigger death handlers which tear down userData.
  takeDamage(entity, SLAP_DAMAGE, null);
  playSfx('slap', { minInterval: 80 });
  pushEvent(creatures.includes(entity) ? 'Creature slapped' : 'Imp slapped');
}

// True if the slap buff is still active on this entity. AI should check
// this before every speed/cooldown read so buff decay is visible immediately.
export function hasSlapBuff(entity) {
  const ud = entity && entity.userData;
  if (!ud || !ud.slapBuffUntil) return false;
  if (performance.now() > ud.slapBuffUntil) {
    ud.slapBuffUntil = 0;
    return false;
  }
  return true;
}
