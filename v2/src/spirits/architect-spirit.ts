/**
 * Architect Spirit
 *
 * A spirit type that can DESIGN and CREATE new simulation elements.
 * Architects are creative spirits that propose and (when approved) execute:
 * - New SYSTEMS (behavioral patterns for the world)
 * - New COMPONENTS (data types for entities)
 * - New ENTITIES (objects, NPCs, places)
 * - New RULES (automatic consequences)
 *
 * This is the key to a self-growing simulation - architects observe needs
 * and propose solutions that expand the world's capabilities.
 *
 * Examples:
 * - QuestArchitect: Creates quest systems and quest entities
 * - WeatherArchitect: Proposes weather systems when environmental detail needed
 * - CraftingArchitect: Creates crafting systems and recipes
 */

import { generateText } from "ai";
import { addEntity, addComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Agent, Mind, Needs, Health, Room, StimulusSource } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import { spiritModel, plannerModel, codeModel as designModel31 } from "../llm/config";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import { registerSystem } from "../ecs/dynamic-systems";
import { createDynamicComponent, getDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";
import type { SpiritRegistry } from "./spirit-registry";
import { reportToSuperior } from "./spirit-registry";
import {
  type DynamicSpiritState,
  type ArchitectConfig,
  type SpiritProposal,
  submitProposal,
  getApprovedProposals,
  markProposalExecuted,
  logSpiritExecution,
} from "./spirit-factory";
import { recordEvent, getRecentEvents, getDetectedPatterns } from "./consistency-spirit";
import { getIntrospectionContext } from "../introspection/introspection";
import {
  registerAffordance,
  type AffordanceDefinition,
} from "../world/schema";
import {
  registerTrait,
  isTraitRegistered,
  type TraitDefinition,
  type TraitCategory,
} from "../world/trait-registry";
import {
  registerRelationshipType,
  hasRelationshipType,
  type RelationshipTypeDefinition,
} from "../ecs/relationship-registry";

// =============================================================================
// PROPOSAL SPECIFICATIONS
// =============================================================================

export interface SystemProposalSpec {
  name: string;
  description: string;
  frequency: number;
  targetComponents: string[];
  logic: string;  // Natural language description of what it does
  triggers?: string[];  // What triggers the system
  effects?: string[];   // What effects it has
}

export interface ComponentProposalSpec {
  name: string;
  description: string;
  fields: { name: string; type: string; description: string }[];
  category: string;
}

export interface EntityProposalSpec {
  name: string;
  description: string;
  type: "agent" | "object" | "room" | "stimulus_source";
  components: { name: string; values: Record<string, any> }[];
  roomEid?: number;  // Where to place it
}

export interface RuleProposalSpec {
  name: string;
  description: string;
  trigger: string;   // When to fire
  condition: string; // What must be true
  effect: string;    // What happens
}

/**
 * Robustly extract JSON from LLM output that may contain markdown fences,
 * trailing commas, comments, or other noise.
 */
function extractJSON(text: string): any {
  let s = text.trim();

  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");

  // Try direct parse first
  try { return JSON.parse(s); } catch {}

  // Find first [ or { and last ] or }
  const firstBracket = s.search(/[\[{]/);
  const lastBracket = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    let candidate = s.slice(firstBracket, lastBracket + 1);

    // Strip single-line comments
    candidate = candidate.replace(/\/\/[^\n]*/g, "");
    // Strip trailing commas before } or ]
    candidate = candidate.replace(/,\s*([}\]])/g, "$1");

    try { return JSON.parse(candidate); } catch {}

    // Last resort: try to fix unterminated strings by closing them
    const fixed = candidate.replace(/:\s*"([^"]*?)(\n|$)/g, ': "$1"$2');
    try { return JSON.parse(fixed); } catch {}
  }

  throw new SyntaxError(`Could not extract valid JSON from LLM output (${s.length} chars)`);
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

const DEFAULT_BAKE_TIMEOUT_MS = readPositiveIntEnv("SPIRIT_BAKE_TIMEOUT_MS", 120000);
const DEFAULT_BAKE_MAX_RETRIES = readPositiveIntEnv("SPIRIT_BAKE_MAX_RETRIES", 3);
const DEFAULT_MAX_APPROVED_PER_PASS = readPositiveIntEnv("SPIRIT_MAX_APPROVED_PER_PASS", 3);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function toPascalCase(input: string): string {
  const cleaned = input.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return "Adaptive";
  return cleaned
    .split(/\s+/)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join("");
}

// =============================================================================
// ARCHITECT COGNITION
// =============================================================================

/**
 * Consume structured gap observations from The Watcher's messages in the inbox.
 * Converts Watcher proposals into IdentifiedNeeds without an LLM call.
 */
