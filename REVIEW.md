# Application and Design Review

Date: 2026-09-05. Reviewed at commit `f262abc` (branch `main`).

This document is the working baseline for the next phase. It covers what the
repository actually contains, how far it is from the Dungeon Keeper 2 (DK2)
target, what went wrong technically, and a recommended path forward. Every
claim below is tied to a file and line so it can be checked and worked on.

## 1. Verdict

1. **The live client is not a game yet.** `index.html` loads `src/babylon/`.
   In that client the player digs, claims and builds rooms instantly with the
   cursor, Imps do no work, portals spawn nothing, rooms do nothing, gold is
   not stored, creatures have no needs, levels, pay or mood, and there is no
   win condition. The DK2 core loop (dig → claim → build rooms → attract
   creatures → keep them fed, paid and trained → defend) does not exist.
2. **The rewrite regressed the previous client.** The Three.js client in
   `src/*.js` (v0.11.7, ~14k lines, 46 commits over April) had a job queue,
   Imp digging and claiming with carried gold, portal-driven creature
   attraction across ten species with room gates, hunger/sleep/pay/mood with
   brawls and desertion, XP and levels with perks, training, library and
   workshop room effects, prisons with skeleton and vampire conversion, fog
   of war, slapping, the Hand, possession, five hero compounds with a boss
   and a victory condition. The Babylon rewrite (two commits on 2026-09-04,
   ~13k lines) kept the rendering ambition and the peripheral systems (doors,
   traps, 14 spells, workshop crates, saves, first-person possession) and
   dropped the simulation that made it a game.
3. **The rewrite was never run.** `BABYLON_MIGRATION.md` states the checkpoint
   "has not received final visual, interaction ... QA in a real browser".
   Run headless, it boots without errors, but the Paused dialog is drawn
   over the start screen and blocks the mouse; only Enter starts a game
   (section 7).
4. **The codebase now carries two clients, stale documentation and a deleted
   "frozen" file.** `CLAUDE.md` still describes a 30×30 Three.js game.
   `README.md`, `AGENTS.md` and `BABYLON_MIGRATION.md` all say
   `dungeon_keeper_poc.html` is frozen and must never be edited; it was deleted
   in commit `926ac0c`.
5. **The Babylon code is defensively duck-typed against interfaces that do not
   exist.** Modules probe for methods by name (`invokeFirst`, `maybeCall`,
   `?.` chains) instead of sharing a contract. Missing wiring fails silently.
   Several UI promises (Hand of Evil pickup, room costs, three room types)
   have no implementation behind them.

The recommendation (section 9) is to keep the Babylon renderer and the
peripheral systems, port the legacy simulation into it as the authoritative
game model, and delete the legacy client once parity is reached.

## Companion documents

- `docs/dk2-reference.md`: DK2 mechanics reference (tiles, rooms, creatures,
  needs, economy, spells, workshop, heroes, levels, controls) with source
  confidence marks and a per-area delta to this repository.
- `docs/dk2-presentation.md`: DK2 art direction, lighting, HUD, audio and a
  per-creature look sheet, each mapped to concrete Babylon changes.
- `docs/plan-dk2-loop.md`: engineering plan to port the simulation into the
  Babylon client, with function-level mapping, milestones and tests.

## 2. Method

- Read every module in `src/babylon/` (18 files, 11,197 lines), `index.html`,
  `tests/babylon-systems-smoke.mjs`, the CSS breakpoints, and all five
  Markdown documents.
- Inventoried the legacy client in `src/*.js` (35 files, 14,243 lines) to
  establish what existed before the rewrite (section 6).
- Ran the repository's own validation (`node --check` on every module,
  `node tests/babylon-systems-smoke.mjs`, `git diff --check`): all pass.
- Booted the Babylon client in headless Chromium with SwiftShader WebGL,
  captured console output and screenshots, and exercised the start flow
  (section 7).
- Compared mechanics against DK2 as shipped (Bullfrog, 1999) and the Prima
  guide the migration document cites.

## 3. Repository state

| Item | Finding |
| --- | --- |
| Entry point | `index.html` loads Babylon 9.25 from jsDelivr plus Google Fonts, then `src/babylon/main.js`. No local fallback; the game does not load offline. |
| Live code | `src/babylon/*.js` (18 modules). |
| Dead code | `src/*.js` legacy client (35 modules, 14k lines) is not loaded by any HTML file. `styles.css` (1,322 lines) is unused. Only `src/constants.js` is still imported, by `src/babylon/core.js:5`, for `GRID_SIZE`, `HEART_X`, `HEART_Z`. |
| Missing file | `dungeon_keeper_poc.html` is referenced as a frozen backup by `README.md`, `AGENTS.md`, `CLAUDE.md` and `BABYLON_MIGRATION.md`. Deleted in `926ac0c`. |
| Documentation drift | `CLAUDE.md` describes the Three.js architecture, a 30×30 grid, 10 waves, and four species; none of that is the live client. `ROADMAP.md` is written against the legacy client. `BABYLON_MIGRATION.md` claims "headless logic smoke tests pass for spell costs, cooldowns, target validation, healing, lightning..." but no such test exists in `tests/`. |
| Tests | One file, four cases: navigation caching, workshop logistics (two), persistence round trip. Nothing covers entities, combat, world mutation, economy, waves, magic, UI or input. |
| Tooling | No package.json, no lint, no formatter, no CI. Validation is a shell loop in `AGENTS.md`. |
| Duplicate constants | Room costs are defined three times with two different value sets: `world.js:38` (25/25/35/50/50/60/80/50/100, exported and unused), `input.js:22` (50/75/85/120/150/175/140/190/220, charged), `ui.js:14` (same as input, displayed). |
| Duplicate logic | `statusState` and `recomputeStatusModifiers` are copy-pasted in `magic.js:46-87` and `defenses.js:39-76`, and a third variant lives in `persistence.js:363` as `reapplyStatuses`. |

