import { z } from "zod";
import { World, removeComponent } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import {
  Agent,
  Interaction,
  OccupiesRoom,
  StimulusInRoom,
  StimulusSource,
} from "../components";

// Schema matches AddRelationParams from bitECSAgent.ts (same schema for removal)
export const schema = z.object({
  relationName: z.string(),
  relationSubjects: z.array(z.number()),
  entities: z.array(z.number()),
});

export const action = {
  name: "removeRelations",
  description: "Remove relations between entities",
  parameters: ["relationName", "relationSubjects", "entities"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Removing relations between entities`, agentName);

  const { relationName, relationSubjects, entities } = parameters;

  // Get the relation based on name
  let relation: any;
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

  // Remove relations
  for (const entityId of entities) {
    for (const subjectId of relationSubjects) {
      removeComponent(world, relation(subjectId), entityId);
    }
  }

  // Emit update event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    type: "removeRelations",
    relationName,
    relationSubjects: relationSubjects.map((id) => ({
      id,
      name: Agent.name[id] || `Entity ${id}`,
    })),
    entities: entities.map((id) => ({
      id,
      name: Agent.name[id] || `Entity ${id}`,
    })),
  });

  return "Relations removed";
}
