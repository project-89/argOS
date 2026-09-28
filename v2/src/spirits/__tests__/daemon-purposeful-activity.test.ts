import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, Health, Mind, GridPosition } from "../../ecs/components";
import { addComponent, removeComponent } from "bitecs";
import { createPersonalIntention } from "../../cognition/goal-lifecycle";
import { collectAgentState, detectConcerns, detectGrowthOpportunities, createDaemonRegistry, createDaemonForAgent, observeAgent, runDaemonSystem, type AgentStateSnapshot } from "../agent-daemon";
import { NarratorDefinition } from "../narrator-spirit";
import { startCommittedEvents, publishCommittedEvent } from "../../runtime/committed-events";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";
const snapshot = (overrides: Partial<AgentStateSnapshot> = {}): AgentStateSnapshot => ({ timestamp: 1000,
  room: "Study", position: { x: 1, y: 1 }, arousal: 0.5, focus: "reading", mode: "reflective", active: true,
  health: 100, goalCount: 1, thoughtCount: 10, stuckTicks: 20, ...overrides });
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls in daemon policy tests")); drainPendingStimuli(); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });

test.each([0.1, 0.45, 0.55, 0.8])("stable purposeful activity at arousal %s does not demand novelty", arousal => {
  const current = snapshot({ arousal }), previous = snapshot({ arousal, timestamp: 0 });
  expect(detectConcerns(current, previous, "Mara").map(item => item.type)).not.toEqual(expect.arrayContaining(["stuck"]));
  expect(detectConcerns(current, previous, "Mara").map(item => item.type)).not.toContain("low_arousal");
  expect(detectGrowthOpportunities(current, previous, "Mara", 0)).toEqual([]);
});
test("having no explicit goal is not by itself a disorder to correct", () => {
  const current = snapshot({ goalCount: 0, focus: "resting", arousal: 0.1 });
  expect(detectConcerns(current, current, "Mara")).toEqual([]);
  expect(detectGrowthOpportunities(current, current, "Mara", 0)).toEqual([]);
});
test("genuine injury remains a concern", () => {
  expect(detectConcerns(snapshot({ health: 8 }), null, "Mara").map(item => item.type)).toContain("danger");
});
test("recovery can invite renewed engagement without inventing a new goal", () => {
  expect(detectGrowthOpportunities(snapshot(), snapshot({ health: 20 }), "Mara", 0).map(item => item.type)).toContain("ready_for_challenge");
});
test("snapshot counts active goals and ignores absent component storage", () => {
  const world = createArgosWorld("Purposeful observation"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Mara", role: "reader", systemPrompt: "I choose my work.", roomId: room });
  const goal = createPersonalIntention(world, actor, "Read the letter", 4)!; Goal.status[goal] = "completed";
  addComponent(world, actor, Health); Health.current[actor] = 5; removeComponent(world, actor, Health);
  addComponent(world, actor, GridPosition); GridPosition.x[actor] = 12; removeComponent(world, actor, GridPosition);
  const current = collectAgentState(world, actor)!;
  expect(current.goalCount).toBe(0); expect(current.health).toBeUndefined(); expect(current.position).toBeUndefined();
  expect(Mind.arousal[actor]).toBeDefined();
});
test("the actual narrator definition permits quiet and forbids invented revelations and dialogue", () => {
  expect(NarratorDefinition.systemPrompt).not.toMatch(/MAKE something happen|Have Hilda reveal|Something feels different today/);
  expect(NarratorDefinition.systemPrompt).toContain("No intervention is a valid choice");
  expect(NarratorDefinition.systemPrompt).toContain("Never invent dialogue");
});

function worldFixture() {
  const world = createArgosWorld("Purposeful observation"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Study" });
  const actor = createAgentEntity(world, { name: "Mara", role: "reader", systemPrompt: "I choose my work.", roomId: room });
  const peer = createAgentEntity(world, { name: "Sam", role: "reader", systemPrompt: "My own work.", roomId: room });
  addComponent(world, actor, Health); Health.current[actor] = 90; Mind.arousal[actor] = 0.5;
  const registry = createDaemonRegistry(0), daemon = createDaemonForAgent(registry, world, actor)!;
  const event = (executionId: string, status: "pending" | "succeeded" | "failed", actorId = actor) => publishCommittedEvent(world,
    { executionId, kind: "action", actorId, roomId: room, action: "interact", status });
  return { world, room, actor, peer, registry, daemon, event };
}

test("repeated executor failures warrant help, but pending or successful work clears that signal", () => {
  const f = worldFixture(); f.event("one", "failed"); f.event("two", "failed");
  let state = collectAgentState(f.world, f.actor)!;
  expect(state.recentAttempts?.consecutiveFailures).toBe(2);
  expect(detectConcerns(state, null, "Mara").map(item => item.type)).toContain("stuck");
  f.event("three", "pending"); state = collectAgentState(f.world, f.actor)!;
  expect(detectConcerns(state, null, "Mara").map(item => item.type)).not.toContain("stuck");
  f.event("three", "succeeded");
  expect(collectAgentState(f.world, f.actor)?.recentAttempts?.consecutiveFailures).toBe(0);
});

test("failure evidence is actor-owned, deduplicated, and bounded in simulation time", () => {
  const f = worldFixture(); f.event("peer-1", "failed", f.peer); f.event("peer-2", "failed", f.peer);
  expect(collectAgentState(f.world, f.actor)?.recentAttempts).toBeUndefined();
  f.event("one", "failed"); f.event("one", "failed");
  expect(collectAgentState(f.world, f.actor)?.recentAttempts?.consecutiveFailures).toBe(1);
  advanceSimulationTime(f.world, 1, 60_001);
  expect(collectAgentState(f.world, f.actor)?.recentAttempts).toBeUndefined();
});

test("native observation compares against the previous state and records real changes", () => {
  const f = worldFixture(); createPersonalIntention(f.world, f.actor, "Read the letter", 4);
  Health.current[f.actor] = 20; Mind.focus[f.actor] = "rest";
  const before = observeAgent(f.world, f.daemon)!;
  Health.current[f.actor] = 90; Mind.focus[f.actor] = "read";
  const after = observeAgent(f.world, f.daemon)!;
  expect(after.previousState).toBe(before.currentState);
  expect(after.growthOpportunities.map(item => item.type)).toContain("ready_for_challenge");
  expect(after.achievements).toContain("Recovered health");
  expect(f.daemon.lastAgentState).toBe(after.currentState);
});

test("native quiet observation does not emit an invented problem or demand a new goal", async () => {
  const f = worldFixture(); drainPendingStimuli();
  for (let i = 0; i < 5; i++) {
    advanceSimulationTime(f.world, f.world.time.tick + 1, 1000);
    const result = await runDaemonSystem(f.world, f.registry);
    expect(result.whispers).toBe(0); expect(result.challenges).toBe(0);
  }
  expect(drainPendingStimuli()).toEqual([]);
});
import { jest } from "@jest/globals";
