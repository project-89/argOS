import { jest } from "@jest/globals";
import { Settlement } from "../settlement/settlement";
import { SALTMERE_LAND } from "../settlement/saltmere-land";
import { runSettlementLife } from "../settlement/run-settlement";
import { SkillGraph } from "../skill-graph";
import { BalanceSpirits, type Reading } from "../settlement/balance-spirits";

const towns: Settlement[] = [];
beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const t of towns.splice(0)) t.stop(); jest.restoreAllMocks(); });
const town = () => { const t = new Settlement(structuredClone(SALTMERE_LAND)); towns.push(t); return t; };
const who = (t: Settlement, name: string) => t.resident(name)!.eid;
/** Run the clock until this act resolves. */
async function run<T>(t: Settlement, p: Promise<T>): Promise<T> {
  let done = false, value!: T;
  p.then(v => { value = v; done = true; });
  for (let i = 0; i < 100 && !done; i++) { await new Promise(r => setImmediate(r)); if (!done) t.advanceTo(t.nextEventAt() ?? t.now + 1); }
  return value;
}

describe("the settlement clock", () => {
  test("acts take time: materials commit at the start, products appear at the end", async () => {
    const t = town(), eli = who(t, "Eli");
    const chop = t.perform(eli, { verb: "chop", target: "Birch 1" });
    expect(t.busy(eli)).toBe(true);
    expect(t.have(eli).log ?? 0).toBe(0);
    t.advanceTo(299);
    expect(t.have(eli).log ?? 0).toBe(0);
    t.advanceTo(300);
    expect(await chop).toMatchObject({ ok: true, used: ["axe"] });
    expect(t.have(eli).log).toBe(1);
  });

  test("hunger and thirst rise with time; a resident who goes without collapses", () => {
    const t = town();
    const quiet = t.alive().map(r => t.wait(r.eid, 400_000));
    void quiet;
    t.advanceTo(3600 * 10);
    const ada = t.resident("Ada")!;
    expect(ada.hunger).toBeGreaterThan(70);
    expect(ada.dead).toBeUndefined();
    t.advanceTo(3600 * 20);
    expect(ada.dead).toBe(true);
    expect(ada.causeOfDeath).toBe("thirst");
  });

  test("tools wear out, the stall trades at a margin, and scarcity is marked as such", async () => {
    const t = town(), otis = who(t, "Otis");
    for (let i = 0; i < 10; i++) expect((await run(t, t.perform(otis, { verb: "catch", target: "Fishing water" }))).ok).toBe(true);
    expect(t.have(otis)).toMatchObject({ "raw-fish": 10, "torn-net": 1 });
    expect(t.have(otis).net ?? 0).toBe(0);
    expect(await run(t, t.perform(otis, { verb: "catch", target: "Fishing water" }))).toMatchObject({ ok: false, missing: { kind: "net", count: 1 } });
    await run(t, t.perform(otis, { verb: "move", target: "Saltmere Common" }));
    const coins = t.resident("Otis")!.coins;
    expect((await run(t, t.perform(otis, { verb: "sell", target: "Market stall", arg: "raw-fish" }))).ok).toBe(true);
    expect(t.resident("Otis")!.coins).toBe(coins + 2); // 3 × 0.75
    const tess = who(t, "Tess");
    expect(await run(t, t.perform(tess, { verb: "buy", target: "Market stall", arg: "cooked-fish" }))).toMatchObject({ ok: false, scarce: true });
  });

  test("a builder claims a plot until the building is finished; a finished house takes people out of tents", async () => {
    const t = town(), ivo = who(t, "Ivo"), mara = who(t, "Mara");
    const give = (kind: string, n: number) => { for (let i = 0; i < n; i++) (t as any).giveItem(ivo, kind); };
    give("stone", 4); give("planks", 14);
    const first = t.perform(ivo, { verb: "build", target: "House plot 1", arg: "foundation" });
    expect(await run(t, t.perform(mara, { verb: "build", target: "House plot 1", arg: "foundation" }))).toMatchObject({ ok: false, scarce: true });
    await run(t, first);
    for (const part of ["frame", "walls", "roof"]) expect((await run(t, t.perform(ivo, { verb: "build", target: "House plot 1", arg: part }))).ok).toBe(true);
    expect(t.builtCount.house).toBe(1);
    const housed = t.residents.filter(r => r.home !== undefined);
    expect(housed).toHaveLength(2);
    expect(t.shelterOf(housed[0])).toEqual({ kind: "house", rest: 1 });
    expect(t.shelterOf(t.resident("Noor")!)).toEqual({ kind: "tent", rest: 0.8 });
  });

  test("night comes: sleep lasts till dawn, needs slow while asleep, and a tent leaves you slower", async () => {
    const t = town(), noor = who(t, "Noor");
    t.advanceTo(16 * 3600); // 22:00
    for (const r of t.residents) { r.hunger = 20; r.thirst = 20; r.starvingSince = undefined; }
    expect(t.isNight()).toBe(true);
    await run(t, t.perform(noor, { verb: "move", target: "Saltmere Common" }));
    const hunger = t.resident("Noor")!.hunger;
    const slept = await run(t, t.perform(noor, { verb: "sleep" }));
    expect(slept.summary).toMatch(/tent/);
    expect(t.isNight()).toBe(false);
    expect(t.resident("Noor")!.hunger - hunger).toBeLessThan(6 * 8 * 0.5);
    expect(t.resident("Noor")!.rest).toBe(0.8);
  });
});

