import { jest } from "@jest/globals";
const ai = await import("ai");
const generate = jest.fn<(...args: any[]) => Promise<{ text: string }>>();
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: generate }));
const { addComponent, hasComponent, removeComponent } = await import("bitecs");
const { createArgosWorld } = await import("../../ecs/world");
const { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } = await import("../../ecs/prefabs");
const { AffectState, Agent, Appearance, Mind, ObjectState, Traits, WorkingMemoryIdentity } = await import("../../ecs/components");
const { setLocatedIn } = await import("../../ecs/location");
const { createSystemRegistry } = await import("../../ecs/dynamic-systems");
const { configureCharacterAppearance, snapshotCharacterAppearance } = await import("../../rendering/character-appearance");
const { snapshotAffect, publicFacialExpression, prepareAffectUpdate, isPreparedAffectCurrent, commitPreparedAffectUpdate,
  formatAffectContext } = await import("../affect-state");
const { workingMemoryEntityRef } = await import("../working-memory");
const { agentThink, buildAgentContext, addPerception, getAgentThoughts } = await import("../agent-mind");
const { executeActions } = await import("../cognition-system");
const { captureCognitiveLocalView, formatCognitiveLocalView, isCognitiveLocalViewCurrent } = await import("../cognitive-local-view");
const { getCommittedEvents, stopCommittedEvents } = await import("../../runtime/committed-events");
const { serializeWorld, deserializeWorld } = await import("../../persistence/world-persistence");
const { drainPendingStimuli } = await import("../stimulus-queue");
const { registerAgentWorldCapabilities } = await import("../world-capabilities");
import type { AffectUpdate } from "../affect-state";

const appraisal: AffectUpdate = { feeling: "hurt and uncertain", valence: -.7, arousal: .8,
  reason: "PRIVATE: Someone important to me said they no longer want to see me.", expression: "lips pressed" };
function fixture() {
  const world = createArgosWorld("Affect admission"); world.meta.aiEnabled = true; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Lounge" }), remote = createRoomEntity(world, { name: "Hall" });
  const actor = createAgentEntity(world, { name: "Ada", role: "guest", systemPrompt: "Respond to actual experience.", roomId: room });
  const other = createAgentEntity(world, { name: "Lin", role: "friend", systemPrompt: "My own private life.", roomId: room });
  const object = createObjectEntity(world, { name: "Lamp", roomId: room }); ObjectState.current[object] = "on";
  for (const eid of [actor, other]) {
    workingMemoryEntityRef(world, eid);
    configureCharacterAppearance(world, eid, { expression: "attentive", clothing: "blue jacket" });
  }
  const registry = createSystemRegistry();
  return { world, room, remote, actor, other, object, registry };
}
let oldKey: string | undefined;
beforeEach(() => {
  oldKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY; process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-only";
  generate.mockReset(); drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid calls in affect tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  if (oldKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldKey;
});

test("preparation is pure and a committed appraisal persists independently of its expression", () => {
  const f = fixture(), before = Mind.arousal[f.actor], token = prepareAffectUpdate(f.world, f.actor, appraisal)!;
  expect(token).not.toBeNull(); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  expect(hasComponent(f.world, f.actor, AffectState)).toBe(false); expect(Mind.arousal[f.actor]).toBe(before);
  expect(Appearance.expression[f.actor]).toBe("attentive");
  expect(commitPreparedAffectUpdate(f.world, f.actor, token)).toBe(true);
  expect(snapshotAffect(f.world, f.actor)).toMatchObject({ ...appraisal, revision: 1, updatedAtSimMs: 0 });
  expect(Mind.arousal[f.actor]).toBe(.8); expect(commitPreparedAffectUpdate(f.world, f.actor, token)).toBe(false);
  expect(buildAgentContext(f.world, f.actor)).toContain(appraisal.reason);
  expect(buildAgentContext(f.world, f.other)).not.toContain(appraisal.reason);
  expect(JSON.stringify(snapshotCharacterAppearance(f.world, f.actor))).not.toContain("PRIVATE");
  expect(getCommittedEvents(f.world).events).toHaveLength(0);
});

test("private changes need not alter a composed face; no emotion-to-expression rule is imposed", () => {
  const f = fixture(); Appearance.expression[f.actor] = "composed";
  const { expression: _, ...hidden } = appraisal;
  expect(commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, hidden)!)).toBe(true);
  expect(snapshotAffect(f.world, f.actor)).toMatchObject({ feeling: hidden.feeling, expression: "composed" });
  expect(publicFacialExpression(f.world, f.actor)).toBe("composed");
  expect(formatAffectContext(f.world, f.actor)).toContain("It need not reveal what you feel");
});

