# Phase 3: Self-Evolving Simulation Engine

## Vision

From a seed phrase like "medieval village" → a living world where agents learn their craft, form relationships, set their own goals, build houses, run for mayor, start families — progressively moving from LLM-driven (expensive, creative) to BT-driven (free, deterministic) as patterns compile.

## Current State (what's built)

- God AI + spirits create and evolve the world (affordances, components, systems)
- Agents learn from LLM decisions → BT compilation (84% → 33% LLM over 200 ticks)
- Composable skill system (goal-based compilation, Voyager-style composition)
- Dynamic components affect behavior (Famine, Festival, Boredom)
- World-mutating affordances (spawn, destroy, modify_component)
- Auto-discovery: new affordances propagate to all agent BTs
- Chronicle system captures all meaningful events for analysis

## What's Missing

### 3.1 Autonomous Goal Setting (agents dream and plan)
**The single most important piece.** Agents need to set their OWN goals based on:
- **Aspirations**: Long-term wants ("build a house", "become master blacksmith", "find love")
- **Needs**: Immediate drives (hungry → goal: find food, lonely → goal: visit friend)
- **Observations**: See something → want something ("that house looks nice, I want one")
- **Social influence**: "Greta said the market has cheap bread" → goal: go buy bread

**Implementation:**
- Add an `autonomous_goal_generation` step to agent cognition (before LLM fallback)
- When the BT has no action AND there's no active goal, ask the LLM:
  "Given your aspirations, needs, and recent memories, what should you focus on?"
- LLM returns a structured goal → enters the goal/planning system → eventual skill compilation
- Aspirations should be generated at agent creation (by the God AI or LLM)
- Aspirations evolve over time based on experiences (achieved a goal → new aspiration)

**Success criteria:** Agents create goals autonomously. Goals lead to multi-step plans. Plans complete → skills compile. Over 200 ticks, agents pursue 3+ self-generated goals.

### 3.2 Daily Rhythm & Scheduling
**Agents need a sense of time.** Not clock-based, but rhythm-based:
- Morning: work (forge, farm, serve)
- Midday: eat, socialize, trade
- Evening: rest, reflect, socialize
- Night: sleep

**Implementation:**
- Add a `TimeOfDay` component (morning/midday/evening/night) that a system cycles
- Behavior trees can check `time_is("morning")` condition
- The LLM policy generator includes time-appropriate behaviors in generated trees
- Agents naturally develop daily routines through the BT compilation loop

**Success criteria:** Agents follow recognizable daily patterns. A blacksmith forges in the morning, eats at midday, socializes in the evening.

### 3.3 Social System (relationships, conversations, influence)
**Agents need to form real relationships:**
- **Impressions**: Already have `impression_above/below` conditions. Need the impressions to actually CHANGE from interactions.
- **Conversations that matter**: When agents speak, the listener should form memories and potentially change behavior.
- **Gossip**: Agent A tells Agent B about something → B gets a perception → may create a goal
- **Social contracts**: Trade deals ("I'll give you bread if you forge me a sword"), debts, promises

**Implementation:**
- Wire impression changes into the speak action handler (positive impressions from friendly speech)
- Add a `listen` affordance that processes what was said and creates memories
- Gossip: when agent speaks about a third party, create perceptions for listeners
- Contracts: a new relationship type `OwesDebtTo` with data fields

**Success criteria:** Agents form different impressions of each other. A friendly agent is visited more. An unfriendly one is avoided. Gossip propagates information.

### 3.4 World Building (agents modify the world)
**Agents should build, plant, craft, destroy:**
- The affordance effect system already supports `spawn`, `destroy`, `modify_component`
- God AI already knows how to create affordances with effects
- What's missing: agents choosing to build and the results being persistent

**Implementation:**
- God AI creates construction affordances at genesis: `build_house`, `plant_crops`, `dig_well`, `build_road`
- These affordances require resources (Wood, Stone) → agents must gather first
- Resource gathering is itself an affordance: `chop_tree` spawns Wood
- The BT compiler captures "gather resources then build" as a composed skill
- Built structures become new rooms or objects in the ECS

**Success criteria:** At least one agent builds something during a 200-tick simulation. The built entity persists and is used by other agents.

### 3.5 Progressive Online→Offline Transition
**The simulation should get cheaper over time:**
- Early: 90%+ LLM (everything is novel)
- Mid: 50% LLM (common patterns compiled)
- Late: 10-20% LLM (only truly novel situations)
- Mature: <5% LLM (almost everything handled by BT)

