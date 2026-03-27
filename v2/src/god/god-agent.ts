import { generateText, tool, stepCountIs } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod/v3";
import { query } from "bitecs";
import { createArgosWorld, type World } from "../ecs/world";
import {
  createEcsTools,
  createEntityRegistry,
  type EntityRegistry,
  type EcsTools,
  type ToolResult,
} from "../ecs/tools";
import { createGodAgentEntity } from "../ecs/prefabs";
import { GodAgent, Name, Description, Agent, Mind, ObjectType, ObjectState, Traits, Room } from "../ecs/components";
import { AllComponents } from "../ecs/components";
import { AllRelations } from "../ecs/relations";
import { setAgentBehaviorPolicy, validateBehaviorNode } from "../cognition/behavior-policy";
import { getPolicyTemplate, inferPolicyFromRole, getAvailableTemplates, type PolicyTemplateName } from "../cognition/behavior-templates";
import { generateBatchPolicies, type PolicyGenerationContext } from "../cognition/policy-generator";
import { ActionRegistry, type ActionDefinition } from "../cognition/action-registry";
import { getRoomForEntity } from "../ecs/location";
import { transitionObjectState as transitionObjectStateCanonical } from "../world/effect-executor";
import {
  createSystemRegistry,
  type SystemRegistry,
  type SystemDefinition,
  runSystems,
  runAsyncSystems,
  consumeEvents,
  listSystems,
  activateSystem,
  deactivateSystem,
  createStimulusEmissionSystem,
  createMindDecaySystem,
} from "../ecs/dynamic-systems";
import { bakeSystem, modifySystem, activateBakedSystem } from "./system-baker";
import { runPostTickAnalysis } from "../spirits/effectiveness-tracker";
import {
  getPendingTaskNames,
  getQueueStats,
  getQueueSummary,
  getTaskStatus,
  queueTask,
  type TaskPriority,
} from "../runtime/async-task-queue";
import {
  writeSystemFile,
  loadSystemFromFile,
  loadAllSystems,
  runLoadedSystems,
  getSystemSource,
  deleteSystemFile,
  updateSystemFile,
  getSystemsNeedingFix,
  fixAllQueuedSystems,
  preflightValidateSystem,
  type LoadedSystem,
} from "../systems/system-loader";
import {
  createDynamicComponent,
  getDynamicComponent,
  listDynamicComponents,
  saveComponentDefinition,
  setDynamicComponentValue,
  getDynamicComponentValues,
  getAllDynamicComponentValuesForEntity,
  type ComponentDefinition,
} from "../ecs/dynamic-components";
import {
  listNames as registryListNames,
  listDefinitions as registryListDefinitions,
  attachToEntity,
} from "../ecs/component-registry";
import {
  createRenderingTools,
  type RenderingTools,
} from "../rendering/rendering-tools";
import {
  createInterventionRegistry,
  registerIntervention,
  unregisterIntervention,
  listInterventions,
  activateIntervention,
  deactivateIntervention,
  runInterventions,
  createSimpleIntervention,
  type InterventionRegistry,
  type InterventionDefinition,
  type InterventionCondition,
  type InterventionEffect,
} from "../ecs/interventions";
import {
  createPropositionRegistry,
  registerProposition,
  unregisterProposition,
  listPropositions,
  evaluateProposition,
  evaluateAllPropositions,
  getCategoryReport,
  getPropositionHistory,
  createNeedsHealthProposition,
  createValueRangeProposition,
  createExistenceProposition,
  type PropositionRegistry,
  type PropositionDefinition,
  type PropositionCheck,
} from "../ecs/propositions";
import {
  WorldSchema,
  worldSchema as defaultWorldSchema,
  type ObjectTypeDefinition,
  type AffordanceDefinition,
  type RuleDefinition,
} from "../world/schema";
import type { GodAutopilotState } from "./god-autopilot";
import {
  registerAffordance,
  listAllAffordances,
} from "../world/schema";
import {
  registerTrait,
  listAllTraits,
  isTraitRegistered,
  type TraitDefinition,
  type TraitCategory,
} from "../world/trait-registry";
import {
  registerRelationshipType,
  listRelationshipTypes,
  addRelationship,
  type RelationshipTypeDefinition,
} from "../ecs/relationship-registry";
import {
  createSimulation,
  loadSimulation,
  listSimulations,
  deleteSimulation,
  loadSnapshot,
  getCurrentSimulation,
  setCurrentSimulation,
  type SimulationConfig,
  type SimulationMetadata,
  type SimulationInstance,
} from "../persistence/simulation-manager";
import { writeSystemToDir, loadSystemsFromDir } from "../systems/system-loader";
import {
  createGlobalState,
  updateSimulationTime,
  generateSpiritContext,
  getStateSummary,
  switchPreset,
  setTension,
  setAtmosphere,
  canPerformAction,
  recordAction,
  type GlobalSimulationState,
  type SimulationPreset,
  PRESET_SLICE_OF_LIFE,
  PRESET_CHAOS,
  PRESET_DRAMATIC,
  PRESET_SLOW_BURN,
  PRESET_MURDER_MYSTERY,
  PRESET_CORPORATE,
} from "../simulation/global-state";

// Re-export simulation presets and types for easy access
export {
  PRESET_SLICE_OF_LIFE,
  PRESET_CHAOS,
  PRESET_DRAMATIC,
  PRESET_SLOW_BURN,
  PRESET_MURDER_MYSTERY,
  PRESET_CORPORATE,
  type GlobalSimulationState,
  type SimulationPreset,
} from "../simulation/global-state";

// Multi-model architecture - LOCKED MODELS from centralized config
// See src/llm/config.ts for model definitions - DO NOT CHANGE HERE
import { plannerModel, executorModel, THINKING_LEVELS } from "../llm/config";
// Keep backward compatibility
const model = executorModel;

// Thinking levels imported from centralized config
const PLANNER_THINKING_LEVEL = THINKING_LEVELS.PLANNER;
const REVIEW_THINKING_LEVEL = THINKING_LEVELS.REVIEW;
const EXECUTOR_THINKING_LEVEL = THINKING_LEVELS.EXECUTOR;

// Environment variable to control review phase (default: enabled)
const ENABLE_DESIGN_REVIEW = process.env.SKIP_DESIGN_REVIEW !== "true";

export interface DesignDocument {
  summary: string;
  components: Array<{
    name: string;
    purpose: string;
    properties: Record<string, string>;
  }>;
  entities: Array<{
    name: string;
    type: "producer" | "consumer" | "market" | "other";
    components: string[];
    initialValues?: Record<string, any>;
  }>;
  systems: Array<{
    name: string;
    purpose: string;
    frequency: number;
    logic: string; // Pseudocode description
  }>;
  feedbackLoops?: string[];
  notes?: string;
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
  createdAt: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: "active" | "completed" | "abandoned";
  createdAt: number;
  completedAt?: number;
}

export interface MemoryEntry {
  id: string;
  type: "action" | "observation" | "decision" | "reflection";
  content: string;
  timestamp: number;
  importance: number;
  relatedEntities: string[];
  tags: string[];
}

/**
 * NarrativeVision - God's top-down control over story direction
 * This is what makes a "chill harvest festival" different from "murder mystery"
 */
export interface NarrativeVision {
  // Genre shapes everything - pacing, tone, what's "interesting"
  genre:
    | "romance"
    | "drama"
    | "horror"
    | "comedy"
    | "slice-of-life"
    | "mystery"
    | "action"
    | "tragedy";

  // Subgenre for more nuance
  subgenre?: string; // "cozy mystery", "dark comedy", "slow burn romance"

  // Current tension target (what we're AIMING for, not what emergent events create)
  targetTension: number; // 0-1
  tensionDirection: "building" | "releasing" | "stable";

  // Focus - whose story is this right now?
  focusCharacters: string[]; // The characters the narrator should follow
  focusLocation?: string; // Where the "camera" is pointed

  // Current narrative beat we're working toward
  currentBeat?: string; // "first meeting", "misunderstanding", "confession"
  nextBeat?: string; // What's coming next

  // Constraints for all spirits/daemons
  moodConstraints: {
    allowConflict: boolean; // false = redirect conflicts to grumbling
    allowViolence: boolean; // false = no combat escalation
    allowRomance: boolean; // true = allow romantic tension
    maxDramaLevel: number; // 0-1, caps how dramatic things can get
    preferredMood: string; // "festive", "tense", "melancholic", "hopeful"
  };

  // Pacing control
  pacing: "slow" | "moderate" | "fast";

  // What makes this genre "interesting"
  interestingElements: string[]; // ["longing glances", "misunderstandings", "near-misses"] for romance
}

/**
 * Default narrative vision - slice-of-life, moderate pace
 */
export const DEFAULT_NARRATIVE_VISION: NarrativeVision = {
  genre: "slice-of-life",
  targetTension: 0.3,
  tensionDirection: "stable",
  focusCharacters: [],
  moodConstraints: {
    allowConflict: true,
    allowViolence: false,
    allowRomance: true,
    maxDramaLevel: 0.5,
    preferredMood: "peaceful",
  },
  pacing: "moderate",
  interestingElements: [
    "daily routines",
    "small discoveries",
    "quiet moments",
    "gentle humor",
  ],
};

export interface GodAgentState {
  eid: number;
  world: World;
  registry: EntityRegistry;
  systemRegistry: SystemRegistry;
  interventionRegistry: InterventionRegistry;
  propositionRegistry: PropositionRegistry;
  worldSchema: WorldSchema;
  tools: EcsTools;
  renderingTools: RenderingTools;
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  thinkingLog: string[];
  tick: number;
  fileSystems: LoadedSystem[];
  memory: {
    shortTerm: MemoryEntry[];
    longTerm: MemoryEntry[];
    plans: Plan[];
    activePlan: string | null;
  };
  // Top-down narrative control
  narrativeVision: NarrativeVision;
  // Global simulation state - pacing, mood, directives, time scaling
  globalState: GlobalSimulationState;
  // Persistence - automatically saves if attached
  simulation?: SimulationInstance;
  // --- Concurrency control ---
  /** Internal command mutex chain to prevent concurrent godCommand calls */
  _commandLock?: Promise<void>;
  // --- Autonomy ---
  /** GodAI autopilot state (spirit message inbox + throttle config) */
  autopilot?: GodAutopilotState;
}

export interface GodAgentConfig {
  name: string;
  worldName: string;
  narrative?: string;
  /** Initial narrative vision - sets genre, tension, focus, constraints */
  narrativeVision?: Partial<NarrativeVision>;
  /**
   * Simulation preset - sets global pacing, mood, and directives
   * Options: "slice-of-life" | "chaos" | "dramatic" | "slow-burn" | "murder-mystery" | "corporate"
   * Default: "slice-of-life"
   */
  preset?:
    | "slice-of-life"
    | "chaos"
    | "dramatic"
    | "slow-burn"
    | "murder-mystery"
    | "corporate";
  /** Custom time scale (1.0 = real time, 60.0 = 1 min real = 1 hour sim) */
  timeScale?: number;
  /** Enable automatic persistence - creates a simulation folder for this run */
  persistence?:
    | boolean
    | {
        /** Simulation name (defaults to worldName) */
        name?: string;
        /** Auto-save every N ticks (default: 50) */
        autosaveInterval?: number;
        /** Create snapshot every N ticks (default: 200) */
        snapshotInterval?: number;
        /** Max snapshots to keep (default: 10) */
        maxSnapshots?: number;
      };
}

// Map preset names to preset objects
const PRESET_MAP: Record<string, SimulationPreset> = {
  "slice-of-life": PRESET_SLICE_OF_LIFE,
  chaos: PRESET_CHAOS,
  dramatic: PRESET_DRAMATIC,
  "slow-burn": PRESET_SLOW_BURN,
  "murder-mystery": PRESET_MURDER_MYSTERY,
  corporate: PRESET_CORPORATE,
};

export function createGodAgent(
  world: World,
  config: GodAgentConfig
): GodAgentState {
  const registry = createEntityRegistry();
  const systemRegistry = createSystemRegistry();
  const tools = createEcsTools(world, registry);
  const renderingTools = createRenderingTools(world, registry);

  const eid = createGodAgentEntity(world, {
    name: config.name,
    worldName: config.worldName,
    narrative: config.narrative,
  });

  systemRegistry.systems.set(
    "StimulusEmission",
    createStimulusEmissionSystem()
  );
  systemRegistry.systems.set("MindDecay", createMindDecaySystem());

  const interventionRegistry = createInterventionRegistry();
  const propositionRegistry = createPropositionRegistry();
  // Single source of truth: use the shared world schema instance used by rules/affordances.
  const worldSchema = defaultWorldSchema;

  // Initialize global simulation state with selected preset
  const presetKey = config.preset || "slice-of-life";
  const preset = PRESET_MAP[presetKey] || PRESET_SLICE_OF_LIFE;
  const globalState = createGlobalState(preset);

  // Apply custom time scale if provided
  if (config.timeScale !== undefined) {
    globalState.time.timeScale = config.timeScale;
  }

  console.log(
    `[GodAgent] Initialized with preset: ${preset.name} (time scale: ${globalState.time.timeScale}x)`
  );

  return {
    eid,
    world,
    registry,
    systemRegistry,
    interventionRegistry,
    propositionRegistry,
    worldSchema,
    tools,
    renderingTools,
    conversationHistory: [],
    thinkingLog: [],
    tick: 0,
    fileSystems: [],
    memory: {
      shortTerm: [],
      longTerm: [],
      plans: [],
      activePlan: null,
    },
    narrativeVision: {
      ...DEFAULT_NARRATIVE_VISION,
      ...(config.narrativeVision || {}),
      moodConstraints: {
        ...DEFAULT_NARRATIVE_VISION.moodConstraints,
        ...(config.narrativeVision?.moodConstraints || {}),
      },
    },
    globalState,
    // simulation will be attached by initializeGodAgentWithPersistence
  };
}

/**
 * Create a GodAgent with automatic persistence enabled.
 * This creates a simulation folder and auto-saves on each tick.
 */
export async function createGodAgentWithPersistence(
  world: World,
  config: GodAgentConfig
): Promise<GodAgentState> {
  const state = createGodAgent(world, config);

  // Create simulation if persistence is enabled
  if (config.persistence) {
    const persistConfig =
      typeof config.persistence === "object" ? config.persistence : {};

    const simulation = await createSimulation({
      name: persistConfig.name || config.worldName,
      description: config.narrative?.substring(0, 200),
      autosaveInterval: persistConfig.autosaveInterval ?? 50,
      snapshotInterval: persistConfig.snapshotInterval ?? 200,
      maxSnapshots: persistConfig.maxSnapshots ?? 10,
    });

    state.simulation = simulation;
    setCurrentSimulation(simulation);

    console.log(`[GodAgent] Persistence enabled: ${simulation.basePath}`);
  }

  return state;
}

/**
 * Attach an existing simulation to a GodAgent state
 */
export function attachSimulation(
  state: GodAgentState,
  simulation: SimulationInstance
): void {
  state.simulation = simulation;
  setCurrentSimulation(simulation);
  console.log(`[GodAgent] Attached simulation: ${simulation.id}`);
}

const SHORT_TERM_LIMIT = 50;
const LONG_TERM_LIMIT = 200;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function addMemory(
  state: GodAgentState,
  type: MemoryEntry["type"],
  content: string,
  options: {
    importance?: number;
    relatedEntities?: string[];
    tags?: string[];
  } = {}
): MemoryEntry {
  const entry: MemoryEntry = {
    id: generateId(),
    type,
    content,
    timestamp: Date.now(),
    importance: options.importance ?? 5,
    relatedEntities: options.relatedEntities ?? [],
    tags: options.tags ?? [],
  };

  state.memory.shortTerm.push(entry);

  if (state.memory.shortTerm.length > SHORT_TERM_LIMIT) {
    const evicted = state.memory.shortTerm.shift()!;
    if (evicted.importance >= 7) {
      state.memory.longTerm.push(evicted);
      if (state.memory.longTerm.length > LONG_TERM_LIMIT) {
        state.memory.longTerm.sort((a, b) => b.importance - a.importance);
        state.memory.longTerm.pop();
      }
    }
  }

  return entry;
}

export function searchMemory(
  state: GodAgentState,
  query: {
    type?: MemoryEntry["type"];
    tags?: string[];
    entityName?: string;
    minImportance?: number;
  }
): MemoryEntry[] {
  const all = [...state.memory.shortTerm, ...state.memory.longTerm];
  return all.filter((m) => {
    if (query.type && m.type !== query.type) return false;
    if (query.minImportance && m.importance < query.minImportance) return false;
    if (query.entityName && !m.relatedEntities.includes(query.entityName))
      return false;
    if (query.tags && !query.tags.some((t) => m.tags.includes(t))) return false;
    return true;
  });
}

// =============================================================================
// GLOBAL STATE MANAGEMENT
// =============================================================================

/**
 * Update the global simulation time (call every tick)
 */
export function updateGlobalTime(state: GodAgentState, deltaMs: number): void {
  updateSimulationTime(state.globalState, deltaMs);
}

/**
 * Get the current spirit context string (to inject into all spirit prompts)
 */
export function getSpiritContext(state: GodAgentState): string {
  return generateSpiritContext(state.globalState);
}

/**
 * Get a summary of the current global state
 */
export function getGlobalStateSummary(state: GodAgentState): string {
  return getStateSummary(state.globalState);
}

/**
 * Check if an action type can be performed (respects pacing cooldowns)
 */
export function canDoGlobalAction(
  state: GodAgentState,
  actionType: "intervention" | "systemBake" | "drama"
): boolean {
  return canPerformAction(state.globalState, actionType);
}

/**
 * Record that an action was performed (for pacing cooldowns)
 */
export function logGlobalAction(
  state: GodAgentState,
  actionType: "intervention" | "systemBake" | "drama"
): void {
  recordAction(state.globalState, actionType);
}

/**
 * Change the global tension level
 */
export function setGlobalTension(state: GodAgentState, tension: number): void {
  setTension(state.globalState, tension);
  console.log(
    `[GodAgent] Global tension set to ${(tension * 100).toFixed(0)}%`
  );
}

/**
 * Change the global atmosphere
 */
export function setGlobalAtmosphere(
  state: GodAgentState,
  atmosphere:
    | "peaceful"
    | "tense"
    | "chaotic"
    | "mysterious"
    | "festive"
    | "somber"
): void {
  setAtmosphere(state.globalState, atmosphere as any);
  console.log(`[GodAgent] Global atmosphere set to ${atmosphere}`);
}

/**
 * Switch to a different simulation preset
 */
export function changePreset(
  state: GodAgentState,
  presetName:
    | "slice-of-life"
    | "chaos"
    | "dramatic"
    | "slow-burn"
    | "murder-mystery"
    | "corporate"
): void {
  const preset = PRESET_MAP[presetName];
  if (preset) {
    switchPreset(state.globalState, preset);
    console.log(`[GodAgent] Switched to preset: ${preset.name}`);
  } else {
    console.warn(`[GodAgent] Unknown preset: ${presetName}`);
  }
}

/**
 * Set custom global directives (pins context across all spirits)
 */
export function setGlobalDirectives(
  state: GodAgentState,
  directives: Partial<GlobalSimulationState["directives"]>
): void {
  Object.assign(state.globalState.directives, directives);
  console.log(`[GodAgent] Global directives updated`);
}

/**
 * Add to the global narrative focus
 */
export function setNarrativeFocus(state: GodAgentState, focus: string[]): void {
  state.globalState.directives.narrativeFocus = focus.join(", ");
  console.log(`[GodAgent] Narrative focus set to: ${focus.join(", ")}`);
}

/**
 * Set forbidden actions globally
 */
export function setForbiddenActions(
  state: GodAgentState,
  actions: string[]
): void {
  state.globalState.directives.forbiddenActions = actions;
  console.log(`[GodAgent] Forbidden actions: ${actions.join(", ")}`);
}

export function createPlan(
  state: GodAgentState,
  goal: string,
  steps: string[]
): Plan {
  const plan: Plan = {
    id: generateId(),
    goal,
    steps: steps.map((desc, i) => ({
      id: `${generateId()}-step-${i}`,
      description: desc,
      status: "pending" as const,
      createdAt: Date.now(),
    })),
    status: "active",
    createdAt: Date.now(),
  };

  state.memory.plans.push(plan);
  state.memory.activePlan = plan.id;

  addMemory(state, "decision", `Created plan: ${goal}`, {
    importance: 8,
    tags: ["plan", "created"],
  });

  return plan;
}

export function getActivePlan(state: GodAgentState): Plan | null {
  if (!state.memory.activePlan) return null;
  return (
    state.memory.plans.find((p) => p.id === state.memory.activePlan) ?? null
  );
}

export function advancePlan(
  state: GodAgentState,
  result?: string
): PlanStep | null {
  const plan = getActivePlan(state);
  if (!plan) return null;

  const currentStep = plan.steps.find((s) => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "completed";
    currentStep.result = result;
    currentStep.completedAt = Date.now();

    addMemory(state, "action", `Completed step: ${currentStep.description}`, {
      importance: 6,
      tags: ["plan", "step-completed"],
    });
  }

  const nextStep = plan.steps.find((s) => s.status === "pending");
  if (nextStep) {
    nextStep.status = "in_progress";
    return nextStep;
  }

  plan.status = "completed";
  plan.completedAt = Date.now();
  state.memory.activePlan = null;

  addMemory(state, "decision", `Completed plan: ${plan.goal}`, {
    importance: 9,
    tags: ["plan", "completed"],
  });

  return null;
}

export function failPlanStep(state: GodAgentState, reason: string): void {
  const plan = getActivePlan(state);
  if (!plan) return;

  const currentStep = plan.steps.find((s) => s.status === "in_progress");
  if (currentStep) {
    currentStep.status = "failed";
    currentStep.result = reason;
    currentStep.completedAt = Date.now();

    addMemory(
      state,
      "observation",
      `Step failed: ${currentStep.description} - ${reason}`,
      {
        importance: 8,
        tags: ["plan", "step-failed"],
      }
    );
  }
}

export function abandonPlan(state: GodAgentState, reason: string): void {
  const plan = getActivePlan(state);
  if (!plan) return;

  plan.status = "abandoned";
  plan.completedAt = Date.now();
  state.memory.activePlan = null;

  addMemory(state, "decision", `Abandoned plan: ${plan.goal} - ${reason}`, {
    importance: 7,
    tags: ["plan", "abandoned"],
  });
}

function formatMemoryForPrompt(state: GodAgentState): string {
  const recentMemories = state.memory.shortTerm.slice(-10);
  const importantMemories = state.memory.longTerm
    .filter((m) => m.importance >= 8)
    .slice(-5);

  const lines: string[] = [];

  if (importantMemories.length > 0) {
    lines.push("IMPORTANT MEMORIES:");
    for (const m of importantMemories) {
      lines.push(`  [${m.type}] ${m.content}`);
    }
  }

  if (recentMemories.length > 0) {
    lines.push("\nRECENT ACTIVITY:");
    for (const m of recentMemories) {
      lines.push(`  [${m.type}] ${m.content}`);
    }
  }

  const activePlan = getActivePlan(state);
  if (activePlan) {
    lines.push("\nACTIVE PLAN:");
    lines.push(`  Goal: ${activePlan.goal}`);
    for (const step of activePlan.steps) {
      const status =
        step.status === "completed"
          ? "✓"
          : step.status === "in_progress"
          ? "►"
          : step.status === "failed"
          ? "✗"
          : "○";
      lines.push(
        `  ${status} ${step.description}${
          step.result ? ` (${step.result})` : ""
        }`
      );
    }
  }

  return lines.join("\n");
}

function buildCurrentWorldContext(state: GodAgentState): string {
  const lines: string[] = [];

  // List existing entities
  const entities = state.tools.listEntities().result as Array<{
    name: string;
    id: number;
  }>;
  if (entities.length > 1) {
    // More than just the GodAgent
    lines.push(`Entities (${entities.length}):`);
    for (const e of entities.slice(0, 20)) {
      if (!e.name.includes("GodAgent") && !e.name.includes("Architect")) {
        lines.push(`  - ${e.name}`);
      }
    }
    if (entities.length > 20)
      lines.push(`  ... and ${entities.length - 20} more`);
  }

  // List dynamic components
  const dynComponents = listDynamicComponents();
  if (dynComponents.length > 0) {
    lines.push(`\nCustom Components (${dynComponents.length}):`);
    for (const c of dynComponents.slice(0, 10)) {
      lines.push(`  - ${c.name}: { ${Object.keys(c.properties).join(", ")} }`);
    }
  }

  // List file-based systems
  if (state.fileSystems.length > 0) {
    lines.push(`\nFile Systems (${state.fileSystems.length}):`);
    for (const s of state.fileSystems.slice(0, 10)) {
      lines.push(
        `  - ${s.name} (${s.active ? "active" : "inactive"}): ${s.description}`
      );
    }
  }

  // List interventions
  const interventions = listInterventions(state.interventionRegistry);
  if (interventions.length > 0) {
    lines.push(`\nInterventions (${interventions.length}):`);
    for (const i of interventions.slice(0, 5)) {
      lines.push(`  - ${i.name}: ${i.description}`);
    }
  }

  return lines.length > 0
    ? lines.join("\n")
    : "World is empty - ready to build!";
}

