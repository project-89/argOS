"""Argos shadow-Blender workshop: procedural coastal props for Saltmere.

Builds a small set of ORIGINAL low-poly props entirely from code (no imported
meshes, no image textures) and exports each one as a GLB, optionally writing
the matching spatial asset catalog file.

Run headless (Blender 3.0+):

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python scripts/blender/coastal_props.py -- \
        [--out DIR] [--catalog FILE] [--only id,id]

Conventions (shared with every future workshop script):
  * metres, real-world scale; Blender Z is up
  * pivot at the base centre: the bounding box is centred on X/Y and its
    bottom sits on z = 0 (glTF exports +Y up, so the base lands on y = 0)
  * the "front" (where a person stands to use it) faces -Y in Blender,
    which is +Z in glTF / three.js
  * flat shading, flat base colours, soft bevels: the Kenney-like visual
    language of the existing furniture kit
  * fully deterministic: no randomness; "weathering" jitter comes from a fixed
    integer hash, so re-running produces the same geometry

The `Prop` class below is the restricted "kit": a future daemon extending the
workshop should only compose these helpers (box, cylinder, lathe, tube, sheet,
material) inside a `build_<id>` function and register it in PROPS.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

KIT_VERSION = 1
SCRIPT_REL = "scripts/blender/coastal_props.py"
V2_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ASSETS_DIR = os.path.join(V2_ROOT, "src", "demo", "spatial-client", "assets")
DEFAULT_OUT = os.path.join(ASSETS_DIR, "generated", "coastal")
MODEL_PREFIX = "generated/coastal"
LICENSE = {"source": "Argos-authored (Blender procedural, scripts/blender/coastal_props.py)", "license": "CC0-1.0"}
TRI_BUDGET = 2000

# --------------------------------------------------------------------------
# Kit
# --------------------------------------------------------------------------

# Shared palette (sRGB hex). Soft, slightly desaturated coastal tones.
PALETTE = {
    "oak": "#9b6a3c", "oak_dark": "#74502f", "pine": "#c9a46e", "pine_dark": "#a9844f",
    "weathered": "#a89d89", "weathered_dark": "#857a67", "driftwood": "#bab09c",
    "driftwood_dark": "#978c79", "iron": "#4a4f54", "iron_dark": "#3a3e42",
    "brass": "#c9a14a", "rope": "#cdb485", "net": "#5c7d74", "float": "#e08a3c",
    "teal_paint": "#44707a", "glass": "#ffd98a", "creel_wood": "#8c6a4a",
}


def jitter(seed, i, amount):
    """Deterministic pseudo-random offset in [-amount, amount] (no RNG state)."""
    h = (seed * 73856093) ^ (i * 19349663) ^ 0x5F3759DF
    h = (h * 2654435761) & 0xFFFFFFFF
    return ((h / 0xFFFFFFFF) * 2.0 - 1.0) * amount


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_rgba(hex_colour):
    h = hex_colour.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)) + (1.0,)


class Prop:
    """Restricted builder: every part is a closed low-poly primitive with one
    material. `build()` bakes modifiers, joins the parts into one mesh object
    and re-centres the pivot to the base centre."""

    def __init__(self, prop_id):
        self.id = prop_id
        self.parts = []
        self._materials = {}

    # -- materials ---------------------------------------------------------
    def material(self, key, roughness=0.9, metallic=0.0, emission=None, double_sided=False):
        """Principled BSDF with a flat base colour. `key` is a PALETTE name or a
        '#rrggbb' hex. Metallic stays low: the viewer has no environment map."""
        cache_key = (key, roughness, metallic, emission, double_sided)
        if cache_key in self._materials:
            return self._materials[cache_key]
        hex_colour = PALETTE.get(key, key)
        name = key if key in PALETTE else "c" + hex_colour.lstrip("#")
        if emission:
            name += "_glow"
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = _hex_rgba(hex_colour)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Specular"].default_value = 0.3
        if emission:
            bsdf.inputs["Emission"].default_value = _hex_rgba(PALETTE.get(emission, emission))
            bsdf.inputs["Emission Strength"].default_value = 1.0
        m.diffuse_color = _hex_rgba(hex_colour)
        m.use_backface_culling = not double_sided  # glTF doubleSided = not culling
        self._materials[cache_key] = m
        return m

    # -- internal ----------------------------------------------------------
    def _add(self, bm, mat, at=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, recalc=True):
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)  # collapses fan/pole quads
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        for f in bm.faces:
            f.smooth = False
        me = bpy.data.meshes.new(f"{self.id}_part{len(self.parts)}")
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.data.materials.append(mat)
        ob.matrix_world = Matrix.Translation(Vector(at)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
        if bevel > 0:
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = bevel
            mod.segments = 1
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
        self.parts.append(ob)
        return ob

    # -- primitives --------------------------------------------------------
    def box(self, size, at, mat, rot=(0, 0, 0), bevel=0.0):
        """Axis box of `size` (x, y, z) centred at `at`, rotated (Euler XYZ)."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal(Vector((size[0], size[1], size[2], 1.0))))
        return self._add(bm, mat, at, rot, bevel)

    def box_between(self, lo, hi, mat, bevel=0.0):
        """Axis box spanning corner `lo` to corner `hi`."""
        size = [h - l for l, h in zip(lo, hi)]
        at = [(l + h) / 2 for l, h in zip(lo, hi)]
        return self.box(size, at, mat, bevel=bevel)

    def cylinder(self, radius, depth, at, mat, segments=8, rot=(0, 0, 0), radius_top=None, bevel=0.0):
        """Z-axis cylinder/frustum centred at `at` (use rot to lay it down)."""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius,
                              radius2=radius if radius_top is None else radius_top, depth=depth)
        return self._add(bm, mat, at, rot, bevel)

    def lathe(self, profile, mat, segments=12, at=(0, 0, 0), rot=(0, 0, 0), closed=False, phase=0.0):
        """Solid of revolution about local Z. `profile` is [(radius, z), ...];
        a radius of 0 collapses to a single axis vertex. `closed` joins the last
        profile point back to the first (e.g. a hoop's rectangular section)."""
        bm = bmesh.new()
        angles = [phase + 2 * math.pi * i / segments for i in range(segments)]
        rings = []
        for r, z in profile:
            if r < 1e-6:
                rings.append([bm.verts.new((0.0, 0.0, z))])
            else:
                rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angles])
        pairs = list(zip(rings, rings[1:]))
        if closed:
            pairs.append((rings[-1], rings[0]))
        for a, b in pairs:
            if len(a) == 1 and len(b) == 1:
                continue
            for i in range(segments):
                j = (i + 1) % segments
                if len(a) == 1:
                    bm.faces.new((a[0], b[i], b[j]))
                elif len(b) == 1:
                    bm.faces.new((a[i], a[j], b[0]))
                else:
                    bm.faces.new((a[i], a[j], b[j], b[i]))
        return self._add(bm, mat, at, rot)

    def tube(self, points, radius, mat, sides=6, closed=False):
        """Swept tube (rope, bent bar) through `points` with parallel-transport
        framing; open ends are capped so the part stays a closed solid."""
        pts = [Vector(p) for p in points]
        n = len(pts)
        tangents = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[(i - 1) % n]
            else:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(t.normalized())
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(ref).normalized()
        bm = bmesh.new()
        rings = []
        for i in range(n):
            if i > 0:  # parallel transport
                normal = (normal - tangents[i] * normal.dot(tangents[i])).normalized()
            binormal = tangents[i].cross(normal)
            ring = []
            for s in range(sides):
                a = 2 * math.pi * s / sides
                ring.append(bm.verts.new(pts[i] + (normal * math.cos(a) + binormal * math.sin(a)) * radius))
            rings.append(ring)
        pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
        for a, b in pairs:
            for s in range(sides):
                t = (s + 1) % sides
                bm.faces.new((a[s], a[t], b[t], b[s]))
        if not closed:
            bm.faces.new(rings[0])
            bm.faces.new(list(reversed(rings[-1])))
        return self._add(bm, mat)

    def ring(self, radius, thickness, at, mat, segments=10, sides=5, rot=(0, 0, 0), arc=2 * math.pi):
        """Torus-like ring (or an open arc) in the local XY plane."""
        full = abs(arc - 2 * math.pi) < 1e-6
        count = segments if full else segments + 1
        pts = []
        for i in range(count):
            a = arc * i / segments
            pts.append(Vector((radius * math.cos(a), radius * math.sin(a), 0.0)))
        m = Matrix.Translation(Vector(at)) @ Euler(rot, "XYZ").to_matrix().to_4x4()
        return self.tube([m @ p for p in pts], thickness, mat, sides=sides, closed=full)

    def sheet(self, fn, nu, nv, mat):
        """Thin parametric surface fn(u, v) -> (x, y, z), u, v in [0, 1].
        Give it a double-sided material (nets, cloth, sails)."""
        bm = bmesh.new()
        grid = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        for i in range(nu):
            for j in range(nv):
                bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
        return self._add(bm, mat, recalc=False)

    # -- finish ------------------------------------------------------------
    def build(self):
        """Apply modifiers, join into one object named after the prop, and
        move the pivot to the base centre. Returns (object, stats)."""
        view_layer = bpy.context.view_layer
        for ob in bpy.context.scene.objects:
            ob.select_set(False)
        for ob in self.parts:
            ob.select_set(True)
        view_layer.objects.active = self.parts[0]
        bpy.ops.object.convert(target="MESH")  # bakes the bevel modifiers
        bpy.ops.object.join()
        ob = view_layer.objects.active
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        ob.name = self.id
        ob.data.name = self.id
        xs = [v.co.x for v in ob.data.vertices]
        ys = [v.co.y for v in ob.data.vertices]
        zs = [v.co.z for v in ob.data.vertices]
        shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs)))
        ob.data.transform(Matrix.Translation(shift))
        ob.data.update()
        ob.data.calc_loop_triangles()
        stats = {
            "tris": len(ob.data.loop_triangles),
            "width": max(xs) - min(xs),   # Blender X  -> manifest size.x
            "depth": max(ys) - min(ys),   # Blender Y  -> manifest size.z
            "height": max(zs) - min(zs),  # Blender Z  -> manifest size.y
        }
        return ob, stats


