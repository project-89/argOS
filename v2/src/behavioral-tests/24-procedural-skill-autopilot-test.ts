/**
 * Behavioral Test: Procedural Skill Autopilot
 *
 * Verifies:
 * - Repeated successful grounded interactions create a `procedural` Memory entry (ProcedureV1).
 * - When a matching plan step exists, the agent executes the learned procedure *before* any LLM call.
 *
 * Run:
 *   npx tsx src/behavioral-tests/24-procedural-skill-autopilot-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld, getRelationTargets, hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Memory } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createPlanEntity } from "../cognition/planning-system";
import { parseProceduralSkillV1 } from "../cognition/procedural-skills";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function getProceduralSkills(world: any, agentEid: number): Array<{ memoryEid: number; skill: any }> {
  const memEids = getRelationTargets(world, agentEid, HasMemory as any)
    .filter((eid: number) => hasComponent(world, eid, Memory as any))
    .filter((eid: number) => String(Memory.type[eid] || "") === "procedural");

  const skills: Array<{ memoryEid: number; skill: any }> = [];
  for (const eid of memEids) {
    const parsed = parseProceduralSkillV1(String(Memory.content[eid] || ""));
    if (parsed) skills.push({ memoryEid: eid, skill: parsed });
  }
  return skills;
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  PROCEDURAL SKILL AUTOPILOT TEST");
  console.log("═".repeat(70) + "\n");

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
    name: "Dev Office",
    description: "A dev office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(room, "Dev Office");

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

  // Train: execute the same grounded interaction twice successfully.
  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } as any }], registry);
  executeActions(world as any, [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } as any }], registry);

  const skills = getProceduralSkills(world as any, agent);
  assert(skills.length >= 1, "expected at least one procedural skill memory");
  assert(skills.some((s) => s.skill.stats?.successes >= 2), "expected a skill with >=2 successes");

  // Create a goal + plan step that matches the interaction we learned.
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agent, HasGoal(goalEid) as any);
  Goal.description[goalEid] = "Verify the terminal works";
  Goal.priority[goalEid] = 5;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = Date.now() + 60_000;

  createPlanEntity(world as any, agent, goalEid, {
    goalDescription: "Verify the terminal works",
    steps: [
      { description: "Run a simple command", actionType: "interact", target: "Workstation", content: "run_command echo hello" },
    ],
    estimatedCompletion: "short",
    potentialObstacles: [],
  });

  // Remove API key so any LLM call would fail. Skill autopilot should still return the action.
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const action = await agentThink(world as any, agent);

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  assert(action.type === "interact", "expected procedural autopilot to choose interact");
  assert(action.target === "Workstation", "expected procedural autopilot to target Workstation");
  assert(String(action.content || "").trim() === "run_command echo hello", "expected procedural autopilot to run the learned command");

  executeActions(world as any, [{ eid: agent, action: action as any }], registry);
  const pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("hello")), "expected tool_result evidence from autopilot action");

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
