# Dungeon Lord — POC

A Dungeon-Keeper-inspired 3D survival game in the browser. No build step, no dependencies to install, no assets — Three.js r128 is loaded from a CDN at runtime.

## Run

ES modules need a server (`file://` is blocked in most browsers):

```sh
python3 -m http.server 8765
```

Then open <http://localhost:8765/index.html>. Works on desktop (mouse + keyboard) and mobile (touch + pinch).

The original single-file prototype is preserved at [dungeon_keeper_poc.html](dungeon_keeper_poc.html) as a reference. The live code is the modular version in [src/](src/).

## The game

Defend your **Dungeon Heart** on a 30×30 tile grid against 10 waves of heroes. Wave 10 spawns the **Knight Commander** — kill him to win. If the heart's 750 HP hits 0, the dungeon falls.

You don't control units directly. You designate work and your minions carry it out.

## Flow

1. **Dig** into rock to expand. Imps auto-claim floors they walk on and **reinforce** walls adjacent to claimed tiles.
2. Dig toward the two buried **portals** (NE and SE). Claim them to spawn **Flies** — combat creatures that auto-engage heroes.
3. Designate **rooms** on claimed floor:
   - **Treasury** — stores gold (cap 300/tile). Starts with 8 pre-placed tiles around the heart.
   - **Lair** — flies sleep here when their sleep need is critical.
   - **Hatchery** — flies eat here when hungry.
4. Watch the **enemy dungeon** (small blue room 10 tiles SW of the heart). Capture its walls to earn `wallsCaptured`.
5. Survive. First wave hits around 90s in; waves escalate every ~85s.

## Controls

**Toolbar modes** (drag to paint, except Hand/spells which are single tap):

| Key | Mode      | What it does                                |
| --- | --------- | ------------------------------------------- |
| D   | Dig       | Mark rock/gold/walls for digging            |
| 2   | Treasury  | Designate claimed floor as treasury         |
| 3   | Lair      | Designate claimed floor as lair             |
| 4   | Hatchery  | Designate claimed floor as hatchery         |
| 5   | Hand      | Pick up an imp/creature, tap a tile to drop |
| 6   | Lightning | 200g, 5s cd — 40 dmg AoE on tapped tile     |
| 7   | Heal      | 100g, 3s cd — +25 HP to tapped ally         |

**Camera:** arrows/WASD pan · Q/E rotate · wheel or Z/X zoom · Space/C/⊙ recenter · two-finger drag + pinch on touch.

## Systems

- **Pathfinding:** A* over walkable tiles, recomputed on demand.
- **Jobs:** priority queue `dig > claim > claim_wall > reinforce`. Imps self-assign nearest work.
- **Creature needs:** hunger (60s) and sleep (90s) bars fill over time; critical thresholds push flies to seek hatchery/lair.
- **XP & levels:** imps level from work, creatures from kills. Caps at 4/5. Full heal on level-up.
- **Imp respawn:** workforce minimum of 4 maintained from the heart at 40g / 10s.
- **Combat:** shared HP/flash/damage-number system across heroes, creatures, imps, heart, boss.
- **Audio:** fully procedural Web Audio synth — every sound is oscillators + filtered noise. Mute with the 🔊 button.
- **Rendering:** Three.js with PCF soft shadows, ACES tone mapping, flickering torch point lights. Room decor uses seamless plate merging + deterministic variant rolling.

## Structure

```text
index.html          — HTML shell; loads Three.js CDN then ./src/main.js
styles.css          — full stylesheet
src/
  main.js           — entry + animation loop
  constants.js      — tile type IDs, speeds, HP, costs, cooldowns, all tunables
  state.js          — shared mutable state (grid, imps, creatures, heroes, …)
  audio.js          — procedural Web Audio synth + SYNTHS library
  scene.js          — renderer, scene, camera, lighting
  materials.js      — shared Three.js materials
  tiles.js          — tile factory, setTile, dig markers, portals
  heart.js          — dungeon heart model + damage state + endgame overlays
  torches.js        — torch factory
  rooms.js          — room variants, per-tile props, designation, decor
  pathfinding.js    — A* (isWalkable, findPath, findPathToAdjacent)
  jobs.js           — job queue (markForDig, claim, reinforce, queueBorder)
  treasury.js       — gold deposit pipeline
  effects.js        — particle helpers (pulse, spark, gold burst)
  imps.js           — imp model, AI, respawn
  creatures.js      — fly model, AI, needs, portal spawning, hatchery regrow
  combat.js         — takeDamage, death dispatch, HP bars, floating damage, dropped gold
  xp.js             — XP gain, level-up, level badges
  heroes.js         — hero + Knight Commander models, AI, wave spawning
  spells.js         — lightning + heal, cooldown bars
  input.js          — drag-select, pointer dispatch
  hand.js           — Hand of Keeper pickup/drop
  camera-controls.js — keyboard/wheel/pinch input, tickCamera
  hud.js            — HUD updates, combat HUD, help/legend, mute
  init.js           — one-time world setup (heart, enemy dungeon, portals, initial imps)

dungeon_keeper_poc.html — original single-file prototype (reference only)
CLAUDE.md               — architecture notes for LLM-assisted development
```
