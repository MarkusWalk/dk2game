# AGENTS.md

Cheat sheet for AI coding agents (Claude Code, Cursor, Copilot, etc.). See [CLAUDE.md](CLAUDE.md) for full architecture.

## Fast facts

- **What:** Dungeon-Keeper-inspired browser game. The default client uses Babylon.js 9.25 via CDN. No build or npm toolchain.
- **Run:** `python3 -m http.server 8765` → <http://localhost:8765/index.html>. ES modules require HTTP, not file://.
- **Validate:** `for f in src/*.js src/babylon/*.js tests/*.mjs; do node --check "$f"; done && node tests/babylon-systems-smoke.mjs`
- **Live code:** [src/babylon/](src/babylon/) (ES modules). The former Three.js modules in [src/](src/) are preserved for reference. [dungeon_keeper_poc.html](dungeon_keeper_poc.html) is a frozen backup — never edit it.

## Babylon client

- Runtime, rendering quality and GLB assets → [src/babylon/core.js](src/babylon/core.js), [src/babylon/quality.js](src/babylon/quality.js), [src/babylon/assets.js](src/babylon/assets.js).
- World, creatures and gameplay systems → [src/babylon/world.js](src/babylon/world.js), [src/babylon/entities.js](src/babylon/entities.js), [src/babylon/defenses.js](src/babylon/defenses.js), [src/babylon/magic.js](src/babylon/magic.js).
- Navigation, Workshop logistics and saves → [src/babylon/navigation.js](src/babylon/navigation.js), [src/babylon/workshop.js](src/babylon/workshop.js), [src/babylon/persistence.js](src/babylon/persistence.js).
- Possession and additional scene dressing → [src/babylon/possession.js](src/babylon/possession.js), [src/babylon/visuals.js](src/babylon/visuals.js).
- Per-frame orchestration and shared resources → [src/babylon/main.js](src/babylon/main.js).
- Browser interaction → [src/babylon/input.js](src/babylon/input.js), [src/babylon/ui.js](src/babylon/ui.js), [styles-babylon.css](styles-babylon.css).

## Preserved Three.js reference

The guidance below applies to the preserved legacy modules only; do not wire new default-client features into them.

### Where things live

- Tunables → [src/constants.js](src/constants.js). Never hard-code a number a second time.
- Mutable shared state → [src/state.js](src/state.js). Arrays mutated in place; scalars as `{ value }` refs.
- Per-frame orchestration → [src/main.js](src/main.js) (animation loop calls each module's tick in order).
- The grid is the source of truth: `grid[x][z] = { type, mesh, marker, goldAmount, roomType, roomMesh }`.

### Hot rules

1. **Preserve comments.** They document balance decisions and gotchas.
2. **Don't reassign state.js exports.** Mutate arrays, write to ref objects.
3. **Don't dispose shared materials** from [src/materials.js](src/materials.js). Per-instance geo/mats only.
4. **Deterministic decor:** variant selection hashes `(x, z)`, not `Math.random()`.
5. **No bundlers, no npm, no TypeScript.** Babylon.js is a pinned CDN global in the default client; Three.js remains a CDN global only in the preserved client.
6. **Behavior-preserving edits.** If you spot a bug, flag it — don't silently "fix while you're here."

### Known pre-existing bugs (do not silently patch)

1. Wave banner CSS timeout is 500ms shorter than `invasion.warnUntil` (heroes.js / hud.js).
2. `setTile` leaks `T_GOLD` fleck children on replacement (tiles.js).
3. `dropHeld` has a no-op branch `ud.isImp ? 0 : 0` (hand.js).
4. `updateCreature` guards against `'moving_to_eat'` state that's never set (creatures.js).

### Common tasks

- **Add a tile type:** append a `T_*` constant in constants.js, add a material to materials.js, handle it in `setTile` (tiles.js), and update `isWalkable` (pathfinding.js) if relevant.
- **Add a new combatant:** give it `userData = { faction, hp, maxHp, atk, atkCooldown, damageFlash }`, add a branch to `dispatchDeath` in combat.js, write its tick and call from the animation loop in main.js.
- **Add a sound:** add a function to `SYNTHS` in audio.js, call `playSfx('name')` from wherever.
- **Add a spell:** extend the toolbar button in index.html, add constants in constants.js, implement cast logic in spells.js, wire mode dispatch in input.js.
