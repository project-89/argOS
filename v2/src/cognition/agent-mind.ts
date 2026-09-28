import { readSimulationTime } from "../ecs/simulation-time";
import { recordControlLoopDiagnostic, foregroundChoiceDiagnostic } from "../runtime/control-loop-diagnostics";
import { foregroundProviderStats } from "./provider-telemetry";
import { formatWaitExperience } from "./wait-experience";
import { prepareActorWaitChecked, formatActorWait, settleActorWait, type ActorWaitIssue } from "./actor-wait";
import type { PlanWaitUntil } from "./plan-evidence-barrier";
import { formatObservableConditions } from "./planning-observable-conditions";
import { isSimulationResourceBusy } from "../runtime/simulation-timeline";
import { getPrivateCommunications } from "./communication-memory";
import { formatOngoingActivity, snapshotOngoingActivity, isActivityReturnStepCurrent } from "./ongoing-activity";
import { requiresFreshAffordanceDecision } from "../world/affordance-availability";
import { simulationAge, stampSimulationTime } from "../ecs/temporal-age";
import { generateText } from "ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, hasComponent, entityExists } from "bitecs";
import { Name, Description, Agent, Mind, Room, Thought, Perception, ConversationTurn, Goal, Personality, KanbanCard, KanbanColumn, PendingToolJob, BehaviorPolicy, LastAction, GridPosition } from "../ecs/components";
import { HasThought, HasPerception, HasConversation, HasGoal } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import {
  getKnowledgeSummary,
  getRelevantMemories,
  getImpressionOf,
  getAgentMemories
} from "./knowledge-graph";
import { addMemory } from "./knowledge-graph";
import { formatSocialMemoryContext, formatSocialGoalsForReview, getSocialDialogue, getSocialSpeechFragments, reviewSocialGoal } from "./social-memory";
import { getSpeakingActivity, readLocalSpeechOpportunity } from "./timed-speech";
import { formatWorkingMemoryContext, getWorkingMemory, workingMemoryEntityRef } from "./working-memory";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { captureHeardAppraisal, prepareHeardAppraisal } from "./heard-appraisal";
import { currentWorkingMemoryDependency, workingMemoryDependency } from "./working-memory-dependencies";
import { prepareCoordinationReviews, commitPreparedCoordinationReviews, getPreparedCoordinationWork, isPreparedCoordinationCurrent,
  formatCoordinationContext, getCoordinationMemory, getCoordinationGoalRef,
  captureCoordinationGoal, captureCoordinationWork, type CoordinationGoalRef, type CoordinationWorkRef } from "./coordination-memory";
import { coordinationDependency, currentCoordinationDependency, coordinationReviewEvidenceIsCurrent } from "./coordination-memory-dependencies";
import { Memory, Plan, Schedule, ReflectionState, GoalLifecycle, WorkingMemoryIdentity } from "../ecs/components";
import { HasPlan, HasSchedule, HasReflectionState } from "../ecs/relations";
import { formatPlansForContext, getNextPlannedAction, getResumableActivityStep } from "./planning-system";
import { formatInsightsForContext } from "./reflection-system";
import { formatScheduleForContext, getCurrentActivity } from "./schedule-system";
import { formatActionsForPrompt, getValidActionTypes } from "./action-registry";
import { formatProceduralSkillsForContext, selectProceduralAction, tryStartProcedureExecution } from "./procedural-skills";
import { evaluateBehaviorPolicy, formatBehaviorPolicyForContext } from "./behavior-policy";
import { selectFailureRecoveryAction } from "./failure-recovery";
import { selectContractDrivenAction } from "./contract-driven-actions";
import { getMovementTarget } from "../systems/builtin-systems";
import { ensureOfficeDeviceSandboxDir } from "../office-tools/sandbox";
import { recordPolicyAction } from "./policy-metrics";
import { captureLLMDecision } from "./bt-compiler";
import { getAspirations } from "./goal-learning";
import { formatCharacterMotivations } from "./character-context";
import { formatSkillsForContext } from "./skill-registry";
import { chronicle } from "./simulation-chronicle";
import { formatWorldTimeForContext } from "../systems/world-clock";
import { recordAgentAction } from "../spirits/watcher-spirit";
import { getAgentWorldCapabilities, getAgentVisualEntities, getAgentTangibleEntities } from "./world-capabilities";
import { getAgentSensoryCapabilities } from "./sensory-capabilities";
import { prepareGeneratedIntention, commitPreparedIntention, getPreparedIntentionGoalRef, isPreparedIntentionCurrent, formatGoalLifecycleContext, intentionReviewRevision } from "./goal-lifecycle";
import { captureGoalReviewContext, formatGoalPursuitContext, prepareGoalReview } from "./goal-pursuit";
import { getGoalDependents } from "./goal-dependents";
import { formatPersonalConcerns, getPersonalConcerns } from "./personal-concerns";
import { formatReflectionQuestions } from "./reflection-questions";
import { wakeForegroundCognition, getListeningActivities, isContinuingListeningProgress, isForegroundCognitionReady, captureForegroundRejectionBasis,
  recordForegroundRejection, formatForegroundRejectionRecovery } from "./idle-cognition";
import { foregroundActionShapeIssue, foregroundControlShape } from "./foreground-response-shape";
import { isInvalidHeardSpeechNotice, type HeardSpeechProgress } from "./social-memory";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { bindForegroundAction, integrateForegroundAction, captureForegroundDecisionFence, checkForegroundDecision, discardedForegroundDecision, getForegroundDecisionLocalView,
  rejectForegroundDecision, foregroundReferenceDiagnostic, type ForegroundRejectionReason, type ForegroundDecisionFence,
  isPhysicalForegroundAction, type ForegroundAdmissionFailure,
  type ForegroundReferenceDiagnostic, type ForegroundSchemaField, type ForegroundDiscardReason, type ForegroundSemanticDiscardReason } from "./foreground-action-admission";
import { formatCognitiveLocalView, isCognitiveLocalViewCurrent, getLocalDependencyCatalog, validateLocalDependencies } from "./cognitive-local-view";
import { FACIAL_EXPRESSIONS, formatAffectContext, prepareAffectUpdate, isPreparedAffectCurrent, commitPreparedAffectUpdate } from "./affect-state";
import { formatActorContinuation, integrateActorContinuation, snapshotActorContinuation, updateActorContinuation,
  prepareNextPurposeUpdate, formatNextPurpose, hasNextPurposeReview, reconsiderNextPurposeAfterWait } from "./actor-continuation";
import { formatActiveIntentions } from "./intention-context";
import { ACTIVITY_SITUATION_GUIDANCE } from "./activity-situation";
import { prepareForegroundMotorPlan } from "./foreground-motor-plan";
import { cognitionController, situatedPlanGoal, SITUATED_SELECTION } from "./decision-policy";
import { emotionalActivation, emotionalLifeBasis, formatEmotionalLife, nudgeEmotionalActivation, NARRATIVE_SELECTION_INSTRUCTION } from "./emotional-life";
import { appendNarrative, formatNarrativeMemory, formatIdentityAnchors, getIdentityAnchors } from "./narrative-memory";
import { recordAttentionSignal, snapshotAttentionSignals, hasDueAttentionSignal, formatAttentionSignals,
  prepareAttentionReview, markAttentionSignalsPresented, clearAttentionSignals, formatDueAttentionReview } from "./unresolved-attention";
import { captureActivityReview, formatActivityReview, prepareActivityReview, activityReviewEvidenceDiagnostic } from "./activity-review";
import { capturePlanDecisions, formatPlanDecisions, prepareForegroundPlanDecisionReview } from "./planner-decision";
import { getPlanForGoal } from "./plan-state";

const model = agentModel;

/** Temperature for agent cognition LLM calls. Lower values produce more
 *  reliable structured JSON output while still allowing some variety in
 *  dialogue and inner thoughts. */
const AGENT_COGNITION_TEMPERATURE = 0.3;

function getConfiguredGeminiApiKey(): string {
  const key = String(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      ""
  ).trim();
  // ai-sdk/google expects GOOGLE_GENERATIVE_AI_API_KEY; mirror other common env var names into it.
  if (key && !String(process.env.GOOGLE_GENERATIVE_AI_API_KEY || "").trim()) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = key;
  }
  return key;
}

// Deterministic speech reply guard for "no-LLM" mode:
// If an agent receives directed speech (Perception.type === "speech"), respond once to avoid dead conversations.
const recentSpeechReplies = new WeakMap<World, Map<number, { signature: string; atMs: number }>>();
function speechReplyCache(world: World) {
  let cache = recentSpeechReplies.get(world);
  if (!cache) { cache = new Map(); recentSpeechReplies.set(world, cache); }
  return cache;
}
const SPEECH_REPLY_DEDUP_WINDOW_MS = 30_000;


// Optional multimodal cognition: attach recently perceived image assets directly into Gemini context.
// Off by default for stability + cost control.
const recentMultimodalImageAttachment = new Map<number, { signature: string; atMs: number }>();
const MULTIMODAL_IMAGE_DEDUP_WINDOW_MS = 60_000;

// Optional image reflection: trigger a single short multimodal critique when a new image asset is perceived.
// This is separate from action selection (plans/contracts still drive actions) and is off by default.
const imageReflections = new WeakMap<World, Map<number, { signature: string; atMs: number }>>();
function reflectionCache(world: World) {
  let cache = imageReflections.get(world);
  if (!cache) { cache = new Map(); imageReflections.set(world, cache); }
  return cache;
}
const MULTIMODAL_IMAGE_REFLECTION_DEDUP_WINDOW_MS = 5 * 60_000;

function parseCsvEnv(name: string): string[] {
  const raw = String(process.env[name] || "");
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function shouldAttachMultimodalImages(agentEid: number): boolean {
  if (process.env.COGNITION_ENABLE_MULTIMODAL_IMAGES !== "1") return false;
  const roles = parseCsvEnv("COGNITION_MULTIMODAL_IMAGE_ROLES");
  if (roles.length) {
    const role = String(Agent.role[agentEid] || "").trim().toLowerCase();
    if (!roles.includes(role)) return false;
  }
  return true;
}

function shouldGenerateImageReflection(agentEid: number): boolean {
  if (process.env.COGNITION_ENABLE_IMAGE_REFLECTION !== "1") return false;
  if (!shouldAttachMultimodalImages(agentEid)) return false;
  const roles = parseCsvEnv("COGNITION_IMAGE_REFLECTION_ROLES");
  const role = String(Agent.role[agentEid] || "").trim().toLowerCase();
  if (roles.length) return roles.includes(role);
  // Sensible default: keep it low-volume unless explicitly expanded.
  return role === "ceo" || role === "designer";
}

function parseImageAssetStimulus(content: string): { deviceName?: string; paths: string[] } {
  const text = String(content || "");
  // Expected: "<actor> produced a new image asset on <Device>: path1, path2. ..."
  const m = text.match(/image asset(?:\s+on\s+([^:]+))?:\s*(.+?)(?:\.\s|$)/i);
  const deviceName = m && m[1] ? String(m[1]).trim() : undefined;
  const list = m && m[2] ? String(m[2]) : "";
  const paths = list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("workspace://") ? p.slice("workspace://".length) : p));
  return { deviceName, paths };
}

function findDeviceInRoom(world: World, agentEid: number, deviceName: string): number | undefined {
  const roomEid = getRoomForEntity(world as any, agentEid);
  if (roomEid === undefined) return undefined;
  const wanted = String(deviceName || "").trim().toLowerCase();
  if (!wanted) return undefined;
  for (const child of listDirectContents(world as any, roomEid)) {
    const n = String(Name.value[child] || "").trim().toLowerCase();
    if (n && n === wanted) return child;
  }
  return undefined;
}

function readWorkspaceImageBytes(world: World, deviceEid: number, relPath: string): { data: Buffer; mediaType: string } | null {
  const base = ensureOfficeDeviceSandboxDir(world, deviceEid);
  const cleaned = path.normalize(String(relPath || "").trim()).replace(/^(\.\.[/\\])+/, "");
  const abs = path.resolve(base, cleaned);
  if (!abs.startsWith(base + path.sep) && abs !== base) return null;

  try {
    const stat = fs.statSync(abs);
    // Hard cap to avoid blowing up prompt sizes.
    if (stat.size > 2 * 1024 * 1024) return null;
    const data = fs.readFileSync(abs);
    const ext = path.extname(cleaned).toLowerCase();
    const mediaType =
      ext == ".png"
        ? "image/png"
        : ext == ".jpg" || ext == ".jpeg"
          ? "image/jpeg"
          : ext == ".webp"
            ? "image/webp"
            : ext == ".gif"
              ? "image/gif"
              : "application/octet-stream";
    return { data, mediaType };
  } catch {
    return null;
  }
}

function buildUserContentWithImages(world: World, agentEid: number, prompt: string, trackAttachment = true): { content: any; attached: string[] } {
  if (!shouldAttachMultimodalImages(agentEid)) return { content: prompt, attached: [] };

  const max = Number.isFinite(Number(process.env.COGNITION_MULTIMODAL_IMAGE_MAX))
    ? Math.max(1, Math.min(3, Number(process.env.COGNITION_MULTIMODAL_IMAGE_MAX)))
    : 1;

  const now = Date.now();
  const perceptions = getAgentPerceptions(world as any, agentEid)
    .filter((peid) => String(Perception.type[peid] || "") === "image_asset")
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 3);

  const parts: any[] = [{ type: "text", text: prompt }];
  const attached: string[] = [];

  for (const peid of perceptions) {
    const at = Number(Perception.timestamp[peid] || 0);
    if (!at || simulationAge(world, peid, "Perception.timestamp", at) > 120_000) continue;

    const parsed = parseImageAssetStimulus(String(Perception.content[peid] || ""));
    const deviceName = parsed.deviceName || "Workstation";
    const deviceEid = findDeviceInRoom(world, agentEid, deviceName);
    if (deviceEid === undefined) continue;

    for (const relPath of parsed.paths) {
      if (attached.length >= max) break;

      const signature = `${deviceEid}|${relPath}`;
      const prev = recentMultimodalImageAttachment.get(agentEid);
      if (trackAttachment && prev && prev.signature == signature && now - prev.atMs < MULTIMODAL_IMAGE_DEDUP_WINDOW_MS) continue;

      const img = readWorkspaceImageBytes(world, deviceEid, relPath);
      if (!img) continue;

      parts.push({ type: "image", image: img.data, mediaType: img.mediaType });
      attached.push(`${deviceName}:${relPath}`);
      if (trackAttachment) recentMultimodalImageAttachment.set(agentEid, { signature, atMs: now });
    }

    if (attached.length >= max) break;
  }

  if (attached.length === 0) return { content: prompt, attached };
  return { content: parts, attached };
}

