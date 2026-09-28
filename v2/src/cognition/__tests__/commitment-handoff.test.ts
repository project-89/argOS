import { jest } from "@jest/globals";
import { addEntity, getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { CoordinationMemory, Goal, GoalLifecycle, WorkingMemoryIdentity } from "../../ecs/components";
import { HasGoal } from "../../ecs/relations";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, getCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { serializeWorld, deserializeWorld } from "../../persistence/world-persistence";
import { recordPrivateCommunication } from "../communication-memory";
import { createGeneratedIntention } from "../goal-lifecycle";
import { captureGoalReviewContext, formatGoalPursuitContext, prepareGoalReview, resumeDeferredGoals } from "../goal-pursuit";
import { runCoordinationReview } from "../coordination-review";
import { applyCoordinationReviews, coordinationPlanningContext, getCoordinationGoalRef, getCoordinationMemory, reconcileCoordinationGoals } from "../coordination-memory";
import { generateAutonomousGoal, hasPendingPersonalGoalReview, resetAutonomousGoals, expireStaleGoals } from "../autonomous-goals";
import { getPlanForGoal, runPlanningSystem, generatePlanForGoal } from "../planning-system";
import { recordCommittedSpeech } from "../social-memory";
import { captureIntentionReconsideration, prepareIntentionReconsideration } from "../intention-reconsideration";
import { recordPersonalConcern } from "../personal-concerns";

const keys = ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"];
let savedKeys: Array<string | undefined>;
beforeEach(() => {
  savedKeys = keys.map(k => process.env[k]); keys.forEach(k => { delete process.env[k]; });
  process.env.GEMINI_API_KEY = "offline-placeholder";
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline handoff tests"));
  resetAutonomousGoals();
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  keys.forEach((k, i) => { if (savedKeys[i] === undefined) delete process.env[k]; else process.env[k] = savedKeys[i]; });
});
async function fixture() {
  const world = createArgosWorld("Future commitment"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Apartment" });
  const make = (name: string) => createAgentEntity(world, { name, role: "friend", systemPrompt: "I choose my own plans", roomId: room });
  const actor = make("Elaine"), peer = make("Jerry"), sourceId = startCommittedEvents(world);
  advanceSimulationTime(world, 1, 53_000);
  const routine = createGeneratedIntention(world, actor, { description: "Find out who ate the cookie", kind: "social", priority: 7 }, "personal")!;
  const reply = createGeneratedIntention(world, actor, { description: "Reply to Alex and arrange dinner", kind: "social", priority: 8 }, "autonomous")!;
  const receipt = recordPrivateCommunication(world, actor, { sourceId, messageKey: "dinner", channel: "phone", kind: "sent",
    other: "Alex", content: "How about Mendy's? I can meet you there in an hour.", sentAtSimMs: 53_000 })!;
  await runCoordinationReview(world, actor, { infer: async () => ({ reviews: [{ kind: "undertake", speechId: receipt.id,
    task: "Meet Alex at Mendy's in an hour", goalId: reply }] }) });
  const endReply = () => {
    expect(prepareGoalReview(captureGoalReviewContext(world, actor), { goalId: reply, disposition: "release", reason: "I sent my reply" })?.commit()).toBe(true);
    reconcileCoordinationGoals(world, actor);
  };
  const goals = () => getRelationTargets(world, actor, HasGoal);
  const follow = () => goals().find(g => g !== reply && g !== routine)!;
  const choice = (followUp: object = {}) => ({ goal: "Follow through on my proposed dinner with Alex", kind: "social", priority: 8,
    motivation: "I want to see him, but I proposed a later time", followUp: { undertakingId: receipt.id, ...followUp } });
  const review = (answer: unknown, check?: (context: any, request: any) => void) => {
    const infer = jest.fn(async (request: any) => { check?.(JSON.parse(request.messages[1].content.split("\n")[0]), request); return { text: JSON.stringify(answer) }; });
    return { infer, run: () => generateAutonomousGoal(world, actor, { generateText: infer as any }) };
  };
  return { world, actor, peer, routine, reply, receipt, endReply, goals, follow, choice, review };
}

test("ending a reply opens a private personal review despite ongoing routine goals", async () => {
  const f = await fixture(); expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  f.endReply(); expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const attempt = f.review(f.choice(), context => {
    expect(context.undertakings).toMatchObject([{ id: f.receipt.id, needsFollowUp: true,
      original: { content: f.receipt.content, atSimMs: 53_000 }, sourceAgeSeconds: 0 }]);
  });
  expect(await attempt.run()).not.toBeNull();
  const follow = f.goals().find(g => g !== f.reply && g !== f.routine)!;
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toMatchObject({ goalRelation: "supports", localStatus: "not_started" });
  expect(getCoordinationMemory(f.world, f.actor).items[0].goalTracking).toBeUndefined();
  expect(GoalLifecycle.parentGoalEid[follow]).toBe(-1);
  expect(getCoordinationMemory(f.world, f.actor).items[0].goal).toEqual(getCoordinationGoalRef(f.world, f.actor, follow));
  expect(Goal.status[f.routine]).toBe("active"); expect(Goal.progress[follow]).toBe(0);
  expect(getCoordinationMemory(f.world, f.peer).items).toEqual([]);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("Mendy");
  advanceSimulationTime(f.world, 2, 60_000); expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});

test("chosen source-anchored review waits in lived time then resumes without acting or claiming an agreement", async () => {
  const f = await fixture(); f.endReply();
  const reviewAtSimMs = f.receipt.atSimMs + 55 * 60_000;
  await f.review(f.choice({ reviewAtSimMs, reason: "Review travel shortly before the time I proposed; Alex has not confirmed" })).run();
  const follow = f.goals().find(g => g !== f.reply && g !== f.routine)!;
  expect(Goal.status[follow]).toBe("paused");
  expect(JSON.parse(GoalLifecycle.deferredJson[follow]).until).toBe(reviewAtSimMs);
  const context = formatGoalPursuitContext(f.world, f.actor);
  expect(context).toContain(`review at simulation ${reviewAtSimMs}ms`); expect(context).toContain("in 3300s");
  const wall = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 86_400_000);
  expect(resumeDeferredGoals(f.world, f.actor)).toBe(0); wall.mockRestore();
  advanceSimulationTime(f.world, 2, 55 * 60_000 - 1); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  advanceSimulationTime(f.world, 3, 1); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(Goal.status[follow]).toBe("active"); expect(Goal.progress[follow]).toBe(0);
  expireStaleGoals(f.world, f.actor);
  expect(Goal.status[follow]).toBe("active"); // waiting is not fifty-five minutes of failed execution
  expect(Goal.deadline[follow]).toBe(0); // The review time is not an invented appointment deadline.
  advanceSimulationTime(f.world, 4, 120_001); expireStaleGoals(f.world, f.actor);
  expect(Goal.status[follow]).toBe("paused"); // Stale execution requests a bounded review, not abandonment.
  expect(captureGoalReviewContext(f.world, f.actor).goals.has(follow)).toBe(true);
});

test("no new intention is a stable choice, not a request to regenerate every tick", async () => {
  const f = await fixture(); f.endReply(); const attempt = f.review({ goal: null });
  await attempt.run(); expect(attempt.infer).toHaveBeenCalledTimes(1);
  advanceSimulationTime(f.world, 2, 120_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(getCoordinationMemory(f.world, f.actor).items[0].localStatus).toBe("not_started");
  expect(f.goals()).toHaveLength(2);
});

test.each(["no goal", "stale goal identity"])("an undertaking with %s can receive a follow-up without changing the old goal", async variant => {
  const f = await fixture();
  if (variant === "no goal") {
    const source = recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "other",
      channel: "phone", kind: "sent", other: "Bo", content: "I will call you later.", sentAtSimMs: 53_000 })!;
    await runCoordinationReview(f.world, f.actor, { infer: async () => ({ reviews: [{ kind: "undertake", speechId: source.id, task: "Call Bo later" }] }) });
  } else WorkingMemoryIdentity.id[f.reply] = "replacement-goal";
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
  const candidate = coordinationPlanningContext(f.world, f.actor).find(i => i.needsFollowUp)!;
  await f.review({ ...f.choice(), followUp: { undertakingId: candidate.id } }).run();
  expect(Goal.status[f.reply]).toBe("active"); expect(Goal.status[f.follow()]).toBe("active");
});

