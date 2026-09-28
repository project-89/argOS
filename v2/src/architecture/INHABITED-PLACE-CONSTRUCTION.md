# Inhabited place construction

An actor's intention can reveal a missing destination. The authoring layer may
build possibilities around that intention, but it cannot turn the intention
into an arrival, completed encounter, or forced choice. A restaurant description
does not create an owner, customers, food, or working transport.

## Boundaries

The existing path remains: actor-owned ECS Goal / observable event → fresh
architect observation → validated proposal → native construction or managed
coding job → actual ECS changes → local perception and independent actor choice.

`engineering/place-materialization.ts` adds a bounded **authoring input**, not a
second simulation. A room blueprint declares native child entities and optional
availability requirements. Both architect entity proposals and God's
`createPlace` tool use that executor. Existing library `simulation.command(...)`
reaches the God tool surface; no separate demo-only world generator is required.
The restricted narrative-preparation authority does NOT gain this tool.

Rooms, NPCs and props use their canonical initializers. Generated props now
receive the same PhysicalObject, GridPosition, ObjectType, ObjectState and Traits
baseline as authored props. Normal cognition and daemon discovery see generated
NPCs as native actors; the blueprint does not install scripted decisions.

Fresh architect entity designs and God's `createPlace` input now use the shared
`validateAuthoredEntityBlueprint` contract. New rooms must explicitly declare
`contents`; `[]` remains valid for a deliberately empty room. Objects, including
children, must declare a registered `ObjectType.typeId`. These are structural
requirements, not a semantic test that a venue has everything its purpose needs.
Trusted native host constructors retain legacy bare-room/generic-object inputs.

Typed props reuse `ObjectManager.spawn`, not a generic initializer followed by
an ObjectType label. Native type states, traits, declared default components,
stimuli and physical capabilities therefore materialize together. The `surface`
trait supplies the native Surface component. Type-specific initial states and
explicit overrides are validated first; the whole compound place checks for
conflicting prospective dynamic component schemas before allocating any member.
A type's declared dynamic schema may be registered by its normal native spawn;
unknown additional component values cannot invent a schema.

Background entity designers receive a bounded catalog of registered types and
component fields, with explicit omission counts. It contains schema metadata,
not actor data; Agent fields describe creation of a new person, not access to an
existing person's thoughts. Delayed entity proposals retain the referenced type
definitions observed before design, alongside source, room, topology and exact
specification checks. Changed definitions invalidate admission; unrelated type
additions and the spawn's own dynamic schema registration do not. This still
uses the existing process-wide WorldSchema, not a new per-world schema registry.

Native type construction is not complete physical realism: for example, object
mass/material use existing defaults unless explicitly authored. A generic type
named "table" is still generic. No label infers physics or creates a mechanic.

## Input and stages

A room retains `name`, `description`, `type: "room"`, and `components`. Optional
`connectToRoomEids` names up to eight existing, observed rooms. It requires the
normal opted-in room-route policy. `contents` holds up to twelve entries:

```json
{
  "id": "keeper",
  "entity": {
    "name": "Nora",
    "description": "The workshop keeper.",
    "type": "agent",
    "components": [{ "name": "Agent", "values": { "role": "keeper" } }]
  }
}
```

Children can be agents, objects or stimulus sources. They cannot supply a foreign
room ID or nested room; each is placed in the new parent. Local IDs and entity
names must be distinct. Current existing names reject duplicate construction.
Components/fields must already exist with the right scalar types. The entire
definition and available construction budget are preflighted before allocation.

Construction reuses the shared allocator once per real entity. Connectivity is
published after the native members are built. Source, demand, dependency identity
and constructed membership are rechecked during assembly. A reentrant change or
failure is recorded as failed partial work, not fictitious completion. Partial
entities remain real; no unrelated work is deleted and admissions are not refunded.
Preflight is not a capacity reservation or a general ECS transaction.

