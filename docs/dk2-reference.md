# Dungeon Keeper 2 mechanics reference

Factual baseline for implementing **Dungeon Keeper 2** (Bullfrog / EA, 1999)
mechanics. Reference, not plan; the plan is `REVIEW.md` §9 and `ROADMAP.md`.

## Sourcing and confidence

`WebFetch` is blocked by the egress proxy for every host tried
(`dungeonkeeper2.gamecoyote.com`, `dungeonkeeper.fandom.com`, `archive.org`
manual/guide full text, `gamefaqs.gamespot.com`, `the-spoiler.com`,
`strategywiki.org`, `keeperklan.com`, `dk.youfailit.net`, `therealm.f9.co.uk`,
`neoseeker.com`, `en.wikipedia.org`, `retrogamer.biz`). Only `WebSearch`
worked, so figures below come from search extracts, not primary pages.

Every figure carries a marker:

| Marker | Meaning |
| --- | --- |
| **[S]** | Confirmed this session from search extracts of the DK wiki / DK2 resource guide / guides. |
| **[M]** | From knowledge of the game, not re-verified this session. Treat as correct in *kind*, checkable in *value*. |
| **(approx.)** | Value is uncertain. Do **not** hard-code it as if authoritative; put it in a data table with a comment. |
| **(unknown)** | Could not be established. Needs a pass over the DK2 `.kwd`/editor data or the manual before it is used. |

Authoritative balance data lives in DK2's own `.kwd` level/global archives
(documented in the *DK2 Official Editor Manual*). Reconcile against those when
network access allows — not against fan tables.

---

## 1. Tiles and digging

| Tile | Diggable | Claimable | Yields | Notes |
| --- | --- | --- | --- | --- |
| Impenetrable rock | No | No | — | Map skeleton and outer border. Distinct art from earth. **[M]** |
| Earth | Yes | Floor after digging | Nothing | The default excavation material. **[M]** |
| Gold seam | Yes | Becomes floor when exhausted | Finite gold per tile (unknown) | Imps mine it in increments and carry each load to a Treasury. **[M]** |
| Gem seam | Yes, never exhausts | **Neither claimable nor fortifiable** **[S]** | 25 gold per dig **[S]**, infinite | Mines slower than gold **[S]**. Multiple Imps can mine the same seam from different sides for parallel income **[S]**. |
| Unclaimed floor | — | Yes (Imp claims) | — | Claiming spreads only from tiles adjacent to already-owned ground **[M]** |
| Claimed floor | — | Enemy Imps can re-claim | 1 mana/turn **[S]** | The mana engine of the game. |
| Fortified (reinforced) wall | Only by enemies, slowly | Owned by definition | — | Created **automatically by Imps** on any wall face adjacent to your claimed floor — the player does not order it **[M]**. Some terrain (gem seams) can never be fortified **[S]**. |
| Water | No | No | — | Slows most creatures, some cannot cross; crossed with a Wooden Bridge **[M]** |
| Lava | No | No | — | Damages/kills non-immune creatures; crossed with a Stone Bridge **[M]**. Salamanders are lava-tolerant (approx.) |
| Bridge | — | Player-built room-type tile | — | Wooden Bridge 200 gold/tile **[S]**; Stone Bridge ~500 gold/tile (approx.). Wooden bridges are destructible; the stone one is the lava-safe tier **[M]** |
| Door | — | Occupies a claimed floor tile in a 1-wide gap | — | Manufactured in the Workshop, carried and installed by an Imp; locked/unlocked by the player; enemies must break it **[M]** |

Dig behaviour: the player *marks* tiles; Imps walk to a marked tile adjacent to
walkable ground and mine over time. Per-tile dig durations are (unknown) —
they vary by material and by number of Imps working the same face. Multiple
Imps on one block dig it faster **[M]**.

---

## 2. Rooms

Rooms are painted on claimed floor; cost is **per tile**, charged as each tile is
built, and selling refunds a fraction (50 %, approx.). Rooms function as
connected areas: many effects scale with area, and attraction thresholds are
stated as square footprints (3×3, 5×5).

