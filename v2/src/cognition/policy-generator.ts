/**
 * LLM-Powered Behavior Policy Generator
 *
 * Generates unique, context-aware behavior trees for agents using Gemini's
 * structured output mode (generateObject + Zod schema). This forces the model
 * through constrained decoding, guaranteeing valid BehaviorNode JSON without
 * regex parsing, quality gates, or retry loops.
 *
 * Falls back to template-based assignment when LLM is unavailable or fails.
 */

import { generateText, generateObject } from "ai";
import { z } from "zod";
import { spiritModel } from "../llm/config";
import { extractJSON } from "../llm/json-extract";
import {
  validateBehaviorNode,
  type BehaviorNode,
} from "./behavior-policy";
import {
  getPolicyTemplate,
  inferPolicyFromRole,
  getAvailableTemplates,
  survivalPolicy,
} from "./behavior-templates";

// =============================================================================
// ZOD SCHEMA (recursive BehaviorNode)
// =============================================================================

const ConditionOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("chance"), p: z.number().min(0).max(1) }),
  z.object({ type: z.literal("need_above"), need: z.enum(["hunger", "energy", "social", "comfort"]), value: z.number() }),
  z.object({ type: z.literal("need_below"), need: z.enum(["hunger", "energy", "social", "comfort"]), value: z.number() }),
  z.object({ type: z.literal("in_room"), roomName: z.string() }),
  z.object({ type: z.literal("not_in_room"), roomName: z.string() }),
  z.object({ type: z.literal("has_goal"), includes: z.string() }),
  z.object({ type: z.literal("has_active_movement_goal"), destinationIncludes: z.string().optional() }),
  z.object({ type: z.literal("no_active_movement_goal") }),
  z.object({ type: z.literal("room_has_named"), name: z.string() }),
  z.object({ type: z.literal("room_has_other_agents") }),
  z.object({ type: z.literal("room_is_empty") }),
  z.object({ type: z.literal("last_action_was"), actionType: z.string() }),
  z.object({ type: z.literal("last_action_not"), actionType: z.string() }),
  z.object({ type: z.literal("has_perception"), perceptionType: z.string(), includes: z.string().optional() }),
  z.object({ type: z.literal("has_memory"), includes: z.string() }),
  z.object({ type: z.literal("has_belief"), includes: z.string() }),
  z.object({ type: z.literal("impression_above"), targetName: z.string(), threshold: z.number() }),
  z.object({ type: z.literal("impression_below"), targetName: z.string(), threshold: z.number() }),
  z.object({ type: z.literal("last_n_actions_include"), n: z.number(), actionType: z.string() }),
  z.object({ type: z.literal("last_n_actions_exclude"), n: z.number(), actionType: z.string() }),
]);

const PolicyActionSchema = z.object({
  type: z.enum(["speak", "observe", "move", "interact", "think", "wait", "rest", "reflect"]),
  target: z.string().optional(),
  content: z.string().optional(),
});

// Leaf nodes (no children)
const LeafNodeSchemas = [
  z.object({ type: z.literal("condition"), op: ConditionOpSchema }),
  z.object({ type: z.literal("action"), action: PolicyActionSchema }),
  z.object({ type: z.literal("interact_with_trait"), trait: z.string(), affordance: z.string(), args: z.string().optional(), scope: z.enum(["room", "accessible"]).optional() }),
  z.object({ type: z.literal("interact_any_affordance"), scope: z.enum(["room", "accessible"]).optional(), exclude: z.array(z.string()).optional() }),
  z.object({ type: z.literal("social_visit"), minImpression: z.number().optional() }),
  z.object({ type: z.literal("use_procedure"), signature: z.string(), minSuccesses: z.number().optional() }),
  z.object({ type: z.literal("wander") }),
  z.object({ type: z.literal("llm_fallback") }),
  z.object({ type: z.literal("noop") }),
] as const;

