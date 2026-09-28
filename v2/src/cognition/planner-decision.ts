/** Background proposals stop here. Only a fresh foreground choice supplies
 * arguments; only the native executor can establish that anything happened. */
import { createHash, randomUUID } from "node:crypto";
import { addComponent, entityExists, getRelationTargets, hasComponent } from "bitecs";
import { Agent, Goal, Name, Plan, PlanningDecision, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getKnownAffordances } from "../world/affordance-availability";
import { matchesAffordanceCommand } from "../world/affordance-command";
import { getAgentVisualEntities, getAgentWorldCapabilityGeneration } from "./world-capabilities";
import { workingMemoryEntityRef } from "./working-memory";
import { currentWorkingMemoryDependency } from "./working-memory-dependencies";
import { captureCoordinationGoal, getCoordinationGoalRef } from "./coordination-memory";
import { getPrivateCommunications } from "./communication-memory";
import { getPlanForGoal } from "./plan-state";
import type { GeneratedPlan, PlanStep } from "./planning-system";

export interface PlanDecisionProposal { purpose: string; target: string; command: string; }
const prose = (v: unknown, max = 400): v is string => typeof v === "string" && !!v.trim()
  && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
function targetFor(world: World, actor: number, label: string): number | undefined {
  const targets = getAgentVisualEntities(world, actor).filter(id => Name.value[id] === label);
  return targets.length === 1 ? targets[0] : undefined;
}
export function validatePlanDecision(world: World, actor: number, value: unknown): value is PlanDecisionProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as PlanDecisionProposal;
  if (Object.keys(p).some(k => !["purpose", "target", "command"].includes(k))
    || !prose(p.purpose) || !prose(p.target, 240) || !prose(p.command, 240)) return false;
  const target = targetFor(world, actor, p.target);
  return target !== undefined && getKnownAffordances(world, actor, target)
    .some(a => a.requiresFreshDecision && a.name === p.command);
}

/** Provider-only adaptation, not a relaxation of stored-action validation.
 * Discard drafts and speculative successors; never carry private wording in
 * an executable step. An earlier unknown response ends the prefix first. */
export function preservePlanDecision(world: World, actor: number, plan: GeneratedPlan | null): GeneratedPlan | null {
  if (!plan || !Array.isArray(plan.steps)) return plan;
  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== "object") return plan;
    if (step.actionType === "wait" && (!step.waitUntil || step.waitUntil.kind === "heard_evidence"))
      return { ...plan, steps: plan.steps.slice(0, index + 1), decision: undefined };
    if (step.actionType !== "interact" || typeof step.target !== "string" || typeof step.content !== "string") continue;
    const target = targetFor(world, actor, step.target);
    if (target === undefined) continue;
    const candidates = getKnownAffordances(world, actor, target).filter(a => matchesAffordanceCommand(a.name, step.content!));
    if (candidates.some(a => a.opensEvidenceBoundary)) return { goalDescription: plan.goalDescription,
      steps: plan.steps.slice(0, index + 1), estimatedCompletion: plan.estimatedCompletion, potentialObstacles: [] };
    if (!candidates.length || !candidates.every(a => a.requiresFreshDecision)) continue;
    const decision = { purpose: step.description, target: step.target, command: candidates[0].name };
    return { goalDescription: plan.goalDescription, steps: plan.steps.slice(0, index), decision,
      estimatedCompletion: plan.estimatedCompletion, potentialObstacles: [] };
  }
  return plan;
}

type Definition = PlanDecisionProposal & { version: 1; id: string; goalKey: string; targetKey: string; createdAtSimMs: number };
type Review = { disposition: "select" | "defer" | "decline"; reason: string; atSimMs: number; afterSeconds?: number; evidence: string };
type Grant = { actor: number; goal: number; target: number; definition: string; review: string; owner: string;
  goalBasis: string; persona: string; source: string | null; generation: object | undefined; prefix: string; created: number };
