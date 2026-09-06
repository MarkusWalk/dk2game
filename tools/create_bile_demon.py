"""Rebuild the Dungeon Keeper 2 Bile Demon with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_bile_demon.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the DK2 Bile Demon. A colossal, grotesquely obese demon that is
almost as wide as it is tall (1.75 x ~1.6 before the game's 1.1 scale). Sallow
olive-khaki hide, greenish-grey along the back, a paler sagging belly, warty and
folded with stretch creases around the gut. The skull sinks straight into the
shoulders with no neck: stubby curved horns, tiny deep-set glowing red coals for
eyes, a lipless grin from ear to ear full of blunt uneven teeth and two upward
tusks, flabby jowls and a squashed pig snout. Short thick arms end in
three-fingered hands cuffed in riveted dark-iron shackles; stubby bowed legs
carry big flat three-toed feet. The gut is strapped in three riveted iron belly
bands under a broad spiked iron collar. Everything is sculpted from overlapping
primitives that are voxel-remeshed into smooth continuous forms.
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
random.seed(7)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
# Several creatures build concurrently; never take the whole machine.
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

# The game's procedural fallback paints the bile demon in #8b7650 hide over a
# #b7a46d belly with #3f4b59 iron; these are those swatches in linear space.
hide = material('Hide | sallow olive-khaki', (.128, .134, .054), 0, .70)
iron = material('Iron | belly bands', (.050, .066, .090), .78, .42)
rivet = material('Rivets | scuffed steel', (.105, .115, .125), .85, .34)
horn = material('Horn | dull ochre', (.28, .225, .120), 0, .48)
tooth = material('Teeth | stained ivory', (.46, .395, .265), 0, .52)
claw = material('Claws | dark horn', (.055, .048, .038), 0, .44)
dark = material('Maw | throat', (.020, .008, .006), 0, .72)
# Tiny pupil-less coals sunk under the brow, as in the original game.
ember = material('Eyes | red coal', (.95, .10, .045), 0, .20, 5.0, (1, .17, .06))
hot = material('Eyes | white-hot core', (1, .62, .42), 0, .20, 9.0, (1, .55, .32))


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


def hide_shader(mat, base, shadow, highlight, back, pale):
    """Sallow warty hide. Coordinates are final game units (soles at 0, horns near 1.75)
    so the gradients can key off anatomy: greenish-grey creeps up the spine while the
    stretched underside of the gut goes pale and shiny."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 4.2
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .60
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .32; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .70; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    # Back and shoulders: greenish-grey.
    spine = nodes.new('ShaderNodeMapRange')
    spine.inputs['From Min'].default_value = -.02; spine.inputs['From Max'].default_value = .28
    spine.inputs['To Min'].default_value = 0; spine.inputs['To Max'].default_value = .88
    links.new(sep.outputs['Y'], spine.inputs['Value'])
    back_mix = nodes.new('ShaderNodeMix'); back_mix.data_type = 'RGBA'; back_mix.blend_type = 'MIX'
    back_mix.inputs[7].default_value = (*back, 1)
    links.new(spine.outputs[0], back_mix.inputs[0]); links.new(ramp.outputs['Color'], back_mix.inputs[6])
    # Sagging belly: front facing and low on the torso.
    front = nodes.new('ShaderNodeMapRange')
    front.inputs['From Min'].default_value = -.10; front.inputs['From Max'].default_value = -.40
    links.new(sep.outputs['Y'], front.inputs['Value'])
    band = nodes.new('ShaderNodeMapRange')
    band.inputs['From Min'].default_value = 1.24; band.inputs['From Max'].default_value = .60
    links.new(sep.outputs['Z'], band.inputs['Value'])
    mul = nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    links.new(front.outputs[0], mul.inputs[0]); links.new(band.outputs[0], mul.inputs[1])
    gain = nodes.new('ShaderNodeMath'); gain.operation = 'MULTIPLY'; gain.inputs[1].default_value = .85
    links.new(mul.outputs[0], gain.inputs[0])
    belly_mix = nodes.new('ShaderNodeMix'); belly_mix.data_type = 'RGBA'; belly_mix.blend_type = 'MIX'
    belly_mix.inputs[7].default_value = (*pale, 1)
    links.new(gain.outputs[0], belly_mix.inputs[0]); links.new(back_mix.outputs[2], belly_mix.inputs[6])
    links.new(belly_mix.outputs[2], p.inputs['Base Color'])
    # Bump: leathery cell cracks, a coarse warty pebbling and fine pores.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 22
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    # Wide, shallow hide cells: sharper values than this render as cracked porcelain.
    cracks = nodes.new('ShaderNodeMapRange'); cracks.inputs['From Max'].default_value = .020
    links.new(vor.outputs['Distance'], cracks.inputs['Value'])
    warts = nodes.new('ShaderNodeTexVoronoi'); warts.inputs['Scale'].default_value = 62
    links.new(tex.outputs['Object'], warts.inputs['Vector'])
    lumps = nodes.new('ShaderNodeMapRange'); lumps.inputs['From Max'].default_value = .011
    lumps.inputs['To Min'].default_value = 1; lumps.inputs['To Max'].default_value = 0
    links.new(warts.outputs['Distance'], lumps.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 140
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .32
    links.new(cracks.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = .34
    links.new(lumps.outputs[0], m2.inputs[0]); links.new(m1.outputs[0], m2.inputs[2])
    m3 = nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY_ADD'; m3.inputs[1].default_value = .13
    links.new(pores.outputs['Fac'], m3.inputs[0]); links.new(m2.outputs[0], m3.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .30
    bmp.inputs['Distance'].default_value = .007
    links.new(m3.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .56
    rough.inputs['To Max'].default_value = .82
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

hide_shader(hide, (.128, .134, .054), (.070, .074, .030), (.200, .200, .090),
            (.074, .094, .066), (.262, .240, .114))
surface_detail(iron, 42, .0016, .28)
surface_detail(rivet, 55, .0008, .22)
surface_detail(horn, 16, .0026, .30, (4, 4, .5))
surface_detail(tooth, 22, .0010, .20)
surface_detail(claw, 16, .0012, .24, (3, 3, .5))

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
    smooth(o); return own(o, mat or hide, bone)

def limb(name, a, b, r, bone, mat=None, bulge=1.08, ry=None):
    """An ellipsoid aligned to a joint-to-joint segment."""
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(a + b) / 2)
    o = bpy.context.object; o.name = name; o.scale = (r, ry or r, d.length / 2 * bulge)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or hide, bone)

def block(name, pos, size, mat, bone, bevel=.03, rot=(0, 0, 0)):
    """A bevelled block for forged pieces; never left as a raw box."""
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
    o.data.materials.clear(); o.data.materials.append(mat or hide)
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
    """A strap that hugs the sculpt: subdivided, shrink-wrapped, then given thickness."""
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
    tube(name, pts, radius, mat or rivet, bone, cyclic=True, res=3)
    rod(name + ' prong', loc + right * (w / 2) - n * .006, loc - right * (w * .12) - n * .006, radius * .75, radius * .5, mat or rivet, bone, 8)

def radial(angle, cy, cz, *targets, rmax=1.95):
    """Seat one ring point on the real silhouette: fire a ray outward from the
    body axis at every sculpt and keep the farthest skin it pierces.
    Analytic ellipse rings do not survive `closest_point_on_mesh`; a control
    point that ends up INSIDE the sculpt projects to whatever surface happens to
    be nearest, which is why three passes scattered the collar rivets across the
    chest and buried the collar strap inside the shoulders."""
    d = Vector((math.cos(angle), math.sin(angle), 0))
    origin = Vector((0, cy, cz)); best = None; far = -1
    for target in targets:
        ok, loc, n, _ = target.ray_cast(origin, d, distance=rmax)
        if not ok: continue
        r = (loc - origin).dot(d)
        if r > far:
            far = r; n = n.normalized()
            best = (loc, n if n.dot(d) > 0 else -n)
    return best or (origin + d * rmax * .8, d)

def iron_ring(name, cy, cz, width, thickness, bone, targets, rivets, rivet_size, spikes=0,
              spike_len=.24, spike_rise=.17, rmax=1.95, steps=52, gap=.012):
    """A conformed iron band plus its rivets and spikes, all seated off the same
    radial sweep so the studs land ON the strap instead of wandering."""
    path = [radial(math.tau * i / steps, cy, cz, *targets, rmax=rmax)[0] for i in range(steps)]
    # Solidify walks the STRAP's own normals, not the body's, so a strap crossing a
    # ridge dips its inner shell below the hide and sprays black slivers over it.
    # The gap is the clearance that buys back: 0.012 is enough on the barrel of the
    # gut, the collar needs more where it rides over the shoulder rolls.
    ribbon(name, [tuple(p) for p in path], width, iron, bone, targets[0], gap, thickness, cyclic=True)
    stand = gap + thickness
    for i in range(rivets):
        loc, _ = radial(math.tau * (i + .5) / rivets, cy, cz, *targets, rmax=rmax)
        patch(name + ' rivet', tuple(loc), rivet_size, rivet, bone, targets[0], stand)
    for i in range(spikes):
        loc, n = radial(math.tau * (i + .5) / spikes, cy, cz, *targets, rmax=rmax)
        base = loc + n * stand * .6
        rod(name + ' spike', base, base + n * spike_len + Vector((0, 0, spike_rise)), .072, .012, iron, bone, 8)

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
# The gut is deep rather than broad and the arms hang well clear of it; anything
# tighter and the voxel weld fuses the forearm straight into the belly.
joints = {}
for s, L in ((-1, 'R'), (1, 'L')):
    joints[L] = dict(shoulder=(s * 1.32, -.06, 2.72), elbow=(s * 1.82, -.28, 2.12),
                     wrist=(s * 1.86, -.76, 1.66), hand=(s * 1.84, -.96, 1.42),
                     hip=(s * .72, -.06, 1.54), knee=(s * 1.00, -.30, .94),
                     ankle=(s * .94, .02, .34), foot=(s * .94, -.66, .10))

# ---------------------------------------------------------------- body sculpt
# The gut is three stacked lobes of different radii: the voxel weld leaves natural
# fat-roll grooves between them, which is where the iron bands later bite in.
# The chest shelf above is deliberately NARROWER than the gut - the belly only
# reads as colossal by contrast, never by piling on more mass.
body_parts = []
def B(o): body_parts.append(o); return o
# The gut is pushed forward and the back flattened: in profile the belly has to
# overhang the toes while the spine stays a shallow curve. Pass 7 had a rump as
# deep as the gut and read as a hunchback from the side.
B(ell('Gut apron', (0, -.66, 1.48), (1.14, 1.24, .50), bone='belly'))
B(ell('Great gut', (0, -.76, 1.92), (1.28, 1.52, .58), bone='belly'))
B(ell('Upper gut', (0, -.64, 2.38), (1.14, 1.30, .50), bone='belly'))
B(ell('Chest shelf', (0, -.32, 2.70), (.98, .92, .46), bone='chest'))
B(ell('Pelvis', (0, -.02, 1.46), (.90, .70, .52), bone='hips'))
B(ell('Rump', (0, .38, 1.66), (.92, .58, .66), bone='hips'))
B(ell('Back slab', (0, .24, 2.32), (.98, .56, .76), bone='chest'))
# No neck at all: the skull drops into a stack of fat rolls between the shoulders.
# The rolls stop below z 3.14 so the collar up on the jowl line stays visible.
B(ell('Neck roll', (0, -.16, 2.84), (.90, .80, .26), bone='chest'))
B(ell('Nape roll', (0, .02, 2.98), (.62, .56, .16), bone='chest'))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    B(ell('Gut flank', (s * .78, -.44, 1.98), (.50, 1.14, .68), bone='belly'))
    B(ell('Love handle', (s * .82, .10, 1.68), (.46, .60, .46), bone='hips'))
    B(ell('Buttock', (s * .50, .50, 1.48), (.46, .40, .44), bone='hips'))
    # Shoulder caps stop below z 2.92 - any taller and they weld to the chest at
    # collar height, and the ring sweep escapes onto the upper arms.
    B(ell('Shoulder mass', (s * 1.30, -.06, 2.42), (.64, .60, .44), bone=f'upper_arm.{L}'))
    B(ell('Trapezius roll', (s * .52, .06, 2.72), (.48, .50, .28), bone='chest'))
    B(limb('Upper arm', j['shoulder'], j['elbow'], .40, f'upper_arm.{L}', ry=.42))
    B(ell('Elbow', j['elbow'], (.38, .40, .38), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .33, f'forearm.{L}', ry=.35))
    # Flesh bunches above the shackles the way it does above the belly bands.
    B(ell('Wrist fat roll', (s * 1.86, -.68, 1.81), (.37, .37, .17), bone=f'forearm.{L}'))
    B(limb('Thigh', j['hip'], j['knee'], .48, f'thigh.{L}', ry=.50))
    B(ell('Knee', j['knee'], (.38, .40, .36), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .36, f'shin.{L}', ry=.38))
    B(ell('Ankle', j['ankle'], (.30, .30, .28), bone=f'shin.{L}'))
    B(ell('Broad flat foot', (s * .94, -.28, .19), (.54, .78, .20), bone=f'foot.{L}'))
    B(ell('Heel', (s * .94, .30, .18), (.38, .30, .18), bone=f'foot.{L}'))
    for i in range(3):
        x = s * .94 + (i - 1) * .37
        B(ell('Splayed toe', (x, -.96, .14), (.21, .35, .14), bone=f'foot.{L}'))
samples = []
for o in body_parts:
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone']))
tree = KDTree(len(samples))
for i, (co, bone) in enumerate(samples): tree.insert(co, i)
tree.balance()
torso = union('Bile demon bulk', body_parts, .050, 1.0, smoothing=1, bone='hips')

# Second pass: creases, fat folds and warts are seated on the first sculpt so the
# remesh welds them into the hide instead of leaving beads glued on top.
refine = [torso]
for cz, half, sag, r in ((1.16, .98, .10, .052), (2.58, .90, -.06, .048)):
    span = [(-half + 2 * half * i / 10) for i in range(11)]
    fold = conformed([(x, -3.4, cz + sag * (x / half) ** 2) for x in span], torso, .004)
    refine.append(tube('Fat fold', fold, r, hide, 'belly', lambda t: .35 + .65 * math.sin(math.pi * t) ** .5))
# Stretch creases radiate off the flanks of the over-inflated gut.
for s in (-1, 1):
    for k in range(4):
        cz = 1.42 + k * .30
        arc = conformed([(s * (.30 + .28 * i), -3.4, cz + .09 * i) for i in range(4)], torso, .003)
        refine.append(tube('Stretch crease', arc, .040, hide, 'belly', lambda t: math.sin(math.pi * t) ** .6))
warts = 0
for _ in range(150):
    a = random.uniform(0, math.tau); c = random.uniform(-1, 1)
    d = Vector((math.sqrt(1 - c * c) * math.cos(a), math.sqrt(1 - c * c) * math.sin(a), c))
    loc, n = surface_point(torso, Vector((0, .05, 2.05)) + d * 5.0, 0)
    if loc.z < .50: continue                        # never on the soles
    if random.random() > (.90 if n.y > .05 else .40): continue   # crusted back, smoother belly
    r = random.uniform(.055, .100)
    refine.append(patch('Wart', loc, (r, r * .58, r * .84), hide, 'chest', torso, -r * .14))
    warts += 1
body = union('Continuous body sculpt', refine, .038, .38, smoothing=2, bone='hips')
body['weighted_body'] = True
print(f'BODY sculpted with {warts} warts', flush=True)
for s, L in ((-1, 'R'), (1, 'L')):
    for i in range(3):
        x = s * .94 + (i - 1) * .37
        tube('Horn toe claw', [(x, -1.16, .15), (x, -1.30, .14), (x, -1.43, .10), (x, -1.50, .06)],
             .085, claw, f'foot.{L}', lambda t: (1 - t) ** .8 + .05)

# ---------------------------------------------------------------- head sculpt
# Stacking wide flat shelves to fake a muzzle just produces a stack of pancakes
# once the remesh runs - two passes proved it. So the skull follows the imp's
# proven face layout at 1.55x, which reads because it is mostly ROUND: one big
# cranium, a rounded muzzle that juts forward and down off it, thin rotated
# ellipsoids for brow and lids, and a grin cut wide across the bottom. The bile
# demon changes are the hanging jowls, the upturned pig snout, the tusks and
# the tiny red coals in place of the imp's big amber lamps.
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, -.37, 3.93), (.775, .68, .73), bone='head'))
H(ell('Skull crown', (0, -.19, 4.40), (.465, .50, .23), bone='head'))
H(ell('Sloped forehead', (0, -.54, 4.31), (.50, .31, .28), bone='head'))
H(ell('Occiput', (0, .06, 3.84), (.59, .465, .53), bone='head'))
H(ell('Skull base', (0, -.30, 3.30), (.58, .46, .30), bone='head'))
H(ell('Jaw', (0, -.53, 3.41), (.62, .56, .36), bone='head'))
H(ell('Muzzle', (0, -1.01, 3.47), (.56, .37, .23), bone='head'))
H(ell('Chin', (0, -1.01, 3.22), (.26, .23, .17), bone='head'))
H(ell('Nose bridge', (0, -1.15, 3.81), (.155, .17, .20), bone='head'))
# Squashed pig snout: short, broad and turned up, the nostrils facing forward.
H(ell('Broad pig snout', (0, -1.42, 3.62), (.36, .23, .17), bone='head'))
H(ell('Snout tip', (0, -1.54, 3.58), (.25, .13, .13), bone='head'))
H(ell('Glabella knot', (0, -1.05, 3.93), (.14, .12, .14), bone='head'))
for s in (-1, 1):
    H(ell('Temple', (s * .53, -.34, 4.06), (.295, .39, .36), bone='head'))
    H(ell('Cheekbone', (s * .62, -.65, 3.62), (.28, .31, .25), bone='head'))
    H(ell('Grin fold', (s * .60, -.78, 3.50), (.17, .17, .23), bone='head'))
    H(ell('Nostril wing', (s * .23, -1.19, 3.56), (.17, .155, .13), bone='head'))
    # Jowls hang off the jaw and spill toward the collar - the bile demon's own
    # addition to the imp skull, and what makes it read as a glutton.
    H(ell('Flabby jowl', (s * .62, -.62, 3.30), (.34, .40, .28), bone='head'))
    H(ell('Lower jowl', (s * .50, -.50, 3.14), (.32, .36, .22), bone='head'))
    # Lids only. The brow used to be an ellipsoid parked in front of the skull,
    # and because the cranium falls away fast to the sides its outer end stuck
    # out past the cheek like a whisker; it is a conformed ridge now (below).
    H(ell('Angry upper lid', (s * .32, -.90, 3.90), (.23, .13, .085), bone='head', rot=(0, -s * .34, 0)))
    H(ell('Lower lid', (s * .34, -.90, 3.57), (.22, .12, .075), bone='head', rot=(0, -s * .14, 0)))