| Room | Cost/tile | Min useful size | What it does | Primary users |
| --- | --- | --- | --- | --- |
| Treasury | 200 **[S]** | 1 tile (grow early) | Stores gold; capacity ≈ 3000/tile **[S]** (approx. — sources conflict with 2000). Creatures collect wages here at payday. The Dungeon Heart itself holds up to ~16 000 **[S]** | Imps deposit; all creatures withdraw |
| Lair | 300 **[S]** | 1 tile per creature, more for big ones | Creatures claim a personal lair tile, sleep, and heal there. No lair space = unhappiness | All creatures except Imps |
| Hatchery | 300 **[S]** | 3×3; 5×5 to attract Bile Demons **[S]** | Grows chickens; creatures eat here to clear hunger and heal a little | All creatures |
| Training Room | 500 **[S]** | 3×3 | Creatures spend gold to gain experience; XP rate scales with room size and creature level **[M]** | Melee/most creatures |
| Library | ~600 (approx.) | 3×3 (attracts Warlocks **[S]**) | Research: unlocks Keeper spells and some rooms, at a rate driven by researchers present and desks available | Warlocks primarily |
| Workshop | ~600 (approx.) | 3×3 (attracts Trolls, approx.) | Manufactures doors and traps; output rate scales with workers and workshop size | Trolls, Bile Demons **[S]** |
| Guard Room | 600 **[S]** | 3×3 | Creatures dropped here take guard posts and hold position; a defensive staging room | Goblins, Dark Elves (approx.) |
| Prison | 750 **[S]** | 3×3 | Holds knocked-out enemies. Left to starve, prisoners rise as **Skeletons** **[S]** | Captured heroes/enemy creatures |
| Torture Chamber | ~1000 (approx.) | 1×3 is enough to attract a Dark Mistress **[S]** | Converts heroes, rebels and enemy creatures to your side **[S]**. Torturing your *own* creature makes others of that type work ~25 % faster at half pay, but angers them if prolonged **[S]** | Dark Mistress operates it |
| Temple | 3000 **[S]** | 5×5 to attract Dark Angels **[S]** (2 per temple **[S]**) | Creatures pray to restore happiness; sacrificing creatures into the pool yields effects/bonuses depending on the combination **[M]** | All; Dark Angels attracted |
| Graveyard | 2000 **[S]** | 3×3 (approx.) | Imps carry corpses here; enough corpses spawn a **Vampire** **[S]** | Imps deliver; Vampires spawn |
| Casino | 750 **[S]** | 3×3 (approx.) | Creatures gamble wages; wins/losses move gold, raises happiness. Attracts Rogues (approx.) | All; Rogues attracted |
| Combat Pit | 750 **[S]** | 3×3 (attracts Black Knights **[S]**) | Creatures spar for experience and happiness; spectators gain mood | Melee creatures |
| Wooden Bridge | 200 **[S]** | — | Crosses water | — |
| Stone Bridge | ~500 (approx.) | — | Crosses lava | — |

Key structural rules to implement:

- A room is a **connected component** of same-type tiles; size tiers matter for
  both attraction (3×3 / 5×5 thresholds **[S]**) and throughput **[M]**.
- Attraction is a function of *rooms owned and their size*, not of a timer.
- Rooms are destroyed tile-by-tile by enemies; losing tiles evicts the
  creatures assigned to them **[M]**.

---

## 3. Creatures

DK2's roster is Imp plus ~14 attractable/created creatures. Level-1 numeric
stats (HP, damage, wage) are **(unknown)** from the sources reachable here; the
correct move is to read them out of the DK2 data files rather than guess. What
is reliable is role, attraction and behaviour.

