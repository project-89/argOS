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

import { generateText } from "ai";
import { getWorldAuthoringContext, getWorldTheme } from "../world/world-specification";
import { flashModel } from "../llm/config";
import type { SpiritRegistry } from "./spirit-registry";
import { createSpirit } from "./spirit-registry";
import type { SpiritDefinition, SpiritState, DivineMessage } from "./types";
import { worldSchema, type RuleDefinition, type RuleCondition, type RuleEffect } from "../world/schema";
import type { World } from "../ecs/world";
import { assertSimulationTaskActive, getSimulationTaskSignal } from "../runtime/task-scope";
import { getCommittedEvents, startCommittedEvents } from "../runtime/committed-events";
import { captureRuleSource, grantRuntimeRule } from "../world/runtime-rule-scope";
import { validateRuleCandidate } from "./rule-admission";

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
  rejectionReason?: string;
}

export interface RuleRequest {
  id: string;
  timestamp: number;
  requestedBy: string; // Spirit name or "god"
  lastError?: string;
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

type RequestGrant = { world: World; sourceCurrent: () => boolean; current: () => boolean };
type ProposalGrant = RequestGrant & { definition: string; signal?: AbortSignal; shapeError?: string };
let requestGrants = new WeakMap<RuleRequest, RequestGrant>();
let proposalGrants = new WeakMap<RuleProposal, ProposalGrant>();
const generating = new WeakSet<RuleRequest>();
let proposalIdCounter = 0;
const requestDefinition = (r: RuleRequest) => JSON.stringify([r.id, r.timestamp, r.requestedBy, r.description, r.context]);
const proposalDefinition = (p: RuleProposal) => JSON.stringify([p.id, p.timestamp, p.name, p.description, p.trigger, p.conditions, p.effects, p.priority, p.reason]);

function freezeDefinition<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeDefinition(child); Object.freeze(value); }
  return value;
}

