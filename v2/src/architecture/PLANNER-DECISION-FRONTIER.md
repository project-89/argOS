# Planner decision frontier — proposed next repair

Status: implemented, 2026-09-08; offline/regression verified, NOT behaviorally accepted.
PlanningDecision ECS component + awaiting_decision Plan status, separate from
executable steps; bounded actor review in existing foreground transaction.
31new tests; full330suites4508passes/10skips and types clean.
Completed diagnostics: recordings/cognition-baseline-frontier-diag-01.Ch3DY2.
S2/S5 bothbehaviorFAIL with cleanruntime. Frontiershown33/37times,zeroreviews;
it survives but does not cure the activity/value-selection loop. No acceptance.
Independent mental choice commits at response; native body execution remains
separately fenced. A valid earlier thought is history, not rolled back when
later physical dispatch becomes stale. See that folder's implementation notes.
Evidence: baseline06/S2 requests29→31,40→43,53→55,64→67,74→76 and
recordings/cognition-baseline-06.o3tyte/behavioral-cause-notes.md.

## The missing contract

Background planning correctly lacks authority to send a fresh personal message.
Currently its proposed reply is rejected; the retry substitutes a generic
assessment. That assessment may finish without preserving the concrete decision
the foreground still needs to make. Repeated thinking is neither a reply nor a
deliberate refusal. Making the stored message executable would cross the wrong
authority boundary.

Keep these distinct:

1. A planner proposes how an actor might pursue an intention.
2. The actor chooses, revises, defers or rejects the proposed next decision.
3. The native executor admits and performs the chosen action.
4. Actual receipts establish effects; goal success remains separate.

## Smallest useful representation

A typed, non-executable decision frontier at the end of the understood plan
prefix. Retain actor/goal/plan episode identity, proposed purpose, personally
known target identity, action family and command name. Do not store automatically
executable dialogue, arguments based on unread information, invented responses,
or predicted completion as a frontier payload.

The prefix can be empty: an immediately needed fresh decision should not require
inventing an executable `think` step. No automatic successor may cross it. A
proposal to read unknown information ends before the reaction to that reading.

Reuse ECS Plan/Goal identity and existing source/ownership/dependency fences.
Choose the precise representation after auditing every planner/BT/procedure
consumer: do not add a marker that an older executor silently ignores. A separate
proposal component may be safer than masquerading as an executable PlanStep.
Persistence retains context, never execution grants; restore needs revalidation.

## Foreground handoff

Show the proposal in the existing decision context when its understood prefix
is actually reached. It is an option, not a queued action or mandatory reply.
The foreground can choose fresh words and arguments, continue other work, defer,
revise or reject it. Bind that review to the captured frontier episode so late
responses cannot consume a replacement proposal.

Choosing an action is not its completion. Retire/resolve a frontier only under
the explicitly defined actor-review or native-receipt transition. A random
action carrying the same goalId is not evidence that the proposed work happened.
No elapsed-tick automatic discharge, repeated planner-call polling, forced
emotion, or mandatory reaction to a particular message category.

Conversation can be worthwhile without advancing a practical goal. Review its
own value separately from progress on the organizing intention; do not let
`hear another joke` quietly become evidence of `contact the absent person`.
The engine can expose elapsed experience and actual receipts. Semantic appraisal
is the actor's interpretation, not an engine-certified psychological truth.

## Verification before another acceptance cohort

- Offline: fresh-decision proposal survives without authored text auto-executing;
  prerequisite prefix progresses with real receipts; immediate frontier requires
  no fictional think; unread contents remain private; changed target/source/goal,
  restored state and stale results cannot authorize or consume an old decision.
- Exercise all action routes: foreground selection, background plan selector,
  deterministic controller, BT/procedural compilation, reconciliation and restore.
  A declined/deferred proposal is not a completed goal, and ordinary physical
  plans retain their native behavior.
- Prospective bounded no-H3 diagnostics for S2/S5 and coordination-heavy P1/P5.
  Separate diagnostics from acceptance; retain failed outcomes and original
  privacy/physical/latency/resource constraints. No hand-selected winning seed.
- After repair validation, predeclare a fresh ten-case cohort with the original
  >=8/10, per-world/pooled all-outcome p95<=5s and integrity gates. Only an accepted
  cohort permits the separate actual600wall/>=600sim-second endurance run.

This design addresses a specific lost handoff. It does not establish that all
banter, emotional realism, generated-world expansion or rendering is solved.
