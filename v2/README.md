# Argos v2 — living simulation engine

This is the active Argos implementation. One ECS world supports inhabitants with
private memories and intentions, deterministic physical interactions, and
God/spirit/coding workflows that can extend its mechanics. Text, the spatial 3D
view and H3 adapters are presentations of that world, not separate simulations.

This is a research prototype. General autonomous storytelling, unrestricted
world growth and sustained low-latency behavior are not established merely
because the components exist.

## Read in this order

| Document | Purpose |
| --- | --- |
| [Agent guidance](AGENTS.md) | Editing, authority, privacy and verification rules |
| [CANON](../CANON.md) | Architectural intent and historical design decisions |
| [Cognitive architecture](COGNITIVE_ARCHITECTURE.md) | Implemented cognition and source map |
| [Actor controller](src/cognition/ACTOR-CONTROLLER.md) | Current ownership, selection, admission and handoffs |
| [Current checkpoint](src/demo/TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md) | Latest indexed evidence, corrections, remaining work |
| [Demo index](src/demo/README.md) | Current spatial profiles and older experiments |

CANON's older supersession language does not turn its target design into an
implemented fact. The actively maintained cognition document and dated
checkpoints describe the current runtime. When these disagree, inspect the
owners and record the discrepancy rather than reviving an obsolete subsystem.

At the current checkpoint, the ten-trial behavioral baseline and ten-minute
endurance requirements remain **open**. Targeted regression results are recorded
with their scope; this README does not claim the entire repository suite passes.

## Local setup and offline checks

Run from this directory. Dependencies and scripts are in [package.json](package.json).

```sh
npm ci
npm run typecheck
npm test -- --runInBand --runTestsByPath src/runtime/__tests__/scheduler-readiness.test.ts src/runtime/__tests__/queue-execution-settlement.test.ts src/cognition/__tests__/coordination-review.test.ts
```

The selected tests use offline fixtures. `npm test -- --runInBand` runs the
broader Jest suite; historical scripts outside that suite have different
behavior. Inspect any new selection or executable for provider/host effects.
See [pressure evals](src/evals/README.md) for separate offline and paid runners.

## See the world without model calls

```sh
npm run demo:spatial
```

Open the printed `SPATIAL_DEMO_READY` localhost URL, including its private
fragment token. This plain mode is a manual physics/interaction fixture, not
autonomous NPC behavior. It opens ready; it does not use H3.

The [spatial guide](src/demo/SPATIAL-WORLD.md) covers movement, interaction,
rendering, save limitations and the small-town profiles. Saved evidence is not
automatically a fully resumable spatial session.

## Live town — explicitly paid

Only run when a live test is authorized and its bounds are understood:

```sh
ARGOS_SPATIAL_SECONDS=300 npm run demo:spatial -- --live --lovecraft --develop
```

This prepares [Saltmere](src/demo/SALTMERE.md) with the broader
[development profile](src/demo/WORLD-DEVELOPMENT.md). Click **Start world** to
run live NPC/spirit cognition. That profile also permits bounded God requests
and managed coding jobs; it is not an unrestricted world-builder. Both wall and
simulation limits apply. Model/provider delay may mean fewer simulated seconds
than the wall limit.

Configure `GOOGLE_GENERATIVE_AI_API_KEY` locally for this live spatial runner;
do not print or commit it. The model selection lives in `src/llm/config.ts`.
H3 runners additionally require their video provider configuration and are not
part of this command. Manual NPC mode combined with `--develop` is **not** an
assurance of zero AI spending: requested God/coding work can still invoke AI.

## Library and source owners

Use **[`createSimulation`](src/index.ts)** rather than copying a demo's runtime.
Its configuration explicitly controls AI, world specification, runtime profile,
spirits/evolution, coding backends and host tools. The lifecycle is `start`,
`stop`, and a bounded `drainPendingOperations` after stop. `step` is a batch API,
not a real-time latency guarantee. `createSimulationFromPrompt` supports
model-backed authoring; it is not an offline constructor.

| Location | Responsibility |
| --- | --- |
| `src/ecs/`, `src/world/`, `src/systems/` | Physical data, relations, capabilities and native/generated mechanics |
| `src/runtime/` | Clock, task lanes, committed outcomes, cancellation and evolution coordination |
| `src/cognition/` | Perception, private memory, continuing activity, goals, planning and action selection |
| `src/god/`, `src/spirits/` | World review, grounded proposals, narration and bounded intervention |
| [src/engineering/](src/engineering/README.md) | Coding jobs, validation, admission, hot loading and repair |
| `src/persistence/` | World serialization and checked restoration |
| `src/demo/`, `src/demo/spatial-client/`, `src/rendering/` | World packages, local UI and presentation adapters |

The 3D catalog currently uses existing licensed assets and authored geometry.
New meshes do not automatically gain collision, navigation, affordances or
animation semantics. See the
[rendering/asset plan](src/demo/SPATIAL-RENDERING-AND-ASSET-PIPELINE.md) for that
boundary; VR and Aureum integration are plans, not shipped capabilities.

## Evidence and history

Implementation records live beside their owners and under `src/architecture/`.
Local `recordings/`, `stress-test-output/`, saved worlds and provider traces can
contain private data and are not automatically portable or public artifacts.
Keep failure evidence; distinguish an approved proposal, a committed effect,
an NPC's use of it, and a demonstrated behavioral improvement.

Earlier runtimes and superseded root guidance are indexed by the
[repository README](../README.md). `research/psyche-bt/` is a separate research project,
not an alternate implementation to wire into this runtime without a plan.
