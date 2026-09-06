"""Build the Dungeon Keeper giant Fly with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_fly.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: a housefly the size of a dog, hovering rather than standing.
Hairy dark olive-brown thorax and head, a darker banded abdomen with a slight
sheen, two huge red compound eyes glowing with an emissive shader, a short
proboscis, two antennae, small mandibles, six spindly jointed legs (femur,
tibia, hooked tarsus) dangling under the thorax, and two pairs of translucent
veined wings. Everything but the wings and eyes is sculpted from overlapping
primitives that are voxel-remeshed into one continuous body, exactly as the
imp reference script does; the wings reuse the imp's parametric-shell (ear())
technique for a thin, ribbed membrane.
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
random.seed(717)
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

# The dungeon Fly is a hairy olive-brown insect: dark, faintly iridescent
# thorax and head, a darker segmented abdomen with a slight waxy sheen, dark
# horn-coloured chitin for the legs/mouthparts/antennae, huge glowing red
# compound eyes and translucent veined wings (both kept out of the atlas).
# Thorax, head and abdomen are one continuous welded sculpt (see the body
# union below) so they share a single material; its appearance still varies
# region-to-region the way the imp's skin_shader darkens the back and warms
# the belly -- one shader graph with an object-space Y gradient, not several
# materials, because a union collapses everything to whatever material it is
# given.
thorax = material('Hide | olive-brown chitin', (.07, .057, .026), 0, .74)
chitin = material('Chitin | legs and mouthparts', (.045, .035, .026), .05, .40)
# Kept materials: excluded from the shared atlas bake so their emission/alpha survive.
eye = material('Eyes | compound red glow', (.30, .015, .008), 0, .30, 2.1, (1, .05, .02))
wing = material('Wings | veined membrane', (.34, .29, .19), 0, .38)
wing.blend_method = 'BLEND'
wing.show_transparent_back = True
wp = wing.node_tree.nodes.get('Principled BSDF')
wp.inputs['Alpha'].default_value = .35

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

def hide_shader(mat, thorax_dark, thorax_base, abdomen_dark, abdomen_base, sheen_color):
    """One shader for the whole welded body: a hairy bristled look on the thorax
    and head, blending by object-space Y into a darker banded-segment look on
    the abdomen -- the same trick the imp's skin_shader uses (a position-based
    gradient) rather than a second material, since the body union below welds
    everything into a single mesh/material. All coordinates are object-space so
    this is independent of whatever UV layout the atlas bake later assigns."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    region = nodes.new('ShaderNodeMapRange'); region.inputs['From Min'].default_value = .12
    region.inputs['From Max'].default_value = .40; links.new(sep.outputs['Y'], region.inputs['Value'])

    # -- thorax/head: patchy mottling plus a dense, elongated bump field that
    # reads as short bristles rather than smooth skin.
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 7
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .65
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    tramp = nodes.new('ShaderNodeValToRGB')
    tramp.color_ramp.elements[0].position = .18; tramp.color_ramp.elements[0].color = (*thorax_dark, 1)
    tramp.color_ramp.elements[1].position = .55; tramp.color_ramp.elements[1].color = (*thorax_base, 1)
    links.new(blotch.outputs['Fac'], tramp.inputs[0])
    stretch = nodes.new('ShaderNodeVectorMath'); stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = (1, 1, 2.6)
    links.new(tex.outputs['Object'], stretch.inputs[0])
    hairs = nodes.new('ShaderNodeTexVoronoi'); hairs.feature = 'DISTANCE_TO_EDGE'
    hairs.inputs['Scale'].default_value = 26
    links.new(stretch.outputs[0], hairs.inputs['Vector'])
    hairramp = nodes.new('ShaderNodeMapRange'); hairramp.inputs['From Max'].default_value = .06
    hairramp.inputs['To Min'].default_value = 1; hairramp.inputs['To Max'].default_value = 0
    links.new(hairs.outputs['Distance'], hairramp.inputs['Value'])
    fine = nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value = 78
    fine.inputs['Detail'].default_value = 2; links.new(stretch.outputs[0], fine.inputs['Vector'])
    bristle_h = nodes.new('ShaderNodeMath'); bristle_h.operation = 'MULTIPLY_ADD'; bristle_h.inputs[1].default_value = .35
    links.new(hairramp.outputs[0], bristle_h.inputs[0]); links.new(fine.outputs['Fac'], bristle_h.inputs[2])
    trough = nodes.new('ShaderNodeMapRange'); trough.inputs['To Min'].default_value = .60
    trough.inputs['To Max'].default_value = .82
    links.new(blotch.outputs['Fac'], trough.inputs['Value'])

    # -- abdomen: dark bands across the long axis, a subtle iridescent sheen,
    # and shallow ring creases between segments.
    wave = nodes.new('ShaderNodeTexWave'); wave.wave_type = 'BANDS'; wave.bands_direction = 'Y'
    wave.inputs['Scale'].default_value = 9.5; wave.inputs['Distortion'].default_value = .6
    links.new(tex.outputs['Object'], wave.inputs['Vector'])
    jitter = nodes.new('ShaderNodeTexNoise'); jitter.inputs['Scale'].default_value = 40
    links.new(tex.outputs['Object'], jitter.inputs['Vector'])
    mixband = nodes.new('ShaderNodeMix'); mixband.data_type = 'FLOAT'
    mixband.inputs['Factor'].default_value = .18
    links.new(wave.outputs['Fac'], mixband.inputs['A']); links.new(jitter.outputs['Fac'], mixband.inputs['B'])
    aramp = nodes.new('ShaderNodeValToRGB')
    aramp.color_ramp.elements[0].position = .30; aramp.color_ramp.elements[0].color = (*abdomen_dark, 1)
    aramp.color_ramp.elements[1].position = .50; aramp.color_ramp.elements[1].color = (*abdomen_base, 1)
    links.new(mixband.outputs[0], aramp.inputs[0])
    fres = nodes.new('ShaderNodeFresnel'); fres.inputs['IOR'].default_value = 1.3
    tint = nodes.new('ShaderNodeMix'); tint.data_type = 'RGBA'; tint.blend_type = 'SCREEN'
    tint.inputs[7].default_value = (*sheen_color, 1)
    sheen_amount = nodes.new('ShaderNodeMath'); sheen_amount.operation = 'MULTIPLY'; sheen_amount.inputs[1].default_value = .16
    links.new(fres.outputs[0], sheen_amount.inputs[0]); links.new(sheen_amount.outputs[0], tint.inputs['Factor'])
    links.new(aramp.outputs['Color'], tint.inputs[6])
    aroughrange = nodes.new('ShaderNodeMapRange'); aroughrange.inputs['To Min'].default_value = .32
    aroughrange.inputs['To Max'].default_value = .55
    links.new(mixband.outputs[0], aroughrange.inputs['Value'])
    acreases = nodes.new('ShaderNodeMapRange'); acreases.inputs['From Min'].default_value = .40
    acreases.inputs['From Max'].default_value = .48; links.new(wave.outputs['Fac'], acreases.inputs['Value'])

    # -- blend the two regions by object Y, then a single Bump node from the result.
    colormix = nodes.new('ShaderNodeMix'); colormix.data_type = 'RGBA'
    links.new(region.outputs[0], colormix.inputs['Factor'])
    links.new(tramp.outputs['Color'], colormix.inputs[6]); links.new(tint.outputs[2], colormix.inputs[7])
    links.new(colormix.outputs[2], p.inputs['Base Color'])
    heightmix = nodes.new('ShaderNodeMix'); heightmix.data_type = 'FLOAT'
    links.new(region.outputs[0], heightmix.inputs['Factor'])
    links.new(bristle_h.outputs[0], heightmix.inputs['A']); links.new(acreases.outputs[0], heightmix.inputs['B'])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .40
    bmp.inputs['Distance'].default_value = .0026
    links.new(heightmix.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    roughmix = nodes.new('ShaderNodeMix'); roughmix.data_type = 'FLOAT'
    links.new(region.outputs[0], roughmix.inputs['Factor'])
    links.new(trough.outputs[0], roughmix.inputs['A']); links.new(aroughrange.outputs[0], roughmix.inputs['B'])
    links.new(roughmix.outputs[0], p.inputs['Roughness'])

def hex_eye_bump(mat):
    """Compound-eye facets for the render only: a dense cell pattern bumped into
    the Normal input. Kept materials export their flat Base Color/Emission values
    (verified against this project's glTF exporter), so this detail is deliberately
    render-only -- exactly like the imp's flat molten-glow eyes."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    cells = nodes.new('ShaderNodeTexVoronoi'); cells.feature = 'DISTANCE_TO_EDGE'
    cells.inputs['Scale'].default_value = 46
    links.new(tex.outputs['Object'], cells.inputs['Vector'])
    facet = nodes.new('ShaderNodeMapRange'); facet.inputs['From Max'].default_value = .05
    facet.inputs['To Min'].default_value = 1; facet.inputs['To Max'].default_value = 0
    links.new(cells.outputs['Distance'], facet.inputs['Value'])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .55
    bmp.inputs['Distance'].default_value = .0018
    links.new(facet.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])

def vein_bump(mat):
    """Wing venation for the render only, same reasoning as hex_eye_bump: veins
    fan out from the wing root and are pressed into the Normal so they read as
    shaded ridges under the translucent membrane in every render pass."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    stretch = nodes.new('ShaderNodeVectorMath'); stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = (2.4, 1, 6)
    links.new(tex.outputs['Object'], stretch.inputs[0])
    veins = nodes.new('ShaderNodeTexVoronoi'); veins.feature = 'DISTANCE_TO_EDGE'
    veins.inputs['Scale'].default_value = 3.2
    links.new(stretch.outputs[0], veins.inputs['Vector'])
    ridge = nodes.new('ShaderNodeMapRange'); ridge.inputs['From Max'].default_value = .05
    ridge.inputs['To Min'].default_value = 1; ridge.inputs['To Max'].default_value = 0
    links.new(veins.outputs['Distance'], ridge.inputs['Value'])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .8
    bmp.inputs['Distance'].default_value = .006
    links.new(ridge.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])

