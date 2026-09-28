import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { createHouseholdScenario, HOUSEHOLD_GROWTH_SITES } from "../spatial-household";
import { createHouseholdChallengeScenario, HOUSEHOLD_CHALLENGE_STORY_STYLE } from "../spatial-household-challenge";
import { validateSpatialScenario } from "../spatial-scenario";
import { SpatialDemo } from "../spatial-demo";
import { SPATIAL_ASSETS } from "../spatial-catalog";
import { BASE_AFFORDANCES } from "../../world/schema";
import { characterPastSchema } from "../../cognition/character-past-schema";
import { Goal, GoalLifecycle, Needs, ObjectState } from "../../ecs/components";
import { HasGoal, SittingOn } from "../../ecs/relations";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";

const demos: SpatialDemo[] = [];
beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Offline challenge fixture")));
afterEach(() => { for (const demo of demos.splice(0)) demo.stop(); expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a separate detached challenge preserves the original evening and its grants", () => {
  const original = createHouseholdScenario(), first = createHouseholdChallengeScenario(), other = createHouseholdChallengeScenario();
  expect(first.id).toBe("household-competing-wants-v1"); expect(first.id).not.toBe(original.id);
  expect(first.blueprint.id).not.toBe(original.blueprint.id);
  expect(validateSpatialScenario(first)).toEqual(first);
  first.residents[0].past!.memories[0].recollection = "Copy-only change";
  first.blueprint.props[0].position.x = 99;
  expect(createHouseholdChallengeScenario()).toEqual(other);
  expect(createHouseholdScenario()).toEqual(original);
  expect(original.blueprint.props.filter(p => p.assetId === "food")).toHaveLength(2);
  expect(original.blueprint.props.find(p => p.id === "household-empty-box")!.state).toBeUndefined();
  expect(HOUSEHOLD_GROWTH_SITES).toHaveLength(1); // Same possible chair, no expanded authority.
  expect(first.maxWorldEntities).toBe(original.maxWorldEntities);
});

test("incompatible wants have real finite resources and supported actions, not hidden scripted resolutions", () => {
  const s = createHouseholdChallengeScenario();
  expect(s.residents.map(r => r.name)).toEqual(["Tess", "Ivo", "Noor", "Mara"]);
  const food = s.blueprint.props.filter(p => p.assetId === "food");
  expect(food.map(p => p.id)).toEqual(["household-pear-pastry"]);
  expect(food[0].supportedBy).toBe("household-kitchen-table");
  expect(s.residents.filter(r => r.needs.hunger >= 70)).toHaveLength(3);
  const seats = s.blueprint.props.filter(p => SPATIAL_ASSETS[p.assetId].affordances.includes("sit"));
  expect(seats.map(p => p.id)).toEqual(["household-patio-chair"]);
  expect(s.blueprint.rooms.find(r => r.id === seats[0].roomId)!.environment).toBe("outdoor");
  expect(s.blueprint.props.find(p => p.id === "household-empty-box")!.state).toBe("open");
  for (const p of s.blueprint.props) for (const affordance of SPATIAL_ASSETS[p.assetId].affordances) expect(BASE_AFFORDANCES[affordance]).toBeDefined();
  expect(s.residents.every(r => r.initialGoal.kind === "custom")).toBe(true);
  expect(s.residents.map(r => r.initialGoal.description).join(" ")).not.toMatch(/cook|harvest|brew|buy|sell|repair|play music/);
  expect(Object.keys(s).sort()).toEqual(Object.keys(createHouseholdScenario()).sort());
});

