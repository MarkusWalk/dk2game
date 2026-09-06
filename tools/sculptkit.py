"""Shared sculpting toolkit for authored creatures (v2 method). Runs inside Blender 5.x, no add-ons.

Why v2: welding convex ellipsoids with a voxel remesh and smoothing can only produce
inflated forms. This kit builds structure instead:

- ``sweep``/``loft``: superellipse cross-sections along a path. Exponent ``n`` = 2 is an
  ellipse, 2.5-3.5 is a rounded box, so limbs, torsos and skulls get real planes.
- ``superellipsoid``: the same idea for isolated masses (cheekbones, knee caps, pauldrons).
- ``union_all``/``carve``: exact booleans instead of remeshing. Unions keep every plane and
  create creases at joints; carving gives eye sockets, mouths, nostrils and plate gaps.
- ``subdivide`` with ``crease_rings``: Catmull-Clark smoothing that keeps chosen edges sharp.
- ``mark_sharp``/``fillet``: crisp shading and small bevels on boolean seams.
- ``ribbon``/``patch``/``conformed``/``shell``: straps, studs and thin organic sheets that hug
  a sculpt, carried over from the first pipeline because they already worked.

Coordinates: authoring is done in "big units" with the creature facing -Y; the creature
script scales everything at assembly time.
"""
import bpy
import bmesh
import math
from mathutils import Vector

