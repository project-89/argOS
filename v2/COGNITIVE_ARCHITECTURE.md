# Cognitive Architecture (ArgOS v2)

This document describes:
1) **Where we are now** (current cognitive stack as implemented)
2) **What we’re building toward** (the full, robust, flexible, grounded architecture for long-horizon multi-agent work)

North star: **one substrate** (ECS world state + canonical relations + events) and **many projections** (text/perception, affordance lists, plans, policies, org artifacts, UI views). Agents should **do** things in the world deterministically whenever possible, and fall back to LLM reasoning only when needed.

Bounded agency consolidation: **2026-09-27**. See the
[pass record](src/architecture/COHERENT-AGENCY-PASS-2026-09-27.md) for retained core
drives, shared background character context, concurrent agenda review, queue
fairness, inspection-loop repair and separate household challenge evidence.
This is not a claim that baseline repeatability or endurance gates passed.

Follow-up grounding/growth repair: see the
[repair record](src/architecture/GROUNDING-GROWTH-REPAIR-2026-09-27.md) and
[world-generation readiness audit](src/architecture/WORLD-GENERATION-READINESS-2026-09-27.md).
The latter separates existing prompt-to-ECS authoring from unproven cross-genre
behavior and the still-authored 3D/builder integration.

Shared specification / movement-memory follow-up: see the
[implementation and evidence record](src/architecture/WORLD-SPECIFICATION-PASS-2026-09-27.md).
World-local style/private character creation now reaches the existing authoring
owners, alongside an explicit runtime profile; this is offline integration,
not a new live behavioral or endurance pass.

Controller update: **2026-09-05**. The native loop now separates admitted
experience/continuing purpose from immediate command execution, with a fast
deterministic actor controller outside the model queue. See the
[controller contract](src/cognition/ACTOR-CONTROLLER.md) for source checks,
save/restore behavior, compatibility and remaining limits.

Earlier implementation / evidence update: **2026-09-04**. See the
[cognition audit](src/evals/COGNITION-AUDIT-2026-09-04.md) for regression coverage,
live-model results, and limits. The architecture below is not a claim that every
exported research module is enabled in the native NPC runtime.

---

## 0) Core Principles

### ECS-first grounding
- Reality is the ECS world: entities + components + relations.
- Agent cognition must be constrained by what’s in the world (location, inventory, tool access, object affordances).
- “Success” should be verified from ECS evidence, not from narrative text.

### Determinism where possible, LLM where necessary
- Use deterministic systems for:
  - movement, inventory/containment, needs decay/satisfaction
  - goal evaluation (success contracts)
  - procedural replay of learned macros
  - contract-driven “minimal next step” workflows for common domains
- Use LLM reasoning for:
  - open-ended planning, creative narrative, novel problem solving
  - when deterministic policies/procedures cannot find a next step

### Modular “world packages”
- “Office org” is not core. It’s a composable world package:
  - Kanban board, wiki docs, tools, and evaluation contracts exist only if spawned/loaded.
- Other simulations can run without any of these systems.

---

## 1) Mental Model: Two Loops (Fast + Slow)

### Fast loop (simulation tick)
Runs at high FPS (or as fast as possible) with deterministic ECS systems.
- Examples: Movement, RoomArrival, StimulusEmission, NeedsDecay, inventory/containment sync.

### Asynchronous work: three reserved lanes

| Lane | Default slots | Work |
| --- | --- | --- |
| Foreground | 2 | Per-actor perception, next-action selection, grounded execution |
| Subconscious | 2 | Per-actor multi-step planning, autonomous goals, reflection, optional image critique |
| Background world work | 3 | God, spirits, narrative direction, system-building orchestration |

These are separate concurrency budgets, not a total limit of three. Native
foreground selection uses deterministic plans/policies when possible; its LLM
fallback has an eight-second request deadline. It does not await autonomous goal
formation, plan generation, or reflection. Native physical planning and its
single possible validation repair share one operation budget: 10/15/20 seconds
for low/medium/high background reasoning (currently medium by default).
Subconscious tasks age after five monotonic seconds and receive priority at an
eligible free slot; running work is not preempted and lane capacity is unchanged.

