"""Argos asset workshop: build one model from generated kit code, safely.

A daemon (or a person) supplies the source of `def build(p): ...` written only
against the restricted kit (coastal_props.Prop: box, box_between, cylinder,
lathe, tube, ring, sheet, material) plus `math` and `jitter`. Before anything
runs, the source is parsed and checked against an allowlist of Python syntax:
no imports, no dunder or private names, no attribute access except the kit's
drawing methods and math's functions, no while loops. It then runs with a bare
set of builtins, a cap on parts, and the caller's time limit; the result must
fit the triangle budget and the target proportions before it is exported.

    blender --background --factory-startup --python scripts/blender/workshop_build.py -- \
        --spec SPEC.json --out MODEL.glb --result RESULT.json

SPEC: {"id": "...", "size": {"x": w, "y": h, "z": d}, "source": "def build(p): ..."}
RESULT: {"ok": true, "tris": n, "width": w, "depth": d, "height": h} or {"ok": false, "error": "..."}
"""

import argparse
import ast
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coastal_props import Prop, export_glb, jitter  # noqa: E402  (the shared kit)

TRI_BUDGET = 2000
MAX_PARTS = 300
MAX_SOURCE = 8000
KIT = {"box", "box_between", "cylinder", "lathe", "tube", "ring", "sheet", "material"}
# Harmless list methods on the build's own variables (points.append(...)); nothing reaches into kit objects.
LIST_METHODS = {"append", "extend", "insert", "pop", "reverse", "index", "count"}
MATH = {"pi", "tau", "sin", "cos", "tan", "atan2", "sqrt", "radians", "degrees", "hypot", "floor", "ceil", "fabs"}
BUILTINS = {"range": range, "len": len, "abs": abs, "min": min, "max": max, "enumerate": enumerate, "zip": zip,
            "round": round, "float": float, "int": int, "list": list, "tuple": tuple, "sum": sum}
ALLOWED = (
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.Assign, ast.AugAssign, ast.For, ast.If,
    ast.Expr, ast.Call, ast.keyword, ast.Name, ast.Load, ast.Store, ast.Constant, ast.BinOp, ast.UnaryOp, ast.BoolOp,
    ast.Compare, ast.IfExp, ast.Tuple, ast.List, ast.Attribute, ast.Subscript, ast.Slice, ast.Lambda,
    ast.ListComp, ast.GeneratorExp, ast.comprehension, ast.Pass,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow, ast.USub, ast.UAdd, ast.Not, ast.And, ast.Or,
    ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
)


def check_source(source):
    """The allowlist. Returns an error string, or None when the source may run."""
    if len(source) > MAX_SOURCE:
        return f"source longer than {MAX_SOURCE} characters"
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return f"syntax error on line {error.lineno}: {error.msg}"
    top = [n for n in tree.body if not isinstance(n, ast.Expr)]  # a docstring is fine
    if not any(isinstance(n, ast.FunctionDef) and n.name == "build" for n in top) or not all(isinstance(n, ast.FunctionDef) for n in top):
        return "define only functions, including build(p)"
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED):
            return f"{type(node).__name__} is not allowed (line {getattr(node, 'lineno', '?')})"
        if isinstance(node, ast.Name) and node.id.startswith("_"):
            return f"name {node.id} is not allowed"
        if isinstance(node, ast.FunctionDef) and (node.decorator_list or node.name.startswith("_")):
            return f"function {node.name}: no decorators or private names"
        if isinstance(node, ast.Attribute):
            owner = node.value.id if isinstance(node.value, ast.Name) else None
            list_method = owner not in (None, "p", "math") and node.attr in LIST_METHODS
            if not ((owner == "p" and node.attr in KIT) or (owner == "math" and node.attr in MATH) or list_method):
                return f"attribute {owner or '?'}.{node.attr} is not allowed (only p.<kit>, math.<fn>, and list methods on your own variables)"
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and len(node.value) > 40:
            return "long string constants are not allowed"
    return None


class Capped(Prop):
    """The kit, with a ceiling on how many parts one build may add."""

    def _add(self, *args, **kwargs):
        if len(self.parts) >= MAX_PARTS:
            raise RuntimeError(f"more than {MAX_PARTS} parts")
        return super()._add(*args, **kwargs)


def run(spec, out):
    error = check_source(spec["source"])
    if error:
        return {"ok": False, "error": f"refused: {error}"}
    scope = {"__builtins__": dict(BUILTINS), "math": math, "jitter": jitter}
    try:
        exec(compile(spec["source"], f"<{spec['id']}>", "exec"), scope)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        prop = Capped(spec["id"])
        scope["build"](prop)
        if not prop.parts:
            return {"ok": False, "error": "build(p) made nothing"}
        ob, stats = prop.build()
    except Exception as error:  # the builder's own mistake, reported back for a retry
        return {"ok": False, "error": f"build failed: {type(error).__name__}: {str(error)[:300]}"}
    if stats["tris"] > TRI_BUDGET:
        return {"ok": False, "error": f"{stats['tris']} triangles exceeds the budget of {TRI_BUDGET}"}
    size = spec["size"]
    for axis, measured in (("x", stats["width"]), ("z", stats["depth"]), ("y", stats["height"])):
        if measured <= 1e-4:
            return {"ok": False, "error": f"flat along {axis}"}
        stretch = size[axis] / measured
        if not 0.4 <= stretch <= 2.5:
            return {"ok": False, "error": f"proportions off: {axis} measures {measured:.2f} m, the thing is {size[axis]:.2f} m "
                                          f"(build it close to {size['x']:.2f} wide x {size['z']:.2f} deep x {size['y']:.2f} tall)"}
    export_glb(ob, out)
    return {"ok": True, **{k: round(v, 3) if isinstance(v, float) else v for k, v in stats.items()}}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="workshop_build.py")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--result", required=True)
    args = ap.parse_args(argv)
    with open(args.spec) as fh:
        spec = json.load(fh)
    result = run(spec, os.path.abspath(args.out))
    with open(args.result, "w") as fh:
        json.dump(result, fh)


if __name__ == "__main__":
    main()
