/** The Weaver's recipe craft: when residents keep lacking something nothing
 * in the world gives, the Weaver designs how the world could provide it — a
 * source that stands somewhere (a flax patch, a spring) and the recipes that
 * turn it into the thing — as data. The world validates the design before it
 * grows:
 *
 * - it must actually give what was lacking;
 * - nothing comes from nothing: a recipe without inputs works a limited source
 *   standing in a real kind of place;
 * - every input is something the world can already provide, or the patch does;
 * - small: at most three new things and three recipes.
 *
 * Hints residents read are written from the validated data, never taken from
 * the model's prose. Gaps arrive on the spirits' observation board
 * (resource_gap, evidence "item:<kind>"), the same board the Watcher reads. */
import { generateText } from "ai";
import type { World } from "../ecs/world";
import { spiritModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import { getObservationsByCategory, reportGapObservation } from "./observation-aggregator";
import { validateCondition, type LandCondition } from "../learning/settlement/conditions";

export type WovenThing = { name: string; kind: string; placeKind: string; uses?: number; portable?: boolean };
export type WovenRecipe = { verb: string; at: string; product?: string; needs?: Record<string, number>; tools?: string[];
  gives: Record<string, number>; spends?: boolean; durationS?: number; hint: string };
/** Something made that is eaten or drunk (it may bring on a condition). */
export type WovenFood = { kind: string; hunger?: number; thirst?: number; durationS: number; conditions?: Record<string, number> };
/** A tool wearing out into something else (an axe going blunt): what makes a mending trade worth having. */
export type WovenWear = { tool: string; uses: number; becomes: string };
/** A new trade: a role and the goods it keeps the stall stocked with (the Steward can move hands into it). */
export type WovenTrade = { role: string; duties: Array<{ item: string; stock: number }> };
export type WovenPatch = { item: string; reason: string; things: WovenThing[]; recipes: WovenRecipe[];
  foods?: WovenFood[]; conditions?: LandCondition[]; wear?: WovenWear[]; trade?: WovenTrade };

/** What a world tells the Weaver about itself, and how it grows. */
export interface RecipeWorld {
  manual(): string[];
  placeKinds(): string[];
  /** Kinds of standing things (sources, stations) that exist. */
  thingKinds(): string[];
  /** Kinds residents can already come to hold (lying about, or given by a recipe). */
  obtainableKinds(): string[];
  apply(patch: WovenPatch): void;
  /** Body conditions that already exist (a patch may raise them with a new drink). */
  conditionKinds?(): string[];
}

export type WeaverGenerator = (input: { system: string; prompt: string }) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
export type WeaverStats = { designs: number; applied: number; rejected: Array<{ item: string; reason: string }>; tokensIn: number; tokensOut: number };

const KIND = /^[a-z][a-z-]{1,23}$/, VERB = /^[a-z]{3,14}$/;
const RESERVED_VERBS = new Set(["move", "pickup", "build", "sell", "buy", "eat", "drink", "drop", "give"]);

/** Report that residents lack something (the Weaver's input). */
export function reportResourceGap(world: World, item: string, detail: string, source = "residents"): void {
  reportGapObservation({ source, category: "resource_gap", severity: "medium", title: `Residents lack ${item}`, detail,
    evidence: [`item:${item}`], affectedEntities: [item] }, world);
}
/** Lacked items on the board, most pressing first. */
export function lackedItems(world: World): string[] {
  return getObservationsByCategory("resource_gap", world)
    .flatMap(o => (o.mergedEvidence ?? o.evidence ?? []).filter(e => e.startsWith("item:")).map(e => e.slice(5)))
    .filter((item, i, all) => all.indexOf(item) === i);
}

export function recipeHint(r: Omit<WovenRecipe, "hint">): string {
  const list = (s?: Record<string, number>) => Object.entries(s ?? {}).map(([k, n]) => `${n} ${k}`).join(" + ");
  const needs = list(r.needs);
  return `${r.verb}${r.product ? ` ${r.product}` : ""} at a ${r.at}${r.tools?.length ? ` (hold ${r.tools.join(", ")})` : ""}: ${needs ? `${needs} → ` : ""}${list(r.gives)}`;
}

export function validatePatch(raw: unknown, item: string, world: RecipeWorld): { ok: true; patch: WovenPatch } | { ok: false; reason: string } {
  const value = raw as any;
  if (!value || typeof value !== "object") return { ok: false, reason: "not an object" };
  const things: unknown[] = Array.isArray(value.things) ? value.things : [], recipes: unknown[] = Array.isArray(value.recipes) ? value.recipes : [];
  if (things.length > 3 || recipes.length > 3 || !recipes.length) return { ok: false, reason: "a patch has 1–3 recipes and at most 3 things" };
  const places = new Set(world.placeKinds());
  const outThings: WovenThing[] = [];
  for (const t of things as any[]) {
    const kind = String(t?.kind ?? "").trim().toLowerCase(), placeKind = String(t?.placeKind ?? "").trim().toLowerCase();
    const name = String(t?.name ?? "").trim().slice(0, 40);
    if (!KIND.test(kind) || !name) return { ok: false, reason: `bad thing ${JSON.stringify(t)}` };
    if (!places.has(placeKind)) return { ok: false, reason: `no place of kind "${placeKind}" (places: ${[...places].join(", ")})` };
    const uses = t.uses === undefined ? undefined : Math.round(Number(t.uses));
    if (uses !== undefined && !(uses >= 1 && uses <= 30)) return { ok: false, reason: "a source has 1–30 uses" };
    outThings.push({ name, kind, placeKind, ...(uses !== undefined ? { uses } : {}), ...(t.portable ? { portable: true } : {}) });
  }
  const standing = new Set([...world.thingKinds(), ...outThings.filter(t => !t.portable).map(t => t.kind)]);
  const obtainable = new Set([...world.obtainableKinds(), ...outThings.filter(t => t.portable).map(t => t.kind)]);
  const stock = (s: unknown, max: number): Record<string, number> | null => {
    if (s === undefined || s === null) return {};
    if (typeof s !== "object") return null;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(s as Record<string, unknown>)) {
      const count = Math.round(Number(n)), kind = k.trim().toLowerCase();
      if (!KIND.test(kind) || !(count >= 1 && count <= max)) return null;
      out[kind] = count;
    }
    return out;
  };
  const outRecipes: WovenRecipe[] = [];
  for (const r of recipes as any[]) {
    const verb = String(r?.verb ?? "").trim().toLowerCase(), at = String(r?.at ?? "").trim().toLowerCase();
    if (!VERB.test(verb) || RESERVED_VERBS.has(verb)) return { ok: false, reason: `verb "${verb}" is not allowed` };
    if (!standing.has(at)) return { ok: false, reason: `nothing of kind "${at}" stands anywhere` };
    const needs = stock(r.needs, 6), gives = stock(r.gives, 4);
    if (!needs || !gives || !Object.keys(gives).length) return { ok: false, reason: `recipe ${verb} needs and gives must be small counts of kinds` };
    const tools = Array.isArray(r.tools) ? r.tools.map((t: unknown) => String(t).trim().toLowerCase()).filter((t: string) => KIND.test(t)).slice(0, 2) : [];
    const product = r.product ? String(r.product).trim().toLowerCase() : undefined;
    if (product !== undefined && !KIND.test(product)) return { ok: false, reason: "bad product" };
    const fromNothing = !Object.keys(needs).length;
    const source = outThings.find(t => t.kind === at);
    // Nothing from nothing: an input-free recipe works a limited source.
    if (fromNothing && !(source && source.uses !== undefined))
      return { ok: false, reason: `"${verb}" gives something from nothing at "${at}", which is not a limited source` };
    const durationS = r.durationS === undefined ? undefined : Math.max(5, Math.min(1800, Math.round(Number(r.durationS)) || 60));
    const recipe = { verb, at, ...(product ? { product } : {}), ...(Object.keys(needs).length ? { needs } : {}), ...(tools.length ? { tools } : {}),
      gives, ...(fromNothing ? { spends: true } : {}), ...(durationS ? { durationS } : {}) };
    outRecipes.push({ ...recipe, hint: recipeHint(recipe) });
  }
  // A tool wearing out provides its worn kind (a blunt axe to mend): count it as obtainable (the rule itself is checked below).
  for (const r of (Array.isArray(value.wear) ? value.wear : []) as any[]) { const worn = String(r?.becomes ?? "").trim().toLowerCase(); if (KIND.test(worn)) obtainable.add(worn); }
  // Inputs must be obtainable: already, or from this patch (in an order that works).
  const given = new Set(obtainable);
  for (let pass = 0; pass < 4; pass++) for (const r of outRecipes)
    if ([...Object.keys(r.needs ?? {}), ...(r.tools ?? [])].every(k => given.has(k))) for (const k of Object.keys(r.gives)) given.add(k);
  for (const r of outRecipes) for (const k of [...Object.keys(r.needs ?? {}), ...(r.tools ?? [])])
    if (!given.has(k)) return { ok: false, reason: `"${r.verb}" needs ${k}, which nothing provides` };
  if (!given.has(item) || !outRecipes.some(r => (r.gives[item] ?? 0) > 0) && !outThings.some(t => t.kind === item && t.portable))
    return { ok: false, reason: `the patch does not give ${item}` };
  // A new body condition (at most one): effects only from the vocabulary, within bounds.
  const conditions: LandCondition[] = [];
  for (const c of (Array.isArray(value.conditions) ? value.conditions : []).slice(0, 2)) {
    if (conditions.length) return { ok: false, reason: "at most one new condition per patch" };
    const checked = validateCondition(c);
    if (!checked.ok) return { ok: false, reason: `condition: ${checked.reason}` };
    conditions.push(checked.condition);
  }
  const knownConditions = new Set([...(world.conditionKinds?.() ?? []), ...conditions.map(c => c.kind)]);
  // Foods and drinks: things the world now provides, raising only conditions that exist.
  const foods: WovenFood[] = [];
  for (const f of (Array.isArray(value.foods) ? value.foods : []) as any[]) {
    if (foods.length >= 2) return { ok: false, reason: "at most two foods or drinks per patch" };
    const kind = String(f?.kind ?? "").trim().toLowerCase();
    if (!KIND.test(kind) || !given.has(kind)) return { ok: false, reason: `food "${kind}" is not something residents can get` };
    const hunger = f.hunger === undefined ? undefined : Math.round(Number(f.hunger)), thirst = f.thirst === undefined ? undefined : Math.round(Number(f.thirst));
    if (hunger !== undefined && !(hunger >= 0 && hunger <= 60) || thirst !== undefined && !(thirst >= 0 && thirst <= 80)) return { ok: false, reason: `food ${kind}: hunger 0–60, thirst 0–80` };
    const raises: Record<string, number> = {};
    for (const [condition, amount] of Object.entries(f.conditions ?? {})) {
      const n = Number(amount);
      if (!knownConditions.has(condition)) return { ok: false, reason: `food ${kind} raises "${condition}", which is no condition here` };
      if (!(n >= .05 && n <= .6)) return { ok: false, reason: `food ${kind} raises ${condition} by 0.05–0.6` };
      raises[condition] = n;
    }
    if (!hunger && !thirst && !Object.keys(raises).length) return { ok: false, reason: `food ${kind} must feed, quench or bring something on` };
    foods.push({ kind, ...(hunger ? { hunger } : {}), ...(thirst ? { thirst } : {}), durationS: Math.max(10, Math.min(600, Math.round(Number(f.durationS)) || 60)),
      ...(Object.keys(raises).length ? { conditions: raises } : {}) });
  }
  // Tools wearing out (at most two rules): a tool people can get becomes something else after some uses.
  const wear: WovenWear[] = [];
  for (const r of (Array.isArray(value.wear) ? value.wear : []) as any[]) {
    if (wear.length >= 2) return { ok: false, reason: "at most two wear rules per patch" };
    const tool = String(r?.tool ?? "").trim().toLowerCase(), becomes = String(r?.becomes ?? "").trim().toLowerCase(), uses = Math.round(Number(r?.uses));
    if (!KIND.test(tool) || !given.has(tool)) return { ok: false, reason: `wear: "${tool}" is not a tool residents can get` };
    if (!KIND.test(becomes) || becomes === tool || !(uses >= 3 && uses <= 60)) return { ok: false, reason: `wear: ${tool} wears into another kind after 3–60 uses` };
    wear.push({ tool, uses, becomes });
  }
  // A new trade (at most one): its duties must be goods the world now makes.
  let trade: WovenTrade | undefined;
  if (value.trade) {
    const role = String(value.trade.role ?? "").trim().toLowerCase();
    const duties = (Array.isArray(value.trade.duties) ? value.trade.duties : []).slice(0, 3).map((d: any) => ({ item: String(d?.item ?? "").trim().toLowerCase(), stock: Math.round(Number(d?.stock)) }));
    if (!KIND.test(role) || !duties.length) return { ok: false, reason: "a trade has a role (one word) and 1–3 duties" };
    for (const d of duties) if (!given.has(d.item) || !(d.stock >= 1 && d.stock <= 12)) return { ok: false, reason: `trade ${role}: duty ${d.item} must be something made here, stock 1–12` };
    trade = { role, duties };
  }
  return { ok: true, patch: { item, reason: String(value.reason ?? "").slice(0, 300), things: outThings, recipes: outRecipes,
    ...(foods.length ? { foods } : {}), ...(conditions.length ? { conditions } : {}), ...(wear.length ? { wear } : {}), ...(trade ? { trade } : {}) } };
}

