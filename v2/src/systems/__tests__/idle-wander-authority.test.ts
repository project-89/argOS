import { query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Needs } from "../../ecs/components";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { createIdleWanderSystem } from "../builtin-systems";
import { beginRest } from "../../cognition/rest-state";

test.each([true, false, undefined])("idle wander remains a no-AI/legacy fallback (aiEnabled=%s)", aiEnabled => {
  const world = createArgosWorld("Idle authority"); initializePrefabs(world); world.meta.aiEnabled = aiEnabled;
  const here = createRoomEntity(world, { name: "Common Room" }); createRoomEntity(world, { name: "Garden" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: here });
  Needs.energy[actor] = 100; Needs.hunger[actor] = 0;
  const registry = createSystemRegistry(), system = createIdleWanderSystem(); system.frequency = 0;
  registry.systems.set(system.name, system); runSystems(world, registry, 1, 500);
  expect([...query(world, [Goal])]).toHaveLength(aiEnabled === true ? 0 : 1);
});

test("even the no-AI fallback does not overrule an inhabited rest state", () => {
  const world = createArgosWorld("Rest authority"); initializePrefabs(world);
  const here = createRoomEntity(world, { name: "Common Room" }); createRoomEntity(world, { name: "Garden" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "test", roomId: here });
  Needs.energy[actor] = 100; Needs.hunger[actor] = 0; beginRest(world, actor);
  const registry = createSystemRegistry(), system = createIdleWanderSystem(); system.frequency = 0;
  registry.systems.set(system.name, system); runSystems(world, registry, 1, 500);
  expect([...query(world, [Goal])]).toHaveLength(0);
});
