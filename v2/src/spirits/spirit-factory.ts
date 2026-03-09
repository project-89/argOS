/**
 * Spirit Factory - Dynamic Spirit Creation System
 *
 * Enables GodAI (and high-ranking spirits) to spawn new spirits at runtime.
 * This creates a self-growing hierarchical ecosystem where:
 * - GodAI creates Archangels to manage domains
 * - Archangels create Angels to manage specific areas
 * - Angels create Daemons for task-specific observation
 *
 * Spirit Types:
 * - Watcher: Observes systems/entities and reports
 * - Manager: Coordinates multiple subordinate spirits
 * - Architect: Can propose and create new systems/components
 * - Coordinator: Meta-spirit managing groups of spirits
 */

import { addEntity, addComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description } from "../ecs/components";
import type { SpiritRegistry, SpiritState } from "./spirit-registry";
import {
  createSpirit,
  setGodAgent,
  addSubordinate,
  type SpiritDefinition,
  type SpiritDomain,
  type SpiritRank,
} from "./spirit-registry";

// =============================================================================
// SPIRIT FACTORY TYPES
// =============================================================================

export type SpiritType = "watcher" | "manager" | "architect" | "coordinator" | "artificer";

/**
 * Configuration for creating a new spirit
 */
export interface CreateSpiritConfig {
  name: string;
  title?: string;
  description?: string;
  type: SpiritType;
  domain: SpiritDomain;
  rank: SpiritRank;
  superiorEid?: number;  // Entity ID of superior spirit (required for non-archangels)

  // For watchers - what to observe
  watchConfig?: WatchConfig;

  // For architects - what they can create
  architectConfig?: ArchitectConfig;

  // For coordinators - who they manage
  coordinatorConfig?: CoordinatorConfig;

  // For artificers - system maintenance
  artificerConfig?: ArtificerConfig;

  // Custom system prompt additions
  customPrompt?: string;

  // Observation interval (ms)
  observationInterval?: number;
}

export interface WatchConfig {
  targetSystems?: string[];       // System names to watch
  targetComponents?: string[];    // Component types to monitor
  targetEntities?: number[];      // Specific entity IDs
  watchPatterns?: string[];       // Patterns to look for (e.g., "stagnation", "conflict")
  alertThresholds?: Record<string, number>;  // When to alert (e.g., { tension: 0.8 })
}

export interface ArchitectConfig {
  canProposeSystems: boolean;     // Can suggest new systems
  canProposeComponents: boolean;  // Can suggest new components
  canProposeEntities: boolean;    // Can suggest new entities
  canProposeRules: boolean;       // Can suggest new rules
  canExecuteDirectly: boolean;    // Can execute without approval (dangerous!)
  proposalApproval: "auto" | "superior" | "godai";  // Who approves proposals
  maxProposalsPerCycle: number;   // Rate limiting
}

export interface CoordinatorConfig {
  subordinateEids: number[];      // Spirit entity IDs to coordinate
  canCreateSubordinates: boolean; // Can spawn new spirits
  canReassignSubordinates: boolean;
  maxSubordinates: number;
}

export interface ArtificerConfig {
  /** How often to run inspection cycles (ms) */
  inspectionInterval: number;
  /** Max errors before auto-disabling a system */
  maxErrorsBeforeDisable: number;
  /** Whether to auto-fix simple issues */
  autoFixEnabled: boolean;
  /** Systems to ignore (won't touch these) */
  ignoreSystems: string[];
}

/**
 * A proposal from an Architect spirit
 */
export interface SpiritProposal {
  id: string;
  timestamp: number;
  fromSpiritEid: number;
  fromSpiritName: string;
  type: "system" | "component" | "entity" | "rule";
  name: string;
  description: string;
  specification: any;  // Type-specific details
  rationale: string;   // Why this is needed
  status: "pending" | "approved" | "rejected" | "executed";
  approvedBy?: number;
  rejectionReason?: string;
}

/**
 * Extended spirit state for factory-created spirits
 */
export interface DynamicSpiritState extends SpiritState {
  spiritType: SpiritType;
  watchConfig?: WatchConfig;
  architectConfig?: ArchitectConfig;
  coordinatorConfig?: CoordinatorConfig;
  artificerConfig?: ArtificerConfig;
  proposals?: SpiritProposal[];
  executionHistory?: SpiritExecution[];
}

export interface SpiritExecution {
  timestamp: number;
  type: string;
  target: string;
  result: "success" | "failure";
  details?: string;
}

// =============================================================================
// SPIRIT FACTORY REGISTRY
// =============================================================================

