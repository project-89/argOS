# Argos — living worlds

Argos is an experimental generative simulation engine: an ECS world inhabited
by characters with private memories, intentions and ongoing activities. God,
spirits and coding daemons can propose and build new mechanics within explicit
host permissions. Text, 3D and video are views of the same underlying world.

**The active implementation is [`v2/`](v2/README.md).** Start there for setup,
library usage, current demos and tests. Agents should first read
[`AGENTS.md`](AGENTS.md), then [`v2/AGENTS.md`](v2/AGENTS.md).

## Current entrypoints

| Start here for… | Document |
| --- | --- |
| Running or developing the engine | [Argos v2 README](v2/README.md) |
| Architectural intent | [CANON](CANON.md) |
| Implemented cognition | [Cognitive architecture](v2/COGNITIVE_ARCHITECTURE.md) |
| Current implementation/evidence checkpoint | [Tick cost and Narrator delivery](v2/src/demo/TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md) |
| Interactive 3D town and other demos | [Demo index](v2/src/demo/README.md) |
| God/spirit/coding authority in the town | [World development](v2/src/demo/WORLD-DEVELOPMENT.md) |

CANON is a design authority, not a claim that every target or migration is
implemented. Its older inventories and supersession statements must be read
alongside dated implementation records and source. Current cognition documents
remain useful implementation references; do not silently discard them because
an older design document names their predecessors.

## Quick start

```sh
cd v2
npm ci
npm run demo:spatial
```

This plain spatial command is a local manual physics fixture without live AI
or H3. Open its printed private localhost URL. Live NPCs, God requests, coding
jobs and video use separate modes and can incur provider costs; consult the
[v2 guide](v2/README.md) before enabling them.

The root package only delegates convenience commands. Install and manage active
engine dependencies inside `v2/`.

## Status and scope

The current work prioritizes simulation quality, grounded character behavior,
temporal correctness and useful world development. A successful test or demo
does not establish open-ended realism. The fresh ten-trial behavioral baseline
and ten-minute endurance gates remain open at the linked checkpoint; targeted
test results are documented without implying a full-suite or live-quality pass.

The 3D renderer projects authoritative ECS outcomes. Imported assets do not
automatically acquire gameplay behavior. WebXR/VR, expanded asset pipelines and
Aureum integration remain proposed work, not capabilities claimed here.

## Repository layout

- [`v2/`](v2/README.md): active engine, local applications and implementation records.
- [`research/psyche-bt/`](research/psyche-bt/README.md): separate behavior-tree
  research project; read its own agent guidance before working there.
- `archive/`: preserved older runtimes/design material, including the former
  root runtime in `archive/argos-v1/`. Not the current setup path.
- [`docs/archive/entrypoints/`](docs/archive/entrypoints/README.md): exact copies
  of the former root and oil-demo entry documents.

Private credentials, session URLs/tokens, raw provider prompts and recordings
do not belong in public documentation. Keep failed evidence and review artifact
privacy before sharing. See [agent guidance](AGENTS.md) for working boundaries.

## License

Historical license metadata is inconsistent: the older README says MIT while
the former root package says ISC. This cleanup does not resolve or change that
licensing. Confirm it before redistribution. Third-party asset licenses and
provenance are retained alongside the assets.