| Creature | Role | Attracted by | Notes / abilities |
| --- | --- | --- | --- |
| Imp | Worker | Not attracted — **Create Imp** spell | No food/sleep needs; costs 7 mana per turn upkeep **[S]** |
| Fly (Firefly) | Scout | Lair (approx.) | Fast, flying, weak; good for exploring **[M]** |
| Goblin | Cheap melee | Lair + Hatchery **[S]** | The early-game body. Dislikes Dark Elves (approx.) |
| Troll | Manufacturer / melee | Workshop (approx. 3×3) | Best trap/door manufacturing rate **[M]** |
| Bile Demon | Tank / manufacturer | Hatchery 5×5 **and** Workshop 3×3 **[S]** | Huge appetite; occupies multiple lair tiles; farts poison gas **[M]** |
| Warlock | Ranged caster / researcher | Library 3×3 **[S]** | Primary researcher; ranged bolts; low HP **[M]** |
| Rogue | Thief / fast melee | Casino (approx.) | Steals gold; fast, fragile **[M]** |
| Dark Elf | Ranged archer | Guard Room (approx.); sources also mention lair/hatchery near lava **[S, contradictory]** | Sniper-type ranged damage **[M]** |
| Salamander | Ranged fire | Lava-adjacent rooms (approx.) | Fire attack, lava-tolerant (approx.) |
| Dark Mistress | Elite melee | Torture Chamber, as small as 1×3 **[S]** | Operates the torture chamber; *likes* being slapped **[M]** |
| Black Knight | Elite melee | Combat Pit 3×3 **[S]** | Top-tier fighter **[M]** |
| Skeleton | Undead melee | Not attracted — prisoner starves in the **Prison** **[S]** | No pay, no hunger (approx.) |
| Vampire | Undead caster/melee | Not attracted — spawns from corpses in the **Graveyard** **[S]** | Life-drain; regenerates by resurrecting **[M]** |
| Dark Angel | Elite flyer | Temple 5×5, **2 per temple** **[S]** | Late-game elite; some patched versions set the attraction limit to 0 **[S]** |
| Maiden of the Nest | Elite | Level/script-specific (approx.) | Elite unit, not part of normal attraction **[M]** |
| Horned Reaper ("Horny") | Summoned boss | Temple sacrifice combination (approx.) | Devastating, uncontrollable when angry **[M]** |

Per-level progression: creatures level 1→10; each level raises HP, damage and
adds/upgrades abilities; possession exposes a melee attack plus up to three
selectable spells and primary/secondary abilities (the DK2 possession keys are
`1` melee, `2`–`4` spells, `5` primary, `6` secondary **[S]**).

Wages: paid in gold at payday, scaling with creature level **[M]**; per-species
base wages are (unknown). Likes/dislikes exist per species pair and shift mood
when disliked species share rooms **[M]**.

Idle behaviour: creatures wander their favourite room, eat, sleep, train,
gamble, spar, or brawl if angry **[M]**.

---

## 4. Needs and mood

| Need | DK2 behaviour | Value |
| --- | --- | --- |
| Hunger | Creature walks to a Hatchery and eats a chicken; heals slightly. Bile Demons eat far more | Rate (unknown) |
| Sleep | Creature returns to its **own** lair tile, sleeps, regenerates HP. No free lair tile → unhappiness | Rate (unknown) |
| Pay | At payday every creature walks to a Treasury (or the Dungeon Heart) and takes its wage | ~8 minutes (approx.) **[S, may be a DK1 figure]** |
| Unpaid | Creature becomes angry; angry creatures brawl, steal from the Treasury/Casino, destroy rooms, or leave through a portal **[M]** | — |
| Happiness | Raised by: pay, food, sleeping in own lair, praying in the Temple, Casino wins, Combat Pit sparring. Lowered by: no pay, no food, no lair, being slapped, disliked neighbours, prolonged torture of kin **[S/M]** | — |
| Anger outcomes | Brawls between creatures; sabotage; desertion via the portal; the Horned Reaper goes berserk **[M]** | — |
| Slapping | Right-click slap: speeds a creature's work, costs HP, lowers happiness. Repeated slapping can kill **[S]** | Damage per slap (unknown) |
| Imprisonment | Enemies knocked to 0 HP near your dungeon can be dragged by Imps to the Prison. Left there they starve and rise as **Skeletons** **[S]** | Starve time (unknown) |
| Torture | Torture Chamber converts heroes / enemy creatures to your side **[S]**. Torturing your own creature: +25 % speed and half pay for that species, anger if prolonged **[S]** | Convert time (unknown) |

