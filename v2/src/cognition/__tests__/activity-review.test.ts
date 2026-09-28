import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } from "../../ecs/prefabs";
import { Agent, Goal, ObjectState, SocialMemory, WorkingMemory, WorkingMemoryIdentity } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { setLocatedIn } from "../../ecs/location";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { withSimulationTask } from "../../runtime/task-scope";
import { workingMemoryEntityRef, getWorkingMemory, formatWorkingMemoryContext } from "../working-memory";
import { captureWorkingMemoryAction, recordWorkingMemoryAction } from "../working-memory-observation";
import { snapshotOngoingActivity } from "../ongoing-activity";
import { recordCommittedSpeech, getSocialClosures, getSocialDialogue } from "../social-memory";
import { createPersonalIntention } from "../goal-lifecycle";
import { integrateActorContinuation } from "../actor-continuation";
import { captureActivityReview, formatActivityReview, prepareActivityReview, snapshotActivityReview, recordActivitySpeech, activityReviewEvidenceDiagnostic } from "../activity-review";
type Context = NonNullable<ReturnType<typeof captureActivityReview>>;
test("reviews retain a bounded history of authored expectations without treating old citations as current evidence", () => {
  const f = fixture(); let context = f.ready();
  const firstOwn = context.evidence.contributions[0].speechId;
  expect(context.evidence.recentReviews).toEqual([]);
  for (let i = 0; i < 5; i++) {
    const before = captureActivityReview(f.world, f.actor)!;
    expect(before.evidence.recentReviews).toHaveLength(Math.min(i, 3));
    const chosen = proposal(context, { reason: `I choose exchange ${i}`,
      expectedProgress: `Hear the next reaction ${i}` });
    const prepared = prepareActivityReview(context, chosen)!;
    expect(prepared.current()).toBe(true);
    expect(captureActivityReview(f.world, f.actor)!.evidence.recentReviews).toEqual(before.evidence.recentReviews);
    expect(prepared.commit()).toBe(true); expect(prepared.commit()).toBe(false);
    f.speak(`My contribution ${i}`); f.hear(`Another reaction ${i}`); f.speak(`My response ${i}`); f.advance();
    context = captureActivityReview(f.world, f.actor)!;
    expect(context.evidence.recentReviews.at(-1)).toMatchObject({ reason: chosen.reason,
      expectedProgress: chosen.expectedProgress, disposition: "continue", atSimMs: before.observedAtSimMs });
  }
  expect(context.evidence.recentReviews.map(r => r.expectedProgress)).toEqual([
    "Hear the next reaction 2", "Hear the next reaction 3", "Hear the next reaction 4"]);
  expect(context.evidence.recentReviews.at(-1)).toMatchObject({ assessedExpectation: "Hear the next reaction 3", previousOutcome: "unresolved" });
  expect(Object.isFrozen(context.evidence.recentReviews)).toBe(true);
  expect(Object.isFrozen(context.evidence.recentReviews[0])).toBe(true);
  expect(Object.isFrozen(context.evidence.recentReviews[0].evidenceIds)).toBe(true);
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [firstOwn] }))).toBeUndefined();
  expect(formatActivityReview(context)).toContain("necessary before your next useful action");
  expect(formatActivityReview(context)).toContain("earlier interpretations, not current evidence");
  expect(formatActivityReview(context)).not.toContain("PRIVATE PEER PURPOSE");
  expect(Goal.progress[f.goal]).toBe(0);
});

test.each(["owner", "source", "persona", "rewind"])("%s change cannot carry review history into a replacement encounter", change => {
  const f = fixture(), context = f.ready();
  expect(prepareActivityReview(context, proposal(context))?.commit()).toBe(true);
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "persona") Agent.systemPrompt[f.actor] = "A different character";
  if (change === "rewind") f.world.time.elapsed = 0;
  f.speak("A new beginning."); f.hear("What now?"); f.speak("I am considering it."); f.advance();
  expect(captureActivityReview(f.world, f.actor)?.evidence.recentReviews).toEqual([]);
});

test("deliberate company and genuinely needed information both remain valid choices after repeated reviews", () => {
  const f = fixture(); let context = f.ready();
  for (const reason of ["I enjoy Bo's company and choose to spend this time together.",
    "Bo has the address I need before I can choose where to go."]) {
    const pending = prepareActivityReview(context, proposal(context, { reason, expectedProgress: "Listen to Bo" }))!;
    expect(pending.commit()).toBe(true);
    f.speak("Tell me more."); f.hear("Let me explain."); f.speak("I am listening."); f.advance();
    context = captureActivityReview(f.world, f.actor)!;
  }
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("active");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});

test("diagnostic readers cannot alter review history, and save data does not turn it into restored authority", async () => {
  const f = fixture(), context = f.ready();
  expect(prepareActivityReview(context, proposal(context, { reason: "PRIVATE_RUNTIME_REVIEW_89" }))?.commit()).toBe(true);
  const snapshot = snapshotActivityReview(f.world, f.actor)!;
  snapshot.recentReviews[0].reason = "Changed outside the controller";
  snapshot.recentReviews[0].evidenceIds.push("invented:receipt");
  snapshot.recentReviews[0].intentionAssessment!.reason = "Invented progress";
  snapshot.recentReviews[0].assessedIntention!.description = "A substituted goal";
  const actual = snapshotActivityReview(f.world, f.actor)!;
  expect(actual.recentReviews[0].reason).toBe("PRIVATE_RUNTIME_REVIEW_89");
  expect(actual.recentReviews[0].evidenceIds).not.toContain("invented:receipt");
  expect(actual.recentReviews[0].intentionAssessment!.reason).toBe("The larger concern remains unresolved.");
  expect(actual.recentReviews[0].assessedIntention!.description).toBe(Goal.description[f.goal]);
  const { serializeWorld } = await import("../../persistence/world-persistence");
  const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
  expect(JSON.stringify(serializeWorld(f.world, createSystemRegistry()))).not.toContain("PRIVATE_RUNTIME_REVIEW_89");
});

