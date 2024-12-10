import { z } from "zod";
import { World, addComponent } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import {
  Agent,
  Interaction,
  OccupiesRoom,
  StimulusInRoom,
  StimulusSource,
} from "../components/agent/Agent";

// Schema matches AddRelationParams from bitECSAgent.ts
export const schema = z.object({
  relationName: z.string(),
  relationSubjects: z.array(z.number()),
  entities: z.array(z.number()),
  metadata: z
    .object({
      type: z.string().optional(),
      strength: z.number().optional(),
    })
    .optional(),
});

export const action = {
  name: "addRelations",
  description: "Add relations between entities",
  parameters: ["relationName", "relationSubjects", "entities", "metadata"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Adding relations between entities`, agentName);

  const {
    relationName,
    relationSubjects,
    entities,
    metadata = {},
  } = parameters;

  // Get the relation based on name
  let relation;
  switch (relationName.toLowerCase()) {
    case "interaction":
      relation = Interaction;
      break;
    case "occupiesroom":
      relation = OccupiesRoom;
      break;
    case "stimulusinroom":
      relation = StimulusInRoom;
      break;
    case "stimulussource":
      relation = StimulusSource;
      break;
    default:
      logger.warn(`Unknown relation: ${relationName}`);
      return "Unknown relation type";
  }

  // Add relations
  for (const entityId of entities) {
    for (const subjectId of relationSubjects) {
      const relationInstance = relation(subjectId);
      addComponent(world, relationInstance, entityId);

      // Set metadata if available
      if (metadata && relationInstance.store) {
        const store = relationInstance.store;
        if (metadata.type !== undefined && store.type) {
          store.type[entityId] = metadata.type;
        }
        if (metadata.strength !== undefined && store.strength) {
          store.strength[entityId] = metadata.strength;
        }
        if (store.lastUpdate) {
          store.lastUpdate[entityId] = Date.now();
        }
      }
    }
  }

  // Emit update event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    type: "addRelations",
    relationName,
    relationSubjects: relationSubjects.map((id) => ({
      id,
      name: Agent.name[id] || `Entity ${id}`,
    })),
    entities: entities.map((id) => ({
      id,
      name: Agent.name[id] || `Entity ${id}`,
    })),
    metadata,
  });

  return "Relations added";
}
