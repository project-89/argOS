import { jest } from "@jest/globals";
import { addComponent, addEntity, hasComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, Description, Name, ObjectState, PhysicalObject, StimulusSource, Surface, Traits, WorkingMemoryIdentity } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { createSystemRegistry } from "../../ecs/dynamic-systems";
import { buildAgentContext, getAgentPerceptions } from "../agent-mind";
import { runCognitionCycle } from "../cognition-system";
import { formatStimuliForPrompt, generateStimuliForAgent, getAgentSensoryFingerprint, getNotableObjectStates } from "../sensory-system";
import { registerAgentWorldCapabilities } from "../world-capabilities";
import { drainPendingStimuli } from "../stimulus-queue";

function fixture(traits: string[] = []) {
  const world = createArgosWorld("Sensory visibility"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Study" });
  const remote = createRoomEntity(world, { name: "Garden" });
  const person = (name: string, ownTraits: string[] = [], parent = room) => {
    const eid = createAgentEntity(world, { name, role: "resident", systemPrompt: "My own identity", roomId: parent });
    addComponent(world, eid, Traits); Traits.active[eid] = JSON.stringify(ownTraits); return eid;
  };
  const actor = person("Mara", traits);
  const object = (name: string, parent = room, ownTraits: string[] = [], state = "normal", desc = "") => {
    const eid = addEntity(world);
    for (const component of [Name, Description, ObjectState, Traits, PhysicalObject]) addComponent(world, eid, component);
    Name.value[eid] = name; Description.value[eid] = desc; ObjectState.current[eid] = state;
    Traits.active[eid] = JSON.stringify(ownTraits); setLocatedIn(world, eid, parent); return eid;
  };
  const box = (name: string, parent = room, state = "open", ownTraits: string[] = []) => {
    const eid = object(name, parent, ownTraits, state); addComponent(world, eid, Container); return eid;
  };
  const candidates: number[] = [];
  const cleanup = registerAgentWorldCapabilities(world, actor, {
    context: () => "", ready: () => true, busy: () => false, execute: () => false,
    visibleEntities: () => candidates,
    affordances: () => [{ name: "inspect", requires: [] }],
  });
  return { world, actor, room, remote, person, object, box, candidates, cleanup };
}

beforeEach(() => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No model calls in sensory visibility tests"));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); jest.useRealTimers(); drainPendingStimuli();
});

test.each(["hidden", "invisible", "concealed"])("%s surfaces cannot re-enter sight through intuition, affordances or notable state", trait => {
  const f = fixture();
  try {
    const unseen = f.person("PRIVATE_PERSON", [trait, "hostile"]); Description.value[unseen] = "PRIVATE_PERSON_DESCRIPTION";
    f.object("PRIVATE_OBJECT", f.room, [trait, "locked", "dangerous"], "PRIVATE_STATE", "PRIVATE_DESCRIPTION");
    f.person("Visible stranger", ["hostile"]);
    f.object("Visible locker", f.room, ["locked"], "locked", "A brass cabinet.");
    const stimuli = generateStimuliForAgent(f.world, f.actor, []);
    expect(JSON.stringify(stimuli)).not.toContain("PRIVATE_");
    expect(stimuli.find(s => s.type === "people")?.content).toContain("Visible stranger");
    expect(stimuli.find(s => s.type === "danger")?.content).toContain("Visible stranger");
    expect(stimuli.find(s => s.type === "affordances")?.content).toMatch(/Visible locker: [^;]*inspect/);
    expect(getNotableObjectStates(f.world, f.actor)).toEqual(["Visible locker: needs unlocking"]);
  } finally { f.cleanup(); }
});

