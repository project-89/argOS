# Argos v2 agent guidance

This is the active engine. Parent [repository guidance](../AGENTS.md) also applies.
Read [README.md](README.md) before choosing a runner or architectural path.

## Establish the current state

- [`../CANON.md`](../CANON.md) describes the target architecture, not a completed
  implementation checklist. [`COGNITIVE_ARCHITECTURE.md`](COGNITIVE_ARCHITECTURE.md)
  maps implemented cognition; the
  [actor-controller contract](src/cognition/ACTOR-CONTROLLER.md) describes action
  ownership and handoffs. Reconcile changes with both intent and working code.
- The [current checkpoint](src/demo/TICK-AND-NARRATOR-DELIVERY-CHECKPOINT.md)
  records latest indexed repairs, corrections, retained failures and exact next
  steps. Older `*-GOAL.md` and dated pass files are historical unless the current
  task explicitly resumes them. Do not infer active execution authorization.
- The fresh ten-trial behavioral baseline and actual ten-minute endurance gates
  remain open at this checkpoint. Offline tests and short live observations do
  not close them.

## Owners and invariants

- Use `src/index.ts::createSimulation` as the library entry. Do not create a new
  application-specific controller or parallel authoritative world.
- ECS components/relations hold physical state. Systems produce checked native
  outcomes. World packages expose capabilities; renderers project them.
- Fast `ActorControl` and deterministic physical systems must not await model
  calls. Foreground cognition, subconscious planning/reflection and background
  world engineering retain reserved scheduling lanes and single-flight rules.
- An interpretation can persist while a proposed command becomes invalid.
  Keep intention, action admission, execution, completion and remembered evidence
  distinct. Never make speech about an action prove the action occurred.
- Simulation time controls fictional durations. Wall/monotonic clocks control
  provider deadlines, compute throttles and diagnostics. Do not bank elapsed wall
  time into unobserved physical motion or silently mix clock domains.
- Pending/cancelled/stale work cannot regain authority after stop, source reset,
  actor replacement or capability changes. Actual executor settlement matters;
  cancellation alone must not free a still-running worker reservation.
- Respect incomplete knowledge: unread phone bodies, another actor's private
  memory/thoughts and concealed objects are not public sensory facts. The
  authenticated operator view is not an NPC's perception or public scene feed.
- God/spirits/builders operate within the chosen profile's grants. Approval is
  not construction; construction is not usefulness. Preserve independent tests,
  bounded admission, isolated execution, live validation and failed evidence.

## Verification and runtime safety

Run commands **from `v2/`**. Start with the focused offline suites for the files
changed; [README.md](README.md) contains verified command names and examples.

```sh
npm run typecheck
npm test -- --runInBand --runTestsByPath src/runtime/__tests__/scheduler-readiness.test.ts src/runtime/__tests__/queue-execution-settlement.test.ts
```

Do not blindly execute a runner because it is named `test`, `demo`, `stress` or
`eval`: some call paid models, host tools or coding backends. Inspect its mode
and no-provider guard first. `--live`, `test:llm`, H3 and coding jobs are explicit
paid/external work. Even manual NPCs with `--develop` can use AI through God or
engineering requests. Do not switch models or increase concurrency to hide a
regression without an explicit agreed change.

Keep each live check prospectively bounded: scenario, duration, request/build
budget, observation questions and stop/drain behavior. No automatic retries or
overnight runs. Preserve original failures alongside repairs. Report the exact
test selection, models/modes and remaining acceptance gates.

Do not restart the user's running browser demo merely because sources changed.
Use a fresh authorized session when appropriate and identify which version it
runs. Keep localhost tokens, raw prompts and private recordings out of commits
and public responses. Do not alter unrelated work or delete evidence during
cleanup. Inspect `git status` and exact staged files before an authorized commit.