hide_shader(thorax, (.030, .020, .007), (.155, .098, .028), (.020, .013, .005), (.095, .058, .018), (.10, .16, .07))
surface_detail(chitin, 34, .0016, .22, (2, 2, .6), .34)
hex_eye_bump(eye)
vein_bump(wing)

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

def ell(name, pos, size, mat=None, bone='body', sub=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=pos)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or thorax, bone)

def mesh(name, verts, faces, mat, bone):
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    return own(o, mat, bone)

def rod(name, a, b, r1, r2, mat, bone, sides=10):
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
        if taper: bp.radius = max(.006, taper(i / (len(points) - 1)))
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
    o.data.materials.clear(); o.data.materials.append(mat or thorax)
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

# ---------------------------------------------------------------- body sculpt
# One continuous sculpt spans thorax, neck, head and abdomen -- weight-blended
# across three bones with the same KD-tree technique the imp uses for its torso,
# so the neck and waist have no visible seam.
body_parts = []
def B(o): body_parts.append(o); return o
# Thorax (bone 'body'): a rounded hump with a raised notum and small wing bosses.
B(ell('Thorax core', (0, 0.00, .85), (.24, .27, .22), bone='body'))
B(ell('Notum hump', (0, .10, .95), (.18, .17, .12), bone='body'))
B(ell('Thorax belly', (0, -.02, .72), (.20, .23, .15), bone='body'))
B(ell('Thorax front taper', (0, -.16, .86), (.14, .13, .14), bone='body'))
B(ell('Neck', (0, -.24, .87), (.10, .09, .095), bone='body'))
for s in (-1, 1):
    B(ell('Wing boss', (s * .14, .06, .93), (.09, .10, .08), bone='body'))
