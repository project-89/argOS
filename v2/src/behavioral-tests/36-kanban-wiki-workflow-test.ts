/**
 * Behavioral Test: Kanban + Wiki coordination tools (grounded objects)
 *
 * Validates:
 * - Tools are invoked via object affordances (`run_tool` effects)
 * - Kanban board state is stored in ECS (columns/cards via `LocatedIn`)
 * - Wiki docs are stored in ECS (`WikiDoc.body`)
 * - Goal completion is deterministic via GoalEvaluationSystem contracts
 *
 * Run:
 *   npx tsx src/behavioral-tests/36-kanban-wiki-workflow-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Name } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { registerEntity, executeActions } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("KanbanWikiWorkflowTest") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office" });
  registerEntity(room, "Office");

  // Devices: Kanban board + Wiki terminal.
  worldSchema.defineObjectType({
    name: "kanban_board_device_36",
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineObjectType({
    name: "wiki_terminal_device_36",
    description: "A shared wiki terminal",
    traits: ["wiki_terminal", "examinable"],
    states: { idle: { description: "A wiki terminal is ready.", traits: ["wiki_terminal"] } },
    defaultState: "idle",
    category: "device",
  });

  // Kanban affordances
  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_create_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.create_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_move_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  // Wiki affordances
  worldSchema.defineAffordance({
    name: "wiki_create_doc",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.create_doc", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_append",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.append", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_read",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.read", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const objectManager = new ObjectManager(world as any);
  const board = objectManager.spawn("kanban_board_device_36", { name: "Team Board", containedIn: room })!;
  const wiki = objectManager.spawn("wiki_terminal_device_36", { name: "Wiki", containedIn: room })!;
  registerEntity(board, "Team Board");
  registerEntity(wiki, "Wiki");

  const agent = createAgentEntity(world as any, { name: "Rae", role: "Engineer", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Rae");

  // Deterministic success contract: a card must be moved to Done and a wiki doc must contain acceptance criteria.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Coordinate work via kanban+wiki and finish the task.";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();

  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: {},
    success: {
      type: "all_of",
      conditions: [
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
        { type: "doc_contains", title: "Spec: Fix add()", includes: "Acceptance Criteria" },
      ],
    },
    description: Goal.description[goalEid],
  });

  // Execute grounded tool actions.
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: "kanban_init {\"columns\":[\"Backlog\",\"In Progress\",\"Done\"]}" } as any }],
    registry as any
  );
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: "kanban_create_card {\"column\":\"Backlog\",\"title\":\"Fix add()\",\"description\":\"Fix add() to return a+b\"}" } as any }],
    registry as any
  );
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Wiki", content: "wiki_create_doc {\"title\":\"Spec: Fix add()\",\"body\":\"\",\"status\":\"draft\"}" } as any }],
    registry as any
  );
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Wiki", content: "wiki_append {\"title\":\"Spec: Fix add()\",\"text\":\"Acceptance Criteria:\\n- add(a,b) returns a+b\\n\"}" } as any }],
    registry as any
  );
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: "kanban_move_card {\"title\":\"Fix add()\",\"toColumn\":\"Done\"}" } as any }],
    registry as any
  );

  // Ensure tool results were emitted as stimuli.
  const stimuli = drainPendingStimuli();
  assert(stimuli.some((s) => s.type === "tool_result" && s.content.includes("Kanban initialized")), "expected tool_result for kanban.init");
  assert(stimuli.some((s) => s.type === "tool_result" && s.content.includes("Doc created")), "expected tool_result for wiki.create_doc");

  // Evaluate goal deterministically from ECS state.
  runSystems(world as any, registry as any, 1, 16);
  assert(Goal.status[goalEid] === "completed", "expected goal to be completed via deterministic evaluation");

  // Basic sanity: entities exist and are named.
  assert(String(Name.value[board] || "") === "Team Board", "expected board Name");
  assert(String(Name.value[wiki] || "") === "Wiki", "expected wiki Name");

  console.log("✓ Kanban+Wiki workflow test passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
