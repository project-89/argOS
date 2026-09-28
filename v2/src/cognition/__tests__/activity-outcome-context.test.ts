import { jest } from "@jest/globals";
import { addEntity, hasComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Agent, Goal, Needs, ObjectState, PhysicalObject, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { ObjectManager } from "../../world/object-manager";
import { executeActions } from "../cognition-system";
import { createPersonalIntention } from "../goal-lifecycle";
import { integrateActorContinuation } from "../actor-continuation";
import { snapshotOngoingActivity } from "../ongoing-activity";
import { getWorkingMemory, recordWorkingMemoryEvidence, formatWorkingMemoryContext, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryAction, captureWorkingMemoryObservation, recordWorkingMemoryAction } from "../working-memory-observation";
import { snapshotActivitySituation, activitySituationBasis } from "../activity-situation";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { recordCommittedSpeech } from "../social-memory";
import type { AgentAction } from "../agent-mind";

function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Act on evidence", roomId: room });
  const peer = createAgentEntity(world, { name: "Lin", role: "friend", systemPrompt: "PRIVATE_PEER", roomId: room });
  const valve = createObjectEntity(world, { name: "Valve", roomId: room }); ObjectState.current[valve] = "open";
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, peer);
  const goal = createPersonalIntention(world, actor, "Prepare the workshop for tomorrow", 7)!;
  const action: AgentAction = { type: "interact", target: "Valve", content: "close" };
  const choose = (purpose = "Close the valve before cleaning", type = "interact", goalId: number | undefined = goal) =>
    integrateActorContinuation(world, actor, { purpose, actionType: type, ...(type === "interact" ? { target: "Valve" } : {}),
      observedAtSimMs: world.time.elapsed, ...(goalId === undefined ? {} : { goalId, goalKey: WorkingMemoryIdentity.id[goalId] }) });
  choose(); captureWorkingMemoryObservation(world, actor);
  return { world, actor, peer, valve, goal, action, choose };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline activity evidence")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a failed physical operation retains its original purpose through overlapping speech", () => {
  const f = fixture(), activity = snapshotOngoingActivity(f.world, f.actor)!;
  const before = captureWorkingMemoryAction(f.world, f.actor, f.action);
  expect(snapshotActivitySituation(f.world, f.actor).physicalOutcomes).toEqual([]);
  advanceSimulationTime(f.world, 1, 2000); f.choose("Answer Lin's joke", "speak");
  recordWorkingMemoryAction(f.world, f.actor, f.action, false, { before, summary: "The valve jammed; the close operation failed." });
  const receipt = getWorkingMemory(f.world, f.actor).receipts.find(r => r.kind === "action")!;
  expect(receipt).toMatchObject({ succeeded: false, facts: [], completedAtSimMs: 2000,
    executionContext: { startedAtSimMs: 0, purpose: "Close the valve before cleaning",
      intention: { key: WorkingMemoryIdentity.id[f.goal], description: Goal.description[f.goal], activityId: activity.id } } });
  const situation = snapshotActivitySituation(f.world, f.actor);
  recordCommittedSpeech(f.world, f.actor, "It has been quite a day.", "Lin");
  recordWorkingMemoryAction(f.world, f.actor, { type: "speak", content: "It has been quite a day." }, true);
  expect(snapshotActivitySituation(f.world, f.actor)).toEqual(situation);
  expect(situation.physicalOutcomes[0]).toMatchObject({ succeeded: false, attemptedPurpose: "Close the valve before cleaning" });
  expect(formatWorkingMemoryContext(f.world, f.actor)).toContain("then serving:");
  expect(Goal.progress[f.goal]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  expect(getWorkingMemory(f.world, f.peer).receipts).toEqual([]);
});

