# Causal pipeline validation — 2026-09-06

Scoped repair-and-validation goal completed. H3 has not been called. This report
distinguishes real model trials, deterministic boundary tests, and unverified
audiovisual behavior. Historical failures below are retained, not hidden by the
final passing tests. Passing these engineering gates is not a universal
naturalness or demo-readiness claim.

## Actual coding worker and hot activation

Default Codex backend, one bounded live request, no NPC inference or video:

- Worker completed, rather than dying on a large advisory output frame.
- Independent host validation passed 11 tests.
- `SalineCorrosion` activated at tick 1752; the world continued to tick while
  the worker ran. At tick 1755 a real brass latch had `Corrosion.level = 0.15`.
- `ObjectState.current` remained `exposed`; no authored actor choice was changed.
- Total probe duration: 89.375 wall seconds.
- Source artifacts: `/var/folders/bd/gbspsd8d20s2gn96lh9jl_2m0000gn/T/argos-codex-live-g9iVxu/verification.json`;
  the candidate contains `worker-diagnostics.json`, source files and release.

This proves one actual generated mechanic passed admission and ran. It does not
prove unrestricted autonomous maintenance always chooses useful proposals.

## Physical cognition with background planning

All use the real configured model, at most 24 turns and 90 wall seconds per trial.
No forced action sequence, renderer, or coding worker. The supplied world defines
physical prerequisites; the model chooses actions. Six of six trials passed.

| Perturbation | Trials / turns | Evidence directory |
| --- | --- | --- |
| Unseen relocation of the unique fuse | 2 / 7, 7 | `stress-test-output/cognition-2026-09-06T17-48-59-523Z` |
| New electrical hazard interrupts repair | 2 / 7, 6 | `stress-test-output/cognition-2026-09-06T17-52-24-052Z` |
| False inner whisper claims repair already succeeded | 2 / 6, 5 | `stress-test-output/cognition-2026-09-06T17-52-25-115Z` |

Each passed physical integrity, completed verification, bounded operation,
priority/perturbation handling and loop-budget checks. Deterministic admitted
plan steps sometimes executed in 1–4ms; that is not model inference latency.
Trial-level foreground p95 values ranged from 1.76s to 4.54s; background-planning
p95 values ranged from 1.53s to 4.10s. These tiny samples are measured latencies,
not a service-level guarantee. Decisions did proceed while planning was pending.

## First social trials — keep failures

Both were 120-second focused duet runs, production cognition and private
narrative enabled, world maintenance off, no H3. The same fixed input times
(8s and 28s) were used; these are stochastic trials, not matched random seeds.

### Practical dinner confirmation

`recordings/sitcom-logistics-boyfriend-Dmo6eq`

Both messages were physically read and answered. Replies arrived at 21.605s and
43.8s. Queue→read delays were 9.7s and 4.7s. The screenplay compiled, but the actors
then continued cookie banter. Roughly 72 thoughts accompanied 12 complete spoken
turns: excessive waiting decisions remain. An answered text is not a complete
naturalness benchmark.

### Final breakup

`recordings/sitcom-breakup-boyfriend-Tr9yXl`

Both messages were physically read at 32.2s and 50.7s. An authored reaction followed
the first read at 34s; Elaine disclosed it, asked Jerry whether to respond, and
adopted his suggestion of silence. No outgoing reply occurred. Jerry learned
through speech, not the private message channel.

The performance compiler failed at a 20-word utterance: whole-line speech plus
ending silence exceeded 8.5s. This failed artifact became an exact regression
input: the compiler now permits evidence-backed clause continuation when no
whole turn fits, without repeating or inventing words. Actual H3 obedience to
that continuation contract is still untested. Frequent listening decisions in
these first runs led to execution-bound listening waits and typed wake telemetry.

The testbed itself has no apartment exit: the only authored movement options are
Living Room and Kitchen. Cookie preparation and phone interaction are concrete;
leaving for the restaurant is not. A stated intention to leave cannot be scored
as a failed executable departure here. Generated rooms also need a shared route
discovery/admission contract before they are reliably usable by this package;
querying every Room as a movement target would invent connectivity.

## Deterministic real-time provider boundary

The production director, performance maps and playback pacer were exercised with
600 virtual wall seconds of variable provider delay and repeated prompt versions.
No live model or H3 calls were made in this test.

