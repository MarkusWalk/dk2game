"""Rebuild the Dungeon Keeper 2 imp with Blender 5.x (no add-ons required). Second method: structured sculpting with tools/sculptkit.py.

Run: blender --background --python tools/create_imp.py
Look development: set IMP_FAST=1 to skip texture baking, GLB export and the
.blend save, rendering quick procedural stills into IMP_PREVIEW_DIR instead.
The authored character faces -Y in Blender, becoming +Z in Babylon's left-handed scene.

Design target: the DK2 worker imp. Rust-red hide, a heavy V-shaped scowl over glowing
amber eyes, a wide grin full of small teeth, huge bat ears, a hunched knuckle-dragging
stance, big clawed hands and feet, a belt/harness/satchel/loincloth kit and a
rope-lashed pick.

Why a second method: the first build welded convex ellipsoids with a voxel remesh, which
can only make balloons. This one builds structure with tools/sculptkit.py: superellipse
sweeps (real planes on limbs, torso and skull), exact boolean unions (joint creases
survive), boolean carving (eye sockets, mouth, nostrils, temples, cheek hollows, sternum,
navel, spine groove), creased subdivision, sharp-marked seams with small fillets, and
hard-surface bevels for the pick. Nothing is remeshed.
"""
import bpy
import math
import random
import json
import os
import sys
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/models'
SOURCE = ROOT / 'assets/blender'
FAST = bool(os.environ.get('IMP_FAST'))
PREVIEW = Path(os.environ.get('IMP_PREVIEW_DIR') or SOURCE)
sys.path.insert(0, str(ROOT / 'tools'))
from sculptkit import (activate, apply_modifier, apply_transforms, smooth, remove, triangles, material, surface_detail,
    skin_shader, ring, sweep, loft, superellipsoid, sphere, ellipsoid, block, rod, tube, boolean, union_all, carve,
    subdivide, mark_sharp, fillet, relax, decimate, surface_point, conformed, patch, ribbon, buckle, shell, blend_weights)

random.seed(19)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
scene = bpy.context.scene
scene.render.threads_mode = 'FIXED'; scene.render.threads = 6

# ---------------------------------------------------------------- materials
skin = material('Skin | rust hide', (.34, .078, .030), 0, .62)
socket = material('Skin | socket shade', (.17, .034, .014), 0, .70)
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
amber = material('Eyes | molten glow', (.95, .55, .12), 0, .20, 3.2, (1, .60, .10))
hot = material('Eyes | white-hot core', (1, .93, .65), 0, .20, 5, (1, .86, .45))
skin_shader(skin, (.34, .078, .030), (.21, .040, .018), (.45, .13, .052))
skin_shader(socket, (.17, .034, .014), (.11, .02, .01), (.22, .05, .02))
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

# ---------------------------------------------------------------- registry
parts = []      # (object, bone) islands attached to a single bone
samples = []    # (position, bone) for blended body weights

def own(o, bone, mat=None):
    if mat is not None and not o.data.materials: o.data.materials.append(mat)
    parts.append((o, bone)); return o

def labelled(o, bone):
    """Record a body piece's vertices as weight samples. ``bone`` may be a function of position."""
    apply_transforms(o)
    for v in o.data.vertices:
        samples.append((v.co.copy(), bone(v.co) if callable(bone) else bone))
    return o

# ---------------------------------------------------------------- skeleton landmarks (pre-scale units)
joints = {}
for s, L in ((-1, 'R'), (1, 'L')):
    joints[L] = dict(shoulder=(s * .50, -.12, 2.15), elbow=(s * .72, -.05, 1.55), wrist=(s * .85, -.28, 1.05), hand=(s * .86, -.36, .78),
                     hip=(s * .24, -.02, 1.42), knee=(s * .36, -.06, .95), ankle=(s * .40, .0, .32), foot=(s * .41, -.45, .10))
EYE = {1: (.215, -.545, 2.55), -1: (-.215, -.545, 2.55)}
EAR_BASE = {1: (.40, -.04, 2.68), -1: (-.40, -.04, 2.68)}
EAR_DIR = {1: (1.0, .40, .54), -1: (-1.0, .40, .54)}
EAR_LENGTH = .86

