import { generateText } from "ai";
import * as fs from "node:fs";
import * as path from "node:path";
import { agentModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import type { World } from "../ecs/world";
import { addEntity, addComponent, removeEntity, query, getRelationTargets, hasComponent } from "bitecs";
import { Name, Description, Agent, Mind, Room, Thought, Perception, ConversationTurn, Goal, Personality, KanbanCard, KanbanColumn, PendingToolJob, BehaviorPolicy } from "../ecs/components";
import { HasThought, HasPerception, HasConversation, HasGoal } from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import {
  getKnowledgeSummary,
  getRelevantMemories,
  getImpressionOf,
  getAgentMemories
} from "./knowledge-graph";
import { Memory, Plan, Schedule, ReflectionState } from "../ecs/components";
import { HasPlan, HasSchedule, HasReflectionState } from "../ecs/relations";
import { formatPlansForContext, getNextPlannedAction } from "./planning-system";
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
import { trackGoalAction, formatAspirationsForContext } from "./goal-learning";
import { formatSkillsForContext } from "./skill-registry";
import { chronicle } from "./simulation-chronicle";
import { generateAutonomousGoal, shouldGenerateGoal, advanceGoalTick } from "./autonomous-goals";
import { formatWorldTimeForContext } from "../systems/world-clock";

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
const recentSpeechReplies = new Map<number, { signature: string; atMs: number }>();
const SPEECH_REPLY_DEDUP_WINDOW_MS = 30_000;


// Optional multimodal cognition: attach recently perceived image assets directly into Gemini context.
// Off by default for stability + cost control.
const recentMultimodalImageAttachment = new Map<number, { signature: string; atMs: number }>();
const MULTIMODAL_IMAGE_DEDUP_WINDOW_MS = 60_000;

// Optional image reflection: trigger a single short multimodal critique when a new image asset is perceived.
// This is separate from action selection (plans/contracts still drive actions) and is off by default.
const recentMultimodalImageReflection = new Map<number, { signature: string; atMs: number }>();
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

function buildUserContentWithImages(world: World, agentEid: number, prompt: string): { content: any; attached: string[] } {
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
    if (!at || now - at > 120_000) continue;

    const parsed = parseImageAssetStimulus(String(Perception.content[peid] || ""));
    const deviceName = parsed.deviceName || "Workstation";
    const deviceEid = findDeviceInRoom(world, agentEid, deviceName);
    if (deviceEid === undefined) continue;

    for (const relPath of parsed.paths) {
      if (attached.length >= max) break;

      const signature = `${deviceEid}|${relPath}`;
      const prev = recentMultimodalImageAttachment.get(agentEid);
      if (prev && prev.signature == signature && now - prev.atMs < MULTIMODAL_IMAGE_DEDUP_WINDOW_MS) continue;

      const img = readWorkspaceImageBytes(world, deviceEid, relPath);
      if (!img) continue;

      parts.push({ type: "image", image: img.data, mediaType: img.mediaType });
      attached.push(`${deviceName}:${relPath}`);
      recentMultimodalImageAttachment.set(agentEid, { signature, atMs: now });
    }

    if (attached.length >= max) break;
  }

  if (attached.length === 0) return { content: prompt, attached };
  return { content: parts, attached };
}

