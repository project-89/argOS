import { addComponent, addEntity, getRelationTargets, query, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Agent, Goal, Name, ObjectState, Removed } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { initializeRegistry, registryCreateComponent } from "../../ecs/component-registry";
import { setGoalContract, type GoalSuccessV1 } from "../../cognition/goal-contract";
import { recordCompletedGoalAction } from "../../cognition/cognition-system";
import { getAgentProceduralSkills } from "../../cognition/procedural-skills";
import { evaluateGoalSuccessContract, goalEvaluationSystem } from "../goal-evaluation-system";

const proof = { type: "entity_component_equals" as const, entityName: "Storm shutters",
  component: "ShutterProof", field: "state", equals: "latched" };

function fixture(success: unknown = proof) {
  const world = createArgosWorld("component proof");
  initializeRegistry(world);
  const component = registryCreateComponent({ name: "ShutterProof", description: "Current physical shutter state",
    properties: { state: "string", count: "number", enabled: "boolean" } });
  const agent = addEntity(world);
  addComponent(world, agent, Agent); addComponent(world, agent, Name);
  Name.value[agent] = "Mara"; Agent.active[agent] = true;
  const target = addEntity(world);
  addComponent(world, target, Name); Name.value[target] = "Storm shutters";
  addComponent(world, target, component);
  component.state[target] = "unlatched"; component.count[target] = 0; component.enabled[target] = false;
  const goal = addEntity(world);
  addComponent(world, goal, Goal); addComponent(world, agent, HasGoal(goal));
  Goal.status[goal] = "active"; Goal.progress[goal] = 0; Goal.createdAt[goal] = 1000;
  setGoalContract(world, goal, { version: 1, kind: "custom", params: {}, success: success as GoalSuccessV1,
    description: "Latch the storm shutters" });
  const evaluate = () => evaluateGoalSuccessContract(world, agent, goal).satisfied;
  return { world, agent, target, component, goal, evaluate };
}

test("registered dynamic component proof reads current attached state and does not mutate it", () => {
  const f = fixture();
  expect(f.evaluate()).toBe(false);
  f.component.state[f.target] = "latched";
  expect(f.evaluate()).toBe(true);
  expect(f.component.state[f.target]).toBe("latched");
  expect(Goal.status[f.goal]).toBe("active");
  expect(Goal.progress[f.goal]).toBe(0);
  f.component.state[f.target] = "unlatched";
  expect(f.evaluate()).toBe(false);
});

test.each([
  ["latched", "latched", true], ["latched", "Latched", false], ["latched", "latched ", false],
  [0, 0, true], [0, "0", false], [1, true, false], [false, false, true], [false, 0, false], [true, "true", false],
])("component evidence uses strict primitive equality: %p versus %p", (actual, equals, expected) => {
  const f = fixture({ ...proof, equals });
  f.component.state[f.target] = actual;
  expect(f.evaluate()).toBe(expected);
});

test("the same condition works on an attached registered built-in component", () => {
  const f = fixture({ ...proof, component: "ObjectState", field: "current", equals: "closed" });
  ObjectState.current[f.target] = "closed";
  expect(f.evaluate()).toBe(false);
  addComponent(f.world, f.target, ObjectState);
  expect(f.evaluate()).toBe(true);
});

test("entity names are exact and must identify exactly one live named entity", () => {
  const f = fixture();
  f.component.state[f.target] = "latched";
  for (const name of ["storm shutters", "Storm shutters annex", "Storm shutters "]) {
    Name.value[f.target] = name;
    expect(f.evaluate()).toBe(false);
  }
  Name.value[f.target] = "Storm shutters";
  expect(f.evaluate()).toBe(true);
  const duplicate = addEntity(f.world);
  addComponent(f.world, duplicate, Name); Name.value[duplicate] = "Storm shutters";
  // Ambiguity is rejected even though the duplicate has no ShutterProof component.
  expect(f.evaluate()).toBe(false);
  removeEntity(f.world, duplicate);
  expect(f.evaluate()).toBe(true);
  removeComponent(f.world, f.target, Name);
  expect(f.evaluate()).toBe(false);
});

