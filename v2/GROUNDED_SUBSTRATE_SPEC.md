# ArgOS v2 Grounded Substrate Unification Spec

This spec defines the **north-star architecture** for ArgOS v2:

> **One substrate, one location model, one state/trait model.** Everything else (perception text, affordance menus, rule triggers, UI views) is a deterministic projection of the substrate.

It also defines an incremental, testable migration plan from the current mixed models.

---

## 0) Goals

### 0.1 Primary goals

1. **Grounding (no drift)**  
   Narrative/perception must not describe entities or states that do not exist in ECS. The runtime must have a single source of truth for:
   - where entities are (location)
   - what entities are (type)
   - what state they are in (state machine)
   - what they can do / what can be done to them (traits + affordances)

2. **Robustness**  
   A single consistent substrate should support:
   - rooms, containers, nesting, equipment/held items
   - deterministic simulations with **no AI**
   - AI cognition as an optional layer on top (dual-loop)

3. **Flexibility**  
   - WorldSchema is the semantic contract and authoring layer (definitions, templates, transitions, stimuli, affordances).
   - ECS remains the runtime truth (components + relations + systems).
   - Systems can be added/baked dynamically, but must operate on real ECS state.

4. **Scalability path**  
   Support many NPCs by making AI cognition:
   - event-driven
   - level-of-detail (LOD) scheduled
   - rate-limited and batched
   - optional (fallback to deterministic “game AI”)

### 0.2 Non-goals (for migration phases)

- Do not rewrite the UI as part of substrate unification.
- Do not make every existing behavioral-test compile immediately; migration will isolate/modernize them later.
- Do not require immediate removal of legacy fields; prefer compatibility shims first, then delete.

---

## 1) Invariants (hard rules)

These must become true at the end of the migration.

### 1.1 Location

- There is exactly one authoritative relation for containment/location:
  - **`LocatedIn(containerEid)`** (exclusive)
- Every physical entity is either:
  - located in exactly one container via `LocatedIn`, or
  - is a top-level “root/world” entity (rare; typically rooms/worldroot)

Derived views are allowed but never authoritative:
- “Room contains X”
- “Agent occupies room Y”
- “Inventory list”

### 1.2 State / traits / affordances

Canonical runtime state uses ECS components:
- `ObjectType.typeId` (string)
- `ObjectState.current` (string)
- `Traits.active` (JSON string array)

WorldSchema provides definitions and transition logic, but the ECS is the truth.

### 1.3 Perception

Agent perception must be derived from:
- the agent’s room (via `LocatedIn` chain)
- entities located in that room (direct children, plus container-aware rendering)
- state/traits/stimuli from ECS + WorldSchema

No perception text should refer to “phantom” entities.

### 1.4 Effects

Affordances and rules must execute **real effects** that mutate ECS truth.
No “emit-only” systems are considered complete behavior.

---

## 2) Canonical Data Model

### 2.1 Relations

#### `LocatedIn(containerEid)` (canonical)

Semantics:
- Exclusive: an entity can be in only one container at a time.
- Nestable: containers can be inside other containers (drawer in room; item in drawer).
- Supports “held” items: item `LocatedIn(agentEid)` means “on the agent”.

#### Optional future relations (non-canonical for location)

These are for *special semantics*, not “where is it”:
- `OnTopOf(surfaceEid)` (presentation)
- `EquippedBy(agentEid)` + slot metadata (hand vs backpack vs belt)
- `ConnectedTo(roomEid)` (portals/exits)

### 2.2 Components

Canonical object identity:
- `Name`, `Description` (derived text may be cached here)
- `ObjectType`, `ObjectState`, `Traits`

Optional physical components that deterministic systems can operate on:
- `Fuel`, `Durability`, `Container`, `Surface`, `Portal`, `LightSource`, etc.

### 2.3 WorldSchema responsibilities

WorldSchema defines:
- object type templates: base traits + state machine
- stimuli templates per state (multi-sensory)
- affordance definitions with effect lists
- rules definitions (declarative)

WorldSchema does **not** store runtime state; it derives from ECS.

---

## 3) Runtime Architecture

### 3.1 Dual-loop is canonical

