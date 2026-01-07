import type { 
  MindState, 
  KnowledgeGraph, 
  Stimulus, 
  Action, 
  AttentionState, 
  CognitiveMode,
  CognitiveEvent 
} from "./types";

export interface AgentData {
  name: string;
  role: string;
  systemPrompt: string;
  active: boolean;
  roomId?: string;
  mind: {
    stream: CognitiveEvent[];
    attention: AttentionState;
    arousal: number;
    mode: CognitiveMode;
    lastUpdate: number;
  };
  knowledge: KnowledgeGraph;
  stimuli: {
    pending: Stimulus[];
    processed: Stimulus[];
  };
  actions: {
    pending: Action[];
    executing: Action | null;
    completed: Action[];
  };
}

export interface ArgosWorld {
  agents: Map<number, AgentData>;
  nextEntityId: number;
}

export function createArgosWorld(): ArgosWorld {
  return {
    agents: new Map(),
    nextEntityId: 1,
  };
}

export function createAgent(
  world: ArgosWorld,
  config: {
    name: string;
    role: string;
    systemPrompt: string;
    roomId?: string;
  }
): number {
  const eid = world.nextEntityId++;

  const agent: AgentData = {
    name: config.name,
    role: config.role,
    systemPrompt: config.systemPrompt,
    active: true,
    roomId: config.roomId,
    mind: {
      stream: [],
      attention: {
        focus: null,
        filters: [],
        capacity: 7,
        saturation: 0,
      },
      arousal: 0.5,
      mode: "reactive",
      lastUpdate: Date.now(),
    },
    knowledge: {
      nodes: {},
      edges: {},
      nodeTypes: {
        concept: { schema: { name: "string", description: "string" } },
        belief: { schema: { subject: "string", predicate: "string", object: "string" } },
        memory: { schema: { content: "string", emotion: "string", importance: "number" } },
        goal: { schema: { description: "string", priority: "number", status: "string" } },
        agent: { schema: { name: "string", relationship: "string" } },
      },
      edgeTypes: {
        relates_to: { schema: {} },
        causes: { schema: {} },
        supports: { schema: { strength: "number" } },
        contradicts: { schema: { strength: "number" } },
        part_of: { schema: {} },
        instance_of: { schema: {} },
      },
    },
    stimuli: {
      pending: [],
      processed: [],
    },
    actions: {
      pending: [],
      executing: null,
      completed: [],
    },
  };

  world.agents.set(eid, agent);
  return eid;
}

export function getAgent(world: ArgosWorld, eid: number): AgentData | undefined {
  return world.agents.get(eid);
}

export function getAgentIds(world: ArgosWorld): number[] {
  return Array.from(world.agents.keys());
}

export function isAgentActive(world: ArgosWorld, eid: number): boolean {
  return world.agents.get(eid)?.active ?? false;
}

export function removeAgent(world: ArgosWorld, eid: number): void {
  world.agents.delete(eid);
}
