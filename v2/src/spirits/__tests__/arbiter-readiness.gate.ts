/** Opt-in readiness assertions, not default regression acceptance. */
import { jest } from "@jest/globals";
import { removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createRoomEntity, createAgentEntity, createObjectEntity } from "../../ecs/prefabs";
import { entityExistsByName, validateAgentAction } from "../consistency-spirit";

function fixture() {
  const world = createArgosWorld("Arbiter readiness"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Gate study" });
  createAgentEntity(world, { name: "Gate reader", role: "reader", systemPrompt: "Choose freely.", roomId: room });
  return { world, room };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline gate")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("A1: an ordinary native prop is recognized, not reported as nonexistent", () => {
  const f = fixture();
  const lamp = createObjectEntity(f.world, { name: "Gate reading lamp", roomId: f.room });
  expect(entityExistsByName(f.world, "Gate reading lamp")).toBe(lamp);
  expect(validateAgentAction(f.world, "Gate reader", "examine", "Gate reading lamp")
    .filter(issue => issue.category === "missing_entity")).toEqual([]);
});

test("A2: a removed prop is not resurrected by consistency inspection", () => {
  const f = fixture();
  const lamp = createObjectEntity(f.world, { name: "Gate removed lamp", roomId: f.room });
  removeEntity(f.world, lamp);
  expect(entityExistsByName(f.world, "Gate removed lamp")).toBeNull();
  expect(validateAgentAction(f.world, "Gate reader", "examine", "Gate removed lamp")
    .some(issue => issue.category === "missing_entity")).toBe(true);
  expect(entityExistsByName(f.world, "Gate removed lamp")).toBeNull();
});

test("A3: a prop in another world is not present in this world", () => {
  const a = fixture(), b = fixture();
  createObjectEntity(a.world, { name: "Gate private-world lamp", roomId: a.room });
  expect(entityExistsByName(b.world, "Gate private-world lamp")).toBeNull();
});

test("A4: missing-target evidence is not an automatically fixable construction order", () => {
  const f = fixture();
  const missing = validateAgentAction(f.world, "Gate reader", "pickup", "Gate absent oil can")
    .find(issue => issue.category === "missing_entity");
  expect(missing).toBeDefined();
  expect(missing!.autoFixable).toBe(false);
  expect(missing!.recommendation).not.toMatch(/^Create entity/);
});