test("issued review prompt states the required bounded response contract", () => {
  const f = fixture(); const prompt = formatActivityReview(f.ready());
  expect(prompt).toContain("requires control.activityReview");
  expect(prompt).toContain("1–6 unique evidenceIds");
  expect(prompt).toContain("at most 400 characters");
  expect(formatActivityReview(undefined)).toBe("");
});
test("rejection diagnostics identify the invalid contract field without copying private values", () => {
  const f=fixture(),context=f.ready();
  for(const [value,field] of [
    [undefined,"missing"],
    [proposal(context,{reason:"PRIVATE".repeat(100)}),"reason"],
    [proposal(context,{evidenceIds:["PRIVATE_UNISSUED_RECEIPT"]}),"unissued_evidence"],
    [proposal(context,{disposition:"close",expectedProgress:"PRIVATE"}),"expectedProgress"],
  ] as const){
    const fields:string[]=[];
    expect(prepareActivityReview(context,value,undefined,f=>fields.push(f))).toBeUndefined();
    expect(fields).toEqual([`control.activityReview.${field}`]);
  }
  expect(snapshotActivityReview(f.world,f.actor)?.reviewCount).toBe(0);
});
test("reference audits retain source categories and fingerprints without changing citation authority", () => {
  const f = fixture(), context = f.ready();
  const own = context.evidence.dialogue.find(t => t.own)!.speechId;
  const value = proposal(context, { evidenceIds: [own, own.replace(/^speech:/, ""), "PRIVATE_UNISSUED_RECEIPT", context.evidence.episodeId] });
  const before = snapshotActivityReview(f.world, f.actor);
  const audit = activityReviewEvidenceDiagnostic(context, value)!;
  expect(audit.cited).toMatchObject([
    { source: "own_speech" }, { source: "unknown", matchesSpeechWithoutPrefix: true },
    { source: "unknown" }, { source: "episode" },
  ]);
  expect(JSON.stringify(audit)).not.toMatch(/PRIVATE|speech:|engagement:/);
  expect(audit.cited[0].hash).toHaveLength(64);
  expect(activityReviewEvidenceDiagnostic(context, value)).toEqual(audit);
  expect(prepareActivityReview(context, value)).toBeUndefined();
  expect(snapshotActivityReview(f.world, f.actor)).toEqual(before);
  expect(activityReviewEvidenceDiagnostic(undefined, value)).toBeUndefined();
  expect(activityReviewEvidenceDiagnostic(context, { evidenceIds: Array(20).fill("PRIVATE") })?.cited).toHaveLength(6);
});
function fixture() {
  const world = createArgosWorld(); initializePrefabs(world); startCommittedEvents(world);
  const room = createRoomEntity(world, { name: "Lounge" }), elsewhere = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "Choose your own purposes.", roomId: room });
  const peer = createAgentEntity(world, { name: "Bo", role: "friend", systemPrompt: "PRIVATE PEER PURPOSE", roomId: room });
  workingMemoryEntityRef(world, actor); workingMemoryEntityRef(world, peer);
  const goal = createPersonalIntention(world, actor, "Talk over what happened", 8)!;
  const choose = (selected: boolean) => integrateActorContinuation(world, actor, { purpose: selected ? "Tell Bo what happened" : "An independent response",
    actionType: selected ? "speak" : "wait", observedAtSimMs: world.time.elapsed,
    ...(selected ? { goalId: goal, goalKey: WorkingMemoryIdentity.id[goal] } : {}) });
  choose(true);
  const speak = (words: string) => recordCommittedSpeech(world, actor, words, "Bo", Date.now(), undefined, "Describe my experience")!;
  const hear = (words: string) => recordCommittedSpeech(world, peer, words, "Ada", Date.now(), undefined, "PRIVATE PEER PURPOSE")!;
  const advance = (ms = 20_000) => advanceSimulationTime(world, world.time.tick + 1, ms);
  const ready = () => { speak("The meeting was difficult."); hear("What happened?"); speak("They did not listen to me."); advance(); return captureActivityReview(world, actor)!; };
  return { world, room, elsewhere, actor, peer, goal, speak, hear, advance, choose, ready };
}
function proposal(context: Context, extra: Record<string, unknown> = {}) {
  return { disposition: "continue", reason: "I want to explain what happened and hear their view.",
    evidenceIds: context.evidence.dialogue.filter(turn => turn.own).slice(-1).map(turn => turn.speechId),
    ...(context.evidence.goal ? { intentionAssessment: { outcome: "unchanged", reason: "The larger concern remains unresolved." } } : {}),
    expectedProgress: "Hear Bo's view.", ...(context.evidence.previousExpectedProgress ? {
      previousOutcome: "unresolved", previousAssessment: "The requested view is still missing from this exchange." } : {}), ...extra };
}