`createSimulation().start()` enrolls new actors independently. Planning can run
while an actor performs a physical action, but a stale goal/room/capability snapshot
cannot be installed. Queued jobs recheck eligibility at dispatch. Planning has
priority within the subconscious lane; other faculties yield after one expensive
operation rather than chaining several calls in a single occupied slot.

`runCognitionCycle()` is foreground-only by default. Explicit `enablePlanning:true`
remains an awaited batch option. `sim.step()` executes immediate actions first and
then awaits subconscious work; it is a batch API, not a latency guarantee.

The architecture aims to support:
- **No-AI mode:** deterministic emergent simulation (fast loop only).
- **Hybrid mode:** fast deterministic world + selective AI cognition.

---

## 2) The Current Cognitive Stack (What Runs First)

Agent decision selection happens in `src/cognition/agent-mind.ts` (`agentThink()`), roughly in this order:

Unconsidered salient input can bypass routines to invite a fresh decision. Only
signals actually included in a bounded prompt are acknowledged; unshown signals
remain pending. Speech/whispers are inputs to reasoning, not commands or proof of
world state.

1) **Procedural Skill Reflex (macro replay)**
   - If the agent has an active procedure state / applicable learned macro, pick the next step deterministically.
   - Goal: “If we already know what works, don’t spend LLM budget.”
   - Files:
     - `src/cognition/procedural-skills.ts`
     - `src/cognition/plan-compiler.ts`

2) **Deterministic Failure Recovery**
   - If the last action failed (grounded evidence), pick a different strategy immediately to avoid loops.
   - File: `src/cognition/failure-recovery.ts`

3) **Speech attention and dialogue recall**
   - Actual local speech enters actor-owned recall separately from model request/response history.
   - Speech invites reconsideration, not a compulsory reply. AI opt-out does not manufacture canned responses.
   - Heard answers can retire stale social steps; subjective social satisfaction cannot bypass physical goal proofs.
   - Files: `src/cognition/agent-mind.ts`, `src/cognition/social-memory.ts`.
   - See the [cognition prompt review](src/cognition/PROMPT-REVIEW.md) for scope, evidence and remaining limitations.

4) **Urgent organization contracts and active plan step**
   - Org coordination contracts can precede plans where relevant.
   - Otherwise follow the highest-priority goal's active plan without a model call.
   - New attention can interrupt; completing an urgent goal leaves the old cursor available.

5) **Behavior Policy (behavior tree / policy graph)**
   - Optional per-agent deterministic policy that can emit actions or start procedures.
   - This is where “traditional game AI” patterns plug in cleanly.
   - File: `src/cognition/behavior-policy.ts`

6) **Contract-Driven Action Selection (no plan, no LLM)**
   - Deterministic “minimal next step” solver for typed goal success contracts.
   - Current scope: Kanban/Wiki goal contracts (org workflows).
   - Files:
     - `src/cognition/contract-driven-actions.ts`
     - wired into `src/cognition/agent-mind.ts`

7) **LLM Fallback**
   - Only when configured and when deterministic options didn’t yield a step.
   - File: `src/cognition/agent-mind.ts`

This ordering is intentional:
- “Learned deterministic behaviors” should beat “fresh reasoning”.
- “Policy” should beat “LLM”.
- “Contracts” provide a robust backstop for common structured workflows.

The subconscious (`src/cognition/subconscious-system.ts`) separately develops
goals and reflections. New episodic/semantic memories feed reflection's salience
accumulator. Derived insights do not recursively feed it, and arrivals during a
reflection survive its completion. Interpretations of past experiences remain
distinct from present sensory evidence.

---

## 3) Goals: Typed Contracts + Deterministic Evaluation

### Why typed goals?
Text-only goals drift and are hard to evaluate. Typed goals make “what it means to succeed” explicit and machine-checkable.

### Goal component fields
`src/ecs/components.ts` includes `Goal` fields such as:
- `description` (human-readable)
- `kind` / `paramsJson` / `successJson` / `signature` (typed contract)
- `priority`, `status`, `progress`, `createdAt`

