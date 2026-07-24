# The World Graph

**One substrate. Many producers. Many media.**

*Canonical design document for ArgOS / Project89. Established 2026-07-24.*

> This document supersedes the design corpus that preceded it. Every section ends with a
> **Supersedes:** line naming the documents it retires. The defining pathology of this project's
> history is that nine attempts at the same subsystem coexist because no document ever killed its
> predecessor. This one kills predecessors.
>
> Status markers used throughout:
> **[THEORY]** — inherited, settled, not up for debate.
> **[DECIDED]** — an architectural decision locked by this document.
> **[OPEN]** — genuinely undecided; needs a call before implementation.

---

## 0. Thesis

> "Without grounding, LLMs are like eloquent actors improvising on a stage without a script, set,
> or context — their words might be impressive, but their actions lack meaning and consistency
> within the broader performance."
> — `LSE/architecture/llm-grounding.md:3`, Aug 2024

> "LSE effectively creates a system that functions as a dynamic, interactive knowledge graph. In
> this paradigm, entities serve as nodes in the graph… Components, attached to these entities,
> define not just attributes but also relationships, effectively creating edges in the graph
> structure… Systems, acting as inference engines, can traverse this graph, deriving new
> knowledge, identifying patterns, and driving the evolution of the simulated world."
> — `LSE/references/tech spec.md:678`, Aug 2024

> "**One substrate, one location model, one state/trait model.** Everything else (perception text,
> affordance menus, rule triggers, UI views) is a deterministic projection of the substrate."
> — `v2/GROUNDED_SUBSTRATE_SPEC.md:5`, 2026

Eighteen months apart, the same claim. The thesis of this project, stated once:

> **Entities are nodes. Components and relations are edges. Every producer — a running simulation,
> a human author, a generative model — writes to one graph through one typed mutation protocol.
> Nothing is true that is not in the graph. Nothing is said that is not backed by a change to it.**

The transmedia studio is not a pivot away from this. It is the same thesis with a second producer
attached. If entities are nodes and components are edges, then a human authoring in a graph editor
and a simulation running systems are **two writers to one graph**. A sequence diagram drawn
2024-09-05 already showed the third writer — content generation writing its artifacts back into the
world as entities.

Nobody ever built the graph. That is what this document is for.

**Supersedes:** `v2/context.md`, `LSE/references/LSEArchitecture.md`.

---

## 1. Scope, Non-Goals, Retirements

### Two products, one graph

| | |
|---|---|
| **ArgOS** | A simulation engine. Runs worlds, produces narrative as a by-product of grounded agent behaviour. |
| **The Narrative Studio** | An authoring and production environment. Humans and AI compose worlds, view them, and route their event streams into comics, microdramas, film. |

The contract between them is **bidirectional and symmetric**:

- **Simulation → Studio.** A run emits a commit stream. The studio ingests it, renders it, routes it to pipelines.
- **Studio → Simulation.** An authored world is a commit stream. ArgOS instantiates a running world by replaying it.

These are the same operation. Both directions are *applying commits to a graph*. This symmetry is
the load-bearing property of the whole architecture; every decision below preserves it.

### Non-goals

- Not a game engine. No rendering, physics, or input loop obligations beyond what projections require.
- Not a general agent framework. Agents exist to inhabit worlds.
- Not a replacement for the studio's own storage. ArgOS is one producer among several.

### Naming freeze **[DECIDED]**

One name per concept, forever. See Appendix B. Immediate consequences:

| Concept | Canonical | Retired aliases |
|---|---|---|
| ECS core | `src/ecs/` (BitECS) | `src/core/ecs.ts` — **delete** (a second, Map-based world exporting the same `createArgosWorld` symbol) |
| Runtime | one loop | `run-dev-server.ts`'s five hand-rolled intervals and `server/argos-server.ts` — **collapse into `runtime/simulation-loop.ts`** |
| Spirits | Narrator, Arbiter, Tinker, Weaver, Crafter, Steward, Lawgiver, Watcher | "Artificer" (= Tinker), "Sociologist"/"Guardian" (`WORLDBUILDING_ARCHITECTURE.md` §7.2) |
| Behaviour trees | one lineage — see §10 | two incompatible `BehaviorNode` unions |
| Turn entry point | `lil/game-engine.ts::gameTurn` | copies in `mud/test-session.ts`, `mud/test-cthulhu.ts` |

**Supersedes:** `LSE/designDoc.md`, `DESIGN_DOC.md`, `DESIGN_DOC_UI.md` (its network-graph +
scrubbable-timeline UI sketch survives into §15), `docs/o1-review.md`, `god-agent-v2/DESIGN_DOC.md`,
`god-agent-v2/RESEARCH_VISION.md`, `v2/ROADMAP.md`, `v2/PLAN-phase3.md`,
`v2/PLAN-phase3.5-NLE-LIL.md`, `v2/ARCHITECTURE.md` (archived as *the road not taken* — its
diagnosis of fragmentation was correct and became prophecy).

---

## 2. The Three Altitudes **[DECIDED]**

The single organising device of this architecture. Every subsystem lives at exactly one altitude,
and the layers between them are the only sanctioned translation points.

| | Altitude | Shape | Volume | Inhabitants |
|---|---|---|---|---|
| **1** | **Mechanical** | `component.set`, `relation.add/remove`, `entity.create/destroy` | Tick-rate, high | BitECS. Systems. The fast loop. |
| **2** | **Semantic** | `character.moved`, `relationship.formed`, `secret.revealed`, `organization.founded` | Event-rate, low | **The commit stream.** The studio. The NLE. Comic panels. |
| **3** | **Narrative** | prose, dialogue, panels, shot lists | On demand | Readers, players, pipelines. |

Three consequences follow immediately, and they resolve questions this project has been circling
for two years.

**The LIL is the translation layer between altitudes, in both directions.** That is its entire job.
`1↔2` is *lift* and *lower*. `2↔3` is *render* and *parse*. The existing `intent-parser.ts` and
`world-renderer.ts` — the only two modules an audit found genuinely clean and liftable — are already
the `2↔3` pair. The `1↔2` pair does not exist yet. That is the missing layer.

**The NLE plans at altitude 2.** It does not touch component fields and it does not write prose. It
decides which *semantic events should happen next* and steers the simulation toward making them
true honestly. Its output is a desired future commit.

**Altitude 2 is the commit boundary.** Not every mechanical delta lifts — hunger ticking from 40 to
42 is not a story beat. A delta becomes a commit when it lifts to a semantic event. The lift
function *is* the "what is worth recording" filter this project has been hand-waving at.

> A confirmation that this decomposition is right, not invented: `spirits/story-templates.ts:1837`
> contains a complete `ComicPanel` / `ComicPage` / `ComicOutput` exporter with **zero callers**. Its
> input shape is `{type, actor, target, content, location}` — a semantic event. It matches none of
> the six event shapes in the codebase, because all six are altitude 1 or altitude 3. Something in
> the codebase already knew altitude 2 was missing.

**Supersedes:** `LSE/architecture/linguistic-integration-layer.md` (its two-way pipeline and
three-verb command vocabulary are absorbed here and in §14).

---

## 3. The Keystone Rule **[THEORY]**

Written in August 2024. Never enforced. It is the most important sentence in the corpus.

