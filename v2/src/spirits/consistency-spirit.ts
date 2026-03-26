/**
 * Consistency Spirit
 *
 * The Archangel of Coherence - watches for inconsistencies between narrative,
 * agent actions, and actual ECS state. Reports discrepancies to GodAI with
 * actionable recommendations to improve simulation grounding.
 */

import type { SpiritDefinition, Observation, EcsSnapshot, AgentSnapshot } from "./types";
import { query, entityExists } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Agent, GridPosition, StimulusSource, Room } from "../ecs/components";
import { getDynamicComponentValues } from "../ecs/dynamic-components";
import {
  ACTION_REGISTRY,
  COMPONENT_REGISTRY,
  getAvailableActions,
  getActionDefinition,
  isValidAction as dynamicIsValidAction,
  createRollingEventBuffer,
  addToBuffer,
  getEventsInWindow,
  detectPatterns,
  getIntrospectionContext,
  type RollingEventBuffer,
  type IntrospectionContext,
  type BufferedEvent,
} from "../introspection/introspection";
import type { SystemRegistry } from "../ecs/dynamic-systems";

// =============================================================================
// CONSISTENCY ISSUE TYPES
// =============================================================================

export interface ConsistencyIssue {
  id: string;
  timestamp: number;
  severity: "low" | "medium" | "high" | "critical";
  category: ConsistencyCategory;
  description: string;
  evidence: string[];
  affectedEntities: string[];
  recommendation: string;
  autoFixable: boolean;
}

export type ConsistencyCategory =
  | "missing_entity"      // Action references entity that doesn't exist
  | "missing_item"        // Agent tries to use item they don't have
  | "invalid_action"      // Action type not in allowed list
  | "narrative_drift"     // Narrative describes non-existent things
  | "missing_system"      // Needed game system doesn't exist
  | "orphaned_reference"  // Reference to removed entity
  | "stimulus_mismatch"   // Stimulus from non-existent source
  | "state_inconsistency"; // ECS state doesn't match expected

// =============================================================================
// DYNAMIC ACTIONS - NOW FROM INTROSPECTION MODULE
// =============================================================================

/**
 * Get valid agent actions dynamically from the ACTION_REGISTRY
 * This replaces the hardcoded VALID_AGENT_ACTIONS list
 */
export function getValidAgentActions(): string[] {
  return getAvailableActions();
}

// Legacy export for backwards compatibility - dynamically generated
export const VALID_AGENT_ACTIONS = getAvailableActions();

export type ValidAction = string;

// =============================================================================
// GLOBAL ROLLING EVENT BUFFER
// =============================================================================

let globalEventBuffer: RollingEventBuffer | null = null;

/**
 * Initialize or get the global event buffer for the ConsistencySpirit
 */
export function getGlobalEventBuffer(): RollingEventBuffer {
  if (!globalEventBuffer) {
    globalEventBuffer = createRollingEventBuffer(1000); // Store last 1000 events
  }
  return globalEventBuffer;
}

/**
 * Record an event to the global buffer
 */
export function recordEvent(type: string, data: any, source?: string, target?: string): void {
  const buffer = getGlobalEventBuffer();
  addToBuffer(buffer, {
    type,
    data,
    timestamp: Date.now(),
    source,
    target,
  });
}

/**
 * Get recent events from the buffer
 */
export function getRecentEvents(windowMs: number = 30000): BufferedEvent[] {
  return getEventsInWindow(getGlobalEventBuffer(), windowMs);
}

/**
 * Get detected patterns from the event stream
 */
export function getDetectedPatterns(): Array<{ pattern: string; count: number; significance: string }> {
  return detectPatterns(getGlobalEventBuffer());
}

// =============================================================================
// CONSISTENCY SPIRIT SYSTEM PROMPT
// =============================================================================