function protectRuleDefinition(rule: RuleDefinition): RuleDefinition {
  // Preserve existing host enable/disable controls; they do not change the
  // admitted effect definition or mint a grant for another rule/source.
  for (const [key, value] of Object.entries(rule)) if (key !== "enabled") {
    freezeDefinition(value);
    Object.defineProperty(rule, key, { value, writable: false, configurable: false, enumerable: true });
  }
  return Object.seal(rule);
}

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
  requestGrants = new WeakMap(); proposalGrants = new WeakMap();
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
  requestedBy: string = "god",
  world?: World
): RuleRequest {
  assertSimulationTaskActive();
  if (!world) throw new Error("Lawgiver requests require an explicit World as the fourth argument");
  // Setup requests may precede the first tick; establish an initial epoch but
  // never restart a stopped one merely because an author asks for work.
  if (getCommittedEvents(world).sourceId === null) startCommittedEvents(world);
  const sourceCurrent = captureRuleSource(world), state = lawgiverState, signal = getSimulationTaskSignal();
  if (!sourceCurrent()) throw new Error("Lawgiver requests require a current committed world source");
  const request: RuleRequest = {
    id: `rule_req_${++requestIdCounter}_${Date.now()}`,
    timestamp: Date.now(),
    requestedBy,
    description,
    context: structuredClone(context),
  };

  const definition = requestDefinition(request);
  let valid = true;
  const current = () => {
    valid = valid && !signal?.aborted && state === lawgiverState && sourceCurrent() && requestDefinition(request) === definition;
    return valid;
  };
  requestGrants.set(request, { world, sourceCurrent, current });

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
  assertSimulationTaskActive();
  const grant = requestGrants.get(request), state = lawgiverState, signal = getSimulationTaskSignal();
  if (!grant || !grant.current() || !state.pendingRequests.includes(request) || generating.has(request)) return null;
  generating.add(request);
  const model = flashModel;

  // Get existing rules for context
  const existingRules = worldSchema.getActiveRules();
  const existingTypes = worldSchema.getAllObjectTypeIds();

  const prompt = `You are The Lawgiver, creator of deterministic world rules.

${getWorldAuthoringContext(grant.world)}

TASK: Create a deterministic rule for: "${request.description}"

CONTEXT:
- World theme: ${request.context.worldTheme || getWorldTheme(grant.world) || "unspecified setting"}
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
  "condition": { "has": ["flammable"], "not": ["burning"] },
  "effects": [ { "action": "add_trait", "target": "self", "params": { "trait": "burning" } } ],
  "reason": "Why this creates good emergent behavior"
}`;

  try {
    const response = await generateText({
      model,
      prompt,
      temperature: 0.5, // Lower temp for more deterministic rule design
      abortSignal: signal,
    });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      request.lastError = "Malformed rule response";
      console.error("[Lawgiver] Failed to extract JSON from response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const allowedKeys = new Set(["name", "description", "trigger", "condition", "conditions", "effects", "priority", "reason", "when", "then"]);
    const ambiguous = Object.keys(parsed).some(key => !allowedKeys.has(key))
      || [parsed.condition, parsed.conditions, parsed.when?.condition].filter(value => value !== undefined).length > 1
      || parsed.effects !== undefined && parsed.then !== undefined
      || parsed.trigger !== undefined && parsed.when?.event !== undefined
      || parsed.when !== undefined && (typeof parsed.when !== "object" || parsed.when === null || Array.isArray(parsed.when)
        || Object.keys(parsed.when).some(key => !["event", "condition"].includes(key)));

    // Preserve invalid values for atomic validation rather than silently
    // converting null/false conditions into an unconditional global rule.
    const conditions = parsed.when?.condition !== undefined ? [parsed.when.condition]
      : parsed.condition !== undefined ? [parsed.condition]
      : parsed.conditions !== undefined ? parsed.conditions : [];

    const proposal: RuleProposal = {
      id: `rule_prop_${Date.now()}_${++proposalIdCounter}`,
      timestamp: Date.now(),
      name: parsed.name,
      description: parsed.description,
      trigger: parsed.when?.event !== undefined ? parsed.when.event : parsed.trigger !== undefined ? parsed.trigger : "tick",
      conditions,
      effects: parsed.then !== undefined ? parsed.then : parsed.effects !== undefined ? parsed.effects : [],
      priority: parsed.priority !== undefined ? parsed.priority : 50,
      reason: parsed.reason || "Generated rule",
      status: "proposed",
    };
    proposalGrants.set(proposal, { ...grant, definition: proposalDefinition(proposal), signal,
      shapeError: ambiguous ? "Unknown or ambiguous rule fields" : undefined });
    if (ambiguous) proposal.rejectionReason = "Unknown or ambiguous rule fields";
    if (!grant.current() || signal?.aborted || !state.pendingRequests.includes(request)) {
      proposal.status = "rejected"; proposal.rejectionReason = "Stale or cancelled authoring source";
    }
    // A reset does not authorize old work to append into a new request registry.
    state.proposedRules.push(proposal);

    // Remove from pending
    state.pendingRequests = state.pendingRequests.filter(
      r => r.id !== request.id
    );

    console.log(`[Lawgiver] Generated rule proposal: ${proposal.name}`);

    return proposal;
  } catch (error) {
    request.lastError = signal?.aborted ? "Rule authoring cancelled" : "Rule authoring failed";
    console.error("[Lawgiver] Error generating rule:", error);
    return null;
  } finally { generating.delete(request); }
}

/**
 * Approve a rule proposal and register it with WorldSchema
 */
export function approveRule(proposalId: string): boolean {
  assertSimulationTaskActive();
  const proposal = lawgiverState.proposedRules.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") {
    return false;
  }

  try {
    const grant = proposalGrants.get(proposal);
    if (!grant || !grant.current() || grant.signal?.aborted || grant.definition !== proposalDefinition(proposal))
      throw new Error("Stale, changed or unowned rule proposal");
    if (grant.shapeError) throw new Error(grant.shapeError);
    if (worldSchema.getRule(proposal.name)) throw new Error("Rule name already owned; replacement requires separate authority");
    const ruleDef = protectRuleDefinition(validateRuleCandidate({ name: proposal.name, description: proposal.description,
      trigger: proposal.trigger, conditions: proposal.conditions, effects: proposal.effects, priority: proposal.priority }));
    grantRuntimeRule(grant.world, ruleDef, grant.sourceCurrent);
    worldSchema.defineRule(ruleDef);
  } catch (error) {
    proposal.status = "rejected";
    proposal.rejectionReason = error instanceof Error ? error.message.slice(0, 1000) : "Invalid rule proposal";
    return false;
  }

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
  assertSimulationTaskActive();
  const proposal = lawgiverState.proposedRules.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "proposed") {
    return false;
  }

  proposal.status = "rejected";
  proposal.rejectionReason = reason.slice(0, 1000);
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
  assertSimulationTaskActive();
  let rulesProposed = 0;

  // Process pending rule requests
  for (const request of [...lawgiverState.pendingRequests]) {
    if (requestGrants.get(request)?.world !== registry.world) continue;
    const proposal = await generateRuleProposal(request);
    if (proposal) {
      rulesProposed++;
    }
  }

  // For now, auto-approve proposed rules (could add God approval flow)
  let rulesApproved = 0;
  for (const proposal of lawgiverState.proposedRules) {
    if (proposalGrants.get(proposal)?.world !== registry.world) continue;
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