## 4. DK2 core loop audit

DK2's loop is: Imps dig and claim; claimed ground near a portal attracts
creatures whose type depends on the rooms you own; creatures eat at the
Hatchery, sleep in the Lair, take pay from the Treasury, train, research and
manufacture; unhappy creatures leave; heroes arrive from hero gates and rival
Keepers; defeating the map's objective wins the level.

| Mechanic | DK2 | Legacy client (`src/*.js`) | Babylon client (`src/babylon/`) |
| --- | --- | --- | --- |
| Dig | Imp walks to tile, mines it over time | Job queue, Imps self-assign nearest job (`jobs.js`, `imps.js`) | Instant. `input.js:875` calls `world.dig()` directly on paint. `world.js:680-689` mutates the tile and returns gold. |
| Claim | Imps claim floor adjacent to owned ground; walls fortify automatically | Job types `claim`, `claim_wall`, `reinforce` | Instant. `world.claim()` at `input.js:876`. `reinforce` (`world.js:703`) converts any rock, earth or claimed floor into a wall on paint. |
| Gold | Mined gold is carried to a Treasury; Treasury capacity caps income | Treasuries with capacity, dropped gold, carrying Imps | `input.js:908` adds the full vein value to `state.gold` the instant the tile is painted. Treasury tiles have no function. |
| Impenetrable rock | Map edges and shapes | Yes (`T_ROCK` vs diggable earth) | None. `TILE.ROCK` is diggable (`world.js:680-682`). Only the 2-tile border is undiggable by omission. |
| Portal / attraction | Claim a portal; creatures arrive based on rooms owned | Portals roll species by `spawnWeight`, Warlocks require a Library | Portal is a decorative landmark (`world.js:571`). No spawning code references it. Three creatures are placed for free at boot (`main.js:329-331`). |
| Imp work | Dig, claim, fortify, carry gold, deliver crates, drag bodies | Dig, claim, reinforce, carry gold, flee | Workshop crate delivery and repair only (`workshop.js:471-540`). `entities.js:_think` gives Imps flee-or-wander behaviour, nothing else. `assignWork` exists but nothing calls it. |
| Hatchery / hunger | Creatures eat chickens | Hunger need, chickens per tile | No hunger. Hatchery tiles are decor. |
| Lair / sleep | Creatures sleep, heal, need lair space | Sleep need, lair capacity | No sleep. |
| Treasury / pay | Periodic payday (interval approx. 8 min, unverified); unpaid creatures get angry | `paySince`, pay day, anger | No pay. |
| Mood / anger / leaving | Happiness, brawls, desertion through the portal | Mood, brawls, slap penalty | None. |
| XP / levels | Level 1–10, stats scale | Levels with XP, level badges | No XP. `_unitView` hardcodes `level: 1` (`main.js:588`). |
| Training Room | Passive XP | Yes, 2× in large rooms | Decor only. |
| Library / research | Warlocks research spells | Warlocks generate research on library tiles | Research accrues from the count of library tiles regardless of creatures (`main.js:506-514`); the target spell is auto-picked, the player cannot choose. |
| Workshop | Trolls and others manufacture | Not built | Work pool refills passively from Imp count (`main.js:503`); Workshop tiles convert pool into crates (`workshop.js:393`). No creature works there. Trolls are plain fighters. |
| Prison / Torture / Temple / Graveyard | Convert or sacrifice | Prison and torture with skeleton/vampire conversion | Room ids exist in `world.js:26-36` but `ui.js` exposes no button for prison, torture or temple, so they cannot be built. No behaviour. |
| Rooms as connected components | Size matters, room efficiency | Connected components, centroid props, large-room bonus | Rooms are per-tile tags. No component, size or adjacency logic. |
| Hero source | Hero gates, rival Keeper dungeons, map-authored parties | Five pre-built hero compounds with garrisons | Heroes teleport onto the farthest discovered walkable tile from the Heart (`entities.js:1039-1060`), which at game start is the end of one of the player's own starter tunnels. |
| Wave structure | Level objectives | Timed waves already dead; garrisons activate when breached; boss kill wins | Infinite waves every 22–42 s (`main.js:517-526`). `_endGame(true)` is never called; the victory screen is unreachable. |
| Hand of Evil | Pick up, drop, slap creatures; drop gold | Pickup, drop, slap | "Hand of Evil" button (`ui.js:12`) is an alias for `select` (`input.js:49`). No pickup, drop or slap. |
| Possession | First-person control with creature abilities | Yes | Yes, first-person with pointer lock and per-creature abilities (`possession.js`). This is the best-realised DK2 feature in the rewrite. |
| Doors / traps | Workshop-made, placed, Imps carry | Doors and traps (simpler) | Complete and well structured (`defenses.js`, `workshop.js`). Pathfinding ignores doors (`navigation.js` has no door awareness), so heroes are physically halted at doors rather than routing around them (`defenses.js:457-476`). |
| Spells | Mana-gated, researched | 7 spells, research | 14 spells with mana, cooldowns, prerequisites (`magic.js`). Good data model. |
| Fog of war | Yes | Yes | Yes, discovered/visible per cell, Sight of Evil reveals. |