---

## 5. Imps

Imps are not creatures in the needs sense: no hunger, no sleep, no wage. They
cost **mana upkeep — 7 mana per Imp per turn [S]**, so Imp count directly
throttles spellcasting.

Job list, roughly in the order DK2 Imps resolve them **[M]**:

1. Flee if attacked and badly hurt (Imps are cowards).
2. Mine tiles the player has marked for digging.
3. Claim unclaimed floor adjacent to owned ground.
4. Fortify (reinforce) wall faces adjacent to owned floor — automatic.
5. Carry mined gold to a Treasury; carry loose gold off the floor.
6. Deliver manufactured doors/traps from the Workshop to their blueprint.
7. Drag unconscious enemies to the Prison; drag corpses to the Graveyard.
8. Repair damaged walls/rooms.
9. Idle: wander claimed territory.

Starting Imps: level-dependent, typically a handful (4–8, approx.).
**Create Imp** cost scales: reported as starting at **1500 mana and +1500 per
additional Imp [S]** — treat the exact base as (approx.) but the *escalating*
shape as correct.

---

## 6. Economy

| Flow | Detail |
| --- | --- |
| Gold in | Gold seams (finite, unknown per-tile value), gem seams (25/dig, infinite **[S]**), loose gold on the floor, plundering enemy treasuries, level-authored gold piles, Casino losses of your own creatures cycling back **[M]** |
| Gold out | Room construction per tile; Training Room fees; creature wages at payday; Workshop manufacture; Temple/Casino sinks **[M]** |
| Gold storage | Treasury ≈ 3000/tile **[S]** (approx.); Dungeon Heart ≈ 16 000 **[S]**. Gold with nowhere to go is dropped on the floor **[M]** |
| Mana in | **1 mana per claimed tile per turn, capped at 500/turn; the Dungeon Heart itself adds ~30/turn [S]** |
| Mana out | Imp upkeep 7/Imp/turn **[S]**; every Keeper spell cast |
| Research | Generated by creatures working Library desks (Warlocks best); unlocks spells and some rooms in a fixed per-level order **[M]**. Points-per-second values (unknown) |
| Manufacture | Generated by creatures working Workshop anvils (Trolls best, Bile Demons also **[S]**); converted into the queued door/trap, which then costs its gold price **[M]** |

Design consequence the repo currently misses: **mana is a territory tax**.
Claim → mana → spells → more claiming, minus Imp upkeep, is DK2's economic spine.

---

## 7. Keeper spells

DK2 spells are cast from the panel, cost mana, and most are unlocked by Library
research in a per-level fixed order. Verified mana costs are marked; the rest
are (unknown) and must not be invented.

| Spell | Mana | Effect | Notes |
| --- | --- | --- | --- |
| Create Imp | 1500, +1500 per Imp **[S]** (approx. base) | Spawns an Imp | Available from the start in most levels **[S]** |
| Possession | (unknown) | Enter a creature in first person until dismissed | Channel, not instant **[M]** |
| Sight of Evil | **5000 [S]** | Reveals an area of the map for a duration | Duration (unknown) |
| Call to Arms | **10 000; 7000 upgraded [S]** | Drops a rally flag; creatures converge and fight there | Drains while active **[M]** |
| Heal Creature | (unknown) | Restores HP to a creature/area | — |
| Speed Creature (Haste) | (unknown) | Movement/attack speed buff for a duration | — |
| Lightning / Thunderbolt | **6000 [S]** | Direct damage bolt at a point | — |
| Freeze | (unknown) | Immobilises targets; frozen units shatter for bonus damage **[M]** | — |
| Turncoat | (unknown) | Converts an enemy creature to your side temporarily/permanently **[M]** | DK2 addition |
| Inferno | (unknown) | Sustained area fire damage **[M]** | DK2 addition |
| Chicken | **10 000 [S]** | Turns an enemy creature into a chicken | — |
| Must Obey | (unknown) | Forces all creatures to work; drains happiness **[M]** | Toggle |
| Create Gold | (unknown) | Converts mana into gold **[M]** | — |
| Destroy Walls | (unknown) | Removes fortified walls in an area **[M]** | — |
| Armageddon | (unknown) | Teleports every creature on the map to the caster's Heart for a final battle **[M]** | Level-ending |