**Implementation:**
- Track LLM call rate per agent and globally in the chronicle
- Increase the `chance` gate on compiled branches from 0.4 to 0.8 as they succeed more
- After 50+ ticks of 100% BT-handled, mark agent as "autonomous" and only LLM on explicit novel events
- Add a `budget` system: each agent gets N LLM calls per phase, must use BT for the rest
- Eventually: export trained BTs as JSON, load into new simulations as starting knowledge

**Success criteria:** LLM rate drops below 20% by tick 300 in a long simulation. Agents still behave coherently and in-character.

### 3.6 Seed-to-World Pipeline
**One command creates a complete living world:**
```
createSimulation("medieval port city with a corrupt governor and a pirate threat")
```

**Implementation:**
- God AI genesis already creates rooms, agents, objects, affordances
- Add: generate aspirations for each agent at creation
- Add: generate relationship seeds (who knows who, who likes/dislikes who)
- Add: generate initial world tensions/conflicts as components + memories
- Add: spirits auto-start their observation/evolution loops
- The chronicle captures everything from tick 0

**Success criteria:** A single seed phrase produces a world with 5+ agents, 5+ rooms, 10+ affordances, relationships, aspirations, and initial tensions. Agents begin acting autonomously within 5 ticks.

## Critical Integration Points (for implementation)

### Agent Cognition Chain (`src/cognition/agent-mind.ts` → `agentThink()`)
The decision priority is:
1. Procedural skill reflex (line ~716)
2. Failure recovery (line ~728)
3. Speech reply (line ~746)
4. Contract-driven actions (line ~753)
5. Plan execution (line ~770)
6. **Behavior tree evaluation** (line ~782) — `evaluateBehaviorPolicy()`
7. Contract fallback (line ~803)
8. **← INSERT autonomous goal generation HERE (line ~812)**
9. LLM one-shot action selection (line ~834)

The insertion point for 3.1 is between "BT returns llm_fallback" and "call LLM for one-shot action." When BT can't handle it AND no active goal exists → ask LLM to SET a goal, not just pick an action.

### Goal System
- `createIntentGoal(world, agentEid, description, priority)` — creates a Goal entity (line 325 cognition-system.ts)
- `createMovementGoal(world, agentEid, destination, reason, priority)` — typed movement goal
- Goals have: description, kind, paramsJson, successJson, signature, priority, status, progress, deadline
- `GoalEvaluationSystem` checks success contracts and triggers `onGoalCompleted` → skill compilation
- `HasGoal` relation links agent to goal entities

### BT Compilation Pipeline
- `captureLLMDecision()` in bt-compiler.ts — snapshots agent state when LLM acts
- `resolveDecision()` — on success, compiles into BT branch (called from cognition-system.ts)
- `onGoalCompleted()` in goal-learning.ts — compiles action sequences into named skills
- `growMemoryBranch()` / `growAffordanceBranch()` in policy-learning.ts — reactive branch growth
- `initializeAffordanceDiscovery()` — hooks affordance registration to auto-grow agent BTs
- All compiled branches go through `validateBehaviorNode()` before persisting

### Key Components (src/ecs/components.ts)
- `Agent` { role, systemPrompt, active }
- `BehaviorPolicy` { enabled, treeJson, version, lastUpdatedAt }
- `Goal` { description, kind, paramsJson, successJson, signature, priority, status, progress, deadline, createdAt }
- `Needs` { hunger(0=full,100=starving), energy(100=rested,0=exhausted), social, comfort }
- `Memory` { type, content, emotionalValence, importance, timestamp }
- `Impression` { targetName, valence }

### BehaviorNode Types (src/cognition/behavior-policy.ts)
`selector | sequence | condition | action | interact_with_trait | interact_any_affordance | weighted_random | social_visit | use_procedure | skill | llm_skill | wander | llm_fallback | noop`

ConditionOps: `always | chance | need_above | need_below | in_room | not_in_room | has_goal | has_active_movement_goal | no_active_movement_goal | room_has_named | room_has_other_agents | room_is_empty | last_action_was | last_action_not | has_perception | has_memory | has_belief | impression_above | impression_below | last_n_actions_include | last_n_actions_exclude | component_above | component_below | has_component`

### Affordance Effect System (src/world/effect-executor.ts)
Effects that mutate the ECS when affordances execute:
`modify_component | set_state | add_trait | remove_trait | destroy | spawn | emit_stimulus | run_tool | transfer | add_relation | remove_relation`

