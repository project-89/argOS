import { z } from "zod";
import { Agent, Memory } from "../components";
import { getAgentRoom } from "../utils/queries";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { World } from "bitecs";
import { ActionResultType } from "../components";

export const schema = z.object({
  reflection: z.string().describe("The reflection content to record"),
  subject: z
    .enum([
      "actions",
      "experiences",
      "learning",
      "emotions",
      "relationships",
      "goals",
      "plans",
    ])
    .describe("What the reflection is about"),
  timeframe: z
    .enum(["recent", "medium", "long"])
    .describe("The timeframe the reflection covers"),
  metadata: z
    .record(z.any())
    .optional()
    .describe("Any additional metadata about the reflection"),
});

export const action = {
  name: "reflect",
  description:
    "Record a reflection on past experiences, actions, or other aspects of the agent's state",
  parameters: ["reflection", "subject", "timeframe", "metadata"],
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
      action: "reflect",
      result: "Cannot record reflection - agent not in a room",
      timestamp: Date.now(),
      data: {
        metadata: { error: "No room found" },
      },
    };
  }

  const { reflection, subject, timeframe, metadata } = parameters;
  const agentName = Agent.name[eid];

  // Log the reflection
  logger.agent(
    eid,
    `Reflection on ${subject} (${timeframe}): ${reflection}`,
    agentName
  );

  // Emit reflection event to room
  eventBus.emitRoomEvent(
    roomId,
    "thought",
    {
      content: reflection,
      type: "reflection",
      metadata: {
        subject,
        timeframe,
        ...metadata,
        agentName,
      },
    },
    String(eid)
  );

  return {
    success: true,
    action: "reflect",
    result: reflection,
    timestamp: Date.now(),
    data: {
      content: reflection,
      metadata: {
        subject,
        timeframe,
        ...metadata,
      },
    },
  };
}
