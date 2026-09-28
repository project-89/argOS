import { jest } from "@jest/globals";
import { addComponent, addEntity, removeComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Agent, Appearance, Container, EquipSlot, Mind, Name, ObjectState, Perception, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { advanceSimulationTimeline } from "../../runtime/simulation-timeline";
import { startCommittedEvents, stopCommittedEvents } from "../../runtime/committed-events";
import { configureCharacterAppearance } from "../../rendering/character-appearance";
import { getAgentPerceptions } from "../agent-mind";
import { prepareAffectUpdate, commitPreparedAffectUpdate } from "../affect-state";
import { workingMemoryEntityRef } from "../working-memory";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli, peekPendingStimuli } from "../stimulus-queue";
import { runAppearanceEmitter, broadcastAppearanceChange, broadcastExpressionChange, cleanupAppearanceState, getAppearanceEmitterStats } from "../appearance-emitter";

const tracked: ReturnType<typeof createArgosWorld>[] = [];
function fixture(entityOffset = 0) {
  const world = createArgosWorld("Visible appearance"); world.meta.aiEnabled = false;
  // Components are global sparse arrays even though entity allocation is per
  // world. Concurrent fixtures need distinct native storage as well as caches.
  for (let index = 0; index < entityOffset; index++) addEntity(world);
  initializePrefabs(world); tracked.push(world);
  const room = createRoomEntity(world, { name: "Lounge" }), remote = createRoomEntity(world, { name: "Hall" });
  function person(name: string, parent = room, traits: string[] = []) {
    const eid = createAgentEntity(world, { name, role: "guest", systemPrompt: "PRIVATE IDENTITY", roomId: parent });
    configureCharacterAppearance(world, eid, { clothing: "plain jacket", expression: "attentive", posture: "standing" });
    addComponent(world, eid, Traits); Traits.active[eid] = JSON.stringify(traits); workingMemoryEntityRef(world, eid); return eid;
  }
  const actor = person("Ada"), observer = person("Lin");
  const cues = (eid = observer) => getAgentPerceptions(world, eid).filter(id => Perception.type[id] === "action")
    .map(id => ({ source: Perception.source[id], content: Perception.content[id], intensity: Perception.intensity[id] }));
  const tick = (ms = 500) => { advanceSimulationTimeline(world, ms, { integrate: () => {} }); runAppearanceEmitter(world); };
  return { world, room, remote, actor, observer, person, cues, tick };
}
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Appearance tests are offline")); });
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli();
  for (const world of tracked.splice(0)) cleanupAppearanceState(world);
});

test("baseline is silent; a real expression change is perceived by the next 500ms tick", () => {
  const f = fixture(); runAppearanceEmitter(f.world); expect(f.cues()).toEqual([]);
  Appearance.expression[f.actor] = "lips pressed"; runAppearanceEmitter(f.world); expect(f.cues()).toEqual([]);
  f.tick();
  expect(f.cues()).toEqual([{ source: "Ada", content: "Ada's expression shifts to lips pressed.", intensity: .8 }]);
  expect(peekPendingStimuli()).toEqual([]); // no unbound delayed cue survives a recipient lifetime
  runAppearanceEmitter(f.world); f.tick(); expect(f.cues()).toHaveLength(1);
  Appearance.expression[f.actor] = "eyes widened"; f.tick(); expect(f.cues()).toHaveLength(2);
});

test("private appraisal and legacy custom prose cannot leak; a composed mask may remain unchanged", () => {
  const f = fixture(); runAppearanceEmitter(f.world);
  commitPreparedAffectUpdate(f.world, f.actor, prepareAffectUpdate(f.world, f.actor, {
    feeling: "PRIVATE FEELING", reason: "PRIVATE PHONE MESSAGE", valence: -.8, arousal: .9,
  })!);
  f.tick(); expect(f.cues()).toEqual([]);
  Appearance.expression[f.actor] = "composed"; f.tick();
  expect(f.cues().at(-1)?.content).toBe("Ada's expression shifts to composed.");
  f.tick(); broadcastAppearanceChange(f.world, f.actor, "PRIVATE CAUSE supplied by a caller");
  expect(JSON.stringify(f.cues())).not.toContain("PRIVATE");
  expect(JSON.stringify(f.cues())).not.toContain("hurt");
});