test("a conversational expectation can be met without advancing the organizing intention", () => {
  const f = fixture();
  Goal.description[f.goal] = "Find a concrete explanation for the card and decide how to follow up";
  f.choose(true);
  const first = f.ready();
  expect(prepareActivityReview(first, proposal(first, { expectedProgress: "Hear Bo's reaction to the card" }))?.commit()).toBe(true);
  f.speak("What do you think of the card?"); f.hear("Someone must be watching us!");
  f.speak("That is a theory, not an explanation."); f.advance();
  const next = captureActivityReview(f.world, f.actor)!;
  const value = proposal(next, { previousOutcome: "met", previousAssessment: "Bo gave the reaction I asked for.",
    intentionAssessment: { outcome: "unchanged", reason: "His reaction supplies no new explanation and is not needed to contact the sender." },
    disposition: "pause", reason: "I can pursue the sender myself without Bo's agreement.", expectedProgress: "Choose my next step using the card and the message." });
  const review = prepareActivityReview(next, value)!;
  expect(review).toBeDefined(); expect(review.commit()).toBe(true);
  const row = snapshotActivityReview(f.world, f.actor)!.recentReviews.at(-1)!;
  expect(row).toMatchObject({ previousOutcome: "met", intentionAssessment: value.intentionAssessment,
    assessedIntention: { id: f.goal, description: Goal.description[f.goal] } });
  expect(Goal.progress[f.goal]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
  expect(formatActivityReview(next)).toContain("A met conversational expectation does not establish intention progress");
});

test.each(["advanced", "sustained", "unchanged", "blocked"] as const)("%s is an actor interpretation, not a forced disposition or goal update", outcome => {
  const f = fixture(), context = f.ready();
  const reasons = { advanced: "Bo gave the address I needed to choose a destination.",
    sustained: "We are enjoying each other's company, which is what I want now.",
    unchanged: "No new practical information; I nevertheless choose some company.",
    blocked: "Bo is the only person here who knows the address; I choose to hear it." };
  const choice = proposal(context, { intentionAssessment: { outcome, reason: reasons[outcome] } });
  expect(prepareActivityReview(context, choice)?.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("active");
  expect(Goal.progress[f.goal]).toBe(0); expect(Goal.status[f.goal]).toBe("active");
});

test("intention guidance distinguishes ongoing experience from merely continuing an investigation's topic", () => {
  const f = fixture(), context = f.ready(), prompt = formatActivityReview(context);
  expect(context.evidence.goal).toBeDefined();
  expect(prompt).toContain("maintaining the ongoing state or experience this intention seeks");
  expect(prompt).toContain("Continuing the same topic is not itself sustaining an intention");
  expect(prompt).toContain("An investigation can remain unchanged while you enjoy the conversation");
  expect(prompt).toContain("uncertainty can remain while you choose an available way to seek information");
  expect(prompt).toContain("This is your interpretation, not a goal update");
  expect(prompt).toContain("compared with an available alternative");
  expect(prompt).toContain("Choosing company, listening or venting is valid");
  expect(prompt).toContain("Proposals are options, not completed evidence or obligations");
});

test.each([undefined, null, {}, { outcome: "complete", reason: "Done" },
  { outcome: "advanced", reason: "" }, { outcome: "advanced", reason: "x".repeat(401) },
  { outcome: "advanced", reason: "Done", goalId: -1 }])("malformed intention assessment has a bounded field diagnostic (%j)", intentionAssessment => {
  const f = fixture(), context = f.ready(), fields: string[] = [];
  expect(prepareActivityReview(context, proposal(context, { intentionAssessment }), undefined, f => fields.push(f))).toBeUndefined();
  expect(fields).toEqual(["control.activityReview.intentionAssessment"]);
  expect(snapshotActivityReview(f.world, f.actor)?.reviewCount).toBe(0);
});

test.each(["identity", "description", "status", "contract"])("changed assessed intention %s fences a prepared review", kind => {
  const f = fixture(), context = f.ready(), pending = prepareActivityReview(context, proposal(context))!;
  if (kind === "identity") WorkingMemoryIdentity.id[f.goal] = "replacement-goal";
  if (kind === "description") Goal.description[f.goal] = "A different purpose";
  if (kind === "status") Goal.status[f.goal] = "retired";
  if (kind === "contract") Goal.successJson[f.goal] = JSON.stringify({ type: "custom", description: "New success condition" });
  expect(pending.commit()).toBe(false);
});

test.each(["independent", "foreign"])("%s conversation cannot invent an assessed intention", kind => {
  const f = fixture(); f.ready();
  const foreign = createPersonalIntention(f.world, f.peer, "PRIVATE PEER INTENTION", 9)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Choose some company", actionType: "wait",
    observedAtSimMs: f.world.time.elapsed, activityDisposition: "end",
    ...(kind === "foreign" ? { goalId: foreign, goalKey: WorkingMemoryIdentity.id[foreign] } : {}) });
  const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.goal).toBeUndefined();
  expect(formatActivityReview(context)).not.toContain("PRIVATE PEER INTENTION");
  const fields: string[] = [];
  expect(prepareActivityReview(context, proposal(context, {
    intentionAssessment: { outcome: "advanced", reason: "Invented goal progress" },
  }), undefined, f => fields.push(f))).toBeUndefined();
  expect(fields).toEqual(["control.activityReview.intentionAssessment"]);
  expect(prepareActivityReview(context, proposal(context))?.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.recentReviews.at(-1)?.assessedIntention).toBeUndefined();
});
test("a review can cite an exact witnessed native outcome without claiming the witness performed it", () => {
  const f = fixture(); f.ready();
  const item = createObjectEntity(f.world, { name: "Pastry", roomId: f.room });
  ObjectState.current[item] = "whole";
  integrateActorContinuation(f.world, f.peer, { purpose: "PRIVATE PEER PURPOSE", actionType: "interact", target: "Pastry", observedAtSimMs: f.world.time.elapsed });
  const action = { type: "interact" as const, target: "Pastry", content: "PRIVATE COMMAND" };
  const before = captureWorkingMemoryAction(f.world, f.peer, action);
  ObjectState.current[item] = "eaten; only crumbs remain";
  recordWorkingMemoryAction(f.world, f.peer, action, true, { before });
  const witness = getWorkingMemory(f.world, f.actor).receipts.find(r => r.provenance === "witnessed_action")!;
  expect(witness).toBeDefined();
  expect(formatWorkingMemoryContext(f.world, f.actor, Date.now(), { fullReceiptIds: true })).toContain(witness.id);
  const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.situation.physicalOutcomes).toContainEqual(expect.objectContaining({ id: witness.id, provenance: "witnessed_action", succeeded: true }));
  const outcome = context.evidence.situation.physicalOutcomes.find(r => r.id === witness.id)!;
  expect(outcome.attemptedPurpose).toBeUndefined(); expect(outcome.historicalIntention).toBeUndefined();
  expect(formatActivityReview(context)).not.toContain("PRIVATE");
  const ownId = context.evidence.contributions[0].speechId;
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [ownId, witness.id.split(":").slice(0, -1).join(":")] }))).toBeUndefined();
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [witness.id] }))).toBeUndefined();
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [ownId, witness.id] }))?.commit()).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0);
});

