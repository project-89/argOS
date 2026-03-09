/**
 * Spirit Registry
 *
 * Manages the hierarchy of spirits, handles message routing,
 * and provides utilities for spirit coordination.
 */

import { addEntity, addComponent, query, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Mind } from "../ecs/components";
import {
  createDynamicComponent,
  getDynamicComponent,
  setDynamicComponentValue,
  getDynamicComponentValues,
} from "../ecs/dynamic-components";
import type {
  SpiritState,
  SpiritDefinition,
  SpiritDomain,
  DivineMessage,
  Directive,
  MessageType,
  MessagePriority,
  NarrativeState,
  SocialState,
} from "./types";

// Re-export types for convenience
export type { SpiritState, SpiritDefinition, SpiritDomain } from "./types";

// =============================================================================
// SPIRIT COMPONENT
// =============================================================================

// Ensure Spirit component exists
function ensureSpiritComponent(): void {
  if (!getDynamicComponent("Spirit")) {
    createDynamicComponent({
      name: "Spirit",
      description: "Marks an entity as a spirit agent in the celestial hierarchy",
      properties: {
        domain: "string",
        rank: "string",
        superiorEid: "number",
        subordinateEids: "string",  // JSON array
        lastObservation: "number",
        observationInterval: "number",
        active: "number",  // boolean as number
      },
    });
  }
}

// =============================================================================
// REGISTRY STATE
// =============================================================================

export interface SpiritRegistry {
  world: World;
  spirits: Map<number, SpiritState>;  // eid -> state
  byName: Map<string, number>;        // name -> eid
  byDomain: Map<SpiritDomain, number[]>;  // domain -> eids
  messageQueue: DivineMessage[];
  godAgentEid?: number;               // The supreme being
}

/**
 * Create a new spirit registry
 */
export function createSpiritRegistry(world: World): SpiritRegistry {
  ensureSpiritComponent();

  return {
    world,
    spirits: new Map(),
    byName: new Map(),
    byDomain: new Map(),
    messageQueue: [],
  };
}

// =============================================================================
// SPIRIT CREATION
// =============================================================================

/**
 * Create and register a spirit
 */
export function createSpirit(
  registry: SpiritRegistry,
  definition: SpiritDefinition,
  superiorEid?: number
): SpiritState {
  const world = registry.world;

  // Create entity
  const eid = addEntity(world);

  // Set Name and Description
  Name.value[eid] = definition.name;
  Description.value[eid] = definition.description;

  // Set Mind for cognitive processing
  Mind.mode[eid] = "deliberative";
  Mind.arousal[eid] = 0.5;
  Mind.focus[eid] = definition.domain;
  Mind.lastUpdate[eid] = Date.now();

  // Set Spirit component
  setDynamicComponentValue("Spirit", eid, "domain", definition.domain);
  setDynamicComponentValue("Spirit", eid, "rank", definition.rank);
  setDynamicComponentValue("Spirit", eid, "superiorEid", superiorEid ?? -1);
  setDynamicComponentValue("Spirit", eid, "subordinateEids", "[]");
  setDynamicComponentValue("Spirit", eid, "lastObservation", 0);
  setDynamicComponentValue("Spirit", eid, "observationInterval", definition.observationInterval);
  setDynamicComponentValue("Spirit", eid, "active", 1);

  // Create state
  const state: SpiritState = {
    eid,
    definition,
    superiorEid,
    subordinateEids: [],
    observations: [],
    lastObservationTime: 0,
    inbox: [],
    outbox: [],
    pendingDirectives: [],
    shortTermMemory: [],
    significantEvents: [],
  };

  // Initialize domain-specific state
  if (definition.domain === "narrative") {
    state.narrativeState = createInitialNarrativeState();
  } else if (definition.domain === "social") {
    state.socialState = createInitialSocialState();
  }

  // Register
  registry.spirits.set(eid, state);
  registry.byName.set(definition.name, eid);

  // Add to domain index
  const domainSpirits = registry.byDomain.get(definition.domain) || [];
  domainSpirits.push(eid);
  registry.byDomain.set(definition.domain, domainSpirits);

  // Register with superior
  if (superiorEid !== undefined) {
    const superior = registry.spirits.get(superiorEid);
    if (superior) {
      superior.subordinateEids.push(eid);
      // Update component
      setDynamicComponentValue(
        "Spirit",
        superiorEid,
        "subordinateEids",
        JSON.stringify(superior.subordinateEids)
      );
    }
  }

  console.log(`[Spirit] Created ${definition.rank} "${definition.name}" (${definition.domain})`);

  return state;
}

