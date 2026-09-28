import { jest } from "@jest/globals";
import { getRelationTargets } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { initializePrefabs, createAgentEntity, createRoomEntity } from "../../ecs/prefabs";
import { HasGoal } from "../../ecs/relations";
import { Goal, GoalLifecycle, WorkingMemoryIdentity } from "../../ecs/components";
import { advanceSimulationTime } from "../../ecs/simulation-time";
import { startCommittedEvents, stopCommittedEvents, getCommittedEvents } from "../../runtime/committed-events";
import { createGeneratedIntention, maintainGoalLifecycles, pendingIntentionReview } from "../goal-lifecycle";
import { captureGoalReviewContext, prepareGoalReview } from "../goal-pursuit";
import { setAspirations } from "../goal-learning";
import { recordPersonalConcern } from "../personal-concerns";
import { workingMemoryEntityRef } from "../working-memory";
import { generateAutonomousGoal, hasPendingPersonalGoalReview, resetAutonomousGoals } from "../autonomous-goals";
import { chronicle } from "../simulation-chronicle";
import { personalReviewResponseSchema, parsePersonalReviewResponse } from "../personal-review-response";
import { Output, NoObjectGeneratedError } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText as sdkGenerateText } from "ai";

let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GEMINI_API_KEY; process.env.GEMINI_API_KEY = "offline-only";
  resetAutonomousGoals();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline contract tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
});
function fixture(drives?: string[]) {
  const world = createArgosWorld("Private review"); initializePrefabs(world); world.meta.aiEnabled = true;
  const room = createRoomEntity(world, { name: "Apartment" });
  const actor = createAgentEntity(world, { name: "Ada", role: "friend", systemPrompt: "I choose my own plans", roomId: room,
    ...(drives ? { past: { background: "I grew up making useful things with my family.", drives,
      memories: [{ recollection: "My aunt taught me to inspect a broken radio before replacing anything.", emotionalTone: "warmth",
        importance: .8, selfBelief: "I can learn through careful work", meaning: "Useful work matters to me", cues: ["repair"],
        period: "childhood", provenance: "authored-history" as const }] } } : {}) });
  startCommittedEvents(world); advanceSimulationTime(world, 1, 40_000);
  workingMemoryEntityRef(world, actor);
  const routine = createGeneratedIntention(world, actor, { description: "Discuss our disagreement", kind: "social", priority: 7 }, "personal")!;
  const concern = (id = "read:1") => recordPersonalConcern(world, actor, { channel: "phone", evidenceIds: [id],
    appraisal: "PRIVATE: I could choose somewhere for dinner", significance: "An ordinary invitation", importance: .6,
    experiencedAtSimMs: 30_000, appraisedAtSimMs: 40_000 });
  expect(concern()).toBe(true);
  const infer = jest.fn<(...args: any[]) => Promise<any>>();
  return { world, actor, routine, concern, infer, run: () => generateAutonomousGoal(world, actor, { generateText: infer as any }),
    goals: () => getRelationTargets(world, actor, HasGoal),
    pending: () => hasPendingPersonalGoalReview(world, actor) };
}
const intention = { goal: "Choose a dinner spot", motivation: "I want to go out", kind: "social", priority: 6 };
const investigation = { goal: "Investigate the reading lamp's intermittent fault", motivation: "I want to understand what is happening", kind: "custom", priority: 7 };

test("personal review admits a practical inquiry as exploratory work with native reconsideration, not social or physical success", async () => {
  const f = fixture(); f.infer.mockResolvedValue({ text: JSON.stringify(investigation) });
  expect(await f.run()).toMatchObject({ description: investigation.goal, kind: "custom" });
  const goal = f.goals().find(g => Goal.description[g] === investigation.goal)!;
  expect(goal).toBeDefined(); expect(Goal.kind[goal]).toBe("custom");
  expect(GoalLifecycle.mode[goal]).toBe("exploratory"); expect(GoalLifecycle.source[goal]).toBe("autonomous");
  expect(JSON.parse(Goal.successJson[goal])).toMatchObject({ type: "custom" });
  expect(Goal.progress[goal]).toBe(0); expect(getCommittedEvents(f.world).events).toEqual([]);
  advanceSimulationTime(f.world, 2, 61_000); maintainGoalLifecycles(f.world, f.actor);
  expect(Goal.status[goal]).toBe("paused"); expect(pendingIntentionReview(f.world, f.actor, goal)).toBeDefined();
  expect(Goal.progress[goal]).toBe(0);
  const review = prepareGoalReview(captureGoalReviewContext(f.world, f.actor), { goalId: goal, disposition: "release", reason: "I have no further evidence to investigate now." });
  expect(review?.commit()).toBe(true); expect(Goal.status[goal]).toBe("retired");
  expect(Goal.progress[goal]).toBe(0); expect(Goal.status[f.routine]).toBe("active");
});