test.each([null, [], {}, { ...appraisal, valence: 2 }, { ...appraisal, arousal: NaN }, { ...appraisal, reason: "" },
  { ...appraisal, feeling: "x".repeat(81) }, { ...appraisal, expression: appraisal.reason }, { ...appraisal, forceReply: true },
  { ...appraisal, feeling: "sad\u0000" }])("malformed appraisal cannot mutate ECS: %p", invalid => {
  const f = fixture(); expect(prepareAffectUpdate(f.world, f.actor, invalid)).toBeNull();
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(Appearance.expression[f.actor]).toBe("attentive");
});

test("drafts are world/actor/lifetime/revision-bound, one-shot and not forgeable", () => {
  const f = fixture(), token = prepareAffectUpdate(f.world, f.actor, appraisal)!;
  expect(commitPreparedAffectUpdate(f.world, f.other, token)).toBe(false);
  expect(commitPreparedAffectUpdate(createArgosWorld("Other world"), f.actor, token)).toBe(false);
  expect(commitPreparedAffectUpdate(f.world, f.actor, { ...token })).toBe(false);
  const later = prepareAffectUpdate(f.world, f.actor, { ...appraisal, feeling: "relieved" })!;
  expect(commitPreparedAffectUpdate(f.world, f.actor, later)).toBe(true);
  expect(isPreparedAffectCurrent(f.world, f.actor, token)).toBe(false);
  const third = prepareAffectUpdate(f.world, f.actor, appraisal)!;
  WorkingMemoryIdentity.id[f.actor] = "replacement-identity";
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(commitPreparedAffectUpdate(f.world, f.actor, third)).toBe(false);
});

test("a stopped world, inactive actor, or newer physical expression rejects an old draft", () => {
  const f = fixture(), token = prepareAffectUpdate(f.world, f.actor, appraisal)!;
  Appearance.expression[f.actor] = "smiling"; expect(commitPreparedAffectUpdate(f.world, f.actor, token)).toBe(false);
  const newer = prepareAffectUpdate(f.world, f.actor, appraisal)!;
  Agent.active[f.actor] = false; expect(commitPreparedAffectUpdate(f.world, f.actor, newer)).toBe(false); Agent.active[f.actor] = true;
  stopCommittedEvents(f.world); expect(commitPreparedAffectUpdate(f.world, f.actor, newer)).toBe(false);
  expect(prepareAffectUpdate(f.world, f.actor, appraisal)).toBeNull();
});

test("a new appearance component does not resurrect recycled clothes or held props", () => {
  const f = fixture(); removeComponent(f.world, f.actor, Appearance);
  Appearance.clothing[f.actor] = "PRIVATE OLD ACTOR CLOTHES"; Appearance.visiblyHolding[f.actor] = "OLD SECRET";
  const token = prepareAffectUpdate(f.world, f.actor, appraisal)!; expect(commitPreparedAffectUpdate(f.world, f.actor, token)).toBe(true);
  expect(Appearance.clothing[f.actor]).toBe(""); expect(Appearance.visiblyHolding[f.actor]).toBe("");
  expect(publicFacialExpression(f.world, f.actor)).toBe("lips pressed");
});

