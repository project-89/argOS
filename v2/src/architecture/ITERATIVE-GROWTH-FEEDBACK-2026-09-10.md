# Continuous growth uses the existing control loop

Argos already has the owners needed for iterative world construction. This pass does not add a controller or a new model pass.

1. NPC goals, ongoing commitments, plans and selected actions supply author-scoped demand. Native perception/action failures and current inventories show what is actually available.
2. The tick-driven, single-flight evolution coordinator revisits Weaver. Weaver compares those demands with place support, pending construction, managed jobs and runtime health. It may propose an entity, a component or a managed system; no change is also valid.
3. The need author declares a minimum support contract. The existing designer can append `additionalSupportRequirements` to cover more of the full cited purpose. A redundant full `supportRequirements` echo is also accepted only when it preserves every original requirement unchanged. Original IDs and requirements cannot be replaced or weakened. `unresolvedSupport` can explicitly defer a design that cannot yet provide the needed capability.
4. The native validator checks the combined contract, including real existing-actor references, components, fields, routes, custody and interactions. The builder retains that contract so later availability checks cover added requirements too. A narrative description cannot discharge it.
5. God reviews observed proposals under restricted authority; the existing builder/managed daemon executes approved work under source, capability and construction budgets. Native NPC use remains a separate outcome.
6. Later cycles observe actual place support, outcomes, depleted stock, system health and failed work. They may improve an existing room or mechanic rather than duplicate a place. Consumption, departure and intentional removal are consequences, not automatic replacement orders.

## Approval context isolation

Proposal review is isolated before model context is assembled. A proposal receipt is not batched with a transient activity report or another independently expiring proposal. Other report work retains the existing bounded batching and priority ordering. All evidence included in any command still has to remain current at every tool boundary; no `some(currentMessage)` fallback, TTL extension, stale completion or authority expansion is introduced. The next normal cycle handles remaining eligible receipts.

## Failure feedback

Previously a design could fail validation before becoming a proposal, leaving only operator diagnostics. The next Weaver cycle had no account of that rejection. There is now a bounded author-only history of those failures, recording the need, rejection category, validation problem and requirement IDs. It is separate from executable evidence: these entries cannot be cited to authorize construction or fulfill NPC intentions.

The history is held per world and actual author object, tied to the original source and author scope, and expires after two minutes of either simulation or wall time. Storage is capped at 20 entries, with at most eight projected per author. Invalidated entries are discarded. Raw model completions, private command bodies and public NPC stimuli are not stored or emitted by this path. It is in-process operational feedback, not a serialized world fact or an automatic retry instruction.

## Limits and validation

Strengthened contracts are structurally checked; interpreting the full purpose still requires model judgment. A model can still omit a capability it never declares, and no schema proves that an NPC will choose to use a place. Live usefulness and native service/consumption remain explicit acceptance gates. Existing direct blueprint callers remain compatible; support amendments are optional author metadata, stripped before ECS materialization.

The ordinary runtime repeats these stages when `evolution`/world maintenance is enabled. The bounded Elaine harness deliberately uses one post-departure probe, with world maintenance disabled; do not describe that test as open-ended autonomous growth. This pass does not silently enable all builders in the UI or expand the evaluation's construction budgets. Existing multi-cycle room-population and managed-system tests remain in readiness, alongside the new rejection → corrected design → approved build → depleted support test.

Evidence: `recordings/growth-feedback-lBKpK6/`. Previous failures remain intact. H3 and model changes are out of scope; ten-trial baseline and ten-minute real/simulated endurance requirements are unchanged.

The first live check in this pass still offered seating only and failed before approval on the redundant contract echo. That response-shape problem was subsequently repaired offline against the exact frozen output. Designer instructions now separate schema metadata from need-phase output instructions and place the full purpose before the long schema catalog. There has been no second live attempt; these changes do not retroactively pass the failed trial or prove meal/service completeness.