> **The narrative engine may only act by (a) injecting an entity, (b) modifying a component value,
> or (c) mutating an agent's motivation. It never commands agents directly, and it never emits prose
> unbacked by a graph change.**
> — derived from `LSE/architecture/high-level.md:41-42`, `LSE/architecture/narrative-logic-engine.md`

Enforce this and something remarkable falls out for free:

**Narrative events and graph deltas become the same object by construction.**

There is then no such thing as a story beat that isn't a graph change, and no such thing as a graph
change that can't be narrated. Which means:

- The commit stream is *complete* — nothing happened that isn't in it.
- Squashing is *meaningful* — you can compress a range because the range is the whole truth.
- Recomposition is *exact* — replaying commits reconstructs the world, not an approximation of it.
- Grounding is *structural*, not a prompt instruction — hallucinated narration has nowhere to live.

Every failure mode this project has hit traces back to violating this rule. The Cthulhu playtest
narrated a sanity loss that never occurred in the ECS, because the DM layer was allowed to speak
without a backing delta. Fix the rule, and that class of bug becomes unrepresentable.

**Supersedes:** `LSE/architecture/narrative-logic-engine.md`, `LSE/architecture/high-level.md`.

---

## 4. Durable Identity **[DECIDED]** — the prerequisite

Nothing else in this document is possible without this, so it comes first.

BitECS entity IDs are **transient recycled integers**. They are reused immediately on deletion;
versioning is optional and bit-limited. They cannot be the identity of a character that must survive
a save, a restart, an import from the studio, or a merge between two authored worlds.

**Decision:** every graph node carries a durable `NodeId` — a UUID assigned at creation, independent
of and stable across BitECS eid allocation. The eid is a *runtime handle*, the NodeId is the
*identity*. A bidirectional index is maintained by the runtime.

```
NodeId   "chr_01J8X…"   ← durable, global, survives everything. What the studio stores.
eid      47             ← transient, per-process, recycled. What BitECS queries.
```

The only prior art in the entire corpus is `LSE/src/god.ts`'s `entityMap: {name → eid}` — a
*name-addressed* mutation API, which was the right instinct and was dropped.

**[OPEN]** NodeId format. Recommend a prefixed, sortable ID (`chr_`, `loc_`, `org_`, `obj_`,
`med_`, `evt_`) — the prefix makes altitude-2 events self-describing and debuggable, and sortability
gives cheap chronological ordering. Should match whatever the studio already uses. **This is the
first thing to align with the narrative studio's schema.**

---

## 5. The World Graph — node and edge model **[DECIDED]**

### Node kinds

Altitude 2 requires typed nodes. The ECS knows `Name.value[47] = "Aldric"`; the studio needs to know
47 is a *character*.

| Kind | Notes |
|---|---|
| `character` | Agents and NPCs. Carries visual reference (§12). |
| `location` | Rooms, regions, sites. **Must** carry adjacency (see below). |
| `object` | Props, items, tools. Tool-bearing objects dispatch real work (§11). |
| `organization` | Factions, guilds, companies. Currently unrepresented in ArgOS. |
| `media-asset` | Generated artifacts as first-class nodes (§12). |
| `narrative-node` | Tensions, beats, arcs — the story graph, in the same graph (§13). |

### Edges

Edges are typed and carry payloads. The corpus's only edge that carries time is
`LSE/src/relationships.ts`'s `LocatedIn{since}` — that pattern generalises:

```
(subject) --[EdgeType {payload}]--> (object)
```

BitECS relations-with-stores are proven capable of this at scale: `god-agent-v2/NEURAL_NETWORK_ECS.md`
demonstrates **101,632 attributed edges** at runtime. The runtime is graph-capable. Only the
serializers aren't (§9).

### Two corrections to current practice **[DECIDED]**

**Locations must carry adjacency.** Today `lil/world-snapshot.ts:150` returns *every other room in
the world* as an exit, so a player can teleport anywhere from anywhere. The adjacency data already
exists in `world/map-compiler.ts` and `world/pathfinding.ts` and is simply not wired. A world graph
without topology is not a world.

**Template vs instance must be explicit.** `WorldSchema` holds definitions (object types,
affordances, traits, rules); the graph holds instances. Today these blur, which is one reason the
component vocabulary self-corrupts (§7).

**Supersedes:** `LSE/architecture/enhanced-ecs.md` (its Relational Entity Framework is absorbed
here; its three abandoned safeguards are restored as requirements in §7),
`v2/WORLDBUILDING_ARCHITECTURE.md` §4.

---

## 6. The Change Record and the Commit **[OPEN — yours to standardise]**

This section states **requirements**, not a schema. The narrative-studio event schema is being
standardised separately and ArgOS should conform to it rather than invent a parallel one. What
follows is the specification that standardisation must satisfy, derived from proven failures.

### Why this is stated as requirements

There have been **eight prior attempts** at an event/state shape in this project, and six of them
are live in the codebase right now, sharing no schema:

| Sink | Read back? |
|---|---|
| `ChronicleEntry` (27 types) | in-process only; zero references from either runtime |
| `SimulationEvent` bus union (30 types) | WebSocket → UI |
| `ctx.emit(type, data)` → `registry.events` | drained per tick |
| `logs/events.jsonl` | **never read by anything** |
| `logs/narrative.txt` | never read |
| `ChronicleSnapshot` | separate again |

Plus a seventh in `ui/src/types/events.ts` (41 type literals vs the server's 30 — **already drifted
by 11 types**). An eighth attempt without solving the below would be the ninth failure.

### Hard requirements

A change record must carry:

1. **Durable subject and object identity** (§4) — NodeIds, not eids.
2. **The mutation verb.** The vocabulary already exists, scattered: `modify_component`, `set_state`,
   `add_trait`, `remove_trait`, `spawn`, `destroy`, `add_relation`, `remove_relation`,
   `emit_stimulus`, `transfer`, `run_tool`. Consolidate; do not reinvent.
3. **Before and after values.** BitECS's observer primitive tracks only *presence* — component
   added or removed. It cannot express *"Bob's trust in Jane fell from 0.7 to 0.2"*, which is the
   archetypal narrative event. Value-level deltas are mandatory.
4. **Authorship.** Who wrote this — simulation tick, which agent, which spirit, GodAI, or a human
   author in the studio? **Provenance appears nowhere in the entire corpus.** A graph with multiple
   writers cannot function without it.
5. **Causality — `causedBy`.** Proposed in December 2024 in
   `designDocsBackup/archive/core/event-system.md` (fields: initiator, targets, location, timestamp,
   **causality**, **consequences**, probability), then abandoned three separate times. `Wealth: 40 → 85`
   is a database write. *"Malcor extorted the coins from Garrick"* is a panel. The difference is
   `causedBy`.
6. **Logical clock**, not wall-clock (§8).
7. **Commit grouping.** Changes group into an atomic, addressable, replayable unit.

### Open questions for the schema work

- **What bounds a commit?** A tick? An agent turn? A narrative beat? An author's editing session?
  Recommend: a **beat** for simulation-produced commits (altitude-2 aligned), a **session** for
  authoring. Beats are what a reader experiences and what a panel depicts.