test("remote and foreign-world receipts are not review authority even when their IDs are known", () => {
  const foreign = fixture();
  recordWorkingMemoryAction(foreign.world, foreign.actor, { type: "interact", target: "Unavailable", content: "operate" }, false);
  const other = getWorkingMemory(foreign.world, foreign.actor).receipts.find(r => r.kind === "action")!;
  const f = fixture(); f.ready();
  setLocatedIn(f.world, f.peer, f.elsewhere);
  const item = createObjectEntity(f.world, { name: "Remote pastry", roomId: f.elsewhere }); ObjectState.current[item] = "whole";
  const action = { type: "interact" as const, target: "Remote pastry", content: "eat" };
  const before = captureWorkingMemoryAction(f.world, f.peer, action);
  ObjectState.current[item] = "eaten"; recordWorkingMemoryAction(f.world, f.peer, action, true, { before });
  const remote = getWorkingMemory(f.world, f.peer).receipts.find(r => r.kind === "action")!;
  const context = captureActivityReview(f.world, f.actor)!;
  for (const id of [remote.id, other.id, "private:phone", "unknown"])
    expect(prepareActivityReview(context, proposal(context, { evidenceIds: [context.evidence.contributions[0].speechId, id] }))).toBeUndefined();
  expect(formatActivityReview(context)).not.toContain("Remote pastry");
});

test.each(["changed", "removed", "owner", "source"])("a %s witnessed receipt cannot validate a pending interpretation", change => {
  const f = fixture(); f.ready();
  const item = createObjectEntity(f.world, { name: "Pastry", roomId: f.room }); ObjectState.current[item] = "whole";
  const action = { type: "interact" as const, target: "Pastry", content: "eat" };
  const before = captureWorkingMemoryAction(f.world, f.peer, action);
  ObjectState.current[item] = "eaten"; recordWorkingMemoryAction(f.world, f.peer, action, true, { before });
  const context = captureActivityReview(f.world, f.actor)!;
  const id = context.evidence.situation.physicalOutcomes.find(r => r.provenance === "witnessed_action")!.id;
  const value = proposal(context, { evidenceIds: [context.evidence.contributions[0].speechId, id] });
  const pending = prepareActivityReview(context, value)!;
  if (change === "changed" || change === "removed") {
    const rows = JSON.parse(WorkingMemory.receiptsJson[f.actor]);
    if (change === "changed") rows.find((r: { id: string }) => r.id === id).summary = "Changed after issuance";
    WorkingMemory.receiptsJson[f.actor] = JSON.stringify(change === "removed" ? rows.filter((r: { id: string }) => r.id !== id) : rows);
  }
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  expect(pending.current()).toBe(false); expect(pending.commit()).toBe(false);
  let stale = false;
  expect(prepareActivityReview(context, value, () => { stale = true; })).toBeUndefined();
  expect(stale).toBe(true);
});

