# Map Builder + 2D Rendering (Rooms-as-Zones) — UI-First Spec

This document specifies an end-to-end “map builder + 2D renderer” integration for Argos v2, with **rooms as zones** on a tilemap. The ECS world remains the **single source of truth**; the renderer/UI is a **projection**.

This spec is intentionally **UI-first** (the map editor lives inside the Argos UI), while also defining the **data + backend contracts** required to compile authored maps into ECS.

---

## 0) Goals / Non‑Goals

### Goals
- Provide an **in-UI map editor** (inside the Argos UI) to author a 2D world:
  - tiles (ground/deco)
  - collision/walkability
  - **room zones** (rectangles + polygons) as semantic aggregations of stimuli
  - spawn markers (NPCs/objects)
  - portals/doors (connectivity)
- Support **import from Tiled** (TMJ/JSON) as a starting point, and editing inside Argos thereafter.
- Render the simulation in 2D:
  - static tilemap + zone overlays
  - animated NPC sprites (rigs) + object sprites
  - UI overlays for thoughts, goals, plans, affordances, tool outputs, spirit messages
- Preserve determinism and grounding:
  - map is an authored substrate
  - ECS state is authoritative and drives all runtime behavior
  - map edits become data changes, not “ad-hoc rendering hacks”

### Non‑Goals (initially)
- Real-time generative sprite/map creation inside the sim loop.
- “Video world model as simulator” (a video model may be used as a renderer later, but should not be authoritative).
- Full Tiled feature parity (we support a defined subset).
- Complex physics (start with grid + collision + portals + zones).

---

## 1) Architecture: MapDoc → Compile → ECS → Render Projection

### North star
**Authoring artifact (MapDoc) → compiled into ECS entities + components → UI renders projections.**

- **MapDoc (authored)**: versioned JSON, either Argos-native or imported from Tiled and converted.
- **Map Compiler/Importer (backend)**: instantiates ECS entities at sim start (and optionally applies patches later).
- **Runtime ECS**: holds the truth (positions, containment, object state, stimuli).
- **Renderer/UI (frontend)**: reads ECS state and draws tilemap/sprites/overlays.

### Important constraint
GodAI + spirits should evolve the simulation primarily by:
- adding/modifying ECS systems
- spawning entities
- changing state/traits

They **should not** be responsible for direct pixel-level rendering logic.

---

## 2) Core Concepts

### 2.1 Rooms as zones
A **room** is a named **zone** on the tilemap (rect or polygon). Conceptually:
- a room aggregates ambient stimuli and “what’s going on here”
- agents can reason and plan by room names/types
- a room is not a static text description; it’s a semantic container for stimuli

**Rule:** If an entity has a `GridPosition`, its room is computed as `zoneAt(GridPosition)` unless explicitly overridden for special cases.

### 2.2 Visible vs non-visual entities
Not everything in ECS needs a sprite.

- **Visible spatial entities**:
  - have `GridPosition`
  - optionally have `Sprite` / `Visual` / `CharacterRigConfig` etc.
  - appear in the tilemap view
- **Non-visual entities**:
  - no sprite (and often no `GridPosition`)
  - represent abstract resources/contracts/messages (flour stockpile, bank account, job ticket, kanban card)
  - can still be “in” rooms/containers/agents via the containment model
  - can still emit stimuli to rooms/agents

**Renderer rule:** Only render entities matching a visual filter; everything else is UI-only.

---

## 3) MapDoc Data Contract (ArgosMapV1)

Maps are stored as a single JSON file, e.g. `data/maps/<name>.argosmap.json`.

### 3.1 Type definition (conceptual)
```ts
type ArgosMapV1 = {
  version: 1;
  id: string;
  name: string;

  grid: { width: number; height: number; tileSize: number };

  tilesets: Array<{
    id: string;
    image: string;           // path/URL served by backend
    tileWidth: number;
    tileHeight: number;
    columns: number;
    tileCount: number;
  }>;

  layers: {
    ground: { tilesetId: string; tiles: number[] };  // width*height tile IDs (0 = empty)
    deco?:  { tilesetId: string; tiles: number[] };
    collision: { blocked: boolean[] };               // width*height
  };

  zones: Array<{
    id: string;
    name: string;
    roomType?: string;        // "bakery" | "tavern" | "office" | ...
    shape:
      | { kind: "rect"; x: number; y: number; w: number; h: number }
      | { kind: "poly"; points: Array<{ x: number; y: number }> };
    meta?: Record<string, any>; // ambience tags, spawn hints, priority, etc.
  }>;

  markers?: Array<
    | { kind: "spawn"; id: string; x: number; y: number; spawnType: "agent"|"object"; name: string; typeId?: string; traits?: string[]; meta?: Record<string, any> }
    | { kind: "portal"; id: string; x: number; y: number; to: { x: number; y: number }; bidirectional?: boolean; locked?: boolean; keyId?: string; meta?: Record<string, any> }
    | { kind: "label"; id: string; x: number; y: number; text: string }
  >;

  render?: {
    backgroundColor?: string;
    zoneOverlay?: { enabledByDefault?: boolean; colorByRoomType?: boolean };
    defaults?: {
      npcRig?: string;
      objectSprite?: string;
    };
    spriteBindings?: Record<string, { spriteId?: string; rigId?: string }>; // by ObjectType.typeId
  };
};
```

