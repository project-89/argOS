import { generateText } from "ai";
import type { World } from "../ecs/world";
import type { SystemDefinition, SystemRegistry, SystemContext, CognitiveContext, GoalData, MemoryData, BeliefData, ThoughtData, ImpressionData } from "../ecs/dynamic-systems";
import { AllComponents, Goal, Memory, Belief, Thought, Impression } from "../ecs/components";
import { AllRelations, HasGoal, HasMemory, HasBelief, HasThought, HasImpression } from "../ecs/relations";
import { query, hasComponent, getRelationTargets, addEntity, addComponent, removeEntity } from "bitecs";
import { createAIContext } from "../ai/ai-context";
import { moveEntity, isWalkable, getTile } from "../world/ascii-world";
import { query as q } from "bitecs";
import { WorldMap as WorldMapComponent } from "../ecs/components";
// LOCKED MODELS from centralized config - DO NOT CHANGE
import { systemBakerModel } from "../llm/config";

const model = systemBakerModel;

export interface SystemBakeResult {
  success: boolean;
  system?: SystemDefinition;
  designDoc?: SystemDesignDoc;
  testResults?: TestResult[];
  error?: string;
}

export interface SystemDesignDoc {
  name: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  pseudocode: string;
  frequency: number;
  async?: boolean;
}

export interface TestResult {
  name: string;
  passed: boolean;
  input: any;
  expectedOutput: any;
  actualOutput: any;
  error?: string;
}

