# Current local evidence, not remembered occupancy

The actor-owned working-memory ledger intentionally retains last-known facts when
someone leaves view. It cannot answer whether that person is still here now. A
background reflection can also finish during a long physical operation, without
another foreground perception refreshing that ledger. Trial8's current reflection
treated an earlier local location and generic `idle` state as present co-location.

`captureCognitiveLocalView` is an explicit sensing boundary before model context
assembly. It admits normal local observations and snapshots present visible
membership, public body activity, object state, authored Boolean/enum fields,
current room/own public fields, own body occupancy, and public one-step routes.
It allocates identity for observed entities and explicitly declared route rooms,
never remote contents. People have public physical activity instead of generic
Agent ObjectState (which can be a stale mental mode). Blind agents see no people's
presence or visual state; their own tangible inventory/body remains available.
Both the observation ledger and generated people stimuli omit generic Agent
ObjectState; an absent public-activity hook supplies no inferred `idle` claim.
Authored public instrument fields and physical non-agent state remain available.

`formatCognitiveLocalView` is a pure immutable projection. `isCognitiveLocalViewCurrent`
is a pure actor/world/identity-bound freshness comparison: no memory writes, fresh
receipts, body mutations or queries about remote destinations. Package/producer
lifetimes and public schema changes retire a draft. Clone/replay into another
actor/world supplies no authority. Endpoint comparisons do not detect an unseen
change-and-reversal cycle. Broken projection functions fail closed.
Visible activity binds the actual observed target identity, not just its label;
hidden targets remain unbound. Reordering an unchanged set of peers or public
fields does not count as a physical change.

Legacy foreground nonphysical decisions (including waiting/thinking/speech) use the full
local-view fence before committing cognitive side effects; their rejected drafts
use the existing non-executable discard sentinel. Physical decisions retain their
narrow selected-target guard to avoid discarding useful work on unrelated changes.
This is conservative admission, not semantic entailment of a thought. An unchanged
unavailable action is still an actual bad choice for the executor to reject.

The continuing-actor `control` protocol instead selects exact IDs from this
issued view as dependencies of the immediate action. Actor/source/room/sensory
identity remains mandatory; unrelated entities' activity need not be unchanged.
Historical interpretations have an explicit observation time and no authority
to certify current physical facts. See [ACTOR-CONTROLLER.md](ACTOR-CONTROLLER.md).

Reflection current/legacy insights and questions require the same original local
view at generation return and storage. Historical exact-cited interpretations
remain independent of unrelated current-view changes and explicitly retrospective.
The fresh view is distinct from retained historical memory in both prompt paths.
Old rolling full senses frames are omitted from foreground prompt projection;
distinct speech, attention and execution events remain intact in memory/history.

Visibility must be enforced at evidence admission, not only presentation. The
shared observation boundary now uses strict observable surfaces, excluding hidden
objects and opaque/foreign container contents even if a package lists them. Tests
check the whole resulting ledger and model context, not just the visible panel.

This adds no inference call and no puzzle-name rules. It does not guarantee that
a model will correctly integrate all fresh evidence. Trial8's knowingly unavailable
keypad attempt is a separate sensemaking defect; clearer current-state projection
is a structural improvement to evaluate, not a proven cure for that decision.
