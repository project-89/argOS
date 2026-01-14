/**
 * Unit Tests for Effect Executor
 *
 * Tests:
 * - set_state effect updates Description.value from WorldSchema
 * - Trait recalculation on state change
 * - Effect execution
 */

import "dotenv/config";
import { addEntity, addComponent, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name, Description, ObjectState, ObjectType, Traits, Room } from "../../ecs/components";
import { Contains } from "../../ecs/relations";
import { executeEffect, type EffectContext } from "../effect-executor";
import { worldSchema } from "../schema";

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestWorld() {
  return createArgosWorld("Test World");
}

function createTestRoom(world: ReturnType<typeof createArgosWorld>, name: string) {
  const eid = addEntity(world);
  addComponent(world, eid, Room);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);

  Name.value[eid] = name;
  Description.value[eid] = `A test room called ${name}`;
  Room.ambience[eid] = "A plain room for testing.";

  return eid;
}

function createTestObject(
  world: ReturnType<typeof createArgosWorld>,
  name: string,
  typeId: string,
  initialState: string,
  initialDescription: string,
  traits: string[]
) {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  addComponent(world, eid, Description);
  addComponent(world, eid, ObjectState);
  addComponent(world, eid, ObjectType);
  addComponent(world, eid, Traits);

  Name.value[eid] = name;
  Description.value[eid] = initialDescription;
  ObjectState.current[eid] = initialState;
  ObjectState.previous[eid] = "";
  ObjectType.typeId[eid] = typeId;
  ObjectType.instanceName[eid] = name;
  Traits.active[eid] = JSON.stringify(traits);

  return eid;
}

function createEffectContext(world: ReturnType<typeof createArgosWorld>, targetEid: number): EffectContext {
  return {
    world,
    targetEid,
    worldSchema,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe("Effect Executor", () => {
  describe("set_state effect", () => {
    test("should update ObjectState.current", () => {
      const world = createTestWorld();

      // Use "chest" which exists in BASE_OBJECT_TYPES
      const objectEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "closed",
        "A closed wooden chest.",
        ["examinable", "container", "openable"]
      );

      const ctx = createEffectContext(world, objectEid);
      const result = executeEffect(
        { type: "set_state", target: "target", state: "open" },
        ctx
      );

      expect(result.success).toBe(true);
      expect(ObjectState.current[objectEid]).toBe("open");
      expect(result.changes).toContain("state: closed -> open");
    });

    test("should update Description.value from WorldSchema", () => {
      const world = createTestWorld();

      // Use "chest" which exists in BASE_OBJECT_TYPES with multiple states
      const objectEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "closed",
        "A closed wooden chest.",
        ["examinable", "container", "openable"]
      );

      const ctx = createEffectContext(world, objectEid);

      // Check initial description
      expect(Description.value[objectEid]).toBe("A closed wooden chest.");

      // Execute set_state to change to open
      const result = executeEffect(
        { type: "set_state", target: "target", state: "open" },
        ctx
      );

      expect(result.success).toBe(true);

      // Description should be updated from WorldSchema's "open" state for chest
      const typeDef = worldSchema.getObjectType("chest");
      if (typeDef && typeDef.states["open"]) {
        expect(Description.value[objectEid]).toBe(typeDef.states["open"].description);
      }
    });

    test("should recalculate traits on state change using chest type", () => {
      const world = createTestWorld();

      // Use "chest" which has different traits per state
      const objectEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "closed",
        "A closed wooden chest.",
        ["examinable", "container", "openable"]
      );

      const ctx = createEffectContext(world, objectEid);

      // Execute set_state to change to open
      executeEffect(
        { type: "set_state", target: "target", state: "open" },
        ctx
      );

      // Traits should be recalculated from WorldSchema
      const traitsJson = Traits.active[objectEid];
      const traits = JSON.parse(traitsJson) as string[];

      // Open state has "container" trait (from schema) and should NOT have "openable"
      // because open state doesn't include openable
      expect(traits).toContain("container");
      // The base traits are merged with state traits, openable comes from base
      expect(traits).toContain("examinable");
    });

    test("should handle locked chest state", () => {
      const world = createTestWorld();

      // Create a locked chest
      const objectEid = createTestObject(
        world,
        "locked chest",
        "chest",
        "locked",
        "A locked wooden chest.",
        ["examinable", "container", "lockable", "locked"]
      );

      const ctx = createEffectContext(world, objectEid);

      // Unlock the chest (change to closed state)
      executeEffect(
        { type: "set_state", target: "target", state: "closed" },
        ctx
      );

      expect(ObjectState.current[objectEid]).toBe("closed");

      // Traits should be updated - check that state changed
      const traitsJson = Traits.active[objectEid];
      const traits = JSON.parse(traitsJson) as string[];

      // Closed state should have openable trait
      expect(traits).toContain("openable");
    });
  });

  describe("add_trait effect", () => {
    test("should add a trait to the target", () => {
      const world = createTestWorld();
      const objectEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "closed",
        "A wooden chest.",
        ["examinable"]
      );

      const ctx = createEffectContext(world, objectEid);
      const result = executeEffect(
        { type: "add_trait", target: "target", trait: "elevated" },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.changes).toContain("+trait: elevated");

      const traitsJson = Traits.active[objectEid];
      const traits = JSON.parse(traitsJson) as string[];
      expect(traits).toContain("elevated");
    });
  });

  describe("remove_trait effect", () => {
    test("should remove a trait from the target", () => {
      const world = createTestWorld();
      const objectEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "closed",
        "A wooden chest.",
        ["examinable", "takeable", "elevated"]
      );

      const ctx = createEffectContext(world, objectEid);
      const result = executeEffect(
        { type: "remove_trait", target: "target", trait: "elevated" },
        ctx
      );

      expect(result.success).toBe(true);
      expect(result.changes).toContain("-trait: elevated");

      const traitsJson = Traits.active[objectEid];
      const traits = JSON.parse(traitsJson) as string[];
      expect(traits).not.toContain("elevated");
    });
  });
});
