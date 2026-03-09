/**
 * Behavioral Test: Procedure Move Preconditions (No LLM)
 *
 * Verifies that when a procedure step targets an object in another room,
 * the procedure emits a `move` action until the agent is in the correct room,
 * then continues with the intended `interact` steps.
 *
 * Run:
 *   npx tsx src/behavioral-tests/27-procedure-move-precondition-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld, hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Memory, ProcedureState } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { setLocatedIn } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
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
  console.log("  PROCEDURE MOVE PRECONDITION TEST");
  console.log("═".repeat(70) + "\n");

  // Disable LLM
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

  const lobby = createRoomEntity(world as any, {
    name: "Lobby",
    description: "A lobby.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  const dev = createRoomEntity(world as any, {
    name: "Dev Office",
    description: "A dev office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 5, y: 1 },
  });
  registerEntity(lobby, "Lobby");
  registerEntity(dev, "Dev Office");

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
    roomId: lobby,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Casey");

  const computer = objectManager.spawn("computer", { name: "Workstation", containedIn: dev })!;
  registerEntity(computer, "Workstation");
  const notebook = objectManager.spawn("notebook", { name: "Notebook", containedIn: dev })!;
  registerEntity(notebook, "Notebook");

  const sig = "run_command|echo hello";
  addProceduralMemory(world as any, agent, {
    kind: "procedure_v1",
    signature: sig,
    name: "Work across rooms",
    trigger: { affordance: "run_command" },
    steps: [
      { type: "interact", target: "Workstation", content: "run_command echo hello" },
      { type: "interact", target: "Notebook", content: "take_note Ran hello" },
    ],
    stats: { successes: 2, failures: 0, createdAt: Date.now(), lastUsedAt: Date.now() },
  });

  // Plan requests the trigger; procedure should start and immediately require moving first.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Do procedure in other room";
  Goal.priority[goalEid] = 5;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 60_000;
  createPlanEntity(world as any, agent, goalEid, {
    goalDescription: "Do procedure in other room",
    steps: [{ description: "Run hello", actionType: "interact", target: "Workstation", content: "run_command echo hello" }],
    estimatedCompletion: "short",
    potentialObstacles: [],
  });

  const a1 = await agentThink(world as any, agent);
  assert(a1.type === "move" && a1.target === "Dev Office", "expected procedure to emit move to Dev Office");
  executeActions(world as any, [{ eid: agent, action: a1 as any }], registry);
  assert(hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState active during move");

  // Simulate arrival (movement systems would normally do this)
  setLocatedIn(world as any, agent, dev);

  const a2 = await agentThink(world as any, agent);
  assert(a2.type === "interact" && a2.target === "Workstation", "expected interact with Workstation after arrival");
  executeActions(world as any, [{ eid: agent, action: a2 as any }], registry);

  const a3 = await agentThink(world as any, agent);
  assert(a3.type === "interact" && a3.target === "Notebook", "expected procedure to continue to Notebook step");
  executeActions(world as any, [{ eid: agent, action: a3 as any }], registry);

  assert(!hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState cleared after completion");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

