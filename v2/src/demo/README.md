# Argos demos and simulation testbeds

Run commands from **`v2/`**. For the library, architecture, tests and editing
rules, begin with the [v2 README](../../README.md). Demos use the existing
`createSimulation` entry and native outcomes; they are not separate authorities.

## Current focus: the spatial world

| Guide | Purpose |
| --- | --- |
| [Spatial world](SPATIAL-WORLD.md) | Local 3D viewer, physical interactions and limitations |
| [Town foundation](TOWN-MILESTONE.md) | Authored homes, public places and ten residents |
| [Saltmere](SALTMERE.md) | Coastal mystery using the existing town/assets |
| [Saltmere Settlement](SETTLEMENT-CHECKPOINT.md) | Tents on bare land: habits, spirits, growth, the town carried between sessions |
| [World development](WORLD-DEVELOPMENT.md) | Broader God chat, spirit review and managed coding profile |
| [Rendering and assets](SPATIAL-RENDERING-AND-ASSET-PIPELINE.md) | Art direction, asset contracts and proposed VR work |
| [Aureum and builder plan](AUREUM-INTEGRATION-AND-IN-WORLD-BUILDER-PLAN.md) | Proposed integration, not a shipped second world-state owner |

### Manual, no-provider preview

```sh
npm run demo:spatial
```

This plain mode is a manual physics/interaction fixture. Open the printed
`SPATIAL_DEMO_READY` link, including its private fragment token. It starts ready
and uses no H3. Manual input is not autonomous behavior.

### Authorized live development session

```sh
ARGOS_SPATIAL_SECONDS=300 npm run demo:spatial -- --live --lovecraft --develop
```

Live NPC/spirit cognition begins after **Start world**. God/coding work has the
profile's explicit grants and finite budgets. Inspect
[World development](WORLD-DEVELOPMENT.md) before using it. Without `--develop`,
the Saltmere profile remains narrower. Omitting `--live` while retaining
`--develop` does **not** guarantee no spending: God requests and coding jobs can
still invoke AI.

The server is loopback-only, not a public or mobile deployment. Do not publish
its token or restart an existing user session without authorization. Save files
are diagnostic evidence; complete spatial save/resume is not claimed.

## Latest evidence and next steps

Read [Tick cost, queue pressure and Narrator delivery](TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md)
first. It corrects the previous delivery interpretation: advice reached the
NPC's prompt, but a matching intention predated it, so a caused behavioral
change was not demonstrated. It also records local performance repairs without
claiming a measured live speedup.

Earlier records remain available:

- [Narrator timing](NARRATOR-TIMING-CHECKPOINT.md).
- [Town crisis repair](TOWN-CRISIS-REPAIR.md) and [results](TOWN-CRISIS-RESULTS.md).
- [World development checkpoint](WORLD-DEVELOPMENT-CHECKPOINT.md).
- [Saltmere diagnosis](SALTMERE-LIVE-DIAGNOSIS-2026-09-27.md).

These are dated observations, not automatic instructions to launch another run.
The ten-trial baseline and ten-minute endurance gates remain open. Preserve
failed and unfavorable evidence; do not attribute operator events to spirits.

The crisis harness has explicit modes:

```sh
# Provider-forbidden injection/recorder check; not an autonomous behavior test.
npx tsx src/demo/spatial-town-crisis-check.ts --offline

# Paid: ONE bounded crisis observation, only after explicit authorization.
npx tsx src/demo/spatial-town-crisis-check.ts --live
```

Read its prospective protocol before running. Wall and simulation bounds differ;
the live mode also admits bounded coding jobs, whose inference accounting is
separate from the foreground provider-request cap. Do not loop paid retries.

## Other focused testbeds

| Guide | Scope |
| --- | --- |
| [Blackout](BLACKOUT-MILESTONE.md) | Native repair puzzle and retained-memory comparisons |
| [Household check](HOUSEHOLD-CHECK.md) | Character concerns and grounded spirit usefulness |
| [Generative agents](GENERATIVE-AGENTS.md) | Multi-character cognition experiments |
| [Escape room](ESCAPE-ROOM.md) | Longer puzzle chains and deterministic outcomes |
| [Phone demo](PHONE-DEMO.md) | Physical phone perception, read and reply |
| [Apartment sitcom](APARTMENT-SITCOM.md) | Earlier multi-character interactive scenario |
| [Sitcom renderer](SITCOM-RENDERER.md) | H3 presentation adapter and known constraints |

The older oil/H3 introduction is preserved in the
[historical entrypoint archive](../../../docs/archive/entrypoints/demo-README.pre-onboarding-2026-09-27.md).
Its commands and behavior describe that focused scenario, not the current town.
Enabling a feature in one runner does not enable it in every runner.

Recordings may contain private thoughts, correspondence, prompt bodies and local
access tokens. Keep them private by default; publish only reviewed artifacts.
Public physical receipts, authenticated operator panels and character knowledge
remain separate projections.
