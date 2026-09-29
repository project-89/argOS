import { jest } from "@jest/globals";
import { Settlement } from "../settlement/settlement";
import { SALTMERE_LAND } from "../settlement/saltmere-land";
import { runSettlementLife } from "../settlement/run-settlement";
import { SkillGraph } from "../skill-graph";

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

  test("a builder claims a plot until the building is finished", async () => {
    const t = town(), ivo = who(t, "Ivo"), mara = who(t, "Mara");
    const env = t.envFor(ivo);
    // Give Ivo the logs a net rack needs.
    for (let i = 0; i < 2; i++) (t as any).giveItem(ivo, "log");
    (t as any).giveItem(ivo, "stone");
    const posts = t.perform(ivo, { verb: "build", target: "Rack plot 1", arg: "posts" });
    expect(await run(t, t.perform(mara, { verb: "build", target: "Rack plot 1", arg: "posts" }))).toMatchObject({ ok: false, scarce: true });
    expect((await run(t, posts)).summary).toMatch(/Net rack is finished/);
    expect(t.builtCount["net-rack"]).toBe(1);
    expect(env.bind({ thing: "net-rack" })).toBe("Net rack 1");
  });
});

describe("a settlement that learns to keep itself alive", () => {
  test("offline: everyone survives three days, the town is built, and the second life asks far less", async () => {
    const graphs = new Map<string, SkillGraph>();
    const first = await runSettlementLife({ days: 3, life: 1, graphs, planner: "manual" });
    const second = await runSettlementLife({ days: 3, life: 2, graphs, planner: "manual" });
    expect(first.alive).toBe(10);
    expect(second.alive).toBe(10);
    expect(first.built).toMatchObject({ workshop: 1, "net-rack": 1, house: 5 });
    expect(second.plannerCalls).toBeLessThan(first.plannerCalls / 2);
    expect(second.days.slice(1).every(d => d.plannerCalls === 0)).toBe(true);
    expect(second.days.every(d => (d.made["cooked-fish"] ?? 0) >= 15)).toBe(true);
    expect(graphs.get("cook")!.producers("cooked-fish")[0].effect).toMatchObject({ needs: { "raw-fish": 3, firewood: 1 }, gives: { "cooked-fish": 3 } });
  }, 60_000);
});
