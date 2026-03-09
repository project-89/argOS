/**
 * Behavioral Test: Multi-step Procedural Runner (No LLM)
 *
 * Verifies that a multi-step procedure (stored as procedural Memory) executes across ticks:
 * - Step 1: use computer terminal (tool)
 * - Step 2: write a note (tool)
 *
 * Run:
 *   npx tsx src/behavioral-tests/25-multistep-procedure-runner-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld, getRelationTargets, hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Memory, ProcedureState } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createPlanEntity } from "../cognition/planning-system";
import { serializeProceduralSkillV1, type ProceduralSkillV1 } from "../cognition/procedural-skills";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function addProceduralMemory(world: any, agentEid: number, skill: ProceduralSkillV1): void {
  const memEid = addEntity(world);
  addComponent(world, memEid, Memory as any);
  addComponent(world, agentEid, HasMemory(memEid) as any);
  Memory.type[memEid] = "procedural";
  Memory.content[memEid] = serializeProceduralSkillV1(skill);
  Memory.importance[memEid] = 0.8;
  Memory.emotionalValence[memEid] = 0;
  Memory.timestamp[memEid] = Date.now();
  Memory.lastRecalled[memEid] = Date.now();
  Memory.recallCount[memEid] = 0;
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  MULTI-STEP PROCEDURE RUNNER TEST");
  console.log("═".repeat(70) + "\n");

  // Hard-disable LLM: we want deterministic procedure execution.
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();
  registerOfficeTool("terminal.run", (params) => {
    const command = String(params?.command ?? "");
    if (command.includes("echo hello")) return { ok: true, summary: "echo ran", stdout: "hello\n" };
    return { ok: false, summary: `unknown command: ${command}`, stderr: "scripted tool: no match" };
  });

  const world = createWorld();
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const room = createRoomEntity(world as any, {
    name: "Office",
    description: "A small office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(room, "Office");

  // Objects + affordances
  worldSchema.defineObjectType({
    name: "computer",
    description: "A workstation computer",
    traits: ["computer", "examinable"],
    states: { idle: { description: "A workstation computer is on and ready.", traits: ["computer"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "run_command",
    requires: ["computer"],
    descriptionTemplate: "{actor.name} types a command into the terminal.",
    effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });

  worldSchema.defineObjectType({
    name: "notebook",
    description: "A paper notebook",
    traits: ["notebook", "examinable"],
    states: { idle: { description: "A notebook lies open.", traits: ["notebook"] } },
    defaultState: "idle",
    category: "item",
  });
  worldSchema.defineAffordance({
    name: "take_note",
    requires: ["notebook"],
    descriptionTemplate: "{actor.name} writes a note.",
    effects: [{ type: "run_tool", toolId: "notes.append", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });

  const agent = createAgentEntity(world as any, {
    name: "Casey",
    role: "Engineer",
    systemPrompt: "You are Casey.",
    roomId: room,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Casey");

  const computer = objectManager.spawn("computer", { name: "Workstation", containedIn: room })!;
  registerEntity(computer, "Workstation");
  const notebook = objectManager.spawn("notebook", { name: "Notebook", containedIn: room })!;
  registerEntity(notebook, "Notebook");

  // Multi-step skill: trigger is "run_command echo hello", then it writes a note.
  const signature = "run_command|echo hello";
  const skill: ProceduralSkillV1 = {
    kind: "procedure_v1",
    signature,
    name: "Verify terminal then note",
    trigger: { affordance: "run_command" },
    steps: [
      { type: "interact", target: "Workstation", content: "run_command echo hello" },
      { type: "interact", target: "Notebook", content: "take_note Terminal verified (echo hello)" },
    ],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() },
  };
  addProceduralMemory(world as any, agent, skill);

  // Plan requests the trigger step only; the procedure runner should continue to step 2 automatically.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Verify setup";
  Goal.priority[goalEid] = 5;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 60_000;

  createPlanEntity(world as any, agent, goalEid, {
    goalDescription: "Verify setup",
    steps: [{ description: "Run hello", actionType: "interact", target: "Workstation", content: "run_command echo hello" }],
    estimatedCompletion: "short",
    potentialObstacles: [],
  });

  // Tick 1: should start procedure and run the command
  const a1 = await agentThink(world as any, agent);
  assert(a1.type === "interact" && a1.target === "Workstation", "expected step 1 interact on Workstation");
  executeActions(world as any, [{ eid: agent, action: a1 as any }], registry);

  assert(hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState to be active after step 1");

  // Tick 2: should continue procedure and write the note
  const a2 = await agentThink(world as any, agent);
  assert(a2.type === "interact" && a2.target === "Notebook", "expected step 2 interact on Notebook");
  executeActions(world as any, [{ eid: agent, action: a2 as any }], registry);

  assert(!hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState to clear after completion");

  const pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("hello")), "expected tool_result from terminal");
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("Note saved")), "expected tool_result from notes.append");

  // Restore env
  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

