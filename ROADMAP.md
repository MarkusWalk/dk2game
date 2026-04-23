# Roadmap — DK2 Fidelity Push

The north star is **Dungeon Keeper 2**: creatures with personality, a dungeon full of specialized rooms that interact, dark torchlit atmosphere with oppressive visual identity, and the iconic "hand of evil" possession loop. Today's POC is ~5 % of that. This roadmap sequences the climb.

Each category has the same shape:

- **DK2 touchstone** — what the reference game did that we're chasing
- **Today** — what dkgame actually does right now
- **Gap** — the delta in plain English
- **Upgrades** — tiered **S** (≤1 session) / **M** (2–4) / **L** (needs design iteration)
- **Next** — the first 3 concrete steps

---

## 1. Creature intelligence & behavior

**DK2 touchstone.** Every creature had a personality. They got angry when unpaid, happy when pampered, picked fights in the lair, deserted when furious, refused to work for certain other creatures, and had favorite rooms they'd drift to on idle. You watched the dungeon live, not micromanaged it.

**Today.** Flies have a 2-state need system (hunger, sleep) with binary "critical → seek room." No pay, no anger, no social behavior, no personality, no desertion. One creature type means no social dynamics at all.

**Gap.** The biggest single feature delta in the game. Creatures don't feel alive.

**Upgrades.**

