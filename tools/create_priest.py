"""Build the Dungeon Keeper 2 style Priest hero with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_priest.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the game's own Priest healer class (the closest DK2 reference is the
Monk healer) rendered in the DK2 hero art style, keeping the bishop-like silhouette
and palette already used by the procedural fallback (`_buildPriest` in entities.js):
a serene elderly cleric in long cream robes with a red stole, a gold-trimmed cream
mitre, and a tall gold staff topped by a halo cradling a glowing blue crystal.
Everything is sculpted from overlapping primitives that are voxel-remeshed into
smooth continuous forms and conformed onto the body; nothing is left floating.
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
random.seed(47)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

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

# Elderly human cleric: warm weathered skin, cream robes, a red stole and gold trim,
# matching the fallback's clothCream / clothRed / gold / heroSkin palette.
skin = material('Skin | weathered elder', (.60, .42, .32), 0, .58)
lip = material('Skin | lips', (.46, .19, .16), 0, .55)
beard = material('Beard | silver grey', (.80, .79, .76), 0, .58)
brow_hair = material('Brow | silver grey', (.44, .42, .38), 0, .64)
robe = material('Robe | cream wool', (.78, .71, .56), 0, .82)
robe_light = material('Robe lining | pale cream', (.87, .82, .68), 0, .80)
stole = material('Stole | oxblood velvet', (.46, .045, .050), .02, .55)
gold = material('Gold | vestment trim', (.78, .58, .18), .82, .26)
gold_dark = material('Gold | staff shaft', (.62, .42, .10), .85, .24)
belt_leather = material('Leather | belt', (.11, .052, .026), 0, .74)
book_cover = material('Book | maroon leather', (.16, .028, .026), 0, .60)
book_page = material('Book | vellum pages', (.80, .75, .62), 0, .70)
censer_bronze = material('Censer | aged bronze', (.18, .12, .050), .55, .48)
chain_metal = material('Chain | dull gold link', (.42, .32, .10), .70, .34)
sandal_leather = material('Leather | sandal strap', (.14, .066, .032), 0, .76)
# Calm eyes and the staff crystal glow faintly blue, matching the fallback's magicBlue
# (#61d9ff). Both stay out of the baked atlas so their emission survives export.
eye_glow = material('Eyes | calm blue glow', (.03, .12, .19), .10, .30, 1.7, (.18, .55, .90))
crystal_glow = material('Staff crystal | arcane glow', (.10, .28, .40), .05, .18, 4.0, (.30, .80, 1.0))

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

def skin_shader(mat, base, shadow, highlight):
    """Aged, lined skin: mottled tone plus fine cross-hatched wrinkles. Coordinates are final game units."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 9
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .58
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .68; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    # Bump: fine wrinkle cross-hatching plus pores, baked to the tangent normal map.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 34
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    wrinkles = nodes.new('ShaderNodeMapRange'); wrinkles.inputs['From Max'].default_value = .045
    links.new(vor.outputs['Distance'], wrinkles.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 140
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .75
    links.new(wrinkles.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = .25
    links.new(pores.outputs['Fac'], m2.inputs[0]); links.new(m1.outputs[0], m2.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .30
    bmp.inputs['Distance'].default_value = .0022
    links.new(m2.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .46
    rough.inputs['To Max'].default_value = .66
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

skin_shader(skin, (.60, .42, .32), (.40, .25, .18), (.72, .56, .44))
surface_detail(lip, 30, .001, .12)
surface_detail(beard, 70, .0018, .30, (1, 1, 2.2), .40)
surface_detail(brow_hair, 60, .0014, .26, (1, 1, 1.6), .34)
surface_detail(robe, 46, .0022, .16, (1, 1, 1.3))
surface_detail(robe_light, 46, .0018, .14, (1, 1, 1.3))
surface_detail(stole, 60, .0014, .18, (1, 1, 1.2))
surface_detail(gold, 42, .0008, .22)
surface_detail(gold_dark, 42, .0008, .22)
surface_detail(belt_leather, 55, .002, .25)
surface_detail(book_cover, 40, .0012, .20)
surface_detail(book_page, 30, .0006, .10)
surface_detail(censer_bronze, 36, .0012, .28)
surface_detail(chain_metal, 44, .0007, .20)
surface_detail(sandal_leather, 50, .0018, .24)

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
    curve = bpy.data.curves.new(name, 'CURVE'); curve.dimensions = '3D'
    curve.resolution_u = segments; curve.bevel_depth = radius; curve.bevel_resolution = res
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(points) - 1); spline.use_cyclic_u = cyclic
    for i, (bp, co) in enumerate(zip(spline.bezier_points, points)):
        bp.co = co; bp.handle_left_type = 'AUTO'; bp.handle_right_type = 'AUTO'
        if taper: bp.radius = max(.04, taper(i / (len(points) - 1)))
    o = bpy.data.objects.new(name, curve); bpy.context.collection.objects.link(o)
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
    """A strap that hugs the sculpt: subdivided, shrink-wrapped, then given cloth/leather thickness."""
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

def buckle(name, p, w, h, bone, target, offset, right=None, radius=.02, mat=None):
    """A forged frame buckle with rounded corners and a prong, seated on a strap."""
    loc, n = surface_point(target, p, offset)
    right = (Vector(right) if right is not None else n.cross(Vector((0, 0, 1))))
    right = (right - n * right.dot(n)).normalized()
    up = right.cross(n).normalized()
    loop = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
    pts = [loc + right * (x * w / 2) + up * (z * h / 2) for x, z in loop]
    tube(name, pts, radius, mat or gold, bone, cyclic=True, res=3)
    rod(name + ' prong', loc + right * (w / 2) - n * .004, loc - right * (w * .12) - n * .004, radius * .75, radius * .5, mat or gold, bone, 8)

def ring(cz, rx, ry, cy=0, steps=32):
    return [(rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps), cz) for i in range(steps)]

def lathe(name, a, b, radius_fn, mat, bone, sides=24, rings=10, cap_top=False, cap_bottom=False, twist=0.0):
    """A body-of-revolution cloth shell around the axis a->b; radius_fn(v) gives the radius at height fraction v."""
    a, b = Vector(a), Vector(b); axis = b - a; d = axis.normalized()
    up_ref = Vector((0, 0, 1)) if abs(d.z) < .9 else Vector((1, 0, 0))
    e1 = d.cross(up_ref).normalized(); e2 = d.cross(e1).normalized()
    verts = []; loops = []
    for r in range(rings + 1):
        v = r / rings; center = a + axis * v; radius = radius_fn(v); loop = []
        for i in range(sides):
            theta = 2 * math.pi * i / sides + twist * v
            loop.append(len(verts)); verts.append(center + e1 * (radius * math.cos(theta)) + e2 * (radius * math.sin(theta)))
        loops.append(loop)
    faces = []
    for r in range(rings):
        for i in range(sides):
            j = (i + 1) % sides
            faces.append((loops[r][i], loops[r][j], loops[r + 1][j], loops[r + 1][i]))
    if cap_top: faces.append(tuple(reversed(loops[0])))
    if cap_bottom: faces.append(tuple(loops[-1]))
    o = mesh(name, verts, faces, mat, bone)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    smooth(o); return o

# ---------------------------------------------------------------- skeleton landmarks (final game units)
# The priest stands straight and dignified (no imp-style hunch). Right hand grips a
# planted staff; left hand hangs free to later lift into the Idle blessing gesture.
ARM = {
    'L': dict(shoulder=(.19, -.01, 1.395), elbow=(.25, .09, 1.13), wrist=(.21, .04, .88), hand=(.19, -.02, .79)),
}
# The right hand grips the tall staff, so its wrist/hand joints are placed directly on
# the staff's shaft line (defined here, reused again when the staff itself is built
# further down) rather than picked independently -- keeping the grip and the shaft
# from drifting apart.
STAFF_BOTTOM = Vector((-.30, -.08, .02)); STAFF_TOP = Vector((-.46, -.05, 2.08))
def _on_shaft(z):
    t = (z - STAFF_BOTTOM.z) / (STAFF_TOP.z - STAFF_BOTTOM.z)
    p = STAFF_BOTTOM.lerp(STAFF_TOP, t)
    return (p.x, p.y, z)
ARM['R'] = dict(shoulder=(-.19, -.01, 1.395), elbow=(-.29, -.07, 1.16), wrist=_on_shaft(.97), hand=_on_shaft(.89))
LEG = {}
for s, L in ((-1, 'R'), (1, 'L')):
    LEG[L] = dict(hip=(s * .11, 0, .95), knee=(s * .115, .01, .50), ankle=(s * .115, -.01, .09), foot=(s * .115, -.13, .03))

# ---------------------------------------------------------------- body + robe sculpt
# Standing straight: hips, ribcage, chest and shoulders stack with only a gentle,
# dignified forward set to the head. Legs are modest (fully hidden by the robe) but
# still sculpted so the robe -- welded to them below -- gets smooth, graduated bone
# weights instead of moving as one rigid skirt.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Pelvis', (0, 0, .95), (.145, .115, .11), bone='hips'))
B(ell('Waist', (0, .02, 1.06), (.135, .105, .10), bone='hips'))
B(ell('Ribcage', (0, -.01, 1.20), (.155, .125, .145), bone='chest'))
B(ell('Upper chest', (0, -.02, 1.32), (.165, .12, .11), bone='chest'))
B(ell('Shoulder girdle', (0, .03, 1.395), (.175, .105, .09), bone='chest'))
B(ell('Neck', (0, -.015, 1.445), (.062, .06, .075), bone='chest'))
for L in ('L', 'R'):
    j = ARM[L]
    B(ell('Deltoid', j['shoulder'], (.075, .075, .085), bone=f'upper_arm.{L}'))
    B(limb('Upper arm', j['shoulder'], j['elbow'], .058, f'upper_arm.{L}', ry=.062))
    B(ell('Elbow', j['elbow'], (.055, .058, .055), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .050, f'forearm.{L}', ry=.052))
    B(ell('Wrist', j['wrist'], (.042, .042, .040), bone=f'forearm.{L}'))
for L in ('L', 'R'):
    j = LEG[L]
    B(limb('Thigh', j['hip'], j['knee'], .095, f'thigh.{L}', ry=.10))
    B(ell('Knee', j['knee'], (.075, .08, .075), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .062, f'shin.{L}', ry=.066))
    B(ell('Ankle', j['ankle'], (.05, .05, .048), bone=f'shin.{L}'))
# The robe shell: a gently flared column from the waist down to the shin, ending
# above the ankles so the sandalled feet peek out beneath it (a pale underlayer
# below fills the rest of the way "to the ground"). It overlaps and encloses the
# legs entirely, so after the union below only the robe's outer silhouette survives
# while the hidden legs still contribute correct bone weights.
def robe_radius(v):
    return .195 + .165 * v ** 1.18 + .015 * math.sin(v * math.pi * .6)
B(lathe('Robe shell', (0, .015, 1.055), (0, -.01, .16), robe_radius, robe, 'hips', sides=30, rings=14, cap_top=True, cap_bottom=True))
# Every body_parts primitive is tagged skin or robe so the merged sculpt below can
# recover a two-material split even though voxel remeshing destroys per-object
# boundaries -- the same nearest-sample lookup used for bone-weight blending. Only
# the neck shows bare skin above the collar; the torso, arms and legs are all
# clothed (the separate sleeve shells drape an extra flared layer on top of them).
samples = []
for o in body_parts:
    tag = 'skin' if o.name == 'Neck' else 'robe'
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone'], tag))
tree = KDTree(len(samples))
for i, (co, bone, tag) in enumerate(samples): tree.insert(co, i)
tree.balance()

def split_material(obj, mat_a, mat_b, tag_b):
    """Recolor a remeshed, single-material union by nearest original sample, e.g. skin vs robe."""
    obj.data.materials.clear(); obj.data.materials.append(mat_a); obj.data.materials.append(mat_b)
    for p in obj.data.polygons:
        _, idx, _ = tree.find(obj.matrix_world @ p.center)
        p.material_index = 1 if samples[idx][2] == tag_b else 0
        p.use_smooth = True

body_pass1 = union('Continuous body sculpt', body_parts, .016, .55, smoothing=2)

# Second pass: vertical fold creases are seated on the robe surface, then welded in --
# the same two-pass technique the head uses below for wrinkles.
crease_lines = [body_pass1]
FOLD_COUNT = 9
for k in range(FOLD_COUNT):
    theta = 2 * math.pi * k / FOLD_COUNT + random.uniform(-.06, .06)
    rtop, rbot = .20, .37
    pts = []
    for i in range(7):
        v = i / 6
        r = rtop + (rbot - rtop) * v ** 1.05
        z = 1.02 - v * .84
        pts.append((r * math.sin(theta) * (1 - .04 * math.sin(v * math.pi)), r * math.cos(theta) * .30, z))
    seated = conformed(pts, body_pass1, .006)
    crease_lines.append(tube('Robe fold', seated, .014, robe, 'hips', lambda t: .35 + .65 * math.sin(math.pi * t) ** .7))
# A couple of soft age wrinkles will be seated on the head separately below; here we
# just weld the robe creases into the continuous sculpt.
body = union('Body sculpt', crease_lines, .013, .68, smoothing=1)
body['weighted_body'] = True
split_material(body, skin, robe, 'robe')

# A pale underlayer flounces out from beneath the main robe's hem and tapers back in
# toward the ankle, so the sandalled feet peek out below it -- a genuine layered read
# without the outer robe needing to hide the feet completely.
def hem_radius(v):
    return .38 - .20 * v
hem = lathe('Hem underlayer', (0, -.01, .17), (0, -.02, .085), hem_radius, robe_light, 'hips', sides=26, rings=4, cap_top=True, cap_bottom=True)
m = hem.modifiers.new('Drape', 'SUBSURF'); m.levels = 1; apply_modifier(hem, m)

# ---------------------------------------------------------------- head sculpt (two pass)
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, .015, 1.585), (.110, .100, .105), bone='head'))
H(ell('Forehead', (0, -.050, 1.615), (.090, .068, .066), bone='head'))
H(ell('Crown', (0, .03, 1.65), (.085, .080, .055), bone='head'))
H(ell('Occiput', (0, .095, 1.565), (.098, .088, .088), bone='head'))
H(ell('Jaw', (0, -.045, 1.472), (.082, .070, .054), bone='head'))
H(ell('Chin', (0, -.108, 1.450), (.040, .036, .032), bone='head'))
H(ell('Nose bridge', (0, -.112, 1.548), (.020, .026, .034), bone='head'))
H(ell('Nose tip', (0, -.140, 1.522), (.026, .028, .024), bone='head'))
for s in (-1, 1):
    H(ell('Cheek', (s * .068, -.048, 1.503), (.040, .046, .038), bone='head'))
    H(ell('Temple', (s * .092, -.012, 1.578), (.046, .060, .056), bone='head'))
    H(ell('Brow ridge', (s * .050, -.086, 1.567), (.052, .024, .020), bone='head', rot=(.18, -s * .10, 0)))
    H(ell('Nostril wing', (s * .018, -.140, 1.510), (.013, .013, .011), bone='head'))
    H(ell('Ear', (s * .112, .015, 1.518), (.018, .040, .032), bone='head', rot=(0, 0, -s * .16)))
