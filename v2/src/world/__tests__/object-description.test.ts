import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createObjectEntity, initializePrefabs } from "../../ecs/prefabs";
import { Description, DynamicDescription, ObjectState, ObjectType } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { ObjectManager } from "../object-manager";
import { transitionObjectState } from "../object-state";
import { worldSchema } from "../schema";

const exterior = "A worn wooden supplies box. Three hooked cuts cross the outer lid; pale paint is caught in the middle cut.";
function fixture() {
  const world = createArgosWorld("Authored physical evidence"); initializePrefabs(world);
  return { world, objects: new ObjectManager(world) };
}
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Description checks are offline")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test.each(["manager", "native"])("%s transitions preserve authored exterior while committing current state and traits", writer => {
  const f = fixture(), box = f.objects.spawn("chest", { description: exterior, state: "closed" })!;
  const transition = (state: string) => writer === "manager" ? f.objects.transitionState(box, state)
    : transitionObjectState(f.world, box, state, { world: f.world, worldSchema }).ok;
  for (const state of ["open", "closed", "locked", "closed", "open"]) {
    expect(transition(state)).toBe(true);
    expect(ObjectState.current[box]).toBe(state);
    expect(Description.value[box]).toBe(exterior);
    expect(f.objects.hasTrait(box, "openable")).toBe(state !== "locked");
    expect(f.objects.hasTrait(box, "container")).toBe(true);
  }
  expect(hasComponent(f.world, box, DynamicDescription)).toBe(true);
  expect(DynamicDescription.text[box]).toBe(exterior);
});

test("generic authored objects retain instance details when given a native schema type", () => {
  const f = fixture(), box = createObjectEntity(f.world, { name: "Marked box", description: exterior });
  ObjectType.typeId[box] = "chest";
  expect(transitionObjectState(f.world, box, "open", { world: f.world, worldSchema }).ok).toBe(true);
  expect(Description.value[box]).toBe(exterior);
});

test("ordinary schema descriptions still follow state and explicit description changes remain possible", () => {
  const f = fixture(), box = f.objects.spawn("chest")!;
  expect(hasComponent(f.world, box, DynamicDescription)).toBe(false);
  expect(f.objects.transitionState(box, "open")).toBe(true);
  expect(Description.value[box]).toBe("The chest stands open.");
  f.objects.setDescription(box, "The lid now has four hooked cuts.", "system");
  expect(f.objects.transitionState(box, "closed")).toBe(true);
  expect(Description.value[box]).toBe("The lid now has four hooked cuts.");
});

test("authored exterior survives save/reload and a subsequent native state transition", () => {
  const f = fixture(), box = f.objects.spawn("chest", { description: exterior })!;
  f.objects.transitionState(box, "open");
  const saved = serializeWorld(f.world, createSystemRegistry());
  const restored = fixture(), id = deserializeWorld(restored.world, createSystemRegistry(), saved).oldToNewId.get(box)!;
  expect(transitionObjectState(restored.world, id, "closed", { world: restored.world, worldSchema }).ok).toBe(true);
  expect(Description.value[id]).toBe(exterior);
  expect(DynamicDescription.text[id]).toBe(exterior);
  expect(ObjectState.current[id]).toBe("closed");
});