test("review citations and displayed action receipts share one bounded window, including failed attempts", () => {
  const f = fixture(); f.ready();
  for (let i = 0; i < 10; i++) recordWorkingMemoryAction(f.world, f.actor,
    { type: "interact", target: `Unavailable ${i}`, content: "operate" }, false);
  const receipts = getWorkingMemory(f.world, f.actor).receipts.filter(r => r.kind === "action");
  const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.situation.physicalOutcomes.map(r => r.id)).toEqual(receipts.slice(-8).map(r => r.id));
  const prompt = formatWorkingMemoryContext(f.world, f.actor, Date.now(), { fullReceiptIds: true });
  for (const r of context.evidence.situation.physicalOutcomes) {
    expect(prompt).toContain(r.id); expect(r.succeeded).toBe(false);
    expect(prepareActivityReview(context, proposal(context, { evidenceIds: [context.evidence.contributions[0].speechId, r.id] }))).toBeDefined();
  }
  let stale = false;
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [context.evidence.contributions[0].speechId, receipts[0].id] }), () => { stale = true; })).toBeUndefined();
  expect(stale).toBe(false);
});
test("review keeps the organizing activity while an immediate side response has no selected goal", () => {
  const f = fixture(); f.ready(); f.choose(false);
  const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.purpose).toBe("An independent response");
  expect(context.evidence.goal?.id).toBe(f.goal);
  expect(context.evidence.situation.organizingActivity).toMatchObject({ id: snapshotOngoingActivity(f.world, f.actor)!.id,
    intention: { description: "Talk over what happened" } });
  expect(formatActivityReview(context)).not.toContain("PRIVATE PEER PURPOSE");
});
test("physical failure invalidates a pending review; a fresh review can cite it without being forced to stop socializing", () => {
  const f = fixture(), context = f.ready(), pending = prepareActivityReview(context, proposal(context))!;
  const action = { type: "interact" as const, target: "Missing object", content: "operate" };
  const before = captureWorkingMemoryAction(f.world, f.actor, action);
  recordWorkingMemoryAction(f.world, f.actor, action, false, { before, summary: "Operation failed; the object is unavailable." });
  expect(pending.current()).toBe(false); expect(pending.commit()).toBe(false);
  const fresh = captureActivityReview(f.world, f.actor)!, outcome = fresh.evidence.situation.physicalOutcomes[0];
  expect(outcome.succeeded).toBe(false);
  const choice = proposal(fresh, { evidenceIds: [fresh.evidence.contributions[0].speechId, outcome.id],
    reason: "The practical attempt failed. I still want Bo's company; we can talk without pretending the work is done." });
  expect(prepareActivityReview(fresh, choice)?.commit()).toBe(true);
  expect(Goal.progress[f.goal]).toBe(0);
});
test("review situation is deeply immutable; replacement of its organizing goal fences the old interpretation", () => {
  const f = fixture(), context = f.ready(), pending = prepareActivityReview(context, proposal(context))!;
  expect(Object.isFrozen(context.evidence.situation.organizingActivity?.intention)).toBe(true);
  Goal.description[f.goal] = "A different purpose";
  expect(pending.commit()).toBe(false);
});
test("continuing a conversation retains cumulative encounter time across review windows", () => {
  const f = fixture(), first = f.ready();
  expect(first.evidence).toMatchObject({ elapsedSimMs: 20_000, encounterElapsedSimMs: 20_000, reviewCount: 0 });
  expect(prepareActivityReview(first, proposal(first))?.commit()).toBe(true);
  f.speak("I am still enjoying this conversation."); f.hear("So am I."); f.speak("Let us keep talking.");
  f.advance(30_000);
  const second = captureActivityReview(f.world, f.actor)!;
  expect(second.evidence).toMatchObject({ elapsedSimMs: 30_000, encounterElapsedSimMs: 50_000, reviewCount: 1 });
  expect(prepareActivityReview(second, proposal(second, { previousOutcome: "sustained" }))?.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("active");
});

test("a new conversational benefit cannot silently replace assessment of the prior expectation", () => {
  const f = fixture(), first = f.ready();
  expect(prepareActivityReview(first, proposal(first, { expectedProgress: "Learn why the meeting was cancelled" }))?.commit()).toBe(true);
  f.speak("Why was it cancelled?"); f.hear("They do love meetings about meetings."); f.speak("That is painfully true."); f.advance();
  const next = captureActivityReview(f.world, f.actor)!;
  const choice = proposal(next, { previousOutcome: "unresolved", previousAssessment: "Bo joked but gave no reason for the cancellation.",
    reason: "I want to laugh with Bo for a while even though I still lack the answer.", expectedProgress: "Enjoy each other's company" });
  const missing = { ...choice } as any; delete missing.previousAssessment;
  expect(prepareActivityReview(next, missing)).toBeUndefined();
  expect(prepareActivityReview(next, choice)?.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)).toMatchObject({ status: "active", previousOutcome: "unresolved",
    assessedExpectation: "Learn why the meeting was cancelled", previousAssessment: "Bo joked but gave no reason for the cancellation.",
    expectedProgress: "Enjoy each other's company" });
  expect(Goal.progress[f.goal]).toBe(0);
});