# ---------------------------------------------------------------- body: sweeps welded by booleans
# Hunched: the spine leans forward, the belly pushes out, arms hang to the knees, legs are short and bowed.
torso = labelled(sweep('Torso', [(0, .00, 1.28), (0, -.01, 1.42), (0, -.03, 1.60), (0, -.03, 1.78), (0, -.06, 1.96), (0, -.11, 2.14), (0, -.18, 2.28), (0, -.22, 2.40)],
    [ring(.26, .22, 2.2), ring(.38, .30, 2.5, 0, .02), ring(.42, .38, 2.3, 0, .08), ring(.40, .33, 2.7, 0, .03), ring(.45, .31, 2.8, 0, .05), ring(.49, .28, 3.0, 0, .02), ring(.27, .24, 2.3), ring(.22, .20, 2.3)],
    skin, 28), lambda co: 'hips' if co.z < 1.72 else 'chest')
pieces = [torso]
pieces.append(labelled(superellipsoid('Hunched back', (0, .16, 2.10), (.34, .20, .26), skin, 2.3), 'chest'))
for s, L in ((-1, 'R'), (1, 'L')):
    j = joints[L]
    pieces.append(labelled(superellipsoid('Buttock', (s * .15, .15, 1.38), (.20, .18, .18), skin, 2.2), 'hips'))
    pieces.append(labelled(superellipsoid('Pectoral', (s * .18, -.31, 2.02), (.21, .10, .15), skin, 2.8), 'chest'))
    # Deltoid, bicep swell, narrow elbow, forearm swell, narrow wrist: a profile, not a sausage.
    pieces.append(labelled(sweep('Upper arm', [(s * .40, -.12, 2.18), (s * .52, -.11, 2.12), (s * .61, -.09, 1.92), (s * .68, -.06, 1.72), j['elbow']],
        [ring(.16, .16, 2.3), ring(.23, .22, 2.6), ring(.19, .21, 2.5, 0, -.02), ring(.14, .15, 2.4), ring(.125, .135, 2.3)], skin, 20), f'upper_arm.{L}'))
    pieces.append(labelled(superellipsoid('Elbow', (s * .73, .03, 1.55), (.08, .08, .10), skin, 2.2), f'forearm.{L}'))
    pieces.append(labelled(sweep('Forearm', [j['elbow'], (s * .75, -.09, 1.43), (s * .80, -.18, 1.22), j['wrist']],
        [ring(.125, .135, 2.3), ring(.16, .17, 2.6), ring(.13, .135, 2.4), ring(.10, .105, 2.3)], skin, 20), f'forearm.{L}'))
    pieces.append(labelled(sweep('Thigh', [(s * .20, -.02, 1.46), (s * .27, -.03, 1.30), (s * .33, -.05, 1.10), j['knee']],
        [ring(.22, .24, 2.3), ring(.25, .27, 2.5), ring(.21, .23, 2.4), ring(.17, .19, 2.3)], skin, 20), f'thigh.{L}'))
    pieces.append(labelled(superellipsoid('Knee cap', (s * .36, -.22, .95), (.09, .06, .10), skin, 2.3), f'shin.{L}'))
    pieces.append(labelled(sweep('Shin', [j['knee'], (s * .38, -.02, .75), (s * .40, .00, .50), j['ankle']],
        [ring(.16, .18, 2.3), ring(.19, .21, 2.5, 0, -.03), ring(.16, .17, 2.4), ring(.13, .13, 2.3)], skin, 20), f'shin.{L}'))
    # Feet are flat-soled boxes (n=3) that taper into the toes.
    pieces.append(labelled(sweep('Broad foot', [(s * .40, .20, .13), (s * .41, .02, .13), (s * .41, -.20, .12), (s * .41, -.38, .10), (s * .41, -.50, .09)],
        [ring(.15, .13, 2.8), ring(.20, .13, 3), ring(.23, .12, 3), ring(.24, .10, 3), ring(.21, .085, 3)], skin, 20), f'foot.{L}'))
    for i in range(3):
        x = s * .41 + (i - 1) * .165
        pieces.append(labelled(sweep('Toe', [(x, -.46, .085), (x, -.58, .08), (x, -.67, .07)],
            [ring(.075, .075, 2.2), ring(.07, .07, 2.2), ring(.055, .05, 2.2)], skin, 14), f'foot.{L}'))