head_obj = union('Head sculpt pass 1', head_parts, .028, 1.0, smoothing=1, bone='head')

# A lipless grin from ear to ear, rising hard at the corners and gaping wider
# than the imp's: a bile demon is all mouth.
GRIN_HALF = .76
def grin(x):
    return 3.39 + .32 * (x / GRIN_HALF) ** 2
def gape(x):
    return .26 * math.sqrt(max(0, 1 - (x / GRIN_HALF) ** 2))
grin_x = [-GRIN_HALF + 2 * GRIN_HALF * i / 14 for i in range(15)]
refine = [head_obj]
# Thin gum ridges rather than fat lips - a bile demon's mouth is a lipless gash.
upper = conformed([(x, -1.30, grin(x)) for x in grin_x], head_obj, .020)
lower = conformed([(x, -1.30, grin(x) - gape(x)) for x in grin_x], head_obj, .024)
refine.append(tube('Upper gum ridge', upper, .034, hide, 'head', lambda t: .6 + .4 * math.sin(math.pi * t)))
refine.append(tube('Lower gum ridge', lower, .046, hide, 'head', lambda t: .6 + .4 * math.sin(math.pi * t)))
for cz in (4.36, 4.48):
    fold = conformed([(x, -1.20, cz + .03 * math.cos(x * 4)) for x in (-.36, -.18, 0, .18, .36)], head_obj, -.006)
    refine.append(tube('Brow crease', fold, .024, hide, 'head', lambda t: math.sin(math.pi * t) ** .6))
