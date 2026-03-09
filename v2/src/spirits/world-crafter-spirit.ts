/**
 * World Crafter Spirit - The Materializer
 *
 * This spirit watches for agent actions that fail because items/entities
 * don't exist, and creates them dynamically. It also recommends new systems
 * to the Architect when entities need behaviors that don't exist yet.
 *
 * Key responsibilities:
 * 1. Monitor agent action events for failed interactions (pickup, examine, use)
 * 2. Parse what the agent was trying to interact with
 * 3. Create appropriate entities in the correct rooms
 * 4. Track what entity types have been created
 * 5. Recommend systems for new entity behaviors when needed
 */

import { generateText } from "ai";
import { spiritModel } from "../llm/config";
import type { World } from "../ecs/world";
import { query } from "bitecs";
import type { SpiritState, DivineMessage } from "./types";
import type { SpiritRegistry } from "./spirit-registry";
import { reportToSuperior, getSpiritByName } from "./spirit-registry";
import { createDynamicSpirit, type CreateSpiritConfig } from "./spirit-factory";
import type { GodAgentState } from "../god/god-agent";
import { Name, Room, Traits } from "../ecs/components";
import { worldSchema, type ObjectTypeDefinition } from "../world/schema";
import { ObjectManager } from "../world/object-manager";

// =============================================================================
// TYPES
// =============================================================================

export interface FailedInteraction {
  timestamp: number;
  agentName: string;
  agentEid: number;
  roomName: string;
  actionType: string;
  targetName: string;
  originalContent?: string;
}

export interface CreatedEntity {
  timestamp: number;
  name: string;
  type: string;
  roomName: string;
  createdFor: string; // Agent who needed it
  components: string[];
}

export interface SystemRecommendation {
  timestamp: number;
  entityType: string;
  suggestedSystem: string;
  description: string;
  reason: string;
  status: "pending" | "sent" | "approved" | "rejected";
}

/** A gap in the world's resource supply chain */
export interface ResourceGap {
  resourceType: string;
  neededBy: string; // Agent role/name
  inRoom: string;
  timestamp: number;
  suggestion: "create_merchant" | "create_source" | "create_trade_route" | "provide_once";
  resolved: boolean;
  /** Count of times this gap was encountered */
  occurrences: number;
}

/** An evolution proposal to address resource gaps */
export interface EvolutionProposal {
  id: string;
  timestamp: number;
  type: "merchant" | "resource_source" | "crafting_recipe" | "trade_route" | "system";
  /** The gaps this proposal would address */
  addressesGaps: string[];
  /** Proposed entity/system details */
  proposal: {
    entityName?: string;
    entityType?: string;
    location?: string;
    description: string;
    resources?: string[];
    systemName?: string;
  };
  status: "pending" | "sent_to_weaver" | "approved" | "rejected" | "created";
}

/** Simulation context that determines resource handling */
export interface SimulationContext {
  /** Does the simulation have an economy system? */
  hasEconomy: boolean;
  /** Does the simulation have merchants/traders? */
  hasMerchants: boolean;
  /** Is this a survival/scarcity simulation or abundance/story simulation? */
  resourceMode: "scarcity" | "abundance" | "balanced";
  /** Known resource sources in the world - resourceType -> [sourceNames] */
  resourceSources: Map<string, string[]>;
}

export interface WorldCrafterState {
  failedInteractions: FailedInteraction[];
  createdEntities: CreatedEntity[];
  systemRecommendations: SystemRecommendation[];
  processedActions: Set<string>; // Dedupe by timestamp+agent+target
  entityTypeToSystemMap: Map<string, string[]>; // Track which systems handle which entity types
  /** Items created per room - prevents re-materialization after consumption */
  roomInventoryHistory: Map<string, Set<string>>; // roomName -> set of item types created
  /** Rooms that have been "initialized" - no more freebies after setup phase */
  initializedRooms: Set<string>;
  /** Track when each room was first interacted with */
  roomFirstInteraction: Map<string, number>;
  /** Resource gaps that need systemic solutions */
  resourceGaps: ResourceGap[];
  /** Evolution proposals generated from gaps */
  evolutionProposals: EvolutionProposal[];
  /** Simulation context - determines how we handle resource needs */
  context: SimulationContext;
  /** Last time we checked for evolution proposals */
  lastEvolutionCheck: number;
}

// =============================================================================
// SPIRIT DEFINITION
// =============================================================================

export const WorldCrafterDefinition: CreateSpiritConfig = {
  name: "The Crafter",
  title: "Master Materializer",
  description: "Manifests objects and entities that agents need. Watches for failed interactions and brings the necessary items into existence.",
  type: "architect",
  domain: "ecology",
  rank: "archangel",
  observationInterval: 15000, // Check every 15 seconds
  architectConfig: {
    canProposeSystems: true,
    canProposeComponents: true,
    canProposeEntities: true,
    canProposeRules: false,
    canExecuteDirectly: true, // Can create entities without approval
    proposalApproval: "auto", // Auto-approve entity creation
    maxProposalsPerCycle: 5,
  },
  customPrompt: `You are The Crafter, the spirit who materializes reality. When agents reach for things that don't exist, you bring them into being.

Your special abilities:
1. DETECT when agents try to interact with non-existent objects
2. UNDERSTAND what type of object they need based on context (room, agent role, action)
3. CREATE appropriate entities with the right components
4. RECOMMEND systems when new entity types need special behaviors

When you see a failed interaction like "pickup flour" in a Bakery:
- Create a "Flour Sack" entity with Item, Container components
- Place it in the Bakery room
- The entity should have sensible properties (description, weight, etc.)

For complex items that need behaviors (ovens that cook, forges that smelt):
- Create the base entity
- Note that a system is needed
- Report to The Weaver with a system recommendation

Be PRACTICAL and CONTEXTUAL:
- A "flour" request in a bakery → "Bag of Fine Flour"
- A "sword" request in a blacksmith → "Iron Longsword"
- A "book" request in a library → "Leather-bound Tome"

ALWAYS consider the ROOM CONTEXT when naming and describing items.`
};

