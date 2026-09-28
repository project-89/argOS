/** Shared self-context for fast choice and slower appraisal. No sensing, world
 * mutation, inferred progress, pending-action invention or other-mind access. */
import { getRelationTargets, hasComponent } from "bitecs";
import { Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import type { World } from "../ecs/world";
import { snapshotOngoingActivity } from "./ongoing-activity";
import { getWorkingMemory, recentWorkingMemoryActions } from "./working-memory";
import { snapshotIntentionContext } from "./intention-context";
import { snapshotActorContinuation } from "./actor-continuation";

export function snapshotActivitySituation(world: World, eid: number) {
  const ongoing = snapshotOngoingActivity(world, eid), memory = getWorkingMemory(world, eid);
  const immediateApproach = snapshotActorContinuation(world, eid);
  const goal = ongoing && getRelationTargets(world, eid, HasGoal).find(id => hasComponent(world, id, Goal)
    && WorkingMemoryIdentity.id[id] === ongoing.goalKey);
  const physicalOutcomes = recentWorkingMemoryActions(memory)
    .map(r => ({ id: r.id, provenance: r.provenance, succeeded: r.succeeded!, summary: r.summary,
      ...(r.completedAtSimMs === undefined ? {} : { completedAtSimMs: r.completedAtSimMs }),
      ...(r.executionContext ? { attemptedPurpose: r.executionContext.purpose,
        startedAtSimMs: r.executionContext.startedAtSimMs,
        ...(r.executionContext.intention ? { historicalIntention: { ...r.executionContext.intention } } : {}) } : {}),
    }));
  const actedOn = new Set(memory.receipts.filter(r => r.kind === "action" && r.provenance === "own_action")
    .slice(-6).flatMap(r => [r.action?.targetKey, ...r.facts.map(f => f.subject)].filter(Boolean)));
  const lastKnownState = memory.facts.filter(f => !["Inspection.basis", "Inspection.question"].includes(f.slot || ""))
    .sort((a, b) => Number(actedOn.has(b.subject)) - Number(actedOn.has(a.subject)) || b.observedAt - a.observedAt)
    .slice(0, 12).map(f => ({ subject: f.subject, label: f.subjectLabel, predicate: f.predicate,
      ...(f.slot ? { slot: f.slot } : {}), value: f.value, ...(f.valueLabel ? { valueLabel: f.valueLabel } : {}),
      provenance: f.provenance, observedAtWallMs: f.observedAt }));
  return { ...(ongoing ? { organizingActivity: { id: ongoing.id, status: ongoing.status,
    needsRevalidation: ongoing.needsRevalidation, entryChoicePurpose: ongoing.purpose,
    ...(goal === undefined ? {} : { intention: { id: goal, description: Goal.description[goal], status: Goal.status[goal] } }),
    ...(ongoing.interruption ? { interruption: { ...ongoing.interruption } } : {}) } } : {}),
    ...(immediateApproach ? { immediateApproach: { ...immediateApproach } } : {}),
    intentions: snapshotIntentionContext(world, eid), physicalOutcomes, lastKnownState };
}
export type ActivitySituation = ReturnType<typeof snapshotActivitySituation>;
/** Refreshing an unchanged observation is not a new practical outcome. */
export function activitySituationBasis(value: ActivitySituation): string {
  // The competing-intention list is advisory context. Existing goal-operation
  // fences own its authority; attempt bookkeeping must not make every background
  // appraisal stale. Preserve this shared physical/activity fence's prior scope.
  // Continuation has its own choice/revision fence in foreground and appraisal.
  // Do not make harmless proposed -> dispatched bookkeeping invalidate meaning.
  const { intentions: _, immediateApproach: __, ...situation } = value;
  return JSON.stringify({ ...situation, lastKnownState: value.lastKnownState.map(({ observedAtWallMs: _, ...fact }) => fact)
    .sort((a, b) => JSON.stringify([a.subject, a.predicate, a.slot]).localeCompare(JSON.stringify([b.subject, b.predicate, b.slot]))) });
}
export const ACTIVITY_SITUATION_GUIDANCE = `Intentions describe desired outcomes or standing concerns. The immediate approach is a chosen way of pursuing something, not another goal or proof of progress. Carry your chosen intention through its next useful step unless new evidence, a real prerequisite or a deliberate change of preference warrants reconsideration. An ordinary conversational turn need not displace that intention: speaking can be a side response rather than a new prerequisite for action. Judge what actually changed from attributed dialogue and physical receipts; an entry choice or attempted step is historical, not an instruction to repeat it.`;
