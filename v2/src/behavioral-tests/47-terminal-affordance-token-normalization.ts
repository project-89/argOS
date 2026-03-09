/**
 * Behavioral Test: Affordance token normalization for tool-backed interactions.
 *
 * Repro class: LLMs sometimes emit "run_command:" (with punctuation) as the affordance token.
 * The engine should normalize this and still execute the underlying affordance/tool.
 *
 * Run:
 *   npx tsx src/behavioral-tests/47-terminal-affordance-token-normalization.ts
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

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  // Deterministic mode (no LLM key required).
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  registerOfficeTool("terminal.run", (params) => {
    const command = String(params?.command ?? "");
    if (command.trim() === "echo hello") {
      return { ok: true, summary: "echo hello", stdout: "hello\n", exitCode: 0 };
    }
    return { ok: false, summary: `unexpected command: ${command}`, stderr: "expected echo hello", exitCode: 2 };
  });

  const world = createArgosWorld("TerminalAffordanceTokenNormalization") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office with a computer." });
  registerEntity(room, "Office");

  const computer = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Noah", role: "npc", systemPrompt: "x", roomId: room });
  registerEntity(npc, "Noah");

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "On the Workstation, run echo hello.";
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

  executeActions(
    world as any,
    [{ eid: npc, action: { type: "interact", target: "Workstation", content: "run_command: echo hello" } as any }],
    registry as any
  );
  drainPendingStimuli();
  runSystems(world as any, registry as any, 0, 16);

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(String(Goal.status[goalEid] || "") === "completed", "expected goal completion after normalized run_command:");
  console.log("✓ affordance token normalization works");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

