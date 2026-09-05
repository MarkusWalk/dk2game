# Reference imp

`imp.blend` is the editable Blender 5.2 source. `../models/imp.glb` is the self-contained Babylon.js asset. `imp-preview.png`, `imp-detail.png` and `imp-side.png` are Blender studio renders. The supplied `Imp_Sample.png` is packed into the blend file for further modeling.

The current revision is a high-fidelity Dungeon Keeper 2 worker imp: rust-red hide that darkens toward the spine, a heavy V-shaped scowl over pupil-less glowing amber eyes, a broad flat nose, a wide grin of small pointed teeth with two larger corner fangs, long pointed bat ears rooted behind the temples and swept out and back, a hunched knuckle-dragging stance with the head sunk between the shoulders, a pot belly, big three-fingered clawed hands and three-toed clawed feet, a studded belt with a forged buckle, a diagonal chest harness, a hip satchel, a tattered oxblood loincloth, a studded bracer on the left forearm, and a rope-lashed pick with a chunky forged head. It replaces the cute interpretation, which is preserved as `imp-cute-v3.blend`, `imp-cute-v3.png` and `../models/imp-cute-v3.glb`; the earlier `imp-lowpoly-v1` and `imp-detailed-v2` files also remain. The cute worker's backpack was dropped because the DK2 imp does not carry one.

Visual references were the DK2 in-game imp and manual concept art in the [Dungeon Keeper Wiki's Imp article](https://dungeonkeeper.fandom.com/wiki/Imp#Dungeon_Keeper_2), the [DK2 creature portrait](https://dungeonkeeper2.gamecoyote.com/creatures.php), and the supplied `Imp_Sample.png`. The original artwork is referenced, not embedded in the model's textures.

Nothing is left as a raw box or flat plane. The body, head, hands, satchel and pick head are each sculpted from many overlapping primitives that are voxel-remeshed into one continuous smooth form. The ears are parametric cartilage shells with a dished inner face, thick base and thin rolled rim. Lips and forehead wrinkles are seated on the first head sculpt and welded in by a second remesh; teeth, nostrils and the mouth cavity are seated on the final surface. Straps, belt, bracer and the loincloth waistband are shrink-wrapped onto the body so they hug the anatomy instead of floating. Buckles are forged frames with rounded corners and prongs. Skin mottling, cellular hide cracks and pores, leather grain, wood grain, hemp twist and metal roughness are authored procedurally in Blender and baked for glTF.

- Approximately 83,000 triangles; exact counts are regenerated in `../models/imp.stats.json`.
- Three material slots: one shared PBR atlas, the glowing amber eye, and the white-hot eye core. The eye materials export with `KHR_materials_emissive_strength` so the eyes glow in Babylon.
- Three embedded 2048 × 2048 PNG textures: base color, tangent-space normals, and packed roughness/metallic. No external texture fetches are required. A restrained occlusion tint is included in base color; the separate occlusion source is retained in `textures/`.
- One mesh with a 20-bone rig: root, hips, chest, head, two eye bones for stylized blinks, two ear bones for flicks and drooping, and arms, hands, legs and feet. The body is welded with blended neighboring bone weights; the head, ears, hands and equipment remain bone-attached islands. This is a game sculpt with simple facial motion, not a full facial animation rig or manually retopologized cinematic mesh.
- Height: approximately 1.22 units before the game's existing 0.88 imp scale. The head is roughly 30% of standing height, as in the original.
- Feet at the origin plane. Forward is Blender -Y, glTF +Z, and Babylon left-handed +Z after its loader conversion.
- Clips: `Idle` (4 s curious glances, breathing, blinks and ear flicks), `Walk` (0.73 s bouncy scurry with bobbing ears), `Mine` (1.4 s anticipation, wind-up, impact and recovery), `Carry` (1 s braced gait), `Attack` (0.8 s separate swipe with pinned ears), `Hit` (0.6 s recoil with ears flattened back), and `Death` (1.6 s collapse with drooping ears). Movement is in place; gameplay controls translation. Carry is a carrying pose without a separate cargo prop. Hit and Death play once; the other clips have matching first/last poses. Choreography is authored in character axes so diagonal bone rolls do not misdirect limb swings.

The clips are stored as named NLA tracks. All tracks are muted in the saved source to show the neutral modeling pose. Unmute one track in Blender to preview it. The rebuild exports all named tracks. Cameras, studio lighting, and the ground are excluded from the GLB.

The viewer offers links to all four versions, animation buttons, pause/play, and a pose slider. These are separate versions, not an automatic runtime LOD system. `imp-detail.png` shows the current face and materials close up and `imp-side.png` shows the hunch and ear sweep in profile. The texture sources are in `textures/` and packed into the editable blend file; their shader authoring materials are retained as well.

The default `index.html` registers `entity:imp` with the existing asset library. Procedural fallback remains available if loading fails. No gameplay behavior was changed.

Serve the repository over HTTP and open `/assets/models/preview.html` for an orbitable Babylon viewer with clip buttons, or open `/index.html` for the game.

Rebuild from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python tools/create_imp.py
```

For look development, set `IMP_FAST=1` (and optionally `IMP_PREVIEW_DIR`) to skip baking, export and saving; the script then renders three quick procedural stills in about 25 seconds.

Validate with `node tests/imp-asset-smoke.mjs` plus the repository's usual syntax and system smoke checks.