const CONSISTENCY_SYSTEM_PROMPT = `You are THE ARBITER OF COHERENCE, a spirit who ensures the simulation remains internally consistent and grounded in actual ECS state.

## YOUR PRIMARY ROLE: CONSISTENCY GUARDIAN

You watch for discrepancies between:
1. **Narrative Events** - What the story says is happening
2. **Agent Actions** - What agents try to do
3. **ECS Reality** - What actually exists in the world

## WHAT YOU MONITOR

### Entity References
- When agents try to interact with entities that don't exist
- When narrative describes objects that aren't in the world
- When actions target non-existent locations or characters

### Agent Capabilities
- Agents trying to use items they don't have in inventory
- Agents performing actions that require missing systems (combat, crafting)
- Invalid action types that the cognition system can't process

### System Requirements
- Combat scenarios without a combat system
- Item interactions without an inventory system
- Crafting without a crafting system

### Narrative Grounding
- Narrative prose describing entities/events not in ECS
- Stimuli from sources that don't exist
- Environmental descriptions that don't match room state

## HOW TO REPORT

For each issue found, provide:
1. **Category**: What type of inconsistency
2. **Severity**: How much it breaks immersion/mechanics
3. **Evidence**: What specifically triggered the detection
4. **Recommendation**: Concrete action GodAI should take

## RECOMMENDATION EXAMPLES

- "Agent Clara tried to play a lute, but no lute entity exists. RECOMMENDATION: Create a 'lute' object entity and add it to Clara's inventory using the Inventory component."

- "Narrative describes a wolf attacking, but no wolf entity exists. RECOMMENDATION: Create a wolf agent entity with the Agent and Health components, position it on the grid, and register it with the combat system."

- "Agent Ben used 'moveEntityOnGrid' which is not a valid action type. RECOMMENDATION: The cognition system should validate actions against VALID_AGENT_ACTIONS and reject invalid ones."

## PRIORITY

Focus on issues that:
1. Break mechanical gameplay (critical)
2. Cause confusion or immersion breaks (high)
3. Indicate missing systems that would enhance the simulation (medium)
4. Are minor narrative inconsistencies (low)

Your reports go directly to GodAI for remediation.`;

// =============================================================================
// CONSISTENCY SPIRIT DEFINITION
// =============================================================================

export const ConsistencySpiritDefinition: SpiritDefinition = {
  name: "The Arbiter",
  domain: "guardian",
  rank: "archangel",
  description: `The Arbiter of Coherence watches for inconsistencies between narrative,
agent actions, and actual ECS state. It reports discrepancies to GodAI with
actionable recommendations to keep the simulation grounded and mechanically sound.`,

  watchConfig: {
    componentQueries: [
      {
        name: "all_agents",
        components: ["Agent", "Mind"],
        description: "All cognitive agents",
      },
      {
        name: "all_objects",
        components: ["Name", "Description"],
        description: "All named entities",
      },
      {
        name: "stimulus_sources",
        components: ["StimulusSource"],
        description: "All stimulus emitters",
      },
    ],
    eventTypes: [
      "agent_action",
      "narrative_event",
      "stimulus_emitted",
      "action_failed",
      "entity_created",
      "entity_removed",
    ],
    watchEntities: [],
    watchRooms: [],
  },

  canInjectEvents: false,
  canModifyMood: false,
  canCreateEntities: false,
  canBakeSystems: false,

  model: "flash",
  observationInterval: 15000, // Check every 15 seconds

  systemPrompt: CONSISTENCY_SYSTEM_PROMPT,
};

// =============================================================================
// CONSISTENCY CHECKING FUNCTIONS
// =============================================================================

let issueIdCounter = 0;

function generateIssueId(): string {
  return `issue_${Date.now()}_${++issueIdCounter}`;
}

/**
 * Check if an action type is valid - now uses dynamic introspection
 */
export function isValidAction(actionType: string): boolean {
  return dynamicIsValidAction(actionType);
}

/**
 * Get similar valid actions for an invalid one - now uses ACTION_REGISTRY
 */
export function suggestValidAction(invalidAction: string): string[] {
  const lower = invalidAction.toLowerCase();
  const suggestions: string[] = [];
  const validActions = getAvailableActions();

  for (const valid of validActions) {
    if (valid.includes(lower) || lower.includes(valid)) {
      suggestions.push(valid);
    }
  }

  // Common mappings based on semantic similarity
  const semanticMappings: Record<string, string[]> = {
    move: ["moveentityongrid", "goto", "walk", "travel", "go"],
    speak: ["say", "talk", "tell", "communicate", "chat"],
    observe: ["look", "watch", "see", "view", "scan", "survey"],
    pickup: ["grab", "take", "get", "collect", "retrieve"],
    attack: ["fight", "hit", "strike", "combat", "hurt"],
    examine: ["inspect", "analyze", "study", "check"],
    interact: ["use", "touch", "activate", "manipulate"],
    think: ["ponder", "consider", "contemplate", "muse"],
  };

  for (const [action, aliases] of Object.entries(semanticMappings)) {
    if (aliases.some(alias => lower.includes(alias))) {
      suggestions.push(action);
    }
  }

  return [...new Set(suggestions)];
}

