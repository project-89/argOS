import { jest } from "@jest/globals";
import { addComponent, addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, createObjectEntity, initializePrefabs } from "../../ecs/prefabs";
import { Goal, Plan, ObjectState, WikiDoc, WorkDocument } from "../../ecs/components";
import { HasGoal, HasPlan } from "../../ecs/relations";
import { setLocatedIn, getDirectContainer } from "../../ecs/location";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { advancePlanStep, createPlanEntity, generatePlanForGoal, hasPendingPlanning, runPlanningSystem, reconcileCurrentPlan, type GeneratedPlan, type PlanStep } from "../planning-system";
import { recordCommittedSpeech } from "../social-memory";
import { initializeWorkDocument, readProductiveGoalTime } from "../../world/productive-work";
import { startCommittedEvents } from "../../runtime/committed-events";
import { executeActions } from "../cognition-system";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { recordInspectionResult } from "../inspection-memory";
import { createPersonalIntention } from "../goal-lifecycle";
import { getWorkingMemory } from "../working-memory";
import { settledReview } from "../../evals/post-quiet-disturbance";
import { getPrivateCommunications, recordPrivateCommunication } from "../communication-memory";
import { getCommittedEvents } from "../../runtime/committed-events";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";

beforeEach(() => { jest.useFakeTimers().setSystemTime(100_000); jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
function fixture(proof: unknown = { type: "productive_time", roomName: "Reading room", atLeastMs: 3600_000 }) {
  const world = createArgosWorld("Continuing work"); initializePrefabs(world); world.meta.aiEnabled = true;
  startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Reading room" }), hall = createRoomEntity(world, { name: "Hall" });
  const reservoir = createObjectEntity(world, { name: "Reservoir", roomId: room, portable: false });
  addComponent(world, reservoir, ObjectState); ObjectState.current[reservoir] = "empty";
  const actor = createAgentEntity(world, { name: "Mara", role: "caretaker", systemPrompt: "Choose my own work.", roomId: room });
  const peer = createAgentEntity(world, { name: "Ivo", role: "visitor", systemPrompt: "Report what I know.", roomId: room });
  const goal = addEntity(world); addComponent(world, goal, Goal); addComponent(world, actor, HasGoal(goal));
  Goal.description[goal] = "Look after the Reading room and Reservoir"; Goal.kind[goal] = "custom";
  Goal.paramsJson[goal] = "{}"; Goal.successJson[goal] = JSON.stringify(proof);
  Goal.status[goal] = "active"; Goal.priority[goal] = 5; Goal.createdAt[goal] = Date.now(); Goal.progress[goal] = 0;
  const steps: PlanStep[] = [{ description: "Review the Reservoir duties", actionType: "think", content: "Keep the room safe." },
    { description: "Consider ongoing upkeep", actionType: "think", content: "Maintain the Reading room." }];
  const proposal: GeneratedPlan = { goalDescription: Goal.description[goal], steps, estimatedCompletion: "short", potentialObstacles: [] };
  const plan = createPlanEntity(world, actor, goal, proposal);
  const finish = () => { advancePlanStep(plan, { world, agentEid: actor }); advancePlanStep(plan, { world, agentEid: actor }); };
  const tick = () => { jest.setSystemTime(Date.now() + 10_000); advanceSimulationTime(world, world.time.tick + 1, 10_000); };
  return { world, room, hall, actor, peer, goal, plan, proposal, finish, tick, reservoir };
}

test("a completed upkeep review does not regenerate plans every two seconds", async () => {
  const f = fixture(); f.finish(); const generator = jest.fn(async () => f.proposal);
  for (let n = 0; n < 20; n++) {
    f.tick();
    expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
    await runPlanningSystem(f.world, { background: true, agentEids: [f.actor], planGenerator: generator });
  }
  expect(generator).not.toHaveBeenCalled();
  expect(Plan.status[f.plan]).toBe("completed");
  expect(Goal.status[f.goal]).toBe("active");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(0);
});

function documentReviewFixture(proof?: unknown) {
  const f = fixture(proof); f.world.meta.timedActions = true;
  Plan.status[f.plan] = "failed"; f.tick();
  const document = createObjectEntity(f.world, { name: "Evening notes", roomId: f.room, portable: true });
  initializeWorkDocument(f.world, document); WikiDoc.body[document] = "The room is ready.";
  const registry = createSystemRegistry();
  const steps: PlanStep[] = [
    { description: "Read the Evening notes", actionType: "interact", target: "Evening notes", content: "read_document" },
    { description: "Consider the remaining work", actionType: "think", content: "The assessment is done; the work period remains open." },
  ];
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal, steps });
  const act = (content: string, who = f.actor) => executeActions(f.world,
    [{ eid: who, action: { type: "interact", target: "Evening notes", content } }], registry);
  const advance = (ms: number) => advanceSimulationTimeline(f.world, ms, { integrate: () => {} });
  const finish = () => {
    act("read_document"); advance(1199);
    expect(Plan.currentStep[plan]).toBe(0);
    advance(1); expect(Plan.currentStep[plan]).toBe(1);
    executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: steps[1].content } }], registry);
    expect(Plan.status[plan]).toBe("completed"); f.tick();
  };
  return { ...f, document, plan, act, advance, finish };
}

