import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Health, Mind } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { createPersonalIntention } from "../../cognition/goal-lifecycle";
import { startCommittedEvents, publishCommittedEvent, stopCommittedEvents } from "../../runtime/committed-events";
import { createDaemonRegistry, createDaemonForAgent, observeAgent, startNarrativeArc,
  generateGrowthSuggestion, getStagnatingCharacters, attemptSelfResolution, checkArcStagnation } from "../agent-daemon";
import { getWorldSummary, getSteeringRecommendations, runObservation } from "../../god/monitoring-system";
import type { EntityRegistry } from "../../ecs/tools";

beforeEach(() => jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No provider calls in pressure regressions")));
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Quiet work"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Mara", role: "reader", systemPrompt: "Choose my work.", roomId: room });
  addComponent(world, actor, Health); Health.current[actor] = 90;
  Mind.arousal[actor] = 0.1; Mind.focus[actor] = "reading"; Mind.mode[actor] = "waiting";
  createPersonalIntention(world, actor, "Read the book", 4);
  const registry = createDaemonRegistry(), daemon = createDaemonForAgent(registry, world, actor)!;
  startNarrativeArc(daemon, "reading", "Begin reading", "Read the book", { toGain: "understanding", toLose: "time" });
  const summary = () => getWorldSummary(world, {} as EntityRegistry);
  const event = (id: string, status: "failed" | "succeeded" | "pending") => publishCommittedEvent(world,
    { executionId: id, kind: "action", actorId: actor, roomId: room, action: "interact", status });
  return { world, actor, registry, daemon, summary, event };
}

test("native observations past an arc deadline do not invent nudges or abandon an intention", () => {
  const f = fixture(); observeAgent(f.world, f.daemon);
  for (let n = 0; n < 6; n++) {
    advanceSimulationTime(f.world, f.world.time.tick + 1, 120_000);
    observeAgent(f.world, f.daemon);
  }
  expect(f.daemon.pendingNudges).toEqual([]);
  expect(f.daemon.narrativeArc.status).toBe("setup");
  expect(f.daemon.narrativeArc.selfResolutionAttempts).toBe(0);
  expect(f.daemon.narrativeArc.previousArcs).toEqual([]);
});

test("long stable work is not diagnosed as missing belief or relationship growth", () => {
  const f = fixture(); observeAgent(f.world, f.daemon);
  advanceSimulationTime(f.world, 1, 12 * 60 * 60 * 1000); observeAgent(f.world, f.daemon);
  expect(f.daemon.growthMetrics.stagnationScore).toBe(0);
  expect(getStagnatingCharacters(f.registry)).toEqual([]);
  expect(generateGrowthSuggestion(f.daemon)).not.toMatch(/needs new|needs interaction|thinking is stagnant|growing well/);
});

test("God monitoring leaves quiet low-arousal work alone", () => {
  const f = fixture(), summary = f.summary();
  expect(summary.stagnationScore).toBe(0);
  expect(getSteeringRecommendations(summary)).toEqual([]);
});

test("no actors and no events is not proof of blocked cognition", () => {
  const world = createArgosWorld("Empty world");
  const summary = getWorldSummary(world, {} as EntityRegistry);
  expect(summary.stagnationScore).toBe(0);
  expect(getSteeringRecommendations(summary)).toEqual([]);
});

test("real failed attempts warrant specific help and success clears the signal", () => {
  const f = fixture(); f.event("one", "failed"); f.event("two", "failed");
  const summary = f.summary(), suggestions = getSteeringRecommendations(summary);
  expect(summary.stagnationScore).toBeGreaterThan(0);
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0].description).toContain("Mara");
  expect(suggestions[0].description).toContain("failed");
  expect(suggestions[0].suggestedAction).not.toMatch(/crisis|conflicting goals|Raise stakes/);
  f.event("three", "succeeded");
  expect(getSteeringRecommendations(f.summary())).toEqual([]);
});

test("a pending action or expired failure is not an ongoing blockage", () => {
  const f = fixture(); f.event("one", "failed"); f.event("two", "failed"); f.event("three", "pending");
  expect(getSteeringRecommendations(f.summary())).toEqual([]);
  f.event("three", "failed"); advanceSimulationTime(f.world, 1, 60_001);
  expect(getSteeringRecommendations(f.summary())).toEqual([]);
});

test("explicit repeated reviews never choose an ending and recheck live evidence", () => {
  const f = fixture();
  advanceSimulationTime(f.world, 1, 120_000); f.event("one", "failed"); f.event("two", "failed");
  expect(checkArcStagnation(f.daemon)).toBe(true);
  for (let n = 0; n < 5; n++) expect(attemptSelfResolution(f.daemon)?.type).toBe("reflect");
  expect(f.daemon.narrativeArc.status).toBe("setup");
  expect(f.daemon.narrativeArc.previousArcs).toEqual([]);
  f.event("three", "succeeded");
  expect(attemptSelfResolution(f.daemon)).toBeNull();
  expect(f.daemon.narrativeArc.needsSelfResolution).toBe(false);
});

test("failure evidence does not leak across actors, stopped sources or source replacement", () => {
  const f = fixture(); f.event("one", "failed"); f.event("two", "failed");
  const room = createRoomEntity(f.world, { name: "Other room" });
  const peer = createAgentEntity(f.world, { name: "Sam", role: "reader", systemPrompt: "My own work.", roomId: room });
  expect(f.summary().agentSummaries.find(actor => actor.eid === peer)?.recentAttempts).toBeUndefined();
  expect(getSteeringRecommendations(f.summary())).toHaveLength(1);
  stopCommittedEvents(f.world);
  expect(getSteeringRecommendations(f.summary())).toEqual([]);
  startCommittedEvents(f.world);
  expect(getSteeringRecommendations(f.summary())).toEqual([]);
});

test("native God observation reviews one failing actor without treating other quiet actors as failures", () => {
  const f = fixture();
  for (const name of ["Sam", "Ivo", "Sera"]) createAgentEntity(f.world, { name, role: "reader", systemPrompt: "Read.", roomId: createRoomEntity(f.world, { name: `${name}'s room` }) });
  const state = { lastObservation: 0, recentEvents: [], observationCount: 0 };
  expect(runObservation(f.world, {} as EntityRegistry, state, 0).shouldIntervene).toBe(false);
  f.event("one", "failed"); f.event("two", "failed");
  const observed = runObservation(f.world, {} as EntityRegistry, state, 0);
  expect(observed.summary.stagnationScore).toBe(0.25);
  expect(observed.shouldIntervene).toBe(true);
  expect(observed.recommendations).toHaveLength(1);
});