export interface SpiritFactoryState {
  createdSpirits: Map<number, DynamicSpiritState>;
  pendingProposals: SpiritProposal[];
  proposalIdCounter: number;
  executionLog: SpiritExecution[];
}

let factoryState: SpiritFactoryState = {
  createdSpirits: new Map(),
  pendingProposals: [],
  proposalIdCounter: 0,
  executionLog: [],
};

export function getFactoryState(): SpiritFactoryState {
  return factoryState;
}

export function resetFactoryState(): void {
  factoryState = {
    createdSpirits: new Map(),
    pendingProposals: [],
    proposalIdCounter: 0,
    executionLog: [],
  };
}

// =============================================================================
// SPIRIT CREATION
// =============================================================================

/**
 * Create a new spirit dynamically
 */
export function createDynamicSpirit(
  registry: SpiritRegistry,
  config: CreateSpiritConfig
): DynamicSpiritState | null {
  // Validate rank hierarchy
  if (config.rank !== "archangel" && !config.superiorEid) {
    console.error(`[SpiritFactory] Non-archangel spirits require a superior`);
    return null;
  }

  // Generate system prompt based on type
  const systemPrompt = generateSpiritSystemPrompt(config);

  // Create spirit definition
  const definition: SpiritDefinition = {
    name: config.name,
    title: config.title || `The ${config.name}`,
    domain: config.domain,
    rank: config.rank,
    systemPrompt,
    observationInterval: config.observationInterval || 30000,
    canIntervene: config.type === "architect" || config.type === "manager",
    interventionTypes: getInterventionTypes(config.type),
    model: "flash", // Default to flash model for dynamic spirits
  };

  // Create the spirit via registry
  const spiritState = createSpirit(registry, definition);
  if (!spiritState) {
    console.error(`[SpiritFactory] Failed to create spirit: ${config.name}`);
    return null;
  }

  // Add to superior's subordinates if applicable
  if (config.superiorEid) {
    addSubordinate(registry, config.superiorEid, spiritState.eid);
  }

  // Create extended state
  const dynamicState: DynamicSpiritState = {
    ...spiritState,
    spiritType: config.type,
    watchConfig: config.watchConfig,
    architectConfig: config.architectConfig,
    coordinatorConfig: config.coordinatorConfig,
    artificerConfig: config.artificerConfig,
    proposals: [],
    executionHistory: [],
  };

  // Store in factory registry
  factoryState.createdSpirits.set(spiritState.eid, dynamicState);

  console.log(`[SpiritFactory] Created ${config.rank} "${config.name}" (${config.type}) in domain ${config.domain}`);

  return dynamicState;
}

/**
 * Generate system prompt based on spirit type
 */
function generateSpiritSystemPrompt(config: CreateSpiritConfig): string {
  const basePrompt = `You are ${config.title || config.name}, a ${config.rank} spirit of the ${config.domain} domain.`;

  let typePrompt = "";

  switch (config.type) {
    case "watcher":
      typePrompt = generateWatcherPrompt(config);
      break;
    case "manager":
      typePrompt = generateManagerPrompt(config);
      break;
    case "architect":
      typePrompt = generateArchitectPrompt(config);
      break;
    case "coordinator":
      typePrompt = generateCoordinatorPrompt(config);
      break;
    case "artificer":
      typePrompt = generateArtificerPrompt(config);
      break;
  }

  const customPrompt = config.customPrompt ? `\n\n${config.customPrompt}` : "";

  return `${basePrompt}\n\n${typePrompt}${customPrompt}`;
}

function generateWatcherPrompt(config: CreateSpiritConfig): string {
  const watch = config.watchConfig;
  let prompt = `Your role is to OBSERVE and REPORT. You are a vigilant watcher.`;

  if (watch?.targetSystems?.length) {
    prompt += `\n\nYou watch these systems: ${watch.targetSystems.join(", ")}`;
  }
  if (watch?.targetComponents?.length) {
    prompt += `\n\nYou monitor these component types: ${watch.targetComponents.join(", ")}`;
  }
  if (watch?.watchPatterns?.length) {
    prompt += `\n\nYou look for these patterns: ${watch.watchPatterns.join(", ")}`;
  }

  prompt += `\n\nWhen you observe something significant:
1. Analyze what you see through your domain lens
2. Determine the severity (low/medium/high/urgent)
3. Report to your superior with clear recommendations
4. Do NOT take direct action unless explicitly authorized`;

  return prompt;
}

function generateManagerPrompt(config: CreateSpiritConfig): string {
  return `Your role is to MANAGE and COORDINATE. You oversee your domain and guide its development.

Responsibilities:
1. Receive reports from subordinate spirits and daemons
2. Synthesize information into actionable insights
3. Make decisions about interventions within your domain
4. Escalate major issues to your superior
5. Guide subordinates with directives

You can:
- Inject stimuli into the world (environmental events, intuitions)
- Modify agent moods within your domain
- Send directives to subordinate spirits
- Report to your superior`;
}

