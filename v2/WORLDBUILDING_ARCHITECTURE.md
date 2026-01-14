# ArgOS v2: World-Building Architecture

> **Companion to ARCHITECTURE.md** - This document covers how GodAI builds simulations.
> ARCHITECTURE.md covers how individual agents think.

## Quick Start

```typescript
import { createSimulation } from "./src/index";

// Create a simulation with the unified API
const sim = await createSimulation({
  name: "Village Life",
  preset: "slice-of-life",
  agents: [
    { name: "Ada", role: "baker", startRoom: "Bakery" },
    { name: "Bob", role: "farmer", startRoom: "Farm" }
  ],
  rooms: [
    { name: "Bakery", description: "Warm and smells of fresh bread" },
    { name: "Farm", description: "Rolling fields of wheat" }
  ]
});

// Control the simulation
await sim.start();    // Start the simulation loop
sim.pause();          // Pause
sim.resume();         // Resume
await sim.step();     // Run single tick
sim.stop();           // Stop completely

// Interact with the simulation
await sim.command("Create a thunderstorm");
sim.broadcast("Bakery", "A customer enters looking for bread");
sim.stimulate("Ada", "You notice Bob looking tired");

// Get state
console.log(sim.getState());
console.log(sim.getStats());
```

---

## 1. Overview

ArgOS is a **Linguistic Simulation Engine** - a platform where AI agents autonomously build and run simulations using an Entity-Component-System (ECS) architecture. The key insight is that the ECS serves as a **programmable substrate** that a "GodAI" can read from and write to, creating emergent simulations from natural language descriptions.

### Core Principles

1. **AI-Driven World Building** - GodAI creates components, entities, systems, and rules from natural language prompts
2. **ECS as Execution Layer** - BitECS provides the deterministic, high-performance runtime
3. **Schema as Contract** - WorldSchema defines templates that bridge AI creativity and structured execution
4. **Text-First Perception** - Agents perceive the world through MUD-style text rendering
5. **Emergent Behavior** - Rules and systems create consequences without explicit AI micromanagement

---

## 2. Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│  Natural language prompts, REPL commands, observation           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                            GODAI                                │
│  - Receives prompts, designs simulations                        │
│  - Creates/modifies world through tools                         │
│  - Two-tier: Opus/Pro thinks, Flash executes                    │
│  - Receives reports from Spirit hierarchy                       │
│                                                                 │
│  Status: ✅ IMPLEMENTED (god-agent.ts)                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ commands & receives reports
┌──────────────────────────────▼──────────────────────────────────┐
│                       SPIRIT HIERARCHY                          │
│  - AI spirits that observe and steer simulation domains         │
│  - Archangels: Domain managers (Narrator, Sociologist...)       │
│  - Angels: Local/entity-specific managers                       │
│  - Daemons: Task-specific helper spirits                        │
│  - Inter-spirit messaging via DivineMessage protocol            │
│                                                                 │
│  Status: ✅ IMPLEMENTED (src/spirits/)                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ uses tools
┌──────────────────────────────▼──────────────────────────────────┐
│                        WORLD SCHEMA                             │
│  - Object type definitions (prefabs)                            │
│  - Affordance definitions (actions)                             │
│  - State transition rules                                       │
│  - Description templates                                        │
│                                                                 │
│  Status: ✅ IMPLEMENTED (schema.ts, object-manager.ts)          │
│          ✅ EXPOSED AS GODAI TOOLS (spawn, defineObjectType,    │
│             defineAffordance, listObjectTypes, getObjectTraits) │
└──────────────────────────────┬──────────────────────────────────┘
                               │ instantiates into
┌──────────────────────────────▼──────────────────────────────────┐
│                         ECS RUNTIME                             │
│  - Entities (numeric IDs)                                       │
│  - Components (SoA data stores)                                 │
│  - Relations (entity connections)                               │
│  - Systems (tick-based processing)                              │
│  - Dynamic components (AI-created at runtime)                   │
│  - Baked systems (AI-generated code)                            │
│                                                                 │
│  Status: ✅ IMPLEMENTED (bitECS + extensions)                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │ processed by
┌──────────────────────────────▼──────────────────────────────────┐
│                        RULES ENGINE                             │
│  - Declarative rules (when X happens, do Y)                     │
│  - Automatic consequences without AI intervention               │
│  - State machine transitions                                    │
│                                                                 │
│  Status: ✅ IMPLEMENTED (rules-engine.ts)                       │
│          ✅ EXPOSED AS GODAI TOOLS (defineRule, listRules)      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ executes via
┌──────────────────────────────▼──────────────────────────────────┐
│                       EFFECT EXECUTOR                           │
│  - Executes affordance effects on ECS components                │
│  - State transitions, trait changes                             │
│  - Stimulus emission to nearby agents                           │
│  - Entity destruction/creation                                  │
│                                                                 │
│  Status: ✅ IMPLEMENTED (effect-executor.ts)                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │ triggers
┌──────────────────────────────▼──────────────────────────────────┐
│                       SENSORY SYSTEM                            │
│  - Processes stimuli through 5 sensory modalities               │
│  - Visual, Auditory, Olfactory, Tactile, Cognitive              │
│  - Cognitive sense provides affordance awareness                │
│  - Agent traits modify sensory capabilities                     │
│                                                                 │
│  Status: ✅ IMPLEMENTED (sensory-system.ts)                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ rendered to
┌──────────────────────────────▼──────────────────────────────────┐
│                        OUTPUT LAYER                             │
│  - TextRenderer: MUD-style descriptions for agent perception    │
│  - Graphics: Pixi.js 2D visualization (optional)                │
│  - ASCII World: Grid-based tile maps                            │
│                                                                 │
│  Status: ✅ IMPLEMENTED (text-renderer.ts)                      │
│          ✅ WIRED TO AGENT COGNITION (sensory-system.ts)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. GodAI Capabilities

### 3.1 Current Tools (Implemented)

| Tool | Purpose | Status |
|------|---------|--------|
| `createAgent` | Create cognitive NPC with LLM thinking | ✅ |
| `createEntity` | Create mechanical entity (no cognition) | ✅ |
| `createRoom` | Create location/space | ✅ |
| `createObject` | Create physical object | ✅ |
| `createStimulusSource` | Create periodic event emitter | ✅ |
| `createComponent` | Define new component type at runtime | ✅ |
| `setDynamicComponent` | Attach dynamic component to entity | ✅ |
| `setComponentValues` | Modify component data | ✅ |
| `addRelation` | Create relationship between entities | ✅ |
| `bakeNewSystem` | Generate new system from description | ✅ |
| `activateSystem` / `deactivateSystem` | Control system execution | ✅ |

**Spirit Management Tools** - See **Section 13.7** for the 7 spirit hierarchy tools (`getSpiritHierarchy`, `getSpiritReports`, `sendDirectiveToSpirit`, etc.)

### 3.2 WorldSchema & Rules Tools (Implemented)

| Tool | Purpose | Status |
|------|---------|--------|
| `spawn` | Instantiate from WorldSchema prefab | ✅ |
| `defineObjectType` | Add new prefab to schema | ✅ |
| `defineAffordance` | Add new action type | ✅ |
| `defineRule` | Add declarative rule | ✅ |
| `listObjectTypes` | Query available object types | ✅ |
| `listAffordances` | Query available affordances | ✅ |
| `listRules` | Query defined rules | ✅ |
| `getObjectTraits` | Get traits of spawned object | ✅ |
| `getAvailableActions` | Get affordances for entity | ✅ |
| `transitionObjectState` | Change object state | ✅ |

### 3.3 Two-Tier Execution Model

```
User Prompt: "Create a medieval village with trading NPCs"
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│  PLANNER (Opus/Pro) - "Thinking" Phase                      │
│                                                             │
│  1. Analyzes prompt requirements                            │
│  2. Designs component schema                                │
│  3. Plans entity structure                                  │
│  4. Designs systems and rules                               │
│  5. Outputs structured DesignDocument                       │
│                                                             │
│  Model: gemini-3-pro-preview with extended thinking         │
└──────────────────────────────┬──────────────────────────────┘
                               │ DesignDocument
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  EXECUTOR (Flash) - "Building" Phase                        │
│                                                             │
│  1. Receives DesignDocument                                 │
│  2. Calls tools to create components                        │
│  3. Spawns entities                                         │
│  4. Bakes systems                                           │
│  5. Sets up initial state                                   │
│                                                             │
│  Model: gemini-3-flash-preview (fast, cheap)                │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. WorldSchema Layer

### 4.1 What WorldSchema Provides

WorldSchema is a **registry of templates** that sits between GodAI and the raw ECS. It provides:

- **Object Type Definitions (Prefabs)** - Templates for common objects
- **Affordance Definitions** - What actions can be performed
- **State Machines** - How objects transition between states
- **Description Templates** - How objects are described in text

```typescript
// Object Type Definition (Prefab)
{
  type: "torch",
  components: ["Position", "Renderable", "Perceivable"],
  traits: ["lightSource", "takeable", "examinable"],
  defaultState: "lit",
  states: {
    "lit": {
      description: "A burning torch casting flickering light",
      emits: { light: 1.0 }
    },
    "unlit": {
      description: "An unlit torch",
      emits: { light: 0 }
    }
  }
}

// Affordance Definition (Action)
{
  name: "extinguish",
  requires: ["lightSource"],
  blockedBy: ["unlit"],
  transitions: { "lit": "unlit" },
  descriptionTemplate: "{actor} extinguishes {target.name}"
}
```

### 4.2 Current vs Target Flow

**Current Flow (Disconnected):**
```
GodAI → createObject tool → raw ECS entity (no affordances)
         WorldSchema/ObjectManager exist but GodAI doesn't use them
```

**Target Flow (Integrated):**
```
GodAI → spawn("torch") → WorldSchema lookup → ECS entity with:
                                              - All components
                                              - Traits attached
                                              - State machine ready
                                              - Affordances available
                                              - Description template
```

### 4.3 Integration Status ✅ COMPLETE

1. ~~**Add `spawn` tool to GodAI**~~ ✅ - Wraps ObjectManager.spawn()
2. ~~**Add `defineObjectType` tool**~~ ✅ - Extends WorldSchema at runtime
3. ~~**Add `defineAffordance` tool**~~ ✅ - Adds new actions to schema
4. ~~**Wire TextRenderer to cognition**~~ ✅ - Agents perceive via rendered text (sensory system)

---

## 5. Simulation Flow

### 5.1 Building a Simulation from Prompt

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER PROMPT                                              │
│    "Create a medieval village with NPCs that trade"         │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. GODAI DESIGN PHASE (Pro/Opus)                            │
│    - Analyzes requirements                                  │
│    - Designs: Components, Entities, Systems, Rules          │
│    - Outputs DesignDocument                                 │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. GODAI EXECUTION PHASE (Flash)                            │
│    a. Extend schema if needed (defineObjectType, etc.)      │
│    b. Create components if needed (createComponent)         │
│    c. Spawn locations (spawn/createRoom)                    │
│    d. Spawn objects (spawn)                                 │
│    e. Create agents (createAgent)                           │
│    f. Bake systems (bakeNewSystem)                          │
│    g. Define rules (defineRule)                             │
└──────────────────────────────┬──────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. SIMULATION READY                                         │
│    - World populated with entities                          │
│    - Systems registered and active                          │
│    - Rules loaded                                           │
│    - Agents ready for cognition                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Runtime Tick Loop

```
┌─────────────────────────────────────────────────────────────┐
│                     TICK (every N ms)                       │
├─────────────────────────────────────────────────────────────┤
│ 1. INCREMENT WORLD TIME                                     │
│                                                             │
│ 2. RUN SYSTEMS (frequency-based)                            │
│    - Built-in systems (TimeProgression, SocialDynamics)     │
│    - GodAI-baked systems (custom behaviors)                 │
│    - Each system queries entities, modifies components      │
│                                                             │
│ 3. PROCESS RULES                                            │
│    - Check triggered conditions                             │
│    - Execute automatic consequences                         │
│    - Emit events                                            │
│                                                             │
│ 4. AGENT COGNITION (every N ticks)                          │
│    For each active agent:                                   │
│    a. Gather perception (TextRenderer)                      │
│    b. Collect pending stimuli                               │
│    c. LLM thinks based on perception + memory + goals       │
│    d. Agent chooses action                                  │
│    e. Execute action                                        │
│    f. Broadcast effects to nearby agents                    │
│                                                             │
│ 5. CLEANUP                                                  │
│    - Remove expired entities                                │
│    - Prune old perceptions/thoughts                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Cognition Architecture