Research order is per-level script data, not a global constant **[M]**.

---

## 8. Workshop: doors and traps

Doors and traps are *manufactured* (workshop points) and then *paid for* in gold,
then carried to the placement blueprint by an Imp **[S]**.

| Door | Gold | Durability | Effect |
| --- | --- | --- | --- |
| Wooden Door | 500 **[S]** | Lowest **[S]** | Blocks enemies; locking it makes it a barrier for your own creatures too **[M]** |
| Braced Door | 1000 **[S]** | ~2× Wooden **[S]** | — |
| Steel Door | 1500 **[S]** | Highest raw HP **[S]** | — |
| Magic Door | 6000 **[S]** | Slightly below Steel **[S]** | **88 % damage reduction against all non-magical damage [S]**; retaliates against attackers **[M]** |
| Barricade | (unknown) | (unknown) | Cheap impassable filler (approx., verify it exists in DK2) |

| Trap | Gold | Effect |
| --- | --- | --- |
| Trigger | 300 **[S]** | Fires other traps remotely when something crosses it |
| Alarm | 500 **[S]** | Raises the alarm, calls creatures to the intrusion |
| Gas | 600 **[S]** | Poison cloud, damage over time |
| Boulder | 1500 **[S]** | Rolls down a corridor crushing units; the classic DK trap |
| Sentry | (unknown) | Auto-turret firing bolts at enemies in range |
| Fear | (unknown) | Routs enemies away from the trap |
| Freeze | (unknown) | Immobilises enemies in its area |
| Lightning | (unknown) | Chained electrical damage |
| Spike | (unknown) | Floor spikes, single-target burst |
| Fireburst | (unknown) | Fire burst; listed among DK2 traps in sources **[S, name only]** |

Traps other than the Boulder and Sentry **start concealed from enemy eyes**
(Alarm, Trigger, Gas, Spike, Freeze, Fireburst are explicitly listed as
concealed **[S]**). Traps have limited charges/HP and are repaired or rebuilt by
Imps **[M]**.

---

## 9. Heroes and threats

| Hero | Role |
| --- | --- |
| Dwarf | Hero counterpart of the Imp: mines and claims, but also fights **[S]** |
| Thief | Steals loose gold and raids treasuries **[S]** |
| Guard | Lance foot-soldier; weak alone, strong as a blocking wall **[S]** |
| Archer / Elven Archer | Ranged damage from behind the line **[M]** |
| Monk | Support/healer, holy damage **[M]** |
| Wizard | Hero counterpart of the Warlock; elemental ranged blasts **[S]** |
| Fairy | Fast flying caster **[M]** |
| Giant | Heavy melee bruiser **[M]** |
| Knight | Elite melee, party leader **[M]** |
| Royal Guard | Elite escort for the Lord/King **[M]** |
| Lord of the Land | Level boss; killing him is a common victory condition **[M]** |
| King / Avatar-tier | Final-campaign boss variant (approx.) |

Threat sources:

- **Hero Gates** — permanent map features that emit hero parties on a schedule
  or on a script trigger **[M]**.
- **Level script** — DK2 levels are scripted: parties of a named composition
  spawn at named points on timers, on objectives completed, or on the player
  crossing a trigger area **[M]**. Waves are authored, not procedural.
- **Rival Keepers** — AI keepers with their own Dungeon Heart, Imps, rooms and
  creatures; they dig toward you and can be destroyed by killing their Heart
  **[M]**.
- **Neutral creatures / mercenaries** — creatures sitting in unclaimed neutral
  rooms or prisons who join you when you claim the area or free them **[M]**.