Fast deterministic loop (fixed timestep):
- ECS systems (movement, needs decay, etc.)
- rules engine tick processing
- event emission to bus

Slow async loop (task queue):
- agent cognition (LLM or deterministic planners)
- spirit cognition (monitoring/steering)
- dynamic system baking/repair
- summarization and analytics

### 3.2 Scaling cognition (NPCs)

Design principle:
- The fast loop never blocks on AI.
- NPC “thinking” is scheduled by:
  - arousal/importance
  - scene membership (in active rooms)
  - pending stimuli volume
  - token/latency budgets

Fallback modes (deterministic AI):
- utility selectors
- GOAP/plan step execution
- schedule-driven behaviors

LLM can be reserved for:
- dialogue
- reflection
- plan generation

---

## 4) Migration Plan (incremental)

Each phase must be testable and should land with minimal breakage.

### Phase A — Canonical location relation (LocatedIn)

**Why**
- Eliminates disagreement between `OccupiesRoom`, `Contains`, and WorldSchema `ContainedIn`.
- Enables nested containers (bags/drawers) with one model.
- Enables correct “agent has item” semantics without trait copying.

**What changes**
- Introduce `LocatedIn` relation in `src/ecs/relations.ts`.
- Create helper APIs in `src/ecs/location.ts`:
  - `getDirectContainer(eid)`
  - `getRoomForEntity(eid)` (walk `LocatedIn` chain)
  - `listDirectContents(containerEid)` (query `LocatedIn(containerEid)`)
  - (optional) cached indices later
- Update:
  - prefabs (agents/objects placed into rooms via `LocatedIn`)
  - sensory/perception (room contents via `LocatedIn`)
  - broadcasting (agents “in room” derived via `getRoomForEntity`)
  - ObjectManager/TextRenderer/RulesEngine to use `LocatedIn` instead of schema-local `ContainedIn`

**Acceptance tests**
- Unit: room perception lists objects placed via prefabs AND ObjectManager.
- Unit: moving an agent between rooms changes broadcast recipient set.
- Unit: nested container semantics: item in backpack in agent in room is “on agent” and in same room chain.

### Phase B — Canonical state/traits (ObjectMeta retirement)

**Why**
- `ObjectMeta` duplicates `ObjectType/ObjectState/Traits` and causes drift.

**What changes**
- Ensure all spawned physical entities have `ObjectType/ObjectState/Traits` (including prefab objects and optionally agents).
- Ensure all transitions and trait recalculations operate on those components.
- Keep `ObjectMeta` only as legacy mirror/debug, not queried for decisions.

**Acceptance tests**
- Affordance availability computed from `Traits.active`.
- Transition changes `ObjectState.current` and `Traits.active`, and perception updates accordingly.

### Phase C — Canonical spawning path (WorldSchema/ObjectManager)

**Why**
- Prevents “invisible” or “non-rules-aware” objects created outside schema.

**What changes**
- Provide a unified `spawn(typeId, opts)` used by:
  - God tools
  - Steward population
  - Crafter materialization
  - tests/helpers
- Prefab creation becomes:
  - reserved for agents/rooms, or
  - replaced by schema types for everything (including agents as object types), depending on design choice.

**Acceptance tests**
- Steward populates a room with tangible entities that appear in perception and are interactable via affordances.

### Phase D — Dual-loop canonical runtime + unified public API façade

**Why**
- Enables “no AI” deterministic runs and scalable AI.

**What changes**
- Make `src/runtime/simulation-loop.ts` the canonical scheduler.
- Make `src/index.ts:createSimulation()` configure and start the dual-loop runtime.
- Ensure bus events and server integration reflect the canonical runtime.

**Acceptance tests**
- Fast loop continues while slow tasks are pending.
- “no AI” config runs deterministically.

---

## 5) The “4 Pillars” (robust + grounded)

This section translates the design discussion into concrete, enforceable architecture.

### Pillar 1 — One location/containment model (containers all the way down)

**Invariant**
- “Where is X?” is answered only by `LocatedIn(containerEid)` (exclusive, nestable).

