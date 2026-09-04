# Babylon Migration — Plan and Progress

Checkpoint date: 2026-09-04

Latest completed milestone: `1e7eba8` — Babylon systems and presentation expansion

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

## Delivery status

| Workstream | Status | Next gate |
| --- | --- | --- |
| Babylon runtime and world | Complete | Real-browser compatibility pass |
| Creatures, rooms and procedural visuals | Foundation complete | Authored GLB/PBR replacement assets |
| Doors, traps and magic | Feature complete | DK2-oriented playtest and tuning |
| Workshop logistics | Feature complete | Interaction and pacing playtest |
| Navigation and simulation scaling | Foundation complete | Measured large-battle profiling |
| Possession | Feature complete | Pointer-lock, ability and mobile QA |
| Persistence | Feature complete | Browser regression coverage |
| Responsive Keeper UI | Foundation complete | Desktop/mobile visual QA and polish |

## Prioritised next plan

### Phase 1 — Browser quality gate

1. Run the current `main` checkpoint in Chromium, Firefox, and a mobile browser.
2. Capture desktop and mobile screenshots and verify boot, WebGPU fallback, picking, camera control, minimap, menus, touch input, pointer lock, save/load, Workshop delivery, spells, traps, and doors.
3. Fix all release-blocking browser errors and interaction defects before expanding content.

Exit criterion: a complete 20-minute dungeon session can be played, saved, resumed, and completed on desktop, with the core build/command flow usable on mobile.

### Phase 2 — Authored visual production

1. Select a licence-compatible GLB/PBR asset direction and record attribution and redistribution terms.
2. Replace procedural fallbacks in visible-impact order: Imp, heroes, core creatures, Dungeon Heart and portals, doors and traps, room kits, then environmental props.
3. Add consistent animation clips, material conventions, LOD policy, iconography, hit effects, build previews, and defence-state feedback.

Exit criterion: all frequently encountered creatures, rooms and defences use a coherent authored art direction while procedural models remain safe loading fallbacks.

### Phase 3 — Performance and scale

1. Profile CPU time, GPU time, active meshes, draw calls, memory and path latency across expanding rooms and progressively larger invasion waves.
2. Replace full-grid visual rebuilds with chunked dirty buffers.
3. Tune thin-instance density, effects pools, shadows, navigation budgets and quality presets against measured frame-time targets.

Exit criterion: stable frame pacing at the agreed reference dungeon and battle sizes on representative desktop and mobile hardware.

### Phase 4 — DK2 gameplay and release hardening

1. Playtest and tune costs, mana regeneration, research, manufacturing, crate delivery, repairs, reloads, door durability, trap charges, control durations, Heart durability and invasion pacing.
2. Add browser automation for boot, building, save/load, Workshop logistics, Possession, spells, pause, quality switching and loss conditions.
3. Resolve remaining accessibility, onboarding, feedback and save-migration issues; then prepare a tagged playable release.

Exit criterion: the core loop is understandable, balanced enough for repeated play, regression-tested, and release-documented.

## Checkpoint validation commands

```sh
for f in src/*.js src/babylon/*.js tests/*.mjs; do node --check "$f"; done
node tests/babylon-systems-smoke.mjs
git diff --check
python3 -m http.server 8765
```
