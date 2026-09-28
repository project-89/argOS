import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { Goal, GoalLifecycle, Plan, WorkingMemoryIdentity } from "../../ecs/components";
import { HasPlan } from "../../ecs/relations";
import { createPersonalIntention, createGeneratedIntention } from "../goal-lifecycle";
import { workingMemoryEntityRef } from "../working-memory";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { captureIntentionReconsideration, prepareIntentionReconsideration, RECONSIDERATION_INSTRUCTION } from "../intention-reconsideration";
import { createCommunicationMotivation } from "../communication-motivation";
import { captureGoalReviewContext, prepareGoalReview } from "../goal-pursuit";
import { getCoordinationGoalRef } from "../coordination-memory";
import { captureActorIntentionEvidence } from "../../spirits/actor-intention-evidence";
import { integrateActorContinuation } from "../actor-continuation";
import { snapshotActorContinuation } from "../actor-continuation";
import { snapshotOngoingActivity } from "../ongoing-activity";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { bindSupportingGoal } from "../goal-dependents";

test.each([false, true])("saved refine-plus-reprioritize shape rejects atomically in either order: %s", reverse => {
  const f = fixture(), description = Goal.description[f.goal], priority = Goal.priority[f.goal];
  const edits = [
    { goalId: f.goal, disposition: "refine", edits: [{ op: "replace", before: description, after: "Choose a concrete meeting place" }], reason: "I chose the details" },
    { goalId: f.goal, disposition: "reprioritize", priority: 9, reason: "It matters more now" },
  ];
  expect(prepareIntentionReconsideration(f.context(), reverse ? edits.reverse() : edits)).toBeUndefined();
  expect(Goal.description[f.goal]).toBe(description); expect(Goal.priority[f.goal]).toBe(priority);
  expect(RECONSIDERATION_INSTRUCTION).toContain("at most one entry per goalId");
  expect(prepareIntentionReconsideration(f.context(), [edits[0]])).toBeDefined();
  expect(prepareIntentionReconsideration(f.context(), [edits[1]])).toBeDefined();
});

test.each(["release", "withdraw"] as const)("background %s ends its organizing activity and dependent strategies without claiming success", disposition => {
  const f = fixture();
  if (disposition === "withdraw") GoalLifecycle.persistence[f.goal] = "standing";
  const child = createPersonalIntention(f.world, f.actor, "Collect material for the argument", 6)!;
  const grandchild = createPersonalIntention(f.world, f.actor, "Find the notebook", 5)!;
  bindSupportingGoal(f.world, f.actor, child, f.goal);
  bindSupportingGoal(f.world, f.actor, grandchild, child);
  const childPlan = addEntity(f.world); addComponent(f.world, childPlan, Plan); addComponent(f.world, f.actor, HasPlan(childPlan));
  Plan.goalEid[childPlan] = child; Plan.status[childPlan] = "active";
  integrateActorContinuation(f.world, f.actor, { purpose: "Pursue the argument", actionType: "think",
    goalId: f.goal, observedAtSimMs: 0 });
  const previous = snapshotOngoingActivity(f.world, f.actor)!;
  const prepared = prepareIntentionReconsideration(f.context(), [{ goalId: f.goal, disposition,
    reason: "I no longer want this argument." }])!;
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(previous);
  expect(prepared.commit()).toBe(true);
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: previous.id, status: "ended" });
  for (const id of [f.goal, child, grandchild]) {
    expect(Goal.status[id]).toBe("retired"); expect(Goal.progress[id]).toBe(0);
  }
  expect(Plan.status[f.plan]).toBe("retired"); expect(Plan.status[childPlan]).toBe("retired");
  expect(Goal.status[f.second]).toBe("active"); expect(Goal.status[f.peer]).toBe("active");
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a side remark", actionType: "speak", observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("ended");
  integrateActorContinuation(f.world, f.actor, { purpose: "Seek my friend's explanation", actionType: "think",
    goalId: f.second, observedAtSimMs: 0 });
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ status: "active", needsRevalidation: false,
    goalKey: WorkingMemoryIdentity.id[f.second] });
  expect(snapshotOngoingActivity(f.world, f.actor)?.id).not.toBe(previous.id);
});

