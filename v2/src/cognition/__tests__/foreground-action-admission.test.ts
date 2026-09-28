import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, hasComponent, removeEntity, getRelationTargets } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { Agent, LastAction, Name, ObjectState, PendingToolJob, Plan, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { HasGoal } = await import("../../ecs/relations");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { captureForegroundDecisionFence, checkForegroundDecision, bindForegroundAction, consumeForegroundAction,
  discardedForegroundDecision, isDiscardedForegroundDecision, getForegroundDecisionLocalView, peekForegroundDecisionSource } = await import("../foreground-action-admission");
const { formatCognitiveLocalView } = await import("../cognitive-local-view");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
const { getWorkingMemory } = await import("../working-memory");
const { agentThink, getAgentThoughts, addPerception, buildAgentContext } = await import("../agent-mind");
const { executeActions, completeDeferredAction, createIntentGoal, runCognitionCycle } = await import("../cognition-system");
const { createPlanEntity } = await import("../planning-system");
const { getCompilationStats, captureLLMDecision, resetCompilerState } = await import("../bt-compiler");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { chronicle } = await import("../simulation-chronicle");
const { recordCommittedSpeech } = await import("../social-memory");
const { applyCoordinationReviews, captureCoordinationWork } = await import("../coordination-memory");
const { withSimulationTask } = await import("../../runtime/task-scope");
const { getPolicyEffectiveness } = await import("../policy-metrics");
const { getAgentActionHistory } = await import("../../spirits/watcher-spirit");
const { setAspirations } = await import("../goal-learning");
import type { AgentAction } from "../agent-mind";
import type { AffordanceDefinition } from "../../world/schema";

function fixture(options: { package?: boolean } = {}) {
  const world = createArgosWorld("Foreground admission"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "engineer", systemPrompt: "Act from evidence.", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "operator", systemPrompt: "PRIVATE OTHER MIND", roomId: room });
  const target = createObjectEntity(world, { name: "Control", roomId: room });
  const unrelated = createObjectEntity(world, { name: "Other control", roomId: room });
  const secret = createObjectEntity(world, { name: "PRIVATE REMOTE DEVICE", roomId: remote });
  ObjectState.current[target] = "ready";
  let busy = false, routes = [remote];
  let available = ["operate control", "entry <code>", "run_command", "other command"];
  const menus: number[] = [];
  const execute = jest.fn<(action: AgentAction) => boolean>(() => true);
  const capabilities = { context: () => "", ready: () => !busy, busy: () => busy, movementTargets: () => routes,
    affordances: (id: number) => { menus.push(id); return (id === target ? available : []).map(name => ({ name, description: name, requires: [], effects: [] } as AffordanceDefinition)); }, execute };
  let unregister = options.package === false ? () => {} : registerAgentWorldCapabilities(world, actor, capabilities);
  const action: AgentAction = { type: "interact", target: "Control", content: "operate control" };
  const fence = () => captureForegroundDecisionFence(world, actor)!;
  const bind = (selected: AgentAction = { ...action }) => bindForegroundAction(world, actor, fence(), selected, "Use this control.");
  return { world, room, remote, actor, other, target, unrelated, secret, action, menus, capabilities, execute, fence, bind,
    registry: createSystemRegistry(), setAvailable: (next: string[]) => { available = next; },
    setBusy: (next: boolean) => { busy = next; }, setRoutes: (next: number[]) => { routes = next; }, unregister: () => unregister() };
}
let priorKey: string | undefined;
beforeEach(() => {
  priorKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli(); resetCompilerState();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Admission tests must remain offline."));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (priorKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = priorKey;
});

test.each(["unchanged", "response", "dispatch"])("actor-selected occupant premise fences a room move at %s", async boundary => {
  const f = fixture(); setLocatedIn(f.world, f.other, f.remote);
  generate.mockImplementationOnce(async () => {
    if (boundary === "response") setLocatedIn(f.world, f.other, f.room);
    return { text: JSON.stringify({
      control: { version: 1, purpose: "Check the Hall for Lin", localDependencies: ["occupants"] },
      action: { type: "move", target: "Hall" },
    }) };
  });
  const action = await agentThink(f.world, f.actor);
  if (boundary === "dispatch") setLocatedIn(f.world, f.other, f.room);
  if (boundary === "unchanged") {
    expect(isDiscardedForegroundDecision(action)).toBe(false);
    expect(action).toMatchObject({ type: "move", target: "Hall" });
    expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  } else if (!isDiscardedForegroundDecision(action)) {
    expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: false });
  }
  expect(f.execute).not.toHaveBeenCalled();
});

test("request fence performs only legitimate actor-local sensing and retains private immutable issuance", () => {
  const f = fixture(), fence = f.fence();
  expect(Object.isFrozen(fence)).toBe(true); expect(Object.keys(fence)).toEqual(["requestId"]);
  expect(getWorkingMemory(f.world, f.actor).receipts.some(receipt => receipt.provenance === "own_action")).toBe(false);
  expect(f.menus).not.toContain(f.secret);
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
  const view = getForegroundDecisionLocalView(f.world, f.actor, fence)!;
  expect(Object.isFrozen(view)).toBe(true);
  expect(formatCognitiveLocalView(view)).not.toContain("PRIVATE");
  expect(getForegroundDecisionLocalView(f.world, f.other, fence)).toBeUndefined();
  expect(getForegroundDecisionLocalView(f.world, f.actor, { ...fence })).toBeUndefined();
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
});

