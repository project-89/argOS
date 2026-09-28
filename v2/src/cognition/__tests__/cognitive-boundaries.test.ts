import "dotenv/config";
import { jest } from "@jest/globals";
import { addComponent, addEntity, removeComponent } from "bitecs";
import { createArgosWorld, type World } from "../../ecs/world";
import { Agent, Description, Mind, Name, ObjectState, Perception, PhysicalObject, Room, StimulusSource, Traits } from "../../ecs/components";
import { HasPerception } from "../../ecs/relations";
import { setLocatedIn } from "../../ecs/location";
import { worldSchema } from "../../world/schema";
import { selectFailureRecoveryAction } from "../failure-recovery";
import { formatStimuliForPrompt, generateStimuliForAgent, getRecentSuccesses, recordSuccessfulAction } from "../sensory-system";
import { addMemory, getRelevantMemories } from "../knowledge-graph";
import { buildAgentContext } from "../agent-mind";

function entity(world: World, name: string, room?: number): number {
  const eid = addEntity(world);
  addComponent(world, eid, Name);
  Name.value[eid] = name;
  if (room !== undefined) setLocatedIn(world, eid, room);
  return eid;
}

function fixture() {
  const world = createArgosWorld("Cognitive boundaries");
  const room = entity(world, "Office");
  addComponent(world, room, Room);
  Room.ambience[room] = "Quiet.";
  const actor = entity(world, "Morgan", room);
  addComponent(world, actor, Agent);
  addComponent(world, actor, Mind);
  Agent.active[actor] = 1;
  Mind.arousal[actor] = 0.3;
  return { world, room, actor };
}

function traits(world: World, eid: number, values: string[]) {
  addComponent(world, eid, Traits);
  Traits.active[eid] = JSON.stringify(values);
}

function perception(world: World, actor: number, type: string, content: string, timestamp = Date.now()) {
  const eid = addEntity(world);
  addComponent(world, eid, Perception);
  addComponent(world, actor, HasPerception(eid));
  Perception.type[eid] = type;
  Perception.source[eid] = "interaction";
  Perception.content[eid] = content;
  Perception.timestamp[eid] = timestamp;
  return eid;
}

