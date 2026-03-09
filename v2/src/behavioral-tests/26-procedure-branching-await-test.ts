/**
 * Behavioral Test: Procedure Branching via Awaited Evidence (No LLM)
 *
 * Verifies a procedure can branch based on evidence in Perceptions:
 * - Step 0: run terminal command (tool_result stimulus produced)
 * - Step 1: await tool_result content; on match -> success note; on mismatch -> failure note
 *
 * This test uses `runCognitionCycle` to ingest pending stimuli into Perception entities.
 *
 * Run:
 *   npx tsx src/behavioral-tests/26-procedure-branching-await-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Memory, ProcedureState } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity, runCognitionCycle } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createPlanEntity } from "../cognition/planning-system";
import { serializeProceduralSkillV1, type ProceduralSkillV1 } from "../cognition/procedural-skills";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { agentThink } from "../cognition/agent-mind";

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

async function runOnce(world: any, registry: any, agent: number, goalDescription: string): Promise<void> {
  // Step 1: choose and execute the trigger action deterministically (no LLM).
  const a1 = await agentThink(world, agent);
  executeActions(world, [{ eid: agent, action: a1 as any }], registry);

  // Step 2: pending tool_result is ingested into Perceptions, await step branches, and note is executed.
  const actionsB = await runCognitionCycle(world, registry, { maxAgents: 1, enablePlanning: false });
  executeActions(world, actionsB as any, registry);

  // Ensure procedure state cleared by end
  assert(!hasComponent(world, agent, ProcedureState as any), `expected ProcedureState cleared (${goalDescription})`);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  PROCEDURE BRANCHING (AWAIT) TEST");
  console.log("═".repeat(70) + "\n");

  // Disable LLM
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();
  registerOfficeTool("terminal.run", (params) => {
    const command = String(params?.command ?? "");
    if (command.includes("echo hello")) return { ok: true, summary: "echo ran", stdout: "hello\n" };
    if (command.includes("echo fail")) return { ok: true, summary: "echo ran", stdout: "nope\n" };
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

  // Two skills: one matches (hello), one mismatches (fail).
  const helloSig = "run_command|echo hello";
  addProceduralMemory(world as any, agent, {
    kind: "procedure_v1",
    signature: helloSig,
    name: "Run hello then note outcome",
    trigger: { affordance: "run_command" },
    steps: [
      { type: "interact", target: "Workstation", content: "run_command echo hello" },
      { type: "await", waitFor: { perceptionType: "tool_result", includes: "hello" }, onMatchNext: 2, onMismatchNext: 3 },
      { type: "interact", target: "Notebook", content: "take_note Terminal OK (hello)", onSuccessNext: 4 },
      { type: "interact", target: "Notebook", content: "take_note Terminal BAD (no hello)", onSuccessNext: 4 },
    ],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() },
  });

  const failSig = "run_command|echo fail";
  addProceduralMemory(world as any, agent, {
    kind: "procedure_v1",
    signature: failSig,
    name: "Run fail then note outcome",
    trigger: { affordance: "run_command" },
    steps: [
      { type: "interact", target: "Workstation", content: "run_command echo fail" },
      { type: "await", waitFor: { perceptionType: "tool_result", includes: "hello" }, onMatchNext: 2, onMismatchNext: 3 },
      { type: "interact", target: "Notebook", content: "take_note Terminal OK (unexpected)", onSuccessNext: 4 },
      { type: "interact", target: "Notebook", content: "take_note Terminal BAD (no hello)", onSuccessNext: 4 },
    ],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() },
  });

  // Scenario 1: match branch
  const goal1 = addEntity(world as any);
  addComponent(world as any, goal1, Goal as any);
  addComponent(world as any, agent, HasGoal(goal1) as any);
  Goal.description[goal1] = "Test hello procedure";
  Goal.priority[goal1] = 5;
  Goal.status[goal1] = "active";
  Goal.progress[goal1] = 0;
  Goal.deadline[goal1] = Date.now() + 60_000;
  createPlanEntity(world as any, agent, goal1, {
    goalDescription: "Test hello procedure",
    steps: [{ description: "Run hello", actionType: "interact", target: "Workstation", content: "run_command echo hello" }],
    estimatedCompletion: "short",
    potentialObstacles: [],
  });

  await runOnce(world as any, registry, agent, "hello");
  let pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("Terminal OK")), "expected success note branch");

  // Scenario 2: mismatch branch
  const goal2 = addEntity(world as any);
  addComponent(world as any, goal2, Goal as any);
  addComponent(world as any, agent, HasGoal(goal2) as any);
  Goal.description[goal2] = "Test fail procedure";
  Goal.priority[goal2] = 5;
  Goal.status[goal2] = "active";
  Goal.progress[goal2] = 0;
  Goal.deadline[goal2] = Date.now() + 60_000;
  createPlanEntity(world as any, agent, goal2, {
    goalDescription: "Test fail procedure",
    steps: [{ description: "Run fail", actionType: "interact", target: "Workstation", content: "run_command echo fail" }],
    estimatedCompletion: "short",
    potentialObstacles: [],
  });

  await runOnce(world as any, registry, agent, "fail");
  pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("Terminal BAD")), "expected mismatch note branch");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