test("operator request correlation is pure, world-scoped and rejects replaced actor identity", () => {
  const f = fixture();
  const identitiesBefore = [...WorkingMemoryIdentity.id];
  expect(peekForegroundDecisionSource(f.world, f.actor)).toBeUndefined();
  expect(WorkingMemoryIdentity.id).toEqual(identitiesBefore);
  const fence = f.fence(), source = peekForegroundDecisionSource(f.world, f.actor)!;
  expect(source).toEqual({ requestId: fence.requestId, actorKey: WorkingMemoryIdentity.id[f.actor] });
  expect(Object.isFrozen(source)).toBe(true);
  expect(peekForegroundDecisionSource(createArgosWorld("Unrelated world"), f.actor)).toBeUndefined();
  expect(peekForegroundDecisionSource(f.world, f.other)).toBeUndefined();
  ObjectState.current[f.target] = "changed";
  expect(peekForegroundDecisionSource(f.world, f.actor)).toEqual(source);
  const newer = f.fence();
  expect(peekForegroundDecisionSource(f.world, f.actor)?.requestId).toBe(newer.requestId);
  WorkingMemoryIdentity.id[f.actor] = "replacement-actor";
  expect(peekForegroundDecisionSource(f.world, f.actor)).toBeUndefined();
});

test.each(["occupied", "power removed", "parameter template removed"])("changed local availability (%s) invalidates the exact selected command", kind => {
  const f = fixture(), fence = f.fence();
  f.setAvailable(["other command"]);
  expect(checkForegroundDecision(f.world, f.actor, fence, { ...f.action, content: kind === "parameter template removed" ? "entry 7318" : f.action.content }))
    .toBe("command_availability_changed");
});

test("unchanged invalid command stays a real choice, even if a different command changes", () => {
  const f = fixture(); f.setAvailable(["other command"]); const fence = f.fence();
  f.setAvailable(["another command"]);
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
});

test("unrelated entity changes, private remote data and unrelated affordance changes do not starve action", () => {
  const f = fixture(), fence = f.fence();
  ObjectState.current[f.unrelated] = "changed"; ObjectState.current[f.secret] = "PRIVATE CHANGED CODE";
  f.setAvailable(["operate control", "brand new unrelated command"]);
  createObjectEntity(f.world, { name: "New unrelated prop", roomId: f.room });
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
  expect(f.menus).not.toContain(f.secret);
});

test.each(["removed", "moved", "renamed", "replacement", "ambiguous"])("changed target identity/reach (%s) cannot retarget a returned action", mode => {
  const f = fixture(), fence = f.fence();
  if (mode === "removed" || mode === "replacement") removeEntity(f.world, f.target);
  if (mode === "moved") setLocatedIn(f.world, f.target, f.remote);
  if (mode === "renamed") Name.value[f.target] = "Renamed control";
  if (mode === "replacement" || mode === "ambiguous") createObjectEntity(f.world, { name: "Control", roomId: f.room });
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("target_changed");
});

test("actor movement and body availability invalidate physical action and present-decision thought", () => {
  const f = fixture(), fence = f.fence(); f.setBusy(true);
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("body_availability_changed");
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "think", content: "A personal memory." })).toBe("local_view_changed");
  f.setBusy(false); setLocatedIn(f.world, f.actor, f.remote);
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("location_changed");
});

test.each(["wait", "think", "rest", "reflect", "speak", "defend"] as const)("%s reconsiders changed local state without inferring dependencies from its prose", type => {
  const f = fixture(), fence = f.fence(); ObjectState.current[f.target] = "finished";
  expect(checkForegroundDecision(f.world, f.actor, fence, { type, content: "A passing moment." })).toBe("local_view_changed");
});

test.each(["route opened", "someone left", "new visible object"])("present-decision thought sees scene changes beyond its unnamed target (%s)", change => {
  const f = fixture(); f.setRoutes([]); const fence = f.fence();
  if (change === "route opened") f.setRoutes([f.remote]);
  if (change === "someone left") setLocatedIn(f.world, f.other, f.remote);
  if (change === "new visible object") createObjectEntity(f.world, { name: "Parcel", roomId: f.room });
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "wait" })).toBe("local_view_changed");
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
});

test("unchanged local view and changes to remote/private minds do not block a present decision", () => {
  const f = fixture(), fence = f.fence();
  Agent.systemPrompt[f.other] = "DIFFERENT PRIVATE MIND"; ObjectState.current[f.secret] = "DIFFERENT SECRET";
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "speak", target: "Lin", content: "Ready?" })).toBeUndefined();
});

