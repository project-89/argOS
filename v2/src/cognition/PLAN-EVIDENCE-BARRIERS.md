# Typed evidence barriers for stored plans

A successful `wait` body action says only that time passed. It does not prove the
next step's prerequisite. In escape-room trial 3 a stored plan waited at 69.5s
for another character to read a display, then switched away its power at 70s;
the first actual read happened at 72s. This boundary addresses that generalized
failure without recognizing puzzle names or phrases such as “until done.”

## Contract

`plan-evidence-barrier.ts` accepts only two bounded conditions:

- `physical_fact`: one actor-known subject, typed `state`, `location`, or
  `possession` predicate, optional known slot, and exact expected value.
- `heard_evidence`: a newly heard event, optionally filtered by its attributed
  speaker label. Its contents are never semantically classified as completion.

Timeout defaults to 15 seconds and must be between 1 and 60 seconds. Invalid,
free-text, compound, unknown-field, and malformed conditions are rejected rather
than silently weakened. A state value may describe a future state, but the
subject and slot must already exist in this actor's physical working memory.
Ambiguous labels are rejected; location destinations bind to a unique known
stable identity. Inspection prose is not a physical success predicate.

## Integration

1. Validate/copy model `waitUntil` with `copyPlanWaitUntil`.
2. On entry to the **current foreground wait step**, call
   `issuePlanEvidenceBarrier(world, actor, condition, scopeKey, nowMs?)`.
   `scopeKey` identifies the immutable plan generation and step, not a goal name.
3. Capture current local perception **after issuance** and call
   `evaluatePlanEvidenceBarrier(world, actor, token, scopeKey, {nowMs?, observation?})`.
   Do not do this in readiness probes or background planning. A snapshot is
   actor/world-bound, latest-only, synchronous, and consumed once; it cannot also
   be consumed by a second verifier.
4. `waiting` leaves the plan at its barrier. `satisfied` permits the planner to
   consider the successor, subject to all ordinary current execution guards.
   `reconsider` requests cognition; it never completes the semantic premise or
   authorizes the next stored physical action.
5. Explicitly retire interrupted/replaced steps with
   `discardPlanEvidenceBarrier(world, actor, token, scopeKey)`.

All terminal evaluations retire the token. Repeating one returns
`reconsider/invalid_barrier`. A token is an opaque frozen ID backed by private,
immutable world/actor/step issuance metadata. JSON round-trips within the same
live world are supported, but restore in another world/process cannot recreate
authority; cognition must reconsider. A missing or unsupported conditional wait
must terminate the safely executable plan prefix, not become an ordinary
successful action. The planner owns that conservative fallback.

## Evidence, not global truth

Evaluation reads the actor's own physical working memory and actual heard-event
ledger. It never queries the present ECS state of a target or another actor's
memory. Old matching memory alone is insufficient: physical satisfaction needs a
newly admitted source after issuance, or a genuine local observation captured
after the monotonic observation issuance fence. The fresh snapshot permits an
already-true visible condition without manufacturing a new serialized receipt
on every tick. Moving away never refreshes a remote fact.

For a slot, newest evidence wins. A newer contradictory observation blocks an
older matching result; contradictory equal-time sources request reconsideration,
including receipts hidden by the ledger's deterministic source-ID tie break.
Failed action proposals have no admitted physical facts and cannot provide proof.

New speech can wake either mode, but only returns `reconsider/new_heard_evidence`.
“I did it,” a promise, a thought, or a code spoken aloud is not physical proof.
The foreground mind may reason about what was said and choose a new action. No
free-form claim can automatically authorize the old plan's dangerous successor.
Timeout, clock reversal, actor identity replacement, wrong scope, and replay also
reconsider. Expired/dead-actor records are swept on issuance, and retained tokens
are capped at 64 per actor.

## Deliberate limits

This is one typed fact, not a semantic theorem prover, generic condition language,
or multi-room hypothetical planner. It does not verify completion of someone
else's undertaking from their speech. Speaker filters are attributed names, not
proof of a particular person's authority. Correctness depends on the existing
executor/perception admission boundaries owning physical facts; it does not
defend against arbitrary trusted code corrupting those ledgers.

Focused offline regressions cover schema boundaries, same-tick ordering, old and
failed evidence, equal-time conflicts, sensory/privacy boundaries, single-use
snapshots, pre-issuance snapshot reuse, heard/own/remote speech, identity/scope
fences, explicit retirement, bounded cleanup, and no model calls.

## Planner and procedural boundaries

The planner strips model-provided scope/token/resolution metadata and assigns a
new episode/step scope. `advancePlanStep` cannot advance any wait via a native
action acknowledgement. Pending conditions yield to ordinary foreground cognition
and hide their speculative successors from current instructions. Bare and heard
waits end the stored prefix; a new response must be interpreted deliberately.
Post-barrier inspection is performed again, not covered by a pre-barrier cache.

The existing flat procedure format cannot preserve these conditions. Conditional
episodes therefore do not compile into flat macros, even through an earlier
completed-plan fallback. This is a deliberate conservative learning limit, not a
claim that conditional behavior-tree learning is complete. Ordinary native waits
outside conditional plans remain valid actions, and unconditional verified
episodes still learn/replay in the sustained regression.
