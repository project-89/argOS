import { addComponent, removeEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createIntentGoal } from "../../cognition/cognition-system";
import { integrateActorContinuation, updateActorContinuation } from "../../cognition/actor-continuation";
import { createPlanEntity } from "../../cognition/planning-system";
import { recordPrivateCommunication } from "../../cognition/communication-memory";
import { applyCoordinationReviews, getCoordinationMemory, reconcileCoordinationGoals } from "../../cognition/coordination-memory";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { captureActorIntentionEvidence } from "../actor-intention-evidence";

function fixture() {
  const world = createArgosWorld("Growing world"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Street" });
  const actor = createAgentEntity(world, { name: "Ada", roomId: room, role: "resident", systemPrompt: "Choose freely." });
  const goal = createIntentGoal(world, actor, "Meet a friend for dinner", 7);
  const observations = captureActorIntentionEvidence(world);
  const ref = observations.records.find(record => record.kind === "goal")!.ref;
  return { world, actor, room, goal, observations, ref };
}

test("goals are author evidence without a failed action or public announcement", () => {
  const f = fixture();
  expect(f.observations.records).toEqual([expect.objectContaining({ actor: "Ada", observedRoom: "Street", kind: "goal", description: "Meet a friend for dinner" })]);
  expect(f.observations.bind([f.ref])?.()).toBe(true);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  const next = captureActorIntentionEvidence(f.world);
  expect(next.records[0].ref).not.toBe(f.ref);
  expect(next.records[0].causalKey).toBe(f.observations.records[0].causalKey);
  expect(next.bind([f.ref])).toBeUndefined();
});

test.each(["goal", "source", "actor", "room", "definition"])("changed %s invalidates the original intention evidence", change => {
  const f = fixture();
  if(change === "goal") Goal.status[f.goal] = "completed";
  else if(change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  else if(change === "actor") removeEntity(f.world, f.actor);
  else if(change === "room") { addComponent(f.world, f.room, WorkingMemoryIdentity); WorkingMemoryIdentity.id[f.room] = "replaced"; }
  else Goal.description[f.goal] = "Stay home instead";
  expect(f.observations.bind([f.ref])?.()).toBe(false);
});

test("an ongoing intention survives ordinary travel without becoming a new construction demand", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Head toward dinner", actionType: "wait", goalId: f.goal,
    goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: 0 });
  const before = captureActorIntentionEvidence(f.world);
  setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Square" }));
  const after = captureActorIntentionEvidence(f.world);
  expect(before.bind(before.records.map(record => record.ref))?.()).toBe(true);
  expect(after.records.map(record => record.causalKey)).toEqual(before.records.map(record => record.causalKey));
  expect(before.records.map(record => record.observedRoom)).toEqual(["Street", "Street"]);
  expect(after.records.map(record => record.observedRoom)).toEqual(["Square", "Square"]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  Goal.status[f.goal] = "paused";
  expect(before.bind(before.records.map(record => record.ref))?.()).toBe(false);
});

test("a selected purpose cannot retain authority after its goal is released", () => {
  const f = fixture();
  integrateActorContinuation(f.world,f.actor,{purpose:"Head toward dinner",actionType:"wait",goalId:f.goal,
    goalKey:WorkingMemoryIdentity.id[f.goal],observedAtSimMs:0});
  const observation = captureActorIntentionEvidence(f.world), ref = observation.records.find(record=>record.kind==="selected_purpose")!.ref;
  expect(observation.bind([ref])?.()).toBe(true);
  Goal.status[f.goal] = "paused";
  expect(observation.bind([ref])?.()).toBe(false);
});

test("record storage is bounded without pretending omitted goals were observed", () => {
  const f = fixture(); for(let i=0;i<12;i++) createIntentGoal(f.world,f.actor,`Consider activity ${i}`,5);
  const evidence = captureActorIntentionEvidence(f.world);
  expect(evidence.records).toHaveLength(8); expect(evidence.omitted).toBe(5);
  expect(evidence.bind(["intention:invented"])).toBeUndefined();
});