function weaverPrompt(item: string, detail: string, world: RecipeWorld, previous?: string) {
  return {
    system: "You are the Weaver, the spirit who grows the world's mechanics. You add what a small, believable world would have: natural sources and the crafts that work them. Answer with JSON only.",
    prompt: `Wanted: ${item}. ${detail}

How things are made here now: ${world.manual().join("; ")}.
Kinds of place: ${world.placeKinds().join(", ")}.
Standing things (sources, stations): ${world.thingKinds().join(", ")}.
Things residents can already get: ${world.obtainableKinds().join(", ")}.
Body conditions that exist: ${world.conditionKinds?.().join(", ") || "none yet"}.
${previous ? `Your last design was refused: ${previous}\n` : ""}
Design how this world could provide ${item}: at most 3 new standing things or portable finds, and 1–3 recipes. Keep it grounded in what already exists;
reuse existing stations where they fit. Nothing comes from nothing: a recipe with no inputs must be done at a new source with limited "uses" (1–30).
Every input must be something residents can already get or that your recipes give. Verbs are one lowercase word (not move/pickup/build/sell/buy/eat/drink).
JSON: {"reason":"one sentence","things":[{"name":"Flax patch","kind":"flax-patch","placeKind":"<a kind of place>","uses":8}],
"recipes":[{"verb":"gather","at":"flax-patch","gives":{"flax":1},"durationS":60},{"verb":"craft","at":"workbench","product":"rope","needs":{"flax":2},"gives":{"rope":1}}]}
Optional, only when the wanted thing calls for them:
- "foods": up to 2 things your recipes give that are eaten or drunk: {"kind":"ale","thirst":20,"durationS":60,"conditions":{"drunk":0.3}} (hunger 0–60, thirst 0–80; conditions raise a body condition by 0.05–0.6).
- "conditions": at most 1 new body condition: {"kind":"drunk","name":"Drink","wearsOffPerHour":0.15,"effects":{"work":-0.4,"walk":-0.3,"attention":0.4},
  "labels":{"mild":"tipsy","strong":"drunk"},"feels":{"mild":"how it feels, second person","strong":"…","gone":"…"}} — effects only work, walk (−0.6…0.3) and attention (−0.6…0.6).
- "wear": up to 2 tools wearing out: {"tool":"axe","uses":20,"becomes":"blunt-axe"} — so a mending or smithing trade has work to do.
- "trade": one new trade when the work deserves a person: {"role":"smith","duties":[{"item":"axe","stock":2}]} (duties: goods your recipes make, kept on the stall).`,
  };
}