test("a local change after response cannot dispatch a stale nonphysical action or mint an outcome", () => {
  const f = fixture(), action = f.bind({ type: "wait" }); ObjectState.current[f.target] = "finished";
  const before = getWorkingMemory(f.world, f.actor);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).not.toHaveBeenCalled(); expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before);
});

test("an empty package route list stays authoritative; an unrelated route does not invalidate", () => {
  const f = fixture(), fence = f.fence(), action: AgentAction = { type: "move", target: "Hall" };
  const another = createRoomEntity(f.world, { name: "Garden" }); f.setRoutes([f.remote, another]);
  expect(checkForegroundDecision(f.world, f.actor, fence, action)).toBeUndefined();
  f.setRoutes([another]); expect(checkForegroundDecision(f.world, f.actor, fence, action)).toBe("reach_changed");
  f.setRoutes([]); expect(checkForegroundDecision(f.world, f.actor, fence, action)).toBeDefined();
});

test("legacy authored room catalog is preserved without reading remote contents", () => {
  const f = fixture({ package: false }), fence = f.fence();
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "move", target: "Hall" })).toBeUndefined();
  expect(hasComponent(f.world, f.secret, WorkingMemoryIdentity)).toBe(false);
});

test("visible target-state change reconsiders manipulation, while inspection can still observe the changed state", () => {
  const f = fixture(), fence = f.fence(); ObjectState.current[f.target] = "open";
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("target_state_changed");
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "observe", target: "Control" })).toBeUndefined();
});

test("inventory target and give-item identity/possession are fenced, not just the recipient", () => {
  const f = fixture(); const item = createObjectEntity(f.world, { name: "Parcel", roomId: f.room, portable: true });
  setLocatedIn(f.world, item, f.actor); const fence = f.fence();
  const action: AgentAction = { type: "give", target: "Lin", content: "Parcel" };
  expect(checkForegroundDecision(f.world, f.actor, fence, action)).toBeUndefined();
  setLocatedIn(f.world, item, f.room);
  expect(checkForegroundDecision(f.world, f.actor, fence, action)).toBe("target_changed");
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "use", target: "Parcel" })).toBe("target_changed");
});

test("lost sight cannot dispatch an old observation or physical target", () => {
  const f = fixture(), fence = f.fence(); addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = '["blind"]';
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "observe", target: "Control" })).toBe("action_type_changed");
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("target_changed");
});

test("actor, world, request-generation and capability ownership are exact", () => {
  const f = fixture(), fence = f.fence(), otherWorld = fixture();
  expect(checkForegroundDecision(otherWorld.world, otherWorld.actor, fence, f.action)).toBe("source_changed");
  expect(checkForegroundDecision(f.world, f.other, fence, f.action)).toBe("source_changed");
  expect(checkForegroundDecision(f.world, f.actor, { ...fence }, f.action)).toBe("source_changed");
  const newFence = f.fence(); expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("source_changed");
  f.unregister(); registerAgentWorldCapabilities(f.world, f.actor, { ...f.capabilities });
  expect(checkForegroundDecision(f.world, f.actor, newFence, f.action)).toBe("source_changed");
});

test("hot-reloading the identical capability object cannot resurrect its prior admission", () => {
  const f = fixture(), fence = f.fence();
  f.unregister(); registerAgentWorldCapabilities(f.world, f.actor, f.capabilities);
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("source_changed");
});

test.each(["inactive", "replaced", "identity changed", "aspirations changed"])("%s actor cannot consume prior source", mode => {
  const f = fixture(), fence = f.fence();
  if (mode === "inactive") Agent.active[f.actor] = false;
  else if (mode === "identity changed") Agent.systemPrompt[f.actor] = "A different person.";
  else if (mode === "aspirations changed") setAspirations(f.world, f.actor, ["Find a quieter place to live"]);
  else WorkingMemoryIdentity.id[f.actor] = "entity:replacement";
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBe("actor_changed");
});

test("exact action contents are immutable, including tool path/JSON case and whitespace", () => {
  const f = fixture(); const content = 'run_command node /Case/Tool.js --json {"Mode":"Append"}';
  for (const changed of [content.toLowerCase(), content + " ", content.replace("Append", "Replace")]) {
    const action = f.bind({ ...f.action, content }); action.content = changed;
    expect(consumeForegroundAction(f.world, f.actor, action)).toEqual({ admitted: false, reason: "invalid_issuance" });
  }
  const action = f.bind({ ...f.action, content });
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
});

test("accepted source is single-use and cannot be replayed, cloned, serialized, forged or cross-actor consumed", () => {
  const f = fixture(), action = f.bind();
  for (const copy of [{ ...action }, JSON.parse(JSON.stringify(action)), { ...f.action, foregroundDecisionId: "forged" }, { ...f.action, foregroundDecisionId: "" }])
    expect(consumeForegroundAction(f.world, f.actor, copy)).toEqual({ admitted: false, reason: "invalid_issuance" });
  expect(consumeForegroundAction(f.world, f.other, action)).toEqual({ admitted: false, reason: "invalid_issuance" });
  expect(consumeForegroundAction(f.world, f.actor, action)).toMatchObject({ admitted: true });
  expect(consumeForegroundAction(f.world, f.actor, action)).toEqual({ admitted: false, reason: "already_consumed" });
});