test("original intention remains historical after replacement; completing a step does not credit the new goal", () => {
  const f = fixture(), before = captureWorkingMemoryAction(f.world, f.actor, f.action);
  const original = Goal.description[f.goal]; Goal.description[f.goal] = "PRIVATE_NEW_INTENTION";
  ObjectState.current[f.valve] = "closed";
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  const own = snapshotActivitySituation(f.world, f.actor), peer = JSON.stringify(getWorkingMemory(f.world, f.peer));
  expect(own.physicalOutcomes[0].historicalIntention?.description).toBe(original);
  expect(own.organizingActivity?.needsRevalidation).toBe(true);
  expect(peer).toContain("closed"); expect(peer).not.toContain(original); expect(peer).not.toContain("PRIVATE_");
  expect(peer).not.toContain("executionContext"); expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["copy", "source", "persona", "capability", "owner", "command", "rewind"])("%s cannot reuse an old purpose binding", change => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 1000);
  let before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  if (change === "copy") before = structuredClone(before);
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "persona") Agent.systemPrompt[f.actor] = "Someone else";
  if (change === "capability") registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  if (change === "command") f.action.content = "open";
  if (change === "rewind") f.world.time.elapsed = 0;
  recordWorkingMemoryAction(f.world, f.actor, f.action, false, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)?.executionContext).toBeUndefined();
});

test("a copied or unrelated continuation is not retrospective action attribution", () => {
  const f = fixture(); f.choose("Enjoy Lin's company", "wait");
  const before = captureWorkingMemoryAction(f.world, f.actor, f.action);
  recordWorkingMemoryAction(f.world, f.actor, f.action, false, { before });
  expect(snapshotActivitySituation(f.world, f.actor).physicalOutcomes[0].attemptedPurpose).toBeUndefined();
});

test("read-only situation preserves ECS receipt data across serialization without restoring executor authority", () => {
  const f = fixture(), before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  recordWorkingMemoryAction(f.world, f.actor, f.action, false, { before });
  const serialized = WorkingMemory.receiptsJson[f.actor], first = snapshotActivitySituation(f.world, f.actor);
  const copy = getWorkingMemory(f.world, f.actor); copy.receipts.at(-1)!.executionContext!.purpose = "MUTATED";
  expect(WorkingMemory.receiptsJson[f.actor]).toBe(serialized);
  for (let i = 0; i < 4; i++) expect(snapshotActivitySituation(f.world, f.actor)).toEqual(first);
  expect(WorkingMemory.receiptsJson[f.actor]).toBe(serialized);
  recordWorkingMemoryAction(f.world, f.actor, f.action, false, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action").at(-1)?.executionContext).toBeUndefined();
});

test("context metadata is private, validated and copied; invalid metadata cannot add a physical fact", () => {
  const f = fixture(); const input = { id: "own:test", kind: "action" as const, provenance: "own_action" as const,
    atMs: Date.now() + 10, summary: "Failed to close.", succeeded: false, facts: [], completedAtSimMs: 1,
    executionContext: { startedAtSimMs: 0, purpose: "PRIVATE_REASON", intention: { key: "old:goal", description: "PRIVATE_INTENTION" } } };
  for (const invalid of [{ ...input, provenance: "witnessed_action" }, { ...input, completedAtSimMs: -1 },
    { ...input, executionContext: { ...input.executionContext, startedAtSimMs: 2 } },
    { ...input, executionContext: { ...input.executionContext, purpose: 42 } }])
    expect(recordWorkingMemoryEvidence(f.world, f.actor, invalid as any)).toBe(false);
  expect(recordWorkingMemoryEvidence(f.world, f.actor, input)).toBe(true);
  input.executionContext.intention.description = "CHANGED";
  expect(getWorkingMemory(f.world, f.actor).receipts.at(-1)?.executionContext?.intention?.description).toBe("PRIVATE_INTENTION");
  expect(getWorkingMemory(f.world, f.peer).receipts).toEqual([]);
});

test("ordinary observation refresh is not a changed physical situation; actually observed state is", () => {
  const f = fixture(), old = activitySituationBasis(snapshotActivitySituation(f.world, f.actor));
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(activitySituationBasis(snapshotActivitySituation(f.world, f.actor))).toBe(old);
  ObjectState.current[f.valve] = "jammed";
  expect(activitySituationBasis(snapshotActivitySituation(f.world, f.actor))).toBe(old); // No omniscient lookup.
  captureWorkingMemoryObservation(f.world, f.actor);
  expect(activitySituationBasis(snapshotActivitySituation(f.world, f.actor))).not.toBe(old);
});

test("native consumption retains exact historical target/purpose without treating its recycled slot as a live object", () => {
  const f = fixture(); f.world.meta.aiEnabled = false; f.world.meta.timedActions = true;
  const food = new ObjectManager(f.world).spawn("food_item", { name: "Apple pastry", containedIn: f.actor })!;
  const action: AgentAction = { type: "interact", target: "Apple pastry", content: "eat" };
  integrateActorContinuation(f.world, f.actor, { purpose: "Eat my pastry before cleaning", actionType: "interact", target: "Apple pastry",
    observedAtSimMs: 0, goalId: f.goal, goalKey: WorkingMemoryIdentity.id[f.goal] });
  Needs.hunger[f.actor] = 70;
  executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
  const pending = getCommittedEvents(f.world).events.find(event => event.operation === "eating" && event.status === "pending")!;
  expect(pending?.targetId).toBe(food);
  advanceSimulationTimeline(f.world, 1000, { integrate: () => {} });
  expect(hasComponent(f.world, food, PhysicalObject)).toBe(false);
  expect(Needs.hunger[f.actor]).toBeLessThan(70);
  const receipt = getWorkingMemory(f.world, f.actor).receipts.find(row => row.action?.content === "eat")!;
  expect(receipt).toMatchObject({ succeeded: true, completedAtSimMs: 1000,
    action: { type: "interact", targetKey: pending.targetKey, content: "eat" },
    executionContext: { purpose: "Eat my pastry before cleaning", intention: { key: WorkingMemoryIdentity.id[f.goal] } } });
  expect(receipt.facts).not.toContainEqual(expect.objectContaining({ subject: pending.targetKey, slot: "ObjectState.current", value: "fresh" }));
  expect(getWorkingMemory(f.world, f.peer).receipts.every(row => !row.action && !row.executionContext)).toBe(true);
});

test.each(["copy", "source", "persona", "capability", "owner", "command", "rewind", "unbound"])("a removed target cannot gain historical identity from %s work", change => {
  const f = fixture(); advanceSimulationTime(f.world, 1, 1000);
  if (change === "unbound") f.choose("Listen instead", "wait");
  let before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  removeEntity(f.world, f.valve); addEntity(f.world); // Recycling the numeric slot cannot authenticate its old arrays.
  if (change === "copy") before = structuredClone(before);
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "persona") Agent.systemPrompt[f.actor] = "A new person";
  if (change === "capability") registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false });
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "new-owner";
  if (change === "command") f.action.content = "open";
  if (change === "rewind") f.world.time.elapsed = 0;
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  const receipt = getWorkingMemory(f.world, f.actor).receipts.filter(row => row.kind === "action").at(-1)!;
  expect(receipt?.action).toBeUndefined(); expect(receipt?.executionContext).toBeUndefined();
});

