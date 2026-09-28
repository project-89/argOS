/** A receipt appraisal may reorganize subjective personal intentions, never
 * rewrite assigned work or declare a physical outcome. All edits prepare before
 * any write; retired strategies and their plans remain inspectable history. */
import { entityExists, getRelationTargets, hasComponent } from "bitecs";
import { z } from "zod";
import { Agent, Goal, GoalLifecycle, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import type { World } from "../ecs/world";
import { stampSimulationTime } from "../ecs/temporal-age";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { computeGoalSignature, ensureGoalSignature, stableJsonStringify, type GoalKind } from "./goal-contract";
import { retireGoalDependents } from "./goal-dependents";
import { settleReviewedGoalActivity } from "./ongoing-activity";
import { retireGoalPlans } from "./plan-state";

const reason = z.string().trim().min(1).max(180).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const description = z.string().trim().min(1).max(300).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const fragment = z.string().max(300).refine(s => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s));
const intentionEditsSchema = z.array(z.discriminatedUnion("op", [
  z.object({ op:z.literal("replace"), before:fragment.refine(s=>s.trim().length>0), after:fragment }).strict(),
  z.object({ op:z.literal("append"), text:description }).strict(),
])).min(1).max(4);

/** Apply explicit, non-overlapping edits against ONE captured definition.
 * No model rewrite, fuzzy matching or semantic keyword rules: omitted details
 * remain unchanged. Deliberately replacing/removing a detail is still allowed.
 * Invalid, ambiguous, overlapping or over-budget edits reject atomically. */
function editedIntention(original: string, edits: z.infer<typeof intentionEditsSchema>): string | undefined {
  const replacements: { start:number; end:number; text:string }[] = [];
  let appended: string | undefined;
  for (const edit of edits) {
    if (edit.op === "append") {
      if (appended !== undefined) return;
      appended=edit.text;
    } else {
      const start=original.indexOf(edit.before);
      if (start<0 || original.indexOf(edit.before,start+1)!==-1 || edit.before===edit.after) return;
      replacements.push({start,end:start+edit.before.length,text:edit.after});
    }
  }
  replacements.sort((a,b)=>a.start-b.start);
  if (replacements.some((r,i)=>i>0 && r.start<replacements[i-1].end)) return;
  let next=original;
  for (const r of replacements.reverse()) next=next.slice(0,r.start)+r.text+next.slice(r.end);
  if (appended !== undefined) next=`${next} ${appended}`;
  const parsed=description.safeParse(next);
  if (!parsed.success || original.trim().replace(/\s+/g," ")===parsed.data.replace(/\s+/g," ")) return;
  return parsed.data;
}

export const intentionRevisionSchema = z.discriminatedUnion("disposition", [
  z.object({ goalId: z.number().int().nonnegative(), disposition: z.literal("reprioritize"),
    priority: z.number().int().min(1).max(10), reason }).strict(),
  z.object({ goalId: z.number().int().nonnegative(), disposition: z.literal("release"), reason }).strict(),
  z.object({ goalId: z.number().int().nonnegative(), disposition: z.literal("withdraw"), reason }).strict(),
  z.object({ goalId: z.number().int().nonnegative(), disposition: z.literal("refine"), edits:intentionEditsSchema, reason }).strict(),
]);
export const intentionRevisionsSchema = z.array(intentionRevisionSchema).min(1).max(3)
  .refine(rows => new Set(rows.map(row => row.goalId)).size === rows.length);
