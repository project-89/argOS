import { z } from "zod";
import { World } from "../types/bitecs";
import { Memory, Room, Agent } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { getAgentRoom } from "../utils/queries";
import { EventBus } from "../runtime/EventBus";

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
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const roomId = getAgentRoom(world, eid);
  if (!roomId) return;

  const { message, tone = "neutral", target } = parameters;
  const agentName = Agent.name[eid];

  logger.agent(eid, `Says: ${message}`);

  // Emit speech event to room
  eventBus.emitRoomEvent(roomId, "speech", message, String(eid));

  const experience = `I said: "${message}"`;

  // Record the experience
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  Memory.experiences[eid].push({
    type: "speech",
    content: experience,
    timestamp: Date.now(),
  });

  eventBus.emitAgentEvent(eid, "experience", "experience", {
    content: experience,
    timestamp: Date.now(),
  });
}
