/**
 * Behavioral Test: Plan→Macro compilation + reuse (no LLM)
 *
 * Verifies:
 * - A completed Plan is compiled into a goal-macro ProceduralSkillV1 memory
 * - Later, when the same goal appears again with no active plan and no LLM key,
 *   the macro auto-starts and completes the goal via deterministic execution.
 *
 * Run:
 *   npx tsx src/behavioral-tests/34-plan-macro-learning-e2e.ts
 */
import "dotenv/config";

import { addComponent, addEntity, getRelationTargets, hasComponent } from "bitecs";
import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Agent, Goal, GridPosition, Memory, Name, ProcedureState } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { setLocatedIn, getRoomForEntity } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { agentThink } from "../cognition/agent-mind";
import { setGoalContract } from "../cognition/goal-contract";
import { createPlanEntity, type GeneratedPlan } from "../cognition/planning-system";
import { parseProceduralSkillV1 } from "../cognition/procedural-skills";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { clearMovementTarget, createGoalPursuitSystem, createRoomArrivalSystem } from "../systems/builtin-systems";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function createGoal(world: any, agentEid: number, description: string, priority: number): number {
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal);
  addComponent(world, agentEid, HasGoal(goalEid));
  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = priority;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  setGoalContract(world, goalEid, {
    version: 1,
    kind: "custom",
    params: { objective: "write_note", targetName: "Notepad" },
    success: { type: "custom", description: "note written" },
    description,
  });
  return goalEid;
}

function listProceduralMemories(world: any, agentEid: number): Array<{ memoryEid: number; skillSignature?: string }> {
  const out: Array<{ memoryEid: number; skillSignature?: string }> = [];
  const mems = getRelationTargets(world, agentEid, HasMemory as any) as number[];
  for (const mid of mems) {
    if (!hasComponent(world, mid, Memory as any)) continue;
    if (String(Memory.type[mid] || "") !== "procedural") continue;
    const parsed = parseProceduralSkillV1(String(Memory.content[mid] || ""));
    out.push({ memoryEid: mid, skillSignature: parsed?.signature });
  }
  return out;
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  PLAN→MACRO LEARNING E2E TEST");
  console.log("═".repeat(70) + "\n");

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("PlanMacroLearningE2E") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  // Minimal deterministic execution loop so "move" steps can actually complete:
  // executeActions(move) creates a "Go to X" Goal, and GoalPursuitSystem executes it.
  const goalPursuit = createGoalPursuitSystem();
  goalPursuit.frequency = 0;
  registerSystem(registry, goalPursuit);

  const arrival = createRoomArrivalSystem();
  arrival.frequency = 0;
  registerSystem(registry, arrival);

  const lobby = createRoomEntity(world as any, {
    name: "Lobby",
    description: "A small lobby.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  const office = createRoomEntity(world as any, {
    name: "Office",
    description: "A small office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 10, y: 1 },
  });
  registerEntity(lobby, "Lobby");
  registerEntity(office, "Office");

  worldSchema.defineObjectType({
    name: "macro_notepad_34",
    description: "A small notepad for jotting down notes.",
    traits: ["notepad_34", "examinable"],
    states: { idle: { description: "A notepad lies here.", traits: ["notepad_34"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "write_note_34",
    requires: ["notepad_34"],
    descriptionTemplate: "{actor.name} writes a note.",
    effects: [{ type: "run_tool", toolId: "notes.append" }],
  });

  const notepad = objectManager.spawn("macro_notepad_34", { name: "Notepad", containedIn: office })!;
  registerEntity(notepad, "Notepad");

  const agent = createAgentEntity(world as any, {
    name: "Rae",
    role: "Engineer",
    systemPrompt: "You are Rae.",
    roomId: lobby,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Rae");

  // Ensure RoomArrival establishes canonical room membership before we start.
  let tick = 0;
  runSystems(world as any, registry as any, tick++, 16);

  // Phase 1: execute a plan manually, then verify it compiles to a goal-macro.
  const goalDesc = "Write the standup agenda into the notepad.";
  const goal1 = createGoal(world as any, agent, goalDesc, 10);

  const plan: GeneratedPlan = {
    goalDescription: goalDesc,
    estimatedCompletion: "short",
    potentialObstacles: [],
    steps: [
      { description: "Go to the office.", actionType: "move", target: "Office" },
      { description: "Write the agenda note.", actionType: "interact", target: "Notepad", content: "write_note_34 standup: blockers, updates, next steps" },
    ],
  };
  createPlanEntity(world as any, agent, goal1, plan);

  executeActions(world as any, [{ eid: agent, action: { type: "move", target: "Office" } as any }], registry as any);
  // Let GoalPursuitSystem execute the movement goal.
  for (let i = 0; i < 3; i++) runSystems(world as any, registry as any, tick++, 16);
  assert(String(Name.value[getRoomForEntity(world as any, agent) as any] || "") === "Office", "expected agent to arrive in Office during Phase 1");

  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Notepad", content: "write_note_34 standup: blockers, updates, next steps" } as any }], registry as any);
  drainPendingStimuli();

  assert(Goal.status[goal1] === "completed", "expected Phase 1 goal to complete via plan advancement");

  const macros = listProceduralMemories(world as any, agent).filter((m) => {
    const sig = String(m.skillSignature || "");
    return sig.startsWith("goalid:") || sig.startsWith("goal:");
  });
  assert(macros.length > 0, "expected at least one compiled goal-macro procedural memory after plan completion");
  const macroSig = String(macros[0].skillSignature || "");
  console.log(`[Test] Compiled macro signature: ${macroSig}`);

  // Phase 2: new goal with the same description, no plan, no LLM → macro auto-start and completion.
  const goal2 = createGoal(world as any, agent, goalDesc, 10);

  // Reset agent back to Lobby so the macro must move again.
  clearMovementTarget(agent);
  GridPosition.x[agent] = GridPosition.x[lobby];
  GridPosition.y[agent] = GridPosition.y[lobby];
  setLocatedIn(world as any, agent, lobby);
  runSystems(world as any, registry as any, tick++, 16);

  assert(hasComponent(world as any, agent, Agent as any) && Agent.active[agent] !== 0, "expected agent to be active");
  assert(String(Name.value[getRoomForEntity(world as any, agent) as any] || "") === "Lobby", "expected agent to start Phase 2 in Lobby");

  let completed = false;
  for (let step = 0; step < 60; step++) {
    const action = await agentThink(world as any, agent);
    executeActions(world as any, [{ eid: agent, action: action as any }], registry as any);

    // Let GoalPursuit/arrival progress between decisions.
    for (let i = 0; i < 3; i++) runSystems(world as any, registry as any, tick++, 16);

    drainPendingStimuli();

    if (Goal.status[goal2] === "completed") {
      completed = true;
      break;
    }
  }

  assert(completed, "expected Phase 2 goal to be completed via macro execution (no LLM)");
  assert(!hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState to be cleared after macro completion");
  assert(String(Name.value[getRoomForEntity(world as any, agent) as any] || "") === "Office", "expected agent to end Phase 2 in Office");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
