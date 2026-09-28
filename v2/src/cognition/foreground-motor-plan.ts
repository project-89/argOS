import { entityExists, hasComponent, query } from "bitecs";
import { Goal, Plan, PlanningDecision, Name, WorkingMemoryIdentity } from "../ecs/components";
import type { World } from "../ecs/world";
import type { CognitiveLocalView } from "./cognitive-local-view";
import { areLocalDependenciesCurrent } from "./cognitive-local-view";
import { createPlanEntity, getPlanForGoal, validateGeneratedPlan, type GeneratedPlan, type PlanStep } from "./planning-system";
import { createMotorPlanScope } from "./motor-plan-scope";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { getAgentWorldCapabilities } from "./world-capabilities";
import { isSpeaking } from "./timed-speech";

/** Optional 2–4 step physical prefix chosen in the existing foreground call.
 * It ends at its first information/tool boundary: no prewritten reaction to an
 * unread result. Long or contingent plans still belong to the subconscious. */
export function prepareForegroundMotorPlan(world: World, eid: number, goal: number, raw: unknown,
  first: { type: string; target?: string; content?: string }, view: CognitiveLocalView) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4 || !entityExists(world, goal) || !hasComponent(world, goal, Goal)) return;
  const steps: PlanStep[] = [];
  const targets: Array<{ eid: number; key: string; name: string }> = [];
  for (const [index, step] of raw.entries()) {
    if (!step || typeof step !== "object" || Object.keys(step).some(k => !["type", "target", "content"].includes(k))
      || !(index < raw.length - 1 ? ["pickup", "drop"] : ["pickup", "drop", "interact", "observe"]).includes(step.type)
      || typeof step.target !== "string" || !step.target.trim() || step.target.length > 240
      || step.content !== undefined && (typeof step.content !== "string" || !step.content.trim() || step.content.length > 2000)
      || step.type === "interact" && !step.content) return;
    // Start with local, already observed entities. Do not use a global lookup to
    // discover remote objects on the far side of a proposed walk.
    const known = view.entities.filter(e => e.name === step.target);
    if (known.length !== 1) return;
    const matches = [...query(world, [Name, WorkingMemoryIdentity])].filter(id => WorkingMemoryIdentity.id[id] === known[0].key);
    if (matches.length !== 1 || Name.value[matches[0]] !== step.target) return;
    targets.push({ eid: matches[0], key: known[0].key, name: step.target });
    steps.push({ description: `${step.type} ${step.target}`, actionType: step.type, target: step.target,
      ...(step.content !== undefined ? { content: step.content } : {}) });
  }
  if (raw[0].type !== first.type || raw[0].target !== first.target || raw[0].content !== first.content) return;
  const goalKey = WorkingMemoryIdentity.id[goal], description = Goal.description[goal];
  const prior = getPlanForGoal(world, eid, goal);
  const priorIsLive = prior !== undefined && ["active", "awaiting_evidence", "awaiting_decision"].includes(Plan.status[prior]);
  // Foreground owns the chosen method, not an untouched background draft.
  // Never replace ongoing work, an actor-owned motor plan or a barrier/decision.
  const canReplaceDraft = () => {
    if (prior === undefined || Plan.status[prior] !== "active" || Plan.currentStep[prior] !== 0 || PlanningDecision.definitionJson[prior]
      || isSpeaking(world, eid) || isSimulationResourceBusy(world, eid, "body") || getAgentWorldCapabilities(world, eid)?.busy()) return false;
    try {
      const previous = JSON.parse(Plan.steps[prior]);
      return Array.isArray(previous) && previous.length > 0 && previous.every(step => step && !step.completed
        && !step.resolution && !step.motorScope && !step.evidenceBarrier && !step.waitUntil
        && ["move", "pickup", "drop", "observe", "interact"].includes(step.actionType));
    } catch { return false; }
  };
  const replacePrior = priorIsLive && canReplaceDraft();
  const priorBasis = () => prior === undefined ? undefined : JSON.stringify([Plan.goalEid[prior], Plan.status[prior],
    Plan.steps[prior], Plan.currentStep[prior], Plan.createdAt[prior]]);
  const issuedPrior = priorBasis();
  const generated: GeneratedPlan = { goalDescription: description, steps, estimatedCompletion: "short motor sequence", potentialObstacles: [] };
  const dependencies = [...new Set(targets.map(t => `entity:${t.key}`))];
  const current = () => entityExists(world, goal) && WorkingMemoryIdentity.id[goal] === goalKey
    && Goal.status[goal] === "active" && Goal.description[goal] === description
    && getPlanForGoal(world, eid, goal) === prior && priorBasis() === issuedPrior
    && (!replacePrior || canReplaceDraft()) && areLocalDependenciesCurrent(world, eid, view, dependencies)
    && validateGeneratedPlan(world, eid, description, generated).ok;
  if (!current()) return;
  return { current, replacedPlanEid: replacePrior ? prior : undefined, commit: () => {
    if (!current()) return undefined;
    // An optional prefix cannot displace work already underway. Its first action
    // remains separately chosen and subject to normal execution admission.
    if (priorIsLive && !replacePrior) return undefined;
    const id = createPlanEntity(world, eid, goal, generated);
    const motorScope = createMotorPlanScope(world, eid, targets, JSON.parse(Plan.steps[id]));
    Plan.steps[id] = JSON.stringify(JSON.parse(Plan.steps[id]).map((step: PlanStep) => ({ ...step, motorScope })));
    // Retain the old draft and all its evidence; retirement is not completion.
    if (replacePrior && prior !== undefined) Plan.status[prior] = "retired";
    return id;
  } };
}
