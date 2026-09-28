# Narrator progress and time — 2026-09-27

Later audit and follow-up: [tick cost and Narrator delivery](TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md).
That audit corrects the original advice-uptake conclusion below; no new live
trial or acceptance-gate closure is implied.

Follow-up to [offline crisis repairs](TOWN-CRISIS-REPAIR.md). Scope: factual
Narrator progress assessment, explicit temporal semantics, then one unchanged
five-minute crisis protocol. No new model, controller, compulsory drama, world
capability, H3 rendering or expansion of the old acceptance gates.

## Implemented

- The existing per-spirit public review now compares bounded native activity
  across accepted reviews: physical completions, inspections, waits/rest,
  failed actions, spoken executions, pending receipts and environmental changes.
  Since-review backlog counts and a rolling 120-simulated-second view are
  separate. Repeated inspection does not mean repeated discovery; speech proves
  that words were spoken, not that their content happened. The public action
  tape does not contain private inspection conclusions or goal completion.
- Retention is bounded (256 executions, 64 environment receipts, 16 displayed
  patterns); omissions are explicit. Only accepted, still-current review
  completion advances the baseline. Failed/stale reviews, source isolation,
  restarts, identity replacement, in-flight events and clock rewind are tested.
  A move's start/end across different rooms is still one execution.
- Narrator input has one current evidence catalog instead of repeated
  inventory/grounding rosters. Exact per-field observation IDs and native
  receipt provenance are preserved. The native effect menu appears before
  the evidence, not at the end of a town-sized prompt. A compact setting list
  and existing inbox semantics remain.
- Private NPC thoughts, focus, goals and arousal-derived mood are omitted from
  the narrative-domain prompt. Other supervisory snapshots are unchanged.
  Prior tension/phase/thread notes remain explicitly interpretations rather
  than evidence of new developments. These input changes do not make the
  existing prose validator a proof of factual narration.
- Managed-world observation intervals now use simulation time. The legacy
  wall timestamp remains telemetry; unmanaged worlds retain explicit legacy
  wall scheduling. Completion anchors are scoped to exact source, registry,
  lifetime and spirit. The existing wall-time compute poll remains unchanged.
- Combined weather/story permissions now show current simulation time and
  the next eligible weather time. Native cooldown, budgets, evidence validation
  and stale-inference checks are unchanged.
- Review diagnostics separately record capture time, response-time input age,
  raw receipt coverage and historical progress receipt coverage. Harness
  protocol version 3 declares the actual timing semantics.

## What the clocks mean

| Quantity | Clock / meaning |
| --- | --- |
| Native movement, speech, action duration and weather cooldown | Simulation time |
| Narrator completion cooldown | 25 simulated seconds in Saltmere |
| Generic spirit compute poll | 10 wall seconds, unchanged |
| Provider deadlines, run limits and measured inference/queue cost | Wall time |
| Review input age | Response simulation time minus captured simulation time |
| This crisis trial | 300-wall-second native ceiling; 300-simulated-second target; 315-wall-second outer fallback |

A cooldown is not an exact response interval: polling, earlier work and model
latency add delay. Fixed 100ms world steps deliberately do not fabricate
catch-up time under load. Neither model latency nor recorder delay counts as a
completed physical action. The 50ms slow-tick warning budget is not the same as
the 100ms configured world step; a warning alone is not a missed step.

The old trial's Narrator was not starved: starts were roughly 40 wall seconds
apart, inference 5–8s and maximum spirit queue delay 744ms. All eight reviews
declined intervention. Its passivity is not explained by a stopped spirit loop.
Foreground/subconscious queue pressure and expensive ActorControl work remain
separate performance concerns.

## Offline evidence

Root checkpoint: `/tmp/argos-narrator-timing.lhLhXk`.

- Combined regression selection: **409 passed across 34 suites**
  (`integrated.log`). Includes progress, cadence, lifecycle, cancellation,
  authority, weather, physical timing, startup handoff/restore and queue tests.
- Final progress review selection: **51 passed**
  (`/tmp/argos-public-progress-tests-final.log`). Selections overlap.
