"""Build the Dungeon Keeper 2 elven archer hero with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_archer.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
(The environment variable names are shared across every creature script so one
look-dev loop drives them all.)  The authored character faces -Y in Blender,
becoming +Z in Babylon's left-handed scene.

Design target: the DK2 Elven Archer -- a slender, poised, alert elf about 1.80
units tall.  A forest-green hooded cloak is up over a fine-featured elven face
with long pointed ears sweeping out through the hood's sides, sharp angled brows,
real lidded eyes with dark pupils, and an auburn braid over the left shoulder.
Under the cloak sits a fitted tan leather jerkin with stitched panels, a laced
chest placket and a belt with pouches; the arms wear moss-green tunic sleeves and
wide laced bracers; the legs wear dark fitted leggings inside tall laced boots.
A leather quiver of fletched arrows rides on the right shoulder blade -- the
cloak is deliberately swept off that shoulder so the two never intersect -- and
the left hand grips a proper longbow: tapered flat limbs, a wrapped grip, horn
nocks and a taut string, with an arrow nocked and pointed at the ground until
Attack raises, draws and looses it.

Everything is sculpted from overlapping primitives that are voxel-remeshed into
smooth continuous forms, or from parametric cloth shells with real folds and
edge thickness; nothing is left as a bare box or a paper-thin plane.
"""
import bpy
import math
import random
import json
import os
import sys
from pathlib import Path
from mathutils import Vector, Quaternion, Matrix
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/models'
SOURCE = ROOT / 'assets/blender'
FAST = bool(os.environ.get('IMP_FAST') or os.environ.get('ARCHER_FAST'))
PREVIEW = Path(os.environ.get('IMP_PREVIEW_DIR') or os.environ.get('ARCHER_PREVIEW_DIR') or SOURCE)
TARGET_HEIGHT = 1.80  # units before the game's 0.96 archer scale (see PIPELINE.md)
random.seed(27)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
# Several creatures bake and render concurrently; keep each Blender polite.
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

# Every colour below is LINEAR, converted from the intended sRGB swatch -- the
# first pass of this model authored sRGB values directly and rendered a pale,
# washed-out figure whose skin and jerkin were indistinguishable.  Palette from
# the procedural fallback in src/babylon/entities.js: elfSkin #bf9c87,
# cloakGreen #3b6138, jerkinTan #9c7442, legDark #2c2a26, auburn #8f4520.
skin = material('Skin | fair elf', (.430, .272, .208), 0, .46)
skin_shadow = material('Skin | shaded palm', (.360, .218, .165), 0, .50)
hair = material('Hair | auburn braid', (.165, .046, .018), 0, .62)
cloak = material('Cloak | forest green wool', (.042, .108, .040), 0, .84)
cloak_dark = material('Cloak | shadowed lining', (.018, .048, .019), 0, .86)
tunic = material('Sleeves | moss green linen', (.052, .078, .034), 0, .88)
jerkin = material('Jerkin | tan leather', (.300, .165, .058), 0, .58)
leather_dark = material('Leather | umber kit', (.070, .034, .015), 0, .66)
leather_edge = material('Leather | stitched trim', (.430, .245, .085), 0, .60)
legwear = material('Legwear | dark fitted cloth', (.026, .024, .020), 0, .84)
boot_leather = material('Boots | oiled dark leather', (.040, .021, .011), 0, .54)
steel = material('Fittings | dull steel', (.200, .215, .245), .85, .30)
brass = material('Buckles | worn brass', (.300, .160, .042), .80, .38)
wood = material('Bow and shafts | yew stave', (.145, .068, .018), 0, .52)
horn = material('Nocks | pale horn', (.200, .155, .100), 0, .38)
string_mat = material('Bowstring | waxed linen cord', (.400, .345, .215), 0, .34)
fletch = material('Fletching | grey goose', (.520, .490, .420), 0, .58)
fletch_red = material('Fletching | dyed crest', (.290, .045, .030), 0, .60)
dark = material('Shadow cavity', (.010, .008, .007), 0, .70)
# Elf eyes are ordinary, alert green with a real dark pupil -- deliberately not
# the imp's pupil-less molten glow, so heroes read as mortal at a glance.
eye_white = material('Eye | sclera', (.470, .458, .430), 0, .28)
eye_iris = material('Eye | iris green', (.055, .150, .075), 0, .26)

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
    """Smooth young elf skin: broad soft mottling and fine pores, no cellular
    cracking (that is the imp's hide) and no liver spots (that is the warlock)."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 32
    blotch.inputs['Detail'].default_value = 3; blotch.inputs['Roughness'].default_value = .5
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .36; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .66; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 150
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .12
    bmp.inputs['Distance'].default_value = .0016
    links.new(pores.outputs['Fac'], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .46
    rough.inputs['To Max'].default_value = .60
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

skin_shader(skin, (.430, .272, .208), (.372, .232, .178), (.478, .312, .244))
skin_shader(skin_shadow, (.360, .218, .165), (.270, .158, .120), (.430, .272, .215))
# Cloth reads as woven thread, stretched along the drape direction.
surface_detail(cloak, 56, .0030, .20, (1, 1, 2.2), .40)
surface_detail(cloak_dark, 56, .0030, .20, (1, 1, 2.2), .40)
surface_detail(tunic, 64, .0026, .22, (1, 1, 1.8), .38)
surface_detail(legwear, 70, .0022, .18, (1, 1, 2.4), .34)
surface_detail(jerkin, 46, .0024, .22)
surface_detail(leather_dark, 52, .0022, .24)
surface_detail(leather_edge, 44, .0018, .26)
surface_detail(boot_leather, 40, .0020, .20)
surface_detail(hair, 105, .0034, .26, (1, 1, .18), .68)
surface_detail(wood, 18, .0032, .36, (7, 7, .40))
surface_detail(steel, 48, .0007, .12)
surface_detail(brass, 44, .0009, .14)
surface_detail(horn, 24, .0009, .16)
surface_detail(string_mat, 120, .0008, .12, (1, 1, .10), .55)
surface_detail(fletch, 30, .0014, .22, (1, 1, 4))
surface_detail(fletch_red, 30, .0014, .22, (1, 1, 4))

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
    """A bevelled block for bound and stitched pieces; never left as a raw box."""
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
    """A swept tube.  NOTE: `taper` returns a MULTIPLIER of `radius` (clamped to
    0.04), not an absolute radius -- the first pass of this model returned metres
    here and produced a bow as thin as a hair."""
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
    tube(name, pts, radius, mat or brass, bone, cyclic=True, res=2, segments=4)
    rod(name + ' prong', loc + right * (w / 2) - n * .004, loc - right * (w * .12) - n * .004,
        radius * .75, radius * .5, mat or brass, bone, 8)

def track(x, stops):
    """Smoothstep through (x, value) control points; the profile authoring workhorse."""
    if x <= stops[0][0]: return stops[0][1]
    for (a, va), (b, vb) in zip(stops, stops[1:]):
        if x <= b:
            u = (x - a) / (b - a); u = u * u * (3 - 2 * u)
            return va + (vb - va) * u
    return stops[-1][1]

def sstep(x):
    x = max(0., min(1., x)); return x * x * (3 - 2 * x)

def catmull(points):
    """A C1 curve through control points, used to sweep sleeves and straps."""
    pts = [Vector(p) for p in points]
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    n = len(points) - 1
    def f(u):
        u = max(0, min(1, u)) * n
        i = min(int(u), n - 1); s = u - i
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        return ((p1 * 2) + (p2 - p0) * s + (p0 * 2 - p1 * 5 + p2 * 4 - p3) * s * s
                + (p1 * 3 - p0 - p2 * 3 + p3) * s * s * s) * .5
    return f

def sheet(name, P, rows, cols, thickness, mat, bone, cyclic_v=False, eps=1.5e-3):
    """A thin cloth shell built from a parametric surface P(u, v) -> Vector.

    Front and back grids are offset along the numeric surface normal and every
    open rim is closed, so the cloth shows a real edge thickness rather than the
    paper-thin plane that makes a model look cheap.  Folds live in P itself.
    """
    N, M = rows, cols
    def thick(u, v): return thickness(u, v) if callable(thickness) else thickness
    def normal(u, v):
        du = P(min(1, u + eps), v) - P(max(0, u - eps), v)
        dv = P(u, v + eps) - P(u, v - eps)
        n = du.cross(dv)
        return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
    verts = []; F = []; K = []
    for i in range(N):
        u = i / (N - 1)
        F.append([]); K.append([])
        row = []
        for j in range(M):
            v = j / M if cyclic_v else j / (M - 1)
            p = P(u, v); n = normal(u, v) * (thick(u, v) / 2)
            row.append((p + n, p - n))
        for p, _ in row: F[i].append(len(verts)); verts.append(p)
        for _, p in row: K[i].append(len(verts)); verts.append(p)
    faces = []
    span = M if cyclic_v else M - 1
    for i in range(N - 1):
        for j in range(span):
            k = (j + 1) % M
            faces.append((F[i][j], F[i][k], F[i + 1][k], F[i + 1][j]))
            faces.append((K[i][j], K[i + 1][j], K[i + 1][k], K[i][k]))
    for j in range(span):
        k = (j + 1) % M
        faces.append((F[0][j], K[0][j], K[0][k], F[0][k]))
        faces.append((F[N - 1][k], K[N - 1][k], K[N - 1][j], F[N - 1][j]))
    if not cyclic_v:
        for i in range(N - 1):
            faces.append((F[i][0], F[i + 1][0], K[i + 1][0], K[i][0]))
            faces.append((F[i][M - 1], K[i][M - 1], K[i + 1][M - 1], F[i + 1][M - 1]))
    o = mesh(name, verts, faces, mat, bone)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    smooth(o); return o

def sweep(path, radius, up=Vector((0, 0, 1))):
    """Turn a centre-line plus a radius(u, theta) into a P(u, v) for sheet()."""
    def P(u, v):
        c = path(u)
        t = (path(min(1, u + 2e-3)) - path(max(0, u - 2e-3)))
        t = t.normalized() if t.length > 1e-9 else Vector((0, 0, -1))
        a = up.cross(t)
        if a.length < 1e-4: a = Vector((1, 0, 0)).cross(t)
        a.normalize(); b = t.cross(a).normalized()
        th = 2 * math.pi * v
        return c + (a * math.cos(th) + b * math.sin(th)) * radius(u, th)
    return P

def sample_parts(objects):
    """Tagged weight anchors taken from a union's constituent primitives."""
    return [(o.matrix_world @ v.co, o['bone']) for o in objects for v in o.data.vertices]

