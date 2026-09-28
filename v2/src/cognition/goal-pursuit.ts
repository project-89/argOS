/** Deliberate suspension of personal intentions, separate from success proof.
 * Waiting concerns attention, not the body. A deadline requests reconsideration;
 * it never pretends that another person replied or that a problem was solved. */
import { getRelationTargets, hasComponent } from "bitecs";
import { Agent, Goal, GoalLifecycle, Name, WorkingMemoryIdentity } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import type { World } from "../ecs/world";
import { readSimulationTime } from "../ecs/simulation-time";
import { readStampedSimulationTime, stampSimulationTime, simulationDeadlinePassed } from "../ecs/temporal-age";
import { getPreparedIntentionGoalRef, isPreparedIntentionCurrent, isSelfDirectedIntention, pendingIntentionReview, type PreparedGeneratedIntention } from "./goal-lifecycle";
import { createHash } from "node:crypto";
import { getCoordinationGoalRef } from "./coordination-memory";
import { getCommittedEvents } from "../runtime/committed-events";
import { assertSimulationTaskActive } from "../runtime/task-scope";
import { getSocialDialogue } from "./social-memory";
import { experiencedChannelVersions } from "./experience-appraisal";
import { scheduledGoalOccurrence } from "./schedule-occurrences";
import { getGoalDependents, retireGoalDependents } from "./goal-dependents";
import { settleReviewedGoalActivity } from "./ongoing-activity";
import { retireGoalPlans } from "./plan-state";

type Wake = { kind: "review" } | { kind: "experience"; channel: string } | { kind: "speech"; speaker: string };
type Review = { goalId: number; disposition: "retain" | "defer" | "release" | "withdraw"; reason: string; afterSeconds?: number; wake?: Wake };
type Deferred = { owner: string; source: string | null; definition: string; until: number; since: number;
  wake: Wake; frontier: string; reason: string };
const goals = (world: World, eid: number) => getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal));
const definition = (g: number) => JSON.stringify([WorkingMemoryIdentity.id[g], Goal.createdAt[g], Goal.description[g], Goal.kind[g], Goal.paramsJson[g], Goal.successJson[g]]);
const lifecycleBasis = (g: number) => JSON.stringify([definition(g), Goal.priority[g], Goal.status[g], Goal.deadline[g], GoalLifecycle.source[g], GoalLifecycle.mode[g], GoalLifecycle.persistence[g], GoalLifecycle.deferredJson[g], GoalLifecycle.reviewPendingJson[g], GoalLifecycle.reviewRevision[g]]);
const basis = (g: number) => JSON.stringify([lifecycleBasis(g), GoalLifecycle.handoffReviewJson[g]]);
const dependentBasis = (world: World, eid: number, g: number) => JSON.stringify(getGoalDependents(world, eid, g).map(child => [child, lifecycleBasis(child)]));
const persona = (eid: number) => JSON.stringify([Name.value[eid], Agent.role[eid], Agent.systemPrompt[eid]]);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function eligible(world: World, eid: number, g: number): boolean {
  if (!hasComponent(world, eid, Agent) || !Agent.active[eid] || !hasComponent(world, eid, WorkingMemoryIdentity) || !WorkingMemoryIdentity.id[eid] || !goals(world, eid).includes(g)
    || !hasComponent(world, g, GoalLifecycle)) return false;
  if (pendingIntentionReview(world, eid, g)) return !simulationDeadlinePassed(world, g, "Goal.deadline", Goal.deadline[g]);
  if (Goal.status[g] !== "active") return false;
  if (GoalLifecycle.source[g] === "schedule" && GoalLifecycle.mode[g] === "verified" && GoalLifecycle.persistence[g] === "episodic") {
    const occurrence = scheduledGoalOccurrence(world, eid, g);
    return !!occurrence && occurrence.phase !== "future" && occurrence.interruptible;
  }
  if (!["foreground", "autonomous", "personal"].includes(GoalLifecycle.source[g])
    || !["social", "exploratory"].includes(GoalLifecycle.mode[g])) return false;
  try { return JSON.parse(Goal.successJson[g]).type === "custom"; } catch { return false; }
}
function frontier(world: World, eid: number, wake: Wake): string {
  if (wake.kind === "experience") return String(experiencedChannelVersions(world, eid).find(c => c.channel === wake.channel)?.revision ?? -1);
  if (wake.kind === "speech") return JSON.stringify(getSocialDialogue(world, eid).filter(t => !t.own && t.speaker === wake.speaker).map(t => t.id));
  return "";
}
export function captureGoalReviewContext(world: World, eid: number) {
  const wakeOptions: Wake[] = [{ kind: "review" },
    ...experiencedChannelVersions(world, eid).map(c => ({ kind: "experience" as const, channel: c.channel })),
    ...[...new Set(getSocialDialogue(world, eid).filter(t => !t.own).map(t => t.speaker))].map(speaker => ({ kind: "speech" as const, speaker }))];
  return { world, eid, owner: WorkingMemoryIdentity.id[eid], source: getCommittedEvents(world).sourceId, persona: persona(eid),
    goals: new Map(goals(world, eid).filter(g => eligible(world, eid, g)).map(g => [g, basis(g)])),
    dependents: new Map(goals(world, eid).filter(g => eligible(world, eid, g)).map(g => [g, dependentBasis(world, eid, g)])),
    wakes: wakeOptions.map(wake => ({ wake, frontier: frontier(world, eid, wake) })) };
}
type Context = ReturnType<typeof captureGoalReviewContext>;