- Final evidence-contract selection: **306 passed across four suites**
  (`final-evidence-contracts.log`), including the updated synthetic review
  fixtures. These selections overlap; do not add their counts together.
- New privacy/dedup prompt tests reproduced three failures before the change
  (`prompt-red-correct-fixture.log`). Earlier fixture used the wrong
  `addThought` argument shape; that failed output remains in `prompt-red.log`.
- Combined weather grant timing: two true pre-fix failures, then 97 tests pass
  across four suites (`/tmp/argos-weather-grant-timing-red.log`,
  `/tmp/argos-weather-grant-timing-green.log`).
- The first post-integration typecheck exposed two old synthetic review
  fixtures missing new timing/coverage fields. Fixtures now declare capture
  time and zero latency rather than weakening the runtime type. The original
  failure remains in `typecheck-prelive.log`. Final `npx tsc --noEmit` passed
  (`typecheck-final.log`). Scoped whitespace validation also passed.
- Offline crisis rehearsal: `recordings/town-crisis-offline-tYB3vc`;
  300 simulated seconds, eight scheduled injections, four physical effects,
  zero provider calls/jobs or observer errors. Log: `offline.log`.

## Live retry

One paid attempt completed: `recordings/town-crisis-live-of3NLe`. The unchanged
operator schedule delivered all eight injections. Source was frozen throughout
the run; no model/controller changes, H3, forced NPC decisions or additional
retries. This is one stochastic observation, not a controlled causal comparison.

### Resident outcomes

- Mara picked up her phone at 4.6s, first warning delivered at 10.2s, observed
  read at 13.2s and reply sent at 19.0s: “Who is this, and where is Alex?”
- Her second warning arrived at 95.3s; native read completed at 101.5s (first
  sampled read 101.8s). The second reply did not arrive until 190.6s. Thus quick
  initial response is demonstrated, not consistently fast communication.
- Mara completed one exterior inspection at 108.4s, publicly described the
  cuts/paint, asked Leon about the paint, and later left the Net House. The
  repeated identical examination loop did not occur in this observation.
  The authored exterior survived a later contents-staleness update.
- Ivo read at 81.3s and replied at 89.4s. His statement that Mara was safe at
  Lantern House was a stale character claim, not authoritative world truth.
  He went home, found her absent, and searched. A Net House move genuinely
  failed `path_blocked` at 160.8s. He eventually met her on the Common and
  spoke at 231.5–239.64s, but only opened the topic of the cuts: the promised
  factual disclosure was **not completed** before stop.
- Bea cleared the garden branch at 151.2s. Her phone remained on a table in
  Gull House while she stayed in the garden; the warning never entered her
  foreground perception. Her unread text is not evidence of consciously
  ignoring it. Do not fix this by leaking a remote message into her mind.

### Narrator and growth outcomes

Seven accepted reviews produced one accepted advisory nudge, zero autonomous
physical changes and zero rejected Narrator interventions. Two `suggest_beat`
messages to God were proposals, not applied changes. No coding jobs were
admitted; the eight-job budget remained unused. All four physical incidents
were the scheduled operator injections; branch cleanup was a resident action.

Request 497 captured at 214.0s suggested that Otis check Saltmere Common if
Leon did not arrive at the cafe. The grounded advice was accepted at 221.1s,
but the initial audit found no delivered stimulus receipt or exact nudge text
in subsequent foreground prompts. **Audit correction:** the original search
missed `systemInstruction`. Request 529 at 226.7s does contain the exact advice
as a private perception; terminal output confirms the direct route. Delivery
and prompt inclusion are therefore established. Otis had independently formed that same departure
goal at **214.7s**, before acceptance. His later walk (229.6s) was cancelled
by session stop before completion. Do not credit that walk to the Narrator.

The progress evidence and clock arithmetic were used, and known private
thoughts/goals/phone bodies were absent from Narrator inputs. Nevertheless,
prose still embellished observations (peering/pointing and calling a discussion
a discovery) without corresponding new native inspections. Later ordinary
conversation was mostly interpreted as organic momentum. Prompt inputs remained
large, 19,494–33,126 tokens. This does not pass useful active storytelling.

