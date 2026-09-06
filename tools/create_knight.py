"""Build the Dungeon Keeper 2 Knight hero with Blender 5.x (no add-ons required).

Run: blender --background --python tools/create_knight.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the DK2 Knight -- the tall, upright, heavily armoured human champion
that leads hero parties. A great helm with a narrow visor slit and a tall crimson
plume, a gorget, layered pauldrons, a keeled breastplate and backplate over a blue
surcoat with gold trim, a fauld and tassets, articulated rerebraces, couters,
vambraces and gauntlets, cuisses, poleyns, greaves and pointed sabatons. Riveted
mail shows at every joint the plate cannot cover. A kite shield with a gold rim,
boss and cross rides the left arm; a fullered longsword with a gold cross-guard,
leather-wrapped grip and wheel pommel hangs from the right fist.

Because the whole figure is armour, each plate is built as its own piece -- a
sculpted union or a bevelled parametric shell -- with rolled rims and small gaps
between neighbours, so the silhouette reads as overlapping steel rather than one
welded blob. Straps, rivets and buckles are conformed to the plates they sit on.
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
FAST = bool(os.environ.get('IMP_FAST'))
PREVIEW = Path(os.environ.get('IMP_PREVIEW_DIR') or SOURCE)
TARGET_HEIGHT = 1.95  # units before the game's per-type scale, plume tip included
random.seed(41)
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

# Linear equivalents of the palette the game already uses for heroes in
# src/babylon/entities.js: steel #8996a8, darkSteel #3f4b59, gold #d99b2b,
# clothBlue #234d77, clothRed #751f2a, leather #4a281d.
#
# The metals are authored bright and only moderately metallic, which is not how they
# would be written for a Cycles beauty render. The atlas bake takes base colour from a
# DIFFUSE pass, and a Principled BSDF's diffuse colour is base x (1 - metallic): at the
# metallic .84 this armour started on, every plate baked down to roughly four per cent
# grey and the first exported knight was jet black. Base colours here are pre-divided by
# the surviving diffuse fraction so the baked map lands on real steel, and the metallic
# ramps stay high enough for the exported map to still read as metal in Babylon.
steel = material('Plate | brushed steel', (.530, .600, .725), .44, .40)
mail = material('Mail | riveted links', (.180, .205, .255), .40, .58)
gold = material('Trim | gilded brass', (.960, .560, .100), .48, .30)
leather = material('Straps | oiled leather', (.062, .022, .012), 0, .74)
leather_edge = material('Straps | worn edges', (.130, .058, .026), 0, .70)
cloth_blue = material('Surcoat | heraldic blue', (.018, .075, .190), 0, .88)
cloth_red = material('Plume | crimson horsehair', (.300, .026, .034), 0, .82)
blade_steel = material('Longsword | polished blade', (.680, .740, .850), .50, .22)
dark = material('Visor slit | shadow', (.008, .010, .014), 0, .62)

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

def armour_shader(mat, base, dent_scale=13, dent_depth=.005, rough=(.28, .58), metal=(.70, .94), brush=(6, 6, .35)):
    """Brushed, dented plate: hammer marks and battle damage in the bump map, grime
    that goes rough and slightly less metallic, rubbed faces that stay bright.
    Coordinates are final game units. This is deliberately not chrome."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    dents = nodes.new('ShaderNodeTexVoronoi'); dents.feature = 'SMOOTH_F1'
    dents.inputs['Scale'].default_value = dent_scale
    dents.inputs['Smoothness'].default_value = .85
    dents.inputs['Randomness'].default_value = 1.0
    links.new(tex.outputs['Object'], dents.inputs['Vector'])
    # Brushed grain: noise squashed along Z so it reads as a worked, polished surface.
    stretch = nodes.new('ShaderNodeVectorMath'); stretch.operation = 'MULTIPLY'
    stretch.inputs[1].default_value = brush
    links.new(tex.outputs['Object'], stretch.inputs[0])
    grain = nodes.new('ShaderNodeTexNoise'); grain.inputs['Scale'].default_value = 34
    grain.inputs['Detail'].default_value = 3
    links.new(stretch.outputs['Vector'], grain.inputs['Vector'])
    blend = nodes.new('ShaderNodeMath'); blend.operation = 'MULTIPLY_ADD'
    blend.inputs[1].default_value = .30
    links.new(grain.outputs['Fac'], blend.inputs[0]); links.new(dents.outputs['Distance'], blend.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .32
    bmp.inputs['Distance'].default_value = dent_depth
    links.new(blend.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    grime = nodes.new('ShaderNodeTexNoise'); grime.inputs['Scale'].default_value = 7.5
    grime.inputs['Detail'].default_value = 4; grime.inputs['Roughness'].default_value = .58
    links.new(tex.outputs['Object'], grime.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .30
    ramp.color_ramp.elements[0].color = (*(c * .58 for c in base), 1)
    ramp.color_ramp.elements[1].position = .74
    ramp.color_ramp.elements[1].color = (*(min(1, c * 1.30) for c in base), 1)
    mid = ramp.color_ramp.elements.new(.52); mid.color = (*base, 1)
    links.new(grime.outputs['Fac'], ramp.inputs[0]); links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    r = nodes.new('ShaderNodeMapRange')
    r.inputs['To Min'].default_value = rough[1]; r.inputs['To Max'].default_value = rough[0]
    links.new(grime.outputs['Fac'], r.inputs['Value']); links.new(r.outputs[0], p.inputs['Roughness'])
    m = nodes.new('ShaderNodeMapRange')
    m.inputs['To Min'].default_value = metal[0]; m.inputs['To Max'].default_value = metal[1]
    links.new(grime.outputs['Fac'], m.inputs['Value']); links.new(m.outputs[0], p.inputs['Metallic'])

def mail_shader(mat, base):
    """Riveted mail. A near-regular Voronoi lattice raises a ring inside every cell and
    drops the gaps between them into shadow -- a fine link bump is all the joints need."""
    nodes = mat.node_tree.nodes; links = mat.node_tree.links
    p = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexCoord')
    links_tex = nodes.new('ShaderNodeTexVoronoi'); links_tex.feature = 'DISTANCE_TO_EDGE'
    links_tex.inputs['Scale'].default_value = 118
    links_tex.inputs['Randomness'].default_value = .10
    links.new(tex.outputs['Object'], links_tex.inputs['Vector'])
    rings = nodes.new('ShaderNodeValToRGB')
    rings.color_ramp.elements[0].position = .00; rings.color_ramp.elements[0].color = (0, 0, 0, 1)
    rings.color_ramp.elements[1].position = .40; rings.color_ramp.elements[1].color = (.18, .18, .18, 1)
    crest = rings.color_ramp.elements.new(.15); crest.color = (1, 1, 1, 1)
    links.new(links_tex.outputs['Distance'], rings.inputs[0])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = .62
    bmp.inputs['Distance'].default_value = .0022
    links.new(rings.outputs['Color'], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    # Broad soiling so the mail is not a flat field of identical links.
    soil = nodes.new('ShaderNodeTexNoise'); soil.inputs['Scale'].default_value = 9
    soil.inputs['Detail'].default_value = 3
    links.new(tex.outputs['Object'], soil.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .34; ramp.color_ramp.elements[0].color = (*(c * .55 for c in base), 1)
    ramp.color_ramp.elements[1].position = .70; ramp.color_ramp.elements[1].color = (*(min(1, c * 1.45) for c in base), 1)
    links.new(soil.outputs['Fac'], ramp.inputs[0]); links.new(ramp.outputs['Color'], p.inputs['Base Color'])
    r = nodes.new('ShaderNodeMapRange'); r.inputs['To Min'].default_value = .68; r.inputs['To Max'].default_value = .44
    links.new(soil.outputs['Fac'], r.inputs['Value']); links.new(r.outputs[0], p.inputs['Roughness'])

armour_shader(steel, (.530, .600, .725), metal=(.34, .56))
armour_shader(blade_steel, (.680, .740, .850), 22, .0022, (.14, .34), (.40, .62), (14, 14, .12))
armour_shader(gold, (.960, .560, .100), 11, .0035, (.20, .46), (.38, .60))
mail_shader(mail, (.180, .205, .255))
surface_detail(leather, 52, .0022, .26)
surface_detail(leather_edge, 44, .0016, .28)
surface_detail(cloth_blue, 88, .0018, .22, (1, 1, 1.6))
surface_detail(cloth_red, 46, .0030, .30, (1, 1, .28), .55)
surface_detail(dark, 30, .0006, .18)

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

def apply_modifier(o, mod):
    activate(o); bpy.ops.object.modifier_apply(modifier=mod.name)

def crisp(o, angle=42):
    """Split shading across plate edges. Armour must keep hard corners; without this
    every bevelled rim shades like melted wax."""
    m = o.modifiers.new('Plate edges', 'EDGE_SPLIT')
    m.split_angle = math.radians(angle); m.use_edge_angle = True; m.use_edge_sharp = False
    apply_modifier(o, m)

def ell(name, pos, size, mat=None, bone='chest', sub=3, rot=(0, 0, 0), basis=None):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=pos)
    o = bpy.context.object; o.name = name
    if basis is not None:
        o.matrix_world = Matrix.Translation(Vector(pos)) @ basis.to_4x4() @ Matrix.Diagonal(Vector(size)).to_4x4()
    else:
        o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or steel, bone)

def limb(name, a, b, r, bone, mat=None, bulge=1.08, ry=None):
    """An ellipsoid aligned to a joint-to-joint segment."""
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(a + b) / 2)
    o = bpy.context.object; o.name = name; o.scale = (r, ry or r, d.length / 2 * bulge)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    smooth(o); return own(o, mat or mail, bone)

def block(name, pos, size, mat, bone, bevel=.02, rot=(0, 0, 0)):
    """A bevelled block for forged pieces; never left as a raw box."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    m = o.modifiers.new('Forged corners', 'BEVEL'); m.width = bevel; m.segments = 3; apply_modifier(o, m)
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

def union(name, objects, voxel, ratio=1.0, mat=None, smoothing=2, bone=None):
    """Weld overlapping primitives into one continuous sculpt. Each armour piece gets
    its own union so neighbouring plates stay separate, overlapping forms."""
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
    o.data.materials.clear(); o.data.materials.append(mat or steel)
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

def patch(name, p, size, mat, bone, target, offset=0, sub=1):
    """An ellipsoid seated on a sculpted surface, its Y axis along the surface normal.
    Rivets and studs never float."""
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
    tube(name, pts, radius, mat or gold, bone, cyclic=True, res=2)
    rod(name + ' prong', loc + right * (w / 2) - n * .004, loc - right * (w * .12) - n * .004,
        radius * .75, radius * .5, mat or gold, bone, 8)

def shell(name, P, thickness, nu, nv, mat, bone, out=None, bevel=.010, sharp=42):
    """A curved armour plate: an outer surface grid, an offset inner surface and a closed
    rim, bevelled and shade-split so the edge reads as forged steel rather than a soft
    membrane. Every lame, tasset, greave, sabaton lame and the shield are built this way."""
    eps = 1e-3
    def normal(u, v):
        du = Vector(P(min(1, u + eps), v)) - Vector(P(max(0, u - eps), v))
        dv = Vector(P(u, min(1, v + eps))) - Vector(P(u, max(0, v - eps)))
        n = du.cross(dv)
        return n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
    T = thickness if callable(thickness) else (lambda u, v: thickness)
    sign = 1
    if out is not None and normal(.5, .5).dot(Vector(out(.5, .5))) < 0:
        sign = -1
    verts = []; F = []; K = []
    for i in range(nu + 1):
        u = i / nu; F.append([])
        for j in range(nv + 1):
            F[i].append(len(verts)); verts.append(Vector(P(u, j / nv)))
    for i in range(nu + 1):
        u = i / nu; K.append([])
        for j in range(nv + 1):
            v = j / nv
            K[i].append(len(verts)); verts.append(Vector(P(u, v)) - normal(u, v) * (sign * T(u, v)))
    faces = []
    for i in range(nu):
        for j in range(nv):
            faces.append((F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1]))
            faces.append((K[i][j], K[i][j + 1], K[i + 1][j + 1], K[i + 1][j]))
    for i in range(nu):
        faces.append((F[i][0], K[i][0], K[i + 1][0], F[i + 1][0]))
        faces.append((F[i][nv], F[i + 1][nv], K[i + 1][nv], K[i][nv]))
    for j in range(nv):
        faces.append((F[0][j], F[0][j + 1], K[0][j + 1], K[0][j]))
        faces.append((F[nu][j], K[nu][j], K[nu][j + 1], F[nu][j + 1]))
    o = mesh(name, verts, faces, mat, bone)
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    if bevel:
        m = o.modifiers.new('Rolled edge', 'BEVEL'); m.width = bevel; m.segments = 2
        m.limit_method = 'ANGLE'; m.angle_limit = math.radians(30); apply_modifier(o, m)
    smooth(o)
    if sharp: crisp(o, sharp)
    return o

def limb_axes(a, b):
    """A limb frame whose angle 0 sits at the character's front (-Y) and +90 degrees
    toward +X, whichever way the bone axis happens to point."""
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    front = Vector((0, -1, 0)); front = (front - axis * front.dot(axis)).normalized()
    side = Vector((1, 0, 0)); side = side - axis * side.dot(axis)
    side = (side - front * side.dot(front)).normalized()
    return a, (b - a).length, axis, front, side

def sleeve(name, a, b, d0, d1, r0, r1, a0, a1, thickness, mat, bone, nu=6, nv=16, bevel=.010, flare=None):
    """A plate wrapped around a limb segment: a cylindrical sector between two angles,
    measured from the character's front. Rerebraces, vambraces, cuisses, greaves and
    pauldron lames are all this shape."""
    origin, length, axis, front, side = limb_axes(a, b)
    def radial(v):
        ang = math.radians(a0 + (a1 - a0) * v)
        return front * math.cos(ang) + side * math.sin(ang)
    def P(u, v):
        r = r0 + (r1 - r0) * u
        if flare: r *= flare(u, v)
        return origin + axis * (d0 + (d1 - d0) * u) + radial(v) * r
    return shell(name, P, thickness, nu, nv, mat, bone, out=lambda u, v: radial(v), bevel=bevel)

def band(name, z0, z1, r0, r1, cy, a0, a1, thickness, mat, bone, nu=3, nv=30, bevel=.010, squash=.86):
    """A horizontal lame wrapping the waist: an elliptical band between two heights."""
    def radial(v):
        ang = math.radians(a0 + (a1 - a0) * v)
        return Vector((math.sin(ang), -math.cos(ang) / squash, 0)).normalized()
    def P(u, v):
        ang = math.radians(a0 + (a1 - a0) * v)
        r = r0 + (r1 - r0) * u
        return Vector((r * math.sin(ang), cy - r * squash * math.cos(ang), z0 + (z1 - z0) * u))
    return shell(name, P, thickness, nu, nv, mat, bone, out=lambda u, v: radial(v), bevel=bevel)

def catmull(points, u):
    """Smooth interpolation through a control polyline; used for the plume spine."""
    pts = [Vector(p) for p in points]
    n = len(pts) - 1
    f = max(0.0, min(1.0, u)) * n
    i = min(int(f), n - 1); t = f - i
    p0 = pts[max(0, i - 1)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(n, i + 2)]
    return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                 + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
# The knight stands upright and asymmetric: the sword arm hangs, the shield arm is
# drawn in and across so the kite shield covers the chest. Roughly six helm-heights.
joints = {
    'L': dict(shoulder=(.50, -.02, 3.50), elbow=(.64, -.04, 2.80), wrist=(.48, -.56, 2.37), hand=(.43, -.71, 2.25),
              hip=(.26, -.02, 2.30), knee=(.31, -.06, 1.22), ankle=(.33, .02, .32), foot=(.33, -.42, .10)),
    'R': dict(shoulder=(-.50, -.02, 3.50), elbow=(-.66, -.06, 2.80), wrist=(-.66, -.35, 2.18), hand=(-.66, -.44, 2.00),
              hip=(-.26, -.02, 2.30), knee=(-.31, -.06, 1.22), ankle=(-.33, .02, .32), foot=(-.33, -.42, .10)),
}
SIDES = ((-1, 'R'), (1, 'L'))

# ---------------------------------------------------------------- mail body
# Everything above is plate; this is the riveted hauberk and chausses underneath it.
# It is what shows at the armpits, elbow crooks, groin, knee backs and neck, and it
# is the only part of the figure with blended weights so the joints deform smoothly.
body_parts = []
def B(o): body_parts.append(o); return o
B(ell('Mail chest', (0, -.04, 3.24), (.30, .22, .32), mail, 'chest'))
B(ell('Mail upper chest', (0, -.04, 3.44), (.29, .20, .15), mail, 'chest'))
B(ell('Mail waist', (0, -.03, 2.86), (.25, .20, .22), mail, 'chest'))
B(ell('Mail belly', (0, -.03, 2.60), (.25, .20, .22), mail, 'hips'))
B(ell('Mail pelvis', (0, -.01, 2.34), (.28, .22, .20), mail, 'hips'))
B(ell('Mail seat', (0, .11, 2.36), (.25, .16, .18), mail, 'hips'))
B(ell('Mail collar', (0, -.04, 3.58), (.17, .17, .14), mail, 'neck'))
for s, L in SIDES:
    j = joints[L]
    B(ell('Mail shoulder', (s * .44, -.02, 3.47), (.185, .195, .195), mail, f'upper_arm.{L}'))
    B(limb('Mail upper arm', j['shoulder'], j['elbow'], .115, f'upper_arm.{L}'))
    B(ell('Mail elbow', j['elbow'], (.115, .115, .115), mail, f'forearm.{L}'))
    B(limb('Mail forearm', j['elbow'], j['wrist'], .100, f'forearm.{L}'))
    B(ell('Mail wrist', j['wrist'], (.092, .092, .092), mail, f'forearm.{L}'))
    B(ell('Mail hip', j['hip'], (.20, .20, .18), mail, f'thigh.{L}'))
    B(limb('Mail thigh', j['hip'], j['knee'], .190, f'thigh.{L}', ry=.200))
    B(ell('Mail knee', j['knee'], (.155, .16, .155), mail, f'shin.{L}'))
    B(limb('Mail calf', j['knee'], j['ankle'], .150, f'shin.{L}', ry=.165))
    B(ell('Mail ankle', j['ankle'], (.115, .115, .115), mail, f'shin.{L}'))
    B(ell('Boot core', (s * .33, -.13, .13), (.150, .30, .120), mail, f'foot.{L}'))
    B(ell('Heel core', (s * .33, .11, .12), (.125, .11, .115), mail, f'foot.{L}'))
samples = []
for o in body_parts:
    for v in o.data.vertices: samples.append((o.matrix_world @ v.co, o['bone']))
tree = KDTree(len(samples))
for i, (co, bone) in enumerate(samples): tree.insert(co, i)
tree.balance()
body = union('Mail hauberk and chausses', body_parts, .034, .25, mail)
body['weighted_body'] = True

# ---------------------------------------------------------------- great helm
# Two passes, as with any sculpted head: build the shell, then seat the brow bar, the
# central reinforcing rib and the cheek ridge on it and remesh so they weld in. That
# leaves a real cross-braced face with a genuine groove for the sight, instead of a
# painted-on line. The crown is a sugarloaf barrel, not a ball -- a great helm reads
# as a forged vessel dropped over the head, and a sphere never will.
helm_parts = []
def H(o): helm_parts.append(o); return o
# A sixteen-sided drum rather than a smooth cylinder, so forged facets survive the remesh.
H(rod('Helm barrel', (0, -.015, 3.665), (0, -.020, 4.030), .262, .246, steel, 'head', 16))
# A true cone. The sugarloaf taper is the great helm's entire silhouette; pass one used
# a squashed sphere here and the helm read as a bald head in a silver stocking.
H(rod('Helm sugarloaf', (0, -.020, 3.985), (0, -.030, 4.320), .256, .062, steel, 'head', 16))
H(ell('Helm apex', (0, -.030, 4.312), (.064, .068, .048), steel, 'head'))
# The front is a plane. A flat frontal panel raked five degrees back is the one thing
# that stops a helm reading as a helmet-shaped balloon, and no arrangement of
# ellipsoids will produce one -- so the face is a bevelled block.
H(block('Helm face plane', (0, -.226, 3.878), (.442, .140, .400), steel, 'head', .026,
        rot=(math.radians(-5), 0, 0)))
# Brow and chin bevels fold that plane back into the drum above and below the sight.
H(block('Helm brow bevel', (0, -.208, 4.086), (.418, .140, .140), steel, 'head', .024,
        rot=(math.radians(-40), 0, 0)))
H(block('Helm chin bevel', (0, -.196, 3.700), (.400, .150, .126), steel, 'head', .024,
        rot=(math.radians(36), 0, 0)))
H(ell('Helm nape', (0, .118, 3.920), (.238, .150, .245), steel, 'head'))
# A flared skirt at the base: the helm sits over the gorget, it does not stop at it.
H(ell('Helm base flare', (0, -.015, 3.672), (.278, .264, .056), steel, 'head'))
helm = union('Helm shell pass 1', helm_parts, .012, 1.0, steel, 1, 'head')
# The sight line dips slightly toward the temples, the way a real occularium is cut.
def visor_z(x): return 3.982 - .040 * (abs(x) / .235) ** 1.7
visor_x = [-.235 + .47 * i / 14 for i in range(15)]
refine = [helm]
refine.append(tube('Helm brow bar', conformed([(x, -.36, visor_z(x) + .074) for x in visor_x], helm, .026),
                   .048, steel, 'head', lambda t: .80 + .40 * math.sin(math.pi * t)))
refine.append(tube('Helm cheek ridge', conformed([(x, -.36, visor_z(x) - .062) for x in visor_x], helm, .022),
                   .038, steel, 'head', lambda t: .78 + .32 * math.sin(math.pi * t)))
# The reinforcing rib: brow to chin down the centre line, splitting the sight in two.
refine.append(tube('Helm face rib', conformed([(0, -.38, 4.10 - .088 * i) for i in range(6)], helm, .018),
                   .042, steel, 'head', lambda t: .95 - .25 * t))
# A raised comb arcs front to back over the crown and dies into the plume socket.
comb = [(0, -.230 + .460 * i / 8, 4.300 - .300 * (2 * i / 8 - 1) ** 2) for i in range(9)]
refine.append(tube('Helm comb', conformed(comb, helm, .008), .030, steel, 'head',
                   lambda t: .45 + .85 * math.sin(math.pi * t) ** .7))
helm = union('Great helm', refine, .012, .24, steel, 1, 'head')
# Split the shading across the facets. Without this the flat face, the drum and the cone
# all shade into one another and the forging is thrown away at the last step.
crisp(helm, 33)
# The sight itself: two black slots lying in the valley between the welded ridges. They
# sit a hair proud of the face so they read as openings under every studio light.
for lo, hi in ((-.222, -.040), (.040, .222)):
    xs = [lo + (hi - lo) * i / 6 for i in range(7)]
    up = conformed([(x, -.38, visor_z(x) + .030) for x in xs], helm, .005)
    low = conformed([(x, -.38, visor_z(x) - .030) for x in xs], helm, .005)
    smooth(mesh('Visor sight', up + low, [(i, i + 1, 7 + i + 1, 7 + i) for i in range(6)], dark, 'head'))
# Breath holes punched through the lower face plate: two neat wedges either side of the rib.
for s in (-1, 1):
    for row in range(3):
        for col in range(3 - row):
            patch('Breath hole', (s * (.076 + col * .050 + row * .025), -.42, 3.862 - row * .046),
                  (.019, .010, .019), dark, 'head', helm, .004)
# Gilded band riveted around the base of the helm, and a gilt line along the brow bar.
helm_band = conformed([(.254 * math.sin(a), -.015 - .244 * math.cos(a), 3.706)
                       for a in [2 * math.pi * i / 20 for i in range(20)]], helm, .012)
tube('Helm gilt band', helm_band, .024, gold, 'head', cyclic=True, res=1, segments=2)
for i in range(8):
    a = 2 * math.pi * i / 8 + .2
    patch('Helm rivet', (.254 * math.sin(a), -.015 - .244 * math.cos(a), 3.706),
          (.020, .012, .020), gold, 'head', helm, .028)
tube('Brow gilt', conformed([(x, -.38, visor_z(x) + .124) for x in visor_x], helm, .012),
     .016, gold, 'head', lambda t: .6 + .6 * math.sin(math.pi * t), res=1, segments=3)

# ---------------------------------------------------------------- crimson plume
# A horsehair crest springing from a gilded socket, rising above the helm and falling
# back behind it. Built as a bundle of round tapered strands over a thin web so it has
# volume from every angle instead of reading as a flat red flag in profile.
PLUME = [(0, .03, 4.30), (0, -.03, 4.62), (0, .05, 4.90), (0, .22, 5.010),
         (0, .45, 4.92), (0, .63, 4.60), (0, .75, 4.26)]
def plume_tangent(u):
    return (catmull(PLUME, min(1, u + .01)) - catmull(PLUME, max(0, u - .01))).normalized()
def plume_normal(u):
    t = plume_tangent(u)
    return Vector((0, t.z, -t.y)).normalized()
socket = union('Plume socket', [
    rod('Socket cup', (0, .04, 4.20), (0, .02, 4.40), .086, .058, gold, 'head', 14),
    ell('Socket collar', (0, .04, 4.23), (.100, .100, .032), gold, 'head'),
], .013, .34, gold, 1, 'head')
# A crest is a solid sweep, not a bundle of macaroni. The first attempt drew a flat web
# with a fringe hanging off it and read as a red flag; the second drew twenty-two fat
# tapered tubes and read as dreadlocks. This is one lens-sectioned sweep -- narrow left
# to right, deep along the arc, swelling and dying like a comet -- with combing grooves
# cut into it by modulating the section radius, and a handful of loose strands breaking
# out of the tail so the silhouette goes ragged instead of ending in a rubber fin.
CREST_RINGS, CREST_AROUND = 18, 24
def crest_depth(u): return .205 * math.sin(math.pi * (.12 + .84 * u)) ** .50
def crest_width(u): return .076 * (1 - .55 * u)
crest_verts = []
for i in range(CREST_RINGS + 1):
    u = i / CREST_RINGS
    p = catmull(PLUME, u); n = plume_normal(u); lat = Vector((1, 0, 0))
    depth, width = crest_depth(u), crest_width(u)
    for k in range(CREST_AROUND):
        a = 2 * math.pi * k / CREST_AROUND
        # Six grooves running the length of the crest, deepening toward the tail. They
        # have to be cut this hard to survive the smooth shading; a shallower version
        # rendered as a moulded rubber fin.
        groove = 1 + .24 * math.cos(6 * a + .8 * u) * (.35 + .65 * u)
        crest_verts.append(p + lat * (math.cos(a) * width * groove) + n * (math.sin(a) * depth * groove))
crest_faces = [(i * CREST_AROUND + k, (i + 1) * CREST_AROUND + k,
                (i + 1) * CREST_AROUND + (k + 1) % CREST_AROUND, i * CREST_AROUND + (k + 1) % CREST_AROUND)
               for i in range(CREST_RINGS) for k in range(CREST_AROUND)]
crest_faces.append(tuple(range(CREST_AROUND - 1, -1, -1)))
crest_faces.append(tuple(range(CREST_RINGS * CREST_AROUND, (CREST_RINGS + 1) * CREST_AROUND)))
smooth(mesh('Plume crest', crest_verts, crest_faces, cloth_red, 'plume'))
# Loose hair leaving the tail. Each strand starts on the crest's own surface and swells
# away from it, so it reads as horsehair pulling out of the mass. Growing them from the
# spine instead, as the previous pass did, produced nine parallel spikes poking out of
# the underside of the crest like the teeth of a comb.
for k in range(14):
    a = math.tau * (k / 14) + random.uniform(-.11, .11)
    start = .58 + .18 * random.random()
    end = 1.02 + .14 * random.random()
    path = []
    for i in range(4):
        u = start + (end - start) * i / 3
        uc = min(1.0, u)
        p = catmull(PLUME, uc)
        if u > 1: p = p + plume_tangent(.985) * ((u - 1) * 1.55)
        swell = 1 + .58 * (u - start) / (end - start)
        p = (p + Vector((math.cos(a) * crest_width(uc) * swell, 0, 0))
             + plume_normal(uc) * (math.sin(a) * crest_depth(uc) * swell))
        path.append(tuple(p))
    tube('Plume strand', path, .030, cloth_red, 'plume', lambda t: 1.0 - .45 * t, res=1, segments=3)

# ---------------------------------------------------------------- gorget
gorget = union('Gorget', [
    rod('Gorget body', (0, -.02, 3.38), (0, -.03, 3.66), .275, .200, steel, 'neck', 24),
    # Wide enough to run under the pauldron caps. Pass two left a finger's width of
    # daylight there and the render showed straight through into the hollow cap.
    ell('Gorget shoulder L', (.235, -.02, 3.455), (.200, .185, .135), steel, 'neck'),
    ell('Gorget shoulder R', (-.235, -.02, 3.455), (.200, .185, .135), steel, 'neck'),
], .017, .24, steel, 1, 'neck')
crisp(gorget, 46)
# One gold ring here, not two. Pass one stacked the helm band, both gorget rims and the
# breastplate roll within a hand's width and the neck read as a jewellery box.
tube('Gorget lower rim', conformed([(.290 * math.sin(a), -.02 - .265 * math.cos(a), 3.395)
                                    for a in [2 * math.pi * i / 24 for i in range(24)]], gorget, .010),
     .026, gold, 'neck', cyclic=True, res=2, segments=2)

# ---------------------------------------------------------------- cuirass
# Front and back are separate pieces with a finger of mail showing between them at
# the flanks, which is what stops full plate reading as a single welded barrel.
# Pectoral lumps made the first pass read as a bare silver torso; a single deep keeled
# plate with a raised medial crest reads as forged armour instead.
# A peascod: one smoothly convex plate whose medial keel stands barely a finger proud
# and swells lowest, over the belly. Pass two pushed a fat keel ellipsoid well clear of
# the chest and left a deep groove with a lobe either side of it -- from the front the
# champion had pectorals, which is the one thing a breastplate must never have.
breastplate = union('Breastplate', [
    ell('Breast chest', (0, -.100, 3.26), (.358, .198, .320), steel, 'chest'),
    ell('Breast keel', (0, -.180, 3.04), (.180, .150, .330), steel, 'chest'),
    ell('Breast keel crest', (0, -.252, 3.00), (.046, .080, .280), steel, 'chest'),
    ell('Breast upper', (0, -.090, 3.46), (.340, .176, .135), steel, 'chest'),
    ell('Breast waist', (0, -.100, 2.84), (.272, .172, .180), steel, 'chest'),
    ell('Breast flank L', (.30, -.120, 3.10), (.125, .132, .235), steel, 'chest'),
    ell('Breast flank R', (-.30, -.120, 3.10), (.125, .132, .235), steel, 'chest'),
], .016, .22, steel, 1, 'chest')
backplate = union('Backplate', [
    ell('Back plate', (0, .13, 3.20), (.320, .175, .320), steel, 'chest'),
    ell('Back upper', (0, .11, 3.46), (.305, .160, .125), steel, 'chest'),
    ell('Back waist', (0, .11, 2.86), (.265, .155, .175), steel, 'chest'),
    ell('Back flank L', (.27, .14, 3.10), (.115, .115, .210), steel, 'chest'),
    ell('Back flank R', (-.27, .14, 3.10), (.115, .115, .210), steel, 'chest'),
], .019, .19, steel, 1, 'chest')
# The medial keel is the whole point of a breastplate, and a relaxed voxel union hides it
# unless the shading is split along it.
crisp(breastplate, 44)
crisp(backplate, 48)
# Rolled and gilded neckline, sitting on the top edge of the plate. Pass one ran it low
# and far forward and it hung off the chest like a lasso.
neckline = [(.234 * math.sin(a), -.100 - .178 * math.cos(a), 3.556 + .044 * math.cos(a))
            for a in [math.radians(-118 + 236 * i / 16) for i in range(17)]]
tube('Breast neck roll', conformed(neckline, breastplate, .016), .024, gold, 'chest',
     lambda t: .8 + .4 * math.sin(math.pi * t), res=2, segments=3)
for s, L in SIDES:
    hole = [(s * (.32 + .06 * math.sin(a)), -.06 - .19 * math.cos(a) * .8, 3.26 + .21 * math.sin(a + 1.3))
            for a in [2 * math.pi * i / 12 for i in range(12)]]
    tube('Arm hole rim', conformed(hole, breastplate, .012), .019, steel, 'chest', cyclic=True, res=1, segments=3)
waist_edge = [(.268 * math.sin(a), -.12 - .215 * math.cos(a), 2.705 + .030 * math.cos(a))
              for a in [math.radians(-108 + 216 * i / 14) for i in range(15)]]
tube('Breast waist roll', conformed(waist_edge, breastplate, .014), .020, steel, 'chest', res=1, segments=3)
# Shoulder straps buckle the backplate to the breastplate over the top of each shoulder.
for s, L in SIDES:
    strap = conformed([(s * .17, .13, 3.44), (s * .19, .04, 3.53), (s * .19, -.08, 3.48), (s * .18, -.16, 3.40)],
                      breastplate, .02)
    ribbon('Cuirass shoulder strap', strap, .085, leather, 'chest', breastplate, .012, .018)
    buckle('Cuirass strap buckle', (s * .185, -.13, 3.43), .075, .060, 'chest', breastplate, .034,
           right=(1, 0, 0), radius=.011)
for p in ((.20, -.24, 3.36), (-.20, -.24, 3.36), (0, -.31, 3.44), (.29, -.13, 2.96), (-.29, -.13, 2.96)):
    patch('Cuirass rivet', p, (.020, .012, .020), gold, 'chest', breastplate, .020)

# ---------------------------------------------------------------- surcoat
# Blue heraldic cloth worn beneath the plate, showing as a skirt below the fauld.
def surcoat(name, y0, drift, top_z, bottom_z, w_top, w_bottom, cols, rows, sign):
    verts = []; weights = []
    for r in range(rows + 1):
        f = r / rows; z = top_z + (bottom_z - top_z) * f
        w = w_top + (w_bottom - w_top) * f
        for c in range(cols + 1):
            g = c / cols; x = (g - .5) * w
            y = y0 + sign * drift * f ** 1.25 + .020 * math.sin(g * math.pi * 4) * f
            if r == rows: z += .012 * math.sin(g * math.pi * 6) + random.uniform(-.010, .010)
            verts.append((x, y, z)); weights.append(1 if r == 0 else .55 if r == 1 else 0)
    faces = [(r * (cols + 1) + c, r * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c + 1, (r + 1) * (cols + 1) + c)
             for r in range(rows) for c in range(cols)]
    o = mesh(name, verts, faces, cloth_blue, 'hips')
    group = o.vertex_groups.new(name='tucked under the plate')
    for i, w in enumerate(weights):
        if w: group.add([i], w, 'REPLACE')
    m = o.modifiers.new('Drape', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    m = o.modifiers.new('Tuck', 'SHRINKWRAP'); m.target = body; m.wrap_method = 'NEAREST_SURFACEPOINT'
    m.offset = .035; m.vertex_group = 'tucked under the plate'; apply_modifier(o, m)
    m = o.modifiers.new('Cloth thickness', 'SOLIDIFY'); m.thickness = .016; m.offset = 0; apply_modifier(o, m)
    smooth(o); return o
surcoat_front = surcoat('Surcoat front', -.34, .16, 2.60, 1.40, .68, .96, 12, 8, 1)
surcoat_back = surcoat('Surcoat back', .29, .12, 2.60, 1.48, .62, .84, 10, 6, -1)
for panel, z, w, sgn in ((surcoat_front, 1.42, .96, 1), (surcoat_back, 1.50, .84, -1)):
    hem = [((i / 10 - .5) * w * 1.0, (-.34 if sgn > 0 else .29) + sgn * .16, z + .02) for i in range(11)]
    tube('Surcoat hem trim', conformed(hem, panel, .014), .022, gold, 'hips', res=1, segments=3)
for x in (-.235, .235):
    trim = [(x, -.34 + .16 * (f ** 1.25), 2.52 - (2.52 - 1.46) * f) for f in [i / 6 for i in range(7)]]
    tube('Surcoat pale', conformed(trim, surcoat_front, .012), .017, gold, 'hips', res=1, segments=3)

# ---------------------------------------------------------------- fauld, tassets and belt
fauld_lames = []
for k in range(3):
    top = 2.755 - k * .150
    fauld_lames.append(band(f'Fauld lame {k + 1}', top, top - .205, .326 + .026 * k, .344 + .030 * k,
                            -.04, -180, 180, .034, steel, 'hips', nu=2, nv=24, bevel=.013))
for k, lame in enumerate(fauld_lames):
    for i in range(7):
        a = math.radians(-72 + 24 * i)
        patch('Fauld rivet', ((.326 + .026 * k) * math.sin(a), -.04 - (.326 + .026 * k) * .86 * math.cos(a),
                              2.745 - k * .150), (.019, .011, .019), gold, 'hips', lame, .016)
# Narrower and shorter than pass one, which wrapped the whole front of the hips and hid
# the blue surcoat the heraldry is supposed to live on.
for s, L in SIDES:
    a, b = (s * .25, -.06, 2.38), (s * .30, -.11, 1.94)
    sleeve(f'Tasset {L}', a, b, 0, 1, .335, .330, -46, 46, .034, steel, 'hips', nu=5, nv=12, bevel=.013)
belt = band('Sword belt', 2.20, 2.06, .355, .372, -.04, -180, 180, .030, leather, 'hips', nu=2, nv=22, bevel=.008)
tube('Belt piping', conformed([( .358 * math.sin(a), -.04 - .358 * .86 * math.cos(a), 2.185)
                               for a in [2 * math.pi * i / 22 for i in range(22)]], belt, .006),
     .011, leather_edge, 'hips', cyclic=True, res=1, segments=2)
buckle('Belt buckle', (0, -.40, 2.13), .175, .130, 'hips', belt, .034, right=(1, 0, 0), radius=.020)
ribbon('Belt tongue', conformed([(.09, -.38, 2.12), (.19, -.36, 2.11), (.29, -.30, 2.10)], belt, .014),
       .085, leather, 'hips', belt, .020, .014)
for i in range(6):
    a = math.radians(-140 + 56 * i)
    patch('Belt stud', (.360 * math.sin(a), -.04 - .360 * .86 * math.cos(a), 2.135),
          (.018, .011, .018), gold, 'hips', belt, .018)

# ---------------------------------------------------------------- pauldrons and arm harness
for s, L in SIDES:
    j = joints[L]
    arm_a, arm_b = j['shoulder'], j['elbow']
    inner, outer = s * -58, s * 205
    # The top cap rides the collarbone and stays with the chest; the lames below it are
    # strapped to the arm, so they slide out from under the cap as the shoulder swings.
    # Broad lames that clearly overhang the arm are the single strongest cue that a
    # figure is in heavy plate; the first pass's small domes read as tennis balls.
    # The haute-piece is a surface of revolution about a downward, slightly splayed axis:
    # a domed plate whose lower edge rolls outward into a flared, bevelled lip. Modelling
    # it as a shell rather than a union is what buys the edge -- pass one's ellipsoid cap
    # had no edge at all and read as a tennis ball balanced on the shoulder.
    apex = Vector((s * .450, -.020, 3.682))
    down = Vector((s * math.sin(math.radians(15)), 0, -math.cos(math.radians(15))))
    fwd = Vector((0, -1, 0)); across = fwd.cross(down).normalized()
    def cap_P(u, v, apex=apex, down=down, fwd=fwd, across=across, s=s):
        ang = math.radians(-70 + 318 * v) * s
        r = .276 * math.sin(u * math.pi * .46) / .992 + .050 * u ** 5
        h = .286 * (1 - math.cos(u * math.pi * .62))
        return apex + down * h + (fwd * math.cos(ang) + across * math.sin(ang)) * r
    shell(f'Pauldron cap {L}', cap_P, lambda u, v: .028 + .014 * u, 7, 20, steel, 'chest',
          out=lambda u, v: fwd, bevel=.016)
    # A forged crown boss plugs the point where the sector's two open edges converge.
    # Left bare it is a thin wedge of shell rim standing up beside the neck, and the
    # detail render found it every time.
    ell(f'Pauldron crown {L}', tuple(apex + down * .052), (.120, .126, .088), steel, 'chest')
    tube('Pauldron cap rim', [tuple(cap_P(1.0, i / 21)) for i in range(22)],
         .021, gold, 'chest', res=1, segments=3)
    # Lames start below the cap's lip so they slide out from under it, and they taper as
    # they run down the arm instead of flaring into a second set of shoulders.
    for k in range(3):
        lame = sleeve(f'Pauldron lame {k + 1} {L}', arm_a, arm_b, .23 + .145 * k, .44 + .145 * k,
                      .268 - .020 * k, .262 - .026 * k, inner, outer, .034, steel, f'upper_arm.{L}',
                      nu=3, nv=14, bevel=.014)
        for i in range(3):
            ang = math.radians((inner + outer) / 2 + (i - 1) * s * 55)
            origin, _, axis, front, side = limb_axes(arm_a, arm_b)
            p = origin + axis * (.28 + .145 * k) + (front * math.cos(ang) + side * math.sin(ang)) * (.264 - .022 * k)
            patch('Pauldron rivet', p, (.019, .011, .019), gold, f'upper_arm.{L}', lame, .014)
    sleeve(f'Rerebrace {L}', arm_a, arm_b, .48, .74, .172, .162, s * -168, s * 168, .030, steel,
           f'upper_arm.{L}', nu=3, nv=14, bevel=.012)
    fore_a, fore_b = j['elbow'], j['wrist']
    couter = union(f'Couter {L}', [
        ell('Couter cop', j['elbow'], (.150, .150, .130), steel, f'forearm.{L}'),
        ell('Couter point', Vector(j['elbow']) + Vector((s * .05, -.09, .01)), (.100, .090, .095), steel, f'forearm.{L}'),
    ], .014, .24, steel, 1, f'forearm.{L}')
    crisp(couter, 46)
    sleeve(f'Couter fan {L}', fore_a, fore_b, -.10, .12, .175, .170, s * -95, s * 95, .022, steel,
           f'forearm.{L}', nu=3, nv=12, bevel=.009)
    sleeve(f'Vambrace {L}', fore_a, fore_b, .18, .60, .140, .124, s * -170, s * 170, .024, steel,
           f'forearm.{L}', nu=3, nv=14, bevel=.009)
    strap_o, strap_len, strap_axis, strap_front, strap_side = limb_axes(fore_a, fore_b)
    for d in (.24, .52):
        loop = [strap_o + strap_axis * d + (strap_front * math.cos(a) + strap_side * math.sin(a)) * .142
                for a in [2 * math.pi * i / 14 for i in range(14)]]
        tube('Vambrace strap', loop, .014, leather, f'forearm.{L}', cyclic=True, res=1, segments=3)
    patch('Couter rivet', Vector(j['elbow']) + Vector((s * .12, -.05, .02)), (.019, .011, .019),
          gold, f'forearm.{L}', couter, .014)

# ---------------------------------------------------------------- gauntlets
# The right fist closes on the sword grip, the left on the shield's enarme.
def gauntlet(s, L, grip_dir, grip_point):
    bone = f'hand.{L}'
    j = joints[L]
    wrist = Vector(j['wrist']); centre = Vector(grip_point)
    axis = Vector(grip_dir).normalized()
    forward = (centre - wrist).normalized()
    across = axis.cross(forward).normalized()
    fist = union(f'Gauntlet fist {L}', [
        ell('Metacarpal plate', centre + forward * .045, (.115, .115, .105), steel, bone),
        ell('Fist heel', centre - forward * .045 + across * (s * .01), (.105, .105, .100), steel, bone),
        ell('Knuckle block', centre + forward * .080 + axis * .045, (.100, .080, .075), steel, bone),
        ell('Thumb pad', centre + forward * .045 - axis * .085, (.070, .075, .065), steel, bone),
    ], .015, .30, steel, 1, bone)
    # Finger lames wrapping the grip: three ridges plus a thumb over the top.
    for k in range(3):
        off = axis * (.055 - .050 * k) + forward * .052
        ring = [centre + off + (forward * math.cos(a) + across * math.sin(a)) * .078
                for a in [math.radians(-160 + 300 * i / 9) for i in range(10)]]
        tube('Finger lame', conformed(ring, fist, .008), .020, steel, bone, res=1, segments=3)
    thumb = [centre - axis * .080 + forward * .020, centre - axis * .055 + forward * .075,
             centre + axis * .005 + forward * .098]
    tube('Gauntlet thumb', conformed(thumb, fist, .012), .030, steel, bone,
         lambda t: 1 - .25 * t, res=1, segments=3)
    cuff = union(f'Gauntlet cuff {L}', [
        ell('Cuff bell', wrist + (centre - wrist) * .10, (.140, .140, .130), steel, bone),
        ell('Cuff flare', wrist - (centre - wrist) * .25, (.165, .165, .140), steel, bone),
    ], .015, .22, steel, 1, bone)
    _, _, cax, cfront, cside = limb_axes(j['elbow'], j['wrist'])
    loop = [Vector(j['wrist']) - cax * .06 + (cfront * math.cos(a) + cside * math.sin(a)) * .162
            for a in [2 * math.pi * i / 16 for i in range(16)]]
    tube('Gauntlet cuff rim', conformed(loop, cuff, .010), .020, gold, bone, cyclic=True, res=1, segments=3)
    for i in range(4):
        a = 2 * math.pi * i / 4 + .4
        patch('Cuff rivet', Vector(j['wrist']) + cax * .02 + (cfront * math.cos(a) + cside * math.sin(a)) * .14,
              (.017, .010, .017), gold, bone, cuff, .014)
    return fist

# ---------------------------------------------------------------- longsword
# Held point-forward-down at the right side: a fullered blade, a gold cross-guard with
# flared ends, a leather-wrapped grip and a gold wheel pommel.
FIST_R = Vector((-.67, -.40, 2.10))
# Carried closer to the vertical than pass one, which held it out at nearly forty-five
# degrees and made a broad, weedy triangle of the whole right side of the silhouette.
SWORD_DIR = Vector((-.045, -.420, -.906)).normalized()
SWORD_ACROSS = Vector((.62, -.78, 0))
SWORD_ACROSS = (SWORD_ACROSS - SWORD_DIR * SWORD_ACROSS.dot(SWORD_DIR)).normalized()
SWORD_FLAT = SWORD_DIR.cross(SWORD_ACROSS).normalized()
SWORD_TIP = FIST_R + SWORD_DIR * 2.10

def sword_point(t, c, b):
    return FIST_R + SWORD_DIR * t + SWORD_ACROSS * c + SWORD_FLAT * b

def blade_profile(c):
    """Half-thickness across the blade: a lens with a fuller ground down the centre."""
    return max(.02, (1 - c * c) ** .40 - .40 * math.exp(-(c / .27) ** 2))

BLADE_T0, BLADE_T1 = .30, 2.10
rings = 18; around = 16
verts = []
for i in range(rings + 1):
    f = i / rings
    t = BLADE_T0 + (BLADE_T1 - BLADE_T0) * f
    # Width tapers steadily, then runs out to a point over the last twelfth.
    taper = 1 - .48 * f
    if f > .90: taper *= max(.02, 1 - (f - .90) / .10)
    w = .174 * taper; th = .034 * (1 - .40 * f) * (1 if f < .90 else max(.10, 1 - (f - .90) / .10))
    for k in range(around):
        a = 2 * math.pi * k / around
        c = math.cos(a)
        verts.append(sword_point(t, c * w, math.copysign(blade_profile(c), math.sin(a)) * th))
faces = [(i * around + k, (i + 1) * around + k, (i + 1) * around + (k + 1) % around, i * around + (k + 1) % around)
         for i in range(rings) for k in range(around)]
faces.append(tuple(range(around - 1, -1, -1)))
faces.append(tuple(range(rings * around, (rings + 1) * around)))
blade = mesh('Longsword blade', verts, faces, blade_steel, 'sword')
activate(blade); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
smooth(blade); crisp(blade, 34)
guard_path = [sword_point(.19, .36, 0), sword_point(.250, .19, 0), sword_point(.27, 0, 0),
              sword_point(.250, -.19, 0), sword_point(.19, -.36, 0)]
tube('Cross-guard', guard_path, .046, gold, 'sword',
     lambda t: .85 + .55 * abs(math.cos(math.pi * t)) ** 2 - .25 * math.sin(math.pi * t), res=2, segments=4)
union('Guard block', [
    ell('Guard écusson', sword_point(.28, 0, 0), (.082, .066, .058), gold, 'sword'),
    ell('Guard collar', sword_point(.23, 0, 0), (.098, .082, .050), gold, 'sword'),
], .011, .40, gold, 1, 'sword')
rod('Sword grip core', tuple(sword_point(.20, 0, 0)), tuple(sword_point(-.26, 0, 0)), .052, .044, leather, 'sword', 14)
wrap = []
for i in range(22):
    f = i / 21
    a = f * math.tau * 3.6
    r = .054 - .006 * f
    wrap.append(tuple(sword_point(.17 - .40 * f, math.cos(a) * r, math.sin(a) * r)))
tube('Grip leather wrap', wrap, .016, leather_edge, 'sword', res=1, segments=3)
pommel_basis = Matrix((SWORD_ACROSS, SWORD_FLAT, SWORD_DIR)).transposed()
union('Wheel pommel', [
    ell('Pommel wheel', tuple(sword_point(-.31, 0, 0)), (.102, .038, .102), gold, 'sword', basis=pommel_basis),
    ell('Pommel hub', tuple(sword_point(-.31, 0, 0)), (.054, .058, .054), gold, 'sword', basis=pommel_basis),
    ell('Pommel neck', tuple(sword_point(-.26, 0, 0)), (.052, .052, .040), gold, 'sword', basis=pommel_basis),
], .011, .40, gold, 1, 'sword')
gauntlet(-1, 'R', SWORD_DIR, FIST_R)

# ---------------------------------------------------------------- kite shield
# Blue field, gold rim and boss, a bold gold cross: readable from every camera angle
# in a way a heraldic beast would not be at this size.
SHIELD_O = Vector((.84, -.60, 2.66))
SHIELD_M = (Matrix.Rotation(math.radians(16), 3, 'Z') @ Matrix.Rotation(math.radians(-10), 3, 'X'))
SHIELD_HW, SHIELD_H, SHIELD_TOP, SHIELD_DISH = .50, 1.66, .72, .15
def shield_hw(t):
    return SHIELD_HW * ((1 - t) ** .8) * (.90 + 1.68 * t * (1 - t))
def shield_point(s, t, off=0):
    s = max(-1.0, min(1.0, s))
    x = s * shield_hw(t)
    z = SHIELD_TOP + .13 * (1 - s * s) ** .6 * (1 - t) ** 4 - SHIELD_H * t
    y = -SHIELD_DISH * (1 - s * s) * (.35 + .65 * math.sin(math.pi * min(1, .12 + .88 * (1 - t))))
    return SHIELD_O + SHIELD_M @ Vector((x, y - off, z))
def shield_out(s, t):
    return SHIELD_M @ Vector((0, -1, 0))
shield = shell('Kite shield', lambda u, v: shield_point(2 * u - 1, v), .048, 13, 18, cloth_blue, 'shield',
               out=lambda u, v: shield_out(0, 0), bevel=.012)
# The path must not double back on a repeated point: pass one closed the loop on a
# duplicate of its own first vertex and the auto handles threw a gold spike off the
# top right corner that read as a spearhead growing out of the shield.
rim_path = ([tuple(shield_point(1 - 2 * i / 10, 0, .002)) for i in range(11)]
            + [tuple(shield_point(-1, i / 10, .002)) for i in range(1, 10)]
            + [tuple(shield_point(0, 1, .002))]
            + [tuple(shield_point(1, 1 - i / 10, .002)) for i in range(1, 10)])
tube('Shield gold rim', rim_path, .042, gold, 'shield', cyclic=True, res=2, segments=3)
def cross_bar(name, x0, x1, t0, t1, nu, nv):
    def P(u, v):
        t = t0 + (t1 - t0) * v
        x = x0 + (x1 - x0) * u
        return shield_point(x / max(.02, shield_hw(t)), t, .030)
    return shell(name, P, .026, nu, nv, gold, 'shield', out=lambda u, v: shield_out(0, 0), bevel=.008)
cross_bar('Shield cross pale', -.085, .085, .06, .95, 4, 20)
cross_bar('Shield cross fess', -.335, .335, .285, .445, 14, 4)
boss = union('Shield boss', [
    ell('Boss dome', tuple(shield_point(0, .365, .055)), (.135, .135, .135), gold, 'shield'),
    ell('Boss flange', tuple(shield_point(0, .365, .015)), (.175, .175, .175), gold, 'shield'),
    ell('Boss spike', tuple(shield_point(0, .365, .105)), (.055, .055, .055), gold, 'shield'),
], .018, .24, gold, 1, 'shield')
for i in range(6):
    a = 2 * math.pi * i / 6
    patch('Boss rivet', tuple(shield_point(.30 * math.cos(a), .365 + .11 * math.sin(a), .055)),
          (.020, .012, .020), gold, 'shield', shield, .008)
for t, x in ((.10, .0), (.62, .0), (.365, -.30), (.365, .30)):
    patch('Shield stud', tuple(shield_point(x / max(.02, shield_hw(t)), t, .030)),
          (.026, .014, .026), gold, 'shield', shield, .012)
# Enarmes on the back: the straps the forearm passes through, plus the hand grip.
for t in (.30, .50):
    strap = [tuple(shield_point(x, t, -.030)) for x in (-.62, -.2, .2, .62)]
    ribbon('Shield enarme', strap, .085, leather, 'shield', shield, -.052, .018)
grip = [tuple(shield_point(x, .60, -.075)) for x in (-.40, 0, .40)]
tube('Shield hand grip', grip, .030, leather, 'shield', res=1, segments=3)
gauntlet(1, 'L', shield_point(1, .60) - shield_point(-1, .60), shield_point(0, .60, -.115))

# ---------------------------------------------------------------- leg harness
for s, L in SIDES:
    j = joints[L]
    hip, knee, ankle = j['hip'], j['knee'], j['ankle']
    sleeve(f'Cuisse {L}', hip, knee, .12, .80, .265, .222, s * -116, s * 116, .036, steel,
           f'thigh.{L}', nu=5, nv=12, bevel=.014)
    thigh_o, _, thigh_ax, thigh_front, thigh_side = limb_axes(hip, knee)
    for d in (.22, .70):
        loop = [thigh_o + thigh_ax * d + (thigh_front * math.cos(a) + thigh_side * math.sin(a)) * .238
                for a in [math.radians(-150 + 300 * i / 12) for i in range(13)]]
        tube('Cuisse strap', loop, .015, leather, f'thigh.{L}', res=1, segments=3)
    poleyn = union(f'Poleyn {L}', [
        ell('Knee cop', Vector(knee) + Vector((0, -.085, 0)), (.175, .140, .180), steel, f'shin.{L}'),
        ell('Knee point', Vector(knee) + Vector((0, -.165, -.020)), (.110, .090, .115), steel, f'shin.{L}'),
    ], .014, .24, steel, 1, f'shin.{L}')
    crisp(poleyn, 46)
    sleeve(f'Poleyn wing {L}', knee, ankle, -.12, .12, .214, .210, s * 18, s * 142, .028, steel,
           f'shin.{L}', nu=3, nv=10, bevel=.012)
    patch('Poleyn rivet', Vector(knee) + Vector((s * .03, -.185, .01)), (.021, .012, .021),
          gold, f'shin.{L}', poleyn, .012)
    sleeve(f'Greave front {L}', knee, ankle, .16, .86, .198, .152, s * -130, s * 130, .034, steel,
           f'shin.{L}', nu=5, nv=12, bevel=.013)
    sleeve(f'Greave calf {L}', knee, ankle, .18, .80, .194, .154, s * 150, s * 210, .030, steel,
           f'shin.{L}', nu=5, nv=8, bevel=.012)
    shin_o, _, shin_ax, shin_front, shin_side = limb_axes(knee, ankle)
    for d in (.30, .70):
        loop = [shin_o + shin_ax * d + (shin_front * math.cos(a) + shin_side * math.sin(a)) * .180
                for a in [2 * math.pi * i / 14 for i in range(14)]]
        tube('Greave strap', loop, .014, leather, f'shin.{L}', cyclic=True, res=1, segments=3)
    # Sabaton: an ankle cop, an instep plate, three toe lames and a pointed cap.
    sab = union(f'Sabaton {L}', [
        ell('Ankle cop', (s * .33, .01, .27), (.150, .155, .130), steel, f'foot.{L}'),
        ell('Instep', (s * .33, -.14, .155), (.155, .195, .130), steel, f'foot.{L}'),
        ell('Sole heel', (s * .33, .10, .085), (.135, .125, .085), steel, f'foot.{L}'),
        ell('Toe cap', (s * .33, -.44, .085), (.105, .120, .080), steel, f'foot.{L}'),
        ell('Toe point', (s * .33, -.58, .075), (.060, .075, .055), steel, f'foot.{L}'),
    ], .016, .21, steel, 1, f'foot.{L}')
    crisp(sab, 46)
    for k in range(3):
        y = -.24 - .105 * k
        r = .135 - .020 * k
        def lame_P(u, v, y=y, r=r, s=s):
            ang = math.radians(-96 + 192 * v)
            return Vector((s * .33 + math.sin(ang) * r * 1.02,
                           y - .045 * u, .085 + math.cos(ang) * r * (1 - .10 * u)))
        shell(f'Sabaton lame {k + 1} {L}', lame_P, .024, 2, 10, steel, f'foot.{L}',
              out=lambda u, v: Vector((math.sin(math.radians(-96 + 192 * v)), 0,
                                       math.cos(math.radians(-96 + 192 * v)))), bevel=.008)
    patch('Sabaton rivet', (s * .33, -.13, .285), (.019, .011, .019), gold, f'foot.{L}', sab, .012)

# ---------------------------------------------------------------- bones (pre-scale)
bones = {
    'root': ((0, 0, 0), (0, 0, .30), None),
    'hips': ((0, -.02, 2.30), (0, -.03, 2.80), 'root'),
    'chest': ((0, -.03, 2.80), (0, -.04, 3.52), 'hips'),
    'neck': ((0, -.04, 3.52), (0, -.04, 3.74), 'chest'),
    'head': ((0, -.04, 3.74), (0, -.05, 4.38), 'neck'),
    'plume': ((0, .05, 4.22), (0, .10, 4.92), 'head'),
    'sword': (tuple(FIST_R), tuple(SWORD_TIP), 'hand.R'),
    'shield': (tuple(SHIELD_O), tuple(SHIELD_O + SHIELD_M @ Vector((0, 0, .70))), 'forearm.L'),
}
for s, L in SIDES:
    j = joints[L]
    bones[f'upper_arm.{L}'] = (j['shoulder'], j['elbow'], 'chest')
    bones[f'forearm.{L}'] = (j['elbow'], j['wrist'], f'upper_arm.{L}')
    bones[f'hand.{L}'] = (j['wrist'], j['hand'], f'forearm.{L}')
    bones[f'thigh.{L}'] = (j['hip'], j['knee'], 'hips')
    bones[f'shin.{L}'] = (j['knee'], j['ankle'], f'thigh.{L}')
    bones[f'foot.{L}'] = (j['ankle'], j['foot'], f'shin.{L}')

# Blend the mail weights across neighbouring anatomy so the joints deform smoothly.
# Every plate stays a rigid island bound to one bone, exactly as real armour behaves.
for name in bones: body.vertex_groups.new(name=name)
for vertex in body.data.vertices:
    nearby = tree.find_n(vertex.co, 18)
    closest = {}
    for _, idx, distance in nearby:
        name = samples[idx][1]
        closest[name] = min(distance, closest.get(name, 100))
    nearest = min(closest.values())
    weights = {name: math.exp(-((d - nearest) / .060) ** 2) for name, d in closest.items()}
    weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:3])
    weights = {name: w for name, w in weights.items() if w > .003}
    total = sum(weights.values())
    for name, w in weights.items():
        body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')

# ---------------------------------------------------------------- assemble one skinned mesh
for o in parts:
    activate(o)
    for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if not o.get('weighted_body'):
        group = o.vertex_groups.new(name=o['bone']); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
# Sabatons on the floor plane, plume tip at the contract height: derive the scale from
# the sculpt rather than trusting hand-placed coordinates.
low = min((o.matrix_world @ v.co).z for o in parts for v in o.data.vertices)
high = max((o.matrix_world @ v.co).z for o in parts for v in o.data.vertices)
SCALE = TARGET_HEIGHT / (high - low)
if FAST:
    budget = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for o in parts), reverse=True)
    print(f'AUTHOR HEIGHT {high - low:.4f} low {low:.4f} -> SCALE {SCALE:.5f}')
    for count, name in budget[:30]: print(f'TRIANGLES {count:7d} {name}')
    print(f'TRIANGLES {sum(c for c, _ in budget):7d} TOTAL over {len(parts)} parts')
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Knight_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices:
    v.co.z -= low
    v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural steel, mail, gold, leather and cloth into three embedded 2K maps.
    sys.path.insert(0, str(ROOT / 'tools'))
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', prefix='knight')

rig_data = bpy.data.armatures.new('Knight_Skeleton')
rig = bpy.data.objects.new('Knight_Rig', rig_data); bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; rig.select_set(True); character.select_set(False)
bpy.ops.object.mode_set(mode='EDIT')
def place(p): return (Vector(p) - Vector((0, 0, low))) * SCALE
pending = list(bones.items())
while pending:
    # The sword and shield hang off hands and forearms declared later in the table, so
    # create bones only once their parent exists.
    ready = [(n, v) for n, v in pending if v[2] is None or v[2] in rig_data.edit_bones]
    if not ready: raise RuntimeError(f'orphan bones: {[n for n, _ in pending]}')
    for name, (a, b, parent) in ready:
        eb = rig_data.edit_bones.new(name); eb.head = place(a); eb.tail = place(b)
        if parent: eb.parent = rig_data.edit_bones[parent]
    pending = [item for item in pending if item not in ready]
bpy.ops.object.mode_set(mode='OBJECT')
mod = character.modifiers.new('Knight skeleton', 'ARMATURE'); mod.object = rig
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

def shift(b, dx=0, dy=0, dz=0):
    # Translate a bone along character axes; +x right-to-left, -y forward, +z up.
    basis = rig_data.bones[b].matrix_local.to_3x3()
    rig.pose.bones[b].location = basis.inverted() @ Vector((dx, dy, dz))

def curve(t, keys):
    for (a, v), (b, w) in zip(keys, keys[1:]):
        if t <= b:
            u = max(0, min(1, (t - a) / (b - a))); u = u * u * (3 - 2 * u)
            return v + (w - v) * u
    return keys[-1][1]

def bump(t, center, width):
    k = max(0, 1 - abs(t - center) / width)
    return math.sin(k * math.pi / 2)

def idle(t):
    """Three seconds of armoured breathing: the chest swells, the weight rocks between
    the feet, the shield is hitched back up twice, and the helm sweeps the room."""
    breath = math.sin(t * math.tau)
    rock = math.sin(t * math.tau)
    look = curve(t, [(0, 0), (.13, 0), (.29, .30), (.45, .30), (.62, -.26), (.80, -.26), (1, 0)])
    trail = curve((t - .07) % 1.0, [(0, 0), (.13, 0), (.29, .30), (.45, .30), (.62, -.26), (.80, -.26), (1, 0)])
    hitch = max(bump(t, .21, .075), bump(t, .74, .075))
    shift('root', .010 * rock, 0, .009 * breath)
    rot('hips', .006 * breath, .022 * rock, .020 * rock)
    rot('chest', -.024 * breath, -.010 * rock, -.020 * rock)
    rig.pose.bones['chest'].scale.y = 1 + .012 * breath
    rot('neck', .012 * breath, 0, .22 * look)
    rot('head', -.016 * breath, .045 * math.sin(t * math.tau * 2), .74 * look)
    rot('plume', -.05 * breath, 0, .55 * trail)
    # Shield arm: settles, then twice pulls the kite shield back up the forearm.
    rot('upper_arm.L', -.05 * breath - .16 * hitch, 0, .03 * rock)
    rot('forearm.L', -.10 * hitch, 0, -.05 * hitch)
    rot('shield', .05 * hitch, .07 * hitch, -.04 * breath)
    rot('hand.L', -.08 * hitch)
    # Sword arm hangs, the wrist letting the blade drift a little.
    rot('upper_arm.R', .035 * breath, 0, -.028 * rock)
    rot('forearm.R', -.030 * breath)
    rot('sword', .035 * math.sin(t * math.tau + 1.1), 0, .03 * rock)
    for L in ('L', 'R'):
        rot(f'thigh.{L}', 0, .012 * rock); rot(f'foot.{L}', .010 * breath)

def walk(t):
    """A one second armoured march: short heavy strides, the sword swinging at the side,
    the shield rocking across the chest and the plume nodding on every footfall."""
    w = math.sin(t * math.tau)
    shift('root', .014 * w, 0, .026 * (1 - math.cos(t * math.tau * 2)) - .005)
    rot('hips', .020, .050 * w, .055 * w)
    rot('chest', .050, -.020 * w, -.048 * w)
    for L, s in (('L', 1), ('R', -1)):
        stride = s * w
        rot(f'thigh.{L}', .46 * stride)
        rot(f'shin.{L}', -max(0, stride) * .70)
        rot(f'foot.{L}', -.15 * stride + max(0, stride) * .22)
    rot('upper_arm.R', -.28 * w, 0, -.055); rot('forearm.R', -.16 - .10 * max(0, -w))
    rot('sword', .10 * w)
    rot('upper_arm.L', -.12 - .07 * w, 0, .045); rot('forearm.L', -.14 + .05 * w)
    rot('shield', .04 * w, .06 * w, -.05 * w)
    rot('neck', -.020, 0, .020 * w); rot('head', -.030, 0, .016 * w)
    rot('plume', -.13 * math.cos(t * math.tau * 2), 0, .05 * w)

def attack(t):
    """Nine tenths of a second: wind the longsword up over the right shoulder, step behind
    the shield, chop down across the body, then recover to the guard."""
    swing = curve(t, [(0, 0), (.10, .18), (.33, 1.0), (.44, 1.05), (.58, -1.0), (.70, -.92), (.88, -.24), (1, 0)])
    guard = curve(t, [(0, 0), (.30, .35), (.56, 1), (.74, .60), (1, 0)])
    impact = math.exp(-((t - .60) / .05) ** 2) - math.exp(-((0 - .60) / .05) ** 2)
    arm = 2.10 * swing if swing > 0 else 1.05 * swing
    rot('upper_arm.R', arm, 0, -.55 * swing)
    rot('forearm.R', -.35 - .55 * max(0, swing) + .20 * max(0, -swing))
    rot('hand.R', .25 * swing)
    rot('sword', -.30 * swing, 0, .18 * swing)
    rot('chest', .10 - .16 * swing + .12 * impact, 0, -.30 * swing)
    rot('hips', 0, 0, -.14 * swing)
    rot('neck', -.04 - .06 * swing); rot('head', -.05 - .10 * swing, 0, .16 * swing)
    rot('plume', -.28 * swing, 0, .10 * swing)
    rot('upper_arm.L', -.36 * guard, 0, .12 * guard)
    rot('forearm.L', -.26 * guard, 0, -.10 * guard)
    rot('shield', .08 * guard, .10 * guard, -.14 * guard)
    rot('thigh.L', -.26 * guard); rot('shin.L', .12 * guard); rot('foot.L', .14 * guard)
    rot('thigh.R', .10 * guard); rot('shin.R', -.12 * guard)
    shift('root', .012 * guard, -.038 * guard, -.020 * guard)

def hit(t):
    """Half a second: the blow lands, the knight ducks behind the shield and the whole
    figure staggers back a pace onto the rear leg before straightening."""
    w = curve(t, [(0, 0), (.15, 1), (.35, .74), (.68, -.10), (1, 0)])
    rot('chest', -.24 * w, 0, .20 * w)
    rot('hips', -.06 * w, 0, .10 * w)
    rot('neck', -.13 * w, 0, .10 * w); rot('head', -.16 * w, 0, .12 * w)
    rot('plume', -.42 * w, 0, .14 * w)
    rot('upper_arm.L', -.58 * w, 0, .20 * w); rot('forearm.L', -.34 * w)
    rot('shield', -.10 * w, -.14 * w, -.10 * w)
    rot('upper_arm.R', .28 * w, 0, .12 * w); rot('forearm.R', -.20 * w)
    rot('sword', .22 * w)
    rot('thigh.R', -.18 * w); rot('shin.R', .26 * w); rot('foot.R', -.12 * w)
    rot('thigh.L', .14 * w); rot('shin.L', -.10 * w)
    shift('root', -.02 * w, .055 * w, -.030 * abs(w))

def death(t):
    """One and three fifths of a second: the knees buckle and the champion drops onto
    them, the shield arm gives way, and the whole armoured weight then pitches forward
    over the knees until the helm is almost on the floor and the sword hangs slack."""
    kneel = curve(t, [(0, 0), (.08, .10), (.38, 1), (1, 1)])
    fall = curve(t, [(0, 0), (.38, 0), (.66, .74), (.88, 1), (1, 1)])
    limp = curve(t, [(0, 0), (.30, .10), (.70, .70), (1, 1)])
    fold = 1.50 * kneel
    # The hips may sink only as far as the folding shin allows: this is exactly the
    # trigonometry the leg is doing, so the ankles hold station on the floor plane for
    # the whole descent. Driving the drop off its own curve instead put the sabatons a
    # fifth of a unit under the studio floor, which the clip's min-Y probe caught.
    shift('root', 0, .020 * fall, -.339 * (1 - math.cos(fold)))
    # The collapse hinges at the hips, over the knees, rather than rotating the whole
    # figure about the point between the feet -- but the legs are children of the hips,
    # so every degree of that pitch has to be taken straight back out of the thighs.
    pitch = .10 * kneel + .74 * fall
    rot('hips', pitch, 0, -.06 * fall)
    for L, s in (('L', 1), ('R', -1)):
        rot(f'thigh.{L}', -.06 * kneel - pitch, 0, s * .13 * kneel)
        rot(f'shin.{L}', fold)
        # Cancelling the shin's fold keeps each sabaton flat: rolling the foot over onto
        # its instep would have to pivot on the toe, and an FK chain cannot do that
        # without driving the toe through the floor on the way round.
        rot(f'foot.{L}', -fold)
    rot('chest', .10 * kneel + .56 * fall, 0, .12 * fall)
    rot('neck', .10 * kneel + .26 * limp); rot('head', .18 * kneel + .42 * limp, 0, -.14 * fall)
    rot('plume', -.20 * kneel + .50 * limp, 0, -.12 * fall)
    rot('upper_arm.L', -.26 * kneel - .34 * limp, 0, .42 * limp)
    rot('forearm.L', -.18 * kneel + .34 * limp)
    rot('shield', .34 * limp, -.36 * limp, .30 * limp)
    rot('upper_arm.R', .20 * kneel - .60 * limp, 0, -.30 * limp)
    rot('forearm.R', -.12 * kneel + .26 * limp)
    # The longsword rolls out of the dying fist and swings up clear of the ground as the
    # knight goes down, ending laid out ahead of him. Tied to the knee-drop rather than
    # the limpness so it clears early: the blade tip starts only a hand off the floor and
    # any sink at all buries three quarters of it.
    rot('sword', -1.85 * kneel - .40 * fall, 0, -.24 * limp)

pose('Idle', 91, idle); pose('Walk', 31, walk); pose('Attack', 28, attack)
pose('Hit', 17, hit); pose('Death', 49, death)
for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
scene.frame_set(1)
rig['reference'] = ('Dungeon Keeper 2 Knight: great helm with a narrow sight and a crimson plume, '
                    'full plate over a blue and gold surcoat, kite shield and longsword.')
rig['clips'] = 'Idle, Walk, Attack, Hit, Death'
rig['scale_note'] = f'Sabatons at ground; {TARGET_HEIGHT} units to the plume tip; Blender -Y / Babylon +Z forward.'

if FAST:
    # Sample every clip and report the lowest point of the deformed mesh, so a fall or a
    # lunge that drives the knight through the studio floor is caught without a render.
    for name, fn, count in (('Idle', idle, 5), ('Walk', walk, 5), ('Attack', attack, 5),
                            ('Hit', hit, 5), ('Death', death, 7)):
        lows = []
        for i in range(count):
            t = i / (count - 1)
            for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
            fn(t)
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            evaluated = character.evaluated_get(dg)
            m = evaluated.to_mesh()
            worst = min(m.vertices, key=lambda v: v.co.z)
            lows.append((worst.co.z, worst.co.x, worst.co.y))
            evaluated.to_mesh_clear()
        # Report where the lowest vertex is, not just how low: knowing that a dip is the
        # sword tip out in front rather than a sabaton is the difference between one
        # look-development pass and four.
        print('CLIP', name, 'min Y', ' '.join(f'{z:+.3f}@({x:+.2f},{y:+.2f})' for z, x, y in lows))
    for p in rig.pose.bones: p.location = (0, 0, 0); p.rotation_euler = (0, 0, 0); p.scale = (1, 1, 1)
    bpy.context.view_layer.update()

triangles = sum(len(p.vertices) - 2 for p in character.data.polygons)
if not FAST:
    # Export just the character; cameras, lights and the presentation floor stay in Blender.
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'knight.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    # The exporter evaluates every NLA clip and may leave the final sampled pose cached.
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'knight.stats.json').write_text(json.dumps({'triangles': triangles, 'vertices': len(character.data.vertices),
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
    o.data.energy = energy; o.data.color = color; o.data.shape = 'DISK'; o.data.size = size; aim(o, (0, 0, 1.0))
# Polished plate has nothing to reflect in an empty room, so the key and rim are large
# and soft and a broad overhead panel gives the steel a gradient to catch.
area('Warm key', (-3.0, -4.4, 5.0), 520, (1, .78, .54), 4.0)
area('Soft fill', (2.6, -2.6, 2.4), 180, (.65, .80, 1), 3.5)
area('Cool rim', (-1.2, 2.6, 3.6), 700, (.36, .73, 1), 2.6)
area('Overhead sheen', (.4, -1.0, 6.2), 260, (.74, .84, 1), 6.0)
bpy.ops.object.camera_add(location=(2.60, -6.6, 3.10)); cam = bpy.context.object
aim(cam, (-.02, -.14, .98)); cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.62; scene.camera = cam
scene.render.engine = 'CYCLES'; scene.cycles.samples = 20 if FAST else 52
scene.cycles.use_denoising = True
scene.render.threads_mode = 'FIXED'; scene.render.threads = 4
scene.world.color = (.075, .078, .085)
size = 720 if FAST else 1000
scene.render.resolution_x = size; scene.render.resolution_y = size; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.frame_end = 91
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'knight.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'knight-preview.png')
bpy.ops.render.render(write_still=True)
# A tight framing puts the helm, gorget, pauldrons and cuirass under the microscope.
cam.location = (1.9, -6.6, 2.30); aim(cam, (0, -.10, 1.50)); cam.data.ortho_scale = 1.00
scene.render.filepath = str(PREVIEW / 'knight-detail.png')
bpy.ops.render.render(write_still=True)
# The profile shows the plume sweep, the keeled breastplate, the leg harness and the sword.
cam.location = (-6.4, -.55, 1.90); aim(cam, (0, -.22, .98)); cam.data.ortho_scale = 2.62
scene.render.filepath = str(PREVIEW / 'knight-side.png')
bpy.ops.render.render(write_still=True)
print('KNIGHT_BUILD_COMPLETE', triangles, 'triangles')