This section details how agent cognition fits into the world-building architecture and compares against the "Generative Agents" paper capabilities.

### 6.1 Generative Agents Comparison

| Capability | Generative Agents Paper | ArgOS Status | Notes |
|------------|------------------------|--------------|-------|
| **Memory** | Episodic + semantic memories | ✅ Implemented | `knowledge-graph.ts` - episodic/semantic/procedural types |
| **Beliefs** | Facts about the world | ✅ Implemented | SPO triples with confidence scores |
| **Impressions** | Opinions of others | ✅ Implemented | Trait-based with valence/confidence |
| **Reflection** | Periodic higher-order thoughts | ✅ Implemented | `reflection-system.ts` - triggers when importance threshold exceeded |
| **Plans** | Hierarchical plans with steps | ✅ Implemented | `planning-system.ts` - LLM decomposes goals into steps |
| **Goal Pursuit** | Goals → Plans → Actions | ✅ Implemented | Goals wired to `buildAgentContext()`, prompt instructs to pursue |
| **Daily Schedule** | Time-based routines | ✅ Implemented | `schedule-system.ts` - Schedule component with activities |
| **Movement** | Spatial navigation | ✅ Implemented | Room-based + grid-based movement in `executeActions()` |
| **Environment Interaction** | Object affordances | ✅ Implemented | Affordance system wired via `interact` action + sensory system |
| **Identity/Personality** | Consistent character | ✅ Implemented | Agent.role, systemPrompt, Description, Personality (Big Five) |
| **Conversation** | Natural dialogue | ✅ Implemented | ConversationTurn tracking, speech actions |

### 6.2 Current Cognition Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT COGNITION STACK                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │    Memory     │  │    Belief     │  │  Impression   │       │
│  │  (knowledge-  │  │  (knowledge-  │  │  (knowledge-  │       │
│  │   graph.ts)   │  │   graph.ts)   │  │   graph.ts)   │       │
│  │               │  │               │  │               │       │
│  │ - episodic    │  │ - SPO triple  │  │ - targetName  │       │
│  │ - semantic    │  │ - confidence  │  │ - trait       │       │
│  │ - procedural  │  │ - source      │  │ - valence     │       │
│  │ - importance  │  │ - timestamp   │  │ - confidence  │       │
│  │ - emotion     │  │               │  │ - basis       │       │
│  │ - recallCount │  └───────────────┘  └───────────────┘       │
│  └───────────────┘                                             │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │   Perception  │  │    Thought    │  │     Goal      │       │
│  │  (agent-mind) │  │  (agent-mind) │  │  (components) │       │
│  │               │  │               │  │               │       │
│  │ - type        │  │ - content     │  │ - description │       │
│  │ - content     │  │ - type        │  │ - priority    │       │
│  │ - source      │  │ - salience    │  │ - status      │       │
│  │ - intensity   │  │ - timestamp   │  │ - progress    │       │
│  │ - timestamp   │  │               │  │ - deadline    │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │     Mind      │  │  Personality  │  │ Conversation  │       │
│  │               │  │  (Big Five)   │  │     Turn      │       │
│  │ - mode        │  │               │  │               │       │
│  │ - arousal     │  │ - openness    │  │ - role        │       │
│  │ - focus       │  │ - conscienti. │  │ - content     │       │
│  │ - lastUpdate  │  │ - extravers.  │  │ - timestamp   │       │
│  │               │  │ - agreeable.  │  │               │       │
│  │               │  │ - neuroticism │  │               │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Cognition Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     COGNITION CYCLE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. PERCEIVE (Sensory System)                                   │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │ generateStimuliForAgent() processes 5 sensory channels: │ │
│     │                                                         │ │
│     │ VISUAL    - Room description, objects, agents present   │ │
│     │ AUDITORY  - Speech, ambient sounds, noise events        │ │
│     │ OLFACTORY - Scents from nearby sources                  │ │
│     │ TACTILE   - Temperature, vibrations, touch              │ │
│     │ COGNITIVE - Affordances, danger sense, intuitions       │ │
│     │                                                         │ │
│     │ Agent traits modify perception (blind, deaf, intuitive) │ │
│     └─────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  2. BUILD CONTEXT                                               │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │ buildAgentContext():                                    │ │
│     │ - Identity (Name, Description, role, systemPrompt)      │ │
│     │ - Current state (location, mode, arousal, focus)        │ │
│     │ - Others present (via OccupiesRoom relation)            │ │
│     │ - Recent perceptions (last 5)                           │ │
│     │ - Recent thoughts (last 3)                              │ │
│     │ - Knowledge summary (memories, beliefs, impressions)    │ │
│     └─────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  3. THINK (LLM)                                                 │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │ agentThink() → gemini-3-flash-preview                    │ │
│     │ Input: context + conversation history + prompt          │ │
│     │ Output: { innerThought, action }                        │ │
│     │                                                         │ │
│     │ Available actions:                                      │ │
│     │ - speak: Say something (content)                        │ │
│     │ - observe: Focus attention (target)                     │ │
│     │ - think: Internal thought (content)                     │ │
│     │ - interact: Physical action (target + content)          │ │
│     │ - wait: Do nothing                                      │ │
│     │ - move: [EXISTS BUT NOT IMPLEMENTED]                    │ │
│     └─────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  4. EXECUTE                                                     │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │ executeActions():                                       │ │
│     │ - speak → broadcastToRoom() + log                       │ │
│     │ - observe → Mind.focus update                           │ │
│     │ - think → log only                                      │ │
│     │ - interact → broadcastToRoom() + log                    │ │
│     └─────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  5. LEARN                                                       │
│     ┌─────────────────────────────────────────────────────────┐ │
│     │ extractKnowledgeFromInteraction():                      │ │
│     │ - LLM extracts memories, beliefs, impressions           │ │
│     │ - Adds to agent's knowledge graph                       │ │
│     └─────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Implemented Features & Remaining Gaps

#### ✅ Goals Wired to Thinking (IMPLEMENTED)

Goals are now included in `buildAgentContext()`:
```typescript
const goalTargets = getRelationTargets(world, eid, HasGoal);
const activeGoals = goalTargets
  .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active")
  .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))
  .slice(0, 5);
```

Agent prompt includes: "Consider your active goals when deciding what to do."

#### ✅ Personality Wired to Context (IMPLEMENTED)

Big Five personality traits are included with natural language formatting:
```typescript
const personalityTraits = hasComponent(world, eid, Personality) ? {
  openness, conscientiousness, extraversion, agreeableness, neuroticism
} : null;

// Formatted as: "curious and creative, outgoing and energetic, cooperative and trusting"
```

#### ✅ Movement Implemented (IMPLEMENTED)

Full movement support in `executeActions()`:
- **Room-based movement**: Finds destination room, removes from current, adds to new, broadcasts departure/arrival
- **Grid-based movement**: Uses `setMovementTarget()` for pathfinding
- **Random wandering**: Falls back to random grid movement if no valid target

#### ✅ Planning System (IMPLEMENTED)

Goals now decompose into step-by-step plans via LLM:
```typescript
// src/cognition/planning-system.ts
export const Plan = {
  goalEid: [] as number[],
  steps: [] as string[],       // JSON array of PlanStep objects
  currentStep: [] as number[],
  status: [] as string[],      // "active", "completed", "failed"
};

// Generate plans automatically
await runPlanningSystem(world);

// Get suggested action from plan
const nextStep = getNextPlannedAction(world, agentEid);
```

#### ✅ Reflection System (IMPLEMENTED)

Triggers higher-order thinking when importance threshold exceeded:
```typescript
// src/cognition/reflection-system.ts
export const ReflectionState = {
  importanceAccum: [] as number[],      // Accumulated since last reflection
  reflectionThreshold: [] as number[],  // Default 100
  insights: [] as string[],             // Recent realizations
};

// Accumulate importance from experiences
accumulateImportance(world, agentEid, 5);

// Check and trigger reflection if threshold exceeded
await maybeReflect(world, agentEid);
```

#### ✅ Schedule System (IMPLEMENTED)

Agents have daily routines with time-based activities:
```typescript
// src/cognition/schedule-system.ts
export const Schedule = {
  activities: [] as string[],         // JSON array of ScheduledActivity
  currentActivity: [] as string[],    // What agent should be doing now
  flexibility: [] as number[],        // 0-1, how strictly to follow
};

// Initialize with default or LLM-generated schedule
await initializeAllSchedules(world, true);

// Get current activity based on world time
const activity = getCurrentActivity(world, agentEid);
```

### 6.5 GodAI Cognition Extensions

GodAI can extend cognition at runtime through these mechanisms:

#### 1. New Cognitive Components
```typescript
// GodAI can create new cognitive components
godCommand(state, `Create a "Motivation" component with:
  - drive: string (what motivates)
  - intensity: number (how strongly)
  - source: string (where it comes from)`);
```

#### 2. New Cognitive Systems
```typescript
// GodAI can bake new systems that process cognition
godCommand(state, `Create a system that:
  - Checks each agent's memories for traumatic events
  - If found, increases neuroticism temporarily
  - Triggers avoidance behavior near similar stimuli`);
```

#### 3. Cognitive Context API
Systems have access to `ctx.cognitive` with:
- `createGoal(world, agentEid, data)` → create goal
- `createMemory(world, agentEid, data)` → create memory
- `createBelief(world, agentEid, data)` → create belief
- `createThought(world, agentEid, data)` → create thought
- `createImpression(world, agentEid, data)` → create impression
- `getGoals(world, agentEid)` → read all goals
- `getMemories(world, agentEid)` → read all memories
- `getBeliefs(world, agentEid)` → read all beliefs
- `updateGoal(eid, updates)` → modify goal
- `completeGoal(world, eid)` → mark goal complete

#### 4. Persona System
Rich persona generation available via `persona.ts`:
- Long-term and short-term goals
- Motivations and fears
- Backstory and relationships
- Personality traits and quirks
- Speech patterns and catchphrases

### 6.6 Cognition Integration Roadmap

#### Phase 1: Complete Basic Cognition ✅ COMPLETE
- [x] Wire goals into `buildAgentContext()`
- [x] Wire personality into `buildAgentContext()`
- [x] Implement `move` action (room-based + grid-based)
- [x] Wire sensory system to perception (5 modalities)
- [x] Wire affordances to interact action

#### Phase 2: Enhanced Memory ✅ COMPLETE
- [x] Add reflection scheduling system (`reflection-system.ts`)
- [x] Importance threshold-based reflection triggers
- [x] Add memory consolidation (`memory-consolidation.ts` - Ebbinghaus forgetting curves)
- [x] Add forgetting curves (retention = e^(-t/S) based on stability)

#### Phase 3: Planning ✅ COMPLETE
- [x] Add `Plan` component
- [x] Bake `PlanningSystem` (`planning-system.ts`)
- [x] Goal → Plan decomposition via LLM

