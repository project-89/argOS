import { addComponent, addEntity, removeComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, CoordinationMemory, Goal, Health, LastAction, Mind, Needs, ObjectState, Plan, SocialMemory, Traits, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { getForegroundCognitionReadiness, isForegroundCognitionReady, recordCognitionOutcome, wakeForegroundCognition, recordForegroundCognitionAdmission, snapshotForegroundCognitionDiagnostics, deferForegroundSpeech } from "../idle-cognition";
import { beginRest } from "../rest-state";
import { completeDeferredAction, createIntentGoal, executeActions, hasPendingCognitionStimuli } from "../cognition-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { evaluatePlanEvidenceBarrier, issuePlanEvidenceBarrier } from "../plan-evidence-barrier";
import { recordWorkingMemoryEvidence, workingMemoryEntityRef } from "../working-memory";
import { captureWorkingMemoryObservation } from "../working-memory-observation";
import { applyCoordinationReviews } from "../coordination-memory";
import { recordCommittedSpeech } from "../social-memory";
import { advanceTimedSpeech, beginTimedSpeech } from "../timed-speech";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { integrateActorContinuation, updateActorContinuation } from "../actor-continuation";
import { hasActionablePlannedStep } from "../planning-system";
import { createPersonalIntention } from "../goal-lifecycle";

test.each([false, true])("situated plan readiness follows the selected goal, not an unrelated higher priority proposal (speech deferred=%s)", deferred => {
  const f = fixture(); f.world.meta.cognitionController = "situated";
  const selected = createPersonalIntention(f.world, f.actor, "Prepare to leave", 4)!;
  const unrelated = createPersonalIntention(f.world, f.actor, "Inspect a delivery later", 9)!;
  const p = plan(f, unrelated, "move");
  Plan.steps[p] = JSON.stringify([{ actionType: "move", target: "Store Room" }]);
  workingMemoryEntityRef(f.world, f.actor);
  integrateActorContinuation(f.world, f.actor, { purpose: "Prepare to leave", actionType: "think",
    goalId: selected, goalKey: WorkingMemoryIdentity.id[selected], observedAtSimMs: 0 });
  quiet(f);
  if (deferred) deferForegroundSpeech(f.world, f.actor, 5000);
  expect(hasActionablePlannedStep(f.world, f.actor)).toBe(false);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).not.toBe("actionable_plan");
  Plan.goalEid[p] = selected;
  expect(hasActionablePlannedStep(f.world, f.actor)).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("actionable_plan");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true }).reason).toBe("new_stimulus");
  advanceSimulationTime(f.world, 1, 10_000);
  expect(hasActionablePlannedStep(f.world, f.actor)).toBe(false);
});

beforeEach(() => { drainPendingStimuli(); });
afterEach(() => { drainPendingStimuli(); });

test("synchronous package observation keeps its committed quiet outcome", () => {
  const f = fixture();
  const remove = registerAgentWorldCapabilities(f.world, f.actor, {
    context: () => "", ready: () => true, busy: () => false,
    execute: action => { completeDeferredAction(f.world, f.actor, action, true, "The room is unchanged."); return true; },
  });
  try {
    executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Common Room" } }], createSystemRegistry());
    expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("quiet");
  } finally { remove(); }
});

function fixture() {
  const world = createArgosWorld("Quiet house"); initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Common Room", description: "A quiet room." });
  const away = createRoomEntity(world, { name: "Store Room" });
  const actor = createAgentEntity(world, { name: "Mara", role: "resident", systemPrompt: "Act from your experience.", roomId: room });
  const lamp = createObjectEntity(world, { name: "Reading lamp", roomId: room, portable: false });
  return { world, room, away, actor, lamp };
}
function quiet(f: ReturnType<typeof fixture>, now = 0, type: "wait" | "rest" | "observe" | "think" | "reflect" = "wait") {
  recordCognitionOutcome(f.world, f.actor, { type }, { succeeded: true, pending: false, now });
}
function goal(f: ReturnType<typeof fixture>) {
  const id = addEntity(f.world); addComponent(f.world, id, Goal); addComponent(f.world, f.actor, HasGoal(id));
  Goal.status[id] = "active"; Goal.kind[id] = "custom"; Goal.description[id] = "Maintain the room";
  Goal.priority[id] = 5; Goal.progress[id] = 0; Goal.paramsJson[id] = "{}"; Goal.successJson[id] = "{}";
  return id;
}
function plan(f: ReturnType<typeof fixture>, goalId: number, actionType = "observe") {
  const id = addEntity(f.world); addComponent(f.world, id, Plan); addComponent(f.world, f.actor, HasPlan(id));
  Plan.goalEid[id] = goalId; Plan.status[id] = "active"; Plan.currentStep[id] = 0;
  Plan.steps[id] = JSON.stringify([{ actionType, target: "Reading lamp", description: "Check the lamp" }]);
  return id;
}

