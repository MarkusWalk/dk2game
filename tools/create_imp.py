"""Rebuild the Dungeon Keeper 2 imp with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_imp.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the DK2 worker imp rather than the earlier cute interpretation.
Rust-red hide, a heavy V-shaped scowl over glowing amber eyes, a wide grin full
of small teeth, huge bat ears, a hunched knuckle-dragging stance, big clawed
hands and feet, a belt/harness/satchel/loincloth kit and a rope-lashed pick.
Everything is sculpted from overlapping primitives that are voxel-remeshed into
smooth continuous forms; nothing is left as a bare box or flat plane.
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
random.seed(19)
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

# DK2 imps are a rusty red-brown, darker on the back and joints, warmer on the belly and face.
skin = material('Skin | rust hide', (.34, .078, .030), 0, .62)
ear_inner = material('Ear | inner cartilage', (.20, .040, .018), 0, .66)
leather = material('Leather | dark umber', (.075, .028, .014), 0, .72)
leather_edge = material('Leather | worn edges', (.16, .075, .032), 0, .70)
cloth = material('Loincloth | oxblood rag', (.13, .020, .014), 0, .90)
iron = material('Pick | forged iron', (.22, .235, .25), .75, .45)
steel = material('Buckles | dull steel', (.30, .31, .32), .80, .40)
wood = material('Pick | ash shaft', (.19, .09, .035), 0, .70)
rope = material('Pick | hemp lashing', (.36, .28, .15), 0, .92)
claw = material('Claws | dark horn', (.055, .045, .040), 0, .42)
tooth = material('Teeth | stained ivory', (.55, .47, .34), 0, .50)
dark = material('Mouth cavity', (.02, .006, .004), 0, .70)
# The eyes are pupil-less molten glows, as in the original game.
amber = material('Eyes | molten glow', (.95, .55, .12), 0, .20, 3.2, (1, .60, .10))
hot = material('Eyes | white-hot core', (1, .93, .65), 0, .20, 5, (1, .86, .45))

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
    """Mottled hide with a darker back, cellular cracks and fine pores. Coordinates are final game units."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 5.5
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .62
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .68; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    # Front-to-back gradient: the belly and face stay warm, the spine and skull darken.
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    grad = nodes.new('ShaderNodeMapRange')
    grad.inputs['From Min'].default_value = -.28; grad.inputs['From Max'].default_value = .22
    grad.inputs['To Min'].default_value = 0; grad.inputs['To Max'].default_value = .55
    links.new(sep.outputs['Y'], grad.inputs['Value'])
    darken = nodes.new('ShaderNodeMix'); darken.data_type = 'RGBA'; darken.blend_type = 'MULTIPLY'
    darken.inputs[7].default_value = (.50, .40, .38, 1)
    links.new(grad.outputs[0], darken.inputs[0]); links.new(ramp.outputs['Color'], darken.inputs[6])
    links.new(darken.outputs[2], p.inputs['Base Color'])
    # Bump: cellular hide cracks plus fine pores, baked to the tangent normal map.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 58
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    cracks = nodes.new('ShaderNodeMapRange'); cracks.inputs['From Max'].default_value = .028
    links.new(vor.outputs['Distance'], cracks.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 120
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .7
    links.new(cracks.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = .3
    links.new(pores.outputs['Fac'], m2.inputs[0]); links.new(m1.outputs[0], m2.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .22
    bmp.inputs['Distance'].default_value = .003
    links.new(m2.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .52
    rough.inputs['To Max'].default_value = .72
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

skin_shader(skin, (.34, .078, .030), (.21, .040, .018), (.45, .13, .052))
skin_shader(ear_inner, (.20, .040, .018), (.13, .026, .012), (.26, .062, .026))
surface_detail(leather, 55, .002, .25)
surface_detail(leather_edge, 45, .0015, .28)
surface_detail(cloth, 80, .002, .25, (1, 1, 1.5))
surface_detail(wood, 18, .003, .42, (7, 7, .4))
surface_detail(rope, 90, .0025, .30, (1, 1, .25), .5)
surface_detail(iron, 40, .0012, .30)
surface_detail(steel, 50, .0007, .2)
surface_detail(claw, 18, .001, .22, (3, 3, .5))
surface_detail(tooth, 24, .0008, .18)

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

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
joints = {}
for s, L in ((-1, 'R'), (1, 'L')):
    joints[L] = dict(shoulder=(s * .50, -.12, 2.15), elbow=(s * .72, -.05, 1.55), wrist=(s * .85, -.28, 1.05), hand=(s * .86, -.36, .78),
                     hip=(s * .24, -.02, 1.42), knee=(s * .36, -.06, .95), ankle=(s * .40, .0, .32), foot=(s * .41, -.45, .10))

# ---------------------------------------------------------------- body sculpt
# Hunched: the chest leans forward, the head sinks between the shoulders, the belly
# pushes out, the arms hang to knee level and the legs are short and bowed.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Pot belly', (0, -.13, 1.60), (.40, .40, .36), bone='hips'))
B(ell('Pelvis', (0, -.02, 1.42), (.36, .28, .26), bone='hips'))
B(ell('Ribcage', (0, -.06, 1.96), (.39, .31, .34)))
B(ell('Hunched upper back', (0, .10, 2.12), (.37, .26, .28)))
B(ell('Upper chest', (0, -.14, 2.18), (.46, .28, .22)))
B(ell('Neck', (0, -.22, 2.32), (.24, .22, .22)))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    B(ell('Buttock', (s * .15, .15, 1.40), (.21, .19, .19), bone='hips'))
    B(ell('Pectoral', (s * .17, -.30, 2.02), (.20, .13, .15)))
    B(ell('Collar', (s * .30, -.20, 2.24), (.20, .16, .13)))
    B(ell('Deltoid', (s * .52, -.10, 2.14), (.19, .19, .21), bone=f'upper_arm.{L}'))
    B(limb('Bicep', j['shoulder'], j['elbow'], .14, f'upper_arm.{L}', ry=.15))
    B(ell('Elbow', j['elbow'], (.14, .15, .14), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .135, f'forearm.{L}', ry=.14))
    B(ell('Wrist', j['wrist'], (.115, .115, .105), bone=f'forearm.{L}'))
    B(limb('Thigh', j['hip'], j['knee'], .24, f'thigh.{L}', ry=.26))
    B(ell('Knee', j['knee'], (.16, .18, .16), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .19, f'shin.{L}', ry=.21))
    B(ell('Ankle', j['ankle'], (.14, .14, .14), bone=f'shin.{L}'))
    B(ell('Broad foot', (s * .41, -.12, .15), (.23, .36, .15), bone=f'foot.{L}'))
    B(ell('Heel', (s * .40, .14, .14), (.15, .13, .14), bone=f'foot.{L}'))
    for i in range(3):
        x = s * .41 + (i - 1) * .165
        B(ell('Toe', (x, -.52, .10), (.075, .16, .075), bone=f'foot.{L}'))
samples = []
for o in body_parts:
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone']))
tree = KDTree(len(samples))
for i, (co, bone) in enumerate(samples): tree.insert(co, i)
tree.balance()
body = union('Continuous body sculpt', body_parts, .028, .6)
body['weighted_body'] = True
for s, L in ((-1, 'R'), (1, 'L')):
    for i in range(3):
        x = s * .41 + (i - 1) * .15
        tube('Curved toe claw', [(x, -.63, .10), (x, -.73, .11), (x, -.81, .07), (x, -.85, .045)], .045, claw, f'foot.{L}', lambda t: (1 - t) ** .8 + .05)

# ---------------------------------------------------------------- head sculpt
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, -.24, 2.66), (.50, .44, .47), bone='head'))
H(ell('Skull crown', (0, -.12, 2.96), (.30, .32, .15), bone='head'))
H(ell('Sloped forehead', (0, -.35, 2.90), (.32, .20, .18), bone='head'))
H(ell('Occiput', (0, .04, 2.60), (.38, .30, .34), bone='head'))
H(ell('Neck root', (0, -.20, 2.34), (.22, .20, .20), bone='head'))
H(ell('Jaw', (0, -.34, 2.32), (.40, .36, .23), bone='head'))
H(ell('Muzzle', (0, -.60, 2.36), (.36, .24, .15), bone='head'))
H(ell('Chin', (0, -.60, 2.20), (.17, .15, .11), bone='head'))
H(ell('Nose bridge', (0, -.70, 2.58), (.10, .11, .13), bone='head'))
H(ell('Broad flat nose', (0, -.84, 2.44), (.22, .13, .10), bone='head'))
H(ell('Glabella knot', (0, -.68, 2.66), (.09, .08, .09), bone='head'))
for s in (-1, 1):
    H(ell('Temple', (s * .34, -.22, 2.74), (.19, .25, .23), bone='head'))
    H(ell('Cheekbone', (s * .40, -.42, 2.46), (.18, .20, .16), bone='head'))
    H(ell('Grin fold', (s * .39, -.50, 2.38), (.11, .11, .15), bone='head'))
    H(ell('Nostril wing', (s * .15, -.77, 2.42), (.11, .10, .085), bone='head'))
    # The V-shaped scowl: brows and lids slope down toward the nose.
    H(ell('Heavy brow', (s * .22, -.68, 2.71), (.23, .085, .062), bone='head', rot=(.30, -s * .36, 0)))
    H(ell('Angry upper lid', (s * .21, -.62, 2.64), (.17, .09, .06), bone='head', rot=(0, -s * .38, 0)))
    H(ell('Lower lid', (s * .23, -.60, 2.41), (.16, .085, .05), bone='head', rot=(0, -s * .14, 0)))
head_obj = union('Head sculpt pass 1', head_parts, .020, 1.0, smoothing=1, bone='head')
# Second pass: lips and wrinkles are seated on the first sculpt, then welded in.
def grin(x):
    return 2.31 + .20 * (x / .36) ** 2
def gape(x):
    return .09 * math.sqrt(max(0, 1 - (x / .36) ** 2))
grin_x = [-.36 + .72 * i / 12 for i in range(13)]
upper = conformed([(x, -.70, grin(x)) for x in grin_x], head_obj, .018)
lower = conformed([(x, -.70, grin(x) - gape(x)) for x in grin_x], head_obj, .022)
refine = [head_obj]
refine.append(tube('Upper lip', upper, .030, skin, 'head', lambda t: .7 + .3 * math.sin(math.pi * t)))
refine.append(tube('Lower lip', lower, .040, skin, 'head', lambda t: .7 + .3 * math.sin(math.pi * t)))
for z in (2.90, 2.98):
    fold = conformed([(x, -.75, z + .02 * math.cos(x * 4)) for x in (-.24, -.12, 0, .12, .24)], head_obj, -.004)
    refine.append(tube('Forehead wrinkle', fold, .015, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
for s in (-1, 1):
    crease = conformed([(s * .30, -.62, 2.60), (s * .38, -.56, 2.48), (s * .40, -.50, 2.36)], head_obj, 0)
    refine.append(tube('Cheek crease', crease, .018, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
head_obj = union('Head sculpt', refine, .018, .5, smoothing=1, bone='head')
# Face features seated on the final sculpt.
strip_up = conformed([(x, -.70, grin(x) - .02) for x in grin_x], head_obj, .005)
strip_low = conformed([(x, -.70, grin(x) - gape(x) + .02) for x in grin_x], head_obj, .005)
mouth = mesh('Mouth cavity', strip_up + strip_low, [(i, i + 1, 13 + i + 1, 13 + i) for i in range(12)], dark, 'head')
smooth(mouth)
def fang(name, x, z, length, width, down=True):
    # Small pointed teeth: tapered cones rooted in the lip, tips into the dark of the mouth.
    root, n = surface_point(head_obj, (x, -.72, z), .010)
    tip = root + Vector((0, -.004, -length if down else length))
    rod(name, root + Vector((0, 0, .008 if down else -.008)), tip, width, width * .18, tooth, 'head', 8)
for i, x in enumerate([-.31, -.24, -.16, -.08, 0, .08, .16, .24, .31]):
    big = i in (0, 8)
    fang('Fang' if big else 'Uneven tooth', x, grin(x) - .012, .066 if big else .046 + .006 * (i % 2), .026 if big else .020)
for x in (-.14, .14):
    fang('Lower tooth', x, grin(x) - gape(x) + .012, .036, .018, down=False)
patch('Navel', (0, -.60, 1.56), (.032, .010, .026), dark, 'hips', body, .001)
EYE = {1: (.215, -.545, 2.54), -1: (-.215, -.545, 2.54)}
for s in (-1, 1):
    patch('Nostril', (s * .09, -.95, 2.41), (.048, .012, .030), dark, 'head', head_obj, .002)
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ex, ey, ez = EYE[s]
    ell('Glowing eye', (ex, ey, ez), (.105, .10, .105), amber, eye_bone, 3)
    ell('Eye core', (ex, ey - .086, ez + .005), (.040, .018, .034), hot, eye_bone, 2)

# ---------------------------------------------------------------- bat ears
# Long, narrow and pointed, rooted behind the temples and swept out, up and back.
EAR_BASE = {1: (.40, -.04, 2.68), -1: (-.40, -.04, 2.68)}
EAR_DIR = {1: (1.0, .40, .54), -1: (-1.0, .40, .54)}
EAR_LENGTH = .86
def ear(s):
    label = 'L' if s > 0 else 'R'
    base = Vector(EAR_BASE[s])
    d = Vector(EAR_DIR[s]).normalized()
    n = Vector((-s * .30, -1.0, .10)); n = (n - d * n.dot(d)).normalized()
    a = d.cross(n).normalized()
    N, M, L, W = 16, 8, EAR_LENGTH, .30
    def width(u): return W * (1 - u) ** .85 * (.80 + .20 * math.sin(math.pi * u))
    def P(u, v):
        dish = .045 * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.05)) ** .7
        curl = .06 * u * u
        return base + d * (u * L) + a * ((v - .5) * width(u)) + n * (curl - dish)
    def T(u, v): return .010 + .06 * (1 - u) ** 1.5 * (.35 + .65 * math.sin(math.pi * v))
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
    tf = len(verts); verts.append(P(1, .5)); tb = len(verts); verts.append(P(1, .5) - n * .010)
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
    o = mesh(f'Bat ear {label}', verts, faces, skin, f'ear.{label}')
    o.data.materials.append(ear_inner)
    for p, flag in zip(o.data.polygons, inner): p.material_index = int(flag)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    m = o.modifiers.new('Cartilage', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    smooth(o); return o
ear(-1); ear(1)

# ---------------------------------------------------------------- hands
# Left hand hangs open with curled fingers; right hand grips the pick shaft.
shaft_a = Vector((-.86, -.46, .35)); shaft_b = Vector((-1.08, -.40, 2.25))
shaft_d = (shaft_b - shaft_a).normalized()
def hand(s):
    L = 'L' if s > 0 else 'R'; bone = f'hand.{L}'; pieces = []; claws = []
    pieces.append(ell('Wrist', joints[L]['wrist'], (.12, .12, .10), bone=bone))
    if s > 0:
        pieces.append(ell('Palm', (.84, -.30, .96), (.14, .10, .17), bone=bone))
        for i in range(3):
            x = .77 + .07 * i
            path = [(x, -.34, .86), (x + .01, -.43, .80), (x, -.47, .72), (x - .01, -.43, .66)]
            pieces.append(tube('Finger', path, .050, skin, bone))
            pieces.append(ell('Knuckle', path[0], (.056, .056, .056), bone=bone, sub=2))
            pieces.append(ell('Fingertip', path[-1], (.048, .048, .048), bone=bone, sub=2))
            claws.append([(x - .01, -.43, .66), (x - .01, -.465, .60), (x - .01, -.43, .545)])
        pieces.append(tube('Thumb', [(.80, -.28, 1.02), (.71, -.38, .98), (.69, -.46, .90)], .058, skin, bone))
        pieces.append(ell('Thumb tip', (.69, -.46, .90), (.055, .055, .055), bone=bone, sub=2))
        claws.append([(.69, -.46, .90), (.68, -.51, .86), (.70, -.53, .80)])
    else:
        pieces.append(ell('Palm', (-.80, -.30, .94), (.14, .10, .17), bone=bone))
        for i in range(3):
            z = .84 + .08 * i
            path = [(-.84, -.35, z), (-.863, -.507, z), (-.997, -.507, z), (-.997, -.373, z), (-.94, -.34, z)]
            pieces.append(tube('Gripping finger', path, .044, skin, bone))
            pieces.append(ell('Knuckle', path[1], (.052, .052, .052), bone=bone, sub=2))
            pieces.append(ell('Fingertip', path[-1], (.044, .044, .044), bone=bone, sub=2))
            claws.append([(-.94, -.34, z), (-.90, -.33, z - .01), (-.87, -.35, z - .02)])
        pieces.append(tube('Thumb', [(-.82, -.32, 1.06), (-.90, -.50, 1.10), (-1.0, -.52, 1.06)], .055, skin, bone))
        pieces.append(ell('Thumb tip', (-1.0, -.52, 1.06), (.052, .052, .052), bone=bone, sub=2))
        claws.append([(-1.0, -.52, 1.06), (-1.04, -.54, 1.02), (-1.05, -.50, .98)])
    union(f'Hand sculpt {L}', pieces, .016, .7, bone=bone)
    for path in claws:
        tube('Curved claw', path, .024, claw, bone, lambda t: (1 - t) ** .7 + .05)
hand(1); hand(-1)

# ---------------------------------------------------------------- kit: belt, harness, satchel, loincloth, bracer
def ring(cz, rx, ry, cy=0, steps=32):
    return [(rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps), cz) for i in range(steps)]
belt_ring = ring(1.48, .48, .42, -.04)
ribbon('Wide waist belt', belt_ring, .17, leather, 'hips', body, .012, .022, cyclic=True)
for dz in (-.075, .075):
    tube('Belt piping', conformed(ring(1.48 + dz, .48, .42, -.04), body, .034), .012, leather_edge, 'hips', cyclic=True, res=1, segments=3)
buckle('Waist buckle', (0, -.60, 1.48), .32, .22, 'hips', body, .048, right=(1, 0, 0), radius=.024)
ribbon('Belt tongue', conformed([(.10, -.55, 1.48), (.20, -.53, 1.48), (.30, -.49, 1.475)], body, .02), .12, leather, 'hips', body, .034, .016)
for a in (-2.35, -1.9, -1.2, -.6, .5, 1.3, 2.0):
    patch('Belt rivet', (.48 * math.cos(a), -.04 + .42 * math.sin(a), 1.48), (.022, .012, .022), steel, 'hips', body, .034)
harness = [(-.32, -.36, 1.56), (-.14, -.50, 1.74), (.06, -.52, 1.94), (.26, -.40, 2.12), (.42, -.20, 2.26), (.46, .06, 2.26), (.40, .28, 2.08), (.16, .36, 1.84), (-.14, .30, 1.64), (-.36, .06, 1.52)]
ribbon('Chest harness', harness, .20, leather, 'chest', body, .012, .020, cyclic=True)
buckle('Harness buckle', (.0, -.54, 1.86), .24, .24, 'chest', body, .046, right=(.2, -.02, .2), radius=.022)
for p in ((-.25, -.44, 1.64), (.36, -.30, 2.20), (.44, .18, 2.16)):
    patch('Harness rivet', p, (.024, .013, .024), steel, 'chest', body, .034)
satchel = union('Hip satchel', [
    ell('Pouch', (.50, -.12, 1.30), (.13, .19, .18), leather, 'hips'),
    ell('Pouch belly', (.51, -.12, 1.22), (.14, .18, .13), leather, 'hips'),
    ell('Pouch flap', (.50, -.13, 1.42), (.14, .21, .06), leather, 'hips'),
], .020, .6, leather, 2, 'hips')
buckle('Satchel buckle', (.66, -.16, 1.29), .07, .09, 'hips', satchel, .022, right=(0, -1, 0), radius=.010)
ribbon('Satchel strap', conformed([(.64, -.16, 1.42), (.66, -.16, 1.36), (.66, -.16, 1.30)], satchel, .02), .05, leather_edge, 'hips', satchel, .012, .012)

def loincloth(name, y0, drift, top_z, bottom_z, w_top, w_bottom, cols, rows, sign):
    verts = []; weights = []
    for r in range(rows + 1):
        f = r / rows; z = top_z + (bottom_z - top_z) * f
        w = w_top + (w_bottom - w_top) * f
        for c in range(cols + 1):
            g = c / cols; x = (g - .5) * w
            y = y0 + sign * drift * f ** 1.3 + .015 * math.sin(g * math.pi * 5) * f
            if r == rows: z += (-.045 if c % 2 else .015) + random.uniform(-.015, .015)
            verts.append((x, y, z)); weights.append(1 if r == 0 else .5 if r == 1 else 0)
    faces = [(r * (cols + 1) + c, r * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c) for r in range(rows) for c in range(cols)]
    o = mesh(name, verts, faces, cloth, 'hips')
    group = o.vertex_groups.new(name='tucked under belt')
    for i, w in enumerate(weights):
        if w: group.add([i], w, 'REPLACE')
    m = o.modifiers.new('Drape', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    m = o.modifiers.new('Tuck', 'SHRINKWRAP'); m.target = body; m.wrap_method = 'NEAREST_SURFACEPOINT'
    m.offset = .03; m.vertex_group = 'tucked under belt'; apply_modifier(o, m)
    m = o.modifiers.new('Cloth thickness', 'SOLIDIFY'); m.thickness = .012; m.offset = 0; apply_modifier(o, m)
    smooth(o); return o
loincloth('Front loincloth', -.50, .14, 1.44, .98, .58, .64, 10, 7, 1)
loincloth('Back loincloth', .34, .08, 1.44, 1.06, .52, .56, 8, 5, -1)

# Studded leather bracer on the left forearm.
A, Bv = Vector(joints['L']['elbow']), Vector(joints['L']['wrist'])
axis = (Bv - A).normalized(); center = A.lerp(Bv, .58)
e1 = axis.cross(Vector((0, 0, 1))).normalized(); e2 = axis.cross(e1).normalized()
def arm_ring(offset, r, steps=20):
    return [center + axis * offset + e1 * (r * math.cos(2 * math.pi * i / steps)) + e2 * (r * math.sin(2 * math.pi * i / steps)) for i in range(steps)]
ribbon('Leather bracer', arm_ring(0, .20), .20, leather, 'forearm.L', body, .012, .022, cyclic=True)
for off in (-.085, .085):
    tube('Bracer rim', conformed(arm_ring(off, .20), body, .034), .011, leather_edge, 'forearm.L', cyclic=True, res=1, segments=3)
for k in range(3):
    patch('Bracer stud', center + axis * ((k - 1) * .05) + e1 * .2, (.022, .013, .022), steel, 'forearm.L', body, .034)

# ---------------------------------------------------------------- rope-lashed pick
rod('Pick ash shaft', shaft_a, shaft_b, .055, .048, wood, 'hand.R', 14)
blade = tube('Pick blade', [tuple(shaft_b), (-1.36, -.41, 2.27), (-1.62, -.42, 2.16), (-1.82, -.43, 1.92)], .095, iron, 'hand.R', lambda t: 1 - .93 * t)
spike = tube('Pick back spike', [tuple(shaft_b), (-.86, -.40, 2.34), (-.68, -.40, 2.30)], .080, iron, 'hand.R', lambda t: 1 - .86 * t)
for o, squash in ((blade, .50), (spike, .58)):
    for v in o.data.vertices: v.co.y = -.41 + (v.co.y + .41) * squash
pick_head = union('Forged pick head', [
    block('Socket', shaft_b, (.26, .19, .30), iron, 'hand.R', .05, shaft_d.to_track_quat('Z', 'Y').to_euler()),
    ell('Collar', shaft_b - shaft_d * .12, (.085, .085, .07), iron, 'hand.R'),
    blade, spike,
], .014, .8, iron, 1, 'hand.R')
p1 = shaft_d.cross(Vector((0, 1, 0))).normalized(); p2 = shaft_d.cross(p1).normalized()
for k in range(3):
    tilt = (.6, -.6, .6)[k]; c = shaft_b - shaft_d * (.01 + .05 * k)
    loop = [c + p1 * (.16 * math.cos(2 * math.pi * i / 10)) + p2 * (.16 * math.sin(2 * math.pi * i / 10)) + shaft_d * (tilt * .10 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
    tube('Rope lashing', conformed(loop, pick_head, .013), .015, rope, 'hand.R', cyclic=True, res=1, segments=4)
for k in range(3):
    c = shaft_b - shaft_d * (.17 + .032 * k)
    tube('Rope whipping', [c + p1 * (.066 * math.cos(2 * math.pi * i / 8)) + p2 * (.066 * math.sin(2 * math.pi * i / 8)) for i in range(8)], .014, rope, 'hand.R', cyclic=True, res=1, segments=4)

# ---------------------------------------------------------------- bones (pre-scale)
bones = {
    'root': ((0, 0, 0), (0, 0, .25), None),
    'hips': ((0, 0, 1.40), (0, -.03, 1.70), 'root'),
    'chest': ((0, -.03, 1.70), (0, -.16, 2.30), 'hips'),
    'head': ((0, -.18, 2.34), (0, -.28, 3.05), 'chest'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, 0, .2))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, 0, .2))), 'head'),
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
    weights = {name: math.exp(-((d - nearest) / .052) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
# The head was sculpted generously for control; settle it to DK2 proportions
# (roughly 30% of standing height) by scaling head islands and bones about one pivot.
HEAD_SCALE = .92; HEAD_PIVOT = Vector((0, -.25, 2.60))
def settle(co): return HEAD_PIVOT + (Vector(co) - HEAD_PIVOT) * HEAD_SCALE
head_bones = {'head', 'eye.L', 'eye.R', 'ear.L', 'ear.R'}
SCALE = .395
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
    for count, name in budget[:14]: print(f'TRIANGLES {count:7d} {name}')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Imp_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices: v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural hide, leather, rope and metal into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(amber, hot))

rig_data = bpy.data.armatures.new('Imp_Skeleton')
rig = bpy.data.objects.new('Imp_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = Vector(a) * SCALE; eb.tail = Vector(b) * SCALE
    if parent: eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Imp skeleton', 'ARMATURE'); mod.object = rig
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

def close_eyes(closure):
    for name in ('eye.L', 'eye.R'):
        eye = rig.pose.bones[name]
        eye.scale.y = 1 - .94 * closure
        eye.scale.z = 1 - .90 * closure
        # Retract the glowing cornea as it closes, avoiding a projecting wedge in profile.
        eye.location.z = -.055 * SCALE * closure

def blink(t, centers=(.24, .70)):
    closure = max([max(0, 1 - abs(t - center) / .026) for center in centers] + [0])
    close_eyes(closure)

def ears(left, right, droop=0):
    # DK2 imps flick their ears; drooping ears read as defeat.
    rot('ear.L', .14 * left, .10 * left + .55 * droop, -.10 * left)
    rot('ear.R', .14 * right, -.10 * right - .55 * droop, .10 * right)

def idle(t):
    w = math.sin(t * math.tau * 2)
    look = curve(t, [(0, 0), (.20, 0), (.35, .16), (.55, .16), (.72, -.13), (.88, -.13), (1, 0)])
    rot('chest', .018 * w, 0, .02 * math.sin(t * math.tau))
    rot('head', -.03 * w, .06 * math.sin(t * math.tau), look)
    rot('upper_arm.L', .045 * w, 0, -.025); rot('upper_arm.R', -.025 * w)
    rig.pose.bones['chest'].scale.y = 1 + .012 * w
    ears(max(bump(t, .30, .05), bump(t, .84, .05)), bump(t, .62, .05))
    blink(t, (.24, .70, .77))
def walk(t, carry=False):
    w = math.sin(t * math.tau)
    rig.pose.bones['root'].location.y = .018 * (1 - math.cos(t * math.tau * 2))
    rot('hips', 0, .035 * w, .04 * w)
    for label, s in [('L', 1), ('R', -1)]:
        stride = s * w
        rot('thigh.' + label, .56 * stride); rot('shin.' + label, -max(0, stride) * .78)
        rot('foot.' + label, -.18 * stride + max(0, stride) * .18)
        rot('upper_arm.' + label, -.82 if carry else -s * .34 * w, 0, s * .065)
        rot('forearm.' + label, -.38 if carry else -.10 - max(0, -stride) * .13)
        if carry: rot('hand.' + label, .50)
    rot('chest', .10 if carry else .04, 0, -.035 * w)
    rot('head', -.05, 0, .025 * w)
    bob = .06 * math.cos(t * math.tau * 2)
    rot('ear.L', bob, 0, 0); rot('ear.R', bob, 0, 0)
def mine(t):
    # Anticipation, overhead wind-up, fast strike, impact hold, then recovery.
    lift = curve(t, [(0, 0), (.16, -.08), (.47, 1), (.60, -.15), (.69, -.15), (1, 0)])
    impact = math.exp(-((t - .62) / .055) ** 2)
    rot('upper_arm.R', -.40 - 1.55 * lift, 0, -.07 * lift)
    rot('forearm.R', -.18 - .32 * max(0, lift)); rot('hand.R', .95 + .55 * max(0, lift))
    rot('chest', .12 - .12 * lift + .10 * impact, 0, -.10 * lift)
    rot('head', -.06 + .09 * impact, 0, .055 * lift)
    rot('upper_arm.L', -.20, 0, -.16); rot('forearm.L', -.18)
    for label in ('L', 'R'): rot('thigh.' + label, .08 * impact); rot('shin.' + label, -.15 * impact)
    rig.pose.bones['root'].location.y = -.012 * impact
    ears(-.5 * impact, -.5 * impact)
    blink(t, (.615,))
def attack(t):
    # A separate quick, startled swipe instead of recycling the mining clip.
    swing = curve(t, [(0, 0), (.28, -.4), (.49, .75), (.61, .82), (1, 0)])
    rot('chest', .09, 0, -swing * .32); rot('head', -.04, 0, swing * .18)
    rot('upper_arm.R', -.7, 0, swing); rot('forearm.R', -.2)
    rot('hand.R', .6, 0, -swing * .45); rot('upper_arm.L', -.35, 0, -.2)
    ears(-.6 * max(0, swing), -.6 * max(0, swing))
def hit(t):
    w = curve(t, [(0, 0), (.17, 1), (.39, .60), (.70, -.12), (1, 0)])
    rot('chest', -.30 * w, 0, .12 * w); rot('head', -.20 * w, 0, -.12 * w)
    rot('upper_arm.L', -.45 * w, 0, -.18 * w); rot('upper_arm.R', -.20 * w)
    ears(-w, -w)
    blink(t, (.18,))
def death(t):
    k = curve(t, [(0, 0), (.18, .06), (.58, 1), (.70, .94), (1, 1)])
    rot('root', -1.40 * k, 0, .10 * k)
    rig.pose.bones['root'].location.y = .19 * k
    rot('upper_arm.L', -.4 * k, 0, -.5 * k); rot('upper_arm.R', -.25 * k, 0, .30 * k)
    rot('thigh.L', .20 * k); rot('shin.L', -.40 * k); rot('head', .16 * k)
    ears(0, 0, droop=k)
    close_eyes(min(1, t * 3))
pose('Idle', 121, idle); pose('Walk', 23, walk); pose('Mine', 43, mine)
pose('Carry', 31, lambda t: walk(t, True)); pose('Attack', 25, attack)
pose('Hit', 19, hit); pose('Death', 49, death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = 'Dungeon Keeper 2 worker imp: rust hide, glowing amber eyes, scowl, wide grin, bat ears, hunched stance, rope-lashed pick.'
rig['clips'] = 'Idle, Walk, Mine, Carry, Attack, Hit, Death'
rig['scale_note'] = 'Feet at ground; 1.24 units tall; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'imp.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'imp.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials), 'height': round(max(v.co.z for v in character.data.vertices) - min(v.co.z for v in character.data.vertices), 3),
        'animations': ['Idle', 'Walk', 'Mine', 'Carry', 'Attack', 'Hit', 'Death']}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, .65))
area('Warm key', (-2.5, -3.5, 4.2), 260, (1, .76, .50), 2.5)
area('Soft fill', (2, -2, 2), 85, (.65, .80, 1), 2.5)
area('Cool rim', (-1, 2, 2.8), 450, (.36, .73, 1), 2)
bpy.ops.object.camera_add(location=(2.05, -5.4, 2.70)); cam = bpy.context.object
aim(cam, (-.06, 0, .64)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.85; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = 121
if not FAST:
    # Reference is packed into the source file for convenient further modeling.
    ref = bpy.data.images.load(str(ROOT / 'Imp_Sample.png')); ref.pack()
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'imp.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'imp-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing makes the face and surface detail easy to inspect.
cam.location = (1.6, -5.4, 2.55); aim(cam, (0, -.10, 1.0)); cam.data.ortho_scale = .95
scene.render.filepath = str(PREVIEW / 'imp-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the hunch, the ear sweep and the hanging arms.
cam.location = (5.6, -.4, 1.6); aim(cam, (0, -.05, .62)); cam.data.ortho_scale = 1.85
scene.render.filepath = str(PREVIEW / 'imp-side.png')
bpy.ops.render.render(write_still=True)
print('IMP_BUILD_COMPLETE', triangles, 'triangles')
