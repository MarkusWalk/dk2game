# Looking, Sounding and Feeling Like DK2

A reference for taking this Babylon.js client from "moonlit isometric puzzle
board" (per `REVIEW.md` section 8's read of `docs/review/2026-09-05-in-game.png`)
toward Dungeon Keeper 2's art direction, HUD, audio and creature cast. Every
section pairs the DK2 reference with a concrete change against
`src/babylon/core.js`, `environment.js`, `world.js`, `ui.js`,
`styles-babylon.css` and `audio.js`.

Note on research: `WebSearch` reached the open web, but results for
DK2-specific art/UI detail were thin (general palette/wiki hits, nothing on
room dressing or HUD mechanics). The content below is written from direct
knowledge of DK2's shipped design; treat specific hex/frequency numbers as
informed starting points to eyeball against the game, not extracted fact.

---

## 1. Art direction of DK2

**Palette.** DK2 reads in four value bands. Unclaimed rock is near-black
basalt with a cool purple-grey cast, broken by ochre earth where imps have
dug. Claimed floor is warm brick-red tile — literally "the Keeper's colour" —
with a darker inlay pattern and a faint glow at the seams near torches.
Rival Keepers claim the same tile shape in their own colour: blue, green,
yellow, so a glance at a corridor junction tells you whose territory you're
in without reading a label. Gold veins are a mustard-yellow rock studded with
brighter nuggets, distinct from both earth and rock. Water is teal-black and
glassy; lava is saturated orange-red with a near-black crust. Every one of
these colours is desaturated at rest and only comes alive in torchlight —
the palette isn't "colourful," it's a small set of hues that light picks out
selectively.

**Lighting model.** There is no sun. The default state of an unlit dungeon
tile is close to black — DK2's engine could not do full dynamic GI, so the
game leans into it: rooms you haven't lit read as void, and every readable
space has an explicit local source (torch, lava, a room's ambient glow, the
Heart) creating a pool of warm light with a sharp-ish falloff. This is the
single biggest driver of DK2's mood: light is a resource the level dresses
in, not an ambient given. Corridors are genuinely dark between torches.
Claimed rooms get a soft ambient boost (so the player can still read UI
information there) but still darker at the edges than at the centre.

**Materials.** Everything reads as physically chunky and hand-tooled: rock
faces have visible strata cuts, walls have carved skulls/reliefs on the
Keeper's side, floor tiles have a beveled inlay border. Nothing is flat-shaded
or CG-clean; surfaces have low-frequency noise (dirt, scorch marks, wear)
even though the textures are baked, not physically based. Metal (portcullis
bars, door studs, gold) is the only genuinely bright/reflective material in
the frame, so it draws the eye.