describe("the balance spirits", () => {
  const reading = (over: Partial<Reading>): Reading => ({ day: 2, alive: 10, foodIndex: 1, stockouts: {}, gluts: {}, bought: {}, reserveDays: {}, treasury: 900,
    treasuryRunwayDays: 20, idleByTrade: {}, lacking: {}, ...over });
  const lives = (t: Settlement) => t.residents.map(me => ({ me, changeTrade(trade: string) { me.trade = trade; } })) as any;

  test("the Steward follows the chain: idle fishers lacking nets send hands to the net-mender, and equips them", () => {
    const t = town();
    const spirits = new BalanceSpirits(t, () => lives(t));
    const r = reading({ foodIndex: 0.7, stockouts: { "raw-fish": 4 }, idleByTrade: { fisher: 0.9, woodcutter: 0.95, "net-mender": 0.2 },
      lacking: { fisher: { net: 5 } } });
    expect((spirits as any).shortTrade(r)).toEqual({ trade: "net-mender", why: "fishers stood idle for want of net (5×)" });
    (spirits as any).steward(2, r);
    const moved = spirits.interventions.find(i => i.spirit === "Steward")!;
    expect(moved.what).toMatch(/^(Eli|Sera) leaves woodcutter \(95% idle\) to net-mender/);
  });

  test("the Steward watches the building: nothing went up yesterday, so idle hands go where builders are short, and builders are pressed", () => {
    const t = town();
    const pressed: string[] = [];
    const withPress = () => lives(t).map((l: any) => ({ ...l, press: (why: string) => pressed.push(`${l.me.name}: ${why}`) }));
    const spirits = new BalanceSpirits(t, withPress);
    // Builders idle for want of planks: hands go to the woodcutters; the builders are pressed.
    // (A well-fed town can spare a fisher; a trade is never emptied.)
    const r = reading({ parts: {}, foodIndex: 1.3, idleByTrade: { builder: 0.7, fisher: 0.8, woodcutter: 0.1 }, lacking: { builder: { planks: 3 } } });
    (spirits as any).buildWatch(2, r);
    const notes = spirits.interventions.filter(i => i.spirit === "Steward").map(i => i.what);
    expect(notes[0]).toMatch(/^(Otis|Leon) leaves fisher \(80% idle\) to woodcutter: builders stood idle for want of planks \(3×\)/);
    expect(notes[1]).toMatch(/^no workshop went up yesterday — Ivo and Mara to put building first today$/);
    expect(pressed).toEqual(["Ivo: the town is waiting on the workshop", "Mara: the town is waiting on the workshop"]);
    // A day with a part raised: nothing to do.
    const before = spirits.interventions.length;
    (spirits as any).buildWatch(3, reading({ parts: { workshop: 1 }, idleByTrade: { forager: 0.9 } }));
    expect(spirits.interventions.length).toBe(before);
  });

  test("the Lawgiver prices shortage up and glut down, and never cuts the share below subsistence while people go hungry", async () => {
    const t = town();
    const spirits = new BalanceSpirits(t, () => lives(t));
    t.tally.stockouts.planks = 3; t.tally.gluts.flax = 4;
    t.treasury -= 800; // a steep fall: runway under three days
    t.resident("Ada")!.hunger = 60; t.resident("Ada")!.coins = 0;
    await spirits.dawn(1);
    expect(t.def.prices.planks).toBe(5);
    expect(t.def.prices.flax).toBe(1);
    expect(t.def.dailyShare).toBe(16);
    expect(spirits.interventions.some(i => i.spirit === "Lawgiver" && /share down/.test(i.what))).toBe(false);
  });
});

describe("a settlement that learns to keep itself alive", () => {
  test("offline: everyone survives three days, the town is built, and the second life asks far less", async () => {
    const graphs = new Map<string, SkillGraph>();
    const first = await runSettlementLife({ days: 3, life: 1, graphs, planner: "manual" });
    const second = await runSettlementLife({ days: 3, life: 2, graphs, planner: "manual" });
    expect(first.alive).toBe(10);
    expect(second.alive).toBe(10);
    expect(first.built).toMatchObject({ workshop: 1 });
    expect(first.built.house).toBeGreaterThanOrEqual(2); // a small start: tents first, houses as they learn
    expect(second.plannerCalls).toBeLessThan(first.plannerCalls / 2);
    expect(second.days.slice(1).reduce((n, d) => n + d.plannerCalls, 0)).toBeLessThanOrEqual(3);
    expect(second.days.every(d => (d.made["cooked-fish"] ?? 0) >= 15)).toBe(true);
    expect(graphs.get("cook")!.producers("cooked-fish")[0].effect).toMatchObject({ needs: { "raw-fish": 3, firewood: 1 }, gives: { "cooked-fish": 3 } });
  }, 60_000);
});