head_obj = union('Head sculpt pass 1', head_parts, .0075, 1.0, smoothing=1, bone='head')
# Second pass: kindly age lines -- forehead creases, crow's feet and smile lines --
# are seated on the first sculpt and welded in, exactly as the wrinkle technique
# calls for. A closed, serene mouth needs no separate mouth cavity or teeth.
def smile(x):
    return 1.472 - .007 * (x / .05) ** 2
refine = [head_obj]
mouth_pts = conformed([(x, -.128, smile(x)) for x in (-.05, -.025, 0, .025, .05)], head_obj, .005)
refine.append(tube('Closed mouth line', mouth_pts, .008, lip, 'head', lambda t: .5 + .5 * math.sin(math.pi * t)))
for z in (1.605, 1.618):
    fold = conformed([(x, -.098, z + .012 * math.cos(x * 6)) for x in (-.05, -.025, 0, .025, .05)], head_obj, -.003)
    refine.append(tube('Forehead wrinkle', fold, .008, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
for s in (-1, 1):
    crow = conformed([(s * .098, -.03, 1.578), (s * .118, -.02, 1.565), (s * .122, -.01, 1.552)], head_obj, -.002)
    refine.append(tube("Crow's foot", crow, .006, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
    smile_line = conformed([(s * .050, -.10, 1.505), (s * .062, -.09, 1.485), (s * .058, -.08, 1.465)], head_obj, -.002)
    refine.append(tube('Smile line', smile_line, .007, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
head_obj = union('Head sculpt', refine, .006, .55, smoothing=1, bone='head')
# Calm eyes sit in the natural hollow between the brow ridge and the cheek -- no
# separate socket patch is needed, which was reading as a pale, eye-shaped nub.
EYE = {1: (.043, -.088, 1.547), -1: (-.043, -.088, 1.547)}
for s in (-1, 1):
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ex, ey, ez = EYE[s]
    ell('Calm glowing eye', (ex, ey, ez), (.021, .016, .018), eye_glow, eye_bone, 2)
patch('Philtrum', (0, -.132, 1.498), (.009, .004, .018), skin, 'head', head_obj, -.0006)

# ---------------------------------------------------------------- beard and brows
# A short, neatly trimmed silver beard and moustache, seated against the jaw so the
# hairline reads as grown from the face rather than a floating cap.
beard_parts = []
def BR(o): beard_parts.append(o); return o
jaw_line = conformed([(-.082, -.01, 1.475), (-.07, -.075, 1.438), (-.032, -.118, 1.412), (0, -.135, 1.402),
                       (.032, -.118, 1.412), (.07, -.075, 1.438), (.082, -.01, 1.475)], head_obj, .012)
BR(tube('Beard mass', jaw_line, .062, beard, 'head', lambda t: .5 + .5 * math.sin(math.pi * t) ** .6))
BR(ell('Beard chin tuft', (0, -.145, 1.388), (.044, .048, .040), beard, 'head'))
for s in (-1, 1):
    BR(ell('Beard cheek', (s * .068, -.055, 1.448), (.048, .052, .042), beard, 'head'))
    BR(ell('Beard sideburn', (s * .088, -.005, 1.505), (.024, .034, .034), beard, 'head'))
mustache = conformed([(-.04, -.125, 1.478), (-.016, -.132, 1.482), (0, -.134, 1.483), (.016, -.132, 1.482), (.04, -.125, 1.478)], head_obj, .012)
BR(tube('Moustache', mustache, .022, beard, 'head', lambda t: .40 + .60 * math.sin(math.pi * t)))
beard_obj = union('Beard sculpt', beard_parts, .008, .65, smoothing=1, bone='head')
for s in (-1, 1):
    patch('Eyebrow', (s * .052, -.086, 1.570), (.044, .013, .017), brow_hair, 'head', head_obj, .005)

# ---------------------------------------------------------------- mitre
mitre_parts = []
def M(o): mitre_parts.append(o); return o
M(ell('Mitre base', (0, .01, 1.665), (.115, .095, .075), robe, 'head'))
M(ell('Mitre body', (0, -.01, 1.76), (.095, .075, .105), robe, 'head'))
M(ell('Mitre peak', (0, -.03, 1.87), (.052, .042, .075), robe, 'head'))
M(ell('Mitre tip', (0, -.045, 1.935), (.022, .018, .035), robe, 'head'))
mitre_obj = union('Mitre sculpt', mitre_parts, .009, .7, mat=robe, smoothing=1, bone='head')
band = conformed([(0, -.09, 1.665), (0, -.10, 1.76), (0, -.11, 1.87), (0, -.11, 1.935)], mitre_obj, .004)
tube('Mitre gold band', band, .014, gold, 'head', lambda t: .8 + .2 * math.sin(math.pi * t))
base_ring = conformed(ring(1.665, .13, .11, cy=.01), mitre_obj, .004)
tube('Mitre base trim', base_ring, .012, gold, 'head', cyclic=True, res=1, segments=4)

# ---------------------------------------------------------------- hands
def hand(L):
    bone = f'hand.{L}'; pieces = []
    grip = L == 'R'  # the right hand grips the staff; the left rests open for the blessing gesture
    wrist = Vector(ARM[L]['wrist']); palm_c = Vector(ARM[L]['hand'])
    pieces.append(ell('Wrist cuff', ARM[L]['wrist'], (.040, .040, .038), bone=bone))
    pieces.append(ell('Palm', palm_c, (.038, .030, .048), bone=bone))
    axis = (palm_c - wrist).normalized()
    side = axis.cross(Vector((0, 0, 1))).normalized()
    if side.length < .01: side = Vector((1, 0, 0))
    up = side.cross(axis).normalized()
    for i in range(4):
        spread = (i - 1.5) * .022
        base = palm_c + axis * .035 + side * spread
        if grip:
            path = [base, base + axis * .028 - up * .01, base + axis * .040 - up * .034, base + axis * .030 - up * .050]
        else:
            curl = .35 if i in (1, 2) else .75  # blessing pose: index + middle stay straighter
            path = [base, base + axis * .048, base + axis * (.078 - curl * .02) - up * curl * .028, base + axis * (.088 - curl * .03) - up * curl * .05]
        pieces.append(tube('Finger', [tuple(p) for p in path], .013, skin, bone))
        pieces.append(ell('Fingertip', tuple(path[-1]), (.012, .012, .012), bone=bone, sub=2))
    thumb_base = palm_c + side * (-.03 if grip else .03) + axis * .01
    thumb_tip = thumb_base + axis * .045 - up * .01 + side * (-.02 if grip else .025)
    pieces.append(tube('Thumb', [tuple(thumb_base), tuple(thumb_tip)], .016, skin, bone))
    pieces.append(ell('Thumb tip', tuple(thumb_tip), (.013, .013, .013), bone=bone, sub=2))
    union(f'Hand sculpt {L}', pieces, .0065, .7, bone=bone)
hand('L'); hand('R')

# ---------------------------------------------------------------- feet and sandals
def foot(L):
    s = 1 if L == 'L' else -1
    bone = f'foot.{L}'; pieces = []
    base = LEG[L]['foot']
    pieces.append(ell('Foot base', base, (.052, .095, .040), bone=bone))
    pieces.append(ell('Heel', (s * .115, .045, .038), (.040, .040, .036), bone=bone))
    for i in range(4):
        y = -.155 - i * .022
        pieces.append(ell('Toe', (s * .115 + (i - 1.5) * .016, y, .022), (.016, .019, .016), bone=bone, sub=2))
    foot_obj = union(f'Foot sculpt {L}', pieces, .0055, .65, bone=bone)
    ell('Sandal sole', (s * .115, -.03, .012), (.062, .13, .012), sandal_leather, bone, sub=2)
    strap = conformed([(s * .09, -.10, .06), (s * .13, -.02, .075), (s * .09, .08, .07)], foot_obj, .003)
    ribbon('Sandal strap', strap, .022, sandal_leather, bone, foot_obj, .003, .008)
foot('L'); foot('R')

# ---------------------------------------------------------------- kit: belt, book, censer, stole, sleeves
belt_ring = ring(1.035, .40, .34, -.02)
ribbon('Waist belt', belt_ring, .045, belt_leather, 'hips', body, .010, .016, cyclic=True)
buckle('Belt buckle', (0, -.36, 1.035), .055, .050, 'hips', body, .020, right=(1, 0, 0), radius=.007)
for a in (-2.2, -1.3, 1.3, 2.2):
    patch('Belt stud', (.40 * math.cos(a), -.02 + .34 * math.sin(a), 1.035), (.010, .007, .010), gold, 'hips', body, .018)

# The small holy book hangs from a short strap on the left hip, clear of the sleeve
# so it reads from every angle instead of hiding inside the drape.
book_strap = conformed([(.30, -.19, 1.02), (.34, -.20, .90)], body, .006)
ribbon('Book strap', book_strap, .026, belt_leather, 'hips', body, .006, .011)
book = union('Holy book', [
    block('Book cover', (.35, -.205, .78), (.032, .011, .046), book_cover, 'hips', .0035),
    block('Book pages', (.345, -.203, .78), (.027, .007, .041), book_page, 'hips', .0025),
], .003, .85, mat=book_cover, bone='hips')

# A small censer swings on a bronze chain from the right hip, mirrored clear of its sleeve.
censer_top = conformed([(-.30, -.19, 1.02)], body, .006)[0]
censer_body_pos = (-.35, -.205, .78)
chain_pts = [tuple(censer_top), (-.335, -.205, .90), (-.34, -.20, .84), censer_body_pos]
tube('Censer chain', chain_pts, .007, chain_metal, 'hips', lambda t: .6 + .4 * math.sin(math.pi * t))
censer = union('Censer', [
    ell('Censer bowl', censer_body_pos, (.032, .032, .026), censer_bronze, 'hips'),
    ell('Censer lid', (censer_body_pos[0], censer_body_pos[1], censer_body_pos[2] + .026), (.024, .024, .017), censer_bronze, 'hips'),
    ell('Censer finial', (censer_body_pos[0], censer_body_pos[1], censer_body_pos[2] + .040), (.009, .009, .012), gold, 'hips'),
], .005, .8, mat=censer_bronze, bone='hips')

# Red stole with gold crosses, hanging both sides of the chest -- the DK2 bishop read
# the fallback already establishes.
for s in (-1, 1):
    strip = conformed([(s * .085, -.10, 1.40), (s * .095, -.14, 1.28), (s * .10, -.15, 1.12), (s * .105, -.13, .96), (s * .105, -.10, .82)], body, .006)
    ribbon('Stole', strip, .062, stole, 'chest', body, .006, .010)
    for z in (1.30, 1.06):
        patch('Stole cross vertical', (s * .10, -.145, z), (.008, .005, .024), gold, 'chest', body, .014)
        patch('Stole cross horizontal', (s * .10, -.145, z), (.020, .005, .008), gold, 'chest', body, .014)

# Wide bell sleeves drape from the elbow to past the wrist on both arms.
def sleeve(L):
    # Ends just short of the wrist cuff so the hand -- gripping the staff or lifted in
    # blessing -- stays fully visible below the wide, flared opening.
    j = ARM[L]
    a = Vector(j['elbow']).lerp(Vector(j['shoulder']), .25)
    b = Vector(j['wrist']).lerp(Vector(j['elbow']), .15)
    def r(v): return .066 + .082 * v ** .8
    lathe(f'Sleeve {L}', tuple(a), tuple(b), r, robe, f'forearm.{L}', sides=16, rings=8)
sleeve('L'); sleeve('R')

# ---------------------------------------------------------------- staff, halo and crystal
shaft_bottom, shaft_top = STAFF_BOTTOM, STAFF_TOP
shaft_dir = (shaft_top - shaft_bottom).normalized()
grip_point = Vector(ARM['R']['hand'])
rod('Staff shaft', shaft_bottom, shaft_top, .020, .016, gold_dark, 'staff', 12)
ell('Staff ferrule', shaft_bottom, (.024, .024, .018), gold, 'staff')
HALO_CENTER = shaft_top + shaft_dir * .02
halo_ring = [Vector(p) for p in ring(0, .17, .17, steps=24)]
p1 = shaft_dir.cross(Vector((0, 1, 0))).normalized(); p2 = shaft_dir.cross(p1).normalized()
halo_pts = [HALO_CENTER + p1 * v.x + p2 * v.y for v in halo_ring]
tube('Staff halo', [tuple(p) for p in halo_pts], .015, gold, 'staff', cyclic=True, res=2, segments=4)
for k in range(4):
    a = 2 * math.pi * k / 4
    rim = HALO_CENTER + p1 * (.155 * math.cos(a)) + p2 * (.155 * math.sin(a))
    rod('Crystal prong', rim, HALO_CENTER, .010, .006, gold, 'staff', 6)
ell('Staff crystal', tuple(HALO_CENTER), (.075, .075, .075), crystal_glow, 'crystal', 2)

# ---------------------------------------------------------------- bones (final game units)
bones = {
    'root': ((0, 0, 0), (0, 0, .30), None),
    'hips': ((0, 0, .95), (0, .02, 1.06), 'root'),
    'chest': ((0, .02, 1.06), (0, -.02, 1.40), 'hips'),
    'head': ((0, -.02, 1.44), (0, -.05, 1.66), 'chest'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, -.03, 0))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, -.03, 0))), 'head'),
}
for L in ('L', 'R'):
    j = ARM[L]
    bones[f'upper_arm.{L}'] = (j['shoulder'], j['elbow'], 'chest')
    bones[f'forearm.{L}'] = (j['elbow'], j['wrist'], f'upper_arm.{L}')
    bones[f'hand.{L}'] = (j['wrist'], j['hand'], f'forearm.{L}')
for L in ('L', 'R'):
    j = LEG[L]
    bones[f'thigh.{L}'] = (j['hip'], j['knee'], 'hips')
    bones[f'shin.{L}'] = (j['knee'], j['ankle'], f'thigh.{L}')
    bones[f'foot.{L}'] = (j['ankle'], j['foot'], f'shin.{L}')
bones['staff'] = (tuple(grip_point), tuple(HALO_CENTER), 'hand.R')
bones['crystal'] = (tuple(HALO_CENTER), tuple(HALO_CENTER + Vector((0, 0, .05))), 'staff')

# Blend body weights across neighbouring anatomy so hips/thigh/shin joints deform the
# robe smoothly instead of it moving as one rigid skirt.
for name in bones: body.vertex_groups.new(name=name)
for vertex in body.data.vertices:
    nearby = tree.find_n(vertex.co, 18)
    closest = {}
    for _, idx, distance in nearby:
        name = samples[idx][1]
        closest[name] = min(distance, closest.get(name, 100))
    nearest = min(closest.values())
    weights = {name: math.exp(-((d - nearest) / .052) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
# Proportion tuning about one pivot, kept available for iteration even though the
# head was modelled close to its final settled size.
HEAD_SCALE = 1.0; HEAD_PIVOT = Vector((0, -.03, 1.50))
def settle(co): return HEAD_PIVOT + (Vector(co) - HEAD_PIVOT) * HEAD_SCALE
head_bones = {'head', 'eye.L', 'eye.R'}
SCALE = 1.0
for o in parts:
    activate(o)
    for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if o['bone'] in head_bones:
        for v in o.data.vertices: v.co = settle(v.co)
    if not o.get('weighted_body'):
        group = o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
bones = {name: ((settle(a) if name in head_bones else Vector(a)), (settle(b) if name in head_bones else Vector(b)), parent) for name, (a, b, parent) in bones.items()}
if FAST:
    budget = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in parts), reverse=True)
    for count, name in budget[:18]: print(f'TRIANGLES {count:7d} {name}')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Priest_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices: v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural cloth, skin, gold and leather into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(eye_glow, crystal_glow), prefix='priest')

