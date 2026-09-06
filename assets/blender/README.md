# Authored creatures

Every creature in the game has an authored Blender 5.2 source (`<name>.blend`), a self-contained Babylon.js asset (`../models/<name>.glb`), three studio renders (`<name>-preview.png`, `<name>-detail.png`, `<name>-side.png`), baked texture sources in `textures/`, a build script (`../../tools/create_<name>.py`) and a smoke test (`../../tests/<name>-asset-smoke.mjs`). `PIPELINE.md` describes the method and the runtime contract; `../../tools/sculptkit.py` is the shared toolkit. The default `index.html` registers every finished creature with the asset library; the procedural fallbacks remain if a GLB fails to load. No gameplay behavior changed.

Serve the repository over HTTP and open `/assets/models/preview.html` for an orbitable Babylon viewer with a creature switcher, clip buttons, pause/play and a pose slider, or `/index.html` for the game.

## Two modeling methods

The **first method** welded convex ellipsoids with a voxel remesh and smoothed the result. It produces complete, animated, tested models, but every form is inflated: no eye sockets, no planes, no hard edges. It was retired after review because everything looked bubbly.

The **second method** (`sculptkit`) builds structure: superellipse sweeps and lofts give limbs, torsos and skulls real planes; exact boolean unions weld them so joint creases survive; boolean carving cuts eye sockets, mouths, nostrils, temples, cheek hollows, sternum and spine grooves; creased subdivision smooths without losing brow shelves; hard-surface parts are bevelled and filleted, never remeshed; straps and studs are shrink-wrapped and seated on the sculpt. The imp is the reference implementation. The other seven creatures below were built with the first method and are placeholders until they are migrated.

## Imp (reference, second method)

`imp.blend`, `../models/imp.glb`, `tools/create_imp.py`. The Dungeon Keeper 2 worker imp: rust-red hide that darkens toward the spine, a heavy V-shaped scowl ridge sunk into the skull over deep-set glowing amber eyes in carved sockets, a broad flat nose with carved nostrils, a carved grin lined with small pointed teeth and corner fangs, long pointed bat ears rooted behind the temples and swept out and back, a hunched stance with the head sunk between the shoulders, a flat-fronted chest with pectorals and a sternum groove over a pot belly with a navel, profiled arms with deltoid and bicep swells, knee caps, flat-soled feet and three-fingered clawed hands, a studded belt with a forged buckle, chest harness, hip satchel, tattered loincloth, studded bracer, and a rope-lashed pick with a bevelled forged head. The supplied `Imp_Sample.png` is packed into the blend file as the modeling reference.

- 61,966 triangles, 20 bones (eyes blink, ears flick and droop), three material slots (2K PBR atlas, glowing eye, white-hot core), three embedded 2048 × 2048 maps, 1.22 units tall before the game's 0.88 scale.
- Clips: `Idle` (4 s glances, breathing, blinks, ear flicks), `Walk` (0.73 s scurry), `Mine` (1.4 s wind-up, strike, recovery), `Carry` (1 s braced gait), `Attack` (0.8 s swipe), `Hit` (0.6 s recoil), `Death` (1.6 s collapse with drooping ears).
- Earlier revisions are preserved for comparison: `imp-lowpoly-v1`, `imp-detailed-v2`, `imp-cute-v3` (blend, render and GLB each). The viewer links them under the imp entry. They are separate versions, not runtime LODs.

## Placeholders (first method)

| Creature | Triangles | Bones | Height | Clips | Notes |
|---|---|---|---|---|---|
| Bile Demon | 84,030 | 19 | 1.74 (1.63 wide) | Idle, Walk, Attack, Hit, Death | `belly` bone jiggles the gut; red coal eyes with a white core glow; three riveted belly bands, spiked collar, shackle cuffs, tusks |
| Troll | 87,572 | 22 | 1.75 | Idle, Walk, Work, Attack, Hit, Death | Blacksmith: bulbous nose, brow shelf, tusks, scorched apron, pauldrons, tongs, two-handed forge hammer; `Work` drives the workshop; dull ember eyes below HDR |
| Warlock | 85,582 | 22 | 1.85 | Idle, Walk, Attack, Hit, Death | Hooded bald sorcerer with a grey goatee, purple layered robes, gold mantle, rope belt with spellbook, staff with a caged violet orb; eyes and orb glow; `orb` bone pulses |
| Fly | 41,800 | 20 | hovers 0.37–1.25 | Idle, Walk, Attack, Hit, Death | Hairy thorax, banded abdomen, emissive red compound eyes, proboscis, six jointed legs, two pairs of alpha-blended veined wings that flutter |
| Knight | 90,410 | 20 | 1.95 to the plume | Idle, Walk, Attack, Hit, Death | Full plate with great helm, red plume, pauldrons, tabard, gauntlets, greaves, sabatons; kite shield with gold cross and boss, longsword; sword and shield have bones |
| Priest | 80,672 | 20 | 2.18 with staff | Idle, Walk, Attack, Hit, Death | Cream robes, red stole, gold-trimmed mitre, beard, censer, halo staff with a glowing blue crystal; `crystal` bone pulses |
| Archer | 89,226 | 26 | 1.80 | Idle, Walk, Attack, Hit, Death | DK2 Elven Archer: green hood over an elven face with pointed ears, laced leather jerkin, cloak, bracers, laced boots, quiver with arrows, longbow with a bone and a drawn string in Attack; the rebuild was stopped mid-polish, so the face shading and neck are rougher than the rest |

All placeholders pass their smoke tests, load in the viewer and are registered in the game manifest. The first-method scripts still work and document each design in their doc strings.

## Conventions

- Feet on the origin plane. Forward is Blender -Y, glTF +Z, Babylon +Z after its loader conversion.
- Clips are named NLA tracks, muted in the saved sources to show the neutral pose; unmute one in Blender to preview it. Looping clips have identical first and last poses; `Hit` and `Death` play once. Movement is in place.
- Emissive materials export with `KHR_materials_emissive_strength`; wing transparency uses glTF alpha blending.
- Textures are baked from procedural shaders into one 2K atlas per creature (`textures/<name>-basecolor.png`, `-normal.png`, `-roughness-metallic.png`, plus the `-occlusion.png` source that is folded into base color).

## Rebuilding

From the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python tools/create_imp.py
```

Replace `imp` with any creature name. For look development, set `IMP_FAST=1` (and optionally `IMP_PREVIEW_DIR`) to skip baking, export and saving; the script renders three quick procedural stills in about a minute. Validate with `node tests/<name>-asset-smoke.mjs` plus the repository's usual syntax and system smoke checks.