Net: the Babylon client is a rendering platform plus defence/spell/persistence
subsystems. The management simulation that defines DK2 is absent, and most of
it existed in the legacy client.

## 5. Technical review of the Babylon client

### 5.1 Architecture

- **Orchestration** (`main.js`): one `BabylonGameApp` owns state, economy,
  waves, heart damage, research and UI snapshots. Reasonable shape.
- **Contracts by guessing.** `main.js:25` `maybeCall(owner, ['init','ready'])`,
  `input.js:98` `invokeFirst([...])` and pervasive `?.()` calls (126 in
  `main.js`, 58 in `magic.js`, 77 in `persistence.js`) mean every module was
  written against a hypothetical API. Examples of wiring that silently does
  nothing: `input.js:1134-1138` probes `effects.showTargetPreview`,
  `effects.showTilePreview` and `ui.setHover`; none exist. Hover feedback only
  works because `visuals.js:558` listens to a DOM event dispatched as a side
  channel. `input.js:1278-1282` probes `ui.showError`, `ui.notify`, `ui.toast`;
  none exist, so invalid-target messages reach the player only via the
  `spellFailed` event bus for spells and not at all for tile commands.
  `main.js:357` `maybeCall(this.audio, ['unlock','resume'])` works only
  because `resume` happens to exist.
- **Two owners of scene settings.** `core.js:227-233` sets clear colour, fog
  mode, fog density 0.014; `environment.js:52-58` overwrites all of them
  (density 0.008) while its comment says it "never creates a second set".
- **Legacy coupling.** `core.js:5` imports grid constants from the legacy
  `src/constants.js`, which is otherwise dead.
- **Global side channels.** Custom DOM events (`dungeon:mode-changed`,
  `dungeon:hover-changed`, `dungeon:pause-changed`, ...) and
  `runtime.events` coexist; `main.js:271-299` listens to both. Two keydown
  handlers on `window` (`input.js:196`, `ui.js:354`) both process Escape,
  `[`, `]` and shortcuts; the capture-phase handler in `input.js` prevents
  the default so `ui.js` bails on `defaultPrevented` (`ui.js:325`). This is
  fragile ordering, not a design.

### 5.2 World (`world.js`)

- Per-cell `Object.defineProperty` accessor for a `roomType` alias
  (`world.js:138-142`), 4,096 accessors, to bridge a naming inconsistency
  that should have been resolved at the source.
- `rebuildVisuals()` (`world.js:455`) rescans the whole 64×64 grid, rebuilds
  every matrix, and diffs Float32Arrays on any change. Acceptable for now,
  known limitation, but every dug tile costs a full rebuild.
- `randomWalkable()` (`world.js:787`) scans all 4,096 cells and allocates a
  candidate array per call; `entities.js:_think` calls it for every wander
  decision.
- `dig()` sets `cell.gold = 0` and returns the whole vein value at once
  (`world.js:680-689`). DK2 veins are mined in increments carried by Imps.
- `buildRoom()` accepts unclaimed `EARTH` (`world.js:729`); DK2 requires
  claimed floor; rooms cannot be built on tiles the player does not own.
- `reinforce()` (`world.js:703`) turns walkable floor into a wall; in DK2 fortification is an
  automatic Imp action on walls adjacent to claimed floor, never a floor
  command.

### 5.3 Entities (`entities.js`)

- Eight character builders are clean and data-driven; the procedural rigs
  and animation are genuinely good work.
- AI is a single `_think` (`entities.js:730-789`): flee if controlled,
  attack nearest enemy within 5.5 (7.5 ranged), rally, heroes walk to the
  heart, otherwise 22 % chance to wander. There is no goal scoring, no
  needs, no room usage, no job seeking. The legacy `_reevaluateGoal` in
  `src/creatures.js` was materially better.
- Priests do not heal; archers and priests differ only in range and damage
  (`entities.js:17-26`).
