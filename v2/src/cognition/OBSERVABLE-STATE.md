# Public typed state

World packages may provide `observableState(targetEid)` alongside their normal
action and perception hooks. This is an authored public surface, not permission
to enumerate a component or inspect another actor's private state.

```ts
observableState: target => target === relay
  ? [
      { key: "powered", type: "boolean", value: Relay.powered[relay] },
      { key: "route", type: "enum", values: ["off", "north", "south"], value: Relay.route[relay] },
    ]
  : []
```

The shared `getObservedStateFields(world, actor, target?)` reader exposes stable
subject identity, label, exact `Observable.<key>` slot, type, allowed values and
current projected value. Booleans are encoded as the exact strings `"false"` and
`"true"` for the existing working-memory/barrier representation. Enums retain
their exact authored spelling. There are no prose aliases, numeric coercions or
substring success checks.

This catalog is pure. It assigns no UUID, appends no evidence and refreshes no
remembered value. Registration binds the package to its actor's stable identity;
each target must already have a stable identity from real sensing. The shared
gate requires a live sighted actor, the registered world/actor identity, a local
visible target and unobstructed containment. It refuses hidden objects, remote
targets and another actor's inventory even if a package lists them as visible.
It rechecks identity and access after projection and copies only schema fields.
Malformed, ambiguous, duplicate or out-of-domain fields fail closed for that
target. Limits are eight fields per target, twelve enum values and sixty-four
fields per catalog.

`captureWorkingMemoryObservation` assigns local identities at the sensing
boundary and admits these values as ordinary personally observed state facts.
Unchanged values retain the existing receipt-throttling policy; the ephemeral
owned observation token can still supply fresh proof. Successful physical
interaction receipts can include the actor's actual target fields. A failed
request supplies no successful field effects. Witnesses learn fields through
their own local projection, not by copying another actor's potentially different
field contract.

Prompt/catalog consumers should show only subject/slot pairs already present in
the actor's own working memory, using the ledger's last-known value with the
catalog's allowed values. A catalog read alone is not a new observation receipt.
This first version has no persistent or remote schema registry: after loading a
world or moving elsewhere, a currently observable contract must be established
again. Existing historical facts remain historical, not omnisciently refreshed.

Producers must project deliberately visible mechanisms from real physical data.
Do not expose solution codes, secret correctness tests, private thoughts,
unread message content, global completion flags or hidden component internals.
The type system constrains shape, not the semantic privacy of a bad producer.

## Planning admission

`formatObservableConditions` intersects the current local public catalog with
the actor's retained observed fields. It prints exact identities, slots and
allowed values, with last-known values taken only from working memory. Proposal
validation rejects invented slots and values before storing a plan. A subject
with declared fields cannot substitute composed `ObjectState.current` prose for
a typed condition; legacy packages without fields retain their older contract.

Stored conditions bind the known stable subject identity before earlier steps
run. An armed typed barrier also binds its package and field schema. Losing that
local contract, changing its type/domain or replacing the package causes
reconsideration, never success. Actual component changes still require fresh
owned observation evidence. A schema/catalog read alone cannot satisfy a wait.
This deliberately local first version does not support remotely armed typed
conditions or learn conditional episodes as flat behavior macros.