function undertake(f: ReturnType<typeof fixture>) {
  const receipt = recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!,
    messageKey: "owned-promise", channel: "phone", kind: "sent", other: "Friend",
    content: "PRIVATE_SOURCE_BODY: I will meet you at the observatory.", sentAtSimMs: 0 })!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: receipt.id,
    task: "Visit the observatory to use a telescope", goalId: f.goal }])).toBe(1);
  const observation = captureActorIntentionEvidence(f.world), record = observation.records.find(r => r.kind === "undertaking")!;
  expect(record).toBeDefined(); return { observation, record, receipt };
}

test("ongoing undertakings give authors the destination without copying private messages or creating public facts", () => {
  const f = fixture(), u = undertake(f);
  expect(u.record).toMatchObject({ kind: "undertaking", description: "Visit the observatory to use a telescope" });
  expect(JSON.stringify(u.observation.records)).not.toContain("PRIVATE_SOURCE_BODY");
  expect(getCommittedEvents(f.world).events).toEqual([]);
  expect(u.observation.resolveActor(u.record.ref)).toMatchObject({ eid: f.actor });
  Goal.status[f.goal] = "retired"; reconcileCoordinationGoals(f.world, f.actor);
  setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Square" }));
  expect(u.observation.bind([u.record.ref])?.()).toBe(true);
  const next = captureActorIntentionEvidence(f.world).records.find(r => r.kind === "undertaking")!;
  expect(next.causalKey).toBe(u.record.causalKey); expect(next.observedRoom).toBe("Square");
  expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe("not_started");
});

test.each(["release", "source", "actor", "relink"])("an undertaking's %s change invalidates its old construction citation", change => {
  const f = fixture(), u = undertake(f);
  if (change === "release") applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: u.receipt.id, reason: "I changed my mind" }]);
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "actor") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "relink") {
    const other = createIntentGoal(f.world, f.actor, "A different approach", 5);
    applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: u.receipt.id, goalId: other }]);
  }
  expect(u.observation.bind([u.record.ref])?.()).toBe(false);
  expect(u.observation.resolveActor(u.record.ref)).toBeUndefined();
});

function planning(f: ReturnType<typeof fixture>) {
  return createPlanEntity(f.world, f.actor, f.goal, { goalDescription: Goal.description[f.goal],
    estimatedCompletion: "Soon", potentialObstacles: [], steps: [
      { description: "Walk there", actionType: "move", target: "Observatory" },
      { description: "PRIVATE_PLAN_PROSE", actionType: "interact", target: "Telescope", content: "PRIVATE_COMMAND_ARGUMENTS" },
    ] });
}

test("upcoming plan targets expose missing places and tools before any failure, never speech or command contents", () => {
  const f = fixture(), plan = planning(f), evidence = captureActorIntentionEvidence(f.world);
  const rows = evidence.records.filter(r => r.kind === "planned_step");
  expect(rows.map(r => [r.actionType, r.target])).toEqual([["move", "Observatory"], ["interact", "Telescope"]]);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  expect(evidence.bind(rows.map(r => r.ref))?.()).toBe(true);
  expect(getCommittedEvents(f.world).events).toEqual([]); expect(Goal.progress[f.goal]).toBe(0);
  Plan.currentStep[plan] = 1;
  expect(evidence.bind([rows[0].ref])?.()).toBe(false);
  expect(evidence.bind([rows[1].ref])?.()).toBe(true); // Earlier step progress does not remove the future need.
  Plan.currentStep[plan] = 2;
  expect(evidence.bind([rows[1].ref])?.()).toBe(false);
});

test.each(["target", "replacement", "retired", "goal_review"])("a %s change cannot retain a plan-target citation", change => {
  const f = fixture(), plan = planning(f), evidence = captureActorIntentionEvidence(f.world);
  const record = evidence.records.find(r => r.kind === "planned_step")!;
  if (change === "target") { const rows = JSON.parse(Plan.steps[plan]); rows[0].target = "Stay home"; Plan.steps[plan] = JSON.stringify(rows); }
  if (change === "replacement") planning(f);
  if (change === "retired") Plan.status[plan] = "retired";
  if (change === "goal_review") { addComponent(f.world, f.goal, GoalLifecycle); GoalLifecycle.reviewRevision[f.goal] = 1; }
  expect(evidence.bind([record.ref])?.()).toBe(false);
  expect(evidence.resolveActor(record.ref)).toBeUndefined();
});

