/**
 * Behavioral Test: BehaviorPolicy can invoke a learned Procedure
 *
 * Verifies:
 * - A procedural skill (stored as Memory) can be learned from repeated grounded interactions
 * - A BehaviorPolicy can start that procedure via a `use_procedure` node
 * - The resulting action is executed deterministically (no LLM required)
 *
 * Run:
 *   npx tsx src/behavioral-tests/29-policy-invokes-procedure-test.ts
 */
import "dotenv/config";

import { hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { ProcedureState } from "../ecs/components";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";
import { proceduralSignature } from "../cognition/procedural-skills";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  POLICY -> PROCEDURE INVOCATION TEST");
  console.log("═".repeat(70) + "\n");

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("PolicyProcedureInvocationTest") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const office = createRoomEntity(world as any, {
    name: "Office",
    description: "A small office.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(office, "Office");

  worldSchema.defineObjectType({
    name: "notepad",
    description: "A small notepad for jotting down notes.",
    traits: ["notepad", "examinable"],
    states: { idle: { description: "A blank notepad lies here.", traits: ["notepad"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "write_note",
    requires: ["notepad"],
    descriptionTemplate: "{actor.name} writes a note.",
    effects: [{ type: "run_tool", toolId: "notes.append" }],
  });

  // Policy console to install policies via grounded tool call.
  worldSchema.defineObjectType({
    name: "policy_console",
    description: "A console for configuring behavior policies",
    traits: ["policy_console", "examinable"],
    states: { idle: { description: "A console awaits a policy JSON.", traits: ["policy_console"] } },
    defaultState: "idle",
    category: "device",
  });
  worldSchema.defineAffordance({
    name: "set_policy",
    requires: ["policy_console"],
    descriptionTemplate: "{actor.name} installs a behavior policy.",
    effects: [{ type: "run_tool", toolId: "policy.set", toolInputFrom: "affordanceArgsJson", toolResultType: "tool_result" }],
  });

  const agent = createAgentEntity(world as any, {
    name: "Riley",
    role: "Engineer",
    systemPrompt: "You are Riley.",
    roomId: office,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Riley");

  const notepad = objectManager.spawn("notepad", { name: "Notepad", containedIn: office })!;
  const consoleEid = objectManager.spawn("policy_console", { name: "Policy Console", containedIn: office })!;
  registerEntity(notepad, "Notepad");
  registerEntity(consoleEid, "Policy Console");

  // Train a procedural skill by repeating a successful grounded interaction.
  for (let i = 0; i < 2; i++) {
    executeActions(
      world as any,
      [{ eid: agent, action: { type: "interact", target: "Notepad", content: "write_note policy" } as any }],
      registry
    );
    drainPendingStimuli();
  }

  const signature = proceduralSignature({ affordance: "write_note", args: "policy" });
  const tree = { type: "use_procedure", signature, minSuccesses: 2 };

  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Policy Console", content: `set_policy ${JSON.stringify({ tree })}` } as any }],
    registry
  );
  const pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("Policy set")), "expected tool_result confirming policy set");

  const next = await agentThink(world as any, agent);
  assert(next.type === "interact", "expected policy to start procedure and yield an interact action");

  executeActions(world as any, [{ eid: agent, action: next as any }], registry);
  const pending2 = drainPendingStimuli();
  assert(
    pending2.some((s) => s.type === "tool_result" && s.content.includes("Note saved")),
    "expected tool_result from notes.append"
  );

  assert(!hasComponent(world as any, agent, ProcedureState as any), "expected ProcedureState to be cleared after single-step procedure");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
