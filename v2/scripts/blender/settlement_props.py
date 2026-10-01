"""Argos shadow-Blender workshop: Saltmere settlement stations and goods.

Original low-poly models for the walkable settlement, built only from the
restricted kit in coastal_props.py (box, cylinder, lathe, tube, ring, sheet).
Each is built to the size its built-in spatial kind already has (the viewer
stretches a model to that size on every axis), so collision and behaviour are
unchanged: a model only changes how a tent, a stall or a log looks.

Run headless (Blender 3.0+):

    blender --background --factory-startup \
        --python scripts/blender/settlement_props.py -- [--out DIR] [--only id,id] [--report FILE]

Same conventions as coastal_props.py: metres, Blender Z up, pivot at the base
centre, front faces -Y, flat colours, deterministic (no randomness).
"""

import argparse
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coastal_props import ASSETS_DIR, Prop, export_glb, jitter  # noqa: E402  (the shared kit)

DEFAULT_OUT = os.path.join(ASSETS_DIR, "generated", "settlement")
TRI_BUDGET = 2000

COL = {
    "canvas": "#c9b994", "canvas_dark": "#a8976f", "pole": "#7a5a3a", "peg": "#5e4630", "rope": "#cdb485",
    "plank": "#a77d52", "plank_dark": "#7f5d3b", "awning_a": "#b5553d", "awning_b": "#e6d8b8",
    "stone": "#8d8f8a", "stone_dark": "#6f716c", "stone_light": "#a7a8a2", "ember": "#e0662b", "flame": "#ffb347",
    "bark": "#6b4b31", "wood_cut": "#c9a46e", "leaf": "#4f7a3f", "leaf_dark": "#3d6331", "berry": "#7b2f4f",
    "soil": "#6a523a", "flax_stem": "#8fa36a", "flax_flower": "#8fa6d6", "water": "#3f6f86", "water_light": "#6b9cb0",
    "iron": "#4a4f54", "net": "#5c7d74", "float": "#e08a3c", "fish": "#9fb3b8", "fish_belly": "#d6dcd8",
    "fish_cooked": "#b9844d", "fish_char": "#6b4528", "basket": "#b08d57", "twine": "#d8c9a0", "clay": "#b4704a",
}


def m(p, key, **kw):
    if "emission" in kw:
        kw["emission"] = COL.get(kw["emission"], kw["emission"])
    return p.material(COL.get(key, key), **kw)


def blob(p, r, at, mat, segments=6, squash=1.0):
    """A low-poly rounded lump (lathe half-circle profile)."""
    profile = [(0.0, -r * squash)] + [(r * math.sin(math.pi * k / 4), -r * squash * math.cos(math.pi * k / 4)) for k in range(1, 4)] + [(0.0, r * squash)]
    return p.lathe(profile, mat, segments=segments, at=at)


# --------------------------------------------------------------------------
# Stations (sizes from SPATIAL_ASSETS: x = width, y = height, z = depth)
# --------------------------------------------------------------------------

def build_tent(p):  # 2.4 x 1.6 x 2.4
    canvas, dark, pole, rope, peg = m(p, "canvas", double_sided=True), m(p, "canvas_dark", double_sided=True), m(p, "pole"), m(p, "rope"), m(p, "peg")
    half_w, depth, ridge = 1.0, 2.0, 1.55
    slope = math.hypot(half_w, ridge - 0.05)
    angle = math.atan2(ridge - 0.05, half_w)
    for sx in (-1, 1):  # two canvas sides meeting at the ridge
        p.box((0.03, depth, slope), (sx * half_w / 2, 0, (ridge + 0.05) / 2), canvas, rot=(0, -sx * (math.pi / 2 - angle), 0))
    p.box((2 * half_w + 0.1, depth + 0.1, 0.02), (0, 0, 0.01), dark)  # ground cloth

    def gable(y, open_flap):
        def fn(u, v):  # a triangle; the front one has its flap folded back
            x = (u - 0.5) * 2 * half_w * (1 - v)
            if open_flap and u > 0.5:
                x = half_w * (1 - v) * (0.15 + 0.2 * (u - 0.5))
            return (x, y, 0.05 + v * (ridge - 0.05))
        return fn
    p.sheet(gable(depth / 2, False), 2, 2, canvas)
    p.sheet(gable(-depth / 2, True), 2, 2, dark)
    for y in (-depth / 2 - 0.02, depth / 2 + 0.02):  # uprights
        p.box((0.05, 0.05, ridge + 0.06), (0, y, (ridge + 0.06) / 2), pole)
    p.cylinder(0.025, depth + 0.2, (0, 0, ridge + 0.02), pole, segments=6, rot=(math.pi / 2, 0, 0))  # ridge pole
    for sy in (-1, 1):  # guy ropes to pegs
        p.tube([(0, sy * (depth / 2 + 0.1), ridge), (0, sy * 1.18, 0.05)], 0.008, rope, sides=4)
        p.box((0.04, 0.04, 0.12), (0, sy * 1.18, 0.06), peg)