- **What does squash mean when two changes touch the same field?** Last-write-wins is mechanically
  correct and narratively lossy — it discards the *middle* of a scene. Recommend squash produce a
  **view**, not a destructive rewrite: the range stays, the summary is derived. This preserves
  "recomposable at any point."
- **Is a squashed commit lossy?** If squash is a view, no. This is the safer default and it is
  reversible; the opposite is not.
- **Two altitudes or one?** Recommend the stream carry **altitude 2 only**, with altitude 1 retained
  locally in a ring buffer for debugging and exact replay. The studio should never see
  `Needs.hunger: 40 → 42`.

**Supersedes:** `designDocsBackup/archive/core/event-system.md` (its field set is the template
above), and — on implementation — all six live event sinks and the drifted UI schema, by name.

---

## 6.5 The Mutation API **[PROPOSED]**

The change record (§6) defines *what a mutation is*. This section defines *how a caller performs
one* — and the answer turns out to make the Keystone Rule enforceable for the first time.

### MCP is neither the LIL nor the NLE

An MCP tool call is a structured, typed request to mutate the graph — that is, **a commit proposal
with the caller identity attached.** The `author` field §6 requires is simply *who called the tool*.
Provenance stops being a field somebody must remember to populate and becomes a property of the
transport.

MCP's primitives map onto layers that already exist:

| MCP primitive | ArgOS layer |
|---|---|
| **Tools** (write) | the mutation verbs of §6 |
| **Resources** (read) | the query layer — greenfield, nothing coupled |
| Prompts | not used |

So the mutation API sits **below** both language layers, and both are clients of it:

- **The LIL gets thinner.** Its parse direction — text → intent → typed mutation — *is* an LLM
  choosing a tool call. Today it does that with a prompt and a JSON extraction; MCP does it with a
  schema, validation and discovery. What remains to the LIL is the genuinely hard part: entity
  resolution and semantic lift (§2).
- **The NLE is a client holding exactly three tools.**

### Toolsets as permissions — the Keystone Rule made mechanical

The Keystone Rule (§3) has never been enforceable; it has been a convention nothing checks.

Grant the NLE a toolset of exactly `inject_entity`, `modify_component`, `mutate_motivation` and
nothing else. Narrating an unbacked event is no longer forbidden — **it is unrepresentable.** There
is no tool for it.

The same treatment formalises the spirit layer (§16). Spirit powers today are boolean flags —
`canInjectEvents`, `canModifyMood`, `canCreateEntities`, `canBakeSystems`, `canExecuteDirectly`.
That is an allowlist in disguise. As toolsets:

- **A spirit becomes data**, not code: `{role prompt, toolset, cadence, domain}`. GodAI can compose
  *new spirits at runtime*, exactly as it composes components.
- **§16's two-kinds-of-commit distinction becomes enforced.** Only the Weaver holds
  `create_component` and `bake_system`. Agents hold no vocabulary tools at all. The line between
  living inside the rules and editing the rules is drawn by the tool registry, not by discipline.
- **Every mutation is attributable**, because the caller is the author.

### What MCP does not cover

Two things spirits do are not world access and must not be forced through this API:

| | Mechanism |
|---|---|
| **Peer coordination** (spirit inbox/outbox) | the bus — it is spirit-to-spirit, not spirit-to-world |
| **Push perception** (gap reports, the observation aggregator) | the bus — streams *to* a spirit, not requests *from* one |

A spirit is therefore three things: **bus subscription** (perceive and coordinate) → **LLM**
(deliberate) → **MCP toolset** (act).

### Two hard boundaries **[DECIDED]**

**Never on the fast loop.** MCP is serialisation and transport. The deterministic tick (§8) must
never make a tool call. This API serves the *slow tier only* — spirits, GodAI, external agents, the
studio. Systems on the fast loop write components directly. Violating this destroys both determinism
and performance.

**Generate the tool surface from the vocabulary; never hand-write it.** Otherwise it becomes the
twentieth representation of world state and drifts — the exact disease this document exists to cure.
Because GodAI invents components at runtime (§7), the tool list must be *dynamic*: MCP supports
tool-list-changed notification, so when the Weaver invents a `Paranoia` component, the tool to set it
appears automatically for every caller permitted to hold it. Vocabulary and API stay identical by
construction rather than by maintenance.

### Alignment with the change record

The interchange spec already draws the correct line, and this section adopts it:

- A tool call that **mutates the graph** produces **changes**.
- A tool call that **reaches outside the world** — render an image, post to a channel, dispatch a
  coding agent — is an **effect**: collected, never executed by the writer. Anything it changes
  returns as a new Event.

So `run_tool` and `emit_stimulus` are effects, not verbs. The mutation API and the effect boundary
are the same boundary seen from the caller's side.

### Prior art — already designed here, twice

`v2/src/world/affordance-tools.ts` already specifies this:

```ts
interface ToolBinding {
  affordance: string;
  type: "mcp" | "internal";
  toolId: string;
  mcpServer?: string;
  constraints?: { requiresState?: string[]; requiresTrait?: string[] };
}
```

Affordances bound to MCP servers, gated by trait and object state — `constraints.requiresTrait`
**is** the permission model. It is imported by two orphaned files and points at servers that do not
exist. And `god/god-agent.ts` already carries **141 registered tools** — a real mutation API that is
simply not scoped per-caller, not generated from the vocabulary, and not exposed over a protocol.

The strategic consequence: if the graph's API is MCP, external agents operate on the world through
the same interface as internal ones. An in-world computer's affordance can dispatch a real coding
agent, and that agent speaks MCP back to the world (§11). The studio can drive ArgOS directly. The
bidirectional contract of §1 gets a wire protocol instead of an integration.

**[OPEN]** Does agent perception go over MCP resources, or stay internal? Recommendation: **stay
internal.** NPC perception is on the hot path and must not pay protocol cost; spirits, external
agents and the studio are slow-tier and should use resources.

---

## 7. Vocabulary Evolution **[DECIDED]**

The world can define new components, relations, traits, affordances and systems while running. This
is the second through-line that survived all four eras, and it is the project's most distinctive
capability. It is also, currently, silently self-corrupting.

### The proven bug

`ecs/component-registry.ts::registerComponent()` does a bare `entries.set(name, …)` with no
collision check. `dynamic-components.ts::loadComponentDefinitions()` calls it for every JSON in
`data/components/` — and that directory contains `Traits.json`, a *needs-priority* component
(`{satietyPriority, safetyPriority, socialPriority}`), which silently replaces the static `Traits`
component (`{active: string[]}`) that gates **every affordance in the engine**. This runs on every
GodAI `createSystem` preflight.

Measured:

```
BEFORE  Traits static? true   keys: ['active']
AFTER   Traits static? false  keys: ['satietyPriority','safetyPriority','socialPriority']
```

### The deeper failure: generation without selection

`v2/data/components/` holds **74** component definitions in one flat global namespace:

- tension: `Tension`, `DramaTension`, `AtmosphericTension`, `NarrativeAtmosphere`
- market/price: **nine** variants
- drunkenness: `Drunkenness`, `Inebriation`, `Intoxication`
- weather: `Weather`, `WeatherCondition`, `WeatherState`

`v2/src/systems/generated/` holds **65** systems, **nine** of which are NPC behaviour loops.

