# Psyche-BT: Continuous Learning Agent Architecture

## Design Document v1.0

A system that makes AI agents continuously smarter about each person they serve, while running on the cheapest, fastest model available. The core insight: **expensive models think once, cheap models execute forever.** Learned patterns compile from slow reasoning into fast deterministic behavior trees, creating an agent that improves with every interaction and costs almost nothing to run.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [The Core Insight: Game AI Patterns for Agent Systems](#2-the-core-insight)
3. [Architecture Overview](#3-architecture-overview)
4. [The Behavior Tree System](#4-the-behavior-tree-system)
5. [The ECS Cognition Model](#5-the-ecs-cognition-model)
6. [The Three-Tier Model Hierarchy](#6-the-three-tier-model-hierarchy)
7. [The Continuous Learning Loop](#7-the-continuous-learning-loop)
8. [Tool Use and Task Execution](#8-tool-use-and-task-execution)
9. [Integration Patterns](#9-integration-patterns)
10. [Gotchas and Solutions](#10-gotchas-and-solutions)
11. [Implementation Plan](#11-implementation-plan)

---

## 1. The Problem

Modern AI agents are expensive, slow, and memoryless. Every interaction requires the full LLM to reason from scratch — reassemble context, re-derive the user's personality, re-evaluate what to do. A 10-minute conversation costs dollars. An always-on companion costs a fortune.

The cheapest fast models (Gemini 3.1 Flash Lite at $0.25/1M input tokens) are capable enough for execution but too small for deep reasoning about people. The expensive models (Pro at $10/1M) understand people brilliantly but cost 40x more and are too slow for real-time interaction.

**The question:** Can we get Pro-quality personalization running at Flash Lite cost?

**The answer:** Yes — if we separate learning from execution, and compile learned patterns into a form that tiny models can execute deterministically.

---

## 2. The Core Insight: Game AI Patterns for Agent Systems

This architecture borrows from decades of game AI research, specifically the pattern used in every major game engine: **Behavior Trees (BTs).**

### Why Game AI?

Games solved this exact problem 20 years ago. An NPC in a game needs to:
- Respond to complex, dynamic situations in real-time
- Exhibit personality-consistent behavior across thousands of interactions
- Run on minimal compute (often <1ms per tick)
- Learn and adapt to player behavior over time
- Handle novel situations gracefully (fall back to general behavior)

Game NPCs don't run neural networks every frame. They run behavior trees — fast, deterministic decision structures that encode learned patterns. The behavior trees are designed by humans (or in our case, compiled by a smarter AI), and the runtime just evaluates conditions and selects actions.

### The System 2 → System 1 Pattern

In cognitive science:
- **System 2** (slow, deliberate, expensive): Analytical reasoning. "Let me think carefully about what this person needs."
- **System 1** (fast, automatic, cheap): Pattern recognition. "I've seen this before — do the thing that worked last time."

Humans learn by using System 2 for novel situations, then compiling successful patterns into System 1 for future use. You don't re-derive how to drive a car every morning — you compiled that into automatic behavior.

Our architecture does the same thing with LLMs:
- **System 2 = Large model** (Pro/Flash): Reasons about the person, makes decisions in novel situations
- **System 1 = Behavior tree + Flash Lite**: Executes compiled patterns instantly, cheaply
- **Compilation = BT compiler**: When System 2 succeeds, the pattern becomes a permanent BT branch

Over time, System 1 handles more and more. System 2 is called less and less. The agent gets faster, cheaper, AND better — because it's building on proven patterns rather than re-reasoning each time.

### Proven Results

We built and tested this pattern in a simulation engine (ArgOS) with autonomous NPCs:
- **LLM call reduction: 84% → 33%** over 200 interaction ticks
- **Behavior tree growth: 5 → 114 nodes** per agent from compiled experience
- **52 unique behavior patterns** compiled from LLM decisions into deterministic BT branches
- **Zero quality loss** — agents became MORE consistent and personality-coherent as trees grew
- **Offline operation**: Fully-trained agents ran with ZERO LLM calls using only their behavior tree

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERACTION                       │
│              (voice, text, SMS, API)                      │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              FLASH LITE RUNTIME (always on)               │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Behavior   │  │   Context    │  │   Response    │  │
│  │    Tree     │→ │  Assembly    │→ │  Generation   │  │
│  │  Evaluator  │  │  (from ECS)  │  │ (Flash Lite)  │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
│         │                                     │          │
│         │ llm_escalate                        │          │
│         ▼                                     ▼          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              ECS PERSON MODEL                    │    │
│  │  Components: Hypotheses, Style, Memory,          │    │
│  │  Intentions, Calibration, Predictions, Skills    │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │ escalation (novel situation)
┌──────────────────────▼──────────────────────────────────┐
│              FLASH REASONING (on demand)                  │
│                                                          │
│  Full person model in context. Reasons about what to     │
│  do. Produces action + reasoning. On success, triggers:  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │           BT COMPILER (pattern capture)          │    │
│  │  Captures: conditions (what triggered this)      │    │
│  │  + action (what worked) → new BT branch          │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │ periodic (every N turns)
┌──────────────────────▼──────────────────────────────────┐
│              PRO TEACHER (periodic)                       │
│                                                          │
│  Deep analysis. Hypothesis refinement. Policy            │
│  recompilation. Soul evolution. Skill composition.       │
│  Runs every ~10 turns or on schedule.                    │
│                                                          │
│  Outputs: refined person model, recompiled BT,           │
│  composed skills, calibration updates                    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow for a Single Interaction

```
1. User says: "Hey, I'm stressed about the gallery show"
2. BT evaluator checks compiled patterns:
   - condition: person_topic("gallery_show") AND person_state("stressed")
   - match found → compiled response template:
     "ask about specific concern, offer to help with {active_intention}"
3. Flash Lite fills the template using ECS components:
   - memory_recall("gallery_show") → "curation deadline is Friday"
   - active_intention → "help with artist statement"
   - style_mirror → casual, supportive
4. Flash Lite generates: "The curation deadline's Friday, right?
   How's the artist statement coming — want me to take another pass?"
5. No escalation needed. Cost: ~$0.0001. Latency: ~200ms.

Contrast with without BT:
1. User says same thing
2. Full model must: load 20k chars of memory, reason about who this
   person is, what the gallery show means to them, what help is available,
   what tone to use, what to say
3. Cost: ~$0.01-0.05. Latency: 2-5 seconds.
```

---

## 4. The Behavior Tree System

### What is a Behavior Tree?

A behavior tree is a hierarchical decision structure. It's a tree of nodes that are evaluated top-to-bottom, left-to-right. Each node either succeeds, fails, or returns "running" (still in progress). The tree produces an action — what the agent should do.

### Node Types

```typescript
type BehaviorNode =
  // CONTROL FLOW
  | { type: "selector"; children: BehaviorNode[] }
    // Try children in order. Return first success. (OR logic)

  | { type: "sequence"; children: BehaviorNode[] }
    // Run children in order. All must succeed. (AND logic)

  | { type: "weighted_random"; choices: Array<{ weight: number; child: BehaviorNode }> }
    // Randomly select based on weights. Provides variety.

  // CONDITIONS (check ECS state)
  | { type: "condition"; op: ConditionOp }
    // Check a condition against the person model.

  // ACTIONS (what to do)
  | { type: "action"; action: AgentAction }
    // Execute a specific response pattern.

  | { type: "skill"; name: string }
    // Execute a named, reusable sub-tree (composed skills).

  | { type: "llm_escalate" }
    // This situation isn't covered — escalate to larger model.

  | { type: "template_response"; template: string; variables: string[] }
    // Fill a response template from ECS components.
```

### Condition Types

These check the person model (ECS components) deterministically:

```typescript
type ConditionOp =
  // PERSON STATE
  | { type: "hypothesis_above"; domain: string; confidence: number }
  | { type: "hypothesis_below"; domain: string; confidence: number }
  | { type: "has_hypothesis"; includes: string }
  | { type: "person_topic"; topic: string }      // Recent messages mention this
  | { type: "person_state"; state: string }       // Detected emotional state
  | { type: "style_is"; style: string }           // Communication style match

  // MEMORY
  | { type: "memory_contains"; query: string }    // Memory graph has relevant entry
  | { type: "entity_known"; name: string }        // Entity registry contains this
  | { type: "last_n_messages_include"; n: number; includes: string }

  // INTENTIONS
  | { type: "intention_active"; domain: string }  // Active intention in this domain
  | { type: "intention_blocked" }                 // An intention needs user input

  // TEMPORAL
  | { type: "time_is"; period: string }           // morning/afternoon/evening/night
  | { type: "days_since_last_contact"; min: number }
  | { type: "session_length_above"; minutes: number }

  // PREDICTIONS
  | { type: "prediction_pending"; domain: string }
  | { type: "prediction_accuracy_above"; domain: string; threshold: number }

  // CALIBRATION
  | { type: "calibration_score_above"; domain: string; threshold: number }

  // META
  | { type: "always" }
  | { type: "chance"; p: number }                 // Probability gate
  | { type: "conversation_depth_above"; turns: number }
```

### Example: A Compiled Behavior Tree

After 20 conversations with a user named Alex, the BT might look like:

```yaml
selector:
  # HIGH PRIORITY: Blocked intention needs answer
  - sequence:
      - condition: intention_blocked
      - action: surface_agent_question  # "Hey, quick question about the deck..."

  # Stress about work → specific, actionable support
  - sequence:
      - condition: person_state("stressed")
      - condition: hypothesis_above("work_pressure", 0.7)
      - selector:
          - sequence:
              - condition: intention_active("presentation_help")
              - template_response:
                  template: "How's {project} going? Want me to {active_step}?"
                  variables: [active_project, current_intention_step]
          - template_response:
              template: "Sounds like a lot. What's the most pressing thing?"

  # Morning check-in (compiled from pattern: Alex always recaps in AM)
  - sequence:
      - condition: time_is("morning")
      - condition: days_since_last_contact(min: 0.5)
      - condition: hypothesis_above("morning_recap_pattern", 0.6)
      - template_response:
          template: "Morning. What's on deck today?"

  # Gallery show topic (compiled from 3 successful interactions)
  - sequence:
      - condition: person_topic("gallery")
      - selector:
          - sequence:
              - condition: memory_contains("curation_deadline")
              - template_response:
                  template: "How's the curation going? {deadline_context}"
                  variables: [gallery_deadline_memory]
          - action: ask_about_gallery_details

  # Social warmth (compiled: Alex responds well to humor after day 5)
  - sequence:
      - condition: conversation_depth_above(5)
      - condition: hypothesis_above("humor_receptive", 0.6)
      - condition: chance(0.3)
      - skill: light_humor_opener

  # FALLBACK: Escalate to larger model for novel situations
  - llm_escalate
```

This tree handles most routine interactions deterministically. Flash Lite only needs to fill templates and check conditions — no deep reasoning. The `llm_escalate` at the bottom catches genuinely novel situations.

### Gotchas We Solved (from production testing)

1. **Overfitting to specific phrases.** Early BT compilation captured too-specific conditions ("when user says 'stressed' AND in room 'Forge'"). Fix: compile conditions from CONTEXT (emotional state, topic, time) not from exact words or locations.

2. **Repetitive responses.** Compiled BT branches fire the same response every time the condition matches. Fix: `weighted_random` nodes with multiple response variants per pattern. Also, conversation history check to avoid repeating the last N responses.

3. **Stale patterns.** A pattern that worked 2 months ago may not work now — the person has changed. Fix: **pattern decay.** Each BT branch has a `lastUsed` timestamp and a `successRate`. Branches that haven't been used in N days get `llm_escalate` wrapped around them — the larger model re-evaluates whether the pattern still applies.

4. **Template hallucination.** Flash Lite filling templates sometimes invents content not in the ECS. Fix: templates reference SPECIFIC component paths (`{memory.gallery_deadline}`) not open-ended variables. The template filler is a deterministic lookup, not an LLM call.

5. **Escalation storms.** In early conversations, the BT is nearly empty — everything escalates. Fix: **bootstrap trees** with generic patterns ("greet warmly", "ask follow-up questions", "acknowledge emotions") that work for anyone. These get refined, not replaced.

6. **Conflicting branches.** Two compiled patterns both match, with contradictory actions. Fix: BT evaluation is ordered — higher-priority branches are earlier in the tree. The compiler inserts new branches at the appropriate priority level based on the situation type (urgent > emotional > routine > social).

7. **Agents ignoring direct speech.** When a user directly addresses the agent but the BT handles it with a canned response, the interaction feels robotic. Fix: **speech override** — when the user's message is a direct question or emotional expression, bypass the BT and escalate to the reasoning model. Compiled patterns handle ambient/routine interaction; direct engagement gets full attention.

8. **Movement target poisoning (specific to multi-room/multi-context systems).** An earlier system had observe/interact actions setting persistent state that blocked future navigation. Fix: state set by BT actions must be scoped and cleared. No permanent global state from transient actions.

---

## 5. The ECS Cognition Model

### Why ECS?

The Entity-Component-System pattern gives us:
- **Composability**: Add new aspects of understanding without changing existing code
- **Queryability**: BT conditions check components directly — O(1) lookups
- **Serializability**: The entire person model saves/loads as JSON
- **Extensibility**: New component types can be added at runtime (the system can learn new categories of understanding)

### The Person Model as ECS

```
Entity: Person (one per user)
├── Component: Hypotheses
│     Active hypotheses about who they are.
│     Fields: domain, content, confidence (0-1), evidence[], lastUpdated
│     Example: { domain: "work_style", content: "prefers direct communication",
│                confidence: 0.78, evidence: ["msg_42", "msg_67"] }
│
├── Component: Style
│     Communication preferences learned over time.
│     Fields: formality (0-1), humor (0-1), messageLength, lexicon[],
│             responseSpeed, emojiFrequency, topicTransitionStyle
│
├── Component: Memory
│     Structured memories with importance scoring.
│     Fields: entries[{ type, content, importance, connections[], timestamp }]
│     Types: fact, event, plan, reference, observation, insight, summary
│
├── Component: Intentions
│     Active intentions (things the agent is doing FOR this person).
│     Fields: intentions[{ id, claim, scope, status, plan, deliverables }]
│
├── Component: Predictions
│     Active predictions about the person.
│     Fields: predictions[{ content, domain, confidence, deadline, outcome }]
│
├── Component: Calibration
│     Per-domain accuracy tracking.
│     Fields: domains[{ name, accuracy, totalPredictions, recentTrend }]
│
├── Component: Entities
│     People, places, projects the person has mentioned.
│     Fields: entities[{ name, type, mentionCount, lastMentioned, context }]
│
├── Component: ConversationState
│     Current conversation context.
│     Fields: recentMessages[], emotionalState, currentTopics[],
│             sessionStart, turnsThisSession, lastSpeaker
│
├── Component: BehaviorPolicy
│     The compiled behavior tree.
│     Fields: tree (JSON), version, compiledBranches, totalNodes,
│             lastCompiled, successRate
│
├── Component: Skills
│     Named, reusable behavior sub-trees.
│     Fields: skills[{ name, tree, origin, successRate, uses }]
│
├── Component: SoulOverlay
│     How the agent has adapted to THIS person.
│     Fields: overlay (markdown), innerLife[], reflectionCount
│
└── Component: Schedule
      Temporal awareness for this person.
      Fields: knownSchedule[], timezone, preferredContactTimes[],
              lastContact, contactFrequency
```

### ECS Operations

```typescript
// Query: Does this person prefer direct communication?
getHypothesisConfidence(personId, "direct_communication") → 0.78

// Query: What do we know about their gallery show?
searchMemory(personId, "gallery show") → [{ content: "Opening Friday...", importance: 0.9 }]

// Query: Is there an active intention we can reference?
getActiveIntentions(personId) → [{ claim: "Help with board deck", status: "in_progress" }]

// Update: Record that humor landed well
updateCalibration(personId, "humor", { success: true })

// Update: New hypothesis from observation
addHypothesis(personId, { domain: "stress_pattern", content: "Gets anxious before deadlines", confidence: 0.5 })
```

All of these are O(1) lookups — fast enough for BT condition evaluation with zero LLM overhead.

---

## 6. The Three-Tier Model Hierarchy

### Tier 1: Flash Lite (Runtime — every turn)

**Cost:** $0.25/1M input tokens, $1.50/1M output
**Latency:** ~100-200ms
**Context:** Small (8-32k effective)
**Role:** Execute compiled behavior. Fill templates. Generate responses from assembled context.

Flash Lite receives:
- The BT evaluation result (which pattern matched, what template to fill)
- Pre-assembled context from ECS (relevant memories, style guide, active topics)
- The user's message

It does NOT receive:
- The full person model (too large, unnecessary)
- Raw hypothesis data (already evaluated by BT conditions)
- Historical conversation logs (summarized into context)

**What Flash Lite is good at:**
- Following structured templates with variable substitution
- Generating natural-sounding responses from clear context
- Maintaining conversational tone when given style guidance
- Quick factual lookups from provided context

**What Flash Lite is NOT good at:**
- Deep personality analysis
- Novel situation reasoning
- Multi-step planning
- Emotional nuance in unfamiliar contexts

### Tier 2: Flash (Reasoning — on escalation)

**Cost:** $2.50/1M input tokens
**Latency:** ~1-3s
**Context:** 128k+
**Role:** Handle novel situations. Make decisions the BT can't. Feed the compiler.

Receives full person model in context. Reasons about what to do. Returns:
- The action to take (response, tool call, intention creation)
- Inner reasoning (captured by the BT compiler)
- Confidence level

**When Flash is called:**
- BT evaluation hits `llm_escalate` (no compiled pattern matches)
- User asks a direct question the BT can't template
- Emotional state detection triggers nuanced response
- New topic / new entity introduced

### Tier 3: Pro (Teacher — periodic)

**Cost:** $10/1M input tokens
**Latency:** ~5-30s
**Context:** 1M+
**Role:** Deep analysis. Hypothesis refinement. Policy recompilation. Metacognition.

Runs every ~10 turns (configurable) or on schedule. Sees EVERYTHING:
- Full conversation history
- All hypotheses with evidence
- Calibration data
- Current BT with usage stats
- Failed escalations (what the BT couldn't handle)
- Prediction outcomes

**Outputs:**
1. **Refined hypotheses** — new insights, revised confidences
2. **Recompiled BT** — new branches from patterns it notices, pruned stale branches
3. **Composed skills** — multiple successful patterns combined into higher-order skills
4. **Calibration updates** — what's working, what's not, where to focus
5. **Soul evolution** — how the agent's relationship with this person has grown

### Cost Model

For a typical always-on companion with 50 messages/day:

| Without BT | With BT (mature) |
|------------|------------------|
| 50 Flash calls/day | 35 Flash Lite + 10 Flash + 1 Pro |
| ~$0.50-1.00/day | ~$0.02-0.05/day |
| ~$15-30/month | ~$0.60-1.50/month |

**20-50x cost reduction** once patterns are compiled.

---

## 7. The Continuous Learning Loop

### The Compilation Cycle

```
1. USER SPEAKS
   ↓
2. BT EVALUATES
   ↓ (no match)
3. FLASH REASONS (System 2)
   → Produces: action + innerThought + conditions that triggered
   ↓ (action succeeds — user responds positively)
4. BT COMPILER CAPTURES
   → Extracts: triggering conditions + successful action
   → Creates: new BT branch with those conditions → that action
   ↓
5. BT GROWS
   → New branch inserted at appropriate priority
   → Next time same conditions occur → BT handles it (System 1)
   ↓
6. TEACHER REFINES (every N turns)
   → Reviews all compiled branches
   → Composes related branches into skills
   → Prunes stale branches
   → Rebalances priorities
```

### What Gets Compiled

| Trigger | Compiled Pattern | Example |
|---------|-----------------|---------|
| Emotional state + topic | Template response | "When stressed about work → ask about specific project" |
| Time pattern | Proactive behavior | "Morning → recap prompt" |
| Entity mention | Memory recall + response | "Gallery mentioned → recall deadline + ask about progress" |
| Question type | Answer strategy | "How-to question → check if intention exists, else escalate" |
| Greeting pattern | Opener style | "After 3 days → warm reconnect, not cold restart" |

### What Does NOT Get Compiled

- **Novel emotional situations** — always escalate. Empathy requires reasoning.
- **Multi-step planning** — always escalate to Flash/Pro. BTs handle execution, not strategy.
- **Conflict or confrontation** — always escalate. Too high-stakes for templates.
- **First 5 conversations** — the bootstrap tree handles these. Not enough data to compile.

### Skill Composition (Voyager Pattern)

When multiple compiled branches relate to the same domain, the Teacher (Pro) composes them into a named skill:

```
Branch 1: "When gallery mentioned → recall deadline"
Branch 2: "When gallery + stressed → offer to help with statement"
Branch 3: "When gallery + excited → ask about artist list"

↓ Composed into:

Skill: "gallery_show_support"
  selector:
    - sequence: [person_state("stressed"), person_topic("gallery")]
      → "How's the artist statement? Want me to take another pass?"
    - sequence: [person_state("excited"), person_topic("gallery")]
      → "That's exciting! Who made the final artist list?"
    - sequence: [person_topic("gallery")]
      → "How's the show prep going? Deadline's {gallery_deadline}."
```

Skills are reusable sub-trees that can be referenced by name. They compose hierarchically — a skill can reference other skills.

### Pattern Decay

Every compiled branch tracks:
- `lastUsed` — when it last matched and was used
- `successCount` — how many times it produced a good outcome
- `failCount` — how many times the user responded negatively after
- `compiledAt` — when it was created

Branches that haven't been used in 30 days get a `chance(0.5)` gate added — half the time they fire normally, half they escalate to verify the pattern still works. Branches with `failCount > successCount` get pruned entirely.

---

## 8. Tool Use and Task Execution

### BT-Driven Tool Selection

The behavior tree doesn't just select responses — it selects TOOLS:

```yaml
selector:
  # Calendar check (compiled: user asks about schedule 3x/week)
  - sequence:
      - condition: person_topic("schedule") OR person_topic("meeting")
      - action: { type: "tool_call", tool: "calendar.check", params: { date: "{detected_date}" } }

  # Research (compiled: user asks factual questions about entities)
  - sequence:
      - condition: message_is_question
      - condition: entity_mentioned
      - action: { type: "tool_call", tool: "web.search", params: { query: "{entity} {topic}" } }

  # Email draft (compiled: active intention involves email)
  - sequence:
      - condition: intention_active("email_draft")
      - condition: person_topic("email") OR person_topic("draft")
      - action: { type: "tool_call", tool: "email.draft", params_from: "intention_plan" }
```

### Skill-Based Task Execution

Complex tasks compile into multi-step skills:

```
Skill: "prepare_weekly_recap"
  sequence:
    - action: { type: "tool_call", tool: "calendar.get_week" }
    - action: { type: "tool_call", tool: "email.get_unread", params: { days: 7 } }
    - action: { type: "tool_call", tool: "notes.search", params: { query: "this week" } }
    - template_response:
        template: "Here's your week: {calendar_summary}. {email_highlights}. {note_items}."
        variables: [tool_results]
```

This entire task runs on Flash Lite — it's just condition evaluation + tool calls + template filling. No reasoning required.

---

## 9. Integration Patterns

### Standalone Mode

Psyche-BT runs as an independent agent with its own CLI, conversation loop, and persistence. Suitable for testing and evaluation.

### Drop-In Mode (Psyche Integration)

Psyche-BT replaces the conversation agent in the existing Psyche architecture:

```
Before:
  User speaks → Gemini reasons (expensive) → responds

After:
  User speaks → BT evaluates → Flash Lite responds (cheap)
                     ↓ (escalate)
               Flash reasons → BT compiles → cheaper next time
```

The hypothesis engine, intention engine, and memory graph become ECS components. The analysis loop feeds the BT compiler. The soul becomes a permanent node in the BT that shapes tone.

### Drop-In Mode (Any Agent Architecture)

Psyche-BT can wrap any LLM-based agent:

```typescript
import { PsycheBT } from "psyche-bt";

const agent = new PsycheBT({
  userId: "user_123",
  models: { runtime: "flash-lite", reasoning: "flash", teacher: "pro" },
  tools: [calendar, email, web],
  persistDir: "./data/users/user_123",
});

// First call — no patterns, escalates to Flash
const response1 = await agent.respond("Hey, I'm stressed about work");
// → Flash reasons, produces response, BT compiles pattern

// 20th similar call — pattern compiled
const response20 = await agent.respond("Ugh, another stressful day");
// → BT matches, Flash Lite fills template, no escalation
// → 10x cheaper, 5x faster
```

---

## 10. Gotchas and Solutions

### From Production Testing (ArgOS — 200+ tick simulations, 5 agents)

| Problem | Cause | Solution |
|---------|-------|----------|
| LLM responses truncated by token limits | maxOutputTokens set too low | Remove all token limits — let models complete naturally |
| Identical LLM outputs across different agents | Template fallback from truncation, looked like caching | Root cause was truncation, not caching. Remove token limits. |
| Anti-repetition fighting natural behavior | System converting useful repeated actions to no-ops | Remove anti-repetition entirely. Natural state changes create variety. |
| BT branches too specific (location-dependent) | Compiler captured room name as condition | Only capture location for location-specific actions (speech is universal) |
| BT branches fire before speech is processed | BT evaluates before perceptions propagate | Speech override: bypass BT when direct speech detected, escalate to LLM |
| Agents ignore direct questions | BT handles all interaction, no speech priority | Directed speech perception overrides BT evaluation |
| Compiled `speak` branches loop | Same greeting fires every tick | Dedup with recent action history check |
| Template filling hallucinates | Flash Lite invents content not in context | Templates reference specific ECS paths, not open variables |
| Skill composition produces noise | Every action sequence compiled as skill | Only compile from VERIFIED goal completion (Voyager pattern) |
| Movement/navigation blocked permanently | Observe/interact actions set persistent state | Scope transient state; clear on action completion |

### Anticipated for Companion Use

| Risk | Mitigation |
|------|-----------|
| Privacy: person model persisted on disk | Encrypt at rest. User controls deletion. |
| Stale personality model after life changes | Pattern decay + periodic Pro re-evaluation |
| Over-reliance on compiled patterns (feels robotic) | Weighted random + variety nodes + periodic forced escalation |
| Bootstrap cold start (empty BT) | Generic bootstrap tree handles first 5-10 conversations |
| Multi-person confusion | Separate ECS per person. No shared state. |

---

## 11. Implementation Plan

### MVP: Minimal Working Example

**Goal:** A CLI agent that demonstrates the learning loop — getting measurably better at helping one person over a 20-turn conversation.

### Phase 1: Foundation (ECS + BT Evaluator)

```
src/
├── ecs/
│   ├── components.ts          # All person model components
│   ├── person-store.ts        # Load/save/query person model
│   └── types.ts               # Shared types
├── bt/
│   ├── types.ts               # BehaviorNode, ConditionOp types
│   ├── evaluator.ts           # BT evaluation engine
│   ├── conditions.ts          # Condition checkers (ECS queries)
│   ├── bootstrap.ts           # Default tree for new users
│   └── templates.ts           # Template response filling
├── __tests__/
│   ├── evaluator.test.ts      # BT evaluation unit tests
│   ├── conditions.test.ts     # Condition checking tests
│   └── compiler.test.ts       # Compilation tests
└── index.ts                   # Entry point
```

**Deliverables:**
- Person model as ECS components (in-memory + JSON persistence)
- BT evaluator that checks conditions against ECS state
- Bootstrap tree with generic patterns
- Template response filler
- Unit tests proving BT evaluation works

### Phase 2: Learning Loop (Compiler + Model Integration)

```
src/
├── compiler/
│   ├── bt-compiler.ts         # Capture LLM decisions → BT branches
│   ├── skill-composer.ts      # Compose related branches into skills
│   └── pattern-decay.ts       # Age and prune stale branches
├── models/
│   ├── config.ts              # Model tier configuration
│   ├── flash-lite.ts          # Runtime response generation
│   ├── flash.ts               # Reasoning on escalation
│   └── teacher.ts             # Periodic deep analysis + recompilation
└── engine/
    ├── conversation.ts        # Main conversation loop
    ├── context-builder.ts     # Assemble ECS state for LLM context
    └── speech-analyzer.ts     # Detect emotional state, topics, entities
```

**Deliverables:**
- BT compiler that captures Flash reasoning → BT branches
- Escalation path: BT → Flash → response + compilation
- Teacher cycle that refines the model and recompiles the BT
- Context builder that assembles minimal context from ECS for Flash Lite
- Speech analyzer that detects topics, entities, emotional state

### Phase 3: CLI + Evaluation

```
src/
├── cli/
│   ├── chat.ts                # Interactive CLI chat
│   ├── eval.ts                # Automated evaluation harness
│   └── stats.ts               # Show learning progress
└── persistence/
    ├── store.ts               # JSON file persistence
    └── export.ts              # Export person model / BT
```

**Deliverables:**
- Interactive CLI: chat with the agent, see learning in real-time
- `/stats` command showing: BT size, compiled branches, escalation rate, cost
- `/tree` command showing the current behavior tree
- `/teach` command forcing a teacher cycle
- Automated eval: 20-turn scripted conversation measuring escalation rate over time
- Persistence: save/load person model + BT across sessions

### Phase 4: Tool Integration + Task Execution

```
src/
├── tools/
│   ├── registry.ts            # Tool registration and discovery
│   ├── web-search.ts          # Web search tool
│   ├── file-io.ts             # Read/write files
│   └── calendar.ts            # Calendar integration (optional)
└── tasks/
    ├── intention-engine.ts    # Intention formation from conversation
    └── task-executor.ts       # BT-driven task execution
```

**Deliverables:**
- Tool registry with BT-compatible tool actions
- BT branches that trigger tool calls
- Intention detection from conversation
- Skill compilation for multi-step tasks

### Success Criteria

| Metric | Target |
|--------|--------|
| Escalation rate after 20 turns | < 50% (down from 100%) |
| Flash Lite handles routine greetings | 100% after 5 turns |
| Response latency (Flash Lite path) | < 500ms |
| Response latency (escalation path) | < 3s |
| Person model persists across sessions | ✅ |
| BT grows with each session | ✅ measurable |
| Teacher cycle improves BT quality | ✅ measured by escalation rate |
| Cost per 50-message day (mature) | < $0.10 |

---

## 12. Voyager Composition: Skills as Functions

### The Voyager Insight

In the Voyager paper (2023), Minecraft agents reached diamond tools through functional composition. Each solved problem became a named function that higher-level problems could call. "mine_wood" became a function. "craft_planks" called "mine_wood". "build_house" called "craft_planks" + "craft_door" + "place_blocks". The skill library grew hierarchically.

Our behavior trees are the same mechanism. A compiled BT sub-tree IS a function:
- It has a name (the skill name)
- It has inputs (conditions it checks from ECS state)
- It has outputs (actions it produces)
- It can be called by other trees (via `{ type: "skill", name: "..." }`)
- It can be tested independently
- It can be versioned and replaced

### Composition Levels

```
Level 0 — Atomic Actions (built-in):
  web_search(query) → search results
  read_file(path) → file content
  send_message(to, body) → delivery confirmation
  calendar_check(date) → events

Level 1 — Compiled Skills (from single successful interactions):
  "look_up_entity" → web_search("{entity_name}") → summarize → store_to_memory
  "check_schedule" → calendar_check("{date}") → format_for_person(style)
  "draft_quick_email" → recall_context → generate_draft → present_to_user

Level 2 — Composed Skills (teacher merges related Level 1 skills):
  "research_topic" → sequence:
    - look_up_entity(topic)
    - look_up_entity(related_entities[])
    - synthesize_findings
    - store_research_summary

  "morning_prep" → sequence:
    - check_schedule(today)
    - check_email(unread, priority > high)
    - research_topic(first_meeting.subject)
    - format_briefing(style)

Level 3 — Complex Workflows (composed from Level 2):
  "weekly_executive_prep" → sequence:
    - for_each(meetings_this_week):
        - morning_prep(meeting)
    - compile_weekly_themes
    - draft_strategic_notes
    - surface_to_user_at(Sunday 8pm)
```

Each level is built from verified sub-skills. If "web_search" works reliably and "summarize" works reliably, then "look_up_entity" (which composes them) starts with high confidence. This is how the agent bootstraps complex behavior from simple proven pieces — exactly the Voyager progression from wood tools to diamond tools.

### Composition Rules

1. **Only compose from verified skills.** A skill must have `successRate > 0.7` across 3+ uses before it can be composed into a higher-level skill.
2. **Composition is proposed by the Teacher (Pro), not auto-generated.** The Teacher sees patterns across multiple skills and proposes compositions with rationale.
3. **Composed skills inherit the lowest confidence of their sub-skills.** If "web_search" is 95% reliable but "summarize" is only 70%, the composed "research_topic" starts at 70%.
4. **Decomposition on failure.** If a composed skill fails, the system decomposes it and re-tries the sub-skills individually to identify which one broke.

---

## 13. Swarm Exploration and Species Learning

### The Three Levels of Learning

```
┌─────────────────────────────────────────────────────────────┐
│  SPECIES LEVEL (shared across all users)                     │
│  Universal patterns that work for everyone.                  │
│  Updated weekly from swarm results.                          │
│  New users start with this as their bootstrap tree.          │
├─────────────────────────────────────────────────────────────┤
│  SWARM LEVEL (parallel exploration)                          │
│  N agents probe task domains simultaneously.                 │
│  Best patterns promoted to species level.                    │
│  Runs continuously in background.                            │
├─────────────────────────────────────────────────────────────┤
│  INDIVIDUAL LEVEL (per user)                                 │
│  Personal patterns compiled from this user's interactions.   │
│  Builds on species-level bootstrap tree.                     │
│  Gets better with every conversation.                        │
└─────────────────────────────────────────────────────────────┘
```

### Swarm Architecture

The exploration system is a parallelized eval-and-learn pipeline:

```
                    ┌──────────────┐
                    │  EVAL SUITE  │
                    │  1 seed task  │
                    └──────┬───────┘
                           │ generate 1000 variants
                    ┌──────▼───────┐
                    │  TASK POOL   │
                    │  1000 tasks   │
                    └──────┬───────┘
                           │ distribute
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Agent 1  │ │ Agent 2  │ │ Agent N  │
        │ BT v4.2  │ │ BT v4.2  │ │ BT v4.2  │
        │          │ │          │ │          │
        │ Execute  │ │ Execute  │ │ Execute  │
        │ task,    │ │ task,    │ │ task,    │
        │ compile  │ │ compile  │ │ compile  │
        │ patterns │ │ patterns │ │ patterns │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             ▼             ▼             ▼
        ┌──────────────────────────────────────┐
        │         JUDGE AGENTS                  │
        │  Score each execution on:             │
        │  - Task completion (0-100)            │
        │  - Efficiency (steps taken)           │
        │  - Quality of output                  │
        │  - Tool use appropriateness           │
        └──────────────────┬───────────────────┘
                           │
        ┌──────────────────▼───────────────────┐
        │         PATTERN HARVESTER             │
        │                                       │
        │  Collect all compiled BT branches     │
        │  from all N agents.                   │
        │                                       │
        │  For each branch:                     │
        │  - How many agents produced it?       │
        │  - What was the avg judge score?      │
        │  - Is it novel or redundant?          │
        │                                       │
        │  PROMOTE branches that:               │
        │  - Appeared in 3+ agents (robust)     │
        │  - Had avg score > 80 (effective)     │
        │  - Aren't already in species tree     │
        │                                       │
        │  PRUNE branches that:                 │
        │  - Only appeared in 1 agent (fragile) │
        │  - Had avg score < 50 (ineffective)   │
        └──────────────────┬───────────────────┘
                           │
        ┌──────────────────▼───────────────────┐
        │         SPECIES BT UPDATE             │
        │                                       │
        │  Merge promoted branches into the     │
        │  species-level bootstrap tree.        │
        │  Version: v4.2 → v4.3                 │
        │                                       │
        │  All future agents start with v4.3.   │
        │  Existing users get new branches on   │
        │  next teacher cycle.                  │
        └──────────────────────────────────────┘
```

### Eval-Driven Exploration

The exploration system ties into an existing eval pipeline:

**Step 1: Seed Eval**
A human writes one eval task:
```json
{
  "task": "User asks agent to find a good Italian restaurant near their office",
  "context": { "user_location": "downtown Portland", "dietary": "vegetarian" },
  "success_criteria": "Agent finds real restaurant, checks dietary fit, provides address",
  "scoring": { "completion": 50, "accuracy": 25, "helpfulness": 25 }
}
```

**Step 2: Variant Generation**
An LLM generates 1000 variants of this seed:
```json
{ "task": "User asks for a quiet coffee shop to work from", ... }
{ "task": "User needs a last-minute birthday dinner reservation", ... }
{ "task": "User wants to know if their favorite brunch spot is open today", ... }
{ "task": "User asks for restaurant recommendations for a first date", ... }
```

Variants cover: different intents, edge cases, ambiguity, multi-step versions, failure modes, different user styles (terse, verbose, vague, specific).

**Step 3: Parallel Execution**
1000 agents run in parallel (or batched). Each agent:
1. Receives a task variant
2. Evaluates its BT — does any compiled pattern match?
3. If match → execute via Flash Lite
4. If no match → escalate to Flash → reason → execute
5. On success → BT compiler captures the pattern
6. Records: task, actions taken, BT branches compiled, tools used, time, cost

**Step 4: Judge Scoring**
Separate judge agents (could be Pro, could be human) score each execution:
- Did the task complete? (0-100)
- Was the output correct? (0-100)
- Was tool use appropriate? (0-100)
- Was the interaction natural? (0-100)
- Composite score

**Step 5: Pattern Harvesting**
The harvester collects all 1000 agents' compiled BT branches:
```
Branch: "when user_asks_about(restaurant) AND entity_known(location) → web_search → filter_dietary → format_recommendation"
  - Appeared in: 847/1000 agents
  - Avg judge score: 88
  - Verdict: PROMOTE to species tree

Branch: "when user_mentions(reservation) → calendar_check → call_restaurant_api"
  - Appeared in: 234/1000 agents
  - Avg judge score: 72
  - Verdict: PROMOTE (moderate confidence)

Branch: "when user_asks(restaurant) → immediately_recommend(hardcoded_name)"
  - Appeared in: 12/1000 agents
  - Avg judge score: 31
  - Verdict: PRUNE (hallucinated specific restaurants)
```

**Step 6: Species Update**
Promoted branches merge into the species BT. The bootstrap tree for all new users now includes "how to help with restaurant recommendations" as a compiled skill — no learning required.

### The Feedback Loop

```
Eval seed → 1000 variants → 1000 agents → judge scores → pattern harvest
     ↑                                                          │
     │              IMPROVEMENT SIGNAL                          │
     └──────────────────────────────────────────────────────────┘
     
What the improvement signal tells us:
  - Which TASK TYPES have low completion rates → generate more evals for those
  - Which BT BRANCHES have low scores → refine or replace them
  - Which TOOLS are underused → add BT patterns that demonstrate their use
  - Which ESCALATION PATTERNS are common → these are the next skills to compile
  - Which JUDGE CRITERIA are too easy/hard → recalibrate the eval
```

This creates a flywheel:
1. Evals reveal gaps in the species BT
2. Exploration generates 1000 attempts to fill those gaps
3. Best attempts become compiled patterns
4. Species BT improves
5. Next eval round has fewer gaps
6. System focuses exploration on remaining hard problems
7. Repeat

### Cross-Pollination Between Users

Individual users' BTs occasionally produce patterns that are universally useful:

```
User A's agent learns: "when user is in a meeting → hold non-urgent messages"
  → Teacher notices this pattern
  → Promotes to exploration candidate
  → 1000 agents test it across diverse users
  → 890 agents confirm it works broadly
  → PROMOTED to species BT
  → All users benefit
```

The inverse also works — species-level patterns get personalized:

```
Species BT has: "morning check-in → share schedule + top emails"
User B's teacher refines it: "morning check-in → skip emails (B hates email summaries), add weather (B bikes to work)"
  → Personal override stays in B's individual tree
  → Species tree unchanged (B's preference is personal, not universal)
```

### Swarm Implementation

```typescript
// Exploration runner
async function runExploration(config: {
  seedEval: Eval,
  variantCount: number,
  parallelAgents: number,
  speciesBT: BehaviorTree,
}) {
  // 1. Generate variants
  const variants = await generateEvalVariants(config.seedEval, config.variantCount);
  
  // 2. Run agents in parallel batches
  const results = [];
  for (const batch of chunk(variants, config.parallelAgents)) {
    const batchResults = await Promise.allSettled(
      batch.map(variant => {
        const agent = new PsycheBT({ bt: clone(config.speciesBT) });
        return agent.executeTask(variant);
      })
    );
    results.push(...batchResults);
  }
  
  // 3. Judge all results
  const scores = await judgeResults(results);
  
  // 4. Harvest patterns
  const allBranches = results.flatMap(r => r.compiledBranches);
  const promoted = harvestPatterns(allBranches, scores);
  
  // 5. Update species BT
  const newSpeciesBT = mergeBranches(config.speciesBT, promoted);
  
  return {
    speciesBT: newSpeciesBT,
    stats: {
      variantsRun: variants.length,
      avgScore: mean(scores),
      branchesCompiled: allBranches.length,
      branchesPromoted: promoted.length,
      improvementDelta: measureImprovement(config.speciesBT, newSpeciesBT),
    },
  };
}
```

### Cost of Exploration

Running 1000 agents on Flash Lite:
- ~1000 tasks × ~5 LLM calls each × ~500 tokens avg = ~2.5M tokens
- At $0.25/1M input: **~$0.63 per exploration run**
- Plus Flash escalation (~200 tasks): ~$1.25
- Plus Pro judging: ~$2.50
- **Total: ~$4-5 per 1000-task exploration run**

For $5, the species BT gets measurably better at an entire task domain. Run 10 exploration cycles across 10 domains and for $50 you have an agent that handles 10,000 task variants from compiled patterns.

---

## 14. Architecture Summary

```
INDIVIDUAL LEARNING          SWARM LEARNING              SPECIES EVOLUTION
(per user, continuous)       (parallel exploration)       (periodic promotion)
                             
User speaks                  Eval seed generated          Harvest all agents'
  ↓                            ↓                          compiled patterns
BT evaluates                 1000 variants created          ↓
  ↓ (escalate)                 ↓                          Statistical analysis:
Flash reasons                1000 agents execute            which patterns are
  ↓                            ↓                          universal vs personal
BT compiles pattern          Judge agents score              ↓
  ↓                            ↓                          Promote robust patterns
Personal tree grows          Best patterns harvested       to species bootstrap
  ↓                            ↓                            ↓
Teacher refines              Merge into species BT         All new users inherit
  ↓                            ↓                          improved starting tree
Skills composed              Next generation starts          ↓
                             smarter                       Repeat
```

Three flywheel loops, all feeding each other:
1. **Individual**: user interaction → compiled pattern → better personal service
2. **Swarm**: eval tasks → parallel exploration → best patterns promoted
3. **Species**: universal patterns → improved bootstrap → better day-one experience

The end state: an agent that starts smart (species BT from thousands of exploration runs), gets smarter fast (individual compilation from every interaction), and continuously improves in the background (swarm exploration of new task domains). All running on the cheapest model available.

---

### Updated Success Criteria

| Metric | Target |
|--------|--------|
| Escalation rate after 20 turns | < 50% (down from 100%) |
| Escalation rate with mature species BT | < 20% |
| Flash Lite handles routine greetings | 100% after 5 turns |
| Flash Lite handles routine tasks (with species BT) | 80% on first encounter |
| Response latency (Flash Lite path) | < 500ms |
| Response latency (escalation path) | < 3s |
| Person model persists across sessions | ✅ |
| BT grows with each session | ✅ measurable |
| Teacher cycle improves BT quality | ✅ measured by escalation rate |
| Cost per 50-message day (mature) | < $0.10 |
| Exploration run cost (1000 tasks) | < $5 |
| Species BT improvement per exploration | ✅ measurable by eval score delta |
| Skill composition depth | 3+ levels within 50 conversations |
| Cross-user pattern promotion rate | > 5 patterns/week at scale |

### Updated File Count: 39 source files, 4 test files

This is a focused, buildable system. No framework dependencies beyond `@google/genai`. Pure TypeScript. Runs with `npx tsx`. Tests with Jest.

---

## Addendum: Features Built Since Original Design (April 2026)

The following features were implemented after the initial design document was written. They extend the architecture described above without changing the core BT compilation loop.

### A1. Plan Compilation (Multi-Step Procedures)

The original design compiled single-action strategies. Plan compilation extends this to **multi-step tool sequences with variable binding**.

- **Plan nodes** (`bt/types.ts`): New BT node type `{ type: "plan", plan: CompiledPlan }` containing ordered steps, each with a tool call or generation action, output bindings, success checks, and failure policies.
- **Variable binding**: Output of step N stored as `{step_N}`, referenced by step N+1's parameters. Bindings resolve at execution time from the agent state.
- **Sub-plan composition**: Steps can invoke named plans via `{ type: "sub_plan", planName, params }`, enabling recursive composition (L0 tools -> L1 plans -> L2 composed -> L3+ workflows).
- **Plan compiler** (`compiler/plan-compiler.ts`): Captures execution traces (`beginTrace -> recordStep -> completeTrace`), generalizes specific values into variable references, wraps in conditions, applies immune system checks.
- **Plan execution** (`engine/conversation.ts`): When the BT evaluator returns a plan result, the engine executes steps in order, resolves bindings, checks outcomes, and handles step failures.
- **Priority insertion**: Plans insert at position 0 in the root selector (before bootstrap) because they have the most specific conditions.

### A2. Runtime Swarm (Spawn-at-Point-of-Failure)

When the BT has no compiled pattern for a task, instead of immediately escalating to an expensive model, the system spawns N cheap model instances in parallel:

- **Divergent approaches**: Each instance gets a different strategy hint (direct, analytical, empathetic, action-oriented, creative, cautious, tool-focused, contextual, decomposition, pattern-matching).
- **Parallel execution** (`swarm/runtime-swarm.ts`): All N instances run via `Promise.all` — wall-clock time equals one instance.
- **Convergence**: Responses clustered by word-level + tool-sequence similarity. Largest cluster's centroid is the response.
- **Quality signal**: Convergence replaces the expensive judge model (Condorcet's jury theorem — if P(correct) > 0.5, majority vote accuracy -> 1 as N grows).
- **Trace recording**: Successful swarm results are recorded for nightly plan compilation.
- **Cost**: 8 Flash Lite calls ~ $0.0008 vs $0.01+ for one expensive model call.

Integrated into the conversation engine as a layer between BT failure and expensive model escalation:
```
BT match -> execute (cheapest)
BT miss -> runtime swarm (cheap, parallel)
  -> converged? use result, record trace
  -> not converged? expensive model (last resort)
```

### A3. Nightly Training (Personalized Batch Improvement)

Overnight batch training that explores variations of the agent's actual interaction history:

- **Training signal extraction** (`swarm/nightly-trainer.ts`): Analyzes the agent's conversation history for topic frequency, emotional patterns, weak spots (high-escalation topics), and real escalation examples.
- **Personalized task generation**: 60% of training scenarios target weak spots, 40% reinforce known patterns. Scripts use the agent's real topics and emotional patterns.
- **Swarm training**: N instances start from the agent's current tree (not bootstrap), explore conversation variants, compile new branches.
- **Species merge**: Convergent patterns across instances merge into the tree.
- **Regression gate**: Benchmark the improved tree before saving. Reject changes if escalation increases by > 5pp.
- **CLI**: `npx tsx src/cli/nightly.ts --person=alice` (supports `--dry-run`, `--validate-only`, cron scheduling).

### A4. Tree Maintenance (Pruning and Deduplication)

Without maintenance, trees accumulate conflicting and stale branches. The maintenance system (`compiler/tree-maintenance.ts`) runs during the nightly cycle:

- **Deduplication**: When multiple branches share identical condition fingerprints, keep the one with the highest success rate.
- **Pruning**: Remove branches unused for 30+ days or with < 30% success rate (after minimum 5 executions).
- **Chance node cleanup**: Legacy branches compiled with `chance(0.7)` conditions get the chance node stripped (exploration is now handled by epsilon-greedy, not per-branch randomness).
- **Health tracking**: `recordBranchExecution(fingerprint, success)` tracks per-branch execution stats for pruning decisions.

### A5. Google SDK Migration

Migrated from Vercel AI SDK (`ai` + `@ai-sdk/google`) to the official Google Generative AI SDK (`@google/genai`) for direct access to Gemini-specific features:

- **Structured outputs**: `responseMimeType: "application/json"` + `responseSchema` for guaranteed valid JSON (no regex parsing).
- **Ready for thinking**: `thinkingConfig: { thinkingLevel: "medium" }` for improved reasoning.
- **Ready for caching**: `cachedContent` for system instruction caching.
- **Ready for flex inference**: Lower cost for batch (nightly) operations.

### A6. Cross-Domain Convergence (Verified)

Plan compilation verified to generalize across three domains:

| Domain | Convergent Structure | Convergence Rate |
|--------|---------------------|-----------------|
| Productivity | file_read -> draft -> make_checklist | 100% |
| Software Engineering | analyze_error -> file_read -> file_write -> run_tests | 100% |
| Knowledge Work | search -> summarize -> draft | 100% |

All three replay successfully on held-out task variants. Plans compose across domains.

### A7. Battle Test Results (Real Gemini)

6-battery stress test with real Gemini models:

| Battery | What | Result |
|---------|------|--------|
| Real Execution | Multi-step tool chains with state validation | 5/5 |
| Learning Curve | 5 cycles: 88% -> 79% escalation, 29 -> 112 nodes | PASS |
| Hard Problems | Ambiguity, context, contradictions, depth | 5/5 |
| Comparative | No BT -> Bootstrap -> Swarm -> Plans | Each layer improves |
| Scale Stress | 100 branches, 609 nodes, 0.017ms eval | PASS |
| Adversarial | Harmful, generic, negative, broad, spam | 5/5 |
