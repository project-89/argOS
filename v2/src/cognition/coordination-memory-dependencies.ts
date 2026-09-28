/** Dependencies refer only to this actor's admitted coordination record.
 * They do not inspect another character's goals, thoughts or physical state. */
import type { World } from "../ecs/world";
import { getCoordinationMemory, type CoordinationGoalRef, type CoordinationWorkRef } from "./coordination-memory";
import type { ActorWorkingMemory } from "./working-memory";

export interface CoordinationDependencyScope {
  references?: readonly string[];
  itemIds?: readonly string[];
  goalRefs?: readonly (CoordinationGoalRef | undefined)[];
  workRefs?: readonly (CoordinationWorkRef | undefined)[];
  /** Conversational/quiet decisions interpret the whole current exchange.
   * Physical work uses explicit item/goal or named task dependencies instead. */
  all?: boolean;
  /** Reviews interpret progress itself, unlike executing the next physical step. */
  strict?: boolean;
}

function normalized(value: string): string {
  return typeof value === "string" ? value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim() : "";
}

export function coordinationDependency(
  memory: ReturnType<typeof getCoordinationMemory>, scope: CoordinationDependencyScope = {},
): string {
  const references = (scope.references || []).map(normalized);
  const namesTask = (task: string) => {
    const label = normalized(task);
    return !!label && references.some(reference => ` ${reference} `.includes(` ${label} `));
  };
  return JSON.stringify(memory.items.filter(item => scope.all || scope.itemIds?.includes(item.id)
    || scope.workRefs?.some(ref => ref && ref.ownerKey === item.ownerKey && ref.itemId === item.id)
    || namesTask(item.task) || (item.goalRelation === "fulfills" && item.goal && scope.goalRefs?.some(goal => goal
      && JSON.stringify(goal) === JSON.stringify(item.goal))))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(item => {
      if (!scope.all && !scope.strict && item.own) {
        // A physical plan's first executed step is an expected effect, not a
        // reason to invalidate the rest of that same plan. Reporting its start
        // is likewise not a new obstacle. Blockers, release and verified
        // completion do change which remaining work is meaningful.
        const status = ["not_started", "in_progress"].includes(item.localStatus || "") ? "open" : item.localStatus;
        return [item.id, item.task, item.generation, item.goal, item.goalRelation, item.completion, item.goalTracking, status,
          status === "open" ? undefined : item.localReason,
          status === "open" ? undefined : item.localEvidence];
      }
      return [item.id, item.task, item.generation, item.goal, item.goalRelation, item.completion, item.goalTracking, item.localStatus, item.localReason, item.localEvidence, item.lastReported];
    }));
}

export function currentCoordinationDependency(world: World, actorEid: number, scope: CoordinationDependencyScope = {}): string {
  return coordinationDependency(getCoordinationMemory(world, actorEid), scope);
}

function subjectEvidence(memory: ActorWorkingMemory, subjects: ReadonlySet<string>): string {
  const facts = memory.facts.filter(fact => subjects.has(fact.subject))
    .map(fact => [fact.subject, fact.predicate, fact.slot || "", fact.value, fact.valueLabel || ""])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const ownAction = [...memory.receipts].reverse().find(receipt => receipt.kind === "action" && receipt.provenance === "own_action"
    && receipt.facts.some(fact => subjects.has(fact.subject)))?.id || "";
  return JSON.stringify({ facts, ownAction });
}

/** A semantic blocker review can cite its subject without naming it in prose.
 * Its typed receipt references must have existed when the request began and
 * still describe the same admitted evidence at commit. No ECS state is read. */
export function coordinationReviewEvidenceIsCurrent(
  before: ActorWorkingMemory, current: ActorWorkingMemory, reviews: unknown,
): boolean {
  if (!Array.isArray(reviews)) return true;
  const subjects = new Set<string>();
  for (const review of reviews.slice(0, 3)) {
    // Malformed optional reviews are ignored by admission, not promoted into
    // arbitrary dependency requests. Valid-shaped references must be grounded.
    if (!review || review.kind !== "blocked" || !Array.isArray(review.evidenceIds)
      || !review.evidenceIds.length || !review.evidenceIds.every((id: unknown) => typeof id === "string")) continue;
    for (const id of review.evidenceIds) {
      const receipt = before.receipts.find(source => source.id === id);
      const now = current.receipts.find(source => source.id === id);
      if (!receipt || !now || JSON.stringify(receipt) !== JSON.stringify(now)) return false;
      for (const fact of receipt.facts) subjects.add(fact.subject);
    }
  }
  return subjectEvidence(before, subjects) === subjectEvidence(current, subjects);
}
