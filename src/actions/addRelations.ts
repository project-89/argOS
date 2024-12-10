import { z } from "zod";
import { World, addComponent } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { Agent } from "../components/agent/Agent";
import { SimulationRuntime } from "../runtime/SimulationRuntime";

type RelationStore = {
  type?: Record<number, string>;
  strength?: Record<number, number>;
  lastUpdate?: Record<number, number>;
};

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
  eventBus: EventBus,
  runtime: SimulationRuntime
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Adding relations between entities`, agentName);

  const {
    relationName,
    relationSubjects,
    entities,
    metadata = {},
  } = parameters;

  // Get relation from state manager
  const relationComponent = runtime.getStateManager().getRelation(relationName);
  if (!relationComponent) {
    logger.warn(`Unknown relation: ${relationName}`);
    return "Unknown relation type";
  }

  // Add relations
  for (const entityId of entities) {
    for (const subjectId of relationSubjects) {
      const relationInstance = relationComponent.relation(subjectId);
      addComponent(world, entityId, relationInstance);

      // Set metadata if available
      if (metadata && relationInstance.store) {
        const store = relationInstance.store as RelationStore;
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