This is not sloppiness. It is a diagnosis:

> **Generation works. Evaluation does not.**

The self-evolution loop was designed with six sensors — Crafter, Steward, Tinker, Arbiter,
effectiveness-tracker, and the Watcher, all reporting gaps into an aggregator. Five of the six report
through `require()` calls inside a `"type": "module"` package, wrapped in bare `catch {}`. They are
silent no-ops. **The loop has one sensor: the Watcher, observing itself.** A system that generates
without selecting accumulates variants forever. That is exactly what the file counts show.

### Requirements **[DECIDED]**

`LSE/architecture/enhanced-ecs.md` promised three safeguards alongside dynamic definition. None were
built. They are hereby requirements:

1. **Semantic tagging** — new definitions declare intent, enabling dedup by meaning, not just by name.
2. **Versioning** — vocabulary changes are versioned; the graph records which version it was authored against.
3. **Migration** — a schema change carries a migration, or is rejected.

Plus two more the evidence demands:

4. **Collision rejection.** `registerComponent` must namespace or reject. Never silently replace.
5. **A regression gate.** No self-generated change is admitted if it worsens the benchmark beyond a
   threshold. This mechanism exists exactly once in the codebase — in psyche-bt's nightly trainer —
   and it is the only thing in the corpus that makes an autonomous self-modifying system safe to
   leave running unattended.

**Supersedes:** `LSE/architecture/enhanced-ecs.md`, `god-agent-v2/LLM_POWERED_SYSTEMS.md`.

---

## 8. Determinism and Replay **[DECIDED]** — a prerequisite

"Recomposable at any point in time" is impossible without this. It is placed before everything that
depends on it, deliberately.

| Requirement | Current state |
|---|---|
| Seeded RNG, threaded through systems | **Violated.** Unseeded `Math.random()` in `builtin-systems.ts:291,293,295,494,1008` and `rules-engine.ts:107` |
| Logical clock; no wall-clock reads in systems | **Violated.** `Date.now()` in `builtin-systems.ts:1019-1020` |
| Deterministic write ordering from the async AI loop | Unspecified |
| Tick counter wired to the event stream | **Violated.** `chronicle.setTick()` is called only from three behavioural-test scripts; every chronicle produced by a live run reports `totalTicks: 0` by construction |

One document in the corpus — `designDocsBackup/archive/architecture/system-flow.md:47` — claims the
engine is "completely deterministic: every run with the same inputs will produce exactly the same
outputs." It has never been true.

**Decision:** the fast loop is deterministic given `(genesis commit, seed)`. The seed is recorded in
the genesis commit. LLM calls are non-deterministic by nature and therefore live *outside* the
deterministic loop — their *results* enter as commits, which replay exactly.

---

## 9. The Runtime Substrate, and the BitECS Verdict **[DECIDED]**

### Direct answer: BitECS serialization is not the world-graph format

The impression that it was came from `designDocsBackup/bitecs_serialization.md` — which is **234
lines of verbatim third-party library documentation**, not an ArgOS design decision. It opens:
*"Serialization is completely decoupled from bitECS and instead builds its features externally."* It
is a network-replication and save-game utility. **Delete that file**; it is the direct cause of the
misapprehension.

The origin canon never made the claim either: `LSEArchitecture.md:444` calls for a *custom* format
"optimized for LLM consumption."

And ArgOS's own code already rejected it — `world-persistence.ts` uses **none** of BitECS's three
serializers. It hand-rolls a bespoke JSON format with 19 named component serializers and three
hand-written relation serializers. The team implicitly decided BitECS serialization was insufficient,
never wrote down why, and built a quarter of a replacement.

### What it structurally lacks

| Requirement | SoA | Observer | Snapshot |
|---|---|---|---|
| Self-describing schema | ✗ | ✗ | ✗ |
| Durable identity | ✗ | ✗ | ✗ |
| **Relations** | ✗ | ✗ | ✗ |
| String / rich payloads | ✗ | ✗ | ✗ |
| **Value-level deltas** | ✗ | presence only | full rewrite |
| Authorship / provenance | ✗ | ✗ | ✗ |
| Causality | ✗ | ✗ | ✗ |
| Commit boundaries | ✗ | ✗ | ✗ |
| History / time | ✗ | ✗ | instant only |

Note the cruelest line: **the one part of BitECS capable of being a graph — relations with stores,
proven to 101,632 attributed edges — is the one part its serializers cannot persist.**

### The formulation

> BitECS serialization is a **private wire protocol between two processes that already agree, out of
> band, on component layout and entity-identity conventions.** It is the right tool for replicating a
> running world to a second process. It is the wrong tool — structurally, not incidentally — for
> interchange, authoring, history, or narrative.
>
> The world-graph format is a **new layer above BitECS**, with BitECS retained purely as the
> execution substrate. **BitECS is where the graph runs; the graph format is where it lives.** The
> mapping between them is a compiler and a projector, not a serializer.

### Capture is nearly free

BitECS `observe(world, onSet(C) | onAdd | onRemove, …)` fires on every write. Installing observers
across the component and relation registries yields the complete altitude-1 delta stream **without
editing a single system**. `EffectResult.changes: string[]` — currently the only place in the engine
that knows what changed, and it emits strings like `"Needs.hunger: 40 -> 20"` — becomes derived
output rather than the source of truth.

### The loop **[DECIDED]**

One runtime. Fast deterministic tick (§8) + gated async AI queue. Three parallel runtime stacks
collapse into `runtime/simulation-loop.ts`.

### Persistence **[DECIDED]**

**Replay the log.** Snapshots become a cached fold — an optimisation, not truth. This retires the
hand-maintained `COMPONENT_SERIALIZERS` whitelist entirely, which today covers **19 of 78
components** and silently drops `Traits`, `Goal`, `Plan`, `StoryScaffold`, `Inventory`, `Thought`,
`Impression`, `ToolResult`, `PullRequest` on a *clean* save. It also fixes the fact that
`deserializeWorld` currently **throws, uncaught**, on any world containing a baked system — you
cannot recompose a world you cannot load.

**Supersedes:** `designDocsBackup/bitecs_serialization.md` (**delete**),
`LSE/references/ecsNextDoc.md` (**delete** — stale vendored BitECS docs with the obsolete
`addComponent` argument order, actively misleading).

---

## 10. Producer I — Simulation: ECS-Native Cognition **[THEORY / DECIDED]**

This is the most distinctive thing the project has built, and the rest of this document is
downstream of it. Agent cognition is not a module bolted onto the simulation. **It is made of the
same material as the simulation.**

### The agent has no interior

In every mainstream agent framework, an agent is an *object*: a class instance that owns its prompt,
its tools, and its memory store. Orchestration is a graph of these objects passing messages, and the
world — if there is one — is a tool the agent calls.

Here, an agent is an integer.

```
query(world, [Agent])   → every agent that exists
```

There is no agent class, no instantiation, no per-agent loop. An entity is an agent because it has
an `Agent` component. Its faculties are components alongside it:

| Faculty | Storage |
|---|---|
| Memory | `Memory` entities, linked by `HasMemory` |
| Perception | `Perception` entities, linked by `HasPerception` |
| Thought | `Thought` entities, linked by `HasThought` |
| Dialogue | `ConversationTurn` entities, linked by `HasConversation` |
| Belief / opinion | `Belief`, `Impression` |
| Intent | `Goal`, `Plan` |
| Learned behaviour | `BehaviorPolicy` (a compiled tree) |
| Disposition | `Personality`, `WorkingMemory`, `Attention` |
| Drives | `Needs`, `Health` |

Note what that table implies: **a thought is a thing in the world.** Not a string on an object — an
entity, queryable by any system, readable by the narrative layer, addressable by a NodeId. Memory is
not a private vector store owned by an agent. It is furniture.

This is why grounding works structurally rather than by prompt discipline. The narrative director
never has to *guess* what Malcor wants; it queries his `Goal`. The comic renderer never has to
invent what a character knows; it reads their `Memory`. A mind that lives in the world can be read
by the world.

### Agents are objects too

Agents inherit `Traits`, `ObjectType`, `ObjectState` and `GridPosition` from the same vocabulary as
rooms and props (`ecs/prefabs.ts:106-117`). A character is not a special kind of thing — it is a
thing that happens to have a `Mind`. Affordances that work on objects work on people. The trait
gate that decides whether a book can be read decides whether a person can be talked to.

### There is no boundary between physics and psychology **[THEORY]**

A hunger system decrements `Needs.hunger`. A behaviour tree reads `Needs.hunger`. Same table, same
tick, no API, no tool call, no serialisation, no integration layer.

This is not a feature. It is the *absence of a boundary* that every other architecture has to build
and maintain. In an orchestration framework, "the world affects the agent" is a message that must be
composed, delivered and parsed. Here it is a memory read.

The consequence is that **deterministic mechanism and cognition compose freely in both
directions.** A famine system makes agents desperate without knowing agents exist. A character's
decision to hoard grain changes an economy system's inputs without either knowing about the other.
Emergence is cheap because coupling is structural rather than negotiated.

### Faculties are data, therefore composable at runtime **[DECIDED]**

Because cognition is components, an agent's cognitive architecture is editable while it runs:

- Add `BehaviorPolicy` → the agent acts deterministically. Remove it → it falls back to reasoning.
- Add `Plan` → multi-step intent. Add `Personality` → disposition conditions its choices.
- Give a *rock* a `Mind` and it thinks.

And because GodAI can **create components at runtime** (§7), it can invent *new cognitive
faculties*. A `Paranoia` component plus a system that reads it, authored live, and now the
population has paranoia. The self-evolution thesis reaches all the way into psychology; there is no
privileged, hand-written set of mental faculties.

**This makes agents composable rather than configured.** Capability is addition of data, not
selection from a menu written by a developer.

### A mind does not need a body **[PROPOSED]**

The sharpest available demonstration of that claim, and currently unbuilt.

`organization` is a node kind (§5) — a guild, faction, temple, trading house, criminal network. Today
it would be inert data. But nothing in this architecture says a `Mind` must belong to a person.

Attach `Mind`, `Goal`, `Memory`, `Impression` and `BehaviorPolicy` to an organization entity and it
becomes an agent, running the identical cognition loop, with **no new machinery whatsoever**:

| Faculty | For a character | For an organization |
|---|---|---|
| **Perception** | query the room they occupy | query members, holdings, territory, rivals |
| **Needs / drives** | hunger, energy, social | treasury, morale, supply, legitimacy |
| **Memory** | what happened to me | institutional memory — grievances, debts, precedent |
| **Impression** | how I feel about Malcor | how the Guild regards the Temple |
| **Goal** | *find work* | *control the salt trade* |
| **Actions** | move, speak, interact | hire, decree, embargo, sanction, declare war |
| **Cadence** | seconds | days |

Members attach by `MemberOf` edges carrying role and standing. An organization has no
`GridPosition` — it is nowhere, which is correct; it acts through its members.

Three consequences worth having:

1. **Institutions get the compilation benefit.** An organization's repeated decisions compile into
   a behaviour policy exactly as a character's do. A guild *learns a doctrine* — and it is
   inspectable, because it is a tree.
2. **Deterministic systems drive politics for free.** A famine system decrements grain; the Guild's
   `Needs.supply` falls; its policy escalates. Nobody wrote "famine causes political instability" —
   it falls out of the absent boundary between physics and psychology.
3. **The narrative layer gets antagonists that are not people.** A corrupt institution can be a
   character in the story with motives, memory and a hidden agenda, without a face. The Keystone Rule
   holds unchanged: the NLE nudges the Guild's motivation, it does not command it.

This should be built as the first test of the composability claim, precisely because it should
require adding no code — only components. If it needs new machinery, the claim is weaker than stated
and we should learn that early.

### Perception is a query, not a delivery

Agents are not handed a context blob by an orchestrator. Entities *emit* stimuli into their
surroundings; agents *query* their local environment and perceive what is there, turn by turn. The
world can change with nobody informing anyone, and an agent finds out by looking — which is how
perception actually works, and which makes the number of agents irrelevant to the cost of a change.

Agent perception is therefore a **projection** (§15) — the same interface that renders a comic panel
or a MUD room, at a different fidelity and filtered by that agent's senses and traits. An NPC
looking at a room and a reader looking at a panel are the same operation.

### Two clocks **[DECIDED]**

The world runs deterministically at tick rate (`ecsTickRate`, default 20Hz). Cognition runs slowly
and asynchronously on the AI operation queue.

**The world never waits for a language model.** This is the property that makes ArgOS a simulation
with agents in it rather than an agent framework with a world attached. It is also what makes
determinism (§8) achievable at all: the fast loop is reproducible; the slow loop's *results* enter
as commits, which replay exactly.

### Agents as producers

An agent is a **producer** in the sense of §1 — peer to the human author and the content generator,
writing to the same graph through the same typed mutation protocol. Its decisions become commits.
Nothing about an agent's output is privileged over a human's edit in the studio.

### Where the ECS-nativeness has leaked **[known defect]**

Five module-scope `Map`s hold agent state outside the ECS, breaking the invariant:

| Store | File |
|---|---|
| `skills` | `cognition/skill-registry.ts:47` |
| `aspirations` | `cognition/goal-learning.ts:62` |
| `pendingDecisions` | `cognition/bt-compiler.ts:72` |
| `compiledSignatures` | `cognition/bt-compiler.ts:75` |
| `branchLastFired` | `cognition/bt-compiler.ts:78` |

Consequences, all real: learned skills and aspirations **do not survive a save**; a reloaded world
contains behaviour trees referencing skill definitions that no longer exist (the evaluator logs
`skill-not-found` and silently degrades); the compiled-branch cap resets on reload; and one process
can host exactly one world.

Separately, `Personality`, `WorkingMemory` and `Attention` are declared, and read by the prompt
builder, but **never attached to an agent by any production code path** — so
personality-conditioned behaviour never actually occurs.

**Decision: every cognitive faculty is ECS state or a graph node. No exceptions.** The five Maps
migrate into components or nodes; `Personality` is attached at agent creation.

### The ladder of control

Expensive reasoning happens once and compiles into cheap structure. This is the project's second
great idea after the graph, and it is empirically proven: a 600-second run produced **29 behaviour-tree
compilations**, agent trees growing 51 → 88 nodes, and exactly **one LLM decision**.