/** Design, validate (one retry with the refusal), apply. */
export async function weaveForGap(item: string, detail: string, world: RecipeWorld, options: { generate?: WeaverGenerator; stats?: WeaverStats } = {}):
  Promise<{ ok: true; patch: WovenPatch } | { ok: false; reason: string }> {
  const stats = options.stats;
  const generate: WeaverGenerator = options.generate ?? (async ({ system, prompt }) => generateText({ model: spiritModel, maxRetries: 1, maxOutputTokens: 3000,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } }, system, messages: [{ role: "user", content: prompt }] }));
  let refusal: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (stats) stats.designs++;
    let text = "";
    try {
      const response = await generate(weaverPrompt(item, detail, world, refusal));
      text = response.text;
      if (stats) { stats.tokensIn += Number(response.usage?.inputTokens ?? 0) || 0; stats.tokensOut += Number(response.usage?.outputTokens ?? 0) || 0; }
    } catch (error) { refusal = `the design request failed (${error instanceof Error ? error.message : error})`; continue; }
    let raw: unknown;
    try { raw = JSON.parse(extractJSON(text) ?? ""); } catch { refusal = "the answer was not JSON"; continue; }
    const checked = validatePatch(raw, item, world);
    if (!checked.ok) { refusal = checked.reason; continue; }
    world.apply(checked.patch);
    if (stats) stats.applied++;
    return checked;
  }
  stats?.rejected.push({ item, reason: refusal ?? "no design" });
  return { ok: false, reason: refusal ?? "no design" };
}