# Head (bone 'head'): rounded, dominated by two eye bulges that seat the compound eyes.
B(ell('Head mass', (0, -.34, .875), (.155, .145, .155), bone='head'))
B(ell('Head crown', (0, -.28, .955), (.10, .095, .075), bone='head'))
B(ell('Face front', (0, -.45, .865), (.115, .10, .115), bone='head'))
B(ell('Lower face', (0, -.42, .795), (.075, .07, .06), bone='head'))
for s in (-1, 1):
    B(ell('Eye bulge', (s * .115, -.36, .905), (.105, .105, .10), bone='head'))
# Abdomen (bone 'abdomen'): four tapering segments plus a rounded tip.
B(ell('Abdomen seg 1', (0, .28, .815), (.195, .185, .175), bone='abdomen'))
B(ell('Abdomen seg 2', (0, .44, .755), (.155, .15, .135), bone='abdomen'))
B(ell('Abdomen seg 3', (0, .575, .70), (.115, .11, .095), bone='abdomen'))
B(ell('Abdomen seg 4', (0, .685, .655), (.075, .07, .06), bone='abdomen'))
B(ell('Abdomen tip', (0, .765, .62), (.04, .038, .032), bone='abdomen'))
samples = []
for o in body_parts:
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone']))
tree = KDTree(len(samples))
for i, (co, bone) in enumerate(samples): tree.insert(co, i)
tree.balance()
body = union('Continuous body sculpt', body_parts, .0105, .8, mat=thorax)
body['weighted_body'] = True

