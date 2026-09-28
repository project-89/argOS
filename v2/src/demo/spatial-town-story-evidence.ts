/** Read-only gates for one autonomous native story loop. A prompt, review count,
 * approach, or description of repair is never evidence that repair happened. */
import type { PublicCommittedEvent } from "../runtime/committed-events";
import type { SpiritPublicEventReviewStatus } from "../spirits/spirit-public-event-review";
import type { WorkingMemoryReceipt } from "../cognition/working-memory";
import type { SpatialTownLifeView } from "./spatial-contract";

export type StoryChangeEvidence = { sourceId: string; targetKey: string;
  change: SpatialTownLifeView["changes"][number] };
export type StoryReceiptEvidence = { event: PublicCommittedEvent; native: {
  actorKey: string; targetKey?: string; targetState?: string; targetRevision?: number;
  targetPresent: boolean; atTarget: boolean; memoryRecorded: boolean;
} };
export type TownStoryEvidenceInput = {
  sourceId: string; initialTrees: readonly { id: number; key: string }[];
  changes: readonly StoryChangeEvidence[]; receipts: readonly StoryReceiptEvidence[];
  reviews: readonly SpiritPublicEventReviewStatus[];
  endTrees: readonly { id: number; key: string; phase: string; revision: number }[];
};

const time = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const sequence = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** Match an actor-owned native outcome without making command spelling stricter
 * than SpatialDemo.execute. This is observation only, never action authority. */
export function matchesStoryClearingMemory(event: PublicCommittedEvent, receipt: WorkingMemoryReceipt): boolean {
  const content = receipt.action?.content;
  return event.kind === "action" && event.status === "succeeded" && ["interact", "use"].includes(event.action)
    && !!event.targetKey && time(event.atSimMs) && event.completedAtSimMs === event.atSimMs
    && receipt.kind === "action" && receipt.provenance === "own_action" && receipt.succeeded === true
    && receipt.action?.type === event.action && receipt.action.targetKey === event.targetKey
    && receipt.completedAtSimMs === event.atSimMs && typeof content === "string"
    && content.trim().split(/\s+/)[0].toLowerCase() === "clear_branches";
}

