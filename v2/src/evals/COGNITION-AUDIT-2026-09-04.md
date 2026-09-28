# Cognition first: engine audit and subconscious split

Scope: native cognition, planning, grounded action execution, perception, memory,
goal evaluation, and their scheduling. No H3 runs, rendering changes, or external
messages. The phone demo's earlier integration checks are documented separately in
[`src/demo/COGNITION-EVAL.md`](../demo/COGNITION-EVAL.md).

## What changed

- **Immediate decisions no longer await slow faculties.** `agentThink` does not
  await image critique or autonomous goal formation. `runCognitionCycle` does not
  await planning unless explicitly requested for batch use. The live library
  entry point enrolls foreground cognition and subconscious jobs per actor.
- **Reserved capacity.** Foreground has two slots, subconscious two, and world
  orchestration three. A held builder cannot occupy a decision/planning slot.
  Readiness is rechecked when a queued job starts. Planning can infer while an
  actor walks; optional subconscious faculties yield between operations.
- **Bounded inference.** Immediate decisions use an 8s request deadline. Native
  physical planning uses 10s requests, low thinking, a focused physical-planning
  prompt, and at most one explicit semantic-repair retry. Goal formation uses
  10s; reflection/optional image critique use 12s. SDK retries are disabled for
  these calls. Provider cancellation is cooperative, not a hard OS preemption.
- **Plans are proposals, not facts.** Late plans are rejected after changed
  ownership, goals, room, priorities, or visible capabilities. Duplicate planning
  requests coalesce. Completed-but-unsatisfied plans can replan. Failed physical
  plans retry after 2s; empty generation failures retain a 15s backoff.
- **Progress is not age.** Autonomous goal failures back off for at least five
  wall-clock seconds even at high tick rates. Goal expiry tracks inactivity,
  renewed by genuine goal/owned-plan progress, rather than expiring every goal
  two minutes after creation. Restored progress gets bounded grace.
- **Execution proof.** Failed pickup/drop/move/use/give/attack/examine no longer
  advances plans. Unsupported mechanics do not report invented success. Core
  outcomes produce `LastAction`; pending tool jobs emit `action_pending` and only
  learn/advance on actual completion. Results are bound to their issuing goal,
  plan and step. An operator changing priorities does not reattribute the result.
- **Goals and learning.** Exhausting even a custom plan is not success. Typed
  verifiers reject stale/misattributed tool evidence and missing artifacts.
  Goal contract mutation invalidates signatures. Verified learning no longer
  records intentions as executed actions or credits all active goals at once.
- **Perception boundaries.** No remote NPC danger/object-location hints through
  the repaired paths. Closed-container contents are withheld. Sensory changes
  invalidate caches. Speech interrupts once; new danger can beat old recovery
  loops. Bounded prompts acknowledge only the signals they actually included.
- **Memory is evidence with a scale.** Native importance is canonical 0–1, with
  explicit legacy-scale support. Recall combines recent and relevant actor-owned
  memories without inflating recall counters every prompt. Historical memory and
  whispers cannot stand in for current observations. Remembering does not
  automatically rewrite the behavior policy.
- **Reflection is connected.** Real episodic/semantic memories feed its trigger;
  derived insights do not feed themselves. Concurrent experiences retain their
  salience. Empty/malformed responses and stale source evidence are rejected.
  Pruning unrelated unused memories does not invalidate useful work.
- **Fresh evidence beside the decision.** Prior action JSON is no longer replayed
  as assistant dialogue. Actual outcomes, new observations, and the highest
  current goal accompany the next decision request. Past thoughts remain explicitly
  historical. Lower-priority plans are projected as deferred, not executable
  instructions while a more urgent plan is pending.

## Deterministic evidence

The final full repository suite passed with **738 tests, 10 skipped, 92 suites**;
TypeScript build and `git diff --check` passed. This is a checkpoint, not a claim
that every passing test was authored in this change. The initial checkpoint was
541 passed, 10 skipped, 78 suites. Existing unrelated worktree changes were kept.

New coverage includes blocked-background/foreground isolation, stale queue
readiness, planning during physical activity, late goal/plan/result rejection,
urgent priority changes, exact action arguments, invalid model output, timeout
admission, attention preservation, perception privacy, relevant recall, memory
scale, reflection lifecycle, and causal puzzle verification.

Deterministic tests mock the model boundary. They prove execution contracts, not
the live model's intelligence. Reflection tests include cancellation, retained
new experiences, corrupt persisted history, empty insights, and pruning while
in flight. Scheduler tests deliberately hold work unresolved.

## Live model evidence: repair puzzle

Configured model: `gemini-3.8-flash`. Four scenarios, no demo scripts controlling
the NPC's decisions: repair, relocated fuse, urgent interruption, false whisper.
The lamp must actually work, the fuse must have one real location, and the typed
verification goal must be satisfied. See [the lab guide](cognition-evaluation.md).

Recorded sequence under `stress-test-output/`:

