import { World, addEntity, addComponent, set, setComponent } from "bitecs";
import { Action, Agent, Memory, Appearance } from "../components/agent/Agent";
import { AgentConfig } from "../types/agent";
import { logger } from "../utils/logger";
import { availableTools } from "../types/tools";

export function createAgent(world: World, config: AgentConfig) {
  const {
    name,
    role,
    systemPrompt,
    platform = "default",
    appearance = "A nondescript figure",
    active = 1,
  } = config;

  const eid = addEntity(world);

  setComponent(world, eid, Agent, {
    name,
    role,
    systemPrompt,
    active,
    platform,
    appearance,
    attention: 1,
  });
  // Add core agent component
  // addComponent(
  //   world,
  //   eid,
  //   set(Agent, {
  //     name,
  //     role,
  //     systemPrompt,
  //     active,
  //     platform,
  //     appearance,
  //     attention: 1,
  //   })
  // );

  // Add appearance component
  addComponent(
    world,
    eid,
    set(Appearance, {
      baseDescription: appearance,
      facialExpression: "neutral",
      bodyLanguage: "relaxed",
      currentAction: "standing",
      socialCues: "open to interaction",
      lastUpdate: Date.now(),
    })
  );

  // Add memory component
  addComponent(
    world,
    eid,
    set(Memory, {
      thoughts: [],
      lastThought: "",
      perceptions: [],
      experiences: [],
    })
  );

  // Add action component
  addComponent(
    world,
    eid,
    set(Action, {
      pendingAction: null,
      lastActionTime: Date.now(),
      availableTools,
    })
  );

  logger.system(`Created agent: ${name} (${role}) with active=${active}`);

  return eid;
}
