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

export type WovenThing = { name: string; kind: string; placeKind: string; uses?: number; portable?: boolean };
export type WovenRecipe = { verb: string; at: string; product?: string; needs?: Record<string, number>; tools?: string[];
  gives: Record<string, number>; spends?: boolean; durationS?: number; hint: string };
export type WovenPatch = { item: string; reason: string; things: WovenThing[]; recipes: WovenRecipe[] };

/** What a world tells the Weaver about itself, and how it grows. */
export interface RecipeWorld {
  manual(): string[];
  placeKinds(): string[];
  /** Kinds of standing things (sources, stations) that exist. */
  thingKinds(): string[];
  /** Kinds residents can already come to hold (lying about, or given by a recipe). */
  obtainableKinds(): string[];
  apply(patch: WovenPatch): void;
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
  // Inputs must be obtainable: already, or from this patch (in an order that works).
  const given = new Set(obtainable);
  for (let pass = 0; pass < 4; pass++) for (const r of outRecipes)
    if ([...Object.keys(r.needs ?? {}), ...(r.tools ?? [])].every(k => given.has(k))) for (const k of Object.keys(r.gives)) given.add(k);
  for (const r of outRecipes) for (const k of [...Object.keys(r.needs ?? {}), ...(r.tools ?? [])])
    if (!given.has(k)) return { ok: false, reason: `"${r.verb}" needs ${k}, which nothing provides` };
  if (!given.has(item) || !outRecipes.some(r => (r.gives[item] ?? 0) > 0) && !outThings.some(t => t.kind === item && t.portable))
    return { ok: false, reason: `the patch does not give ${item}` };
  return { ok: true, patch: { item, reason: String(value.reason ?? "").slice(0, 300), things: outThings, recipes: outRecipes } };
}

function weaverPrompt(item: string, detail: string, world: RecipeWorld, previous?: string) {
  return {
    system: "You are the Weaver, the spirit who grows the world's mechanics. You add what a small, believable world would have: natural sources and the crafts that work them. Answer with JSON only.",
    prompt: `Residents keep lacking: ${item}. ${detail}

How things are made here now: ${world.manual().join("; ")}.
Kinds of place: ${world.placeKinds().join(", ")}.
Standing things (sources, stations): ${world.thingKinds().join(", ")}.
Things residents can already get: ${world.obtainableKinds().join(", ")}.
${previous ? `Your last design was refused: ${previous}\n` : ""}
Design how this world could provide ${item}: at most 3 new standing things or portable finds, and 1–3 recipes. Keep it grounded in what already exists;
reuse existing stations where they fit. Nothing comes from nothing: a recipe with no inputs must be done at a new source with limited "uses" (1–30).
Every input must be something residents can already get or that your recipes give. Verbs are one lowercase word (not move/pickup/build/sell/buy/eat/drink).
JSON: {"reason":"one sentence","things":[{"name":"Flax patch","kind":"flax-patch","placeKind":"<a kind of place>","uses":8}],
"recipes":[{"verb":"gather","at":"flax-patch","gives":{"flax":1},"durationS":60},{"verb":"craft","at":"workbench","product":"rope","needs":{"flax":2},"gives":{"rope":1}}]}`,
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
