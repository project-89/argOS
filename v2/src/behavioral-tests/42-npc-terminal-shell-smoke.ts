/**
 * Smoke Test: NPC uses a real shell terminal via an in-world computer.
 *
 * This is NOT deterministic CI. It requires enabling shell execution.
 *
 * Setup:
 * - `OFFICE_TOOLS_ALLOW_SHELL=1`
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_SHELL=1 npx tsx src/behavioral-tests/42-npc-terminal-shell-smoke.ts
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
import { setAgentBehaviorPolicy, type BehaviorNode } from "../cognition/behavior-policy";
import { agentThink } from "../cognition/agent-mind";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  if (process.env.OFFICE_TOOLS_ALLOW_SHELL !== "1") {
    throw new Error("Set OFFICE_TOOLS_ALLOW_SHELL=1 to run this smoke test.");
  }

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("NpcTerminalShellSmoke") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const room = createRoomEntity(world as any, { name: "Office" });
  registerEntity(room, "Office");

  const computer = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Ivy", role: "npc", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Ivy");

  // In shell mode, office tools run in a per-simulation sandbox directory. Verify it by checking for
  // the marker file created by the sandbox helper, then print "hello".
  const cmd = `ls -a && node -e "console.log('hello')"`;

  const tree: BehaviorNode = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "has_goal", includes: "node -e" } },
          { type: "interact_with_trait", trait: "computer", affordance: "run_command", args: cmd, scope: "room" },
        ],
      },
      { type: "action", action: { type: "wait" } },
    ],
  };
  setAgentBehaviorPolicy(world as any, npc, tree, true);

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = `Run the command ${cmd} in the terminal.`;
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: { command: cmd },
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "node -e", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "ls -a", includes: ".argos_sandbox" },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "node -e", includes: "hello" },
      ],
    },
    description: Goal.description[goalEid],
  });

  for (let i = 0; i < 30; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    const action = await agentThink(world as any, npc);
    executeActions(world as any, [{ eid: npc, action: action as any }], registry as any);
    const stimuli = drainPendingStimuli();
    // helpful debug if it fails
    for (const s of stimuli) {
      if (s.type === "tool_result") console.log(s.content.slice(0, 500));
    }
    runSystems(world as any, registry as any, i, 16);
    await yieldForOfficeToolJobs(world as any, 50);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected goal completion");
  console.log("✓ NPC terminal shell smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