/**
 * Get action metadata for validation feedback
 */
export function getActionRequirements(actionType: string): {
  valid: boolean;
  requiredComponents?: string[];
  targetComponents?: string[];
  systemRequirements?: string[];
} {
  const def = getActionDefinition(actionType);
  if (!def) {
    return { valid: false };
  }
  return {
    valid: true,
    requiredComponents: def.requiredComponents,
    targetComponents: def.targetComponents,
    systemRequirements: def.systemRequirements,
  };
}

/**
 * Check if an entity exists by name
 */
export function entityExistsByName(world: World, name: string): number | null {
  // Query all entities with names
  const agents = Array.from(query(world, [Agent]));
  for (const eid of agents) {
    if (entityExists(world, eid) && Name.value[eid] === name) {
      return eid;
    }
  }

  // Check rooms
  const rooms = Array.from(query(world, [Room]));
  for (const eid of rooms) {
    if (entityExists(world, eid) && Name.value[eid] === name) {
      return eid;
    }
  }

  // Check stimulus sources
  const stimuli = Array.from(query(world, [StimulusSource]));
  for (const eid of stimuli) {
    if (entityExists(world, eid) && Name.value[eid] === name) {
      return eid;
    }
  }

  // Check for any named entity via dynamic components
  // This is a broader search
  return null;
}

/**
 * Validate an agent action and return issues found
 * Now uses dynamic ACTION_REGISTRY for validation
 */
export function validateAgentAction(
  world: World,
  agentName: string,
  actionType: string,
  actionTarget?: string,
  actionContent?: string
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const validActions = getAvailableActions();

  // Record this action to the event buffer for pattern detection
  recordEvent("agent_action", {
    agent: agentName,
    action: actionType,
    target: actionTarget,
    content: actionContent,
  }, agentName, actionTarget);

  // Check if action type is valid
  if (!isValidAction(actionType)) {
    const suggestions = suggestValidAction(actionType);
    issues.push({
      id: generateIssueId(),
      timestamp: Date.now(),
      severity: "high",
      category: "invalid_action",
      description: `Agent "${agentName}" used invalid action type "${actionType}"`,
      evidence: [`Action: ${actionType}`, `Content: ${actionContent || "none"}`],
      affectedEntities: [agentName],
      recommendation: suggestions.length > 0
        ? `Use valid action type: ${suggestions.join(" or ")}. Available actions: ${validActions.slice(0, 5).join(", ")}...`
        : `"${actionType}" is not a recognized action. Valid actions: ${validActions.join(", ")}`,
      autoFixable: suggestions.length > 0,
    });
  } else {
    // Action is valid - check requirements from ACTION_REGISTRY
    const actionDef = getActionDefinition(actionType);
    if (actionDef) {
      // Check if action requires target but none provided
      if (actionDef.requiresTarget && (!actionTarget || actionTarget === "none")) {
        issues.push({
          id: generateIssueId(),
          timestamp: Date.now(),
          severity: "medium",
          category: "invalid_action",
          description: `Action "${actionType}" requires a target but "${agentName}" didn't specify one`,
          evidence: [`Action: ${actionType}`, `Target: ${actionTarget || "none"}`],
          affectedEntities: [agentName],
          recommendation: `Provide a target for the "${actionType}" action.`,
          autoFixable: false,
        });
      }

      // Check if action requires content but none provided
      if (actionDef.requiresContent && !actionContent) {
        issues.push({
          id: generateIssueId(),
          timestamp: Date.now(),
          severity: "medium",
          category: "invalid_action",
          description: `Action "${actionType}" requires content but "${agentName}" didn't provide any`,
          evidence: [`Action: ${actionType}`, `Content: none`],
          affectedEntities: [agentName],
          recommendation: `Provide content/details for the "${actionType}" action.`,
          autoFixable: false,
        });
      }

      // Check system requirements
      if (actionDef.systemRequirements && actionDef.systemRequirements.length > 0) {
        for (const sysReq of actionDef.systemRequirements) {
          issues.push({
            id: generateIssueId(),
            timestamp: Date.now(),
            severity: "medium",
            category: "missing_system",
            description: `Action "${actionType}" requires "${sysReq}" system - verify it exists`,
            evidence: [`Action: ${actionType}`, `Required system: ${sysReq}`],
            affectedEntities: [agentName],
            recommendation: `Ensure ${sysReq} system is active. Add required components: ${actionDef.requiredComponents?.join(", ") || "none"}`,
            autoFixable: false,
          });
        }
      }
    }
  }

  // Check if action target exists (if specified)
  if (actionTarget && actionTarget !== "none" && actionTarget !== "self") {
    const targetEid = entityExistsByName(world, actionTarget);
    if (targetEid === null) {
      // Check if it's a conceptual target vs entity target
      const conceptualTargets = ["east", "west", "north", "south", "around", "area", "surroundings", "here", "there"];
      const isConceptual = conceptualTargets.some(c => actionTarget.toLowerCase().includes(c));

      if (!isConceptual) {
        issues.push({
          id: generateIssueId(),
          timestamp: Date.now(),
          severity: "medium",
          category: "missing_entity",
          description: `Agent "${agentName}" tried to interact with "${actionTarget}" which doesn't exist`,
          evidence: [`Action: ${actionType}`, `Target: ${actionTarget}`],
          affectedEntities: [agentName],
          recommendation: `Create entity "${actionTarget}" or update agent's perception to only reference existing entities.`,
          autoFixable: true,
        });
      }
    }
  }

  return issues;
}