- **S** — **Pay demand.** Every creature ticks a `paySince` timer; at 90 s, they walk to Treasury and take their due (5–25 g depending on level). Empty treasury → `anger += 0.2`. Hook into existing treasury code.
- **S** — **Happiness scalar** (0–1) derived from needs + pay + lair-size adequacy + recent fights. Displayed as a face icon on creature sprite.
- **S** — **Fight-in-lair.** Two angry creatures adjacent in the lair roll a 5 %/sec chance to brawl (non-lethal; 30 % HP cap). Slap to break it up.
- **M** — **Per-species personality weights.** Fly = skittish (flees low HP), Beetle = stoic (never retreats), Warlock = arrogant (won't train with lower levels). Drives idle behavior and lair preferences.
- **M** — **Desires system.** Each creature has a rolling "wish" (wants to train, wants a bigger lair, wants to gamble). Fulfilling raises happiness hard.
- **M** — **Desertion.** Happiness < 0.15 for 60 s → creature walks to nearest portal and leaves. Irreversible during that run.
- **M** — **Affinity matrix.** Species A and B like/dislike each other. Dislike pairs in the same room gain anger faster. Creates deliberate composition puzzles.
- **L** — **Emergent rumor AI.** Creatures propagate "information" — if one sees a hero, neighbors in the lair know 10 s later. Enables reinforcement signals without global omniscience.

**Next.** (1) Pay demand + treasury raid; (2) Happiness scalar with face icon; (3) Fight-in-lair brawls.

## 2. Training & progression

**DK2 touchstone.** Training Room (spar with dummies), Combat Pit (spar with each other, risk injury), Library (warlocks grind research), Temple (pray for mana). XP had purpose because creatures could level during downtime, not only in combat.

**Today.** XP only from kills (creatures) or work (imps). Levels 1–5 for creatures, 1–4 for imps. No room gives XP passively.

**Gap.** Downtime between waves is dead. No way to pre-train a fresh fly before wave 10.

**Upgrades.**

- **S** — **Training Room** (new). Claimed floor + `designateTile(T, 'training')`. Creatures use a training dummy prop; +1 XP/sec, +2×/sec on a Large (9+ tile) training room.
- **S** — **XP cost escalation.** Currently near-linear; switch to `xp_to_next = base * 1.6^level` so training late-game levels takes real time.
- **M** — **Combat Pit.** Two creatures spar in melee. 3× training speed but both risk injury (to 20 % HP). Adrenaline-themed — for advanced players.
- **M** — **Library.** Warlocks-only room. Generates *research points* instead of XP. Research unlocks spells / room upgrades.
- **M** — **Per-class XP paths.** Flies gain XP faster from training, Beetles from combat. Nudges team composition.
- **M** — **Creature perks on level.** Each level-up offers 1-of-2 perks ("Hardy" +20 % HP vs. "Vicious" +15 % atk). Bakery not a treadmill.
- **L** — **Mentor bonus.** A level-10 creature in the same training room boosts everyone's gain rate by 25 %.

**Next.** (1) Training Room + dummy prop; (2) XP escalation curve; (3) Perks on level-up.

## 3. Creature roster

**DK2 touchstone.** ~20 creatures. Each had a role, a preferred room, a counter, and a personality. Imp/Fly/Goblin/Troll/Warlock/Bile Demon/Mistress/Black Knight/Vampire/Skeleton/Salamander/Dark Elf/Rogue/Elite Orc/Maiden…

**Today.** 1 combat creature (Fly) + Imp worker. No roster.

**Gap.** Nothing to collect, nothing to combo, nothing to miss.

**Upgrades.** Each bullet is a species with role, counter, lair requirement, favorite room.

- **S** — **Beetle.** Tank. 60 HP, 3 atk, slow. Favorite: Lair. Unlocks at Portal tier 1.
- **S** — **Goblin.** Skirmisher. 22 HP, 5 atk, fast. Favorite: Casino (when built).
- **M** — **Warlock.** Ranged glass cannon. 24 HP, 7 atk, slow. Requires Library. Gains XP fastest from Library.
- **M** — **Troll.** Manufacturer. 40 HP, 4 atk. Required to operate Workshop (doors, traps).
- **M** — **Bile Demon.** Heavy. 100 HP, 8 atk, requires extra-large lair (3 tiles per Bile). Eats 3× food.
- **M** — **Skeleton.** Summoned from corpses in Graveyard. No pay demand. Bad AI (dumb). Cheap chaff.
- **L** — **Vampire.** Rare, converts from dead level-10 creatures in Graveyard. Strongest unit; heavy anger decay.
- **L** — **Mistress.** Signature DK2 unit. Whip-range melee, loves Torture Chamber, refuses to enter Library.

**Next.** (1) Beetle + Goblin to establish roster pattern; (2) Warlock + Library; (3) Troll + Workshop pipeline.

## 4. Rooms (expanded + interacting)

**DK2 touchstone.** 15+ room types, each with a distinct prop language. Rooms *did* things (Temple grants mana, Library generates research, Graveyard converts corpses to vampires). Size and contiguity mattered.

**Today.** 3 rooms (Treasury, Lair, Hatchery). Only Treasury is functional.

**Gap.** No reason to expand beyond the basics; no gameplay arc from room-building.

**Upgrades.** Each is a full-fledged room with props, mechanics, creatures that love it.

- **S** — **Size tiers.** Rooms of ≥9 contiguous tiles tagged "Large" (2× effect), ≥16 tagged "Grand" (3×). Already partially modelled by room entity centroid.
- **S** — **Training Room.** (see §2)
- **M** — **Library.** Research points + Warlock happiness. Props: bookshelves, candles, reading desks. Slow, quiet room.
- **M** — **Workshop.** Trolls produce Traps/Doors (see §5). Consumes gold over time. Props: anvil, forge glow, hammered metal floor.
- **M** — **Temple.** Sacrifice gold or creature → mana / spell cooldown reset. Props: statue of horned lord, altar. One per dungeon.
- **M** — **Prison.** Holds captured heroes. Heroes starve over 60 s → become Skeletons. Props: barred cells with hero sprites clinging to bars.
- **M** — **Torture Chamber.** Converts heroes (preferred) or punishes unhappy creatures. Output: loyal turncoat hero joins your side, OR creature happiness resets (-0.3 if forced). Props: rack, iron maiden.
- **M** — **Graveyard.** Corpses drop here; after 6 bodies, a Vampire rises. Props: gravestones, unholy mist.
- **M** — **Casino.** Creatures gamble their pay. Fun diversion; some go broke and stay angry longer. Props: roulette, dice tables, chandeliers.
- **M** — **Combat Pit.** (see §2)
- **L** — **Guard Room.** Creatures designate it as a patrol point; units idle here respond to heart-room alerts faster.
- **L** — **Bridge tile.** Crosses water/lava (requires map terrain variety first — see §6).

**Next.** (1) Size tiers + Library (simplest payoff); (2) Workshop + Traps/Doors pipeline; (3) Graveyard → Vampire loop.

## 5. Doors & traps (Workshop output)

**DK2 touchstone.** Workshop produced physical objects a player placed. Doors controlled pathing; traps controlled space denial. Inventory counts mattered.

**Today.** Nothing. Heroes walk straight to heart through any opening.

**Gap.** No spatial defense design. Reinforced walls are the only barrier.

**Upgrades.**

- **S** — **Wooden door.** Stops heroes 3 s (axe chop). Placed on any 1-tile gap. 1 manufacturing unit.
- **S** — **Steel door.** Stops heroes 8 s. 3 manufacturing units.
- **S** — **Barricade door (locked).** Only own creatures pass. Used to herd creatures out of specific rooms (e.g., keep flies off the Temple).
- **M** — **Spike trap.** 20 dmg once, then broken. Placed on any floor tile.
- **M** — **Lightning trap.** 15 dmg to 3-tile radius. 10 s cooldown. Reusable.
- **M** — **Boulder trap.** Rolls in a straight line; 40 dmg to each hero it hits; stops at first wall.
- **M** — **Gas trap.** Lingering slow cloud; -50 % speed for 4 s.
- **L** — **Alarm trap.** Pings nearest 3 idle creatures to path to that tile.

**Next.** (1) Wooden + Steel doors (simplest to place and animate); (2) Spike trap + Lightning trap; (3) Boulder trap.

## 6. Heroes & threat

**DK2 touchstone.** Knight, Archer, Wizard, Priest, Dwarf, Monk, Thief, Barbarian, Lord of the Land. Each had a role in the hero party. Parties composed like chess.

**Today.** 1 Knight type. 1 Knight Commander boss.

**Gap.** No compositional threat. No counter to spells or specific creatures.

**Upgrades.**

- **S** — **Archer.** Ranged hit-scan, 18 HP, 4 atk, fragile. Shoots the nearest creature from 5 tiles.
- **S** — **Priest.** Heals adjacent heroes for 5/sec. Squishy but force-multiplier.
- **S** — **Dwarf.** Slow but 50 HP. Targets Treasury first ("plunder"), then heart.
- **M** — **Wizard.** Lightning bolts at 4-tile range. Counters packs of low-HP flies.
- **M** — **Thief.** Fast. Tries to steal 100 g from treasury, teleports out if successful.
- **M** — **Monk.** Self-heals on kill. Elite — appears from wave 6 onward.
- **L** — **Lord of the Land (alt boss).** Replaces Knight Commander on endless mode wave 11+. Multi-phase, summons heroes.
- **L** — **Party composition table.** Waves spawn *parties* pulled from a weighted table, not flat lists — guarantees at least 1 healer every 3 waves etc.

**Next.** (1) Archer + Priest (archetype established); (2) Dwarf + Thief (target treasury); (3) party-composition tables.

## 7. Player agency — Hand of Evil

**DK2 touchstone.** The *hand* was the player's body. Slap creatures to speed them up (at anger cost). Possess creatures for first-person rampage. Pick up, drop, toss. Drop gold in treasuries manually. The hand was the UX.

**Today.** Hand picks up and drops. That's it.

**Gap.** Hand feels passive. No slap. No possession. No toss.

**Upgrades.**

- **S** — **Slap.** Click a creature/imp in non-hand mode → 5 dmg to the unit, +50 % work speed for 10 s, +0.1 anger. Satisfying. Audio stinger.
- **S** — **Toss.** In hand mode, flick to release with velocity — unit tumbles 2–4 tiles, takes 10 dmg on land.
- **M** — **Possession.** Right-click a creature → first-person camera inside that creature. WASD move, left-click attack, space to jump, Esc to release. Uses existing creature AI pathfinding as a navmesh check. Huge feel win.
- **M** — **Drop from height.** Carry unit + click on wall → imp drops 1 tile over (simulates "lift to ceiling" mechanic).
- **M** — **Hand grab range indicator.** Pulsing ring under cursor in hand mode.
- **L** — **Goal-based hand commands.** Hold a creature, click on a job tile → creature adopts that job. Acts like a "micro-manager" override.

**Next.** (1) Slap (biggest personality boost for smallest effort); (2) Toss; (3) Possession.

## 8. Spells & research

**DK2 touchstone.** ~15 spells, most locked behind Library research. Mana-gated, not gold-gated. Spells had tactical, not just damage, roles (Sight of Evil, Call to Arms, Haste, Turncoat).

**Today.** 2 spells (Lightning, Heal). Both gold-cost. Both damage/heal.

**Gap.** No tactical spell, no research arc, no mana economy.

**Upgrades.**

- **S** — **Call to Arms.** Drop a rally flag; idle creatures path to it. Already in old roadmap.
- **S** — **Sight of Evil.** Reveal fog-of-war around a tile for 8 s (requires fog system — see §11).
- **M** — **Mana as a second resource.** Temple + idle time regenerate mana slowly. Spells cost mana, not gold. Gold is for rooms & creatures.
- **M** — **Haste.** +50 % speed/attack on a unit for 5 s.
- **M** — **Freeze.** Stops a hero for 3 s.
- **M** — **Turncoat.** Low-HP hero flips sides for 20 s. Pairs beautifully with Torture Chamber.
- **M** — **Chicken.** Turns a hero into a chicken; your Hatchery eats it.
- **M** — **Possession (spell slot entry).** Shortcut from Spell bar as alternative to Hand right-click.
- **L** — **Research tree UI.** Library research points → unlock spells on a visible tree.

**Next.** (1) Mana resource + Temple regen; (2) Call to Arms + Haste; (3) Chicken spell (pure fun).

## 9. Dungeon Heart & loss state

**DK2 touchstone.** The heart *pulsed visibly*. Red glow intensified as it took damage. A damaged heart had visible cracks and sparks. Loss = heart explosion cinematic + collapsing dungeon.

**Today.** Heart is a sphere with a wireframe shell that changes color. HP bar. Game-over overlay.

**Gap.** No physicality in damage. No cinematic on loss. Heart doesn't feel alive.

**Upgrades.**

- **S** — **Visible damage tiers.** Shell opacity + emissive shift at 66 / 33 / 10 %. Existing code already color-shifts, just needs more stages.
- **S** — **Screen shake on heart hit.** Low-amp 0.15 s + red vignette pulse.
- **M** — **Cracks as decals.** Stamped 2D quads on the shell at damage thresholds.
- **M** — **Heart explosion on death.** 1 s slow-mo + particle fireball + camera shake + fade to red.
- **M** — **Heart-room ambient changes.** Below 33 % HP, torches dim and a low rumble drone starts.
- **L** — **Interior chamber.** Camera-accessible "inside the heart" for victory screen — creatures bow, player hand rises triumphantly.

**Next.** (1) Damage tiers + screen shake; (2) Decal cracks; (3) Explosion cinematic.

## 10. Visual style & detail

**DK2 touchstone.** Oppressive dark stone. Every torch pooled warm light, everything else black. Floors were textured, walls had gargoyle inlays, rooms had immediately identifiable silhouettes (Library = bookshelves, Temple = horned statue). Creatures had exaggerated idle animations and personality twitches.

**Today.** Dark-red palette, torches flicker, some room decor via deterministic variants, shadow-mapped sun. No animations on creatures beyond wing-flap + bob. Floors are flat-shaded, uniformly geometric.

**Gap.** Looks like a prototype. The identity is right; the density isn't.

**Upgrades.**

- **S** — **Floor noise.** Rock-floor tiles get a 3×3 micro-bump from a hash(x,z), +/-0.05 y on vertices. Uniform floors read "tech demo."
- **S** — **Torch-light volumes.** Cheap cone volumes (semi-transparent cones) catch specks of dust (particle points drifting through).
- **S** — **Vignette breathe.** Already have vignette; modulate darkness slightly with heart HP (dimmer as heart falls).
- **S** — **Reinforced wall runes scroll.** UV offset each frame — subtle but catches the eye. Currently runes only pulse brightness.
- **S** — **Room "identity" signpost.** Floating emblem at room centroid (coin stack, bed, chicken, book). Already have centroid light; add an icon sprite.
- **M** — **Creature idle animations.** Fly twitches wings at random; Beetle scratches ground; Warlock floats slightly. Characterization is mostly animation variance.
- **M** — **Blood decals.** Enemy death stamps a fading splat quad.
- **M** — **Banner decor.** Reinforced walls occasionally spawn hanging banners with your faction sigil.
- **M** — **Cave drip particles.** Random ceiling-drip droplets in untouched rock — selective, doesn't cover the whole map.
- **M** — **Room props density pass.** Every room needs 3× its current prop count to feel furnished.
- **L** — **Proper PBR materials.** Swap flat-shaded to roughness-mapped stone with normal maps. Large lift for Three.js r128 (which can do it).
- **L** — **Post FX stack.** Bloom on emissive, SSAO on geometry, god-rays from torches.
- **L** — **Hand model.** An actual 3D claw on the cursor in build/hand mode, skinned to pointer position.

**Next.** (1) Floor micro-bump + room centroid emblem; (2) Creature idle animations (fly twitch, beetle scratch); (3) Blood decals + banner decor.

## 11. Map & world

**DK2 touchstone.** Maps had terrain variety — water, lava, impassable rock, paths. Campaign missions had objectives beyond "kill all heroes." Fog of war hid unmined areas.

**Today.** Flat 30×30. No terrain. No fog — you see the whole grid. Fixed layout.

**Gap.** No exploration reward. No terrain tactics (bridge placement). No mystery.

**Upgrades.**

- **S** — **Fog of war.** Dark overlay on unmined rock + unclaimed areas. Reveals permanently as imps explore.
- **M** — **Water tiles.** Un-walkable by most; flies fly over; requires Bridge (room-type tile from §4L).
- **M** — **Lava tiles.** Un-walkable; deals damage to anyone crossing. Bridge mandatory. Dramatic environmental detail.
- **M** — **Hidden rooms.** 2–3 pre-built chambers in rock (treasure, free creature, hero ambush). Already on old roadmap.
- **M** — **Seeded portal & enemy-dungeon placement.** Randomness per-run but deterministic from seed.
- **L** — **Objective-based missions.** "Find and convert the Lord of the Land," "Collect 5000 g before wave 10," "Starve every prisoner."
- **L** — **Campaign overworld.** Pick next mission from a map screen; unlocks advance the campaign.

**Next.** (1) Fog of war on un-dug rock; (2) Seeded placement; (3) Water + Lava + Bridge.

## 12. Audio & music

**DK2 touchstone.** Iconic growly narrator ("Your creatures are hungry, keeper"). Gothic pipe-organ music. Each room had an ambient loop. Creatures grunted, laughed, complained.

**Today.** 20 procedural SFX, no music, no voice. Heartbeat ambient.

**Gap.** No audio identity. No voiceover flavor.

**Upgrades.**

- **S** — **Creature grunts.** Fly buzz, Beetle click, random 5 % per second when idle near camera.
- **S** — **Slap sound** (new). Thwack + creature yelp.
- **S** — **Heartbeat ducks during waves.** Current heartbeat always plays; fade to 40 % during wave combat.
- **M** — **Procedural room ambients.** Treasury → coin clink; Lair → breathing; Hatchery → chicken cluck; Temple → drone. Positional based on room centroid.
- **M** — **Procedural dark-ambient track.** 8-bar loopable minor-key drone + slow drumbeat. Two variants (build / combat).
- **M** — **Boss theme.** Chord stabs + faster drum on wave 10 only.
- **L** — **Narrator lines.** Speech-synthesis (Web Speech API?) for "Your dungeon heart is under attack!" stingers. Tastefully rare (not DK1-level nag).
- **L** — **Creature voice bank.** Pitched growls per species. Mistress has a completely different vibe to Fly.

**Next.** (1) Slap sound + creature grunts; (2) Room ambients; (3) Procedural combat/build drones.

## 13. HUD & usability

**DK2 touchstone.** Information-dense but *physical* UI — stone panels, chained edges, every creature clickable in a side bar. Drag-select for painting rooms. Gesture feedback was immediate.

**Today.** Clean functional HUD: heart HP, wave countdown, toolbar, legend. Compact but sterile. No creature bar, no minimap, no event feed, no nudges.

**Gap.** You can't see what your dungeon is doing at a glance. You only see the camera's current view.

**Upgrades.**

- **S** — **Creature roster panel.** Collapsible side strip with each creature's icon, HP, happiness. Click to center camera.
- **S** — **Event feed.** Bottom-right scroll: "Fly #3 killed Knight," "Beetle demanded pay," "Door broken."
- **S** — **Wave preview chip.** 10 s before wave, show composition: "3 Knights, 1 Archer."
- **S** — **Toolbar tooltip on long-hover** for desktop; adds discoverability.
- **S** — **Auto-return to Dig** 5 s after spell cast.
- **M** — **Minimap.** 120×120 top-right, heart centered, unit dots, click to pan.
- **M** — **Hand cursor ring.** Pulsing circle showing hand grab range.
- **M** — **Objectives panel.** "Claim a portal," "Build a lair," etc. Adapts to progress.
- **M** — **Post-wave recap.** Kills / losses / gold spent / best performer.
- **L** — **Stone-textured panel frames.** Replace current clean CSS with gothic borders (chains, iron studs). Heavy DK2 flavor.

**Next.** (1) Creature roster panel; (2) Minimap; (3) Wave composition preview + event feed.

## 14. Input & controls

**DK2 touchstone.** Right-click un-designates. Drag-select paints areas. Alt-click opens creature info. Possession with number key. Slap with left-click-in-air. Gestures had consistent grammar.

**Today.** Left-click drag paints. Single-tap for Hand/spells. Right-click does nothing in the canvas. No slap.

**Gap.** Grammar is incomplete. Power users can't chain actions.

**Upgrades.**

- **S** — **Right-click un-designates.** Biggest quality-of-life win; DK2 muscle memory.
- **S** — **Undo last designation** within 3 s (Ctrl+Z).
- **S** — **Sticky Hand mode.** Stays active across drops.
- **S** — **Shift-click to pin priority** on marked tiles (see §15 below).
- **S** — **Number keys switch spells without clicking toolbar** (already there for 6/7; extend to 1 = Possess when built).
- **M** — **Radial quick-menu.** Hold key (e.g., Tab) → radial with all modes; release on target.
- **M** — **Gesture rewrite.** Drag on rock = auto-dig; drag on claimed = enter build-room submode.
- **M** — **Gamepad support** (basic) via Gamepad API — tile cursor + face-button modes.
- **L** — **Mod-key camera.** Middle-click + drag to free-rotate camera.

**Next.** (1) Right-click un-designate; (2) Undo within 3 s; (3) Sticky Hand + auto-return-to-Dig.

## 15. Imps

**DK2 touchstone.** Imps had simple but readable personalities — they chittered, rushed around, fought back weakly, and could be slapped. Tileset of behaviors: mine, reinforce, claim, drop gold at treasury, pick up corpses.

**Today.** Imps do dig/claim/reinforce/claim_wall. They don't carry corpses, don't refresh walls, don't show rush state.

**Gap.** Imps are a work queue, not characters.

**Upgrades.**

- **S** — **Rush flag.** Shift-click a marked tile → nearest N imps drop everything and rush.
- **S** — **Tint-on-level.** Current badge is a number; also tint skin slightly brighter per level. Readable at a glance.
- **S** — **Idle sweep.** Idle imps wander the dungeon picking up dropped gold and returning it. No more dumb idling.
- **M** — **Carry corpses.** On hero death, imps haul corpse to nearest Graveyard (requires §4M Graveyard).
- **M** — **Imp training level** shown by hat variant: bare → cap → horned cap → iron helm.
- **M** — **Imp slap accelerator.** Slap an imp → same 50 % work-speed boost as creatures.
- **L** — **Specialized imp roles.** After level 4, imps pick: Miner (+speed on dig) or Mason (+speed on reinforce).

**Next.** (1) Idle sweep behavior; (2) Rush flag; (3) Corpse hauling → Graveyard.

## 16. Onboarding & feedback

**DK2 touchstone.** DK2 had a campaign tutorial, tooltips, and a narrator nagging you into the next action. Still playable without reading the manual.

**Today.** Static instruction box bottom-left. No interactive tutorial, no contextual hints, no narrator nagging.

**Gap.** A new player will be confused about what to do after "dig some stuff."

**Upgrades.**

- **S** — **First-run tutorial.** 4-step overlay: (1) drag to dig, (2) designate treasury, (3) claim portal, (4) survive wave. Each step advances on action detection.
- **S** — **Contextual nudges.** Every 30 s, check if the player is under-built; show a flavor nudge ("The walls are bare. A Lair would comfort your creatures.").
- **S** — **Hover tooltips on rooms / units** (desktop).
- **M** — **Dungeon Assistant.** Narrator-flavor text box bottom-left, pops up with ~10 s hints.
- **M** — **Post-wave encouragement / warning.** Narrator comments ("Wave 3 felt easy. Brace yourself.").
- **L** — **Full tutorial campaign.** 3 scripted mini-missions teaching rooms → creatures → spells.

**Next.** (1) First-run 4-step overlay tutorial; (2) Contextual nudges at 30 s cadence; (3) Hover tooltips.

## 17. Performance, tech, code

**Today.** 25 ES modules, ~7k LOC. Per-frame grid scans. No instancing. A* recomputes always. 4 known pre-existing bugs.

**Upgrades.**

- **S** — **Fix the 4 known bugs** (wave banner timing, gold-mesh leak, dead `dropHeld` branch, dead `'moving_to_eat'` guard).
- **S** — **Cache room-decor tile lists** instead of scanning grid every frame (brazier flicker loop is the offender).
- **S** — **Frame-skip** low-priority ticks (hatchery regrow, need decay) to every 0.5 s.
- **M** — **Tick registry.** Each module registers its tick with main.js; main.js becomes dumb dispatcher.
- **M** — **InstancedMesh for rock & floor tiles.** ~10× draw-call reduction.
- **M** — **A* path cache** per (start, goal) with 1 s TTL.
- **M** — **Spatial grid** for proximity queries (hero sight, creature auto-engage).
- **M** — **Split `rooms.js`** (1050 lines → 4 files: treasury, lair, hatchery, common).
- **M** — **Vitest + jsdom** for pure-helper unit tests (pathfinding, damage math, job priority).
- **L** — **TypeScript ambient `.d.ts`** for state + constants without full TS migration.
- **L** — **Web Worker** for heavy A* calls when many heroes repath simultaneously.

**Next.** (1) Fix the 4 known bugs; (2) Room-decor tile caching; (3) Tick registry.

---

## Phase Plan — 12 weeks to DK2-ish

Each phase is ~2–3 weeks and ends with a playable milestone. Pick one category's "Next" triplet per phase, front-load the features that unlock later ones.

**Phase 1 — Foundation & feel (bugs + slap + heart damage)**
Goal: Existing game feels less prototype-y.

1. Fix 4 known bugs (§17).
2. Slap mechanic (§7).
3. Heart damage tiers + screen shake + red vignette (§9).
4. Right-click un-designates (§14).
5. Event feed (§13).

**Phase 2 — Creatures come alive (pay, happiness, brawls)**
Goal: You start to see creature personalities emerge.

1. Pay-demand system (§1).
2. Happiness scalar + face icon (§1).
3. Fight-in-lair (§1).
4. Creature idle animations (§10).
5. Creature grunts (§12).

**Phase 3 — Roster expansion (second + third creature)**
Goal: Composition matters.

1. Beetle creature (§3).
2. Goblin creature (§3).
3. Roster panel HUD (§13).
4. Affinity matrix v1 (§1).
5. Species-specific lair preferences (§1).

**Phase 4 — Training & Library (downtime has purpose)**
Goal: Pre-wave prep becomes a real layer.

1. Training Room (§2).
2. Library room + Warlock creature (§4, §3).
3. XP escalation + perks on level-up (§2).
4. Call to Arms + Haste spells (§8).

**Phase 5 — Workshop, doors, traps (spatial defense)**
Goal: Dungeon layout matters; heroes can be funneled.

1. Workshop room + Troll creature (§4, §3).
2. Wood + Steel doors (§5).
3. Spike + Lightning trap (§5).
4. Hero variety: Archer + Priest + Dwarf (§6).
5. Wave composition tables (§6).

**Phase 6 — Dark arts (Prison, Torture, Graveyard)**
Goal: Villain fantasy. You're now a proper dungeon lord.

1. Prison room (§4).
2. Torture Chamber (§4).
3. Graveyard + Skeleton + Vampire (§4, §3).
4. Chicken + Turncoat spells (§8).
5. Corpse hauling by imps (§15).

**Phase 7 — Possession & Hand of Evil (keystone UX)**
Goal: The iconic DK2 moment.

1. Possession (§7).
2. Toss mechanic (§7).
3. Hand grab ring + cursor model (§7, §10L).
4. Temple room + mana resource (§4, §8).
5. Spell research tree UI (§8).

**Phase 8 — Visual identity pass**
Goal: Screenshots look like DK2 stills.

1. Floor micro-bump + room centroid emblem (§10).
2. Torch light-volumes + dust motes (§10).
3. Blood decals + banners (§10).
4. Room prop density pass 3× (§10).
5. Bloom on emissive (§10).

**Phase 9 — Map variety & fog**
Goal: Each run feels fresh.

1. Fog of war (§11).
2. Seeded portal + enemy-dungeon placement (§11).
3. Hidden rooms (§11).
4. Water + Bridge tile (§11, §4).

**Phase 10 — Music & narrator**
Goal: Identity is complete.

1. Procedural ambient drone (build / combat / boss) (§12).
2. Room ambient loops (§12).
3. Narrator stingers on key events (§12).

**Phase 11 — Meta & replayability**
Goal: Players come back.

1. LocalStorage for settings + high score (§16 old roadmap).
2. Endless mode post-boss (§6L).
3. Daily-seed run (§11).
4. Boss phases + Lord of the Land alt-boss (§6).

**Phase 12 — Onboarding + polish**
Goal: Anyone can pick it up.

1. First-run 4-step tutorial (§16).
2. Contextual nudges (§16).
3. Minimap (§13).
4. Objectives panel (§13).
5. Tick registry + InstancedMesh tiles (§17).

---

## Don't build

Easy to reach for, wrong for this project:

- **Multiplayer.** Kills scope for zero upside at prototype stage.
- **Full asset pipeline.** The procedural aesthetic is the identity — lean in, don't replace.
- **Full TypeScript migration.** `.d.ts` ambients cover the value without the cost.
- **Mobile store packaging.** Browser is the distribution. Touch support is enough.
- **Custom shaders before PBR materials.** Use Three.js standard materials with normal maps; skip writing GLSL unless a specific effect demands it.
- **Procedural room generation.** Player-authored rooms are the fun. Only *map* terrain (§11) should be procedural.

---

## Picking up next — exact first session

If you can do one session right now, do these 4 items in order. Each is small, each is a visible win, each teaches the codebase in a useful area.

1. **Fix the 4 known bugs** (§17). ~30 min. Unblocks moral hazard of bugs piling up.
2. **Slap** (§7). ~45 min. Touches input.js, imps.js, creatures.js, audio.js. Massive feel payoff.
3. **Right-click un-designates** (§14). ~30 min. Classic DK muscle memory.
4. **Heart damage tiers + screen shake** (§9). ~45 min. Suddenly the game has combat drama.

~2.5 hours for a dungeon that already feels twice as alive.