const grants = new WeakMap<World, Map<number, Grant>>();
const persona = (actor: number) => JSON.stringify([Name.value[actor], Agent.role[actor], Agent.systemPrompt[actor]]);
const goalBasis = (world: World, actor: number, goal: number) => JSON.stringify([getCoordinationGoalRef(world, actor, goal),
  Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]);
// Runtime completion/reconciliation metadata may change, but the action prefix may not.
function prefix(id: number): string {
  try { return JSON.stringify(JSON.parse(Plan.steps[id]).map((s: PlanStep) => [s.description, s.actionType, s.target,
    s.content, s.prerequisites, s.waitUntil, s.repeat, s.evidenceScope])); } catch { return "invalid"; }
}
export function issuePlanDecision(world: World, actor: number, goal: number, id: number, proposal: PlanDecisionProposal): boolean {
  assertSimulationTaskActive();
  if (!validatePlanDecision(world, actor, proposal) || !hasComponent(world, id, Plan)
    || Plan.goalEid[id] !== goal || !getRelationTargets(world, actor, HasPlan).includes(id)) return false;
  const ref = captureCoordinationGoal(world, actor, goal), target = targetFor(world, actor, proposal.target)!;
  const known = workingMemoryEntityRef(world, target);
  if (!ref || !known) return false;
  const definition: Definition = { ...proposal, version: 1, id: `decision:${randomUUID()}`, goalKey: ref.goalKey,
    targetKey: known.key, createdAtSimMs: readSimulationTime(world) };
  addComponent(world, id, PlanningDecision);
  PlanningDecision.ownerKey[id] = ref.ownerKey;
  PlanningDecision.definitionJson[id] = JSON.stringify(definition); PlanningDecision.reviewJson[id] = "";
  let rows = grants.get(world); if (!rows) { rows = new Map(); grants.set(world, rows); }
  for (const [old, grant] of rows) if (!entityExists(world, old) || !["active", "awaiting_decision"].includes(Plan.status[old])
    || Goal.status[grant.goal] !== "active") rows.delete(old);
  if (rows.size >= 2048) rows.delete(rows.keys().next().value!);
  rows.set(id, { actor, goal, target, definition: PlanningDecision.definitionJson[id], review: "", owner: ref.ownerKey,
    goalBasis: goalBasis(world, actor, goal), persona: persona(actor), source: getCommittedEvents(world).sourceId,
    generation: getAgentWorldCapabilityGeneration(world, actor), prefix: prefix(id), created: Plan.createdAt[id] });
  return true;
}
function current(world: World, actor: number, id: number): { grant: Grant; definition: Definition } | undefined {
  const g = grants.get(world)?.get(id), tape = getCommittedEvents(world);
  if (!g || g.actor !== actor || tape.stopped || tape.sourceId !== g.source || !entityExists(world, actor)
    || !hasComponent(world, actor, Agent) || !Agent.active[actor] || !hasComponent(world, actor, WorkingMemoryIdentity)
    || WorkingMemoryIdentity.id[actor] !== g.owner || persona(actor) !== g.persona
    || getAgentWorldCapabilityGeneration(world, actor) !== g.generation || !entityExists(world, id)
    || !hasComponent(world, id, Plan) || !hasComponent(world, id, PlanningDecision)
    || PlanningDecision.ownerKey[id] !== g.owner || PlanningDecision.definitionJson[id] !== g.definition
    || PlanningDecision.reviewJson[id] !== g.review || Plan.createdAt[id] !== g.created || prefix(id) !== g.prefix
    || !["active", "awaiting_decision"].includes(Plan.status[id]) || Plan.goalEid[id] !== g.goal
    || !entityExists(world, g.goal) || !hasComponent(world, g.goal, Goal) || Goal.status[g.goal] !== "active"
    || !getRelationTargets(world, actor, HasGoal).includes(g.goal) || goalBasis(world, actor, g.goal) !== g.goalBasis
    || getPlanForGoal(world, actor, g.goal) !== id || !entityExists(world, g.target)
    || !hasComponent(world, g.target, WorkingMemoryIdentity)) return;
  const definition: Definition = JSON.parse(g.definition);
  if (WorkingMemoryIdentity.id[g.target] !== definition.targetKey || Name.value[g.target] !== definition.target
    || readSimulationTime(world) < definition.createdAtSimMs) return;
  return { grant: g, definition };
}
function evidence(world: World, actor: number, d: Definition): string {
  // Own observed facts/receipts only. No unseen phone inbox or another mind.
  return createHash("sha256").update(JSON.stringify([currentWorkingMemoryDependency(world, actor, [d.target, d.targetKey]),
    getPrivateCommunications(world, actor).map(r => [r.id, r.content])])).digest("hex");
}
export function planDecisionNeedsReplanning(world: World, actor: number, id: number): boolean {
  const row = current(world, actor, id);
  if (!row || !validatePlanDecision(world, actor, {
    purpose: row.definition.purpose, target: row.definition.target, command: row.definition.command })) return true;
  const review: Review | undefined = row.grant.review ? JSON.parse(row.grant.review) : undefined;
  // A selection isn't success: actual new native evidence can request a new plan.
  return !!review && review.evidence !== evidence(world, actor, row.definition);
}
export type PlanDecisionContext = Readonly<{ items: readonly Readonly<PlanDecisionProposal & { id: string; goalId: number; createdAtSimMs: number }>[] }>;
type Issued = { world: World; actor: number; choices: Map<string, { plan: number; grant: Grant; definition: Definition;
  review: string; evidence: string }>; at: number };