---

## 10. Levels, win conditions, modes

- **Campaign: 20 levels [S].** Each introduces new rooms, creatures, spells and
  traps **[S]**. Typical objective: defeat a Lord/hero force or a rival Keeper
  to claim the level's **portal gem**; collecting all twenty opens the way to
  the surface **[S]**.
- **Loss condition:** destruction of your Dungeon Heart **[M]**.
- **Level-authored variety:** some levels are pure defence, some are timed, some
  restrict which rooms/spells are available **[S/M]**.
- **My Pet Dungeon [S]:** sandbox mode. Each level has a **point total** goal
  plus **two special tasks** worth most of the points; you start with Lair and
  Hatchery only and unlock the rest over time — except level 6, "Masterpiece",
  where everything is available immediately **[S]**.
- **Skirmish / multiplayer:** up to 4 keepers on shared maps **[M]**.

---

## 11. Camera, hand and controls

- **Hand of Evil [S]:** the cursor *is* the hand. Left-click picks up a
  creature/object; right-click drops it **[S]**. Dropping a creature into a room
  assigns it to work there **[S]**. Right-clicking a creature you are not holding
  **slaps** it **[M]**. The hand also picks up and drops gold, and picking up a
  creature interrupts whatever it was doing.
- **Drop rules:** you may only drop on your own claimed territory (and into the
  Dungeon Heart, which converts Imps into mana **[S]**). Dropping a creature on a
  claimed portal dismisses it from the dungeon **[M]**.
- **Possession [S]:** first-person control of any of your creatures, FPS-style.
  Keys: `1` melee, `2`/`3`/`4` creature spells, `5` primary ability,
  `6` secondary ability, `7` group select, space to fire, `R` creep,
  `Shift+R` run, `Ins` sniper toggle, numpad `0` to pick locks/disarm/jailbreak
  **[S]**.
- **Camera:** free 3D — pan, rotate, tilt and zoom, plus screen-edge scrolling
  and a mini-map jump. The camera can go from near-top-down strategic to a low
  angle at floor level, which is what sells the dungeon as a place **[M]**.

---

## Delta to this repository

`index.html` loads `src/babylon/`; `src/*.js` is the previous Three.js client,
no longer loaded. Citations are to `REVIEW.md`.

