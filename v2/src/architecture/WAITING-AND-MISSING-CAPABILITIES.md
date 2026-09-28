# Waiting, expectation and missing world capabilities

Evidence: activity-resumption-diagnostic-01, recording
`sitcom-logistics-boyfriend-7MZjo4`. Departure is physically verified; reaching
dinner is not. At63.5s Elaine narrates catching a cab. The personally visible Street
description offers distant traffic and a route back to the Hallway, but no taxi,
restaurant or executable onward travel mechanism. Waiting roughly40seconds for
a hypothetical taxi is not by itself proof of unreasonable human behavior. Do not
impose an arbitrary impatience deadline or invent transportation to satisfy it.

There is, however, a concrete control mismatch. At63.5s goal24's active plan205
waits for `Observable.unread_notification=true` on her phone, with15secondtimeout.
At104.5s that plan has failed and another phone-notification wait plan41 has failed.
Neither is the narrated expectation of a cab. Existing foreground `wait` has no
explicit expected-event contract. Background plan conditions can consequently be
mistaken for the meaning of the actor's current wait. Idle readiness also consults
the highest active goal's evidence wait, rather than an explicit actor-selected
waiting contract. This needs a focused production regression and design repair;
do not call the timing instrumentation below a solution to this mismatch.

## Implemented: elapsed waiting experience

`wait-experience.ts` records acknowledged wait choices and their simulation-time
start. It does not schedule an event, infer silence/no change, advance a goal,
reserve resources, enforce a minimum wait, or alter model admission cadence.
Repeated waits retain the interval across paraphrases of the same selected goal
and ongoing activity. Other actions, changed goals/activities, room, actor, source,
adapter lifetime and clock reversal invalidate it. Pending/failed work is not a
completed wait. Live body occupation hides the old timing record.

This is in-session, owner-fenced runtime observation—not a serialized lease or
long-term autobiography. Restore begins a new interval. The actor context now
exposes elapsed simulation time and wait-choice count, explicitly distinguished
from proof that an expected event is scheduled or will occur. Episode diagnostics
capture it separately from narrated thought.

## Next requirements

### Scheduling ownership fence implemented

A production idle-readiness regression reproduced an ordinary actor wait being
held until an unrelated background plan's10seconddeadline instead of reaching
its own2secondquiet reconsideration. `idle-cognition.ts` now applies borrowed
plan-barrier pacing only to legacy plan-only actors without CognitiveControl.
Actor-controlled ordinary waits retain their ordinary backoff/listening behavior,
not a background predicate's deadline. This is a negative authority fence, NOT
the completed actor-owned waiting-condition feature below.

### Positive actor-choice path still required

Implementation checkpoint: `action.waitUntil` now accepts a grounded PlanWaitUntil
on wait only, mutually exclusive with listeningTo. `prepareActorWait` validates
schema/grounding and captures actor/source/adapter/visible-target/evidence basis;
foreground response and dispatch recheck it, and the exact-action fingerprint
includes the chosen condition. Executor direct calls recheck grounding too.
`recordActorWait` arms the runtime barrier only at acknowledged execution. Repeated
same-condition choices retain an unexpired deadline; failed/pending/non-wait or
ordinary wait clears it. Readiness uses this actor-owned timer; new perceptions,
memory, urgent needs and changed state keep their normal wake precedence. Actor
context/episode frames expose the chosen condition and reconsideration status,
never a runtime barrier ID or a claim that the expected event is guaranteed.

Implicit actor-controlled plan wait arming is now blocked in getNextPlannedAction.
IMPORTANT REMAINING: no bridge yet credits a fulfilled actor-selected condition
to a matching plan wait step; a condition/time-out does not automatically advance
that plan or its successors. Need explicit plan identity/condition binding and
verified evidence if such advancement is implemented. Also cover already-observed
matching conditions, token lifecycle/restore/cancellation, and stale selected
conditions across async callbacks before calling the positive path complete.
Five new controller/executor tests cover arm-after-execution, deadline readiness,
tampering, invented fields, new observed value and same-name target replacement.

Lifecycle checkpoint:9additional tests now cover same-choice deadline retention,
failed/pending cancellation, ordinary-wait replacement, source/owner replacement,
same-adapter re-registration, restore, already-observable matching state and stale
matching memory. The already-matching-state test reproduced a needless timeout.
Physical wait execution now captures a fresh scoped WorkingMemoryObservation and
uses evaluatePlanEvidenceBarrier. Terminal evidence results prompt reconsideration
immediately; a stale matching memory cannot override a current nonmatching state.
Actor/target/source/adapter identity is checked across that observation; the
evidence basis is then refreshed for continued waiting. Readiness remains a pure
probe and never samples/consumes observations. No plan/goal advancement added.

Subsequent wait→plan bridge: captureActorWaitPlan records the selected goal identity
and definition, continuation revision, original plan identity/definition/cursor,
and matching normalized physical condition at issuance. Evaluator results receive
runtime authenticity metadata (world/actor/source/scope/condition/exact content).
Only the original unmodified satisfied result can credit the captured cursor;
copied or fabricated objects, another wait/actor, timeout, changed plan/goal/choice
cannot. The plan receives an evidence_barrier resolution and advances once via
its existing private evidence gate; Goal success is not changed.

settleActorWait runs at foreground control admission, not readiness polling. It
observes/evaluates the selected condition and may credit that original plan before
the next action is considered through ordinary executor checks. Explicit renewed
choice may refresh plan binding while retaining its unexpired wait deadline;
background replacement alone cannot do so. Automatic postcondition execution is
still subject to selected-purpose, physical prerequisites and fresh-decision gates.
Focused proof/ownership tests pass; repeated live behavior remains unverified.

Reuse `groundPlanEvidenceCondition`, `issuePlanEvidenceBarrier` and existing
personally observed public field contracts. Offer a typed condition as an optional
explicit action choice, distinct from ordinary wait and listeningTo. It must be
validated at both response admission and dispatch, included in the action's exact
fingerprint, and armed only after actual accepted wait execution. Store the chosen
barrier with its actor/source/target generation and bounded reconsideration time;
readiness may consult that chosen condition, never infer it from highest goal.
Do not accept an unvalidated model-provided runtime barrier ID. Restore must retain
no live token. Timeouts invite reconsideration; they do not claim an event occurred.
Audit getNextPlannedAction's implicit wait-barrier arming at the same time, not just
the scheduler: a selected goal is not evidence that an ordinary wait means the
background plan's particular predicate. Add end-to-end tests for chosen condition,
new evidence, timeout, wrong owner, source/target replacement, and stale completion.

1. Bind an actor's deliberate waiting condition to the actor's choice, rather than
   silently borrowing a background plan's convenient observable predicate.
2. Ground conditions in personally observed entities, current jobs, heard promises,
   or clearly labeled uncertain expectations. A heard promise is not a guaranteed
   scheduled callback. Absence of a visible taxi is not global proof that none exists.
3. New evidence and chosen reconsideration deadlines wake reasoning; a timeout
   does not mandate abandonment, a reply, anger, or success.
4. When planning identifies a missing executable capability, surface a grounded
   proposal for God/spirit/engineering review. Keep actor uncertainty separate
   from operator knowledge of installed world systems. No automatic creation of
   everything an NPC imagines, and no taxi-specific control rule.
5. Verify repeated behavior and no-H3 projection independently. Existing offline
   performance-overflow failure remains preserved and blocks H3 readiness.