#### Phase 4: Full Generative Agents Parity ✅ COMPLETE
- [x] Daily schedule component (`schedule-system.ts`)
- [x] Time awareness in cognition (activities based on hour)
- [x] Location preference in schedules
- [x] Schedule adaptation system (`schedule-adaptation.ts` - needs/goals/social override)
- [x] Belief revision system (`belief-revision.ts` - confidence decay, contradiction resolution)

#### Phase 5: Unified API ✅ COMPLETE
- [x] Single entry point (`src/index.ts`)
- [x] `createSimulation()` - main API with sensible defaults
- [x] `createSimulationFromPrompt()` - natural language to simulation
- [x] `createVillageSimulation()` - quick test helper
- [x] Re-exports for advanced usage

---

### 6.7 Agent Perception via TextRenderer (Target State)

Agents will perceive the world through TextRenderer, which produces MUD-style descriptions:

```
=== Village Square ===

The central square of a small medieval village. Cobblestones worn 
smooth by countless feet. A well stands in the center.

Warm light flickers from nearby torches.

You see:
  - a wooden cart (open)
  - a market stall displaying wares
  - a stone well

People here:
  - Berta (a shrewd merchant)

You can:
  - examine <object>
  - take <object>
  - talk to Berta
  - go north (to Tavern)
  - go south (to Blacksmith)
```

This text becomes the agent's perception, which feeds into their cognitive loop.

### 6.8 Sensory System Implementation

The sensory system (`sensory-system.ts`) processes perception through five distinct channels:

```
┌─────────────────────────────────────────────────────────────────┐
│                     SENSORY PROCESSING                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  VISUAL Channel                                                 │
│  ├── Room description (TextRenderer)                            │
│  ├── Objects present with states                                │
│  ├── Other agents and their activities                          │
│  └── Modified by: blind (blocks), keen_sight (enhances)         │
│                                                                 │
│  AUDITORY Channel                                               │
│  ├── Speech from other agents                                   │
│  ├── Ambient sounds (AmbientStimulusSystem)                     │
│  ├── Action sounds (doors, footsteps, etc.)                     │
│  └── Modified by: deaf (blocks), keen_hearing (enhances)        │
│                                                                 │
│  OLFACTORY Channel                                              │
│  ├── Scents from stimulus sources                               │
│  ├── Environmental odors                                        │
│  └── Modified by: anosmic (blocks)                              │
│                                                                 │
│  TACTILE Channel                                                │
│  ├── Temperature changes                                        │
│  ├── Physical contact                                           │
│  ├── Vibrations                                                 │
│  └── Less commonly modified                                     │
│                                                                 │
│  COGNITIVE Channel (Sixth Sense)                                │
│  ├── Available affordances on nearby objects                    │
│  ├── Danger detection (hostile entities, traps)                 │
│  ├── Social intuitions                                          │
│  └── Modified by: intuitive (enhances), psychic (full access)   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Stimulus Sources (Ambient Emitters)

Entities with `StimulusSource` component periodically emit stimuli:

```typescript
// Example: A crackling fire
createStimulusSourceEntity(world, {
  name: "campfire",
  stimulusType: "sound",           // Maps to auditory
  template: "{name} crackles and pops",
  interval: 8000,                  // Every 8 seconds
  roomId: tavernRoom
});

// Example: A fragrant flower
createStimulusSourceEntity(world, {
  name: "rose bush",
  stimulusType: "scent",           // Maps to olfactory
  template: "The sweet scent of {name} fills the air",
  interval: 15000,
  roomId: gardenRoom
});
```

#### Cognitive Sense and Affordances

The cognitive channel provides agents with meta-knowledge about their world:

```
COGNITIVE PERCEPTION:
- You sense that the wooden door can be: opened, examined, knocked on
- You sense that the treasure chest can be: opened, examined, taken
- You notice Alice (nearby agent) can be: talked to, observed, followed
- You sense potential danger from the dark corridor
```

This allows agents to know what actions are available without explicitly examining each object.

---

## 7. Agent Hierarchy

### 7.1 Current: Two-Tier GodAI + NPCs

```
┌─────────────────────────────────────────────────────────────┐
│  GodAI                                                      │
│  ├── Planner (Pro/Opus) - designs simulations               │
│  └── Executor (Flash) - builds via tools                    │
└──────────────────────────────┬──────────────────────────────┘
                               │ creates
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  NPC Agents (via createAgent)                               │
│  - Each has Agent + Mind components                         │
│  - Cognition system processes all agents each tick          │
│  - LLM-based thinking (gemini-3-flash-preview)              │
│  - Actions: speak, observe, think, interact, wait           │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Specialized Agent Hierarchy (Implemented)

**Status: ✅ IMPLEMENTED** - See **Section 13: Spirit Hierarchy** for full details.

The Spirit Hierarchy implements an emanationist architecture where GodAI delegates observation and steering to specialized AI spirits:

```
┌─────────────────────────────────────────────────────────────┐
│  GodAI (Opus) - High-level design, narrative direction      │
└──────────────────────────────┬──────────────────────────────┘
                               │ commands & receives reports
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  The Narrator    │ │  Sociologist     │ │  Guardian        │
│  (Archangel)     │ │  (Archangel)     │ │  (Angel)         │
│  - Story pacing  │ │  - Relationships │ │  - NPC watcher   │
│  - Plot threads  │ │  - Group dynamics│ │  - Character arc │
└──────────────────┘ └──────────────────┘ └──────────────────┘
           │
           ▼
┌──────────────────┐
│  Locale Spirits  │  (Daemons - subordinate to higher spirits)
│  - Room watchers │
└──────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  NPC Agents (Flash) - Individual character cognition        │
└─────────────────────────────────────────────────────────────┘
```

**Key Features:**
- Spirits observe ECS state and report to superiors
- The Narrator (first implemented) tracks narrative structure, tension, and pacing
- Spirits can intervene by injecting stimuli, sending intuitions, or modifying moods
- DivineMessage protocol enables inter-spirit communication
- Full test coverage (43 unit + integration tests)

---

## 8. Component & System Catalogs

### 8.1 Built-in Components

| Component | Purpose | Key Fields |
|-----------|---------|------------|
| `Name` | Entity identifier | `value: string` |
| `Description` | Text description | `text: string` |
| `Agent` | Marks cognitive entity | `active, role, systemPrompt` |
| `Mind` | Agent mental state | `arousal, focus, mode` |
| `Thought` | Agent's current thought | `content, type, salience` |
| `Perception` | Sensory input | `type, content, source` |
| `Memory` | Stored memory | `content, importance` |
| `Goal` | Agent objective | `description, priority` |
| `Room` | Location marker | `capacity, ambience` |
| `Position` | 2D coordinates | `x, y` |

### 8.2 WorldSchema Components

| Component | Purpose |
|-----------|---------|
| `ObjectType` | Links entity to schema prefab |
| `ObjectState` | Current state in state machine |
| `Traits` | Capability flags (openable, takeable, etc.) |
| `LightSource` | Emits light with intensity |
| `Container` | Can hold other entities |

### 8.3 Built-in Systems

| System | Purpose | Frequency |
|--------|---------|-----------|
| `TimeProgression` | Advances world time | 10s |
| `SocialDynamics` | Agent arousal from presence | 10s |
| `AmbientStimulusSystem` | Emits periodic stimuli from StimulusSource entities | 5s |
| `MindDecay` | Decays arousal over time | 5s |
| `AgentCognition` | Processes agent thinking via sensory system | 10s |

### 8.4 Dynamic (AI-Created)

GodAI can create any component or system at runtime:

```typescript
// Component
createComponent("Temperature", { current: "number", max: "number" })

// System  
bakeNewSystem("HeatTransfer", {
  description: "Heat flows between adjacent entities",
  frequency: 5000,
  logic: "..."
})
```

---

## 9. Feasibility & Constraints

### 9.1 What Works Well

- **Medium-complexity simulations** - Economy, predator-prey, social dynamics
- **Component/entity creation** - GodAI reliably creates data structures
- **System baking** - Generated code usually works (with auto-fix loops)
- **Design-then-execute pattern** - Pro thinks, Flash builds

### 9.2 Challenges

- **Very novel concepts** - Struggles without examples
- **Complex emergent systems** - May need iteration/guidance
- **Long-running coherence** - Context limits require summarization
- **Debugging baked systems** - Generated code can be opaque

### 9.3 Guardrails

- Baked systems validated before execution
- Runtime errors caught and logged
- Auto-fix loop attempts repairs
- Invalid component access returns undefined (no crash)

---

## 10. Integration Roadmap

### Phase 1: Connect WorldSchema to GodAI ✅ COMPLETE
- [x] Add `spawn` tool - instantiate from prefab
- [x] Add `defineObjectType` tool - extend schema
- [x] Add `defineAffordance` tool - add actions
- [x] Add `defineRule` tool - add reactive rules

### Phase 2: Wire TextRenderer to Cognition ✅ COMPLETE
- [x] Agent perception uses TextRenderer.renderPerception()
- [x] Affordances shown as available actions (via cognitive sense)
- [x] Agents see MUD-style text, not raw components
- [x] Sensory system with 5 modalities (visual, auditory, olfactory, tactile, cognitive)
- [x] Effect executor for affordance-based state changes
- [x] Ambient stimulus sources for periodic environmental stimuli

### Phase 3: Unified Simulation Runner
- [ ] Single entry point: prompt → running simulation
- [ ] Built-in UI for observation
- [ ] REPL for GodAI commands during runtime

### Phase 4: Enhanced Narrative
- [ ] Plot arc tracking
- [ ] Character relationship visualization
- [ ] Narrative tension/pacing systems

### Phase 5: GodAI Monitoring & Steering ✅ IMPLEMENTED
- [x] **GodAI Observation Loop** - Periodic world state inspection
  - `getWorldSummary()` - Monitor agent behaviors, emotional states, relationships
  - `getNarrativeTension()` - Track narrative arc progression
  - `getSteeringRecommendations()` - Detect stagnation, conflicts, emergent patterns
- [x] **Event Injection** - GodAI can trigger events at will
  - `injectEnvironmentalEvent()` - Environmental events to rooms
  - `injectIntuition()` - Cognitive sense events to agents
  - `broadcastAnnouncement()` - World-wide announcements
- [x] **Narrative Steering** - Guide without micromanaging
  - `setNarrativeGoals()` / `getNarrativeGoals()` - Track narrative direction
  - `modifyAgentMood()` - Influence agent behavior
  - `pauseAgent()` / `resumeAgent()` - Control agent activity
- [x] **Dynamic System Creation** - Bake new systems mid-simulation (via existing `bakeNewSystem` tool)
- [x] **Simulation Analytics** - Real-time metrics
  - `getInterventionStats()` - Track intervention count, tension, stagnation
  - Steering patterns: nudge, catalyst, escalation, resolution
  - World state summaries with text output for GodAI context

---

## 11. File Map

