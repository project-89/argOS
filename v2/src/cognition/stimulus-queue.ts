import type { World } from "../ecs/world";
import { query } from "bitecs";
import { Agent, Name } from "../ecs/components";
import { getRoomForEntity } from "../ecs/location";

export type SensoryModality =
  | "visual"
  | "auditory"
  | "olfactory"
  | "tactile"
  | "cognitive";

export interface PendingStimulus {
  targetEid: number;
  type: string;
  content: string;
  source: string;
  modality?: SensoryModality;
  intensity?: number;
}

const pendingStimuli: PendingStimulus[] = [];

export function queueStimulus(stimulus: PendingStimulus): void {
  pendingStimuli.push(stimulus);
}

export function drainPendingStimuli(): PendingStimulus[] {
  return pendingStimuli.splice(0, pendingStimuli.length);
}

export function queueStimulusForAgent(
  world: World,
  agentName: string,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality }
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (Name.value[eid] === agentName) {
      queueStimulus({ targetEid: eid, ...stimulus });
      return;
    }
  }
}

export function broadcastToRoom(
  world: World,
  roomEid: number,
  stimulus: { type: string; content: string; source: string; modality?: SensoryModality; intensity?: number },
  excludeEid?: number
): void {
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (excludeEid !== undefined && eid === excludeEid) continue;
    if (getRoomForEntity(world, eid) !== roomEid) continue;
    queueStimulus({ targetEid: eid, ...stimulus });
  }
}

