import { z } from "zod";
import { World } from "../types/bitecs";
import { Memory, Room, Agent } from "../components/agent/Agent";
import { getAgentRoom } from "../utils/queries";
import { logger } from "../utils/logger";
import {
  createCognitiveStimulus,
  createVisualStimulus,
} from "../utils/stimulus-utils";
import { EventBus } from "../runtime/EventBus";

export const schema = z.object({
  reason: z.string(),
  isThinking: z.boolean().default(false),
});

export const action = {
  name: "wait",
  description: "Choose to wait, either to listen or process information",
  parameters: ["reason", "isThinking"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const roomId = getAgentRoom(world, eid);
  if (roomId === undefined) return;

  const { reason, isThinking = false } = parameters;
  const agentName = Agent.name[eid];

  logger.agent(
    eid,
    isThinking ? `Processing: ${reason}` : `Waiting: ${reason}`
  );

  // Emit wait event to room
  eventBus.emitRoomEvent(
    roomId,
    "action",
    {
      action: isThinking ? "thinking" : "waiting",
      reason,
      agentName,
    },
    String(eid)
  );

  // Create visual stimulus for the action
  createVisualStimulus(world, {
    sourceEntity: eid,
    roomId: Room.id[roomId],
    appearance: true,
    data: {
      action: isThinking ? "thinking" : "waiting",
      reason,
      cognitiveState: {
        isThinking,
        focus: isThinking ? "processing information" : "listening",
      },
      agentId: eid,
      agentName,
      actionType: "WAIT",
    },
    decay: isThinking ? 2 : 1,
  });

  // Record the experience
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "action",
    content: `I ${isThinking ? "thought about" : "waited for"}: ${reason}`,
    timestamp: Date.now(),
  });
}
