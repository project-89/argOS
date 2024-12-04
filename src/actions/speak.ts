import { z } from "zod";
import { World } from "../types/bitecs";
import { Memory, Room, Agent } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { getAgentRoom } from "../utils/queries";
import {
  createVisualStimulus,
  createAuditoryStimulus,
} from "../utils/stimulus-utils";

export const schema = z.object({
  message: z.string(),
  tone: z
    .enum([
      "neutral",
      "gentle",
      "firm",
      "concerned",
      "excited",
      "nervous",
      "thoughtful",
      "curious",
      "worried",
      "confident",
      "hesitant",
      "urgent",
    ])
    .optional(),
  target: z.string().optional(),
});

export const action = {
  name: "speak",
  description: "Say something to others in the room",
  parameters: ["message", "tone", "target"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>
) {
  const roomId = getAgentRoom(world, eid);
  if (!roomId) return;

  const { message, tone = "neutral", target } = parameters;

  // Log the speech with agent name
  const agentName = Agent.name[eid];

  logger.agent(eid, `Says: ${message}`);

  // Create visual stimulus for speaking action
  createVisualStimulus(world, {
    sourceEntity: eid,
    roomId: Room.id[roomId],
    appearance: true,
    data: {
      action: "speaking",
      target,
      tone,
      message,
      agentId: eid,
      agentName,
      actionType: "SPEECH",
    },
    decay: 1,
  });

  // Create auditory stimulus for the speech content
  createAuditoryStimulus(world, {
    sourceEntity: eid,
    roomId: Room.id[roomId],
    message,
    tone,
  });

  // Record the experience
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "speech",
    content: `I said: "${message}"`,
    timestamp: Date.now(),
  });
}
