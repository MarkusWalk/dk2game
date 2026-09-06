# Authored creature pipeline

How every creature model in this repo is built. `tools/sculptkit.py` is the shared toolkit and `tools/create_imp.py` is the reference implementation to copy; read both fully before starting a new creature. The imp is the accepted quality bar: look at `imp-preview.png`, `imp-detail.png` and `imp-side.png`.

## Art direction

The game is a Dungeon Keeper 2 homage and creatures are judged against the DK2 originals. Aim for the actual DK2 silhouette, palette and attitude, rendered at high fidelity: detailed, structured, sculpted, never blocky and never bubbly. Where the game has a class DK2 did not, follow the procedural fallback in `src/babylon/entities.js` (`_build<Name>`) for silhouette and palette and give it the DK2 art style.

## Modeling method (v2, structure instead of balloons)

The first method welded convex ellipsoids with a voxel remesh and then smoothed. That can only produce inflated forms: no concavities, no planes, no hard edges. The retired troll, bile demon, knight, warlock, fly, archer and priest builds still use it and are placeholders until migrated. New work uses `sculptkit`:

- **Sweeps and lofts** (`sweep`, `loft`, `ring`): superellipse cross-sections along a path. Exponent `n` = 2 is an ellipse, 2.5–3.5 a rounded box, so limbs, torsos and skulls get real planes. Ring `dx` moves sideways, `dy` forward (vertical paths) or up (horizontal paths). Ring frames are parallel-transported, so a path may bend freely.
- **Isolated masses** (`superellipsoid`, `sphere`, `ellipsoid`, `block`) for cheekbones, knee caps, pecs, pauldrons, forged sockets.
- **Exact boolean unions** (`union_all`, `boolean`) weld pieces into one manifold body. Unions keep every plane and create creases at joints. Curve-derived `tube`s are fine as islands but not as boolean operands; use sweeps for anything that gets welded. Cutters and pieces must cross surfaces, never graze them tangentially. The helper orients operands by signed volume and refuses a result that empties or halves the mesh, printing `BOOLEAN FAILED`.
- **Carving** (`carve`) gives eye sockets, mouths, nostrils, temples, cheek hollows, sternum and spine grooves, navels, plate gaps. Cutter materials line the cavities (`transfer=True`). Carve before subdividing.
- **Creased subdivision** (`subdivide(o, levels, creases=[(predicate, value)])`) smooths while keeping brow shelves and jaw lines.
- **Seams**: `relax(o, .3, 2)` turns razor boolean seams into sculpted creases; `mark_sharp` splits shading only on genuinely hard edges; `fillet` bevels hard-surface seams. `sharpen` is a seasoning, keep it under 0.3.
- **Hard surfaces** (armor, weapons, buckles) are bevelled blocks and sweeps unioned and filleted, never remeshed.
- **Accessories that hug the sculpt**: `ribbon` (subdivide, shrink-wrap, solidify) for straps and belts, `patch` for studs and rivets, `buckle` for frames with prongs, `conformed`/`surface_point` to seat anything on a surface, `shell` for thin organic sheets (ears, wings, cloaks, fins).
- **Fix weak features by contrast, not mass.** A brow reads when the forehead recedes; a belly reads when the chest above it is narrower.
- **Islands**: head, ears, eyes, hands, lips, teeth, claws and kit stay separate objects bound 100% to one bone. The body gets blended weights from labelled sample points (`blend_weights`).
- **Materials**: procedural Principled shaders (`skin_shader`, `surface_detail`) baked into one 2K PBR atlas by `tools/imp_texture_bake.py` (`bake_pbr_atlas(character, SOURCE/'textures', keep_materials=(...), prefix='<name>')`). Emissive or transparent materials that must survive the bake go in `keep_materials`. Do not edit the bake helper.
- **Budget**: 45k–100k triangles, GLB under 15 MiB. Sweeps are cheap; curve tubes and buckles are not. Print per-part counts in fast mode.

## Iteration loop

- Fast mode (`IMP_FAST=1`, `IMP_PREVIEW_DIR`): skip bake, export and save; render three quick procedural stills (front three-quarter, face close-up, profile) in about 70 s. Judge only from renders; expect five to eight passes. When a body or head vanishes, trace the booleans step by step (build the pieces, union one at a time, print face counts and signed volumes).
- Limit each Blender process to a few render threads when other creatures build concurrently: `scene.render.threads_mode = 'FIXED'; scene.render.threads = 4`.
- Full mode bakes, exports, saves the `.blend`, writes stats, and renders the three stills into `assets/blender/`.
- Blender: `& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python tools/create_<name>.py`. Use `python` (3.11), not `python3`.

## Runtime contract

- `assets/models/<name>.glb`, self-contained GLB with embedded 2K PNG maps, one skinned mesh, one skin, float skin weights that sum to one, triangulated primitives, UVs on every primitive.
- Feet at the origin plane (min Y within 0.02 of 0); flying creatures hover with the root at the ground. Forward is Blender -Y, glTF +Z, Babylon +Z.
- Height before the game's per-type scale (`ENTITY_DEFS` in `src/babylon/entities.js`): imp 1.22, bile demon ~1.75 and very wide, troll ~1.75 hunched, warlock ~1.85, knight ~1.95 with plume, archer ~1.80, priest ~1.90 with mitre, fly hovering with body centre near 0.85 and wings to ~1.2.
- Clips as named NLA tracks exported with `export_animation_mode='NLA_TRACKS'`. Required names: `Idle`, `Walk`, `Attack`, `Hit`, `Death`. Trolls also need `Work`, imps `Mine` and `Carry`. The game matches clip names case-insensitively by substring (`idle`, `walk`/`run`, `work`/`mine`/`dig`, `attack`/`strike`/`shoot`/`cast`, `hit`, `death`).
- Looping clips (everything except `Hit` and `Death`) must have identical first and last poses on every channel. `Hit` and `Death` play once and hold. Movement is in place; gameplay moves the root.
- Choreograph in character axes with the `rot()` helper so diagonal bones do not misdirect swings.
- Materials in the GLB: the baked atlas plus any kept emissive/transparent materials. Emission exports through `KHR_materials_emissive_strength` and glows in Babylon.

## Files per creature

- `tools/create_<name>.py` (copy of the imp script, modeling section rewritten, doc string describing the design)
- `tests/<name>-asset-smoke.mjs` (copy of `tests/imp-asset-smoke.mjs`, adapted: bone count, clip list, height window, budget, any emissive/alpha checks)
- `assets/models/<name>.glb`, `assets/models/<name>.stats.json`
- `assets/blender/<name>.blend`, `assets/blender/<name>-preview.png`, `<name>-detail.png`, `<name>-side.png`
- `assets/blender/textures/<name>-basecolor.png`, `-normal.png`, `-occlusion.png`, `-roughness-metallic.png`

Names are kebab-case (`bile-demon`, not `bileDemon`). Registration in `index.html`, the viewer and the README is done centrally; do not edit `index.html`, `assets/models/preview.html`, `assets/blender/README.md`, `tools/sculptkit.py`, `tools/create_imp.py` or `tools/imp_texture_bake.py` from a creature build, and do not commit.

## Verification

`node tests/<name>-asset-smoke.mjs` must pass. Read your own three renders and compare them with the DK2 reference and the imp renders before calling the model done. Do not open the browser; the central integration step checks every GLB in the Babylon viewer.