/** One private draft per goal, with no executor or fast-clock consumer. Only a
 * fresh foreground decision can apply a review. Actual action outcomes (even a
 * failed dispatch) remain ordinary experience, never inferred from this draft. */
export function pendingHandoffReview(world: World, eid: number, goal: number): { disposition: "release" | "withdraw"; reason: string; atSimMs: number } | undefined {
  if (!eligible(world, eid, goal) || Goal.status[goal] !== "active" || getCommittedEvents(world).stopped) return;
  const raw = GoalLifecycle.handoffReviewJson[goal];
  if (!raw || raw.length > 16000) return;
  try {
    const r = JSON.parse(raw), now = readSimulationTime(world);
    if (r.owner === WorkingMemoryIdentity.id[eid] && r.source === getCommittedEvents(world).sourceId
      && r.persona === digest(persona(eid)) && r.basis === digest(lifecycleBasis(goal)) && r.dependents === digest(dependentBasis(world, eid, goal))
      && ["release", "withdraw"].includes(r.disposition) && typeof r.reason === "string" && r.reason.trim() && r.reason.length <= 400
      && Number.isFinite(r.atSimMs) && r.atSimMs >= 0 && now >= r.atSimMs && now < r.atSimMs + 60_000)
      return { disposition: r.disposition, reason: r.reason, atSimMs: r.atSimMs };
  } catch { /* Malformed or restored historical data is not an instruction. */ }
}

/** Initial personal follow-up only. The caller has grounded the chosen review
 * time in an owned undertaking. Uses the SAME deferred-goal data and fast-clock
 * resumer, without widening foreground deferral authority or scheduling actions.
 * Prepare before allocating the intention; commit synchronously after it. */
