import { sitcomLaunchProfile } from "../sitcom-launch-profile";
import { ApartmentSitcom } from "../apartment-sitcom";
import { getIdentityAnchors } from "../../cognition/narrative-memory";

test("GUI defaults explicitly select current cognition, David history and bounded God-reviewed growth", () => {
  expect(sitcomLaunchProfile([])).toEqual({ live: true, scenario: "cookie", outsideTextAtMs: null,
    cognitionController: "priority", narrativeMind: true, experienceReconsideration: true,
    cookieHistory: "david", openNeighborhood: true, worldMaintenance: true,
    growthLimits: { maxWorldEntities: 32, maxBuildJobs: 0 } });
  expect(sitcomLaunchProfile(["--core-only"])).toMatchObject({ worldMaintenance: false, cookieHistory: "david", narrativeMind: true });
  expect(sitcomLaunchProfile(["--legacy-profile"])).toMatchObject({ cookieHistory: "legacy", worldMaintenance: false, narrativeMind: false, openNeighborhood: false });
  expect(sitcomLaunchProfile(["--focused"])).toMatchObject({ scenario: "duet", cookieHistory: "legacy", narrativeMind: true });
});
test("interactive authoring uses the real four-person cookie world and never schedules a hidden text", async () => {
  const t = await ApartmentSitcom.create({ ...sitcomLaunchProfile([]), live: false });
  try {
    expect(t.sim.world.meta).toMatchObject({ cognitionController: "priority", narrativeMind: true, experienceReconsideration: true });
    expect(t.characters).toEqual(["Jerry", "George", "Elaine", "Kramer"]);
    expect(t.options).toMatchObject({ cookieHistory: "david", openNeighborhood: true, outsideTextAtMs: null });
    expect(t.snapshot().contact).toMatchObject({ name: "David", relationship: "boyfriend" });
    expect(getIdentityAnchors(t.sim.world, t.ids.Elaine).length).toBeGreaterThan(0);
    expect(t.snapshot().phone).toEqual([]); expect(t.running).toBe(false);
    expect(t.sim.getAgentGoals("Elaine").some(g => g.description.includes("cookie"))).toBe(true);
  } finally { t.stop(); }
});