test("quiet choices back off progressively but always retain a bounded reconsideration deadline", () => {
  const f = fixture();
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 0 }).reason).toBe("first_decision");
  let now = 0;
  for (const delay of [2_000, 5_000, 10_000, 20_000, 30_000, 30_000]) {
    quiet(f, now);
    const before = getForegroundCognitionReadiness(f.world, f.actor, { now: now + delay - 1 });
    expect(before.ready).toBe(false); expect(before.nextCheckAtMs).toBe(now + delay);
    now += delay;
    expect(getForegroundCognitionReadiness(f.world, f.actor, { now }).reason).toBe("idle_deadline");
  }
});

test("unchanged observation yields briefly, then shares the quiet backoff instead of a permanent scan loop", () => {
  const f = fixture(); quiet(f, 0, "observe");
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 999 })).toBe(false);
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1000 })).toBe(true);
  quiet(f, 1000, "observe");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1000 }).nextCheckAtMs).toBe(6000);
  quiet(f, 6000, "rest");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 6000 }).nextCheckAtMs).toBe(16000);
});

test("native observation feedback is retained without waking the idle actor into a self-triggered loop", () => {
  const f = fixture();
  executeActions(f.world, [{ eid: f.actor, action: { type: "observe", target: "Reading lamp" } }], createSystemRegistry());
  expect(LastAction.success[f.actor]).toBe(true);
  expect(peekPendingStimuli(f.actor).some(event => event.type === "observation")).toBe(true);
  expect(hasPendingCognitionStimuli(f.world, f.actor)).toBe(false);
  expect(isForegroundCognitionReady(f.world, f.actor)).toBe(false);
});

test("a three-minute unchanged scene has bounded foreground checks, not silence forever", () => {
  const f = fixture(); let decisions = 0;
  for (let now = 0; now <= 180_000; now += 500) {
    if (!isForegroundCognitionReady(f.world, f.actor, { now })) continue;
    decisions++; quiet(f, now);
  }
  expect(decisions).toBeGreaterThanOrEqual(6);
  expect(decisions).toBeLessThanOrEqual(12); // formerly up to 361 free-actor admissions
});

test("a meaningful pending stimulus and explicit wake are admitted immediately without consuming the probe", () => {
  const f = fixture(); quiet(f);
  for (let i = 0; i < 5; i++) expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1, hasPendingStimuli: true }).reason).toBe("new_stimulus");
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
  wakeForegroundCognition(f.world, f.actor);
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(true);
});

test("new locally perceptible state wakes, but unrelated remote state does not", () => {
  const f = fixture(); const remote = createObjectEntity(f.world, { name: "Hidden switch", roomId: f.away }); quiet(f);
  ObjectState.current[remote] = "broken";
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
  ObjectState.current[f.lamp] = "broken";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("readiness diagnostics count admitted decisions, not probes, and retain only typed causes", () => {
  const f = fixture(); startCommittedEvents(f.world); quiet(f);
  ObjectState.current[f.lamp] = "broken";
  for (let i = 0; i < 10; i++) expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 })).toMatchObject({ reason: "state_changed", changedFields: ["senses"] });
  expect(snapshotForegroundCognitionDiagnostics(f.world, f.actor)).toBeUndefined();
  recordForegroundCognitionAdmission(f.world, f.actor, getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }));
  expect(snapshotForegroundCognitionDiagnostics(f.world, f.actor)).toMatchObject({ admissions: 1, counts: { state_changed: 1 },
    lastAdmission: { reason: "state_changed", changedFields: ["senses"] } });
  wakeForegroundCognition(f.world, f.actor, { cause: "stimulus", stimulusType: "speech_fragment" });
  recordForegroundCognitionAdmission(f.world, f.actor, getForegroundCognitionReadiness(f.world, f.actor, { now: 1, hasPendingStimuli: true }));
  const saved = snapshotForegroundCognitionDiagnostics(f.world, f.actor)!;
  expect(saved).toMatchObject({ admissions: 2, counts: { state_changed: 1, new_stimulus: 1 },
    lastAdmission: { wake: { cause: "stimulus", stimulusType: "speech_fragment" } } });
  expect(JSON.stringify(saved)).not.toContain("Reading lamp");
  saved.counts.state_changed = 999;
  expect(snapshotForegroundCognitionDiagnostics(f.world, f.actor)?.counts.state_changed).toBe(1);
  stopCommittedEvents(f.world); expect(snapshotForegroundCognitionDiagnostics(f.world, f.actor)).toBeUndefined();
  startCommittedEvents(f.world); expect(snapshotForegroundCognitionDiagnostics(f.world, f.actor)).toBeUndefined();
});

