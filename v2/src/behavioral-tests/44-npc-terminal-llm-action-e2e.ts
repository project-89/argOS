/**
 * End-to-End Test (LLM): NPC generates a plan AND uses LLM action selection to execute it in-world.
 *
 * This is an opt-in, non-deterministic behavioral test:
 * - Requires `GOOGLE_GENERATIVE_AI_API_KEY`
 * - Uses LLM plan generation (`generatePlanForGoal`)
 * - Uses LLM action selection (`processAgentCognition` → `agentThink`)
 * - Relies on deterministic safety rails:
 *   - action validation + normalization in `executeActions`
 *   - failure recovery ladder in `agentThink`
 *   - deterministic goal contract evaluation in `GoalEvaluationSystem`
 *
 * Run:
 *   npx tsx src/behavioral-tests/44-npc-terminal-llm-action-e2e.ts
 */
import "dotenv/config";

import { addComponent, addEntity } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { createPlanEntity, generatePlanForGoal } from "../cognition/planning-system";
import { processAgentCognition } from "../cognition/agent-mind";

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
    const command = String(params?.command ?? "");
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

  const world = createArgosWorld("NpcTerminalLlmActionE2E") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const room = createRoomEntity(world as any, { name: "Office", description: "An office with a workstation." });
  registerEntity(room, "Office");

  worldSchema.defineObjectType({
    name: "computer_44",
    description: "A workstation computer",
    traits: ["computer", "examinable"],
    states: { idle: { description: "A workstation computer is on.", traits: ["computer"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "run_command",
    requires: ["computer"],
    effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });

  const computer = objectManager.spawn("computer_44", { name: "Workstation", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const npc = createAgentEntity(world as any, {
    name: "Noah",
    role: "npc",
    systemPrompt: "You are an NPC that uses tools. When you have an active plan, follow the current step.",
    roomId: room,
  });
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

  // Phase 1: generate plan (LLM)
  const generated = await generatePlanForGoal(world as any, npc, goalEid);
  assert(generated, "LLM did not generate a plan");
  console.log("Generated plan steps:");
  for (const s of generated!.steps) console.log(`- ${s.actionType} ${s.target || ""} ${s.content || ""}`.trim());
  createPlanEntity(world as any, npc, goalEid, generated!);

  // Phase 2: execute using LLM action selection + deterministic safety rails
  const actions: Array<{ type: string; target?: string; content?: string }> = [];
  for (let i = 0; i < 25; i++) {
    if (String(Goal.status[goalEid] || "") === "completed") break;

    const pending = drainPendingStimuli()
      .filter((s) => s.targetEid === npc)
      .map((s) => ({ type: s.type, content: s.content, source: s.source }));

    const next = await processAgentCognition(world as any, npc, pending);
    actions.push({ type: next.type, target: (next as any).target, content: (next as any).content });
    executeActions(world as any, [{ eid: npc, action: next as any }], registry as any);

    runSystems(world as any, registry as any, i, 16);
  }

  console.log("Actions taken:");
  for (const a of actions.slice(0, 25)) {
    console.log(`- ${a.type}${a.target ? ` ${a.target}` : ""}${a.content ? ` :: ${a.content}` : ""}`);
  }

  assert(String(Goal.status[goalEid] || "") === "completed", "Expected goal completion via LLM action selection");
  assert(actions.some((a) => a.type === "interact"), "Expected at least one interact action");
  console.log("✓ NPC LLM action-selection E2E passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

