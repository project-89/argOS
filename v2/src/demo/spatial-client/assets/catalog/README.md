# Spatial asset catalog

Every `*.json` file in this directory is loaded by `loadSpatialAssetCatalog` at
startup. A file holds one manifest or `{ "assets": [manifest, ...] }`. Spirits,
God and the operator can then build any registered kind wherever free-space
placement validates it. A mesh only changes appearance: behaviour comes from the
native `objectType` and the listed `affordances`, which must be verbs the spatial
host actually executes.

```jsonc
{
  "id": "barrel",                       // ^[a-z][a-z0-9-]{0,63}$, unique
  "name": "Weathered barrel",           // shown to spirits/God
  "description": "A salt-stained oak barrel with iron hoops.",
  "tags": ["coastal", "storage", "outdoor"],
  "model": "generated/coastal/barrel.glb", // relative to assets/, .glb, must exist; omit for a primitive box
  "size": { "x": 0.6, "y": 0.9, "z": 0.6 },  // metres; x/z footprint, y height
  "color": "#7a5a3a",                   // fallback/tint colour
  "objectType": "object",               // a registered native type: object, chair, table, chest, ...
  "initialState": "normal",             // optional; must be one of that type's states
  "affordances": ["examine"],           // subset of examine, sit, open, close, eat, take, compatible with the type
  "solid": true,                        // blocks movement; collider defaults to the footprint
  "collider": { "halfWidth": 0.3, "halfDepth": 0.3 }, // optional override
  "anchors": [{ "x": 0, "y": -0.85 }],  // optional approach offsets; default is tried on all four sides
  "portable": false,                    // portable items are small and never solid
  "placement": { "indoor": true, "outdoor": true },
  "growable": true,                     // offered to spirits/God for construction
  "license": { "source": "Argos-authored (Blender procedural)", "license": "CC0-1.0" }
}
```

Coordinates follow the engine: ground-plane `x`/`y` in metres, rendered as
three.js `x`/`z`. Models are normalised in the viewer to `size`, so a GLB should
already have a sensible pivot at its base centre and roughly these proportions.