# ---------------------------------------------------------------- object helpers
def activate(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o

def apply_modifier(o, mod):
    activate(o); bpy.ops.object.modifier_apply(modifier=mod.name)

def smooth(o, on=True):
    for p in o.data.polygons: p.use_smooth = on

def recalc_normals(o):
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')

def signed_volume(o):
    m = o.data; vol = 0.0
    for p in m.polygons:
        vs = [m.vertices[i].co for i in p.vertices]
        for k in range(1, len(vs) - 1): vol += vs[0].cross(vs[k]).dot(vs[k + 1]) / 6
    return vol

def ensure_outward(o):
    """Booleans need outward normals; an inside-out operand makes an exact union vanish.
    The edit-mode recalculation is unreliable headless, so orient closed meshes by signed volume."""
    if signed_volume(o) < 0:
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.reverse_faces(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    return o

def mesh_object(name, verts, faces, mat=None):
    m = bpy.data.meshes.new(name); m.from_pydata([tuple(v) for v in verts], [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    if mat is not None: o.data.materials.append(mat)
    return o

def apply_transforms(o):
    activate(o); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def remove(o):
    bpy.data.objects.remove(o, do_unlink=True)

def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

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

def surface_detail(mat, scale, depth, color_variation=.15, stretch=(1, 1, 1), bump=.28):
    """Procedural grain (leather, wood, rope, metal) that the bake turns into texture maps."""
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

def skin_shader(mat, base, shadow, highlight, back_darkening=(.50, .40, .38), crack_scale=58, pore_scale=120, bump=.22):
    """Mottled hide with a darker back, cellular cracks and pores. Coordinates are final game units."""
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
    sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(tex.outputs['Object'], sep.inputs[0])
    grad = nodes.new('ShaderNodeMapRange')
    grad.inputs['From Min'].default_value = -.28; grad.inputs['From Max'].default_value = .22
    grad.inputs['To Min'].default_value = 0; grad.inputs['To Max'].default_value = .55
    links.new(sep.outputs['Y'], grad.inputs['Value'])
    darken = nodes.new('ShaderNodeMix'); darken.data_type = 'RGBA'; darken.blend_type = 'MULTIPLY'
    darken.inputs[7].default_value = (*back_darkening, 1)
    links.new(grad.outputs[0], darken.inputs[0]); links.new(ramp.outputs['Color'], darken.inputs[6])
    links.new(darken.outputs[2], p.inputs['Base Color'])
    vor = nodes.new('ShaderNodeTexVoronoi'); vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = crack_scale
    links.new(tex.outputs['Object'], vor.inputs['Vector'])
    cracks = nodes.new('ShaderNodeMapRange'); cracks.inputs['From Max'].default_value = .028
    links.new(vor.outputs['Distance'], cracks.inputs['Value'])
    pores = nodes.new('ShaderNodeTexNoise'); pores.inputs['Scale'].default_value = pore_scale
    pores.inputs['Detail'].default_value = 2; links.new(tex.outputs['Object'], pores.inputs['Vector'])
    m1 = nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = .7
    links.new(cracks.outputs[0], m1.inputs[0])
    m2 = nodes.new('ShaderNodeMath'); m2.operation = 'MULTIPLY_ADD'; m2.inputs[1].default_value = .3
    links.new(pores.outputs['Fac'], m2.inputs[0]); links.new(m1.outputs[0], m2.inputs[2])
    bmp = nodes.new('ShaderNodeBump'); bmp.inputs['Strength'].default_value = bump
    bmp.inputs['Distance'].default_value = .003
    links.new(m2.outputs[0], bmp.inputs['Height']); links.new(bmp.outputs['Normal'], p.inputs['Normal'])
    rough = nodes.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .52
    rough.inputs['To Max'].default_value = .72
    links.new(blotch.outputs['Fac'], rough.inputs['Value']); links.new(rough.outputs[0], p.inputs['Roughness'])

# ---------------------------------------------------------------- superellipse sweeps
def superellipse_points(rx, ry, n, segments):
    pts = []
    for i in range(segments):
        a = 2 * math.pi * i / segments; c = math.cos(a); s = math.sin(a)
        pts.append((rx * math.copysign(abs(c) ** (2 / n), c), ry * math.copysign(abs(s) ** (2 / n), s)))
    return pts

def ring_frame(t):
    """Ring axes for a path tangent. Returns (side, up): ``side`` points to +X, ``up`` points
    forward (-Y) for mostly vertical paths and to +Z for mostly horizontal ones, so ring
    ``dx`` offsets always move sideways and ``dy`` offsets move forward or upward."""
    t = Vector(t).normalized()
    ref = Vector((0, -1, 0)) if abs(t.z) > .6 else Vector((0, 0, 1))
    up = (ref - t * ref.dot(t)).normalized()
    side = up.cross(t).normalized()
    if side.x < -1e-6 or (abs(side.x) <= 1e-6 and side.y < 0): side = -side
    return side, up

def ring(rx, ry, n=2.2, dx=0, dy=0):
    return {'rx': rx, 'ry': ry, 'n': n, 'dx': dx, 'dy': dy}

def path_frames(pts):
    """Parallel-transported ring frames: the first ring uses ``ring_frame`` for the overall
    direction, later rings rotate with the tangent so the tube never twists or self-intersects."""
    tangents = [(pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized() for i in range(len(pts))]
    side, up = ring_frame(pts[-1] - pts[0])
    t0 = tangents[0]
    up = (up - t0 * up.dot(t0)).normalized(); side = (side - t0 * side.dot(t0)).normalized()
    frames = [(side, up)]
    for i in range(1, len(pts)):
        q = tangents[i - 1].rotation_difference(tangents[i])
        side = (q @ side).normalized(); up = (q @ up).normalized()
        frames.append((side, up))
    return frames

def sweep(name, path, rings, mat=None, segments=20, caps=True):
    """A tube of superellipse rings along ``path``. ``rings[i]`` is ``ring(...)`` for ``path[i]``."""
    pts = [Vector(p) for p in path]
    assert len(pts) == len(rings) and len(pts) >= 2, name
    kept = [i for i, p in enumerate(pts) if i == 0 or (p - pts[i - 1]).length > 1e-4]
    pts = [pts[i] for i in kept]; rings = [rings[i] for i in kept]
    verts = []; faces = []
    for (p, r), (side, up) in zip(zip(pts, rings), path_frames(pts)):
        center = p + side * r['dx'] + up * r['dy']
        for x, y in superellipse_points(r['rx'], r['ry'], r['n'], segments):
            verts.append(center + side * x + up * y)
    count = len(pts)
    for i in range(count - 1):
        for j in range(segments):
            faces.append((i * segments + j, i * segments + (j + 1) % segments, (i + 1) * segments + (j + 1) % segments, (i + 1) * segments + j))
    if caps:
        faces.append(tuple(reversed(range(segments))))
        faces.append(tuple(range((count - 1) * segments, count * segments)))
    o = mesh_object(name, verts, faces, mat)
    recalc_normals(o); ensure_outward(o); smooth(o); return o

def loft(name, levels, mat=None, segments=24, caps=True):
    """A vertical stack of rings. ``levels`` is a list of ``(z, ring)``; ring ``dy`` is forward (-Y)."""
    path = [(0, 0, z) for z, _ in levels]
    return sweep(name, path, [r for _, r in levels], mat, segments, caps)

def superellipsoid(name, center, size, mat=None, n=2.2, rings=9, segments=20, rot=(0, 0, 0)):
    """An isolated mass. ``n``=2 is an ellipsoid, 2.6 a rounded block. ``rot`` is applied about ``center``."""
    rx, ry, rz = size; levels = []
    for k in range(rings):
        u = -1 + 2 * (k + .5) / rings
        f = max(1e-3, 1 - abs(u) ** n) ** (1 / n)
        levels.append((u * rz, ring(rx * f, ry * f, n)))
    o = loft(name, levels, mat, segments)
    o.rotation_euler = rot; o.location = center
    apply_transforms(o); return o

def sphere(name, center, radius, mat=None, sub=3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=radius, location=center)
    o = bpy.context.object; o.name = name
    if mat is not None: o.data.materials.append(mat)
    smooth(o); return o

def ellipsoid(name, center, size, mat=None, sub=3, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=center)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat is not None: o.data.materials.append(mat)
    smooth(o); return o

def block(name, pos, size, mat=None, bevel=.03, rot=(0, 0, 0), segments=3):
    """A bevelled block for forged and stitched pieces; never left as a raw box."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = bpy.context.object; o.name = name; o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    m = o.modifiers.new('Worn corners', 'BEVEL'); m.width = bevel; m.segments = segments; apply_modifier(o, m)
    if mat is not None: o.data.materials.append(mat)
    smooth(o); return o

def rod(name, a, b, r1, r2, mat=None, sides=12):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r1, radius2=r2, depth=(b - a).length, location=(a + b) / 2)
    o = bpy.context.object; o.name = name
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat is not None: o.data.materials.append(mat)
    smooth(o); return o

def dedupe(points, tolerance=1e-4):
    """Drop consecutive coincident points: a zero-length Bezier segment gets a runaway auto handle."""
    out = []
    for p in points:
        v = Vector(p)
        if not out or (v - out[-1]).length > tolerance: out.append(v)
    return out

def tube(name, points, radius, mat=None, taper=None, cyclic=False, res=2, segments=6):
    points = dedupe(points)
    curve = bpy.data.curves.new(name, 'CURVE'); curve.dimensions = '3D'
    curve.resolution_u = segments; curve.bevel_depth = radius; curve.bevel_resolution = res
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(points) - 1); spline.use_cyclic_u = cyclic
    for i, (bp, co) in enumerate(zip(spline.bezier_points, points)):
        bp.co = co; bp.handle_left_type = 'AUTO'; bp.handle_right_type = 'AUTO'
        if taper: bp.radius = max(.04, taper(i / (len(points) - 1)))
    o = bpy.data.objects.new(name, curve); bpy.context.collection.objects.link(o)
    activate(o); bpy.ops.object.convert(target='MESH'); o = bpy.context.object
    if mat is not None: o.data.materials.append(mat)
    smooth(o); return o

# ---------------------------------------------------------------- booleans, subdivision, edges
def boolean(target, other, operation='UNION', transfer=False, keep=False):
    """Exact boolean of ``other`` into ``target``. ``transfer`` gives new faces the other object's material."""
    ensure_outward(other); ensure_outward(target)
    m = target.modifiers.new('Boolean', 'BOOLEAN'); m.operation = operation; m.object = other
    for solver in ('EXACT', 'MANIFOLD'):
        try: m.solver = solver; break
        except TypeError: continue
    try: m.use_hole_tolerant = True
    except AttributeError: pass
    if transfer:
        try: m.material_mode = 'TRANSFER'
        except AttributeError: pass
        for mat in other.data.materials:
            if mat is not None and mat.name not in target.data.materials: target.data.materials.append(mat)
    backup = target.data.copy(); before = len(target.data.polygons)
    apply_modifier(target, m)
    after = len(target.data.polygons)
    if after == 0 or (operation == 'UNION' and after < .6 * before) or (operation == 'DIFFERENCE' and after < .5 * before):
        # An exact boolean that returns nothing, or a union that loses the base, means a degenerate
        # operand; keep the previous mesh so one bad piece never erases a whole body.
        print(f'BOOLEAN FAILED: {operation} of {other.name} into {target.name} ({before} -> {after} faces); operand skipped', flush=True)
        failed = target.data; target.data = backup; bpy.data.meshes.remove(failed)
    else:
        bpy.data.meshes.remove(backup)
    if not keep: remove(other)
    bpy.context.view_layer.update()
    return target

def union_all(name, objects, mat=None):
    """Weld ``objects`` into one manifold body with exact unions (planes and joint creases survive)."""
    base = objects[0]; base.name = name
    apply_transforms(base)
    if mat is not None and not base.data.materials: base.data.materials.append(mat)
    for other in objects[1:]:
        apply_transforms(other)
        boolean(base, other, 'UNION')
    smooth(base); return base

def carve(target, cutters, transfer=True):
    """Subtract every cutter (eye sockets, mouths, plate gaps). Cutter materials line the cavities."""
    for c in cutters:
        apply_transforms(c); boolean(target, c, 'DIFFERENCE', transfer=transfer)
    smooth(target); return target

def subdivide(o, levels=1, creases=None):
    """Catmull-Clark smoothing. ``creases`` is a list of ``(predicate(edge_center), value)`` marked first."""
    if creases:
        bm = bmesh.new(); bm.from_mesh(o.data)
        layer = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for e in bm.edges:
            center = (e.verts[0].co + e.verts[1].co) / 2
            for predicate, value in creases:
                if predicate(center): e[layer] = max(e[layer], value)
        bm.to_mesh(o.data); bm.free()
    m = o.modifiers.new('Smooth structure', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    apply_modifier(o, m); smooth(o); return o

def mark_sharp(o, angle_degrees=42):
    """Split shading across crisp boolean seams and hard-surface edges."""
    activate(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.mesh.select_mode(type='EDGE')
    bpy.ops.mesh.edges_select_sharp(sharpness=math.radians(angle_degrees)); bpy.ops.mesh.mark_sharp()
    bpy.ops.object.mode_set(mode='OBJECT'); return o

def fillet(o, width=.012, angle_degrees=40, segments=2):
    """A small bevel on sharp seams so carved creases read as sculpted, not razor-cut."""
    m = o.modifiers.new('Fillet', 'BEVEL'); m.width = width; m.segments = segments
    m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle_degrees)
    try: m.harden_normals = True
    except AttributeError: pass
    apply_modifier(o, m); smooth(o); return o

def relax(o, factor=.25, iterations=1):
    m = o.modifiers.new('Relax', 'SMOOTH'); m.factor = factor; m.iterations = iterations
    apply_modifier(o, m); return o

def sharpen(o, amount=.25, iterations=1):
    """Negative Laplacian smoothing raises crease contrast. Keep it under 0.3; more wrecks forms."""
    m = o.modifiers.new('Sharpen', 'LAPLACIANSMOOTH'); m.lambda_factor = -amount; m.lambda_border = 0
    m.iterations = iterations; m.use_normalized = True
    apply_modifier(o, m); return o

def decimate(o, ratio):
    m = o.modifiers.new('Game budget', 'DECIMATE'); m.ratio = ratio; apply_modifier(o, m); smooth(o); return o

# ---------------------------------------------------------------- conforming accessories
def surface_point(target, p, offset=0):
    ok, loc, normal, _ = target.closest_point_on_mesh(Vector(p))
    if not ok:
        # No hit returns the origin, which would drag a strap or lip to the feet; keep the query point.
        return Vector(p), Vector((0, -1, 0))
    return loc + normal * offset, normal

def conformed(points, target, offset):
    return [surface_point(target, p, offset)[0] for p in points]

def patch(name, p, size, mat, target, offset=0, sub=2):
    """An ellipsoid seated on a sculpted surface, its Y axis along the surface normal."""
    loc, n = surface_point(target, p, offset)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    o = bpy.context.object; o.name = name; o.scale = size
    o.rotation_euler = n.to_track_quat('Y', 'Z').to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    o.data.materials.append(mat); smooth(o); return o

def ribbon(name, points, width, mat, target, gap, thickness, cyclic=False, subdiv=1):
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
    o = mesh_object(name, verts, faces, mat)
    if subdiv:
        m = o.modifiers.new('Soften', 'SUBSURF'); m.levels = subdiv; apply_modifier(o, m)
    m = o.modifiers.new('Fit', 'SHRINKWRAP'); m.target = target; m.wrap_method = 'NEAREST_SURFACEPOINT'
    m.offset = gap + thickness / 2; apply_modifier(o, m)
    m = o.modifiers.new('Thickness', 'SOLIDIFY'); m.thickness = thickness; m.offset = 0; apply_modifier(o, m)
    smooth(o); return o

def buckle(name, p, w, h, mat, target, offset, right=None, radius=.02):
    """A forged frame buckle with rounded corners and a prong, seated on a strap. Returns (frame, prong)."""
    loc, n = surface_point(target, p, offset)
    right = (Vector(right) if right is not None else n.cross(Vector((0, 0, 1))))
    right = (right - n * right.dot(n)).normalized()
    up = right.cross(n).normalized()
    loop = [(-1, -1), (0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
    pts = [loc + right * (x * w / 2) + up * (z * h / 2) for x, z in loop]
    frame = tube(name, pts, radius, mat, cyclic=True, res=3)
    prong = rod(name + ' prong', loc + right * (w / 2) - n * .004, loc - right * (w * .12) - n * .004, radius * .75, radius * .5, mat, 8)
    return frame, prong

def shell(name, base, direction, normal, length, width_fn, mat, inner_mat=None, N=16, M=8,
          dish=.045, curl=.06, thickness_fn=None, inner=None):
    """A thin organic sheet with a dished front, thick base and rolled rim (ears, wings, fins).
    ``width_fn(u)`` is the width along the length, ``thickness_fn(u, v)`` the thickness, and
    ``inner(i, j)`` marks front faces that use ``inner_mat``."""
    base = Vector(base); d = Vector(direction).normalized()
    n = Vector(normal); n = (n - d * n.dot(d)).normalized(); a = d.cross(n).normalized()
    thickness_fn = thickness_fn or (lambda u, v: .010 + .06 * (1 - u) ** 1.5 * (.35 + .65 * math.sin(math.pi * v)))
    inner = inner or (lambda i, j: 1 <= j <= M - 2 and i < N - 3)
    def P(u, v):
        d_ = dish * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.05)) ** .7
        return base + d * (u * length) + a * ((v - .5) * width_fn(u)) + n * (curl * u * u - d_)
    verts = []; F = []; K = []
    for i in range(N):
        u = i / N * .955; F.append([]); K.append([])
        for j in range(M + 1):
            F[i].append(len(verts)); verts.append(P(u, j / M))
        for j in range(M + 1):
            K[i].append(len(verts)); verts.append(P(u, j / M) - n * thickness_fn(u, j / M))
    tf = len(verts); verts.append(P(1, .5)); tb = len(verts); verts.append(P(1, .5) - n * .010)
    faces = []; flags = []
    for i in range(N - 1):
        for j in range(M):
            faces.append((F[i][j], F[i + 1][j], F[i + 1][j + 1], F[i][j + 1])); flags.append(inner(i, j))
            faces.append((K[i][j], K[i][j + 1], K[i + 1][j + 1], K[i + 1][j])); flags.append(False)
        faces.append((F[i][0], K[i][0], K[i + 1][0], F[i + 1][0])); flags.append(False)
        faces.append((F[i][M], F[i + 1][M], K[i + 1][M], K[i][M])); flags.append(False)
    for j in range(M):
        faces.append((F[0][j], F[0][j + 1], K[0][j + 1], K[0][j])); flags.append(False)
        faces.append((F[N - 1][j], tf, F[N - 1][j + 1])); flags.append(False)
        faces.append((K[N - 1][j], K[N - 1][j + 1], tb)); flags.append(False)
    faces.append((F[N - 1][0], tf, tb, K[N - 1][0])); flags.append(False)
    faces.append((F[N - 1][M], K[N - 1][M], tb, tf)); flags.append(False)
    o = mesh_object(name, verts, faces, mat)
    if inner_mat is not None:
        o.data.materials.append(inner_mat)
        for p, flag in zip(o.data.polygons, flags): p.material_index = int(flag)
    recalc_normals(o)
    m = o.modifiers.new('Cartilage', 'SUBSURF'); m.levels = 1; apply_modifier(o, m)
    smooth(o); return o

# ---------------------------------------------------------------- skin weights
def blend_weights(body, samples, bone_names, neighbours=18, falloff=.052, limit=3):
    """Blend vertex weights from labelled sample points (KD-tree) so joints deform smoothly."""
    from mathutils.kdtree import KDTree
    tree = KDTree(len(samples))
    for i, (co, _) in enumerate(samples): tree.insert(co, i)
    tree.balance()
    for name in bone_names: body.vertex_groups.new(name=name)
    for vertex in body.data.vertices:
        closest = {}
        for _, idx, distance in tree.find_n(vertex.co, neighbours):
            name = samples[idx][1]
            closest[name] = min(distance, closest.get(name, 100))
        nearest = min(closest.values())
        weights = {name: math.exp(-((d - nearest) / falloff) ** 2) for name, d in closest.items()}
        weights = dict(sorted(weights.items(), key=lambda item: item[1], reverse=True)[:limit])
        weights = {name: w for name, w in weights.items() if w > .003}
        total = sum(weights.values())
        for name, w in weights.items():
            body.vertex_groups[name].add([vertex.index], w / total, 'REPLACE')
