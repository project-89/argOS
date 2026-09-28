import { addEntity, addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, Name, Goal, Room, LastToolResult, ToolResult, KanbanBoard, KanbanCard, KanbanColumn, Plan, Traits } from "../../ecs/components";
import { HasGoal, HasPlan, HasToolResult } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { createDynamicComponent } from "../../ecs/dynamic-components";
import { evaluateGoalSuccessContract } from "../goal-evaluation-system";
import { createGoalEvaluationSystem } from "../builtin-systems";
import { createSystemRegistry, registerSystem, runSystems } from "../../ecs/dynamic-systems";
import { recordCompletedGoalAction } from "../../cognition/cognition-system";
import { getAgentProceduralSkills } from "../../cognition/procedural-skills";

function fixture(success: unknown) {
  const world = createArgosWorld("goal proof");
  const agent = addEntity(world); addComponent(world, agent, Agent); Agent.active[agent] = true;
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, agent, HasGoal(goal));
  Goal.status[goal] = "active"; Goal.createdAt[goal] = 1_000; Goal.successJson[goal] = JSON.stringify(success);
  const evaluate = () => evaluateGoalSuccessContract(world, agent, goal).satisfied;
  return { world, agent, goal, evaluate };
}

describe("Goal evidence is exact, current and world-local", () => {
  test.each([null, {}, { type: "all_of" }, { type: "all_of", conditions: [] }, { type: "all_of", conditions: [null] }])(
    "malformed/empty proof %j does not complete or throw", success => {
      const f = fixture(success); expect(f.evaluate()).toBe(false);
    });

  test.each(["Basement Landing", "Old Basement", "Basement Annex"])("%s is not proof of entering Basement", name => {
    const f = fixture({ type: "in_room", roomName: "Basement" });
    const room = addEntity(f.world); addComponent(f.world, room, Room); addComponent(f.world, room, Name); Name.value[room] = name;
    setLocatedIn(f.world, f.agent, room); expect(f.evaluate()).toBe(false);
    Name.value[room] = "The Basement"; expect(f.evaluate()).toBe(true);
  });

  test.each(["tool_exit_code_equals", "tool_stdout_includes"])("stale legacy %s evidence is rejected", type => {
    const f = fixture({ type, toolId: "terminal.run", equals: 0, includes: "PASS" });
    addComponent(f.world, f.agent, LastToolResult);
    LastToolResult.toolId[f.agent] = "terminal.run"; LastToolResult.exitCode[f.agent] = 0; LastToolResult.stdout[f.agent] = "PASS";
    LastToolResult.timestamp[f.agent] = 999;
    expect(f.evaluate()).toBe(false);
    LastToolResult.timestamp[f.agent] = 1_001;
    expect(f.evaluate()).toBe(true);
  });

  test("a tool result explicitly attached to another goal is not borrowed", () => {
    const f = fixture({ type: "tool_exit_code_equals", toolId: "terminal.run", equals: 0 });
    const evidence = addEntity(f.world); addComponent(f.world, evidence, ToolResult); addComponent(f.world, f.agent, HasToolResult(evidence));
    ToolResult.timestamp[evidence] = 1_100; ToolResult.toolId[evidence] = "terminal.run"; ToolResult.exitCode[evidence] = 0;
    ToolResult.goalEid[evidence] = f.goal + 99;
    expect(f.evaluate()).toBe(false);
    addComponent(f.world, f.agent, LastToolResult); LastToolResult.toolId[f.agent] = "terminal.run";
    LastToolResult.command[f.agent] = ""; ToolResult.command[evidence] = "";
    LastToolResult.timestamp[f.agent] = 1_100; LastToolResult.exitCode[f.agent] = 0;
    expect(f.evaluate()).toBe(false);
    ToolResult.goalEid[evidence] = f.goal;
    expect(f.evaluate()).toBe(true);
  });

  test("a newer failed matching tool result supersedes the earlier success", () => {
    const f = fixture({ type: "tool_exit_code_equals", toolId: "terminal.run", equals: 0 });
    for (const [timestamp, code] of [[1_100, 0], [1_200, 1]]) {
      const evidence = addEntity(f.world); addComponent(f.world, evidence, ToolResult); addComponent(f.world, f.agent, HasToolResult(evidence));
      ToolResult.timestamp[evidence] = timestamp; ToolResult.toolId[evidence] = "terminal.run"; ToolResult.exitCode[evidence] = code; ToolResult.goalEid[evidence] = f.goal;
    }
    expect(f.evaluate()).toBe(false);
  });

  test("a specified missing board cannot match a different board's finished card", () => {
    const f = fixture({ type: "kanban_card_in_column", boardName: "Rescue", cardTitle: "Find Mara", columnName: "Done" });
    const board = addEntity(f.world); addComponent(f.world, board, KanbanBoard); addComponent(f.world, board, Name); Name.value[board] = "Unrelated";
    const column = addEntity(f.world); addComponent(f.world, column, KanbanColumn); addComponent(f.world, column, Name); Name.value[column] = "Done"; setLocatedIn(f.world, column, board);
    const card = addEntity(f.world); addComponent(f.world, card, KanbanCard); addComponent(f.world, card, Name); Name.value[card] = "Find Mara"; setLocatedIn(f.world, card, column);
    expect(f.evaluate()).toBe(false); Name.value[board] = "Rescue"; expect(f.evaluate()).toBe(true);
  });

  test("deleted dynamic artifacts cannot satisfy a goal through stale sparse arrays", () => {
    const f = fixture({ type: "repo_file_contains", path: "proof.txt", includes: "verified" });
    const component = createDynamicComponent({ name: "RepoFile", description: "proof", properties: { path: "string", content: "string" } });
    const file = addEntity(f.world); addComponent(f.world, file, Name); Name.value[file] = "proof.txt"; addComponent(f.world, file, component);
    component.path[file] = "proof.txt"; component.content[file] = "verified";
    expect(f.evaluate()).toBe(true); removeEntity(f.world, file); expect(f.evaluate()).toBe(false);
  });

  test("learns the verified action episode instead of an earlier completed plan fragment", () => {
    const f = fixture({ type: "has_trait", trait: "relay_verified" });
    addComponent(f.world, f.agent, Name); Name.value[f.agent] = "Mara";
    Goal.description[f.goal] = "Service and verify the relay"; Goal.priority[f.goal] = 7;

    const fragment = addEntity(f.world); addComponent(f.world, fragment, Plan); addComponent(f.world, f.agent, HasPlan(fragment));
    Plan.goalEid[fragment] = f.goal; Plan.status[fragment] = "completed"; Plan.createdAt[fragment] = 1_000; Plan.lastUpdated[fragment] = 1_100;
    Plan.steps[fragment] = JSON.stringify([
      { description: "Isolate power", actionType: "interact", target: "Relay", content: "isolate" },
      { description: "Go to parts", actionType: "move", target: "Parts Cage" },
    ]);

    const episode = [
      { type: "interact", target: "Relay", content: "isolate" },
      { type: "move", target: "Parts Cage" },
      { type: "pickup", target: "Cartridge" },
      { type: "move", target: "Relay Room" },
      { type: "interact", target: "Relay", content: "install" },
      { type: "interact", target: "Relay", content: "restart" },
      { type: "wait" },
      { type: "interact", target: "Relay", content: "verify" },
    ];
    for (const action of episode) recordCompletedGoalAction(f.world, f.agent, action, f.goal);
    addComponent(f.world, f.agent, Traits); Traits.active[f.agent] = JSON.stringify(["relay_verified"]);

    const registry = createSystemRegistry(); registerSystem(registry, createGoalEvaluationSystem());
    runSystems(f.world, registry, 1, 1_000);

    expect(Goal.status[f.goal]).toBe("completed");
    const learned = getAgentProceduralSkills(f.world, f.agent);
    expect(learned).toHaveLength(1);
    expect(learned[0].skill.steps).toEqual([
      { type: "interact", target: "Relay", content: "isolate" },
      { type: "move", target: "Parts Cage" },
      { type: "interact", target: "Cartridge", content: "take" },
      { type: "move", target: "Relay Room" },
      { type: "interact", target: "Relay", content: "install" },
      { type: "interact", target: "Relay", content: "restart" },
      { type: "wait" },
      { type: "interact", target: "Relay", content: "verify" },
    ]);
  });
});
