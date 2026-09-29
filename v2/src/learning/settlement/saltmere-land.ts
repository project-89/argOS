/** Saltmere as a settlement that has to keep itself alive: the shore and its
 * fish, the birch wood, a spring, the quarry, a flax field and berry brambles
 * around the Common — and bare plots where the town is still to be built.
 * Everything is data, so the Weaver can grow it and residents learn it.
 *
 * Times are simulated seconds; distances metres. */
import type { WovenRecipe } from "../../spirits/recipe-weaver";

export type Stock = Record<string, number>;
export type LandPlace = { id: string; name: string; kind: string; x: number; y: number; description: string };
export type LandThing = { id: string; name: string; kind: string; place: string; uses?: number; portable?: boolean;
  /** Uses restored each morning, up to `uses` (brambles fruit again, trees grow back). */
  regrow?: number };
export type LandRecipe = Omit<WovenRecipe, "hint"> & { hint?: string; durationS?: number };
/** A structure raised on a plot of its kind, part by part; finished, the plot becomes a station. */
export type LandStructure = { kind: string; name: string; plot: string; becomes: string; parts: Array<{ part: string; needs: Stock; durationS: number }> };
/** What a tool turns into when worn out, and after how many uses. */
export type Wear = { tool: string; uses: number; becomes: string };
export type Food = { kind: string; hunger?: number; thirst?: number; durationS: number };
export type Duty = { item: string; stock: number };
export type Trade = { role: string; duties: Duty[] };
export type Resident = { name: string; trade: string; start: string; coins: number; carries?: string[] };
export type LandDef = {
  id: string; places: LandPlace[]; things: LandThing[]; recipes: LandRecipe[]; structures: LandStructure[]; wear: Wear[]; foods: Food[];
  /** Market prices (the stall buys at price, sells at price). */
  prices: Stock; stallCap: number; treasury: number; buildPay: number;
  /** Each morning the treasury gives every living resident this share. */
  dailyShare: number;
  trades: Trade[]; residents: Resident[];
  /** What the town wants built, in order. */
  townPlan: Array<{ kind: string; count: number }>;
  needs: { hungerPerHour: number; thirstPerHour: number; eatAt: number; collapseHours: number };
  /** Night: residents sleep in their shelter; needs slow while asleep. Hours of the day (the clock starts at dawn). */
  night: { dawnHour: number; bedHour: number; wakeHour: number; asleepNeedFactor: number };
  /** Shelter: how rested a night leaves you (work speed next day), and how many a building sleeps. */
  shelter: Array<{ kind: string; rest: number; sleeps: number }>;
};