function consumeWatcherMessages(architect: DynamicSpiritState): IdentifiedNeed[] {
  // Find the SpiritState that owns this architect (check the spirit registry indirectly via inbox)
  // The architect's inbox lives on the SpiritState, which is accessed through the spirit-factory layer.
  // For dynamic spirits, the inbox is on architect.state (the DynamicSpiritState wraps a SpiritState).
  const state = (architect as any).state as { inbox?: any[] } | undefined;
  const inbox = state?.inbox || (architect as any).inbox || [];

  const needs: IdentifiedNeed[] = [];
  const watcherMessages: number[] = [];

  for (let i = 0; i < inbox.length; i++) {
    const msg = inbox[i];
    if (!msg || typeof msg !== "object") continue;
    const subject = String(msg.subject || "");
    const content = String(msg.content || "");

    // Only process Watcher messages
    if (!subject.includes("[Watcher]")) continue;
    watcherMessages.push(i);

    // Parse individual proposals from the message content
    // Format: "1. [SYSTEM] Title (priority: 75, reporters: ...)\n   Description"
    const proposalRegex = /\d+\.\s*\[(\w+)\]\s*(.+?)\s*\(priority:\s*(\d+)/g;
    let match;
    while ((match = proposalRegex.exec(content)) !== null) {
      const typeRaw = match[1].toLowerCase();
      const title = match[2].trim();
      const priority = parseInt(match[3], 10);

      const type: IdentifiedNeed["type"] =
        typeRaw === "system" ? "system" :
        typeRaw === "component" ? "component" :
        typeRaw === "entity" ? "entity" :
        typeRaw === "rule" ? "rule" :
        typeRaw === "affordance" ? "affordance" :
        typeRaw === "trait" ? "trait" :
        typeRaw === "relationship_type" || typeRaw === "relationship" ? "relationship_type" :
        "system";

      const needPriority: IdentifiedNeed["priority"] =
        priority >= 60 ? "high" : priority >= 30 ? "medium" : "low";

      // Extract description (everything after the header line until next numbered item)
      const titleIdx = content.indexOf(title);
      const descStart = content.indexOf("\n", titleIdx);
      let description = title;
      if (descStart !== -1) {
        const nextItem = content.indexOf("\n\n", descStart + 1);
        description = content.slice(descStart + 1, nextItem !== -1 ? nextItem : undefined).trim() || title;
      }

      needs.push({
        type,
        description,
        priority: needPriority,
        rationale: `Synthesized from spirit observations (priority: ${priority}). ${title}`,
      });
    }
  }

  // Remove processed Watcher messages from inbox (reverse order to preserve indices)
  for (let i = watcherMessages.length - 1; i >= 0; i--) {
    inbox.splice(watcherMessages[i], 1);
  }

  if (needs.length > 0) {
    console.log(`[Architect] Consumed ${needs.length} needs from Watcher observations`);
  }

  return needs;
}

/**
 * Run architect cognition cycle - observe, design, propose
 */
export async function runArchitectCognition(
  world: World,
  systemRegistry: SystemRegistry,
  spiritRegistry: SpiritRegistry,
  architect: DynamicSpiritState
): Promise<SpiritProposal[]> {
  if (!architect.architectConfig) {
    console.error(`[Architect] Spirit ${architect.definition.name} has no architect config`);
    return [];
  }

  // 1. OBSERVE: Gather context about the simulation state
  const context = await gatherArchitectContext(world, systemRegistry);

  // 1.5. CONSUME WATCHER OBSERVATIONS: Extract structured needs from Watcher messages
  const watcherNeeds = consumeWatcherMessages(architect);

  // 2. ANALYZE: Identify needs and opportunities (LLM-based + Watcher-provided)
  const llmNeeds = await identifyNeeds(architect, context);
  const allNeeds = [...watcherNeeds, ...llmNeeds];

  // Prioritize system proposals first (they're the highest-value evolution),
  // then by priority level, keeping relative order stable within tiers
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const typeOrder: Record<string, number> = { system: 0, component: 1, rule: 2, entity: 3 };
  const needs = allNeeds.sort((a, b) => {
    const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9);
  });

  // 3. DESIGN: Create proposals for addressing needs
  const proposals: SpiritProposal[] = [];

  for (const need of needs.slice(0, architect.architectConfig.maxProposalsPerCycle || 3)) {
    const proposal = await designProposal(architect, need, context, spiritRegistry);
    if (proposal) {
      proposals.push(proposal);
    }
  }

  // 4. EXECUTE: Process any approved proposals
  await executeApprovedProposals(world, systemRegistry, architect);

  // Record cognition event
  recordEvent("architect_cognition", {
    architect: architect.definition.name,
    needsIdentified: needs.length,
    proposalsCreated: proposals.length,
  }, architect.definition.name);

  logSpiritExecution(
    architect.eid,
    "design",
    `${proposals.length} proposals`,
    "success",
    `Needs: ${needs.length}`
  );

  return proposals;
}

interface ArchitectContext {
  existingSystems: string[];
  existingComponents: string[];
  entityCounts: Record<string, number>;
  recentEvents: any[];
  detectedPatterns: any[];
  agentStates: { name: string; arousal: number; goalCount: number }[];
}

async function gatherArchitectContext(
  world: World,
  systemRegistry: SystemRegistry
): Promise<ArchitectContext> {
  // Get event buffer for introspection
  const { getGlobalEventBuffer } = await import("./consistency-spirit");
  const eventBuffer = getGlobalEventBuffer();

  const introspection = getIntrospectionContext(world, systemRegistry, eventBuffer);

  // Get agent entities from the entities list
  const agents = introspection.entities.filter(e => e.isAgent);

  // Build entity counts by type
  const entityCounts: Record<string, number> = {
    agents: introspection.agentCount,
    rooms: introspection.roomCount,
    total: introspection.entities.length,
  };

  return {
    existingSystems: introspection.systems.map(s => s.name),
    existingComponents: introspection.availableComponents.map(c => c.name),
    entityCounts,
    recentEvents: getRecentEvents(50),
    detectedPatterns: getDetectedPatterns(),
    agentStates: agents.map((a: any) => ({
      name: a.name,
      arousal: a.arousal ?? 0.5,
      goalCount: Array.isArray(a.goals) ? a.goals.length : 0,
    })),
  };
}