test("deleted entities and detached components cannot satisfy goals through stale array cells", () => {
  const f = fixture();
  f.component.state[f.target] = "latched";
  expect(f.evaluate()).toBe(true);
  removeComponent(f.world, f.target, f.component);
  expect(f.component.state[f.target]).toBe("latched");
  expect(f.evaluate()).toBe(false);
  addComponent(f.world, f.target, f.component);
  expect(f.evaluate()).toBe(true);
  removeEntity(f.world, f.target);
  expect(f.evaluate()).toBe(false);
});

test.each(["target", "container"])("a removed %s cannot provide current component proof from retained historical state", scope => {
  const f = fixture();
  f.component.state[f.target] = "latched";
  const removed = scope === "target" ? f.target : addEntity(f.world);
  if (scope === "container") setLocatedIn(f.world, f.target, removed);
  expect(f.evaluate()).toBe(true);
  addComponent(f.world, removed, Removed);
  expect(f.evaluate()).toBe(false);
  expect(f.component.state[f.target]).toBe("latched"); // Proof reads never erase history.
  removeComponent(f.world, removed, Removed);
  expect(f.evaluate()).toBe(true);
});

test("a same-named tombstone retains name ambiguity rather than selecting a convenient live match", () => {
  const f = fixture();
  f.component.state[f.target] = "latched";
  const duplicate = addEntity(f.world);
  addComponent(f.world, duplicate, Name); Name.value[duplicate] = "Storm shutters";
  addComponent(f.world, duplicate, Removed);
  expect(f.evaluate()).toBe(false);
  removeEntity(f.world, duplicate);
  expect(f.evaluate()).toBe(true);
});

test.each([
  { entityName: "" }, { entityName: 123 }, { entityName: { toString: null } }, { component: "MissingComponent" }, { component: "" },
  { field: "missing" }, { field: "constructor" }, { field: "__proto__" }, { field: null },
  { equals: null }, { equals: {} }, { equals: [] }, { equals: undefined }, { equals: Infinity }, { equals: NaN },
])("invalid component proofs fail closed: %p", override => {
  const f = fixture({ ...proof, ...override });
  f.component.state[f.target] = "latched";
  expect(f.evaluate()).toBe(false);
});

test("proof requires own data fields and own current entity values, without invoking accessors", () => {
  const f = fixture();
  let getterCalls = 0;
  Object.defineProperty(f.component, "state", { configurable: true, get: () => { getterCalls++; return { [f.target]: "latched" }; } });
  expect(f.evaluate()).toBe(false);
  expect(getterCalls).toBe(0);
  Object.defineProperty(f.component, "state", { configurable: true, value: Object.create({ [f.target]: "latched" }) });
  expect(f.evaluate()).toBe(false);
  Object.defineProperty(f.component.state, String(f.target), { configurable: true, get: () => { getterCalls++; return "latched"; } });
  expect(f.evaluate()).toBe(false);
  expect(getterCalls).toBe(0);
});

test("component proofs compose and use the existing goal completion, event and learning pipeline", () => {
  const f = fixture({ type: "all_of", conditions: [proof, { ...proof, field: "enabled", equals: true }] });
  const events: { type: string; data: any }[] = [];
  const ctx = { query, getRelationTargets, emit: (type: string, data: any) => events.push({ type, data }), log: (_message: string) => {} };
  recordCompletedGoalAction(f.world, f.agent, { type: "observe", target: "Storm shutters" }, f.goal);
  recordCompletedGoalAction(f.world, f.agent, { type: "interact", target: "Storm shutters", content: "latch" }, f.goal);
  f.component.state[f.target] = "latched";
  goalEvaluationSystem(f.world, ctx);
  expect(Goal.status[f.goal]).toBe("active");
  expect(events).toHaveLength(0);
  f.component.enabled[f.target] = true;
  goalEvaluationSystem(f.world, ctx);
  expect(Goal.status[f.goal]).toBe("completed");
  expect(Goal.progress[f.goal]).toBe(100);
  expect(events).toEqual([{ type: "goal_completed", data: { agent: "Mara", goal: "Latch the storm shutters", reason: "all_of" } }]);
  expect(getAgentProceduralSkills(f.world, f.agent)).toHaveLength(1);
  goalEvaluationSystem(f.world, ctx);
  expect(events).toHaveLength(1);
  expect(getAgentProceduralSkills(f.world, f.agent)).toHaveLength(1);
});