Optional `requiredSystems` lists up to six exact system names.
`requiredInteractions` lists up to twelve `{actor, target, affordance}` entries,
using local child IDs (or `"room"` for the target). Unknown components require
prior component construction. Missing mechanics use the existing managed system
proposal, immutable acceptance tests, validation and tick-bound activation path.
Merely declaring a requirement does not enqueue or implement code.

## Observation is not success

`getPlaceBuildStatus` and God's `getPlaceBuilds` report native assembly phase,
bound entity identities/current locations and unmet availability requirements.
Architect and God contexts include those observations; live growth recordings
retain them. Proposal `executed` means native assembly was constructed, not that
all declared systems are available or the actor accomplished anything.

`readyNow` means: current source; completed native assembly; members still exist
with their identities; agents active; requested routes still reciprocal; declared
systems active/compiled/not restore-pending or currently erroring; specified
interactions actually offered to the co-located actor. It is NOT an acceptance
test of the mechanic's semantics. An idempotently available command can cause no
new change. Tests and runtime physical receipts must establish actual effects.

A customer leaving changes their location, not construction history, and never
triggers a replacement. A removed member is reported missing, not recreated.
Outside phone contacts remain outside contacts: no runtime rule manufactures
their physical presence from what they texted.

Receipts are bounded per-world, source-bound runtime authoring diagnostics (64
assemblies, no silent eviction). They are not persisted commands or restoration
authority. Native entities follow existing ECS persistence; a source restart
makes old receipt readiness unavailable, and a separately restored world does
not inherit this runtime receipt map. Durable place-requirement restoration and
resumption need a separate, explicit contract before claiming that gate complete.

## Evidence and remaining work

### Recorded generated-world scope

The apartment's public scene projection now discovers active native actors and
rooms instead of using the initial named cast/map as the world boundary. Removed,
prefab and God entities are excluded. Character appearance and visible props
still use the existing public allowlists; private thoughts, concealed possessions
and phone-message bodies do not become renderer context.

`CommittedSceneHistory.assembleWorld(start, end)` reads the retained source, not
current ECS. Complete boundary captures replace the observed room set. Sparse
event-local witnesses update their observed actors/targets/held props without
declaring unmentioned neighbors absent. This lets a newly created room and actor
be observed at their first actual public event before the next whole-world
capture. The resulting timeline is a last-observed public projection, not a new
ECS snapshot or a claim that every unrelated room was observed at that instant.

The sitcom director consumes this world-presence timeline. Initial blocking and
checkpoint sets contain only rooms/actors present at the source start; later
appearances, departures and changed room descriptions are timed state beats.
Public speech uses its actual word receipts exactly once. Camera subject names
come from the observed actor, including actors absent from opening blocking.
The phone sound channel samples newly observed rooms at emission as well.

The old `assemble(..., roomId)` stays strict about uninterrupted local coverage.
`WorldRoomEvidence` has a distinct coverage type and cannot be passed to the old
single-room projector or legacy screenplay entry point. Runtime checks also
reject that misuse after JSON decoding; removing the marker does not make a
future first state a valid opening baseline. World-window types are exported
through the existing library entry point. No new UI, video session or narrative
generation agent is involved.

Room disappearance does not erase historical speech. Reused room identities
within a requested interval, unavailable event scope, retention loss and capacity
limits remain explicit failures, not permission to join lifetimes or silently
skip evidence. This does not yet provide arbitrary world-scale filming, guarantee
provider depiction, or establish natural live author/NPC choices.

Tests exercise compound architect design/direct/approved/queued execution, God
tool dispatch, daemon discovery, invalid/stale/reentrant boundaries and actual
managed valve construction → activation → native action → physical flow/sound
changes while ticks continue. The worker is controlled; no live-model or natural
behavior success follows from these tests.

Still required: prospective live author selection and timing; inhabited arrival
and interaction; generated transport with real elapsed movement; multiple useful
mechanics/settings; durable restoration; and the larger cognition/endurance gates.
No restaurant/taxi-specific production behavior is introduced here.

## Author observation and design handoff

