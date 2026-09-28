# Temporal semantics: lived time, compute time, film time

Updated 2026-09-05. This is the clock contract for the library runtime and the
next renderer integration, not a claim that every legacy system is migrated.

## Three clocks, one physical authority

| Domain | Authority | Used for |
| --- | --- | --- |
| Simulation | `world.time.elapsed` and `world.time.delta`, milliseconds | Walking, work, speech, energy recovery, evidence-wait deadlines, calendar |
| Computation | Wall/monotonic process clocks | Model deadlines, worker latency, budgets, retries and diagnostics |
| Presentation | Video playhead mapped to a recorded simulation interval | The scene, thought and message state shown to the viewer |

`runWorldTickAt` opens one logical tick, then advances the shared timeline through
physical and speech deadlines inside that tick. `tick` is an ordering counter,
not seconds. Elapsed time accumulates
actual supplied deltas; it is not `tick * latestDelta`. Invalid or duplicate
steps fail before mutation. The calendar and God's calendar projection follow
the same elapsed duration; TimeProgression no longer invents one hour per run.

The fixed-step runtime uses:

```
baseDeltaMs = ecsDeltaMs ?? 1000 / ecsTickRate
simulationDeltaMs = baseDeltaMs * timeScale
```

Default `timeScale` is 1. A delayed timer, laptop sleep, slow inference or a
physics pause does not turn into an uncontrolled catch-up jump. This means a
loaded machine can run below the requested wall-time speed. Acceleration is an
explicit simulation choice, not an inference from how long computation took.

`await sim.step(deltaMs)` supplies an exact in-world delta without scaling it a
second time. `await sim.step()` uses the configured scaled delta. Pause the live
runtime before manually stepping it. Stepped cognition can take wall time to
compute while the world clock stays at the current step.

For example, eight seconds of pumping remain 8,000 simulation milliseconds.
At 10x they can occupy about 0.8 wall seconds, subject to actual compute capacity.
This does not make a model ten times faster or guarantee identical decisions:
in a live accelerated world it sees more change during a request. Source fences
must still reject outdated decisions. Controlled stepped evals are useful when
comparing decision quality independently of inference latency.

## Actions occupy intervals

An intention is not completion. A physical executor owns admission, duration,
preconditions during execution, interruption and one exact completion receipt.
Plans advance on that receipt, not on predicted finish times.

Implemented timing paths include:

- Escape-room movement: 3 seconds; pumping: 8 uninterrupted seconds; unlocking:
  2 seconds with continuous helper support. Package deadlines retain their
  ordering when one fixture step spans several completions.
- Native room traversal: 3 seconds where no distance geometry exists. Native
  pickup/drop/give: 800/600/1,000ms; observation/examination: 1,000/1,500ms.
  Explicit affordance `durationMs` overrides the short default. The older
  `duration` field retains its tick unit and is never silently read as milliseconds.
- Escape-room reads: 1,500ms; installation: 2,000ms; small controls: 1,000ms.
  Pickup/drop/give use the same durations as native execution. Completion
  rechecks actual sight, possession, reach and original entity identities.
- Native grid movement: one existing grid step per 500 simulation milliseconds,
  with fractional accumulation instead of one step per callback.
- Native speech: finite duration, enabled by default through `createSimulation`.
  The authored estimate is 150 words/minute plus onset and punctuation pauses.
  It is not an audio-model timing measurement. A long utterance is not squeezed
  into an eight-second renderer chunk.
- Rest recovery and the NeedsDecay template integrate elapsed physical time.
- Idle reconsideration and explicit plan evidence waits use simulation deadlines;
  source identities and evidence timestamps retain their existing wall/order
  domain. A wall timestamp is never subtracted from simulation elapsed time.

The scheduler separates **body** and **voice** reservations. Speaking does not
implicitly stop walking; holding a spring-loaded control still prevents operating
a different control with the same body. Packages can expose an exact interruption
command (such as releasing their currently held control), not a blanket busy bypass.

Speech emits words at simulation deadlines. Only actually audible words enter
an attributed heard-excerpt ledger; cognition receives coherent batches rather
than a duplicate full utterance on every update. Complete-turn social receipts
remain distinct: arriving late or missing a span cannot create proof of hearing
the entire sentence. The full operation retains its own start/end/execution ID
and advances its captured plan only on actual completion. Words and body events
share the same ordered timeline, including coarse outer ticks.

Normal library speech now takes a local conversational turn at admission. It is
not queued if another audible actor already owns the floor. A 250ms handoff and
a 1,750ms repeat-speaker gap leave room for a response; an explicit urgent mode
permits interruption. Low-level `beginTimedSpeech` retains an explicit opt-in
floor policy, and moving speakers can meet while already speaking, so this is
not a blanket prohibition of physical overlap.

New perceived evidence can wake an actor even while both body and voice are
occupied, without freeing either resource. Cognition can choose to stop its own
utterance: the model's `action.stopSpeaking=true` is bound to the exact voice
observed at request time. A replaced/finished voice cannot be cut by an old
decision. Only emitted words remain as incomplete hearing; the unsaid suffix is
cancelled and receives no full-turn or plan credit. Ordinary speech is requested
as a short conversational beat, not silently truncated by the executor.

