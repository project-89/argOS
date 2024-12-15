import { z } from "zod";
import { World, removeEntity as removeBitECSEntity } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { Agent } from "../components";

export const schema = z.object({
  entityId: z.number(),
});

export const action = {
  name: "removeEntity",
  description: "Remove an entity from the world",
  parameters: ["entityId"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  const targetName =
    Agent.name[parameters.entityId] || `Entity ${parameters.entityId}`;
  logger.agent(eid, `Removing entity: ${targetName}`, agentName);

  // Remove the entity
  removeBitECSEntity(world, parameters.entityId);

  // Emit removal event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    type: "removeEntity",
    entityId: parameters.entityId,
    entityName: targetName,
  });

  return `Removed entity ${targetName}`;
}