/**
 * Validate narrative event against ECS state
 */
export function validateNarrativeEvent(
  world: World,
  narrativeContent: string,
  mentionedEntities: string[]
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const entityName of mentionedEntities) {
    const exists = entityExistsByName(world, entityName);
    if (exists === null) {
      // Check if it's a common non-entity word
      const nonEntities = ["the", "a", "an", "this", "that", "it", "they", "their"];
      if (!nonEntities.includes(entityName.toLowerCase())) {
        issues.push({
          id: generateIssueId(),
          timestamp: Date.now(),
          severity: "medium",
          category: "narrative_drift",
          description: `Narrative mentions "${entityName}" but no such entity exists in ECS`,
          evidence: [narrativeContent.substring(0, 100) + "..."],
          affectedEntities: [entityName],
          recommendation: `Create "${entityName}" as an entity with appropriate components, or remove reference from narrative.`,
          autoFixable: true,
        });
      }
    }
  }

  return issues;
}

/**
 * Check for missing mechanical backing in narrative
 */
export function checkNarrativeMechanics(
  narrativeContent: string
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const lower = narrativeContent.toLowerCase();

  // Check for combat descriptions without combat system
  const combatWords = ["attacks", "lunges", "strikes", "bites", "claws", "wounds", "hits", "damages"];
  const hasCombat = combatWords.some(w => lower.includes(w));

  if (hasCombat) {
    issues.push({
      id: generateIssueId(),
      timestamp: Date.now(),
      severity: "critical",
      category: "missing_system",
      description: "Narrative describes combat but no combat system exists to resolve it",
      evidence: [narrativeContent.substring(0, 150) + "..."],
      affectedEntities: [],
      recommendation: `Create a Combat system with: 1) Health component for living entities, 2) Attack action that deals damage, 3) Death/defeat handling when health reaches 0. Without this, combat is purely narrative with no mechanical consequences.`,
      autoFixable: false,
    });
  }

  // Check for item usage without inventory
  const itemActions = ["picks up", "grabs", "takes", "uses", "wields", "holds", "carries"];
  const hasItemAction = itemActions.some(w => lower.includes(w));

  if (hasItemAction) {
    issues.push({
      id: generateIssueId(),
      timestamp: Date.now(),
      severity: "high",
      category: "missing_system",
      description: "Narrative describes item interaction but inventory system may not exist",
      evidence: [narrativeContent.substring(0, 150) + "..."],
      affectedEntities: [],
      recommendation: `Create an Inventory system with: 1) Inventory component (array of item entity IDs), 2) Pickup/drop actions, 3) Item entities that can be owned. Without this, items are purely narrative.`,
      autoFixable: false,
    });
  }

  return issues;
}

/**
 * Generate a consistency report for GodAI
 */