```
learned macro  >  compiled policy  >  contract  >  LLM plan  >  LLM exploration
     cheapest ─────────────────────────────────────────────────────► most expensive
     every success at an expensive tier becomes tomorrow's cheap tier
```

### One answer to "what should the agent do" **[DECIDED]**

Today there are **eight** competing models: ECS `Goal`+`GoalContract`, LLM autonomous goals, ECS
`Plan`, `DailySchedule`, `DailyPlan` (orphaned), `ScheduledActivity`, `ProceduralSkillV1` macros, and
God's own `Plan` type. This is untenable.

**Canonical: the CompiledPlan tuple** `ρ = (g, [s₁…sₙ], φ, σ)` — goal, steps, precondition,
postcondition — from `psyche-bt/docs/FORMAL-FRAMEWORK.md`, with `Q(τ)` replaced by a **world-grounded
postcondition check** against the graph. All eight prior models are retired by name.

### The behaviour-tree lineage decision **[DECIDED]**

Two incompatible lineages exist. `v2/src/cognition/` is wired to a world but its maintenance
machinery is dead (`pruneStaleBranches` and `recordBranchFired` are never called; failures are
discarded rather than recorded; compiler state is module-global and lost on reload; skills live in an
unpersisted module Map). `psyche-bt/` is not wired to a world but solves every one of those:
`resolveDecisionFailure`, `createCompilerContext` threading, live `tree-maintenance.ts`, persisted
skills with a directory parameter, and swarm merge.

**Decision: port psyche-bt's compiler into ArgOS as canonical.** The world is the hard,
unportable part; the compiler is the portable part.

Two known landmines to fix during the port:

- **`sequence` is not a sequence.** `behavior-policy.ts:840-853` gives selector semantics to
  non-condition children — `{sequence:[move, interact]}` executes *one* of them. Two compilers emit
  `sequence` intending ordered execution and get something else.
- **Priority is positional.** Splice indices assume the root selector's tail shape
  (`len-2`, `len-1`), true only of hand-written templates.

**Supersedes:** `v2/COGNITIVE_ARCHITECTURE.md`, `psyche-bt/docs/PAPER.md` (**archive, do not cite** —
its headline numbers do not reconcile with `DESIGN.md` or with the code). `psyche-bt/docs/FORMAL-FRAMEWORK.md`
survives as a **living spec**.

---

## 11. Producer II — Human Authoring **[OPEN]**

The studio→simulation direction. Genuinely unwritten anywhere in the corpus.

The only precedent is `v2/MAP_BUILDER_RENDERING_SPEC.md`'s `MapDoc → compiler → ECS → projection`
pipeline, which covers *spatial* entities only. It is the right shape; it needs generalising to
characters, organisations, relationships and visual references.

To specify: what must be authored vs. defaulted; what the compiler rejects; validation on import; and
the reverse — exporting a simulation run as an editable world the studio can re-instantiate.

### Agents doing real work

`v2/src/office-tools/` genuinely dispatches the real `gemini` CLI, performs real `git apply`, runs
real CI, and merges real PRs through an ECS state machine — verified by ~30 behavioural tests. It is
**never registered in the production runtime**; `registerBuiltinOfficeTools()` and
`createRepoIntegratorSystem()` have zero non-test call sites.

This is the most valuable orphan in the repository, and it is the mechanism behind "an NPC uses an
in-world computer to run a coding agent." The gap is wiring, plus three generalisations: per-object
capability scoping instead of three process-wide env flags; the ability to mount a real repository
instead of a hardcoded fixture catalogue; and a GodAI-extensible tool registry (today GodAI can
*declare* `run_tool: {toolId: 'anything'}` but a developer must have hand-written the handler).

**Supersedes:** none — this is new. `v2/OFFICE_TOOLING_SPEC.md` and
`v2/MAP_BUILDER_RENDERING_SPEC.md` survive as **living specs** feeding it.

---

## 12. Producer III — Generative Content **[OPEN]**

The 2024-09-05 sequence diagram's final step — *"ContentGen updates ECS with the new blog post
entity"* — is the only statement of this idea in the corpus, and it is a picture.

**Decision [DECIDED]:** generated artifacts are **first-class graph nodes** (`media-asset`), bound to
the commits they depict.

To specify **[OPEN]**: how a visual reference attaches to a character node; how a generated comic
page, video shot or microdrama binds back to its commit range; and how visual continuity for a
character across forty panels is represented. `v2/src/rendering/` (`character-rig.ts`,
`sprite-registry.ts`, `ai-tilemap-generator.ts`) holds the only per-character visual identity in the
system today — notably, `CharacterRigConfig` *is* one of the 19 persisted components while `Traits`
and `Goal` are not.

`spirits/story-templates.ts`'s `ComicOutput` exporter is the waiting consumer. It needs an input
contract, which §6 provides.

**Supersedes:** `designDocsBackup/creativeAgents.md` (its Director/Artist/Writer/Editor/Critic
pipeline is the only transmedia-pipeline precedent in the corpus — carried here),
`designDocsBackup/narrativeAgents.md`.

---

## 13. The Narrative Director **[DECIDED]**

Bound by the Keystone Rule (§3). Plans at altitude 2 (§2).

### The story graph lives in the world graph

`narrative-node` is a node kind (§5). Tensions, beats and arcs are graph nodes with typed edges to
the characters and locations they concern, and edges carry **probability weights** — the likelihood
of that path being taken, continuously re-weighted from world state, character motivation, and player
action (`LSE/architecture/narrative-logic-engine.md`).

This unifies five competing arc models, four of which are dead:

| Model | Fate |
|---|---|
| `StoryScaffold` | **Survives** as `narrative-node` — currently MUD-only and *not persisted at all* |
| `GlobalNarrativeArc` (`simulation/global-state.ts`) | Merge — its phase/foreshadowing/required-beat vocabulary is the best in the corpus. `activeArcs` is written **nowhere**; the arc engine is inert. |
| `NarrativeArc` (`god/monitoring-system.ts`) | Retire |
| `StoryTemplate` (`spirits/story-templates.ts`, 2129 LOC) | Retire; salvage the genre templates |
| `EpisodeState` + plot threads | Retire — zero callers |

### It must run in the production runtime

`narrative-director.ts` is imported **only** by `src/mud/*` and `lil/game-engine.ts`. Neither
`index.ts` nor `run-dev-server.ts` reference `nle/` at all. Headless simulations, the dev server and
the UI have zero narrative direction — the entire simulation→narrative production leg is not running.

**Supersedes:** `LSE/architecture/narrative-logic-engine.md` (absorbed), and the five arc models above.

---

## 14. The Language Boundary **[DECIDED]**

The LIL is the **sole gateway** between language and graph, for humans *and* agents. The 2024
sequence diagram's rule — *the UI never touches the ECS* — is restored and extended: **nothing
touches the graph except through typed mutations.**

Its four responsibilities, one per altitude crossing:

| | Direction | Function |
|---|---|---|
| **lower** | 2 → 1 | semantic event → component/relation writes |
| **lift** | 1 → 2 | mechanical deltas → semantic events (**the missing layer**) |
| **render** | 2 → 3 | commits → prose, panels, shots (`world-renderer.ts` exists) |
| **parse** | 3 → 2 | text → intent → typed mutation (`intent-parser.ts` exists) |

