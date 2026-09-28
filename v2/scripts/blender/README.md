# Shadow-Blender asset workshop

Headless Blender scripts that author **original** spatial-demo props from
code. The models are built from primitives, so there are no imported meshes, no
image textures and no third-party content. Output is GLB plus a catalog
manifest that `loadSpatialAssetCatalog` reads (see
`src/demo/spatial-client/assets/catalog/README.md`).

`coastal_props.py` is the first set: ten coastal props for Saltmere.

## Run

From `v2/` (Blender 3.0+, no network, no GPU needed):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python scripts/blender/coastal_props.py -- \
  --catalog src/demo/spatial-client/assets/catalog/coastal.json
```

Options after `--`:

| option | meaning |
| --- | --- |
| `[DIR]` or `--out DIR` | GLB output directory (default `src/demo/spatial-client/assets/generated/coastal/`) |
| `--catalog FILE` | also write `{ "assets": [...] }` manifests; sizes are measured from the built mesh |
| `--only a,b` | build only these prop ids |

Each prop prints a `PROP <id> tris=… w=… d=… h=…` line. The script fails if a
prop goes over the 2 000-triangle budget. Output is deterministic: running it
twice gives byte-identical GLBs and catalog.

## What it produces

`barrel`, `fish-crate`, `harbour-bench`, `lantern-post`, `net-rack`,
`ship-bell`, `rope-coil`, `lobster-pot`, `driftwood-table`, `sea-chest`. Each is
exported to `assets/generated/coastal/<id>.glb` and listed in
`assets/catalog/coastal.json`. Every prop has 360 to 940 triangles.

Conventions shared by every workshop script:

- Metres at real-world scale, with Z up in Blender. The glTF export converts to +Y up.
- The pivot is at the base centre: the bounds are centred on X/Y and the bottom
  is at z = 0.
- The front, where a person stands to use the prop, faces **-Y** in Blender. That
  is +Z in glTF/three.js and +y on the engine ground plane before `rotationY`.
- One joined mesh per prop. Modifiers are applied. Shading is flat. Materials
  are Principled BSDF with a flat base colour, roughness 0.45–1 and metallic at
  most 0.2, because the viewer has no environment map. The only emissive
  surface is the lantern glass. Nets use double-sided materials and all other
  materials are single-sided. This matches the soft, flat-colour Kenney
  furniture already in `assets/furniture/`.
- The viewer rescales each model to its manifest `size`. That is why the
  manifest sizes are measured from the exported bounds rather than typed by hand.
- Behaviour comes only from the manifest's `objectType` and `affordances`. A
  mesh never grants an action. The allowed combinations are `object` + examine,
  `chair` + sit, `table` + examine and `chest` + open/close/examine.

## Extending: the kit

The `Prop` class is a deliberately small, restricted "kit". A new prop is a
`build_<id>(p)` function that only calls these helpers:

| helper | builds |
| --- | --- |
| `p.material(key, roughness, metallic, emission, double_sided)` | cached flat-colour material; `key` is a `PALETTE` name or `#rrggbb` |
| `p.box(size, at, mat, rot, bevel)` / `p.box_between(lo, hi, mat)` | boxes with an optional soft bevel |
| `p.cylinder(r, depth, at, mat, segments, rot, radius_top)` | cylinders, frustums and pyramids (few segments) |
| `p.lathe(profile, mat, segments, closed)` | solids of revolution such as barrels, bells, hoops and knobs |
| `p.tube(points, r, mat, sides, closed)` | swept rope, bent bars and log legs |
| `p.ring(r, thickness, at, mat, arc, rot)` | loops, handles and hooks |
| `p.sheet(fn, nu, nv, mat)` | thin parametric surfaces such as nets or cloth (double-sided material) |
| `jitter(seed, i, amount)` | deterministic "weathering" offsets, with no RNG state |

After writing the function, add a `PROPS[id] = _entry(...)` row with the
name, description, tags, colour, `objectType`, affordances, initial state,
solidity and placement. `main()` then builds the prop, applies the budget, pivots
it, exports it and measures it.

A future daemon that proposes new props should be held to the same limits:

1. It writes only a `build_<id>` body and a `PROPS` row, using the kit helpers
   above. It gets no file I/O, no `bpy.ops` and no imports.
2. It uses only object types and affordances the spatial host executes.
3. The build runs headless into a scratch `--out` directory first. The daemon
   then checks the budget, bounds and pivot, and renders a preview. The GLB and
   manifest are promoted to `assets/generated/<set>/` and `assets/catalog/`
   only after that check passes.
4. Provenance stays "Argos-authored (Blender procedural, <script>)",
   licensed CC0-1.0.
