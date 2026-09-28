import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { createIntentGoal } from "../cognition-system";
import { captureCoordinationGoal } from "../coordination-memory";
import { CognitiveControl, Goal } from "../../ecs/components";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { withSimulationTask } from "../../runtime/task-scope";
import { prepareNextPurposeUpdate, integrateActorContinuation, snapshotActorContinuation, settleNextPurpose,
  hasNextPurposeReview, formatNextPurpose, updateActorContinuation } from "../actor-continuation";

function fixture() {
  const world = createArgosWorld("Next purpose"); initializePrefabs(world); world.meta.aiEnabled = false;
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose freely", roomId: room });
  const other = createAgentEntity(world, { name: "Bo", role: "resident", systemPrompt: "Choose freely", roomId: room });
  startCommittedEvents(world);
  const goal = createIntentGoal(world, actor, "Check the notification", 9); captureCoordinationGoal(world, actor, goal);
  const selection = { requestId: "foreground:chosen-step", actionType: "speak", goalId: null, listedGoals: new Set([goal]) };
  const prepare = () => prepareNextPurposeUpdate(world, actor, { goalId: goal, purpose: "Check what arrived" }, undefined, selection)!;
  const choose = () => { const p = prepare(); expect(p.current()).toBe(true);
    integrateActorContinuation(world, actor, { purpose: "Finish my sentence", actionType: "speak", observedAtSimMs: 0,
      requestId: selection.requestId, nextPurpose: p.value }); };
  const complete = (success = true) => settleNextPurpose(world, actor, { type: "speak", foregroundDecisionId: selection.requestId }, { succeeded: success, pending: false });
  return { world, actor, other, goal, selection, prepare, choose, complete };
}
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline only")); });
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });

test("a typed next purpose survives side thoughts, but pending/foreign outcomes do not settle it", () => {
  const f = fixture(); f.choose(); const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  integrateActorContinuation(f.world, f.actor, { purpose: "An intervening thought", actionType: "think", observedAtSimMs: 0 });
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toEqual(next);
  for (const action of [{ type: "speak", foregroundDecisionId: "different" }, { type: "move", foregroundDecisionId: f.selection.requestId }]) {
    settleNextPurpose(f.world, f.actor, action, { succeeded: true, pending: false });
    expect(hasNextPurposeReview(f.world, f.actor)).toBe(false);
  }
  settleNextPurpose(f.world, f.actor, { type: "speak", foregroundDecisionId: f.selection.requestId }, { succeeded: true, pending: true });
  settleNextPurpose(f.world, f.other, { type: "speak", foregroundDecisionId: f.selection.requestId }, { succeeded: true, pending: false });
  expect(hasNextPurposeReview(f.world, f.actor)).toBe(false);
  f.complete(); expect(hasNextPurposeReview(f.world, f.actor)).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  const before = CognitiveControl.stateJson[f.actor]; formatNextPurpose(f.world, f.actor); f.complete(false);
  expect(CognitiveControl.stateJson[f.actor]).toBe(before); // Read-only projection and duplicate result.
});

test.each([true, false])("ended step (success=%s) requests explicit take/cancel; it never chooses an action", success => {
  const f = fixture(); f.choose();
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const take = { id: next.id, disposition: "take", reason: "Now I want to check" };
  expect(prepareNextPurposeUpdate(f.world, f.actor, undefined, take, { ...f.selection, goalId: f.goal })).toBeUndefined();
  f.complete(success);
  expect(prepareNextPurposeUpdate(f.world, f.actor, undefined, undefined, f.selection)).toBeUndefined();
  expect(prepareNextPurposeUpdate(f.world, f.actor, undefined, take, f.selection)).toBeUndefined();
  const choice = prepareNextPurposeUpdate(f.world, f.actor, undefined, take, { ...f.selection, goalId: f.goal })!;
  expect(choice.current()).toBe(true); expect(choice.value).toBeNull();
  expect(snapshotActorContinuation(f.world, f.actor)?.actionType).toBe("speak");
  integrateActorContinuation(f.world, f.actor, { purpose: "Inspect the notification", goalId: f.goal,
    actionType: "observe", observedAtSimMs: 0, nextPurpose: choice.value });
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toBeUndefined();
  expect(Goal.progress[f.goal]).toBe(0);
});

test("explicit cancellation retains autonomy and cannot silently replace the old commitment", () => {
  const f = fixture(); f.choose(); f.complete(); const n = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const cancel = { id: n.id, disposition: "cancel", reason: "I choose to stay in this conversation" };
  expect(prepareNextPurposeUpdate(f.world, f.actor, { goalId: f.goal, purpose: "Later again" }, cancel, f.selection)).toBeUndefined();
  const p = prepareNextPurposeUpdate(f.world, f.actor, undefined, cancel, f.selection)!;
  expect(p.current()).toBe(true);
  integrateActorContinuation(f.world, f.actor, { purpose: "Keep talking", actionType: "speak", observedAtSimMs: 0, nextPurpose: p.value });
  expect(hasNextPurposeReview(f.world, f.actor)).toBe(false); expect(Goal.status[f.goal]).toBe("active");
});

