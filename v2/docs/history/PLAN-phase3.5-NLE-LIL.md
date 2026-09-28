# Phase 3.5: Narrative Logic Engine + Linguistic Integration Layer

## Vision (from LSE Architecture)

The LSE Trinity: **ECS** (ground truth) + **LIL** (language bridge) + **NLE** (storyteller). The ECS is built. The LIL and NLE are partially built. This phase completes them.

**NLE**: Not a reactive gap-detector — a *proactive storyteller*. It plans narrative arcs at genesis, seeds conflicts into NPC memories/impressions/goals, orchestrates dramatic beats, and adapts in real-time to player actions. Like a DM who's read the module.

**LIL**: The bidirectional bridge between natural language and ECS state. Text → ECS actions (player input) AND ECS state → narrative prose (world rendering). Currently our MUD DM does both, but crudely. The LIL should be a clean, reusable layer.

## What Exists

| Component | Status | Location |
|-----------|--------|----------|
| ECS foundation | ✅ Complete | BitECS + dynamic components + component registry |
| Agent cognition | ✅ Complete | aspirations → goals → BT → LLM fallback |
| World mutation | ✅ Complete | spawn/destroy/modify affordance effects |
| Spirit hierarchy | ✅ Functional | 8 spirits, gap detection, God AI autopilot |
| Narrator spirit | ⚠️ Reactive only | `spirits/narrator-spirit.ts` — nudges characters, injects stimuli |
| MUD DM layer | ⚠️ Basic | `mud/mud-client.ts` — NL→actions→narration, works but thin |
| Story planning | ❌ Missing | No story graphs, no arc planning, no conflict seeding |
| NPC knowledge grounding | ⚠️ Partial | NPCs have memories/beliefs but DM doesn't read them for narration |

## Architecture

### 3.5.1 — Narrative Logic Engine (NLE)

The NLE operates at three timescales:

**Genesis (one-time):** When the world is created from a seed phrase, the NLE generates a **Story Scaffold** — a high-level narrative plan with:
- 2-3 **narrative tensions** (e.g., "tax collector is corrupt", "bandits threaten the village")
- For each tension: **dramatic beats** (setup → escalation → crisis → resolution)
- **NPC role assignments**: which characters serve which narrative function (protagonist, antagonist, catalyst, witness)
- **Relationship seeds**: initial impressions, memories, and secrets planted into NPCs

**Active (continuous):** While the simulation runs, the NLE:
- Monitors narrative state (which beats have been hit, which tensions are active)
- **Nudges NPCs** toward dramatic beats by adjusting goal priorities and planting memories
- **Pre-builds world elements** ahead of where the story needs to go (places objects, creates affordances)
- **Detects player engagement** and shifts the story toward what the player is investigating

