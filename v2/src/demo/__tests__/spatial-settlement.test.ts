import { jest } from "@jest/globals";
const ai = await import("ai");
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: jest.fn() }));
const { SpatialDemo } = await import("../spatial-demo");
const { createSettlementScenario } = await import("../spatial-settlement");
const { validateSpatialScenario } = await import("../spatial-scenario");
const { Name, Needs } = await import("../../ecs/components");
const { executeActions } = await import("../../cognition/cognition-system");
const { listDirectContents } = await import("../../ecs/location");
const { isSimulationResourceBusy } = await import("../../runtime/simulation-timeline");

let d: Awaited<ReturnType<typeof SpatialDemo.create>> | undefined;
beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); jest.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline")); });
afterEach(() => { d?.stop(); d = undefined; jest.restoreAllMocks(); });

test("the settlement is a big outdoor world on 1 m cells, with the Saltmere cast in tents and trades", () => {
  const s = validateSpatialScenario(createSettlementScenario());
  expect(s.navigationCellSize).toBe(1);
  expect(s.bounds).toEqual({ minX: 0, minY: 0, maxX: 140, maxY: 110 });
  expect(s.blueprint.rooms.map(r => r.name)).toEqual(expect.arrayContaining(["Saltmere Common", "Birch Wood", "The Shingle", "Flax Field", "Well Spring", "Old Quarry", "The Net House"]));
  expect(s.blueprint.props.filter(p => p.assetId === "tent")).toHaveLength(10);
  expect(s.residents.find(r => r.name === "Otis")!.role).toMatch(/fisher$/);
  expect(s.residents.every(r => r.homeRoomId === undefined)).toBe(true);
});

test("walk, fetch an axe, chop, split and sell — timed in the walkable world, goods appearing in hand", async () => {
  d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false });
  await d.start();
  const w = d.sim.world, eli = d.actors.find(a => Name.value[a] === "Eli")!;
  const hand = () => listDirectContents(w, eli).map(e => Name.value[e]);
  const act = (action: any) => {
    executeActions(w, [{ eid: eli, action }], d!.sim.god.systemRegistry);
    let i = 0; do { d!.advance(100); i++; } while (i < 3000 && isSimulationResourceBusy(w, eli, "body"));
    for (let k = 0; k < 20; k++) d!.advance(100);
    return i / 10;
  };
  // A woodcutter starts with an axe; the spare axes lie on the Common.
  expect(hand()).toEqual([expect.stringMatching(/^Axe \d+$/)]);
  const seconds = act({ type: "interact", target: "Birch 1", content: "chop" });
  expect(seconds).toBeGreaterThanOrEqual(30);
  const log = hand().find(n => n.startsWith("Log"))!;
  expect(log).toBeDefined();
  act({ type: "move", target: "Saltmere Common" });
  act({ type: "interact", target: "Chopping stump", content: "split" });
  expect(hand().filter(n => n.startsWith("Firewood"))).toHaveLength(4);
  expect(hand()).not.toContain(log);
  act({ type: "interact", target: "Market stall", content: "sell firewood" });
  expect(hand().filter(n => n.startsWith("Firewood"))).toHaveLength(3);
  expect(d.recipes!.coinsOf(eli)).toBe(11);
  // Without the right tool, the craft says what is missing.
  const tess = d.actors.find(a => Name.value[a] === "Tess")!;
  executeActions(w, [{ eid: tess, action: { type: "interact", target: "Campfire", content: "cook fish" } as any }], d.sim.god.systemRegistry);
  for (let i = 0; i < 600 && isSimulationResourceBusy(w, tess, "body"); i++) d.advance(100);
  const { getWorkingMemory } = await import("../../cognition/working-memory");
  expect(getWorkingMemory(w, tess).receipts.filter(r => r.kind === "action").at(-1)?.summary).toMatch(/you need 3 more raw-fish/);
  void Needs;
}, 60_000);

test("trades trained headless carry into the walkable world: the town stocks its stall and raises a workshop with no model", async () => {
  const { runSettlementLife } = await import("../../learning/settlement/run-settlement");
  const { SkillGraph } = await import("../../learning/skill-graph");
  const graphs = new Map<string, InstanceType<typeof SkillGraph>>();
  await runSettlementLife({ days: 2, life: 1, graphs, planner: "manual" });
  let asked = 0;
  d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 3600,
    settlementWork: { graphs, planner: () => async () => { asked++; return []; } } });
  await d.start();
  for (let i = 0; i < 36_000 && !(d.recipes!.builtCount().workshop >= 1); i++) { d.advance(100); await new Promise(r => setImmediate(r)); }
  const w = d.sim.world;
  const stall = [...d.settlementKinds].find(([, k]) => k === "stall")![0];
  const stock = listDirectContents(w, stall).map(e => d!.settlementKinds.get(e));
  expect(stock).toEqual(expect.arrayContaining(["raw-fish", "firewood"]));
  expect(d.recipes!.builtCount().workshop).toBe(1);
  expect(d.tradeLives.some(l => l.stats.skillRuns > 5)).toBe(true);
  expect(d.recipes!.coinsOf(d.actors.find(a => Name.value[a] === "Otis")!)).toBeGreaterThan(12); // he sold fish
  void asked; // gaps the headless training did not cover ask a (here empty) planner; nothing is invented
}, 180_000);