- Heroes have no target for the heart as an entity; `main.js:528-545` drains
  `state.heartHp` by proximity. The heart cannot be defended by blocking,
  cannot be targeted by spells, and creatures never prioritise it.
- `_findPath` (`entities.js:975`) duplicates the BFS in `navigation.js` as a
  fallback that can never run because `main.js` always installs navigation.
- `entity.attackCooldown` and `phase` use `Math.random()`; the world uses a
  seeded xorshift. The simulation is not deterministic, which the save/load
  and test story implicitly assume.

### 5.4 Input and UI (`input.js`, `ui.js`, `styles-babylon.css`)

- `input.js` is a 1,308-line generic controller. Roughly a third of it is
  fallbacks for world/entity APIs that do not exist in this repository
  (`_tileFromPick` alone tries nine metadata shapes, `input.js:501-549`).
- `SHORTCUT_MODES` in `input.js:64-80` and `shortcut` fields in
  `ui.js:10-44` are separate tables that happen to agree today.
- Reinforce has no button (only key `f`). Prison, Torture and Temple have no
  button. Sell mode has a button but `ui.js` does not send `sell` through
  `_modeStates`, so it is never disabled or costed.
- The palette lists 35 modes in a 278 px column (`styles-babylon.css:477`);
  the defences tab alone has 11 entries in a scrolling list. DK2 used icon
  grids with tooltips; this reads as a settings menu.
- Responsive breakpoints exist (`styles-babylon.css:1086-1236`) but were never
  rendered (section 7).
- Escape toggles pause even while a spell is being targeted with nothing
  selected (`input.js:749-753`), so the first Escape after choosing a spell
  opens the pause menu rather than cancelling the spell.

### 5.5 Magic, defences, workshop (`magic.js`, `defenses.js`, `workshop.js`)

These three modules are the strongest code in the rewrite: explicit data
tables, validation before spending, refunds on failure, event emission,
serialisable state, and unit tests for workshop logistics.

- Research is automatic (`main.js:506-514`): the first affordable unlocked
  spell is chosen. DK2 lets the player pick. Also research rate depends on
  library tile count, not on creatures studying.
- `magic.js:36` unlocks seven spells at start including Lightning and Call to
  Arms. In DK2 most spells are unlocked by Library research in a per-level
  order; Create Imp is the one reliably available from the start. Combined
  with 220 starting mana this trivialises the first minutes.
- Magic door retaliation spends the Keeper's mana (`defenses.js:275`), which
  is a reasonable DK2 adaptation.
- Doors halt entities by snapping their position (`defenses.js:468`), which
  fights the mover every frame. Pathfinding should treat locked or hostile
  doors as blocked cells instead.
- Trap targeting ignores `conceal` correctly but spike traps apply a
  `defense:` status keyed on trap id that is never cleaned if the trap is
  sold mid-effect (harmless, times out).

### 5.6 Navigation, persistence, possession

- `navigation.js` is solid: cached BFS, flow fields, per-frame budget,
  spatial hash. It is cardinal-only (no diagonals), so paths look robotic.
  `main.js:472` and `main.js:474` sync the spatial index twice per frame.
- `persistence.js` is careful (validation, migrations, size caps). It stores
  `started` and `paused` in the save so loading restores a paused flag.
  Autosave every 30 s serialises the whole grid (4,096 cells) as JSON objects
  with string keys; a compact typed encoding would be 10× smaller.
- `possession.js` is complete and self-contained. Movement bypasses
  navigation and uses a five-point footprint probe (`possession.js:448`).

### 5.7 Rendering and performance

- Lighting is one directional "moon" plus a hemisphere (`core.js:70-94`)
  with cascaded shadows. This is an outdoor lighting model. DK2's identity is
  black rock with pools of warm torchlight. Torches in rooms are unlit props
  (`world.js:447`). Effects offer 0–6 pooled point lights by tier
  (`effects.js:10-14`). The scene will read as evenly moonlit, not as a
  dungeon.
- Thin instancing for tiles and decor is the right call. Entities are cloned
  meshes per part (an Imp is ~30 meshes); 40 units is ~1,200 draw-call
  candidates before frustum culling. Fine at current scale, will need merging
  or instancing for larger battles.
- `frame()` caps `dt` at 50 ms; each director additionally clamps to 75–100
  ms. Under load the simulation slows rather than stepping, so waves and
  cooldowns drift from wall time.

## 6. Legacy client inventory (`src/*.js`)

Not loaded by any HTML file. The pre-rewrite entry point survives in git
(`git show acf04ad:index.html`); restoring it next to `src/` makes the client
runnable again. What it contains, as rules worth porting:

- **World.** 64×64, Heart at (32,32), 32 seeded gold veins, four neutral 4×4
  portals in rock, five pre-built hero compounds from string templates
  (`constants.js:359-403`, `heroes.js:598-666`), six neutral pockets with
  gold trails.