**Design consequences**
- Rooms, drawers, backpacks, hands are all *containers*.
- “Agent has item” is represented by `LocatedIn(agentEid)` (and optionally `EquippedBy`/slot metadata later).
- “Agent is in room” is derived by walking `LocatedIn` up to the nearest `Room`.

**What must change next**
- Treat `Inventory.items` as a compatibility cache only. The authoritative inventory list must be derived from querying `LocatedIn(agentEid)` and/or container indices.
- Add container metadata as ECS (capacity/visibility rules) rather than schema-only booleans.

**Primary files**
- Canonical relation: `src/ecs/relations.ts`
- Helper API: `src/ecs/location.ts`
- Perception: `src/cognition/sensory-system.ts`
- Actions (take/drop/put): `src/cognition/action-executor.ts` (or wherever take/drop is implemented)

**Acceptance tests (additions)**
- Item in backpack in agent: `getRoomForEntity(item)` equals agent room.
- `listDirectContents(agent)` returns held items; no drift vs any UI inventory projection.

### Pillar 2 — One state/trait model (ECS truth; schema defines meaning)

**Invariant**
- Runtime truth is ECS:
  - `ObjectType.typeId`
  - `ObjectState.current`
  - `Traits.active` (JSON string array)

**WorldSchema responsibilities**
- Defines: base traits, state machine, state-specific traits/blockedTraits, stimuli templates, affordances/effects.
- Does not store runtime state; it only explains how to interpret/transform ECS state.

**Implementation rule**
- Any state change must go through the canonical transition path:
  - `executeEffect({ type: "set_state", ... })` → `transitionObjectState(...)`

**Primary files**
- Transitions/effects: `src/world/effect-executor.ts`
- Schema definitions: `src/world/schema.ts`
- Spawn canonicalization: `src/ecs/prefabs.ts`, `src/god/god-agent.ts`

**Acceptance tests (additions)**
- `set_state` updates: `ObjectState.current`, `Traits.active`, `Description.value`, `StimulusSource` (when schema provides stimuli).

### Pillar 3 — Dual loop is canonical (fast deterministic + slow cognition)

**Invariant**
- The “fast loop” (ECS tick) never blocks on AI.
- The “slow loop” runs async cognition and system-baking on a budget.

**Design consequences**
- Deterministic simulation must be able to run with:
  - no spirits
  - no agent LLM cognition
  - no dynamic system generation
- Cognition is additive: it reacts to events and injects actions/effects back into ECS.

**Scaling path (100s–1000s NPCs)**
- Event-driven cognition: agents only think when stimuli/needs/goal deadlines warrant.
- LOD scheduling: think less often for off-screen/off-scene agents.
- Parallel execution: cognition tasks run concurrently (Promise batches today; worker threads/queues later).
- Deterministic fallback behaviors: utility selectors / GOAP / schedules for “cheap NPC brains”.

**Primary files**
- Runtime scheduler: `src/simulation/*` and/or `src/runtime/*`
- Cognition orchestration: `src/cognition/cognition-system.ts`
- Spirit orchestration: `src/spirits/*`

**Acceptance tests (additions)**
- Fast loop continues while slow tasks are pending (already listed Phase D).
- Deterministic config produces stable ticks (seeded RNG if used).

### Pillar 4 — Everything authoring-facing goes through WorldSchema (one contract)

**Invariant**
- GodAI and Spirits should prefer schema-backed tools:
  - `spawn(typeId, opts)` for entities
  - `defineObjectType/defineAffordance/defineRule` for extensions
- Direct raw ECS writes are allowed for engine code, but are not the authoring interface.

**Design consequences**
- No “invisible objects” that exist in ECS but are absent from schema affordances/state rules.
- Schema extensions become first-class modding: add new types/affordances/rules without core code edits.

---

## 6) Unified GodAI API (roles + messaging)

Goal: a single façade for “build, run, steer” that works regardless of whether the backend is pure deterministic ECS or layered with AI.

### 6.1 Public API façade

**Canonical entrypoint**
- `createSimulation(config)` returns a `SimulationHandle`.

**SimulationHandle responsibilities**
- Lifecycle: `start()`, `pause()`, `resume()`, `step()`, `stop()`
- Commands: `command(prompt)` (routes to GodAI), `broadcast(...)`, `stimulate(...)`
- Observability: `getState()`, `getStats()`, `subscribe(eventType, handler)`

