/** The settlement's crafts in the walkable world: the same recipe data as the
 * headless settlement (learning/settlement/saltmere-land.ts), installed as
 * timed physical operations beside the story verbs. A resident (or the
 * player) walks to a tree and chops it; the log appears in their hand when the
 * chop completes. Eating a cooked fish eases hunger. The stall buys and sells
 * at the land's prices; plots are raised part by part and become buildings.
 *
 * The spatial executor owns walking, reservations, timing and receipts; this
 * module decides what an operation needs, what it takes at the start and what
 * it gives at the end, exactly as the headless settlement does. */
import { entityExists, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Needs } from "../ecs/components";
import { getDirectContainer, listDirectContents } from "../ecs/location";
import type { LandDef, LandRecipe, LandStructure } from "../learning/settlement/saltmere-land";

export type RecipeOperation = { actor: number; actorKey: string; target: number; targetKey: string; verb: string; argument: string;
  gives: Record<string, number>; took: number[]; tools: string[]; food?: LandDef["foods"][number]; trade?: { kind: string; price: number; item?: number };
  build?: { structure: LandStructure; part: string } };

export type SpatialRecipeHost = {
  world: World;
  land: LandDef;
  /** The settlement kind of an entity (a tree, a log, a stall), if any. */
  kindOf(eid: number): string | undefined;
  setKind(eid: number, kind: string): void;
  key(eid: number): string;
  /** A new item of this kind in the actor's hand. */
  spawnInHand(actor: number, kind: string): number | undefined;
  /** Take an item out of the world (used up). */
  consume(item: number): void;
  /** Put an item on the stall. */
  stock(item: number, stall: number): void;
  /** Hand an item from the stall to the actor. */
  handOver(item: number, actor: number): boolean;
  /** A finished structure: change the plot's look. */
  raised(plot: number, structure: LandStructure, count: number): void;
  record(line: string): void;
};

const title = (kind: string) => kind.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