Coherent heard spans participate in mental freshness checks and attention while
remaining distinct from completed-turn evidence. Stored partials carry their
original room and lived age. Pending public callbacks contain no future script;
interrupted callbacks carry only the emitted prefix. Completion evidence settles
before terminal public observers are notified.

The expected deadline is not a success receipt. A visible speaking actor can be
perceived as speaking without exposing unspoken script. Actor, room and target
replacement cannot inherit pending work. Stop/reload discards process callbacks;
saved ECS is not permission to replay them. External edits that occur and reverse
entirely between observed boundaries are still not a physically recorded history.

Bare low-level `createArgosWorld` callers retain synchronous speech unless
`world.meta.timedSpeech` is enabled and the clock/speech executor is driven.
The library defaults to finite speech; `timedSpeech: false` is an explicit legacy
compatibility option. Demo fixture advances now also advance the shared clock,
without double-counting runtime-owned ticks.

`timedActions: false` similarly opts into legacy atomic physical fallback actions.
It does not collapse already authored package work such as walking or pumping.
Pending native actions keep their original plan, goal, coordination and working
memory attribution. A newer matching plan cannot inherit an old completion.
Action failure pacing is world/actor scoped and uses simulation time.

## Systems generated while the world runs

Dynamic synchronous systems schedule in simulation milliseconds and receive
the accumulated delta since their previous run. File-loaded and managed-release
frequencies keep their declared **tick** unit, with elapsed deltas accumulated
across skipped executions. Async model/worker scheduling remains a computation
concern; worker completion does not itself advance lived time.

Continuous rates must integrate `ctx.delta / 1000` (native/baked) or
`ctx.deltaMs / 1000` (managed sandbox). Test equivalent fine/coarse steps where
the physical law permits them. A counter of actual events is different from a
continuous rate. Do not silently retime authored event counts.

Native goal lifecycle, memory aging/reflection and bound daemon timing now use
separate lived-time metadata. MUD/LIL clocks project the canonical calendar;
36 historical continuous-law files use persisted fixed-duration integration.
Mixed historical NPC controllers and standalone research-task queues retain
explicit compatibility boundaries. See [the migration audit](LEGACY-TEMPORAL-MIGRATION.md)
for exact coverage and exclusions; this is not a claim of universal time-scale
invariance across every historical system.

## Cognition's view of lived time

Foreground and ordinary goal context expose elapsed simulation seconds alongside
the existing calendar. Social memory already dates heard turns; working memory
dates observed facts and completed actions; wait and interruption context describe
their own elapsed intervals. None of these timestamps predict an outcome.

Experience appraisal and fresh personal-intention review now receive an explicit
simulation snapshot. Private personal concerns retain the original receipt time
separately from appraisal completion time and project both ages. A message read
60 seconds ago but interpreted now remains a 60-second-old experience. Legacy
concerns with no receipt timestamp report unknown experience age. Save/reload
preserves these lived timestamps; wall-clock downtime does not advance them.

Age projections are not concern revisions: ticking or formatting alone cannot
reopen a completed personal review. A valid significant historical appraisal can
feed the existing fresh-review lane without applying its stale emotion, episode,
goal or action proposals. Fresh review still revalidates owner/source, current
affect, personal meaning and intentions, and may decide no new goal is warranted.
This is a private handoff, not permission to reveal a phone message to peers.

## Rendering contract: consume a lived interval

The headless committed H3 adapter consumes a **committed simulation window** with a
source identity, source start/end milliseconds, action intervals and its event
sequence. A video chunk is not a world tick and does not own physical outcomes.

For normal-speed presentation, a video segment representing source `[40s, 48s]`
contains those eight seconds of world history, regardless of whether computing
that history took 1 second or 20. A 20-second speech spans several chunks. Any
editorial compression or time skip needs an explicit mapping; it must not
silently compress speech while showing real-time bodily motion.

Thoughts, world-state panels and message delivery/read/reply displays select
from that same source playhead, never from the newest simulation snapshot. The
live simulation may continue ahead and receive new inputs. Inputs cannot rewrite
an already committed or already rendered past.

Prefer a small buffer of committed history over making the renderer guess what
will happen. If forecasts are used, label them as forecasts and retain the exact
action issuance and interruption constraints. Projected arrival or success is
not evidence. If the committed buffer runs out, explicitly pause/hold presentation
or rebuffer; do not manufacture actions to fill a chunk.

`attachCommittedSceneRenderer` joins an authored public room projection to
post-physics boundary captures and the public executor event ledger. Its configure
envelope uses a bounded immutable source interval. `SourcePlaybackTimeline` maps
actual provider chunk versions/durations to that interval and reports missing or
incompatible mappings explicitly. Restart begins a new source epoch; historical
tapes cannot be appended to as though they were a resumed live process.

The existing phone UI/transport remains a separate integration. The headless
adapter does not itself call H3 or prove that generated pixels obey their source
prompt. No new end-to-end video latency can be claimed without a live rendering
measurement and provider chunk/source correspondence.