const FULL_CONTEXT = `
=== ECS COMPONENT DEFINITIONS (Structure of Arrays) ===

Components are objects where each property is an array indexed by entity ID (eid).
To read: ComponentName.property[eid]
To write: ComponentName.property[eid] = value

// Core Components
const Name = { value: [] };  // string[]
const Description = { value: [] };  // string[]
const Position = { x: [], y: [], z: [] };  // number[]
const Room = { capacity: [], ambience: [] };  // number[], string[]
const PhysicalObject = { material: [], weight: [], portable: [] };

// Agent Components
const Agent = { role: [], systemPrompt: [], active: [] };  // string[], string[], boolean[]
const Mind = { mode: [], arousal: [], focus: [], lastUpdate: [] };  // string[], number[], string[], number[]
const WorkingMemory = { capacity: [], currentLoad: [], decayRate: [] };  // number[]
const Attention = { target: [], intensity: [], duration: [], lastShift: [] };  // string[], number[], number[], number[]
const Personality = { openness: [], conscientiousness: [], extraversion: [], agreeableness: [], neuroticism: [] };  // number[] 0-1

// ASCII Grid World Components
const GridPosition = { x: [], y: [], facing: [] };  // number[], number[], string[] - Entity position on grid map
const Sprite = { char: [], color: [], bgColor: [], zIndex: [] };  // string[], string[], string[], number[] - How entity renders on map
const WorldMap = { name: [], width: [], height: [], tiles: [] };  // string[], number[], number[], string[] - The grid map itself

// Cognitive Components (all are ECS entities connected to agents via relations)
const Thought = { content: [], type: [], salience: [], timestamp: [] };  // string[], string[], number[], number[]
const Perception = { type: [], content: [], source: [], intensity: [], timestamp: [] };  // string[], string[], string[], number[], number[]
const Memory = { type: [], content: [], emotionalValence: [], importance: [], timestamp: [], lastRecalled: [], recallCount: [] };  // type: episodic|semantic|procedural
const Belief = { subject: [], predicate: [], object: [], confidence: [], source: [], timestamp: [] };  // SPO triple with confidence
const Impression = { targetName: [], trait: [], valence: [], confidence: [], basis: [] };  // impressions of other entities
const Goal = { description: [], priority: [], status: [], progress: [], deadline: [] };
const ConversationTurn = { role: [], content: [], timestamp: [] };  // role: user|assistant

// Environment Components
const Stimulus = { type: [], content: [], source: [], salience: [], urgency: [], novelty: [], timestamp: [], duration: [], decay: [] };
const StimulusSource = { stimulusType: [], template: [], interval: [], lastEmit: [] };
const KnowledgeNode = { type: [], content: [], confidence: [], source: [], timestamp: [], lastAccessed: [], accessCount: [], protected: [] };
const Action = { type: [], parameters: [], status: [], timestamp: [], result: [] };
const CognitiveEvent = { type: [], content: [], salience: [], confidence: [], timestamp: [] };
const GodAgent = { worldName: [], narrative: [], tick: [] };

=== RELATIONS ===

Relations connect entities. Use ctx.getRelationTargets(world, eid, RelationName) to get targets.
Adding a relation: addComponent(world, subjectEid, RelationName(targetEid))

// Spatial Relations
OccupiesRoom - entity occupies a room (exclusive - can only be in one room)
Contains - entity contains another entity

// Social Relations
Knows - entity knows another entity (has familiarity, sentiment, lastInteraction)
Perceives - entity perceives another (has clarity, attention)
Targets - entity targets another (exclusive)

// Cognitive Relations (connect agents to their cognitive entities)
HasMemory - agent has a memory entity
HasBelief - agent has a belief entity
HasImpression - agent has an impression entity (has sentiment, lastUpdated)
HasThought - agent has a thought entity
HasPerception - agent has a perception entity
HasConversation - agent has a conversation turn entity
HasGoal - agent has a goal entity

=== SYSTEM CONTEXT (ctx) ===

ctx.tick - current tick number
ctx.delta - milliseconds since last tick
ctx.elapsed - total elapsed milliseconds
ctx.emit(eventType, data) - emit an event
ctx.log(message) - log a message
ctx.query(world, [Component1, Component2]) - returns iterable of entity IDs
ctx.hasComponent(world, eid, Component) - check if entity has component
ctx.getRelationTargets(world, eid, Relation) - get array of target entity IDs

=== GRID MOVEMENT UTILITIES (ctx.grid) ===

ctx.grid.moveEntity(world, mapEid, eid, dx, dy) - Move entity by delta, returns true if successful
ctx.grid.isWalkable(world, mapEid, x, y) - Check if tile is walkable (returns boolean)
ctx.grid.getTile(world, mapEid, x, y) - Get tile character at position
ctx.grid.getMapByName(world, name) - Get map entity ID by name (returns eid or undefined)

EXAMPLE: Move all agents with GridPosition randomly
const maps = Array.from(ctx.query(world, [WorldMap]));
if (maps.length === 0) return;
const mapEid = maps[0];

const gridAgents = Array.from(ctx.query(world, [Agent, GridPosition]));
for (const eid of gridAgents) {
  const directions = [[0,-1], [0,1], [-1,0], [1,0]];  // N, S, W, E
  const [dx, dy] = directions[Math.floor(Math.random() * 4)];
  const moved = ctx.grid.moveEntity(world, mapEid, eid, dx, dy);
  if (moved) {
    ctx.emit("movement", { entity: Name.value[eid], dx, dy });
  }
}

=== AI UTILITIES (ctx.ai) - for dynamic/creative content ===

await ctx.ai.generateText(prompt, context) - generate creative text (returns string)
await ctx.ai.decide(options[], context) - AI chooses from options (returns {choice, reasoning})
await ctx.ai.generateDialogue(speaker, situation, personality) - generate speech (returns string)
await ctx.ai.generateEvent(worldState, theme) - generate narrative event (returns {type, content, targets[]})
await ctx.ai.describeEntity(entityData) - poetic description (returns string)

USE AI UTILITIES WHEN:
- Content should be unique/creative each time
- Decisions need contextual reasoning
- Generating dialogue or narrative text
- Dynamic event generation

DO NOT USE AI UTILITIES WHEN:
- Simple math or state changes
- Deterministic logic
- Performance-critical operations

=== WORKING EXAMPLE SYSTEMS ===

// Example 1: Find entities by name and modify them
const entities = Array.from(ctx.query(world, [Name, Room]));
for (const eid of entities) {
  if (Name.value[eid] === "Living Room") {
    Room.ambience[eid] = "quiet and comfortable";
    ctx.log("Updated room ambience");
  }
}

// Example 2: Modify all agents' arousal
const agents = Array.from(ctx.query(world, [Agent, Mind]));
for (const eid of agents) {
  if (Mind.arousal[eid] > 0.3) {
    Mind.arousal[eid] -= 0.01;
  }
}

// Example 3: Emit stimuli from sources to agents in same room
const sources = Array.from(ctx.query(world, [StimulusSource]));
for (const sourceEid of sources) {
  const roomTargets = ctx.getRelationTargets(world, sourceEid, OccupiesRoom);
  if (roomTargets.length === 0) continue;
  const roomEid = roomTargets[0];
  
  const agents = Array.from(ctx.query(world, [Agent]));
  for (const agentEid of agents) {
    const agentRooms = ctx.getRelationTargets(world, agentEid, OccupiesRoom);
    if (agentRooms.includes(roomEid)) {
      ctx.emit("stimulus", {
        type: StimulusSource.stimulusType[sourceEid],
        content: StimulusSource.template[sourceEid],
        target: Name.value[agentEid]
      });
    }
  }
}

// Example 4: Random value changes with clamping
const value = Mind.arousal[eid];
const change = (Math.random() - 0.5) * 0.2;  // -0.1 to +0.1
Mind.arousal[eid] = Math.max(0, Math.min(1, value + change));

// Example 5: Using entity properties for events
ctx.emit("ambience_change", {
  room: Name.value[roomEid],
  oldAmbience: oldValue,
  newAmbience: Room.ambience[roomEid],
  timestamp: ctx.elapsed
});

// Example 6: AI-powered dynamic content generation
const description = await ctx.ai.generateText(
  "Generate a brief description of " + Name.value[agentEid] + "'s current mood",
  "You describe characters concisely based on their state"
);
ctx.emit("description", { target: Name.value[agentEid], content: description });

// Example 7: AI decision making
const decision = await ctx.ai.decide(
  ["eat", "sleep", "work"],
  "The person is tired and hungry. They have a deadline tomorrow."
);
ctx.log("Decision: " + decision.choice + " because " + decision.reasoning);

// Example 8: Dynamic dialogue generation
const dialogue = await ctx.ai.generateDialogue(
  Name.value[agentEid],
  "commenting on the weather",
  Agent.role[agentEid]
);
ctx.emit("speech", { speaker: Name.value[agentEid], content: dialogue });

// Example 9: Creating a memory for an agent (cognitive ECS pattern)
const memoryEid = addEntity(world);
addComponent(world, memoryEid, Memory);
addComponent(world, agentEid, HasMemory(memoryEid));
Memory.type[memoryEid] = "episodic";
Memory.content[memoryEid] = "Had a good meal in the kitchen";
Memory.emotionalValence[memoryEid] = 0.6;  // positive emotion
Memory.importance[memoryEid] = 0.5;  // moderate importance
Memory.timestamp[memoryEid] = ctx.elapsed;

// Example 10: Reading an agent's memories
const memoryTargets = ctx.getRelationTargets(world, agentEid, HasMemory);
for (const memEid of memoryTargets) {
  if (ctx.hasComponent(world, memEid, Memory)) {
    ctx.log("Memory: " + Memory.content[memEid]);
  }
}

// Example 11: Adding a belief to an agent
const beliefEid = addEntity(world);
addComponent(world, beliefEid, Belief);
addComponent(world, agentEid, HasBelief(beliefEid));
Belief.subject[beliefEid] = "the fridge";
Belief.predicate[beliefEid] = "contains";
Belief.object[beliefEid] = "food";
Belief.confidence[beliefEid] = 0.95;

// Example 12: Memory decay system (prune old, low-importance memories)
for (const agentEid of Array.from(ctx.query(world, [Agent]))) {
  const memories = ctx.getRelationTargets(world, agentEid, HasMemory);
  if (memories.length > 50) {
    // Sort by importance and recency, remove lowest scoring
    const scored = memories.map(meid => ({
      eid: meid,
      score: (Memory.importance[meid] || 0) + (Memory.recallCount[meid] || 0) * 0.1
    }));
    scored.sort((a, b) => a.score - b.score);
    const toRemove = scored.slice(0, memories.length - 50);
    for (const { eid } of toRemove) {
      removeEntity(world, eid);
    }
  }
}

=== COGNITIVE HELPERS (ctx.cognitive) - High-level API for agent cognition ===

These helpers provide a cleaner way to manage agent cognitive entities:

// Creating cognitive entities
ctx.cognitive.createGoal(world, agentEid, { description: "Get groceries", priority: 8 });
ctx.cognitive.createMemory(world, agentEid, { type: "episodic", content: "Heard thunder outside", importance: 0.9 });
ctx.cognitive.createBelief(world, agentEid, { subject: "storms", predicate: "are", object: "dangerous" });
ctx.cognitive.createThought(world, agentEid, { content: "I should be careful", type: "caution" });
ctx.cognitive.createImpression(world, agentEid, { targetName: "Neighbor", trait: "friendly", valence: 0.9 });

// Reading cognitive entities
const goals = ctx.cognitive.getGoals(world, agentEid);  // returns [{eid, data: {description, priority, status, progress}}]
const memories = ctx.cognitive.getMemories(world, agentEid);  // returns [{eid, data: {type, content, emotionalValence, importance}}]
const beliefs = ctx.cognitive.getBeliefs(world, agentEid);  // returns [{eid, data: {subject, predicate, object, confidence}}]

// Updating goals
ctx.cognitive.updateGoal(goalEid, { progress: 50, status: "in_progress" });
ctx.cognitive.completeGoal(world, goalEid);  // sets status=completed, progress=100
ctx.cognitive.removeGoal(world, goalEid);  // removes the goal entity

// Example: Goal-based behavior system
const agents = Array.from(ctx.query(world, [Agent]));
for (const agentEid of agents) {
  const goals = ctx.cognitive.getGoals(world, agentEid);
  const activeGoals = goals.filter(g => g.data.status === "active");
  
  if (activeGoals.length === 0) {
    // Create a default goal
    ctx.cognitive.createGoal(world, agentEid, {
      description: "Explore the area",
      priority: 3,
      status: "active"
    });
  } else {
    // Work on highest priority goal
    const topGoal = activeGoals.sort((a, b) => (b.data.priority || 0) - (a.data.priority || 0))[0];
    ctx.cognitive.updateGoal(topGoal.eid, { progress: (topGoal.data.progress || 0) + 10 });
    
    if ((topGoal.data.progress || 0) >= 100) {
      ctx.cognitive.completeGoal(world, topGoal.eid);
      ctx.emit("goal_completed", { agent: Name.value[agentEid], goal: topGoal.data.description });
    }
  }
}

=== ENTITY MANAGEMENT ===

ctx.addEntity(world) - Create a new entity, returns entity ID
ctx.addComponent(world, eid, Component) - Add a component to an entity
ctx.removeEntity(world, eid) - Remove an entity from the world

// Example: Creating a custom entity
const customEid = ctx.addEntity(world);
ctx.addComponent(world, customEid, Name);
ctx.addComponent(world, customEid, Description);
Name.value[customEid] = "Dynamic Entity";
Description.value[customEid] = "Created by a system";
`;

