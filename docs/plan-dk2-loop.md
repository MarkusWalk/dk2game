# Engineering plan: port the legacy simulation into the Babylon client

Companion to `REVIEW.md` (sections 4, 5, 6 and 9). This document is the build
order for turning `src/babylon/` from a rendering platform into a Dungeon
Keeper 2 game. It names real files, real functions and real numbers.

The decision from `REVIEW.md` §9 stands: keep the Babylon renderer, effects,
`navigation.js`, `persistence.js`, `defenses.js`, `magic.js`, `workshop.js` and
`possession.js`; port the *rules and numbers* out of `src/*.js` into a new,
renderer-independent simulation layer; delete the legacy client once parity is
reached. The legacy simulation is worth keeping as design, not as code — every
legacy tick is welded to `THREE.Group.userData` and to module-scope mutable
arrays in `src/state.js`.

---

## 1. Target architecture

### 1.1 The `src/babylon/sim/` layer

New directory: no Babylon import, no DOM, no `performance.now()`. Every module
takes plain data and a `dt` in seconds. `navigation.js` and `workshop.js`
already prove the shape works — `tests/babylon-systems-smoke.mjs` imports both
with `window.BABYLON = null`.

| Module | Owns |
| --- | --- |
| `sim/state.js` | The `SimState` factory: grid reference, unit map, jobs, rooms, portals, economy, level record, RNG. One object passed explicitly — no module-scope mutable arrays. |
| `sim/rng.js` | Seeded xorshift (same algorithm as `world.js:960 _random`). Every simulation decision uses it; `Math.random()` is banned in `sim/`. |
| `sim/jobs.js` | Job queue, priority picking, border cascade, job validity, completion effects. Port of `src/jobs.js`. |
| `sim/rooms.js` | Connected-component room graph, effects table, designate/undesignate, treasury capacity, chicken pools, lair beds. The *gameplay* half of `src/rooms.js`. |
| `sim/needs.js` | Hunger, sleep, eating, anger, happiness, affinity, brawls, leaving. Port of `creatures.js:1378-1546`. |
| `sim/ai.js` | Utility goal scoring + commit pause + distress. Port of `_reevaluateGoal` / `_resolveGoalTarget` / `_distressScore`. |
| `sim/attraction.js` | Portal claim state, per-species gates and weights, arrival cadence. Port of `_pickSpawnSpecies` / `tickPortals`. |
| `sim/economy.js` | Gold in treasuries, mana regeneration, work/manufacturing pool, research, payday and wages. |
| `sim/levels.js` | XP curve, level-up stat scaling, perks, caps. Port of `src/xp.js`. |
| `sim/heart.js` | The Heart as a real combatant record plus win/lose evaluation against the level record. |
| `sim/hand.js` | Pickup / drop / slap rules (validity, state transitions, buff timers). Port of `src/hand.js` + `src/slap.js` minus meshes. |
| `sim/data.js` | Single source of truth for species, rooms, spells, doors, traps and job durations. Replaces the three duplicated room-cost tables (`world.js:38`, `input.js:22`, `ui.js:14`). |
| `sim/level-defs.js` | Authored level definitions: map seed or template, starting resources, hero gates, party tables, objective. |
| `sim/index.js` | `createSim(world, options)` and `stepSim(sim, dt)` — the only entry points `main.js` needs. |

### 1.2 Data shapes

These are the contracts. Everything below is plain JSON-serialisable data so
`persistence.js` can adopt it with a new section adapter and no special cases.

