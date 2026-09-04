# Dungeon Heart — Babylon Edition

A build-free, Dungeon-Keeper-inspired 3D management game for the browser. The default client now runs on Babylon.js 9.25 and combines a redesigned dungeon, creatures, effects, defences, sorcery, and a responsive Keeper-style interface.

## Run locally

There is no package install or build step. ES modules must be served over HTTP:

```sh
python3 -m http.server 8765
```

Open <http://localhost:8765/index.html>. The page downloads the pinned Babylon.js runtime and GLB loader from jsDelivr, so the first load needs network access.

The client supports mouse and keyboard as well as touch gestures. Use **New Dungeon** for the normal start or **Testing Grounds** to spawn extra creatures and heroes immediately.

## Babylon overhaul

The live `index.html` loads the new modules in `src/babylon/`. The rewrite is designed as a clean rendering and gameplay foundation rather than an in-place reskin of the former Three.js prototype.

- **Dungeon tiles and rooms:** a 64×64 seeded grid with rock, earth, claimed and reinforced ground, gold, water, lava, portals, fog of war, the Dungeon Heart, and nine visually distinct room types. Modular props and edge details make treasuries, lairs, hatcheries, training rooms, libraries, prisons, torture chambers, workshops, and temples readable at a glance.
- **Creatures and heroes:** designed procedural models for imps, trolls, warlocks, bile demons, flies, knights, archers, and priests, with silhouettes, equipment, animation, movement, work, and combat behaviour. An asset library can replace any procedural character with an authored GLB while retaining the zero-asset fallback.
- **Lighting and effects:** PBR materials, subterranean fog, cascaded soft shadows, glow, bloom, FXAA, colour grading, screen shake, portal energy, lightning, spell pulses, embers, and pooled impact/dig/claim particles.
- **Keeper interface:** a responsive command palette, resource and Heart status bars, invasion timer, threats and creature rosters, minimap, selection context, event feed, start/pause/game-over screens, shortcuts, and live FPS/quality controls.
- **Audio:** procedural Web Audio cues remain asset-free and are unlocked safely by the first player interaction.

## Performance design

The visual upgrade is paired with rendering controls intended to keep large dungeons smooth:

- Tiles, room floors, trims, and repeated props are batched with Babylon thin instances instead of creating thousands of independent scene nodes.
- Particle bursts, lightning, pulses, dynamic lights, and portal effects come from bounded reusable pools.
- GLB files are cached as `AssetContainer`s and instantiated only when requested.
- Creature navigation uses a spatial index, cached paths and flow fields, and a bounded per-frame work queue to avoid large pathfinding spikes.
- Automatic hardware-aware quality selection chooses low, medium, or high on first load; low, medium, high, and ultra can also be selected from the HUD.
- Quality profiles scale resolution, shadow-map size and cascades, antialiasing, bloom, glow, sharpening, and particle density together.
- Performance instrumentation exposes FPS, frame time, draw calls, active meshes, and related scene counters to the UI/runtime.

## DK2-inspired defences and magic

Doors, traps, and spells are independent gameplay systems rather than one-off click effects. They follow the original Dungeon Keeper II rhythm: Workshop blueprints become crates that Imps deliver, libraries unlock Keeper magic, placement matters, and strong powers are constrained by resources, research, cooldowns, charges, or rearming.

**Doors** include Ironwood, Braced, Steel, and Magic tiers. A door has orientation, ownership, hit points, open/closed state, and enemy-blocking behaviour; stronger tiers trade more workshop work for durability or arcane resistance.

**Traps** include Spike, Sentry, Lightning, Fear, Gas, Boulder, and Alarm variants. Each has its own trigger radius, targets, damage or status effect, charges, cooldown, and reload rules. Traps are placed on claimed territory and react to hostile units during simulation updates instead of applying damage at placement time.

**Keeper magic** includes Create Imp, Possession, Heal, Lightning, Call to Arms, Haste, Sight, Protect, Conceal, Chicken, Tremor, Inferno, and Turncoat-style powers. Spells use mana, research unlocks, individual cooldowns, explicit tile/entity targeting, and timed buffs or debuffs. Library ownership contributes research progress, while UI feedback reports locked powers, insufficient mana, invalid targets, and remaining cooldowns.

Possession switches into a first-person pointer-lock camera with creature movement and reusable abilities. Manual saves and a 30-second autosave preserve the dungeon and its active gameplay systems; **Continue Last Dungeon** resumes the autosave.

## Play and controls

Expand around the Dungeon Heart, claim territory, build specialist rooms, grow a creature force, prepare chokepoints with workshop defences, research magic, and repel escalating hero invasions.

| Input | Action |
| --- | --- |
| Left click/tap or drag | Select a target or paint the active dig, claim, reinforce, or room order |
| Right-drag / middle-drag | Pan the camera |
| Wheel or `Z` / `X` | Zoom |
| `WASD` or arrow keys | Pan |
| `Q` / `E` | Rotate |
| Space or `C` | Recenter on the Dungeon Heart |
| `[` / `]` | Cycle command modes |
| `Esc` | Cancel targeting or pause |
| Two-finger drag / pinch | Pan and zoom on touch screens |

Number keys select the primary order, room, and spell shortcuts shown in the command palette. Doors, traps, rooms, and advanced spells can also be selected directly from their palette tabs.

## Project structure

```text
index.html                  Babylon client shell (the default game)
styles-babylon.css          scoped responsive Babylon HUD and menus
src/babylon/
  main.js                   application state, economy, waves, and frame orchestration
  core.js                   engine, scene, camera, lighting, shadows, post-processing
  quality.js                automatic and manual rendering-quality profiles
  assets.js                 cached GLB loading and PBR material helpers
  environment.js            dungeon palette, fog, ambient environment
  world.js                  grid, tiles, rooms, thin-instance batches, minimap
  entities.js               procedural/GLB creatures, heroes, AI, work, and combat
  navigation.js             spatial queries, cached paths/flow fields, work budgets
  defenses.js               doors, traps, placement, triggers, damage, and rearming
  workshop.js               blueprints, crates, Imp delivery, repairs, and reloads
  magic.js                  research, spell costs, cooldowns, targeting, and status effects
  possession.js             first-person camera, movement, abilities, and handoff
  persistence.js            versioned saves, validation, migration, and autosave
  visuals.js                trims, decals, props, ambience, and selection feedback
  effects.js                pooled particles, lightning, portals, glow, and screen shake
  audio.js                  procedural Web Audio director
  input.js                  command painting, targeting, selection, camera, touch
  ui.js                     Keeper HUD, palette, minimap, rosters, and menus

styles.css                  preserved stylesheet for the legacy modular client
src/*.js                    preserved Three.js r128 modular prototype
dungeon_keeper_poc.html     frozen original single-file prototype — never edit
CLAUDE.md / AGENTS.md       architecture and contributor guidance
```

The old Three.js modules are intentionally preserved for reference and comparison, but they are no longer loaded by the default `index.html`. `dungeon_keeper_poc.html` is a frozen backup and must not be modified.

## Validation

There is no npm toolchain. Check every JavaScript module and run the dependency-free systems smoke suite with:

```sh
for f in src/*.js src/babylon/*.js tests/*.mjs; do node --check "$f"; done
node tests/babylon-systems-smoke.mjs
```

Then serve the repository and verify the start screen, command painting, camera controls, creature/hero behaviour, defence placement and triggering, spell targeting and cooldowns, quality switching, pause/resume, responsive HUD, and touch input in a browser.
