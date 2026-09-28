import { jest } from "@jest/globals";
import { addEntity, addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { Name } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { bindDaemonToWorld, createDaemonForAgent, createDaemonRegistry, updateGrowthMetrics, generateGrowthSuggestion,
  startNarrativeArc, checkArcStagnation, progressNarrativeArc, type AgentStateSnapshot } from "../agent-daemon";

beforeEach(() => jest.useFakeTimers().setSystemTime(1_800_000_000_000));
afterEach(() => jest.useRealTimers());
function fixture() {
  const world = createArgosWorld(), eid = addEntity(world); addComponent(world, eid, Name); Name.value[eid] = "Mara";
  const daemon = createDaemonForAgent(createDaemonRegistry(), world, eid)!;
  const state: AgentStateSnapshot = { timestamp: Date.now(), arousal: 0.5, focus: "lamp", mode: "active", active: true,
    goalCount: 1, thoughtCount: 1, stuckTicks: 0, room: "Study" };
  return { world, daemon, state };
}

test("world-bound growth suggestions and stagnation use lived age, not wall/model latency", () => {
  const { world, daemon, state } = fixture();
  jest.setSystemTime(Date.now() + 86_400_000);
  updateGrowthMetrics(daemon, state, state);
  expect(daemon.growthMetrics.stagnationScore).toBe(0);
  expect(generateGrowthSuggestion(daemon)).not.toContain("active goal count has not changed");
  advanceSimulationTime(world, 1, 600_000); updateGrowthMetrics(daemon, state, state);
  expect(generateGrowthSuggestion(daemon)).toContain("active goal count has not changed");
  expect(daemon.growthMetrics.stagnationScore).toBe(0);
  const historical = daemon.growthMetrics.lastGoalChange;
  const restored = structuredClone(daemon); bindDaemonToWorld(restored, world);
  expect(generateGrowthSuggestion(restored)).toEqual(generateGrowthSuggestion(daemon));
  updateGrowthMetrics(daemon, { ...state, goalCount: 2 }, state);
  expect(generateGrowthSuggestion(daemon)).not.toContain("active goal count has not changed");
  expect(daemon.growthMetrics.lastGoalChange).not.toBe(historical);
});

test("arc review age counts lived time but never diagnoses blockage from time alone", () => {
  const { world, daemon } = fixture();
  startNarrativeArc(daemon, "escape", "Find the key", "Leave safely", { toGain: "freedom", toLose: "time" });
  for (let n = 0; n < 50; n++) expect(checkArcStagnation(daemon)).toBe(false);
  advanceSimulationTime(world, 1, 99_999); expect(checkArcStagnation(daemon)).toBe(false);
  advanceSimulationTime(world, 2, 1); expect(checkArcStagnation(daemon)).toBe(false);
  expect(daemon.narrativeArc.ticksSinceProgress).toBe(10);
  progressNarrativeArc(daemon, "The key was found.");
  expect(checkArcStagnation(daemon)).toBe(false);
  expect(daemon.narrativeArc.ticksSinceProgress).toBe(0);
});