# The scowl: a heavy ridge conformed to the skull so it protrudes by a constant
# amount all the way round, dropping toward the nose at the inner end.
for s in (-1, 1):
    ridge = conformed([(s * .05, -1.60, 3.88), (s * .24, -1.55, 3.95), (s * .42, -1.48, 4.02),
                       (s * .58, -1.30, 4.04)], head_obj, .036)
    refine.append(tube('Heavy brow ridge', ridge, .090, hide, 'head',
                       lambda t: .50 + .50 * math.sin(math.pi * min(1, t * 1.15)) ** .45))
for s in (-1, 1):
    # The fold that separates the hanging jowl from the cheek.
    crease = conformed([(s * .46, -.96, 3.86), (s * .60, -.86, 3.60), (s * .64, -.70, 3.34), (s * .52, -.44, 3.14)], head_obj, .002)
    refine.append(tube('Jowl fold', crease, .034, hide, 'head', lambda t: math.sin(math.pi * t) ** .6))
head_obj = union('Head sculpt', refine, .026, .40, smoothing=1, bone='head')

# Face features seated on the final sculpt.
strip_up = conformed([(x, -1.30, grin(x) - .014) for x in grin_x], head_obj, .006)
strip_low = conformed([(x, -1.30, grin(x) - gape(x) + .014) for x in grin_x], head_obj, .006)
N = len(grin_x)
maw = mesh('Maw', strip_up + strip_low, [(i, i + 1, N + i + 1, N + i) for i in range(N - 1)], dark, 'head')
smooth(maw)

