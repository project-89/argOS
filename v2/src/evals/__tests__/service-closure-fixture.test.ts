import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createSystemRegistry, runSystems } from "../../ecs/dynamic-systems";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, Needs, Plan } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { ObjectManager } from "../../world/object-manager";
import { executeActions, createIntentGoal } from "../../cognition/cognition-system";
import { startCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { enableRoomRouteTopology, connectRoomRoute } from "../../runtime/room-routes";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { prepareServiceClosure, prepareGeneratedServiceClosure, serviceExchangeOccurred, SERVICE_MEAL_INTENTION, GENERATED_SERVICE_MEAL_INTENTION } from "../service-closure-fixture";
import { observeBakeryOutcomes, hasBakeryOutcomeFeedback } from "../bakery-outcome";
import { gatherArchitectContext } from "../../spirits/architect-spirit";

function fixture(generated = false) {
  const world = createArgosWorld("Service closure"); initializePrefabs(world); startCommittedEvents(world);
  world.meta.aiEnabled = false; world.meta.timedActions = true; world.meta.timedSpeech = true;
  const registry = createSystemRegistry(), street = createRoomEntity(world, { name: "Street" }), room = createRoomEntity(world, { name: "Bakery" });
  const actor = createAgentEntity(world, { name: "Ada", role: "visitor", systemPrompt: "Choose", roomId: street });
  const baker = createAgentEntity(world, { name: "Leo", role: "baker", systemPrompt: "Choose", roomId: room });
  const food = new ObjectManager(world).spawn("food_item", { name: "Loaf", containedIn: room })!;
  Needs.hunger[actor] = 70;
  const goal = createIntentGoal(world, actor, generated ? GENERATED_SERVICE_MEAL_INTENTION : SERVICE_MEAL_INTENTION, 7);
  enableRoomRouteTopology(world, { travelMs: 4000 }); connectRoomRoute(world, street, room);
  const setup = () => prepareServiceClosure(world, registry, { actor, goal, room, baker, foodIds: [food] });
  const advance = (ms = 10000) => advanceSimulationTimeline(world, ms, { integrate: delta => runSystems(world, registry, world.time.tick, delta) });
  const act = (eid: number, action: any) => { executeActions(world, [{ eid, action }], registry); advance(); };
  return { world, registry, actor, baker, food, goal, room, street, setup, advance, act };
}
test("explicit custody requires handoff; original typed meal goal closes once through native evaluation", async () => {
  const f = fixture(), created = Goal.createdAt[f.goal]; f.setup();
  expect(getCommittedEvents(f.world).events).toEqual([]); expect(getDirectContainer(f.world, f.food)).toBe(f.baker);
  const outcomes = observeBakeryOutcomes(f.world, f.actor, [f.food], () => {});
  f.act(f.actor, { type: "move", target: "Bakery" });
  expect(Goal.status[f.goal]).toBe("active"); expect(getAvailableAffordances(f.world, f.actor, f.food).map(a => a.name)).not.toContain("eat");
  f.act(f.actor, { type: "speak", target: "Leo", content: "May I have a loaf, please?" });
  f.act(f.baker, { type: "speak", target: "Ada", content: "Certainly. Here you are." });
  expect(serviceExchangeOccurred(f.world, f.actor, f.baker)).toBe(true); expect(Goal.status[f.goal]).toBe("active");
  f.act(f.baker, { type: "give", target: "Ada", content: "Loaf" });
  const handed = await gatherArchitectContext(f.world, f.registry);
  expect(Goal.status[f.goal]).toBe("active"); expect(outcomes.evidence.handoffThenMeal).toBe(false);
  const stalePlan = addEntity(f.world); addComponent(f.world, stalePlan, Plan); addComponent(f.world, f.actor, HasPlan(stalePlan));
  Plan.goalEid[stalePlan] = f.goal; Plan.status[stalePlan] = "active"; Plan.steps[stalePlan] = "[]";
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Loaf", content: "eat" } }], f.registry);
  expect(Goal.status[f.goal]).toBe("active"); f.advance();
  expect(Goal.status[f.goal]).toBe("completed"); expect(Goal.progress[f.goal]).toBe(100); expect(Goal.createdAt[f.goal]).toBe(created);
  expect(Plan.status[stalePlan]).not.toBe("active"); expect(Needs.hunger[f.actor]).toBe(40);
  expect(outcomes.evidence.handoffThenMeal).toBe(true);
  expect(hasBakeryOutcomeFeedback(outcomes.evidence, [handed, await gatherArchitectContext(f.world, f.registry)], true)).toBe(true);
  f.advance(); expect(f.registry.events.filter(e => e.type === "goal_completed" && e.data.goal === SERVICE_MEAL_INTENTION)).toHaveLength(1);
});
test("a running-world service target binding reads authored custody and never completes the purpose",()=>{
  const f=fixture(true);f.advance(5000);setLocatedIn(f.world,f.food,f.baker);
  const before=Goal.createdAt[f.goal];
  const setup=prepareGeneratedServiceClosure(f.world,f.registry,{actor:f.actor,goal:f.goal,room:f.room,baker:f.baker,foodIds:[f.food]});
  expect(setup.stockAfter).toEqual(setup.stockBefore);expect(getDirectContainer(f.world,f.food)).toBe(f.baker);
  expect(Goal.status[f.goal]).toBe("active");expect(Goal.progress[f.goal]).toBe(0);expect(Goal.createdAt[f.goal]).toBe(before);
  f.advance();expect(Goal.status[f.goal]).toBe("active");
});
test("a served meal must cover hunger drift with actual finite food, not a reduced completion threshold", () => {
  const f = fixture(true); f.advance(5000); setLocatedIn(f.world, f.food, f.baker);
  const second = new ObjectManager(f.world).spawn("food_item", { name: "Second loaf", containedIn: f.baker })!;
  Needs.hunger[f.actor] = 76;
  prepareGeneratedServiceClosure(f.world, f.registry, { actor: f.actor, goal: f.goal, room: f.room, baker: f.baker, foodIds: [f.food, second] });
  f.act(f.actor, { type: "move", target: "Bakery" });
  f.act(f.baker, { type: "give", target: "Ada", content: "Loaf" });
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" });
  expect(Needs.hunger[f.actor]).toBe(46); expect(Goal.status[f.goal]).toBe("active");
  f.act(f.baker, { type: "give", target: "Ada", content: "Second loaf" });
  f.act(f.actor, { type: "interact", target: "Second loaf", content: "eat" });
  expect(Needs.hunger[f.actor]).toBe(16); expect(Goal.status[f.goal]).toBe("completed");
});
test.each(["room_stock","already_used"])("running-world binding cannot repair %s",boundary=>{
  const f=fixture(true);if(boundary==="already_used"){
    setLocatedIn(f.world,f.food,f.baker);f.act(f.baker,{type:"interact",target:"Loaf",content:"examine"});
  }
  const custody=getDirectContainer(f.world,f.food),proof=Goal.successJson[f.goal];
  expect(()=>prepareGeneratedServiceClosure(f.world,f.registry,{actor:f.actor,goal:f.goal,room:f.room,baker:f.baker,foodIds:[f.food]})).toThrow();
  expect(getDirectContainer(f.world,f.food)).toBe(custody);expect(Goal.successJson[f.goal]).toBe(proof);
});
test("inaccessible, pending and failed eating cannot retire the meal intention", () => {
  const f = fixture(); f.setup(); f.act(f.actor, { type: "move", target: "Bakery" });
  f.act(f.actor, { type: "interact", target: "Loaf", content: "eat" }); expect(Goal.status[f.goal]).toBe("active");
  f.act(f.baker, { type: "give", target: "Ada", content: "Loaf" });
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Loaf", content: "eat" } }], f.registry);
  setLocatedIn(f.world, f.food, f.baker); f.advance();
  expect(Goal.status[f.goal]).toBe("active"); expect(Needs.hunger[f.actor]).toBe(70);
});
test("lower hunger, another actor's meal or claims of completion are insufficient", () => {
  const f = fixture(); f.setup(); f.act(f.actor, { type: "move", target: "Bakery" });
  f.act(f.baker, { type: "interact", target: "Loaf", content: "eat" });
  Needs.hunger[f.actor] = 40; f.act(f.actor, { type: "speak", target: "Leo", content: "I ate and completed everything." });
  expect(Goal.status[f.goal]).toBe("active"); expect(serviceExchangeOccurred(f.world, f.actor, f.baker)).toBe(false);
});
test("partial or unheard speech cannot satisfy reciprocal service interaction", () => {
  const f = fixture(); f.setup();
  f.act(f.baker, { type: "speak", target: "Ada", content: "Hello there." });
  f.act(f.actor, { type: "move", target: "Bakery" });
  f.act(f.actor, { type: "speak", target: "Leo", content: "Hello." });
  executeActions(f.world, [{ eid: f.baker, action: { type: "speak", target: "Ada", content: "Welcome to this small bakery. What would you like this morning?" } }], f.registry);
  f.advance(500); expect(serviceExchangeOccurred(f.world, f.actor, f.baker)).toBe(false);
});
test.each(["wrongGoal", "afterChoice", "duplicateStock", "wrongStock"])("setup rejects %s without rewriting custody or intentions", variant => {
  const f = fixture();
  if (variant === "wrongGoal") Goal.description[f.goal] = "Visit, meet, and eat; an unbound compound goal";
  if (variant === "afterChoice") f.act(f.actor, { type: "speak", content: "Already started." });
  const foodIds = variant === "duplicateStock" ? [f.food, f.food] : variant === "wrongStock" ? [f.room] : [f.food];
  const contract = Goal.successJson[f.goal];
  expect(() => prepareServiceClosure(f.world, f.registry, { actor: f.actor, goal: f.goal, room: f.room, baker: f.baker, foodIds })).toThrow();
  expect(getDirectContainer(f.world, f.food)).toBe(f.room); expect(Goal.successJson[f.goal]).toBe(contract);
});