export function prepareInitialGoalDeferral(world: World, eid: number, intention: PreparedGeneratedIntention,
  input: { untilSimMs: number; reason: string }) {
  const ref = getPreparedIntentionGoalRef(world, eid, intention), source = getCommittedEvents(world).sourceId;
  const until = input.untilSimMs, reason = input.reason;
  if (!ref || !isPreparedIntentionCurrent(world, eid, intention) || getCommittedEvents(world).stopped
    || !Number.isSafeInteger(until) || until <= readSimulationTime(world) || until > readSimulationTime(world) + 86_400_000
    || typeof reason !== "string" || !reason.trim() || reason.length > 400) return;
  let consumed = false;
  return { current: () => !consumed && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === source
    && isPreparedIntentionCurrent(world, eid, intention),
    commit(goal: number): boolean {
      assertSimulationTaskActive();
      if (consumed || getCommittedEvents(world).stopped || getCommittedEvents(world).sourceId !== source
        || !eligible(world, eid, goal) || JSON.stringify(getCoordinationGoalRef(world, eid, goal)) !== JSON.stringify(ref)) return false;
      consumed = true;
      const now = readSimulationTime(world);
      if (now >= until) return true; // never slide the requested time forward with inference latency
      Goal.status[goal] = "paused";
      GoalLifecycle.reason[goal] = reason.trim(); GoalLifecycle.settledAt[goal] = Date.now();
      stampSimulationTime(world, goal, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[goal]);
      GoalLifecycle.deferredJson[goal] = JSON.stringify({ owner: ref.ownerKey, source, definition: definition(goal),
        until, since: now, wake: { kind: "review" }, frontier: "", reason: reason.trim() } satisfies Deferred);
      // Waiting is not spent execution budget. Preserve the original working
      // budget after the review, in lived time, without changing goal birth.
      if (Goal.deadline[goal] > 0) {
        const deadline = readStampedSimulationTime(world, goal, "Goal.deadline", Goal.deadline[goal]);
        Goal.deadline[goal] += until - now;
        stampSimulationTime(world, goal, "Goal.deadline", Goal.deadline[goal], deadline + until - now);
      }
      return true;
    } };
}
/** Prompt projection only; reading a future review never wakes it or refreshes age. */
export function deferredGoalReviewTime(world: World, eid: number, goal: number): number | undefined {
  if (!goals(world, eid).includes(goal) || !hasComponent(world, goal, GoalLifecycle) || Goal.status[goal] !== "paused") return;
  try {
    const row: Deferred = JSON.parse(GoalLifecycle.deferredJson[goal]);
    if (row?.owner === WorkingMemoryIdentity.id[eid] && row.definition === definition(goal)
      && Number.isFinite(row.until) && row.until >= 0) return row.until;
  } catch { /* Legacy or malformed deferral is not a known review time. */ }
}
export function formatGoalPursuitContext(world: World, eid: number, context = captureGoalReviewContext(world, eid)): string {
  return `INTENTION REVIEW (not success proof):\n${[...context.goals.keys()].map(g => {
    const pending = pendingIntentionReview(world, eid, g), handoff = pendingHandoffReview(world, eid, g);
    return `[goalId=${g}; persistence=${GoalLifecycle.persistence[g] === "standing" ? "standing; operations=defer,withdraw" : `episodic; operations=${pending ? "retain," : ""}defer,release`}] ${Goal.description[g]}${pending ? ` — awaiting your reconsideration for ${Math.floor((readSimulationTime(world) - pending.atSimMs) / 1000)}s: ${pending.reason}` : ""}${handoff ? `\nPENDING HANDOFF REVIEW (${Math.floor((readSimulationTime(world) - handoff.atSimMs) / 1000)}s ago): you proposed ${handoff.disposition} while also choosing work toward this purpose: ${JSON.stringify(handoff.reason)}. The goal is still active. This is your earlier proposal, not an instruction or proof the action happened. Reconsider from current outcomes; apply a fresh goalReview only if still wanted, or keep pursuing it.` : ""}`;
  }).join("\n") || "No eligible intentions."}
Deferred intentions:\n${goals(world, eid).filter(g => Goal.status[g] === "paused" && GoalLifecycle.deferredJson[g]).map(g => {
  const at = deferredGoalReviewTime(world, eid, g);
  return `[goalId=${g}] ${Goal.description[g]} — ${GoalLifecycle.reason[g]}${at === undefined ? "" : `; review at simulation ${at}ms (in ${Math.max(0, Math.ceil((at - readSimulationTime(world)) / 1000))}s, not proof of an appointment or outcome)`}`;
}).join("\n") || "None."}
Wake conditions you can select exactly: ${JSON.stringify(context.wakes.map(w => w.wake))}`;
}
export type GoalReviewRejectionField = "goalReview.schema" | "goalReview.reason" | "goalReview.goal" | "goalReview.operation" | "goalReview.deferral" | "goalReview.changed";
export function prepareGoalReview(context: Context, input: unknown, onRejected?: (field: GoalReviewRejectionField) => void): { current(): boolean; commit(): boolean; queueForReconsideration(): boolean; readonly queueable: boolean; goalId: number; disposition: Review["disposition"] } | undefined {
  const reject = (field: GoalReviewRejectionField): undefined => {
    try { onRejected?.(field); } catch { /* Diagnostics cannot turn rejection into admission. */ }
    return undefined;
  };
  const value = input as Review, { world, eid } = context;
  if (!value || typeof value !== "object" || Array.isArray(value)) return reject("goalReview.schema");
  const r = { ...value, ...(value.wake ? { wake: { ...value.wake } } : {}) };
  if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !["goalId", "disposition", "reason", "afterSeconds", "wake"].includes(k))
    || !Number.isSafeInteger(r.goalId) || !["retain", "defer", "release", "withdraw"].includes(r.disposition)) return reject("goalReview.schema");
  if (typeof r.reason !== "string" || !r.reason.trim() || r.reason.length > 400) return reject("goalReview.reason");
  if (!context.goals.has(r.goalId)) return reject("goalReview.goal");
  if (r.disposition === "retain" ? !pendingIntentionReview(world, eid, r.goalId)
    : r.disposition !== "defer" && r.disposition !== (GoalLifecycle.persistence[r.goalId] === "standing" ? "withdraw" : "release"))
    return reject("goalReview.operation");
  const canonical = (v: object) => JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
  const match = r.disposition === "defer" && r.wake && typeof r.wake === "object"
    ? context.wakes.find(w => canonical(w.wake) === canonical(r.wake!)) : undefined;
  if (r.disposition === "defer" && (!match || !Number.isInteger(r.afterSeconds) || r.afterSeconds! < 10 || r.afterSeconds! > 60)
    || r.disposition !== "defer" && (r.wake !== undefined || r.afterSeconds !== undefined)) return reject("goalReview.deferral");
  let consumed = false;
  const current = () => !consumed && !getCommittedEvents(world).stopped && getCommittedEvents(world).sourceId === context.source
    && persona(eid) === context.persona
    && WorkingMemoryIdentity.id[eid] === context.owner && eligible(world, eid, r.goalId) && basis(r.goalId) === context.goals.get(r.goalId)
    && dependentBasis(world, eid, r.goalId) === context.dependents.get(r.goalId)
    && (!match || frontier(world, eid, match.wake) === match.frontier);
  if (!current()) return reject("goalReview.changed");
  const queueable = Goal.status[r.goalId] === "active" && isSelfDirectedIntention(world, r.goalId) && ["release", "withdraw"].includes(r.disposition);
  return { goalId: r.goalId, disposition: r.disposition, queueable, current, queueForReconsideration() {
    assertSimulationTaskActive();
    if (!current() || !queueable) return false;
    consumed = true;
    GoalLifecycle.handoffReviewJson[r.goalId] = JSON.stringify({ owner: context.owner, source: context.source, persona: digest(context.persona),
      basis: digest(lifecycleBasis(r.goalId)), dependents: digest(dependentBasis(world, eid, r.goalId)), disposition: r.disposition, reason: r.reason.trim(), atSimMs: readSimulationTime(world) });
    return true;
  }, commit() {
    assertSimulationTaskActive(); if (!current()) return false; consumed = true;
    const g = r.goalId, now = readSimulationTime(world);
    GoalLifecycle.handoffReviewJson[g] = "";
    GoalLifecycle.reviewPendingJson[g] = "";
    if (r.disposition === "retain") {
      Goal.status[g] = "active"; GoalLifecycle.reason[g] = r.reason.trim(); GoalLifecycle.settledAt[g] = 0;
      GoalLifecycle.resumedAt[g] = Date.now(); stampSimulationTime(world, g, "GoalLifecycle.resumedAt", GoalLifecycle.resumedAt[g], now);
      GoalLifecycle.reviewAfter[g] = Date.now() + 60_000;
      stampSimulationTime(world, g, "GoalLifecycle.reviewAfter", GoalLifecycle.reviewAfter[g], now + 60_000);
      // Old plans were retired at the review boundary. No action/activity grant is restored.
      return true;
    }
    Goal.status[g] = r.disposition === "defer" ? "paused" : "retired";
    GoalLifecycle.reason[g] = r.reason.trim(); GoalLifecycle.settledAt[g] = Date.now();
    stampSimulationTime(world, g, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[g]);
    GoalLifecycle.deferredJson[g] = match ? JSON.stringify({ owner: context.owner, source: context.source, definition: definition(g),
      until: now + r.afterSeconds! * 1000, since: now, wake: match.wake, frontier: match.frontier, reason: r.reason.trim() } satisfies Deferred) : "";
    // Old actions were proposals for a different decision context. Keep their
    // history, but replan on resumption instead of replaying an old demand.
    retireGoalPlans(world, g, getRelationTargets(world, eid, HasPlan));
    retireGoalDependents(world, eid, g, "The supporting intention was deferred or released; this is not accomplishment.");
    settleReviewedGoalActivity(world, eid, g, r.disposition);
    return true;
  } };
}
/** Called on the fast clock, including while a model is busy. Source restarts
 * force review; durable deferred goals never become permanent sleeping tombs. */