# --------------------------------------------------------------------------
# Props
# --------------------------------------------------------------------------

def build_barrel(p):
    oak, top, iron = p.material("oak"), p.material("oak_dark"), p.material("iron", roughness=0.7)
    h, r_end, bulge = 0.9, 0.26, 0.045
    radius = lambda z: r_end + bulge * math.sin(math.pi * z / h)
    levels = [0.0, 0.12, 0.3, 0.45, 0.6, 0.78, 0.9]
    profile = [(0.0, 0.0)] + [(radius(z), z) for z in levels]
    profile += [(r_end - 0.022, h), (r_end - 0.022, h - 0.02), (0.0, h - 0.02)]
    p.lathe(profile, oak, segments=14)
    p.cylinder(r_end - 0.023, 0.012, (0, 0, h - 0.026), top, segments=14)  # inset head
    for zc in (0.2, 0.7):  # two iron hoops hugging the staves
        r = radius(zc)
        p.lathe([(r - 0.01, zc - 0.028), (r + 0.012, zc - 0.028), (r + 0.012, zc + 0.028), (r - 0.01, zc + 0.028)],
                iron, segments=14, closed=True)
    p.box((0.03, 0.012, 0.05), (0, -radius(0.45) - 0.002, 0.45), top)  # bung stave, facing front


