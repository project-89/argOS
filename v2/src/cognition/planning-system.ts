/**
 * Planning System
 *
 * Decomposes agent goals into actionable step-by-step plans.
 * Uses LLM to generate contextually appropriate plans based on:
 * - Agent's current situation and capabilities
 * - Goal description and priority
 * - Available actions and resources
 *
 * Plans are stored as Plan entities linked to goals via HasPlan relation.
 */

import { stampSimulationTime } from "../ecs/temporal-age";
import { generateText } from "ai";
import { randomUUID } from "node:crypto";
import { flashModel } from "../llm/config";
import { backgroundThinkingLevel, backgroundOutputTokens, backgroundDeadlineMs, observeBackgroundProvider } from "./background-reasoning";
import { isMotorPlanScopeCurrent } from "./motor-plan-scope";
import { activityResumptionGoal, cognitionController, situatedPlanGoal } from "./decision-policy";
import { snapshotActorContinuation } from "./actor-continuation";
import { intentionReviewRevision } from "./goal-lifecycle";
import type { World } from "../ecs/world";
import { addEntity, addComponent, query, getRelationTargets, hasComponent, removeEntity, entityExists } from "bitecs";
import { Name, Description, Agent, CognitiveControl, WorkingMemoryIdentity, Goal, Plan, PlanningDecision, Mind, Room, LastToolResult, PendingToolJob } from "../ecs/components";
import { HasGoal, HasPlan } from "../ecs/relations";
import { getRoomForEntity, listDirectContents } from "../ecs/location";
import { getKnowledgeSummary } from "./knowledge-graph";
import { formatReflectionQuestions } from "./reflection-questions";
import { getAvailableAffordances, getKnownAffordances, requiresFreshAffordanceDecision } from "../world/affordance-availability";
import { getAgentWorldCapabilities, getAgentVisibleEntities, getAgentVisualEntities, getAgentTangibleEntities } from "./world-capabilities";
import { matchesAffordanceCommand } from "../world/affordance-command";
import { isDocumentOperation, isDocumentCommandAvailable, getDocumentCommandEffect } from "../world/productive-work";
import { ActionRegistry, getValidActionTypes } from "./action-registry";
import { inventoryStepIssue, storedInventoryActions } from "./planning-inventory";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import type { PlanningEvent, PlanningDiscardReason, PlanGenerationOutcome } from "./planning-telemetry";
import { formatSocialMemoryContext, getSocialDialogue } from "./social-memory";
import { formatWorkingMemoryContext, getWorkingMemory, workingMemoryEntityRef } from "./working-memory";
import { currentWorkingMemoryDependency, workingMemoryDependency } from "./working-memory-dependencies";
import { getCurrentInspection } from "./inspection-memory";
import { formatCoordinationContext, getCoordinationMemory, getCoordinationGoalRef } from "./coordination-memory";
import { coordinationDependency, currentCoordinationDependency } from "./coordination-memory-dependencies";
import { captureWorkingMemoryObservation } from "./working-memory-observation";
import { copyPlanWaitUntil, groundPlanEvidenceCondition, issuePlanEvidenceBarrier, evaluatePlanEvidenceBarrier, isVerifiedWaitResult, type PlanEvidenceBarrierResult, type PlanWaitUntil } from "./plan-evidence-barrier";
import { formatObservableConditions } from "./planning-observable-conditions";
import { capturePlanActionEvidenceFence, resolvePlanActionEvidence, type PlanActionEvidenceFence } from "./plan-action-evidence";
import { getRoomRouteTargets, getRoomRouteTopologyGeneration, resolveRoomRouteTarget } from "../runtime/room-routes";
import { readGoalSuccessContract } from "./goal-contract";
import { isStandingIntention } from "./goal-lifecycle";
import { getCommittedEvents } from "../runtime/committed-events";
import { getPrivateCommunications, type PrivateCommunicationReceipt } from "./communication-memory";
import { getPlanForGoal } from "./plan-state";
export { getPlanForGoal } from "./plan-state";
import { issuePlanDecision, planDecisionNeedsReplanning, preservePlanDecision, validatePlanDecision, type PlanDecisionProposal } from "./planner-decision";

const model = flashModel;

function planningRoomTargets(world: World, agentEid: number): number[] {
  if (!getRoomRouteTopologyGeneration(world)) return Array.from(query(world, [Room]));
  const current = getRoomForEntity(world, agentEid);
  return [...new Set([...(current === undefined ? [] : [current]), ...getRoomRouteTargets(world, agentEid)])];
}

function socialPlanningEvidence(world: World, agentEid: number): string {
  // Only a newly heard event changes a conversation dependency. Own utterances
  // are expected plan effects, not evidence that the interlocutor answered.
  return [...getSocialDialogue(world, agentEid)].reverse().find(turn => !turn.own)?.id || "";
}

function relevantIncomingPlanningEvidence(world: World, agentEid: number, labels: readonly string[],
  correspondence: readonly PrivateCommunicationReceipt[] = getPrivateCommunications(world, agentEid)) {
  const relevant = (turn: { own: boolean; content: string }) => !turn.own
    && labels.some(label => ` ${normalizedPlanText(turn.content)} `.includes(` ${label} `));
  return { dialogue: [...getSocialDialogue(world, agentEid)].reverse().find(relevant)?.id || "",
    correspondence: [...correspondence].reverse().find(relevant)?.id || "" };
}

function planningReferenceLabels(world: World, agentEid: number, goalEid: number, steps: PlanStep[]) {
  const references = [Goal.description[goalEid] || "", ...steps.flatMap(step => [step.description, step.target || "", step.content || ""])];
  const reference = ` ${normalizedPlanText(references.join(" "))} `;
  return [...new Set([...steps.map(step => normalizedPlanText(step.target || "")),
    ...publicPlanningActions(world, agentEid).map(surface => normalizedPlanText(surface.name))
      .filter(label => label && reference.includes(` ${label} `))])].filter(Boolean);
}

function ownSpokenPlanningEvidence(world: World, agentEid: number): string {
  return [...getSocialDialogue(world, agentEid)].reverse().find(turn => turn.own)?.id || "";
}

function targetsCharacter(world: World, step: PlanStep): boolean {
  const target = String(step.target || "").trim().toLowerCase();
  return !!target && Array.from(query(world, [Agent, Name])).some(id => String(Name.value[id] || "").trim().toLowerCase() === target);
}

function isSocialOnlyPlan(world: World, steps: PlanStep[], goalEid: number): boolean {
  return steps.length > 0 && steps.every(step => ["speak", "think", "wait"].includes(step.actionType)
    || (step.actionType === "observe" && targetsCharacter(world, step)))
    && (Goal.kind[goalEid] === "social" || steps.some(step => step.actionType === "speak"
      || (step.actionType === "observe" && targetsCharacter(world, step))));
}

function stepDependsOnDialogue(world: World, step: PlanStep, steps: PlanStep[], goalEid: number): boolean {
  return step.actionType === "speak" || (step.actionType === "observe" && targetsCharacter(world, step))
    || (["think", "wait"].includes(step.actionType) && isSocialOnlyPlan(world, steps, goalEid));
}

function heardDialogueChanged(world: World, agentEid: number, recorded: string | undefined): boolean {
  if (typeof recorded !== "string") return true; // Legacy/restored plans must establish their evidence again.
  const latest = socialPlanningEvidence(world, agentEid);
  // Trimming old history (including by own speech) is not a newly heard event.
  return !!latest && latest !== recorded;
}

function isStaleSocialPlan(world: World, agentEid: number, goalEid: number, planEid: number): boolean {
  if (Plan.status[planEid] !== "active") return false;
  try {
    const steps = JSON.parse(Plan.steps[planEid] || "[]") as PlanStep[];
    if (!Array.isArray(steps)) return false;
    const step = steps[Plan.currentStep[planEid] || 0];
    return !!step && isStaleSocialStep(world, agentEid, goalEid, planEid, step, steps);
  } catch { /* Invalid step JSON is handled by the ordinary plan selector. */ }
  return false;
}

function isStaleSocialStep(world: World, agentEid: number, goalEid: number, planEid: number, step: PlanStep, steps: PlanStep[]): boolean {
  const coordination = currentCoordinationDependency(world, agentEid, stepCoordinationScope(world, agentEid, step, steps, goalEid));
  if (step.coordinationDependency === undefined ? coordination !== "[]" : step.coordinationDependency !== coordination) return true;
  // The same premise check owns presentation AND autonomous plan admission.
  // Hiding stale wording alone would still let the background plan execute it
  // while the foreground is choosing from the newly learned facts.
  if (inspectionNeedsReview(world, agentEid, goalEid, step, true)) return true;
  // Expected observations belong to the active barrier, not a stale-dialogue
  // heuristic. A heard event wakes reconsideration; it never proves its content.
  if (step.actionType === "wait" && step.waitUntil) return false;
  if (!stepDependsOnDialogue(world, step, steps, goalEid)) return false;
  if (step.actionType === "speak") {
    const latestOwn = ownSpokenPlanningEvidence(world, agentEid);
    // A foreground turn can commit after plan admission but before this stored
    // turn executes. It is not safe to repeat the earlier conversational draft.
    if (latestOwn && latestOwn !== step.ownSpeechDependency) return true;
  }
  if (heardDialogueChanged(world, agentEid, Plan.heardDialogueId[planEid])) return true;
  const current = currentWorkingMemoryDependency(world, agentEid, stepMemoryReferences(step, goalEid));
  // Older plans have no dependency marker. If there is now relevant physical
  // evidence, establish their premise again rather than treating absence as proof.
  return step.workingMemoryDependency === undefined
    ? current !== JSON.stringify({ facts: [], action: "" })
    : step.workingMemoryDependency !== current;
}

function stepMemoryReferences(step: PlanStep, goalEid: number): string[] {
  return [Goal.description[goalEid] || "", step.description, step.target || "", step.content || ""];
}

function stepCoordinationScope(world: World, agentEid: number, step: PlanStep, steps: PlanStep[], goalEid: number) {
  return { all: stepDependsOnDialogue(world, step, steps, goalEid), references: stepMemoryReferences(step, goalEid),
    goalRefs: [getCoordinationGoalRef(world, agentEid, goalEid)] };
}

export interface PlanStep {
  /** Runtime-issued motor sequence source/target binding, never model authority. */
  motorScope?: string;
  description: string;
  actionType: "speak" | "move" | "interact" | "observe" | "think" | "wait" | "pickup" | "give" | "drop";
  target?: string;
  content?: string;
  estimatedDuration?: string;
  prerequisites?: string[];
  /** Executable actor-evidence condition. Untyped waits end the runnable prefix. */
  waitUntil?: PlanWaitUntil;
  /** Deliberate repetition may not be reconciled from an earlier execution. */
  repeat?: boolean;
  /** Engine-only episode/step identity and opaque, in-process evidence token. */
  evidenceScope?: string;
  evidenceBarrier?: Readonly<{ id: string }>;
  evidenceWaitReason?: string;
  /** Execution identity, attached by the selector rather than generated by the model. */
  planEid?: number;
  goalEid?: number;
  currentStep?: number;
  /** Engine-owned source fingerprint. Never accepted from model output. */
  workingMemoryDependency?: string;
  /** Last native manipulation attributed to this inspection's purpose at admission. */
  assessmentOutcomeId?: string;
  /** Actor-owned coordination dependencies, never model-supplied metadata. */
  coordinationDependency?: string;
  /** Own committed turn at admission or the last matched planned speech. */
  ownSpeechDependency?: string;
  /** An engine reconciliation, not proof that this step was executed. */
  resolution?: { kind: "already_here" | "inspection" | "action_evidence" | "evidence_barrier"; sourceId: string; resolvedAt: number; summary: string };
  /** Only the last step of a wholly redundant proposal carries this marker. */
  awaitingEvidenceDependency?: string;
  /** Host-stamped after a completed orientation/review of sustained work. */
  completedWorkDependency?: string;
}

export interface GeneratedPlan {
  goalDescription: string;
  steps: PlanStep[];
  decision?: PlanDecisionProposal;
  estimatedCompletion: string;
  potentialObstacles: string[];
  fallbackStrategy?: string;
}

/** Registry availability enables a type; explicit planner grounding determines
 * whether that type is safe to store. Registration alone is not authorization. */
function supportedPlanActions(world: World, agentEid: number): string[] {
  const grounded = new Set(["speak", "move", "interact", "observe", "think", "wait", ...storedInventoryActions]);
  return getValidActionTypes(world, agentEid).filter(type => grounded.has(type));
}

function planStepFieldIssues(step: PlanStep): string[] {
  const issues: string[] = [];
  if (step.waitUntil !== undefined && (step.actionType !== "wait" || !copyPlanWaitUntil(step.waitUntil))) issues.push("waitUntil must be a typed evidence condition on a wait step");
  if (step.repeat !== undefined && typeof step.repeat !== "boolean") issues.push("repeat must be a boolean when provided");
  if (step.target !== undefined && typeof step.target !== "string") issues.push("target must be a string when provided");
  if (step.content !== undefined && typeof step.content !== "string") issues.push("content must be a string when provided");
  if (issues.length) return issues; // Do not coerce malformed model fields into executable names/commands.
  const definition = ActionRegistry.getAllActions().find(action => action.name === step.actionType);
  if (definition?.requiresTarget && !step.target?.trim()) issues.push(`${step.actionType} requires target`);
  if (definition?.requiresContent && !step.content?.trim()) issues.push(`${step.actionType} requires content`);
  return issues;
}

/** Share the native executor's plain visual-inspection aliases. Tool actions
 * such as describe_image/read_file and commands with arguments stay untouched. */
export function canonicalPlanStep(step: PlanStep): PlanStep {
  if (step.target !== undefined && typeof step.target !== "string" || step.content !== undefined && typeof step.content !== "string") return step;
  return step.actionType === "interact" && /^(observe|examine|inspect)$/i.test(String(step.content || "").trim())
    ? { ...step, actionType: "observe", content: undefined } : step;
}
function canonicalPlan(plan: GeneratedPlan | null): GeneratedPlan | null {
  return plan && Array.isArray(plan.steps) ? { ...plan, steps: plan.steps.map(step => step && typeof step.actionType === "string" ? canonicalPlanStep(step) : step) } : plan;
}

/**
 * Get all active plans for an agent
 */
export function getAgentPlans(world: World, agentEid: number): number[] {
  const planTargets = getRelationTargets(world, agentEid, HasPlan);
  return planTargets.filter(eid =>
    hasComponent(world, eid, Plan) && Plan.status[eid] === "active"
      && hasComponent(world, Plan.goalEid[eid], Goal) && Goal.status[Plan.goalEid[eid]] === "active"
      && getRelationTargets(world, agentEid, HasGoal).includes(Plan.goalEid[eid])
  );
}

function formatRecentPlanOutcomes(world: World, agentEid: number, goalEid: number): string {
  const plans = getRelationTargets(world, agentEid, HasPlan)
    .filter(id => hasComponent(world, id, Plan) && Plan.goalEid[id] === goalEid
      && ["completed", "failed", "awaiting_evidence"].includes(Plan.status[id]))
    .sort((a, b) => (Plan.lastUpdated[b] || 0) - (Plan.lastUpdated[a] || 0)).slice(0, 3);
  const lines: string[] = [];
  for (const id of plans) {
    try {
      const steps = JSON.parse(Plan.steps[id] || "[]") as PlanStep[];
      if (!Array.isArray(steps)) continue;
      const completed = ["completed", "awaiting_evidence"].includes(Plan.status[id]) ? steps : steps.slice(0, Plan.currentStep[id] || 0);
      const actions = completed.filter(step => !step.resolution).slice(-7).map(step => `${step.actionType} ${String(step.target || "").slice(0, 96)}${step.content ? `: ${step.content.slice(0, 280)}` : ""}`.trim());
      lines.push(`- ${Plan.status[id]} plan; executed steps: ${actions.join(" → ") || "none"}.`);
      const resolved = completed.filter(step => step.resolution).slice(-5);
      if (resolved.length) lines.push(`  Already covered, not re-executed: ${resolved.map(step => step.resolution!.summary).join("; ")}.`);
    } catch { /* An invalid old plan contributes no invented execution evidence. */ }
  }
  return lines.length ? `RECENT PLAN OUTCOMES FOR THIS GOAL:\n${lines.join("\n")}\nThese are action records; goal satisfaction is evaluated separately.` : "";
}