```
src/
├── god/
│   ├── god-agent.ts       # Main GodAI implementation
│   ├── system-baker.ts    # Code generation for systems
│   └── monitoring-system.ts # World observation & narrative steering
├── ecs/
│   ├── world.ts           # World creation
│   ├── components.ts      # Built-in components
│   ├── relations.ts       # Entity relationships
│   ├── dynamic-components.ts  # Runtime component creation
│   ├── dynamic-systems.ts # Runtime system management
│   └── tools.ts           # GodAI tool implementations
├── world/
│   ├── schema.ts          # WorldSchema definitions
│   ├── object-manager.ts  # Prefab instantiation
│   ├── rules-engine.ts    # Declarative rules
│   ├── effect-executor.ts # Affordance effect execution
│   └── text-renderer.ts   # MUD-style output
├── cognition/
│   ├── agent-mind.ts      # Agent LLM processing
│   ├── cognition-system.ts # Agent tick processing
│   ├── sensory-system.ts  # Sensory perception processing
│   ├── knowledge-graph.ts # Memory/knowledge
│   ├── planning-system.ts # Goal → Plan decomposition ✅ NEW
│   ├── reflection-system.ts # Higher-order thought synthesis ✅ NEW
│   └── schedule-system.ts # Time-based routines ✅ NEW
├── spirits/
│   ├── index.ts           # Module exports
│   ├── types.ts           # Spirit types and interfaces
│   ├── spirit-registry.ts # Hierarchy management
│   ├── spirit-cognition.ts # Spirit LLM processing loop
│   ├── spirit-system.ts   # ECS ticker for spirits
│   ├── spirit-messaging.ts # Inter-spirit communication & capability routing ✅ ENHANCED
│   ├── spirit-factory.ts  # Dynamic spirit creation at runtime ✅ NEW
│   ├── spirit-tools.ts    # Domain-specific tool sets for spirit types ✅ NEW
│   ├── narrator-spirit.ts # The Narrator archangel definition
│   ├── consistency-spirit.ts # The Arbiter - validates & routes reports
│   ├── agent-daemon.ts    # Personal agent daemons: mini-narrator with memory & arc tracking ✅ UPDATED
│   ├── artificer-spirit.ts # System maintenance & repair spirit ✅ NEW
│   ├── system-watcher.ts  # System monitoring & anomaly detection ✅ NEW
│   ├── architect-spirit.ts # System design & proposals ✅ NEW
│   ├── world-crafter-spirit.ts # Entity materialization & world evolution ✅ NEW
│   └── story-templates.ts # Story arc templates (3-act, mystery, etc.)
├── introspection/
│   └── introspection.ts   # Dynamic registries & event buffer ✅ NEW
├── runtime/
│   ├── simulation-loop.ts # Dual-loop runtime (fast ECS + slow AI) ✅ NEW
│   └── async-task-queue.ts # Priority-based background AI task queue ✅ NEW
├── llm/
│   └── config.ts          # Centralized LLM model config (LOCKED) ✅ NEW
├── systems/
│   └── ambient-stimulus-system.ts # Periodic stimulus emission
├── __tests__/
│   ├── daemon-memory-arc.test.ts # Daemon memory & arc unit tests (37 tests) ✅ NEW
│   └── ...                        # Other unit tests
└── behavioral-tests/
    ├── challenge-01-economy.ts     # Economy simulation test
    ├── challenge-02-predator-prey.ts # Ecosystem test
    ├── 03-introspection-stress.ts  # Introspection system stress test ✅ NEW
    ├── 04-spirit-godai-integration.ts # Spirit → GodAI integration test ✅ NEW
    ├── 05-daemon-routing-integration.ts # Daemon & routing test ✅ NEW
    ├── 05-world-crafter-test.ts    # World Crafter entity materialization & evolution test ✅ NEW
    ├── 08-dual-loop-integration.ts # Dual-loop runtime integration test ✅ NEW
    └── 13-daemon-mini-narrator.ts  # Daemon mini-narrator behavioral test (26 tests) ✅ NEW
```

---

## 12. GodAI Monitoring & Steering (Design)

This section details the design for GodAI to actively monitor and guide simulations.

### 12.1 Observation Loop Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GODAI OBSERVATION LOOP                       │
│                    (runs every N simulation ticks)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. COLLECT WORLD STATE                                         │
│     ├── Query all agents: location, mood, recent actions        │
│     ├── Query relationships: who knows whom, attitudes          │
│     ├── Query environment: room states, object states           │
│     └── Summarize into GodAI-consumable context                 │
│                                                                 │
│  2. ANALYZE                                                     │
│     ├── Detect stagnation (no actions, repetitive behavior)     │
│     ├── Identify emergent patterns (factions, romances, feuds)  │
│     ├── Track narrative tension (conflict level, stakes)        │
│     └── Compare against narrative goals                         │
│                                                                 │
│  3. DECIDE                                                      │
│     ├── Should I intervene? (based on narrative goals)          │
│     ├── What type of intervention?                              │
│     │   ├── Subtle: environmental change, NPC mood shift        │
│     │   ├── Moderate: new NPC arrival, quest trigger            │
│     │   └── Major: crisis event, system-level change            │
│     └── How to preserve emergent narrative?                     │
│                                                                 │
│  4. INTERVENE (via existing tools)                              │
│     ├── injectEvent() - Direct stimulus to room/agent           │
│     ├── createAgent() - New NPC enters the scene                │
│     ├── modifyComponent() - Change agent states                 │
│     ├── bakeNewSystem() - Add new behaviors to world            │
│     └── broadcast() - Narrate to all agents                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 New Tools for GodAI Monitoring

| Tool | Purpose | Implementation |
|------|---------|----------------|
| `getWorldSummary()` | Compressed world state for GodAI context | Query all entities, summarize |
| `getAgentStatus(eid)` | Detailed agent state (mood, focus, goals) | Read agent components |
| `getRelationshipGraph()` | Who knows whom, with attitudes | Query Impression/Belief stores |
| `getNarrativeTension()` | Calculated conflict/stakes metric | Analyze recent events |
| `injectEvent(roomId, event)` | Trigger stimulus in a room | broadcastToRoom() |
| `setNarrativeGoal(goal)` | Tell GodAI what story to aim for | Store in GodAgent component |
| `pauseAgent(eid)` / `resumeAgent(eid)` | Temporarily disable agent | Set Agent.active |

### 12.3 GodAgent Component Extension

```typescript
// Extended GodAgent component
GodAgent: {
  worldName: string,
  narrative: string,           // Current narrative summary
  narrativeGoals: string[],    // What GodAI is trying to achieve
  tension: number,             // Current narrative tension (0-1)
  lastObservation: number,     // Timestamp of last observation
  interventionCount: number,   // Track how often GodAI intervenes
  observationInterval: number, // How often to observe (ms)
}
```

### 12.4 Event Injection System

GodAI can inject events at various levels:

```typescript
// Room-level event (all agents in room perceive)
injectEvent({
  type: "environmental",
  room: tavernRoom,
  content: "A mysterious stranger enters the tavern, cloaked in shadow",
  modality: "visual",
});

// Agent-specific event (only one agent perceives)
injectEvent({
  type: "intuition",
  target: heroAgent,
  content: "You have a strong feeling that danger approaches",
  modality: "cognitive",
});

// World-level event (broadcast to all agents)
injectEvent({
  type: "announcement",
  broadcast: true,
  content: "The church bells toll midnight across the village",
  modality: "auditory",
});
```

### 12.5 Narrative Steering Patterns

#### Pattern 1: Gentle Nudges
```
Observation: Two agents haven't interacted despite proximity
Action: Create ambient stimulus that brings them together
Example: "The sudden rain forces everyone under the tavern awning"
```

#### Pattern 2: Catalyst Introduction
```
Observation: Story has stagnated, no conflict
Action: Introduce new NPC with conflicting goals
Example: Create agent with opposing faction membership
```

#### Pattern 3: Crisis Escalation
```
Observation: Conflict exists but tension is low
Action: Raise stakes via environmental pressure
Example: "Food supplies are running low" (add Scarcity system)
```

#### Pattern 4: Resolution Facilitation
```
Observation: Conflict has gone on too long
Action: Provide opportunity for resolution
Example: Create neutral ground/mediator NPC
```

### 12.6 World State Summarization

For GodAI to make decisions, it needs compressed world state:

```typescript
interface WorldStateSummary {
  tick: number;
  agentSummaries: {
    name: string;
    location: string;
    mood: string;        // Derived from Mind.arousal + recent actions
    recentActions: string[];
    relationships: { name: string; attitude: string }[];
  }[];
  activeConflicts: {
    parties: string[];
    nature: string;
    intensity: number;
  }[];
  environmentState: {
    roomName: string;
    description: string;
    ambience: string;
    objectStates: { name: string; state: string }[];
  }[];
  narrativeArc: {
    currentPhase: string;  // "setup" | "rising" | "climax" | "falling" | "resolution"
    tension: number;
    recentEvents: string[];
  };
}
```

### 12.7 Implementation Priority

1. **`getWorldSummary()`** - Foundation for all monitoring ✅
2. **`injectEvent()`** - Basic intervention capability ✅
3. **Observation loop scheduler** - Periodic GodAI cognition ✅
4. **Narrative tension calculation** - Inform intervention decisions ✅
5. **Steering patterns** - Higher-level intervention logic ✅

---

## 13. Spirit Hierarchy (Implemented)

The Spirit System provides a celestial hierarchy of AI agents that observe and steer the simulation,
inspired by emanationist/Kabbalistic cosmology. Spirits report up to GodAI while managing their domains.

### 13.1 Hierarchy Structure (Updated)

```
                              ┌─────────────────┐
                              │     GODAI       │  Supreme Being
                              │  (The Creator)  │  Designs world, delegates room creation
                              └────────┬────────┘
                                       │ commands / delegates / receives reports
     ┌──────────────────┬──────────────┼──────────────┬──────────────────┐
     │                  │              │              │                  │
┌────▼─────┐     ┌──────▼──────┐ ┌─────▼─────┐ ┌─────▼─────┐   ┌────────▼────────┐
│THE ARBITER│    │  NARRATOR   │ │THE CRAFTER│ │THE STEWARD│   │   THE WEAVER    │
│(Consistency)   │ (Narrative) │ │ (Ecology) │ │  (Locale) │   │   (Architect)   │
│Routes reports │ │Story pacing│ │Materializes│ │Populates  │   │Creates systems  │
│validates      │ │Plot threads│ │entities   │ │rooms with │   │Receives proposals│
└─────┬─────┘   └─────────────┘ │evolves    │ │entities   │   └─────────────────┘
      │                          │world      │ └──────┬────┘            ▲
      │ receives daemon reports  └─────┬─────┘        │                 │
      │                                 │             │ requests       │
      │                                 │ evolution   │ systems        │
┌─────┴─────┬───────────┬───────────┐  │ proposals   └─────────────────┘
│           │           │           │   │
┌───▼────┐ ┌───▼────┐ ┌────▼────┐ ┌────▼────┐
│ Alice  │ │  Bob   │ │ Charlie │ │ Diana   │  Agent Daemons
│ Daemon │ │ Daemon │ │ Daemon  │ │ Daemon  │  (Personal guardians)
└────────┘ └────────┘ └─────────┘ └─────────┘
    │          │           │           │
    ▼          ▼           ▼           ▼
 (watch)    (watch)     (watch)     (watch)
    │          │           │           │
┌───▼────┐ ┌───▼────┐ ┌────▼────┐ ┌────▼────┐
│ Alice  │ │  Bob   │ │ Charlie │ │ Diana   │  NPC Agents
│  NPC   │ │  NPC   │ │   NPC   │ │  NPC    │  (in simulation)
└────────┘ └────────┘ └─────────┘ └─────────┘
```

**Key Features of the Updated Hierarchy:**
1. **GodAI** receives growth recommendations AND delegates room creation to The Steward
2. **The Arbiter** (ConsistencySpirit) is the central hub for routing all daemon reports
3. **Agent Daemons** serve dual purpose: protection AND growth challenges
4. **The Narrator** receives narrative-domain issues from The Arbiter
5. **The Crafter** materializes entities and proposes world evolution when resource gaps emerge
6. **The Steward** populates rooms with appropriate entities, ensuring descriptions match reality ✅ NEW
7. **The Weaver** (Architect) receives proposals from The Crafter AND system requests from The Steward
8. Future spirits (Sociologist, Economist, etc.) will receive their domain-specific issues