test("an object moved into own inventory wakes without exposing somebody else's inventory", () => {
  const f = fixture(); const key = createObjectEntity(f.world, { name: "Key", roomId: f.away }); quiet(f);
  setLocatedIn(f.world, key, f.actor);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("blind actors do not wake for an otherwise invisible local object state change", () => {
  const f = fixture(); Traits.active[f.actor] = JSON.stringify(["blind"]); quiet(f);
  ObjectState.current[f.lamp] = "broken";
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
});

test("actual dialogue memory wakes but own monologue, execution timestamps, need drift and world clocks do not", () => {
  const f = fixture(); quiet(f);
  Mind.lastUpdate[f.actor] = 42; Mind.focus[f.actor] = "Enjoy the quiet"; Mind.arousal[f.actor] = 0.4;
  addComponent(f.world, f.actor, LastAction); LastAction.timestamp[f.actor] = 42;
  Needs.energy[f.actor] -= 0.01; Needs.hunger[f.actor] += 0.01;
  f.world.time.elapsed += 1; f.world.time.tick += 1;
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
  addComponent(f.world, f.actor, SocialMemory); SocialMemory.revision[f.actor] = 1;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("new goals, retired goals and actual plan steps wake; progress bookkeeping and repeated verification do not", () => {
  const f = fixture(); quiet(f); const g = goal(f);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  const p = plan(f, g); quiet(f);
  Goal.progress[g] = 90; Plan.lastUpdated[p] = 42;
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
  Goal.status[g] = "completed";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  Goal.status[g] = "active"; Plan.steps[p] = JSON.stringify([{ actionType: "move", target: "Store Room" }]); quiet(f);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("actionable_plan");
});

test("detached or completed goals cannot keep a physical plan waking an otherwise idle actor", () => {
  const f = fixture(), g = goal(f); plan(f, g, "move");
  Goal.status[g] = "completed"; quiet(f);
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
  Goal.status[g] = "active"; removeComponent(f.world, f.actor, HasGoal(g)); quiet(f);
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(false);
});

test.each(["completed", "failed", "retired", "expired"])("%s transitions wake once, but editing/removing already-terminal history does not", status => {
  const f = fixture(), g = goal(f), p = plan(f, g);
  quiet(f);
  Goal.status[g] = status;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 })).toMatchObject({ ready: true, reason: "state_changed" });
  quiet(f);
  Goal.description[g] = "Historical bookkeeping only"; Goal.priority[g] = 9;
  Plan.steps[p] = JSON.stringify([{ actionType: "move", target: "Store Room" }]);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).ready).toBe(false);
  removeEntity(f.world, g);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).ready).toBe(false);
});

test.each(["paused", "queued", "blocked", "unrecognized_future_status"])("nonterminal %s goals remain part of reconsideration", status => {
  const f = fixture(), g = goal(f); Goal.status[g] = status; quiet(f);
  Goal.priority[g] = 8;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  quiet(f); Goal.status[g] = "active";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("a restored terminal goal or replaced live goal identity is a new decision input", () => {
  const f = fixture(), g = goal(f); addComponent(f.world, g, WorkingMemoryIdentity); WorkingMemoryIdentity.id[g] = "original-goal";
  Goal.status[g] = "completed"; quiet(f); Goal.status[g] = "active";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  quiet(f); WorkingMemoryIdentity.id[g] = "a-different-goal-lifetime";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test.each(["owner", "source"])("ordinary quiet pacing does not survive %s replacement", change => {
  const f = fixture(); startCommittedEvents(f.world); workingMemoryEntityRef(f.world, f.actor); quiet(f);
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "different-actor";
  else { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).ready).toBe(true);
});

test.each(["failed", "pending", "physical"])("%s execution never traps the actor in quiet backoff", kind => {
  const f = fixture(); quiet(f);
  recordCognitionOutcome(f.world, f.actor, { type: kind === "physical" ? "interact" : "wait" }, {
    succeeded: kind !== "failed", pending: kind === "pending", now: 1,
  });
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 1 })).toBe(true);
});

