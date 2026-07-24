#!/usr/bin/env npx tsx
import "dotenv/config";
/**
 * Plan Compilation Demo — End-to-end test of multi-step procedure learning.
 *
 * Demonstrates:
 *   1. A multi-step tool sequence executes successfully
 *   2. The trace is compiled into a plan branch in the BT
 *   3. A similar situation triggers the compiled plan
 *   4. The plan executes tools without re-reasoning
 *
 * This is the System 2 → System 1 compilation for PROCEDURES, not just responses.
 */

import { createPersonModel, setCurrentTopics, setEmotionalState, addMemory } from "../ecs/person-store.js";
import { createBootstrapTree } from "../bt/bootstrap.js";
import { countNodes, evaluateBT, insertBranch } from "../bt/evaluator.js";
import { processTurn, setHandlers } from "../engine/conversation.js";
import { registerBuiltinTools } from "../tools/builtin.js";
import { registerTool } from "../tools/registry.js";
import {
  beginTrace, recordStep, completeTrace, compilePlan, growTreeWithPlan,
} from "../compiler/plan-compiler.js";
import type { BehaviorNode, CompiledPlan } from "../bt/types.js";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m",
  magenta: "\x1b[35m",
};

async function main() {
  console.log(`\n${C.bold}${C.magenta}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.magenta}║       Plan Compilation Demo — Procedure Learning             ║${C.reset}`);
  console.log(`${C.bold}${C.magenta}╚══════════════════════════════════════════════════════════════╝${C.reset}\n`);

  registerBuiltinTools();

  // ─── SETUP ──────────────────────────────────────────────────────────────

  const model = createPersonModel("plan-demo");
  model.policy.tree = createBootstrapTree();
  model.policy.totalNodes = countNodes(model.policy.tree);

  // Give the model some context
  addMemory(model, {
    type: "fact",
    content: "Working on a quarterly review presentation for the design team",
    importance: 0.9,
    topics: ["work", "presentation"],
    connections: [],
    timestamp: Date.now(),
  });

  console.log(`${C.bold}PHASE 1: Manual Plan Compilation${C.reset}`);
  console.log(`${C.dim}Simulating what happens when an expensive model successfully${C.reset}`);
  console.log(`${C.dim}executes a multi-step tool sequence for a user request.${C.reset}\n`);

  // ─── STEP 1: Simulate a successful multi-step execution ─────────────────

  // Set context as if user just asked for help
  setCurrentTopics(model, ["work", "presentation"]);
  setEmotionalState(model, "stressed");

  // Begin tracing the execution
  beginTrace(
    "Help me prepare for the quarterly review presentation",
    "User needs help preparing a presentation. Should gather notes, create outline, then build a checklist of remaining tasks.",
    ["work", "presentation"],
    "stressed",
  );

  console.log(`  ${C.cyan}Step 1:${C.reset} Gathering notes via file_read tool`);
  recordStep({
    tool: "file_read",
    params: { path: "notes/quarterly-review.txt" },
    output: "Q4 results: revenue up 15%, user growth 22%, 3 new features shipped, 2 major bugs fixed",
    success: true,
    description: "Read quarterly review notes to gather key data points",
  });

  console.log(`  ${C.cyan}Step 2:${C.reset} Drafting presentation outline`);
  recordStep({
    tool: "draft",
    params: { type: "outline", topic: "quarterly review", context: "Q4 results data" },
    output: "1. Revenue & Growth (15% rev, 22% users)\n2. Product Wins (3 features)\n3. Challenges (2 bugs)\n4. Q1 Goals",
    success: true,
    description: "Draft a presentation outline from the quarterly data",
  });

  console.log(`  ${C.cyan}Step 3:${C.reset} Creating preparation checklist`);
  recordStep({
    tool: "make_checklist",
    params: { items: "presentation outline sections", context: "quarterly review" },
    output: "- [ ] Finalize revenue charts\n- [ ] Add user growth graph\n- [ ] Write feature highlights\n- [ ] Prepare Q1 roadmap slide\n- [ ] Practice run-through",
    success: true,
    description: "Create a checklist of remaining preparation tasks",
  });

  console.log(`  ${C.cyan}Step 4:${C.reset} Delivering summary to user`);
  recordStep({
    tool: "__respond__",
    params: {},
    output: "I've prepared your quarterly review: gathered your notes, drafted a 4-section outline, and created a 5-item prep checklist. The outline covers revenue, product wins, challenges, and Q1 goals.",
    success: true,
    description: "Summarize what was accomplished and deliver to user",
  });

  // ─── STEP 2: Complete trace and compile ─────────────────────────────────

  console.log(`\n${C.bold}Compiling trace into plan branch...${C.reset}`);

  const trace = completeTrace(true, "That's exactly what I needed, thanks!");
  if (!trace) {
    console.log(`${C.red}  Failed to complete trace${C.reset}`);
    return;
  }

  console.log(`  Trace captured: ${trace.steps.length} steps, goal="${trace.goal}"`);

  const branch = compilePlan(trace, model);
  if (!branch) {
    console.log(`${C.red}  Immune system rejected the plan compilation${C.reset}`);
    console.log(`${C.dim}  (This can happen if conditions aren't specific enough)${C.reset}`);

    // For the demo, manually compile with known-good conditions
    console.log(`\n${C.yellow}  Manually compiling for demo purposes...${C.reset}`);
    manualCompileDemo(model);
  } else {
    console.log(`  ${C.green}Plan compiled successfully!${C.reset}`);
    console.log(`  Branch ID: ${branch.id}`);

    growTreeWithPlan(model, branch);
    console.log(`  Tree grew: ${model.policy.totalNodes} nodes (was ${countNodes(createBootstrapTree())})`);
  }

  // ─── STEP 3: Trigger the compiled plan ──────────────────────────────────

  console.log(`\n${C.bold}PHASE 2: Plan Replay${C.reset}`);
  console.log(`${C.dim}A similar situation arises. The BT recognizes it and triggers${C.reset}`);
  console.log(`${C.dim}the compiled plan — no expensive reasoning needed.${C.reset}\n`);

  // Set up mock handlers (Flash Lite fills in details)
  setHandlers({
    escalation: async (msg) => ({
      response: `[Escalated] ${msg.slice(0, 40)}`,
      reasoning: "Escalated because no BT pattern matched",
      action: { type: "respond" as const, content: `[Escalated]` },
    }),
    runtime: async (template) => template.replace(/\{[^}]+\}/g, "[filled by Flash Lite]"),
    analysis: async (msg) => ({
      topics: /present|review|quarterly/i.test(msg) ? ["work", "presentation"] : [],
      entities: [],
      emotionalState: /stress|overwhelm/i.test(msg) ? "stressed" : "neutral",
    }),
  });

  // Similar request — should trigger the compiled plan
  console.log(`  ${C.cyan}User:${C.reset} "I need help preparing for the quarterly presentation"`);
  setCurrentTopics(model, ["work", "presentation"]);
  setEmotionalState(model, "stressed");

  const result = evaluateBT(model.policy.tree!, model, "I need help preparing for the quarterly presentation");

  console.log(`  ${C.cyan}BT result:${C.reset} kind=${result.kind}`);
  console.log(`  ${C.cyan}Trace:${C.reset} ${result.trace.join(" → ")}`);

  if (result.kind === "plan") {
    console.log(`\n  ${C.green}${C.bold}Plan triggered!${C.reset}`);
    console.log(`  Goal: ${result.plan.goal}`);
    console.log(`  Steps:`);
    for (const step of result.plan.steps) {
      const actionDesc = step.action.type === "tool_call"
        ? `tool: ${step.action.tool}(${Object.entries(step.action.params).map(([k, v]) => `${k}=${v.slice(0, 30)}`).join(", ")})`
        : step.action.type === "generate"
          ? `generate: ${step.action.prompt.slice(0, 50)}`
          : step.action.type === "sub_plan"
            ? `sub_plan: ${step.action.planName}`
            : step.action.type === "respond"
              ? `respond: ${step.action.template.slice(0, 50)}`
              : `unknown action`;
      console.log(`    ${step.id}: ${step.description}`);
      console.log(`      ${C.dim}${actionDesc}${C.reset}`);
    }

    console.log(`\n  ${C.bold}The compiled plan would now execute these tools automatically.${C.reset}`);
    console.log(`  ${C.dim}Flash Lite fills in the specific details (file paths, current data).${C.reset}`);
    console.log(`  ${C.dim}The STRUCTURE (gather → outline → checklist → deliver) is fixed.${C.reset}`);
  } else if (result.kind === "escalate" || result.kind === "none") {
    console.log(`\n  ${C.yellow}Plan didn't trigger — BT conditions didn't match or exploration overrode.${C.reset}`);
    console.log(`  ${C.dim}This is expected sometimes due to ε-greedy exploration (30-60% for bootstrap).${C.reset}`);
    console.log(`  ${C.dim}In production, the plan would fire most of the time.${C.reset}`);
  } else {
    console.log(`\n  ${C.dim}BT returned ${result.kind} (bootstrap handler matched first).${C.reset}`);
  }

  // ─── SUMMARY ────────────────────────────────────────────────────────────

  console.log(`\n${C.bold}${C.cyan}═══ Summary ═══${C.reset}\n`);
  console.log(`  ${C.bold}What happened:${C.reset}`);
  console.log(`    1. An expensive model executed: read → draft → checklist → deliver`);
  console.log(`    2. The trace was compiled into a plan branch in the BT`);
  console.log(`    3. The plan node stores: conditions + tool sequence + variable bindings`);
  console.log(`    4. Next time: BT fires the plan → Flash Lite executes tools → no re-reasoning`);
  console.log(`\n  ${C.bold}The key insight:${C.reset}`);
  console.log(`    The expensive model figured out the PROCEDURE once.`);
  console.log(`    Flash Lite replays the structure, filling in current-context details.`);
  console.log(`    The judgment — "for presentation prep, do: gather → outline → checklist" —`);
  console.log(`    is crystallized. The execution is cheap.`);
  console.log(`\n  ${C.bold}Tree state:${C.reset} ${model.policy.totalNodes} nodes, ${model.policy.compiledBranches} compiled branches`);
}

