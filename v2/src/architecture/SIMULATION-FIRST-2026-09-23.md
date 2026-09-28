# Simulation first: reliability, scale, and replaceable rendering

## Latest offline long-world repair checkpoint — 2026-09-25

Implementation, preserved red/green evidence and final frozen-source regression
results: `recordings/long-world-repairs-gaIdD6/ASSESSMENT.md`. This is a bounded
offline repair of the scheduled trial below, not another live acceptance attempt.
No model/controller changes, H3, server restart or new product goal.

- Native actor room departure now releases `SittingOn` at the actual location
  commit, not movement selection. An available schema state restores the seat's
  traits, description, stimulus and state age using the existing executor state
  transition, mechanically extracted to avoid a cognition/location import cycle.
  Pending, failed, cancelled and same-room movement retain seating. Invalid
  destination assignment is a no-op; other occupants, moved/removed furniture
  and recycled entity slots do not grant authority to release a different seat.
  This is not automatic repair of already-corrupt historical saves.
- God reviews independent receipts separately, retaining priority and proposal
  fairness. Native delivery bindings may carry their actual simulation expiry;
  serialized report data cannot supply or extend it. A default configurable
  10-second admission headroom checks wall/simulation deadlines independently.
  Too-late receipts are deferred, not acknowledged; all in-flight/per-tool guards
  and original TTLs remain. The 30-second default throttle is unchanged. Review
  isolation can reduce throughput, and a slow singleton may still expire safely.
- Weaver can observe the existing explicit, goal-backed `nextPurpose`, through
  the continuation owner's native validator. Native wait acknowledgement, side
  thoughts and reconsideration do not erase that chosen future purpose. Goal,
  source, persona, capability-package and control changes invalidate it. This is
  author-only evidence, not another NPC's knowledge or execution authority.
  Exact later-choice citations end on take/cancel; a matching enduring goal
  citation survives taking up that goal only when it independently grounds the
  need. Details supported only by the old choice require fresh observation.

The live workshop case contained neither an adopted workshop goal nor an explicit
later choice. It remains correctly rejected; this adapter does not turn prose
into durable intent or prove spontaneous goal formation. Needs-rate calibration,
two distinct useful autonomous growth cycles, the ten-trial baseline and >=600
actual AND >=600 simulated second endurance gates remain OPEN. Prior failures
below remain evidence; do not relabel them as passes after these offline repairs.

## Latest scheduled live growth checkpoint

`recordings/successive-growth-integration-Do3ZHZ/ASSESSMENT.md`: one bounded live
attempt, 300 simulated seconds / ~304 wall seconds, 132 accounted provider attempts,
unchanged source, complete drain, no residual processes. **Acceptance remains HOLD.**
Normal Weaver → God → coordinator scheduling built a useful café at50s. Ada chose
to walk there, eat58.5s and sit63s; both goals completed and consumed food stayed
gone. Both affordances came from one coherent build, not two successive cycles.

Failures/limits retained: missing evaluation goal keys (now corrected offline in
fixture v2, not live-retried); post-use God report batch expired during inference;
a later bike-shop demand lost its short-lived selected-purpose citation before
Weaver design admission. Final ECS also confirms a real seating invariant bug:
Ada left but remained SittingOn the old chair, which stayed occupied. No reported
execution exceptions does not mean state consistency passed. Hunger rose
0.2points/s and reached95 at300s despite the meal; rate calibration is open.

Pre-live exact-source regression: 2,101 tests/106 suites, typecheck, source freeze
and no-network gate PASS (`spirit-readiness-offline-8m0AjU`). Earlier test-fixture
typecheck HOLD (`spirit-readiness-offline-JPSC5Y`) is preserved. Post-live fixture
identity/pre-start validation correction: 91 tests/4 suites and typecheck PASS;
no simulation repair or live retry. God gained a private passive settled-review
subscription for truthful evidence, not new execution authority or a controller.

The next bounded repairs at that checkpoint were native seating release,
independent report-lifetime review and durable intention versus temporary waiting
in asynchronous world growth; their offline implementation is recorded above. Preserve
the original ten-trial and >=600 actual/600 simulated second endurance gates OPEN.
The historical checkpoints below are not current acceptance for these new limits.

## Latest bounded longevity repair checkpoint