def blunt_tooth(name, x, z, length, width, down=True):
    """Blunt uneven pegs, not needles: radius2 stays wide so they read as molars."""
    root, n = surface_point(head_obj, (x, -1.34, z), .014)
    tip = root + Vector((0, -.008, -length if down else length))
    rod(name, root + Vector((0, 0, .014 if down else -.014)), tip, width, width * .58, tooth, 'head', 8)
for i, x in enumerate([-.60, -.50, -.40, -.30, -.20, -.10, 0, .10, .20, .30, .40, .50, .60]):
    blunt_tooth('Uneven tooth', x, grin(x) - .020, .076 + .028 * ((i * 5) % 3), .042 + .009 * (i % 2))
for x in (-.50, -.33, -.17, 0, .17, .33, .50):
    blunt_tooth('Lower tooth', x, grin(x) - gape(x) + .020, .058, .038, down=False)
# Two upward tusks push out of the lower jaw and past the muzzle.
for s in (-1, 1):
    x = s * .42
    root, n = surface_point(head_obj, (x, -1.34, grin(x) - gape(x) + .03), .014)
    tube('Upward tusk', [tuple(root), tuple(root + Vector((s * .04, -.09, .18))),
                         tuple(root + Vector((s * .11, -.14, .35))), tuple(root + Vector((s * .18, -.11, .47)))],
         .090, tooth, 'head', lambda t: (1 - t) ** .55 + .06)
