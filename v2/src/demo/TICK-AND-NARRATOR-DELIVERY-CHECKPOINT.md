# Tick cost, queue pressure and Narrator delivery — 2026-09-27

Follow-up to [Narrator timing](NARRATOR-TIMING-CHECKPOINT.md). This pass uses
the existing `town-crisis-live-of3NLe` recording and provider-free fixtures.
**No paid retry, H3, model change, new controller or restart of port 51090.**
Existing dirty-worktree changes were preserved. The ten-trial baseline and
ten-minute endurance requirements remain open, unchanged.

Evidence bundle: `recordings/town-tick-advice-offline-mHjxWp`. Root working
directory: `/tmp/argos-tick-advice.Ov2fls`. Failed tests and unfavorable timing
measurements are retained, not replaced by green outcomes.

## Findings

### Tick cost is mostly repeated projection, not character movement

The new `spatial-native-profile.ts` profiles a ten-resident town with AI
disabled and provider calls forbidden. It can load the recorded working-memory
volume and synthetic public-log volume into an isolated fixture. This is **not
a save restore or behavioral replay**: historical memory IDs remain historical.
Manual mode isolates world advancement, ActorControl and thought publication;
runtime mode includes the library's fast-loop wrappers, emotion/appearance
emission, enrollment and monitoring. Both omit live model/queue contention.

In the first 100-step manual profile, ActorControl took 1,251.5ms of 1,465.9ms
elapsed. Its cognition-readiness signature and sensory/affordance generation
dominated the sampled stack. Foreground decision fencing, world surfaces,
movement-target/path projections and repeated memory parsing remain meaningful
costs. Sampled inclusive stack times overlap and must not be added together.

Adding 800 public events exposed another unnecessary cost: lifecycle checks
read and copied the public event history just to check source ID and stopped
status. Roughly 213ms of sampled self time was spent in the history reader and
its filter in that fixture. The event tape itself is bounded; this is repeated
work over retained history, not evidence of an unbounded log.

### Reasoning lanes were nearly saturated

In the saved live trial, completed foreground work occupied about **97.9%** of
its two-slot capacity; subconscious work occupied about **96.7%** of its two-slot
capacity. The denominator is approximately 300.139 wall seconds times two
slots. These are executor-slot occupancy measurements, not CPU utilization or
pure provider time; incomplete work is excluded. They explain why bursty new
requests accumulated even though the model's typical response was short.

Maximum foreground queue wait was 12.64s; subconscious wait was 36.52s. The
Narrator's spirit lane waited at most 704ms, so its limited intervention was
not simply queue starvation. The runtime also completed 5,365 general
background wrappers, 4,342 within 1ms: substantial short-wrapper and scheduling
churn, but that lane does not own the reserved foreground/subconscious slots.
A short duration alone does not prove a no-op; cheap routing or validation can
be useful. Its CPU impact was not isolated.
The audit did not establish a broken fairness policy.

## Mechanical repairs

1. Added `getCommittedSource`, a constant-time, detached read of source status.
   It does not create a source, scan events, cache across ticks or grant execution
   authority. Metadata-only reads in foreground cognition/admission,
   continuation, idle readiness, thought publication and health now use it.
   Real event readers retain their existing cursor and gap semantics.
2. Coordination readiness reuses one synchronous communication snapshot rather
   than decoding it repeatedly. In-flight work exits before decoding; a quiet
   actor avoids an unnecessary batch hash. The full retry key still includes
   all communications, goal state and coordination revision. No review cadence,
   queue capacity or decision policy changed.
3. Native appearance/public-activity membership checks use the existing fresh
   single-target visibility predicate instead of enumerating every unrelated
   surface. Custom visibility providers retain their full projection and
   mutation defenses. No cross-tick visibility or memory cache was introduced.

The isolated coordination probe improved from 70.77 to 29.44 microseconds per
pending check and 73.56 to 23.83 per quiet check. Operation-count regressions
also verify that unrelated native surfaces are no longer queried by the
membership-only paths. These are local improvements, **not a measured live
simulation speedup**.

### Timing evidence, including the non-improvement

| Fixture | Observed result | Limitation |
| --- | --- | --- |
| Manual, 100 steps, recorded memory, no synthetic history | 1,465.9ms elapsed; ActorControl p95 20.64ms | Accelerated synchronous fixture |
| Manual, plus 800 public events, before status repair | 1,821.9ms elapsed; ActorControl p95 23.86ms | Single measurement |
| Manual, after status repair, other mechanical edits landing | 2,087.5ms elapsed; ActorControl p95 27.68ms | Aggregate result did **not** improve; no causal performance claim |
| Full native runtime, 80 steps, recorded memory and 800 events | 8.000 simulated / 8.196 wall seconds; 0 fetches | AI disabled; not live throughput |
| Existing moving-town timing gate, after repairs | 0.957x pace; tick-gap p95 102.73ms; tick CPU p95 19.34ms | Eight-second native test, not endurance |