def weight_by(o, anchors, sigma=.06, count=3, neighbours=18):
    """Blend skin weights from tagged anchor points so joints deform smoothly.

    Rigid one-bone binding is fine for props, but the body, the jerkin, the boots
    and the cloak each span several bones; a nearest-anchor gaussian gives them a
    smooth falloff without hand-painting weights.
    """
    activate(o)
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tree = KDTree(len(anchors))
    for i, (co, _) in enumerate(anchors): tree.insert(Vector(co), i)
    tree.balance()
    groups = {}
    for _, name in anchors:
        if name not in groups: groups[name] = o.vertex_groups.new(name=name)
    k = min(len(anchors), neighbours)
    for vertex in o.data.vertices:
        closest = {}
        for _, idx, distance in tree.find_n(vertex.co, k):
            name = anchors[idx][1]
            closest[name] = min(distance, closest.get(name, 1e9))
        nearest = min(closest.values())
        weights = {n: math.exp(-((d - nearest) / sigma) ** 2) for n, d in closest.items()}
        weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:count])
        weights = {n: w for n, w in weights.items() if w > .003}
        total = sum(weights.values())
        for name, w in weights.items(): groups[name].add([vertex.index], w / total, 'REPLACE')
    o['weighted_body'] = True
    return o

def xform(objects, M):
    """Bake a world matrix into a group of finished objects (used to cant the bow)."""
    for o in objects:
        o.matrix_world = M @ o.matrix_world
        activate(o); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
# Slender, upright elf proportions authored at roughly 2.55x the final size so
# the voxel remesh has room to resolve the face; settle() rescales at the end.
# Legs are 55% of the standing height and the head is a small 7.7-head fraction
# of it -- the opposite of the imp's squat, big-headed silhouette.  The right arm
# hangs a little forward of the left, ready to reach for the string.
joints = {
    'L': dict(shoulder=(.400, -.020, 3.500), elbow=(.455, -.100, 2.940), wrist=(.420, -.245, 2.440), hand=(.410, -.310, 2.320),
              hip=(.185, 0, 2.420), knee=(.205, -.030, 1.360), ankle=(.200, .020, .220), foot=(.200, -.300, .060)),
    'R': dict(shoulder=(-.400, -.020, 3.500), elbow=(-.440, -.120, 2.960), wrist=(-.360, -.300, 2.500), hand=(-.330, -.380, 2.400),
              hip=(-.185, 0, 2.420), knee=(-.205, -.030, 1.360), ankle=(-.200, .020, .220), foot=(-.200, -.300, .060)),
}
GRIP = Vector(joints['L']['hand'])          # the longbow's grip sits in the left hand
BOW_CANT = math.radians(58)                 # the bow plane canted off the shooting plane while carried
BOW_X = Vector((math.cos(BOW_CANT), math.sin(BOW_CANT), 0))    # canonical +X: the bow's thin axis
BOW_Y = Vector((-math.sin(BOW_CANT), math.cos(BOW_CANT), 0))   # canonical +Y: toward the string / the archer
def bowpt(x, y, z):
    """Canonical bow-frame coordinate -> world."""
    return GRIP + BOW_X * x + BOW_Y * y + Vector((0, 0, z))

# ---------------------------------------------------------------- slender body sculpt
# Most of this ends up under cloth; it exists so the neck, forearms and ankles
# read as a real body and so the jerkin and cloak have something to be cut around.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Pelvis', (0, 0, 2.420), (.215, .180, .185), bone='hips'))
B(ell('Lower spine', (0, -.010, 2.700), (.190, .150, .190), bone='spine'))
B(ell('Ribcage', (0, -.050, 3.050), (.235, .180, .245), bone='spine'))
B(ell('Upper chest', (0, -.085, 3.320), (.265, .170, .175), bone='chest'))
B(ell('Upright upper back', (0, .075, 3.340), (.215, .155, .190), bone='chest'))
B(ell('Trapezius', (0, -.060, 3.460), (.215, .170, .105), bone='chest'))
B(ell('Slim neck', (0, -.045, 3.660), (.098, .098, .180), bone='chest'))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    B(ell('Clavicle', (s * .230, -.110, 3.470), (.145, .105, .075), bone='chest'))
    B(ell('Deltoid', (s * .390, -.030, 3.470), (.115, .125, .125), bone=f'upper_arm.{L}'))
    B(limb('Upper arm', j['shoulder'], j['elbow'], .082, f'upper_arm.{L}', ry=.086))
    B(ell('Elbow', j['elbow'], (.080, .082, .080), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .070, f'forearm.{L}', ry=.074))
    B(ell('Wrist', j['wrist'], (.055, .055, .050), bone=f'forearm.{L}'))
    B(limb('Thigh', j['hip'], j['knee'], .135, f'thigh.{L}', ry=.145))
    B(ell('Knee', j['knee'], (.108, .112, .108), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .100, f'shin.{L}', ry=.106))
    B(ell('Ankle', j['ankle'], (.072, .072, .072), bone=f'shin.{L}'))
body_anchors = sample_parts(body_parts)
body = union('Continuous body sculpt', body_parts, .028, .16)

# ---------------------------------------------------------------- head sculpt (two-pass, fine elven features)
# A small, narrow, high-cheekboned skull: tall cranium, a shallow but sharply
# angled brow, hollow cheeks under wide cheekbones, a fine straight nose and a
# small pointed chin.  The cheek is deliberately undersized so the bone above it
# reads by contrast rather than by piling on mass.
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, -.018, 4.170), (.222, .256, .256), bone='head'))
H(ell('Crown', (0, -.030, 4.268), (.178, .198, .156), bone='head'))
H(ell('Occiput', (0, .062, 4.080), (.220, .208, .222), bone='head'))
H(ell('High forehead', (0, -.168, 4.192), (.184, .124, .152), bone='head'))
H(ell('Neck root', (0, -.030, 3.790), (.100, .100, .140), bone='head'))
H(ell('Narrow jaw', (0, -.158, 3.968), (.118, .158, .078), bone='head'))
H(ell('Upper lip mass', (0, -.242, 4.000), (.055, .038, .034), bone='head'))
H(ell('Small pointed chin', (0, -.250, 3.924), (.041, .048, .042), bone='head'))
H(ell('Nose bridge', (0, -.230, 4.166), (.030, .062, .094), bone='head'))
H(ell('Straight nose ridge', (0, -.276, 4.090), (.022, .056, .058), bone='head'))
H(ell('Fine nose tip', (0, -.296, 4.048), (.024, .036, .024), bone='head'))
H(ell('Philtrum', (0, -.250, 4.008), (.022, .022, .020), bone='head'))
for s in (-1, 1):
    H(ell('Temple', (s * .162, -.100, 4.162), (.066, .148, .142), bone='head'))
    H(ell('Wide cheekbone', (s * .134, -.184, 4.048), (.060, .080, .040), bone='head'))
    H(ell('Cheek hollow', (s * .108, -.162, 3.960), (.052, .072, .058), bone='head'))
    H(ell('Jaw angle', (s * .124, -.040, 3.992), (.052, .092, .072), bone='head'))
    H(ell('Nostril wing', (s * .032, -.272, 4.032), (.019, .026, .019), bone='head'))
    # Elven brows angle up and outward toward the temple -- the mirror image of
    # the imp's downward, inward scowl.
    H(ell('Sharp brow', (s * .100, -.244, 4.202), (.100, .044, .030), bone='head', rot=(.18, -s * .32, 0)))
head_obj = union('Head sculpt pass 1', head_parts, .0105, 1.0, smoothing=1, bone='head')