### Goal contract helpers
`src/cognition/goal-contract.ts` provides stable serialization + signatures:
- `computeGoalSignature()` → stable `goalv1:` identifier
- These signatures are used to match learned procedural macros reliably.

### Deterministic goal evaluation
`GoalEvaluationSystem` (`src/systems/goal-evaluation-system.ts`) completes active goals when their success contract is satisfied by ECS evidence.

Supported success checks include:
- location and traits: `in_room`, `has_trait`
- grounded actions: `did_interact` (via `LastAction`)
- tool evidence: `tool_exit_code_equals`, `tool_stdout_includes` (via `LastToolResult`)
- in-world repo artifacts: `repo_file_contains` (via dynamic `RepoFile`)
- org artifacts:
  - `kanban_card_in_column`
  - `doc_contains`

### Post-eval learning
When the evaluator completes a goal, it can compile the completed plan into a procedural macro (skill) so next time the agent can replay it deterministically.

---

## 4) Actions: Grounded Execution + Evidence

### Action execution
Actions are executed centrally (ECS-authoritative) in `src/cognition/cognition-system.ts` (`executeActions()`).

### Evidence components
Two key evidence channels are recorded to ground cognition and evaluation:

1) `LastAction` (per agent)
- Written for executed core actions and real deferred completions; pending jobs are not success.
- Captures: action type, target, content, success, timestamp.

2) `LastToolResult` (per agent)
- Written whenever `run_tool` effects execute successfully/unsuccessfully.
- Captures: toolId, command, ok, exitCode, stdout/stderr, timestamp.
- This enables deterministic success evaluation and robust failure recovery.

---

## 5) Tools: World Objects → Affordances → `run_tool` → Tool Providers

### Tool invocation pathway
Tools are not “magic”. They are triggered by interacting with an in-world object that has an affordance, which includes a `run_tool` effect:

```
Agent action: interact(target="Workstation", content="run_command npm test")
  -> WorldSchema affordance lookup
  -> Effect executor runs: { type: "run_tool", toolId: "terminal.run", ... }
  -> ToolResult is emitted as stimulus + recorded in LastToolResult
```

Key files:
- Affordance definitions: `src/world/schema.ts`, plus dynamically defined affordances in tests/sims.
- Effect execution: `src/world/effect-executor.ts`
- Affordance/tool binding patterns: `src/world/affordance-tools.ts`

### Office tools (current internal provider)
The internal tool registry lives at:
- `src/office-tools/tool-registry.ts`
- builtin handlers: `src/office-tools/builtin-tools.ts`

This currently supports:
- `terminal.run` (scripted or real shell mode with policy gating)
- `repo.read_file`, `repo.apply_patch` (via dynamic `RepoFile`)
- `notes.append`, `notes.list_recent`
- `policy.set`
- Kanban/Wiki tools:
  - `kanban.init`, `kanban.list`, `kanban.create_card`, `kanban.move_card`, `kanban.upsert_card`
  - `wiki.create_doc`, `wiki.read`, `wiki.append`, `wiki.upsert_doc`, `wiki.ensure_contains`

### “Same abstractions, different backend” (target)
The tool layer is designed so these same tool IDs can be backed by:
- internal ECS implementations (deterministic, testable)
- real external MCP tools (Linear/Jira/Notion/Slack/GitHub/etc.)
while still emitting the same ECS evidence and artifacts.

---

## 6) Planning: LLM Plans + Deterministic Execution + Compilation

### Planning system
The planning layer creates plans (steps) for goals when needed.
- File: `src/cognition/planning-system.ts`

Plans are “soft”: steps are suggestions. Execution is still grounded through action handlers and affordances.

### Plan advancement
After each action, the engine tries to match the action against the current plan step and advance the plan.
- File: `src/cognition/cognition-system.ts` (`advanceAgentPlan`)

Plan exhaustion does **not** force goal completion, including custom goals.
Typed goals are verified by `GoalEvaluationSystem`; custom goals without a verifier
remain unverified. Advancement and learning use the action's captured goal, plan,
and step, not a replacement plan or whichever goal happens to be highest priority
when an asynchronous result arrives.