test("reservation and relationship details remain asymmetric private memories", () => {
  const s = createHouseholdChallengeScenario(), [tess, ivo, noor, mara] = s.residents;
  const publicScene = JSON.stringify({ blueprint: s.blueprint, style: HOUSEHOLD_CHALLENGE_STORY_STYLE });
  expect(publicScene).not.toMatch(/Alex|promise|reserved|private food arrangement|becoming more than friends/);
  for (const r of s.residents) {
    const past = characterPastSchema.parse(r.past);
    expect(past.memories).toHaveLength(5);
    for (const memory of past.memories) {
      expect(memory.provenance).toBe("authored-history");
      expect(publicScene).not.toContain(memory.recollection);
    }
  }
  expect(ivo.past!.background).toContain("promised to leave the pear pastry");
  expect(noor.past!.background).toContain("privately promised to save her the pear pastry");
  expect(JSON.stringify(tess)).not.toContain("promised to");
  expect(JSON.stringify(mara)).not.toContain("pear pastry");
  for (const r of [tess, ivo, noor]) expect(JSON.stringify(r)).not.toContain("Alex");
  expect(mara.phoneContact?.name).toBe("Alex");
  expect(mara.past!.background).toContain("does not mean a new message has arrived");
});

test("characters have personal histories beyond today's condition and usable open-ended purposes", () => {
  const s = createHouseholdChallengeScenario(), noor = s.residents.find(r => r.id === "noor")!;
  expect(noor.role).not.toMatch(/tired|rest|passive/);
  expect(noor.needs.energy).toBeLessThan(30);
  expect(noor.past!.background).toContain("on another day she might be the energetic one");
  for (const r of s.residents) {
    expect(r.past!.drives.length).toBeGreaterThanOrEqual(3);
    expect(r.aspirations.length).toBeGreaterThanOrEqual(3);
    expect(r.past!.memories.some(m => m.period !== "Earlier today")).toBe(true);
    expect(r.initialGoal.description.length).toBeLessThanOrEqual(300);
    expect(r.systemPrompt).not.toContain(r.initialGoal.description);
  }
  expect(s.residents.find(r => r.id === "mara")!.initialGoal.description).toContain("Get my phone");
  expect(s.residents.find(r => r.id === "tess")!.initialGoal.description).toContain("Close the storage box");
});

test("manual native mechanics support the conflicting purposes without proving autonomous behavior or completing them", async () => {
  // This intentionally bypasses cognition to validate only the physical testbed.
  const demo = await SpatialDemo.create({ world: createHouseholdChallengeScenario(), automaticClock: false, seconds: 600 });
  demos.push(demo); await demo.start();
  const world = demo.sim.world, view = demo.snapshot();
  const actor = (name: string) => view.actors.find(a => a.name === name)!;
  const target = (id: string) => demo.snapshot().entities.find(e => e.id === demo.byId.get(id))!;
  const kitchen = demo.snapshot().rooms.find(r => r.id === demo.byId.get("household-kitchen"))!;
  const goals = demo.actors.flatMap(id => getRelationTargets(world, id, HasGoal).filter(g => GoalLifecycle.source[g] === "personal"));
  expect(goals.length).toBeGreaterThanOrEqual(4);
  expect(demo.snapshot().actors.every(a => a.messages.length === 0)).toBe(true);

  const tess = actor("Tess"); demo.dispatch(tess.key, "move", kitchen.key); demo.advance(30_000);
  expect(getRoomForEntity(world, tess.id)).toBe(kitchen.id);
  const box = target("household-empty-box"); expect(ObjectState.current[box.id]).toBe("open");
  demo.dispatch(tess.key, "interact", box.key, "close"); demo.advance(30_000);
  expect(ObjectState.current[box.id]).toBe("closed");
  const food = target("household-pear-pastry"), hunger = Needs.hunger[tess.id];
  demo.dispatch(tess.key, "interact", food.key, "eat"); demo.advance(30_000);
  expect(Needs.hunger[tess.id]).toBeLessThan(hunger);
  expect(demo.snapshot().entities.some(e => e.key === food.key)).toBe(false);
  expect(demo.snapshot().entities.filter(e => e.asset === "food")).toHaveLength(0);

  const noor = actor("Noor"), chair = target("household-patio-chair");
  demo.dispatch(noor.key, "interact", chair.key, "sit"); demo.advance(30_000);
  expect(getRelationTargets(world, noor.id, SittingOn)).toContain(chair.id);

  const mara = actor("Mara"), phone = target("mara-phone");
  demo.dispatch(mara.key, "pickup", phone.key); demo.advance(30_000);
  expect(getDirectContainer(world, phone.id)).toBe(mara.id);
  for (const goal of goals) expect(Goal.status[goal]).not.toBe("completed");
});
