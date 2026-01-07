import type { World } from "./world";
import { query, hasComponent, getRelationTargets, addEntity, addComponent, removeEntity } from "bitecs";
import { AllComponents, Name, Agent, Mind, StimulusSource, Stimulus, WorldMap, GridPosition, Goal, Memory, Belief, Thought, Impression } from "./components";
import { AllRelations, OccupiesRoom, HasGoal, HasMemory, HasBelief, HasThought, HasImpression } from "./relations";
import { createAIContext, type AIContext } from "../ai/ai-context";
import { moveEntity, isWalkable, getTile } from "../world/ascii-world";

export interface SystemDefinition {
  name: string;
  description: string;
  pseudocode: string;
  frequency: number;
  active: boolean;
  lastRun: number;
  code?: string;
  compiledFn?: (world: World, context: SystemContext) => void | Promise<void>;
  async?: boolean;
  running?: boolean;
}

export interface GridContext {
  moveEntity: (world: World, mapEid: number, eid: number, dx: number, dy: number) => boolean;
  isWalkable: (world: World, mapEid: number, x: number, y: number) => boolean;
  getTile: (world: World, mapEid: number, x: number, y: number) => string;
  getMapByName: (world: World, name: string) => number | undefined;
}

export interface GoalData {
  description: string;
  priority?: number;
  status?: string;
  progress?: number;
  deadline?: number;
}

export interface MemoryData {
  type: "episodic" | "semantic" | "procedural";
  content: string;
  emotionalValence?: number;
  importance?: number;
}

export interface BeliefData {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  source?: string;
}

export interface ThoughtData {
  content: string;
  type?: string;
  salience?: number;
}

export interface ImpressionData {
  targetName: string;
  trait: string;
  valence: number;
  confidence?: number;
  basis?: string;
}

export interface CognitiveContext {
  createGoal: (world: World, agentEid: number, data: GoalData) => number;
  createMemory: (world: World, agentEid: number, data: MemoryData) => number;
  createBelief: (world: World, agentEid: number, data: BeliefData) => number;
  createThought: (world: World, agentEid: number, data: ThoughtData) => number;
  createImpression: (world: World, agentEid: number, data: ImpressionData) => number;
  getGoals: (world: World, agentEid: number) => Array<{ eid: number; data: GoalData }>;
  getMemories: (world: World, agentEid: number) => Array<{ eid: number; data: MemoryData }>;
  getBeliefs: (world: World, agentEid: number) => Array<{ eid: number; data: BeliefData }>;
  updateGoal: (eid: number, updates: Partial<GoalData>) => void;
  completeGoal: (world: World, eid: number) => void;
  removeGoal: (world: World, eid: number) => void;
}

export interface SystemContext {
  tick: number;
  delta: number;
  elapsed: number;
  emit: (type: string, data: any) => void;
  log: (message: string) => void;
  query: typeof query;
  hasComponent: typeof hasComponent;
  getRelationTargets: typeof getRelationTargets;
  addEntity: typeof addEntity;
  addComponent: typeof addComponent;
  removeEntity: typeof removeEntity;
  components: typeof AllComponents;
  relations: typeof AllRelations;
  ai: AIContext;
  grid: GridContext;
  cognitive: CognitiveContext;
}

export interface SystemRegistry {
  systems: Map<string, SystemDefinition>;
  events: Array<{ type: string; data: any; timestamp: number }>;
  logs: string[];
}

export function createSystemRegistry(): SystemRegistry {
  return {
    systems: new Map(),
    events: [],
    logs: [],
  };
}

export function registerSystem(registry: SystemRegistry, definition: SystemDefinition): void {
  registry.systems.set(definition.name, definition);
}

export function unregisterSystem(registry: SystemRegistry, name: string): void {
  registry.systems.delete(name);
}

export function getSystem(registry: SystemRegistry, name: string): SystemDefinition | undefined {
  return registry.systems.get(name);
}

export function listSystems(registry: SystemRegistry): SystemDefinition[] {
  return Array.from(registry.systems.values());
}

export function activateSystem(registry: SystemRegistry, name: string): boolean {
  const system = registry.systems.get(name);
  if (system) {
    system.active = true;
    return true;
  }
  return false;
}

export function deactivateSystem(registry: SystemRegistry, name: string): boolean {
  const system = registry.systems.get(name);
  if (system) {
    system.active = false;
    return true;
  }
  return false;
}

const sharedAIContext = createAIContext();

function createGridContext(): GridContext {
  return {
    moveEntity,
    isWalkable,
    getTile,
    getMapByName: (world: World, name: string): number | undefined => {
      const maps = Array.from(query(world, [WorldMap]));
      for (const mapEid of maps) {
        if (WorldMap.name[mapEid] === name || Name.value[mapEid] === name) {
          return mapEid;
        }
      }
      return undefined;
    },
  };
}

const sharedGridContext = createGridContext();

