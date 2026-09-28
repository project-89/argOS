/** Private reflection output, not goals, world facts, or execution authority.
 * Kept on the existing actor-owned ReflectionState rather than a new controller. */
import { getRelationTargets, hasComponent } from "bitecs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { World } from "../ecs/world";
import { ReflectionState } from "../ecs/components";
import { HasReflectionState } from "../ecs/relations";
import { readSimulationTime } from "../ecs/simulation-time";

const text = z.string().trim().min(1).max(400).refine(s => !/[\u0000-\u001f\u007f]/u.test(s));
const sourceIds = z.array(z.string().min(1).max(160)).min(1).max(8)
  .refine(ids => new Set(ids).size === ids.length);
export const raisedReflectionQuestionSchema = z.union([text, z.object({ question: text, sourceIds }).strict()]);
export type RaisedReflectionQuestion = z.infer<typeof raisedReflectionQuestionSchema>;
const evidence = z.array(z.object({ id: z.string().min(1).max(160), excerpt: z.string().max(1000) }).strict()).min(1).max(8)
  .refine(rows => new Set(rows.map(row => row.id)).size === rows.length);
export const reflectionQuestionReviewSchema = z.object({
  id: z.string().min(1).max(100), status: z.enum(["open", "answered", "parked"]),
  reason: text, sourceIds,
}).strict();
export type ReflectionQuestionReview = z.infer<typeof reflectionQuestionReviewSchema>;
const questionSchema = z.object({ id: z.string().min(1).max(100), question: text,
  status: z.enum(["candidate", "open", "answered", "parked"]), raisedAtSimMs: z.number().finite().nonnegative(),
  origin: z.object({ consideredAtSimMs: z.number().finite().nonnegative(), requestId: z.string().min(1).max(100), evidence }).strict().optional(),
  review: z.object({ reason: text, atSimMs: z.number().finite().nonnegative(),
    evidence,
  }).strict().optional(),
}).strict().refine(row => row.status !== "candidate" || !!row.origin && !row.review);
export type ReflectionQuestion = z.infer<typeof questionSchema>;
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
export function getReflectionQuestions(world: World, eid: number): ReflectionQuestion[] {
  const state = getRelationTargets(world, eid, HasReflectionState).find(id => hasComponent(world, id, ReflectionState));
  if (state === undefined) return [];
  try {
    const rows = JSON.parse(ReflectionState.questions[state] || "[]");
    if (!Array.isArray(rows)) return [];
    const seen = new Set<string>();
    return rows.flatMap(row => {
      const parsed = questionSchema.safeParse(row);
      if (!parsed.success || seen.has(parsed.data.id) || parsed.data.raisedAtSimMs > readSimulationTime(world)
        || parsed.data.review && parsed.data.review.atSimMs > readSimulationTime(world)
        || parsed.data.origin && parsed.data.origin.consideredAtSimMs > parsed.data.raisedAtSimMs) return [];
      seen.add(parsed.data.id); return [parsed.data];
    }).slice(-12);
  } catch { return []; }
}

/** Pure preparation. The reflection admission owns source, actor and freshness
 * checks before committing this value; a review must cite that issued catalogue. */
export function prepareReflectionQuestions(world: World, eid: number, raised: unknown,
  reviews: unknown = [], sources: ReadonlyMap<string, string> = new Map(),
  admission?: { candidateKeys: ReadonlySet<string>; consideredAtSimMs: number; requestId: string }): ReflectionQuestion[] | null {
  const newQuestions = z.array(raisedReflectionQuestionSchema).max(4).safeParse(raised);
  const updates = z.array(reflectionQuestionReviewSchema).max(4).safeParse(reviews);
  if (!newQuestions.success || !updates.success || new Set(updates.data.map(r => r.id)).size !== updates.data.length) return null;
  const rows = getReflectionQuestions(world, eid), now = readSimulationTime(world);
  for (const update of updates.data) {
    const row = rows.find(r => r.id === update.id);
    if (!row || update.sourceIds.some(id => !sources.has(id)) || new Set(update.sourceIds).size !== update.sourceIds.length) return null;
    row.status = update.status;
    row.review = { reason: update.reason, atSimMs: now,
      evidence: update.sourceIds.map(id => ({ id, excerpt: sources.get(id)!.slice(0, 1000) })) };
  }
  for (let index = 0; index < newQuestions.data.length; index++) {
    const value = newQuestions.data[index], question = typeof value === "string" ? value : value.question;
    if (typeof value !== "string" && value.sourceIds.some(id => !sources.has(id))) return null;
    // Keys refer to the exact validated output, before zod trims its prose.
    const candidate = admission?.candidateKeys.has(JSON.stringify((raised as unknown[])[index])) ?? false;
    if (candidate && (typeof value === "string" || !admission)) return null;
    // Repeating a parked/answered question does not silently reopen it.
    if (rows.some(r => normalize(r.question) === normalize(question))) continue;
    if (rows.length >= 12) {
      const closed = rows.findIndex(r => r.status === "answered" || r.status === "parked");
      if (closed < 0) continue; // Do not evict an unresolved question for novelty.
      rows.splice(closed, 1);
    }
    rows.push({ id: `question:${randomUUID()}`, question, status: candidate ? "candidate" : "open", raisedAtSimMs: now,
      ...(typeof value !== "string" && admission ? { origin: { consideredAtSimMs: admission.consideredAtSimMs, requestId: admission.requestId,
        evidence: value.sourceIds.map(id => ({ id, excerpt: sources.get(id)!.slice(0, 1000) })) } } : {}) });
  }
  return rows;
}
export function formatReflectionQuestions(world: World, eid: number, includeCandidates = false): string {
  const all = getReflectionQuestions(world, eid), rows = all.filter(row => row.status !== "candidate");
  const candidates = includeCandidates ? all.filter(row => row.status === "candidate") : [];
  const current = rows.length ? `MY QUESTIONS (private uncertainties and my interpretations, not verified answers or obligations):\n`
    + rows.map(row => JSON.stringify(row)).join("\n")
    + "\nIf a question matters to your chosen purpose, consider who or what could supply useful evidence. A response is not necessarily an answer. You may investigate, leave it open, or decide it is not worth pursuing.\n" : "";
  return current + (candidates.length ? `\nHISTORICAL QUESTION CANDIDATES (private past interpretations, not current questions, facts or tasks):\n`
    + candidates.map(row => JSON.stringify(row)).join("\n")
    + "\nThese were considered from the recorded evidence while the situation changed. Reconsider against this request's current evidence using questionReviews: open if still relevant, answered if supported, or parked. Stored excerpts are historical context, not new proof or permission to act.\n" : "");
}