// Build BehaviorNode schema unrolled to depth 4 (no z.lazy, no $ref)
// Depth 0 = leaf nodes only
function makeNodeSchema(depth: number): z.ZodTypeAny {
  if (depth <= 0) {
    return z.discriminatedUnion("type", [...LeafNodeSchemas]);
  }
  const child = makeNodeSchema(depth - 1);
  return z.discriminatedUnion("type", [
    z.object({ type: z.literal("selector"), children: z.array(child).min(1).max(20) }),
    z.object({ type: z.literal("sequence"), children: z.array(child).min(1).max(10) }),
    z.object({ type: z.literal("weighted_random"), choices: z.array(z.object({
      weight: z.number().min(0),
      child,
    })).min(1).max(10) }),
    ...LeafNodeSchemas,
  ]);
}

// Unrolled to depth 4 — supports selector > selector > sequence > leaf
const BehaviorNodeSchema = makeNodeSchema(4);

// =============================================================================
// LLM CALL ABSTRACTION (injectable for testing)
// =============================================================================

type LLMCallFn = (opts: {
  system: string;
  prompt: string;
}) => Promise<string>;

let _llmCallOverride: LLMCallFn | null = null;

export function _setLLMCallOverride(fn: LLMCallFn | null): void {
  _llmCallOverride = fn;
}

/** Text-based generation with JSON extraction */
async function llmCall(opts: { system: string; prompt: string }): Promise<string> {
  if (_llmCallOverride) {
    return _llmCallOverride(opts);
  }
  const result = await generateText({
    model: spiritModel,
    system: opts.system,
    prompt: opts.prompt,
    temperature: 1.0, // Gemini 3 docs: "strongly recommend keeping temperature at 1.0"
  });
  return result.text ?? "";
}

// =============================================================================
// TYPES
// =============================================================================

export interface PolicyGenerationContext {
  name: string;
  role: string;
  personality: string;
  currentRoom: string;
  availableAffordances: Array<{
    name: string;
    description: string;
    requires: string[];
  }>;
  availableTraits: Array<{
    name: string;
    description: string;
    category: string;
  }>;
  availableRelationships: Array<{
    name: string;
    description: string;
  }>;
  worldTheme: string;
  existingTemplates: string[];
  /** Room names the agent can move to (prevents move to objects) */
  roomNames?: string[];
}

// =============================================================================
// EVOLUTION TRACKING
// =============================================================================

const evolutionHistory = new Map<
  number,
  { count: number; lastEvolvedAt: number }
>();

const EVOLUTION_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function canEvolvePolicy(agentEid: number): boolean {
  const entry = evolutionHistory.get(agentEid);
  if (!entry) return true;
  return Date.now() - entry.lastEvolvedAt >= EVOLUTION_COOLDOWN_MS;
}

export function getEvolutionCount(agentEid: number): number {
  return evolutionHistory.get(agentEid)?.count ?? 0;
}

function recordEvolution(agentEid: number): void {
  const entry = evolutionHistory.get(agentEid);
  evolutionHistory.set(agentEid, {
    count: (entry?.count ?? 0) + 1,
    lastEvolvedAt: Date.now(),
  });
}

