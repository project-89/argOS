import { jest } from "@jest/globals";
import { Agent, LastAction, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer } from "../../ecs/location";
import { getCommittedEvents } from "../../runtime/committed-events";
import { isSimulationResourceBusy } from "../../runtime/simulation-timeline";
import { getSocialDialogue, getSocialSpeechFragments } from "../../cognition/social-memory";
import { GenerativeAgentsTestbed } from "../generative-agents";

async function fixture(run: (house: GenerativeAgentsTestbed) => void) {
  const request = jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No paid APIs in temporal physics tests"));
  const house = await GenerativeAgentsTestbed.create({ live: false }); await house.start();
  try { run(house); expect(request).not.toHaveBeenCalled(); } finally { house.stop(); request.mockRestore(); }
}

test("pickup is a finite body operation and its exact success receipt occurs only at completion", async () => fixture(house => {
  const { world } = house.sim, i = house.ids;
  house.dispatch("Mara", { type: "pickup", target: "Yellow raincoat" });
  expect(getDirectContainer(world, i.coat)).toBe(i.common);
  expect(isSimulationResourceBusy(world, i.Mara, "body")).toBe(true);
  const pending = getCommittedEvents(world).events.find(e => e.action === "pickup")!;
  expect(pending).toMatchObject({ status: "pending", startedAtSimMs: 0, expectedEndSimMs: 800 });
  house.advance(799); expect(getDirectContainer(world, i.coat)).toBe(i.common);
  house.advance(1); expect(getDirectContainer(world, i.coat)).toBe(i.Mara);
  expect(getCommittedEvents(world).events.filter(e => e.executionId === pending.executionId)).toEqual([
    pending, expect.objectContaining({ status: "succeeded", completedAtSimMs: 800 }),
  ]);
  expect(isSimulationResourceBusy(world, i.Mara, "body")).toBe(false);
}));

test.each(["moved", "replaced"])("a %s target cannot be acquired from a stale pickup intention", async mutation => fixture(house => {
  const { world } = house.sim, i = house.ids;
  house.dispatch("Mara", { type: "pickup", target: "Yellow raincoat" }); house.advance(400);
  if (mutation === "moved") house.relocateObject("Yellow raincoat", "Utility Room");
  else WorkingMemoryIdentity.id[i.coat] = "replacement garment lifetime";
  house.advance(400);
  expect(getDirectContainer(world, i.coat)).not.toBe(i.Mara);
  expect(LastAction.success[i.Mara]).toBe(false);
  expect(getCommittedEvents(world).events.at(-1)).toMatchObject({ action: "pickup", status: "failed", completedAtSimMs: 800 });
}));

test("stop clears finite handling without a later possession or success receipt", async () => fixture(house => {
  const { world } = house.sim, i = house.ids;
  house.dispatch("Mara", { type: "pickup", target: "Yellow raincoat" }); house.advance(400);
  house.stop(); house.advance(5000);
  expect(getDirectContainer(world, i.coat)).toBe(i.common);
  expect(isSimulationResourceBusy(world, i.Mara, "body")).toBe(false);
  expect(getCommittedEvents(world).events.some(e => e.action === "pickup" && e.status === "succeeded")).toBe(false);
}));

test("an inactive actor cannot finish a previously admitted pickup", async () => fixture(house => {
  const { world } = house.sim, i = house.ids;
  house.dispatch("Mara", { type: "pickup", target: "Yellow raincoat" });
  Agent.active[i.Mara] = false; house.advance(800);
  expect(getDirectContainer(world, i.coat)).toBe(i.common);
  expect(getCommittedEvents(world).events.some(e => e.action === "pickup" && e.status === "succeeded")).toBe(false);
}));

test("a coarse travelling utterance does not deliver its destination-room suffix to people left behind", async () => fixture(house => {
  const { world } = house.sim, i = house.ids;
  house.dispatch("Mara", { type: "move", target: "Utility Room" });
  house.dispatch("Mara", { type: "speak", target: "Ivo", content: "one two three four five six seven eight nine ten." });
  expect(house.scenes().flatMap(s => s.events).some(e => e.text?.includes("one two three"))).toBe(false);
  house.advance(8000);
  expect(getSocialSpeechFragments(world, i.Ivo).map(row => row.content).join("")).toBe("one two three four five six ");
  expect(getSocialDialogue(world, i.Ivo)).toHaveLength(0);
  const events = getCommittedEvents(world).events;
  expect(events.filter(e => e.action === "move" && e.completedAtSimMs !== undefined)).toEqual([
    expect.objectContaining({ status: "succeeded", completedAtSimMs: 3000 }),
  ]);
  expect(events.filter(e => e.action === "speak" && e.completedAtSimMs !== undefined)).toEqual([
    expect.objectContaining({ status: "succeeded", completedAtSimMs: 4420 }),
  ]);
}));
