/**
 * Behavioral Benchmark: Agent uses Kanban+Wiki tools (macro reuse)
 *
 * Phase 1 (scripted plan):
 * - Execute a plan that uses Kanban+Wiki devices to satisfy a typed goal contract
 * - Goal completion is deterministic via GoalEvaluationSystem (ECS evidence)
 * - On completion, the plan is compiled into a procedural macro (post-eval)
 *
 * Phase 2 (no plan, no LLM):
 * - Reset board/doc state so the goal is NOT satisfied
 * - Re-issue the same goal contract
 * - Agent cognition should trigger the learned macro and use the tools to complete it
 *
 * Run:
 *   npx tsx src/behavioral-tests/37-agent-uses-kanban-wiki-benchmark.ts
 *   npx tsx src/behavioral-tests/37-agent-uses-kanban-wiki-benchmark.ts --output=./stress-test-output/org-benchmark.jsonl
 */
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { addComponent, addEntity, getRelationTargets, hasComponent, query } from "bitecs";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Goal, KanbanBoard, KanbanCard, KanbanColumn, Memory, Name, WikiDoc } from "../ecs/components";
import { HasGoal, HasMemory } from "../ecs/relations";
import { setLocatedIn, getDirectContainer, listDirectContents } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { setGoalContract } from "../cognition/goal-contract";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createPlanEntity, type GeneratedPlan, getNextPlannedAction } from "../cognition/planning-system";
import { parseProceduralSkillV1 } from "../cognition/procedural-skills";
import { agentThink } from "../cognition/agent-mind";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function parseArgs(): { output?: string; maxSteps: number } {
  let output: string | undefined;
  let maxSteps = 60;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith("--output=")) output = raw.split("=")[1];
    if (raw.startsWith("--maxSteps=")) maxSteps = Math.max(10, Math.min(500, Number(raw.split("=")[1] || 0) || 60));
  }
  return { output, maxSteps };
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

function findBoardEid(world: any, boardName: string): number | undefined {
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (!hasComponent(world as any, eid, KanbanBoard as any)) continue;
    if (String(Name.value[eid] || "") === boardName) return eid;
  }
  return undefined;
}

function findColumnEid(world: any, boardEid: number, columnName: string): number | undefined {
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    if (String(Name.value[col] || KanbanColumn.name[col] || "") === columnName) return col;
  }
  return undefined;
}

function findCardEid(world: any, boardEid: number, title: string): number | undefined {
  for (const col of listDirectContents(world as any, boardEid)) {
    if (!hasComponent(world as any, col, KanbanColumn as any)) continue;
    for (const c of listDirectContents(world as any, col)) {
      if (!hasComponent(world as any, c, KanbanCard as any)) continue;
      if (String(Name.value[c] || KanbanCard.title[c] || "") === title) return c;
    }
  }
  return undefined;
}

function findDocEid(world: any, title: string): number | undefined {
  for (const eid of Array.from(query(world as any, [Name] as any))) {
    if (!hasComponent(world as any, eid, WikiDoc as any)) continue;
    if (String(Name.value[eid] || WikiDoc.title[eid] || "") === title) return eid;
  }
  return undefined;
}

