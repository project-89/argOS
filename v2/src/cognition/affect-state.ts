/** A brief self-appraisal belongs to the NPC, not to the narrator. It is staged
 * with foreground cognition and committed only by its admitted mental envelope.
 * Feeling something does not automatically reveal it to another person. */
import { randomUUID } from "node:crypto";
import { addComponent, entityExists, hasComponent } from "bitecs";
import { AffectState, Agent, Appearance, Mind, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { setEmotionalActivation } from "./emotional-life";

/** Physical facial descriptions, not private causes, inferred intentions, or
 * arbitrary prose that could put a hidden phone message into the public scene. */
export const FACIAL_EXPRESSIONS = ["neutral", "attentive", "smiling", "frowning", "brow furrowed", "eyes widened",
  "jaw clenched", "lips pressed", "tearful", "downcast", "squinting", "composed"] as const;
export type FacialExpression = typeof FACIAL_EXPRESSIONS[number];
export interface AffectUpdate {
  feeling: string; valence: number; arousal: number; reason: string; expression?: FacialExpression;
}
export interface AffectSnapshot {
  readonly feeling: string; readonly valence: number; readonly arousal: number; readonly reason: string;
  readonly expression?: FacialExpression; readonly revision: number; readonly updatedAtSimMs: number;
}
export interface PreparedAffectUpdate { readonly token: string }
type Draft = { world: World; eid: number; ownerKey: string; basis: string; proposal: Readonly<AffectUpdate>;
  expression?: string; consumed: boolean };
const drafts = new WeakMap<PreparedAffectUpdate, Draft>();
const isExpression = (value: unknown): value is FacialExpression => typeof value === "string"
  && (FACIAL_EXPRESSIONS as readonly string[]).includes(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.trim().length > 0
  && value.length <= limit && !/[\u0000-\u001f\u007f]/u.test(value);
const actor = (world: World, eid: number) => entityExists(world, eid) && hasComponent(world, eid, Agent)
  && Agent.active[eid] && hasComponent(world, eid, WorkingMemoryIdentity) && !!WorkingMemoryIdentity.id[eid];
function basis(world: World, eid: number): string {
  return JSON.stringify(hasComponent(world, eid, AffectState) ? [AffectState.ownerKey[eid], AffectState.feeling[eid],
    AffectState.valence[eid], AffectState.arousal[eid], AffectState.reason[eid], AffectState.revision[eid], AffectState.updatedAtSimMs[eid]] : null);
}
function validProposal(value: unknown): value is AffectUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proposal = value as AffectUpdate;
  return Object.keys(proposal).every(key => ["feeling", "valence", "arousal", "reason", "expression"].includes(key))
    && text(proposal.feeling, 80) && text(proposal.reason, 240)
    && typeof proposal.valence === "number" && Number.isFinite(proposal.valence) && proposal.valence >= -1 && proposal.valence <= 1
    && typeof proposal.arousal === "number" && Number.isFinite(proposal.arousal) && proposal.arousal >= 0 && proposal.arousal <= 1
    && (proposal.expression === undefined || isExpression(proposal.expression));
}
/** The caller must independently gate sight/containment before showing this
 * public field to an observer. This function never returns private affect. */
export function publicFacialExpression(world: World, eid: number): FacialExpression | undefined {
  return entityExists(world, eid) && hasComponent(world, eid, Agent) && hasComponent(world, eid, Appearance)
    && isExpression(Appearance.expression[eid]) ? Appearance.expression[eid] as FacialExpression : undefined;
}
/** Pure, private operator/self projection. Shared sparse-array residue from an
 * earlier actor lifetime is never an inherited feeling. */
export function snapshotAffect(world: World, eid: number): Readonly<AffectSnapshot> | undefined {
  if (!actor(world, eid) || !hasComponent(world, eid, AffectState) || AffectState.ownerKey[eid] !== WorkingMemoryIdentity.id[eid]) return;
  const proposal = { feeling: AffectState.feeling[eid], valence: AffectState.valence[eid], arousal: AffectState.arousal[eid], reason: AffectState.reason[eid] };
  if (!validProposal(proposal) || !Number.isSafeInteger(AffectState.revision[eid]) || AffectState.revision[eid] < 1
    || !Number.isFinite(AffectState.updatedAtSimMs[eid]) || AffectState.updatedAtSimMs[eid] < 0) return;
  const expression = publicFacialExpression(world, eid);
  return Object.freeze({ ...proposal, ...(expression ? { expression } : {}), revision: AffectState.revision[eid], updatedAtSimMs: AffectState.updatedAtSimMs[eid] });
}
/** No ECS writes, identity allocation, stimulus delivery or public event. */
export function prepareAffectUpdate(world: World, eid: number, proposal: unknown): PreparedAffectUpdate | null {
  assertSimulationTaskActive();
  if (!actor(world, eid) || getCommittedEvents(world).stopped || !validProposal(proposal)) return null;
  const token = Object.freeze({ token: `affect:${randomUUID()}` });
  drafts.set(token, { world, eid, ownerKey: WorkingMemoryIdentity.id[eid], basis: basis(world, eid),
    proposal: Object.freeze({ ...proposal, feeling: proposal.feeling.trim(), reason: proposal.reason.trim() }),
    ...(proposal.expression !== undefined ? { expression: hasComponent(world, eid, Appearance) ? Appearance.expression[eid] : "" } : {}), consumed: false });
  return token;
}
export function isPreparedAffectCurrent(world: World, eid: number, token: PreparedAffectUpdate): boolean {
  const draft = drafts.get(token);
  return !!draft && !draft.consumed && draft.world === world && draft.eid === eid && actor(world, eid)
    && !getCommittedEvents(world).stopped && draft.ownerKey === WorkingMemoryIdentity.id[eid] && draft.basis === basis(world, eid)
    && (draft.proposal.expression === undefined || draft.expression === (hasComponent(world, eid, Appearance) ? Appearance.expression[eid] : ""));
}
/** Call only inside the foreground mental commit, after all other validation.
 * No model call, language interpretation, callbacks, or success inference. */
export function commitPreparedAffectUpdate(world: World, eid: number, token: PreparedAffectUpdate): boolean {
  assertSimulationTaskActive();
  if (!isPreparedAffectCurrent(world, eid, token)) return false;
  const draft = drafts.get(token)!; draft.consumed = true;
  const previous = snapshotAffect(world, eid), { proposal } = draft;
  addComponent(world, eid, AffectState);
  AffectState.ownerKey[eid] = draft.ownerKey; AffectState.feeling[eid] = proposal.feeling;
  AffectState.valence[eid] = proposal.valence; AffectState.arousal[eid] = proposal.arousal; AffectState.reason[eid] = proposal.reason;
  AffectState.revision[eid] = (previous?.revision ?? 0) + 1; AffectState.updatedAtSimMs[eid] = readSimulationTime(world);
  if (hasComponent(world, eid, Mind)) Mind.arousal[eid] = proposal.arousal;
  setEmotionalActivation(world, eid, proposal.arousal);
  if (proposal.expression !== undefined) {
    if (!hasComponent(world, eid, Appearance)) {
      // Adding expression-only appearance must not revive stale clothing or
      // identity fields left in shared sparse arrays by an earlier actor.
      for (const [field, values] of Object.entries(Appearance)) (values as Array<string | number>)[eid] = field === "lastUpdate" ? 0 : "";
    }
    addComponent(world, eid, Appearance); Appearance.expression[eid] = proposal.expression; Appearance.lastUpdate[eid] = Date.now();
  }
  return true;
}
export function formatAffectContext(world: World, eid: number): string {
  const current = snapshotAffect(world, eid);
  return current ? `YOUR LAST SELF-APPRAISAL (private interpretation, not proof about other people):\n`
    + `${JSON.stringify({ feeling: current.feeling, valence: current.valence, arousal: current.arousal, reason: current.reason })}\n`
    + `Your visible expression is ${JSON.stringify(current.expression ?? "not specified")}. It need not reveal what you feel.`
    : publicFacialExpression(world, eid) ? `YOUR VISIBLE EXPRESSION: ${JSON.stringify(publicFacialExpression(world, eid))}. No private self-appraisal recorded yet.` : "";
}
