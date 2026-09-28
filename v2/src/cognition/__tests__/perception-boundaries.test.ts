import { jest } from "@jest/globals";
import { addComponent, addEntity } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Mind, Name, Needs, Traits, ObjectState, Description, StimulusSource } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { filterPerceivableStimuli, getAgentSensoryCapabilities, normalizeSensoryEvent } from "../sensory-capabilities";
import { formatStimuliForPrompt, generateStimuliForAgent, getAgentSensoryFingerprint, recordSuccessfulAction } from "../sensory-system";
import { broadcastToRoom, drainPendingStimuli, peekPendingStimuli, queueStimulus, queueStimulusForAgent } from "../stimulus-queue";
import { getSocialDialogue, recordCommittedSpeech } from "../social-memory";
import { getAgentVisibleEntities, registerAgentWorldCapabilities } from "../world-capabilities";
import { addPerception, addThought } from "../agent-mind";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { canUseAffordance, executeAffordance } from "../../world/effect-executor";
import { worldSchema } from "../../world/schema";

function fixture() {
  const world = createArgosWorld("Perception boundaries"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Workshop" }), remote = createRoomEntity(world, { name: "Garden" });
  const make = (name: string, traits: string[] = [], roomId = room) => {
    const eid = createAgentEntity(world, { name, role: "resident", systemPrompt: "Private identity", roomId });
    addComponent(world, eid, Traits); Traits.active[eid] = JSON.stringify(traits); return eid;
  };
  const listener = make("Mara"), deaf = make("Dara", ["deaf"]), blind = make("Bela", ["blind"]);
  const speaker = make("Ivo"), distant = make("Sera", [], remote);
  return { world, room, remote, listener, deaf, blind, speaker, distant, make };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live calls in perception tests")); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); drainPendingStimuli(); });

test("normalization preserves explicit modality, emission time and intensity", () => {
  const event = { type: "speech", modality: "cognitive" as const, content: "A remembered voice", source: "memory", intensity: 0.2, timestamp: 123 };
  expect(normalizeSensoryEvent(event)).toEqual(event);
  expect(normalizeSensoryEvent({ type: "directed_speech", content: "Hello", source: "Ivo" }).modality).toBe("auditory");
});

test.each(["thought", "message", "tool_result", "action_failed", "daemon_whisper", "daemon_challenge"])("%s mental/execution input remains available without sight or hearing", type => {
  const f = fixture(), actor = f.make("Mental", ["blind", "deaf"]);
  expect(filterPerceivableStimuli(f.world, actor, [{ type, content: "Known inner input", source: "self" }])).toHaveLength(1);
});

test("disabled modalities override heightened senses, robustly parsed traits", () => {
  const f = fixture(), actor = f.make("Limited", [" BLIND ", "keen_sight", "deaf", "keen_hearing"]);
  expect(getAgentSensoryCapabilities(f.world, actor)).toMatchObject({ visual: 0, auditory: 0 });
  expect(filterPerceivableStimuli(f.world, actor, [
    { type: "speech", content: "Unheard", source: "Ivo" },
    { type: "movement", content: "Unseen", source: "Ivo" },
    { type: "thought", content: "Remembered", source: "self" },
  ]).map(s => s.content)).toEqual(["Remembered"]);
  Traits.active[actor] = JSON.stringify({ blind: false });
  expect(getAgentSensoryCapabilities(f.world, actor).visual).toBe(1);
});

test("zero intensity and absent entities do not receive stimuli", () => {
  const f = fixture(), silent = { type: "speech", content: "Not emitted", source: "Ivo", intensity: 0 };
  expect(filterPerceivableStimuli(f.world, f.listener, [silent])).toEqual([]);
  expect(filterPerceivableStimuli(f.world, 900_000, [{ ...silent, intensity: 1 }])).toEqual([]);
});

test("room broadcasts and durable speech recall agree on local hearing boundaries", () => {
  const f = fixture();
  broadcastToRoom(f.world, f.room, { type: "speech", content: "I have the key", source: "Ivo" }, f.speaker);
  const targets = drainPendingStimuli().map(s => s.targetEid);
  expect(targets.sort()).toEqual([f.listener, f.blind].sort());
  recordCommittedSpeech(f.world, f.speaker, "I have the key", "Mara");
  for (const eid of [f.listener, f.blind]) expect(getSocialDialogue(f.world, eid)).toHaveLength(1);
  for (const eid of [f.deaf, f.distant]) expect(getSocialDialogue(f.world, eid)).toEqual([]);
  // What was said is not an inventory transfer or a proof of possession.
  expect(getSocialDialogue(f.world, f.listener)[0].content).toBe("I have the key");
});

test("named routing filters disabled channels but supports explicit remote mental messages", () => {
  const f = fixture();
  queueStimulusForAgent(f.world, "Dara", { type: "speech", content: "Unheard", source: "Ivo" });
  queueStimulusForAgent(f.world, "Sera", { type: "message", content: "A routed thought", source: "daemon", intensity: 0.3 });
  expect(drainPendingStimuli()).toMatchObject([{ targetEid: f.distant, content: "A routed thought", intensity: 0.3, modality: "cognitive" }]);
});

test("queue snapshots input and does not renew its age when paginated/requeued", () => {
  jest.useFakeTimers(); jest.setSystemTime(10_000);
  const f = fixture(), input = { targetEid: f.listener, type: "speech", content: "Original", source: "Ivo", intensity: 0.4 };
  queueStimulus(f.world, input); input.content = "Mutated";
  const peeked = peekPendingStimuli(f.listener);
  expect(peeked).toHaveLength(1); peeked[0].content = "Changed copy";
  expect(peekPendingStimuli(f.deaf)).toEqual([]);
  const event = drainPendingStimuli()[0];
  expect(event.content).toBe("Original"); expect(event.timestamp).toBe(10_000);
  jest.setSystemTime(20_000); queueStimulus(event);
  const requeued = drainPendingStimuli()[0]; expect(requeued.timestamp).toBe(10_000);
  const perceived = generateStimuliForAgent(f.world, f.listener, [requeued]).find(s => s.type === "speech")!;
  expect(perceived).toMatchObject({ timestamp: 10_000, intensity: 0.4, source: "Ivo", content: "Original" });
  expect(formatStimuliForPrompt([perceived])).toContain("[Ivo, 10s ago]");
});

test("blind actors do not receive visible states via cognitive affordance/awareness fallback", () => {
  const f = fixture(), hidden = addEntity(f.world);
  addComponent(f.world, hidden, Name); Name.value[hidden] = "UNSEEN_LOCKER";
  addComponent(f.world, hidden, ObjectState); ObjectState.current[hidden] = "locked";
  setLocatedIn(f.world, hidden, f.room);
  expect(JSON.stringify(generateStimuliForAgent(f.world, f.blind, []))).not.toContain("UNSEEN_LOCKER");
  expect(JSON.stringify(generateStimuliForAgent(f.world, f.listener, []))).toContain("UNSEEN_LOCKER");
});

test("unattached stale SoA fields and malformed trait JSON do not invent observations or crash sensing", () => {
  const f = fixture(), object = addEntity(f.world);
  addComponent(f.world, object, Name); Name.value[object] = "Plain object"; setLocatedIn(f.world, object, f.room);
  // A removed component can leave old values in its global SoA slot.
  Traits.active[object] = JSON.stringify(["burning", "dangerous"]);
  ObjectState.current[object] = "locked";
  Description.value[object] = "STALE_DESCRIPTION";
  const output = JSON.stringify(generateStimuliForAgent(f.world, f.listener, []));
  expect(output).not.toContain("STALE_DESCRIPTION"); expect(output).not.toContain("smoke from Plain object");
  expect(output).not.toContain("Plain object [locked]");
  addComponent(f.world, object, Traits); Traits.active[object] = JSON.stringify({ burning: true });
  expect(() => generateStimuliForAgent(f.world, f.listener, [])).not.toThrow();
});

test("a roomless actor retains routed cognitive feedback", () => {
  const f = fixture(), actor = addEntity(f.world);
  expect(generateStimuliForAgent(f.world, actor, [{ type: "tool_result", content: "Known result", source: "tool", timestamp: 15 }]))
    .toMatchObject([{ modality: "cognitive", content: "Known result", timestamp: 15 }]);
});

test("world context preserves a blind actor's possessions, without exposing room or package-visible surfaces", () => {
  const f = fixture(), held = addEntity(f.world), local = addEntity(f.world);
  setLocatedIn(f.world, held, f.blind); setLocatedIn(f.world, local, f.room);
  const cleanup = registerAgentWorldCapabilities(f.world, f.blind, { ready: () => true, busy: () => false,
    execute: () => false, context: () => "", visibleEntities: () => [local] });
  try { expect(getAgentVisibleEntities(f.world, f.blind)).toEqual([held]); } finally { cleanup(); }
  expect(getAgentVisibleEntities(f.world, f.listener)).toContain(local);
});

test("native and package-advertised examine cannot bypass sight, while a held object's nonvisual use remains available", () => {
  const f = fixture(), held = addEntity(f.world); setLocatedIn(f.world, held, f.blind);
  addComponent(f.world, held, Name); Name.value[held] = "Known tool";
  const examine = { name: "examine", requires: [] };
  const cleanup = registerAgentWorldCapabilities(f.world, f.blind, { ready: () => true, busy: () => false, execute: () => false,
    context: () => "", affordances: () => [examine, { name: "feel_shape", requires: [] }] });
  try {
    expect(getAvailableAffordances(f.world, f.blind, held).map(a => a.name)).not.toContain("examine");
    expect(getAvailableAffordances(f.world, f.blind, held).map(a => a.name)).toContain("feel_shape");
    expect(canUseAffordance(f.world, examine, f.blind, held).available).toBe(false);
    expect(canUseAffordance(f.world, examine, f.listener, held).available).toBe(true);
    expect(executeAffordance("examine", { world: f.world, actorEid: f.blind, targetEid: held, worldSchema,
      registry: { byName: new Map(), byId: new Map() } })).toMatchObject({ success: false, changes: [] });
  } finally { cleanup(); }
});

test("sensory idle signature ignores own thoughts, receipts, arousal and continuously changing needs", () => {
  jest.useFakeTimers(); jest.setSystemTime(10_000);
  const f = fixture(), signature = getAgentSensoryFingerprint(f.world, f.listener);
  addComponent(f.world, f.listener, Needs);
  for (let i = 0; i < 10; i++) {
    jest.setSystemTime(10_000 + i * 1500);
    Mind.arousal[f.listener] = i / 10; Mind.focus[f.listener] = `Reflection ${i}`; Mind.mode[f.listener] = "reflective";
    Needs.energy[f.listener] = 15 + i; Needs.hunger[f.listener] = 40 + i; Needs.social[f.listener] = 55 + i;
    addThought(f.world, f.listener, { content: `Time to rest ${i}` });
    addPerception(f.world, f.listener, { type: "action_result", source: "physical world", content: `Resting ${i}` });
    recordSuccessfulAction(f.world, f.listener, `rest ${i}`);
    expect(getAgentSensoryFingerprint(f.world, f.listener)).toBe(signature);
  }
});

test("idle sensory signature ignores clocks, remote changes and unseen state, but notices local events", () => {
  jest.useFakeTimers(); jest.setSystemTime(10_000);
  const f = fixture();
  const object = addEntity(f.world); addComponent(f.world, object, Name); Name.value[object] = "Lamp";
  addComponent(f.world, object, ObjectState); ObjectState.current[object] = "off"; setLocatedIn(f.world, object, f.room);
  const seen = getAgentSensoryFingerprint(f.world, f.listener), unseen = getAgentSensoryFingerprint(f.world, f.blind);
  jest.setSystemTime(50_000); Description.value[f.distant] = "Remote changed clothing";
  expect(getAgentSensoryFingerprint(f.world, f.listener)).toBe(seen);
  ObjectState.current[object] = "on";
  expect(getAgentSensoryFingerprint(f.world, f.listener)).not.toBe(seen);
  expect(getAgentSensoryFingerprint(f.world, f.blind)).toBe(unseen);
  addComponent(f.world, object, StimulusSource); StimulusSource.stimulusType[object] = "sound"; StimulusSource.template[object] = "The lamp hums.";
  expect(getAgentSensoryFingerprint(f.world, f.blind)).not.toBe(unseen);
  const deafBefore = getAgentSensoryFingerprint(f.world, f.deaf);
  StimulusSource.template[object] = "The lamp buzzes.";
  expect(getAgentSensoryFingerprint(f.world, f.deaf)).toBe(deafBefore);
});