for s in (-1, 1):
    patch('Nostril', (s * .14, -1.80, 3.52), (.058, .020, .042), dark, 'head', head_obj, .003)
patch('Navel', (0, -3.4, 1.86), (.090, .030, .075), dark, 'hips', body, .002)

# Two small stubby horns curling up and back off the skull crown.
for s in (-1, 1):
    base = Vector((s * .38, -.18, 4.50))
    tube('Stubby horn', [tuple(base), tuple(base + Vector((s * .10, .07, .20))),
                         tuple(base + Vector((s * .16, .21, .33))), tuple(base + Vector((s * .15, .34, .40)))],
         .150, horn, 'head', lambda t: (1 - t) ** .62 + .05)

# Tiny deep-set coals sunk in a black pit: the pit is what makes them read at
# game scale, since a brow shadow alone is at the mercy of the scene lighting.
EYE = {1: (.33, -.93, 3.76), -1: (-.33, -.93, 3.76)}
for s in (-1, 1):
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ex, ey, ez = EYE[s]
    # A dark ball concentric with the coal. Pass 7 had the rim's front surface
    # sitting AHEAD of the coal, so the eyes read as two black pits with no glow
    # at all; the coal now stands .05 proud of the socket it sits in.
    ell('Eye socket rim', (ex, ey + .088, ez), (.168, .150, .158), dark, 'head', 3)
    ell('Coal eye', (ex, ey - .012, ez), (.104, .104, .098), ember, eye_bone, 3)
    ell('Eye core', (ex, ey - .078, ez + .004), (.046, .022, .040), hot, eye_bone, 2)
print('HEAD sculpted', flush=True)

