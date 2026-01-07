import { createActionId } from "../core/ids";
import { getAgent, ArgosWorld } from "../core/ecs";
import type { Action } from "../core/types";

export function queueAction(
  world: ArgosWorld,
  eid: number,
  config: {
    type: string;
    parameters: Record<string, any>;
    motivatedBy: string[];
    expectedOutcome: string;
  }
): Action | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;

  const action: Action = {
    id: createActionId(),
    type: config.type,
    parameters: config.parameters,
    motivatedBy: config.motivatedBy,
    expectedOutcome: config.expectedOutcome,
    status: "pending",
    timestamp: Date.now(),
  };

  agent.actions.pending.push(action);
  return action;
}

export function getNextPendingAction(world: ArgosWorld, eid: number): Action | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;
  return agent.actions.pending[0] ?? null;
}

export function startExecutingAction(world: ArgosWorld, eid: number, actionId: string): Action | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;

  const pending = agent.actions.pending;
  const idx = pending.findIndex((a) => a.id === actionId);

  if (idx === -1) return null;

  const [action] = pending.splice(idx, 1);
  action.status = "executing";
  agent.actions.executing = action;

  return action;
}

export function completeAction(
  world: ArgosWorld,
  eid: number,
  result: any,
  actualOutcome?: string
): Action | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;

  const action = agent.actions.executing;
  if (!action) return null;

  action.status = "completed";
  action.result = result;
  action.actualOutcome = actualOutcome;

  agent.actions.completed.push(action);
  agent.actions.completed = agent.actions.completed.slice(-20);
  agent.actions.executing = null;

  return action;
}

export function failAction(world: ArgosWorld, eid: number, error: string): Action | null {
  const agent = getAgent(world, eid);
  if (!agent) return null;

  const action = agent.actions.executing;
  if (!action) return null;

  action.status = "failed";
  action.result = { error };
  action.actualOutcome = `Failed: ${error}`;

  agent.actions.completed.push(action);
  agent.actions.completed = agent.actions.completed.slice(-20);
  agent.actions.executing = null;

  return action;
}

export function getCurrentAction(world: ArgosWorld, eid: number): Action | null {
  const agent = getAgent(world, eid);
  return agent?.actions.executing ?? null;
}

export function getPendingActions(world: ArgosWorld, eid: number): Action[] {
  const agent = getAgent(world, eid);
  return agent?.actions.pending ?? [];
}

export function getCompletedActions(world: ArgosWorld, eid: number, count: number = 5): Action[] {
  const agent = getAgent(world, eid);
  if (!agent) return [];
  return agent.actions.completed.slice(-count);
}

export function clearPendingActions(world: ArgosWorld, eid: number): void {
  const agent = getAgent(world, eid);
  if (agent) {
    agent.actions.pending = [];
  }
}

export interface ActionHandler {
  name: string;
  description: string;
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>;
  execute: (
    world: ArgosWorld,
    eid: number,
    params: Record<string, any>,
    context: any
  ) => Promise<{ success: boolean; result: any; outcome?: string }>;
}

const actionHandlers: Map<string, ActionHandler> = new Map();

export function registerActionHandler(handler: ActionHandler): void {
  actionHandlers.set(handler.name, handler);
}

export function getActionHandler(name: string): ActionHandler | undefined {
  return actionHandlers.get(name);
}

export function getAllActionHandlers(): ActionHandler[] {
  return Array.from(actionHandlers.values());
}

export function serializeActionsForLLM(): string {
  const handlers = getAllActionHandlers();
  const lines = ["AVAILABLE ACTIONS:"];

  for (const handler of handlers) {
    lines.push(`\n${handler.name}: ${handler.description}`);
    lines.push("  Parameters:");
    for (const [name, param] of Object.entries(handler.inputSchema)) {
      const required = param.required !== false ? " (required)" : " (optional)";
      lines.push(`    ${name}: ${param.type}${required} - ${param.description}`);
    }
  }

  return lines.join("\n");
}

registerActionHandler({
  name: "speak",
  description: "Say something out loud to others in the room",
  inputSchema: {
    content: { type: "string", description: "What to say", required: true },
    tone: { type: "string", description: "Emotional tone", required: false },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { spoken: params.content, tone: params.tone },
      outcome: `Said: "${params.content}"`,
    };
  },
});

registerActionHandler({
  name: "think",
  description: "Think deeply about something, adding it to your cognitive stream",
  inputSchema: {
    about: { type: "string", description: "What to think about", required: true },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { thought: params.about },
      outcome: `Thought about: ${params.about}`,
    };
  },
});

registerActionHandler({
  name: "wait",
  description: "Wait and observe, taking no action",
  inputSchema: {
    reason: { type: "string", description: "Why waiting", required: false },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { waited: true, reason: params.reason },
      outcome: params.reason ? `Waiting: ${params.reason}` : "Waiting",
    };
  },
});

registerActionHandler({
  name: "focus",
  description: "Direct attention to a specific target",
  inputSchema: {
    target: { type: "string", description: "What to focus on", required: true },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { focused: params.target },
      outcome: `Focused attention on: ${params.target}`,
    };
  },
});

registerActionHandler({
  name: "reflect",
  description: "Reflect on recent experiences and update understanding",
  inputSchema: {
    topic: { type: "string", description: "What to reflect on", required: true },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { reflected: params.topic },
      outcome: `Reflected on: ${params.topic}`,
    };
  },
});

registerActionHandler({
  name: "remember",
  description: "Store important information in knowledge graph",
  inputSchema: {
    type: { type: "string", description: "Type of knowledge (belief, memory, concept, goal)", required: true },
    content: { type: "string", description: "What to remember", required: true },
    importance: { type: "number", description: "How important (0-1)", required: false },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { remembered: params.content, type: params.type },
      outcome: `Stored ${params.type}: ${params.content}`,
    };
  },
});

registerActionHandler({
  name: "setMode",
  description: "Change cognitive mode",
  inputSchema: {
    mode: { type: "string", description: "New mode (reactive, deliberative, reflective, creative)", required: true },
    reason: { type: "string", description: "Why changing mode", required: false },
  },
  execute: async (_world, _eid, params) => {
    return {
      success: true,
      result: { newMode: params.mode },
      outcome: `Changed mode to: ${params.mode}`,
    };
  },
});
