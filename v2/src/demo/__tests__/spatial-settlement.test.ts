import { jest } from "@jest/globals";
const ai = await import("ai");
jest.unstable_mockModule("ai", () => ({ ...ai, generateText: jest.fn() }));
const { SpatialDemo } = await import("../spatial-demo");
const { createSettlementScenario } = await import("../spatial-settlement");
const { validateSpatialScenario } = await import("../spatial-scenario");
const { Goal, Name, Needs } = await import("../../ecs/components");
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

test("resuming a house walks past the parts already standing (no surprise), and the next part still needs its materials", async () => {
  d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, settlementWork: { graphs: new Map(), jev: false } });
  await d.start();
  const ivo = d.actors.find(a => Name.value[a] === "Ivo")!, recipes = d.recipes!;
  const plot = [...(d as any).settlementKinds].find(([, k]: [number, string]) => k === "house-plot")[0] as number;
  const house = d.settlementLand.structures.find(s => s.kind === "house")!;
  // The foundation went up before the drama pulled him away.
  expect(recipes.commit({ actor: ivo, actorKey: "", target: plot, targetKey: "", verb: "build", argument: "foundation", gives: {}, took: [], tools: [],
    build: { structure: house, part: house.parts[0].part } }).success).toBe(true);
  // A learned house ensures its parts: the standing foundation counts, as it does in the headless town.
  const env = (d.tradeLives.find(l => l.eid === ivo) as any).env;
  expect(env.have()[`house.${house.parts[0].part}`]).toBe(1);
  expect(recipes.progress()).toEqual({ [`house.${house.parts[0].part}`]: 1 });
  const again = recipes.prepare(ivo, plot, "build", house.parts[0].part);
  expect(again.ok).toBe(true);
  if (again.ok) expect(recipes.commit(again.operation)).toEqual({ success: true, detail: `The ${house.parts[0].part} already stands.` });
  // Hands full: a gathering act does not start (never a made thing with nowhere to go).
  const { Inventory } = await import("../../ecs/components");
  const bramble = [...(d as any).settlementKinds].find(([, k]: [number, string]) => k === "bramble")[0] as number;
  const slots = Inventory.maxSlots[ivo]; Inventory.maxSlots[ivo] = 0;
  const full = recipes.prepare(ivo, bramble, "pick", "berries");
  Inventory.maxSlots[ivo] = slots;
  expect(full).toEqual({ ok: false, reason: "Your hands are full — sell or set something down first." });
  const next = recipes.prepare(ivo, plot, "build", house.parts[1].part);
  expect(next.ok).toBe(false);
  if (!next.ok) expect(next.reason).toMatch(new RegExp(`The ${house.parts[1].part} needs`));
});