# ---------------------------------------------------------------- three-fingered hands
# Two heavy fingers plus one opposed thumb: three blunt digits with horn claws,
# hanging half-curled the way a creature this heavy carries its arms.
def hand(s):
    L = 'L' if s > 0 else 'R'; bone = f'hand.{L}'; pieces = []; claws = []
    w = Vector(joints[L]['wrist'])
    pieces.append(ell('Wrist', tuple(w), (.30, .30, .26), bone=bone))
    pieces.append(ell('Heavy palm', (s * 1.84, -.94, 1.44), (.31, .30, .32), bone=bone))
    pieces.append(ell('Knuckle pad', (s * 1.84, -1.06, 1.30), (.31, .25, .20), bone=bone))
    for k in (0, 1):
        X = s * (1.84 + (k - .5) * .32)
        path = [(X, -1.08, 1.28), (X, -1.14, 1.16), (X - s * .02, -1.10, 1.06), (X - s * .03, -1.02, 1.02)]
        pieces.append(tube('Blunt finger', path, .128, hide, bone))
        pieces.append(ell('Knuckle', path[0], (.135, .135, .125), bone=bone, sub=2))
        pieces.append(ell('Fingertip', path[-1], (.115, .115, .115), bone=bone, sub=2))
        claws.append([(X - s * .03, -1.02, 1.02), (X - s * .04, -1.00, .96), (X - s * .04, -1.05, .90)])
    thumb = [(s * 1.68, -.92, 1.42), (s * 1.54, -1.04, 1.34), (s * 1.50, -1.12, 1.24)]
    pieces.append(tube('Thumb', thumb, .130, hide, bone))
    pieces.append(ell('Thumb tip', thumb[-1], (.120, .120, .120), bone=bone, sub=2))
    claws.append([(s * 1.50, -1.12, 1.24), (s * 1.48, -1.14, 1.17), (s * 1.51, -1.09, 1.11)])
    union(f'Hand sculpt {L}', pieces, .020, .32, bone=bone)
    for path in claws:
        tube('Blunt claw', path, .056, claw, bone, lambda t: (1 - t) ** .7 + .05)
hand(1); hand(-1)

# ---------------------------------------------------------------- iron kit
# Three riveted belly bands sunk into the grooves between the gut lobes, a broad
# spiked collar sitting where a neck should be, and shackle cuffs on both wrists.
# Pass 1 wrapped each band in thin piping tubes; conformed only at their control
# points they cut across the belly like bent wire. Thick single straps read far
# better, so the bands carry their weight through solidify depth alone.
# The bands stay below z 1.98: above that the shoulder caps are welded to the
# gut, so a ring sweep escapes onto the shoulders and crosses the upper arms.
BANDS = ((1.30, -.64, .30), (1.62, -.72, .34), (1.94, -.72, .30))
for k, (cz, cy, w) in enumerate(BANDS):
    iron_ring(f'Iron belly band {k + 1}', cy, cz, w, .085, 'belly', (body,), 16, (.052, .032, .052))
buckle('Gut buckle', (0, -3.4, 1.62), .44, .38, 'belly', body, .110, right=(1, 0, 0), radius=.038)

# Seated at z 2.88 the collar clears the chin and the lower teeth: at 3.18 it
# crossed the jaw and read as a muzzle strap with the lower jowls swallowed.
iron_ring('Broad iron collar', -.30, 2.88, .32, .080, 'chest', (body,), 18, (.048, .030, .048),
          spikes=12, spike_len=.26, spike_rise=.19, rmax=1.30, gap=.034)

for s, L in ((-1, 'R'), (1, 'L')):
    A, Bv = Vector(joints[L]['elbow']), Vector(joints[L]['wrist'])
    axis = (Bv - A).normalized(); center = Bv - axis * .04
    e1 = axis.cross(Vector((0, 0, 1))).normalized(); e2 = axis.cross(e1).normalized()
    def cuff_ring(offset, r, steps=22, c=center, ax=axis, u=e1, v=e2):
        return [c + ax * offset + u * (r * math.cos(math.tau * i / steps)) + v * (r * math.sin(math.tau * i / steps)) for i in range(steps)]
    ribbon('Iron shackle', cuff_ring(0, .34), .30, iron, f'forearm.{L}', body, .012, .075, cyclic=True)
    for k in range(8):
        a = math.tau * (k + .5) / 8
        patch('Shackle rivet', center + e1 * (.34 * math.cos(a)) + e2 * (.34 * math.sin(a)),
              (.046, .028, .046), rivet, f'forearm.{L}', body, .086)
print('IRON kit seated', flush=True)

# ---------------------------------------------------------------- bones (pre-scale)
# 'belly' is the gut's own bone: Idle and Walk scale it so the mass heaves and
# sloshes independently of the ribcage, which is what sells the waddle.
bones = {
    'root': ((0, 0, 0), (0, 0, .30), None),
    'hips': ((0, .02, 1.34), (0, -.06, 1.80), 'root'),
    'belly': ((0, -.12, 1.74), (0, -.90, 2.06), 'hips'),
    'chest': ((0, .00, 1.88), (0, -.10, 2.92), 'hips'),
    'head': ((0, -.22, 3.16), (0, -.34, 4.12), 'chest'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, 0, .2))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, 0, .2))), 'head'),
}
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    bones[f'upper_arm.{L}'] = (j['shoulder'], j['elbow'], 'chest')
    bones[f'forearm.{L}'] = (j['elbow'], j['wrist'], f'upper_arm.{L}')
    bones[f'hand.{L}'] = (j['wrist'], j['hand'], f'forearm.{L}')
    bones[f'thigh.{L}'] = (j['hip'], j['knee'], 'hips')
    bones[f'shin.{L}'] = (j['knee'], j['ankle'], f'thigh.{L}')
    bones[f'foot.{L}'] = (j['ankle'], j['foot'], f'shin.{L}')