test("personal review receives the actor's authored aspirations as private context", async () => {
  const drives = ["PRIVATE_DRIVE: Learn to restore old radios", "PRIVATE_DRIVE: Make room for friendships"];
  const f = fixture(drives); f.infer.mockResolvedValue({ text: '{"goal":null}' }); await f.run();
  const context = JSON.parse(f.infer.mock.calls[0][0].messages[1].content.split("\n")[0]);
  expect(context.character.coreDrives).toEqual(drives);
  expect(context.character.aspirations).toEqual([]);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE_DRIVE");
});

test("an authored aspiration change discards a personal review formed against the old character context", async () => {
  const f = fixture(["Understand electrical repairs"]);
  f.infer.mockImplementation(async () => {
    setAspirations(f.world, f.actor, ["Spend this afternoon making music"]);
    return { text: JSON.stringify(investigation) };
  });
  expect(await f.run()).toBeNull(); expect(f.goals()).toEqual([f.routine]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
  advanceSimulationTime(f.world, 2, 6000); expect(f.pending()).toBe(false); // Existing wall-clock failure backoff remains intact.
  const wall = Date.now(); jest.spyOn(Date, "now").mockReturnValue(wall + 6000);
  expect(f.pending()).toBe(true);
});

test("the provider and local parser both accept a plain custom inquiry without a follow-up", async () => {
  const text = JSON.stringify(investigation), output = Output.object({ schema: personalReviewResponseSchema });
  await expect(output.parseCompleteOutput({ text }, { response: undefined as any, usage: undefined as any, finishReason: "stop" })).resolves.toBeDefined();
  expect(parsePersonalReviewResponse(text)).toMatchObject({ success: true, value: investigation });
});

test.each([
  { firstAction: { type: "interact", target: "Lighting panel", content: "power_on" } },
  { action: { type: "interact", target: "Lighting panel" } },
  { completionId: "model-invented-success" },
  { success: { type: "entity_component_equals", entityName: "Lighting panel", component: "SpatialCircuit", field: "powered", equals: true } },
  { supportsGoalId: 1 },
  { followUp: { undertakingId: "invented-undertaking" } },
])("exploratory personal review rejects extra authority %j without allocating a goal", async extra => {
  const f = fixture(); const value = { ...investigation, ...extra };
  expect(parsePersonalReviewResponse(JSON.stringify(value)).success).toBe(false);
  f.infer.mockResolvedValue({ text: JSON.stringify(value) });
  expect(await f.run()).toBeNull(); expect(f.goals()).toEqual([f.routine]);
  expect(getCommittedEvents(f.world).events).toEqual([]);
});

test("personal review requests a provider schema without changing model budgets", async () => {
  const f = fixture(); f.infer.mockResolvedValue({ text: JSON.stringify(intention) });
  expect(await f.run()).toMatchObject({ description: intention.goal });
  const request = f.infer.mock.calls[0][0];
  expect(request).toMatchObject({ maxOutputTokens: 900, maxRetries: 0, temperature: .5 });
  expect(request.output).toBeDefined();
  expect(await request.output.responseFormat).toMatchObject({ type: "json", schema: expect.any(Object) });
});

test.each([
  JSON.stringify({ goal: null, reviewAtSimMs: 300000, reason: "PRIVATE wait" }),
  JSON.stringify({ goal: null, firstAction: { type: "move", target: "Restaurant" } }),
  JSON.stringify({ ...intention, priority: "6" }),
  JSON.stringify({ ...intention, unknown: "PRIVATE" }),
  JSON.stringify({ ...intention, followUp: "text:private-id:sent" }),
  JSON.stringify({ goal: null, followUp: "text:private-id:sent", reviewAtSimMs: 300000 }),
  `Here is the result: ${JSON.stringify(intention)}`,
  `${JSON.stringify({ goal: null })}\n${JSON.stringify(intention)}`,
  '```json\n{"goal":null,"followUp":"text:private',
])("rejects the entire malformed envelope without acknowledging the evidence: %s", async text => {
  const f = fixture(); f.infer.mockResolvedValue({ text });
  expect(await f.run()).toBeNull(); expect(f.goals()).toEqual([f.routine]);
  const wall = Date.now(); jest.spyOn(Date, "now").mockReturnValue(wall + 6000);
  advanceSimulationTime(f.world, 2, 6000);
  expect(f.pending()).toBe(true);
  expect(JSON.stringify(getCommittedEvents(f.world).events)).not.toContain("PRIVATE");
});

test.each(["bare", "fenced"])("valid %s no-op is acknowledged without inventing an intention", async format => {
  const f = fixture(); f.infer.mockResolvedValue({ text: format === "bare" ? '{"goal":null}' : '```json\n{"goal":null}\n```' });
  expect(await f.run()).toBeNull(); advanceSimulationTime(f.world, 2, 120000);
  expect(f.pending()).toBe(false); expect(f.goals()).toEqual([f.routine]);
});

test.each(["syntax", "schema"])("real SDK %s errors produce structural diagnostics without leaking private output", async kind => {
  const f = fixture(), records = jest.spyOn(chronicle, "record"), warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  const text = kind === "syntax" ? '{"goal": "PRIVATE_INCOMPLETE' : JSON.stringify({ ...intention, followUp: "PRIVATE_STRING_ID" });
  f.infer.mockImplementation(async request => {
    await request.output.parseCompleteOutput({ text }, { response: undefined, usage: undefined, finishReason: "length" });
    return { text }; // Admission would expose an unexpected parser acceptance.
  });
  expect(await f.run()).toBeNull(); expect(f.goals()).toEqual([f.routine]);
  const diagnostics = records.mock.calls.filter(call => call[0] === "personal_review_result");
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0][1]).toMatchObject({ outcome: kind === "syntax" ? "invalid_json" : "invalid_schema",
    responseChars: text.length, finishReason: "length" });
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE"); expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE");
});

