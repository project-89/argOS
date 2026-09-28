import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { initializePrefabs, createAgentEntity, createRoomEntity, createObjectEntity } = await import("../../ecs/prefabs");
const { Goal, ObjectState, WorkingMemoryIdentity } = await import("../../ecs/components");
const { HasGoal } = await import("../../ecs/relations");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { createIntentGoal, executeActions, completeDeferredAction } = await import("../cognition-system");
const { agentThink, addPerception, getAgentThoughts, getAgentConversation } = await import("../agent-mind");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { getGoalCompletionOptions } = await import("../goal-lifecycle");
const { applyCoordinationReviews, captureCoordinationWork, getCoordinationMemory, getCoordinationGoalRef } = await import("../coordination-memory");
const { recordCommittedSpeech } = await import("../social-memory");
const { isDiscardedForegroundDecision } = await import("../foreground-action-admission");
const { getCompilationStats, resetCompilerState } = await import("../bt-compiler");
const { chronicle } = await import("../simulation-chronicle");
import type { AgentAction } from "../agent-mind";
import type { AgentWorldCapabilities } from "../world-capabilities";
import type { GoalSuccessV1 } from "../goal-contract";

function fixture() {
  const world = createArgosWorld("Separate body and mental admission"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Act from evidence.", roomId: room });
  const peer = createAgentEntity(world, { name: "Lin", role: "resident", systemPrompt: "PRIVATE_PEER_MIND", roomId: room });
  const control = createObjectEntity(world, { name: "Control", roomId: room });
  const other = createObjectEntity(world, { name: "Other display", roomId: room });
  ObjectState.current[control] = "ready"; ObjectState.current[other] = "dark";
  const execute = jest.fn<(action: AgentAction) => boolean>(action => {
    completeDeferredAction(world, actor, action, true, "The control operation completed."); return true;
  });
  const capabilities: AgentWorldCapabilities = { context: () => "", ready: () => true, busy: () => false,
    affordances: id => id === control ? [{ name: "operate", requires: [], effects: [] }] : [], execute };
  registerAgentWorldCapabilities(world, actor, capabilities);
  return { world, actor, peer, control, other, execute, capabilities, registry: createSystemRegistry() };
}
const proposed = (extra: Record<string, unknown> = {}, action: Record<string, unknown> = {}) => ({ text: JSON.stringify({
  innerThought: "The other display is dark. I will operate the control.",
  ...extra, action: { type: "interact", target: "Control", content: "operate", ...action },
}) });
const goals = (f: ReturnType<typeof fixture>) => getRelationTargets(f.world, f.actor, HasGoal);
const dispatch = (f: ReturnType<typeof fixture>, action: AgentAction) => executeActions(f.world, [{ eid: f.actor, action }], f.registry);
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); resetCompilerState();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Envelope tests must remain offline"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test.each(["returned", "error", "timeout"])("operator timing brackets an actual %s model attempt without publishing a thought", async outcome => {
  const f = fixture();
  let release!: () => void;
  const rows: Array<{ type: string; data: Record<string, any> }> = [];
  const remove = chronicle.subscribe(entry => { if (entry.data.agentEid === f.actor) rows.push(entry); });
  generate.mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve; });
    if (outcome !== "returned") { const error = new Error("PRIVATE_PROVIDER_FAILURE"); error.name = outcome === "timeout" ? "TimeoutError" : "Error"; throw error; }
    return proposed();
  });
  try {
    const pending = agentThink(f.world, f.actor);
    expect(rows.filter(row => row.type === "foreground_attempt_started")).toHaveLength(1);
    expect(rows.filter(row => row.type === "foreground_attempt_finished")).toHaveLength(0);
    release(); await pending;
    const start = rows.find(row => row.type === "foreground_attempt_started")!.data;
    const end = rows.find(row => row.type === "foreground_attempt_finished")!.data;
    const provider = rows.find(row => row.type === "foreground_provider_result")!.data;
    expect(start.requestId).toMatch(/^foreground:/); expect(end.requestId).toBe(start.requestId);
    expect(provider.requestId).toBe(start.requestId); expect(provider.provider.outcome).toBe(outcome);
    expect(end.durationWallMs).toBeGreaterThanOrEqual(start.preparationWallMs);
    expect(JSON.stringify([start, end, provider])).not.toContain("PRIVATE_PROVIDER_FAILURE");
    expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  } finally { remove(); }
});