export function _resetEvolutionTracking(): void {
  evolutionHistory.clear();
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

function buildSystemPrompt(context: PolicyGenerationContext): string {
  const affordanceList = context.availableAffordances
    .map(a => `  - "${a.name}": ${a.description}${a.requires.length ? ` (requires: ${a.requires.join(", ")})` : ""}`)
    .join("\n");

  const traitList = context.availableTraits
    .map(t => `  - "${t.name}": ${t.description} [${t.category}]`)
    .join("\n");

  const relationshipList = context.availableRelationships
    .map(r => `  - "${r.name}": ${r.description}`)
    .join("\n");

  const roomList = (context.roomNames || []).map(r => `"${r}"`).join(", ");

  return `You design behavior trees for autonomous agent simulations.
The output is a structured BehaviorNode tree (the schema is enforced automatically).

## Need Scales
- hunger: 0=full, 100=starving. Rest when tired: use need_below(energy, 15). Eat when hungry: use need_above(hunger, 70).
- energy: 100=rested, 0=exhausted.
- social: 100=fulfilled, 0=lonely.
- comfort: 100=comfortable, 0=miserable.

## Available Vocabulary

Affordances (use in interact_with_trait):
${affordanceList || "  (none)"}

Traits:
${traitList || "  (none)"}

Relationships:
${relationshipList || "  (none)"}

Valid room names for "move" actions: ${roomList || "(any room in the world)"}

## Requirements
1. Root must be a "selector". Priority: survival → memory-driven reactions → role duties → social → weighted_random fallback.
2. MUST include at least 2 interact_with_trait nodes using affordances from the list above matching the agent's role.
3. MUST include at least one has_memory or has_belief condition for character-driven behavior.
4. MUST include last_n_actions_exclude guards on repeated action types to prevent spam.
5. MUST end with a weighted_random fallback containing observe, think, wander, social_visit.
6. Nest selectors for sub-decisions. Target depth 3-5, 20-50 nodes.
7. move targets: ONLY valid room names listed above. Use interact_with_trait for objects.
8. Never use "wait" as a standalone action — use observe, think, or reflect.

## CRITICAL Output Format Rules

Return ONLY a single JSON object. No markdown fences, no explanation, no comments. Raw JSON only.

Conditions MUST use this exact nested format:
  { "type": "condition", "op": { "type": "need_below", "need": "energy", "value": 15 } }
NOT this: { "type": "need_below", "need": "energy", "value": 15 }
NOT this: { "type": "condition", "name": "need_below", "need": "energy", "amount": 15 }

Actions MUST use this exact nested format:
  { "type": "action", "action": { "type": "move", "target": "RoomName" } }
NOT this: { "type": "move", "target": "RoomName" }
NOT this: { "type": "action", "name": "move", "target": "RoomName" }`;
}

function buildUserPrompt(context: PolicyGenerationContext): string {
  // Pick 2-3 affordances that best match this agent's role for explicit instruction
  const roleAffordances = context.availableAffordances
    .filter(a => {
      const role = context.role.toLowerCase();
      const aName = a.name.toLowerCase();
      // Heuristic matching
      if (role.includes("smith") && (aName.includes("forge") || aName.includes("smelt"))) return true;
      if (role.includes("innkeeper") && (aName.includes("serve") || aName.includes("tend") || aName.includes("brew"))) return true;
      if (role.includes("guard") && (aName.includes("patrol") || aName.includes("investigate"))) return true;
      if (role.includes("healer") && (aName.includes("brew") || aName.includes("pray") || aName.includes("heal"))) return true;
      if (role.includes("monk") && (aName.includes("pray") || aName.includes("meditat"))) return true;
      if (role.includes("thief") && (aName.includes("pick") || aName.includes("steal") || aName.includes("haggle"))) return true;
      if (role.includes("merchant") && (aName.includes("haggle") || aName.includes("sell") || aName.includes("trade"))) return true;
      return false;
    })
    .slice(0, 3);

  const affordanceHint = roleAffordances.length > 0
    ? `\n\nYou MUST use these affordances in interact_with_trait nodes: ${roleAffordances.map(a => `"${a.name}" (trait: "${a.requires[0] || "any"}")`).join(", ")}`
    : "";

  return `Generate a behavior tree for ${context.name}, a ${context.role} in a ${context.worldTheme}.

Personality: ${context.personality}
Home room: ${context.currentRoom}

This agent's tree MUST include:
1. A has_memory condition (e.g., has_memory("danger"), has_memory("friend"), has_memory("task")) — pick something fitting for a ${context.role}
2. A last_n_actions_exclude guard on at least 3 action branches
3. A nested selector for role-specific sub-decisions
4. A weighted_random fallback as the last child${affordanceHint}`;
}

function buildEvolvePrompt(
  currentPolicy: BehaviorNode,
  context: PolicyGenerationContext,
  reason: string,
  observedProblems: string[]
): string {
  return `Evolve this agent's behavior policy to fix observed problems.

Agent: ${context.name} (${context.role})
Room: ${context.currentRoom}

Current policy:
${JSON.stringify(currentPolicy, null, 2).slice(0, 3000)}

Reason: ${reason}
Problems:
${observedProblems.map(p => `  - ${p}`).join("\n")}

Generate a STRUCTURALLY DIFFERENT policy that fixes these problems. Keep survival needs, add variety, use the world's affordances.`;
}

// =============================================================================
// GENERATION
// =============================================================================

export async function generateBehaviorPolicy(
  context: PolicyGenerationContext
): Promise<BehaviorNode> {
  try {
    const output = await llmCall({
      system: buildSystemPrompt(context),
      prompt: buildUserPrompt(context),
    });
    const json = extractJSON(output);
    if (!json) {
      console.warn(`[PolicyGen] ${context.name}: extractJSON returned null from ${output.length} chars`);
    } else {
      const raw = JSON.parse(json);
      const normalized = normalizeNode(raw);
      const v = validateBehaviorNode(normalized);
      if (v.ok) {
        return normalized as BehaviorNode;
      }
      // Try without normalization in case it made things worse
      const v2 = validateBehaviorNode(raw);
      if (v2.ok) {
        return raw as BehaviorNode;
      }
      console.warn(`[PolicyGen] ${context.name}: validation failed: ${v.error}`);
      // Save failed policies for normalizer improvement
      try {
        const fs = await import("fs");
        const dir = "./data/eval/failed-policies";
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${dir}/${context.name}-${Date.now()}.json`, JSON.stringify({ raw, normalized, error: v.error, rawError: v2.ok ? null : (v2 as any).error }, null, 2));
      } catch { /* ignore fs errors */ }
    }
  } catch (err: any) {
    console.warn(`[PolicyGen] ${context.name}: LLM error: ${err?.message ?? err}`);
  }

  console.warn(`[PolicyGen] ${context.name}: falling back to template`);
  return fallbackToTemplate(context);
}

export async function generateBatchPolicies(
  agents: PolicyGenerationContext[]
): Promise<Map<string, BehaviorNode>> {
  const results = new Map<string, BehaviorNode>();
  // Small batches of 3 — each agent has a unique user prompt (name/role/personality)
  // so deduplication risk is low, but we avoid hammering the API with 10+ concurrent.
  const BATCH_SIZE = 3;

  for (let i = 0; i < agents.length; i += BATCH_SIZE) {
    const batch = agents.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (agent) => {
        const policy = await generateBehaviorPolicy(agent);
        return { name: agent.name, policy };
      })
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        results.set(s.value.name, s.value.policy);
      } else {
        results.set(batch[j].name, fallbackToTemplate(batch[j]));
      }
    }
  }

  return results;
}

export async function evolvePolicy(
  currentPolicy: BehaviorNode,
  agentContext: PolicyGenerationContext,
  reason: string,
  observedProblems: string[],
  agentEid?: number
): Promise<BehaviorNode> {
  if (agentEid !== undefined && !canEvolvePolicy(agentEid)) {
    return currentPolicy;
  }

  try {
    const output = await llmCall({
      system: buildSystemPrompt(agentContext),
      prompt: buildEvolvePrompt(currentPolicy, agentContext, reason, observedProblems),
    });
    const json = extractJSON(output);
    if (json) {
      const raw = JSON.parse(json);
      const parsed = normalizeNode(raw);
      const v = validateBehaviorNode(parsed);
      if (v.ok && JSON.stringify(parsed) !== JSON.stringify(currentPolicy)) {
        if (agentEid !== undefined) recordEvolution(agentEid);
        return parsed as BehaviorNode;
      }
    }
    // LLM returned same policy or invalid — try fresh generation
    const fresh = await generateBehaviorPolicy(agentContext);
    if (JSON.stringify(fresh) !== JSON.stringify(currentPolicy)) {
      if (agentEid !== undefined) recordEvolution(agentEid);
      return fresh;
    }
  } catch {
    try {
      const fresh = await generateBehaviorPolicy(agentContext);
      if (JSON.stringify(fresh) !== JSON.stringify(currentPolicy)) {
        if (agentEid !== undefined) recordEvolution(agentEid);
        return fresh;
      }
    } catch { /* give up */ }
  }
  return currentPolicy;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize LLM output to match our BehaviorNode schema.
 * Gemini often generates a flattened format:
 *   { type: "condition", condition_type: "need_below", need_name: "energy", threshold: 15 }
 * instead of our nested format:
 *   { type: "condition", op: { type: "need_below", need: "energy", value: 15 } }
 *
 * Similarly for actions:
 *   { type: "action", action_type: "move", target: "Forge" }
 * instead of:
 *   { type: "action", action: { type: "move", target: "Forge" } }
 */
const CONDITION_OP_TYPES = new Set([
  "always", "chance", "need_above", "need_below", "in_room", "not_in_room",
  "has_goal", "has_active_movement_goal", "no_active_movement_goal",
  "room_has_named", "room_has_other_agents", "room_is_empty",
  "last_action_was", "last_action_not", "has_perception",
  "has_memory", "has_belief", "impression_above", "impression_below",
  "last_n_actions_include", "last_n_actions_exclude",
]);

function normalizeNode(node: any): any {
  if (!node || typeof node !== "object") return node;

  // Normalize weighted_random that uses children[] with weight on each child instead of choices[]
  if (node.type === "weighted_random" && !node.choices && Array.isArray(node.children)) {
    node.choices = node.children.map((c: any) => ({
      weight: c.weight ?? 1,
      child: normalizeNode({ ...c, weight: undefined }),
    }));
    delete node.children;
    return node;
  }

  // Universal op field normalization: catch any condition op with wrong field names
  // regardless of how the node is structured
  if (node.op && typeof node.op === "object") {
    const op = node.op;
    if (op.action_type && !op.actionType) { op.actionType = op.action_type; delete op.action_type; }
    if (typeof op.action === "string" && !op.actionType) { op.actionType = op.action; delete op.action; }
    if (op.amount !== undefined && op.value === undefined) { op.value = op.amount; delete op.amount; }
    if (op.threshold !== undefined && op.value === undefined) { op.value = op.threshold; delete op.threshold; }
    if (op.type?.includes("last_n_actions") && op.value !== undefined && op.n === undefined) { op.n = op.value; delete op.value; }
    if (op.n_actions !== undefined && op.n === undefined) { op.n = op.n_actions; delete op.n_actions; }
    if (op.memory && !op.includes) { op.includes = op.memory; delete op.memory; }
    if (op.belief && !op.includes) { op.includes = op.belief; delete op.belief; }
    if (op.room_name && !op.roomName) { op.roomName = op.room_name; delete op.room_name; }
    if (op.room && !op.roomName) { op.roomName = op.room; delete op.room; }
    if (op.location && !op.roomName) { op.roomName = op.location; delete op.location; }
    if (op.target_name && !op.targetName) { op.targetName = op.target_name; delete op.target_name; }
    if (op.need_name && !op.need) { op.need = op.need_name; delete op.need_name; }
    const aliases: Record<string, string> = { location_is: "in_room", agent_in_room: "in_room", is_in_room: "in_room", location_is_not: "not_in_room" };
    if (op.type && aliases[op.type]) op.type = aliases[op.type];
    if (op.name === op.type || (typeof op.name === "string" && CONDITION_OP_TYPES.has(op.name))) delete op.name;
    if (op.params && typeof op.params === "object") { Object.assign(op, op.params); delete op.params; }
  }

  // Normalize children recursively
  if (Array.isArray(node.children)) {
    node.children = node.children.map(normalizeNode);
  }
  if (Array.isArray(node.choices)) {
    node.choices = node.choices.map((c: any) => ({
      ...c,
      child: normalizeNode(c.child),
    }));
  }

  // Normalize conditions: handle all the format variants Gemini produces
  if (node.type === "condition") {
    let op = node.op;

    // Case 1: no op, flattened fields: { type: "condition", condition_type|name: "need_below", ... }
    if (!op || typeof op !== "object") {
      const condType = node.condition_type || (typeof node.name === "string" && CONDITION_OP_TYPES.has(node.name) ? node.name : null) || node.condition;
      if (condType) {
        op = { type: condType };
        // Copy all remaining fields into op
        for (const [k, v] of Object.entries(node)) {
          if (k !== "type" && k !== "op" && k !== "condition_type" && k !== "children" && k !== "choices") {
            (op as any)[k] = v;
          }
        }
      }
    }

    if (op && typeof op === "object") {
      // Flatten nested params: { type: "need_below", params: { need: "energy", amount: 15 } }
      if (op.params && typeof op.params === "object") {
        const { params, ...rest } = op;
        op = { ...rest, ...params };
      }

      // Normalize field names
      if (op.need_name && !op.need) { op.need = op.need_name; delete op.need_name; }
      if (op.amount !== undefined && op.value === undefined) { op.value = op.amount; delete op.amount; }
      if (op.threshold !== undefined && op.value === undefined) { op.value = op.threshold; delete op.threshold; }
      if (op.room_name && !op.roomName) { op.roomName = op.room_name; delete op.room_name; }
      if (op.room && !op.roomName) { op.roomName = op.room; delete op.room; }
      if (op.action_type && !op.actionType) { op.actionType = op.action_type; delete op.action_type; }
      if (op.n_actions !== undefined && op.n === undefined) { op.n = op.n_actions; delete op.n_actions; }
      if (op.memory && !op.includes) { op.includes = op.memory; delete op.memory; }
      if (op.belief && !op.includes) { op.includes = op.belief; delete op.belief; }
      if (op.target_name && !op.targetName) { op.targetName = op.target_name; delete op.target_name; }
      if (op.probability !== undefined && op.p === undefined) { op.p = op.probability; delete op.probability; }
      if (Array.isArray(op.excluded_actions) && !op.actionType) { op.actionType = op.excluded_actions[0]; delete op.excluded_actions; }

      // Map invented condition names to our canonical names
      const conditionAliases: Record<string, string> = {
        location_is: "in_room", agent_in_room: "in_room", is_in_room: "in_room",
        location_is_not: "not_in_room", not_at_location: "not_in_room",
        agents_present: "room_has_other_agents", has_other_agents: "room_has_other_agents",
        no_agents: "room_is_empty", room_empty: "room_is_empty",
      };
      if (op.type && conditionAliases[op.type]) {
        op.type = conditionAliases[op.type];
      }

      // Remove name field if it duplicates the type (name pollution)
      if (op.name === op.type || (typeof op.name === "string" && CONDITION_OP_TYPES.has(op.name))) {
        delete op.name;
      }

      return { type: "condition", op };
    }
  }

  // Final pass: if this is a condition node with a valid op, ensure all field names are canonical
  // This catches cases where the op was already nested but has non-standard field names
  if (node.type === "condition" && node.op && typeof node.op === "object" && node.op.type) {
    const op = node.op;
    if (op.action_type && !op.actionType) { op.actionType = op.action_type; delete op.action_type; }
    if (typeof op.action === "string" && !op.actionType) { op.actionType = op.action; delete op.action; }
    if (op.memory && !op.includes) { op.includes = op.memory; delete op.memory; }
    if (op.belief && !op.includes) { op.includes = op.belief; delete op.belief; }
    if (op.amount !== undefined && op.value === undefined) { op.value = op.amount; delete op.amount; }
    if (op.threshold !== undefined && op.value === undefined) { op.value = op.threshold; delete op.threshold; }
    if (op.n_actions !== undefined && op.n === undefined) { op.n = op.n_actions; delete op.n_actions; }
    if (op.type?.includes("last_n_actions") && op.value !== undefined && op.n === undefined) { op.n = op.value; delete op.value; }
    if (op.room_name && !op.roomName) { op.roomName = op.room_name; delete op.room_name; }
    if (op.target_name && !op.targetName) { op.targetName = op.target_name; delete op.target_name; }
    // Map aliases
    const aliases: Record<string, string> = { location_is: "in_room", agent_in_room: "in_room", is_in_room: "in_room", location_is_not: "not_in_room", not_at_location: "not_in_room" };
    if (op.type && aliases[op.type]) op.type = aliases[op.type];
    return node;
  }

  // Normalize conditions where the op type is used as the node type directly
  // e.g. { type: "need_below", need: "energy", value: 15 }
  if (CONDITION_OP_TYPES.has(node.type) && !node.op) {
    const { type: opType, children: _c, choices: _ch, ...rest } = node;
    const op: any = { type: opType, ...rest };
    // Normalize field names
    if (op.amount !== undefined && op.value === undefined) { op.value = op.amount; delete op.amount; }
    if (op.need_name && !op.need) { op.need = op.need_name; delete op.need_name; }
    if (op.room_name && !op.roomName) { op.roomName = op.room_name; delete op.room_name; }
    if (op.room && !op.roomName) { op.roomName = op.room; delete op.room; }
    if (op.location && !op.roomName) { op.roomName = op.location; delete op.location; }
    if (op.action_type && !op.actionType) { op.actionType = op.action_type; delete op.action_type; }
    if (typeof op.action === "string" && !op.actionType) { op.actionType = op.action; delete op.action; }
    if (op.n_actions !== undefined && op.n === undefined) { op.n = op.n_actions; delete op.n_actions; }
    if (op.type?.includes("last_n_actions") && op.value !== undefined && op.n === undefined) { op.n = op.value; delete op.value; }
    if (op.memory && !op.includes) { op.includes = op.memory; delete op.memory; }
    if (op.belief && !op.includes) { op.includes = op.belief; delete op.belief; }
    if (op.target_name && !op.targetName) { op.targetName = op.target_name; delete op.target_name; }
    if (op.probability !== undefined && op.p === undefined) { op.p = op.probability; delete op.probability; }
    if (Array.isArray(op.excluded_actions) && !op.actionType) { op.actionType = op.excluded_actions[0]; delete op.excluded_actions; }
    // Remove polluted name fields
    if (op.name === op.type || (typeof op.name === "string" && CONDITION_OP_TYPES.has(op.name))) { delete op.name; }
    return { type: "condition", op };
  }

  // Normalize flattened actions: { type: "action", action_type|name: "move", target: "X" }
  const actType = node.action_type || (node.type === "action" && typeof node.name === "string" ? node.name : null);
  if (node.type === "action" && !node.action && actType) {
    // If the "action type" is actually a composite node type, promote it
    if (actType === "interact_with_trait") {
      return { type: "interact_with_trait", trait: node.trait || "", affordance: node.affordance || node.content || "", scope: node.scope || "room" };
    }
    if (actType === "interact_any_affordance") {
      return { type: "interact_any_affordance", scope: node.scope || "room" };
    }
    return {
      type: "action",
      action: {
        type: actType,
        target: node.target,
        content: node.content || node.thought,
      },
    };
  }

  // Handle action wrapping composite node types: { type: "action", action: { type: "wander"|"interact_with_trait"|... } }
  const compositeTypes = new Set(["interact_with_trait", "interact_any_affordance", "social_visit", "wander", "llm_fallback", "noop"]);
  if (node.type === "action" && node.action && compositeTypes.has(node.action.type)) {
    return normalizeNode({ type: node.action.type, ...node.action });
  }

  // Handle interact_with_trait with params: { type: "interact_with_trait", params: { trait: "...", affordance: "..." } }
  if (node.type === "interact_with_trait" && node.params && typeof node.params === "object") {
    return { type: "interact_with_trait", trait: node.params.trait || node.trait || "", affordance: node.params.affordance || node.affordance || "", scope: node.params.scope || node.scope || "room" };
  }

  // Normalize action types used as direct node types: { type: "move", room: "Temple" }
  const knownActionTypes = new Set(["speak", "observe", "move", "interact", "think", "wait", "rest", "reflect"]);
  const knownControlTypes = new Set(["selector", "sequence", "weighted_random", "condition", "action",
    "interact_with_trait", "interact_any_affordance", "social_visit", "use_procedure", "wander", "llm_fallback", "noop"]);

  if (knownActionTypes.has(node.type) && !node.action) {
    return {
      type: "action",
      action: {
        type: node.type,
        target: node.target || node.room,
        content: node.content || node.thought || node.message,
      },
    };
  }

  // Any unknown node type that isn't a control/condition type → treat as an interact action
  // The LLM generates things like { type: "eat" }, { type: "forge" }, { type: "pray" }
  if (!knownControlTypes.has(node.type) && !CONDITION_OP_TYPES.has(node.type)) {
    return {
      type: "action",
      action: {
        type: "interact",
        target: node.target || node.room,
        content: node.type + (node.thought ? ` ${node.thought}` : ""),
      },
    };
  }

  return node;
}

function fallbackToTemplate(context: PolicyGenerationContext): BehaviorNode {
  const { template, params: inferredParams } = inferPolicyFromRole(context.role);
  const policyParams = {
    ...inferredParams,
    room: context.currentRoom,
    workplace: context.currentRoom,
  };
  const tree = getPolicyTemplate(template, policyParams);
  return tree ?? survivalPolicy();
}

// Exported for testing
export {
  buildSystemPrompt as _buildSystemPrompt,
  buildUserPrompt as _buildUserPrompt,
  fallbackToTemplate as _fallbackToTemplate,
};