def build_market_stall(p):  # 3 x 2.2 x 1.4
    plank, dark, a, b = m(p, "plank"), m(p, "plank_dark"), m(p, "awning_a", double_sided=True), m(p, "awning_b", double_sided=True)
    basket, fish, berry = m(p, "basket"), m(p, "fish"), m(p, "berry")
    w, d = 2.9, 1.0
    p.box((w, d, 0.08), (0, 0.1, 0.9), plank, bevel=0.01)  # counter top
    p.box((w - 0.1, 0.05, 0.82), (0, -d / 2 + 0.12, 0.43), dark)  # counter front
    for sx in (-1, 1):
        p.box((0.05, d - 0.1, 0.82), (sx * (w / 2 - 0.05), 0.1, 0.43), dark)
        for sy in (-1, 1):  # posts up to the awning
            p.box((0.08, 0.08, 2.15), (sx * (w / 2 - 0.04), 0.1 + sy * (d / 2 - 0.04), 1.075), dark, bevel=0.006)
    stripes = 6
    for k in range(stripes):  # striped awning sloping to the front
        x = -w / 2 + (k + 0.5) * w / stripes
        p.box((w / stripes, 1.4, 0.03), (x, -0.05, 2.08), a if k % 2 == 0 else b, rot=(math.radians(-10), 0, 0))
    for k, x in enumerate((-0.9, 0.0, 0.9)):  # baskets of goods on the counter
        p.cylinder(0.2, 0.16, (x, 0.15, 1.02), basket, segments=8, radius_top=0.24)
        if k == 1:
            for j in range(3):
                p.cylinder(0.035, 0.28, (x - 0.08 + 0.08 * j, 0.15, 1.12), fish, segments=6, rot=(0, math.pi / 2, 0))
        else:
            for j in range(5):
                blob(p, 0.05, (x + jitter(11, j + k, 0.1), 0.15 + jitter(12, j + k, 0.1), 1.12), berry, segments=5)


def build_campfire(p):  # 1.2 x 0.5 x 1.2
    stone, dark = m(p, "stone"), m(p, "stone_dark")
    bark, ember, flame = m(p, "bark"), m(p, "ember", emission="ember"), m(p, "flame", emission="flame")
    for k in range(9):  # ring of stones
        a = 2 * math.pi * k / 9
        p.box((0.2, 0.16, 0.13), (0.47 * math.cos(a), 0.47 * math.sin(a), 0.065), stone if k % 2 else dark, rot=(0, 0, a), bevel=0.02)
    for k in range(4):  # logs leaning together
        a = math.pi / 4 + math.pi / 2 * k
        p.cylinder(0.045, 0.6, (0.14 * math.cos(a), 0.14 * math.sin(a), 0.18), bark, segments=6,
                   rot=(math.radians(55) * math.sin(a), -math.radians(55) * math.cos(a), 0))
    p.cylinder(0.24, 0.05, (0, 0, 0.03), ember, segments=8)  # embers
    p.cylinder(0.16, 0.38, (0, 0, 0.27), flame, segments=6, radius_top=0.0)  # flame
    p.cylinder(0.09, 0.28, (0.05, 0.04, 0.26), ember, segments=5, radius_top=0.0)


def build_stump(p):  # 0.8 x 0.5 x 0.8
    bark, cut = m(p, "bark"), m(p, "wood_cut")
    p.lathe([(0.0, 0.0), (0.4, 0.0), (0.36, 0.08), (0.31, 0.3), (0.3, 0.46), (0.0, 0.46)], bark, segments=10)
    p.cylinder(0.27, 0.04, (0, 0, 0.47), cut, segments=10)  # pale cut top
    p.ring(0.15, 0.008, (0, 0, 0.49), bark, segments=10, sides=3)  # growth ring
    for k in range(3):  # chips at the foot
        p.box((0.08, 0.04, 0.02), (0.35 * math.cos(k * 2.1), 0.35 * math.sin(k * 2.1), 0.01), cut, rot=(0, 0, k))