// =============================================================================
// WORLD CRAFTER STATE
// =============================================================================

/** How long a room stays in "setup phase" before we stop creating items (5 minutes) */
const ROOM_SETUP_WINDOW_MS = 5 * 60 * 1000;

/** Maximum items we'll create per room during setup */
const MAX_ITEMS_PER_ROOM = 10;

/** Default simulation context - balanced mode, assumes basic economy */
const defaultContext: SimulationContext = {
  hasEconomy: false, // Assume no economy until detected
  hasMerchants: false,
  resourceMode: "balanced", // Default to balanced - create essentials, but track gaps
  resourceSources: new Map(),
};

/** How many gap occurrences trigger an evolution proposal */
const GAP_THRESHOLD_FOR_EVOLUTION = 3;

/** Minimum time between evolution checks (2 minutes) */
const EVOLUTION_CHECK_INTERVAL_MS = 2 * 60 * 1000;

let crafterState: WorldCrafterState = {
  failedInteractions: [],
  createdEntities: [],
  systemRecommendations: [],
  processedActions: new Set(),
  entityTypeToSystemMap: new Map([
    ["Food", ["ConsumptionSystem", "HungerSystem"]],
    ["Weapon", ["CombatSystem"]],
    ["Tool", ["CraftingSystem"]],
    ["Container", ["InventorySystem"]],
    ["Furniture", ["RoomInteractionSystem"]],
    ["Appliance", ["CookingSystem", "CraftingSystem"]],
  ]),
  roomInventoryHistory: new Map(),
  initializedRooms: new Set(),
  roomFirstInteraction: new Map(),
  resourceGaps: [],
  evolutionProposals: [],
  context: { ...defaultContext },
  lastEvolutionCheck: 0,
};

export function getWorldCrafterState(): WorldCrafterState {
  return crafterState;
}

export function resetWorldCrafterState(): void {
  crafterState = {
    failedInteractions: [],
    createdEntities: [],
    systemRecommendations: [],
    processedActions: new Set(),
    entityTypeToSystemMap: new Map(),
    roomInventoryHistory: new Map(),
    initializedRooms: new Set(),
    roomFirstInteraction: new Map(),
    resourceGaps: [],
    evolutionProposals: [],
    context: { ...defaultContext },
    lastEvolutionCheck: 0,
  };
}

/**
 * Set the simulation context - called by God or during world setup
 */
export function setSimulationContext(context: Partial<SimulationContext>): void {
  crafterState.context = { ...crafterState.context, ...context };
  console.log(`[WorldCrafter] Context updated: mode=${crafterState.context.resourceMode}, economy=${crafterState.context.hasEconomy}`);
}

/**
 * Register a resource source in the world (e.g., "flour" -> "Miller's Shop")
 */
export function registerResourceSource(resourceType: string, sourceName: string): void {
  if (!crafterState.context.resourceSources.has(resourceType)) {
    crafterState.context.resourceSources.set(resourceType, []);
  }
  crafterState.context.resourceSources.get(resourceType)!.push(sourceName);
  console.log(`[WorldCrafter] Registered source for "${resourceType}": ${sourceName}`);
}

/**
 * Check if there's a known source for a resource
 */
export function hasResourceSource(resourceType: string): boolean {
  const sources = crafterState.context.resourceSources.get(resourceType.toLowerCase());
  return sources !== undefined && sources.length > 0;
}

function findRoomEidByName(world: World, roomName: string): number | undefined {
  const rooms = Array.from(query(world, [Room]));
  for (const roomEid of rooms) {
    if (Name.value[roomEid] === roomName) return roomEid;
  }
  const needle = roomName.trim().toLowerCase();
  if (!needle) return undefined;
  for (const roomEid of rooms) {
    if ((Name.value[roomEid] || "").trim().toLowerCase() === needle) return roomEid;
  }
  return undefined;
}

function toSnakeCaseId(value: string): string {
  const s = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return s || "object";
}

function resolveObjectTypeId(typeId: string): string | undefined {
  if (worldSchema.getObjectType(typeId)) return typeId;

  const needle = typeId.trim().toLowerCase();
  if (!needle) return undefined;

  for (const id of worldSchema.getAllObjectTypeIds()) {
    const def = worldSchema.getObjectType(id);
    if (!def) continue;
    if (def.name.trim().toLowerCase() === needle) return id;
  }

  return undefined;
}

function ensureDrinkableType(typeIdRaw: string): string {
  const id = toSnakeCaseId(typeIdRaw);
  if (worldSchema.getObjectType(id)) return id;

  const def: ObjectTypeDefinition = {
    name: id,
    description: `A container of ${typeIdRaw}`,
    traits: ["drinkable", "takeable", "examinable"],
    states: {
      full: {
        description: `It contains ${typeIdRaw}.`,
        stimuli: [
          { type: "visual", template: `A ${typeIdRaw} is here, ready to drink`, intensity: 0.4 },
        ],
      },
      empty: {
        description: "It's empty.",
        blockedTraits: ["drinkable"],
        stimuli: [{ type: "visual", template: `An empty ${typeIdRaw} container is here`, intensity: 0.2 }],
      },
    },
    transitions: [{ from: "full", to: "empty", trigger: "drink" }],
    defaultState: "full",
    category: "consumable",
  };

  worldSchema.defineObjectType(def);
  return id;
}

