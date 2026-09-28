/** Read-only diagnostic gates. Prose, approvals and approach events never stand
 * in for actual use. This module has no simulation mutation authority. */
import type { PublicCommittedEvent } from "../runtime/committed-events";
import type { GodAutopilotReview } from "../god/god-autopilot";
import type { SpiritProposal } from "../spirits/spirit-factory";
import type { getObservedProposalDiagnostics } from "../spirits/architect-spirit";
import type { createSpatialTownGrowth } from "./spatial-town-growth";
import type { SpatialViewEntity } from "./spatial-contract";

export type GrowthInspection = ReturnType<ReturnType<typeof createSpatialTownGrowth>["inspect"]>;
export type OwnedProposal = { sourceId: string; atSimMs: number;
  diagnostic: ReturnType<typeof getObservedProposalDiagnostics>[number]; proposal: SpiritProposal };
export type ReceiptEvidence = { event: PublicCommittedEvent; native: {
  actorKey?: string; sittingOn: number[]; targetPresent: boolean; targetKey?: string;
  targetRoom?: number; targetState?: string; placement?: { assetId: string; siteId: string };
  visual?: SpatialViewEntity; position?: { x: number; y: number };
} };
export type WeaverReportEvidence = { sourceId: string; capturedAtSimMs: number; id: string;
  senderId: number; senderName: string; subject: string; data?: Record<string, any> };

/** Same observation gate, two transports. A delayed review may deliver a native
 * physical receipt in history rather than the fresh construction-evidence lane.
 * A high-water mark or grouped count alone is not proof that its ID was seen. */
function historyIncludesUse(history: any, event: PublicCommittedEvent, reviewAt: number): boolean {
  if (!history || history.sourceId !== event.sourceId || !Number.isFinite(history.observedAtSimMs)
    || history.observedAtSimMs < event.atSimMs || history.observedAtSimMs > reviewAt
    || !Number.isSafeInteger(event.sequence) || !Number.isSafeInteger(history.afterSequence)
    || history.afterSequence < 0 || history.afterSequence >= event.sequence
    || !Number.isSafeInteger(history.throughSequence) || history.throughSequence < event.sequence
    || !Array.isArray(history.records)) return false;
  return history.records.some((row: any) => row && row.kind === "action" && row.action === event.action
    && row.status === "succeeded" && row.executionId === event.executionId
    && row.actorKey === event.actorKey && row.targetKey === event.targetKey
    && row.firstSequence === event.sequence && row.lastSequence === event.sequence
    && row.firstAtSimMs === event.atSimMs && row.lastAtSimMs === event.atSimMs
    && row.receiptCount === 1 && row.receiptIdsOmitted === 0
    && Array.isArray(row.receiptIds) && row.receiptIds.length === 1 && row.receiptIds[0] === event.id);
}