interface IdentifiedNeed {
  type: "system" | "component" | "entity" | "rule" | "affordance" | "trait" | "relationship_type";
  description: string;
  priority: "low" | "medium" | "high";
  rationale: string;
}

function isNeedType(value: unknown): value is IdentifiedNeed["type"] {
  return value === "system" || value === "component" || value === "entity" || value === "rule"
    || value === "affordance" || value === "trait" || value === "relationship_type";
}

function isPriority(value: unknown): value is IdentifiedNeed["priority"] {
  return value === "low" || value === "medium" || value === "high";
}

function normalizeNeed(raw: any): IdentifiedNeed | null {
  if (!raw || typeof raw !== "object") return null;
  if (!isNeedType(raw.type)) return null;

  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return null;

  const priority: IdentifiedNeed["priority"] = isPriority(raw.priority) ? raw.priority : "medium";
  const rationale = typeof raw.rationale === "string" && raw.rationale.trim().length > 0
    ? raw.rationale.trim()
    : "Improves simulation robustness and behavioral depth.";

  return {
    type: raw.type,
    description,
    priority,
    rationale,
  };
}

function createFallbackNeeds(
  architect: DynamicSpiritState,
  context: ArchitectContext
): IdentifiedNeed[] {
  const needs: IdentifiedNeed[] = [];
  const domain = architect.definition.domain.toLowerCase();
  const can = architect.architectConfig;
  const hasSystem = (fragment: string) =>
    context.existingSystems.some((s) => s.toLowerCase().includes(fragment.toLowerCase()));

  if (can?.canProposeSystems) {
    if (domain === "economy" && !hasSystem("trade")) {
      needs.push({
        type: "system",
        description: "Add a deterministic trade loop so NPCs can exchange goods and money.",
        priority: "high",
        rationale: "Economy domain requires stable exchange behavior for emergent office/world activity.",
      });
    } else if (domain === "narrative" && !hasSystem("event")) {
      needs.push({
        type: "system",
        description: "Add a narrative event cadence system that updates agent focus over time.",
        priority: "medium",
        rationale: "Narrative momentum prevents static worlds and keeps agent goals moving.",
      });
    } else if (!hasSystem("goal")) {
      needs.push({
        type: "system",
        description: "Add a goal maintenance system that creates and progresses NPC goals.",
        priority: "high",
        rationale: "Without goal progression, agents stall and cognition output becomes repetitive.",
      });
    }
  }

  if (can?.canProposeComponents && !context.existingComponents.includes("TaskMomentum")) {
    needs.push({
      type: "component",
      description: "Introduce TaskMomentum component to track how strongly an agent is pursuing a goal.",
      priority: "medium",
      rationale: "A lightweight momentum signal helps prevent thrash and supports deterministic policies.",
    });
  }

  if (can?.canProposeEntities) {
    if (context.entityCounts.rooms < 3) {
      needs.push({
        type: "entity",
        description: "Create a collaborative workspace room for NPC interactions.",
        priority: "medium",
        rationale: "Additional shared spaces increase collisions and social opportunities.",
      });
    } else if ((context.entityCounts.agents || 0) < 6) {
      needs.push({
        type: "entity",
        description: "Add a specialist NPC who can participate in new tasks.",
        priority: "low",
        rationale: "More agents create richer interactions and reduce brittle single-agent loops.",
      });
    }
  }

  return needs.slice(0, can?.maxProposalsPerCycle || 3);
}

function fallbackSpecificationForNeed(
  need: IdentifiedNeed,
  context: ArchitectContext
): SystemProposalSpec | ComponentProposalSpec | EntityProposalSpec | RuleProposalSpec {
  const baseName = toPascalCase(need.description);

  if (need.type === "system") {
    const targetComponents = ["Agent", "Mind"];
    if (context.existingComponents.includes("Needs")) targetComponents.push("Needs");
    if (context.existingComponents.includes("Goal")) targetComponents.push("Goal");

    return {
      name: `${baseName.replace(/System$/, "")}System`,
      description: need.description,
      frequency: 8000,
      targetComponents,
      logic:
        "For each active agent, read needs/arousal, nudge focus toward the highest unmet need, and clamp values to stable ranges.",
      triggers: ["tick"],
      effects: ["Improved NPC focus stability", "Reduced idle thrashing"],
    };
  }

  if (need.type === "component") {
    return {
      name: `${baseName.replace(/Component$/, "")}Component`,
      description: need.description,
      category: "cognition",
      fields: [
        { name: "level", type: "number", description: "Current momentum/intensity value." },
        { name: "status", type: "string", description: "Current state label for this signal." },
      ],
    };
  }

  if (need.type === "entity") {
    const lower = need.description.toLowerCase();
    if (lower.includes("room") || lower.includes("workspace") || lower.includes("office")) {
      return {
        name: `${baseName.replace(/Room$/, "")}Room`,
        description: need.description,
        type: "room",
        components: [
          { name: "Room", values: { capacity: 12, ambience: "busy but focused" } },
        ],
      };
    }

    // Generate a proper name instead of converting the description to PascalCase
    const npcNames = ["Thorne", "Mira", "Cedric", "Lyra", "Gareth", "Fern", "Aldric", "Petra", "Rowan", "Sage", "Vesta", "Orin", "Dalia", "Bram", "Wren"];
    const npcName = npcNames[Math.floor(Math.random() * npcNames.length)];

    return {
      name: npcName,
      description: need.description,
      type: "agent",
      components: [
        { name: "Agent", values: { role: "specialist", active: true } },
        { name: "Mind", values: { mode: "reactive", arousal: 0.5, focus: "assist team" } },
        { name: "Needs", values: { hunger: 25, energy: 70, social: 45, comfort: 55 } },
        { name: "Health", values: { current: 100, max: 100 } },
      ],
    };
  }

  return {
    name: `${baseName.replace(/Rule$/, "")}Rule`,
    description: need.description,
    trigger: "On each tick",
    condition: "When an agent is idle and has unmet needs",
    effect: "Create or increase a relevant goal priority",
  };
}