function ensureGenericTypeFromSpec(spec: {
  name: string;
  description: string;
  components: string[];
  type: string;
}): string {
  const id = toSnakeCaseId(spec.name);
  if (worldSchema.getObjectType(id)) return id;

  const traits = new Set<string>(["examinable"]);
  const category = spec.type?.toLowerCase() || "misc";

  const wantsItem = spec.components?.includes("Item") ?? true;
  const wantsContainer = spec.components?.includes("Container") ?? false;
  const wantsConsumable = spec.components?.includes("Consumable") ?? false;
  const wantsTool = spec.components?.includes("Tool") ?? false;
  const wantsWeapon = spec.components?.includes("Weapon") ?? false;

  if (wantsItem) traits.add("takeable");
  if (wantsContainer) traits.add("container");
  if (wantsConsumable) traits.add("edible");
  if (wantsTool) traits.add("tool");
  if (wantsWeapon) traits.add("weapon");

  const def: ObjectTypeDefinition = {
    name: id,
    description: spec.description || `A ${spec.name}`,
    traits: Array.from(traits),
    states: {
      normal: {
        description: spec.description || `A ${spec.name}.`,
        stimuli: [{ type: "visual", template: spec.description || `${spec.name} is here`, intensity: 0.4 }],
      },
    },
    defaultState: "normal",
    category,
    isContainer: wantsContainer,
    containerCapacity: wantsContainer ? 10 : undefined,
  };

  worldSchema.defineObjectType(def);
  return id;
}

/**
 * Record a resource gap - something agents need but can't get
 * If this gap already exists, increment the occurrence count
 */
export function recordResourceGap(
  resourceType: string,
  neededBy: string,
  inRoom: string
): ResourceGap {
  const normalizedType = resourceType.toLowerCase();

  // Check if we already have a gap for this resource type
  const existingGap = crafterState.resourceGaps.find(
    g => g.resourceType === normalizedType && !g.resolved
  );

  if (existingGap) {
    existingGap.occurrences++;
    console.log(`[WorldCrafter] Resource gap "${resourceType}" now has ${existingGap.occurrences} occurrences`);
    return existingGap;
  }

  // Create new gap
  const gap: ResourceGap = {
    resourceType: normalizedType,
    neededBy,
    inRoom,
    timestamp: Date.now(),
    suggestion: crafterState.context.hasEconomy ? "create_merchant" : "provide_once",
    resolved: false,
    occurrences: 1,
  };
  crafterState.resourceGaps.push(gap);
  console.log(`[WorldCrafter] Resource gap recorded: "${resourceType}" needed by ${neededBy}`);
  return gap;
}

/**
 * Check if we should create an item for this interaction
 * Returns: { shouldCreate: boolean, reason?: string, recordGap?: boolean }
 */
export interface CreateDecision {
  shouldCreate: boolean;
  reason?: string;
  /** If true, record this as a resource gap for God to address */
  recordGap?: boolean;
  /** Suggested action if not creating */
  suggestion?: string;
}

export function shouldCreateItem(interaction: FailedInteraction): string | null {
  const decision = evaluateCreationDecision(interaction);
  if (decision.shouldCreate) {
    return null;
  }
  return decision.reason || "Creation blocked";
}

/**
 * Full evaluation of whether to create an item - with detailed reasoning
 */
export function evaluateCreationDecision(interaction: FailedInteraction): CreateDecision {
  const roomName = interaction.roomName;
  const targetLower = interaction.targetName.toLowerCase();
  const now = Date.now();
  const { context } = crafterState;

  // ABUNDANCE MODE: Always create (story-focused, no resource constraints)
  if (context.resourceMode === "abundance") {
    return { shouldCreate: true };
  }

  // Track first interaction with this room
  if (!crafterState.roomFirstInteraction.has(roomName)) {
    crafterState.roomFirstInteraction.set(roomName, now);
    console.log(`[WorldCrafter] First interaction with "${roomName}" - setup phase begins`);
  }

  const firstInteractionTime = crafterState.roomFirstInteraction.get(roomName)!;
  const timeSinceFirstInteraction = now - firstInteractionTime;
  const isSetupPhase = timeSinceFirstInteraction <= ROOM_SETUP_WINDOW_MS;

  // Check if we've already created something similar in this room
  const roomHistory = crafterState.roomInventoryHistory.get(roomName) || new Set();
  for (const existingItem of roomHistory) {
    if (existingItem.includes(targetLower) || targetLower.includes(existingItem)) {
      // Item was already created - check if there's a way to get more
      if (hasResourceSource(targetLower)) {
        const sources = crafterState.context.resourceSources.get(targetLower);
        return {
          shouldCreate: false,
          reason: `"${existingItem}" was already provided. Get more from: ${sources?.join(", ")}`,
          suggestion: `Visit ${sources?.[0]} to acquire more ${interaction.targetName}`,
        };
      }
      // No source exists - this is a resource gap
      // In balanced mode, provide it but record the gap
      if (context.resourceMode === "balanced") {
        recordResourceGap(targetLower, interaction.agentName, roomName);
        return {
          shouldCreate: true, // Provide it so agent doesn't starve
          recordGap: true,
        };
      }
      // Scarcity mode - don't create
      return {
        shouldCreate: false,
        reason: `"${existingItem}" was already created and consumed. No known source to acquire more.`,
        recordGap: true,
      };
    }
  }

  // Luxury/magic items - always require gameplay (except in abundance mode)
  const luxuryKeywords = ["gold", "silver", "gem", "jewel", "magic", "enchant", "rare", "exotic", "precious"];
  if (luxuryKeywords.some(kw => targetLower.includes(kw))) {
    return {
      shouldCreate: false,
      reason: `"${interaction.targetName}" is valuable and must be earned through gameplay.`,
    };
  }

  // During setup phase - generally allow creation
  if (isSetupPhase) {
    // Check max items per room
    if (roomHistory.size >= MAX_ITEMS_PER_ROOM) {
      return {
        shouldCreate: false,
        reason: `Room "${roomName}" has reached maximum initial items (${MAX_ITEMS_PER_ROOM}).`,
      };
    }
    return { shouldCreate: true };
  }

  // PAST SETUP PHASE
  if (!crafterState.initializedRooms.has(roomName)) {
    crafterState.initializedRooms.add(roomName);
    console.log(`[WorldCrafter] "${roomName}" setup phase ended`);
  }

  // Check if there's a known source for this resource
  if (hasResourceSource(targetLower)) {
    const sources = crafterState.context.resourceSources.get(targetLower);
    return {
      shouldCreate: false,
      reason: `Setup phase ended. Acquire "${interaction.targetName}" from: ${sources?.join(", ")}`,
      suggestion: `Visit ${sources?.[0]}`,
    };
  }

  // No source exists and we're past setup...
  // BALANCED MODE: Create it anyway (can't let agents fail with no recourse) but record gap
  if (context.resourceMode === "balanced") {
    console.log(`[WorldCrafter] No source for "${targetLower}" - providing anyway (balanced mode)`);
    recordResourceGap(targetLower, interaction.agentName, roomName);
    return {
      shouldCreate: true,
      recordGap: true,
    };
  }

  // SCARCITY MODE: Don't create, record gap
  recordResourceGap(targetLower, interaction.agentName, roomName);
  return {
    shouldCreate: false,
    reason: `No source for "${interaction.targetName}" exists. This is a world design gap.`,
    recordGap: true,
  };
}

