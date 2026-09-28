/** A plan may wait for owned evidence, never for a prose assertion to become true.
 * This module reads actor-owned ledgers and verified local sensing tokens only.
 * It does not query an object's current ECS state or interpret anyone's words. */
import { entityExists, hasComponent } from "bitecs";
import { randomUUID } from "node:crypto";
import { Agent, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { getSocialDialogue } from "./social-memory";
import { getWorkingMemory, workingMemoryEntityRef, type WorkingMemoryFact } from "./working-memory";
import { consumeWorkingMemoryObservation, getWorkingMemoryObservationSequence,
  type WorkingMemoryObservationSnapshot } from "./working-memory-observation";
import { getKnownObservableConditions } from "./planning-observable-conditions";
import { getAgentWorldCapabilities, getAgentWorldCapabilityGeneration, type AgentWorldCapabilities } from "./world-capabilities";

import { parsePlanWaitUntil, PLAN_WAIT_TIMEOUT_LIMITS, PLAN_WAIT_SCHEMA_ERRORS, type PlanWaitUntil, type PlanWaitSchemaIssue } from "./plan-wait-schema";
export { copyPlanWaitUntil, type PlanWaitUntil } from "./plan-wait-schema";
/** Fixed operator codes, never a copy of the proposed predicate or private text. */
export type PlanWaitIssue = PlanWaitSchemaIssue | "unsupported_schema" | "unobserved_subject_or_slot"
  | "unavailable_contract" | "invalid_value" | "composed_prose";
export interface PlanEvidenceBarrierToken { readonly id: string }
export type PlanEvidenceBarrierResult =
  | { status: "waiting"; deadlineMs: number }
  | { status: "satisfied"; sourceIds: string[] }
  | { status: "reconsider"; reason: string; sourceIds: string[] };
export const PLAN_EVIDENCE_BARRIER_LIMITS = Object.freeze({ ...PLAN_WAIT_TIMEOUT_LIMITS, perActor: 64 });

type PhysicalCondition = Extract<PlanWaitUntil, { kind: "physical_fact" }>;
interface Barrier {
  readonly sourceId: string | null;
  readonly actorEid: number;
  readonly ownerKey: string;
  readonly scopeKey: string;
  readonly condition: Readonly<PlanWaitUntil>;
  /** Wall-domain issuance fence for retained speech and evidence timestamps. */
  readonly issuedAt: number;
  /** The deadline has a separate clock; model/API latency is not lived time. */
  readonly deadlineClock: "simulation" | "explicit";
  readonly deadlineIssuedAt: number;
  readonly evidenceFloor: number;
  readonly observationFloor: number;
  readonly deadlineMs: number;
  readonly sourceIds: ReadonlySet<string>;
  readonly heardIds: ReadonlySet<string>;
  readonly observableContract?: string;
  readonly observablePackage?: AgentWorldCapabilities;
  readonly observableGeneration?: object;
  readonly observableProducer?: AgentWorldCapabilities["observableState"];
}
const barriers = new WeakMap<World, Map<string, Barrier>>();
const verifiedResults = new WeakMap<object, { world: World; actor: number; owner: string; source: string | null;
  scope: string; condition: string; fingerprint: string }>();
const conditionIdentity = (condition: PlanWaitUntil) => {
  const { timeoutMs: _, ...predicate } = condition; return JSON.stringify(predicate);
};
/** Only original evaluator results, not copied/model-authored success objects,
 * can credit the matching selected wait step. Deadlines are not predicates. */
export function isVerifiedWaitResult(world: World, eid: number, result: PlanEvidenceBarrierResult,
  scope: string, condition: PlanWaitUntil): boolean {
  const proof = verifiedResults.get(result);
  return !!proof && result.status === "satisfied" && proof.world === world && proof.actor === eid
    && liveActor(world, eid) && WorkingMemoryIdentity.id[eid] === proof.owner
    && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === proof.source
    && proof.scope === scope && proof.condition === conditionIdentity(condition)
    && proof.fingerprint === JSON.stringify(result);
}
const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const text = (v: unknown, limit = 240): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= limit;
const time = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const liveActor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent) && Agent.active[eid];
const sameSlot = (f: WorkingMemoryFact, c: PhysicalCondition) => f.subject === c.subject
  && f.predicate === c.predicate && (f.slot || "") === (c.slot || "");