body = union_all('Continuous body', pieces, skin)
# Carve the sternum groove, navel and spine before smoothing so the torso stops reading as one
# balloon. Cutters must cross surfaces, never graze them: tangential contact breaks exact booleans.
carve(body, [
    ellipsoid('Sternum groove', (0, -.46, 2.04), (.03, .07, .13), socket),
    sphere('Navel', (0, -.50, 1.55), .03, socket, 2),
    sweep('Spine groove', conformed([(0, .5, 1.40), (0, .5, 1.65), (0, .5, 1.90), (0, .5, 2.15)], body, -.012), [ring(.022, .022, 2.2)] * 4, socket, 10),
])
subdivide(body, 1)
bpy.context.view_layer.update()
for s, L in ((-1, 'R'), (1, 'L')):
    for i in range(3):
        x = s * .41 + (i - 1) * .165
        own(tube('Curved toe claw', [(x, -.66, .075), (x, -.74, .08), (x, -.82, .05), (x, -.86, .03)], .04, claw, lambda t: (1 - t) ** .8 + .05), f'foot.{L}')

# ---------------------------------------------------------------- head: creased loft, unions, carving
head_obj = loft('Head', [
    (2.16, ring(.16, .13, 2.4, 0, .30)),   # chin bottom, pushed forward
    (2.24, ring(.32, .28, 2.5, 0, .22)),   # jaw
    (2.34, ring(.38, .31, 2.6, 0, .24)),   # mouth
    (2.44, ring(.44, .36, 2.6, 0, .22)),   # cheeks
    (2.54, ring(.46, .37, 2.6, 0, .18)),   # eye level sits back under the brow
    (2.66, ring(.50, .42, 2.8, 0, .22)),   # brow shelf (the brow bar adds the overhang)
    (2.78, ring(.52, .44, 2.6, 0, .20)),   # forehead
    (2.92, ring(.50, .44, 2.4, 0, .16)),   # skull
    (3.04, ring(.42, .40, 2.3, 0, .12)),   # crown
    (3.13, ring(.20, .20, 2.2, 0, .08)),   # top
], skin, 28)
subdivide(head_obj, 2, creases=[(lambda c: abs(c.z - 2.66) < .02, .55), (lambda c: abs(c.z - 2.24) < .02, .30)])
def grin(x): return 2.31 + .20 * (x / .36) ** 2
grin_x = [-.36 + .72 * i / 12 for i in range(13)]
mouth_line = conformed([(x, -.80, grin(x)) for x in grin_x], head_obj, 0)
features = [
    sweep('Broad nose', [(0, -.58, 2.63), (0, -.72, 2.55), (0, -.84, 2.46), (0, -.90, 2.42)],
        [ring(.06, .05, 2.4), ring(.08, .07, 2.5), ring(.14, .09, 2.6), ring(.15, .10, 2.6)], skin, 16),
    # The V-shaped scowl is one continuous bar that dips toward the nose.
    # Sunk 60% into the skull and rounder in section so it reads as a ridge, not a visor.
    sweep('Brow bar', [(-.44, -.50, 2.75), (-.22, -.59, 2.69), (0, -.63, 2.63), (.22, -.59, 2.69), (.44, -.50, 2.75)],
        [ring(.07, .05, 2.3), ring(.11, .075, 2.3), ring(.10, .07, 2.3), ring(.11, .075, 2.3), ring(.07, .05, 2.3)], skin, 16),
    superellipsoid('Chin', (0, -.45, 2.20), (.14, .11, .09), skin, 2.4),
]
for s in (-1, 1):
    features.append(superellipsoid('Nostril wing', (s * .13, -.80, 2.42), (.09, .08, .07), skin, 2.4))
    features.append(superellipsoid('Cheekbone', (s * .40, -.44, 2.48), (.16, .16, .13), skin, 2.5))
    features.append(superellipsoid('Jaw corner', (s * .34, -.28, 2.30), (.12, .14, .12), skin, 2.3))