def build_fish_crate(p):
    pine, dark, rope = p.material("pine"), p.material("pine_dark"), p.material("rope")
    w, d, h_body = 0.76, 0.5, 0.34
    post = 0.045
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((post, post, h_body), (sx * (w / 2 - post / 2 - 0.012), sy * (d / 2 - post / 2 - 0.012), h_body / 2), dark)
    p.box((w - 0.02, d - 0.02, 0.025), (0, 0, 0.0125), dark)  # floor
    slat_h, gap = 0.085, 0.03
    for k in range(3):
        z = 0.035 + slat_h / 2 + k * (slat_h + gap)
        for sy in (-1, 1):  # long sides
            p.box((w, 0.018, slat_h), (jitter(1, k * 2 + sy, 0.003), sy * (d / 2 - 0.009), z), pine, bevel=0.004)
        for sx in (-1, 1):  # short ends
            p.box((0.018, d - 0.036, slat_h), (sx * (w / 2 - 0.009), 0, z), pine, bevel=0.004)
    for sx in (-1, 1):  # rope grab handles on the ends
        p.ring(0.05, 0.009, (sx * (w / 2 + 0.006), 0, h_body - 0.05), rope, segments=8, sides=4,
               rot=(-math.pi / 2, 0, math.pi / 2), arc=math.pi)
    lid_z = h_body + 0.012
    planks = 4
    pw = (d + 0.02) / planks
    for k in range(planks):  # lid: loose planks, battened
        y = -(d + 0.02) / 2 + pw * (k + 0.5)
        p.box((w + 0.02, pw - 0.008, 0.022), (jitter(2, k, 0.004), y, lid_z), pine, bevel=0.004)
    for sx in (-1, 1):
        p.box((0.06, d, 0.02), (sx * (w / 2 - 0.08), 0, lid_z + 0.021), dark)


