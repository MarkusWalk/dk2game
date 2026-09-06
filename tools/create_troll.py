"""Build the Dungeon Keeper 2 troll — the dungeon blacksmith — with Blender 5.x (no add-ons).

Run: blender --background --python tools/create_troll.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead
(the environment variable names are shared across every creature script).
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the DK2 troll, the workshop creature that forges traps and doors.
Stocky and hunched, barrel-chested over a heavy pot belly, olive-green hide with
a yellow-green belly and face and a darker spine. A huge bulbous flat nose
dominates a broad face, small amber eyes sit deep under a heavy brow, the jaw
under-bites with two upward tusks, the skull is bald and lumpy and the ears are
small points. Long thick arms end in four-fingered hands with blunt claws; the
legs are short and bowed over wide three-toed feet. The kit is a smith's: a
scorched leather apron with bib and neck strap, riveted dark-steel pauldrons, a
wide belt with a pouch and hanging tongs, forearm wraps, and a two-handed
forge hammer carried in the right hand.

Everything is sculpted from overlapping primitives that are voxel-remeshed into
smooth continuous forms; nothing is left as a bare box or flat plane. All
modelling coordinates are "working units"; the finished mesh is scaled so the
troll stands exactly TARGET_HEIGHT units tall with its soles on the origin plane.
"""
import bpy
import math
import random
import json
import os
import sys
from pathlib import Path
from mathutils import Vector, Quaternion
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/models'
SOURCE = ROOT / 'assets/blender'
FAST = bool(os.environ.get('IMP_FAST'))
PREVIEW = Path(os.environ.get('IMP_PREVIEW_DIR') or SOURCE)
TARGET_HEIGHT = 1.75          # pre-scale height contracted in assets/blender/PIPELINE.md
random.seed(41)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
# Several creatures build at once; never take more than four render threads.
bpy.context.scene.render.threads_mode = 'FIXED'
bpy.context.scene.render.threads = 4

# ---------------------------------------------------------------- materials
def material(name, color, metallic=0, roughness=.8, emission=0, emission_color=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    if emission:
        p.inputs['Emission Color'].default_value = (*(emission_color or color), 1)
        p.inputs['Emission Strength'].default_value = emission
    return m

# Palette lifted from the game's procedural fallback (`_buildTroll` in
# src/babylon/entities.js): trollSkin #587b55 and trollLight #84a668, converted
# to linear. Olive hide, yellow-green belly and face, near-black spine.
SKIN_BASE = (.098, .198, .091)
SKIN_DARK = (.042, .092, .040)
SKIN_LIGHT = (.231, .381, .139)
skin = material('Hide | olive troll', SKIN_BASE, 0, .66)
ear_inner = material('Ear | inner cartilage', (.16, .13, .075), 0, .70)
apron_hide = material('Apron | scorched leather', (.052, .030, .018), 0, .78)
leather = material('Leather | tan strapping', (.115, .062, .030), 0, .74)
leather_edge = material('Leather | scuffed edges', (.17, .100, .048), 0, .70)
dark_steel = material('Steel | dark forged', (.048, .052, .058), .85, .44)
steel = material('Steel | rivets and buckles', (.20, .21, .22), .85, .34)
wood = material('Haft | ash', (.155, .082, .034), 0, .70)
rope = material('Hammer | hemp whipping', (.30, .24, .13), 0, .92)
claw = material('Claws | blunt dark horn', (.048, .042, .034), 0, .46)
tusk = material('Tusks | stained ivory', (.50, .455, .315), 0, .48)
dark = material('Mouth cavity', (.014, .010, .006), 0, .70)
# Small amber eyes: a low emission keeps them alive in the dungeon gloom without
# turning the troll into a lantern the way the imp's molten eyes do.
amber = material('Eyes | amber ember', (.58, .19, .022), 0, .28, .30, (1, .46, .07))

def surface_detail(mat, scale, depth, color_variation=.15, stretch=(1, 1, 1), bump=.28):
    """Author procedural surfaces, then bake them into portable PBR texture maps."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    mapping = nodes.new('ShaderNodeVectorMath'); mapping.operation = 'MULTIPLY'
    mapping.inputs[1].default_value = stretch; links.new(tex.outputs['Object'], mapping.inputs[0])
    noise = nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 3.0; noise.inputs['Roughness'].default_value = .7
    links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    color = p.inputs['Base Color'].default_value[:3]
    ramp.color_ramp.elements[0].position = .16
    ramp.color_ramp.elements[0].color = (*(c * (1 - color_variation) for c in color), 1)
    ramp.color_ramp.elements[1].position = .84
    ramp.color_ramp.elements[1].color = (*(min(1, c * (1 + color_variation)) for c in color), 1)
    links.new(noise.outputs['Fac'], ramp.inputs[0]); links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    fine = nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = scale * 9
    fine.inputs['Detail'].default_value = 2; links.new(mapping.outputs['Vector'], fine.inputs['Vector'])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = bump
    bmp.inputs['Distance'].default_value = depth
    links.new(fine.outputs['Fac'], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = max(.2, p.inputs['Roughness'].default_value - .10)
    rough.inputs['To Max'].default_value = min(1, p.inputs['Roughness'].default_value + .08)
    links.new(noise.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

def scorch(mat, scale=9.0):
    """Soot blooms and burn scars for the apron: a smith's leather is never clean."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    burn = nodes.new('ShaderNodeTexNoise'); burn.inputs['Scale'].default_value = scale
    burn.inputs['Detail'].default_value = 5; burn.inputs['Roughness'].default_value = .74
    links.new(tex.outputs['Object'], burn.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .40; ramp.color_ramp.elements[0].color = (.008, .006, .005, 1)
    ramp.color_ramp.elements[1].position = .66; ramp.color_ramp.elements[1].color = (.115, .066, .034, 1)
    links.new(burn.outputs['Fac'], ramp.inputs[0])
    existing = p.inputs['Base Color'].links
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MIX'
    mix.inputs[0].default_value = .62
    if existing: links.new(existing[0].from_socket, mix.inputs[6])
    else: mix.inputs[6].default_value = p.inputs['Base Color'].default_value
    links.new(ramp.outputs['Color'], mix.inputs[7]); links.new(mix.outputs[2], p.inputs['Base Color'])

def skin_shader(mat, base, shadow, highlight, belly, front=-.46, back=.26):
    """Mottled hide: blotchy olive, a yellow-green belly and face, a dark spine.

    Coordinates are the character's final game units, so the front/back gradient
    is authored against the finished silhouette rather than the working sculpt."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 6.5
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .62
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .68; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    # Front half: fade toward the pale yellow-green belly and face.
    warm = nodes.new('ShaderNodeMapRange')
    warm.inputs['From Min'].default_value = front * .40; warm.inputs['From Max'].default_value = front
    # Only the very front of the belly and face go pale: mixing the light tone
    # in any harder washes the olive out of the whole silhouette.
    warm.inputs['To Min'].default_value = 0; warm.inputs['To Max'].default_value = .52
    warm.clamp = True
    links.new(sep.outputs['Y'], warm.inputs['Value'])
    lighten = nodes.new('ShaderNodeMix'); lighten.data_type = 'RGBA'; lighten.blend_type = 'MIX'
    lighten.inputs[7].default_value = (*belly, 1)
    links.new(warm.outputs[0], lighten.inputs[0]); links.new(ramp.outputs['Color'], lighten.inputs[6])
    # Back half: the spine, shoulders and the backs of the joints go nearly black.
    cool = nodes.new('ShaderNodeMapRange')
    cool.inputs['From Min'].default_value = 0; cool.inputs['From Max'].default_value = back
    cool.inputs['To Min'].default_value = 0; cool.inputs['To Max'].default_value = .70
    cool.clamp = True
    links.new(sep.outputs['Y'], cool.inputs['Value'])
    darken = nodes.new('ShaderNodeMix'); darken.data_type = 'RGBA'; darken.blend_type = 'MULTIPLY'
    darken.inputs[7].default_value = (.36, .40, .34, 1)
    links.new(cool.outputs[0], darken.inputs[0]); links.new(lighten.outputs[2], darken.inputs[6])
    links.new(darken.outputs[2], p.inputs['Base Color'])
    # Bump: warty hide cells plus fine pores, baked to the tangent normal map.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 46
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    cracks = nodes.new('ShaderNodeMapRange'); cracks.inputs['From Max'].default_value = .034
    links.new(vor.outputs['Distance'], cracks.inputs['Value'])
    warts = nodes.new('ShaderNodeTexVoronoi'); warts.feature = 'F1'
    warts.inputs['Scale'].default_value = 24
    links.new(tex.outputs['Object'], warts.inputs['Vector'])
    wartramp = nodes.new('ShaderNodeMapRange'); wartramp.inputs['From Min'].default_value = .0
    wartramp.inputs['From Max'].default_value = .09; wartramp.inputs['To Min'].default_value = .55
    wartramp.inputs['To Max'].default_value = 0
    links.new(warts.outputs['Distance'], wartramp.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 105
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .55
    links.new(cracks.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'ADD'
    links.new(m1.outputs[0], m2.inputs[0]); links.new(wartramp.outputs[0], m2.inputs[1])
    m3 = nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY_ADD'; m3.inputs[1].default_value = .28
    links.new(pores.outputs['Fac'], m3.inputs[0]); links.new(m2.outputs[0], m3.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .26
    bmp.inputs['Distance'].default_value = .004
    links.new(m3.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .56
    rough.inputs['To Max'].default_value = .76
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

skin_shader(skin, SKIN_BASE, SKIN_DARK, (.140, .262, .116), SKIN_LIGHT)
surface_detail(ear_inner, 42, .0015, .22)
surface_detail(apron_hide, 40, .0026, .30, (1, 1, 1.4))
scorch(apron_hide)
surface_detail(leather, 50, .002, .25)
surface_detail(leather_edge, 42, .0015, .28)
surface_detail(wood, 16, .003, .42, (7, 7, .4))
surface_detail(rope, 85, .0025, .30, (1, 1, .25), .5)
surface_detail(dark_steel, 34, .0016, .34)
surface_detail(steel, 50, .0007, .2)
surface_detail(claw, 16, .001, .22, (3, 3, .5))
surface_detail(tusk, 22, .0008, .18)

# ---------------------------------------------------------------- helpers
parts = []

def own(o, mat, bone):
    o.data.materials.clear()
    o.data.materials.append(mat)
    o['bone'] = bone
    parts.append(o)
    return o

def activate(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def smooth(o):
    for p in o.data.polygons: p.use_smooth = True

def curve(t, keys):
    """Smoothstep between keyed values; shared by the sculpt profiles and the clips."""
    for (a, v), (b, w) in zip(keys, keys[1:]):
        if t <= b:
            u = max(0, min(1, (t - a) / (b - a))); u = u * u * (3 - 2 * u)
            return v + (w - v) * u
    return keys[-1][1]

def track(t, keys):
    """Plain linear interpolation over (key, value) pairs, for profile tables."""
    if t <= keys[0][0]: return keys[0][1]
    for (a, v), (b, w) in zip(keys, keys[1:]):
        if t <= b: return v + (w - v) * (t - a) / (b - a)
    return keys[-1][1]

def ell(name, pos, size, mat=None, bone='chest', sub=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=pos)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or skin, bone)

def limb(name, a, b, r, bone, mat=None, bulge=1.08, ry=None):
    """An ellipsoid aligned to a joint-to-joint segment."""
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(a + b) / 2)
    o = bpy.context.object; o.name = name; o.scale = (r, ry or r, d.length / 2 * bulge)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or skin, bone)

def block(name, pos, size, mat, bone, bevel=.03, rot=(0, 0, 0)):
    """A bevelled block for forged and stitched pieces; never left as a raw box."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    m = o.modifiers.new('Worn corners', 'BEVEL'); m.width = bevel; m.segments = 3; apply_modifier(o, m)
    smooth(o); return own(o, mat, bone)

def mesh(name, verts, faces, mat, bone):
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    return own(o, mat, bone)

def rod(name, a, b, r1, r2, mat, bone, sides=12):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r1, radius2=r2, depth=(b - a).length, location=(a + b) / 2)
    o = bpy.context.object; o.name = name
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat, bone)

