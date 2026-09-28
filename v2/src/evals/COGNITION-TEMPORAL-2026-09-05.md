# Cognition and temporal foundations — 5 September 2026

Historical first-pass report. The subsequent shared action/voice scheduler,
partial hearing, migration audit and new live pair are documented in
[the follow-up report](COGNITION-TEMPORAL-LIVE-2026-09-05.md).

## Scope

This pass follows the completed 12-trial overnight campaign. It changes temporal
semantics and foreground admission, and verifies them offline. It does not
extend the campaign, resume its paused schedule, call live models, start H3/FAL,
or claim a newly measured autonomous escape time.

The previous successful live pair remains evidence for the previous source
version. Finite speech changes the puzzle's communication cost; the old 105s
and 121.5s escape times must not be advertised as results of this implementation.

## Implemented

### One physical clock

The library now advances authoritative accumulated simulation milliseconds once
per tick. Variable deltas, calendar progression and God's calendar projection
agree. Acceleration is explicit; pause, slow inference and wall-clock jumps do
not silently advance physics. `sim.step(deltaMs)` provides an exact in-world
step, distinct from wall-time model deadlines.

Native movement and the canonical NeedsDecay template now integrate duration.
Throttled physical systems receive accumulated deltas. Package fixture advances
share the same clock without double-counting runtime ticks. The phone physics
hook uses its supplied delta rather than an unconditional 1,000ms increment.

### Finite speech

Library speech defaults to a finite utterance. Pending words do not enter other
characters' social memory or stimulus queues. Complete-turn evidence is admitted
only after the in-world duration, to eligible listeners. The exact operation
holds the plan cursor until completion. Interruption, cancellation, deleted or
replaced actors/rooms, and stale package generations cannot manufacture delivery.

Speaking is observable without exposing its future script. It reserves the actor
in this first version, leaving world physics and background reasoning active.
Native walking cannot quietly continue underneath it or bank motion credit.
Completed speech stores start/deadline/commit simulation times separately from
existing evidence timestamps. Timed dialogue age and question/response windows
use lived time, not API elapsed time.

### Fresh thoughts without starving valid actions

Model return is now preparation, not a cognitive commit. The executor separately
checks an independently grounded physical command and its accompanying mental
update. An unrelated changed scene can invalidate the thought, ancillary goal,
reviews, attention acknowledgment and conversation entry without cancelling an
otherwise valid physical action. Rejected reasoning is not passed into learning.

Commands dependent on a new intention or undertaking remain indivisible: stale
or invalid bindings reject the entire proposal. Goal/review preparation allocates
no live goal and publishes no coordination claim. Existing work ownership and
goal episodes are rechecked at dispatch. Notification hooks are not admission
authorities. Published completion criteria are defensively copied and checked
again before their prepared identities can commit.

### Quiet evidence waits

An unchanged actor awaiting specific evidence yields until meaningful local
change or the actual bounded simulation deadline. New speech, typed physical
state changes, critical needs and executable plan changes still wake cognition.
Revision-only memory refreshes and engine-generated barrier bookkeeping no
longer masquerade as new situations.

Other actors cannot erase an expired owner's token before the owner consumes
its timeout. Retention stays bounded per actor. A timeout requests reconsideration;
it never proves that the waited-for premise became true.

## Verification

The final frozen run passed **180 suites and 2,169 tests**, with 10 existing
opt-in tests skipped. Typecheck and whitespace validation were clean. The sorted
TypeScript source/test SHA-256 stayed unchanged before and after this run:
`6308de27c21702c33c6766e054fedb8230d37148fa2deb8403511d1bf9c7bca7`.

Additional deterministic pressure suite: **8/8 cases passed** with seeds
7, 19 and 42, 128 entities and 200 ticks per coupled-physics run. That is 614,400
independent field assertions across the three physics oracles, plus mutation
overload isolation, stale-write/intervention checks, wrong-physics rejection,
12-NPC scarce-item contention, and coding-worker timeout/recovery/request storms.
Those are systems/physical safety measurements, not live model cognition scores.

Artifacts: `stress-test-output/pressure-2026-09-05T18-16-08-398Z/results.json`.
Host dispatch-and-commit p95 was approximately 1.05–2.12ms in the coupled cases;
this excludes separate worker execution and all model/video inference.

The first pressure attempt exposed an outdated fixture expecting a worker
deadline to be classified as `cancelled`. The existing daemon contract correctly
classifies timeout as `rejected`, reserving cancellation for explicit stop.
The fixture now checks the exact timeout reason and has a unit regression;
no daemon acceptance rule was relaxed to obtain the passing rerun.

## Not yet proven or complete

- No new live-model trial has tested whether these changes reduce repeated
  dialogue or improve autonomous coordination. Infrastructure regressions are
  necessary but not evidence that cognition is now “golden.”
- Finite speech uses a conservative sampled whole-utterance model. Simultaneous
  walking/talking, partial hearing and exact ordering inside large physics steps
  need a resource-aware action scheduler/shared deadline mechanism.
- Some legacy actions remain atomic, and old generated per-invocation systems,
  goal lifecycle deadlines and memory-age consumers need their own time audit.
- Freshness does not establish semantic truth. Invented causal explanations and
  completion criteria for unfinished promises still need quality evaluation.
- No general committed-interval renderer adapter or new H3 lag measurement was
  implemented. The required source-window and playhead contract is described in
  [Temporal semantics](../architecture/TEMPORAL-SEMANTICS.md).

Next bounded evaluation: run both escape topologies with finite speech enabled,
measure real decision latency separately from lived action time, and check that
heard clues and cooperation remain causally ordered before reconnecting H3.
