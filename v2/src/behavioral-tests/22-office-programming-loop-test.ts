/**
 * Behavioral Test: Office Programming Loop (Deterministic)
 *
 * Simulates a minimal programming workflow grounded in the world:
 * - "run tests" (terminal.run tool) produces evidence
 * - "apply patch" (repo.apply_patch tool) updates an in-world RepoFile entity
 * - "run tests" passes after the patch
 *
 * Run:
 *   npx tsx src/behavioral-tests/22-office-programming-loop-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name } from "../ecs/components";
import { getDynamicComponent, createDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";
import { setLocatedIn } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
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

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  OFFICE PROGRAMMING LOOP TEST (DETERMINISTIC)");
  console.log("═".repeat(70) + "\n");

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createWorld();
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  // Rooms
  const devRoom = createRoomEntity(world as any, { name: "Dev Office", description: "A dev office with a workstation.", capacity: 5, ambience: "office", gridPosition: { x: 1, y: 1 } });
  registerEntity(devRoom, "Dev Office");

  // Schema: computer with run_command + apply_patch affordances
  worldSchema.defineObjectType({
    name: "computer",
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
    effects: [
      { type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" },
    ],
  });
  worldSchema.defineAffordance({
    name: "apply_patch",
    requires: ["computer"],
    descriptionTemplate: "{actor.name} edits code on the computer.",
    effects: [
      { type: "run_tool", toolId: "repo.apply_patch", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" },
    ],
  });

  const agent = createAgentEntity(world as any, { name: "Maya", role: "Engineer", systemPrompt: "You are Maya.", roomId: devRoom, gridPosition: { x: 1, y: 1 } });
  registerEntity(agent, "Maya");
  setLocatedIn(world as any, agent, devRoom);

  const computer = objectManager.spawn("computer", { name: "Workstation", containedIn: devRoom })!;
  registerEntity(computer, "Workstation");

  // In-world repo file
  ensureRepoFileComponent();
  const fileEid = addEntity(world as any);
  addComponent(world as any, fileEid, Name as any);
  Name.value[fileEid] = "math.ts";
  setDynamicComponentValue("RepoFile", fileEid, "path", "math.ts");
  setDynamicComponentValue("RepoFile", fileEid, "content", "export function add(a,b){ return a-b } // BUG");

  // Scripted terminal.run checks for BUG marker.
  registerOfficeTool("terminal.run", (params, ctx) => {
    const command = String(params?.command ?? "");
    if (!command.includes("npm test")) {
      return { ok: false, summary: `unknown command: ${command}`, stderr: "only npm test is supported in this test" };
    }
    const content = getRepoFileContent(ctx.world as any, fileEid);
    if (content.includes("BUG")) {
      return {
        ok: false,
        summary: "tests failed",
        stdout: "FAIL math.test.ts\nExpected add(2,1)=3\nReceived 1\n",
        exitCode: 1,
      };
    }
    return {
      ok: true,
      summary: "tests passed",
      stdout: "PASS math.test.ts\n",
      exitCode: 0,
    };
  });

  // --- 1) run tests (fail)
  executeActions(world as any, [
    { eid: agent, action: { type: "interact", target: "Workstation", content: "run_command npm test" } as any },
  ], registry);

  let pending = drainPendingStimuli();
  const failTool = pending.find((s) => s.type === "tool_result" && s.content.includes("tests failed"));
  assert(!!failTool, "expected tool_result with failing test output");

  // --- 2) apply patch (fix bug)
  executeActions(world as any, [
    {
      eid: agent,
      action: {
        type: "interact",
        target: "Workstation",
        content: `apply_patch {"path":"math.ts","content":"export function add(a,b){ return a+b }"}`,
      } as any,
    },
  ], registry);

  pending = drainPendingStimuli();
  const patchTool = pending.find((s) => s.type === "tool_result" && s.content.includes("Updated math.ts"));
  assert(!!patchTool, "expected tool_result confirming patch applied");
  assert(!getRepoFileContent(world as any, fileEid).includes("BUG"), "expected bug marker removed");

  // --- 3) run tests (pass)
  executeActions(world as any, [
    { eid: agent, action: { type: "interact", target: "Workstation", content: "run_command npm test" } as any },
  ], registry);

  pending = drainPendingStimuli();
  const passTool = pending.find((s) => s.type === "tool_result" && s.content.includes("tests passed"));
  assert(!!passTool, "expected tool_result with passing test output");

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
