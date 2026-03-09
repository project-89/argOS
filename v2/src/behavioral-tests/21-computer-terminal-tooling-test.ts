/**
 * Behavioral Test: Computer + Terminal Tooling (Scripted)
 *
 * Verifies that tool execution can be expressed as a WorldSchema affordance via `run_tool`,
 * and that results are delivered back to the actor as queued stimuli (evidence).
 *
 * Run:
 *   npx tsx src/behavioral-tests/21-computer-terminal-tooling-test.ts
 */
import "dotenv/config";

import { addComponent, addEntity, createWorld } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name } from "../ecs/components";
import { setLocatedIn } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  COMPUTER TERMINAL TOOLING TEST (SCRIPTED)");
  console.log("═".repeat(70) + "\n");

  // Tooling: scripted handler for terminal.run
  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();
  registerOfficeTool("terminal.run", (params) => {
    const command = String(params?.command ?? "");
    if (command.includes("echo hello")) {
      return { ok: true, summary: "echo ran", stdout: "hello\n" };
    }
    return { ok: false, summary: `unknown command: ${command}`, stderr: "scripted tool: no match" };
  });

  const world = createWorld();
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  // Rooms
  const roomA = createRoomEntity(world as any, { name: "Lobby", description: "A lobby.", capacity: 5, ambience: "office", gridPosition: { x: 1, y: 1 } });
  const roomB = createRoomEntity(world as any, { name: "Dev Office", description: "A dev office.", capacity: 5, ambience: "office", gridPosition: { x: 5, y: 1 } });
  registerEntity(roomA, "Lobby");
  registerEntity(roomB, "Dev Office");

  // Computer schema
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
    effects: [
      { type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" },
    ],
  });

  // Entities
  const agent = createAgentEntity(world as any, { name: "Casey", role: "Engineer", systemPrompt: "You are Casey.", roomId: roomA, gridPosition: { x: 1, y: 1 } });
  registerEntity(agent, "Casey");

  const computer = objectManager.spawn("computer", { name: "Workstation", containedIn: roomB })!;
  registerEntity(computer, "Workstation");

  // Attempt from wrong room (should fail without producing a tool_result stimulus)
  executeActions(world as any, [
    { eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } as any },
  ], registry);

  let pending = drainPendingStimuli();
  assert(pending.filter((s) => s.type === "tool_result").length === 0, "tool_result should not be delivered when device is not accessible");

  // Move agent to the dev office and try again
  setLocatedIn(world as any, agent, roomB);
  executeActions(world as any, [
    { eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } as any },
  ], registry);

  pending = drainPendingStimuli();
  const toolResults = pending.filter((s) => s.type === "tool_result");
  assert(toolResults.length >= 1, "expected a tool_result stimulus");
  assert(toolResults.some((s) => s.content.includes("hello")), "expected tool_result to include stdout");

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