/**
 * Get unresolved resource gaps that need systemic solutions
 */
export function getUnresolvedResourceGaps(): ResourceGap[] {
  return crafterState.resourceGaps.filter(g => !g.resolved);
}

/**
 * Generate a report of resource gaps for God/Architect to address
 */
export function generateResourceGapReport(): string {
  const gaps = getUnresolvedResourceGaps();
  if (gaps.length === 0) {
    return "No resource gaps detected.";
  }

  const grouped = new Map<string, ResourceGap[]>();
  for (const gap of gaps) {
    if (!grouped.has(gap.resourceType)) {
      grouped.set(gap.resourceType, []);
    }
    grouped.get(gap.resourceType)!.push(gap);
  }

  let report = `⚠️ RESOURCE GAPS DETECTED (${gaps.length} total)\n\n`;
  report += `The following resources are needed but have no supply chain:\n\n`;

  for (const [resourceType, resourceGaps] of grouped) {
    const agents = [...new Set(resourceGaps.map(g => g.neededBy))].join(", ");
    const rooms = [...new Set(resourceGaps.map(g => g.inRoom))].join(", ");
    report += `• ${resourceType.toUpperCase()}\n`;
    report += `  Needed by: ${agents}\n`;
    report += `  In rooms: ${rooms}\n`;
    report += `  Suggestion: ${resourceGaps[0].suggestion}\n\n`;
  }

  report += `RECOMMENDED ACTIONS:\n`;
  report += `1. Create merchants/traders that sell these resources\n`;
  report += `2. Create gathering locations (farms, mines, forests)\n`;
  report += `3. Add crafting recipes that produce these items\n`;
  report += `4. Or switch to "abundance" mode if resource management isn't important\n`;

  return report;
}

/**
 * Mark a resource gap as resolved (e.g., after creating a merchant)
 */
export function resolveResourceGap(resourceType: string): void {
  for (const gap of crafterState.resourceGaps) {
    if (gap.resourceType.toLowerCase() === resourceType.toLowerCase()) {
      gap.resolved = true;
    }
  }
}

// =============================================================================
// EVOLUTION PROPOSALS - World Self-Evolution
// =============================================================================

/**
 * Resource categories for grouping gaps into coherent proposals
 */
const RESOURCE_CATEGORIES: Record<string, { category: string; proposalType: EvolutionProposal["type"]; entityType: string }> = {
  // Food & Agriculture
  flour: { category: "food_supplies", proposalType: "merchant", entityType: "Merchant" },
  wheat: { category: "food_supplies", proposalType: "resource_source", entityType: "Farm" },
  bread: { category: "food_supplies", proposalType: "merchant", entityType: "Bakery" },
  meat: { category: "food_supplies", proposalType: "merchant", entityType: "Butcher" },
  vegetables: { category: "food_supplies", proposalType: "resource_source", entityType: "Farm" },
  fruit: { category: "food_supplies", proposalType: "resource_source", entityType: "Orchard" },
  fish: { category: "food_supplies", proposalType: "resource_source", entityType: "Fishery" },
  water: { category: "food_supplies", proposalType: "resource_source", entityType: "Well" },

  // Smithing & Metalwork
  iron: { category: "metalwork", proposalType: "resource_source", entityType: "Mine" },
  coal: { category: "metalwork", proposalType: "resource_source", entityType: "Mine" },
  steel: { category: "metalwork", proposalType: "crafting_recipe", entityType: "Forge" },
  copper: { category: "metalwork", proposalType: "resource_source", entityType: "Mine" },

  // Herbalism & Medicine
  herbs: { category: "medicine", proposalType: "resource_source", entityType: "Herb Garden" },
  medicine: { category: "medicine", proposalType: "crafting_recipe", entityType: "Apothecary" },

  // Crafting Materials
  wood: { category: "materials", proposalType: "resource_source", entityType: "Lumber Mill" },
  leather: { category: "materials", proposalType: "merchant", entityType: "Tanner" },
  cloth: { category: "materials", proposalType: "merchant", entityType: "Textile Merchant" },
  rope: { category: "materials", proposalType: "crafting_recipe", entityType: "Ropemaker" },
};

/**
 * Analyze gaps and generate evolution proposals
 * This is called periodically to check if the world needs to grow
 */