async function identifyNeeds(
  architect: DynamicSpiritState,
  context: ArchitectContext
): Promise<IdentifiedNeed[]> {
  try {
    const result = await generateText({
      model: spiritModel,
      prompt: `You are ${architect.definition.name}, an architect spirit in the ${architect.definition.domain} domain.

Your role is to identify what the simulation NEEDS to grow and improve.

CURRENT STATE:
- Systems: ${context.existingSystems.join(", ") || "none"}
- Components: ${context.existingComponents.slice(0, 20).join(", ")}
- Entity counts: ${JSON.stringify(context.entityCounts)}
- Agent states: ${context.agentStates.map(a => `${a.name}(arousal:${a.arousal.toFixed(2)}, goals:${a.goalCount})`).join(", ")}
- Detected patterns: ${context.detectedPatterns.map(p => p.description).join("; ") || "none"}

Based on your domain expertise (${architect.definition.domain}), identify 1-3 NEEDS:
- Missing systems that would enhance simulation
- Components that would enable new behaviors
- Entities that would add richness
- Rules that would create emergent behavior

Respond with a JSON array of needs:
[
  {
    "type": "system|component|entity|rule",
    "description": "What is needed",
    "priority": "low|medium|high",
    "rationale": "Why this would improve the simulation"
  }
]`,
    });

    const parsed = extractJSON(result.text);
    const normalized = (Array.isArray(parsed) ? parsed : []).map(normalizeNeed).filter(Boolean) as IdentifiedNeed[];

    if (normalized.length > 0) return normalized;

    console.warn(`[Architect] ${architect.definition.name} produced no valid needs; using fallback needs`);
    return createFallbackNeeds(architect, context);
  } catch (error) {
    console.error(`[Architect] Failed to identify needs:`, error);
    return createFallbackNeeds(architect, context);
  }
}

async function designProposal(
  architect: DynamicSpiritState,
  need: IdentifiedNeed,
  context: ArchitectContext,
  spiritRegistry?: SpiritRegistry
): Promise<SpiritProposal | null> {
  let specification: any = null;
  let rawOutput = "";

  try {
    const specPrompt = getSpecificationPrompt(need.type, need.description, context);

    const result = await generateText({
      model: designModel31,  // Gemini 3.1 Pro - better structured output
      prompt: `You are ${architect.definition.name}, designing a solution for: ${need.description}

${specPrompt}

Respond with valid JSON only, no markdown fences, no comments.`,
    });

    rawOutput = result.text;
    specification = extractJSON(result.text);
  } catch (error) {
    console.error(`[Architect] Failed to design ${need.type} proposal for "${need.description}":`, error);
    if (rawOutput) console.error(`[Architect] Raw LLM output (first 300 chars): ${rawOutput.slice(0, 300)}`);
    specification = fallbackSpecificationForNeed(need, context);
  }

  if (!specification || typeof specification !== "object") {
    specification = fallbackSpecificationForNeed(need, context);
  }

  if (!specification.name || typeof specification.name !== "string") {
    specification.name = toPascalCase(need.description) + (need.type === "system" ? "System" : "");
  }
  if (!specification.description || typeof specification.description !== "string") {
    specification.description = need.description;
  }

  const proposal = submitProposal(
    architect.eid,
    need.type,
    specification.name,
    specification.description,
    specification,
    need.rationale
  );

  if (proposal) {
    console.log(`[Architect] ${architect.definition.name} proposed ${need.type}: ${specification.name}`);

    // Report proposal to superior (only if registry is available)
    if (spiritRegistry) {
      reportToSuperior(
        spiritRegistry,
        architect.eid,
        `New Proposal: ${specification.name}`,
        `**Type:** ${need.type}\n**Description:** ${specification.description}\n**Rationale:** ${need.rationale}`,
        need.priority as any,
        { proposal }
      );
    }
  }

  return proposal;
}