| Area | Babylon client (`src/babylon/`) | Legacy client (`src/*.js`) | Closest faithful implementation |
| --- | --- | --- | --- |
| 1. Tiles / digging | Instant paint: `world.dig()`/`world.claim()` fire on cursor drag; all rock is diggable; `reinforce` converts *any* tile to wall (REVIEW §4) | Real tile types, `T_ROCK` vs earth, jobs for dig/claim/claim_wall/reinforce (REVIEW §4, §6) | Marking only queues jobs. Add impenetrable rock, gold seams with finite value, one gem seam per map, automatic Imp fortification of owned wall faces, water/lava with bridges. |
| 2. Rooms | Room ids exist in `world.js:26-36`, three have no UI button, rooms are per-tile tags with no component/size logic and no effects (REVIEW §4, §5.2) | Connected components, centroid props, size tiers, 9 room types with real effects (REVIEW §6) | Port `rebuildRoomAround` semantics into a renderer-independent model; one `data/rooms` table with cost/tile, min size, effect, attraction gate — consumed by world, input and UI (REVIEW §9 Phase 0). |
| 3. Creatures | Three creatures placed free at boot; `_unitView` hardcodes `level: 1`; portal is decorative (REVIEW §4) | 10 species with hp/atk/range/speed, favourite room, room-gated spawn weights, level-3 secondary moves, affinity table (REVIEW §6) | Port the species table, then extend toward the DK2 roster (§3 above) with attraction as a function of rooms owned and their size — not a spawn timer. |
| 4. Needs / mood | None: no hunger, sleep, pay, mood, brawls or desertion (REVIEW §4) | Hunger 60 s, sleep 90 s, chickens per tile, wages 8×level/90 s *plus* a 180 s payday (two overlapping systems — a known legacy bug), desertion below 0.20 happiness for 18 s (REVIEW §6) | Port the needs, but collapse to **one** payday. Add Temple prayer, Casino and Combat Pit as happiness sources; anger outcomes = brawl, sabotage, desert via portal. |
| 5. Imps | `assignWork` exists but nothing calls it; Imps only flee/wander and deliver workshop crates (REVIEW §4, §5.3) | Dig, claim, reinforce, carry gold, flee, on a nearest-job queue (REVIEW §6) | Full priority list from §5 above, including corpse-to-Graveyard and body-to-Prison hauling. Add the 7 mana/Imp/turn upkeep so Imp count trades against spells. |
| 6. Economy | Full vein value added to `state.gold` at paint time; Treasury tiles inert; research accrues from library *tile count* with no creature (REVIEW §4) | Treasury 300/tile with capacity, carried gold, Warlock research 0.6/s, Troll manufacture 0.8/s (REVIEW §6) | Gold must travel: mine → carry → Treasury (capacity per tile, overflow drops on the floor). Mana = claimed tiles (capped) minus Imp upkeep. Research and manufacture generated by *creatures at desks/anvils*, not by tiles. |
| 7. Spells | 14 spells with mana, cooldowns, prerequisites and refunds — the best data model in the rewrite (REVIEW §5.5, §8) | 7 spells, all but Create Imp behind Library research with a player-chosen target (REVIEW §6) | Keep the Babylon spell model; restore **player-chosen** research targets, add the escalating Create Imp cost, and align the roster with §7. |
| 8. Workshop / doors / traps | Complete and well structured (`defenses.js`, `workshop.js`); crate → Imp delivery works; pathfinding is door-blind, so heroes stall at doors instead of routing (REVIEW §4, §5.5, §8) | Simpler doors and traps (REVIEW §6) | Keep it. Add door-aware pathfinding (REVIEW §9 Phase 2), the 4-door tier costs from §8, Magic Door damage reduction, and concealed-until-triggered traps. |
| 9. Heroes | Heroes teleport onto the farthest discovered walkable tile from the Heart — at boot, the end of the player's own tunnel (REVIEW §4) | Five authored hero compounds with garrisons that activate when their last wall is breached; Knight Commander boss (REVIEW §6) | Authored **hero gates** plus scripted party tables per level; hero AI targeting doors, rooms, creatures and the Heart by priority (REVIEW §9 Phase 1.7). Add rival Keepers later. |
| 10. Levels / win | Infinite waves every 22–42 s; `_endGame(true)` is never called, so victory is unreachable (REVIEW §4, §5) | Timed waves already dead (`nextWaveAt = Infinity`); killing the boss wins (REVIEW §6) | A level definition file: map, starting rooms/spells, script triggers, objective, victory and defeat. Then a short campaign and an MPD-style sandbox with point goals. |
| 11. Hand / camera / possession | Possession is the best-realised DK2 feature (pointer lock, per-creature abilities); the "Hand of Evil" button is an alias for `select` with no pickup, drop or slap (REVIEW §4, §8) | Pickup/drop/slap for Imps, creatures and prisoners; drop on a claimed portal to dismiss; slap = 2 dmg, +50 % speed 10 s, +0.12 anger (REVIEW §6) | Port the hand verbatim and bind it to DK2's buttons: left-click grab, right-click drop, right-click on an unheld creature to slap. Drop-in-room = assign to that room's work. |
| Presentation | Violet diamond in a void, creatures ~20 px, HUD ≈ ⅓ of the viewport, rooms and spells split across tabs (REVIEW §8) | — | Torchlit palette: black rock, ochre earth, warm pools, Heart glow by HP; one icon strip with tooltips; every room and spell visible at once, because comparing them is the game (REVIEW §8, §9 Phase 2). |

**Highest-leverage gap:** the DK2 loop is *claim → mana → spells → creatures →
needs → defence*, and the repository currently implements none of the arrows.
REVIEW §9 Phase 1 is the right order; §1–§6 of this document supply the rules
and the shape of the numbers for it.