test("a goal and prior undertaking remain private drafts until their exact physical action is dispatched", async () => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "Inspect the control safely", priority: 5 },
    coordinationReviews: [{ kind: "undertake", speechId: source.id, task: "Inspect the control", goalId: "new" }] },
  { goalId: "new", undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(goals(f)).toHaveLength(0); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.actor)).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.peer).items).toHaveLength(0);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(goals(f)).toHaveLength(1);
  expect(action.coordinationGoal).toEqual(getCoordinationGoalRef(f.world, f.actor, goals(f)[0]));
  expect(action.coordinationWork).toEqual(captureCoordinationWork(f.world, f.actor, source.id));
  expect(getCoordinationMemory(f.world, f.peer).items).toHaveLength(1);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1); expect(getAgentConversation(f.world, f.actor)).toHaveLength(2);
  dispatch(f, action); dispatch(f, { ...action });
  expect(f.execute).toHaveBeenCalledTimes(1); expect(goals(f)).toHaveLength(1); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test.each(["response", "dispatch"])("%s scene change omits the entire ancillary bundle but not independently valid physical work", async boundary => {
  const f = fixture();
  const socialGoal = createIntentGoal(f.world, f.actor, "Get acquainted", 3); Goal.kind[socialGoal] = "social";
  const own = recordCommittedSpeech(f.world, f.actor, "I will inspect the control. How are you?", "Lin")!;
  const heard = recordCommittedSpeech(f.world, f.peer, "Well, thank you.", "Ada")!;
  addPerception(f.world, f.actor, { type: "attention", source: "signal", content: "Consider the control." });
  const log = jest.spyOn(chronicle, "record");
  generate.mockImplementation(async () => {
    if (boundary === "response") ObjectState.current[f.other] = "lit";
    return proposed({ goalUpdate: { description: "A proposed side intention", priority: 6 },
      coordinationReviews: [{ kind: "undertake", speechId: own.id, task: "Inspect the control" }],
      socialGoalReview: { goalId: socialGoal, disposition: "satisfied_for_now", reason: "We exchanged greetings.", evidenceIds: [own.id, heard.id] } });
  });
  const action = await agentThink(f.world, f.actor);
  if (boundary === "dispatch") ObjectState.current[f.other] = "lit";
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(Goal.status[socialGoal]).toBe("active");
  expect(goals(f)).toEqual([socialGoal]); expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.peer).items).toHaveLength(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0); expect(getAgentConversation(f.world, f.actor)).toHaveLength(0);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  expect(log).toHaveBeenCalledWith("mental_update_discarded", expect.objectContaining({ boundary, reason: "local_view_changed" }));
  expect(log).toHaveBeenCalledWith("llm_decision", expect.objectContaining({ mentalUpdate: "omitted" }));
  const event = log.mock.calls.find(([kind]) => kind === "llm_decision")![1];
  expect(event).not.toHaveProperty("reasoning");
});

test.each(["response", "dispatch"])("%s stale new-goal-dependent command rejects without an orphan goal or undertaking", async boundary => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  generate.mockImplementation(async () => {
    if (boundary === "response") ObjectState.current[f.other] = "lit";
    return proposed({ goalUpdate: { description: "New bound intention", priority: 6 },
      coordinationReviews: [{ kind: "undertake", speechId: source.id, task: "Inspect", goalId: "new" }] },
    { goalId: "new", undertakingId: source.id });
  });
  const action = await agentThink(f.world, f.actor);
  if (boundary === "dispatch") ObjectState.current[f.other] = "lit";
  dispatch(f, action);
  expect(f.execute).not.toHaveBeenCalled(); expect(goals(f)).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.peer).items).toHaveLength(0);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("an invalid undertaking is rejected before its otherwise valid new goal is allocated", async () => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "Must not become orphaned", priority: 6 },
    coordinationReviews: [{ kind: "undertake", speechId: source.id, task: "", goalId: "new" }] },
  { goalId: "new", undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true); dispatch(f, action);
  expect(goals(f)).toHaveLength(0); expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
  expect(f.execute).not.toHaveBeenCalled();
});

