import { generateText, tool, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { z } from 'zod/v3';
import type { World } from "../ecs/world";
import { createEcsTools, createEntityRegistry, type EntityRegistry, type EcsTools, type ToolResult } from "../ecs/tools";
import { createGodAgentEntity } from "../ecs/prefabs";
import { GodAgent, Name } from "../ecs/components";
import { AllComponents } from "../ecs/components";
import { AllRelations } from "../ecs/relations";
import {
  createSystemRegistry,
  type SystemRegistry,
  type SystemDefinition,
  runSystems,
  runAsyncSystems,
  consumeEvents,
  listSystems,
  activateSystem,
  deactivateSystem,
  createStimulusEmissionSystem,
  createMindDecaySystem,
} from "../ecs/dynamic-systems";
import { bakeSystem, modifySystem, activateBakedSystem } from "./system-baker";
import { 
  writeSystemFile, 
  loadSystemFromFile, 
  loadAllSystems, 
  getSystemSource,
  deleteSystemFile,
  updateSystemFile,
  type LoadedSystem 
} from "../systems/system-loader";
import {
  createDynamicComponent,
  getDynamicComponent,
  listDynamicComponents,
  saveComponentDefinition,
  setDynamicComponentValue,
  getDynamicComponentValues,
  getAllDynamicComponentValuesForEntity,
  type ComponentDefinition,
} from "../ecs/dynamic-components";
import { createRenderingTools, type RenderingTools } from "../rendering/rendering-tools";

const model = google("gemini-2.5-flash");

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: "active" | "completed" | "abandoned";
  createdAt: number;
  completedAt?: number;
}

export interface MemoryEntry {
  id: string;
  type: "action" | "observation" | "decision" | "reflection";
  content: string;
  timestamp: number;
  importance: number;
  relatedEntities: string[];
  tags: string[];
}

export interface GodAgentState {
  eid: number;
  world: World;
  registry: EntityRegistry;
  systemRegistry: SystemRegistry;
  tools: EcsTools;
  renderingTools: RenderingTools;
  conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  thinkingLog: string[];
  tick: number;
  fileSystems: LoadedSystem[];
  memory: {
    shortTerm: MemoryEntry[];
    longTerm: MemoryEntry[];
    plans: Plan[];
    activePlan: string | null;
  };
}

export function createGodAgent(world: World, config: { name: string; worldName: string; narrative?: string }): GodAgentState {
  const registry = createEntityRegistry();
  const systemRegistry = createSystemRegistry();
  const tools = createEcsTools(world, registry);
  const renderingTools = createRenderingTools(world, registry);
  
  const eid = createGodAgentEntity(world, {
    name: config.name,
    worldName: config.worldName,
    narrative: config.narrative,
  });

  systemRegistry.systems.set("StimulusEmission", createStimulusEmissionSystem());
  systemRegistry.systems.set("MindDecay", createMindDecaySystem());

  return {
    eid,
    world,
    registry,
    systemRegistry,
    tools,
    renderingTools,
    conversationHistory: [],
    thinkingLog: [],
    tick: 0,
    fileSystems: [],
    memory: {
      shortTerm: [],
      longTerm: [],
      plans: [],
      activePlan: null,
    },
  };
}

const SHORT_TERM_LIMIT = 50;
const LONG_TERM_LIMIT = 200;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function addMemory(
  state: GodAgentState, 
  type: MemoryEntry["type"], 
  content: string, 
  options: { importance?: number; relatedEntities?: string[]; tags?: string[] } = {}
): MemoryEntry {
  const entry: MemoryEntry = {
    id: generateId(),
    type,
    content,
    timestamp: Date.now(),
    importance: options.importance ?? 5,
    relatedEntities: options.relatedEntities ?? [],
    tags: options.tags ?? [],
  };
  
  state.memory.shortTerm.push(entry);
  
  if (state.memory.shortTerm.length > SHORT_TERM_LIMIT) {
    const evicted = state.memory.shortTerm.shift()!;
    if (evicted.importance >= 7) {
      state.memory.longTerm.push(evicted);
      if (state.memory.longTerm.length > LONG_TERM_LIMIT) {
        state.memory.longTerm.sort((a, b) => b.importance - a.importance);
        state.memory.longTerm.pop();
      }
    }
  }
  
  return entry;
}

export function searchMemory(
  state: GodAgentState,
  query: { type?: MemoryEntry["type"]; tags?: string[]; entityName?: string; minImportance?: number }
): MemoryEntry[] {
  const all = [...state.memory.shortTerm, ...state.memory.longTerm];
  return all.filter(m => {
    if (query.type && m.type !== query.type) return false;
    if (query.minImportance && m.importance < query.minImportance) return false;
    if (query.entityName && !m.relatedEntities.includes(query.entityName)) return false;
    if (query.tags && !query.tags.some(t => m.tags.includes(t))) return false;
    return true;
  });
}

export function createPlan(state: GodAgentState, goal: string, steps: string[]): Plan {
  const plan: Plan = {
    id: generateId(),
    goal,
    steps: steps.map((desc, i) => ({
      id: `${generateId()}-step-${i}`,
      description: desc,
      status: "pending" as const,
      createdAt: Date.now(),
    })),
    status: "active",
    createdAt: Date.now(),
  };
  
  state.memory.plans.push(plan);
  state.memory.activePlan = plan.id;
  
  addMemory(state, "decision", `Created plan: ${goal}`, { 
    importance: 8, 
    tags: ["plan", "created"] 
  });
  
  return plan;
}

export function getActivePlan(state: GodAgentState): Plan | null {
  if (!state.memory.activePlan) return null;
  return state.memory.plans.find(p => p.id === state.memory.activePlan) ?? null;
}

export function advancePlan(state: GodAgentState, result?: string): PlanStep | null {
  const plan = getActivePlan(state);
  if (!plan) return null;
  
  const currentStep = plan.steps.find(s => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "completed";
    currentStep.result = result;
    currentStep.completedAt = Date.now();
    
    addMemory(state, "action", `Completed step: ${currentStep.description}`, {
      importance: 6,
      tags: ["plan", "step-completed"],
    });
  }
  
  const nextStep = plan.steps.find(s => s.status === "pending");
  if (nextStep) {
    nextStep.status = "in_progress";
    return nextStep;
  }
  
  plan.status = "completed";
  plan.completedAt = Date.now();
  state.memory.activePlan = null;
  
  addMemory(state, "decision", `Completed plan: ${plan.goal}`, {
    importance: 9,
    tags: ["plan", "completed"],
  });
  
  return null;
}

export function failPlanStep(state: GodAgentState, reason: string): void {
  const plan = getActivePlan(state);
  if (!plan) return;
  
  const currentStep = plan.steps.find(s => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "failed";
    currentStep.result = reason;
    currentStep.completedAt = Date.now();
    
    addMemory(state, "observation", `Step failed: ${currentStep.description} - ${reason}`, {
      importance: 8,
      tags: ["plan", "step-failed"],
    });
  }
}