function pendingImageReflection(world: World, agentEid: number): { signature: string; latest: number } | undefined {
  if (!entityExists(world, agentEid) || !Agent.active[agentEid] || world.meta.aiEnabled === false || !getConfiguredGeminiApiKey()) return;
  if (process.env.COGNITION_DISABLE_LLM_IMAGE_REFLECTION === "1") return;
  if (!shouldGenerateImageReflection(agentEid)) return;
  if (hasComponent(world as any, agentEid, PendingToolJob as any)) return;

  const now = Date.now();
  const latest = getAgentPerceptions(world as any, agentEid)
    .filter((peid) => String(Perception.type[peid] || "") === "image_asset")
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))[0];

  if (typeof latest !== "number") return;
  const at = Number(Perception.timestamp[latest] || 0);
  if (!at || simulationAge(world, latest, "Perception.timestamp", at) > 120_000) return;

  const parsedSig = parseImageAssetStimulus(String(Perception.content[latest] || ""));
  const signature = `${String(Perception.source[latest] || "")}|${String(parsedSig.deviceName || "Workstation")}|${parsedSig.paths.slice(0, 3).join(",")}`;
  const prev = reflectionCache(world).get(agentEid);
  if (prev && prev.signature === signature && now - prev.atMs < MULTIMODAL_IMAGE_REFLECTION_DEDUP_WINDOW_MS) return;
  return { signature, latest };
}

export function hasPendingImageReflection(world: World, agentEid: number): boolean {
  return Boolean(pendingImageReflection(world, agentEid));
}

/** Background-only image critique; never awaited by immediate action selection. */
export async function maybeAddImageReflectionThought(world: World, agentEid: number): Promise<void> {
  const pending = pendingImageReflection(world, agentEid);
  if (!pending) return;
  assertSimulationTaskActive();
  const { signature, latest } = pending;
  const identity = JSON.stringify([Name.value[agentEid], Agent.role[agentEid], Agent.systemPrompt[agentEid], getAspirations(world, agentEid)]);
  const source = Perception.content[latest];
  const now = Date.now();
  // Claim before awaiting, including for direct callers outside the scheduler.
  reflectionCache(world).set(agentEid, { signature, atMs: now });

  const prompt =
    `You have just perceived a new visual asset in your environment.
` +
    `Describe what you can see and whether it matters to your current work. If improvement is relevant, suggest up to three concrete changes.
` +
    `Distinguish visible details from inference. Keep the reflection brief; an unfamiliar image need not become a design assignment.`;

  const mm = buildUserContentWithImages(world, agentEid, prompt, false);
  if (mm.attached.length === 0) {
    // Mark as handled to avoid noisy repeat attempts when the asset can't be attached.
    return;
  }

  const context = buildAgentContext(world, agentEid);
  const loggedPrompt = `${prompt}

[Images attached: ${mm.attached.join(", ")}]`;

  try {
    const deadline = AbortSignal.timeout(12_000);
    const parent = getSimulationTaskSignal();
    const signal = parent ? AbortSignal.any([parent, deadline]) : deadline;
    const { text } = await generateText({
      model,
      system: context,
      messages: [{ role: "user" as const, content: mm.content }],
      abortSignal: signal, maxOutputTokens: 900, maxRetries: 0,
    });
    signal.throwIfAborted();
    assertSimulationTaskActive();
    if (!entityExists(world, agentEid) || !Agent.active[agentEid] || world.meta.aiEnabled === false ||
        identity !== JSON.stringify([Name.value[agentEid], Agent.role[agentEid], Agent.systemPrompt[agentEid], getAspirations(world, agentEid)]) ||
        !hasComponent(world, latest, Perception) || Perception.content[latest] !== source) return;
    addConversationTurn(world, agentEid, "user", loggedPrompt);
    addConversationTurn(world, agentEid, "assistant", text);
    addThought(world, agentEid, { content: text, type: "visual_reflection" });
  } catch {
    // Best effort, bounded and off the action path. Failed work remains deduplicated.
  }
}

// Valid action types - expanded to match all handlers in cognition-system.ts
export type ValidActionType =
  | "speak" | "observe" | "move" | "interact" | "think" | "wait"  // Core
  | "attack" | "defend"                                           // Combat
  | "pickup" | "drop" | "use" | "give" | "examine"                // Inventory
  | "rest" | "reflect";                                           // Self

export interface AgentAction {
  type: ValidActionType;
  target?: string;
  content?: string;
  /** Deliberate urgent overlap is distinct from taking a normal conversational turn. */
  speechMode?: "turn" | "interrupt";
  /** Explicit auditory wait for an already heard, currently audible execution. */
  listeningTo?: string;
  /** Explicit personally grounded condition; never a model-provided runtime token. */
  waitUntil?: PlanWaitUntil;
  /** Exact own voice observed at issuance; never accepted as a model-provided ID. */
  stopSpeechId?: string;
  /** Engine-validated own intention episode; never copied from model JSON. */
  coordinationGoal?: CoordinationGoalRef;
  /** Engine-issued identity of the particular promise pursued by this action. */
  coordinationWork?: CoordinationWorkRef;
  /** Assigned by execution, never by cognition. Packages return this exact
   * operation identity when reporting a terminal result, including retries. */
  executionId?: string;
  /** Private foreground issuance marker. Only the original in-process action
   * object can consume it; model JSON and restored/copied markers cannot. */
  readonly foregroundDecisionId?: string;
}

const coordinationWorkActions = new Set<ValidActionType>(["move", "pickup", "drop", "give", "use", "interact", "attack", "observe", "examine"]);

/** Read-only selection normalization. Run before source admission; do not record
 * behavior or policy metrics while considering a proposal that may be stale. */
function normalizeActionSelection(world: World, agentEid: number, action: AgentAction): AgentAction {
  if (action.type === "move" && action.target) {
    const wanted = String(action.target || "").trim().toLowerCase();
    // Validate target is actually a room — reject moves to objects/agents/etc.
    const allRooms = Array.from(query(world as any, [Room as any, Name as any]));
    const isRoom = allRooms.some(rid => {
      const rn = String(Name.value[rid] || "").trim().toLowerCase();
      return rn && rn === wanted;
    });
    if (!isRoom) {
      return normalizeActionSelection(world, agentEid, { type: "observe", target: action.target });
    }

    const capabilities = getAgentWorldCapabilities(world, agentEid);
    if (capabilities?.busy()) return { type: "wait" };
    const roomEid = getRoomForEntity(world, agentEid);
    const currentRoomName = roomEid === undefined ? "" : String(Name.value[roomEid] || "").trim().toLowerCase();
    // The executor acknowledges an already-satisfied move. Replacing a planned
    // move with wait prevents its step from ever receiving completion evidence.
    if (currentRoomName === wanted) return action;

    if (!capabilities?.ownsMovement) {
      const movTarget = getMovementTarget(agentEid);
      if (movTarget !== undefined && entityExists(world, movTarget) && hasComponent(world, movTarget, GridPosition)
        && movTarget !== roomEid) {
        return { type: "wait" };
      }

      // Only the no-AI/legacy goal pursuer turns goal activation into transit.
      // Live schedule/need goals are candidates, not in-flight journeys, and
      // cannot veto this actor's admitted move. An actual native grid target
      // still guards an ongoing journey above.
      const goalEids = world.meta.aiEnabled === true ? [] : getRelationTargets(world, agentEid, HasGoal);
      for (const gid of goalEids) {
        if (!entityExists(world, gid) || !hasComponent(world, gid, Goal)
          || Goal.status[gid] !== "active" || Goal.kind[gid] !== "move_to_room") continue;
        try {
          const params = JSON.parse(Goal.paramsJson[gid] || "{}");
          const targetName = typeof params?.roomName === "string" ? params.roomName.trim().toLowerCase() : "";
          if (!targetName) continue;
          const targetRoom = allRooms.find(rid => String(Name.value[rid] || "").trim().toLowerCase() === targetName);
          if (targetRoom !== undefined && targetRoom !== roomEid) return { type: "wait" };
        } catch {
          // Malformed intent cannot be evidence of an in-flight journey.
        }
      }
    }
  }


  // Clean up target names: strip trailing punctuation from observe/interact targets
  // (recovery system and LLM sometimes append periods from parsed messages)
  if ((action.type === "observe" || action.type === "interact") && action.target) {
    const cleaned = action.target.replace(/[.!?,;:]+$/, "").trim();
    if (cleaned !== action.target) {
      action = { ...action, target: cleaned };
    }
  }

  // Suppress self-targeting: agents should not observe/interact with themselves.
  if ((action.type === "observe" || action.type === "interact") && action.target) {
    const agentName = String(Name.value[agentEid] || "").trim().toLowerCase();
    const targetName = String(action.target || "").trim().toLowerCase();
    if (agentName && targetName && agentName === targetName) {
      // Redirect self-observe to room observation
      if (action.type === "observe") {
        const roomEid = getRoomForEntity(world as any, agentEid);
        const roomName = roomEid !== undefined ? String(Name.value[roomEid] || "").trim() : "";
        return { type: "observe", target: roomName || "surroundings" };
      }
      return { type: "wait" };
    }
  }

  // Suppress duplicate async tool actions when a PendingToolJob is already in-flight.
  // Without this, LLM agents may repeatedly choose the same tool action every tick while the job is running.
  if (action.type === "interact" && typeof action.content === "string" && action.content.trim() && hasComponent(world as any, agentEid, PendingToolJob as any)) {
    const token = action.content.trim().split(/\s+/)[0] || "";
    const aff = token.trim().toLowerCase().replace(/[^a-z0-9_-]+$/g, "");
    const expectedToolId =
      aff === "run_command"
        ? "terminal.run"
        : aff === "gemini_cli"
          ? "gemini.cli"
          : aff === "generate_image"
            ? "nano_banana.generate_image"
            : aff === "edit_image"
              ? "nano_banana.edit_image"
              : aff === "describe_image"
                ? "vision.describe_image"
                : aff === "git_apply_from_last_gemini"
                  ? "workspace.git_apply_from_last_gemini"
                  : "";

    if (expectedToolId && String(PendingToolJob.toolId[agentEid] || "") === expectedToolId) {
      return { type: "wait" };
    }
  }

  return action;
}

function recordSelectedAction(world: World, agentEid: number, action: AgentAction, wasLlmFallback: boolean): void {
  // Record action for The Watcher's behavioral analysis
  try {
    recordAgentAction(agentEid, action.type, world);
  } catch {}

  // Record action for policy effectiveness metrics
  try {
    recordPolicyAction(agentEid, action.type, wasLlmFallback);
  } catch {}

}

function normalizeSelectedAction(world: World, agentEid: number, action: AgentAction, wasLlmFallback: boolean = false): AgentAction {
  const selected = normalizeActionSelection(world, agentEid, action);
  recordSelectedAction(world, agentEid, selected, wasLlmFallback);
  return selected;
}

const attentionTypes = new Set(["attention", "daemon_whisper", "daemon_challenge", "intent", "directed_speech", "speech", "speech_fragment", "danger", "action_failed"]);
const attendedPerceptions = new WeakMap<World, Set<string>>();
const perceptionHearing = new WeakMap<World, Map<number, HeardSpeechProgress>>();
const observedAttentionSignals = new WeakMap<World, Set<string>>();
const perceptionAdmissionOrder = new WeakMap<World, Map<number, number>>();
const nextPerceptionAdmission = new WeakMap<World, number>();
function attentionKey(agentEid: number, perceptionEid: number): string {
  return `${agentEid}:${perceptionEid}:${Perception.timestamp[perceptionEid]}:${Perception.content[perceptionEid]}`;
}

/** Delivered attention is distinct from queue occupancy and action completion. */
export function hasUnintegratedAttention(world: World, eid: number, includeDueSignals = true): boolean {
  if (world.meta.aiEnabled === false || !getConfiguredGeminiApiKey()) return false;
  const seen = attendedPerceptions.get(world);
  return (includeDueSignals && hasDueAttentionSignal(world, eid))
    || getAgentPerceptions(world, eid).some(pid => attentionTypes.has(Perception.type[pid]) && !seen?.has(attentionKey(eid, pid))
      && !(Perception.type[pid] === "speech_fragment" && isContinuingListeningProgress(world, eid,
        { type: Perception.type[pid], source: Perception.source[pid], content: Perception.content[pid], hearing: perceptionHearing.get(world)?.get(pid) })));
}

function contextPerceptions(world: World, eid: number): number[] {
  const allPerceptions = getAgentPerceptions(world, eid);
  const admissions = perceptionAdmissionOrder.get(world);
  // IDs may be recycled. Equal-time frames admitted in this process retain
  // actual event order; restored legacy frames use the existing stable ID tie.
  const newestFirst = (a: number, b: number) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0)
    || (admissions?.get(b) || 0) - (admissions?.get(a) || 0) || b - a;
  // A rolling sensory frame replaces an older frame in the current-context
  // projection. Keep actual events (speech, attention, action receipts) intact:
  // this is neither memory deletion nor free-text deduplication.
  const isSensoryFrame = (pid: number) => Perception.type[pid] === "perception" && Perception.source[pid] === "senses";
  const latestFrame = allPerceptions.filter(isSensoryFrame).sort(newestFirst)[0];
  const perceptions = allPerceptions.filter(pid => !isSensoryFrame(pid) || pid === latestFrame);
  const seen = attendedPerceptions.get(world);
  const unconsidered = perceptions.filter(pid => attentionTypes.has(Perception.type[pid]) && !seen?.has(attentionKey(eid, pid)))
    .sort(newestFirst).slice(0, 6);
  return [...new Set([...unconsidered, ...perceptions.sort(newestFirst).slice(0, 5)])];
}

/** Delivery signals still receive attention, but committed words need appear
 * only once. Match the executor's exact envelopes, never summarize free text. */
function formatContextPerceptions(world: World, eid: number, perceptions: number[]): string {
  const dialogue = getSocialDialogue(world, eid).slice(-14);
  const lines = perceptions.map(pid => {
    const content = Perception.content[pid], source = Perception.source[pid];
    const duplicate = [...dialogue].reverse().find(turn => {
      const elapsed = Perception.timestamp[pid] - turn.atMs;
      if (elapsed < 0 || elapsed > 5000) return false;
      return turn.own ? source === "speech" && content === `You say: "${turn.content}"`
        : source === turn.speaker && (content === `${turn.speaker} says: "${turn.content}"`
          || content === `${turn.speaker} says to you: "${turn.content}"`);
    });
    if (duplicate) return `[speech delivered: ${duplicate.id}; exact words in dialogue recall]`;
    return `[${Perception.type[pid]}, ${Math.round(simulationAge(world, pid, "Perception.timestamp", Perception.timestamp[pid]) / 1000)}s ago] ${content} (from: ${source})`;
  });
  return lines.length ? [...new Set(lines)].join("\n") : "Nothing notable recently.";
}

