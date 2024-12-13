import * as speak from "./speak";
import * as wait from "./wait";
import * as spawnAgent from "./spawnAgent";

export const actions = {
  speak,
  wait,
  spawnAgent,
};

// Export available tools for agent initialization
export const availableTools = [spawnAgent.action, speak.action, wait.action];