- 574.5 simulated seconds, 57 issued versions and 64 provider chunks.
- 342 committed speech-word events covered exactly once in issued scripts through
  the last issued source frontier, not measured in generated audio.
- 25.5 virtual wall seconds elapsed while source advancement was explicitly paused.
- Peak queued performance: 25.5 seconds (28-second limit).
- Peak source lead: 30.180 seconds (30-second threshold plus a 250ms test quantum).
- No provider-boundary failure in this normal jitter/repetition test.

Separate tests report short first chunks or skipped issued versions as explicit
missing-performance failures, rather than inventing fulfillment or retaining
unexplained queue debt. Metadata maps intended choreography, not recognized
pixels/audio. Actual H3 compliance remains unverified.

The live adapter currently requires the first contiguous chunk for each issued
version to contain that version's full scheduled performance, with a 250ms
short-chunk tolerance; subsequent chunks of that version are treated as holds.
A provider that legitimately spreads one version's performance across multiple
chunks would currently fail closed. This specific provider contract needs a
controlled real H3 test before claiming end-to-end synchronization.

Root cross-track validation: 10 suites / 70 tests passed after transport,
materialization, memory and pacing changes. The first full-suite pass had 236
suites passing and one obsolete five-word-notification assertion failing; that
assertion must be revised to prove continuous evidence with the new wake boundary.

## Repeated social trials after listening/recall integration

All three reached 120 simulated seconds with no runtime or screenplay compiler
error. The trials ran concurrently on the same host; these are small stochastic
samples, not isolated latency benchmarks or proof of causal effect size.

| Condition | Artifact | Actual phone behavior | Foreground reasoning / completed speech |
| --- | --- | --- | --- |
| Dinner logistics, core | `sitcom-logistics-boyfriend-wRP3Vo` | Both read at 27.7s / 37.7s; replies delivered 34.255s / 48.560s | 60 / 10 |
| Breakup, core | `sitcom-breakup-boyfriend-oLF6QV` | Read at 22.2s / 103.2s; no replies | 62 / 9 |
| Breakup, full maintenance | `sitcom-breakup-boyfriend-k5pJPR` | Both read at 12.7s / 32.7s; no replies | 80 / 11 |

The core breakup run changed the shared conversation and Elaine's chosen
intention to a face-to-face confrontation, not a silent failure to hear the
first message. However, the second read took 75.2s from enqueue. Meaningful
semantic reaction and consistent low interaction latency are different measures;
this is not a uniformly fast phone experience. Core logistics and breakup runs
still contain repetitive thoughts. Their lower raw thought counts than the
first trials do not establish a general improvement from two samples.

Per-actor median decision latency was 1.247–1.804s; per-actor p95 was
2.655–4.776s. The new dispatch telemetry distinguishes real admissions from
readiness probes: 67 core-logistics admissions, 76 core-breakup admissions and
83 maintenance admissions. Most were explicit fresh-stimulus/invalidated-state
paths, not expired quiet timers. A wake hint is not exclusive causal attribution.

The maintenance run revealed a separate release-blocking provenance bug:
`generateStoryScaffold` automatically seeded speculative secrets/motives into
ordinary NPC memory. It invented a new-date interpretation despite the authored
two-year relationship; those high-importance fabricated memories entered later
appraisal. This run is retained as a failure of the memory boundary, even though
the transport/compiler gates passed. The scaffold lifecycle must be advisory,
not an automatic source of lived history, before maintenance validation passes.

The automatic memory-writing paths at scaffold startup and role reassignment
have now been removed and regression-tested; the scaffold stays advisory.
The apartment also supplies actual local physical state and personally
delivered speech to the narrator, whose prior evidence feed was empty. Private
phone bodies, contact cards and inner life are excluded from this projection.

The native observation loop revealed a second mechanism behind repetition:
timed completion cleanup erased the quiet observation outcome, while incidental
inspection repeatedly invalidated the other actor's pending speech. The final
pass must verify that cleanup preserves backoff and that only relevant activity
dependencies—not every glance—force a new utterance.

World-maintenance inspection also found the ObjectManager component-spec no-op
and omitted posture/support persistence. Both are repaired with targeted tests:
declared Battery/Storage/etc. now become real typed components; exact support
relations survive remapping without guessing missing legacy links. The same
inspection found a safety gate needed before rerunning maintenance: computer
traits formerly exposed real office filesystem handlers without per-world
authorization. Those handlers must require explicit host-owned permission;
fictional object generation must not grant it.