def build_harbour_bench(p):
    plank, leg = p.material("weathered"), p.material("weathered_dark")
    iron = p.material("iron", roughness=0.7)
    length, seat_h, depth = 1.5, 0.46, 0.44
    for k in range(3):  # three seat planks with a little weathered drift
        y = -depth / 2 + 0.07 + k * 0.15
        p.box((length + jitter(3, k, 0.02), 0.135, 0.045), (jitter(4, k, 0.008), y, seat_h - 0.0225), plank,
              rot=(0, 0, math.radians(jitter(5, k, 0.8))), bevel=0.008)
    for sx in (-1, 1):  # two leg frames
        x = sx * (length / 2 - 0.2)
        for sy in (-1, 1):
            p.box((0.08, 0.08, seat_h - 0.1), (x, sy * (depth / 2 - 0.07), (seat_h - 0.1) / 2), leg, bevel=0.006)
        p.box((0.09, depth - 0.02, 0.07), (x, 0, seat_h - 0.08), leg, bevel=0.006)  # seat bearer
        p.box((0.06, depth - 0.14, 0.05), (x, 0, 0.12), leg)  # low rail
        for sy in (-1, 1):  # bolt heads
            p.cylinder(0.012, 0.01, (x, sy * (depth / 2 - 0.015), seat_h - 0.08), iron, segments=6, rot=(math.pi / 2, 0, 0))
    p.box((length - 0.4, 0.06, 0.05), (0, 0, 0.12), leg)  # stretcher


def build_lantern_post(p):
    iron, dark = p.material("iron", roughness=0.7), p.material("iron_dark", roughness=0.7)
    glass = p.material("glass", roughness=0.4, emission="glass")
    p.box((0.22, 0.22, 0.08), (0, 0, 0.04), dark, bevel=0.01)  # footing
    p.cylinder(0.075, 0.1, (0, 0, 0.13), iron, segments=8, radius_top=0.05)  # flared base
    p.cylinder(0.035, 1.85, (0, 0, 0.18 + 0.925), iron, segments=8)
    p.cylinder(0.05, 0.03, (0, 0, 2.03), dark, segments=8)  # cap collar
    p.cylinder(0.045, 0.07, (0, 0, 2.065), iron, segments=8, radius_top=0.0)  # finial
    arm_z, reach = 1.93, 0.36
    p.box((reach + 0.02, 0.03, 0.03), (reach / 2, 0, arm_z), iron)  # arm
    p.tube([(0.02, 0, arm_z - 0.2), (0.12, 0, arm_z - 0.1), (0.2, 0, arm_z - 0.02)], 0.012, iron, sides=5)  # brace
    p.ring(0.025, 0.006, (reach, 0, arm_z - 0.035), dark, segments=8, sides=4, rot=(math.pi / 2, 0, 0))  # hook
    top = arm_z - 0.06  # lantern hangs below the hook
    p.cylinder(0.05, 0.02, (reach, 0, top - 0.01), dark, segments=6)  # hanging ring plate
    p.cylinder(0.11, 0.07, (reach, 0, top - 0.055), iron, segments=4, radius_top=0.03, rot=(0, 0, math.pi / 4))  # roof
    p.box((0.15, 0.15, 0.2), (reach, 0, top - 0.19), glass)  # glowing panes
    for sx in (-1, 1):
        for sy in (-1, 1):  # corner frame bars
            p.box((0.018, 0.018, 0.2), (reach + sx * 0.075, sy * 0.075, top - 0.19), dark)
    p.box((0.17, 0.17, 0.03), (reach, 0, top - 0.305), iron)  # base plate
    p.cylinder(0.03, 0.03, (reach, 0, top - 0.335), dark, segments=6, radius_top=0.05)  # drip cone