/**
 * Set GodAI as the supreme being
 */
export function setGodAgent(registry: SpiritRegistry, godAgentEid: number): void {
  registry.godAgentEid = godAgentEid;
  console.log(`[Spirit] GodAI registered as supreme being (eid: ${godAgentEid})`);
}

/**
 * Add a subordinate spirit to a superior
 */
export function addSubordinate(registry: SpiritRegistry, superiorEid: number, subordinateEid: number): void {
  const subordinate = registry.spirits.get(subordinateEid);

  if (!subordinate) {
    console.error(`[Spirit] Cannot add subordinate: subordinate ${subordinateEid} not found`);
    return;
  }

  // Special case: superior is GodAI (not a spirit, but the supreme being)
  if (superiorEid === registry.godAgentEid) {
    subordinate.superiorEid = superiorEid;
    setDynamicComponentValue(
      "Spirit",
      subordinateEid,
      "superiorEid",
      superiorEid.toString()
    );
    return;
  }

  // Normal case: superior is another spirit
  const superior = registry.spirits.get(superiorEid);
  if (!superior) {
    console.error(`[Spirit] Cannot add subordinate: superior ${superiorEid} not found`);
    return;
  }

  // Avoid duplicates
  if (superior.subordinateEids.includes(subordinateEid)) {
    return;
  }

  superior.subordinateEids.push(subordinateEid);
  subordinate.superiorEid = superiorEid;

  // Update component
  setDynamicComponentValue(
    "Spirit",
    superiorEid,
    "subordinateEids",
    JSON.stringify(superior.subordinateEids)
  );

  setDynamicComponentValue(
    "Spirit",
    subordinateEid,
    "superiorEid",
    String(superiorEid)
  );

  console.log(`[Spirit] Added ${subordinate.definition.name} as subordinate of ${superior.definition.name}`);
}

// =============================================================================
// SPIRIT LOOKUP
// =============================================================================

/**
 * Get a spirit by entity ID
 */
export function getSpirit(registry: SpiritRegistry, eid: number): SpiritState | undefined {
  return registry.spirits.get(eid);
}

/**
 * Get a spirit by name
 */
export function getSpiritByName(registry: SpiritRegistry, name: string): SpiritState | undefined {
  const eid = registry.byName.get(name);
  return eid !== undefined ? registry.spirits.get(eid) : undefined;
}

/**
 * Get all spirits in a domain
 */
export function getSpiritsInDomain(registry: SpiritRegistry, domain: SpiritDomain): SpiritState[] {
  const eids = registry.byDomain.get(domain) || [];
  return eids.map(eid => registry.spirits.get(eid)!).filter(Boolean);
}

/**
 * Get all active spirits
 */
export function getActiveSpirits(registry: SpiritRegistry): SpiritState[] {
  return Array.from(registry.spirits.values()).filter(s => {
    const active = getDynamicComponentValues("Spirit", s.eid)?.active;
    return active === 1;
  });
}

/**
 * Get spirits that need to run their observation cycle
 */
export function getSpiritsNeedingObservation(registry: SpiritRegistry): SpiritState[] {
  const now = Date.now();
  return getActiveSpirits(registry).filter(spirit => {
    const interval = spirit.definition.observationInterval;
    return now - spirit.lastObservationTime >= interval;
  });
}

// =============================================================================
// MESSAGE ROUTING
// =============================================================================

let messageIdCounter = 0;

function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

/**
 * Send a message from one spirit to another
 */