test("background release of a side intention leaves the organizing activity unchanged", () => {
  const f = fixture();
  integrateActorContinuation(f.world, f.actor, { purpose: "Pursue the argument", actionType: "think",
    goalId: f.goal, observedAtSimMs: 0 });
  const before = snapshotOngoingActivity(f.world, f.actor)!;
  expect(prepareIntentionReconsideration(f.context(), [{ goalId: f.second, disposition: "release",
    reason: "I no longer need an explanation." }])?.commit()).toBe(true);
  expect(snapshotOngoingActivity(f.world, f.actor)).toEqual(before);
  expect(Plan.status[f.plan]).toBe("active");
});

test.each(["release", "refine"] as const)("%s of a parent also ends an organizing activity owned by its retired strategy", disposition => {
  const f = fixture();
  bindSupportingGoal(f.world, f.actor, f.second, f.goal);
  integrateActorContinuation(f.world, f.actor, { purpose: "Ask for evidence supporting my argument", actionType: "think",
    goalId: f.second, observedAtSimMs: 0 });
  const edit = disposition === "release" ? { goalId: f.goal, disposition, reason: "I no longer want the argument." }
    : { goalId: f.goal, disposition, edits: [{ op: "append", text: "Only use published evidence." }], reason: "I changed my approach." };
  expect(prepareIntentionReconsideration(f.context(), [edit])?.commit()).toBe(true);
  expect(Goal.status[f.second]).toBe("retired"); expect(Goal.progress[f.second]).toBe(0);
  expect(snapshotOngoingActivity(f.world, f.actor)?.status).toBe("ended");
  expect(Goal.status[f.goal]).toBe(disposition === "release" ? "retired" : "active");
});

test.each([false, true])("a parent release conflicting with a child revision rejects atomically (reverse=%s)", reverse => {
  const f = fixture(); bindSupportingGoal(f.world, f.actor, f.second, f.goal);
  const rows = [{ goalId: f.goal, disposition: "release", reason: "No longer wanted." },
    { goalId: f.second, disposition: "reprioritize", priority: 10, reason: "More important." }];
  expect(prepareIntentionReconsideration(f.context(), reverse ? rows.reverse() : rows)).toBeUndefined();
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.status[f.second]).toBe("active");
  expect(Goal.priority[f.second]).toBe(9); expect(Plan.status[f.plan]).toBe("active");
});

test.each(["appraisal", "foreground"])("%s distinguishes finishing a task from withdrawing a standing desire", path => {
  const f = fixture();
  const motivation = createCommunicationMotivation(f.world, f.actor, {
    description: "Keep in touch", memory: "My phone connects me to friends.",
  });
  const prepare = (disposition: string) => path === "appraisal"
    ? prepareIntentionReconsideration(f.context(), [{ goalId: motivation.goal, disposition, reason: "My decision." }])
    : prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: motivation.goal, disposition, reason: "My decision." });
  motivation.readCommunication({ unreadRemaining: false });
  expect(prepare("release")).toBeUndefined();
  motivation.noticeNotification();
  expect(Goal.status[motivation.goal]).toBe("active");
  expect(Goal.priority[motivation.goal]).toBe(8);
  expect(prepare("withdraw")?.commit()).toBe(true);
  motivation.noticeNotification();
  expect(Goal.status[motivation.goal]).toBe("retired");
  expect(Goal.progress[motivation.goal]).toBe(0);
});

test("standing task-release rejects a mixed appraisal atomically", () => {
  const f = fixture(); GoalLifecycle.persistence[f.second] = "standing";
  expect(prepareIntentionReconsideration(f.context(), f.edits)).toBeUndefined();
  expect(Goal.priority[f.goal]).toBe(7);
  expect(Goal.status[f.second]).toBe("active");
  expect(f.context().intentions.find(g => g.goalId === f.second)).toMatchObject({
    persistence: "standing", operations: ["reprioritize", "withdraw"],
  });
});

