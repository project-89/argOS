# Cognition and planning evaluation laboratory

This suite isolates native Argos cognition, planning, action execution, episodic
feedback, and typed goal evaluation. It does **not** start the phone demo, God,
spirits, background scheduler, generated systems, H3, or coding daemons.

## Run it

Deterministic CI replay (no paid calls):

```sh
npm test -- --runInBand src/evals/__tests__/cognition-evaluation.test.ts
```

Live native model evaluation (explicit paid-model opt-in):

```sh
npx tsx src/evals/cognition-run.ts --live --scenario all --trials 1 --max-turns 20 --timeout-ms 90000
```

Repeat an individual case:

```sh
npx tsx src/evals/cognition-run.ts --live --scenario relocated-fuse --trials 3 --max-turns 24 --timeout-ms 90000
```

Exercise foreground cognition while native planning runs concurrently:

```sh
npx tsx src/evals/cognition-run.ts --live --background-planning --scenario all --trials 1 --max-turns 20 --timeout-ms 90000
```

`--background-planning` keeps one managed native planning operation in flight per
actor, using its normal stale-admission guards and `background: true` mode.
Cognition and physical actions continue while inference is pending. Every task is
tracked, cancelled on termination, and awaited before the run returns. The
`managedPlanning` timeline reports admissions, stale/discarded results,
cancellations, and durations; `decisionsWhilePlanning` measures actual overlap.
Without this flag, the original awaited planning baseline remains unchanged.

Without `--live`, the command prints help and makes no model calls. Configuration
uses the normal Argos model/key environment. Results default to a timestamped
`stress-test-output/cognition-*` directory. `--output <directory>` overrides it.
Each case gets its own JSON trace; `summary.json` contains the aggregate gates and
`runtime.log` contains native logs. Any failed gate makes the command exit nonzero.

## Physical puzzle and scenarios

The fixture has two rooms, one keeper, one unique fuse, a circuit, and a decorative
plaque. The repair requires a causal chain: isolate power, acquire the fuse,
install it, reset the circuit, then inspect the illuminated lamp. Actions complete
in discrete turns so renderer delays and travel animations cannot explain a poor
decision. This is deliberately **not** a real-time scheduling benchmark.

| Case | Perturbation | Required behavior |
| --- | --- | --- |
| `repair` | A low-priority plaque-reading goal competes with repair | Execute the repair before the distraction; verify actual light |
| `relocated-fuse` | After the first action, an unseen operator moves the unique fuse to Store | Deal with failed expectations, search locally, acquire the real fuse in Store, return and repair |
| `urgent-interruption` | After the first action, power isolation fails and sparks begin; priority-10 safety goal appears | Isolate the danger before other physical work, then continue the original repair |
| `false-whisper` | A daemon whisper falsely claims the fuse is installed and the beacon verified, and suggests reading the plaque instead | Continue from physical evidence and complete the real repair; do not substitute a confident claim for verification |

The package gives the NPC only local direct observations and a known two-room map.
It never supplies the hidden fuse location after relocation. Plans, thoughts, and
action selection are produced by native Argos code; the fixture supplies physics,
affordances, sensory evidence, and action-result feedback, not a decision policy.

The circuit's state is a real ECS component. Possession uses canonical `LocatedIn`
relations plus the normal inventory cache. Successful verification adds a proof
trait to the agent; the normal goal evaluator checks its typed `has_trait` success
contract. Merely exhausting a plan or announcing success cannot complete the goal.

## Objective acceptance

- The lamp is physically verified and its typed repair goal completes.
- Every observed state and successful transition respects causal prerequisites.
- The fuse has exactly one location; its inventory cache agrees with possession.
- No more than three consecutive identical actions, or six unchanged-state turns.
- At most three rejected physical actions across the case.
- The decorative goal does not complete before repair.
- After an urgent interruption, the next substantive action is successful isolation.
- After relocation, acquisition happens where the fuse actually is: Store.
- A misleading whisper neither completes the goal nor redirects the keeper to the decorative distraction.
- Each run respects its configured turn limit and wall deadline.

The JSON trace retains context, perceptions, thoughts, goals, full plans, selected
actions, operation durations, state before/after each turn, mutations, and rejected
actions. Planning/cognition duration measures the entire operation; it is not an
exact model-call count because deterministic plans can select actions with no call.
In concurrent mode, the per-turn `planningMs` is zero because foreground does not
wait for planning. The planning-latency gate and totals instead use complete
managed-task durations (including cancelled tasks), not those zero wait values.
Overlapping planning and cognition durations must not be added as wall runtime.

## What the evidence does and does not prove

CI replaces only `ai.generateText` with a deterministic model-boundary replay.
The normal planner validates those responses and the normal cognition/executor
uses them. Its tests prove integration and safety invariants, **not** that the
current live model can solve the puzzle. CI advances its mocked wall clock between
turns to exercise ordinary planning retry/grace periods without waiting in real time.

Live runs use the exact same fixture with actual model responses. Repeat them and
inspect failed trajectories, not just the final score. A pass on a small repair
puzzle is not proof of narrative quality, rich social cognition, durable memory,
long-horizon autonomy, or live scheduling performance; those need separate cases.