# Second pass: eyelid rims, lips and the crease under the cheekbone are seated on
# the first sculpt and welded in by a second remesh, so the eye opening is a real
# almond in the surface rather than a decal.
def lip_line(x):
    return 3.9770 + .017 * (x / .056) ** 2
lip_x = [-.056 + .112 * i / 10 for i in range(11)]
EYE_SEED = {1: (.098, -.200, 4.132), -1: (-.098, -.200, 4.132)}
refine = [head_obj]
refine.append(tube('Upper lip', conformed([(x, -.262, lip_line(x) + .013) for x in lip_x], head_obj, .006),
                   .011, skin, 'head', lambda t: .55 + .45 * math.sin(math.pi * t)))
refine.append(tube('Lower lip', conformed([(x, -.262, lip_line(x) - .020) for x in lip_x], head_obj, .008),
                   .013, skin, 'head', lambda t: .55 + .45 * math.sin(math.pi * t)))
for s in (-1, 1):
    # The lid rims: two arcs seated proud of the face, leaving a 0.04 unit almond
    # gap between them.  The eyeball is planted inside that gap afterwards, so it
    # is framed by real lids instead of floating on the cheek as a white ball.
    upper = [(s * .046, -.222, 4.150), (s * .098, -.244, 4.172), (s * .150, -.232, 4.158), (s * .176, -.204, 4.134)]
    lower = [(s * .046, -.222, 4.108), (s * .098, -.242, 4.090), (s * .150, -.230, 4.098), (s * .176, -.204, 4.126)]
    refine.append(tube('Upper lid rim', conformed(upper, head_obj, .006), .0105, skin, 'head',
                       lambda t: .70 + .40 * math.sin(math.pi * t)))
    refine.append(tube('Lower lid rim', conformed(lower, head_obj, .005), .0090, skin, 'head',
                       lambda t: .65 + .35 * math.sin(math.pi * t)))
    hollow = conformed([(s * .172, -.196, 4.062), (s * .148, -.194, 4.008), (s * .116, -.172, 3.968)], head_obj, .003)
    refine.append(tube('Cheekbone edge', hollow, .010, skin, 'head', lambda t: math.sin(math.pi * t) ** .5))
head_obj = union('Head sculpt', refine, .0100, .34, smoothing=2, bone='head')

# Features seated on the final surface.
mouth_x = [-.042 + .084 * i / 10 for i in range(11)]
strip_up = conformed([(x, -.262, lip_line(x) + .0015) for x in mouth_x], head_obj, .003)
strip_low = conformed([(x, -.262, lip_line(x) - .0055) for x in mouth_x], head_obj, .003)
mouth = mesh('Mouth line', strip_up + strip_low, [(i, i + 1, 11 + i + 1, 11 + i) for i in range(10)], dark, 'head')
smooth(mouth)
EYE = {}
for s in (-1, 1):
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    loc, n = surface_point(head_obj, EYE_SEED[s], 0)
    EYE[s] = tuple(loc + n * .010)
    patch('Sclera', EYE_SEED[s], (.036, .011, .022), eye_white, eye_bone, head_obj, .004, 3)
    patch('Iris', (s * .084, -.200, 4.130), (.019, .0105, .019), eye_iris, eye_bone, head_obj, .005, 3)
    patch('Pupil', (s * .082, -.200, 4.130), (.0090, .0090, .0090), dark, eye_bone, head_obj, .009, 2)
    patch('Nostril', (s * .026, -.294, 4.022), (.012, .007, .008), dark, 'head', head_obj, .002)
    # A dark lash line along the upper lid: the single strongest readability cue
    # on a small face, and what the rejected first pass was missing.
    lash = conformed([(s * .048, -.226, 4.152), (s * .100, -.250, 4.176), (s * .152, -.238, 4.162), (s * .178, -.208, 4.138)], head_obj, .022)
    tube('Lash line', lash, .0042, dark, 'head', lambda t: .5 + .9 * math.sin(math.pi * t), res=1, segments=4)
    brow = [Vector(loc) + n * .010 + Vector((-s * .038, 0, .044)),
            Vector(loc) + n * .015 + Vector((s * .012, 0, .062)),
            Vector(loc) + n * .012 + Vector((s * .060, 0, .064)),
            Vector(loc) + n * .004 + Vector((s * .094, 0, .044))]
    tube('Angled brow', brow, .0090, hair, 'head', lambda t: .30 + .55 * math.sin(math.pi * t), res=1, segments=4)

