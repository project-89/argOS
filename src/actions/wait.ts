import { z } from "zod";
import { Agent } from "../components";
import { getAgentRoom } from "../utils/queries";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { World } from "bitecs";
import { ActionResultType } from "../components";

export const schema = z.object({
  reason: z.string(),
  isThinking: z.boolean().default(false),
});

export const action = {
  name: "wait",
  description:
    "Waiting can be used when waiting and listening for information, or to give a pause to yourself to think.  Make sure you do no overuse this tool, and you should be taking action when you can to accomplish your goals.",
  parameters: ["reason", "isThinking"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
): Promise<ActionResultType> {
  const roomId = getAgentRoom(world, eid);
  if (!roomId) {
    return {
      success: false,
      action: "wait",
      result: "Cannot wait - agent not in a room",
      timestamp: Date.now(),
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

  return {
    success: true,
    action: "wait",
    result: `${parameters.isThinking ? "Processed" : "Waited"}: ${
      parameters.reason
    }`,
    timestamp: Date.now(),
    data: {
      content: parameters.reason,
      metadata: {
        isThinking: parameters.isThinking,
        reason: parameters.reason,
      },
    },
  };
}