def build_stone_pile(p):  # 2.2 x 0.9 x 2.0
    tones = [m(p, "stone"), m(p, "stone_dark"), m(p, "stone_light")]
    k = 0
    for layer, (count, radius, z, size) in enumerate(((9, 0.75, 0.15, 0.36), (6, 0.45, 0.42, 0.32), (3, 0.18, 0.66, 0.3))):
        for i in range(count):
            a = 2 * math.pi * i / count + layer * 0.4
            s = size * (0.85 + 0.3 * abs(jitter(13, k, 1)))
            p.box((s * 1.3, s, s * 0.8), (radius * math.cos(a) * 1.05, radius * math.sin(a) * 0.95, z), tones[k % 3],
                  rot=(jitter(14, k, 0.3), jitter(15, k, 0.3), a), bevel=0.04)
            k += 1


def build_bramble(p):  # 1.6 x 1.1 x 1.6
    leaf, dark, berry = m(p, "leaf"), m(p, "leaf_dark"), m(p, "berry")
    clumps = [(0, 0, 0.55, 0.45), (0.4, 0.2, 0.4, 0.35), (-0.4, 0.15, 0.38, 0.36), (0.1, -0.42, 0.36, 0.34), (-0.2, 0.45, 0.4, 0.33)]
    for k, (x, y, z, r) in enumerate(clumps):
        blob(p, r, (x, y, z), leaf if k % 2 else dark, segments=7, squash=0.85)
    for k in range(14):  # berries on the outside
        a = 2 * math.pi * k / 14
        z = 0.35 + 0.4 * abs(jitter(16, k, 1))
        r = 0.62 - 0.25 * (z - 0.35)
        blob(p, 0.045, (r * math.cos(a), r * math.sin(a), z), berry, segments=5)


def build_flax_patch(p):  # 6 x 0.8 x 4
    soil, stem, flower = m(p, "soil"), m(p, "flax_stem"), m(p, "flax_flower")
    p.box((5.9, 3.9, 0.06), (0, 0, 0.03), soil)
    rows, per = 6, 9
    for r in range(rows):
        y = -1.6 + 3.2 * r / (rows - 1)
        p.box((5.6, 0.18, 0.05), (0, y, 0.08), soil)  # ridge
        for i in range(per):
            x = -2.6 + 5.2 * i / (per - 1) + jitter(17, r * per + i, 0.12)
            h = 0.6 + 0.12 * jitter(18, r * per + i, 1)
            p.box((0.1, 0.1, h), (x, y, 0.1 + h / 2), stem)  # a tuft of stalks
            p.box((0.16, 0.16, 0.06), (x, y, 0.1 + h + 0.02), flower)  # blue flowers


def build_fishing_water(p):  # 6 x 0.1 x 2 (flat: the shallows where the fish are)
    water, light, cork = m(p, "water", roughness=0.25), m(p, "water_light", roughness=0.25), m(p, "float")
    p.box((6.0, 2.0, 0.04), (0, 0, 0.02), water)
    for k, (x, y, r) in enumerate(((-1.6, 0.2, 0.35), (0.9, -0.3, 0.45), (2.2, 0.5, 0.25))):  # ripples
        p.ring(r, 0.02, (x, y, 0.05), light, segments=12, sides=3)
        p.ring(r * 0.55, 0.015, (x, y, 0.05), light, segments=10, sides=3)
    p.cylinder(0.05, 0.05, (0.9, -0.3, 0.07), cork, segments=6)  # a bobbing float


def build_spring(p):  # 1.8 x 0.7 x 1.8
    stone, dark, water = m(p, "stone"), m(p, "stone_dark"), m(p, "water", roughness=0.25)
    plank, rope = m(p, "plank_dark"), m(p, "rope")
    for k in range(12):  # dry-stone ring
        a = 2 * math.pi * k / 12
        p.box((0.42, 0.22, 0.5), (0.72 * math.cos(a), 0.72 * math.sin(a), 0.25), stone if k % 2 else dark, rot=(0, 0, a + math.pi / 2), bevel=0.03)
    p.cylinder(0.62, 0.05, (0, 0, 0.32), water, segments=12)
    p.box((0.5, 0.25, 0.04), (0.55, -0.55, 0.52), plank, rot=(0, 0, math.pi / 4))  # a board on the rim
    p.lathe([(0.0, 0.0), (0.09, 0.0), (0.11, 0.16), (0.1, 0.17), (0.08, 0.02), (0.0, 0.02)], plank, segments=8, at=(-0.55, -0.6, 0.5))  # bucket
    p.ring(0.1, 0.006, (-0.55, -0.6, 0.67), rope, segments=8, sides=3, rot=(math.pi / 2, 0, 0), arc=math.pi)