export function evaluateTownStoryEvidence(input: TownStoryEvidenceInput) {
  const { sourceId } = input;
  const initialNativeTrees = !!sourceId && input.initialTrees.length > 0
    && new Set(input.initialTrees.map(row => row.id)).size === input.initialTrees.length
    && new Set(input.initialTrees.map(row => row.key)).size === input.initialTrees.length
    && input.initialTrees.every(row => Number.isSafeInteger(row.id) && row.id >= 0 && !!row.key);
  const ownedChange = (row: StoryChangeEvidence) => row.sourceId === sourceId && time(row.change.atSimMs)
    && row.change.status === "applied";
  const acceptedReviews = input.reviews.filter(review => review.sourceId === sourceId && !review.sourceStopped
    && review.accepted && time(review.atSimMs)
    && sequence(review.acknowledgedThroughSequence) && sequence(review.observedThroughSequence)
    && review.acknowledgedThroughSequence >= review.observedThroughSequence
    && sequence(review.acknowledgedEnvironmentThroughSequence) && sequence(review.observedEnvironmentThroughSequence)
    && review.acknowledgedEnvironmentThroughSequence >= review.observedEnvironmentThroughSequence);
  const observedEnvironment = (id: string, atSimMs: number) => acceptedReviews.filter(review =>
    review.atSimMs > atSimMs && review.observedEnvironmentThroughSequence > 0 && review.receiptIdsObserved.includes(id));
  const observedAction = (event: PublicCommittedEvent) => acceptedReviews.filter(review =>
    review.atSimMs > event.atSimMs && review.observedThroughSequence >= event.sequence
    && review.receiptIdsObserved.includes(event.id));
  const damages = initialNativeTrees ? input.initialTrees.flatMap(tree => input.changes.filter(row => ownedChange(row)
    && row.targetKey === tree.key && row.change.spirit === "The Narrator"
    && row.change.id === `story:${tree.id}:1:tree_damage`).map(row => ({ tree, row }))) : [];
  const clearings = damages.flatMap(damage => input.changes.filter(row => ownedChange(row)
    && row.targetKey === damage.tree.key && row.change.spirit === "Residents"
    && row.change.id === `story:${damage.tree.id}:2:tree_cleared`
    && row.change.atSimMs > damage.row.change.atSimMs).map(row => ({ ...damage, clearing: row })));
  const responses = clearings.flatMap(chain => input.receipts.filter(({ event, native }) => {
    if (event.sourceId !== sourceId || event.kind !== "action" || !["interact", "use"].includes(event.action) || event.status !== "succeeded"
      || !event.id || !event.executionId || !event.actorKey || !sequence(event.sequence) || event.sequence === 0
      || event.targetId !== chain.tree.id || event.targetKey !== chain.tree.key || !time(event.startedAtSimMs)
      || event.startedAtSimMs < chain.row.change.atSimMs || event.atSimMs !== chain.clearing.change.atSimMs
      || event.completedAtSimMs !== event.atSimMs || event.atSimMs - event.startedAtSimMs < 6000
      || native.actorKey !== event.actorKey || !native.targetPresent || !native.atTarget
      || native.targetKey !== chain.tree.key || native.targetState !== "pruned" || native.targetRevision !== 2) return false;
    const startedAtSimMs = event.startedAtSimMs;
    return input.receipts.some(({ event: start }) => start.sourceId === sourceId && start.kind === "action"
      && start.action === event.action && start.status === "pending" && start.executionId === event.executionId
      && start.actorId === event.actorId && start.actorKey === event.actorKey
      && start.targetId === chain.tree.id && start.targetKey === chain.tree.key
      && start.startedAtSimMs === startedAtSimMs && time(start.atSimMs) && start.atSimMs >= startedAtSimMs
      && start.atSimMs <= event.atSimMs && start.completedAtSimMs === undefined
      && sequence(start.sequence) && start.sequence > 0 && start.sequence < event.sequence);
  }).map(receipt => ({ ...chain, receipt })));
  const candidates = responses.map(chain => {
    const damageReviews = observedEnvironment(chain.row.change.id, chain.row.change.atSimMs);
    const clearingReviews = observedEnvironment(chain.clearing.change.id, chain.clearing.change.atSimMs);
    const actionReviews = observedAction(chain.receipt.event);
    const gates = {
      responseRecordedInMemory: chain.receipt.native.memoryRecorded === true,
      terminalNativeConsequence: input.endTrees.some(tree => tree.id === chain.tree.id && tree.key === chain.tree.key
        && tree.phase === "pruned" && tree.revision === 2),
      narratorObservedDamage: damageReviews.length > 0,
      narratorObservedOutcome: clearingReviews.length > 0 && actionReviews.length > 0,
    };
    return { treeId: chain.tree.id, treeKey: chain.tree.key, actorKey: chain.receipt.event.actorKey,
      damageId: chain.row.change.id, clearingId: chain.clearing.change.id, responseEventId: chain.receipt.event.id,
      executionId: chain.receipt.event.executionId, damageAtSimMs: chain.row.change.atSimMs,
      clearedAtSimMs: chain.clearing.change.atSimMs,
      reviewAtSimMs: [...new Set([...damageReviews, ...clearingReviews, ...actionReviews].map(review => review.atSimMs))],
      gates, complete: Object.values(gates).every(Boolean) };
  });
  const passingChains = candidates.filter(chain => chain.complete);
  const gates = {
    initialNativeTrees, nativeNarratorDamage: damages.length > 0, nativeResidentClearing: clearings.length > 0,
    autonomousNativeResponse: responses.length > 0,
    responseRecordedInMemory: candidates.some(chain => chain.gates.responseRecordedInMemory),
    terminalNativeConsequence: candidates.some(chain => chain.gates.terminalNativeConsequence),
    narratorObservedDamage: damages.some(chain => observedEnvironment(chain.row.change.id, chain.row.change.atSimMs).length > 0),
    narratorObservedOutcome: candidates.some(chain => chain.gates.narratorObservedOutcome),
  };
  return { gates, completeNativeStoryLoopObserved: initialNativeTrees && passingChains.length > 0,
    passingChains, candidateChains: candidates,
    damageIds: [...new Set(damages.map(chain => chain.row.change.id))],
    clearingIds: [...new Set(clearings.map(chain => chain.clearing.change.id))],
    responseEventIds: [...new Set(responses.map(chain => chain.receipt.event.id))],
    failedEvidence: {
      receiptIds: input.receipts.filter(row => row.event.status === "failed").map(row => row.event.id),
      changeIds: input.changes.filter(row => ["failed", "rejected"].includes(row.change.status)).map(row => row.change.id),
      reviewAtSimMs: input.reviews.filter(review => !review.accepted || review.sourceStopped).map(review => review.atSimMs),
    },
    baselineAndEndurance: "OPEN", constructionUnder100ms: "NOT_ASSESSED_BY_THIS_CHECK",
    scope: "One native story-response-feedback chain. No claim of broader narrative quality or generated-system readiness.",
  };
}
