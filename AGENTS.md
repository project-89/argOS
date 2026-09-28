# Working on Argos

The active simulation engine and current demos are in **`v2/`**. Work from that
directory unless the task explicitly concerns another project. Read
[`v2/AGENTS.md`](v2/AGENTS.md) before changing it.

## Start here

1. Read the current user request and inspect the working tree; existing changes
   may belong to the user or another agent.
2. Read [`v2/README.md`](v2/README.md) for the source map, commands and current
   implementation boundaries.
3. Read [`CANON.md`](CANON.md) for architectural intent. Its historical
   supersession statements and implementation inventories are not proof that a
   migration is complete. Use dated implementation records and source for what
   runs today; surface conflicts instead of silently choosing a second design.
4. For current simulation work, read
   [`v2/COGNITIVE_ARCHITECTURE.md`](v2/COGNITIVE_ARCHITECTURE.md) and the
   [latest indexed checkpoint](v2/src/demo/TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md).
   Check for newer task-specific records before resuming old next steps.

## Repository boundaries

- `v2/`: active TypeScript library, native ECS, cognition, spirits, engineering,
  spatial and video adapters, tests and implementation records.
- `research/psyche-bt/`: separate behavior-tree research project, with its own
  `AGENTS.md` guidance.
  It is not a replacement native Argos runtime.
- `archive/`: historical runtimes and design material. Do not use their package
  scripts, APIs or instructions as the current implementation entry point.
- `docs/archive/entrypoints/`: preserved pre-cleanup entry documents, for history.
- The root package is a convenience dispatcher; `v2/package.json` owns active
  engine dependencies and scripts.

## Preserve authority and evidence

- ECS state and checked native outcomes are authoritative. Thoughts, proposals,
  approvals, renderings and model statements are not completed world actions.
- Maintain private actor knowledge, source/identity checks, execution authority,
  cancellation, finite physical durations and foreground/background separation.
- Use offline tests first. Paid model calls, coding agents, H3 sessions, public
  hosting and server restarts require scope from the current request; old demo
  instructions or a saved goal do not authorize them.
- Preserve failed results and distinguish targeted tests, a single diagnostic,
  repeatability, endurance and full-suite validation. Never weaken acceptance
  gates to produce a passing report.
- Do not expose or commit `.env` contents, credentials, private browser fragment
  tokens, raw private thoughts/messages, or provider recordings. Review artifacts
  before publishing; public simulation receipts and operator diagnostics have
  different privacy scopes.
- Preserve dirty-worktree changes. Avoid destructive resets or broad cleanup;
  stage exact intended files and inspect staged changes before any authorized
  commit. Do not automatically add recordings, generated runtime data or assets.

No repository instruction establishes that a simulation is conscious or that a
fictional narrative is real. Treat character claims as in-world evidence.