const reconsider = (reason: string, sourceIds: string[] = []): PlanEvidenceBarrierResult => ({ status: "reconsider", reason, sourceIds });

/** Labels are convenience input, not identity. Resolve them once, only against
 * what this actor has actually learned, and reject same-name ambiguities. */
function bindPhysical(condition: PhysicalCondition, facts: readonly WorkingMemoryFact[]): PhysicalCondition | undefined {
  const exact = facts.some(f => f.subject === condition.subject);
  const subjects = new Set(facts.filter(f => exact ? f.subject === condition.subject
    : f.subjectLabel !== undefined && normalize(f.subjectLabel) === normalize(condition.subject)).map(f => f.subject));
  if (subjects.size !== 1) return;
  const subject = [...subjects][0];
  const slots = new Set(facts.filter(f => f.subject === subject && f.predicate === condition.predicate
    && (condition.slot === undefined || f.slot === condition.slot)).map(f => f.slot || ""));
  if (slots.size !== 1) return;
  const slot = [...slots][0];
  // Inspection prose cannot certify an arbitrary semantic condition. These
  // slots hold text and bookkeeping, not a grounded physical state predicate.
  if (slot.startsWith("Inspection.")) return;
  let equals = condition.equals;
  if (condition.predicate === "location") {
    const refs = facts.flatMap(f => [{ key: f.subject, label: f.subjectLabel },
      ...(f.predicate === "location" && f.value !== "unknown" ? [{ key: f.value, label: f.valueLabel }] : [])]);
    const exactValue = refs.some(ref => ref.key === equals);
    const values = new Set(refs.filter(ref => exactValue ? ref.key === equals
      : ref.label !== undefined && normalize(ref.label) === normalize(equals)).map(ref => ref.key));
    if (values.size !== 1) return;
    equals = [...values][0];
  }
  return { ...condition, subject, ...(slot ? { slot } : {}), equals };
}

/** Read-only proposal grounding: unknown slots and invented enum values fail
 * before a plan is stored. Display prose remains supported for legacy packages
 * without explicit fields; it is not a substitute for a declared contract. */
export function groundPlanEvidenceCondition(world: World, eid: number, input: unknown):
  { condition: PlanWaitUntil; observableContract?: string } | { issue: string; issueCode: PlanWaitIssue } {
  const parsed = parsePlanWaitUntil(input);
  if ("issueCode" in parsed) return { issue: PLAN_WAIT_SCHEMA_ERRORS[parsed.issueCode], issueCode: parsed.issueCode };
  const copied = parsed.condition;
  if (copied.kind === "heard_evidence") return { condition: copied };
  const facts = getWorkingMemory(world, eid).facts;
  const condition = bindPhysical(copied, facts);
  if (!condition) return { issue: "Wait subject and exact slot must identify one personally observed physical field.", issueCode: "unobserved_subject_or_slot" };
  const fields = getKnownObservableConditions(world, eid).filter(field => field.subject === condition.subject);
  if (condition.predicate === "state" && condition.slot?.startsWith("Observable.")) {
    const field = fields.find(field => field.slot === condition.slot);
    if (!field) return { issue: "Wait field has no currently accessible, personally observed public contract.", issueCode: "unavailable_contract" };
    if (!field.allowedValues.includes(condition.equals)) return { issue: `Wait ${field.slot} equals must be one of ${JSON.stringify(field.allowedValues)}.`, issueCode: "invalid_value" };
    return { condition, observableContract: JSON.stringify([field.subject, field.slot, field.type, field.allowedValues]) };
  }
  const knownTypedSlots = [...new Set(facts.filter(fact => fact.subject === condition.subject && fact.predicate === "state"
    && fact.slot?.startsWith("Observable.")).map(fact => fact.slot!))];
  if (condition.predicate === "state" && condition.slot === "ObjectState.current" && knownTypedSlots.length) {
    return { issue: `Use an observed typed field (${knownTypedSlots.join(", ")}), not composed display prose, for this subject's physical wait.`, issueCode: "composed_prose" };
  }
  return { condition };
}

/** Called when a concrete plan step starts waiting, not when background planning
 * begins. scopeKey identifies the immutable plan generation and step. Default
 * deadlines use simulation elapsed time; the optional nowMs is an explicit
 * isolated/test clock for both issuance and deadline, never an inferred domain. */