for f in features: apply_transforms(f); boolean(head_obj, f, 'UNION')
carve(head_obj, [
    *[sphere('Eye socket', (s * .215, -.57, 2.56), .135, socket, 3) for s in (-1, 1)],
    *[sphere('Temple hollow', (s * .66, -.36, 2.66), .20, skin, 3) for s in (-1, 1)],
    *[sphere('Cheek hollow', (s * .48, -.50, 2.30), .11, skin, 3) for s in (-1, 1)],
    sweep('Mouth groove', [p + Vector((0, -.01, 0)) for p in mouth_line], [ring(.034, .030, 2.2)] * len(mouth_line), dark, 12),
    *[sphere('Nostril', surface_point(head_obj, (s * .075, -.95, 2.41), -.008)[0], .03, dark, 2) for s in (-1, 1)],
])
# A light relax turns razor boolean seams into sculpted creases; only the sharpest edges stay split.
relax(head_obj, .3, 2)
mark_sharp(head_obj, 62)
own(head_obj, 'head')
# Lips sit on the carved surface as islands; their seam reads as the natural lip crease.
for edge, radius in ((.04, .028), (-.045, .032)):
    own(tube('Lip', conformed([(x, -.80, grin(x) + edge) for x in grin_x], head_obj, .004), radius, skin, lambda t: .75 + .25 * math.sin(math.pi * t)), 'head')
def fang(name, x, z, length, width, down=True):
    root = Vector((x, mouth_line[6].y - .01, z))
    root = Vector((x, surface_point(head_obj, (x, -.80, z), 0)[0].y - .012, z))
    tip = root + Vector((0, -.004, -length if down else length))
    own(rod(name, root + Vector((0, 0, .008 if down else -.008)), tip, width, width * .18, tooth, 8), 'head')
for i, x in enumerate([-.31, -.24, -.16, -.08, 0, .08, .16, .24, .31]):
    big = i in (0, 8)
    fang('Fang' if big else 'Uneven tooth', x, grin(x) + .025, .066 if big else .046 + .006 * (i % 2), .026 if big else .020)
for x in (-.14, .14):
    fang('Lower tooth', x, grin(x) - .032, .036, .018, down=False)
for s in (-1, 1):
    eye_bone = 'eye.L' if s > 0 else 'eye.R'
    ex, ey, ez = EYE[s]
    own(ellipsoid('Glowing eye', (ex, ey, ez), (.105, .10, .105), amber, 3), eye_bone)
    own(ellipsoid('Eye core', (ex, ey - .086, ez + .005), (.040, .018, .034), hot, 2), eye_bone)
    # Long, narrow bat ears rooted behind the temples and swept out, up and back.
    own(shell(f'Bat ear {"L" if s > 0 else "R"}', EAR_BASE[s], EAR_DIR[s], (-s * .30, -1.0, .10), EAR_LENGTH,
        lambda u: .30 * (1 - u) ** .85 * (.80 + .20 * math.sin(math.pi * u)), skin, ear_inner), 'ear.L' if s > 0 else 'ear.R')