export function abandonPlan(state: GodAgentState, reason: string): void {
  const plan = getActivePlan(state);
  if (!plan) return;
  
  plan.status = "abandoned";
  plan.completedAt = Date.now();
  state.memory.activePlan = null;
  
  addMemory(state, "decision", `Abandoned plan: ${plan.goal} - ${reason}`, {
    importance: 7,
    tags: ["plan", "abandoned"],
  });
}

function formatMemoryForPrompt(state: GodAgentState): string {
  const recentMemories = state.memory.shortTerm.slice(-10);
  const importantMemories = state.memory.longTerm
    .filter(m => m.importance >= 8)
    .slice(-5);
  
  const lines: string[] = [];
  
  if (importantMemories.length > 0) {
    lines.push("IMPORTANT MEMORIES:");
    for (const m of importantMemories) {
      lines.push(`  [${m.type}] ${m.content}`);
    }
  }
  
  if (recentMemories.length > 0) {
    lines.push("\nRECENT ACTIVITY:");
    for (const m of recentMemories) {
      lines.push(`  [${m.type}] ${m.content}`);
    }
  }
  
  const activePlan = getActivePlan(state);
  if (activePlan) {
    lines.push("\nACTIVE PLAN:");
    lines.push(`  Goal: ${activePlan.goal}`);
    for (const step of activePlan.steps) {
      const status = step.status === "completed" ? "✓" : 
                     step.status === "in_progress" ? "►" :
                     step.status === "failed" ? "✗" : "○";
      lines.push(`  ${status} ${step.description}${step.result ? ` (${step.result})` : ""}`);
    }
  }
  
  return lines.join("\n");
}