function buildSystemPrompt(state: GodAgentState): string {
  const worldName = GodAgent.worldName[state.eid];
  const narrative = GodAgent.narrative[state.eid];
  const systems = listSystems(state.systemRegistry);

  return `You are the God Agent - an omniscient, omnipotent overseer of the simulated world "${worldName}".

You are a COLLABORATIVE WORLD-BUILDER working with the user. Your role is to:
1. DISCUSS and EXPLORE ideas before implementing
2. ASK CLARIFYING QUESTIONS when the request is vague or has multiple interpretations
3. EXPLAIN your reasoning and propose options
4. EXECUTE only when you understand what the user wants

COLLABORATION GUIDELINES:
- If the user asks a question, ANSWER it conversationally - don't immediately create things
- If the request is ambiguous, ASK what they prefer (e.g., "Should the room be cozy or spacious?")
- PROPOSE ideas and wait for feedback before executing complex designs
- SHARE your thinking - explain WHY you'd design something a certain way
- You can suggest improvements or alternatives to the user's ideas
- For simple, clear requests, go ahead and execute
- For complex world-building, discuss the approach first

EXAMPLE COLLABORATION:
User: "Create a house"
You: "I'd love to help create a house! A few questions first:
- What style? (modern apartment, suburban home, cabin?)
- How many rooms should it have?
- Any specific furniture or objects you want?
- Should occupants be cognitive (AI-driven) or mechanical (purely system-driven)?"

EXAMPLE DIRECT EXECUTION:
User: "Add a person named Bob to the kitchen"
You: [Creates the agent directly since the request is clear]

${narrative ? `NARRATIVE CONTEXT:\n${narrative}\n` : ""}

BUILT-IN COMPONENTS:
- Name: { value: string } - Entity's name
- Description: { value: string } - Entity's description
- Position: { x: number, y: number, z: number } - Spatial position for 2D/3D visualization
- Room: { capacity: number, ambience: string } - A location/space
- Agent: { role: string, systemPrompt: string, active: boolean } - Cognitive agent that thinks
- Mind: { mode: string, arousal: number, focus: string } - Agent's mental state (also for mechanical entities!)
- PhysicalObject: { material: string, weight: number, portable: boolean } - Physical objects
- StimulusSource: { stimulusType: string, template: string, interval: number } - Emits stimuli
- Visual: { shape: string, color: string, size: number, label: string, opacity: number, glow: boolean, pulseRate: number } - 2D RENDERING
- Connection: { targetId: number, color: string, width: number, style: string, animated: boolean } - Visual connections between entities
- Needs: { hunger: number, energy: number, social: number, comfort: number } - Agent needs (0-100, higher hunger = more hungry)
- Interactable: { action: string, targetNeed: string, effectAmount: number, cooldown: number } - Objects agents can use
- CurrentAction: { type: string, targetEid: number, startTick: number, duration: number } - Agent's ongoing action
- Stimulus, Memory, Belief, Goal, Impression, Action, CognitiveEvent - Other components

DYNAMIC COMPONENT SYSTEM - CREATE YOUR OWN COMPONENTS:
You can create ANY custom component types to model ANY domain. This is the key to flexible simulation!

To create a custom component:
  createComponent({ name: "Temperature", description: "Thermal state", properties: { current: "number", target: "number" } })

To use on entities:
  setDynamicComponent({ entityName: "Reactor Core", componentName: "Temperature", values: { current: 100, target: 200 } })

⚠️ CRITICAL - STRUCTURE OF ARRAYS (SoA) DATA ACCESS:
Components use a Structure of Arrays pattern - NOT object-per-entity!

The component is a single object where each property is an ARRAY indexed by entity ID:
  const Temperature = ctx.getDynamic("Temperature");
  // Temperature looks like: { current: [undefined, undefined, 100, undefined, 200], target: [...] }
  // The arrays are indexed by entity ID (eid)

✅ CORRECT - Access data via Component.property[eid]:
  const temp = Temperature.current[eid];       // READ a value
  Temperature.current[eid] = temp + 5;         // WRITE a value
  Temperature.target[eid] = 200;               // SET a value

  // Loop example:
  for (const eid of entities) {
    const currentPrice = Market.currentPrice[eid];
    const supply = Market.supply[eid];
    Market.currentPrice[eid] = currentPrice + (supply * 0.1);
  }

❌ WRONG - Do NOT use OOP-style methods (they don't exist!):
  Temperature.getByEntity(eid)           // ❌ NO! This does not exist
  Temperature.get(eid)                   // ❌ NO! Use Temperature.current[eid]
  Temperature.set(eid, value)            // ❌ NO! Use Temperature.current[eid] = value
  const tempObj = Temperature[eid]       // ❌ NO! Properties ARE the arrays
  tempObj.current = 50                   // ❌ NO! This is wrong

The SoA pattern means: Component.PROPERTY[eid], not Component.getByEntity(eid).PROPERTY

EXAMPLE - Creating a custom simulation:
1. createComponent({ name: "Health", properties: { current: "number", max: "number" } })
2. createEntity({ name: "Player" })
3. setDynamicComponent({ entityName: "Player", componentName: "Health", values: { current: 100, max: 100 } })
4. createSystem with code that uses SoA access:
   const Health = ctx.getDynamic("Health");
   if (!Health) return;
   for (const eid of entities) {
     // SoA: Component.property[eid]
     const current = Health.current[eid] || 0;
     Health.current[eid] = Math.min(current + 1, Health.max[eid] || 100);
   }

⚠️ CRITICAL - SIMULATIONS NEED SYSTEMS TO RUN:
Entities and components are just DATA. Without SYSTEMS, nothing happens!

When building any simulation, you MUST create systems that:
1. Process entities and modify component data over time
2. Implement the behavioral rules of your simulation
3. Log interesting events so we can observe the simulation

COMPLETE SIMULATION = Components + Entities + Systems
- Components define WHAT data exists
- Entities hold the data
- Systems make things HAPPEN by processing entities each tick

If you create components and entities but NO systems, the simulation will be STATIC.
Always finish your setup by creating the necessary systems!

2D VISUALIZATION SYSTEM:
The Visual component controls how entities appear in the 2D canvas:
- shape: "circle", "rect", "diamond", "triangle", "hexagon", "star"
- color: Any CSS color (hex "#ff0000", named "red", rgb "rgb(255,0,0)")
- size: Radius/size in pixels (default 20)
- label: Text displayed near the entity
- opacity: 0-1 (0 = invisible, 1 = fully visible)
- glow: true = entity has a glow effect (use for active/firing states)
- pulseRate: > 0 = entity pulses (good for showing activity/heartbeat)

Use setComponentValues to update Visual properties dynamically from systems!

FLEXIBLE ENTITY COMPOSITION:
You can compose entities with ANY combination of components using these tools:
- addComponent({ entityName, componentName, values }) - Add a built-in component to any entity
- removeComponent({ entityName, componentName }) - Remove a component from an entity
- createComponent/setDynamicComponent - For custom component types

This lets you build ANY entity type from primitives, not just the predefined createAgent/createRoom/etc.

AVAILABLE RELATIONS:
${Object.keys(AllRelations)
  .map((r) => `- ${r}`)
  .join("\n")}

AVAILABLE SYSTEMS:
${systems
  .map(
    (s) =>
      `- ${s.name} (${s.active ? "ACTIVE" : "inactive"}, ${s.frequency}ms): ${
        s.description
      }`
  )
  .join("\n")}

PRE-BUILT SYSTEMS (can activate/deactivate as needed):
- TimeProgression: Advances world time (dawn/morning/evening/night), updates room ambience. Good for social/narrative sims.
- SocialDynamics: Adjusts agent arousal based on who else is in the room. Good for social sims.
- NarrativeEvents: Random atmospheric events ("thunder rumbles", "dog barks"). Good for immersive narrative.
- RelationshipEvolution: Strengthens relationships between agents in same room over time.
- StuckAgentRecovery: Detects agents frozen in same position/focus for too long and nudges them with stimuli. Prevents "living statue" bugs.

These are designed for SOCIAL simulations. For MECHANICAL simulations (cells, neurons, physics), 
you should DEACTIVATE these and bake custom systems instead.

TOOLS:
1. createAgent - Creates a COGNITIVE agent that THINKS via LLM (use for characters, NPCs, social simulations)
2. createEntity - Creates a MECHANICAL entity driven ONLY by systems (use for cells, neurons, planets, particles - NO thinking)
3. createRoom - Creates a space/location with Position for 2D visualization
4. createObject - Creates a physical object
5. createStimulusSource - Creates something that periodically emits stimuli
6. setComponentValues - Set values on existing components
7. addRelation - Create relationships between entities
8. bakeNewSystem - CAREFUL: Systems can ONLY use the components listed above
9. activateSystem/deactivateSystem - Control system execution

IMPORTANT DISTINCTION:
- Use createAgent for things that need to THINK (people, animals, characters)
- Use createEntity for things driven by SYSTEMS (cells, neurons, particles, planets)
  Entities have Mind component for state (arousal, mode, focus) but NO cognition

For 2D VISUALIZATION:
- Set Position.x and Position.y on entities (rooms and agents)
- Rooms are drawn as rectangles at their position
- Agents are drawn as circles inside their room
- Use setComponentValues to update positions

ASCII WORLD SYSTEM (Grid-based 2D world):
You can create a grid-based ASCII world where agents move around!

TILE CHARACTERS:
- '.' = Floor (walkable)
- '#' = Wall (solid)
- '~' = Water
- ',' = Grass (walkable)
- '+' = Door (walkable)
- ' ' = Void/empty

ASCII WORLD TOOLS:
1. createWorldMap(name, width, height, fill?) - Create grid world
2. drawRoom(mapName, x, y, width, height, floor?, wall?) - Draw a room with walls
3. drawDoor(mapName, x, y) - Add a door at position
4. drawPath(mapName, x1, y1, x2, y2, char?) - Draw a path between points
5. fillArea(mapName, x, y, width, height, char) - Fill rectangular area
6. setTile(mapName, x, y, char) - Set single tile
7. placeEntityOnGrid(entityName, mapName, x, y, char?, color?) - Place agent/entity on map
8. moveEntityOnGrid(entityName, mapName, direction) - Move entity (north/south/east/west)
9. setEntitySprite(entityName, char, color?) - Change entity's display character
10. getEntityPosition(entityName) - Get entity's current x, y position and facing
11. getEntitiesAtPosition(x, y) - Get all entities at a specific position
12. getEntitiesInRadius(x, y, radius) - Get all entities within radius of position
13. checkCollision(entityName, mapName, direction) - Check if entity can move in direction

EXAMPLE USAGE:
1. createWorldMap("house", 40, 20, " ") - Create empty map
2. drawRoom("house", 1, 1, 10, 8) - Draw first room
3. drawRoom("house", 15, 5, 12, 10) - Draw second room  
4. drawPath("house", 10, 4, 15, 9, ".") - Connect rooms with hallway
5. drawDoor("house", 10, 4) - Add door
6. createAgent(...) - Create an agent
7. placeEntityOnGrid("AgentName", "house", 5, 4, "@", "#ff6666") - Place on map

Agents placed on grid will appear in the ASCII World view!

PIXI.JS SPRITE RENDERING SYSTEM:
For graphical 2D rendering with sprites and animations (in addition to ASCII):

CHARACTER RIGS (recommended for NPCs):
Character rigs automatically map NPC actions to animations. When you set up a rig, the NPC's behavior drives its visual appearance.

1. getAvailableCharacters() - See what character sprites are available
2. setupCharacterRig(entityName, baseAtlas, actionAtlases?, actionMappings?) - Create a rig
3. triggerCharacterAction(entityName, action, direction?) - Trigger animation from action
4. setCharacterIdleState(entityName) - Set character to idle

EXAMPLE - Setting up an NPC:
1. createAgent("Farmer Bob", ...) - Create the agent
2. placeEntityOnGrid("Farmer Bob", "farm", 5, 5) - Place on map
3. setupCharacterRig("Farmer Bob", "farmer_1", { chop: "farmer_1_chop" }) - Set up rig
4. When Bob takes a "chop" action, call triggerCharacterAction("Farmer Bob", "chop")

DIRECT SPRITE CONTROL:
- setEntityPixiSprite(entityName, spriteName) - Assign a static sprite
- setEntityAnimation(entityName, atlasId, animationId) - Play a specific animation
- listAvailableSprites(tag?, search?) - Find sprites
- listAnimations(atlasId?, tag?) - List available animations
- describeEntityAppearance(entityName) - Get current visual state
- getVisibleEntities(viewerName, radius?) - What entities are nearby

AGENTS RUN COGNITION when:
- They have Agent.active = true
- They receive stimuli (from StimulusSource or broadcasts)
- The cognition cycle processes their perceptions and generates actions

When creating agents, always:
- Give distinctive name and role
- Set Agent.active = true
- Place in a room with roomName
- Consider adding StimulusSource nearby to trigger interactions

PLANNING AND MEMORY:
For complex tasks, use the planning tools to break them into steps:
- makePlan: Create a multi-step plan for complex goals
- advancePlanStep: Mark current step complete and move to next
- getActivePlan: Check your current plan progress
- recordMemory: Store important observations or decisions
- searchMemories: Recall relevant past information

WORLD SCHEMA SYSTEM - PREFABS, TRAITS & AFFORDANCES:
The WorldSchema provides a trait-based object system for rich interactive worlds.

OBJECT TYPES (Prefabs):
Pre-defined templates with traits and states. Use spawn() to create instances.
Available types: ${state.worldSchema
    .getAllObjectTypes()
    .map((t) => t.name)
    .join(", ")}

To spawn from a type:
  spawn({ type: "bed", name: "Guest Bed", properties: { adjective: "creaky", material: "oak" }, roomName: "Bedroom" })

To define a NEW object type:
  defineObjectType({
    name: "ale_mug",
    description: "A {adjective} mug of {beverage}",
    traits: ["drinkable", "takeable", "examinable"],
    states: {
      full: { description: "The mug is full.", traits: ["drinkable"] },
      empty: { description: "Empty.", blockedTraits: ["drinkable"] }
    },
    defaultState: "full",
    category: "consumable"
  })

TRAITS (for affordance system):
Traits define what ACTIONS can be performed on objects. NOT for game logic - use components for that.
Common traits: takeable, openable, lockable, drinkable, edible, sleepable, sittable, examinable, lightSource, talkable, alive, prey, predator

COMPONENTS (for game systems):
Components hold REAL DATA that systems process. When building simulations, define components in your object types!

⚠️ CRITICAL: Object types with ONLY traits are STATIC. To make entities that PARTICIPATE in systems:
  - Add defaultComponents with numeric data (health, energy, speed, etc.)
  - Systems query for entities by component: query(world, [Health, Energy])
  - Systems read/write component values: Health.current[eid] += 10

EXAMPLE - Simulation entity with components:
defineObjectType({
  name: "rabbit",
  description: "A {adjective} rabbit",
  traits: ["prey", "edible", "alive"],  // For affordances (what can be done TO it)
  states: { active: {...}, dead: {...} },
  defaultState: "active",
  defaultComponents: [  // For systems (HOW IT BEHAVES)
    { name: "Health", values: { current: 100, max: 100 } },
    { name: "Energy", values: { current: 80, max: 100, decayRate: 0.5 } },
    { name: "Movement", values: { speed: 2, canMove: true } }
  ]
})

When you spawn("rabbit", "Rabbit 1"), it gets all those components with real data!

AFFORDANCES (for interaction):
Actions that can be performed on objects. When an agent uses an affordance, the EFFECTS execute and modify REAL game state!
Available: ${state.worldSchema
    .getAllAffordances()
    .slice(0, 10)
    .map((a) => a.name)
    .join(", ")}...

AFFORDANCE EFFECT TYPES:
- modify_component: Change component data (e.g., { type: "modify_component", target: "actor", modifications: [{ component: "Health", property: "current", operation: "subtract", value: 10 }] })
- set_state: Change object state (recalculates traits)
- add_trait / remove_trait: Modify semantic traits
- destroy: Remove entity from world
- emit_stimulus: Broadcast perception to nearby agents
- spawn: Create new entity

Example affordance with effects:
defineAffordance({
  name: "eat",
  requires: ["edible"],
  effects: [
    { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 30 }] },
    { type: "destroy", target: "target" }
  ]
})

WORLD RULES (declarative behaviors):
Rules check conditions each tick and execute effects on matching entities.
defineRule({
  name: "torch_burns_out",
  when: { event: "tick", condition: { has: ["burning"] } },
  then: [{ action: "modify_value", target: "self", params: { component: "fuel", field: "current", delta: -0.1 } }]
})

WORLDSCHEMA TOOLS:
- spawn(type, name, properties?, roomName?, state?, componentOverrides?) - Create entity WITH components
- defineObjectType(..., defaultComponents) - Define prefab with components for game systems
- defineAffordance(..., effects) - Define action with REAL effects on game state
- defineRule(...) - Define declarative world rule
- listObjectTypes/listAffordances/listRules - Query the schema
- getObjectTraits/getAvailableActions - Query entity state
- transitionObjectState(entityName, newState) - Change object state

VOCABULARY TOOLS (World-specific affordances, traits, and relationships):
- createAffordance(name, description, requires, effects?, category?) - Register a new affordance (auto-registers missing traits)
- createTrait(name, description, category, enablesAffordances?, incompatibleWith?) - Register a new trait
- createRelationshipType(name, description, dataFields?, isExclusive?, autoRemoveSubject?) - Register a social/dynamic relationship type
- addEntityRelationship(subjectEid, relationName, targetEid, data?) - Add a relationship between two entities
- listVocabulary() - List all registered affordances, traits, and relationship types

CRITICAL: Affordances MUST have effects[] to actually change the world. Without effects, the action is logged but nothing happens.
Effect types:
- modify_component: Change a value (e.g., reduce actor's energy, increase target's damage)
  Example: { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 30 }] }
- spawn: Create a new entity in the world (e.g., forge creates a Sword, build creates a House)
  Example: { type: "spawn", spawnType: "Sword", spawnName: "Iron Sword", containerName: "room" }
- destroy: Remove the target entity (e.g., eating food destroys it)
  Example: { type: "destroy", target: "target" }
- set_state: Change object state (e.g., door: closed → open, ore: raw → smelted)
  Example: { type: "set_state", target: "target", state: "open" }
- add_trait/remove_trait: Change what actions are available on an entity
  Example: { type: "add_trait", target: "target", trait: "sharpened" }
- emit_stimulus: Notify nearby agents about what happened
  Example: { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} forges a sword at {target}!", stimulusType: "observation" }
- transfer: Move item to a container/inventory
  Example: { type: "transfer", target: "actor", containerName: "room" }

EVERY affordance should have at least an emit_stimulus so other agents can see what happened.

VOCABULARY GENERATION (during world creation):
After creating rooms, agents, and objects, generate vocabulary appropriate to this world's setting.

Affordances MUST have effects that actually change the world state:

Example — a medieval world needs these affordances:
  createAffordance({
    name: "forge_weapon", requires: ["forgeable"], category: "craft",
    description: "Forge a weapon at the anvil",
    effects: [
      { type: "spawn", spawnType: "Weapon", spawnName: "Iron Sword", containerName: "room" },
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 15 }] },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} forges a weapon at {target}!", stimulusType: "observation" }
    ]
  })
  createAffordance({
    name: "eat", requires: ["edible"], category: "survival",
    description: "Eat food to reduce hunger",
    effects: [
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "hunger", operation: "subtract", value: 30 }] },
      { type: "destroy", target: "target" },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} eats {target}.", stimulusType: "observation" }
    ]
  })
  createAffordance({
    name: "build_house", requires: ["buildable"], category: "construction",
    description: "Build a wooden house on this land",
    effects: [
      { type: "spawn", spawnType: "House", spawnName: "Wooden House", containerName: "room", spawnProperties: { traits: ["shelter", "door"] } },
      { type: "modify_component", target: "actor", modifications: [{ component: "Needs", property: "energy", operation: "subtract", value: 30 }] },
      { type: "remove_trait", target: "target", trait: "buildable" },
      { type: "emit_stimulus", target: "nearby", stimulusContent: "{actor} builds a house!", stimulusType: "observation" }
    ]
  })

Also create:
- TRAITS that objects would have (forgeable, edible, buildable, locked, sacred...)
- RELATIONSHIP TYPES for social dynamics (GuildMember, OwesDebtTo, RivalOf, MentorOf...)

CURRENT WORLD STATE:
${buildCurrentWorldContext(state)}

${formatMemoryForPrompt(state)}`;
}

function buildCommandSystemPrompt(state: GodAgentState): string {
  const worldName = GodAgent.worldName[state.eid];
  const narrative = GodAgent.narrative[state.eid];

  return `You are GodAI, the overseer of the simulated world "${worldName}".

You MUST use tool calls to implement the user's command.

GROUNDING RULES:
- Only refer to entities that exist (use listEntities/queryEntities to verify).
- Prefer deterministic changes (systems/rules) over one-off narration.
- Keep outputs minimal; tool calls are the primary output.

NOTE ON LONG TASKS:
- bakeNewSystem queues async baking and returns a taskId (it does NOT wait for completion).
- Use getTaskStatus to poll until status is "completed" (or "failed"), then activateSystem (or pass activateOnComplete: true).

DEFINITION OF DONE (do not stop early):
- Verify your changes with tool calls (listSystems/listRules/listObjectTypes/queryEntities).
- If the command requires baked systems, wait for the bake tasks to complete and confirm they are present/active.
- When building a new world, also create vocabulary (createAffordance, createTrait, createRelationshipType) appropriate to the setting.

${narrative ? `NARRATIVE CONTEXT:\n${narrative}\n` : ""}WORLD SNAPSHOT:
${buildCurrentWorldContext(state)}

MEMORY (recent):
${formatMemoryForPrompt(state)}`;
}