```js
// sim unit — the authority for every imp, creature, hero and the Heart
{
  id: 'imp-7', kind: 'imp' | 'creature' | 'hero' | 'heart',
  species: 'imp' | 'fly' | 'warlock' | 'knight' | ...,
  faction: 'dungeon' | 'heroes' | 'prisoner' | 'neutral',
  x: 12.5, z: 30.0, facing: 1.57,      // continuous position, sim owns it
  gx: 13, gz: 30,                       // rounded cell, refreshed each move
  hp: 38, maxHp: 38, atk: 3, atkRange: 0.72, atkCooldown: 0, atkInterval: 0.9,
  speed: 2.15, level: 1, xp: 0, perks: [],
  state: 'idle' | 'moving' | 'working' | 'fighting' | 'fleeing' | 'eating'
       | 'sleeping' | 'held' | 'leaving' | 'imprisoned' | 'dead',
  goal: { kind: 'eat', x: 20, z: 18 } | null,
  commitUntil: 0, decisionAt: 0,        // sim-time seconds, never wall clock
  path: [{x,z}, ...], pathIndex: 0,
  job: 'job-14' | null, carrying: 0,    // gold in transit
  needs: { hunger: 0, sleep: 0 },
  anger: 0, happiness: 1, paySince: 0, angryFor: 0, distressAt: 0,
  lair: {x,z} | null, buffs: { slapUntil: 0, hasteUntil: 0 },
  viewId: 'imp-7',                      // key into EntityDirector
}

// job record
{ id: 'job-14', type: 'dig'|'claim'|'claim_wall'|'reinforce'|'wall'|'carry'|'deliver',
  x: 20, z: 14, claimedBy: 'imp-7' | null, progress: 0, duration: 1.8 }

// room component record
{ id: 'room-3', type: 'treasury', cells: ['20,14', ...], size: 6,
  centroid: {x, z}, large: false,       // size >= TRAINING_LARGE_SIZE
  gold: 900, capacity: 1800,            // treasury only
  chickens: { '20,14': { count: 2, regrowAt: 41.2 } },   // hatchery only
  beds: { '21,15': 'fly-3' } }          // lair only, cell -> unit id

// level definition
{ id: 'level-1', name: 'The First Hoard', seed: 1337, gridSize: 64,
  start: { gold: 625, mana: 220, manaMax: 350, imps: 4, heartHp: 4000 },
  heart: { x: 32, z: 32 },
  portals: [{ x: 42, z: 32, footprint: 4 }],
  heroGates: [{ id: 'ne', x: 50, z: 14, firstAt: 240, interval: 150,
                parties: [ ['knight'], ['knight','archer'], ... ] }],
  objective: { type: 'survive-and-kill-boss', bossGate: 'boss' },
  unlockedSpells: ['createImp', 'possess', 'sight', 'heal'] }
```

### 1.3 EntityDirector becomes a view layer

**Decision: the sim owns unit records; `EntityDirector` becomes a pure view.**
Not the reverse (sim state attached to entity records).

Justification. Attaching sim fields to entity records is cheaper for one PR and
worse for every PR after it: the entity record holds `B.TransformNode`
references (`root`, `visual`, `parts`, `meshes`, `animationGroups`), so a
headless test of hunger or job assignment would need a Babylon stub like the one
at `tests/babylon-systems-smoke.mjs:32-58`, and `Math.random()` in `spawn()`
(`entities.js:128`) keeps leaking into gameplay against the determinism the save
system assumes (`REVIEW.md` §5.3). Sim-owns-truth gives headless tests, a save
format that is the sim state verbatim, and a swappable renderer.

Mechanics of the split. `EntityDirector` keeps its builders
(`_buildImp` … `_buildPriest`), materials, `_animate` and the asset override
path; it loses `_think`, `_updateMotion`, `_updateWork`, `_updateCombat`,
`_kill`, `_findPath`, `_heroSpawnPosition`, `setRally`, `assignWork` and
`takeDamage`. A new `EntityDirector.syncFromSim(sim, dt)` ensures a view exists
per sim unit (spawning by `species` → builder), copies `x/z/facing` into
`root.position` / `root.rotation.y`, maps `unit.state` onto an animation state,
and disposes views whose unit is gone. For the transition, `entity.unit = unit`
and `unit.viewId` are back-pointers, and the view record exposes `hp`, `speed`,
`damage` and `faction` as accessors that read and write through to
`entity.unit`, so `magic.js`, `defenses.js`, `workshop.js` and `possession.js`
keep working unchanged until they are ported in Phase 2. That is the one place
duck typing is allowed to survive, deliberately and documented.

### 1.4 Tick order in `main.frame()`

`main.js:461-497` becomes:

```js
frame() {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  const active = this.state.started && !this.state.paused && !this.state.gameOver;
  if (active) {
    this.sim.time += dt;
    stepSim(this.sim, dt);            // 1-9 below, all renderer-free
    this.defenses.update(dt, this.sim.time);
    this.workshop.update(dt, this.sim.time);
    this.magic.update(dt, this.sim.time);
  }
  this.entities.syncFromSim(this.sim, active ? dt : 0);
  this.world.update(...); this.effects.update(...); this.visuals.update(...);
  this.audio.update(dt, this.runtime.camera);
  if (uiDue) this.ui.update(this.snapshot());
  this.runtime.scene.render();
}
```

`stepSim` runs a fixed order, mirroring `src/main.js` but with the economy and
room passes moved ahead of the actors that read them:

1. `rooms.flushDirty(sim)` — rebuild connected components for cells changed last
   tick (batched exactly like `flushDirtyRooms`, `rooms.js:1560`).
2. `economy.tick(sim, dt)` — mana from claimed tiles, work pool, research,
   payday timer.
