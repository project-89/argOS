# ArgOS v2 Roadmap

**Last updated:** 2026-03-25

## Vision

ArgOS is a **self-building simulation engine**. Give it a seed phrase -- "a medieval port city", "two functioning neurons", "a corporate office" -- and it generates everything the simulation needs: components, systems, affordances, behavior policies, relationships, rules. Then it autonomously evolves and maintains the simulation through an eight-spirit hierarchy, without hardcoded game mechanics or pre-built subsystems. The engine figures out what the simulation needs and builds it.

## Table of Contents

- [Current State](#current-state)
- [Phase 0: Quick Wins](#phase-0-quick-wins-day-1)
- [Phase 1: Generative Vocabulary](#phase-1-generative-vocabulary)
- [Phase 2: Generative Behavior Policies](#phase-2-generative-behavior-policies)
- [Phase 3: Closed Evolution Loop](#phase-3-closed-evolution-loop)
- [Phase 4: System Baker Hardening](#phase-4-system-baker-hardening)
- [Phase 5: Agent Cognition Depth](#phase-5-agent-cognition-depth)
- [Phase 6: Social and Relationship Fabric](#phase-6-social-and-relationship-fabric)
- [Phase 7: Meta-Simulation Intelligence](#phase-7-meta-simulation-intelligence)
- [Phase 8: Infrastructure Hardening](#phase-8-infrastructure-hardening)
- [Phase 9: Self-Modifying Cognition](#phase-9-self-modifying-cognition)
- [Phase 10: World Transformation and Spatial Depth](#phase-10-world-transformation-and-spatial-depth)
- [Dependency Graph](#dependency-graph)
- [Timeline Summary](#timeline-summary)

---

## Current State

### What Works

- **Genesis mode** creates worlds from seed text (rooms, agents, objects, components, systems)
- **System baker** (`src/god/system-baker.ts`, 2244 lines) generates TypeScript ECS systems -- ~85% compile rate, ~50% functional rate
- **Behavior policy engine** (`src/cognition/behavior-policy.ts`, 691 lines) with rich node types: `weighted_random`, `interact_any_affordance`, `social_visit`, anti-repetition conditions
- **Spirit self-evolution pipeline**: Watcher observes gaps -> Architect designs -> Baker generates -> Systems run
- **Unified component registry** (`src/ecs/component-registry.ts`) makes dynamic components first-class BitECS citizens
- **God agent** (`src/god/god-agent.ts`, 8066 lines) with 132 tools covering entity creation, state mutation, systems, spirits
- **Dual-loop architecture** (`src/runtime/simulation-loop.ts`): 20Hz deterministic ECS + async AI task queue
- **Observation aggregator** (`src/spirits/observation-aggregator.ts`): typed gap reporting from all spirits
- **Centralized LLM config** (`src/llm/config.ts`): Gemini 3.1 Pro for planning/design, Flash for agent cognition
- Wait actions reduced from 50% to 17% through behavior system improvements

### Critical Gaps

| # | Category | Gap | Impact |
|---|----------|-----|--------|
| 1 | Architecture | System baker generates ECS systems but NOT affordances, traits, relationship types, behavior policies, or cognitive patterns | Genesis creates a skeleton, not a living world |
| 2 | Architecture | Hardcoded vocabulary: 30 affordances, ~50 traits, 7 behavior templates, 1 relationship type, 5 sensory modalities | Every simulation is constrained to the same vocabulary |
| 3 | Architecture | No meta-simulation reasoning | Engine can't analyze seeds to determine needed subsystems |
| 4 | Cognition | Memory/beliefs/goals stored but never feed back into action selection | Agents have amnesia despite having memory components |
| 5 | Cognition | Behavior policies assigned once from role and never evolve | Agents never learn or adapt |
| 6 | Architecture | Spirit evolution feedback loop not closed (baked systems never verified) | Spirits build blindly, never learn from failures |
| 7 | Architecture | Watcher->Architect uses brittle regex parsing | Structured proposals lost in translation |
| 8 | LLM | `agent-mind.ts` line 29: `google("gemini-2.5-flash")` ignoring centralized config | Stale model, wasted API spend |
| 9 | LLM | Agent cognition temperature 0.8 | Too high for structured JSON output, causes parse failures |
| 10 | LLM | Greedy regex JSON parsing causes 15-25% silent failures -> "wait" actions | One in six agent decisions is lost |
| 11 | LLM | Zero-shot agent prompts | No few-shot examples for action format |
| 12 | LLM | Daemon token budget only 50 tokens | Unusably small for any real observation |
| 13 | LLM | Agent context missing relationships, knowledge graph, environmental state | Agents are blind to their social and physical world |
| 14 | Simulation | No genuine relationships (only surface impressions) | No trust, history, gossip, faction dynamics |
| 15 | Simulation | No skill progression | Agents don't learn or improve at tasks |
| 16 | Simulation | No economic system connected to agent behavior | Trade, currency, resource scarcity all absent |
| 17 | Simulation | Room-based spatial model only | No distance, travel time, continuous space |
| 18 | Infrastructure | ~15 responsive agent ceiling | Cognition bottleneck caps scale |
| 19 | Infrastructure | No circuit breakers for API timeouts | One slow API call blocks the entire agent queue |
| 20 | Infrastructure | No atomic persistence writes | Crash during save = corrupted state |
| 21 | Infrastructure | Entity ID reuse race conditions with async AI tasks | Stale EIDs from pre-async state cause wrong-entity writes |

---

## Phase 0: Quick Wins (Day 1)

**Goal:** Fix the low-hanging LLM engineering issues that directly cause broken agent behavior. These are 2-3 hours of work with massive impact on simulation quality.

**Dependencies:** None
**Estimated effort:** S (2-3 hours)

### 0.1 Fix hardcoded model in agent-mind.ts

**Complexity:** S
**File:** `src/cognition/agent-mind.ts`

Line 29 hardcodes `google("gemini-2.5-flash")`, ignoring the centralized config in `src/llm/config.ts` that already defines `agentModel` as `google("gemini-3-flash-preview")`.

**Tasks:**
- Replace `const model = google("gemini-2.5-flash")` with `import { agentModel } from "../llm/config"` and use `agentModel` throughout
- Remove the `import { google } from "@ai-sdk/google"` that is now unused
- Verify no other files bypass the centralized config: grep for `google("gemini` across all source files

**Success criteria:** `grep -r 'google("gemini' src/ --include='*.ts'` returns only `src/llm/config.ts` and `src/systems/system-loader.ts` (which needs its own fix, tracked separately)

### 0.2 Lower agent cognition temperature

**Complexity:** S
**File:** `src/cognition/agent-mind.ts`

The `generateText` call for agent cognition uses temperature 0.8. For structured JSON output (action selection), temperature should be 0.2-0.4 to reduce parse failures while preserving some variety in dialogue.

**Tasks:**
- Find the `generateText` call in `processAgentCognition` and reduce temperature to 0.3
- Add temperature as a named constant at top of file: `const AGENT_COGNITION_TEMPERATURE = 0.3`
- Add a separate higher temperature for speech/think content generation if these are separate calls

**Success criteria:** JSON parse failure rate for agent actions drops below 5% (from current 15-25%). Measurable by counting "wait" fallbacks in a 120s simulation run.

### 0.3 Balanced-brace JSON extraction everywhere

**Complexity:** S
**Files:** `src/cognition/agent-mind.ts`, `src/god/system-baker.ts`

The system baker already has a proper balanced-brace `extractJSON` function (lines 26-79 of `system-baker.ts`). Agent cognition still uses greedy regex that matches the first `{` to the last `}`, which fails when the LLM wraps JSON in explanation text.

**Tasks:**
- Extract the balanced-brace `extractJSON` from `system-baker.ts` into a shared utility: `src/llm/json-extract.ts`
- Replace the greedy regex JSON parsing in `agent-mind.ts` with the shared `extractJSON`
- Add Zod schema validation for agent action output: `z.object({ type: z.enum([...]), target: z.string().optional(), content: z.string().optional() })`
- On validation failure, retry once with a corrective prompt ("Your response was not valid JSON. Respond with ONLY a JSON object matching this schema: ...")

**Success criteria:** Zero silent JSON parse failures in a 120s simulation run. Every agent action is either successfully parsed or explicitly falls back to LLM retry.

### 0.4 Few-shot examples in agent prompts

**Complexity:** S
**File:** `src/cognition/agent-mind.ts`

Agent prompts are zero-shot -- no examples of correct output format. LLMs perform dramatically better with 2-3 examples.

**Tasks:**
- Add 3 few-shot examples to the agent cognition system prompt showing correct action JSON for different scenarios (move, interact, speak)
- Include one example showing how to handle "nothing interesting to do" (observe or think, NOT wait)
- Place examples after the action format description, before the actual context

**Success criteria:** Agent action variety increases. In a 120s run, no single action type exceeds 40% of total actions (currently "wait" alone hits 17%, previously 50%).

### 0.5 Increase daemon token budget

**Complexity:** S
**Files:** `src/spirits/agent-daemon.ts`

Current `maxOutputTokens: 50` is too small for any useful observation. Daemons can't even form a complete sentence.

**Tasks:**
- Increase daemon `maxOutputTokens` to 200 (sufficient for a paragraph of observation)
- If cost is a concern, reduce daemon observation frequency rather than crippling output quality

**Success criteria:** Daemon observations produce coherent, complete text that the Watcher spirit can actually use for gap detection.

---

## Phase 1: Generative Vocabulary

**Goal:** Make genesis (and spirit evolution) generate the full simulation vocabulary -- affordances, traits, actions, relationship types -- not just rooms, agents, and objects. This is the single highest-leverage architectural change: it transforms ArgOS from "simulation with a fixed verb set" to "simulation that invents its own verbs."

**Dependencies:** Phase 0 (clean LLM pipeline)
**Estimated effort:** L (1-2 weeks)

### 1.1 Runtime affordance registration

**Complexity:** M
**Files:** `src/world/schema.ts`, `src/cognition/action-registry.ts`

Currently `BASE_AFFORDANCES` in `schema.ts` is a hardcoded `Record<string, AffordanceDefinition>` with 30 entries (examine, take, drop, open, close, lock, unlock, eat, drink, sit, etc.). Genesis can't add new ones.

**Tasks:**
- Add a mutable `runtimeAffordances: Map<string, AffordanceDefinition>` alongside `BASE_AFFORDANCES`
- Create `registerAffordance(def: AffordanceDefinition)` and `getAffordance(name: string)` that check runtime map first, then fall back to base
- Create `listAllAffordances()` that merges both sources
- Wire `ActionRegistry.getAvailableAffordances()` to include runtime-registered affordances
- Add `removeAffordance(name: string)` for spirit-driven evolution (can only remove runtime affordances, not base ones)
- Persist runtime affordances to `data/affordances/` as JSON (same pattern as `data/components/`)

**Success criteria:** A generated system or spirit can call `registerAffordance({ name: "forge", requires: ["forgeable", "hasAnvil"], effects: [...] })` and agents immediately see "forge" as an available action on objects with matching traits.

### 1.2 Runtime trait registration

**Complexity:** S
**Files:** `src/world/schema.ts`, `src/ecs/components.ts`

Traits are currently string arrays stored in `Traits.active[eid]` as JSON. There's no registry of valid traits -- they're just strings. This is already flexible, but there's no way for the LLM or spirits to discover what traits are semantically meaningful.

**Tasks:**
- Create `src/world/trait-registry.ts` with `TraitDefinition { name: string, description: string, category: string, enablesAffordances: string[], incompatibleWith: string[] }`
- Register base traits (the ~50 currently hardcoded across affordance `requires` fields and behavior templates)
- Add `registerTrait(def: TraitDefinition)` for runtime addition
- Add `listTraits()` and `getTraitInfo(name: string)` for LLM prompt context
- Wire trait registry into affordance matching: affordance `requires: ["forgeable"]` should validate that "forgeable" is a registered trait

**Success criteria:** `listTraits()` returns all traits with descriptions. When genesis creates a new affordance requiring trait "radioactive", the trait is auto-registered with inferred properties.

### 1.3 Runtime relationship type generation

**Complexity:** L
**Files:** `src/ecs/relations.ts`, `src/ecs/component-registry.ts`

Currently there is exactly one relationship type beyond the spatial ones (`ContainedIn`, `OccupiedBy`, etc.): impressions stored as string blobs in the `Impression` component. BitECS `createRelation` supports typed relationships with data stores, but this is unused for social relationships.

**Tasks:**
- Create `src/ecs/relationship-registry.ts` with `RelationshipTypeDefinition { name: string, description: string, dataFields: Record<string, "number" | "string">, isExclusive: boolean, autoRemoveSubject: boolean }`
- Implement `registerRelationshipType(def)` that calls BitECS `createRelation(withStore(...))` at runtime
- Support data fields: trust (number), history (string), faction (string), debt (number), etc.
- Add `getRelationshipTypes()` for LLM context
- Wire into god agent tools: `createRelationshipType` tool
- Persist definitions to `data/relationships/` as JSON

**Success criteria:** Genesis for "medieval port city" can create relationship types like `GuildMember(guild)`, `OwesDebtTo(creditor, amount)`, `RivalOf(rival)`, and agents can query these relationships during cognition.

### 1.4 Wire action registry into genesis and spirit evolution

**Complexity:** M
**Files:** `src/god/god-agent.ts`, `src/spirits/architect-spirit.ts`

The genesis prompt in `god-agent.ts` creates rooms, agents, objects, components, and systems. It does NOT create affordances, traits, or relationship types because those tools don't exist yet.

**Tasks:**
- Add god agent tools: `createAffordance`, `createTrait`, `createRelationshipType` (wrappers around the registries from 1.1-1.3)
- Expand the genesis system prompt to instruct the God AI to generate vocabulary appropriate to the seed. Example: "For a medieval simulation, create affordances like forge, brew, pray, haggle. For a sci-fi simulation, create affordances like scan, hack, teleport, recharge."
- Add vocabulary generation as an explicit genesis step: after creating rooms and agents, generate affordances and traits appropriate to the world
- Wire spirit `architect-spirit.ts` to use the same tools when proposing new simulation elements

**Success criteria:** `createSimulation("a medieval port city")` produces at least 10 custom affordances (forge, brew, haggle, pray, sail, barter, etc.), 15 custom traits, and 3 custom relationship types, in addition to the base vocabulary. Agents can interact using the generated vocabulary.

### 1.5 interact_any_affordance discovers generated affordances

**Complexity:** S
**Files:** `src/cognition/behavior-policy.ts`, `src/world/affordance-availability.ts`

The `interact_any_affordance` behavior node already calls `getAvailableAffordances()`. This function needs to include runtime-registered affordances, not just base ones.

**Tasks:**
- Verify `getAvailableAffordances()` in `src/world/affordance-availability.ts` uses `listAllAffordances()` (from 1.1) instead of directly reading `BASE_AFFORDANCES`
- If it reads `BASE_AFFORDANCES` directly, change it to use the merged list
- Test that an agent with `interact_any_affordance` in their behavior tree can discover and use a runtime-registered affordance

**Success criteria:** An agent in a room with a "Forge" object (having trait "forgeable") uses the runtime-registered "forge" affordance without any code changes to the behavior policy engine.

---

## Phase 2: Generative Behavior Policies

**Goal:** Every agent gets a purpose-built behavior tree generated from their role, personality, available vocabulary, and world context. Templates become seeds for generation, not final destinations.

**Dependencies:** Phase 1 (generative vocabulary must exist for policies to reference it)
**Estimated effort:** L (1-2 weeks)

### 2.1 Post-genesis policy generation pass

**Complexity:** L
**Files:** `src/god/god-agent.ts`, `src/cognition/behavior-templates.ts`, `src/cognition/behavior-policy.ts`

Currently genesis assigns behavior policies from 7 hardcoded templates (`worker`, `guard`, `scholar`, `merchant`, `social`, `explorer`, `survival`) based on agent role string matching. Every blacksmith gets the same `worker` template. Every guard gets the same `guard` template.

**Tasks:**
- Create `src/cognition/policy-generator.ts` with `generateBehaviorPolicy(agentContext: { name, role, personality, room, availableAffordances, availableTraits, worldTheme }): Promise<BehaviorNode>`
- Use LLM (codeModel/plannerModel) to generate a policy from the agent's full context, using the current templates as structural examples in the prompt
- Add a post-genesis step in `god-agent.ts` that iterates all created agents and generates custom policies
- Include the available vocabulary (from Phase 1 registries) in the generation prompt so the LLM knows what affordances and traits exist
- Validate generated policies with `validateBehaviorNode()` before assignment; fall back to template if validation fails
- Policy generation should be batched and async (use the AI task queue)

**Success criteria:** After genesis for "medieval port city", the blacksmith has a policy that prioritizes forge/craft affordances, the tavern keeper prioritizes serve/brew, and the guard prioritizes patrol/investigate. No two agents with different roles have identical policies.

### 2.2 Spirit-driven policy evolution

**Complexity:** M
**Files:** `src/spirits/watcher-spirit.ts`, `src/cognition/policy-generator.ts`

Behavior policies are assigned once and never change. If the Watcher detects an agent is stuck or underperforming, it has no mechanism to evolve that agent's policy.

**Tasks:**
- Add `evolvePolicy(agentEid: number, reason: string, observedProblems: string[])` to `policy-generator.ts`
- The Watcher already detects behavioral loops and stuck agents. When a "behavioral_gap" observation reaches priority > 70, the Watcher should request a policy evolution for the affected agent
- The evolution prompt includes: current policy JSON, recent action history, detected problems, available vocabulary, and instructions to fix the specific issue
- Evolved policies are validated before assignment; if validation fails, keep the existing policy
- Track policy generations per agent to prevent thrashing (max 1 evolution per agent per 5 minutes)

**Success criteria:** An agent stuck in a behavioral loop (same 3 actions repeating) gets a new policy within 2 Watcher cycles that breaks the loop. Measurable: stuck-agent count drops to 0 within 3 minutes of detection.

### 2.3 Memory-to-behavior bridge

**Complexity:** M
**Files:** `src/cognition/behavior-policy.ts`

The behavior policy evaluator has condition types like `need_below`, `in_room`, `has_goal`, but nothing that reads from the Memory, Belief, or Impression components. Agents can't act on what they remember.

**Tasks:**
- Add new condition ops to `ConditionOp` type:
  - `{ type: "has_memory"; includes: string }` -- agent has a memory containing text
  - `{ type: "has_belief"; includes: string }` -- agent has a belief containing text
  - `{ type: "impression_above"; targetName: string; threshold: number }` -- agent's impression of a named entity is above threshold
  - `{ type: "impression_below"; targetName: string; threshold: number }`
  - `{ type: "last_n_actions_include"; n: number; actionType: string }` -- at least one of last N actions was this type
  - `{ type: "last_n_actions_exclude"; n: number; actionType: string }` -- none of last N actions was this type
- Implement evaluation for each condition in `evaluateCondition()` function
- Update `validateBehaviorNode()` to accept the new condition types
- Update the policy generation prompt (from 2.1) to include these conditions as available tools

**Success criteria:** A generated policy can include a branch like "if has_memory('was robbed') AND in_room('Market') THEN interact_with_trait('guard', 'report')". The condition evaluates correctly against actual memory data.

### 2.4 Policy effectiveness tracking

**Complexity:** S
**Files:** `src/spirits/effectiveness-tracker.ts`, `src/cognition/behavior-policy.ts`

There's currently no way to measure whether a behavior policy is working well. The effectiveness tracker measures dynamic ECS systems but not policies.

**Tasks:**
- Add per-agent policy metrics: action diversity (entropy of action type distribution over last 50 actions), goal completion rate, stuck-loop count, LLM-fallback rate
- Store metrics in a `PolicyMetrics` map keyed by agent EID
- Expose `getPolicyEffectiveness(agentEid: number): { diversity: number, goalRate: number, stuckCount: number, llmFallbackRate: number }`
- Wire into Watcher observations: low diversity or high stuck count triggers a "behavioral_gap" report

**Success criteria:** After a 120s simulation run, every agent has a policy effectiveness score. Agents with scores below threshold are flagged for policy evolution (from 2.2).

---

## Phase 3: Closed Evolution Loop

**Goal:** Close the autonomous evolution feedback loop: the system detects gaps, builds solutions, verifies they work, and iterates. Currently the loop is open -- spirits build things but never check if they helped.

**Dependencies:** Phase 1 (vocabulary registries), Phase 4 (system baker must be reliable enough to trust its output)
**Estimated effort:** L (1-2 weeks)

### 3.1 Structured proposal protocol

**Complexity:** M
**Files:** `src/spirits/watcher-spirit.ts`, `src/spirits/architect-spirit.ts`, `src/spirits/spirit-factory.ts`

The Watcher currently writes observation summaries as prose text. The Architect parses these with regex. This is the #1 reliability bottleneck in the evolution pipeline.

**Tasks:**
- Define `SpiritProposal` TypeScript interface (already exists in `spirit-factory.ts` but underused): `{ type: "system" | "component" | "entity" | "affordance" | "trait" | "rule" | "relationship", spec: SystemProposalSpec | ComponentProposalSpec | ..., rationale: string, expectedImpact: string, gapId: string }`
- Watcher synthesizes observations into structured `SpiritProposal[]` (LLM generates JSON matching the interface)
- Architect receives proposals as typed objects, not prose
- Add Zod validation for proposals at the Watcher -> Architect boundary
- Invalid proposals are logged and dropped, not silently corrupted

**Success criteria:** Every proposal that reaches the Architect is a valid `SpiritProposal` object. Zero regex parsing in the Watcher -> Architect pipeline.

### 3.2 Execution feedback and gap tracking

**Complexity:** M
**Files:** `src/spirits/observation-aggregator.ts`, `src/spirits/architect-spirit.ts`, `src/spirits/effectiveness-tracker.ts`

When a proposal is executed (system baked, component created), there's no tracking of whether it actually fixed the gap that motivated it. The aggregator keeps collecting the same observation forever.

**Tasks:**
- Add `status` field to `AggregatedObservation`: `"open" | "addressed" | "verified" | "failed"`
- When a proposal is executed, mark the linked gap as `"addressed"` with a reference to the proposal
- After 3 Watcher cycles post-execution, check if the gap is still being observed:
  - If gap observations stopped: mark `"verified"` (the fix worked)
  - If gap observations continue: mark `"failed"`, re-escalate with higher priority and include the failed attempt in context
- Add `getGapResolutionRate(): number` -- percentage of addressed gaps that reach "verified"
- Expose gap lifecycle in the UI (Dashboard panel)

**Success criteria:** The system tracks gap lifecycle from detection to resolution. Gap resolution rate is visible and measurable. Failed fixes are re-attempted with error context.

### 3.3 Semantic connectivity verification

**Complexity:** M
**Files:** `src/spirits/architect-spirit.ts`, `src/ecs/component-registry.ts`

Genesis and spirits create components, but there's no verification that generated components are actually wired into systems. A component with no system reading/writing it is dead data.

**Tasks:**
- After a new component is created, scan all active systems for references to that component name
- If no system references it: flag as "unwired component" and notify the Architect
- After a new system is baked, verify that its declared `targetComponents` exist in the registry
- If a system references components that don't exist: flag as "broken system" and auto-disable
- Create a `verifyConnectivity()` function that returns a report of all unwired components and broken systems
- Run connectivity check after every genesis and every spirit-driven creation

**Success criteria:** `verifyConnectivity()` returns an empty error list for a well-formed simulation. Unwired components are detected within one Watcher cycle and either wired (by baking a system) or removed.

### 3.4 Effectiveness-driven redesign

**Complexity:** M
**Files:** `src/spirits/effectiveness-tracker.ts`, `src/ecs/dynamic-systems.ts`, `src/spirits/architect-spirit.ts`

The effectiveness tracker can detect when a baked system has negative health scores, but there's no automated response beyond logging.

**Tasks:**
- When a system's composite health score drops below 0.3 for 3 consecutive measurements: auto-disable the system (already partially implemented via quarantine)
- Notify the Architect with: system name, pseudocode, error logs, health metrics, and the original gap it was meant to address
- Architect redesigns the system with error context in the prompt ("Previous attempt failed because...")
- Track redesign attempts per gap: after 3 failed redesigns, escalate to the user via the God chat
- Add a `redesignCount` field to system definitions

**Success criteria:** A failing system is automatically disabled, redesigned, and re-enabled. If the redesign works (health score > 0.5), the gap is marked "verified". If it fails 3 times, the user is notified.

### 3.5 Proposal persistence

**Complexity:** S
**Files:** `src/spirits/spirit-factory.ts`, `src/persistence/`

Proposals are currently in-memory only. Server restart loses all proposal history, making it impossible to understand what the spirits have been doing.

**Tasks:**
- Persist proposals to `data/proposals/` as JSON files (one per proposal, timestamped filename)
- Include proposal status, linked gap ID, execution result, and effectiveness outcome
- Load proposal history on simulation resume
- Add a `listProposals(filter?: { status?, type? })` function for UI and debugging

**Success criteria:** Proposals survive server restarts. A simulation can be stopped and resumed with full proposal history intact.

---

## Phase 4: System Baker Hardening

**Goal:** Improve the reliability of generated systems from ~50% functional to ~90% functional. The system baker is the critical path for self-evolution -- every improvement here compounds through the entire spirit pipeline.

**Dependencies:** Phase 0 (clean LLM pipeline). Can run in parallel with Phase 1-2.
**Estimated effort:** L (1-2 weeks)

### 4.1 AST-based validation

**Complexity:** M
**Files:** `src/god/system-baker.ts`, `src/systems/system-loader.ts`

Current validation uses regex to check for syntax issues. This misses semantic problems like accessing undefined variables, calling non-existent functions, or using wrong component property names.

**Tasks:**
- Add `typescript` as a dependency (it's already a devDependency)
- Create `src/god/system-validator.ts` with `validateSystemCode(code: string, availableComponents: string[]): ValidationResult`
- Use TypeScript compiler API to parse the generated code into an AST
- Check for:
  - Undeclared variable references
  - Component property accesses that don't match the component definition
  - Infinite loops (while/for without obvious exit condition)
  - Missing return statements in required positions
  - Entity creation inside tick functions (performance anti-pattern)
- Return structured errors with line numbers and suggested fixes
- Run AST validation before eval; if it fails, pass errors back to LLM for correction

**Success criteria:** System compile rate improves from 85% to 95%. Functional rate improves from 50% to 70%. The remaining 30% are logic errors (correct code that does the wrong thing), not structural errors.

### 4.2 Component write verification

**Complexity:** S
**Files:** `src/god/system-baker.ts`

The system baker's design phase produces a "design doc" listing which components the system will read and write. The build phase generates code. There's no verification that the code actually matches the design.

**Tasks:**
- After code generation, extract the set of components actually accessed in the generated code (from AST, see 4.1)
- Compare with the design doc's declared components
- If the code accesses components not in the design: warning (might be intentional)
- If the design declares components the code never touches: error (dead design, wrong code)
- Feed mismatches back to the LLM as a correction prompt

**Success criteria:** Design-to-code mismatch rate drops below 10%. Every system that passes validation actually modifies the components it claims to modify.

### 4.3 Runtime health checks and auto-disable

**Complexity:** S
**Files:** `src/ecs/dynamic-systems.ts`, `src/systems/system-loader.ts`

Systems that throw exceptions at runtime are currently logged but keep running, polluting the console and wasting cycles.

**Tasks:**
- Add per-system error counter in `SystemDefinition`: `errorCount: number`, `lastError: string`, `lastErrorTimestamp: number`
- After 3 consecutive exceptions: auto-disable the system and move source file to quarantine (`_quarantine/`)
- Emit a `system:disabled` event on the simulation bus with error context
- The quarantine mechanism in `system-loader.ts` already exists (lines 36-60) -- ensure it's actually triggered on runtime errors, not just load-time errors
- Add `getSystemHealth()` that returns error rate, uptime, and last error for all systems

**Success criteria:** A crashing system is disabled within 3 ticks. No crashing system runs for more than 3 ticks. System health is queryable for the Watcher and UI.

### 4.4 Reduced prompt bloat

**Complexity:** M
**Files:** `src/god/system-baker.ts`

The system baker prompt is ~1000 lines (estimated from the 2244-line file with prompt templates embedded). Much of this is boilerplate that could be extracted or compressed.

**Tasks:**
- Audit the baker prompt for redundancy: identify sections that repeat information, examples that cover the same pattern, or instructions that contradict each other
- Extract the "available components" section to be dynamically generated from the component registry (currently partially done, but still has hardcoded examples)
- Extract common code patterns (entity iteration, component access, event emission) into a separate "patterns reference" that's included once, not repeated per example
- Target: reduce prompt from ~1000 lines to ~400 focused lines
- Measure token count before and after; target 50% reduction

**Success criteria:** Baker prompt is under 500 lines. System generation quality stays the same or improves (measured by functional rate). API token cost per system generation drops by 40%+.

### 4.5 Performance anti-patterns in prompt

**Complexity:** S
**Files:** `src/god/system-baker.ts`

Generated systems sometimes contain performance anti-patterns: O(n^2) entity loops, entity creation inside tick functions, string concatenation in hot loops, Map/Set construction every tick.

**Tasks:**
- Add explicit "NEVER DO THIS" section to the baker prompt with anti-patterns and alternatives:
  - NEVER create entities inside tick functions (create them in init, reference by EID)
  - NEVER use nested entity loops without early exit conditions
  - NEVER allocate Maps, Sets, or arrays inside tick functions (use module-level caches)
  - NEVER use `JSON.parse` inside tick functions on the same data every tick
- Add a static analysis check in the validator (from 4.1) that flags these patterns
- Weight anti-pattern violations as warnings, not errors (the system might still work, just slowly)

**Success criteria:** Zero entity-creation-in-tick-function violations in newly generated systems. Module-level caching pattern used in 90%+ of generated systems.

---

## Phase 5: Agent Cognition Depth

**Goal:** Close the perception -> memory -> belief -> decision loop. Agents should act on what they know, remember what happened, update beliefs from experience, and make decisions that reflect their accumulated knowledge.

**Dependencies:** Phase 0 (reliable JSON parsing), Phase 2 (memory-to-behavior bridge for deterministic path)
**Estimated effort:** XL (2-3 weeks)

### 5.1 Expanded agent LLM context

**Complexity:** M
**Files:** `src/cognition/agent-mind.ts`, `src/cognition/knowledge-graph.ts`

Agent cognition prompts currently include: name, role, personality, current room, visible entities, recent thoughts, available actions. They're missing: relationships with other agents, accumulated memories, current beliefs, environmental conditions, knowledge graph.

**Tasks:**
- Add to the agent cognition prompt:
  - **Relationships:** Top 5 most significant relationships (from relationship registry, Phase 1.3), with trust level and recent interaction summary
  - **Memories:** Last 5 relevant memories (already retrievable via `getRelevantMemories()` in `knowledge-graph.ts` -- just not included in the prompt)
  - **Beliefs:** Current active beliefs (from Belief component)
  - **Environmental state:** Weather, time of day, ambient conditions (if any environmental systems are active)
  - **Knowledge:** Summary from `getKnowledgeSummary()` (already implemented but unused in cognition prompt)
- Limit total context addition to ~500 tokens to avoid ballooning API costs
- Use summarization: "You know Alice (trusted friend, met at market yesterday), Bob (rival, cheated you last week)" rather than raw data dumps

**Success criteria:** Agent decisions reference their memories and relationships. In a 120s simulation, at least 30% of LLM-driven actions reference information from the expanded context (measurable by checking for entity names, locations, or events from memories in action content).

### 5.2 Robust JSON parsing with retry

**Complexity:** S
**Files:** `src/cognition/agent-mind.ts`, `src/llm/json-extract.ts`

Building on Phase 0.3's shared JSON extraction, add structured retry logic specific to agent cognition.

**Tasks:**
- Define Zod schemas for all agent action types in `src/cognition/action-schemas.ts`
- On first parse failure: extract what partial data exists (maybe the action type is clear but target is malformed)
- On second attempt: use a shorter prompt with only the failed part: "The action type is 'move'. What is the target room name? Respond with ONLY the room name."
- On third failure: deterministic fallback to behavior policy (not "wait")
- Log all parse failures with the raw LLM output for debugging

**Success criteria:** Zero "wait" actions caused by parse failures. Every parse failure either recovers via retry or falls back to a meaningful action from the behavior policy.

### 5.3 Goal completion and plan revision

**Complexity:** M
**Files:** `src/cognition/planning-system.ts`, `src/cognition/agent-mind.ts`

Agents have goals (Goal component) and plans (Plan component) but plans are never revised when the world changes. An agent plans to "go to the market and buy bread" but if the market closes, they walk to a closed market and stand there.

**Tasks:**
- Add plan precondition checking: every N ticks (configurable, default 10), re-evaluate plan preconditions
- If preconditions are no longer met: mark plan as "blocked" and trigger replanning
- Add goal completion detection: when a goal's success condition is met, mark it as "completed" and create a memory of the accomplishment
- Add goal failure detection: when a goal becomes impossible (target destroyed, resource unavailable), mark as "failed" and create a memory of the failure
- Failed goals should inform future planning: "Don't try to buy bread at the market -- it's closed"

**Success criteria:** No agent walks to a destination that no longer exists. Goal completion rate (completed / (completed + abandoned)) is above 50% in a 5-minute simulation.

### 5.4 Failure-driven adaptation

**Complexity:** M
**Files:** `src/cognition/failure-recovery.ts`, `src/cognition/agent-mind.ts`

The failure recovery system (`failure-recovery.ts`) exists but is simplistic. After 3+ failures at the same task, agents should change strategy.

**Tasks:**
- Track per-agent failure history: `{ action: string, target: string, failCount: number, lastAttempt: number }`
- After 3 failures at the same action+target: add to agent's "avoid list" for 5 minutes
- If an agent has 3+ items on their avoid list: trigger a "seek help" behavior (speak to another agent about the problem, or request the Watcher's attention)
- Surface failure patterns to the Watcher as "agent_distress" observations
- Include failure history in the cognition prompt so the LLM knows what hasn't worked

**Success criteria:** Agents don't repeat failed actions more than 3 times. Failure patterns are detected by the Watcher and feed into the evolution loop (Phase 3).

---

## Phase 6: Social and Relationship Fabric

**Goal:** Generate relationship types appropriate to the simulation and enable emergent social dynamics: trust, gossip, reputation, factions.

**Dependencies:** Phase 1.3 (relationship registry), Phase 5 (expanded agent context)
**Estimated effort:** XL (2-3 weeks)

### 6.1 Trust accumulation from interactions

**Complexity:** M
**Files:** `src/cognition/knowledge-graph.ts`, `src/systems/builtin-systems.ts`

Currently agent impressions are stored as single string blobs. There's no numerical trust value that accumulates over time.

**Tasks:**
- Add `trust: number` field to relationship data (from Phase 1.3 relationship registry)
- Define trust modification rules:
  - Positive interaction (help, gift, conversation): +5 to +15 trust
  - Negative interaction (attack, steal, insult): -20 to -50 trust
  - Neutral interaction (observe, pass by): +1 trust (familiarity bias)
  - Betrayal (breaking a promise, attacking an ally): -80 trust (crash)
- Create `updateTrust(agentEid, targetEid, delta, reason)` function
- Wire trust updates into the action execution pipeline: after any social action completes, update trust based on outcome
- Trust affects behavior policy evaluation: condition `impression_above` / `impression_below` (from Phase 2.3) reads trust value

**Success criteria:** Trust values accumulate over time. An agent who helps another 5 times has trust > 50. An agent who attacks another has trust < -50. Trust values affect behavior (agents with high trust cooperate, agents with low trust avoid each other).

### 6.2 Gossip propagation

**Complexity:** M
**Files:** `src/cognition/agent-mind.ts`, `src/cognition/knowledge-graph.ts`

Agents don't share information. Agent A witnesses B steal from C, but A never tells C about it.

**Tasks:**
- Add "gossip" as a speak sub-type: when agents have a social interaction, they may share information about third parties
- Create `spreadGossip(speaker, listener, subject, information)` function that:
  - Creates a memory for the listener tagged as "gossip"
  - Modifies listener's impression/trust of the subject based on the gossip content
  - Applies a credibility modifier based on speaker-listener trust (high trust = gossip believed more)
- Add gossip generation to agent cognition: when an agent speaks to another, there's a chance they mention recent significant events involving third parties
- Gossip degrades: second-hand gossip has 50% credibility, third-hand has 25%

**Success criteria:** In a 5-minute simulation with 8+ agents, at least 3 gossip propagation events occur. An agent's reputation is affected by gossip they aren't present for.

### 6.3 Reputation system

**Complexity:** M
**Files:** `src/ecs/components.ts`, `src/cognition/knowledge-graph.ts`

No public reputation system exists. Trust is bilateral (A trusts B), but reputation is multilateral (everyone's impression of A).

**Tasks:**
- Add `Reputation` component: `{ overall: number, traits: string[] }` where traits are earned labels like "trustworthy", "thief", "generous", "dangerous"
- Compute reputation as weighted average of all trust values toward the agent: `reputation = avg(trust values from all who know agent)`
- Update reputation every 30 seconds (not every tick -- expensive)
- Reputation is visible to other agents in their perception: "Alice is known as trustworthy"
- Reputation affects initial trust: when agent A meets unknown agent B, initial trust = B's reputation * 0.5
- Reputation traits assigned at thresholds: reputation > 70 = "well-respected", < -50 = "distrusted"

**Success criteria:** Agents with consistently positive interactions develop positive reputations. Agents with negative interactions develop negative reputations. New agents use reputation as a prior when deciding whether to trust someone.

### 6.4 Social structure emergence

**Complexity:** L
**Files:** `src/spirits/`, new spirit module

This is aspirational but architecturally important: create a dedicated spirit for monitoring and nurturing social dynamics.

**Tasks:**
- Create `src/spirits/social-spirit.ts` -- "The Diplomat"
- Responsibilities:
  - Monitor social isolation (agents with no interactions for too long)
  - Detect faction formation (clusters of high mutual trust)
  - Create social events (gatherings, markets, celebrations) to drive interaction
  - Mediate conflicts (when two agents have mutually negative trust, create opportunities for reconciliation)
- Register as an observer in the observation aggregator for "social_gap" and "narrative_gap" categories
- Can propose entities (events, gathering places) via the Architect

**Success criteria:** The social spirit detects isolated agents and creates opportunities for interaction. Faction formation is detected and labeled. At least one social event is generated per 5-minute simulation.

---

## Phase 7: Meta-Simulation Intelligence

**Goal:** The system reasons about what KIND of simulation it's building and what subsystems it needs. Instead of building everything from scratch, it recognizes simulation archetypes and fills in missing pieces.

**Dependencies:** Phase 1 (vocabulary generation), Phase 3 (closed evolution loop), Phase 4 (reliable baker)
**Estimated effort:** L (1-2 weeks)

### 7.1 Simulation archetype detection

**Complexity:** M
**Files:** `src/god/god-agent.ts`

Currently genesis treats every seed the same way: create rooms, agents, objects. A "medieval port city" needs merchants, trade, and guilds. A "space station" needs life support, airlocks, and crew rotations. A "neural network" needs activation functions and signal propagation. Genesis doesn't reason about what makes each simulation type distinct.

**Tasks:**
- Add a pre-genesis analysis step in the god agent: before creating anything, analyze the seed to determine the simulation archetype
- Define archetype categories (not hardcoded -- LLM-inferred): social, economic, scientific, ecological, military, domestic, industrial, biological, abstract
- Each archetype implies expected subsystems: social -> reputation + gossip, economic -> currency + trade, scientific -> measurement + hypothesis, ecological -> food chains + population
- LLM produces a `SimulationBlueprint`: `{ archetype: string, expectedSubsystems: string[], vocabularyHints: { affordances: string[], traits: string[], relationships: string[] }, criticalMechanics: string[] }`
- The blueprint informs all subsequent genesis steps

**Success criteria:** "Medieval port city" produces a blueprint that includes economic, social, and maritime subsystems. "Neural network" produces a blueprint with signal, threshold, and connectivity subsystems. Blueprint quality is measured by whether the expected subsystems match what a human would identify.

### 7.2 Subsystem requirement inference

**Complexity:** M
**Files:** `src/god/god-agent.ts`, `src/spirits/architect-spirit.ts`

From the archetype blueprint, infer what specific ECS systems, components, and affordances are needed.

**Tasks:**
- Create `src/god/subsystem-planner.ts`
- From `SimulationBlueprint.expectedSubsystems`, generate a list of concrete requirements:
  - "economic" -> needs: Currency component, Trade affordance, PriceSystem, SupplyDemandSystem
  - "social" -> needs: Reputation component, Gossip affordance, TrustSystem, FactionSystem
- Cross-reference requirements against existing systems and components (from registries)
- Produce a "gap list": subsystems that are expected but not yet created
- Feed gap list to the Architect as high-priority proposals
- This replaces ad-hoc spirit observation for structural gaps -- the meta-intelligence knows what's missing before the simulation even runs

**Success criteria:** After genesis, the gap list correctly identifies missing subsystems. For "medieval port city" with no economic system: gap list includes Currency, Trade, and PriceSystem. Architect prioritizes these for creation.

### 7.3 Cross-cutting concern detection

**Complexity:** S
**Files:** `src/god/subsystem-planner.ts`

Most simulations need certain universal subsystems regardless of archetype: time progression, spatial awareness, basic needs, perception.

**Tasks:**
- Define a set of "cross-cutting concerns" that the meta-intelligence checks for:
  - Time: is there a day/night cycle? Does time affect behavior?
  - Space: can entities move? Is there distance? Are there adjacency rules?
  - Needs: do agents have needs that must be satisfied? Can they die?
  - Perception: can agents perceive their environment? Other agents?
  - Persistence: do changes to the world persist? Can things be created/destroyed?
- For each concern, check if the simulation already has systems covering it
- Generate proposals for missing cross-cutting concerns
- This runs after archetype-specific subsystem inference (from 7.2) to catch universal gaps

**Success criteria:** Every simulation, regardless of seed, has at minimum: spatial awareness, agent perception, and at least one agent need. Missing cross-cutting concerns are flagged and addressed within the first Watcher cycle.

---

## Phase 8: Infrastructure Hardening

**Goal:** Production resilience for long-running simulations and higher agent counts. Current ceiling is ~15 responsive agents; target is 50+.

**Dependencies:** None (can run in parallel with any phase)
**Estimated effort:** L (1-2 weeks)

### 8.1 Per-agent circuit breakers

**Complexity:** M
**Files:** `src/cognition/agent-mind.ts`, `src/runtime/async-task-queue.ts`

Currently there's no per-agent timeout. One agent whose LLM call takes 60 seconds blocks the entire cognition queue. The task queue has concurrency limits but no per-task timeout.

**Tasks:**
- Add `AbortController` with 30-second timeout to every `generateText` call in `agent-mind.ts`
- On timeout: fall back to behavior policy evaluation (deterministic, instant)
- Track timeout frequency per agent: if an agent times out 3 times consecutively, skip LLM for that agent for 2 minutes (use behavior policy exclusively)
- Add timeout tracking to task queue: `{ taskName, startTime, timeoutMs, abortController }`
- Expose circuit breaker state in the UI (which agents are in "policy-only" mode)

**Success criteria:** No single agent LLM call blocks for more than 30 seconds. Timeout -> deterministic fallback takes less than 1ms. Total simulation responsiveness stays under 200ms per tick even when 50% of LLM calls time out.

### 8.2 Worker thread sharding for agent cognition

**Complexity:** L
**Files:** `src/runtime/`, new `src/runtime/cognition-worker.ts`

All agent cognition runs on the main thread. With 15 agents and Flash model, this works. With 50 agents, the task queue backs up.

**Tasks:**
- Create a worker thread pool (Node.js `worker_threads`) dedicated to agent cognition
- Each worker thread runs agent cognition independently: receives agent context as a message, sends back the selected action
- Main thread: collects cognition results and applies them to the ECS world (component writes must stay on main thread)
- Pool size configurable: default 4 workers, max 8
- Worker crash recovery: if a worker crashes, restart it and reassign its pending agent to another worker
- Agent assignment: round-robin across workers, with affinity (same agent goes to same worker for cache locality)

**Success criteria:** 50 agents run with all getting cognition within 10 seconds. Main thread tick rate stays at 20Hz regardless of agent count. Worker crashes don't take down the simulation.

### 8.3 Atomic persistence writes

**Complexity:** S
**Files:** `src/persistence/world-persistence.ts`, `src/persistence/simulation-manager.ts`

Current persistence writes directly to the target file. A crash during write corrupts the save file.

**Tasks:**
- Implement write-ahead pattern: write to `{filename}.tmp`, `fsync`, then `rename` to final path
- `rename` is atomic on all platforms that matter (POSIX, Windows NTFS)
- Add checksum verification: write a SHA-256 hash alongside the data, verify on load
- On load failure (corrupt file): attempt to load from most recent snapshot instead
- Snapshots should be kept in a rotating buffer (last 5 snapshots, oldest deleted)

**Success criteria:** Simulated crash (kill -9 during save) never produces a corrupt save file. Recovery always succeeds from the most recent valid snapshot.

### 8.4 Ring buffer for events

**Complexity:** S
**Files:** `src/bus/simulation-bus.ts`

The simulation bus uses array-based event buffers. `Array.shift()` is O(n). With high event throughput, this becomes a bottleneck.

**Tasks:**
- Implement a ring buffer class: `RingBuffer<T>` with fixed capacity, head/tail pointers, O(1) push/pop
- Replace array-based event buffers in `SimulationBus` with ring buffers
- Default capacity: 10,000 events per channel
- When buffer is full: drop oldest events (log a warning on first drop)
- Add buffer fullness metrics: expose current fill level as a percentage

**Success criteria:** Event throughput scales linearly with event count. No O(n) operations on event buffers. Buffer overflow is handled gracefully with logging.

### 8.5 Structured logging

**Complexity:** M
**Files:** across all source files (incremental migration)

Current logging is `console.log` everywhere. No correlation IDs, no log levels, no structured format.

**Tasks:**
- Create `src/core/logger.ts` with `createLogger(module: string)` returning `{ debug, info, warn, error }`
- Each log entry is a structured JSON object: `{ timestamp, level, module, message, correlationId?, data? }`
- Add correlation ID threading: agent cognition calls get `agentEid` as correlation ID, spirit operations get `spiritName`
- Replace `console.log` in the 10 highest-traffic files first (agent-mind, system-baker, architect-spirit, god-agent, dynamic-systems)
- Add log-level filtering via environment variable: `LOG_LEVEL=warn` suppresses debug and info
- Future: pipe structured logs to a file for post-mortem analysis

**Success criteria:** The 10 highest-traffic files use structured logging. Log output can be filtered by level and module. Every agent cognition log entry includes the agent EID.

### 8.6 Entity version tracking

**Complexity:** M
**Files:** `src/ecs/world.ts`, `src/cognition/agent-mind.ts`

Async AI tasks capture entity state, process for 2-30 seconds, then write results back. During that time, the entity might have been removed and its EID recycled. The async task writes to the wrong entity.

**Tasks:**
- Add a version counter per entity: `entityVersion: Map<number, number>` or use BitECS entity versioning (`createEntityIndex(withVersioning(12))`)
- Before submitting an async task: capture `{ eid, version }` pair
- When the task completes and wants to write results: check that `currentVersion(eid) === capturedVersion`
- If version mismatch: discard the result (log a warning)
- Apply to all async cognition paths: agent-mind, spirit cognition, daemon observations

**Success criteria:** Zero wrong-entity writes from stale EIDs. Version mismatch events are logged and measurable. No silent data corruption from EID reuse.

### 8.7 Graceful shutdown

**Complexity:** S
**Files:** `src/run-dev-server.ts`, `src/persistence/simulation-manager.ts`

The server has no graceful shutdown. Ctrl-C kills the process immediately, potentially losing unsaved state.

**Tasks:**
- Register SIGINT and SIGTERM handlers
- On shutdown signal:
  1. Stop accepting new connections
  2. Stop queueing new AI tasks
  3. Wait for in-flight AI tasks to complete (with 10-second timeout)
  4. Save simulation state (atomic write from 8.3)
  5. Close WebSocket connections with "server shutting down" message
  6. Exit cleanly
- Add a `shutdown()` method to `SimulationInstance`
- If the 10-second grace period expires: force-save whatever state is available and exit

**Success criteria:** `Ctrl-C` produces a clean save and exits within 15 seconds. No data loss on graceful shutdown.

---

## Phase 9: Self-Modifying Cognition

**Goal:** The system can modify how agents THINK, not just what they do. Generated condition types, cognitive patterns, and reasoning chains extend the behavior policy evaluator at runtime.

**Dependencies:** Phase 2 (generative policies), Phase 4 (reliable baker), Phase 5 (cognition depth)
**Estimated effort:** XL (2-4 weeks)

### 9.1 Generated condition types

**Complexity:** L
**Files:** `src/cognition/behavior-policy.ts`, `src/god/system-baker.ts`

The behavior policy evaluator has a fixed set of condition types (`need_below`, `in_room`, `has_goal`, etc., defined in `ConditionOp` union type in `behavior-policy.ts`). A neural network simulation needs `membrane_above_threshold`. A weather simulation needs `is_raining`. These can't be added without code changes.

**Tasks:**
- Create a runtime condition registry: `registerCondition(name: string, evaluator: (world: World, agentEid: number, params: any) => boolean)`
- Built-in conditions remain hardcoded for performance
- Generated conditions are registered at runtime via the same mechanism as dynamic components
- The system baker (or a new "condition baker") generates evaluator functions from natural language descriptions
- Generated evaluators have access to the component registry: they can read any component property
- Evaluator sandbox: generated conditions run in a try/catch with a 1ms timeout to prevent blocking the ECS loop
- Add a `{ type: "custom"; name: string; params: Record<string, any> }` variant to `ConditionOp`

**Success criteria:** A "neural network" simulation can generate a `membrane_above_threshold` condition that reads a dynamically-created `MembranePotential` component, and use it in a behavior policy: "if membrane_above_threshold then fire_action_potential". No code changes to `behavior-policy.ts` required beyond the initial registry mechanism.

### 9.2 Generated cognitive patterns

**Complexity:** XL
**Files:** new `src/cognition/cognitive-patterns.ts`

Different simulation types need different reasoning styles. A detective simulation needs deductive reasoning. A scientist simulation needs hypothesis formation. A social simulation needs theory of mind. Currently all agents use the same cognitive pipeline.

**Tasks:**
- Define `CognitivePattern` interface: `{ name: string, description: string, promptTemplate: string, requiredContext: string[], outputSchema: z.ZodType }`
- Built-in patterns: "practical" (current default), "analytical" (for scientific/detective), "social" (for relationship-heavy), "creative" (for artistic/narrative)
- LLM-generated patterns: from seed analysis (Phase 7), generate patterns appropriate to the simulation type
- Pattern assignment: agents get a cognitive pattern based on their role. A "detective" agent uses the "analytical" pattern which includes structured deduction steps in the prompt.
- Pattern affects the system prompt for `generateText` in `agent-mind.ts`: different prompt templates for different cognitive styles
- This is the cognitive equivalent of behavior policy generation (Phase 2) but operates at the LLM prompt level rather than the deterministic policy level

**Success criteria:** In a detective simulation, detective agents produce structured deduction chains ("Observation: X. Hypothesis: Y. Test: Z.") rather than generic action selection. Different cognitive patterns produce measurably different action distributions.

---

## Phase 10: World Transformation and Spatial Depth

**Goal:** Agents can reshape the world. Space has meaning beyond room labels -- distance, travel time, adjacency, terrain.

**Dependencies:** Phase 1 (vocabulary for construction/destruction affordances), Phase 5 (goal-driven behavior)
**Estimated effort:** XL (2-4 weeks)

### 10.1 NPC construction and destruction

**Complexity:** M
**Files:** `src/cognition/action-registry.ts`, `src/world/schema.ts`, `src/world/effect-executor.ts`

Agents can't create or destroy objects. Only the God agent and spirits can modify the world. For a self-building simulation, agents need the ability to build, craft, and destroy within the rules of the simulation.

**Tasks:**
- Add "build" affordance type: agent + materials + recipe -> new entity
- Add "destroy" affordance type: agent + tool + target -> target removed
- Recipe system: `Recipe { inputs: { item: string, quantity: number }[], output: { type: string, name: string, properties: Record<string, any> }, requiredTool?: string, requiredTrait?: string }`
- Recipes generated during genesis (from Phase 1 vocabulary) based on the simulation type
- Construction takes time: multi-tick actions with progress tracking
- Destruction has consequences: emits stimuli to nearby agents, may trigger rule violations (from Lawgiver spirit)
- Wire into the effect executor: `spawn` and `destroy` effect types already exist in `schema.ts` but aren't available as agent actions

**Success criteria:** A blacksmith agent can forge a sword from iron and coal, creating a new entity with appropriate components. A lumberjack can chop down a tree, removing it from the world. Construction/destruction actions are constrained by recipes and rules.

### 10.2 Room adjacency graph with travel time

**Complexity:** M
**Files:** `src/ecs/relations.ts`, `src/systems/builtin-systems.ts`

Movement between rooms is instant and free. There's no concept of distance, travel time, or route planning.

**Tasks:**
- Add `adjacencyWeight` data to the `AdjacentTo` relation: `{ distance: number, travelTime: number, terrain: string }`
- Movement becomes multi-tick: `move` action starts travel, travel takes `travelTime` ticks, agent arrives after
- While traveling: agent's room is "in transit" (or stays in origin room until arrival -- design decision)
- Pathfinding: BFS on the adjacency graph for multi-hop routes
- Expose adjacency info in agent perception: "The market is 2 rooms away (through the town square)"
- Behavior policy condition: `{ type: "distance_to"; roomName: string; comparison: ">" | "<"; value: number }`

**Success criteria:** Moving from one room to a non-adjacent room takes multiple ticks proportional to graph distance. Agents plan routes for multi-hop travel. Travel time affects agent decision-making (prefer closer destinations).

### 10.3 Environmental effects on behavior

**Complexity:** M
**Files:** `src/ecs/components.ts`, `src/systems/builtin-systems.ts`, `src/cognition/behavior-policy.ts`

Weather and environment exist as data in some simulations but don't affect agent behavior or needs.

**Tasks:**
- Define environment-to-need mappings: rain -> comfort decreases faster, cold -> energy decreases faster, heat -> thirst increases
- Add environmental modifiers to rooms: `RoomEnvironment { temperature: number, weather: string, lightLevel: number, noise: number }`
- Generated systems (from baker) can modify environment: a `WeatherSystem` changes `weather`, a `DayNightSystem` changes `lightLevel`
- Agent perception includes environmental summary: "It's cold and raining. You feel uncomfortable."
- Behavior policy conditions: `{ type: "environment"; property: "weather"; equals: "raining" }`
- Agents seek shelter, warmth, shade based on environmental conditions

**Success criteria:** Environmental conditions affect agent need decay rates. Agents modify behavior based on environment (seek shelter in rain, stay indoors at night). Environmental changes from generated systems propagate to agent decision-making.

---

## Dependency Graph

```
Phase 0: Quick Wins
    |
    v
Phase 1: Generative Vocabulary ----+-----> Phase 2: Generative Behavior
    |                               |               |
    |                               |               v
    |                               +-----> Phase 6: Social Fabric
    |                               |
    v                               v
Phase 3: Closed Evolution   Phase 7: Meta-Simulation
    |                               |
    |                               v
    v                       (feeds back into Phase 3)
Phase 4: System Baker Hardening (can start from Phase 0)
    |
    v
Phase 9: Self-Modifying Cognition (needs Phase 2, 4, 5)

Phase 5: Agent Cognition Depth (needs Phase 0, 2)
    |
    v
Phase 10: World Transformation (needs Phase 1, 5)

Phase 8: Infrastructure Hardening (independent, start anytime)
```

**Parallel tracks:**
- **Track A (Architecture):** Phase 0 -> Phase 1 -> Phase 3 -> Phase 7
- **Track B (Cognition):** Phase 0 -> Phase 2 -> Phase 5 -> Phase 9
- **Track C (Reliability):** Phase 4 (parallel with Track A/B), Phase 8 (anytime)
- **Track D (Depth):** Phase 6 (after Phase 1 + 5), Phase 10 (after Phase 1 + 5)

### Critical path

Phase 0 -> Phase 1 -> Phase 2 -> Phase 5 -> Phase 9

This is the path from "fixed vocabulary engine" to "self-modifying cognitive engine." Every other track is important but not on the critical path to the vision.

---

## Timeline Summary

| Phase | Description | Effort | Dependencies | Parallel? |
|-------|-------------|--------|-------------|-----------|
| **0** | Quick Wins | S (2-3 hours) | None | -- |
| **1** | Generative Vocabulary | L (1-2 weeks) | Phase 0 | -- |
| **2** | Generative Behavior Policies | L (1-2 weeks) | Phase 1 | with Phase 4 |
| **3** | Closed Evolution Loop | L (1-2 weeks) | Phase 1, 4 | with Phase 2, 5 |
| **4** | System Baker Hardening | L (1-2 weeks) | Phase 0 | with Phase 1, 2 |
| **5** | Agent Cognition Depth | XL (2-3 weeks) | Phase 0, 2 | with Phase 3, 6 |
| **6** | Social and Relationship Fabric | XL (2-3 weeks) | Phase 1, 5 | with Phase 7 |
| **7** | Meta-Simulation Intelligence | L (1-2 weeks) | Phase 1, 3, 4 | with Phase 6 |
| **8** | Infrastructure Hardening | L (1-2 weeks) | None | anytime |
| **9** | Self-Modifying Cognition | XL (2-4 weeks) | Phase 2, 4, 5 | -- |
| **10** | World Transformation | XL (2-4 weeks) | Phase 1, 5 | with Phase 9 |

**Total estimated effort:** 14-22 weeks of focused development.

**Recommended execution order (fastest path to demonstrable value):**
1. Phase 0 (Day 1 -- immediate quality improvement)
2. Phase 1 + Phase 4 (parallel -- vocabulary + reliability)
3. Phase 2 + Phase 8.1-8.3 (parallel -- policies + circuit breakers)
4. Phase 3 + Phase 5 (parallel -- evolution loop + cognition)
5. Phase 6 + Phase 7 (parallel -- social fabric + meta-intelligence)
6. Phase 9 + Phase 10 (parallel -- self-modifying cognition + world transformation)

Phase 8 (infrastructure) tasks should be interleaved throughout as stabilization work between feature phases.
