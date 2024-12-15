import { z } from "zod";
import { World, addEntity as addBitECSEntity } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { Agent } from "../components";

export const schema = z.object({
  name: z.string(),
});

export const action = {
  name: "addEntity",
  description: "Add a new entity to the world",
  parameters: ["name"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Creating new entity: ${parameters.name}`, agentName);

  // Create the new entity
  const newEntityId = addBitECSEntity(world);

  // Emit creation event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    name: parameters.name,
    entityId: newEntityId,
  });

  return {
    id: newEntityId,
    name: parameters.name,
  };
}
