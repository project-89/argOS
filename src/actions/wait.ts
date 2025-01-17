import { z } from "zod";
import { Memory, Room, Agent } from "../components";
import { getAgentRoom } from "../utils/queries";
import { logger } from "../utils/logger";
import { createVisualStimulus } from "../factories/stimulusFactory";
import { EventBus } from "../runtime/EventBus";
import { ActionResult } from "../types/actions";
import { StimulusType, StimulusSource } from "../types/stimulus";
import { World } from "bitecs";

export const schema = z.object({
  reason: z.string(),
  isThinking: z.boolean().default(false),
});

export const action = {
  name: "wait",
  description:
    "Temporarily suspend active engagement to observe, process information, or allow space in conversation. Used when an agent needs time to think, wants to show they are listening attentively, or is being socially considerate by not interrupting. The wait action helps create natural conversation flow and shows social awareness.",
  parameters: ["reason", "isThinking"],
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
      message: "Cannot wait - agent not in a room",
      timestamp: Date.now(),
      actionName: "wait",
      parameters,
      data: {
        metadata: { error: "No room found" },
      },
    };
  }

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
  createVisualStimulus(
    world,
    eid,
    `${agentName} is ${isThinking ? "thinking" : "waiting"}: ${reason}`,
    {
      source: StimulusSource.AGENT,
      metadata: {
        roomId: Room.id[roomId],
        type: isThinking ? "thinking" : "waiting",
        cognitiveState: {
          isThinking,
          focus: isThinking ? "processing information" : "listening",
        },
        agentId: eid,
        agentName,
        actionType: "WAIT",
      },
      decay: isThinking ? 2000 : 1000,
    }
  );

  return {
    success: true,
    message: `${parameters.isThinking ? "Processed" : "Waited"}: ${
      parameters.reason
    }`,
    actionName: "wait",
    timestamp: Date.now(),
    parameters,
    data: {
      content: parameters.reason,
      metadata: {
        isThinking: parameters.isThinking,
        reason: parameters.reason,
      },
    },
  };
}
