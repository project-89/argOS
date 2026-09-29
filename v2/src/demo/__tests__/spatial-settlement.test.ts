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
    settlementWork: { graphs, planner: () => async () => { asked++; return []; }, jev: false } });
  await d.start();
  for (let i = 0; i < 36_000 && !(d.recipes!.builtCount().workshop >= 1); i++) { d.advance(100); await new Promise(r => setImmediate(r)); }
  const w = d.sim.world;
  const stall = [...d.settlementKinds].find(([, k]) => k === "stall")![0];
  const stock = listDirectContents(w, stall).map(e => d!.settlementKinds.get(e));
  expect(stock).toContain("raw-fish");
  expect(new Set(stock).size).toBeGreaterThanOrEqual(3);
  expect(d.recipes!.builtCount().workshop).toBe(1);
  expect(d.tradeLives.some(l => l.stats.skillRuns > 5)).toBe(true);
  expect(d.recipes!.coinsOf(d.actors.find(a => Name.value[a] === "Otis")!)).toBeGreaterThan(12); // he sold fish
  void asked; // gaps the headless training did not cover ask a (here empty) planner; nothing is invented
}, 180_000);

test("autopilot: spoken to, a fisher looks up (habit pauses, only his mind may think), then carries out what he chose to do", async () => {
  const { runSettlementLife } = await import("../../learning/settlement/run-settlement");
  const { SkillGraph } = await import("../../learning/skill-graph");
  const { configureDecisionLeaves } = await import("../../cognition/decision-leaves");
  const { foregroundAllowed, backgroundAllowed } = await import("../../runtime/attention");
  const graphs = new Map<string, InstanceType<typeof SkillGraph>>();
  await runSettlementLife({ days: 1, life: 1, graphs, planner: "manual" });
  d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 3600,
    settlementWork: { graphs, jev: false } });
  const w = d.sim.world;
  const asked: string[] = [];
  configureDecisionLeaves(w, { generate: async ({ prompt }) => {
    asked.push(prompt);
    if (prompt.includes('"choice"')) { const m = prompt.match(/(\d+)\. bring raw-fish to Leon/); return { text: `{"choice": ${m ? m[1] : 0}}` }; }
    return { text: '{"yes": false}' }; // glances: carry on
  } });
  w.meta.aiEnabled = true; // a mind to hand the floor to (its model calls are mocked away here)
  await d.start();
  const step = async (n: number) => { for (let i = 0; i < n; i++) { d!.advance(100); await new Promise(r => setImmediate(r)); } };
  const otis = d.actors.find(a => Name.value[a] === "Otis")!, leon = d.actors.find(a => Name.value[a] === "Leon")!, eli = d.actors.find(a => Name.value[a] === "Eli")!;
  const fish = (eid: number) => listDirectContents(w, eid).filter(e => d!.settlementKinds.get(e) === "raw-fish").length;
  // On autopilot nobody's mind runs.
  expect(foregroundAllowed(w, otis)).toBe(false);
  await step(3000); // five minutes of work
  expect(fish(otis) + d.recipes!.coinsOf(otis)).toBeGreaterThan(12);
  // Leon speaks to Otis; they both fish the Shingle.
  const { setLocatedIn } = await import("../../ecs/location");
  const { Position } = await import("../../ecs/components");
  const { getRoomForEntity } = await import("../../ecs/location");
  setLocatedIn(w, leon, getRoomForEntity(w, otis)!); Position.x[leon] = Position.x[otis] + 2; Position.y[leon] = Position.y[otis];
  executeActions(w, [{ eid: leon, action: { type: "speak", target: "Otis", content: "Otis — the ones you pulled this morning, did any look wrong to you?" } as any }], d.sim.god.systemRegistry);
  for (let i = 0; i < 200 && !d.autopilot!.holds(otis); i++) await step(1);
  expect(d.autopilot!.holds(otis)).toBe(true);
  expect(foregroundAllowed(w, otis)).toBe(true);    // his mind has the floor
  expect(foregroundAllowed(w, eli)).toBe(false);    // Eli's does not
  expect(d.autopilot!.log.some(l => l.who === "Otis" && /looks up: Leon says/.test(l.what))).toBe(true);
  // Quiet again: he hands the floor back with an errand, and the habit carries it out.
  const leonFish = fish(leon);
  for (let i = 0; i < 4000 && fish(leon) <= leonFish; i++) await step(1);
  expect(d.autopilot!.log.some(l => l.who === "Otis" && /means to bring raw-fish to Leon/.test(l.what))).toBe(true);
  expect(fish(leon)).toBeGreaterThan(leonFish);
  expect(d.autopilot!.holds(otis)).toBe(false);
}, 180_000);