function buildSystemPrompt(state: GodAgentState): string {
  const worldName = GodAgent.worldName[state.eid];
  const narrative = GodAgent.narrative[state.eid];
  const systems = listSystems(state.systemRegistry);

  return `You are the God Agent - an omniscient, omnipotent overseer of the simulated world "${worldName}".

You are a COLLABORATIVE WORLD-BUILDER working with the user. Your role is to:
1. DISCUSS and EXPLORE ideas before implementing
2. ASK CLARIFYING QUESTIONS when the request is vague or has multiple interpretations
3. EXPLAIN your reasoning and propose options
4. EXECUTE only when you understand what the user wants

COLLABORATION GUIDELINES:
- If the user asks a question, ANSWER it conversationally - don't immediately create things
- If the request is ambiguous, ASK what they prefer (e.g., "Should the room be cozy or spacious?")
- PROPOSE ideas and wait for feedback before executing complex designs
- SHARE your thinking - explain WHY you'd design something a certain way
- You can suggest improvements or alternatives to the user's ideas
- For simple, clear requests, go ahead and execute
- For complex world-building, discuss the approach first

EXAMPLE COLLABORATION:
User: "Create a house"
You: "I'd love to help create a house! A few questions first:
- What style? (modern apartment, suburban home, cabin?)
- How many rooms should it have?
- Any specific furniture or objects you want?
- Should occupants be cognitive (AI-driven) or mechanical (purely system-driven)?"

EXAMPLE DIRECT EXECUTION:
User: "Add a person named Bob to the kitchen"
You: [Creates the agent directly since the request is clear]

${narrative ? `NARRATIVE CONTEXT:\n${narrative}\n` : ""}

AVAILABLE COMPONENTS (you can ONLY use these - do not invent new ones):
- Name: { value: string } - Entity's name
- Description: { value: string } - Entity's description  
- Position: { x: number, y: number, z: number } - Spatial position for 2D/3D visualization
- Room: { capacity: number, ambience: string } - A location/space
- Agent: { role: string, systemPrompt: string, active: boolean } - Cognitive agent that thinks
- Mind: { mode: string, arousal: number, focus: string } - Agent's mental state (also for mechanical entities!)
- PhysicalObject: { material: string, weight: number, portable: boolean } - Physical objects
- StimulusSource: { stimulusType: string, template: string, interval: number } - Emits stimuli
- Visual: { shape: string, color: string, size: number, label: string, opacity: number, glow: boolean, pulseRate: number } - 2D RENDERING
- Connection: { targetId: number, color: string, width: number, style: string, animated: boolean } - Visual connections between entities
- Needs: { hunger: number, energy: number, social: number, comfort: number } - Agent needs (0-100, higher hunger = more hungry)
- Interactable: { action: string, targetNeed: string, effectAmount: number, cooldown: number } - Objects agents can use
- CurrentAction: { type: string, targetEid: number, startTick: number, duration: number } - Agent's ongoing action
- Stimulus, Memory, Belief, Goal, Impression, Action, CognitiveEvent - Other components

2D VISUALIZATION SYSTEM:
The Visual component controls how entities appear in the 2D canvas:
- shape: "circle", "rect", "diamond", "triangle", "hexagon", "star"
- color: Any CSS color (hex "#ff0000", named "red", rgb "rgb(255,0,0)")
- size: Radius/size in pixels (default 20)
- label: Text displayed near the entity
- opacity: 0-1 (0 = invisible, 1 = fully visible)
- glow: true = entity has a glow effect (use for active/firing states)
- pulseRate: > 0 = entity pulses (good for showing activity/heartbeat)

Use setComponentValues to update Visual properties dynamically from systems!

IMPORTANT: Systems can ONLY read/write the components above. If you need custom data (like hunger, energy, temperature), 
use existing components creatively:
- Use Mind.arousal for energy/alertness levels
- Use Description.value to store state as text
- Use Position for spatial simulation
- Create StimulusSource entities to trigger events

AVAILABLE RELATIONS:
${Object.keys(AllRelations).map(r => `- ${r}`).join("\n")}

AVAILABLE SYSTEMS:
${systems.map(s => `- ${s.name} (${s.active ? 'ACTIVE' : 'inactive'}, ${s.frequency}ms): ${s.description}`).join("\n")}

PRE-BUILT SYSTEMS (can activate/deactivate as needed):
- TimeProgression: Advances world time (dawn/morning/evening/night), updates room ambience. Good for social/narrative sims.
- SocialDynamics: Adjusts agent arousal based on who else is in the room. Good for social sims.
- NarrativeEvents: Random atmospheric events ("thunder rumbles", "dog barks"). Good for immersive narrative.
- RelationshipEvolution: Strengthens relationships between agents in same room over time.

These are designed for SOCIAL simulations. For MECHANICAL simulations (cells, neurons, physics), 
you should DEACTIVATE these and bake custom systems instead.

TOOLS:
1. createAgent - Creates a COGNITIVE agent that THINKS via LLM (use for characters, NPCs, social simulations)
2. createEntity - Creates a MECHANICAL entity driven ONLY by systems (use for cells, neurons, planets, particles - NO thinking)
3. createRoom - Creates a space/location with Position for 2D visualization
4. createObject - Creates a physical object
5. createStimulusSource - Creates something that periodically emits stimuli
6. setComponentValues - Set values on existing components
7. addRelation - Create relationships between entities
8. bakeNewSystem - CAREFUL: Systems can ONLY use the components listed above
9. activateSystem/deactivateSystem - Control system execution

IMPORTANT DISTINCTION:
- Use createAgent for things that need to THINK (people, animals, characters)
- Use createEntity for things driven by SYSTEMS (cells, neurons, particles, planets)
  Entities have Mind component for state (arousal, mode, focus) but NO cognition

For 2D VISUALIZATION:
- Set Position.x and Position.y on entities (rooms and agents)
- Rooms are drawn as rectangles at their position
- Agents are drawn as circles inside their room
- Use setComponentValues to update positions

ASCII WORLD SYSTEM (Grid-based 2D world):
You can create a grid-based ASCII world where agents move around!

TILE CHARACTERS:
- '.' = Floor (walkable)
- '#' = Wall (solid)
- '~' = Water
- ',' = Grass (walkable)
- '+' = Door (walkable)
- ' ' = Void/empty

ASCII WORLD TOOLS:
1. createWorldMap(name, width, height, fill?) - Create grid world
2. drawRoom(mapName, x, y, width, height, floor?, wall?) - Draw a room with walls
3. drawDoor(mapName, x, y) - Add a door at position
4. drawPath(mapName, x1, y1, x2, y2, char?) - Draw a path between points
5. fillArea(mapName, x, y, width, height, char) - Fill rectangular area
6. setTile(mapName, x, y, char) - Set single tile
7. placeEntityOnGrid(entityName, mapName, x, y, char?, color?) - Place agent/entity on map
8. moveEntityOnGrid(entityName, mapName, direction) - Move entity (north/south/east/west)
9. setEntitySprite(entityName, char, color?) - Change entity's display character
10. getEntityPosition(entityName) - Get entity's current x, y position and facing
11. getEntitiesAtPosition(x, y) - Get all entities at a specific position
12. getEntitiesInRadius(x, y, radius) - Get all entities within radius of position
13. checkCollision(entityName, mapName, direction) - Check if entity can move in direction

EXAMPLE USAGE:
1. createWorldMap("house", 40, 20, " ") - Create empty map
2. drawRoom("house", 1, 1, 10, 8) - Draw first room
3. drawRoom("house", 15, 5, 12, 10) - Draw second room  
4. drawPath("house", 10, 4, 15, 9, ".") - Connect rooms with hallway
5. drawDoor("house", 10, 4) - Add door
6. createAgent(...) - Create an agent
7. placeEntityOnGrid("AgentName", "house", 5, 4, "@", "#ff6666") - Place on map

Agents placed on grid will appear in the ASCII World view!

PIXI.JS SPRITE RENDERING SYSTEM:
For graphical 2D rendering with sprites and animations (in addition to ASCII):

CHARACTER RIGS (recommended for NPCs):
Character rigs automatically map NPC actions to animations. When you set up a rig, the NPC's behavior drives its visual appearance.

1. getAvailableCharacters() - See what character sprites are available
2. setupCharacterRig(entityName, baseAtlas, actionAtlases?, actionMappings?) - Create a rig
3. triggerCharacterAction(entityName, action, direction?) - Trigger animation from action
4. setCharacterIdleState(entityName) - Set character to idle

EXAMPLE - Setting up an NPC:
1. createAgent("Farmer Bob", ...) - Create the agent
2. placeEntityOnGrid("Farmer Bob", "farm", 5, 5) - Place on map
3. setupCharacterRig("Farmer Bob", "farmer_1", { chop: "farmer_1_chop" }) - Set up rig
4. When Bob takes a "chop" action, call triggerCharacterAction("Farmer Bob", "chop")

DIRECT SPRITE CONTROL:
- setEntityPixiSprite(entityName, spriteName) - Assign a static sprite
- setEntityAnimation(entityName, atlasId, animationId) - Play a specific animation
- listAvailableSprites(tag?, search?) - Find sprites
- listAnimations(atlasId?, tag?) - List available animations
- describeEntityAppearance(entityName) - Get current visual state
- getVisibleEntities(viewerName, radius?) - What entities are nearby

AGENTS RUN COGNITION when:
- They have Agent.active = true
- They receive stimuli (from StimulusSource or broadcasts)
- The cognition cycle processes their perceptions and generates actions

When creating agents, always:
- Give distinctive name and role
- Set Agent.active = true
- Place in a room with roomName
- Consider adding StimulusSource nearby to trigger interactions

PLANNING AND MEMORY:
For complex tasks, use the planning tools to break them into steps:
- makePlan: Create a multi-step plan for complex goals
- advancePlanStep: Mark current step complete and move to next
- getActivePlan: Check your current plan progress
- recordMemory: Store important observations or decisions
- searchMemories: Recall relevant past information

${formatMemoryForPrompt(state)}`;
}