test("a returned action cannot substitute its own goal/work provenance or mint an execution ID", () => {
  const f = fixture();
  for (const change of [
    (action: AgentAction) => { action.coordinationWork = { ownerKey: "owner", itemId: "other promise", generation: "generation" }; },
    (action: AgentAction) => { action.coordinationGoal = { ownerKey: "owner", goalKey: "other goal", createdAt: 1, signature: "signature" }; },
    (action: AgentAction) => { action.executionId = "execution:unissued"; },
  ]) {
    const action = f.bind(); change(action);
    expect(consumeForegroundAction(f.world, f.actor, action)).toEqual({ admitted: false, reason: "invalid_issuance" });
  }
});

test("a discarded decision and its copies cannot become fabricated wait executions", () => {
  const f = fixture(), action = discardedForegroundDecision();
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  for (const copy of [action, { ...action }, JSON.parse(JSON.stringify(action))]) executeActions(f.world, [{ eid: f.actor, action: copy }], f.registry);
  expect(f.execute).not.toHaveBeenCalled(); expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor).receipts).toHaveLength(0);
});

function result(action: AgentAction, extra = {}) { return { text: JSON.stringify({ innerThought: "DRAFT_THOUGHT", action, ...extra }) }; }

test("provider diagnostics correlate to the request without retaining model text", async () => {
  const f = fixture(), rows: any[] = [];
  const release = chronicle.subscribe(entry => { if ((entry.type as string) === "foreground_provider_result") rows.push(entry.data); });
  try {
    const response = { ...result(f.action), finishReason: "stop", usage: { inputTokens: 123, outputTokens: 45,
      outputTokenDetails: { reasoningTokens: 9 } } };
    generate.mockResolvedValue(response);
    await agentThink(f.world, f.actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId: expect.any(String), provider: { outcome: "returned", durationWallMs: expect.any(Number),
      inputTokens: 123, outputTokens: 45, reasoningTokens: 9, finishReason: "stop", outputCharacters: response.text.length } });
    expect(JSON.stringify(rows)).not.toContain("DRAFT_THOUGHT");
  } finally { release(); }
});
test.each(["provider_error", "malformed_response"])("provider telemetry preserves %s admission behavior and excludes error bodies", async kind => {
  const f = fixture(), rows: any[] = [];
  const release = chronicle.subscribe(entry => { if ((entry.type as string) === "foreground_provider_result") rows.push(entry.data); });
  try {
    if (kind === "provider_error") generate.mockRejectedValue(new Error("PRIVATE_PROVIDER_BODY"));
    else generate.mockResolvedValue({ text: "PRIVATE_MALFORMED_RESPONSE" });
    const action = await agentThink(f.world, f.actor);
    expect(isDiscardedForegroundDecision(action)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider.outcome).toBe(kind === "provider_error" ? "error" : "returned");
    expect(rows[0].provider.inputTokens).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_");
  } finally { release(); }
});
test("a source change during model generation admits neither thought nor new goal, and never executes a wait", async () => {
  const f = fixture(), log = jest.spyOn(chronicle, "record");
  generate.mockImplementation(async () => { f.setAvailable([]); return result(f.action, { goalUpdate: { description: "STALE_GOAL", priority: 9 } }); });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0); expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).not.toHaveBeenCalled();
  expect(getWorkingMemory(f.world, f.actor).receipts.some(receipt => receipt.provenance === "own_action")).toBe(false);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  expect(log).toHaveBeenCalledWith("decision_superseded", expect.objectContaining({ boundary: "response", reason: "command_availability_changed" }));
});

test("a door opening during a targetless wait discards its thought and goal before cognitive effects", async () => {
  const f = fixture(), log = jest.spyOn(chronicle, "record"); f.setRoutes([]);
  const beforePolicy = getPolicyEffectiveness(f.actor), beforeWatcher = getAgentActionHistory(f.actor);
  generate.mockImplementationOnce(async () => { f.setRoutes([f.remote]); ObjectState.current[f.target] = "finished";
    return result({ type: "wait" }, { goalUpdate: { description: "WAIT_FOR_FINISHED_WORK", priority: 9 } }); });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0); expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
  expect(getPolicyEffectiveness(f.actor)).toEqual(beforePolicy); expect(getAgentActionHistory(f.actor)).toEqual(beforeWatcher);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).not.toHaveBeenCalled(); expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor).receipts.some(receipt => receipt.provenance === "own_action")).toBe(false);
  expect(log).toHaveBeenCalledWith("decision_superseded", expect.objectContaining({ boundary: "response", reason: "local_view_changed" }));
});