# ---------------------------------------------------------------- long pointed elven ears
# Rooted at the temple and swept up, out and back so the tips clear the hood.
EAR_BASE = {1: (.215, -.030, 4.060), -1: (-.215, -.030, 4.060)}
EAR_DIR = {1: (.679, .321, .660), -1: (-.679, .321, .660)}
EAR_LENGTH = .340
def ear(s):
    label = 'L' if s > 0 else 'R'
    base = Vector(EAR_BASE[s])
    d = Vector(EAR_DIR[s]).normalized()
    n = Vector((-s * .18, -1.0, .30)); n = (n - d * n.dot(d)).normalized()
    a = d.cross(n).normalized()
    N, M, L, W = 14, 7, EAR_LENGTH, .115
    def width(u): return W * (1 - u) ** 1.10 * (.70 + .30 * math.sin(math.pi * u))
    def P(u, v):
        curl = .026 * u * u + .012 * math.sin(math.pi * v) * (1 - u)
        return base + d * (u * L) + a * ((v - .5) * width(u)) + n * curl
    def T(u, v): return .009 + .026 * (1 - u) ** 1.7
    verts = []; F = []; K = []
    for i in range(N):
        u = i / N * .96
        F.append([]); K.append([])
        for j in range(M + 1):
            F[i].append(len(verts)); verts.append(P(u, j / M))
        for j in range(M + 1):
            K[i].append(len(verts)); verts.append(P(u, j / M) - n * T(u, j / M))
    tf = len(verts); verts.append(P(1, .5)); tb = len(verts); verts.append(P(1, .5) - n * .004)
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
    o = mesh('Elf ear ' + label, verts, faces, skin, 'ear.' + label)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    m = o.modifiers.new('Cartilage', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    smooth(o)
    # A raised helix rim so the ear is a shell, not a fin.
    rim = [base + d * (u * EAR_LENGTH) + a * (width(u) / 2) for u in (.05, .30, .55, .78, .93)]
    tube('Ear helix ' + label, rim, .016, skin, 'ear.' + label, lambda t: 1.0 - .55 * t, res=1, segments=4)
    return o
ear(-1); ear(1)

# ---------------------------------------------------------------- fitted tan leather jerkin
# A separate sculpt over the body: broad across the chest, pinched at the belt
# line and flared into short tassets over the hips, so the waist reads by
# contrast instead of by adding mass anywhere.
jerkin_parts = []
def J(o): jerkin_parts.append(o); return o
for s, L in ((-1, 'R'), (1, 'L')):
    J(ell('Jerkin shoulder cap', (s * .372, -.030, 3.452), (.180, .200, .122), jerkin, 'chest'))
J(ell('Jerkin collar', (0, -.050, 3.560), (.168, .158, .070), jerkin, 'chest'))
J(ell('Jerkin chest', (0, -.098, 3.300), (.300, .214, .192), jerkin, 'chest'))
J(ell('Jerkin back', (0, .072, 3.320), (.266, .192, .200), jerkin, 'chest'))
J(ell('Jerkin ribs', (0, -.050, 3.060), (.278, .208, .215), jerkin, 'spine'))
J(ell('Jerkin waist', (0, -.030, 2.800), (.246, .190, .180), jerkin, 'spine'))
J(ell('Jerkin hip flare', (0, -.010, 2.560), (.292, .232, .190), jerkin, 'hips'))
J(ell('Jerkin tassets', (0, .000, 2.375), (.310, .250, .130), jerkin, 'hips'))
jerkin_anchors = sample_parts(jerkin_parts)
jerkin_obj = union('Jerkin pass 1', jerkin_parts, .024, 1.0, jerkin, 1)
# Panel seams and soft leather creases welded in by a second remesh: worn kit,
# not a smooth cone.
creases = [jerkin_obj]
for s in (-1, 1):
    seam = conformed([(s * .085, -.190, 3.400), (s * .175, -.150, 3.200), (s * .195, -.100, 2.980), (s * .160, -.060, 2.760)], jerkin_obj, -.006)
    creases.append(tube('Side panel seam', seam, .015, jerkin, 'chest', lambda t: .6 + .6 * math.sin(math.pi * t), res=1, segments=4))
    fold = conformed([(s * .240, .050, 3.300), (s * .215, .090, 3.060), (s * .170, .095, 2.840)], jerkin_obj, -.006)
    creases.append(tube('Back crease', fold, .013, jerkin, 'spine', lambda t: math.sin(math.pi * t) ** .6, res=1, segments=4))
for k in range(5):
    a = -1.15 + k * .575
    path = conformed([(math.sin(a) * .30, -math.cos(a) * .24, z) for z in (2.86, 2.68, 2.50, 2.36)], jerkin_obj, -.008)
    creases.append(tube('Tasset fold', path, .016, jerkin, 'hips', lambda t: .5 + .8 * math.sin(math.pi * t) ** .7, res=1, segments=4))
jerkin_obj = union('Jerkin', creases, .022, .25, jerkin, 1)
weight_by(jerkin_obj, jerkin_anchors, .058)

# Stitched trim: a raised placket down the centre front, cross-lacing over the
# chest, and a piped edge around the collar and the tasset hem.
placket = conformed([(0, -.230, z) for z in (3.480, 3.320, 3.150, 2.980, 2.820)], jerkin_obj, .010)
ribbon('Jerkin placket', placket, .100, leather_edge, 'chest', jerkin_obj, .008, .012)
for k in range(4):
    z = 3.420 - k * .120
    for s in (-1, 1):
        lace = conformed([(-s * .085, -.230, z), (0, -.245, z - .058), (s * .085, -.230, z - .116)], jerkin_obj, .026)
        tube('Chest lacing', lace, .0085, leather_edge, 'chest', lambda t: .8 + .3 * math.sin(math.pi * t), res=1, segments=4)
collar_ring = conformed([(.170 * math.sin(2 * math.pi * i / 22), -.050 + .160 * math.cos(2 * math.pi * i / 22), 3.545) for i in range(22)], jerkin_obj, .012)
tube('Collar piping', collar_ring, .015, leather_dark, 'chest', cyclic=True, res=1, segments=2)
hem_ring = [(.318 * math.sin(2 * math.pi * i / 26), .318 * .80 * math.cos(2 * math.pi * i / 26), 2.318 + .020 * math.sin(5 * i)) for i in range(26)]
tube('Tasset hem piping', conformed(hem_ring, jerkin_obj, .012), .016, leather_edge, 'hips', cyclic=True, res=1, segments=2)
for s in (-1, 1):
    for k in range(4):
        patch('Shoulder stud', (s * (.230 + .050 * k), -.060 - .010 * k, 3.480), (.016, .010, .016), brass, 'chest', jerkin_obj, .012)

# ---------------------------------------------------------------- moss-green tunic sleeves
def sleeve(L):
    s = 1 if L == 'L' else -1
    j = joints[L]
    pieces = [
        ell('Sleeve head', (s * .388, -.030, 3.438), (.148, .168, .132), tunic, f'upper_arm.{L}'),
        limb('Sleeve', j['shoulder'], j['elbow'], .100, f'upper_arm.{L}', mat=tunic, ry=.104),
        ell('Sleeve gather', Vector(j['elbow']).lerp(Vector(j['shoulder']), .12), (.096, .098, .062), tunic, f'forearm.{L}'),
    ]
    anchors = sample_parts(pieces)
    o = union(f'Tunic sleeve {L}', pieces, .016, .40, tunic, 1)
    weight_by(o, anchors, .060)
    # A darker band closes the cuff over the top of the bracer.
    a = (Vector(j['wrist']) - Vector(j['elbow'])).normalized()
    e1 = a.cross(Vector((0, 0, 1))).normalized(); e2 = a.cross(e1).normalized()
    c = Vector(j['elbow']).lerp(Vector(j['wrist']), .10)
    ring = [c + e1 * (.096 * math.cos(2 * math.pi * i / 18)) + e2 * (.096 * math.sin(2 * math.pi * i / 18)) for i in range(18)]
    tube(f'Sleeve cuff {L}', ring, .017, cloak_dark, f'forearm.{L}', cyclic=True, res=1, segments=3)
sleeve('L'); sleeve('R')

# ---------------------------------------------------------------- laced leather bracers
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    a = (Vector(j['wrist']) - Vector(j['elbow'])).normalized()
    e1 = a.cross(Vector((0, 0, 1))).normalized(); e2 = a.cross(e1).normalized()
    centre = Vector(j['wrist']).lerp(Vector(j['elbow']), .40)
    def band(off, r, steps=18, e1=e1, e2=e2, a=a, centre=centre):
        return [centre + a * off + e1 * (r * math.cos(2 * math.pi * i / steps)) + e2 * (r * math.sin(2 * math.pi * i / steps)) for i in range(steps)]
    ribbon(f'Bracer {L}', band(0, .082), .180, leather_dark, f'forearm.{L}', body, .012, .022, cyclic=True)
    for off in (-.086, .086):
        tube('Bracer rim', conformed(band(off, .082), body, .026), .011, leather_edge, f'forearm.{L}', cyclic=True, res=1, segments=3)
    # Cross-lacing up the outside of the bracer.
    for k in range(4):
        off = -.066 + k * .044
        p0 = centre + a * off + e1 * (.098 * math.cos(-.5)) + e2 * (.098 * math.sin(-.5))
        p1 = centre + a * (off + .044) + e1 * (.098 * math.cos(.5)) + e2 * (.098 * math.sin(.5))
        mid = (p0 + p1) / 2 + (p0 + p1 - 2 * centre - 2 * a * off).normalized() * .012
        tube('Bracer lace', [p0, mid, p1], .0075, leather_edge, f'forearm.{L}', res=1, segments=3)
        tube('Bracer lace', [p1 - a * .044, mid, p0 + a * .044], .0075, leather_edge, f'forearm.{L}', res=1, segments=3)

# ---------------------------------------------------------------- belt, buckle and pouches
belt_ring = conformed([(.270 * math.sin(2 * math.pi * i / 26), -.020 + .215 * math.cos(2 * math.pi * i / 26), 2.720) for i in range(26)], jerkin_obj, .014)
ribbon('Belt', belt_ring, .105, leather_dark, 'spine', jerkin_obj, .012, .022, cyclic=True)
buckle('Belt buckle', (0, -.260, 2.720), .130, .100, 'spine', jerkin_obj, .034, right=(1, 0, 0), radius=.016)
for a in (-2.5, -1.7, 1.7, 2.5):
    patch('Belt rivet', (.270 * math.sin(a), -.020 + .215 * math.cos(a), 2.720), (.016, .010, .016), brass, 'spine', jerkin_obj, .034)
tube('Belt tail', [(-.090, -.268, 2.720), (-.150, -.268, 2.640), (-.170, -.258, 2.545)], .022, leather_dark, 'hips', lambda t: 1.0 - .25 * t, res=1, segments=4)
for k, (x, y, z, size) in enumerate(((.245, -.150, 2.560, .088), (-.230, -.130, 2.540, .068))):
    pouch = union(f'Belt pouch {k}', [
        ell('Pouch body', (x, y, z), (size, size * .80, size * 1.10), leather_dark, 'hips'),
        ell('Pouch base', (x, y, z - size * .72), (size * .88, size * .72, size * .55), leather_dark, 'hips'),
        ell('Pouch flap', (x, y - size * .16, z + size * .90), (size * .95, size * .80, size * .34), leather_dark, 'hips'),
    ], .012, .45, leather_dark, 2, 'hips')
    tube('Pouch hanger', [(x, y + .020, 2.730), (x, y + .010, z + size * 1.02)], .014, leather_dark, 'hips', res=1, segments=3)
    buckle('Pouch clasp', (x, y - size * .82, z + size * .55), .040, .030, 'hips', pouch, .006, right=(1, 0, 0), radius=.007)

# ---------------------------------------------------------------- dark fitted leggings
legging_parts = []
def LG(o): legging_parts.append(o); return o
LG(ell('Seat', (0, .035, 2.400), (.245, .215, .175), legwear, 'hips'))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    LG(ell('Hip', (s * .190, 0, 2.380), (.160, .175, .150), legwear, 'hips'))
    LG(limb('Legging thigh', j['hip'], j['knee'], .152, f'thigh.{L}', mat=legwear, ry=.162))
    LG(ell('Knee', j['knee'], (.122, .126, .118), legwear, f'shin.{L}'))
    LG(limb('Legging calf', (j['knee'][0], j['knee'][1], j['knee'][2]), (j['ankle'][0], j['ankle'][1] + .010, 1.050), .112, f'shin.{L}', mat=legwear, ry=.116))
legging_anchors = sample_parts(legging_parts)
leggings = union('Leggings', legging_parts, .020, .24, legwear, 1)
weight_by(leggings, legging_anchors, .060)

# ---------------------------------------------------------------- tall laced boots
for s, L in ((-1, 'R'), (1, 'L')):
    pieces = [
        ell('Boot cuff', (s * .203, -.010, 1.150), (.128, .132, .062), boot_leather, f'shin.{L}'),
        limb('Boot shaft', (s * .202, .002, 1.130), (s * .200, .018, .330), .108, f'shin.{L}', mat=boot_leather, ry=.112),
        ell('Boot ankle', (s * .200, .012, .260), (.098, .108, .098), boot_leather, f'foot.{L}'),
        ell('Boot heel', (s * .200, .085, .105), (.086, .088, .092), boot_leather, f'foot.{L}'),
        ell('Boot instep', (s * .200, -.095, .130), (.092, .140, .095), boot_leather, f'foot.{L}'),
        ell('Boot toe', (s * .200, -.255, .082), (.080, .108, .072), boot_leather, f'foot.{L}'),
        ell('Boot sole', (s * .200, -.085, .034), (.094, .240, .034), boot_leather, f'foot.{L}'),
    ]
    anchors = sample_parts(pieces)
    boot = union(f'Boot {L}', pieces, .016, .26, boot_leather, 1)
    weight_by(boot, anchors, .060)
    # Cross-laces up the front of the shaft plus a folded-over cuff lip.
    ring = [(s * .203 + .130 * math.cos(2 * math.pi * i / 18), -.010 + .134 * math.sin(2 * math.pi * i / 18), 1.142) for i in range(18)]
    tube(f'Boot cuff lip {L}', conformed(ring, boot, .014), .020, leather_dark, f'shin.{L}', cyclic=True, res=1, segments=3)
    for k in range(5):
        z = .420 + k * .168
        p0 = (s * .200 - .078, -.110, z); p1 = (s * .200 + .078, -.110, z + .084)
        lace = conformed([p0, (s * .200, -.135, z + .042), p1], boot, .014)
        tube('Boot lace', lace, .0085, leather_edge, f'shin.{L}', lambda t: .8 + .3 * math.sin(math.pi * t), res=1, segments=3)
        lace = conformed([(p1[0], p1[1], z), (s * .200, -.135, z + .042), (p0[0], p0[1], z + .084)], boot, .014)
        tube('Boot lace', lace, .0085, leather_edge, f'shin.{L}', lambda t: .8 + .3 * math.sin(math.pi * t), res=1, segments=3)
    patch('Boot toe cap', (s * .200, -.320, .085), (.070, .026, .062), leather_dark, f'foot.{L}', boot, .006)

# ---------------------------------------------------------------- hands
def left_hand():
    """Long fingers wrapped around the bow's flat grip, thumb over the belly."""
    bone = 'hand.L'; pieces = []
    j = joints['L']
    pieces.append(ell('Wrist', j['wrist'], (.054, .054, .050), skin, bone))
    pieces.append(ell('Palm', bowpt(.088, .078, .010), (.058, .060, .096), skin, bone))
    pieces.append(ell('Thenar pad', bowpt(.070, .050, .078), (.048, .052, .050), skin, bone))
    for i in range(4):
        z = -.082 + .052 * i
        path = [bowpt(.079 * math.cos(t), .102 * math.sin(t), z + .010 * math.sin(t))
                for t in (.75, .10, -.70, -1.55, -2.35, -2.75)]
        pieces.append(tube('Gripping finger', path, .021, skin, bone, lambda t: 1.05 - .20 * t))
        pieces.append(ell('Knuckle', path[1], (.030, .030, .030), skin, bone, 2))
    pieces.append(tube('Thumb', [bowpt(.078, .062, .088), bowpt(.040, .098, .052), bowpt(-.020, .100, .022)],
                       .030, skin, bone, lambda t: 1.1 - .30 * t))
    pieces.append(ell('Thumb tip', bowpt(-.020, .100, .022), (.028, .028, .028), skin, bone, 2))
    union('Left hand sculpt', pieces, .0085, .34, skin, 1, bone)

def right_hand():
    """Open draw hand: three fingers half-curled around an imagined string."""
    bone = 'hand.R'; pieces = []
    j = joints['R']
    pieces.append(ell('Wrist', j['wrist'], (.054, .054, .050), skin, bone))
    pieces.append(ell('Palm', (-.334, -.384, 2.372), (.050, .074, .082), skin, bone))
    pieces.append(ell('Knuckle ridge', (-.338, -.412, 2.306), (.050, .062, .044), skin, bone))
    for i in range(4):
        x = -.276 - .042 * i
        short = (.000, -.012, -.006, .022)[i]
        path = [(x, -.398, 2.318), (x - .004, -.424, 2.262 + short), (x - .010, -.436, 2.212 + short), (x - .016, -.430, 2.176 + short)]
        pieces.append(tube('Draw finger', path, .0195, skin, bone, lambda t: 1.05 - .24 * t))
        pieces.append(ell('Knuckle', path[0], (.024, .024, .024), skin, bone, 2))
        pieces.append(ell('Fingertip', path[-1], (.019, .019, .019), skin, bone, 2))
    pieces.append(tube('Thumb', [(-.290, -.356, 2.346), (-.256, -.400, 2.304), (-.248, -.428, 2.262)],
                       .024, skin, bone, lambda t: 1.1 - .22 * t))
    union('Right hand sculpt', pieces, .0080, .32, skin, 1, bone)
left_hand(); right_hand()

# ---------------------------------------------------------------- auburn braid over the left shoulder
# A hair fringe inside the hood first, so the face is framed by hair rather than
# sitting bare against green cloth.
# Loose strands down the temple were tried and cut: they crossed the brow and
# read as scars.  The hood frames the face and the plait carries the hair.
braid_path = [(.172, -.070, 4.056), (.262, -.170, 3.918), (.320, -.238, 3.700), (.338, -.270, 3.450),
              (.326, -.278, 3.200), (.290, -.270, 2.980), (.258, -.258, 2.820)]
braid_pieces = [tube('Braid core', braid_path, .042, hair, 'braid', lambda t: 1.0 - .42 * t, res=2, segments=5)]
# Alternating lobes make it read as a plait rather than a rope.
for k in range(12):
    t = (k + .5) / 12
    idx = min(len(braid_path) - 2, int(t * (len(braid_path) - 1)))
    u = t * (len(braid_path) - 1) - idx
    a = Vector(braid_path[idx]); b = Vector(braid_path[idx + 1])
    c = a.lerp(b, u)
    tangent = (b - a).normalized()
    across = tangent.cross(Vector((0, -1, 0))).normalized()
    r = (.047 - .019 * t)
    braid_pieces.append(ell('Braid lobe', c + across * (r * .38 * (1 if k % 2 else -1)), (r, r * .92, r * .70), hair, 'braid', 2))
braid = union('Auburn braid', braid_pieces, .014, .34, hair, 1, 'braid')
tube('Braid tie', [Vector(braid_path[-1]) + Vector((-.024, 0, .010)), Vector(braid_path[-1]) + Vector((.024, 0, -.010))],
     .028, leather_dark, 'braid', res=1, segments=4)
ell('Braid tuft', (.244, -.252, 2.762), (.024, .024, .044), hair, 'braid', 2)

# ---------------------------------------------------------------- forest-green hooded cloak
# One continuous parametric shell from the chest hem, over the shoulders, around
# the neck and up over the raised hood.  The front opening is a single parameter
# per side: wide at the chest where the cloak parts, narrowing to a face-framing
# oval at the brow.  Below the shoulders the RIGHT opening widens sharply so the
# cloak is swept off the draw shoulder -- that is what keeps it clear of the
# quiver instead of intersecting it, and it reads as a deliberate archer's rig.
HOOD = [
    #  z     radius  front gap   centre y
    (3.060,  .500,   1.62,   .045),
    (3.200,  .530,   1.45,   .030),
    (3.340,  .550,   1.20,   .010),
    (3.480,  .560,    .92,  -.015),
    (3.580,  .485,    .60,  -.040),
    (3.700,  .428,    .58,  -.058),
    (3.820,  .398,    .74,  -.072),
    (3.940,  .374,    .88,  -.080),
    (4.060,  .362,    .90,  -.082),
    (4.180,  .352,    .82,  -.082),
    (4.300,  .330,    .60,  -.080),
    (4.400,  .284,    .36,  -.078),
    (4.490,  .204,    .17,  -.074),
    (4.545,  .114,    .07,  -.070),
    (4.580,  .004,    .03,  -.066),
]
HOOD_Z = [row[0] for row in HOOD]
SQUASH = [(3.060, .62), (3.340, .60), (3.480, .60), (3.700, .82), (3.950, .96), (4.200, 1.0), (4.580, 1.0)]
def hood_z(u):
    # Bias rows toward the head so the face opening stays crisp.
    return HOOD_Z[0] + (HOOD_Z[-1] - HOOD_Z[0]) * u ** .80
def hood_edges(z):
    gap = track(z, [(a, c) for a, _, c, _ in HOOD])
    swept = min(2.96, gap + 1.70 * sstep((3.550 - z) / .300))     # the swept-back right side
    return -(math.pi - swept), (math.pi - gap)
def hood_radius(z, th):
    r = track(z, [(a, b) for a, b, _, _ in HOOD])
    fold = max(0, (3.500 - z) / .500)
    hooded = max(0., min(1., (z - 3.620) / .350))
    r *= (1 + .070 * fold ** 1.3 * math.cos(7 * th + .5) + .035 * hooded * max(0, math.cos(th)))
    # A soft tent over each ear root so the cloth is stretched by the ear rather
    # than pierced flat by it.
    r *= 1 + .17 * math.exp(-((abs(th) - 1.19) / .42) ** 2) * math.exp(-((z - 4.140) / .220) ** 2)
    return r
def hood_P(u, v):
    z = hood_z(u)
    thA, thB = hood_edges(z)
    th = thA + (thB - thA) * v
    r = hood_radius(z, th)
    cy = track(z, [(a, d) for a, _, _, d in HOOD])
    dz = .045 * max(0, (3.500 - z) / .500) ** 1.6 * math.sin(5 * th + 1.1)
    return Vector((r * math.sin(th), cy + r * track(z, SQUASH) * math.cos(th), z - dz))
hood = sheet('Hooded cloak', hood_P, 34, 46, .020, cloak, 'chest')
hood_anchors = []
for i in range(13):
    u = i / 12; z = hood_z(u)
    bone = 'head' if z > 3.780 else 'chest'
    for k in range(11): hood_anchors.append((hood_P(u, k / 10), bone))
weight_by(hood, hood_anchors, .120, 2, 12)
# A darker piped cord around the whole opening -- both front edges and the hem --
# so the green shape reads as a bordered garment rather than a fall of cloth.
for edge in (0.0, 1.0):
    pts = [hood_P(u, edge) for u in (0.0, .10, .20, .32, .44, .56, .68, .80, .90, .96, 1.0)]
    tube('Cloak edge cord', pts, .017, cloak_dark, 'head', lambda t: .70 + .50 * t, res=1, segments=4)

# The long back drape hangs from the same hem row, so cloak and drape are one
# garment; only the back arc carries it, and the hem is scalloped and flared.
DRAPE_TOP = 3.120
DRAPE_A, DRAPE_B = hood_edges(3.090)
def drape_P(u, v):
    th = DRAPE_A + .05 + (DRAPE_B - DRAPE_A - .10) * v
    mid = (DRAPE_A + DRAPE_B) / 2; half = (DRAPE_B - DRAPE_A) / 2
    hem = 1.560 + .520 * (abs(th - mid) / half) ** 1.7 - .070 * math.cos(6 * th + .7)
    z = DRAPE_TOP - (DRAPE_TOP - hem) * u
    r = .505 + .330 * u ** 1.15
    r *= 1 + .060 * u ** 1.2 * math.cos(8 * th + .4) + .022 * u ** 1.7 * math.cos(13 * th + 1.5)
    sq = .600 + .120 * u
    cy = .035 + .110 * u
    return Vector((r * math.sin(th), cy + r * sq * math.cos(th), z))
drape = sheet('Cloak back drape', drape_P, 18, 40, .020, cloak, 'cloak')
drape_anchors = [(drape_P(i / 7, j / 9), 'chest' if i == 0 else ('spine' if i == 1 else 'cloak')) for i in range(8) for j in range(10)]
weight_by(drape, drape_anchors, .150, 2, 10)
tube('Drape hem cord', [drape_P(1, j / 17) for j in range(18)], .017, cloak_dark, 'cloak', res=1, segments=2)
for edge in (0.0, 1.0):
    tube('Drape edge cord', [drape_P(u, edge) for u in (0, .25, .5, .75, 1.0)], .015, cloak_dark, 'cloak', res=1, segments=3)
# A carved clasp holds the cloak shut at the throat.
clasp = union('Cloak clasp', [
    ell('Clasp plate', (0, -.268, 3.545), (.052, .026, .038), steel, 'chest'),
    ell('Clasp boss', (0, -.284, 3.545), (.026, .020, .026), steel, 'chest'),
], .010, .50, steel, 1, 'chest')
for s in (-1, 1):
    tube('Clasp cord', [(0, -.272, 3.545), (s * .110, -.232, 3.560), (s * .200, -.150, 3.560)],
         .011, cloak_dark, 'chest', lambda t: 1.0, res=1, segments=3)

# A wrapped green neck cowl.  A small elven head over 13 cm of bare neck read as
# a stalk, and a cowl is what a hooded cloak actually has there.
for k, (z, r, rad) in enumerate(((3.700, .152, .052), (3.612, .166, .046))):
    ring = [(r * math.sin(2 * math.pi * i / 20), -.045 + r * .92 * math.cos(2 * math.pi * i / 20), z + .016 * math.sin(3 * i))
            for i in range(20)]
    tube('Neck cowl wrap', ring, rad, cloak if k == 0 else cloak_dark, 'head' if k == 0 else 'chest',
         cyclic=True, res=2, segments=3)

# ---------------------------------------------------------------- quiver, arrows and baldric
def fletched_arrow(name, nock, direction, length, bone, radius=.024, head=.095, roll=0.):
    d = Vector(direction).normalized()
    nock = Vector(nock)
    tip = nock + d * length
    rod(name + ' shaft', nock, tip, radius * .82, radius * .66, wood, bone, 8)
    rod(name + ' head', tip, tip + d * head, radius * .70, radius * .05, steel, bone, 6)
    ell(name + ' nock', nock, (radius * 1.05, radius * 1.05, radius * 1.05), horn, bone, 2)
    e1 = d.cross(Vector((0, 0, 1)))
    if e1.length < 1e-4: e1 = d.cross(Vector((1, 0, 0)))
    e1.normalize(); e2 = d.cross(e1).normalized()
    for k in range(3):
        a = roll + k * 2 * math.pi / 3
        n = e1 * math.cos(a) + e2 * math.sin(a)
        vane = [nock + d * .050, nock + d * .120 + n * .052, nock + d * .215 + n * .058, nock + d * .310 + n * .012]
        tube(name + ' fletching', vane, .010, fletch_red if k == 0 else fletch, bone,
             lambda t: .35 + 1.5 * math.sin(math.pi * t) ** .55, res=1, segments=4)

QUIVER_BOTTOM = Vector((-.060, .400, 2.350))
QUIVER_TOP = Vector((-.400, .285, 3.340))
qdir = (QUIVER_TOP - QUIVER_BOTTOM).normalized()
quiver = union('Quiver case', [
    rod('Quiver tube', QUIVER_BOTTOM - qdir * .050, QUIVER_TOP, .118, .142, leather_dark, 'chest', 18),
    ell('Quiver mouth', QUIVER_TOP, (.150, .150, .046), leather_dark, 'chest'),
    ell('Quiver base', QUIVER_BOTTOM - qdir * .050, (.120, .120, .050), leather_dark, 'chest'),
], .016, .26, leather_dark, 1, 'chest')
for k, t in enumerate((.30, .62)):
    ring_c = QUIVER_BOTTOM.lerp(QUIVER_TOP, t)
    e1 = qdir.cross(Vector((0, 0, 1))).normalized(); e2 = qdir.cross(e1).normalized()
    r = .124 + .016 * t
    tube('Quiver band', [ring_c + e1 * (r * math.cos(2 * math.pi * i / 16)) + e2 * (r * math.sin(2 * math.pi * i / 16)) for i in range(16)],
         .018, leather_edge, 'chest', cyclic=True, res=1, segments=3)
qe1 = qdir.cross(Vector((0, 0, 1))).normalized(); qe2 = qdir.cross(qe1).normalized()
for i in range(5):
    a = (i - 2) * .62
    off = qe1 * (math.cos(a) * .062) + qe2 * (math.sin(a) * .045)
    fletched_arrow('Quiver arrow', QUIVER_TOP + off - qdir * .120,
                   qdir + off * .28, .880 + .045 * math.cos(a * 1.6), 'chest', .022, .080, roll=a)
# Baldric: over the right shoulder on top of the cloak, then down across the
# jerkin to the left hip.  Hand-placed on the back and the shoulder so it rides
# outside the cloth; conformed to the jerkin on the chest.
baldric = [(-.420, .300, 3.300), (-.560, .190, 3.430), (-.660, -.030, 3.470), (-.560, -.230, 3.320),
           (-.360, -.290, 3.100), (-.150, -.285, 2.880), (.060, -.268, 2.740)]
tube('Baldric', baldric, .036, leather_dark, 'chest', lambda t: 1.0, res=2, segments=5)
for k in range(3):
    p = Vector(baldric[3 + k])
    tube('Baldric stitch', [p + Vector((-.030, -.010, .012)), p + Vector((.030, -.010, -.012))], .008, leather_edge, 'chest', res=1, segments=3)
buckle('Baldric buckle', (-.330, -.300, 3.130), .085, .065, 'chest', jerkin_obj, .052, right=(0, .35, 1), radius=.011)

# ---------------------------------------------------------------- longbow, wrapped grip, horn nocks and taut string
# Built in a canonical frame -- grip at the origin, limbs along +/-Z, the string
# plane 0.33 behind the grip at +Y -- then flattened across its thin axis and
# canted into the left hand.  Radii here are absolute; the taper callbacks return
# MULTIPLIERS (see tube()).
BOW_HALF = 1.450
limb_pts = [(0, 0, 0), (0, .020, .360), (0, .090, .720), (0, .190, 1.060), (0, .285, 1.300), (0, .330, BOW_HALF)]
bow_limbs = [
    tube('Bow upper limb', limb_pts, .070, wood, 'bow', lambda t: 1.02 - .52 * t, res=3, segments=6),
    tube('Bow lower limb', [(x, y, -z) for x, y, z in limb_pts], .070, wood, 'bow', lambda t: 1.02 - .52 * t, res=3, segments=6),
]
xform(bow_limbs, Matrix.Diagonal(Vector((.58, 1, 1, 1))))
bow_objs = list(bow_limbs)
# Leather grip wrap: one continuous helix around the flat handle section.
helix = []
for i in range(34):
    t = i / 33; th = t * 2 * math.pi * 5.5
    helix.append((.050 * math.cos(th), .006 + .086 * math.sin(th), -.200 + .400 * t))
bow_objs.append(tube('Grip wrap', helix, .016, leather_edge, 'bow', res=1, segments=2))
for z in (-.215, .215):
    bow_objs.append(tube('Grip whipping', [(.052 * math.cos(2 * math.pi * i / 10), .006 + .090 * math.sin(2 * math.pi * i / 10), z) for i in range(10)],
                         .014, leather_dark, 'bow', cyclic=True, res=1, segments=2))
for z in (BOW_HALF, -BOW_HALF):
    bow_objs.append(ell('Horn nock', (0, .330, z), (.030, .052, .058), horn, 'bow', 3))
    bow_objs.append(ell('Nock groove', (0, .372, z * .985), (.016, .020, .022), dark, 'bow', 2))
string_pts = [(0, .358, BOW_HALF * (1 - 2 * i / 12)) for i in range(13)]
bowstring = tube('Bowstring', string_pts, .017, string_mat, 'bow', res=1, segments=3)
bow_objs.append(bowstring)
bow_objs.append(tube('String serving', [(0, .358, .085), (0, .358, -.085)], .024, string_mat, 'nock', res=1, segments=3))
# The nocked arrow rests on the string and points at the ground until Attack
# swings it level; its own bone pivots at the nock so the draw reads correctly.
NOCK_C = Vector((.046, .358, 0))
ARROW_DIR = Vector((0, -math.sin(math.radians(46)), -math.cos(math.radians(46)))).normalized()
ARROW_LEN = 1.560
arrow_start = len(parts)
fletched_arrow('Nocked arrow', NOCK_C, ARROW_DIR, ARROW_LEN, 'arrow', .024, .095, roll=.4)
bow_objs.extend(parts[arrow_start:])
NOCK_WORLD = bowpt(NOCK_C.x, NOCK_C.y, NOCK_C.z)
ARROW_TIP_WORLD = bowpt(*(NOCK_C + ARROW_DIR * (ARROW_LEN + .095)))
BOW_NORMAL = tuple(BOW_X)                    # the axis the arrow swings about
xform(bow_objs, Matrix.Translation(GRIP) @ Matrix.Rotation(BOW_CANT, 4, 'Z'))
# Skin the string across bow and nock bones: the ends stay on the limbs while the
# middle follows the nock, so drawing the bow bends the string into a real V.
activate(bowstring)
g_bow = bowstring.vertex_groups.new(name='bow'); g_nock = bowstring.vertex_groups.new(name='nock')
for v in bowstring.data.vertices:
    f = max(0., 1 - abs(v.co.z - GRIP.z) / BOW_HALF)
    g_nock.add([v.index], f, 'REPLACE'); g_bow.add([v.index], 1 - f, 'REPLACE')
bowstring['weighted_body'] = True

# ---------------------------------------------------------------- bones (pre-scale)
bones = {
    'root': ((0, 0, 0), (0, 0, .30), None),
    'hips': ((0, 0, 2.420), (0, -.010, 2.720), 'root'),
    'spine': ((0, -.010, 2.720), (0, -.050, 3.080), 'hips'),
    'chest': ((0, -.050, 3.080), (0, -.045, 3.560), 'spine'),
    'head': ((0, -.040, 3.640), (0, -.055, 4.320), 'chest'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, -.14, 0))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, -.14, 0))), 'head'),
    'braid': ((.172, -.070, 4.056), (.258, -.258, 2.820), 'head'),
    'cloak': ((0, .180, 3.100), (0, .380, 1.700), 'chest'),
    'bow': (tuple(GRIP), tuple(GRIP + Vector((0, 0, .60))), 'hand.L'),
    'nock': (tuple(NOCK_WORLD), tuple(NOCK_WORLD + BOW_Y * .30), 'bow'),
    'arrow': (tuple(NOCK_WORLD), tuple(ARROW_TIP_WORLD), 'nock'),
}
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    bones[f'ear.{L}'] = (EAR_BASE[s], tuple(Vector(EAR_BASE[s]) + Vector(EAR_DIR[s]).normalized() * EAR_LENGTH), 'head')
    bones[f'upper_arm.{L}'] = (j['shoulder'], j['elbow'], 'chest')
    bones[f'forearm.{L}'] = (j['elbow'], j['wrist'], f'upper_arm.{L}')
    bones[f'hand.{L}'] = (j['wrist'], j['hand'], f'forearm.{L}')
    bones[f'thigh.{L}'] = (j['hip'], j['knee'], 'hips')
    bones[f'shin.{L}'] = (j['knee'], j['ankle'], f'thigh.{L}')
    bones[f'foot.{L}'] = (j['ankle'], j['foot'], f'shin.{L}')

