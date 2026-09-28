# Planning admission and native possession

Planning telemetry is an operator channel, not an NPC sense. A world package may
implement `AgentWorldCapabilities.onPlanningEvent`. The shared planner sends:

- `requested`: inference actually began (not a readiness poll or coalesced duplicate).
- `validated`: a returned proposal passed the shared validator, at most once per request.
- `admitted`: a concrete Plan entity was installed after source and immediate-action checks.
- `discarded`: the request ended without admission, with a typed reason.

Each request has a world-scoped sequence ID, actor ID, goal ID and event timestamp.
Requested work has exactly one terminal admitted/discarded event when it settles.
An interrupted process can leave a request unfinished; do not report that as success.
Validated proposals can still become stale. Admitted plans have not executed anything.
Retained Plan entities are not a lifetime admission counter. Standalone calls to
`generatePlanForGoal` can expose a final `onOutcome` but do not emit admission events.
Provider semantic repair is one request; validation succeeds only after the final
accepted proposal. Parse errors, invalid proposals and provider exceptions are distinct.

Source discards distinguish actor/goal deletion or revision, movement, visible
capability changes, a new higher priority, replacement plans, heard dialogue, own
speech, working memory, coordination and an unavailable immediate step. The package
observer cannot veto planning by throwing, and telemetry does not enter stimuli,
working memory, dialogue, inner monologue or render prompts.

## Native inventory steps

The stored-action set intersects explicitly grounded planner types with the actor's
shared action registry. `pickup`, `drop` and `give` use their native channels:
pickup/drop target an exact item name; give targets the recipient and puts the exact
item name in content. No invented `interact take` translation is performed.

Whole-plan validation can project only the explicit local possession effects of
preceding pickup/drop/give steps. Thus pickup → give is representable without
pretending that the actor already owns the item. Validation never writes containment
or evidence. Every immediate selected step rechecks actual canonical `LocatedIn`
ownership, inventory capability, unique visible names, takeability, open-container
reach and a visible co-located receiving actor. Seeing another actor's possessions
does not make those items available for pickup. Inventory caches are not ownership.
Runtime capacity limits, world-specific effects and actual success receipts remain
authoritative; an admitted step that fails cannot advance the plan.

This pass does not simulate future travel, unlocks, discoveries, other actors'
cooperation or package-specific effects. It does not add native use/examine/attack
to stored plans. Future availability needs a separate dependency model, not relaxed
immediate execution guards. Goal completion remains independently verified even
after every plan step succeeds.