test("a failed act's words: short of something (and how many), or scarce — never a surprise about how the world works", async () => {
  const { readFailure } = await import("../spatial-trade-life");
  expect(readFailure("The frame needs 4 more planks.")).toEqual({ missing: { kind: "planks", count: 4 } });
  expect(readFailure("You hold no firewood.")).toEqual({ missing: { kind: "firewood", count: 1 } });
  expect(readFailure("Birch 1 is spent for now.")).toEqual({ scarce: true });
  expect(readFailure("You can't chop here.")).toEqual({});
  expect(readFailure("Your hands are full — sell or set something down first.")).toEqual({ scarce: true });
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

test("a conversation's resolve outlives it: goals on the menu, errands for the habit, the rest wakes the mind; supper gathers at the fire", async () => {
  const { runSettlementLife } = await import("../../learning/settlement/run-settlement");
  const { SkillGraph } = await import("../../learning/skill-graph");
  const { createIntentGoal } = await import("../../cognition/cognition-system");
  const { getRoomForEntity } = await import("../../ecs/location");
  const previous = process.env.ARGOS_SETTLEMENT_DAY_MINUTES;
  process.env.ARGOS_SETTLEMENT_DAY_MINUTES = "6";
  try {
    const graphs = new Map<string, InstanceType<typeof SkillGraph>>();
    await runSettlementLife({ days: 1, life: 1, graphs, planner: "manual" });
    d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 3600,
      settlementWork: { graphs, jev: false } });
    const w = d.sim.world;
    w.meta.aiEnabled = true;
    await d.start();
    const otis = d.actors.find(a => Name.value[a] === "Otis")!;
    const life: any = d.tradeLives.find(l => l.eid === otis);
    const fetch = createIntentGoal(w, otis, "Bring some raw fish to Leon before dark", 8)!;
    const mystery = createIntentGoal(w, otis, "Find out who forced the Net House box before Mara does", 9)!;
    const labels = life.menu().map((m: any) => m.label);
    expect(labels).toEqual(expect.arrayContaining([expect.stringMatching(/^pursue: Find out who forced/), expect.stringMatching(/^pursue: Bring some raw fish to Leon/)]));
    await life.pursue({ id: fetch, description: "Bring some raw fish to Leon before dark" });
    expect(life.errands).toEqual([{ kind: "bring", item: "raw-fish", to: "Leon" }]);
    await life.pursue({ id: mystery, description: "Find out who forced the Net House box before Mara does" });
    expect(d.autopilot!.holds(otis)).toBe(true);
    expect(d.autopilot!.log.at(-1)?.what).toMatch(/looks up: You set out to Find out who forced the Net House box/);
    // Holding the floor is not idleness (the spirits must not read a day of talk as a trade without work).
    const idleBefore = life.idleMs;
    void life.wait(60_000); // how the habit waits while the mind holds the floor, at supper, at rest
    expect(life.idleMs).toBe(idleBefore);
    void life.wait(1_000, true); // only nothing-to-do counts
    expect(life.idleMs).toBe(idleBefore + 1_000);
    // A thread set aside for review stays on the menu; pursuing it is taking it up again (retained, not claimed done).
    const { createGeneratedIntention, requestIntentionReconsideration } = await import("../../cognition/goal-lifecycle");
    const thread = createGeneratedIntention(w, otis, { description: "Learn what Harlan Pryce wrote to Leon", priority: 7, kind: "social" }, "foreground")!;
    expect(requestIntentionReconsideration(w, otis, thread, "Reached its review boundary.")).toBe(true);
    expect(life.menu().map((m: any) => m.label)).toEqual(expect.arrayContaining(["pursue: Learn what Harlan Pryce wrote to Leon"]));
    await life.pursue({ id: thread, description: "Learn what Harlan Pryce wrote to Leon", paused: true });
    expect(Goal.status[thread]).toBe("active");
    // His work broken off while the mind has the floor is not a failure: no cooldown, he takes it up again after.
    expect(d.autopilot!.holds(otis)).toBe(true);
    life.cooldown.clear();
    expect(await life.work()).toBe(false);
    expect([...life.cooldown.keys()].filter((k: string) => k.startsWith("duty:"))).toEqual([]);
    (d.autopilot as any).floors.delete(otis);
    // A livelihood presses: hours without turning a hand to the trade send them back to it before any choice.
    life.cooldown.clear(); // his own loop may have just tried and failed (no model offline)
    life.lastWorkAt = d.atSimMs - (d as any).settlementDayMs; // a day ago
    expect(life.workDue()).toBe(true);
    life.lastWorkAt = d.atSimMs;
    expect(life.workDue()).toBe(false);
    // Having set the talk aside, the menu is the day's work and needs — no pursuits, no talk.
    (d.autopilot as any).setAside.set(otis, d.atSimMs + 60_000);
    expect(life.menu().map((m: any) => m.label).some((l: string) => /^(pursue|talk|look into|hide|tell|confront)/.test(l))).toBe(false);
    (d.autopilot as any).setAside.delete(otis);
    // Supper: evening gathers people at the campfire on the Common — a habit, even under a judge that only ever picks rest.
    for (const l of d.tradeLives as any[]) l.chooser = async (_eid: number, menu: string[]) => menu.length - 1;
    const step = async (n: number) => { for (let i = 0; i < n; i++) { d!.advance(100); await new Promise(r => setImmediate(r)); } };
    await step(2250); // ~20:40 on a six-minute day (walking takes real time)
    expect(d.settlementHour()).toBeGreaterThan(18);
    const atCommon = d.actors.filter(a => Name.value[getRoomForEntity(w, a)!] === "Saltmere Common");
    expect(atCommon.length).toBeGreaterThanOrEqual(6);
  } finally { if (previous === undefined) delete process.env.ARGOS_SETTLEMENT_DAY_MINUTES; else process.env.ARGOS_SETTLEMENT_DAY_MINUTES = previous; }
}, 180_000);

test("routine choices become habits: after the judge keeps choosing the same and agrees it is settled, the habit chooses without asking; drama always asks", async () => {
  const { JevClient } = await import("../../llm/jev");
  const asked: any[] = [];
  const fakeFetch = async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body);
    // Only this test's own choices are counted (residents' loops, appraisals and triage use the judge too).
    if (!body.questions.next || !(body.questions.next.criteria as Record<string, string>)["o0"]?.startsWith("make raw fish") || body.state?.character?.name !== "Otis")
      return new Response(JSON.stringify({ model: "jev", answers: {} }), { status: 200 });
    asked.push(body.questions);
    const rest = Object.entries(body.questions.next.criteria as Record<string, string>).find(([, v]) => v === "rest a while")![0];
    return new Response(JSON.stringify({ model: "jev", answers: { next: { type: "choice", choice: rest }, ...(body.questions.settled ? { settled: { type: "noul", noul: .9 } } : {}) } }), { status: 200 });
  };
  const jev = new JevClient({ apiKey: "test", fetch: fakeFetch as typeof fetch });
  d = await SpatialDemo.create({ scenario: "town", story: "settlement", evolving: true, live: false, automaticClock: false, seconds: 600,
    settlementWork: { graphs: new Map(), jev } });
  await d.start();
  const otis = d.actors.find(a => Name.value[a] === "Otis")!;
  const menu = ["make raw fish for the stall", "sell what I've made at the stall", "rest a while"];
  const choose = (m: string[]) => (d as any).chooseByHabitOrJev(jev, otis, m) as Promise<number | undefined>;
  for (let i = 0; i < 3; i++) expect(await choose(menu)).toBe(2);
  expect(asked.map(q => !!q.settled)).toEqual([false, false, false]);
  expect(await choose(menu)).toBe(2); // a candidate now: the judge is asked whether it is settled, in the same call
  expect(asked[3].settled).toBeDefined();
  expect(Object.values(d.habits!.of("Otis"))).toEqual(["rest"]);
  const before = asked.length;
  expect(await choose(menu)).toBe(2); // by habit: no call
  expect(asked.length).toBe(before);
  // Something on his mind: never by habit.
  expect(await choose([...menu, "pursue: Find out who forced the Net House box"])).toBe(2);
  expect(asked.length).toBe(before + 1);
});