The live audit also found zero public wait/rest receipts despite 83 operator-log
wait/rest entries. Existing counters therefore describe the published tape,
not all behavior. **One post-run clarification** adds explicit immutable
`coverage` metadata: all activity is not represented, zero counts do not prove
inactivity, and retention completeness is distinct from behavioral coverage.
It does not publish extra events, alter decisions or retroactively change this
run. A new fixture failed before that clarification (one failure, 20 passed;
`public-coverage-red.log`). Post-change regression: **75 passed across six
suites** (`postrun-coverage-green.log`); typecheck passed again
(`typecheck-postrun.log`). No live retry followed it.

### Timing and termination

| Measurement | Previous `wVJTYc` | Retry `of3NLe` |
| --- | ---: | ---: |
| Simulation / harness wall seconds | 254.2 / 300.924 | 244.7 / 301.196 |
| Effective pace | 0.845× | 0.812× |
| Foreground execution median / p95 | 1.75 / 4.28s | 1.84 / 4.84s |
| Maximum foreground queue wait | 13.65s | 12.64s |
| Maximum subconscious queue wait | 37.51s | 36.52s |
| Accepted Narrator reviews | 8 | 7 |

The revised clock semantics worked: completion-to-next-capture intervals were
25.1–31.6 simulated seconds. The next review was due at 246.1s, beyond the
244.7s stop. Seven reviews is therefore not a missing eighth review. Narrator
inference took 5.1–9.0 wall seconds; input age at response was 4.9–7.1 simulated
seconds. SpiritSystem maximum queue wait was 704ms, so it was not starved.

**Throughput is not fixed.** Synchronous ActorControl callbacks reached 367ms
and WorldTick reached 294ms against the 100ms world step. The last-100-tick
average was 105.82ms. Recorder collection cost totaled 1.979s (max 21.98ms),
and all writes 1.148s (max 24.85ms), overlapping collection. Recording alone
does not explain the roughly 55-second simulation deficit. No speedup or causal
regression claim follows from two different live trajectories.

556 HTTP attempts: 543 HTTP-200 responses, eight timeouts and five shutdown
aborts. All failure evidence is retained. The native wall ceiling stopped the
run; pending/running/executing/settling work and active HTTP requests drained
to zero. No observer errors. All 792 control-ledger entries and 1,471 chronicle
events were archived, with zero missing sequences/listener errors. Final
authenticated `/api/state` returned HTTP 200, `running:false`, 244700ms.

The test-only listener on port 58978 was then stopped. Original user town on
port 51090 remains untouched and still listening; it does not acquire these
source changes without a fresh process/session.

Private evidence includes `result.json`, `terminal.log`, provider exchanges,
native receipts, memory deltas, admissions, world save and
`timing-comparison.json`. The provider-free comparison helper is preserved
alongside it as `analyze-recording-timing.mjs`. Old failed evidence is unchanged.
The root checkpoint directory, including red/green logs and before-file copies,
is also copied under this run's private `validation/` directory.

## Exact next steps

1. Profile the native ActorControl/WorldTick substeps with a deterministic,
   provider-free fixture. Separate synchronous CPU/event-loop delay from model
   execution and queue time. Optimize measured repeated work; do not accelerate
   simulation time to conceal it or increase concurrency blindly.
2. Trace Narrator choice through proposal, execution receipt and observable
   consequence. Progress counts improve its information, not its judgment;
   do not convert “something happened” counts into mandatory drama quotas.
3. Retest promise continuation past an opener and retain blocked-route evidence.
   Treat Bea's unattended remote phone separately from foreground scheduling.
4. After a separately justified repair, reuse this exact crisis protocol and
   preserve all outcomes. No further live trial was launched in this pass.

## Remaining acceptance

The original ten-trial baseline and ten-minute endurance requirements remain
open. This pass does not prove autonomous useful growth, a compelling narrative,
discovery/learning, bounded worst-case latency, or a complete generative game
engine. Inspect the actual single retry before deciding the next repair.