- **Species (`constants.js:53-190`).** Fly, Beetle, Goblin, Warlock
  (requires Library), Troll (requires Workshop), Skeleton (prison only),
  Vampire (torture only, lifesteal), Bile Demon, Mistress (requires
  Training), Dark Knight. Each has hp/atk/cooldown/range/speed, a favourite
  room, a flee threshold or kite distance, a spawn weight, and a level-3
  secondary move (`creatures.js:949-1033`). Affinity table nudges anger
  between species (`constants.js:203-209`).
- **Portal spawning.** Species rolled by weight and room gate, 22 s interval,
  8 spawns per portal (`creatures.js:678-698`, `creatures.js:2026-2040`).
- **Creature AI.** Combat first (flee, kite, chase, strike), then utility
  scoring over eat/sleep/pay/help/rally/train/study/work/favourite/wander
  with hysteresis and a commit pause (`creatures.js:1129-1190`). Distress
  broadcast pulls helpers. Brawls at anger ≥ 0.5 with a 30 % HP floor.
- **Needs and mood.** Hunger fills in 60 s, sleep in 90 s. Eating consumes a
  chicken from a per-tile pool (cap 3, regrow 18 s). Sleep heals 70 % over
  6 s. Wages of 8 × level every 90 s plus a global 180 s Pay Day (two
  overlapping systems, a legacy bug). Happiness < 0.20 for 18 s makes the
  creature walk to a claimed portal and leave (`creatures.js:1452-1546`).
- **Rooms.** Treasury (300 gold per tile), Lair (bed ownership), Hatchery
  (chickens), Training (+1 XP/s, ×2 at ≥ 9 tiles), Library (Warlocks
  0.6 research/s), Workshop (Trolls 0.8 manufacturing/s), Prison, Torture,
  player-built Wall. Only claimed floor is designatable (`rooms.js:1673`).
- **Prison and torture.** Non-boss heroes downed near a free prison tile are
  captured; 35 s starvation makes a Skeleton, 25 s on the rack makes a
  Vampire (`prisoners.js:160-172`).
- **Hand, slap, possession.** Pick up and drop Imps, creatures and
  prisoners; drop on a claimed portal to dismiss. Slap: 2 damage, +50 %
  speed for 10 s, +0.12 anger. Possession with pointer lock and a cone
  melee.
- **XP.** 30 × 1.6^(L−1); creatures cap 5, Imps 4; hero kill 22, boss 120,
  dig 2, claim 1. Level-up gives +15 % HP plus a Hardy/Vicious perk.
- **Heroes.** Knight, Archer, Priest (heals 5/s), Dwarf (plunders
  treasuries), Knight Commander boss. Garrisons guard their compound until
  the player breaches its last wall, then march on the Heart. Killing the
  boss wins (`combat.js:204-219`). The timed wave system was already dead:
  `invasion.nextWaveAt = Infinity` (`state.js:64-74`).
- **Spells.** Lightning, Heal, Call to Arms, Haste, Create Imp, Possess,
  Sight of Evil; all but Create Imp locked behind Library research with a
  player-chosen target (`spells.js:453-484`). Mana regenerates at
  1 + 0.2 per claimed tile per second.

Known legacy defects to avoid carrying over: mixed time bases
(`performance.now()` vs simulation time) for shake, rally and cooldowns
(`heroes.js:1002`, `spells.js:150`, `slap.js:544`); a canvas texture
allocated per damage event (`combat.js:88-111`) while heroes damage the
Heart every frame; O(N²) per-frame scans in hero, creature and Imp ticks;
two pay systems; wages teleported out of any treasury without travel.
The four "known bugs" in `CLAUDE.md` were already fixed before the rewrite.

## 7. Browser evidence

Headless Chromium (Playwright, WebGL2 via SwiftShader), 1400×900. Because
this sandbox blocks jsDelivr, Babylon 9.25 was served from a local copy of
the npm packages; the repository itself was not modified. Screenshots are
in `docs/review/`.

**Boots cleanly.** Zero page errors, zero console errors. Babylon reports
WebGL2, the boot status clears, `window.__DUNGEON_HEART__` is exposed, the
start screen renders. One harmless warning from WebGPU probing.

**Blocker: the Paused dialog covers the start screen on first load**
(`docs/review/2026-09-05-paused-over-start.png`). Playwright cannot click
"Awaken the Heart": the pause screen "intercepts pointer events". Chain:
`main.js:69` starts with `paused: true`; `main.js:687` copies it into the
HUD snapshot; `ui.js:522` shows the pause screen whenever the snapshot says
paused, without the `started` guard that `main.js:372` applies. Pressing
Enter works because `ui.js:329` routes it to `start-new`. Mouse and touch
users cannot start the game.

**Runs once started** (`docs/review/2026-09-05-in-game.png`). After Enter:
HUD shows Heart 500/500, Gold 625, Mana 221/350, Work 48, Forces 4+3,
wave timer 0:38. Four Imps, a Troll, a Warlock and a Bile Demon idle and
wander. Pressing keys 1–5 then dragging on the canvas built Hatchery tiles
instantly along the drag on unclaimed tunnel floor (gold 625 → 30), which
confirms items 2 and 13 of the defect list from a real session. A second
drag in dig mode excavated instantly.