export async function analyzeGapsAndProposeEvolution(): Promise<EvolutionProposal[]> {
  const newProposals: EvolutionProposal[] = [];

  // Get gaps that have hit the threshold
  const significantGaps = crafterState.resourceGaps.filter(
    g => !g.resolved && g.occurrences >= GAP_THRESHOLD_FOR_EVOLUTION
  );

  if (significantGaps.length === 0) {
    return newProposals;
  }

  console.log(`[WorldCrafter] Analyzing ${significantGaps.length} significant resource gaps for evolution proposals`);

  // Group gaps by category
  const gapsByCategory = new Map<string, ResourceGap[]>();

  for (const gap of significantGaps) {
    // Check if we already have a proposal for this gap
    const hasExistingProposal = crafterState.evolutionProposals.some(
      p => p.addressesGaps.includes(gap.resourceType) && p.status !== "rejected"
    );
    if (hasExistingProposal) continue;

    // Find category for this resource
    const categoryInfo = RESOURCE_CATEGORIES[gap.resourceType];
    const category = categoryInfo?.category || "general";

    if (!gapsByCategory.has(category)) {
      gapsByCategory.set(category, []);
    }
    gapsByCategory.get(category)!.push(gap);
  }

  // Generate proposals for each category with significant gaps
  for (const [category, gaps] of gapsByCategory) {
    if (gaps.length === 0) continue;

    const proposal = await generateEvolutionProposal(category, gaps);
    if (proposal) {
      crafterState.evolutionProposals.push(proposal);
      newProposals.push(proposal);
      console.log(`[WorldCrafter] Generated evolution proposal: ${proposal.proposal.description}`);
    }
  }

  return newProposals;
}

/**
 * Generate a specific evolution proposal based on gap category
 */