function refersToPerson(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(escaped) && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

export function getAgentThoughts(world: World, agentEid: number): number[] {
  const thoughtEids = getRelationTargets(world, agentEid, HasThought);
  return thoughtEids.filter(eid => hasComponent(world, eid, Thought));
}

export function getAgentPerceptions(world: World, agentEid: number): number[] {
  const perceptionEids = getRelationTargets(world, agentEid, HasPerception);
  return perceptionEids.filter(eid => hasComponent(world, eid, Perception));
}

export function getAgentConversation(world: World, agentEid: number): number[] {
  const turnEids = getRelationTargets(world, agentEid, HasConversation);
  return turnEids
    .filter(eid => hasComponent(world, eid, ConversationTurn))
    .sort((a, b) => (ConversationTurn.timestamp[a] || 0) - (ConversationTurn.timestamp[b] || 0));
}

export function clearAllAgentMemory(world: World): void {
  clearAttentionSignals(world);
  attendedPerceptions.delete(world);
  perceptionHearing.delete(world);
  observedAttentionSignals.delete(world);
  perceptionAdmissionOrder.delete(world);
  nextPerceptionAdmission.delete(world);
  const agents = Array.from(query(world, [Agent]));
  for (const agentEid of agents) {
    const thoughts = getAgentThoughts(world, agentEid);
    const perceptions = getAgentPerceptions(world, agentEid);
    const conversation = getAgentConversation(world, agentEid);
    
    for (const eid of [...thoughts, ...perceptions, ...conversation]) {
      removeEntity(world, eid);
    }
  }
}

export function addPerception(
  world: World,
  agentEid: number,
  data: { type: string; content: string; source: string; intensity?: number; timestamp?: number; signalKey?: string; hearing?: HeardSpeechProgress }
): number {
  assertSimulationTaskActive();
  if (isInvalidHeardSpeechNotice(world, agentEid, data)) return -1;
  // A trusted sensory producer may identify repeated emissions of one signal.
  // Keep every audible/visible occurrence, but only its first perception is a
  // new interruption. Never infer identity from equal wording (or suppress
  // dangers). Identity is actor- and runtime-scoped, not shared knowledge.
  if (data.type === "attention" && data.signalKey) {
    recordAttentionSignal(world, agentEid, { source: data.source, signalKey: data.signalKey, content: data.content });
    let signals = observedAttentionSignals.get(world);
    if (!signals) { signals = new Set(); observedAttentionSignals.set(world, signals); }
    const key = JSON.stringify([getCommittedEvents(world).sourceId ?? startCommittedEvents(world), workingMemoryEntityRef(world, agentEid)?.key || agentEid, data.source, data.signalKey]);
    if (signals.has(key)) data = { ...data, type: "observation" };
    else signals.add(key);
    if (signals.size > 1000) { const retained = [...signals].slice(-500); signals.clear(); retained.forEach(id => signals!.add(id)); }
  }
  // Sensory refresh volume is not emotional intensity. A furnished room used
  // to drive arousal to 1.0 just by listing its objects on every decision.
  const salient = ["attention", "directed_speech", "speech", "action_failed", "danger", "daemon_challenge"].includes(data.type)
    && data.source !== "physical world";
  const repeated = getAgentPerceptions(world, agentEid).some(id => Perception.type[id] === data.type &&
    Perception.content[id] === data.content && simulationAge(world, id, "Perception.timestamp", Perception.timestamp[id]) < 30000);
  if (!repeated && (salient || ["intent", "injected_thought", "daemon_whisper", "rest_complete", "tool_result"].includes(data.type))) wakeForegroundCognition(world, agentEid, { cause: "stimulus", stimulusType: data.type });
  if (salient && hasComponent(world, agentEid, Mind)) {
    if (!repeated) {
      const impulse = 0.1 * Math.max(0, Math.min(1, data.intensity ?? 1));
      if (world.meta.narrativeMind) nudgeEmotionalActivation(world, agentEid, impulse);
      else Mind.arousal[agentEid] = Math.min(1, (Mind.arousal[agentEid] ?? 0.5) + impulse);
    }
  }
  const perceptionEid = addEntity(world);
  addComponent(world, perceptionEid, Perception);
  addComponent(world, agentEid, HasPerception(perceptionEid));

  Perception.type[perceptionEid] = data.type;
  Perception.content[perceptionEid] = data.content;
  Perception.source[perceptionEid] = data.source;
  Perception.intensity[perceptionEid] = data.intensity ?? 1;
  Perception.timestamp[perceptionEid] = Number.isFinite(data.timestamp) ? data.timestamp! : Date.now();
  let hearing = perceptionHearing.get(world);
  hearing?.delete(perceptionEid);
  if (data.type === "speech_fragment" && data.hearing) {
    if (!hearing) { hearing = new Map(); perceptionHearing.set(world, hearing); }
    hearing.set(perceptionEid, data.hearing);
  }
  stampSimulationTime(world, perceptionEid, "Perception.timestamp", Perception.timestamp[perceptionEid],
    readSimulationTime(world) - Math.max(0, Date.now() - Perception.timestamp[perceptionEid]));
  const admission = (nextPerceptionAdmission.get(world) || 0) + 1;
  nextPerceptionAdmission.set(world, admission);
  let admissions = perceptionAdmissionOrder.get(world);
  if (!admissions) { admissions = new Map(); perceptionAdmissionOrder.set(world, admissions); }
  admissions.set(perceptionEid, admission);

  prunePerceptions(world, agentEid, 20);
  getAgentWorldCapabilities(world, agentEid)?.onPerception?.(perceptionEid, data.content, data.type, data.source);

  return perceptionEid;
}

function prunePerceptions(world: World, agentEid: number, maxPerceptions: number): void {
  const perceptionEids = getAgentPerceptions(world, agentEid);
  if (perceptionEids.length <= maxPerceptions) return;

  // A furnished room can emit dozens of routine observations. Keep a small
  // bounded attention reserve so those descriptions cannot erase an unread
  // interruption before the character gets a turn to consider it.
  const important = new Set(perceptionEids.filter(id => attentionTypes.has(Perception.type[id]))
    .sort((a, b) => Perception.timestamp[b] - Perception.timestamp[a] || b - a).slice(0, 6));
  const sorted = perceptionEids.sort((a, b) => Number(important.has(a)) - Number(important.has(b)) ||
    (Perception.timestamp[a] || 0) - (Perception.timestamp[b] || 0));

  const toRemove = sorted.slice(0, sorted.length - maxPerceptions);
  for (const eid of toRemove) {
    perceptionAdmissionOrder.get(world)?.delete(eid);
    perceptionHearing.get(world)?.delete(eid);
    removeEntity(world, eid);
  }
}

export function addThought(
  world: World,
  agentEid: number,
  data: { content: string; type?: string; salience?: number; observedAtSimMs?: number }
): number {
  assertSimulationTaskActive();
  // Check if agent entity still exists before trying to add components
  if (!hasComponent(world, agentEid, Agent)) {
    console.warn(`[AgentMind] Cannot add thought - agent entity ${agentEid} no longer exists`);
    return -1;
  }

  const thoughtEid = addEntity(world);
  addComponent(world, thoughtEid, Thought);
  addComponent(world, agentEid, HasThought(thoughtEid));

  Thought.content[thoughtEid] = data.content;
  Thought.type[thoughtEid] = data.type || "reflection";
  Thought.salience[thoughtEid] = data.salience ?? 0.5;
  Thought.timestamp[thoughtEid] = Date.now();
  stampSimulationTime(world, thoughtEid, "Thought.timestamp", Thought.timestamp[thoughtEid]);
  Thought.observedAtSimMs[thoughtEid] = data.observedAtSimMs ?? -1;

  // Only admitted self-authored reasoning is autobiography. A planted whisper
  // is somebody else's input, and a proposed action is not an executed event.
  if (data.type === "reasoning") appendNarrative(world, agentEid, {
    kind: "thought", monologue: data.content, importance: data.salience ?? .5,
    sourceAtSimMs: data.observedAtSimMs ?? readSimulationTime(world),
    evidence: [{ id: `thought:${getCommittedEvents(world).sourceId}:${thoughtEid}:${Thought.timestamp[thoughtEid]}`,
      kind: "thought", content: data.content, atSimMs: data.observedAtSimMs ?? readSimulationTime(world) }],
  });

  pruneThoughts(world, agentEid, 10);
  // Notification hooks observe a durable thought; they cannot veto it after
  // its ECS write or turn a committed foreground choice into a rejected action.
  try { getAgentWorldCapabilities(world, agentEid)?.onThought?.(thoughtEid, data.content, data.type || "reflection"); }
  catch { console.warn("[AgentMind] Thought notification failed after admission."); }

  return thoughtEid;
}

function pruneThoughts(world: World, agentEid: number, maxThoughts: number): void {
  const thoughtEids = getAgentThoughts(world, agentEid);
  if (thoughtEids.length <= maxThoughts) return;

  const sorted = thoughtEids.sort((a, b) => 
    (Thought.timestamp[a] || 0) - (Thought.timestamp[b] || 0)
  );

  const toRemove = sorted.slice(0, sorted.length - maxThoughts);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

export function addConversationTurn(
  world: World,
  agentEid: number,
  role: "user" | "assistant",
  content: string
): number {
  const turnEid = addEntity(world);
  addComponent(world, turnEid, ConversationTurn);
  addComponent(world, agentEid, HasConversation(turnEid));

  ConversationTurn.role[turnEid] = role;
  ConversationTurn.content[turnEid] = content;
  ConversationTurn.timestamp[turnEid] = Date.now();
  stampSimulationTime(world, turnEid, "ConversationTurn.timestamp", ConversationTurn.timestamp[turnEid]);

  pruneConversation(world, agentEid, 20);

  return turnEid;
}

function pruneConversation(world: World, agentEid: number, maxTurns: number): void {
  const turnEids = getAgentConversation(world, agentEid);
  if (turnEids.length <= maxTurns) return;

  const toRemove = turnEids.slice(0, turnEids.length - maxTurns);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

function buildKnowledgeContext(world: World, eid: number, othersInRoom: string[]): string {
  const lines: string[] = [];
  
  const recallContext = [
    Mind.focus[eid] || "",
    ...getRelationTargets(world, eid, HasGoal).filter(gid => hasComponent(world, gid, Goal) && ["active", "in_progress"].includes(Goal.status[gid]))
      .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0)).slice(0, 3).map(gid => Goal.description[gid]),
    ...contextPerceptions(world, eid).map(pid => Perception.content[pid]),
  ].join("\n");
  const knowledgeSummary = getKnowledgeSummary(world, eid, { context: recallContext });
  if (knowledgeSummary) {
    lines.push("LONG-TERM KNOWLEDGE:");
    lines.push(knowledgeSummary);
  }

  const skills = formatProceduralSkillsForContext(world, eid);
  if (skills) {
    lines.push("");
    lines.push(skills);
  }

  const policy = formatBehaviorPolicyForContext(world, eid);
  if (policy) {
    lines.push("");
    lines.push(policy);
  }
  
  if (othersInRoom.length > 0) {
    lines.push("\nIMPRESSIONS OF THOSE PRESENT:");
    for (const otherName of othersInRoom) {
      const impression = getImpressionOf(world, eid, otherName);
      if (impression) {
        const sentiment = impression.overallSentiment > 0.2 ? "positive" : 
                         impression.overallSentiment < -0.2 ? "negative" : "neutral";
        const traits = impression.traits.map(t => t.trait).join(", ");
        lines.push(`  ${otherName}: ${sentiment} (${traits})`);
      } else {
        lines.push(`  ${otherName}: no prior impression`);
      }
    }
  }
  
  return lines.join("\n");
}

function buildSocialContext(world: World, agentEid: number, othersInRoom: string[]): string {
  if (othersInRoom.length === 0) return getAgentSensoryCapabilities(world, agentEid).visual > 0
    ? "No one else is visible here." : "Other people's current presence is not established through sight; spoken exchanges remain in dialogue recall.";

  const lines: string[] = [];
  const dialogue = getSocialDialogue(world, agentEid);
  // Observed exchanges, not prompt mentions or a turn-count trust ladder.
  for (const otherName of othersInRoom) {
    const impression = getImpressionOf(world, agentEid, otherName);

    // Model prompts mentioning a name are not encounters with that person.
    const conversationDepth = dialogue.filter(turn => turn.speaker === otherName || turn.own && turn.target === otherName).length;

    if (impression) {
      const s = impression.overallSentiment;
      const feel = s > 0.3 ? "positively" : s < -0.3 ? "warily" : "neutrally";
      lines.push(`- ${otherName}: You feel ${feel} toward them. ${conversationDepth} recorded spoken turns involving them.`);
    } else {
      lines.push(`- ${otherName}: ${conversationDepth ? `You have ${conversationDepth} recorded spoken turns involving them.` : "No spoken exchange recorded here yet; your own memories may establish an earlier acquaintance."}`);
    }

  }

  return lines.join("\n");
}

/** Read-only diagnostic projection of the exact context supplied to cognition. */
export function buildAgentContext(world: World, eid: number): string {
  const shownActionReceipts = getWorkingMemory(world, eid).receipts.filter(r => r.kind === "action").slice(-8).map(r => r.id);
  const name = Name.value[eid];
  const description = Description.value[eid];
  const role = Agent.role[eid];
  const systemPrompt = Agent.systemPrompt[eid];
  const mode = Mind.mode[eid];
  const arousal = world.meta.narrativeMind ? emotionalActivation(world, eid) : Mind.arousal[eid];
  const focus = Mind.focus[eid];

  const roomEid = getRoomForEntity(world, eid);
  const canSee = getAgentSensoryCapabilities(world, eid).visual > 0;
  let roomContext = "nowhere in particular";
  let roomDescription = "";
  let roomAmbience = "";
  let othersInRoom: string[] = [];
  let objectsInRoom: string[] = [];

  if (roomEid !== undefined) {
    roomContext = Name.value[roomEid] || "an unknown room";
    roomDescription = canSee && hasComponent(world, roomEid, Description) ? Description.value[roomEid] || "" : "";
    // Authored ambience is unstructured mixed sensory prose. The sensory system
    // separately admits audible/olfactory channels when vision is unavailable.
    roomAmbience = canSee && hasComponent(world, roomEid, Room) ? Room.ambience[roomEid] || "" : "";

  }
  const visible = getAgentVisualEntities(world, eid);
  for (const child of visible) {
    if (child !== eid && hasComponent(world, child, Agent) && Name.value[child]) othersInRoom.push(Name.value[child]);
  }
  // Scene membership uses actual sight; direct own possessions remain known by
  // touch without exposing a concealed person's inventory or an opaque box.
  for (const child of new Set([...visible, ...getAgentTangibleEntities(world, eid)])) {
    if (child === eid) continue;
    if (hasComponent(world, child, Agent)) continue; // Skip other agents (listed separately)
    const objName = Name.value[child];
    if (objName) objectsInRoom.push(objName);
  }

  // Keeping an interruption in ECS is useless if the prompt's last-five slice
  // hides it. Reserve context slots for unconsidered signals as well as new senses.
  const recentPerceptions = contextPerceptions(world, eid);

  const thoughtEids = getAgentThoughts(world, eid);
  const recentThoughts = thoughtEids
    .sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))
    .slice(0, 3);

  // Get personality traits if present
  const hasPersonality = hasComponent(world, eid, Personality);
  const personalityTraits = hasPersonality ? {
    openness: Personality.openness[eid] ?? 0.5,
    conscientiousness: Personality.conscientiousness[eid] ?? 0.5,
    extraversion: Personality.extraversion[eid] ?? 0.5,
    agreeableness: Personality.agreeableness[eid] ?? 0.5,
    neuroticism: Personality.neuroticism[eid] ?? 0.5,
  } : null;

  // Format personality as natural language
  const formatPersonality = (traits: typeof personalityTraits): string => {
    if (!traits) return "";
    const descriptions: string[] = [];
    if (traits.openness > 0.7) descriptions.push("curious and creative");
    else if (traits.openness < 0.3) descriptions.push("practical and conventional");
    if (traits.conscientiousness > 0.7) descriptions.push("organized and disciplined");
    else if (traits.conscientiousness < 0.3) descriptions.push("flexible and spontaneous");
    if (traits.extraversion > 0.7) descriptions.push("outgoing and energetic");
    else if (traits.extraversion < 0.3) descriptions.push("reserved and reflective");
    if (traits.agreeableness > 0.7) descriptions.push("cooperative and trusting");
    else if (traits.agreeableness < 0.3) descriptions.push("competitive and skeptical");
    if (traits.neuroticism > 0.7) descriptions.push("sensitive and prone to worry");
    else if (traits.neuroticism < 0.3) descriptions.push("calm and emotionally stable");
    return descriptions.length > 0 ? descriptions.join(", ") : "balanced temperament";
  };

  // Persona leads. The engine, not this prose, decides what actually happened:
  // admission fences, native receipts and privacy projection enforce truth, so
  // the character is told who they are and what is in front of them, not
  // reminded at every heading what does not count as proof.
  const appearance = description && !/^An adult resident in a simple everyday outfit\.?$/i.test(description.trim()) ? description : "";
  return `You are ${name}${role ? `, ${role}` : ""}.

WHO YOU ARE:
${systemPrompt}
${appearance ? `How you look: ${appearance}\n` : ""}${personalityTraits ? `Temperament: ${formatPersonality(personalityTraits)}\n` : ""}
${formatCharacterMotivations(world, eid)}

${formatIdentityAnchors(world, eid, [roomContext, focus, ...recentPerceptions.map(id => Perception.content[id])].join(" "))}
${formatNarrativeMemory(world, eid)}
${formatEmotionalLife(world, eid)}
${formatAffectContext(world, eid)}

${formatPersonalConcerns(world, eid)}

${formatReflectionQuestions(world, eid)}

WHAT YOU WANT RIGHT NOW:
${formatActiveIntentions(world, eid)}
${ACTIVITY_SITUATION_GUIDANCE}

${formatOngoingActivity(world, eid)}
${formatActorContinuation(world, eid)}

${formatWaitExperience(world, eid)}

${formatActorWait(world, eid)}

${formatAttentionSignals(world, eid)}

WHERE YOU ARE:
- ${roomContext}${roomDescription ? ` — ${roomDescription}` : ""}
- With you: ${othersInRoom.length > 0 ? othersInRoom.join(", ") : canSee ? "no one" : "you can't see who is here"}
- Around you: ${objectsInRoom.length > 0 ? objectsInRoom.join(", ") : canSee ? "nothing notable" : "you can't see what is here"}
${roomAmbience ? `- Atmosphere: ${roomAmbience}\n` : ""}- Your state of mind: ${mode}, ${arousal > 0.7 ? "keyed up" : arousal > 0.4 ? "alert" : "calm"} (${(arousal * 100).toFixed(0)}%)${focus ? `; on your mind: ${focus}` : ""}

THE PEOPLE AROUND YOU:
${buildSocialContext(world, eid, othersInRoom)}

WHAT YOU'VE DONE AND KNOW FOR SURE:
${formatWorkingMemoryContext(world, eid, Date.now(), { fullReceiptIds: true })}

WHAT YOU'VE JUST SENSED:
${formatContextPerceptions(world, eid, recentPerceptions)}

${formatSocialMemoryContext(world, eid)}

YOUR RECENT THOUGHTS:
${recentThoughts.length > 0
  ? recentThoughts.map(eid => `- ${Math.round(simulationAge(world, eid, "Thought.timestamp", Thought.timestamp[eid]) / 1000)}s ago: ${Thought.content[eid]}`).join("\n")
  : "Nothing yet."}

${formatCoordinationContext(world, eid, { actionReceiptsShown: shownActionReceipts })}

${buildKnowledgeContext(world, eid, othersInRoom)}

${formatSocialGoalsForReview(world, eid)}

${formatPlansForContext(world, eid)}

${formatScheduleForContext(world, eid)}

${formatInsightsForContext(world, eid)}

${formatSkillsForContext(eid)}

${formatWorldTimeForContext(world)}

${getAgentWorldCapabilities(world, eid)?.context() || ""}`;
}