function buildTools(state: GodAgentState) {
  const componentNames = Object.keys(AllComponents) as [string, ...string[]];
  const relationNames = Object.keys(AllRelations) as [string, ...string[]];

  return {
    createAgent: tool({
      description:
        "Create a new cognitive agent entity with a name, role, system prompt, and optional room placement",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the agent"),
        role: z.string().describe("The agent's role/personality description"),
        systemPrompt: z
          .string()
          .describe("Instructions defining how the agent thinks and behaves"),
        description: z
          .string()
          .optional()
          .describe("Physical or contextual description"),
        roomName: z
          .string()
          .optional()
          .describe("Name of room to place agent in"),
      }),
      execute: async (params) => {
        const result = state.tools.createAgent(params);
        if (result.success && result.result?.entityId) {
          // Auto-assign behavior policy based on role, using actual room names
          const eid = result.result.entityId;
          const role = params.role || "";
          const { template, params: inferredParams } = inferPolicyFromRole(role);
          // Use the agent's actual room as the workplace/home so templates don't reference non-existent rooms
          const policyParams = {
            ...inferredParams,
            room: params.roomName || inferredParams?.room,
            workplace: params.roomName || inferredParams?.workplace,
            // For guard patrol, use all known rooms from the world
            rooms: inferredParams?.rooms || (() => {
              const roomEids = Array.from(query(state.world, [Room as any, Name as any]));
              return roomEids.map((r: number) => String(Name.value[r] || "")).filter(Boolean);
            })(),
          };
          const tree = getPolicyTemplate(template, policyParams);
          if (tree) {
            setAgentBehaviorPolicy(state.world, eid, tree);
            console.log(`[Tool] createAgent: ${params.name} (policy: ${template}, room: ${policyParams.room || "none"})`);
          } else {
            console.log(`[Tool] createAgent: ${params.name} (no policy)`);
          }
        } else {
          console.log(`[Tool] createAgent: ${params.name}`);
        }
        return result;
      },
    }),

    createEntity: tool({
      description:
        "Create a mechanical entity driven by systems (NOT cognitive). Use for cells, neurons, particles, planets - things that don't think but respond to systems.",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the entity"),
        description: z
          .string()
          .optional()
          .describe("Description of the entity"),
        roomName: z
          .string()
          .optional()
          .describe("Name of room to place entity in"),
        initialArousal: z
          .number()
          .optional()
          .describe("Initial arousal/energy level (0-1)"),
        mode: z
          .string()
          .optional()
          .describe(
            "Initial mode state (e.g., 'resting', 'active', 'refractory')"
          ),
      }),
      execute: async (params) => {
        const result = state.tools.createEntity(params);
        console.log(`[Tool] createEntity: ${params.name}`);
        return result;
      },
    }),

    createRoom: tool({
      description:
        "Create an EMPTY room/location entity. Use createAndPopulateRoom instead for furnished rooms.",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the room"),
        description: z.string().optional().describe("Description of the room"),
        capacity: z.number().optional().describe("Maximum occupancy"),
        ambience: z
          .string()
          .optional()
          .describe("The mood/atmosphere of the room"),
      }),
      execute: async (params) => {
        const result = state.tools.createRoom(params);
        console.log(`[Tool] createRoom: ${params.name}`);
        return result;
      },
    }),

    createAndPopulateRoom: tool({
      description:
        "PREFERRED: Create a room AND delegate to The Steward to populate it with appropriate entities (furniture, tools, resources). This ensures the room description matches actual entities - agents will only perceive things that exist.",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the room"),
        roomType: z
          .string()
          .describe(
            "Type of room: bakery, blacksmith, tavern, library, herbalist, bedroom, etc."
          ),
        description: z
          .string()
          .optional()
          .describe("Optional description hint"),
        capacity: z.number().optional().describe("Maximum occupancy"),
        ambience: z.string().optional().describe("The mood/atmosphere"),
        context: z
          .object({
            worldTheme: z
              .string()
              .optional()
              .describe("e.g., 'medieval fantasy', 'cyberpunk'"),
            economyLevel: z
              .enum(["poor", "modest", "prosperous", "wealthy"])
              .optional(),
            primaryFunction: z
              .string()
              .optional()
              .describe("What the room is for"),
            inhabitants: z
              .array(z.string())
              .optional()
              .describe("Who will use this room"),
          })
          .optional(),
        constraints: z
          .object({
            maxItems: z.number().optional().describe("Limit number of items"),
            requiredItems: z
              .array(z.string())
              .optional()
              .describe("Must include these"),
            budgetLevel: z.enum(["sparse", "normal", "abundant"]).optional(),
          })
          .optional(),
      }),
      execute: async (params) => {
        const result = state.tools.createAndPopulateRoom(params);
        console.log(
          `[Tool] createAndPopulateRoom: ${params.name} (${params.roomType}) - queued for The Steward`
        );
        return result;
      },
    }),

    createObject: tool({
      description: "Create a physical object entity with optional traits for the affordance system (e.g. food, drinkable, examinable, takeable, sleepable, workable, talkable)",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the object"),
        description: z
          .string()
          .optional()
          .describe("Description of the object"),
        material: z.string().optional().describe("What the object is made of"),
        weight: z.number().optional().describe("Weight in kg"),
        portable: z.boolean().optional().describe("Can the object be moved"),
        roomName: z
          .string()
          .optional()
          .describe("Name of room to place object in"),
        traits: z
          .array(z.string())
          .optional()
          .describe("Trait tags for the affordance system: food, drinkable, examinable, takeable, sleepable, workable, talkable"),
      }),
      execute: async (params) => {
        const result = state.tools.createObject(params);
        console.log(`[Tool] createObject: ${params.name}`);
        return result;
      },
    }),

    createStimulusSource: tool({
      description:
        "Create an entity that periodically emits stimuli to nearby agents",
      inputSchema: z.object({
        name: z.string().describe("Unique name"),
        stimulusType: z
          .string()
          .describe("Type: auditory, visual, environmental, etc."),
        template: z
          .string()
          .describe("The content/description of the stimulus"),
        interval: z
          .number()
          .optional()
          .describe("Milliseconds between emissions"),
        roomName: z
          .string()
          .optional()
          .describe("Room where this source is located"),
      }),
      execute: async (params) => {
        const result = state.tools.createStimulusSource(params);
        console.log(`[Tool] createStimulusSource: ${params.name}`);
        return result;
      },
    }),

    addRelation: tool({
      description: "Create a relationship between two entities",
      inputSchema: z.object({
        subjectName: z.string().describe("Name of the subject entity"),
        relationName: z.enum(relationNames).describe("Type of relation"),
        targetName: z.string().describe("Name of the target entity"),
      }),
      execute: async (params) => {
        const result = state.tools.addRelation(params);
        console.log(
          `[Tool] addRelation: ${params.subjectName} --[${params.relationName}]--> ${params.targetName}`
        );
        return result;
      },
    }),

    setComponentValues: tool({
      description:
        "Update component values on an entity (component must already be attached)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to update"),
        values: z.record(z.any()).describe("Key-value pairs to set"),
      }),
      execute: async (params) => {
        const result = state.tools.setComponentValues(params);
        console.log(
          `[Tool] setComponentValues: ${params.entityName}.${params.componentName}`
        );
        return result;
      },
    }),

    addComponent: tool({
      description:
        "Add a built-in component to an entity (can also set initial values)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to add"),
        values: z
          .record(z.any())
          .optional()
          .describe("Optional initial values to set"),
      }),
      execute: async (params) => {
        const result = state.tools.addComponent(params);
        console.log(
          `[Tool] addComponent: ${params.entityName} += ${params.componentName}`
        );
        return result;
      },
    }),

    removeComponent: tool({
      description: "Remove a built-in component from an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to remove"),
      }),
      execute: async (params) => {
        const result = state.tools.removeComponentFromEntity(params);
        console.log(
          `[Tool] removeComponent: ${params.entityName} -= ${params.componentName}`
        );
        return result;
      },
    }),

    queryEntities: tool({
      description: "Query for entities with specific components",
      inputSchema: z.object({
        componentNames: z
          .array(z.string())
          .optional()
          .describe("Required components"),
        notComponentNames: z
          .array(z.string())
          .optional()
          .describe("Excluded components"),
      }),
      execute: async (params) => {
        const result = state.tools.queryEntities(params);
        console.log(
          `[Tool] queryEntities: ${
            (result.result as any[])?.length ?? 0
          } results`
        );
        return result;
      },
    }),

    listEntities: tool({
      description: "List all registered entities in the world",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.tools.listEntities();
        console.log(
          `[Tool] listEntities: ${
            (result.result as any[])?.length ?? 0
          } entities`
        );
        return result;
      },
    }),

    getTaskQueueSummary: tool({
      description:
        "Get async task queue status (pending/running/completed/failed) and a brief list of tasks",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          success: true,
          result: {
            stats: getQueueStats(),
            summary: getQueueSummary(),
            pendingTaskNames: getPendingTaskNames(),
          },
        };
      },
    }),

    getTaskStatus: tool({
      description:
        "Get status/result/error for a queued async task (e.g., from bakeNewSystem)",
      inputSchema: z.object({
        taskId: z.string().describe("Task id returned by bakeNewSystem"),
      }),
      execute: async (params) => {
        const task = getTaskStatus(params.taskId);
        if (!task) {
          return { success: false, result: null, error: "Task not found" };
        }
        return {
          success: true,
          result: {
            id: task.id,
            name: task.name,
            priority: task.priority,
            status: task.status,
            queuedAt: task.queuedAt,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            result: task.status === "completed" ? task.result : undefined,
            error: task.status === "failed" ? task.error : undefined,
          },
        };
      },
    }),

    getComponentValues: tool({
      description: "Get component values from an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.enum(componentNames).describe("Component to read"),
        properties: z
          .array(z.string())
          .optional()
          .describe("Specific properties to get"),
      }),
      execute: async (params) => {
        const result = state.tools.getComponentValues(params);
        console.log(
          `[Tool] getComponentValues: ${params.entityName}.${params.componentName}`
        );
        return result;
      },
    }),

    bakeNewSystem: tool({
      description:
        "Design and create a new system that runs periodically in the world. This queues baking asynchronously (non-blocking). Use getTaskStatus to poll for completion, then activateSystem (or set activateOnComplete).",
      inputSchema: z.object({
        description: z
          .string()
          .describe(
            "Natural language description of what the system should do, what it reacts to, and what effects it has"
          ),
        activateOnComplete: z
          .boolean()
          .optional()
          .describe("If true, activate the system immediately after baking completes"),
        priority: z
          .enum(["critical", "high", "normal", "low"])
          .optional()
          .describe("Async task priority (default: high)"),
      }),
      execute: async (params) => {
        console.log(
          `[Tool] bakeNewSystem: "${params.description.slice(0, 100)}..."`
        );
        const activateOnComplete = params.activateOnComplete ?? false;
        const priority: TaskPriority = params.priority ?? "high";

        const taskId = queueTask(
          `bakeSystem:${params.description.slice(0, 60)}`,
          async () => {
            // Bake against a sandbox world so the bake-time tests don't pollute the live simulation world.
            const sandboxWorld = createArgosWorld("SystemBakeSandbox");
            const result = await bakeSystem(
              params.description,
              sandboxWorld,
              state.systemRegistry
            );
            if (!result.success || !result.system) {
              throw new Error(result.error || "System baking failed");
            }

            state.systemRegistry.systems.set(result.system.name, result.system);
            if (activateOnComplete) {
              activateSystem(state.systemRegistry, result.system.name);
            }

            return {
              name: result.system.name,
              description: result.system.description,
              frequency: result.system.frequency,
              activated: activateOnComplete,
            };
          },
          { priority }
        );

        return {
          success: true,
          result: {
            taskId,
            status: "queued",
            activateOnComplete,
          },
        };
      },
    }),

    modifyBakedSystem: tool({
      description:
        "Modify an existing baked (in-memory) system using natural language. Describe what changes you want to make.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the baked system to modify"),
        modification: z
          .string()
          .describe("Natural language description of how to change the system"),
      }),
      execute: async (params) => {
        console.log(
          `[Tool] modifyBakedSystem: ${
            params.systemName
          } - "${params.modification.slice(0, 100)}..."`
        );
        const result = await modifySystem(
          params.systemName,
          params.modification,
          state.world,
          state.systemRegistry
        );
        if (result.success) {
          return {
            success: true,
            result: {
              name: params.systemName,
              status: "modified successfully",
            },
          };
        }
        return { success: false, result: null, error: result.error };
      },
    }),

    listSystems: tool({
      description: "List all available systems and their status",
      inputSchema: z.object({}),
      execute: async () => {
        const systems = listSystems(state.systemRegistry);
        return {
          success: true,
          result: systems.map((s) => ({
            name: s.name,
            description: s.description,
            frequency: s.frequency,
            active: s.active,
          })),
        };
      },
    }),

    activateSystem: tool({
      description:
        "Activate a system so it runs periodically. Works for both baked systems and file-based systems.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to activate"),
      }),
      execute: async (params) => {
        // Try baked systems first
        let success = activateSystem(state.systemRegistry, params.systemName);

        // Also check file-based systems
        const fileSystem = state.fileSystems.find(
          (s) => s.name === params.systemName
        );
        if (fileSystem) {
          fileSystem.active = true;
          success = true;
        }

        console.log(
          `[Tool] activateSystem: ${params.systemName} -> ${success}`
        );
        return { success, result: { activated: params.systemName } };
      },
    }),

    deactivateSystem: tool({
      description:
        "Deactivate a system so it stops running. Works for both baked systems and file-based systems.",
      inputSchema: z.object({
        systemName: z.string().describe("Name of the system to deactivate"),
      }),
      execute: async (params) => {
        // Try baked systems first
        let success = deactivateSystem(state.systemRegistry, params.systemName);

        // Also check file-based systems
        const fileSystem = state.fileSystems.find(
          (s) => s.name === params.systemName
        );
        if (fileSystem) {
          fileSystem.active = false;
          success = true;
        }

        console.log(
          `[Tool] deactivateSystem: ${params.systemName} -> ${success}`
        );
        return { success, result: { deactivated: params.systemName } };
      },
    }),

    createSystem: tool({
      description: `Create a new deterministic ECS system that runs every tick. The system will be written to a file and loaded dynamically.

IMPORTANT: The code should be the BODY of the run function only (not the function declaration).

Available in ctx:
- ctx.tick, ctx.delta - timing info
- ctx.query(world, [Component1, Component2]) - query entities (ONLY works with built-in components!)
- ctx.addComponent(world, eid, Component) - add component to entity
- ctx.removeEntity(world, eid) - remove entity
- ctx.getRelationTargets(world, eid, Relation) - get relation targets
- ctx.components.{Name, Agent, Needs, Interactable, CurrentAction, Room, GridPosition, etc.}
- ctx.relations.{LocatedIn, StimulusInRoom, etc.}
- ctx.dynamicComponents - Map of all dynamic components
- ctx.getDynamic(name) - get a dynamic component by name (returns component or undefined)
- ctx.hasDynamic(eid, name) - check if entity has dynamic component data
- ctx.log(message) - log to system output
- ctx.emit(type, data) - emit event

⚠️ CRITICAL: Dynamic components CANNOT be used in ctx.query()!
Dynamic components are NOT bitECS components - they're separate data stores.
You MUST query by built-in components, then filter by dynamic data.

EXAMPLE 1 - Using built-in components (decay system):
const { Needs, Agent, Name } = ctx.components;
const agents = Array.from(ctx.query(world, [Agent, Needs]));
for (const eid of agents) {
  Needs.hunger[eid] = Math.min(100, (Needs.hunger[eid] ?? 50) + 1);
  if (Needs.hunger[eid] >= 80) {
    ctx.log(\`\${Name.value[eid]} is hungry!\`);
  }
}

EXAMPLE 2 - Using dynamic components (temperature system):
⚠️ NOTE: Query by Name (built-in), then check for dynamic data!
const Temperature = ctx.getDynamic("Temperature");
if (!Temperature) return;
const { Name } = ctx.components;
// Query by built-in component Name, NOT by Temperature!
const entities = Array.from(ctx.query(world, [Name]));
for (const eid of entities) {
  // Check if this entity has Temperature data
  const current = Temperature.current[eid];
  if (current === undefined) continue; // Skip entities without Temperature
  const target = Temperature.target[eid] ?? current;
  const rate = Temperature.rate[eid] ?? 1;
  if (current !== target) {
    const diff = target - current;
    Temperature.current[eid] = current + Math.sign(diff) * Math.min(rate, Math.abs(diff));
    if (Temperature.current[eid] > 50) {
      ctx.emit("overheat", { entity: Name.value[eid], temp: Temperature.current[eid] });
    }
  }
}

WRONG - DO NOT DO THIS:
// const entities = ctx.query(world, [Name, Temperature]); // BROKEN! Temperature is dynamic!

RIGHT - DO THIS INSTEAD:
// const entities = ctx.query(world, [Name]).filter(eid => ctx.hasDynamic(eid, "Temperature"));`,
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "PascalCase name for the system (e.g., 'NeedsDecay', 'SeekFood')"
          ),
        description: z.string().describe("What the system does"),
        frequency: z
          .number()
          .optional()
          .describe(
            "How often to run (1=every tick, 5=every 5 ticks). Default 1"
          ),
        code: z
          .string()
          .describe(
            "The TypeScript code for the system body (inside the run function)"
          ),
      }),
      execute: async (params) => {
        try {
          const filePath = await writeSystemFile({
            name: params.name,
            description: params.description,
            frequency: params.frequency ?? 1,
            code: params.code,
          });
          const loaded = await loadSystemFromFile(filePath);
          if (loaded) {
            const preflight = await preflightValidateSystem(loaded, { ticks: 2 });
            if (!preflight.ok) {
              loaded.active = false;
              console.log(`[Tool] createSystem preflight failed: ${params.name}`);
              return {
                success: false,
                result: null,
                error: `Preflight validation failed for ${params.name}: ${preflight.error || "unknown error"}`,
              };
            }
            state.fileSystems.push(loaded);
          }
          console.log(`[Tool] createSystem: ${params.name} -> ${filePath}`);
          return {
            success: true,
            result: {
              name: params.name,
              filePath,
              loaded: !!loaded,
            },
          };
        } catch (error) {
          console.error(`[Tool] createSystem failed:`, error);
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    modifyFileSystem: tool({
      description: `Modify an existing file-based system. You can update its code, description, or frequency.

IMPORTANT: The 'code' parameter should be ONLY the function body (the code inside the run function), NOT the full file.
Do NOT include imports, exports, or function declarations - just the code that goes inside the run function.

Use getSystemCode first to see the current system implementation before modifying.`,
      inputSchema: z.object({
        systemName: z
          .string()
          .describe("PascalCase name of the system to modify"),
        description: z
          .string()
          .optional()
          .describe("New description (keeps old if not provided)"),
        frequency: z
          .number()
          .optional()
          .describe("New frequency (keeps old if not provided)"),
        code: z
          .string()
          .optional()
          .describe(
            "New code body ONLY - just the code inside the run function, no imports/exports"
          ),
      }),
      execute: async (params) => {
        try {
          const updated = await updateSystemFile(params.systemName, {
            description: params.description,
            frequency: params.frequency,
            code: params.code,
          });
          if (!updated) {
            return {
              success: false,
              result: null,
              error: `System not found: ${params.systemName}`,
            };
          }
          const idx = state.fileSystems.findIndex(
            (s) => s.name === params.systemName
          );
          if (idx >= 0) {
            state.fileSystems[idx] = updated;
          } else {
            state.fileSystems.push(updated);
          }
          console.log(`[Tool] modifyFileSystem: ${params.systemName}`);
          return {
            success: true,
            result: { name: params.systemName, updated: true },
          };
        } catch (error) {
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    deleteSystem: tool({
      description: "Delete a file-based system",
      inputSchema: z.object({
        systemName: z
          .string()
          .describe("PascalCase name of the system to delete"),
      }),
      execute: async (params) => {
        const deleted = await deleteSystemFile(params.systemName);
        if (deleted) {
          state.fileSystems = state.fileSystems.filter(
            (s) => s.name !== params.systemName
          );
        }
        console.log(`[Tool] deleteSystem: ${params.systemName} -> ${deleted}`);
        return { success: deleted, result: { deleted: params.systemName } };
      },
    }),

    getSystemCode: tool({
      description:
        "Get the source code of a file-based system to review or modify it",
      inputSchema: z.object({
        systemName: z.string().describe("PascalCase name of the system"),
      }),
      execute: async (params) => {
        const source = await getSystemSource(params.systemName);
        if (!source) {
          return {
            success: false,
            result: null,
            error: `System not found: ${params.systemName}`,
          };
        }
        return { success: true, result: { name: params.systemName, source } };
      },
    }),

    listFileSystems: tool({
      description: "List all file-based systems currently loaded",
      inputSchema: z.object({}),
      execute: async () => {
        return {
          success: true,
          result: state.fileSystems.map((s) => ({
            name: s.name,
            description: s.description,
            frequency: s.frequency,
            active: s.active,
          })),
        };
      },
    }),

    createComponent: tool({
      description:
        "Create a new custom component type that can be attached to entities",
      inputSchema: z.object({
        name: z
          .string()
          .describe(
            "PascalCase name for the component (e.g., 'Temperature', 'Mood')"
          ),
        description: z.string().describe("What this component represents"),
        properties: z
          .record(z.enum(["number", "string", "boolean"]))
          .describe("Property names and their types"),
      }),
      execute: async (params) => {
        try {
          const def: ComponentDefinition = {
            name: params.name,
            description: params.description,
            properties: params.properties,
          };
          createDynamicComponent(def);
          await saveComponentDefinition(def);
          console.log(`[Tool] createComponent: ${params.name}`);
          return {
            success: true,
            result: {
              name: params.name,
              properties: Object.keys(params.properties),
            },
          };
        } catch (error) {
          return { success: false, result: null, error: String(error) };
        }
      },
    }),

    setDynamicComponent: tool({
      description: "Set values on a dynamic (custom) component for an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z.string().describe("Name of the dynamic component"),
        values: z.record(z.any()).describe("Property values to set"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }
        const component = getDynamicComponent(params.componentName);
        if (!component) {
          return {
            success: false,
            result: null,
            error: `Dynamic component not found: ${params.componentName}`,
          };
        }
        // Bridge: attach via registry so entity is queryable by this component
        attachToEntity(state.world, eid, params.componentName, params.values);
        // Also write via legacy path for backward compat
        for (const [key, value] of Object.entries(params.values)) {
          setDynamicComponentValue(params.componentName, eid, key, value);
        }
        console.log(
          `[Tool] setDynamicComponent: ${params.entityName}.${params.componentName}`
        );
        return {
          success: true,
          result: {
            entity: params.entityName,
            component: params.componentName,
            values: params.values,
          },
        };
      },
    }),

    getDynamicComponentValues: tool({
      description:
        "Get the current values of a dynamic (custom) component for an entity. Use this to read back component state after systems have modified it.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        componentName: z
          .string()
          .optional()
          .describe(
            "Name of specific component (omit to get all dynamic components)"
          ),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }

        if (params.componentName) {
          const values = getDynamicComponentValues(params.componentName, eid);
          if (!values) {
            return {
              success: false,
              result: null,
              error: `Component not found or not set: ${params.componentName}`,
            };
          }
          console.log(
            `[Tool] getDynamicComponentValues: ${params.entityName}.${params.componentName}`
          );
          return {
            success: true,
            result: {
              entity: params.entityName,
              component: params.componentName,
              values,
            },
          };
        } else {
          const allValues = getAllDynamicComponentValuesForEntity(eid);
          console.log(
            `[Tool] getDynamicComponentValues: ${params.entityName} (all components)`
          );
          return {
            success: true,
            result: { entity: params.entityName, components: allValues },
          };
        }
      },
    }),

    listComponents: tool({
      description:
        "List all available components (both built-in and custom/dynamic) from the unified registry",
      inputSchema: z.object({}),
      execute: async () => {
        const allNames = registryListNames();
        const allDefs = registryListDefinitions();
        const builtIn: string[] = [];
        const dynamic: Array<{ name: string; description: string; properties: Record<string, string> }> = [];

        for (const def of allDefs) {
          if (Object.keys(AllComponents).includes(def.name)) {
            builtIn.push(def.name);
          } else {
            dynamic.push({
              name: def.name,
              description: def.description,
              properties: def.properties,
            });
          }
        }

        return {
          success: true,
          result: { builtIn, dynamic, totalCount: allNames.length },
        };
      },
    }),

    createWorldMap: tool({
      description:
        "Create a grid-based ASCII world map for agents to move around in",
      inputSchema: z.object({
        name: z.string().describe("Unique name for the map"),
        width: z.number().describe("Width of the map in tiles"),
        height: z.number().describe("Height of the map in tiles"),
        fill: z
          .string()
          .optional()
          .describe("Character to fill map with (default '.')"),
      }),
      execute: async (params) => {
        const result = state.tools.createWorldMap(params);
        console.log(
          `[Tool] createWorldMap: ${params.name} (${params.width}x${params.height})`
        );
        return result;
      },
    }),

    drawRoom: tool({
      description: "Draw a room with walls and floor on the ASCII map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("Top-left X coordinate"),
        y: z.number().describe("Top-left Y coordinate"),
        width: z.number().describe("Room width"),
        height: z.number().describe("Room height"),
        floor: z.string().optional().describe("Floor character (default '.')"),
        wall: z.string().optional().describe("Wall character (default '#')"),
      }),
      execute: async (params) => {
        const result = state.tools.drawRoom(params);
        console.log(
          `[Tool] drawRoom: at (${params.x},${params.y}) size ${params.width}x${params.height}`
        );
        return result;
      },
    }),

    drawDoor: tool({
      description: "Add a door (walkable) at a position on the map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      }),
      execute: async (params) => {
        const result = state.tools.drawDoor(params);
        console.log(`[Tool] drawDoor: at (${params.x},${params.y})`);
        return result;
      },
    }),

    drawPath: tool({
      description: "Draw a path/corridor between two points",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x1: z.number().describe("Start X"),
        y1: z.number().describe("Start Y"),
        x2: z.number().describe("End X"),
        y2: z.number().describe("End Y"),
        char: z.string().optional().describe("Path character (default '.')"),
      }),
      execute: async (params) => {
        const result = state.tools.drawPath(params);
        console.log(
          `[Tool] drawPath: (${params.x1},${params.y1}) to (${params.x2},${params.y2})`
        );
        return result;
      },
    }),

    fillArea: tool({
      description: "Fill a rectangular area with a tile character",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("Top-left X"),
        y: z.number().describe("Top-left Y"),
        width: z.number().describe("Area width"),
        height: z.number().describe("Area height"),
        char: z.string().describe("Character to fill with"),
      }),
      execute: async (params) => {
        const result = state.tools.fillArea(params);
        console.log(
          `[Tool] fillArea: (${params.x},${params.y}) ${params.width}x${params.height} with '${params.char}'`
        );
        return result;
      },
    }),

    setTile: tool({
      description: "Set a single tile on the map",
      inputSchema: z.object({
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
        char: z.string().describe("Tile character"),
      }),
      execute: async (params) => {
        const result = state.tools.setTile(params);
        console.log(
          `[Tool] setTile: (${params.x},${params.y}) = '${params.char}'`
        );
        return result;
      },
    }),

    placeEntityOnGrid: tool({
      description:
        "Place an agent or entity on the ASCII grid map at a walkable position",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the agent/entity to place"),
        mapName: z.string().describe("Name of the map"),
        x: z.number().describe("X coordinate (must be walkable)"),
        y: z.number().describe("Y coordinate (must be walkable)"),
        char: z.string().optional().describe("Display character (default '@')"),
        color: z
          .string()
          .optional()
          .describe("Display color (default '#ff6666')"),
        facing: z.string().optional().describe("Initial facing direction"),
      }),
      execute: async (params) => {
        const result = state.tools.placeEntityOnGrid(params);
        console.log(
          `[Tool] placeEntityOnGrid: ${params.entityName} at (${params.x},${params.y})`
        );
        return result;
      },
    }),

    moveEntityOnGrid: tool({
      description:
        "Move an entity one tile in a direction (north/south/east/west)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to move"),
        mapName: z.string().describe("Name of the map"),
        direction: z
          .enum(["north", "south", "east", "west"])
          .describe("Direction to move"),
      }),
      execute: async (params) => {
        const result = state.tools.moveEntityOnGrid(params);
        console.log(
          `[Tool] moveEntityOnGrid: ${params.entityName} ${params.direction}`
        );
        return result;
      },
    }),

    setEntitySprite: tool({
      description: "Change an entity's display character and color on the grid",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        char: z.string().describe("New display character"),
        color: z.string().optional().describe("New display color"),
      }),
      execute: async (params) => {
        const result = state.tools.setEntitySprite(params);
        console.log(
          `[Tool] setEntitySprite: ${params.entityName} = '${params.char}'`
        );
        return result;
      },
    }),

    getEntityPosition: tool({
      description:
        "Get the current grid position of an entity. Returns x, y coordinates and facing direction.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntityPosition(params);
        console.log(`[Tool] getEntityPosition: ${params.entityName}`);
        return result;
      },
    }),

    getEntitiesAtPosition: tool({
      description:
        "Get all entities at a specific grid position. Useful for checking what's at a location.",
      inputSchema: z.object({
        x: z.number().describe("X coordinate"),
        y: z.number().describe("Y coordinate"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntitiesAtPosition(params);
        console.log(`[Tool] getEntitiesAtPosition: (${params.x}, ${params.y})`);
        return result;
      },
    }),

    getEntitiesInRadius: tool({
      description:
        "Get all entities within a radius of a position. Useful for area effects and proximity checks.",
      inputSchema: z.object({
        x: z.number().describe("Center X coordinate"),
        y: z.number().describe("Center Y coordinate"),
        radius: z.number().describe("Radius to search within"),
      }),
      execute: async (params) => {
        const result = state.tools.getEntitiesInRadius(params);
        console.log(
          `[Tool] getEntitiesInRadius: (${params.x}, ${params.y}) r=${params.radius}`
        );
        return result;
      },
    }),

    checkCollision: tool({
      description:
        "Check if an entity can move in a direction. Returns whether the tile is walkable and any entities that would be collided with.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to check"),
        mapName: z.string().describe("Name of the map"),
        direction: z
          .enum(["north", "south", "east", "west"])
          .describe("Direction to check"),
      }),
      execute: async (params) => {
        const result = state.tools.checkCollision(params);
        console.log(
          `[Tool] checkCollision: ${params.entityName} ${params.direction}`
        );
        return result;
      },
    }),

    makePlan: tool({
      description:
        "Create a multi-step plan for achieving a complex goal. Use this to break down large tasks into manageable steps.",
      inputSchema: z.object({
        goal: z.string().describe("The overall goal to achieve"),
        steps: z
          .array(z.string())
          .describe("List of steps to accomplish the goal"),
      }),
      execute: async (params) => {
        const plan = createPlan(state, params.goal, params.steps);
        const firstStep = advancePlan(state);
        console.log(
          `[Tool] makePlan: "${params.goal}" (${params.steps.length} steps)`
        );
        return {
          success: true,
          result: {
            planId: plan.id,
            goal: plan.goal,
            totalSteps: plan.steps.length,
            currentStep: firstStep?.description ?? "Plan complete",
          },
        };
      },
    }),

    advancePlanStep: tool({
      description:
        "Mark the current plan step as complete and advance to the next step. Call this after completing each step of your plan.",
      inputSchema: z.object({
        result: z
          .string()
          .optional()
          .describe("Summary of what was accomplished in this step"),
      }),
      execute: async (params) => {
        const nextStep = advancePlan(state, params.result);
        const plan = getActivePlan(state);
        console.log(
          `[Tool] advancePlanStep: ${nextStep?.description ?? "Plan complete"}`
        );
        return {
          success: true,
          result: {
            planComplete: !plan,
            currentStep: nextStep?.description ?? null,
            stepsRemaining:
              plan?.steps.filter((s) => s.status === "pending").length ?? 0,
          },
        };
      },
    }),

    getActivePlanStatus: tool({
      description: "Check the current status of your active plan",
      inputSchema: z.object({}),
      execute: async () => {
        const plan = getActivePlan(state);
        if (!plan) {
          return { success: true, result: { hasActivePlan: false } };
        }
        return {
          success: true,
          result: {
            hasActivePlan: true,
            goal: plan.goal,
            steps: plan.steps.map((s) => ({
              description: s.description,
              status: s.status,
              result: s.result,
            })),
            completed: plan.steps.filter((s) => s.status === "completed")
              .length,
            total: plan.steps.length,
          },
        };
      },
    }),

    abandonCurrentPlan: tool({
      description:
        "Abandon the current plan if it's no longer relevant or achievable",
      inputSchema: z.object({
        reason: z.string().describe("Why the plan is being abandoned"),
      }),
      execute: async (params) => {
        abandonPlan(state, params.reason);
        console.log(`[Tool] abandonCurrentPlan: ${params.reason}`);
        return {
          success: true,
          result: { abandoned: true, reason: params.reason },
        };
      },
    }),

    recordMemory: tool({
      description:
        "Record an important observation, decision, or reflection for future reference",
      inputSchema: z.object({
        type: z
          .enum(["action", "observation", "decision", "reflection"])
          .describe("Type of memory"),
        content: z.string().describe("What to remember"),
        importance: z
          .number()
          .min(1)
          .max(10)
          .optional()
          .describe("How important (1-10, 7+ persists to long-term)"),
        relatedEntities: z
          .array(z.string())
          .optional()
          .describe("Names of entities this relates to"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags for categorization"),
      }),
      execute: async (params) => {
        const memory = addMemory(state, params.type, params.content, {
          importance: params.importance,
          relatedEntities: params.relatedEntities,
          tags: params.tags,
        });
        console.log(
          `[Tool] recordMemory: [${params.type}] ${params.content.slice(
            0,
            50
          )}...`
        );
        return { success: true, result: { memoryId: memory.id, stored: true } };
      },
    }),

    searchMemories: tool({
      description: "Search your memories for relevant past information",
      inputSchema: z.object({
        type: z
          .enum(["action", "observation", "decision", "reflection"])
          .optional()
          .describe("Filter by memory type"),
        entityName: z
          .string()
          .optional()
          .describe("Filter by related entity name"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        minImportance: z
          .number()
          .optional()
          .describe("Minimum importance level"),
      }),
      execute: async (params) => {
        const memories = searchMemory(state, params);
        console.log(`[Tool] searchMemories: found ${memories.length} memories`);
        return {
          success: true,
          result: memories.slice(0, 20).map((m) => ({
            type: m.type,
            content: m.content,
            importance: m.importance,
            relatedEntities: m.relatedEntities,
            tags: m.tags,
            age: `${Math.round((Date.now() - m.timestamp) / 1000)}s ago`,
          })),
        };
      },
    }),

    reflect: tool({
      description:
        "Take a moment to reflect on the current state and record insights. Use this to consolidate learnings.",
      inputSchema: z.object({
        reflection: z.string().describe("Your reflection or insight"),
      }),
      execute: async (params) => {
        const memory = addMemory(state, "reflection", params.reflection, {
          importance: 8,
          tags: ["reflection", "insight"],
        });
        console.log(`[Tool] reflect: ${params.reflection.slice(0, 50)}...`);
        return {
          success: true,
          result: { recorded: true, memoryId: memory.id },
        };
      },
    }),

    listAvailableSprites: tool({
      description:
        "List available sprite assets. Can filter by tag or search term.",
      inputSchema: z.object({
        tag: z
          .string()
          .optional()
          .describe("Filter by tag (e.g., 'character', 'animal', 'crop')"),
        search: z.string().optional().describe("Search term to find sprites"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.listAvailableSprites(params);
        console.log(`[Tool] listAvailableSprites`);
        return result;
      },
    }),

    getAvailableCharacters: tool({
      description:
        "List all available character sprites with their animations (walk, idle, actions)",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.renderingTools.getAvailableCharacters();
        console.log(`[Tool] getAvailableCharacters`);
        return result;
      },
    }),

    setupCharacterRig: tool({
      description:
        "Set up a character rig for an NPC that maps actions to animations. Once set up, the NPC's actions will automatically trigger appropriate animations.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to set up"),
        baseAtlas: z
          .string()
          .describe("Base sprite atlas ID (e.g., 'farmer_1')"),
        actionAtlases: z
          .record(z.string())
          .optional()
          .describe(
            "Map action names to atlas IDs for action-specific sprites"
          ),
        actionMappings: z
          .record(
            z.object({
              animation: z.string(),
              loop: z.boolean().optional(),
              speed: z.number().optional(),
            })
          )
          .optional()
          .describe("Map action names to animation config"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setupCharacterRig(params);
        console.log(`[Tool] setupCharacterRig: ${params.entityName}`);
        return result;
      },
    }),

    triggerCharacterAction: tool({
      description:
        "Trigger an action animation on a character with a rig. The character will play the mapped animation.",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the character"),
        action: z
          .string()
          .describe("Action to trigger (e.g., 'walk', 'chop', 'idle')"),
        direction: z
          .enum(["up", "down", "left", "right"])
          .optional()
          .describe("Direction to face"),
        targetX: z
          .number()
          .optional()
          .describe("Target X position (auto-calculates direction)"),
        targetY: z
          .number()
          .optional()
          .describe("Target Y position (auto-calculates direction)"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.triggerCharacterAction(params);
        console.log(
          `[Tool] triggerCharacterAction: ${params.entityName} -> ${params.action}`
        );
        return result;
      },
    }),

    setCharacterIdleState: tool({
      description: "Set a character to idle animation",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the character"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setCharacterIdle(params);
        console.log(`[Tool] setCharacterIdle: ${params.entityName}`);
        return result;
      },
    }),

    listCharacterRigs: tool({
      description: "List all character rigs that have been set up",
      inputSchema: z.object({}),
      execute: async () => {
        const result = state.renderingTools.listCharacterRigs();
        console.log(`[Tool] listCharacterRigs`);
        return result;
      },
    }),

    setEntityPixiSprite: tool({
      description:
        "Assign a sprite from the registry to an entity for Pixi.js rendering",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        spriteName: z
          .string()
          .describe("Sprite name (atlasId:frameId or just frameId)"),
        scaleX: z.number().optional().describe("X scale (default 1)"),
        scaleY: z.number().optional().describe("Y scale (default 1)"),
        tint: z
          .number()
          .optional()
          .describe("Color tint as hex (e.g., 0xff0000 for red)"),
        alpha: z.number().optional().describe("Opacity 0-1"),
        zIndex: z.number().optional().describe("Draw order"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setEntitySprite({
          entityName: params.entityName,
          spriteName: params.spriteName,
          options: {
            scaleX: params.scaleX,
            scaleY: params.scaleY,
            tint: params.tint,
            alpha: params.alpha,
            zIndex: params.zIndex,
          },
        });
        console.log(
          `[Tool] setEntityPixiSprite: ${params.entityName} -> ${params.spriteName}`
        );
        return result;
      },
    }),

    setEntityAnimation: tool({
      description: "Set an entity to play a specific animation",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        atlasId: z.string().describe("Atlas containing the animation"),
        animationId: z
          .string()
          .describe("Animation ID (e.g., 'walk_down', 'chop_left')"),
        speed: z.number().optional().describe("Playback speed multiplier"),
        loop: z.boolean().optional().describe("Whether to loop"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.setEntityAnimation({
          entityName: params.entityName,
          atlasId: params.atlasId,
          animationId: params.animationId,
          options: { speed: params.speed, loop: params.loop },
        });
        console.log(
          `[Tool] setEntityAnimation: ${params.entityName} -> ${params.animationId}`
        );
        return result;
      },
    }),

    listAnimations: tool({
      description:
        "List available animations, optionally filtered by atlas or tag",
      inputSchema: z.object({
        atlasId: z.string().optional().describe("Filter by atlas ID"),
        tag: z.string().optional().describe("Filter by tag"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.listAnimations(params);
        console.log(`[Tool] listAnimations`);
        return result;
      },
    }),

    describeEntityAppearance: tool({
      description:
        "Get detailed info about an entity's current visual state (sprite, animation, position)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.describeEntityAppearance(params);
        console.log(`[Tool] describeEntityAppearance: ${params.entityName}`);
        return result;
      },
    }),

    getVisibleEntities: tool({
      description:
        "Get entities visible from a viewer's position within a radius",
      inputSchema: z.object({
        viewerName: z.string().describe("Name of the viewing entity"),
        radius: z.number().optional().describe("View radius (default 10)"),
      }),
      execute: async (params) => {
        const result = state.renderingTools.getVisibleEntities(params);
        console.log(`[Tool] getVisibleEntities: from ${params.viewerName}`);
        return result;
      },
    }),

    // ============ INTERVENTION TOOLS ============
    // Interventions are event-driven precondition→effect rules

    createIntervention: tool({
      description: `Create an intervention - a rule that fires effects when conditions are met.

Interventions are event-driven: they check conditions each tick and execute effects when ALL conditions pass.
This is more efficient than systems for reactive behaviors that only need to act occasionally.

EXAMPLE - Hunger warning:
{
  name: "HungerWarning",
  description: "Warn when agent gets too hungry",
  conditions: [{ targetEntity: "*", component: "Needs", property: "hunger", operator: ">", value: 80 }],
  effects: [{ type: "log", message: "$name is starving!", targetEntity: "$target" }],
  repeatable: true,
  cooldown: 10,
  priority: 5
}

EXAMPLE - Auto-heal:
{
  name: "AutoHeal",
  description: "Heal injured agents slowly",
  conditions: [{ targetEntity: "*", component: "Health", property: "current", operator: "<", value: 100 }],
  effects: [{ type: "setDynamic", targetEntity: "$target", component: "Health", property: "current", value: "$current + 1" }],
  repeatable: true,
  cooldown: 5,
  priority: 3
}`,
      inputSchema: z.object({
        name: z.string().describe("Unique name for the intervention"),
        description: z.string().describe("What this intervention does"),
        conditions: z.array(
          z.object({
            targetEntity: z
              .string()
              .describe(
                "Entity name, '*' for all, or '@Component' for all with component"
              ),
            component: z
              .string()
              .describe("Component to check (built-in or dynamic)"),
            property: z.string().describe("Property to check"),
            operator: z.enum([
              ">",
              "<",
              ">=",
              "<=",
              "==",
              "!=",
              "contains",
              "exists",
            ]),
            value: z
              .any()
              .optional()
              .describe("Value to compare (not needed for 'exists')"),
          })
        ),
        effects: z.array(
          z.object({
            type: z
              .enum(["setComponent", "setDynamic", "log", "emit"])
              .describe("Effect type"),
            targetEntity: z
              .string()
              .describe("Entity name or '$target' for triggering entity"),
            component: z
              .string()
              .optional()
              .describe("Component to modify (for set effects)"),
            property: z.string().optional().describe("Property to set"),
            value: z
              .any()
              .optional()
              .describe("Value to set (use '$current + N' for relative)"),
            message: z
              .string()
              .optional()
              .describe("For log: message (use $name, $value)"),
            eventType: z.string().optional().describe("For emit: event type"),
            eventData: z
              .record(z.any())
              .optional()
              .describe("For emit: event data"),
          })
        ),
        repeatable: z
          .boolean()
          .optional()
          .describe("Fire multiple times? (default true)"),
        cooldown: z
          .number()
          .optional()
          .describe("Ticks between firings (default 1)"),
        priority: z
          .number()
          .optional()
          .describe("Higher = checked first (default 5)"),
        active: z.boolean().optional().describe("Start active? (default true)"),
      }),
      execute: async (params) => {
        const definition: InterventionDefinition = {
          name: params.name,
          description: params.description,
          conditions: params.conditions as InterventionCondition[],
          effects: params.effects as InterventionEffect[],
          repeatable: params.repeatable ?? true,
          cooldown: params.cooldown ?? 1,
          priority: params.priority ?? 5,
          active: params.active ?? true,
        };
        registerIntervention(state.interventionRegistry, definition);
        console.log(`[Tool] createIntervention: ${params.name}`);
        return {
          success: true,
          result: {
            name: params.name,
            conditions: params.conditions.length,
            effects: params.effects.length,
          },
        };
      },
    }),

    listInterventions: tool({
      description: "List all registered interventions and their status",
      inputSchema: z.object({}),
      execute: async () => {
        const interventions = listInterventions(state.interventionRegistry);
        return {
          success: true,
          result: interventions.map((i) => ({
            name: i.name,
            description: i.description,
            conditions: i.conditions.length,
            effects: i.effects.length,
            repeatable: i.repeatable,
            cooldown: i.cooldown,
            active: i.active,
            priority: i.priority,
          })),
        };
      },
    }),

    activateIntervention: tool({
      description: "Activate an intervention so it starts checking conditions",
      inputSchema: z.object({
        name: z.string().describe("Name of the intervention"),
      }),
      execute: async (params) => {
        const success = activateIntervention(
          state.interventionRegistry,
          params.name
        );
        console.log(
          `[Tool] activateIntervention: ${params.name} -> ${success}`
        );
        return { success, result: { activated: params.name } };
      },
    }),

    deactivateIntervention: tool({
      description: "Deactivate an intervention to stop it from firing",
      inputSchema: z.object({
        name: z.string().describe("Name of the intervention"),
      }),
      execute: async (params) => {
        const success = deactivateIntervention(
          state.interventionRegistry,
          params.name
        );
        console.log(
          `[Tool] deactivateIntervention: ${params.name} -> ${success}`
        );
        return { success, result: { deactivated: params.name } };
      },
    }),

    removeIntervention: tool({
      description: "Remove an intervention entirely",
      inputSchema: z.object({
        name: z.string().describe("Name of the intervention to remove"),
      }),
      execute: async (params) => {
        const success = unregisterIntervention(
          state.interventionRegistry,
          params.name
        );
        console.log(`[Tool] removeIntervention: ${params.name} -> ${success}`);
        return { success, result: { removed: params.name } };
      },
    }),

    getInterventionLogs: tool({
      description: "Get recent logs from intervention executions",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Max logs to return (default 20)"),
      }),
      execute: async (params) => {
        const limit = params.limit ?? 20;
        const logs = state.interventionRegistry.logs.slice(-limit);
        return {
          success: true,
          result: { logs, total: state.interventionRegistry.logs.length },
        };
      },
    }),

    getInterventionEvents: tool({
      description: "Get events emitted by interventions",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Max events to return (default 20)"),
        eventType: z.string().optional().describe("Filter by event type"),
      }),
      execute: async (params) => {
        const limit = params.limit ?? 20;
        let events = state.interventionRegistry.events;
        if (params.eventType) {
          events = events.filter((e) => e.type === params.eventType);
        }
        return {
          success: true,
          result: { events: events.slice(-limit), total: events.length },
        };
      },
    }),

    // ============ PROPOSITION TOOLS ============
    // Propositions are claims about entities that can be validated and scored

    createProposition: tool({
      description: `Create a proposition - a claim about entities that can be validated and scored.

Propositions let you define criteria for entity states and check if they're met.
Each check contributes to an overall score (0-9) based on its weight.

EXAMPLE - Agent health check:
{
  name: "AgentIsHealthy",
  claim: "Agent has healthy vital signs",
  target: "*",  // Check all entities
  checks: [
    { component: "Needs", property: "hunger", operator: "<", value: 70, weight: 0.3, description: "Not too hungry" },
    { component: "Needs", property: "energy", operator: ">", value: 30, weight: 0.4, description: "Has energy" },
    { component: "Needs", property: "social", operator: ">", value: 20, weight: 0.3, description: "Not isolated" }
  ],
  passThreshold: 5,
  category: "agent_health"
}

EXAMPLE - Temperature in range:
{
  name: "SafeTemperature",
  claim: "Entity temperature is in safe range",
  target: "@Temperature",  // All entities with Temperature component
  checks: [
    { component: "Temperature", property: "current", operator: "in_range", min: 20, max: 80, weight: 1.0, description: "Temp 20-80" }
  ],
  passThreshold: 9,
  category: "simulation_health"
}`,
      inputSchema: z.object({
        name: z.string().describe("Unique name for the proposition"),
        claim: z.string().describe("Natural language claim being validated"),
        target: z
          .string()
          .describe(
            "Entity name, '*' for all, or '@Component' for all with component"
          ),
        checks: z.array(
          z.object({
            component: z.string().describe("Component to check"),
            property: z.string().describe("Property to check"),
            operator: z.enum([
              ">",
              "<",
              ">=",
              "<=",
              "==",
              "!=",
              "contains",
              "exists",
              "in_range",
            ]),
            value: z.any().optional().describe("Value for comparison"),
            min: z.number().optional().describe("Min for in_range"),
            max: z.number().optional().describe("Max for in_range"),
            weight: z.number().describe("Weight 0-1 for this check"),
            description: z.string().describe("What this check validates"),
          })
        ),
        passThreshold: z.number().describe("Minimum score (0-9) to pass"),
        category: z
          .string()
          .describe(
            "Category for grouping (e.g., 'agent_health', 'simulation_health')"
          ),
      }),
      execute: async (params) => {
        const definition: PropositionDefinition = {
          name: params.name,
          claim: params.claim,
          target: params.target,
          checks: params.checks as PropositionCheck[],
          passThreshold: params.passThreshold,
          category: params.category,
        };
        registerProposition(state.propositionRegistry, definition);
        console.log(`[Tool] createProposition: ${params.name}`);
        return {
          success: true,
          result: {
            name: params.name,
            checks: params.checks.length,
            category: params.category,
          },
        };
      },
    }),

    listPropositions: tool({
      description: "List all registered propositions",
      inputSchema: z.object({}),
      execute: async () => {
        const propositions = listPropositions(state.propositionRegistry);
        return {
          success: true,
          result: propositions.map((p) => ({
            name: p.name,
            claim: p.claim,
            target: p.target,
            checks: p.checks.length,
            passThreshold: p.passThreshold,
            category: p.category,
          })),
        };
      },
    }),

    evaluatePropositionTool: tool({
      description:
        "Evaluate a specific proposition against the world and get detailed results",
      inputSchema: z.object({
        propositionName: z
          .string()
          .describe("Name of the proposition to evaluate"),
      }),
      execute: async (params) => {
        const results = evaluateProposition(
          state.world,
          state.propositionRegistry,
          params.propositionName
        );
        console.log(
          `[Tool] evaluateProposition: ${params.propositionName} -> ${results.length} results`
        );
        return {
          success: true,
          result: results.map((r) => ({
            target: r.target,
            passed: r.passed,
            score: r.score,
            checkResults: r.checkResults,
          })),
        };
      },
    }),

    evaluateAllPropositionsTool: tool({
      description: "Evaluate all propositions and get a summary",
      inputSchema: z.object({}),
      execute: async () => {
        const allResults = evaluateAllPropositions(
          state.world,
          state.propositionRegistry
        );
        const summary: Record<
          string,
          { passed: number; failed: number; avgScore: number }
        > = {};

        for (const [name, results] of allResults) {
          const passed = results.filter((r) => r.passed).length;
          const avgScore =
            results.length > 0
              ? results.reduce((sum, r) => sum + r.score, 0) / results.length
              : 0;
          summary[name] = {
            passed,
            failed: results.length - passed,
            avgScore: Math.round(avgScore * 10) / 10,
          };
        }

        console.log(
          `[Tool] evaluateAllPropositions: ${allResults.size} propositions evaluated`
        );
        return { success: true, result: summary };
      },
    }),

    getValidationReport: tool({
      description:
        "Get a category-level validation report showing overall health of the simulation",
      inputSchema: z.object({}),
      execute: async () => {
        // First evaluate all propositions to update scores
        evaluateAllPropositions(state.world, state.propositionRegistry);
        const report = getCategoryReport(state.propositionRegistry);
        console.log(
          `[Tool] getValidationReport: ${Object.keys(report).length} categories`
        );
        return { success: true, result: report };
      },
    }),

    getPropositionHistoryTool: tool({
      description: "Get historical proposition evaluation results",
      inputSchema: z.object({
        propositionName: z
          .string()
          .optional()
          .describe("Filter by proposition name"),
        targetEntity: z.string().optional().describe("Filter by entity name"),
        category: z.string().optional().describe("Filter by category"),
        passedOnly: z.boolean().optional().describe("Only show passed results"),
        failedOnly: z.boolean().optional().describe("Only show failed results"),
        limit: z.number().optional().describe("Max results to return"),
      }),
      execute: async (params) => {
        const history = getPropositionHistory(
          state.propositionRegistry,
          params
        );
        return {
          success: true,
          result: history.map((r) => ({
            proposition: r.proposition,
            target: r.target,
            passed: r.passed,
            score: r.score,
            timestamp: r.timestamp,
          })),
        };
      },
    }),

    removeProposition: tool({
      description: "Remove a proposition",
      inputSchema: z.object({
        name: z.string().describe("Name of the proposition to remove"),
      }),
      execute: async (params) => {
        const success = unregisterProposition(
          state.propositionRegistry,
          params.name
        );
        console.log(`[Tool] removeProposition: ${params.name} -> ${success}`);
        return { success, result: { removed: params.name } };
      },
    }),

    // ============ WORLD SCHEMA TOOLS ============
    // Tools for defining object types, affordances, rules, and spawning from prefabs

    spawn: tool({
      description: `Spawn an entity from a defined object type (prefab). Creates a REAL ECS entity with:
- All traits from the object type (for affordance system)
- All defaultComponents defined in the type (for game systems)
- Component values can be overridden via componentOverrides

EXAMPLE - Simple spawn:
spawn({ type: "bed", name: "Grand Oak Bed", properties: { adjective: "ornate", material: "oak" }, roomName: "Bedroom" })

EXAMPLE - Spawn with component data for simulation:
spawn({
  type: "rabbit",
  name: "Rabbit 1",
  componentOverrides: {
    "Health": { current: 80, max: 100 },
    "Movement": { speed: 3 }
  }
})

Available base types: bed, chair, table, chest, door, torch, food_item, npc, room
Custom types defined via defineObjectType can include defaultComponents for systems.`,
      inputSchema: z.object({
        type: z
          .string()
          .describe("Object type name (e.g., 'bed', 'chest', 'rabbit')"),
        name: z.string().describe("Unique name for this instance"),
        properties: z
          .record(z.string())
          .optional()
          .describe("Template properties like {adjective, material}"),
        roomName: z.string().optional().describe("Room to place the entity in"),
        state: z
          .string()
          .optional()
          .describe("Initial state (uses defaultState if not provided)"),
        componentOverrides: z
          .record(z.record(z.any()))
          .optional()
          .describe(
            "Override component values: { ComponentName: { prop: value } }"
          ),
      }),
      execute: async (params) => {
        const objectType = state.worldSchema.getObjectType(params.type);
        if (!objectType) {
          return {
            success: false,
            result: null,
            error: `Unknown object type: ${params.type}. Use listObjectTypes to see available types.`,
          };
        }

        // Determine initial state (before entity creation so description can reflect state)
        const initialState = params.state || objectType.defaultState;
        const stateData = objectType.states[initialState];
        const templateVars = { ...(params.properties || {}), name: params.name };

        // Create the entity
        const createResult = state.tools.createEntity({
          name: params.name,
          description: interpolateTemplate(
            stateData?.description || objectType.description,
            templateVars
          ),
        });

        if (!createResult.success) {
          return createResult;
        }

        const eid = state.registry.byName.get(params.name);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: "Entity was created but not found in registry",
          };
        }

        // Canonical object identity/state/traits in ECS components
        state.tools.setComponentValues({
          entityName: params.name,
          componentName: "ObjectType",
          values: { typeId: params.type, instanceName: params.name },
        });
        state.tools.setComponentValues({
          entityName: params.name,
          componentName: "ObjectState",
          values: { current: initialState, previous: "", lockedUntil: 0 },
        });

        // Combine base traits with state-specific traits (using Set to dedupe)
        const traitSet = new Set(objectType.traits);
        if (stateData?.traits) {
          stateData.traits.forEach((t) => traitSet.add(t));
        }
        if (stateData?.blockedTraits) {
          stateData.blockedTraits.forEach((t) => traitSet.delete(t));
        }
        const allTraits = Array.from(traitSet);
        state.tools.setComponentValues({
          entityName: params.name,
          componentName: "Traits",
          values: { active: JSON.stringify(allTraits) },
        });

        // Legacy mirror for compatibility/debugging
        if (!getDynamicComponent("ObjectMeta")) {
          createDynamicComponent({
            name: "ObjectMeta",
            description: "Legacy mirror of ObjectType/ObjectState/Traits",
            properties: { type: "string", state: "string", traits: "string" },
          });
        }
        setDynamicComponentValue("ObjectMeta", eid, "type", params.type);
        setDynamicComponentValue("ObjectMeta", eid, "state", initialState);
        setDynamicComponentValue("ObjectMeta", eid, "traits", allTraits.join(","));

        // === NEW: Create defaultComponents from object type ===
        const createdComponents: string[] = [];
        if (objectType.defaultComponents) {
          for (const compSpec of objectType.defaultComponents) {
            // Merge default values with any overrides
            const overrides = params.componentOverrides?.[compSpec.name] || {};
            const finalValues = { ...compSpec.values, ...overrides };

            // Built-in ECS component path
            const ecsComponent = (AllComponents as any)[compSpec.name];
            if (ecsComponent) {
              state.tools.setComponentValues({
                entityName: params.name,
                componentName: compSpec.name,
                values: finalValues,
              });
              createdComponents.push(compSpec.name);
              continue;
            }

            // Dynamic component path
            let comp = getDynamicComponent(compSpec.name);
            if (!comp && compSpec.dynamic !== false) {
              const schema = compSpec.schema || inferSchema(compSpec.values);
              createDynamicComponent({
                name: compSpec.name,
                description: `Component for ${params.type} entities`,
                properties: schema,
              });
              comp = getDynamicComponent(compSpec.name);
            }

            if (!comp) continue;
            for (const [prop, value] of Object.entries(finalValues)) {
              setDynamicComponentValue(compSpec.name, eid, prop, value);
            }
            createdComponents.push(compSpec.name);
          }
        }

        // Apply any additional component overrides not in defaultComponents
        if (params.componentOverrides) {
          for (const [compName, values] of Object.entries(
            params.componentOverrides
          )) {
            if (!createdComponents.includes(compName)) {
              // Check if component exists
              let comp = getDynamicComponent(compName);
              if (!comp) {
                // Auto-create from values
                createDynamicComponent({
                  name: compName,
                  description: `Custom component for ${params.name}`,
                  properties: inferSchema(values),
                });
              }
              for (const [prop, value] of Object.entries(values)) {
                setDynamicComponentValue(compName, eid, prop, value);
              }
              createdComponents.push(compName);
            }
          }
        }

        // Place in room if specified
        if (params.roomName) {
          state.tools.addRelation({
            subjectName: params.name,
            relationName: "LocatedIn",
            targetName: params.roomName,
          });
        }

        console.log(
          `[Tool] spawn: ${params.name} (${
            params.type
          }) in state ${initialState}${
            createdComponents.length
              ? ` with [${createdComponents.join(", ")}]`
              : ""
          }`
        );
        return {
          success: true,
          result: {
            name: params.name,
            type: params.type,
            state: initialState,
            traits: allTraits,
            components: createdComponents,
            description: interpolateTemplate(
              objectType.description,
              params.properties || {}
            ),
          },
        };
      },
    }),

    defineObjectType: tool({
      description: `Define a new object type (prefab) that can be spawned. Creates REAL ECS entities with components for game systems.

IMPORTANT: Use defaultComponents to give spawned entities REAL data that systems can query and process!

EXAMPLE - Simple object:
defineObjectType({
  name: "lantern",
  description: "A {adjective} lantern",
  traits: ["lightSource", "portable"],
  states: { lit: { description: "Glowing" }, unlit: { description: "Dark" } },
  defaultState: "unlit",
  category: "lighting"
})

EXAMPLE - Simulation entity with components for systems:
defineObjectType({
  name: "rabbit",
  description: "A {adjective} rabbit",
  traits: ["prey", "edible", "alive", "herbivore"],
  states: {
    active: { description: "Hopping around" },
    resting: { description: "Resting quietly" },
    dead: { description: "Dead", blockedTraits: ["alive"] }
  },
  defaultState: "active",
  category: "creature",
  defaultComponents: [
    { name: "Health", values: { current: 100, max: 100 }, schema: { current: "number", max: "number" } },
    { name: "Energy", values: { current: 80, max: 100, decayRate: 0.5 }, schema: { current: "number", max: "number", decayRate: "number" } },
    { name: "Movement", values: { speed: 2, canMove: true }, schema: { speed: "number", canMove: "boolean" } },
    { name: "Diet", values: { foodType: "grass", hungerThreshold: 30 }, schema: { foodType: "string", hungerThreshold: "number" } }
  ]
})

When you spawn a "rabbit", it will automatically have Health, Energy, Movement, Diet components with data!
Systems can then query: "for (const eid of query(world, [Health, Energy])) { ... }"`,
      inputSchema: z.object({
        name: z
          .string()
          .describe("Unique name for this object type (lowercase)"),
        description: z
          .string()
          .describe("Description template - use {property} for interpolation"),
        traits: z
          .array(z.string())
          .describe("Traits for affordance system (what actions can be done)"),
        states: z
          .record(
            z.object({
              description: z.string(),
              traits: z.array(z.string()).optional(),
              blockedTraits: z.array(z.string()).optional(),
            })
          )
          .describe("Possible states and their configurations"),
        defaultState: z.string().describe("State when first spawned"),
        isContainer: z
          .boolean()
          .optional()
          .describe("Can this contain other objects?"),
        containerCapacity: z
          .number()
          .optional()
          .describe("How many items can it hold?"),
        category: z
          .string()
          .optional()
          .describe("Category (creature, furniture, item, etc)"),
        defaultComponents: z
          .array(
            z.object({
              name: z
                .string()
                .describe("Component name (will be created if doesn't exist)"),
              values: z.record(z.any()).describe("Default property values"),
              schema: z
                .record(z.enum(["number", "string", "boolean"]))
                .optional()
                .describe("Property types (inferred if not provided)"),
            })
          )
          .optional()
          .describe(
            "Components to add when spawned - THIS IS HOW ENTITIES PARTICIPATE IN SYSTEMS"
          ),
      }),
      execute: async (params) => {
        const def: ObjectTypeDefinition = {
          name: params.name,
          description: params.description,
          traits: params.traits,
          states: params.states,
          defaultState: params.defaultState,
          isContainer: params.isContainer,
          containerCapacity: params.containerCapacity,
          category: params.category,
          defaultComponents: params.defaultComponents?.map((c) => ({
            name: c.name,
            values: c.values,
            schema: c.schema,
            dynamic: true,
          })),
        };
        state.worldSchema.defineObjectType(def);
        console.log(
          `[Tool] defineObjectType: ${params.name}${
            params.defaultComponents
              ? ` with components [${params.defaultComponents
                  .map((c) => c.name)
                  .join(", ")}]`
              : ""
          }`
        );
        return {
          success: true,
          result: {
            defined: params.name,
            traits: params.traits,
            states: Object.keys(params.states),
            components: params.defaultComponents?.map((c) => c.name) || [],
          },
        };
      },
    }),

    defineAffordance: tool({
      description: `Define a new affordance (action that can be performed on objects). Affordances execute REAL effects that modify game state.

IMPORTANT: Affordances should have EFFECTS that actually change component data! This is how the semantic layer connects to real ECS state.

EFFECT TYPES:
- modify_component: Change component property (e.g., subtract health, add energy)
- set_state: Change object state (recalculates traits)
- add_trait / remove_trait: Add or remove a trait
- destroy: Remove entity from world
- emit_stimulus: Broadcast perception to nearby agents
- spawn: Create a new entity

EXAMPLE with effects:
defineAffordance({
  name: "harvest",
  requires: ["harvestable", "ripe"],
  blockedBy: ["depleted"],
  effects: [
    { type: "modify_component", target: "actor", modifications: [
      { component: "Inventory", property: "items", operation: "add", value: 1 }
    ]},
    { type: "set_state", target: "target", state: "depleted" },
    { type: "emit_stimulus", target: "nearby", stimulusType: "action", stimulusContent: "{actor.name} harvests {target.name}" }
  ],
  descriptionTemplate: "{actor.name} harvests {target.name}."
})`,
      inputSchema: z.object({
        name: z.string().describe("Unique name for this affordance"),
        requires: z
          .array(z.string())
          .describe("Traits the object must have to allow this action"),
        blockedBy: z
          .array(z.string())
          .optional()
          .describe("Traits that prevent this action"),
        actorRequires: z
          .array(z.string())
          .optional()
          .describe("Traits the actor must have"),
        duration: z
          .number()
          .optional()
          .describe("How long the action takes (0 = instant)"),
        effects: z
          .array(
            z.object({
              type: z
                .enum([
                  "modify_component",
                  "set_state",
                  "add_trait",
                  "remove_trait",
                  "destroy",
                  "spawn",
                  "emit_stimulus",
                  "transfer",
                  "add_relation",
                  "remove_relation",
                ])
                .describe("Effect type"),
              target: z
                .string()
                .optional()
                .describe("'actor', 'target', 'nearby', or entity name"),
              modifications: z
                .array(
                  z.object({
                    component: z.string(),
                    property: z.string(),
                    operation: z.enum(["set", "add", "subtract", "multiply"]),
                    value: z.union([z.number(), z.string(), z.boolean()]),
                  })
                )
                .optional()
                .describe("For modify_component"),
              state: z.string().optional().describe("For set_state"),
              trait: z
                .string()
                .optional()
                .describe("For add_trait/remove_trait"),
              stimulusType: z.string().optional().describe("For emit_stimulus"),
              stimulusContent: z
                .string()
                .optional()
                .describe(
                  "For emit_stimulus (supports {actor.name}, {target.name})"
                ),
              chance: z
                .number()
                .optional()
                .describe("Probability 0-1 (default 1)"),
            })
          )
          .optional()
          .describe(
            "Effects to execute when affordance is used - STRONGLY RECOMMENDED"
          ),
        transitions: z
          .record(z.string())
          .optional()
          .describe("Legacy state transitions (use effects instead)"),
        descriptionTemplate: z
          .string()
          .optional()
          .describe("Perception text template for nearby agents"),
      }),
      execute: async (params) => {
        const def: AffordanceDefinition = {
          name: params.name,
          requires: params.requires,
          blockedBy: params.blockedBy,
          actorRequires: params.actorRequires,
          transitions: params.transitions,
          duration: params.duration,
          effects: params.effects as any,
          descriptionTemplate: params.descriptionTemplate,
        };
        state.worldSchema.defineAffordance(def);
        console.log(
          `[Tool] defineAffordance: ${params.name} (${
            params.effects?.length || 0
          } effects)`
        );
        return {
          success: true,
          result: {
            defined: params.name,
            requires: params.requires,
            effectCount: params.effects?.length || 0,
          },
        };
      },
    }),

    defineRule: tool({
      description: `Define a world rule - a declarative behavior that systems interpret. Rules trigger effects when conditions are met.

EXAMPLE:
defineRule({
  name: "candle_burns_out",
  description: "Candles eventually burn out",
  when: { event: "tick", condition: { has: ["burning", "candle"] } },
  then: [
    { action: "modify_value", target: "self", params: { component: "fuel", field: "current", delta: -0.05 } }
  ],
  priority: 5
})`,
      inputSchema: z.object({
        name: z.string().describe("Unique name for this rule"),
        description: z.string().describe("What this rule does"),
        when: z.object({
          event: z
            .string()
            .describe("Event that triggers check (tick, value_change, etc)"),
          condition: z
            .object({
              has: z.array(z.string()).optional().describe("Required traits"),
              not: z
                .array(z.string())
                .optional()
                .describe("Traits that must be absent"),
              inState: z.string().optional().describe("Required state"),
              expression: z.string().optional().describe("Custom expression"),
            })
            .optional(),
        }),
        then: z.array(
          z.object({
            action: z.string().describe("Action to perform"),
            target: z
              .string()
              .optional()
              .describe("self, source, nearby, or entity name"),
            query: z
              .object({
                radius: z.number().optional(),
                has: z.array(z.string()).optional(),
                not: z.array(z.string()).optional(),
              })
              .optional(),
            params: z.record(z.any()).optional(),
          })
        ),
        priority: z.number().optional().describe("Higher = runs first"),
        enabled: z.boolean().optional().describe("Is rule active?"),
      }),
      execute: async (params) => {
        const def: RuleDefinition = {
          name: params.name,
          description: params.description,
          when: params.when,
          then: params.then,
          priority: params.priority,
          enabled: params.enabled ?? true,
        };
        state.worldSchema.defineRule(def);
        console.log(`[Tool] defineRule: ${params.name}`);
        return {
          success: true,
          result: { defined: params.name, priority: params.priority ?? 0 },
        };
      },
    }),

    listObjectTypes: tool({
      description:
        "List all defined object types (prefabs) that can be spawned",
      inputSchema: z.object({
        category: z.string().optional().describe("Filter by category"),
      }),
      execute: async (params) => {
        const types = params.category
          ? state.worldSchema.getObjectTypesByCategory(params.category)
          : state.worldSchema.getAllObjectTypes();
        return {
          success: true,
          result: types.map((t) => ({
            name: t.name,
            description: t.description,
            traits: t.traits,
            states: Object.keys(t.states),
            defaultState: t.defaultState,
            category: t.category,
          })),
        };
      },
    }),

    listAffordances: tool({
      description:
        "List all defined affordances (actions that can be performed on objects)",
      inputSchema: z.object({}),
      execute: async () => {
        const affordances = state.worldSchema.getAllAffordances();
        return {
          success: true,
          result: affordances.map((a) => ({
            name: a.name,
            requires: a.requires,
            blockedBy: a.blockedBy,
            transitions: a.transitions,
          })),
        };
      },
    }),

    listRules: tool({
      description: "List all defined world rules",
      inputSchema: z.object({
        activeOnly: z.boolean().optional().describe("Only show active rules"),
      }),
      execute: async (params) => {
        const rules = params.activeOnly
          ? state.worldSchema.getActiveRules()
          : Array.from(state.worldSchema["rules"].values());
        return {
          success: true,
          result: rules.map((r) => ({
            name: r.name,
            description: r.description,
            event: r.when.event,
            priority: r.priority ?? 0,
            enabled: r.enabled ?? true,
          })),
        };
      },
    }),

    getObjectTraits: tool({
      description:
        "Get the current traits of a spawned object (considering its state)",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }
        const traitsJson = Traits.active?.[eid] || "[]";
        let traits: string[] = [];
        try {
          traits = JSON.parse(traitsJson) as string[];
        } catch {
          traits = [];
        }
        const objectType = ObjectType.typeId?.[eid];
        const objectState = ObjectState.current?.[eid];
        return {
          success: true,
          result: {
            name: params.entityName,
            type: objectType,
            state: objectState,
            traits,
          },
        };
      },
    }),

    getAvailableActions: tool({
      description: "Get actions available on an object based on its traits",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }
        const traitsJson = Traits.active?.[eid] || "[]";
        let traitsArr: string[] = [];
        try {
          traitsArr = JSON.parse(traitsJson) as string[];
        } catch {
          traitsArr = [];
        }
        const traits = new Set(traitsArr);

        const availableActions: string[] = [];
        for (const aff of state.worldSchema.getAllAffordances()) {
          // Check if all required traits are present
          const hasRequired = aff.requires.every((t) => traits.has(t));
          // Check if no blocking traits are present
          const notBlocked = !aff.blockedBy?.some((t) => traits.has(t));
          if (hasRequired && notBlocked) {
            availableActions.push(aff.name);
          }
        }

        return {
          success: true,
          result: {
            name: params.entityName,
            availableActions,
          },
        };
      },
    }),

    transitionObjectState: tool({
      description: "Transition an object to a new state, updating its traits",
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity"),
        newState: z.string().describe("State to transition to"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }

        const objectType = ObjectType.typeId?.[eid];
        if (!objectType) {
          return {
            success: false,
            result: null,
            error: `Entity ${params.entityName} has no ObjectType.typeId`,
          };
        }

        const typeDef = state.worldSchema.getObjectType(objectType);
        if (!typeDef) {
          return {
            success: false,
            result: null,
            error: `Object type not found: ${objectType}`,
          };
        }

        const newStateData = typeDef.states[params.newState];
        if (!newStateData) {
          return {
            success: false,
            result: null,
            error: `State not found: ${
              params.newState
            }. Available: ${Object.keys(typeDef.states).join(", ")}`,
          };
        }

        const oldState = ObjectState.current?.[eid];
        const result = transitionObjectStateCanonical(
          state.world,
          eid,
          params.newState,
          {
            world: state.world,
            targetEid: eid,
            worldSchema: state.worldSchema,
            registry: state.registry,
          } as any,
          "tool:transitionObjectState"
        );
        if (!result.ok) {
          return {
            success: false,
            result: null,
            error: `Failed to transition state for ${params.entityName}`,
          };
        }

        let traits: string[] = [];
        try {
          traits = JSON.parse(Traits.active?.[eid] || "[]") as string[];
        } catch {
          traits = [];
        }

        console.log(
          `[Tool] transitionObjectState: ${params.entityName} -> ${params.newState}`
        );
        return {
          success: true,
          result: {
            name: params.entityName,
            oldState,
            newState: params.newState,
            traits,
          },
        };
      },
    }),

    describeEntity: tool({
      description: `Update an entity's text description. Use this to change how an entity is described in the simulation.

This affects what agents perceive when they observe the entity. Useful for:
- Updating descriptions after state changes
- Adding narrative flavor
- Reflecting changes in appearance or condition

EXAMPLE:
describeEntity({ entityName: "Old Oak Tree", description: "A gnarled oak tree, its branches now bare after the storm." })`,
      inputSchema: z.object({
        entityName: z.string().describe("Name of the entity to update"),
        description: z.string().describe("New description text"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Entity not found: ${params.entityName}`,
          };
        }

        // Update the Description component
        Description.value[eid] = params.description;

        console.log(`[Tool] describeEntity: ${params.entityName}`);
        return {
          success: true,
          result: {
            name: params.entityName,
            description: params.description,
          },
        };
      },
    }),

    // ============ MONITORING & STEERING TOOLS ============
    // Tools for observing world state and steering the narrative

    getWorldSummary: tool({
      description:
        "Get a comprehensive summary of the current world state including agents, rooms, conflicts, and narrative tension. Use this to understand the simulation state before deciding on interventions.",
      inputSchema: z.object({
        includeDetails: z
          .boolean()
          .optional()
          .describe("Include full agent and room details (default: true)"),
      }),
      execute: async (params) => {
        const { getWorldSummary: getWorldSummaryFn, getWorldSummaryText } =
          await import("./monitoring-system");
        const recentEvents: string[] = state.memory.shortTerm
          .filter((m) => m.type === "observation" || m.type === "action")
          .map((m) => m.content)
          .slice(-20);

        const summary = getWorldSummaryFn(
          state.world,
          state.registry,
          recentEvents,
          state.tick
        );

        // Update GodAgent component with current values
        GodAgent.tension[state.eid] = summary.narrativeArc.tension;
        GodAgent.stagnationScore[state.eid] = summary.stagnationScore;
        GodAgent.lastObservation[state.eid] = Date.now();

        const textSummary = getWorldSummaryText(summary);
        console.log(
          `[Tool] getWorldSummary: ${summary.agentCount} agents, tension=${(
            summary.narrativeArc.tension * 100
          ).toFixed(0)}%`
        );

        return {
          success: true,
          result:
            params.includeDetails === false
              ? {
                  tick: summary.tick,
                  agentCount: summary.agentCount,
                  roomCount: summary.roomCount,
                  narrativePhase: summary.narrativeArc.currentPhase,
                  tension: summary.narrativeArc.tension,
                  stagnation: summary.stagnationScore,
                  conflictCount: summary.activeConflicts.length,
                }
              : {
                  ...summary,
                  textSummary,
                },
        };
      },
    }),

    getNarrativeTension: tool({
      description:
        "Get the current narrative tension level (0-1). High tension = drama/conflict, low = calm/stagnant.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getNarrativeTension: getTensionFn } = await import(
          "./monitoring-system"
        );
        const recentEvents: string[] = state.memory.shortTerm
          .filter((m) => m.type === "observation")
          .map((m) => m.content)
          .slice(-20);

        const tension = getTensionFn(state.world, state.registry, recentEvents);
        GodAgent.tension[state.eid] = tension;

        console.log(
          `[Tool] getNarrativeTension: ${(tension * 100).toFixed(0)}%`
        );
        return {
          success: true,
          result: { tension, percentage: `${(tension * 100).toFixed(0)}%` },
        };
      },
    }),

    getSteeringRecommendations: tool({
      description:
        "Analyze the simulation and get recommendations for narrative steering interventions.",
      inputSchema: z.object({}),
      execute: async () => {
        const {
          getWorldSummary: getWorldSummaryFn,
          getSteeringRecommendations: getRecommendationsFn,
        } = await import("./monitoring-system");
        const recentEvents: string[] = state.memory.shortTerm
          .filter((m) => m.type === "observation")
          .map((m) => m.content)
          .slice(-20);

        const summary = getWorldSummaryFn(
          state.world,
          state.registry,
          recentEvents,
          state.tick
        );
        const recommendations = getRecommendationsFn(summary);

        console.log(
          `[Tool] getSteeringRecommendations: ${recommendations.length} suggestions`
        );
        return {
          success: true,
          result: {
            narrativePhase: summary.narrativeArc.currentPhase,
            tension: summary.narrativeArc.tension,
            stagnation: summary.stagnationScore,
            recommendations: recommendations.map((r) => ({
              pattern: r.pattern,
              description: r.description,
              suggestedAction: r.suggestedAction,
              priority: r.priority,
            })),
          },
        };
      },
    }),

    injectEnvironmentalEvent: tool({
      description:
        "Inject an environmental event into a specific room. All agents in that room will perceive it.",
      inputSchema: z.object({
        roomName: z
          .string()
          .describe("Name of the room to inject the event into"),
        content: z
          .string()
          .describe("What happens (e.g., 'A loud crash echoes from outside')"),
        modality: z
          .enum(["visual", "auditory", "olfactory", "tactile", "cognitive"])
          .optional()
          .describe("Sensory channel (default: visual)"),
      }),
      execute: async (params) => {
        const { injectEnvironmentalEvent: injectFn } = await import(
          "./monitoring-system"
        );
        const result = injectFn(
          state.world,
          state.registry,
          params.roomName,
          params.content,
          (params.modality as any) || "visual"
        );

        if (result.success) {
          GodAgent.interventionCount[state.eid] =
            (GodAgent.interventionCount[state.eid] || 0) + 1;
          addMemory(
            state,
            "action",
            `Injected event into ${params.roomName}: ${params.content}`,
            {
              importance: 7,
              tags: ["intervention", "environmental"],
            }
          );
        }

        console.log(
          `[Tool] injectEnvironmentalEvent: ${params.roomName} - ${result.message}`
        );
        return { success: result.success, result: result.message };
      },
    }),

    injectIntuition: tool({
      description:
        "Send an intuition/gut feeling to a specific agent via their cognitive sense.",
      inputSchema: z.object({
        agentName: z
          .string()
          .describe("Name of the agent to send intuition to"),
        content: z
          .string()
          .describe(
            "The intuitive feeling (e.g., 'You sense danger approaching')"
          ),
      }),
      execute: async (params) => {
        const { injectIntuition: injectFn } = await import(
          "./monitoring-system"
        );
        const result = injectFn(
          state.world,
          state.registry,
          params.agentName,
          params.content
        );

        if (result.success) {
          GodAgent.interventionCount[state.eid] =
            (GodAgent.interventionCount[state.eid] || 0) + 1;
          addMemory(
            state,
            "action",
            `Sent intuition to ${params.agentName}: ${params.content}`,
            {
              importance: 6,
              tags: ["intervention", "intuition"],
            }
          );
        }

        console.log(
          `[Tool] injectIntuition: ${params.agentName} - ${result.message}`
        );
        return { success: result.success, result: result.message };
      },
    }),

    broadcastAnnouncement: tool({
      description:
        "Broadcast an announcement that all agents in the world will perceive.",
      inputSchema: z.object({
        content: z.string().describe("The announcement content"),
        modality: z
          .enum(["visual", "auditory", "cognitive"])
          .optional()
          .describe("Sensory channel (default: auditory)"),
      }),
      execute: async (params) => {
        const { broadcastAnnouncement: broadcastFn } = await import(
          "./monitoring-system"
        );
        const result = broadcastFn(
          state.world,
          state.registry,
          params.content,
          (params.modality as any) || "auditory"
        );

        if (result.success) {
          GodAgent.interventionCount[state.eid] =
            (GodAgent.interventionCount[state.eid] || 0) + 1;
          addMemory(
            state,
            "action",
            `Broadcast announcement: ${params.content}`,
            {
              importance: 8,
              tags: ["intervention", "broadcast"],
            }
          );
        }

        console.log(`[Tool] broadcastAnnouncement: ${result.message}`);
        return { success: result.success, result: result.message };
      },
    }),

    setNarrativeGoals: tool({
      description: "Set narrative goals that guide your steering decisions.",
      inputSchema: z.object({
        goals: z
          .array(z.string())
          .describe(
            "Array of narrative goals (e.g., ['Create romantic tension between Alice and Bob', 'Build toward a climactic confrontation'])"
          ),
      }),
      execute: async (params) => {
        GodAgent.narrativeGoals[state.eid] = JSON.stringify(params.goals);

        addMemory(
          state,
          "decision",
          `Set narrative goals: ${params.goals.join(", ")}`,
          {
            importance: 9,
            tags: ["narrative", "goals"],
          }
        );

        console.log(
          `[Tool] setNarrativeGoals: ${params.goals.length} goals set`
        );
        return { success: true, result: { goals: params.goals } };
      },
    }),

    getNarrativeGoals: tool({
      description: "Get the current narrative goals.",
      inputSchema: z.object({}),
      execute: async () => {
        const goalsJson = GodAgent.narrativeGoals[state.eid] || "[]";
        const goals = JSON.parse(goalsJson);
        return { success: true, result: { goals } };
      },
    }),

    pauseAgent: tool({
      description:
        "Temporarily pause an agent's cognition (they won't think or act).",
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent to pause"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.agentName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Agent not found: ${params.agentName}`,
          };
        }

        const { Agent } = await import("../ecs/components");
        Agent.active[eid] = false;

        console.log(`[Tool] pauseAgent: ${params.agentName}`);
        return {
          success: true,
          result: { agent: params.agentName, active: false },
        };
      },
    }),

    resumeAgent: tool({
      description: "Resume a paused agent's cognition.",
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent to resume"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.agentName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Agent not found: ${params.agentName}`,
          };
        }

        const { Agent } = await import("../ecs/components");
        Agent.active[eid] = true;

        console.log(`[Tool] resumeAgent: ${params.agentName}`);
        return {
          success: true,
          result: { agent: params.agentName, active: true },
        };
      },
    }),

    modifyAgentMood: tool({
      description:
        "Directly modify an agent's arousal/mood level to influence their behavior.",
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent"),
        arousal: z
          .number()
          .min(0)
          .max(1)
          .describe("New arousal level (0=drowsy, 1=agitated)"),
        focus: z.string().optional().describe("What the agent should focus on"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.agentName);
        if (eid === undefined) {
          return {
            success: false,
            result: null,
            error: `Agent not found: ${params.agentName}`,
          };
        }

        const { Mind } = await import("../ecs/components");
        Mind.arousal[eid] = params.arousal;
        if (params.focus !== undefined) {
          Mind.focus[eid] = params.focus;
        }

        GodAgent.interventionCount[state.eid] =
          (GodAgent.interventionCount[state.eid] || 0) + 1;

        console.log(
          `[Tool] modifyAgentMood: ${params.agentName} arousal=${params.arousal}`
        );
        return {
          success: true,
          result: {
            agent: params.agentName,
            arousal: params.arousal,
            focus: params.focus || Mind.focus[eid],
          },
        };
      },
    }),

    setAgentBehaviorPolicy: tool({
      description: `Assign a deterministic behavior policy (behavior tree) to an agent. Policies run BEFORE LLM calls, making agents faster and cheaper. Available templates: ${getAvailableTemplates().join(", ")}. The policy falls through to LLM for situations not covered.`,
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent"),
        template: z.enum(["survival", "innkeeper", "guard", "scholar", "merchant", "worker", "idle"] as [string, ...string[]]).optional().describe("Policy template name. If omitted, inferred from agent role."),
        params: z.record(z.any()).optional().describe("Template parameters (e.g., { room: 'Tavern' } for innkeeper, { rooms: ['Hall', 'Gate'] } for guard)"),
      }),
      execute: async (params: any) => {
        const agents = Array.from(query(state.world, [Agent as any]));
        const eid = agents.find((e: number) => Name.value[e] === params.agentName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Agent "${params.agentName}" not found` };
        }

        let templateName: PolicyTemplateName;
        let templateParams = params.params;

        if (params.template) {
          templateName = params.template as PolicyTemplateName;
        } else {
          const role = String(Agent.role[eid] || "");
          const inferred = inferPolicyFromRole(role);
          templateName = inferred.template;
          templateParams = templateParams || inferred.params;
        }

        const tree = getPolicyTemplate(templateName, templateParams);
        if (!tree) {
          return { success: false, result: null, error: `Template "${templateName}" not found` };
        }

        setAgentBehaviorPolicy(state.world, eid, tree);
        console.log(`[Tool] setAgentBehaviorPolicy: ${params.agentName} -> ${templateName}`);
        return { success: true, result: { agent: params.agentName, template: templateName, params: templateParams } };
      },
    }),

    setCustomBehaviorTree: tool({
      description: `Assign a fully custom behavior tree (JSON) to an agent. This allows arbitrary decision logic beyond preset templates. Node types: selector (try children in order), sequence (all must pass), condition (boolean check), action (execute), interact_with_trait (find + interact by trait), wander, llm_fallback, noop. Condition ops: always, chance(p), need_above/below(need,value), in_room/not_in_room(roomName), has_goal(includes), no_active_movement_goal, room_has_named(name), has_perception(perceptionType). Action types: move, speak, observe, interact, think, wait, rest, reflect, plus any custom-registered actions.`,
      inputSchema: z.object({
        agentName: z.string().describe("Name of the agent"),
        tree: z.any().describe("BehaviorNode JSON tree. Root must be a selector or sequence node."),
        enable: z.boolean().optional().describe("Enable/disable the policy (default: true)"),
      }),
      execute: async (params: any) => {
        const agents = Array.from(query(state.world, [Agent as any]));
        const eid = agents.find((e: number) => Name.value[e] === params.agentName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Agent "${params.agentName}" not found` };
        }

        const tree = params.tree;
        if (!tree || typeof tree !== "object") {
          return { success: false, result: null, error: "tree must be a valid BehaviorNode JSON object" };
        }

        // Get custom action types for validation
        const allActions = ActionRegistry.getAllActions();
        const customTypes = new Set(allActions.map(a => a.name));

        const validation = validateBehaviorNode(tree, { allowedActionTypes: customTypes });
        if (!validation.ok) {
          return { success: false, result: null, error: `Invalid behavior tree: ${validation.error}` };
        }

        setAgentBehaviorPolicy(state.world, eid, tree, params.enable !== false);
        console.log(`[Tool] setCustomBehaviorTree: ${params.agentName} (${JSON.stringify(tree).length} bytes)`);
        return {
          success: true,
          result: {
            agent: params.agentName,
            treeSize: JSON.stringify(tree).length,
            enabled: params.enable !== false,
          },
        };
      },
    }),

    generateCustomPolicies: tool({
      description: "Generate unique LLM-crafted behavior policies for all agents (or specific agents). Uses the world's affordances, traits, and relationships to create context-aware behavior trees tailored to each agent's role and personality. Falls back to template-based policies if LLM generation fails. Requires GOOGLE_GENERATIVE_AI_API_KEY.",
      inputSchema: z.object({
        agentNames: z.array(z.string()).optional().describe("Specific agent names to generate for. If omitted, generates for ALL agents."),
        worldTheme: z.string().optional().describe("Theme description (e.g., 'medieval port city'). Defaults to world name."),
      }),
      execute: async (params: any) => {
        const allAgentEids = Array.from(query(state.world, [Agent as any, Name as any]));
        let targetEids = allAgentEids;

        if (params.agentNames && params.agentNames.length > 0) {
          const nameSet = new Set(params.agentNames as string[]);
          targetEids = allAgentEids.filter((eid: number) => nameSet.has(String(Name.value[eid] || "")));
          if (targetEids.length === 0) {
            return { success: false, result: null, error: `No matching agents found for names: ${params.agentNames.join(", ")}` };
          }
        }

        // Build context for each agent
        const allAffordances = state.worldSchema.getAllAffordances().map(a => ({
          name: a.name,
          description: a.descriptionTemplate || a.name,
          requires: a.requires || [],
        }));
        const allTraits = state.worldSchema.getAllTraits().map(t => ({
          name: t,
          description: t,
          category: "world",
        }));
        const relationships = Object.keys(AllRelations).map(r => ({
          name: r,
          description: r,
        }));
        const templates = getAvailableTemplates();
        const worldTheme = params.worldTheme || state.worldSchema.constructor.name || "simulation";

        const contexts: PolicyGenerationContext[] = targetEids.map((eid: number) => {
          const roomEid = getRoomForEntity(state.world, eid);
          const roomName = roomEid !== undefined ? String(Name.value[roomEid] || "Unknown") : "Unknown";

          return {
            name: String(Name.value[eid] || ""),
            role: String(Agent.role[eid] || ""),
            personality: String(Agent.systemPrompt[eid] || "").slice(0, 300),
            currentRoom: roomName,
            availableAffordances: allAffordances,
            availableTraits: allTraits,
            availableRelationships: relationships,
            worldTheme,
            existingTemplates: templates,
          };
        });

        try {
          console.log(`[Tool] generateCustomPolicies: Generating for ${contexts.length} agents...`);
          const policies = await generateBatchPolicies(contexts);

          let assigned = 0;
          for (const eid of targetEids) {
            const name = String(Name.value[eid] || "");
            const policy = policies.get(name);
            if (policy) {
              setAgentBehaviorPolicy(state.world, eid, policy);
              assigned++;
            }
          }

          console.log(`[Tool] generateCustomPolicies: ${assigned}/${contexts.length} agents received custom policies`);
          return {
            success: true,
            result: {
              totalAgents: contexts.length,
              policiesGenerated: assigned,
              agentNames: contexts.map(c => c.name),
            },
          };
        } catch (err: any) {
          console.error(`[Tool] generateCustomPolicies failed:`, err?.message || err);
          return { success: false, result: null, error: `Policy generation failed: ${err?.message || String(err)}` };
        }
      },
    }),

    registerAction: tool({
      description: "Register a new action type that agents can perform. Once registered, the action appears in agent prompts and can be used in behavior trees. Actions are validated against this registry.",
      inputSchema: z.object({
        name: z.string().describe("Action name (lowercase, e.g., 'brew_potion', 'cast_spell', 'trade')"),
        description: z.string().describe("What this action does (shown to agent AI)"),
        requiresTarget: z.boolean().describe("Does this action need a target entity?"),
        requiresContent: z.boolean().describe("Does this action need content/details?"),
        targetTypes: z.array(z.string()).optional().describe("What can be targeted: 'room', 'agent', 'object', 'any'"),
        examples: z.array(z.string()).optional().describe("Example usages for AI prompt"),
        category: z.enum(["movement", "social", "combat", "interaction", "self", "inventory"]).describe("Action category"),
        enabledByComponent: z.string().optional().describe("Component name that enables this action (e.g., 'Inventory'). If set, only agents with this component can use the action."),
        systemName: z.string().optional().describe("System name this action belongs to (for grouping)"),
      }),
      execute: async (params: any) => {
        const actionDef: ActionDefinition = {
          name: params.name,
          description: params.description,
          requiresTarget: params.requiresTarget,
          requiresContent: params.requiresContent,
          targetTypes: params.targetTypes,
          examples: params.examples,
          enabledBy: params.enabledByComponent ? [params.enabledByComponent] : undefined,
          category: params.category,
        };

        if (params.enabledByComponent) {
          ActionRegistry.registerComponentAction(params.enabledByComponent, actionDef);
          console.log(`[Tool] registerAction: ${params.name} (enabled by ${params.enabledByComponent})`);
        } else if (params.systemName) {
          const existing = ActionRegistry.getSystemActions(params.systemName);
          ActionRegistry.registerSystemActions(params.systemName, [...existing, actionDef]);
          console.log(`[Tool] registerAction: ${params.name} (system: ${params.systemName})`);
        } else {
          // Register as a system action under "god" namespace
          const existing = ActionRegistry.getSystemActions("god");
          ActionRegistry.registerSystemActions("god", [...existing, actionDef]);
          console.log(`[Tool] registerAction: ${params.name} (god namespace)`);
        }

        return {
          success: true,
          result: {
            name: params.name,
            description: params.description,
            category: params.category,
            totalActions: ActionRegistry.getAllActions().length,
          },
        };
      },
    }),

    listAvailableActions: tool({
      description: "List all registered action types (core + component + system/custom)",
      inputSchema: z.object({}),
      execute: async () => {
        const all = ActionRegistry.getAllActions();
        return {
          success: true,
          result: {
            total: all.length,
            actions: all.map(a => ({
              name: a.name,
              description: a.description,
              category: a.category,
              requiresTarget: a.requiresTarget,
              requiresContent: a.requiresContent,
              enabledBy: a.enabledBy,
            })),
          },
        };
      },
    }),

    getInterventionStats: tool({
      description:
        "Get statistics about GodAI interventions in this simulation.",
      inputSchema: z.object({}),
      execute: async () => {
        const interventionCount = GodAgent.interventionCount[state.eid] || 0;
        const lastObservation = GodAgent.lastObservation[state.eid] || 0;
        const tension = GodAgent.tension[state.eid] || 0;
        const stagnation = GodAgent.stagnationScore[state.eid] || 0;

        return {
          success: true,
          result: {
            interventionCount,
            lastObservation:
              lastObservation > 0
                ? new Date(lastObservation).toISOString()
                : "never",
            currentTension: tension,
            currentStagnation: stagnation,
          },
        };
      },
    }),

    // ============ SPIRIT HIERARCHY TOOLS ============
    // Tools for managing the celestial hierarchy of AI spirits

    getSpiritHierarchy: tool({
      description:
        "View the current spirit hierarchy - the celestial agents watching over different domains of the simulation.",
      inputSchema: z.object({}),
      execute: async () => {
        const {
          getSpiritSystemState,
          getSpiritSystemDebugInfo,
          getSystemSummary,
        } = await import("../spirits");
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error:
              "Spirit system not initialized. Call initializeSpiritSystem first.",
          };
        }

        const summary = getSystemSummary();
        const debug = getSpiritSystemDebugInfo();

        console.log("[Tool] getSpiritHierarchy");
        return {
          success: true,
          result: {
            summary,
            details: debug,
          },
        };
      },
    }),

    getSpiritReports: tool({
      description:
        "Get reports from spirits that have observed the simulation. Spirits report narrative developments, conflicts, stagnation, and other significant events.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getSpiritSystemState, getMessagesForGodAI } = await import(
          "../spirits"
        );
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const messages = getMessagesForGodAI(systemState.registry);

        console.log(`[Tool] getSpiritReports: ${messages.length} messages`);
        return {
          success: true,
          result: {
            messageCount: messages.length,
            messages: messages.map((m) => ({
              from: m.from,
              type: m.type,
              priority: m.priority,
              subject: m.subject,
              content: m.content,
              timestamp: new Date(m.timestamp).toISOString(),
            })),
          },
        };
      },
    }),

    sendDirectiveToSpirit: tool({
      description:
        "Send a directive to a spirit, commanding them to take specific action.",
      inputSchema: z.object({
        spiritName: z
          .string()
          .describe("Name of the spirit to command (e.g., 'The Narrator')"),
        directive: z.string().describe("What you want the spirit to do"),
        priority: z
          .enum(["low", "normal", "high", "urgent"])
          .optional()
          .describe("Directive priority"),
      }),
      execute: async (params) => {
        const { getSpiritSystemState, getSpiritByName, sendDirective } =
          await import("../spirits");
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const spirit = getSpiritByName(systemState.registry, params.spiritName);
        if (!spirit) {
          return {
            success: false,
            result: null,
            error: `Spirit not found: ${params.spiritName}`,
          };
        }

        const directive = sendDirective(
          systemState.registry,
          state.eid,
          spirit.eid,
          {
            type: "intervene",
            description: params.directive,
            action: {
              type: "custom",
              parameters: { directive: params.directive },
            },
          }
        );

        addMemory(
          state,
          "action",
          `Sent directive to ${params.spiritName}: ${params.directive}`,
          {
            importance: 7,
            tags: ["spirit", "directive"],
          }
        );

        console.log(
          `[Tool] sendDirectiveToSpirit: ${params.spiritName} - ${params.directive}`
        );
        return {
          success: true,
          result: {
            directiveId: directive.id,
            to: params.spiritName,
            description: params.directive,
          },
        };
      },
    }),

    createSpirit: tool({
      description:
        "Create a new spirit to watch over a specific domain or entity. Spirits observe the ECS and report to you.",
      inputSchema: z.object({
        name: z
          .string()
          .describe("Name for the spirit (e.g., 'Guardian of Alice')"),
        domain: z
          .enum([
            "narrative",
            "social",
            "ecology",
            "economy",
            "guardian",
            "locale",
          ])
          .describe("Domain the spirit manages"),
        rank: z
          .enum(["archangel", "angel", "daemon"])
          .describe("Spirit rank in hierarchy"),
        description: z.string().describe("What this spirit watches and does"),
        watchEntities: z
          .array(z.string())
          .optional()
          .describe("Specific entity names to watch"),
        watchRooms: z
          .array(z.string())
          .optional()
          .describe("Specific room names to watch"),
        observationInterval: z
          .number()
          .optional()
          .describe("Milliseconds between observations (default: 30000)"),
      }),
      execute: async (params) => {
        const { getSpiritSystemState, createNewSpirit } = await import(
          "../spirits"
        );
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const definition = {
          name: params.name,
          domain: params.domain,
          rank: params.rank,
          description: params.description,
          watchConfig: {
            componentQueries: [],
            eventTypes: ["action_executed", "dialogue_spoken", "mood_changed"],
            watchEntities: params.watchEntities,
            watchRooms: params.watchRooms,
          },
          canInjectEvents: params.rank !== "daemon",
          canModifyMood: params.rank === "archangel",
          canCreateEntities: false,
          canBakeSystems: false,
          model: params.rank === "archangel" ? "flash" : ("flash" as const),
          observationInterval: params.observationInterval || 30000,
          systemPrompt: `You are ${params.name}, a ${params.rank} spirit of the ${params.domain} domain.
${params.description}

Observe the world and report significant events to your superior.
If you can intervene, do so when narratively appropriate.
Always respond with valid JSON.`,
        };

        const spirit = createNewSpirit(definition, state.eid);

        if (!spirit) {
          return {
            success: false,
            result: null,
            error: "Failed to create spirit",
          };
        }

        addMemory(
          state,
          "action",
          `Created spirit: ${params.name} (${params.domain} ${params.rank})`,
          {
            importance: 8,
            tags: ["spirit", "creation"],
          }
        );

        console.log(`[Tool] createSpirit: ${params.name}`);
        return {
          success: true,
          result: {
            name: params.name,
            domain: params.domain,
            rank: params.rank,
            eid: spirit.eid,
          },
        };
      },
    }),

    getSpiritObservations: tool({
      description: "Get recent observations from a specific spirit.",
      inputSchema: z.object({
        spiritName: z.string().describe("Name of the spirit"),
        limit: z
          .number()
          .optional()
          .describe("Max observations to return (default: 10)"),
      }),
      execute: async (params) => {
        const { getSpiritSystemState, getSpiritByName } = await import(
          "../spirits"
        );
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const spirit = getSpiritByName(systemState.registry, params.spiritName);
        if (!spirit) {
          return {
            success: false,
            result: null,
            error: `Spirit not found: ${params.spiritName}`,
          };
        }

        const limit = params.limit || 10;
        const observations = spirit.observations.slice(-limit);

        console.log(
          `[Tool] getSpiritObservations: ${params.spiritName} - ${observations.length} obs`
        );
        return {
          success: true,
          result: {
            spirit: params.spiritName,
            observationCount: spirit.observations.length,
            recent: observations.map((o) => ({
              type: o.type,
              content: o.content,
              entities: o.entities,
              significance: o.significance,
              timestamp: new Date(o.timestamp).toISOString(),
            })),
          },
        };
      },
    }),

    getNarratorState: tool({
      description:
        "Get the Narrator spirit's current understanding of the narrative - plot threads, tension, character arcs.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getSpiritSystemState, getSpiritByName } = await import(
          "../spirits"
        );
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const narrator = getSpiritByName(systemState.registry, "The Narrator");
        if (!narrator) {
          return {
            success: false,
            result: null,
            error: "Narrator spirit not found",
          };
        }

        if (!narrator.narrativeState) {
          return {
            success: true,
            result: {
              message: "Narrator has not yet analyzed the narrative",
              shortTermMemory: narrator.shortTermMemory.slice(-5),
            },
          };
        }

        console.log("[Tool] getNarratorState");
        return {
          success: true,
          result: {
            currentAct: narrator.narrativeState.currentAct,
            currentPhase: narrator.narrativeState.currentPhase,
            tension: narrator.narrativeState.tension,
            plotThreads: narrator.narrativeState.plotThreads,
            protagonists: narrator.narrativeState.protagonists,
            antagonists: narrator.narrativeState.antagonists,
            recentThoughts: narrator.shortTermMemory.slice(-3),
          },
        };
      },
    }),

    tickSpirits: tool({
      description:
        "Manually trigger a spirit observation cycle. Normally spirits run on their own schedule, but this forces an immediate cycle.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getSpiritSystemState, tickSpiritSystem } = await import(
          "../spirits"
        );
        const systemState = getSpiritSystemState();

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        // Force the tick by resetting lastTick
        systemState.lastTick = 0;

        const result = await tickSpiritSystem(state.world, state.registry);

        console.log(
          `[Tool] tickSpirits: ${result.spiritsProcessed} spirits processed`
        );
        return {
          success: true,
          result: {
            spiritsProcessed: result.spiritsProcessed,
            messagesGenerated: result.messagesForGodAI.length,
          },
        };
      },
    }),

    // ============ STORY TEMPLATE TOOLS ============
    // Tools for managing narrative templates that guide story structure

    listStoryTemplates: tool({
      description: `List all available story arc templates. Templates define narrative structures including:
- Key story beats (inciting incident, climax, resolution)
- Tension curves for pacing
- Character role requirements
- Intervention suggestions for when stories stagnate

Use setStoryTemplate to activate a template for the current simulation.`,
      inputSchema: z.object({}),
      execute: async () => {
        const { getAvailableTemplates } = await import("../spirits");
        const templates = getAvailableTemplates();

        console.log("[Tool] listStoryTemplates");
        return {
          success: true,
          result: {
            count: templates.length,
            templates,
          },
        };
      },
    }),

    setStoryTemplate: tool({
      description: `Activate a story template for the current narrative. The template will guide:
- What story beats should happen and when
- Target tension levels for each phase
- When and how to intervene if the story stagnates
- Character role assignments

Templates: "classic_three_act", "mystery", "slice_of_life", "conflict"`,
      inputSchema: z.object({
        templateId: z.string().describe("ID of the template to activate"),
      }),
      execute: async (params) => {
        const { setActiveTemplate } = await import("../spirits");
        const template = setActiveTemplate(params.templateId);

        if (!template) {
          return {
            success: false,
            result: null,
            error: `Template not found: ${params.templateId}. Use listStoryTemplates to see available templates.`,
          };
        }

        console.log(`[Tool] setStoryTemplate: ${template.name}`);
        return {
          success: true,
          result: {
            id: template.id,
            name: template.name,
            genre: template.genre,
            description: template.description,
            acts: template.acts.map((a) => ({
              number: a.number,
              name: a.name,
              purpose: a.purpose,
            })),
            requiredRoles: template.requiredRoles.map((r) => r.role),
            keyBeats: template.keyBeats.map((b) => ({
              id: b.id,
              name: b.name,
              phase: b.phase,
            })),
            themes: template.themes,
          },
        };
      },
    }),

    getStoryTemplateStatus: tool({
      description:
        "Get the current status of the active story template including alignment, next expected beat, and recommendations.",
      inputSchema: z.object({}),
      execute: async () => {
        const {
          getActiveTemplate,
          getSpiritSystemState,
          getSpiritByName,
          generateNarrativeReport,
        } = await import("../spirits");

        const template = getActiveTemplate();
        const systemState = getSpiritSystemState();

        if (!template) {
          return {
            success: true,
            result: {
              templateActive: false,
              message:
                "No story template is currently active. Use setStoryTemplate to activate one.",
            },
          };
        }

        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const narrator = getSpiritByName(systemState.registry, "The Narrator");
        if (!narrator || !narrator.narrativeState) {
          return {
            success: true,
            result: {
              templateActive: true,
              templateName: template.name,
              message:
                "Narrator has not yet analyzed the narrative. Wait for spirit tick or call tickSpirits.",
            },
          };
        }

        const eventCount = narrator.observations.length;
        const lastObservation =
          narrator.observations[narrator.observations.length - 1];
        const ticksSinceLastEvent = lastObservation
          ? Date.now() - lastObservation.timestamp
          : 0;

        const report = generateNarrativeReport(
          narrator.narrativeState,
          eventCount,
          ticksSinceLastEvent
        );

        console.log("[Tool] getStoryTemplateStatus");
        return {
          success: true,
          result: {
            templateActive: true,
            templateName: template.name,
            ...report,
          },
        };
      },
    }),

    markStoryBeat: tool({
      description: `Mark a story beat as completed. This tracks progress through the template structure.
Common beats include: "opening_image", "inciting_incident", "first_threshold", "midpoint", "all_is_lost", "climax", "resolution"`,
      inputSchema: z.object({
        beatId: z.string().describe("ID of the beat to mark as completed"),
      }),
      execute: async (params) => {
        const { markBeatCompleted, getActiveTemplate } = await import(
          "../spirits"
        );

        const template = getActiveTemplate();
        if (!template) {
          return {
            success: false,
            result: null,
            error: "No story template is active. Use setStoryTemplate first.",
          };
        }

        // Verify beat exists in template
        const beat = [...template.keyBeats, ...template.optionalBeats].find(
          (b) => b.id === params.beatId
        );
        if (!beat) {
          const availableBeats = [
            ...template.keyBeats,
            ...template.optionalBeats,
          ].map((b) => b.id);
          return {
            success: false,
            result: null,
            error: `Beat not found: ${
              params.beatId
            }. Available beats: ${availableBeats.join(", ")}`,
          };
        }

        markBeatCompleted(params.beatId);

        console.log(`[Tool] markStoryBeat: ${params.beatId}`);
        return {
          success: true,
          result: {
            beatId: params.beatId,
            beatName: beat.name,
            phase: beat.phase,
            tensionChange: beat.tensionChange,
            establishes: beat.establishes,
          },
        };
      },
    }),

    getTemplateInterventions: tool({
      description:
        "Get suggested interventions based on the current story state and active template. Useful when the story is stagnating or deviating from the template.",
      inputSchema: z.object({
        includeAllSources: z
          .boolean()
          .optional()
          .describe(
            "Include phase-based and stagnation suggestions in addition to template suggestions"
          ),
      }),
      execute: async (params) => {
        const {
          getActiveTemplate,
          getSpiritSystemState,
          getSpiritByName,
          suggestEnhancedInterventions,
          getTemplateInterventions,
        } = await import("../spirits");

        const systemState = getSpiritSystemState();
        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const narrator = getSpiritByName(systemState.registry, "The Narrator");
        if (!narrator || !narrator.narrativeState) {
          return {
            success: false,
            result: null,
            error: "Narrator has not yet analyzed the narrative",
          };
        }

        // Collect agent info for targeting
        const agents: {
          name: string;
          location: string;
          mood: string;
          arousal: number;
        }[] = [];
        for (const [name, eid] of state.registry.byName) {
          if (Agent.active[eid]) {
            agents.push({
              name,
              location: "", // Would need room lookup
              mood:
                Mind.arousal[eid] > 0.7
                  ? "excited"
                  : Mind.arousal[eid] < 0.3
                  ? "calm"
                  : "alert",
              arousal: Mind.arousal[eid],
            });
          }
        }

        const lastObservation =
          narrator.observations[narrator.observations.length - 1];
        const ticksSinceLastEvent = lastObservation
          ? Date.now() - lastObservation.timestamp
          : 60000;

        let suggestions;
        if (params.includeAllSources) {
          suggestions = suggestEnhancedInterventions(
            narrator.narrativeState,
            ticksSinceLastEvent,
            agents
          );
        } else {
          const template = getActiveTemplate();
          if (!template) {
            return {
              success: false,
              result: null,
              error:
                "No story template active. Use setStoryTemplate or set includeAllSources=true for phase-based suggestions.",
            };
          }
          suggestions = getTemplateInterventions(
            narrator.narrativeState.tension,
            narrator.narrativeState.currentPhase,
            ticksSinceLastEvent
          ).map((s) => ({
            type: s.type,
            target: agents[0]?.name || "room",
            content: s.templates[0],
            reason: `Template trigger: ${s.trigger}`,
            source: "template" as const,
          }));
        }

        console.log(
          `[Tool] getTemplateInterventions: ${suggestions.length} suggestions`
        );
        return {
          success: true,
          result: {
            currentPhase: narrator.narrativeState.currentPhase,
            currentTension: narrator.narrativeState.tension,
            ticksSinceLastEvent,
            suggestions,
          },
        };
      },
    }),

    suggestCharacterRoles: tool({
      description:
        "Get suggestions for assigning template character roles to agents in the simulation.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getActiveTemplate, getRoleSuggestions } = await import(
          "../spirits"
        );

        const template = getActiveTemplate();
        if (!template) {
          return {
            success: false,
            result: null,
            error: "No story template active. Use setStoryTemplate first.",
          };
        }

        // Collect agent info
        const agents: { name: string; traits: string[]; arousal: number }[] =
          [];
        for (const [name, eid] of state.registry.byName) {
          if (Agent.active[eid]) {
            agents.push({
              name,
              traits: [], // Would need trait lookup
              arousal: Mind.arousal[eid],
            });
          }
        }

        const suggestions = getRoleSuggestions(agents);

        console.log("[Tool] suggestCharacterRoles");
        return {
          success: true,
          result: {
            templateName: template.name,
            requiredRoles: template.requiredRoles.map((r) => ({
              role: r.role,
              description: r.description,
              arcType: r.arcType,
            })),
            optionalRoles: template.optionalRoles.map((r) => ({
              role: r.role,
              description: r.description,
              arcType: r.arcType,
            })),
            suggestions,
          },
        };
      },
    }),

    // ============ DYNAMIC SPIRIT CREATION TOOLS ============
    // Tools for creating spirits that can watch systems and architect new ones

    createSystemWatcher: tool({
      description: `Create a spirit that watches specific systems and reports on their behavior.
System watchers monitor:
- System execution frequency and performance
- Anomalies (stagnation, errors, performance degradation)
- Patterns (trending entity counts, cyclic behavior)

Example: Create a weather watcher to monitor a WeatherSystem you baked.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe("Name for the watcher spirit (e.g., 'Zephyros')"),
        domain: z
          .enum([
            "narrative",
            "social",
            "ecology",
            "economy",
            "guardian",
            "locale",
          ])
          .describe("Domain the watcher belongs to"),
        targetSystems: z
          .array(z.string())
          .describe(
            "System names to watch (e.g., ['WeatherSystem', 'TemperatureSystem'])"
          ),
        watchPatterns: z
          .array(z.string())
          .optional()
          .describe(
            "Patterns to look for (e.g., ['stagnation', 'performance', 'errors'])"
          ),
        observationInterval: z
          .number()
          .optional()
          .describe("Ms between observations (default: 30000)"),
        superiorName: z
          .string()
          .optional()
          .describe("Name of superior spirit (default: The Arbiter)"),
      }),
      execute: async (params) => {
        const { createDynamicSpirit } = await import(
          "../spirits/spirit-factory"
        );
        const { createSystemWatcherConfig } = await import(
          "../spirits/system-watcher"
        );
        const { getSpiritSystemState, getSpiritByName } = await import(
          "../spirits"
        );

        const systemState = getSpiritSystemState();
        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        // Find superior
        let superiorEid: number | undefined;
        if (params.superiorName) {
          const superior = getSpiritByName(
            systemState.registry,
            params.superiorName
          );
          superiorEid = superior?.eid;
        } else {
          // Default to The Arbiter
          const arbiter = getSpiritByName(systemState.registry, "The Arbiter");
          superiorEid = arbiter?.eid;
        }

        const config: any = {
          name: params.name,
          title: `The ${params.name}`,
          type: "watcher",
          domain: params.domain as any,
          rank: "angel",
          superiorEid,
          watchConfig: createSystemWatcherConfig(
            params.targetSystems,
            params.watchPatterns
          ),
          observationInterval: params.observationInterval || 30000,
          customPrompt: `You watch these systems: ${params.targetSystems.join(
            ", "
          )}
Report anomalies, performance issues, and opportunities for improvement.`,
        };

        const spirit = createDynamicSpirit(systemState.registry, config);

        if (!spirit) {
          return {
            success: false,
            result: null,
            error: "Failed to create system watcher",
          };
        }

        addMemory(
          state,
          "action",
          `Created system watcher: ${
            params.name
          } watching ${params.targetSystems.join(", ")}`,
          {
            importance: 8,
            tags: ["spirit", "watcher", "creation"],
          }
        );

        console.log(
          `[Tool] createSystemWatcher: ${
            params.name
          } watching ${params.targetSystems.join(", ")}`
        );
        return {
          success: true,
          result: {
            name: params.name,
            type: "watcher",
            domain: params.domain,
            targetSystems: params.targetSystems,
            eid: spirit.eid,
          },
        };
      },
    }),

    createArchitectSpirit: tool({
      description: `Create an architect spirit that can DESIGN and PROPOSE new systems, components, and entities.
Architects observe the simulation and propose enhancements:
- New SYSTEMS for behaviors the world lacks
- New COMPONENTS for data the world needs
- New ENTITIES for richness and variety
- New RULES for emergent behavior

Proposals require approval (by you or a superior spirit) before execution.
Example: Create a QuestArchitect to design quests when agents need objectives.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe("Name for the architect (e.g., 'The Questmaster')"),
        domain: z
          .enum([
            "narrative",
            "social",
            "ecology",
            "economy",
            "guardian",
            "locale",
          ])
          .describe("Domain the architect specializes in"),
        canProposeSystems: z
          .boolean()
          .optional()
          .describe("Can propose new systems (default: true)"),
        canProposeComponents: z
          .boolean()
          .optional()
          .describe("Can propose new components (default: true)"),
        canProposeEntities: z
          .boolean()
          .optional()
          .describe("Can propose new entities (default: true)"),
        canProposeRules: z
          .boolean()
          .optional()
          .describe("Can propose new rules (default: false)"),
        canExecuteDirectly: z
          .boolean()
          .optional()
          .describe("Can execute without approval (DANGEROUS, default: false)"),
        approvalRequired: z
          .enum(["auto", "superior", "godai"])
          .optional()
          .describe("Who approves proposals (default: godai)"),
        superiorName: z.string().optional().describe("Name of superior spirit"),
        specialization: z
          .string()
          .optional()
          .describe(
            "What the architect specializes in (e.g., 'quest design', 'weather systems')"
          ),
      }),
      execute: async (params) => {
        const { createDynamicSpirit } = await import(
          "../spirits/spirit-factory"
        );
        const { createArchitectConfig } = await import(
          "../spirits/architect-spirit"
        );
        const { getSpiritSystemState, getSpiritByName } = await import(
          "../spirits"
        );

        const systemState = getSpiritSystemState();
        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        // Find superior
        let superiorEid: number | undefined;
        if (params.superiorName) {
          const superior = getSpiritByName(
            systemState.registry,
            params.superiorName
          );
          superiorEid = superior?.eid;
        }

        const architectConfig = createArchitectConfig({
          canProposeSystems: params.canProposeSystems ?? true,
          canProposeComponents: params.canProposeComponents ?? true,
          canProposeEntities: params.canProposeEntities ?? true,
          canProposeRules: params.canProposeRules ?? false,
          canExecuteDirectly: params.canExecuteDirectly ?? false,
          approvalRequired: params.approvalRequired ?? "godai",
        });

        const config: any = {
          name: params.name,
          title: params.name,
          type: "architect",
          domain: params.domain as any,
          rank: "angel",
          superiorEid,
          architectConfig,
          observationInterval: 60000, // Architects think slower, propose less frequently
          customPrompt: params.specialization
            ? `You specialize in: ${params.specialization}`
            : undefined,
        };

        const spirit = createDynamicSpirit(systemState.registry, config);

        if (!spirit) {
          return {
            success: false,
            result: null,
            error: "Failed to create architect spirit",
          };
        }

        addMemory(
          state,
          "action",
          `Created architect spirit: ${params.name} (${params.domain} domain)`,
          {
            importance: 9,
            tags: ["spirit", "architect", "creation"],
          }
        );

        console.log(
          `[Tool] createArchitectSpirit: ${params.name} (${params.domain})`
        );
        return {
          success: true,
          result: {
            name: params.name,
            type: "architect",
            domain: params.domain,
            capabilities: {
              canProposeSystems: architectConfig.canProposeSystems,
              canProposeComponents: architectConfig.canProposeComponents,
              canProposeEntities: architectConfig.canProposeEntities,
              canProposeRules: architectConfig.canProposeRules,
              canExecuteDirectly: architectConfig.canExecuteDirectly,
            },
            eid: spirit.eid,
          },
        };
      },
    }),

    getSpiritProposals: tool({
      description:
        "Get pending proposals from architect spirits. Review these and approve/reject them.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "approved", "rejected", "all"])
          .optional()
          .describe("Filter by status (default: pending)"),
      }),
      execute: async (params) => {
        const { getPendingProposals, getApprovedProposals, getFactoryState } =
          await import("../spirits/spirit-factory");

        const status = params.status || "pending";
        let proposals;

        if (status === "pending") {
          proposals = getPendingProposals();
        } else if (status === "approved") {
          proposals = getApprovedProposals();
        } else if (status === "all") {
          proposals = getFactoryState().pendingProposals;
        } else {
          proposals = getFactoryState().pendingProposals.filter(
            (p) => p.status === status
          );
        }

        console.log(`[Tool] getSpiritProposals: ${proposals.length} ${status}`);
        return {
          success: true,
          result: {
            count: proposals.length,
            proposals: proposals.map((p) => ({
              id: p.id,
              type: p.type,
              name: p.name,
              description: p.description,
              fromSpirit: p.fromSpiritName,
              rationale: p.rationale,
              status: p.status,
              specification: p.specification,
            })),
          },
        };
      },
    }),

    approveProposal: tool({
      description:
        "Approve a proposal from an architect spirit. The proposal will be executed.",
      inputSchema: z.object({
        proposalId: z.string().describe("ID of the proposal to approve"),
      }),
      execute: async (params) => {
        const { approveProposal } = await import("../spirits/spirit-factory");

        const success = approveProposal(params.proposalId, state.eid);

        if (!success) {
          return {
            success: false,
            result: null,
            error: `Failed to approve proposal: ${params.proposalId} (not found or already processed)`,
          };
        }

        addMemory(
          state,
          "action",
          `Approved spirit proposal: ${params.proposalId}`,
          {
            importance: 7,
            tags: ["spirit", "proposal", "approval"],
          }
        );

        console.log(`[Tool] approveProposal: ${params.proposalId}`);
        return {
          success: true,
          result: { proposalId: params.proposalId, status: "approved" },
        };
      },
    }),

    rejectProposal: tool({
      description: "Reject a proposal from an architect spirit with a reason.",
      inputSchema: z.object({
        proposalId: z.string().describe("ID of the proposal to reject"),
        reason: z
          .string()
          .describe("Reason for rejection (feedback to the architect)"),
      }),
      execute: async (params) => {
        const { rejectProposal } = await import("../spirits/spirit-factory");

        const success = rejectProposal(params.proposalId, params.reason);

        if (!success) {
          return {
            success: false,
            result: null,
            error: `Failed to reject proposal: ${params.proposalId}`,
          };
        }

        console.log(`[Tool] rejectProposal: ${params.proposalId}`);
        return {
          success: true,
          result: {
            proposalId: params.proposalId,
            status: "rejected",
            reason: params.reason,
          },
        };
      },
    }),

    getSpiritFactorySummary: tool({
      description:
        "Get a summary of all dynamically created spirits and their activities.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getFactorySummary, getSpiritsByType, getPendingProposals } =
          await import("../spirits/spirit-factory");

        const summary = getFactorySummary();
        const watchers = getSpiritsByType("watcher");
        const architects = getSpiritsByType("architect");
        const pendingProposals = getPendingProposals();

        console.log("[Tool] getSpiritFactorySummary");
        return {
          success: true,
          result: {
            summary,
            watchers: watchers.map((w) => ({
              name: w.definition.name,
              domain: w.definition.domain,
              targetSystems: w.watchConfig?.targetSystems || [],
            })),
            architects: architects.map((a) => ({
              name: a.definition.name,
              domain: a.definition.domain,
              proposalCount: a.proposals?.length || 0,
            })),
            pendingProposals: pendingProposals.length,
          },
        };
      },
    }),

    runArchitectCognition: tool({
      description:
        "Manually trigger cognition for an architect spirit. The architect will observe, identify needs, and create proposals.",
      inputSchema: z.object({
        architectName: z.string().describe("Name of the architect spirit"),
      }),
      execute: async (params) => {
        const { getSpiritsByType, getDynamicSpirit } = await import(
          "../spirits/spirit-factory"
        );
        const { runArchitectCognition } = await import(
          "../spirits/architect-spirit"
        );
        const { getSpiritSystemState, getSpiritByName } = await import(
          "../spirits"
        );

        const systemState = getSpiritSystemState();
        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        // Find the architect by name
        const architects = getSpiritsByType("architect");
        const architect = architects.find(
          (a) => a.definition.name === params.architectName
        );

        if (!architect) {
          return {
            success: false,
            result: null,
            error: `Architect not found: ${
              params.architectName
            }. Available: ${architects
              .map((a) => a.definition.name)
              .join(", ")}`,
          };
        }

        const proposals = await runArchitectCognition(
          state.world,
          state.systemRegistry,
          systemState.registry,
          architect
        );

        console.log(
          `[Tool] runArchitectCognition: ${params.architectName} created ${proposals.length} proposals`
        );
        return {
          success: true,
          result: {
            architect: params.architectName,
            proposalsCreated: proposals.length,
            proposals: proposals.map((p) => ({
              id: p.id,
              type: p.type,
              name: p.name,
              description: p.description,
              status: p.status,
            })),
          },
        };
      },
    }),

    runSystemWatcherCognition: tool({
      description:
        "Manually trigger cognition for a system watcher spirit. The watcher will observe systems and report issues.",
      inputSchema: z.object({
        watcherName: z.string().describe("Name of the watcher spirit"),
      }),
      execute: async (params) => {
        const { getSpiritsByType } = await import("../spirits/spirit-factory");
        const { runWatcherCognition } = await import(
          "../spirits/system-watcher"
        );
        const { getSpiritSystemState } = await import("../spirits");

        const systemState = getSpiritSystemState();
        if (!systemState) {
          return {
            success: false,
            result: null,
            error: "Spirit system not initialized",
          };
        }

        const watchers = getSpiritsByType("watcher");
        const watcher = watchers.find(
          (w) => w.definition.name === params.watcherName
        );

        if (!watcher) {
          return {
            success: false,
            result: null,
            error: `Watcher not found: ${
              params.watcherName
            }. Available: ${watchers.map((w) => w.definition.name).join(", ")}`,
          };
        }

        const report = await runWatcherCognition(
          state.world,
          state.systemRegistry,
          systemState.registry,
          watcher
        );

        if (!report) {
          return {
            success: false,
            result: null,
            error: "Watcher cognition failed",
          };
        }

        console.log(
          `[Tool] runSystemWatcherCognition: ${params.watcherName} - ${report.overallHealth}`
        );
        return {
          success: true,
          result: {
            watcher: params.watcherName,
            health: report.overallHealth,
            systemsObserved: report.systemObservations.length,
            anomalies: report.systemObservations.flatMap((o) => o.anomalies)
              .length,
            recommendations: report.recommendations,
          },
        };
      },
    }),

    // ========================================================================
    // SIMULATION PERSISTENCE TOOLS
    // ========================================================================

    createNewSimulation: tool({
      description: `Create a new simulation with its own folder structure for persistence.
Each simulation gets:
- simulation.json: Metadata and config
- world.json: Full ECS world state
- spirits.json: Spirit system state
- systems/: Generated system files
- snapshots/: Periodic full state snapshots
- logs/: Narrative and event logs

Returns the simulation ID for use with other persistence tools.`,
      parameters: z.object({
        name: z.string().describe("Human-readable name for the simulation"),
        description: z
          .string()
          .optional()
          .describe("Description of what this simulation is about"),
        storyTemplate: z
          .string()
          .optional()
          .describe("Story template to use (e.g., 'classic_three_act')"),
        autosaveInterval: z
          .number()
          .optional()
          .describe("Auto-save every N ticks (0 to disable, default: 50)"),
        snapshotInterval: z
          .number()
          .optional()
          .describe(
            "Create snapshot every N ticks (0 to disable, default: 200)"
          ),
        maxSnapshots: z
          .number()
          .optional()
          .describe("Maximum snapshots to keep (default: 10)"),
      }),
      execute: async (params: any) => {
        try {
          const config: SimulationConfig = {
            name: params.name,
            description: params.description,
            storyTemplate: params.storyTemplate,
            autosaveInterval: params.autosaveInterval,
            snapshotInterval: params.snapshotInterval,
            maxSnapshots: params.maxSnapshots,
          };

          const simulation = await createSimulation(config);
          setCurrentSimulation(simulation);

          console.log(
            `[Tool] createNewSimulation: ${params.name} (${simulation.id})`
          );
          return {
            success: true,
            result: {
              id: simulation.id,
              name: simulation.name,
              basePath: simulation.basePath,
              systemsDir: simulation.getSystemsDir(),
              message: `Created simulation "${params.name}" with ID: ${simulation.id}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    listAllSimulations: tool({
      description: "List all saved simulations with their metadata.",
      parameters: z.object({}),
      execute: async () => {
        try {
          const simulations = await listSimulations();
          const current = getCurrentSimulation();

          console.log(
            `[Tool] listAllSimulations: Found ${simulations.length} simulations`
          );
          return {
            success: true,
            result: {
              count: simulations.length,
              currentId: current?.id || null,
              simulations: simulations.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                storyTemplate: s.storyTemplate,
                createdAt: new Date(s.createdAt).toISOString(),
                lastSavedAt: new Date(s.lastSavedAt).toISOString(),
                currentTick: s.currentTick,
                isCurrent: current?.id === s.id,
              })),
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    loadExistingSimulation: tool({
      description:
        "Load an existing simulation by ID. This sets it as the current simulation.",
      parameters: z.object({
        simulationId: z.string().describe("The simulation ID to load"),
      }),
      execute: async (params: any) => {
        try {
          const simulation = await loadSimulation(params.simulationId);
          setCurrentSimulation(simulation);

          console.log(
            `[Tool] loadExistingSimulation: ${simulation.name} (${simulation.id})`
          );
          return {
            success: true,
            result: {
              id: simulation.id,
              name: simulation.name,
              currentTick: simulation.currentTick,
              basePath: simulation.basePath,
              message: `Loaded simulation "${simulation.name}" at tick ${simulation.currentTick}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    saveCurrentSimulation: tool({
      description:
        "Save the current simulation state (world, spirits, systems). Requires an active simulation.",
      parameters: z.object({
        includeSnapshot: z
          .boolean()
          .optional()
          .describe("Also create a full snapshot (default: false)"),
      }),
      execute: async (params: any) => {
        const simulation = getCurrentSimulation();
        if (!simulation) {
          return {
            success: false,
            result: null,
            error:
              "No active simulation. Use createNewSimulation or loadExistingSimulation first.",
          };
        }

        try {
          // Get state references from GodAgent state (these would need to be passed properly)
          // For now, we can only save metadata
          await simulation.flushLogs();
          await simulation.saveMetadata();

          console.log(`[Tool] saveCurrentSimulation: ${simulation.name}`);
          return {
            success: true,
            result: {
              simulationId: simulation.id,
              name: simulation.name,
              savedAt: new Date().toISOString(),
              message: `Saved simulation "${simulation.name}" metadata. Use tick-based auto-save for full world state.`,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    getSimulationStatus: tool({
      description:
        "Get the current simulation status including paths and save info.",
      parameters: z.object({}),
      execute: async (): Promise<any> => {
        const simulation = getCurrentSimulation();
        if (!simulation) {
          return {
            success: true,
            result: {
              hasActiveSimulation: false,
              message:
                "No active simulation. Use createNewSimulation or loadExistingSimulation.",
            },
          };
        }

        try {
          const snapshots = await simulation.listSnapshots();

          return {
            success: true,
            result: {
              hasActiveSimulation: true,
              id: simulation.id,
              name: simulation.name,
              currentTick: simulation.currentTick,
              createdAt: new Date(simulation.createdAt).toISOString(),
              lastSavedAt: new Date(simulation.lastSavedAt).toISOString(),
              paths: {
                base: simulation.basePath,
                systems: simulation.getSystemsDir(),
                snapshots: simulation.getSnapshotsDir(),
                logs: simulation.getLogsDir(),
              },
              snapshots: snapshots.slice(0, 5).map((s) => ({
                tick: s.tick,
                savedAt: s.savedAt.toISOString(),
              })),
              totalSnapshots: snapshots.length,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    appendToNarrative: tool({
      description: "Append text to the current simulation's narrative log.",
      parameters: z.object({
        text: z.string().describe("The narrative text to append"),
      }),
      execute: async (params: any) => {
        const simulation = getCurrentSimulation();
        if (!simulation) {
          return {
            success: false,
            result: null,
            error:
              "No active simulation. Use createNewSimulation or loadExistingSimulation first.",
          };
        }

        simulation.appendNarrative(params.text);
        console.log(
          `[Tool] appendToNarrative: ${params.text.substring(0, 50)}...`
        );

        return {
          success: true,
          result: {
            message:
              "Narrative appended. Will be flushed to disk on next save.",
          },
        };
      },
    } as any),

    logSimulationEvent: tool({
      description:
        "Log a structured event to the current simulation's event log.",
      parameters: z.object({
        type: z
          .string()
          .describe(
            "Event type (e.g., 'agent_action', 'system_run', 'intervention')"
          ),
        data: z.any().describe("Event data payload"),
      }),
      execute: async (params: any) => {
        const simulation = getCurrentSimulation();
        if (!simulation) {
          return {
            success: false,
            result: null,
            error:
              "No active simulation. Use createNewSimulation or loadExistingSimulation first.",
          };
        }

        simulation.logEvent(params.type, params.data);
        console.log(`[Tool] logSimulationEvent: ${params.type}`);

        return {
          success: true,
          result: {
            message: "Event logged. Will be flushed to disk on next save.",
          },
        };
      },
    } as any),

    deleteSimulationById: tool({
      description: "Delete a simulation and all its data. Use with caution!",
      parameters: z.object({
        simulationId: z.string().describe("The simulation ID to delete"),
        confirm: z.boolean().describe("Must be true to confirm deletion"),
      }),
      execute: async (params: any) => {
        if (!params.confirm) {
          return {
            success: false,
            result: null,
            error: "Deletion not confirmed. Set confirm=true to delete.",
          };
        }

        try {
          // Clear current simulation if it's the one being deleted
          const current = getCurrentSimulation();
          if (current?.id === params.simulationId) {
            setCurrentSimulation(null);
          }

          await deleteSimulation(params.simulationId);

          console.log(`[Tool] deleteSimulationById: ${params.simulationId}`);
          return {
            success: true,
            result: {
              message: `Deleted simulation ${params.simulationId}`,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    } as any),

    // =========================================================================
    // VOCABULARY TOOLS - Affordances, Traits, and Relationship Types
    // =========================================================================

    createAffordance: tool({
      description:
        "Create a new affordance (action that can be performed on objects with matching traits). Auto-registers any required traits that don't exist yet.",
      inputSchema: z.object({
        name: z.string().describe("Unique name for this affordance (e.g., 'forge', 'brew', 'hack')"),
        description: z
          .string()
          .describe("What this affordance does"),
        requires: z
          .array(z.string())
          .describe("Trait names the target must have to allow this action"),
        effects: z
          .array(
            z.object({
              type: z
                .enum([
                  "modify_component",
                  "set_state",
                  "add_trait",
                  "remove_trait",
                  "destroy",
                  "spawn",
                  "emit_stimulus",
                  "transfer",
                  "add_relation",
                  "remove_relation",
                ])
                .describe("Effect type"),
              target: z.string().optional().describe("Who this affects: 'actor', 'target', 'nearby', or entity name"),
              // modify_component: change numeric/string values on components
              modifications: z.array(z.object({
                component: z.string().describe("Component name (e.g., 'Needs', 'Health', or any dynamic component)"),
                property: z.string().describe("Property name (e.g., 'hunger', 'current')"),
                operation: z.enum(["set", "add", "subtract", "multiply"]).describe("How to change the value"),
                value: z.union([z.number(), z.string()]).describe("Value to apply"),
              })).optional().describe("For modify_component: what to change"),
              // set_state: change object state (recalculates traits)
              state: z.string().optional().describe("For set_state: new state name"),
              // add_trait/remove_trait
              trait: z.string().optional().describe("For add_trait/remove_trait: trait name"),
              // spawn: create new entities
              spawnType: z.string().optional().describe("For spawn: object type to create"),
              spawnName: z.string().optional().describe("For spawn: name of the new entity"),
              spawnProperties: z.record(z.any()).optional().describe("For spawn: initial properties"),
              containerName: z.string().optional().describe("For spawn/transfer: where to place it ('room' = actor's room)"),
              // emit_stimulus: notify agents
              stimulusType: z.string().optional().describe("For emit_stimulus: 'observation', 'sound', 'event'"),
              stimulusContent: z.string().optional().describe("For emit_stimulus: message text. Use {actor} and {target} as placeholders"),
              // relations
              relation: z.string().optional().describe("For add_relation/remove_relation: relation name"),
              relatedEntity: z.string().optional().describe("For add_relation/remove_relation: other entity name"),
              // probability
              chance: z.number().optional().describe("Probability 0-1 this effect fires (default 1)"),
            })
          )
          .optional()
          .describe("Effects that execute when this affordance is used — this is how affordances CHANGE THE WORLD"),
        category: z
          .string()
          .optional()
          .describe("Category for grouping (e.g., 'crafting', 'combat', 'social')"),
      }),
      execute: async (params) => {
        // Auto-register any required traits that don't exist yet
        const autoRegistered: string[] = [];
        for (const traitName of params.requires) {
          if (!isTraitRegistered(traitName)) {
            registerTrait({
              name: traitName,
              description: `Enables ${params.name} interaction`,
              category: "custom" as TraitCategory,
              enablesAffordances: [params.name],
              incompatibleWith: [],
            });
            autoRegistered.push(traitName);
          }
        }

        const def: AffordanceDefinition = {
          name: params.name,
          description: params.description,
          requires: params.requires,
          effects: params.effects as any,
          descriptionTemplate: `{actor.name} ${params.name}s {target.name}.`,
        };
        registerAffordance(def);
        console.log(
          `[Tool] createAffordance: ${params.name} (requires: ${params.requires.join(", ")}${
            autoRegistered.length > 0 ? `, auto-registered traits: ${autoRegistered.join(", ")}` : ""
          })`
        );
        return {
          success: true,
          result: {
            affordance: params.name,
            requires: params.requires,
            autoRegisteredTraits: autoRegistered,
            effectCount: params.effects?.length || 0,
          },
        };
      },
    }),

    createTrait: tool({
      description:
        "Create a new trait definition. Traits are tags that entities can have, enabling affordances and categorizing capabilities.",
      inputSchema: z.object({
        name: z.string().describe("Unique trait name (e.g., 'forgeable', 'magical', 'hackable')"),
        description: z.string().describe("What this trait means"),
        category: z
          .enum(["physical", "interactive", "social", "sensory", "state", "custom"])
          .describe("Semantic category"),
        enablesAffordances: z
          .array(z.string())
          .optional()
          .describe("Affordance names this trait enables"),
        incompatibleWith: z
          .array(z.string())
          .optional()
          .describe("Trait names that cannot coexist with this one"),
      }),
      execute: async (params) => {
        const def: TraitDefinition = {
          name: params.name,
          description: params.description,
          category: params.category as TraitCategory,
          enablesAffordances: params.enablesAffordances || [],
          incompatibleWith: params.incompatibleWith || [],
        };
        registerTrait(def);
        console.log(`[Tool] createTrait: ${params.name} (${params.category})`);
        return {
          success: true,
          result: {
            trait: params.name,
            category: params.category,
            description: params.description,
          },
        };
      },
    }),

    createRelationshipType: tool({
      description:
        "Create a new relationship type for social dynamics between entities (e.g., GuildMember, OwesDebtTo, RivalOf).",
      inputSchema: z.object({
        name: z.string().describe("Unique name for this relationship type"),
        description: z.string().describe("What this relationship represents"),
        dataFields: z
          .record(z.enum(["number", "string"]))
          .optional()
          .describe("Data fields stored on the relationship (e.g., { strength: 'number', since: 'string' })"),
        isExclusive: z
          .boolean()
          .optional()
          .describe("If true, each subject can only have one target (default false)"),
        autoRemoveSubject: z
          .boolean()
          .optional()
          .describe("If true, removing the target also removes the subject (default false)"),
      }),
      execute: async (params) => {
        try {
          const def: RelationshipTypeDefinition = {
            name: params.name,
            description: params.description,
            dataFields: params.dataFields || {},
            isExclusive: params.isExclusive || false,
            autoRemoveSubject: params.autoRemoveSubject || false,
            category: "custom",
          };
          registerRelationshipType(def);
          console.log(`[Tool] createRelationshipType: ${params.name}`);
          return {
            success: true,
            result: {
              relationshipType: params.name,
              description: params.description,
              dataFields: params.dataFields || {},
              isExclusive: params.isExclusive || false,
            },
          };
        } catch (error) {
          return {
            success: false,
            result: null,
            error: String(error),
          };
        }
      },
    }),

    addEntityRelationship: tool({
      description:
        "Add a runtime relationship between two entities using a registered relationship type.",
      inputSchema: z.object({
        subjectEid: z.number().describe("Entity ID of the subject"),
        relationName: z.string().describe("Name of the registered relationship type"),
        targetEid: z.number().describe("Entity ID of the target"),
        data: z
          .record(z.any())
          .optional()
          .describe("Data field values for the relationship"),
      }),
      execute: async (params) => {
        const ok = addRelationship(
          state.world,
          params.subjectEid,
          params.relationName,
          params.targetEid,
          params.data
        );
        if (!ok) {
          return {
            success: false,
            result: null,
            error: `Relationship type "${params.relationName}" is not registered. Use createRelationshipType first.`,
          };
        }
        console.log(
          `[Tool] addEntityRelationship: eid ${params.subjectEid} --[${params.relationName}]--> eid ${params.targetEid}`
        );
        return {
          success: true,
          result: {
            subject: params.subjectEid,
            relation: params.relationName,
            target: params.targetEid,
            data: params.data || {},
          },
        };
      },
    }),

    listVocabulary: tool({
      description:
        "List all registered vocabulary: affordances, traits, and relationship types.",
      inputSchema: z.object({}),
      execute: async () => {
        const affordances = listAllAffordances().map((a) => ({
          name: a.name,
          requires: a.requires,
          effectCount: a.effects?.length || 0,
        }));
        const traits = listAllTraits().map((t) => ({
          name: t.name,
          category: t.category,
          description: t.description,
          enablesAffordances: t.enablesAffordances,
        }));
        const relationshipTypes = listRelationshipTypes().map((r) => ({
          name: r.name,
          description: r.description,
          dataFields: r.dataFields,
          isExclusive: r.isExclusive,
        }));
        return {
          success: true,
          result: {
            affordances,
            traits,
            relationshipTypes,
            summary: `${affordances.length} affordances, ${traits.length} traits, ${relationshipTypes.length} relationship types`,
          },
        };
      },
    }),
  };
}

// Helper function to interpolate template strings
function interpolateTemplate(
  template: string,
  props: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => props[key] || `{${key}}`);
}

// Helper function to infer schema from values
function inferSchema(
  values: Record<string, any>
): Record<string, "number" | "string" | "boolean"> {
  const schema: Record<string, "number" | "string" | "boolean"> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number") schema[key] = "number";
    else if (typeof value === "boolean") schema[key] = "boolean";
    else schema[key] = "string";
  }
  return schema;
}

// Design phase using the planner model with deep thinking
export async function designSolution(
  state: GodAgentState,
  challenge: string
): Promise<{ design: DesignDocument | null; reasoning: string }> {
  console.log(
    "\n[GodAgent] 🧠 Design Phase - Using Pro model with thinking...\n"
  );

  const designPrompt = `You are designing a simulation for an ECS (Entity Component System) engine.

CRITICAL - STRUCTURE OF ARRAYS (SoA) DATA MODEL:
All components use SoA - each property is an ARRAY indexed by entity ID.
Access pattern: Component.property[entityId]
Example: Health.current[eid] = 50;

YOUR TASK: Design a complete solution for this challenge. Do NOT implement yet - just design.

CHALLENGE:
${challenge}

OUTPUT FORMAT - Return a JSON design document with this exact structure:
{
  "summary": "Brief description of your solution approach",
  "components": [
    {
      "name": "ComponentName",
      "purpose": "What this component represents",
      "properties": { "propertyName": "number|string|boolean", ... }
    }
  ],
  "entities": [
    {
      "name": "EntityName",
      "type": "producer|consumer|market|other",
      "components": ["ComponentName1", "ComponentName2"],
      "initialValues": { "ComponentName": { "property": value } }
    }
  ],
  "systems": [
    {
      "name": "SystemName",
      "purpose": "What this system does",
      "frequency": 1,
      "logic": "Pseudocode: FOR EACH entity WITH Component: read X, compute Y, write Z"
    }
  ],
  "feedbackLoops": [
    "Description of feedback loop 1: A affects B which affects C which affects A"
  ],
  "notes": "Any important design decisions or considerations"
}

DESIGN PRINCIPLES:
1. Think through the FEEDBACK LOOPS first - what affects what?
2. Design components to store the minimal state needed
3. Systems should be focused - one clear responsibility each
4. Use lowercase property names consistently
5. Consider edge cases (what if supply is 0? what if price goes negative?)

Return ONLY the JSON document, no markdown fences.`;

  try {
    const response = await generateText({
      model: plannerModel,
      prompt: designPrompt,
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: PLANNER_THINKING_LEVEL,
          },
        },
      },
    });

    // Extract reasoning text from the reasoning array
    let reasoningText = "";
    if (response.reasoning && Array.isArray(response.reasoning)) {
      reasoningText = response.reasoning
        .map((r: any) => r.text || "")
        .filter(Boolean)
        .join("\n");
    }
    if (reasoningText) {
      console.log(
        "[GodAgent] 💭 Thinking:",
        reasoningText.slice(0, 1000) +
          (reasoningText.length > 1000 ? "..." : "")
      );
    }

    let designText = response.text.trim();
    // Remove markdown fences if present
    if (designText.startsWith("```")) {
      designText = designText
        .replace(/```json?\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    }

    try {
      const design = JSON.parse(designText) as DesignDocument;
      console.log("[GodAgent] ✅ Design complete:");
      console.log(`  - ${design.components?.length || 0} components`);
      console.log(`  - ${design.entities?.length || 0} entities`);
      console.log(`  - ${design.systems?.length || 0} systems`);
      console.log(`  - ${design.feedbackLoops?.length || 0} feedback loops`);
      return { design, reasoning: reasoningText };
    } catch (parseError) {
      console.error("[GodAgent] Failed to parse design JSON:", parseError);
      console.log("[GodAgent] Raw response:", designText.slice(0, 500));
      return { design: null, reasoning: designText };
    }
  } catch (error) {
    console.error("[GodAgent] Design phase error:", error);
    return { design: null, reasoning: `Error: ${error}` };
  }
}

// Review the design against the original challenge requirements
export async function reviewDesign(
  design: DesignDocument,
  challenge: string
): Promise<{ issues: string[]; suggestions: string[]; approved: boolean }> {
  console.log("\n[GodAgent] 🔍 Review Phase - Critiquing design...\n");

  const reviewPrompt = `You are reviewing an ECS simulation design. Check if it fully addresses the challenge requirements.

ORIGINAL CHALLENGE:
${challenge}

PROPOSED DESIGN:
${JSON.stringify(design, null, 2)}

REVIEW CHECKLIST - Only flag as issues if they will BREAK the simulation:
1. CRITICAL: Are there enough entities? (e.g., if challenge asks for multiple creatures, there MUST be multiple)
2. CRITICAL: Will the system logic actually work? (e.g., math errors, unreachable conditions)
3. CRITICAL: Are there obvious bugs in the pseudocode logic?
4. MINOR: Could be improved but will work as-is

DO NOT flag as issues:
- Design style preferences (e.g., "should use X pattern instead of Y")
- Features that would be "nice to have" but aren't required
- Alternative approaches that might be "better"
- Theoretical concerns that won't affect basic functionality

OUTPUT FORMAT - Return JSON:
{
  "issues": ["Only CRITICAL problems that will break the simulation", ...],
  "suggestions": ["Minor improvements, optional", ...],
  "approved": true/false (true if no critical issues)
}

Be CONSERVATIVE - only flag issues that will actually prevent the simulation from working.
The design doesn't need to be perfect, just functional.
Return ONLY the JSON, no markdown fences.`;

  try {
    const response = await generateText({
      model: plannerModel,
      prompt: reviewPrompt,
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: REVIEW_THINKING_LEVEL,
          },
        },
      },
    });

    let reviewText = response.text.trim();
    if (reviewText.startsWith("```")) {
      reviewText = reviewText
        .replace(/```json?\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    }

    try {
      const review = JSON.parse(reviewText);
      console.log(
        `[GodAgent] 📋 Review: ${
          review.approved ? "✅ Approved" : "❌ Issues found"
        }`
      );
      if (review.issues?.length > 0) {
        const issueTexts = review.issues
          .slice(0, 3)
          .map((i: any) => (typeof i === "string" ? i : JSON.stringify(i)));
        console.log(`  Issues: ${issueTexts.join("; ")}`);
      }
      return {
        issues: review.issues || [],
        suggestions: review.suggestions || [],
        approved: review.approved ?? true,
      };
    } catch (parseError) {
      console.log("[GodAgent] Could not parse review, assuming approved");
      return { issues: [], suggestions: [], approved: true };
    }
  } catch (error) {
    console.error("[GodAgent] Review phase error:", error);
    return { issues: [], suggestions: [], approved: true };
  }
}

// Refine the design based on review feedback
export async function refineDesign(
  design: DesignDocument,
  challenge: string,
  issues: string[],
  suggestions: string[]
): Promise<DesignDocument> {
  console.log("\n[GodAgent] 🔧 Refinement Phase - Fixing issues...\n");

  const refinePrompt = `You are refining an ECS simulation design based on review feedback.

ORIGINAL CHALLENGE:
${challenge}

CURRENT DESIGN:
${JSON.stringify(design, null, 2)}

ISSUES TO FIX (MUST address these):
${issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

SUGGESTIONS (address if possible):
${suggestions.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}

OUTPUT: Return the COMPLETE refined design document (same JSON structure as input).
Keep all the good parts of the original design, but fix the issues.
Return ONLY the JSON, no markdown fences.`;

  try {
    const response = await generateText({
      model: plannerModel,
      prompt: refinePrompt,
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: PLANNER_THINKING_LEVEL,
          },
        },
      },
    });

    let refinedText = response.text.trim();
    if (refinedText.startsWith("```")) {
      refinedText = refinedText
        .replace(/```json?\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    }

    try {
      const refinedDesign = JSON.parse(refinedText) as DesignDocument;
      console.log("[GodAgent] ✅ Design refined:");
      console.log(`  - ${refinedDesign.components?.length || 0} components`);
      console.log(`  - ${refinedDesign.entities?.length || 0} entities`);
      console.log(`  - ${refinedDesign.systems?.length || 0} systems`);
      return refinedDesign;
    } catch (parseError) {
      console.log(
        "[GodAgent] Could not parse refined design, keeping original"
      );
      return design;
    }
  } catch (error) {
    console.error("[GodAgent] Refinement phase error:", error);
    return design;
  }
}

// Build minimal tools for design execution (reduced schema complexity)
function buildExecutionTools(state: GodAgentState) {
  return {
    createComponent: tool({
      description:
        "Create a new dynamic component with typed properties. Example: {name: 'Population', properties: {count: 'number', minThreshold: 'number'}}",
      inputSchema: z.object({
        name: z
          .string()
          .describe("PascalCase name (e.g., Population, Consumer)"),
        properties: z
          .record(z.string())
          .describe(
            "Property name to type mapping, e.g. {count: 'number', name: 'string'}"
          ),
      }),
      execute: async (params) => {
        try {
          // Validate and convert property types
          const validTypes = ["number", "string", "boolean"];
          const cleanedProps: Record<string, "number" | "string" | "boolean"> =
            {};
          for (const [key, val] of Object.entries(params.properties || {})) {
            const typeStr = String(val).toLowerCase();
            if (validTypes.includes(typeStr)) {
              cleanedProps[key] = typeStr as "number" | "string" | "boolean";
            } else {
              cleanedProps[key] = "number"; // Default to number
            }
          }
          // If no properties provided, add a default 'value' property
          if (Object.keys(cleanedProps).length === 0) {
            cleanedProps["value"] = "number";
          }
          const def: ComponentDefinition = {
            name: params.name,
            description: `Dynamic component ${params.name}`,
            properties: cleanedProps,
          };
          createDynamicComponent(def);
          await saveComponentDefinition(def);
          console.log(
            `  [Tool] createComponent: ${params.name} with ${Object.keys(
              cleanedProps
            ).join(", ")}`
          );
          return {
            success: true,
            result: { name: params.name, properties: cleanedProps },
          };
        } catch (e) {
          console.error(`  [Tool] createComponent error:`, e);
          return { success: false, error: String(e) };
        }
      },
    }),

    createEntity: tool({
      description: "Create a mechanical entity",
      inputSchema: z.object({
        name: z.string().describe("Unique name"),
        description: z.string().optional(),
      }),
      execute: async (params) => {
        const result = state.tools.createEntity(params);
        console.log(`  [Tool] createEntity: ${params.name}`);
        return result;
      },
    }),

    setDynamicComponent: tool({
      description: "Set dynamic component values on an entity",
      inputSchema: z.object({
        entityName: z.string().describe("Entity name"),
        componentName: z.string().describe("Component name"),
        values: z.record(z.any()).describe("Property values"),
      }),
      execute: async (params) => {
        const eid = state.registry.byName.get(params.entityName);
        if (eid === undefined) {
          return {
            success: false,
            error: `Entity not found: ${params.entityName}`,
          };
        }
        const comp = getDynamicComponent(params.componentName);
        if (!comp) {
          return {
            success: false,
            error: `Component not found: ${params.componentName}`,
          };
        }
        // Bridge: attach via registry so entity is queryable
        attachToEntity(state.world, eid, params.componentName, params.values);
        for (const [prop, val] of Object.entries(params.values)) {
          if (comp[prop]) {
            comp[prop][eid] = val;
          }
        }
        console.log(
          `  [Tool] setDynamicComponent: ${params.entityName}.${params.componentName}`
        );
        return { success: true, result: params.values };
      },
    }),

    createFileSystem: tool({
      description: "Create a new ECS system",
      inputSchema: z.object({
        name: z.string().describe("PascalCase name"),
        description: z.string().describe("What it does"),
        frequency: z.number().optional(),
        code: z.string().describe("TypeScript code body for the run function"),
      }),
      execute: async (params) => {
        try {
          const filePath = await writeSystemFile({
            name: params.name,
            description: params.description,
            frequency: params.frequency ?? 1,
            code: params.code,
          });
          const loaded = await loadSystemFromFile(filePath);
          if (loaded) {
            const preflight = await preflightValidateSystem(loaded, { ticks: 2 });
            if (!preflight.ok) {
              loaded.active = false;
              console.log(`  [Tool] createFileSystem preflight failed: ${params.name}`);
              return {
                success: false,
                error: `Preflight validation failed for ${params.name}: ${preflight.error || "unknown error"}`,
              };
            }
            state.fileSystems.push(loaded);
          }
          console.log(`  [Tool] createFileSystem: ${params.name}`);
          return {
            success: true,
            result: { name: params.name, loaded: !!loaded },
          };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    }),

    activateFileSystem: tool({
      description: "Activate a file-based system",
      inputSchema: z.object({
        systemName: z.string(),
      }),
      execute: async (params) => {
        const sys = state.fileSystems.find((s) => s.name === params.systemName);
        if (sys) {
          // Prevent re-activating systems that are already in a broken state and queued for repair.
          // Otherwise they can spam errors every tick and never allow the fixer loop to catch up.
          if (sys.consecutiveErrors >= 3) {
            return {
              success: false,
              error: `Cannot activate ${params.systemName}: system is in error state (consecutiveErrors=${sys.consecutiveErrors}). Fix or replace it first.`,
            };
          }
          sys.active = true;
          console.log(`  [Tool] activateFileSystem: ${params.systemName}`);
          return { success: true, result: { activated: params.systemName } };
        }
        return {
          success: false,
          error: `System not found: ${params.systemName}`,
        };
      },
    }),
  };
}

// Execute a design document directly (no AI needed for execution)
export async function executeDesign(
  state: GodAgentState,
  design: DesignDocument
): Promise<ToolResult[]> {
  console.log("\n[GodAgent] ⚡ Execution Phase - Direct implementation\n");

  const actions: ToolResult[] = [];

  // Step 1: Create all components
  for (const comp of design.components || []) {
    try {
      const properties: Record<string, "number" | "string" | "boolean"> = {};
      for (const [key, typeStr] of Object.entries(comp.properties || {})) {
        const t = String(typeStr).toLowerCase();
        if (["number", "string", "boolean"].includes(t)) {
          properties[key] = t as "number" | "string" | "boolean";
        } else {
          properties[key] = "number";
        }
      }
      // If no properties specified, add common ones based on component purpose
      if (Object.keys(properties).length === 0) {
        properties["value"] = "number";
      }
      const def: ComponentDefinition = {
        name: comp.name,
        description: comp.purpose || `Dynamic component ${comp.name}`,
        properties,
      };
      createDynamicComponent(def);
      await saveComponentDefinition(def);
      console.log(
        `  [Exec] createComponent: ${comp.name} (${Object.keys(properties).join(
          ", "
        )})`
      );
      actions.push({ success: true, result: { name: comp.name } });
    } catch (e) {
      console.error(`  [Exec] createComponent failed: ${comp.name}`, e);
      actions.push({ success: false, result: null, error: String(e) });
    }
  }

  // Step 2: Create all entities and set initial dynamic component values
  for (const ent of design.entities || []) {
    try {
      const result = state.tools.createEntity({
        name: ent.name,
        description: `${ent.type} entity`,
      });
      console.log(`  [Exec] createEntity: ${ent.name}`);
      actions.push(result);

      // Set initial values on dynamic components for this entity
      if (result.success && result.result?.entityId) {
        const eid = result.result.entityId as number;
        const nameLower = ent.name.toLowerCase();
        const entType = ent.type?.toLowerCase() || "other";
        const initLog: string[] = [];

        // Initialize ALL dynamic components with sensible defaults
        for (const compDef of design.components || []) {
          const comp = getDynamicComponent(compDef.name);
          if (!comp) continue;

          // Bridge: ensure entity is registered with BitECS for this component
          attachToEntity(state.world, eid, compDef.name);

          for (const [prop, propType] of Object.entries(
            compDef.properties || {}
          )) {
            if (!comp[prop]) continue;
            const propLower = prop.toLowerCase();

            // Smart default based on property name and entity type
            let defaultVal: number | string | boolean = 0;

            // Population/count properties
            if (
              propLower.includes("count") ||
              propLower.includes("population") ||
              propLower === "level"
            ) {
              if (
                entType === "producer" ||
                nameLower.includes("grass") ||
                nameLower.includes("resource")
              ) {
                defaultVal = 1000;
              } else if (
                nameLower.includes("rabbit") ||
                nameLower.includes("prey") ||
                entType === "consumer"
              ) {
                defaultVal = 100;
              } else if (
                nameLower.includes("fox") ||
                nameLower.includes("predator")
              ) {
                defaultVal = 20;
              } else {
                defaultVal = 50;
              }
            }
            // Capacity/max properties
            else if (
              propLower.includes("capacity") ||
              propLower.includes("max")
            ) {
              defaultVal = entType === "producer" ? 2000 : 500;
            }
            // Min/threshold properties
            else if (
              propLower.includes("min") ||
              propLower.includes("threshold")
            ) {
              defaultVal = entType === "producer" ? 10 : 5;
            }
            // Rate properties
            else if (
              propLower.includes("rate") ||
              propLower.includes("speed")
            ) {
              defaultVal = propLower.includes("growth")
                ? 0.1
                : propLower.includes("decay")
                ? 0.05
                : propLower.includes("death") ||
                  propLower.includes("starvation")
                ? 0.1
                : 0.05;
            }
            // Need/hunger/safety/social properties (0-100 scale)
            else if (
              propLower.includes("hunger") ||
              propLower.includes("food")
            ) {
              defaultVal = 30; // Start somewhat hungry
            } else if (
              propLower.includes("safety") ||
              propLower.includes("fear")
            ) {
              defaultVal = 70; // Start fairly safe
            } else if (
              propLower.includes("social") ||
              propLower.includes("lonely")
            ) {
              defaultVal = 50; // Start neutral
            }
            // Trust/reputation/charisma (0-100 scale)
            else if (propLower.includes("trust")) {
              defaultVal = nameLower.includes("diplomat")
                ? 70
                : nameLower.includes("skeptic")
                ? 30
                : 50;
            } else if (
              propLower.includes("reputation") ||
              propLower.includes("rep")
            ) {
              defaultVal = nameLower.includes("rival")
                ? 60
                : nameLower.includes("follower")
                ? 30
                : 50;
            } else if (propLower.includes("charisma")) {
              defaultVal = nameLower.includes("diplomat") ? 80 : 50;
            }
            // Cooperativeness/competitiveness
            else if (propLower.includes("cooperat")) {
              defaultVal = nameLower.includes("diplomat")
                ? 0.8
                : nameLower.includes("rival")
                ? 0.2
                : 0.5;
            } else if (propLower.includes("competit")) {
              defaultVal = nameLower.includes("rival")
                ? 0.8
                : nameLower.includes("diplomat")
                ? 0.2
                : 0.5;
            }
            // Supply/demand/price (economy)
            else if (propLower.includes("supply")) {
              defaultVal = entType === "producer" ? 100 : 0;
            } else if (propLower.includes("demand")) {
              defaultVal = entType === "consumer" ? 80 : 0;
            } else if (propLower.includes("price")) {
              defaultVal = 50;
            }
            // Efficiency
            else if (propLower.includes("efficiency")) {
              defaultVal = 0.5;
            }
            // Boolean flags
            else if (
              propType === "boolean" ||
              propLower.includes("active") ||
              propLower.includes("enabled")
            ) {
              defaultVal = 1;
            }
            // State/behavior strings
            else if (
              propType === "string" ||
              propLower.includes("state") ||
              propLower.includes("behavior") ||
              propLower.includes("mode")
            ) {
              defaultVal =
                entType === "producer"
                  ? "producing"
                  : entType === "consumer"
                  ? "idle"
                  : "active";
            }
            // Generic number default
            else if (propType === "number") {
              defaultVal = 50;
            }

            comp[prop][eid] = defaultVal;
            initLog.push(
              `${prop}=${
                typeof defaultVal === "number"
                  ? defaultVal.toFixed?.(0) ?? defaultVal
                  : defaultVal
              }`
            );
          }
        }

        // Also apply explicit initialValues from design if specified
        if (ent.initialValues) {
          for (const [compName, values] of Object.entries(ent.initialValues)) {
            const comp = getDynamicComponent(compName);
            if (comp && values) {
              // Bridge: attach via registry
              attachToEntity(state.world, eid, compName, values as Record<string, any>);
              for (const [prop, val] of Object.entries(
                values as Record<string, any>
              )) {
                if (comp[prop]) {
                  comp[prop][eid] = val;
                  initLog.push(`${prop}=${val} (explicit)`);
                }
              }
            }
          }
        }

        if (initLog.length > 0) {
          console.log(
            `    [Init] ${ent.name}: ${initLog.slice(0, 6).join(", ")}${
              initLog.length > 6 ? "..." : ""
            }`
          );
        }
      }
    } catch (e) {
      console.error(`  [Exec] createEntity failed: ${ent.name}`, e);
      actions.push({ success: false, result: null, error: String(e) });
    }
  }

  // Step 3: Create all systems (use AI to generate the code)
  for (const sys of design.systems || []) {
    try {
      // Use AI to generate the actual system code from the design logic
      const systemCode = await generateSystemCode(sys, design);
      const filePath = await writeSystemFile({
        name: sys.name,
        description: sys.purpose,
        frequency: sys.frequency || 1,
        code: systemCode,
      });
      const loaded = await loadSystemFromFile(filePath);
      if (loaded) {
        loaded.active = true;
        state.fileSystems.push(loaded);
        console.log(`  [Exec] createFileSystem: ${sys.name} (active)`);
        actions.push({ success: true, result: { name: sys.name } });
      } else {
        console.error(`  [Exec] createFileSystem: ${sys.name} failed to load`);
        actions.push({ success: false, result: null, error: "Failed to load system" });
      }
    } catch (e) {
      console.error(`  [Exec] createFileSystem failed: ${sys.name}`, e);
      actions.push({ success: false, result: null, error: String(e) });
    }
  }

  console.log(`[GodAgent] Execution complete: ${actions.length} actions`);
  return actions;
}

// Generate system code from design using AI
async function generateSystemCode(
  sys: { name: string; purpose: string; frequency: number; logic: string },
  design: DesignDocument
): Promise<string> {
  const componentList = (design.components || [])
    .map(
      (c) =>
        `${c.name}: ${
          Object.entries(c.properties || {})
            .map(([k, v]) => `${k}(${v})`)
            .join(", ") || "value(number)"
        }`
    )
    .join("\n");

  const entityList = (design.entities || [])
    .map(
      (e) =>
        `${e.name} (${e.type}): components=[${
          e.components?.join(", ") || "none"
        }]`
    )
    .join("\n");

  const prompt = `Generate TypeScript code for an ECS system. Return ONLY the code body (no function declaration, no imports).

SYSTEM: ${sys.name}
PURPOSE: ${sys.purpose}
LOGIC: ${sys.logic || sys.purpose}

DYNAMIC COMPONENTS (created for this simulation):
${componentList}

ENTITIES:
${entityList}

⚠️ CRITICAL RULES - READ CAREFULLY:

1. The components listed above (${(design.components || [])
    .map((c) => c.name)
    .join(", ")}) are DYNAMIC components.
2. ONLY ctx.components.Name is available as a built-in component.
3. NEVER write ctx.components.Population or ctx.components.Consumer - these don't exist!
4. ALWAYS query by Name, then filter by checking dynamic data.

CORRECT PATTERN:
const Population = ctx.getDynamic("Population");
const Consumer = ctx.getDynamic("Consumer");
if (!Population || !Consumer) return;

const { Name } = ctx.components;
// Query by Name (built-in), then filter entities that have the dynamic data
const entities = Array.from(ctx.query(world, [Name])).filter(eid =>
  Population.count?.[eid] !== undefined
);

for (const eid of entities) {
  const count = Population.count[eid] || 0;
  Population.count[eid] = count + 1;
}

WRONG - DO NOT DO THIS:
// ctx.components.Population - WRONG! Population is dynamic, not built-in!
// ctx.query(world, [Population]) - WRONG! Dynamic components can't be queried!

Return ONLY the code (no markdown, no explanation):`;

  try {
    const response = await generateText({
      model: executorModel,
      messages: [{ role: "user", content: prompt }],
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: EXECUTOR_THINKING_LEVEL,
          },
        },
      },
    });

    let code = response.text.trim();
    // Remove markdown if present
    if (code.startsWith("```")) {
      code = code
        .replace(/```(?:typescript|ts|javascript|js)?\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    }
    return code;
  } catch (e) {
    console.error(`Failed to generate code for ${sys.name}:`, e);
    // Return a placeholder that logs
    return `ctx.log("System ${sys.name} not yet implemented");`;
  }
}

// Test the simulation and analyze health
interface EntitySnapshot {
  eid: number;
  name: string;
  components: Record<string, Record<string, unknown>>;
}

interface TickSnapshot {
  tick: number;
  entities: EntitySnapshot[];
  fixes: string[];
  errors: string[];
}

interface SimulationHealth {
  healthy: boolean;
  issues: string[];
  valueChanges: Map<string, { min: number; max: number; changed: boolean }>;
  systemErrors: string[];
  simulationLog: TickSnapshot[];
}

async function testSimulationHealth(
  state: GodAgentState,
  testTicks: number = 10
): Promise<SimulationHealth> {
  const health: SimulationHealth = {
    healthy: true,
    issues: [],
    valueChanges: new Map(),
    systemErrors: [],
    simulationLog: [],
  };

  // Collect initial values
  const initialValues: Map<string, Map<number, number>> = new Map();
  for (const compDef of listDynamicComponents()) {
    const comp = getDynamicComponent(compDef.name);
    if (!comp) continue;
    for (const [prop, propType] of Object.entries(compDef.properties)) {
      if (propType !== "number") continue;
      const key = `${compDef.name}.${prop}`;
      const values = new Map<number, number>();
      if (comp[prop]) {
        for (let eid = 0; eid < (comp[prop].length || 100); eid++) {
          if (
            comp[prop][eid] !== undefined &&
            typeof comp[prop][eid] === "number"
          ) {
            values.set(eid, comp[prop][eid]);
          }
        }
      }
      initialValues.set(key, values);
      health.valueChanges.set(key, {
        min: Infinity,
        max: -Infinity,
        changed: false,
      });
    }
  }

  // Helper to capture entity state snapshot
  const captureSnapshot = (
    tick: number,
    fixes: string[],
    errors: string[]
  ): TickSnapshot => {
    const entities: EntitySnapshot[] = [];
    const allEntities = query(state.world, [Name]);

    for (const eid of allEntities) {
      const name = Name.value[eid] || `Entity_${eid}`;
      // Skip GodAI itself
      if (
        name.toLowerCase().includes("god") ||
        name.toLowerCase().includes("architect")
      )
        continue;

      const components: Record<string, Record<string, unknown>> = {};

      for (const compDef of listDynamicComponents()) {
        const comp = getDynamicComponent(compDef.name);
        if (!comp) continue;

        // Check if entity has this component by checking if any property has a value
        let hasComponent = false;
        const compData: Record<string, unknown> = {};

        for (const [prop, propType] of Object.entries(compDef.properties)) {
          if (comp[prop] && comp[prop][eid] !== undefined) {
            hasComponent = true;
            compData[prop] = comp[prop][eid];
          }
        }

        if (hasComponent) {
          components[compDef.name] = compData;
        }
      }

      if (Object.keys(components).length > 0) {
        entities.push({ eid, name, components });
      }
    }

    return { tick, entities, fixes, errors };
  };

  // Capture initial state
  health.simulationLog.push(captureSnapshot(0, [], []));

  // Run simulation with snapshots
  for (let i = 0; i < testTicks; i++) {
    const { fixes } = await tickWorldAsync(state, 1000);
    const tickErrors: string[] = [];

    if (fixes.failed.length > 0) {
      health.systemErrors.push(...fixes.failed);
      tickErrors.push(...fixes.failed);
    }

    // Capture snapshot every tick for detailed analysis
    health.simulationLog.push(captureSnapshot(i + 1, fixes.fixed, tickErrors));
  }

  // Check for value changes
  let anyValueChanged = false;
  for (const compDef of listDynamicComponents()) {
    const comp = getDynamicComponent(compDef.name);
    if (!comp) continue;
    for (const [prop, propType] of Object.entries(compDef.properties)) {
      if (propType !== "number") continue;
      const key = `${compDef.name}.${prop}`;
      const initial = initialValues.get(key);
      const tracking = health.valueChanges.get(key);
      if (!initial || !tracking || !comp[prop]) continue;

      for (const [eid, initVal] of initial) {
        const currentVal = comp[prop][eid];
        if (currentVal !== undefined && typeof currentVal === "number") {
          tracking.min = Math.min(tracking.min, currentVal);
          tracking.max = Math.max(tracking.max, currentVal);
          if (Math.abs(currentVal - initVal) > 0.01) {
            tracking.changed = true;
            anyValueChanged = true;
          }
        }
      }
    }
  }

  // Analyze health
  if (!anyValueChanged) {
    health.healthy = false;
    health.issues.push(
      "No values changed during simulation - systems may not be updating data"
    );
  }

  if (health.systemErrors.length > 0) {
    health.healthy = false;
    health.issues.push(
      `Systems with errors: ${health.systemErrors.join(", ")}`
    );
  }

  // Check for stuck values (all at 0 or 100)
  for (const [key, tracking] of health.valueChanges) {
    if (
      tracking.min === tracking.max &&
      (tracking.min === 0 || tracking.min === 100)
    ) {
      health.issues.push(`${key} stuck at ${tracking.min}`);
    }
  }

  return health;
}

// Format simulation log for LLM consumption
function formatSimulationLog(log: TickSnapshot[]): string {
  if (log.length === 0) return "No simulation data captured";

  const lines: string[] = [];

  // Show first tick (initial state), last tick, and a sample from the middle
  const samplesToShow = [0];
  if (log.length > 1) samplesToShow.push(Math.floor(log.length / 2));
  if (log.length > 2) samplesToShow.push(log.length - 1);

  for (const idx of samplesToShow) {
    const snapshot = log[idx];
    if (!snapshot) continue;

    lines.push(`--- Tick ${snapshot.tick} ---`);

    for (const entity of snapshot.entities) {
      const compStrings: string[] = [];
      for (const [compName, compData] of Object.entries(entity.components)) {
        const values = Object.entries(compData)
          .map(
            ([k, v]) =>
              `${k}=${typeof v === "number" ? (v as number).toFixed(1) : v}`
          )
          .join(", ");
        compStrings.push(`${compName}(${values})`);
      }
      lines.push(`  ${entity.name}: ${compStrings.join(" | ")}`);
    }

    if (snapshot.fixes.length > 0) {
      lines.push(`  [Auto-fixes: ${snapshot.fixes.join(", ")}]`);
    }
    if (snapshot.errors.length > 0) {
      lines.push(`  [ERRORS: ${snapshot.errors.join(", ")}]`);
    }
  }

  return lines.join("\n");
}

// Diagnose issues and suggest fixes
async function diagnoseSimulationIssues(
  state: GodAgentState,
  design: DesignDocument,
  challenge: string,
  health: SimulationHealth
): Promise<{ diagnosis: string; fixes: string[] }> {
  console.log("\n[GodAgent] 🔬 Diagnosing simulation issues...\n");

  const simulationOutput = formatSimulationLog(health.simulationLog);

  const prompt = `You are diagnosing why an ECS simulation isn't working correctly.

ORIGINAL CHALLENGE:
${challenge}

DESIGN:
${JSON.stringify(design, null, 2)}

SIMULATION OUTPUT (entity states at key ticks):
${simulationOutput}

OBSERVED ISSUES:
${health.issues.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

SYSTEM ERRORS:
${health.systemErrors.length > 0 ? health.systemErrors.join("\n") : "None"}

VALUE CHANGES SUMMARY:
${Array.from(health.valueChanges.entries())
  .filter(([_, v]) => v.min !== Infinity)
  .map(
    ([k, v]) =>
      `${k}: min=${v.min.toFixed(1)}, max=${v.max.toFixed(1)}, changed=${
        v.changed
      }`
  )
  .join("\n")}

Look at the actual simulation output to understand what's happening. Are values changing? Are they stuck? Are behaviors switching?

Diagnose the root cause and suggest specific fixes.

OUTPUT FORMAT - Return JSON:
{
  "diagnosis": "Brief explanation of what's wrong based on the simulation output",
  "fixes": ["Specific fix 1", "Specific fix 2", ...]
}

Return ONLY the JSON, no markdown fences.`;

  try {
    const response = await generateText({
      model: plannerModel,
      prompt,
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: REVIEW_THINKING_LEVEL,
          },
        },
      },
    });

    let text = response.text.trim();
    if (text.startsWith("```")) {
      text = text
        .replace(/```json?\n?/g, "")
        .replace(/```$/g, "")
        .trim();
    }

    const result = JSON.parse(text);
    console.log(`[GodAgent] 🩺 Diagnosis: ${result.diagnosis}`);
    return result;
  } catch (error) {
    console.error("[GodAgent] Diagnosis failed:", error);
    return { diagnosis: "Could not diagnose", fixes: [] };
  }
}

// Combined design + execute flow for complex challenges
export async function godDesignAndExecute(
  state: GodAgentState,
  challenge: string,
  options: {
    skipReview?: boolean;
    maxRefinements?: number;
    maxIterations?: number;
    testTicks?: number;
  } = {}
): Promise<{
  design: DesignDocument | null;
  reasoning: string;
  actions: ToolResult[];
}> {
  const {
    skipReview = !ENABLE_DESIGN_REVIEW,
    maxRefinements = 2,
    maxIterations = 3, // Test and iterate up to N times
    testTicks = 10, // Run this many ticks per test
  } = options;

  // Phase 1: Design
  let { design, reasoning } = await designSolution(state, challenge);

  if (!design) {
    console.log(
      "[GodAgent] ❌ Design failed, falling back to direct execution"
    );
    const result = await godThink(state, challenge);
    return { design: null, reasoning, actions: result.actions };
  }

  // Phase 2: Review & Refine (unless skipped)
  if (!skipReview) {
    let refinements = 0;
    while (refinements < maxRefinements) {
      const review = await reviewDesign(design, challenge);

      if (review.approved && review.issues.length === 0) {
        console.log("[GodAgent] ✅ Design approved after review");
        break;
      }

      if (review.issues.length > 0 || review.suggestions.length > 0) {
        design = await refineDesign(
          design,
          challenge,
          review.issues,
          review.suggestions
        );
        refinements++;
      } else {
        break;
      }
    }
  }

  // Phase 3: Execute
  let actions = await executeDesign(state, design);

  // Phase 4: Test & Iterate (run simulation, check health, fix if needed)
  if (maxIterations > 0 && testTicks > 0) {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      console.log(
        `\n[GodAgent] 🧪 Test Iteration ${
          iteration + 1
        }/${maxIterations} (${testTicks} ticks)...`
      );

      const health = await testSimulationHealth(state, testTicks);

      if (health.healthy) {
        console.log(
          "[GodAgent] ✅ Simulation is healthy - values changing, no errors"
        );
        break;
      }

      console.log(
        `[GodAgent] ⚠️ Issues found: ${health.issues.slice(0, 2).join("; ")}`
      );

      // Diagnose and get fix suggestions
      const { diagnosis, fixes } = await diagnoseSimulationIssues(
        state,
        design,
        challenge,
        health
      );

      if (fixes.length === 0) {
        console.log("[GodAgent] No fixes suggested, continuing...");
        break;
      }

      // Refine design based on diagnosis
      console.log(`[GodAgent] 🔧 Applying ${fixes.length} suggested fixes...`);
      design = await refineDesign(design, challenge, fixes, []);

      // Re-execute with refined design
      // Clear old systems first
      state.fileSystems = [];
      actions = await executeDesign(state, design);
    }
  }

  return { design, reasoning, actions };
}

export async function godThink(
  state: GodAgentState,
  prompt: string,
  options: { mode?: "collaborate" | "execute" } = {}
): Promise<{ thinking: string; actions: ToolResult[] }> {
  const systemPrompt =
    options.mode === "execute"
      ? buildCommandSystemPrompt(state)
      : buildSystemPrompt(state);
  const tools = buildTools(state);
  const coreToolNames = [
    "listEntities",
    "queryEntities",
    "createRoom",
    "createAndPopulateRoom",
    "createAgent",
    "createObject",
    "listSystems",
    "bakeNewSystem",
    "getTaskStatus",
    "getTaskQueueSummary",
    "modifyBakedSystem",
    "activateSystem",
    "deactivateSystem",
    "listObjectTypes",
    "defineObjectType",
    "spawn",
    "listRules",
    "defineRule",
    "createAffordance",
    "createTrait",
    "createRelationshipType",
    "addEntityRelationship",
    "listVocabulary",
  ] as const;

  const coreTools: Record<string, any> = {};
  for (const name of coreToolNames) {
    const t = (tools as any)[name];
    if (t) coreTools[name] = t;
  }

  console.log("\n[GodAgent] Thinking...\n");
  console.log("[GodAgent] Prompt:", prompt.slice(0, 100) + "...");

  const actions: ToolResult[] = [];
  let thinking = "";

  const baseMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...state.conversationHistory.slice(-10).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: prompt },
  ];

  const maxAttempts = 3;
  let lastResponse: any = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[GodAgent] Calling Gemini... (attempt ${attempt}/${maxAttempts})`);

      const response = await generateText({
        model,
        system: systemPrompt,
        messages: baseMessages,
        tools: attempt === 1 ? tools : coreTools,
        stopWhen: stepCountIs(15),
        temperature: attempt === 1 ? 0.6 : 0.2,
      });
      lastResponse = response;
      console.log("[GodAgent] Gemini response received");

      thinking = "";
      if (response.reasoningText) thinking = response.reasoningText;
      if (response.text) thinking += (thinking ? "\n\n" : "") + response.text;

      const attemptActions: ToolResult[] = [];

      if (response.steps) {
        for (const step of response.steps) {
          if (!step.toolCalls || !step.toolResults) continue;
          for (const tc of step.toolCalls) {
            const result = step.toolResults.find(
              (r: any) => r.toolCallId === tc.toolCallId
            );
            if (!result) continue;

            attemptActions.push(result.output as ToolResult);
            const toolResult = result.output as ToolResult;
            if (
              toolResult.success &&
              ![
                "recordMemory",
                "searchMemories",
                "reflect",
                "makePlan",
                "advancePlanStep",
                "getActivePlanStatus",
                "abandonCurrentPlan",
              ].includes(tc.toolName)
            ) {
              addMemory(
                state,
                "action",
                `${tc.toolName}: ${JSON.stringify((tc as any).input).slice(0, 100)}`,
                {
                  importance: 5,
                  tags: ["tool", tc.toolName],
                }
              );
            }
          }
        }
      }

      actions.push(...attemptActions);

      // If we got tool results, we're done.
      if (attemptActions.length > 0) break;

      // Retry on common Gemini tool-call failures (e.g., MALFORMED_FUNCTION_CALL).
      const rawFinishReason = response?.steps?.[0]?.rawFinishReason;
      const finishReason = response?.steps?.[0]?.finishReason;
      const shouldRetry = rawFinishReason === "MALFORMED_FUNCTION_CALL" || finishReason === "error";

      console.warn("[GodAgent] WARNING: No tool calls in response!");
      console.warn("[GodAgent] Response text:", response.text?.slice(0, 500) || "(no text)");
      console.warn("[GodAgent] Steps:", response.steps?.length || 0);
      if (response.steps && response.steps.length > 0) {
        console.warn("[GodAgent] First step:", JSON.stringify(response.steps[0]).slice(0, 300));
      }

      if (!shouldRetry || attempt === maxAttempts) break;

      // Mutate the final user message (same prompt) with an explicit tool-call requirement.
      const retrySuffix = [
        "",
        "IMPORTANT: Your previous response contained no usable tool calls.",
        "You MUST respond by calling tools (no free-form prose) until the task is completed.",
        "If a tool call fails, correct it and retry with a valid tool call payload.",
        rawFinishReason ? `rawFinishReason: ${rawFinishReason}` : "",
      ].filter(Boolean).join("\n");
      (baseMessages[baseMessages.length - 1] as any).content = `${prompt}\n\n${retrySuffix}`;
    } catch (error) {
      lastError = error;
      console.error(`[GodAgent] Error (attempt ${attempt}/${maxAttempts}):`, error);
      thinking = `Error: ${error}`;
      if (attempt < maxAttempts) continue;

      addMemory(state, "observation", `Error occurred: ${error}`, {
        importance: 8,
        tags: ["error"],
      });
    }
  }

  if (actions.length === 0 && lastError) {
    addMemory(state, "observation", `Error occurred: ${lastError}`, {
      importance: 8,
      tags: ["error"],
    });
  }

  addMemory(state, "observation", `User request: ${prompt.slice(0, 200)}`, {
    importance: 6,
    tags: ["user-request"],
  });

  state.conversationHistory.push({ role: "user", content: prompt });
  state.conversationHistory.push({ role: "assistant", content: thinking });
  state.thinkingLog.push(thinking);

  GodAgent.tick[state.eid]++;

  return { thinking, actions };
}

export async function godCommand(
  state: GodAgentState,
  command: string
): Promise<ToolResult[]> {
  const prev = (state._commandLock ?? Promise.resolve()).catch(() => {});
  let release: (() => void) = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  state._commandLock = prev.then(() => current);

  await prev;
  try {
    const { actions } = await godThink(state, command, { mode: "execute" });
    return actions;
  } finally {
    release();
  }
}

export function tickWorld(
  state: GodAgentState,
  delta: number = 1000
): Array<{ type: string; data: any; timestamp: number }> {
  state.tick++;
  return runWorldTickAt(state, state.tick, delta);
}

/**
 * Run a world tick at an explicit tick number.
 * This is useful for dual-loop runtimes that own the tick counter externally.
 */
export function runWorldTickAt(
  state: GodAgentState,
  tick: number,
  delta: number = 1000
): Array<{ type: string; data: any; timestamp: number }> {
  state.tick = tick;
  // Run baked systems from registry
  runSystems(state.world, state.systemRegistry, tick, delta);
  runAsyncSystems(state.world, state.systemRegistry, tick, delta);
  // Run file-based systems (NeedsDecay, SeekNeeds, RandomWander, etc.)
  if (state.fileSystems.length > 0) {
    runLoadedSystems(
      state.world,
      state.fileSystems,
      state.systemRegistry,
      tick,
      delta
    );
  }
  // Run interventions - event-driven precondition→effect rules
  runInterventions(state.world, state.interventionRegistry, tick);
  // Post-tick effectiveness analysis (conflict detection + cleanup)
  runPostTickAnalysis(tick);
  return consumeEvents(state.systemRegistry);
}

// Async version that also fixes runtime errors and handles persistence
export async function tickWorldAsync(
  state: GodAgentState,
  delta: number = 1000
): Promise<{
  events: Array<{ type: string; data: any; timestamp: number }>;
  fixes: { fixed: string[]; failed: string[] };
  saved?: boolean;
  snapshot?: boolean;
}> {
  const events = tickWorld(state, delta);

  // Check for and fix any systems that errored
  const systemsToFix = getSystemsNeedingFix();
  let fixes = { fixed: [] as string[], failed: [] as string[] };

  if (systemsToFix.length > 0) {
    console.log(`[GodAgent] ${systemsToFix.length} system(s) need fixing...`);
    fixes = await fixAllQueuedSystems(state.fileSystems);
    if (fixes.fixed.length > 0) {
      console.log(`[GodAgent] Fixed: ${fixes.fixed.join(", ")}`);
      state.systemRegistry.logs.push(
        `[AutoFix] Fixed systems: ${fixes.fixed.join(", ")}`
      );
    }
    if (fixes.failed.length > 0) {
      console.log(`[GodAgent] Failed to fix: ${fixes.failed.join(", ")}`);
      state.systemRegistry.logs.push(
        `[AutoFix] Failed to fix: ${fixes.failed.join(", ")}`
      );
    }
  }

  // Auto-persistence if simulation is attached
  let saved = false;
  let snapshot = false;
  if (state.simulation) {
    const sim = state.simulation;
    sim.updateTick(state.tick);

    // Log events to simulation
    for (const event of events) {
      sim.logEvent(event.type, event.data);
    }

    // Check if we should snapshot (takes priority over save)
    if (sim.shouldSnapshot(state.tick)) {
      await sim.saveSnapshot(state.world, state.systemRegistry);
      snapshot = true;
      saved = true;
    } else if (sim.shouldAutosave(state.tick)) {
      await sim.saveAll(state.world, state.systemRegistry);
      saved = true;
    }
  }

  return { events, fixes, saved, snapshot };
}

export function getWorldState(state: GodAgentState): string {
  const entities = state.tools.listEntities().result as Array<{
    name: string;
    id: number;
  }>;
  const systems = listSystems(state.systemRegistry);

  const lines = ["WORLD STATE:", ""];

  lines.push("SYSTEMS:");
  for (const sys of systems) {
    lines.push(
      `  ${sys.active ? "▶" : "⏸"} ${sys.name} (${sys.frequency}ms): ${
        sys.description
      }`
    );
  }
  lines.push("");

  lines.push("ENTITIES:");
  for (const entity of entities) {
    lines.push(`[${entity.name}] (id: ${entity.id})`);

    for (const compName of Object.keys(AllComponents)) {
      const values = state.tools.getComponentValues({
        entityName: entity.name,
        componentName: compName,
      });
      if (
        values.success &&
        values.result &&
        Object.keys(values.result).length > 0
      ) {
        const nonEmpty = Object.fromEntries(
          Object.entries(values.result).filter(
            ([_, v]) => v !== undefined && v !== "" && v !== 0
          )
        );
        if (Object.keys(nonEmpty).length > 0) {
          lines.push(`  ${compName}: ${JSON.stringify(nonEmpty)}`);
        }
      }
    }

    for (const relName of Object.keys(AllRelations)) {
      const targets = state.tools.getRelationTargets({
        subjectName: entity.name,
        relationName: relName,
      });
      if (targets.success && targets.result.targets.length > 0) {
        lines.push(`  --[${relName}]--> ${targets.result.targets.join(", ")}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