function createCognitiveContext(): CognitiveContext {
  return {
    createGoal: (world: World, agentEid: number, data: GoalData): number => {
      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agentEid, HasGoal(goalEid));
      Goal.description[goalEid] = data.description;
      Goal.priority[goalEid] = data.priority ?? 5;
      Goal.status[goalEid] = data.status ?? "active";
      Goal.progress[goalEid] = data.progress ?? 0;
      Goal.deadline[goalEid] = data.deadline ?? 0;
      return goalEid;
    },
    createMemory: (world: World, agentEid: number, data: MemoryData): number => {
      const memEid = addEntity(world);
      addComponent(world, memEid, Memory);
      addComponent(world, agentEid, HasMemory(memEid));
      Memory.type[memEid] = data.type;
      Memory.content[memEid] = data.content;
      Memory.emotionalValence[memEid] = data.emotionalValence ?? 0;
      Memory.importance[memEid] = data.importance ?? 0.5;
      Memory.timestamp[memEid] = Date.now();
      Memory.lastRecalled[memEid] = Date.now();
      Memory.recallCount[memEid] = 0;
      return memEid;
    },
    createBelief: (world: World, agentEid: number, data: BeliefData): number => {
      const beliefEid = addEntity(world);
      addComponent(world, beliefEid, Belief);
      addComponent(world, agentEid, HasBelief(beliefEid));
      Belief.subject[beliefEid] = data.subject;
      Belief.predicate[beliefEid] = data.predicate;
      Belief.object[beliefEid] = data.object;
      Belief.confidence[beliefEid] = data.confidence ?? 0.5;
      Belief.source[beliefEid] = data.source ?? "observation";
      Belief.timestamp[beliefEid] = Date.now();
      return beliefEid;
    },
    createThought: (world: World, agentEid: number, data: ThoughtData): number => {
      const thoughtEid = addEntity(world);
      addComponent(world, thoughtEid, Thought);
      addComponent(world, agentEid, HasThought(thoughtEid));
      Thought.content[thoughtEid] = data.content;
      Thought.type[thoughtEid] = data.type ?? "reflection";
      Thought.salience[thoughtEid] = data.salience ?? 0.5;
      Thought.timestamp[thoughtEid] = Date.now();
      return thoughtEid;
    },
    createImpression: (world: World, agentEid: number, data: ImpressionData): number => {
      const impEid = addEntity(world);
      addComponent(world, impEid, Impression);
      addComponent(world, agentEid, HasImpression(impEid));
      Impression.targetName[impEid] = data.targetName;
      Impression.trait[impEid] = data.trait;
      Impression.valence[impEid] = data.valence;
      Impression.confidence[impEid] = data.confidence ?? 0.5;
      Impression.basis[impEid] = data.basis ?? "observation";
      return impEid;
    },
    getGoals: (world: World, agentEid: number): Array<{ eid: number; data: GoalData }> => {
      const targets = getRelationTargets(world, agentEid, HasGoal);
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
    getMemories: (world: World, agentEid: number): Array<{ eid: number; data: MemoryData }> => {
      const targets = getRelationTargets(world, agentEid, HasMemory);
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
    getBeliefs: (world: World, agentEid: number): Array<{ eid: number; data: BeliefData }> => {
      const targets = getRelationTargets(world, agentEid, HasBelief);
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
    completeGoal: (world: World, eid: number): void => {
      Goal.status[eid] = "completed";
      Goal.progress[eid] = 100;
    },
    removeGoal: (world: World, eid: number): void => {
      removeEntity(world, eid);
    },
  };
}

const sharedCognitiveContext = createCognitiveContext();

function createSystemContext(world: World, registry: SystemRegistry, tick: number, delta: number): SystemContext {
  return {
    tick,
    delta,
    elapsed: tick * delta,
    emit: (type, data) => {
      registry.events.push({ type, data, timestamp: Date.now() });
    },
    log: (message) => {
      registry.logs.push(`[${tick}] ${message}`);
      console.log(`[System] ${message}`);
    },
    query,
    hasComponent,
    getRelationTargets,
    addEntity,
    addComponent,
    removeEntity,
    components: AllComponents,
    relations: AllRelations,
    ai: sharedAIContext,
    grid: sharedGridContext,
    cognitive: sharedCognitiveContext,
  };
}

export function runSystems(world: World, registry: SystemRegistry, tick: number, delta: number): void {
  const context = createSystemContext(world, registry, tick, delta);
  const now = Date.now();

  for (const system of registry.systems.values()) {
    if (!system.active) continue;
    if (now - system.lastRun < system.frequency) continue;
    if (system.async) continue;

    try {
      if (system.compiledFn) {
        system.compiledFn(world, context);
        system.lastRun = now;
      }
    } catch (error) {
      context.log(`Error in system ${system.name}: ${error}`);
    }
  }
}

export function runAsyncSystems(world: World, registry: SystemRegistry, tick: number, delta: number): void {
  const context = createSystemContext(world, registry, tick, delta);
  const now = Date.now();

  for (const system of registry.systems.values()) {
    if (!system.active) continue;
    if (!system.async) continue;
    if (system.running) continue;
    if (now - system.lastRun < system.frequency) continue;

    if (system.compiledFn) {
      system.running = true;
      system.lastRun = now;
      
      Promise.resolve(system.compiledFn(world, context))
        .then(() => {
          system.running = false;
        })
        .catch((error) => {
          context.log(`Error in async system ${system.name}: ${error}`);
          system.running = false;
        });
    }
  }
}

export function consumeEvents(registry: SystemRegistry): Array<{ type: string; data: any; timestamp: number }> {
  const events = [...registry.events];
  registry.events = [];
  return events;
}

export function consumeLogs(registry: SystemRegistry): string[] {
  const logs = [...registry.logs];
  registry.logs = [];
  return logs;
}

export function compileSystem(pseudocode: string, definition: SystemDefinition): SystemDefinition {
  const fn = createSystemFunction(pseudocode, definition);
  return {
    ...definition,
    compiledFn: fn,
  };
}

function createSystemFunction(pseudocode: string, definition: SystemDefinition): (world: World, ctx: SystemContext) => void {
  const lines = pseudocode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  return (world: World, ctx: SystemContext) => {
    for (const line of lines) {
      try {
        interpretLine(line, world, ctx);
      } catch (e) {
        ctx.log(`Error interpreting: ${line} - ${e}`);
      }
    }
  };
}

function interpretLine(line: string, world: World, ctx: SystemContext): void {
  if (line.startsWith('//') || line.startsWith('#')) return;

  if (line.startsWith('LOG ')) {
    ctx.log(line.slice(4));
    return;
  }

  if (line.startsWith('EMIT ')) {
    const match = line.match(/EMIT\s+(\w+)\s*:\s*(.+)/);
    if (match) {
      ctx.emit(match[1], JSON.parse(match[2]));
    }
    return;
  }

  if (line.startsWith('FOR_EACH ')) {
    return;
  }
}

export const BUILTIN_SYSTEMS: Record<string, Omit<SystemDefinition, 'lastRun'>> = {
  StimulusEmission: {
    name: "StimulusEmission",
    description: "Emits stimuli from StimulusSource entities to agents in the same room",
    pseudocode: `
      FOR_EACH entity WITH StimulusSource, OccupiesRoom(room):
        IF now - lastEmit > interval:
          FOR_EACH agent WITH Agent, OccupiesRoom(room):
            EMIT stimulus: { type, content: template, source: entity.name, target: agent }
          SET lastEmit = now
    `,
    frequency: 1000,
    active: true,
  },

  MindDecay: {
    name: "MindDecay",
    description: "Gradually reduces arousal levels of agents over time",
    pseudocode: `
      FOR_EACH entity WITH Mind:
        IF arousal > 0.3:
          SET arousal = arousal - 0.01
    `,
    frequency: 5000,
    active: true,
  },

  AttentionShift: {
    name: "AttentionShift",
    description: "Agents may shift focus based on stimuli and events",
    pseudocode: `
      FOR_EACH entity WITH Agent, Mind:
        IF focus == "" AND arousal > 0.5:
          QUERY nearby entities
          SET focus = most_salient_entity
    `,
    frequency: 3000,
    active: false,
  },
};

export function createStimulusEmissionSystem(): SystemDefinition {
  return {
    name: "StimulusEmission",
    description: "Emits stimuli from StimulusSource entities to agents in the same room",
    pseudocode: "FOR_EACH StimulusSource: emit to agents in same room",
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const sources = Array.from(ctx.query(world, [StimulusSource]));
      const now = Date.now();

      for (const sourceEid of sources) {
        const interval = StimulusSource.interval[sourceEid];
        const lastEmit = StimulusSource.lastEmit[sourceEid];

        if (now - lastEmit < interval) continue;

        const stimulusType = StimulusSource.stimulusType[sourceEid];
        const template = StimulusSource.template[sourceEid];
        const sourceName = Name.value[sourceEid];

        const roomTargets = ctx.getRelationTargets(world, sourceEid, OccupiesRoom);
        if (roomTargets.length === 0) continue;

        const roomEid = roomTargets[0];
        const roomName = Name.value[roomEid];

        const agents = Array.from(ctx.query(world, [Agent]));
        for (const agentEid of agents) {
          const agentRooms = ctx.getRelationTargets(world, agentEid, OccupiesRoom);
          if (agentRooms.includes(roomEid)) {
            const agentName = Name.value[agentEid];
            ctx.emit("stimulus", {
              type: stimulusType,
              content: template,
              source: sourceName,
              target: agentName,
              room: roomName,
            });
            ctx.log(`${sourceName} -> ${agentName}: "${template.slice(0, 50)}..."`);
          }
        }

        StimulusSource.lastEmit[sourceEid] = now;
      }
    },
  };
}

export function createMindDecaySystem(): SystemDefinition {
  return {
    name: "MindDecay",
    description: "Gradually normalizes arousal levels over time",
    pseudocode: "FOR_EACH Mind: arousal tends toward 0.5",
    frequency: 5000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const minds = Array.from(ctx.query(world, [Mind]));

      for (const eid of minds) {
        const current = Mind.arousal[eid];
        const target = 0.5;
        const decay = 0.02;

        if (current > target + decay) {
          Mind.arousal[eid] = current - decay;
        } else if (current < target - decay) {
          Mind.arousal[eid] = current + decay;
        }
      }
    },
  };
}