test.each(["appraisal", "foreground"])("%s fences a late persistence change and rejects episodic withdrawal", path => {
  const f = fixture();
  const prepare = (disposition: string) => path === "appraisal"
    ? prepareIntentionReconsideration(f.context(), [{ goalId: f.goal, disposition, reason: "My decision." }])
    : prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: f.goal, disposition, reason: "My decision." });
  expect(prepare("withdraw")).toBeUndefined();
  const draft = prepare("release")!;
  GoalLifecycle.persistence[f.goal] = "standing";
  expect(draft.current()).toBe(false); expect(draft.commit()).toBe(false);
  expect(Goal.status[f.goal]).toBe("active");
});

function fixture() {
  const world = createArgosWorld("Revise purposes"); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "resident", systemPrompt: "Act on experience", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "resident", systemPrompt: "Private", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, other);
  const goal = createPersonalIntention(world, actor, "Win a trivial argument", 7)!;
  const second = createPersonalIntention(world, actor, "Get an explanation from a friend", 9)!;
  const peer = createPersonalIntention(world, other, "PRIVATE_PEER_GOAL", 8)!;
  const plan = addEntity(world); addComponent(world, plan, Plan); addComponent(world, actor, HasPlan(plan));
  Plan.goalEid[plan] = goal; Plan.status[plan] = "active";
  const edits = [{ goalId: goal, disposition: "reprioritize", priority: 2, reason: "I have something more important to deal with." },
    { goalId: second, disposition: "release", reason: "I no longer want to pursue that particular response." }];
  return { world, actor, other, goal, second, peer, plan, edits,
    context: () => captureIntentionReconsideration(world, actor) };
}
beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(100_000); });
afterEach(() => { jest.useRealTimers(); });

test("refinement cannot silently replace an entire intention with a lossy summary", () => {
  const f=fixture();
  const goal=createPersonalIntention(f.world,f.actor,"Meet Lin at the Orchard restaurant on Mercer Street for dinner",7)!;
  const before=JSON.stringify([Goal.description[goal],Goal.paramsJson[goal],Goal.signature[goal]]);
  const draft=prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",
    description:"Text Lin that I am on my way and head to Orchard",reason:"I should answer before leaving"}]);
  expect(draft).toBeUndefined();
  expect(JSON.stringify([Goal.description[goal],Goal.paramsJson[goal],Goal.signature[goal]])).toBe(before);
});

test("a refinement edits chosen details while preserving the unmentioned purpose and constraints", () => {
  const f=fixture();
  const goal=createPersonalIntention(f.world,f.actor,"Meet Lin at the Orchard restaurant on Mercer Street for dinner",7)!;
  const key=WorkingMemoryIdentity.id[goal];
  const draft=prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",edits:[
    {op:"replace",before:"Orchard",after:"Riverside"},
    {op:"append",text:"Bring my notebook."}
  ],reason:"The meeting place changed, and I want my notes with me"}]);
  expect(draft).toBeDefined(); expect(draft!.commit()).toBe(true);
  expect(Goal.description[goal]).toBe("Meet Lin at the Riverside restaurant on Mercer Street for dinner Bring my notebook.");
  expect(captureActorIntentionEvidence(f.world).records.find(r=>r.goalKey===key&&r.kind==="goal")?.description).toBe(Goal.description[goal]);
  expect(Goal.status[goal]).toBe("active"); expect(Goal.progress[goal]).toBe(0);
});

