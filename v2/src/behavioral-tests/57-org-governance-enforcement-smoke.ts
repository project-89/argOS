/**
 * Behavioral Smoke Test: Optional org governance enforcement (must-route-through + WIP + DoD)
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/57-org-governance-enforcement-smoke.ts
 */
import "dotenv/config";

import { addComponent, addEntity, getRelationTargets, hasComponent } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Name, OrgGovernance, ToolResult } from "../ecs/components";
import { HasGoal, HasToolResult } from "../ecs/relations";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { hasPendingOfficeToolJobs, yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function hasFailureStimulus(stimuli: any[], includes: string): boolean {
  return stimuli.some((s) => String(s?.type || "") === "action_failed" && String(s?.content || "").includes(includes));
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed test");
    process.exit(0);
  }

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  // Minimal board/wiki device types + affordances for this test.
  const unique = String(Date.now());
  const boardType = `kanban_board_device_governance_${unique}`;
  worldSchema.defineObjectType({
    name: boardType,
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "office",
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_upsert_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.upsert_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);
  worldSchema.defineAffordance({
    name: "kanban_move_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  } as any);

  const world = createArgosWorld("OrgGovernanceEnforcementSmoke") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "Office." });
  registerEntity(room, "Office");

  const board = objectManager.spawn(boardType, { name: "Team Board", containedIn: room })!;
  registerEntity(board, "Team Board");

  const workstation = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(workstation, "Workstation");

  const agent = createAgentEntity(world as any, { name: "Avery", role: "engineer", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Avery");

  // Enable governance.
  const govEid = addEntity(world as any);
  addComponent(world as any, govEid, Name as any);
  addComponent(world as any, govEid, OrgGovernance as any);
  Name.value[govEid] = "Org Governance";
  OrgGovernance.enabled[govEid] = true;
  OrgGovernance.requireTicketForWork[govEid] = true;
  OrgGovernance.wipLimit[govEid] = 1;
  OrgGovernance.doneRequiresToolId[govEid] = "terminal.run";
  OrgGovernance.doneRequiresCommandIncludes[govEid] = "test.cjs";

  // Set up a goal that will be satisfied only after a passing test run evidence exists.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Pass tests";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: {},
    success: { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
    description: "Pass tests",
  });

  // Initialize board + create card.
  executeActions(
    world as any,
    [
      { eid: agent, action: { type: "interact", target: "Team Board", content: 'kanban_init {"columns":["Backlog","In Progress","Done"]}' } },
      { eid: agent, action: { type: "interact", target: "Team Board", content: 'kanban_upsert_card {"title":"Fix add()","column":"Backlog"}' } },
    ] as any,
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 0, 16);

  // Attempt to run work tool without an in-progress owned card: should be blocked by org policy.
  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } }] as any, registry as any);
  const s1 = drainPendingStimuli();
  assert(hasFailureStimulus(s1, "Org policy"), "expected org policy to block terminal.run without claimed ticket");

  // Claim the card by moving to In Progress (sets ownership).
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: 'kanban_move_card {"title":"Fix add()","toColumn":"In Progress"}' } }] as any,
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 1, 16);

  // Now work tools should be allowed.
  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } }] as any, registry as any);
  const s2 = drainPendingStimuli();
  assert(!hasFailureStimulus(s2, "Org policy"), "expected terminal.run to be allowed after claiming ticket");
  for (let tick = 0; tick < 80 && hasPendingOfficeToolJobs(world as any); tick++) {
    runSystems(world as any, registry as any, tick + 10, 16);
    drainPendingStimuli();
    await yieldForOfficeToolJobs(world as any, 50);
  }

  // DoD gate: moving to Done should be blocked until tests pass.
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: 'kanban_move_card {"title":"Fix add()","toColumn":"Done"}' } }] as any,
    registry as any
  );
  const s3 = drainPendingStimuli();
  assert(s3.some((x) => String(x?.type || "") === "tool_result" && String(x?.content || "").includes("DoD gate blocked")), "expected DoD gate to block Done");

  // Create passing evidence: use fixture + run test.
  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"node_bugfix_1"}' } }] as any, registry as any);
  drainPendingStimuli();
  runSystems(world as any, registry as any, 2, 16);

  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command node test.cjs" } }] as any, registry as any);
  for (let tick = 0; tick < 120; tick++) {
    runSystems(world as any, registry as any, tick + 20, 16);
    drainPendingStimuli();
    if (!hasPendingOfficeToolJobs(world as any)) break;
    await yieldForOfficeToolJobs(world as any, 50);
  }

  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Workstation", content: 'write_file {"path":"math.cjs","content":"exports.add = (a, b) => a + b;\\n"}' } }] as any,
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 3, 16);

  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command node test.cjs" } }] as any, registry as any);
  for (let tick = 0; tick < 160; tick++) {
    runSystems(world as any, registry as any, tick + 40, 16);
    drainPendingStimuli();
    if (!hasPendingOfficeToolJobs(world as any)) break;
    await yieldForOfficeToolJobs(world as any, 50);
  }
  runSystems(world as any, registry as any, 4, 16);

  // Now moving to Done should be allowed.
  const toolEids = getRelationTargets(world as any, agent, HasToolResult as any) as number[];
	  const passing = toolEids
	    .filter((eid) => hasComponent(world as any, eid, ToolResult as any))
	    .filter((eid) => String(ToolResult.toolId[eid] || "") === "terminal.run")
	    .filter((eid) => String(ToolResult.command[eid] || "").includes("test.cjs"))
	    .filter((eid) => Number(ToolResult.exitCode[eid] ?? 1) === 0);
  if (passing.length === 0) {
    const summary = toolEids
      .filter((eid) => hasComponent(world as any, eid, ToolResult as any))
      .slice(-6)
      .map((eid) => ({
        eid,
        toolId: ToolResult.toolId[eid],
        command: ToolResult.command[eid],
        ok: ToolResult.ok[eid],
        exitCode: ToolResult.exitCode[eid],
      }));
    console.log("DEBUG ToolResult targets:", summary);
    throw new Error("expected a passing terminal.run ToolResult evidence before moving card to Done");
  }

  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Team Board", content: 'kanban_move_card {"title":"Fix add()","toColumn":"Done"}' } }] as any,
    registry as any
  );
  const s4 = drainPendingStimuli();
  assert(!s4.some((x) => String(x?.type || "") === "tool_result" && String(x?.content || "").includes("DoD gate blocked")), "expected DoD gate to allow Done after passing tests");

  // Goal evaluation should complete (evidence now robust via ToolResult).
  runSystems(world as any, registry as any, 3, 16);
  assert(String(Goal.status[goalEid] || "") === "completed", "expected goal to be completed after passing test evidence");

  console.log("✓ org governance enforcement smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