const contexts = new WeakMap<PlanDecisionContext, Issued>();
export function capturePlanDecisions(world: World, actor: number): PlanDecisionContext {
  const choices: Issued["choices"] = new Map(), items: Array<PlanDecisionContext["items"][number]> = [];
  const at = readSimulationTime(world);
  for (const id of getRelationTargets(world, actor, HasPlan)) {
    if (Plan.status[id] !== "awaiting_decision") continue;
    const row = current(world, actor, id);
    if (!row || planDecisionNeedsReplanning(world, actor, id)) continue;
    const review: Review | undefined = row.grant.review ? JSON.parse(row.grant.review) : undefined;
    if (review && (review.disposition !== "defer" || at < review.atSimMs + review.afterSeconds! * 1000)) continue;
    const d = row.definition;
    choices.set(d.id, { plan: id, ...row, review: row.grant.review, evidence: evidence(world, actor, d) });
    items.push(Object.freeze({ id: d.id, goalId: row.grant.goal, purpose: d.purpose, target: d.target, command: d.command, createdAtSimMs: d.createdAtSimMs }));
    if (items.length === 3) break;
  }
  const context = Object.freeze({ items: Object.freeze(items) }); contexts.set(context, { world, actor, choices, at });
  return context;
}
export function formatPlanDecisions(context: PlanDecisionContext): string {
  const at = contexts.get(context)?.at;
  const items = context.items.map(item => ({ ...item, ...(at === undefined ? {} : {
    awaitingChoiceSeconds: Math.max(0, Math.floor((at - item.createdAtSimMs) / 1000)) }) }));
  return items.length ? `PROPOSED NEXT DECISIONS — NOT QUEUED ACTIONS:\n${JSON.stringify(items)}
These plans have reached a choice. You may select one with fresh arguments, defer it, decline it, or pursue something else. Optional planDecision: {"id":"listed decision ID","disposition":"select|defer|decline","reason":"your reason"}. For select, choose the matching interact action and control.goalId; compose its content from current knowledge. You may defer or decline a proposal while acting for another goal. An independent action need not adopt a proposal; omit planDecision when you are not reviewing one. For defer, add afterSeconds (10–60 simulated seconds). Review is not execution or goal completion.` : "";
}

/** A provider may attach a valid proposal for a different concern to an
 * explicitly selected action. Keep the actor's stated goal; never transfer the
 * proposal's authority, mutate its owner, or credit it with this action.
 * Only this redundant metadata may detach. Strict proposal validation and
 * ordinary foreground/native action admission still run in full. */
