/** The Surveyor: the spirit who walks the town looking for what is missing for
 * it to feel real — not what residents lack (the Watcher and Weaver answer
 * that), but where the world is thin. Fishers who work the shallows with no
 * boat in sight; tools that never wear and so no smith; a town with no drink.
 *
 * Once a day it reads the town (trades, stations, goods, what is drawn and what
 * borrows a stand-in's look, places, conditions, what people say and mean to do,
 * what keeps failing) and names up to three opportunities, each in a lane a
 * builder can make real:
 *
 * - model:     a thing that should stand somewhere (a rowing boat on the
 *              shore) — the asset workshop draws it, the world places it;
 * - craft:     a trade or craft the town should have (blacksmithing) — the
 *              Weaver designs it as data the world validates;
 * - condition: something consumed that changes a body for a while (ale and
 *              drunkenness) — the Weaver designs the drink and the condition.
 *
 * The world validates every opportunity's shape here, and every design again
 * where it is built. Taken opportunities are remembered (with the town). */
import { generateText } from "ai";
import { spiritModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";

export type SurveyFacts = {
  trades: string[]; stations: string[]; goods: string[];
  /** Kinds drawn with their own model, and kinds still borrowing a stand-in's look. */
  drawn: string[]; standIns: string[];
  places: Array<{ name: string; kind: string }>; conditions: string[];
  /** Recent words and resolve, and what keeps failing for want of something. */
  talk: string[]; intentions: string[]; lacking: string[];
  /** Opportunities already taken up (not proposed again). */
  taken: string[];
};
export type Opportunity =
  | { lane: "model"; subject: string; why: string; kind: string; placeKind: string; size: { x: number; y: number; z: number } }
  | { lane: "craft" | "condition"; subject: string; why: string; item: string };
export type SurveyGenerator = (input: { system: string; prompt: string }) => Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }>;
export type SurveyStats = { surveys: number; proposed: number; refused: Array<{ subject: string; reason: string }>; tokensIn: number; tokensOut: number };

const KIND = /^[a-z][a-z-]{1,23}$/;
export const normalizeSubject = (subject: string) => subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const SURVEYOR_SYSTEM = `You are the Surveyor, the spirit who walks a small coastal town looking for where the world is thin: what a real town like this would have, that would make its people's lives richer and their days more varied. Not what residents lack today (other spirits answer that), but fidelity and opportunity. Answer with JSON only.`;

export function surveyorPrompt(f: SurveyFacts): string {
  const list = (xs: string[]) => xs.length ? xs.join("; ") : "none";
  return `The town as it stands:
Trades: ${list(f.trades)}.
Stations and sources: ${list(f.stations)}.
Goods: ${list(f.goods)}.
Drawn with their own look: ${list(f.drawn)}. Borrowing a stand-in's look: ${list(f.standIns)}.
Places (name — kind): ${f.places.map(p => `${p.name} — ${p.kind}`).join("; ")}.
Body conditions (drink, tiredness…): ${list(f.conditions)}.
Lately people said: ${list(f.talk.slice(-12).map(t => JSON.stringify(t.slice(0, 160))))}.
People mean to: ${list(f.intentions.slice(0, 10))}.
Work keeps failing for want of: ${list(f.lacking)}.
Already taken up (do not propose again): ${list(f.taken)}.

Name up to 3 opportunities, each in one lane:
- "model": a thing that should stand in a place to make it believable (for instance a rowing boat drawn up on the shore where fishers work). Give a kind (one lowercase hyphenated word), the placeKind it stands in (one of the place kinds above), and its size in metres {"x": width, "y": height, "z": depth}.
- "craft": a trade or craft the town should have (for instance a forge and a smith who mends tools that wear). Give the item it would make (one lowercase hyphenated word).
- "condition": something people could consume that changes them for a while (for instance ale, and drink going to the head). Give the item (the drink or food).
Prefer what grows out of what is already here and what people are saying. Each with one sentence of why.
JSON: {"opportunities":[{"lane":"model","subject":"Rowing boat","why":"…","kind":"rowing-boat","placeKind":"shore","size":{"x":1.4,"y":0.8,"z":4}},
{"lane":"craft","subject":"Blacksmithing","why":"…","item":"axe"},{"lane":"condition","subject":"Ale","why":"…","item":"ale"}]}`;
}

