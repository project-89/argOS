import { jest } from "@jest/globals";
import { addEntity, addComponent, hasComponent, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { Goal, Memory, SimulationAge } from "../../ecs/components";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { stampGoalTiming, stampSimulationTime, simulationAge, simulationDeadlinePassed, getStampedSimulationTime } from "../../ecs/temporal-age";
import { serializeWorld, deserializeWorld } from "../world-persistence";

afterEach(() => jest.useRealTimers());

test("source timestamps remain exact while lived goal age and deadlines advance under acceleration, not wall jumps", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const world = createArgosWorld(), goal = addEntity(world);
  addComponent(world, goal, Goal);
  Goal.createdAt[goal] = Date.now(); Goal.deadline[goal] = Date.now() + 60_000;
  stampGoalTiming(world, goal);
  jest.setSystemTime(Date.now() + 86_400_000);
  expect(simulationAge(world, goal, "Goal.createdAt", Goal.createdAt[goal])).toBe(0);
  expect(simulationDeadlinePassed(world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(false);
  advanceSimulationTime(world, 1, 59_999);
  expect(simulationDeadlinePassed(world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(false);
  jest.setSystemTime(1_700_000_000_000);
  advanceSimulationTime(world, 2, 1);
  expect(simulationDeadlinePassed(world, goal, "Goal.deadline", Goal.deadline[goal])).toBe(true);
  expect(Goal.createdAt[goal]).toBe(1_800_000_000_000);
});

test("age reads are pure and exact source matching refuses a replacement episode's old stamp", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const world = createArgosWorld(), eid = addEntity(world), at = Date.now();
  expect(simulationAge(world, eid, "source", at)).toBe(0);
  expect(hasComponent(world, eid, SimulationAge)).toBe(false);
  advanceSimulationTime(world, 1, 1000);
  stampSimulationTime(world, eid, "source", at);
  const before = SimulationAge.marksJson[eid];
  expect(getStampedSimulationTime(world, eid, "source", at + 1)).toBeUndefined();
  simulationAge(world, eid, "source", at);
  expect(SimulationAge.marksJson[eid]).toBe(before);
  removeComponent(world, eid, SimulationAge);
  expect(getStampedSimulationTime(world, eid, "source", at)).toBeUndefined();
  stampSimulationTime(world, eid, "replacement", at + 1);
  expect(getStampedSimulationTime(world, eid, "source", at)).toBeUndefined();
});

test("explicit age, future deadline and finite action modes survive remapped save/restore and an offline interval", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const source = createArgosWorld(), eid = addEntity(source);
  source.meta.timedSpeech = true; source.meta.timedActions = true;
  addComponent(source, eid, Goal);
  Goal.createdAt[eid] = Date.now(); Goal.deadline[eid] = Date.now() + 60_000;
  stampGoalTiming(source, eid);
  advanceSimulationTime(source, 1, 10_000);
  const saved = JSON.parse(JSON.stringify(serializeWorld(source, createSystemRegistry())));
  jest.setSystemTime(Date.now() + 30 * 86_400_000);
  const restored = createArgosWorld(); addEntity(restored);
  const target = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId.get(eid)!;
  expect(restored.meta.timedSpeech).toBe(true); expect(restored.meta.timedActions).toBe(true);
  expect(restored.time.delta).toBe(0);
  expect(simulationAge(restored, target, "Goal.createdAt", Goal.createdAt[target])).toBe(10_000);
  expect(simulationDeadlinePassed(restored, target, "Goal.deadline", Goal.deadline[target])).toBe(false);
  advanceSimulationTime(restored, 2, 50_000);
  expect(simulationDeadlinePassed(restored, target, "Goal.deadline", Goal.deadline[target])).toBe(true);
});

test.each([false, undefined])("saved finite-action option %s preserves explicit compatibility", value => {
  const source = createArgosWorld(); source.meta.timedSpeech = value; source.meta.timedActions = value;
  const saved = JSON.parse(JSON.stringify(serializeWorld(source, createSystemRegistry())));
  const restored = createArgosWorld();
  deserializeWorld(restored, createSystemRegistry(), saved);
  expect(restored.meta.timedSpeech).toBe(value); expect(restored.meta.timedActions).toBe(value);
});

test("legacy snapshots preserve their age at save rather than counting the offline interval", () => {
  jest.useFakeTimers().setSystemTime(1_800_000_000_000);
  const source = createArgosWorld(), eid = addEntity(source); addComponent(source, eid, Memory);
  Memory.type[eid] = "episodic"; Memory.content[eid] = "A real old source";
  Memory.timestamp[eid] = Date.now() - 30_000;
  advanceSimulationTime(source, 1, 500_000);
  const saved = serializeWorld(source, createSystemRegistry()); delete saved.temporalBaseline;
  jest.setSystemTime(Date.now() + 10 * 86_400_000);
  const restored = createArgosWorld();
  const target = deserializeWorld(restored, createSystemRegistry(), saved).oldToNewId.get(eid)!;
  expect(simulationAge(restored, target, "Memory.timestamp", Memory.timestamp[target])).toBe(30_000);
  advanceSimulationTime(restored, 2, 15_000);
  expect(simulationAge(restored, target, "Memory.timestamp", Memory.timestamp[target])).toBe(45_000);
  const again = createArgosWorld();
  const targetAgain = deserializeWorld(again, createSystemRegistry(), serializeWorld(restored, createSystemRegistry())).oldToNewId.get(target)!;
  expect(simulationAge(again, targetAgain, "Memory.timestamp", Memory.timestamp[targetAgain])).toBe(45_000);
});