export function sendMessage(
  registry: SpiritRegistry,
  from: number,
  to: number,
  type: MessageType,
  subject: string,
  content: string,
  options: {
    priority?: MessagePriority;
    requiresResponse?: boolean;
    responseTo?: string;
    data?: Record<string, any>;
  } = {}
): DivineMessage {
  const fromSpirit = registry.spirits.get(from);
  const toSpirit = registry.spirits.get(to);

  const message: DivineMessage = {
    id: generateMessageId(),
    timestamp: Date.now(),
    from,
    to,
    type,
    domain: fromSpirit?.definition.domain || "narrative",
    priority: options.priority || "normal",
    subject,
    content,
    data: options.data,
    requiresResponse: options.requiresResponse || false,
    responseTo: options.responseTo,
  };

  // Add to recipient's inbox
  if (toSpirit) {
    toSpirit.inbox.push(message);
  }
  if (to === registry.godAgentEid) {
    // Message to GodAI - always add to registry queue for GodAI to process, even if
    // a spirit entity somehow exists with the same eid (defensive against id collisions).
    registry.messageQueue.push(message);
  }

  // Track in sender's outbox
  if (fromSpirit) {
    fromSpirit.outbox.push(message);
    // Keep only recent messages
    if (fromSpirit.outbox.length > 50) {
      fromSpirit.outbox = fromSpirit.outbox.slice(-50);
    }
  }

  console.log(`[Spirit] Message: ${Name.value[from] || from} -> ${Name.value[to] || to}: ${subject}`);

  return message;
}

/**
 * Send a report to superior
 */
export function reportToSuperior(
  registry: SpiritRegistry,
  spiritEid: number,
  subject: string,
  content: string,
  priority: MessagePriority = "normal",
  data?: Record<string, any>
): DivineMessage | null {
  const spirit = registry.spirits.get(spiritEid);
  if (!spirit) return null;

  const superiorEid = spirit.superiorEid ?? registry.godAgentEid;
  if (superiorEid === undefined) return null;

  return sendMessage(registry, spiritEid, superiorEid, "report", subject, content, {
    priority,
    data,
  });
}

/**
 * Send a directive to subordinate
 */
export function sendDirective(
  registry: SpiritRegistry,
  fromEid: number,
  toEid: number,
  directive: Omit<Directive, "id" | "timestamp" | "from" | "status">
): Directive {
  const fullDirective: Directive = {
    ...directive,
    id: `dir_${Date.now()}_${++messageIdCounter}`,
    timestamp: Date.now(),
    from: fromEid,
    status: "pending",
  };

  const toSpirit = registry.spirits.get(toEid);
  if (toSpirit) {
    toSpirit.pendingDirectives.push(fullDirective);
  }

  // Also send as message
  sendMessage(registry, fromEid, toEid, "directive", directive.description, directive.description, {
    priority: "high",
    data: { directive: fullDirective },
  });

  return fullDirective;
}

/**
 * Broadcast a message to all spirits in a domain
 */
export function broadcastToDomain(
  registry: SpiritRegistry,
  fromEid: number,
  domain: SpiritDomain,
  subject: string,
  content: string
): void {
  const spirits = getSpiritsInDomain(registry, domain);
  for (const spirit of spirits) {
    if (spirit.eid !== fromEid) {
      sendMessage(registry, fromEid, spirit.eid, "broadcast", subject, content);
    }
  }
}

/**
 * Get pending messages for GodAI
 */
export function getMessagesForGodAI(registry: SpiritRegistry): DivineMessage[] {
  const messages = [...registry.messageQueue];
  registry.messageQueue = [];
  return messages;
}

// =============================================================================
// HIERARCHY MANAGEMENT
// =============================================================================

/**
 * Get the full hierarchy as a tree structure
 */
export function getHierarchyTree(registry: SpiritRegistry): HierarchyNode {
  const root: HierarchyNode = {
    eid: registry.godAgentEid || -1,
    name: "GodAI",
    domain: "narrative",
    rank: "god",
    children: [],
  };

  // Find archangels (spirits without superiors or whose superior is GodAI)
  const archangels = Array.from(registry.spirits.values()).filter(s =>
    s.superiorEid === undefined || s.superiorEid === registry.godAgentEid
  );

  root.children = archangels.map(spirit => buildHierarchyNode(registry, spirit));

  return root;
}

interface HierarchyNode {
  eid: number;
  name: string;
  domain: string;
  rank: string;
  children: HierarchyNode[];
}