test.each(["sustained", "narrative"])("a real completed document assessment holds %s replanning without pretending it did productive work", async kind => {
  const f = documentReviewFixture(kind === "narrative" ? { type: "custom", description: "Prepare for the evening." } : undefined);
  WikiDoc.status[f.document] = "finished"; ObjectState.current[f.document] = "finished";
  f.finish();
  const generator = jest.fn(async () => f.proposal);
  for (let n = 0; n < 20; n++) {
    f.tick();
    expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
    await runPlanningSystem(f.world, { background: true, agentEids: [f.actor], planGenerator: generator });
  }
  // Choosing to reread is permitted, but an identical own receipt is not new work demand.
  f.act("read_document"); f.advance(1200); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  expect(generator).not.toHaveBeenCalled();
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(0);
});

test("an accessible new document revision reopens assessment without revealing unread content", async () => {
  const f = documentReviewFixture(); f.finish();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  drainPendingStimuli();
  f.act('write_document {"revision":0,"text":"PRIVATE_NEW_INSTRUCTION"}', f.peer); f.advance(2000); f.tick();
  expect(WorkDocument.revision[f.document]).toBe(1);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
  expect(peekPendingStimuli().some(s => s.targetEid === f.actor && s.content.includes("PRIVATE_NEW_INSTRUCTION"))).toBe(false);
  let prompt = "";
  await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: (async (input: { prompt: string; system: string }) => {
    prompt = input.system + input.prompt; return { text: JSON.stringify(f.proposal) };
  }) as any });
  expect(prompt).toContain("revision 1"); expect(prompt).not.toContain("PRIVATE_NEW_INSTRUCTION");
  f.act("read_document"); f.advance(1200);
  expect(peekPendingStimuli().some(s => s.targetEid === f.actor && s.content.includes("PRIVATE_NEW_INSTRUCTION"))).toBe(true);
  drainPendingStimuli();
});

test("a finite physical objective still needs planning after a document assessment", () => {
  const f = documentReviewFixture({ type: "in_room", roomName: "Hall" }); f.finish();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test.each(["lost access", "ambiguous name"])("a completed document review reopens on %s", change => {
  const f = documentReviewFixture(); f.finish();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  if (change === "lost access") setLocatedIn(f.world, f.document, f.hall);
  else createObjectEntity(f.world, { name: "Evening notes", roomId: f.room, portable: true });
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("an executed document read followed by a covered inspection retains assessment completion", () => {
  const f = documentReviewFixture(); Plan.status[f.plan] = "failed"; f.tick();
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal, steps: [
    { description: "Read the Evening notes", actionType: "interact", target: "Evening notes", content: "read_document" },
    { description: "Check the Reservoir", actionType: "observe", target: "Reservoir" },
  ] });
  f.act("read_document"); f.advance(1200);
  expect(Plan.currentStep[plan]).toBe(1);
  recordInspectionResult(f.world, f.actor, f.reservoir);
  expect(reconcileCurrentPlan(f.world, f.actor, plan)).toBe(1);
  expect(Plan.status[plan]).toBe("completed"); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(0);
});

test.each(["write_document", "review_document", "finish_document"])("%s is an actual physical stage, not an evidence-held assessment", verb => {
  const f = documentReviewFixture(); Plan.status[f.plan] = "failed"; f.tick();
  if (verb === "finish_document") { WorkDocument.reviewedRevision[f.document] = 0; WikiDoc.status[f.document] = "reviewed"; }
  const content = `${verb} ${JSON.stringify({ revision: 0, ...(verb === "write_document" ? { text: "New work." } : {}) })}`;
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [{ description: "Work on the Evening notes", actionType: "interact", target: "Evening notes", content }] });
  f.act(content); f.advance(verb === "finish_document" ? 600 : 2000);
  expect(Plan.status[plan]).toBe("completed"); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(verb === "finish_document" ? 0 : 2000);
  expect(Goal.status[f.goal]).toBe("active");
});