const SYSTEM_BUILD_PROMPT = `You are a System Builder for an ECS simulation engine.

${FULL_CONTEXT}

=== YOUR TASK ===

Generate PLAIN JAVASCRIPT code for a system function body.

CRITICAL RULES:
1. NO TypeScript - no type annotations, no "as" casts, no generics
2. NO imports/exports - everything is available in scope
3. Components are already destructured: Name, Room, Agent, Mind, StimulusSource, etc.
4. Relations are already destructured: OccupiesRoom, Knows, Contains, etc.
5. Always use Array.from() on query results
6. Access data with: ComponentName.property[eid]
7. Find entities by name by iterating and checking Name.value[eid]
8. Handle edge cases (entity not found, etc.)

Generate ONLY the function body. No markdown, no code fences, no explanation.`;

export async function designSystem(description: string): Promise<SystemDesignDoc | null> {
  try {
    const { text } = await generateText({
      model,
      system: `You are a System Architect. Design ECS systems concisely.

${FULL_CONTEXT}

Respond with JSON only:
{
  "name": "SystemName",
  "purpose": "Brief description",
  "inputs": ["Component1"],
  "outputs": ["What changes"],
  "pseudocode": "Brief steps",
  "frequency": 5000,
  "async": false
}

NOTE on "async": Set to true ONLY if the system uses AI utilities (ctx.ai.*). 
Async systems run in the background and don't block the main loop.
Fast ECS-only systems should have async: false (default).`,
      prompt: `Design a system for: ${description}`,
    });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as SystemDesignDoc;
  } catch (error) {
    console.error("Design error:", error);
    return null;
  }
}