rig_data = bpy.data.armatures.new('Priest_Skeleton')
rig = bpy.data.objects.new('Priest_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = Vector(a) * SCALE; eb.tail = Vector(b) * SCALE
    if parent: eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Priest skeleton', 'ARMATURE'); mod.object = rig
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
    track = rig.animation_data.nla_tracks.new(); track.name = name
    strip = track.strips.new(name, 1, act); strip.name = name
    track.mute = True
    rig.animation_data.action = None

def rot(b, x=0, y=0, z=0):
    # Express choreography in character axes rather than each diagonal bone's roll.
    basis = rig_data.bones[b].matrix_local.to_quaternion()
    q = Quaternion((0, 0, 1), z) @ Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x)
    rig.pose.bones[b].rotation_euler = (basis.inverted() @ q @ basis).to_euler()

def curve(t, keys):
    for (a, v), (b, w) in zip(keys, keys[1:]):
        if t <= b:
            u = max(0, min(1, (t - a) / (b - a))); u = u * u * (3 - 2 * u)
            return v + (w - v) * u
    return keys[-1][1]

def bump(t, center, width):
    k = max(0, 1 - abs(t - center) / width)
    return math.sin(k * math.pi / 2)

def pulse(scale_amount):
    rig.pose.bones['crystal'].scale = (1 + scale_amount, 1 + scale_amount, 1 + scale_amount)