### 13.2 Spirit Types

| Rank | Role | Capabilities |
|------|------|--------------|
| **Archangel** | Domain manager | Inject events, modify mood, send reports, route reports |
| **Angel** | Local/entity manager | Inject events to specific area, reports |
| **Daemon** | Task-specific | Observe, whisper to agents, report to superior |
| **Agent Daemon** | Personal guardian | Watch individual agent, whisper guidance AND challenge |

### 13.2.1 Agent Daemons (Personal Guardian Spirits) ✅ UPDATED

Each agent in the simulation has a personal daemon that serves as a **mini-narrator** - maintaining rich memory tracking and personal story arcs for their NPC.

**Core Responsibilities:**
1. **Protection Mode** - Guidance whispers when agent is struggling
2. **Growth Mode** - Challenge whispers to push development
3. **Memory Tracking** - Comprehensive memory of agent's experiences ✅ NEW
4. **Personal Arc Management** - Track individual narrative arc progression ✅ NEW
5. **Self-Resolution** - Auto-generate nudges when arcs stagnate ✅ NEW

#### Daemon Memory System ✅ NEW

Each daemon maintains a comprehensive memory of their agent's journey:

```typescript
interface DaemonMemory {
  // Recent thoughts (what the agent has been thinking)
  recentThoughts: ThoughtSummary[];     // Last 20 thoughts with topics/emotions

  // Key memories (important events and experiences)
  keyMemories: MemoryEntry[];           // Up to 50 significant memories

  // Active plans (what the agent is trying to accomplish)
  activePlans: PlanEntry[];             // Goals, steps, progress

  // Relationship changes (social dynamics)
  relationshipHistory: RelationshipChange[];  // Bonds formed/broken

  // Character moments (pivotal experiences)
  characterMoments: CharacterMoment[];  // Growth, revelation, tragedy, humor

  lastPruning: number;                  // Automatic memory cleanup
}

interface ThoughtSummary {
  tick: number;
  focus: string;        // What they were thinking about
  emotion?: string;     // Emotional coloring
  significance: number; // 0-1, how important
}

interface MemoryEntry {
  tick: number;
  type: "action" | "dialogue" | "observation" | "reflection";
  summary: string;
  participants: string[];
  emotionalWeight: number;  // -1 to 1 (negative to positive)
  narrativeImportance: number; // 0-1
}
```

**Memory Functions:**
| Function | Purpose |
|----------|---------|
| `recordThought()` | Track agent's inner thoughts |
| `recordMemory()` | Store significant experiences |
| `recordPlan()` | Track goal-oriented intentions |
| `updatePlanStatus()` | Mark plans as progressed/completed/abandoned |
| `recordRelationshipChange()` | Track social bond changes |
| `recordCharacterMoment()` | Capture pivotal character moments |
| `getMemorySummary()` | Generate narrative-ready memory summary |
| `pruneMemory()` | Automatic cleanup of old/low-significance memories |

#### Personal Narrative Arc ✅ NEW

Each daemon tracks a **personal story arc** for their agent:

```typescript
interface DaemonNarrativeArc {
  theme: string;          // "redemption", "love lost", "coming of age"
  status: ArcStatus;      // dormant → setup → rising → crisis → climax → falling → resolution
  drivingGoal: string;    // What the agent is striving toward
  tension: number;        // 0-1, current dramatic tension
  desiredResolution: string;  // How the arc should ideally resolve

  stakes: {
    toGain: string;       // What's at stake if they succeed
    toLose: string;       // What's at stake if they fail
  };

  completedBeats: string[];   // Story beats achieved
  upcomingBeats: string[];    // Anticipated story beats

  // Stagnation detection
  ticksSinceProgress: number;
  stagnationThreshold: number;  // Default 10 ticks
  needsSelfResolution: boolean;
  selfResolutionAttempts: number;

  previousArcs: CompletedArc[];  // History of completed arcs
}

type ArcStatus = "dormant" | "setup" | "rising" | "crisis" | "climax" | "falling" | "resolution";
```

**Arc Management Functions:**
| Function | Purpose |
|----------|---------|
| `startNarrativeArc()` | Begin a new arc with theme and goals |
| `progressNarrativeArc()` | Advance arc status and complete beats |
| `increaseTension()` / `decreaseTension()` | Adjust dramatic tension |
| `checkArcStagnation()` | Detect when arc is stuck |
| `attemptSelfResolution()` | Generate intervention nudge |
| `completeNarrativeArc()` | Archive completed arc with outcome |
| `getArcSummary()` | Generate narrative-ready arc summary |

#### Self-Resolution Mechanism ✅ NEW

When an arc stagnates (no progress for `stagnationThreshold` ticks), the daemon can auto-generate nudges:

```typescript
// Detection
checkArcStagnation(daemonState);  // Sets needsSelfResolution = true if stagnant

// Self-resolution attempt
const nudge = attemptSelfResolution(daemonState);
// Returns: { type: "nudge", content: "Something needs to change..." }

// The daemon can:
// 1. Whisper an internal nudge to the agent
// 2. Report to The Arbiter for external intervention
// 3. Escalate to Narrator for narrative-level resolution
```

**Self-Resolution Flow:**
```
Arc stagnates (10+ ticks without progress)
         │
         ▼
checkArcStagnation() → needsSelfResolution = true
         │
         ▼
attemptSelfResolution() → generates nudge
         │
         ├──► Internal whisper to agent (cognitive stimulus)
         ├──► Report to Arbiter (if still stuck)
         └──► Escalate to Narrator (major intervention needed)
```

#### Protection Mode (Guidance Whispers)

- Detects concerns: stuck agents, low arousal, high arousal, danger, goal drift
- Sends gentle guidance via cognitive stimuli ("inner voice")
- Reports urgent concerns to higher spirits (The Arbiter)

#### Growth Mode (Challenge Whispers)

- Detects growth opportunities: too comfortable, ready for challenge, stagnating, needs conflict
- Sends provocative challenges via cognitive stimuli to push growth
- Reports growth opportunities to GodAI for world-level challenge creation

```typescript
// Daemon observes and detects BOTH concerns AND growth opportunities
interface DaemonObservation {
  agentName: string;
  currentState: AgentStateSnapshot;
  concerns: DaemonConcern[];           // Protection mode
  growthOpportunities: GrowthOpportunity[];  // Challenge mode
  achievements: string[];
}

// Growth opportunity types
type GrowthOpportunity = {
  type: "too_comfortable" | "ready_for_challenge" | "stagnating" |
        "needs_conflict" | "breakthrough_possible" | "skill_plateau" |
        "relationship_test";
  description: string;
  suggestedChallenge: string;
  urgency: "low" | "medium" | "high";
}
```

**Challenge Whisper Types:**
| Type | Purpose | Example |
|------|---------|---------|
| `provocation` | Plant doubt, stir jealousy | "Are you truly content with this?" |
| `doubt` | Question abilities | "Is this really the best you can do?" |
| `ambition` | Whisper of greater things | "You were meant for greater things" |
| `curiosity` | Hint at mysteries | "What lies beyond?" |
| `restlessness` | Create need to change | "Something is wrong. You need to move." |

#### Integration with observeAgent()

The `observeAgent()` function integrates memory and arc tracking:

```typescript
// During agent observation, the daemon:
observeAgent(daemonState, ecsSnapshot);

// 1. Records significant thoughts (if agent is thinking)
// 2. Records memories from recent actions
// 3. Updates relationship tracking from social interactions
// 4. Checks for character moments (growth, revelation, etc.)
// 5. Progresses narrative arc based on activity
// 6. Checks for arc stagnation
// 7. Generates self-resolution nudges if needed
```

### 13.2.2 The Arbiter (ConsistencySpirit) ✅ NEW

**The Arbiter** is a special archangel responsible for:

1. **Dynamic Introspection**: Maintains awareness of ALL actions, components, systems via dynamic registries
2. **Validation**: Validates agent actions and narrative events against world state
3. **Report Routing**: Routes daemon reports and issues to appropriate spirits:
   - **Narrative issues** → The Narrator (narrative domain)
   - **Mechanical issues** → GodAI (for system fixes/additions)
   - **Social issues** → Sociologist (when implemented)

**Issue Categories:**
| Category | Examples | Routed To |
|----------|----------|-----------|
| `narrative` | "Dragon mentioned but not established", plot holes | Narrator |
| `mechanical` | Impossible actions, missing systems, broken rules | GodAI |
| `social` | Relationship inconsistencies, faction issues | Sociologist |
| `environmental` | Weather anomalies, resource inconsistencies | Ecologist |

**Report Routing Flow:**
```
Agent Daemons ─────┐
                   │
                   ▼
          ┌──────────────┐
          │  THE ARBITER │ ← Receives all daemon reports
          │  (Consistency)│
          └──────┬───────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
Narrator       GodAI     Sociologist
(narrative)  (mechanical)  (social)
```

### 13.2.3 The Artificer Spirit (System Maintenance) ✅ NEW

The Artificer is a specialized spirit responsible for **maintaining and repairing the simulation's systems**. While GodAI creates systems, the Artificer keeps them running smoothly.

#### Core Responsibilities

1. **System Inspection** - Patrol all active systems, checking for errors, stagnation, and performance
2. **Error Tracking** - Maintain logs of system errors with frequency and severity tracking
3. **Auto-Repair** - Use AI to fix broken system code when possible
4. **Health Reporting** - Generate system health summaries for GodAI
5. **Emergency Disable** - Shut down critically broken systems to prevent cascading failures

#### Artificer Configuration

```typescript
interface ArtificerConfig {
  inspectionInterval: number;     // How often to run inspection cycles (ms)
  maxErrorsBeforeDisable: number; // Errors before auto-disabling (default: 20)
  autoFixEnabled: boolean;        // Whether to auto-fix simple issues
  ignoreSystems: string[];        // Core systems to leave alone
}
```

#### System Diagnosis

```typescript
interface SystemDiagnosis {
  systemName: string;
  status: "healthy" | "warning" | "critical" | "dead";
  issues: SystemIssue[];
  metrics: {
    executionCount: number;
    errorCount: number;
    lastRun: number;
    frequency: number;
    active: boolean;
  };
  recommendation: "none" | "monitor" | "repair" | "disable" | "investigate";
}

interface SystemIssue {
  type: "error" | "stagnation" | "performance" | "logic" | "missing_dependency";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  suggestedFix?: string;
  autoFixable: boolean;
}
```

#### Repair Actions

| Action Type | Description |
|-------------|-------------|
| `fix_code` | Use AI to modify system code to fix errors |
| `restart` | Reactivate a system after fixing |
| `disable` | Deactivate critically broken systems |
| `modify_frequency` | Adjust system tick rate |
| `clear_errors` | Clear error log after investigation |

#### Tool-Based Cognition ✅ NEW

The Artificer operates in **tool-based mode** where the AI decides what actions to take:

```typescript
const tools = createArtificerTools(world, systemRegistry);
// Available tools: listSystems, inspectSystem, getSystemCode, repairSystem,
//                  enableSystem, disableSystem, clearSystemErrors,
//                  adjustSystemFrequency, reportToGodAI
```

### 13.2.4 The Crafter Spirit (World Materializer) ✅ NEW

**The Crafter** is an archangel of the ecology domain responsible for **materializing entities that agents need** and **triggering world evolution** when resource gaps emerge.

#### Core Responsibilities