### 3.2 Invariants
- `layers.ground.tiles.length === width * height`
- `layers.collision.blocked.length === width * height`
- zones must be non-empty
- overlapping zones are allowed but require a deterministic tie-break (see Runtime)

---

## 4) Import Contract: Tiled → ArgosMapV1

We support importing **Tiled TMJ (JSON)** into `ArgosMapV1` via a backend tool/injection.

### 4.1 Tiled conventions
Supported subset:
- Tile layers: `ground`, `deco` (optional)
- Collision layer:
  - either a tile layer named `collision` (any non-empty tile = blocked)
  - or an object layer named `collision` (rect/polygon rasterized to blocked tiles)
- Object layer `zones`:
  - objects represent room zones (rect or polygon)
  - required properties: `name` (room name)
  - optional: `roomType`, `meta.*`
- Object layer `markers`:
  - objects represent spawns/portals
  - property `kind` in `{"spawn","portal","label"}`
  - portal properties: `toX`, `toY`, `bidirectional`, `locked`, `keyId`

### 4.2 Tile IDs
Tiled uses global tile IDs (GIDs). Importer normalizes those into:
- `tilesetId`
- local tile index stored in `ArgosMapV1.layers.*.tiles`

### 4.3 Round-trip
Phase 1 guarantees Tiled → ArgosMap fidelity for the supported subset.
Export ArgosMap → TMJ is optional for later phases.

---

## 5) ECS Compilation Contract (MapDoc → ECS)

The compiler creates/updates ECS entities based on the map.

### 5.1 WorldMap entity
- Instantiate a `WorldMap` ECS entity representing:
  - width/height
  - tile IDs per layer
  - collision/walkability

### 5.2 Room (zone) entities
For each `zones[]`:
- Create a `Room` entity:
  - `Name = zone.name`
  - `Room.ambience` seeded from roomType/meta
- Persist zone geometry in ECS:
  - recommended: a dedicated component like `RoomZone { json }`
  - acceptable short-term: a dynamic component for zone geometry

### 5.3 Portals
For each portal marker:
- Create a `Portal` entity with endpoints and lock state.

### 5.4 Spawns
For each spawn marker:
- Create an entity with:
  - `Name`
  - `ObjectType.typeId` (if provided)
  - `Traits` (if provided)
  - `GridPosition` at marker coordinates
  - render binding (`Sprite` / `Visual` / `CharacterRigConfig`) from `render.spriteBindings[typeId]`

### 5.5 Visual degradation
If a sprite/rig is missing:
- render as a placeholder (colored box + name)
- never block simulation because of missing art assets

---

## 6) Runtime Invariants (prevent drift)

### 6.1 ZoneRoomAssignmentSystem (required)
Purpose: enforce the canonical relationship between spatial presence and room membership.

For each entity with `GridPosition`:
- compute `room = zoneAt(x,y)`
- ensure containment parent is that room **unless** the entity is inside another container (inventory tree)

Tie-break for overlapping zones:
1) explicit zone priority (`zone.meta.priority`)
2) smallest-area zone
3) stable sort by zone id

This system ensures room-level stimuli and “in-room” queries remain consistent with the 2D map.

### 6.2 Movement substrate
Collision grid blocks movement.
Portals support doors/stairs/teleports.

---

## 7) UI Spec (Map + Rendering + Editor)

The UI is the primary deliverable. It must support:
- viewing maps and simulation state
- editing maps in-app (tiles, zones, markers)
- compiling and running from the authored map

### 7.1 New UI panels

#### 7.1.1 Map View Panel (runtime)
Real-time 2D view:
- tilemap (ground + deco)
- zone overlay (room names, outlines)
- entities (NPC rigs + object sprites)
- optional overlays:
  - collision overlay
  - “room under cursor”
  - selected entity highlight
  - agent intent lines (optional: current goal target)