test("historical identity is immutable, one-use, and never substituted by a same-name replacement", () => {
  const f = fixture(), before = captureWorkingMemoryAction(f.world, f.actor, f.action)!;
  const old = before.entities.find(item => item.eid === f.valve)!.ref.key;
  expect(() => { before.entities[0].ref.key = "forged"; }).toThrow();
  removeEntity(f.world, f.valve);
  const replacement = createObjectEntity(f.world, { name: "Valve", roomId: before.room });
  const fresh = workingMemoryEntityRef(f.world, replacement)!.key;
  expect(fresh).not.toBe(old);
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  const receipt = getWorkingMemory(f.world, f.actor).receipts.filter(row => row.kind === "action").at(-1)!;
  expect(receipt.action?.targetKey).toBe(old); expect(receipt.facts).toEqual([]);
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(row => row.kind === "action").at(-1)?.action).toBeUndefined();
});

test("cancellation of the issuing task revokes historical target attribution", async () => {
  const f = fixture(), controller = new AbortController();
  const before = await withSimulationTask(controller.signal, async () => captureWorkingMemoryAction(f.world, f.actor, f.action));
  removeEntity(f.world, f.valve); controller.abort();
  recordWorkingMemoryAction(f.world, f.actor, f.action, true, { before });
  const receipt = getWorkingMemory(f.world, f.actor).receipts.filter(row => row.kind === "action").at(-1)!;
  expect(receipt.action).toBeUndefined(); expect(receipt.executionContext).toBeUndefined();
});
