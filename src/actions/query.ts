import { z } from "zod";
import { World } from "../types/bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { query } from "bitecs";
import { Agent, Room } from "../components";

// Schema matches the QueryParams from bitECSAgent.ts
export const schema = z.object({
  componentNames: z.array(z.string()).optional(),
  notComponentNames: z.array(z.string()).optional(),
  relations: z
    .array(
      z.object({
        relationName: z.string(),
        relationSubjectEntityId: z.string(),
      })
    )
    .optional(),
  notRelations: z
    .array(
      z.object({
        relationName: z.string(),
        relationSubjectEntityId: z.string(),
      })
    )
    .optional(),
});

export const action = {
  name: "query",
  description: "Query the ECS world for entities matching certain criteria",
  parameters: [
    "componentNames",
    "notComponentNames",
    "relations",
    "notRelations",
  ],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Querying entities`, agentName);

  // For now, just do a basic component query
  // We'll expand this to handle relations later
  const componentQueries =
    parameters.componentNames
      ?.map((name) => {
        switch (name.toLowerCase()) {
          case "agent":
            return Agent;
          case "room":
            return Room;
          default:
            return null;
        }
      })
      .filter((c) => c !== null) || [];

  if (componentQueries.length === 0) {
    return [];
  }

  const results = query(world, componentQueries);

  // Convert results to array and get basic info
  const entities = Array.from(results).map((entityId) => ({
    id: entityId,
    name: Agent.name[entityId] || Room.name[entityId] || `Entity ${entityId}`,
    type: Agent.name[entityId]
      ? "agent"
      : Room.name[entityId]
      ? "room"
      : "entity",
  }));

  // Emit query event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    query: parameters,
    results: entities,
  });

  return entities;
}