The claim that most needs honouring, from `linguistic-integration-layer.md`: **agent perception IS
LIL output.** The same layer that describes the world to a player describes it to an NPC. Today they
are separate code paths, which is precisely why NPC dialogue does not reflect NPC memory — the
playtest confirmed that all secret-hinting comes from the DM layer embellishing, not from characters
accessing their own memory stores.

Six independent prose-generation paths currently exist. They collapse into `render`.

---

## 15. Projections **[DECIDED]**

One declared interface:

```
project(graphState, commitRange, medium) → artifact
```

with a catalogue: agent perception (five modalities, trait-gated) · MUD room description · comic page
· shot list · timeline/graph UI · narrative prose.

**The grounded-creation invariant:** *a description is valid only if the entities it implies exist in
the graph.* This is the Keystone Rule (§3) expressed on the output side, and it is what makes "same
world, many media" real rather than aspirational.

`DESIGN_DOC_UI.md`'s network-graph-plus-scrubbable-timeline sketch — written for v1 and archived —
becomes newly relevant here as the studio's primary view.

**Supersedes:** `v2/GROUNDED_SUBSTRATE_SPEC.md` §projection (the rest survives as a **living spec**),
`v2/WORLDBUILDING_ARCHITECTURE.md` §6.8 and §13.2.6.

---

## 16. The Spirit Layer **[THEORY / DECIDED]**

### Two kinds of commit

The distinction this layer exists to serve, and which no prior document named:

| | | Who writes it |
|---|---|---|
| **State commit** | What *happened* in the world | Agents, human authors, spirits |
| **Vocabulary commit** | What *can happen* in the world — a new component type, system, affordance, trait, relation kind, or rule | **Spirits and human authors only. Never agents.** |

Agents live inside the rules. **Spirits edit the rules while the world runs.**

That is the spirit layer's architectural identity, and it is not "maintenance." It is *world
authoring at runtime* — which makes the spirit hierarchy the **autonomous counterpart of the human
author in the studio** (§11). Same power, same commit protocol, no human in the loop. §7 gives the
*rules* for vocabulary change; this section gives the *authors* who make them.

### The invariant: spirits are invisible **[DECIDED]**

Spirits operate at a tier NPCs cannot perceive. This is enforced structurally, not by convention —
`sensory-system.ts` and `agent-mind.ts` contain **zero references to `Spirit`**. No spirit appears in
any perception query. An NPC can no more notice a spirit than a character can notice their author.

The corollary is the Keystone Rule (§3) generalised from the NLE to the entire supervisory tier:

> **A spirit may inject an entity, modify a component, mutate a motivation, or extend the
> vocabulary. It may never command an agent, and never assert anything the graph does not show.**

Every spirit acts *through the world*, never *to* a character. If the Steward wants a room to feel
alive, it populates the room; it does not tell anyone to feel anything.

### The daemon tier

Beneath the eight spirits sits a **per-agent daemon** (`spirits/agent-daemon.ts`) — a private
observer bound to one character, holding that character's narrative arc, growth opportunities,
concerns, and point-of-view story. It is the sanctioned channel by which the narrative layer reaches
an individual.

A narrative nudge does not become a command. `convertNudgeToWhisper` turns it into a **second-person
suggestion delivered as a perception**:

> *"You've been traveling long enough. It's time to arrive and see what awaits you."*

The agent perceives the whisper and may act on it or ignore it, exactly as with any other stimulus.
**Autonomy is preserved because influence is routed through perception rather than control.** This is
the missing link between the narrative director and the characters, and it already exists.

### The eight

| Spirit | Domain | Cadence | Powers | Function |
|---|---|---|---|---|
| **Narrator** | narrative | 30s | inject events, modify mood | Grounding-validated prose and narrative directives |
| **Arbiter** | guardian | 15s | none — pure observer | Validates agent actions and narrative mechanics; reports narrator hallucinations |
| **Tinker** | guardian | 45–60s | auto-fix, direct execution | Repairs broken systems via a tool-calling loop |
| **Weaver** | narrative | 30–120s | **bake systems**, direct execution | Designs and compiles new systems from identified needs. The primary vocabulary author. |
| **Crafter** | ecology | 15s | create entities | Materialises entities for interactions that failed for want of a referent |
| **Steward** | locale | 30s | create entities | Detects unpopulated rooms and populates them from schema |
| **Lawgiver** | guardian | 60s | none | Rule proposal and approval |
| **Watcher** | guardian | 45s | none — synthesises | **Deterministic, no LLM.** Runs detectors, prioritises observations, issues proposals to the Weaver |

The Watcher is the keystone of the loop and the only spirit that does not use a language model — it
is pure synthesis over observations, which is why it is cheap enough to run continuously.

### Governance

A capability model already exists and should be formalised rather than replaced:
`canInjectEvents`, `canModifyMood`, `canCreateEntities`, `canBakeSystems`, `canExecuteDirectly`,
`proposalApproval`. Every spirit declares its powers; the commit layer enforces them.

```
observe → aggregate → prioritise → propose → design → bake → REGRESSION GATE → commit
                                                              ↑
                        gapId with status lifecycle: open → addressed → verified → failed
```

```
observe → aggregate → prioritise → propose → design → bake → REGRESSION GATE → commit
                                                              ↑
                        gapId with status lifecycle: open → addressed → verified → failed
```

**The regression gate and the gap lifecycle are the missing halves.** Without them the loop generates
without selecting, which is the documented cause of 74 components and 65 systems (§7).

Also required: a **single gated committer**. `v2/GODAI_AUTOPILOT_SPEC.md`'s inbox/priority/backoff/mutex
pattern is exactly the "many async producers, one authoritative committer" shape the commit layer
needs, and it is already designed.

### Verified state of the layer **[known defects]**

The design is sound and mostly built. It is wired badly.

| Defect | Evidence |
|---|---|
| **Five of six sensors are dead.** Crafter, Steward, Tinker, Arbiter and effectiveness-tracker all report gaps through `require()` in an ESM package, inside bare `catch {}`. **The loop has one sensor: the Watcher, observing itself.** | §7, §17 |
| **The Lawgiver never runs.** `requestRule()` has zero callers outside its own file; `runLawgiverCycle()` is invoked only from behavioural tests. Rules are proposed by nobody. | `rules-spirit.ts:92,447` |
| **Spirits only work in the dev server.** The Weaver's and Tinker's substantive cognition is wired in `run-dev-server.ts` only. A caller using the documented library entry point `createSimulation()` gets an inert generic pass — **self-evolution does not happen through the public API.** | `index.ts` vs `run-dev-server.ts` |
| **Two messaging systems.** `spirit-registry`'s inbox (what spirits actually read) and `spirit-messaging`'s `spiritRouter` (what the dead orchestrator writes to). Messages sent through the second vanish silently. | `spirit-messaging.ts`, `god-tools-orchestrator.ts` (615 LOC, zero production importers) |
| **The Crafter is ticked three times** by three overlapping cycles, only one of which does its actual job. | registered as type `architect`, so it is caught by the Weaver's cycle too |
| **`operator-spirit.ts` is orphaned** — 338 LOC, the "external world bridge," zero references anywhere. | |
| **GodAI has no spirit visibility in the dev server.** `setGodAgentCallback` is never called there, so all spirit→God traffic falls back to keyword routing and God acts only when a human types. | |