def build_net_rack(p):
    wood, dark = p.material("weathered"), p.material("weathered_dark")
    net = p.material("net", roughness=1.0, double_sided=True)
    cork = p.material("float")
    span, bar_z = 2.0, 1.72
    for sx in (-1, 1):
        x = sx * (span / 2 - 0.05)
        p.box((0.09, 0.09, bar_z + 0.08), (x, 0, (bar_z + 0.08) / 2), wood, bevel=0.008)
        p.box((0.1, 0.46, 0.08), (x, 0, 0.04), dark, bevel=0.008)  # foot
        for sy in (-1, 1):  # angled braces into the foot
            p.box((0.05, 0.05, 0.33), (x, sy * 0.1, 0.19), dark, rot=(sy * math.radians(35), 0, 0))
    p.cylinder(0.04, span + 0.04, (0, 0, bar_z), wood, segments=8, rot=(0, math.pi / 2, 0))  # crossbar
    inner = span / 2 - 0.12

    def drape(side):
        def fn(u, v):
            x = -inner + 2 * inner * u
            hem = 0.62 - 0.14 * math.cos(math.pi * (2 * u - 1)) + 0.05 * math.sin(7.0 * u + side)
            z = bar_z - v * (bar_z - hem)
            y = side * (0.045 + 0.06 * math.sin(math.pi * v * 0.85) + 0.018 * math.sin(11.0 * u) * v)
            return (x, y, z)
        return fn

    for side in (-1, 1):
        p.sheet(drape(side), 12, 5, net)
    for k in range(5):  # cork floats along the front hem
        u = (k + 0.5) / 5
        x, y, z = drape(-1)(u, 1.0)
        p.cylinder(0.035, 0.05, (x, y - 0.03, z + 0.01), cork, segments=6, rot=(math.pi / 2, 0, 0))


def build_ship_bell(p):
    wood, dark = p.material("oak"), p.material("oak_dark")
    brass = p.material("brass", roughness=0.45, metallic=0.2)
    rope = p.material("rope")
    half = 0.27
    for sx in (-1, 1):
        x = sx * half
        p.box((0.1, 0.38, 0.06), (x, 0, 0.03), dark, bevel=0.008)  # feet
        p.box((0.07, 0.07, 0.8), (x, 0, 0.06 + 0.4), wood, bevel=0.006)  # posts
        for sy in (-1, 1):
            p.box((0.04, 0.04, 0.24), (x, sy * 0.085, 0.14), dark, rot=(sy * math.radians(38), 0, 0))
    p.box((0.72, 0.1, 0.08), (0, 0, 0.9), wood, bevel=0.008)  # yoke beam
    p.box((0.62, 0.14, 0.035), (0, 0, 0.0775), dark)  # base plank
    top = 0.84
    profile = [(0.0, top), (0.05, top), (0.068, top - 0.03), (0.074, top - 0.1), (0.088, top - 0.17),
               (0.118, top - 0.22), (0.13, top - 0.245), (0.112, top - 0.245), (0.097, top - 0.215),
               (0.068, top - 0.12), (0.052, top - 0.04), (0.0, top - 0.04)]
    p.lathe(profile, brass, segments=14)
    p.ring(0.028, 0.009, (0, 0, top + 0.02), brass, segments=8, sides=4, rot=(math.pi / 2, 0, 0))  # crown
    p.lathe([(0.0, top - 0.285), (0.02, top - 0.27), (0.025, top - 0.25), (0.02, top - 0.23), (0.0, top - 0.215)],
            brass, segments=8)  # clapper ball
    p.tube([(0, 0, top - 0.285), (0.004, -0.01, top - 0.36), (0.0, -0.02, top - 0.46)], 0.008, rope, sides=5)
    p.lathe([(0.0, top - 0.5), (0.018, top - 0.49), (0.02, top - 0.47), (0.014, top - 0.455), (0.0, top - 0.45)],
            rope, segments=6, at=(0, -0.02, 0))  # lanyard knot