async function maybeAddImageReflectionThought(world: World, agentEid: number): Promise<void> {
  if (!getConfiguredGeminiApiKey()) return;
  if (process.env.COGNITION_DISABLE_LLM_IMAGE_REFLECTION === "1") return;
  if (!shouldGenerateImageReflection(agentEid)) return;
  if (hasComponent(world as any, agentEid, PendingToolJob as any)) return;

  const now = Date.now();
  const latest = getAgentPerceptions(world as any, agentEid)
    .filter((peid) => String(Perception.type[peid] || "") === "image_asset")
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))[0];

  if (typeof latest !== "number") return;
  const at = Number(Perception.timestamp[latest] || 0);
  if (!at || now - at > 120_000) return;

  const parsedSig = parseImageAssetStimulus(String(Perception.content[latest] || ""));
  const signature = `${String(Perception.source[latest] || "")}|${String(parsedSig.deviceName || "Workstation")}|${parsedSig.paths.slice(0, 3).join(",")}`;
  const prev = recentMultimodalImageReflection.get(agentEid);
  if (prev && prev.signature === signature && now - prev.atMs < MULTIMODAL_IMAGE_REFLECTION_DEDUP_WINDOW_MS) return;

  const prompt =
    `You have just perceived a new visual asset in your environment.
` +
    `Provide a short critique and 3 concrete suggestions to improve it for its intended product.
` +
    `Be specific (colors, shapes, legibility, brand fit). Keep it under 8 bullet points.`;

  const mm = buildUserContentWithImages(world, agentEid, prompt);
  if (mm.attached.length === 0) {
    // Mark as handled to avoid noisy repeat attempts when the asset can't be attached.
    recentMultimodalImageReflection.set(agentEid, { signature, atMs: now });
    return;
  }

  const context = buildAgentContext(world, agentEid);
  const loggedPrompt = `${prompt}

[Images attached: ${mm.attached.join(", ")}]`;

  try {
    const { text } = await generateText({
      model,
      system: context,
      messages: [{ role: "user" as const, content: mm.content }],
    });

    addConversationTurn(world, agentEid, "user", loggedPrompt);
    addConversationTurn(world, agentEid, "assistant", text);
    addThought(world, agentEid, { content: text, type: "visual_reflection" });
    recentMultimodalImageReflection.set(agentEid, { signature, atMs: now });
  } catch {
    // Best-effort only: never block core simulation behavior on reflection.
    recentMultimodalImageReflection.set(agentEid, { signature, atMs: now });
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
}