test("scene churn retries only on subsequent cycles and a stable current reply can proceed", async () => {
  const f = fixture();
  for (const state of ["first update", "second update"]) {
    generate.mockImplementationOnce(async () => { ObjectState.current[f.target] = state; return result({ type: "wait" }); });
    expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] })).toEqual([]);
  }
  expect(generate).toHaveBeenCalledTimes(2); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  generate.mockResolvedValue(result({ type: "speak", content: "Now I see where we are." }));
  const ready = await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] });
  expect(ready).toHaveLength(1); expect(generate).toHaveBeenCalledTimes(3);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  executeActions(f.world, ready, f.registry);
  // Speech is owned by the shared voice executor, not a package body hook.
  expect(f.execute).not.toHaveBeenCalled();
  expect(LastAction.type[f.actor]).toBe("speak"); expect(LastAction.success[f.actor]).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(1);
});

test("current prompt keeps unavailable visible state explicit after history, without forbidding a bad attempt", async () => {
  const f = fixture(); f.setAvailable([]); ObjectState.current[f.target] = "unpowered";
  generate.mockResolvedValue(result(f.action));
  const action = await agentThink(f.world, f.actor);
  const request = generate.mock.calls[0][0];
  const prompt = request.messages[0].content as string;
  expect(prompt).toContain("unpowered");
  expect(prompt.lastIndexOf("unpowered")).toBeLessThan(prompt.indexOf("CURRENT DECISION EVIDENCE"));
  expect(prompt.lastIndexOf("unpowered")).toBeGreaterThan(prompt.indexOf("Optional top-level fields"));
  expect(request.system).toContain("unpowered"); // Sensing precedes the working-memory projection.
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(action).toMatchObject(f.action); // A current but poor choice remains an actual choice.
});

test("current context replaces old rolling sensory frames but keeps exact delivered event evidence", () => {
  const f = fixture(), at = Date.now();
  addPerception(f.world, f.actor, { type: "perception", source: "senses", content: "OLD_POWERED_FRAME", timestamp: at - 10 });
  addPerception(f.world, f.actor, { type: "action_result", source: "physical world", content: "I read OLD_POWERED_FRAME at the control.", timestamp: at - 9 });
  addPerception(f.world, f.actor, { type: "attention", source: "local world", content: "THE_POWER_TRIPPED", timestamp: at - 8 });
  addPerception(f.world, f.actor, { type: "perception", source: "senses", content: "CURRENT_UNPOWERED_FRAME", timestamp: at });
  const context = buildAgentContext(f.world, f.actor);
  expect(context).toContain("CURRENT_UNPOWERED_FRAME"); expect(context).toContain("THE_POWER_TRIPPED");
  expect(context).toContain("I read OLD_POWERED_FRAME at the control.");
  expect(context.match(/OLD_POWERED_FRAME/g)).toHaveLength(1);
});

test("rolling frame projection uses timestamps for out-of-order delivery and admission order for equal timestamps", () => {
  const f = fixture(), at = Date.now();
  addPerception(f.world, f.actor, { type: "perception", source: "senses", content: "FIRST_SAME_TIME", timestamp: at });
  addPerception(f.world, f.actor, { type: "perception", source: "senses", content: "NEWEST_SAME_TIME", timestamp: at });
  addPerception(f.world, f.actor, { type: "perception", source: "senses", content: "ARRIVED_LATER_BUT_OLDER", timestamp: at - 10 });
  const context = buildAgentContext(f.world, f.actor);
  expect(context).toContain("NEWEST_SAME_TIME"); expect(context).not.toContain("FIRST_SAME_TIME");
  expect(context).not.toContain("ARRIVED_LATER_BUT_OLDER");
});

test.each(["removed", "replacement", "punctuated replacement"])("raw movement to an object checks its normalized observation before cognition commits (%s)", async mode => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "signal", content: "Inspect the control." });
  const beforePolicy = getPolicyEffectiveness(f.actor), beforeWatcher = getAgentActionHistory(f.actor);
  generate.mockImplementationOnce(async () => {
    removeEntity(f.world, f.target);
    if (mode !== "removed") createObjectEntity(f.world, { name: "Control", roomId: f.room });
    return result({ type: "move", target: mode === "punctuated replacement" ? "Control." : "Control" },
      { goalUpdate: { description: "STALE_REPLACEMENT_GOAL", priority: 9 } });
  });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0); expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
  expect(getPolicyEffectiveness(f.actor)).toEqual(beforePolicy); expect(getAgentActionHistory(f.actor)).toEqual(beforeWatcher);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry); expect(f.execute).not.toHaveBeenCalled();
  generate.mockResolvedValue(result({ type: "think", content: "Reconsider the new scene." }));
  await agentThink(f.world, f.actor); expect(generate).toHaveBeenCalledTimes(2); // Signal was not silently acknowledged.
});

test("unchanged raw movement to a local object admits its exact normalized observation", async () => {
  const f = fixture(); generate.mockResolvedValue(result({ type: "move", target: "Control." }));
  const action = await agentThink(f.world, f.actor);
  expect(action).toMatchObject({ type: "observe", target: "Control" });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).toHaveBeenCalledWith(expect.objectContaining({ type: "observe", target: "Control" }));
});

test("normalization to wait cannot hide newly occupied movement from the raw source check", async () => {
  const f = fixture(); generate.mockImplementation(async () => { f.setBusy(true); return result({ type: "move", target: "Hall" },
    { goalUpdate: { description: "STALE_BUSY_GOAL", priority: 9 } }); });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(true); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
});