test("an open narrative goal does not repeatedly commission a completed assessment", async () => {
  const f = fixture({ type: "custom", description: "Be ready for the evening; revise my plans if circumstances change." });
  const registry = createSystemRegistry();
  for (const step of f.proposal.steps) executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: step.content } }], registry);
  expect(Plan.status[f.plan]).toBe("completed");
  const generator = jest.fn(async () => f.proposal);
  for (let n = 0; n < 20; n++) {
    f.tick();
    expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
    await runPlanningSystem(f.world, { background: true, agentEids: [f.actor], planGenerator: generator });
  }
  expect(generator).not.toHaveBeenCalled();
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test("a narrative assessment reopens on observed change, not another identical inspection", () => {
  const f = fixture({ type: "custom", description: "Look after the Reservoir." });
  recordInspectionResult(f.world, f.actor, f.reservoir); f.finish(); f.tick();
  recordInspectionResult(f.world, f.actor, f.reservoir);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  ObjectState.current[f.reservoir] = "overflowing";
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  recordInspectionResult(f.world, f.actor, f.reservoir);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("a narrative goal with a completed physical stage still gets further planning", () => {
  const f = fixture({ type: "custom", description: "Prepare the Reading room for guests." });
  f.finish(); f.tick();
  const item = createObjectEntity(f.world, { name: "Guest list", roomId: f.room, portable: true });
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [{ description: "Collect the guest list", actionType: "pickup", target: "Guest list" }] });
  executeActions(f.world, [{ eid: f.actor, action: { type: "pickup", target: "Guest list" } }], createSystemRegistry());
  expect(getDirectContainer(f.world, item)).toBe(f.actor);
  expect(Plan.status[plan]).toBe("completed"); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("an executed narrative assessment may finish with an already-covered inspection", () => {
  const f = fixture({ type: "custom", description: "Look after the Reservoir." });
  Plan.status[f.plan] = "failed"; f.tick();
  recordInspectionResult(f.world, f.actor, f.reservoir);
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [f.proposal.steps[0], { description: "Check the Reservoir", actionType: "observe", target: "Reservoir" }] });
  executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: f.proposal.steps[0].content } }], createSystemRegistry());
  expect(Plan.currentStep[plan]).toBe(1);
  expect(reconcileCurrentPlan(f.world, f.actor, plan)).toBe(1);
  expect(Plan.status[plan]).toBe("completed"); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["sustained", "narrative"])("a personally read relevant text reopens %s assessment, but sent, unrelated or another actor's texts do not", kind => {
  const f = kind === "narrative" ? fixture({ type: "custom", description: "Look after the Reservoir." }) : fixture();
  f.finish(); f.tick();
  const receipt = (actor: number, key: string, content: string, kind: "read" | "sent" = "read") =>
    recordPrivateCommunication(f.world, actor, { sourceId: getCommittedEvents(f.world).sourceId!,
      messageKey: key, channel: "phone:caretaker", kind, other: "Night supervisor", content,
      sentAtSimMs: 0, deliveredAtSimMs: 0 });
  receipt(f.peer, "peer-only", "The Reservoir needs another inspection.");
  receipt(f.actor, "unrelated", "The biscuits are delicious.");
  receipt(f.actor, "own", "I inspected the Reservoir.", "sent");
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  receipt(f.actor, "relevant", "The Reservoir needs another inspection; the gauge may be sticking.");
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(3);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(Plan.status[f.plan]).toBe("completed");
});

