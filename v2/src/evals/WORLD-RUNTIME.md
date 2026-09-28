# Living-world runtime acceptance

The outcome to protect is agency with persistent consequences: an outside message
reaches a physical phone; the NPC perceives it, decides, acts, and only then knows
its contents. A story beat is not permission to undo an operator's world edit.

## Execution boundaries

- Fast ECS ticks admit validated system results and advance physical actions.
  They do not wait for inference, planning, or engineering.
- Foreground cognition has reserved queue capacity. It reacts to current
  observations and can execute a valid deterministic plan or learned procedure.
- Planning, autonomous goals, and reflection use the reserved subconscious lane.
  Existing plans must still satisfy current spatial and capability prerequisites.
- God, spirits, the narrator, and coding daemons work in the background. Generated
  files are candidates until host validation and a tick boundary admit them.
- Narrative preparation is subordinate to live ECS facts. A missing prop in its
  *starting* room is not evidence that the prop needs restoring or duplicating.
- Runtime stop/timeout signals propagate through scoped model calls. Detached
  engineering work owns isolated candidate directories; it cannot commit late.
  Arbitrary in-process spirit code which ignores cancellation cannot safely be
  force-killed. This remains a worker-isolation limitation, not a solved guarantee.

`sim.getRuntimeStatus()` exposes lifetime operation counts, queue-delay maxima,
and the latest 100 duration samples per operation. Queue totals are process-wide;
operation names and cancellation are runtime-scoped. This does not claim that all
legacy global ECS registries support simultaneous independent library worlds.

## Repeatable live soak

```sh
npm run eval:world:live
# Optional: 180–600 seconds. Default 240.
ARGOS_WORLD_SOAK_SECONDS=300 npm run eval:world:live
```

This is an authored house on the production library's dual-loop runtime, not a
mock decision policy. It uses the configured live Gemini models, turns on God,
spirits, narrative direction, plans, and subconscious work, and does not start H3.
The coding daemon uses a unique evaluation directory. Logs cap at 5 MB; evidence
is bounded by the run duration and the phone package's message limit.

The run relocates the phone while Mara approaches, temporarily disconnects it,
sends three message waves, introduces a misleading hunch, and asks for a word from
the first message after a delay. It requests a clock mechanic with independent
positive and protected-entity acceptance tests, then measures real live values.
That specific build is **operator-requested**, not proof of autonomous discovery.
Read messages remain available on the phone: the delayed-word check proves
conversation continuity against a conflicting hunch, not isolated long-term
memory retrieval after removing all external records.

The scorer rejects a stopped world, silent cognition, unread-secret leakage in
the checked contexts/thoughts, out-of-order physical delivery, stale placement
restoration, repeated failed-action loops, missing background progress, or a
generated system which is only registered but does not advance live state.
No single run establishes indefinite health or success for arbitrary seed worlds.
Rejected autonomous build jobs and pending maintenance demand also need inspection;
successful scheduler cycles can include no-op or internally handled failures.

## Baseline which exposed the bugs

`recordings/world-soak-REQL5K/result.json` contains a four-minute pre-fix run:
239 ticks, three read/reply exchanges, delayed `lantern` answer, and decision-cycle
p95 2,396 ms (including deterministic cycles). God/evolution created 27 entities;
the operator's generated clock ran while cognition continued.

It is **not a persistence/quality pass**. The initial scorer omitted two checks:
the narrator moved the relocated phone back to Bedroom, and stale plans attempted
11 physically unavailable actions. Those cases now have explicit regression gates.
The original artifact is retained unchanged, including its overly broad original
`accepted: true`, so the correction is auditable. Two autonomous system builds also
failed with truncated structured output; the clock does not prove those succeeded.

## Post-fix live evidence

`recordings/world-soak-hLy6HG/result.json` passed all 17 stricter gates in 240
seconds: 240 world ticks, phone pickup from the relocated Landing at 39 seconds,
three delivered replies, and `lantern` after the conflicting hunch. The offline
message stayed queued until connectivity returned. No unread-body leak was found
in the checked capability contexts or verification-word thought check.

Decision-cycle p95 was 2,118 ms; maximum 7,350 ms. This distribution includes
deterministic decisions (median 1 ms), so it is not an inference-only benchmark.
Readiness-delay p95 was one second. The longest gap between recorded thoughts was
13 seconds. There was one unavailable action, not the prior repeated failure loop.
The generated clock advanced from 1 to 230 simulation seconds while background
work continued: 63 evolution cycles and 27 reported entity creations. The clock
build is independently tested; these counts do not certify all generated content.

The attempt diagnostics explain the complex autonomous build failures: provider
finish reason `length`, about 11,985 output tokens, of which about 11,520 were
reasoning, leaving too little room for the candidate JSON. This is a separate
engineering-quality failure, despite the simulation staying responsive.

Inspection after this run also found the spirit snapshot omitted quiet physical
props because it enumerated only `StimulusSource`. The observer now includes
`PhysicalObject`, nested/held placement, and real component membership rather than
stale SoA slots. A read-only exact `getEntityLocation` tool exposes current
container/room to God without confusing an object's location with a Room component.
Those observer changes are covered by targeted regressions, not this earlier run.

`recordings/sustained-cognition-live-20260904c/result.json` separately passed all
14 native-planning gates in 18 turns using live Gemini 3.8: two physically verified
service cycles, two emergency responses, rejection of a misleading whisper,
retained memory, and learned-procedure replay/resumption with zero failed actions.
The compiler now learns the successful ECS episode rather than an old completed
partial plan. Ordinary successful action feedback is not urgent attention.
Routine replay took 0–3 ms; fresh first-cycle cognition still had a slow call
(p95 about 8 seconds in this small trial). This is not a universal low-latency claim.

Run that isolated cognition test with `npm run eval:cognition:sustained:live`.
It does not enable God, spirits, coding daemons or video; the four-minute house
soak is the separate evidence for those layers operating together.

The engineering retry now lowers thinking only after provider-confirmed length
truncation, preserving the 12K budget and three-attempt cap. Replaying the failed
DialogueGenerationSystem request produced complete structured output on the next
two attempts. It was still rejected by host validation (ultimately an undeclared
`DialogueEvent` read). More capable arbitrary world generation is therefore **not
yet certified**. No rejected candidate was promoted merely to make the demo pass.
Managed runtime failures now receive one invariant-preserving automatic repair
attempt; an unsuccessful repair remains quarantined rather than retrying forever.

## Gate before prompt-to-simulation and rendering

Final combined regression on this pass: **102 suites passed, 821 tests passed,
10 skipped**, plus clean TypeScript and diff checks. The skipped tests are not
counted as live validation; the paid live probes above are separate evidence.

First stabilize the authored runtime under disruption and maintenance failures.
Then pressure-test the existing `createSimulation(seed)` genesis entry point across
several settings: meaningful placement/connectivity, usable capabilities, grounded
goals, independently tested generated mechanics, and continued repair after entry.
The current nonempty-agent/room/object genesis check is necessary but insufficient.

Only after the generated world is inhabitable should H3 subscribe to its event
stream. The renderer depicts accepted actions and bounded conditional projections;
it does not decide whether an action succeeded, reveal unread messages, or feed a
visually invented outcome back into canonical state.
