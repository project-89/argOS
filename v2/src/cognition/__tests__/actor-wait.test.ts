import { addComponent } from "bitecs";
import { jest } from "@jest/globals";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan, ObjectState, WorkingMemoryIdentity } from "../../ecs/components";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { recordCognitionOutcome, getForegroundCognitionReadiness } from "../idle-cognition";
import { getActorWaitTiming, snapshotActorWait, prepareActorWait, prepareActorWaitChecked, settleActorWait, captureActorWaitOutcomeAuthority } from "../actor-wait";
import { createIntentGoal, executeActions, completeDeferredAction } from "../cognition-system";
import { bindForegroundAction, captureForegroundDecisionFence } from "../foreground-action-admission";
import { createPlanEntity, captureActorWaitPlan } from "../planning-system";
import { captureCoordinationGoal } from "../coordination-memory";
import { integrateActorContinuation } from "../actor-continuation";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { getDirectContainer } from "../../ecs/location";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import type { PlanWaitUntil } from "../plan-evidence-barrier";

function fixture() {
  const world = createArgosWorld("Chosen wait"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Room" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Choose freely", roomId: room });
  const relay = createObjectEntity(world, { name: "Relay", portable: false, roomId: room });
  addComponent(world, relay, ObjectState); ObjectState.current[relay] = "off";
  captureWorkingMemoryObservation(world, actor);
  const choose = (waitUntil: PlanWaitUntil = { kind: "heard_evidence", timeoutMs: 12000 }) =>
    recordCognitionOutcome(world, actor, { type: "wait", waitUntil }, { succeeded: true, pending: false });
  const advance = (ms: number) => advanceSimulationTimeline(world, ms, { integrate: () => {} });
  return { world, room, actor, relay, choose, advance };
}
function plannedFixture() {
  const f = fixture();
  const goal = createIntentGoal(f.world, f.actor, "Inspect the relay after it turns on", 5);
  captureCoordinationGoal(f.world, f.actor, goal);
  const condition = prepareActorWait(f.world, f.actor, { kind: "physical_fact", subject: "Relay", predicate: "state", slot: "ObjectState.current", equals: "on", timeoutMs: 12000 })!.condition;
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Inspect the relay after it turns on", steps: [
    { description: "Wait for power", actionType: "wait", waitUntil: condition },
    { description: "Inspect relay", actionType: "observe", target: "Relay" },
  ] });
  const select = () => integrateActorContinuation(f.world, f.actor, { purpose: "Inspect the powered relay", actionType: "wait",
    goalId: goal, goalKey: WorkingMemoryIdentity.id[goal], observedAtSimMs: f.world.time.elapsed });
  select(); return { ...f, goal, plan, condition, select };
}
test("only verified evidence advances the original selected wait cursor, exactly once", () => {
  let now = 100000; const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const f = plannedFixture(); f.choose(f.condition); expect(Plan.currentStep[f.plan]).toBe(0);
    now += 1000; ObjectState.current[f.relay] = "on"; settleActorWait(f.world, f.actor);
    expect(Plan.currentStep[f.plan]).toBe(1); settleActorWait(f.world, f.actor);
    expect(Plan.currentStep[f.plan]).toBe(1); expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
    expect(JSON.parse(Plan.steps[f.plan])[0].resolution.kind).toBe("evidence_barrier");
  } finally { clock.mockRestore(); }
});
test("fabricated success cannot advance a selected wait", () => {
  const f = plannedFixture(), credit = captureActorWaitPlan(f.world, f.actor, f.condition, "fiction");
  expect(credit).toBeDefined(); expect(credit!({ status: "satisfied", sourceIds: ["invented"] })).toBe(false);
  expect(Plan.currentStep[f.plan]).toBe(0);
});
test.each(["plan_definition", "goal_identity", "intention_revision"] as const)("%s change prevents old wait credit", change => {
  let now = 100000; const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const f = plannedFixture(); f.choose(f.condition);
    if (change === "plan_definition") { const steps = JSON.parse(Plan.steps[f.plan]); steps[1].description = "Different next step"; Plan.steps[f.plan] = JSON.stringify(steps); }
    else if (change === "goal_identity") WorkingMemoryIdentity.id[f.goal] = "replacement-goal";
    else f.select();
    now += 1000; ObjectState.current[f.relay] = "on"; settleActorWait(f.world, f.actor);
    expect(Plan.currentStep[f.plan]).toBe(0);
  } finally { clock.mockRestore(); }
});
test("explicitly choosing the same wait again preserves its deadline and renews selected-plan binding", () => {
  let now = 100000; const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const f = plannedFixture(); f.choose(f.condition); f.advance(3000); f.select(); f.choose(f.condition);
    expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
    now += 1000; ObjectState.current[f.relay] = "on"; settleActorWait(f.world, f.actor);
    expect(Plan.currentStep[f.plan]).toBe(1);
  } finally { clock.mockRestore(); }
});
test("timeout cannot advance a plan or complete its goal", () => {
  const f = plannedFixture(); f.choose(f.condition); f.advance(12000); settleActorWait(f.world, f.actor);
  expect(Plan.currentStep[f.plan]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  expect(snapshotActorWait(f.world, f.actor)?.evidenceResult).toMatchObject({ status: "reconsider", reason: "timeout" });
});
test("repeating a chosen wait does not postpone its unexpired deadline", () => {
  const f = fixture(); f.choose(); f.advance(3000); f.choose();
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
  f.advance(9000); expect(snapshotActorWait(f.world, f.actor)?.reconsiderationDue).toBe(true);
});
test.each([{ succeeded: false, pending: false }, { succeeded: true, pending: true }])("uncommitted outcome %j cannot retain a wait", outcome => {
  const f = fixture(); f.choose();
  recordCognitionOutcome(f.world, f.actor, { type: "wait", waitUntil: { kind: "heard_evidence" } }, outcome);
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});
test("an ordinary wait cancels a prior specific condition", () => {
  const f = fixture(); f.choose();
  recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false });
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});