test.each([
  ["missing anchor",[{op:"replace",before:"not in this intention",after:"Changed"}]],
  ["ambiguous anchor",[{op:"replace",before:"Lin",after:"Ada"}]],
  ["overlapping anchors",[{op:"replace",before:"Meet Lin",after:"Greet Lin"},{op:"replace",before:"Meet",after:"Visit"}]],
  ["sequential anchor",[{op:"replace",before:"Orchard",after:"Riverside"},{op:"replace",before:"Riverside",after:"Market"}]],
  ["duplicate append",[{op:"append",text:"Bring a notebook."},{op:"append",text:"Bring a pen."}]],
  ["empty anchor",[{op:"replace",before:"",after:"Changed"}]],
  ["no change",[{op:"replace",before:"Orchard",after:"Orchard"}]],
  ["control character",[{op:"append",text:"Bad\u0000detail"}]],
  ["overflow",[{op:"append",text:"x".repeat(300)}]],
  ["unknown field",[{op:"append",text:"Bring a notebook.",success:true}]],
  ["too many edits",Array.from({length:5},()=>({op:"replace",before:"Orchard",after:"Riverside"}))],
] as const)("invalid refinement %s leaves every intention and plan in a mixed batch unchanged", (_name,edits) => {
  const f=fixture(), goal=createPersonalIntention(f.world,f.actor,"Meet Lin at Orchard and bring Lin the notebook",7)!;
  const before=JSON.stringify([Goal.description[goal],Goal.paramsJson[goal],Goal.signature[goal],Goal.priority[f.goal],Plan.status[f.plan]]);
  expect(prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",edits,reason:"My choice"},f.edits[0]])).toBeUndefined();
  expect(JSON.stringify([Goal.description[goal],Goal.paramsJson[goal],Goal.signature[goal],Goal.priority[f.goal],Plan.status[f.plan]])).toBe(before);
});

test("edits use the captured definition irrespective of array order and permit an explicit change of mind", () => {
  const f=fixture(), goal=createPersonalIntention(f.world,f.actor,"Meet Lin at Orchard for dinner",7)!;
  const draft=prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",edits:[
    {op:"append",text:"Take a walk instead."}, {op:"replace",before:" for dinner",after:""},
    {op:"replace",before:"Orchard",after:"Riverside"}
  ],reason:"We deliberately changed the evening from a meal to a walk"}])!;
  expect(draft.refinedDescription(goal)).toBe("Meet Lin at Riverside Take a walk instead.");
  expect(draft.refinedDescription(f.second)).toBeUndefined();
  expect(draft.commit()).toBe(true);
  expect(Goal.description[goal]).toBe("Meet Lin at Riverside Take a walk instead.");
  expect(Goal.description[goal]).not.toContain("dinner");
  expect(Goal.status[goal]).toBe("active");
});

test("append refinements are copied, source-fenced, and retained through save/restore in the existing Goal contract", () => {
  const f=fixture(), goal=createPersonalIntention(f.world,f.actor,"Visit Orchard for dinner",7)!;
  const stale=prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",edits:[{op:"append",text:"At seven."}],reason:"Choose the time"}])!;
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  expect(stale.current()).toBe(false); expect(stale.commit()).toBe(false);
  const edit={op:"append",text:"Bring my notes."};
  const draft=prepareIntentionReconsideration(f.context(),[{goalId:goal,disposition:"refine",edits:[edit],reason:"Prepare for the conversation"}])!;
  edit.text="An unrelated instruction";
  expect(draft.commit()).toBe(true);
  const saved=structuredClone(serializeWorld(f.world,createSystemRegistry()));
  stopCommittedEvents(f.world);
  const restored=createArgosWorld("Restored details"), {oldToNewId}=deserializeWorld(restored,createSystemRegistry(),saved);
  startCommittedEvents(restored);
  const current=oldToNewId.get(goal)!;
  expect(Goal.description[current]).toBe("Visit Orchard for dinner Bring my notes.");
  expect(JSON.parse(Goal.paramsJson[current])).toEqual({description:Goal.description[current],intentionRevision:1});
});

test("reorganization preserves priority-only plans and retires released intentions without claiming completion", () => {
  const f = fixture(); Goal.progress[f.goal] = 35; Goal.status[f.second] = "paused"; GoalLifecycle.deferredJson[f.second] = "historical wake";
  const definition = Goal.successJson[f.goal], draft = prepareIntentionReconsideration(f.context(), f.edits)!;
  expect(Goal.priority[f.goal]).toBe(7); expect(Plan.status[f.plan]).toBe("active");
  expect(draft.commit()).toBe(true); expect(draft.commit()).toBe(false);
  expect(Goal.priority[f.goal]).toBe(2); expect(Goal.progress[f.goal]).toBe(35); expect(Goal.status[f.goal]).toBe("active");
  expect(Goal.successJson[f.goal]).toBe(definition); expect(Plan.status[f.plan]).toBe("active");
  expect(Goal.status[f.second]).toBe("retired"); expect(GoalLifecycle.deferredJson[f.second]).toBe("");
  expect(Goal.progress[f.second]).toBe(0); expect(Goal.status[f.peer]).toBe("active");
});