def idle(t):
    # Slow breathing, the crystal pulsing gently, and a calm blessing gesture with the
    # free left hand -- all returning exactly to the start pose so the clip loops.
    breathe = math.sin(t * math.tau)
    rot('chest', .012 * breathe, .015 * math.sin(t * math.tau * .5), 0)
    rot('head', -.02 * breathe, .05 * math.sin(t * math.tau * .5), 0)
    rig.pose.bones['chest'].scale.y = 1 + .010 * breathe
    pulse(.10 + .10 * math.sin(t * math.tau * 2))
    bless = curve(t, [(0, 0), (.20, 0), (.42, 1), (.72, 1), (.92, 0), (1, 0)])
    rot('upper_arm.L', -.55 * bless, 0, -.28 * bless)
    rot('forearm.L', -.35 * bless)
    rot('hand.L', .10 * bless, 0, -.15 * bless)
    rot('upper_arm.R', -.02 * breathe)
    rot('staff', .015 * breathe)

def walk(t):
    # A measured, dignified stride; the staff plants once per cycle as weight shifts
    # onto it, then lifts clear for the next step.
    w = math.sin(t * math.tau)
    rig.pose.bones['root'].location.y = .010 * (1 - math.cos(t * math.tau * 2))
    rot('hips', 0, .018 * w, .022 * w)
    for label, s in (('L', 1), ('R', -1)):
        stride = s * w
        rot('thigh.' + label, .20 * stride); rot('shin.' + label, -max(0, stride) * .30)
        rot('foot.' + label, -.08 * stride)
    rot('chest', .015, 0, -.018 * w)
    rot('head', -.02, .015 * w, 0)
    plant = bump(t, .5, .16)
    rot('upper_arm.R', -.03 * plant, 0, .04 * plant)
    rot('forearm.R', -.05 * plant)
    rot('staff', .05 * plant)