function getSpecificationPrompt(
  type: IdentifiedNeed["type"],
  description: string,
  context: ArchitectContext
): string {
  switch (type) {
    case "system":
      return `Design a SYSTEM for: ${description}

Required JSON format:
{
  "name": "SystemName",
  "description": "What the system does",
  "frequency": 10000,  // ms between executions
  "targetComponents": ["ComponentA", "ComponentB"],
  "logic": "Step by step description of what the system does",
  "triggers": ["event_type_1", "event_type_2"],
  "effects": ["effect_1", "effect_2"]
}

Existing systems (avoid duplicates): ${context.existingSystems.join(", ")}
Existing components (use these): ${context.existingComponents.slice(0, 20).join(", ")}`;

    case "component":
      return `Design a COMPONENT for: ${description}

Required JSON format:
{
  "name": "ComponentName",
  "description": "What data this component stores",
  "fields": [
    { "name": "fieldName", "type": "string|number|boolean", "description": "What this field stores" }
  ],
  "category": "identity|cognition|stats|spatial|social|equipment"
}

Existing components (avoid duplicates): ${context.existingComponents.join(", ")}`;

    case "entity":
      return `Design an ENTITY for: ${description}

Required JSON format:
{
  "name": "EntityName",
  "description": "What this entity is",
  "type": "agent|object|room|stimulus_source",
  "components": [
    { "name": "ComponentName", "values": { "field": "value" } }
  ]
}

Existing components (use these): ${context.existingComponents.slice(0, 20).join(", ")}`;

    case "rule":
      return `Design a RULE for: ${description}

Required JSON format:
{
  "name": "RuleName",
  "description": "What this rule does",
  "trigger": "What event triggers this rule",
  "condition": "What must be true for rule to fire",
  "effect": "What happens when rule fires"
}`;

    case "affordance":
      return `Design an AFFORDANCE (action that can be performed on objects) for: ${description}

Required JSON format:
{
  "name": "affordanceName",
  "description": "What this action does",
  "requires": ["trait1", "trait2"],
  "effects": [
    { "type": "emit_stimulus", "target": "nearby", "stimulusType": "action", "stimulusContent": "{actor.name} does something to {target.name}" }
  ]
}`;

    case "trait":
      return `Design a TRAIT (tag for entities enabling affordances) for: ${description}

Required JSON format:
{
  "name": "traitName",
  "description": "What this trait means for an entity",
  "category": "physical|interactive|social|sensory|state|custom",
  "enablesAffordances": ["affordance1"],
  "incompatibleWith": []
}`;

    case "relationship_type":
      return `Design a RELATIONSHIP TYPE (dynamic link between entities) for: ${description}

Required JSON format:
{
  "name": "RelationName",
  "description": "What this relationship represents",
  "dataFields": { "strength": "number", "since": "string" },
  "isExclusive": false,
  "autoRemoveSubject": false
}`;

    default:
      return `Design a solution for: ${description}`;
  }
}

// =============================================================================
// PROPOSAL EXECUTION
// =============================================================================

async function executeApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  architect: DynamicSpiritState
): Promise<void> {
  if (!architect.architectConfig?.canExecuteDirectly) {
    return;  // This architect can't execute directly
  }

  const approved = getApprovedProposals().filter(
    p => p.fromSpiritEid === architect.eid
  );

  for (const proposal of approved) {
    try {
      await executeProposal(world, systemRegistry, proposal);
      markProposalExecuted(proposal.id);

      logSpiritExecution(
        architect.eid,
        `execute_${proposal.type}`,
        proposal.name,
        "success"
      );

      console.log(`[Architect] Executed proposal: ${proposal.name}`);
    } catch (error) {
      logSpiritExecution(
        architect.eid,
        `execute_${proposal.type}`,
        proposal.name,
        "failure",
        String(error)
      );
      console.error(`[Architect] Failed to execute proposal ${proposal.name}:`, error);
    }
  }
}

async function executeProposal(
  world: World,
  systemRegistry: SystemRegistry,
  proposal: SpiritProposal
): Promise<void> {
  switch (proposal.type) {
    case "system":
      await executeSystemProposal(world, systemRegistry, proposal.specification as SystemProposalSpec);
      break;
    case "component":
      executeComponentProposal(world, proposal.specification as ComponentProposalSpec);
      break;
    case "entity":
      executeEntityProposal(world, proposal.specification as EntityProposalSpec);
      break;
    case "rule":
      console.log(`[Architect] Rule execution not yet implemented: ${proposal.name}`);
      break;
    case "affordance":
      executeAffordanceProposal(proposal.specification);
      break;
    case "trait":
      executeTraitProposal(proposal.specification);
      break;
    case "relationship_type":
      executeRelationshipTypeProposal(proposal.specification);
      break;
  }
}

function registerPlaceholderSystem(
  systemRegistry: SystemRegistry,
  spec: SystemProposalSpec,
  reason: string
): void {
  const placeholderDef: SystemDefinition = {
    name: spec.name,
    description: spec.description,
    pseudocode: spec.logic,
    frequency: spec.frequency,
    active: true,
    lastRun: 0,
    compiledFn: (world, ctx) => {
      const agents = Array.from(ctx.query(world, [Agent, Mind]));
      let processed = 0;

      for (const eid of agents) {
        if (!Agent.active[eid]) continue;
        const current = Mind.arousal[eid] || 0.5;
        const next = current > 0.55 ? current - 0.02 : current + 0.01;
        Mind.arousal[eid] = Math.max(0.1, Math.min(0.9, next));

        if (!Mind.focus[eid]) {
          Mind.focus[eid] = `adapt:${spec.name}`;
        }
        processed++;
      }

      if (processed > 0) {
        ctx.emit("architect_placeholder_tick", {
          system: spec.name,
          processed,
          reason,
        });
      }
    },
  };

  registerSystem(systemRegistry, placeholderDef);

  recordEvent("system_created_placeholder", {
    name: spec.name,
    description: spec.description,
    createdBy: "architect",
    reason,
  }, "Architect");
}

// =============================================================================
// VOCABULARY PROPOSAL EXECUTION
// =============================================================================

interface AffordanceProposalSpec {
  name: string;
  description: string;
  requires: string[];
  effects?: any[];
}

interface TraitProposalSpec {
  name: string;
  description: string;
  category: string;
  enablesAffordances?: string[];
  incompatibleWith?: string[];
}

interface RelationshipTypeProposalSpec {
  name: string;
  description: string;
  dataFields?: Record<string, "number" | "string">;
  isExclusive?: boolean;
  autoRemoveSubject?: boolean;
}