# ---------------------------------------------------------------- head features
# Seated on the final unified sculpt, exactly as the imp seats its nostrils and eyes.
EYE = {1: (.148, -.375, .915), -1: (-.148, -.375, .915)}
for s in (-1, 1):
    ex, ey, ez = EYE[s]
    ell('Compound eye', (ex, ey, ez), (.135, .135, .13), eye, 'head', sub=3)
patch('Mandible', (.045, -.475, .815), (.028, .025, .022), chitin, 'head', body, .004)
patch('Mandible', (-.045, -.475, .815), (.028, .025, .022), chitin, 'head', body, .004)
proboscis_root, _ = surface_point(body, (0, -.47, .845), .006)
rod('Proboscis', proboscis_root, proboscis_root + Vector((0, -.13, -.055)), .033, .011, chitin, 'head', 8)
for s in (-1, 1):
    base, n = surface_point(body, (s * .06, -.36, .965), .004)
    mid = base + Vector((s * .05, -.11, .045))
    tip = mid + Vector((s * .045, -.09, .06))
    tube('Antenna', [base, mid, tip], .017, chitin, 'head', lambda t: (1 - t) ** .8 + .05)

# ---------------------------------------------------------------- wings
# Parametric shells, exactly the imp's ear() technique: a grid of front/back
# vertices, a closed rim, one subdivision pass. Thin overall with a stiffer
# leading-edge rib (a thicker thickness band near v=0) standing in for the
# real costa vein -- "thin with a rim" the way the ear brief describes.
WING_DEF = {
    'FL': dict(base=(.15, .02, .97), dir=(.85, .12, .32), length=.70, width=.34),
    'FR': dict(base=(-.15, .02, .97), dir=(-.85, .12, .32), length=.70, width=.34),
    'BL': dict(base=(.13, .16, .93), dir=(.80, .22, .22), length=.55, width=.26),
    'BR': dict(base=(-.13, .16, .93), dir=(-.80, .22, .22), length=.55, width=.26),
}
def wing_shell(label):
    d = WING_DEF[label]
    s = 1 if label.endswith('L') else -1
    base = Vector(d['base']); vec = Vector(d['dir']).normalized(); L = d['length']; W = d['width']
    up = Vector((0, -.12 * s, 1)).normalized()
    a = vec.cross(up).normalized()  # across the membrane's width
    n = a.cross(vec).normalized()   # membrane normal, for thickness offset
    def width(u): return W * (1 - u) ** .82 * (.78 + .22 * math.sin(math.pi * u))
    def P(u, v):
        cup = .05 * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.05)) ** .7
        curl = .05 * u * u
        return base + vec * (u * L) + a * ((v - .5) * width(u)) + n * (curl - cup)
    def T(u, v):
        rib = .16 if v < .22 else 0  # leading-edge rib, thicker than the membrane
        return .0035 + .05 * (1 - u) ** 1.6 * (.30 + .70 * math.sin(math.pi * v)) + rib * (1 - u) ** 1.4
    N, M = 13, 6
    verts = []; F = []; K = []
    for i in range(N):
        u = i / N * .96
        F.append([]); K.append([])
        for j in range(M + 1):
            v = j / M
            F[i].append(len(verts)); verts.append(P(u, v))
        for j in range(M + 1):
            v = j / M
            K[i].append(len(verts)); verts.append(P(u, v) - n * T(u, v))
    tf = len(verts); verts.append(P(1, .5)); tb = len(verts); verts.append(P(1, .5) - n * .006)
    faces = []
    for i in range(N - 1):
        for j in range(M):
            faces.append((F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1]))
            faces.append((K[i][j], K[i][j + 1], K[i + 1][j + 1], K[i + 1][j]))
        faces.append((F[i][0], K[i][0], K[i + 1][0], F[i + 1][0]))
        faces.append((F[i][M], F[i + 1][M], K[i + 1][M], K[i][M]))
    for j in range(M):
        faces.append((F[0][j], F[0][j + 1], K[0][j + 1], K[0][j]))
        faces.append((F[N - 1][j], tf, F[N - 1][j + 1]))
        faces.append((K[N - 1][j], K[N - 1][j + 1], tb))
    faces.append((F[N - 1][0], tf, tb, K[N - 1][0]))
    faces.append((F[N - 1][M], K[N - 1][M], tb, tf))
    o = mesh(f'Wing {label}', verts, faces, wing, f'wing.{label}')
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    m = o.modifiers.new('Membrane', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    smooth(o); return o
for label in WING_DEF: wing_shell(label)

# ---------------------------------------------------------------- legs
# Six spindly jointed legs (femur + tibia/tarsus), two bones each, dangling
# under the thorax. Front legs lean forward, back legs lean back, mid legs
# splay widest -- the small per-row 'lean' and 'spread' below carry that.
LEG_ROWS = [
    ('front', -.12, -.045, .96),
    ('mid', .02, .0, 1.12),
    ('back', .16, .06, .92),
]
def leg(row, attach_y, lean, spread, s):
    side = 'L' if s > 0 else 'R'
    hip_bone = f'leg_{row}.{side}'; knee_bone = f'leg_{row}_knee.{side}'
    hip = Vector((s * .15, attach_y, .65))
    knee = Vector((s * .30 * spread, attach_y - .07 + lean, .49))
    tip = Vector((s * .235 * spread, attach_y - .17 + lean * 1.4, .40))
    rod('Femur', hip, knee, .026, .017, chitin, hip_bone, 8)
    rod('Tibia', knee, tip, .017, .008, chitin, knee_bone, 8)
    hook = tip + Vector((s * -.02, -.045, -.035))
    tube('Tarsus hook', [tip, tip + Vector((s * -.01, -.03, -.02)), hook], .009, chitin, knee_bone,
         lambda t: (1 - t) ** .7 + .04)
    return hip_bone, knee_bone, hip, knee, tip
leg_bones = {}
for row, attach_y, lean, spread in LEG_ROWS:
    for s in (-1, 1):
        hip_bone, knee_bone, hip, knee, tip = leg(row, attach_y, lean, spread, s)
        leg_bones[hip_bone] = (hip, knee)
        leg_bones[knee_bone] = (knee, tip)

# ---------------------------------------------------------------- bones
bones = {
    'root': ((0, 0, 0), (0, 0, .15), None),
    'body': ((0, 0, 0), (0, -.10, .85), 'root'),
    'head': ((0, -.24, .87), (0, -.48, .865), 'body'),
    'abdomen': ((0, 0, .85), (0, .60, .68), 'body'),
}
for label, d in WING_DEF.items():
    base = Vector(d['base']); tip = base + Vector(d['dir']).normalized() * d['length']
    bones[f'wing.{label}'] = (tuple(base), tuple(tip), 'body')
for name, (a, b) in leg_bones.items():
    parent = 'body' if '_knee' not in name else name.replace('_knee', '')
    bones[name] = (tuple(a), tuple(b), parent)

for name in bones: body.vertex_groups.new(name=name)
for vertex in body.data.vertices:
    nearby = tree.find_n(vertex.co, 14)
    closest = {}
    for _, idx, distance in nearby:
        name = samples[idx][1]
        closest[name] = min(distance, closest.get(name, 100))
    nearest = min(closest.values())
    weights = {name: math.exp(-((d - nearest) / .045) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
SCALE = 1.0
for o in parts:
    activate(o)
    for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if not o.get('weighted_body'):
        group = o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
if FAST:
    budget = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in parts), reverse=True)
    for count, name in budget[:14]: print(f'TRIANGLES {count:7d} {name}')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Fly_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices: v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural olive-brown hide, banded abdomen and chitin into three
    # embedded 2K maps. The eyes and wings are kept out (flat/procedural on export).
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(eye, wing), prefix='fly')

