import type { WovenPatch } from "../../spirits/recipe-weaver";

/** The homestead: a small world whose making is real. Everything is data —
 * places, things, what each verb needs and gives, what structures are made of —
 * so the world can grow (a spirit adds a recipe or a resource) and residents
 * learn to use what appears. Kinds are world-portable words ("log", "tree");
 * names are this world's. */

export type ItemKind = string;
export type Stock = Record<ItemKind, number>;

export type PlaceDef = { id: string; name: string; kind: string; description: string };

/** A source or station standing in a place. */
export type ThingDef = {
  id: string; name: string; kind: string; place: string;
  /** How many times it can yield before it is spent (trees, rock). Unset: unlimited. */
  uses?: number;
  /** Portable: can be picked up (then it is an item in hand). */
  portable?: boolean;
};

/** A verb on a kind of thing: what it needs in hand (consumed), which tools
 * must be held (not consumed), and what it gives. */
export type RecipeDef = {
  verb: string;
  /** The kind of thing it is done at/on. */
  at: string;
  /** Argument naming the product, when a station makes several things ("craft planks"). */
  product?: string;
  needs?: Stock;
  tools?: ItemKind[];
  gives?: Stock;
  /** Uses one of the thing's limited uses. */
  spends?: boolean;
  /** One line a resident would read about it (the only recipe knowledge a planner gets). */
  hint: string;
  /** Simulated seconds it takes (timed worlds). */
  durationS?: number;
};

/** A structure is built in parts, in order, at a site; each part is a recipe. */
export type StructureDef = { kind: string; name: string; site: string; parts: Array<{ part: string; needs: Stock; hint: string }> };

export type HomesteadDef = {
  id: string; places: PlaceDef[]; things: ThingDef[]; recipes: RecipeDef[]; structures: StructureDef[];
  /** Where a resident starts. */
  start: string;
};

export const HOMESTEAD: HomesteadDef = {
  id: "homestead-v1",
  start: "clearing",
  places: [
    { id: "clearing", name: "The Clearing", kind: "clearing", description: "Open ground by the stream: a workbench, and staked-out ground for a cabin." },
    { id: "woods", name: "Birch Woods", kind: "woods", description: "Tall birches, close together." },
    { id: "quarry", name: "Old Quarry", kind: "quarry", description: "A cut face of grey rock, loose stones at its foot." },
    { id: "shed", name: "Tool Shed", kind: "shed", description: "A lean-to with pegs on the wall." },
  ],
  things: [
    { id: "axe", name: "Old axe", kind: "axe", place: "shed", portable: true },
    { id: "birch-1", name: "Birch tree", kind: "tree", place: "woods", uses: 3 },
    { id: "birch-2", name: "Leaning birch", kind: "tree", place: "woods", uses: 3 },
    { id: "birch-3", name: "Tall birch", kind: "tree", place: "woods", uses: 3 },
    { id: "birch-4", name: "Split birch", kind: "tree", place: "woods", uses: 3 },
    { id: "stone-1", name: "Loose stone", kind: "stone", place: "quarry", portable: true },
    { id: "stone-2", name: "Flat stone", kind: "stone", place: "quarry", portable: true },
    { id: "rock-face", name: "Rock face", kind: "rock", place: "quarry", uses: 12 },
    { id: "bench", name: "Workbench", kind: "workbench", place: "clearing" },
    { id: "site", name: "Cabin site", kind: "building-site", place: "clearing" },
  ],
  recipes: [
    { verb: "chop", at: "tree", tools: ["axe"], gives: { log: 1 }, spends: true, hint: "chop a tree (hold an axe): 1 log" },
    { verb: "mine", at: "rock", tools: ["pickaxe"], gives: { stone: 1 }, spends: true, hint: "mine rock (hold a pickaxe): 1 stone" },
    { verb: "craft", at: "workbench", product: "planks", needs: { log: 1 }, gives: { planks: 2 }, hint: "craft planks at a workbench: 1 log → 2 planks" },
    { verb: "craft", at: "workbench", product: "sticks", needs: { planks: 1 }, gives: { sticks: 2 }, hint: "craft sticks at a workbench: 1 planks → 2 sticks" },
    { verb: "craft", at: "workbench", product: "pickaxe", needs: { sticks: 2, stone: 1 }, gives: { pickaxe: 1 }, hint: "craft a pickaxe at a workbench: 2 sticks + 1 stone → pickaxe" },
  ],
  structures: [
    { kind: "cabin", name: "Cabin", site: "building-site", parts: [
      { part: "foundation", needs: { stone: 4 }, hint: "build foundation: 4 stone" },
      { part: "frame", needs: { planks: 4 }, hint: "build frame (after foundation): 4 planks" },
      { part: "walls", needs: { planks: 6 }, hint: "build walls (after frame): 6 planks" },
      { part: "roof", needs: { planks: 4 }, hint: "build roof (after walls): 4 planks" },
    ] },
  ],
};

/** The same homestead laid out differently: other names, another shape of land. */
export function variantHomestead(): HomesteadDef {
  return {
    ...HOMESTEAD, id: "homestead-v1-variant", start: "meadow",
    places: [
      { id: "meadow", name: "Sheep Meadow", kind: "clearing", description: "A meadow with a bench under an oak, and a marked plot." },
      { id: "pines", name: "Pine Stand", kind: "woods", description: "Dark pines." },
      { id: "scree", name: "Scree Slope", kind: "quarry", description: "Broken rock, no loose stones worth carrying." },
      { id: "barn", name: "Barn", kind: "shed", description: "A barn with tools hanging inside." },
    ],
    things: [
      { id: "hatchet", name: "Hatchet", kind: "axe", place: "barn", portable: true },
      ...[1, 2, 3, 4].map(i => ({ id: `pine-${i}`, name: `Pine ${i}`, kind: "tree", place: "pines", uses: 3 })),
      // No loose stones here: a pickaxe needs a stone from somewhere else.
      { id: "cairn-stone", name: "Cairn stone", kind: "stone", place: "meadow", portable: true },
      { id: "slope", name: "Scree face", kind: "rock", place: "scree", uses: 12 },
      { id: "oak-bench", name: "Oak bench", kind: "workbench", place: "meadow" },
      { id: "plot", name: "Marked plot", kind: "building-site", place: "meadow" },
    ],
  };
}

export const structurePartsDone = (built: readonly string[], structure: StructureDef) => structure.parts.every(p => built.includes(p.part));

/** A structure God may commission later (not in the first land). */
export const RAFT: StructureDef = { kind: "raft", name: "Raft", site: "building-site", parts: [
  { part: "deck", needs: { planks: 6 }, hint: "build deck: 6 planks" },
  { part: "lashing", needs: { rope: 2 }, hint: "build lashing (after deck): 2 rope" },
] };

/** What the world can grow when residents keep lacking something no recipe
 * gives: the Weaver designs it (spirits/recipe-weaver.ts). This fixed design
 * stands in for the Weaver offline. */
export const FIXED_ROPE_PATCH: WovenPatch = {
  item: "rope", reason: "Flax now grows in the woods, and a workbench can spin it into rope.",
  things: [{ name: "Flax patch", kind: "flax", placeKind: "woods", uses: 8 }],
  recipes: [
    { verb: "gather", at: "flax", gives: { flax: 1 }, spends: true, hint: "gather at a flax: 1 flax" },
    { verb: "craft", at: "workbench", product: "rope", needs: { flax: 2 }, gives: { rope: 1 }, hint: "craft rope at a workbench: 2 flax → 1 rope" },
  ],
};