def attack(t):
    # Raises the staff high overhead; the halo flares as the crystal swells, then both
    # settle back to the resting pose so the clip loops cleanly.
    raise_ = curve(t, [(0, 0), (.30, .35), (.55, 1), (.75, 1), (1, 0)])
    flare = curve(t, [(0, 0), (.50, 0), (.62, 1), (.85, .35), (1, 0)])
    rot('upper_arm.R', -1.55 * raise_, 0, .30 * raise_)
    rot('forearm.R', -.35 * raise_ - .25)
    rot('staff', -.20 * raise_)
    rot('chest', .10 * raise_, 0, -.06 * raise_)
    rot('head', -.05 * raise_ + .08 * flare, 0, 0)
    pulse(.35 * flare)
    rot('upper_arm.L', -.20 * raise_, 0, -.12 * raise_)

def hit(t):
    w = curve(t, [(0, 0), (.16, 1), (.40, .55), (.70, -.10), (1, 0)])
    rot('chest', -.22 * w, 0, .12 * w); rot('head', -.16 * w, 0, -.10 * w)
    rot('upper_arm.L', -.30 * w, 0, -.15 * w); rot('upper_arm.R', -.18 * w, 0, .10 * w)
    rot('staff', -.12 * w)
    pulse(-.05 * w)

