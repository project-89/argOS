import { z } from "zod";
import { World } from "../types/bitecs";
import { Memory, Room, Agent } from "../components/agent/Agent";
import { findAgentRoom } from "../utils/world-utils";
import { logger } from "../utils/logger";
import {
  createCognitiveStimulus,
  createVisualStimulus,
} from "../utils/stimulus-utils";

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
  parameters: z.infer<typeof schema>
) {
  const roomId = findAgentRoom(world, eid);
  if (roomId === null) return;

  const { reason, isThinking = false } = parameters;
  const agentName = Agent.name[eid];

  // Log the action
  logger.agent(
    eid,
    isThinking ? `Processing: ${reason}` : `Waiting: ${reason}`
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

  // If thinking, create cognitive stimulus
  if (isThinking) {
    createCognitiveStimulus(world, {
      sourceEntity: eid,
      roomId: Room.id[roomId],
      activity: "processing",
      focus: reason,
      intensity: "deep",
    });
  }

  // Record the experience
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "action",
    content: `I ${isThinking ? "thought about" : "waited for"}: ${reason}`,
    timestamp: Date.now(),
  });
}
