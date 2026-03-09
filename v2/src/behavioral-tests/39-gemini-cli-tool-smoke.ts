/**
 * Smoke Test: `gemini.cli` tool wiring through `run_tool` + LastToolResult evidence.
 *
 * This is NOT a deterministic CI test. It requires network access and a Gemini key.
 *
 * Setup:
 * - Ensure `.env` has `GOOGLE_GENERATIVE_AI_API_KEY` (already used by the repo)
 * - Export `OFFICE_TOOLS_ALLOW_GEMINI_CLI=1`
 *
 * Run:
 *   OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 npx tsx src/behavioral-tests/39-gemini-cli-tool-smoke.ts
 *
 * Notes:
 * - This runs gemini-cli in `--sandbox` and `--approval-mode default` by default.
 * - The tool bridges `GOOGLE_GENERATIVE_AI_API_KEY` -> `GEMINI_API_KEY` for gemini-cli.
 */
import "dotenv/config";

import { createSystemRegistry, registerSystem, runSystems } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { createGoalEvaluationSystem } from "../systems/builtin-systems";
import { createOfficeToolJobSystem } from "../systems/office-tool-job-system";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { yieldForOfficeToolJobs } from "./helpers/office-async";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  if (!process.env.OFFICE_TOOLS_ALLOW_GEMINI_CLI?.trim()) {
    throw new Error("Set OFFICE_TOOLS_ALLOW_GEMINI_CLI=1 to run this smoke test.");
  }

  setOfficeToolMode("shell");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("GeminiCliToolSmoke") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();

  // Not required, but keeps the system stack consistent with other tests.
  const goalEval = createGoalEvaluationSystem();
  goalEval.frequency = 0;
  registerSystem(registry as any, goalEval as any);

  const officeJobs = createOfficeToolJobSystem();
  officeJobs.frequency = 0;
  registerSystem(registry as any, officeJobs as any);

  const room = createRoomEntity(world as any, { name: "Office" });
  registerEntity(room, "Office");

  worldSchema.defineObjectType({
    name: "workstation_39",
    description: "A workstation computer",
    traits: ["computer", "examinable"],
    states: { idle: { description: "A workstation computer is on.", traits: ["computer"] } },
    defaultState: "idle",
    category: "device",
  });

  worldSchema.defineAffordance({
    name: "ask_gemini",
    requires: ["computer"],
    effects: [{ type: "run_tool", toolId: "gemini.cli", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const objectManager = new ObjectManager(world as any);
  const computer = objectManager.spawn("workstation_39", { name: "Workstation", containedIn: room })!;
  registerEntity(computer, "Workstation");

  const agent = createAgentEntity(world as any, { name: "Sera", role: "Spirit", systemPrompt: "x", roomId: room });
  registerEntity(agent, "Sera");

  // Ask for a small, strictly structured JSON response so we can validate parsing.
  const prompt =
    "Return ONLY a JSON object with keys ok:boolean and message:string. " +
    "Do not include markdown. Set ok=true and message='hello'.";

  executeActions(
    world as any,
    [
      {
        eid: agent,
        action: {
          type: "interact",
          target: "Workstation",
          content: `ask_gemini ${JSON.stringify({ prompt, outputFormat: "json", sandbox: true, approvalMode: "default", timeoutMs: 120000 })}`,
        } as any,
      },
    ],
    registry as any
  );

  let tool: any | undefined;
  for (let tick = 0; tick < 240; tick++) {
    runSystems(world as any, registry as any, tick, 16);
    const stimuli = drainPendingStimuli();
    // Wait for the completed tool_result (not just the immediate "queued" placeholder).
    tool = stimuli.find((s) => s.type === "tool_result" && s.content.includes("[Tool:gemini.cli]") && s.content.includes("stdout:\n"));
    if (tool) break;
    await yieldForOfficeToolJobs(world as any, 50);
  }
  assert(tool, "Expected a tool_result stimulus from gemini.cli");

  console.log("✓ gemini.cli smoke test produced tool_result");
  console.log(tool!.content.slice(0, 800));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
