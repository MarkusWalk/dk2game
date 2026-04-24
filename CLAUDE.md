# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Dungeon-Keeper-inspired 3D browser survival game. Zero build step, zero dependencies installed locally. Three.js r128 is loaded from a CDN at runtime.

Defend a Dungeon Heart on a 30×30 grid against 10 waves of heroes. Imps dig/claim/reinforce. Portals spawn creatures from a species roster (Fly/Beetle/Goblin/Warlock) with hunger/sleep/pay needs, utility-scored AI, flee + kite combat behaviors, and intent bubbles. Heroes pathfind to the heart; wave 10 spawns a Knight Commander boss.

## Running

ES modules require a server (no file://):

```
python3 -m http.server 8765
```

Then open http://localhost:8765/index.html. No npm, no tests, no linter, no build.

`dungeon_keeper_poc.html` is the original single-file prototype kept as a reference/backup — not loaded at runtime. All live code is in `src/`.

## Architecture

### Module-graph shape

`index.html` loads `three.min.js` (classic script, global `window.THREE`) then `src/main.js` as a deferred ES module. Every module does `const THREE = window.THREE;` rather than importing from a bundle — this preserves exact r128 parity.

`main.js` orchestrates the per-frame animation loop and calls tick functions from other modules in a fixed order (imps → creatures → portals → heroes → waves → heart → damage visuals → spells → camera → HUD → render). Initialization order: `installCameraInput()` and `installInput()` at module-top, then `installHud()` + `initDungeon()` inside `bootstrap()` on DOMContentLoaded.

### State ownership

The game is one big shared-state simulation. `src/state.js` owns all mutable cross-module state — every array (`grid`, `imps`, `creatures`, `heroes`, `jobs`, `portals`, `treasuries`, `rooms`, `goldBursts`, `pulses`, `sparkBursts`, `hpBars`, `droppedGold`, `torches`, `floatingDamageNumbers`, `_lightningBolts`, `levelBadges`) and every object-wrapped mutable scalar (`GAME`, `invasion`, `buildModeRef`, `handState`, `dragState`, `cameraControls`, `heartRef`, `impRespawn`, `spells`, `spellBtnRefs`, `camKeys`, `previewMeshes`, `previewPool`).

Convention: other modules import these and **mutate in place** (never reassign). Scalars that need cross-module reassignment are wrapped as `{ value }` refs (e.g. `buildModeRef.value`, `handState.heldEntity`, `cameraRef.camera`) so mutations are visible to readers.

`src/constants.js` owns all immutable tunables — tile type IDs (`T_ROCK` … `T_PORTAL_CLAIMED`), speeds, HP, costs, cooldowns, room types, spell parameters, camera defaults. Import by name, never duplicate.

### Grid cells

`grid[x][z]` is the universal source of truth for a tile. Each cell holds `{ type, mesh, marker, goldAmount, roomType, roomMesh }`. `type` is one of the `T_*` constants; `roomType` is `null` or one of `ROOM_TREASURY | ROOM_LAIR | ROOM_HATCHERY | ROOM_TRAINING | ROOM_LIBRARY`. Tile state changes go through `setTile(x, z, type)` in `tiles.js` which swaps the mesh and disposes the old geometry.

### Rooms

A "room" is a connected component of claimed-floor tiles sharing a `roomType` tag. Per-tile props (coin piles, beds, patches, training dummies, bookshelves) live on `cell.roomMesh`. Room-level decor (centroid light, floor inlay, hatchery chickens) lives on entries in the `rooms` array with `{ type, centroid, centerLight, inlay, chickens, cells }`. Designating or undesignating a tile calls `rebuildRoomAround(x, z)` which recomputes connected components for the affected neighborhood. All of this is in `src/rooms.js` (~1400 lines — the single biggest module). Training and Library rooms grant per-tick benefits via `tickRoomBenefits(dt)` (creatures gain XP on training tiles, 2× in Large rooms ≥ `TRAINING_LARGE_SIZE`; Warlocks generate `stats.research` on library tiles).

### Creatures and species

`src/creatures.js` owns the roster. `SPECIES` in `constants.js` defines per-species stats + AI tuning (`hp`, `atk`, `speed`, `favoriteRoom`, `fleeBelow`, `kiteMin`, `decisionInterval`, `commitPause`, `spawnWeight`, optional `requiresRoom`). `_createSpeciesBody(species)` dispatches to `createFly/Beetle/Goblin/Warlock` returning `{ group, parts }`; `spawnCreature(x, z, forcedSpecies?)` wires userData and attaches level + mood + intent badges. Portals roll species via `_pickSpawnSpecies()` using `spawnWeight` (Warlocks gated by `requiresRoom: 'library'`).

### Creature AI (utility scoring)

`updateCreature` runs combat first (`_creatureCombatTick`). Combat has four branches: **flee** (HP below `fleeBelow`, runs away from nearest hero), **kite** (ranged species with hero inside `kiteMin`, back away while firing), **chase** (out of range), **strike** (in range + cooldown). Outside combat, creatures re-evaluate their goal on a species-specific `decisionInterval` via `_reevaluateGoal`, which scores candidates (`eat`/`sleep`/`pay`/`help`/`rally`/`train`/`study`/`favorite`/`wander`) and picks the highest, with a +0.08 stick bonus for the current goal (hysteresis). After a new goal is chosen, `commitUntil` freezes the creature for `commitPause` seconds while it rotates to face the target — reads as "thinking." Distress is broadcast via `ud.distressAt` (set inside `takeDamage` for player-faction entities); other creatures within `DISTRESS_RADIUS` score a `help` goal toward the source for `DISTRESS_TTL` seconds. Affinity table `AFFINITY[a][b]` in constants nudges anger up/down when disliked/liked species are adjacent.

Intent badges (`src/intent.js`): `setIntent(c, key)` flashes a glyph sprite above a creature for ~1.2 s whenever a new high-level goal is committed. `updateIntentBadges()` is called from the animation loop; `removeIntentBadgeFor(entity)` is invoked from `onEntityDie` to avoid sprite leaks.

### Hand of Keeper, spells, and input modes

`buildModeRef.value` is one of `'dig' | 'treasury' | 'lair' | 'hatchery' | 'training' | 'library' | 'hand' | 'lightning' | 'heal' | 'callToArms' | 'haste'`. Hotkeys 1–9, 0, - map left→right across the toolbar. `input.js` short-circuits spell modes (single-click cast) and falls through to drag-paint for room modes. Spell defs live in a central `SPELL_DEFS` map inside `spells.js`; Call to Arms drops a rally flag (read via `state.rally`) that creature AI pulls idle units toward, Haste sets `ud.hasteUntil` which `_speedMul` multiplies movement + attack by 1.5×.

### Combat pipeline

Every combatant (imp, creature, hero, boss, heart) has `userData` with `{ faction, hp, maxHp, atk, atkCooldown, damageFlash }`. `takeDamage(target, amount, attacker)` in `combat.js` is the single damage resolver — it handles HP deduction, damage flash timing, floating damage numbers, and routes to the type-specific death handler. Adding a new combatant type means (a) giving it the userData shape, (b) adding a case to `dispatchDeath`, (c) writing its AI tick and calling it from `main.js`'s loop.

### Jobs + pathfinding

`jobs.js` owns the work queue; each job is `{ type, x, z, claimedBy, progress }`. Priority is `JOB_PRIORITY = ['dig', 'claim', 'claim_wall', 'reinforce']` — aggressive expansion outranks passive fortification. Imps in `imps.js` self-assign the nearest job each idle cycle. Pathing goes through `findPath` / `findPathToAdjacent` in `pathfinding.js` (A* over `isWalkable` tiles). When a tile's walkability changes (mined, claimed, wall built), callers should re-queue border jobs around it via `queueBorderJobsAround` in `jobs.js`.

### Input modes

See "Hand of Keeper, spells, and input modes" above. `hand.js` owns pickup/drop; multi-touch (pinch + two-finger pan) is in `camera-controls.js`, which also owns the keyboard listeners for camera.

### Audio

`src/audio.js` is fully procedural — every sound is oscillators + filtered noise + gain envelopes synthesised on demand. No audio files. The `AudioContext` is lazily created on first user gesture (browser autoplay policy). `playSfx(name, opts)` is throttled per-sound via `lastPlayed` to prevent spam. Adding a new sound: add a function to `SYNTHS` and call `playSfx('name')`.

### Circular imports

`combat.js` ↔ `xp.js` call each other at runtime (damage → death → XP award → floating number) but neither calls the other at top-level, so the cycle resolves. If adding a new cycle fails, either (a) move the shared helper to a leaf module (the `effects.js` module exists specifically to break a jobs/particles cycle), or (b) read from `state.js` instead of importing the function directly.

## Non-obvious conventions

- **Preserve comments.** They're the game's design documentation, often explaining rebalancing decisions ("was 22 — obliterated the heart in seconds"). Don't strip them.
- **Three.js disposal.** When removing a mesh from the scene, dispose its geometry and material if they aren't shared. The animation loop's particle cleanup in `main.js` is the canonical pattern. Shared materials (in `materials.js`) must NOT be disposed.
- **Deterministic variant rolls.** Room decor variants are chosen by hashing `(x, z)` so the same tile always rolls the same variant across rebuilds. Don't use `Math.random()` for decor selection.
- **Module scripts are deferred.** `<script type="module">` runs after DOM parsing, so top-level DOM queries in modules are safe. `bootstrap()` still guards with `DOMContentLoaded` defensively.

## Known pre-existing bugs (from the refactor)

Left untouched during the HTML-to-modules split. Flag before "fixing":

1. `showWaveWarning` — banner CSS timeout is `(WAVE_WARN_LEAD + 1) * 1000` ms but `warnUntil` uses `+ 1.5`, so the banner hides 500ms early.
2. `setTile` gold-mesh disposal leaks per-instance `fleckGeo`/`fleckMat` children — only the root geometry is disposed.
3. `dropHeld` has `entity.position.y = ud.isImp ? 0 : 0;` (no-op both branches).
4. `updateCreature` checks `ud.state !== 'moving_to_eat'` but that state is never set (dead guard).