test.each(["assigned", "verified", "physical", "completed", "peer"])("%s intentions are not editable", kind => {
  const f = fixture();
  if (kind === "assigned") GoalLifecycle.source[f.goal] = "authored";
  if (kind === "verified") GoalLifecycle.mode[f.goal] = "verified";
  if (kind === "physical") Goal.successJson[f.goal] = JSON.stringify({ type: "in_room", roomName: "Hall" });
  if (kind === "completed") Goal.status[f.goal] = "completed";
  const id = kind === "peer" ? f.peer : f.goal;
  const context = f.context(); expect(context.intentions.map(g => g.goalId)).not.toContain(id);
  expect(JSON.stringify(context.intentions)).not.toContain("PRIVATE_PEER_GOAL");
  expect(prepareIntentionReconsideration(context, [{ ...f.edits[0], goalId: id }])).toBeUndefined();
});

test.each(["priority", "progress", "identity", "source", "mode", "definition", "status"])("a late %s change rejects the entire batch", kind => {
  const f = fixture(), draft = prepareIntentionReconsideration(f.context(), f.edits)!;
  if (kind === "priority") Goal.priority[f.second] = 10;
  if (kind === "progress") Goal.progress[f.second] = 10;
  if (kind === "identity") WorkingMemoryIdentity.id[f.second] = "replacement";
  if (kind === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (kind === "mode") GoalLifecycle.mode[f.second] = "verified";
  if (kind === "definition") Goal.description[f.second] = "Different desire";
  if (kind === "status") Goal.status[f.second] = "completed";
  expect(draft.current()).toBe(false); expect(draft.commit()).toBe(false);
  expect(Goal.priority[f.goal]).toBe(7); expect(Plan.status[f.plan]).toBe("active");
});

test.each(["duplicate", "foreign", "too many", "invalid priority", "extra field", "release priority", "empty"])("invalid batch %s writes nothing", kind => {
  const f = fixture(); let edits: unknown = f.edits;
  if (kind === "duplicate") edits = [f.edits[0], f.edits[0]];
  if (kind === "foreign") edits = [f.edits[0], { ...f.edits[1], goalId: f.peer }];
  if (kind === "too many") edits = [...f.edits, ...f.edits];
  if (kind === "invalid priority") edits = [{ ...f.edits[0], priority: 100 }];
  if (kind === "extra field") edits = [{ ...f.edits[0], success: true }];
  if (kind === "release priority") edits = [{ ...f.edits[1], priority: 1 }];
  if (kind === "empty") edits = [];
  expect(prepareIntentionReconsideration(f.context(), edits)).toBeUndefined();
  expect(Goal.priority[f.goal]).toBe(7); expect(Goal.status[f.second]).toBe("active");
});

test("edits are copied at preparation, and another newly created intention does not invalidate an independent batch", () => {
  const f = fixture(), draft = prepareIntentionReconsideration(f.context(), f.edits)!;
  f.edits[0].priority = 10;
  createPersonalIntention(f.world, f.actor, "Choose how to spend my evening", 9);
  expect(draft.commit()).toBe(true); expect(Goal.priority[f.goal]).toBe(2);
});

test("an actor can refine the same personal goal into a durable concrete commitment", () => {
  const f = fixture(), key = WorkingMemoryIdentity.id[f.goal], before = getCoordinationGoalRef(f.world, f.actor, f.goal);
  const oldEvidence = captureActorIntentionEvidence(f.world);
  expect(f.context().intentions.find(g => g.goalId === f.goal)?.operations).toContain("refine");
  const description = "Meet my friend at the Orchard cafe after collecting my coat";
  const draft = prepareIntentionReconsideration(f.context(), [{ goalId: f.goal, disposition: "refine", edits:[{op:"replace",before:Goal.description[f.goal],after:description}],
    reason: "I have chosen where to spend the evening." }]);
  expect(draft).toBeDefined();
  expect(Goal.description[f.goal]).toBe("Win a trivial argument");
  expect(draft!.commit()).toBe(true); expect(draft!.commit()).toBe(false);
  expect(WorkingMemoryIdentity.id[f.goal]).toBe(key);
  expect(Goal.description[f.goal]).toBe(description);
  expect(JSON.parse(Goal.paramsJson[f.goal])).toMatchObject({ description, intentionRevision: 1 });
  expect(getCoordinationGoalRef(f.world, f.actor, f.goal)?.signature).not.toBe(before?.signature);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(Plan.status[f.plan]).toBe("retired");
  expect(oldEvidence.bind(oldEvidence.records.map(r => r.ref))?.()).toBe(false);
  const chosen = captureActorIntentionEvidence(f.world);
  const ref = chosen.records.find(r => r.goalKey === key)!.ref;
  integrateActorContinuation(f.world, f.actor, { purpose: "Answer a short message before continuing", actionType: "wait", observedAtSimMs: 0 });
  expect(chosen.bind([ref])?.()).toBe(true);
  expect(captureActorIntentionEvidence(f.world).records.find(r => r.goalKey === key)?.description).toBe(description);
});

test("returning to the same wording does not revive a previous goal revision's authority", () => {
  const f = fixture();
  const refine = (description: string) => prepareIntentionReconsideration(f.context(), [{ goalId:f.goal,
    disposition:"refine", edits:[{op:"replace",before:Goal.description[f.goal],after:description}], reason:"I have reconsidered the details." }])!.commit();
  refine("Meet a friend at Orchard");
  const a = captureActorIntentionEvidence(f.world), ref = a.records.find(r => r.goalKey === WorkingMemoryIdentity.id[f.goal])!.ref;
  const signature = getCoordinationGoalRef(f.world, f.actor, f.goal)!.signature;
  refine("Meet a friend at Riverside"); refine("Meet a friend at Orchard");
  expect(JSON.parse(Goal.paramsJson[f.goal]).intentionRevision).toBe(3);
  expect(a.bind([ref])?.()).toBe(false);
  expect(getCoordinationGoalRef(f.world, f.actor, f.goal)!.signature).not.toBe(signature);
});

test.each(["standing", "paused", "unchanged", "physical", "assigned", "bad params", "unexpected params", "bad revision", "overflow", "extra field"])(
  "refinement rejects %s without modifying the batch", invalid => {
    const f = fixture();
    if (invalid === "standing") GoalLifecycle.persistence[f.goal] = "standing";
    if (invalid === "paused") Goal.status[f.goal] = "paused";
    if (invalid === "physical") Goal.successJson[f.goal] = JSON.stringify({ type:"in_room", roomName:"Hall" });
    if (invalid === "assigned") GoalLifecycle.source[f.goal] = "authored";
    if (invalid === "bad params") Goal.paramsJson[f.goal] = "[]";
    if (["unexpected params", "bad revision", "overflow"].includes(invalid)) Goal.paramsJson[f.goal] = JSON.stringify({
      description:Goal.description[f.goal], ...(invalid === "unexpected params" ? { unrelatedContractField:true }
        : { intentionRevision:invalid === "bad revision" ? -1 : Number.MAX_SAFE_INTEGER }) });
    const row = { goalId:f.goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[f.goal],after:invalid === "unchanged" ? Goal.description[f.goal] : "Meet a friend at Orchard"}],
      reason:"An actor choice", ...(invalid === "extra field" ? { priority:10 } : {}) };
    const before = JSON.stringify([Goal.description[f.goal], Goal.paramsJson[f.goal], Goal.status[f.goal], Goal.progress[f.goal], Plan.status[f.plan]]);
    expect(prepareIntentionReconsideration(f.context(), [row, { goalId:f.second, disposition:"reprioritize", priority:1, reason:"Less urgent" }])).toBeUndefined();
    expect(JSON.stringify([Goal.description[f.goal], Goal.paramsJson[f.goal], Goal.status[f.goal], Goal.progress[f.goal], Plan.status[f.plan]])).toBe(before);
    expect(Goal.priority[f.second]).toBe(9);
  });