**What must be true**
- The façade must talk to *one* scheduler (dual-loop runtime) and *one* bus.
- The façade must not require any specific AI vendor to operate.

### 6.2 Roles

**Engine**
- Owns ECS truth and deterministic systems.
- Exposes a small, safe “WorldFacade” for tools (spawn/move/set_state/add_component/relations).

**GodAI**
- Planner/executor that uses tools to create/modify schema + world.
- Should never be forced to write raw components directly for core gameplay semantics.

**Spirits**
- Observers/steerers with scoped authority.
- Must not “teleport facts into existence”; they act by:
  - issuing tool calls (spawn, define, transition, add_rule)
  - sending directives to agents
  - adjusting scheduling/budgets

### 6.3 Messaging (single protocol)

**North star**
- Everything routes through the simulation bus with typed envelopes:
  - `WorldEvent` (ECS → bus): movement, state transitions, stimuli emitted, entity spawned/destroyed
  - `Directive` (spirits/god → bus): “do X”, “monitor Y”, “spawn Z”
  - `Report` (spirits/agents → bus): summaries, alerts, compliance, anomalies

**Primary files**
- Bus: `src/bus/simulation-bus.ts`
- God agent command ingress: `src/god/god-agent.ts`
- Spirits messaging: `src/spirits/*`

**Acceptance tests**
- Bus routes a directive to the correct spirit/agent handler.
- World events are emitted for `set_state` and `LocatedIn` changes.

---

## 7) Dynamic system generation (robustness requirements)

Dynamic systems are powerful and also the highest risk area for brittleness.

### 7.1 System contract

Every baked system must declare:
- name/id/version
- tick group (fast loop only; slow loop tasks must be separate)
- required components/relations (query)
- deterministic guarantees (no network, no time-based randomness without seeded RNG)
- emitted events (for observability)

### 7.2 Baking pipeline (safe and maintainable)

**Proposed pipeline**
1. GodAI proposes a system “intent” and an ECS query signature.
2. Codegen produces a system module with:
   - `init(world, ctx)`
   - `tick(world, ctx, dt)`
   - `dispose()`
3. Validation harness runs:
   - Type check (where possible)
   - Determinism checks (no Date.now in fast loop; no Math.random without injected rng)
   - Sandbox execution smoke test against a tiny fixture world
4. Activation registers the system in the runtime scheduler.

**Primary files**
- Dynamic systems registry/runtime: `src/ecs/dynamic-systems.ts`
- Loader: `src/systems/system-loader.ts`
- God tool: `bakeNewSystem` in `src/god/god-agent.ts`

**Acceptance tests**
- A baked system that throws is isolated and rate-limited (already exists).
- A baked system can be activated/deactivated without corrupting world.

---

## 8) NPC cognition + behavior (extendable, and AI-optional)

### 8.1 Canonical cognition loop shape

1. **Perceive**: derive text + structured signals from ECS (`LocatedIn` + nearby stimuli + affordances).
2. **Deliberate** (optional):
   - Deterministic policy (utility/GOAP/schedule), or
   - LLM policy (plans/dialogue/reflection)
3. **Act**: propose an action intent.
4. **Execute**: engine validates and applies effects to ECS (never direct hallucinated state).
5. **Learn/Remember**: store outcomes; feed back into next cycle.

### 8.2 Deterministic fallback behaviors

Required to support “no AI” runs:
- Schedules/routines
- Needs-driven utility actions
- Simple interaction policies (eat when hungry; sleep when tired; flee when threatened)

### 8.3 Extensibility points

Spirits and engine should be able to extend cognition by:
- adding new affordances (schema)
- adding new deterministic systems (fast loop)
- adding new behavior policies (slow loop)
- injecting goals/directives via bus

**Primary files**
- Cognition: `src/cognition/*`
- Action execution: `src/cognition/action-executor.ts` (or current equivalent)
- Affordances/effects: `src/world/effect-executor.ts`, `src/world/schema.ts`

---

## 9) Next engineering phases (beyond A–D)