export interface CognitionGuard { signal?: AbortSignal; isCurrent?: () => boolean }
/** Synchronous control only. Returning null requests deliberation; this function
 * never starts inference and can run while other actors occupy model slots. */
export function selectFastAgentAction(world: World, eid: number, guard: CognitionGuard = {}): AgentAction | null {
  const action = selectAutomaticAgentAction(world, eid, guard);
  // Includes legacy behavior-policy and contract candidates, not only plans.
  return action && requiresFreshAffordanceDecision(world, eid, action) ? null : action;
}

function selectAutomaticAgentAction(world: World, eid: number, guard: CognitionGuard = {}): AgentAction | null {
  const ensureCurrent = () => { assertSimulationTaskActive(); if (guard.signal?.aborted || guard.isCurrent?.() === false) throw new Error("Cognition superseded or stopped"); };
  ensureCurrent();
  settleActorWait(world, eid);
  ensureCurrent();
  if (isForegroundCognitionReady(world, eid)) reconsiderNextPurposeAfterWait(world, eid);
  if (world.meta.aiEnabled !== false && getConfiguredGeminiApiKey()
    && (snapshotActorContinuation(world, eid)?.status === "needs_revision" || hasNextPurposeReview(world, eid))) return null;
  const ownedPurpose = snapshotActorContinuation(world, eid);
  // A goal association does not authorize replacing the actor's chosen pause
  // (including listening) with that goal's stored plan. Readiness may request a
  // fresh decision; only that choice can resume physical work after wait/rest.
  if (ownedPurpose && ["wait", "rest"].includes(ownedPurpose.actionType)
    && world.meta.aiEnabled !== false && getConfiguredGeminiApiKey()) return null;
  const attention = getAgentPerceptions(world, eid).filter(pid => attentionTypes.has(Perception.type[pid]));
  let seen = attendedPerceptions.get(world);
  if (!seen) { seen = new Set(); attendedPerceptions.set(world, seen); }
  const reconsider = world.meta.aiEnabled !== false && Boolean(getConfiguredGeminiApiKey())
    && (hasNextPurposeReview(world, eid) || hasDueAttentionSignal(world, eid) || attention.some(pid => !seen!.has(attentionKey(eid, pid))));
  if (!reconsider && world.meta.aiEnabled !== false && getConfiguredGeminiApiKey()
    && !getSpeakingActivity(world, eid) && !isSimulationResourceBusy(world, eid, "body")
    && !getAgentWorldCapabilities(world, eid)?.busy()) {
    const step = getResumableActivityStep(world, eid), activity = snapshotOngoingActivity(world, eid);
    if (step && activity && step.goalEid !== undefined && isActivityReturnStepCurrent(world, eid, step)) {
      const action = normalizeSelectedAction(world, eid, { type: step.actionType as ValidActionType,
        target: step.target, content: step.content });
      if (!requiresFreshAffordanceDecision(world, eid, action)) {
        ensureCurrent();
        // Reissue a fresh immediate continuation for a revalidated physical
        // primitive; neither invent a thought nor advance the plan here.
        const revision = integrateActorContinuation(world, eid, { purpose: activity.purpose,
          actionType: action.type, target: action.target, goalId: step.goalEid, goalKey: activity.goalKey,
          observedAtSimMs: readSimulationTime(world) });
        if (revision !== undefined) {
          updateActorContinuation(world, eid, revision, "dispatched");
          return action;
        }
      }
    }
  }
  if (cognitionController(world) === "situated" && world.meta.aiEnabled !== false && getConfiguredGeminiApiKey()) {
    if (process.env.COGNITION_DISABLE_LLM_ACTION_SELECTION === "1") return { type: "wait" };
    // This arm replaces priority/policy/contract arbitration, not the executor.
    // A fresh chosen purpose may use its plan; otherwise deliberate once using
    // the same model, evidence and admission pipeline as the priority arm.
    const step = reconsider || snapshotActorContinuation(world, eid)?.status !== "dispatched"
      ? null : getNextPlannedAction(world, eid);
    return step ? normalizeSelectedAction(world, eid, { type: step.actionType as ValidActionType,
      target: step.target, content: step.content }) : null;
  }
  if (ownedPurpose && world.meta.aiEnabled !== false && getConfiguredGeminiApiKey()) {
    // Priority mode may propose the next purpose, but must not steal an
    // already-chosen one. Only a fresh dispatched goal can recruit its own
    // deterministic plan/contract; an independent action yields back to its
    // author. Recovery, policies and other goals remain proposals at that point.
    const selectedGoalId = situatedPlanGoal(world, eid);
    if (reconsider || ownedPurpose.status !== "dispatched" || selectedGoalId === undefined) return null;
    const step = getNextPlannedAction(world, eid, { selectedGoalId });
    if (step) return normalizeSelectedAction(world, eid, { type: step.actionType as ValidActionType,
      target: step.target, content: step.content });
    const selectedPlan = getPlanForGoal(world, eid, selectedGoalId);
    if (selectedPlan !== undefined && Plan.status[selectedPlan] === "awaiting_decision") return null;
    const ownedContract = selectContractDrivenAction(world, eid);
    if (!ownedContract || ownedContract.type === "wait") return null;
    chronicle.record("contract_decision", { agent: Name.value[eid], agentEid: eid, origin: "selected_purpose",
      goalEid: selectedGoalId, continuationRevision: ownedPurpose.revision,
      actionType: ownedContract.type, target: ownedContract.target });
    return normalizeSelectedAction(world, eid, ownedContract);
  }
  const hasOwnedInProgressTicket = (): boolean => {
    for (let cardEid = 0; cardEid < (Name.value as any).length; cardEid++) {
      if (!hasComponent(world as any, cardEid, KanbanCard as any)) continue;
      if (Number(KanbanCard.ownerEid[cardEid] ?? -1) !== Number(eid)) continue;
      const colEid = getDirectContainer(world as any, cardEid);
      if (colEid === undefined) continue;
      if (!hasComponent(world as any, colEid, KanbanColumn as any)) continue;
      const colName = String(Name.value[colEid] || KanbanColumn.name[colEid] || "");
      if (colName === "In Progress" || colName === "Review") return true;
    }
    return false;
  };

  // Image critique, autonomous goal formation, and reflection run in the
  // scheduled subconscious. This foreground transaction never waits for them.

  // Deterministic "skill reflex": if we already know a proven procedure for the next plan step,
  // execute it without spending an LLM call.
  const automaticGoal = getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal) && Goal.status[g] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
  const automaticPlan = automaticGoal === undefined ? undefined : getPlanForGoal(world, eid, automaticGoal);
  if (automaticPlan !== undefined && Plan.status[automaticPlan] === "awaiting_decision") return null;
  const procedural = reconsider ? null : selectProceduralAction(world, eid);
  if (procedural) {
    const name = Name.value[eid];
    console.log(`[${name}] uses skill: ${procedural.type}${procedural.target ? ` -> ${procedural.target}` : ""}`);
    return normalizeSelectedAction(world, eid, procedural as AgentAction);
  }

  // Deterministic failure recovery: if the last action failed, change strategy immediately.
  // This prevents thrashy loops like "pickup X" -> fail -> retry "take X" -> fail...
  // Skip for agents with behavior policies — the policy tree handles decision-making and
  // recovery's observe-loop can starve the policy from ever running.
  const hasBehaviorPolicy = hasComponent(world as any, eid, BehaviorPolicy as any) && BehaviorPolicy.enabled[eid];
  const newExternalAttention = reconsider && attention.some(pid => !seen!.has(attentionKey(eid, pid)) &&
    ["danger", "attention", "speech", "directed_speech", "speech_fragment"].includes(Perception.type[pid]) && Perception.source[pid] !== "physical world");
  const recovery = hasBehaviorPolicy || newExternalAttention ? null : selectFailureRecoveryAction(world as any, eid);
  // If recovery can only suggest "wait" and we *do* have an LLM available, treat that as
  // "no deterministic recovery found" so the agent can escalate to the LLM.
  if (recovery && (recovery.type !== "wait" || !getConfiguredGeminiApiKey())) {
    const name = Name.value[eid];
    if (recovery.type !== "wait") {
      console.log(
        `[${name}] recovery: ${recovery.type}` +
          ("target" in recovery && recovery.target ? ` -> ${recovery.target}` : "") +
          ("content" in recovery && recovery.content ? ` (${recovery.content})` : "")
      );
    }
    return normalizeSelectedAction(world, eid, recovery as any);
  }

  // Deterministic "directed speech" reply: when running without an LLM key, keep conversations alive.
  // This is intentionally conservative: only trigger when we have an explicit directed speech perception.
  if (world.meta.aiEnabled === false || !getConfiguredGeminiApiKey()) {
    const reply = buildDeterministicSpeechReply(world, eid);
    if (reply) return normalizeSelectedAction(world, eid, reply);
  }

  // Deterministic contract-driven *org* step selection:
  // Prefer governance/coordination moves (kanban/wiki) before plan execution so agents can
  // satisfy "claim ticket"/"move columns" gates that unlock work tools.
  const contract = selectContractDrivenAction(world as any, eid);
  if (contract && contract.type !== "wait" && !reconsider) {
    const name = Name.value[eid];
    const content = (contract as any).content ? String((contract as any).content) : "";
    const affordance = content.trim().split(/\s+/)[0] || "";
    const isOrgTool = affordance.startsWith("kanban_") || affordance.startsWith("wiki_");
    const shouldPrioritize = isOrgTool && (affordance === "kanban_move_card" || !hasOwnedInProgressTicket());
    if (shouldPrioritize) {
      console.log(`[${name}] contract: ${contract.type}${"target" in contract && contract.target ? ` -> ${contract.target}` : ""}`);
      return normalizeSelectedAction(world, eid, contract as any);
    }
  }

  // Deterministic plan execution: if an agent has an active plan for its highest-priority goal,
  // follow the next step directly (LLM-free). This is the core "plans drive grounded action" bridge.
  // Routine schedule microplans must not starve a policy, but an explicitly
  // chosen personal intention must not disappear merely because a BT exists.
  const priorityGoal = getRelationTargets(world, eid, HasGoal).filter(g => hasComponent(world, g, Goal) && Goal.status[g] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))[0];
  const continuationGoal = snapshotActorContinuation(world, eid);
  const deliberateGoal = priorityGoal !== undefined && (hasComponent(world, priorityGoal, GoalLifecycle)
    && ["foreground", "autonomous", "personal"].includes(GoalLifecycle.source[priorityGoal])
    || continuationGoal?.goalId === priorityGoal && continuationGoal.goalKey === WorkingMemoryIdentity.id[priorityGoal]);
  if ((!hasBehaviorPolicy || deliberateGoal) && !reconsider) {
    const nextPlanned = getNextPlannedAction(world, eid);
    if (nextPlanned) {
      ensureCurrent();
      // A stored plan description is historical proposal prose, not a fresh
      // assessment of this scene. Selecting its still-valid action must not
      // republish that older premise as a newly experienced thought.
      return normalizeSelectedAction(world, eid, {
        type: nextPlanned.actionType as any,
        target: nextPlanned.target,
        content: nextPlanned.content,
      });
    }
  }

  // ── Directed Speech Override ──
  // When someone speaks directly to this agent, bypass the BT and go to LLM.
  // The BT handles routine behavior but social response to speech takes priority.
  const hasPendingSpeech = (() => {
    if (world.meta.aiEnabled === false || !getConfiguredGeminiApiKey()) return false;
    const perceptionEids = getAgentPerceptions(world, eid);
    return perceptionEids.some(pid => {
      if (!hasComponent(world as any, pid, Perception as any)) return false;
      const pType = Perception.type[pid] || "";
      const pTimestamp = Perception.timestamp[pid] || 0;
      return (pType === "directed_speech" || pType === "speech" || pType === "speech_fragment") &&
             simulationAge(world, pid, "Perception.timestamp", pTimestamp) < 10000 && !seen!.has(attentionKey(eid, pid));
    });
  })();

  // Deterministic policy layer — skip if someone just spoke to us
  if (!hasPendingSpeech && !reconsider && !deliberateGoal) {
    const policy = evaluateBehaviorPolicy(world, eid);
  if (policy.kind === "action") {
    const name = Name.value[eid];
    console.log(`[${name}] uses policy: ${policy.action.type}${policy.action.target ? ` -> ${policy.action.target}` : ""}`);
    chronicle.record("policy_decision", {
      agent: name,
      action: `${policy.action.type}${policy.action.target ? "→" + policy.action.target : ""}`,
    });

    // Capture policy-driven interact/move actions for BT compilation.
    // When these succeed in executeActions, resolveDecision() will compile
    // the context into a new BT branch — enabling template agents to GROW
    // their trees from experience, not just follow pre-built patterns.
    const pa = policy.action;
    if (pa.type === "interact" || pa.type === "move") {
      const affordance = pa.type === "interact" ? (pa.content?.split(/\s+/)[0] || undefined) : undefined;
      captureLLMDecision(world, eid, `policy:${pa.type}`,
        { type: pa.type as any, target: pa.target, content: pa.content },
        affordance);
    }

    return normalizeSelectedAction(world, eid, policy.action as any);
  }
  if (policy.kind === "start_procedure") {
    const name = Name.value[eid];
    const ok = tryStartProcedureExecution(world, eid, policy.signature, { minSuccesses: policy.minSuccesses });
    if (ok) {
      console.log(`[${name}] starts procedure via policy: ${policy.signature}`);
      const afterStart = selectProceduralAction(world, eid);
      if (afterStart) return afterStart as any;
      return { type: "wait" };
    }
  }
  } // end if (!hasPendingSpeech)

  // When someone spoke to us, log that we're bypassing the BT to respond
  if (hasPendingSpeech) {
    const name = Name.value[eid];
    console.log(`[${name}] has pending speech — bypassing BT for LLM response`);
  }

  // Deterministic contract-driven action selection (non-org steps):
  // Let plans/policies handle most work. Keep contract-driven non-org behavior as a fallback.
  if (contract && contract.type !== "wait" && !reconsider) {
    const name = Name.value[eid];
    console.log(`[${name}] contract: ${contract.type}${"target" in contract && contract.target ? ` -> ${contract.target}` : ""}`);
    return normalizeSelectedAction(world, eid, contract as any);
  }

  // Explicit AI opt-out wins even when another subsystem uses an available key.
  if (world.meta.aiEnabled === false || !getConfiguredGeminiApiKey()) {
    return { type: "wait" };
  }

  // Prefer planner-driven behavior for hard, benchmarked workflows; freeform per-tick LLM actions are optional.
  if (process.env.COGNITION_DISABLE_LLM_ACTION_SELECTION === "1") {
    return { type: "wait" };
  }

  return null;
}