Implementation and evidence bundle: `recordings/world-lifecycle-repair-jz105n/`.
This supplements earlier evidence below; final frozen-source gate results are in
that bundle's `ASSESSMENT.md`. No new live inference, renderer, controller, model
change or server restart is part of this repair. The ten-trial baseline and
>=600 actual AND >=600 simulated second endurance gates remain open and unchanged.

- Fresh pending stimuli require explicit world, committed-source and actor
  lifetime ownership. Bounded per-actor/world/global count and payload limits
  reject explicitly; stop purges only its own mailbox. Opaque pagination retains
  guards and exact hearing provenance. Native results remain committed even when
  a downstream notification is rejected; producers cannot claim delivery then.
  `simulation.stimulate()` now returns admission success. Unbound one-argument
  `queueStimulus(row)` is intentionally rejected; external callers must migrate
  to `queueStimulus(world, row)`. Legacy trusted requeue envelopes remain accepted.
- Chronicle events/snapshots and system logs/errors have bounded hot tails,
  cumulative coverage and archive callbacks before eviction. Library error
  monitoring follows append records rather than array length; it cannot miss
  errors just because a full tail rotates. `getOperationalStatus()` exposes
  world-owned mailbox failures and registry evidence coverage. Archive callbacks
  are not automatic disk persistence: attach a journal before starting a run.
  Authoritative `registry.events` remains lossless, pending backpressure work.
- Narrative reads select at most 200 candidates before sorting, while preserving
  the complete stored autobiography, current ownership, filtering/cursor/parse
  semantics and restore visibility. Malformed ordering uses the exact old sort.
  This is a local retrieval optimization, not proof of faster model decisions.
- Managed spirits use world-owned state and registry lifetime tokens. Manual
  stop/restart/replacement invalidates pending cognition, interventions and queued
  delivery receipts even within the same source epoch. Fresh pre-start reports
  survive first startup. God/library callers explicitly select their own world.
  Learning caches now belong to world plus actor identity; discovery listeners
  unsubscribe on source stop and can attach to the next explicit source.
- Offline successive growth covers two distinct purposes, native timed travel,
  food consumption then seating, feedback and preserved depletion in one source.
  Scripted choices and explicit approvals prove wiring, NOT independent live
  NPC/model judgment or normal autonomous scheduler cadence.

Deliberate limits: ECS component arrays, schema/affordance registration, legacy
spirit router and chronicle remain process-global; use isolated process hosts
for concurrent worlds. The new guards do not establish same-process multi-world
ECS isolation. Chronicle is operator evidence, not a private NPC memory channel.
Unstopped discovery subscriptions retain their world. Deleted-actor learning
cleanup is lazy; per-actor learned signature sets and durable memory can grow.
Narrative owner scans and append are still O(n), repeated append cumulative O(n²),
and legacy malformed-anchor pagination behavior remains preserved. Buffer byte
limits estimate insertion payloads, not V8 heap, and diagnostic record references
must not be enlarged after insertion. No measured many-NPC endurance claim.

Next live checkpoint remains a separately prospective, one-attempt two-need run
through scheduled Weaver/God/coordinator work with independent NPC use, retained
first-cycle consequences, resource bounds and all failures. The previous short
single-meal pass is not a pass for amended source or two useful growth cycles.

## Earlier simulation-first work and rationale

Priority changed by the user on 2026-09-23: simulation quality first; defer further
Fal tuning. Investigate Jev, and keep the engine suitable for a future streaming
audio world renderer. This is the current pass's checkpoint, not a claim that
the whole simulation is accepted. No new product goal was created.

**Subsequent user clarification, same date:** the audio model is an unpublished
internal demo with no available API/docs. Defer adapter work and Jev trials;
prioritize long-running coherent, usefully growing worlds. The next bounded
simulation-only check has completed: see
`recordings/living-world-continuity-pass-wnekZp/ASSESSMENT.md`. One useful diner
growth/use/feedback chain passed in 57 simulated seconds (44 provider attempts),
including correct God interpretation of consumption. This is not endurance or
continuous all-spirit growth. Next repair slice is offline retention/restart
ownership, then two distinct useful growth cycles under production scheduling.
The historical "no paid calls" statement below applies to the earlier scheduling
and renderer-extraction pass, not this explicitly recorded follow-up diagnostic.

## Starting state and authority

- HEAD: `fe67f54`. The large inherited dirty worktree contains the actual recent
  implementation; HEAD alone is not the implementation baseline. Preserve it.
