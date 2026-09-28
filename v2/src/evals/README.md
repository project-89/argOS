# Simulation pressure evals

These evals check actual ECS outcomes, not model self-assessments or the number
of systems marked active. They exit nonzero on a failed invariant and retain
machine-readable results under `stress-test-output/`.

The production living-world soak writes under `recordings/`; its scope, acceptance
gates and live findings are documented in [WORLD-RUNTIME.md](WORLD-RUNTIME.md).

## Run

```sh
# No model calls: default 128 cells × 200 steps × 3 seeds, plus adversarial cases.
npm run eval:pressure

# Larger, repeatable workload. Approximately two minutes on the development host.
npm run eval:pressure -- --entities=1000 --ticks=1000 --seeds=7,19,42

# Two live Gemini engineering requests; no H3/video generation.
npm run eval:pressure:live

# Four-minute production dual-loop soak: real cognition, planning, subconscious,
# God/spirit/narrator work, phone disruptions, and a generated clock system.
# Explicit paid Gemini run; no H3. Saves bounded evidence under recordings/.
npm run eval:world:live

# Fast regressions included in the normal unit suite.
npm test -- --runInBand --testPathPattern='(evals|engineering)'
```

Offline options: `--entities=1..1000`, `--ticks=1..10000`, `--seeds=7,19,42`
(at most 12), and `--output=<directory>`. The CLI retains a bounded log tail and
writes `results.json` after each case, including failures. There is no automatic
loop of paid retries across failed eval runs.

## What is under pressure

1. **Coupled mechanics and conservation.** FloodStep changes water from inflow
   and drainage; CorrosionStep reacts to wetness and sealing; CircuitStep trips
   or recovers based on flood/corrosion thresholds. Independent equations check
   all eight fields of every cell after every step, including bounds, immunity,
   and delayed consequences. Variable delta times exercise simulation-time math.
   Each system must commit every evaluated step, not merely stay registered.
2. **A growing world.** The world starts empty. Cells are created after release
   activation, and unrelated entities appear/disappear while workers compute.
   New entities must become visible; irrelevant churn must not starve mechanics.
   A bystander's identity and mind must not be modified.
3. **Mid-flight interventions.** Forty direct water edits must win over stale
   worker results. Removing an entity must not resurrect it; a replacement must
   participate in the simulation normally.
4. **Overload isolation.** 2,001 cells exceed the per-invocation mutation budget.
   The release must roll back without partially applying its water changes, and
   the host continues for another 100 ticks. Expected rejection is a pass here.
5. **Dishonest tests / bad physics.** An update doubles flow and adjusts its own
   example to claim success. Independent operator tests must reject it and retain
   the previously running implementation.
6. **Scarce inventory.** Twelve NPCs execute 600 scripted pickup attempts over
   30 rounds through the real action executor. The first successful actor owns
   the item exclusively; others cannot steal it. Deleted and remotely moved
   items must not teleport into inventories. Both the containment graph and its
   compatibility inventory cache are checked.
7. **Builder failure and request storms.** An intentionally hung build times out
   while the host ticks. A healthy subsequent build must activate. A burst of
   40 distinct requests admits eight and rejects 32 rather than growing the queue
   without bound. Shutdown cancels the queued remainder.

The coupled oracle uses a settled-step barrier: all workers read the same prior
state, their results finish, then a boundary admits them. This is a deliberate
test oracle, **not** a claim that the production scheduler waits for workers.
The production scheduler remains asynchronous; results ready at one boundary
are all checked against that boundary's initial state before their disjoint
writes are applied. Results from different boundaries can legitimately be stale.

## Live build-and-upgrade eval

The live eval runs `createSimulation()` at 20Hz with Mara, Ivo, and Sera. NPCs use
deterministic cognition; only the engineering backend is intentionally paid.
Two scripted requests:

- Build the three coupled systems and their component definitions with nine
  independent acceptance cases.
- Upgrade only CorrosionStep from 0.25 to 0.5 units per simulation second,
  retaining sealed immunity, wetness threshold, and saturation.

The world must tick throughout both jobs. Existing systems must commit while
the upgrade is built. After activation the wall-clock loop is paused and the
actual accepted implementations face another 80 settled steps across 64 cells:
40,960 field assertions against the upgraded reference equations. Job timelines,
worker counters, elapsed time, and 25ms watchdog gaps are saved.

