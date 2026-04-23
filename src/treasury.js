// ============================================================
// TREASURY — gold deposit pipeline
// ============================================================
// Imps carrying gold path to the nearest reachable treasury (adjacent) and
// dump into it. The tile mesh's updateGoldPile grows the visible pile based
// on amount; stats.goldTotal is the player's spendable balance.

import { treasuries, stats } from './state.js';
import { findPathToAdjacent } from './pathfinding.js';
import { updateGoldPile } from './rooms.js';
import { playSfx } from './audio.js';
import { spawnGoldBurst } from './effects.js';

export function findNearestTreasury(imp) {
  let best = null;
  let bestLen = Infinity;
  for (const tr of treasuries) {
    const path = findPathToAdjacent(imp.userData.gridX, imp.userData.gridZ, tr.x, tr.z);
    if (path && path.length < bestLen) {
      bestLen = path.length;
      best = { treasury: tr, path };
    }
  }
  return best;
}

export function depositGold(imp, treasury) {
  const amount = imp.userData.carrying;
  if (amount <= 0) return;
  treasury.amount += amount;
  stats.goldTotal += amount;
  imp.userData.carrying = 0;
  imp.userData.carriedGold.visible = false;
  updateGoldPile(treasury.pile, treasury.amount);
  // Small sparkle on deposit
  spawnGoldBurst(treasury.x, treasury.z);
  playSfx('coin', { minInterval: 90 });
}