Together these explain the file counts in §7 exactly: **generation works, evaluation does not.**

**Supersedes:** `v2/WORLDBUILDING_ARCHITECTURE.md` §13-§15,
`god-agent-v2/META_COGNITIVE_ARCHITECTURE.md` and `LIVE_BUILDING_CONCEPT.md` (their three-tier LLM
hierarchy and author-while-running contract are absorbed).

---

## 17. Current State — Verified 2026-07-24

No entry may be marked done without a `file:line` citation.

### Known broken

| | Evidence |
|---|---|
| **17 `require()` calls in an ESM package**, all silent no-ops | `package.json:5` `"type":"module"`; probe: `require is not defined`. Kills gap reporting from 5 of 6 spirits, goal→skill compilation, anti-repetition, Watcher policy evolution, LIL state diffing |
| **Saved worlds with a baked system fail to load** | `world-persistence.ts:442` — uncaught `require` inside `deserializeWorld` |
| **`Traits` component silently overwritten** | `component-registry.ts` bare `entries.set`; `data/components/Traits.json` |
| **19 of 78 components persisted** | `world-persistence.ts:58-147` |
| **Two ECS cores, same exported symbol** | `src/core/ecs.ts:41`, `src/ecs/world.ts:45` |
| **NLE never ticked in production** | zero `nle/` imports from `index.ts` or `run-dev-server.ts` |
| **office-tools never registered in production** | zero non-test call sites |
| **Unseeded RNG on the "deterministic" loop** | `builtin-systems.ts:291,293,295,494,1008` |
| **Agents never speak** | `speaks: 0` across all four chronicle runs |
| **`exits` = every room in the world** | `lil/world-snapshot.ts:150-151` |

### Working

| | Evidence |
|---|---|
| BT compilation loop | 600s run: 29 compilations, trees 51→88 nodes, 1 LLM decision, 0 errors |
| Genesis world generation | playtest v3 grade **A-**: interlocking tensions bound to character aspirations |
| Spirit hierarchy (Watcher sensor only) | 24 spirit events, 3 systems baked in a 600s run |
| Real tool dispatch | ~30 behavioural tests; real gemini CLI, `git apply`, CI, PR merge |
| Dynamic component/system creation | 74 components, 65 systems generated at runtime |

---

## 18. Migration

Ordering falls out of the dependency chain. Each phase is independently testable.

| Phase | Work | Unblocks |
|---|---|---|
| **0. Unbreak** | Ban `require()` (lint gate); collision-reject in `component-registry`; register office-tools; delete `src/core/`; tick the NLE | Everything. Restores 5 of 6 evolution sensors; makes worlds loadable |
| **1. Identity** (§4) | Durable NodeId, bidirectional eid index | Every subsequent phase |
| **2. Change record** (§6) | Conform to the studio schema; observer-based capture | The stream |
| **3. Determinism** (§8) | Seeded RNG, logical clock, tick wiring | Replay |
| **4. Commits & squash** (§6) | Commit boundaries, squash-as-view, replay | Recomposition |
| **5. Query layer** | Graph query API — greenfield, nothing coupled | Agents, LIL, studio, projections |
| **6. Projections** (§15) | One `project()` interface; collapse six prose paths | Many media |
| **7. Studio bidirectionality** (§11) | Author → instantiate; run → export | The product |
| **8. Media nodes** (§12) | Artifacts as graph nodes; visual continuity | Comics, microdramas |

Phase 0 is unglamorous and is the highest-leverage work available. Nothing above it is worth
designing on a codebase where saved worlds do not load.

---

## Appendix A — Retired Documents Register

**Delete:** `v2/context.md` (100% derivative — duplicates `tech spec.md` prose and
`LSE/references/ecsAgent.ts` code) · `designDocsBackup/bitecs_serialization.md` (third-party docs
mistaken for a design decision) · `LSE/references/ecsNextDoc.md` (stale, actively wrong) ·
`LSE/references/LSEArchitecture.md` (strict subset of `tech spec.md`).

**Archive to `docs/archive/`:** `LSE/designDoc.md` · `LSE/references/technicalReviewOutline.md` ·
`LSE/architecture/roadmap.md` · `v2/ARCHITECTURE.md` · `v2/ROADMAP.md` · `v2/PLAN-phase3.md` ·
`v2/PLAN-phase3.5-NLE-LIL.md` · `psyche-bt/docs/PAPER.md` · `DESIGN_DOC.md` · `DESIGN_DOC_UI.md` ·
`docs/o1-review.md` · `designDocsBackup/**` · `god-agent-v2/*.md` · `COGNITION_*.md` · `LSE/src/*`
(keep the code, archive as reference).

**Survive as living specs, referenced by this document:**
`psyche-bt/docs/FORMAL-FRAMEWORK.md` → *Agent Cognition Spec* ·
`v2/GROUNDED_SUBSTRATE_SPEC.md` → *Runtime Substrate Spec* ·
`v2/MAP_BUILDER_RENDERING_SPEC.md` → *Authoring & Instantiation Spec* ·
`v2/OFFICE_TOOLING_SPEC.md` → *Tool Execution Spec* ·
`psyche-bt/AGENTS.md` → keep only "Known Limitations" and "Key Design Decisions and Why", the only
honest negative results in the corpus.

**Note:** `CLAUDE.md` still describes v1 ArgOS (`src/`) and must be rewritten against this document.

---

## Appendix B — Glossary

One name per concept.

**World Graph** — the canonical state. Nodes + typed edges + durable identity.
**Commit** — an atomic, addressable, replayable group of changes at altitude 2.
**Altitude** — 1 mechanical / 2 semantic / 3 narrative (§2).
**Lift / Lower** — LIL translation between altitudes 1 and 2.
**NodeId** — durable identity, distinct from BitECS `eid`.
**Keystone Rule** — the NLE may only inject an entity, modify a component, or mutate a motivation (§3).
**Producer** — anything that writes commits: simulation, human author, generative model.
**Projection** — `(graph state, commit range, medium) → artifact`.
**Spirit** — an observer/proposer over the graph. Eight: Narrator, Arbiter, Tinker, Weaver, Crafter,
Steward, Lawgiver, Watcher.
**Regression gate** — the admission test for self-generated change.

---

## Appendix C — Open Questions

Ordered by how much they block.

1. **NodeId format** (§4) — must align with the studio. *Blocks everything.*
2. **Commit boundary** (§6) — beat, tick, turn, or session?
3. **Squash semantics** (§6) — view or destructive rewrite? *Recommend view.*
4. **Stream altitude** (§6) — altitude 2 only, or both? *Recommend 2 only.*
5. **Merge and conflict semantics** (§6) — what happens when a human edits a character in the studio
   while a simulation has advanced past that point? The only gesture in the corpus is
   `llm-grounding.md:31`'s **retcon as costed optimisation** — choose the revision with least impact
   on established narrative. That is a good starting principle and needs an algorithm.
6. **Ledger location** — inside ArgOS, or a shared package the studio also consumes?
7. **World namespacing** (§7) — the studio implies many coexisting worlds. A run is a branch; what is
   a world?
