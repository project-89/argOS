# Saltmere crisis: offline causal repairs

Date: 2026-09-27. Follow-up to [the failed live stress observation](TOWN-CRISIS-RESULTS.md).

Subsequent work: [Narrator progress and timing checkpoint](NARRATOR-TIMING-CHECKPOINT.md)
records the bounded review/cadence repair and one live retry. This document
retains the earlier offline-only checkpoint; its “no retry” statements describe
that earlier pass, not the current aggregate state.

## Status

Three concrete cognition/evidence defects were repaired without changing the
model, adding a controller, forcing a crisis response, or weakening stale-state
validation. The bounded recorder and stopped inspector were also repaired.
**No live retry was launched.** The original town server was not restarted or
mutated; these changes require a fresh process/session to exercise interactively.

The earlier failed delivery, weak investigation and passive narrative result
remain evidence. Offline correctness is not proof of a compelling autonomous
town, useful growth, or low-latency ten-resident behavior. The ten-trial baseline
and ten-minute endurance requirements remain open and unchanged.

## 1. Initial choice lost during routine installation

The first native world tick previously ran before the asynchronous daily
planner installed fallback schedules. A later tick then projected a scheduled
goal while the first foreground inference was in flight. The existing goal-basis
check correctly discarded the response as `goal_changed`.

The new offline fixture reproduced that rejection using the real simulation
constructor, native world ticks, actual daily schedule system and mocked delayed
foreground inference. This establishes a mechanism consistent with the missing
pickup in the old run; it does not recover that run's missing admission record.

**Repair:** settle deterministic baseline schedules at construction, before
the first tick/cognition, when the daily schedule system is active. Existing
authored schedules are retained. Restores are excluded from this initialization;
no model call or artificial passage of time is added.

**Verification:** an initial chosen pickup survives later routine maintenance
and background planning, then finishes through the native timed-action path.
A genuinely new intention during inference still rejects the outdated pickup.
Admission and execution fences themselves are unchanged.
Constructor restore tests also confirm that a deliberately absent schedule stays
absent and that every field of an authored schedule remains unchanged, even when
its saved planned day is older than the current simulation day.

This specifically addresses fresh-world startup. Late-created residents still
use the existing runtime schedule installer; their first-decision handoff is
not newly proven by this test.

## 2. Inspection lost exterior clues

The old inspection summary could report only closed/unknown contents while
omitting an object's visible markings. Opening then replaced a custom object
description with generic type-state prose. Repeated inspection did not provide
clean evidence on which to finish an investigation.

**Repair:** instance-authored object descriptions use the existing persisted
`DynamicDescription` override. Shared object creation and manager paths reuse a
single helper. Physical state and traits still change through their native
owners. Inspection records bounded public exterior detail separately from
visible contents and includes its full-value digest in the inspection basis.

**Verification:** in the actual offline Saltmere fixture, Ada inspects the
closed box and sees its cuts/paint, opens it, then observes empty contents without
losing those marks. Save/reload preserves the authored exterior. A later locally
observed exterior change invalidates the previous inspection basis.

Closed/nested contents, remote objects, and characters' private identity are not
exposed. Model-authored claims do not become physical evidence. Existing saved
worlds whose descriptions were already erased are not reconstructed. If an
author put transient wording such as “closed lid” in a custom description, it is
retained verbatim alongside the separate current state; no heuristic rewrite
is performed.

## 3. A standing motive was mistaken for concrete follow-through

Ivo's promise was present in private coordination memory. It had been linked to
a broad standing phone-relationship motive. The planning projection treated any
live linked goal as already representing the promised work. Consequently the
background planner saw `needsFollowUp: false` despite there being no finite
intention to find Mara or tell her.

**Repair:** a standing motive can support a promise but does not count as its
concrete follow-through. Actual active/paused/queued/pending episodic intentions
still represent that work and prevent duplicate generation. Ended, stale or
released associations keep their existing identity/lifecycle checks.

**Verification:** generalized offline tests cover standing and finite goals,
statuses, stale identity, release, a model choosing a finite follow-up, and a
model deliberately declining once. Projection does not execute anything,
declare the undertaking complete, expose it to another character, or create an
endless retry loop. Choosing to wait remains legal.

## 4. Recorder and stopped inspection

- Archive the existing world-scoped control ledger, including explicit sequence
  coverage/gaps, plus the process-scoped chronicle. Chronicle rows carry
  observation context, not fabricated world-source authority.
- Retain request IDs and rejection/supersession reasons for the next trial.
- Store working-memory receipt deltas instead of copying a whole tail on every
  public event. Native public events and the final full private memories remain.
