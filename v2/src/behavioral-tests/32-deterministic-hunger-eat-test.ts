/**
 * Behavioral Test: Deterministic hunger satisfaction via BehaviorPolicy (no LLM)
 *
 * Verifies:
 * - A BehaviorPolicy can select a real in-world target by trait (edible)
 * - The agent performs the grounded action (interact "eat") and hunger decreases
 * - The eaten food entity is destroyed (world state changes deterministically)
 *
 * Run:
 *   npx tsx src/behavioral-tests/32-deterministic-hunger-eat-test.ts
 */
import "dotenv/config";

import { hasComponent } from "bitecs";
import { createSystemRegistry } from "../ecs/dynamic-systems";
import { createArgosWorld } from "../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../ecs/prefabs";
import { Name, Needs, ObjectType } from "../ecs/components";
import { listDirectContents } from "../ecs/location";
import { worldSchema, ObjectManager } from "../world";
import { executeActions, registerEntity } from "../cognition/cognition-system";
import { drainPendingStimuli } from "../cognition/stimulus-queue";
import { registerBuiltinOfficeTools } from "../office-tools/builtin-tools";
import { setOfficeToolMode } from "../office-tools/tool-registry";

function assert(condition: any, message: string): void {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  DETERMINISTIC HUNGER-EAT TEST");
  console.log("═".repeat(70) + "\n");

  const prevKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  setOfficeToolMode("scripted");
  registerBuiltinOfficeTools();

  const world = createArgosWorld("DeterministicHungerEatTest") as any;
  initializePrefabs(world);
  const registry = createSystemRegistry();
  const objectManager = new ObjectManager(world as any);

  const kitchen = createRoomEntity(world as any, {
    name: "Kitchen",
    description: "A kitchen.",
    capacity: 10,
    ambience: "office",
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(kitchen, "Kitchen");

  // Grounded policy console to install behavior policy via tool.
  worldSchema.defineObjectType({
    name: "policy_console_32",
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
    name: "Morgan",
    role: "NPC",
    systemPrompt: "You are Morgan.",
    roomId: kitchen,
    gridPosition: { x: 1, y: 1 },
  });
  registerEntity(agent, "Morgan");

  // Use the engine's canonical hunger scale (0..100).
  Needs.hunger[agent] = 90;

  const foodEid = objectManager.spawn("food_item", {
    containedIn: kitchen,
    state: "fresh",
    properties: { foodType: "bread", adjective: "fresh" },
  });
  assert(foodEid !== null, "expected food_item spawn");
  const foodName = String(Name.value[foodEid as any] || "").trim();
  assert(foodName.length > 0, "expected spawned food to have a name");

  const consoleEid = objectManager.spawn("policy_console_32", { name: "Policy Console", containedIn: kitchen })!;
  registerEntity(consoleEid, "Policy Console");

  // Install a deterministic policy: if hungry, eat any edible in the room.
  const tree = {
    type: "selector",
    children: [
      {
        type: "sequence",
        children: [
          { type: "condition", op: { type: "need_above", need: "hunger", value: 70 } },
          { type: "interact_with_trait", trait: "edible", affordance: "eat", scope: "room" },
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
  assert(pending.some((s) => s.type === "tool_result" && String(s.content || "").includes("Policy set")), "expected tool_result confirming policy set");

  // Next deterministic action should be to eat the food.
  const { agentThink } = await import("../cognition/agent-mind");
  const action = await agentThink(world as any, agent);
  assert(action.type === "interact" && String(action.content || "").startsWith("eat"), "expected deterministic eat interact action");

  executeActions(world as any, [{ eid: agent, action: action as any }], registry);
  drainPendingStimuli();

  assert(Needs.hunger[agent] <= 60, `expected hunger to decrease after eating, got ${Needs.hunger[agent]}`);
  // Entity IDs can be recycled; verify the food object is no longer present as a world object.
  assert(!hasComponent(world as any, foodEid as any, ObjectType as any) || String(ObjectType.typeId[foodEid as any] || "") !== "food_item", "expected food object to be destroyed");
  const stillInRoom = listDirectContents(world as any, kitchen).some((eid: number) => String(Name.value[eid] || "") === foodName);
  assert(!stillInRoom, "expected eaten food to be removed from room contents");

  if (prevKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = prevKey;

  console.log("✓ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ FAIL", e);
  process.exit(1);
});
