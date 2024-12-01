import * as speak from "./speak";
import * as wait from "./wait";

export const actions = {
  speak,
  wait,
};

// Export available tools for agent initialization
export const availableTools = [speak.action, wait.action];