test("an answered expectation can be met while conversation continues without completing the organizing goal", () => {
  const f = fixture(), first = f.ready();
  expect(prepareActivityReview(first, proposal(first))?.commit()).toBe(true);
  f.speak("What is your view?"); const reply = f.hear("They should have listened to you."); f.speak("Thank you."); f.advance();
  const next = captureActivityReview(f.world, f.actor)!;
  expect(prepareActivityReview(next, proposal(next, { previousOutcome: "met", previousAssessment: "Bo gave the view I asked for.",
    evidenceIds: [next.evidence.contributions[0].speechId, reply.id], reason: "I still want their company.",
    expectedProgress: "Enjoy the rest of our visit" }))?.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("active");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
});
test("reading and silent elapsed time never open or reset an encounter; real receipts open it", () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) expect(captureActivityReview(f.world, f.actor)).toBeUndefined();
  expect(snapshotActivityReview(f.world, f.actor)).toBeUndefined();
  f.advance(90_000); f.hear("I have plenty to say.");
  expect(captureActivityReview(f.world, f.actor)).toBeUndefined();
  f.speak("The meeting was difficult."); f.speak("I am still deciding.");
  expect(captureActivityReview(f.world, f.actor)).toBeUndefined();
  f.advance();
  const before = snapshotActivityReview(f.world, f.actor), context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.contributions).toHaveLength(2); expect(context.evidence.elapsedSimMs).toBe(20_000);
  for (let i = 0; i < 5; i++) captureActivityReview(f.world, f.actor);
  expect(snapshotActivityReview(f.world, f.actor)).toEqual(before);
  expect(formatActivityReview(context)).toContain("NOT A VERDICT THAT YOU MUST STOP");
});
test("goal/null flips retain encounter, completed outcomes and the prior expectation until an actual review commits", () => {
  const f = fixture(), context = f.ready(), initial = snapshotActivityReview(f.world, f.actor)!;
  for (let i = 0; i < 8; i++) { f.choose(i % 2 === 0); captureActivityReview(f.world, f.actor); }
  expect(snapshotActivityReview(f.world, f.actor)).toEqual(initial);
  const prepared = prepareActivityReview(context, proposal(context))!;
  expect(snapshotActivityReview(f.world, f.actor)?.reviewCount).toBe(0);
  expect(prepared.commit()).toBe(true); expect(prepared.commit()).toBe(false);
  f.choose(false); f.speak("I am still wondering."); const reply = f.hear("I think they should hear you out."); f.speak("That helps."); f.advance();
  f.choose(true); const next = captureActivityReview(f.world, f.actor)!;
  expect(next.evidence.episodeId).toBe(initial.episodeId);
  expect(next.evidence.previousExpectedProgress).toBe("Hear Bo's view.");
  expect(next.evidence.dialogue).toContainEqual(expect.objectContaining({ speechId: reply.id, content: "I think they should hear you out.", own: false }));
  expect(formatActivityReview(next)).not.toContain("PRIVATE PEER PURPOSE");
  const value = proposal(next); delete (value as any).previousOutcome;
  expect(prepareActivityReview(next, value)).toBeUndefined();
  expect(prepareActivityReview(next, proposal(next, { previousOutcome: "sustained", reason: "Bo offered a view; I want their company.", expectedProgress: "Stay with Bo." }))!.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.reviewCount).toBe(2);
  expect(Goal.status[f.goal]).toBe("active");
});
test.each(["room", "owner", "source", "stopped", "persona", "rewind"])("a prepared review cannot settle a changed %s encounter", change => {
  const f = fixture(), context = f.ready(), review = prepareActivityReview(context, proposal(context))!;
  if (change === "room") setLocatedIn(f.world, f.actor, f.elsewhere);
  if (change === "owner") WorkingMemoryIdentity.id[f.actor] = "replacement";
  if (change === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
  if (change === "stopped") stopCommittedEvents(f.world);
  if (change === "persona") Agent.systemPrompt[f.actor] = "A different person";
  if (change === "rewind") f.world.time.elapsed = 0;
  expect(review.current()).toBe(false); expect(review.commit()).toBe(false);
});

test("a continuing organizing activity carries completed evidence and review expectations across rooms", () => {
  const f = fixture(), first = f.ready();
  workingMemoryEntityRef(f.world, f.elsewhere);
  expect(prepareActivityReview(first, proposal(first))?.commit()).toBe(true);
  f.speak("I still want to understand."); f.hear("Let us walk into the hall.");
  f.speak("All right."); f.advance();
  const old = captureActivityReview(f.world, f.actor)!;
  const pending = prepareActivityReview(old, proposal(old))!;
  setLocatedIn(f.world, f.actor, f.elsewhere);
  expect(pending.commit()).toBe(false);
  // Hearing is still local; continuity cannot import a remote reply.
  f.hear("PRIVATE REMOTE ANSWER");
  const next = captureActivityReview(f.world, f.actor)!;
  expect(next.evidence.episodeId).toBe(first.evidence.episodeId);
  expect(next.evidence.previousExpectedProgress).toBe("Hear Bo's view.");
  expect(next.evidence.encounterElapsedSimMs).toBe(40_000);
  expect(next.evidence.dialogue.every(turn => turn.room === "Lounge")).toBe(true);
  expect(formatActivityReview(next)).not.toContain("PRIVATE REMOTE ANSWER");
  expect(prepareActivityReview(next, proposal(next))?.commit()).toBe(true);
});

test("personally heard speech during a detour remains citable when the old encounter resumes", () => {
  const f = fixture(); f.ready();
  const other = createPersonalIntention(f.world, f.actor, "Check my phone", 7)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Check my phone", actionType: "move", goalId: other,
    goalKey: WorkingMemoryIdentity.id[other], activityDisposition: "replace", observedAtSimMs: f.world.time.elapsed });
  setLocatedIn(f.world, f.actor, f.elsewhere); setLocatedIn(f.world, f.peer, f.elsewhere);
  const heard = f.hear("Did you check your phone?");
  expect(getSocialDialogue(f.world, f.actor).some(t => t.id === heard.id)).toBe(true);
  expect(captureActivityReview(f.world, f.actor)).toBeUndefined(); // Hearing never opens/transplants activity.
  setLocatedIn(f.world, f.actor, f.room); setLocatedIn(f.world, f.peer, f.room);
  f.speak("Yes. Now about what you said earlier.");
  const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.dialogue).toContainEqual(expect.objectContaining({ speechId: heard.id, own: false, room: "Hall" }));
  expect(prepareActivityReview(context, proposal(context, { evidenceIds: [context.evidence.contributions.at(-1)!.speechId, heard.id] }))?.commit()).toBe(true);
});