function buildHierarchyNode(registry: SpiritRegistry, spirit: SpiritState): HierarchyNode {
  return {
    eid: spirit.eid,
    name: spirit.definition.name,
    domain: spirit.definition.domain,
    rank: spirit.definition.rank,
    children: spirit.subordinateEids
      .map(eid => registry.spirits.get(eid))
      .filter((s): s is SpiritState => s !== undefined)
      .map(s => buildHierarchyNode(registry, s)),
  };
}

/**
 * Print the hierarchy for debugging
 */
export function printHierarchy(registry: SpiritRegistry): string {
  const tree = getHierarchyTree(registry);
  const lines: string[] = [];

  function printNode(node: HierarchyNode, indent: string = ""): void {
    const symbol = node.rank === "god" ? "👑" :
                   node.rank === "archangel" ? "👼" :
                   node.rank === "angel" ? "😇" : "👻";
    lines.push(`${indent}${symbol} ${node.name} [${node.domain}]`);
    for (const child of node.children) {
      printNode(child, indent + "  ");
    }
  }

  printNode(tree);
  return lines.join("\n");
}

// =============================================================================
// INITIAL STATE FACTORIES
// =============================================================================

function createInitialNarrativeState(): NarrativeState {
  return {
    currentAct: 1,
    currentPhase: "exposition",
    tension: 0.2,
    plotThreads: [],
    activeThreads: [],
    characterArcs: [],
    protagonists: [],
    antagonists: [],
    sceneHistory: [],
    plannedBeats: [],
    completedBeats: [],
  };
}

function createInitialSocialState(): SocialState {
  return {
    relationships: [],
    factions: [],
    factionRelations: [],
    activeConflicts: [],
    resolvedConflicts: [],
    influencers: [],
    isolates: [],
    cliques: [],
  };
}

// =============================================================================
// SPIRIT LIFECYCLE
// =============================================================================

/**
 * Activate a spirit
 */
export function activateSpirit(registry: SpiritRegistry, eid: number): void {
  setDynamicComponentValue("Spirit", eid, "active", 1);
  console.log(`[Spirit] Activated: ${Name.value[eid]}`);
}

/**
 * Deactivate a spirit
 */
export function deactivateSpirit(registry: SpiritRegistry, eid: number): void {
  setDynamicComponentValue("Spirit", eid, "active", 0);
  console.log(`[Spirit] Deactivated: ${Name.value[eid]}`);
}

/**
 * Remove a spirit from the registry
 */
export function removeSpirit(registry: SpiritRegistry, eid: number): void {
  const spirit = registry.spirits.get(eid);
  if (!spirit) return;

  // Remove from superior's subordinate list
  if (spirit.superiorEid !== undefined) {
    const superior = registry.spirits.get(spirit.superiorEid);
    if (superior) {
      superior.subordinateEids = superior.subordinateEids.filter(id => id !== eid);
    }
  }

  // Reassign subordinates to superior
  for (const subEid of spirit.subordinateEids) {
    const sub = registry.spirits.get(subEid);
    if (sub) {
      sub.superiorEid = spirit.superiorEid;
    }
  }

  // Remove from indices
  registry.spirits.delete(eid);
  registry.byName.delete(spirit.definition.name);

  const domainSpirits = registry.byDomain.get(spirit.definition.domain);
  if (domainSpirits) {
    registry.byDomain.set(
      spirit.definition.domain,
      domainSpirits.filter(id => id !== eid)
    );
  }

  console.log(`[Spirit] Removed: ${spirit.definition.name}`);
}

// =============================================================================
// SUMMARY & DEBUGGING
// =============================================================================

/**
 * Get a summary of all spirits
 */
export function getSpiritSummary(registry: SpiritRegistry): string {
  const lines: string[] = ["=== Spirit Registry ==="];

  lines.push(`Total spirits: ${registry.spirits.size}`);
  lines.push(`Pending messages for GodAI: ${registry.messageQueue.length}`);
  lines.push("");
  lines.push("Hierarchy:");
  lines.push(printHierarchy(registry));
  lines.push("");
  lines.push("Domains:");

  for (const [domain, eids] of registry.byDomain) {
    const names = eids.map(eid => Name.value[eid] || eid).join(", ");
    lines.push(`  ${domain}: ${names}`);
  }

  return lines.join("\n");
}