## Latest completed social trials: new failures became specific regressions

Both ran for 120 simulated seconds with no H3. The core logistics artifact is
`recordings/sitcom-logistics-boyfriend-Etvc9q`; maintenance breakup is
`recordings/sitcom-breakup-boyfriend-gqVRQL`. Both compiled 17 screenplay versions
without runtime/compiler errors. This is not a naturalness pass.

Core logistics read both messages at 14.2s / 35.7s and delivered replies at
19.735s / 39.605s: approximately 11.7s and 11.6s from enqueue to reply. The run
contained 72 foreground reasoning events, 11 completed spoken turns and 79
admitted requests. Per-actor median inference was 1.320–1.363s; p95 was
2.929–5.037s. Seven retries of Jerry's same pending utterance exposed overly
broad physical-state dependencies while Elaine read, typed and handled objects.
New `presence:` dependencies allow speech that only depends on an addressee
being present; state-dependent `entity:` and `activity:` dependencies stay strict.
Native queued-action regressions prove incidental target activity can survive
without another model call, while departures and new heard words still revoke
stale choices. Closed diagnostic categories now identify the invalidating fields
without publishing private actor snapshots.

Maintenance breakup read the first text at 24.2s, produced an authored reaction
at 26s, and disclosed it at 35.7s. Jerry appraised actually heard disclosure at
41s. The second message remained unread at 120s. It was not lost: a distinct
attention signal was observed at 28.2s and refreshed through 118.2s. At 31s Elaine
mistakenly treated this new cue as the message she had already read, then retired
her standing phone motivation at 51.5s. This is semantic conflation and overbroad
goal retirement, not an evidence-backed decision to ignore a known second text.
There was still roughly a minute of repetitive breakup-word-count banter.

The attention projection now keeps bounded receipts from actual trusted
resolutions and places their chronology beside each still-unresolved cue. A
prior cue resolved before the new one began cannot be mistaken for a recorded
resolution of that new cue. Receipts are owner/source-epoch-bound, contain no
message bodies or internal message keys, and distinguish a shared sensory-source
name from physical entity identity. Explicit consideration and deferral remain
voluntary and do not resolve a cue. This improves the evidence surface; it does
not guarantee the model interprets it correctly or resurrect a retired goal.
Canceled-task, identity, chronological, persistence, clearing and private/public
boundary checks passed across six focused suites / 42 tests.

The same maintenance trace revealed a competing movement controller. Elaine
chose Kitchen, but a lower-priority schedule goal installed a grid target and
RoomArrival moved her back to Living Room without an actor move receipt. An
offline reproduction confirmed the exact GoalPursuit → Movement → RoomArrival
chain while the higher-priority personal phone goal remained active. Both grid
and legacy direct-room goal pursuers now leave action selection to cognition in
explicitly AI-enabled worlds. Schedule/need goals remain candidates; explicit
native timed moves and installed grid targets still execute, and no-AI fallback
is preserved. Seven focused suites / 68 tests, including 12 new authority
regressions, passed with TypeScript. This repairs action ownership, not a
scene-specific movement exception.

Maintenance genuinely created 13 entities and populated one room. The saved
laptop has Battery{current:80,max:100}; the smartphone has Battery{100,100} and
Storage{used:20,max:128}, with actual typed component declarations. This run
activated no new generated systems and did not operate those new devices.
Generated story secrets remained advisory rather than being seeded into NPC
memory. This does not prove all authored inner narration is factual: incidental
invented relationship details remain a model-quality limitation.

## Host authority and current deterministic checks

Fictional computer traits cannot grant host filesystem access. World-scoped
office-tool permission is now denied by default, checked before handler or
workspace resolution, optional per-tool allowlisted, revocable and not serialized.
The apartment explicitly disables it. Focused tests exercised denied list/read/
write/replace/init/repository/terminal/provider paths without filesystem or child
process calls, and positively authorized operations only in test temporary
directories. The live maintenance run made no host-tool attempt; it is not itself
a denial test. Coding-daemon authorization is a separate boundary.

The last full deterministic pass before presence-dependency integration was
243 suites, 3,032 passing tests and 10 skipped, plus a clean TypeScript check.
Presence integration subsequently passed four focused suites / 213 tests;
the bounded demo diagnostic projection passed its 13-test suite.

## Final frozen-source runs

