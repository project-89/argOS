# Argos spatial testbed assets

Selected assets by **Kenney**, distributed under **Creative Commons Zero (CC0 1.0)**. Attribution is not required; it is retained here for provenance. No paid asset packs are included.

- Furniture Kit: https://kenney.nl/assets/furniture-kit
  - Official download: https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip
  - Selected GLBs: loungeSofa, tableCoffee, chairCushion, tableRound, plantSmall1, lampRoundFloor, bookcaseOpen, kitchenCabinet, kitchenFridge, rugRectangle.
  - Original license: [furniture/LICENSE.txt](furniture/LICENSE.txt).
- Blocky Characters 2.0: https://kenney.nl/assets/blocky-characters
  - Official download: https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip
  - Selected models: character-f.glb (Mara), character-b.glb (Ivo), character-a.glb (spare), plus each model’s referenced PNG texture. These are visibly stylized catalog avatars, not photorealistic identity reproductions.
  - Original license: [characters/LICENSE.txt](characters/LICENSE.txt).

Official pages and included licenses verified 2026-09-25. Models are unmodified source files, normalized in the viewer to the engine-authored size. The models include presentation-only animation clips; playing a clip never grants a simulation action or completion.

Simple floor, wall, phone and fallback geometry are authored for this testbed. These cosmetic representations do not add unrecorded entities or mechanics to the world.

CC0: https://creativecommons.org/publicdomain/zero/1.0/

## Argos-authored generated props (CC0)

`generated/coastal/*.glb` contains ten original coastal props for the Saltmere town: barrel, fish-crate, harbour-bench, lantern-post, net-rack, ship-bell, rope-coil, lobster-pot, driftwood-table and sea-chest. They were **authored by Argos**, entirely procedurally, in headless Blender by [`scripts/blender/coastal_props.py`](../../../../scripts/blender/coastal_props.py). No third-party meshes, textures or scans are used, and the models are only primitives, modifiers and flat base-colour materials. They are dedicated to the public domain under **CC0 1.0**. The script is deterministic, so rerunning it reproduces the files byte for byte. Their catalog manifests are in [catalog/coastal.json](catalog/coastal.json). The sizes there are measured from the exported bounds, and behaviour comes only from the native `objectType` and affordances listed.