test("matching fresh action still needs explicit review of a ready next purpose", () => {
  const f = fixture(); f.choose(); f.complete();
  const before = CognitiveControl.stateJson[f.actor];
  const selection = { ...f.selection, requestId: "foreground:fresh-choice", actionType: "pickup", goalId: f.goal };
  expect(prepareNextPurposeUpdate(f.world, f.actor, undefined, undefined, selection)).toBeUndefined();
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const choice = prepareNextPurposeUpdate(f.world, f.actor, undefined,
    { id: next.id, disposition: "take", reason: "Now I choose to check" }, selection)!;
  expect(choice).toBeDefined(); expect(choice.current()).toBe(true); expect(choice.value).toBeNull();
  expect(choice.summary).toMatchObject({ disposition: "take", goalId: f.goal });
  expect(CognitiveControl.stateJson[f.actor]).toBe(before); // Preparation cannot dispatch or erase anything.
  expect(Goal.progress[f.goal]).toBe(0);
  Goal.description[f.goal] = "A changed intention";
  expect(choice.current()).toBe(false);
});

test.each(["unlisted", "same-request", "retired", "different-goal", "thought", "wait"])("%s cannot implicitly consume a ready next purpose", invalid => {
  const f = fixture(); f.choose(); f.complete(); const before = CognitiveControl.stateJson[f.actor];
  if (invalid === "retired") Goal.status[f.goal] = "retired";
  const choice = prepareNextPurposeUpdate(f.world, f.actor, undefined, undefined, {
    requestId: invalid === "same-request" ? f.selection.requestId : "foreground:fresh-choice",
    actionType: invalid === "thought" ? "think" : invalid === "wait" ? "wait" : "pickup",
    goalId: invalid === "different-goal" ? null : f.goal, listedGoals: new Set(invalid === "unlisted" ? [] : [f.goal]),
  });
  expect(choice).toBeUndefined(); expect(CognitiveControl.stateJson[f.actor]).toBe(before);
});

test("restored or externally edited control never restores a pending step's authority", () => {
  const f = fixture(); f.choose(); const saved = serializeWorld(f.world, createSystemRegistry());
  const restored = createArgosWorld("Restored"); initializePrefabs(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved), actor = oldToNewId.get(f.actor)!;
  expect(snapshotActorContinuation(restored, actor)?.nextPurpose).toBeUndefined();
  settleNextPurpose(restored, actor, { type: "speak", foregroundDecisionId: f.selection.requestId }, { succeeded: true, pending: false });
  expect(hasNextPurposeReview(restored, actor)).toBe(false);
});

test.each(["goal", "source", "edit", "time"])("%s change invalidates a prepared next purpose", boundary => {
  const f = fixture(); f.choose(); f.complete(); const n = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  const p = prepareNextPurposeUpdate(f.world, f.actor, undefined, { id: n.id, disposition: "take", reason: "Take it up" }, { ...f.selection, goalId: f.goal })!;
  if (boundary === "goal") Goal.description[f.goal] = "Different purpose";
  if (boundary === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (boundary === "edit") CognitiveControl.stateJson[f.actor] = "{}";
  if (boundary === "time") f.world.time.elapsed = -1;
  expect(p.current()).toBe(false);
});

test("cancelled tasks cannot settle the next-purpose boundary", async () => {
  const f = fixture(); f.choose(); const before = CognitiveControl.stateJson[f.actor]; const c = new AbortController();
  await expect(withSimulationTask(c.signal, async () => { c.abort(Error("Cancelled")); f.complete(); })).rejects.toThrow("Cancelled");
  expect(CognitiveControl.stateJson[f.actor]).toBe(before);
});

test.each(["waiting", "dispatched"] as const)("invalidated %s step preserves the distinction between unexecuted and in-flight work", status => {
  const f = fixture(); f.choose(); const revision = snapshotActorContinuation(f.world, f.actor)!.revision;
  updateActorContinuation(f.world, f.actor, revision, status);
  updateActorContinuation(f.world, f.actor, revision, "needs_revision", "source_changed");
  expect(hasNextPurposeReview(f.world, f.actor)).toBe(status === "waiting");
  if (status === "waiting") expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.outcome).toBe("not_executed");
  else { f.complete(); expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.outcome).toBe("succeeded"); }
});

test.each(["foreign", "unlisted", "unknown-field", "think"])("%s proposal cannot create a future purpose", invalid => {
  const f = fixture();
  const g = invalid === "foreign" ? createIntentGoal(f.world, f.other, "Someone else's goal", 9) : f.goal;
  const raw = { goalId: g, purpose: "Check later", ...(invalid === "unknown-field" ? { action: "read_phone" } : {}) };
  expect(prepareNextPurposeUpdate(f.world, f.actor, raw, undefined, { ...f.selection,
    listedGoals: new Set(invalid === "unlisted" ? [] : [g]), actionType: invalid === "think" ? "think" : "speak" })).toBeUndefined();
});