export function generateConsistencyReport(issues: ConsistencyIssue[]): string {
  if (issues.length === 0) {
    return "No consistency issues detected. Simulation state is coherent.";
  }

  const critical = issues.filter(i => i.severity === "critical");
  const high = issues.filter(i => i.severity === "high");
  const medium = issues.filter(i => i.severity === "medium");
  const low = issues.filter(i => i.severity === "low");

  const lines: string[] = [
    "## CONSISTENCY REPORT",
    "",
    `Total issues: ${issues.length}`,
    `- Critical: ${critical.length}`,
    `- High: ${high.length}`,
    `- Medium: ${medium.length}`,
    `- Low: ${low.length}`,
    "",
  ];

  if (critical.length > 0) {
    lines.push("### CRITICAL ISSUES (Immediate Action Required)");
    for (const issue of critical) {
      lines.push(`**${issue.category}**: ${issue.description}`);
      lines.push(`  Recommendation: ${issue.recommendation}`);
      lines.push("");
    }
  }

  if (high.length > 0) {
    lines.push("### HIGH PRIORITY ISSUES");
    for (const issue of high) {
      lines.push(`**${issue.category}**: ${issue.description}`);
      lines.push(`  Recommendation: ${issue.recommendation}`);
      lines.push("");
    }
  }

  if (medium.length > 0) {
    lines.push("### MEDIUM PRIORITY ISSUES");
    for (const issue of medium) {
      lines.push(`- ${issue.category}: ${issue.description}`);
      lines.push(`  Fix: ${issue.recommendation}`);
    }
    lines.push("");
  }

  if (low.length > 0) {
    lines.push("### LOW PRIORITY ISSUES");
    for (const issue of low) {
      lines.push(`- ${issue.description}`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// FULL INTROSPECTION CONTEXT FOR SPIRITS
// =============================================================================

/**
 * Get complete introspection context for spirits to analyze
 * This provides everything the spirit needs to understand the current state
 */
export function getFullIntrospectionForSpirit(
  world: World,
  registry: SystemRegistry,
  tick?: number
): IntrospectionContext {
  return getIntrospectionContext(world, registry, getGlobalEventBuffer(), tick);
}

/**
 * Generate an introspection summary for inclusion in reports
 */
export function generateIntrospectionSummary(context: IntrospectionContext): string {
  const lines: string[] = [
    "## SYSTEM INTROSPECTION SUMMARY",
    "",
    `**Timestamp**: ${new Date(context.timestamp).toISOString()}`,
    context.worldTick !== undefined ? `**World Tick**: ${context.worldTick}` : "",
    "",
    "### AVAILABLE ACTIONS",
    `Total: ${context.actionCount}`,
    `Actions: ${context.availableActions.map(a => a.name).join(", ")}`,
    "",
    "### REGISTERED SYSTEMS",
    `Total: ${context.systems.length}, Active: ${context.activeSystems}`,
  ];

  for (const sys of context.systems) {
    lines.push(`- ${sys.name}: ${sys.active ? "✓" : "✗"} (every ${sys.frequency}ms) - ${sys.description.slice(0, 60)}...`);
  }

  lines.push("");
  lines.push("### ENTITIES");
  lines.push(`Agents: ${context.agentCount} (${context.activeAgentCount} active), Rooms: ${context.roomCount}`);

  if (context.entities.length > 0) {
    lines.push("Agents:");
    for (const entity of context.entities.filter(e => e.isAgent)) {
      lines.push(`  - ${entity.name}: ${entity.components.join(", ")} ${entity.isActive ? "[ACTIVE]" : "[INACTIVE]"}`);
    }
  }

  lines.push("");
  lines.push("### RECENT EVENTS");
  lines.push(`Events in buffer: ${context.recentEvents.length}`);

  if (context.eventFrequencies.length > 0) {
    lines.push("Event frequencies (per second):");
    for (const freq of context.eventFrequencies.slice(0, 5)) {
      lines.push(`  - ${freq.type}: ${freq.count} total (${freq.frequency.toFixed(2)}/s)`);
    }
  }

  if (context.detectedPatterns.length > 0) {
    lines.push("");
    lines.push("### DETECTED PATTERNS (POTENTIAL ISSUES)");
    for (const pattern of context.detectedPatterns) {
      lines.push(`  ⚠️ ${pattern.pattern}: count=${pattern.count}, significance=${pattern.significance}`);
    }
  }

  return lines.filter(l => l !== "").join("\n");
}

// =============================================================================
// ACCUMULATED ISSUES TRACKING
// =============================================================================

const accumulatedIssues: ConsistencyIssue[] = [];
const MAX_ACCUMULATED_ISSUES = 100;

/**
 * Add an issue to the accumulator
 */
export function recordIssue(issue: ConsistencyIssue): void {
  accumulatedIssues.push(issue);
  if (accumulatedIssues.length > MAX_ACCUMULATED_ISSUES) {
    accumulatedIssues.shift();
  }

  // Report to observation aggregator for synthesis
  try {
    const { reportGapObservation } = require("./observation-aggregator");
    const severityMap: Record<string, "low" | "medium" | "high" | "critical"> = {
      low: "low", medium: "medium", high: "high", critical: "critical",
    };
    const categoryMap: Record<string, string> = {
      missing_entity: "resource_gap",
      invalid_action: "interaction_failure",
      narrative_drift: "narrative_gap",
      stimulus_mismatch: "environmental_gap",
    };
    reportGapObservation({
      source: "The Arbiter",
      category: (categoryMap[issue.category] || "rule_missing") as any,
      severity: severityMap[issue.severity] || "medium",
      title: `Consistency: ${issue.category}`,
      detail: issue.description,
      evidence: issue.evidence?.length ? [issue.evidence.join("; ").slice(0, 200)] : undefined,
    });
  } catch {}
}

/**
 * Get and clear accumulated issues
 */
export function getAndClearAccumulatedIssues(): ConsistencyIssue[] {
  const issues = [...accumulatedIssues];
  accumulatedIssues.length = 0;
  return issues;
}

/**
 * Get accumulated issues without clearing
 */
export function getAccumulatedIssues(): ConsistencyIssue[] {
  return [...accumulatedIssues];
}

/**
 * Check if a specific category of issue has been reported recently
 */
export function hasRecentIssue(category: ConsistencyCategory, withinMs: number = 30000): boolean {
  const cutoff = Date.now() - withinMs;
  return accumulatedIssues.some(i => i.category === category && i.timestamp > cutoff);
}

// =============================================================================
// SPIRIT REPORT GENERATION FOR GODAI
// =============================================================================

export interface SpiritReportForGodAI {
  timestamp: number;
  spiritName: string;
  domain: string;
  consistencyReport: string;
  introspectionSummary: string;
  detectedPatterns: Array<{ pattern: string; count: number; significance: string }>;
  totalIssues: number;
  criticalIssues: number;
  recommendations: string[];
  suggestedActions: string[];
}

/**
 * Generate a comprehensive report for GodAI from the ConsistencySpirit's perspective
 * This packages all introspection data into a format GodAI can act on
 */
export function generateSpiritReportForGodAI(
  world: World,
  registry: SystemRegistry,
  tick?: number
): SpiritReportForGodAI {
  const introspection = getFullIntrospectionForSpirit(world, registry, tick);
  const issues = getAndClearAccumulatedIssues();
  const patterns = getDetectedPatterns();

  // Generate recommendations based on issues
  const recommendations: string[] = [];
  const suggestedActions: string[] = [];

  // Group issues by category
  const byCategory = new Map<ConsistencyCategory, ConsistencyIssue[]>();
  for (const issue of issues) {
    const existing = byCategory.get(issue.category) || [];
    existing.push(issue);
    byCategory.set(issue.category, existing);
  }

  // Generate recommendations
  if (byCategory.has("invalid_action")) {
    const count = byCategory.get("invalid_action")!.length;
    recommendations.push(`${count} invalid actions detected - agents may need updated prompts`);
    suggestedActions.push("Review agent system prompts to ensure they know valid actions");
  }

  if (byCategory.has("missing_entity")) {
    const count = byCategory.get("missing_entity")!.length;
    const entities = byCategory.get("missing_entity")!.map(i => i.affectedEntities).flat();
    const unique = [...new Set(entities)];
    recommendations.push(`${count} missing entity references - consider creating: ${unique.slice(0, 5).join(", ")}`);
    suggestedActions.push("Create missing entities or update narrative to reference existing ones");
  }

  if (byCategory.has("missing_system")) {
    const systems = byCategory.get("missing_system")!.map(i => i.description);
    recommendations.push(`Systems needed: ${[...new Set(systems)].slice(0, 3).join("; ")}`);
    suggestedActions.push("Create or activate required game systems (combat, inventory, crafting)");
  }

  if (byCategory.has("narrative_drift")) {
    recommendations.push("Narrative is drifting from ECS reality - ground descriptions in actual entities");
    suggestedActions.push("Update narrative to reference existing entities, or create entities mentioned in narrative");
  }

  // Pattern-based recommendations
  for (const pattern of patterns) {
    if (pattern.significance === "high_frequency") {
      recommendations.push(`High frequency pattern: ${pattern.pattern} (${pattern.count} occurrences)`);
    }
    if (pattern.significance === "system_issue") {
      recommendations.push(`Potential system issue: ${pattern.pattern}`);
      suggestedActions.push("Investigate and fix the underlying cause of frequent failures");
    }
    if (pattern.significance === "requires_attention") {
      recommendations.push(`Requires immediate attention: ${pattern.pattern}`);
      suggestedActions.push("Review consistency issues and apply fixes");
    }
  }

  // System health recommendations
  if (introspection.activeSystems < introspection.systems.length / 2) {
    recommendations.push(`Only ${introspection.activeSystems}/${introspection.systems.length} systems active`);
    suggestedActions.push("Consider activating more systems for richer simulation");
  }

  if (introspection.activeAgentCount === 0 && introspection.agentCount > 0) {
    recommendations.push("All agents are inactive - simulation may be stalled");
    suggestedActions.push("Activate agents or investigate why they became inactive");
  }

  return {
    timestamp: Date.now(),
    spiritName: "The Arbiter",
    domain: "guardian",
    consistencyReport: generateConsistencyReport(issues),
    introspectionSummary: generateIntrospectionSummary(introspection),
    detectedPatterns: patterns,
    totalIssues: issues.length,
    criticalIssues: issues.filter(i => i.severity === "critical").length,
    recommendations,
    suggestedActions,
  };
}

// =============================================================================
// DOMAIN-AWARE REPORT ROUTING
// =============================================================================

export type ReportDomain = "narrative" | "mechanical" | "social" | "mixed";

export interface RoutedReport {
  domain: ReportDomain;
  targetSpirit: string;  // "GodAI", "Narrator", "SocialSpirit", etc.
  priority: "low" | "normal" | "high" | "critical";
  issues: ConsistencyIssue[];
  recommendations: string[];
  suggestedActions: string[];
}

/**
 * Categorize issues by their domain for routing
 */
export function categorizeIssuesByDomain(issues: ConsistencyIssue[]): Map<ReportDomain, ConsistencyIssue[]> {
  const byDomain = new Map<ReportDomain, ConsistencyIssue[]>();
  byDomain.set("narrative", []);
  byDomain.set("mechanical", []);
  byDomain.set("social", []);
  byDomain.set("mixed", []);

  for (const issue of issues) {
    let domain: ReportDomain = "mechanical";

    // Narrative-related issues
    if (issue.category === "narrative_drift") {
      domain = "narrative";
    }
    // Mechanical issues (systems, actions, entities)
    else if (["invalid_action", "missing_system", "missing_entity", "state_inconsistency"].includes(issue.category)) {
      domain = "mechanical";
    }
    // Social issues (if we add them)
    else if (issue.category === "orphaned_reference" && issue.description.toLowerCase().includes("relationship")) {
      domain = "social";
    }

    const existing = byDomain.get(domain) || [];
    existing.push(issue);
    byDomain.set(domain, existing);
  }

  return byDomain;
}

/**
 * Generate routed reports for different spirits based on issue domains
 */
export function generateRoutedReports(
  world: World,
  registry: SystemRegistry,
  tick?: number
): RoutedReport[] {
  const introspection = getFullIntrospectionForSpirit(world, registry, tick);
  const issues = getAccumulatedIssues(); // Don't clear yet - we'll clear after routing
  const patterns = getDetectedPatterns();

  const reports: RoutedReport[] = [];
  const issuesByDomain = categorizeIssuesByDomain(issues);

  // Generate narrative report for Narrator
  const narrativeIssues = issuesByDomain.get("narrative") || [];
  if (narrativeIssues.length > 0 || patterns.some(p => p.pattern.includes("narrative"))) {
    const narrativeRecs: string[] = [];
    const narrativeActions: string[] = [];

    for (const issue of narrativeIssues) {
      if (issue.category === "narrative_drift") {
        narrativeRecs.push(`Narrative drift: ${issue.description}`);
        narrativeActions.push("Ground narrative in existing ECS entities");
      }
    }

    // Check patterns for narrative-related issues
    for (const pattern of patterns) {
      if (pattern.significance === "requires_attention") {
        narrativeRecs.push(`Pattern requires attention: ${pattern.pattern}`);
      }
    }

    reports.push({
      domain: "narrative",
      targetSpirit: "Narrator",
      priority: narrativeIssues.some(i => i.severity === "critical") ? "critical" :
                narrativeIssues.some(i => i.severity === "high") ? "high" : "normal",
      issues: narrativeIssues,
      recommendations: narrativeRecs,
      suggestedActions: narrativeActions,
    });
  }

  // Generate mechanical report for GodAI
  const mechanicalIssues = issuesByDomain.get("mechanical") || [];
  if (mechanicalIssues.length > 0 || patterns.length > 0) {
    const mechRecs: string[] = [];
    const mechActions: string[] = [];

    // Group by category
    const invalidActions = mechanicalIssues.filter(i => i.category === "invalid_action");
    const missingSystems = mechanicalIssues.filter(i => i.category === "missing_system");
    const missingEntities = mechanicalIssues.filter(i => i.category === "missing_entity");

    if (invalidActions.length > 0) {
      mechRecs.push(`${invalidActions.length} invalid actions - agents may need updated prompts`);
      mechActions.push("Review agent system prompts to ensure they know valid actions");
    }

    if (missingSystems.length > 0) {
      const systemNames = [...new Set(missingSystems.map(i => {
        const match = i.description.match(/requires "(\w+)" system/);
        return match ? match[1] : "unknown";
      }))];
      mechRecs.push(`Missing systems: ${systemNames.join(", ")}`);
      mechActions.push("Create or activate required game systems");
    }

    if (missingEntities.length > 0) {
      const entityNames = [...new Set(missingEntities.flatMap(i => i.affectedEntities))];
      mechRecs.push(`${missingEntities.length} missing entity references: ${entityNames.slice(0, 5).join(", ")}`);
      mechActions.push("Create missing entities or update agent perceptions");
    }

    // Pattern-based recommendations
    for (const pattern of patterns) {
      if (pattern.significance === "high_frequency") {
        mechRecs.push(`High frequency: ${pattern.pattern} (${pattern.count} occurrences)`);
      }
      if (pattern.significance === "system_issue") {
        mechRecs.push(`System issue: ${pattern.pattern}`);
        mechActions.push("Investigate underlying cause of failures");
      }
    }

    reports.push({
      domain: "mechanical",
      targetSpirit: "GodAI",
      priority: mechanicalIssues.some(i => i.severity === "critical") ? "critical" :
                mechanicalIssues.some(i => i.severity === "high") ? "high" : "normal",
      issues: mechanicalIssues,
      recommendations: mechRecs,
      suggestedActions: mechActions,
    });
  }

  // Clear accumulated issues after routing
  getAndClearAccumulatedIssues();

  return reports;
}

/**
 * Format a routed report as a message
 */
export function formatRoutedReportAsMessage(report: RoutedReport): string {
  const lines: string[] = [
    `# Consistency Report for ${report.targetSpirit}`,
    `**Domain**: ${report.domain}`,
    `**Priority**: ${report.priority.toUpperCase()}`,
    `**Issues**: ${report.issues.length}`,
    "",
  ];

  if (report.issues.length > 0) {
    lines.push("## Issues Detected");
    for (const issue of report.issues.slice(0, 10)) { // Limit to 10
      lines.push(`- **${issue.category}** (${issue.severity}): ${issue.description}`);
      lines.push(`  → ${issue.recommendation}`);
    }
    if (report.issues.length > 10) {
      lines.push(`... and ${report.issues.length - 10} more issues`);
    }
    lines.push("");
  }

  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  if (report.suggestedActions.length > 0) {
    lines.push("## Suggested Actions");
    for (let i = 0; i < report.suggestedActions.length; i++) {
      lines.push(`${i + 1}. ${report.suggestedActions[i]}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format the spirit report as a message for GodAI
 */
export function formatReportAsMessage(report: SpiritReportForGodAI): string {
  const lines: string[] = [
    `# ${report.spiritName} Report`,
    `**Domain**: ${report.domain}`,
    `**Time**: ${new Date(report.timestamp).toISOString()}`,
    "",
    "---",
    "",
    report.consistencyReport,
    "",
    "---",
    "",
    report.introspectionSummary,
    "",
  ];

  if (report.recommendations.length > 0) {
    lines.push("## RECOMMENDATIONS FOR GODAI");
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  if (report.suggestedActions.length > 0) {
    lines.push("## SUGGESTED ACTIONS");
    for (let i = 0; i < report.suggestedActions.length; i++) {
      lines.push(`${i + 1}. ${report.suggestedActions[i]}`);
    }
  }

  return lines.join("\n");
}