def build_rope_coil(p):
    rope = p.material("rope")
    tr = 0.026  # rope radius
    r0, pitch, turns, per_turn = 0.07, 0.056, 4.0, 16
    pts = []
    n = int(turns * per_turn)
    for i in range(n + 1):
        a = 2 * math.pi * i / per_turn
        r = r0 + pitch * a / (2 * math.pi)
        pts.append((r * math.cos(a), r * math.sin(a), tr))
    # the loose end runs off the outer turn and trails across the ground
    a_end = 2 * math.pi * turns
    r_end = r0 + pitch * turns
    tangent = Vector((-math.sin(a_end), math.cos(a_end), 0))
    end = Vector(pts[-1])
    for k, (step, lift) in enumerate(((0.09, 0.02), (0.18, 0.012), (0.27, 0.0), (0.36, 0.0))):
        q = end + tangent * step + Vector((0, -0.02 * k, lift))
        pts.append((q.x, q.y, q.z))
    p.tube(pts, tr, rope, sides=6)
    # a second, half-turn layer resting on top of the outer coils
    top = []
    for i in range(10):
        a = math.pi * 0.2 + math.pi * i / 9
        r = r0 + pitch * 2.5
        top.append((r * math.cos(a), r * math.sin(a), tr * 2.9))
    p.tube(top, tr, rope, sides=6)


def build_lobster_pot(p):
    wood, base = p.material("creel_wood"), p.material("oak_dark")
    net = p.material("net", roughness=1.0, double_sided=True)
    rope = p.material("rope")
    length, half_w, arch_h, base_t = 0.62, 0.21, 0.26, 0.03
    p.box((length, 2 * half_w + 0.02, base_t), (0, 0, base_t / 2), base, bevel=0.005)
    z0 = base_t
    arch = lambda th: (half_w * math.cos(th), z0 + arch_h * math.sin(th))
    for x in (-length / 2 + 0.03, 0.0, length / 2 - 0.03):  # bent-wood hoops
        pts = [(x, *arch(math.pi * i / 10)) for i in range(11)]
        p.tube(pts, 0.012, wood, sides=5)
    for k in range(7):  # lengthwise slats following the arch
        th = math.pi * (k + 0.5) / 7
        y, z = arch(th)
        nrm = Vector((0, math.cos(th) * arch_h, math.sin(th) * half_w)).normalized()
        phi = math.atan2(-nrm.y, nrm.z)
        p.box((length, 0.04, 0.012), (0, y + nrm.y * 0.012, z + nrm.z * 0.012), wood, rot=(phi, 0, 0))

    def end_net(x):
        def fn(u, v):
            y, z = arch(math.pi * u)
            return (x, y * v, z0 + (z - z0) * v)
        return fn

    for x in (-length / 2 + 0.03, length / 2 - 0.03):
        p.sheet(end_net(x), 8, 2, net)
    p.cylinder(0.075, 0.12, (0, -half_w + 0.1, z0 + 0.1), net, segments=6, radius_top=0.035,
               rot=(-math.pi / 2, 0, 0))  # entrance funnel, wide mouth toward the front
    p.ring(0.05, 0.008, (0, 0, z0 + arch_h + 0.012), rope, segments=8, sides=4, rot=(math.pi / 2, 0, 0), arc=math.pi)


def build_driftwood_table(p):
    top_m, dark = p.material("driftwood"), p.material("driftwood_dark")
    top_h, length = 0.76, 1.4
    widths = (0.2, 0.18, 0.215, 0.185)
    y = -sum(widths) / 2 - 0.015
    for k, wdt in enumerate(widths):  # uneven bleached planks
        yc = y + wdt / 2
        p.box((length + jitter(6, k, 0.04), wdt, 0.05), (jitter(7, k, 0.015), yc, top_h - 0.025 + jitter(8, k, 0.004)), top_m,
              rot=(0, 0, math.radians(jitter(9, k, 1.2))), bevel=0.01)
        y += wdt + 0.01
    for sx in (-1, 1):
        x = sx * 0.5
        p.box((0.09, 0.74, 0.06), (x, 0, top_h - 0.08), dark, bevel=0.008)  # cleat under the top
        for sy in (-1, 1):  # splayed rough-log legs
            p.tube([(x + sx * 0.06, sy * 0.33, 0.0), (x + sx * 0.03 + jitter(10, sx + sy, 0.01), sy * 0.3, 0.35),
                    (x, sy * 0.27, top_h - 0.1)], 0.04, dark, sides=6)
        p.tube([(x + sx * 0.04, -0.31, 0.24), (x + sx * 0.04, 0.31, 0.24)], 0.028, dark, sides=6)  # end rail
    p.tube([(-0.54, 0, 0.24), (0.0, 0.01, 0.25), (0.54, 0, 0.24)], 0.032, dark, sides=6)  # long stretcher


