/**
 * Behavioral Test: NPC uses a computer terminal via deterministic BehaviorPolicy.
 *
 * Goal:
 * - Prove an NPC can use an in-world computer to run a terminal command (scripted tool),
 *   and complete a typed goal contract via deterministic evaluation.
 *
 * Run:
 *   npx tsx src/behavioral-tests/41-npc-uses-computer-terminal-policy.ts
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
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { setAgentBehaviorPolicy, type BehaviorNode } from "../cognition/behavior-policy";
import { agentThink } from "../cognition/agent-mind";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  // Deterministic mode (no LLM key required).
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  // Scripted terminal.run: succeed for `echo hello`.
  registerOfficeTool("terminal.run", (params) => {
    const command = String(params?.command ?? "");
    if (command.trim() === "echo hello") {
      return { ok: true, summary: "echo hello", stdout: "hello\n", exitCode: 0 };
    }
    return { ok: true, summary: `unknown command: ${command}`, stdout: "", exitCode: 0 };
  });

  const world = createArgosWorld("NpcUsesTerminalPolicy") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office." });
  registerEntity(room, "Office");

  const computer = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Nina", role: "npc", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Nina");

  // Policy: if the agent has the goal text, run `echo hello` on any computer in the room.
  const tree: BehaviorNode = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "has_goal", includes: "echo hello" } },
          { type: "interact_with_trait", trait: "computer", affordance: "run_command", args: "echo hello", scope: "room" },
        ],
      },
      { type: "action", action: { type: "wait" } },
    ],
  };
  setAgentBehaviorPolicy(world as any, npc, tree, true);

  // Goal contract: tests that the NPC actually ran the command successfully and got expected stdout.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Use the workstation terminal to echo hello.";
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: { command: "echo hello" },
    success: {
      type: "all_of",
      conditions: [
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "echo hello", equals: 0 },
        { type: "tool_stdout_includes", toolId: "terminal.run", commandIncludes: "echo hello", includes: "hello" },
      ],
    },
    description: Goal.description[goalEid],
  });

  // Tick until the agent completes the goal.
  for (let i = 0; i < 10; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    const action = await agentThink(world as any, npc);
    executeActions(world as any, [{ eid: npc, action: action as any }], registry as any);
    drainPendingStimuli();
    runSystems(world as any, registry as any, i, 16);
  }

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected NPC to complete the terminal goal via policy");
  console.log("✓ NPC uses computer terminal via policy");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
