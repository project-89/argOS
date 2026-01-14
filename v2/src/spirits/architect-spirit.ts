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
import { Name, Description } from "../ecs/components";
import { spiritModel, plannerModel } from "../llm/config";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import { registerSystem, createSystemFromSpec } from "../ecs/dynamic-systems";
import { createDynamicComponent, setDynamicComponentValue } from "../ecs/dynamic-components";
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

// =============================================================================
// ARCHITECT COGNITION
// =============================================================================

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

  // 2. ANALYZE: Identify needs and opportunities
  const needs = await identifyNeeds(architect, context);

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
    agentStates: agents.map(a => ({
      name: a.name,
      arousal: a.arousal ?? 0.5,
      goalCount: a.goals?.length ?? 0,
    })),
  };
}

interface IdentifiedNeed {
  type: "system" | "component" | "entity" | "rule";
  description: string;
  priority: "low" | "medium" | "high";
  rationale: string;
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
      maxTokens: 500,
    });

    const cleaned = result.text.trim().replace(/```json\n?|\n?```/g, "");
    return JSON.parse(cleaned);
  } catch (error) {
    console.error(`[Architect] Failed to identify needs:`, error);
    return [];
  }
}

async function designProposal(
  architect: DynamicSpiritState,
  need: IdentifiedNeed,
  context: ArchitectContext,
  spiritRegistry?: SpiritRegistry
): Promise<SpiritProposal | null> {
  try {
    const specPrompt = getSpecificationPrompt(need.type, need.description, context);

    const result = await generateText({
      model: plannerModel,  // Use the smarter model for design
      prompt: `You are ${architect.definition.name}, designing a solution for: ${need.description}

${specPrompt}

Respond with valid JSON only, no markdown.`,
      maxTokens: 800,
    });

    const cleaned = result.text.trim().replace(/```json\n?|\n?```/g, "");
    const specification = JSON.parse(cleaned);

    // Submit the proposal
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
  } catch (error) {
    console.error(`[Architect] Failed to design proposal for "${need.description}":`, error);
    return null;
  }
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
  }
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
    // Actually bake the system using the system baker
    const { bakeSystem } = await import("../god/system-baker");
    const result = await bakeSystem(bakerDescription, world, systemRegistry, 2);

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
      // Fallback: register a placeholder system that logs what it would do
      console.log(`[Architect] Baking failed for ${spec.name}: ${result.error}`);
      console.log(`[Architect] Registering placeholder system instead`);

      const placeholderDef: SystemDefinition = {
        name: spec.name,
        description: spec.description,
        pseudocode: spec.logic,
        frequency: spec.frequency,
        active: true,
        lastRun: 0,
        compiledFn: async (w: World) => {
          console.log(`[${spec.name}] Placeholder execution - Logic: ${spec.logic.slice(0, 100)}...`);
        },
      };

      registerSystem(systemRegistry, placeholderDef);

      recordEvent("system_created_placeholder", {
        name: spec.name,
        description: spec.description,
        createdBy: "architect",
        reason: result.error,
      }, "Architect");
    }
  } catch (error) {
    console.error(`[Architect] Error baking system ${spec.name}:`, error);

    // Register placeholder on error
    const placeholderDef: SystemDefinition = {
      name: spec.name,
      description: spec.description,
      pseudocode: spec.logic,
      frequency: spec.frequency,
      active: true,
      lastRun: 0,
      compiledFn: async (w: World) => {
        console.log(`[${spec.name}] Placeholder execution - Logic: ${spec.logic.slice(0, 100)}...`);
      },
    };

    registerSystem(systemRegistry, placeholderDef);

    recordEvent("system_created_error", {
      name: spec.name,
      error: String(error),
      createdBy: "architect",
    }, "Architect");
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
  const properties: Record<string, string> = {};
  if (spec.fields && Array.isArray(spec.fields)) {
    for (const field of spec.fields) {
      if (field.name && field.type) {
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
  const eid = addEntity(world);

  addComponent(world, eid, Name);
  Name.value[eid] = spec.name;

  addComponent(world, eid, Description);
  Description.value[eid] = spec.description;

  // Add specified components
  for (const comp of spec.components) {
    // For built-in components, we'd need to handle each case
    // For dynamic components, use setDynamicComponentValue
    console.log(`[Architect] Would add component ${comp.name} with values:`, comp.values);
  }

  recordEvent("entity_created", {
    name: spec.name,
    type: spec.type,
    eid,
    createdBy: "architect",
  }, "Architect");

  console.log(`[Architect] Created entity: ${spec.name} (eid: ${eid})`);
}

// =============================================================================
// STANDALONE PROPOSAL EXECUTION
// =============================================================================

/**
 * Execute all approved proposals (can be called independently of architect cognition)
 */
export async function executeAllApprovedProposals(
  world: World,
  systemRegistry: SystemRegistry
): Promise<{ executed: string[]; failed: string[] }> {
  const approved = getApprovedProposals();
  const executed: string[] = [];
  const failed: string[] = [];

  for (const proposal of approved) {
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
          // Register placeholder
          registerSystem(systemRegistry, {
            name: spec.name,
            description: spec.description,
            frequency: spec.frequency,
            enabled: true,
            execute: async () => {
              console.log(`[${spec.name}] Placeholder execution`);
            },
          });
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