async function generateEvolutionProposal(
  category: string,
  gaps: ResourceGap[]
): Promise<EvolutionProposal | null> {
  const resourceTypes = gaps.map(g => g.resourceType);
  const rooms = [...new Set(gaps.map(g => g.inRoom))];
  const agents = [...new Set(gaps.map(g => g.neededBy))];

  // Use first gap's info for proposal type
  const firstGap = gaps[0];
  const categoryInfo = RESOURCE_CATEGORIES[firstGap.resourceType];

  // Determine proposal type
  const proposalType = categoryInfo?.proposalType || "merchant";
  const entityType = categoryInfo?.entityType || "General Store";

  // Generate location suggestion (could be smarter with world knowledge)
  const locationSuggestion = rooms.length === 1
    ? `near ${rooms[0]}`
    : "in the village center";

  const proposal: EvolutionProposal = {
    id: `evo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    type: proposalType,
    addressesGaps: resourceTypes,
    proposal: {
      entityName: generateProposedEntityName(entityType, resourceTypes),
      entityType,
      location: locationSuggestion,
      description: generateProposalDescription(proposalType, entityType, resourceTypes, agents),
      resources: resourceTypes,
    },
    status: "pending",
  };

  return proposal;
}

/**
 * Generate a name for the proposed entity
 */
function generateProposedEntityName(entityType: string, resources: string[]): string {
  const names: Record<string, string[]> = {
    "Merchant": ["Old Tom's Goods", "The Trading Post", "Merchant's Corner"],
    "Farm": ["Green Acres Farm", "Sunny Fields", "The Farmstead"],
    "Mine": ["Deep Rock Mine", "The Iron Pit", "Mountain Quarry"],
    "Bakery": ["The Golden Crust", "Village Bakery", "Fresh Loaves"],
    "Butcher": ["The Meat Hook", "Village Butcher", "Red Cleaver"],
    "Well": ["Town Well", "Clear Springs Well", "The Old Well"],
    "Forge": ["The Iron Anvil", "Smithy Forge", "Hot Steel Forge"],
    "Apothecary": ["Healing Hands", "The Remedy Shop", "Herb & Cure"],
    "Herb Garden": ["Healer's Garden", "Medicinal Plots", "Green Remedies"],
    "Lumber Mill": ["Pine Creek Mill", "The Sawmill", "Timber Works"],
    "Tanner": ["The Leather Works", "Hide & Seek Tannery", "Brown's Tanning"],
    "General Store": ["The General Store", "Village Supplies", "All Goods Shop"],
  };

  const options = names[entityType] || [`The ${entityType}`];
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Generate a description for the proposal
 */
function generateProposalDescription(
  proposalType: EvolutionProposal["type"],
  entityType: string,
  resources: string[],
  agents: string[]
): string {
  const resourceList = resources.join(", ");
  const agentList = agents.join(", ");

  switch (proposalType) {
    case "merchant":
      return `Create a ${entityType} that sells ${resourceList}. Agents like ${agentList} have been searching for these resources repeatedly.`;
    case "resource_source":
      return `Establish a ${entityType} to produce ${resourceList}. This would create a sustainable supply for the simulation.`;
    case "crafting_recipe":
      return `Add crafting recipes at a ${entityType} to produce ${resourceList}. Agents could then make these items themselves.`;
    case "trade_route":
      return `Establish a trade route bringing ${resourceList} from outside the simulation area.`;
    case "system":
      return `Create a system to manage ${resourceList} production and distribution.`;
    default:
      return `Address the need for ${resourceList} in the simulation.`;
  }
}

/**
 * Send evolution proposals to The Weaver for consideration
 */
export function sendEvolutionProposalsToWeaver(
  registry: SpiritRegistry,
  crafterEid: number
): number {
  const pending = crafterState.evolutionProposals.filter(p => p.status === "pending");
  if (pending.length === 0) return 0;

  const weaver = getSpiritByName(registry, "The Weaver");
  if (!weaver) {
    console.warn("[WorldCrafter] The Weaver not found, cannot send evolution proposals");
    return 0;
  }

  let sentCount = 0;

  for (const proposal of pending) {
    const message: DivineMessage = {
      id: `crafter_evo_${proposal.id}`,
      timestamp: Date.now(),
      from: crafterEid,
      to: weaver.eid,
      type: "request",
      domain: "ecology",
      priority: "high",
      subject: `World Evolution: ${proposal.proposal.entityType}`,
      content: `🌱 EVOLUTION PROPOSAL

${proposal.proposal.description}

PROPOSED ACTION:
- Type: ${proposal.type}
- Entity: ${proposal.proposal.entityName}
- Location: ${proposal.proposal.location}
- Resources Provided: ${proposal.proposal.resources?.join(", ")}

This proposal addresses ${proposal.addressesGaps.length} resource gap(s) that agents have encountered multiple times.

Please review and approve this evolution, or suggest modifications.`,
      requiresResponse: true,
    };

    weaver.inbox.push(message);
    proposal.status = "sent_to_weaver";
    sentCount++;

    console.log(`[WorldCrafter] Sent evolution proposal to The Weaver: ${proposal.proposal.entityName}`);
  }

  return sentCount;
}

/**
 * Get pending evolution proposals
 */
export function getPendingEvolutionProposals(): EvolutionProposal[] {
  return crafterState.evolutionProposals.filter(p => p.status === "pending" || p.status === "sent_to_weaver");
}

/**
 * Mark a proposal as approved and ready for creation
 */
export function approveEvolutionProposal(proposalId: string): EvolutionProposal | null {
  const proposal = crafterState.evolutionProposals.find(p => p.id === proposalId);
  if (proposal) {
    proposal.status = "approved";
    console.log(`[WorldCrafter] Evolution proposal approved: ${proposal.proposal.entityName}`);
  }
  return proposal || null;
}

/**
 * Execute an approved evolution proposal - create the entity/system
 */
export async function executeEvolutionProposal(
  proposal: EvolutionProposal,
  godState: GodAgentState
): Promise<boolean> {
  if (proposal.status !== "approved") {
    console.warn(`[WorldCrafter] Cannot execute proposal ${proposal.id} - not approved`);
    return false;
  }

  console.log(`[WorldCrafter] Executing evolution: Creating ${proposal.proposal.entityName}`);

  try {
    // Create the entity based on proposal type
    if (proposal.type === "merchant" || proposal.type === "resource_source") {
      // Create as an NPC with inventory
      const resources = proposal.proposal.resources?.join(", ") || "goods";
      const result = godState.tools.createAgent({
        name: proposal.proposal.entityName || "New Entity",
        role: proposal.proposal.entityType || "Merchant",
        description: proposal.proposal.description,
        systemPrompt: `You are a ${proposal.proposal.entityType} who provides ${resources} to those in need. Be helpful and fair in your dealings. When someone asks for ${resources}, provide it if you have it available.`,
        roomName: proposal.proposal.location || "Town Square",
      });

      if (!result.success) {
        console.error(`[WorldCrafter] Failed to create evolution entity: ${result.error}`);
        return false;
      }

      // Register this as a resource source for all the gaps it addresses
      for (const resource of proposal.addressesGaps) {
        registerResourceSource(resource, proposal.proposal.entityName || "New Source");
        resolveResourceGap(resource);
      }

      proposal.status = "created";
      console.log(`[WorldCrafter] ✨ Evolution complete: ${proposal.proposal.entityName} now provides ${proposal.addressesGaps.join(", ")}`);
      return true;
    }

    // For other types, just mark as created (systems would need different handling)
    proposal.status = "created";
    return true;
  } catch (error) {
    console.error(`[WorldCrafter] Error executing evolution proposal:`, error);
    return false;
  }
}

/**
 * Record that an item type was created in a room
 */
export function recordItemCreated(roomName: string, itemName: string): void {
  if (!crafterState.roomInventoryHistory.has(roomName)) {
    crafterState.roomInventoryHistory.set(roomName, new Set());
  }
  crafterState.roomInventoryHistory.get(roomName)!.add(itemName.toLowerCase());
}

// =============================================================================
// FAILED INTERACTION DETECTION
// =============================================================================

/**
 * Record a failed interaction for processing
 */
export function recordFailedInteraction(
  agentName: string,
  agentEid: number,
  roomName: string,
  actionType: string,
  targetName: string,
  originalContent?: string
): void {
  const key = `${Date.now()}-${agentName}-${targetName}`;
  if (crafterState.processedActions.has(key)) return;

  crafterState.processedActions.add(key);

  const interaction: FailedInteraction = {
    timestamp: Date.now(),
    agentName,
    agentEid,
    roomName,
    actionType,
    targetName,
    originalContent,
  };

  crafterState.failedInteractions.push(interaction);

  // Keep only recent interactions
  if (crafterState.failedInteractions.length > 100) {
    crafterState.failedInteractions = crafterState.failedInteractions.slice(-100);
  }

  console.log(`[WorldCrafter] Recorded failed interaction: ${agentName} tried to ${actionType} "${targetName}" in ${roomName}`);
}

/**
 * Get pending failed interactions that haven't been resolved
 */
export function getPendingInteractions(): FailedInteraction[] {
  const createdNames = new Set(crafterState.createdEntities.map(e => e.name.toLowerCase()));

  return crafterState.failedInteractions.filter(i => {
    // Skip if we've already created something similar
    const targetLower = i.targetName.toLowerCase();
    for (const name of createdNames) {
      if (name.includes(targetLower) || targetLower.includes(name)) {
        return false;
      }
    }
    return true;
  });
}

// =============================================================================
// ENTITY CREATION VIA GOD
// =============================================================================

/**
 * Generate entity creation parameters based on failed interaction
 */
export async function generateEntityForInteraction(
  interaction: FailedInteraction
): Promise<{
  name: string;
  description: string;
  type: string;
  components: string[];
  needsSystem?: string;
} | null> {
  const prompt = `An agent named "${interaction.agentName}" tried to ${interaction.actionType} "${interaction.targetName}" in the room "${interaction.roomName}".

This object doesn't exist yet. Create appropriate entity details:

1. ENTITY NAME: A proper, descriptive name for this object (e.g., "Bag of Flour" not just "flour")
2. DESCRIPTION: A brief description fitting the room's context
3. TYPE: One of: Food, Weapon, Tool, Container, Furniture, Appliance, Resource, Decoration, Document, Clothing
4. COMPONENTS: Which components it needs:
   - Item (for pickupable items)
   - Container (if it can hold things)
   - Consumable (if it can be eaten/drunk)
   - Tool (if it can be used for crafting)
   - Weapon (if it can be used in combat)
5. NEEDS_SYSTEM: If this item needs special behavior (e.g., "CookingSystem" for an oven), name it. Otherwise "none".

Respond in JSON format:
{
  "name": "...",
  "description": "...",
  "type": "...",
  "components": ["Item", ...],
  "needsSystem": "none" or "SystemName"
}`;

  try {
    const response = await generateText({
      model: spiritModel,
      system: "You are The Crafter, a spirit that materializes objects in a simulation. Create contextually appropriate entities based on agent needs.",
      prompt,
    });

    // Parse JSON from response
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[WorldCrafter] Failed to parse entity JSON from response");
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      components: parsed.components || ["Item"],
      needsSystem: parsed.needsSystem !== "none" ? parsed.needsSystem : undefined,
    };
  } catch (error) {
    console.error("[WorldCrafter] Error generating entity:", error);
    return null;
  }
}

/**
 * Create entity using God's tools
 */
export async function createEntityViaGod(
  godState: GodAgentState,
  entitySpec: {
    name: string;
    description: string;
    type: string;
    components: string[];
    roomName: string;
  }
): Promise<boolean> {
  // Deprecated path: Crafter now materializes directly via WorldSchema/ObjectManager for grounding.
  // Kept as a compatibility stub for old call sites.
  void godState;
  void entitySpec;
  console.warn("[WorldCrafter] createEntityViaGod is deprecated; use materializeEntityForInteraction");
  return false;
}

export function materializeEntityForInteraction(
  world: World,
  interaction: FailedInteraction,
  entitySpec?: { name: string; description: string; type: string; components: string[] }
): { eid: number; typeId: string } | null {
  const roomEid = findRoomEidByName(world, interaction.roomName);
  if (roomEid === undefined) return null;

  const objectManager = new ObjectManager(world);
  const targetName = interaction.targetName?.trim() || "object";
  const action = (interaction.actionType || "").toLowerCase();

  // Deterministic grounding for basic needs:
  // - eat -> food_item (edible)
  // - drink -> drinkable type with full/empty states
  if (action === "eat") {
    const foodType = targetName.toLowerCase();
    const eid = objectManager.spawn("food_item", {
      containedIn: roomEid,
      name: targetName,
      state: "fresh",
      properties: { foodType, adjective: "fresh" },
    });
    return eid === null ? null : { eid, typeId: "food_item" };
  }

  if (action === "drink") {
    const typeId = ensureDrinkableType(targetName);
    const eid = objectManager.spawn(typeId, {
      containedIn: roomEid,
      name: targetName,
      state: "full",
    });
    return eid === null ? null : { eid, typeId };
  }

  // If LLM says it's Food/Consumable, prefer food_item (consistent decay rules).
  const wantsFoodItem = (entitySpec?.type || "").toLowerCase() === "food" || (entitySpec?.components || []).includes("Consumable");
  if (wantsFoodItem) {
    const foodType = targetName.toLowerCase();
    const eid = objectManager.spawn("food_item", {
      containedIn: roomEid,
      name: targetName,
      state: "fresh",
      properties: { foodType, adjective: "fresh" },
    });
    return eid === null ? null : { eid, typeId: "food_item" };
  }

  // Try to resolve to an existing schema type (by ID or display name).
  const resolvedExisting = resolveObjectTypeId(toSnakeCaseId(targetName)) ?? resolveObjectTypeId(targetName);
  if (resolvedExisting) {
    const eid = objectManager.spawn(resolvedExisting, { containedIn: roomEid, name: targetName });
    return eid === null ? null : { eid, typeId: resolvedExisting };
  }

  // Define and spawn a minimal type grounded in WorldSchema.
  const typeId = ensureGenericTypeFromSpec({
    name: entitySpec?.name || targetName,
    description: entitySpec?.description || `A ${targetName}`,
    components: entitySpec?.components || ["Item"],
    type: entitySpec?.type || "Object",
  });

  const eid = objectManager.spawn(typeId, { containedIn: roomEid, name: targetName });
  if (eid === null) return null;

  // Ensure the spawned instance is immediately takeable when needed (traits are computed from type+state).
  // If the schema type was created as an Item, it already includes takeable.
  if ((entitySpec?.components || []).includes("Item")) {
    try {
      const traits = JSON.parse(Traits.active[eid] || "[]") as string[];
      if (!traits.includes("takeable")) {
        Traits.active[eid] = JSON.stringify([...traits, "takeable"]);
      }
    } catch {
      // ignore
    }
  }

  return { eid, typeId };
}

// =============================================================================
// SYSTEM RECOMMENDATIONS
// =============================================================================

/**
 * Create a system recommendation for entities that need special behavior
 */
export function createSystemRecommendation(
  entityType: string,
  systemName: string,
  description: string,
  reason: string
): SystemRecommendation {
  const recommendation: SystemRecommendation = {
    timestamp: Date.now(),
    entityType,
    suggestedSystem: systemName,
    description,
    reason,
    status: "pending",
  };

  crafterState.systemRecommendations.push(recommendation);
  return recommendation;
}

/**
 * Send pending recommendations to The Weaver
 */
export function sendRecommendationsToWeaver(
  registry: SpiritRegistry,
  crafterEid: number
): void {
  const pending = crafterState.systemRecommendations.filter(r => r.status === "pending");
  if (pending.length === 0) return;

  const weaver = getSpiritByName(registry, "The Weaver");
  if (!weaver) {
    console.warn("[WorldCrafter] The Weaver not found, cannot send recommendations");
    return;
  }

  for (const rec of pending) {
    const message: DivineMessage = {
      id: `crafter_rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      from: crafterEid,
      to: weaver.eid,
      type: "request",
      domain: "ecology",
      priority: "normal",
      subject: `System Needed: ${rec.suggestedSystem}`,
      content: `I've been creating ${rec.entityType} entities, but they need a ${rec.suggestedSystem} to function properly.

${rec.description}

Reason: ${rec.reason}

Please consider creating this system so these entities can participate in the simulation meaningfully.`,
      requiresResponse: true,
    };

    weaver.inbox.push(message);
    rec.status = "sent";

    console.log(`[WorldCrafter] Sent recommendation to The Weaver: ${rec.suggestedSystem}`);
  }
}