def death(t):
    # Sinks to the knees and slumps forward: hips lower, the spine folds and the head
    # bows, coming to rest kneeling rather than falling flat.
    k = curve(t, [(0, 0), (.20, .10), (.62, 1), (.80, .96), (1, 1)])
    rig.pose.bones['hips'].location.y = -.42 * k
    rot('hips', .55 * k)
    rot('thigh.L', .95 * k); rot('shin.L', -1.55 * k)
    rot('thigh.R', .95 * k); rot('shin.R', -1.55 * k)
    rot('chest', .60 * k, 0, .08 * k)
    rot('head', .35 * k, .10 * k, 0)
    rot('upper_arm.L', -.30 * k, 0, -.35 * k)
    rot('upper_arm.R', -.15 * k, 0, .10 * k)
    rot('staff', -.30 * k, 0, .20 * k)
    pulse(-.10 * k)

pose('Idle', 91, idle); pose('Walk', 31, walk); pose('Attack', 28, attack)
pose('Hit', 19, hit); pose('Death', 49, death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = 'Dungeon Keeper 2 style Priest healer: cream robes, red stole, gold-trimmed mitre, silver beard, gold staff with a glowing blue crystal.'
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = 'Feet at ground; ~1.9 units tall including the mitre; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'priest.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'priest.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials), 'height': round(max(v.co.z for v in character.data.vertices) - min(v.co.z for v in character.data.vertices), 3),
        'animations': ['Idle', 'Walk', 'Attack', 'Hit', 'Death']}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, 1.0))
area('Warm key', (-3.2, -4.6, 5.4), 420, (1, .78, .54), 3.0)
area('Soft fill', (2.6, -2.6, 2.6), 140, (.65, .80, 1), 3.0)
area('Cool rim', (-1.3, 2.6, 3.6), 620, (.42, .74, 1), 2.6)
bpy.ops.object.camera_add(location=(2.6, -6.9, 3.2)); cam = bpy.context.object
aim(cam, (-.06, 0, .95)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.55; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
# Keep each Blender process to four render threads since several creatures build concurrently.
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = 91
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'priest.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'priest-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing makes the face, beard and mitre trim easy to inspect.
cam.location = (2.0, -6.9, 3.05); aim(cam, (0, -.10, 1.55)); cam.data.ortho_scale = 1.15
scene.render.filepath = str(PREVIEW / 'priest-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the robe flare, the stole and the planted staff.
cam.location = (7.2, -.4, 2.1); aim(cam, (0, -.05, .95)); cam.data.ortho_scale = 2.55
scene.render.filepath = str(PREVIEW / 'priest-side.png')
bpy.ops.render.render(write_still=True)
print('PRIEST_BUILD_COMPLETE', triangles, 'triangles')
