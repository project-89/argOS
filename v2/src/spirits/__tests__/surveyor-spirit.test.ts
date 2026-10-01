import { surveyOpportunities, surveyorPrompt, validateOpportunity, type SurveyFacts, type SurveyStats } from "../surveyor-spirit";

const FACTS: SurveyFacts = {
  trades: ["fisher (keeps raw-fish)", "woodcutter (keeps log, firewood)"], stations: ["tree", "fishing-water", "campfire"], goods: ["raw-fish", "log", "axe"],
  drawn: ["tent", "campfire"], standIns: ["wild-strawberries"], places: [{ name: "The Shingle", kind: "shore" }, { name: "Saltmere Common", kind: "square" }],
  conditions: [], talk: ["Otis: Another day wading the shallows for a few herring."], intentions: ["Leon: Mend the old boat my brother left"],
  lacking: ["axe (woodcutters)"], taken: ["Wild strawberries"],
};
const answer = { opportunities: [
  { lane: "model", subject: "Rowing boat", why: "The fishers wade the shallows; a boat drawn up on the shingle would let them go out.", kind: "rowing-boat", placeKind: "shore", size: { x: 1.4, y: .8, z: 4 } },
  { lane: "craft", subject: "Blacksmithing", why: "Axes are scarce and nobody can make or mend one.", item: "axe" },
  { lane: "condition", subject: "Ale", why: "A town that works this hard would want a drink at the fire.", item: "ale" },
] };

test("the Surveyor names where the town is thin, each in a lane a builder can make real", async () => {
  const prompts: string[] = [], stats: SurveyStats = { surveys: 0, proposed: 0, refused: [], tokensIn: 0, tokensOut: 0 };
  const found = await surveyOpportunities(FACTS, { stats, generate: async ({ prompt }) => { prompts.push(prompt); return { text: JSON.stringify(answer), usage: { inputTokens: 800 } }; } });
  expect(found.map(o => [o.lane, o.subject])).toEqual([["model", "Rowing boat"], ["craft", "Blacksmithing"], ["condition", "Ale"]]);
  expect(found[0]).toMatchObject({ kind: "rowing-boat", placeKind: "shore", size: { x: 1.4, y: .8, z: 4 } });
  // It reads the town: what people say and mean to do, what fails, what is still a stand-in.
  expect(prompts[0]).toMatch(/wading the shallows/);
  expect(prompts[0]).toMatch(/Mend the old boat/);
  expect(prompts[0]).toMatch(/axe \(woodcutters\)/);
  expect(prompts[0]).toMatch(/Borrowing a stand-in's look: wild-strawberries/);
  expect(stats).toMatchObject({ surveys: 1, proposed: 3, tokensIn: 800 });
});

test("an opportunity's shape is checked against the world; what was already taken up is not proposed again", () => {
  const check = (o: object) => { const r = validateOpportunity(o, FACTS); return r.ok ? "ok" : r.reason; };
  expect(check(answer.opportunities[0])).toBe("ok");
  expect(check({ ...answer.opportunities[0], placeKind: "harbour" })).toMatch(/no place of kind "harbour"/);
  expect(check({ ...answer.opportunities[0], size: { x: 40, y: 1, z: 1 } })).toMatch(/0.2–8 m/);
  expect(check({ ...answer.opportunities[1], item: "Iron Sword!" })).toMatch(/bad item/);
  expect(check({ lane: "spell", subject: "Magic", why: "fun" })).toMatch(/unknown lane/);
  expect(check({ lane: "model", subject: "wild strawberries", why: "again", kind: "wild-strawberries", placeKind: "shore", size: { x: 1, y: 1, z: 1 } })).toMatch(/already taken up/);
  expect(surveyorPrompt(FACTS)).toMatch(/Already taken up \(do not propose again\): Wild strawberries/);
});

test("a garbled answer or a failed call proposes nothing", async () => {
  expect(await surveyOpportunities(FACTS, { generate: async () => ({ text: "I think the town needs love." }) })).toEqual([]);
  expect(await surveyOpportunities(FACTS, { generate: async () => { throw new Error("quota"); } })).toEqual([]);
});