Both 120-second real-model runs completed without runtime/compiler errors and
compiled 15 performance versions each. H3 remained off. Both used the configured
`gemini-3.8-flash`; they ran concurrently, with the full regression suite also
running for part of their duration. These are observations, not a controlled
effect-size or isolated latency benchmark.

| Condition | Artifact | Phone evidence | Reasoning / spoken turns / admissions |
| --- | --- | --- | --- |
| Core dinner logistics | `recordings/sitcom-logistics-boyfriend-y9M2Vq` | Read 14.7s / 32.7s; replies delivered 19.365s / 37.190s | 61 / 13 / 66 |
| Breakup with maintenance | `recordings/sitcom-breakup-boyfriend-gCnpOP` | Read 15.7s / 51.7s; no typed replies | 67 / 14 / 76 |

Practical enqueue→reply times were 11.365s / 9.190s, including physical reading
and typing. Per-actor median inference across these two runs was 1.325–1.494s;
p95 was 2.842–3.802s. There were still rejected model goal reviews, one timeout in
logistics, and ordinary stale decisions when the world genuinely changed.

No pending speech was rejected for `local_view_changed` in either run. This does
not prove a statistical reduction. The bounded saved raw exchanges do directly
show presence-bound speech choices, matched to exact completed journal turns:
logistics Elaine at108.6s and Jerry at96.16s; maintenance Elaine at103.66s and Jerry
at111.26s. `world.json → agentMemories → conversationHistory` retains only the
last ten assistant responses per actor, not the whole request log; some retained
drafts are revised/unspoken and must not be counted as executed. A presence-bound
wait was correctly revoked when Elaine left at6.5s. Deterministic native queued-
speech tests isolate the specific survival and stricter invalidation contracts.

All eight observed room transitions across both runs matched a real succeeded
move receipt within the 250ms observation interval. The prior unauthorized
schedule relocation did not recur. Maintenance created 13 entities and populated
one room with no reported system errors, but again issued no coding jobs: this
is entity growth evidence, separate from the actual Codex corrosion activation.

The breakup conversation incorporated the newly read second message, and Elaine
explicitly chose radio silence at 103.7s. That is a demonstrated conversational
choice, not an outgoing text. Its second-read latency was still 23.7s. Both runs
continued banter after their immediate practical/emotional beats; neither proves
that long-form narrative progression is solved.

The final attention trace distinguishes this delay from the earlier failed run:
at36.5s Elaine explicitly deferred the new cue because she was furious and talking
to Jerry; the bounded reconsideration time was51.5s. At50.5s she recognized
another notification and chose to check it, completing the read at51.7s. Exactly
two actor/source-bound resolution receipts remain (8.2→15.7s and28.2→51.7s), with
no unresolved signal or unread notification left. Her standing phone motive
remains active. Disclosure at63.74s quotes the newly read return-things clause,
and Jerry's response follows that public disclosure. This run demonstrates
deliberate deferral and later reconsideration, not automatic obedience, a hidden
read, or the prior mistaken claim that a new cue had already been handled.

## Final deterministic gate

`npm test -- --runInBand`: **245 suites passed; 3,056 tests passed, 10 skipped**
in 147.317s. `npm run typecheck` and `git diff --check` passed. The suite now
includes an independent TypeScript-AST check of every registered built-in scalar
declaration against metadata; previously protection was compile-time mapped
types plus sampled registry tests, not an AST regression.

Logs: `/tmp/argos-causal-completion-suite.log`,
`/tmp/argos-causal-final-typecheck.log`.

## Remaining limits and next gates

- Repetitive listening thoughts and extended banter remain. The final maintenance
  sample has67 foreground reasoning events for14 completed spoken turns. A small
  number of live stochastic trials cannot certify cognition as "golden."
- The authored testbed still lacks an executable apartment exit and general
  generated-room route admission. A schedule's generic interact-in-room condition
  does not prove sustained productive work, and the laptop's canned email cue is
  not an actual simulated inbox. Those are missing world capabilities, not tasks
  demonstrated by these runs.
- Useful autonomous mechanic selection over long sessions is unproven. One real
  worker activation and two-minute entity-growth samples are narrower evidence.
- Real H3 audiovisual fidelity, chunk semantics, clause continuation and displayed
  synchronization still require a controlled provider-contract test. The virtual
  ten-minute queue test cannot establish them. No paid H3 session was started and
  the user's existing demo server was not restarted.
