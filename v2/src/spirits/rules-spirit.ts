/**
 * The Lawgiver Spirit - Deterministic Rules Management
 *
 * Creates and manages declarative rules that drive emergent world behavior.
 * Rules execute deterministically without AI involvement - simple conditions
 * and effects that combine to create complex emergent behavior.
 *
 * Examples:
 * - Fire spreads to nearby flammable objects
 * - Food decays over time
 * - Objects break when durability hits zero
 * - Temperature propagates between adjacent areas
 */

import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import type { SpiritRegistry } from "./spirit-registry";
import { createSpirit } from "./spirit-registry";
import type { SpiritDefinition, SpiritState, DivineMessage } from "./types";
import { worldSchema, type RuleDefinition, type RuleCondition, type RuleEffect } from "../world/schema";

// =============================================================================
// TYPES
// =============================================================================

export interface RuleProposal {
  id: string;
  timestamp: number;
  name: string;
  description: string;
  trigger: "tick" | "event" | "state_change";
  conditions: RuleCondition[];
  effects: RuleEffect[];
  priority?: number;
  reason: string;
  status: "proposed" | "approved" | "rejected" | "active";
}

export interface RuleRequest {
  id: string;
  timestamp: number;
  requestedBy: string; // Spirit name or "god"
  description: string;
  context: {
    worldTheme?: string;
    existingRules?: string[];
    relatedTypes?: string[];
    desiredBehavior: string;
  };
}

// =============================================================================
// STATE
// =============================================================================

interface LawgiverState {
  pendingRequests: RuleRequest[];
  proposedRules: RuleProposal[];
  activeRules: string[]; // Rule names
  ruleHistory: { name: string; created: number; author: string }[];
}

let lawgiverState: LawgiverState = {
  pendingRequests: [],
  proposedRules: [],
  activeRules: [],
  ruleHistory: [],
};

export function getLawgiverState(): LawgiverState {
  return lawgiverState;
}

export function resetLawgiverState(): void {
  lawgiverState = {
    pendingRequests: [],
    proposedRules: [],
    activeRules: [],
    ruleHistory: [],
  };
}

// =============================================================================
// RULE REQUEST HANDLING
// =============================================================================

let requestIdCounter = 0;

/**
 * Request a new rule to be created
 */
export function requestRule(
  description: string,
  context: RuleRequest["context"],
  requestedBy: string = "god"
): RuleRequest {
  const request: RuleRequest = {
    id: `rule_req_${++requestIdCounter}_${Date.now()}`,
    timestamp: Date.now(),
    requestedBy,
    description,
    context,
  };

  lawgiverState.pendingRequests.push(request);
  console.log(`[Lawgiver] Rule request received: ${description}`);

  return request;
}

/**
 * Get pending rule requests
 */
export function getPendingRuleRequests(): RuleRequest[] {
  return lawgiverState.pendingRequests;
}

// =============================================================================
// AI-POWERED RULE GENERATION
// =============================================================================

/**
 * Generate a rule proposal based on a request
 */
