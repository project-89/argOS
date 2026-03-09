/**
 * Behavioral Test: Notes + Deterministic Learning Hooks
 *
 * Verifies:
 * - Notes are grounded to an in-world object affordance (`notes.append` via `run_tool`)
 * - Tool results + action_failed stimuli are automatically persisted as Memories (deterministic, no LLM)
 *
 * Run:
 *   npx tsx src/behavioral-tests/23-notes-and-learning-test.ts
 */
import "dotenv/config";

import { createWorld } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Memory } from "../ecs/components";
import { HasMemory } from "../ecs/relations";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity, runCognitionCycle } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { registerOfficeTool, setOfficeToolMode } from "../office-tools/tool-registry";
import { getRelationTargets, hasComponent } from "bitecs";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

function getAgentMemoryContents(world: any, agentEid: number): string[] {
  const memEids = getRelationTargets(world, agentEid, HasMemory as any)
    .filter((eid: number) => hasComponent(world, eid, Memory as any))
    .sort((a: number, b: number) => (Memory.timestamp[b] || 0) - (Memory.timestamp[a] || 0));
  return memEids.map((eid: number) => String(Memory.content[eid] || ""));
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  NOTES + LEARNING HOOKS TEST");
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

  // Rooms
  const office = createRoomEntity(world as any, {
    name: "Office",
    description: "An open-plan office.",
    capacity: 20,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(office, "Office");

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
    effects: [{ type: "run_tool", toolId: "terminal.run", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });

  // Notebook schema
  worldSchema.defineObjectType({
    name: "notebook",
    description: "A paper notebook",
    traits: ["notebook", "examinable"],
    states: { idle: { description: "A notebook lies open to a blank page.", traits: ["notebook"] } },
    defaultState: "idle",
    category: "item",
  });
  worldSchema.defineAffordance({
    name: "take_note",
    requires: ["notebook"],
    descriptionTemplate: "{actor.name} writes a note.",
    effects: [{ type: "run_tool", toolId: "notes.append", toolInputFrom: "affordanceArgs", toolResultType: "tool_result" }],
  });
  worldSchema.defineAffordance({
    name: "review_notes",
    requires: ["notebook"],
    descriptionTemplate: "{actor.name} reviews recent notes.",
    effects: [{ type: "run_tool", toolId: "notes.list_recent", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  // Entities
  const agent = createAgentEntity(world as any, {
    name: "Riley",
    role: "Engineer",
    systemPrompt: "You are Riley.",
    roomId: office,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Riley");

  const computer = objectManager.spawn("computer", { name: "Workstation", containedIn: office })!;
  registerEntity(computer, "Workstation");
  const notebook = objectManager.spawn("notebook", { name: "Notebook", containedIn: office })!;
  registerEntity(notebook, "Notebook");

  // === SUCCESSFUL TOOL USE should be captured as semantic memory ===
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command echo hello" } as any }],
    registry
  );
  await runCognitionCycle(world as any, registry, { maxAgents: 0, enablePlanning: false });

  let mem = getAgentMemoryContents(world as any, agent);
  assert(mem.some((m) => m.includes("[Tool:terminal.run]") && m.includes("echo ran")), "expected tool_result to be captured as Memory");

  // === FAILED ACTION should be captured as episodic memory (action_failed stimulus) ===
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Workstation", content: "run_command rm -rf /" } as any }],
    registry
  );
  await runCognitionCycle(world as any, registry, { maxAgents: 0, enablePlanning: false });

  mem = getAgentMemoryContents(world as any, agent);
  assert(mem.some((m) => m.includes("FAILED") && m.toLowerCase().includes("run_command")), "expected action_failed to be captured as Memory");

  // === NOTE-TAKING writes a dedicated [Note] memory entry ===
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Notebook", content: "take_note Remember to ask Ada about the build pipeline." } as any }],
    registry
  );
  // Drain stimuli to avoid carrying tool_result into the next assertions.
  await runCognitionCycle(world as any, registry, { maxAgents: 0, enablePlanning: false });

  mem = getAgentMemoryContents(world as any, agent);
  assert(mem.some((m) => m.includes("[Note]") && m.includes("ask Ada")), "expected notes.append to create a [Note] memory entry");

  // === Notes can be reviewed via a tool result ===
  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Notebook", content: "review_notes {\"limit\": 3}" } as any }],
    registry
  );
  const pending = drainPendingStimuli();
  const toolResults = pending.filter((s) => s.type === "tool_result");
  assert(toolResults.length >= 1, "expected a tool_result stimulus from review_notes");
  assert(toolResults.some((s) => s.content.includes("ask Ada")), "expected notes.list_recent output to include the saved note");

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