function executeAffordanceProposal(spec: AffordanceProposalSpec): void {
  // Auto-register required traits that don't exist
  for (const traitName of spec.requires || []) {
    if (!isTraitRegistered(traitName)) {
      registerTrait({
        name: traitName,
        description: `Enables ${spec.name} interaction`,
        category: "custom" as TraitCategory,
        enablesAffordances: [spec.name],
        incompatibleWith: [],
      });
      console.log(`[Architect] Auto-registered trait: ${traitName}`);
    }
  }

  const def: AffordanceDefinition = {
    name: spec.name,
    requires: spec.requires || [],
    effects: spec.effects as any,
    descriptionTemplate: `{actor.name} performs ${spec.name} on {target.name}.`,
  };
  registerAffordance(def);
  console.log(`[Architect] Created affordance: ${spec.name}`);

  recordEvent("affordance_created", {
    name: spec.name,
    requires: spec.requires,
    createdBy: "architect",
  }, "Architect");
}

function executeTraitProposal(spec: TraitProposalSpec): void {
  const def: TraitDefinition = {
    name: spec.name,
    description: spec.description,
    category: (spec.category || "custom") as TraitCategory,
    enablesAffordances: spec.enablesAffordances || [],
    incompatibleWith: spec.incompatibleWith || [],
  };
  registerTrait(def);
  console.log(`[Architect] Created trait: ${spec.name} (${spec.category})`);

  recordEvent("trait_created", {
    name: spec.name,
    category: spec.category,
    createdBy: "architect",
  }, "Architect");
}

function executeRelationshipTypeProposal(spec: RelationshipTypeProposalSpec): void {
  if (hasRelationshipType(spec.name)) {
    console.log(`[Architect] Relationship type already exists: ${spec.name}`);
    return;
  }

  const def: RelationshipTypeDefinition = {
    name: spec.name,
    description: spec.description,
    dataFields: spec.dataFields || {},
    isExclusive: spec.isExclusive || false,
    autoRemoveSubject: spec.autoRemoveSubject || false,
    category: "custom",
  };
  registerRelationshipType(def);
  console.log(`[Architect] Created relationship type: ${spec.name}`);

  recordEvent("relationship_type_created", {
    name: spec.name,
    createdBy: "architect",
  }, "Architect");
}

async function executeSystemProposal(
  world: World,
  systemRegistry: SystemRegistry,
  spec: SystemProposalSpec
): Promise<void> {
  // Build a detailed description for the system baker
  const bakerDescription = `
System Name: ${spec.name}
Purpose: ${spec.description}
Frequency: ${spec.frequency}ms
Target Components: ${spec.targetComponents.join(", ")}

Logic Description:
${spec.logic}

${spec.triggers?.length ? `Triggers: ${spec.triggers.join(", ")}` : ""}
${spec.effects?.length ? `Effects: ${spec.effects.join(", ")}` : ""}
`.trim();

  try {
    if (process.env.SPIRIT_FORCE_PLACEHOLDER_SYSTEMS === "1") {
      registerPlaceholderSystem(systemRegistry, spec, "SPIRIT_FORCE_PLACEHOLDER_SYSTEMS=1");
      console.log(`[Architect] ⚠ Registered placeholder for ${spec.name} (forced by env)`);
      return;
    }

    // Actually bake the system using the system baker
    const { bakeSystem } = await import("../god/system-baker");
    const result = await withTimeout(
      bakeSystem(bakerDescription, world, systemRegistry, DEFAULT_BAKE_MAX_RETRIES),
      DEFAULT_BAKE_TIMEOUT_MS,
      `Baking ${spec.name}`
    );

    if (result.success && result.system) {
      // Override the frequency with the architect's specification
      result.system.frequency = spec.frequency;
      result.system.active = true;  // Enable the system so runSystems will execute it

      // REGISTER THE BAKED SYSTEM!
      registerSystem(systemRegistry, result.system);

      recordEvent("system_baked", {
        name: spec.name,
        description: spec.description,
        createdBy: "architect",
        bakedSuccessfully: true,
      }, "Architect");

      console.log(`[Architect] ✓ Baked and registered system: ${spec.name}`);
    } else {
      console.log(`[Architect] Baking failed for ${spec.name}: ${result.error}`);
      registerPlaceholderSystem(systemRegistry, spec, result.error || "unknown bake failure");
    }
  } catch (error) {
    console.error(`[Architect] Error baking system ${spec.name}:`, error);
    registerPlaceholderSystem(systemRegistry, spec, String(error));
  }
}

function executeComponentProposal(
  world: World,
  spec: ComponentProposalSpec
): void {
  // Validate spec has required fields
  if (!spec || !spec.name) {
    console.warn(`[Architect] Invalid component proposal: missing name`);
    return;
  }

  // Create dynamic component with proper ComponentDefinition structure
  const properties: Record<string, "string" | "number" | "boolean"> = {};
  if (spec.fields && Array.isArray(spec.fields)) {
    for (const field of spec.fields) {
      if (
        field.name &&
        (field.type === "string" || field.type === "number" || field.type === "boolean")
      ) {
        properties[field.name] = field.type;
      }
    }
  }

  createDynamicComponent({
    name: spec.name,
    properties,
    description: spec.description || `Dynamic component: ${spec.name}`,
  });

  recordEvent("component_created", {
    name: spec.name,
    fields: spec.fields?.map(f => f.name) || [],
    createdBy: "architect",
  }, "Architect");

  console.log(`[Architect] Created component: ${spec.name}`);
}