const plots = (kind: string, count: number, from: number): LandThing[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${kind}-${from + i}`, name: `${kind === "house-plot" ? "House plot" : kind === "workshop-plot" ? "Workshop plot" : "Rack plot"} ${from + i}`, kind, place: "common" }));

export const SALTMERE_LAND: LandDef = {
  id: "saltmere-settlement-v1",
  places: [
    { id: "common", name: "Saltmere Common", kind: "square", x: 0, y: 0, description: "The green at the heart of things: a market stall, a campfire, a chopping stump, the tool shed, and staked-out bare plots." },
    { id: "shore", name: "The Shingle", kind: "shore", x: 0, y: -130, description: "Grey shingle and cold water; the fish run close in at the turn of the tide." },
    { id: "wood", name: "Birch Wood", kind: "woods", x: -160, y: 50, description: "Birches and brambles." },
    { id: "spring", name: "Well Spring", kind: "spring", x: 70, y: 100, description: "A stone-lined spring, cold all year." },
    { id: "quarry", name: "Old Quarry", kind: "quarry", x: 200, y: 60, description: "Loose stone at the foot of an old cut face." },
    { id: "field", name: "Flax Field", kind: "field", x: -90, y: -70, description: "A strip of blue-flowering flax." },
  ],
  things: [
    { id: "stall", name: "Market stall", kind: "stall", place: "common" },
    // The one building standing: the old Net House, with its rack for nets.
    { id: "net-house", name: "The Net House", kind: "net-rack", place: "common" },
    ...Array.from({ length: 10 }, (_, i) => ({ id: `tent-${i + 1}`, name: `Tent ${i + 1}`, kind: "tent", place: "common" })),
    { id: "campfire", name: "Campfire", kind: "hearth", place: "common" },
    { id: "stump", name: "Chopping stump", kind: "stump", place: "common" },
    { id: "axe-1", name: "Old axe", kind: "axe", place: "common", portable: true },
    { id: "axe-2", name: "Hatchet", kind: "axe", place: "common", portable: true },
    { id: "net-1", name: "Herring net", kind: "net", place: "common", portable: true },
    { id: "net-2", name: "Seine net", kind: "net", place: "common", portable: true },
    { id: "fishing", name: "Fishing water", kind: "fishing-water", place: "shore" },
    ...Array.from({ length: 14 }, (_, i) => ({ id: `birch-${i}`, name: `Birch ${i + 1}`, kind: "tree", place: "wood", uses: 5, regrow: 1 })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `bramble-${i}`, name: `Bramble ${i + 1}`, kind: "bramble", place: "wood", uses: 4, regrow: 4 })),
    { id: "spring-pool", name: "Spring pool", kind: "spring", place: "spring" },
    { id: "stone-pile", name: "Loose stone", kind: "stone-pile", place: "quarry", uses: 60 },
    { id: "flax", name: "Flax rows", kind: "flax-patch", place: "field", uses: 30, regrow: 10 },
    ...plots("workshop-plot", 1, 1), ...plots("house-plot", 5, 1),
  ],
  recipes: [
    { verb: "catch", at: "fishing-water", tools: ["net"], gives: { "raw-fish": 1 }, durationS: 420 },
    { verb: "cook", at: "hearth", product: "fish", needs: { "raw-fish": 3, firewood: 1 }, gives: { "cooked-fish": 3 }, durationS: 600 },
    { verb: "chop", at: "tree", tools: ["axe"], gives: { log: 1 }, spends: true, durationS: 300 },
    { verb: "split", at: "stump", needs: { log: 1 }, gives: { firewood: 4 }, durationS: 150 },
    { verb: "saw", at: "workbench", product: "planks", needs: { log: 1 }, gives: { planks: 2 }, durationS: 360 },
    { verb: "gather", at: "stone-pile", gives: { stone: 1 }, spends: true, durationS: 150 },
    { verb: "pick", at: "bramble", gives: { berries: 2 }, spends: true, durationS: 240 },
    { verb: "draw", at: "spring", gives: { water: 1 }, durationS: 40 },
    { verb: "pull", at: "flax-patch", gives: { flax: 2 }, spends: true, durationS: 300 },
    { verb: "spin", at: "workbench", product: "twine", needs: { flax: 2 }, gives: { twine: 1 }, durationS: 360 },
    { verb: "mend", at: "net-rack", product: "net", needs: { "torn-net": 1, twine: 1 }, gives: { net: 1 }, durationS: 900 },
    { verb: "knot", at: "net-rack", product: "net", needs: { twine: 3 }, gives: { net: 1 }, durationS: 1800 },
  ],
  structures: [
    { kind: "workshop", name: "Workshop", plot: "workshop-plot", becomes: "workbench", parts: [
      { part: "frame", needs: { log: 4 }, durationS: 1800 }, { part: "roof", needs: { log: 3, stone: 2 }, durationS: 1800 }] },
    { kind: "net-rack", name: "Net rack", plot: "rack-plot", becomes: "net-rack", parts: [{ part: "posts", needs: { log: 2, stone: 1 }, durationS: 1200 }] },
    { kind: "house", name: "House", plot: "house-plot", becomes: "house", parts: [
      { part: "foundation", needs: { stone: 4 }, durationS: 2400 }, { part: "frame", needs: { planks: 4 }, durationS: 2400 },
      { part: "walls", needs: { planks: 6 }, durationS: 2400 }, { part: "roof", needs: { planks: 4 }, durationS: 2400 }] },
  ],
  wear: [{ tool: "net", uses: 10, becomes: "torn-net" }],
  foods: [
    { kind: "cooked-fish", hunger: 45, durationS: 300 }, { kind: "berries", hunger: 12, durationS: 120 },
    { kind: "raw-fish", hunger: 18, durationS: 240 }, { kind: "water", thirst: 60, durationS: 30 },
  ],
  prices: { "cooked-fish": 5, "raw-fish": 3, berries: 2, firewood: 2, log: 3, planks: 4, stone: 2, twine: 3, net: 7, "torn-net": 1, flax: 2, water: 1 },
  stallCap: 12, treasury: 1200, buildPay: 10, dailyShare: 16,
  trades: [
    { role: "fisher", duties: [{ item: "raw-fish", stock: 8 }] },
    { role: "cook", duties: [{ item: "cooked-fish", stock: 8 }] },
    { role: "net-mender", duties: [{ item: "net", stock: 2 }, { item: "twine", stock: 2 }] },
    { role: "woodcutter", duties: [{ item: "firewood", stock: 6 }, { item: "log", stock: 8 }, { item: "planks", stock: 8 }] },
    { role: "grower", duties: [{ item: "flax", stock: 6 }, { item: "twine", stock: 3 }] },
    { role: "forager", duties: [{ item: "berries", stock: 6 }, { item: "water", stock: 4 }] },
    { role: "builder", duties: [] },
  ],
  residents: [
    { name: "Otis", trade: "fisher", start: "shore", coins: 12, carries: ["net"] },
    { name: "Leon", trade: "fisher", start: "shore", coins: 12, carries: ["net"] },
    { name: "Tess", trade: "cook", start: "common", coins: 20 },
    { name: "Ada", trade: "net-mender", start: "common", coins: 15 },
    { name: "Eli", trade: "woodcutter", start: "wood", coins: 10, carries: ["axe"] },
    { name: "Sera", trade: "woodcutter", start: "wood", coins: 10, carries: ["axe"] },
    { name: "Bea", trade: "grower", start: "field", coins: 10 },
    { name: "Noor", trade: "forager", start: "wood", coins: 10 },
    { name: "Ivo", trade: "builder", start: "common", coins: 15, carries: ["axe"] },
    { name: "Mara", trade: "builder", start: "common", coins: 15, carries: ["axe"] },
  ],
  townPlan: [{ kind: "workshop", count: 1 }, { kind: "house", count: 5 }],
  needs: { hungerPerHour: 6, thirstPerHour: 10, eatAt: 45, collapseHours: 4 },
  night: { dawnHour: 6, bedHour: 22, wakeHour: 6, asleepNeedFactor: 0.4 },
  shelter: [{ kind: "tent", rest: 0.8, sleeps: 1 }, { kind: "house", rest: 1, sleeps: 2 }],
};
