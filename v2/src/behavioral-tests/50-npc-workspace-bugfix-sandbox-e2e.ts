/**
 * Behavioral Test: NPC fixes a failing sandbox workspace test using a computer.
 *
 * Purpose:
 * - Prove office tools operate in a dedicated per-simulation sandbox directory
 * - Prove an NPC can (deterministically) use computer affordances to:
 *   - initialize a project fixture
 *   - run a failing test
 *   - read & write a file
 *   - rerun the test to green
 *
 * Notes:
 * - This is a shell-enabled smoke test. It skips unless:
 *   - OFFICE_TOOLS_ALLOW_SHELL=1
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/50-npc-workspace-bugfix-sandbox-e2e.ts
 */
import "dotenv/config";

import { addComponent, addEntity } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { createPlanEntity, getNextPlannedAction } from "../cognition/planning-system";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    console.log("SKIP: set OFFICE_TOOLS_ALLOW_SHELL=1 to run this shell-backed e2e test");
    process.exit(0);
  }

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("NpcWorkspaceBugfixSandboxE2E") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office with a workstation." });
  registerEntity(room, "Office");

  const computer = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Noah", role: "npc", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Noah");

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Fix the bug in add() so the workspace test passes.";
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
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node test.cjs", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node test.cjs", includes: "PASS" },
      ],
    },
    description: Goal.description[goalEid],
  });

  // A deterministic plan (no LLM): initialize fixture, show sandbox marker, run failing test, fix file, rerun.
  createPlanEntity(world as any, npc, goalEid, {
    steps: [
      { description: "Initialize the sandbox workspace fixture.", actionType: "interact", target: "Workstation", content: 'init_workspace_fixture {"fixtureId":"node_bugfix_1"}' },
      { description: "Confirm we are in the sandbox workspace (marker file present).", actionType: "interact", target: "Workstation", content: 'run_command ls -a' },
      { description: "Run the failing test to observe the bug.", actionType: "interact", target: "Workstation", content: "run_command node test.cjs", allowFailure: true },
      { description: "Read the buggy source file.", actionType: "interact", target: "Workstation", content: 'read_file {"path":"math.cjs"}' },
      { description: "Fix add() to return a+b.", actionType: "interact", target: "Workstation", content: 'write_file {"path":"math.cjs","content":"exports.add = (a, b) => a + b;\\n"}' },
      { description: "Rerun the test to confirm it passes.", actionType: "interact", target: "Workstation", content: "run_command node test.cjs" },
    ],
  } as any);

  for (let i = 0; i < 120; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    const step = getNextPlannedAction(world as any, npc);
    if (step) {
      executeActions(world as any, [{ eid: npc, action: { type: step.actionType, target: step.target, content: step.content } as any }], registry as any);
    }

    const before = drainPendingStimuli();
    for (const s of before) {
      if (s.type === "tool_result" && typeof s.content === "string") {
        console.log(s.content.slice(0, 400));
      }
    }

    runSystems(world as any, registry as any, i, 16);

    const after = drainPendingStimuli();
    for (const s of after) {
      if (s.type === "tool_result" && typeof s.content === "string") {
        console.log(s.content.slice(0, 400));
      }
    }

    await yieldForOfficeToolJobs(world as any, 50);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected the NPC to fix the workspace bug and pass the test");
  console.log("✓ NPC workspace sandbox bugfix e2e passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