function buildTools(state: GodAgentState) {
  const componentNames = Object.keys(AllComponents) as [string, ...string[]];
  const relationNames = Object.keys(AllRelations) as [string, ...string[]];

  return {
    createAgent: tool({
      description: "Create a new cognitive agent entity with a name, role, system prompt, and optional room placement",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the agent"),
        role: z.string().describe("The agent's role/personality description"),
        systemPrompt: z.string().describe("Instructions defining how the agent thinks and behaves"),
        description: z.string().optional().describe("Physical or contextual description"),
        roomName: z.string().optional().describe("Name of room to place agent in"),
      }),
      execute: async (params) => {
        const result = state.tools.createAgent(params);
        console.log(`[Tool] createAgent: ${params.name}`);
        return result;
      },
    }),

    createEntity: tool({
      description: "Create a mechanical entity driven by systems (NOT cognitive). Use for cells, neurons, particles, planets - things that don't think but respond to systems.",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the entity"),
        description: z.string().optional().describe("Description of the entity"),
        roomName: z.string().optional().describe("Name of room to place entity in"),
        initialArousal: z.number().optional().describe("Initial arousal/energy level (0-1)"),
        mode: z.string().optional().describe("Initial mode state (e.g., 'resting', 'active', 'refractory')"),
      }),
      execute: async (params) => {
        const result = state.tools.createEntity(params);
        console.log(`[Tool] createEntity: ${params.name}`);
        return result;
      },
    }),

    createRoom: tool({
      description: "Create a new room/location entity",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the room"),
        description: z.string().optional().describe("Description of the room"),
        capacity: z.number().optional().describe("Maximum occupancy"),
        ambience: z.string().optional().describe("The mood/atmosphere of the room"),
      }),
      execute: async (params) => {
        const result = state.tools.createRoom(params);
        console.log(`[Tool] createRoom: ${params.name}`);
        return result;
      },
    }),

    createObject: tool({
      description: "Create a physical object entity",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the object"),
        description: z.string().optional().describe("Description of the object"),
        material: z.string().optional().describe("What the object is made of"),
        weight: z.number().optional().describe("Weight in kg"),
        portable: z.boolean().optional().describe("Can the object be moved"),
        roomName: z.string().optional().describe("Name of room to place object in"),
      }),
      execute: async (params) => {
        const result = state.tools.createObject(params);
        console.log(`[Tool] createObject: ${params.name}`);
        return result;
      },
    }),

    createStimulusSource: tool({
      description: "Create an entity that periodically emits stimuli to nearby agents",
      inputSchema: z.object({
        name: z.string().describe("Unique name"),
        stimulusType: z.string().describe("Type: auditory, visual, environmental, etc."),
        template: z.string().describe("The content/description of the stimulus"),
        interval: z.number().optional().describe("Milliseconds between emissions"),
        roomName: z.string().optional().describe("Room where this source is located"),
      }),
      execute: async (params) => {
        const result = state.tools.createStimulusSource(params);
        console.log(`[Tool] createStimulusSource: ${params.name}`);
        return result;
      },
    }),

    addRelation: tool({
      description: "Create a relationship between two entities",
      inputSchema: z.object({
        subjectName: z.string().describe("Name of the subject entity"),
        relationName: z.enum(relationNames).describe("Type of relation"),
        targetName: z.string().describe("Name of the target entity"),
      }),
      execute: async (params) => {
        const result = state.tools.addRelation(params);
        console.log(`[Tool] addRelation: ${params.subjectName} --[${params.relationName}]--> ${params.targetName}`);
        return result;
      },
    }),

    setComponentValues: tool({
      description: "Update component values on an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to update"),
        values: z.record(z.any()).describe("Key-value pairs to set"),
      }),
      execute: async (params) => {
        const result = state.tools.setComponentValues(params);
        console.log(`[Tool] setComponentValues: ${params.entityName}.${params.componentName}`);
        return result;
      },
    }),

    queryEntities: tool({
      description: "Query for entities with specific components",
      inputSchema: z.object({
        componentNames: z.array(z.string()).optional().describe("Required components"),
        notComponentNames: z.array(z.string()).optional().describe("Excluded components"),
      }),
      execute: async (params) => {
        const result = state.tools.queryEntities(params);
        console.log(`[Tool] queryEntities: ${(result.result as any[])?.length ?? 0} results`);
        return result;
      },
    }),

    listEntities: tool({
      description: "List all registered entities in the world",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.tools.listEntities();
        console.log(`[Tool] listEntities: ${(result.result as any[])?.length ?? 0} entities`);
        return result;
      },
    }),

    getComponentValues: tool({
      description: "Get component values from an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to read"),
        properties: z.array(z.string()).optional().describe("Specific properties to get"),
      }),
      execute: async (params) => {
        const result = state.tools.getComponentValues(params);
        console.log(`[Tool] getComponentValues: ${params.entityName}.${params.componentName}`);
        return result;
      },
    }),

    bakeNewSystem: tool({
      description: "Design and create a new system that runs periodically in the world. Describe what the system should do and it will be designed, built, tested, and made available for activation. Retries automatically on failure.",
      inputSchema: z.object({
        description: z.string().describe("Natural language description of what the system should do, what it reacts to, and what effects it has"),
      }),
      execute: async (params) => {
        console.log(`[Tool] bakeNewSystem: "${params.description.slice(0, 100)}..."`);
        const result = await bakeSystem(params.description, state.world, state.systemRegistry);
        if (result.success && result.system) {
          state.systemRegistry.systems.set(result.system.name, result.system);
          return {
            success: true,
            result: {
              name: result.system.name,
              description: result.system.description,
              frequency: result.system.frequency,
              status: "baked (inactive - use activateSystem to enable)",
            },
          };
        }
        return { success: false, result: null, error: result.error };
      },
    }),

    modifyBakedSystem: tool({
      description: "Modify an existing baked (in-memory) system using natural language. Describe what changes you want to make.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the baked system to modify"),
        modification: z.string().describe("Natural language description of how to change the system"),
      }),
      execute: async (params) => {
        console.log(`[Tool] modifyBakedSystem: ${params.systemName} - "${params.modification.slice(0, 100)}..."`);
        const result = await modifySystem(params.systemName, params.modification, state.world, state.systemRegistry);
        if (result.success) {
          return {
            success: true,
            result: {
              name: params.systemName,
              status: "modified successfully",
            },
          };
        }
        return { success: false, result: null, error: result.error };
      },
    }),

    listSystems: tool({
      description: "List all available systems and their status",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(state.systemRegistry);
        return {
          success: true,
          result: systems.map(s => ({
            name: s.name,
            description: s.description,
            frequency: s.frequency,
            active: s.active,
          })),
        };
      },
    }),

    activateSystem: tool({
      description: "Activate a system so it runs periodically",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to activate"),
      }),
      execute: async (params) => {
        const success = activateSystem(state.systemRegistry, params.systemName);
        console.log(`[Tool] activateSystem: ${params.systemName} -> ${success}`);
        return { success, result: { activated: params.systemName } };
      },
    }),

    deactivateSystem: tool({
      description: "Deactivate a system so it stops running",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to deactivate"),
      }),
      execute: async (params) => {
        const success = deactivateSystem(state.systemRegistry, params.systemName);
        console.log(`[Tool] deactivateSystem: ${params.systemName} -> ${success}`);
        return { success, result: { deactivated: params.systemName } };
      },
    }),

    createSystem: tool({
      description: `Create a new deterministic ECS system that runs every tick. The system will be written to a file and loaded dynamically. 
      
IMPORTANT: The code should be the BODY of the run function only (not the function declaration).

Available in ctx:
- ctx.tick, ctx.delta - timing info
- ctx.query(world, [Component1, Component2]) - query entities
- ctx.addComponent(world, eid, Component) - add component to entity
- ctx.removeEntity(world, eid) - remove entity
- ctx.getRelationTargets(world, eid, Relation) - get relation targets
- ctx.components.{Name, Agent, Needs, Interactable, CurrentAction, Room, GridPosition, etc.}
- ctx.relations.{OccupiesRoom, StimulusInRoom, etc.}
- ctx.dynamicComponents - Map of all dynamic components
- ctx.getDynamic(name) - get a dynamic component by name (returns component or undefined)
- ctx.log(message) - log to system output
- ctx.emit(type, data) - emit event

EXAMPLE 1 - Using built-in components (decay system):
const { Needs, Agent, Name } = ctx.components;
const agents = Array.from(ctx.query(world, [Agent, Needs]));
for (const eid of agents) {
  Needs.hunger[eid] = Math.min(100, (Needs.hunger[eid] ?? 50) + 1);
  if (Needs.hunger[eid] >= 80) {
    ctx.log(\`\${Name.value[eid]} is hungry!\`);
  }
}

EXAMPLE 2 - Using dynamic components (temperature system):
const Temperature = ctx.getDynamic("Temperature");
if (!Temperature) return;
const { Name } = ctx.components;
const entities = Array.from(ctx.query(world, [Name]));
for (const eid of entities) {
  const current = Temperature.current[eid];
  if (current === undefined) continue;
  const target = Temperature.target[eid] ?? current;
  const rate = Temperature.rate[eid] ?? 1;
  if (current !== target) {
    const diff = target - current;
    Temperature.current[eid] = current + Math.sign(diff) * Math.min(rate, Math.abs(diff));
    if (Temperature.current[eid] > 50) {
      ctx.emit("overheat", { entity: Name.value[eid], temp: Temperature.current[eid] });
    }
  }
}`,
      inputSchema: z.object({
        name: z.string().describe("PascalCase name for the system (e.g., 'NeedsDecay', 'SeekFood')"),
        description: z.string().describe("What the system does"),
        frequency: z.number().optional().describe("How often to run (1=every tick, 5=every 5 ticks). Default 1"),
        code: z.string().describe("The TypeScript code for the system body (inside the run function)"),
      }),
      execute: async (params) => {
        try {
          const filePath = await writeSystemFile({
            name: params.name,
            description: params.description,
            frequency: params.frequency ?? 1,
            code: params.code,
          });
          const loaded = await loadSystemFromFile(filePath);
          if (loaded) {
            state.fileSystems.push(loaded);
          }
          console.log(`[Tool] createSystem: ${params.name} -> ${filePath}`);
          return { 
            success: true, 
            result: { 
              name: params.name, 
              filePath,
              loaded: !!loaded,
            } 
          };
        } catch (error) {
          console.error(`[Tool] createSystem failed:`, error);
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    modifyFileSystem: tool({
      description: `Modify an existing file-based system. You can update its code, description, or frequency.

IMPORTANT: The 'code' parameter should be ONLY the function body (the code inside the run function), NOT the full file.
Do NOT include imports, exports, or function declarations - just the code that goes inside the run function.

Use getSystemCode first to see the current system implementation before modifying.`,
      inputSchema: z.object({
        systemName: z.string().describe("PascalCase name of the system to modify"),
        description: z.string().optional().describe("New description (keeps old if not provided)"),
        frequency: z.number().optional().describe("New frequency (keeps old if not provided)"),
        code: z.string().optional().describe("New code body ONLY - just the code inside the run function, no imports/exports"),
      }),
      execute: async (params) => {
        try {
          const updated = await updateSystemFile(params.systemName, {
            description: params.description,
            frequency: params.frequency,
            code: params.code,
          });
          if (!updated) {
            return { success: false, result: null, error: `System not found: ${params.systemName}` };
          }
          const idx = state.fileSystems.findIndex(s => s.name === params.systemName);
          if (idx >= 0) {
            state.fileSystems[idx] = updated;
          } else {
            state.fileSystems.push(updated);
          }
          console.log(`[Tool] modifyFileSystem: ${params.systemName}`);
          return { success: true, result: { name: params.systemName, updated: true } };
        } catch (error) {
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    deleteSystem: tool({
      description: "Delete a file-based system",
      inputSchema: z.object({
        systemName: z.string().describe("PascalCase name of the system to delete"),
      }),
      execute: async (params) => {
        const deleted = await deleteSystemFile(params.systemName);
        if (deleted) {
          state.fileSystems = state.fileSystems.filter(s => s.name !== params.systemName);
        }
        console.log(`[Tool] deleteSystem: ${params.systemName} -> ${deleted}`);
        return { success: deleted, result: { deleted: params.systemName } };
      },
    }),

    getSystemCode: tool({
      description: "Get the source code of a file-based system to review or modify it",
      inputSchema: z.object({
        systemName: z.string().describe("PascalCase name of the system"),
      }),
      execute: async (params) => {
        const source = await getSystemSource(params.systemName);
        if (!source) {
          return { success: false, result: null, error: `System not found: ${params.systemName}` };
        }
        return { success: true, result: { name: params.systemName, source } };
      },
    }),

    listFileSystems: tool({
      description: "List all file-based systems currently loaded",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          success: true,
          result: state.fileSystems.map(s => ({
            name: s.name,
            description: s.description,
            frequency: s.frequency,
            active: s.active,
          })),
        };
      },
    }),

    createComponent: tool({
      description: "Create a new custom component type that can be attached to entities",
      inputSchema: z.object({
        name: z.string().describe("PascalCase name for the component (e.g., 'Temperature', 'Mood')"),
        description: z.string().describe("What this component represents"),
        properties: z.record(z.enum(["number", "string", "boolean"])).describe("Property names and their types"),
      }),
      execute: async (params) => {
        try {
          const def: ComponentDefinition = {
            name: params.name,
            description: params.description,
            properties: params.properties,
          };
          createDynamicComponent(def);
          await saveComponentDefinition(def);
          console.log(`[Tool] createComponent: ${params.name}`);
          return { success: true, result: { name: params.name, properties: Object.keys(params.properties) } };
        } catch (error) {
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    setDynamicComponent: tool({
      description: "Set values on a dynamic (custom) component for an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.string().describe("Name of the dynamic component"),
        values: z.record(z.any()).describe("Property values to set"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        const component = getDynamicComponent(params.componentName);
        if (!component) {
          return { success: false, result: null, error: `Dynamic component not found: ${params.componentName}` };
        }
        for (const [key, value] of Object.entries(params.values)) {
          setDynamicComponentValue(params.componentName, eid, key, value);
        }
        console.log(`[Tool] setDynamicComponent: ${params.entityName}.${params.componentName}`);
        return { success: true, result: { entity: params.entityName, component: params.componentName, values: params.values } };
      },
    }),

    getDynamicComponentValues: tool({
      description: "Get the current values of a dynamic (custom) component for an entity. Use this to read back component state after systems have modified it.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.string().optional().describe("Name of specific component (omit to get all dynamic components)"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        
        if (params.componentName) {
          const values = getDynamicComponentValues(params.componentName, eid);
          if (!values) {
            return { success: false, result: null, error: `Component not found or not set: ${params.componentName}` };
          }
          console.log(`[Tool] getDynamicComponentValues: ${params.entityName}.${params.componentName}`);
          return { success: true, result: { entity: params.entityName, component: params.componentName, values } };
        } else {
          const allValues = getAllDynamicComponentValuesForEntity(eid);
          console.log(`[Tool] getDynamicComponentValues: ${params.entityName} (all components)`);
          return { success: true, result: { entity: params.entityName, components: allValues } };
        }
      },
    }),

    listComponents: tool({
      description: "List all available components (both built-in and custom/dynamic)",
      inputSchema: z.object({}),
      execute: async () => {
        const builtIn = Object.keys(AllComponents);
        const dynamic = listDynamicComponents();
        return {
          success: true,
          result: {
            builtIn,
            dynamic: dynamic.map(d => ({ name: d.name, description: d.description, properties: d.properties })),
          },
        };
      },
    }),

    createWorldMap: tool({
      description: "Create a grid-based ASCII world map for agents to move around in",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the map"),
        width: z.number().describe("Width of the map in tiles"),
        height: z.number().describe("Height of the map in tiles"),
        fill: z.string().optional().describe("Character to fill map with (default '.')"),
      }),
      execute: async (params) => {
        const result = state.tools.createWorldMap(params);
        console.log(`[Tool] createWorldMap: ${params.name} (${params.width}x${params.height})`);
        return result;
      },
    }),

    drawRoom: tool({
      description: "Draw a room with walls and floor on the ASCII map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("Top-left X coordinate"),
        y: z.number().describe("Top-left Y coordinate"),
        width: z.number().describe("Room width"),
        height: z.number().describe("Room height"),
        floor: z.string().optional().describe("Floor character (default '.')"),
        wall: z.string().optional().describe("Wall character (default '#')"),
      }),
      execute: async (params) => {
        const result = state.tools.drawRoom(params);
        console.log(`[Tool] drawRoom: at (${params.x},${params.y}) size ${params.width}x${params.height}`);
        return result;
      },
    }),

    drawDoor: tool({
      description: "Add a door (walkable) at a position on the map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      }),
      execute: async (params) => {
        const result = state.tools.drawDoor(params);
        console.log(`[Tool] drawDoor: at (${params.x},${params.y})`);
        return result;
      },
    }),

    drawPath: tool({
      description: "Draw a path/corridor between two points",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x1: z.number().describe("Start X"),
        y1: z.number().describe("Start Y"),
        x2: z.number().describe("End X"),
        y2: z.number().describe("End Y"),
        char: z.string().optional().describe("Path character (default '.')"),
      }),
      execute: async (params) => {
        const result = state.tools.drawPath(params);
        console.log(`[Tool] drawPath: (${params.x1},${params.y1}) to (${params.x2},${params.y2})`);
        return result;
      },
    }),

    fillArea: tool({
      description: "Fill a rectangular area with a tile character",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("Top-left X"),
        y: z.number().describe("Top-left Y"),
        width: z.number().describe("Area width"),
        height: z.number().describe("Area height"),
        char: z.string().describe("Character to fill with"),
      }),
      execute: async (params) => {
        const result = state.tools.fillArea(params);
        console.log(`[Tool] fillArea: (${params.x},${params.y}) ${params.width}x${params.height} with '${params.char}'`);
        return result;
      },
    }),

    setTile: tool({
      description: "Set a single tile on the map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        char: z.string().describe("Tile character"),
      }),
      execute: async (params) => {
        const result = state.tools.setTile(params);
        console.log(`[Tool] setTile: (${params.x},${params.y}) = '${params.char}'`);
        return result;
      },
    }),

    placeEntityOnGrid: tool({
      description: "Place an agent or entity on the ASCII grid map at a walkable position",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the agent/entity to place"),
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate (must be walkable)"),
        y: z.number().describe("Y coordinate (must be walkable)"),
        char: z.string().optional().describe("Display character (default '@')"),
        color: z.string().optional().describe("Display color (default '#ff6666')"),
        facing: z.string().optional().describe("Initial facing direction"),
      }),
      execute: async (params) => {
        const result = state.tools.placeEntityOnGrid(params);
        console.log(`[Tool] placeEntityOnGrid: ${params.entityName} at (${params.x},${params.y})`);
        return result;
      },
    }),

    moveEntityOnGrid: tool({
      description: "Move an entity one tile in a direction (north/south/east/west)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to move"),
        mapName: z.string().describe("Name of the map"),
        direction: z.enum(["north", "south", "east", "west"]).describe("Direction to move"),
      }),
      execute: async (params) => {
        const result = state.tools.moveEntityOnGrid(params);
        console.log(`[Tool] moveEntityOnGrid: ${params.entityName} ${params.direction}`);
        return result;
      },
    }),

    setEntitySprite: tool({
      description: "Change an entity's display character and color on the grid",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        char: z.string().describe("New display character"),
        color: z.string().optional().describe("New display color"),
      }),
      execute: async (params) => {
        const result = state.tools.setEntitySprite(params);
        console.log(`[Tool] setEntitySprite: ${params.entityName} = '${params.char}'`);
        return result;
      },
    }),

    getEntityPosition: tool({
      description: "Get the current grid position of an entity. Returns x, y coordinates and facing direction.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntityPosition(params);
        console.log(`[Tool] getEntityPosition: ${params.entityName}`);
        return result;
      },
    }),

    getEntitiesAtPosition: tool({
      description: "Get all entities at a specific grid position. Useful for checking what's at a location.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntitiesAtPosition(params);
        console.log(`[Tool] getEntitiesAtPosition: (${params.x}, ${params.y})`);
        return result;
      },
    }),

    getEntitiesInRadius: tool({
      description: "Get all entities within a radius of a position. Useful for area effects and proximity checks.",
      inputSchema: z.object({
        x: z.number().describe("Center X coordinate"),
        y: z.number().describe("Center Y coordinate"),
        radius: z.number().describe("Radius to search within"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntitiesInRadius(params);
        console.log(`[Tool] getEntitiesInRadius: (${params.x}, ${params.y}) r=${params.radius}`);
        return result;
      },
    }),

    checkCollision: tool({
      description: "Check if an entity can move in a direction. Returns whether the tile is walkable and any entities that would be collided with.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to check"),
        mapName: z.string().describe("Name of the map"),
        direction: z.enum(["north", "south", "east", "west"]).describe("Direction to check"),
      }),
      execute: async (params) => {
        const result = state.tools.checkCollision(params);
        console.log(`[Tool] checkCollision: ${params.entityName} ${params.direction}`);
        return result;
      },
    }),

    makePlan: tool({
      description: "Create a multi-step plan for achieving a complex goal. Use this to break down large tasks into manageable steps.",
      inputSchema: z.object({
        goal: z.string().describe("The overall goal to achieve"),
        steps: z.array(z.string()).describe("List of steps to accomplish the goal"),
      }),
      execute: async (params) => {
        const plan = createPlan(state, params.goal, params.steps);
        const firstStep = advancePlan(state);
        console.log(`[Tool] makePlan: "${params.goal}" (${params.steps.length} steps)`);
        return {
          success: true,
          result: {
            planId: plan.id,
            goal: plan.goal,
            totalSteps: plan.steps.length,
            currentStep: firstStep?.description ?? "Plan complete",
          },
        };
      },
    }),

    advancePlanStep: tool({
      description: "Mark the current plan step as complete and advance to the next step. Call this after completing each step of your plan.",
      inputSchema: z.object({
        result: z.string().optional().describe("Summary of what was accomplished in this step"),
      }),
      execute: async (params) => {
        const nextStep = advancePlan(state, params.result);
        const plan = getActivePlan(state);
        console.log(`[Tool] advancePlanStep: ${nextStep?.description ?? "Plan complete"}`);
        return {
          success: true,
          result: {
            planComplete: !plan,
            currentStep: nextStep?.description ?? null,
            stepsRemaining: plan?.steps.filter(s => s.status === "pending").length ?? 0,
          },
        };
      },
    }),

    getActivePlanStatus: tool({
      description: "Check the current status of your active plan",
      inputSchema: z.object({}),
      execute: async () => {
        const plan = getActivePlan(state);
        if (!plan) {
          return { success: true, result: { hasActivePlan: false } };
        }
        return {
          success: true,
          result: {
            hasActivePlan: true,
            goal: plan.goal,
            steps: plan.steps.map(s => ({
              description: s.description,
              status: s.status,
              result: s.result,
            })),
            completed: plan.steps.filter(s => s.status === "completed").length,
            total: plan.steps.length,
          },
        };
      },
    }),

    abandonCurrentPlan: tool({
      description: "Abandon the current plan if it's no longer relevant or achievable",
      inputSchema: z.object({
        reason: z.string().describe("Why the plan is being abandoned"),
      }),
      execute: async (params) => {
        abandonPlan(state, params.reason);
        console.log(`[Tool] abandonCurrentPlan: ${params.reason}`);
        return { success: true, result: { abandoned: true, reason: params.reason } };
      },
    }),

    recordMemory: tool({
      description: "Record an important observation, decision, or reflection for future reference",
      inputSchema: z.object({
        type: z.enum(["action", "observation", "decision", "reflection"]).describe("Type of memory"),
        content: z.string().describe("What to remember"),
        importance: z.number().min(1).max(10).optional().describe("How important (1-10, 7+ persists to long-term)"),
        relatedEntities: z.array(z.string()).optional().describe("Names of entities this relates to"),
        tags: z.array(z.string()).optional().describe("Tags for categorization"),
      }),
      execute: async (params) => {
        const memory = addMemory(state, params.type, params.content, {
          importance: params.importance,
          relatedEntities: params.relatedEntities,
          tags: params.tags,
        });
        console.log(`[Tool] recordMemory: [${params.type}] ${params.content.slice(0, 50)}...`);
        return { success: true, result: { memoryId: memory.id, stored: true } };
      },
    }),

    searchMemories: tool({
      description: "Search your memories for relevant past information",
      inputSchema: z.object({
        type: z.enum(["action", "observation", "decision", "reflection"]).optional().describe("Filter by memory type"),
        entityName: z.string().optional().describe("Filter by related entity name"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        minImportance: z.number().optional().describe("Minimum importance level"),
      }),
      execute: async (params) => {
        const memories = searchMemory(state, params);
        console.log(`[Tool] searchMemories: found ${memories.length} memories`);
        return {
          success: true,
          result: memories.slice(0, 20).map(m => ({
            type: m.type,
            content: m.content,
            importance: m.importance,
            relatedEntities: m.relatedEntities,
            tags: m.tags,
            age: `${Math.round((Date.now() - m.timestamp) / 1000)}s ago`,
          })),
        };
      },
    }),

    reflect: tool({
      description: "Take a moment to reflect on the current state and record insights. Use this to consolidate learnings.",
      inputSchema: z.object({
        reflection: z.string().describe("Your reflection or insight"),
      }),
      execute: async (params) => {
        const memory = addMemory(state, "reflection", params.reflection, {
          importance: 8,
          tags: ["reflection", "insight"],
        });
        console.log(`[Tool] reflect: ${params.reflection.slice(0, 50)}...`);
        return { success: true, result: { recorded: true, memoryId: memory.id } };
      },
    }),

    listAvailableSprites: tool({
      description: "List available sprite assets. Can filter by tag or search term.",
      inputSchema: z.object({
        tag: z.string().optional().describe("Filter by tag (e.g., 'character', 'animal', 'crop')"),
        search: z.string().optional().describe("Search term to find sprites"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.listAvailableSprites(params);
        console.log(`[Tool] listAvailableSprites`);
        return result;
      },
    }),

    getAvailableCharacters: tool({
      description: "List all available character sprites with their animations (walk, idle, actions)",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.renderingTools.getAvailableCharacters();
        console.log(`[Tool] getAvailableCharacters`);
        return result;
      },
    }),

    setupCharacterRig: tool({
      description: "Set up a character rig for an NPC that maps actions to animations. Once set up, the NPC's actions will automatically trigger appropriate animations.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to set up"),
        baseAtlas: z.string().describe("Base sprite atlas ID (e.g., 'farmer_1')"),
        actionAtlases: z.record(z.string()).optional().describe("Map action names to atlas IDs for action-specific sprites"),
        actionMappings: z.record(z.object({
          animation: z.string(),
          loop: z.boolean().optional(),
          speed: z.number().optional(),
        })).optional().describe("Map action names to animation config"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setupCharacterRig(params);
        console.log(`[Tool] setupCharacterRig: ${params.entityName}`);
        return result;
      },
    }),

    triggerCharacterAction: tool({
      description: "Trigger an action animation on a character with a rig. The character will play the mapped animation.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the character"),
        action: z.string().describe("Action to trigger (e.g., 'walk', 'chop', 'idle')"),
        direction: z.enum(["up", "down", "left", "right"]).optional().describe("Direction to face"),
        targetX: z.number().optional().describe("Target X position (auto-calculates direction)"),
        targetY: z.number().optional().describe("Target Y position (auto-calculates direction)"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.triggerCharacterAction(params);
        console.log(`[Tool] triggerCharacterAction: ${params.entityName} -> ${params.action}`);
        return result;
      },
    }),

    setCharacterIdleState: tool({
      description: "Set a character to idle animation",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the character"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setCharacterIdle(params);
        console.log(`[Tool] setCharacterIdle: ${params.entityName}`);
        return result;
      },
    }),

    listCharacterRigs: tool({
      description: "List all character rigs that have been set up",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.renderingTools.listCharacterRigs();
        console.log(`[Tool] listCharacterRigs`);
        return result;
      },
    }),

    setEntityPixiSprite: tool({
      description: "Assign a sprite from the registry to an entity for Pixi.js rendering",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        spriteName: z.string().describe("Sprite name (atlasId:frameId or just frameId)"),
        scaleX: z.number().optional().describe("X scale (default 1)"),
        scaleY: z.number().optional().describe("Y scale (default 1)"),
        tint: z.number().optional().describe("Color tint as hex (e.g., 0xff0000 for red)"),
        alpha: z.number().optional().describe("Opacity 0-1"),
        zIndex: z.number().optional().describe("Draw order"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setEntitySprite({
          entityName: params.entityName,
          spriteName: params.spriteName,
          options: {
            scaleX: params.scaleX,
            scaleY: params.scaleY,
            tint: params.tint,
            alpha: params.alpha,
            zIndex: params.zIndex,
          },
        });
        console.log(`[Tool] setEntityPixiSprite: ${params.entityName} -> ${params.spriteName}`);
        return result;
      },
    }),

    setEntityAnimation: tool({
      description: "Set an entity to play a specific animation",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        atlasId: z.string().describe("Atlas containing the animation"),
        animationId: z.string().describe("Animation ID (e.g., 'walk_down', 'chop_left')"),
        speed: z.number().optional().describe("Playback speed multiplier"),
        loop: z.boolean().optional().describe("Whether to loop"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setEntityAnimation({
          entityName: params.entityName,
          atlasId: params.atlasId,
          animationId: params.animationId,
          options: { speed: params.speed, loop: params.loop },
        });
        console.log(`[Tool] setEntityAnimation: ${params.entityName} -> ${params.animationId}`);
        return result;
      },
    }),

    listAnimations: tool({
      description: "List available animations, optionally filtered by atlas or tag",
      inputSchema: z.object({
        atlasId: z.string().optional().describe("Filter by atlas ID"),
        tag: z.string().optional().describe("Filter by tag"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.listAnimations(params);
        console.log(`[Tool] listAnimations`);
        return result;
      },
    }),

    describeEntityAppearance: tool({
      description: "Get detailed info about an entity's current visual state (sprite, animation, position)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.describeEntityAppearance(params);
        console.log(`[Tool] describeEntityAppearance: ${params.entityName}`);
        return result;
      },
    }),

    getVisibleEntities: tool({
      description: "Get entities visible from a viewer's position within a radius",
      inputSchema: z.object({
        viewerName: z.string().describe("Name of the viewing entity"),
        radius: z.number().optional().describe("View radius (default 10)"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.getVisibleEntities(params);
        console.log(`[Tool] getVisibleEntities: from ${params.viewerName}`);
        return result;
      },
    }),
  };
}

export async function godThink(state: GodAgentState, prompt: string): Promise<{ thinking: string; actions: ToolResult[] }> {
  const systemPrompt = buildSystemPrompt(state);
  const tools = buildTools(state);

  console.log("\n[GodAgent] Thinking...\n");
  console.log("[GodAgent] Prompt:", prompt.slice(0, 100) + "...");

  const actions: ToolResult[] = [];
  let thinking = "";

  try {
    console.log("[GodAgent] Calling Gemini...");
    
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...state.conversationHistory.slice(-10).map(h => ({
        role: h.role as "user" | "assistant",
        content: h.content
      })),
      { role: "user" as const, content: prompt }
    ];

    const response = await generateText({
      model,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(15)
    });
    console.log("[GodAgent] Gemini response received");

    if (response.reasoningText) {
      thinking = response.reasoningText;
      console.log("[GodAgent] Reasoning:", response.reasoningText.slice(0, 500) + "...");
    }

    if (response.text) {
      thinking += "\n\n" + response.text;
      console.log("[GodAgent] Response:", response.text);
    }

    if (response.steps) {
      for (const step of response.steps) {
        if (step.toolCalls) {
          for (const tc of step.toolCalls) {
            if (step.toolResults) {
              const result = step.toolResults.find((r: any) => r.toolCallId === tc.toolCallId);
              if (result) {
                actions.push(result.output as ToolResult);
                const toolResult = result.output as ToolResult;
                if (toolResult.success && !["recordMemory", "searchMemories", "reflect", "makePlan", "advancePlanStep", "getActivePlanStatus", "abandonCurrentPlan"].includes(tc.toolName)) {
                  addMemory(state, "action", `${tc.toolName}: ${JSON.stringify((tc as any).input).slice(0, 100)}`, {
                    importance: 5,
                    tags: ["tool", tc.toolName],
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("[GodAgent] Error:", error);
    thinking = `Error: ${error}`;
    addMemory(state, "observation", `Error occurred: ${error}`, {
      importance: 8,
      tags: ["error"],
    });
  }

  addMemory(state, "observation", `User request: ${prompt.slice(0, 200)}`, {
    importance: 6,
    tags: ["user-request"],
  });

  state.conversationHistory.push({ role: "user", content: prompt });
  state.conversationHistory.push({ role: "assistant", content: thinking });
  state.thinkingLog.push(thinking);

  GodAgent.tick[state.eid]++;

  return { thinking, actions };
}

export async function godCommand(state: GodAgentState, command: string): Promise<ToolResult[]> {
  const { actions } = await godThink(state, command);
  return actions;
}

export function tickWorld(state: GodAgentState, delta: number = 1000): Array<{ type: string; data: any; timestamp: number }> {
  state.tick++;
  runSystems(state.world, state.systemRegistry, state.tick, delta);
  runAsyncSystems(state.world, state.systemRegistry, state.tick, delta);
  return consumeEvents(state.systemRegistry);
}

export function getWorldState(state: GodAgentState): string {
  const entities = state.tools.listEntities().result as Array<{ name: string; id: number }>;
  const systems = listSystems(state.systemRegistry);
  
  const lines = ["WORLD STATE:", ""];

  lines.push("SYSTEMS:");
  for (const sys of systems) {
    lines.push(`  ${sys.active ? '▶' : '⏸'} ${sys.name} (${sys.frequency}ms): ${sys.description}`);
  }
  lines.push("");

  lines.push("ENTITIES:");
  for (const entity of entities) {
    lines.push(`[${entity.name}] (id: ${entity.id})`);
    
    for (const compName of Object.keys(AllComponents)) {
      const values = state.tools.getComponentValues({
        entityName: entity.name,
        componentName: compName,
      });
      if (values.success && values.result && Object.keys(values.result).length > 0) {
        const nonEmpty = Object.fromEntries(
          Object.entries(values.result).filter(([_, v]) => v !== undefined && v !== "" && v !== 0)
        );
        if (Object.keys(nonEmpty).length > 0) {
          lines.push(`  ${compName}: ${JSON.stringify(nonEmpty)}`);
        }
      }
    }
    
    for (const relName of Object.keys(AllRelations)) {
      const targets = state.tools.getRelationTargets({
        subjectName: entity.name,
        relationName: relName,
      });
      if (targets.success && targets.result.targets.length > 0) {
        lines.push(`  --[${relName}]--> ${targets.result.targets.join(", ")}`);
      }
    }
    
    lines.push("");
  }
  
  return lines.join("\n");
}
