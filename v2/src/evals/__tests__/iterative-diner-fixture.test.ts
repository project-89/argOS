import { hasComponent, query } from "bitecs";
import { createIterativeDinerFixture } from "../iterative-diner-fixture";
import { Agent, BehaviorPolicy, Goal, Name, Needs, Removed, Room, PhysicalObject, StimulusSource } from "../../ecs/components";
import { ApartmentSitcom } from "../../demo/apartment-sitcom";
import { readGoalSuccessContract } from "../../cognition/goal-contract";
import { getRoomForEntity } from "../../ecs/location";
import { ObjectManager } from "../../world/object-manager";
import { getCommittedEvents } from "../../runtime/committed-events";
import { gatherArchitectContext } from "../../spirits/architect-spirit";

test("prospective diner is incomplete, not depleted stock restored by the host", async () => {
  const f = await createIterativeDinerFixture(false);
  try {
    const { world } = f.sim, objects = new ObjectManager(world);
    expect(world.time.elapsed).toBe(0); expect(getCommittedEvents(world).events).toEqual([]);
    expect([...query(world, [Room, Name])].map(eid => Name.value[eid])).toEqual(["Neighborhood Diner"]);
    expect([...query(world, [Agent, Name])].map(eid => Name.value[eid])).toEqual(["Ada"]);
    expect([f.table, f.chair, f.removed].every(eid => getRoomForEntity(world, eid) === f.room)).toBe(true);
    expect(hasComponent(world, f.removed, Removed)).toBe(true);
    expect([...query(world, [PhysicalObject])].filter(eid => objects.hasTrait(eid, "edible") && !hasComponent(world, eid, Removed))).toEqual([]);
    expect(Needs.hunger[f.actor]).toBe(65); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
    const context = await gatherArchitectContext(world, f.sim.god.systemRegistry);
    expect(context.actorIntentions?.some(e => e.description === f.intention)).toBe(true);
    expect(context.setting.unavailableEntities).toContainEqual({ eid: f.removed, name: "Removed celebration cake", reason: "removed" });
    expect(context.setting.entities.some(e => e.eid === f.removed)).toBe(false);
    expect(f.sim.god.systemRegistry.systems.has("GoalEvaluationSystem")).toBe(true);
  } finally { f.sim.stop(); }
});

test("v2 enables the established sitcom foreground profile without changing v1 or scripting a choice", async () => {
  const sitcom = await ApartmentSitcom.create({ live: false, worldMaintenance: false, outsideTextAtMs: null,
    cognitionController: "priority", narrativeMind: true, experienceReconsideration: true });
  // These fixtures initialize the process-global component arrays. Capture
  // comparison values and stop before creating another world in this process.
  const fields = ["cognitionController", "narrativeMind", "experienceReconsideration"] as const;
  const profile = fields.map(field => sitcom.sim.world.meta[field]);
  const sitcomPolicy = BehaviorPolicy.enabled[sitcom.ids.Elaine];
  sitcom.stop();
  const f = await createIterativeDinerFixture(false, "purposeful-v2");
  try {
    expect(fields.map(field => f.sim.world.meta[field])).toEqual(profile);
    expect(hasComponent(f.sim.world, f.actor, BehaviorPolicy)).toBe(true);
    expect(BehaviorPolicy.enabled[f.actor]).toBe(false);
    expect(sitcomPolicy).toBe(false);
    expect(f.sim.world.time.elapsed).toBe(0); expect(getCommittedEvents(f.sim.world).events).toEqual([]);
    expect(Needs.hunger[f.actor]).toBe(65); expect(Goal.status[f.goal]).toBe("active");
    expect(readGoalSuccessContract(f.goal)).toEqual({ type: "all_of", conditions: [
      { type: "in_room", roomName: "Neighborhood Diner" }, { type: "did_interact_affordance", affordance: "eat" }] });
    const context = await gatherArchitectContext(f.sim.world, f.sim.god.systemRegistry);
    expect(context.setting.unavailableEntities).toContainEqual({ eid: f.removed, name: "Removed brass key", reason: "removed" });
    expect(context.setting.entities.some(e => e.eid === f.removed)).toBe(false);
    const objects = new ObjectManager(f.sim.world);
    expect(objects.hasTrait(f.removed, "edible")).toBe(false);
    expect(hasComponent(f.sim.world, f.removed, StimulusSource)).toBe(true);
    expect([...query(f.sim.world, [PhysicalObject])].some(e => objects.hasTrait(e, "edible"))).toBe(false);
  } finally { f.sim.stop(); }
});