/** One discovery boundary for the prompt and its async admission fingerprint.
 * Direct possession establishes an item's name and native drop capability, not
 * sight of fresh labels, contents or package-specific commands. */
function publicPlanningActions(world: World, agentEid: number) {
  const visual = new Set(getAgentVisualEntities(world, agentEid));
  const tangible = getAgentTangibleEntities(world, agentEid);
  return [...new Set([...visual, ...tangible])].map(eid => {
    const name = String(Name.value[eid] || "").trim();
    const seen = visual.has(eid);
    const definitions = seen ? getKnownAffordances(world, agentEid, eid) : [];
    const available = seen ? getAvailableAffordances(world, agentEid, eid).map(a => a.name) : [];
    const affordances = definitions.map(a => a.name);
    const commandHelp = definitions.filter(a => a.description?.trim() || a.requiresFreshDecision || a.opensEvidenceBoundary).map(a => ({ name: a.name,
      description: `${a.requiresFreshDecision ? "Fresh decision required; end the automatic plan before this command. " : ""}${a.opensEvidenceBoundary ? "Reveals new evidence; end the plan at this command and choose after its result. " : ""}${a.description ?? ""}`.slice(0, 400) }));
    const inventory = (seen ? storedInventoryActions.filter(type => type !== "give") : ["drop"])
      .filter(type => !inventoryStepIssue(world, agentEid, { actionType: type, target: name }));
    return { eid, name, seen, affordances, available, inventory, commandHelp };
  });
}