test.each(["hunger", "energy", "comfort", "injury"])("critical %s remains immediately eligible for action", need => {
  const f = fixture(); quiet(f);
  if (need === "hunger") Needs.hunger[f.actor] = 90;
  if (need === "energy") Needs.energy[f.actor] = 10;
  if (need === "comfort") Needs.comfort[f.actor] = 10;
  if (need === "injury") { addComponent(f.world, f.actor, Health); Health.max[f.actor] = 100; Health.current[f.actor] = 20; }
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("critical_need");
});

test("low energy does not restart cognition while real rest recovery is underway, but other danger and inputs still wake", () => {
  const f = fixture(); Needs.energy[f.actor] = 10;
  expect(beginRest(f.world, f.actor)).toBe(true); quiet(f, 0, "rest");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("quiet");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1, hasPendingStimuli: true }).reason).toBe("new_stimulus");
  Needs.hunger[f.actor] = 90;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("critical_need");
});

test("inactive/removed actors cannot be awakened by stale pending inputs", () => {
  const f = fixture(); quiet(f); Agent.active[f.actor] = false;
  expect(isForegroundCognitionReady(f.world, f.actor, { hasPendingStimuli: true, now: 1 })).toBe(false);
  removeEntity(f.world, f.actor);
  expect(isForegroundCognitionReady(f.world, f.actor, { hasPendingStimuli: true, now: 1 })).toBe(false);
});

test("idle state is world-scoped and a reset simulation clock cannot strand an actor", () => {
  const f = fixture(); quiet(f, 10_000);
  expect(isForegroundCognitionReady(f.world, f.actor, { now: 0 })).toBe(true);
  const other = fixture();
  expect(getForegroundCognitionReadiness(other.world, other.actor, { now: 10_001 }).reason).toBe("first_decision");
});

test("arming a wait and rewriting engine plan bookkeeping do not trigger another identical thought", () => {
  const f = fixture(), g = goal(f), p = plan(f, g, "wait");
  const step = { actionType: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 10_000 }, evidenceScope: "quiet:wait" };
  Plan.steps[p] = JSON.stringify([step]); quiet(f, 0);
  const token = issuePlanEvidenceBarrier(f.world, f.actor, step.waitUntil, step.evidenceScope, 0)!;
  Plan.steps[p] = JSON.stringify([{ ...step, evidenceBarrier: token, description: "Continue awaiting a reply.",
    workingMemoryDependency: "new engine hash", coordinationDependency: "new engine hash", estimatedDuration: "soon" }]);
  for (const now of [1, 2_000, 5_000, 9_999]) expect(getForegroundCognitionReadiness(f.world, f.actor, { now }))
    .toMatchObject({ ready: false, reason: "quiet", nextCheckAtMs: 10_000 });
  for (let i = 0; i < 3; i++) expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 10_000 }).reason).toBe("evidence_deadline");
  expect(evaluatePlanEvidenceBarrier(f.world, f.actor, token, step.evidenceScope, { nowMs: 10_000 }))
    .toMatchObject({ status: "reconsider", reason: "timeout" });
});

test("an actor's ordinary wait does not borrow an unrelated planner's evidence deadline", () => {
  const f = fixture(), g = goal(f), p = plan(f, g, "wait");
  const step = { actionType: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 10000 }, evidenceScope: "unselected:wait" };
  const token = issuePlanEvidenceBarrier(f.world, f.actor, step.waitUntil, step.evidenceScope, 0)!;
  Plan.steps[p] = JSON.stringify([{ ...step, evidenceBarrier: token }]);
  const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Watch the entrance", actionType: "wait", observedAtSimMs: 0 })!;
  updateActorContinuation(f.world, f.actor, revision, "dispatched");
  quiet(f, 0);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 2000 })).toMatchObject({ ready: true, reason: "idle_deadline" });
  expect(Plan.currentStep[p]).toBe(0);
});

