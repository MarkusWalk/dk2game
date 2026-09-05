# Babylon Migration — Plan and Progress

Checkpoint date: 2026-09-05

Latest completed milestone: `461f1fa` — first real-browser pass: boot repair, restored
imp work queue, and a win condition

## Goal

Rebuild Dungeon Heart on Babylon.js with a stronger visual identity, scalable rendering, designed creatures and rooms, a modern Keeper-style interface, and working doors, traps, and magic inspired by Dungeon Keeper II.

The former Three.js modules remain in `src/*.js` for reference. The default `index.html` now loads the Babylon client in `src/babylon/`. The frozen `dungeon_keeper_poc.html` has not been changed.

## Progress at this checkpoint

### Since the `1e7eba8` checkpoint

The previous checkpoint had never been run in a browser. Running it revealed that
**the game did not load at all**, along with several systems that were reported
complete but were unreachable or missing. Nine commits address that.

Boot and interaction:

- Corrected the pinned Babylon CDN path. `index.html` requested
  `babylonjs@9.25.0/babylon.min.js`, a file the npm package does not contain — it
  ships `babylon.js`. jsDelivr returned 404, `window.BABYLON` was never defined,
  and every boot ended on the "could not awaken" banner.
- Stopped the pause overlay stacking on the start screen. The game boots
  paused-and-not-started, so the first UI snapshot raised the pause menu on top of
  the start menu, burying "Awaken the Heart" behind a menu whose only working
  button reloaded the page.
- The simulation now advances on a fixed 1/60 step, bounded to five steps per
  frame. A clamped variable step meant that below ~20fps every wave timer, mana
  tick and creature ran at the frame rate rather than the wall clock — the dungeon
  went into slow motion instead of dropping frames.
- Escape works on the first press. The toolbar boots in `dig` mode, so the first
  press was spent resetting the tool rather than pausing.

Gameplay that was missing or unreachable:

- **Restored the imp work queue** (`src/babylon/jobs.js`). Excavation had been
  instant, free and imp-free: clicking called `world.dig` directly while
  `entities.assignWork` and `_updateWork` sat fully written and never called from
  anywhere. Clicking now marks a tile, imps self-assign the nearest job by
  priority, walk there and work it, and mined gold is paid on completion. Marked
  tiles carry a batched marker overlay distinguishing order type and whether an
  imp has claimed the job.
- **Added the win condition.** `_endGame(true)` existed and was never called; waves
  escalated forever and `ui.js` carried victory copy no player could reach. A
  seeded hero stronghold now sits far from the Heart, undiscovered at start; waves
  march out of its gate, and razing it wins the game and ends the invasion.
- Exposed Reinforce, Prison, Torture and Temple, which were implemented in
  `input.js` and `world.js` but had no palette entry.
- Room designation charges per tile, so a three-tile Library cost 450 of the 625
  starting gold while its button read "150 gold". Repriced to the per-tile scale
  and labelled `N gold/tile`, with one cost table instead of three.

Correctness:

- Attacks require line of sight. Engagement was decided on distance alone, so
  archers and warlocks shot through solid rock and melee hit across wall corners.
- Doors block rather than teleport. `_haltAtDoor` assigned an absolute coordinate
  every frame and cleared destination and state every frame, so a hero at a locked
  door re-issued a path request every think tick forever and a friendly creature
  beside one froze permanently.
- `defenses.lastError` is cleared on each operation; a successful placement used to
  report the previous failure's message to the player.

Performance:

- `rebuildVisuals()` composes transforms into persistent scratch buffers instead of
  allocating a Vector3 pair, Quaternion and Matrix per tile and prop. Measured over
  200 iterations at 6963 thin instances: **3.72ms → 1.33ms** per rebuild. Its
  trailing `stats()` call — a second full-grid scan per rebuild, whose payload no
  subscriber reads — is now lazy.
- Navigation coalesces cache invalidation. `cellChanged` fires once per cell, so
  painting a 20-tile room cleared both caches 20 times; it now bumps a revision
  each time (which makes stale entries unreachable immediately) and clears at most
  once per update. Measured on a 20-tile paint: **20 bumps, 1 clear**.
- Path searches reuse scratch arrays rather than allocating three `size*size`
  Int32Arrays per request; spatial bucket keys are integers rather than template
  strings; `nearest()` no longer sorts every record.
- The roster list's change-detection signature compared unquantised floats and so
  never matched, rebuilding both HUD lists every tick; context action buttons were
  rebuilt every tick, which swallowed clicks by replacing the node between
  mousedown and mouseup.

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

Static and headless checks:

- Every legacy and Babylon JavaScript module passes `node --check`.
- `git diff --check` passes.
- Headless logic smoke tests pass for spell costs, cooldowns, target validation, healing, lightning damage, Create Imp, door/trap manufacturing costs, duplicate-placement rejection, trap triggering, charges, and damage.
- Dependency-free system smoke tests pass for navigation budgets and caches, Workshop manufacture/delivery/service jobs and refunds, plus save validation, migration, and round trips.
- A static Babylon 9.25 API audit found no incompatible public API calls in the current engine, camera, shadow, post-processing, thin-instance, asset-container, particle, or scene-loader usage.