**Scene cost at an empty dungeon:** 260 meshes, 189 active, 717 draw calls,
110 materials, 4 lights. Three shadow cascades plus the glow layer multiply
every mesh's draw count. Frame rate under SwiftShader was 1–2 FPS with 36 %
of CPU in shader link/status queries and game logic under 1 %, so real-GPU
performance is still unmeasured; the draw-call count is the number to
watch.

**Distribution risk.** `index.html` requests
`babylonjs@9.25.0/babylon.min.js` from jsDelivr. The npm package ships
`babylon.js` (8.3 MB) and no `babylon.min.js`; jsDelivr serves a minified
file on demand, so the URL works today but depends on that service
behaviour. Vendoring the two Babylon files (or a pinned build step) removes
the dependency and makes the game load offline.

**Validation:** all modules pass `node --check`; the four smoke tests pass;
`git diff --check` is clean.

## 8. Design assessment against DK2

**What the rewrite got right**

- Possession with pointer lock and creature abilities.
- Workshop → crate → Imp delivery pipeline.
- Door tiers, trap variety and behaviours, Magic Door retaliation.
- Spell data model: mana, cooldown, prerequisites, refunds.
- Fog of war with Sight of Evil.
- Procedural creature rigs with readable silhouettes.
- Persistence with validation and migration.

**What the first screenshot says** (`docs/review/2026-09-05-in-game.png`)

- The world is a small violet diamond in a black void. Rock is flat purple
  cubes, claimed floor is a magenta grid, the Heart is a pink cone. Nothing
  is warm, nothing is stone. DK2 reads as black rock, ochre earth, warm
  torch pools and a red pulsing Heart; this reads as a moonlit isometric
  puzzle board.
- Creatures are ~20 px tall at the default zoom and are the same value as
  the floor. In DK2 the creature is the loudest thing on screen.
- The HUD takes roughly a third of a 1400 px viewport: a 278 px command
  panel with four oversized text rows, a 260 px roster, a 220 px minimap,
  a bottom context bar and a top bar. The dungeon is boxed in. DK2's panel
  is one strip of icons plus tooltips.
- The palette shows four orders on the first tab; the player has to switch
  tabs to find rooms and spells. DK2 shows every room and spell at once
  because comparing them is the game.
- No fortified walls, no torches lit, no portal visible, no gold veins in
  the revealed area. The starter map gives the player nothing to want.

**What is missing or wrong, in priority order**

1. Imps must do the work. Dig, claim, fortify, carry gold and crates, on a
   job queue with priorities. Instant painting removes time, space and risk
   from every decision.
2. The portal must be the reward for building. Creature arrival should be a
   function of claimed area, portal ownership and rooms owned, per species.
3. Rooms must have effects and be connected components with size thresholds.
   Treasury capacity, Hatchery food, Lair beds, Training XP, Library research
   by Warlocks, Workshop manufacture by Trolls.
4. Creatures need needs: hunger, sleep, pay, happiness, anger, leaving. With
   levels and XP so time invested matters.
5. Heroes need a source on the map (hero gate) and a reason to exist beyond
   a timer. A level needs a win condition.
6. The Hand must pick up, drop and slap.
7. Lighting must move from moonlight to torchlight. Black rock, warm pools,
   room accent colours, Heart glow that changes with HP.
8. The UI must become a Keeper panel: icon grid with hover tooltips, a
   creature roster with mood and level, and event text that reads like the
   DK2 mentor ("Your creatures are hungry, Keeper").

## 9. Recommendation and plan

### Decision

Keep the Babylon client as the platform. Port the legacy simulation into it
as an explicit, renderer-independent game model. Do not resurrect the
Three.js client; do not continue adding features to the Babylon client until
the loop exists.

Reasons: the Babylon renderer, effects, navigation, persistence, defences,
magic and possession are worth keeping and are already structured as
directors with plain-object state. The legacy simulation is worth keeping as
rules and numbers, not as code; it is tied to Three.js meshes via
`userData`.

### Phase 0: Clean up (small)

- Delete `dungeon_keeper_poc.html` references; delete `styles.css`; move
  `src/*.js` to `legacy/` (or a git tag) and stop importing
  `src/constants.js` from `core.js`.
- Rewrite `CLAUDE.md` and `AGENTS.md` for the Babylon client. Retire
  `BABYLON_MIGRATION.md` into a changelog entry. Fold this review's plan into
  `ROADMAP.md`.
- Single source of truth for room, spell, door and trap definitions
  (one `data/` module), consumed by world, input and UI.
- Add `package.json` with a `test` script and an ESLint config; add a
  GitHub Actions job that runs `node --check`, the smoke tests and a
  Playwright boot test.

### Phase 1: The loop (large)

1. **Jobs and Imps.** Port `jobs.js` and `imps.js` semantics: job queue with
   `dig`, `claim`, `fortify`, `carryGold`, `deliver`; nearest-job assignment;
   dig progress per tile; gold carried in increments to a Treasury with
   capacity. Painting only marks tiles.
