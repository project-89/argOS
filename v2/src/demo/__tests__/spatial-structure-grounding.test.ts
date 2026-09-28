/** Offline native fixture checks, not autonomous behavior evidence. */
import { jest } from "@jest/globals";
import { hasComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { Container, Name, ObjectState, ObjectType } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { recordInspectionResult } from "../../cognition/inspection-memory";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getAgentVisualEntities } from "../../cognition/world-capabilities";
import { getGoalCompletionOptions } from "../../cognition/goal-lifecycle";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { worldSchema } from "../../world/schema";

let demo: SpatialDemo | undefined;
beforeEach(() => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Structural grounding tests are offline"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { demo?.stop(); demo = undefined; expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("the household utility surfaces are examinable solid walls, not storage or occupancy targets", async () => {
  demo = await SpatialDemo.create({ scenario: "household", story: "household", evolving: true, live: false, automaticClock: false });
  expect(worldSchema.hasTrait("structural_geometry")).toBe(true);
  const world = demo.sim.world, actor = demo.actors.find(eid => Name.value[eid] === "Ivo")!;
  setLocatedIn(world, actor, demo.byId.get("household-kitchen")!);
  const walls = [...demo.byId].filter(([id]) => id.startsWith("household-utility-"));
  expect(walls.length).toBeGreaterThan(0);
  for (const [, wall] of walls) {
    expect(ObjectType.typeId[wall]).toBe("structural_wall");
    expect(ObjectState.current[wall]).toBe("solid");
    expect(hasComponent(world, wall, Container)).toBe(false);
    expect(getAgentVisualEntities(world, actor)).toContain(wall);
    const verbs = getAvailableAffordances(world, actor, wall).map(a => a.name);
    expect(verbs).toContain("examine");
    expect(verbs).not.toContain("sit"); expect(verbs).not.toContain("open");
    expect(getGoalCompletionOptions(world, actor).filter(option => option.description.includes(Name.value[wall]))).toEqual([]);
    const inspection = recordInspectionResult(world, actor, wall)!;
    expect(inspection.outcome).toBe("observed");
    expect(inspection.summary).toMatch(/structural wall.*not a container/i);
    const receipt = getWorkingMemory(world, actor).receipts.find(r => r.id === inspection.sourceId)!;
    expect(receipt.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: inspection.subject, slot: "Entity.kind", value: "structural_geometry" }),
      expect.objectContaining({ subject: inspection.subject, slot: "ObjectType.typeId", value: "structural_wall" }),
      expect.objectContaining({ subject: inspection.subject, slot: "Container.present", value: "false" }),
    ]));
    expect(receipt.facts.some(f => f.slot === "Container.visibleContents")).toBe(false);
  }
});