export function issuePlanEvidenceBarrier(world: World, eid: number, input: unknown, scopeKey: string,
  nowMs?: number): Readonly<PlanEvidenceBarrierToken> | undefined {
  const issuedAt = nowMs ?? Date.now();
  const deadlineClock = nowMs === undefined ? "simulation" : "explicit";
  const deadlineIssuedAt = nowMs ?? readSimulationTime(world);
  if (!time(issuedAt) || !time(deadlineIssuedAt) || !text(scopeKey, 500) || !liveActor(world, eid)) return;
  const grounded = groundPlanEvidenceCondition(world, eid, input);
  if ("issue" in grounded) return;
  const memory = getWorkingMemory(world, eid);
  const { condition, observableContract } = grounded;
  const owner = workingMemoryEntityRef(world, eid); if (!owner) return;
  const dialogue = getSocialDialogue(world, eid);
  const sourceIds = new Set([...memory.facts.map(f => f.sourceId), ...memory.receipts.map(r => r.id)]);
  let rows = barriers.get(world); if (!rows) { rows = new Map(); barriers.set(world, rows); }
  // Keep an expired owner's bounded token until that owner consumes the timeout.
  // Another actor issuing a wait must not turn it into an invalid_barrier error.
  // Removed/recycled actors are still swept, and retained tokens count toward
  // the same per-owner cap as active ones (no unbounded expiry tombstones).
  for (const [id, old] of rows) if (!liveActor(world, old.actorEid)
    || WorkingMemoryIdentity.id[old.actorEid] !== old.ownerKey) rows.delete(id);
  const owned = [...rows].filter(([, old]) => old.ownerKey === owner.key);
  for (const [id] of owned.slice(0, Math.max(0, owned.length - PLAN_EVIDENCE_BARRIER_LIMITS.perActor + 1))) rows.delete(id);
  const id = `plan-wait:${randomUUID()}`;
  rows.set(id, Object.freeze({ sourceId: getCommittedEvents(world).sourceId, actorEid: eid, ownerKey: owner.key, scopeKey, condition: Object.freeze(condition), issuedAt,
    deadlineClock, deadlineIssuedAt,
    evidenceFloor: Math.max(issuedAt, memory.evidenceFloorMs, ...memory.facts.map(f => f.observedAt), ...memory.receipts.map(r => r.atMs)),
    observationFloor: getWorkingMemoryObservationSequence(world),
    deadlineMs: deadlineIssuedAt + (condition.timeoutMs ?? PLAN_EVIDENCE_BARRIER_LIMITS.defaultTimeoutMs),
    sourceIds, heardIds: new Set(dialogue.map(turn => turn.id)), observableContract,
    ...(observableContract ? { observablePackage: getAgentWorldCapabilities(world, eid),
      observableGeneration: getAgentWorldCapabilityGeneration(world, eid),
      observableProducer: getAgentWorldCapabilities(world, eid)?.observableState } : {}) }));
  return Object.freeze({ id });
}

function ownedBarrier(world: World, eid: number, token: unknown, scopeKey: string): Barrier | undefined {
  if (!token || typeof token !== "object" || !text((token as PlanEvidenceBarrierToken).id)) return;
  const barrier = barriers.get(world)?.get((token as PlanEvidenceBarrierToken).id);
  return barrier && barrier.actorEid === eid && barrier.scopeKey === scopeKey && liveActor(world, eid)
    && hasComponent(world, eid, WorkingMemoryIdentity) && WorkingMemoryIdentity.id[eid] === barrier.ownerKey ? barrier : undefined;
}

/** Pure scheduling view of this exact owner's current step token. No evidence
 * consumption, new sensing, UUID assignment, expiry sweep or plan mutation. */
export function getPlanEvidenceBarrierTiming(world: World, eid: number, token: unknown, scopeKey: string,
  options: { nowMs?: number } = {}): { deadlineMs: number; nowMs: number; clock: "simulation" | "explicit"; clockInvalid: boolean } | undefined {
  const barrier = ownedBarrier(world, eid, token, scopeKey); if (!barrier) return;
  const nowMs = barrier.deadlineClock === "simulation" ? readSimulationTime(world) : options.nowMs ?? Date.now();
  return { deadlineMs: barrier.deadlineMs, nowMs, clock: barrier.deadlineClock,
    clockInvalid: !time(nowMs) || nowMs < barrier.deadlineIssuedAt };
}

/** Only the exact issuer may cancel it. Tokens restored in another world/process,
 * copied to another actor, or replayed for another step never acquire authority. */