test("already linked deferred intentions are not duplicated or reparented", async () => {
  const f = await fixture();
  prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: f.reply, disposition: "defer", reason: "Wait for an answer",
    afterSeconds: 60, wake: { kind: "review" } })!.commit();
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(coordinationPlanningContext(f.world, f.actor)[0]).toMatchObject({ needsFollowUp: false, linkedIntention: { status: "paused" } });
});

test("a no-op stays quiet across own progress reports but a different supporting goal ending warrants review", async () => {
  const f = await fixture(); f.endReply(); await f.review({ goal: null }).run();
  advanceSimulationTime(f.world, 2, 6_000);
  const source = recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!, messageKey: "report",
    channel: "phone", kind: "sent", other: "Alex", content: "I haven't left yet.", sentAtSimMs: 59_000 })!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "report", id: f.receipt.id, speechId: source.id, status: "not_started" }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  const another = createGeneratedIntention(f.world, f.actor, { description: "Consider travel options", kind: "social", priority: 6 }, "foreground")!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.receipt.id, goalId: another }]);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: another, disposition: "release", reason: "I considered the options" })!.commit();
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true);
});

test("personally withdrawing an undertaking cannot be undone by a late handoff or a timer", async () => {
  const f = await fixture(); f.endReply();
  await f.review(f.choice({ reviewAtSimMs: 3_353_000, reason: "Reconsider before dinner" })).run();
  const goal = f.follow();
  // Existing appraisal authority can relinquish a paused intention.
  prepareIntentionReconsideration(captureIntentionReconsideration(f.world, f.actor), [
    { goalId: goal, disposition: "release", reason: "I no longer want to go" },
  ])!.commit();
  applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: f.receipt.id, reason: "I am withdrawing my proposal" }]);
  advanceSimulationTime(f.world, 2, 3_600_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
  expect(Goal.status[goal]).toBe("retired"); expect(Goal.progress[goal]).toBe(0);
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toMatchObject({ localStatus: "released", lastReported: { status: "not_started" } });
});