### LLM Configuration (src/llm/config.ts)
- `spiritModel` = gemini-3.1-pro-preview (policy generation, spirits)
- `agentModel` = gemini-3-flash-preview (agent cognition)
- Temperature 1.0 for policy generation (Gemini 3 docs say lower values cause loops)
- Temperature 0.3 for agent cognition (reliable JSON)
- No maxOutputTokens anywhere (causes truncation → silent fallback to templates)

### Normalizer (src/cognition/policy-generator.ts)
LLM JSON output must be normalized — Gemini produces 10+ format variants. The normalizer handles: `action_type→actionType`, `action→actionType`, `amount→value`, `threshold→value`, `location_is→in_room`, `memory→includes`, flattened conditions, weighted_random.children→choices, direct action types as node types, etc.

### Chronicle (src/cognition/simulation-chronicle.ts)
`chronicle.record(type, data)` — captures meaningful events. `chronicle.saveReport(path)` — markdown + JSON output. Event types: bt_compiled, skill_learned, goal_skill_compiled, llm_decision, policy_decision, action_success, action_failure, world_mutation, conversation, memory_branch, affordance_discovered, affordance_evolved, crisis_event, phase_change, snapshot.

### File Locations
- Agent cognition chain: `src/cognition/agent-mind.ts` → `agentThink()`
- BT evaluator: `src/cognition/behavior-policy.ts` → `evaluateBehaviorPolicy()`
- BT compiler: `src/cognition/bt-compiler.ts` → `captureLLMDecision()`, `resolveDecision()`
- Policy generator: `src/cognition/policy-generator.ts` → `generateBehaviorPolicy()`
- Policy learning: `src/cognition/policy-learning.ts` → `growMemoryBranch()`, `growAffordanceBranch()`
- Goal learning: `src/cognition/goal-learning.ts` → `onGoalCompleted()`, `trackGoalAction()`
- Skill registry: `src/cognition/skill-registry.ts` → `registerSkill()`, `composeSkills()`
- Aspirations: `src/cognition/goal-learning.ts` → `setAspirations()`, `formatAspirationsForContext()`
- Action execution: `src/cognition/cognition-system.ts` → `executeActions()`, `runCognitionCycle()`
- Affordance effects: `src/world/effect-executor.ts` → `executeAffordance()`, `executeEffect()`
- Affordance registry: `src/world/schema.ts` → `registerAffordance()`, `onAffordanceRegistered()`
- God agent: `src/god/god-agent.ts` → `createGodTools()` (8000+ lines, 130+ tools)
- Dual-loop runtime: `src/runtime/simulation-loop.ts` (20Hz ECS + async AI queue)
- Dev server: `src/run-dev-server.ts`
- Chronicle: `src/cognition/simulation-chronicle.ts`
- Components: `src/ecs/components.ts`
- Relations: `src/ecs/relations.ts`

### Test Patterns
- Unit tests: Jest, `npm test -- --testPathPattern="<name>"`
- Behavioral tests: `npx tsx src/behavioral-tests/<N>-<name>.ts` (real LLM calls)
- Long simulation: `src/behavioral-tests/50-long-simulation.ts` (200 ticks, 5 agents, chronicle)
- Always run from `v2/` directory
- Working directory: `/Users/parzival/workspace/oneirocom/project89/argos/v2`

### 200-Tick Simulation Results (baseline)
- LLM reduction: 84% → 33% over 200 ticks
- Tree growth: Mira 5→74 (14.8x), Greta 5→66, Dex 5→57, Aldric 5→54, Caius 5→45
- 665 policy decisions vs 331 LLM decisions
- 317 conversations, 30 BT compilations, 13 memory branches
- 3 evolved affordances (forage, brew_remedy, build_shelter)
- Agents: blacksmith, innkeeper, monk, farmer, merchant

## Execution Order

```
3.1 Autonomous Goals     ← highest leverage, enables everything else
3.2 Daily Rhythm         ← gives structure to agent behavior
3.3 Social System        ← makes interactions meaningful
3.4 World Building       ← agents change the world
3.5 Online→Offline       ← efficiency and scalability
3.6 Seed-to-World        ← the demo, the product
```

Each builds on the previous. 3.1 is the foundation — without autonomous goals, agents just react. With goals, they pursue dreams, which drives all the other systems.

## Testing Strategy

Each sub-phase gets:
1. **Unit tests** for new node types, conditions, components
2. **Behavioral tests** with real LLM (like the survival showcase)
3. **Chronicle analysis** of 200-tick runs measuring the specific capability
4. **Integration test** with the real `run-dev-server.ts` runtime (first time!)

The final test: a 500-tick simulation from a seed phrase with chronicle analysis showing agents learning, growing, building, socializing, and progressively going offline.
