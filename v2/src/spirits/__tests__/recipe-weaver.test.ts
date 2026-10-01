import { jest } from "@jest/globals";
import { Homestead } from "../../learning/homestead/world";
import { HOMESTEAD } from "../../learning/homestead/recipes";
import { lackedItems, reportResourceGap, validatePatch, weaveForGap, type WeaverStats } from "../recipe-weaver";
import { runCurriculum } from "../../learning/homestead/run-homestead";

const lands: Homestead[] = [];
beforeEach(() => { jest.spyOn(console, "log").mockImplementation(() => {}); });
afterEach(() => { for (const l of lands.splice(0)) l.stop(); jest.restoreAllMocks(); });
const land = () => { const h = new Homestead(HOMESTEAD); lands.push(h); return h; };
const stats = (): WeaverStats => ({ designs: 0, applied: 0, rejected: [], tokensIn: 0, tokensOut: 0 });
const ROPE = { reason: "Nettles by the stream can be twisted into rope.",
  things: [{ name: "Nettle bed", kind: "nettles", placeKind: "clearing", uses: 10 }],
  recipes: [{ verb: "cut", at: "nettles", gives: { nettle: 2 }, durationS: 40 }, { verb: "twist", at: "workbench", product: "rope", needs: { nettle: 3 }, gives: { rope: 1 } }] };

describe("the Weaver's recipe craft", () => {
  test("a grounded design is validated, its hints written from the data, and the world grows", async () => {
    const h = land();
    const s = stats();
    const result = await weaveForGap("rope", "for a raft", h, { stats: s, generate: async () => ({ text: JSON.stringify(ROPE) }) });
    expect(result.ok).toBe(true);
    expect(h.manual()).toEqual(expect.arrayContaining(["cut at a nettles: 2 nettle", "twist rope at a workbench: 3 nettle → 1 rope"]));
    expect(h.thingKinds()).toContain("nettles");
    expect(s).toMatchObject({ designs: 1, applied: 1 });
  });

  test("nothing from nothing, no unknown places, no dangling inputs, and it must give what was lacked", () => {
    const h = land();
    const bad = (patch: unknown) => { const r = validatePatch(patch, "rope", h); return r.ok ? "ok" : r.reason; };
    expect(bad({ recipes: [{ verb: "wish", at: "workbench", gives: { rope: 1 } }] })).toMatch(/from nothing/);
    expect(bad({ things: [{ name: "Vine", kind: "vine", placeKind: "jungle", uses: 3 }], recipes: [{ verb: "pull", at: "vine", gives: { rope: 1 } }] })).toMatch(/no place/);
    expect(bad({ recipes: [{ verb: "twist", at: "workbench", needs: { hemp: 2 }, gives: { rope: 1 } }] })).toMatch(/hemp, which nothing provides/);
    expect(bad({ things: [{ name: "Reeds", kind: "reeds", placeKind: "woods", uses: 5 }], recipes: [{ verb: "cut", at: "reeds", gives: { reed: 1 } }] })).toMatch(/does not give rope/);
    expect(bad({ recipes: [{ verb: "sell", at: "workbench", needs: { log: 1 }, gives: { rope: 1 } }] })).toMatch(/not allowed/);
    expect(bad({ recipes: [{ verb: "twist", at: "workbench", needs: { log: 1 }, gives: { rope: 1 } }] })).toBe("ok");
  });

  test("a refused design is retried once with the reason", async () => {
    const h = land();
    const prompts: string[] = [];
    const answers = [{ recipes: [{ verb: "wish", at: "workbench", gives: { rope: 1 } }] }, ROPE];
    const result = await weaveForGap("rope", "", h, { generate: async ({ prompt }) => { prompts.push(prompt); return { text: JSON.stringify(answers.shift()) }; } });
    expect(result.ok).toBe(true);
    expect(prompts[1]).toMatch(/refused: .*from nothing/);
  });

  test("gaps reach the board with the item, and the curriculum's world grows by the Weaver's design", async () => {
    const h = land();
    reportResourceGap(h.world, "rope", "for a raft");
    expect(lackedItems(h.world)).toEqual(["rope"]);
    const { reports, grown, weaver } = await runCurriculum({ planner: "manual", weaver: { generate: async () => ({ text: JSON.stringify(ROPE) }) } });
    expect(reports.map(r => r.done)).toEqual([true, true, true, true, true]);
    expect(grown.map(p => p.item)).toEqual(["rope"]);
    expect(grown[0].things[0].kind).toBe("nettles");
    expect(weaver.applied).toBe(1);
    expect(reports[4].plannerCalls).toBe(0);
  });
});