### Phase E — Canonical spawning path (schema-first; no invisible objects)

**Why**
- Prevents object creation that bypasses affordances/state/trait rules.

**What changes**
- Make `spawn(typeId, opts)` the preferred creation path for all physical entities.
- Keep lower-level “raw ECS” tools, but treat them as internal/advanced.
- Normalize “agents as schema types” decision:
  - Option 1: agents remain a special prefab but still get `ObjectType/ObjectState/Traits`
  - Option 2: agents are also schema-defined types (recommended long-term)

**Acceptance tests**
- Objects created via GodAI always appear in perception and are interactable.

### Phase F — Inventory/holding derived from `LocatedIn`

**Why**
- Today `Inventory.items` can drift from `LocatedIn`, and capability resolution wants the containment graph.

**What changes**
- Replace “inventory list” operations with `LocatedIn` queries:
  - held items: `LocatedIn(agentEid)`
  - inside backpack: `LocatedIn(backpackEid)` where backpack `LocatedIn(agentEid)`
- (Optional) introduce `EquippedBy(agentEid)` for slot semantics without changing “where is it”.

**Acceptance tests**
- Pick up / drop / put-in-container updates only `LocatedIn` and projections update accordingly.

### Phase G — Canonical event emission for substrate changes

**Why**
- Scalable cognition/spirits require event-driven triggers.

**What changes**
- Emit bus events for:
  - `LocatedIn` changes
  - `ObjectState` transitions
  - entity spawn/destruction
  - stimulus emissions

**Acceptance tests**
- A spirit can subscribe to “state transition” and react without polling.

### Phase H — Runtime budgets + cognition LOD scheduler

**Why**
- Enables 100s–1000s NPCs by enforcing compute budgets.

**What changes**
- Per-agent and global token/latency budgets.
- Think frequency control.
- Room-based “active set” prioritization.

**Acceptance tests**
- With many NPCs, fast loop tick time remains bounded while cognition defers gracefully.

---

## 5) Compatibility Strategy

During migration:
- Maintain thin shims that map legacy concepts to canonical:
  - “agent is in room” derived from `getRoomForEntity()`
  - “inventory items” derived from `LocatedIn` chain
- Avoid writing to legacy relations/components from gameplay logic.
  If something must exist temporarily for legacy code, it is derived/synced.

---

## 6) Risks & Mitigations

### 6.1 Performance risk: traversal and queries
Mitigation:
- Start simple (direct queries and short containment chains).
- Add cached indices later (container -> contents, entity -> roomAncestor).

### 6.2 Migration risk: breaking disparate subsystems
Mitigation:
- Land changes in small slices with unit tests:
  - location first (no semantics changes beyond “where is it?”)
  - then state/traits unification
  - then spawning unification

---

## 7) Implementation Notes (decisions)

### 7.1 “Holding” vs “Carrying”
Canonical location captures “on you”:
- item `LocatedIn(agent)` means “carried by agent”.
Optional equipment captures “in hand”:
- add `EquippedBy(agent)` + slot metadata if needed for mechanics.

### 7.2 Room membership
Room membership is derived:
- entity is “in room R” if walking `LocatedIn` chain eventually reaches R.
Direct room contents (for rendering) are entities directly `LocatedIn(room)`, with container rendering handling nested content visibility.

---

## 8) Phase A (Location) — Concrete Implementation Notes

This section captures what “Phase A complete” means in code terms, including the APIs that dynamic systems and AI tooling should use.

### 8.1 Canonical APIs

**ECS relation**
- `LocatedIn(containerEid)` in `src/ecs/relations.ts` is canonical for containment and room placement.

**Location helpers**
- `src/ecs/location.ts`
  - `getDirectContainer(world, eid)` → immediate container (if any)
  - `getRoomForEntity(world, eid)` → walk `LocatedIn` chain until a `Room` ancestor
  - `listDirectContents(world, containerEid)` → direct children via `LocatedIn(containerEid)`

**Dynamic systems / baked systems helper surface**
- `SystemContext` includes `ctx.location` so baked/file systems don’t need to reinvent traversal:
  - `ctx.location.getDirectContainer(world, eid)`
  - `ctx.location.getRoomForEntity(world, eid)`
  - `ctx.location.listDirectContents(world, containerEid)`