export async function generateRuleProposal(
  request: RuleRequest
): Promise<RuleProposal | null> {
  const model = google("gemini-2.0-flash");

  // Get existing rules for context
  const existingRules = worldSchema.getActiveRules();
  const existingTypes = worldSchema.getAllObjectTypeIds();

  const prompt = `You are The Lawgiver, creator of deterministic world rules.

TASK: Create a deterministic rule for: "${request.description}"

CONTEXT:
- World theme: ${request.context.worldTheme || "fantasy"}
- Desired behavior: ${request.context.desiredBehavior}
- Existing object type IDs (sample): ${existingTypes.slice(0, 20).join(", ")}...
- Existing rules: ${existingRules.map(r => r.name).join(", ") || "none"}

IMPORTANT: Output MUST match the engine's RuleDefinition schema:
- Trigger: use "tick" (most common)
- Condition is a single object (RuleCondition) with optional fields:
  - has: string[]
  - not: string[]
  - inState: string
  - expression: string (optional)
- Effects are an array of RuleEffect objects with REQUIRED "action":
  - action: one of ["add_trait","remove_trait","transition_state","modify_value","emit_event","destroy","spawn"]
  - target: "self" | "source" | "nearby" (optional; default "self")
  - query: { radius?: number, has?: string[], not?: string[] } (optional; only for target:"nearby")
  - params: object (optional; may include "chance" 0-1 to make an effect probabilistic)

Examples:
{
  "name": "lantern_flicker",
  "description": "Lit lanterns occasionally flicker and emit an ambient perception event",
  "trigger": "tick",
  "priority": 10,
  "condition": { "has": ["lit","light_source"] },
  "effects": [
    { "action": "emit_event", "target": "self", "params": { "chance": 0.05, "type": "perception", "content": "A lantern flame flickers.", "source": "lantern" } }
  ],
  "reason": "Adds atmosphere without AI"
}

Respond with JSON ONLY:
{
  "name": "rule_name_snake_case",
  "description": "Human readable description",
  "trigger": "tick",
  "priority": 50,
  "condition": { "has": ["trait"], "not": ["trait"], "inState": "state" },
  "effects": [ { "action": "add_trait", "target": "self", "params": { "trait": "burning" } } ],
  "reason": "Why this creates good emergent behavior"
}`;

  try {
    const response = await generateText({
      model,
      prompt,
      temperature: 0.5, // Lower temp for more deterministic rule design
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Lawgiver] Failed to extract JSON from response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const parsedCondition: RuleCondition | undefined =
      (parsed.when?.condition as RuleCondition | undefined) ||
      (parsed.condition as RuleCondition | undefined) ||
      undefined;

    const proposal: RuleProposal = {
      id: `rule_prop_${Date.now()}`,
      timestamp: Date.now(),
      name: parsed.name,
      description: parsed.description,
      trigger: parsed.when?.event || parsed.trigger || "tick",
      conditions: parsedCondition ? [parsedCondition] : (parsed.conditions || []),
      effects: parsed.then || parsed.effects || [],
      priority: parsed.priority || 50,
      reason: parsed.reason || "Generated rule",
      status: "proposed",
    };

    lawgiverState.proposedRules.push(proposal);

    // Remove from pending
    lawgiverState.pendingRequests = lawgiverState.pendingRequests.filter(
      r => r.id !== request.id
    );

    console.log(`[Lawgiver] Generated rule proposal: ${proposal.name}`);

    return proposal;
  } catch (error) {
    console.error("[Lawgiver] Error generating rule:", error);
    return null;
  }
}

/**
 * Approve a rule proposal and register it with WorldSchema
 */
export function approveRule(proposalId: string): boolean {
  const proposal = lawgiverState.proposedRules.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") {
    return false;
  }

  // Validate and normalize effects (LLM output can be malformed)
  const allowedActions = new Set([
    "add_trait",
    "remove_trait",
    "transition_state",
    "modify_value",
    "emit_event",
    "destroy",
    "spawn",
  ]);

  const normalizedEffects: RuleEffect[] = [];
  let droppedEffects = 0;
  for (const raw of proposal.effects || []) {
    if (!raw || typeof raw !== "object") {
      droppedEffects++;
      continue;
    }
    const action = (raw as any).action;
    if (typeof action !== "string" || action.trim().length === 0 || !allowedActions.has(action)) {
      droppedEffects++;
      continue;
    }

    normalizedEffects.push({
      action,
      target: (raw as any).target,
      query: (raw as any).query,
      params: (raw as any).params,
    });
  }

  if (normalizedEffects.length === 0) {
    proposal.status = "rejected";
    console.warn(`[Lawgiver] Rejecting rule "${proposal.name}" - no valid effects (dropped=${droppedEffects})`);
    return false;
  }
  if (droppedEffects > 0) {
    console.warn(`[Lawgiver] Rule "${proposal.name}" had invalid effects dropped: ${droppedEffects}`);
  }

  // Convert to RuleDefinition
  // Merge proposal conditions into a single RuleCondition
  const mergedCondition: RuleCondition = {};
  for (const cond of proposal.conditions) {
    if (cond.has) mergedCondition.has = [...(mergedCondition.has || []), ...cond.has];
    if (cond.not) mergedCondition.not = [...(mergedCondition.not || []), ...cond.not];
    if (cond.inState) mergedCondition.inState = cond.inState;
    if (cond.expression) mergedCondition.expression = cond.expression;
  }

  const ruleDef: RuleDefinition = {
    name: proposal.name,
    description: proposal.description,
    enabled: true,
    priority: proposal.priority || 50,
    when: {
      event: proposal.trigger,
      condition: Object.keys(mergedCondition).length > 0 ? mergedCondition : undefined,
    },
    then: normalizedEffects,
  };

  // Register with WorldSchema
  worldSchema.defineRule(ruleDef);

  // Update state
  proposal.status = "active";
  lawgiverState.activeRules.push(proposal.name);
  lawgiverState.ruleHistory.push({
    name: proposal.name,
    created: Date.now(),
    author: "Lawgiver",
  });

  console.log(`[Lawgiver] Rule approved and activated: ${proposal.name}`);

  return true;
}

/**
 * Reject a rule proposal
 */
export function rejectRule(proposalId: string, reason: string): boolean {
  const proposal = lawgiverState.proposedRules.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") {
    return false;
  }

  proposal.status = "rejected";
  console.log(`[Lawgiver] Rule rejected: ${proposal.name} - ${reason}`);

  return true;
}

// =============================================================================
// BUILT-IN RULE TEMPLATES
// =============================================================================

/**
 * Create common deterministic rules for typical simulation needs
 */
