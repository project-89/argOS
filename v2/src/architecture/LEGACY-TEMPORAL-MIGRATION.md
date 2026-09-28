# Legacy temporal migration — 2026-09-05

This supplements `TEMPORAL-SEMANTICS.md`. It records the bounded legacy migration, not a claim that every historical experiment is now a production simulation controller.

## Clock domains and compatibility

The authoritative age clock is `world.time.elapsed` in milliseconds. Original goal, memory, perception, thought, conversation and plan timestamps remain wall/source-domain fields. Their exact values continue to participate in source identity, ownership and evidence matching.

`SimulationAge` stores parallel `{sourceAt, simAt}` marks. A mark applies only while the source timestamp matches exactly. Reading ages or prompt context does not mint marks or observation evidence. Component membership is checked before reading sparse arrays, so a removed mark cannot become the age of a replacement entity.

New authored/generated goals stamp birth and deadline separately; activity receipts and lifecycle review/settlement ages have their own marks. Goal generation's healthy cooldown and quiet review use lived time. Provider failures still back off in compute time. Managed worlds no longer turn polling `advanceGoalTick` into five seconds of life; explicit unmanaged callers retain that legacy API.

Memory retrieval and current perceptual/speech ages use lived time. Historical dates in recalled context are explicitly labelled source-clock dates. Finite but out-of-calendar-range source values remain printable as `atMs=...`. Reflection's source identity, issue boundary, failure retries and timeout remain source/compute-domain checks, not memory aging.

Native forgetting curves now have a persisted `MemoryDecayState` origin: maintenance evaluates the complete curve from the origin instead of repeatedly multiplying an age curve into its previous result. Recall starts a new episode; promotion is once per memory, not a bonus per callback. Enhanced-memory decay/reinforcement uses elapsed duration too. Standalone enhanced stores must call `advanceMemoryStoreTime`; `createMemoryStore(world)` or `bindMemoryStoreToWorld` binds them to one world clock and rejects double advancement.

## Save and restore

Snapshots preserve the authoritative clock, age components, curve origins, historical-rate fractional credit, and optional `timedSpeech`/`timedActions` modes. Restoring does not replay a frame (`delta=0`) or resume pending callback closures. Explicit false modes remain false; missing legacy flags do not silently enable a new mode.

For an old save without age marks, the compatibility projection is:

`source simulation time = saved simulation time + source timestamp - saved wall time`

Thus an old memory already thirty seconds old at save remains thirty seconds old after a month offline. Future deadlines preserve remaining time at save. This cannot recover acceleration before a legacy snapshot; that historical information was never recorded. Subsequent saves preserve the migration baseline rather than re-aging from a new wall clock. Modern explicit marks retain their exact lived ages across accelerated operation and restore.

## Calendar and old hosts

`WorldClock` is now a projection of `world.time.simulationHour/simulationDay`. `advanceWorldClock` refreshes that projection and emits actual period changes; it does not advance physical time. MUD input, ambient polling and LIL/model turns therefore cannot create a second clock. A truly turn-based host must explicitly step simulation time.

The legacy four labels cover morning 05–12, midday 12–18, evening 18–21 and night 21–05. `ticksPerPeriod` remains a display-slot compatibility setting, not the speed of the day. New world events prefer `durationMs`; old event durations are calibrated at one physical second per old tick, with an age mark separate from their original `startTick`.

World-bound daemon growth metrics/suggestions use lived age. Arc stagnation's old ten-second observation unit is now an explicit physical interval; fifty duplicate observations at one instant cannot force self-resolution. A separately restored daemon must be rebound with `bindDaemonToWorld`.

## Historical generated rate laws

`integrateLegacyRateSteps` gives each migrated module an explicit physical step. It accumulates fractional elapsed credit, preserves nonlinear/threshold behavior, persists the sequence and remainder, and does not rerun physics when a managed clock is polled twice. Completed substeps cannot replay after a law throws. Catch-up beyond 10,000 steps fails visibly rather than dropping elapsed time.

The compatibility calibration is one physical second per nominal legacy tick (`frequency × 1000ms`). This is a chosen migration baseline, not a claim that old per-run constants uniquely specified physical units. `resource-system` instead uses 60 seconds, matching its documented stove cadence. New laws should declare actual physical units and integrate `ctx.delta` directly.

Thirty-six historical files now use the wrapper:

- Needs and arousal: `arousal-decay-system`, `rest-and-recover`, `custom-decay`, `deterministic-needs-decay`, `npcneeds-system`, `metabolism-system`, `hunger-system`, `environment-system`.
- Weather, heat and tension: `fire-system`, `thermal-dynamics-system`, `temperature-system`, `warmth-system`, `weather-system`, `atmosphere-system`, `storm-system`, `tension-buildup-system`, `atmospheric-tension-system-v2`, `sanity-system`, `sanity-decay`, `sanity-decay-system`, `beacon-decay`, `expand-puddles`.
- Ecology and resources: `resource-system`, `resource-growth-system`, `resource-replenishment-system`, `vegetation-growth-system`, `population-dynamics-system`, `trophic-dynamics-system`, `predation-system`.
- Economy and festival: `production-system`, `consumption-system`, `production-consumption-system`, `price-mechanism-system`, `market-price-system`, `price-update-system`, `festival-clock-system`.

Per-module coarse/fine equivalence is covered for the nonlinear fire threshold and exact event count. This wrapper is not a global coupled-physics solver: cross-module ordering, unseeded randomness and schema compatibility remain separate concerns. Retiming an old law does not certify its component names, visibility rules or action authority.

## Explicit remaining boundaries

- Historical mixed NPC controllers (`npcgrounded-loop*`, `npcbehavior-loop*`, `npcautonomous-loop`, old wandering/foraging/combat controllers) still contain old direct movement, hard-coded rooms, or action execution outside native receipts. They were not blindly multiplied by elapsed time. Migrating those requires replacing their actions with current admitted finite-duration commands, not treating each action as a continuous rate.
- Event counters and algebraic aggregators were intentionally not retimed merely because they increment values: actual tree felling, reproduction spending, supply/demand aggregation and test invocation counters are not automatically continuous laws. Historical periodic narrative/performance generators still need an explicit content cadence contract.
- The standalone legacy research `task-queue.ts` is a process-global, agent-ID-only external-work API with no world clock. Its deadline ordering/escalation and task completion durations remain wall-domain. Binding that API safely requires world-scoped identity and an explicit distinction between an NPC's lived task and real external research work; a blind `Date.now` replacement would make both ambiguous. It is not the native ECS Goal/Plan runtime.
- Standalone/unbound legacy daemon APIs retain compatibility timing; old daemon memory pruning and some observation-count heuristics have not been migrated. Bound goal-growth and narrative-arc stagnation are migrated. Daemon provider scheduling/whisper rate limits remain compute-cost controls.
- Original event IDs, source timestamps, perception↔speech provenance windows, reflection issue/freshness fences, API timeouts/backoffs, recording times, and monitoring/transport latency are intentionally not reinterpreted as lived time.

## Offline verification

Focused run: 9 suites / 149 tests passed, including existing planning reconciliation, memory scale, reflection freshness and social recall regressions. New coverage exercises wall jumps, pause/duplicate polling, accelerated step partitioning, source identity mismatch, metadata membership, remapped restore, legacy offline aging, mode flags, persisted rate credit, failure retry, invalid deltas and daemon growth/arc timing. No paid provider calls or H3 runs were made by this migration task.