test("moving without the same ongoing activity cannot transplant an old encounter", () => {
  const f = fixture(); f.ready();
  workingMemoryEntityRef(f.world, f.elsewhere);
  const replacement = createPersonalIntention(f.world, f.actor, "Start a different activity", 8)!;
  integrateActorContinuation(f.world, f.actor, { purpose: "Do something else", actionType: "move",
    goalId: replacement, goalKey: WorkingMemoryIdentity.id[replacement], activityDisposition: "replace", observedAtSimMs: f.world.time.elapsed });
  setLocatedIn(f.world, f.actor, f.elsewhere);
  expect(captureActivityReview(f.world, f.actor)).toBeUndefined();
});
test("competing prepared reviews, copied tokens and later edited payloads cannot overwrite a newer outcome", () => {
  const f = fixture(), context = f.ready(), value = proposal(context);
  const earlier = prepareActivityReview(context, value)!, newer = prepareActivityReview(captureActivityReview(f.world, f.actor)!, proposal(context, { expectedProgress: "Quiet company." }))!;
  expect(prepareActivityReview({ ...context }, value)).toBeUndefined();
  value.expectedProgress = "MUTATED"; value.evidenceIds.push("invented");
  expect(newer.commit()).toBe(true); expect(earlier.current()).toBe(false); expect(earlier.commit()).toBe(false);
  expect(snapshotActivityReview(f.world, f.actor)?.expectedProgress).toBe("Quiet company.");
});
test("review dispositions and previous outcomes are typed values, not coerced objects or arrays", () => {
  const f = fixture(), context = f.ready();
  for (const disposition of [["continue"], { toString: () => "continue" }, null, true])
    expect(prepareActivityReview(context, proposal(context, { disposition }))).toBeUndefined();
  expect(prepareActivityReview(context, proposal(context))!.commit()).toBe(true);
  f.speak("I still want to understand."); f.hear("I can stay with you."); f.speak("Thank you."); f.advance();
  const next = captureActivityReview(f.world, f.actor)!;
  for (const previousOutcome of [["sustained"], { toString: () => "sustained" }, null, true])
    expect(prepareActivityReview(next, proposal(next, { previousOutcome }))).toBeUndefined();
  for (const previousAssessment of [undefined, "", " ", "x".repeat(401), "bad\nvalue", {}, ["met"]])
    expect(prepareActivityReview(next, proposal(next, { previousAssessment }))).toBeUndefined();
  expect(prepareActivityReview(next, proposal(next, { assessedExpectation: "A model-invented replacement expectation" }))).toBeUndefined();
});
test("a continued review consumes only captured receipts; late speech remains available for the next review", () => {
  const f = fixture(), context = f.ready(), prepared = prepareActivityReview(context, proposal(context))!;
  const late = f.speak("Something new I did not say before capture.");
  expect(prepared.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.completedContributions).toBe(1);
  f.hear("Tell me more."); f.speak("Here is the rest."); f.advance();
  expect(captureActivityReview(f.world, f.actor)?.evidence.dialogue.some(turn => turn.speechId === late.id)).toBe(true);
});
test.each(["pause", "close"])("%s is unilateral and evidence-backed, not a goal/emotion/consent success", disposition => {
  const f = fixture(); const own = f.speak("I want to explain."); f.speak("It is okay if now is not a good time."); f.advance();
  const context = captureActivityReview(f.world, f.actor)!, id = context.evidence.episodeId;
  const review = prepareActivityReview(context, proposal(context, { disposition, reason: "I choose to give this exchange some space.",
    ...(disposition === "close" ? { expectedProgress: undefined } : {}) }))!;
  expect(review.commit()).toBe(true);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe(disposition === "close" ? "closed" : "paused");
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  if (disposition === "close") {
    expect(getSocialClosures(f.world, f.actor)).toMatchObject([{ kind: "engagement", evidence: [expect.objectContaining({ own: true })] }]);
    expect(getSocialClosures(f.world, f.peer)).toEqual([]);
  }
  recordActivitySpeech(f.world, f.actor, own); recordActivitySpeech(f.world, f.actor, { ...own });
  expect(snapshotActivityReview(f.world, f.actor)?.episodeId).toBe(id);
  f.hear("Take your time."); expect(snapshotActivityReview(f.world, f.actor)?.status).toBe(disposition === "close" ? "closed" : "paused");
  f.speak("I want to pick this up again.");
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("active");
  expect(snapshotActivityReview(f.world, f.actor)?.episodeId === id).toBe(disposition === "pause");
});