test("an equivalent background plan replacement stays quiet, but changed intent wakes", () => {
  const f = fixture(), g = goal(f), old = plan(f, g, "wait");
  Plan.steps[old] = JSON.stringify([{ actionType: "wait", waitUntil: { kind: "heard_evidence", speaker: "Ivo" } }]); quiet(f);
  Plan.status[old] = "retired";
  const replacement = plan(f, g, "wait");
  Plan.steps[replacement] = JSON.stringify([{ actionType: "wait", waitUntil: { kind: "heard_evidence", speaker: "Ivo" },
    description: "A newly worded background description", evidenceScope: "a different generated plan scope" }]);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("quiet");
  Plan.steps[replacement] = JSON.stringify([{ actionType: "wait", waitUntil: { kind: "heard_evidence", speaker: "Sera" } }]);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("inspection bookkeeping and revision-only refreshes do not wake, while newly learned facts do", () => {
  const f = fixture(), ref = workingMemoryEntityRef(f.world, f.lamp)!; let serial = 0;
  const write = (slot: string, value: string) => recordWorkingMemoryEvidence(f.world, f.actor, {
    id: `quiet:receipt:${++serial}`, atMs: Date.now() + serial, kind: "observation", provenance: "visible_observation", summary: "A sourced update.",
    facts: [{ subject: ref.key, subjectLabel: ref.label, predicate: "state", slot, value }],
  });
  write("Inspection.basis", "old-hash"); quiet(f);
  write("Inspection.basis", "new-hash"); write("Inspection.question", "new internal question key");
  WorkingMemory.revision[f.actor] += 1;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("quiet");
  write("ObjectState.current", "newly learned broken state");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("coordination timestamps and ended-goal tracking do not wake, but withdrawal does", () => {
  const f = fixture(), g = createIntentGoal(f.world, f.actor, "Maintain the room", 5);
  const speech = recordCommittedSpeech(f.world, f.actor, "I will maintain the room.")!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: speech.id, task: "Maintain the room", goalId: g }])).toBe(1);
  quiet(f);
  const items = JSON.parse(CoordinationMemory.itemsJson[f.actor]);
  items[0].updatedAt += 1; items[0].localUpdatedAt += 1; items[0].goalTracking = { status: "ended", atMs: Date.now() };
  CoordinationMemory.itemsJson[f.actor] = JSON.stringify(items); CoordinationMemory.revision[f.actor] += 1;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("quiet");
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: speech.id, reason: "I cannot maintain the room now." }])).toBe(1);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
});

test("a quiet evidence wait still wakes on speech, visible state, critical needs, or a changed typed indicator", () => {
  const f = fixture(), g = goal(f), p = plan(f, g, "wait"); let ready = false;
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    observableState: target => target === f.lamp ? [{ key: "ready", type: "boolean", value: ready }] : [] });
  captureWorkingMemoryObservation(f.world, f.actor);
  const step = { actionType: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 10_000 }, evidenceScope: "interruptible:wait" };
  const token = issuePlanEvidenceBarrier(f.world, f.actor, step.waitUntil, step.evidenceScope, 0)!;
  Plan.steps[p] = JSON.stringify([{ ...step, evidenceBarrier: token }]); quiet(f);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1, hasPendingStimuli: true }).reason).toBe("new_stimulus");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("quiet");
  ready = true; expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  quiet(f); ObjectState.current[f.lamp] = "broken";
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("state_changed");
  quiet(f); Needs.hunger[f.actor] = 90;
  expect(getForegroundCognitionReadiness(f.world, f.actor, { now: 1 }).reason).toBe("critical_need");
});

test("default quiet deadlines advance with simulation time, not paused wall time", () => {
  const f = fixture(); recordCognitionOutcome(f.world, f.actor, { type: "wait" }, { succeeded: true, pending: false });
  expect(getForegroundCognitionReadiness(f.world, f.actor)).toMatchObject({ ready: false, nextCheckAtMs: 2_000 });
  advanceSimulationTime(f.world, 1, 1_999); expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("quiet");
  advanceSimulationTime(f.world, 2, 1); expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("idle_deadline");
});

test("speaking waits quietly but permits a fresh stimulus to use the free body channel", () => {
  const f = fixture();
  expect(beginTimedSpeech(f.world, f.actor, "Hello there.", "test:speech", () => {}, () => {})).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("speaking");
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasPendingStimuli: true }).reason).toBe("new_stimulus");
  advanceSimulationTimeline(f.world, 2_000, { integrate: () => {} });
  expect(getForegroundCognitionReadiness(f.world, f.actor).reason).toBe("first_decision");
});

test("an overdue considered cue waits for speech completion, while a new stimulus can still interrupt", () => {
  const f = fixture();
  expect(beginTimedSpeech(f.world, f.actor, "Hello there.", "test:reminder", () => {}, () => {})).toBe(true);
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasDueAttention: true })).toMatchObject({ ready: false, reason: "speaking" });
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasDueAttention: true, hasPendingStimuli: true })).toMatchObject({ ready: true, reason: "new_stimulus" });
  advanceSimulationTimeline(f.world, 2_000, { integrate: () => {} });
  expect(getForegroundCognitionReadiness(f.world, f.actor, { hasDueAttention: true })).toMatchObject({ ready: true, reason: "evidence_deadline" });
});