rig_data = bpy.data.armatures.new('Fly_Skeleton')
rig = bpy.data.objects.new('Fly_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = Vector(a) * SCALE; eb.tail = Vector(b) * SCALE
    if parent: eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Fly skeleton', 'ARMATURE'); mod.object = rig
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

def flutter(t, beats, lift=1.0, phase=0.0, spread=.55):
    # A fast wing beat: sharp downstroke, softer recovery, several cycles per loop.
    phase_t = (t * beats + phase) % 1.0
    for label in WING_DEF:
        s = 1 if label.endswith('L') else -1
        front = label.startswith('F')
        lag = 0 if front else .06
        ph = (phase_t - lag) % 1.0
        beat = curve(ph, [(0, -1), (.42, 1), (.55, 1), (1, -1)])
        rot(f'wing.{label}', 0, s * beat * spread * lift, -beat * .18 * lift)

def legs_dangle(t, sway=1.0):
    for row, _, lean, _ in LEG_ROWS:
        for s in (-1, 1):
            side = 'L' if s > 0 else 'R'
            w = math.sin(t * math.tau + s * .6 + lean * 4)
            rot(f'leg_{row}.{side}', .05 * w * sway, 0, s * .03 * w * sway)
            rot(f'leg_{row}_knee.{side}', -.10 * abs(w) * sway - .06)

def idle(t):
    bob = math.sin(t * math.tau)
    rig.pose.bones['root'].location.z = .022 * bob
    rot('body', .02 * bob, 0, .012 * math.sin(t * math.tau * 2))
    rot('head', -.03 * bob, .05 * math.sin(t * math.tau * .5), 0)
    rot('abdomen', -.03 * bob, 0, 0)
    flutter(t, 6, lift=1.0)
    legs_dangle(t, 1.0)

def walk(t):
    # Flying forward: nose pitched down, legs trailing, wings beating hard.
    rig.pose.bones['root'].location.z = .012 * math.sin(t * math.tau * 2)
    rig.pose.bones['root'].location.y = -.01
    rot('body', .30, 0, .02 * math.sin(t * math.tau * 2))
    rot('head', .06, 0, 0)
    rot('abdomen', -.10 - .03 * math.sin(t * math.tau * 2), 0, 0)
    flutter(t, 7, lift=1.15, spread=.62)
    for row, _, lean, _ in LEG_ROWS:
        for s in (-1, 1):
            side = 'L' if s > 0 else 'R'
            rot(f'leg_{row}.{side}', -.55, 0, s * .04)
            rot(f'leg_{row}_knee.{side}', -.35)

def attack(t):
    # Lunge forward and stab with the proboscis (thrust reads through the head/body).
    lunge = curve(t, [(0, 0), (.22, -.12), (.5, 1), (.68, .55), (1, 0)])
    rig.pose.bones['body'].location.y = -.09 * lunge
    rot('body', .18 + .16 * lunge, 0, 0)
    rot('head', .10 * lunge, 0, 0)
    rig.pose.bones['head'].location.y = -.05 * max(0, lunge)
    rot('abdomen', -.12 - .10 * lunge, 0, 0)
    flutter(t, 3, lift=1.3 + .6 * lunge, spread=.7)
    legs_dangle(t, .4)

def hit(t):
    w = curve(t, [(0, 0), (.16, 1), (.4, .55), (.75, -.1), (1, 0)])
    rig.pose.bones['root'].location.y = .10 * w
    rot('body', -.22 * w, 0, .18 * w)
    rot('head', -.14 * w, 0, -.12 * w)
    rot('abdomen', .16 * w, 0, -.10 * w)
    flutter(t, 5, lift=.6 + .5 * w, spread=.5)
    legs_dangle(t, .3)

def death(t):
    # Wings stop, the body drops from hover height to the ground, legs curl inward.
    k = curve(t, [(0, 0), (.22, .05), (.62, 1), (.78, .96), (1, 1)])
    rig.pose.bones['body'].location.z = -.85 * k
    rig.pose.bones['body'].location.y = .10 * k
    rot('body', -.9 * k, 0, .22 * k)
    rot('head', .25 * k, 0, -.15 * k)
    rot('abdomen', .30 * k, 0, .10 * k)
    # Wings freeze early and hold a slack, folded-in angle for the rest of the clip.
    for label in WING_DEF:
        s = 1 if label.endswith('L') else -1
        rot(f'wing.{label}', 0, s * .3 * (1 - k) * .2, 0)
    for row, _, lean, _ in LEG_ROWS:
        for s in (-1, 1):
            side = 'L' if s > 0 else 'R'
            rot(f'leg_{row}.{side}', .9 * k, 0, -s * .35 * k)
            rot(f'leg_{row}_knee.{side}', -1.1 * k)

pose('Idle', 31, idle); pose('Walk', 25, walk); pose('Attack', 19, attack)
pose('Hit', 16, hit); pose('Death', 37, death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = 'Dungeon Keeper giant fly: hairy olive-brown hide, red compound eyes, veined translucent wings, hovering.'
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = 'Root at ground plane; body hovers above it. Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'fly.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'fly.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials), 'height': round(max(v.co.z for v in character.data.vertices) - min(v.co.z for v in character.data.vertices), 3),
        'animations': ['Idle', 'Walk', 'Attack', 'Hit', 'Death']}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, .8))
area('Warm key', (-2.5, -3.5, 4.2), 165, (1, .76, .50), 2.5)
area('Soft fill', (2, -2, 2), 55, (.65, .80, 1), 2.5)
area('Cool rim', (-1, 2, 2.8), 300, (.36, .73, 1), 2)
bpy.ops.object.camera_add(location=(2.05, -5.4, 1.35)); cam = bpy.context.object
aim(cam, (-.02, .1, .78)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.2; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
# Limit render threads: several creature scripts build concurrently.
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = 31
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'fly.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'fly-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing makes the eyes, bristles and wing veins easy to inspect.
cam.location = (1.55, -5.0, 1.15); aim(cam, (0, -.20, .90)); cam.data.ortho_scale = 1.1
scene.render.filepath = str(PREVIEW / 'fly-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the hover posture, wing sweep and dangling legs.
cam.location = (5.6, -.2, 1.0); aim(cam, (0, -.02, .82)); cam.data.ortho_scale = 2.2
scene.render.filepath = str(PREVIEW / 'fly-side.png')
bpy.ops.render.render(write_still=True)
print('FLY_BUILD_COMPLETE', triangles, 'triangles')