test("delivery excludes blind, remote, inactive and source-self recipients", () => {
  const f = fixture(), blind = f.person("Blind friend", f.room, ["blind"]), remote = f.person("Remote friend", f.remote);
  const inactive = f.person("Inactive friend"); Agent.active[inactive] = false;
  runAppearanceEmitter(f.world); Appearance.expression[f.actor] = "frowning"; f.tick();
  expect(f.cues()).toHaveLength(1); for (const eid of [blind, remote, inactive, f.actor]) expect(f.cues(eid)).toEqual([]);
});

test.each(["hidden", "invisible", "concealed"])("a %s actor's changed face never reaches observers", trait => {
  const f = fixture(); runAppearanceEmitter(f.world); Traits.active[f.actor] = JSON.stringify([trait]);
  Appearance.expression[f.actor] = "frowning"; f.tick();
  broadcastExpressionChange(f.world, f.actor, "attentive", "frowning"); broadcastAppearanceChange(f.world, f.actor);
  expect(f.cues()).toEqual([]);
});

test("same-room containment is not sight through an opaque closed cabinet", () => {
  const f = fixture();
  const cabinet = createObjectEntity(f.world, { name: "Cabinet", roomId: f.room }); addComponent(f.world, cabinet, Container);
  ObjectState.current[cabinet] = "closed"; setLocatedIn(f.world, f.actor, cabinet);
  runAppearanceEmitter(f.world); Appearance.expression[f.actor] = "downcast"; f.tick();
  expect(f.cues()).toEqual([]); broadcastAppearanceChange(f.world, f.actor); expect(f.cues()).toEqual([]);
});

test("periodic refresh and stats use simulation time, regardless of wall-clock jumps", () => {
  const f = fixture(); runAppearanceEmitter(f.world);
  jest.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
  runAppearanceEmitter(f.world); expect(f.cues()).toEqual([]);
  f.tick(29_999); expect(f.cues()).toEqual([]);
  expect(getAppearanceEmitterStats(f.world).avgTimeSinceLastBroadcast).toBe(29_999);
  f.tick(1); expect(f.cues()).toHaveLength(1); expect(f.cues()[0].content).toContain("You notice Ada:");
  expect(getAppearanceEmitterStats(f.world).avgTimeSinceLastBroadcast).toBe(0);
});

test("worlds, actor identity replacement and explicit cleanup have independent baselines", () => {
  const a = fixture(), b = fixture(256); runAppearanceEmitter(a.world); runAppearanceEmitter(b.world);
  expect(a.actor).not.toBe(b.actor);
  Appearance.expression[a.actor] = "frowning"; a.tick(); b.tick(); expect(a.cues()).toHaveLength(1); expect(b.cues()).toEqual([]);
  WorkingMemoryIdentity.id[a.actor] = "new-actor-lifetime"; Appearance.expression[a.actor] = "tearful"; a.tick();
  expect(a.cues()).toHaveLength(1); // the new life did not transition from the previous actor's frown
  Appearance.expression[a.actor] = "smiling"; a.tick(); expect(a.cues()).toHaveLength(2);
  cleanupAppearanceState(a.world, a.actor); expect(getAppearanceEmitterStats(a.world).trackedEntities).toBe(1);
  expect(getAppearanceEmitterStats(b.world).trackedEntities).toBe(2);
  cleanupAppearanceState(b.actor); expect(getAppearanceEmitterStats(b.world).trackedEntities).toBe(1);
});

test("world caches remain separate even when their native actors reuse the same EID", () => {
  const a = fixture(), b = fixture(); expect(a.actor).toBe(b.actor);
  // Simulate each world's own current native snapshot while sharing sparse
  // component indices. A global EID cache would mistake these for transitions.
  Appearance.expression[a.actor] = "attentive"; runAppearanceEmitter(a.world);
  Appearance.expression[b.actor] = "frowning"; runAppearanceEmitter(b.world);
  Appearance.expression[a.actor] = "attentive"; a.tick(); expect(a.cues()).toEqual([]);
  Appearance.expression[b.actor] = "frowning"; b.tick(); expect(b.cues()).toEqual([]);
  cleanupAppearanceState(a.world, a.actor);
  expect(getAppearanceEmitterStats(a.world).trackedEntities).toBe(1);
  expect(getAppearanceEmitterStats(b.world).trackedEntities).toBe(2);
});