weight_by(body, body_anchors, .055)

# ---------------------------------------------------------------- assemble one skinned mesh
for o in parts:
    activate(o)
    for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if not o.get('weighted_body'):
        group = o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
if FAST:
    budget = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in parts), reverse=True)
    for count, name in budget[:28]: print(f'TRIANGLES {count:7d} {name}')
    print(f'TRIANGLES {sum(c for c, _ in budget):7d} TOTAL')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Archer_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Normalize once from the measured sculpt so the runtime contract (feet at the
# origin plane, 1.80 units tall) holds no matter how the silhouette is retuned.
zs = [v.co.z for v in character.data.vertices]
FLOOR = min(zs); SCALE = TARGET_HEIGHT / (max(zs) - FLOOR)
def settle(co):
    return Vector((co[0] * SCALE, co[1] * SCALE, (co[2] - FLOOR) * SCALE))
for v in character.data.vertices: v.co = settle(v.co)
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural cloth, skin, hair, leather, wood, horn and metal into
    # three embedded 2K maps.  Nothing on a mortal hero is emissive or
    # transparent, so nothing needs keep_materials.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', prefix='archer')

rig_data = bpy.data.armatures.new('Archer_Skeleton')
rig = bpy.data.objects.new('Archer_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = settle(a); eb.tail = settle(b)
for name, (a, b, parent) in bones.items():
    if parent: rig_data.edit_bones[name].parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Archer skeleton', 'ARMATURE'); mod.object = rig
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
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    strip = tr.strips.new(name, 1, act); strip.name = name
    tr.mute = True
    rig.animation_data.action = None

def rot_q(b, q):
    # Express choreography in character axes rather than each diagonal bone's roll.
    basis = rig_data.bones[b].matrix_local.to_quaternion()
    rig.pose.bones[b].rotation_euler = (basis.inverted() @ q @ basis).to_euler()

def rot(b, x=0, y=0, z=0):
    rot_q(b, Quaternion((0, 0, 1), z) @ Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x))

def qaxis(axis, angle):
    return Quaternion(Vector(axis).normalized(), angle)

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
        eye.scale.y = 1 - .92 * closure
        eye.scale.z = 1 - .90 * closure

def blink(t, centers=(.28, .74)):
    close_eyes(max([max(0, 1 - abs(t - c) / .026) for c in centers] + [0]))

def ears(alert):
    # An attentive elven twitch rather than the imp's dramatic bat-ear flick.
    for s, L in ((-1, 'R'), (1, 'L')):
        rot(f'ear.{L}', .09 * alert, -s * .12 * alert, 0)

# The Attack rig: the bow bone swings the whole weapon from the carried cant into
# the shooting plane, the arrow bone swings level about the bow's own normal, and
# the nock bone drags the string's middle back into a V (the string is skinned
# across bow and nock, so the draw is real geometry, not a cheat).
ARROW_LEVEL = -math.radians(44)
DRAW = .620

def aim_weapon(raise_, draw, cant_extra=0.):
    rot_q('bow', qaxis((0, 0, 1), -BOW_CANT * raise_ + cant_extra) @ qaxis((1, 0, 0), -.10 * raise_))
    rot_q('arrow', qaxis(BOW_NORMAL, ARROW_LEVEL * raise_))
    rig.pose.bones['nock'].location.y = DRAW * max(0., draw)

def idle(t):
    # Slow breathing, an alert scan left then right, and a small re-grip that
    # settles the bow in the left hand.
    w = math.sin(t * math.tau)
    breath = math.sin(t * math.tau * 2)
    look = curve(t, [(0, 0), (.12, 0), (.28, .42), (.44, .42), (.58, -.08), (.72, -.38), (.88, -.38), (1, 0)])
    tilt = curve(t, [(0, 0), (.30, .05), (.64, -.04), (.88, 0), (1, 0)])
    grip = bump(t, .52, .13)
    rot('hips', .006 * breath)
    rot('spine', .012 * breath, 0, .010 * w)
    rot('chest', .018 * breath, 0, -.014 * w)
    rot('head', -.024 * breath + tilt, .04 * w, look)
    rot('braid', .05 * breath, 0, -.35 * look)
    rig.pose.bones['chest'].scale.y = 1 + .012 * breath
    rot('upper_arm.L', -.030 - .070 * grip, 0, -.020 - .030 * grip); rot('forearm.L', -.040 * grip)
    rot('hand.L', .10 * grip)
    rot('upper_arm.R', .018 * breath, 0, .014 * w); rot('forearm.R', -.05 * breath)
    rot('cloak', .020 * w, 0, .016 * breath)
    aim_weapon(0, 0, .06 * grip)
    ears(.35 + .65 * bump(t, .26, .09) + .65 * bump(t, .72, .09))
    blink(t, (.24, .70, .80))

def walk(t):
    # A light, quick elven stride; the bow arm stays comparatively still because
    # the left hand is occupied, so the right arm carries the swing.
    w = math.sin(t * math.tau)
    rig.pose.bones['root'].location.z = .014 * (1 - math.cos(t * math.tau * 2))
    rot('hips', 0, .030 * w, .050 * w)
    for L, s, swing in (('L', 1, .35), ('R', -1, 1.0)):
        stride = s * w
        rot('thigh.' + L, .58 * stride); rot('shin.' + L, -max(0, stride) * .80)
        rot('foot.' + L, -.18 * stride + max(0, stride) * .20)
        rot('upper_arm.' + L, -.30 * stride * swing, 0, s * .05)
        rot('forearm.' + L, -.10 - max(0, -stride) * .14 * swing)
    rot('spine', .020, 0, -.030 * w); rot('chest', .026, 0, -.040 * w)
    rot('head', -.030, 0, .022 * w)
    rot('braid', .16 * w, 0, .07 * w)
    rot('cloak', -.10 - .07 * w, 0, .09 * w)
    aim_weapon(0, 0, -.05 * w)
    ears(.45 + .25 * w)

def attack(t):
    # Raise the bow into the shooting plane, draw the string to the cheek, hold,
    # then loose with a recoil.  Every envelope returns to 0 by t=1 so the clip
    # still loops the way the game's blend expects.
    lift = curve(t, [(0, 0), (.24, 1), (.66, 1), (.78, .55), (.92, 0), (1, 0)])
    draw = curve(t, [(0, 0), (.14, .08), (.46, 1), (.62, 1), (.66, .05), (.74, -.06), (.88, 0), (1, 0)])
    loose = math.exp(-((t - .655) / .045) ** 2)
    aim_weapon(lift, draw, 0)
    rot('spine', 0, 0, -.06 * lift); rot('chest', .02 * lift, 0, -.12 * lift + .10 * loose)
    rot('head', -.04 * lift, .05 * lift, -.14 * lift + .12 * loose)
    rot('braid', -.10 * lift, 0, .12 * lift)
    # Bow arm out and level, elbow soft.
    rot('upper_arm.L', -1.28 * lift, 0, -.30 * lift + .10 * loose)
    rot('forearm.L', -.34 * lift, 0, .10 * lift); rot('hand.L', .16 * lift)
    # Draw hand back past the jaw, elbow high.
    rot('upper_arm.R', -.95 * lift - .18 * draw, 0, .55 * draw + .20 * lift)
    rot('forearm.R', -1.55 * draw, 0, .28 * draw); rot('hand.R', -.30 * draw)
    rot('thigh.L', .05 * lift); rot('thigh.R', -.05 * lift)
    rot('cloak', -.06 * lift, 0, -.10 * lift + .16 * loose)
    ears(.55 + .45 * lift)
    blink(t, (.70,))

def hit(t):
    # A sharp recoil: shoulders back, the bow arm thrown wide, ears flattened.
    w = curve(t, [(0, 0), (.14, 1), (.36, .55), (.70, -.10), (1, 0)])
    rot('spine', -.20 * w); rot('chest', -.30 * w, 0, .16 * w)
    rot('head', -.26 * w, 0, -.16 * w)
    rot('braid', -.28 * w, 0, .20 * w)
    rot('upper_arm.L', -.35 * w, 0, -.55 * w); rot('forearm.L', -.40 * w)
    rot('upper_arm.R', -.30 * w, 0, .50 * w); rot('forearm.R', -.55 * w)
    rot('thigh.L', .16 * w); rot('shin.L', -.22 * w)
    rot('cloak', -.16 * w)
    aim_weapon(0, 0, .22 * w)
    ears(1 - .9 * w)
    blink(t, (.16,))

def death(t):
    # The bow slips from the hand, the knees fold and the archer falls onto her
    # right side; the pose holds because Death plays once.
    drop = curve(t, [(0, 0), (.10, 0), (.34, 1), (1, 1)])
    fold = curve(t, [(0, 0), (.14, .10), (.52, .85), (.66, .82), (1, 1)])
    fall = curve(t, [(0, 0), (.34, .06), (.70, .80), (.88, 1), (1, 1)])
    rot('root', .10 * fall, -1.35 * fall, .30 * fall)
    rig.pose.bones['root'].location.z = -.16 * fold - .10 * fall
    rot('hips', .16 * fold); rot('spine', .22 * fold + .10 * fall); rot('chest', .26 * fold + .16 * fall)
    rot('head', .16 * fold + .34 * fall, 0, .18 * fall)
    rot('braid', -.30 * fall, 0, .25 * fall)
    rot('thigh.L', .55 * fold); rot('thigh.R', .48 * fold)
    rot('shin.L', -1.45 * fold); rot('shin.R', -1.35 * fold)
    rot('upper_arm.L', -.30 * fold - .30 * fall, 0, -.45 * fold)
    rot('forearm.L', -.35 * fold)
    rot('upper_arm.R', -.22 * fold + .25 * fall, 0, .45 * fold); rot('forearm.R', -.30 * fold)
    rot('cloak', .18 * fold + .30 * fall, 0, -.20 * fall)
    # The bow leaves the hand and clatters to the ground.
    bow_pose = rig.pose.bones['bow']
    bow_pose.location = (.10 * drop, -.42 * drop, .16 * drop)
    rot_q('bow', qaxis((0, 0, 1), -.55 * drop) @ qaxis((1, 0, 0), 1.35 * drop))
    rot_q('arrow', qaxis(BOW_NORMAL, ARROW_LEVEL * .35 * drop))
    ears(1 - fold)
    close_eyes(min(1, t * 2.6))

pose('Idle', 91, idle)          # 3.00 s -- breathing, scan, bow re-grip
pose('Walk', 26, walk)          # 0.83 s -- light stride loop
pose('Attack', 28, attack)      # 0.90 s -- raise, draw, hold, loose, recoil
pose('Hit', 16, hit)            # 0.50 s -- one-shot recoil
pose('Death', 46, death)        # 1.50 s -- drops the bow and falls to the side
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = ('Dungeon Keeper 2 elven archer: slender hooded elf in forest green, pointed ears through '
                    'the hood, auburn braid, tan leather jerkin with belt and pouches, laced bracers and tall '
                    'boots, a quiver of fletched arrows on the right shoulder and a strung longbow in the left hand.')
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = f'Feet at ground; {TARGET_HEIGHT} units tall; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'archer.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for tr in rig.animation_data.nla_tracks: tr.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'archer.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
        'bones': len(bones), 'materials': len(character.data.materials),
        'height': round(max(v.co.z for v in character.data.vertices) - min(v.co.z for v in character.data.vertices), 3),
        'animations': ['Idle', 'Walk', 'Attack', 'Hit', 'Death']}, indent=2) + '\n')