3. `jobs.tick(sim)` — validate, expire, re-queue border jobs for dirty cells.
4. `imps.tick(sim, dt)` — flee gate, job claim, move, work, carry, deposit.
5. `attraction.tick(sim, dt)` — portal arrivals.
6. `creatures.tick(sim, dt)` — combat first, then `ai.scoreGoals` on the
   species `decisionInterval`, then motion, then room use.
7. `needs.tick(sim, dt)` — hunger/sleep/anger/happiness/brawls/leaving.
8. `heroes.tick(sim, dt)` — gate spawning, party marching, garrison release.
9. `heart.tick(sim, dt)` — Heart damage resolution, then win/lose evaluation.

Navigation stays where it is: `sim` calls `navigation.findPath` /
`requestPath`, which is already Babylon-free.

---

## 2. Function-level mapping

Legacy line numbers are from the current tree. "New" names are the target API.

| Legacy (file:line) | New | What changes |
| --- | --- | --- |
| `jobs.js:33 markForDig` | `sim/jobs.js markDig(sim, x, z)` | Returns a job record; the marker becomes a `world` visual driven off `sim.jobs`. Tile ids become the `TILE.*` strings of `world.js:14` throughout. |
| `jobs.js:51 hasClaimedNeighbor`, `:62 queueClaimJob`, `:69 queueBorderJobsAround` | `sim/jobs.js hasClaimedNeighbour`, `queueClaim`, `queueBorderJobs` | Unchanged rules; tile writes route through `world.setTile`. |
| `jobs.js:101 claimPortal` | `sim/attraction.js claimPortal` | Keeps the 4×4 footprint rule and the 4 s first-spawn delay; effects fire through `runtime.events`. |
| `jobs.js:168 claimJob` | `sim/jobs.js assignJobs(sim)` | **Inverted.** Legacy pathfinds every job for every idle imp each tick. The new version ranks by squared distance, pathfinds the best three candidates, and assigns in one pass. |
| `jobs.js:191 isJobStillValid` | `sim/jobs.js isJobValid` | Same table, string tile types. |
| `jobs.js:222 completeJob` | `sim/jobs.js completeJob` | Tile mutation, gold and XP stay; `spawnPulse`/`playSfx` become `sim.events` entries drained by `main.js`. |
| `imps.js:163 updateImp` | `sim/imps.js tickImp(sim, unit, dt)` | State machine preserved (`idle → fetching_gold → moving → working → seeking_treasury → hauling`); all limb animation deleted (it is `_animate`'s job). |
| `imps.js:491 tickImpRespawn` | `sim/imps.js tickRespawn` | Same rules, against `sim.economy.mana`. |
| `treasury.js:14 findNearestTreasury`, `:27 depositGold` | `sim/economy.js nearestTreasuryWithSpace`, `depositGold` | **New rule:** a tile caps at 300; full tiles are skipped and with none free the imp drops gold on the floor, not the "absorb into total" fallback (`imps.js:429`). |
| `creatures.js:1129 _reevaluateGoal` | `sim/ai.js scoreGoals(sim, unit)` | Same ten candidates, weights, `+0.08` stick bonus and `commitPause`. |
| `creatures.js:1205 _resolveGoalTarget` | `sim/ai.js resolveGoal` | Room lookups use the room component index (`sim.rooms`) instead of the O(64×64) scan in `findNearestRoomTile` (`creatures.js:768`). |
| `creatures.js:1284 _distressScore` | `sim/ai.js distressScore` | Uses `navigation.spatial.queryRadius` instead of scanning every creature. |
| `creatures.js:813 _creatureCombatTick`, `:927 _attackChoose`, `:949 _applyAttackKind` | `sim/combat.js tickCombat`, `chooseAttack`, `applyAttack` | Four branches kept (flee / kite / chase / strike) plus the level-3 `secondaryMove` table. `takeDamage` becomes the one resolver for every faction, Heart included. |
| `creatures.js:1319 tickBrawls` | `sim/needs.js tickBrawls` | Constants unchanged (0.5 anger, 0.08 pair chance, 1.6 range, 30 % HP floor, 1 s check) — moved into `sim/data.js`. |
| `creatures.js:1378 computeHappiness`, `:1394 _applyAffinity` | `sim/needs.js happiness`, `applyAffinity` | Verbatim; same 0.5 s affinity stagger and rates. |
| `creatures.js:1422 tickCreatureSocial` | `sim/needs.js tickSocial` | **Fixes a carried bug:** legacy runs two pay systems (90 s here, 180 s in `tickPayDay`). Keep payday only; `paySince` accrues and settles there. |
| `creatures.js:1548 tickPayDay`, `:1586 tryPayCreature` | `sim/economy.js tickPayDay`, `payUnit` | **New rule:** the creature must reach a treasury tile to be paid, matching the `pay` goal it already scores. No teleported wages. |
| `creatures.js:1467 _startAngryLeaving`, `:1495 _tickAngryLeaving` | `sim/needs.js startLeaving`, `tickLeaving` | Unchanged thresholds (`LEAVING_HAPPINESS` 0.20, `LEAVING_TIMEOUT` 18 s). |
| `creatures.js:678 _pickSpawnSpecies`, `:691 _hasAnyRoomOfType` | `sim/attraction.js pickSpecies`, `hasRoom` | `hasRoom` reads `sim.rooms`, not the grid. Gate extended from "room exists" to "room of at least N tiles". |
| `creatures.js:2026 tickPortals` | `sim/attraction.js tick` | Keeps `PORTAL_SPAWN_INTERVAL` 22 s and `PORTAL_MAX_SPAWN` 8, adds a claimed-tile-count gate so an unbuilt dungeon attracts nothing. |
| `creatures.js:1966 tickHatcheryRegrowth` | `sim/rooms.js tickHatchery` | Per-tile pool (cap 3, regrow 18 s) moves onto the room record's `chickens` map. |
| `rooms.js:1284 floodRoomTiles`, `:1519 buildRoomFrom`, `:1545 findRoomContaining`, `:1556 markRoomDirty`, `:1560 flushDirtyRooms` | `sim/rooms.js floodComponent`, `buildRoom`, `roomAt`, `markDirty`, `flushDirty` | Identical algorithm, zero mesh work; visuals stay with `world.rebuildVisuals()`. |
| `rooms.js:1671 designateTile`, `:1698 undesignateTile` | `sim/rooms.js designate`, `undesignate` | Keeps "only claimed floor is designatable" (`rooms.js:1673`), which fixes `REVIEW.md` defect #13 for free, and keeps the refusal to undesignate a treasury holding gold. |
| `rooms.js:1749 tickRoomBenefits` | `sim/rooms.js tickEffects` | Training XP, Warlock research, Troll manufacturing, all with the ≥ 9-tile ×2 bonus. Research feeds `magic.addResearch`. |
| `xp.js:29 xpToNext`, `:33 awardXp`, `:67 applyLevelUp`, `:53 _rollPerk` | `sim/levels.js` (same names) | Pure already. `_isImp` (`xp.js:47`) becomes `unit.kind === 'imp'`. |
| `heroes.js:605 placeHeroLairs`, `:571 _rotateTemplate` | `sim/level-defs.js buildCompounds` | Templates move into the level definition. |
| `heroes.js:744 tickHeroLairs` | `sim/heroes.js tickGarrisons` | Same rule: last compound wall falls → garrison flips to `engaging`. |
| `heroes.js:776 findHeroSpawnTile` | *deleted* | Replaced by authored hero gates — `REVIEW.md` defect #9, heroes spawning inside the player's own tunnels (`entities.js:1039`). |
| `heroes.js:815 updateHero` | `sim/heroes.js tickHero` | Explicit target priority: creature in sight → blocking door → room prop → Heart. Dwarf keeps treasury plunder (`heroes.js:1049`). |
| `heroes.js:1104 tickWaves` + `constants.js:540 WAVE_TABLES` | `sim/heroes.js tickGates` | Parties come from the level's per-gate table, not the endless 22-42 s timer at `main.js:517`. |
| `hand.js:60 pickUpEntity`, `:128 resolveDropTile`, `:142 dropHeld` | `sim/hand.js pickUp`, `resolveDrop`, `drop` | Rules only: cancel jobs, release beds, portal-drop dismisses, prison/torture re-anchor. Hand mesh and drop indicator stay in the view. |
| `slap.js:23 slapEntity`, `:49 hasSlapBuff` | `sim/hand.js slap`, `hasSlapBuff` | `performance.now()` becomes `sim.time`; `SLAP_SPEED_MUL` 1.5, 2 damage, +0.12 anger, 10 s. |
| `prisoners.js:51 tryCaptureHero`, `:92 reanchorPrisoner`, `:127 tickPrisoners` | `sim/prisoners.js` (same names) | 35 s cage → Skeleton, 25 s rack → Vampire. Phase 3; shapes reserved now. |
| `combat.js:204-219` (boss kill wins) | `sim/heart.js evaluateObjective` | Win/lose becomes data-driven against `level.objective` instead of an `isBoss` special case. |
| `heart.js:1` (mesh) + `main.js:528 _tickHeartCombat` | `sim/heart.js` + `world.js _createHeart` | The Heart becomes a unit with `hp`/`maxHp`/`faction`, targetable and healable, replacing the proximity drain at `main.js:528-545`. |
| `mood.js:65 _classify` | `sim/needs.js moodOf` | Sim returns `happy`/`neutral`/`angry`; the sprite stays a view concern. |

### 2.1 Constants to carry over

Move into `src/babylon/sim/data.js`, exported as frozen tables, and delete the
`core.js:5` import from the legacy `src/constants.js` (`REVIEW.md` defect #20).

- **Species** (`constants.js:53-178`): all ten entries verbatim, including
  `requiresRoom`, `fleeBelow`, `kiteMin`, `decisionInterval`, `commitPause` and
  `secondaryMove`. Skeleton, Vampire, Mistress and Dark Knight reuse the nearest
  existing Babylon rig until Phase 3.
- **Affinity** (`constants.js:188-194`); distress 5 / 4 s / 3 responders.
- **Work** (`constants.js:197`): dig 1.8, claim 0.9, reinforce 1.3, claim_wall
  1.5, wall 1.6; `JOB_PRIORITY` `['dig','claim','wall','claim_wall','reinforce']`.
- **Needs** (`constants.js:32-46`): hunger 1/60 per s, sleep 1/90 per s,
  `NEED_CRITICAL` 0.85, `NEED_SATISFIED` 0.15, `EAT_DURATION` 3,
  `SLEEP_DURATION` 6, `HATCHERY_TILE_CAP` 3, `HATCHERY_REGROW_PER_CHICKEN` 18.
- **Rooms**: `TREASURY_CAPACITY` 300, `TRAINING_XP_PER_SEC` 1,
  `TRAINING_LARGE_SIZE` 9, `LIBRARY_RESEARCH_PER_SEC` 0.6,
  `WORKSHOP_MFG_PER_SEC` 0.8, `ROOM_COST_PER_TILE` (25/25/35/50/50/50/60/80,
  wall 15). **Use the `constants.js:517` numbers, not the `input.js:22` set.**
- **Imps** (`constants.js:314-327`): HP 20, speed 2.8, flee 6 / safe 8.5 /
  bonus 0.6, min count 4, respawn 25 mana every 10 s.
- **Economy**: mana 1.0 base + 0.20 per claimed tile per second; keep the
  Babylon `manaMax` 350 rather than legacy 200.
- **Pay/mood**: `PAY_DAY_INTERVAL` 180, wage 8 × level (`creatures.js:1368`),
  `ANGER_*` rates (`creatures.js:1373-1376`), leaving 0.20 for 18 s.
- **XP** (`xp.js:26-30`, `constants.js:482-487`): 30 × 1.6^(L−1), caps 5 / 4,
  hero kill 22, boss 120, dig 2, claim 1.
- **Portals**: interval 22 s, max 8 spawns, 4×4 footprint.
- Doors and traps stay in `defenses.js:11-24` — already single-sourced, and
  `workshop.js:14` derives from it.

---

## 3. Milestones

Each is one PR. Tests go in `tests/` as `.mjs`, run by plain `node`, no
framework, using the `test(name, fn)` helper style already in
`tests/babylon-systems-smoke.mjs:17`.

### M0 — Foundations

**Scope.** Fix the start-screen blocker; single-source the room/spell/defense
data; add `package.json`.
**Files.** `ui.js:522` (add the `started` guard `main.js:372` already applies),
`main.js` (`snapshot()` must not report `paused: true` before `started`), new
`sim/data.js`, `world.js` (delete `ROOM_DEFINITIONS`), `input.js` (delete
`ROOM_COSTS`), `ui.js` (build `DEFAULT_MODES` from `sim/data.js`), new
`package.json` whose `test` script runs `node --check` over `src/babylon/*.js`
then every `tests/*.mjs`.
**Acceptance.** Loading the page shows only the start screen; a mouse click on
"Awaken the Heart" starts a game. `grep -c "cost:" src/babylon/ui.js` finds no
hard-coded room cost. `npm test` runs green.
**Test.** `tests/sim-data.mjs` — every room id in `ROOM` has exactly one cost
entry; costs match `constants.js:517`; every `ui` mode id resolves to a spell,
room, door or trap definition; no id is defined twice.

### M1 — Job queue, Imp digging/claiming/fortifying

**Files.** New `sim/state.js`, `sim/jobs.js`, `sim/imps.js`; `input.js:855-912` (`_applyTileMode` calls
`sim.markDig` / `sim.markClaim` / `sim.markWall` instead of `world.dig`);
`main.js` (build the sim, call `stepSim`); `entities.js` (`syncFromSim`, delete
`_think`/`_updateWork`/`_updateMotion`).
**Acceptance.** Painting dig shows markers; Imps walk there, work for
`WORK_DURATIONS.dig`, and the rock disappears; claim only happens adjacent to
owned ground; rock beside newly claimed floor gets a reinforce job.
**Test.** `tests/sim-jobs.mjs` on an 8×8 stub grid: marking rock creates one
`dig` job and marking twice does not duplicate; `assignJobs` gives the nearest
idle imp the nearest job; 2 s of stepping completes the dig and leaves
`TILE.EARTH`; completing a claim queues `reinforce` on each adjacent rock;
`isJobValid` is false once the tile changes under the job.

### M2 — Gold carrying and Treasury capacity

**Files.** New `sim/economy.js` (carrying, hauling, 300-per-tile cap, floor drops), `sim/imps.js`, `sim/rooms.js`, `input.js` (delete
the instant `economy.add('gold', minedGold)` at line 908), `main.js`.
**Acceptance.** Mining a gold vein does not change the gold counter; the Imp
carries a nugget and the counter rises only on deposit; a 1-tile treasury stops
accepting at 300 and the next haul finds another tile or drops on the floor.
**Test.** `tests/sim-economy.mjs` — deposit 250 then 100 into one treasury tile:
tile holds 300, 50 stays on the imp; `nearestTreasuryWithSpace` skips full
tiles; total `sim.economy.gold` equals the sum of treasury tile amounts.

### M3 — Rooms as connected components with effects

**Files.** `sim/rooms.js` in full, `world.js` (`buildRoom` requires `TILE.CLAIMED`;
room visuals read `sim.rooms`), `main.js` (`_tickResearch` uses room effects).
**Acceptance.** Two separated 3-tile training rooms are two components; joining
them makes one; a 9-tile room trains at ×2; research accrues only while a
Warlock stands on a library tile; designating unclaimed earth is refused.
**Test.** `tests/sim-rooms.mjs` — component identity and splitting when a middle
tile is undesignated; `large` flips at exactly 9; `tickEffects` awards
`TRAINING_XP_PER_SEC * dt` on a training tile and nothing off it; undesignating
a treasury holding gold returns false.

### M4 — Portal attraction

**Files.** New `sim/attraction.js`, `world.js` (portal cells claimable),
`sim/jobs.js` (border cascade claims portals), `main.js` (delete the free
starting creatures at lines 329-331 and 359-364).
**Acceptance.** An unclaimed portal spawns nothing; touching it with claimed
territory claims the whole pad; a claimed portal delivers a creature every 22 s
up to 8; Warlocks appear only once a library of minimum size exists.
**Test.** `tests/sim-attraction.mjs` — with a seeded RNG and no library,
`pickSpecies` never returns `warlock` over 500 rolls; with a 4-tile library it
does; `tick` produces exactly one arrival per interval and stops at
`PORTAL_MAX_SPAWN`.

### M5 — Needs, mood, pay, leaving

**Files.** `sim/needs.js`, `sim/ai.js`, payday in `sim/economy.js`, `entities.js` (mood/intent badge views),
`ui.js` (roster shows level, mood, need bars).
**Acceptance.** Hunger fills in 60 s and sends the creature to a hatchery tile,
which loses a chicken; a lair bed is reserved and released; payday every 180 s
pays 8 × level from a treasury the creature walks to; an unpaid, hungry creature
falls below 0.20 happiness, holds 18 s, then leaves through a claimed portal.
**Test.** `tests/sim-needs.mjs` — 60 s with no hatchery drives `needs.hunger` to
1 and makes `eat` the top candidate; with a hatchery, hunger falls below
`NEED_SATISFIED` after `EAT_DURATION`; `happiness` matches the formula for a
fixture; `tickLeaving` flips state after exactly `LEAVING_TIMEOUT`.

### M6 — XP, levels, training

**Files.** `sim/levels.js` wired into combat, jobs and training rooms, `sim/combat.js`, `sim/jobs.js`, `entities.js`
(level badge), `main.js:588` (`_unitView` reads the real level, not `1`).
**Acceptance.** Digging awards 2 XP, a hero kill 22; a creature levels at 30 XP,
gains +15 % max HP and a perk, and is fully healed; caps hold at 5 / 4.
**Test.** `tests/sim-levels.mjs` — `xpToNext(1..5)` is 30/48/77/123/197; 200 XP
lands a fresh Fly at the cap with the right HP; a Beetle always rolls `hardy`, a
Goblin always `vicious`.

### M7 — Heart entity, level definition, win/lose

**Files.** New `sim/heart.js`, `sim/level-defs.js`, `sim/index.js createSim(level)`, `main.js` (delete `_tickHeartCombat` at 528-545 and
`_seed` at 319; start state comes from the level record), `world.js` (heart cell
from the level), `persistence.js` (new `level` and `sim` sections).
**Acceptance.** Heroes path to the Heart and attack it as a unit; a spell can
heal it; killing the objective's boss shows the victory screen — `_endGame(true)`
becomes reachable for the first time.
**Test.** `tests/sim-heart.mjs` — an adjacent hero costs the Heart `atk` per
`atkInterval`, not per frame; `evaluateObjective` returns `lose` at 0 HP and
`win` when the objective unit dies; a save round-trip restores heart HP and
level id.

### M8 — Hero gates and party tables

**Files.** `sim/heroes.js` plus compounds and gates in `sim/level-defs.js`, `entities.js` (delete
`_heroSpawnPosition` at 1039), `main.js` (delete `_tickWaves` at 517).
**Acceptance.** Heroes enter from an authored gate outside the dungeon, never
from a player tunnel; a garrison stays home until its compound's last wall is
breached; party composition follows the level's table.
**Test.** `tests/sim-heroes.mjs` — `tickGates` spawns the wave-1 party at the
gate cell at `firstAt` and nothing before it; garrison heroes stay within
`territoryRadius` until `breached` flips; hero target priority picks a nearby
creature over the distant Heart.

### M9 — Hand pickup, drop, slap

**Files.** New `sim/hand.js` plus the Babylon hand view, `input.js` (mode `hand` stops aliasing to `select` at
line 49), `ui.js:12` (real Hand of Evil behaviour behind the button),
`entities.js` (held unit follows the cursor).
**Acceptance.** Left click picks up an Imp or creature and releases its job or
lair bed; a drop on unwalkable ground snaps to the nearest walkable cell; a drop
on a claimed portal dismisses the creature; a slap costs 2 HP and gives +50 %
speed for 10 s and +0.12 anger.
**Test.** `tests/sim-hand.mjs` — picking up an imp with a job clears
`job.claimedBy`; `resolveDrop` over rock returns the nearest walkable cell
within radius 3 and `null` when boxed in; `slap` then stepping 11 s clears the
buff; slapping a hero is refused.

### M10 — Door-aware pathfinding

**Files.** `src/babylon/navigation.js` (`_canEnter` at line 387 consults a
`doorAt(x, z)` callback), `defenses.js:457-476` (delete the snap-back),
`main.js` (pass the door lookup when constructing `NavigationService`).
**Acceptance.** A locked door is impassable to heroes, which route around it or
attack it; friendly units pass through their own doors; opening or selling a
door invalidates the path cache.
**Test.** `tests/sim-navigation-doors.mjs` — a corridor with a locked door gives
no hero path and a dungeon path; after `unlockDoor` the hero path exists;
`navigation.revision` changes on door state change so caches drop.

---

## 4. Risks: what in the current code fights this, and the edit

1. **Instant world mutation in input.** `input.js:855-912 _applyTileMode` calls
   `world.dig` / `world.claim` / `world.reinforce` / `world.buildRoom` and
   credits gold on the spot (line 908). *Edit:* replace the `invokeFirst` block
   with direct `sim.markDig(x, z)` / `sim.markClaim` / `sim.markRoom(x, z, mode)`
   calls that return `{ok, reason}`; delete the `economy.add('gold', minedGold)`
   line; leave `world.setTile` reachable only from `sim/jobs.js`.
2. **Duck-typed calls.** 126 `?.()` in `main.js`, `invokeFirst` at
   `input.js:98`, `maybeCall` at `main.js:25`; probes for
   `effects.showTargetPreview`, `ui.showError` and `ui.notify` hit nothing
   (`REVIEW.md` §5.1). *Edit:* delete both helpers, call methods directly, and
   add the two missing UI methods (`ui.notify`, `ui.setHover`).
3. **`entities.js _think`.** Lines 730-793 are a second brain that will fight
   `sim/ai.js` for `entity.destination` and `entity.state`. *Edit:* delete it
   along with `_updateMotion`, `_updateWork`, `_updateCombat`, `_kill`,
   `setRally`, `assignWork` and the unreachable `_findPath` (975-1028,
   `REVIEW.md` defect #24); keep `_animate`, `_build*`, `_playAssetAnimation`.
4. **Two keydown handlers.** `input.js:196` (capture phase) and `ui.js:354`
   both handle Escape, `[`, `]` and shortcuts; it only works because
   `ui.js:325` bails on `defaultPrevented` (`REVIEW.md` §5.1). *Edit:* keep the
   `input.js` listener as the only one, have it call `ui.handleShortcut(key)`,
   and delete `ui.js:322-353`.
5. **Escape ordering.** `input.js:749-753` toggles pause while a spell is armed.
   *Edit:* if `this.mode` is a spell or a room mode, Escape cancels the mode and
   returns; only an already-`select` mode falls through to pause.
6. **`Math.random()` in the entity layer.** `entities.js:128-129` and
   `_heroSpawnPosition:1055`, while the world uses seeded xorshift. *Edit:* all
   gameplay randomness moves to `sim/rng.js`; `Math.random()` survives only for
   visual jitter inside `_animate`.
7. **`roomType` accessor bridge.** `world.js:138-142` installs 4,096 property
   accessors to alias `roomType` → `room`. *Edit:* the sim uses `cell.room`
   everywhere; delete the `defineProperty` block and fix the two legacy call
   sites it existed for.
8. **Whole-grid rebuilds and scans.** `world.js:455 rebuildVisuals` rescans the
   grid on any change — now continuous, because Imps dig continuously — and
   `world.js:787 randomWalkable` allocates 4,096 candidates per call. *Edit:*
   keep the 0.05 s `_rebuildClock` batch for M1, move to dirty rectangles later;
   `sim/ai.js pickWanderTile` samples the claimed-cell list the room index keeps,
   so `randomWalkable` leaves the hot path with `_think`.
9. **Persistence coupling.** `persistence.js:111 serializeEntities` writes view
    fields. *Edit:* add a `sim` section adapter for `sim.units`, `sim.jobs`,
    `sim.rooms`, `sim.economy` and `sim.level`; keep the `entities` adapter
    until M7, then delete it and bump `SAVE_VERSION` to 2 with a migration.
10. **`dt` clamping drift.** `main.js:463` caps at 50 ms and each director
    clamps again at 75-100 ms, so under load the world slows rather than steps
    (`REVIEW.md` §5.7). *Edit:* `stepSim` accumulates into fixed 1/30 s steps
    with a maximum of 4 steps per frame, so cooldowns and payday stay on wall
    time.
11. **Legacy import.** `core.js:5` imports `GRID_SIZE`, `HEART_X`, `HEART_Z`
    from the dead `src/constants.js`. *Edit (M0):* those values come from the
    level definition; delete the import and move `src/*.js` to `legacy/`.

---

## 5. Definition of done: "the DK2 loop exists"

The loop exists when a scripted 20-minute session plays end to end, in a real
browser, with no console errors, exactly as written:

- **0:00** The start screen is visible and nothing overlaps it. Clicking
  "Awaken the Heart" with the mouse begins the level: 625 gold, 4 Imps, a
  Dungeon Heart with HP, four short tunnels, fog everywhere else. No creatures
  are given away for free.
- **0:10-1:30** The player drags a dig order down the east tunnel. Markers
  appear; Imps walk there, swing, and the rock goes tile by tile. Gold does not
  move until an Imp carries a nugget back. Behind them, claim jobs turn floor
  red and reinforce jobs fortify the rock edges unbidden.
- **1:30-3:00** A gold seam is exposed with nowhere to put it, so the player
  designates a 2×3 Treasury on claimed floor (150 gold). Imps haul; the counter
  climbs a vein at a time. A tile fills at 300 and the next nugget lands on the
  floor rather than vanishing.
- **3:00-5:00** Digging reaches the portal. Claimed territory touches it, the
  whole 4×4 pad flips, and 22 seconds later a Fly arrives. A Lair and a
  Hatchery go down; the Fly claims a bed and eats a chicken, which regrows.
- **5:00-9:00** A Training Room and a Library go up. Creatures on training tiles
  gain XP and reach level 2 with a badge and a perk message. The 9-tile Library
  studies at ×2 — but only while a Warlock stands in it, and a Warlock only
  arrives because the Library exists. A player-chosen spell finishes research.
- **9:00-12:00** Payday fires. Creatures walk to the Treasury and take 8 ×
  level each. The player lets it run dry: anger climbs, two creatures brawl, and
  one walks back to the portal and leaves. Refilling before the 18-second timer
  saves the next one.
- **12:00-16:00** The first hero party enters from a gate at the map edge, never
  from the player's own tunnel. It fights the defenders, chops through an
  Ironwood Door instead of standing snapped against it, trips a Spike Trap, and
  reaches the Heart, which loses HP as a targetable unit. The player lifts a
  wounded Warlock with the Hand, drops it behind the line, and slaps an Imp.
- **16:00-20:00** The player breaches the boss compound's last wall; the
  garrison releases and marches. Killing the Knight Commander triggers victory;
  letting the Heart reach 0 triggers defeat. The current build can do neither.
- **Throughout** `npm test` is green; every `sim/` module imports with
  `window.BABYLON = null`; a save taken at 10:00 and reloaded resumes the same
  jobs, room contents, creature needs and hero positions.
