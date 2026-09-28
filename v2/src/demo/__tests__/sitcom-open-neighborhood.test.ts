/** Native plumbing tests with explicitly scripted actions. These are NOT
 * evidence of autonomous departure, live world growth, or successful H3 output. */
import { jest } from "@jest/globals";
import { entityExists } from "bitecs";
import { ApartmentSitcom, type SitcomEvent } from "../apartment-sitcom";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getRoomRouteTargets } from "../../runtime/room-routes";
import { getCommittedEvents } from "../../runtime/committed-events";
import { materializePlaceBlueprint, getPlaceBuildStatus } from "../../engineering/place-materialization";
import { getAvailableAffordances } from "../../world/affordance-availability";
import { executeActions } from "../../cognition/cognition-system";
import { getSocialDialogue } from "../../cognition/social-memory";
import { getWorkingMemory, workingMemoryEntityRef } from "../../cognition/working-memory";
import { captureWorkingMemoryObservation } from "../../cognition/working-memory-observation";
import { Needs } from "../../ecs/components";
import { attachCommittedSceneRenderer } from "../../rendering/attach-committed-renderer";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

let t: ApartmentSitcom;
const cameras: ReturnType<typeof attachCommittedSceneRenderer>[] = [];
beforeEach(() => { drainPendingStimuli(); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No live cognition or renderer in plumbing tests")); });
afterEach(() => { cameras.splice(0).forEach(c => c.stop()); t?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); drainPendingStimuli(); });
async function fixture(openNeighborhood = true) {
  t = await ApartmentSitcom.create({ live: false, scenario: "cookie", openNeighborhood, outsideTextAtMs: null });
  await t.start(); return t;
}
function walk(target: string) { t.dispatch("Elaine", { type: "move", target }); t.advance(3000); }
function restaurant() {
  const built = materializePlaceBlueprint(t.sim.world, { name: "Corner Restaurant", type: "room", description: "An INTERIOR restaurant with red booths and a service counter.",
    components: [], connectToRoomEids: [t.ids.street], contents: [
      { id: "owner", entity: { name: "Nora", type: "agent", description: "The owner in a green apron.", components: [
        { name: "Agent", values: { role: "restaurant owner", systemPrompt: "PRIVATE_RESTAURANT_PAST" } }] } },
      { id: "meal", carriedBy: "owner", entity: { name: "Warm bread", type: "object", description: "A serving of bread.", components: [
        { name: "ObjectType", values: { typeId: "food_item" } }, { name: "PhysicalObject", values: { portable: true, weight: .2 } }] } },
    ] });
  const receipt = getPlaceBuildStatus(t.sim.world, t.sim.god.systemRegistry).find(r => r.id === built.receiptId)!;
  return { room: built.roomEid, owner: receipt.members.find(m => m.id === "owner")!.eid, food: receipt.members.find(m => m.id === "meal")!.eid };
}
function camera(roomId: number) {
  const c = attachCommittedSceneRenderer(t.sim.world, { roomId, windowMs: 8000,
    captureScenes: () => t.scenes().filter(scene => scene.room.id === roomId) });
  cameras.push(c); return c;
}

test("original closed-cookie initial conditions remain unchanged unless the neighborhood is explicitly enabled", async () => {
  await fixture(false);
  expect(t.characters).toEqual(["Jerry", "George", "Elaine", "Kramer"]);
  expect(t.scenes().map(s => s.room.name).sort()).toEqual(["Kitchen", "Living Room"]);
  expect(t.ids.street).toBeUndefined();
  expect(t.sim.getAgentGoals("Elaine").some(g => g.description.includes("cookie"))).toBe(true);
});
test("four-character cookie mode can opt into native routes; departure takes time and cannot teleport to a later generated room", async () => {
  await fixture(); expect(t.characters).toHaveLength(4);
  expect(t.scenes().map(s => s.room.name).sort()).toEqual(["Hallway", "Kitchen", "Living Room", "Street"]);
  expect(getRoomRouteTargets(t.sim.world, t.ids.Elaine).sort()).toEqual([t.ids.kitchen, t.ids.hallway].sort());
  const made = restaurant();
  walk("Corner Restaurant"); expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.living);
  t.dispatch("Elaine", { type: "move", target: "Hallway" }); t.advance(2999);
  expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.living);
  t.advance(1); expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(t.ids.hallway);
  walk("Street"); walk("Corner Restaurant"); expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(made.room);
  for (const name of ["Jerry", "George", "Kramer"]) expect(getRoomForEntity(t.sim.world, t.ids[name])).toBe(t.ids.living);
});
test("physical text, generated service and concurrent apartment speech share one clock and two independent read-only camera tapes", async () => {
  await fixture(); const events: SitcomEvent[] = []; t.onEvent(e => events.push(e));
  t.setPhoneContact({ name: "Alex", relationship: "boyfriend", context: "Alex and Elaine are dating." });
  const privateText = "PRIVATE_INVITATION: Can we meet for dinner at Corner Restaurant?";
  const message = t.text(privateText); t.advance(200);
  expect(t.context("Elaine")).not.toContain(privateText);
  walk("Kitchen"); t.dispatch("Elaine", { type: "pickup", target: "Elaine's phone" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: "read_phone" }); t.advance(1200);
  expect(t.context("Elaine")).toContain(privateText); expect(t.context("Jerry")).not.toContain(privateText);
  expect(events.some(e => e.messageId === message && e.kind === "phone_read")).toBe(true);
  walk("Living Room");
  const made = restaurant(), apartment = camera(t.ids.living), dinner = camera(made.room);
  expect(apartment.sourceId).toBe(dinner.sourceId);
  const apartmentCursor = apartment.renderer.snapshot().sourcePlayheadSimMs;
  walk("Hallway"); walk("Street"); walk("Corner Restaurant");
  const leftAt = t.elapsedMs;
  t.dispatch("Jerry", { type: "speak", target: "George", content: "The cookie is still missing." });
  executeActions(t.sim.world, [{ eid: made.owner, action: { type: "drop", target: "Warm bread" } }], t.sim.god.systemRegistry);
  t.advance(1000);
  expect(getDirectContainer(t.sim.world, made.food)).toBe(made.room);
  expect(getAvailableAffordances(t.sim.world, t.ids.Elaine, made.food).some(a => a.name === "eat")).toBe(true);
  const foodKey = workingMemoryEntityRef(t.sim.world, made.food)!.key;
  captureWorkingMemoryObservation(t.sim.world, made.owner);
  Needs.hunger[t.ids.Elaine] = 70;
  t.dispatch("Elaine", { type: "interact", target: "Warm bread", content: "eat" });
  expect(getWorkingMemory(t.sim.world, made.owner).facts.some(f => f.subject === foodKey && f.value === "removed")).toBe(false);
  t.advance(5000);
  expect(events.filter(e => e.actor === "Elaine").slice(-8)).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: expect.objectContaining({ target: "Warm bread" }), status: "succeeded" }),
  ]));
  // Consumption feedback can immediately reuse the numeric ECS slot. Check
  // the food's original lifetime, not whether that slot exists for any reason.
  expect(entityExists(t.sim.world, made.food) && workingMemoryEntityRef(t.sim.world, made.food)?.key === foodKey).toBe(false);
  expect(Needs.hunger[t.ids.Elaine]).toBe(40);
  for (const actor of [made.owner, t.ids.Elaine]) expect(getWorkingMemory(t.sim.world, actor).facts.filter(f => f.subject === foodKey)).toEqual([
    expect.objectContaining({ slot: "Entity.lifecycle", value: "removed" }),
  ]);
  expect(getWorkingMemory(t.sim.world, t.ids.Jerry).facts.some(f => f.subject === foodKey)).toBe(false);
  t.dispatch("Elaine", { type: "interact", target: "Elaine's phone", content: `reply ${JSON.stringify({ replyTo: message, text: "PRIVATE_REPLY: I have arrived." })}` });
  t.advance(15000);
  expect(events.some(e => e.kind === "reply_typed" && e.status === "succeeded")).toBe(true);
  expect(getSocialDialogue(t.sim.world, t.ids.George).some(e => e.content === "The cookie is still missing.")).toBe(true);
  expect(getSocialDialogue(t.sim.world, t.ids.Elaine).some(e => e.content === "The cookie is still missing.")).toBe(false);
  expect(getCommittedEvents(t.sim.world).events.some(e => e.actorId === t.ids.Jerry && e.kind === "speech" && e.atSimMs >= leftAt)).toBe(true);
  const readTape = (c: typeof apartment) => {
    const segments = [];
    for (let i = 0; i < 20; i++) { const row = c.renderer.next(); if (row.status !== "ready") break;
      segments.push(row.segment); expect(c.renderer.settle(row.segment.version, true)).toBe(true); }
    expect(c.status().error).toBeNull(); return segments;
  };
  const at = t.elapsedMs, dinnerTape = readTape(dinner);
  expect(apartment.renderer.snapshot().sourcePlayheadSimMs).toBe(apartmentCursor);
  const homeTape = readTape(apartment);
  expect(t.elapsedMs).toBe(at); expect(getRoomForEntity(t.sim.world, t.ids.Elaine)).toBe(made.room);
  expect(dinnerTape.length).toBeGreaterThan(0); expect(homeTape.length).toBeGreaterThan(0);
  expect(homeTape.flatMap(s => s.window.events).some(e => e.event.actorId === made.owner)).toBe(false);
  expect(dinnerTape.flatMap(s => s.window.events).some(e => e.event.actorId === t.ids.Jerry)).toBe(false);
  const prompts = [...homeTape, ...dinnerTape].map(s => s.prompt).join("\n");
  for (const secret of [privateText, "PRIVATE_REPLY", "PRIVATE_RESTAURANT_PAST"]) expect(prompts).not.toContain(secret);
  apartment.stop(); t.advance(8000); expect(dinner.renderer.next().status).toBe("ready");
});