export function prepareForegroundPlanDecisionReview(context: PlanDecisionContext, value: unknown,
  selection: { goalId: number | null | undefined; action: { type: string; target?: string; content?: string } }, onStale?: () => void) {
  const direct = preparePlanDecisionReview(context, value, selection, onStale);
  if (direct) return { ...direct, detached: false };
  const issued = contexts.get(context), v = value as Record<string, unknown> | null;
  if (!issued || !v || typeof v !== "object" || v.disposition !== "select" || typeof v.id !== "string"
    || typeof selection.goalId !== "number") return;
  const row = issued.choices.get(v.id);
  if (!row || row.grant.goal === selection.goalId) return;
  // Existing goal references provide ownership without issuing new authority.
  const selectedGoal = selection.goalId, selectedBasis = getCoordinationGoalRef(issued.world, issued.actor, selectedGoal);
  if (!selectedBasis || Goal.status[selectedGoal] !== "active") return;
  const proposal = preparePlanDecisionReview(context, value, { ...selection, goalId: row.grant.goal }, onStale);
  if (!proposal) return;
  let consumed = false;
  const current = () => !consumed && proposal.current() && Goal.status[selectedGoal] === "active"
    && JSON.stringify(getCoordinationGoalRef(issued.world, issued.actor, selectedGoal)) === JSON.stringify(selectedBasis);
  return { detached: true, current, summary: Object.freeze({ ...proposal.summary, selectedGoalId: selectedGoal,
    reason: "Independent action under a different owned goal; referenced plan left unchanged." }),
    commit: () => { assertSimulationTaskActive(); if (!current()) return false; consumed = true; return true; } };
}
export function preparePlanDecisionReview(context: PlanDecisionContext, value: unknown,
  selection?: { goalId: number | null | undefined; action: { type: string; target?: string; content?: string } }, onStale?: () => void) {
  const issued = contexts.get(context);
  if (!issued || !value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>, row = typeof v.id === "string" ? issued.choices.get(v.id) : undefined;
  if (!row || Object.keys(v).some(k => !["id", "disposition", "reason", "afterSeconds"].includes(k))
    || !["select", "defer", "decline"].includes(String(v.disposition)) || !prose(v.reason)
    || (v.disposition === "defer" ? typeof v.afterSeconds !== "number" || !Number.isFinite(v.afterSeconds)
      || v.afterSeconds < 10 || v.afterSeconds > 60 : v.afterSeconds !== undefined)) return;
  if (v.disposition === "select" && (!selection || selection.goalId !== row.grant.goal || selection.action.type !== "interact"
    || selection.action.target !== row.definition.target || !matchesAffordanceCommand(row.definition.command, selection.action.content || ""))) return;
  const selected = { id: row.definition.id, disposition: v.disposition as Review["disposition"], reason: v.reason.trim(),
    ...(v.disposition === "defer" ? { afterSeconds: v.afterSeconds as number } : {}) };
  const stillCurrent = () => current(issued.world, issued.actor, row.plan)?.grant === row.grant
    && Plan.status[row.plan] === "awaiting_decision" && row.grant.review === row.review
    && !planDecisionNeedsReplanning(issued.world, issued.actor, row.plan)
    && evidence(issued.world, issued.actor, row.definition) === row.evidence && readSimulationTime(issued.world) >= issued.at;
  if (!stillCurrent()) { onStale?.(); return; }
  let consumed = false;
  return { current: () => !consumed && stillCurrent(), summary: Object.freeze({ ...selected, goalId: row.grant.goal }),
    commit: () => {
      assertSimulationTaskActive(); if (consumed || !stillCurrent()) return false;
      consumed = true;
      row.grant.review = JSON.stringify({ ...selected, atSimMs: readSimulationTime(issued.world), evidence: row.evidence });
      PlanningDecision.reviewJson[row.plan] = row.grant.review;
      return true;
    } };
}