test("runCognitionCycle returns no actionable entry for a discarded response; the next fresh decision still runs", async () => {
  const f = fixture();
  generate.mockImplementationOnce(async () => { f.setAvailable([]); return result(f.action); });
  expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] })).toEqual([]);
  generate.mockResolvedValue(result({ type: "speak", content: "You have the control; I can wait." }));
  expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] })).toHaveLength(1);
  expect(generate).toHaveBeenCalledTimes(2);
});

test("dispatch gap rechecks selected availability before proof/learning capture, preserving unrelated deferred learning", async () => {
  const f = fixture(); generate.mockResolvedValue(result(f.action)); const action = await agentThink(f.world, f.actor);
  const goal = createIntentGoal(f.world, f.actor, "Operate the control", 5);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "Operate the control", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Operate", actionType: "interact", target: "Control", content: "operate control" }] });
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  captureLLMDecision(f.world, f.actor, "An older outstanding operation", { type: "interact", target: "Other control", content: "operate older" });
  const before = getWorkingMemory(f.world, f.actor); f.setAvailable([]);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).not.toHaveBeenCalled(); expect(Plan.currentStep[plan]).toBe(0);
  expect(getWorkingMemory(f.world, f.actor)).toEqual(before); expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(true);
});

test("two returned foreground proposals cannot both claim one resource in a dispatch batch", async () => {
  const f = fixture(); registerAgentWorldCapabilities(f.world, f.other, { ...f.capabilities });
  generate.mockResolvedValue(result(f.action));
  const [first, second] = await Promise.all([agentThink(f.world, f.actor), agentThink(f.world, f.other)]);
  expect(isDiscardedForegroundDecision(first)).toBe(false); expect(isDiscardedForegroundDecision(second)).toBe(false);
  f.execute.mockImplementation(action => {
    f.setAvailable([]); // The first real admission occupies the public resource.
    completeDeferredAction(f.world, f.actor, action, true, "Control admitted."); return true;
  });
  executeActions(f.world, [{ eid: f.actor, action: first }, { eid: f.other, action: second }], f.registry);
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(LastAction.success[f.actor]).toBe(true); expect(hasComponent(f.world, f.other, LastAction)).toBe(false);
  expect(getWorkingMemory(f.world, f.other).receipts.filter(receipt => receipt.provenance === "own_action")).toHaveLength(0);
  expect(getCompilationStats(f.other, f.world).pendingDecision).toBe(false);
});

test("unchanged known-invalid proposal reaches the real executor and retains a genuine failed receipt", async () => {
  const f = fixture(); f.setAvailable([]); generate.mockResolvedValue(result(f.action));
  f.execute.mockImplementation(action => { completeDeferredAction(f.world, f.actor, action, false, "Control unavailable."); return true; });
  const action = await agentThink(f.world, f.actor); executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).toHaveBeenCalledTimes(1); expect(LastAction.success[f.actor]).toBe(false);
  expect(getWorkingMemory(f.world, f.actor).receipts.some(receipt => receipt.kind === "action" && receipt.succeeded === false)).toBe(true);
});

test("accepted deferred action retains its actual execution identity and completes exactly once", async () => {
  const f = fixture(); generate.mockResolvedValue(result(f.action)); const action = await agentThink(f.world, f.actor);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  const received = f.execute.mock.calls[0][0]; expect(received.executionId).toMatch(/^execution:/);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(true);
  f.setBusy(true); f.setAvailable([]); ObjectState.current[f.target] = "operated";
  completeDeferredAction(f.world, f.actor, { ...received }, true, "Actual operation completed.");
  const receipts = getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.kind === "action"); expect(receipts).toHaveLength(1);
  expect(receipts[0].succeeded).toBe(true); expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  completeDeferredAction(f.world, f.actor, received, true, "Duplicate completion.");
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.kind === "action")).toHaveLength(1);
  expect(f.execute).toHaveBeenCalledTimes(1);
});

test("endpoint availability does not claim to detect an unobserved acquire/release ABA cycle", () => {
  const f = fixture(), fence = f.fence(); f.setAvailable([]); f.setAvailable(["operate control"]);
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
});

/** Check the real execution boundary, not just the sentinel's wait-shaped type. */
function assertNotExecuted(f: ReturnType<typeof fixture>, action: AgentAction) {
  expect(isDiscardedForegroundDecision(action)).toBe(true);
  const goal = createIntentGoal(f.world, f.actor, "A separate real plan", 5);
  const plan = createPlanEntity(f.world, f.actor, goal, { goalDescription: "A separate real plan", estimatedCompletion: "short", potentialObstacles: [],
    steps: [{ description: "Wait deliberately", actionType: "wait" }] });
  captureLLMDecision(f.world, f.actor, "Existing pending work", { type: "interact", target: "Other control", content: "operate older" });
  const memory = getWorkingMemory(f.world, f.actor), watcher = getAgentActionHistory(f.actor), policy = getPolicyEffectiveness(f.actor);
  for (const attempt of [action, { ...action }, JSON.parse(JSON.stringify(action))]) executeActions(f.world, [{ eid: f.actor, action: attempt }], f.registry);
  expect(f.execute).not.toHaveBeenCalled(); expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(Plan.currentStep[plan]).toBe(0); expect(getWorkingMemory(f.world, f.actor)).toEqual(memory);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getAgentActionHistory(f.actor)).toEqual(watcher); expect(getPolicyEffectiveness(f.actor)).toEqual(policy);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(true); // Unrelated real execution remains pending.
}

