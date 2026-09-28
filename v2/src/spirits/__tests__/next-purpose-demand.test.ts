import { jest } from "@jest/globals";
import { removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Agent, CognitiveControl, Goal, GoalLifecycle, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { createIntentGoal } from "../../cognition/cognition-system";
import { integrateActorContinuation, prepareNextPurposeUpdate, reconsiderNextPurposeAfterWait,
  settleNextPurpose, snapshotActorContinuation } from "../../cognition/actor-continuation";
import { captureCoordinationGoal } from "../../cognition/coordination-memory";
import { registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { withSimulationTask } from "../../runtime/task-scope";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { getCommittedEvents, startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { captureActorIntentionEvidence } from "../actor-intention-evidence";

beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(Error("Demand tests stay offline")); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

function fixture() {
  const world = createArgosWorld("A chosen outing"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Courtyard" });
  const actor = createAgentEntity(world, { name: "Ada", roomId: room, role: "visitor", systemPrompt: "PRIVATE_BACKSTORY" });
  const goal = createIntentGoal(world, actor, "Visit the observatory and use a telescope", 7);
  captureCoordinationGoal(world, actor, goal);
  const selection = { requestId: "PRIVATE_REQUEST", actionType: "wait", listedGoals: new Set([goal]) };
  const prepared = prepareNextPurposeUpdate(world, actor, { goalId: goal, purpose: "Visit the observatory after this brief wait" }, undefined, selection)!;
  expect(prepared.current()).toBe(true);
  integrateActorContinuation(world, actor, { purpose: "Wait for a moment", actionType: "wait", observedAtSimMs: 0,
    requestId: selection.requestId, nextPurpose: prepared.value });
  const observation = captureActorIntentionEvidence(world);
  const record = observation.records.find(row => row.kind === "next_purpose")!;
  return { world, actor, goal, selection, observation, record };
}

test("an explicit later purpose stays current through native wait acknowledgement, side thoughts and reconsideration", () => {
  const f = fixture();
  expect(f.record).toMatchObject({ kind: "next_purpose", description: "Visit the observatory after this brief wait",
    goalKey: WorkingMemoryIdentity.id[f.goal], status: "after_step" });
  expect(f.observation.bind([f.record.ref])?.()).toBe(true);
  const serialized = CognitiveControl.stateJson[f.actor];
  expect(captureActorIntentionEvidence(f.world).records.find(row => row.kind === "next_purpose")?.causalKey).toBe(f.record.causalKey);
  expect(CognitiveControl.stateJson[f.actor]).toBe(serialized);
  settleNextPurpose(f.world, f.actor, { type: "wait", foregroundDecisionId: f.selection.requestId }, { succeeded: true, pending: false });
  integrateActorContinuation(f.world, f.actor, { purpose: "An unrelated private thought", actionType: "think", observedAtSimMs: 0 });
  advanceSimulationTime(f.world, 1, 1000);
  reconsiderNextPurposeAfterWait(f.world, f.actor);
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.status).toBe("ready");
  expect(f.observation.bind([f.record.ref])?.()).toBe(true);
  expect(f.observation.resolveActor(f.record.ref)?.eid).toBe(f.actor);
  expect(captureActorIntentionEvidence(f.world).records.find(row => row.kind === "next_purpose")?.causalKey).toBe(f.record.causalKey);
  expect(JSON.stringify(f.record)).not.toMatch(/PRIVATE_|goalBasis|afterRequestId|innerThought/);
  expect(getCommittedEvents(f.world).events).toEqual([]); expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["cancel", "take"])("%s retires the precise later-choice citation without erasing its still-current goal", disposition => {
  const f = fixture(), goalRecord = f.observation.records.find(row => row.kind === "goal")!;
  expect(f.record).toBeDefined();
  settleNextPurpose(f.world, f.actor, { type: "wait", foregroundDecisionId: f.selection.requestId }, { succeeded: true, pending: false });
  reconsiderNextPurposeAfterWait(f.world, f.actor);
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const update = prepareNextPurposeUpdate(f.world, f.actor, undefined, { id: next.id, disposition, reason: "My own new choice" },
    { ...f.selection, actionType: "observe", ...(disposition === "take" ? { goalId: f.goal } : {}) })!;
  expect(update.current()).toBe(true);
  integrateActorContinuation(f.world, f.actor, { purpose: disposition === "take" ? "Look for the observatory route" : "Stay here instead",
    actionType: "observe", observedAtSimMs: 0, nextPurpose: update.value,
    ...(disposition === "take" ? { goalId: f.goal, goalKey: WorkingMemoryIdentity.id[f.goal] } : {}) });
  expect(f.observation.bind([f.record.ref])?.()).toBe(false);
  expect(f.observation.resolveActor(f.record.ref)).toBeUndefined();
  expect(f.observation.bind([goalRecord.ref])?.()).toBe(true);
  const fresh = captureActorIntentionEvidence(f.world);
  expect(fresh.records.some(row => row.kind === "next_purpose")).toBe(false);
  if (disposition === "take") expect(fresh.records.find(row => row.kind === "selected_purpose")?.goalKey).toBe(goalRecord.goalKey);
});

test.each(["completed", "retired", "definition", "review", "unowned", "actor", "persona", "source", "package", "edit"])(
  "%s invalidates prior chosen-purpose evidence", change => {
    const f = fixture(); expect(f.record).toBeDefined();
    if (change === "completed" || change === "retired") Goal.status[f.goal] = change;
    if (change === "definition") Goal.description[f.goal] = "Stay in the courtyard instead";
    if (change === "review") GoalLifecycle.reviewRevision[f.goal] = (GoalLifecycle.reviewRevision[f.goal] || 0) + 1;
    if (change === "unowned") removeComponent(f.world, f.actor, HasGoal(f.goal));
    if (change === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement";
    if (change === "persona") Agent.systemPrompt[f.actor] = "A different persona";
    if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    if (change === "package") registerAgentWorldCapabilities(f.world, f.actor,
      { context: () => "", ready: () => true, busy: () => false, execute: () => false });
    if (change === "edit") CognitiveControl.stateJson[f.actor] = CognitiveControl.stateJson[f.actor].replace("observatory", "harbor");
    expect(f.observation.bind([f.record.ref])?.()).toBe(false);
    expect(f.observation.resolveActor(f.record.ref)).toBeUndefined();
    if (change !== "review") expect(captureActorIntentionEvidence(f.world).records.some(row => row.kind === "next_purpose")).toBe(false);
  }
);

test("a cancelled task cannot keep its author citation current", async () => {
  const controller = new AbortController();
  const f = await withSimulationTask(controller.signal, async () => fixture());
  expect(f.record).toBeDefined(); controller.abort();
  expect(f.observation.bind([f.record.ref])?.()).toBe(false);
  expect(f.observation.resolveActor(f.record.ref)).toBeUndefined();
});

test("choosing identical words again is a new episode, not revival of revoked demand", () => {
  const f = fixture(); expect(f.record).toBeDefined();
  const old = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const cancel = prepareNextPurposeUpdate(f.world, f.actor, undefined, { id: old.id, disposition: "cancel", reason: "Not now" }, f.selection)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Stay here", actionType: "wait", observedAtSimMs: 0, nextPurpose: cancel.value });
  expect(f.observation.bind([f.record.ref])?.()).toBe(false);
  const replacement = prepareNextPurposeUpdate(f.world, f.actor, { goalId: f.goal, purpose: old.purpose }, undefined, f.selection)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Wait a moment", actionType: "wait", observedAtSimMs: 0, nextPurpose: replacement.value });
  const fresh = captureActorIntentionEvidence(f.world).records.find(row => row.kind === "next_purpose")!;
  expect(fresh.causalKey).not.toBe(f.record.causalKey);
  expect(f.observation.bind([f.record.ref])?.()).toBe(false);
});

test("workshop prose with no owned later choice remains transient, matching the failed live case", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Wrap up my lunch break and prepare to head back to the bike shop",
    actionType: "think", observedAtSimMs: 0, nextPurpose: null });
  const before = captureActorIntentionEvidence(f.world), selected = before.records.find(row => row.kind === "selected_purpose")!;
  expect(before.records.some(row => row.kind === "next_purpose")).toBe(false);
  integrateActorContinuation(f.world, f.actor, { purpose: "Wait briefly before heading back to the workshop", actionType: "wait", observedAtSimMs: 0 });
  expect(before.bind([selected.ref])?.()).toBe(false);
  expect(captureActorIntentionEvidence(f.world).records.some(row => row.kind === "next_purpose")).toBe(false);
});