Interactions:
- click entity → select + open inspector
- click tile → show tile + room info
- click room label/outline → filter UI to that room

#### 7.1.2 Map Editor Panel (in-UI editor)
Mode switch: **View** vs **Edit**.

Tools:
- Tile paint tool:
  - brush/rect/fill/eraser
  - layer selector (ground/deco/collision)
- Zone tool:
  - rect zones (MVP)
  - polygon zones (phase 2)
  - properties: name, roomType, meta
- Marker tool:
  - spawn markers (agent/object)
  - portal markers (from tile → to tile)
  - labels
- Select tool:
  - move/resize zones
  - move markers

Editor UX requirements:
- tileset palette
- properties inspector for selection
- undo/redo
- save/save-as
- import Tiled TMJ → convert into ArgosMapV1
- “Compile & Run” button to create/reset simulation from this map

### 7.2 Rendering technology
Recommendation: PixiJS (already in dependencies) embedded into React.

Renderer responsibilities:
- chunked tilemap rendering (for large maps)
- animated sprites for NPCs (rigs)
- simple sprite instances for objects
- overlay graphics for zones + selection

### 7.3 UI overlays for cognition
The 2D map view should not be overloaded with text. Use overlays/panels for:
- current thoughts / plan steps
- current active goals (including queued dayplan goals)
- spirits messages
- tool results

---

## 8) Backend ↔ UI Contract (SimulationBus + Map APIs)

The UI cannot write files directly; it must use backend injections via the bus.

### 8.1 Injection messages (UI → backend)
- `inject:map_list` → returns available maps
- `inject:map_load` `{ mapId }` → returns `ArgosMapV1`
- `inject:map_save` `{ map: ArgosMapV1, overwrite?: boolean }`
- `inject:map_import_tiled` `{ tmjJson: string }` → returns `ArgosMapV1`
- `inject:simulation_create_from_map` `{ mapId, configOverrides? }`
- (phase 2+) `inject:simulation_apply_map_patch` `{ patch }` (live editing)

### 8.2 Events (backend → UI)
- `world:map_loaded` `{ mapId, name, width, height }`
- `world:entity_state` (incremental) `{ entityId, name, x,y, spriteId/rigId, roomName }`
- `world:tile_updated` (phase 2+ live edits)
- `world:zone_updated` (phase 2+ live edits)
- existing events remain: `agent:think`, `agent:action`, `spirit:*`, `god:*`

### 8.3 Snapshot vs incremental updates
MVP can use:
- a “snapshot” API for map + initial entity list
- incremental updates for movement/actions

---

## 9) Persistence & Files

Recommended layout:
- `data/maps/*.argosmap.json` (MapDoc files)
- tileset images under a server-served path:
  - `public/tilesets/...` or `ui/public/...` (served by the backend)

The UI editor saves via `inject:map_save`.

---

## 10) Supporting “invisible entities”

The map does not need to represent everything.

Spirits/systems can spawn:
- visible entities (with `GridPosition` + sprite)
- invisible entities (no sprite; possibly no `GridPosition`)

Both can still affect rooms/agents via:
- containment (room/container/agent parent)
- stimuli emissions and affordances

---

## 11) End-to-end demos (what we can showcase)

### Demo A: “Village day plan”
- Authored map with zones: Bakery/Tavern/Square/Home.
- NPCs follow day plan:
  - queued day goals → activation → movement → interaction (sit/work/eat)
- UI shows:
  - sprites moving on map
  - goals/plan steps
  - spirit messages about simulation health

### Demo B: “Office tools”
- Map with an office zone + devices.
- NPCs interact with “Workstation” affordances and organizational artifacts (kanban/wiki).
- UI shows tool outputs in panels while sprites remain simple.

---

## 12) Phased delivery plan

### Phase A (MVP): View + Compile
- Load an `ArgosMapV1`
- Compile to ECS and run
- Render tilemap + basic sprites + zone outlines

### Phase B: Import Tiled
- Import TMJ/JSON into `ArgosMapV1`
- Save and run

### Phase C: In-app editor
- Tile painting + zone editing + marker editing
- Save and run

### Phase D: Live-edit patching
- Apply editor changes to a running sim without reset

---

## 13) Open decisions (must choose to implement cleanly)

1) MVP zones:
   - rect-only first, or rect + polygon from day one?
2) MVP rendering:
   - placeholder boxes + labels first, or rigged sprites immediately?
3) Map storage root:
   - `data/maps/` (recommended) vs `simulations/`?