test("releasing the work selected by the same proposal fails preflight without committing either release or new goal", async () => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Inspect the control" }]);
  const before = getCoordinationMemory(f.world, f.actor);
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "Must not orphan", priority: 6 },
    coordinationReviews: [{ kind: "release", id: source.id, reason: "I am withdrawing." }] }, { undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(goals(f)).toHaveLength(0); expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
});

test("an existing undertaking released in the dispatch gap invalidates the body binding too", async () => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Inspect the control" }]);
  generate.mockResolvedValue(proposed({}, { undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  applyCoordinationReviews(f.world, f.actor, [{ kind: "release", id: source.id, reason: "The undertaking changed." }]);
  dispatch(f, action);
  expect(f.execute).not.toHaveBeenCalled(); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("an action selecting existing work depends on its proposed new-goal link and replacement work generation", async () => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: source.id, task: "Inspect the control" }]);
  const before = getCoordinationMemory(f.world, f.actor);
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "New approach for existing work", priority: 6 },
    coordinationReviews: [{ kind: "link", id: source.id, goalId: "new" }] }, { undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  expect(action.coordinationWork?.itemId).toBe(source.id);
  expect(action.coordinationWork?.generation).not.toBe(captureCoordinationWork(f.world, f.actor, source.id)?.generation);
  ObjectState.current[f.other] = "lit";
  dispatch(f, action);
  expect(f.execute).not.toHaveBeenCalled(); expect(goals(f)).toHaveLength(0);
  expect(getCoordinationMemory(f.world, f.actor)).toEqual(before);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("changed physical target rejects the body and its fresh-looking optional intention together", async () => {
  const f = fixture(); generate.mockResolvedValue(proposed({ goalUpdate: { description: "Uncommitted intention", priority: 6 } }));
  const action = await agentThink(f.world, f.actor); ObjectState.current[f.control] = "occupied";
  dispatch(f, action);
  expect(f.execute).not.toHaveBeenCalled(); expect(goals(f)).toHaveLength(0); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test("a response-rejected mental envelope cannot revive if the unrelated display returns to its old state before dispatch", async () => {
  const f = fixture(); generate.mockImplementation(async () => { ObjectState.current[f.other] = "lit"; return proposed(); });
  const action = await agentThink(f.world, f.actor); ObjectState.current[f.other] = "dark";
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
});

test.each(["onThought", "onSocialGoalSatisfied"] as const)("a failing %s observer cannot reject already-committed cognition or orphan its bound physical action", async hook => {
  const f = fixture(), log = jest.spyOn(chronicle, "record");
  const social = createIntentGoal(f.world, f.actor, "Get acquainted", 3); Goal.kind[social] = "social";
  const own = recordCommittedSpeech(f.world, f.actor, "I will inspect the control. How are you?", "Lin")!;
  const heard = recordCommittedSpeech(f.world, f.peer, "Well, thank you.", "Ada")!;
  const notification = jest.fn(() => { throw new Error("PRIVATE_OBSERVER_ERROR_BODY"); });
  f.capabilities[hook] = notification;
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "A newly bound intention", priority: 6 },
    coordinationReviews: [{ kind: "undertake", speechId: own.id, task: "Inspect the control", goalId: "new" }],
    socialGoalReview: { goalId: social, disposition: "satisfied_for_now", reason: "We exchanged greetings.", evidenceIds: [own.id, heard.id] } },
  { goalId: "new", undertakingId: own.id }));
  const action = await agentThink(f.world, f.actor);
  expect(goals(f)).toEqual([social]); expect(notification).not.toHaveBeenCalled();
  dispatch(f, action);
  expect(notification).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
  expect(Goal.status[social]).toBe("completed"); expect(goals(f)).toHaveLength(2);
  const next = goals(f).find(id => id !== social)!;
  expect(action.coordinationGoal).toEqual(getCoordinationGoalRef(f.world, f.actor, next));
  expect(action.coordinationWork).toEqual(captureCoordinationWork(f.world, f.actor, own.id));
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
  expect(getAgentConversation(f.world, f.actor)).toHaveLength(2);
  expect(log).not.toHaveBeenCalledWith("decision_rejected", expect.anything());
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_OBSERVER_ERROR_BODY");
  dispatch(f, action);
  expect(notification).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
});

