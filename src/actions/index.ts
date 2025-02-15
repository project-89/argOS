import * as speak from "./speak";
import * as wait from "./wait";
import * as spawnAgent from "./spawnAgent";
import * as runCommand from "./runCommand";

export const actions = {
  speak,
  wait,
  spawnAgent,
  runCommand,
};

export const actionStrings = Object.keys(actions);

// Export available tools for agent initialization
export const availableTools = [
  spawnAgent.action,
  speak.action,
  wait.action,
  runCommand.action,
];