const owned = (world: World, eid: number) => getRelationTargets(world, eid, HasGoal);
function eligible(world: World, eid: number, goal: number): boolean {
  if (!entityExists(world, eid) || !hasComponent(world, eid, Agent) || !Agent.active[eid]
    || !hasComponent(world, eid, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid]
    || !owned(world, eid).includes(goal) || !hasComponent(world, goal, Goal)
    || !hasComponent(world, goal, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[goal]
    || !hasComponent(world, goal, GoalLifecycle) || !["active", "paused"].includes(Goal.status[goal])
    || !["foreground", "autonomous", "personal"].includes(GoalLifecycle.source[goal])
    || !["social", "exploratory"].includes(GoalLifecycle.mode[goal])) return false;
  try { return JSON.parse(Goal.successJson[goal]).type === "custom"; } catch { return false; }
}
const basis = (goal: number) => JSON.stringify([WorkingMemoryIdentity.id[goal], Goal.createdAt[goal],
  Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal], Goal.status[goal],
  Goal.priority[goal], Goal.progress[goal], GoalLifecycle.source[goal], GoalLifecycle.mode[goal], GoalLifecycle.persistence[goal],
  GoalLifecycle.parentGoalEid[goal], GoalLifecycle.parentCreatedAt[goal], GoalLifecycle.parentSignature[goal],
  GoalLifecycle.reason[goal], GoalLifecycle.settledAt[goal], GoalLifecycle.deferredJson[goal], GoalLifecycle.reviewRevision[goal]]);

/** Only a native subjective episode's definition is refinable. The revision is
 * part of its existing Goal contract, so A→B→A never revives an old build/plan
 * signature. This is actor-owned intention, not a new success condition. */
function refinementParams(goal: number): { description: string; intentionRevision: number } | undefined {
  if (Goal.status[goal] !== "active" || GoalLifecycle.persistence[goal] !== "episodic"
    || !["custom", "social"].includes(Goal.kind[goal])) return;
  try {
    const params = JSON.parse(Goal.paramsJson[goal]);
    if (!params || typeof params !== "object" || Array.isArray(params) || params.description !== Goal.description[goal]
      || Object.keys(params).some(key => !["description", "completionHint", "intentionRevision"].includes(key))) return;
    const revision = params.intentionRevision ?? 0;
    if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) return;
    // A previous non-authoritative completion hint was for the old wording.
    // Replanning may discover new evidence; a refinement cannot inherit proof.
    return { description: params.description, intentionRevision: revision };
  } catch { return; }
}

function operations(goal: number): string[] {
  return ["reprioritize", GoalLifecycle.persistence[goal] === "standing" ? "withdraw" : "release",
    ...(refinementParams(goal) ? ["refine"] : [])];
}
export function captureIntentionReconsideration(world: World, eid: number) {
  const rows = owned(world, eid).filter(goal => eligible(world, eid, goal)).slice(0, 12);
  return { world, eid, owner: WorkingMemoryIdentity.id[eid], source: getCommittedEvents(world).sourceId,
    basis: new Map(rows.map(goal => [goal, basis(goal)])),
    intentions: rows.map(goal => ({ goalId: goal, description: Goal.description[goal], priority: Goal.priority[goal],
      status: Goal.status[goal], reason: GoalLifecycle.reason[goal] || "",
      persistence: GoalLifecycle.persistence[goal] === "standing" ? "standing" : "episodic",
      operations: operations(goal) })) };
}