test("an unresolved exchange can pause while another concern becomes the organizing activity, without anyone agreeing", () => {
  const f = fixture(); f.speak("Will you return what I lent you?");
  f.hear("Why are you always making such a fuss?"); f.speak("I asked because I need it."); f.advance();
  const context = captureActivityReview(f.world, f.actor)!;
  const other = createPersonalIntention(f.world, f.actor, "Check on my own work in the hall", 6)!;
  // Capture again after authoring the competing concern; neither that goal
  // nor the review authors a physical action or resolves the original desire.
  const fresh = captureActivityReview(f.world, f.actor)!;
  expect(formatActivityReview(fresh)).toContain("what still depends on someone else's choice");
  expect(formatActivityReview(fresh)).toContain("leave the concern unresolved");
  expect(prepareActivityReview(fresh, proposal(fresh, { disposition: "pause",
    reason: "I have asked clearly. Returning it depends on Bo; I can check my work now.",
    expectedProgress: "Check my own work while leaving the request unresolved" }))?.commit()).toBe(true);
  integrateActorContinuation(f.world, f.actor, { purpose: "Check my own work", goalId: other,
    goalKey: WorkingMemoryIdentity.id[other], actionType: "move", target: "Hall", activityDisposition: "replace",
    observedAtSimMs: f.world.time.elapsed });
  expect(snapshotOngoingActivity(f.world, f.actor)).toMatchObject({ goalKey: WorkingMemoryIdentity.id[other], status: "active" });
  expect(Goal.status[f.goal]).toBe("active"); expect(Goal.progress[f.goal]).toBe(0);
  expect(snapshotActivityReview(f.world, f.actor)?.status).toBe("paused");
  expect(getSocialClosures(f.world, f.peer)).toEqual([]);
  expect(getSocialDialogue(f.world, f.actor)).toHaveLength(context.evidence.dialogue.length);
});
test.each(["pause", "close"])("a stale %s cannot abandon a real contribution that completed after its capture", disposition => {
  const f = fixture(), context = f.ready(), prepared = prepareActivityReview(context, proposal(context, { disposition,
    ...(disposition === "close" ? { expectedProgress: undefined } : {}) }))!;
  f.speak("I have actually continued since that request.");
  expect(prepared.commit()).toBe(false); expect(getSocialClosures(f.world, f.actor)).toEqual([]);
  expect(snapshotActivityReview(f.world, f.actor)?.completedContributions).toBe(3);
});
test("a restarted source baselines inherited dialogue; replay cannot start a fresh episode", () => {
  const f = fixture(); f.ready(); const own = getSocialDialogue(f.world, f.actor).find(turn => turn.own)!;
  const oldCount = getSocialDialogue(f.world, f.actor).length;
  stopCommittedEvents(f.world); startCommittedEvents(f.world);
  recordActivitySpeech(f.world, f.actor, own);
  expect(captureActivityReview(f.world, f.actor)).toBeUndefined(); expect(snapshotActivityReview(f.world, f.actor)).toBeUndefined();
  expect(getSocialDialogue(f.world, f.actor)).toHaveLength(oldCount);
  f.speak("A new actual contribution after restart.");
  expect(snapshotActivityReview(f.world, f.actor)?.completedContributions).toBe(1);
});
test("only offered exact own/heard completed receipts can be cited, never private/partial/proposed or another actor's purpose", () => {
  const f = fixture(), context = f.ready();
  for (const evidenceIds of [["invented"], ["private:phone"], ["speech-fragment:partial"], context.evidence.dialogue.filter(turn => !turn.own).map(turn => turn.speechId)])
    expect(prepareActivityReview(context, proposal(context, { evidenceIds }))).toBeUndefined();
  const ownId = context.evidence.contributions[0].speechId;
  expect(context.evidence.dialogue.some(turn => turn.speechId === ownId)).toBe(true);
  const before = SocialMemory.turnsJson[f.actor];
  const rows = JSON.parse(before); rows.find((turn: any) => turn.id === ownId).content = "edited after capture";
  const prepared = prepareActivityReview(context, proposal(context, { evidenceIds: [ownId] }))!;
  SocialMemory.turnsJson[f.actor] = JSON.stringify(rows);
  expect(prepared.current()).toBe(false); expect(prepared.commit()).toBe(false);
});
test("bounded displayed own contribution IDs remain valid after many personally heard turns", () => {
  const f = fixture(); f.speak("First point."); f.speak("Second point.");
  for (let i = 0; i < 20; i++) f.hear(`A heard point ${i}.`);
  f.advance(); const context = captureActivityReview(f.world, f.actor)!;
  expect(context.evidence.dialogue.length).toBeLessThanOrEqual(12);
  for (const own of context.evidence.contributions)
    expect(prepareActivityReview(context, proposal(context, { evidenceIds: [own.speechId] }))).toBeDefined();
});
test("canceled work cannot mint review authority or commit an existing review", async () => {
  const f = fixture(), context = f.ready(), prepared = prepareActivityReview(context, proposal(context))!, before = snapshotActivityReview(f.world, f.actor);
  const controller = new AbortController();
  await withSimulationTask(controller.signal, async () => {
    controller.abort();
    expect(() => captureActivityReview(f.world, f.actor)).toThrow();
    expect(() => prepared.commit()).toThrow();
  });
  expect(snapshotActivityReview(f.world, f.actor)).toEqual(before);
});