test.each(["think", "observe", "wait"] as const)("incidental native %s execution cannot replace a chosen evidence wait", type => {
  const f = plannedFixture(); f.choose(f.condition); f.advance(3000);
  executeActions(f.world, [{ eid: f.actor, action: { type, content: "Check my readiness", ...(type === "observe" ? { target: "Relay" } : {}) } }], createSystemRegistry());
  // An observation creates a fresh evidence receipt; the control boundary must
  // evaluate it, not mistake a changed receipt ID for a cancelled wait.
  settleActorWait(f.world, f.actor);
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
  expect(Goal.progress[f.goal]).toBe(0);
});

test("a newly admitted foreground think legitimately replaces the earlier wait", () => {
  const f = plannedFixture(); f.choose(f.condition);
  integrateActorContinuation(f.world, f.actor, { purpose: "Reconsider what I want", actionType: "think", observedAtSimMs: 0 });
  const action = bindForegroundAction(f.world, f.actor, captureForegroundDecisionFence(f.world, f.actor)!,
    { type: "think", content: "I want to reconsider." }, "New choice");
  executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
});

test.each([false, true])("a late %s package outcome cannot erase a wait selected after the operation began", success => {
  const f = fixture(); let issued: any;
  const close = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: action => { issued = action; return true; } });
  executeActions(f.world, [{ eid: f.actor, action: { type: "interact", target: "Relay", content: "inspect" } }], createSystemRegistry());
  expect(issued?.executionId).toBeDefined();
  f.choose(); f.advance(3000);
  completeDeferredAction(f.world, f.actor, issued, success, success ? "Inspection finished" : "Inspection failed");
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
  close();
});

test("a foreground pending operation supersedes at admission but cannot erase a later chosen wait", () => {
  const f = plannedFixture(); let issued: any;
  const close = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    execute: action => { issued = action; return true; } });
  f.choose(f.condition);
  integrateActorContinuation(f.world, f.actor, { purpose: "Inspect the relay myself", actionType: "interact", observedAtSimMs: 0 });
  const action = bindForegroundAction(f.world, f.actor, captureForegroundDecisionFence(f.world, f.actor)!,
    { type: "interact", target: "Relay", content: "inspect" }, "New choice");
  executeActions(f.world, [{ eid: f.actor, action }], createSystemRegistry());
  expect(issued?.executionId).toBeDefined(); expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
  f.select(); f.choose(f.condition); f.advance(3000);
  completeDeferredAction(f.world, f.actor, issued, true, "Inspection finished");
  settleActorWait(f.world, f.actor);
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 }); close();
});

test("a timed native completion carries its original incidental authority", () => {
  const f = fixture(); f.world.meta.timedActions = true;
  const item = createObjectEntity(f.world, { name: "Note", portable: true, roomId: f.room });
  const registry = createSystemRegistry();
  executeActions(f.world, [{ eid: f.actor, action: { type: "pickup", target: "Note" } }], registry);
  expect(getDirectContainer(f.world, item)).toBe(f.room);
  f.choose(); f.advance(3000);
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
  expect(getDirectContainer(f.world, item)).toBe(f.actor);
});

test("an old selected-wait receipt cannot revive its condition after a newer ordinary choice", () => {
  const f = plannedFixture(), action = { type: "wait", waitUntil: f.condition };
  const old = captureActorWaitOutcomeAuthority(f.world, f.actor, action, true);
  captureActorWaitOutcomeAuthority(f.world, f.actor, { type: "wait" }, true);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: old });
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
});