Fresh architect room needs now declare bounded `supportRequirements` before the
detailed designer acts. Kinds cover a space, an existing-room connection, an
entity (optionally its role/object type), a native interaction between declared
entity IDs, and a named required system. IDs are distinct and shared with actual
contents. The detailed design cannot drop a requirement, substitute another type
or role, omit a connection/system/interaction, or return a non-room substitute.
The shared constructor revalidates a copied contract before allocation; the
private proposal admission carries it through direct and queued native paths.

This is a predeclared author interpretation, not an actor goal contract. Existing
Goal success evaluation remains unchanged. Place observations now distinguish
`support.status: unassessed` from `unavailable` and `available` for the declared
contract. They use native identities, locations, types, roles, affordance
availability and executable system health, never the descriptive prose as a
physical assertion. A resident elsewhere, food consumed, a changed type/role,
closed route or missing mechanic changes current availability; nothing is
automatically replaced or compelled. Ordinary host/God assembly without a prior
support contract stays explicitly unassessed, even when `readyNow` is true.
Support recipes and construction receipts remain runtime author provenance, not
persisted authority or a second store of ECS facts. NPC observations do not gain
access to these author-only requirements.

Author/God type vocabularies now use actual WorldSchema registry keys (not a type's
display name: the base food key is `food_item`, display name `food`). No aliases or
saved-world migration. Needs receive bounded type/affordance metadata to choose
requirements; this vocabulary is not proof of contextual availability.

Live three-case probe 3shVhX built a meal/seat/host, an observatory/staff/workstation,
and a clockmaker/workbench using six Flash calls, with actual native connections
and components. It also exposed a contract limit: interaction actor IDs can refer
only to newly authored entities, leading to self-talk instead of a visiting
actor's interaction. Available declared checks are not evidence that a complete
purpose is supported. No actual comet data, repair mechanic, independent customer
activity or travel was exercised. Bind real beneficiary actors and data/mechanic
requirements next; do not encode a restaurant recipe or reinterpret the probe
as behavioral acceptance.

The current personal-intention refinement input uses explicit `edits`, not a
replacement `description`. A replace edit names an exact unique `before` fragment
and its `after` value; an append edit supplies `text`. Up to four edits refer to
the same observed definition, with at most one append. Missing/ambiguous anchors,
overlap, unknown fields, no-op and over300-character results reject atomically.
Unmentioned wording is preserved instead of being regenerated by the model.
An actor can explicitly remove a detail or change the activity; the interface
does not forbid deliberate changes of mind or guarantee semantic wisdom.

The result remains the existing ECS Goal.description/paramsJson/signature, with
the same monotonic intentionRevision and identity, no parallel authoritative
intent store. Existing planners, foreground context and author observations read
that same definition. Old strategies retire without proof of success, stale
source/owner/contract control still rejects, and native persisted goals retain
their format. The refinement CONTROL payload changed; old whole-description
commands are rejected, not automatically translated into destructive rewrites.
Private memories retain the actor's actual selected edits; diagnostic events
remain free of their private prose.

Four stationary production-appraisal probes exercised these edits with the
configured Flash model: meal/companion retained through a restaurant change,
science purpose retained through a dome change, repair purpose retained while
adding a receipt, and a deliberate dinner→walk change. This does not establish
full-world behavior, meaningful venue construction or ten-trial acceptance.

The architect setting includes bounded directed native room-route exits, using
the same edge selector as actor locomotion. Available empty exits are different
from no installed policy or a stale source. These are native one-step route
facts, not all-world reachability, vehicle service or an inference about legacy
package transport. Per-room exits default to16 with omittedTargets; the setting
reports omittedEntities beyond its60-entity window. Observing does not allocate
entities or change NPC knowledge. NPC route menus remain local to their room.

Need validation and design now share an observation index for event/entity/job/
intention/interaction/failed-proposal citations. Design receives the contents of
the selected captured records plus the need's attributed rationale, not just
opaque reference strings. Uncited private goals and actor system prompts are not
appended. This preserves existing source, intention, type and placement guards;
it does not promote an author interpretation into physical truth or replace
execution checks.

