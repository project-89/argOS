import { jest } from "@jest/globals";
import { addComponent, getRelationTargets, removeComponent } from "bitecs";
import { SpatialDemo } from "../spatial-demo";
import { Agent, Goal, Memory, ObjectState, Position, Removed, WorkingMemoryIdentity } from "../../ecs/components";
import { getDirectContainer, setLocatedIn } from "../../ecs/location";
import { HasGoal } from "../../ecs/relations";
import { getAgentVisualEntities, getAgentWorldCapabilities, registerAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getWorkingMemory } from "../../cognition/working-memory";
import { getCommittedEvents, subscribeCommittedEvents } from "../../runtime/committed-events";
import { getSuccessfulGoalActions } from "../../cognition/goal-learning";
import { getAgentMemories } from "../../cognition/knowledge-graph";

let d: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Blackout tests are offline"));
  d = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "blackout" }); await d.start();
});
afterEach(() => { d?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const id = (name: string) => d.byId.get(name)!;
const actor = (name = "Mara") => d.snapshot().actors.find(a => a.name === name)!;
const key = (name: string) => WorkingMemoryIdentity.id[id(name)];
const power = () => d.snapshot().scenario!.power;
function act(verb: string, target = "lighting-panel", name = "Mara", elapsed = 12000) {
  d.dispatch(actor(name).key, verb === "pickup" ? "pickup" : "interact", key(target), verb);
  if (elapsed) d.advance(elapsed);
}
function stock(part = "amber-cartridge", name = "Mara") {
  act("open", "supply-box", name); act("pickup", part, name);
  expect(getDirectContainer(d.sim.world, id(part))).toBe(actor(name).id);
}
function readyToInstall() {
  act("inspect"); act("isolate"); stock();
  act("inspect"); // Approach a prop through its physical inspection, not a room move.
}
test("closed supplies hide their contents from both perception and the public scene", () => {
  const part = id("amber-cartridge");
  expect(getAgentVisualEntities(d.sim.world, actor().id)).not.toContain(part);
  expect(d.snapshot().entities.some(e => e.id === part)).toBe(false);
  act("pickup", "amber-cartridge");
  expect(getDirectContainer(d.sim.world, part)).toBe(id("supply-box"));
  act("open", "supply-box");
  expect(getAgentVisualEntities(d.sim.world, actor().id)).toContain(part);
  expect(d.snapshot().entities.some(e => e.id === part)).toBe(true);
});
test("inspection is a timed private evidence boundary, not prefilled omniscient context", () => {
  const mara = actor(), ivo = actor("Ivo"), caps = getAgentWorldCapabilities(d.sim.world, mara.id)!;
  expect(caps.knownAffordances?.(id("lighting-panel"))).toContainEqual(expect.objectContaining({ name: "inspect", opensEvidenceBoundary: true }));
  expect(caps.context()).not.toMatch(/required.*specification A/i);
  act("inspect", "lighting-panel", "Mara", 0);
  expect(getWorkingMemory(d.sim.world, mara.id).receipts.some(r => /specification A/i.test(JSON.stringify(r)))).toBe(false);
  d.advance(12000);
  expect(JSON.stringify(getWorkingMemory(d.sim.world, mara.id).receipts)).toMatch(/specification A/i);
  expect(JSON.stringify(getWorkingMemory(d.sim.world, ivo.id).receipts)).not.toMatch(/specification A/i);
  expect(JSON.stringify(d.snapshot().scenario)).not.toContain("specification A");
});
test("native observe of the panel still requires physical inspection before diagnosis", () => {
  const mara = actor(); d.dispatch(mara.key, "observe", key("lighting-panel"));
  expect(getWorkingMemory(d.sim.world, mara.id).receipts.some(r => /specification A/i.test(r.summary))).toBe(false);
  expect(actor().action).toBe("walking"); d.advance(12000);
  expect(getAgentMemories(d.sim.world, mara.id).map(id => Memory.content[id]).join("\n")).toMatch(/specification A/i);
});
test("real repair requires possession, isolation and matching part; speech is not success", () => {
  const goals = d.actors.map(a => ({ a, g: getRelationTargets(d.sim.world, a, HasGoal).find(g => Goal.description[g].startsWith("Restore the apartment"))! }));
  expect(goals.every(row => row.g !== undefined)).toBe(true);
  let restorationInTrace = false;
  const unsubscribe = subscribeCommittedEvents(d.sim.world, event => {
    if (power() === "on" && event.status === "succeeded") restorationInTrace ||= getSuccessfulGoalActions(d.sim.world, actor().id, goals[0].g).some(a => a.content === "power_on");
  });
  expect(power()).toBe("off");
  d.dispatch(actor().key, "speak", actor("Ivo").key, "I fixed the lighting."); d.advance(6000);
  expect(power()).toBe("off");
  act("power_on"); expect(power()).toBe("off");
  readyToInstall();
  const panel = id("lighting-panel"), part = id("amber-cartridge");
  act("install Amber cartridge", "lighting-panel", "Mara", 0);
  expect(getDirectContainer(d.sim.world, part)).toBe(actor().id);
  d.advance(100); expect(getDirectContainer(d.sim.world, part)).toBe(actor().id);
  d.advance(5000); expect(getDirectContainer(d.sim.world, part)).toBe(panel); expect(power()).toBe("off");
  act("power_on"); expect(power()).toBe("on");
  for (const { g } of goals) expect(Goal.status[g]).toBe("completed");
  expect(restorationInTrace).toBe(true); unsubscribe();
  expect(getCommittedEvents(d.sim.world).events.some(e => e.actorId === actor().id && e.kind === "action" && e.status === "succeeded")).toBe(true);
  setLocatedIn(d.sim.world, part, id("apartment")); d.advance(100); expect(power()).toBe("off");
});
test("wrong cartridge fails without consumption or a powered circuit", () => {
  act("inspect"); act("isolate"); stock("blue-cartridge"); act("install Blue cartridge");
  expect(getDirectContainer(d.sim.world, id("blue-cartridge"))).toBe(actor().id);
  expect(power()).toBe("off");
  expect(getWorkingMemory(d.sim.world, actor().id).receipts.some(r => r.succeeded === false && /match/.test(r.summary))).toBe(true);
});
test.each(["moved", "replaced", "damaged", "isolation", "inactive", "component-removed", "actor-replaced"])("%s during a timed install cannot produce a stale repair", mutation => {
  readyToInstall(); const part = id("amber-cartridge"), panel = id("lighting-panel"), mara = actor().id;
  act("install Amber cartridge", "lighting-panel", "Mara", 0); d.advance(100);
  expect(actor().action).toBe("inspecting"); // This is genuinely in-flight, not an admission failure.
  if (mutation === "moved") setLocatedIn(d.sim.world, part, id("apartment"));
  if (mutation === "replaced") WorkingMemoryIdentity.id[part] = "replacement-part-lifetime";
  if (mutation === "damaged") d.blackout!.partComponent.intact[part] = false;
  if (mutation === "isolation") d.blackout!.component.isolated[panel] = false;
  if (mutation === "inactive") Agent.active[mara] = false;
  if (mutation === "component-removed") removeComponent(d.sim.world, part, d.blackout!.partComponent);
  if (mutation === "actor-replaced") WorkingMemoryIdentity.id[mara] = "replacement-actor-lifetime";
  d.advance(6000);
  expect(getDirectContainer(d.sim.world, part)).not.toBe(panel); expect(power()).toBe("off");
});
test("stopping cancels installation before consumption", () => {
  readyToInstall(); act("install Amber cartridge", "lighting-panel", "Mara", 0); d.advance(100); d.stop();
  expect(getDirectContainer(d.sim.world, id("amber-cartridge"))).toBe(actor().id);
  expect(power()).toBe("off");
});
test("replacement capability lifetime cannot complete the previous package's operation", () => {
  readyToInstall(); const mara = actor(); const capabilities = getAgentWorldCapabilities(d.sim.world, mara.id)!;
  act("install Amber cartridge", "lighting-panel", "Mara", 0); d.advance(100);
  (d as any).removers[0](); // Fixture revokes the exact old package registration.
  const unregister = registerAgentWorldCapabilities(d.sim.world, mara.id, capabilities);
  d.advance(6000); expect(getDirectContainer(d.sim.world, id("amber-cartridge"))).toBe(mara.id);
  expect(power()).toBe("off"); unregister();
});
test("two overlapping installations cannot consume both parts or overwrite the first", () => {
  readyToInstall(); stock("blue-cartridge", "Ivo");
  // A second independently usable physical part, not an automatically selected answer.
  d.blackout!.partComponent.spec[id("blue-cartridge")] = "A";
  act("install Amber cartridge", "lighting-panel", "Mara", 0);
  act("install Blue cartridge", "lighting-panel", "Ivo", 0);
  d.advance(12000);
  expect(getDirectContainer(d.sim.world, id("amber-cartridge"))).toBe(id("lighting-panel"));
  expect(getDirectContainer(d.sim.world, id("blue-cartridge"))).toBe(actor("Ivo").id);
  expect(power()).toBe("off");
});
test("a box closed during approach cannot yield its hidden cartridge", () => {
  act("open", "supply-box");
  act("pickup", "amber-cartridge", "Mara", 0);
  ObjectState.current[id("supply-box")] = "closed"; d.advance(12000);
  expect(getDirectContainer(d.sim.world, id("amber-cartridge"))).toBe(id("supply-box"));
});
test("no absent shop is silently replaced with operator cafe growth", () => {
  expect(() => d.grow()).toThrow(/gated/); expect(d.snapshot().rooms).toHaveLength(2);
});
test("removing the powered panel at the outcome boundary cannot satisfy the repair goal", () => {
  const goals = d.actors.map(a => getRelationTargets(d.sim.world, a, HasGoal).find(g => Goal.description[g].startsWith("Restore the apartment"))!);
  readyToInstall(); act("install Amber cartridge");
  const panel = id("lighting-panel");
  const unsubscribe = subscribeCommittedEvents(d.sim.world, event => {
    if (event.status === "succeeded" && d.blackout!.component.powered[panel]) addComponent(d.sim.world, panel, Removed);
  });
  act("power_on"); unsubscribe();
  expect(power()).toBe("off"); expect(d.blackout!.component.powered[panel]).toBe(false);
  expect(goals.map(g => Goal.status[g])).toEqual(["active", "active"]);
});
test("derivation never overwrites a replacement panel lifetime", () => {
  const panel = id("lighting-panel"); WorkingMemoryIdentity.id[panel] = "a-new-panel-lifetime";
  d.blackout!.component.powered[panel] = true;
  d.blackout!.derive(); expect(d.blackout!.component.powered[panel]).toBe(true);
  expect(d.blackout!.view()).toMatchObject({ power: "off", complete: false, phase: "unavailable" });
});