2. **Rooms as components.** Port `rebuildRoomAround` semantics: connected
   components per room type, size tiers, per-room effects table.
3. **Portal and attraction.** Portal claimable; per-species attraction rules
   (rooms required, minimum room size, claimed-area threshold); arrival
   cadence.
4. **Creature needs and mood.** Port hunger, sleep, pay, happiness, anger,
   leaving; Hatchery chickens, Lair beds, payday.
5. **XP and levels.** Port levels 1–10 with stat scaling and training.
6. **Heart as entity and win/lose.** Heart with HP, attackable, visible
   damage tiers. Level definition with objective and victory.
7. **Hero gates and parties.** Authored spawn points outside the dungeon;
   party tables per wave; hero AI that targets creatures, doors, rooms and
   the Heart with priorities.

Each step comes with a headless test (the directors already run without
Babylon; keep it that way).

### Phase 2: Feel

- Hand of Evil: pickup, drop, slap, gold drop.
- Torchlight lighting model; Heart glow; room accent lights from the pooled
  light budget.
- Keeper UI: icon grid, tooltips, roster with mood/level, mentor messages.
- Door-aware pathfinding; diagonal movement.

### Phase 3: Content and balance

- Full DK2 roster (Mistress, Dark Elf, Salamander, Vampire, Skeleton,
  Black Knight...) using the existing rig kit.
- Temple, Graveyard, Casino, Combat Pit, Guard Room.
- Level scripting and campaign structure.

## 10. Character models: getting past primitives

The procedural rigs (`entities.js:508-725`) are spheres, boxes and cones on
transform-node joints. They can be tuned, but they cannot become DK2
characters: no silhouette detail, no faces, no cloth, no skinning. Detailed
characters need authored, skinned, animated meshes. The plumbing for that
already exists and should be the path.

### 10.1 What the code already supports

- `AssetLibrary` (`assets.js:86`) loads `.glb` files into cached
  `AssetContainer`s from `./assets/models/` and instantiates them with
  shared geometry and materials, cloned skeletons and animation groups
  (`assets.js:184-232`).
- `main.js:250-256` preloads `window.DUNGEON_ASSET_MANIFEST` if it is
  defined before `main.js` runs. Nothing defines it today; `index.html`
  would need a `<script>` block or a `manifest.js`.
- `entities.js:1073-1113` looks up the key `entity:<type>` (for example
  `entity:imp`), hides the procedural body, reparents the model under the
  entity root and keeps the animation groups.
- `entities.js:1115-1131` maps simulation states to clip names by
  substring: `idle|stand`, `walk|run`, `work|mine|dig`, `carry`,
  `attack|strike|shoot|cast`, `hit|damage`, `death|die`. Clips named that
  way play automatically.
- Failed or missing assets fall back to the procedural body, so models can
  be added one creature at a time.

Two things to fix before the first real model: `_applyAssetResult`
reparents `rootNodes` directly under the entity, orphaning the wrapper node
that `instantiate()` created; and `instantiate()` autoplays the first
animation group before the state-based selection runs. Both are small.

### 10.2 Authoring conventions (put these in `assets/README.md`)

- Units: 1 tile = 1 unit. Imp about 0.9 units tall, Bile Demon 1.6, Knight
  1.4. Pivot at the feet on the floor. Forward is +Z (heading is computed
  as `atan2(dx, dz)` in `entities.js:834`). Y up.
- Budget: 3–8k triangles per creature, one 1024² or 2048² atlas with
  albedo, normal and metal/roughness (ORM) maps. PBR metal/rough, no
  specular-gloss.
- Clips: `idle`, `walk`, `attack`, `hit`, `death`, plus `dig` and `carry`
  for the Imp and `cast` or `shoot` for ranged. Loop flags baked in.
- One GLB per creature, animations embedded, no external textures.
- Style: DK2 proportions. Oversized hands, heads and weapons; deep-set
  glowing eyes; readable at the default camera distance of ~34 units. A
  short style bible with three reference boards (Imp, Warlock, Knight) is
  worth doing before any modelling.

### 10.3 Ways to get the models, in order of cost

1. **CC0 and permissive packs, restyled.** Quaternius (CC0 rigged low-poly
   monster and character packs with shared animation libraries), KayKit by
   Kay Lousberg (CC0 dungeon, skeleton and adventurer packs, rigged and
   animated) and Kenney (CC0) give a complete, consistent, animated roster
   for free. They are low-poly stylised, not DK2's chunky sculpted look,
   but they are rigged, licensed and ready to drop into the manifest
   today. Retexturing and small mesh edits in Blender move them a long way
   toward DK2. Record attribution in `assets/LICENSES.md` even for CC0.
2. **Mixamo for animation.** Any humanoid mesh can be auto-rigged and given
   idle, walk, attack, hit and death clips from Mixamo's library for free
   (Adobe account). This solves animation for options 3 and 4. Export FBX,
   retarget or merge clips in Blender, export GLB with the clip names above.