test("blocked selected movement is demand, but changed targets and restored/external commands are not old authority", () => {
  const f = fixture();
  const revision = integrateActorContinuation(f.world, f.actor, { purpose: "Find a place to eat", actionType: "move", target: "Cafe",
    goalId: f.goal, goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: 0 })!;
  updateActorContinuation(f.world, f.actor, revision, "needs_revision", "target_changed");
  const evidence = captureActorIntentionEvidence(f.world), record = evidence.records.find(r => r.kind === "selected_purpose")!;
  expect(record).toMatchObject({ target: "Cafe", actionType: "move", status: "needs_revision" });
  expect(evidence.bind([record.ref])?.()).toBe(true);
  integrateActorContinuation(f.world, f.actor, { purpose: "Find a place to eat", actionType: "move", target: "Park",
    goalId: f.goal, goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: 0 });
  expect(evidence.bind([record.ref])?.()).toBe(false);
  const next = integrateActorContinuation(f.world, f.actor, { purpose: "Find a place to eat", actionType: "move", target: "Cafe", observedAtSimMs: 0 })!;
  updateActorContinuation(f.world, f.actor, next, "needs_revision", "external_control_edit");
  expect(captureActorIntentionEvidence(f.world).records.some(r => r.kind === "selected_purpose")).toBe(false);
});

test("an already-revoked intention never revives when its text is restored", () => {
  const f = fixture(), description = Goal.description[f.goal]; Goal.description[f.goal] = "Changed";
  expect(f.observations.bind([f.ref])?.()).toBe(false); Goal.description[f.goal] = description;
  expect(f.observations.bind([f.ref])?.()).toBe(false);
});

test("binding reports exact invalidated references without diagnostic reads revalidating or reviving them", () => {
  const f = fixture(), second = createIntentGoal(f.world, f.actor, "Keep a different commitment", 6);
  const evidence = captureActorIntentionEvidence(f.world);
  const refs = evidence.records.map(r => r.ref), binding = evidence.bind(refs)!;
  const secondRef = evidence.records.find(r => r.goalKey === WorkingMemoryIdentity.id[second])!.ref;
  expect(binding()).toBe(true);
  Goal.status[second] = "paused";
  // Diagnostics read only the last validation, not the changed world.
  expect(binding.invalidatedReferences()).toEqual([]);
  expect(binding()).toBe(false);
  expect(binding.invalidatedReferences()).toEqual([secondRef]);
  Goal.status[second] = "active";
  expect(binding()).toBe(false);
  expect(binding.invalidatedReferences()).toEqual([secondRef]);
  expect(evidence.bind(["intention:invented"])).toBeUndefined();
});

test("native recovery lineage survives a new step/review but not a new purpose or owner", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Walk toward dinner", actionType: "wait", goalId: f.goal,
    goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: 0 });
  const original = captureActorIntentionEvidence(f.world);
  const step = original.records.find(row => row.kind === "selected_purpose")!;
  const goal = original.records.find(row => row.kind === "goal")!;
  expect(original.getDemandKeys(step.ref)).toEqual(original.getDemandKeys(goal.ref));
  expect(original.getDemandKeys("intention:invented")).toEqual([]);
  integrateActorContinuation(f.world, f.actor, { purpose: "Pause to find my coat", actionType: "wait", goalId: f.goal,
    goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: 0 });
  Goal.priority[f.goal] = 9;
  const fresh = captureActorIntentionEvidence(f.world), freshGoal = fresh.records.find(row => row.kind === "goal")!;
  expect(original.bind([step.ref])?.()).toBe(false);
  expect(fresh.getDemandKeys(freshGoal.ref)).toEqual(original.getDemandKeys(step.ref));
  expect(fresh.bind([freshGoal.ref])?.()).toBe(true);
  Goal.description[f.goal] = "Stack furniture for an experiment";
  const changed = captureActorIntentionEvidence(f.world);
  expect(changed.getDemandKeys(changed.records.find(row => row.kind === "goal")!.ref)).not.toEqual(original.getDemandKeys(step.ref));
  Goal.description[f.goal] = "Meet a friend for dinner";
  WorkingMemoryIdentity.id[f.actor] = "replacement";
  const replaced = captureActorIntentionEvidence(f.world);
  expect(replaced.getDemandKeys(replaced.records.find(row => row.kind === "goal")!.ref)).not.toEqual(original.getDemandKeys(step.ref));
  expect(JSON.stringify(original.records)).not.toContain(original.getDemandKeys(step.ref)[0]);
});