test.each(["release", "relink", "owner", "restart", "stop", "goal", "new private read", "cancel"])("%s during inference leaves no partially created follow-up", async change => {
  const f = await fixture(); f.endReply(); const abort = new AbortController(); let finish!: (v: any) => void;
  const infer = jest.fn(() => new Promise<any>(resolve => { finish = resolve; }));
  const running = withSimulationTask(abort.signal, () => generateAutonomousGoal(f.world, f.actor, { generateText: infer as any }));
  expect(infer).toHaveBeenCalledTimes(1);
  if (change === "release") applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: f.receipt.id, reason: "I changed my mind" }]);
  if (change === "relink") applyCoordinationReviews(f.world, f.actor, [{ kind: "link", id: f.receipt.id, goalId: f.routine }]);
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement-person";
  if (change === "restart") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "stop") stopCommittedEvents(f.world);
  if (change === "goal") Goal.priority[f.routine] = 9;
  if (change === "new private read") recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!,
    messageKey: "cancelled", channel: "phone", kind: "read", other: "Alex", content: "Actually I cannot meet tonight.",
    sentAtSimMs: 53_000, deliveredAtSimMs: 53_000 });
  if (change === "cancel") abort.abort();
  finish({ text: JSON.stringify(f.choice({ reviewAtSimMs: 3_353_000, reason: "Review before dinner" })) });
  await running;
  expect(f.goals()).toHaveLength(2);
});