def tube(name, points, radius, mat, bone, taper=None, cyclic=False, res=2, segments=6):
    curve_data = bpy.data.curves.new(name, 'CURVE'); curve_data.dimensions = '3D'
    curve_data.resolution_u = segments; curve_data.bevel_depth = radius; curve_data.bevel_resolution = res
    curve_data.use_fill_caps = True
    spline = curve_data.splines.new('BEZIER'); spline.bezier_points.add(len(points) - 1); spline.use_cyclic_u = cyclic
    for i, (bp, co) in enumerate(zip(spline.bezier_points, points)):
        bp.co = co; bp.handle_left_type = 'AUTO'; bp.handle_right_type = 'AUTO'
        if taper: bp.radius = max(.04, taper(i / (len(points) - 1)))
    o = bpy.data.objects.new(name, curve_data); bpy.context.collection.objects.link(o)
    activate(o); bpy.ops.object.convert(target='MESH'); o = bpy.context.object
    smooth(o); return own(o, mat, bone)

def apply_modifier(o, mod):
    activate(o); bpy.ops.object.modifier_apply(modifier=mod.name)

def union(name, objects, voxel, ratio=1.0, mat=None, smoothing=2, bone=None):
    """Weld overlapping primitives into one continuous sculpt."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True); parts.remove(o)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    o = bpy.context.object; o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mod = o.modifiers.new('Sculpt union', 'REMESH'); mod.mode = 'VOXEL'; mod.voxel_size = voxel
    apply_modifier(o, mod)
    if smoothing:
        mod = o.modifiers.new('Relax', 'SMOOTH'); mod.factor = .6; mod.iterations = smoothing
        apply_modifier(o, mod)
    if ratio < 1:
        mod = o.modifiers.new('Game budget', 'DECIMATE'); mod.ratio = ratio
        apply_modifier(o, mod)
    o.data.materials.clear(); o.data.materials.append(mat or skin)
    for p in o.data.polygons: p.material_index = 0; p.use_smooth = True
    if bone: o['bone'] = bone
    parts.append(o)
    bpy.context.view_layer.update()
    return o

def proxy(name, objects):
    """A throwaway welded copy used as a shrink-wrap target (belt over apron)."""
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.duplicate()
    copies = list(bpy.context.selected_objects)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    p = bpy.context.object; p.name = name
    return p

def drop(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    bpy.context.view_layer.objects.active = o; bpy.ops.object.delete()

def surface_point(target, p, offset=0):
    ok, loc, normal, _ = target.closest_point_on_mesh(Vector(p))
    return loc + normal * offset, normal

def conformed(points, target, offset):
    return [surface_point(target, p, offset)[0] for p in points]

def patch(name, p, size, mat, bone, target, offset=0, sub=2):
    """An ellipsoid seated on a sculpted surface, its Y axis along the surface normal."""
    loc, n = surface_point(target, p, offset)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    o.rotation_euler = n.to_track_quat('Y', 'Z').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat, bone)

def ribbon(name, points, width, mat, bone, target, gap, thickness, cyclic=False, subdiv=1):
    """A strap that hugs the sculpt: subdivided, shrink-wrapped, then given leather thickness."""
    pts = [Vector(p) for p in points]; n = len(pts); verts = []
    for i, p in enumerate(pts):
        prev = pts[(i - 1) % n] if cyclic else pts[max(0, i - 1)]
        nxt = pts[(i + 1) % n] if cyclic else pts[min(n - 1, i + 1)]
        tangent = (nxt - prev).normalized()
        _, normal = surface_point(target, p, 0)
        across = tangent.cross(normal).normalized()
        verts += [p - across * width / 2, p + across * width / 2]
    count = n if cyclic else n - 1
    faces = [(2 * i, 2 * i + 1, 2 * ((i + 1) % n) + 1, 2 * ((i + 1) % n)) for i in range(count)]
    o = mesh(name, verts, faces, mat, bone)
    if subdiv:
        m = o.modifiers.new('Soften', 'SUBSURF'); m.levels = subdiv; apply_modifier(o, m)
    m = o.modifiers.new('Fit', 'SHRINKWRAP'); m.target = target; m.wrap_method = 'NEAREST_SURFACEPOINT'
    m.offset = gap + thickness / 2; apply_modifier(o, m)
    m = o.modifiers.new('Thickness', 'SOLIDIFY'); m.thickness = thickness; m.offset = 0; apply_modifier(o, m)
    smooth(o); return o

def sheet(name, P, nu, nv, mat, bone, wrap_u=False):
    """A parametric grid surface: the 2D generalisation of ribbon(), used for the
    apron and the pauldron domes so both are single continuous panels."""
    verts = []; rows = []
    cols = nv if wrap_u else nv + 1
    for i in range(nu + 1):
        row = []
        for j in range(cols):
            row.append(len(verts)); verts.append(P(i / nu, j / nv))
        rows.append(row)
    faces = []
    for i in range(nu):
        for j in range(cols if wrap_u else cols - 1):
            k = (j + 1) % cols
            faces.append((rows[i][j], rows[i][k], rows[i + 1][k], rows[i + 1][j]))
    o = mesh(name, verts, faces, mat, bone)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    return o

def drape(o, target, offset, thickness, subdiv=1, weights=None):
    """Smooth, conform and thicken a sheet. `weights(co) -> 0..1` lets the top of a
    panel hug the body while the skirt hangs free."""
    if subdiv:
        m = o.modifiers.new('Soften', 'SUBSURF'); m.levels = subdiv; apply_modifier(o, m)
    group = None
    if weights:
        group = o.vertex_groups.new(name='conform')
        for v in o.data.vertices:
            w = weights(v.co)
            if w > 0: group.add([v.index], min(1, w), 'REPLACE')
    m = o.modifiers.new('Fit', 'SHRINKWRAP'); m.target = target; m.wrap_method = 'NEAREST_SURFACEPOINT'
    m.offset = offset + thickness / 2
    if group: m.vertex_group = group.name
    apply_modifier(o, m)
    m = o.modifiers.new('Thickness', 'SOLIDIFY'); m.thickness = thickness; m.offset = 0; apply_modifier(o, m)
    smooth(o); return o

def graded_bind(o, fn):
    """Hand-weight an accessory across several bones (fn(co) -> {bone: weight})."""
    table = []; names = {}
    for v in o.data.vertices:
        w = {k: x for k, x in fn(v.co).items() if x > 0}
        total = sum(w.values()) or 1
        table.append({k: x / total for k, x in w.items()})
        for k in w: names[k] = None
    for k in names: names[k] = o.vertex_groups.new(name=k)
    for i, w in enumerate(table):
        for k, x in w.items(): names[k].add([i], x, 'REPLACE')
    o['weighted_body'] = True
    return o

def buckle(name, p, w, h, bone, target, offset, right=None, radius=.02, mat=None):
    """A forged frame buckle with rounded corners and a prong, seated on a strap."""
    loc, n = surface_point(target, p, offset)
    right = (Vector(right) if right is not None else n.cross(Vector((0, 0, 1))))
    right = (right - n * right.dot(n)).normalized()
    up = right.cross(n).normalized()
    loop = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
    pts = [loc + right * (x * w / 2) + up * (z * h / 2) for x, z in loop]
    tube(name, pts, radius, mat or steel, bone, cyclic=True, res=3)
    rod(name + ' prong', loc + right * (w / 2) - n * .004, loc - right * (w * .12) - n * .004, radius * .75, radius * .5, mat or steel, bone, 8)

def ring(cz, rx, ry, cy=0, steps=32):
    return [(rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps), cz) for i in range(steps)]

# ---------------------------------------------------------------- skeleton landmarks (working units)
# Short bowed legs, a low wide pelvis, and long arms that hang past the knees.
joints = {}
for s, L in ((-1, 'R'), (1, 'L')):
    joints[L] = dict(shoulder=(s * 1.02, -.02, 2.92), elbow=(s * 1.22, -.14, 1.94), wrist=(s * 1.34, -.32, 1.08), hand=(s * 1.40, -.42, .78),
                     hip=(s * .46, .02, 1.56), knee=(s * .66, -.10, .98), ankle=(s * .72, .04, .44), foot=(s * .72, -.60, .14))

# ---------------------------------------------------------------- body sculpt
# Hunched and stocky: a barrel ribcage that is narrow front-to-back sits above a
# pot belly that juts a long way forward, so the gut reads by contrast rather
# than by sheer mass. The neck sinks into a hump between wide shoulders.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Pot belly', (0, -.36, 1.94), (.88, .82, .70), bone='hips'))
B(ell('Belly underside', (0, -.28, 1.52), (.82, .72, .44), bone='hips'))
B(ell('Pelvis', (0, .06, 1.46), (.70, .50, .40), bone='hips'))
B(ell('Barrel ribcage', (0, -.10, 2.50), (.92, .58, .50), bone='spine'))
B(ell('Upper chest', (0, -.18, 2.84), (.96, .50, .34)))
B(ell('Hunched hump', (0, .28, 2.86), (.78, .44, .44)))
B(ell('Trapezius', (0, .06, 3.02), (.64, .44, .30)))
B(ell('Thick neck', (0, -.10, 3.10), (.44, .42, .34)))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    B(ell('Buttock', (s * .34, .32, 1.50), (.42, .36, .34), bone='hips'))
    B(ell('Love handle', (s * .62, -.10, 1.72), (.30, .44, .34), bone='hips'))
    B(ell('Pectoral', (s * .40, -.50, 2.60), (.38, .24, .24), bone='spine'))
    B(ell('Lat', (s * .66, .06, 2.42), (.28, .36, .42), bone='spine'))
    B(ell('Collar', (s * .62, -.30, 2.90), (.38, .28, .24)))
    B(ell('Deltoid', (s * 1.02, -.04, 2.86), (.40, .40, .42), bone=f'upper_arm.{L}'))
    B(limb('Bicep', j['shoulder'], j['elbow'], .32, f'upper_arm.{L}', ry=.34))
    B(ell('Elbow', j['elbow'], (.28, .29, .28), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .28, f'forearm.{L}', ry=.30))
    B(ell('Wrist', j['wrist'], (.22, .22, .20), bone=f'forearm.{L}'))
    B(limb('Thigh', j['hip'], j['knee'], .44, f'thigh.{L}', ry=.46))
    B(ell('Knee', j['knee'], (.32, .34, .30), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .36, f'shin.{L}', ry=.38))
    B(ell('Ankle', j['ankle'], (.26, .26, .26), bone=f'shin.{L}'))
    B(ell('Wide foot', (s * .72, -.22, .20), (.46, .62, .20), bone=f'foot.{L}'))
    B(ell('Heel', (s * .72, .24, .20), (.32, .24, .22), bone=f'foot.{L}'))
    for i in range(3):
        x = s * .72 + (i - 1) * .30
        B(ell('Splayed toe', (x, -.80, .14), (.17, .26, .14), bone=f'foot.{L}'))
samples = []
for o in body_parts:
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone']))
tree = KDTree(len(samples))
for i, (co, bone) in enumerate(samples): tree.insert(co, i)
tree.balance()
body = union('Troll body pass 1', body_parts, .032, 1.0, smoothing=1)
# Second pass: the fat folds, spine knuckles and neck creases are seated on the
# first sculpt and welded in, exactly the way the imp's face wrinkles are.
refine = [body]
fold = conformed([(x, -1.2, 1.44 + .10 * (x / .74) ** 2) for x in [-.74 + 1.48 * i / 8 for i in range(9)]], body, -.02)
refine.append(tube('Belly fold', fold, .055, skin, 'hips', lambda t: .55 + .45 * math.sin(math.pi * t)))
gut = conformed([(x, -1.2, 2.18 + .06 * (x / .60) ** 2) for x in [-.60 + 1.20 * i / 7 for i in range(8)]], body, -.03)
refine.append(tube('Upper gut roll', gut, .042, skin, 'spine', lambda t: .5 + .5 * math.sin(math.pi * t)))
spine = conformed([(0, .9, z) for z in [1.72 + (2.98 - 1.72) * i / 7 for i in range(8)]], body, -.012)
refine.append(tube('Spine ridge', spine, .052, skin, 'spine', lambda t: .45 + .55 * math.sin(math.pi * t) ** .5))
for s in (-1, 1):
    crease = conformed([(s * .18, -.9, 2.46), (s * .44, -.8, 2.48), (s * .62, -.6, 2.56)], body, -.02)
    refine.append(tube('Pectoral crease', crease, .034, skin, 'spine', lambda t: math.sin(math.pi * t) ** .6))
    hipline = conformed([(s * .30, -1.1, 1.28), (s * .62, -.9, 1.36), (s * .80, -.5, 1.52)], body, -.02)
    refine.append(tube('Groin crease', hipline, .032, skin, 'hips', lambda t: math.sin(math.pi * t) ** .6))
for z in (3.02, 3.14):
    neck = conformed([(x, .8, z) for x in (-.34, -.17, 0, .17, .34)], body, -.010)
    refine.append(tube('Neck crease', neck, .030, skin, 'chest', lambda t: math.sin(math.pi * t) ** .6))
body = union('Continuous body sculpt', refine, .030, .30, smoothing=1)
body['weighted_body'] = True
# Blunt, worn toe claws: broad and short, nothing like the imp's hooks.
for s, L in ((-1, 'R'), (1, 'L')):
    for i in range(3):
        x = s * .72 + (i - 1) * .30
        tube('Blunt toe claw', [(x, -.96, .14), (x, -1.04, .14), (x, -1.11, .11)], .085, claw, f'foot.{L}',
             lambda t: (1 - .55 * t) * (1 - .25 * t * t), res=1, segments=4)

# ---------------------------------------------------------------- head sculpt
# A broad, bald, lumpy skull with a heavy shelf of brow, a huge bulbous nose and
# a wide flat face. The lower jaw is a separate sculpt so it can under-bite,
# hang tusks and open on a bone of its own.
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, -.16, 3.96), (.56, .54, .45), bone='head'))
H(ell('Skull dome', (0, -.06, 4.18), (.40, .42, .24), bone='head'))
H(ell('Occiput', (0, .18, 3.82), (.50, .40, .40), bone='head'))
H(ell('Neck root', (0, -.02, 3.34), (.38, .36, .32), bone='head'))
# The face plate, lip shelf and cheeks are deliberately shallow: the nose only
# reads as a hanging ball if everything it grows out of recedes behind it.
H(ell('Broad face plate', (0, -.40, 3.68), (.54, .26, .42), bone='head'))
H(ell('Upper lip shelf', (0, -.58, 3.28), (.36, .20, .13), bone='head'))
# The nose is a narrow bridge starting between the eyes that swells into a heavy
# ball hanging well below eye level, overhanging the mouth. It is pulled back
# toward the face on purpose: a nose that reaches too far forward stops reading
# as a nose and turns the whole head into a snout.
H(ell('Nose bridge', (0, -.60, 3.84), (.10, .15, .14), bone='head'))
H(ell('Nose shaft', (0, -.74, 3.66), (.15, .22, .19), bone='head'))
H(ell('Bulbous nose', (0, -.94, 3.48), (.31, .32, .28), bone='head'))
H(ell('Flattened nose tip', (0, -1.14, 3.44), (.26, .13, .24), bone='head'))
H(ell('Nose underside', (0, -.82, 3.28), (.20, .19, .10), bone='head'))
# One continuous bar of brow rather than two arches: a shelf, not eyebrows. It
# rides high and juts a long way forward so the eyes fall into its shadow.
H(ell('Heavy brow bar', (0, -.78, 4.02), (.48, .19, .17), bone='head', rot=(.30, 0, 0)))
H(ell('Glabella knot', (0, -.74, 4.10), (.16, .15, .12), bone='head'))
for s in (-1, 1):
    H(ell('Temple', (s * .40, -.24, 4.00), (.21, .27, .25), bone='head'))
    # Jowls stay small: the nose can only dominate a face that gives it room.
    H(ell('Cheekbone', (s * .40, -.32, 3.68), (.20, .20, .20), bone='head'))
    H(ell('Jaw hinge', (s * .38, -.18, 3.52), (.19, .20, .21), bone='head'))
    H(ell('Nostril wing', (s * .22, -.96, 3.38), (.13, .16, .12), bone='head'))
    H(ell('Cheek pad', (s * .28, -.54, 3.32), (.16, .15, .14), bone='head'))
    # Lower lid: a small pad that closes the socket from underneath. Nothing at
    # all is modelled inside the socket — a recess is made by what surrounds it,
    # so any ellipsoid placed there would simply fill the eye in.
    H(ell('Lower lid pad', (s * .26, -.64, 3.68), (.16, .12, .06), bone='head'))
    H(ell('Brow boss', (s * .30, -.78, 4.00), (.19, .18, .14), bone='head', rot=(.20, -s * .12, 0)))
    # Wings that carry the shelf back into the temples. Without them the brow
    # ends in mid-air at both sides and the head reads as a duck's bill.
    H(ell('Brow wing', (s * .40, -.64, 3.98), (.17, .19, .15), bone='head', rot=(.22, -s * .26, 0)))
head_obj = union('Head sculpt pass 1', head_parts, .022, 1.0, smoothing=2, bone='head')
# Second pass: creases and folds seated on the first sculpt, then welded in.
refine = [head_obj]
for z, y in ((4.20, -.90),):
    brow_fold = conformed([(x, y, z + .03 * math.cos(x * 3)) for x in (-.26, -.13, 0, .13, .26)], head_obj, -.020)
    refine.append(tube('Forehead furrow', brow_fold, .026, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
for s in (-1, 1):
    # Deep nose folds are what separate the hanging nose from the cheeks.
    nasolabial = conformed([(s * .16, -1.12, 3.48), (s * .30, -.94, 3.34), (s * .40, -.78, 3.26)], head_obj, -.034)
    refine.append(tube('Nose fold', nasolabial, .048, skin, 'head', lambda t: math.sin(math.pi * t) ** .5))
    lip = conformed([(s * .06, -1.00, 3.22), (s * .22, -.95, 3.20), (s * .36, -.76, 3.24)], head_obj, .012)
    refine.append(tube('Upper lip', lip, .032, skin, 'head', lambda t: .6 + .4 * math.sin(math.pi * t)))
head_obj = union('Head sculpt', refine, .022, .24, smoothing=1, bone='head')
# A few scattered warts keep the bald skull lumpy without turning it to cauliflower.
for wx, wy, wz, wr in ((.22, .10, 4.24, .050), (-.30, -.02, 4.18, .044), (.06, .30, 4.06, .046),
                       (-.42, -.34, 4.00, .038), (.44, -.38, 3.96, .040)):
    patch('Skull wart', (wx, wy, wz), (wr, wr * .55, wr), skin, 'head', head_obj, .004, sub=2)

# The lower jaw: a separate mass so the under-bite reads and the mouth can open.
jaw_parts = []
def J(o): jaw_parts.append(o); return o
J(ell('Lower jaw', (0, -.70, 3.10), (.42, .38, .18), bone='jaw'))
J(ell('Jutting chin', (0, -.94, 3.08), (.28, .21, .18), bone='jaw'))
J(ell('Lower lip', (0, -.92, 3.20), (.24, .15, .08), bone='jaw'))
for s in (-1, 1):
    J(ell('Jaw ramus', (s * .38, -.26, 3.28), (.17, .28, .23), bone='jaw'))
    J(ell('Jaw corner', (s * .32, -.58, 3.18), (.18, .22, .15), bone='jaw'))
jaw_obj = union('Under-bitten jaw', jaw_parts, .020, .28, smoothing=1, bone='jaw')
# Two small upward tusks, rooted in the lower lip outboard of the hanging nose.
# They sit at x = .32 rather than under the nose: the bulb's widest radius is .31,
# so anything further inboard drives the tusk tip straight through the nostril.
for s in (-1, 1):
    root, _ = surface_point(jaw_obj, (s * .32, -.92, 3.20), -.03)
    tube('Upward tusk', [tuple(root), (s * .325, -.92, 3.32), (s * .32, -.88, 3.43)], .062, tusk, 'jaw',
         lambda t: (1 - t) ** .5 + .10, res=2, segments=4)
    patch('Lower tooth', (s * .10, -.96, 3.26), (.040, .05, .030), tusk, 'jaw', jaw_obj, .010)
# The mouth: a dark slot proud of both lips so the under-bite reads as a grin,
# and a real cavity once the jaw bone drops.
ell('Mouth cavity', (0, -.86, 3.22), (.40, .22, .05), dark, 'head', 2)

# Small amber eyes, seated deep in the socket under the brow shelf and outboard
# of the nose bridge. These are placed at hand-authored coordinates rather than
# by probing the sculpt: closest_point_on_mesh finds the nearest surface in *any*
# direction, and from anywhere in front of the face that surface is the hanging
# nose, which is how the eyes ended up on the nose ball in earlier passes.
EYE = {}
GAZE = Vector((0, -.94, -.34)).normalized()
for s in (-1, 1):
    center = Vector((s * .255, -.68, 3.79))
    EYE[s] = tuple(center)
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ell('Amber eye', tuple(center), (.062, .062, .062), amber, eye_bone, 3)
    ell('Pupil', tuple(center + GAZE * .040), (.026, .026, .026), dark, eye_bone, 2)
for s in (-1, 1):
    patch('Nostril', (s * .12, -.95, 3.10), (.058, .024, .046), dark, 'head', head_obj, .002)
patch('Navel', (0, -1.30, 1.74), (.05, .016, .04), dark, 'hips', body, .001)

# ---------------------------------------------------------------- small pointed ears
# Short, thick and swept back — nothing like the imp's sails.
EAR_BASE = {1: (.50, .02, 3.86), -1: (-.50, .02, 3.86)}
EAR_DIR = {1: (.70, .52, .46), -1: (-.70, .52, .46)}
EAR_LENGTH = .50
def ear(s):
    label = 'L' if s > 0 else 'R'
    base = Vector(EAR_BASE[s])
    d = Vector(EAR_DIR[s]).normalized()
    n = Vector((-s * .40, -1.0, .10)); n = (n - d * n.dot(d)).normalized()
    a = d.cross(n).normalized()
    N, M, L, W = 12, 7, EAR_LENGTH, .40
    def width(u): return W * (1 - u) ** .75 * (.78 + .22 * math.sin(math.pi * u))
    def P(u, v):
        dish = .045 * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.05)) ** .7
        curl = .10 * u * u
        return base + d * (u * L) + a * ((v - .5) * width(u)) + n * (curl - dish)
    def T(u, v): return .022 + .09 * (1 - u) ** 1.4 * (.35 + .65 * math.sin(math.pi * v))
    verts = []; F = []; K = []
    for i in range(N):
        u = i / N * .955
        F.append([]); K.append([])
        for j in range(M + 1):
            v = j / M
            F[i].append(len(verts)); verts.append(P(u, v))
        for j in range(M + 1):
            v = j / M
            K[i].append(len(verts)); verts.append(P(u, v) - n * T(u, v))
    tf = len(verts); verts.append(P(1, .5)); tb = len(verts); verts.append(P(1, .5) - n * .022)
    faces = []; inner = []
    for i in range(N - 1):
        for j in range(M):
            faces.append((F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1])); inner.append(1 <= j <= M - 2 and i < N - 3)
            faces.append((K[i][j], K[i][j + 1], K[i + 1][j + 1], K[i + 1][j])); inner.append(False)
        faces.append((F[i][0], K[i][0], K[i + 1][0], F[i + 1][0])); inner.append(False)
        faces.append((F[i][M], F[i + 1][M], K[i + 1][M], K[i][M])); inner.append(False)
    for j in range(M):
        faces.append((F[0][j], F[0][j + 1], K[0][j + 1], K[0][j])); inner.append(False)
        faces.append((F[N - 1][j], tf, F[N - 1][j + 1])); inner.append(False)
        faces.append((K[N - 1][j], K[N - 1][j + 1], tb)); inner.append(False)
    faces.append((F[N - 1][0], tf, tb, K[N - 1][0])); inner.append(False)
    faces.append((F[N - 1][M], K[N - 1][M], tb, tf)); inner.append(False)
    o = mesh(f'Pointed ear {label}', verts, faces, skin, f'ear.{label}')
    o.data.materials.append(ear_inner)
    for p, flag in zip(o.data.polygons, inner): p.material_index = int(flag)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    m = o.modifiers.new('Cartilage', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    smooth(o); return o
ear(-1); ear(1)

# ---------------------------------------------------------------- forge hammer
# Carried head-up in the right fist so the whole weapon sits inside the
# silhouette; Work and Attack swing it over and down.
HAFT_A = Vector((-1.38, -.18, .16))
HAFT_B = Vector((-1.60, -.90, 2.52))
HAFT_D = (HAFT_B - HAFT_A).normalized()
def on_haft(z):
    t = (z - HAFT_A.z) / (HAFT_B.z - HAFT_A.z)
    return HAFT_A + (HAFT_B - HAFT_A) * t

# ---------------------------------------------------------------- hands
# Four digits: three thick fingers and an opposed thumb, blunt worn claws.
def hand(s):
    L = 'L' if s > 0 else 'R'; bone = f'hand.{L}'; pieces = []; claws = []
    j = joints[L]
    pieces.append(ell('Wrist', j['wrist'], (.24, .24, .20), bone=bone))
    if s < 0:
        # Right hand: a fist closed round the hammer haft.
        for i, z in enumerate((.72, .88, 1.04)):
            c = on_haft(z)
            path = [(c.x + .19, c.y + .04, z), (c.x + .16, c.y - .15, z), (c.x - .02, c.y - .22, z),
                    (c.x - .19, c.y - .11, z), (c.x - .17, c.y + .06, z)]
            pieces.append(tube('Gripping finger', path, .078, skin, bone))
            pieces.append(ell('Knuckle', path[1], (.095, .095, .09), bone=bone, sub=2))
            pieces.append(ell('Fingertip', path[-1], (.082, .082, .082), bone=bone, sub=2))
            claws.append([path[-1], (c.x - .13, c.y + .12, z), (c.x - .07, c.y + .16, z)])
        pieces.append(ell('Palm heel', (on_haft(.94).x + .22, on_haft(.94).y + .04, .94), (.16, .19, .22), bone=bone))
        c = on_haft(1.18)
        thumb = [(c.x + .20, c.y + .06, 1.20), (c.x + .12, c.y + .19, 1.13), (c.x - .06, c.y + .20, 1.08)]
        pieces.append(tube('Thumb', thumb, .088, skin, bone))
        pieces.append(ell('Thumb tip', thumb[-1], (.088, .088, .088), bone=bone, sub=2))
        claws.append([thumb[-1], (c.x - .16, c.y + .15, 1.06), (c.x - .19, c.y + .09, 1.05)])
    else:
        # Left hand: open, hanging, fingers loosely curled.
        pieces.append(ell('Palm', (1.42, -.42, .84), (.23, .17, .26), bone=bone))
        for i in range(3):
            x = 1.28 + .14 * i
            path = [(x, -.48, .70), (x + .02, -.60, .62), (x, -.64, .50), (x - .02, -.58, .42)]
            pieces.append(tube('Curled finger', path, .080, skin, bone))
            pieces.append(ell('Knuckle', path[0], (.092, .092, .092), bone=bone, sub=2))
            pieces.append(ell('Fingertip', path[-1], (.082, .082, .082), bone=bone, sub=2))
            claws.append([path[-1], (x - .03, -.55, .36), (x - .03, -.49, .33)])
        thumb = [(1.30, -.40, .92), (1.18, -.52, .84), (1.14, -.60, .74)]
        pieces.append(tube('Thumb', thumb, .090, skin, bone))
        pieces.append(ell('Thumb tip', thumb[-1], (.090, .090, .090), bone=bone, sub=2))
        claws.append([thumb[-1], (1.12, -.64, .67), (1.14, -.60, .62)])
    union(f'Hand sculpt {L}', pieces, .022, .30, bone=bone)
    for path in claws:
        tube('Blunt claw', path, .046, claw, bone, lambda t: (1 - .5 * t) * (1 - .3 * t * t), res=1, segments=4)
hand(1); hand(-1)

# ---------------------------------------------------------------- blacksmith apron
# One continuous panel: a narrow bib over the chest that flares over the pot
# belly and hangs to the knees. Only the bib and belly rows are shrink-wrapped;
# below the gut the leather hangs plumb off the belly's widest point.
# Rows are authored just in front of the body they will be shrink-wrapped onto:
# a row generated deep inside the chest snaps to whichever surface happens to be
# nearest and tears the panel apart.
APRON = [(2.90, -.78, .42, .55), (2.66, -.80, .48, .62), (2.40, -1.06, .62, .70), (2.16, -1.22, .76, .68),
         (1.94, -1.26, .84, .60), (1.70, -1.24, .86, .55), (1.45, -1.22, .84, .50), (1.15, -1.18, .80, .45)]
APRON_TOP, APRON_HEM = APRON[0][0], APRON[-1][0]
def apron_point(f, g):
    """A bib that flares over the pot belly and hangs to the knee. `wrap` controls
    how far each row curls round the flank so the panel never becomes a barrel."""
    z = APRON_TOP + (APRON_HEM - APRON_TOP) * f
    y = track(-z, [(-k[0], k[1]) for k in APRON])
    hw = track(-z, [(-k[0], k[2]) for k in APRON])
    wrap = track(-z, [(-k[0], k[3]) for k in APRON])
    a = (g * 2 - 1) * math.pi / 2
    return Vector((hw * math.sin(a), y + wrap * hw * (1 - math.cos(a)), z))
apron = sheet('Blacksmith apron', apron_point, 17, 14, apron_hide, 'hips')
drape(apron, body, .045, .036, subdiv=1,
      weights=lambda co: curve(max(0, min(1, (co.z - 1.45) / .45)), [(0, 0), (1, 1)]))
graded_bind(apron, lambda co: {'chest': max(0, (co.z - 2.50) / .40), 'spine': max(0, 1 - abs(co.z - 2.35) / .55),
                               'hips': max(.02, min(1, (2.25 - co.z) / .55))})
# Stitched border and a scuffed hem so the panel is not a bare sheet.
rim = [apron_point(0, g / 8) for g in range(9)] + [apron_point(f / 7, 1) for f in range(1, 8)] + \
      [apron_point(1, 1 - g / 8) for g in range(1, 9)] + [apron_point(1 - f / 7, 0) for f in range(1, 7)]
tube('Apron border', conformed(rim, apron, .012), .022, leather_edge, 'hips', cyclic=True, res=1, segments=2)
# Neck strap: a yoke over the shoulders holding the bib up.
strap = [(.44, -.52, 2.92), (.56, -.10, 2.98), (.36, .22, 3.04), (0, .32, 3.02), (-.36, .22, 3.04), (-.56, -.10, 2.98), (-.44, -.52, 2.92)]
torso = proxy('Apron proxy', [body, apron])
ribbon('Neck strap', strap, .19, leather, 'chest', torso, .020, .036)
for p in ((.42, -.62, 2.88), (-.42, -.62, 2.88)):
    patch('Strap rivet', p, (.038, .022, .038), steel, 'chest', torso, .050)
for p in ((.24, -1.34, 2.44), (-.24, -1.34, 2.44), (.56, -1.10, 1.92), (-.56, -1.10, 1.92)):
    patch('Apron rivet', p, (.040, .024, .040), steel, 'hips', apron, .022)

# ---------------------------------------------------------------- belt, pouch, tongs
belt_ring = ring(1.62, 1.05, .95, -.14, 24)
ribbon('Wide waist belt', belt_ring, .30, leather, 'hips', torso, .018, .056, cyclic=True)
for dz in (-.135, .135):
    tube('Belt piping', conformed(ring(1.62 + dz, 1.05, .95, -.14, 20), torso, .072), .019, leather_edge, 'hips', cyclic=True, res=1, segments=2)
buckle('Waist buckle', (0, -1.45, 1.62), .44, .34, 'hips', torso, .100, right=(1, 0, 0), radius=.036)
for a in (-2.5, -2.0, -1.35, 1.35, 2.0, 2.5, 3.0):
    patch('Belt rivet', (1.05 * math.cos(a), -.14 + .95 * math.sin(a), 1.62), (.034, .020, .034), steel, 'hips', torso, .072)
drop(torso)
# Tool pouch on the left hip, out of the hammer's way.
pouch = union('Tool pouch', [
    ell('Pouch', (1.02, -.14, 1.28), (.20, .30, .28), leather, 'hips'),
    ell('Pouch belly', (1.03, -.14, 1.14), (.21, .28, .20), leather, 'hips'),
    ell('Pouch flap', (1.02, -.15, 1.46), (.21, .32, .10), leather, 'hips'),
], .024, .32, leather, 2, 'hips')
buckle('Pouch buckle', (1.26, -.18, 1.26), .11, .14, 'hips', pouch, .030, right=(0, -1, 0), radius=.016)
ribbon('Pouch strap', conformed([(1.24, -.18, 1.46), (1.26, -.18, 1.38), (1.26, -.18, 1.28)], pouch, .03), .08, leather_edge, 'hips', pouch, .016, .018)
# A pair of blacksmith's tongs hanging from a loop on the front of the belt,
# just outside the apron's edge where they stay visible.
TONG_TOP = Vector((.90, -.66, 1.50))
tube('Tong loop', [(.90, -.70, 1.60), (.98, -.66, 1.54), (.90, -.62, 1.48), (.82, -.66, 1.54)], .026, leather, 'hips', cyclic=True, res=1, segments=3)
for s in (-1, 1):
    rod('Tong arm', TONG_TOP + Vector((s * .05, 0, -.02)), TONG_TOP + Vector((s * .13, -.05, -.62)), .028, .019, dark_steel, 'hips', 8)
    rod('Tong jaw', TONG_TOP + Vector((s * .05, 0, -.02)), TONG_TOP + Vector((s * .10, -.04, .18)), .026, .016, dark_steel, 'hips', 8)
ell('Tong pivot', TONG_TOP, (.05, .05, .05), dark_steel, 'hips', 2)

# ---------------------------------------------------------------- riveted pauldrons
def pauldron(s):
    L = 'L' if s > 0 else 'R'
    center = Vector((s * 1.00, -.06, 2.90))
    axis = Vector((s * .95, -.06, .90)).normalized()
    e1 = axis.cross(Vector((0, 1, 0))).normalized(); e2 = axis.cross(e1).normalized()
    R, K = .54, .98
    def P(u, v):
        a = u * 2 - 1; b = v * 2 - 1
        # Square-to-disc so the plate is a smooth round cap with no pole.
        x = a * math.sqrt(max(0, 1 - b * b / 2)); y = b * math.sqrt(max(0, 1 - a * a / 2))
        return center + (axis + e1 * (x * K) + e2 * (y * K)).normalized() * R
    plate = sheet(f'Pauldron {L}', P, 9, 9, dark_steel, f'upper_arm.{L}')
    drape(plate, body, .032, .050, subdiv=1)
    edge = [P(u / 8, 0) for u in range(8)] + [P(1, v / 8) for v in range(8)] + \
           [P(1 - u / 8, 1) for u in range(8)] + [P(0, 1 - v / 8) for v in range(8)]
    tube(f'Pauldron rim {L}', conformed(edge, plate, .012), .024, dark_steel, f'upper_arm.{L}', cyclic=True, res=1, segments=2)
    for k in range(6):
        a = 2 * math.pi * k / 6 + .3
        probe = center + (axis * .45 + e1 * math.cos(a) + e2 * math.sin(a)).normalized() * (R + .3)
        patch('Pauldron rivet', probe, (.045, .026, .045), steel, f'upper_arm.{L}', plate, .012)
    # A ridge along the crown gives the plate a forged spine.
    crest = conformed([P(.5, v) for v in (.18, .35, .5, .65, .82)], plate, .020)
    tube(f'Pauldron crest {L}', crest, .020, dark_steel, f'upper_arm.{L}', lambda t: .5 + .5 * math.sin(math.pi * t), res=1, segments=2)
pauldron(-1); pauldron(1)

# ---------------------------------------------------------------- forearm wraps
for s, L in ((-1, 'R'), (1, 'L')):
    A, Bv = Vector(joints[L]['elbow']), Vector(joints[L]['wrist'])
    axis = (Bv - A).normalized(); center = A.lerp(Bv, .60)
    e1 = axis.cross(Vector((0, 0, 1))).normalized(); e2 = axis.cross(e1).normalized()
    def arm_ring(offset, r, steps=20):
        return [center + axis * offset + e1 * (r * math.cos(2 * math.pi * i / steps)) + e2 * (r * math.sin(2 * math.pi * i / steps)) for i in range(steps)]
    ribbon(f'Forearm wrap {L}', arm_ring(0, .34, 16), .46, leather, f'forearm.{L}', body, .014, .034, cyclic=True)
    for off in (-.20, -.06, .08, .21):
        tube(f'Wrap turn {L}', conformed(arm_ring(off, .34, 14), body, .052), .020, leather_edge, f'forearm.{L}', cyclic=True, res=1, segments=2)
    patch(f'Wrap tie {L}', center + axis * .02 + e1 * .34, (.045, .026, .045), steel, f'forearm.{L}', body, .052)

# ---------------------------------------------------------------- the forge hammer itself
rod('Hammer haft', HAFT_A, HAFT_B + HAFT_D * .10, .105, .088, wood, 'hand.R', 14)
ell('Haft butt', HAFT_A, (.125, .125, .07), wood, 'hand.R', 2)
p1 = HAFT_D.cross(Vector((0, 1, 0))).normalized(); p2 = HAFT_D.cross(p1).normalized()
# A blunt double-faced sledge head with worn, rounded striking faces.
head_center = HAFT_B - HAFT_D * .06
face_a = head_center - Vector((0, .50, 0))
face_b = head_center + Vector((0, .44, 0))
hammer = union('Forged hammer head', [
    block('Head body', tuple(head_center), (.42, .90, .46), dark_steel, 'hand.R', .06, HAFT_D.to_track_quat('Z', 'Y').to_euler()),
    ell('Striking face', tuple(face_a), (.24, .10, .26), dark_steel, 'hand.R'),
    ell('Peen face', tuple(face_b), (.21, .09, .23), dark_steel, 'hand.R'),
], .020, .32, dark_steel, 1, 'hand.R')
# Iron collar and hemp whipping where the haft enters the head.
for k in range(2):
    c = HAFT_B - HAFT_D * (.30 + .10 * k)
    loop = [c + p1 * (.15 * math.cos(2 * math.pi * i / 10)) + p2 * (.15 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
    tube('Iron collar', loop, .030, dark_steel, 'hand.R', cyclic=True, res=1, segments=3)
for k in range(2):
    c = HAFT_B - HAFT_D * (.53 + .085 * k)
    loop = [c + p1 * (.115 * math.cos(2 * math.pi * i / 8)) + p2 * (.115 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
    tube('Hemp whipping', loop, .026, rope, 'hand.R', cyclic=True, res=1, segments=3)
# Leather grip where the fist closes, in a few overlapping turns.
for k in range(5):
    c = on_haft(.60 + .17 * k)
    loop = [c + p1 * (.118 * math.cos(2 * math.pi * i / 8)) + p2 * (.118 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
    tube('Grip turn', loop, .026, leather, 'hand.R', cyclic=True, res=1, segments=3)

# ---------------------------------------------------------------- bones (working units)
bones = {
    'root': ((0, 0, 0), (0, 0, .40), None),
    'hips': ((0, .02, 1.46), (0, -.06, 2.06), 'root'),
    'spine': ((0, -.06, 2.06), (0, -.10, 2.62), 'hips'),
    'chest': ((0, -.10, 2.62), (0, -.12, 3.10), 'spine'),
    'head': ((0, -.12, 3.24), (0, -.20, 4.34), 'chest'),
    'jaw': ((0, -.34, 3.38), (0, -1.06, 3.12), 'head'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, -.2, 0))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, -.2, 0))), 'head'),
}
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    bones[f'ear.{L}'] = (EAR_BASE[s], tuple(Vector(EAR_BASE[s]) + Vector(EAR_DIR[s]).normalized() * EAR_LENGTH), 'head')
    bones[f'upper_arm.{L}'] = (j['shoulder'], j['elbow'], 'chest'); bones[f'forearm.{L}'] = (j['elbow'], j['wrist'], f'upper_arm.{L}')
    bones[f'hand.{L}'] = (j['wrist'], j['hand'], f'forearm.{L}')
    bones[f'thigh.{L}'] = (j['hip'], j['knee'], 'hips'); bones[f'shin.{L}'] = (j['knee'], j['ankle'], f'thigh.{L}')
    bones[f'foot.{L}'] = (j['ankle'], j['foot'], f'shin.{L}')

# Blend body weights across neighbouring anatomy so joints deform smoothly.
for name in bones: body.vertex_groups.new(name=name)
for vertex in body.data.vertices:
    nearby = tree.find_n(vertex.co, 18)
    closest = {}
    for _, idx, distance in nearby:
        name = samples[idx][1]
        closest[name] = min(distance, closest.get(name, 100))
    nearest = min(closest.values())
    weights = {name: math.exp(-((d - nearest) / .075) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
# The head is sculpted generously for control; settle it about one pivot to reach
# final DK2 proportions instead of editing dozens of coordinates.
HEAD_SCALE = .92; HEAD_PIVOT = Vector((0, -.34, 3.26)); HEAD_SHIFT = Vector((0, -.07, -.02))
def settle(co): return HEAD_PIVOT + (Vector(co) - HEAD_PIVOT) * HEAD_SCALE + HEAD_SHIFT
head_bones = {'head', 'jaw', 'eye.L', 'eye.R', 'ear.L', 'ear.R'}
for o in parts:
    activate(o)
    for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if o['bone'] in head_bones:
        for v in o.data.vertices: v.co = settle(v.co)
    if not o.get('weighted_body'):
        group = o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
bones = {name: ((settle(a) if name in head_bones else Vector(a)), (settle(b) if name in head_bones else Vector(b)), parent)
         for name, (a, b, parent) in bones.items()}
if FAST:
    budget = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in parts), reverse=True)
    for count, name in budget[:20]: print(f'TRIANGLES {count:7d} {name}')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Troll_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Drop the soles onto the origin plane and scale to the contracted 1.75 units.
zs = [v.co.z for v in character.data.vertices]
GROUND = min(zs); SCALE = TARGET_HEIGHT / (max(zs) - GROUND)
for v in character.data.vertices:
    v.co.z -= GROUND
    v.co *= SCALE
def place(v): return Vector((v.x, v.y, v.z - GROUND)) * SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural hide, leather, rope and metal into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(amber,), prefix='troll')

rig_data = bpy.data.armatures.new('Troll_Skeleton')
rig = bpy.data.objects.new('Troll_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = place(a); eb.tail = place(b)
    if parent: eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Troll skeleton', 'ARMATURE'); mod.object = rig
character.parent = rig
rig.show_in_front = True
for p in rig.pose.bones: p.rotation_mode = 'XYZ'
scene = bpy.context.scene; scene.render.fps = 30

# ---------------------------------------------------------------- animation clips
def pose(name, frames, fn):
    rig.animation_data_create(); rig.animation_data.action = None
    act = bpy.data.actions.new(name); rig.animation_data.action = act
    for frame in range(1, frames + 1):
        t = (frame - 1) / (frames - 1)
        for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
        fn(t)
        for p in rig.pose.bones:
            p.keyframe_insert(data_path='location', frame=frame, group=p.name)
            p.keyframe_insert(data_path='rotation_euler', frame=frame, group=p.name)
            p.keyframe_insert(data_path='scale', frame=frame, group=p.name)
    trk = rig.animation_data.nla_tracks.new(); trk.name = name
    strip = trk.strips.new(name, 1, act); strip.name = name
    trk.mute = True
    rig.animation_data.action = None

def rot(b, x=0, y=0, z=0):
    # Express choreography in character axes rather than each diagonal bone's roll.
    basis = rig_data.bones[b].matrix_local.to_quaternion()
    q = Quaternion((0, 0, 1), z) @ Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x)
    rig.pose.bones[b].rotation_euler = (basis.inverted() @ q @ basis).to_euler()

def bump(t, center, width):
    k = max(0, 1 - abs(t - center) / width)
    return math.sin(k * math.pi / 2)

def close_eyes(closure):
    for name in ('eye.L', 'eye.R'):
        eye = rig.pose.bones[name]
        eye.scale.z = 1 - .92 * closure
        eye.scale.x = 1 - .10 * closure
        # Retract the ember as the lid shuts so no wedge projects in profile.
        eye.location.y = .050 * SCALE * closure

def blink(t, centers=(.24, .70)):
    closure = max([max(0, 1 - abs(t - center) / .030) for center in centers] + [0])
    close_eyes(closure)

def jaw(drop, shift=0):
    rot('jaw', .55 * drop, 0, .10 * shift)

def ears(left, right, droop=0):
    rot('ear.L', .18 * left, .12 * left + .60 * droop, -.14 * left)
    rot('ear.R', .18 * right, -.12 * right - .60 * droop, .14 * right)

def spine_lean(amount, twist=0, side=0):
    """Distribute a lean over the three trunk bones so the hunch stays smooth."""
    rot('hips', .18 * amount, .30 * twist, .35 * side)
    rot('spine', .40 * amount, .40 * twist, .35 * side)
    rot('chest', .42 * amount, .30 * twist, .30 * side)

def idle(t):
    # One slow deep breath, a weight shift from foot to foot, and a single heft
    # of the hammer around the middle of the clip.
    breath = math.sin(t * math.tau)
    shift = math.sin(t * math.tau - .6)
    heft = bump(t, .56, .17)
    spine_lean(.10 + .035 * breath, 0, .045 * shift)
    rig.pose.bones['spine'].scale.y = 1 + .022 * breath
    rig.pose.bones['chest'].scale.x = 1 + .016 * breath
    look = curve(t, [(0, 0), (.16, 0), (.30, .17), (.46, .17), (.66, -.14), (.84, -.14), (1, 0)])
    rot('head', -.10 - .05 * breath - .22 * heft, .05 * math.sin(t * math.tau * 2), look)
    jaw(.05 + .045 * math.sin(t * math.tau * 3) ** 2)
    # Right arm hefts the hammer once, testing its weight; the left counterbalances.
    rot('upper_arm.R', -.30 - .48 * heft, 0, -.08 - .10 * heft)
    rot('forearm.R', -.32 - .40 * heft)
    rot('hand.R', .10 + .26 * heft)
    rot('upper_arm.L', .04 * breath, 0, -.05 + .10 * heft)
    rot('forearm.L', -.14 - .06 * breath)
    for label, s in (('L', 1), ('R', -1)):
        rot('thigh.' + label, .04 * heft, 0, s * .03 * shift)
        rot('shin.' + label, -.05 * heft)
    ears(max(bump(t, .22, .045), bump(t, .88, .045)), bump(t, .48, .045))
    blink(t, (.20, .64, .72))

def walk(t):
    # A heavy hunched plod: long ground contact, a deep double bob and a lot of
    # shoulder roll to carry the belly.
    w = math.sin(t * math.tau)
    c = math.cos(t * math.tau)
    rig.pose.bones['root'].location.y = -.030 + .030 * math.cos(t * math.tau * 2)
    spine_lean(.20 + .03 * c, .06 * w, .07 * w)
    rot('head', -.16 - .04 * math.cos(t * math.tau * 2), 0, .05 * w)
    jaw(.06 + .03 * math.cos(t * math.tau * 2))
    for label, s in (('L', 1), ('R', -1)):
        stride = s * w
        rot('thigh.' + label, .52 * stride - .06, 0, s * .10)
        rot('shin.' + label, -max(0, stride) * .70 - .10)
        rot('foot.' + label, -.20 * stride + max(0, stride) * .24)
        rot('upper_arm.' + label, -.34 * s * w - .08, 0, s * .05)
        rot('forearm.' + label, -.20 - max(0, -stride) * .22)
    ears(.35 * math.cos(t * math.tau * 2), .35 * math.cos(t * math.tau * 2))
    blink(t, (.42,))

# The hammer is carried head-up, so a downward blow is the sum of three pitches:
# the trunk stooping, the shoulder swinging and a big wrist snap. Keying the three
# separately lets the head sweep from behind the shoulder to anvil height in front
# without the elbow ever bending backwards.
def work(t):
    # The workshop clip: the troll stoops over an anvil-height target in front,
    # winds the hammer up over the shoulder and drives it down. The left hand
    # steadies the piece; the blow lands at t = 0.60.
    strike = math.exp(-((t - .615) / .048) ** 2)
    lean = curve(t, [(0, .26), (.12, .23), (.44, .17), (.60, .38), (.72, .33), (1, .26)])
    arm = curve(t, [(0, -.30), (.12, -.22), (.44, -.90), (.60, .28), (.72, .16), (1, -.30)])
    fore = curve(t, [(0, -.32), (.12, -.26), (.44, -.50), (.60, -.06), (.72, -.16), (1, -.32)])
    wrist = curve(t, [(0, .10), (.12, .16), (.44, -.18), (.60, .58), (.72, .44), (1, .10)])
    spine_lean(lean + .06 * strike, 0, -.06 * (arm + .30))
    # The trunk stoops but the head stays up, watching the work: pitching both
    # forward buries the face and the camera only ever sees the bald crown.
    rot('head', -.20 + .12 * strike, 0, .05 * (arm + .30))
    jaw(.10 + .26 * max(0, -arm - .30) + .22 * strike)
    # Positive Z on the right shoulder swings the arm across the front of the
    # body (the right arm points down -X, and +Z turns -X toward -Y = forward),
    # which is what brings the hammer head onto a target in front of the troll
    # instead of dropping it beside his own hip.
    rot('upper_arm.R', arm, 0, .10 + .40 * max(0, arm))
    rot('forearm.R', fore)
    rot('hand.R', wrist)
    # Left arm holds the work down on the anvil, flinching on impact.
    rot('upper_arm.L', -1.05 + .07 * strike, 0, -.46)
    rot('forearm.L', -.85 - .10 * strike, 0, .34)
    rot('hand.L', .30)
    for label in ('L', 'R'):
        rot('thigh.' + label, .12 + .09 * strike); rot('shin.' + label, -.18 - .14 * strike)
        rot('foot.' + label, .07 + .05 * strike)
    rig.pose.bones['root'].location.y = -.022 - .022 * strike
    ears(-.55 * strike, -.55 * strike)
    blink(t, (.60,))

def attack(t):
    # A full overhead smash: wind up behind the head, roar, then drive the hammer
    # through the target and finish low.
    roar = bump(t, .40, .20)
    hit_now = math.exp(-((t - .58) / .055) ** 2)
    lean = curve(t, [(0, .22), (.16, .10), (.42, .06), (.58, .46), (.74, .36), (1, .22)])
    arm = curve(t, [(0, -.24), (.16, -.02), (.42, -1.20), (.58, .46), (.74, .22), (1, -.24)])
    fore = curve(t, [(0, -.28), (.16, -.20), (.42, -.72), (.58, -.04), (.74, -.20), (1, -.28)])
    wrist = curve(t, [(0, .12), (.16, .20), (.42, -.34), (.58, .82), (.74, .56), (1, .12)])
    spine_lean(lean, 0, -.10 * (arm + .24))
    rot('head', -.22 + .12 * hit_now - .18 * roar, 0, .09 * (arm + .24))
    jaw(.12 + .80 * roar + .30 * hit_now)
    rot('upper_arm.R', arm, 0, .06 + .34 * max(0, arm))
    rot('forearm.R', fore)
    rot('hand.R', wrist)
    rot('upper_arm.L', -.28 + .34 * max(0, arm), 0, -.26 - .16 * arm)
    rot('forearm.L', -.34 - .34 * max(0, -arm - .24))
    for label in ('L', 'R'):
        rot('thigh.' + label, .18 * max(0, arm)); rot('shin.' + label, -.24 * max(0, arm))
    rig.pose.bones['root'].location.y = -.040 * max(0, arm)
    ears(-.9 * max(0, arm), -.9 * max(0, arm))

def hit(t):
    # Recoil: the head snaps back, the shoulders drop, the jaw clenches shut.
    w = curve(t, [(0, 0), (.18, 1), (.40, .55), (.72, -.10), (1, 0)])
    spine_lean(-.42 * w, 0, .16 * w)
    rot('head', -.30 * w, 0, -.16 * w)
    jaw(.34 * max(0, w))
    rot('upper_arm.L', -.55 * w, 0, -.24 * w); rot('upper_arm.R', -.28 * w, 0, .10 * w)
    rot('forearm.L', -.35 * w); rot('forearm.R', -.30 * w)
    for label in ('L', 'R'): rot('thigh.' + label, .18 * w); rot('shin.' + label, -.26 * w)
    rig.pose.bones['root'].location.y = -.045 * max(0, w)
    ears(-w, -w)
    blink(t, (.20,))

def death(t):
    # The troll folds forward over the hammer, knees buckling, and stays down.
    k = curve(t, [(0, 0), (.14, .08), (.34, .22), (.62, 1), (.76, .95), (1, 1)])
    sag = curve(t, [(0, 0), (.30, 1), (1, 1)])
    rot('root', -1.32 * k, 0, .12 * k)
    rig.pose.bones['root'].location.y = .30 * k
    spine_lean(.35 * k, 0, .10 * k)
    rot('head', .34 * k - .18 * sag, 0, -.14 * k)
    jaw(.42 * sag)
    rot('upper_arm.R', -.30 * k, 0, .34 * k); rot('forearm.R', -.55 * k)
    rot('upper_arm.L', -.48 * k, 0, -.52 * k); rot('forearm.L', -.40 * k)
    rot('thigh.L', .55 * k); rot('shin.L', -.95 * k); rot('foot.L', .30 * k)
    rot('thigh.R', .40 * k); rot('shin.R', -.80 * k); rot('foot.R', .24 * k)
    ears(0, 0, droop=k)
    close_eyes(min(1, t * 2.6))

FRAMES = {'Idle': 91, 'Walk': 31, 'Work': 37, 'Attack': 28, 'Hit': 16, 'Death': 49}
pose('Idle', FRAMES['Idle'], idle)
pose('Walk', FRAMES['Walk'], walk)
pose('Work', FRAMES['Work'], work)
pose('Attack', FRAMES['Attack'], attack)
pose('Hit', FRAMES['Hit'], hit)
pose('Death', FRAMES['Death'], death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = 'Dungeon Keeper 2 troll: olive hide, bulbous nose, under-bite tusks, smith apron, pauldrons, forge hammer.'
rig['clips'] = 'Idle, Walk, Work, Attack, Hit, Death'
rig['scale_note'] = f'Feet at ground; {TARGET_HEIGHT} units tall; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'troll.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for trk in rig.animation_data.nla_tracks: trk.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'troll.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials),
        'height': round(max(v.co.z for v in character.data.vertices) - min(v.co.z for v in character.data.vertices), 3),
        'animations': list(FRAMES)}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, .95))
area('Warm key', (-3.0, -4.4, 5.2), 460, (1, .76, .50), 3.0)
area('Soft fill', (2.6, -2.6, 2.6), 140, (.65, .80, 1), 3.0)
area('Cool rim', (-1.3, 2.6, 3.6), 700, (.36, .73, 1), 2.4)
bpy.ops.object.camera_add(location=(2.7, -6.9, 3.5)); cam = bpy.context.object
aim(cam, (-.05, 0, .90)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.55; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = FRAMES['Idle']
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'troll.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'troll-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing makes the face and surface detail easy to inspect.
cam.location = (2.1, -6.9, 3.5); aim(cam, (0, -.14, 1.44)); cam.data.ortho_scale = 1.20
scene.render.filepath = str(PREVIEW / 'troll-detail.png')
bpy.ops.render.render(write_still=True)
# The profile is shot from the troll's left so the hammer arm does not cover the
# body: this side shows the hunched back, the gut under the apron and the nose.
cam.location = (7.0, -.9, 2.3); aim(cam, (0, -.10, .90)); cam.data.ortho_scale = 2.55
scene.render.filepath = str(PREVIEW / 'troll-side.png')
bpy.ops.render.render(write_still=True)
if FAST:
    # Look development only: check that the Work strike actually lands in front
    # at anvil height and that the hammer clears the body.
    cam.location = (2.7, -6.9, 3.5); aim(cam, (-.05, 0, .90)); cam.data.ortho_scale = 2.75
    for label, clip, frame in (('work', 'Work', 23), ('attack', 'Attack', 17)):
        rig.animation_data.action = bpy.data.actions[clip]
        scene.frame_set(frame)
        scene.render.filepath = str(PREVIEW / f'troll-{label}.png')
        bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    for p in rig.pose.bones: p.matrix_basis.identity()
print('TROLL_BUILD_COMPLETE', triangles, 'triangles, height', round(TARGET_HEIGHT, 3), 'scale', round(SCALE, 5))