# ---------------------------------------------------------------- hands
shaft_a = Vector((-.86, -.46, .35)); shaft_b = Vector((-1.08, -.40, 2.25))
shaft_d = (shaft_b - shaft_a).normalized()
def hand(s):
    L = 'L' if s > 0 else 'R'; bone = f'hand.{L}'; pieces = []; claws = []
    if s > 0:
        pieces.append(sweep('Palm', [(.85, -.28, 1.08), (.85, -.31, .98), (.84, -.34, .88)], [ring(.11, .09, 2.4), ring(.15, .085, 2.8), ring(.14, .08, 2.8)], skin, 16))
        for i in range(3):
            x = .77 + .07 * i
            path = [(x, -.34, .87), (x + .01, -.43, .80), (x, -.47, .72), (x - .01, -.43, .66)]
            pieces.append(sweep('Finger', path, [ring(.05, .05, 2.3), ring(.048, .048, 2.3), ring(.044, .044, 2.3), ring(.04, .04, 2.2)], skin, 12))
            pieces.append(sphere('Knuckle', path[0], .054, skin, 2))
            pieces.append(sphere('Fingertip', path[-1], .042, skin, 2))
            claws.append([(x - .01, -.43, .66), (x - .01, -.465, .60), (x - .01, -.43, .545)])
        pieces.append(sweep('Thumb', [(.80, -.28, 1.02), (.71, -.38, .98), (.69, -.46, .90)], [ring(.058, .058, 2.3), ring(.055, .055, 2.3), ring(.05, .05, 2.2)], skin, 12))
        pieces.append(sphere('Thumb tip', (.69, -.46, .90), .052, skin, 2))
        claws.append([(.69, -.46, .90), (.68, -.51, .86), (.70, -.53, .80)])
    else:
        pieces.append(sweep('Palm', [(-.85, -.28, 1.08), (-.82, -.30, .98), (-.80, -.32, .90)], [ring(.11, .09, 2.4), ring(.15, .085, 2.8), ring(.13, .08, 2.8)], skin, 16))
        for i in range(3):
            z = .84 + .08 * i
            path = [(-.84, -.35, z), (-.863, -.507, z), (-.997, -.507, z), (-.997, -.373, z), (-.94, -.34, z)]
            pieces.append(sweep('Gripping finger', path, [ring(.044, .044, 2.3)] * 5, skin, 12))
            pieces.append(sphere('Knuckle', path[1], .05, skin, 2))
            pieces.append(sphere('Fingertip', path[-1], .042, skin, 2))
            claws.append([(-.94, -.34, z), (-.90, -.33, z - .01), (-.87, -.35, z - .02)])
        pieces.append(sweep('Thumb', [(-.82, -.32, 1.06), (-.90, -.50, 1.10), (-1.0, -.52, 1.06)], [ring(.055, .055, 2.3), ring(.052, .052, 2.3), ring(.048, .048, 2.2)], skin, 12))
        pieces.append(sphere('Thumb tip', (-1.0, -.52, 1.06), .05, skin, 2))
        claws.append([(-1.0, -.52, 1.06), (-1.04, -.54, 1.02), (-1.05, -.50, .98)])
    h = union_all(f'Hand {L}', pieces, skin)
    relax(h, .3, 1); own(h, bone)
    for path in claws:
        own(tube('Curved claw', path, .024, claw, lambda t: (1 - t) ** .7 + .05), bone)
hand(1); hand(-1)

# ---------------------------------------------------------------- kit: belt, harness, satchel, loincloth, bracer
def ring_points(cz, rx, ry, cy=0, steps=32):
    return [(rx * math.cos(2 * math.pi * i / steps), cy + ry * math.sin(2 * math.pi * i / steps), cz) for i in range(steps)]
own(ribbon('Wide waist belt', ring_points(1.48, .48, .42, -.04), .17, leather, body, .012, .022, cyclic=True), 'hips')
for dz in (-.075, .075):
    own(tube('Belt piping', conformed(ring_points(1.48 + dz, .48, .42, -.04), body, .034), .012, leather_edge, cyclic=True, res=1, segments=3), 'hips')
for o in buckle('Waist buckle', (0, -.60, 1.48), .32, .22, steel, body, .048, right=(1, 0, 0), radius=.024): own(o, 'hips')
own(ribbon('Belt tongue', conformed([(.10, -.55, 1.48), (.20, -.53, 1.48), (.30, -.49, 1.475)], body, .02), .12, leather, body, .034, .016), 'hips')
for a in (-2.35, -1.9, -1.2, -.6, .5, 1.3, 2.0):
    own(patch('Belt rivet', (.48 * math.cos(a), -.04 + .42 * math.sin(a), 1.48), (.022, .012, .022), steel, body, .034), 'hips')