export function createSpatialRecipes(host: SpatialRecipeHost) {
  const { world: w, land } = host;
  const uses = new Map<number, number>(), wear = new Map<number, number>(), plotParts = new Map<number, string[]>(), plotBusy = new Set<number>();
  const coins = new Map<number, number>(), builtCount: Record<string, number> = {};
  let treasury = land.treasury;
  const hand = (actor: number) => listDirectContents(w, actor).filter(e => entityExists(w, e));
  const held = (actor: number, kind: string) => hand(actor).filter(e => host.kindOf(e) === kind);
  const recipesAt = (kind: string | undefined) => kind ? land.recipes.filter(r => r.at === kind) : [];
  const structureOn = (kind: string | undefined) => land.structures.find(s => s.plot === kind);
  const usable = (eid: number) => (uses.get(eid) ?? 1) > 0;

  function coinsOf(actor: number): number {
    if (!coins.has(actor)) coins.set(actor, land.residents.find(r => r.name === Name.value[actor])?.coins ?? 10);
    return coins.get(actor)!;
  }
  function lacking(actor: number, needs: Record<string, number> = {}, tools: readonly string[] = []) {
    for (const tool of tools) if (!held(actor, tool).length) return { kind: tool, count: 1 };
    for (const [k, n] of Object.entries(needs)) { const have = held(actor, k).length; if (have < n) return { kind: k, count: n - have }; }
    return undefined;
  }

  return {
    /** Install a limited source's uses (from the land data). */
    installSource(eid: number, thingUses: number | undefined) { if (thingUses !== undefined) uses.set(eid, thingUses); },
    coinsOf, treasury: () => treasury, builtCount: () => ({ ...builtCount }),

    verbs(actor: number, target: number): string[] {
      const kind = host.kindOf(target);
      if (!kind) return [];
      const verbs = recipesAt(kind).map(r => r.verb);
      if (structureOn(kind)) verbs.push("build");
      if (kind === "stall") verbs.push("buy", "sell");
      const food = land.foods.find(f => f.kind === kind);
      if (food && getDirectContainer(w, target) === actor) verbs.push(food.thirst && !food.hunger ? "drink" : "eat");
      return [...new Set(verbs)];
    },

    prepare(actor: number, target: number, verb: string, argument: string):
      { ok: true; operation: RecipeOperation; durationMs: number } | { ok: false; reason: string } {
      const kind = host.kindOf(target), arg = argument.trim().toLowerCase();
      const op: RecipeOperation = { actor, actorKey: host.key(actor), target, targetKey: host.key(target), verb, argument: arg, gives: {}, took: [], tools: [] };
      if (verb === "eat" || verb === "drink") {
        const food = land.foods.find(f => f.kind === kind);
        if (!food || getDirectContainer(w, target) !== actor) return { ok: false, reason: "Hold it first." };
        op.food = food; op.took = [target];
        return { ok: true, operation: op, durationMs: food.durationS * 1000 / 10 };
      }
      if (verb === "sell" || verb === "buy") {
        if (kind !== "stall") return { ok: false, reason: "Trade happens at the market stall." };
        const price = land.prices[arg];
        if (price === undefined) return { ok: false, reason: `The stall does not trade ${arg || "that"}. It trades: ${Object.keys(land.prices).join(", ")}.` };
        if (verb === "sell") {
          const item = held(actor, arg)[0];
          if (item === undefined) return { ok: false, reason: `You hold no ${arg}.` };
          if (listDirectContents(w, target).filter(e => host.kindOf(e) === arg).length >= land.stallCap) return { ok: false, reason: `The stall has enough ${arg}.` };
          const paid = Math.max(1, Math.floor(price * .75));
          if (treasury < paid) return { ok: false, reason: "The town cannot pay today." };
          op.trade = { kind: arg, price: paid, item };
          return { ok: true, operation: op, durationMs: 4000 };
        }
        const item = listDirectContents(w, target).find(e => host.kindOf(e) === arg);
        if (item === undefined) return { ok: false, reason: `The stall has no ${arg}.` };
        if (coinsOf(actor) < price) return { ok: false, reason: `${arg} costs ${price}; you have ${coinsOf(actor)}.` };
        op.trade = { kind: arg, price, item };
        return { ok: true, operation: op, durationMs: 4000 };
      }
      if (verb === "build") {
        const structure = structureOn(kind);
        if (!structure) return { ok: false, reason: "Nothing is built here." };
        const done = plotParts.get(target) ?? [], next = structure.parts.find(p => !done.includes(p.part));
        const part = structure.parts.find(p => p.part === arg) ?? next;
        if (!part || !next || done.includes(part.part)) return { ok: false, reason: "That part already stands." };
        if (part !== next) return { ok: false, reason: `Build the ${next.part} first.` };
        if (plotBusy.has(target)) return { ok: false, reason: "Someone is already building here." };
        const lack = lacking(actor, part.needs);
        if (lack) return { ok: false, reason: `The ${part.part} needs ${lack.count} more ${lack.kind}.` };
        for (const [k, n] of Object.entries(part.needs)) op.took.push(...held(actor, k).slice(0, n));
        op.build = { structure, part: part.part };
        return { ok: true, operation: op, durationMs: part.durationS * 1000 / 10 };
      }
      const recipe: LandRecipe | undefined = recipesAt(kind).find(r => r.verb === verb && (!r.product || !arg || r.product === arg || Object.keys(r.gives).includes(arg)));
      if (!recipe) {
        const options = recipesAt(kind).map(r => `${r.verb}${r.product ? ` ${r.product}` : ""}`);
        return { ok: false, reason: `You can't ${verb} here.${options.length ? ` Here you can: ${options.join(", ")}.` : ""}` };
      }
      if (recipe.spends && !usable(target)) return { ok: false, reason: `${Name.value[target]} is spent for now.` };
      const lack = lacking(actor, recipe.needs, recipe.tools);
      if (lack) return { ok: false, reason: `To ${verb}${recipe.product ? ` ${recipe.product}` : ""} you need ${lack.count} more ${lack.kind}.` };
      for (const [k, n] of Object.entries(recipe.needs ?? {})) op.took.push(...held(actor, k).slice(0, n));
      op.gives = { ...recipe.gives }; op.tools = [...(recipe.tools ?? [])];
      // Game time: a recipe's minutes pass ten times faster than the land's accounting.
      return { ok: true, operation: op, durationMs: (recipe.durationS ?? 120) * 1000 / 10 };
    },

    /** Still possible at completion? (materials still in hand, source not taken meanwhile) */
    validate(op: RecipeOperation): string | undefined {
      if (op.took.some(e => !entityExists(w, e) || getDirectContainer(w, e) !== op.actor)) return "What you were using is no longer in your hands.";
      if (op.trade?.item !== undefined && !entityExists(w, op.trade.item)) return "The goods are gone.";
      if (op.gives && Object.keys(op.gives).length && !op.build && recipesAt(host.kindOf(op.target)).some(r => r.spends) && !usable(op.target)) return `${Name.value[op.target]} is spent.`;
      if (op.tools.some(t => !held(op.actor, t).length)) return "You no longer hold the tool.";
    },

    commit(op: RecipeOperation): { success: boolean; detail: string } {
      const actorName = Name.value[op.actor];
      if (op.food) {
        for (const e of op.took) host.consume(e);
        if (hasComponent(w, op.actor, Needs) && op.food.hunger) Needs.hunger[op.actor] = Math.max(0, (Needs.hunger[op.actor] ?? 0) - op.food.hunger);
        return { success: true, detail: `You ${op.verb === "drink" ? "drank" : "ate"} the ${op.food.kind.replace(/-/g, " ")}.` };
      }
      if (op.trade) {
        if (op.verb === "sell") {
          host.stock(op.trade.item!, op.target); coins.set(op.actor, coinsOf(op.actor) + op.trade.price); treasury -= op.trade.price;
          return { success: true, detail: `You sold ${op.trade.kind} for ${op.trade.price} coin (now ${coinsOf(op.actor)}).` };
        }
        if (coinsOf(op.actor) < op.trade.price || !host.handOver(op.trade.item!, op.actor)) return { success: false, detail: "The sale fell through." };
        coins.set(op.actor, coinsOf(op.actor) - op.trade.price); treasury += op.trade.price;
        return { success: true, detail: `You bought ${op.trade.kind} for ${op.trade.price} coin (now ${coinsOf(op.actor)}).` };
      }
      if (op.build) {
        for (const e of op.took) host.consume(e);
        const parts = [...(plotParts.get(op.target) ?? []), op.build.part];
        plotParts.set(op.target, parts); plotBusy.delete(op.target);
        const pay = Math.min(land.buildPay, treasury); coins.set(op.actor, coinsOf(op.actor) + pay); treasury -= pay;
        if (parts.length === op.build.structure.parts.length) {
          builtCount[op.build.structure.kind] = (builtCount[op.build.structure.kind] ?? 0) + 1;
          host.setKind(op.target, op.build.structure.becomes);
          host.raised(op.target, op.build.structure, builtCount[op.build.structure.kind]);
          plotParts.delete(op.target);
          host.record(`${actorName} finished the ${op.build.structure.name.toLowerCase()}.`);
          return { success: true, detail: `You built the ${op.build.part}: the ${op.build.structure.name} is finished.` };
        }
        return { success: true, detail: `You built the ${op.build.part} of the ${op.build.structure.name.toLowerCase()}.` };
      }
      for (const e of op.took) host.consume(e);
      if (uses.has(op.target) && recipesAt(host.kindOf(op.target)).some(r => r.spends)) uses.set(op.target, uses.get(op.target)! - 1);
      const made: string[] = [];
      for (const [kind, n] of Object.entries(op.gives)) for (let i = 0; i < n; i++) if (host.spawnInHand(op.actor, kind) !== undefined) made.push(kind);
      for (const tool of op.tools) {
        const rule = land.wear.find(r => r.tool === tool), item = held(op.actor, tool)[0];
        if (!rule || item === undefined) continue;
        const left = (wear.get(item) ?? rule.uses) - 1;
        wear.set(item, left);
        if (left <= 0) { host.setKind(item, rule.becomes); Name.value[item] = `${title(rule.becomes)}`; }
      }
      return { success: made.length > 0, detail: made.length ? `You ${op.verb}${op.argument ? ` ${op.argument}` : ""} and now hold ${Object.entries(op.gives).map(([k, n]) => `${n} ${k.replace(/-/g, " ")}`).join(", ")}.` : "Nothing came of it." };
    },

    /** Mark a plot busy when a build starts walking to it. */
    reserve(op: RecipeOperation) { if (op.build) plotBusy.add(op.target); },
    release(op: RecipeOperation) { if (op.build) plotBusy.delete(op.target); },

    /** What a resident reads about the settlement's crafts and market. */
    context(actor: number): string {
      const lines = land.recipes.map(r => `${r.verb}${r.product ? ` ${r.product}` : ""} at a ${r.at}${r.tools?.length ? ` (hold ${r.tools.join(", ")})` : ""}: ${Object.entries(r.needs ?? {}).map(([k, n]) => `${n} ${k}`).join(" + ")}${r.needs ? " → " : ""}${Object.entries(r.gives).map(([k, n]) => `${n} ${k}`).join(", ")}`);
      const builds = land.structures.map(s => `build a ${s.name} on a ${s.plot} (${s.parts.map(p => p.part).join(", ")})`);
      return `HOW THINGS ARE MADE HERE (interact target="<thing>" content="<verb> [product]"): ${[...lines, ...builds].join("; ")}. `
        + `The market stall buys and sells (content="sell <item>" / "buy <item>"); prices: ${Object.entries(land.prices).map(([k, n]) => `${k} ${n}`).join(", ")}. You have ${coinsOf(actor)} coin. Eat what you hold with content="eat".`;
    },
  };
}