def build_sea_chest(p):
    paint, iron = p.material("teal_paint", roughness=0.85), p.material("iron_dark", roughness=0.7)
    brass, rope, wood = p.material("brass", roughness=0.45, metallic=0.2), p.material("rope"), p.material("oak_dark")
    w, d, body_h, lid_h = 0.88, 0.5, 0.36, 0.14
    p.box((w + 0.02, d + 0.02, 0.04), (0, 0, 0.02), wood, bevel=0.006)  # plinth
    p.box((w, d, body_h), (0, 0, 0.04 + body_h / 2), paint, bevel=0.012)
    lid_z = 0.04 + body_h
    p.box((w + 0.03, d + 0.03, lid_h), (0, 0, lid_z + lid_h / 2 + 0.004), paint, bevel=0.02)
    band_t = 0.008
    for x in (-0.29, 0.29):  # iron bands wrapping front, top and back
        p.box((0.045, d + 2 * band_t, body_h), (x, 0, 0.04 + body_h / 2), iron)
        p.box((0.045, d + 0.03 + 2 * band_t, lid_h + 0.004), (x, 0, lid_z + lid_h / 2 + 0.004), iron)
        p.box((0.045, d + 0.03 + 2 * band_t, band_t), (x, 0, lid_z + lid_h + 0.008), iron)
    for sx in (-1, 1):  # corner irons
        for sy in (-1, 1):
            p.box((0.06, 0.06, 0.05), (sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), lid_z - 0.02), iron)
        p.ring(0.06, 0.012, (sx * (w / 2 + 0.012), 0, lid_z - 0.07), rope, segments=8, sides=5,
               rot=(-math.pi / 2, 0, math.pi / 2), arc=math.pi)  # rope becket handles, hanging
        p.box((0.02, 0.05, 0.05), (sx * (w / 2 + 0.006), 0.07, lid_z - 0.07), wood)
        p.box((0.02, 0.05, 0.05), (sx * (w / 2 + 0.006), -0.07, lid_z - 0.07), wood)
    p.box((0.1, 0.012, 0.12), (0, -d / 2 - 0.02, lid_z + 0.005), brass, bevel=0.004)  # lock plate
    p.cylinder(0.012, 0.01, (0, -d / 2 - 0.03, lid_z - 0.02), iron, segments=6, rot=(math.pi / 2, 0, 0))  # keyhole


# --------------------------------------------------------------------------
# Registry: build function + catalog manifest fields (size is measured)
# --------------------------------------------------------------------------

def _entry(builder, name, description, tags, colour, object_type, affordances, state, solid=True,
           indoor=True, outdoor=True):
    return {"builder": builder, "name": name, "description": description, "tags": tags, "color": colour,
            "objectType": object_type, "initialState": state, "affordances": affordances, "solid": solid,
            "placement": {"indoor": indoor, "outdoor": outdoor}}