export function prepareIntentionReconsideration(context: ReturnType<typeof captureIntentionReconsideration>, input: unknown) {
  const parsed = intentionRevisionsSchema.safeParse(input);
  if (!parsed.success || parsed.data.some(row => !context.basis.has(row.goalId)
    || !operations(row.goalId).includes(row.disposition))) return;
  const { world, eid } = context, rows = parsed.data;
  const refinements = new Map<number, { description: string; params: string; signature: string }>();
  for (const row of rows) if (row.disposition === "refine") {
    const old = refinementParams(row.goalId);
    const next=old && editedIntention(old.description,row.edits);
    if (!old || next===undefined) return;
    const params = { description: next, intentionRevision: old.intentionRevision + 1 };
    refinements.set(row.goalId, { description: next, params: stableJsonStringify(params),
      signature: computeGoalSignature({ version: 1, kind: Goal.kind[row.goalId] as GoalKind,
        params, success: JSON.parse(Goal.successJson[row.goalId]) }) });
  }
  // Releasing or refining a parent retires its old dependent strategies. Do not partly
  // apply another edit to one of those strategies in the same atomic batch.
  const retiringParents = new Set(rows.filter(row => row.disposition !== "reprioritize").map(row => row.goalId));
  for (const row of rows) {
    const visited = new Set<number>([row.goalId]); let child = row.goalId;
    while (hasComponent(world, child, GoalLifecycle)) {
      const parent = GoalLifecycle.parentGoalEid[child];
      if (!owned(world, eid).includes(parent) || visited.has(parent)
        || Goal.createdAt[parent] !== GoalLifecycle.parentCreatedAt[child]) break;
      if (retiringParents.has(parent)) return;
      visited.add(parent); child = parent;
    }
  }
  let consumed = false;
  const current = () => !consumed && !getCommittedEvents(world).stopped
    && getCommittedEvents(world).sourceId === context.source && WorkingMemoryIdentity.id[eid] === context.owner
    && rows.every(row => eligible(world, eid, row.goalId) && basis(row.goalId) === context.basis.get(row.goalId));
  if (!current()) return;
  return { current, changes: rows.map(row => ({ goalId: row.goalId, disposition: row.disposition,
    ...(row.disposition === "reprioritize" ? { priority: row.priority } : {}) })),
    /** Private prepared definition for conflict checking, never diagnostic prose. */
    refinedDescription: (goalId:number) => refinements.get(goalId)?.description,
    commit(): boolean {
      assertSimulationTaskActive(); if (!current()) return false; consumed = true;
      for (const row of rows) {
        const goal = row.goalId;
        GoalLifecycle.reason[goal] = row.reason;
        if (row.disposition === "reprioritize") Goal.priority[goal] = row.priority;
        else if (row.disposition === "refine") {
          const next = refinements.get(goal)!;
          ensureGoalSignature(world, goal);
          retireGoalDependents(world, eid, goal, "The actor refined the supporting intention; reconsider its old strategies. No work is claimed complete.");
          Goal.description[goal] = next.description; Goal.paramsJson[goal] = next.params; Goal.signature[goal] = next.signature;
          Goal.progress[goal] = 0;
        }
        else {
          Goal.status[goal] = "retired"; GoalLifecycle.deferredJson[goal] = "";
          GoalLifecycle.settledAt[goal] = Date.now();
          stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal]);
          retireGoalDependents(world, eid, goal, "The actor ended the supporting intention; its old strategies are retired, not accomplished.");
          settleReviewedGoalActivity(world, eid, goal, row.disposition);
        }
        // Priority changes alter preference, not the desired outcome or the
        // validity of its prepared work. Retiring here races foreground choices
        // and needlessly regenerates the same plan after every appraisal.
        if (row.disposition !== "reprioritize") retireGoalPlans(world, goal, getRelationTargets(world, eid, HasPlan));
      }
      return true;
    } };
}

export const RECONSIDERATION_INSTRUCTION = `When an experience materially changes what matters,
reconsider your existing intentions rather than only adding a task. You may
revise up to three listed personal intentions using their listed operations,
with a brief reason. Include at most one entry per goalId; choose one operation
for that intention in this appraisal. Omit intentionRevisions if nothing changes.
Reprioritize either kind; release an episodic intention
you no longer pursue. Withdraw a standing desire only when you no longer want
to maintain it: completing one task does not end an ongoing concern.
Use refine when the desired outcome of a listed episodic intention changes or
becomes more concrete. A different question, retort or tactic changes the current
approach, not necessarily that outcome; leave it for action selection or planning.
Supply edits, not a rewritten summary: replace an exact unique fragment
using before/after, or append one short detail using text. All replacements refer
to the currently listed description and cannot overlap. Unmentioned wording stays
intact; the result must fit 300 characters. Keep the purpose through ordinary side
actions. A paraphrase, a feeling alone or the next step does not need an intention
edit. A chosen destination is not proof that it or a person exists.
Other objectives are context, not editable. A blocked strategy is not
the same as an ended concern: distinguish what you care about from one person's
next response. Prefer revising existing intentions to accumulating duplicates.
If a different purpose is needed, propose one subjective intention that leaves
you meaningful choices of your own, rather than prescribing someone else's
behavior. Ordinary information need not change your priorities. These are private
decisions, not executed actions or proof of success.`;