test.each([
  ["missing_json", "No decision here."], ["malformed_json", '{"action":'],
  ["invalid_schema", '{"innerThought":"MUST_NOT_LAND","action":{"type":"teleport"}}'],
  ["missing_action_input", '{"action":{"type":"interact","target":"Control"}}'],
  ["invalid_goal_reference", '{"action":{"type":"interact","target":"Control","content":"operate control","goalId":-18}}'],
  ["new_goal_not_admitted", '{"action":{"type":"interact","target":"Control","content":"operate control","goalId":"new"}}'],
] as const)("%s rejects without action/learning/plan effects or provider text in diagnostics", async (reason, text) => {
  const f = fixture(), log = jest.spyOn(chronicle, "record"); generate.mockResolvedValue({ text });
  const action = await agentThink(f.world, f.actor);
  expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ reason, boundary: "response", requestId: expect.stringMatching(/^foreground:/) }));
  expect(log.mock.calls.filter(([event]) => event === "llm_decision")).toHaveLength(0);
  expect(JSON.stringify(log.mock.calls)).not.toContain("MUST_NOT_LAND");
  assertNotExecuted(f, action);
});

test("six rejected work-reference drafts and a provider timeout create zero executed waits, with a still-valid owned catalog", async () => {
  const f = fixture(), log = jest.spyOn(chronicle, "record");
  const speech = recordCommittedSpeech(f.world, f.actor, "I will operate the control.", "Lin")!;
  expect(applyCoordinationReviews(f.world, f.actor, [{ kind: "undertake", speechId: speech.id, task: "Operate the control" }])).toBe(1);
  const originalWork = captureCoordinationWork(f.world, f.actor, speech.id);
  for (let n = 0; n < 6; n++) {
    generate.mockResolvedValueOnce(result({ ...f.action, undertakingId: `wrong-reference-${n}` } as AgentAction));
    const actions = await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] });
    expect(actions).toEqual([]); executeActions(f.world, actions, f.registry);
    expect(captureCoordinationWork(f.world, f.actor, speech.id)).toEqual(originalWork);
  }
  generate.mockRejectedValueOnce(new DOMException("DO_NOT_LOG_PROVIDER_BODY", "TimeoutError"));
  expect(await runCognitionCycle(f.world, f.registry, { agentEids: [f.actor] })).toEqual([]);
  const rejected = log.mock.calls.filter(([event]) => event === "decision_rejected").map(([, data]) => data);
  expect(rejected).toHaveLength(7);
  for (let n = 0; n < 6; n++) expect(rejected[n]).toMatchObject({ reason: "invalid_undertaking_reference", reference: {
    supplied: { kind: "string", value: `wrong-reference-${n}` }, issued: [{ id: speech.id, status: "not_started", eligible: true }], matchesOwnSpeech: false,
  } });
  expect(rejected[6]).toMatchObject({ reason: "timeout" }); expect(JSON.stringify(rejected)).not.toContain("DO_NOT_LOG");
  expect(f.execute).not.toHaveBeenCalled(); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(hasComponent(f.world, f.actor, LastAction)).toBe(false);
  expect(getWorkingMemory(f.world, f.actor).receipts.filter(receipt => receipt.kind === "action")).toHaveLength(0);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
});

test.each([null, 7, true, {}, [], "x".repeat(1000)])("invalid work diagnostic bounds actual value shape %j without relaxing ownership", async undertakingId => {
  const f = fixture(), log = jest.spyOn(chronicle, "record");
  generate.mockResolvedValue(result({ ...f.action, undertakingId } as AgentAction));
  expect(isDiscardedForegroundDecision(await agentThink(f.world, f.actor))).toBe(true);
  const data = log.mock.calls.find(([event]) => event === "decision_rejected")![1]!;
  expect(data.reason).toBe("invalid_undertaking_reference");
  expect(data.reference.supplied.kind).toBe(undertakingId === null ? "null" : Array.isArray(undertakingId) ? "array" : typeof undertakingId);
  expect(JSON.stringify(data.reference).length).toBeLessThan(350);
  if (typeof undertakingId === "string") expect(data.reference.supplied).toMatchObject({ value: "x".repeat(180), truncated: true });
});

