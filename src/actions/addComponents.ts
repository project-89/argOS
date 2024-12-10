import { z } from "zod";
import { World, addComponent } from "bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { Agent, Room, Appearance } from "../components/agent/Agent";

// Schema matches AddComponentParams from bitECSAgent.ts
export const schema = z.object({
  componentNames: z.array(z.string()),
  entities: z.array(z.number()),
});

export const action = {
  name: "addComponents",
  description: "Add components to one or more entities",
  parameters: ["componentNames", "entities"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Adding components to entities`, agentName);

  const { componentNames, entities } = parameters;

  // Process each component
  for (const componentName of componentNames) {
    // Get the component based on name
    let component;
    switch (componentName.toLowerCase()) {
      case "agent":
        component = Agent;
        break;
      case "room":
        component = Room;
        break;
      case "appearance":
        component = Appearance;
        break;
      default:
        logger.warn(`Unknown component: ${componentName}`);
        continue;
    }

    // Add component to each entity
    for (const entityId of entities) {
      addComponent(world, component, entityId);
    }
  }

  // Emit update event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    components: componentNames,
    entities,
    type: "addComponents",
  });

  return "Components added";
}