### 8.2 “Holding”, inventory, and nested containers

This model supports nested containment without special-case logic:
- item carried by an agent: `item LocatedIn(agentEid)`
- backpack carried by agent: `backpack LocatedIn(agentEid)`
- item in backpack: `item LocatedIn(backpackEid)`
- “agent has item” is derived by walking the `LocatedIn` chain upward.

### 8.3 File-level migration map (Phase A)

**Core substrate**
- `src/ecs/relations.ts`: add `LocatedIn` (exclusive)
- `src/ecs/location.ts`: add canonical traversal/query helpers
- `src/ecs/dynamic-systems.ts`: add `ctx.location` helpers for baked systems
- `src/systems/system-loader.ts`: add `ctx.location` helpers for file-loaded systems

**World + schema integration**
- `src/world/object-manager.ts`: spawn/move/contents via `LocatedIn`
- `src/world/rules-engine.ts`: “same container” queries via `LocatedIn`
- `src/world/effect-executor.ts`: room broadcasts via `getRoomForEntity`

**Cognition + perception grounding**
- `src/cognition/cognition-system.ts`: broadcasts + “objects here” + placements via `LocatedIn` + helpers
- `src/cognition/sensory-system.ts`: room resolution + contents via helpers
- `src/cognition/agent-mind.ts`: context room/others via `getRoomForEntity`
- `src/cognition/grounded-cognition.ts`: same (explicitly grounded)
- `src/cognition/action-registry.ts`: room context and affordance targets via helpers
- `src/cognition/appearance-emitter.ts`: broadcasts to `getRoomForEntity(room)`
- `src/cognition/schedule-adaptation.ts`: social context via `getRoomForEntity`

**Deterministic systems**
- `src/systems/builtin-systems.ts`: RoomArrival sets `LocatedIn(room)` (not `OccupiesRoom`)
- `src/systems/ambient-stimulus-system.ts`: room resolution via `getRoomForEntity`
- `src/systems/deterministic-behavior-systems.ts`: all “where am I / who is here / move” logic uses `LocatedIn` + helpers
- `src/systems/generated/*.ts`: updated examples to use `getRoomForEntity`

**GodAI + spirits**
- `src/god/god-agent.ts`: spawn placement uses `LocatedIn` via tools
- `src/god/system-baker.ts`: baking prompt + templates use `ctx.location` and `LocatedIn`
- `src/god/monitoring-system.ts`: location summaries via `getRoomForEntity`
- `src/spirits/spirit-cognition.ts`: room snapshots via `getRoomForEntity` (no `Contains` fallback)
- `src/spirits/agent-daemon.ts`: agent snapshot room via `getRoomForEntity`
- `src/spirits/artificer-spirit.ts`: “robustness” heuristics updated to canonical location model

**Server + persistence**
- `src/server/simulation-server.ts`: entity room fields derived via `getRoomForEntity`
- `src/server/argos-server.ts`: entity room fields derived via `getRoomForEntity`
- `src/persistence/world-persistence.ts`:
  - serialize `LocatedIn` as `type: "LocatedIn"`
  - still deserialize legacy `OccupiesRoom` and `Contains` by mapping/inverting into `LocatedIn`

**Tests**
- Updated tests to assert `LocatedIn` rather than `OccupiesRoom`.

---

## 9) Phase B (State/Trait) — Detailed Spec

### 9.1 Problem statement

`ObjectMeta` (dynamic component) currently duplicates and partially overlaps with:
- `ObjectType` (what is it)
- `ObjectState` (what state is it in)
- `Traits` (capabilities/affordances)

This is a drift risk because systems and renderers can consult different “truths”.

### 9.2 Canonical invariants for Phase B

- Runtime decisions about affordances MUST use:
  - `ObjectType.typeId`
  - `ObjectState.current`
  - `Traits.active`
- The only allowed “bridge” from schema to runtime is:
  - WorldSchema definition → deterministic application into ECS components
- `ObjectMeta` (if kept at all) is:
  - a debug mirror, or
  - a cache of derived strings (never authoritative)

### 9.3 Required APIs