function createOrgGoal(world: any, agentEid: number, description: string): number {
  const goalEid = addEntity(world as any);
  addComponent(world as any, goalEid, Goal as any);
  addComponent(world as any, agentEid, HasGoal(goalEid) as any);
  Goal.description[goalEid] = description;
  Goal.priority[goalEid] = 10;
  Goal.status[goalEid] = "active";
  Goal.progress[goalEid] = 0;
  Goal.deadline[goalEid] = 0;
  Goal.createdAt[goalEid] = Date.now();

  setGoalContract(world as any, goalEid, {
    version: 1,
    kind: "custom",
    params: { workflow: "kanban_wiki" },
    success: {
      type: "all_of",
      conditions: [
        { type: "kanban_card_in_column", boardName: "Team Board", cardTitle: "Fix add()", columnName: "Done" },
        { type: "doc_contains", title: "Spec: Fix add()", includes: "Acceptance Criteria" },
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
    potentialObstacles: [],
    steps: [
      { description: "Initialize the team board.", actionType: "interact", target: "Team Board", content: "kanban_init {\"columns\":[\"Backlog\",\"In Progress\",\"Done\"]}" },
      { description: "Create or update the task card.", actionType: "interact", target: "Team Board", content: "kanban_upsert_card {\"column\":\"Backlog\",\"title\":\"Fix add()\",\"description\":\"Fix add() to return a+b\"}" },
      { description: "Create or update the spec doc.", actionType: "interact", target: "Wiki", content: "wiki_upsert_doc {\"title\":\"Spec: Fix add()\",\"body\":\"\",\"status\":\"draft\"}" },
      { description: "Ensure acceptance criteria are written.", actionType: "interact", target: "Wiki", content: "wiki_ensure_contains {\"title\":\"Spec: Fix add()\",\"includes\":\"Acceptance Criteria\",\"textIfMissing\":\"Acceptance Criteria:\\n- add(a,b) returns a+b\\n\"}" },
      { description: "Move the card to Done.", actionType: "interact", target: "Team Board", content: "kanban_move_card {\"title\":\"Fix add()\",\"toColumn\":\"Done\"}" },
    ],
  };
}

async function main() {
  const { output, maxSteps } = parseArgs();

  console.log("\n" + "═".repeat(70));
  console.log("  ORG WORKFLOW BENCHMARK (KANBAN+WIKI)");
  console.log("═".repeat(70) + "\n");

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("OrgWorkflowBenchmark") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  // Room + devices
  const room = createRoomEntity(world as any, { name: "Office", description: "An office." });
  registerEntity(room, "Office");

  worldSchema.defineObjectType({
    name: "kanban_board_device_37",
    description: "A shared kanban board device",
    traits: ["kanban_board", "examinable"],
    states: { idle: { description: "A kanban board is ready.", traits: ["kanban_board"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineObjectType({
    name: "wiki_terminal_device_37",
    description: "A shared wiki terminal",
    traits: ["wiki_terminal", "examinable"],
    states: { idle: { description: "A wiki terminal is ready.", traits: ["wiki_terminal"] } },
    defaultState: "idle",
    category: "device",
  });

  worldSchema.defineAffordance({
    name: "kanban_init",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.init", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_upsert_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.upsert_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "kanban_move_card",
    requires: ["kanban_board"],
    effects: [{ type: "run_tool", toolId: "kanban.move_card", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  worldSchema.defineAffordance({
    name: "wiki_upsert_doc",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.upsert_doc", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "wiki_ensure_contains",
    requires: ["wiki_terminal"],
    effects: [{ type: "run_tool", toolId: "wiki.ensure_contains", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const boardDevice = objectManager.spawn("kanban_board_device_37", { name: "Team Board", containedIn: room })!;
  const wikiDevice = objectManager.spawn("wiki_terminal_device_37", { name: "Wiki", containedIn: room })!;
  registerEntity(boardDevice, "Team Board");
  registerEntity(wikiDevice, "Wiki");

  const agent = createAgentEntity(world as any, { name: "Mina", role: "Engineer", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Mina");

  const startedAt = Date.now();
  let tick = 0;

  // Phase 1: plan-driven
  const goalDesc = "Coordinate work using Team Board and Wiki, with a completed card and acceptance criteria.";
  const goal1 = createOrgGoal(world as any, agent, goalDesc);
  createPlanEntity(world as any, agent, goal1, createScriptedPlan(goalDesc));

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

  // Reset state so the goal is NOT satisfied.
  const boardEid = findBoardEid(world as any, "Team Board");
  assert(boardEid !== undefined, "expected Team Board entity with KanbanBoard");
  const backlogCol = findColumnEid(world as any, boardEid!, "Backlog");
  const doneCol = findColumnEid(world as any, boardEid!, "Done");
  assert(backlogCol !== undefined && doneCol !== undefined, "expected Backlog and Done columns");

  const cardEid = findCardEid(world as any, boardEid!, "Fix add()");
  assert(cardEid !== undefined, "expected Fix add() card");
  setLocatedIn(world as any, cardEid!, backlogCol!);

  const docEid = findDocEid(world as any, "Spec: Fix add()");
  assert(docEid !== undefined, "expected Spec doc");
  WikiDoc.body[docEid!] = "";
  WikiDoc.updatedAt[docEid!] = Date.now();

  // Phase 2: no plan, no LLM. Macro should drive the tool usage.
  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const goal2 = createOrgGoal(world as any, agent, goalDesc);
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

  // Sanity: goal truly required state changes (card moved + doc updated)
  const cardNowCol = getDirectContainer(world as any, cardEid!);
  const cardNowColName = cardNowCol !== undefined ? String(Name.value[cardNowCol] || "") : "";

  const report = {
    ts: new Date().toISOString(),
    test: "agent_uses_kanban_wiki_benchmark",
    phase1: { completed: phase1Completed, actions: phase1Actions },
    phase2: { completed: phase2Completed, actions: phase2Actions, cardColumn: cardNowColName },
    macroSignature: macroSigAfterPhase1,
    durationMs: Date.now() - startedAt,
  };

  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.appendFileSync(output, JSON.stringify(report) + "\n");
    console.log(`[Benchmark] Wrote: ${output}`);
  }

  assert(phase1Completed, "Phase 1 did not complete the goal");
  assert(macroSigAfterPhase1 && macroSigAfterPhase1.startsWith("goalid:"), "Expected a compiled goal macro after Phase 1");
  assert(phase2Completed, "Phase 2 did not complete the goal via macro reuse");
  assert(cardNowColName === "Done", `Expected card to be in Done after Phase 2 (got ${cardNowColName || "unknown"})`);
  assert(String(WikiDoc.body[docEid!] || "").includes("Acceptance Criteria"), "Expected doc to include Acceptance Criteria after Phase 2");

  console.log("✓ PASS");
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
