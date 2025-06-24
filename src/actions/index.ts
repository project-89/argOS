import * as speak from "./speak";
import * as wait from "./wait";
import * as spawnAgent from "./spawnAgent";
import * as runCommand from "./runCommand";
import * as think from "./think";
import * as reflect from "./reflect";
import * as observe from "./observe";

export const actions = {
  speak,
  wait,
  spawnAgent,
  runCommand,
  think,
  reflect,
  observe,
};

export const actionStrings = Object.keys(actions);

// Export available tools for agent initialization
export const availableTools = [
  spawnAgent.action,
  speak.action,
  wait.action,
  runCommand.action,
  think.action,
  reflect.action,
  observe.action,
];