test("night: residents walk to their tents at bedtime, sleep till dawn, and the world reports its daylight", async () => {
  const { runSettlementLife } = await import("../../learning/settlement/run-settlement");
  const { SkillGraph } = await import("../../learning/skill-graph");
  const { getWorkingMemory } = await import("../../cognition/working-memory");
  const previous = process.env.ARGOS_SETTLEMENT_DAY_MINUTES;
  process.env.ARGOS_SETTLEMENT_DAY_MINUTES = "6"; // a game day in six minutes: night at 4 min, dawn at 6
  try {
    const graphs = new Map<string, InstanceType<typeof SkillGraph>>();
    await runSettlementLife({ days: 1, life: 1, graphs, planner: "manual" });
    d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 3600,
      settlementWork: { graphs, jev: false } });
    await d.start();
    const w = d.sim.world;
    const step = async (n: number) => { for (let i = 0; i < n; i++) { d!.advance(100); await new Promise(r => setImmediate(r)); } };
    expect(d.snapshot().scenario).toMatchObject({ theme: "lovecraft", phase: "the drowned town" });
    expect((d.snapshot().scenario as any).daylight).toBeGreaterThan(0);
    await step(2700); // 22:15
    expect(d.settlementNight()).toBe(true);
    expect((d.snapshot().scenario as any).daylight).toBe(0);
    await step(600);
    const noor = d.actors.find(a => Name.value[a] === "Noor")!;
    const { getRoomForEntity } = await import("../../ecs/location");
    expect(Name.value[getRoomForEntity(w, noor)!]).toBe("Saltmere Common");
    await step(700); // past dawn
    expect(d.settlementNight()).toBe(false);
    const slept = d.actors.filter(a => getWorkingMemory(w, a).receipts.some(r => /slept till dawn in your tent/.test(r.summary)));
    expect(slept.length).toBeGreaterThanOrEqual(6);
    expect(d.recipes!.restOf(slept[0])).toBe(.8); // a tent: a little slower today
  } finally { if (previous === undefined) delete process.env.ARGOS_SETTLEMENT_DAY_MINUTES; else process.env.ARGOS_SETTLEMENT_DAY_MINUTES = previous; }
}, 180_000);

test("the balance spirits watch the walkable town: each dawn a reading, the daily share paid, the land growing back", async () => {
  const { runSettlementLife } = await import("../../learning/settlement/run-settlement");
  const { SkillGraph } = await import("../../learning/skill-graph");
  const previous = process.env.ARGOS_SETTLEMENT_DAY_MINUTES;
  process.env.ARGOS_SETTLEMENT_DAY_MINUTES = "4";
  try {
    const graphs = new Map<string, InstanceType<typeof SkillGraph>>();
    await runSettlementLife({ days: 1, life: 1, graphs, planner: "manual" });
    d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 3600,
      settlementWork: { graphs, jev: false } });
    await d.start();
    const otis = d.actors.find(a => Name.value[a] === "Otis")!;
    const step = async (n: number) => { for (let i = 0; i < n; i++) { d!.advance(100); await new Promise(r => setImmediate(r)); } };
    await step(2500); // past the first game dawn (4 real minutes)
    const readings = d.settlementBalance!.interventions().filter(i => i.spirit === "Watcher");
    expect(readings.length).toBeGreaterThanOrEqual(1);
    expect(readings[0].what).toMatch(/ate \d+% of need/);
    expect(d.settlementBalance!.spirits.readings[0].idleByTrade).toHaveProperty("fisher");
    expect(d.recipes!.tally.made["raw-fish"] ?? 0).toBeGreaterThan(0);
    void otis;
  } finally { if (previous === undefined) delete process.env.ARGOS_SETTLEMENT_DAY_MINUTES; else process.env.ARGOS_SETTLEMENT_DAY_MINUTES = previous; }
}, 180_000);
