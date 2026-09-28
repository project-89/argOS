import { jest } from "@jest/globals";
import { SpatialDemo } from "../spatial-demo";
import { getDirectContainer, getRoomForEntity } from "../../ecs/location";
import { getAgentVisualEntities, getAgentWorldCapabilities } from "../../cognition/world-capabilities";
import { getWorkingMemory } from "../../cognition/working-memory";
import { Memory, Perception, WorkingMemoryIdentity } from "../../ecs/components";
import { getAgentPerceptions } from "../../cognition/agent-mind";
import { getAgentMemories } from "../../cognition/knowledge-graph";

let demo: SpatialDemo;
beforeEach(async () => {
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Extended physics tests are offline"));
  demo = await SpatialDemo.create({ live: false, automaticClock: false, scenario: "blackout", layout: "extended", requiredSpec: "B" });
  await demo.start();
});
afterEach(() => { demo?.stop(); expect(globalThis.fetch).not.toHaveBeenCalled(); jest.restoreAllMocks(); });
const id = (name: string) => demo.byId.get(name)!;
const mara = () => demo.snapshot().actors.find(a => a.name === "Mara")!;
function act(type: string, target: string, content?: string, time = 20000) {
  demo.dispatch(mara().key, type, WorkingMemoryIdentity.id[id(target)], content); demo.advance(time);
}

test("remote diagnosis/stock stay private until actual travel and opening; carried part powers the distant lamp", async () => {
  expect(demo.snapshot().rooms.map(r => r.name)).toEqual(["Apartment", "Utility room", "Storeroom"]);
  const visible = () => getAgentVisualEntities(demo.sim.world, mara().id);
  expect(visible()).not.toContain(id("lighting-panel")); expect(visible()).not.toContain(id("supply-box"));
  act("observe", "lighting-panel", undefined, 100);
  expect(JSON.stringify(getWorkingMemory(demo.sim.world, mara().id).receipts)).not.toMatch(/specification B/);
  act("move", "utility"); expect(getRoomForEntity(demo.sim.world, mara().id)).toBe(id("utility"));
  act("observe", "lighting-panel");
  expect(getAgentMemories(demo.sim.world, mara().id).map(id => Memory.content[id]).join("\n")).toMatch(/specification B/);
  act("interact", "lighting-panel", "isolate");
  act("move", "storeroom"); expect(getRoomForEntity(demo.sim.world, mara().id)).toBe(id("storeroom"));
  expect(visible()).not.toContain(id("blue-cartridge"));
  act("interact", "supply-box", "open"); expect(visible()).toContain(id("blue-cartridge"));
  act("pickup", "blue-cartridge"); expect(getDirectContainer(demo.sim.world, id("blue-cartridge"))).toBe(mara().id);
  act("move", "utility"); act("interact", "lighting-panel", "install Blue cartridge");
  expect(getDirectContainer(demo.sim.world, id("blue-cartridge"))).toBe(id("lighting-panel"));
  expect(demo.snapshot().scenario!.power).toBe("off");
  act("interact", "lighting-panel", "power_on"); expect(demo.snapshot().scenario!.power).toBe("on");
  const observations = (actor: number) => getAgentPerceptions(demo.sim.world, actor)
    .filter(p => Perception.type[p] === "attention").map(p => ({ source: Perception.source[p], content: Perception.content[p] }));
  const ivo = demo.snapshot().actors.find(a => a.name === "Ivo")!;
  expect(observations(ivo.id)).toContainEqual({ source: "Reading lamp", content: "The reading lamp lights up." });
  expect(observations(mara().id)).toContainEqual({ source: "Lighting panel", content: "The lighting panel's isolation switch clicks into the connected position." });
  expect(observations(ivo.id).some(p => p.source === "Lighting panel")).toBe(false);
  expect(observations(mara().id).some(p => p.content === "The reading lamp lights up.")).toBe(false);
  expect(getAgentWorldCapabilities(demo.sim.world, mara().id)!.observableState!(id("lighting-panel")))
    .toContainEqual({ key: "energized", type: "boolean", value: true });
  act("move", "apartment"); expect(getRoomForEntity(demo.sim.world, mara().id)).toBe(id("apartment"));
  expect((await demo.worldCommand("turn the light back off")).status).toBe("applied");
  expect(demo.snapshot().scenario!.power).toBe("off");
  expect(getDirectContainer(demo.sim.world, id("blue-cartridge"))).toBe(id("lighting-panel"));
  act("move", "utility"); act("interact", "lighting-panel", "power_on");
  expect(demo.snapshot().scenario!.power).toBe("on");
  expect(() => demo.grow()).toThrow(/gated/);
});

test("operator lid change invalidates pickup while preserving the real hidden cartridge", async () => {
  act("move", "storeroom"); act("interact", "supply-box", "open");
  act("pickup", "blue-cartridge", undefined, 100);
  expect(mara().action).toBeDefined();
  const receipt = await demo.worldCommand("close the supplies box"); expect(receipt.status).toBe("applied");
  demo.advance(5000);
  expect(getDirectContainer(demo.sim.world, id("blue-cartridge"))).toBe(id("supply-box"));
  expect(demo.snapshot().scenario!.power).toBe("off");
  expect(demo.snapshot().events.filter(e => e.kind === "failed").map(e => e.text)).toEqual(expect.arrayContaining([expect.stringMatching(/execution_invalidated/)]));
});
