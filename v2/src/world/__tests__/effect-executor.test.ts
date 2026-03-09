/**
 * Unit Tests for Effect Executor
 *
 * Tests:
 * - set_state effect updates Description.value from WorldSchema
 * - Trait recalculation on state change
 * - Effect execution
 */

import "dotenv/config";
import { addEntity, addComponent, hasComponent, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Goal, Name, Description, ObjectState, ObjectType, Traits, Room, StimulusSource, Inventory, ToolResult } from "../../ecs/components";
import { executeEffect, executeAffordance, type EffectContext } from "../effect-executor";
import { worldSchema } from "../schema";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { HasGoal, HasToolResult, SittingOn } from "../../ecs/relations";

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

    test("should update StimulusSource from schema stimuli (torch)", () => {
      const world = createTestWorld();

      const torchEid = createTestObject(
        world,
        "wall torch",
        "torch",
        "unlit",
        "An unlit torch.",
        ["examinable", "lightSource", "lightable"]
      );

      const ctx = createEffectContext(world, torchEid);
      const result = executeEffect(
        { type: "set_state", target: "target", state: "lit" },
        ctx
      );

      expect(result.success).toBe(true);
      expect(ObjectState.current[torchEid]).toBe("lit");

      // Torch "lit" has stimuli; executor should pick the strongest (light=0.8)
      expect(hasComponent(world, torchEid, StimulusSource)).toBe(true);
      expect(StimulusSource.stimulusType[torchEid]).toBe("light");
      expect(StimulusSource.template[torchEid]).toContain("Warm flickering light");
      expect(StimulusSource.interval[torchEid]).toBeGreaterThan(0);
    });

    test("should remove StimulusSource when new state has no stimuli", () => {
      const world = createTestWorld();

      const chestEid = createTestObject(
        world,
        "wooden chest",
        "chest",
        "open",
        "An open chest.",
        ["examinable", "container", "openable"]
      );

      // Force a StimulusSource onto the chest (some legacy content might have this)
      addComponent(world, chestEid, StimulusSource);
      StimulusSource.stimulusType[chestEid] = "sound";
      StimulusSource.template[chestEid] = "A weird hum";
      StimulusSource.interval[chestEid] = 5000;
      StimulusSource.lastEmit[chestEid] = 0;

      const ctx = createEffectContext(world, chestEid);
      const result = executeEffect(
        { type: "set_state", target: "target", state: "closed" },
        ctx
      );

      expect(result.success).toBe(true);
      // Chest states have no stimuli; executor should remove any existing StimulusSource.
      expect(hasComponent(world, chestEid, StimulusSource)).toBe(false);
    });
  });

  test("run_tool records ToolResult evidence and links it via HasToolResult", () => {
    const world = createArgosWorld("EffectExecutor_tool_evidence") as any;
    initializePrefabs(world);

    const room = createRoomEntity(world, { name: "Office" });
    const agent = createAgentEntity(world, { name: "Dev", role: "npc", systemPrompt: "x", roomId: room });

    // Make sure the agent has an active goal so ToolResult.goalEid can be set.
    const goalEid = addEntity(world);
    addComponent(world, goalEid, Goal as any);
    addComponent(world, agent, HasGoal(goalEid) as any);
    Goal.status[goalEid] = "active";
    Goal.priority[goalEid] = 10;
    Goal.createdAt[goalEid] = Date.now();

    // Create a computer-like target with the required traits for run_command.
    const computer = createTestObject(
      world,
      "Workstation",
      "computer",
      "powered_on",
      "A test workstation",
      ["usable", "typeable", "device", "computer"]
    );
    setLocatedIn(world, computer, room);

    const ctx: EffectContext = {
      world,
      actorEid: agent,
      targetEid: computer,
      worldSchema,
      registry: { byName: new Map(), byId: new Map() },
      affordanceArgs: "echo hello",
    } as any;

    const res = executeAffordance("run_command", ctx);
    // run_command's run_tool effect has failOnToolError=false, so it should succeed even in scripted mode.
    expect(res.success).toBe(true);

    const toolEids = getRelationTargets(world, agent, HasToolResult as any) as number[];
    expect(toolEids.length).toBeGreaterThan(0);
    const anyTool = toolEids.some((eid) => hasComponent(world, eid, ToolResult as any) && ToolResult.toolId[eid] === "terminal.run");
    expect(anyTool).toBe(true);
  });

  describe("transfer + relation effects (affordances)", () => {
    test("take should move object into actor via LocatedIn", () => {
      const world = createTestWorld();
      initializePrefabs(world);

      const roomEid = createRoomEntity(world, { name: "Room" });
      const actorEid = createAgentEntity(world, { name: "Actor", role: "tester", systemPrompt: "test", roomId: roomEid });
      const itemEid = createObjectEntity(world, { name: "Rock", portable: true, roomId: roomEid, traits: ["takeable"] });

      const ctx: EffectContext = {
        world,
        actorEid,
        targetEid: itemEid,
        worldSchema,
        registry: { byName: new Map([["Rock", itemEid], ["Room", roomEid], ["Actor", actorEid]]), byId: new Map() },
      };

      expect(getDirectContainer(world, itemEid)).toBe(roomEid);
      const res = executeAffordance("take", ctx);
      expect(res.success).toBe(true);
      expect(getDirectContainer(world, itemEid)).toBe(actorEid);
    });

    test("take should fail if actor inventory has no capacity", () => {
      const world = createTestWorld();
      initializePrefabs(world);

      const roomEid = createRoomEntity(world, { name: "Room" });
      const actorEid = createAgentEntity(world, { name: "Actor", role: "tester", systemPrompt: "test", roomId: roomEid });
      const itemEid = createObjectEntity(world, { name: "Rock", portable: true, roomId: roomEid, traits: ["takeable"] });

      Inventory.maxSlots[actorEid] = 0;

      const ctx: EffectContext = {
        world,
        actorEid,
        targetEid: itemEid,
        worldSchema,
        registry: { byName: new Map([["Rock", itemEid], ["Room", roomEid], ["Actor", actorEid]]), byId: new Map() },
      };

      const res = executeAffordance("take", ctx);
      expect(res.success).toBe(false);
      expect(getDirectContainer(world, itemEid)).toBe(roomEid);
    });

    test("drop should move object into actor room via LocatedIn", () => {
      const world = createTestWorld();
      initializePrefabs(world);

      const roomEid = createRoomEntity(world, { name: "Room" });
      const actorEid = createAgentEntity(world, { name: "Actor", role: "tester", systemPrompt: "test", roomId: roomEid });
      const itemEid = createObjectEntity(world, { name: "Rock", portable: true, roomId: roomEid, traits: ["takeable"] });

      const ctx: EffectContext = {
        world,
        actorEid,
        targetEid: itemEid,
        worldSchema,
        registry: { byName: new Map([["Rock", itemEid], ["Room", roomEid], ["Actor", actorEid]]), byId: new Map() },
      };

      executeAffordance("take", ctx);
      expect(getDirectContainer(world, itemEid)).toBe(actorEid);

      const dropRes = executeAffordance("drop", ctx);
      expect(dropRes.success).toBe(true);
      expect(getDirectContainer(world, itemEid)).toBe(roomEid);
    });

    test("sit should add SittingOn relation (ECS AllRelations)", () => {
      const world = createTestWorld();
      initializePrefabs(world);

      const roomEid = createRoomEntity(world, { name: "Room" });
      const actorEid = createAgentEntity(world, { name: "Actor", role: "tester", systemPrompt: "test", roomId: roomEid });

      // Use the schema "chair" type so the "occupied" state exists.
      const chairEid = createTestObject(
        world,
        "Chair",
        "chair",
        "empty",
        "The chair sits empty.",
        ["sittable", "examinable", "furniture"]
      );

      const ctx: EffectContext = {
        world,
        actorEid,
        targetEid: chairEid,
        worldSchema,
        registry: { byName: new Map([["Chair", chairEid], ["Room", roomEid], ["Actor", actorEid]]), byId: new Map() },
      };

      const res = executeAffordance("sit", ctx);
      expect(res.success).toBe(true);
      expect(hasComponent(world, actorEid, SittingOn(chairEid))).toBe(true);
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