test("unknown SDK errors are not echoed", async () => {
  const f = fixture(), records = jest.spyOn(chronicle, "record"), warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  f.infer.mockRejectedValue(new NoObjectGeneratedError({ text: "PRIVATE_TEXT", cause: new Error("PRIVATE_CAUSE"),
    response: undefined as any, usage: undefined as any, finishReason: "error" }));
  expect(await f.run()).toBeNull();
  expect(records).toHaveBeenCalledWith("personal_review_result", expect.objectContaining({ outcome: "provider_or_commit_error" }));
  expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE");
  expect(JSON.stringify(records.mock.calls)).not.toContain("PRIVATE");
});

test("unrecognized provider finish reasons cannot enter diagnostics", async () => {
  const f = fixture(), records = jest.spyOn(chronicle, "record");
  f.infer.mockResolvedValue({ text: '{"goal":null}', finishReason: "PRIVATE_FINISH_REASON" });
  await f.run();
  expect(records).toHaveBeenCalledWith("personal_review_result", expect.objectContaining({ outcome: "no_goal" }));
  expect(JSON.stringify(records.mock.calls)).not.toContain("PRIVATE");
});

test("installed Google adapter sends the strict no-goal/social/exploratory schema (synthetic transport, no HTTP)", async () => {
  const f = fixture(); let body: any;
  const transport = jest.fn(async (_url: any, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(intention) }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 } }),
    { status: 200, headers: { "content-type": "application/json" } });
  });
  const model = createGoogleGenerativeAI({ apiKey: "offline-only", fetch: transport as any })("gemini-3.8-flash");
  f.infer.mockImplementation(request => sdkGenerateText({ ...request, model }));
  expect(await f.run()).toMatchObject({ description: intention.goal });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(body.generationConfig).toMatchObject({ maxOutputTokens: 900, responseMimeType: "application/json" });
  const choices = body.generationConfig.responseSchema.anyOf;
  expect(choices).toHaveLength(3);
  expect(choices[0]).toMatchObject({ type: "object", required: ["goal"], properties: { goal: { type: "null" } } });
  expect(choices[1].required).toEqual(["goal", "motivation", "priority", "kind"]);
  expect(choices[1].properties.followUp).toMatchObject({ type: "object", required: ["undertakingId"] });
  expect(choices[2].required).toEqual(["goal", "motivation", "priority", "kind"]);
  expect(choices[2].properties.kind).toMatchObject({ type: "string", enum: ["custom"] });
  expect(choices[2].properties.followUp).toBeUndefined();
  // This verifies the local SDK/dialect path, not a live provider judgment.
});