export async function agentThink(world: World, eid: number, guard: CognitionGuard = {}): Promise<AgentAction> {
  const foregroundStarted = performance.now();
  let foregroundFence: ForegroundDecisionFence | undefined;
  let rejectionBasis: ReturnType<typeof captureForegroundRejectionBasis>;
  let diagnosticResponse: unknown;
  const controller = cognitionController(world), narrative = world.meta.narrativeMind === true,
    situated = controller === "situated";
  const current = () => !guard.signal?.aborted && !getSimulationTaskSignal()?.aborted && guard.isCurrent?.() !== false
    && cognitionController(world) === controller && (world.meta.narrativeMind === true) === narrative;
  const reject = (reason: ForegroundRejectionReason, details: { actionType?: string; reference?: ForegroundReferenceDiagnostic; schemaField?: ForegroundSchemaField; schemaIssue?: ActorWaitIssue } = {}) => {
    recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: eid,
      requestId: foregroundFence?.requestId, stage: "rejected", detail: { reason, schemaField: details.schemaField } }));
    // Failed inference is neither an idle choice nor a reason for an immediate
    // unchanged retry. New evidence still bypasses this actor-local pacing.
    if (current()) {
      if (["missing_json", "malformed_json", "invalid_schema", "missing_action_input", "provider_error", "timeout"].includes(reason))
        recordForegroundRejection(world, eid, rejectionBasis, reason, details.schemaField, details.schemaIssue);
      else if (reason !== "cancelled") wakeForegroundCognition(world, eid, { cause: "decision_rejected" });
    }
    return rejectForegroundDecision(world, eid, reason, { requestId: foregroundFence?.requestId, ...details,
      ...(details.schemaField ? {controlShape: foregroundControlShape(diagnosticResponse, details.schemaField)} : {}) });
  };
  const superseded = (reason: ForegroundDiscardReason | ForegroundSemanticDiscardReason, details: Record<string, unknown> = {}): AgentAction => {
    recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: eid,
      requestId: foregroundFence?.requestId, stage: "superseded", detail: { reason } }));
    chronicle.record("decision_superseded", { agent: Name.value[eid], reason, boundary: "response", requestId: foregroundFence?.requestId, ...details });
    if (current()) wakeForegroundCognition(world, eid, { cause: "decision_superseded" });
    return discardedForegroundDecision();
  };
  const ensureCurrent = () => {
    assertSimulationTaskActive();
    if (!current()) throw new Error("Cognition superseded or stopped");
  };
  if (!current()) return reject("cancelled");
  // Significant new experiences invite reconsideration, not compulsory obedience.
  // Acknowledge each attention event once; routine sensory refreshes do not break plans.
  const attention = getAgentPerceptions(world, eid).filter(pid => attentionTypes.has(Perception.type[pid]));
  let seen = attendedPerceptions.get(world);
  if (!seen) { seen = new Set(); attendedPerceptions.set(world, seen); }
  const attentionKeys = attention.map(pid => attentionKey(eid, pid));
  const fast = selectFastAgentAction(world, eid, guard);
  if (fast) return fast;

  // Issuance performs actor-local sensing before any context/working-memory
  // projection. The prompt and later admission therefore share one known view.
  foregroundFence = captureForegroundDecisionFence(world, eid);
  const localView = getForegroundDecisionLocalView(world, eid, foregroundFence);
  const issuedAffectContext = formatAffectContext(world, eid);
  const issuedEmotionalLife = emotionalLifeBasis(world, eid);
  const issuedIdentityMeanings = JSON.stringify(getIdentityAnchors(world, eid));
  const issuedConcerns = JSON.stringify(getPersonalConcerns(world, eid));
  const issuedContinuationBasis = JSON.stringify(snapshotActorContinuation(world, eid));
  const issuedActivityBasis = JSON.stringify(snapshotOngoingActivity(world, eid));
  const goalReviewContext = captureGoalReviewContext(world, eid);
  const observedAtSimMs = readSimulationTime(world);
  const issuedAttentionSignals = snapshotAttentionSignals(world, eid);
  const activityReviewContext = captureActivityReview(world, eid);
  const planDecisionContext = capturePlanDecisions(world, eid);
  const context = `${buildAgentContext(world, eid)}\n\n${formatGoalLifecycleContext(world, eid)}\n\n${formatGoalPursuitContext(world, eid, goalReviewContext)}`;
  const workingMemory = getWorkingMemory(world, eid);
  let coordinationMemory = getCoordinationMemory(world, eid);
  const heardDialogue = new Set(getSocialDialogue(world, eid).filter(turn => !turn.own).map(turn => turn.id));
  const heardAppraisalContext = captureHeardAppraisal(world, eid);
  // Coherent heard spans invalidate interpretations, not independent body work.
  // Raw word progress and one's own voice do not force a new model request.
  const heardFrontier = () => JSON.stringify(getSocialSpeechFragments(world, eid).filter(fragment => !fragment.own && fragment.notifiedLength > 0)
    .map(fragment => [fragment.id, fragment.executionId, fragment.notifiedToken, fragment.content.slice(0, fragment.notifiedLength)]));
  const issuedHeardFrontier = heardFrontier();
  const issuedSpeechFragments = getSocialSpeechFragments(world, eid);
  const speakingAtRequest = getSpeakingActivity(world, eid);
  const speechOpportunity = readLocalSpeechOpportunity(world, eid);
  const ownDialogue = new Set([...getSocialDialogue(world, eid), ...getPrivateCommunications(world, eid)].filter(turn => turn.own).map(turn => turn.id));
  const listedWorkRefs = new Map(coordinationMemory.items.filter(item => item.own).slice(-8)
    .map(item => [item.id, captureCoordinationWork(world, eid, item.id)]));
  // A legacy save may allocate work generations at this issuance boundary.
  // Snapshot after that migration so it is not mistaken for an external change.
  coordinationMemory = getCoordinationMemory(world, eid);
  const projectedAttentionKeys = contextPerceptions(world, eid).filter(pid => attentionTypes.has(Perception.type[pid])).map(pid => attentionKey(eid, pid));
  const name = Name.value[eid];

  // Prior decision JSON is not a dialogue turn with the world. Replaying it as
  // assistant history encourages continuation of imagined outcomes. Continuity
  // comes from plans, memories and explicitly historical thoughts instead.
  const currentGoals = getRelationTargets(world, eid, HasGoal)
    .filter(gid => hasComponent(world, gid, Goal) && ["active", "in_progress"].includes(Goal.status[gid]))
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  // The actual decision request is an issuance boundary, not a read-only
  // formatter. Assign episode identities now so a recycled numeric goal ID
  // cannot bind an older response to replacement work.
  // Review preparation is read-only. Establish identities for every owned goal
  // actually listed in the request now, not while a late reply is being checked.
  for (const gid of currentGoals) captureCoordinationGoal(world, eid, gid);
  const ownGoalBasis = () => JSON.stringify(getRelationTargets(world, eid, HasGoal).filter(gid => hasComponent(world, gid, Goal))
    .map(gid => [gid, getCoordinationGoalRef(world, eid, gid), Goal.description[gid], Goal.priority[gid], Goal.status[gid], Goal.progress[gid]]));
  const issuedGoalBasis = ownGoalBasis();
  // Execution depends on live choices, not garbage collection of historical
  // goals. Activation, retirement or reprioritization still changes this set.
  const stableGoalBasis = () => JSON.stringify(getRelationTargets(world, eid, HasGoal).filter(gid => hasComponent(world, gid, Goal)
    && ["active", "in_progress", "paused"].includes(Goal.status[gid]))
    .map(gid => [gid, getCoordinationGoalRef(world, eid, gid), Goal.description[gid], Goal.priority[gid], Goal.status[gid], intentionReviewRevision(world, gid)]));
  const issuedStableGoals = stableGoalBasis();
  const listedGoalRefs = new Map(currentGoals.slice(0, 5).map(gid => [gid, getCoordinationGoalRef(world, eid, gid)]));
  const priority = currentGoals.length ? (Goal.priority[currentGoals[0]] || 0) : undefined;
  const currentPriorities = currentGoals.filter(gid => Goal.priority[gid] === priority);
  const coordinationGoalRefs = currentPriorities.map(gid => getCoordinationGoalRef(world, eid, gid));
  const decisionSnapshot = `CURRENT DECISION EVIDENCE:
Your last action (may still be in progress): ${hasComponent(world, eid, LastAction) ? JSON.stringify({ type: LastAction.type[eid], target: LastAction.target[eid], content: LastAction.content[eid], success: LastAction.success[eid], timestamp: LastAction.timestamp[eid] }) : "No processed action yet."}`;

  // Get dynamic actions based on agent's components, location, and environment
  const actionsContext = formatActionsForPrompt(world, eid);
  const validTypes = getValidActionTypes(world, eid);
  const listeningActivities = getListeningActivities(world, eid).map(row => ({ executionId: row.executionId, speaker: Name.value[row.speakerId] }));
  const chosenNextPurpose = snapshotActorContinuation(world, eid)?.nextPurpose;

  const prompt = `It's your move, ${name}. What do you do next?

Stay in character. Act from what you want, fear, suspect, love and are hiding —
not from politeness. The people here have history with you; let it show. When
something matters, pursue it: go to someone, ask the hard question, press,
dodge, confide, tease, lie, confront, apologize, investigate, take or keep
something back. Stillness is a choice too — make it only when this character
genuinely would, and let your innerThought say why.

${formatDueAttentionReview(world, eid)}

${actionsContext}

${situated ? SITUATED_SELECTION : `Tend to anything urgent first — danger, hunger, exhaustion. Otherwise follow
what matters most to you right now, weighing what's just happened against what
you already wanted. Keep a goal while you still care about it; drop it, park
it, or take on a new one when your feelings or the situation change. Plans in
progress are there to help you, not to bind you. When something depends on
someone else, you can let it ride and turn to something else meanwhile.`}
Priorities are context, not a requirement to choose the highest-ranked goal.
${narrative ? NARRATIVE_SELECTION_INSTRUCTION : ""}

HOW THINGS WORK
- Use the listed action types and the exact names of people, places and objects.
  An action only counts once it completes; if it fails, find another way.
- What others say is their claim. Believe it, doubt it, test it — as you would.
- Asked something you don't know? Say so, speculate out loud, or ask or inspect first.
  Saying something happened doesn't make it so — lying on purpose is a different matter.
- Speaking: say what ${name} would really say, in your own voice — usually 1 to 3
  sentences. Subtext, evasion, humor, heat and tenderness all belong. You don't
  need to wrap up politely; you can walk off, change the subject or keep pushing.
  Conversation now: ${speechOpportunity.available ? "you can speak" : `someone else has the floor (${speechOpportunity.reason})`}.
  To cut in anyway, set speechMode:"interrupt" on speak.${speakingAtRequest ? `
  You are mid-sentence; said so far: ${JSON.stringify(speakingAtRequest.spokenText)}. Set action.stopSpeaking=true to break off if something changes what you'd say.` : ""}