export async function buildSystem(design: SystemDesignDoc): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system: SYSTEM_BUILD_PROMPT,
      prompt: `Build system: ${design.name}
Purpose: ${design.purpose}
Pseudocode: ${design.pseudocode}

Generate the plain JavaScript function body only. No markdown.`,
    });

    let code = text.trim();
    if (code.startsWith('```')) {
      code = code.replace(/```\w*\n?/g, '').trim();
    }
    if (code.endsWith('```')) {
      code = code.slice(0, -3).trim();
    }

    return code;
  } catch (error) {
    console.error("Build error:", error);
    return null;
  }
}

export interface CompileResult {
  success: boolean;
  fn?: (world: World, ctx: SystemContext) => void;
  error?: string;
}

export function compileSystemCode(code: string): CompileResult {
  try {
    const wrappedCode = `
      const { Name, Description, Position, Room, Agent, Mind, WorkingMemory, Attention, Personality, Thought, Perception, Memory, Belief, Impression, Goal, ConversationTurn, Stimulus, KnowledgeNode, Action, CognitiveEvent, PhysicalObject, StimulusSource, GodAgent, GridPosition, Sprite, WorldMap } = ctx.components;
      const { ChildOf, OccupiesRoom, Knows, RelatesTo, Causes, Supports, Contradicts, Contains, Perceives, Targets, BelongsTo, HasMemory, HasBelief, HasImpression, HasThought, HasPerception, HasConversation, HasGoal } = ctx.relations;
      ${code}
    `;

    const fn = new Function('world', 'ctx', wrappedCode) as (world: World, ctx: SystemContext) => void;
    return { success: true, fn };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Compile error:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

export function testSystem(
  fn: (world: World, ctx: SystemContext) => void,
  world: World,
  registry: SystemRegistry
): TestResult[] {
  const results: TestResult[] = [];
  const testEvents: Array<{ type: string; data: any }> = [];
  const testLogs: string[] = [];

  const cognitiveContext: CognitiveContext = {
    createGoal: (w: World, agentEid: number, data: GoalData): number => {
      const goalEid = addEntity(w);
      addComponent(w, goalEid, Goal);
      addComponent(w, agentEid, HasGoal(goalEid));
      Goal.description[goalEid] = data.description;
      Goal.priority[goalEid] = data.priority ?? 5;
      Goal.status[goalEid] = data.status ?? "active";
      Goal.progress[goalEid] = data.progress ?? 0;
      Goal.deadline[goalEid] = data.deadline ?? 0;
      return goalEid;
    },
    createMemory: (w: World, agentEid: number, data: MemoryData): number => {
      const memEid = addEntity(w);
      addComponent(w, memEid, Memory);
      addComponent(w, agentEid, HasMemory(memEid));
      Memory.type[memEid] = data.type;
      Memory.content[memEid] = data.content;
      Memory.emotionalValence[memEid] = data.emotionalValence ?? 0;
      Memory.importance[memEid] = data.importance ?? 0.5;
      Memory.timestamp[memEid] = Date.now();
      Memory.lastRecalled[memEid] = Date.now();
      Memory.recallCount[memEid] = 0;
      return memEid;
    },
    createBelief: (w: World, agentEid: number, data: BeliefData): number => {
      const beliefEid = addEntity(w);
      addComponent(w, beliefEid, Belief);
      addComponent(w, agentEid, HasBelief(beliefEid));
      Belief.subject[beliefEid] = data.subject;
      Belief.predicate[beliefEid] = data.predicate;
      Belief.object[beliefEid] = data.object;
      Belief.confidence[beliefEid] = data.confidence ?? 0.5;
      Belief.source[beliefEid] = data.source ?? "observation";
      Belief.timestamp[beliefEid] = Date.now();
      return beliefEid;
    },
    createThought: (w: World, agentEid: number, data: ThoughtData): number => {
      const thoughtEid = addEntity(w);
      addComponent(w, thoughtEid, Thought);
      addComponent(w, agentEid, HasThought(thoughtEid));
      Thought.content[thoughtEid] = data.content;
      Thought.type[thoughtEid] = data.type ?? "reflection";
      Thought.salience[thoughtEid] = data.salience ?? 0.5;
      Thought.timestamp[thoughtEid] = Date.now();
      return thoughtEid;
    },
    createImpression: (w: World, agentEid: number, data: ImpressionData): number => {
      const impEid = addEntity(w);
      addComponent(w, impEid, Impression);
      addComponent(w, agentEid, HasImpression(impEid));
      Impression.targetName[impEid] = data.targetName;
      Impression.trait[impEid] = data.trait;
      Impression.valence[impEid] = data.valence;
      Impression.confidence[impEid] = data.confidence ?? 0.5;
      Impression.basis[impEid] = data.basis ?? "observation";
      return impEid;
    },
    getGoals: (w: World, agentEid: number): Array<{ eid: number; data: GoalData }> => {
      const targets = getRelationTargets(w, agentEid, HasGoal);
      return targets.map(eid => ({
        eid,
        data: {
          description: Goal.description[eid],
          priority: Goal.priority[eid],
          status: Goal.status[eid],
          progress: Goal.progress[eid],
          deadline: Goal.deadline[eid],
        }
      }));
    },
    getMemories: (w: World, agentEid: number): Array<{ eid: number; data: MemoryData }> => {
      const targets = getRelationTargets(w, agentEid, HasMemory);
      return targets.map(eid => ({
        eid,
        data: {
          type: Memory.type[eid] as "episodic" | "semantic" | "procedural",
          content: Memory.content[eid],
          emotionalValence: Memory.emotionalValence[eid],
          importance: Memory.importance[eid],
        }
      }));
    },
    getBeliefs: (w: World, agentEid: number): Array<{ eid: number; data: BeliefData }> => {
      const targets = getRelationTargets(w, agentEid, HasBelief);
      return targets.map(eid => ({
        eid,
        data: {
          subject: Belief.subject[eid],
          predicate: Belief.predicate[eid],
          object: Belief.object[eid],
          confidence: Belief.confidence[eid],
          source: Belief.source[eid],
        }
      }));
    },
    updateGoal: (eid: number, updates: Partial<GoalData>): void => {
      if (updates.description !== undefined) Goal.description[eid] = updates.description;
      if (updates.priority !== undefined) Goal.priority[eid] = updates.priority;
      if (updates.status !== undefined) Goal.status[eid] = updates.status;
      if (updates.progress !== undefined) Goal.progress[eid] = updates.progress;
      if (updates.deadline !== undefined) Goal.deadline[eid] = updates.deadline;
    },
    completeGoal: (w: World, eid: number): void => {
      Goal.status[eid] = "completed";
      Goal.progress[eid] = 100;
    },
    removeGoal: (w: World, eid: number): void => {
      removeEntity(w, eid);
    },
  };

  const testCtx: SystemContext = {
    tick: 1,
    delta: 1000,
    elapsed: 1000,
    emit: (type, data) => testEvents.push({ type, data }),
    log: (msg) => testLogs.push(msg),
    query,
    hasComponent,
    getRelationTargets,
    addEntity,
    addComponent,
    removeEntity,
    components: AllComponents,
    relations: AllRelations,
    ai: createAIContext(),
    grid: {
      moveEntity,
      isWalkable,
      getTile,
      getMapByName: (w: World, name: string): number | undefined => {
        const maps = Array.from(q(w, [WorldMapComponent]));
        for (const mapEid of maps) {
          if (WorldMapComponent.name[mapEid] === name || AllComponents.Name.value[mapEid] === name) {
            return mapEid;
          }
        }
        return undefined;
      },
    },
    cognitive: cognitiveContext,
  };

  try {
    fn(world, testCtx);
    results.push({
      name: "execution",
      passed: true,
      input: "world state",
      expectedOutput: "no errors",
      actualOutput: `${testEvents.length} events, ${testLogs.length} logs`,
    });
  } catch (error) {
    results.push({
      name: "execution",
      passed: false,
      input: "world state",
      expectedOutput: "no errors",
      actualOutput: null,
      error: String(error),
    });
  }

  return results;
}

async function reviewAndFixCode(code: string, error: string, design: SystemDesignDoc): Promise<string | null> {
  console.log("[SystemBaker] Code Review Agent fixing error:", error);
  
  try {
    const { text } = await generateText({
      model,
      system: `You are a Code Review Agent. Your job is to fix JavaScript syntax errors.

${FULL_CONTEXT}

RULES:
1. Fix ONLY the syntax error - don't rewrite everything
2. Return ONLY the fixed function body - no markdown, no explanation
3. Common issues to fix:
   - Missing semicolons
   - Mismatched brackets/braces/parens
   - TypeScript syntax that snuck in (remove type annotations)
   - Invalid JavaScript constructs
   - Async/await issues
4. The code must be valid JavaScript that can be passed to new Function()`,
      prompt: `Fix this code that failed with error: "${error}"

BROKEN CODE:
\`\`\`
${code}
\`\`\`

System purpose: ${design.purpose}

Return ONLY the fixed JavaScript function body. No markdown fences.`,
    });

    let fixedCode = text.trim();
    if (fixedCode.startsWith('```')) {
      fixedCode = fixedCode.replace(/```\w*\n?/g, '').trim();
    }
    if (fixedCode.endsWith('```')) {
      fixedCode = fixedCode.slice(0, -3).trim();
    }

    return fixedCode;
  } catch (error) {
    console.error("[SystemBaker] Code review failed:", error);
    return null;
  }
}

export async function bakeSystem(
  description: string,
  world: World,
  registry: SystemRegistry,
  maxRetries: number = 3
): Promise<SystemBakeResult> {
  console.log("\n[SystemBaker] Baking:", description.slice(0, 100) + "...");

  const design = await designSystem(description);
  if (!design) {
    return { success: false, error: "Failed to design system" };
  }
  console.log("[SystemBaker] Design:", design.name, "-", design.purpose);

  let lastError = "";
  let currentCode: string | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // First attempt: generate fresh code. Later attempts: try to fix the broken code
    if (attempt === 0 || !currentCode) {
      const retryContext = attempt > 0 ? `\n\nPREVIOUS ATTEMPT FAILED WITH ERROR: ${lastError}\nFix the error and try again.` : "";
      currentCode = await buildSystemWithContext(design, retryContext);
    } else {
      // Use the code review agent to fix syntax errors
      const fixedCode = await reviewAndFixCode(currentCode, lastError, design);
      if (fixedCode) {
        currentCode = fixedCode;
      } else {
        // Code review failed, try regenerating
        currentCode = await buildSystemWithContext(design, `\n\nPREVIOUS ATTEMPT FAILED WITH ERROR: ${lastError}\nFix the error and try again.`);
      }
    }
    
    if (!currentCode) {
      return { success: false, designDoc: design, error: "Failed to build system code" };
    }
    console.log(`[SystemBaker] Code ready (attempt ${attempt + 1}, ${currentCode.length} chars)`);

    const compileResult = compileSystemCode(currentCode);
    if (!compileResult.success || !compileResult.fn) {
      lastError = compileResult.error || "Unknown compile error";
      console.log(`[SystemBaker] Compile failed (attempt ${attempt + 1}):`, lastError);
      continue;
    }

    const testResults = testSystem(compileResult.fn, world, registry);
    const allPassed = testResults.every(r => r.passed);

    if (!allPassed) {
      lastError = testResults.find(r => !r.passed)?.error || "Unknown test failure";
      console.log(`[SystemBaker] Test failed (attempt ${attempt + 1}):`, lastError);
      if (attempt < maxRetries) continue;
      return { success: false, designDoc: design, testResults, error: `System tests failed after ${maxRetries + 1} attempts: ${lastError}` };
    }

    const system: SystemDefinition = {
      name: design.name,
      description: design.purpose,
      pseudocode: design.pseudocode,
      frequency: design.frequency,
      active: false,
      lastRun: 0,
      code: currentCode,
      compiledFn: compileResult.fn,
      async: design.async ?? false,
    };

    console.log("[SystemBaker] SUCCESS:", system.name);
    return { success: true, system, designDoc: design, testResults };
  }

  return { success: false, designDoc: design, error: `Failed after ${maxRetries + 1} attempts: ${lastError}` };
}

async function buildSystemWithContext(design: SystemDesignDoc, extraContext: string): Promise<string | null> {
  try {
    const { text } = await generateText({
      model,
      system: SYSTEM_BUILD_PROMPT + extraContext,
      prompt: `Build system: ${design.name}
Purpose: ${design.purpose}
Pseudocode: ${design.pseudocode}

Generate the plain JavaScript function body only. No markdown.`,
    });

    let code = text.trim();
    if (code.startsWith('```')) {
      code = code.replace(/```\w*\n?/g, '').trim();
    }
    if (code.endsWith('```')) {
      code = code.slice(0, -3).trim();
    }

    return code;
  } catch (error) {
    console.error("Build error:", error);
    return null;
  }
}

export async function modifySystem(
  systemName: string,
  modification: string,
  world: World,
  registry: SystemRegistry
): Promise<SystemBakeResult> {
  const existingSystem = registry.systems.get(systemName);
  if (!existingSystem) {
    return { success: false, error: `System not found: ${systemName}` };
  }

  console.log(`\n[SystemBaker] Modifying: ${systemName}`);
  console.log(`[SystemBaker] Modification: ${modification.slice(0, 100)}...`);

  try {
    const { text } = await generateText({
      model,
      system: SYSTEM_BUILD_PROMPT + `

EXISTING SYSTEM CODE:
\`\`\`
${existingSystem.code}
\`\`\`

Modify this code according to the request. Return ONLY the new function body.`,
      prompt: `Modify the "${systemName}" system: ${modification}`,
    });

    let code = text.trim();
    if (code.startsWith('```')) {
      code = code.replace(/```\w*\n?/g, '').trim();
    }
    if (code.endsWith('```')) {
      code = code.slice(0, -3).trim();
    }

    const compileResult = compileSystemCode(code);
    if (!compileResult.success || !compileResult.fn) {
      return { success: false, error: `Failed to compile modified code: ${compileResult.error}` };
    }

    const testResults = testSystem(compileResult.fn, world, registry);
    const allPassed = testResults.every(r => r.passed);

    if (!allPassed) {
      const error = testResults.find(r => !r.passed)?.error || "Unknown";
      return { success: false, testResults, error: `Modified system tests failed: ${error}` };
    }

    existingSystem.code = code;
    existingSystem.compiledFn = compileResult.fn;

    console.log("[SystemBaker] Modified successfully:", systemName);
    return { success: true, system: existingSystem, testResults };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export function activateBakedSystem(registry: SystemRegistry, system: SystemDefinition): void {
  system.active = true;
  registry.systems.set(system.name, system);
  console.log(`[SystemBaker] Activated: ${system.name}`);
}
