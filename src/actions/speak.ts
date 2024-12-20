import { z } from "zod";
import { Memory, Room, Agent } from "../components";
import { logger } from "../utils/logger";
import { getAgentRoom } from "../utils/queries";
import { EventBus } from "../runtime/EventBus";
import { Experience } from "../llm/agent-llm";
import { ActionResult } from "../types/actions";
import { createAuditoryStimulus } from "../factories/stimulusFactory";
import { StimulusSource } from "../types/stimulus";
import { World } from "bitecs";

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
): Promise<ActionResult> {
  const roomId = getAgentRoom(world, eid);
  if (!roomId) {
    return {
      success: false,
      message: "Cannot speak - agent not in a room",
      timestamp: Date.now(),
      actionName: "speak",
      parameters,
      data: {
        content: parameters.message,
        metadata: { error: "No room found" },
      },
    };
  }

  const {
    message,
    tone = "neutral",
    target,
    reason = "Communicating with others",
  } = parameters;
  const agentName = Agent.name[eid];

  logger.agent(eid, `Says: ${message}`, agentName);

  // Create auditory stimulus
  createAuditoryStimulus(world, eid, message, {
    source: StimulusSource.AGENT,
    metadata: {
      roomId: Room.id[roomId],
      type: "speech",
      tone,
      target,
      agentName,
    },
    decay: 1,
  });

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

  return {
    success: true,
    message: experience,
    timestamp: Date.now(),
    actionName: "speak",
    parameters,
    data: {
      content: parameters.message,
      metadata: {
        tone: parameters.tone,
        target: parameters.target,
      },
    },
  };
}