- Record collection, serialization and synchronous-write time separately.
- Create the inspector outside the bounded task's cancellation scope. Bind its
  read/save callbacks to that lifetime; mutation endpoints and native execution
  still obey cancellation. Offline HTTP testing reproduces the old stopped
  `/api/state` failure, then verifies a readable/saved stopped world with no
  revival of cancelled work.

Re-encoding the old 741-row receipt evidence reduced 44.1 MB to 2.55 MB (94.2%)
while retaining every public event. This is a storage result, **not** a live
latency result. Writes remain synchronous; measured cost should guide any
further recorder change.

## Narrator diagnosis — not repaired yet

All eight live reviews explicitly declined intervention. This was not an effect
rejected by an authority gate. The existing prompt already calls for active
direction, so stronger adjectives alone are unlikely to address the defect.

Inputs were approximately 23k–35k tokens, dominated by inventory/evidence.
Reviews saw the latest events and previous self-interpretations, without a
factual cross-review comparison of progress. Repeated examination and ordinary
conversation were repeatedly labeled significant/rising tension; later
unsupported damage claims were treated as story facts. The unused
`detectStagnation` helper is not a ready-made solution: it also counts observation
activity as progress.

Next narrow design: compare committed native changes, unresolved purposes and
consequences across reviews; distinguish attributed speech claims from observed
facts; explicitly retain legitimate quiet work/rest. Give the Narrator that
evidence through its existing path, not another controller or a mandatory
intervention quota. It may only propose effects the world can actually execute.
The current profile does not have a native “stranger appears” capability, and
the operator consumed both branch grants in the previous trial.

## Validation and failed evidence

Root pre-edit source copies and test outputs:
`/tmp/argos-crisis-repair.vDX3Ye`.

- Final combined offline selection: **706/706 tests across 34 suites**, including
  startup safety and constructor restore coverage. Selection includes cognition ownership,
  waits, mental-envelope/action admission, coordination, inspection/privacy,
  schedules, no-AI mode, persistence and the inspector. Evidence:
  `integrated-final.log` in the root checkpoint directory. Final typecheck and
  scoped whitespace checks passed; output is retained in `typecheck-final.log`.
  The earlier 703/703 selection is retained in `integrated-regressions.log`.
- Initial pickup reproduction: `startup-red-5.log` records the real
  `goal_changed` regression. Earlier logs retained fixture errors: accidental
  deterministic selection, then an unavailable test helper. The first green
  attempt incorrectly asserted completion before the native timed pickup
  elapsed; that test was corrected rather than bypassing action duration.
- The combined startup regression initially also failed an unrelated stale
  actor-controller assertion. The current `agent-mind.ts` was byte-identical to
  its pre-turn copy. An independent reproduction confirmed its existing chosen
  wait guard returns no background action. The test now verifies no automatic
  action, no plan advancement, unchanged continuation/deadline, and later
  foreground supersession. No controller behavior was changed to satisfy it.
- Inspection red evidence: `/tmp/argos-inspection-red.log` (six genuine failing
  assertions), with green and broader regressions in
  `/tmp/argos-inspection-green.log` and `/tmp/argos-inspection-regressions.log`.
  Intermediate fixture corrections and the final actual Saltmere result remain
  in `/tmp/argos-inspection-saltmere-correct-fixture.log`.
- New coordination follow-through cases reproduced six failures before the
  one-condition projection repair; the final 16-case suite is included in the
  integrated selection. Tests preserve voluntary refusal and privacy.
- Offline recorder rehearsal:
  `recordings/town-crisis-offline-ROfinc`, log
  `/tmp/argos-crisis-observability-offline.log`: 300 simulated seconds, eight
  scheduled injections, four physical effects, zero provider requests/jobs or
  observer errors. This is not an autonomous behavioral test.

Focused selections overlap; do not add their counts as unique tests. No old
recordings, failed results, unrelated worktree changes or running worlds were
deleted. No commit was made.

## Exact next steps

1. Add the bounded factual progress/claim distinction to the existing Narrator
   review input, with offline tests for repeated inspection versus genuine
   discovery and useful quiet activity. Do not manufacture dramatic events.
2. Repeat the same single five-minute crisis protocol, with no per-resident
   prompt tuning or forced phone pickup. Trace whether startup choice commits,
   the warning is actually perceived/read, follow-up is formed and carried out,
   inspections retain evidence, and the Narrator proposes/applies useful effects.
   Preserve a refusal or failure as a result, not a reason to rerun until green.
3. Inspect recorder/tick/queue measurements before altering scheduling or model
   concurrency. Smaller evidence files do not establish engine responsiveness.
4. Separately test one genuine missing capability through need → proposal → God
   review → managed build → native use → spirit feedback. This crisis alone
   neither supplied nor proved that chain.

H3, new renderers, new cognition mechanisms and endurance expansion remain out
of this repair pass. No acceptance gate has been closed.