1. **Failed Interaction Detection** - Monitors when agents try to interact with non-existent items
2. **Entity Materialization** - Creates contextually appropriate entities (not wish-granting)
3. **Resource Gap Tracking** - Tracks what resources agents can't find
4. **Evolution Proposals** - Proposes new merchants, sources, and systems when gaps accumulate
5. **Supply Chain Awareness** - Knows where resources come from and directs agents there

#### Resource Modes

The Crafter operates differently based on the simulation's resource mode:

| Mode | Behavior | Use Case |
|------|----------|----------|
| `abundance` | Always creates items | Story-focused, no resource management |
| `balanced` | Creates if no source exists, records gaps | Default - prevents starvation while tracking gaps |
| `scarcity` | Blocks duplicates, records gaps | Survival simulations - forces gameplay |

```typescript
// Set simulation resource mode
setSimulationContext({
  resourceMode: "balanced",  // "abundance" | "balanced" | "scarcity"
  hasEconomy: true,
  hasMerchants: true
});

// Register resource sources (The Crafter directs agents here)
registerResourceSource("flour", "Miller's Shop");
registerResourceSource("iron", "Deep Rock Mine");
```

#### Failed Interaction Flow

```
Agent tries: "pickup flour" in Bakery
         │
         ▼
┌────────────────────────────────────────────────────────────────┐
│ THE CRAFTER observes failed interaction                        │
│                                                                 │
│ 1. Check resource mode:                                        │
│    - abundance → Always create                                  │
│    - balanced → Create if no source, record gap                │
│    - scarcity → Block, record gap                              │
│                                                                 │
│ 2. Check if item was already created in this room              │
│    - Yes + source exists → "Get more from Miller's Shop"       │
│    - Yes + no source → Create (balanced) or block (scarcity)  │
│    - No → Create (during setup phase)                          │
│                                                                 │
│ 3. If creating, generate contextually appropriate entity:      │
│    - "flour" in Bakery → "Sack of Fine Flour" with Item comp   │
│    - Request system from Weaver if needed (e.g., CookingSystem)│
│                                                                 │
│ 4. Record gap if resource has no supply chain                  │
└────────────────────────────────────────────────────────────────┘
```

#### Evolution Proposals

When resource gaps accumulate (3+ occurrences), The Crafter generates evolution proposals:

```typescript
interface EvolutionProposal {
  type: "merchant" | "resource_source" | "crafting_recipe" | "trade_route" | "system";
  addressesGaps: string[];        // Resources this would provide
  proposal: {
    entityName: string;           // "Old Tom's Goods"
    entityType: string;           // "Merchant"
    location: string;             // "near Village Bakery"
    description: string;
    resources: string[];
  };
  status: "pending" | "sent_to_weaver" | "approved" | "created";
}
```

**Resource Category Mapping:**

| Resource | Category | Proposal Type | Entity Type |
|----------|----------|---------------|-------------|
| flour, bread | food_supplies | merchant | Bakery/Merchant |
| wheat, vegetables | food_supplies | resource_source | Farm |
| iron, coal | metalwork | resource_source | Mine |
| herbs, medicine | medicine | resource_source | Herb Garden |
| wood | materials | resource_source | Lumber Mill |
| leather, cloth | materials | merchant | Tanner/Textile Merchant |

#### Self-Evolving World Pipeline

```
Resource gaps accumulate (3+ occurrences)
         │
         ▼
┌────────────────────────────────────┐
│ analyzeGapsAndProposeEvolution()   │
│ Groups gaps by category:            │
│ - food_supplies: flour(5x), bread(2x)
│ - metalwork: iron(3x)              │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ Generate Evolution Proposal:        │
│ "Create a Merchant that sells flour,│
│  bread. Agents like Baker have been│
│  searching for these repeatedly."  │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ sendEvolutionProposalsToWeaver()   │
│ The Weaver reviews and approves    │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ executeEvolutionProposal()         │
│ - Creates new NPC/location          │
│ - Registers as resource source      │
│ - Resolves related gaps             │
└────────────────────────────────────┘
         │
         ▼
World has evolved: "The Trading Post" now provides flour
Agents are directed there instead of receiving free items
```

#### Integration with Cognition System

Failed interactions are captured in the cognition system:

```typescript
// In cognition-system.ts - when agent action fails
if (targetEid === undefined) {
  recordFailedInteraction(
    agentName,
    agentEid,
    roomName,
    "pickup",  // or "interact", "examine"
    targetName,
    originalContent
  );
}
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `recordFailedInteraction()` | Capture when agent can't find something |
| `evaluateCreationDecision()` | Decide if item should be created |
| `generateEntityForInteraction()` | AI-generate contextual entity spec |
| `recordResourceGap()` | Track resource that has no supply chain |
| `analyzeGapsAndProposeEvolution()` | Generate evolution proposals from gaps |
| `executeEvolutionProposal()` | Create the entity and register as source |
| `generateResourceGapReport()` | Summary of unresolved gaps for GodAI |

#### Constraint System

Prevents wish-granting with these constraints:

1. **Setup Phase Window** - First 5 minutes per room allows free creation
2. **Max Items Per Room** - 10 items during setup, then requires sources
3. **Luxury Item Blocking** - Gold, gems, magic items always blocked
4. **Duplicate Tracking** - Room inventory history prevents infinite materialization
5. **Source Awareness** - If a source exists, directs agent there instead

### 13.2.5 System Watcher Spirits ✅ NEW

System Watchers observe specific systems and report on their behavior. They provide **read-only monitoring** without intervention capabilities.

```typescript
interface WatchConfig {
  targetSystems?: string[];         // Systems to watch
  targetComponents?: string[];      // Component types to monitor
  watchPatterns?: string[];         // Patterns: "stagnation", "conflict", etc.
  alertThresholds?: Record<string, number>;  // When to alert
}

interface WatcherReport {
  watcherName: string;
  timestamp: number;
  systemObservations: SystemObservation[];
  overallHealth: "healthy" | "warning" | "critical";
  recommendations: string[];
  requiresIntervention: boolean;
}
```

**Anomaly Detection:**
- **Stagnation**: System hasn't run in expected time
- **Performance**: Execution time degradation
- **Error**: Recent errors in error log
- **Overload**: Processing too many entities

**Pattern Detection:**
- **Cyclic**: Repeating behavior patterns
- **Trending**: Entity counts increasing
- **Declining**: Entity counts decreasing
- **Emergent**: Unexpected new behaviors

### 13.2.6 The Steward Spirit (Room Populator) ✅ NEW

**The Steward** is an archangel of the locale domain responsible for **populating rooms with appropriate entities** and **ensuring description-entity coherence**.

#### The Core Problem

Without The Steward, room descriptions are evocative but not grounded:
```
Room: "Village Bakery"
Description: "A rustic bakery with flour sacks and a stone oven"

Agent perceives: "I should find flour here"
Reality: No flour entity exists in ECS
Result: Failed interaction → Crafter spawns flour reactively
```

#### The Solution: Grounded Creation

The Steward ensures rooms have actual entities matching their descriptions:
```
GodAI: "Create a bakery for Martha"
        │
        ▼
The Steward receives delegation
        │
        ▼
Generates entity manifest:
- flour_sack (resource, quantity: 50)
- stone_oven (station)
- bread_dough (craftable)
- yeast_jar (consumable)
- kneading_table (furniture)
        │
        ▼
Creates entities in room
        │
        ▼
Generates grounded description:
"A rustic bakery with flour sacks against the wall,
 a stone oven radiating heat, and a kneading table
 covered in flour dust."
```

#### Room Type Templates

The Steward uses templates as guidance for common room types:

```typescript
const ROOM_TEMPLATES = {
  bakery: {
    coreItems: ["flour_sack", "yeast_jar", "salt_box", "bread_basket"],
    stations: ["stone_oven", "kneading_table", "proofing_shelf"],
    ambience: { smells: ["fresh bread", "yeast"], sounds: ["fire crackling"] }
  },
  blacksmith: {
    coreItems: ["iron_ingot", "coal_pile", "hammer", "tongs"],
    stations: ["forge", "anvil", "bellows", "quench_barrel"],
    ambience: { smells: ["hot metal", "coal smoke"], sounds: ["hammer on metal"] }
  },
  // ... tavern, herbalist, library, etc.
};
```

#### Key Functions

| Function | Purpose |
|----------|---------|
| `requestRoomPopulation()` | Queue room for population by The Steward |
| `generateRoomPopulation()` | AI-generate entities for a room context |
| `sendSystemRequestsToWeaver()` | Request new systems/components if needed |
| `checkRoomNeeds()` | Check if room needs replenishment |
| `runStewardCycle()` | Main cycle - process pending room requests |

#### Integration with GodAI Tools

```typescript
// Preferred: Create room AND queue for population
tools.createAndPopulateRoom({
  name: "Martha's Bakery",
  roomType: "bakery",
  context: {
    worldTheme: "medieval fantasy",
    economyLevel: "modest",
    inhabitants: ["Martha the Baker"]
  }
});

// Room created with placeholder description
// The Steward generates entities on next tick
// Description is updated to match actual entities
```

#### Upward Requests to The Weaver

When populating rooms, The Steward may discover missing systems:
```typescript
// The Steward realizes the bakery needs a BakingSystem
{
  type: "system",
  name: "BakingSystem",
  reason: "The stone_oven station requires a system to handle baking actions"
}
```

These requests are sent to The Weaver for implementation.

### 13.3 Spirit Domains

- **guardian**: The Arbiter - validates consistency, routes reports
- **narrative**: Plot threads, dramatic tension, pacing, story beats
- **social**: Relationships, factions, conflicts, social dynamics
- **ecology**: Environment, weather, resources, space, entity materialization
  - **The Crafter** - Materializes entities, tracks resource gaps, proposes world evolution
- **economy**: Trade, markets, resource flows
- **watcher**: Watches over specific NPCs (via Agent Daemons)
- **locale**: Manages specific locations
  - **The Steward** - Populates rooms with entities, ensures description-entity coherence ✅ NEW

### 13.4 Spirit Messaging System ✅ ENHANCED

A complete messaging infrastructure for spirit-to-spirit communication.

#### Message Types

```typescript
interface SpiritMessage {
  id: string;
  type: MessageType;        // "report" | "directive" | "request" | "response" | "alert" | "broadcast" | "query" | "status"
  from: number;             // Sender spirit EID
  fromName: string;
  to: number | "godai" | "broadcast";
  toName?: string;
  domain?: string;          // For domain-scoped broadcasts
  subject: string;
  content: string;
  data?: any;               // Structured payload
  priority: MessagePriority;
  correlationId?: string;   // Links responses to requests
  requiresResponse?: boolean;
  responseDeadline?: number;
}
```

#### Message Flow

```
Reports: Spirit → Superior → GodAI (upward)
Directives: GodAI → Archangels → Angels → Daemons (downward)
Requests: Any spirit → Any spirit (with authority check)
Broadcasts: Spirit → All spirits in domain/hierarchy
```

#### Key Functions

| Function | Description |
|----------|-------------|
| `spiritReport()` | Report to superior (upward communication) |
| `spiritDirective()` | Send command to subordinate (downward) |
| `spiritQuery()` | Query another spirit (async with timeout) |
| `spiritRespond()` | Respond to a query/request |
| `spiritAlert()` | Broadcast urgent alert |
| `spiritSubscribe()` | Subscribe to events from other spirits |
| `spiritEmit()` | Emit event to subscribers |

#### Capability-Based Routing ✅ NEW

Spirits can register **capabilities** (services they provide), allowing intelligent message routing:

```typescript
type SpiritCapability =
  | "system_maintenance"    // Artificer
  | "system_design"         // Architect
  | "monitoring"            // Watcher
  | "agent_control"         // Manager
  | "narrative_control"     // Narrator
  | "social_dynamics"       // Sociologist
  | "environment"           // Ecologist
  | "visual";               // Renderer