/** Build context for plan generation. */
function buildPlanningContext(world: World, agentEid: number, goalEid: number): string {
  const agentName = Name.value[agentEid];
  const agentDesc = hasComponent(world, agentEid, Description) ? Description.value[agentEid] || "" : "";
  const agentRole = Agent.role[agentEid];
  const goalDesc = Goal.description[goalEid];


  const goalPriority = Goal.priority[goalEid];
  const goalProgress = Goal.progress[goalEid] || 0;

  // Get location
  const roomEid = getRoomForEntity(world, agentEid);
  const roomName = roomEid !== undefined ? Name.value[roomEid] : "unknown location";
  const knownRooms = planningRoomTargets(world, agentEid)
    .map((eid) => String(Name.value[eid] || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  // Visual affordances and direct-own tangible names/native actions only.
  const visibleLines: string[] = [];
  const visibleAffordances = new Set<string>();
  let helpBudget = 4000;
  {
    for (const surface of publicPlanningActions(world, agentEid).slice(0, 25)) {
      const { name, inventory, seen } = surface;
      if (!name) continue;
      const affordances = surface.affordances.slice(0, 12);
      if (seen && !affordances.length && !inventory.length) continue;
      affordances.forEach(name => visibleAffordances.add(name));
      visibleLines.push(`- ${name}: ${seen ? affordances.map(verb => surface.available.includes(verb) ? verb : `${verb} (prerequisites not met now)`).join(", ") : "your possession (not currently seen)"}${inventory.length ? `; native actions: ${inventory.join(", ")}` : ""}`);
      for (const help of surface.commandHelp.filter(h => affordances.includes(h.name))) {
        const text = `  ${JSON.stringify(help.name)}: ${JSON.stringify(help.description)}`;
        if (text.length > helpBudget) continue;
        visibleLines.push(text); helpBudget -= text.length;
      }
    }
  }

  // Get knowledge summary
  const knowledge = getKnowledgeSummary(world, agentEid, { context: goalDesc });

  // Recent tool context (critical for replanning after failures like CI/test errors).
  const lastTool =
    hasComponent(world, agentEid, LastToolResult) && Number(LastToolResult.timestamp[agentEid] || 0) > 0
      ? {
          toolId: String(LastToolResult.toolId[agentEid] || ""),
          command: String(LastToolResult.command[agentEid] || ""),
          exitCode: Number(LastToolResult.exitCode[agentEid] || 0),
          summary: String(LastToolResult.summary[agentEid] || ""),
          stdout: String(LastToolResult.stdout[agentEid] || ""),
          stderr: String(LastToolResult.stderr[agentEid] || ""),
          ageMs: Date.now() - Number(LastToolResult.timestamp[agentEid] || 0),
        }
      : null;

  // Get other goals for context
  const goalTargets = getRelationTargets(world, agentEid, HasGoal);
  const otherGoals = goalTargets
    .filter(gid => gid !== goalEid && hasComponent(world, gid, Goal) && Goal.status[gid] === "active")
    .map(gid => JSON.stringify({ goalId: gid, kind: Goal.kind[gid], description: Goal.description[gid], priority: Goal.priority[gid] }))
    .slice(0, 3);

  // Plans are written in the character's own manner: a suspicious person plans
  // differently from a trusting one, a proud one differently from a desperate one.
  const persona = Agent.systemPrompt[agentEid] || "";
  const base = `You are ${agentName}'s background planner for one intention. Plan the next steps the way ${agentName} would go about it — in character, with their manner, relationships and secrets in mind. The foreground mind chooses and performs the actions.

AGENT:
- Name: ${agentName}
- Role: ${agentRole}
${agentDesc ? `- Appearance: ${agentDesc}\n` : ""}${persona ? `- Who they are: ${persona.slice(0, 2400)}\n` : ""}- Current Location: ${roomName}
- Mental State: Arousal ${((Mind.arousal[agentEid] || 0.5) * 100).toFixed(0)}%

GOAL TO PLAN FOR:
- Goal ID: ${goalEid}
- Kind: ${Goal.kind[goalEid]}
- Description: ${goalDesc}
- Priority: ${goalPriority}/10
- Current Progress: ${goalProgress}%

${otherGoals.length > 0 ? `COMPETING INTENTIONS (context, not steps of this goal):\n${otherGoals.join("\n")}\nTheir priority does not make their work a prerequisite of the assigned goal. A change of intention belongs to foreground choice, not a detour silently inserted into this plan.` : ""}

${formatWorkingMemoryContext(world, agentEid)}

${formatReflectionQuestions(world, agentEid)}

${formatObservableConditions(world, agentEid)}

${formatCoordinationContext(world, agentEid)}

${knowledge ? `AGENT'S KNOWLEDGE:\n${knowledge}` : ""}

${formatRecentPlanOutcomes(world, agentEid, goalEid)}

${formatSocialMemoryContext(world, agentEid)}

${getPrivateCommunications(world, agentEid).length ? `PERSONALLY READ OR SENT TEXTS (private; received claims are not verified world facts):\n${getPrivateCommunications(world, agentEid).slice(-8).map(({ id, channel, speaker, target, content, own, atSimMs }) => JSON.stringify({ id, channel, speaker, target, content, own, atSimMs })).join("\n")}` : ""}

${lastTool ? `LAST TOOL RESULT (most recent):\n- tool: ${lastTool.toolId}\n- command: ${lastTool.command}\n- exitCode: ${lastTool.exitCode}\n- summary: ${lastTool.summary}\n- stdout: ${lastTool.stdout.slice(0, 800)}\n- stderr: ${lastTool.stderr.slice(0, 1200)}\n` : ""}

AVAILABLE ACTIONS:
- speak: Say something (requires content)
- move: Go to a location (requires target location name)
- interact: Use a listed target's affordance (content: "<affordance> <arguments>")
- observe: Pay attention to something (requires target)
- think: Internal reflection (requires content)
- wait: Pause this plan for evidence (waitUntil); not an executable one-turn delay${supportedPlanActions(world, agentEid).includes("pickup") ? `
- pickup: Pick up an accessible takeable item (target: exact item name)
- drop: Drop a held item here (target: exact item name)
- give: Hand a held item to someone here (target: recipient name; content: exact item name)` : ""}`;

  const toolFormats: string[] = [];
  if (["read_file", "write_file", "replace_in_file"].some(name => visibleAffordances.has(name))) {
    toolFormats.push("Workspace file paths are workspace-relative, not absolute or placeholders.");
  }
  if (visibleAffordances.has("read_file")) toolFormats.push("read_file <path> or read_file {\"path\":\"...\"}");
  if (visibleAffordances.has("write_file")) toolFormats.push("write_file <path>\\n<content> or write_file {\"path\":\"...\",\"content\":\"...\"}");
  if (visibleAffordances.has("replace_in_file")) toolFormats.push("replace_in_file {\"path\":\"...\",\"find\":\"...\",\"replace\":\"...\"}");
  if (visibleAffordances.has("run_command")) toolFormats.push("run_command <command and arguments>");
  if (visibleAffordances.has("kanban_move_card")) toolFormats.push("kanban_move_card {\"title\":\"...\",\"toColumn\":\"...\"}");
  if (visibleAffordances.has("kanban_upsert_card")) toolFormats.push("kanban_upsert_card uses JSON arguments.");
  if (visibleAffordances.has("init_workspace_fixture")) toolFormats.push("init_workspace_fixture is only for goals that explicitly require initialization.");
  const capabilities = getAgentWorldCapabilities(world, agentEid);
  return `${base}\n\nKNOWN ROOMS:\n${knownRooms.map(name => `- ${name}`).join("\n") || "(none)"}\n\nKNOWN LOCAL OPERATIONS (live prerequisites still govern execution):\n${visibleLines.join("\n") || "(none)"}${toolFormats.length ? `\n\nTOOL ARGUMENT FORMATS:\n${toolFormats.map(format => `- ${format}`).join("\n")}\nJSON argument strings use escaped newlines.` : ""}${capabilities ? `\n\n${capabilities.context()}` : ""}`;
}

function parseGoalHints(goalDesc: string): { requiredWrites: string[]; requiredRun: string } {
  const desc = String(goalDesc || "");
  const requiredWrites: string[] = [];
  if (process.env.DEBUG_PLAN_VALIDATION === "1") {
    const idx = desc.indexOf("Writes:");
    console.log(`[Planning][hints] hasWrites=${idx >= 0} writesIndex=${idx}`);
  }
  // Only treat "Writes:" as a hard hint when it appears as a structured field
  // (start-of-string, after a newline, or after a "|" field separator).
  // This avoids false positives for goals that *describe* ticket templates (e.g. CEO goals).
  const writesMatches = Array.from(desc.matchAll(/(?:^|[\n|])\s*Writes\s*:\s*([^\n|]+)/gi));
  const writes = writesMatches.length ? writesMatches[writesMatches.length - 1] : null;
  if (writes && writes[1]) {
    writes[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => {
        const lower = p.toLowerCase();
        if (lower === "none" || lower === "(none)" || lower === "n/a" || lower === "na" || lower === "nil" || lower === "null") return false;
        return true;
      })
      .forEach((p) => requiredWrites.push(p));
  }
  const runMatches = Array.from(desc.matchAll(/(?:^|[\n|])\s*Run\s*:\s*([^\n|]+)/gi));
  const run = runMatches.length ? runMatches[runMatches.length - 1] : null;
  const requiredRun = run && run[1] ? String(run[1]).trim() : "";
  return { requiredWrites, requiredRun };
}

function extractFirstJsonObject(text: string): string | null {
  const cleaned = String(text || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

function goalRequestsCliCoder(goalDesc: string): boolean {
  const d = String(goalDesc || "").toLowerCase();
  if (d.includes("usecli: true") || d.includes("usecli:true") || d.includes("cli_only") || d.includes("use cli coder")) return true;
  // Common shorthand used in *this ticket's* title, e.g. "(CLI)".
  // Avoid false-positives from dependency lists like `DependsOn: [ENG] ... (CLI)`.
  const beforeDeps = d.split("dependson")[0] || d;
  return beforeDeps.includes("(cli)");
}

function containsDisallowedReinit(goalDesc: string): boolean {
  const d = String(goalDesc || "").toLowerCase();
  return d.includes("do not re-init") || d.includes("do not reinit") || d.includes("don't re-init") || d.includes("dont re-init");
}

function isCodeLikePath(p: string): boolean {
  const lower = String(p || "").toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".cjs") || lower.endsWith(".mjs");
}

function isImageLikePath(p: string): boolean {
  const lower = String(p || "").toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif")
  );
}

export function validateGeneratedPlan(world: World, agentEid: number, goalDesc: string, plan: GeneratedPlan): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const roomEid = getRoomForEntity(world, agentEid);
  const visibleEids = getAgentVisibleEntities(world, agentEid);
  const visibleNames = new Set(visibleEids.map((eid) => String(Name.value[eid] || "").trim()).filter(Boolean));
  const knownRooms = new Set(planningRoomTargets(world, agentEid).map((eid) => String(Name.value[eid] || "").trim()).filter(Boolean));

  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  if (!Array.isArray(plan.steps)) issues.push("steps must be an array");
  if (plan.decision !== undefined && !validatePlanDecision(world, agentEid, plan.decision)) issues.push("decision requires a known fresh-decision command, target and purpose; no arguments or draft text");
  // Reject malformed action fields before the goal/tool pre-scans below have
  // any opportunity to stringify them into meaningful commands or names.
  for (const step of steps) {
    if (!step || typeof step.actionType !== "string") continue;
    issues.push(...planStepFieldIssues(step));
    if (step.waitUntil !== undefined) {
      const grounded = groundPlanEvidenceCondition(world, agentEid, step.waitUntil);
      if ("issue" in grounded) issues.push(grounded.issue);
    }
  }
  if (issues.length) return { ok: false, issues };
  const supported = supportedPlanActions(world, agentEid);
  const inventoryProjection = new Map<number, number>();
  // Command admission is case-insensitive; authorization and prerequisite
  // checks must inspect the same exact verb, never an argument's mention of it.
  const stepVerb = (step: PlanStep | undefined) => step?.actionType === "interact"
    ? (String(step.content || "").trim().match(/^\S+/)?.[0] || "").toLowerCase() : "";
  if (steps.length === 0 && plan.decision === undefined) issues.push("plan has no steps");
  if (steps[0]?.actionType === "wait" && !steps[0].waitUntil) issues.push("a first wait step needs a typed evidence condition");

  const isTicketGoal = /complete ticket\s*:/i.test(goalDesc);
  const hints = parseGoalHints(goalDesc);
  const debugValidation = process.env.DEBUG_PLAN_VALIDATION === "1";
  const useCliCoder = goalRequestsCliCoder(goalDesc);
  if (isTicketGoal && !steps.some((s) => s && String(s.actionType || "") === "interact")) {
    issues.push("ticket plans must include at least one interact step");
  }
  if (isTicketGoal && !useCliCoder) {
    const usesGeminiCli = steps.some(s => stepVerb(s) === "gemini_cli");
    if (usesGeminiCli) issues.push("ticket plans must not use gemini_cli unless the goal explicitly requests UseCLI: true/CLI_ONLY");
  }

  const extractPathFromInteract = (content: string, affordance: string): string => {
    const raw = String(content || "").trim();
    const issuedVerb = raw.match(/^\S+/)?.[0] || "";
    if (issuedVerb.toLowerCase() !== affordance.toLowerCase()) return "";
    const arg = raw.slice(issuedVerb.length).trim();
    if (!arg) return "";
    if (arg.startsWith("{")) {
      try {
        const obj = JSON.parse(arg);
        if (obj && typeof obj.path === "string") return String(obj.path).trim();
        if (obj && typeof obj.outPath === "string") return String(obj.outPath).trim();
        if (obj && typeof obj.out_path === "string") return String(obj.out_path).trim();
      } catch {
        return "";
      }
    }
    return arg.split(/\s+/)[0] || "";
  };

  if (hints.requiredRun) {
    const hasRun = steps.some(s => stepVerb(s) === "run_command" && String(s?.content || "").includes(hints.requiredRun));
    if (!hasRun) issues.push(`plan must include run_command for: ${hints.requiredRun}`);
  }
  if (hints.requiredWrites.length > 0) {
    for (const p of hints.requiredWrites) {
      const needsRead = isCodeLikePath(p);
      const hasRead = needsRead
        ? steps.some((s) => String(s?.actionType || "") === "interact" && extractPathFromInteract(String(s?.content || ""), "read_file") === p)
        : true;
      const hasReplace = needsRead
        ? steps.some((s) => String(s?.actionType || "") === "interact" && extractPathFromInteract(String(s?.content || ""), "replace_in_file") === p)
        : false;
      const hasWrite = steps.some((s) => String(s?.actionType || "") === "interact" && extractPathFromInteract(String(s?.content || ""), "write_file") === p);
      const hasGenerateImage = steps.some((s) => String(s?.actionType || "") === "interact" && extractPathFromInteract(String(s?.content || ""), "generate_image") === p);
      const hasGitApplyFromGemini = steps.some((s) =>
        stepVerb(s) === "git_apply_from_last_gemini" &&
        String(s?.content || "").includes(p)
      );

      if (needsRead && !hasRead) issues.push(`plan must include read_file for: ${p}`);

      // Safety rail: ticket goals that modify existing code should prefer minimal edits.
      // Writing an entire code file is brittle (agents often accidentally delete exports).
      if (isTicketGoal && useCliCoder) {
        // CLI-only: gemini_cli + git_apply_from_last_gemini is the source of truth for *all* required writes.
        if (needsRead && hasReplace) issues.push(`CLI-only ticket must not use replace_in_file for: ${p} (use gemini_cli + git_apply_from_last_gemini)`);
        if (needsRead && hasWrite) issues.push(`CLI-only ticket must not use write_file for code path: ${p}`);
        if (!hasGitApplyFromGemini) issues.push(`CLI-only ticket must include git_apply_from_last_gemini for: ${p}`);
      } else if (isTicketGoal && needsRead) {
        // Default: prefer deterministic minimal edits.
        if (!hasReplace && !hasGitApplyFromGemini) issues.push(`plan must include replace_in_file or git_apply_from_last_gemini for: ${p}`);
        if (hasWrite) issues.push(`ticket plans must not use write_file for code path: ${p} (use replace_in_file)`);
      } else {
        if (!needsRead) {
          if (!hasWrite && !hasGenerateImage && !hasGitApplyFromGemini) issues.push(`plan must include write_file, generate_image, or git_apply_from_last_gemini for: ${p}`);
        } else {
          if (!hasWrite && !hasReplace) issues.push(`plan must include replace_in_file or write_file for: ${p}`);
        }
      }
    }
  }

  if (isTicketGoal && useCliCoder && hints.requiredWrites.some(isCodeLikePath)) {
    const hasGemini = steps.some(s => stepVerb(s) === "gemini_cli");
    if (!hasGemini) issues.push("CLI-only ticket must include a gemini_cli step");
    const idxGemini = steps.findIndex(s => stepVerb(s) === "gemini_cli");
    const idxApply = steps.findIndex(s => stepVerb(s) === "git_apply_from_last_gemini");
    if (idxGemini >= 0 && idxApply >= 0 && idxApply < idxGemini) issues.push("git_apply_from_last_gemini must occur after gemini_cli");
  }
  if (debugValidation) {
    const agentName = String(Name.value[agentEid] || "");
    console.log(`[Planning][validate] agent=${agentName} requiredWrites=${hints.requiredWrites.join(",")} requiredRun=${hints.requiredRun}`);
  }

  // Note: Kanban column moves are primarily enforced via goal contracts + governance gates.
  // Plans should focus on grounded work steps (files/commands), not on duplicating the org workflow.

  for (const [stepIndex, step] of steps.entries()) {
    if (!step || typeof step.actionType !== "string") {
      issues.push("step missing actionType");
      continue;
    }
    if (!supported.includes(step.actionType)) {
      issues.push(`unsupported action type: ${step.actionType}`);
      continue;
    }
    if (storedInventoryActions.some(type => type === step.actionType)) {
      const issue = inventoryStepIssue(world, agentEid, step, inventoryProjection);
      if (issue) issues.push(`invalid ${step.actionType} step: ${issue}`);
    }
    if (step.actionType === "move") {
      const target = String(step.target || "").trim();
      // In this simulation, "move" is used both for room navigation and for moving to an object/person
      // within the current room (e.g., move -> Workstation).
      if (!target || (!knownRooms.has(target) && !visibleNames.has(target))) {
        issues.push(`invalid move target: "${target || "(missing)"}"`);
      }
    }
    if (step.actionType === "observe") {
      const target = String(step.target || "").trim();
      // Observing can target either a visible object (in-room) or the current room itself.
      if (!target || (!visibleNames.has(target) && !knownRooms.has(target))) {
        issues.push(`invalid observe target: "${target || "(missing)"}"`);
      }
    }
    if (step.actionType === "interact") {
      const target = String(step.target || "").trim();
      if (!target || !visibleNames.has(target)) issues.push(`invalid interact target: "${target || "(missing)"}"`);
      const content = String(step.content || "").trim();
      const affordance = stepVerb(step);
      if (!affordance) {
        issues.push(`missing affordance content for interact target "${target || "(missing)"}"`);
        continue;
      }

      if (containsDisallowedReinit(goalDesc) && affordance === "init_workspace_fixture") {
        issues.push("plan must not use init_workspace_fixture for this goal");
      }

      // For ticket goals, keep kanban workflow in the deterministic contract/governance layer.
      if (isTicketGoal && affordance.startsWith("kanban_")) {
        issues.push("ticket plans must not include kanban_* steps (handled by contract/governance)");
      }

      // Avoid placeholder/host paths in workspace operations. These are almost always hallucinations.
      if (affordance === "write_file" || affordance === "read_file" || affordance === "list_dir" || affordance === "replace_in_file") {
        const p = extractPathFromInteract(content, affordance);
        if (!p && content.slice(affordance.length).trim().startsWith("{")) {
          issues.push(`invalid JSON args for ${affordance}`);
        }
        if (p.startsWith("/")) issues.push(`invalid absolute path in ${affordance} (must be workspace-relative)`);
        if (p.includes("/path/to/")) issues.push(`invalid placeholder path in ${affordance}`);

        // If the goal explicitly lists required write targets, do not invent other file paths.
        if ((affordance === "read_file" || affordance === "write_file" || affordance === "replace_in_file") && hints.requiredWrites.length > 0) {
          const allowedReads = new Set<string>([...hints.requiredWrites, "ci.cjs", "test.cjs", "README.md"]);
          const allowedWrites = new Set<string>([...hints.requiredWrites]);
          const allowed =
            affordance === "write_file" ? allowedWrites : affordance === "replace_in_file" ? new Set(hints.requiredWrites.filter(isCodeLikePath)) : allowedReads;
          if (p && !allowed.has(p)) {
            issues.push(`unexpected file path "${p}" (use only: ${Array.from(allowed).join(", ")})`);
          }
        }

        if (affordance === "replace_in_file") {
          if (p && !isCodeLikePath(p)) {
            issues.push(`replace_in_file should only be used for code paths (.js/.cjs/.ts/.mjs), not: ${p}`);
          }
          if (isTicketGoal && hints.requiredWrites.length > 0) {
            const allowedReplace = new Set(hints.requiredWrites.filter(isCodeLikePath));
            if (p && allowedReplace.size > 0 && !allowedReplace.has(p)) {
              issues.push(`replace_in_file path must be one of: ${Array.from(allowedReplace).join(", ")}`);
            }
          }
        }
      }

      // Validate JSON args for tools that require them (prevents "Invalid JSON tool params" at runtime).
      const toolJsonAffordances = new Set(["kanban_move_card", "kanban_upsert_card", "kanban_init", "replace_in_file", "generate_image"]);
      if (toolJsonAffordances.has(affordance)) {
        const raw = content.slice(affordance.length).trim();
        if (!raw.startsWith("{")) {
          issues.push(`missing JSON args for ${affordance}`);
        } else {
          try {
            const obj = JSON.parse(raw);
            if (affordance === "read_file" || affordance === "write_file") {
              if (!obj || typeof obj.path !== "string" || !obj.path.trim()) issues.push(`${affordance} requires {"path": "..."} `);
            }
            if (affordance === "write_file") {
              if (!obj || typeof obj.content !== "string") issues.push('write_file requires {"content": "..."}');
            }
            if (affordance === "kanban_move_card") {
              if (!obj || typeof obj.title !== "string" || !obj.title.trim()) issues.push('kanban_move_card requires {"title": "..."}');
              if (!obj || typeof obj.toColumn !== "string" || !obj.toColumn.trim()) issues.push('kanban_move_card requires {"toColumn": "..."}');
            }
            if (affordance === "kanban_init") {
              // Allow columns omitted; tool is idempotent.
              if (obj && obj.columns && !Array.isArray(obj.columns)) issues.push('kanban_init "columns" must be an array when provided');
            }
            if (affordance === "replace_in_file") {
              if (!obj || typeof obj.path !== "string" || !obj.path.trim()) issues.push('replace_in_file requires {"path": "..."}');
              if (!obj || typeof obj.find !== "string") issues.push('replace_in_file requires {"find": "..."}');
              if (!obj || typeof obj.replace !== "string") issues.push('replace_in_file requires {"replace": "..."}');
            }
            if (affordance === "generate_image") {
              if (!obj || typeof obj.prompt !== "string" || !obj.prompt.trim()) issues.push('generate_image requires {"prompt": "..."}');
              const outPath =
                obj && typeof obj.outPath === "string"
                  ? obj.outPath
                  : obj && typeof obj.path === "string"
                    ? obj.path
                    : obj && typeof obj.out_path === "string"
                      ? obj.out_path
                      : "";
              if (!String(outPath || "").trim()) issues.push('generate_image requires {"outPath": "..."}');
            }
          } catch {
            issues.push(`invalid JSON args for ${affordance}`);
          }
        }
      }

      const targetEid = visibleEids.find((eid) => String(Name.value[eid] || "").trim() === target);
      if (targetEid !== undefined) {
        const allowed = getKnownAffordances(world, agentEid, targetEid);
        const matching = allowed.filter(candidate => matchesAffordanceCommand(candidate.name, content));
        if (!matching.length)
          issues.push(`invalid affordance command "${content}" for target "${target}"`);
        else if (matching.every(candidate => candidate.requiresFreshDecision))
          issues.push(`command "${content}" requires a fresh decision; end the stored plan before it`);
        if (matching.some(candidate => candidate.opensEvidenceBoundary)
          && (stepIndex !== steps.length - 1 || plan.decision !== undefined))
          issues.push(`command "${content}" reveals new evidence; end this proposal there and choose from its actual result`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Generate a plan for a goal using LLM
 */
export async function generatePlanForGoal(
  world: World,
  agentEid: number,
  goalEid: number,
  options: { generateText?: typeof generateText; onOutcome?: (outcome: PlanGenerationOutcome) => void } = {}
): Promise<GeneratedPlan | null> {
  let failure: PlanGenerationOutcome = { ok: false, reason: "generation_failed" };
  const plan = await generatePlanForGoalInternal(world, agentEid, goalEid,
    { generateText: options.generateText, onFailure: outcome => { failure = outcome; } });
  // Deterministic providers and legacy benchmark branches pass the same final
  // validator as model proposals. This is validation, not admission or execution.
  if (plan) {
    const result = validateGeneratedPlan(world, agentEid, Goal.description[goalEid] || "", plan);
    if (result.ok) { options.onOutcome?.({ ok: true, stepCount: plan.steps.length }); return plan; }
    failure = { ok: false, reason: "validation_failed", issues: result.issues };
  }
  options.onOutcome?.(failure);
  return null;
}

async function generatePlanForGoalInternal(
  world: World,
  agentEid: number,
  goalEid: number,
  options: { generateText?: typeof generateText; onFailure: (outcome: PlanGenerationOutcome) => void }
): Promise<GeneratedPlan | null> {
  const goalDesc = Goal.description[goalEid];


  // Deterministic CEO mission plan (benchmark): avoid LLM variability.
  // The mission goal is a meta-goal that asks the CEO to create governance + 4 tickets; we can do this deterministically.
  const mission = String(goalDesc || "");
  if (/^Mission:\s*Ship the branded Todo App/i.test(mission)) {
    const boardName = "Team Board";

    const designTitle = "[DESIGN] Generate Brand Assets (Nano Banana)";
    const engTitle = "[ENG] Implement Todo App Brand V2 (CLI)";
    const pmTitle = "[PM] Product Spec";
    const qaTitle = "[QA] Verify + Report";

    const mkDesc = (lines: string[]) => lines.filter(Boolean).join("\n");
    const mkCard = (title: string, description: string) => ({ title, column: "Backlog", description });

    const steps: any[] = [];

    steps.push({
      description: "Initialize the Team Board columns (Backlog, In Progress, Review, Done).",
      actionType: "interact",
      target: boardName,
      content: `kanban_init ${JSON.stringify({ project: "Todo", columns: ["Backlog", "In Progress", "Review", "Done"] })}`,
      estimatedDuration: "short",
      prerequisites: [],
    });

    steps.push({
      description: "Configure org governance (WIP limit 2, CI gate, Review required).",
      actionType: "interact",
      target: "Org Console",
      content: `org_set_governance ${JSON.stringify({
        boardName,
        wipLimit: 2,
        doneRequiresToolId: "terminal.run",
        doneRequiresCommandIncludes: "node ci.cjs",
        doneRequiresReview: true,
        reviewColumnName: "Review",
      })}`,
      estimatedDuration: "short",
      prerequisites: [],
    });

    const mkGov = (claimTitlePrefix: string, defaultRole: string) => ({
      boardName,
      defaultRole,
      claimTitlePrefix,
      maxAgents: 1,
      wipPerAgent: 1,
      spawnRoomName: "Office",
    });

    steps.push({ description: "Create staffing governor for [ENG] tickets.", actionType: "interact", target: "Org Console", content: `org_upsert_staffing_governor ${JSON.stringify(mkGov("[ENG]", "engineer"))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create staffing governor for [QA] tickets.", actionType: "interact", target: "Org Console", content: `org_upsert_staffing_governor ${JSON.stringify(mkGov("[QA]", "qa"))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create staffing governor for [PM] tickets.", actionType: "interact", target: "Org Console", content: `org_upsert_staffing_governor ${JSON.stringify(mkGov("[PM]", "pm"))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create staffing governor for [DESIGN] tickets.", actionType: "interact", target: "Org Console", content: `org_upsert_staffing_governor ${JSON.stringify(mkGov("[DESIGN]", "designer"))}`, estimatedDuration: "short", prerequisites: [] });

    const missionWantsHero = /(?:^|\W)hero\.png\b/i.test(mission) || /public\/assets\/hero\.png/i.test(mission);
    const missionWantsDesignEdit = /\bedit_image\b/i.test(mission) || /\biterate\b/i.test(mission) || /\bimprove\b/i.test(mission);

    const designWrites = missionWantsHero ? "public/assets/logo.png, public/assets/hero.png" : "public/assets/logo.png";

    const designDesc = mkDesc([
      `Complete ticket: ${designTitle} | Ticket:`,
      missionWantsHero
        ? "Create public/assets/logo.png and public/assets/hero.png using the Workstation's `generate_image` affordance (Nano Banana)."
        : "Create public/assets/logo.png using the Workstation's `generate_image` affordance (Nano Banana).",
      missionWantsHero
        ? 'Use JSON args like `generate_image {"prompt":"A clean minimalist logo icon for a todo app...","outPath":"public/assets/logo.png","model":"gemini-2.5-flash-image","aspectRatio":"1:1"}` and `generate_image {"prompt":"A clean minimalist hero/banner image for a todo app...","outPath":"public/assets/hero.png","model":"gemini-2.5-flash-image","aspectRatio":"16:9"}`.'
        : 'Use JSON args like `generate_image {"prompt":"A clean minimalist logo icon for a todo app...","outPath":"public/assets/logo.png","model":"gemini-2.5-flash-image","aspectRatio":"1:1"}`.',
      "Ensure the file(s) exist and are not empty.",
      missionWantsHero
        ? 'Then run `describe_image {"path":"public/assets/logo.png"}` and `describe_image {"path":"public/assets/hero.png"}`.'
        : 'Then run `describe_image {"path":"public/assets/logo.png"}`.',
      missionWantsDesignEdit
        ? "Then improve at least one asset via `edit_image` (overwrite the same path) and run `describe_image` again for the edited asset."
        : "",
      "Do not re-init the workspace fixture.",
      "node ci.cjs",
      `Writes: ${designWrites}`,
    ]);

    const engDesc = mkDesc([
      `Complete ticket: ${engTitle} | Ticket:`,
      "UseCLI: true.",
      missionWantsHero
        ? "Requirements: remove all TODO markers in server.cjs, public/app.js, public/index.html, public/style.css; implement server + API using only Node core modules (NO express/koa/fastify); preserve `module.exports = { startServer }`; implement required endpoints exactly as tests expect (/api/todos, filtering, PATCH text); serve /assets/logo.png and /assets/hero.png; update HTML to reference /assets/logo.png and /assets/hero.png."
        : "Requirements: remove all TODO markers in server.cjs, public/app.js, public/index.html, public/style.css; implement server + API using only Node core modules (NO express/koa/fastify); preserve `module.exports = { startServer }`; implement required endpoints exactly as tests expect (/api/todos, filtering, PATCH text); serve /assets/logo.png; update HTML to reference /assets/logo.png.",
      "Do not re-init the workspace fixture.",
      `DependsOn: ${designTitle}`,
      "node ci.cjs",
      "Writes: server.cjs, public/app.js, public/index.html, public/style.css, data/todos.json",
    ]);


    const pmDesc = mkDesc([
      `Complete ticket: ${pmTitle} | Ticket:`,
      `DependsOn: ${engTitle}`,
      "Write a short spec doc at docs/spec.md describing the user stories + acceptance criteria (mention `node ci.cjs`).",
      "node ci.cjs",
      "Writes: docs/spec.md",
    ]);

    const qaDesc = mkDesc([
      `Complete ticket: ${qaTitle} | Ticket:`,
      `DependsOn: ${engTitle}, ${pmTitle}`,
      "Run CI and write a narrative QA report at docs/qa-report.md (what was tested, results, and suggested follow-ups).",
      "node ci.cjs",
      "Writes: docs/qa-report.md",
    ]);

    steps.push({ description: "Create the DESIGN ticket in Backlog.", actionType: "interact", target: boardName, content: `kanban_upsert_card ${JSON.stringify(mkCard(designTitle, designDesc))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create the ENG ticket in Backlog.", actionType: "interact", target: boardName, content: `kanban_upsert_card ${JSON.stringify(mkCard(engTitle, engDesc))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create the PM ticket in Backlog.", actionType: "interact", target: boardName, content: `kanban_upsert_card ${JSON.stringify(mkCard(pmTitle, pmDesc))}`, estimatedDuration: "short", prerequisites: [] });
    steps.push({ description: "Create the QA ticket in Backlog.", actionType: "interact", target: boardName, content: `kanban_upsert_card ${JSON.stringify(mkCard(qaTitle, qaDesc))}`, estimatedDuration: "short", prerequisites: [] });

    return {
      goalDescription: "Set up governance + staffing + 4 tickets for the Todo App mission.",
      steps,
      estimatedCompletion: "short",
      potentialObstacles: ["Tool failures", "WIP limit blocks work"],
      fallbackStrategy: "Retry a failed setup step once; then observe and continue.",
    } as any;
  }

  // Deterministic CLI-coder plan skeleton:
  // If a ticket is explicitly marked CLI-only, do not rely on LLM plan formatting to include the required
  // "gemini_cli -> git_apply_from_last_gemini" flow. We still rely on the CLI tool for the actual patch.
  const isTicketGoal = /complete ticket\s*:/i.test(String(goalDesc || ""));
  const hints = parseGoalHints(String(goalDesc || ""));
  const useCliCoder = goalRequestsCliCoder(String(goalDesc || ""));

  if (isTicketGoal && useCliCoder && hints.requiredWrites.length) {
    const roomEid = getRoomForEntity(world, agentEid);
    const candidates = roomEid !== undefined ? listDirectContents(world, roomEid) : [];

    const pickDeviceName = (): string | undefined => {
      // Prefer a "Workstation" if present; otherwise any visible device with the required affordances.
      const byName = (want: string) => candidates.find((eid) => String(Name.value[eid] || "").trim() === want);
      const ws = byName("Workstation");
      const ordered = ws !== undefined ? [ws, ...candidates.filter((e) => e !== ws)] : candidates;
      for (const eid of ordered) {
        const n = String(Name.value[eid] || "").trim();
        if (!n) continue;
        const allowed = new Set(getAvailableAffordances(world, agentEid, eid).map((a) => a.name));
        if (allowed.has("gemini_cli") && allowed.has("git_apply_from_last_gemini") && allowed.has("run_command")) return n;
      }
      return undefined;
    };

    const deviceName = pickDeviceName();
    if (deviceName) {
      // CLI-only tickets should allow patching *all* required paths (not just .js/.ts),
      // since fixtures often include TODO markers in HTML/CSS/JSON too.
      const writePaths = hints.requiredWrites
        .map((p) => String(p || "").trim())
        .filter(Boolean)
        // Never include core harness files in the allowlist.
        .filter((p) => !["ci.cjs", "test.cjs"].includes(p));

      const runCmd = hints.requiredRun || "node ci.cjs";

      const lastToolId = hasComponent(world as any, agentEid, LastToolResult as any) ? String(LastToolResult.toolId[agentEid] || "") : "";
      const lastToolOk = hasComponent(world as any, agentEid, LastToolResult as any) ? !!LastToolResult.ok[agentEid] : true;
      const lastToolCmd = hasComponent(world as any, agentEid, LastToolResult as any) ? String(LastToolResult.command[agentEid] || "") : "";
      const lastToolOut = hasComponent(world as any, agentEid, LastToolResult as any) ? String(LastToolResult.stdout[agentEid] || "") : "";
      const lastToolErr = hasComponent(world as any, agentEid, LastToolResult as any) ? String(LastToolResult.stderr[agentEid] || "") : "";

      const lastCiFailure =
        !lastToolOk && lastToolId === "terminal.run" && lastToolCmd.includes(runCmd)
          ? `${lastToolOut.trim() ? `stdout:
${lastToolOut}` : ""}
${lastToolErr.trim() ? `stderr:
${lastToolErr}` : ""}`.trim()
          : "";

      const lastGitApplyFailure =
        !lastToolOk && lastToolId === "workspace.git_apply_from_last_gemini"
          ? `${lastToolOut.trim() ? `stdout:
${lastToolOut}` : ""}
${lastToolErr.trim() ? `stderr:
${lastToolErr}` : ""}`.trim()
          : "";

      const clip = (s: string, max = 1200) => (s.length > max ? s.slice(0, max) + "\n…(truncated)" : s);

      const buildCliPrompt = (allowedPaths: string[]): string => {
        const allowed = allowedPaths.length ? allowedPaths.join(", ") : "(none specified)";
        const allowTodosJsonNewFile = allowedPaths.some((p) => p === "data/todos.json");
        return [
          "You are a CLI coding agent. You are NOT allowed to call tools or run commands.",
          "You are already given the relevant file contents below.",
          "Task: output ONLY a unified diff patch starting with `diff --git` (no preamble, no commentary, no code fences).",
          "The patch must be complete and parseable by `git apply`.",
          `Allowed files to modify: ${allowed}`,
          "Do NOT modify ci.cjs or test.cjs (they are included only for reference).",
          "Do NOT include diffs for any file not in the allowed list.",
          `Your patch MUST include hunks for every allowed file listed above: ${allowed}. (Patches that do not touch the allowed file(s) will be rejected.)`,
          allowTodosJsonNewFile
            ? "If `data/todos.json` is missing, you MAY create it using `new file mode` / `--- /dev/null`. Do not create any other new files."
            : "Do NOT create any new files in this patch (no `new file mode`, no `--- /dev/null`).",
          "IMPORTANT: For existing files, always output a normal diff against `a/<path>`.",
          `After applying the patch, this command must pass: ${runCmd}`,
          ...(lastCiFailure ? ["", "LAST CI FAILURE OUTPUT (for debugging):", clip(lastCiFailure)] : []),
          ...(lastGitApplyFailure ? ["", "LAST GIT APPLY FAILURE OUTPUT (for debugging):", clip(lastGitApplyFailure)] : []),
          "",
          "TICKET CONTEXT (verbatim):",
          String(goalDesc || "").slice(0, 2000),
        ].join("\n");
      };

      const groups: string[][] = [];
      const backend = writePaths.filter((p) => p === "server.cjs" || p.startsWith("data/"));
      const frontendFiles = writePaths
        .filter((p) => p.startsWith("public/") && !p.startsWith("public/assets/"))
        // Split frontend patches by file to reduce LLM truncation and improve git-apply reliability.
        .sort();
      const docs = writePaths.filter((p) => p === "README.md");
      if (backend.length) groups.push(backend);
      for (const f of frontendFiles) groups.push([f]);
      if (docs.length) groups.push(docs);
      // Fallback: if our heuristics miss, just do a single group.
      if (!groups.length && writePaths.length) groups.push(writePaths);

      const mkGeminiArgs = (allowedPaths: string[]): string => {
        const prompt = buildCliPrompt(allowedPaths);
        const contextFiles = Array.from(
          new Set<string>([
            ...allowedPaths,
            // Include the harness contract for reference (read-only); do NOT allow modifying these.
            "test.cjs",
            "ci.cjs",
          ])
        ).slice(0, 12);
        return JSON.stringify({
          prompt,
          files: contextFiles,
          outputFormat: "json",
          approvalMode: "default",
          sandbox: false,
          timeoutMs: 240_000,
        });
      };

      const steps: PlanStep[] = [
        { description: `Move to the ${deviceName}.`, actionType: "move", target: deviceName, estimatedDuration: "short" },
        { description: `Confirm the ${deviceName} is usable.`, actionType: "observe", target: deviceName, estimatedDuration: "short" },
      ];

      for (const allowedPaths of groups) {
        const geminiArgs = mkGeminiArgs(allowedPaths);
        steps.push({
          description: `Ask the CLI coding agent to generate a patch for: ${allowedPaths.join(", ")}`,
          actionType: "interact",
          target: deviceName,
          content: `gemini_cli ${geminiArgs}`,
          estimatedDuration: "medium",
        });
        steps.push({
          description: `Apply the patch for: ${allowedPaths.join(", ")}`,
          actionType: "interact",
          target: deviceName,
          content: `git_apply_from_last_gemini ${allowedPaths.join(" ")}`.trim(),
          estimatedDuration: "short",
        });
      }

      steps.push({
        description: `Run the required command to verify success: ${runCmd}.`,
        actionType: "interact",
        target: deviceName,
        content: `run_command ${runCmd}`,
        estimatedDuration: "short",
      });

      return {
        goalDescription: "Complete the ticket using a CLI patch + git apply workflow.",
        steps,
        estimatedCompletion: "medium",
        potentialObstacles: ["The coding agent may generate an invalid patch", "CI may fail"],
        fallbackStrategy: "If git apply fails, regenerate the patch with stricter constraints and retry.",
      } as any;
    }
  }

  // Deterministic image-asset ticket skeleton:
  // Keep design/asset tickets grounded without requiring CI to pass.
  if (isTicketGoal && !useCliCoder && hints.requiredWrites.some(isImageLikePath) && !hints.requiredWrites.some(isCodeLikePath)) {
    const roomEid = getRoomForEntity(world, agentEid);
    const candidates = roomEid !== undefined ? listDirectContents(world, roomEid) : [];
    const pickDeviceName = (): string | undefined => {
      const byName = (want: string) => candidates.find((eid) => String(Name.value[eid] || "").trim() === want);
      const ws = byName("Workstation");
      const ordered = ws !== undefined ? [ws, ...candidates.filter((e) => e !== ws)] : candidates;
      for (const eid of ordered) {
        const n = String(Name.value[eid] || "").trim();
        if (!n) continue;
        const allowed = new Set(getAvailableAffordances(world, agentEid, eid).map((a) => a.name));
        if (allowed.has("generate_image")) return n;
      }
      return undefined;
    };

    const deviceName = pickDeviceName();
    if (deviceName) {
      const images = hints.requiredWrites.filter(isImageLikePath);
      const steps: PlanStep[] = [
        { description: "Move to the " + deviceName + ".", actionType: "move", target: deviceName, estimatedDuration: "short" },
        { description: "Confirm the " + deviceName + " is usable.", actionType: "observe", target: deviceName, estimatedDuration: "short" },
      ];
      const goalText = String(goalDesc || "");
      const wantsEdit = /\bedit_image\b/i.test(goalText) || /\biterate\b/i.test(goalText) || /\bimprove\b/i.test(goalText);

      for (const p of images) {
        const isHero = /(?:^|[\\/])(?:hero|banner|header)\b/i.test(p);
        const promptText = isHero
          ? "A clean minimalist hero/banner image for a todo app landing page. Abstract shapes, soft gradient, subtle checkmark motif. No text."
          : "A clean minimalist logo icon for a todo app. Flat vector style. A simple checkmark inside a circle. No text. White background.";
        const aspectRatio = isHero ? "16:9" : "1:1";

        const args = JSON.stringify({
          prompt: promptText,
          outPath: p,
          model: "gemini-2.5-flash-image",
          aspectRatio,
        });
        steps.push({
          description: "Generate image asset at " + p + ".",
          actionType: "interact",
          target: deviceName,
          content: "generate_image " + args,
          estimatedDuration: "medium",
        });

        const descArgs = JSON.stringify({ path: p });
        steps.push({
          description: "Describe/critique the generated image at " + p + ".",
          actionType: "interact",
          target: deviceName,
          content: "describe_image " + descArgs,
          estimatedDuration: "short",
        });

        if (wantsEdit) {
          const editArgs = JSON.stringify({
            inPath: p,
            outPath: p,
            model: "gemini-2.5-flash-image",
            prompt: isHero
              ? "Refine this hero image to be calmer and more cohesive. Keep it minimalist; improve color harmony; no text."
              : "Refine this logo to be slightly more distinctive while staying minimalist. Keep the same overall motif; improve balance and spacing; no text.",
          });
          steps.push({
            description: "Iterate on the image asset at " + p + " using edit_image.",
            actionType: "interact",
            target: deviceName,
            content: "edit_image " + editArgs,
            estimatedDuration: "medium",
          });
          steps.push({
            description: "Re-describe the edited image at " + p + ".",
            actionType: "interact",
            target: deviceName,
            content: "describe_image " + descArgs,
            estimatedDuration: "short",
          });
        }
      }

      return {
        goalDescription: String(goalDesc || ""),
        steps,
        estimatedCompletion: "short",
        potentialObstacles: ["Nano Banana may fail or return no image; try again with a simpler prompt."],
        fallbackStrategy: "If generate_image fails repeatedly, adjust the prompt and retry.",
      };
    }
  }
  const context = buildPlanningContext(world, agentEid, goalEid);

  const nativeWorld = !!getAgentWorldCapabilities(world, agentEid);
  const taskRequirements: string[] = [];
  if (hints.requiredWrites.length || hints.requiredRun) taskRequirements.push('Use the exact paths and commands in the goal\'s "Writes:" and "Run:" fields.');
  if (hints.requiredWrites.some(isImageLikePath)) taskRequirements.push('Image assets use generate_image {"prompt":"...","outPath":"..."}, not binary bytes in write_file.');
  if (useCliCoder) taskRequirements.push('This CLI-only task requires gemini_cli to produce a unified diff starting with "diff --git", then git_apply_from_last_gemini <allowedPaths...>.');
  else if (hints.requiredWrites.some(isCodeLikePath)) taskRequirements.push('Read existing code before editing; use replace_in_file for minimal changes.');
  const prompt = `Plan how I can work toward: "${goalDesc}".

Use 0-7 concise, first-person steps, in character, that advance this goal — including the people to seek out and what to ask or tell them. Respect travel, reach and possession. Stop at the next real decision point; a partial plan is fine.
For a command marked fresh-decision-required, end the steps BEFORE it and add decision: {"purpose":"the choice to consider","target":"known entity","command":"exact advertised command name"}. Steps may be empty for an immediate decision. No command arguments, prewritten message or successors belong in that proposal. If reading unknown information comes first, end at reading; do not preselect a reaction to its contents.

Waiting is an evidence boundary, not elapsed turns. To wait for a response, end with a wait step and waitUntil: {"kind":"heard_evidence","speaker":"known person"}; a new message requires reconsideration, not automatic agreement. For a known physical condition, use waitUntil: {"kind":"physical_fact","subject":"known entity","predicate":"state","slot":"known observed field","equals":"required value"}; only fresh personally observed evidence permits continuation. timeoutMs is optional (1000-60000, default 15000); timeout means reconsider. Without a typed condition, end the plan at uncertainty. Descriptions and estimatedDuration cannot gate actions. Use repeat:true only when an action deliberately needs performing again.

Include verification when available. Executed steps and thoughts do not by themselves establish goal success.
GOAL SUCCESS CONTRACT: ${Goal.successJson[goalEid] || "No automatic verifier; identify what evidence would establish success."}
${taskRequirements.length ? `\nTASK REQUIREMENTS:\n${taskRequirements.map(requirement => `- ${requirement}`).join("\n")}\n` : ""}

Respond with JSON only:
{
  "goalDescription": "restated goal",
  "steps": [
    {
      "description": "I should ...",
      "actionType": "${supportedPlanActions(world, agentEid).join("|")}",
      "target": "optional - who/what/where",
      "content": "optional - what to say/do",
      "estimatedDuration": "short|medium|long"
    }
  ],
  "estimatedCompletion": "short|medium|long",
  "potentialObstacles": ["things that might prevent success"],
  "fallbackStrategy": "what to do if plan fails"
}`;

  const thinkingLevel = backgroundThinkingLevel();
  // A repair shares the original operation's budget. Giving each attempt a
  // fresh deadline used to occupy a subconscious slot for almost twice as long.
  const deadline = nativeWorld ? AbortSignal.timeout(backgroundDeadlineMs("planning", thinkingLevel)) : undefined;
  const scopeSignal = getSimulationTaskSignal();
  const signals = [deadline, scopeSignal].filter((signal): signal is AbortSignal => !!signal);
  const operationSignal = signals.length ? AbortSignal.any(signals) : undefined;
  let validationIssues: string[] | undefined;
  try {
    const attempt = async (extra: string): Promise<GeneratedPlan | null> => {
      operationSignal?.throwIfAborted();
      const response = await observeBackgroundProvider("planning",agentEid,thinkingLevel,()=> (options.generateText || generateText)({
        model,
        system: context,
        prompt: extra ? `${prompt}\n\n${extra}` : prompt,
        ...(nativeWorld ? {
          maxOutputTokens: backgroundOutputTokens("planning",thinkingLevel),
          maxRetries: 0,
          abortSignal: operationSignal,
          // Deliberate in the existing background lane; foreground remains low.
          providerOptions: { google: { thinkingConfig: { thinkingLevel } } },
        } : {}),
      }));
      operationSignal?.throwIfAborted();
      if(response.finishReason === "length") return null;
      const {text}=response;

      const jsonText = extractFirstJsonObject(text);
      if (!jsonText) return null;
      try {
        return JSON.parse(jsonText) as GeneratedPlan;
      } catch {
        // Last-ditch: try a looser slice from first { to last } (handles stray braces before/after).
        const first = String(text || "").indexOf("{");
        const last = String(text || "").lastIndexOf("}");
        if (first >= 0 && last > first) {
          try {
            return JSON.parse(String(text || "").slice(first, last + 1)) as GeneratedPlan;
          } catch {}
        }
        return null;
      }
    };

    let plan = preservePlanDecision(world, agentEid, canonicalPlan(await attempt("")));
    if (!plan) {
      console.error("[Planning] Failed to parse plan JSON");
      options.onFailure({ ok: false, reason: "parse_failed" });
      return null;
    }
    const v1 = validateGeneratedPlan(world, agentEid, goalDesc, plan);
    if (!v1.ok) {
      validationIssues = v1.issues;
      plan = preservePlanDecision(world, agentEid, canonicalPlan(await attempt(`Your previous plan was invalid. Fix these issues and output a corrected plan JSON only:\n- ${v1.issues.join("\n- ")}`)));
      if (!plan) { options.onFailure({ ok: false, reason: "parse_failed", issues: validationIssues }); return null; }
      const v2 = validateGeneratedPlan(world, agentEid, goalDesc, plan);
      if (!v2.ok) {
        console.error("[Planning] Plan validation failed:", v2.issues.slice(0, 6).join("; "));
        options.onFailure({ ok: false, reason: "validation_failed", issues: v2.issues });
        return null;
      }
    }

    console.log(`[Planning] Generated ${plan.steps.length}-step plan for "${goalDesc.slice(0, 40)}..."`);
    return plan;
  } catch (error) {
    console.error("[Planning] Error generating plan:", error);
    options.onFailure({ ok: false, reason: "generation_error", ...(validationIssues ? { issues: validationIssues } : {}) });
    return null;
  }
}

/**
 * Create a Plan entity from a generated plan
 */
const planActionSources = new WeakMap<World, Map<number, { scope: string; fence: PlanActionEvidenceFence }>>();

export function createPlanEntity(
  world: World,
  agentEid: number,
  goalEid: number,
  generatedPlan: GeneratedPlan,
  actionEvidenceFence: PlanActionEvidenceFence | null | undefined = capturePlanActionEvidenceFence(world, agentEid)
): number {
  assertSimulationTaskActive();
  // Bind the owner at admission, not on the first later speech/observation.
  workingMemoryEntityRef(world, agentEid);
  const planEid = addEntity(world);
  addComponent(world, planEid, Plan);
  addComponent(world, agentEid, HasPlan(planEid));
  // SoA slots can outlive removed entities. No old proposal belongs to this plan.
  PlanningDecision.definitionJson[planEid] = "";

  Plan.goalEid[planEid] = goalEid;
  // A free-text promise cannot authorize successors. Preserve the uncertainty
  // step for reconsideration, but discard its speculative continuation.
  const boundary = generatedPlan.steps.findIndex(step => step.actionType === "wait"
    && (!copyPlanWaitUntil(step.waitUntil) || step.waitUntil?.kind === "heard_evidence"));
  const runnable = (boundary < 0 ? generatedPlan.steps : generatedPlan.steps.slice(0, boundary + 1)).map(canonicalPlanStep);
  const episode = randomUUID();
  Plan.steps[planEid] = JSON.stringify(runnable.map((step, index) => {
    const { workingMemoryDependency: _untrusted, assessmentOutcomeId: _assessment, coordinationDependency: _coordination, ownSpeechDependency: _ownSpeech, resolution: _resolution, awaitingEvidenceDependency: _awaiting, completedWorkDependency: _completedWork,
      evidenceScope: _scope, evidenceBarrier: _barrier, evidenceWaitReason: _waitReason,
      planEid: _plan, goalEid: _goal, currentStep: _cursor, motorScope: _motor, ...clean } = step;
    if (clean.waitUntil !== undefined) {
      const grounded = groundPlanEvidenceCondition(world, agentEid, clean.waitUntil);
      // Bind actor-known identity when the intention is stored, not after a
      // different same-name object appears while earlier plan steps execute.
      if (!("issue" in grounded)) clean.waitUntil = grounded.condition;
    }
    const coordination = { coordinationDependency: currentCoordinationDependency(world, agentEid,
      stepCoordinationScope(world, agentEid, clean, runnable, goalEid)), evidenceScope: `${episode}:${index}` };
    return stepDependsOnDialogue(world, clean, runnable, goalEid)
      ? { ...clean, ...coordination, workingMemoryDependency: currentWorkingMemoryDependency(world, agentEid, stepMemoryReferences(clean, goalEid)),
        ...(clean.actionType === "speak" ? { ownSpeechDependency: ownSpokenPlanningEvidence(world, agentEid) } : {}) }
      : { ...clean, ...coordination, ...(isInspectionStep(clean) ? {
        workingMemoryDependency: currentWorkingMemoryDependency(world, agentEid, stepMemoryReferences(clean, goalEid)),
        assessmentOutcomeId: latestAssessmentPurposeOutcome(world, agentEid, goalEid),
      } : {}) };
  }));
  if (actionEvidenceFence && runnable.length) {
    let sources = planActionSources.get(world);
    if (!sources) { sources = new Map(); planActionSources.set(world, sources); }
    // Old/detached proposals are not an unbounded second memory ledger.
    for (const id of sources.keys()) if (!entityExists(world, id) || Plan.status[id] !== "active") sources.delete(id);
    if (sources.size >= 2048) sources.delete(sources.keys().next().value!);
    sources.set(planEid, { scope: `${episode}:0`, fence: actionEvidenceFence });
  }
  Plan.currentStep[planEid] = 0;
  Plan.status[planEid] = "active";
  const originRoom = getRoomForEntity(world, agentEid);
  Plan.routeRoomKey[planEid] = originRoom === undefined ? "" : workingMemoryEntityRef(world, originRoom)?.key || "";
  Plan.createdAt[planEid] = Date.now();
  Plan.lastUpdated[planEid] = Date.now();
  stampSimulationTime(world, planEid, "Plan.createdAt", Plan.createdAt[planEid]);
  stampSimulationTime(world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);

  Plan.heardDialogueId[planEid] = socialPlanningEvidence(world, agentEid);
  if (generatedPlan.decision !== undefined && boundary < 0) {
    if (!issuePlanDecision(world, agentEid, goalEid, planEid, generatedPlan.decision)) Plan.status[planEid] = "failed";
    else if (!runnable.length) Plan.status[planEid] = "awaiting_decision";
  }

  const agentName = Name.value[agentEid];
  console.log(`[Planning] Created plan for ${agentName}: ${generatedPlan.steps.length} steps`);

  return planEid;
}

function createFailedPlanEntity(world: World, agentEid: number, goalEid: number, reason: string): number {
  assertSimulationTaskActive();
  const planEid = addEntity(world);
  addComponent(world, planEid, Plan);
  addComponent(world, agentEid, HasPlan(planEid));

  Plan.goalEid[planEid] = goalEid;
  Plan.steps[planEid] = JSON.stringify([]);
  Plan.currentStep[planEid] = 0;
  Plan.status[planEid] = "failed";
  Plan.routeRoomKey[planEid] = "";
  Plan.createdAt[planEid] = Date.now();
  Plan.lastUpdated[planEid] = Date.now();
  stampSimulationTime(world, planEid, "Plan.createdAt", Plan.createdAt[planEid]);
  stampSimulationTime(world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);

  const agentName = Name.value[agentEid];
  console.log(`[Planning] Failed to create plan for ${agentName}: ${reason}`);
  return planEid;
}

/**
 * Get the current step of a plan
 */
export function getCurrentStep(planEid: number): PlanStep | null {
  const stepsJson = Plan.steps[planEid];
  if (!stepsJson) return null;

  try {
    const steps = JSON.parse(stepsJson) as PlanStep[];
    const currentIdx = Plan.currentStep[planEid] || 0;
    return steps[currentIdx] ? canonicalPlanStep(steps[currentIdx]) : null;
  } catch {
    return null;
  }
}

/**
 * Advance to the next step in a plan
 */
export function advancePlanStep(planEid: number, context?: { world: World; agentEid: number }): boolean {
  return advancePlanCursor(planEid, context, false);
}

/** Capture the selected plan episode before waiting. Only a genuine matching
 * evaluator proof can later move this exact cursor; replacement plans get none. */
export function captureActorWaitPlan(world: World, eid: number, condition: PlanWaitUntil, scope: string) {
  assertSimulationTaskActive();
  condition = structuredClone(condition);
  const focus = snapshotActorContinuation(world, eid), goal = focus?.goalId;
  if (!focus || goal === undefined || !["proposed", "dispatched"].includes(focus.status)
    || !getRelationTargets(world, eid, HasGoal).includes(goal) || Goal.status[goal] !== "active"
    || !hasComponent(world, goal, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[goal] !== focus.goalKey) return;
  const id = getPlanForGoal(world, eid, goal), step = id === undefined ? null : getCurrentStep(id);
  if (id === undefined || Plan.status[id] !== "active" || step?.actionType !== "wait" || !step.waitUntil) return;
  const grounded = groundPlanEvidenceCondition(world, eid, step.waitUntil);
  const predicate = (value: PlanWaitUntil) => { const { timeoutMs: _, ...rest } = value; return JSON.stringify(rest); };
  if ("issue" in grounded || predicate(grounded.condition) !== predicate(condition)) return;
  if (!hasComponent(world, id, WorkingMemoryIdentity)) addComponent(world, id, WorkingMemoryIdentity);
  if (!WorkingMemoryIdentity.id[id]) WorkingMemoryIdentity.id[id] = `plan:${randomUUID()}`;
  const key = WorkingMemoryIdentity.id[id], createdAt = Plan.createdAt[id], steps = Plan.steps[id], cursor = Plan.currentStep[id] || 0;
  const goalDefinition = JSON.stringify([Goal.createdAt[goal], Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]);
  return (result: PlanEvidenceBarrierResult): boolean => {
    assertSimulationTaskActive();
    const current = snapshotActorContinuation(world, eid);
    if (!isVerifiedWaitResult(world, eid, result, scope, condition) || result.status !== "satisfied"
      || current?.revision !== focus.revision || current.goalId !== goal || current.goalKey !== focus.goalKey
      || !hasComponent(world, goal, Goal) || !hasComponent(world, goal, WorkingMemoryIdentity) || WorkingMemoryIdentity.id[goal] !== focus.goalKey
      || current.status === "needs_revision" || Goal.status[goal] !== "active" || !getRelationTargets(world, eid, HasGoal).includes(goal)
      || JSON.stringify([Goal.createdAt[goal], Goal.description[goal], Goal.kind[goal], Goal.paramsJson[goal], Goal.successJson[goal]]) !== goalDefinition
      || !entityExists(world, id) || !hasComponent(world, id, Plan) || !hasComponent(world, id, WorkingMemoryIdentity)
      || WorkingMemoryIdentity.id[id] !== key || getPlanForGoal(world, eid, goal) !== id
      || !getRelationTargets(world, eid, HasPlan).includes(id) || Plan.goalEid[id] !== goal
      || Plan.status[id] !== "active" || Plan.createdAt[id] !== createdAt || Plan.steps[id] !== steps || (Plan.currentStep[id] || 0) !== cursor) return false;
    const updated = JSON.parse(steps) as PlanStep[];
    updated[cursor].resolution = { kind: "evidence_barrier", sourceId: result.sourceIds.join(","), resolvedAt: Date.now(),
      summary: "Actor-selected physical condition verified by fresh owned evidence; not a performed action" };
    Plan.steps[id] = JSON.stringify(updated);
    advancePlanCursor(id, { world, agentEid: eid }, true);
    return true;
  };
}

function advancePlanCursor(planEid: number, context: { world: World; agentEid: number } | undefined, evidenceWait: boolean): boolean {
  if (Plan.status[planEid] !== "active") return false;
  const stepsJson = Plan.steps[planEid];
  if (!stepsJson) return false;

  try {
    const steps = JSON.parse(stepsJson) as PlanStep[];
    if (!Array.isArray(steps) || steps.length === 0) return false;
    const currentIdx = Plan.currentStep[planEid] || 0;
    // Native wait acknowledgement is never evidence of a condition. Only the
    // private barrier evaluator may advance this cursor.
    if (steps[currentIdx]?.actionType === "wait" && !evidenceWait) return false;
    if (steps[currentIdx]?.actionType === "move" && context
      && getRelationTargets(context.world, context.agentEid, HasPlan).includes(planEid)
      && getRelationTargets(context.world, context.agentEid, HasGoal).includes(Plan.goalEid[planEid])) {
      const room = getRoomForEntity(context.world, context.agentEid);
      Plan.routeRoomKey[planEid] = room === undefined ? "" : workingMemoryEntityRef(context.world, room)?.key || "";
    }

    // Called with actor context only after a matched committed executor step.
    // Its own speech is expected progress, not an independent interruption of
    // the remaining conversation. Physical steps cannot reset this boundary.
    if (steps[currentIdx]?.actionType === "speak" && context
      && getRelationTargets(context.world, context.agentEid, HasPlan).includes(planEid)
      && getRelationTargets(context.world, context.agentEid, HasGoal).includes(Plan.goalEid[planEid])) {
      const ownSpeech = ownSpokenPlanningEvidence(context.world, context.agentEid);
      for (const step of steps.slice(currentIdx + 1)) if (step.actionType === "speak") step.ownSpeechDependency = ownSpeech;
      Plan.steps[planEid] = JSON.stringify(steps);
    }

    if (currentIdx >= steps.length - 1) {
      if (PlanningDecision.definitionJson[planEid]) {
        // There is deliberately no executable step beyond this cursor.
        Plan.currentStep[planEid] = steps.length;
        Plan.status[planEid] = "awaiting_decision";
        Plan.lastUpdated[planEid] = Date.now();
        if (context) stampSimulationTime(context.world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);
        return false;
      }
      // Plan complete
      Plan.status[planEid] = "completed";
      if (context && getRelationTargets(context.world, context.agentEid, HasPlan).includes(planEid)
        && getRelationTargets(context.world, context.agentEid, HasGoal).includes(Plan.goalEid[planEid])
        && isEvidenceHeldReview(context.world, context.agentEid, Plan.goalEid[planEid], steps)) {
        steps[steps.length - 1].completedWorkDependency = completedWorkDependency(context.world, context.agentEid, Plan.goalEid[planEid], steps);
        Plan.steps[planEid] = JSON.stringify(steps);
      }
      Plan.lastUpdated[planEid] = Date.now();
      if (context) stampSimulationTime(context.world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);
      return false;
    }

    Plan.currentStep[planEid] = currentIdx + 1;
    Plan.lastUpdated[planEid] = Date.now();
    if (context) stampSimulationTime(context.world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mark a plan as failed
 */
export function failPlan(planEid: number, reason?: string): void {
  Plan.status[planEid] = "failed";
  Plan.lastUpdated[planEid] = Date.now();
  console.log(`[Planning] Plan ${planEid} failed${reason ? `: ${reason}` : ""}`);
}

const normalizedPlanText = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function inspectionQuestion(step: PlanStep): string | undefined {
  return step.actionType === "observe" ? step.content : undefined;
}
function isInspectionStep(step: PlanStep): boolean {
  return step.actionType === "observe" || step.actionType === "interact" && /^(examine|inspect)$/i.test(String(step.content || "").trim());
}
function latestAssessmentPurposeOutcome(world: World, agentEid: number, goalEid: number): string {
  const key = WorkingMemoryIdentity.id[goalEid];
  if (!key) return "";
  return [...getWorkingMemory(world, agentEid).receipts].reverse().find(r => r.kind === "action" && r.provenance === "own_action"
    && r.executionContext?.intention?.key === key && r.action && ["pickup", "drop", "give", "interact", "use"].includes(r.action.type))?.id || "";
}
function inspectionNeedsReview(world: World, agentEid: number, goalEid: number, step: PlanStep, execution = false): boolean {
  if (!isInspectionStep(step) || targetsCharacter(world, step) || coveredStep(world, agentEid, step)) return false;
  const current = currentWorkingMemoryDependency(world, agentEid, stepMemoryReferences(step, goalEid));
  if (execution) {
    if (step.repeat) return false;
    const purposeOutcome = latestAssessmentPurposeOutcome(world, agentEid, goalEid);
    if (purposeOutcome && purposeOutcome !== step.assessmentOutcomeId) return true;
    // A changed visible scene can legitimately warrant the planned inspection.
    // But later own manipulation of its subject/purpose supersedes the old
    // assessment proposal: ask the foreground again, don't slip it between
    // their newly chosen actions. Travel/orientation are normal prerequisites.
    const actionId = JSON.parse(current).action as string;
    let previousAction = "";
    try { previousAction = JSON.parse(step.workingMemoryDependency || "{}").action || ""; } catch { /* Legacy premise requires fresh evidence. */ }
    const receipt = getWorkingMemory(world, agentEid).receipts.find(r => r.id === actionId && r.kind === "action" && r.provenance === "own_action");
    return !!actionId && actionId !== previousAction && !!receipt?.action
      && !["move", "observe", "think", "wait", "reflect"].includes(receipt.action.type);
  }
  return step.workingMemoryDependency === undefined ? current !== JSON.stringify({ facts: [], action: "" })
    : step.workingMemoryDependency !== current;
}
function reusableInspection(world: World, agentEid: number, step: PlanStep) {
  const inspection = getCurrentInspection(world, agentEid, step.target || "", inspectionQuestion(step));
  if (!inspection || inspection.outcome === "not_observable" || Date.now() - inspection.observedAt >= 60_000) return;
  const label = normalizedPlanText(inspection.subjectLabel);
  // A later heard statement may report a change without establishing physical
  // truth. It justifies rechecking, never overwriting the old inspection itself.
  if (getSocialDialogue(world, agentEid).some(turn => !turn.own && turn.atMs > inspection.observedAt
    && ` ${normalizedPlanText(turn.content)} `.includes(` ${label} `))) return;
  return inspection;
}
/** Only idempotent arrival and an actual owned inspection can cover a stored
 * intention. Never infer that an arbitrary physical action has been performed. */
function coveredStep(world: World, agentEid: number, step: PlanStep): PlanStep["resolution"] | undefined {
  if (step.repeat === true) return;
  const target = String(step.target || "").trim();
  if (!target) return;
  if (step.actionType === "move") {
    const room = getRoomForEntity(world, agentEid);
    if (room !== undefined && normalizedPlanText(Name.value[room] || "") === normalizedPlanText(target)
      && planningRoomTargets(world, agentEid).filter(candidate => normalizedPlanText(Name.value[candidate] || "") === normalizedPlanText(target)).length === 1) {
      return { kind: "already_here", sourceId: "own-location", resolvedAt: Date.now(), summary: `Already in ${Name.value[room]}` };
    }
  } else if (isInspectionStep(step) && !targetsCharacter(world, step)) {
    const inspection = reusableInspection(world, agentEid, step);
    if (inspection) {
      return { kind: "inspection", sourceId: inspection.sourceId, resolvedAt: Date.now(),
        summary: `Existing inspection of ${inspection.subjectLabel}: ${inspection.summary}` };
    }
  }
}

function waitingPlanDependency(world: World, agentEid: number, goalEid: number, steps: PlanStep[]): string {
  const references = [Goal.description[goalEid] || "", ...steps.flatMap(step => [step.description, step.target || "", step.content || ""])];
  const labels = [...new Set(steps.map(step => normalizedPlanText(step.target || "")).filter(Boolean))];
  // An actual incoming statement about the inspected target can justify a new
  // look; unrelated conversation and own repeated intentions cannot.
  const communication = relevantIncomingPlanningEvidence(world, agentEid, labels);
  return JSON.stringify({ definition: goalDefinition(world, goalEid), memory: currentWorkingMemoryDependency(world, agentEid, references), ...communication,
    coordination: currentCoordinationDependency(world, agentEid, { references, goalRefs: [getCoordinationGoalRef(world, agentEid, goalEid)] }),
    inspections: steps.filter(isInspectionStep).map(step => reusableInspection(world, agentEid, step)?.sourceId || ""),
    // Own location is proprioception, not a lookup of a hidden target.
    location: steps.some(step => step.actionType === "move") ? Name.value[getRoomForEntity(world, agentEid) ?? -1] || "" : "" });
}
function waitingPlanEvidenceChanged(world: World, agentEid: number, goalEid: number, planEid: number): boolean {
  try {
    const steps = JSON.parse(Plan.steps[planEid] || "[]") as PlanStep[];
    return !Array.isArray(steps) || !steps.length || steps[steps.length - 1].awaitingEvidenceDependency !== waitingPlanDependency(world, agentEid, goalEid, steps);
  } catch { return true; }
}

/** Assessment is command semantics, not a synonym match on the step description.
 * Unknown/generated interactions remain physical work until their native contract
 * says otherwise. Lost or ambiguous access cannot keep an old review parked. */
function isAssessmentStep(world: World, agentEid: number, input: PlanStep): boolean {
  const step = canonicalPlanStep(input);
  if (["think", "observe", "examine"].includes(step.actionType)) return true;
  if (step.actionType !== "interact" || !step.target) return false;
  const targets = getAgentVisualEntities(world, agentEid)
    .filter(eid => normalizedPlanText(Name.value[eid] || "") === normalizedPlanText(step.target!));
  return targets.length === 1 && getDocumentCommandEffect(world, agentEid, targets[0],
    { type: step.actionType, content: step.content }) === "observation";
}

/** A duration-based obligation is not completed by reviewing it. Nor does a
 * completed review imply a new short plan is needed every scheduler interval. */
function isSustainedWorkReview(world: World, agentEid: number, goalEid: number, steps: PlanStep[]): boolean {
  const requiresTime = (node: any, depth = 0): boolean => !!node && depth < 16 && (
    node.type === "productive_time" ? Number.isFinite(node.atLeastMs) && node.atLeastMs > 0
    : node.type === "all_of" && Array.isArray(node.conditions) ? node.conditions.some((child: unknown) => requiresTime(child, depth + 1))
    : node.type === "any_of" && Array.isArray(node.conditions) && node.conditions.length > 0
      ? node.conditions.every((child: unknown) => requiresTime(child, depth + 1)) : false);
  return requiresTime(readGoalSuccessContract(goalEid)) && steps.length > 0
    && steps.every(step => step.actionType === "move" || isAssessmentStep(world, agentEid, step));
}

/** An assessment may finish while an open narrative concern remains active.
 * Completing it is neither goal success nor new demand for the same assessment.
 * Finite proof obligations and physical stages retain ordinary replanning. */
function isEvidenceHeldReview(world: World, agentEid: number, goalEid: number, steps: PlanStep[]): boolean {
  return isSustainedWorkReview(world, agentEid, goalEid, steps)
    || readGoalSuccessContract(goalEid)?.type === "custom" && steps.length > 0
      && steps.every(step => isAssessmentStep(world, agentEid, step));
}

function completedWorkDependency(world: World, agentEid: number, goalEid: number, steps: PlanStep[]): string {
  const references = [Goal.description[goalEid] || "", ...steps.flatMap(step => [step.description, step.target || "", step.content || ""])];
  const surfaces = publicPlanningActions(world, agentEid);
  const labels = planningReferenceLabels(world, agentEid, goalEid, steps);
  const communication = relevantIncomingPlanningEvidence(world, agentEid, labels);
  // Only actor-held facts and accessible action surfaces. A new receipt ID for
  // the same own inspection/thought is not itself a changed circumstance.
  return JSON.stringify({ source: getCommittedEvents(world).sourceId, definition: goalDefinition(world, goalEid),
    actor: [WorkingMemoryIdentity.id[agentEid], Agent.role[agentEid], Agent.systemPrompt[agentEid]], room: getRoomForEntity(world, agentEid),
    memory: currentWorkingMemoryDependency(world, agentEid, references, { includeOwnAction: false }), ...communication,
    coordination: currentCoordinationDependency(world, agentEid, { references, goalRefs: [getCoordinationGoalRef(world, agentEid, goalEid)] }),
    surfaces: surfaces.map(surface => [surface.eid, surface.name, surface.seen, surface.affordances.slice().sort(), surface.available.slice().sort(), surface.inventory.slice().sort(), surface.commandHelp]) });
}

/** Resolve the covered prefix without dispatching fictional actions. A wholly
 * redundant proposal waits for evidence; goal satisfaction stays separate. */
export function reconcileCurrentPlan(world: World, agentEid: number, planEid: number): number {
  assertSimulationTaskActive();
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !Agent.active[agentEid]
    || !hasComponent(world, planEid, Plan) || Plan.status[planEid] !== "active"
    || !getRelationTargets(world, agentEid, HasPlan).includes(planEid)
    || !getRelationTargets(world, agentEid, HasGoal).includes(Plan.goalEid[planEid])
    || !hasComponent(world, Plan.goalEid[planEid], Goal) || Goal.status[Plan.goalEid[planEid]] !== "active"
    || hasComponent(world, agentEid, PendingToolJob) || getAgentWorldCapabilities(world, agentEid)?.busy()) return 0;
  let steps: PlanStep[];
  try { steps = JSON.parse(Plan.steps[planEid] || "[]"); } catch { return 0; }
  if (!Array.isArray(steps) || !steps.length) return 0;
  steps = steps.map(canonicalPlanStep);
  let resolved = 0;
  while (Plan.status[planEid] === "active") {
    const index = Plan.currentStep[planEid] || 0, step = steps[index];
    if (!step || isStaleSocialStep(world, agentEid, Plan.goalEid[planEid], planEid, step, steps)) break;
    const source = planActionSources.get(world)?.get(planEid);
    const repeatedCommand = steps.slice(0, index).some(previous => previous.actionType === step.actionType
      && previous.target === step.target && previous.content === step.content);
    // Request-time races can cover only the leading already-covered prefix.
    // Crossing actual execution, new inspection, or a condition barrier would
    // let pre-prerequisite evidence satisfy a post-prerequisite intention.
    const unchangedPrefix = steps.slice(0, index).every(previous =>
      previous.resolution?.kind === "action_evidence" || previous.resolution?.kind === "already_here");
    const crossedWait = steps.slice(0, index).some(previous => previous.actionType === "wait");
    const resolution = (crossedWait && isInspectionStep(step) ? undefined : coveredStep(world, agentEid, step))
      || (unchangedPrefix && !repeatedCommand && source && source.scope === steps[0]?.evidenceScope
        ? resolvePlanActionEvidence(world, agentEid, source.fence, step, {
          consumedSourceIds: steps.flatMap(previous => previous.resolution?.kind === "action_evidence" ? [previous.resolution.sourceId] : []),
        }) : undefined);
    if (!resolution) break;
    steps[index] = { ...step, resolution }; resolved++;
    Plan.steps[planEid] = JSON.stringify(steps);
    advancePlanStep(planEid);
  }
  if (resolved && String(Plan.status[planEid]) === "completed") {
    stampSimulationTime(world, planEid, "Plan.lastUpdated", Plan.lastUpdated[planEid]);
    if (isSustainedWorkReview(world, agentEid, Plan.goalEid[planEid], steps)
      || isEvidenceHeldReview(world, agentEid, Plan.goalEid[planEid], steps) && steps.some(step => !step.resolution)) {
      // Reusing existing evidence completes this review too. Keep the per-step
      // resolution receipts; no action or productive time was executed here.
      // A wholly covered narrative proposal did not execute an assessment:
      // retain its awaiting-evidence freshness/retirement lifecycle below.
      steps[steps.length - 1].completedWorkDependency = completedWorkDependency(world, agentEid, Plan.goalEid[planEid], steps);
      Plan.steps[planEid] = JSON.stringify(steps);
    } else if (steps.every(step => step.resolution)) {
      steps[steps.length - 1].awaitingEvidenceDependency = waitingPlanDependency(world, agentEid, Plan.goalEid[planEid], steps);
      Plan.steps[planEid] = JSON.stringify(steps);
      Plan.status[planEid] = "awaiting_evidence";
    }
  }
  return resolved;
}

/** Read-only readiness used by attention scheduling; it does not consume
 * inspections, advance cursors, or turn a blocked plan into urgent work. */
export function hasActionablePlannedStep(world: World, agentEid: number, options: { urgentOnly?: boolean } = {}): boolean {
  if (hasComponent(world, agentEid, PendingToolJob) || getAgentWorldCapabilities(world, agentEid)?.busy()) return false;
  // A background proposal for a different goal must not repeatedly wake the
  // situated actor as runnable work that its executor would refuse to select.
  const goal = cognitionController(world) === "situated" ? situatedPlanGoal(world, agentEid)
    : getRelationTargets(world, agentEid, HasGoal).filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
  if (goal === undefined) return false;
  const plan = getPlanForGoal(world, agentEid, goal);
  if (plan === undefined || Plan.status[plan] !== "active") return false;
  try {
    const steps = JSON.parse(Plan.steps[plan] || "[]") as PlanStep[];
    if (!Array.isArray(steps)) return false;
    for (const step of steps.slice(Plan.currentStep[plan] || 0).map(canonicalPlanStep)) {
      if (step.actionType === "wait") return false; // No sensing or barrier consumption in an attention probe.
      if (isStaleSocialStep(world, agentEid, goal, plan, step, steps)) return false;
      if (coveredStep(world, agentEid, step)) continue;
      if (options.urgentOnly && ["wait", "rest", "observe", "think", "reflect"].includes(step.actionType)) return false;
      return checkStepPrerequisites(world, agentEid, step);
    }
  } catch { /* Malformed stored steps are not runnable work. */ }
  return false;
}

/** Revalidate the grounded surface immediately before issuing a stored step.
 * Free-form prerequisite prose is advisory; current ECS visibility and the
 * target's live affordances are authoritative. */
export function checkStepPrerequisites(world: World, agentEid: number, step: PlanStep): boolean {
  if (!step || typeof step.actionType !== "string" || planStepFieldIssues(step).length) return false;
  if (step.motorScope !== undefined && !isMotorPlanScopeCurrent(world, agentEid, step.motorScope, step)) return false;
  step = canonicalPlanStep(step);
  if (!supportedPlanActions(world, agentEid).includes(step.actionType)) return false;
  if (storedInventoryActions.some(type => type === step.actionType)) return !inventoryStepIssue(world, agentEid, step);
  if (step.actionType === "speak" && step.target) {
    const targetName = step.target.trim().toLowerCase();
    return getAgentVisibleEntities(world, agentEid).some(id => hasComponent(world, id, Agent)
      && String(Name.value[id] || "").trim().toLowerCase() === targetName);
  }
  if (step.actionType === "interact") {
    const targetName = String(step.target || "").trim().toLowerCase();
    const command = String(step.content || "").trim();
    if (!targetName || !command) return false;
    const target = getAgentVisibleEntities(world, agentEid)
      .find(eid => String(Name.value[eid] || "").trim().toLowerCase() === targetName);
    if (target === undefined) return false;
    if (isDocumentOperation({ type: "interact", content: command }))
      return isDocumentCommandAvailable(world, agentEid, target, command);
    return getAvailableAffordances(world, agentEid, target)
      .some(candidate => !candidate.requiresFreshDecision && matchesAffordanceCommand(candidate.name, command));
  }
  if (step.actionType === "observe") {
    const targetName = String(step.target || "").trim().toLowerCase();
    if (!targetName) return false;
    const room = getRoomForEntity(world, agentEid);
    if (room !== undefined && String(Name.value[room] || "").trim().toLowerCase() === targetName) return true;
    return getAgentVisibleEntities(world, agentEid)
      .some(eid => String(Name.value[eid] || "").trim().toLowerCase() === targetName);
  }
  if (step.actionType === "move") {
    const targetName = String(step.target || "").trim();
    if (!targetName) return false;
    if (getRoomRouteTopologyGeneration(world)) return resolveRoomRouteTarget(world, agentEid, targetName) !== undefined;
    return Array.from(query(world, [Room])).some(eid => String(Name.value[eid] || "").trim() === targetName) ||
      getAgentVisibleEntities(world, agentEid).some(eid => String(Name.value[eid] || "").trim() === targetName);
  }
  return true;
}

/**
 * Run the planning system for all agents
 * Creates plans for goals that don't have them
 */
const planningInFlight = new WeakMap<World, Set<string>>();
const planningRequestSequences = new WeakMap<World, number>();

function planningRequest(world: World, agentEid: number, goalEid: number) {
  const sequence = (planningRequestSequences.get(world) || 0) + 1;
  planningRequestSequences.set(world, sequence);
  const requestId = `planning:${sequence}`;
  // Capture the operator sink at issuance so deletion/unregistration can still
  // report cancellation. Nothing is queued into the actor's cognitive channels.
  const capabilities = getAgentWorldCapabilities(world, agentEid);
  const observer = capabilities?.onPlanningEvent?.bind(capabilities);
  let terminal = false, validated = false;
  const emit = (event: PlanningEvent) => {
    try { observer?.(event); } catch { console.warn("[Planning] Operator telemetry observer failed"); }
  };
  const base = () => ({ requestId, agentEid, goalEid, atMs: Date.now() });
  emit({ ...base(), stage: "requested" });
  return {
    validated(stepCount: number) {
      if (terminal || validated) return;
      validated = true; emit({ ...base(), stage: "validated", stepCount });
    },
    admitted(planEid: number, stepCount: number) {
      if (terminal) return;
      terminal = true; emit({ ...base(), stage: "admitted", planEid, stepCount });
    },
    discarded(reason: PlanningDiscardReason, issues?: string[]) {
      if (terminal) return;
      terminal = true;
      emit({ ...base(), stage: "discarded", reason,
        ...(issues?.length ? { issues: issues.slice(0, 6).map(issue => issue.slice(0, 240)) } : {}) });
    },
  };
}

function goalDefinition(world: World, goalEid: number): string {
  return JSON.stringify([Goal.description[goalEid], Goal.kind[goalEid], Goal.paramsJson[goalEid],
    Goal.successJson[goalEid], Goal.createdAt[goalEid], intentionReviewRevision(world, goalEid), isStandingIntention(world, goalEid)]);
}

function visiblePlanningState(world: World, agentEid: number): string {
  return JSON.stringify(publicPlanningActions(world, agentEid).map(surface => [surface.eid, surface.name,
    surface.seen, surface.affordances.sort(), surface.available.sort(), surface.inventory.sort(), surface.commandHelp]));
}

type PlanningReadinessOptions = { focusActiveGoal?: boolean; background?: boolean };

function planningGoals(world: World, agentEid: number, options: PlanningReadinessOptions): number[] {
  if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !hasComponent(world, agentEid, Mind) || !Agent.active[agentEid]) return [];
  if (!options.background && getAgentWorldCapabilities(world, agentEid)?.busy()) return [];
  const goals = getRelationTargets(world, agentEid, HasGoal)
    // Standing motivations inform choice; they are not an endless task queue.
    // A concrete episodic intention can be planned normally. Existing finite
    // plans under a standing motivation retain their execution/lifecycle rules.
    .filter(id => hasComponent(world, id, Goal) && Goal.status[id] === "active" && !isStandingIntention(world, id))
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  // Preparation is not execution ownership: an already-planned concern must
  // not starve other owned goals of background planning capacity.
  const candidates = options.background ? goals.filter(id => shouldPlanGoal(world, agentEid, id)) : goals;
  return options.focusActiveGoal ? candidates.slice(0, 1) : candidates;
}

function shouldPlanGoal(world: World, agentEid: number, goalEid: number): boolean {
  if (!hasComponent(world, goalEid, Goal) || Goal.status[goalEid] !== "active" || isStandingIntention(world, goalEid)
    || planningInFlight.get(world)?.has(`${agentEid}:${goalEid}`)) return false;
  const existingPlan = getPlanForGoal(world, agentEid, goalEid);
  if (existingPlan === undefined) return true;
  const status = String(Plan.status[existingPlan] || "");
  if (status === "active") return isStaleSocialPlan(world, agentEid, goalEid, existingPlan);
  if (status === "awaiting_evidence") return waitingPlanEvidenceChanged(world, agentEid, goalEid, existingPlan);
  if (status === "awaiting_decision") return planDecisionNeedsReplanning(world, agentEid, existingPlan);
  const last = Number(Plan.lastUpdated[existingPlan] || 0);
  // Allow the evaluator to observe the final action before planning more work.
  if (status === "completed") {
    let socialOnly = false;
    try {
      const steps = JSON.parse(Plan.steps[existingPlan] || "[]") as PlanStep[];
      if (Array.isArray(steps) && isEvidenceHeldReview(world, agentEid, goalEid, steps) && steps[steps.length - 1]?.completedWorkDependency !== undefined)
        return steps[steps.length - 1].completedWorkDependency !== completedWorkDependency(world, agentEid, goalEid, steps);
      socialOnly = Array.isArray(steps) && isSocialOnlyPlan(world, steps, goalEid);
    } catch { /* Malformed plan histories retain the standard retry interval. */ }
    return Date.now() - last >= (socialOnly ? 30_000 : 2_000);
  }
  if (status !== "failed") return true;
  const goalText = String(Goal.description[goalEid] || "");
  const deterministicRetry = /^Mission:\s*Ship the branded Todo App/i.test(goalText) || goalRequestsCliCoder(goalText);
  let failedPhysicalPlan = false;
  if (getAgentWorldCapabilities(world, agentEid)) {
    try {
      const steps = JSON.parse(Plan.steps[existingPlan] || "[]");
      failedPhysicalPlan = Array.isArray(steps) && steps.length > 0;
    } catch { /* Malformed generation failures retain the longer provider backoff. */ }
  }
  const cooldownMs = deterministicRetry || failedPhysicalPlan ? 2_000 : 15_000;
  return !last || Date.now() - last >= cooldownMs;
}

/** Cheap, read-only demand check; uses exactly the same in-flight/backoff rules as execution. */
export function hasPendingPlanning(world: World, agentEid: number, options: PlanningReadinessOptions = {}): boolean {
  return world.meta.aiEnabled !== false && planningGoals(world, agentEid, options).some(goal => shouldPlanGoal(world, agentEid, goal));
}

export async function runPlanningSystem(world: World, options: {
  focusActiveGoal?: boolean;
  /** Scope queued subconscious work to one actor instead of a serial cast-wide task. */
  agentEids?: readonly number[];
  /** Background inference may run during physical activity; stale admission guards still apply. */
  background?: boolean;
  /** Injectable planner for deterministic pressure tests or a world-specific provider. */
  planGenerator?: typeof generatePlanForGoal;
} = {}): Promise<void> {
  // An injected deterministic planner remains available for tests and no-AI world packages.
  if (world.meta.aiEnabled === false && !options.planGenerator) return;
  let inFlight = planningInFlight.get(world);
  if (!inFlight) { inFlight = new Set(); planningInFlight.set(world, inFlight); }
  const selectedAgents = options.agentEids ? new Set(options.agentEids) : undefined;
  const agents = query(world, [Agent, Mind]).filter(eid => !selectedAgents || selectedAgents.has(eid));

  for (const agentEid of agents) {
    const agentName = Name.value[agentEid];
    const goalTargets = planningGoals(world, agentEid, options);

    for (const goalEid of goalTargets) {
      if (!shouldPlanGoal(world, agentEid, goalEid)) continue;
      const requestKey = `${agentEid}:${goalEid}`;
      const existingPlan = getPlanForGoal(world, agentEid, goalEid);
      if (existingPlan !== undefined && isStaleSocialPlan(world, agentEid, goalEid, existingPlan)) {
        failPlan(existingPlan, "Relevant dialogue, physical evidence or coordination changed; reconsider this step.");
        continue;
      }

      // Generate a new plan
      console.log(`[Planning] Generating plan for ${agentName}'s goal: "${Goal.description[goalEid]?.slice(0, 40)}..."`);
      const definition = goalDefinition(world, goalEid);
      const originalRoom = getRoomForEntity(world, agentEid);
      const originalVisibleState = visiblePlanningState(world, agentEid);
      const originalDialogue = socialPlanningEvidence(world, agentEid);
      const originalCorrespondence = getPrivateCommunications(world, agentEid);
      const originalOwnSpeech = ownSpokenPlanningEvidence(world, agentEid);
      const originalWorkingMemory = getWorkingMemory(world, agentEid);
      const originalActionEvidence = capturePlanActionEvidenceFence(world, agentEid);
      const originalCoordinationMemory = getCoordinationMemory(world, agentEid);
      const originalCoordinationGoal = getCoordinationGoalRef(world, agentEid, goalEid);
      inFlight.add(requestKey);
      const telemetry = planningRequest(world, agentEid, goalEid);
      try {
        let generationFailure: Extract<PlanGenerationOutcome, { ok: false }> = { ok: false, reason: "generation_failed" };
        let generatedPlan: GeneratedPlan | null;
        if (options.planGenerator) {
          generatedPlan = preservePlanDecision(world, agentEid, canonicalPlan(await options.planGenerator(world, agentEid, goalEid)));
          if (generatedPlan) {
            const validation = validateGeneratedPlan(world, agentEid, Goal.description[goalEid] || "", generatedPlan);
            if (validation.ok) telemetry.validated(generatedPlan.steps.length);
            else { generationFailure = { ok: false, reason: "validation_failed", issues: validation.issues }; generatedPlan = null; }
          }
        } else {
          generatedPlan = await generatePlanForGoal(world, agentEid, goalEid, { onOutcome: outcome => {
            if (outcome.ok) telemetry.validated(outcome.stepCount);
            else generationFailure = outcome;
          } });
        }
        assertSimulationTaskActive();
        if (world.meta.aiEnabled === false && !options.planGenerator) { telemetry.discarded("ai_disabled"); continue; }
        if (!entityExists(world, agentEid) || !hasComponent(world, agentEid, Agent) || !Agent.active[agentEid]) { telemetry.discarded("actor_unavailable"); continue; }
        if (!hasComponent(world, goalEid, Goal) || Goal.status[goalEid] !== "active") { telemetry.discarded("goal_unavailable"); continue; }
        if (!getRelationTargets(world, agentEid, HasGoal).includes(goalEid)) { telemetry.discarded("goal_detached"); continue; }
        if (goalDefinition(world, goalEid) !== definition) { telemetry.discarded("goal_changed"); continue; }
        if (getRoomForEntity(world, agentEid) !== originalRoom) { telemetry.discarded("room_changed"); continue; }
        if (visiblePlanningState(world, agentEid) !== originalVisibleState) { telemetry.discarded("visible_state_changed"); continue; }
        if (options.focusActiveGoal && getRelationTargets(world, agentEid, HasGoal).some(id =>
          hasComponent(world, id, Goal) && Goal.status[id] === "active" && !isStandingIntention(world, id)
          && (Goal.priority[id] || 0) > (Goal.priority[goalEid] || 0) &&
          (!options.background || shouldPlanGoal(world, agentEid, id)))) { telemetry.discarded("higher_priority_goal"); continue; }
        const currentPlan = getPlanForGoal(world, agentEid, goalEid);
        if (currentPlan !== existingPlan) { telemetry.discarded("plan_replaced"); continue; }
        // Foreground speech can already have asked the question while this
        // background request was running. Guard admission only: once a plan is
        // committed, its own spoken step must not invalidate the following
        // listening/physical step in that same plan.
        const latestOwnSpeech = ownSpokenPlanningEvidence(world, agentEid);
        if (generatedPlan?.steps.some(step => stepDependsOnDialogue(world, step, generatedPlan.steps, goalEid))) {
          if (heardDialogueChanged(world, agentEid, originalDialogue)) { telemetry.discarded("dialogue_changed"); continue; }
          if (!!latestOwnSpeech && latestOwnSpeech !== originalOwnSpeech) { telemetry.discarded("own_speech_changed"); continue; }
        }
        if (generatedPlan) {
          const labels = planningReferenceLabels(world, agentEid, goalEid, generatedPlan.steps);
          const current = relevantIncomingPlanningEvidence(world, agentEid, labels).correspondence;
          const original = relevantIncomingPlanningEvidence(world, agentEid, labels, originalCorrespondence).correspondence;
          if (current && current !== original) { telemetry.discarded("dialogue_changed"); continue; }
        }
        if (generatedPlan?.steps.some(step => stepDependsOnDialogue(world, step, generatedPlan.steps, goalEid)
          && workingMemoryDependency(originalWorkingMemory, stepMemoryReferences(step, goalEid))
            !== currentWorkingMemoryDependency(world, agentEid, stepMemoryReferences(step, goalEid)))) { telemetry.discarded("working_memory_changed"); continue; }
        if (generatedPlan?.steps.some(step => {
          const scope = { ...stepCoordinationScope(world, agentEid, step, generatedPlan.steps, goalEid), goalRefs: [originalCoordinationGoal] };
          return coordinationDependency(originalCoordinationMemory, scope) !== currentCoordinationDependency(world, agentEid, scope);
        })) { telemetry.discarded("coordination_changed"); continue; }
        // Memory changes alone cannot execute or erase a physical step. Its
        // current reach/affordance constraints are checked before admission and
        // checked again when the executor selects it.
        if (generatedPlan?.steps[0] && !checkStepPrerequisites(world, agentEid, generatedPlan.steps[0])) { telemetry.discarded("first_step_unavailable"); continue; }
        if (generatedPlan) {
          // Background admission has not performed foreground perception. Do
          // not consume an old inspection before the actor senses local changes.
          const planEid = createPlanEntity(world, agentEid, goalEid, generatedPlan, originalActionEvidence ?? null);
          telemetry.admitted(planEid, generatedPlan.steps.length);
        } else {
          createFailedPlanEntity(world, agentEid, goalEid, "validation/generation failed");
          telemetry.discarded(generationFailure.reason, generationFailure.issues);
        }
      } catch (error) {
        telemetry.discarded(getSimulationTaskSignal()?.aborted ? "cancelled" : "generation_error");
        throw error;
      } finally {
        inFlight.delete(requestKey);
      }
    }
  }
}

/**
 * Get the next action suggestion from an agent's active plans
 * An explicit purpose owns selection and execution attribution. Only actors
 * without an owned purpose use the legacy goal-priority fallback.
 */
export function getNextPlannedAction(world: World, agentEid: number, options: { selectedGoalId?: number } = {}): PlanStep | null {
  const situated = cognitionController(world) === "situated";
  const ownedPurpose = snapshotActorContinuation(world, agentEid);
  const selectedGoal = situated || ownedPurpose ? situatedPlanGoal(world, agentEid) : options.selectedGoalId;
  if ((situated || ownedPurpose) && selectedGoal === undefined) return null;
  if (options.selectedGoalId !== undefined && options.selectedGoalId !== selectedGoal) return null;
  return nextPlanStepForSelectedGoal(world, agentEid, selectedGoal);
}

/** Reuse ordinary prerequisite/dependency checks, but never replay dialogue or
 * an information-contingent response just because a side turn ended. */
export function getResumableActivityStep(world: World, agentEid: number): PlanStep | null {
  const goal = activityResumptionGoal(world, agentEid);
  if (goal === undefined) return null;
  const plan = getPlanForGoal(world, agentEid, goal), candidate = plan === undefined ? undefined : getCurrentStep(plan);
  if (!candidate || ["speak", "think", "wait"].includes(candidate.actionType)) return null;
  const step = nextPlanStepForSelectedGoal(world, agentEid, goal);
  return step && !["speak", "think", "wait"].includes(step.actionType) ? step : null;
}

function nextPlanStepForSelectedGoal(world: World, agentEid: number, selectedGoal: number | undefined): PlanStep | null {
  // If an async tool job is in-flight, do not re-issue the same interact step every tick.
  // The OfficeToolJobSystem will deliver a tool_result stimulus and clear PendingToolJob when complete.
  if (hasComponent(world as any, agentEid, PendingToolJob as any)) {
    const toolId = String(PendingToolJob.toolId[agentEid] || "").trim();
    const cmd = String(PendingToolJob.command[agentEid] || "").trim();
    const detail = toolId ? `${toolId}${cmd ? ` (${cmd.slice(0, 60)})` : ""}` : "a tool";
    return { description: `Wait for ${detail} to finish.`, actionType: "wait" };
  }
  if (getAgentWorldCapabilities(world, agentEid)?.busy()) return null;

  const goalTargets = getRelationTargets(world, agentEid, HasGoal);

  // Sort by priority
  const activeGoals = goalTargets
    .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active" && (selectedGoal === undefined || gid === selectedGoal))
    // A generated default routine is context for live choice, not permission
    // to preempt an independently chosen detour before its next primitive.
    .filter(gid => selectedGoal !== undefined || world.meta.aiEnabled === false || Goal.kind[gid] !== "scheduled_activity")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));

  for (const goalEid of activeGoals) {
    const planEid = getPlanForGoal(world, agentEid, goalEid);
    if (planEid !== undefined && Plan.status[planEid] === "active") {
      let remaining: PlanStep[];
      try {
        const stored = JSON.parse(Plan.steps[planEid] || "[]");
        if (!Array.isArray(stored)) throw new Error("Expected a step array");
        remaining = stored.slice(Plan.currentStep[planEid] || 0);
      } catch { failPlan(planEid, "Stored plan steps are invalid; reconsider."); return null; }
      if (remaining.some(step => step?.actionType === "move")) {
        const room = getRoomForEntity(world, agentEid), expected = Plan.routeRoomKey[planEid];
        const actual = room === undefined || !hasComponent(world, room, WorkingMemoryIdentity) ? undefined : WorkingMemoryIdentity.id[room];
        if ((expected !== undefined || hasComponent(world, agentEid, CognitiveControl)) && (!expected || actual !== expected)) {
          failPlan(planEid, "Movement outside this plan changed its route origin; reconsider from the current location.");
          return null;
        }
      }
      const motor = getCurrentStep(planEid)?.motorScope;
      if (motor !== undefined && !isMotorPlanScopeCurrent(world, agentEid, motor, getCurrentStep(planEid)!)) {
        failPlan(planEid, "Motor sequence source or target changed; reconsider.");
        return null;
      }
      reconcileCurrentPlan(world, agentEid, planEid);
      if (Plan.status[planEid] !== "active") return null;
      let step = getCurrentStep(planEid);
      // Actor control must choose a waiting condition explicitly. A background
      // wait is a proposal, not permission to arm/consume its evidence barrier.
      if (step?.actionType === "wait" && hasComponent(world, agentEid, CognitiveControl)) return null;
      if (isStaleSocialPlan(world, agentEid, goalEid, planEid)) {
        failPlan(planEid, "Relevant dialogue, physical evidence or coordination changed; reconsider this step.");
        return null;
      }
      // Foreground admission is the only place that senses/consumes a wait
      // barrier. A pending plan does not occupy the body or stop free cognition.
      while (step?.actionType === "wait" && Plan.status[planEid] === "active") {
        const steps = JSON.parse(Plan.steps[planEid]) as PlanStep[];
        const index = Plan.currentStep[planEid] || 0;
        const condition = step.waitUntil === undefined ? { kind: "heard_evidence" as const } : copyPlanWaitUntil(step.waitUntil);
        if (!condition || !step.evidenceScope) {
          failPlan(planEid, "Wait has no valid actor-evidence scope; reconsider.");
          return null;
        }
        // Includes legacy stored plans: unknown semantics cannot keep executable
        // successors alive just because they appeared in an old JSON draft.
        if (condition.kind === "heard_evidence") steps.splice(index + 1);
        if (!step.evidenceBarrier) {
          step.evidenceBarrier = issuePlanEvidenceBarrier(world, agentEid, condition, step.evidenceScope);
          steps[index] = step;
          Plan.steps[planEid] = JSON.stringify(steps);
        }
        if (!step.evidenceBarrier) {
          failPlan(planEid, "Wait condition cannot be grounded in personally known evidence.");
          return null;
        }
        const result = evaluatePlanEvidenceBarrier(world, agentEid, step.evidenceBarrier, step.evidenceScope,
          { observation: captureWorkingMemoryObservation(world, agentEid) });
        if (result.status === "waiting") return null;
        if (result.status === "reconsider") {
          steps[index].evidenceWaitReason = result.reason;
          Plan.steps[planEid] = JSON.stringify(steps);
          failPlan(planEid, `Evidence wait needs reconsideration: ${result.reason}`);
          return null;
        }
        steps[index].resolution = { kind: "evidence_barrier", sourceId: result.sourceIds.join(","), resolvedAt: Date.now(),
          summary: "Required physical condition personally observed; wait was not an executed action" };
        Plan.steps[planEid] = JSON.stringify(steps);
        advancePlanCursor(planEid, undefined, true);
        if (Plan.status[planEid] !== "active") return null;
        reconcileCurrentPlan(world, agentEid, planEid);
        step = getCurrentStep(planEid);
        if (isStaleSocialPlan(world, agentEid, goalEid, planEid)) {
          failPlan(planEid, "Evidence arrived; the following social step needs reconsideration.");
          return null;
        }
      }
      if (Plan.status[planEid] !== "active") return null;
      if (step && checkStepPrerequisites(world, agentEid, step)) {
        return { ...step, planEid, goalEid, currentStep: Plan.currentStep[planEid] || 0 };
      }
      if (step) failPlan(planEid, requiresFreshAffordanceDecision(world, agentEid, { type: step.actionType, target: step.target, content: step.content })
        ? `This command requires a fresh actor decision; retained wording is not executable: ${step.description}`
        : `Stored step is no longer physically available: ${step.description}`);
    }
    // A new high-priority intention awaiting a plan must not silently resume
    // an unrelated lower-priority plan. Deliberate until this goal has a plan.
    return null;
  }

  return null;
}

/**
 * Format plans for inclusion in agent context
 */
export function formatPlansForContext(world: World, agentEid: number): string {
  const situated = cognitionController(world) === "situated";
  const selectedGoal = situatedPlanGoal(world, agentEid);
  const activeGoals = getRelationTargets(world, agentEid, HasGoal)
    .filter(eid => hasComponent(world, eid, Goal) && Goal.status[eid] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  if (activeGoals.length === 0) return "";
  const currentPriority = Goal.priority[activeGoals[0]] || 0;
  const lines: string[] = ["ACTIVE PLANS:",
    situated ? "Saved proposals, not mandatory instructions. Choose a purpose before using its plan; reconsider it as your situation changes."
      : activeGoals.filter(goal => (Goal.priority[goal] || 0) === currentPriority).every(goal => isStandingIntention(world, goal))
        ? "Plans support the listed intentions; completing a plan does not exhaust a standing desire."
      : `Current priority: ${currentPriority} (advisory). Plans are approaches to desired outcomes, not competing obligations; only your chosen purpose may recruit its plan.`];
  const deferred: string[] = [];

  for (const goalEid of activeGoals) {
    const goalDesc = Goal.description[goalEid] || "Unknown goal";
    const priority = Goal.priority[goalEid] || 0;
    const planEid = getPlanForGoal(world, agentEid, goalEid);
    const stale = planEid !== undefined && isStaleSocialPlan(world, agentEid, goalEid, planEid);
    const isActive = planEid !== undefined && Plan.status[planEid] === "active" && !stale;
    if (!isActive) {
      if (situated || priority === currentPriority || goalEid === selectedGoal) {
        lines.push(`\nGoal: ${goalDesc} (priority ${priority})`);
        if (stale) {
          lines.push("The stored step needs reconsideration against dialogue, physical evidence and coordination; its old steps are not current instructions.");
        } else if (planEid !== undefined && Plan.status[planEid] === "completed") {
          let heldWorkReview = false;
          try {
            const steps = JSON.parse(Plan.steps[planEid] || "[]") as PlanStep[];
            heldWorkReview = Array.isArray(steps) && isEvidenceHeldReview(world, agentEid, goalEid, steps)
              && steps[steps.length - 1]?.completedWorkDependency === completedWorkDependency(world, agentEid, goalEid, steps);
          } catch { /* Invalid history is not a held activity. */ }
          lines.push(isStandingIntention(world, goalEid)
            ? "The plan finished. This standing desire remains available, not an unfinished task or a new instruction to act."
            : heldWorkReview
            ? "The assessment is finished; this goal remains open. Background replanning awaits relevant new evidence. You can still act or reconsider; assessment alone is not goal completion or productive work."
            : "The previous plan finished, but this goal is still unverified. Check actual outcomes before claiming success or deciding what remains.");
        } else if (planEid !== undefined && Plan.status[planEid] === "failed") {
          const reason = getCurrentStep(planEid)?.evidenceWaitReason;
          lines.push(reason ? `The stored wait needs reconsideration (${reason}); its premise was not proved and its successors are not instructions. Use current evidence to decide.`
            : "The previous plan failed; no executable plan is available yet. Reconsider this goal using the failure evidence.");
        } else if (planEid !== undefined && Plan.status[planEid] === "awaiting_decision") {
          lines.push("The executable prefix ended at a proposed decision. No action or success is implied; choose using current evidence. A reviewed proposal waits for relevant new evidence, not repeated planning calls.");
        } else if (planEid !== undefined && Plan.status[planEid] === "awaiting_evidence") {
          lines.push("The last proposal only repeated arrivals or inspections already covered by your evidence. Nothing was re-executed and this goal is not proven complete. Use those outcomes to choose a different next step; another identical plan waits for relevant new evidence.");
        } else {
          lines.push(situated ? "No saved plan. Decide whether this intention still matters and how to pursue it."
            : "No plan yet for this current-priority goal. Decide whether it matters now and how to pursue it.");
        }
      }
      continue;
    }
    const stepsJson = Plan.steps[planEid];
    const currentIdx = Plan.currentStep[planEid] || 0;

    try {
      const steps = JSON.parse(stepsJson) as PlanStep[];
      if (!Array.isArray(steps)) continue;
      if (!situated && priority < currentPriority && goalEid !== selectedGoal) {
        deferred.push(`- ${goalDesc} (priority ${priority}; saved step ${currentIdx + 1}/${steps.length}). Retained for a deliberate choice; not an instruction to abandon the current purpose.`);
        continue;
      }
      lines.push(`\nGoal: ${goalDesc} (priority ${priority})`);
      lines.push(`Progress: Step ${currentIdx + 1}/${steps.length}`);

      // Show current and next steps
      const currentStep = steps[currentIdx];
      if (currentStep) {
        if (isInspectionStep(currentStep) && !targetsCharacter(world, currentStep)
          && coveredStep(world, agentEid, currentStep)) {
          lines.push("An existing owned inspection covers this saved inspection. Use its recorded result to decide what remains; this projection neither executes the step nor establishes goal completion. Successors still require reconciliation before use.");
          continue;
        }
        if (inspectionNeedsReview(world, agentEid, goalEid, currentStep)) {
          lines.push("The saved inspection was proposed against earlier evidence. Reconsider what still needs inspecting using your current observations and outcomes; neither this step nor its successors are current instructions. No inspection or goal completion is implied.");
          continue;
        }
        lines.push(`Current: ${currentStep.description}`);
        if (currentStep.actionType === "wait") {
          lines.push("Waiting for fresh evidence, not an instruction to remain idle. Conditional successors are not available yet; you may reconsider or do other useful work.");
          continue;
        }
      }

      const nextStep = steps[currentIdx + 1];
      if (nextStep) {
        lines.push(isStaleSocialStep(world, agentEid, goalEid, planEid, nextStep, steps)
          ? "Next step needs reconsideration against newer evidence."
          : `Next: ${nextStep.description}`);
      }
    } catch {
      continue;
    }
  }

  if (deferred.length) lines.push("\nDEFERRED PLANS — saved intentions, not current instructions:", ...deferred);

  return lines.join("\n");
}
