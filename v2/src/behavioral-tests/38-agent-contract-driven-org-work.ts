/**
 * Behavioral Benchmark: Agent uses Kanban/Wiki without plan or macro (heuristic)
 *
 * This measures whether deterministic cognition can:
 * - Notice an unsatisfied typed goal contract
 * - "Read" the kanban board + wiki doc (tools) before making changes
 * - Perform the minimal grounded actions required to satisfy the contract
 * - Complete the goal via GoalEvaluationSystem (ECS evidence)
 *
 * Run:
 *   npx tsx src/behavioral-tests/38-agent-contract-driven-org-work.ts
 */
import "dotenv/config";

import { addComponent, addEntity } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { agentThink } from "../cognition/agent-mind";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  // Force deterministic mode.
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("ContractDrivenOrgWork") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office." });
  registerEntity(room, "Office");

  // Devices
  worldSchema.defineObjectType({
    name: "kanban_board_device_38",
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineObjectType({
    name: "wiki_terminal_device_38",
    description: "A shared wiki terminal",
    traits: ["wiki_terminal", "examinable"],
    states: { idle: { description: "A wiki terminal is ready.", traits: ["wiki_terminal"] } },
    defaultState: "idle",
    category: "device",
  });

  // Affordances for contract-driven action selection
  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_list",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.list", toolInputFrom: "static", toolInput: {}, toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_upsert_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.upsert_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_move_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_upsert_doc",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.upsert_doc", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_read",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.read", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_ensure_contains",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.ensure_contains", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const board = objectManager.spawn("kanban_board_device_38", { name: "Team Board", containedIn: room })!;
  const wiki = objectManager.spawn("wiki_terminal_device_38", { name: "Wiki", containedIn: room })!;
  registerEntity(board, "Team Board");
  registerEntity(wiki, "Wiki");

  const agent = createAgentEntity(world as any, { name: "Ari", role: "Engineer", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Ari");

  // Goal with typed success contract; no plan is created.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Use the board and wiki to complete the task.";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: {
      type: "all_of",
      conditions: [
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
        { type: "doc_contains", title: "Spec: Fix add()", includes: "Acceptance Criteria" },
      ],
    },
    description: Goal.description[goalEid],
  });

  const observedToolResults: string[] = [];
  let tick = 0;

  for (let i = 0; i < 60; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    const action = await agentThink(world as any, agent);
    executeActions(world as any, [{ eid: agent, action: action as any }], registry as any);
    const stimuli = drainPendingStimuli();
    for (const s of stimuli) {
      if (s.type === "tool_result") observedToolResults.push(s.content);
    }
    runSystems(world as any, registry as any, tick++, 16);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected agent to complete the org goal without plan/LLM");
  assert(observedToolResults.some((c) => c.includes("[Tool:kanban.list]") || c.includes("Kanban board")), "expected agent to read the kanban board");
  assert(observedToolResults.some((c) => c.includes("[Tool:wiki.read]") || c.includes("Doc: Spec: Fix add()")), "expected agent to read the wiki doc");

  console.log("✓ Contract-driven org work passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