In a real browser (Chromium via Playwright, WebGL2 through SwiftShader),
`tests/browser-smoke.mjs` drives the built page and asserts: the page boots with no page errors; only the
start screen is visible on load and its button starts a game; Escape pauses and
resumes; the fixed-step loop advances at its step budget; the palette exposes every
implemented mode; the advertised room price equals the charged one; **tile picking
maps a picked thin instance back to the cell under the hit point, 21/21 across a
screen sweep**; a save/load round trip preserves the entity roster; and spells, trap
placement and possession enter/exit all still work. Beyond the suite, the imp work
loop, the stronghold victory path and the order markers were each exercised
end-to-end by stepping the simulation deterministically.

A note on the previous checkpoint's verification, because the gap matters. It
reported that "the project serves correctly over a local HTTP server; `index.html`,
the Babylon entry module, defense module, magic module, and stylesheet all return
HTTP 200". That was true and still missed a total boot failure: the check only
requested local files, never the CDN `<script>` tags, one of which 404'd. Serving a
page is not loading it. Checks that do not actually run the product can report green
on a product that does not start.

### Current limitations

- **No human has played this.** Every browser check drives the simulation
  programmatically under a software rasteriser at roughly 1fps. Nothing here
  substitutes for someone holding the mouse.
- **Balance is unplayed and therefore unknown.** Stronghold hit points (2400), the
  wave curve, and the repriced rooms against a map with one gold-vein economy are
  all first guesses.
- **The objective has no HUD presence.** The stronghold's existence and health are
  invisible until the player happens to find it, so a new player is given no goal.
- Hardware GPU profiling, responsive-layout QA and touch-device testing have still
  not happened; SwiftShader says nothing about real frame rates.
- The included creature and environment art is the designed procedural fallback set. The GLB pipeline is ready, but a licensed authored model/texture pack is not bundled yet.
- Dirty world updates still scan the CPU-side grid to preserve deterministic batch order. The per-instance allocation is gone and the scan is roughly 2.8x faster, but a fog-of-war reveal still walks all 4096 cells rather than a dirty region.
- Navigation bounds path work and coalesces invalidation, but large-battle CPU/GPU limits still need measurement on real hardware.
- Workshop logistics and first-person Possession are implemented but need interaction and balance playtesting with pointer lock and touch devices.
- The job queue is not persisted: a loaded game starts with an empty queue and imps drop stale claims on the first tick. Marked-but-undug tiles are forgotten across a save.
- Saves currently use browser local storage; cloud/profile synchronisation is outside this checkpoint.

## DK2 design basis

The defense and spell roles are based primarily on Prima's *Official Strategy Guide to Dungeon Keeper 2*, prepared in consultation with Bullfrog, especially its Keeper spell, workshop, trap, door, research, and mana tables. The implementation preserves roles and trade-offs while shortening long hard-control durations and making costs, cooldowns, targeting, and counters more legible.

References:

- [Prima's Official Strategy Guide to Dungeon Keeper 2](https://archive.org/download/Tekken3PrimasOfficialStrategyGuide1998/DungeonKeeper2primasOfficialStrategyGuide-2004.pdf)
- [DK2 Resource Guide — Keeper Spells](https://dungeonkeeper2.gamecoyote.com/keeperspells.php)
- [DK2 Resource Guide — Workshop](https://dungeonkeeper2.gamecoyote.com/workshop.php)

## Delivery status

| Workstream | Status | Next gate |
| --- | --- | --- |
| Babylon runtime and world | Boots and renders in Chromium | Hardware GPU pass; Firefox and mobile |
| Core loop (dig / claim / build) | Imp work queue restored | Human playtest of pacing |
| Win and loss conditions | Both reachable | Stronghold HUD; balance of 2400 HP |
| Creatures, rooms and procedural visuals | Foundation complete | Authored GLB/PBR replacement assets |
| Doors, traps and magic | Feature complete | DK2-oriented playtest and tuning |
| Workshop logistics | Feature complete | Interaction and pacing playtest |
| Navigation and simulation scaling | Bounded and coalesced | Measured large-battle profiling |
| Possession | Feature complete | Pointer-lock, ability and mobile QA |
| Persistence | Feature complete; job queue not saved | Persist the work queue |
| Responsive Keeper UI | Desktop layout verified in Chromium | Mobile and responsive QA |

## Prioritised next plan

### Phase 1 — Browser quality gate (partly satisfied)

Chromium is done: boot, WebGPU→WebGL2 fallback, picking, menus, save/load, spells,
traps, possession and the core loop are all verified there, and the
release-blocking defects that pass found are fixed. What remains:

1. **Have a person play it.** This is the outstanding item and nothing automated
   replaces it. A 20-minute session: dig out, build rooms, research, survive waves,
   find and raze the stronghold.
2. Give the stronghold a HUD presence so the objective is discoverable.
3. Run Firefox and a mobile browser; verify touch input, pointer lock and the
   responsive layout.
4. Profile on real GPU hardware rather than SwiftShader.

Exit criterion (unchanged): a complete 20-minute dungeon session can be played,
saved, resumed, and completed on desktop, with the core build/command flow usable
on mobile.

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

python3 -m http.server 8765 &
node tests/browser-smoke.mjs        # needs Playwright; see the file header
```

Static checks alone will not catch a page that fails to load — that is how the
previous checkpoint shipped a boot failure. Open `http://localhost:8765/index.html`
in a browser and confirm the dungeon renders and the start menu responds before
calling a change verified. Driving the page with Playwright is worth the setup for
anything touching boot, picking, or the simulation loop; `window.__DUNGEON_HEART__`
exposes the running app (`.world`, `.entities`, `.jobs`, `.navigation`, `.state`)
for assertions, and stepping `entities.update(1/60)` / `jobs.update(1/60)` directly
is more reliable than waiting on wall-clock time.