harness = [(-.32, -.36, 1.56), (-.14, -.50, 1.74), (.06, -.52, 1.94), (.26, -.40, 2.12), (.42, -.20, 2.26), (.46, .06, 2.26), (.40, .28, 2.08), (.16, .36, 1.84), (-.14, .30, 1.64), (-.36, .06, 1.52)]
own(ribbon('Chest harness', harness, .20, leather, body, .012, .020, cyclic=True), 'chest')
for o in buckle('Harness buckle', (.0, -.54, 1.86), .24, .24, steel, body, .046, right=(.2, -.02, .2), radius=.022): own(o, 'chest')
for p in ((-.25, -.44, 1.64), (.36, -.30, 2.20), (.44, .18, 2.16)):
    own(patch('Harness rivet', p, (.024, .013, .024), steel, body, .034), 'chest')
satchel = union_all('Hip satchel', [
    superellipsoid('Pouch', (.50, -.12, 1.30), (.13, .19, .18), leather, 2.5),
    superellipsoid('Pouch belly', (.51, -.12, 1.22), (.14, .18, .13), leather, 2.3),
    superellipsoid('Pouch flap', (.50, -.13, 1.42), (.14, .21, .06), leather, 2.6),
], leather)
subdivide(satchel, 1); own(satchel, 'hips')
for o in buckle('Satchel buckle', (.66, -.16, 1.29), .07, .09, steel, satchel, .022, right=(0, -1, 0), radius=.010): own(o, 'hips')
own(ribbon('Satchel strap', conformed([(.64, -.16, 1.42), (.66, -.16, 1.36), (.66, -.16, 1.30)], satchel, .02), .05, leather_edge, satchel, .012, .012), 'hips')

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
    m = bpy.data.meshes.new(name); m.from_pydata(verts, [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o); o.data.materials.append(cloth)
    group = o.vertex_groups.new(name='tucked under belt')
    for i, w in enumerate(weights):
        if w: group.add([i], w, 'REPLACE')
    mod = o.modifiers.new('Drape', 'SUBSURF'); mod.levels = 1; apply_modifier(o, mod)
    mod = o.modifiers.new('Tuck', 'SHRINKWRAP'); mod.target = body; mod.wrap_method = 'NEAREST_SURFACEPOINT'
    mod.offset = .03; mod.vertex_group = 'tucked under belt'; apply_modifier(o, mod)
    mod = o.modifiers.new('Cloth thickness', 'SOLIDIFY'); mod.thickness = .012; mod.offset = 0; apply_modifier(o, mod)
    smooth(o); return own(o, 'hips')
loincloth('Front loincloth', -.50, .14, 1.44, .98, .58, .64, 10, 7, 1)
loincloth('Back loincloth', .34, .08, 1.44, 1.06, .52, .56, 8, 5, -1)

# Studded leather bracer on the left forearm.
A, Bv = Vector(joints['L']['elbow']), Vector(joints['L']['wrist'])
axis = (Bv - A).normalized(); center = A.lerp(Bv, .58)
e1 = axis.cross(Vector((0, 0, 1))).normalized(); e2 = axis.cross(e1).normalized()
def arm_ring(offset, r, steps=20):
    return [center + axis * offset + e1 * (r * math.cos(2 * math.pi * i / steps)) + e2 * (r * math.sin(2 * math.pi * i / steps)) for i in range(steps)]
own(ribbon('Leather bracer', arm_ring(0, .20), .20, leather, body, .012, .022, cyclic=True), 'forearm.L')
for off in (-.085, .085):
    own(tube('Bracer rim', conformed(arm_ring(off, .20), body, .034), .011, leather_edge, cyclic=True, res=1, segments=3), 'forearm.L')
for k in range(3):
    own(patch('Bracer stud', center + axis * ((k - 1) * .05) + e1 * .2, (.022, .013, .022), steel, body, .034), 'forearm.L')

# ---------------------------------------------------------------- rope-lashed pick: hard surface, no remesh
own(rod('Pick ash shaft', shaft_a, shaft_b, .055, .048, wood, 14), 'hand.R')
blade = sweep('Pick blade', [tuple(shaft_b), (-1.36, -.41, 2.27), (-1.62, -.42, 2.16), (-1.82, -.43, 1.92)],
    [ring(.10, .055, 2.6), ring(.085, .045, 2.6), ring(.055, .03, 2.6), ring(.012, .008, 2.2)], iron, 12)
spike = sweep('Pick back spike', [tuple(shaft_b), (-.86, -.40, 2.34), (-.68, -.40, 2.30)],
    [ring(.085, .05, 2.6), ring(.06, .035, 2.6), ring(.014, .01, 2.2)], iron, 12)
pick_head = union_all('Forged pick head', [
    block('Socket', shaft_b, (.26, .19, .30), iron, .05, shaft_d.to_track_quat('Z', 'Y').to_euler()),
    rod('Collar', shaft_b - shaft_d * .16, shaft_b - shaft_d * .08, .085, .085, iron, 14),
    blade, spike,
], iron)
mark_sharp(pick_head, 40); fillet(pick_head, .012, 40, 2); own(pick_head, 'hand.R')
p1 = shaft_d.cross(Vector((0, 1, 0))).normalized(); p2 = shaft_d.cross(p1).normalized()
for k in range(3):
    tilt = (.6, -.6, .6)[k]; c = shaft_b - shaft_d * (.01 + .05 * k)
    loop = [c + p1 * (.16 * math.cos(2 * math.pi * i / 10)) + p2 * (.16 * math.sin(2 * math.pi * i / 10)) + shaft_d * (tilt * .10 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
    own(tube('Rope lashing', conformed(loop, pick_head, .013), .015, rope, cyclic=True, res=1, segments=4), 'hand.R')
for k in range(3):
    c = shaft_b - shaft_d * (.20 + .032 * k)
    own(tube('Rope whipping', [c + p1 * (.066 * math.cos(2 * math.pi * i / 8)) + p2 * (.066 * math.sin(2 * math.pi * i / 8)) for i in range(8)], .014, rope, cyclic=True, res=1, segments=4), 'hand.R')

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
blend_weights(body, samples, list(bones))

# ---------------------------------------------------------------- assemble one skinned mesh
SCALE = .39
if FAST:
    budget = sorted(((triangles(o), o.name) for o, _ in parts + [(body, None)]), reverse=True)
    for count, name in budget[:14]: print(f'TRIANGLES {count:7d} {name}')
for o, bone in parts:
    apply_transforms(o)
    group = o.vertex_groups.new(name=bone); group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for o, _ in parts: o.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
character = bpy.context.object; character.name = 'Imp_Mesh'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for v in character.data.vertices: v.co *= SCALE
bpy.ops.object.material_slot_remove_unused()
if not FAST:
    # Bake the procedural hide, leather, rope and metal into three embedded 2K maps.
    from imp_texture_bake import bake_pbr_atlas
    bake_pbr_atlas(character, SOURCE / 'textures', keep_materials=(amber, hot), prefix='imp')

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
scene.render.fps = 30

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
rig['scale_note'] = 'Feet at ground; about 1.23 units tall; Blender -Y / Babylon +Z forward.'

tri_count = triangles(character)
if not FAST:
    bpy.ops.object.select_all(action='DESELECT'); character.select_set(True); rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUT / 'imp.glb'), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        export_yup=True, export_apply=False, export_extras=True)
    rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    for p in rig.pose.bones: p.matrix_basis.identity()
    bpy.context.view_layer.update()
    (OUT / 'imp.stats.json').write_text(json.dumps({'triangles': tri_count, 'vertices': len(character.data.vertices),
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
    ref = bpy.data.images.load(str(ROOT / 'Imp_Sample.png')); ref.pack()
    bpy.ops.object.select_all(action='DESELECT'); rig.select_set(True); bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'imp.blend'))
PREVIEW.mkdir(parents=True, exist_ok=True)
scene.render.filepath = str(PREVIEW / 'imp-preview.png')
bpy.ops.render.render(write_still=True)
cam.location = (1.6, -5.4, 2.55); aim(cam, (0, -.10, 1.0)); cam.data.ortho_scale = .95
scene.render.filepath = str(PREVIEW / 'imp-detail.png')
bpy.ops.render.render(write_still=True)
cam.location = (5.6, -.4, 1.6); aim(cam, (0, -.05, .62)); cam.data.ortho_scale = 1.85
scene.render.filepath = str(PREVIEW / 'imp-side.png')
bpy.ops.render.render(write_still=True)
print('IMP_BUILD_COMPLETE', tri_count, 'triangles')