test("native open-container peeks retain visible nested state without exposing hidden leaves, sealed ancestors or foreign inventory", () => {
  const f = fixture();
  try {
    const open = f.box("Open cabinet"), nested = f.box("Open drawer", open);
    f.object("Visible key", open, ["takeable"], "polished", "Its brass teeth catch the light.");
    f.object("Visible nested dial", nested, ["locked"], "locked", "A numbered dial.");
    f.object("PRIVATE_HIDDEN_CHILD", open, ["hidden"]);
    const hiddenBox = f.box("PRIVATE_ANCESTOR", f.room, "open", ["hidden"]);
    f.object("PRIVATE_ANCESTOR_CHILD", hiddenBox);
    const closed = f.box("Closed cabinet", f.room, "closed", ["open"]);
    f.object("PRIVATE_CLOSED_CHILD", closed);
    const sealed = f.box("Locked cabinet", open, "locked", ["open"]);
    f.object("PRIVATE_LOCKED_CHILD", sealed);
    const visiblePerson = f.person("Ivo"); f.object("PRIVATE_FOREIGN_POCKET", visiblePerson);
    const visual = generateStimuliForAgent(f.world, f.actor, []).filter(s => s.modality === "visual").map(s => s.content).join("\n");
    expect(visual).not.toContain("PRIVATE_");
    expect(visual).toContain("Visible key [polished] (inside Open cabinet): Its brass teeth catch the light.");
    expect(visual).toContain("Visible nested dial [locked] (inside Open drawer)");
    expect(getNotableObjectStates(f.world, f.actor)).toContain("Visible nested dial: needs unlocking");
  } finally { f.cleanup(); }
});

test("typed exposed supports describe visible objects on a table, while a closed container stays opaque", () => {
  const f = fixture();
  try {
    const table = f.object("Table"); addComponent(f.world, table, Surface);
    f.object("Cup", table, [], "full", "Warm tea.");
    const cabinet = f.box("Cabinet", f.room, "closed"); addComponent(f.world, cabinet, Surface);
    f.object("PRIVATE_CABINET_CHILD", cabinet);
    const text = JSON.stringify(generateStimuliForAgent(f.world, f.actor, []));
    expect(text).toContain("Cup [full] (on Table): Warm tea."); expect(text).not.toContain("PRIVATE_");
  } finally { f.cleanup(); }
});

test("package candidates cannot bypass concealed, remote, closed, foreign-owned or cyclic ancestry", () => {
  const f = fixture();
  try {
    const closed = f.box("Closed chest", f.room, "closed");
    const foreign = f.person("Ivo");
    const cycleA = f.box("PRIVATE_CYCLE_A"), cycleB = f.box("PRIVATE_CYCLE_B", cycleA);
    setLocatedIn(f.world, cycleA, cycleB);
    f.candidates.push(
      f.object("PRIVATE_HIDDEN", f.room, ["hidden"]), f.object("PRIVATE_REMOTE", f.remote),
      f.object("PRIVATE_CLOSED", closed), f.object("PRIVATE_POCKET", foreign), cycleA, cycleB,
    );
    expect(JSON.stringify(generateStimuliForAgent(f.world, f.actor, []))).not.toContain("PRIVATE_");
  } finally { f.cleanup(); }
});

test("blind own touch, hidden audible emissions and smell remain independent of visual admission", () => {
  const f = fixture(["blind"]);
  try {
    f.object("Known satchel", f.actor, ["hidden", "locked"], "PRIVATE_HELD_STATE", "PRIVATE_HELD_DESCRIPTION");
    f.object("PRIVATE_ROOM_LOCK", f.room, ["locked"], "locked");
    const alarm = f.object("Recognizable alarm", f.room, ["hidden"], "PRIVATE_ALARM_STATE", "PRIVATE_ALARM_DESCRIPTION");
    addComponent(f.world, alarm, StimulusSource); StimulusSource.stimulusType[alarm] = "sound";
    StimulusSource.template[alarm] = "The familiar alarm buzzes.";
    f.object("smoldering wood", f.room, ["hidden", "burning"]);
    const stimuli = generateStimuliForAgent(f.world, f.actor, []);
    const text = formatStimuliForPrompt(stimuli, f.actor, f.world);
    expect(stimuli.some(s => s.modality === "visual")).toBe(false);
    expect(stimuli.some(s => ["affordances", "danger", "awareness"].includes(s.type))).toBe(false);
    expect(text).toContain("Possessions: Known satchel"); expect(text).toContain("The familiar alarm buzzes.");
    expect(text).toContain("You smell smoke from smoldering wood."); expect(text).not.toContain("PRIVATE_");
    Traits.active[f.actor] = JSON.stringify(["blind", "deaf"]);
    const deaf = generateStimuliForAgent(f.world, f.actor, []);
    expect(deaf.some(s => s.modality === "auditory")).toBe(false);
    expect(deaf.some(s => s.modality === "olfactory")).toBe(true);
  } finally { f.cleanup(); }
});