// Register a capability
registerSpiritCapability(spirit, "system_maintenance", priority, description);

// Route message to capability handler (auto-finds best handler)
routeToCapability(fromSpirit, "system_maintenance", "Help needed", "System X broken");

// Request from capability with async response
const response = await requestFromCapability(fromSpirit, "narrative_control", "Status", "What's happening?");
```

**Routing Flow:**
```
Spirit needs help
       │
       ▼
routeToCapability("system_maintenance", ...)
       │
       ▼
Find best handler (highest priority)
       │
       ▼
Message delivered to: The Artificer
```

### 13.5 The Narrator Spirit

The first implemented spirit, **The Narrator**, is an archangel of the narrative domain:

**Responsibilities:**
- Track story structure (three-act, tension curves)
- Identify stagnation and pacing issues
- Track plot threads and character arcs
- Identify protagonists and antagonists
- Suggest and execute interventions

**Narrative State Tracking:**
```typescript
interface NarrativeState {
  currentAct: number;        // 1, 2, 3
  currentPhase: NarrativePhase;  // "exposition" | "inciting" | "rising" | ...
  tension: number;           // 0-1
  plotThreads: PlotThread[];
  protagonists: string[];
  antagonists: string[];
  characterArcs: CharacterArc[];
}
```

### 13.6 Spirit Cognition Loop

Each spirit follows this cycle:

```
1. OBSERVE ECS
   ├── Collect agent snapshots (location, mood, actions)
   ├── Collect room snapshots (occupants, ambience)
   └── Review recent actions and events

2. ANALYZE (LLM)
   ├── Interpret observations through domain lens
   ├── Identify significant patterns
   └── Decide on actions

3. REPORT
   ├── Send observations to superior
   └── Flag urgent issues

4. INTERVENE (if authorized)
   ├── Inject environmental stimuli
   ├── Send intuitions to agents
   └── Modify mood states
```

### 13.7 GodAI Spirit Tools

GodAI has these tools for managing spirits:

| Tool | Description |
|------|-------------|
| `getSpiritHierarchy` | View the current spirit hierarchy |
| `getSpiritReports` | Get pending reports from spirits |
| `sendDirectiveToSpirit` | Command a spirit to take action |
| `createSpirit` | Create a new spirit for a domain |
| `getSpiritObservations` | Get a spirit's recent observations |
| `getNarratorState` | Get the Narrator's narrative analysis |
| `tickSpirits` | Force an immediate spirit cognition cycle |

### 13.8 Domain-Specific Spirit Tools ✅ NEW

Instead of giving spirits access to all 80+ GodAI tools, each spirit type gets a **focused set of 5-15 tools** relevant to their domain. This:
- Reduces cognitive load on the LLM
- Prevents spirits from overstepping their authority
- Creates clear separation of concerns

#### Tool Sets by Spirit Type

| Spirit Type | Tool Set | Example Tools |
|-------------|----------|---------------|
| **Artificer** | System maintenance | `listSystems`, `inspectSystem`, `getSystemCode`, `repairSystem`, `enableSystem`, `disableSystem`, `clearSystemErrors`, `adjustSystemFrequency`, `reportToGodAI` |
| **Architect** | System creation | `listSystems`, `proposeSystem`, `bakeSystem`, `inspectSystemDesign`, `proposeComponent` |
| **Watcher** | Observation only | `queryAgents`, `getSystemHealth`, `inspectSystem`, `reportObservation` |
| **Manager** | Coordination | `queryAgents`, `modifyAgentMood`, `injectStimulus`, `sendDirective` |

#### Tool Set Creation

```typescript
import { getToolsForSpiritType, createArtificerTools, createManagerTools } from "./spirit-tools";

// Get tools based on spirit type
const tools = getToolsForSpiritType("artificer", world, systemRegistry);

// Or create specific tool sets directly
const artificerTools = createArtificerTools(world, systemRegistry);
const managerTools = createManagerTools(world, systemRegistry);
```

#### Example: Artificer Tools

```typescript
const artificerTools = {
  listSystems: tool({ /* List all systems and status */ }),
  inspectSystem: tool({ /* Detailed system info including code */ }),
  getSystemCode: tool({ /* Full source code for analysis */ }),
  repairSystem: tool({ /* AI-powered code fixing */ }),
  enableSystem: tool({ /* Activate a system */ }),
  disableSystem: tool({ /* Deactivate broken systems */ }),
  clearSystemErrors: tool({ /* Clear error log */ }),
  adjustSystemFrequency: tool({ /* Change tick rate */ }),
  reportToGodAI: tool({ /* Escalate issues */ }),
};
```

### 13.9 Spirit Factory System ✅ NEW

The Spirit Factory enables **dynamic spirit creation** at runtime, allowing GodAI and high-ranking spirits to spawn new spirits as needed.

#### Spirit Types

| Type | Role | Can Intervene | Intervention Types |
|------|------|---------------|-------------------|
| `watcher` | Observe and report | No | None |
| `manager` | Coordinate subordinates | Yes | `inject_stimulus`, `modify_mood`, `send_directive` |
| `architect` | Design new systems | Yes | `propose_system`, `propose_component`, `propose_entity` |
| `coordinator` | Meta-manage spirit groups | Yes | `send_directive`, `reassign_subordinate`, `create_subordinate` |
| `artificer` | Maintain systems | Yes | `inspect_system`, `repair_system`, `disable_system`, `enable_system` |

#### Spirit Creation

```typescript
const watcher = createDynamicSpirit(registry, {
  name: "EconomyWatcher",
  type: "watcher",
  domain: "economy",
  rank: "angel",
  superiorEid: economistSpirit.eid,
  watchConfig: {
    targetSystems: ["MarketPricing", "ResourceDistribution"],
    watchPatterns: ["stagnation", "imbalance"],
  },
  observationInterval: 30000,
});
```

#### Proposal System

Architect spirits can propose new systems, components, or entities:

```typescript
const proposal = submitProposal(
  architectEid,
  "system",
  "WeatherCycles",
  "A system that creates seasonal weather patterns",
  { frequency: 60000, logic: "..." },
  "Players asked for more environmental variety"
);

// Proposals are reviewed and can be approved/rejected
approveProposal(proposal.id, godAgentEid);
rejectProposal(proposal.id, "Too complex for current simulation");
```

### 13.10 Integration with Simulation

```typescript
// Initialize spirit system with simulation
const spiritState = initializeSpiritSystem(world, {
  godAgentEid: godAgent.eid,
  autoCreateNarrator: true,  // Creates The Narrator automatically
});

// Start spirit observation cycles
startSpiritSystem();

// In main loop, tick spirits alongside simulation
await tickSpiritSystem(world, entityRegistry);
```

### 13.11 Story Arc Templates

The Narrator can follow pre-defined story templates that guide narrative structure. Templates define:

**Available Templates:**
| Template | Genre | Description |
|----------|-------|-------------|
| `classic_three_act` | adventure | Setup → Confrontation → Resolution |
| `mystery` | mystery | Crime → Investigation → Solution |
| `slice_of_life` | slice_of_life | Low-tension character-focused narrative |
| `conflict` | conflict | Opposition → Escalation → Confrontation |

**Template Components:**
- **Story Beats**: Key moments (inciting incident, midpoint, climax, etc.)
- **Tension Curves**: Target tension levels for each narrative phase
- **Character Roles**: Required and optional character types (protagonist, antagonist, mentor)
- **Pacing Guidelines**: When and how to intervene if story stagnates
- **Intervention Suggestions**: Context-specific nudges to keep the story moving

**GodAI Story Template Tools:**
| Tool | Description |
|------|-------------|
| `listStoryTemplates` | View available narrative templates |
| `setStoryTemplate` | Activate a template for the simulation |
| `getStoryTemplateStatus` | Check alignment with template and get recommendations |
| `markStoryBeat` | Mark a story beat as completed |
| `getTemplateInterventions` | Get suggested interventions based on template |
| `suggestCharacterRoles` | Get role assignment suggestions for agents |

**Usage:**
```typescript
// GodAI activates a template
setStoryTemplate({ templateId: "mystery" });

// Check progress and get recommendations
const status = getStoryTemplateStatus();
// Returns: { alignment: 0.85, nextBeat: "first_clue", recommendations: [...] }

// Mark story beats as they occur
markStoryBeat({ beatId: "discovery" });
markStoryBeat({ beatId: "detective_involved" });

// Get intervention suggestions when story stagnates
const interventions = getTemplateInterventions({ includeAllSources: true });
```

---

## 14. Dynamic Spirit Creation ✅ IMPLEMENTED

This section describes how GodAI dynamically creates new spirits to manage emerging complexity.

### 14.1 Vision: Self-Expanding Hierarchy

As the simulation grows in complexity, GodAI should be able to:

1. **Create System Watchers**: Spirits that observe specific baked systems
   - WeatherSpirit watching a weather system
   - PhysicsSpirit monitoring physics simulation
   - EconomySpirit tracking market dynamics

2. **Create Higher Angels**: Spirits that can themselves architect new subsystems
   - CraftingArchitect that designs and proposes crafting systems
   - QuestDesigner that creates quest structures and objectives
   - DungeonMaster that builds challenge areas

3. **Create Domain Coordinators**: Meta-spirits that manage groups of spirits
   - EnvironmentCoordinator managing Weather + Physics + Ecology spirits
   - SocialCoordinator managing Faction + Relationship + Politics spirits

### 14.2 Spirit Factory Design

```typescript
// GodAI tool for dynamic spirit creation
interface CreateSpiritParams {
  name: string;
  type: "watcher" | "manager" | "architect" | "coordinator";
  domain: SpiritDomain;
  rank: "archangel" | "angel" | "daemon";
  superior?: number;  // Entity ID of superior spirit

  // For watchers - what to observe
  watchConfig?: {
    targetSystems?: string[];      // System names to watch
    targetEntities?: number[];     // Specific entities
    targetComponents?: string[];   // Component types
    watchInterval?: number;        // How often to observe
  };

  // For architects - what they can create
  architectConfig?: {
    canProposeSystems?: boolean;   // Can suggest new systems
    canProposeEntities?: boolean;  // Can suggest new entities
    canProposeRules?: boolean;     // Can suggest new rules
    proposalApproval?: "auto" | "godai" | "user";  // Who approves
  };

  // For coordinators - who they manage
  coordinatorConfig?: {
    subordinates?: number[];       // Spirit entity IDs
    canCreateSubordinates?: boolean;
  };
}
```

### 14.3 Example: Weather System Watcher

```
GodAI creates a weather system via bakeNewSystem()
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ GodAI: "Create a spirit to watch the weather system"       │
│                                                             │
│ createSpirit({                                              │
│   name: "Zephyros",                                         │
│   type: "watcher",                                          │
│   domain: "ecology",                                        │
│   rank: "angel",                                            │
│   superior: arbiterEid,                                     │
│   watchConfig: {                                            │
│     targetSystems: ["WeatherSystem"],                       │
│     targetComponents: ["Weather", "Temperature"],           │
│     watchInterval: 30000,  // Every 30 seconds              │
│   }                                                         │
│ });                                                         │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Zephyros (Weather Watcher) observes:                        │
│ - Weather patterns becoming stale                          │
│ - Temperature not affecting NPCs                           │
│ - Missing seasonal transitions                             │
│                                                             │
│ Reports to Arbiter:                                         │
│ "Weather system functioning but lacks agent interaction.   │
│  Recommend: Add temperature effects on agent mood."        │
└─────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ Arbiter routes to GodAI:                                   │
│ "Mechanical enhancement needed: Weather → Agent effects"   │
│                                                             │
│ GodAI decides to bake TemperatureEffectSystem              │
└─────────────────────────────────────────────────────────────┘
```

### 14.4 Example: Quest Architect Angel

```typescript
// GodAI creates a quest architect spirit
createSpirit({
  name: "The Questmaster",
  type: "architect",
  domain: "narrative",
  rank: "angel",
  superior: narratorEid,  // Reports to The Narrator
  architectConfig: {
    canProposeSystems: true,
    canProposeEntities: true,
    canProposeRules: true,
    proposalApproval: "godai",  // GodAI must approve proposals
  }
});
```

**Questmaster's Cognition Loop:**
```
1. OBSERVE: Current narrative state, agent goals, world state
2. ANALYZE: What quests would enhance the story?
3. PROPOSE: Submit quest design to GodAI
   - "Propose: Create 'The Missing Merchant' quest"
   - "Requires: QuestTracker component, RewardSystem"
   - "Entities: Quest giver NPC, clue objects, reward chest"