Each job has a 120-second deadline, with at most three Gemini implementation
attempts inside that deadline. The runner always stops its simulation and workers.
The source labels `eval/Weaver` and `eval/Tinker` identify scripted eval requests;
they are not evidence of autonomous spirit reasoning.

## Findings from the initial pressure pass

The first oracle failed, rather than declaring the system healthy:

- **Invisible new entities:** the installed BitECS empty query is cached and
  doesn't add later-created entities. Snapshot capture and schema migration now
  enumerate living entities directly; snapshots exclude prefabs.
- **Coupled-system starvation:** applying one result before validating its
  neighbors invalidated otherwise compatible results from the same prior state.
  Admission now has separate validation and write phases.
- **Unrelated churn:** snapshots now contain only entities with declared read
  components. Managed `query()` requires at least one component name; a stream
  of unrelated perceptions can no longer invalidate every environmental result.
- **AI opt-out leak:** speech and image reflection could reach Gemini even with
  `enableAI:false` when a key existed for engineering. Those paths now honor the
  world flag, with a configured-key/no-network speech regression. The first live
  run exposed this; a later live run verified the corrected path.

After the fixes, the 1,000-cell, 1,000-step, three-seed oracle passed **24 million
field assertions** and **9,000 system commits**, with zero stale or failed oracle
invocations. Dispatch-plus-commit p95 was roughly **8.1–8.5ms** on the test host.
This metric excludes asynchronous response validation and worker time; it is not
end-to-end tick latency. Process RSS was approximately 0.6–0.73GB across cases.

The corrected live run passed in about **45 seconds**, with **857 live world
ticks**, including **420 ticks during the upgrade**, plus the 80 oracle steps.
Its 25ms watchdog had a maximum observed gap of about **59ms**. These are measured
results for this workload and host, not hard real-time guarantees or universal
performance thresholds. Reports preserve the exact measurements and seeds.

## What this does not establish yet

- Long-duration autonomous God/spirit reasoning, usefulness of proposed mechanics,
  NPC decision quality, subtle thought influence, or narrative coherence. The
  engineering requests and contention intentions in these evals are scripted.
- Canonical event-stream conformance or H3 timing/visual correspondence.
- Historical integration of time-varying inputs under repeated stale-result
  rejection. The current runtime accumulates missed delta time against the next
  accepted snapshot; it does not replay each historical input segment.
- Guaranteed progression for tightly coupled systems whose worker results always
  arrive at different boundaries. Runtime counters expose stale results; a
  multi-hour realtime soak is still needed to characterize sustained contention.
- Multi-world isolation in one process, crash/power-loss recovery, durable entity
  identities under ID reuse, hostile-code containment, or memory/disk retention
  across days. Existing unit tests cover release reload and rollback, not all of
  these operational failure modes.

Useful next evals: autonomous spirit repair of a hidden runtime fault, puzzle
invariants across many generated releases, and replay equivalence with timestamped
world interventions. Keep the reference checks outside the coding agent's authority.

## Apartment communication and emotional reorientation

The bounded breakup test uses production cognition, planning, reflection and
guardian daemons, with no H3, narrator or God/world evolution. It changes only
Elaine's incoming contact profile and two timed external messages. Her feelings,
goals, facial expression, replies and disclosures are not scripted.

```sh
npm run eval:sitcom:breakup:live -- --seconds=120 --label=breakup
npm run eval:sitcom:breakup:live -- --seconds=120 --condition=neutral --label=neutral
```

These commands spend configured Gemini credits, never Fal credits. The neutral
message condition retains the same boyfriend and relationship history; it changes
only the message contents. `--contact=neutral` is a separate identity control,
not a substitute for the matched neutral-message condition. The evaluation's
120-second bound is independent of the longer interactive livestream session cap.

Each run preserves source fingerprints, exact stimuli, private cognition and
affect, goals, public executor receipts, actually delivered perceptions, a saved
world and an HTML replay under `recordings/sitcom-*`. Appraisal proposals contain
no body action. Only a completed personal read queues the phone experience; only
real sight or heard speech gives the friends evidence. Read/typing intervals and
their visible targets reach the camera without exposing private phone contents.

Transport gates do not establish good behavior. Review literal thoughts, goal
changes, completed replies, voluntary disclosures and listener receipts. An
unanswered message is not proof of a deliberate refusal; a visible face is not
proof someone perceived it; one successful episode is not a reliability claim.
