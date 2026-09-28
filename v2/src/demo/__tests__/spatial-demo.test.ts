import { jest } from "@jest/globals";
import { entityExists, getRelationTargets, hasComponent, removeEntity } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { Container, Goal, Name, Needs, ObjectState, ObjectType, PhysicalObject, Position, WorkingMemoryIdentity } from "../../ecs/components";
import { SittingOn } from "../../ecs/relations";
import { getPrivateCommunications } from "../../cognition/communication-memory";
import { getCommittedEvents, publishCommittedEvent } from "../../runtime/committed-events";
import { recordOngoingActivityChoice } from "../../cognition/ongoing-activity";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getAgentVisualEntities, getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getKnownAffordances, getAvailableAffordances } from "../../world/affordance-availability";
import { validateGeneratedPlan } from "../../cognition/planning-system";
import { CAFE_SPATIAL_BLUEPRINT } from "../spatial-catalog";

let d: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Spatial integration checks are offline"));
  d = await SpatialDemo.create({ live: false, automaticClock: false }); await d.start();
});
afterEach(() => { d?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const actor = (name = "Mara") => d.snapshot().actors.find(a => a.name === name)!;
const prop = (id: string) => d.snapshot().entities.find(e => e.id === d.byId.get(id))!;
const room = (id: string) => d.snapshot().rooms.find(e => e.id === d.byId.get(id))!;
const originalPhysicalObjectExists = (id: number, key: string) => entityExists(d.sim.world,id) && hasComponent(d.sim.world,id,PhysicalObject)
  && hasComponent(d.sim.world,id,WorkingMemoryIdentity) && WorkingMemoryIdentity.id[id] === key;
test("ordinary worlds do not install an empty observable-instrument hook", () => {
  for (const eid of d.actors) expect(getAgentWorldCapabilities(d.sim.world, eid)?.observableState).toBeUndefined();
});

test("the synchronous local catalogue matches current per-target affordances without remote props", () => {
  const w = d.sim.world, mara = actor(), caps = getAgentWorldCapabilities(w, mara.id)!;
  const expected = () => getAgentVisualEntities(w, mara.id).flatMap(id => {
    const verbs = caps.affordances!(id).map(a => a.name);
    return verbs.length ? [{ target: Name.value[id], verbs }] : [];
  });
  const catalogue = () => JSON.parse(caps.context().split("Other locally available operations: ")[1].split(".\n")[0]);
  expect(catalogue()).toEqual(expected());
  const chair = prop("apartment-chair"); ObjectState.current[chair.id] = "occupied";
  expect(catalogue()).toEqual(expected());
  expect(caps.affordances!(chair.id).map(a => a.name)).not.toContain("sit");
  d.dispatch(mara.key, "move", room("street").key); d.advance(20000);
  expect(catalogue()).toEqual(expected());
  expect(caps.affordances!(chair.id)).toEqual([]);
});

test("operator dialogue groups only already spoken slices from the same native execution", () => {
  const mara = actor(), ivo = actor("Ivo"), roomId = room("apartment").id;
  const part = (actorId: number, executionId: string, text: string) => publishCommittedEvent(d.sim.world,
    { kind: "speech", action: "speak", status: "succeeded", actorId, roomId, executionId, text });
  part(mara.id, "line-one", "Hello ");
  expect(d.snapshot().events.filter(e => e.kind === "speech").map(e => e.text)).toEqual(["Mara: Hello "]);
  expect(d.snapshot().cues).toEqual([expect.objectContaining({ entityKey: mara.key, text: "Hello ", kind: "speech" })]);
  expect(d.snapshot().cues).toEqual(d.snapshot().cues);
  part(ivo.id, "line-two", "Hi."); part(mara.id, "line-one", "Ivo.");
  part(mara.id, "line-three", "Nice afternoon.");
  expect(d.snapshot().events.filter(e => e.kind === "speech").map(e => e.text))
    .toEqual(["Mara: Hello Ivo.", "Ivo: Hi.", "Mara: Nice afternoon."]);
  expect(d.snapshot().cues.map(cue => [cue.entityKey, cue.text])).toEqual([[mara.key, "Hello Ivo."], [ivo.key, "Hi."], [mara.key, "Nice afternoon."]]);
  d.advance(5600); expect(d.snapshot().cues).toHaveLength(0);
});

test("operator focus distinguishes a leading goal from an accepted ongoing activity", () => {
  const mara = actor(), leading = mara.goals![0];
  expect(mara.focus).toMatchObject({ kind: "goal", description: leading.description });
  const priorIdentity = WorkingMemoryIdentity.id[leading.id]; d.snapshot();
  expect(WorkingMemoryIdentity.id[leading.id]).toBe(priorIdentity);
  recordOngoingActivityChoice(d.sim.world, mara.id, { purpose: "Taking a walk", actionType: "move", goalId: leading.id });
  expect(actor().focus).toMatchObject({ kind: "activity", description: leading.description });
  Goal.status[leading.id] = "completed";
  expect(actor().goals!.some(g => g.id === leading.id)).toBe(false);
  expect(actor().focus?.kind).not.toBe("activity");
});

test("public sound/action cues require actual effects and never disclose private phone text", () => {
  const mara = actor(), phone = prop("maras-phone"); d.text(mara.key, "PRIVATE_CUE_SECRET");
  expect(d.snapshot().cues).toEqual([expect.objectContaining({ entityKey: phone.key, kind: "sound", text: "bzzzt bzzzt" })]);
  expect(JSON.stringify(d.snapshot().cues)).not.toContain("PRIVATE_CUE_SECRET");
  d.dispatch(mara.key, "pickup", phone.key);
  expect(d.snapshot().cues.some(c => c.kind === "action")).toBe(false);
  d.advance(100); d.dispatch(mara.key, "wait");
  expect(d.snapshot().cues.some(c => c.kind === "action")).toBe(false);
  d.dispatch(mara.key, "pickup", phone.key); d.advance(4000);
  expect(d.snapshot().cues.some(c => c.entityKey === mara.key && c.text === "rustle · picked up")).toBe(true);
  d.advance(3100); expect(d.snapshot().cues.some(c => c.kind === "action")).toBe(false);
  d.stop(); expect(d.snapshot().cues).toHaveLength(0);
});
function takePhone() {
  const mara = actor(), phone = prop("maras-phone");
  d.dispatch(mara.key,"pickup",phone.key); d.advance(6000);
  expect(getDirectContainer(d.sim.world,phone.id)).toBe(mara.id);
  return { mara, phone };
}

test("manual offline world is ECS-backed and action effects wait for walking and handling", () => {
  const mara = actor(), phone = prop("maras-phone"), before = { x: Position.x[mara.id], y: Position.y[mara.id] };
  expect(d.snapshot().mode).toBe("manual"); expect(d.snapshot().limits.autonomousGrowth).toBe(false);
  d.dispatch(mara.key,"pickup",phone.key);
  expect(getDirectContainer(d.sim.world,phone.id)).not.toBe(mara.id);
  d.advance(100);
  expect(getDirectContainer(d.sim.world,phone.id)).not.toBe(mara.id);
  expect({ x: Position.x[mara.id], y: Position.y[mara.id] }).not.toEqual(before);
  d.advance(6000);
  expect(getDirectContainer(d.sim.world,phone.id)).toBe(mara.id);
  expect(prop("maras-phone").heldBy).toBe(mara.id);
});

test("manual time advances without inventing autonomous choices or movement", () => {
  expect(d.sim.god.systemRegistry.systems.get("StuckAgentRecovery")?.active).toBe(false);
  const initial = d.actors.map(id => ({ id, x: Position.x[id], y: Position.y[id], room: getRoomForEntity(d.sim.world,id) }));
  d.advance(12000);
  expect(d.actors.map(id => ({ id, x: Position.x[id], y: Position.y[id], room: getRoomForEntity(d.sim.world,id) }))).toEqual(initial);
  expect(getCommittedEvents(d.sim.world).events.filter(e => e.kind === "action" && e.status === "succeeded")).toHaveLength(0);
});

test("dropping a held phone while seated fails clearly without embedding it in furniture", () => {
  const { mara, phone } = takePhone(), chair = prop("apartment-chair");
  d.dispatch(mara.key,"interact",chair.key,"sit"); d.advance(6000);
  expect(getRelationTargets(d.sim.world,mara.id,SittingOn)).toContain(chair.id);
  expect(getDirectContainer(d.sim.world,phone.id)).toBe(mara.id);
  const before = new Set(getWorkingMemory(d.sim.world,mara.id).receipts.map(r => r.id));
  d.dispatch(mara.key,"drop",phone.key); d.advance(2000);
  expect(getDirectContainer(d.sim.world,phone.id)).toBe(mara.id);
  expect(prop("maras-phone").heldBy).toBe(mara.id);
  expect(getRelationTargets(d.sim.world,mara.id,SittingOn)).toContain(chair.id);
  const failure = getWorkingMemory(d.sim.world,mara.id).receipts.find(r => !before.has(r.id) && r.kind === "action" && r.action?.type === "drop");
  expect(failure).toMatchObject({ succeeded:false });
  expect(failure?.summary).toMatch(/stand|seat|furniture/i);
  expect(getCommittedEvents(d.sim.world).events.some(e => e.actorId === mara.id && e.action === "drop" && e.status === "succeeded")).toBe(false);
});

test("phone read and reply are timed private native outcomes, not immediate operator success", () => {
  const mara = actor(), ivo = actor("Ivo"), message = d.text(mara.key,"PRIVATE_SMS_8732 Please meet me outside.");
  expect(actor().messages.find(m => m.id === message)?.status).toBe("delivered");
  expect(getPrivateCommunications(d.sim.world,mara.id)).toHaveLength(0);
  expect(getPrivateCommunications(d.sim.world,ivo.id)).toHaveLength(0);
  const { phone } = takePhone();
  d.dispatch(mara.key,"interact",phone.key,'reply {"replyTo":'+message+',"text":"Premature reply"}'); d.advance(2000);
  expect(actor().messages.filter(m => m.direction === "out")).toHaveLength(0);
  d.dispatch(mara.key,"interact",phone.key,"read_phone"); d.advance(500);
  expect(actor().messages.find(m => m.id === message)?.status).toBe("delivered");
  d.advance(700);
  expect(actor().messages.find(m => m.id === message)?.status).toBe("read");
  expect(getPrivateCommunications(d.sim.world,mara.id).some(m => m.content.includes("PRIVATE_SMS_8732"))).toBe(true);
  expect(getPrivateCommunications(d.sim.world,ivo.id)).toHaveLength(0);
  expect(JSON.stringify({ entities: d.snapshot().entities, events: d.snapshot().events })).not.toContain("PRIVATE_SMS_8732");
  d.dispatch(mara.key,"interact",phone.key,'reply {"replyTo":'+message+',"text":"I will meet you there."}'); d.advance(1000);
  expect(actor().messages.filter(m => m.direction === "out")).toHaveLength(0);
  d.advance(1000);
  expect(actor().messages.filter(m => m.direction === "out").map(m => m.text)).toEqual(["I will meet you there."]);
});

test("phone catalogue permits pickup then reading without granting custody, unread contents or a prewritten reply", () => {
  const mara = actor(), ivo = actor("Ivo"), phone = prop("maras-phone"), w = d.sim.world;
  const known = getKnownAffordances(w, mara.id, phone.id);
  expect(known).toContainEqual(expect.objectContaining({ name: "read_phone", opensEvidenceBoundary: true }));
  expect(known).toContainEqual(expect.objectContaining({ name: "reply", requiresFreshDecision: true }));
  expect(getAvailableAffordances(w, mara.id, phone.id).map(a => a.name)).not.toContain("read_phone");
  const plan = { goalDescription: "Read my phone", steps: [
    { description: "Pick up my phone", actionType: "pickup", target: phone.name },
    { description: "Read the notification", actionType: "interact", target: phone.name, content: "read_phone" },
  ], estimatedCompletion: "short", potentialObstacles: [] };
  expect(validateGeneratedPlan(w, mara.id, "Read my phone", plan as any)).toMatchObject({ ok: true });
  const message = d.text(mara.key, "PRIVATE_CATALOGUE_TEST");
  d.dispatch(mara.key, "interact", phone.key, "read_phone"); d.advance(1500);
  expect(actor().messages.find(m => m.id === message)?.status).toBe("delivered");
  expect(getPrivateCommunications(w, mara.id)).toHaveLength(0);
  expect(JSON.stringify(getKnownAffordances(w, ivo.id, phone.id))).not.toContain("PRIVATE_CATALOGUE_TEST");
  d.dispatch(mara.key, "move", room("street").key); d.advance(20000);
  expect(getKnownAffordances(w, mara.id, phone.id)).toEqual([]);
});

test("cancelled reading cannot disclose or acknowledge the unread text", () => {
  const { mara, phone } = takePhone(), message = d.text(mara.key,"PRIVATE_CANCELLED_9401");
  d.dispatch(mara.key,"interact",phone.key,"read_phone"); d.advance(300); d.dispatch(mara.key,"wait"); d.advance(3000);
  expect(actor().messages.find(m => m.id === message)?.status).toBe("delivered");
  expect(getPrivateCommunications(d.sim.world,mara.id)).toHaveLength(0);
});

test("removing a phone during approach prevents phantom pickup and late success", () => {
  const mara = actor(), phone = prop("maras-phone");
  d.dispatch(mara.key,"pickup",phone.key); d.advance(100); removeEntity(d.sim.world,phone.id); d.advance(6000);
  expect(d.snapshot().entities.some(e => e.key === phone.key)).toBe(false);
  const receipts = getCommittedEvents(d.sim.world).events.filter(e => e.actorId === mara.id && e.action === "pickup");
  expect(receipts.some(e => e.status === "succeeded")).toBe(false);
  expect(receipts.some(e => e.status === "failed")).toBe(true);
  expect(() => d.text(mara.key,"This must not report delivery to a removed phone.")).toThrow();
});

test("native eating consumes the actual snack and changes hunger only at completion", () => {
  const mara = actor(), snack = prop("apartment-snack"); Needs.hunger[mara.id] = 60;
  d.dispatch(mara.key,"interact",snack.key,"eat"); d.advance(1000);
  expect(originalPhysicalObjectExists(snack.id,snack.key)).toBe(true); expect(Needs.hunger[mara.id]).toBeGreaterThanOrEqual(60);
  expect(d.snapshot().cues.some(c => c.text === "munch munch")).toBe(false);
  d.advance(5000);
  expect(d.snapshot().cues.some(c => c.entityKey === mara.key && c.text === "munch munch")).toBe(true);
  expect(originalPhysicalObjectExists(snack.id,snack.key)).toBe(false); expect(Needs.hunger[mara.id]).toBeLessThan(40);
  expect(d.snapshot().entities.some(e => e.key === snack.key)).toBe(false);
});

test("an operator cafe expansion is idempotent, reachable, and supports native seating", () => {
  const mara = actor(), before = { x: Position.x[mara.id], y: Position.y[mara.id] };
  expect(d.grow()).toMatchObject({ built: true, added: true });
  for (const wall of CAFE_SPATIAL_BLUEPRINT.walls) {
    const eid = d.byId.get(wall.id)!;
    expect(ObjectType.typeId[eid]).toBe("structural_wall");
    expect(ObjectState.current[eid]).toBe("solid");
    expect(hasComponent(d.sim.world, eid, Container)).toBe(false);
  }
  const count = d.snapshot().entities.length;
  expect(d.grow()).toMatchObject({ built: true, added: false }); expect(d.snapshot().entities).toHaveLength(count);
  expect({ x: Position.x[mara.id], y: Position.y[mara.id] }).toEqual(before);
  expect(d.snapshot().limits.autonomousGrowth).toBe(false);
  d.dispatch(mara.key,"move",room("street").key); d.advance(10000);
  expect(getRoomForEntity(d.sim.world,mara.id)).toBe(d.byId.get("street"));
  d.dispatch(mara.key,"move",room("cafe").key); d.advance(10000);
  expect(getRoomForEntity(d.sim.world,mara.id)).toBe(d.byId.get("cafe"));
  const sandwich = prop("cafe-sandwich"); Needs.hunger[mara.id] = 60;
  d.dispatch(mara.key,"interact",sandwich.key,"eat"); d.advance(10000);
  expect(originalPhysicalObjectExists(sandwich.id,sandwich.key)).toBe(false);
  expect(Needs.hunger[mara.id]).toBeLessThan(40);
  expect(d.grow()).toMatchObject({ added: false });
  expect(d.snapshot().entities.some(e => e.key === sandwich.key)).toBe(false);
  const chair = prop("cafe-chair"); d.dispatch(mara.key,"interact",chair.key,"sit"); d.advance(10000);
  expect(getRelationTargets(d.sim.world,mara.id,SittingOn)).toContain(chair.id);
  expect(ObjectState.current[chair.id]).toBe("occupied");
  d.dispatch(mara.key,"move",room("street").key); d.advance(15000);
  expect(getRoomForEntity(d.sim.world,mara.id)).toBe(d.byId.get("street"));
  expect(getRelationTargets(d.sim.world,mara.id,SittingOn)).toHaveLength(0);
});

test("renderable entities exclude authored identity, private thoughts and incoming texts", () => {
  const mara = actor(); d.text(mara.key,"PRIVATE_OPERATOR_MESSAGE_5629"); d.plantThought(mara.key,"PRIVATE_THOUGHT_5629");
  const scene = JSON.stringify(d.snapshot().entities);
  expect(scene).not.toContain("PRIVATE_"); expect(scene).not.toContain("Alex stayed up late");
  expect(d.snapshot().actors.find(a => a.id === mara.id)!.messages[0].text).toContain("PRIVATE_OPERATOR_MESSAGE");
  expect(Name.value[mara.id]).toBe("Mara");
});
