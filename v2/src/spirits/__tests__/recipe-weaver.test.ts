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
