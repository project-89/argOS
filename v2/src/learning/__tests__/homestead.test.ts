import { jest } from "@jest/globals";
import { Homestead } from "../homestead/world";
import { HOMESTEAD, RAFT, variantHomestead } from "../homestead/recipes";
import { manualPlanner } from "../homestead/planners";
import { runCurriculum } from "../homestead/run-homestead";
import { SkillGraph, countActs, nodeShape } from "../skill-graph";
import { SkillSolver } from "../skill-runtime";
import { getObservationsByCategory, reportGap } from "../../spirits/observation-aggregator";

const lands: Homestead[] = [];
beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const land of lands.splice(0)) land.stop(); jest.restoreAllMocks(); });
const land = (def = HOMESTEAD) => { const h = new Homestead(def); lands.push(h); return h; };

describe("the homestead world", () => {
  test("verbs need what their recipes say, report exactly what is missing, and consume materials", () => {
    const h = land();
    expect(h.act({ verb: "craft", target: "Workbench", arg: "planks" })).toMatchObject({ ok: false, missing: { kind: "log", count: 1 } });
    h.act({ verb: "move", target: "Birch Woods" });
    expect(h.act({ verb: "chop", target: "Birch tree" })).toMatchObject({ ok: false, missing: { kind: "axe", count: 1 } });
    h.act({ verb: "move", target: "Tool Shed" }); h.act({ verb: "pickup", target: "Old axe" });
    h.act({ verb: "move", target: "Birch Woods" });
    expect(h.act({ verb: "chop", target: "Birch tree" })).toMatchObject({ ok: true, used: ["axe"] });
    h.act({ verb: "move", target: "The Clearing" });
    expect(h.act({ verb: "craft", target: "Workbench", arg: "planks" }).ok).toBe(true);
    expect(h.have()).toEqual({ axe: 1, planks: 2 });
    expect(h.act({ verb: "build", target: "Cabin site", arg: "frame" })).toMatchObject({ ok: false, missing: { kind: "cabin.foundation", count: 1 } });
    expect(h.act({ verb: "pickup", target: "Workbench" }).ok).toBe(false);
  });
});

describe("the skill graph learns from what it did", () => {
  test("one planned cabin leaves skills with their own needs and gives, composed by what they produce", async () => {
    const h = land(), graph = new SkillGraph();
    const solver = new SkillSolver(h, graph, manualPlanner(() => h));
    expect(await solver.solve("cabin", 1)).toBe(true);
    expect(h.have().cabin).toBe(1);
    const by = (item: string) => graph.producers(item)[0];
    expect(by("planks").effect).toEqual({ needs: { log: 1 }, requires: [], gives: { planks: 2 } });
    expect(by("log").effect).toMatchObject({ needs: {}, requires: ["axe"], gives: { log: 1 } });
    expect(by("pickaxe").effect.needs).toEqual({ stone: 1, sticks: 2 });
    // The cabin does not contain chopping: it ensures materials, which other skills make.
    const cabin = by("cabin");
    expect(nodeShape(cabin.tree)).toBe("[move(@building-site),ensure(stone×4),build(building-site foundation),ensure(planks×4),build(building-site frame),"
      + "ensure(planks×6),build(building-site walls),ensure(planks×4),build(building-site roof)]");
    expect(countActs(cabin.tree)).toBe(5);
    // Each part is also its own skill (kept from inside the plan).
    expect(by("cabin.walls").effect).toMatchObject({ needs: { planks: 6 }, gives: { "cabin.walls": 1 } });
    // Two ways of getting stone: pick one up, or mine with a pickaxe.
    expect(graph.producers("stone").map(s => s.effect.requires)).toEqual(expect.arrayContaining([[], ["pickaxe"]]));
  });

  test("the graph survives as JSON; a fresh life on differently named land builds a cabin without asking", async () => {
    const first = land(), graph = new SkillGraph();
    await new SkillSolver(first, graph, manualPlanner(() => first)).solve("cabin", 1);
    const restored = SkillGraph.fromJson(JSON.parse(JSON.stringify(graph.toJson())));
    const other = land(variantHomestead());
    const planner = jest.fn(manualPlanner(() => other));
    const solver = new SkillSolver(other, restored, planner);
    expect(await solver.solve("cabin", 1)).toBe(true);
    expect(planner).not.toHaveBeenCalled();
    expect(solver.stats.skillRuns).toBeGreaterThan(10);
  });

  test("something nothing gives is reported as a gap, once", async () => {
    const h = land();
    h.addStructure(RAFT);
    const gaps: string[] = [];
    const solver = new SkillSolver(h, new SkillGraph(), manualPlanner(() => h), { onGap: item => gaps.push(item) });
    expect(await solver.solve("rope", 1)).toBe(false);
    expect(await solver.solve("rope", 1)).toBe(false);
    expect(gaps).toEqual(["rope"]);
  });
});