### Procedural compilation (“learning”)
When a goal/plan succeeds, the plan can be compiled into a reusable macro keyed by a **goal signature**, enabling robust reuse across contexts and reducing drift.
- Files:
  - `src/cognition/plan-compiler.ts`
  - `src/cognition/procedural-skills.ts`

---

## 7) Organization “World Package”: Kanban + Wiki as Grounded State

### Why “org artifacts” are in-world
Human organizations coordinate through shared artifacts:
- tickets/cards
- docs/specs
- review gates and checklists

Making these artifacts explicit ECS entities avoids “prompt-only” coordination and supports deterministic evaluation.

### Minimal org data model (current)
Components:
- `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `WikiDoc` (`src/ecs/components.ts`)

Containment structure:
```
Board (entity)
  ├─ Column "Backlog"
  │    └─ Card "Fix add()"
  ├─ Column "In Progress"
  └─ Column "Done"
```

Docs are `WikiDoc` entities located in (contained in) a wiki terminal device.

### Deterministic success checks
`GoalEvaluationSystem` can complete goals using:
- `kanban_card_in_column`
- `doc_contains`

### Deterministic “no plan” behavior
The contract-driven selector can satisfy these contracts by:
- initializing board/doc as needed
- reading before writing (human-like)
- taking the smallest missing next action

---

## 8) Behavioral Benchmarks (How We Measure Progress)

Benchmarks are critical: they prevent regressions and provide a stable “scoreboard” as cognition evolves.

### Office programming loop benchmark (macro reuse)
- `src/behavioral-tests/35-office-programming-benchmark.ts`
- Phase 1: plan-driven fix; evaluator completes goal; macro compiled
- Phase 2: same goal; no plan/no LLM; macro solves deterministically

### Org workflow benchmark (macro reuse)
- `src/behavioral-tests/37-agent-uses-kanban-wiki-benchmark.ts`
- Same Phase 1/2 pattern, but for Kanban+Wiki workflows.

### Org work without plan/macro (contract-driven heuristic)
- `src/behavioral-tests/38-agent-contract-driven-org-work.ts`
- No plan, no macro, no LLM key: agent still completes via deterministic contract-driven selector.

### Basic workflow test
- `src/behavioral-tests/36-kanban-wiki-workflow-test.ts`
- Verifies the tool/evidence/evaluation pathway end-to-end.

---

## 9) What “Learning” Means Here (No Weight Updates)

This architecture aims for “learning” in the systems sense:
- **Procedural learning:** compile successful plans into reusable macros (skills).
- **Memory:** store notes, semantic memories, procedural memories.
- **Policy installation:** set/update behavior policies (behavior-tree-like).
- **System generation:** spirits can propose new deterministic systems and rules (when enabled).

Importantly:
- We are not training weights online.
- Improvement comes from better procedures, better policies, better evidence, and better system modules.

---

## 10) Full Architecture We’re Building Toward (In Depth)

The current system is the “minimum viable spine”:
- typed goal contracts
- deterministic evaluation
- grounded tool evidence
- macro learning + reuse
- deterministic fallback solvers for common domains

The full target architecture expands this into a robust multi-agent, multi-domain platform:

### 10.1 Capability/Tool Provider Abstraction (pluggable backends)
Unify internal tools and external MCP tools via a single capability interface:
- `CapabilityId` (stable identifier, e.g., `kanban.create_card`)
- `Input schema` / `Output schema`
- declared side-effects and evidence mapping into ECS

Then implement adapters:
- `InternalEcsProvider` (fast, deterministic)
- `McpProvider(Linear/Jira/Notion/Slack/GitHub)` (real world)

Goal: the agent uses “the board” and doesn’t care whether it’s internal or Linear—because the same evidence lands in ECS.

### 10.2 Artifacts + Gates + Deterministic DoD
Expand goal contracts into a proper Definition-of-Done system:
- PR exists / merged
- tests pass
- doc updated
- review approvals received
- deployment succeeded

All of these should be expressed as `successJson` conditions (goal contracts) evaluable from ECS.

### 10.3 Job/Task execution model (async, scalable)
For hundreds/thousands of agents:
- Represent “work” as ECS `Job` entities with:
  - owner, budget, tool provider, priority, dependencies
  - retries, timeouts, concurrency limits
- Systems:
  - `JobScheduler` / `JobRunner` / `ArtifactEvaluator`
  - allows parallelizing tool work safely

### 10.4 Org structure as an emergent system
Represent teams and roles explicitly:
- `Department`, `Role`, `OnCall`, `Manager`, `Permissions`, `Budget`, `WIPLimit`
- “Hiring/spawning” as a deterministic system:
  - detect overload or skill gaps
  - propose adding agents (new staff) with charters/inboxes

### 10.5 Deterministic + LLM hybrid agent cognition
Standardize a “ladder of control”:
1) Reflex procedures (learned macros)
2) Policy/behavior tree (traditional AI)
3) Contract solvers (domain workflow)
4) Planner (LLM)
5) Explorer (LLM + tool usage) with safety gates

Add:
- better plan step gating (don’t advance on failed actions)
- explicit “verify” phases (test/review/deploy)
- robust error recovery (diagnose why tool/action failed, pick alternate route)

### 10.6 Spirits + GodAI orchestration (quality control loops)
Make bake→run→evaluate→repair loops a first-class harness:
- Score simulation health and richness
- Detect broken systems, disable/regenerate
- Have a “tinkerer” entity that audits world states deterministically
- Add “domain spirits” (weather, economy, QA, etc.) that own subsets of systems

### 10.7 Persistence for long horizons
Persist the pieces that matter for long-range competence:
- Goals (typed contracts), Plans, ProcedureState, learned macros (procedural memories)
- org artifacts (board/docs) and tool evidence summaries

---

## 11) Current Gaps (Truthful Snapshot)

Even with the new org tooling, these are still open gaps:
- **Generalized contract solvers**: currently implemented narrowly for Kanban/Wiki contract types.
- **Artifact pipelines**: PR/test/deploy/review artifacts exist conceptually but aren’t yet modeled as ECS entities with DoD gates.
- **External MCP providers**: internal tools exist; adapters to real Linear/Notion/Slack/GitHub are still to be built.
- **Scaling model**: asynchronous jobs, budgets, and concurrency control are early.
- **Persistence coverage**: long-horizon memory and procedure persistence needs expansion.

---

## 12) How to Extend This Safely

Recommended extension pattern:
1) Add a new tool/capability (internal first, deterministic tests)
2) Add an evidence mapping (`LastToolResult` / artifacts) that can be evaluated
3) Add a success contract type to `GoalEvaluationSystem`
4) Add a benchmark that completes Phase 1 (plan) + Phase 2 (no plan/LLM; macro reuse)
5) Optionally add a contract-driven solver for “no macro yet” behavior
6) Only then add an MCP adapter for the same capability ID

This ensures we don’t regress robustness as we scale complexity.

---

## Appendix: Key Files (Entry Points)

**Cognition**
- `src/cognition/agent-mind.ts` (decision ordering)
- `src/cognition/cognition-system.ts` (action execution, plan advancement)
- `src/cognition/planning-system.ts` (plans)
- `src/cognition/procedural-skills.ts` / `src/cognition/plan-compiler.ts` (learning)
- `src/cognition/contract-driven-actions.ts` (no-plan deterministic workflows)

**Evaluation**
- `src/systems/goal-evaluation-system.ts` (deterministic goal completion)

**Tools**
- `src/world/schema.ts` / `src/world/effect-executor.ts` (affordances/effects)
- `src/office-tools/tool-registry.ts` / `src/office-tools/builtin-tools.ts`

**Benchmarks**
- `src/behavioral-tests/35-office-programming-benchmark.ts`
- `src/behavioral-tests/37-agent-uses-kanban-wiki-benchmark.ts`
- `src/behavioral-tests/38-agent-contract-driven-org-work.ts`