test("receiving the same recorded private message again does not reopen a newly completed review", () => {
  const f = fixture();
  const input = { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "read-once", channel: "phone:caretaker",
    kind: "read" as const, other: "Night supervisor", content: "The Reservoir gauge may be sticking.", sentAtSimMs: 0, deliveredAtSimMs: 0 };
  recordPrivateCommunication(f.world, f.actor, input); f.finish(); f.tick();
  recordPrivateCommunication(f.world, f.actor, input);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  recordPrivateCommunication(f.world, f.actor, { ...input, messageKey: "later-independent-report" });
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("the background prompt gets the reader's attributed correspondence, not another actor's messages", async () => {
  const f = fixture();
  const receipt = { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "actor-text", channel: "phone:caretaker",
    kind: "read" as const, other: "Night supervisor", content: "The Reservoir gauge may be sticking.", sentAtSimMs: 0, deliveredAtSimMs: 0 };
  recordPrivateCommunication(f.world, f.actor, receipt);
  recordPrivateCommunication(f.world, f.peer, { ...receipt, messageKey: "peer-text", content: "PRIVATE_PEER_ONLY" });
  let prompt = "";
  await generatePlanForGoal(f.world, f.actor, f.goal, { generateText: (async (input: { prompt: string; system: string }) => {
    prompt = input.system + input.prompt; return { text: JSON.stringify(f.proposal) };
  }) as any });
  expect(prompt).toContain("PERSONALLY READ OR SENT TEXTS");
  expect(prompt).toContain("Night supervisor"); expect(prompt).toContain(receipt.content);
  expect(prompt).not.toContain("PRIVATE_PEER_ONLY");
});

test("a newly read correction during background inference rejects the old draft without losing the goal", async () => {
  const f = fixture(); f.finish(); f.tick();
  const receipt = { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "first", channel: "phone:caretaker",
    kind: "read" as const, other: "Night supervisor", content: "Please inspect the Reservoir.", sentAtSimMs: 0, deliveredAtSimMs: 0 };
  recordPrivateCommunication(f.world, f.actor, receipt);
  const plans = getRelationTargets(f.world, f.actor, HasPlan).slice();
  const generate = jest.fn(async () => {
    recordPrivateCommunication(f.world, f.actor, { ...receipt, messageKey: "correction", content: "Correction: the Reservoir gauge was replaced; inspect the Supply valve." });
    return f.proposal;
  });
  await runPlanningSystem(f.world, { background: true, agentEids: [f.actor], planGenerator: generate });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toEqual(plans);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test.each(["unrelated", "own", "peer"] as const)("%s correspondence during inference does not discard an unaffected draft", async kind => {
  const f = fixture(); f.finish(); f.tick();
  const receipt = { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "first", channel: "phone:caretaker",
    kind: "read" as const, other: "Night supervisor", content: "Please inspect the Reservoir.", sentAtSimMs: 0, deliveredAtSimMs: 0 };
  recordPrivateCommunication(f.world, f.actor, receipt);
  const plans = getRelationTargets(f.world, f.actor, HasPlan).length;
  await runPlanningSystem(f.world, { background: true, agentEids: [f.actor], planGenerator: async () => {
    recordPrivateCommunication(f.world, kind === "peer" ? f.peer : f.actor, { ...receipt, messageKey: "later",
      kind: kind === "own" ? "sent" : "read", content: kind === "unrelated" ? "The biscuits are delicious." : receipt.content });
    return f.proposal;
  } });
  expect(getRelationTargets(f.world, f.actor, HasPlan)).toHaveLength(plans + 1);
});

test("a personally read report also reopens a finite inspection waiting for new evidence", () => {
  const f = fixture({ type: "in_inventory", itemName: "Key" });
  Plan.status[f.plan] = "failed"; // Replace the fixture's initial active review.
  jest.setSystemTime(Date.now() + 1);
  recordInspectionResult(f.world, f.actor, f.reservoir);
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [{ description: "Inspect the Reservoir", actionType: "observe", target: "Reservoir" }] });
  expect(reconcileCurrentPlan(f.world, f.actor, plan)).toBe(1);
  expect(Plan.status[plan]).toBe("awaiting_evidence");
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "changed",
    channel: "phone:caretaker", kind: "read", other: "Night supervisor", content: "I saw a key beside the Reservoir.", sentAtSimMs: 0, deliveredAtSimMs: 0 });
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("diagnostic eligibility follows owned held work, not merely a completed status", () => {
  const f = fixture(); expect(settledReview(f.world, f.actor)).toBeNull();
  f.finish(); f.tick();
  expect(settledReview(f.world, f.actor)?.planId).toBe(f.plan);
  expect(settledReview(f.world, f.peer)).toBeNull();
  recordCommittedSpeech(f.world, f.peer, "The Reservoir is leaking again.", "Mara");
  expect(settledReview(f.world, f.actor)).toBeNull();
});

test("a newer active plan or completed goal cannot qualify as settled ongoing work", () => {
  const f = fixture(); f.finish(); f.tick();
  createPlanEntity(f.world, f.actor, f.goal, f.proposal);
  expect(settledReview(f.world, f.actor)).toBeNull();
  Goal.status[f.goal] = "completed";
  expect(settledReview(f.world, f.actor)).toBeNull();
});

test("relevant incoming evidence reopens planning without unrelated banter doing so", () => {
  const f = fixture(); f.finish(); f.tick();
  recordCommittedSpeech(f.world, f.peer, "The biscuits are delicious.", "Mara");
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  recordCommittedSpeech(f.world, f.peer, "The Reservoir is leaking again.", "Mara");
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test.each(["sustained", "narrative"])("new actor location or changed goal definition permits %s reconsideration", kind => {
  const f = kind === "narrative" ? fixture({ type: "custom", description: "Look after the Reservoir." }) : fixture();
  f.finish(); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  setLocatedIn(f.world, f.actor, f.hall);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
  setLocatedIn(f.world, f.actor, f.room);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  Goal.description[f.goal] = "Urgently find the missing key";
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("finite goals still get outcome review and another plan when necessary", () => {
  const f = fixture({ type: "in_inventory", itemName: "Key" }); f.finish(); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("a viable finite alternative is not parked just because another branch takes time", () => {
  const f = fixture({ type: "any_of", conditions: [{ type: "productive_time", roomName: "Reading room", atLeastMs: 3600_000 },
    { type: "in_inventory", itemName: "Key" }] }); f.finish(); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("native thought execution completes the review but neither the shift nor productive work", () => {
  const f = fixture(), registry = createSystemRegistry(); f.world.meta.aiEnabled = false;
  for (const step of f.proposal.steps) executeActions(f.world, [{ eid: f.actor, action: { type: "think", content: step.content } }], registry);
  expect(Plan.status[f.plan]).toBe("completed");
  expect(JSON.parse(Plan.steps[f.plan]).at(-1).completedWorkDependency).toBeDefined();
  expect(Goal.status[f.goal]).toBe("active");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(0);
  f.world.meta.aiEnabled = true; f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
});

test("same observed facts do not restart planning; a newly observed state does", () => {
  const f = fixture(); recordInspectionResult(f.world, f.actor, f.reservoir); f.finish(); f.tick();
  recordInspectionResult(f.world, f.actor, f.reservoir);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  ObjectState.current[f.reservoir] = "overflowing";
  // A hidden/unobserved value does not itself update her working memory.
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  recordInspectionResult(f.world, f.actor, f.reservoir);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("a held work review does not starve a new high-priority intention", () => {
  const f = fixture(); f.finish(); f.tick();
  createPersonalIntention(f.world, f.actor, "Find Ivo immediately", 9);
  expect(hasPendingPlanning(f.world, f.actor, { background: true, focusActiveGoal: true })).toBe(true);
});

test("a nested required duration is held, but a physical work plan can continue", () => {
  const f = fixture({ type: "all_of", conditions: [{ type: "in_room", roomName: "Reading room" },
    { type: "productive_time", roomName: "Reading room", atLeastMs: 3600_000 }] });
  f.finish(); f.tick(); expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  const productive = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [{ description: "Write the shift report", actionType: "interact", target: "Notebook", content: "write report" }] });
  // Cursor-level test of classification only; no document effect is claimed.
  advancePlanStep(productive, { world: f.world, agentEid: f.actor }); f.tick();
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(true);
});

test("the model cannot supply completed-review metadata", () => {
  const f = fixture();
  const forged = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal,
    steps: [{ ...f.proposal.steps[0], completedWorkDependency: "model supplied" }] });
  expect(JSON.parse(Plan.steps[forged])[0].completedWorkDependency).toBeUndefined();
});

test.each([true, false])("reconciled sustained-work completion (prior executed step: %s) retains the review without fabricating actions", executedPrefix => {
  const f = fixture(); Plan.status[f.plan] = "failed"; f.tick();
  recordInspectionResult(f.world, f.actor, f.reservoir);
  const steps: PlanStep[] = [...(executedPrefix ? [f.proposal.steps[0]] : []),
    { description: "Review the Reservoir", actionType: "observe", target: "Reservoir" }];
  const plan = createPlanEntity(f.world, f.actor, f.goal, { ...f.proposal, steps });
  if (executedPrefix) advancePlanStep(plan, { world: f.world, agentEid: f.actor });
  const before = getWorkingMemory(f.world, f.actor);
  expect(reconcileCurrentPlan(f.world, f.actor, plan)).toBe(1);
  expect(Plan.status[plan]).toBe("completed");
  expect(JSON.parse(Plan.steps[plan]).at(-1).completedWorkDependency).toBeDefined();
  f.tick(); jest.setSystemTime(Date.now() + 120_000);
  expect(hasPendingPlanning(f.world, f.actor, { background: true })).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
  expect(Goal.status[f.goal]).toBe("active");
  expect(readProductiveGoalTime(f.world, f.actor, f.goal, "Reading room")).toBe(0);
});