function executeEntityProposal(
  world: World,
  spec: EntityProposalSpec
): void {
  const asNumber = (value: any, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const asString = (value: any, fallback: string): string =>
    typeof value === "string" ? value : fallback;
  const asBoolean = (value: any, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;

  const componentSpecs = Array.isArray(spec.components) ? spec.components : [];
  const getValues = (name: string): Record<string, any> => {
    const found = componentSpecs.find((c) => c?.name?.toLowerCase() === name.toLowerCase());
    return (found?.values && typeof found.values === "object") ? found.values : {};
  };

  const eid = addEntity(world);

  addComponent(world, eid, Name);
  Name.value[eid] = spec.name;

  addComponent(world, eid, Description);
  Description.value[eid] = spec.description;

  // Materialize baseline built-ins by proposed entity type.
  if (spec.type === "room") {
    const values = getValues("Room");
    addComponent(world, eid, Room);
    Room.capacity[eid] = asNumber(values.capacity, 12);
    Room.ambience[eid] = asString(values.ambience, "neutral");
  } else if (spec.type === "agent") {
    const agentValues = getValues("Agent");
    const mindValues = getValues("Mind");
    const needsValues = getValues("Needs");
    const healthValues = getValues("Health");

    addComponent(world, eid, Agent);
    Agent.role[eid] = asString(agentValues.role, "worker");
    Agent.systemPrompt[eid] = asString(
      agentValues.systemPrompt,
      `You are ${spec.name}, an autonomous agent in the simulation.`
    );
    Agent.active[eid] = asBoolean(agentValues.active, true);

    addComponent(world, eid, Mind);
    Mind.mode[eid] = asString(mindValues.mode, "reactive");
    Mind.arousal[eid] = asNumber(mindValues.arousal, 0.5);
    Mind.focus[eid] = asString(mindValues.focus, "");
    Mind.lastUpdate[eid] = Date.now();

    addComponent(world, eid, Needs);
    Needs.hunger[eid] = asNumber(needsValues.hunger, 20);
    Needs.energy[eid] = asNumber(needsValues.energy, 70);
    Needs.social[eid] = asNumber(needsValues.social, 40);
    Needs.comfort[eid] = asNumber(needsValues.comfort, 50);

    addComponent(world, eid, Health);
    Health.current[eid] = asNumber(healthValues.current, 100);
    Health.max[eid] = asNumber(healthValues.max, 100);

    if (Number.isFinite(spec.roomEid)) {
      addComponent(world, eid, OccupiesRoom(spec.roomEid as number));
    }
  } else if (spec.type === "stimulus_source") {
    const values = getValues("StimulusSource");
    addComponent(world, eid, StimulusSource);
    StimulusSource.stimulusType[eid] = asString(values.stimulusType, "environmental");
    StimulusSource.template[eid] = asString(values.template, `${spec.name} hums softly.`);
    StimulusSource.interval[eid] = asNumber(values.interval, 12000);
    StimulusSource.lastEmit[eid] = 0;
  }

  // Apply values for dynamic components when present.
  const builtins = new Set(["name", "description", "agent", "mind", "needs", "health", "room", "stimulussource"]);
  for (const comp of componentSpecs) {
    if (!comp || typeof comp.name !== "string" || !comp.values || typeof comp.values !== "object") {
      continue;
    }

    if (builtins.has(comp.name.toLowerCase())) {
      continue;
    }

    const dynamic = getDynamicComponent(comp.name);
    if (!dynamic) {
      console.log(`[Architect] Skipping unknown component ${comp.name} for ${spec.name}`);
      continue;
    }

    for (const [key, value] of Object.entries(comp.values)) {
      setDynamicComponentValue(comp.name, eid, key, value);
    }
  }

  recordEvent("entity_created", {
    name: spec.name,
    type: spec.type,
    eid,
    componentCount: componentSpecs.length,
    createdBy: "architect",
  }, "Architect");

  console.log(`[Architect] Created entity: ${spec.name} (eid: ${eid}, type: ${spec.type})`);
}

// =============================================================================
// STANDALONE PROPOSAL EXECUTION
// =============================================================================

/**
 * Execute all approved proposals (can be called independently of architect cognition)
 */
export async function executeAllApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  options: { maxProposals?: number } = {}
): Promise<{ executed: string[]; failed: string[] }> {
  const maxProposals = Math.max(1, options.maxProposals ?? DEFAULT_MAX_APPROVED_PER_PASS);
  const approved = getApprovedProposals();
  const batch = approved.slice(0, maxProposals);
  const executed: string[] = [];
  const failed: string[] = [];

  if (approved.length > batch.length) {
    console.log(
      `[Architect] Limiting execution to ${batch.length}/${approved.length} approved proposals this pass`
    );
  }

  for (const proposal of batch) {
    try {
      console.log(`[Architect] Executing approved proposal: ${proposal.name}`);
      await executeProposal(world, systemRegistry, proposal);
      markProposalExecuted(proposal.id);
      executed.push(proposal.name);
      console.log(`[Architect] ✓ Executed: ${proposal.name}`);
    } catch (error) {
      failed.push(proposal.name);
      console.error(`[Architect] ✗ Failed to execute ${proposal.name}:`, error);
    }
  }

  return { executed, failed };
}

// =============================================================================
// ARCHITECT CREATION HELPER
// =============================================================================

/**
 * Create an architect configuration
 */
export function createArchitectConfig(options: {
  canProposeSystems?: boolean;
  canProposeComponents?: boolean;
  canProposeEntities?: boolean;
  canProposeRules?: boolean;
  canExecuteDirectly?: boolean;
  approvalRequired?: "auto" | "superior" | "godai";
  maxProposals?: number;
}): ArchitectConfig {
  return {
    canProposeSystems: options.canProposeSystems ?? true,
    canProposeComponents: options.canProposeComponents ?? true,
    canProposeEntities: options.canProposeEntities ?? true,
    canProposeRules: options.canProposeRules ?? false,
    canExecuteDirectly: options.canExecuteDirectly ?? false,
    proposalApproval: options.approvalRequired ?? "godai",
    maxProposalsPerCycle: options.maxProposals ?? 3,
  };
}

// =============================================================================
// NON-BLOCKING / ASYNC EXECUTION
// =============================================================================

/**
 * Queue system baking as a background task (non-blocking)
 * Returns immediately, baking happens in background
 */
export function queueSystemBaking(
  world: World,
  systemRegistry: SystemRegistry,
  spec: SystemProposalSpec,
  onComplete?: (success: boolean, systemName: string) => void
): string {
  // Dynamic import to avoid circular deps
  const taskId = `bake_${spec.name}_${Date.now()}`;

  // We'll need to import the task queue
  import("../runtime/async-task-queue").then(({ queueTask }) => {
    queueTask(
      `Bake: ${spec.name}`,
      async () => {
        const { bakeSystem } = await import("../god/system-baker");

        const bakerDescription = `
System Name: ${spec.name}
Purpose: ${spec.description}
Frequency: ${spec.frequency}ms
Target Components: ${spec.targetComponents.join(", ")}

Logic Description:
${spec.logic}

${spec.triggers?.length ? `Triggers: ${spec.triggers.join(", ")}` : ""}
${spec.effects?.length ? `Effects: ${spec.effects.join(", ")}` : ""}
`.trim();

        const result = await bakeSystem(bakerDescription, world, systemRegistry, 2);

        if (result.success && result.system) {
          result.system.frequency = spec.frequency;
          result.system.active = true;  // Enable the system so runSystems will execute it
          // REGISTER THE BAKED SYSTEM!
          registerSystem(systemRegistry, result.system);
          console.log(`[Architect] ✓ Background bake succeeded and registered: ${spec.name}`);
          return { success: true, system: result.system };
        } else {
          console.log(`[Architect] ✗ Background bake failed: ${spec.name} - ${result.error}`);
          registerPlaceholderSystem(systemRegistry, spec, result.error || "background bake failed");
          return { success: false, error: result.error };
        }
      },
      {
        priority: "normal",
        onComplete: (result) => {
          if (onComplete) {
            onComplete(result.success, spec.name);
          }
        },
        onError: (error) => {
          console.error(`[Architect] Bake task error for ${spec.name}:`, error);
          if (onComplete) {
            onComplete(false, spec.name);
          }
        },
      }
    );
  });

  return taskId;
}

/**
 * Execute all approved proposals as background tasks (non-blocking)
 * Returns immediately, execution happens in background
 */
export function queueAllApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry,
  onProgress?: (completed: number, total: number, name: string) => void
): void {
  const approved = getApprovedProposals();

  if (approved.length === 0) {
    console.log("[Architect] No approved proposals to execute");
    return;
  }

  console.log(`[Architect] Queueing ${approved.length} proposals for background execution`);

  let completed = 0;
  const total = approved.length;

  for (const proposal of approved) {
    if (proposal.type === "system") {
      queueSystemBaking(
        world,
        systemRegistry,
        proposal.specification as SystemProposalSpec,
        (success, name) => {
          completed++;
          markProposalExecuted(proposal.id);
          if (onProgress) {
            onProgress(completed, total, name);
          }
        }
      );
    } else {
      // Non-system proposals can be executed synchronously (they're fast)
      try {
        if (proposal.type === "component") {
          executeComponentProposal(world, proposal.specification as ComponentProposalSpec);
        } else if (proposal.type === "entity") {
          executeEntityProposal(world, proposal.specification as EntityProposalSpec);
        }
        markProposalExecuted(proposal.id);
        completed++;
        if (onProgress) {
          onProgress(completed, total, proposal.name);
        }
      } catch (error) {
        console.error(`[Architect] Failed to execute ${proposal.name}:`, error);
      }
    }
  }
}