test.each([
  { undertakingId: "invented" }, { undertakingId: 12 }, { extraAuthority: "walk_now" },
  { reviewAtSimMs: -1, reason: "bad" }, { reviewAtSimMs: 52_000, reason: "before my words" },
  { reviewAtSimMs: 86_453_001, reason: "over a day" }, { reviewAtSimMs: 54_000.5, reason: "fractional" },
  { reviewAtSimMs: 60_000 }, { reviewAtSimMs: 60_000, reason: "" }, { reason: "no time" },
])("invalid follow-up %p is rejected before goal/link mutation", async invalid => {
  const f = await fixture(); f.endReply(); const before = getCoordinationMemory(f.world, f.actor);
  expect(await f.review(f.choice(invalid)).run()).toBeNull();
  expect(f.goals()).toHaveLength(2); expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
});

test("source time, not response completion, anchors the timer when the world advances during inference", async () => {
  const f = await fixture(); f.endReply();
  await f.review(f.choice({ reviewAtSimMs: 60_000, reason: "Reconsider seven seconds after sending" }), () => {
    advanceSimulationTime(f.world, 2, 20_000);
  }).run();
  expect(Goal.status[f.follow()]).toBe("active"); expect(GoalLifecycle.deferredJson[f.follow()]).toBe("");
  expect(Goal.progress[f.follow()]).toBe(0);
});

test("save/remap retains the promise, future goal and original time without duplicating or leaking it", async () => {
  const f = await fixture(); f.endReply();
  await f.review(f.choice({ reviewAtSimMs: 3_353_000, reason: "Reconsider near my proposed time" })).run();
  const saved = serializeWorld(f.world, createSystemRegistry()), restored = createArgosWorld("Restored future");
  for (let i = 0; i < 12; i++) addEntity(restored);
  const { oldToNewId } = deserializeWorld(restored, createSystemRegistry(), saved);
  restored.meta.aiEnabled = true; startCommittedEvents(restored);
  const actor = oldToNewId.get(f.actor)!, goal = oldToNewId.get(f.follow())!;
  expect(actor).not.toBe(f.actor);
  expect(JSON.parse(GoalLifecycle.deferredJson[goal]).until).toBe(3_353_000);
  expect(coordinationPlanningContext(restored, actor)[0]).toMatchObject({ needsFollowUp: false, original: { atSimMs: 53_000 } });
  expect(hasPendingPersonalGoalReview(restored, actor)).toBe(false);
  expect(coordinationPlanningContext(restored, oldToNewId.get(f.peer)!)).toEqual([]);
  // Existing restart policy is deliberate: re-review, never replay the old plan.
  expect(resumeDeferredGoals(restored, actor)).toBe(1);
  expect(getPlanForGoal(restored, actor, goal)).toBeUndefined();
  expect(Goal.progress[goal]).toBe(0);
});