test("refining a parent retires old dependent strategies but does not claim their physical work", () => {
  const f = fixture();
  const child = createGeneratedIntention(f.world, f.actor, { description:"Find the old meeting point", priority:5, supportsGoalId:f.goal }, "foreground")!;
  const grandchild = createGeneratedIntention(f.world, f.actor, { description:"Inspect the old route", priority:5, supportsGoalId:child }, "foreground")!;
  expect(child).not.toBeNull(); expect(grandchild).not.toBeNull();
  const refine = { goalId:f.goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[f.goal],after:"Meet at Orchard instead"}], reason:"I chose another meeting point" };
  expect(prepareIntentionReconsideration(f.context(), [refine, { goalId:child, disposition:"reprioritize", priority:2, reason:"Less urgent" }])).toBeUndefined();
  const draft = prepareIntentionReconsideration(f.context(), [refine])!;
  expect(draft.commit()).toBe(true);
  expect(Goal.status[child]).toBe("retired"); expect(Goal.status[grandchild]).toBe("retired");
  expect(Goal.progress[child]).toBe(0); expect(Goal.progress[grandchild]).toBe(0);
  expect(Goal.status[f.second]).toBe("active");
});

test("refinement removes an obsolete completion hint, preserves success law and deadlines, and copies its input", () => {
  const f = fixture(), success = Goal.successJson[f.goal], deadline = Goal.deadline[f.goal];
  Goal.paramsJson[f.goal] = JSON.stringify({ description:Goal.description[f.goal], completionHint:{ authoritative:false, description:"Old clue" } });
  const row = { goalId:f.goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[f.goal],after:"Explore the new meeting point"}], reason:"New details matter" };
  const draft = prepareIntentionReconsideration(f.context(), [row])!;
  row.edits[0].after = "Mutated after preparation";
  expect(draft.commit()).toBe(true);
  expect(Goal.description[f.goal]).toBe("Explore the new meeting point");
  expect(JSON.parse(Goal.paramsJson[f.goal]).completionHint).toBeUndefined();
  expect(Goal.successJson[f.goal]).toBe(success); expect(Goal.deadline[f.goal]).toBe(deadline);
});