test("plain incomplete output retains length diagnostics without claiming the budget caused it", async () => {
  const f = fixture(), records = jest.spyOn(chronicle, "record");
  f.infer.mockResolvedValue({ text: '{"goal":null,"followUp":"PRIVATE', finishReason: "length" });
  expect(await f.run()).toBeNull();
  expect(records).toHaveBeenCalledWith("personal_review_result", expect.objectContaining({ outcome: "invalid_json", finishReason: "length" }));
  expect(JSON.stringify(records.mock.calls)).not.toContain("PRIVATE");
});

test.each([undefined, { undertakingId: "own-source" }, { undertakingId: "own-source", reviewAtSimMs: 300000, reason: "Review near my proposed time" }])(
  "provider and local contracts accept a complete intention with follow-up %p", async followUp => {
    const text = JSON.stringify({ ...intention, ...(followUp ? { followUp } : {}) });
    const output = Output.object({ schema: personalReviewResponseSchema });
    await expect(output.parseCompleteOutput({ text }, { response: undefined as any, usage: undefined as any, finishReason: "stop" })).resolves.toBeDefined();
    expect(parsePersonalReviewResponse(text)).toMatchObject({ success: true, value: JSON.parse(text) });
  });

test("repeated malformed output backs off 5/10/20/30 seconds without consuming the evidence", async () => {
  const f = fixture(), records = jest.spyOn(chronicle, "record");
  let wallMs = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => wallMs);
  f.infer.mockResolvedValue({ text: JSON.stringify({ ...intention, followUp: "PRIVATE_BAD_SHAPE" }) });
  let tick = 2;
  for (const [index, delay] of [5000, 10000, 20000, 30000, 30000].entries()) {
    expect(await f.run()).toBeNull();
    expect(f.infer).toHaveBeenCalledTimes(index + 1);
    advanceSimulationTime(f.world, tick++, 6000);
    wallMs += delay - 1;
    expect(f.pending()).toBe(false);
    await f.run(); expect(f.infer).toHaveBeenCalledTimes(index + 1);
    wallMs++; expect(f.pending()).toBe(true);
    expect(records).toHaveBeenCalledWith("personal_review_result", expect.objectContaining({
      outcome: "invalid_schema", formatFailures: index + 1, retryDelayMs: delay }));
  }
  expect(f.goals()).toEqual([f.routine]);
  f.infer.mockResolvedValue({ text: JSON.stringify(intention) });
  expect(await f.run()).toMatchObject({ description: intention.goal });
  expect(f.goals()).toHaveLength(2); expect(f.pending()).toBe(false);
});

test("new appraised evidence is not held behind the old batch's escalating penalty", async () => {
  const f = fixture(); let wallMs = Date.now(); jest.spyOn(Date, "now").mockImplementation(() => wallMs);
  f.infer.mockResolvedValue({ text: '{"goal":null,"PRIVATE":true}' });
  await f.run(); advanceSimulationTime(f.world, 2, 6000); wallMs += 6000;
  await f.run(); advanceSimulationTime(f.world, 3, 6000); wallMs += 6000;
  expect(f.pending()).toBe(false); // same evidence, ten-second penalty
  expect(f.concern("read:2")).toBe(true); expect(f.pending()).toBe(true);
  f.infer.mockResolvedValue({ text: '{"goal":null}' });
  await f.run(); expect(f.pending()).toBe(false); expect(f.infer).toHaveBeenCalledTimes(3);
});

test.each(["source", "actor"])("late review diagnostic retains its origin after %s replacement", async replacement => {
  const f = fixture(), records = jest.spyOn(chronicle, "record");
  const origin = { sourceId: getCommittedEvents(f.world).sourceId, actorKey: WorkingMemoryIdentity.id[f.actor] };
  f.infer.mockImplementation(async () => {
    if (replacement === "source") { stopCommittedEvents(f.world); startCommittedEvents(f.world); }
    else WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
    return { text: JSON.stringify(intention) };
  });
  expect(await f.run()).toBeNull(); expect(f.goals()).toEqual([f.routine]);
  expect(records).toHaveBeenCalledWith("personal_review_result", expect.objectContaining({ ...origin,
    actorEid: f.actor, requestedAtSimMs: 40000, outcome: "discarded", atSimMs: replacement === "source" ? null : 40000 }));
});