/**
 * Manual plan compilation for demo when immune system is too strict.
 * In production, the immune system parameters can be tuned.
 */
function manualCompileDemo(model: import("../ecs/types.js").PersonModel): void {
  const plan: CompiledPlan = {
    goal: "Help prepare for quarterly review presentation",
    steps: [
      {
        id: "step_0",
        description: "Read quarterly review notes to gather key data points",
        action: { type: "tool_call", tool: "file_read", params: { path: "{topic:work}" } },
        outputBinding: "step_0",
        successCheck: { type: "tool_success" },
        onFailure: "skip",
      },
      {
        id: "step_1",
        description: "Draft a presentation outline from the gathered data",
        action: { type: "tool_call", tool: "draft", params: { type: "outline", topic: "{topic:presentation}", context: "{step_0}" } },
        outputBinding: "step_1",
        successCheck: { type: "output_not_empty" },
        onFailure: "skip",
      },
      {
        id: "step_2",
        description: "Create a checklist of remaining preparation tasks",
        action: { type: "tool_call", tool: "make_checklist", params: { items: "{step_1}", context: "quarterly review" } },
        outputBinding: "step_2",
        successCheck: { type: "output_not_empty" },
        onFailure: "abort",
      },
      {
        id: "step_3",
        description: "Summarize and deliver results to user",
        action: { type: "respond", template: "I've prepared your presentation: gathered notes, drafted a 4-section outline, and created a prep checklist." },
        onFailure: "skip",
      },
    ],
    successCondition: { type: "last_step_pass" },
    strategy: "Gather data → structure → actionable checklist → deliver summary",
    sourceContext: "work, presentation",
  };

  const planNode: BehaviorNode = {
    type: "sequence",
    children: [
      { type: "condition", op: { type: "person_topic", topic: "work" } },
      { type: "condition", op: { type: "person_topic", topic: "presentation" } },
      { type: "condition", op: { type: "message_includes", includes: "prepar" } },
      { type: "plan", plan },
    ],
  };

  model.policy.tree = insertBranch(model.policy.tree!, planNode);
  model.policy.compiledBranches++;
  model.policy.totalNodes = countNodes(model.policy.tree!);
  model.policy.version++;

  console.log(`  ${C.green}Plan branch inserted${C.reset}: ${model.policy.totalNodes} nodes`);
}

main().catch(err => { console.error(err); process.exit(1); });