- No active product goal on inspection. Older baseline, endurance, and failed
  evidence remain valid historical records; they are not passes for this source.
- Existing NPC model default is `gemini-3.8-flash`, foreground thinking low.
  Background budgets are role/configuration-specific. Do not switch models in
  the same pass as scheduling and rendering-boundary repairs.
- No H3, Jev, other paid model call, deployment, or server restart in this pass.
- Latest cognition evidence is `CLOTHING-VERIFICATION-2026-09-21.md`, following
  the action-choice, unsupported-cue, and known-answer audits. It demonstrates
  two-way phone interaction, not uniformly grounded thinking or complete visitor
  growth. Foreground p95 was roughly 3s in that two-character sample; behavioral
  response time was much longer and is a separate metric.

## Keep / separate / repair

1. **Keep one existing cognition loop.** Deterministic ECS and admitted skills
   execute physical work. Foreground chooses; background planning, appraisal,
   reflection and memory offer grounded context. Native results—not prose—own
   progress and completion. Do not add another competing controller.
2. **Repair task settlement accounting.** A cancelled/expired task may still be
   executing if the provider ignores abort. Logical cancellation must remain
   immediate, but it must not release actual concurrency or same-operation
   single-flight reservations until execution settles. Native freshness checks
   remain mandatory even after this repair.
3. **Repair a background review scheduling gap.** A sourced historical question
   candidate can survive stale reflection but never be reviewed if accumulated
   memory importance remains below 100. Give each newly unreviewed candidate
   batch one opportunity in the existing reflection lane. Do not promote it
   automatically, lower the global threshold, or retry an unchanged candidate
   forever. This is the one intentional cognition behavior change in this pass.
4. **Separate scene observation from H3 delivery mechanically.** Reuse the
   committed source, immutable scene snapshots, local witnesses, historical
   windows and retention checks. A consumer should read lived intervals without
   acquiring world mutation or clock authority. Preserve existing H3 wrapper
   behavior; do not silently remove the demo's bounded-recording backpressure.
5. **Keep growth under native authority.** Watcher/Weaver demand, God approval,
   Steward/entity construction and managed coding activation remain staged and
   bounded. A described restaurant is not proof of usable service. Generated
   systems are validated and activated at tick boundaries; arbitrary file writes
   do not automatically become trusted executable systems.

## Rendering contract

The renderer receives public committed state and events: source epoch, stable
actor/object identity, room, actual simulation timestamp, native action interval,
delivered public speech, clothing/held-object state, and explicit coverage gaps.
Private thoughts belong to a separately authorized observer UI, not automatic
audio or visual speech. Unread phone text is not ambient sound.

Transport acceptance, generated media time and actual performed content are
different evidence. A 170ms provider claim would not establish Argos end-to-end
latency or correctness. Measure event intake, cognition queue, inference, native
action onset/completion, projection, provider first output, and playback separately.

Slow consumers may lag or expire; they must never silently receive latest state
as though it were the missed past. Pure pull readers can use subsecond source
windows; that does not prove any model supports subsecond generation. The current
in-process snapshot capture is synchronous and still requires load profiling.
Explicit public environmental sound/phone tone projection is a later slice, not
an excuse to export private message payloads or invent sound from intention.

## Jev research and proposed evaluation (not integrated)

First-party sources checked 2026-09-23:

