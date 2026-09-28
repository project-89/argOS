# Outside participants and simulated people

The inhabited-growth-03 live diagnostic exposed an identity failure: an architect
created Alex as an autonomous acquaintance because Elaine intended to meet the
outside caller. A model warning did not prevent this. Intentions justify world
possibilities; they do not authorize inventing the participant's physical presence.

## Data and authority

`ExternalParticipant` is host-owned ECS metadata: stable opaque ID, display name,
bounded historical aliases and revision. It is not an Agent, Name-tagged physical
entity, location, perception, relationship, message or world-construction admission.
The apartment contact constructor/setter registers the outside identity separately
from the phone. Phone removal does not erase it; ordinary ECS persistence retains
it across EID remapping. The setter's existing per-message contact snapshots remain
unchanged. Changing the displayed profile does not rewrite past correspondence.

God and architects receive an author-only identity projection. It includes no
relationship/context/message contents and does not enter NPC perception or public
committed events. Environmental coding packages cannot read/write either participant
component through the managed capability contract.

New actor construction rejects collisions with registered participant labels,
using normalized exact identity lookup (Unicode normalization, whitespace and case).
This is not an Alex-specific ban or narrative instruction. Distinct residents and
empty/unpopulated transit spaces remain valid. Historical names remain reserved
so delayed proposals cannot evade a contact rename. At most256participants and
32aliases per participant are retained; exceeding a bound fails explicitly rather
than forgetting earlier identity evidence.

The canonical prefab initializer and pre-allocation constructor check this boundary.
Native entity proposals and all compound-place members are checked before allocation.
Component-registry attachment, generic author add/set/remove operations and the
legacy dynamic setter cannot forge participant components, rename an NPC to an
outside identity, or attach Agent to an outside-named placeholder. Actual execution
checks the current identities, even when a proposal was designed earlier.

## Explicit host delegation

Advanced host APIs are exported through `src/index.ts`. An explicitly authorized
autonomous avatar is possible; there is no God/spirit/LLM tool to issue its grant.

```ts
registerExternalParticipant(sim.world, "outside:session-123", "Morgan");
// Only after an explicit host/user decision to create a simulated delegate:
const participantGrant = authorizeParticipantEmbodiment(sim.world, "outside:session-123");
const avatar = createAgentEntity(sim.world, {
  name: "Morgan", role: "delegated avatar", roomId,
  systemPrompt: "You are an explicitly delegated simulated avatar of Morgan.",
  participantGrant,
});
```

Grants are opaque in-process capabilities, bound to the World, committed-event
source, exact participant record/revision and issuing task's cancellation signal.
They are consumed before native initialization; construction failure does not
restore permission. Finalization rechecks the source/identity and writes an actual
`ParticipantEmbodiment` link with the actor's stable owner key. Copied JSON, stale
tokens, changed names, source restart, another World or an existing delegated body
do not authorize another actor. Grants are never persisted or restored as authority.
Persisted avatar bindings survive EID remapping and still identify a local delegate,
not proof the remote human is physically in the scene or chose the avatar's actions.

## Verification and remaining scope

Tests cover the actual apartment contact setter through native entity/place/prefab
construction, real phone removal, new residents, explicit delegation, stale/copy/
foreign/cancelled grants, restoration, aliases, admission after an intervening
registration, shared mutation routes and actual God/architect context delivery.

This is a registered-identity boundary, not semantic identity recognition from
arbitrary prose or aliases nobody registered. Claims from an unknown sender remain
claims; do not infer a participant or grant from message text. Already existing
namesakes are not retroactively renamed, linked or controlled. Raw trusted host
access to mutable ECS arrays is not sandboxed by this API.

The legacy global component registry/ObjectMeta path still requires correct world
activation when alternating native construction across simultaneous worlds; the
identity checks are World-scoped, not proof that every legacy constructor is.
Live author judgment, useful populated-place contracts, transport/coding mechanics,
dynamic camera/cast coverage and overall reliability acceptance remain separate gates.
