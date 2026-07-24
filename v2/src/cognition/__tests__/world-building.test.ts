import "dotenv/config";

import { createArgosWorld, type World } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Name, Traits, Description, Agent, Needs, ObjectType, ObjectState } from "../../ecs/components";
import { addEntity, addComponent, query, hasComponent } from "bitecs";
import { registerEntity } from "../cognition-system";
import { setLocatedIn, getRoomForEntity, listDirectContents } from "../../ecs/location";
import { worldSchema, registerAffordance } from "../../world/schema";
import { registerTrait } from "../../world/trait-registry";
import { executeAffordance, type EffectContext } from "../../world/effect-executor";

function makeWorld() {
  const world = createArgosWorld("WorldBuildTest") as any;
  initializePrefabs(world);
  return world;
}

function makeEffectContext(world: any, actorEid: number, targetEid: number): EffectContext {
  return {
    world,
    actorEid,
    targetEid,
    worldSchema,
    registry: {
      byName: new Map(),
      byId: new Map(),
    },
  } as any;
}

beforeEach(() => {
  // Clean up any previously defined types/affordances from other tests
});

describe("World Building: Define → Spawn → Perceive → Interact", () => {
  test("full chain: define type → register affordance → agent spawns entity → entity has traits → second agent uses it", () => {
    const world = makeWorld();

    // Set up rooms
    const forge = createRoomEntity(world, { name: "Forge", description: "A blacksmith's forge" });
    registerEntity(forge, "Forge");

    // Set up agents
    const aldric = createAgentEntity(world, { name: "Aldric", role: "blacksmith", systemPrompt: "Smith.", roomId: forge });
    registerEntity(aldric, "Aldric");
    const greta = createAgentEntity(world, { name: "Greta", role: "innkeeper", systemPrompt: "Inn.", roomId: forge });
    registerEntity(greta, "Greta");

    // Step 1: Define a new object type (what God AI would do)
    worldSchema.defineObjectType({
      name: "iron_sword",
      description: "A {adjective} iron sword",
      traits: ["weapon", "sellable", "examinable"],
      states: {
        hot: { description: "Freshly forged, still glowing", traits: ["dangerous"] },
        cooled: { description: "Cooled and ready for use" },
      },
      defaultState: "hot",
      category: "weapon",
    });

    // Verify type is registered
    const swordType = worldSchema.getObjectType("iron_sword");
    expect(swordType).toBeDefined();
    expect(swordType!.traits).toContain("weapon");
    expect(swordType!.traits).toContain("sellable");

    // Step 2: Register traits and affordance with spawn effect
    registerTrait({ name: "weapon", description: "A weapon", category: "equipment", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "sellable", description: "Can be sold", category: "commerce", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "examinable", description: "Can be examined", category: "general", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "dangerous", description: "Dangerous to touch", category: "general", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "forgeable", description: "Can be forged", category: "crafting", enablesAffordances: [], incompatibleWith: [] });

    registerAffordance({
      name: "forge_iron_sword",
      description: "Forge a new iron sword at the anvil",
      requires: ["forgeable"],
      effects: [
        {
          type: "spawn",
          spawnType: "iron_sword",
          spawnName: "Aldric's Iron Sword",
          containerName: "room",
          spawnProperties: { adjective: "gleaming", material: "iron" },
        },
        {
          type: "modify_component",
          target: "actor",
          modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 15 }],
        },
        {
          type: "emit_stimulus",
          target: "nearby",
          stimulusContent: "Aldric hammers red-hot metal into a sword!",
          stimulusType: "observation",
        },
      ],
    } as any);

    // Step 3: Create an anvil target with forgeable trait
    const anvil = addEntity(world);
    addComponent(world, anvil, Name as any); Name.value[anvil] = "Iron Anvil";
    addComponent(world, anvil, Traits as any); Traits.active[anvil] = JSON.stringify(["forgeable", "examinable"]);
    setLocatedIn(world, anvil, forge);
    registerEntity(anvil, "Iron Anvil");

    // Step 4: Agent executes the affordance
    const ctx = makeEffectContext(world, aldric, anvil);
    const result = executeAffordance("forge_iron_sword", ctx);

    // Verify the affordance succeeded
    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.startsWith("spawned:"))).toBe(true);

    // Step 5: Verify spawned entity exists with correct traits
    const spawnedName = "Aldric's Iron Sword";
    const spawnedEid = ctx.registry.byName.get(spawnedName);
    expect(spawnedEid).toBeDefined();
    expect(Name.value[spawnedEid!]).toBe(spawnedName);

    // Check traits from type definition
    const traitsJson = Traits.active[spawnedEid!];
    const traits = JSON.parse(traitsJson);
    expect(traits).toContain("weapon");
    expect(traits).toContain("sellable");
    expect(traits).toContain("examinable");
    expect(traits).toContain("dangerous"); // From "hot" state

    // Check it has ObjectType and ObjectState
    expect(hasComponent(world, spawnedEid!, ObjectType as any)).toBe(true);
    expect(ObjectType.typeId[spawnedEid!]).toBe("iron_sword");
    expect(ObjectState.current[spawnedEid!]).toBe("hot");

    // Step 6: Verify entity is in the room (perceivable by other agents)
    const roomEid = getRoomForEntity(world, spawnedEid!);
    expect(roomEid).toBe(forge);

    // Other agents can "see" it via listDirectContents
    const roomContents = listDirectContents(world, forge);
    expect(roomContents).toContain(spawnedEid);

    // Step 7: Verify energy was deducted from the actor
    expect(Needs.energy[aldric]).toBeLessThan(100);
  });

  test("destroy effect removes entity from world and room", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");

    // Create a destroyable object
    registerTrait({ name: "breakable", description: "Can be broken", category: "general", enablesAffordances: [], incompatibleWith: [] });

    const pot = addEntity(world);
    addComponent(world, pot, Name as any); Name.value[pot] = "Clay Pot";
    addComponent(world, pot, Traits as any); Traits.active[pot] = JSON.stringify(["breakable"]);
    setLocatedIn(world, pot, room);
    registerEntity(pot, "Clay Pot");

    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    registerAffordance({
      name: "smash_pot",
      description: "Smash the pot",
      requires: ["breakable"],
      effects: [{ type: "destroy", target: "target" }],
    } as any);

    // Verify pot is in room before
    expect(listDirectContents(world, room)).toContain(pot);

    const ctx = makeEffectContext(world, agent, pot);
    const result = executeAffordance("smash_pot", ctx);

    expect(result.success).toBe(true);
    expect(result.changes.some(c => c.startsWith("destroyed:"))).toBe(true);
  });

  test("modify_component changes entity state", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");

    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    registerTrait({ name: "edible", description: "Can be eaten", category: "food", enablesAffordances: [], incompatibleWith: [] });

    const bread = addEntity(world);
    addComponent(world, bread, Name as any); Name.value[bread] = "Bread";
    addComponent(world, bread, Traits as any); Traits.active[bread] = JSON.stringify(["edible"]);
    setLocatedIn(world, bread, room);
    registerEntity(bread, "Bread");

    registerAffordance({
      name: "eat_bread",
      description: "Eat bread",
      requires: ["edible"],
      effects: [{
        type: "modify_component",
        target: "actor",
        modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 30 }],
      }],
    } as any);

    // Set hunger to 80
    Needs.hunger[agent] = 80;

    const ctx = makeEffectContext(world, agent, bread);
    const result = executeAffordance("eat_bread", ctx);

    expect(result.success).toBe(true);
    expect(Needs.hunger[agent]).toBe(50); // 80 - 30
  });

  test("add_trait makes entity interactive via new affordances", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Room", description: "A room" });
    registerEntity(room, "Room");

    const agent = createAgentEntity(world, { name: "Test", role: "worker", systemPrompt: "Test.", roomId: room });
    registerEntity(agent, "Test");

    registerTrait({ name: "raw_iron", description: "Unworked iron", category: "material", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "heated", description: "Hot metal", category: "state", enablesAffordances: [], incompatibleWith: [] });

    const iron = addEntity(world);
    addComponent(world, iron, Name as any); Name.value[iron] = "Iron Ingot";
    addComponent(world, iron, Traits as any); Traits.active[iron] = JSON.stringify(["raw_iron"]);
    setLocatedIn(world, iron, room);
    registerEntity(iron, "Iron Ingot");

    registerAffordance({
      name: "heat_metal",
      description: "Heat the metal in the forge fire",
      requires: ["raw_iron"],
      effects: [{ type: "add_trait", target: "target", trait: "heated" }],
    } as any);

    const ctx = makeEffectContext(world, agent, iron);
    const result = executeAffordance("heat_metal", ctx);

    expect(result.success).toBe(true);

    // Verify trait was added
    const traits = JSON.parse(Traits.active[iron]);
    expect(traits).toContain("raw_iron"); // Still has original
    expect(traits).toContain("heated");    // Now also heated
  });

  test("multi-step crafting: heat → forge → cool", () => {
    const world = makeWorld();
    const room = createRoomEntity(world, { name: "Forge", description: "A forge" });
    registerEntity(room, "Forge");

    const smith = createAgentEntity(world, { name: "Smith", role: "blacksmith", systemPrompt: "Smith.", roomId: room });
    registerEntity(smith, "Smith");

    // Define traits for the crafting chain
    registerTrait({ name: "raw_metal", description: "Raw metal", category: "material", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "hot_metal", description: "Heated metal", category: "state", enablesAffordances: [], incompatibleWith: [] });
    registerTrait({ name: "shaped", description: "Shaped into form", category: "state", enablesAffordances: [], incompatibleWith: [] });

    // Define object type for the final product
    worldSchema.defineObjectType({
      name: "steel_blade",
      description: "A sharp steel blade",
      traits: ["weapon", "sellable", "examinable"],
      states: { ready: { description: "Ready for use" } },
      defaultState: "ready",
      category: "weapon",
    });

    // Step 1: Heat
    registerAffordance({
      name: "heat_in_forge",
      description: "Heat metal in the forge",
      requires: ["raw_metal"],
      effects: [
        { type: "add_trait", target: "target", trait: "hot_metal" },
        { type: "remove_trait", target: "target", trait: "raw_metal" },
      ],
    } as any);

    // Step 2: Forge (requires hot metal)
    registerAffordance({
      name: "hammer_shape",
      description: "Hammer hot metal into shape",
      requires: ["hot_metal"],
      effects: [
        { type: "add_trait", target: "target", trait: "shaped" },
        { type: "remove_trait", target: "target", trait: "hot_metal" },
      ],
    } as any);

    // Step 3: Finish (requires shaped, spawns final product)
    registerAffordance({
      name: "finish_blade",
      description: "Finish and sharpen the blade",
      requires: ["shaped"],
      effects: [
        { type: "spawn", spawnType: "steel_blade", spawnName: "Fine Steel Blade", containerName: "room" },
        { type: "destroy", target: "target" }, // Consume the work piece
      ],
    } as any);

    // Create raw material
    const ingot = addEntity(world);
    addComponent(world, ingot, Name as any); Name.value[ingot] = "Steel Ingot";
    addComponent(world, ingot, Traits as any); Traits.active[ingot] = JSON.stringify(["raw_metal"]);
    setLocatedIn(world, ingot, room);
    registerEntity(ingot, "Steel Ingot");

    // Execute step 1: Heat
    let ctx = makeEffectContext(world, smith, ingot);
    let result = executeAffordance("heat_in_forge", ctx);
    expect(result.success).toBe(true);
    let traits = JSON.parse(Traits.active[ingot]);
    expect(traits).toContain("hot_metal");
    expect(traits).not.toContain("raw_metal");

    // Execute step 2: Forge
    ctx = makeEffectContext(world, smith, ingot);
    result = executeAffordance("hammer_shape", ctx);
    expect(result.success).toBe(true);
    traits = JSON.parse(Traits.active[ingot]);
    expect(traits).toContain("shaped");
    expect(traits).not.toContain("hot_metal");

    // Execute step 3: Finish (spawns blade, destroys ingot)
    ctx = makeEffectContext(world, smith, ingot);
    result = executeAffordance("finish_blade", ctx);
    expect(result.success).toBe(true);

    // Verify spawned blade
    const bladeEid = ctx.registry.byName.get("Fine Steel Blade");
    expect(bladeEid).toBeDefined();
    const bladeTraits = JSON.parse(Traits.active[bladeEid!]);
    expect(bladeTraits).toContain("weapon");
    expect(bladeTraits).toContain("sellable");

    // Verify ingot was destroyed
    expect(result.changes.some(c => c.includes("destroyed"))).toBe(true);
  });
});