describe("the Weaver adds crafts, drink and trades, not only sources", () => {
  const town = (conditions: string[] = []) => ({ manual: () => ["chop log at a tree (hold axe)"], placeKinds: () => ["common", "woods", "quarry"],
    thingKinds: () => ["tree", "workbench", "campfire", "stump"], obtainableKinds: () => ["axe", "log", "stone", "firewood", "berries", "water"],
    conditionKinds: () => conditions, apply: () => {} });
  const SMITHING = { reason: "A forge on the common lets a smith mend blunted axes and make new ones.",
    things: [{ name: "Forge", kind: "forge", placeKind: "common" }],
    recipes: [{ verb: "smith", at: "forge", product: "axe", needs: { stone: 2, log: 1, firewood: 2 }, gives: { axe: 1 }, durationS: 600 },
      { verb: "mend", at: "forge", product: "axe", needs: { "blunt-axe": 1, firewood: 1 }, gives: { axe: 1 }, durationS: 240 }],
    wear: [{ tool: "axe", uses: 20, becomes: "blunt-axe" }],
    trade: { role: "smith", duties: [{ item: "axe", stock: 2 }] } };
  const ALE = { reason: "Berries and spring water ferment into a rough ale.",
    recipes: [{ verb: "brew", at: "campfire", product: "ale", needs: { berries: 3, water: 1 }, gives: { ale: 2 }, durationS: 900 }],
    foods: [{ kind: "ale", thirst: 20, durationS: 60, conditions: { drunk: .3 } }],
    conditions: [{ kind: "drunk", name: "Drink", wearsOffPerHour: .15, effects: { work: -.4, walk: -.3, attention: .4 }, labels: { mild: "tipsy", strong: "drunk" },
      feels: { mild: "The ale warms you.", strong: "Your head swims.", gone: "Your head is clear again." } }] };

  test("blacksmithing: a forge, smithing and mending, axes that wear, and a smith's trade", () => {
    const r = validatePatch(SMITHING, "axe", town());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.patch.wear).toEqual([{ tool: "axe", uses: 20, becomes: "blunt-axe" }]);
      expect(r.patch.trade).toEqual({ role: "smith", duties: [{ item: "axe", stock: 2 }] });
      expect(r.patch.recipes.map(x => x.hint)).toContain("mend axe at a forge: 1 blunt-axe + 1 firewood → 1 axe");
    }
  });
  test("drink: ale brewed from what the town has, a condition with bounded effects, and how it feels", () => {
    const r = validatePatch(ALE, "ale", town());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch.foods).toEqual([{ kind: "ale", thirst: 20, durationS: 60, conditions: { drunk: .3 } }]);
  });
  test("refused: effects outside the vocabulary, drink raising a condition nobody defined, a trade for goods nobody makes, wear on a tool nobody has", () => {
    const bad = (patch: unknown, item: string) => { const r = validatePatch(patch, item, town()); return r.ok ? "ok" : r.reason; };
    expect(bad({ ...ALE, conditions: [{ ...ALE.conditions[0], effects: { flight: .5 } }] }, "ale")).toMatch(/unknown effect "flight"/);
    expect(bad({ ...ALE, conditions: [] }, "ale")).toMatch(/raises "drunk", which is no condition here/);
    expect(bad({ ...SMITHING, trade: { role: "smith", duties: [{ item: "sword", stock: 2 }] } }, "axe")).toMatch(/duty sword must be something made here/);
    expect(bad({ ...SMITHING, wear: [{ tool: "pickaxe", uses: 20, becomes: "blunt-pickaxe" }, SMITHING.wear[0]] }, "axe")).toMatch(/"pickaxe" is not a tool/);
    // A condition the town already has may be raised by a new drink without redefining it.
    expect(validatePatch({ ...ALE, conditions: [] }, "ale", town(["drunk"])).ok).toBe(true);
  });
});
