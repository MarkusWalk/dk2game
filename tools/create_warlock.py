"""Build the Dungeon Keeper 2 warlock with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_warlock.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
(The environment variable names are shared across every creature script so one
look-dev loop drives them all.)  The authored character faces -Y in Blender,
becoming +Z in Babylon's left-handed scene.

Design target: the DK2 warlock -- the bald, grey-bearded old sorcerer who reads
in the library and hurls fireballs.  A gaunt, stooped human about 1.85 units
tall wearing deep-purple robes with wide hanging sleeves and a layered hem that
puddles on the floor, a black hooded cape raised over his head, and a gold
mantle across the shoulders.  Inside the hood the face is fully visible: bald
skull, sunken cheeks, a hooked nose, thin lips, a long grey goatee and
pupil-less glowing violet eyes.  His right hand grips a gnarled staff whose gold
cage holds a glowing violet orb.  Everything is sculpted from overlapping
primitives that are voxel-remeshed into smooth continuous forms, or from
parametric cloth shells with real folds; nothing is left as a bare box or plane.
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
FAST = bool(os.environ.get('IMP_FAST') or os.environ.get('WARLOCK_FAST'))
PREVIEW = Path(os.environ.get('IMP_PREVIEW_DIR') or os.environ.get('WARLOCK_PREVIEW_DIR') or SOURCE)
TARGET_HEIGHT = 1.85  # units before the game's 0.98 warlock scale (see PIPELINE.md)
random.seed(41)
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

# Palette lifted from the procedural fallback in src/babylon/entities.js and
# converted to linear: clothPurple #4b285f, clothBlack #171922, heroSkin #d59a71
# (drained toward a bloodless old man), gold #d99b2b, wood #5d3822.
robe = material('Robe | deep purple wool', (.086, .026, .138), 0, .88)
robe_dark = material('Robe | shadowed underlayer', (.044, .013, .074), 0, .90)
cloak = material('Cape | black hooded wool', (.0125, .0135, .021), 0, .86)
skin = material('Skin | bloodless old man', (.42, .255, .190), 0, .62)
hair = material('Hair | iron grey', (.140, .132, .118), 0, .78)
gold = material('Mantle | soft gold', (.58, .275, .042), .85, .30)
brass = material('Cage | dark brass', (.36, .185, .046), .80, .38)
leather = material('Leather | oiled black', (.038, .022, .016), 0, .72)
leather_tan = material('Leather | worn spellbook', (.115, .052, .024), 0, .78)
parchment = material('Pages | old parchment', (.52, .44, .30), 0, .88)
wood = material('Staff | gnarled blackthorn', (.062, .035, .020), 0, .82)
rope = material('Belt | hemp rope', (.185, .140, .072), 0, .93)
horn = material('Nails | yellowed horn', (.20, .165, .120), 0, .44)
gem = material('Medallion | cut amethyst', (.115, .030, .240), .25, .14)
dark = material('Mouth and nostrils', (.012, .008, .010), 0, .70)
# The eyes and the staff orb are the only lit surfaces; they stay out of the
# baked atlas so KHR_materials_emissive_strength survives into Babylon.
eye_glow = material('Eyes | violet glow', (.30, .07, .90), 0, .22, 1.35, (.40, .09, 1))
orb_glow = material('Orb | violet glow', (.46, .20, .90), 0, .20, 3.0, (.58, .28, 1))
orb_core = material('Orb | white-hot core', (.90, .80, 1), 0, .18, 6.0, (.92, .82, 1))

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
    """Mottled old skin: liver spots, fine crepe wrinkling, a cooler back of the skull."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    blotch = nodes.new('ShaderNodeTexNoise'); blotch.inputs['Scale'].default_value = 26
    blotch.inputs['Detail'].default_value = 4; blotch.inputs['Roughness'].default_value = .62
    links.new(tex.outputs['Object'], blotch.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (*shadow, 1)
    ramp.color_ramp.elements[1].position = .68; ramp.color_ramp.elements[1].color = (*highlight, 1)
    mid = ramp.color_ramp.elements.new(.50); mid.color = (*base, 1)
    links.new(blotch.outputs['Fac'], ramp.inputs[0])
    # Front-to-back gradient: the face keeps its warmth, the crown cools off.
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    grad = nodes.new('ShaderNodeMapRange')
    grad.inputs['From Min'].default_value = -.30; grad.inputs['From Max'].default_value = .20
    grad.inputs['To Min'].default_value = 0; grad.inputs['To Max'].default_value = .45
    links.new(sep.outputs['Y'], grad.inputs['Value'])
    darken = nodes.new('ShaderNodeMix'); darken.data_type = 'RGBA'; darken.blend_type = 'MULTIPLY'
    darken.inputs[7].default_value = (.62, .56, .58, 1)
    links.new(grad.outputs[0], darken.inputs[0]); links.new(ramp.outputs['Color'], darken.inputs[6])
    links.new(darken.outputs[2], p.inputs['Base Color'])
    # Bump: crepey cell structure plus fine pores, baked to the tangent normal map.
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 74
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    cracks = nodes.new('ShaderNodeMapRange'); cracks.inputs['From Max'].default_value = .022
    links.new(vor.outputs['Distance'], cracks.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = 150
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .75
    links.new(cracks.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = .25
    links.new(pores.outputs['Fac'], m2.inputs[0]); links.new(m1.outputs[0], m2.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .26
    bmp.inputs['Distance'].default_value = .0025
    links.new(m2.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .55
    rough.inputs['To Max'].default_value = .74
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

# Keep shadow and highlight close to the base: an old man is blotchy, not piebald.
skin_shader(skin, (.400, .255, .205), (.325, .200, .162), (.455, .300, .245))
# Cloth reads as woven thread, stretched along the drape direction.
surface_detail(robe, 62, .0028, .16, (1, 1, 2.2), .40)
surface_detail(robe_dark, 62, .0028, .16, (1, 1, 2.2), .40)
surface_detail(cloak, 58, .0030, .30, (1, 1, 2.0), .42)
surface_detail(hair, 110, .0035, .28, (1, 1, .18), .70)
surface_detail(gold, 44, .0008, .12)
surface_detail(brass, 44, .0010, .14)
surface_detail(leather, 55, .0020, .22)
surface_detail(leather_tan, 48, .0022, .26)
surface_detail(parchment, 70, .0012, .14, (1, 1, 3))
surface_detail(wood, 16, .0045, .40, (8, 8, .35))
surface_detail(rope, 95, .0030, .30, (1, 1, .22), .60)
surface_detail(horn, 22, .0008, .16)
surface_detail(gem, 30, .0006, .10)

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

def track(x, stops):
    """Smoothstep through (x, value) control points; the profile authoring workhorse."""
    if x <= stops[0][0]: return stops[0][1]
    for (a, va), (b, vb) in zip(stops, stops[1:]):
        if x <= b:
            u = (x - a) / (b - a); u = u * u * (3 - 2 * u)
            return va + (vb - va) * u
    return stops[-1][1]

def catmull(points):
    """A C1 curve through control points, used to sweep sleeves and the staff."""
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

    Rigid one-bone binding is fine for props, but the body, the robe, the cape
    and the sleeves each span several bones; a nearest-anchor gaussian gives them
    a smooth falloff without hand-painting weights.
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

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
# The whole figure leans forward: hips at y 0, chest at -0.10, head at -0.36.
# The right arm is folded up to grip the staff; the left is angled forward as if
# steadying the robe, which keeps the hand clear of the hanging sleeve.
joints = {
    'L': dict(shoulder=(.40, .02, 3.52), elbow=(.50, -.06, 2.94), wrist=(.40, -.42, 2.60), hand=(.36, -.55, 2.50),
              hip=(.18, 0, 2.42), knee=(.20, -.04, 1.40), ankle=(.21, .02, .24), foot=(.21, -.30, .06)),
    'R': dict(shoulder=(-.40, .02, 3.52), elbow=(-.50, -.16, 2.95), wrist=(-.44, -.44, 2.66), hand=(-.50, -.52, 2.52),
              hip=(-.18, 0, 2.42), knee=(-.20, -.04, 1.40), ankle=(-.21, .02, .24), foot=(-.21, -.30, .06)),
}
EYE = {1: (.118, -.558, 4.052), -1: (-.118, -.558, 4.052)}
STAFF_GRIP = Vector((-.517, -.528, 2.52))

# ---------------------------------------------------------------- gaunt body sculpt
# Almost all of this ends up under cloth; it exists so the neck, wrists and
# ankles read as a real body and so the robe has something to be shaped around.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Pelvis', (0, 0, 2.42), (.245, .195, .200), bone='hips'))
B(ell('Lower spine', (0, -.02, 2.70), (.215, .175, .200), bone='spine'))
B(ell('Gaunt ribcage', (0, -.08, 3.08), (.265, .205, .270), bone='spine'))
B(ell('Upper chest', (0, -.13, 3.38), (.300, .190, .180), bone='chest'))
B(ell('Stooped upper back', (0, .10, 3.42), (.245, .175, .200), bone='chest'))
B(ell('Trapezius', (0, -.14, 3.50), (.225, .180, .115), bone='chest'))
B(ell('Thin neck', (0, -.22, 3.64), (.108, .108, .200), bone='chest'))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    B(ell('Clavicle', (s * .24, -.16, 3.50), (.155, .115, .085), bone='chest'))
    B(ell('Deltoid', (s * .40, -.02, 3.47), (.125, .135, .135), bone=f'upper_arm.{L}'))
    B(limb('Upper arm', j['shoulder'], j['elbow'], .078, f'upper_arm.{L}', ry=.082))
    B(ell('Elbow', j['elbow'], (.084, .086, .084), bone=f'forearm.{L}'))
    B(limb('Forearm', j['elbow'], j['wrist'], .070, f'forearm.{L}', ry=.074))
    B(ell('Wrist', j['wrist'], (.058, .058, .052), bone=f'forearm.{L}'))
    B(limb('Thigh', j['hip'], j['knee'], .130, f'thigh.{L}', ry=.140))
    B(ell('Knee', j['knee'], (.105, .110, .105), bone=f'shin.{L}'))
    B(limb('Calf', j['knee'], j['ankle'], .098, f'shin.{L}', ry=.104))
    B(ell('Ankle', j['ankle'], (.072, .072, .072), bone=f'shin.{L}'))
body_anchors = sample_parts(body_parts)
body = union('Continuous body sculpt', body_parts, .030, .16)

# ---------------------------------------------------------------- head sculpt
# A bald, gaunt old man: high domed cranium, deep-set eyes under a heavy brow,
# hollow temples and cheeks, a long hooked nose and a narrow jaw.
head_parts = []
def H(o): head_parts.append(o); return o
H(ell('Cranium', (0, -.34, 4.18), (.290, .310, .300), bone='head'))
H(ell('Bald crown', (0, -.32, 4.32), (.215, .240, .155), bone='head'))
H(ell('Occiput', (0, -.19, 4.09), (.265, .250, .265), bone='head'))
H(ell('High forehead', (0, -.50, 4.20), (.235, .155, .180), bone='head'))
H(ell('Neck root', (0, -.22, 3.68), (.115, .115, .150), bone='head'))
H(ell('Narrow jaw', (0, -.440, 3.850), (.168, .196, .112), bone='head'))
H(ell('Upper lip mass', (0, -.578, 3.922), (.100, .076, .062), bone='head'))
H(ell('Pointed chin', (0, -.588, 3.808), (.066, .062, .060), bone='head'))
H(ell('Nose bridge', (0, -.586, 4.102), (.028, .078, .092), bone='head'))
H(ell('Nose ridge', (0, -.646, 4.026), (.026, .066, .064), bone='head'))
# The hook: a thin bridge whose tip pushes forward and hangs below the nostrils.
H(ell('Hooked tip', (0, -.726, 3.950), (.028, .052, .042), bone='head'))
H(ell('Hook underside', (0, -.700, 3.916), (.026, .038, .022), bone='head'))
H(ell('Glabella knot', (0, -.575, 4.145), (.055, .050, .050), bone='head'))
for s in (-1, 1):
    # Hollow temples: deliberately small so the brow and cheekbone read by contrast.
    H(ell('Hollow temple', (s * .200, -.410, 4.150), (.085, .190, .175), bone='head'))
    H(ell('Cheekbone', (s * .168, -.514, 3.986), (.076, .110, .054), bone='head'))
    # Deliberately undersized and set back: the hollow is the gap it leaves.
    H(ell('Sunken cheek', (s * .118, -.442, 3.882), (.038, .068, .052), bone='head'))
    H(ell('Jaw angle', (s * .148, -.348, 3.886), (.068, .118, .082), bone='head'))
    H(ell('Nostril wing', (s * .040, -.626, 3.944), (.030, .038, .030), bone='head'))
    H(ell('Heavy brow', (s * .120, -.585, 4.148), (.135, .062, .045), bone='head', rot=(.22, -s * .20, 0)))
    H(ell('Upper lid', (s * .118, -.572, 4.100), (.080, .044, .030), bone='head', rot=(0, -s * .16, 0)))
    H(ell('Lower lid', (s * .120, -.574, 3.998), (.074, .040, .019), bone='head', rot=(0, -s * .08, 0)))
    H(ell('Ear', (s * .285, -.300, 4.010), (.038, .070, .100), bone='head', rot=(0, -s * .18, 0)))
    H(ell('Ear lobe', (s * .285, -.300, 3.930), (.030, .045, .038), bone='head'))
head_obj = union('Head sculpt pass 1', head_parts, .014, 1.0, smoothing=1, bone='head')

# Second pass: thin lips, the deep wrinkles of a very old man and the ear rim are
# seated on the first sculpt, then welded in by a second remesh.
def lip_line(x):
    # A slight downturn at the corners: the sorcerer is not amused.
    return 3.866 + .042 * (x / .092) ** 2
lip_x = [-.092 + .184 * i / 10 for i in range(11)]
refine = [head_obj]
refine.append(tube('Thin upper lip', conformed([(x, -.60, lip_line(x) + .014) for x in lip_x], head_obj, .008),
                   .016, skin, 'head', lambda t: .55 + .45 * math.sin(math.pi * t)))
refine.append(tube('Thin lower lip', conformed([(x, -.60, lip_line(x) - .022) for x in lip_x], head_obj, .010),
                   .019, skin, 'head', lambda t: .55 + .45 * math.sin(math.pi * t)))
for z in (4.245, 4.300, 4.352):
    fold = conformed([(x, -.62, z + .014 * math.cos(x * 9)) for x in (-.16, -.08, 0, .08, .16)], head_obj, -.004)
    refine.append(tube('Forehead furrow', fold, .012, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
for s in (-1, 1):
    # Nasolabial fold: the crease that makes hollow cheeks read on an old face.
    crease = conformed([(s * .075, -.640, 3.985), (s * .140, -.575, 3.920), (s * .165, -.520, 3.850), (s * .160, -.480, 3.808)], head_obj, -.002)
    refine.append(tube('Nasolabial fold', crease, .015, skin, 'head', lambda t: math.sin(math.pi * t) ** .5))
    crow = conformed([(s * .200, -.545, 4.070), (s * .245, -.520, 4.040), (s * .265, -.490, 4.005)], head_obj, -.003)
    refine.append(tube('Crow foot', crow, .010, skin, 'head', lambda t: math.sin(math.pi * t) ** .6))
    hollow = conformed([(s * .225, -.470, 4.060), (s * .215, -.500, 3.965), (s * .185, -.480, 3.895)], head_obj, -.006)
    refine.append(tube('Temple hollow edge', hollow, .014, skin, 'head', lambda t: math.sin(math.pi * t) ** .5))
    rim = [(s * .268, -.360, 4.070), (s * .300, -.320, 4.045), (s * .305, -.280, 3.995), (s * .295, -.272, 3.935), (s * .272, -.300, 3.905)]
    refine.append(tube('Ear helix', rim, .017, skin, 'head', lambda t: .8 + .3 * math.sin(math.pi * t)))
head_obj = union('Head sculpt', refine, .013, .42, smoothing=1, bone='head')

# Features seated on the final surface.
strip_up = conformed([(x, -.60, lip_line(x) + .004) for x in lip_x], head_obj, .003)
strip_low = conformed([(x, -.60, lip_line(x) - .010) for x in lip_x], head_obj, .003)
mouth = mesh('Mouth line', strip_up + strip_low, [(i, i + 1, 11 + i + 1, 11 + i) for i in range(10)], dark, 'head')
smooth(mouth)
for s in (-1, 1):
    patch('Nostril', (s * .029, -.664, 3.918), (.021, .009, .015), dark, 'head', head_obj, .002)
    # Pupil-less violet glows, as in the DK2 portrait; a hot core keeps them from reading flat.
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ex, ey, ez = EYE[s]
    # A dark socket shell behind the glow so the violet reads instead of washing into skin.
    ell('Eye socket', (ex, ey + .026, ez), (.086, .076, .080), dark, eye_bone, 2)
    ell('Glowing eye', (ex, ey, ez), (.070, .064, .066), eye_glow, eye_bone, 3)
    # Thin grey brow tufts: a bald sorcerer with no eyebrows at all reads as a corpse.
    brow = conformed([(s * .038, -.610, 4.150), (s * .108, -.600, 4.162), (s * .176, -.560, 4.146)], head_obj, .014)
    tube('Brow tuft', brow, .017, hair, 'head', lambda t: .5 + .8 * math.sin(math.pi * t), res=2, segments=4)

# ---------------------------------------------------------------- long grey goatee
# Moustache plus a tapering goatee that hangs a third of the way down the chest.
beard_parts = []
def G(o): beard_parts.append(o); return o
for s in (-1, 1):
    # The moustache clears the lip line at 3.868 so the thin mouth still reads.
    G(tube('Drooping moustache', [(s * .016, -.652, 3.922), (s * .076, -.634, 3.906), (s * .124, -.590, 3.872), (s * .136, -.552, 3.822)],
           .036, hair, 'beard', lambda t: 1.0 - .28 * t))
    # Jaw-line whiskers tie the goatee to the face instead of hanging off the chin.
    G(ell('Jaw whiskers', (s * .145, -.452, 3.796), (.052, .086, .068), hair, 'beard'))
G(ell('Chin tuft', (0, -.556, 3.742), (.118, .100, .086), hair, 'beard'))
G(ell('Beard upper', (0, -.548, 3.640), (.130, .108, .104), hair, 'beard'))
G(ell('Beard mid', (0, -.536, 3.516), (.114, .100, .106), hair, 'beard'))
G(ell('Beard lower', (0, -.524, 3.392), (.092, .086, .102), hair, 'beard'))
G(ell('Beard taper', (0, -.514, 3.272), (.064, .068, .096), hair, 'beard'))
G(ell('Beard tip', (0, -.506, 3.160), (.034, .040, .078), hair, 'beard'))
beard = union('Goatee sculpt', beard_parts, .014, 1.0, hair, 1, 'beard')
strands = [beard]
for k in range(7):
    x0 = -.058 + .019 * k
    path = conformed([(x0, -.60, 3.73), (x0 * 1.15, -.60, 3.56), (x0 * 1.1, -.60, 3.38), (x0 * .8, -.60, 3.22)], beard, -.005)
    strands.append(tube('Beard strand', path, .012, hair, 'beard', lambda t: .9 + .3 * math.sin(math.pi * t), res=1, segments=4))
beard = union('Goatee', strands, .013, .50, hair, 1, 'beard')

# ---------------------------------------------------------------- thin bony hands
def nail(name, tip, direction, bone):
    d = Vector(direction).normalized()
    rod(name, Vector(tip) - d * .012, Vector(tip) + d * .020, .015, .009, horn, bone, 8)

def right_hand():
    """Long fingers wrapped around the staff shaft, thumb crossing over the top."""
    bone = 'hand.R'; pieces = []
    j = joints['R']
    pieces.append(ell('Wrist', j['wrist'], (.056, .056, .050), skin, bone))
    pieces.append(ell('Palm', (-.442, -.520, 2.560), (.052, .078, .105), skin, bone))
    pieces.append(ell('Knuckle ridge', (-.455, -.545, 2.460), (.048, .075, .060), skin, bone))
    for i in range(4):
        z = 2.430 + .072 * i
        path = [(-.418, -.492, z), (-.442, -.612, z + .004), (-.540, -.646, z), (-.612, -.578, z - .004), (-.606, -.492, z)]
        pieces.append(tube('Gripping finger', path, .027, skin, bone, lambda t: 1.05 - .22 * t))
        pieces.append(ell('Knuckle', path[1], (.031, .031, .031), skin, bone, 2))
    pieces.append(tube('Thumb', [(-.430, -.560, 2.660), (-.470, -.618, 2.640), (-.548, -.610, 2.600)], .030, skin, bone, lambda t: 1.1 - .25 * t))
    pieces.append(ell('Thumb tip', (-.548, -.610, 2.600), (.028, .028, .028), skin, bone, 2))
    union('Right hand sculpt', pieces, .011, .42, skin, 1, bone)
    nail('Thumb nail', (-.566, -.608, 2.592), (-1, 0, -.3), bone)

def left_hand():
    """Open and slightly cupped, long bony fingers spread as if resting on the robe."""
    bone = 'hand.L'; pieces = []
    j = joints['L']
    pieces.append(ell('Wrist', j['wrist'], (.056, .056, .050), skin, bone))
    pieces.append(ell('Palm', (.392, -.512, 2.520), (.062, .085, .090), skin, bone))
    pieces.append(ell('Thenar pad', (.430, -.480, 2.500), (.042, .060, .062), skin, bone))
    tips = []
    for i in range(4):
        x = .330 + .046 * i
        drop = (.0, .018, .012, -.008)[i]
        path = [(x, -.556, 2.470), (x - .008, -.618, 2.424 - drop), (x - .016, -.652, 2.372 - drop), (x - .026, -.646, 2.334 - drop)]
        pieces.append(tube('Long finger', path, .024, skin, bone, lambda t: 1.05 - .30 * t))
        pieces.append(ell('Knuckle', path[0], (.028, .028, .028), skin, bone, 2))
        tips.append((path[-1], (0, -.35, -1)))
    pieces.append(tube('Thumb', [(.428, -.500, 2.492), (.462, -.566, 2.446), (.452, -.616, 2.398)], .029, skin, bone, lambda t: 1.1 - .28 * t))
    tips.append(((.452, -.616, 2.398), (-.2, -.6, -1)))
    union('Left hand sculpt', pieces, .011, .42, skin, 1, bone)
    for k, (tip, d) in enumerate(tips):
        nail(f'Finger nail {k}', tip, d, bone)
right_hand(); left_hand()

# ---------------------------------------------------------------- pointed leather shoes
for s, L in ((-1, 'R'), (1, 'L')):
    pieces = [
        ell('Shoe body', (s * .21, -.22, .085), (.088, .150, .085), leather, f'foot.{L}'),
        ell('Shoe heel', (s * .21, -.03, .075), (.078, .080, .075), leather, f'foot.{L}'),
        ell('Shoe instep', (s * .21, -.14, .130), (.075, .105, .060), leather, f'foot.{L}'),
        # A long curled point: the medieval poulaine the DK2 casters wear.
        ell('Shoe point', (s * .205, -.400, .075), (.045, .090, .050), leather, f'foot.{L}'),
        ell('Curled toe', (s * .200, -.480, .095), (.026, .045, .035), leather, f'foot.{L}'),
    ]
    union(f'Pointed shoe {L}', pieces, .012, .30, leather, 2, f'foot.{L}')

# ---------------------------------------------------------------- purple robe: remeshed torso plus cloth skirt
robe_parts = []
def R(o): robe_parts.append(o); return o
for s, L in ((-1, 'R'), (1, 'L')):
    R(ell('Robe shoulder', (s * .365, -.045, 3.450), (.190, .220, .160), robe, 'chest'))
R(ell('Robe upper chest', (0, -.135, 3.360), (.375, .265, .225), robe, 'chest'))
R(ell('Robe stooped back', (0, .095, 3.375), (.325, .235, .235), robe, 'chest'))
R(ell('Robe ribcage', (0, -.075, 3.140), (.360, .275, .230), robe, 'spine'))
R(ell('Robe midriff', (0, -.055, 2.900), (.370, .290, .250), robe, 'spine'))
R(ell('Robe waist', (0, -.040, 2.660), (.360, .295, .250), robe, 'spine'))
R(ell('Robe hip flare', (0, -.020, 2.420), (.435, .360, .250), robe, 'hips'))
R(ell('Robe skirt shoulder', (0, -.005, 2.220), (.490, .420, .215), robe, 'hips'))
R(ell('Robe skirt start', (0, .005, 2.060), (.530, .455, .190), robe, 'hips'))
robe_anchors = sample_parts(robe_parts)
robe_obj = union('Robe torso pass 1', robe_parts, .026, 1.0, robe, 1)
# Creases seated on the torso and welded in by a second remesh: cloth that has
# been worn, not a smooth cone.
creases = [robe_obj]
for k in range(9):
    a = -2.55 + k * (5.10 / 8) + .12 * math.sin(k * 2.3)
    amp = .34 + .10 * math.sin(k * 1.7)
    path = conformed([(math.sin(a) * .40, -math.cos(a) * amp, z) for z in (3.36, 3.12, 2.86, 2.60, 2.34, 2.12)], robe_obj, -.010)
    creases.append(tube('Robe crease', path, .026, robe, 'chest', lambda t: .5 + .8 * math.sin(math.pi * t) ** .7, res=1, segments=4))
for s in (-1, 1):
    # Shoulder-to-waist drape lines pulled by the mantle above.
    path = conformed([(s * .30, -.22, 3.42), (s * .26, -.26, 3.16), (s * .20, -.24, 2.88)], robe_obj, -.005)
    creases.append(tube('Shoulder drape', path, .017, robe, 'chest', lambda t: math.sin(math.pi * t) ** .5, res=1, segments=4))
robe_obj = union('Robe torso', creases, .024, .28, robe, 1)
weight_by(robe_obj, robe_anchors, .062)

placket = conformed([(0, -.42, z) for z in (3.34, 3.16, 2.98, 2.80, 2.64)], robe_obj, .012)
ribbon('Robe placket', placket, .120, robe_dark, 'chest', robe_obj, .010, .014)
for pt in conformed([(0, -.42, 3.29 - k * .155) for k in range(5)], robe_obj, .030):
    patch('Robe button', pt, (.024, .014, .024), gold, 'chest', robe_obj, .030)

# The skirt is a parametric cloth tube whose top tucks up inside the torso
# volume, so there is no seam.  Its radius carries nine soft vertical folds that
# deepen toward the hem, and the hem itself puddles on the floor except at the
# front, where it lifts to show the pointed shoes.
SKIRT_TOP = 2.34
def skirt_P(u, v):
    th = 2 * math.pi * v
    forward = math.cos(th)                       # +1 at the front (-Y)
    hem = .055 + .195 * max(0, forward) ** 2.4 - .032 * math.cos(9 * th + 1.1)
    z = SKIRT_TOP - (SKIRT_TOP - hem) * u
    r = .430 + .360 * u ** 1.20
    r *= 1 + .062 * u ** 1.35 * math.cos(9 * th + 1.1) + .022 * u ** 1.7 * math.cos(15 * th + 2.0)
    cy = -.02 + .075 * u
    return Vector((r * math.sin(th), cy - r * .86 * math.cos(th), z))
skirt = sheet('Robe skirt', skirt_P, 20, 64, .020, robe, 'hips', cyclic_v=True)
skirt_anchors = [(skirt_P(i / 6, j / 8), 'spine' if i <= 1 else 'hips') for i in range(7) for j in range(8)]
weight_by(skirt, skirt_anchors, .14, 2, 10)

# A second, shorter layer over the skirt gives the hem the layered look the DK2
# robe has, and hides the join between the remeshed torso and the cloth tube.
def tier_P(u, v):
    th = 2 * math.pi * v
    hem = 1.48 - .105 * math.cos(7 * th + .4)          # scallops hang from the fold ridges
    z = 2.28 - (2.28 - hem) * u
    r = .445 + .155 * u ** 1.05
    r *= 1 + .055 * u ** 1.2 * math.cos(7 * th + .4)
    return Vector((r * math.sin(th), -.015 + .02 * u - r * .86 * math.cos(th), z))
tier = sheet('Robe over tier', tier_P, 12, 56, .018, robe_dark, 'hips', cyclic_v=True)
tier_anchors = [(tier_P(i / 5, j / 8), 'spine' if i == 0 else 'hips') for i in range(6) for j in range(8)]
weight_by(tier, tier_anchors, .14, 2, 10)
# Dark trim piping along both hems.
tube('Skirt hem trim', [skirt_P(1, j / 26) for j in range(26)], .017, robe_dark, 'hips', cyclic=True, res=1, segments=3)

# ---------------------------------------------------------------- wide hanging sleeves
def make_sleeve(L):
    s = 1 if L == 'L' else -1
    j = joints[L]
    path = catmull([(s * .36, .02, 3.545), (s * .47, -.03, 3.24), (s * .515, -.12, 2.99),
                    (s * .49, -.30, 2.80), (s * .455, -.40, 2.70)])
    def radius(u, th):
        base = track(u, [(0, .180), (.35, .230), (.62, .295), (.85, .350), (1, .372)])
        return base * (1 + .075 * math.cos(5 * th + 1.2) * u + .04 * math.cos(9 * th))
    base_P = sweep(path, radius)
    def P(u, v):
        p = base_P(u, v)
        # The rear half of the mouth hangs far below the arm: that long diagonal
        # drape is what makes a sorcerer's sleeve read as a sleeve.
        th = 2 * math.pi * v
        back = max(0, math.cos(th - (0 if s > 0 else math.pi)))
        drop = .50 * back ** 1.2 * max(0, (u - .58) / .42) ** 1.5
        wave = .055 * math.sin(4 * th + .6) * max(0, (u - .62) / .38) ** 1.2
        return p - Vector((0, 0, drop + wave))
    o = sheet(f'Hanging sleeve {L}', P, 20, 34, .019, robe, f'forearm.{L}', cyclic_v=True)
    anchors = [(P(i / 5, k / 6), f'upper_arm.{L}' if i <= 1 else f'forearm.{L}') for i in range(6) for k in range(6)]
    weight_by(o, anchors, .13, 2, 10)
    # A darker cuff band around the mouth of the sleeve.
    tube(f'Sleeve cuff {L}', [base_P(.90, k / 16) for k in range(16)], .022, robe_dark, f'forearm.{L}', cyclic=True, res=1, segments=3)
make_sleeve('L'); make_sleeve('R')

# ---------------------------------------------------------------- black hooded cape
# One continuous shell from the cape hem, over the shoulders, around the neck and
# up over the raised hood.  The front opening is a single parameter: wide at the
# chest where the cape parts, narrowing to a slit above the brow.
HOOD = [
    #  z     radius  front gap   centre y
    (3.02,   .735,   1.06,  .045),
    (3.20,   .690,    .96,  .010),
    (3.36,   .625,    .82, -.045),
    (3.50,   .570,    .62, -.115),
    (3.63,   .470,    .56, -.185),
    (3.76,   .430,    .60, -.255),
    (3.90,   .415,    .63, -.312),
    (4.02,   .408,    .62, -.345),
    (4.14,   .398,    .54, -.352),
    (4.24,   .372,    .36, -.352),
    (4.34,   .328,    .15, -.348),
    (4.44,   .282,    .06, -.342),
    (4.53,   .205,    .04, -.334),
    (4.58,   .128,    .03, -.328),
    (4.62,   .004,    .02, -.322),
]
HOOD_Z = [row[0] for row in HOOD]
def hood_z(u):
    # Bias rows toward the head so the face opening stays crisp.
    return HOOD_Z[0] + (HOOD_Z[-1] - HOOD_Z[0]) * u ** .78
def hood_u(z):
    return max(0, min(1, ((z - HOOD_Z[0]) / (HOOD_Z[-1] - HOOD_Z[0])) ** (1 / .78)))
def hood_P(u, v):
    z = hood_z(u)
    r = track(z, [(a, b) for a, b, _, _ in HOOD])
    gap = track(z, [(a, c) for a, _, c, _ in HOOD])
    cy = track(z, [(a, d) for a, _, _, d in HOOD])
    a = math.pi - gap
    th = -a + 2 * a * v                                   # 0 is the back of the hood
    fold = max(0, (3.52 - z) / .50)                       # folds only on the cape, not the skull
    hooded = max(0, min(1, (z - 3.60) / .35))             # the cowl is a little fuller behind the skull
    r *= (1 + .085 * fold ** 1.3 * math.cos(7 * th + .5) + .030 * hooded * max(0, math.cos(th))
          + .045 * hooded * math.exp(-(th / .55) ** 2))   # a soft ridge down the back of the cowl
    hem = max(0, (3.32 - z) / .30)                        # a scalloped edge reads as cloth, not hair
    dz = .050 * fold ** 1.6 * math.sin(5 * th + 1.1) + .085 * hem ** 1.5 * (.5 - .5 * math.cos(6 * th))
    squash = track(z, [(3.02, .76), (3.55, .82), (3.90, .93), (4.60, .96)])
    return Vector((r * math.sin(th), cy + r * squash * math.cos(th), z - dz))
cape = sheet('Hooded cape', hood_P, 30, 46, .018, cloak, 'chest')
cape_anchors = []
for i in range(11):
    u = i / 10; z = hood_z(u)
    bone = 'head' if z > 3.86 else 'chest'
    for k in range(9): cape_anchors.append((hood_P(u, k / 8), bone))
weight_by(cape, cape_anchors, .12, 2, 12)
# Gold cord around the whole opening -- face rim and cape hem -- so the black
# shape reads as a bordered garment rather than a fall of hair.
for edge in (0.0, 1.0):
    pts = [hood_P(u, edge) for u in (0.0, 0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.94, 1.0)]
    tube('Hood rim cord', pts, .015, gold, 'head', lambda t: .60 + .55 * t, res=1, segments=4)
tube('Cape hem cord', [hood_P(0, k / 21) for k in range(22)], .015, gold, 'chest', lambda t: 1, res=1, segments=3)

# ---------------------------------------------------------------- gold mantle and chain collar
def collar_ring(z, r, cy, steps=20):
    return [(r * math.sin(2 * math.pi * i / steps), cy + r * math.cos(2 * math.pi * i / steps) * .82, z) for i in range(steps)]
def hood_offset(u, v, d):
    """A point pushed radially off the cape shell, for anything worn over it."""
    p = hood_P(u, v); z = hood_z(u)
    cy = track(z, [(a, dd) for a, _, _, dd in HOOD])
    radial = Vector((p.x, p.y - cy, 0))
    return p + radial.normalized() * d if radial.length > 1e-6 else p
def mantle_point(v, d):
    frac = abs(v - .5) * 2                                # 0 behind the neck, 1 at the front edges
    return hood_offset(hood_u(3.62 - .34 * frac ** 1.25), v, d)
tube('Gold mantle band', [mantle_point(k / 23, .034) for k in range(24)], .036, gold, 'chest', lambda t: 1, res=2, segments=3)
for k in range(9):
    patch('Mantle stud', mantle_point(.06 + k * .11, .080), (.030, .017, .030), gold, 'chest', cape, .012)
# A short chain swag across the chest with a cut amethyst medallion, hanging
# below the cape hem so it stays visible from the front.
chain = [(-.34, -.28, 3.290), (-.18, -.36, 3.190), (0, -.385, 3.150), (.18, -.36, 3.190), (.34, -.28, 3.290)]
tube('Collar chain', chain, .016, gold, 'chest', lambda t: 1, res=1, segments=5)
for k in range(7):
    t = k / 6
    c = Vector(chain[0]).lerp(Vector(chain[-1]), t); c.y = -.28 - .105 * math.sin(math.pi * t); c.z = 3.290 - .140 * math.sin(math.pi * t)
    link = [(c.x + .030 * math.cos(2 * math.pi * i / 8), c.y + .012 * math.sin(2 * math.pi * i / 8), c.z + .030 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
    tube('Chain link', link, .009, gold, 'chest', cyclic=True, res=1, segments=4)
medallion = union('Medallion', [
    ell('Medallion bezel', (0, -.400, 3.115), (.062, .028, .062), gold, 'chest'),
    ell('Medallion rim', (0, -.390, 3.115), (.072, .018, .072), gold, 'chest'),
], .010, .7, gold, 1, 'chest')
ell('Amethyst', (0, -.430, 3.115), (.036, .022, .036), gem, 'chest', 2)

# ---------------------------------------------------------------- rope belt, spellbook and pouches
belt_ring = conformed([( .40 * math.sin(2 * math.pi * i / 22), -.02 + .34 * math.cos(2 * math.pi * i / 22), 2.615) for i in range(22)], robe_obj, .030)
tube('Rope belt', belt_ring, .036, rope, 'spine', cyclic=True, res=2, segments=4)
tube('Rope belt twist', [p + Vector((0, 0, .026 * math.sin(i * 1.6))) for i, p in enumerate(belt_ring)], .019, rope, 'spine', cyclic=True, res=1, segments=3)
knot = union('Belt knot', [
    ell('Knot core', (.13, -.365, 2.605), (.052, .048, .046), rope, 'spine'),
    ell('Knot loop', (.16, -.352, 2.640), (.036, .036, .030), rope, 'spine'),
], .010, .7, rope, 1, 'spine')
for k, (x, drop) in enumerate(((.095, 2.14), (.175, 2.26))):
    tube('Belt tail', [(x, -.372, 2.585), (x + .012, -.392, 2.44), (x - .006, -.386, 2.30), (x + .004, -.394, drop)],
         .017, rope, 'hips', lambda t: 1.05 - .35 * t, res=1, segments=5)
    ell('Belt tail knot', (x + .004, -.394, drop), (.026, .026, .026), rope, 'hips', 2)

# The spellbook hangs from the belt on his left hip, which keeps the DK2
# librarian read without the fallback's floating book.
book_rot = (0, -.22, .30)
book = union('Hanging spellbook', [
    block('Book cover', (.300, -.372, 2.135), (.190, .045, .250), leather_tan, 'hips', .012, book_rot),
    block('Book back', (.300, -.306, 2.135), (.190, .040, .250), leather_tan, 'hips', .012, book_rot),
    block('Book pages', (.300, -.339, 2.128), (.170, .075, .230), parchment, 'hips', .006, book_rot),
    ell('Book spine', (.256, -.338, 2.135), (.030, .062, .126), leather_tan, 'hips', 3, book_rot),
], .009, .40, leather_tan, 1, 'hips')
ell('Book page block', (.338, -.339, 2.128), (.022, .070, .218), parchment, 'hips', 3, book_rot)
tube('Book strap', [(.300, -.352, 2.575), (.300, -.372, 2.420), (.300, -.376, 2.300)], .018, leather, 'hips', lambda t: 1, res=1, segments=4)
tube('Book clasp', [(.348, -.396, 2.152), (.348, -.306, 2.152)], .012, gold, 'hips', lambda t: 1, res=1, segments=3)
for k, (x, y, z, size) in enumerate(((-.315, -.290, 2.395, .062), (-.245, -.360, 2.360, .048))):
    pouch = union(f'Belt pouch {k}', [
        ell('Pouch body', (x, y, z), (size, size * .78, size * 1.15), leather, 'hips'),
        ell('Pouch base', (x, y, z - size * .75), (size * .86, size * .70, size * .55), leather, 'hips'),
        ell('Pouch mouth', (x, y, z + size * .95), (size * .70, size * .58, size * .34), leather, 'hips'),
    ], .010, .55, leather, 2, 'hips')
    tube('Pouch drawstring', [(x - size, y, z + size * .9), (x, y - size * .78, z + size * .95), (x + size, y, z + size * .9)],
         .009, rope, 'hips', cyclic=True, res=1, segments=4)
    tube('Pouch hanger', [(x, y + .02, 2.600), (x, y + .01, z + size * 1.05)], .010, leather, 'hips', lambda t: 1, res=1, segments=3)

# ---------------------------------------------------------------- gnarled staff, gold cage and violet orb
STAFF_A = Vector((-.545, -.400, 0))
STAFF_B = Vector((-.500, -.622, 4.320))
staff_path = catmull([STAFF_A, (-.556, -.428, .90), (-.520, -.470, 1.80), (-.548, -.512, 2.70), (-.508, -.566, 3.55), STAFF_B])
staff_pts = [staff_path(i / 15) for i in range(16)]
staff_pieces = [tube('Staff shaft', staff_pts, .048, wood, 'staff', lambda t: 1.20 - .40 * t, res=2, segments=4)]
# Burls and old branch stubs welded into the shaft make it gnarled rather than a dowel.
for k, (t, size) in enumerate(((.14, .036), (.31, .030), (.47, .034), (.62, .028), (.78, .030), (.90, .026))):
    c = staff_path(t)
    a = k * 2.4
    staff_pieces.append(ell('Staff burl', c + Vector((math.sin(a) * .030, math.cos(a) * .030, 0)), (size * 1.5, size * 1.5, size), wood, 'staff', 2))
    if k % 2 == 0:
        stub = c + Vector((math.sin(a + 1.2) * .085, math.cos(a + 1.2) * .085, .035))
        staff_pieces.append(rod('Branch stub', c, stub, .026, .012, wood, 'staff', 8))
staff = union('Gnarled staff', staff_pieces, .013, .26, wood, 1, 'staff')
ORB = Vector((-.497, -.640, 4.455))
# Four gold ribs curve up from a collar to a finial, caging the orb.
for k in range(4):
    a = math.pi / 4 + k * math.pi / 2
    off = Vector((math.cos(a), math.sin(a), 0))
    rib = [ORB + Vector((0, 0, -.185)), ORB + off * .115 + Vector((0, 0, -.105)), ORB + off * .150,
           ORB + off * .105 + Vector((0, 0, .110)), ORB + Vector((0, 0, .175))]
    tube('Cage rib', rib, .017, brass, 'staff', lambda t: 1.15 - .35 * abs(t - .5) * 2, res=2, segments=6)
tube('Cage collar', [ORB + Vector((.072 * math.cos(2 * math.pi * i / 16), .072 * math.sin(2 * math.pi * i / 16), -.175)) for i in range(16)],
     .022, gold, 'staff', cyclic=True, res=2, segments=4)
tube('Cage equator', [ORB + Vector((.152 * math.cos(2 * math.pi * i / 20), .152 * math.sin(2 * math.pi * i / 20), .002)) for i in range(20)],
     .013, brass, 'staff', cyclic=True, res=2, segments=4)
ell('Cage finial', ORB + Vector((0, 0, .195)), (.036, .036, .052), gold, 'staff', 2)
ell('Staff ferrule', STAFF_A + Vector((.004, -.004, .050)), (.052, .052, .075), brass, 'staff', 3)
# The orb itself: the only other lit surface on the model.
ell('Violet orb', ORB, (.118, .118, .118), orb_glow, 'orb', 3)
ell('Orb core', ORB, (.055, .055, .055), orb_core, 'orb', 2)

# ---------------------------------------------------------------- bones (pre-scale)
bones = {
    'root': ((0, 0, 0), (0, 0, .30), None),
    'hips': ((0, 0, 2.42), (0, -.02, 2.76), 'root'),
    'spine': ((0, -.02, 2.76), (0, -.08, 3.22), 'hips'),
    'chest': ((0, -.08, 3.22), (0, -.20, 3.68), 'spine'),
    'head': ((0, -.24, 3.72), (0, -.40, 4.44), 'chest'),
    'eye.L': (EYE[1], tuple(Vector(EYE[1]) + Vector((0, -.16, 0))), 'head'),
    'eye.R': (EYE[-1], tuple(Vector(EYE[-1]) + Vector((0, -.16, 0))), 'head'),
    'beard': ((0, -.575, 3.80), (0, -.510, 3.18), 'head'),
    'staff': (tuple(STAFF_GRIP), tuple(STAFF_GRIP + Vector((0, -.06, .90))), 'hand.R'),
    'orb': (tuple(ORB), tuple(ORB + Vector((0, 0, .22))), 'staff'),
}
for L in ('R', 'L'):
    j = joints[L]
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
    for count, name in budget[:32]: print(f'TRIANGLES {count:7d} {name}')
    print(f'TRIANGLES {sum(c for c, _ in budget):7d} TOTAL')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Warlock_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Normalize once from the measured sculpt so the runtime contract (feet at the
# origin plane, 1.85 units tall) holds no matter how the silhouette is retuned.
zs = [v.co.z for v in character.data.vertices]
FLOOR = min(zs); SCALE = TARGET_HEIGHT / (max(zs) - FLOOR)
STOOP = .125   # forward curve added above the hips, in pre-scale units at the crown
def settle(co):
    x, y, z = co[0], co[1], co[2]
    y -= STOOP * max(0, (z - 2.30) / 2.30) ** 1.6
    return Vector((x * SCALE, y * SCALE, (z - FLOOR) * SCALE))
for v in character.data.vertices: v.co = settle(v.co)
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural cloth, skin, hair, leather, wood and metal into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(eye_glow, orb_glow, orb_core), prefix='warlock')

rig_data = bpy.data.armatures.new('Warlock_Skeleton')
rig = bpy.data.objects.new('Warlock_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
for name, (a, b, parent) in bones.items():
    eb = rig_data.edit_bones.new(name); eb.head = settle(a); eb.tail = settle(b)
for name, (a, b, parent) in bones.items():
    if parent: rig_data.edit_bones[name].parent = rig_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Warlock skeleton', 'ARMATURE'); mod.object = rig
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
        eye.scale.y = 1 - .90 * closure
        eye.scale.z = 1 - .88 * closure

def blink(t, centers=(.26, .74)):
    close_eyes(max([max(0, 1 - abs(t - c) / .028) for c in centers] + [0]))

def orb(scale, spin=0):
    p = rig.pose.bones['orb']
    p.scale = (scale, scale, scale)
    rot('orb', 0, 0, spin)

def idle(t):
    # Slow breathing, the orb pulsing in its cage, and the head turning as if
    # reading a page held in the left hand.
    w = math.sin(t * math.tau)
    breath = math.sin(t * math.tau * 2)
    look = curve(t, [(0, 0), (.14, 0), (.30, .20), (.46, .20), (.58, -.05), (.74, -.16), (.88, -.16), (1, 0)])
    tilt = curve(t, [(0, 0), (.30, .07), (.62, .10), (.86, 0), (1, 0)])
    rot('hips', .008 * breath)
    rot('spine', .015 * breath, 0, .012 * w)
    rot('chest', .020 * breath, 0, -.016 * w)
    rot('head', -.028 * breath + tilt, .05 * w, look)
    rot('beard', .05 * breath - .5 * tilt, 0, -.6 * look)
    rig.pose.bones['chest'].scale.y = 1 + .014 * breath
    rot('upper_arm.L', .020 * breath, 0, -.018); rot('forearm.L', .030 * breath)
    rot('upper_arm.R', -.014 * breath); rot('hand.R', .012 * w)
    rot('staff', .012 * w, 0, .010 * breath)
    orb(1 + .11 * math.sin(t * math.tau - 1.0) + .04 * math.sin(t * math.tau * 3), .35 * math.sin(t * math.tau))
    blink(t, (.22, .68, .76))

def walk(t):
    # An old man's shuffle: short strides, a heavy lean, and the staff planted
    # once per cycle to take his weight.
    w = math.sin(t * math.tau)
    plant = bump(t, .30, .26)
    rig.pose.bones['root'].location.y = .014 * (1 - math.cos(t * math.tau * 2)) - .012 * plant
    rot('hips', 0, .028 * w, .030 * w)
    for L, s in (('L', 1), ('R', -1)):
        stride = s * w
        rot('thigh.' + L, .34 * stride); rot('shin.' + L, -max(0, stride) * .46)
        rot('foot.' + L, -.10 * stride + max(0, stride) * .12)
    rot('spine', .05, 0, -.020 * w); rot('chest', .06, 0, -.028 * w)
    rot('head', -.05, 0, .020 * w)
    rot('beard', .10 * w, 0, 0)
    # Left arm swings a little; the right arm reaches down and forward to plant.
    rot('upper_arm.L', -.16 * w, 0, -.10); rot('forearm.L', -.12 - .10 * max(0, w))
    rot('upper_arm.R', -.10 - .30 * plant, 0, .04 * plant)
    rot('forearm.R', .10 + .22 * plant); rot('hand.R', -.10 * plant)
    rot('staff', -.14 * plant, 0, 0)
    orb(1 + .07 * math.sin(t * math.tau))

def attack(t):
    # Raise the staff overhead, then thrust it forward as the orb flares.
    lift = curve(t, [(0, 0), (.30, 1), (.42, .95), (.60, -.35), (.74, -.20), (1, 0)])
    flare = math.exp(-((t - .55) / .085) ** 2)
    rot('spine', -.10 * max(0, lift) + .16 * max(0, -lift))
    rot('chest', -.14 * max(0, lift) + .22 * max(0, -lift), 0, -.10 * lift)
    rot('head', .06 * lift + .10 * flare, 0, 0)
    rot('beard', -.20 * lift)
    rot('upper_arm.R', -1.35 * max(0, lift) + .55 * max(0, -lift), 0, -.30 * lift)
    rot('forearm.R', -.55 * max(0, lift) - .45 * max(0, -lift))
    rot('hand.R', .25 * lift)
    rot('staff', -.55 * max(0, lift) + .75 * max(0, -lift), 0, .10 * lift)
    rot('upper_arm.L', -.35 * max(0, lift) - .55 * max(0, -lift), 0, -.28)
    rot('forearm.L', -.55 - .35 * lift)
    rot('thigh.L', .10 * max(0, -lift)); rot('thigh.R', -.08 * max(0, -lift))
    orb(1 + .30 * max(0, lift) + 1.05 * flare, .8 * lift)
    blink(t, (.52,))

def hit(t):
    # Recoil, clutching the robe over the chest with the free hand.
    w = curve(t, [(0, 0), (.16, 1), (.38, .58), (.68, -.10), (1, 0)])
    rot('spine', -.22 * w); rot('chest', -.30 * w, 0, .14 * w)
    rot('head', -.24 * w, 0, -.14 * w)
    rot('beard', -.30 * w)
    rot('upper_arm.L', -.85 * w, 0, -.55 * w); rot('forearm.L', -1.15 * w); rot('hand.L', -.35 * w)
    rot('upper_arm.R', -.22 * w, 0, .26 * w); rot('staff', .30 * w)
    rot('thigh.L', .16 * w); rot('shin.L', -.20 * w)
    orb(1 - .30 * max(0, w))
    blink(t, (.18,))

def death(t):
    # Sinks to the knees, then crumples forward over the staff.
    k = curve(t, [(0, 0), (.16, .10), (.52, .78), (.66, .74), (1, 1)])
    fall = curve(t, [(0, 0), (.44, .06), (.72, .82), (.86, 1), (1, 1)])
    rig.pose.bones['root'].location.y = -.40 * k
    rot('root', -.22 * fall)
    rot('thigh.L', .30 * k); rot('thigh.R', .26 * k)
    rot('shin.L', -1.55 * k); rot('shin.R', -1.50 * k)
    rot('hips', .18 * k)
    rot('spine', .30 * k + .30 * fall); rot('chest', .34 * k + .38 * fall)
    rot('head', .18 * k + .48 * fall)
    rot('beard', -.35 * fall)
    rot('upper_arm.L', -.30 * k - .40 * fall, 0, -.34 * k)
    rot('upper_arm.R', -.18 * k + .30 * fall, 0, .30 * k)
    rot('forearm.R', .25 * fall); rot('staff', .55 * k + .70 * fall, 0, -.25 * k)
    orb(max(.12, 1 - 1.0 * curve(t, [(0, 0), (.30, .25), (.85, 1), (1, 1)])))
    close_eyes(min(1, t * 2.4))

pose('Idle', 91, idle)          # 3.0 s
pose('Walk', 31, walk)          # 1.0 s
pose('Attack', 28, attack)      # 0.9 s
pose('Hit', 19, hit)            # 0.6 s
pose('Death', 49, death)        # 1.6 s
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = ('Dungeon Keeper 2 warlock: gaunt stooped old sorcerer, bald head and long grey goatee '
                    'inside a raised black hood, deep-purple robes with hanging sleeves and a layered hem, '
                    'gold mantle, rope belt with spellbook, and a gnarled staff caging a violet orb.')
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = f'Feet at ground; {TARGET_HEIGHT} units tall; Blender -Y / Babylon +Z forward.'

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights, and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'warlock.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for tr in rig.animation_data.nla_tracks: tr.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'warlock.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
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
area('Warm key', (-3.0, -4.4, 5.0), 480, (1, .76, .50), 2.8)
area('Soft fill', (2.6, -2.6, 2.4), 150, (.65, .80, 1), 2.8)
# Restrained rim: too much of it turned the black cape into grey flannel.
area('Cool rim', (-1.3, 2.6, 3.6), 240, (.36, .73, 1), 2.4)
bpy.ops.object.camera_add(location=(2.6, -6.8, 3.5)); cam = bpy.context.object
aim(cam, (-.05, 0, .95)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.10; scene.camera = cam
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
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'warlock.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'warlock-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing on the hood shows the face, the goatee and the mantle.
cam.location = (1.5, -5.4, 2.30); aim(cam, (0, -.09, 1.60)); cam.data.ortho_scale = .70
scene.render.filepath = str(PREVIEW / 'warlock-detail.png')
bpy.ops.render.render(write_still=True)
# A profile shows the stoop, the hood shape and the hanging sleeve.
cam.location = (6.4, -.5, 2.1); aim(cam, (0, -.05, .95)); cam.data.ortho_scale = 2.10
scene.render.filepath = str(PREVIEW / 'warlock-side.png')
bpy.ops.render.render(write_still=True)
print('WARLOCK_BUILD_COMPLETE', triangles, 'triangles')