test("save/restore retains the refined goal contract but never reauthorizes old actor control", () => {
  const f = fixture();
  const description = "Meet a friend at Orchard";
  expect(prepareIntentionReconsideration(f.context(), [{ goalId:f.goal, disposition:"refine", edits:[{op:"replace",before:Goal.description[f.goal],after:description}], reason:"I chose the meeting point" }])!.commit()).toBe(true);
  integrateActorContinuation(f.world, f.actor, { purpose:"Get ready for Orchard", actionType:"wait", goalId:f.goal,
    goalKey:WorkingMemoryIdentity.id[f.goal], observedAtSimMs:0 });
  const key = WorkingMemoryIdentity.id[f.goal], contract = Goal.paramsJson[f.goal];
  const observation = captureActorIntentionEvidence(f.world);
  const saved = structuredClone(serializeWorld(f.world,createSystemRegistry()));
  stopCommittedEvents(f.world);
  const restored = createArgosWorld("Restored commitment");
  const { oldToNewId } = deserializeWorld(restored,createSystemRegistry(),saved);
  startCommittedEvents(restored);
  const goal = oldToNewId.get(f.goal)!, actor = oldToNewId.get(f.actor)!;
  expect(WorkingMemoryIdentity.id[goal]).toBe(key);
  expect(Goal.description[goal]).toBe(description); expect(Goal.paramsJson[goal]).toBe(contract);
  expect(snapshotActorContinuation(restored,actor)?.status).toBe("needs_revision");
  expect(snapshotOngoingActivity(restored,actor)?.needsRevalidation).toBe(true);
  expect(observation.bind(observation.records.map(r=>r.ref))?.()).toBe(false);
  const current = captureActorIntentionEvidence(restored);
  expect(current.records.find(r=>r.goalKey === key && r.kind === "goal")?.description).toBe(description);
  expect(current.records.some(r=>r.kind === "selected_purpose")).toBe(false);
});
