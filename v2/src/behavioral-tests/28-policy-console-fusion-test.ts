/**
 * Behavioral Test: LLM + BehaviorPolicy Fusion (Policy Console)
 *
 * Verifies:
 * - A BehaviorPolicy can be installed via a grounded object affordance (`set_policy` -> run_tool policy.set)
 * - Once installed, agentThink chooses the policy action deterministically (no LLM required)
 *
 * Run:
 *   npx tsx src/behavioral-tests/28-policy-console-fusion-test.ts
 */
import "dotenv/config";

import { createWorld } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Needs } from "../ecs/components";
import { setLocatedIn } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { agentThink } from "../cognition/agent-mind";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  POLICY CONSOLE FUSION TEST");
  console.log("═".repeat(70) + "\n");

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createWorld();
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const lobby = createRoomEntity(world as any, {
    name: "Lobby",
    description: "A lobby.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  const kitchen = createRoomEntity(world as any, {
    name: "Kitchen",
    description: "A kitchen.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 5, y: 1 },
  });
  registerEntity(lobby, "Lobby");
  registerEntity(kitchen, "Kitchen");

  // Define a grounded "policy console" device that lets agents install a behavior policy.
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
    name: "Casey",
    role: "Engineer",
    systemPrompt: "You are Casey.",
    roomId: lobby,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Casey");

  // Hungry → policy should move to Kitchen
  Needs.hunger[agent] = 0.95;

  const consoleEid = objectManager.spawn("policy_console", { name: "Policy Console", containedIn: lobby })!;
  registerEntity(consoleEid, "Policy Console");

  // No policy yet: with no LLM key, agentThink falls back and returns wait.
  const before = await agentThink(world as any, agent);
  assert(before.type === "wait", "expected wait before policy is installed (no LLM key)");

  // Install policy via grounded affordance/tool.
  const tree = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_above", need: "hunger", value: 0.8 } },
          { type: "action", action: { type: "move", target: "Kitchen" } },
        ],
      },
      { type: "action", action: { type: "wait" } },
    ],
  };

  executeActions(
    world as any,
    [{ eid: agent, action: { type: "interact", target: "Policy Console", content: `set_policy ${JSON.stringify({ tree })}` } as any }],
    registry
  );

  const pending = drainPendingStimuli();
  assert(pending.some((s) => s.type === "tool_result" && s.content.includes("Policy set")), "expected tool_result confirming policy set");

  // With policy installed, agent should deterministically choose move->Kitchen (no LLM).
  const after = await agentThink(world as any, agent);
  assert(after.type === "move" && after.target === "Kitchen", "expected policy-selected move to Kitchen");

  // After arriving and hunger reduced, policy should wait.
  setLocatedIn(world as any, agent, kitchen);
  Needs.hunger[agent] = 0.1;
  const after2 = await agentThink(world as any, agent);
  assert(after2.type === "wait", "expected wait after hunger condition no longer holds");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});

