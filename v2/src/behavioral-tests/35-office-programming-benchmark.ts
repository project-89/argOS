/**
 * Behavioral Benchmark: Office programming loop with typed goal evaluation + macro reuse
 *
 * This is intended as an ongoing benchmark as cognition improves:
 * - Phase 1: execute a plan to fix a failing "repo" file and get tests passing
 * - Goal completion is decided by GoalEvaluationSystem (ECS state), not by narration
 * - Phase 2: reset the bug and re-run the same goal with NO plan + NO LLM; the compiled macro should solve it
 *
 * Run:
 *   npx tsx src/behavioral-tests/35-office-programming-benchmark.ts
 *   npx tsx src/behavioral-tests/35-office-programming-benchmark.ts --mode=llm
 *   npx tsx src/behavioral-tests/35-office-programming-benchmark.ts --output=./stress-test-output/office-benchmark.jsonl
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { addComponent, addEntity, getRelationTargets, hasComponent } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, Memory, Name } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createPlanEntity, type GeneratedPlan, generatePlanForGoal } from "../cognition/planning-system";
import { getNextPlannedAction } from "../cognition/planning-system";
import { parseProceduralSkillV1 } from "../cognition/procedural-skills";
import { agentThink } from "../cognition/agent-mind";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { createDynamicComponent, getDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";

type Mode = "scripted" | "llm";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function parseArgs(): { mode: Mode; output?: string; maxSteps: number } {
  let mode: Mode = "scripted";
  let output: string | undefined;
  let maxSteps = 40;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--mode=")) {
      const m = raw.split("=")[1];
      if (m === "llm") mode = "llm";
      if (m === "scripted") mode = "scripted";
    }
    if (raw.startsWith("--output=")) output = raw.split("=")[1];
    if (raw.startsWith("--maxSteps=")) maxSteps = Math.max(5, Math.min(400, Number(raw.split("=")[1] || 0) || 40));
  }
  return { mode, output, maxSteps };
}

function ensureRepoFileComponent(): void {
  if (getDynamicComponent("RepoFile")) return;
  createDynamicComponent({
    name: "RepoFile",
    description: "In-world repo file (for deterministic office tooling tests)",
    properties: { path: "string", content: "string" },
  });
}

function getRepoFileContent(world: any, fileEid: number): string {
  const RepoFile = getDynamicComponent("RepoFile")!;
  return String(RepoFile.content?.[fileEid] ?? "");
}

function createTypedGoal(world: any, agentEid: number, description: string): number {
  const goalEid = addEntity(world);
  addComponent(world, goalEid, Goal as any);
  addComponent(world, agentEid, HasGoal(goalEid) as any);
  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();
  setGoalContract(world, goalEid, {
    version: 1,
    kind: "custom",
    params: { task: "fix_tests", filePath: "math.ts", suite: "npm test" },
    success: {
      type: "all_of",
      conditions: [
        { type: "repo_file_contains", path: "math.ts", includes: "return a+b" },
        { type: "tool_exit_code_equals", toolId: "terminal.run", commandIncludes: "npm test", equals: 0 },
      ],
    },
    description,
  });
  return goalEid;
}

function createScriptedPlan(goalDescription: string): GeneratedPlan {
  return {
    goalDescription,
    estimatedCompletion: "short",
    potentialObstacles: ["tests may fail until bug is fixed"],
    steps: [
      { description: "Run the tests to observe the failure.", actionType: "interact", target: "Workstation", content: "run_command npm test" },
      { description: "Read the failing file.", actionType: "interact", target: "Workstation", content: "read_file {\"path\":\"math.ts\"}" },
      { description: "Apply a patch fixing the add() implementation.", actionType: "interact", target: "Workstation", content: "apply_patch {\"path\":\"math.ts\",\"content\":\"export function add(a,b){ return a+b }\"}" },
      { description: "Run the tests again to confirm they pass.", actionType: "interact", target: "Workstation", content: "run_command npm test" },
    ],
  };
}

function findCompiledGoalMacro(world: any, agentEid: number): string | null {
  const memories = getRelationTargets(world as any, agentEid, HasMemory as any) as number[];
  for (const mid of memories) {
    if (!hasComponent(world as any, mid, Memory as any)) continue;
    if (String(Memory.type[mid] || "") !== "procedural") continue;
    const parsed = parseProceduralSkillV1(String(Memory.content[mid] || ""));
    const sig = String(parsed?.signature || "");
    if (sig.startsWith("goalid:") || sig.startsWith("goal:")) return sig;
  }
  return null;
}

async function main() {
  const { mode, output, maxSteps } = parseArgs();

  console.log("\n" + "═".repeat(70));
  console.log(`  OFFICE PROGRAMMING BENCHMARK (${mode.toUpperCase()})`);
  console.log("═".repeat(70) + "\n");

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("OfficeProgrammingBenchmark") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  // Ensure goal evaluation runs deterministically each tick for this benchmark.
  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  // Room
  const devRoom = createRoomEntity(world as any, {
    name: "Dev Office",
    description: "A dev office with a workstation.",
    capacity: 5,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(devRoom, "Dev Office");

  // Schema: workstation
  worldSchema.defineObjectType({
    name: "computer_35",
    description: "A workstation computer",
    traits: ["computer", "examinable"],
    states: { idle: { description: "A workstation computer is on.", traits: ["computer"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "run_command",
    requires: ["computer"],
    descriptionTemplate: "{actor.name} runs a command on the computer.",
    effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "read_file",
    requires: ["computer"],
    descriptionTemplate: "{actor.name} reads a repo file on the computer.",
    effects: [{ type: "run_tool", toolId: "repo.read_file", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "apply_patch",
    requires: ["computer"],
    descriptionTemplate: "{actor.name} edits code on the computer.",
    effects: [{ type: "run_tool", toolId: "repo.apply_patch", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const agent = createAgentEntity(world as any, {
    name: "Maya",
    role: "Engineer",
    systemPrompt: "You are Maya, an engineer solving grounded tasks using the workstation.",
    roomId: devRoom,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Maya");

  const computer = objectManager.spawn("computer_35", { name: "Workstation", containedIn: devRoom })!;
  registerEntity(computer, "Workstation");

  // In-world repo file
  ensureRepoFileComponent();
  const fileEid = addEntity(world as any);
  addComponent(world as any, fileEid, Name as any);
  Name.value[fileEid] = "math.ts";
  setDynamicComponentValue("RepoFile", fileEid, "path", "math.ts");
  setDynamicComponentValue("RepoFile", fileEid, "content", "export function add(a,b){ return a-b } // BUG");

  // Scripted terminal.run: always "runs" successfully (action succeeds), but exitCode indicates test state.
  // This matches real workflows: "running tests" is not a failed interaction, it's evidence.
  registerOfficeTool("terminal.run", (params, ctx) => {
    const command = String(params?.command ?? "");
    if (!command.includes("npm test")) {
      return { ok: false, summary: `unknown command: ${command}`, stderr: "only npm test is supported in this benchmark" };
    }
    const content = getRepoFileContent(ctx.world as any, fileEid);
    const failing = content.includes("return a-b") || content.includes("BUG");
    if (failing) {
      return {
        ok: true,
        summary: "npm test finished (failures present)",
        stdout: "FAIL math.test.ts\nExpected add(2,1)=3\nReceived 1\n",
        exitCode: 1,
      };
    }
    return {
      ok: true,
      summary: "npm test finished (green)",
      stdout: "PASS math.test.ts\n",
      exitCode: 0,
    };
  });

  const startedAt = Date.now();
  let tick = 0;

  // Phase 1: plan-driven execution (scripted plan or LLM-generated plan).
  const goalDesc = "Fix math.ts so add(a,b) adds correctly and `npm test` passes.";
  const goal1 = createTypedGoal(world as any, agent, goalDesc);

  let planSource: "scripted" | "llm" = "scripted";
  let generated: GeneratedPlan = createScriptedPlan(goalDesc);
  if (mode === "llm" && process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    const maybe = await generatePlanForGoal(world as any, agent, goal1);
    if (maybe) {
      generated = maybe;
      planSource = "llm";
    }
  }
  createPlanEntity(world as any, agent, goal1, generated);

  let phase1Actions = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (String(Goal.status[goal1] || "") === "completed") break;
    const step = getNextPlannedAction(world as any, agent);
    if (!step) break;

    executeActions(world as any, [{ eid: agent, action: { type: step.actionType, target: step.target, content: step.content } as any }], registry as any);
    drainPendingStimuli();
    runSystems(world as any, registry as any, tick++, 16);
    phase1Actions++;
  }

  const phase1Completed = String(Goal.status[goal1] || "") === "completed";
  const macroSigAfterPhase1 = findCompiledGoalMacro(world as any, agent);

  // Phase 2: reset bug + same goal, NO plan + NO LLM → macro should solve.
  setDynamicComponentValue("RepoFile", fileEid, "content", "export function add(a,b){ return a-b } // BUG");
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const goal2 = createTypedGoal(world as any, agent, goalDesc);

  let phase2Actions = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (String(Goal.status[goal2] || "") === "completed") break;
    const action = await agentThink(world as any, agent);
    executeActions(world as any, [{ eid: agent, action: action as any }], registry as any);
    drainPendingStimuli();
    runSystems(world as any, registry as any, tick++, 16);
    phase2Actions++;
  }

  const phase2Completed = String(Goal.status[goal2] || "") === "completed";

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  const durationMs = Date.now() - startedAt;
  const report = {
    ts: new Date().toISOString(),
    test: "office_programming_benchmark",
    mode,
    planSource,
    phase1: { completed: phase1Completed, actions: phase1Actions },
    phase2: { completed: phase2Completed, actions: phase2Actions },
    macroSignature: macroSigAfterPhase1,
    durationMs,
  };

  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.appendFileSync(output, JSON.stringify(report) + "\n");
    console.log(`[Benchmark] Wrote: ${output}`);
  }

  assert(phase1Completed, "Phase 1 did not complete the goal");
  assert(macroSigAfterPhase1 && (macroSigAfterPhase1.startsWith("goalid:") || macroSigAfterPhase1.startsWith("goal:")), "Expected a compiled goal macro after Phase 1");
  assert(phase2Completed, "Phase 2 did not complete the goal via macro reuse");
  assert(!getRepoFileContent(world as any, fileEid).includes("return a-b"), "Expected bug to be fixed after Phase 2");

  console.log("✓ PASS");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