Captured native route evidence now binds cited room observations and an entity
design's actual placement/connection dependencies. A proposal rechecks those
exit sets before design, on return, at approval/dispatch and at managed release
activation. Source, cancellation, room identity/labels, topology installation,
current directed targets and per-source-room route revisions stay authoritative.
Closing/reopening an exit through the native helpers invalidates the old evidence,
even if the final target list looks identical. A change at an unrelated source
room, a no-op connect or an actor walking elsewhere does not invalidate it.

Native compound construction passes its own newly allocated room identity to
the private admission callback. Only the specified new-room connections may
extend the captured exit set, exactly once each. This does not excuse changes to
old exits or permit model-supplied exceptions. Reentrant changes retain real
partial assembly with failed status, rather than publishing successful assembly.
The source/room checks are ephemeral provenance, not a second map, persisted
permission or NPC knowledge. AdjacentTo remains the real persisted topology.
Capture may initialize the normal WorkingMemoryIdentity used for ownership;
the public observation function remains a pure copied snapshot.

Scope limits: this guards the architect's cited rooms and physical dependencies,
not semantic correctness of every uncited inference about the wider setting.
Unobserved raw ECS remove/re-add cannot supply historical revisions; native
helpers record those revisions. Direct raw changes still compare current edges.
No native policy is an unavailable observation, not evidence about legacy
transport. Actual route traversal, useful venue operation and real-model author
judgment remain separate acceptance gates.

inhabited-growth-04 exposed both omissions: the architect called an already
traversed connection missing, while the designer guessed a comedy club from
"reachable venue". Live trial failure is retained. Correct input alone does not
prove semantically sufficient generation; dinner meaning had also been dropped
by a later actor goal refinement. Contents:[] and an empty requirement set can be
structurally valid while failing the intended experience.

## Legacy evolution boundary

The older `approveEvolutionProposal` host API now requires an explicit World.
The resulting execution grant is one-shot and binds the proposal's definition,
source and exact existing room. A serialized `approved` field is not authority.
Merchant construction uses the native initializer, records the actual entity,
and leaves promised resources unverified. It does not resolve resource gaps or
register a supplier on the strength of a description. A descriptive resource
source, recipe, trade route or system cannot execute via this legacy API: it
reports failure and requires normal validated native/managed authoring.

God and architect receive world-filtered unfinished-work observations. These
records distinguish a current observation basis from unused execution authority;
they are not an NPC perception feed or a persisted supply-chain contract.

## Failed interactions are observations

The active Crafter no longer auto-provides an item because an NPC cannot find it.
Native failure call sites record world/source/actor-bound observations in
`spirits/interaction-observations.ts`. The attempted target is not proof of global
absence: current exact-name matches include remote existing identities. Original
command content is not carried into this channel or the public event stream.

God and active architects read this bounded author-only channel alongside world
inventory and current intentions. They can abstain, propose a useful new native
place/entity or request managed mechanics. The ordinary proposal, validation,
construction-budget and lifecycle gates still own writes. Legacy unscoped
failure diagnostics and resource-mode policies do not grant live construction.

Each cited failure is checked through design and delayed admission. The native
executor consumes its matching-state precondition before construction begins;
its own new target may then fulfill that precondition without aborting its other
members. Source/identity, exact specification and cited intention checks remain.
Managed work retains the full observation check until asynchronous activation.
A current cited owned Goal can sustain authoring while its actor travels; a
failure-only request retains its local context requirement. Neither is permission
to teleport the actor or complete their objective.

Repeated identical failures share a reference; observation storage and match
width are bounded at64 with omissions reported and evicted grants invalidated.
Observed stale states do not revive after a return to prior values. Raw unobserved
ECS mutation does not gain an invented revision journal from this change.

This removes deterministic auto-replenishment, not the need to evaluate author
judgment. Live authors must still demonstrate that they distinguish intentional
absence/depletion from legitimate missing capabilities and build promptly.