/** Check one proposed opportunity's shape against the world. */
export function validateOpportunity(raw: unknown, facts: SurveyFacts): { ok: true; opportunity: Opportunity } | { ok: false; reason: string } {
  const v = raw as any;
  const lane = String(v?.lane ?? ""), subject = String(v?.subject ?? "").trim().slice(0, 60), why = String(v?.why ?? "").trim().slice(0, 240);
  if (!["model", "craft", "condition"].includes(lane)) return { ok: false, reason: `unknown lane "${lane}"` };
  if (subject.length < 3 || !why) return { ok: false, reason: "an opportunity needs a subject and a why" };
  if (facts.taken.some(t => normalizeSubject(t) === normalizeSubject(subject))) return { ok: false, reason: `${subject} was already taken up` };
  if (lane === "model") {
    const kind = String(v.kind ?? "").trim().toLowerCase(), placeKind = String(v.placeKind ?? "").trim().toLowerCase();
    if (!KIND.test(kind)) return { ok: false, reason: `bad kind "${kind}"` };
    if (!facts.places.some(p => p.kind === placeKind)) return { ok: false, reason: `no place of kind "${placeKind}"` };
    const size = { x: Number(v.size?.x), y: Number(v.size?.y), z: Number(v.size?.z) };
    if (!(size.x >= .2 && size.x <= 8 && size.z >= .2 && size.z <= 8 && size.y >= .1 && size.y <= 6)) return { ok: false, reason: "a model is 0.2–8 m wide and deep, 0.1–6 m tall" };
    return { ok: true, opportunity: { lane, subject, why, kind, placeKind, size } };
  }
  const item = String(v.item ?? "").trim().toLowerCase();
  if (!KIND.test(item)) return { ok: false, reason: `bad item "${item}"` };
  return { ok: true, opportunity: { lane: lane as "craft" | "condition", subject, why, item } };
}

/** Survey the town: up to three validated opportunities (an invalid one is reported, not retried). */
export async function surveyOpportunities(facts: SurveyFacts, options: { generate?: SurveyGenerator; stats?: SurveyStats } = {}): Promise<Opportunity[]> {
  const generate: SurveyGenerator = options.generate ?? (async ({ system, prompt }) => generateText({ model: spiritModel, maxRetries: 1, maxOutputTokens: 2000,
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } }, system, messages: [{ role: "user", content: prompt }] }));
  const stats = options.stats;
  if (stats) stats.surveys++;
  let text = "";
  try {
    const answer = await generate({ system: SURVEYOR_SYSTEM, prompt: surveyorPrompt(facts) });
    text = answer.text;
    if (stats) { stats.tokensIn += Number(answer.usage?.inputTokens ?? 0) || 0; stats.tokensOut += Number(answer.usage?.outputTokens ?? 0) || 0; }
  } catch { return []; }
  let raw: any;
  try { raw = JSON.parse(extractJSON(text) ?? ""); } catch { return []; }
  const out: Opportunity[] = [];
  for (const candidate of (Array.isArray(raw?.opportunities) ? raw.opportunities : []).slice(0, 3)) {
    const checked = validateOpportunity(candidate, { ...facts, taken: [...facts.taken, ...out.map(o => o.subject)] });
    if (checked.ok) out.push(checked.opportunity);
    else stats?.refused.push({ subject: String(candidate?.subject ?? "?").slice(0, 60), reason: checked.reason });
  }
  if (stats) stats.proposed += out.length;
  return out;
}