# Blend body weights across neighbouring anatomy so joints deform smoothly. The
# falloff is wider than the imp's because every limb here is twice as thick.
for name in bones: body.vertex_groups.new(name=name)
for vertex in body.data.vertices:
    nearby = tree.find_n(vertex.co, 20)
    closest = {}
    for _, idx, distance in nearby:
        name = samples[idx][1]
        closest[name] = min(distance, closest.get(name, 100))
    nearest = min(closest.values())
    weights = {name: math.exp(-((d - nearest) / .090) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
# The skull was sculpted generously for control; settle it into DK2 proportions
# (a small head lost between the shoulders) by scaling head islands and bones
# about a single pivot rather than editing dozens of coordinates.
HEAD_SCALE = 1.0; HEAD_PIVOT = Vector((0, -.30, 3.40))
def settle(co): return HEAD_PIVOT + (Vector(co) - HEAD_PIVOT) * HEAD_SCALE
head_bones = {'head', 'eye.L', 'eye.R'}
SCALE = .3535
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
    for count, name in budget[:16]: print(f'TRIANGLES {count:7d} {name}')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'BileDemon_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices: v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
xs = [v.co.x for v in character.data.vertices]; zs = [v.co.z for v in character.data.vertices]
print(f'DIMENSIONS height {max(zs) - min(zs):.3f}  width {max(xs) - min(xs):.3f}  floor {min(zs):+.4f}', flush=True)
if not FAST:
    # Bake the procedural hide, iron and horn into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(ember, hot), prefix='bile-demon')

rig_data = bpy.data.armatures.new('BileDemon_Skeleton')
rig = bpy.data.objects.new('BileDemon_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = Vector(a) * SCALE; eb.tail = Vector(b) * SCALE
    if parent: eb.parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Bile demon skeleton', 'ARMATURE'); mod.object = rig
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

def gut(sx, sy, sz):
    """Scale the belly bone about its root; the KD-blended weights make the whole
    gut swell and slosh while the ribcage and hips stay where they are."""
    rig.pose.bones['belly'].scale = (sx, sy, sz)

def close_eyes(closure):
    for name in ('eye.L', 'eye.R'):
        eye = rig.pose.bones[name]
        eye.scale.y = 1 - .94 * closure
        eye.scale.z = 1 - .90 * closure
        # Retract the glowing coal as the lid drops so no wedge sticks out in profile.
        eye.location.z = -.045 * SCALE * closure

def blink(t, centers=(.24, .70)):
    closure = max([max(0, 1 - abs(t - center) / .030) for center in centers] + [0])
    close_eyes(closure)

def idle(t):
    # Three seconds of heavy asthmatic breathing; the gut lags a beat behind the
    # ribcage, and the head turns in slow suspicious glances.
    breath = math.sin(t * math.tau)
    lag = math.sin(t * math.tau * 3)
    look = curve(t, [(0, 0), (.18, 0), (.34, .17), (.52, .17), (.70, -.14), (.86, -.14), (1, 0)])
    rot('hips', .010 * breath, .012 * math.sin(t * math.tau), 0)
    rot('chest', .022 * breath, 0, .014 * math.sin(t * math.tau))
    rot('head', -.050 * breath, .020 * math.sin(t * math.tau), look)
    rot('belly', .030 * breath, 0, 0)
    gut(1 + .028 * breath + .011 * lag, 1 + .044 * breath + .015 * lag, 1 + .024 * breath + .009 * lag)
    for label, s in (('L', 1), ('R', -1)):
        rot('upper_arm.' + label, .040 * breath, 0, s * (.030 + .022 * breath))
        rot('forearm.' + label, -.05 - .030 * breath)
        rot('hand.' + label, .10 * breath)
    rig.pose.bones['root'].location.y = .012 * breath
    blink(t, (.21, .64, .71))

def walk(t):
    # A slow lumbering waddle: the whole mass rolls onto one foot, the gut swings
    # opposite the hips, and every step lands with a bounce in the belly.
    w = math.sin(t * math.tau)
    fall = math.cos(t * math.tau * 2)
    rig.pose.bones['root'].location.y = .030 * (1 - fall)
    rot('root', .03, .115 * w, 0)
    rot('hips', 0, .085 * w, .085 * w)
    rot('belly', -.04 * fall, -.070 * w, 0)
    gut(1 + .026 * fall + .020 * w, 1 + .038 * fall, 1 - .030 * fall)
    for label, s in (('L', 1), ('R', -1)):
        stride = s * w
        rot('thigh.' + label, .34 * stride, 0, -s * .05)
        rot('shin.' + label, -max(0, stride) * .44)
        rot('foot.' + label, -.10 * stride + max(0, stride) * .20)
        # Arms are shoved out sideways by the gut, so they swing across, not along.
        rot('upper_arm.' + label, -s * .16 * w, 0, s * (.10 + .10 * w))
        rot('forearm.' + label, -.12 - max(0, -stride) * .14)
        rot('hand.' + label, .12 + .10 * stride)
    rot('chest', .05, -.055 * w, -.060 * w)
    rot('head', .035 - .020 * fall, .030 * w, .055 * w)
    blink(t, (.42,))

def attack(t):
    # The belly slam: rear back with both arms flung wide, then hurl the entire
    # gut forward and let it detonate on impact.
    swing = curve(t, [(0, 0), (.30, -.60), (.53, 1.0), (.66, .84), (.82, .12), (1, 0)])
    impact = math.exp(-((t - .56) / .050) ** 2)
    push = max(0, swing); pull = max(0, -swing)
    rot('root', .30 * push - .16 * pull, 0, 0)
    rig.pose.bones['root'].location.y = -.075 * impact - .02 * push
    rot('hips', .12 * push - .10 * pull)
    rot('chest', .22 * push - .26 * pull, 0, 0)
    rot('belly', .16 * push, 0, 0)
    rot('head', -.14 * push + .30 * pull + .12 * impact)
    gut(1 + .11 * push + .07 * impact, 1 + .19 * push + .12 * impact, 1 - .05 * push + .04 * impact)
    for label, s in (('L', 1), ('R', -1)):
        rot('upper_arm.' + label, -.75 * pull - .22 * push, 0, s * (.70 * pull + .28 * push))
        rot('forearm.' + label, -.20 - .55 * pull - .30 * push)
        rot('hand.' + label, .20 + .55 * push)
        rot('thigh.' + label, .16 * push); rot('shin.' + label, -.22 * push)
    blink(t, (.55,))

def hit(t):
    # Recoil: the bulk barely moves, but the gut sloshes for a good half second.
    w = curve(t, [(0, 0), (.16, 1), (.42, .55), (.72, -.12), (1, 0)])
    slosh = math.exp(-t * 4.5) * math.sin(t * 26)
    rot('root', -.13 * w)
    rot('hips', -.08 * w, 0, .06 * w)
    rot('chest', -.22 * w, 0, .11 * w)
    rot('head', -.20 * w, 0, -.12 * w)
    rot('belly', -.10 * w, .12 * slosh, 0)
    gut(1 + .06 * w + .05 * slosh, 1 - .07 * w + .08 * slosh, 1 + .08 * w - .05 * slosh)
    rot('upper_arm.L', -.32 * w, 0, -.26 * w); rot('upper_arm.R', -.20 * w, 0, .16 * w)
    rot('forearm.L', -.30 * w); rot('forearm.R', -.22 * w)
    blink(t, (.16,))

def death(t):
    # It topples straight onto its back and the gut keeps wobbling after it lands.
    k = curve(t, [(0, 0), (.14, .05), (.50, 1), (.63, .93), (.78, 1.02), (1, 1)])
    settled = max(0, t - .50)
    slosh = math.exp(-settled * 11) * math.sin(settled * 34)
    rot('root', -1.28 * k, 0, .07 * k)
    rig.pose.bones['root'].location.y = .46 * k
    rot('hips', .10 * k)
    rot('chest', -.12 * k, 0, .06 * k)
    rot('head', .26 * k, 0, -.10 * k)
    rot('belly', .12 * k, .18 * slosh, 0)
    gut(1 + .05 * k + .10 * slosh, 1 + .07 * k + .14 * slosh, 1 - .04 * k - .09 * slosh)
    rot('upper_arm.L', -.38 * k, 0, -.62 * k); rot('upper_arm.R', -.32 * k, 0, .56 * k)
    rot('forearm.L', -.42 * k); rot('forearm.R', -.36 * k)
    rot('thigh.L', .58 * k); rot('shin.L', -.58 * k)
    rot('thigh.R', .44 * k); rot('shin.R', -.44 * k)
    close_eyes(min(1, max(0, (t - .52) * 4)))

pose('Idle', 91, idle); pose('Walk', 34, walk); pose('Attack', 28, attack)
pose('Hit', 19, hit); pose('Death', 49, death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = 'Dungeon Keeper 2 Bile Demon: obese olive-khaki glutton in iron belly bands and a spiked collar, no neck, lipless ear-to-ear grin, tiny red coal eyes, stubby horns, three-toed feet.'
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = 'Feet at ground; ~1.75 units tall and ~1.6 wide; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'bile-demon.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    zs = [v.co.z for v in character.data.vertices]; xs = [v.co.x for v in character.data.vertices]
    (OUT / 'bile-demon.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials),
        'height': round(max(zs) - min(zs), 3), 'width': round(max(xs) - min(xs), 3),
        'animations': ['Idle', 'Walk', 'Attack', 'Hit', 'Death']}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
for o in (character,):
    # Smooth-shaded decimated hide needs the terminator pushed off the geometry
    # or the collar's own shadow lands on it as black triangles.
    if hasattr(o, 'cycles'):
        o.cycles.shadow_terminator_offset = .30
        o.cycles.shadow_terminator_geometry_offset = .30
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, .85))
area('Warm key', (-2.9, -4.0, 4.6), 300, (1, .76, .50), 2.8)
area('Soft fill', (2.4, -2.4, 2.2), 100, (.65, .80, 1), 2.8)
area('Cool rim', (-1.2, 2.4, 3.1), 480, (.36, .73, 1), 2.2)
bpy.ops.object.camera_add(location=(2.45, -6.4, 2.85)); cam = bpy.context.object
aim(cam, (-.04, 0, .86)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.25; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = 91
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'bile-demon.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'bile-demon-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing makes the grin, tusks and coal eyes easy to inspect.
cam.location = (1.35, -5.8, 2.00); aim(cam, (0, -.28, 1.36)); cam.data.ortho_scale = 1.10
scene.render.filepath = str(PREVIEW / 'bile-demon-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the forward jut of the gut, the collar and the stubby legs.
cam.location = (6.6, -.35, 1.60); aim(cam, (0, -.06, .84)); cam.data.ortho_scale = 2.25
scene.render.filepath = str(PREVIEW / 'bile-demon-side.png')
bpy.ops.render.render(write_still=True)
print('BILE_DEMON_BUILD_COMPLETE', triangles, 'triangles')