test("ordinary planning picks up the resumed intention with the original source, without background body control", async () => {
  const f = await fixture(); f.endReply();
  await f.review(f.choice({ reviewAtSimMs: 73_000, reason: "Finish my current exchange, then reconsider" })).run();
  const follow = f.follow();
  const infer = jest.fn(async (_world, _actor, goal) => ({ goalDescription: Goal.description[goal as number], estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Ask whether Alex has confirmed", actionType: "think" as const, content: "I proposed dinner; has he agreed?" }] }));
  await runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: infer });
  expect(infer.mock.calls.some(call => call[2] === follow)).toBe(false);
  advanceSimulationTime(f.world, 2, 20_000); resumeDeferredGoals(f.world, f.actor);
  await runPlanningSystem(f.world, { agentEids: [f.actor], planGenerator: infer });
  expect(infer.mock.calls.some(call => call[2] === follow)).toBe(true);
  let prompt = "";
  await generatePlanForGoal(f.world, f.actor, follow, { generateText: (async (request: any) => {
    prompt = request.system;
    return { text: JSON.stringify({ goalDescription: Goal.description[follow], estimatedCompletion: "short", potentialObstacles: [],
      steps: [{ actionType: "think", description: "Reconsider the proposal" }] }) };
  }) as any });
  expect(prompt).toContain(f.receipt.content); expect(prompt).toContain("53000ms");
  expect(Goal.progress[follow]).toBe(0);
  expect(getCommittedEvents(f.world).events.filter(e => e.type === "action")).toEqual([]);
});

test("other actors' heard promises do not become their own agenda", async () => {
  const f = await fixture(); f.endReply();
  recordCommittedSpeech(f.world, f.actor, "I'll bring the bread later", "Jerry");
  await runCoordinationReview(f.world, f.actor, { infer: async context => ({ reviews: [{ kind: "undertake",
    speechId: (context.communications as any[])[0].id, task: "Bring bread" }] }) });
  expect(coordinationPlanningContext(f.world, f.peer)).toEqual([]);
  expect(hasPendingPersonalGoalReview(f.world, f.peer)).toBe(false);
});

test("linking a follow-up acknowledges the reviewed batch instead of re-triggering its unchanged appraisal", async () => {
  const f = await fixture(); f.endReply();
  recordPersonalConcern(f.world, f.actor, { channel: "friend", evidenceIds: ["read:friend"], appraisal: "I want to make time for my friend",
    significance: "This relationship matters", importance: .8, appraisedAtSimMs: 53_000 });
  await f.review(f.choice()).run();
  advanceSimulationTime(f.world, 2, 6_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(false);
});

test("initial deferral remains revisable: a resumed goal can be interrupted and reviewed again without new work identity", async () => {
  const f = await fixture(); f.endReply();
  await f.review(f.choice({ reviewAtSimMs: 73_000, reason: "Reconsider after this exchange" })).run();
  const goal = f.follow(), work = getCoordinationMemory(f.world, f.actor).items[0];
  advanceSimulationTime(f.world, 2, 20_000); resumeDeferredGoals(f.world, f.actor);
  expect(prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: goal, disposition: "defer", afterSeconds: 20,
    wake: { kind: "review" }, reason: "I am helping a friend first" })?.commit()).toBe(true);
  expect(resumeDeferredGoals(f.world, f.actor)).toBe(0);
  advanceSimulationTime(f.world, 3, 20_000); expect(resumeDeferredGoals(f.world, f.actor)).toBe(1);
  expect(getCoordinationMemory(f.world, f.actor).items[0]).toEqual(work);
  expect(Goal.progress[goal]).toBe(0); expect(Goal.status[goal]).toBe("active");
});

test("invalid null-goal payload cannot smuggle a future mutation", async () => {
  const f = await fixture(); f.endReply();
  await f.review({ goal: null, followUp: f.choice().followUp }).run();
  advanceSimulationTime(f.world, 2, 6_000);
  expect(f.goals()).toHaveLength(2);
  // Rejected, not marked as a successful no-op; bounded failure backoff remains.
  const wall = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 6_000);
  expect(hasPendingPersonalGoalReview(f.world, f.actor)).toBe(true); wall.mockRestore();
});

test.each([undefined, null, -1, "53000"])("legacy/malformed spoken source time %p cannot authorize a timed follow-up", async atSimMs => {
  const f = await fixture();
  recordCommittedSpeech(f.world, f.actor, "I will bring the map in an hour", "Jerry");
  await runCoordinationReview(f.world, f.actor, { infer: async context => ({ reviews: [{ kind: "undertake",
    speechId: (context.communications as any[])[0].id, task: "Bring the map" }] }) });
  const memory = getCoordinationMemory(f.world, f.actor), item = memory.items.find(i => i.id !== f.receipt.id)!;
  (item.undertaking as any).atSimMs = atSimMs; (item.lastReported.speech as any).atSimMs = atSimMs;
  CoordinationMemory.itemsJson[f.actor] = JSON.stringify(memory.items);
  const before = getCoordinationMemory(f.world, f.actor);
  // Legacy spoken memories retain words without reconstructing a clock from wall time.
  expect(before.items.some(i => i.id === item.id)).toBe(true);
  expect(await f.review({ ...f.choice(), followUp: { undertakingId: item.id, reviewAtSimMs: 60_000, reason: "Review later" } }).run()).toBeNull();
  expect(f.goals()).toHaveLength(2); expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
});