test.each([false, true])("a package declaration mutation cannot retarget a staged goal or sever its undertaking (original still published=%s)", async retained => {
  const f = fixture(), source = recordCommittedSpeech(f.world, f.actor, "I will inspect the control.", "Lin")!;
  const success: GoalSuccessV1 = { type: "entity_component_equals", entityName: "Control", component: "ObjectState", field: "current", equals: "finished" };
  const original = structuredClone(success);
  f.capabilities.goalCompletionOptions = () => [
    { id: "untrusted-package-label", description: "Finish the control", success },
    ...(retained ? [{ id: "stable-publication", description: "Finish the control", success: original }] : []),
  ];
  const completionId = getGoalCompletionOptions(f.world, f.actor).find(option => option.description === "Finish the control")!.id;
  generate.mockResolvedValue(proposed({ goalUpdate: { description: "Finish the control", priority: 6, completionId },
    coordinationReviews: [{ kind: "undertake", speechId: source.id, task: "Inspect the control", goalId: "new" }] },
  { goalId: "new", undertakingId: source.id }));
  const action = await agentThink(f.world, f.actor);
  expect(goals(f)).toHaveLength(0);
  success.equals = "A different completion condition";
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(retained ? 1 : 0);
  expect(goals(f)).toHaveLength(retained ? 1 : 0);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(retained ? 1 : 0);
  expect(getCoordinationMemory(f.world, f.peer).items).toHaveLength(retained ? 1 : 0);
  if (retained) {
    expect(JSON.parse(Goal.successJson[goals(f)[0]])).toEqual(original);
    expect(action.coordinationGoal).toEqual(getCoordinationGoalRef(f.world, f.actor, goals(f)[0]));
    expect(getCoordinationMemory(f.world, f.actor).items[0].goal).toEqual(action.coordinationGoal);
  }
});

test("a replacement social-goal episode cannot inherit the older response's subjective closure", async () => {
  const f = fixture(), social = createIntentGoal(f.world, f.actor, "Get acquainted", 3); Goal.kind[social] = "social";
  const own = recordCommittedSpeech(f.world, f.actor, "How are you?", "Lin")!;
  const heard = recordCommittedSpeech(f.world, f.peer, "Well, thank you.", "Ada")!;
  generate.mockResolvedValue(proposed({ socialGoalReview: { goalId: social, disposition: "satisfied_for_now",
    reason: "We exchanged greetings.", evidenceIds: [own.id, heard.id] } }));
  const action = await agentThink(f.world, f.actor);
  WorkingMemoryIdentity.id[social] = "same-numeric-id-and-time-new-goal-episode";
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(Goal.status[social]).toBe("active");
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getAgentConversation(f.world, f.actor)).toHaveLength(0);
});

test.each([{ coordinationReviews: [] }, { coordinationReviews: [{ kind: "unsupported" }] }])("a zero-effect review does not manufacture a dialogue dependency (%j)", async ({ coordinationReviews }) => {
  const f = fixture();
  generate.mockResolvedValue(proposed({ coordinationReviews }));
  const action = await agentThink(f.world, f.actor);
  recordCommittedSpeech(f.world, f.peer, "It is raining.");
  dispatch(f, action);
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
  expect(getCoordinationMemory(f.world, f.actor).items).toHaveLength(0);
});
