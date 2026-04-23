# AGENTS.md

Cheat sheet for AI coding agents (Claude Code, Cursor, Copilot, etc.). See [CLAUDE.md](CLAUDE.md) for full architecture.

## Fast facts

- **What:** Dungeon-Keeper-inspired browser game. Three.js r128 via CDN. No build, no npm, no tests.
- **Run:** `python3 -m http.server 8765` → <http://localhost:8765/index.html>. ES modules require HTTP, not file://.
- **Syntax check:** `for f in src/*.js; do node --check "$f"; done`
- **Live code:** [src/](src/) (ES modules). [dungeon_keeper_poc.html](dungeon_keeper_poc.html) is a frozen backup — never edit it.

## Where things live

- Tunables → [src/constants.js](src/constants.js). Never hard-code a number a second time.
- Mutable shared state → [src/state.js](src/state.js). Arrays mutated in place; scalars as `{ value }` refs.
- Per-frame orchestration → [src/main.js](src/main.js) (animation loop calls each module's tick in order).
- The grid is the source of truth: `grid[x][z] = { type, mesh, marker, goldAmount, roomType, roomMesh }`.

## Hot rules

1. **Preserve comments.** They document balance decisions and gotchas.
2. **Don't reassign state.js exports.** Mutate arrays, write to ref objects.
3. **Don't dispose shared materials** from [src/materials.js](src/materials.js). Per-instance geo/mats only.
4. **Deterministic decor:** variant selection hashes `(x, z)`, not `Math.random()`.
5. **No bundlers, no npm, no TypeScript.** Three.js stays a CDN global (`const THREE = window.THREE;` at each module top).
6. **Behavior-preserving edits.** If you spot a bug, flag it — don't silently "fix while you're here."

## Known pre-existing bugs (do not silently patch)

1. Wave banner CSS timeout is 500ms shorter than `invasion.warnUntil` (heroes.js / hud.js).
2. `setTile` leaks `T_GOLD` fleck children on replacement (tiles.js).
3. `dropHeld` has a no-op branch `ud.isImp ? 0 : 0` (hand.js).
4. `updateCreature` guards against `'moving_to_eat'` state that's never set (creatures.js).

## Common tasks

- **Add a tile type:** append a `T_*` constant in constants.js, add a material to materials.js, handle it in `setTile` (tiles.js), and update `isWalkable` (pathfinding.js) if relevant.
- **Add a new combatant:** give it `userData = { faction, hp, maxHp, atk, atkCooldown, damageFlash }`, add a branch to `dispatchDeath` in combat.js, write its tick and call from the animation loop in main.js.
- **Add a sound:** add a function to `SYNTHS` in audio.js, call `playSfx('name')` from wherever.
- **Add a spell:** extend the toolbar button in index.html, add constants in constants.js, implement cast logic in spells.js, wire mode dispatch in input.js.