Add a single transition path that all state changes go through:
- `transitionObjectState(world, targetEid, nextState, opts)`
  - mutates `ObjectState.current/previous`
  - recomputes `Traits.active`
  - updates `Description.value` from schema state description (or dynamic description rules)
  - emits any schema-defined stimuli/effects

Add a single trait computation path:
- `recalculateTraits(world, targetEid)` should:
  - read `ObjectType.typeId` + `ObjectState.current`
  - apply schema base traits + state traits + conditional trait rules
  - write `Traits.active` as canonical list

### 9.4 File-level change list (Phase B)

Primary:
- `src/world/effect-executor.ts`: ensure all state effects route through `transitionObjectState(...)`
- `src/world/object-manager.ts`: ensure spawned objects always have `ObjectType/ObjectState/Traits`
- `src/world/schema.ts`: ensure all object definitions can deterministically supply:
  - base traits
  - per-state traits
  - per-state description
  - affordances list derivation rules

Consumers to audit and fix:
- `src/world/text-renderer.ts`: description should be purely derived from ECS + schema
- `src/cognition/action-registry.ts`: affordance availability derived from `Traits.active`
- `src/world/rules-engine.ts`: rule triggers should use ECS canonical state/traits

Deprecations:
- stop reading `ObjectMeta` for any runtime decision; keep only for debugging and eventually remove.

### 9.5 Acceptance tests (Phase B)

- Transition updates `ObjectState.current`, recomputes `Traits.active`, and the rendered description changes accordingly.
- Affordance filtering uses `Traits.active` and matches schema constraints.
- No module uses `ObjectMeta` as a predicate for decisions.

---

## 10) Phase C (Spawning) — Detailed Spec

### 10.1 Canonical spawning rule

Anything that an agent can perceive or interact with MUST be spawned through WorldSchema/ObjectManager.

### 10.2 Unified spawn API

Create a single entry point:
- `spawn(typeId, { name?, containerEid?, roomEid?, position?, overrides? })`
  - resolves `roomEid` into `containerEid` (rooms are containers)
  - writes `LocatedIn(containerEid)`
  - attaches required components declared by schema
  - initializes canonical `ObjectType/ObjectState/Traits`

### 10.3 GodAI/Spirits tool boundary

GodAI and spirits should not mutate ECS directly except via “safe” tools:
- `defineObjectType(...)`, `defineAffordance(...)`, `defineRule(...)` (schema authoring)
- `spawn(...)`, `moveEntity(...)`, `transitionObjectState(...)` (runtime mutations)

### 10.4 Acceptance tests (Phase C)

- An entity spawned via GodAI tool appears in:
  - room perception
  - affordance lists
  - rules processing
- Steward/Crafter use the same spawn path.

---

## 11) Phase D (Dual-loop + Unified Public API) — Detailed Spec

### 11.1 Canonical scheduler model

- Fast loop: pure ECS; deterministic; fixed timestep; no awaits.
- Slow loop: async task queue; cognition and system generation; rate-limited; can be parallelized.

### 11.2 Unified “GodAI façade” API

Expose a single structured surface (not a grab-bag of tools):
- `sim.world` (authoritative substrate mutations)
  - `spawn`, `move`, `transitionState`, `query`, `snapshot`
- `sim.schema` (authoring)
  - `defineObjectType`, `defineRule`, `defineAffordance`, `list*`
- `sim.cognition` (optional)
  - start/stop, configure budgets, LOD, deterministic fallback
- `sim.spirits` (governance/steering)
  - start/stop, hierarchy management, message routing, intervention policies

The tool layer then becomes a thin adapter over this façade.

### 11.3 Messaging contracts

Fast-loop emits structured events:
- `stimulus`, `movement`, `state_transition`, `goal_created`, `goal_completed`, `system_error`, etc.

Slow-loop consumes:
- event streams (batched)
- per-agent pending stimuli queues
- spirit observation windows

### 11.4 Acceptance tests (Phase D)

- Running with cognition disabled still produces stable deterministic ticks.
- Enabling cognition does not block the fast loop.
- With many NPCs, cognition scheduling obeys budgets (tick continues, cognition is LOD’d).