| Batch | Directory suffix | Result / interpretation |
| --- | --- | --- |
| Baseline | `cognition-2026-09-04T16-07-47-548Z` | 3 scenarios passed; initial repair planning took 14.657s |
| Focused physical planning | `cognition-2026-09-04T16-13-56-967Z` | 12/12 behavioral passes, but one 34.093s decision; unacceptable latency despite eventual success |
| Deadline and latency gates | `cognition-2026-09-04T16-17-20-889Z` | 12/12 behavioral **and latency** passes |

The last batch's repair trials took five actions each, with initial planning
1.500–2.550s. Relocated-fuse trials took 8–9 actions; urgent interruption six;
false whispers five. Maximum per-run cognition-operation p95 was 5.889s and
planning-operation p95 was 6.625s. These metrics include deterministic paths:
they are **not model-only latency statistics or production scheduling latency**.
The latency gates are p95 ≤8.5s cognition and ≤21s planning (two bounded calls).

These 27 runs preceded the final per-actor subconscious wiring. They establish
behavioral improvements in the native engine with batch planning, not by
themselves the new concurrent architecture. Subsequent concurrent results belong
in their own section rather than being retroactively attributed to this batch.

## Concurrent planning: revealing a hidden failure

The first managed-background batch is
`stress-test-output/cognition-2026-09-04T16-37-05-412Z`: **3/4 passed**.
There were 11 foreground decisions completed while planning remained pending,
at most one tracked planner, three stale results discarded and four plans admitted.
Every tracked task settled before teardown. This uses the native planner alongside
cognition, not the production queue; the queue has separate deterministic isolation
tests.

The urgent-interruption case **failed** its response-order gate. With no admitted
plan, Mara took the fuse after the confirmed hazard, attempted installation and
reset with power live, then finally isolated it. Physics rejected both impossible
actions and the goal eventually completed, but eventual completion was not a pass.
Her thoughts asserted that earlier intended operations had succeeded despite the
current observations and failure evidence. This is evidence of a freeform cognition
failure, not a stale-plan execution bug.

Inspection found that old decision JSON was being replayed as assistant history,
with fresh world facts only in the system context before that conversation. The
generic correction removes that self-continuation path, puts current evidence next
to the decision, and ranks the highest-priority goal above routine plans/schedules.
It does not hard-code an isolation action or weaken the hazard gate. It also marks
lower-priority plans deferred when a higher-priority plan is still being generated.

After that correction, the three targeted concurrent emergency repeats in
`stress-test-output/cognition-2026-09-04T16-41-15-512Z` all passed. Each took six
turns: isolate, respond to renewed sparks with isolation, take, install, reset,
verify. None attempted an impossible action. Per-run cognition p95 ranged
1.748–3.702s; planning p95 2.774–3.863s. Eight decisions finished while a planner
remained pending; four stale plans were discarded and three were admitted.

The full four-case concurrent rerun in
`stress-test-output/cognition-2026-09-04T16-41-55-436Z` also passed:

| Scenario | Turns | Case wall time | Cognition operation p95 | Planning operation p95 |
| --- | --- | --- | --- | --- |
| Repair | 5 | 6.10s | 1.72s | 3.26s |
| Relocated fuse | 7 | 15.72s | 3.87s | 11.71s |
| Urgent interruption | 6 | 7.05s | 3.42s | 3.42s |
| False whisper | 5 | 3.52s | 2.52s | 1.50s |

Together, the final **7/7 concurrent runs** completed 41 turns with zero rejected
actions and zero invariant violations, across 61.66s summed case runtime.
Nineteen foreground decisions finished while planning remained pending. Seven
stale results were discarded, five plans admitted, and two terminal pending plans
cancelled and awaited. The longer planning measurement includes the native
planner's bounded repair/retry path. These are short discrete-step trials, not
seven sustained production sessions or population-level latency guarantees.

To reproduce the concurrent matrix (explicit paid cognition calls, no H3):

```sh
npm run eval:cognition:live -- --background-planning --scenario all --trials 3
```

## Remaining limits / next pressure tests

- Small repair puzzles do not prove sustained storytelling, rich social choice,
  cross-session personal memory, or long-horizon multi-NPC autonomy. Next add
  competing social commitments, ambiguous phone requests, delayed consequences,
  and longer simulation-only runs with measured action/goal latency.
- Free-text plan prerequisites are advisory; real action executors enforce the
  physical preconditions. Natural-language custom goals need explicit world
  verifiers. `LastAction` alone cannot prove a historical multi-action conjunction.
- Several advanced modules (enhanced memory, belief revision, consolidation)
  exist but are not all enrolled in the native NPC runtime. This pass does not
  claim they have been activated or evaluated end to end.
- Some caches/queues and learning maps remain process-global. Reserved lanes are
  not proof of full multi-world isolation. Queue stop/name deduplication and its
  exposed per-simulation concurrency configuration still need alignment.
- Priority scheduling is not preemptive: an already-running subconscious request
  keeps its slot until completion/cancellation. Many actors can still queue, and
  low-priority work has no formal starvation guarantee.
- Physical deferred callbacks still lack a generic event nonce; the controlled
  world-package callback is tested, not arbitrary duplicate delivery by third
  parties. Closed carried-container capability inheritance needs a further audit.
- No new evidence here about God/spirit narrative quality, hot system activation,
  phone/video synchronization, or H3 obedience. Keep rendering out of the loop
  until the simulation-only behavior meets its own gates.