test.each(["source", "actor", "selection", "capabilities"] as const)("a %s replacement invalidates a pending selected-wait receipt", change => {
  const f = plannedFixture(), action = { type: "wait", waitUntil: f.condition };
  const authority = captureActorWaitOutcomeAuthority(f.world, f.actor, action, true);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: true, waitAuthority: authority });
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
  let close: (() => void) | undefined;
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  else if (change === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  else if (change === "selection") f.select();
  else close = registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true,
    busy: () => false, execute: () => false });
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: authority });
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined(); close?.();
});

test("a pending selected wait arms only when the same operation acknowledges completion", () => {
  const f = fixture(), action = { type: "wait", waitUntil: { kind: "heard_evidence" as const, timeoutMs: 12000 } };
  const authority = captureActorWaitOutcomeAuthority(f.world, f.actor, action, true);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: true, waitAuthority: authority });
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined(); f.advance(3000);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: authority });
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 15000 });
});

test("forged authority cannot arm a wait, and duplicate completion cannot renew a selected deadline", () => {
  const f = plannedFixture(), action = { type: "wait", waitUntil: f.condition };
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: { id: "invented" } });
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
  const authority = captureActorWaitOutcomeAuthority(f.world, f.actor, action, true);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: authority });
  f.advance(3000);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: authority });
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
});

test("a deliberately reselected condition keeps its prior deadline with a renewed receipt", () => {
  const f = plannedFixture(); f.choose(f.condition); f.advance(3000); f.select();
  const action = { type: "wait", waitUntil: f.condition };
  const authority = captureActorWaitOutcomeAuthority(f.world, f.actor, action, true);
  recordCognitionOutcome(f.world, f.actor, action, { succeeded: true, pending: false, waitAuthority: authority });
  expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ deadlineMs: 12000 });
});
test("checked admission preserves the legacy absent result for an unavailable actor context", () => {
  const f = fixture(); stopCommittedEvents(f.world);
  expect(prepareActorWaitChecked(f.world, f.actor, { kind: "heard_evidence" })).toEqual({ issueCode: "context_unavailable" });
  expect(prepareActorWait(f.world, f.actor, { kind: "heard_evidence" })).toBeUndefined();
  expect(getActorWaitTiming(f.world, f.actor)).toBeUndefined();
});
test("source and owner replacement reveal no stale chosen condition", () => {
  const f = fixture(); f.choose(); stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined(); f.choose();
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined();
});
test("re-registering the same adapter invalidates the old choice", () => {
  const f = fixture(), adapter = { context: () => "", ready: () => true, busy: () => false, execute: () => false };
  const release = registerAgentWorldCapabilities(f.world, f.actor, adapter); f.choose(); release();
  const next = registerAgentWorldCapabilities(f.world, f.actor, adapter);
  expect(snapshotActorWait(f.world, f.actor)).toBeUndefined(); next();
});
test("restore retains no executable wait token", () => {
  const f = fixture(); f.choose();
  const saved = structuredClone(serializeWorld(f.world, createSystemRegistry()));
  const world = createArgosWorld("Restored"), { oldToNewId } = deserializeWorld(world, createSystemRegistry(), saved);
  expect(getActorWaitTiming(world, oldToNewId.get(f.actor)!)).toBeUndefined();
});
test("an already observable matching condition prompts reconsideration without waiting for a timeout", () => {
  let now = 100000; const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const f = fixture(); now += 1000;
    ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.actor); now += 1000;
    f.choose({ kind: "physical_fact", subject: "Relay", predicate: "state", slot: "ObjectState.current", equals: "on" });
    expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(true);
    expect(snapshotActorWait(f.world, f.actor)?.evidenceResult).toMatchObject({ status: "satisfied" });
  } finally { clock.mockRestore(); }
});
test("old matching memory cannot substitute for the current observation", () => {
  let now = 100000; const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  try {
    const f = fixture(); now += 1000;
    ObjectState.current[f.relay] = "on"; captureWorkingMemoryObservation(f.world, f.actor); now += 1000;
    ObjectState.current[f.relay] = "off";
    f.choose({ kind: "physical_fact", subject: "Relay", predicate: "state", slot: "ObjectState.current", equals: "on" });
    expect(getActorWaitTiming(f.world, f.actor)).toMatchObject({ invalid: false, resolved: false });
    expect(snapshotActorWait(f.world, f.actor)?.evidenceResult).toBeUndefined();
    expect(getForegroundCognitionReadiness(f.world, f.actor).ready).toBe(false);
  } finally { clock.mockRestore(); }
});
