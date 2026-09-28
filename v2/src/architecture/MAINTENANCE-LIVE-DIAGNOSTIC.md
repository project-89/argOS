# Prospective maintenance diagnostic

2026-09-07. One 180-second no-H3 run, after runner typechecking and opt-in guard.
Entry point: `npx tsx src/evals/maintenance-growth-run.ts --live --seconds=180`.

Authored world: one caretaker in a reading room, an open supply valve, and an
empty reservoir. The operator explicitly requests the missing accumulation
capability. This is not spontaneous need discovery or prompt-to-world genesis.
The production coordinator/spirit hierarchy chooses designs and submits managed
work. Gemini powers cognition/building; no model defaults are changed. No actor
action or goal is forced, no direct operator build request is enqueued.

Capture protocol, capped runtime log, periodic checkpoint, final samples/ECS
snapshot and committed public events in a unique recordings/maintenance-growth
directory. Samples include proposals, job/runtime status, public appearance and
actual ECS perception entries. They are operator evidence, not NPC omniscience.

Limits: duration180s after initialization, builder90s, queue3, stop when total
jobs exceed3, RSS2GB, sampled evidence20MB and runtime log5MB. Polling thresholds
are not exact admission limits. Hard process deadline240s including initialization
and cleanup. Own CLI process only; no external server is killed. Exclusive live
lock refuses automatic stale-lock stealing. Hard failure retains it for explicit
owner verification. Cleanup tries stop/settle/flush for5s and reports truncation.

This runner returns diagnostic evidence, NOT an acceptance pass. Review all:

1. Was the operator brief actually considered by the production hierarchy?
2. Did a spirit propose and independently validate a real mechanic?
3. Did managed workers commit effects while native ticks/cognition continued?
4. Was public appearance causally faithful to those effects?
5. Did Mara actually perceive the relevant state and choose a grounded response?
6. Were validation/activation/failure reports available for further review?
7. Did budgets, shutdown, private/public boundaries and execution truth hold?

Build installation, activity counts, or an ungrounded sentence are not proof of
usefulness. Non-adoption is retained for review, not corrected by forced action.
Failure and incomplete evidence remain visible. This single run does not satisfy
repeated growth, rejection/recovery,10/30minute soaks or broader realism gates.

## First result — V18oSY, incomplete useful-growth chain

Process32831 exited0 after its requested window, not an acceptance pass. Actual
179.5s simulation/359 ticks over180.8s wall; mean tick2.64ms,0slowticks. No admitted
architect proposals, no active managed systems or committed growth. God's direct
engineering request first appeared in the sample at172.736s wall. Shutdown
cancelled it (`host-job.json`: cancelled, candidate not activated). Original
result samples precede shutdown and therefore still say building; retained
unchanged. `failure:null` means no runner failure, not a successful simulation.

Mara completed23 examine/observe actions, repeatedly inspecting unchanged props.
Actual perceptions include repeated narrator nudges to inspect reservoir/valve
and daemon inner voices. This is not a successful response to generated water:
there was no generated water. The narration may reinforce the inspection loop;
this run does not isolate that causal contribution.

WorldEvolution calls took38.7s,47.7s,77.3s; the final architect design was aborted
at shutdown. The saved trace does not distinguish earlier model abstention from
contract rejection. Do not infer the reason from zero admitted proposals alone.

## Follow-up protocol — one300s run, diagnostics added

Same world, brief, models, controller and coordinator configuration. Increase only
the observation window to300s (hard deadline360s). This changes budget, not an
isolated same-duration comparison. No source edits/heavy tests while it runs.

Added operator-only world-scoped architect diagnostics: per-cycle needs count,
admitted count, design outcome/rejection category and bounded contract detail,
duration and simulation/wall timestamps. Kept outside model/perception context.
Runner now saves build events and post-stop terminal job/architect/inbox state;
pre-stop snapshots remain distinct. Focused23701 exit0,14tests/twosuites1.514s;
types90316 exit0. No prompt or behavioral policy changes.

Prior process85767 is gone and its lock released. One new run is authorized by
the resumed bounded diagnostics task; retain all failures rather than retrying
until successful. Review pipeline admission before any further model changes.

## Follow-up result — F8IBAC, design-contract failure

Process93361 exited0; this is runner completion, not acceptance. Actual299s/
598ticks over300.351s sampled wall time. Mean native tick4.01ms,0slowticks.
Artifacts: recordings/maintenance-growth-F8IBAC. No active generated mechanic.

The new diagnostics distinguish the failure: three designs were rejected for
missing required capabilities/writes/independent acceptance (53.141s,35.583s,
55.657s design durations). A fourth was admitted after56.453s, but specified
nonexistent Container.fluidDepth/maxDepth/flowRate, ObjectState.state/isOpen,
and Connection.source/target fields. It also described frequency10000 despite
the managed runner interpreting frequency in ticks. Its builder tried to
redefine Container and was correctly rejected. Do not weaken that protection.

Terminal jobs: Weaver ca9737ff-0e2a-49b0-9154-e1576040319e rejected with
`Cannot redefine built-in Container`; God54114469-7b13-429a-a739-a1640857f948
cancelled at shutdown, candidate not activated. God's overlapping reservoir
request began while the first was building; distinct JSON is not proof of
distinct useful work. Shared causal work identity remains an open concern.

## Repair — ground the designer before the builder

The design prompt's primary JSON example omitted the required managed contract
and labeled frequency as milliseconds. It supplied component names without
their fields. Replaced that contradictory example with complete valid JSON,
actual public managed-component schemas/read-only metadata, explicit tick/time
units, and selection/attachment requirements for new dynamic data. Visible
appearance must derive from the physical quantity, not substitute for it.

