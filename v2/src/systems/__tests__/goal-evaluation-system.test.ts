import "dotenv/config";

import { addComponent, addEntity } from "bitecs";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, Goal, KanbanBoard, KanbanCard, KanbanColumn, LastAction, LastToolResult, Name, ToolResult, Traits, WikiDoc } from "../../ecs/components";
import { HasGoal, HasToolResult } from "../../ecs/relations";
import { setGoalContract } from "../../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../builtin-systems";
import { setLocatedIn } from "../../ecs/location";
import { createDynamicComponent, getDynamicComponent, setDynamicComponentValue } from "../../ecs/dynamic-components";

describe("GoalEvaluationSystem", () => {
  test("completes an in_room goal when agent is in the room", () => {
    const world = createArgosWorld("GoalEval_in_room") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const lobby = createRoomEntity(world, { name: "Lobby" });
    const agent = createAgentEntity(world, { name: "Ava", role: "npc", systemPrompt: "x", roomId: lobby });

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "move_to_room",
      params: { roomName: "Lobby" },
      success: { type: "in_room", roomName: "Lobby" },
      description: "Be in Lobby",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
    expect(Goal.progress[goalEid]).toBe(100);
  });

  test("completes a did_interact goal based on LastAction", () => {
    const world = createArgosWorld("GoalEval_did_interact") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Ben", role: "npc", systemPrompt: "x", roomId: room });

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now() - 1000;
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "use_affordance",
      params: { targetName: "Notepad", affordance: "write_note" },
      success: { type: "did_interact", targetName: "Notepad", affordance: "write_note" },
      description: "Write a note",
    });

    addComponent(world, agent, LastAction as any);
    LastAction.type[agent] = "interact";
    LastAction.target[agent] = "Notepad";
    LastAction.content[agent] = "write_note hello";
    LastAction.success[agent] = true;
    LastAction.timestamp[agent] = Date.now();

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a did_action_type goal based on LastAction", () => {
    const world = createArgosWorld("GoalEval_did_action_type") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Hall" });
    const agent = createAgentEntity(world, { name: "Zoe", role: "npc", systemPrompt: "x", roomId: room });

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now() - 1000;
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: { actionType: "speak" },
      success: { type: "did_action_type", actionType: "speak" },
      description: "Speak once",
    });

    addComponent(world, agent, LastAction as any);
    LastAction.type[agent] = "speak";
    LastAction.target[agent] = "Someone";
    LastAction.content[agent] = "Hello";
    LastAction.success[agent] = true;
    LastAction.timestamp[agent] = Date.now();

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a has_trait goal when Traits include the trait", () => {
    const world = createArgosWorld("GoalEval_has_trait") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Hall" });
    const agent = createAgentEntity(world, { name: "Cara", role: "npc", systemPrompt: "x", roomId: room });
    setLocatedIn(world as any, agent, room);

    addComponent(world, agent, Traits as any);
    Traits.active[agent] = JSON.stringify(["hasKeycard"]);

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "acquire_trait",
      params: { trait: "hasKeycard" },
      success: { type: "has_trait", trait: "hasKeycard" },
      description: "Have keycard",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a repo_file_contains goal when RepoFile content matches", () => {
    const world = createArgosWorld("GoalEval_repo_file_contains") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    if (!getDynamicComponent("RepoFile")) {
      createDynamicComponent({
        name: "RepoFile",
        description: "In-world repo file",
        properties: { path: "string", content: "string" },
      });
    }

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Dev", role: "npc", systemPrompt: "x", roomId: room });

    const fileEid = addEntity(world);
    addComponent(world, fileEid, Name as any);
    Name.value[fileEid] = "math.ts";
    setDynamicComponentValue("RepoFile", fileEid, "path", "math.ts");
    setDynamicComponentValue("RepoFile", fileEid, "content", "export function add(a,b){ return a+b }");

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: { path: "math.ts" },
      success: { type: "repo_file_contains", path: "math.ts", includes: "return a+b" },
      description: "Math fixed",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a tool_exit_code_equals goal when LastToolResult matches", () => {
    const world = createArgosWorld("GoalEval_tool_exit_code") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Dev2", role: "npc", systemPrompt: "x", roomId: room });

    addComponent(world, agent, LastToolResult as any);
    LastToolResult.toolId[agent] = "terminal.run";
    LastToolResult.command[agent] = "npm test";
    LastToolResult.exitCode[agent] = 0;
    LastToolResult.ok[agent] = true;
    LastToolResult.stdout[agent] = "PASS";
    LastToolResult.stderr[agent] = "";
    LastToolResult.summary[agent] = "ok";
    LastToolResult.timestamp[agent] = Date.now();

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now() - 1000;
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: {},
      success: { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "npm test", equals: 0 },
      description: "Tests pass",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a multi-step tool contract using ToolResult evidence (not overwritten by later tool calls)", () => {
    const world = createArgosWorld("GoalEval_tool_evidence") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "DevEvidence", role: "npc", systemPrompt: "x", roomId: room });

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now() - 1000;
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: {},
      success: {
        type: "all_of",
        conditions: [
          { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
          { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node test.cjs", includes: "PASS" },
        ],
      },
      description: "Tool evidence goal",
    });

    // Tool evidence recorded as an entity (new path).
    const toolEid = addEntity(world);
    addComponent(world, toolEid, ToolResult as any);
    ToolResult.toolId[toolEid] = "terminal.run";
    ToolResult.command[toolEid] = "node test.cjs";
    ToolResult.ok[toolEid] = true;
    ToolResult.exitCode[toolEid] = 0;
    ToolResult.stdout[toolEid] = "PASS\n";
    ToolResult.stderr[toolEid] = "";
    ToolResult.summary[toolEid] = "ok";
    ToolResult.timestamp[toolEid] = Date.now();
    ToolResult.goalEid[toolEid] = goalEid;
    ToolResult.deviceEid[toolEid] = 123;
    addComponent(world, agent, HasToolResult(toolEid) as any);

    // Later tool call overwriting LastToolResult should NOT invalidate the goal.
    addComponent(world, agent, LastToolResult as any);
    LastToolResult.toolId[agent] = "kanban.move_card";
    LastToolResult.command[agent] = "{\"title\":\"X\"}";
    LastToolResult.exitCode[agent] = 0;
    LastToolResult.ok[agent] = true;
    LastToolResult.stdout[agent] = "";
    LastToolResult.stderr[agent] = "";
    LastToolResult.summary[agent] = "moved";
    LastToolResult.timestamp[agent] = Date.now();

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a kanban_card_in_column goal when the card is in the column", () => {
    const world = createArgosWorld("GoalEval_kanban") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Dev3", role: "npc", systemPrompt: "x", roomId: room });

    const board = addEntity(world);
    addComponent(world, board, Name as any);
    addComponent(world, board, KanbanBoard as any);
    Name.value[board] = "Team Board";
    KanbanBoard.project[board] = "Demo";

    const colBacklog = addEntity(world);
    addComponent(world, colBacklog, Name as any);
    addComponent(world, colBacklog, KanbanColumn as any);
    Name.value[colBacklog] = "Backlog";
    setLocatedIn(world, colBacklog, board);

    const colDone = addEntity(world);
    addComponent(world, colDone, Name as any);
    addComponent(world, colDone, KanbanColumn as any);
    Name.value[colDone] = "Done";
    setLocatedIn(world, colDone, board);

    const card = addEntity(world);
    addComponent(world, card, Name as any);
    addComponent(world, card, KanbanCard as any);
    Name.value[card] = "Fix add()";
    setLocatedIn(world, card, colDone);

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: {},
      success: { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
      description: "Card is done",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });

  test("completes a doc_contains goal when a wiki doc contains the text", () => {
    const world = createArgosWorld("GoalEval_doc_contains") as any;
    initializePrefabs(world);
    const registry = createSystemRegistry();
    const sys = createGoalEvaluationSystem();
    sys.frequency = 0;
    registerSystem(registry, sys as any);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Dev4", role: "npc", systemPrompt: "x", roomId: room });

    const doc = addEntity(world);
    addComponent(world, doc, Name as any);
    addComponent(world, doc, WikiDoc as any);
    Name.value[doc] = "Spec: Fix add()";
    WikiDoc.title[doc] = "Spec: Fix add()";
    WikiDoc.body[doc] = "Acceptance Criteria:\n- add(a,b) returns a+b";

    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.progress[goalEid] = 0;
    Goal.createdAt[goalEid] = Date.now();
    setGoalContract(world, goalEid, {
      version: 1,
      kind: "custom",
      params: {},
      success: { type: "doc_contains", title: "Spec: Fix add()", includes: "Acceptance Criteria" },
      description: "Spec written",
    });

    runSystems(world, registry as any, 1, 16);
    expect(Goal.status[goalEid]).toBe("completed");
  });
});
