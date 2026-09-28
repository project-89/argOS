import { jest } from "@jest/globals";
import { ApartmentSitcom } from "../apartment-sitcom";
import { CoffeeIntervention } from "../coffee-intervention";
import { getCommittedEvents } from "../../runtime/committed-events";
import { releaseSimulationResources } from "../../runtime/simulation-timeline";
import { WorkingMemoryIdentity } from "../../ecs/components";
import { getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { drainPendingStimuli } from "../../cognition/stimulus-queue";

let t: ApartmentSitcom;
beforeEach(async () => {
  drainPendingStimuli();
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline intervention tests."));
  t = await ApartmentSitcom.create({ scenario: "duet", live: false, outsideTextAtMs: null });
  await t.start();
});
afterEach(() => {
  t.stop(); expect(globalThis.fetch).not.toHaveBeenCalled();
  jest.restoreAllMocks(); drainPendingStimuli();
});
function startPour() {
  t.dispatch("Elaine", { type: "move", target: "Kitchen" }); t.advance(3000);
  t.dispatch("Elaine", { type: "pickup", target: "Blue mug" }); t.advance(800);
  t.dispatch("Elaine", { type: "interact", target: "Coffee pot", content: "pour" });
}

test("a physical intervention invalidates the in-flight pour without inventing liquid or a reaction", () => {
  const intervention = new CoffeeIntervention(); startPour(); t.advance(500);
  expect(intervention.poll(t)).toBe(true);
  expect(intervention.snapshot()).toMatchObject({ status: "applied", before: 4, after: 0,
    actorId: t.ids.Elaine, targetId: t.ids.coffee, atSimMs: 4300 });
  expect(intervention.poll(t)).toBe(false);
  t.advance(1500);
  expect(getCommittedEvents(t.sim.world).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: "pouring", status: "failed" })]));
  expect(t.coffee.portions[t.ids.coffee]).toBe(0);
  expect(t.cup.filled[t.ids.blueMug]).toBe(false);
  expect(t.cup.drinks[t.ids.blueMug]).toBe(0);
  expect(getAgentWorldCapabilities(t.sim.world, t.ids.Elaine)!.affordances!(t.ids.coffee).map(a => a.name)).not.toContain("pour");
  expect(t.snapshot().events.some(e => e.kind === "thought")).toBe(false);
});

test("a completed pour's old pending event cannot trigger an intervention", () => {
  startPour(); t.advance(2000);
  const intervention = new CoffeeIntervention();
  expect(intervention.poll(t)).toBe(false);
  expect(intervention.snapshot()).toEqual({ status: "not_triggered" });
  expect(t.coffee.portions[t.ids.coffee]).toBe(3);
  expect(t.cup.filled[t.ids.blueMug]).toBe(true);
});

test("no adoption is inconclusive, and a stopped simulation cannot be modified", () => {
  const intervention = new CoffeeIntervention();
  expect(intervention.poll(t)).toBe(false); startPour(); t.stop();
  expect(intervention.poll(t)).toBe(false);
  expect(intervention.snapshot()).toEqual({ status: "not_triggered" });
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
});

test("a pending log row without a current body reservation is not a live pour", () => {
  startPour();
  const event = getCommittedEvents(t.sim.world).events.find(e => e.operation === "pouring")!;
  releaseSimulationResources(t.sim.world, event.actorId, event.executionId);
  expect(new CoffeeIntervention().poll(t)).toBe(false);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
});

test("a replaced target identity cannot inherit the old interruption target", () => {
  startPour(); WorkingMemoryIdentity.id[t.ids.coffee] = "entity:replacement-pot";
  expect(new CoffeeIntervention().poll(t)).toBe(false);
  expect(t.coffee.portions[t.ids.coffee]).toBe(4);
});