- Listening: to keep listening to a voice, choose wait with action.listeningTo set to its
  executionId from ${JSON.stringify(listeningActivities)} (omit target/content).
- Waiting for something specific: wait with action.waitUntil =
  {"kind":"heard_evidence","timeoutMs":15000} or an exact physical_fact contract below
  (timeoutMs 1000–60000 simulated ms is when you'll reconsider). Not together with listeningTo.
${formatObservableConditions(world, eid)}
- A quick physical sequence toward a listed goal: motorPlan = 2–4 {type,target,content?}
  steps starting with this action, using objects you can see, ending at the first new
  information (e.g. reading something).
- Returning to a goal afterwards: record control.nextPurpose:{"goalId":listed goal ID,"purpose":"what I'll do next"}.
  It comes back for review when this step ends. Use nextPurposeReview to take or cancel a ready one.
- Promises: if someone is relying on you and things change, think about telling them.

Action types: ${validTypes.join(", ")}.

${formatNextPurpose(world, eid)}
Respond with JSON only:
{
  "control": {
    "version": 2,
    "purpose": "why I'm doing this",
    "goalId": null,
    "localDependencies": []${chosenNextPurpose?.status === "ready" ? `,
    "nextPurposeReview": {
      "id": ${JSON.stringify(chosenNextPurpose.id)},
      "disposition": "<take or cancel>",
      "reason": "Why I choose this now"
    }` : ""}
  },
  "action": {
    "type": "<action_type>",
    "target": "exact name of who/what, when needed",
    "content": "what you say / do"
  },
  "innerThought": "optional — a private first-person moment in your own voice"
}
${listeningActivities[0] ? `Listening example: ${JSON.stringify({ type: "wait", listeningTo: listeningActivities[0].executionId })} — listeningTo sits inside action; never put it in target or content.\n` : ""}
control.goalId: the listed goal this serves, "new" for a goalUpdate in this reply, or null
for something spontaneous. Optional: control.switchReason when you change purpose;
control.activityDisposition "continue" | "pause" | "replace" (with a listed goal) | "end".
control.localDependencies: usually []; list exact IDs from this catalog only for local
facts your action relies on staying true: ${JSON.stringify(getLocalDependencyCatalog(localView))}.
When a physical action serves one of your listed goals, set action.goalId (its ID, or
"new"); for a promise you made, also action.undertakingId.

OPTIONAL (include only when they apply):
${heardAppraisalContext.prompt}
${issuedAttentionSignals.length ? `- attentionReview: {"signalId":listed signal ID,"disposition":"consider"|"defer","reason":"..."}; defer takes afterSeconds 5..120 and optional wake:{"kind":"heard_evidence"}.\n` : ""}- goalUpdate: {"description":"a new intention","priority":1..10,"kind":"custom"|"social","completionId":optional listed criterion (use its exact description),"supportsGoalId":optional goal ID}.
- goalReview: {"goalId":listed eligible ID,"disposition":"retain"|"defer"|"release"|"withdraw","reason":"required, ≤400 chars"}.
  defer also takes "afterSeconds":10..60 and "wake": one listed wake condition. release drops an
  episodic intention; withdraw drops a standing desire; retain keeps one under review.
  Only goals listed as eligible can be reviewed.
- affectUpdate: {"feeling":"...","valence":-1..1,"arousal":0..1,"reason":"...","expression":one of ${FACIAL_EXPRESSIONS.map(expression => JSON.stringify(expression)).join(", ")}}.
  Omit expression to keep your current face; what you show needn't match what you feel.
- socialGoalReview: {"goalId":listed social goal,"disposition":"satisfied_for_now","reason":"...","evidenceIds":[your turn id, their turn id]}.
- coordinationReviews: up to 3 of
  {"kind":"undertake","speechId":"your spoken/sent source ID","task":"...","goalId":optional ID or "new"},
  {"kind":"link","id":"commitment ID","goalId":optional},
  {"kind":"blocked","id":"commitment ID","reason":"...","evidenceIds":["physical evidence ID"]},
  {"kind":"release","id":"commitment ID","reason":"..."},
  {"kind":"report","id":"commitment ID","speechId":"source ID of your update","status":"not_started|in_progress|blocked|completed|released"}.
  undertake/link may add completion:{"type":"action","actionType":"...","target":"...","content":optional} and goalRelation:"fulfills".

${localView ? formatCognitiveLocalView(localView) : ""}

${decisionSnapshot}
NEXT-ACTION CHOICE:
${formatPlanDecisions(planDecisionContext)}
${formatActivityReview(activityReviewContext)}

`;

  const mm = buildUserContentWithImages(world, eid, prompt);
  const userContent = mm.content;
  const loggedPrompt = mm.attached.length ? `${prompt}

[Images attached: ${mm.attached.join(", ")}]` : prompt;
  const deadline = AbortSignal.timeout(8000);
  const decisionSignal = AbortSignal.any([deadline, ...[guard.signal, getSimulationTaskSignal()].filter((signal): signal is AbortSignal => !!signal)]);
  let rejectionPhase: ForegroundRejectionReason = "provider_error";
  rejectionBasis = captureForegroundRejectionBasis(world, eid);
  const providerStarted = performance.now();
  recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: eid,
    requestId: foregroundFence!.requestId, stage: "issued", detail: {
      controller, contract: prompt.match(/- Returning to a goal afterwards:[\s\S]*?take or cancel a ready one\./)?.[0],
      contractOffered: prompt.includes("record control.nextPurpose:"),
      eligibleNextPurposeGoalIds: [...listedGoalRefs.keys()], omittedGoals: Math.max(0, currentGoals.length - 24),
      goals: currentGoals.slice(0, 24).map(id => ({ id, description: Goal.description[id]?.slice(0, 400), status: Goal.status[id] })),
      continuation: issuedContinuationBasis ? JSON.parse(issuedContinuationBasis) : null,
      activity: issuedActivityBasis ? JSON.parse(issuedActivityBasis) : null,
    } }));
  // Full-attempt timing is operator telemetry, not an admitted thought. Issue
  // before inference so cancelled/unfinished calls cannot vanish from evals.
  try {
    chronicle.record("foreground_attempt_started", { agent: name, agentEid: eid,
      requestId: foregroundFence?.requestId, preparationWallMs: Math.round(providerStarted - foregroundStarted) });
  } catch { /* Observers cannot change cognition. */ }
  let providerReturned = false;
  const reportProvider = (outcome: "returned" | "timeout" | "cancelled" | "error", response?: unknown) => {
    try {
      chronicle.record("foreground_provider_result", { agent: name, agentEid: eid,
        requestId: foregroundFence?.requestId, provider: foregroundProviderStats(performance.now() - providerStarted, outcome, response) });
    } catch { /* Diagnostics must not change decision admission or error handling. */ }
  };
  try {
    const response = await generateText({
      model,
      // A stalled request must yield its foreground slot without admitting
      // thoughts, goals or acknowledgments from an unfinished decision.
      abortSignal: decisionSignal,
      maxRetries: 0,
      maxOutputTokens: 1800,
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      system: `${context}\n\n${formatForegroundRejectionRecovery(world, eid)}`,
      messages: [
        {
          role: "user" as const,
          content: userContent,
        },
      ],
      temperature: AGENT_COGNITION_TEMPERATURE,
    });
    providerReturned = true;
    reportProvider("returned", response);
    const { text } = response;
    decisionSignal.throwIfAborted();
    ensureCurrent();
    rejectionPhase = "malformed_json";
    const jsonStr = extractJSON(text);
    if (!jsonStr) return reject(text.includes("{") ? "malformed_json" : "missing_json");

    const result = JSON.parse(jsonStr);
    diagnosticResponse = result;
    recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: eid,
      requestId: foregroundFence!.requestId, stage: "returned", detail: {
        ...foregroundChoiceDiagnostic(result),
        ...(activityReviewContext ? { activityReviewEvidence: activityReviewEvidenceDiagnostic(activityReviewContext, result?.control?.activityReview) } : {}),
      } }));
    rejectionPhase = "invalid_schema";
    const independent = result?.control !== undefined;
    const localDependencies = independent ? validateLocalDependencies(localView, result.control?.localDependencies) : undefined;
    const pursuit = result?.control?.version === 2;
    if (situated && !pursuit) return reject("invalid_schema");
    if (independent && (!result.control || ![1, 2].includes(result.control.version) || !localDependencies
      || typeof result.control.purpose !== "string" || !result.control.purpose.trim() || result.control.purpose.length > 400
      || Object.keys(result.control).some(key => !(pursuit ? ["version", "purpose", "localDependencies", "goalId", "switchReason", "activityReview", "activityDisposition", "nextPurpose", "nextPurposeReview"] : ["version", "purpose", "localDependencies", "activityReview", "activityDisposition"]).includes(key)))) return reject("invalid_schema", { schemaField: "control" });
    if (independent && result.control.activityDisposition !== undefined && !["continue", "pause", "replace", "end"].includes(result.control.activityDisposition)) return reject("invalid_schema", { schemaField: "control.activityDisposition" });
    let focusHint = pursuit ? result.control.goalId : undefined;
    let closingGoalReference = false;
    if (result.control?.activityDisposition === "replace" && (!pursuit || focusHint === null || focusHint === undefined)) return reject("invalid_schema", { schemaField: "control.activityDisposition" });
    const wantsHeardAppraisal = result.appraiseSpeechIds !== undefined
      && !(Array.isArray(result.appraiseSpeechIds) && result.appraiseSpeechIds.length === 0);
    const heardAppraisal = wantsHeardAppraisal ? prepareHeardAppraisal(heardAppraisalContext, result.appraiseSpeechIds) : undefined;
    if (wantsHeardAppraisal && (!independent || !heardAppraisal)) return reject("invalid_schema", { schemaField: "appraiseSpeechIds" });
    if (pursuit && (focusHint !== null && focusHint !== "new" && (!Number.isSafeInteger(focusHint) || !listedGoalRefs.has(focusHint))
      || result.control.switchReason !== undefined && (typeof result.control.switchReason !== "string" || !result.control.switchReason.trim() || result.control.switchReason.length > 400))) return reject("invalid_schema", { schemaField: "control.goalId" });
    let goalReviewIssue: ForegroundSchemaField = "goalReview";
    const goalReview = result.goalReview === undefined ? undefined
      : prepareGoalReview(goalReviewContext, result.goalReview, field => { goalReviewIssue = field; });
    const reviewedGoals = new Set(goalReview ? [goalReview.goalId, ...getGoalDependents(world, eid, goalReview.goalId)] : []);
    let queuedGoalReview = false, coalescedSocialReview = false;
    const attentionReview = result.attentionReview === undefined ? undefined
      : prepareAttentionReview(world, eid, issuedAttentionSignals, result.attentionReview);
    let staleActivityReview = false;
    let activityReviewIssue: ForegroundSchemaField = "control.activityReview";
    const activityReview = activityReviewContext
      ? prepareActivityReview(activityReviewContext, result.control?.activityReview, () => { staleActivityReview = true; }, field => { activityReviewIssue = field; }) : undefined;
    if (staleActivityReview) return superseded("source_changed", { schemaField: "control.activityReview" });
    if (activityReviewContext && !activityReview || result.control?.activityReview !== undefined && !activityReview)
      return reject("invalid_schema", { schemaField: activityReviewIssue });
    if (result.attentionReview !== undefined && !attentionReview) return reject("invalid_schema", { schemaField: "attentionReview" });
    if (result.goalReview !== undefined) {
      if (!pursuit) return reject("invalid_schema", { schemaField: "goalReview.disabled" });
      if (!goalReview) return reject("invalid_schema", { schemaField: goalReviewIssue });
      if (result.socialGoalReview?.goalId === goalReview.goalId) {
        const social = result.socialGoalReview;
        // Explicit relinquishment supersedes a redundant subjective claim. Do
        // not promote its citations to evidence, emit completion, or commit two
        // competing lifecycle writes. Malformed/other conflicts still reject.
        coalescedSocialReview = ["release", "withdraw"].includes(goalReview.disposition)
          && social.disposition === "satisfied_for_now" && typeof social.reason === "string" && !!social.reason.trim() && social.reason.length <= 600
          && Array.isArray(social.evidenceIds) && social.evidenceIds.length >= 2 && social.evidenceIds.length <= 8
          && social.evidenceIds.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 300)
          && Object.keys(social).every(key => ["goalId", "disposition", "reason", "evidenceIds"].includes(key));
        if (!coalescedSocialReview) return reject("invalid_schema", { schemaField: "goalReview.conflict" });
      }
      const creditedReviewedWork = reviewedGoals.has(result.action?.goalId);
      queuedGoalReview = creditedReviewedWork && focusHint === result.action?.goalId
        && goalReview.queueable
        && isPhysicalForegroundAction(result.action) && !result.motorPlan && !result.goalUpdate && !result.action.stopSpeaking
        && !["pause", "end"].includes(result.control.activityDisposition);
      if (creditedReviewedWork && !queuedGoalReview || reviewedGoals.has(result.goalUpdate?.supportsGoalId))
        return reject("invalid_schema", { schemaField: "goalReview.conflict" });
      if (!queuedGoalReview && reviewedGoals.has(focusHint)) {
        // Referring to a departing intention does not bind the selected action
        // to continued pursuit. The review controls its lifecycle; an uncredited
        // action still goes through ordinary grounding and native execution.
        // Explicit work/plan authority or continuing that activity contradicts
        // the review. Do not infer authority from the action's physical type.
        if (result.motorPlan !== undefined
          || result.action?.goalId !== undefined || result.action?.undertakingId !== undefined
          || result.action?.stopSpeaking || ["continue", "replace"].includes(result.control.activityDisposition)
          || result.control.activityDisposition === "pause" && result.goalReview.disposition !== "defer")
          return reject("invalid_schema", { schemaField: "goalReview.conflict" });
        focusHint = null;
        closingGoalReference = true;
      }
    }
    // Goal rank informs selection, not admission. The listed purpose and explicit
    // activity/lifecycle choices carry intent; an optional explanation grants no
    // authority. Ownership, freshness and native execution checks still apply.
    // Validate before admitting thoughts/goals or acknowledging attention. A
    // malformed model response must not mutate cognition and then crash execution.
    const actionShapeIssue = foregroundActionShapeIssue(result, validTypes, listeningActivities.map(row => row.executionId));
    if (actionShapeIssue) return reject("invalid_schema", { schemaField: actionShapeIssue });
    if (result.action.waitUntil !== undefined && result.action.type !== "wait")
      return reject("invalid_schema", { schemaField: "action.waitUntil", schemaIssue: "non_wait_action" });
    if (result.action.waitUntil !== undefined && result.action.listeningTo !== undefined)
      return reject("invalid_schema", { schemaField: "action.waitUntil", schemaIssue: "listening_conflict" });
    const waitResult = result.action.waitUntil === undefined ? undefined : prepareActorWaitChecked(world, eid, result.action.waitUntil);
    if (waitResult && "issueCode" in waitResult)
      return reject("invalid_schema", { schemaField: "action.waitUntil", schemaIssue: waitResult.issueCode });
    const chosenWait = waitResult?.prepared;
    // An action selection is not a requirement to author monologue. Keep exact
    // nonblank prose, including deliberate repetition; omission/blank text has
    // no thought event and must not replace the audience's last genuine thought.
    // A model can explicitly think through action.content too. Admit that text
    // here, under the SAME mental fence, not in the generic executor (which also
    // executes plan templates). Explicit innerThought takes precedence so one
    // decision cannot double-publish the same inner speech.
    const expressedThought: string | undefined = result.innerThought?.trim() ? result.innerThought
      : result.action.type === "think" && result.action.content?.trim() ? result.action.content : undefined;
    if ((["move", "observe", "examine", "pickup", "drop", "use", "give", "attack", "interact"].includes(result.action.type) && !result.action.target?.trim()) ||
        (["speak", "interact", "give", "reflect"].includes(result.action.type) && !result.action.content?.trim())) {
      return reject("missing_action_input", { actionType: result.action.type });
    }
    const affect = result.affectUpdate === undefined ? null : prepareAffectUpdate(world, eid, result.affectUpdate);
    if (result.affectUpdate !== undefined && !affect) return reject("invalid_schema", { schemaField: "affectUpdate" });
    // Check the exact normalized selection before any cognitive effects. A raw
    // move to an object becomes observation; checking only route names would
    // miss replacement of that observed object. Also retain the raw physical
    // source check so a new busy state cannot disguise a stale move as a wait.
    if (result.action.stopSpeaking && !speakingAtRequest) return reject("invalid_schema", { schemaField: "action.stopSpeaking" });
    const draftAction: AgentAction = { type: result.action.type, target: result.action.target, content: result.action.content,
      ...(result.action.listeningTo ? { listeningTo: result.action.listeningTo } : {}),
      ...(chosenWait ? { waitUntil: chosenWait.condition } : {}),
      ...(result.action.speechMode ? { speechMode: result.action.speechMode } : {}),
      ...(result.action.stopSpeaking ? { stopSpeechId: speakingAtRequest!.executionId } : {}) };
    let selectedAction = normalizeActionSelection(world, eid, draftAction);
    if (independent && selectedAction.type === "wait" && draftAction.type !== "wait") selectedAction = draftAction;
    const nextPurposeNeeded = result.control?.nextPurpose !== undefined || result.control?.nextPurposeReview !== undefined
      || snapshotActorContinuation(world, eid)?.nextPurpose !== undefined;
    const nextPurposeUpdate = nextPurposeNeeded && pursuit ? prepareNextPurposeUpdate(world, eid,
      result.control.nextPurpose, result.control.nextPurposeReview, { requestId: foregroundFence!.requestId,
        actionType: selectedAction.type, goalId: focusHint, listedGoals: new Set(listedGoalRefs.keys()) }) : undefined;
    if (nextPurposeNeeded && !nextPurposeUpdate) return reject("invalid_schema", { schemaField: "control.nextPurpose" });
    if (nextPurposeUpdate?.value && reviewedGoals.has(nextPurposeUpdate.value.goalId))
      return reject("invalid_schema", { schemaField: "goalReview.conflict" });
    let stalePlanDecision = false;
    const planDecision = result.planDecision === undefined ? undefined
      : pursuit && typeof focusHint !== "string" && !result.motorPlan && !result.goalUpdate && (!result.socialGoalReview || coalescedSocialReview)
        ? prepareForegroundPlanDecisionReview(planDecisionContext, result.planDecision, { goalId: focusHint, action: selectedAction }, () => { stalePlanDecision = true; }) : undefined;
    if (stalePlanDecision) return superseded("source_changed", { schemaField: "planDecision" });
    if (result.planDecision !== undefined && !planDecision) return reject("invalid_schema", { schemaField: "planDecision" });
    // Different goal IDs alone are not independence: releasing a parent also
    // retires its supporting plans. Check before committing either decision.
    if (planDecision && !queuedGoalReview && reviewedGoals.has(planDecision.summary.goalId))
      return reject("invalid_schema", { schemaField: "goalReview.conflict" });
    const motorPlan = result.motorPlan === undefined ? undefined : pursuit && typeof focusHint === "number"
      && !result.action.stopSpeaking && result.action.undertakingId === undefined && result.socialGoalReview?.goalId !== focusHint
      ? prepareForegroundMotorPlan(world, eid, focusHint, result.motorPlan, selectedAction, localView!) : undefined;
    if (result.motorPlan !== undefined && !motorPlan) return reject("invalid_schema", { schemaField: "motorPlan" });
    const rawTarget = ["observe", "interact"].includes(draftAction.type)
      ? draftAction.target?.replace(/[.!?,;:]+$/, "").trim() : draftAction.target;
    const sourceChange = checkForegroundDecision(world, eid, foregroundFence, { ...draftAction, target: rawTarget })
      || checkForegroundDecision(world, eid, foregroundFence, selectedAction);
    if (sourceChange && !independent) {
      return superseded(sourceChange, { actionType: selectedAction.type, target: selectedAction.target });
    }
    // Native normalization may yield while travel/tool work is already active.
    // A model that selected a different action did not choose that wait. Reject
    // the suppressed proposal without publishing its thought or learning a wait.
    if (selectedAction.type === "wait" && draftAction.type !== "wait") {
      return reject("selection_suppressed", { actionType: draftAction.type });
    }
    rejectionPhase = "binding_error";
    const actionGoalHint = coordinationWorkActions.has(selectedAction.type) ? result.action.goalId : undefined;
    const actionWorkHint = coordinationWorkActions.has(selectedAction.type) ? result.action.undertakingId : undefined;
    const requestedWorkRef = typeof actionWorkHint === "string" ? listedWorkRefs.get(actionWorkHint) : undefined;
    const undertakesPriorSpeech = typeof actionWorkHint === "string" && !listedWorkRefs.has(actionWorkHint)
      && ownDialogue.has(actionWorkHint) && Array.isArray(result.coordinationReviews)
      && result.coordinationReviews.slice(0, 3).some((review: any) => review?.kind === "undertake" && review.speechId === actionWorkHint);
    if (actionWorkHint !== undefined && !requestedWorkRef && !undertakesPriorSpeech) {
      return reject("invalid_undertaking_reference", { actionType: selectedAction.type,
        reference: foregroundReferenceDiagnostic(actionWorkHint, [...listedWorkRefs].map(([id, ref]) => ({
          id, eligible: !!ref, status: coordinationMemory.items.find(item => item.id === id)?.localStatus || "unknown",
        })), typeof actionWorkHint === "string" && ownDialogue.has(actionWorkHint)) });
    }
    const requestedGoalRef = typeof actionGoalHint === "number" ? listedGoalRefs.get(actionGoalHint) : undefined;
    if (actionGoalHint !== undefined && actionGoalHint !== "new" && !requestedGoalRef) {
      return reject("invalid_goal_reference", { actionType: selectedAction.type });
    }
    const readWork = (id: string): CoordinationWorkRef | undefined => {
      const item = getCoordinationMemory(world, eid).items.find(i => i.id === id && i.own && i.generation
        && !["verified_done", "released"].includes(i.localStatus || ""));
      return item ? Object.freeze({ ownerKey: item.ownerKey, itemId: item.id, generation: item.generation! }) : undefined;
    };
    const actionReferences = [selectedAction.target || "", selectedAction.content || ""];
    const actionCoordinationScope = { references: independent ? [] : actionReferences, itemIds: typeof actionWorkHint === "string" ? [actionWorkHint] : [],
      goalRefs: [requestedGoalRef] };
    let actionBindingWork = requestedWorkRef, actionBindingGoal = requestedGoalRef;
    let actionCoordinationBasis = coordinationDependency(coordinationMemory, actionCoordinationScope);
    const checkActionBindings = (): ForegroundAdmissionFailure | undefined => {
      if (!current()) return "cancelled";
      if (draftAction.listeningTo && !getListeningActivities(world, eid).some(row => row.executionId === draftAction.listeningTo)) return "voice_changed";
      if (chosenWait && !chosenWait.current()) return "source_changed";
      // A new utterance drafted while our voice is still in flight must not
      // become its continuation after that voice has finished or been replaced.
      // The model saw a historical spoken prefix, not the eventual completed
      // turn. Reconsider from the real result; never trim/dedupe proposed text.
      // Word progress within the same episode does not invalidate cognition,
      // and independent physical actions remain free to run alongside speech.
      if (draftAction.type === "speak"
        && getSpeakingActivity(world, eid)?.executionId !== speakingAtRequest?.executionId) return "voice_changed";
      if (draftAction.stopSpeechId && getSpeakingActivity(world, eid)?.executionId !== draftAction.stopSpeechId) return "voice_changed";
      if (actionBindingWork && JSON.stringify(actionBindingWork) !== JSON.stringify(readWork(actionWorkHint))) return "undertaking_changed";
      if (actionBindingGoal && !getRelationTargets(world, eid, HasGoal).some(gid => hasComponent(world, gid, Goal)
        && ["active", "in_progress"].includes(Goal.status[gid])
        && JSON.stringify(actionBindingGoal) === JSON.stringify(getCoordinationGoalRef(world, eid, gid)))) return "goal_changed";
      if (!independent && workingMemoryDependency(workingMemory, actionReferences) !== currentWorkingMemoryDependency(world, eid, actionReferences)) return "working_memory_changed";
      if (actionCoordinationBasis !== currentCoordinationDependency(world, eid, actionCoordinationScope)) return "coordination_changed";
    };
    const bindingChange = checkActionBindings();
    if (bindingChange) return bindingChange === "cancelled" ? reject("cancelled")
      : superseded(bindingChange as ForegroundSemanticDiscardReason);

    // The body command and the current mental update have different sources.
    // An unrelated scene change may invalidate every ancillary interpretation
    // without invalidating an independently grounded pickup, move or inspection.
    const socialDecision = ["speak", "wait", "think", "reflect", "rest"].includes(selectedAction.type)
      || result.goalUpdate?.kind === "social" || Boolean(result.socialGoalReview);
    const socialReferences = [selectedAction.target || "", selectedAction.content || "", expressedThought || "", result.affectUpdate?.reason || "",
      typeof result.goalUpdate?.description === "string" ? result.goalUpdate.description : ""].join("\n");
    const memoryReferences = [selectedAction.target || "", selectedAction.content || "", expressedThought || "", result.affectUpdate?.reason || "",
      typeof result.goalUpdate?.description === "string" ? result.goalUpdate.description : ""];
    const coordinationReviews = Array.isArray(result.coordinationReviews)
      ? result.coordinationReviews.slice(0, 3).filter((review: any) => !review?.speechId || ownDialogue.has(review.speechId)) : undefined;
    const coordinationScope = {
      all: true,
      strict: !!coordinationReviews?.length,
      references: memoryReferences,
      itemIds: [actionWorkHint, ...(coordinationReviews?.flatMap((review: any) => [review?.id, review?.speechId]) || [])]
        .filter((id: unknown): id is string => typeof id === "string"),
      goalRefs: [...coordinationGoalRefs, requestedGoalRef],
    };
    const checkMentalSources = (): ForegroundAdmissionFailure | undefined => {
      if (!current()) return "cancelled";
      if (formatAffectContext(world, eid) !== issuedAffectContext) return "source_changed";
      if (JSON.stringify(getIdentityAnchors(world, eid)) !== issuedIdentityMeanings) return "source_changed";
      if (narrative && emotionalLifeBasis(world, eid) !== issuedEmotionalLife) return "source_changed";
      if (JSON.stringify(getPersonalConcerns(world, eid)) !== issuedConcerns) return "source_changed";
      if (independent && JSON.stringify(snapshotActorContinuation(world, eid)) !== issuedContinuationBasis) return "source_changed";
      if (independent && JSON.stringify(snapshotOngoingActivity(world, eid)) !== issuedActivityBasis) return "source_changed";
      if (!independent && heardFrontier() !== issuedHeardFrontier) return "dialogue_changed";
      if (!independent && !isCognitiveLocalViewCurrent(world, eid, localView)) return "local_view_changed";
      if (independent ? stableGoalBasis() !== issuedStableGoals : ownGoalBasis() !== issuedGoalBasis) return "goal_changed";
      const newRelevantTurns = getSocialDialogue(world, eid).filter(turn => !turn.own && !heardDialogue.has(turn.id)
        && ((socialDecision && turn.target === name)
          || (refersToPerson(socialReferences, turn.speaker) && (!turn.target || turn.target === name))
          || (selectedAction.type === "speak" && !selectedAction.target && !turn.target)));
      if (!independent && newRelevantTurns.length) return "dialogue_changed";
      if (!independent && workingMemoryDependency(workingMemory, memoryReferences) !== currentWorkingMemoryDependency(world, eid, memoryReferences)) return "working_memory_changed";
      if (coordinationReviews?.some((review: any) => review?.kind === "blocked")
        && !coordinationReviewEvidenceIsCurrent(workingMemory, getWorkingMemory(world, eid), coordinationReviews)) return "coordination_citation_changed";
      if ((!independent || coordinationReviews?.length)
        && coordinationDependency(coordinationMemory, coordinationScope) !== currentCoordinationDependency(world, eid, coordinationScope)) return "coordination_changed";
    };
    const responseMentalChange = checkMentalSources();
    const update = result.goalUpdate;
    rejectionPhase = "commit_error";
    const intention = update ? prepareGeneratedIntention(world, eid, update, "foreground") : null;
    if (focusHint === "new" && !intention) return reject("new_goal_not_admitted");
    if (actionGoalHint === "new" && !intention) {
      return reject("new_goal_not_admitted", { actionType: selectedAction.type });
    }
    const reviews = prepareCoordinationReviews(world, eid, coordinationReviews, { newIntention: intention });
    const boundWorkRef = typeof actionWorkHint === "string"
      ? reviews ? getPreparedCoordinationWork(world, eid, reviews, actionWorkHint) : readWork(actionWorkHint) : undefined;
    if (actionWorkHint !== undefined && !boundWorkRef) {
      return reject("undertaking_not_admitted", { actionType: selectedAction.type });
    }
    const action: AgentAction = {
      ...selectedAction,
      ...(draftAction.stopSpeechId ? { stopSpeechId: draftAction.stopSpeechId } : {}),
      ...(boundWorkRef ? { coordinationWork: boundWorkRef } : {}),
      ...(actionGoalHint === "new" && intention ? { coordinationGoal: getPreparedIntentionGoalRef(world, eid, intention) }
        : requestedGoalRef ? { coordinationGoal: Object.freeze({ ...requestedGoalRef }) } : {}),
    };
    // A closing action cannot detach from the review that explains why the
    // previously organizing intention is no longer its purpose.
    const required = !!nextPurposeUpdate || !!planDecision || queuedGoalReview || closingGoalReference || !!action.stopSpeechId || !isPhysicalForegroundAction(action) || actionGoalHint === "new" || undertakesPriorSpeech
      || !!boundWorkRef && JSON.stringify(boundWorkRef) !== JSON.stringify(requestedWorkRef);
    if (responseMentalChange && required) return responseMentalChange === "cancelled" ? reject("cancelled")
      : superseded(responseMentalChange as ForegroundDiscardReason | ForegroundSemanticDiscardReason);
    let acceptedCoordinationReviews = 0;
    let coordinationChanges: Array<{ id: string; status?: string; reported?: string }> = [];
    let continuationRevision: number | undefined;
    let executionGoalBasis = issuedStableGoals, executionAffectBasis = issuedAffectContext;
    const relevantSpeech = (turn: { target?: string; speaker: string; own: boolean }) => !turn.own
      && (turn.target === name || turn.speaker === action.target && (!turn.target || turn.target === name)
        || action.type === "speak" && !action.target && !turn.target);
    const actionAttentionAtRequest = new Set(attentionKeys);
    const checkIndependentExecution = (): ForegroundAdmissionFailure | undefined => {
      if (!current()) return "cancelled";
      if (action.listeningTo && !getListeningActivities(world, eid).some(row => row.executionId === action.listeningTo)) return "voice_changed";
      if (chosenWait && !chosenWait.current()) return "source_changed";
      const continuation = snapshotActorContinuation(world, eid);
      if (continuation?.revision !== continuationRevision || continuation?.status === "needs_revision") return "source_changed";
      if (stableGoalBasis() !== executionGoalBasis) return "goal_changed";
      if (formatAffectContext(world, eid) !== executionAffectBasis) return "source_changed";
      if (JSON.stringify(getIdentityAnchors(world, eid)) !== issuedIdentityMeanings) return "source_changed";
      if (narrative && emotionalLifeBasis(world, eid) !== issuedEmotionalLife) return "source_changed";
      // New words can require a new reply, without erasing the interpretation
      // of words actually heard earlier. Unrelated speakers don't veto actions.
      if (action.type === "speak") {
        if (getSocialDialogue(world, eid).some(turn => relevantSpeech(turn) && !heardDialogue.has(turn.id))) return "dialogue_changed";
        if (getSocialSpeechFragments(world, eid).some(fragment => relevantSpeech(fragment) && fragment.notifiedLength > 0
          && !issuedSpeechFragments.some(old => old.id === fragment.id && old.notifiedToken === fragment.notifiedToken
            && old.content.slice(0, old.notifiedLength) === fragment.content.slice(0, fragment.notifiedLength)))) return "dialogue_changed";
      }
      if (getAgentPerceptions(world, eid).some(pid => ["danger", "intent", "attention", "daemon_whisper", "daemon_challenge", "action_failed"].includes(Perception.type[pid])
        && !actionAttentionAtRequest.has(attentionKey(eid, pid)))) return "source_changed";
      if (snapshotAttentionSignals(world, eid).some(signal => !issuedAttentionSignals.some(old => old.id === signal.id))) return "source_changed";
    };
    const bound = bindForegroundAction(world, eid, foregroundFence!, action, expressedThought || "", {
      ...(independent ? { independent: { purpose: result.control.purpose, localDependencies: localDependencies!, checkExecution: checkIndependentExecution,
        status: (status: "waiting" | "needs_revision" | "dispatched", reason?: string) => {
          if (continuationRevision !== undefined) updateActorContinuation(world, eid, continuationRevision, status, reason);
        } } } : {}),
      required, discardedAtResponse: responseMentalChange, checkActionBindings,
      checkCurrent: () => checkMentalSources()
        || (heardAppraisal && !heardAppraisal.current() ? "source_changed" : undefined)
        || (motorPlan && !motorPlan.current() ? "local_view_changed" : undefined)
        || (goalReview && !goalReview.current() ? "source_changed" : undefined)
        || (attentionReview && !attentionReview.current() ? "source_changed" : undefined)
        || (activityReview && !activityReview.current() ? "source_changed" : undefined)
        || (planDecision && !planDecision.current() ? "source_changed" : undefined)
        || (nextPurposeUpdate && !nextPurposeUpdate.current() ? "source_changed" : undefined)
        || (affect && !isPreparedAffectCurrent(world, eid, affect) ? "source_changed" : undefined)
        || (intention && !isPreparedIntentionCurrent(world, eid, intention) ? "goal_changed" : undefined)
        || (reviews && !isPreparedCoordinationCurrent(world, eid, reviews) ? "coordination_changed" : undefined),
      commit: () => {
        if (activityReview && !activityReview.commit()) return "source_changed";
        if (planDecision && !planDecision.commit()) return "source_changed";
        // All rejection-capable preparation ran before any ECS mutation. The
        // prospective goal/work identities already match the signed action.
        const committedGoal = intention ? commitPreparedIntention(world, eid, intention) : null;
        if (intention && committedGoal === null) return "new_goal_not_admitted";
        if (affect && !commitPreparedAffectUpdate(world, eid, affect)) return "source_changed";
        acceptedCoordinationReviews = reviews ? commitPreparedCoordinationReviews(world, eid, reviews) : 0;
        coordinationChanges = acceptedCoordinationReviews ? getCoordinationMemory(world, eid).items.filter(item =>
          JSON.stringify(coordinationMemory.items.find(previous => previous.id === item.id)) !== JSON.stringify(item))
          .map(item => ({ id: item.id, status: item.localStatus, reported: item.lastReported?.status })) : [];
        if (goalReview && !(queuedGoalReview ? goalReview.queueForReconsideration() : goalReview.commit())) return "source_changed";
        if (attentionReview && !attentionReview.commit()) return "source_changed";
        if (motorPlan) {
          const planEid = motorPlan.commit();
          if (planEid !== undefined) chronicle.record("motor_plan_admitted", { agent: name, agentEid: eid, requestId: foregroundFence!.requestId, planEid,
            ...(motorPlan.replacedPlanEid !== undefined ? { replacedPlanEid: motorPlan.replacedPlanEid } : {}) });
        }
        const socialReview = coalescedSocialReview ? undefined : reviewSocialGoal(world, eid, result.socialGoalReview);
        if (socialReview) {
          addMemory(world, eid, { type: "episodic", content: `My personal social goal "${Goal.description[socialReview.goalId]}" feels satisfied for now: ${socialReview.reason}`, importance: .7, emotionalValence: .2, timestamp: Date.now() });
          chronicle.record("goal_completed", { agent: Name.value[eid], goal: Goal.description[socialReview.goalId], reason: socialReview.reason, source: "subjective_social_review" });
          try { getAgentWorldCapabilities(world, eid)?.onSocialGoalSatisfied?.(socialReview.goalId, socialReview.reason); }
          catch { console.warn("[AgentMind] Social-goal notification failed after admission."); }
        }
        for (const key of projectedAttentionKeys) seen.add(key);
        markAttentionSignalsPresented(world, eid, issuedAttentionSignals);
        if (seen.size > 1000) { const recent = [...seen].slice(-500); seen.clear(); recent.forEach(key => seen!.add(key)); }
        const focusGoal = focusHint === "new" ? committedGoal ?? undefined
          : typeof focusHint === "number" ? focusHint : undefined;
        if (independent) continuationRevision = integrateActorContinuation(world, eid, {
          purpose: result.control.purpose, actionType: action.type, target: action.target, observedAtSimMs,
          requestId: foregroundFence!.requestId,
          ...(focusGoal !== undefined ? { goalId: focusGoal, goalKey: WorkingMemoryIdentity.id[focusGoal] } : {}),
          ...(pursuit && result.control.switchReason ? { switchReason: result.control.switchReason } : {}),
          ...(result.control.activityDisposition ? { activityDisposition: result.control.activityDisposition } : {}),
          ...(nextPurposeUpdate ? { nextPurpose: nextPurposeUpdate.value } : {}),
        });
        if (independent) {
          actionBindingWork = boundWorkRef; actionBindingGoal = action.coordinationGoal;
          actionCoordinationScope.goalRefs = [action.coordinationGoal];
          actionCoordinationBasis = currentCoordinationDependency(world, eid, actionCoordinationScope);
          executionGoalBasis = stableGoalBasis(); executionAffectBasis = formatAffectContext(world, eid);
        }
        if (activityReview) chronicle.record("activity_review", { agent: name, agentEid: eid,
          requestId: foregroundFence!.requestId, ...activityReview.summary });
        if (planDecision) chronicle.record(planDecision.detached ? "plan_decision_detached" : "plan_decision_review", { agent: name, agentEid: eid,
          requestId: foregroundFence!.requestId, ...planDecision.summary });
        if (nextPurposeUpdate?.summary) chronicle.record("next_purpose_review", { agent: name, agentEid: eid,
          requestId: foregroundFence!.requestId, ...nextPurposeUpdate.summary });
        recordControlLoopDiagnostic(world, () => ({ lane: "foreground", actorId: eid,
          requestId: foregroundFence!.requestId, stage: "integrated", detail: {
            ...foregroundChoiceDiagnostic(result), nextPurpose: snapshotActorContinuation(world, eid)?.nextPurpose,
          } }));
        if (queuedGoalReview || coalescedSocialReview) chronicle.record("goal_handoff_review", { agentEid: eid,
          requestId: foregroundFence!.requestId, goalId: goalReview!.goalId,
          disposition: goalReview!.disposition, queued: queuedGoalReview, coalesced: coalescedSocialReview });
        addConversationTurn(world, eid, "user", loggedPrompt);
        addConversationTurn(world, eid, "assistant", text);
        if (expressedThought !== undefined) addThought(world, eid, { content: expressedThought, type: "reasoning", ...(independent ? { observedAtSimMs } : {}) });
        if (heardAppraisal) {
          const queued = heardAppraisal.commit();
          chronicle.record("heard_appraisal_selected", { agent: name, agentEid: eid, requestId: foregroundFence!.requestId,
            eventIds: heardAppraisal.ids, queued });
        }
      },
      admitted: mentalUpdate => {
        if (mentalUpdate === "admitted" && expressedThought !== undefined) console.log(`[${name}] thinks: "${expressedThought}"`);
        console.log(`[${name}] action: ${action.type}${action.target ? ` → ${action.target}` : ""}${action.content ? ` - "${action.content}"` : ""}`);
        chronicle.record("llm_decision", { agent: name, agentEid: eid, requestId: foregroundFence!.requestId,
          actionType: action.type, origin: "model", action: `${action.type}${action.target ? "→" + action.target : ""}`, mentalUpdate,
          ...(mentalUpdate === "admitted" && expressedThought !== undefined ? { reasoning: expressedThought.slice(0, 150) } : {}),
          ...(acceptedCoordinationReviews ? { acceptedCoordinationReviews, coordinationChanges } : {}) });
        recordSelectedAction(world, eid, action, true);
      },
    });
    if (independent) {
      const integrationFailure = integrateForegroundAction(world, eid, bound);
      if (integrationFailure) return superseded(integrationFailure as ForegroundSemanticDiscardReason);
    }
    return bound;
  } catch (error) {
    // Cancellation/provider/parse failures are operator events, not NPC choices
    // or action failures. Never dump provider bodies (which can echo prompts).
    const reason = !current() ? "cancelled" : deadline.aborted || (error && typeof error === "object" && "name" in error && error.name === "TimeoutError")
      ? "timeout" : rejectionPhase;
    if (!providerReturned) reportProvider(reason === "timeout" ? "timeout" : reason === "cancelled" ? "cancelled" : "error");
    return reject(reason);
  } finally {
    try {
      chronicle.record("foreground_attempt_finished", { agent: name, agentEid: eid,
        requestId: foregroundFence?.requestId, durationWallMs: Math.round(performance.now() - foregroundStarted) });
    } catch { /* Observers cannot change cognition. */ }
  }
}

function buildDeterministicSpeechReply(world: World, agentEid: number): AgentAction | null {
  const perceptionEids = getAgentPerceptions(world, agentEid)
    .filter((peid) => String(Perception.type[peid] || "") === "speech")
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 1);
  const peid = perceptionEids[0];
  if (typeof peid !== "number") return null;

  const at = Perception.timestamp[peid] || 0;
  // Only respond to recent speech.
  if (at <= 0 || simulationAge(world, peid, "Perception.timestamp", at) > 15_000) return null;

  const speaker = String(Perception.source[peid] || "").trim();
  if (!speaker || speaker.toLowerCase() === "self") return null;

  const content = String(Perception.content[peid] || "").trim();
  const signature = `${speaker}|${content.slice(0, 200)}`;

  const prev = speechReplyCache(world).get(agentEid);
  if (prev && prev.signature === signature && readSimulationTime(world) - prev.atMs < SPEECH_REPLY_DEDUP_WINDOW_MS) return null;

  const greeting =
    content.toLowerCase().includes("good morning") ? "Good morning" :
    content.toLowerCase().includes("good evening") ? "Good evening" :
    content.toLowerCase().includes("hello") ? "Hello" :
    "Hi";

  const reply = `${greeting}, ${speaker}.`;
  speechReplyCache(world).set(agentEid, { signature, atMs: readSimulationTime(world) });
  Mind.focus[agentEid] = ""; // clear "respond to ..." focus once we answer

  return { type: "speak", target: speaker, content: reply };
}

export async function processAgentCognition(
  world: World,
  eid: number,
  stimuli: Array<{ type: string; content: string; source: string; intensity?: number; timestamp?: number }>,
  guard: CognitionGuard = {}
): Promise<AgentAction> {
  for (const stimulus of stimuli) {
    addPerception(world, eid, stimulus);
  }

  // addPerception applies salience/novelty, not the number of prompt lines.

  return agentThink(world, eid, guard);
}

export function getAgentMemory(world: World, eid: number): {
  perceptions: Array<{ type: string; content: string; source: string; timestamp: number }>;
  thoughts: Array<{ content: string; timestamp: number }>;
  recentActions: AgentAction[];
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const perceptionEids = getAgentPerceptions(world, eid);
  const perceptions = perceptionEids.map(peid => ({
    type: Perception.type[peid],
    content: Perception.content[peid],
    source: Perception.source[peid],
    timestamp: Perception.timestamp[peid],
  }));

  const thoughtEids = getAgentThoughts(world, eid);
  const thoughts = thoughtEids.map(teid => ({
    content: Thought.content[teid],
    timestamp: Thought.timestamp[teid],
  }));

  const conversationEids = getAgentConversation(world, eid);
  const conversationHistory = conversationEids.map(ceid => ({
    role: ConversationTurn.role[ceid] as "user" | "assistant",
    content: ConversationTurn.content[ceid],
  }));

  return {
    perceptions,
    thoughts,
    recentActions: [],
    conversationHistory,
  };
}