describe("cognitive evidence boundaries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-04T12:00:00Z"));
  });
  afterEach(() => {
    worldSchema.removeAffordance("boundary_unlock_test");
    worldSchema.removeAffordance("boundary_new_action_test");
    jest.useRealTimers();
  });

  test("danger sense does not identify an unseen actor in a different room", () => {
    const { world, room, actor } = fixture();
    const basement = entity(world, "Basement");
    addComponent(world, basement, Room);
    const stranger = entity(world, "Hidden stranger", basement);
    addComponent(world, stranger, Agent);
    traits(world, stranger, ["hostile"]);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("Hidden stranger");
    setLocatedIn(world, stranger, room);
    const danger = generateStimuliForAgent(world, actor, []).find(s => s.type === "danger");
    expect(danger?.content).toBe("You sense danger from: Hidden stranger");
  });

  test("new sensory impairments take effect without waiting for the cache TTL", () => {
    const { world, room, actor } = fixture();
    const phone = entity(world, "Phone", room);
    addComponent(world, phone, StimulusSource);
    StimulusSource.stimulusType[phone] = "sound";
    StimulusSource.template[phone] = "Your phone buzzes.";
    expect(generateStimuliForAgent(world, actor, []).some(s => s.modality === "auditory")).toBe(true);
    traits(world, actor, ["deaf", "blind"]);
    const impaired = generateStimuliForAgent(world, actor, []);
    expect(impaired.some(s => s.modality === "visual" || s.modality === "auditory")).toBe(false);
    Traits.active[actor] = "[]";
    expect(generateStimuliForAgent(world, actor, []).some(s => s.modality === "auditory")).toBe(true);
    Traits.active[actor] = '["deaf"]';
    removeComponent(world, actor, Traits);
    expect(generateStimuliForAgent(world, actor, []).some(s => s.modality === "auditory")).toBe(true);
  });

  test("changed visible descriptions and phone sounds are immediately fresh", () => {
    const { world, room, actor } = fixture();
    const phone = entity(world, "Phone", room);
    addComponent(world, phone, Description);
    addComponent(world, phone, StimulusSource);
    Description.value[phone] = "The screen is dark.";
    StimulusSource.stimulusType[phone] = "sound";
    StimulusSource.template[phone] = "A soft hum.";
    generateStimuliForAgent(world, actor, []);
    Description.value[phone] = "The notification light flashes.";
    StimulusSource.template[phone] = "Your phone vibrates against the desk.";
    const updated = generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n");
    expect(updated).toContain("notification light flashes");
    expect(updated).toContain("phone vibrates against the desk");
    expect(updated).not.toContain("screen is dark");
    expect(updated).not.toContain("soft hum");
  });

  test("open-container contents refresh while closed-container contents remain private", () => {
    const { world, room, actor } = fixture();
    const drawer = entity(world, "Drawer", room);
    addComponent(world, drawer, ObjectState);
    ObjectState.current[drawer] = "open";
    const key = entity(world, "Brass key", drawer);
    addComponent(world, key, PhysicalObject);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).toContain("Brass key");
    setLocatedIn(world, key, undefined);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("Brass key");
    ObjectState.current[drawer] = "closed";
    const envelope = entity(world, "Unseen envelope", drawer);
    addComponent(world, envelope, PhysicalObject);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("Unseen envelope");
  });

  test("held-tool capabilities update even when visible room contents are unchanged", () => {
    const { world, room, actor } = fixture();
    const door = entity(world, "Door", room);
    traits(world, door, ["boundary_locked"]);
    worldSchema.defineAffordance({
      name: "boundary_unlock_test", requires: ["boundary_locked"], actorRequires: ["hasBoundaryKey"],
      descriptionTemplate: "{actor.name} unlocks the door.", effects: [],
    });
    const key = entity(world, "Key", actor);
    traits(world, key, []);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("boundary_unlock_test");
    Traits.active[key] = JSON.stringify(["hasBoundaryKey"]);
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).toContain("boundary_unlock_test");
    Traits.active[key] = "[]";
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("boundary_unlock_test");
  });

  test("neither room perception nor inventory listing reveals contents of a closed held bag", () => {
    const { world, actor } = fixture();
    const bag = entity(world, "Satchel", actor);
    addComponent(world, bag, ObjectState);
    ObjectState.current[bag] = "closed";
    entity(world, "Private letter with a secret code", bag);
    const formatted = formatStimuliForPrompt(generateStimuliForAgent(world, actor, []), actor, world);
    expect(formatted).toContain("Satchel");
    expect(formatted).not.toContain("Private letter");
    expect(formatted).not.toContain("secret code");
  });

  test("a newly installed capability appears without needing a room change", () => {
    const { world, room, actor } = fixture();
    const device = entity(world, "Device", room);
    traits(world, device, ["boundary_device"]);
    generateStimuliForAgent(world, actor, []);
    worldSchema.defineAffordance({ name: "boundary_new_action_test", requires: ["boundary_device"], descriptionTemplate: "Test.", effects: [] });
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).toContain("boundary_new_action_test");
    worldSchema.removeAffordance("boundary_new_action_test");
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("boundary_new_action_test");
  });

  test("consumers cannot corrupt subsequent cached observations", () => {
    const { world, actor } = fixture();
    const first = generateStimuliForAgent(world, actor, []);
    first.find(s => s.type === "environment")!.content = "Injected nonexistent location";
    expect(generateStimuliForAgent(world, actor, []).map(s => s.content).join("\n")).not.toContain("Injected nonexistent location");
  });

  test("successful-action history cannot cross worlds or actors", () => {
    const { world, actor } = fixture();
    const otherWorld = createArgosWorld("Other world");
    recordSuccessfulAction(world, actor, "unlocked the private vault");
    expect(getRecentSuccesses(world, actor)).toEqual(["unlocked the private vault"]);
    expect(getRecentSuccesses(otherWorld, actor)).toEqual([]);
    expect(getRecentSuccesses(world, actor + 1)).toEqual([]);
    const history = getRecentSuccesses(world, actor);
    history.push("fabricated success");
    expect(getRecentSuccesses(world, actor)).not.toContain("fabricated success");
    recordSuccessfulAction(actor, "legacy history from another session");
    expect(formatStimuliForPrompt([], actor, world)).not.toContain("legacy history");
  });

  test("re-emitting the same failure does not restart its failed-tactic ladder", () => {
    const { world, room, actor } = fixture();
    entity(world, "Keycard", room);
    const content = 'FAILED: Cannot unlock. PICK UP "Keycard" first.';
    perception(world, actor, "action_failed", content);
    expect(selectFailureRecoveryAction(world, actor)).toEqual({ type: "pickup", target: "Keycard" });
    jest.advanceTimersByTime(1000);
    perception(world, actor, "action_failed", content);
    expect(selectFailureRecoveryAction(world, actor)?.type).not.toBe("pickup");
    jest.advanceTimersByTime(1000);
    perception(world, actor, "action_failed", content);
    expect(selectFailureRecoveryAction(world, actor)?.type).not.toBe("pickup");
  });

  test("recovery does not discover the room of an unobserved remote object", () => {
    const { world, room, actor } = fixture();
    const hiddenRoom = entity(world, "Secret attic");
    addComponent(world, hiddenRoom, Room);
    entity(world, "Keycard", hiddenRoom);
    entity(world, "Desk", room);
    perception(world, actor, "action_failed", 'FAILED: Cannot find "Keycard" here.');
    expect(selectFailureRecoveryAction(world, actor)).toEqual({ type: "observe", target: "Desk" });
  });

  test("new successful evidence ends recovery and permits a later distinct attempt", () => {
    const { world, room, actor } = fixture();
    entity(world, "Keycard", room);
    const content = 'FAILED: Cannot unlock. PICK UP "Keycard" first.';
    perception(world, actor, "action_failed", content);
    expect(selectFailureRecoveryAction(world, actor)?.type).toBe("pickup");
    jest.advanceTimersByTime(1000);
    perception(world, actor, "action_result", "SUCCESS: The obstacle was repaired.");
    expect(selectFailureRecoveryAction(world, actor)).toBeNull();
    jest.advanceTimersByTime(1000);
    perception(world, actor, "action_failed", content);
    expect(selectFailureRecoveryAction(world, actor)?.type).toBe("pickup");
  });

  test("actor A's failure does not cause actor B to perform recovery", () => {
    const { world, room, actor } = fixture();
    const other = entity(world, "Riley", room);
    addComponent(world, other, Agent);
    Agent.active[other] = 1;
    perception(world, actor, "action_failed", 'FAILED: PICK UP "Keycard" first.');
    expect(selectFailureRecoveryAction(world, other)).toBeNull();
  });

  test("native context keeps old memories distinct from current conflicting observations and private memories", () => {
    const { world, room, actor } = fixture();
    const other = entity(world, "Riley", room);
    addComponent(world, other, Agent);
    const oldMemory = addMemory(world, actor, {
      type: "episodic", content: "My phone was on the bedroom desk.", importance: 0.9,
      emotionalValence: 0, timestamp: Date.now() - 60_000,
    });
    addMemory(world, other, {
      type: "semantic", content: "Riley's private password is moon-key.", importance: 0.9,
      emotionalValence: 0, timestamp: Date.now(),
    });
    perception(world, actor, "observation", "The bedroom desk is empty. My phone is now on the landing floor.");
    const context = buildAgentContext(world, actor);
    expect(context).toContain("My phone was on the bedroom desk.");
    expect(context).toContain("My phone is now on the landing floor.");
    expect(context).not.toContain("moon-key");
    expect(context).toContain("LONG-TERM KNOWLEDGE:");
    expect(context).toContain("RECENT PERCEPTIONS:");
    const newMemory = addMemory(world, actor, {
      type: "episodic", content: "My phone is now on the landing floor.", importance: 0.9,
      emotionalValence: 0, timestamp: Date.now(),
    });
    expect(getRelevantMemories(world, actor, "phone", 2)).toEqual([newMemory, oldMemory]);
  });
});