PROPS = {
    "barrel": _entry(build_barrel, "Oak barrel", "A salt-stained oak barrel bound with two iron hoops.",
                     ["coastal", "storage", "harbour", "outdoor", "indoor"], "#9b6a3c", "object", ["examine"], "normal"),
    "fish-crate": _entry(build_fish_crate, "Fish crate", "A slatted pine fish crate with a loose plank lid and rope grab handles.",
                         ["coastal", "storage", "fishing", "harbour", "container"], "#c9a46e", "chest",
                         ["open", "close", "examine"], "closed"),
    "harbour-bench": _entry(build_harbour_bench, "Harbour bench", "A weathered plank bench, backless, long enough for one or two to sit.",
                            ["coastal", "seat", "gathering", "outdoor", "harbour"], "#a89d89", "chair", ["sit"], "empty"),
    "lantern-post": _entry(build_lantern_post, "Lantern post", "A slim iron post with a warm lantern hanging from its arm.",
                           ["coastal", "light", "street", "outdoor", "harbour"], "#4a4f54", "object", ["examine"], "normal",
                           indoor=False),
    "net-rack": _entry(build_net_rack, "Net drying rack", "Two weathered posts and a crossbar with a fishing net hung out to dry, cork floats on its hem.",
                       ["coastal", "fishing", "outdoor", "harbour", "work"], "#5c7d74", "object", ["examine"], "normal",
                       indoor=False),
    "ship-bell": _entry(build_ship_bell, "Ship's bell", "A brass ship's bell hung in a small oak frame, a rope lanyard on its clapper.",
                        ["coastal", "signal", "harbour", "gathering", "outdoor", "indoor"], "#c9a14a", "object", ["examine"], "normal"),
    "rope-coil": _entry(build_rope_coil, "Coil of rope", "A heavy mooring rope coiled flat on the ground, its end trailing loose.",
                        ["coastal", "fishing", "harbour", "outdoor", "clutter"], "#cdb485", "object", ["examine"], "normal",
                        solid=False),
    "lobster-pot": _entry(build_lobster_pot, "Lobster pot", "A bent-wood lobster trap with netted ends and a funnel entrance.",
                          ["coastal", "fishing", "harbour", "outdoor", "clutter"], "#8c6a4a", "object", ["examine"], "normal"),
    "driftwood-table": _entry(build_driftwood_table, "Driftwood table", "A rough outdoor table of bleached, uneven driftwood planks on splayed log legs.",
                              ["coastal", "table", "gathering", "outdoor", "surface"], "#bab09c", "table", ["examine"], "normal"),
    "sea-chest": _entry(build_sea_chest, "Sea chest", "A painted sailor's chest bound in iron, with rope beckets and a brass lock plate.",
                        ["coastal", "storage", "indoor", "container", "sailor"], "#44707a", "chest",
                        ["open", "close", "examine"], "closed"),
}


def manifest(prop_id, spec, stats):
    return {
        "id": prop_id,
        "name": spec["name"],
        "description": spec["description"],
        "tags": spec["tags"],
        "model": f"{MODEL_PREFIX}/{prop_id}.glb",
        "size": {"x": round(stats["width"], 3), "y": round(stats["height"], 3), "z": round(stats["depth"], 3)},
        "color": spec["color"],
        "objectType": spec["objectType"],
        "initialState": spec["initialState"],
        "affordances": spec["affordances"],
        "solid": spec["solid"],
        "portable": False,
        "placement": spec["placement"],
        "growable": True,
        "license": dict(LICENSE),
    }


def export_glb(ob, path):
    for other in bpy.context.scene.objects:
        other.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_normals=True, export_materials="EXPORT", export_colors=False,
        export_cameras=False, export_lights=False, export_extras=False, export_animations=False,
        export_copyright="Argos-authored, CC0-1.0",
    )


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="coastal_props.py")
    ap.add_argument("out_pos", nargs="?", help="output directory (same as --out)")
    ap.add_argument("--out", help=f"output directory (default {DEFAULT_OUT})")
    ap.add_argument("--catalog", help="also write the catalog manifest JSON to this path")
    ap.add_argument("--only", help="comma-separated prop ids")
    return ap.parse_args(argv)


def main():
    args = parse_args()
    out = os.path.abspath(args.out or args.out_pos or DEFAULT_OUT)
    os.makedirs(out, exist_ok=True)
    ids = list(PROPS) if not args.only else [i.strip() for i in args.only.split(",") if i.strip()]
    unknown = [i for i in ids if i not in PROPS]
    if unknown:
        raise SystemExit(f"unknown prop ids: {unknown}")
    manifests = []
    for prop_id in ids:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        spec = PROPS[prop_id]
        prop = Prop(prop_id)
        spec["builder"](prop)
        ob, stats = prop.build()
        if stats["tris"] > TRI_BUDGET:
            raise SystemExit(f"{prop_id}: {stats['tris']} tris exceeds budget {TRI_BUDGET}")
        path = os.path.join(out, f"{prop_id}.glb")
        export_glb(ob, path)
        manifests.append(manifest(prop_id, spec, stats))
        print(f"PROP {prop_id:16s} tris={stats['tris']:5d} "
              f"w={stats['width']:.3f} d={stats['depth']:.3f} h={stats['height']:.3f} -> {path}")
    if args.catalog:
        with open(args.catalog, "w") as fh:
            json.dump({"assets": manifests}, fh, indent=2)
            fh.write("\n")
        print(f"CATALOG {args.catalog} ({len(manifests)} assets)")


if __name__ == "__main__":
    main()