3. **AI-generated 3D, cleaned up.** Text- or image-to-3D services (Meshy,
   Tripo, Rodin, Luma) produce textured meshes from a concept image in
   minutes, and several include auto-rigging and stock animations. Quality
   is uneven: topology is noisy, textures are baked lighting, and output
   needs decimation and a Mixamo pass. It is the fastest route to a
   concept-accurate DK2 silhouette. Check each service's commercial licence
   tier. The image skills available in this workspace can produce the
   concept sheets that feed this route.
4. **Commissioned or hand-modelled.** A Blender sculpt → retopology →
   bake → rig → Mixamo → GLB pipeline gives the best result and full
   licence control at the highest cost. Sensible for the hero cast (Imp,
   Warlock, Bile Demon, Knight) once the loop is proven, with option 1 or 3
   filling the rest of the roster.

Recommended sequence: option 1 now for the whole roster so the game reads
as a game; option 3 or 4 for the Imp first, because the player looks at
Imps more than anything else; then the rest in visible-impact order.

### 10.4 Rendering budget once models arrive

- Each skinned creature is one or two draw calls instead of ~30, so a
  full roster is cheaper than the current primitives.
- For crowds (40+ units) Babylon's baked vertex animation textures
  (`BakedVertexAnimationManager`) let instances share one skinned mesh
  while animating independently. Not needed for the first milestone.
- Two LOD levels per creature (full, and ~1k triangles) cover the zoomed-out
  camera.
- Shadows: register only the body mesh as a caster, not weapons and
  accessories.

## 11. Defect list

Severity: **S1** blocks the game loop; **S2** wrong behaviour the player sees;
**S3** code quality or drift.

| # | Sev | Location | Defect |
| --- | --- | --- | --- |
| 1 | S1 | `ui.js:522`, `main.js:69`, `main.js:687` | Pause screen is shown over the start screen on load; mouse and touch cannot start a game. |
| 2 | S1 | `input.js:875-877`, `world.js:680-712` | Dig, claim and reinforce apply instantly on paint; Imps are bypassed. |
| 3 | S1 | `world.js:571`, `main.js:329-331` | Portal spawns nothing; starting creatures are placed for free. |
| 4 | S1 | `entities.js` (no references to any room) | Rooms have no gameplay effect. |
| 5 | S1 | `main.js:547-563` | No victory condition; waves are infinite. |
| 6 | S1 | `input.js:908` | Mined gold is credited instantly and in full; Treasuries are unused. |
| 7 | S2 | `ui.js:12`, `input.js:49` | "Hand of Evil" is select only; the hint promises pickup and drop. |
| 8 | S2 | `ui.js:10-44` | Prison, Torture, Temple and Reinforce have no palette entry. |
| 9 | S2 | `entities.js:1039-1060` | Heroes spawn inside the player's own tunnels. |
| 10 | S2 | `main.js:506-514` | Research target is auto-chosen; the player cannot direct it. |
| 11 | S2 | `magic.js:36` | Seven spells unlocked at start, including Lightning and Call to Arms. |
| 12 | S2 | `world.js:680-682` | All rock is diggable; maps have no shape. |
| 13 | S2 | `world.js:729` | Rooms can be built on unclaimed earth. |
| 14 | S2 | `input.js:749-753` | Escape with a spell selected but nothing under the cursor opens the pause menu. |
| 15 | S2 | `input.js:1278-1282` | Tile-command failure messages go to methods that do not exist; the player gets no feedback. |
| 16 | S2 | `defenses.js:457-476`, `navigation.js` | Pathfinding ignores doors; entities are snapped back each frame instead of routing. |
| 17 | S2 | `core.js:70-94` | Outdoor lighting model for a dungeon. |
| 18 | S3 | `world.js:38`, `input.js:22`, `ui.js:14` | Room costs defined three times with two value sets. |
| 19 | S3 | `magic.js:46-87`, `defenses.js:39-76`, `persistence.js:363` | Status-modifier logic copy-pasted three times. |
| 20 | S3 | `core.js:5` | Live client imports the dead legacy `constants.js`. |
| 21 | S3 | `core.js:227-233`, `environment.js:52-58` | Fog and clear colour set in two places with different values. |
| 22 | S3 | `main.js:472,474` | Spatial index synced twice per frame. |
| 23 | S3 | `world.js:138-142` | 4,096 property accessors to alias `roomType` to `room`. |
| 24 | S3 | `entities.js:975-1028` | Unreachable fallback BFS duplicating `navigation.js`. |
| 25 | S3 | `main.js:319`, `main.js:359` | `_seed(testing)` parameter is dead; testing spawns are duplicated in `start()`. |
| 26 | S3 | `README.md`, `AGENTS.md`, `CLAUDE.md`, `BABYLON_MIGRATION.md` | Reference a deleted file; describe the wrong client; claim tests that do not exist. |
| 27 | S3 | `tests/` | No coverage of entities, world, economy, waves, magic, input or UI. |