export function resumeDeferredGoals(world: World, eid: number): number {
  assertSimulationTaskActive();
  if (!hasComponent(world, eid, Agent) || !Agent.active[eid] || getCommittedEvents(world).stopped) return 0;
  let count = 0;
  for (const g of goals(world, eid)) {
    if (!hasComponent(world, g, GoalLifecycle) || Goal.status[g] !== "paused" || !GoalLifecycle.deferredJson[g]) continue;
    let row: Deferred;
    try { row = JSON.parse(GoalLifecycle.deferredJson[g]); } catch { continue; }
    if (!row || row.owner !== WorkingMemoryIdentity.id[eid] || row.definition !== definition(g)) continue;
    if (GoalLifecycle.source[g] === "schedule" && !scheduledGoalOccurrence(world, eid, g)) {
      Goal.status[g] = "retired"; GoalLifecycle.deferredJson[g] = "";
      GoalLifecycle.reason[g] = "The source schedule occurrence was replaced; this is not accomplishment.";
      GoalLifecycle.settledAt[g] = Date.now(); stampSimulationTime(world, g, "GoalLifecycle.settledAt", GoalLifecycle.settledAt[g]);
      continue;
    }
    const now = readSimulationTime(world);
    if (row.wake && ["review", "experience", "speech"].includes(row.wake.kind)
      && row.source === getCommittedEvents(world).sourceId && Number.isFinite(row.until) && now >= row.since && now < row.until
      && frontier(world, eid, row.wake) === row.frontier) continue;
    Goal.status[g] = "active"; GoalLifecycle.deferredJson[g] = "";
    GoalLifecycle.resumedAt[g] = Date.now();
    stampSimulationTime(world, g, "GoalLifecycle.resumedAt", GoalLifecycle.resumedAt[g], now);
    GoalLifecycle.reason[g] = `Reconsider deferred intention: ${row.reason}. New evidence or review time is not success proof.`;
    GoalLifecycle.reviewAfter[g] = Date.now() + 60_000;
    stampSimulationTime(world, g, "GoalLifecycle.reviewAfter", GoalLifecycle.reviewAfter[g], now + 60_000);
    count++;
  }
  return count;
}
