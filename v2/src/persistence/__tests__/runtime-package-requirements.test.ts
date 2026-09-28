import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity } from "../../ecs/prefabs";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { serializeWorld, deserializeWorld } from "../world-persistence";
import { validateSimulationSnapshot } from "../simulation-snapshot";

test("teardown and data-only round trips cannot erase a native package requirement", () => {
  const world = createArgosWorld("Native package"); initializePrefabs(world);
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Own decisions" });
  const dispose = registerAgentWorldCapabilities(world, actor, { context: () => "native physics", ready: () => true, busy: () => false, execute: () => false });
  dispose();
  const saved = serializeWorld(world, createSystemRegistry());
  expect(saved.runtimePackages).toEqual(["native-agent-world-capabilities"]);
  expect(() => validateSimulationSnapshot(saved)).toThrow(/requires native package reattachment/);
  const restored = createArgosWorld("Data inspection only"); initializePrefabs(restored); const registry = createSystemRegistry();
  deserializeWorld(restored, registry, saved);
  expect(serializeWorld(restored, registry).runtimePackages).toEqual(saved.runtimePackages);
});