def build_workbench(p):  # 2 x 0.9 x 1
    plank, dark, iron, cut = m(p, "plank"), m(p, "plank_dark"), m(p, "iron", roughness=0.7), m(p, "wood_cut")
    p.box((2.0, 0.9, 0.08), (0, 0, 0.86), plank, bevel=0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.box((0.09, 0.09, 0.82), (sx * 0.9, sy * 0.38, 0.41), dark, bevel=0.006)
    p.box((1.8, 0.7, 0.04), (0, 0, 0.2), dark)  # shelf
    p.box((0.18, 0.12, 0.14), (-0.85, -0.42, 0.85), iron)  # vise
    p.cylinder(0.015, 0.25, (-0.85, -0.52, 0.85), iron, segments=5, rot=(math.pi / 2, 0, 0))
    p.box((0.5, 0.12, 0.012), (0.3, 0.1, 0.91), iron, rot=(0, 0, 0.3))  # saw blade
    p.box((0.15, 0.05, 0.04), (0.08, 0.04, 0.92), dark, rot=(0, 0, 0.3))
    p.cylinder(0.015, 0.3, (0.65, -0.2, 0.92), dark, segments=5, rot=(0, math.pi / 2, 0.8))  # hammer
    p.box((0.05, 0.1, 0.05), (0.75, -0.08, 0.93), iron, rot=(0, 0, 0.8))
    for k in range(3):  # offcuts on the shelf
        p.box((0.4, 0.1, 0.04), (-0.4 + 0.1 * k, 0.1 - 0.12 * k, 0.24 + 0.04 * k), cut)


def build_drying_rack(p):  # 2.5 x 1.8 x 0.5
    wood, dark, net, cork, fish = m(p, "plank"), m(p, "plank_dark"), m(p, "net", roughness=1.0, double_sided=True), m(p, "float"), m(p, "fish")
    for sx in (-1, 1):  # A-frame ends
        x = sx * 1.15
        for sy in (-1, 1):
            p.box((0.07, 0.07, 1.85), (x, sy * 0.17, 0.9), dark, rot=(sy * math.radians(-9), 0, 0))
    p.cylinder(0.035, 2.45, (0, 0, 1.75), wood, segments=6, rot=(0, math.pi / 2, 0))  # crossbar

    def drape(u, v):
        x = -0.95 + 1.9 * u
        return (x, -0.04 - 0.06 * math.sin(math.pi * v), 1.72 - v * (0.95 - 0.12 * math.sin(math.pi * u)))
    p.sheet(drape, 10, 4, net)
    for k in range(4):
        x, y, z = drape((k + 0.5) / 4, 1.0)
        p.cylinder(0.03, 0.045, (x, y - 0.03, z), cork, segments=6, rot=(math.pi / 2, 0, 0))
    for k in range(3):  # fish hung to dry on the far side
        x = -0.6 + 0.6 * k
        p.tube([(x, 0.06, 1.72), (x, 0.06, 1.55)], 0.006, dark, sides=3)
        p.cylinder(0.035, 0.3, (x, 0.06, 1.38), fish, segments=6, radius_top=0.015)


# --------------------------------------------------------------------------
# Goods (lying down: length along X, ~0.12 tall, ~0.15 deep)
# --------------------------------------------------------------------------

def build_axe(p):
    handle, iron = m(p, "wood_cut"), m(p, "iron", roughness=0.6)
    p.cylinder(0.025, 0.72, (-0.04, 0, 0.06), handle, segments=6, rot=(0, math.pi / 2, 0))
    p.box((0.1, 0.03, 0.12), (0.33, 0, 0.06), iron)  # head
    p.box((0.05, 0.13, 0.12), (0.35, -0.05, 0.06), iron)  # blade toward the front


def build_net(p):
    net, cork = m(p, "net", roughness=1.0), m(p, "float")
    p.box((0.46, 0.14, 0.09), (0, 0, 0.045), net, bevel=0.02)  # a folded bundle
    p.box((0.4, 0.12, 0.03), (0.02, 0, 0.1), net, bevel=0.01)
    for k in range(3):
        p.cylinder(0.022, 0.03, (-0.15 + 0.15 * k, -0.075, 0.07), cork, segments=6, rot=(math.pi / 2, 0, 0))


def build_torn_net(p):
    net, rope = m(p, "#4b6159", roughness=1.0), m(p, "rope")
    p.box((0.2, 0.14, 0.08), (-0.14, 0, 0.04), net, bevel=0.02)
    p.box((0.18, 0.12, 0.06), (0.15, 0.01, 0.03), net, rot=(0, 0, 0.25), bevel=0.02)
    p.tube([(-0.04, 0, 0.07), (0.0, 0.03, 0.1), (0.05, -0.02, 0.08)], 0.008, rope, sides=4)  # a frayed end


def build_log(p):
    bark, cut = m(p, "bark"), m(p, "wood_cut")
    p.cylinder(0.06, 0.86, (0, 0, 0.06), bark, segments=8, rot=(0, math.pi / 2, 0))
    for sx in (-1, 1):
        p.cylinder(0.05, 0.012, (sx * 0.433, 0, 0.06), cut, segments=8, rot=(0, math.pi / 2, 0))


def build_firewood(p):
    bark, cut = m(p, "bark"), m(p, "wood_cut")
    for k, (y, z) in enumerate(((-0.045, 0.03), (0.045, 0.03), (0.0, 0.085))):
        p.box((0.38, 0.06, 0.055), (jitter(19, k, 0.01), y, z), cut if k == 2 else bark, rot=(math.pi / 4, 0, 0))


def build_planks(p):
    plank, dark = m(p, "awning_b"), m(p, "plank")
    for k in range(3):
        p.box((0.98, 0.14, 0.035), (jitter(20, k, 0.01), jitter(21, k, 0.005), 0.018 + 0.038 * k), dark if k == 1 else plank, bevel=0.004)


def build_stone(p):
    stone = m(p, "stone")
    p.box((0.22, 0.13, 0.1), (0, 0, 0.05), stone, rot=(0.15, -0.1, 0.3), bevel=0.03)


def _fish(p, body, belly, fin):
    p.lathe([(0.0, -0.16), (0.03, -0.12), (0.055, -0.02), (0.05, 0.06), (0.025, 0.12), (0.0, 0.14)], body, segments=8,
            at=(0, 0, 0.055), rot=(0, math.pi / 2, 0))
    p.box((0.05, 0.01, 0.09), (0.165, 0, 0.055), fin)  # tail
    p.box((0.12, 0.09, 0.012), (-0.02, 0, 0.012), belly)  # flat underside


def build_raw_fish(p):
    _fish(p, m(p, "fish"), m(p, "fish_belly"), m(p, "#7f959b"))


def build_cooked_fish(p):
    _fish(p, m(p, "fish_cooked"), m(p, "fish_char"), m(p, "fish_char"))
    for k in range(3):  # grill marks
        p.box((0.012, 0.11, 0.004), (-0.07 + 0.06 * k, 0, 0.11), m(p, "fish_char"))


def build_berries(p):
    basket, berry = m(p, "basket"), m(p, "berry")
    p.cylinder(0.065, 0.07, (0, 0, 0.035), basket, segments=8, radius_top=0.075)
    for k in range(5):
        a = 2 * math.pi * k / 5
        blob(p, 0.022, (0.035 * math.cos(a), 0.035 * math.sin(a), 0.085), berry, segments=5)
    blob(p, 0.024, (0, 0, 0.1), berry, segments=5)


def build_flax(p):
    stem, flower, rope = m(p, "flax_stem"), m(p, "flax_flower"), m(p, "rope")
    for k in range(5):
        p.cylinder(0.012, 0.46, (0, -0.04 + 0.02 * k, 0.04 + 0.01 * (k % 2)), stem, segments=4, rot=(0, math.pi / 2, jitter(22, k, 0.05)))
        p.box((0.04, 0.03, 0.03), (0.24, -0.04 + 0.02 * k, 0.04 + 0.01 * (k % 2)), flower)
    p.ring(0.035, 0.008, (-0.05, 0, 0.045), rope, segments=8, sides=3, rot=(0, math.pi / 2, 0))  # tied


def build_twine(p):
    twine, dark = m(p, "twine"), m(p, "#b9a77d")
    p.lathe([(0.0, -0.055), (0.03, -0.055), (0.05, -0.03), (0.055, 0.0), (0.05, 0.03), (0.03, 0.055), (0.0, 0.055)], twine,
            segments=8, at=(0, 0, 0.055), rot=(0, math.pi / 2, 0))
    p.tube([(0.05, 0.02, 0.06), (0.09, 0.05, 0.02), (0.13, 0.04, 0.01)], 0.006, dark, sides=3)  # loose end


def build_water(p):  # a stoppered clay jug lying on its side
    clay, cork = m(p, "clay"), m(p, "peg")
    p.lathe([(0.0, -0.11), (0.05, -0.11), (0.06, -0.06), (0.06, 0.02), (0.035, 0.07), (0.022, 0.09), (0.0, 0.09)], clay,
            segments=8, at=(0, 0, 0.06), rot=(0, math.pi / 2, 0))
    p.cylinder(0.02, 0.03, (0.105, 0, 0.06), cork, segments=6, rot=(0, math.pi / 2, 0))


# id -> (builder, name, description); sizes are the built-in kinds' own.
PROPS = {
    "tent": (build_tent, "Canvas tent", "An A-frame canvas tent pegged to the ground, its front flap folded back."),
    "market-stall": (build_market_stall, "Market stall", "A plank counter under a striped awning, baskets of fish and berries set out."),
    "campfire": (build_campfire, "Campfire", "A ring of stones around leaning logs and a low fire."),
    "stump": (build_stump, "Chopping stump", "A broad stump with a pale cut top, wood chips at its foot."),
    "stone-pile": (build_stone_pile, "Loose stone", "A heap of quarried stone at the foot of the cut face."),
    "bramble": (build_bramble, "Bramble", "A thorny bramble thicket heavy with dark berries."),
    "flax-patch": (build_flax_patch, "Flax field", "Ridged rows of flax in flower, blue over green."),
    "fishing-water": (build_fishing_water, "Fishing water", "The shallows where the fish run, ripples around a bobbing float."),
    "spring": (build_spring, "Well spring", "A dry-stone ring around cold spring water, a bucket on the rim."),
    "workbench": (build_workbench, "Workbench", "A heavy plank bench with a vise, a saw and a hammer, offcuts on the shelf."),
    "drying-rack": (build_drying_rack, "Drying rack", "An A-frame rack with a net hung over the bar and fish drying behind it."),
    "axe": (build_axe, "Axe", "A wood axe with an ash handle."),
    "net": (build_net, "Net", "A folded fishing net with cork floats."),
    "torn-net": (build_torn_net, "Torn net", "A net torn in two, frayed and in need of mending."),
    "log": (build_log, "Log", "A birch log."),
    "firewood": (build_firewood, "Firewood", "A small bundle of split firewood."),
    "planks": (build_planks, "Planks", "A short stack of sawn planks."),
    "stone": (build_stone, "Stone", "A rough building stone."),
    "raw-fish": (build_raw_fish, "Fish", "A fresh fish from the shallows."),
    "cooked-fish": (build_cooked_fish, "Cooked fish", "A fish cooked over the fire, grill-marked."),
    "berries": (build_berries, "Berries", "A small basket of bramble berries."),
    "flax": (build_flax, "Flax", "A tied bundle of flax stalks."),
    "twine": (build_twine, "Twine", "A ball of spun twine."),
    "water": (build_water, "Water", "A stoppered clay jug of spring water."),
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="settlement_props.py")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--only")
    ap.add_argument("--report", help="write measured sizes and triangle counts as JSON")
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    ids = list(PROPS) if not args.only else [i.strip() for i in args.only.split(",") if i.strip()]
    unknown = [i for i in ids if i not in PROPS]
    if unknown:
        raise SystemExit(f"unknown prop ids: {unknown}")
    report = {}
    for prop_id in ids:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        prop = Prop(prop_id)
        PROPS[prop_id][0](prop)
        ob, stats = prop.build()
        if stats["tris"] > TRI_BUDGET:
            raise SystemExit(f"{prop_id}: {stats['tris']} tris exceeds budget {TRI_BUDGET}")
        path = os.path.join(out, f"{prop_id}.glb")
        export_glb(ob, path)
        report[prop_id] = {k: round(v, 3) if isinstance(v, float) else v for k, v in stats.items()}
        print(f"PROP {prop_id:14s} tris={stats['tris']:5d} w={stats['width']:.3f} d={stats['depth']:.3f} h={stats['height']:.3f}")
    if args.report:
        with open(args.report, "w") as fh:
            json.dump(report, fh, indent=1)
            fh.write("\n")


if __name__ == "__main__":
    main()