test("a sighted actor's concealed own item is known as a possession, not visual state or danger", () => {
  const f = fixture();
  try {
    f.object("Known pouch", f.actor, ["concealed", "dangerous", "locked"], "PRIVATE_STATE", "PRIVATE_DESCRIPTION");
    const stimuli = generateStimuliForAgent(f.world, f.actor, []);
    expect(JSON.stringify(stimuli)).not.toMatch(/PRIVATE_|Known pouch/);
    expect(formatStimuliForPrompt(stimuli, f.actor, f.world)).toContain("Possessions: Known pouch");
  } finally { f.cleanup(); }
});

test("hidden and sealed changes do not alter the sensory signature; opening and actual visible changes do", () => {
  jest.useFakeTimers(); jest.setSystemTime(10_000);
  const f = fixture();
  try {
    const box = f.box("Cabinet", f.room, "closed");
    const sealed = f.object("PRIVATE_SEALED", box), hidden = f.object("PRIVATE_HIDDEN", f.room, ["hidden"]);
    const before = getAgentSensoryFingerprint(f.world, f.actor);
    for (const eid of [sealed, hidden]) {
      Name.value[eid] += "_CHANGED"; Description.value[eid] = "PRIVATE_NEW_DESCRIPTION"; ObjectState.current[eid] = "PRIVATE_NEW_STATE";
      Traits.active[eid] = JSON.stringify([...(eid === hidden ? ["hidden"] : []), "dangerous", "locked"]);
    }
    jest.setSystemTime(11_000);
    expect(getAgentSensoryFingerprint(f.world, f.actor)).toBe(before);
    ObjectState.current[box] = "open";
    const opened = getAgentSensoryFingerprint(f.world, f.actor);
    expect(opened).not.toBe(before); expect(opened).toContain("PRIVATE_SEALED_CHANGED"); expect(opened).not.toContain("PRIVATE_HIDDEN");
    Description.value[sealed] = "Now visible alteration";
    expect(getAgentSensoryFingerprint(f.world, f.actor)).not.toBe(opened);
  } finally { f.cleanup(); }
});

test("private mutation does not invalidate cached environmental prose", () => {
  jest.useFakeTimers(); jest.setSystemTime(10_000);
  const f = fixture();
  const visible = f.object("Visible lamp", f.room, [], "off", "Unchanging visible surface");
  const hidden = f.object("PRIVATE_OBJECT", f.room, ["hidden"]);
  const sealed = f.object("PRIVATE_INNER", f.box("Closed box", f.room, "closed"));
  const slot = String(visible), original = Object.getOwnPropertyDescriptor(Description.value, slot)!;
  let reads = 0;
  Object.defineProperty(Description.value, slot, { configurable: true, enumerable: true, get: () => { reads++; return original.value; } });
  try {
    generateStimuliForAgent(f.world, f.actor, []); reads = 0;
    generateStimuliForAgent(f.world, f.actor, []); const hitReads = reads; reads = 0;
    ObjectState.current[hidden] = "changed"; Description.value[hidden] = "PRIVATE_CHANGED"; Name.value[sealed] = "PRIVATE_RENAMED";
    generateStimuliForAgent(f.world, f.actor, []);
    expect(reads).toBe(hitReads); reads = 0;
    ObjectState.current[visible] = "on";
    generateStimuliForAgent(f.world, f.actor, []);
    expect(reads).toBeGreaterThan(hitReads);
  } finally { Object.defineProperty(Description.value, slot, original); f.cleanup(); }
});

test("closing or concealing a previously visible surface removes it from the refreshed current sensory frame", () => {
  const f = fixture();
  try {
    const box = f.box("Cabinet"), child = f.object("Once visible dial", box, ["locked"], "locked");
    expect(JSON.stringify(generateStimuliForAgent(f.world, f.actor, []))).toContain("Once visible dial");
    ObjectState.current[box] = "closed"; Traits.active[box] = JSON.stringify(["open"]);
    expect(JSON.stringify(generateStimuliForAgent(f.world, f.actor, []))).not.toContain("Once visible dial");
    ObjectState.current[box] = "open";
    expect(JSON.stringify(generateStimuliForAgent(f.world, f.actor, []))).toContain("Once visible dial");
    Traits.active[child] = JSON.stringify(["concealed", "locked"]);
    expect(JSON.stringify(generateStimuliForAgent(f.world, f.actor, []))).not.toContain("Once visible dial");
  } finally { f.cleanup(); }
});