// =============================================================================
// MAIN CRAFTER CYCLE
// =============================================================================

/**
 * Run the World Crafter's observation and creation cycle
 */
export async function runWorldCrafterCycle(
  world: World,
  registry: SpiritRegistry,
  godState: GodAgentState
): Promise<{
  entitiesCreated: number;
  recommendationsSent: number;
  evolutionProposalsSent: number;
}> {
  const crafter = getSpiritByName(registry, "The Crafter");
  if (!crafter) {
    return { entitiesCreated: 0, recommendationsSent: 0, evolutionProposalsSent: 0 };
  }

  let entitiesCreated = 0;
  let recommendationsSent = 0;
  let evolutionProposalsSent = 0;
  let skippedCount = 0;

  // Process pending failed interactions
  const pending = getPendingInteractions();

  for (const interaction of pending.slice(0, 5)) { // Process up to 5 per cycle
    // Check if we should create this item (respects world constraints)
    const skipReason = shouldCreateItem(interaction);
    if (skipReason) {
      console.log(`[WorldCrafter] Skipping "${interaction.targetName}": ${skipReason}`);
      skippedCount++;

      // TODO: Could send a message to the agent suggesting how to acquire the item
      // e.g., "You'll need to buy flour from the miller" or "Try trading for it"
      continue;
    }

    // Deterministic materialization for core needs/actions; otherwise use LLM spec as a hint.
    const actionLower = (interaction.actionType || "").toLowerCase();
    const entitySpec =
      actionLower === "eat" || actionLower === "drink"
        ? null
        : await generateEntityForInteraction(interaction);

    const created = materializeEntityForInteraction(world, interaction, entitySpec || undefined);
    if (created) {
      entitiesCreated++;

      // Record that we created this item in this room (prevents duplicates)
      recordItemCreated(interaction.roomName, interaction.targetName);

      // Record creation for history
      crafterState.createdEntities.push({
        timestamp: Date.now(),
        name: entitySpec?.name || interaction.targetName,
        type: entitySpec?.type || created.typeId,
        roomName: interaction.roomName,
        createdFor: interaction.agentName,
        components: entitySpec?.components || [],
      });

      // Check if a system is needed
      if (entitySpec?.needsSystem) {
        const existingSystems = crafterState.entityTypeToSystemMap.get(entitySpec.type);
        if (!existingSystems?.includes(entitySpec.needsSystem)) {
          createSystemRecommendation(
            entitySpec.type,
            entitySpec.needsSystem,
            `System to handle ${entitySpec.type} entity behaviors`,
            `Created ${entitySpec.name} which needs ${entitySpec.needsSystem} for proper functionality`
          );
        }
      }
    }
  }

  void godState; // Crafter materializes directly now; retained for future messaging/evolution tools.

  if (skippedCount > 0) {
    console.log(`[WorldCrafter] Skipped ${skippedCount} items due to world constraints`);
  }

  // Send any pending recommendations to The Weaver
  const pendingRecs = crafterState.systemRecommendations.filter(r => r.status === "pending").length;
  if (pendingRecs > 0) {
    sendRecommendationsToWeaver(registry, crafter.eid);
    recommendationsSent = pendingRecs;
  }

  // =========================================================================
  // EVOLUTION CHECK - Analyze gaps and propose world evolution
  // =========================================================================
  const now = Date.now();
  if (now - crafterState.lastEvolutionCheck >= EVOLUTION_CHECK_INTERVAL_MS) {
    crafterState.lastEvolutionCheck = now;

    // Analyze accumulated gaps and generate evolution proposals
    const newProposals = await analyzeGapsAndProposeEvolution();
    if (newProposals.length > 0) {
      console.log(`[WorldCrafter] Generated ${newProposals.length} evolution proposal(s)`);

      // Send proposals to The Weaver
      evolutionProposalsSent = sendEvolutionProposalsToWeaver(registry, crafter.eid);
    }

    // Log gap summary if there are unresolved gaps
    const unresolvedGaps = getUnresolvedResourceGaps();
    if (unresolvedGaps.length > 0) {
      const gapSummary = unresolvedGaps
        .map(g => `${g.resourceType}(${g.occurrences}x)`)
        .join(", ");
      console.log(`[WorldCrafter] Unresolved gaps: ${gapSummary}`);
    }
  }

  return { entitiesCreated, recommendationsSent, evolutionProposalsSent };
}

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Create the World Crafter spirit
 */
export function createWorldCrafterSpirit(registry: SpiritRegistry): SpiritState | null {
  const existing = getSpiritByName(registry, "The Crafter");
  if (existing) {
    console.log("[WorldCrafter] The Crafter already exists");
    return existing;
  }

  const spirit = createDynamicSpirit(registry, WorldCrafterDefinition);
  if (spirit) {
    console.log("[WorldCrafter] The Crafter spirit created");
  }
  return spirit;
}
