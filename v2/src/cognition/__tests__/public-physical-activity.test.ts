import { jest } from "@jest/globals";
import { addComponent } from "bitecs";
import { createArgosWorld } from "../../ecs/world";
import { createAgentEntity, createObjectEntity, createRoomEntity, initializePrefabs } from "../../ecs/prefabs";
import { Container, EquipSlot, Mind, ObjectState, Traits } from "../../ecs/components";
import { setLocatedIn } from "../../ecs/location";
import { getObservedPublicActivity, registerAgentWorldCapabilities, type AgentWorldCapabilities } from "../world-capabilities";
import { generateStimuliForAgent, getAgentSensoryFingerprint, formatStimuliForPrompt } from "../sensory-system";
import { addPerception, buildAgentContext } from "../agent-mind";

const removers: Array<() => void> = [];
type Activity = ReturnType<NonNullable<AgentWorldCapabilities["publicActivity"]>>;
beforeEach(() => { jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Activity projections never call models")); });
afterEach(() => { for (const remove of removers.splice(0)) remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
function fixture() {
  const world = createArgosWorld("Public activity"); world.meta.aiEnabled = false; initializePrefabs(world);
  const room = createRoomEntity(world, { name: "Machine hall" }), remote = createRoomEntity(world, { name: "Unseen vault" });
  const doorway = createRoomEntity(world, { name: "Courtyard" });
  const make = (name: string, roomId = room) => createAgentEntity(world, { name, role: "resident", systemPrompt: "Private life", roomId });
  const observer = make("Observer"), actor = make("Worker"), distant = make("Distant", remote);
  const lever = createObjectEntity(world, { name: "Hand lever", roomId: room, portable: false });
  const secret = createObjectEntity(world, { name: "Secret apparatus", roomId: remote, portable: false });
  ObjectState.current[actor] = "idle"; Mind.mode[actor] = "private mental mode"; Mind.focus[actor] = "private thought sentinel";
  let activity: Activity = { kind: "holding", targetEid: lever };
  const hook = jest.fn(() => activity);
  const base = { context: () => "", ready: () => true, busy: () => false, execute: () => true };
  removers.push(registerAgentWorldCapabilities(world, actor, { ...base, publicActivity: hook }));
  const observerCapabilities: AgentWorldCapabilities = { ...base, movementTargets: () => [doorway] };
  removers.push(registerAgentWorldCapabilities(world, observer, observerCapabilities));
  const people = (who = observer) => generateStimuliForAgent(world, who, []).filter(s => s.type === "people").map(s => s.content).join("\n");
  return { world, room, remote, doorway, observer, actor, distant, lever, secret, hook, people, observerCapabilities,
    setActivity: (next: Activity) => { activity = next; } };
}

test("actual public activity outranks idle without exposing private mental state or arguments", () => {
  const f = fixture();
  f.setActivity({ kind: "operating", targetEid: f.lever, content: "hidden-code-9137", thought: "private intention" } as Activity);
  expect(f.people()).toContain("Worker (operating Hand lever)");
  for (const hidden of ["Worker (idle)", "private mental mode", "private thought sentinel", "hidden-code-9137", "private intention"])
    expect(f.people()).not.toContain(hidden);
});

test("a public operation transition invalidates the cached perception immediately, not after its TTL", () => {
  jest.spyOn(Date, "now").mockReturnValue(100_000);
  const f = fixture(), initial = getAgentSensoryFingerprint(f.world, f.observer);
  expect(f.people()).toContain("holding Hand lever");
  f.setActivity({ kind: "operating", targetEid: f.lever });
  expect(f.people()).toContain("operating Hand lever"); expect(f.people()).not.toContain("holding Hand lever");
  expect(getAgentSensoryFingerprint(f.world, f.observer)).not.toBe(initial);
  f.setActivity(undefined);
  expect(f.people()).toContain("Worker"); expect(f.people()).not.toContain("(idle)"); expect(f.people()).not.toContain("operating");
});

test("private thought changes do not become physical activity or cache invalidation", () => {
  jest.spyOn(Date, "now").mockReturnValue(100_000);
  const f = fixture(), before = getAgentSensoryFingerprint(f.world, f.observer);
  Mind.mode[f.actor] = "new private mode"; Mind.focus[f.actor] = "new secret plan";
  expect(getAgentSensoryFingerprint(f.world, f.observer)).toBe(before);
});

test("blind, remote, and occluded observers cannot query another actor's activity hook", () => {
  const f = fixture();
  expect(getObservedPublicActivity(f.world, f.distant, f.actor)).toBeUndefined();
  expect(f.hook).not.toHaveBeenCalled();
  addComponent(f.world, f.observer, Traits); Traits.active[f.observer] = '["blind"]';
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBeUndefined(); expect(f.hook).not.toHaveBeenCalled();
  expect(f.people()).toBe("");
  Traits.active[f.observer] = "[]";
  const box = createObjectEntity(f.world, { name: "Opaque enclosure", roomId: f.room, portable: false });
  addComponent(f.world, box, Container); ObjectState.current[box] = "closed"; setLocatedIn(f.world, f.actor, box);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBeUndefined(); expect(f.hook).not.toHaveBeenCalled();
  expect(f.people()).not.toContain("Worker");
});

test("target IDs reveal only visible controls or observer-local available doorways", () => {
  const f = fixture();
  f.setActivity({ kind: "operating", targetEid: f.secret });
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("operating");
  f.setActivity({ kind: "moving", targetEid: f.remote });
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("moving");
  expect(f.people()).not.toContain("Unseen vault");
  f.setActivity({ kind: "moving", targetEid: f.doorway });
  expect(f.people()).toContain("moving toward Courtyard");
  setLocatedIn(f.world, f.actor, f.doorway);
  expect(f.people()).not.toContain("Worker");
});

test("unknown activity kinds preserve visible presence without inventing idle or private activity", () => {
  const f = fixture(); f.setActivity({ kind: "secret narrative" } as unknown as Activity);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBeUndefined(); expect(f.people()).toContain("Worker");
  expect(f.people()).not.toContain("(idle)");
  expect(f.people()).not.toContain("secret narrative");
});

test("generic person state cannot enter sensory text, its cache fingerprint or the combined cognition context", () => {
  const f = fixture(); f.setActivity(undefined);
  ObjectState.current[f.actor] = "PRIVATE_AGENT_STATE_SENTINEL";
  ObjectState.current[f.lever] = "physical handle raised";
  const initial = getAgentSensoryFingerprint(f.world, f.observer);
  const stimuli = generateStimuliForAgent(f.world, f.observer, []);
  const perception = formatStimuliForPrompt(stimuli, f.observer, f.world);
  expect(perception).toContain("Worker"); expect(perception).toContain("physical handle raised");
  expect(JSON.stringify(stimuli)).not.toContain("PRIVATE_AGENT_STATE_SENTINEL");
  addPerception(f.world, f.observer, { type: "perception", source: "senses", content: perception });
  expect(buildAgentContext(f.world, f.observer)).not.toContain("PRIVATE_AGENT_STATE_SENTINEL");
  ObjectState.current[f.actor] = "ANOTHER_PRIVATE_AGENT_STATE";
  expect(getAgentSensoryFingerprint(f.world, f.observer)).toBe(initial);
  expect(f.people()).not.toContain("ANOTHER_PRIVATE_AGENT_STATE");
});

test("native activity membership does not enumerate unrelated room surfaces", () => {
  const f = fixture(), unrelated = createObjectEntity(f.world, { name: "Unrelated cupboard", roomId: f.room, traits: [] });
  const descriptor = Object.getOwnPropertyDescriptor(Traits.active, unrelated)!;
  let reads = 0;
  Object.defineProperty(Traits.active, unrelated, { configurable: true, enumerable: descriptor.enumerable,
    get: () => { reads++; return descriptor.value; } });
  try {
    expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding Hand lever");
    expect(reads).toBe(0);
  } finally { Object.defineProperty(Traits.active, unrelated, descriptor); }
});

test.each(["hidden", "invisible", "concealed"])("activity membership retains fresh %s and self boundaries", trait => {
  const f = fixture();
  expect(getObservedPublicActivity(f.world, f.actor, f.actor)).toBeUndefined();
  expect(f.hook).not.toHaveBeenCalled();
  addComponent(f.world, f.actor, Traits); Traits.active[f.actor] = JSON.stringify([trait]);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBeUndefined();
  expect(f.hook).not.toHaveBeenCalled();
  Traits.active[f.actor] = "[]";
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding Hand lever");
  addComponent(f.world, f.lever, Traits); Traits.active[f.lever] = JSON.stringify([trait]);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding");
});

test("custom visibility producers keep native privacy and their post-hook movement defense", () => {
  const f = fixture();
  let moveActor = false;
  const visibleEntities = jest.fn(() => {
    if (moveActor) setLocatedIn(f.world, f.actor, f.remote);
    return [f.actor, f.secret];
  });
  f.observerCapabilities.visibleEntities = visibleEntities;
  f.setActivity({ kind: "operating", targetEid: f.secret });
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("operating");
  expect(visibleEntities).toHaveBeenCalledTimes(1); f.hook.mockClear();
  moveActor = true;
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBeUndefined();
  expect(f.hook).not.toHaveBeenCalled();
});

test("activity targets preserve closed-interior privacy and the distinct held-exterior projection", () => {
  const f = fixture(), box = createObjectEntity(f.world, { name: "Closed toolbox", roomId: f.room });
  addComponent(f.world, box, Container); ObjectState.current[box] = "closed";
  setLocatedIn(f.world, f.lever, box);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding");
  ObjectState.current[box] = "open";
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding Hand lever");
  setLocatedIn(f.world, f.lever, f.actor);
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding");
  addComponent(f.world, f.lever, EquipSlot); EquipSlot.slot[f.lever] = "mainHand"; EquipSlot.equippedBy[f.lever] = f.actor;
  expect(getObservedPublicActivity(f.world, f.observer, f.actor)).toBe("holding Hand lever");
});