// =============================================================================
// SPECIFIC ARCHITECT TYPES
// =============================================================================

/**
 * Pre-defined architect configurations for common use cases
 */
export const ARCHITECT_PRESETS = {
  questArchitect: {
    name: "The Questmaster",
    domain: "narrative" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeEntities: true,
      canProposeRules: true,
      approvalRequired: "superior",
    }),
    customPrompt: `You specialize in creating QUESTS - objectives that give agents purpose.
Consider: quest givers, quest objectives, rewards, story hooks.`,
  },

  weatherArchitect: {
    name: "Zephyros",
    domain: "ecology" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in WEATHER and ENVIRONMENT systems.
Consider: temperature, precipitation, seasons, natural disasters.`,
  },

  economyArchitect: {
    name: "The Merchant Prince",
    domain: "economy" as const,
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeEntities: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in ECONOMY and TRADE systems.
Consider: currency, markets, supply/demand, crafting, professions.`,
  },

  combatArchitect: {
    name: "The Warlord",
    domain: "social" as const,  // Combat is social conflict
    config: createArchitectConfig({
      canProposeSystems: true,
      canProposeComponents: true,
      canProposeRules: true,
      approvalRequired: "godai",
    }),
    customPrompt: `You specialize in COMBAT and CONFLICT systems.
Consider: weapons, armor, damage types, combat maneuvers, victory conditions.`,
  },
};