The existing moving-town gate retained its thresholds, ten moving actors,
geometry edit, source identity and zero-provider requirement. Cold-start
DayPlanPreplanner was the largest single native system cost (82.48ms) in that
test; SpatialEmbodiment was not the dominant hotspot. No simulation time was
fabricated or accelerated to conceal slow wall time.

## Narrator: corrected trace of the actual live run

**Correction to the previous checkpoint:** advice did reach Otis. The original
audit searched foreground `contents` but missed the private context in
`systemInstruction`. The old run used the **direct** perception fallback, not
the daemon queue. Town initialization currently registers the nudge daemon
bridge only when the separate narrative engine is enabled; this pass does not
change that wiring or retrospectively attribute the run to the queued route.

| Stage | Simulation time | Evidence |
| --- | ---: | --- |
| Narrator captured its input | 214.0s | Provider request 497 |
| Otis independently formed the matching departure goal | 214.7s | Chronicle goal creation |
| Advice accepted and injected directly | 221.1s | Accepted review and terminal route log |
| Exact advice included in Otis's foreground context | 226.7s | Request 529, `systemInstruction`, recent perceptions |
| Model selected the matching move | 227.7s | Request 529 response |
| Native movement began | 229.6s | Pending movement receipt |
| Session stopped before arrival | 244.7s | Failed movement receipt, session stopped |

Thus transport and prompt inclusion are demonstrated. A matching action
followed, but the same goal existed before the advice: **a Narrator-caused
change of mind or completed arrival is not demonstrated**. No physical event
was created by the nudge. Exact IDs and artifact locations are retained in
`narrator/narrator-delivery-audit.md` within the evidence bundle.

### Separate daemon delivery repair

An offline regression reproduced a different, real bug: already evaluated
scoped advice waited inside the daemon's slow observation-due loop. Advice
queued immediately after an observation could wait 30 wall seconds and become
stale before conversion. The existing daemon-system invocation now drains
eligible scoped advice independently of whether another observation is due.

This preserves the ordinary whisper cooldown (simulation time in managed
worlds), at-most-two cap, exact source/actor/persona/evidence checks, per-item
validation, cancellation, and legacy backlog boundaries. It does not accelerate
observer model calls, create a new poll, choose a goal or force action. Advice
can still wait for the next daemon-system invocation and an active cooldown.

Both routes now report `narrative_nudge_lifecycle` through the existing archived
chronicle: route, source ID, stable actor key, nudge ID, simulation timestamps
and perception entity ID. Queued advice distinguishes queued, converted,
perception-delivered and dropped. Direct advice reports delivered perception.
Synchronous diagnostic listeners run after perception admission; a listener
that stops the source, changes the identity or cancels work cannot make a later
suggestion cross that boundary. No private advice body is copied into these rows. These are operator diagnostic
records, **not public world facts or proof of behavioral influence**. Chronicle
retention remains process-global; source IDs disambiguate these new rows.

## Verification

- Final integrated selection after all source changes: **496 passed, 23 suites**
  (`profile/final-regressions.log`); final typecheck and scoped whitespace check
  passed. This is a targeted selection, not the entire repository test suite.
- Combined performance/safety regression selection: **273 passed, 14 suites**.
- Existing moving-town timing gate: **passed**, unchanged.
- Source-status regression first failed for the absent API; subsequent source,
  actor-controller and thought-publication selection: **138 passed**.
- Coordination readiness/scheduler/memory/settlement selection: **58 passed**.
- Appearance/public-activity visibility selection: **120 passed**.
- Initial advice transport test: **1 failed, 26 passed** before repair.
  Direct/queued advice selection subsequently passed **89 tests**. Two further
  red tests reproduced diagnostic-listener reentrancy; after the repair,
  **223 passed across nine related suites**, including source/identity/task
  cancellation boundaries. All stages are retained in the bundle.
- Typecheck passed. Selections overlap; counts are not additive.

Original fixture mistakes are preserved alongside corrected red tests. No
paid/provider run was used to obtain these results. The standalone profile
asserts zero provider calls; raw private memory is neither printed in its
numeric report nor promoted into public events.

## Exact next steps

1. Optimize the remaining repeated sensory/affordance projection **within one
   synchronous evaluation**, with fresh invalidation for raw ECS writes and
   custom hooks. First write count-based and mutation/privacy regressions;
   avoid a cross-tick cache that would miss immediate world changes.
2. Measure which completed reasoning requests contribute usable decisions
   versus superseded/redundant work. Reduce proven duplicate demand before
   changing concurrency. Preserve independent foreground/background roles,
   fairness, single-flight, cancellation and physical timing.
3. Use the same bounded crisis protocol for the next justified live check.
   Trace accepted advice, route, perception delivery, prompt inclusion, chosen
   intent and native outcomes separately; compare the NPC's pre-advice intent
   before claiming an effect. Do not force drama to pass this gate.
4. Continue testing promise completion beyond a conversational opener and
   remote-phone perception honestly. Neither is resolved by this profiling pass.

Useful autonomous storytelling, growth, sustained low latency, ten-trial
repeatability and ten-minute endurance are **not passed** here. The original
user server remains unchanged until deliberately restarted with these sources.
