import { describe, it, expect, jest } from "@jest/globals";
import { query } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createEcsTools, createEntityRegistry } from "../../ecs/tools";
import { initializePrefabs } from "../../ecs/prefabs";
import { Name, Traits } from "../../ecs/components";
import { getRoomForEntity } from "../../ecs/location";
import { buildNarrativeGrowthTools, NARRATIVE_READ_TOOLS } from "../narrative-authority";

function fixture() {
  const world = createArgosWorld("Authority regression");
  initializePrefabs(world);
  const ecs = createEcsTools(world, createEntityRegistry());
  const landing = ecs.createRoom({ name: "Landing" }).result.entityId;
  const bedroom = ecs.createRoom({ name: "Bedroom" }).result.entityId;
  const phone = ecs.createObject({ name: "Mara's phone", roomName: "Landing", traits: ["phone"] }).result.entityId;
  const unsafe = jest.fn();
  const tools: Record<string, any> = {
    createObject: { execute: jest.fn(async (p: any) => ecs.createObject(p)) },
    createRoom: { execute: jest.fn(async (p: any) => ecs.createRoom(p)) },
    addRelation: { execute: unsafe },
    setComponentValues: { execute: unsafe },
    requestSystemBuild: { execute: unsafe },
    createAgent: { execute: unsafe },
    createAndPopulateRoom: { execute: unsafe },
    createStimulusSource: { execute: unsafe },
    defineRule: { execute: unsafe },
    spawn: { execute: unsafe },
  };
  for (const name of NARRATIVE_READ_TOOLS) tools[name] = { execute: jest.fn() };
  return { world, ecs, landing, bedroom, phone, tools, unsafe, scoped: buildNarrativeGrowthTools(world, tools) };
}

describe("narrative growth capability", () => {
  it("does not expose existing-state writes, cognition, delegated construction or stimuli", () => {
    const f = fixture();
    expect(Object.keys(f.scoped).sort()).toEqual([...NARRATIVE_READ_TOOLS, "createScenery", "createRoom"].sort());
    expect(f.scoped.addRelation).toBeUndefined();
    expect(f.scoped.requestSystemBuild).toBeUndefined();
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(getRoomForEntity(f.world, f.phone)).toBe(f.landing);
    // Scope filtering must not remove operator/God powers from the original tools.
    expect(f.tools.addRelation.execute).toBe(f.unsafe);
  });

  it.each(["Mara's phone", "Mara’s PHONE", "replacement Mara's phone", "phone"])("refuses to duplicate the live prop as %s", async name => {
    const f = fixture();
    const before = Array.from(query(f.world, [Name])).length;
    const result = await f.scoped.createScenery.execute({ name, kind: "decoration", description: "Put it back on the bedroom desk", roomName: "Bedroom" }, {});
    expect(result.success).toBe(false);
    expect(f.tools.createObject.execute).not.toHaveBeenCalled();
    expect(Array.from(query(f.world, [Name]))).toHaveLength(before);
    expect(getRoomForEntity(f.world, f.phone)).toBe(f.landing);
  });

  it("allows genuine inert scenery without forwarding arbitrary component or trait writes", async () => {
    const f = fixture();
    const result = await f.scoped.createScenery.execute({ name: "Chalk spiral", kind: "marking", description: "A chalk spiral beside the doorway", roomName: "Landing", portable: true, traits: ["phone", "takeable"], components: { Phone: { delivered: true } } }, {});
    expect(result.success).toBe(true);
    expect(getRoomForEntity(f.world, result.result.entityId)).toBe(f.landing);
    expect(JSON.parse(Traits.active[result.result.entityId])).toEqual(["examinable"]);
    expect(f.tools.createObject.execute).toHaveBeenCalledWith(expect.objectContaining({ portable: false, traits: ["examinable"] }), {});
    expect(getRoomForEntity(f.world, f.phone)).toBe(f.landing);
  });

  it("checks names against the current world at execution, including entities created after prompt capture", async () => {
    const f = fixture();
    f.ecs.createObject({ name: "Chalk spiral", roomName: "Bedroom" });
    const result = await f.scoped.createScenery.execute({ name: "Chalk spiral", kind: "marking", description: "A mark", roomName: "Landing" }, {});
    expect(result.success).toBe(false);
  });

  it("rejects unknown or renamed rooms instead of silently creating unplaced scenery", async () => {
    const f = fixture();
    Name.value[f.landing] = "Flooded landing";
    const result = await f.scoped.createScenery.execute({ name: "Chalk spiral", kind: "marking", description: "A mark", roomName: "Landing" }, {});
    expect(result.success).toBe(false);
    expect(f.tools.createObject.execute).not.toHaveBeenCalled();
  });

  it("can grow a new empty room but cannot replace a room or delegate population", async () => {
    const f = fixture();
    expect((await f.scoped.createRoom.execute({ name: "Bedroom" }, {})).success).toBe(false);
    const added = await f.scoped.createRoom.execute({ name: "Conservatory", description: "An empty glass room", requiredItems: ["replacement phone"] }, {});
    expect(added.success).toBe(true);
    expect(f.tools.createRoom.execute).toHaveBeenCalledWith({ name: "Conservatory", description: "An empty glass room", capacity: undefined, ambience: undefined }, {});
    expect(f.unsafe).not.toHaveBeenCalled();
    expect(getRoomForEntity(f.world, f.phone)).toBe(f.landing);
  });
});