# ---------------------------------------------------------------- studio renders
floor = material('Studio floor', (.023, .028, .032), 0, .85)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.005))
bpy.context.object.name = 'Studio floor'; bpy.context.object.data.materials.append(floor)
def aim(o, point): o.rotation_euler = (Vector(point) - o.location).to_track_quat('-Z', 'Y').to_euler()
def area(name, loc, energy, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc); o = bpy.context.object; o.name = name
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, 1.05))
area('Warm key', (-3.0, -4.4, 5.0), 460, (1, .78, .53), 2.8)
area('Soft fill', (2.8, -2.8, 2.4), 150, (.65, .80, 1), 2.8)
# Restrained rim: too much of it turned the forest-green cloak into grey felt.
area('Cool rim', (-1.3, 2.6, 3.6), 230, (.38, .74, 1), 2.4)
bpy.ops.object.camera_add(location=(2.6, -6.8, 3.4)); cam = bpy.context.object
aim(cam, (-.02, 0, .94)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.10; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 48
scene.cycles.use_denoising = True
scene.world.color = (.07, .07, .07)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.frame_end = 91
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'archer.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'archer-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing on the hood shows the face, the ears and the braid.
cam.location = (1.5, -5.4, 2.20); aim(cam, (.02, -.06, 1.585)); cam.data.ortho_scale = .62
scene.render.filepath = str(PREVIEW / 'archer-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the upright stance, the bow, the quiver and the cloak drape.
cam.location = (6.4, -.5, 2.0); aim(cam, (0, -.02, .94)); cam.data.ortho_scale = 2.10
scene.render.filepath = str(PREVIEW / 'archer-side.png')
bpy.ops.render.render(write_still=True)
print('ARCHER_BUILD_COMPLETE', triangles, 'triangles')
