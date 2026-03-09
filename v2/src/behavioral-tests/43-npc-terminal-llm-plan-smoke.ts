/**
 * Smoke Test (LLM): NPC generates a plan to use a computer terminal and completes a typed goal.
 *
 * This is an opt-in, non-deterministic smoke test:
 * - Requires `GOOGLE_GENERATIVE_AI_API_KEY`
 * - Uses LLM plan generation (`generatePlanForGoal`)
 * - Executes the plan steps deterministically (no LLM action selection) to validate the plan is grounded
 *
 * Run:
 *   npx tsx src/behavioral-tests/43-npc-terminal-llm-plan-smoke.ts
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
import { createPlanEntity, generatePlanForGoal, getNextPlannedAction } from "../cognition/planning-system";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    console.log("SKIP: GOOGLE_GENERATIVE_AI_API_KEY not set");
    process.exit(0);
  }

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  // Scripted terminal.run: succeed for echo hello.
  registerOfficeTool("terminal.run", (params) => {
    let command = String(params?.command ?? "");
    // Be tolerant of LLM formatting like backticks or quotes.
    const trimmed = command.trim();
    if (
      trimmed === "echo hello" ||
      trimmed === "`echo hello`" ||
      trimmed === "\"echo hello\"" ||
      trimmed.includes("echo hello")
    ) {
      return { ok: true, summary: "echo hello", stdout: "hello\n", exitCode: 0 };
    }
    return { ok: true, summary: `ran: ${command}`, stdout: "", exitCode: 0 };
  });

  const world = createArgosWorld("NpcTerminalLlmPlanSmoke") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office with a workstation." });
  registerEntity(room, "Office");

  const computer = objectManager.spawn("computer", { name: "Workstation", state: "powered_on", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, { name: "Noah", role: "npc", systemPrompt: "You are an NPC that uses tools.", roomId: room });
  registerEntity(npc, "Noah");

  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, npc, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "On the Workstation, run the command echo hello using the run_command affordance.";
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

  const generated = await generatePlanForGoal(world as any, npc, goalEid);
  assert(generated, "LLM did not generate a plan");
  console.log("Generated plan steps:");
  for (const s of generated!.steps) console.log(`- ${s.actionType} ${s.target || ""} ${s.content || ""}`.trim());

  createPlanEntity(world as any, npc, goalEid, generated!);

  // Execute plan steps deterministically.
  for (let i = 0; i < 20; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;
    const step = getNextPlannedAction(world as any, npc);
    if (!step) break;
    executeActions(world as any, [{ eid: npc, action: { type: step.actionType, target: step.target, content: step.content } as any }], registry as any);
    drainPendingStimuli();
    runSystems(world as any, registry as any, i, 16);
  }

  assert(String(Goal.status[goalEid] || "") === "completed", "Expected goal completion via LLM-generated plan");
  console.log("✓ NPC LLM plan smoke passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
