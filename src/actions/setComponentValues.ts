import { z } from "zod";
import { World } from "../types/bitecs";
import { EventBus } from "../runtime/EventBus";
import { logger } from "../utils/logger";
import { Agent, Room, Appearance } from "../components/agent/Agent";

// Schema matches SetComponentValuesParams from bitECSAgent.ts
const propertyValueSchema = z.object({
  propertyName: z.string(),
  propertyValue: z.union([z.string(), z.number()]),
});

const componentValueSchema = z.object({
  componentName: z.string(),
  propertyValues: z.array(propertyValueSchema),
});

export const schema = z.object({
  setComponentValues: z.array(componentValueSchema),
  entities: z.array(z.number()),
});

export const action = {
  name: "setComponentValues",
  description: "Set values on components for one or more entities",
  parameters: ["setComponentValues", "entities"],
  schema,
};

export async function execute(
  world: World,
  eid: number,
  parameters: z.infer<typeof schema>,
  eventBus: EventBus
) {
  const agentName = Agent.name[eid];
  logger.agent(eid, `Setting component values`, agentName);

  const { setComponentValues, entities } = parameters;

  // Process each component value update
  for (const { componentName, propertyValues } of setComponentValues) {
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

    // Update each entity
    for (const entityId of entities) {
      // Set each property value
      for (const { propertyName, propertyValue } of propertyValues) {
        if (propertyName in component) {
          component[propertyName][entityId] = propertyValue;
        } else {
          logger.warn(
            `Unknown property ${propertyName} on component ${componentName}`
          );
        }
      }
    }
  }

  // Emit update event
  eventBus.emitAgentEvent(eid, "action", "engine", {
    updates: setComponentValues,
    entities,
  });

  return "Component values updated";
}