Designer admission now rejects nonexistent built-in write coordinates and
unknown/wrong-type built-in fixture fields, including expected assertions.
Validation uses authoritative built-in metadata even before registry setup;
new dynamic schema additions remain subject to the existing release validator.
Private managed components are rejected in fixture inputs and expectations.
No builder sandbox, NPC behavior, model defaults or authored world changed.

Red28002: two new regressions failed, ten existing passed. Focused57752 exit0:
49tests/3suites3.398s. Typecheck16517 exit0. Full-suite result follows in the
validation log; do not infer it from focused tests. This repairs admission,
not yet autonomous useful growth. Prior failed artifacts remain unchanged.

## Additional boundary review before live verification

The current managed private-component list predates CommunicationMemory,
CoordinationReviewState, OngoingActivity, GoalWorkProgress and GoalAttempt;
WorkingMemoryIdentity was write-protected but readable. These are actor-owned
records, not environmental mechanics. Before another paid diagnostic, reproduce
builder-context leakage and independent read/write admission for these fields,
then close the same boundary in both designer and worker paths. Make the
protected set include the private set by construction. This is an access-policy
repair, not a new actor behavior rule or a claim of complete capability isolation.

Reproduced: red66467 exit1,13failed/44passed. Adversarial packages reading or
writing the omitted cognitive components reached ready rather than rejected;
new private sentinel values also appeared in the builder's world context.
Added the six components to the private policy and derive write protection
from that policy plus existing public read-only components. The same policy
already governs builder snapshot filtering, host read/write admission and the
new designer schema projection. Focused80299 exit0,64tests/5suites6.141s;
types54565 exit0. Full-suite run follows before live verification.

The schema-only full run85673 exited0:283suites/3528passed/10skipped198.723s.
This precedes the private-boundary repair and is not its full-suite validation.

## Prospective post-repair verification — one300s diagnostic

After the boundary repair's full regression run completes successfully, run
the same maintenance-growth CLI once with --live --seconds=300. Same authored
world, brief, models, controller, budgets and evidence protocol as F8IBAC. The
changed treatment is schema/contract grounding and private-component admission;
this single stochastic observation is not a controlled success-rate estimate.
No source edits/heavy tests during the run, no H3 or server changes. Retain any
failure, inspect actual terminal jobs, public effects and actor-local perception,
and do not launch repeated attempts merely to obtain a successful recording.

## Post-repair result — F42UWy, one live causal maintenance chain

The prerequisite full83211 exited0 (283suites/3540passed/10skipped197.001s).
Then one frozen-source run86549 exited0. Actual299simsec/598ticks over300.308s
sampledwalltime. Mean native tick5.17ms,0slowticks, observerfailures0. Node2382
is terminal and its live lock released. Artifacts: recordings/maintenance-growth-
F42UWy; terminal job58f3f5e1-f609-44e4-8e5f-607e54cd3a60 remains active.

Observed sequence (simulation time; polling observations have ~1s granularity):

- First designer call admitted at34.5s, after27.024s design duration.
- ReservoirAccumulationSystem first sampled active at72s. Four acceptance checks
  passed; builder used two implementation passes. Only one job/proposal in run.
- Actual public reservoir description began showing water at72s. Mara's actual
  sensory entries first sampled rising water at75s (2.5units).
- Reservoir reached bounded capacity10 at82s.
- Mara's native interaction started84s and completed85s on Supply valve. Runtime
  log confirms action `close` and state open->closed. Post-action sensory records
  show closed valve/full reservoir; final ECS has FluidLevel.volume10.
- Worker metrics:456attempts/454commits/1stale-result/0failures, maxworker20.922ms.
  Commit counts include unchanged invocations; not454 distinct physical changes.
- God received the active-build report and subsequent monitoring reports. There
  was no duplicate God engineering request or generated extra entity in this run.

This is one useful live design/build/effect/perception/action chain under an
explicit operator capability brief in an authored world. It is not autonomous
world genesis, repeated growth, a pressure-test pass or a10/30minute soak. The
reservoir saturated before closure, so this run cannot prove the closure prevented
overflow. Accepted closed-valve fixtures independently test stop behavior below
capacity; they do not turn that counterfactual into an observed live event.
No action was forced. Spirits remained enabled; earlier suggest_beat messages
went to God, and subsequent direct narrative nudges were observed, so do not
label this an unaided cognition comparison. No H3 or demo-server changes.

## Remaining repetition and feedback repair

After native closure at85s, direct narrative nudges still requested closing the
valve at113s,155s,185s and287s. Mara also retained a broad caretaker-monitoring
activity and made later inspections. Do not assign all repetition to one source.
Read-only trace identified a real missing input: collectRoomSnapshots and
buildSpiritPrompt passed prop name/placement, but not ObjectState.current or
Description.value. Narrator had the room's authored inflow premise without a
structured current prop state to contradict it. Some actor thoughts/reports
still mentioned closure; missing prop state is not proof the model had no clue.

Added a general public-state projection (bounded current state/description,
actual component membership, no private/dynamic component dump). The production
spirit prompt now includes it. Red30665 exit1: onefailed/fivepassed, state and
description absent from snapshot. Focus50093 exit0,36tests/5suites4.243s;
types23830 exit0. Exact placement tests now allow the added fields while retaining
their location/held assertions. No new behavioral policy, prompt prohibition,
forced action or lexical suppression. Full regression follows; no additional
live run is claimed after this final feedback repair.

Final full71506 exit0:283suites/3541passed/10skipped198.795s,
/tmp/argos-spirit-physical-feedback-full.log. Scoped diffcheck clean. All owned
test/type/live processes terminal; no active maintenance lock. Goal remains
incomplete. Next validation should distinguish legitimate continued monitoring
from stale/redundant supervisor interventions, without forced actor endpoints.