**Reactive (on events):** When significant events happen (player discovers a secret, NPC confronts another, combat occurs), the NLE:
- Updates the story graph
- Recalculates which beats are reachable
- May **retcon** minor details for narrative coherence (adjust an NPC's memory, plant a clue)

**Implementation:** A `StoryScaffold` ECS component on a world entity, plus a `NarrativeDirector` system that runs in the AI operation loop alongside spirits.

### 3.5.2 — Linguistic Integration Layer (LIL)

The LIL is the clean interface between language and ECS. Two directions:

**Text → Action (Player Input):**
- Parse natural language intent using LLM
- Map to ECS actions (move, speak, interact, observe)
- Resolve entity references against actual world state (fuzzy matching)
- Validate actions are possible (target exists, affordance available, room accessible)
- Return structured actions + any validation errors

**State → Narrative (World Rendering):**
- Query ECS for room state, NPC state, recent events, active tensions
- Include NPC inner state (goals, impressions, memories) for richer narration
- Include narrative context from NLE (what beat are we in, what tension is active)
- Generate atmospheric prose grounded in real data
- Weave NPC responses (from their actual cognition) into the narration

**NPC Dialogue Grounding:**
When an NPC responds to the player, the LIL ensures their dialogue references:
- Their actual memories (not hallucinated)
- Their current goal and aspirations
- Their impressions of the player and other NPCs
- Any secrets or knowledge they have from the narrative scaffold

## Implementation Plan

### Task 1: Story Scaffold — ECS Components + Genesis Generation

**New components:**
```typescript
StoryScaffold {
  tensions: string[];      // JSON: array of narrative tensions
  beats: string[];         // JSON: array of dramatic beats with status
  npcRoles: string[];      // JSON: NPC→role assignments
  currentAct: string[];    // "setup" | "escalation" | "crisis" | "resolution"
  adaptations: string[];   // JSON: log of story adaptations made
}
```

**Genesis hook:** After God AI creates the world, generate a story scaffold from the seed + created entities. The LLM analyzes the world and produces tensions, beats, and NPC role assignments.

**Success criteria:** After genesis, a StoryScaffold entity exists with 2-3 tensions, each with 3-4 beats. NPC memories/impressions seeded from the scaffold.

### Task 2: Narrative Director — Proactive Story Management

**New system:** `NarrativeDirector` runs as an AI operation in the dual-loop. Every 30-60 seconds:
1. Reads the current story scaffold state
2. Checks which beats have been triggered (by scanning chronicle events)
3. Identifies the next dramatic beat to work toward
4. Takes proactive action:
   - Plants memories or perceptions in NPCs to create tension
   - Adjusts NPC goal priorities (make the antagonist more aggressive)
   - Creates objects or affordances that enable the next beat
   - Broadcasts environmental stimuli ("You hear raised voices from the market")

**Success criteria:** In a 10-minute run, the NarrativeDirector advances through at least 2 dramatic beats. NPCs should be observably influenced (their goals/actions shift in response to planted seeds).

### Task 3: LIL — Text→Action Intent Parser

**Clean module:** `src/lil/intent-parser.ts`

Takes natural language + world state snapshot → returns structured actions. Separate from the DM narration — pure intent parsing.

```typescript
interface ParsedIntent {
  actions: Array<{ type: string; target?: string; content?: string }>;
  interpretation: string;  // Brief description of what the LLM understood
  confidence: number;      // 0-1
  impossible?: string;     // If the action can't be done, why
}

async function parsePlayerIntent(
  input: string,
  worldSnapshot: WorldSnapshot,
  conversationHistory: ConversationEntry[],
): Promise<ParsedIntent>
```

**Success criteria:** Correctly parses: movement ("go to the tavern"), speech ("tell Garrick about the bandits"), interaction ("forge a sword at the anvil"), observation ("look around"), compound actions ("go to the market and talk to the merchant").

### Task 4: LIL — State→Narrative World Renderer

**Clean module:** `src/lil/world-renderer.ts`

Takes ECS state + narrative context → returns atmospheric prose. Reads:
- Room contents (entities, agents, objects)
- NPC inner state (goals, impressions of player, recent memories)
- Active narrative tensions from the story scaffold
- Time of day, weather, world events
- Recent events from the chronicle

```typescript
interface NarrativeContext {
  worldSnapshot: WorldSnapshot;
  storyScaffold: StoryScaffoldData;
  recentEvents: ChronicleEntry[];
  playerHistory: ConversationEntry[];
}

async function renderNarrative(
  playerAction: ParsedIntent,
  npcResponses: NpcResponse[],
  context: NarrativeContext,
): Promise<string>
```

**NPC dialogue grounding:** When rendering NPC speech, the renderer includes the NPC's actual inner thought (from `agentThink`), their memories relevant to the topic, and their impression of the player.

**Success criteria:** Narration references real ECS state (room descriptions, NPC goals, object traits). NPC dialogue reflects their actual knowledge, not DM invention.

### Task 5: Enriched MUD Client — Wire NLE + LIL Together

Rewrite `mud-client.ts` to use the clean LIL modules and NLE:

1. Genesis: create world → generate story scaffold → seed NPC memories
2. Player input → `parsePlayerIntent()` → execute actions → trigger NPC cognition
3. Collect NPC responses + narrative context → `renderNarrative()` → display
4. NarrativeDirector runs in background, shaping the story

**Success criteria:** Scripted playtest produces:
- NPCs who reference their actual goals and memories in dialogue
- Narrative tension visible in NPC behavior (antagonist acts differently than allies)
- Story beats advance through player interaction
- Atmospheric narration grounded in ECS state + narrative context

### Task 6: Integration Test — Full NLE+LIL Playtest

Scripted 10-turn session testing:
1. Arrive in village, look around (LIL renders room with narrative tension context)
2. Talk to ally NPC (dialogue grounded in their memories/goals)
3. Talk to antagonist NPC (dialogue reflects their hidden agenda)
4. Discover a clue (NLE has pre-planted it)
5. Confront someone about the clue (NPC responds based on real knowledge)
6. Move to a new location (NLE has prepared it with relevant elements)
7. Witness an event (NarrativeDirector orchestrated it)

**Success criteria:** Each turn's output demonstrates grounding in real ECS state. Narrative coheres across turns. NPCs are consistent with their scaffold roles.

## Execution Order

```
Task 1: Story Scaffold components + genesis     ← foundation
Task 2: Narrative Director system                ← proactive story management
Task 3: LIL Intent Parser                        ← clean input processing
Task 4: LIL World Renderer                       ← grounded narration
Task 5: Wire into MUD client                     ← integration
Task 6: Full playtest                            ← validation
```

Tasks 1-2 are the NLE. Tasks 3-4 are the LIL. Task 5 is integration. Task 6 proves it works.

## Key Design Decisions

1. **Story scaffold is ECS data** — queryable, modifiable by spirits and God AI
2. **NLE nudges, doesn't force** — adjusts goal priorities and plants memories, but NPCs still make their own decisions through their cognition chain
3. **LIL is two clean modules** — intent parser and world renderer, reusable beyond the MUD
4. **NPC dialogue is grounded** — the renderer includes NPC inner state, it doesn't invent dialogue
5. **The DM LLM calls are separate from NPC LLM calls** — DM narrates, NPCs think for themselves

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/ecs/components.ts` | Modify | Add StoryScaffold component |
| `src/nle/story-scaffold.ts` | Create | Story scaffold generation + management |
| `src/nle/narrative-director.ts` | Create | Proactive story advancement system |
| `src/lil/intent-parser.ts` | Create | Natural language → ECS actions |
| `src/lil/world-renderer.ts` | Create | ECS state → narrative prose |
| `src/mud/mud-client.ts` | Rewrite | Wire NLE + LIL together |
| `src/mud/test-session.ts` | Rewrite | Full NLE+LIL playtest |
