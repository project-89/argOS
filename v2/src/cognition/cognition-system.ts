import type { World } from "../ecs/world";
import type { SystemDefinition, SystemContext, SystemRegistry } from "../ecs/dynamic-systems";
import { query, getRelationTargets } from "bitecs";
import { Name, Agent, Mind } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { 
  processAgentCognition, 
  addPerception, 
  getAgentMemory,
  type AgentAction 
} from "./agent-mind";
import { extractKnowledgeFromInteraction } from "./knowledge-graph";

export interface PendingStimulus {
  targetEid: number;
  type: string;
  content: string;
  source: string;
}

const pendingStimuli: PendingStimulus[] = [];
const pendingActions: Array<{ eid: number; action: AgentAction }> = [];

export function queueStimulus(stimulus: PendingStimulus): void {
  pendingStimuli.push(stimulus);
}

export function queueStimulusForAgent(
  world: World,
  agentName: string,
  stimulus: { type: string; content: string; source: string }
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (Name.value[eid] === agentName) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
      return;
    }
  }
}

export function broadcastToRoom(
  world: World,
  roomEid: number,
  stimulus: { type: string; content: string; source: string },
  excludeEid?: number
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (eid === excludeEid) continue;
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    if (rooms.includes(roomEid)) {
      pendingStimuli.push({ targetEid: eid, ...stimulus });
    }
  }
}

export async function runCognitionCycle(
  world: World,
  registry: SystemRegistry
): Promise<Array<{ eid: number; action: AgentAction }>> {
  const stimuliByAgent = new Map<number, PendingStimulus[]>();
  
  for (const stimulus of pendingStimuli) {
    if (!stimuliByAgent.has(stimulus.targetEid)) {
      stimuliByAgent.set(stimulus.targetEid, []);
    }
    stimuliByAgent.get(stimulus.targetEid)!.push(stimulus);
  }
  pendingStimuli.length = 0;

  const activeAgents = Array.from(query(world, [Agent, Mind])).filter(
    eid => Agent.active[eid]
  );

  const results: Array<{ eid: number; action: AgentAction }> = [];

  for (const eid of activeAgents) {
    const stimuli = stimuliByAgent.get(eid) || [];
    
    const action = await processAgentCognition(
      world,
      eid,
      stimuli.map(s => ({ type: s.type, content: s.content, source: s.source }))
    );
    results.push({ eid, action });
  }

  return results;
}

export function executeActions(
  world: World,
  actions: Array<{ eid: number; action: AgentAction }>,
  registry: SystemRegistry
): void {
  for (const { eid, action } of actions) {
    const name = Name.value[eid];
    const rooms = getRelationTargets(world, eid, OccupiesRoom);
    const roomEid = rooms[0];

    switch (action.type) {
      case "speak":
        if (action.content && roomEid !== undefined) {
          broadcastToRoom(world, roomEid, {
            type: "speech",
            content: `${name} says: "${action.content}"`,
            source: name,
          }, eid);
          console.log(`💬 ${name}: "${action.content}"`);
          
          extractKnowledgeFromInteraction(world, eid, {
            type: "speech",
            content: action.content,
            context: `Speaking in ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "observe":
        if (action.target) {
          Mind.focus[eid] = action.target;
          console.log(`👁️ ${name} observes ${action.target}`);
          
          extractKnowledgeFromInteraction(world, eid, {
            type: "observation",
            content: `Observing ${action.target}`,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "think":
        if (action.content) {
          console.log(`💭 ${name} thinks: "${action.content}"`);
        }
        break;

      case "interact":
        if (action.target && action.content && roomEid !== undefined) {
          broadcastToRoom(world, roomEid, {
            type: "action",
            content: `${name} ${action.content} (with ${action.target})`,
            source: name,
          }, eid);
          console.log(`🤚 ${name} ${action.content} (${action.target})`);
          
          extractKnowledgeFromInteraction(world, eid, {
            type: "interaction",
            content: action.content,
            otherParty: action.target,
            context: `In ${Name.value[roomEid] || "a room"}`,
          }).catch(() => {});
        }
        break;

      case "wait":
        break;
    }
  }
}

export function createCognitionSystem(): SystemDefinition {
  return {
    name: "AgentCognition",
    description: "Processes agent perception, thinking, and action selection",
    pseudocode: "For each active agent with stimuli or high arousal: think and act",
    frequency: 10000,
    active: true,
    lastRun: 0,
    compiledFn: undefined,
  };
}
