import { OilDemo, OIL_THOUGHT, type OilObservation, type OilChoice } from "../oil-demo";
import { projectOilScene } from "../oil-projection";
import { entityExists } from "bitecs";
import { serializeWorld } from "../../persistence/world-persistence";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const policy = (o: OilObservation): OilChoice => {
  if (o.rememberedOil === "missing") return { action: "speak", thought: "My memory no longer matches the shelf.", speech: "The shelf is empty. Where did the oil go?" };
  if (o.location === "Beacon room") return { action: o.rememberedOil === "carried" ? "refuel" : "go_kitchen", thought: "Keep the light burning." };
  if (o.rememberedOil === "carried") return { action: "go_beacon", thought: "I have what I need." };
  return { action: o.observation.includes("within reach") ? "take_oil" : "inspect_shelf", thought: "Check what is here." };
};

test("an offscreen deletion changes the world, not Mara's knowledge; inspection discovers it", async () => {
  const seen: OilObservation[] = [];
  const demo = await OilDemo.create(async o => { seen.push(o); return policy(o); });
  try {
    demo.start(); demo.injectThought(OIL_THOUGHT); demo.advance(1000); await flush();
    expect(demo.snapshot().phase).toBe("walking");
    const before = demo.observe();
    demo.removeOil();
    expect(demo.snapshot()).toMatchObject({ divergence: true, world: { oil: "removed", beacon: "dark" }, mara: { oilBelief: "kitchen_shelf" } });
    expect(demo.observe()).toEqual(before);
    demo.talk("How is it going?"); // Allocates memories/perceptions after deletion: recycled EIDs cannot resurrect the can.
    expect(demo.snapshot().world.oil).toBe("removed");
    demo.advance(18000); await flush();
    expect(demo.snapshot()).toMatchObject({ location: "Kitchen", phase: "searching", mara: { oilBelief: "kitchen_shelf" } });
    expect(seen.at(-1)?.observation).not.toContain("empty");
    demo.advance(4000); await flush();
    expect(demo.snapshot()).toMatchObject({ phase: "discovered", divergence: false, world: { beacon: "dark" }, mara: { oilBelief: "missing" } });
    expect(demo.snapshot().mara.speech).toContain("empty");
    const saved = serializeWorld(demo.sim.world, demo.sim.god.systemRegistry);
    expect(saved.entities.some(e => e.name === "Red oil can")).toBe(false);
    expect(saved.entities.some(e => e.components.Belief?.object === "missing")).toBe(true);
  } finally { demo.stop(); }
});

test("without interference she finds, carries and consumes the real oil to light the beacon", async () => {
  const demo = await OilDemo.create(async o => policy(o));
  try {
    demo.start(); demo.injectThought(OIL_THOUGHT); demo.advance(1000); await flush();
    demo.advance(18000); await flush();
    demo.advance(4000); await flush();
    expect(demo.snapshot().world.oil).toBe("carried");
    demo.advance(2000); await flush();
    expect(demo.snapshot().destination).toBe("Beacon room");
    demo.advance(18000); await flush();
    expect(demo.snapshot()).toMatchObject({ world: { oil: "used", beacon: "lit" }, mara: { goalStatus: "completed" } });
  } finally { demo.stop(); }
});

test("failed remote pickup/refuel cannot manufacture success", async () => {
  const demo = await OilDemo.create(async () => ({ action: "wait", thought: "Waiting." }));
  try {
    demo.start();
    demo.applyChoice({ action: "take_oil", thought: "Try reaching the kitchen remotely." });
    demo.applyChoice({ action: "refuel", thought: "Try without oil." });
    expect(demo.snapshot().world).toEqual({ oil: "on_shelf", beacon: "dark" });
    expect(demo.snapshot().receipts.filter(r => r.kind === "action_failed")).toHaveLength(2);
    expect(() => demo.removeOil()).toThrow("on her way");
  } finally { demo.stop(); }
});