describe("the curriculum", () => {
  test("the model's share falls to nothing for a known goal, survives new land, and the world grows where it must", async () => {
    const { reports } = await runCurriculum({ planner: "manual" });
    expect(reports.map(r => r.done)).toEqual([true, true, true, true, true]);
    const calls = reports.map(r => r.plannerCalls);
    expect(calls[0]).toBeGreaterThanOrEqual(6);
    expect(calls.slice(1, 3)).toEqual([0, 0]);          // same goal, same and different land
    expect(calls[3]).toBeGreaterThan(0);                 // a new goal needs new knowledge ...
    expect(reports[3].grew).toEqual(["rope"]);           // ... and a world that can make rope
    expect(calls[4]).toBe(0);                            // then it is known too
    expect(reports[3].gaps).toContain("rope");
  });

  test("a gap reaches the spirits' observation board", async () => {
    const h = land();
    const solver = new SkillSolver(h, new SkillGraph(), manualPlanner(() => h), {
      onGap: (item, detail) => reportGap("homestead", "resource_gap", `Residents lack ${item}`, detail, "medium", h.world) });
    await solver.solve("rope", 1);
    expect(getObservationsByCategory("resource_gap", h.world).some(o => /rope/.test(o.title))).toBe(true);
  });
});

describe("short of materials is not a surprise", () => {
  test("a learned house whose foundation lacks stone nobody can get: short, not a failed way — no surprise, no gap for the house", async () => {
    const stock: Record<string, number> = {};
    const env = {
      have: () => ({ ...stock }),
      act: (a: { verb: string; arg?: string }) => a.verb === "build" && !(stock.stone >= 2)
        ? { ok: false, summary: "The foundation needs 2 more stone.", missing: { kind: "stone", count: 2 } }
        : { ok: true, summary: "Built." },
      observation: () => "A bare plot.", bind: () => "House plot 1", abstract: (a: any) => ({ verb: a.verb, target: { thing: "house-plot" }, arg: a.arg }),
      approach: () => true,
    };
    const graph = new SkillGraph();
    graph.learn({ item: "house", count: 1 }, { kind: "act", verb: "build", target: { thing: "house-plot" }, arg: "foundation" },
      { needs: { stone: 2 }, requires: [], gives: { house: 1 } }, 0);
    const surprises: string[] = [], gaps: string[] = [];
    const solver = new SkillSolver(env as any, graph, async () => [], { onSurprise: (item, _id, detail) => surprises.push(`${item}: ${detail}`), onGap: item => gaps.push(item) });
    expect(await solver.solve("house", 1)).toBe(false);
    expect(surprises).toEqual([]);
    expect(gaps).toEqual(["stone"]); // the real gap: nobody knows how to get stone
    expect([...graph.skills.values()][0].stats.failures).toBe(0); // the way of building is sound
  });
  test("the same when the way says so up front: an ensure for stone that cannot be met is a shortage, not a surprise", async () => {
    const env = { have: () => ({}), act: () => ({ ok: true, summary: "Built." }), observation: () => "A bare plot.", bind: () => "House plot 1",
      abstract: (a: any) => ({ verb: a.verb, target: { thing: "house-plot" }, arg: a.arg }), approach: () => true };
    const graph = new SkillGraph();
    graph.learn({ item: "house", count: 1 }, { kind: "seq", children: [{ kind: "ensure", item: "stone", count: 4 },
      { kind: "act", verb: "build", target: { thing: "house-plot" }, arg: "foundation" }] }, { needs: { stone: 4 }, requires: [], gives: { house: 1 } }, 0);
    const surprises: string[] = [];
    const solver = new SkillSolver(env as any, graph, async () => [], { onSurprise: item => surprises.push(item) });
    expect(await solver.solve("house", 1)).toBe(false);
    expect(surprises).toEqual([]);
    expect(solver.stats.gaps).toEqual(["stone"]);
  });
  test("a planned way that runs into a spent tree is short, not a gap in knowing how", async () => {
    const env = { have: () => ({}), observation: () => "A stump and a felled birch.", bind: () => undefined, abstract: (a: any) => ({ verb: a.verb, arg: a.arg }), approach: () => false,
      act: (a: { verb: string }) => a.verb === "split" ? { ok: false, summary: "To split you need 1 more log.", missing: { kind: "log", count: 1 } }
        : { ok: false, summary: "Birch 1 is spent for now.", scarce: true } };
    const planner = async (r: { goal: { item: string } }) => r.goal.item === "firewood" ? [{ verb: "split", target: "Chopping stump" }] : [{ verb: "chop", target: "Birch 1" }];
    const gaps: string[] = [];
    const solver = new SkillSolver(env as any, new SkillGraph(), planner as any, { onGap: item => gaps.push(item) });
    expect(await solver.solve("firewood", 1)).toBe(false);
    expect(gaps).toEqual([]);
  });
});