test.each(["provider", "deadline", "guard", "task", "superseded"])("%s failure/cancellation cannot return an executable wait", async mode => {
  const f = fixture(), log = jest.spyOn(chronicle, "record"), controller = new AbortController(); let current = true;
  if (mode === "deadline") jest.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  generate.mockImplementationOnce(async () => {
    if (mode === "provider") throw new Error("PRIVATE_PROVIDER_RESPONSE_BODY");
    if (mode === "superseded") current = false; else controller.abort();
    return result(f.action, { goalUpdate: { description: "REJECTED_GOAL", priority: 9 } });
  });
  const think = () => agentThink(f.world, f.actor, { ...(mode === "guard" ? { signal: controller.signal } : {}), isCurrent: () => current });
  const action = mode === "task" ? await withSimulationTask(controller.signal, think) : await think();
  expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ reason: mode === "provider" ? "provider_error" : mode === "deadline" ? "timeout" : "cancelled" }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_PROVIDER");
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0); assertNotExecuted(f, action);
});

test("already-cancelled decision never invokes a provider or performs request sensing", async () => {
  const f = fixture(), signal = AbortSignal.abort();
  const action = await agentThink(f.world, f.actor, { signal });
  expect(generate).not.toHaveBeenCalled(); expect(getWorkingMemory(f.world, f.actor).receipts).toHaveLength(0);
  assertNotExecuted(f, action);
});

test("new dialogue omits stale mental claims without starving an independently valid body command", async () => {
  const f = fixture(), log = jest.spyOn(chronicle, "record");
  generate.mockImplementationOnce(async () => { recordCommittedSpeech(f.world, f.other, "I have already done that.", "Ada");
    return result(f.action, { innerThought: "Lin asked me to operate it." }); });
  const action = await agentThink(f.world, f.actor);
  expect(isDiscardedForegroundDecision(action)).toBe(false);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(getCompilationStats(f.actor, f.world).pendingDecision).toBe(false);
  expect(log).toHaveBeenCalledWith("mental_update_discarded", expect.objectContaining({ reason: "dialogue_changed", boundary: "response" }));
});

test("an explicit admitted model wait and an unmarked native wait remain real executable choices", async () => {
  const log = jest.spyOn(chronicle, "record");
  for (const mode of ["model", "native"]) {
    const f = fixture();
    generate.mockResolvedValue(result({ type: "wait" }));
    const action: AgentAction = mode === "model" ? await agentThink(f.world, f.actor) : { type: "wait" };
    expect(isDiscardedForegroundDecision(action)).toBe(false);
    f.execute.mockImplementation(actual => { completeDeferredAction(f.world, f.actor, actual, true, "Waited intentionally."); return true; });
    executeActions(f.world, [{ eid: f.actor, action }], f.registry);
    if (mode === "model") expect(log).toHaveBeenCalledWith("llm_decision", expect.objectContaining({
      agentEid: f.actor, requestId: action.foregroundDecisionId, origin: "model", actionType: "wait",
    }));
    expect(f.execute).toHaveBeenCalledTimes(1); expect(LastAction.type[f.actor]).toBe("wait");
    expect(LastAction.success[f.actor]).toBe(true); // Quiet waits need not mint a physical evidence receipt.
  }
});

test.each(["busy move", "self interact", "pending tool"])("LLM selection suppressed by normalization (%s) is not an intentional wait", async mode => {
  const f = fixture(), log = jest.spyOn(chronicle, "record"); let selected: AgentAction;
  addPerception(f.world, f.actor, { type: "attention", source: "operator", content: "Reconsider current work." });
  if (mode === "busy move") { f.setBusy(true); selected = { type: "move", target: "Hall" }; }
  else if (mode === "self interact") selected = { type: "interact", target: "Ada", content: "operate control" };
  else {
    addComponent(f.world, f.actor, PendingToolJob); PendingToolJob.toolId[f.actor] = "terminal.run";
    selected = { type: "interact", target: "Control", content: "run_command something" };
  }
  generate.mockResolvedValue(result(selected, { goalUpdate: { description: "UNADMITTED_SUPPRESSED_GOAL", priority: 9 } }));
  const action = await agentThink(f.world, f.actor);
  expect(log).toHaveBeenCalledWith("decision_rejected", expect.objectContaining({ reason: "selection_suppressed", actionType: selected.type }));
  expect(getRelationTargets(f.world, f.actor, HasGoal)).toHaveLength(0);
  assertNotExecuted(f, action);
});

test("physical source fingerprint never treats concealed own object state or another person's internal state as visual evidence", () => {
  const f = fixture(); addComponent(f.world, f.target, Traits); Traits.active[f.target] = '["hidden"]';
  setLocatedIn(f.world, f.target, f.actor); addComponent(f.world, f.other, ObjectState); ObjectState.current[f.other] = "PRIVATE_INTENTION";
  const fence = f.fence(); ObjectState.current[f.target] = "PRIVATE_CONCEALED_CHANGED"; ObjectState.current[f.other] = "PRIVATE_NEW_INTENTION";
  expect(checkForegroundDecision(f.world, f.actor, fence, f.action)).toBeUndefined();
  expect(checkForegroundDecision(f.world, f.actor, fence, { type: "give", target: "Lin", content: "Control" })).toBeUndefined();
  expect(JSON.stringify(getWorkingMemory(f.world, f.actor))).not.toContain("PRIVATE_");
});