test("only a visible facial change reaches another actor's local view and freshness fence", () => {
  const f = fixture(), before = captureCognitiveLocalView(f.world, f.other)!;
  const { expression: _, ...hidden } = appraisal;
  commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, hidden)!);
  expect(isCognitiveLocalViewCurrent(f.world, f.other, before)).toBe(true);
  commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, appraisal)!);
  expect(isCognitiveLocalViewCurrent(f.world, f.other, before)).toBe(false);
  const seen = formatCognitiveLocalView(captureCognitiveLocalView(f.world, f.other));
  expect(seen).toContain("lips pressed"); expect(seen).not.toContain("PRIVATE"); expect(seen).not.toContain("hurt and uncertain");
  addComponent(f.world, f.other, Traits); Traits.active[f.other] = '["blind"]';
  expect(formatCognitiveLocalView(captureCognitiveLocalView(f.world, f.other))).not.toContain("lips pressed");
  Traits.active[f.other] = "[]"; setLocatedIn(f.world, f.actor, f.remote);
  expect(formatCognitiveLocalView(captureCognitiveLocalView(f.world, f.other))).not.toContain("lips pressed");
});

test("generic world persistence restores affect without making an old token valid", () => {
  const f = fixture(); commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, appraisal)!);
  const token = prepareAffectUpdate(f.world, f.actor, { ...appraisal, feeling: "calmer" })!;
  const data = serializeWorld(f.world, f.registry), restored = createArgosWorld("Restored");
  const loaded = deserializeWorld(restored, createSystemRegistry(), data);
  const restoredActor = loaded.oldToNewId.get(f.actor)!;
  expect(snapshotAffect(restored, restoredActor)).toMatchObject(appraisal);
  expect(commitPreparedAffectUpdate(restored, restoredActor, token)).toBe(false);
});

test("foreground authored affect is staged until dispatch and returns in later self-context", async () => {
  const f = fixture(); addPerception(f.world, f.actor, { type: "attention", source: "phone", content: "I read a personal message." });
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "I need a moment.", action: { type: "wait" }, affectUpdate: appraisal }) });
  const action = await agentThink(f.world, f.actor);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(snapshotAffect(f.world, f.actor)).toMatchObject(appraisal);
  expect(buildAgentContext(f.world, f.actor)).toContain("hurt and uncertain"); expect(generate).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[0][0].messages[0].content).toContain("Omit expression to keep your current face");
});

test.each(["abort", "scene changed", "malformed"])("%s foreground output cannot admit affect or its thought", async mode => {
  const f = fixture(), controller = new AbortController();
  generate.mockImplementation(async () => {
    if (mode === "abort") controller.abort();
    if (mode === "scene changed") ObjectState.current[f.object] = "off";
    return { text: JSON.stringify({ innerThought: "PRIVATE STALE THOUGHT", action: { type: "wait" },
      affectUpdate: mode === "malformed" ? { ...appraisal, expression: "reveal PRIVATE PHONE TEXT" } : appraisal }) };
  });
  const action = await agentThink(f.world, f.actor, { signal: controller.signal });
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(snapshotAffect(f.world, f.actor)).toBeUndefined(); expect(getAgentThoughts(f.world, f.actor)).toHaveLength(0);
  expect(Appearance.expression[f.actor]).toBe("attentive");
});

test("an independent physical action can proceed while stale ancillary affect remains uncommitted", async () => {
  const f = fixture(); const execute = jest.fn(() => true);
  registerAgentWorldCapabilities(f.world, f.actor, { context: () => "", ready: () => true, busy: () => false,
    movementTargets: () => [f.remote], execute });
  generate.mockResolvedValue({ text: JSON.stringify({ innerThought: "PRIVATE STALE", action: { type: "move", target: "Hall" }, affectUpdate: appraisal }) });
  const action = await agentThink(f.world, f.actor); ObjectState.current[f.object] = "off";
  executeActions(f.world, [{ eid: f.actor, action }], f.registry);
  expect(execute).toHaveBeenCalledTimes(1); expect(snapshotAffect(f.world, f.actor)).toBeUndefined();
  expect(Appearance.expression[f.actor]).toBe("attentive");
});