export function evaluateTownGrowthEvidence(input: {
  sourceId: string; godId: number; weaverId: number; cafeId: number; tessId: number; tessKey: string;
  initialNeed: boolean; initialActorCount: number; initialCafeSeats: number;
  proposals: OwnedProposal[]; reviews: GodAutopilotReview[]; receipts: ReceiptEvidence[];
  growth: GrowthInspection; reports: WeaverReportEvidence[];
}) {
  const { sourceId, cafeId, tessId, tessKey } = input;
  const fixtureValid = input.initialNeed && input.initialActorCount === 10 && input.initialCafeSeats === 0;
  const proposed = input.proposals.filter(row => row.sourceId === sourceId && row.diagnostic.id === row.proposal.id
    && row.diagnostic.evidence.some(ref => ref.startsWith("intention:")) && row.proposal.fromSpiritEid === input.weaverId
    && row.proposal.fromSpiritName === "The Weaver" && row.proposal.type === "entity"
    && row.proposal.observationScopeId && row.proposal.specification?.roomEid === cafeId
    && row.proposal.specification?.components?.some((c: any) => c.name === "SpatialPlacement"
      && c.values?.assetId === "chair" && c.values?.siteId === "cafe-extra-seat"));
  const approved = proposed.filter(row => row.proposal.approvedBy === input.godId
    && ["approved", "building", "executed"].includes(row.proposal.status)
    && input.reviews.some(review => review.sourceId === sourceId && review.result.executed
      && review.result.actions?.some((action: any) => action?.success === true
        && action.result?.proposalId === row.proposal.id && action.result?.status === "approved")));
  const executed = approved.filter(row => row.proposal.status === "executed");
  const builds = input.growth.sourceId !== sourceId ? [] : input.growth.builds.filter(build =>
    build.sourceId === sourceId && build.status === "built" && build.assetId === "chair"
    && build.siteId === "cafe-extra-seat" && build.eid !== undefined && !!build.key
    && executed.some(row => row.proposal.name === build.name && row.proposal.specification?.name === build.name
      && row.diagnostic.issuedAtSimMs <= build.atSimMs));
  const used = input.receipts.filter(({ event, native }) => event.sourceId === sourceId
    && event.actorId === tessId && event.actorKey === tessKey && event.kind === "action"
    && event.action === "interact" && event.status === "succeeded"
    && native.actorKey === tessKey && native.targetPresent && native.targetKey === event.targetKey
    && native.targetState === "occupied" && native.targetRoom === cafeId
    && native.sittingOn.includes(event.targetId!) && native.placement?.assetId === "chair"
    && native.placement.siteId === "cafe-extra-seat" && !!native.visual && native.visual.id === event.targetId
    && native.visual.key === event.targetKey && native.visual.asset === "chair" && native.visual.roomId === cafeId
    && native.position?.x === native.visual.position.x && native.position?.y === native.visual.position.z
    && builds.some(build => build.eid === event.targetId && build.key === event.targetKey && event.atSimMs >= build.atSimMs)
    && input.receipts.some(({ event: start }) => start.sourceId === sourceId && start.status === "pending"
      && start.kind === "action" && start.action === "interact" && start.actorKey === tessKey
      && start.targetId === event.targetId && start.targetKey === event.targetKey
      && start.executionId === event.executionId && start.startedAtSimMs === event.startedAtSimMs
      && start.atSimMs <= event.atSimMs));
  const feedback = used.filter(({ event }) => builds.some(build => build.eid === event.targetId
    && build.key === event.targetKey && build.feedback.some(f => f.eventId === event.id && f.actorKey === tessKey
      && f.action === "interact" && f.seated && f.atSimMs === event.atSimMs)));
  const observed = feedback.filter(({ event }) => input.reports.some(report => report.sourceId === sourceId
    && report.senderId === input.weaverId && report.senderName === "The Weaver"
    && report.subject === "World activity reviewed" && report.data?.sourceId === sourceId
    && Number.isFinite(report.data.observedAtSimMs) && Number.isFinite(report.capturedAtSimMs)
    && report.data.observedAtSimMs <= report.capturedAtSimMs
    && report.data.observedAtSimMs >= event.atSimMs && report.capturedAtSimMs >= event.atSimMs
    && ((Array.isArray(report.data.recentEvents) && report.data.recentEvents.some((e: any) =>
      e.id === event.id && e.actorKey === tessKey && e.targetKey === event.targetKey
      && e.action === "interact" && e.status === "succeeded" && e.atSimMs === event.atSimMs))
      || historyIncludesUse(report.data.publicActivityHistory, event, report.data.observedAtSimMs))));
  const gates = { fixtureValid, sourceOwnedIntentionBackedProposal: proposed.length > 0,
    realGodApproval: approved.length > 0, nativeConstruction: builds.length > 0,
    autonomousTessSeating: used.length > 0, exactNativeFeedbackRetained: feedback.length > 0,
    exactNativeFeedbackObservedByWeaver: observed.length > 0 };
  return { gates, completeNativeUseChainObserved: Object.values(gates).every(Boolean),
    seededNeedCausalAttribution: "REQUIRES_REQUEST_EVIDENCE_REVIEW",
    purposeGroundingReview: "Intention references are native-issued; manually inspect the archived rationale to confirm it concerns Tess's cafe need.",
    proposalIds: [...new Set(proposed.map(r => r.proposal.id))], approvedIds: [...new Set(approved.map(r => r.proposal.id))],
    builtKeys: builds.map(b => b.key), useEventIds: used.map(r => r.event.id),
    feedbackEventIds: feedback.map(r => r.event.id), observedFeedbackEventIds: observed.map(r => r.event.id),
    baselineAndEndurance: "OPEN", constructionUnder100ms: "NOT_ASSESSED_BY_THIS_CHECK" };
}