test("removal, world stop and a new committed source epoch do not emit stale transitions", () => {
  const f = fixture(); startCommittedEvents(f.world); runAppearanceEmitter(f.world);
  removeComponent(f.world, f.actor, Appearance); f.tick(); expect(getAppearanceEmitterStats(f.world).trackedEntities).toBe(1);
  configureCharacterAppearance(f.world, f.actor, { expression: "tearful" }); f.tick(); expect(f.cues()).toEqual([]);
  stopCommittedEvents(f.world); Appearance.expression[f.actor] = "smiling"; f.tick();
  broadcastAppearanceChange(f.world, f.actor); expect(f.cues()).toEqual([]); expect(getAppearanceEmitterStats(f.world).trackedEntities).toBe(0);
  startCommittedEvents(f.world); f.tick(); expect(f.cues()).toEqual([]);
  Appearance.expression[f.actor] = "neutral"; f.tick(); expect(f.cues()).toHaveLength(1);
});

test("held-item observations use actual native hand equipment, never inventory caches", () => {
  const f = fixture(), item = createObjectEntity(f.world, { name: "Cup", roomId: f.room });
  setLocatedIn(f.world, item, f.actor); Appearance.visiblyHolding[f.actor] = "PRIVATE stale inventory cache";
  runAppearanceEmitter(f.world); f.tick(); expect(f.cues()).toEqual([]);
  addComponent(f.world, item, EquipSlot); EquipSlot.slot[item] = "mainHand"; EquipSlot.equippedBy[item] = f.actor;
  f.tick(); expect(f.cues().at(-1)?.content).toBe("Ada is now holding Cup.");
  expect(JSON.stringify(f.cues())).not.toContain("PRIVATE");
  setLocatedIn(f.world, item, f.room); f.tick(); expect(f.cues().at(-1)?.content).toBe("Ada's hands no longer visibly hold an item.");
});

test("forced expression notification verifies actual state and does not duplicate the next tick", () => {
  const f = fixture(); runAppearanceEmitter(f.world);
  broadcastExpressionChange(f.world, f.actor, "attentive", "tearful"); expect(f.cues()).toEqual([]);
  Appearance.expression[f.actor] = "tearful"; broadcastExpressionChange(f.world, f.actor, "attentive", "tearful");
  expect(f.cues()).toHaveLength(1); f.tick(); expect(f.cues()).toHaveLength(1);
});

test("observer callbacks cannot redirect a cue into a replacement lifetime or stopped world", () => {
  const f = fixture(), later = f.person("Later observer"); runAppearanceEmitter(f.world);
  registerAgentWorldCapabilities(f.world, f.observer, { context: () => "", ready: () => true, busy: () => false, execute: () => false,
    onPerception: () => { WorkingMemoryIdentity.id[later] = "replacement-recipient"; stopCommittedEvents(f.world); } });
  Appearance.expression[f.actor] = "frowning"; f.tick();
  expect(f.cues()).toHaveLength(1); expect(f.cues(later)).toEqual([]); expect(peekPendingStimuli()).toEqual([]);
});

test("native appearance delivery does not enumerate unrelated room surfaces", () => {
  const f = fixture(), unrelated = createObjectEntity(f.world, { name: "Unrelated cupboard", roomId: f.room, traits: [] });
  runAppearanceEmitter(f.world);
  const descriptor = Object.getOwnPropertyDescriptor(Traits.active, unrelated)!;
  let reads = 0;
  Object.defineProperty(Traits.active, unrelated, { configurable: true, enumerable: descriptor.enumerable,
    get: () => { reads++; return descriptor.value; } });
  try {
    Appearance.expression[f.actor] = "frowning"; f.tick();
    expect(f.cues()).toHaveLength(1); expect(reads).toBe(0);
  } finally { Object.defineProperty(Traits.active, unrelated, descriptor); }
});

test.each(["concealed", "remote", "blind"])("custom visibility changes to %s still revoke appearance delivery", change => {
  const f = fixture(); runAppearanceEmitter(f.world);
  const visibleEntities = jest.fn(() => {
    if (change === "concealed") Traits.active[f.actor] = '["hidden"]';
    if (change === "remote") setLocatedIn(f.world, f.actor, f.remote);
    if (change === "blind") Traits.active[f.observer] = '["blind"]';
    return [f.actor];
  });
  const unregister = registerAgentWorldCapabilities(f.world, f.observer, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false, visibleEntities,
  });
  try {
    Appearance.expression[f.actor] = "frowning"; f.tick();
    expect(visibleEntities).toHaveBeenCalled(); expect(f.cues()).toEqual([]);
  } finally { unregister(); }
});
