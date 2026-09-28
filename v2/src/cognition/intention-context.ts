/** Read-only projection of existing owned goals. Not a scheduler or agenda store. */
import { getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Goal, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal } from "../ecs/relations";
import { getStampedSimulationTime } from "../ecs/temporal-age";
import { readSimulationTime } from "../ecs/simulation-time";
import { isStandingIntention, pendingIntentionReview } from "./goal-lifecycle";
import { readGoalAttemptActivity } from "./goal-attempt";

export function snapshotIntentionContext(world: World, actor: number) {
  const owned = getRelationTargets(world, actor, HasGoal).filter(g => hasComponent(world, g, Goal));
  // Match the foreground's five selectable intentions; paused reviews are separate
  // choices about lifecycle and never join its selectable-action list.
  const active = owned.filter(g => ["active", "in_progress"].includes(Goal.status[g]))
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0)).slice(0, 5);
  const paused = owned.filter(g => Goal.status[g] === "paused").slice(0, 5);
  return [...active, ...paused].map(goal => {
    const review = pendingIntentionReview(world, actor, goal);
    return { id: goal, key: hasComponent(world, goal, WorkingMemoryIdentity) ? WorkingMemoryIdentity.id[goal] : undefined,
      description: Goal.description[goal], priority: Goal.priority[goal] || 0, status: Goal.status[goal],
      persistence: isStandingIntention(world, goal) ? "standing" : "episodic",
      progressEstimate: Goal.progress[goal] || 0,
      adoptedAtSimMs: getStampedSimulationTime(world, goal, "Goal.createdAt", Goal.createdAt[goal]) ?? null,
      lastAttemptAtSimMs: readGoalAttemptActivity(world, actor, goal) ?? null,
      ...(review ? { awaitingReconsiderationSinceSimMs: review.atSimMs } : {}) };
  });
}
export type IntentionContext = ReturnType<typeof snapshotIntentionContext>[number];
export function formatIntentionTiming(world: World, intention: IntentionContext | undefined): string {
  if (!intention) return "timing unknown";
  const age = (at: number) => Math.max(0, Math.floor((readSimulationTime(world) - at) / 1000));
  return `${intention.adoptedAtSimMs === null ? "adoption time unknown" : `adopted ${age(intention.adoptedAtSimMs)}s ago`}; ${intention.lastAttemptAtSimMs === null
    ? "no attributed attempt recorded" : `last attributed attempt ${age(intention.lastAttemptAtSimMs)}s ago, not proof of progress`}`;
}
/** Shared formatting of the foreground's selectable goals; no choice is made here. */
export function formatActiveIntentions(world: World, actor: number): string {
  const active = snapshotIntentionContext(world, actor).filter(row => ["active", "in_progress"].includes(row.status));
  return active.length ? active.map(row => `- [ID ${row.id}, Priority ${row.priority || 5}] ${row.description} (${row.persistence === "standing"
    ? "a standing desire" : `about ${row.progressEstimate}% there`}; ${formatIntentionTiming(world, row)})`).join("\n")
    : "No specific goals right now.";
}
