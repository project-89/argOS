import { z } from "zod";
import { World } from "../types/bitecs";
import { logger } from "../utils/logger";
import { EventBus } from "../runtime/EventBus";
import { createAgent as createAgentFactory } from "../utils/agent-factory";
import { getAgentRoom } from "../utils/queries";
import { ActionResult } from "../types/actions";
import { ActionContent } from "../types";
import { Agent } from "../components/agent/Agent";
import { SimulationRuntime } from "../runtime/SimulationRuntime";

export const schema = z
  .object({
    name: z
      .string()
      .describe(
        "The name of the agent to create. Should be unique and descriptive."
      ),

    role: z
      .string()
      .describe(
        "The agent's role/function in the simulation. Defines their purpose and behavior."
      ),

    systemPrompt: z
      .string()
      .describe(
        "The core instructions that define the agent's personality, knowledge, and behavior patterns."
      ),

    appearance: z
      .string()
      .optional()
      .describe(
        "Physical description of how the agent appears to others. Optional - defaults to a basic appearance."
      ),

    tools: z
      .array(z.string())
      .optional()
      .describe(
        "List of action names this agent can perform. Optional - defaults to ['speak', 'wait']."
      ),

    platform: z
      .string()
      .optional()
      .describe(
        "The platform/environment type this agent operates in. Optional - defaults to 'default'."
      ),
  })
  .describe("Configuration for creating a new agent in the current room");

export const action = {
  name: "spawnAgent",
  description:
    "Create a new agent in the current room with specified capabilities and traits",
  parameters: [
    "name",
    "role",
    "systemPrompt",
    "appearance",
    "tools",
    "platform",
  ],
  schema,
};

export async function execute(
  world: World,
  creatorEid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus,
  runtime: SimulationRuntime
): Promise<ActionResult> {
  const roomId = getAgentRoom(world, creatorEid);
  if (!roomId) {
    return {
      success: false,
      message: "Cannot create agent - creator not in a room",
      timestamp: Date.now(),
      actionName: "spawnAgent",
      parameters,
      data: {
        entityId: -1,
        metadata: {
          error: "Creator not in room",
          name: parameters.name,
          role: parameters.role,
        },
      },
    };
  }

  const newAgentEid = createAgentFactory(world, {
    ...parameters,
    active: 1,
  });

  const result = `Successfully created new agent "${parameters.name}" (${parameters.role}) with id: ${newAgentEid}`;

  logger.agent(newAgentEid, result, Agent.name[creatorEid]);

  const actionContent: ActionContent = {
    action: "spawnAgent",
    result,
    parameters,
    agentName: Agent.name[creatorEid],
  };

  // Move new agent to same room as creator
  eventBus.emitRoomEvent(roomId, "action", actionContent, String(creatorEid));

  // Move new agent to same room as creator
  runtime.getRoomManager().moveAgentToRoom(newAgentEid, roomId);

  return {
    success: true,
    actionName: "spawnAgent",
    message: result,
    timestamp: Date.now(),
    parameters,
    data: {
      entityId: newAgentEid,
      metadata: {
        name: parameters.name,
        role: parameters.role,
        tools: parameters.tools || ["speak", "wait"],
      },
    },
  };
}
