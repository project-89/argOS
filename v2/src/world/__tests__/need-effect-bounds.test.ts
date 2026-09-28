import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Needs } from "../../ecs/components";
import { executeEffect, executeAffordance } from "../effect-executor";
import { worldSchema } from "../schema";
import { ObjectManager } from "../object-manager";
function fixture() {
  const world = createArgosWorld("Bounded needs"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Bakery" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: room });
  return { world, room, actor, ctx: { world, actorEid: actor, targetEid: actor, worldSchema, registry: { byName: new Map(), byId: new Map() } } };
}
test.each(["hunger", "energy", "social", "comfort"] as const)("native %s cannot overflow its physical scale", property => {
  const f = fixture(); Needs[property][f.actor] = 10;
  const effect = (operation: "add" | "subtract", value: number) => executeEffect({ type: "modify_component", target: "target",
    modifications: [{ component: "Needs", property, operation, value }] }, f.ctx);
  expect(effect("subtract", 30).success).toBe(true); expect(Needs[property][f.actor]).toBe(0);
  expect(effect("add", 150).success).toBe(true); expect(Needs[property][f.actor]).toBe(100);
});
test("the actual food affordance reduces hunger without a negative state", () => {
  const f = fixture(), objects = new ObjectManager(f.world);
  const food = objects.spawn("food_item", { containedIn: f.room, state: "fresh" })!;
  Needs.hunger[f.actor] = 10;
  const result = executeAffordance("eat", { ...f.ctx, targetEid: food });
  expect(result.success).toBe(true); expect(Needs.hunger[f.actor]).toBe(0);
});
