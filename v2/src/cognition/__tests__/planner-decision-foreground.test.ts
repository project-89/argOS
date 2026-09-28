import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { ApartmentSitcom } = await import("../../demo/apartment-sitcom");
const { getRelationTargets } = await import("bitecs");
const { HasGoal } = await import("../../ecs/relations");
const { Goal, Plan, PlanningDecision } = await import("../../ecs/components");
const { createIntentGoal } = await import("../cognition-system");
const { createPlanEntity } = await import("../planning-system");
const { capturePlanDecisions } = await import("../planner-decision");
const { agentThink, getAgentThoughts } = await import("../agent-mind");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getPrivateCommunications } = await import("../communication-memory");
const { chronicle } = await import("../simulation-chronicle");
const { enableControlLoopDiagnostics, getControlLoopDiagnostics } = await import("../../runtime/control-loop-diagnostics");
let bed: Awaited<ReturnType<typeof ApartmentSitcom.create>> | undefined, oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Foreground proposal tests must stay offline"));
});
afterEach(() => {
  bed?.stop(); bed = undefined; expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});
async function fixture(read = true, controller: "priority" | "situated" = "priority", priority = 10, selfDirected = false) {
  bed = await ApartmentSitcom.create({ live: false, scenario: "duet", outsideTextAtMs: null, cognitionController: controller });
  const t = bed; await t.start(); t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  const world = t.sim.world, actor = t.ids.Elaine, message = t.text("Can you call tomorrow?"); t.advance(500);
  t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(2000);
  if (read) { t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(2000); }
  const { createGeneratedIntention } = await import("../goal-lifecycle");
  const goal = selfDirected ? createGeneratedIntention(world, actor, { description: "Decide how to answer Alex", priority }, "foreground")!
    : createIntentGoal(world, actor, "Decide how to answer Alex", priority);
  const plan = createPlanEntity(world, actor, goal, { goalDescription: Goal.description[goal], steps: [],
    decision: { purpose: "Decide whether to answer Alex", target: "Elaine's phone", command: "reply" }, estimatedCompletion: "short", potentialObstacles: [] });
  const id = capturePlanDecisions(world, actor).items[0].id;
  world.meta.aiEnabled = true;
  const response = () => ({ control: { version: 2, goalId: goal, purpose: "Answer Alex with my own choice", localDependencies: [] },
    innerThought: "Tomorrow works for me.", planDecision: { id, disposition: "select", reason: "I want to answer." },
    action: { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: message, text: "Yes, tomorrow works." })}` } });
  return { t, world, actor, message, goal, plan, id, response };
}

test.each(["omitted", "chosen", "invalid"])("operator trace captures offered follow-up contract and %s control separately from admission", async kind => {
  const f = await fixture(); enableControlLoopDiagnostics(f.world);
  const response = { control: { version: 2, purpose: "Listen before replying", localDependencies: [], goalId: f.goal,
    ...(kind === "omitted" ? {} : { nextPurpose: { goalId: kind === "invalid" ? -100 : f.goal, purpose: "Reply to Alex" } }) },
    action: { type: "wait" } };
  generate.mockResolvedValueOnce({ text: JSON.stringify(response) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(kind === "invalid");
  const trace = getControlLoopDiagnostics(f.world).entries.filter(e => e.actorId === f.actor);
  const issued = trace.find(e => e.stage === "issued")!, returned = trace.find(e => e.stage === "returned")!;
  expect(issued.detail.contractOffered).toBe(true);
  expect(issued.detail.eligibleNextPurposeGoalIds).toContain(f.goal);
  expect(issued.detail.contract).toContain("wait/listening interval");
  expect(JSON.stringify(generate.mock.calls[0][0])).toContain("record control.nextPurpose:");
  expect(generate.mock.calls[0][0].messages[0].content).not.toContain('"disposition": "<take or cancel>"');
  expect(JSON.stringify(generate.mock.calls[0][0])).not.toContain("contractOffered");
  expect(returned.requestId).toBe(issued.requestId);
  expect(returned.detail).toMatchObject({ purpose: response.control.purpose, nextPurposePresent: kind !== "omitted" });
  expect(trace.at(-1)?.stage).toBe(kind === "invalid" ? "rejected" : "integrated");
  if (kind === "invalid") expect(trace.at(-1)?.detail.schemaField).toBe("control.nextPurpose");
  if (kind === "chosen") expect(trace.at(-1)?.detail.nextPurpose).toMatchObject({ purpose: "Reply to Alex", status: "after_step" });
  expect(f.t.snapshot().phone.some(m => m.direction === "out")).toBe(false);
});

test("foreground frames action selection before speech and keeps proposals inside the next-action choice", async () => {
  const f = await fixture();
  generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  const prompt = generate.mock.calls[0][0].messages[0].content as string;
  expect(prompt.startsWith("Choose the next useful action across your current intentions")).toBe(true);
  expect(prompt).toContain("Choose what to do before composing anything to say");
  expect(prompt).toContain("If you choose to speak");
  expect(prompt).toContain("Listening is a separate choice");
  expect(prompt).not.toContain("leave space to hear a response");
  expect(prompt.indexOf("NEXT-ACTION CHOICE:")).toBeLessThan(prompt.indexOf("PROPOSED NEXT DECISIONS"));
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each(["before", "during"] as const)("priority-only appraisal %s foreground choice preserves the reply proposal and requires current choice", async when => {
  const f = await fixture(true, "situated", 6, true), log = jest.spyOn(chronicle, "record");
  const { captureIntentionReconsideration, prepareIntentionReconsideration } = await import("../intention-reconsideration");
  const { planDecisionNeedsReplanning } = await import("../planner-decision");
  const reprioritize = () => {
    expect(prepareIntentionReconsideration(captureIntentionReconsideration(f.world, f.actor),
      [{ goalId: f.goal, disposition: "reprioritize", priority: 5, reason: "The notification has been read; replying is less urgent." }])?.commit()).toBe(true);
  };
  if (when === "before") reprioritize();
  generate.mockImplementationOnce(async () => {
    if (when === "during") reprioritize();
    return { text: JSON.stringify(f.response()) };
  });
  let action = await agentThink(f.world, f.actor);
  expect(Plan.status[f.plan]).toBe("awaiting_decision");
  expect(planDecisionNeedsReplanning(f.world, f.actor, f.plan)).toBe(false);
  if (when === "during") {
    // Changing priorities during deliberation still invalidates its mental
    // basis. Preserve the proposal, not permission to run an outdated choice.
    expect(isDiscardedForegroundDecision(action)).toBe(true);
    expect(PlanningDecision.reviewJson[f.plan]).toBe("");
    expect(log).not.toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ schemaField: "planDecision" }));
    expect(capturePlanDecisions(f.world, f.actor).items.some(item => item.id === f.id)).toBe(true);
    generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
    action = await agentThink(f.world, f.actor);
  }
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toEqual([expect.objectContaining({ content: "Yes, tomorrow works." })]);
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["replacement", "unknown_id"] as const)("%s planner choice is distinguished from stale evidence without a reply", async change => {
  const f = await fixture(), log = jest.spyOn(chronicle, "record");
  generate.mockImplementationOnce(async () => {
    if (change === "replacement") createPlanEntity(f.world, f.actor, f.goal, { goalDescription: Goal.description[f.goal], steps: [],
      decision: { purpose: "Reconsider the reply", target: "Elaine's phone", command: "reply" }, estimatedCompletion: "short", potentialObstacles: [] });
    const response = f.response();
    if (change === "unknown_id") response.planDecision.id = "decision:unknown";
    return { text: JSON.stringify(response) };
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(log).toHaveBeenCalledWith(change === "replacement" ? "decision_superseded" : "decision_rejected",
    expect.objectContaining({ reason: change === "replacement" ? "source_changed" : "invalid_schema", schemaField: "planDecision" }));
  expect(PlanningDecision.reviewJson[f.plan]).toBe("");
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each([true, false])("a different owned goal may answer independently without adopting the phone plan (read=%s)", async read => {
  const f = await fixture(read, "situated"), log = jest.spyOn(chronicle, "record");
  const other = createIntentGoal(f.world, f.actor, "Clarify tonight's arrangement with Alex", 9);
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(),
    control: { ...f.response().control, goalId: other }, action: { ...f.response().action, goalId: other } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(PlanningDecision.reviewJson[f.plan]).toBe("");
  expect(log).toHaveBeenCalledWith("plan_decision_detached", expect.objectContaining({ goalId: f.goal, selectedGoalId: other }));
  expect(log).not.toHaveBeenCalledWith("plan_decision_review", expect.anything());
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(read ? 1 : 0);
  expect(PlanningDecision.reviewJson[f.plan]).toBe(""); expect(Goal.progress[f.goal]).toBe(0);
});

test("foreground inspection reads the physical phone, preserves the old activity, and may resume without replying", async () => {
  const f = await fixture(false, "situated");
  const { integrateActorContinuation } = await import("../actor-continuation");
  const { snapshotOngoingActivity } = await import("../ongoing-activity");
  const { readSimulationTime } = await import("../../ecs/simulation-time");
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Resolve my question about the cookie", actionType: "think", goalId: cookie,
    observedAtSimMs: readSimulationTime(f.world) });
  const before = snapshotOngoingActivity(f.world, f.actor)!;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: f.goal,
    purpose: "Briefly check what the notification is about", activityDisposition: "pause", localDependencies: [] },
    action: { type: "interact", target: "Elaine's phone", content: "read_phone" } }) });
  const read = await agentThink(f.world, f.actor); expect(isDiscardedForegroundDecision(read)).toBe(false);
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: before.id, status: "paused" });
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
  f.t.dispatch("Elaine", read); f.world.meta.aiEnabled = false; f.t.advance(4000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => !r.own)).toHaveLength(1);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  expect(Goal.status[cookie]).toBe("active"); expect(Goal.progress[cookie]).toBe(0);
  f.world.meta.aiEnabled = true;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: cookie,
    purpose: "Return to the cookie question; I can answer later", activityDisposition: "continue", localDependencies: [] }, action: { type: "think" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(false);
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ id: before.id, status: "active" });
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each(["take", "cancel"] as const)("a follow-up survives an evidence wait and permits explicit %s", async disposition => {
  const f = await fixture(false, "situated");
  const { snapshotActorContinuation } = await import("../actor-continuation");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null,
    purpose: "Listen briefly, then reconsider checking the notification", localDependencies: [],
    nextPurpose: { goalId: f.goal, purpose: "Decide what the notification needs" } },
    action: { type: "wait", waitUntil: { kind: "heard_evidence", timeoutMs: 1000 } } }) });
  const wait = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(wait)).toBe(false);
  f.t.dispatch("Elaine", wait);
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.status).toBe("after_step");
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
  f.world.meta.aiEnabled = false; f.t.advance(1500); f.world.meta.aiEnabled = true;
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: disposition === "take" ? f.goal : null,
    purpose: disposition === "take" ? "Check the notification now" : "I prefer not to engage with this message now", localDependencies: [],
    nextPurposeReview: { id: next.id, disposition, reason: "I have reconsidered after waiting" } },
    action: disposition === "take" ? { type: "interact", target: "Elaine's phone", content: "read_phone" } : { type: "think" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toBeUndefined();
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(2000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => !r.own).length).toBe(disposition === "take" ? 1 : 0);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each([true, false])("a chosen next purpose waits for speech completion, then fresh reading works (explicit review=%s)", async explicitReview => {
  const f = await fixture(false, "situated");
  const { snapshotActorContinuation } = await import("../actor-continuation");
  const { getSpeakingActivity } = await import("../timed-speech");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null,
    purpose: "Finish my point before checking the notification", localDependencies: [],
    nextPurpose: { goalId: f.goal, purpose: "Find out what the notification says" } },
    action: { type: "speak", content: "One moment, then I need to check something." } }) });
  const speech = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(speech)).toBe(false);
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.status).toBe("after_step");
  f.t.dispatch("Elaine", speech);
  expect(getSpeakingActivity(f.world, f.actor)).toBeDefined();
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose?.status).toBe("after_step");
  f.world.meta.aiEnabled = false; f.t.advance(12000);
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  expect(next).toMatchObject({ status: "ready", outcome: "succeeded", goalId: f.goal });
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0); // No automatic read or reply.
  f.world.meta.aiEnabled = true;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null,
    purpose: "Another line without reviewing my chosen switch", localDependencies: [] },
    action: { type: "speak", content: "One more thing." } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toEqual(next);
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: f.goal,
    purpose: "Check what actually arrived", localDependencies: [],
    ...(explicitReview ? { nextPurposeReview: { id: next.id, disposition: "take", reason: "I have finished my sentence" } } : {}) },
    action: { type: "interact", target: "Elaine's phone", content: "read_phone" } }) });
  let read = await agentThink(f.world, f.actor);
  const issuedPrompt = generate.mock.calls.at(-1)![0].messages[0].content;
  expect(issuedPrompt).toContain("even when the action serves the same goal");
  expect(issuedPrompt).toContain(JSON.stringify({ id: next.id, disposition: "take", reason: "your reason" }));
  expect(issuedPrompt.indexOf("YOUR CHOSEN NEXT PURPOSE")).toBeLessThan(issuedPrompt.indexOf("Respond with JSON only"));
  expect(issuedPrompt.slice(issuedPrompt.indexOf("YOUR CHOSEN NEXT PURPOSE"), issuedPrompt.indexOf("Respond with JSON only"))).not.toContain("Speak one short");
  const responseExample = issuedPrompt.slice(issuedPrompt.indexOf("Respond with JSON only"), issuedPrompt.indexOf("Optional innerThought"));
  expect(responseExample).toContain('"nextPurposeReview": {');
  expect(responseExample).toContain(JSON.stringify(next.id));
  expect(responseExample).toContain('"disposition": "<take or cancel>"');
  if (!explicitReview) {
    // The current control contract requires explicit review even when the
    // proposed action happens to serve the same goal; never silently consume it.
    expect(isDiscardedForegroundDecision(read)).toBe(true);
    expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toEqual(next);
    expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
    generate.mockResolvedValue({text:JSON.stringify({control:{version:2,goalId:f.goal,
      purpose:"Check what actually arrived",localDependencies:[],
      nextPurposeReview:{id:next.id,disposition:"take",reason:"I have finished my sentence"}},
      action:{type:"interact",target:"Elaine's phone",content:"read_phone"}})});
    read = await agentThink(f.world, f.actor);
    expect(generate.mock.calls.at(-1)![0].system).toContain("no follow-up was consumed");
  }
  expect(isDiscardedForegroundDecision(read)).toBe(false);
  expect(JSON.stringify(generate.mock.calls.at(-1))).toContain("YOUR CHOSEN NEXT PURPOSE");
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toBeUndefined();
  f.t.dispatch("Elaine", read); f.world.meta.aiEnabled = false; f.t.advance(4000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => !r.own)).toHaveLength(1);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test("live-shape matching move cannot lose its ready handoff on rejection, and explicit repair moves natively", async () => {
  const f = await fixture(false, "priority");
  const { snapshotActorContinuation } = await import("../actor-continuation");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null,
    purpose: "Finish my sentence before returning to the living room", localDependencies: [],
    nextPurpose: { goalId: f.goal, purpose: "Return to the living room to consider my reply" } },
    action: { type: "speak", content: "Give me a moment." } }) });
  const speech = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(speech)).toBe(false);
  f.t.dispatch("Elaine", speech); f.world.meta.aiEnabled = false; f.t.advance(10000);
  const next = snapshotActorContinuation(f.world, f.actor)!.nextPurpose!;
  expect(next.status).toBe("ready");
  const proposal = { control: { version: 2, goalId: f.goal, purpose: next.purpose, localDependencies: [] },
    action: { type: "move", target: "Living Room" } };
  f.world.meta.aiEnabled = true;
  for (let i = 0; i < 2; i++) {
    generate.mockResolvedValue({ text: JSON.stringify(proposal) });
    expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
    expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toEqual(next);
  }
  generate.mockResolvedValue({ text: JSON.stringify({ ...proposal, control: { ...proposal.control,
    nextPurposeReview: { id: next.id, disposition: "take", reason: "My sentence has ended" } } }) });
  const move = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(move)).toBe(false);
  expect(generate.mock.calls.at(-1)![0].system).toContain("no follow-up was consumed");
  f.t.dispatch("Elaine", move); f.world.meta.aiEnabled = false; f.t.advance(5000);
  expect(f.t.snapshot().actors.find(a => a.name === "Elaine")?.room).toBe("Living Room");
  expect(snapshotActorContinuation(f.world, f.actor)?.nextPurpose).toBeUndefined();
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each([false, true])("inspection followed by conversation retains a reply only when explicitly chosen (chosen=%s)", async chosen => {
  bed = await ApartmentSitcom.create({ live: false, scenario: "project89", outsideTextAtMs: null, cognitionController: "priority" });
  const t = bed; await t.start(); const world = t.sim.world, actor = t.ids.Jerry;
  const { snapshotActorContinuation } = await import("../actor-continuation");
  const message = t.text("Look in the couch drawer. What does the card say? Text me back."); t.advance(500);
  t.dispatch("Jerry", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Jerry", { type: "pickup", target: "Jerry's phone" }); t.advance(2000);
  t.dispatch("Jerry", { type: "interact", target: "Jerry's phone", content: "read_phone" }); t.advance(2000);
  t.dispatch("Jerry", { type: "move", target: "Living Room" }); t.advance(3000);
  t.dispatch("Jerry", { type: "interact", target: "Couch storage drawer", content: "open" }); t.advance(2000);
  t.dispatch("Jerry", { type: "pickup", target: "Project 89 card" }); t.advance(2000);
  const goal = createIntentGoal(world, actor, "Inspect the card and decide whether to answer the sender", 9);
  world.meta.aiEnabled = true;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: goal,
    purpose: "Inspect the card so I can reply to the sender", localDependencies: [],
    ...(chosen ? { nextPurpose: { goalId: goal, purpose: "Decide my reply using what the card actually says" } } : {}) },
    action: { type: "observe", target: "Project 89 card" } }) });
  const inspection = await agentThink(world, actor);
  expect(isDiscardedForegroundDecision(inspection)).toBe(false);
  t.dispatch("Jerry", inspection); world.meta.aiEnabled = false; t.advance(3000);
  const next = snapshotActorContinuation(world, actor)?.nextPurpose;
  if (chosen) expect(next).toMatchObject({ status: "ready", outcome: "succeeded", goalId: goal });
  else expect(next).toBeUndefined(); // Narrative purpose alone never becomes a scheduled action.
  expect(getPrivateCommunications(world, actor).filter(r => r.own)).toHaveLength(0);
  world.meta.aiEnabled = true;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: goal,
    purpose: "Ask George what he makes of the card before deciding whether to reply", localDependencies: [] },
    action: { type: "speak", target: "George", content: "What do you make of this card?" } }) });
  const conversation = await agentThink(world, actor);
  expect(isDiscardedForegroundDecision(conversation)).toBe(chosen);
  expect(snapshotActorContinuation(world, actor)?.nextPurpose).toEqual(next);
  // Neither inspection nor conversation delivers the requested answer.
  expect(getPrivateCommunications(world, actor).filter(r => r.own)).toHaveLength(0);
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: goal,
    purpose: "Send my answer to the sender", localDependencies: [],
    ...(next ? { nextPurposeReview: { id: next.id, disposition: "take", reason: "I have inspected it and choose to answer" } } : {}) },
    action: { type: "interact", target: "Jerry's phone", content: `reply ${JSON.stringify({ replyTo: message, text: "The card says PROJECT 89 — WHO IS WATCHING?" })}` } }) });
  const reply = await agentThink(world, actor);
  expect(isDiscardedForegroundDecision(reply)).toBe(false);
  expect(getPrivateCommunications(world, actor).filter(r => r.own)).toHaveLength(0);
  t.dispatch("Jerry", reply); world.meta.aiEnabled = false; t.advance(15000);
  expect(t.snapshot().phone).toContainEqual(expect.objectContaining({ direction: "out", status: "delivered", replyTo: message }));
});

test.each(["id", "target", "command", "foreign", "retired", "stale-plan", "stale-selected", "extra-field"])("independent plan detachment cannot bypass %s validation", async failure => {
  const f = await fixture(true, "situated"), before = getAgentThoughts(f.world, f.actor).length;
  const other = createIntentGoal(f.world, failure === "foreign" ? f.t.ids.Jerry : f.actor, "Arrange the evening", 9);
  if (failure === "retired") Goal.status[other] = "retired";
  const result = { ...f.response(), control: { ...f.response().control, goalId: other }, action: { ...f.response().action, goalId: other } };
  if (failure === "id") result.planDecision.id = "not-issued";
  if (failure === "target") result.action.target = "Kitchen counter";
  if (failure === "command") result.action.content = "read_phone";
  if (failure === "extra-field") Object.assign(result.planDecision, { granted: true });
  generate.mockImplementation(async () => {
    if (failure === "stale-plan") Goal.description[f.goal] = "Changed original plan purpose";
    if (failure === "stale-selected") Goal.description[other] = "Changed selected purpose";
    return { text: JSON.stringify(result) };
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(PlanningDecision.reviewJson[f.plan]).toBe("");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(before);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test("foreground selection types fresh words; review is not a send receipt", async () => {
  const f = await fixture(), log = jest.spyOn(chronicle, "record"); generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
  const action = await agentThink(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(1); expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(JSON.stringify(generate.mock.calls[0])).toContain("PROPOSED NEXT DECISIONS");
  expect(JSON.stringify(generate.mock.calls[0])).not.toContain("Highest-priority active goal(s)");
  expect(JSON.stringify(generate.mock.calls[0])).toContain("Priorities are context, not a requirement");
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  // Independent cognition commits its private choice at the response boundary;
  // the selected body action remains separately fenced until dispatch.
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "select" });
  f.t.dispatch("Elaine", action);
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "select" });
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  expect(log).toHaveBeenCalledWith("plan_decision_review", expect.objectContaining({ disposition: "select", goalId: f.goal }));
  f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toEqual([expect.objectContaining({ content: "Yes, tomorrow works." })]);
  expect(Plan.status[f.plan]).toBe("awaiting_decision"); expect(Goal.status[f.goal]).toBe("active");
});

test.each([false, true])("release the old concern and select a fresh reply in one decision (redundant subjective review=%s)", async redundant => {
  const f = await fixture();
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  const log = jest.spyOn(chronicle, "record");
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(),
    action: { ...f.response().action, ...(redundant ? { goalId: f.goal } : {}) },
    control: { ...f.response().control, activityDisposition: "replace" },
    goalReview: { goalId: cookie, disposition: "release", reason: "I choose to leave the argument behind." },
    // A redundant subjective claim is NOT evidence and cannot turn relinquishment into success.
    ...(redundant ? { socialGoalReview: { goalId: cookie, disposition: "satisfied_for_now",
      reason: "I am done with that exchange.", evidenceIds: ["unverified-own-claim", "unverified-heard-claim"] } } : {}),
  }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(Goal.status[cookie]).toBe("retired"); expect(Goal.progress[cookie]).toBe(0);
  expect(Goal.status[f.goal]).toBe("active");
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "select" });
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toEqual([expect.objectContaining({ content: "Yes, tomorrow works." })]);
  expect(log).not.toHaveBeenCalledWith("goal_completed", expect.objectContaining({ source: "subjective_social_review" }));
});

test("closing the evidenced conversation can coexist with old-goal release and fresh phone-plan selection", async () => {
  const f = await fixture();
  const { WorkingMemoryIdentity } = await import("../../ecs/components");
  const { integrateActorContinuation } = await import("../actor-continuation");
  const { recordCommittedSpeech } = await import("../social-memory");
  const { setLocatedIn } = await import("../../ecs/location");
  const { captureActivityReview, snapshotActivityReview } = await import("../activity-review");
  const { readSimulationTime } = await import("../../ecs/simulation-time");
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Discuss what happened to my cookie", actionType: "speak", goalId: cookie,
    goalKey: WorkingMemoryIdentity.id[cookie], observedAtSimMs: readSimulationTime(f.world) });
  setLocatedIn(f.world, f.t.ids.Jerry, f.t.ids.kitchen);
  recordCommittedSpeech(f.world, f.actor, "That was my cookie.", "Jerry", Date.now(), undefined, "Explain my concern");
  recordCommittedSpeech(f.world, f.t.ids.Jerry, "I heard you.", "Elaine");
  recordCommittedSpeech(f.world, f.actor, "I do not want to argue anymore.", "Jerry", Date.now(), undefined, "Set the matter aside");
  f.world.meta.aiEnabled = false; f.t.advance(20000); f.world.meta.aiEnabled = true;
  const review = captureActivityReview(f.world, f.actor)!; expect(review).toBeDefined();
  const plan = createPlanEntity(f.world, f.actor, f.goal, { goalDescription: Goal.description[f.goal], steps: [],
    decision: { purpose: "Choose my own reply", target: "Elaine's phone", command: "reply" }, estimatedCompletion: "short", potentialObstacles: [] });
  const id = capturePlanDecisions(f.world, f.actor).items.find(item => item.goalId === f.goal)!.id;
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(),
    planDecision: { id, disposition: "select", reason: "I want to answer my friend now." },
    control: { ...f.response().control, activityDisposition: "replace", activityReview: { disposition: "close",
      reason: "I have said what I wanted to say.", evidenceIds: review.evidence.dialogue.filter(turn => turn.own).slice(-1).map(turn => turn.speechId),
      ...(review.evidence.goal ? { intentionAssessment: { outcome: "unchanged", reason: "The dispute remains unresolved; I choose to set it aside." } } : {}) } },
    goalReview: { goalId: cookie, disposition: "release", reason: "I choose to stop pursuing that dispute." },
  }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("closed");
  const issuedPrompt = generate.mock.calls[0][0].messages[0].content as string;
  expect(issuedPrompt.indexOf("PROPOSED NEXT DECISIONS")).toBeGreaterThan(issuedPrompt.indexOf("NEXT-ACTION CHOICE:"));
  expect(issuedPrompt.indexOf("ACTIVITY REVIEW —")).toBeGreaterThan(issuedPrompt.indexOf("PROPOSED NEXT DECISIONS"));
  expect(issuedPrompt).toContain("compared with an available alternative");
  expect(Goal.status[cookie]).toBe("retired"); expect(Goal.progress[cookie]).toBe(0);
  expect(JSON.parse(PlanningDecision.reviewJson[plan])).toMatchObject({ disposition: "select" });
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toEqual([expect.objectContaining({ content: "Yes, tomorrow works." })]);
});

test.each(["stale", "invalid"] as const)("%s activity-review evidence is diagnosed without executing the proposed action", async kind => {
  const f = await fixture(), log = jest.spyOn(chronicle, "record");
  const { WorkingMemoryIdentity } = await import("../../ecs/components");
  const { integrateActorContinuation } = await import("../actor-continuation");
  const { recordCommittedSpeech } = await import("../social-memory");
  const { captureActivityReview, snapshotActivityReview } = await import("../activity-review");
  const { recordWorkingMemoryAction } = await import("../working-memory-observation");
  integrateActorContinuation(f.world, f.actor, { purpose: "Discuss my plans", actionType: "speak", goalId: f.goal,
    goalKey: WorkingMemoryIdentity.id[f.goal], observedAtSimMs: f.world.time.elapsed });
  recordCommittedSpeech(f.world, f.actor, "I want to make plans.", undefined, Date.now(), undefined, "Describe my concern");
  recordCommittedSpeech(f.world, f.actor, "I am still deciding.", undefined, Date.now(), undefined, "Clarify my concern");
  f.world.meta.aiEnabled = false; f.t.advance(20000); f.world.meta.aiEnabled = true;
  const context = captureActivityReview(f.world, f.actor)!; expect(context).toBeDefined();
  generate.mockImplementationOnce(async () => {
    // A completed failed operation changes the practical context, not the
    // physical phone or reply arguments. The old review must be reconsidered.
    if (kind === "stale") recordWorkingMemoryAction(f.world, f.actor,
      { type: "interact", target: "Unavailable object", content: "operate" }, false);
    return { text: JSON.stringify({ ...f.response(), control: { ...f.response().control,
      activityReview: { disposition: "continue", reason: "I still want to make plans.", expectedProgress: "Decide my response.",
        ...(context.evidence.goal ? { intentionAssessment: { outcome: "unchanged", reason: "I have not chosen my response yet." } } : {}),
        evidenceIds: kind === "invalid" ? ["unknown:receipt"] : [context.evidence.contributions[0].speechId] } } }) };
  });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.reviewCount).toBe(0);
  if (kind === "stale") {
    expect(log).toHaveBeenCalledWith("decision_superseded", expect.objectContaining({ reason: "source_changed", schemaField: "control.activityReview" }));
    expect(log).not.toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ schemaField: "control.activityReview" }));
  } else {
    expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ reason: "invalid_schema", schemaField: "control.activityReview.unissued_evidence" }));
  }
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each(["priority", "situated"] as const)("%s same-goal departure and release are sequenced, not discarded or prematurely retired", async controller => {
  const f = await fixture(true, controller, 10, true);
  const { getRoomForEntity } = await import("../../ecs/location");
  const { Name } = await import("../../ecs/components");
  const { recordPrivateCommunication } = await import("../communication-memory");
  const { getCommittedEvents } = await import("../../runtime/committed-events");
  const { readSimulationTime } = await import("../../ecs/simulation-time");
  const { runCoordinationReview } = await import("../coordination-review");
  const { getCoordinationMemory, reconcileCoordinationGoals } = await import("../coordination-memory");
  const receipt = recordPrivateCommunication(f.world, f.actor, { sourceId: getCommittedEvents(f.world).sourceId!,
    messageKey: "prior-sent-appointment", channel: "phone", kind: "sent", other: "Alex",
    content: "I will meet you for dinner.", sentAtSimMs: readSimulationTime(f.world) })!;
  await runCoordinationReview(f.world, f.actor, { infer: async () => ({ reviews: [{ kind: "undertake", speechId: receipt.id,
    task: "Meet Alex for dinner", goalId: f.goal }] }) });
  expect(getCoordinationMemory(f.world, f.actor).items.some(item => item.id === receipt.id)).toBe(true);
  generate.mockResolvedValue({ text: JSON.stringify({
    control: { version: 2, goalId: f.goal, purpose: "Leave to meet my friend", localDependencies: [] },
    goalReview: { goalId: f.goal, disposition: "release", reason: "I no longer need to coordinate the reply." },
    action: { type: "move", target: "Living Room", goalId: f.goal, undertakingId: receipt.id },
  }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action.coordinationGoal).toBeDefined(); expect(Goal.status[f.goal]).toBe("active");
  expect(Name.value[getRoomForEntity(f.world, f.actor)!]).toBe("Kitchen");
  f.t.dispatch("Elaine", action);
  expect(Name.value[getRoomForEntity(f.world, f.actor)!]).toBe("Kitchen");
  f.world.meta.aiEnabled = false; f.t.advance(5000);
  expect(Name.value[getRoomForEntity(f.world, f.actor)!]).toBe("Living Room");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  f.world.meta.aiEnabled = true;
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null, purpose: "Review the completed step", localDependencies: [] },
    goalReview: { goalId: f.goal, disposition: "release", reason: "I choose to put the old coordination task aside now." }, action: { type: "think" } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(false);
  expect(JSON.stringify(generate.mock.calls.at(-1))).toContain("PENDING HANDOFF REVIEW");
  expect(Goal.status[f.goal]).toBe("retired"); expect(Goal.progress[f.goal]).toBe(0);
  reconcileCoordinationGoals(f.world, f.actor);
  expect(getCoordinationMemory(f.world, f.actor).items.find(item => item.id === receipt.id)?.localStatus).not.toBe("completed");
});

test("releasing an old concern does not grant permission to answer an unread message", async () => {
  const f = await fixture(false);
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(),
    goalReview: { goalId: cookie, disposition: "release", reason: "I am leaving that concern behind." } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false); expect(Goal.status[cookie]).toBe("retired");
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test("a supporting plan cannot commit after retiring its parent, even with different goal IDs", async () => {
  const f = await fixture();
  const { bindSupportingGoal } = await import("../goal-dependents");
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  bindSupportingGoal(f.world, f.actor, f.goal, cookie);
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(),
    goalReview: { goalId: cookie, disposition: "release", reason: "I am putting the parent purpose aside." } }) });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(Goal.status[cookie]).toBe("active"); expect(Goal.status[f.goal]).toBe("active");
  expect(PlanningDecision.reviewJson[f.plan]).toBe("");
});

test("a stale old-goal review cannot partially commit a new planner selection", async () => {
  const f = await fixture();
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  generate.mockImplementation(async () => {
    Goal.description[cookie] = "A changed concern";
    return { text: JSON.stringify({ ...f.response(), goalReview: { goalId: cookie, disposition: "release", reason: "Old context" } }) };
  });
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  expect(Goal.status[cookie]).toBe("active"); expect(PlanningDecision.reviewJson[f.plan]).toBe("");
});

test("failed departure is not replayed and does not auto-retire the queued purpose", async () => {
  const f = await fixture(true, "priority", 10, true);
  const { setLocatedIn, getRoomForEntity } = await import("../../ecs/location");
  const { pendingHandoffReview } = await import("../goal-pursuit");
  const { Name } = await import("../../ecs/components");
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: f.goal, purpose: "Leave to meet my friend", localDependencies: [] },
    goalReview: { goalId: f.goal, disposition: "release", reason: "Coordination can end after this step." },
    action: { type: "move", target: "Living Room", goalId: f.goal } }) });
  const action = await agentThink(f.world, f.actor); expect(isDiscardedForegroundDecision(action)).toBe(false);
  // The selected route was from the kitchen, not this intervening location.
  const { createRoomEntity } = await import("../../ecs/prefabs");
  setLocatedIn(f.world, f.actor, createRoomEntity(f.world, { name: "Elsewhere" }));
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(10000);
  expect(Name.value[getRoomForEntity(f.world, f.actor)!]).toBe("Elsewhere");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(pendingHandoffReview(f.world, f.actor, f.goal)).toBeDefined();
});

test("selecting a proposal cannot bypass native unread-message authorization", async () => {
  const f = await fixture(false); generate.mockResolvedValue({ text: JSON.stringify(f.response()) });
  const action = await agentThink(f.world, f.actor); f.t.dispatch("Elaine", action);
  f.world.meta.aiEnabled = false; f.t.advance(10000);
  expect(getPrivateCommunications(f.world, f.actor)).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["response", "dispatch"])("a goal replaced at %s cannot authorize stale execution", async boundary => {
  const f = await fixture(), before = getAgentThoughts(f.world, f.actor).length;
  const replace = () => { Goal.description[f.goal] = "Choose a different purpose"; };
  generate.mockImplementation(async () => { if (boundary === "response") replace(); return { text: JSON.stringify(f.response()) }; });
  const action = await agentThink(f.world, f.actor);
  if (boundary === "dispatch") replace();
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(10000);
  if (boundary === "response") {
    expect(PlanningDecision.reviewJson[f.plan]).toBe(""); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(before);
  } else {
    // A once-valid private choice is history, not something to roll back.
    expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "select" });
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(before + 1);
  }
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each(["defer", "decline"] as const)("%s a proposal while pursuing another owned goal preserves both goals and sends nothing", async disposition => {
  const f = await fixture();
  const other = createIntentGoal(f.world, f.actor, "Consider my afternoon plans", 7);
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: other,
    purpose: "Consider my afternoon plans while setting the message aside", localDependencies: [] },
    planDecision: { id: f.id, disposition, reason: "I prefer to consider my plans now.",
      ...(disposition === "defer" ? { afterSeconds: 10 } : {}) }, action: { type: "think" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition });
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.status[other]).toBe("active");
  expect(Goal.progress[f.goal]).toBe(0);
  f.world.meta.aiEnabled = false;
  f.t.advance(9000); expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  f.t.advance(1000); expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(disposition === "defer" ? 1 : 0);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test("declining can accompany a genuinely independent activity without sending", async () => {
  const f = await fixture();
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: null, purpose: "Take a moment to myself", localDependencies: [] },
    planDecision: { id: f.id, disposition: "decline", reason: "I do not want to answer now." }, action: { type: "think" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "decline" });
  expect(capturePlanDecisions(f.world, f.actor).items).toHaveLength(0);
  expect(Goal.status[f.goal]).toBe("active"); expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
});

test.each(["priority", "situated"] as const)("%s controller admits choosing a lower-priority decision while another activity remains", async controller => {
  const f = await fixture(true, controller, 6);
  const cookie = getRelationTargets(f.world, f.actor, HasGoal).find(g => Goal.description[g].toLowerCase().includes("cookie"))!;
  expect(cookie).toBeDefined(); expect(Goal.priority[cookie]).toBeGreaterThan(Goal.priority[f.goal]);
  generate.mockResolvedValue({ text: JSON.stringify({ control: { version: 2, goalId: cookie,
    purpose: "Consider what happened to my cookie", localDependencies: [] }, action: { type: "think" } }) });
  const first = await agentThink(f.world, f.actor); expect(isDiscardedForegroundDecision(first)).toBe(false);
  f.t.dispatch("Elaine", first);
  generate.mockResolvedValue({ text: JSON.stringify({ ...f.response(), control: { ...f.response().control, activityDisposition: "replace" } }) });
  const action = await agentThink(f.world, f.actor);
  expect(generate).toHaveBeenCalledTimes(2); expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(JSON.parse(PlanningDecision.reviewJson[f.plan])).toMatchObject({ disposition: "select" });
  expect(Goal.status[cookie]).toBe("active"); // Selecting dinner need not erase the other concern.
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toHaveLength(0);
  f.t.dispatch("Elaine", action); f.world.meta.aiEnabled = false; f.t.advance(15000);
  expect(getPrivateCommunications(f.world, f.actor).filter(r => r.own)).toEqual([expect.objectContaining({ content: "Yes, tomorrow works." })]);
});