- [Model reference](https://docs.typesafe.ai/models): version `jev-1.13.0`, typed
  text-state input, $0.042/million input tokens, free output. Published limits are
  1,200 requests/minute and 250k tokens/second, subject to change. Pin the version
  for an evaluation; do not assume an alias remains stable.
- [Introduction](https://docs.typesafe.ai/introduction): Choice, Score and Noul
  outputs, independent questions against shared state. It does not generate
  dialogue, memories, plans, component definitions or code.
- [Launch report](https://typesafe.ai/blog/introducing-system-one-models-and-jev):
  vendor reports 70–500ms for their tasks; these are not measurements in Argos.
- [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13): weak
  arithmetic/date comparisons, indirect reasoning, irrelevant long context and
  adversarial state. Typed output is not a guarantee of a correct decision.
- [Confidence](https://docs.typesafe.ai/confidence): thresholds need local
  evaluation, not a universal confidence cutoff.

Engineering inference: promising for small semantic judgments over already
perceived evidence and explicit alternatives: relevance, interrupt significance,
or whether a known skill fits. Keep numbers, deadlines, routes, resources,
privacy and execution permission deterministic. Keep richer generative cognition
for narrative understanding, novel plans, dialogue and world construction.

First Jev step should be non-authoritative replay evaluation. Use the same small
actor-visible input and fixed questions on each case, including quiet activity,
necessary listening, genuinely urgent interruption, misleading dialogue, missing
evidence, and stale actor/target identities. Report latency distributions, error
types, confidence/abstention, request volume and cost. Do not merely score how
often it chooses action over speech. A shadow answer cannot mutate an NPC,
authorize a tool, or become an ECS fact. No private world dumps to a new provider.

At the published request limit, one request per second for 32 independently
deciding actors would already require 1,920 requests/minute. Event-driven waking,
native skill continuation, bounded queuing and measured account capacity matter
even with a fast model. Do not batch actors' private state together just to save
requests. Shared-state questions are useful within one actor's privacy boundary.

## Verification and next checkpoints

- Initial offline baseline: **162 tests / 14 suites pass**, prior to this pass's
  repairs. Log: `/tmp/argos-simulation-first-baseline-2026-09-23.log`.
- Preserve a failing reproduction and passing regression for each repair.
- Run existing deterministic pressure suite: three seeds, 256 coupled mechanic
  entities, 300 ticks, scarce-inventory contention and failed-system isolation.
  It is not a benchmark of 256 thinking NPCs.
- Add synthetic many-actor scheduling contention; distinguish fake provider
  service time from measured live cognition latency.
- After the bounded patches, rerun cross-layer regressions and typecheck. Record
  all failures, including inherited failures; do not silently narrow the suite.
- Next live work: one predeclared simulation-only repeatability diagnostic,
  frozen configuration, exact intervention protocol, no automatic retry. Do not
  treat a single attractive scene as cohort acceptance.
- Carry forward the original **ten-trial baseline** and subsequent **ten-minute
  actual/simulated endurance** requirements unchanged. Earlier-source passes
  cannot substitute for those on the amended implementation.
- Growth usefulness still needs observed NPC demand → approved usable addition →
  independent native use → feedback, including a subsequent improvement cycle.
- Only after these: renderer integration with the named audio provider and an
  explicitly bounded provider test. No further Fal comparison by default.

The audio model name/API is still requested. Existing code is not described as
audio-ready merely because a renderer-neutral source is available.

## Implemented and checked in this pass

- Queue outcome versus actual executor settlement is now separate. Cancellation
  and timeout retain actual lane capacity/scoped single-flight until settlement.
  `executing`/`settling` make that distinction visible without changing logical
  `running`. A never-settling executor still occupies its reservation; bounded
  drain must report failure, not pretend the work ended. Queue generations remain
  isolated; replacing a queue is not proof that old executors were terminated.
- Candidate review scheduling uses bounded attempted question IDs in the existing
  reflection work record, scoped to source, actor lifetime and reflection state.
  Readiness is non-mutating. Removing another candidate does not re-arm the old
  one. This uses the full existing reflection; successful integration consumes
  its captured experience accumulator while preserving experience arriving during
  inference. A failed candidate-only attempt does not automatically retry forever.
- `attachCommittedSceneSource()` is exported from the library with a read-only
  consumer surface. Its dependency graph excludes H3 transport and prompt
  compilation. Public snapshot allowlisting was moved mechanically with old
  import paths preserved. Tests cover 250ms reads, expired slow cursors, multiple
  attachments, interrupted spoken prefixes, room separation and stopped epochs.
  Existing demo backpressure/renderer failure policies are unchanged.
- The deterministic pressure suite passed **8/8** cases. Three oracle seeds each
  performed 614,400 field checks (1,843,200 total) across 256 coupled mechanic
  entities and 300 ticks. Synchronous dispatch-plus-commit p95 was 3.48–4.93ms,
  max 12.94ms on this machine/run; this excludes asynchronous worker/model wait
  and is not whole-runtime latency. Twelve scripted NPCs completed 600 contention
  attempts with canonical inventory ownership and no removed-item resurrection.
  Evidence: `stress-test-output/simulation-first-2026-09-23/results.json`.
- A synthetic 32-actor/two-world queue test, with builders and subconscious work
  held, keeps actual foreground concurrency at two through cancellation and
  eventually dispatches every actor FIFO. Its fake 350ms bound is a scheduling
  regression assertion, not a claimed live NPC latency.

Growth evidence clarified: the prior bounded chain in
`recordings/autonomous-service-pass-H2ZU40/final-checkpoint.md` did demonstrate
usable bakery construction and independent native consumption, with a later
review. Subsequent evidence in `recordings/god-gui-checkpoint-yFlnle/CHECKPOINT.md`
retains a failed diner run and offline observer repairs. Neither proves continuous
all-spirit growth on this source. GUI new-code admission remains capped at zero;
entity growth being enabled must not be described as unrestricted coding-daemon
construction. This pass does not expand those execution permissions.

## Final verification checkpoint

Frozen executable/test source passed the existing broad offline gate at
`recordings/spirit-readiness-offline-Upw8NE/`: **1,788 tests / 83 suites**, full
TypeScript checking, unchanged source hashes and zero attempted network calls.
The three new suites passed separately under the same network guard: **26 tests
/ 3 suites**. Total for these disjoint final checks: **1,814 / 86**. Executable
source remained unchanged through both runs. This documentation update followed
the gate. See `verdict.json`, `jest.json`, and `supplement-jest.json`.

Initial red regressions and intermediate fixture failures are preserved alongside
the passing logs in that private evidence directory. The reflection restoration
fixture initially failed because a restored world correctly defaults to AI off,
not because actor identity was lost. The final test verifies retained identity,
no reflection while AI is disabled, and scheduling only after explicit host
enablement. No production restore-authority relaxation was made. Independent
reviews of the queue, reflection, and renderer boundary found no blockers.

Two limits remain deliberate:

- Explicit queue reinitialization is not a process-wide drain. Old uncooperative
  executors can coexist with the replacement queue. Do not use reset as a way to
  evade resource bounds; drain owned work before replacing its scheduler.
- Historical question candidates receive a bounded review opportunity, not
  guaranteed promotion. A busy scene can still invalidate the result's current
  interpretation. No stale interpretation becomes current evidence merely to
  increase apparent responsiveness.

No live behavioral acceptance, model comparison, continuous-growth acceptance,
or audio integration occurred. The ten-trial and ten-minute requirements remain
open. The checked-in history was not changed; this pass's work remains uncommitted
alongside the inherited worktree.

## Exact next scaling and latency slice

First use offline, deterministic inputs at **1 / 4 / 16 / 32 actors**, without
changing concurrency or sending private data to another provider.

1. Measure capture overhead in three paired fresh-process runs per population:
   capture off versus one neutral source shared by two readers. At most four
   actors per room (1 / 1 / 4 / 8 rooms); preserve existing snapshot caps.
   Five simulated seconds warmup, sixty measured seconds, 100ms simulation steps.
   Use native pickup/drop and one rotating timed speaker per room. Read from a
   fast consumer every 250ms; a deliberately late consumer must expire without
   affecting native outcomes or the fast consumer.
2. Compare identical native outcomes, emitted speech, source time, scope and
   privacy before comparing performance. Report p50/p95/max timeline-step,
   capture, append and read CPU times; calls/witnesses per source second; memory
   and event-loop delay. Preserve failed samples and enforce a wall-time bound.
   Per-fragment full-scope `captureScenes()` is the first suspected cost to
   measure, not a proven bottleneck.
3. Exercise production scheduling with deterministic 800ms mock inference and
   3s background work, both staggered and all-actor bursts. Two foreground slots
   need roughly 12.8 seconds merely to service 32 simultaneous requests. Report
   saturation honestly; fake inference does not measure cognition quality.
4. Join existing operator-only diagnostics with opaque correlation IDs from
   accepted input through task enqueue/start, provider request, admitted action,
   native execution, public capture and consumer output. Monotonic wall timing
   complements simulation timestamps; neither substitutes for the other. Do not
   export private decision context into the public renderer stream. Actual first
   audible playback remains a provider-adapter measurement, not an inference
   from output generation.
5. Then run the one frozen simulation-only diagnostic already specified above,
   before the full retained acceptance cohort. Score progress, grounding,
   interruptions/resumption, independent world use and background admission—not
   simply a short model response or a preference for action over speech.

Jev remains an optional subsequent shadow evaluation, not a second controller.
The audio provider's identity/API is still needed before selecting or implementing
its adapter.