4. AWAIT: GodAI approval
5. EXECUTE: If approved, create quest infrastructure
```

### 14.5 Hierarchical Self-Organization

The ultimate vision is a self-organizing hierarchy:

```
                    ┌───────────────┐
                    │    GODAI      │
                    │ (Supreme)     │
                    └───────┬───────┘
                            │ creates & receives proposals
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼──────┐    ┌───────▼──────┐    ┌───────▼──────┐
│  ARBITER     │    │  NARRATOR    │    │ ENVIRONMENT  │
│ (Consistency)│    │ (Narrative)  │    │ COORDINATOR  │
└───────┬──────┘    └───────┬──────┘    └───────┬──────┘
        │                   │                   │
        │           ┌───────┴──────┐    ┌───────┴──────┐
        │           │              │    │              │
        │    ┌──────▼─────┐ ┌──────▼─────┐ ┌──────▼─────┐
        │    │ Quest      │ │ Scene      │ │ Weather    │
        │    │ Architect  │ │ Director   │ │ Watcher    │
        │    └────────────┘ └────────────┘ └──────┬─────┘
        │                                         │
┌───────┴───────────────────────────┐      ┌──────▼─────┐
│     AGENT DAEMONS                 │      │ Seasons    │
│ (Alice, Bob, Charlie, Diana...)  │      │ Sub-Spirit │
└───────────────────────────────────┘      └────────────┘
```

### 14.6 Benefits

1. **Scalability**: Complexity is managed by delegation, not centralization
2. **Domain Expertise**: Spirits specialize in their domains
3. **Emergent Organization**: Hierarchy grows organically based on needs
4. **Reduced GodAI Load**: Lower spirits handle routine observation/steering
5. **Richer World**: More eyes watching = more opportunities discovered

### 14.7 Implementation Status

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | `createDynamicSpirit` tool (watcher/architect) | ✅ COMPLETE |
| 2 | System Watcher cognition loop | ✅ COMPLETE |
| 3 | Architect Spirit with proposals | ✅ COMPLETE |
| 4 | Proposal/approval workflow | ✅ COMPLETE |
| 5 | Non-blocking system baking | ✅ COMPLETE |
| 6 | `createCoordinatorSpirit` tool | Planned |
| 7 | Self-organization rules | Planned |

**Implemented in:**
- `src/spirits/spirit-factory.ts` - Dynamic spirit creation
- `src/spirits/system-watcher.ts` - System monitoring
- `src/spirits/architect-spirit.ts` - System proposals and baking
- `src/spirits/world-crafter-spirit.ts` - Entity materialization and world evolution
- `src/spirits/steward-spirit.ts` - Room population and grounded entity creation ✅ NEW
- `src/runtime/async-task-queue.ts` - Non-blocking AI operations

---

## 15. Dynamic Introspection System ✅ NEW

The introspection system provides real-time awareness of all actions, components, and systems.

### 15.1 Registries

```typescript
// Action Registry - ALL actions available in the simulation
const ACTION_REGISTRY: Record<string, ActionMetadata> = {
  "speak": { domain: "social", canFail: false },
  "move": { domain: "navigation", requiresTarget: true },
  "attack": { domain: "combat", canFail: true, dangerous: true },
  "craft": { domain: "production", requiresTarget: true, producesItem: true },
  // ... 15 actions total, dynamically populated
};

// Component Registry - ALL components in the simulation
const COMPONENT_REGISTRY: ComponentMetadata[] = [
  { name: "Agent", category: "identity" },
  { name: "Mind", category: "cognition" },
  { name: "Health", category: "stats" },
  { name: "Inventory", category: "equipment" },
  // ... 30 components total, dynamically populated
];
```

### 15.2 Rolling Event Buffer

Tracks recent events for pattern detection:

```typescript
interface RollingEventBuffer {
  events: RecordedEvent[];
  maxSize: number;
  addEvent(type: string, data: any, source: string): void;
  detectPatterns(): DetectedPattern[];
}

// Detected patterns inform spirit decisions
interface DetectedPattern {
  type: string;  // "repetition", "conflict", "stagnation", "emergence"
  description: string;
  frequency: number;
  relevantEvents: RecordedEvent[];
}
```

### 15.3 Context Generation

Spirits can request full system context:

```typescript
function getIntrospectionContext(world: World): IntrospectionContext {
  return {
    entities: getEntitySnapshot(world),
    components: COMPONENT_REGISTRY,
    actions: ACTION_REGISTRY,
    systems: getActiveSystems(),
    recentEvents: getRecentEvents(100),
    detectedPatterns: detectPatterns(),
  };
}
```

---

## 16. Dual-Loop Runtime Architecture ✅ IMPLEMENTED

The simulation runs two separate loops to keep deterministic ECS systems running fast while AI operations process in the background.

### 16.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     DUAL-LOOP RUNTIME                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 FAST ECS LOOP (20Hz)                      │  │
│  │                                                           │  │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   │  │
│  │  │ Needs   │   │ Health  │   │ Arousal │   │ Status  │   │  │
│  │  │ Decay   │   │ Regen   │   │ Decay   │   │ Logger  │   │  │
│  │  └─────────┘   └─────────┘   └─────────┘   └─────────┘   │  │
│  │                                                           │  │
│  │  • Runs every 50ms (configurable)                        │  │
│  │  • Deterministic systems only                            │  │
│  │  • No LLM calls, no network                              │  │
│  │  • Target: <5ms tick time                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                 SLOW AI LOOP (Background)                 │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │  │
│  │  │   Watcher   │  │  Architect  │  │   GodAI     │       │  │
│  │  │  Cognition  │  │  Cognition  │  │  Approval   │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────┐         │  │
│  │  │         SYSTEM BAKING (QUEUED)              │         │  │
│  │  │  • Design phase (Pro model)                 │         │  │
│  │  │  • Code generation (Flash model)            │         │  │
│  │  │  • Review & fix loops                       │         │  │
│  │  │  • Registration on completion               │         │  │
│  │  └─────────────────────────────────────────────┘         │  │
│  │                                                           │  │
│  │  • Runs in async task queue                              │  │
│  │  • Max 3 concurrent AI operations                        │  │
│  │  • Never blocks fast loop                                │  │
│  │  • Priority: critical > high > normal > low              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 Key Insight: Why Two Loops?

**Problem:** AI operations (LLM calls, system baking) take 1-30 seconds. Running them synchronously blocks the entire simulation.

**Solution:** Separate concerns:
1. **Fast Loop** - Deterministic systems run at high frequency (20Hz default)
2. **Slow Loop** - AI operations run in background, results merged when ready

### 16.3 Async Task Queue

Background AI operations are managed by a priority-based task queue:

```typescript
interface TaskPriority {
  critical: 0;  // Urgent interventions
  high: 1;      // Approvals, responses
  normal: 2;    // Regular cognition
  low: 3;       // Background analysis
}

// Queue a task (non-blocking)
queueTask("SystemBaking:MarketExchange", async () => {
  return await bakeSystem(world, systemRegistry, spec);
}, {
  priority: "normal",
  onComplete: (result) => {
    console.log(`Baked: ${result.system.name}`);
  },
});
```

**Queue Features:**
- Priority-based execution (critical first)
- Configurable max concurrency (default: 3)
- Execution time tracking
- Failure handling and retry support

### 16.4 Fast System Registration

```typescript
// Register a fast (deterministic) system
registerFastSystem(simulation, {
  name: "NeedsDecay",
  frequency: 2,  // Run every 2 ticks
  execute: (world, delta, tick) => {
    const agents = query(world, [Agent, Needs]);
    for (const eid of agents) {
      Needs.hunger[eid] += 0.01;
      Needs.energy[eid] -= 0.005;
    }
  },
});
```

### 16.5 AI Operation Registration

```typescript
// Register an AI operation (runs in background)
registerAIOperation(simulation, {
  name: "WatcherCognition",
  interval: 60,  // Every 60 ticks (3 seconds at 20Hz)
  lastRun: 0,
  execute: async () => {
    // This runs in background, doesn't block ECS
    const report = await runWatcherCognition(world, ...);
    return report;
  },
});
```

### 16.6 Non-Blocking System Baking

System baking now happens entirely in the background:

```typescript
// Queue baking for all approved proposals (non-blocking)
queueAllApprovedProposals(world, systemRegistry, (completed, total, name) => {
  console.log(`Baking progress: ${completed}/${total} (${name})`);
});

// Or queue a single system
queueSystemBaking(world, systemRegistry, spec, (success, name) => {
  if (success) console.log(`✓ Baked and registered: ${name}`);
});
```

**Baking Pipeline:**
1. **Design** (gemini-3-pro-preview) - Architecture, documentation
2. **Build** (gemini-3-flash-preview) - Code generation
3. **Review** (gemini-3-flash-preview) - Error checking
4. **Fix** (gemini-3-flash-preview) - Repair if needed (max 3 attempts)
5. **Register** - Add to system registry on success

### 16.7 Performance Results

From integration test (`08-dual-loop-integration.ts`):

```
📊 SIMULATION STATS:
  Total ticks: 1179
  Runtime: 60.0s
  Avg tick time: 0.02ms
  Slow ticks: 0
  Target tick time: 50ms (20Hz)

🤖 AI TASK QUEUE:
  Pending: 0
  Running: 0
  Completed: 15
  Failed: 0
  Avg execution time: 4200ms
```

**Key Metrics:**
- Zero slow ticks despite heavy AI processing
- AI operations completed without blocking
- Full propose → approve → bake → register cycle working
- Baked systems (e.g., MarketExchangeSystem) successfully running

### 16.8 Configuration

```typescript
const simulation = createSimulation(world, systemRegistry, spiritRegistry, {
  ecsTickRate: 20,            // 20 Hz - very fast
  ecsMaxTickTime: 50,         // Warn if tick exceeds 50ms
  aiProcessInterval: 500,     // Check AI tasks every 500ms
  watcherTickInterval: 60,    // Watcher cognition every 3 seconds
  architectTickInterval: 100, // Architect cognition every 5 seconds
  approvalTickInterval: 120,  // GodAI approval every 6 seconds
  logTickStats: true,         // Log performance stats
  logInterval: 40,            // Log every 2 seconds
});
```

---

## Appendix: How the Two Architecture Docs Relate

| ARCHITECTURE.md | WORLDBUILDING_ARCHITECTURE.md |
|-----------------|-------------------------------|
| How agents think | How GodAI builds worlds |
| Mind, Stimulus, CognitiveEvent | Components, Systems, Rules |
| Cognitive loop | Simulation tick loop |
| Individual agent focus | World-building focus |
| Internal cognition | External world structure |

Both are essential: GodAI builds the world (this doc), agents think within it (ARCHITECTURE.md).
