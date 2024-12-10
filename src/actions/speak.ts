import { z } from "zod";
import { World } from "../types/bitecs";
import { Memory, Room, Agent } from "../components/agent/Agent";
import { logger } from "../utils/logger";
import { getAgentRoom } from "../utils/queries";
import { EventBus } from "../runtime/EventBus";
import { Experience } from "../llm/agent-llm";

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
  reason: z.string().optional(),
});

export const action = {
  name: "speak",
  description: "Say something to others in the room",
  parameters: ["message", "tone", "target", "reason"],
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

  const {
    message,
    tone = "neutral",
    target,
    reason = "Communicating with others",
  } = parameters;
  const agentName = Agent.name[eid];

  logger.agent(eid, `Says: ${message}`, agentName);

  // Emit action event to room
  eventBus.emitRoomEvent(
    roomId,
    "action",
    {
      action: "speak",
      reason,
      parameters: { message, tone, target },
      agentName,
    },
    String(eid)
  );

  // Emit speech event to room
  eventBus.emitRoomEvent(
    roomId,
    "speech",
    {
      message,
      tone,
      target,
      agentName,
    },
    String(eid)
  );

  const experience = `I said: "${message}"${target ? ` to ${target}` : ""}`;

  // Record the experience with deduplication
  Memory.experiences[eid] = Memory.experiences[eid] || [];
  const recentExperiences = Memory.experiences[eid];

  // Check for duplicate speech in last 15 seconds
  const isDuplicate = recentExperiences.some(
    (exp: { type: string; content: string; timestamp: number }) =>
      exp.type === "speech" &&
      exp.content === experience &&
      Date.now() - exp.timestamp < 15000
  );

  if (!isDuplicate) {
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
}