export function discardPlanEvidenceBarrier(world: World, eid: number, token: unknown, scopeKey: string): boolean {
  return !!ownedBarrier(world, eid, token, scopeKey) && !!barriers.get(world)?.delete((token as PlanEvidenceBarrierToken).id);
}

/** A terminal decision retires its token; evaluate only in current foreground
 * admission, never in readiness probes. Timeout and new speech request fresh
 * cognition. Neither can count as successful completion of the wait's premise. */
export function evaluatePlanEvidenceBarrier(world: World, eid: number, token: unknown, scopeKey: string,
  options: { nowMs?: number; observation?: WorkingMemoryObservationSnapshot } = {}): PlanEvidenceBarrierResult {
  const barrier = ownedBarrier(world, eid, token, scopeKey);
  if (!barrier) return reconsider("invalid_barrier");
  const finish = (result: PlanEvidenceBarrierResult) => {
    barriers.get(world)?.delete((token as PlanEvidenceBarrierToken).id);
    if (result.status === "satisfied") verifiedResults.set(result, { world, actor: eid, owner: barrier.ownerKey,
      source: barrier.sourceId, scope: scopeKey, condition: conditionIdentity(barrier.condition), fingerprint: JSON.stringify(result) });
    return result;
  };
  const now = barrier.deadlineClock === "simulation" ? readSimulationTime(world) : options.nowMs ?? Date.now();
  if (!time(now) || now < barrier.deadlineIssuedAt) return finish(reconsider("clock_invalid"));
  if (now >= barrier.deadlineMs) return finish(reconsider("timeout"));
  if (barrier.observableContract) {
    const grounded = groundPlanEvidenceCondition(world, eid, barrier.condition);
    if (getAgentWorldCapabilities(world, eid) !== barrier.observablePackage
      || getAgentWorldCapabilityGeneration(world, eid) !== barrier.observableGeneration
      || getAgentWorldCapabilities(world, eid)?.observableState !== barrier.observableProducer || "issue" in grounded
      || grounded.observableContract !== barrier.observableContract) return finish(reconsider("observable_contract_changed"));
  }
  const fresh = consumeWorkingMemoryObservation(world, eid, options.observation, barrier.observationFloor);
  const memory = getWorkingMemory(world, eid);
  if (barrier.condition.kind === "physical_fact") {
    const condition = barrier.condition;
    const candidates = [...memory.facts, ...fresh].filter(f => sameSlot(f, condition));
    const receipts = memory.receipts.flatMap(r => r.facts
      .filter(f => f.subject === condition.subject && f.predicate === condition.predicate && (f.slot || "") === (condition.slot || ""))
      .map(f => ({ value: f.value, sourceId: r.id, observedAt: r.atMs })));
    // A newer retained receipt can contradict a snapshot even after the bounded
    // fact set evicts its slot. It may block older proof, never itself resurrect
    // an evicted fact as sufficient current proof.
    const newestAt = Math.max(-1, ...candidates.map(f => f.observedAt), ...receipts.map(r => r.observedAt));
    const latest = candidates.filter(f => f.observedAt === newestAt);
    // Current ledger slots have a deterministic source-ID tie break. A retained
    // contradictory receipt at exactly that timestamp remains ambiguous proof.
    const equalReceipts = receipts.filter(r => r.observedAt === newestAt);
    const current = [...latest, ...equalReceipts];
    if (new Set(current.map(f => f.value)).size > 1) return finish(reconsider("conflicting_evidence", [...new Set(current.map(f => f.sourceId))]));
    const freshIds = new Set(fresh.map(f => f.sourceId));
    const proof = latest.filter(f => f.value === condition.equals && (freshIds.has(f.sourceId)
      || f.observedAt >= barrier.evidenceFloor && !barrier.sourceIds.has(f.sourceId)));
    if (proof.length) return finish({ status: "satisfied", sourceIds: [...new Set(proof.map(f => f.sourceId))] });
  }
  const heard = getSocialDialogue(world, eid).filter(turn => !turn.own && turn.atMs >= barrier.issuedAt
    && !barrier.heardIds.has(turn.id) && (barrier.condition.kind !== "heard_evidence" || !barrier.condition.speaker
      || normalize(turn.speaker) === normalize(barrier.condition.speaker)));
  if (heard.length) return finish(reconsider("new_heard_evidence", heard.map(turn => turn.id)));
  return { status: "waiting", deadlineMs: barrier.deadlineMs };
}