function normalizeSelectedAction(world: World, agentEid: number, action: AgentAction, wasLlmFallback: boolean = false): AgentAction {
  // Avoid common no-op loops: e.g. a policy repeatedly selecting "move -> <current room>".
  // Returning "wait" keeps the event stream honest (no state change) and avoids thrash scoring.
  if (action.type === "move" && action.target) {
    const wanted = String(action.target || "").trim().toLowerCase();
    // Validate target is actually a room — reject moves to objects/agents/etc.
    const allRooms = Array.from(query(world as any, [Room as any, Name as any]));
    const isRoom = allRooms.some(rid => {
      const rn = String(Name.value[rid] || "").trim().toLowerCase();
      return rn && rn === wanted;
    });
    if (!isRoom) {
      return { type: "observe", target: action.target };
    }

    const roomEid = getRoomForEntity(world as any, agentEid);
    if (roomEid !== undefined) {
      const currentRoomName = String(Name.value[roomEid] || "").trim().toLowerCase();
      if (currentRoomName && wanted && currentRoomName === wanted) {
        // Already in this room — convert to wait
        return { type: "wait" };
      }
    }

    // Suppress ALL moves when agent is already in transit (grid movement or goal-based).
    const movTarget = getMovementTarget(agentEid);
    if (movTarget !== undefined) {
      return { type: "wait" };
    }

    // Suppress moves when any active movement goal exists (goal may not have set movementTarget yet).
    const goalEids = getRelationTargets(world as any, agentEid, HasGoal as any);
    for (const gid of goalEids) {
      if (!hasComponent(world as any, gid, Goal as any)) continue;
      if (String(Goal.status[gid] || "") !== "active") continue;
      const desc = String(Goal.description[gid] || "").toLowerCase();
      if (desc.includes("go to") || desc.includes("follow schedule")) {
        return { type: "wait" };
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

  // Record action for The Watcher's behavioral analysis
  try {
    const { recordAgentAction } = require("../spirits/watcher-spirit");
    recordAgentAction(agentEid, action.type);
  } catch {}

  // Record action for policy effectiveness metrics
  try {
    recordPolicyAction(agentEid, action.type, wasLlmFallback);
  } catch {}

  // Track action against active goals for intent-aware skill compilation
  try {
    trackGoalAction(world, agentEid, {
      type: action.type,
      target: action.target,
      content: action.content,
      affordance: action.type === "interact" ? action.content?.split(/\s+/)[0] : undefined,
    });
  } catch {}

  return action;
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
  data: { type: string; content: string; source: string; intensity?: number }
): number {
  const perceptionEid = addEntity(world);
  addComponent(world, perceptionEid, Perception);
  addComponent(world, agentEid, HasPerception(perceptionEid));

  Perception.type[perceptionEid] = data.type;
  Perception.content[perceptionEid] = data.content;
  Perception.source[perceptionEid] = data.source;
  Perception.intensity[perceptionEid] = data.intensity ?? 1;
  Perception.timestamp[perceptionEid] = Date.now();

  prunePerceptions(world, agentEid, 20);

  return perceptionEid;
}

function prunePerceptions(world: World, agentEid: number, maxPerceptions: number): void {
  const perceptionEids = getAgentPerceptions(world, agentEid);
  if (perceptionEids.length <= maxPerceptions) return;

  const sorted = perceptionEids.sort((a, b) => 
    (Perception.timestamp[a] || 0) - (Perception.timestamp[b] || 0)
  );

  const toRemove = sorted.slice(0, sorted.length - maxPerceptions);
  for (const eid of toRemove) {
    removeEntity(world, eid);
  }
}

export function addThought(
  world: World,
  agentEid: number,
  data: { content: string; type?: string; salience?: number }
): number {
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

  pruneThoughts(world, agentEid, 10);

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
  
  const knowledgeSummary = getKnowledgeSummary(world, eid);
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
  if (othersInRoom.length === 0) return "You are alone. No social obligations.";

  const lines: string[] = [];
  const agentName = Name.value[agentEid] || "";
  const personality = hasComponent(world as any, agentEid, Personality as any) ? {
    agreeableness: Personality.agreeableness[agentEid] ?? 0.5,
    extraversion: Personality.extraversion[agentEid] ?? 0.5,
  } : { agreeableness: 0.5, extraversion: 0.5 };

  // Social norms preamble
  lines.push("When someone is present and speaks to you:");
  lines.push("- ALWAYS acknowledge them and respond to what they said BEFORE pursuing your own agenda.");
  lines.push("- Consider whether they might be able to help with your current concerns.");
  lines.push("- A stranger who just arrived might have news, skills, or resources you need.");
  if (personality.agreeableness > 0.6) {
    lines.push("- You are naturally warm and accommodating — make them feel welcome.");
  } else if (personality.agreeableness < 0.3) {
    lines.push("- You are gruff and direct, but still answer questions when asked.");
  }

  // Per-person assessment with graduated disclosure
  for (const otherName of othersInRoom) {
    const impression = getImpressionOf(world, agentEid, otherName);
    const allAgents = Array.from(query(world as any, [Agent as any, Name as any]));
    const otherEid = allAgents.find(e => Name.value[e] === otherName);
    const otherRole = otherEid ? (Agent.role[otherEid] || "") : "";

    // Count conversation depth — how many times have we spoken?
    let conversationDepth = 0;
    if (otherEid) {
      try {
        const convEids = getRelationTargets(world as any, agentEid, HasConversation as any);
        conversationDepth = convEids.filter(cid =>
          hasComponent(world as any, cid, ConversationTurn as any) &&
          (ConversationTurn.content[cid] || "").toLowerCase().includes(otherName.toLowerCase())
        ).length;
      } catch {}
    }

    if (impression) {
      const s = impression.overallSentiment;
      const feel = s > 0.3 ? "positively" : s < -0.3 ? "warily" : "neutrally";
      lines.push(`- ${otherName} (${otherRole}): You feel ${feel} toward them. You've spoken ${conversationDepth > 0 ? conversationDepth + " times" : "briefly"}.`);
    } else {
      lines.push(`- ${otherName}: A stranger${otherRole ? ` who appears to be a ${otherRole}` : ""}. You haven't met before.`);
      lines.push(`  Consider: could this person help with your goals? Do they have information you need?`);
    }

    // Graduated information disclosure guidance
    if (conversationDepth <= 1) {
      lines.push(`  DISCLOSURE LEVEL: GUARDED. This is a new acquaintance. Be polite but share only surface-level information. Deflect sensitive questions. BUT still answer what they ask — don't ignore the question.`);
    } else if (conversationDepth <= 3) {
      lines.push(`  DISCLOSURE LEVEL: OPENING. You've talked a few times. Share hints and partial truths. Let slip small details that show you know more than you're saying. Drop a clue or name they haven't heard.`);
    } else if (conversationDepth <= 6) {
      lines.push(`  DISCLOSURE LEVEL: TRUSTING. You've had real conversations. Share real concerns, admit fears, reveal pieces of what you know. If they've been helpful, be more forthcoming.`);
    } else {
      lines.push(`  DISCLOSURE LEVEL: CONFIDING. This person has earned your trust through sustained interaction. Share deeper secrets if pressed. Be honest about your real motivations and fears.`);
    }
  }

  return lines.join("\n");
}

function buildAgentContext(world: World, eid: number): string {
  const name = Name.value[eid];
  const description = Description.value[eid];
  const role = Agent.role[eid];
  const systemPrompt = Agent.systemPrompt[eid];
  const mode = Mind.mode[eid];
  const arousal = Mind.arousal[eid];
  const focus = Mind.focus[eid];

  const roomEid = getRoomForEntity(world, eid);
  let roomContext = "nowhere in particular";
  let roomDescription = "";
  let roomAmbience = "";
  let othersInRoom: string[] = [];
  let objectsInRoom: string[] = [];

  if (roomEid !== undefined) {
    roomContext = Name.value[roomEid] || "an unknown room";
    roomDescription = Description.value[roomEid] || "";
    roomAmbience = Room.ambience[roomEid] || "";

    const agents = Array.from(query(world, [Agent]));
    for (const otherEid of agents) {
      if (otherEid === eid) continue;
      if (getRoomForEntity(world, otherEid) === roomEid) {
        const otherName = Name.value[otherEid];
        if (otherName) othersInRoom.push(otherName);
      }
    }

    // List objects in the room so the agent knows what's available to interact with
    for (const child of listDirectContents(world, roomEid)) {
      if (child === eid) continue;
      if (hasComponent(world, child, Agent)) continue; // Skip other agents (listed separately)
      const objName = Name.value[child];
      if (objName) objectsInRoom.push(objName);
    }
  }

  const perceptionEids = getAgentPerceptions(world, eid);
  const recentPerceptions = perceptionEids
    .sort((a, b) => (Perception.timestamp[b] || 0) - (Perception.timestamp[a] || 0))
    .slice(0, 5);

  const thoughtEids = getAgentThoughts(world, eid);
  const recentThoughts = thoughtEids
    .sort((a, b) => (Thought.timestamp[b] || 0) - (Thought.timestamp[a] || 0))
    .slice(0, 3);

  // Get active goals
  const goalTargets = getRelationTargets(world, eid, HasGoal);
  const activeGoals = goalTargets
    .filter(gid => hasComponent(world, gid, Goal) && Goal.status[gid] === "active")
    .sort((a, b) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0))
    .slice(0, 5);

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

  return `You are ${name}.

IDENTITY:
${description}

ROLE: ${role}

BEHAVIORAL GUIDELINES:
${systemPrompt}

CURRENT STATE:
- Location: ${roomContext}${roomDescription ? ` — ${roomDescription}` : ""}
- Objects here: ${objectsInRoom.length > 0 ? objectsInRoom.join(", ") : "nothing notable"}
- Others Present: ${othersInRoom.length > 0 ? othersInRoom.join(", ") : "no one else"}
- Ambience: ${roomAmbience || "quiet"}
- Mental Mode: ${mode}
- Arousal Level: ${(arousal * 100).toFixed(0)}%
- Current Focus: ${focus || "nothing specific"}
${personalityTraits ? `- Temperament: ${formatPersonality(personalityTraits)}` : ""}

SOCIAL AWARENESS:
${buildSocialContext(world, eid, othersInRoom)}

ACTIVE GOALS:
${activeGoals.length > 0
  ? activeGoals.map(gid => {
      const progress = Goal.progress[gid] || 0;
      const priority = Goal.priority[gid] || 5;
      return `- [Priority ${priority}] ${Goal.description[gid]} (${progress}% complete)`;
    }).join("\n")
  : "No specific goals right now."}

RECENT PERCEPTIONS:
${recentPerceptions.length > 0 
  ? recentPerceptions.map(eid => `[${Perception.type[eid]}] ${Perception.content[eid]} (from: ${Perception.source[eid]})`).join("\n")
  : "Nothing notable recently."}

RECENT THOUGHTS:
${recentThoughts.length > 0
  ? recentThoughts.map(eid => `- ${Thought.content[eid]}`).join("\n")
  : "Mind is clear."}

${buildKnowledgeContext(world, eid, othersInRoom)}

${formatPlansForContext(world, eid)}

${formatScheduleForContext(world, eid)}

${formatInsightsForContext(world, eid)}

${formatAspirationsForContext(eid)}

${formatSkillsForContext(eid)}

${formatWorldTimeForContext(world)}`;
}

export async function agentThink(world: World, eid: number): Promise<AgentAction> {
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

  // Optional multimodal reflection: capture a brief critique when new image assets appear.
  // This helps agents "see" Nano Banana output (and makes it inspectable in logs) without
  // turning every tick into freeform LLM action selection.
  await maybeAddImageReflectionThought(world, eid);

  // Deterministic "skill reflex": if we already know a proven procedure for the next plan step,
  // execute it without spending an LLM call.
  const procedural = selectProceduralAction(world, eid);
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
  const recovery = hasBehaviorPolicy ? null : selectFailureRecoveryAction(world as any, eid);
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
  if (!getConfiguredGeminiApiKey()) {
    const reply = buildDeterministicSpeechReply(world, eid);
    if (reply) return normalizeSelectedAction(world, eid, reply);
  }

  // Deterministic contract-driven *org* step selection:
  // Prefer governance/coordination moves (kanban/wiki) before plan execution so agents can
  // satisfy "claim ticket"/"move columns" gates that unlock work tools.
  const contract = selectContractDrivenAction(world as any, eid);
  if (contract && contract.type !== "wait") {
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
  // Skip for behavior-policy agents: their template already covers observe/interact/wander patterns,
  // and schedule-generated micro-plans (observe → interact) starve the policy from ever running.
  if (!hasBehaviorPolicy) {
    const nextPlanned = getNextPlannedAction(world, eid);
    if (nextPlanned) {
      return normalizeSelectedAction(world, eid, {
        type: nextPlanned.actionType as any,
        target: nextPlanned.target,
        content: nextPlanned.content,
      });
    }
  }

  // ── Autonomous Goal Generation (parallel cognitive process) ──
  if (getConfiguredGeminiApiKey() && shouldGenerateGoal(world, eid)) {
    generateAutonomousGoal(world, eid).catch(() => {});
  }

  // ── Directed Speech Override ──
  // When someone speaks directly to this agent, bypass the BT and go to LLM.
  // The BT handles routine behavior but social response to speech takes priority.
  const hasPendingSpeech = (() => {
    if (!getConfiguredGeminiApiKey()) return false;
    const perceptionEids = getAgentPerceptions(world, eid);
    return perceptionEids.some(pid => {
      if (!hasComponent(world as any, pid, Perception as any)) return false;
      const pType = Perception.type[pid] || "";
      const pTimestamp = Perception.timestamp[pid] || 0;
      return (pType === "directed_speech" || pType === "speech") &&
             (Date.now() - pTimestamp) < 10000;
    });
  })();

  // Deterministic policy layer — skip if someone just spoke to us
  if (!hasPendingSpeech) {
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
  if (contract && contract.type !== "wait") {
    const name = Name.value[eid];
    console.log(`[${name}] contract: ${contract.type}${"target" in contract && contract.target ? ` -> ${contract.target}` : ""}`);
    return normalizeSelectedAction(world, eid, contract as any);
  }

  // Deterministic mode: if no LLM key is configured, do not attempt generation.
  if (!getConfiguredGeminiApiKey()) {
    return { type: "wait" };
  }

  // Prefer planner-driven behavior for hard, benchmarked workflows; freeform per-tick LLM actions are optional.
  if (process.env.COGNITION_DISABLE_LLM_ACTION_SELECTION === "1") {
    return { type: "wait" };
  }

  const context = buildAgentContext(world, eid);
  const name = Name.value[eid];

  const conversationEids = getAgentConversation(world, eid);
  const conversationHistory = conversationEids.slice(-6).map(turnEid => ({
    role: ConversationTurn.role[turnEid] as "user" | "assistant",
    content: ConversationTurn.content[turnEid],
  }));

  // Get dynamic actions based on agent's components, location, and environment
  const actionsContext = formatActionsForPrompt(world, eid);
  const validTypes = getValidActionTypes(world, eid);

  const prompt = `Based on your current situation, perceptions, goals, plans, schedule, and character, decide what to do next.

${actionsContext}

DECISION PRIORITIES:
1. FIRST check your RECENT PERCEPTIONS for action feedback (🚨 CRITICAL failures, ✅ successes)
   - If your last action FAILED, you MUST acknowledge it and try something DIFFERENT
   - Do NOT repeat failed actions or assume they succeeded
2. Check your INVENTORY to know what you actually have - don't assume you picked something up
3. If you have CRITICAL NEEDS (hunger/energy), address them
4. If you have an ACTIVE PLAN, follow the current step
5. Consider your SCHEDULE - what activity should you be doing now?
6. Work toward your ACTIVE GOALS
7. React naturally to your perceptions and surroundings

CRITICAL RULE:
- If your perception shows "🚨 CRITICAL - YOUR LAST ACTION FAILED", you MUST acknowledge this failure
- Never say "I have X" unless X appears in your INVENTORY
- Never say "I did X" unless your perception shows "✅ SUCCESS"

IMPORTANT:
- Only use actions from the list above
- When moving, use exact location names from "PLACES YOU CAN GO"
- When interacting with objects or people, use their exact names
- Your action type MUST be one of: ${validTypes.join(", ")}

Respond with JSON only:
{
  "innerThought": "Your internal reasoning about what to do",
  "action": {
    "type": "<action_type>",
    "target": "optional - exact name of who/what from the lists above",
    "content": "optional - what you say/think/do"
  }
}

RESPONSE EXAMPLES:
Example 1 - Moving to a location:
{"innerThought": "The market sounds busy. I should go check it out.", "action": {"type": "move", "target": "Market"}}

Example 2 - Interacting with an object:
{"innerThought": "That old book looks interesting. Let me take a closer look.", "action": {"type": "interact", "target": "Ancient Tome", "content": "examine"}}

Example 3 - Speaking to someone:
{"innerThought": "Alice looks like she could use some company.", "action": {"type": "speak", "target": "Alice", "content": "Good morning! How are you today?"}}

Stay in character. Be concise. React naturally to your perceptions and surroundings.`;


  const mm = buildUserContentWithImages(world, eid, prompt);
  const userContent = mm.content;
  const loggedPrompt = mm.attached.length ? `${prompt}

[Images attached: ${mm.attached.join(", ")}]` : prompt;
  try {
    const { text } = await generateText({
      model,
      system: context,
      messages: [
        ...conversationHistory,
        {
          role: "user" as const,
          content: userContent,
        },
      ],
      temperature: AGENT_COGNITION_TEMPERATURE,
    });

    const jsonStr = extractJSON(text);
    if (!jsonStr) {
      return { type: "wait" };
    }

    const result = JSON.parse(jsonStr);
    
    if (result.innerThought) {
      addThought(world, eid, { content: result.innerThought, type: "reasoning" });
    }

    const action: AgentAction = {
      type: result.action?.type || "wait",
      target: result.action?.target,
      content: result.action?.content,
    };

    addConversationTurn(world, eid, "user", loggedPrompt);
    addConversationTurn(world, eid, "assistant", text);

    console.log(`[${name}] thinks: "${result.innerThought || ""}"`);
    console.log(`[${name}] action: ${action.type}${action.target ? ` → ${action.target}` : ""}${action.content ? ` - "${action.content}"` : ""}`);

    // Capture this LLM decision for potential BT compilation
    captureLLMDecision(world, eid, result.innerThought || "",
      { type: action.type as any, target: action.target, content: action.content },
      action.type === "interact" ? (action.content?.split(/\s+/)[0] || undefined) : undefined);

    // Chronicle: record the LLM decision
    chronicle.record("llm_decision", {
      agent: name,
      action: `${action.type}${action.target ? "→" + action.target : ""}`,
      reasoning: (result.innerThought || "").slice(0, 150),
    });

    return normalizeSelectedAction(world, eid, action, true);
  } catch (error) {
    console.error(`[${name}] cognition error:`, error);
    return { type: "wait" };
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
  if (at <= 0 || Date.now() - at > 15_000) return null;

  const speaker = String(Perception.source[peid] || "").trim();
  if (!speaker || speaker.toLowerCase() === "self") return null;

  const content = String(Perception.content[peid] || "").trim();
  const signature = `${speaker}|${content.slice(0, 200)}`;

  const prev = recentSpeechReplies.get(agentEid);
  if (prev && prev.signature === signature && Date.now() - prev.atMs < SPEECH_REPLY_DEDUP_WINDOW_MS) return null;

  const greeting =
    content.toLowerCase().includes("good morning") ? "Good morning" :
    content.toLowerCase().includes("good evening") ? "Good evening" :
    content.toLowerCase().includes("hello") ? "Hello" :
    "Hi";

  const reply = `${greeting}, ${speaker}.`;
  recentSpeechReplies.set(agentEid, { signature, atMs: Date.now() });
  Mind.focus[agentEid] = ""; // clear "respond to ..." focus once we answer

  return { type: "speak", target: speaker, content: reply };
}

export async function processAgentCognition(
  world: World,
  eid: number,
  stimuli: Array<{ type: string; content: string; source: string }>
): Promise<AgentAction> {
  for (const stimulus of stimuli) {
    addPerception(world, eid, {
      type: stimulus.type,
      content: stimulus.content,
      source: stimulus.source,
    });
  }

  if (stimuli.length > 0) {
    Mind.arousal[eid] = Math.min(1, Mind.arousal[eid] + 0.1 * stimuli.length);
  }

  return agentThink(world, eid);
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