**Camera.** A fixed-pitch isometric-style perspective camera (not true
orthographic — there's real perspective falloff) that free-rotates around a
vertical axis and free-zooms, but the tilt is clamped to a narrow band: you
can never look flat-on down a corridor, and you can never get close to
top-down. The intent is to keep floor patterns, wall faces and creature
silhouettes all visible at once from one comfortable angle band.

**Room legibility.** Each room type is recognisable in under a second from
its floor pattern and 2–4 signature props, without reading a label:

- **Treasury** — floor made of gold-coin tile mosaic; loose coin piles grow
  taller as gold accumulates, a visible fill gauge.
- **Lair** — a grid of individual pod/nest shapes, one per creature, with a
  creature's colour/species visible when occupied.
- **Hatchery** — grassy patch dotted with a wandering flock of chickens
  (the only room with idle animated fauna, which is why it reads instantly).
- **Training Room** — a padded ring floor pattern, dummies and a weapon
  rack; a rotating "hoop" or scaffold at the centre.
- **Library** — dark wood floor, standing bookshelves and lit lecterns.
- **Workshop** — anvils and half-built trap/door props scattered on a
  grated metal floor.
- **Prison** — floor cut into cells with visible bars.
- **Torture Chamber** — rack, blood-stained floor tint.
- **Temple** — a raised altar over a reflective pool at the centre.

**Gold veins, fortified walls, portals, the Heart.**
Gold veins are rock with a visibly different, brighter, streaked texture —
readable as "dig here" even before an imp starts. Fortified (reinforced)
walls have a distinct crenellated/embossed face, darker than plain earth
walls, telegraphing "this took work and blocks digging from outside" at a
glance. The Portal is a glowing rift with slow-rotating rings and a
particle/energy plane — the brightest, most animated non-Heart object on the
map, because it is the reward loop's visual anchor. The Dungeon Heart is a
huge pulsing red-purple organic crystal on a dais, visibly breathing (scale
pulse tied to a heartbeat rhythm) and bathing the room in red light; its
pulse rate and brightness visibly change as it takes damage, and it produces
a violent light/shake event on death.

**Creature proportions and silhouette.** DK2 exaggerates: oversized hands,
heads, and weapons relative to a comparatively small torso and legs, so
every creature reads at a distance and in silhouette alone. Imps are small,
skinny, big-eared, big-nosed goblins. Trolls and Bile Demons are squat and
enormous. The Horned Reaper is tall, spindly, and top-heavy with huge horns
and axe. Every species has a distinct silhouette even in monochrome.

**Animations that sold personality.** DK2's creatures are constantly doing
small idle business rather than standing in a T-pose between actions: an
Imp taps its foot or scratches when idle; creatures visibly eat from a
chicken carcass on the floor at the Hatchery, sleep curled up in their Lair
bed with a "z" effect, flinch and stagger when slapped by the Hand, and have
a dedicated "angry" pose/animation when unhappy (fists clenched, pacing).
These reads are what makes the roster feel alive independent of combat.

---

## 2. Mapping to this codebase

### Lighting — replace the "moon" with local sources

`src/babylon/core.js` `createLights()` currently makes a `HemisphericLight`
("dungeonFill") plus a single `DirectionalLight` named literally
`'dungeonMoon'` aimed like sunlight, with a `CascadedShadowGenerator` bound
to it (`createShadows`). This is the single biggest reason the screenshot
reads as an outdoor moonlit diorama rather than a dungeon: one bright
directional key from above flattens every tile to the same lit value.

Concrete change:
- Keep the `HemisphericLight` as the world's floor for readability, but cut
  its `intensity` toward ~0.18–0.25 and push `groundColor` toward
  near-black so unclaimed rock genuinely goes dark.
- Drop the directional "moon" as a global key entirely, or reduce it to a
  very weak, cool fill (intensity ~0.15) purely so shadow-casting geometry
  doesn't go fully flat where no torch reaches — DK2's corridors are dim,
  not pitch black to the point of hiding geometry.
- Add a **pooled PointLight budget** for torches: a fixed-size pool (e.g. 24
  lights, tunable per `quality.js` profile — `low: 8, medium: 16, high: 24,
  ultra: 32`) of warm orange `PointLight`s (`range` ~3.5 tiles, `intensity`
  ~0.9, `diffuse` around `#ff9a44`) that `world.js` claims and repositions
  onto the nearest N torch decor instances to the camera target each time
  `rebuildVisuals()` runs (or on a cheap distance re-sort every ~0.5s from
  `update(dt)`), rather than one light per torch mesh. `_addTorch(cell)`
  already places a `decor.torch`/`decor.fire` thin-instance pair per room
  edge tile — record each torch's world position in an array on
  `DungeonWorld` (`this.torchSites`) as it's added, so the pool has
  candidates to bind to. Unbound torches stay lit only by their emissive
  material and the GlowLayer (already created in `core.js`), so far-off
  torches are still visually "on," just not casting real light — matching
  DK2's own practical light budget on 1999-era hardware.
- Give the Dungeon Heart and Portal actual `PointLight`s (not just emissive
  materials) — they are landmarks and deserve to light their own room; both
  already have a dedicated `_createHeart`/`_createPortal` method in
  `world.js` that is the natural place to parent a light.
- Fog: `core.js` sets `scene.fogDensity = 0.014`, then `environment.js`'s
  `_configureScene` overrides it again to `0.008`/`0.011` by quality — pick
  one owner. Keep exp2 fog, lower density slightly, and shift `fogColor`
  toward the same near-black-purple as `clearColor` so fog reads as the
  dark itself fading in, not a grey bank.

### Materials — DK2 rock/earth/claimed values

`environment.js` `_createMaterials()` already has one `PBRMaterial` per
surface, which is the right architecture — the fix is values and texturing,
not structure:
- `rock`/`rockEdge` are currently `#211c2b`/`#342940` — desaturated *violet*.
  Shift the hue toward neutral cool-grey/near-black with a slight blue-green
  cast (`#171519` base, `#2a2620` edge) so rock stops reading as amethyst.
- `earth` at `#34271f` is already close to DK2's ochre-brown dug earth —
  keep it, maybe warm it slightly (`#3d2d1f`) and raise `roughness` variance
  via a noise texture if one gets added later.
- `claimed`/`claimedTrim` are `#5b2637`/`#5a3325` — a maroon-brown. Push
  `claimed` toward a more saturated warm brick-red (`#7a2430`) with the trim
  inlay darker and slightly desaturated, and add a second claimed-floor
  material variant per faction colour (`claimedBlue`, `claimedGreen`,
  `claimedYellow`) for later rival-Keeper support — `ROOM_STYLE`'s pattern
  of swapping one material per tile type already generalises to this.
- Add a low-res tileable noise/normal map (a single shared 512² texture is
  enough) to `rock`, `earth` and `claimed` so the currently flat PBR colours
  pick up torchlight unevenly — this reads as "hewn stone" far more than
  hue tuning alone.
- `reinforced`/`reinforcedTrim` (walls) should visibly differ from `claimed`
  more than they currently do — DK2 fortified walls have a raised
  crenellated face. `_addTileVisual`'s `TILE.REINFORCED` branch already adds
  a `tile.wallCrown` torus and four `tile.wallStud` bumps per tile; bumping
  `wallStud`'s emissive intensity slightly and giving `reinforcedTrim` a
  brass/bronze `metallic: 0.9` reads closer to "fortified" than the current
  understated grey.

### The Heart — HP-driven pulse

`_createHeart` in `world.js` builds the dais/crystal/crown/shard meshes and
calls `this.environment.registerEmissive(crystal, 0, 0.04)`, which only
drives a *scale* pulse via `environment.js`'s `update(dt)`
(`entry.node.scaling.setAll(pulse)` at a fixed `strength`). To make the pulse
read HP:
- Extend `registerEmissive` entries with an optional `getIntensity()`
  accessor, or add a parallel `this.animatedEmissives` variant
  (`registerHeartPulse(node, material, getHpFraction)`) that on each
  `update(dt)` sets both `scaling` *and* `material.emissiveIntensity`/
  `emissiveColor` as a function of current HP fraction (read from wherever
  the game state stores Heart HP — likely the same source the HUD's
  `dui-heart-fill` width already reads). Low HP should slow the pulse
  rhythm and shift the crystal from bright pink-red toward a duller,
  flickering near-black-red, with a brief violent flash + camera shake hook
  on death — `world.js` already owns `this.animated` for per-frame landmark
  updates, so this is an additive branch there, not a new subsystem.
- Parent a `PointLight` to the crystal (see lighting section) whose
  intensity tracks the same HP fraction, so the Heart's room visibly dims
  as it takes damage, not just the mesh.

### Torch flames — thin-instanced, and lit

Torches already exist as thin-instance decor (`decor.torch` +
`decor.fire`), which is correct for scale, but the flame is a static sphere
with no flicker and no light. Two additive, cheap changes:
- Give `decor.fire`'s material (`environment.materials.fire`) a subtle
  emissive-intensity flicker driven from `environment.update(dt)`. A single
  thin-instance's material can't animate independently, so flicker the
  whole batch's shared material with a fast small sine (torches flicker in
  loose unison — cheap, and fine at DK2's scale); move to a
  `SolidParticleSystem` only if per-torch variation turns out to matter.
- Bind the pooled `PointLight`s described above to the nearest torch sites,
  giving the flames an actual light footprint rather than only emissive
  self-illumination.

### Room floor patterns — atlas over coloured insets

`_addTileVisual`/`_addRoomDecor` currently give each room type one flat
coloured inset box (`room.${roomType}` batch, e.g. `mat[style.inset]`) plus a
handful of decor primitives. This is legible but flat — DK2 rooms are
readable by *floor pattern*, not floor tint alone. Two-step improvement,
both compatible with the existing thin-instance batching:
1. Replace each `room.<type>` box's material with a `PBRMaterial` carrying
   an `albedoTexture` set to a small shared **room floor atlas** (one
   1024²–2048² texture, each room type occupying a tile in a grid — coin
   mosaic, nest-pod grid, padded ring, bookshelf-wood-plank, cell-grate,
   etc.) with per-room UV offsets set via `material.albedoTexture.uOffset/
   vOffset` on cloned-but-shared materials (one clone per room type, still
   far short of one material per tile). This keeps draw calls flat because
   it's still a thin-instanced box per tile, only the texture changes.
2. Keep the existing prop kit (`decor.gold`, `decor.straw`, `decor.dummy`
   etc. via `_addRoomDecor`'s per-`style.prop` switch) as the secondary read
   — the atlas carries the floor pattern, the props carry the "why."

### HUD-adjacent visuals: gold veins, portal, fortified walls

Already covered above under materials/lighting; the one addition worth
flagging is that `_addTileVisual`'s `TILE.GOLD` branch places three
`tile.goldFleck` spheres per vein tile — bumping `mat.gold`'s
`emissiveIntensity` slightly and letting a torch light pass over it (once
torches are real lights) will make veins "sparkle" the way DK2's gold seams
do, with zero new code.

### Shadows for a dark dungeon

`createShadows` in `core.js` already sets `darkness: 0.34` and PCF filtering
— reasonable — but it is bound to the directional "moon," which this
document proposes removing/weakening. Once the moon is a weak fill instead
of a key light:
- Move shadow-casting to the Heart's and/or the strongest nearby torch
  PointLight rather than a global directional caster, or keep a very low
  intensity directional purely as the shadow caster (shadows still need one
  consistent caster; DK2 approximates this with baked blob shadows under
  every unit). A cheap, robust option for this codebase: keep the
  directional light only as the shadow source, but make it not otherwise
  contribute to lit color (`diffuse` near black, only used for `shadowMinZ/
  shadowMaxZ` and the generator) — this preserves the existing
  `CascadedShadowGenerator` plumbing without it visually acting as a sun.
- `shadowGenerator.darkness` can drop closer to `0.15–0.2` once ambient is
  genuinely darker — the current `0.34` was tuned against a bright global
  light and will look wrong once the base scene is darker.

---

## 3. HUD and UX of DK2

**Panel layout.** DK2's live-play chrome is a single horizontal strip along
the bottom of the screen: a icon-grid panel (rooms / spells / creatures /
traps-and-doors as tabs within *one* panel, not four separate panels), a
small info readout next to it showing gold/mana and the selected item's
name+cost, and a minimap in the corner. That's it. There is no persistent
sidebar creature roster and no permanent multi-panel command palette sitting
over the world — most of the screen, top to bottom, is the 3D view. Tabs
switch which icon grid is showing, but all rooms are visible on the Rooms
tab at once (comparison is the point, per `REVIEW.md` section 8), each with
a cost badge and a build/greyed-out state.

**Tooltips.** Hovering any icon shows a one-line name + cost + short
flavour/mechanical description near the cursor, dismissed the instant the
pointer leaves — no persistent hint text competing for space.

**Creature portraits.** When you do open the creature panel, each entry is a
small square portrait (a rendered headshot of that species, not a text
label) with a compact HP bar, a level dial/chevrons, and a mood icon (happy/
annoyed/angry face) layered on the corner — density is high, one row per
creature type (aggregated, with a count), not one row per individual unit.

**The mentor voice.** DK2's most memorable UX device: a warm, sardonic
narrator who fires short spoken lines tied to game events — "Your creatures
are getting hungry, Keeper," "A hero has been spotted" — read aloud, with a
one-line text echo at the bottom of the screen that fades after a few
seconds. It is *event-driven and terse*, never a wall of text, and it is a
voice performance more than a UI element.

**Minimap.** Small, corner-anchored, shows explored-only terrain in coarse
colour blocks (rock/claimed/room-type colour), a viewport reticle, click to
recentre — functional, not decorative, and it does not compete for screen
space with the 3D view.

**Hand cursor states.** The Hand of Evil is a literal clawed hand rendered
in 3D space at the cursor position, not a 2D icon: it points/tugs at UI
targets, closes around a creature/gold pile mid-drag (with a distinct
"holding" pose and the held creature visibly dangling), and does a
one-shot "slap" gesture on click over an idle/misbehaving creature.

**Drag-painting feedback.** Dragging over diggable/claimable tiles paints a
translucent highlight overlay in real time as the drag crosses new tiles,
with a per-tile checkmark/X readability cue for legal vs illegal targets;
released tiles queue instantly as jobs for imps (not painted instantly), so
the *feedback* is immediate but the *effect* is not.

**Selling.** A dedicated Sell cursor turns any of your own rooms/doors/
traps under the cursor into a refund-and-remove target with a red
"you are about to destroy this" tint before you commit the click.

**Camera keys.** Arrow keys/WASD pan, a dedicated rotate pair, mouse wheel
zoom, and a "possess" key/click to snap the camera into first-person on a
creature. All movement is on the keyboard's left hand so the mouse stays
free for the Hand.

### Concrete changes to `ui.js` / `styles-babylon.css`

The current layout (measured from `styles-babylon.css`) is: `.dui-build-
panel` at `width: 278px` pinned left, `.dui-side-stack` (Threats + Roster) at
`width: 256px` pinned right, `.dui-minimap-frame` at `width: 222px` under
that, plus a full-width top bar and a bottom context bar. At a 1400×900
viewport that's roughly `278 + 256 = 534px` of fixed horizontal chrome before
any padding/gaps — matching `REVIEW.md`'s "roughly a third of the viewport"
finding, and the world view is squeezed into the remaining strip.

Target: **world gets ≥ 70% of 1400×900** (≥ 980px wide, full height minus a
thin top strip). Concrete moves:

1. **Collapse the left build panel into one thin icon-grid dock**, matching
   DK2's single-strip model instead of a 278px panel with four full-width
   text rows per item (`DEFAULT_MODES` currently renders each entry as an
   icon + label + hint text stacked). Change `.dui-mode-grid` to render icon-
   only tiles (36–40px square) in a tight grid, dropping per-item inline
   label/hint text entirely; move the label + hint into a tooltip shown on
   `:hover`/focus (a single reusable `.dui-tooltip` element positioned near
   the cursor, populated from the hovered tile's `data-hint`/`data-cost`
   attributes, same content `DEFAULT_MODES` already carries as `hint`/
   `cost` — no new data model, just a different render target). This alone
   should shrink `.dui-build-panel` from 278px to roughly 96–120px
   (2–3 icon columns) collapsed, or an on-demand flyout that overlays the
   world instead of permanently reserving width.
2. **Fold Rooms / Defences / Sorcery / Orders into tabs of one panel that
   shows every item in the active tab as a grid**, which the code already
   does structurally (`GROUPS` + `data-ui="tabs"` + `data-ui="mode-grid"` in
   the existing markup) — the change is purely visual density (icon grid,
   not icon+2-line-text rows) plus keeping the panel narrow at all times
   rather than the current fixed 278px regardless of tab.
3. **Merge the right-side Threats + Roster stack into a collapsible strip**
   that defaults to a compact single-row summary (creature counts by
   species + a threat counter) and expands to the current detailed list
   only when clicked — `.dui-side-stack` at 256px should default closer to
   80–100px (icons + counts only), matching DK2's "creature bar is compact
   until opened" behaviour. The panel-heading collapse buttons
   (`data-ui-action="toggle-threats"` / `toggle-roster"`) already exist in
   the markup — default them to the collapsed state instead of expanded.
4. **Shrink the minimap** from 222px to roughly 140–160px — DK2's minimap is
   a small corner instrument, not a fifth of the screen height.
5. **Remove or drastically shorten the bottom context bar's prose.** The
   `.dui-context` selection panel currently shows a name + full description
   sentence (`Mark earth and gold for excavation`) every time a tool is
   selected, at `width: min(620px, calc(100vw - 570px))`. Cut the
   description text from the persistent bar entirely (it lives in the
   tooltip now, per point 1) and keep only name + cost + the action buttons,
   letting this bar shrink to content width instead of reserving over 600px.
6. **Text that goes away entirely**: the `.dui-shortcuts` always-visible
   hint bar (`WASD Move · Q E Rotate · Wheel Zoom · Esc Pause`) duplicates
   what a first-time Keeper's Codex screen already teaches
   (`data-ui-action="show-controls"` already exists) — cut it to a one-time
   overlay dismissed after the first minute of play, or fold into the pause
   screen only.
7. **Event feed** (`.dui-event-feed`, `width: min(390px, 35vw)`) should
   become the mentor-voice line described in section 3 above: one line,
   auto-fading, not a scrolling multi-entry log competing for width — this
   both frees width and gets the game closer to DK2's mentor device.

With 1–6 applied, the reserved chrome at 1400px wide becomes roughly
top-bar height (already thin, ~64px) + a ~110px left icon dock (collapsed)
+ a ~90px right compact roster/threat strip + a ~150px minimap — leaving a
contiguous ~1140px-wide, near-full-height world view, comfortably over 70%
of the viewport area.

---

## 4. Audio of DK2

**Ambience.** A constant, quiet subterranean drone/rumble bed with sparse
random drips, distant rock creaks, and occasional far-off monster growls —
never silence, never intrusive.

**Mentor lines.** Short, dry, spoken-word event callouts (hunger warnings,
wave incoming, room built, gold running low, creature left the dungeon),
each a few seconds, gated so the same line doesn't spam.

**Creature voices.** Each species has a small set of bark samples: idle
mutters, a pain/hit yelp, a death cry, and a distinct happy/angry
vocalisation set tied to the mood system — these are what make the roster
feel populated even when nothing is on fire.

**Room sounds.** Looping positional sound per room type while the camera is
near it: coin-clinking in the Treasury, snoring in the Lair, clucking in the
Hatchery, clashing training dummies, page-rustling/chanting in the Library.

**Music.** A moody, low-tempo orchestral-synth score that shifts up in
intensity and percussion during an invasion wave, dropping back to ambient
calm once the wave clears.

### Concrete additions to `src/babylon/audio.js`

The module is already fully procedural (`SYNTHS` map of oscillator/noise/
filter/envelope synths keyed by event name, `playSfx(name, opts)` throttled
via `lastPlayed`, plus an existing dedicated ambience bed built from two
detuned low `_osc` drones + filtered `_noise` + an `lfo`, at
`this.ambience = { output, nodes: [droneA, droneB, noise, lfo] }`). This
architecture generalises cleanly to most of the above *except* voice:

- **Ambience** is already close to right (dark drone + noise); add a rare,
  randomly-timed low-probability "distant creak/growl" one-shot scheduled
  from the same tick that drives the LFO, reusing `_noise` + `_filter` +
  `_envelope` exactly as `SYNTHS.dig`/`SYNTHS.claim` already compose them.
- **Room sounds** fit the existing `playSfx(name, opts)` throttling model
  directly: add `SYNTHS.treasuryLoop`, `hatcheryLoop`, etc. as continuous
  synths (persistent oscillator/noise nodes started once and volume-gated by
  camera distance to the nearest room of that type each frame, mirroring how
  `ambience` is started once and left running) rather than one-shots.
- **Procedural "music"** is achievable within this system as a generative
  layer: a slow arpeggiator over a small scale, built from scheduled
  `_osc('triangle', …)` notes through the existing envelope helper,
  intensity-scaled (more notes, added percussion `_noise` hits) when
  `invasion`/wave state is active — this keeps zero asset dependencies but
  will not sound like an orchestral DK2 score; treat it as a placeholder
  bed, not a target.
- **Creature voices and the mentor voice cannot be procedurally synthesised
  to an acceptable quality** — convincing speech and characterful monster
  barks are outside what oscillator/noise synthesis can deliver. These need
  real recorded assets:
  - **Mentor lines**: a small, consistent voice performance (a dozen to a
    few dozen short lines) is the highest-leverage asset in this entire
    document for "feeling like DK2" — even placeholder TTS is better than
    silence for user testing, but a real voice actor pass is worth
    commissioning before ship.
  - **Creature barks**: short (<1s) per-species sample sets (idle, hit,
    death, happy, angry) — a handful of samples per species is enough since
    DK2 itself pitch-shifts a small pool.
  - **Licensing note**: do not source either from DK2's own game files or
    from soundalike packs marketed as "DK2 replacement audio" — use either
    commissioned recordings, a licensed SFX/voice library with a commercial
    game licence (e.g. a paid Envato/Soundsnap/Epidemic Sound tier, checked
    per-asset for "game" usage rights, not just "video"), or a text-to-
    speech voice you have a commercial licence for. Keep a
    `assets/LICENSES.md` entry per source, matching the convention `REVIEW.md`
    section 10.3 already recommends for model attribution.

---

## 5. Character models: per-creature DK2 look sheet

Extends `REVIEW.md` section 10 (`AssetLibrary`, GLB pipeline, authoring
conventions: 1 tile = 1 unit, pivot at feet, forward +Z, PBR metal/rough,
idle/walk/attack/hit/death/dig/carry clip names). Sizes below are "head-to-
toe height in tiles," matching that section's Imp≈0.9 / Bile Demon≈1.6 /
Knight≈1.4 anchors.

**Dungeon creatures** (silhouette / colours / weapon / idle / tile height)

- **Imp** — skinny, hunched, oversized ears/nose, bare-chested. Sickly
  green-grey skin, black loincloth. No weapon (claws / carried pickaxe).
  Idle: rapid foot-tap, shoulder-scratch, always about to move. 0.55–0.6.
- **Goblin** — squat, big head, crude leather scraps, cleaver or short
  sword. Olive skin, brown leather. Idle: bored slouch, weight shifting. 0.75.
- **Warlock** — tall, gaunt, deep hood, trailing robe, glow-tipped staff.
  Dark violet/black, pale blue glow. Idle: slow murmuring sway, hands laced. 0.85.
- **Troll** — wide/heavy-set, small head, huge forearms, wrench or hammer.
  Green-grey hide. Idle: heavy panting bob, confused head-scratch. 1.1.
- **Bile Demon** — obese, pot-bellied, tiny legs, huge jaw. Sickly
  yellow-green, drooling. No weapon (body-slam). Idle: belly-jiggle
  breathing, occasional belch. 1.6.
- **Mistress** — tall, slender, dominatrix silhouette, thigh boots, whip,
  folded bat wings. Black leather, deep red accents. Idle: hip-cocked
  stance, whip twitch. 1.15.
- **Dark Elf** — lithe, twin blades, acrobatic posture. Dark grey-blue
  skin, black leather. Idle: alert crouch-shift, blade twirl. 0.95.
- **Salamander** — reptilian biped, fire-orange/red scales, fire glow at
  mouth/tail, trident. Idle: tail sway, flame puff. 1.0.
- **Skeleton** — bare bone, tattered banner/shield, rusty sword. Bone-white,
  no skin tone. Idle: bone-rattle sway, creaking head tilt. 0.95.
- **Vampire** — sharp formal silhouette, slicked hair, cape collar. Pale
  skin, red-black cape. No weapon (claws/bite). Idle: cape flourish, sudden
  head snaps. 1.0.
- **Black Knight** — full plate, broadsword, heavy silhouette. Near-black
  metal, red Keeper trim. Idle: minimal, slow armoured shift. 1.3.
- **Rogue** — hooded, twin daggers, muted browns/greys built to blend into
  shadow. Idle: shifty over-the-shoulder glance. 0.85.
- **Fly** — small buzzing insectoid, iridescent wings, bite/sting only.
  Idle: constant hover-bob, never still. 0.35.
- **Beetle** — low, wide, armoured shell, mandibles. Idle: shell-plate
  twitch, antenna sweep. 0.4.
- **Maiden** — flowing robe, soft white-gold (an intentional bright
  outlier against the roster), staff or clasped hands, no aggressive
  stance. Idle: serene sway, healing shimmer. 1.05.
- **Horned Reaper** — tall, spindly but top-heavy, huge curved horns,
  massive great-axe. Bright red-orange skin, black loincloth — the roster's
  most saturated creature, signalling maximum danger. Idle: impatient foot
  stomp and axe-twirl, barely-contained rage even standing still. 1.4.

**Hero-side cast** — cooler/neutral palette (blues, silvers, greens,
cream) so mixed-faction screenshots read by colour temperature alone.

- **Knight** — polished plate, longsword, kite shield, silver/blue. Idle:
  sword-arm rest on shield, helm scanning. 1.15.
- **Dwarf** — wide, stocky, huge beard, two-handed axe/pickaxe, iron
  greys. Idle: rocking weight, beard sway, grumbling. 0.7.
- **Archer** — leather-and-cloth, longbow ready, forest green/brown. Idle:
  nock/relax rhythm, scanning. 1.0.
- **Thief** — hooded, dual daggers, dark neutral blue-grey tones. Idle:
  weight on the balls of the feet, glancing. 0.9.
- **Monk** — simple robe, bare-handed or staff, saffron/cream — the
  brightest, calmest hero. Idle: meditative sway, stretch. 0.95.
- **Wizard** — pointed hat, staff, deep blue/silver robe (deliberately
  opposite the Warlock's violet/black). Idle: staff-tap, conjuring
  shimmer. 1.05.
- **Guard** — chainmail plus house-colour tabard, spear and shield, plainer
  than the Knight. Idle: at-ease spear rest. 1.05.
- **Giant** — bare-chested or minimal leather, huge club, tan skin. Idle:
  ground-shaking weight shift, yawn. 1.6+.
- **Fairy** — small winged spellcaster, bright cyan/white glow, wand.
  Idle: constant hover, glow pulse, never grounded. 0.4.
- **Elven Archer** — slimmer/more ornate than the human Archer, longbow,
  green-and-gold, pointed ears. Idle: near-silent poised stillness. 1.0.
- **Royal Guard** — ornate gold-trimmed plate over the Guard silhouette,
  halberd, richer house colours — reads as "escorting someone important."
  Idle: rigid ceremonial stance. 1.1.
- **Lord of the Land** — the named hero tier: cape, crest, ornate sword,
  richest materials of the hero roster, distinct from stock Knights so the
  player clocks "this one matters." Idle: confident, swaggering, cape
  motion. 1.2.

**Cross-cutting notes for the artist/prompt brief.** Keep the dungeon
roster's palette warm-dark (browns, reds, sickly greens, violet) and the
hero roster's palette cool-neutral (blues, silvers, greens, cream) so a
mixed-faction screenshot is legible by colour temperature alone before any
UI label is read. Every creature needs the six clips `entities.js` already
knows how to bind by substring match (`idle|stand`, `walk|run`,
`work|mine|dig`, `carry`, `attack|strike|shoot|cast`, `hit|damage`,
`death|die`), plus `dig`/`carry` specifically for the Imp and a `cast`/
`shoot` clip for every ranged unit (Warlock, Salamander, Archer, Wizard,
Elven Archer, Fairy) per the existing convention in `REVIEW.md` 10.2.
