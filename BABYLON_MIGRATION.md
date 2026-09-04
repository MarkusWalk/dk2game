# Babylon Migration — Plan and Progress

Checkpoint date: 2026-09-04

## Goal

Rebuild Dungeon Heart on Babylon.js with a stronger visual identity, scalable rendering, designed creatures and rooms, a modern Keeper-style interface, and working doors, traps, and magic inspired by Dungeon Keeper II.

The former Three.js modules remain in `src/*.js` for reference. The default `index.html` now loads the Babylon client in `src/babylon/`. The frozen `dungeon_keeper_poc.html` has not been changed.

## Progress at this checkpoint

### Complete

- Replaced the default client shell with a pinned Babylon.js 9.25 runtime and GLB loader.
- Added guarded WebGPU startup with automatic WebGL fallback.
- Added a Babylon runtime with a quality system, ACES image processing, cascaded shadows, fog, bloom, glow, FXAA/MSAA selection, hardware scaling, and performance instrumentation.
- Rebuilt the dungeon as a seeded 64×64 Babylon world with thin-instanced tiles, deterministic visual variation, fog of war, water, lava, gold, portals, a Dungeon Heart, a minimap, and nine room styles.
- Added detailed procedural fallback models for Imps, Trolls, Warlocks, Bile Demons, Flies, Knights, Archers, and Priests, including animation, movement, work, combat, selection, and GLB override support.
- Added pooled particles, lightning, impacts, spell effects, portal effects, ambient embers, dynamic-light reuse, screen shake, and procedural Web Audio.
- Rebuilt the UI as a responsive Keeper-style HUD with command tabs, resources, Heart health, invasion status, minimap, rosters, contextual actions, menus, touch support, and rendering-quality controls.
- Added one authoritative economy for gold, mana, manufacturing work, and research.
- Reworked doors with Ironwood, Braced, Steel, and Magic tiers; corridor orientation; hit points; locking; automatic passage; repair; selling; destruction; and mana-backed Magic Door retaliation.
- Reworked traps with Spike, Sentry, Lightning, Fear, Gas, Boulder, and Alarm variants; claimed-tile placement; arming; charges; cooldowns; reload work; target rules; damage; and timed statuses.
- Reworked Keeper magic with Create Imp, Possession, Heal, Lightning, Call to Arms, Speed Monster, Sight of Evil, Protect, Conceal, Chicken, Tremor, Create Gold, Inferno, and Turncoat.
- Added mana validation, escalating Create Imp cost, per-spell cooldowns, target ownership checks, prerequisite research, Library-driven unlock progress, spell refunds on failed execution, and stack-safe timed effects.
- Connected heroes to Dungeon Heart damage and a real game-over state.
- Connected defense selection to lock, unlock, repair, arm, disarm, reload, and sell actions in the HUD.
- Fixed the full-screen Babylon canvas, duplicate input/effect updates, cumulative camera shake, hidden-tile excavation, repeated shared-particle texture disposal, and repeated Heart/Portal recreation.
- Added optional authored asset loading through `window.DUNGEON_ASSET_MANIFEST`; failed or missing assets fall back to the procedural art without breaking the game.
- Added a bounded navigation service with spatial indexing, cached paths and flow fields, request prioritisation, and per-frame work budgets so creature AI scales without pathfinding spikes.
- Added DK2-style Workshop logistics: blueprints consume manufacturing work, completed items become physical crates, and idle Imps deliver, repair, and reload defences.
- Added first-person Possession with pointer-lock mouse look, movement, creature abilities, cooldown feedback, and reliable return to the Keeper camera.
- Added versioned manual saves, autosaves, migration and validation, import/export support, and restoration of the dungeon, economy, creatures, defences, Workshop, research, magic, and possession state.
- Added a deterministic visual-polish layer for room trims, floor decals, props, defence presentation, ambient motes, and selection/hover indicators, with density tied to rendering quality.
- Hardened optional asset loading with manifest normalisation and timeouts, fixed authoritative command-mode and fear/chicken state, made defence actions usable on mobile, and removed the viewport zoom lock.

### Verification completed

- Every legacy and Babylon JavaScript module passes `node --check`.
- `git diff --check` passes.
- The project serves correctly over a local HTTP server; `index.html`, the Babylon entry module, defense module, magic module, and stylesheet all return HTTP 200.
- Headless logic smoke tests pass for spell costs, cooldowns, target validation, healing, lightning damage, Create Imp, door/trap manufacturing costs, duplicate-placement rejection, trap triggering, charges, and damage.
- Dependency-free system smoke tests pass for navigation budgets and caches, Workshop manufacture/delivery/service jobs and refunds, plus save validation, migration, and round trips.
- A static Babylon 9.25 API audit found no incompatible public API calls in the current engine, camera, shadow, post-processing, thin-instance, asset-container, particle, or scene-loader usage.

### Current limitations

- This environment has no browser executable, so the checkpoint has not received final visual, interaction, responsive-layout, or GPU profiling QA in a real browser.
- The included creature and environment art is the designed procedural fallback set. The GLB pipeline is ready, but a licensed authored model/texture pack is not bundled yet.
- Dirty world updates still scan the CPU-side grid to preserve deterministic batch order, although unchanged GPU thin-instance buffers and landmarks are retained.
- Navigation now bounds path work and nearby enemy queries, but large-battle CPU/GPU limits still need measurement in a real browser.
- Workshop logistics and first-person Possession are implemented but need interaction and balance playtesting with pointer lock and touch devices.
- Saves currently use browser local storage; cloud/profile synchronisation is outside this checkpoint.
- Balance values are an initial playable adaptation and need browser playtesting.

## DK2 design basis

The defense and spell roles are based primarily on Prima's *Official Strategy Guide to Dungeon Keeper 2*, prepared in consultation with Bullfrog, especially its Keeper spell, workshop, trap, door, research, and mana tables. The implementation preserves roles and trade-offs while shortening long hard-control durations and making costs, cooldowns, targeting, and counters more legible.

References:

- [Prima's Official Strategy Guide to Dungeon Keeper 2](https://archive.org/download/Tekken3PrimasOfficialStrategyGuide1998/DungeonKeeper2primasOfficialStrategyGuide-2004.pdf)
- [DK2 Resource Guide — Keeper Spells](https://dungeonkeeper2.gamecoyote.com/keeperspells.php)
- [DK2 Resource Guide — Workshop](https://dungeonkeeper2.gamecoyote.com/workshop.php)

## Next plan

1. Run the pushed checkpoint in desktop and mobile browsers; capture screenshots and fix boot, picking, camera, HUD, minimap, effects, and responsive-layout defects.
2. Profile CPU/GPU behavior with expanding rooms and progressively larger invasion waves.
3. Select a license-compatible GLB/PBR art pack, define the asset manifest, and replace procedural creature, door, trap, prop, and room fallbacks in prioritised batches.
4. Replace full-grid visual rebuilds with chunked dirty buffers and profile the resulting update path.
5. Playtest and tune navigation budgets, costs, mana regeneration, manufacturing and delivery speed, research, invasion pacing, control durations, and Heart durability.
6. Add browser automation for boot, save/load, Workshop delivery, possession, placement, spell casting, pause, quality switching, and loss-condition regression coverage.

## Checkpoint validation commands

```sh
for f in src/*.js src/babylon/*.js tests/*.mjs; do node --check "$f"; done
node tests/babylon-systems-smoke.mjs
git diff --check
python3 -m http.server 8765
```