test("hidden audible change wakes hearing but not deafness, while private visual detail affects neither", () => {
  const f = fixture(["blind"]);
  try {
    const alarm = f.object("Recognizable alarm", f.room, ["hidden"]);
    addComponent(f.world, alarm, StimulusSource); StimulusSource.stimulusType[alarm] = "sound";
    StimulusSource.template[alarm] = "A soft buzz.";
    const heard = getAgentSensoryFingerprint(f.world, f.actor);
    Description.value[alarm] = "PRIVATE_CHANGED"; ObjectState.current[alarm] = "PRIVATE_CHANGED";
    expect(getAgentSensoryFingerprint(f.world, f.actor)).toBe(heard);
    StimulusSource.template[alarm] = "A loud buzz.";
    expect(getAgentSensoryFingerprint(f.world, f.actor)).not.toBe(heard);
    Traits.active[f.actor] = JSON.stringify(["blind", "deaf"]);
    const deaf = getAgentSensoryFingerprint(f.world, f.actor);
    StimulusSource.template[alarm] = "An urgent buzz.";
    expect(getAgentSensoryFingerprint(f.world, f.actor)).toBe(deaf);
  } finally { f.cleanup(); }
});

test("actual offline cognition stores only admitted senses and the full context has no alternate hidden-name channel", async () => {
  const f = fixture();
  try {
    const hiddenPerson = f.person("PRIVATE_PERSON", ["hidden", "hostile"]); Description.value[hiddenPerson] = "PRIVATE_PERSON_DESCRIPTION";
    f.object("PRIVATE_OBJECT", f.room, ["invisible", "locked"], "PRIVATE_STATE", "PRIVATE_DESCRIPTION");
    const open = f.box("Open cabinet"); f.object("Visible key", open, [], "polished", "Visible brass teeth");
    f.object("PRIVATE_OPEN_CHILD", open, ["concealed"]);
    const closed = f.box("Closed cabinet", f.room, "closed", ["open"]); f.object("PRIVATE_CLOSED_CHILD", closed);
    const ivo = f.person("Visible Ivo"); f.object("PRIVATE_FOREIGN_INVENTORY", ivo);
    const message = addEntity(f.world); addComponent(f.world, message, Name); Name.value[message] = "PRIVATE_UNREAD_MESSAGE";
    setLocatedIn(f.world, message, open); f.candidates.push(message);
    expect(getAgentPerceptions(f.world, f.actor)).toHaveLength(0);
    await runCognitionCycle(f.world, createSystemRegistry(), { tick: 1, agentEids: [f.actor], enablePlanning: false });
    expect(getAgentPerceptions(f.world, f.actor).length).toBeGreaterThan(0);
    const context = buildAgentContext(f.world, f.actor);
    expect(context).toContain("SIGHT:"); expect(context).toContain("Visible brass teeth"); expect(context).toContain("Visible Ivo");
    expect(context).not.toContain("PRIVATE_");
    expect(hasComponent(f.world, message, WorkingMemoryIdentity)).toBe(false);
  } finally { f.cleanup(); }
});

test.each([{ traits: [] }, { traits: ["blind"] }])("the full cognition prompt preserves known possession without observing its concealed fields (%j)", async ({ traits }) => {
  const f = fixture(traits);
  try {
    f.object("Known pouch", f.actor, ["hidden", "locked"], "PRIVATE_POUCH_STATE", "PRIVATE_POUCH_DESCRIPTION");
    await runCognitionCycle(f.world, createSystemRegistry(), { tick: 2, agentEids: [f.actor], enablePlanning: false });
    const context = buildAgentContext(f.world, f.actor);
    expect(context).toContain("Known pouch"); expect(context).not.toContain("PRIVATE_");
  } finally { f.cleanup(); }
});