function generateArchitectPrompt(config: CreateSpiritConfig): string {
  const arch = config.architectConfig;
  let prompt = `Your role is to DESIGN and PROPOSE. You are a creative architect of reality.

You can propose:`;

  if (arch?.canProposeSystems) prompt += `\n- New SYSTEMS (behavior patterns for the world)`;
  if (arch?.canProposeComponents) prompt += `\n- New COMPONENTS (data types for entities)`;
  if (arch?.canProposeEntities) prompt += `\n- New ENTITIES (objects, NPCs, places)`;
  if (arch?.canProposeRules) prompt += `\n- New RULES (automatic consequences)`;

  prompt += `\n\nWhen proposing:
1. Identify a need or opportunity in the simulation
2. Design a solution that fits the existing architecture
3. Provide clear specification with rationale
4. Submit for approval (proposals go to: ${arch?.proposalApproval || "godai"})
5. ${arch?.canExecuteDirectly ? "You MAY execute directly if urgent" : "Wait for approval before execution"}

Be creative but practical. Your proposals should enhance the simulation without breaking it.`;

  return prompt;
}

function generateCoordinatorPrompt(config: CreateSpiritConfig): string {
  const coord = config.coordinatorConfig;
  let prompt = `Your role is to COORDINATE multiple spirits. You are a meta-manager.

Your subordinates: ${coord?.subordinateEids?.length || 0} spirits

Responsibilities:
1. Receive reports from all subordinate spirits
2. Detect conflicts or overlaps between their domains
3. Assign tasks and redistribute workload
4. ${coord?.canCreateSubordinates ? "Create new subordinate spirits when needed" : "Request new spirits from your superior"}
5. Ensure coverage across your meta-domain

You synthesize the perspectives of multiple specialists into unified guidance.`;

  return prompt;
}

function generateArtificerPrompt(config: CreateSpiritConfig): string {
  const art = config.artificerConfig;
  let prompt = `Your role is to MAINTAIN and REPAIR. You are the master mechanic of reality's machinery.

You patrol the simulation's systems, inspecting their health and fixing problems before they cascade.

Responsibilities:
1. Regularly inspect all active systems for errors, performance issues, or stagnation
2. Read and analyze system code to understand their logic
3. Diagnose why systems might be failing or producing unexpected results
4. Apply fixes to broken systems (with appropriate caution)
5. Report chronic issues to your superior for deeper architectural review
6. Track error patterns to identify systemic problems

Inspection Cycle: Every ${art?.inspectionInterval || 60000}ms
Auto-disable threshold: ${art?.maxErrorsBeforeDisable || 5} consecutive errors
Auto-fix enabled: ${art?.autoFixEnabled ?? true}`;

  if (art?.ignoreSystems?.length) {
    prompt += `\n\nSystems to leave alone (maintained by others): ${art.ignoreSystems.join(", ")}`;
  }

  prompt += `

When you find a problem:
1. DIAGNOSE: Understand what's wrong by reading logs, code, and execution history
2. ASSESS: Determine severity (minor glitch vs critical failure)
3. DECIDE: Can you fix it yourself, or does it need architectural changes?
4. ACT: Apply the fix if within your authority, or escalate if not
5. VERIFY: Check that the fix worked and didn't break other things

You are not here to create new things - leave that to the Architects.
You are here to keep existing things running smoothly.`;

  return prompt;
}

function getInterventionTypes(type: SpiritType): string[] {
  switch (type) {
    case "watcher":
      return [];  // Watchers don't intervene directly
    case "manager":
      return ["inject_stimulus", "modify_mood", "send_directive"];
    case "architect":
      return ["propose_system", "propose_component", "propose_entity", "propose_rule"];
    case "coordinator":
      return ["send_directive", "reassign_subordinate", "create_subordinate"];
    case "artificer":
      return ["inspect_system", "repair_system", "disable_system", "enable_system", "read_system_code", "report_issue"];
    default:
      return [];
  }
}

// =============================================================================
// PROPOSAL SYSTEM
// =============================================================================

/**
 * Submit a proposal from an architect spirit
 */