test("stopping aborts cognition and discards a late model response", async () => {
  let finish!: (c: OilChoice) => void;
  let signal!: AbortSignal;
  const demo = await OilDemo.create(async (_o, s) => { signal = s; return new Promise(resolve => { finish = resolve; }); });
  demo.start(); demo.injectThought(OIL_THOUGHT); demo.advance(1000);
  demo.stop();
  expect(signal.aborted).toBe(true);
  finish({ action: "go_kitchen", thought: "Too late." }); await flush();
  expect(demo.snapshot().location).toBe("Beacon room");
  expect(entityExists(demo.sim.world, demo.ids.mara)).toBe(true);
});

test("the video prompt excludes private thoughts and explicitly grounds absence", async () => {
  const demo = await OilDemo.create(async o => policy(o));
  try {
    demo.start(); demo.injectThought("PRIVATE MEMORY"); demo.advance(1000); await flush();
    demo.removeOil(); demo.advance(18000); await flush(); demo.advance(4000); await flush();
    const prompt = projectOilScene(demo.snapshot());
    expect(prompt).not.toContain("PRIVATE MEMORY");
    expect(prompt).toContain("shelf is EMPTY");
    expect(prompt).toContain("Confirmed spoken line");
  } finally { demo.stop(); }
});

test("world edits move objects and leave notes without silently updating distant knowledge", async () => {
  const demo = await OilDemo.create(async o => policy(o));
  try {
    demo.start(); demo.injectThought(OIL_THOUGHT); demo.advance(1000); await flush();
    const before = demo.observe();
    expect(demo.editWorld({ op: "move", name: "Red oil can", destination: "Beacon room" }).witnessedByMara).toBe(false);
    demo.editWorld({ op: "create", name: "Folded note", kind: "object", location: "Kitchen shelf", description: "I borrowed it. — N." });
    expect(demo.observe()).toEqual(before);
    expect(demo.snapshot().world.oil).toBe("elsewhere");
    demo.advance(18000); await flush(); demo.advance(4000); await flush();
    expect(demo.observe().observation).toContain("I borrowed it");
    expect(demo.observe().observation).not.toContain("It is empty");
    expect(demo.snapshot().mara.oilBelief).toBe("missing");
    expect(() => demo.editWorld({ op: "move", name: "Folded note", destination: "Folded note" })).toThrow("cycles");
    expect(() => demo.editWorld({ op: "set", name: "Mara", component: "Mind", field: "focus", value: "omniscient" })).toThrow("protected");
  } finally { demo.stop(); }
});

test("blocked stairs actually halt movement; typed generated components are real ECS data", async () => {
  const demo = await OilDemo.create(async o => o.location === "Spiral stairs" ? { action: "wait", thought: "The route is blocked." } : policy(o));
  try {
    demo.start(); demo.injectThought(OIL_THOUGHT); demo.advance(1000); await flush();
    demo.editWorld({ op: "set", name: "Spiral stairs", component: "ObjectState", field: "current", value: "blocked" });
    demo.advance(30000); await flush();
    expect(demo.snapshot()).toMatchObject({ location: "Spiral stairs", progress: 0, pathBlocked: true });
    demo.editWorld({ op: "set", name: "Spiral stairs", component: "ObjectState", field: "current", value: "normal" });
    demo.advance(18000); await flush();
    expect(demo.snapshot().location).toBe("Kitchen");
    demo.editWorld({ op: "declare", component: "DemoTemperature", description: "Degrees Celsius", fields: { celsius: "number" } });
    demo.editWorld({ op: "set", name: "Kitchen", component: "DemoTemperature", field: "celsius", value: -3 });
    const saved = serializeWorld(demo.sim.world, demo.sim.god.systemRegistry);
    expect(saved.entities.find(e => e.name === "Kitchen")?.components.DemoTemperature).toEqual({ celsius: -3 });
    expect(saved.componentDefinitions?.some(d => d.name === "DemoTemperature")).toBe(true);
  } finally { demo.stop(); }
});
