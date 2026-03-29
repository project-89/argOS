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