export function submitProposal(
  spiritEid: number,
  type: SpiritProposal["type"],
  name: string,
  description: string,
  specification: any,
  rationale: string
): SpiritProposal | null {
  const dynamicState = factoryState.createdSpirits.get(spiritEid);
  if (!dynamicState || dynamicState.spiritType !== "architect") {
    console.error(`[SpiritFactory] Only architect spirits can submit proposals`);
    return null;
  }

  const proposal: SpiritProposal = {
    id: `proposal_${++factoryState.proposalIdCounter}`,
    timestamp: Date.now(),
    fromSpiritEid: spiritEid,
    fromSpiritName: dynamicState.definition.name,
    type,
    name,
    description,
    specification,
    rationale,
    status: "pending",
  };

  // Check if auto-approve
  if (dynamicState.architectConfig?.proposalApproval === "auto") {
    proposal.status = "approved";
    proposal.approvedBy = spiritEid;
  }

  factoryState.pendingProposals.push(proposal);
  dynamicState.proposals?.push(proposal);

  console.log(`[SpiritFactory] Proposal submitted: ${proposal.id} - ${type} "${name}"`);

  return proposal;
}

/**
 * Get pending proposals for approval
 */
export function getPendingProposals(): SpiritProposal[] {
  return factoryState.pendingProposals.filter(p => p.status === "pending");
}

/**
 * Approve a proposal
 */
export function approveProposal(proposalId: string, approverEid: number): boolean {
  const proposal = factoryState.pendingProposals.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") {
    return false;
  }

  proposal.status = "approved";
  proposal.approvedBy = approverEid;

  console.log(`[SpiritFactory] Proposal approved: ${proposalId}`);

  return true;
}

/**
 * Reject a proposal
 */
export function rejectProposal(proposalId: string, reason: string): boolean {
  const proposal = factoryState.pendingProposals.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "pending") {
    return false;
  }

  proposal.status = "rejected";
  proposal.rejectionReason = reason;

  console.log(`[SpiritFactory] Proposal rejected: ${proposalId} - ${reason}`);

  return true;
}

/**
 * Get approved proposals ready for execution
 */
export function getApprovedProposals(): SpiritProposal[] {
  return factoryState.pendingProposals.filter(p => p.status === "approved");
}

/**
 * Mark proposal as executed
 */
export function markProposalExecuted(proposalId: string): boolean {
  const proposal = factoryState.pendingProposals.find(p => p.id === proposalId);
  if (!proposal || proposal.status !== "approved") {
    return false;
  }

  proposal.status = "executed";

  console.log(`[SpiritFactory] Proposal executed: ${proposalId}`);

  return true;
}

// =============================================================================
// SPIRIT EXECUTION TRACKING
// =============================================================================

/**
 * Log an execution by a spirit
 */
export function logSpiritExecution(
  spiritEid: number,
  type: string,
  target: string,
  result: "success" | "failure",
  details?: string
): void {
  const execution: SpiritExecution = {
    timestamp: Date.now(),
    type,
    target,
    result,
    details,
  };

  factoryState.executionLog.push(execution);

  const dynamicState = factoryState.createdSpirits.get(spiritEid);
  if (dynamicState) {
    dynamicState.executionHistory?.push(execution);
  }
}

// =============================================================================
// SPIRIT QUERIES
// =============================================================================

/**
 * Get all spirits of a specific type
 */
export function getSpiritsByType(type: SpiritType): DynamicSpiritState[] {
  return Array.from(factoryState.createdSpirits.values())
    .filter(s => s.spiritType === type);
}

/**
 * Get all spirits in a domain
 */
export function getSpiritsByDomain(domain: SpiritDomain): DynamicSpiritState[] {
  return Array.from(factoryState.createdSpirits.values())
    .filter(s => s.definition.domain === domain);
}

/**
 * Get a dynamic spirit by entity ID
 */
export function getDynamicSpirit(eid: number): DynamicSpiritState | undefined {
  return factoryState.createdSpirits.get(eid);
}

/**
 * Get factory summary
 */
export function getFactorySummary(): string {
  const byType = new Map<SpiritType, number>();
  const byDomain = new Map<SpiritDomain, number>();

  for (const spirit of factoryState.createdSpirits.values()) {
    byType.set(spirit.spiritType, (byType.get(spirit.spiritType) || 0) + 1);
    byDomain.set(spirit.definition.domain, (byDomain.get(spirit.definition.domain) || 0) + 1);
  }

  const lines: string[] = [
    "=== Spirit Factory Summary ===",
    `Total created spirits: ${factoryState.createdSpirits.size}`,
    "",
    "By Type:",
  ];

  for (const [type, count] of byType) {
    lines.push(`  ${type}: ${count}`);
  }

  lines.push("", "By Domain:");
  for (const [domain, count] of byDomain) {
    lines.push(`  ${domain}: ${count}`);
  }

  lines.push("", `Pending proposals: ${getPendingProposals().length}`);
  lines.push(`Total executions: ${factoryState.executionLog.length}`);

  return lines.join("\n");
}
