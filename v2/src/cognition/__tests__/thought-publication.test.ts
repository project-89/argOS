import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Thought, WorkingMemoryIdentity } from "../../ecs/components";
import { addThought } from "../agent-mind";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { captureThoughtPublication, takeNewAuthoredThoughtEvents } from "../thought-publication";

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(1000); });
afterEach(() => { jest.useRealTimers(); });
function fixture() {
  const world = createArgosWorld("Thought publication"); initializePrefabs(world);
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "fixture" });
  return { world, actor };
}
test("an action-only turn neither republishes nor redates an old thought", () => {
  const f = fixture(); addThought(f.world, f.actor, { type: "reasoning", content: "A real old thought." });
  const cursor = captureThoughtPublication(f.world, f.actor);
  jest.setSystemTime(5000);
  expect(takeNewAuthoredThoughtEvents(cursor)).toEqual([]);
  const next = captureThoughtPublication(f.world, f.actor);
  expect(takeNewAuthoredThoughtEvents(next)).toEqual([]);
});
test("new admitted thoughts keep their source timestamp and genuine repeated rumination is not text-deduplicated", () => {
  const f = fixture(), cursor = captureThoughtPublication(f.world, f.actor);
  addThought(f.world, f.actor, { type: "reasoning", content: "I still miss them." });
  addThought(f.world, f.actor, { type: "reasoning", content: "I still miss them." });
  jest.setSystemTime(9000);
  expect(takeNewAuthoredThoughtEvents(cursor)).toEqual([0, 1].map(() => ({ type: "agent:think", agentId: f.actor,
    agentName: "Ada", timestamp: 1000, thoughtType: "decision", thought: "I still miss them." })));
  expect(takeNewAuthoredThoughtEvents(cursor)).toEqual([]);
});
test("planted input, controller notes, blank content and editing an existing thought are not new authored events", () => {
  const f = fixture(), old = addThought(f.world, f.actor, { type: "reasoning", content: "Earlier." });
  const cursor = captureThoughtPublication(f.world, f.actor);
  Thought.content[old] = "Rewritten old row";
  for (const type of ["injected", "reflection", "planning"]) addThought(f.world, f.actor, { type, content: "Background note." });
  addThought(f.world, f.actor, { type: "reasoning", content: "   " });
  expect(takeNewAuthoredThoughtEvents(cursor)).toEqual([]);
});
test.each(["owner", "source", "stopped", "rewind"])("a cursor cannot publish across %s replacement", cause => {
  const f = fixture(); f.world.time.elapsed = 500;
  const cursor = captureThoughtPublication(f.world, f.actor);
  addThought(f.world, f.actor, { type: "reasoning", content: "New but no longer owned here." });
  if (cause === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (cause === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (cause === "stopped") stopCommittedEvents(f.world);
  if (cause === "rewind") f.world.time.elapsed = 0;
  expect(takeNewAuthoredThoughtEvents(cursor)).toEqual([]);
});
test("unnamed agents are harmless and capture never resurrects a stopped source", () => {
  const f = fixture(), unnamed = addEntity(f.world); addComponent(f.world, unnamed, Agent); Agent.active[unnamed] = true;
  expect(takeNewAuthoredThoughtEvents(captureThoughtPublication(f.world, unnamed))).toEqual([]);
  stopCommittedEvents(f.world); const before = getCommittedEvents(f.world);
  expect(takeNewAuthoredThoughtEvents(captureThoughtPublication(f.world, f.actor))).toEqual([]);
  expect(getCommittedEvents(f.world)).toEqual(before);
});
test("canceled work cannot capture, publish or consume a newly admitted thought", async () => {
  const f = fixture(), cursor = captureThoughtPublication(f.world, f.actor);
  addThought(f.world, f.actor, { type: "reasoning", content: "Still available to its live owner." });
  const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => captureThoughtPublication(f.world, -1)).toThrow();
    expect(() => takeNewAuthoredThoughtEvents(cursor)).toThrow();
  });
  expect(takeNewAuthoredThoughtEvents(cursor)).toHaveLength(1);
});