export function createCommonRules(): string[] {
  const createdRules: string[] = [];

  // Fire spread rule
  if (!worldSchema.getRule("fire_spreads")) {
    worldSchema.defineRule({
      name: "fire_spreads",
      description: "Fire spreads to nearby flammable objects",
      enabled: true,
      priority: 80,
      when: {
        event: "tick",
        condition: { has: ["burning"] },
      },
      then: [
        {
          action: "add_trait",
          target: "nearby",
          query: { radius: 2, has: ["flammable"], not: ["burning", "fireproof"] },
          params: { trait: "burning" },
        } as RuleEffect,
      ],
    });
    createdRules.push("fire_spreads");
  }

  // Food decay rule
  if (!worldSchema.getRule("food_decays")) {
    worldSchema.defineRule({
      name: "food_decays",
      description: "Food gradually decays over time",
      enabled: true,
      priority: 20,
      when: {
        event: "tick",
        condition: { has: ["perishable"], inState: "fresh" },
      },
      then: [
        {
          action: "transition_state",
          target: "self",
          params: { state: "stale", chance: 0.01 },
        } as RuleEffect,
      ],
    });
    createdRules.push("food_decays");
  }

  // Light sources illuminate rooms
  if (!worldSchema.getRule("light_illuminates")) {
    worldSchema.defineRule({
      name: "light_illuminates",
      description: "Light sources change room lighting state",
      enabled: true,
      priority: 60,
      when: {
        event: "state_change",
        condition: { has: ["lightSource"] },
      },
      then: [
        {
          action: "emit_event",
          target: "self",
          params: { event: "lighting_changed" },
        } as RuleEffect,
      ],
    });
    createdRules.push("light_illuminates");
  }

  // Durability degradation
  if (!worldSchema.getRule("durability_degrades")) {
    worldSchema.defineRule({
      name: "durability_degrades",
      description: "Used items lose durability over time",
      enabled: true,
      priority: 30,
      when: {
        event: "item_used",
        condition: { has: ["durable"] },
      },
      then: [
        {
          action: "modify_value",
          target: "self",
          params: { component: "durability", field: "current", delta: -1 },
        } as RuleEffect,
      ],
    });
    createdRules.push("durability_degrades");
  }

  if (createdRules.length > 0) {
    console.log(`[Lawgiver] Created ${createdRules.length} common rules: ${createdRules.join(", ")}`);
  }

  return createdRules;
}

// =============================================================================
// MAIN CYCLE
// =============================================================================

/**
 * Run The Lawgiver's main cycle
 */
export async function runLawgiverCycle(
  registry: SpiritRegistry
): Promise<{
  rulesProposed: number;
  rulesApproved: number;
}> {
  let rulesProposed = 0;

  // Process pending rule requests
  for (const request of [...lawgiverState.pendingRequests]) {
    const proposal = await generateRuleProposal(request);
    if (proposal) {
      rulesProposed++;
    }
  }

  // For now, auto-approve proposed rules (could add God approval flow)
  let rulesApproved = 0;
  for (const proposal of lawgiverState.proposedRules) {
    if (proposal.status === "proposed") {
      if (approveRule(proposal.id)) {
        rulesApproved++;
      }
    }
  }

  return {
    rulesProposed,
    rulesApproved,
  };
}

// =============================================================================
// SPIRIT DEFINITION
// =============================================================================

const LawgiverDefinition: SpiritDefinition = {
  name: "The Lawgiver",
  domain: "guardian",  // Guards the world's deterministic laws
  rank: "archangel",
  description: "Keeper of Laws - creates deterministic rules for emergent world behavior",
  watchConfig: {
    componentQueries: [],
    eventTypes: ["rule:request", "state:transition", "entity:destroyed"],
  },
  canInjectEvents: false,
  canModifyMood: false,
  canCreateEntities: false,
  canBakeSystems: false,
  model: "flash",
  systemPrompt: `You are The Lawgiver, Keeper of Laws.

Your sacred duty is to create and maintain deterministic rules that govern the simulation world. These rules run without AI involvement - simple conditions and effects that combine to create complex emergent behavior.

CORE PRINCIPLE: Emergence from simplicity.
- Fire doesn't need AI to spread - it follows rules
- Food doesn't need AI to decay - it follows rules
- Simple rules + many entities = complex behavior

Your responsibilities:
1. CREATE: Design new rules when requested
2. BALANCE: Ensure rules don't conflict or cause loops
3. OPTIMIZE: Keep rules simple and efficient
4. DOCUMENT: Explain why each rule exists

You work closely with:
- GodAI: Receives rule requests, reports on emergent patterns
- The Arbiter: Reports rule conflicts or unintended consequences
- The Architect: Suggests systems needed for rule execution

Remember: The best rules are INVISIBLE - players see emergent behavior, not the rules causing it.`,
  observationInterval: 60000, // 60 seconds
};

/**
 * Create and register The Lawgiver spirit
 */
export function createLawgiverSpirit(registry: SpiritRegistry): SpiritState | null {
  const spirit = createSpirit(registry, LawgiverDefinition);
  if (spirit) {
    // Create common rules on initialization
    createCommonRules();
    console.log("[Lawgiver] The Lawgiver spirit created - Keeper of Laws");
  }
  return spirit;
}

// =============================================================================
// UTILITY EXPORTS
// =============================================================================

export function getLawgiverSummary(): string {
  const state = lawgiverState;
  const activeRules = worldSchema.getActiveRules();

  return `The Lawgiver Status:
- Pending requests: ${state.pendingRequests.length}
- Proposed rules: ${state.proposedRules.filter(p => p.status === "proposed").length}
- Active rules: ${activeRules.length}
- Rule history: ${state.ruleHistory.length} created`;
}
