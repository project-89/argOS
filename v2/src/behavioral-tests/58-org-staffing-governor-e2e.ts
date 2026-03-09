/**
 * Behavioral E2E: Staffing & delegation governor (spawn → assign → execute → Done)
 *
 * Proves:
 * - Optional OrgStaffingGovernor can observe Backlog and spawn/assign an agent.
 * - OrgGovernance "must-route-through" + DoD gates stay deterministic and enforceable.
 * - Contract-driven cognition can satisfy tool-based success criteria and close the ticket.
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/58-org-staffing-governor-e2e.ts
 */
import "dotenv/config";

import { addComponent, addEntity, entityExists, getRelationTargets, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../ecs/prefabs";
import { Agent, Goal, KanbanBoard, KanbanCard, KanbanColumn, Name, OrgGovernance, OrgStaffingGovernor } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { listDirectContents } from "../ecs/location";
import { ObjectManager, worldSchema } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOrgStaffingGovernorSystem } from "../systems/org-staffing-governor-system";
import { agentThink } from "../cognition/agent-mind";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function findBoard(world: any, name: string): number | undefined {
  for (const eid of Array.from(query(world as any, [KanbanBoard] as any))) {
    if (!entityExists(world as any, eid)) continue;
    if (String(Name.value[eid] || "") === name) return eid;
  }
  return undefined;
}

function findColumn(world: any, boardEid: number, name: string): number | undefined {
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!entityExists(world as any, col)) continue;
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    if (String(Name.value[col] || KanbanColumn.name[col] || "") === name) return col;
  }
  return undefined;
}

function cardInColumn(world: any, boardEid: number, cardTitle: string, columnName: string): boolean {
  const col = findColumn(world, boardEid, columnName);
  if (col === undefined) return false;
  for (const card of listDirectContents(world as any, col)) {
    if (!hasComponent(world as any, card, KanbanCard as any)) continue;
    const title = String(Name.value[card] || KanbanCard.title[card] || "");
    if (title === cardTitle) return true;
  }
  return false;
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed test");
    process.exit(0);
  }

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const unique = String(Date.now());
  const boardType = `kanban_board_device_staffing_${unique}`;
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
    name: "kanban_list",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.list", toolInputFrom: "static", toolInput: {}, toolResultType: "tool_result" }],
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

  const world = createArgosWorld("OrgStaffingGovernorE2E") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  // Systems: staffing governor + goal evaluation.
  const staffing = createOrgStaffingGovernorSystem();
  staffing.frequency = 0;
  registerSystem(registry as any, staffing as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "Office." });
  registerEntity(room, "Office");

  const board = objectManager.spawn(boardType, { name: "Team Board", containedIn: room })!;
  registerEntity(board, "Team Board");

  const workstation = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(workstation, "Workstation");

  const manager = createAgentEntity(world as any, { name: "Manager", role: "pm", systemPrompt: "x", roomId: room });
  registerEntity(manager, "Manager");

  // Prepare a passing workspace fixture BEFORE enabling governance (so no ticket is required yet).
  executeActions(
    world as any,
    [{ eid: manager, action: { type: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"node_tests_pass_1"}' } }] as any,
    registry as any
  );
  drainPendingStimuli();

  // Initialize board and create a backlog card (manager action).
  executeActions(
    world as any,
    [
      { eid: manager, action: { type: "interact", target: "Team Board", content: 'kanban_init {"columns":["Backlog","In Progress","Review","Done"]}' } },
      { eid: manager, action: { type: "interact", target: "Team Board", content: 'kanban_upsert_card {"title":"Verify workspace tests","column":"Backlog","description":"Run `node test.cjs` and move to Done."}' } },
    ] as any,
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 0, 16);

  // Enable governance (must have ticket for work tools + DoD requires passing tests).
  const govEid = addEntity(world as any);
  addComponent(world as any, govEid, Name as any);
  addComponent(world as any, govEid, OrgGovernance as any);
  Name.value[govEid] = "Org Governance";
  OrgGovernance.enabled[govEid] = true;
  OrgGovernance.requireTicketForWork[govEid] = true;
  OrgGovernance.wipLimit[govEid] = 2;
  OrgGovernance.doneRequiresToolId[govEid] = "terminal.run";
  OrgGovernance.doneRequiresCommandIncludes[govEid] = "node test.cjs";

  // Enable staffing governor (spawn 1 engineer).
  const staffingEid = addEntity(world as any);
  addComponent(world as any, staffingEid, Name as any);
  addComponent(world as any, staffingEid, OrgStaffingGovernor as any);
  Name.value[staffingEid] = "Staffing Governor";
  OrgStaffingGovernor.enabled[staffingEid] = true;
  OrgStaffingGovernor.boardName[staffingEid] = "Team Board";
  OrgStaffingGovernor.spawnRoomName[staffingEid] = "Office";
  OrgStaffingGovernor.defaultRole[staffingEid] = "engineer";
  OrgStaffingGovernor.maxAgents[staffingEid] = 1;
  OrgStaffingGovernor.wipPerAgent[staffingEid] = 1;

  // Ticket goal contract: pass `node test.cjs` then move card to Done.
  // (The staffing system creates this goal automatically; this contract mirrors its default.)
  const maxTicks = 80;
  let spawnedEngineer: number | undefined;

  for (let tick = 0; tick < maxTicks; tick++) {
    // Run org governor + goal evaluation.
    runSystems(world as any, registry as any, tick, 16);

    // Discover spawned engineer (not the manager).
    const agents = Array.from(query(world as any, [Agent] as any)).filter((eid) => entityExists(world as any, eid));
    spawnedEngineer = agents.find((eid) => String(Name.value[eid] || "") !== "Manager");

    // Let agents think/act.
    const batch: Array<{ eid: number; action: any }> = [];
    for (const eid of agents) {
      const name = String(Name.value[eid] || "");
      if (!name || name === "Manager") continue;
      const action = await agentThink(world as any, eid);
      if (action && action.type && action.type !== "wait") batch.push({ eid, action });
    }
    if (batch.length) executeActions(world as any, batch as any, registry as any);
    drainPendingStimuli();

    // Re-run systems so ToolResult evidence is evaluated and goals can complete quickly.
    runSystems(world as any, registry as any, tick, 16);
    await yieldForOfficeToolJobs(world as any, 50);

    const boardEid = findBoard(world, "Team Board");
    if (boardEid !== undefined && cardInColumn(world, boardEid, "Verify workspace tests", "Done")) break;
  }

  assert(spawnedEngineer !== undefined, "expected staffing governor to spawn an engineer");

  const boardEid = findBoard(world, "Team Board");
  assert(boardEid !== undefined, "expected board to exist");
  assert(cardInColumn(world, boardEid!, "Verify workspace tests", "In Progress") || cardInColumn(world, boardEid!, "Verify workspace tests", "Done"), "expected ticket to be claimed");
  assert(cardInColumn(world, boardEid!, "Verify workspace tests", "Done"), "expected ticket to reach Done");

  // Ensure the engineer has an active/complete goal and it completed.
  const goalEids = getRelationTargets(world as any, spawnedEngineer!, HasGoal as any) as number[];
  const relevant = goalEids.filter((gid) => hasComponent(world as any, gid, Goal as any) && String(Goal.description[gid] || "").includes("Verify workspace tests"));
  assert(relevant.length > 0, "expected engineer to have a ticket goal");
  assert(relevant.some((gid) => String(Goal.status[gid] || "") === "completed"), "expected ticket goal to be completed");

  console.log("✓ org staffing governor e2e passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
