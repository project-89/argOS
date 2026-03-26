/**
 * Trait Registry - Runtime registration and discovery of entity traits.
 *
 * Traits are string tags stored in `Traits.active[eid]` as JSON arrays.
 * This registry provides:
 * - A catalog of all known traits with descriptions and categories
 * - Runtime registration of new traits (e.g., by GodAI or spirits)
 * - Discovery API for LLM prompt context
 * - Incompatibility tracking between traits
 * - Persistence for runtime-registered traits
 *
 * Base traits are auto-populated from affordance definitions and object type
 * definitions in schema.ts. They cannot be removed. Runtime traits can be
 * added and removed freely.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { BASE_AFFORDANCES, BASE_OBJECT_TYPES, BASE_RULES } from "./schema";

// ============================================================================
// Types
// ============================================================================

export type TraitCategory =
  | "physical"
  | "interactive"
  | "social"
  | "sensory"
  | "state"
  | "custom";

export interface TraitDefinition {
  /** Unique trait name (lowercase, no spaces) */
  name: string;
  /** Human-readable description for LLM context */
  description: string;
  /** Semantic category */
  category: TraitCategory;
  /** Which affordances require this trait on the target */
  enablesAffordances: string[];
  /** Traits that cannot coexist on the same entity */
  incompatibleWith: string[];
}

// ============================================================================
// Serialization type (for persistence)
// ============================================================================

interface SerializedTraitRegistry {
  version: 1;
  traits: TraitDefinition[];
}

// ============================================================================
// Registry state
// ============================================================================

/** Base traits derived from schema definitions. Cannot be removed. */
const baseTraits: Map<string, TraitDefinition> = new Map();

/** Runtime-registered traits (from GodAI, spirits, etc.). Can be removed. */
const runtimeTraits: Map<string, TraitDefinition> = new Map();

// ============================================================================
// Public API
// ============================================================================

/**
 * Register a new trait definition. If a trait with this name already exists
 * as a runtime trait, it is overwritten. Base traits cannot be overwritten.
 *
 * Trait names preserve their original casing (e.g., "lightSource", "hasKey").
 */
export function registerTrait(def: TraitDefinition): void {
  const name = def.name.trim();
  if (!name) throw new Error("Trait name cannot be empty");

  const existing = findTrait(name);
  if (existing && baseTraits.has(existing.name)) {
    // Merge: update mutable fields on base trait (description, incompatibleWith)
    // but do not move it to runtime
    existing.description = def.description || existing.description;
    existing.incompatibleWith = mergeUnique(
      existing.incompatibleWith,
      def.incompatibleWith
    );
    existing.enablesAffordances = mergeUnique(
      existing.enablesAffordances,
      def.enablesAffordances
    );
    if (def.category !== "custom") existing.category = def.category;
    return;
  }

  runtimeTraits.set(name, { ...def, name });
}

/**
 * Remove a runtime trait. Returns true if the trait was found and removed,
 * false if it was not found or is a base trait (which cannot be removed).
 */
export function removeTrait(name: string): boolean {
  const key = name.trim();
  if (findTraitInMap(baseTraits, key)) return false; // cannot remove base traits
  // Try exact match first, then case-insensitive
  if (runtimeTraits.has(key)) return runtimeTraits.delete(key);
  const found = findTraitInMap(runtimeTraits, key);
  if (found) return runtimeTraits.delete(found.name);
  return false;
}

/**
 * Get a trait definition by name. Case-insensitive lookup.
 */
export function getTrait(name: string): TraitDefinition | undefined {
  return findTrait(name.trim());
}

/**
 * Check whether a trait name is registered (base or runtime). Case-insensitive.
 */
export function isTraitRegistered(name: string): boolean {
  return findTrait(name.trim()) !== undefined;
}

/**
 * List all registered traits (base + runtime).
 */
export function listAllTraits(): TraitDefinition[] {
  return [...baseTraits.values(), ...runtimeTraits.values()];
}

/**
 * List only runtime-registered traits.
 */
export function listRuntimeTraits(): TraitDefinition[] {
  return [...runtimeTraits.values()];
}

/**
 * List all registered trait names.
 */
export function listTraitNames(): string[] {
  return [...baseTraits.keys(), ...runtimeTraits.keys()];
}

/**
 * Clear all runtime traits. Base traits are unaffected.
 */
export function resetRuntimeTraits(): void {
  runtimeTraits.clear();
}

/**
 * Get trait info formatted for LLM prompt context.
 * Returns a compact multi-line summary of the trait.
 */
export function getTraitInfo(name: string): string | undefined {
  const def = getTrait(name);
  if (!def) return undefined;
  const lines: string[] = [
    `${def.name} (${def.category}): ${def.description}`,
  ];
  if (def.enablesAffordances.length > 0) {
    lines.push(`  enables: ${def.enablesAffordances.join(", ")}`);
  }
  if (def.incompatibleWith.length > 0) {
    lines.push(`  incompatible with: ${def.incompatibleWith.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Get a compact summary of all traits for LLM context.
 * Grouped by category.
 */
export function getTraitsSummaryForContext(): string {
  const byCategory = new Map<TraitCategory, TraitDefinition[]>();
  for (const def of listAllTraits()) {
    const list = byCategory.get(def.category) ?? [];
    list.push(def);
    byCategory.set(def.category, list);
  }

  const lines: string[] = ["KNOWN TRAITS:"];
  const order: TraitCategory[] = [
    "physical",
    "interactive",
    "social",
    "sensory",
    "state",
    "custom",
  ];

  for (const cat of order) {
    const traits = byCategory.get(cat);
    if (!traits || traits.length === 0) continue;
    lines.push(`  [${cat}]`);
    for (const t of traits) {
      lines.push(`    ${t.name}: ${t.description}`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Persistence
// ============================================================================

/**
 * Save runtime traits to `{dir}/traits.json`.
 */
export async function saveRuntimeTraits(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const data: SerializedTraitRegistry = {
    version: 1,
    traits: listRuntimeTraits(),
  };
  await writeFile(
    join(dir, "traits.json"),
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

/**
 * Load runtime traits from `{dir}/traits.json`.
 * Merges into current runtime traits (does not clear existing ones first).
 */
export async function loadRuntimeTraits(dir: string): Promise<void> {
  const filePath = join(dir, "traits.json");
  if (!existsSync(filePath)) return;

  const raw = await readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as SerializedTraitRegistry;

  if (data.version !== 1) {
    console.warn(
      `[trait-registry] Unknown traits.json version ${data.version}, skipping load`
    );
    return;
  }

  for (const def of data.traits) {
    if (!baseTraits.has(def.name)) {
      runtimeTraits.set(def.name, def);
    }
  }
}

// ============================================================================
// Base trait initialization
// ============================================================================

/**
 * Human-curated descriptions and category assignments for known traits.
 * Traits not listed here get auto-generated descriptions from usage context.
 */
const TRAIT_METADATA: Record<
  string,
  { description: string; category: TraitCategory; incompatibleWith?: string[] }
> = {
  // Physical traits
  takeable: {
    description: "Can be picked up and carried by an agent",
    category: "physical",
  },
  portable: {
    description: "Lightweight and easy to transport",
    category: "physical",
  },
  tooHeavy: {
    description: "Too heavy to pick up or move",
    category: "physical",
    incompatibleWith: ["takeable", "portable"],
  },
  fixed: {
    description: "Permanently attached to its location; cannot be moved",
    category: "physical",
    incompatibleWith: ["takeable", "portable"],
  },
  furniture: {
    description: "A piece of furniture; part of a room's furnishings",
    category: "physical",
  },
  surface: {
    description: "A flat surface where items can be placed on top",
    category: "physical",
  },
  container: {
    description: "Can hold other objects inside it",
    category: "physical",
  },
  portal: {
    description: "A passage connecting two locations (door, gate, tunnel)",
    category: "physical",
  },
  location: {
    description: "Represents a distinct place or room in the world",
    category: "physical",
  },
  tree: {
    description: "A tree; a large woody plant",
    category: "physical",
  },
  plant: {
    description: "A living plant organism",
    category: "physical",
  },
  scenery: {
    description: "Part of the environment scenery; decorative or structural",
    category: "physical",
  },
  house: {
    description: "A building intended for habitation",
    category: "physical",
  },
  building: {
    description: "A constructed structure",
    category: "physical",
  },
  structure: {
    description: "A built or constructed element of the environment",
    category: "physical",
  },
  storage: {
    description: "Designed for storing items or documents",
    category: "physical",
  },
  flammable: {
    description: "Can catch fire and burn",
    category: "physical",
    incompatibleWith: ["fireproof"],
  },
  fireproof: {
    description: "Resistant to fire; cannot be ignited",
    category: "physical",
    incompatibleWith: ["flammable"],
  },

  // Interactive traits
  openable: {
    description: "Can be opened and closed (doors, chests, cabinets)",
    category: "interactive",
  },
  lockable: {
    description: "Can be locked and unlocked with a key",
    category: "interactive",
  },
  sittable: {
    description: "Can be sat upon (chairs, benches, stools)",
    category: "interactive",
  },
  sleepable: {
    description: "Can be slept on (beds, cots, hammocks)",
    category: "interactive",
  },
  edible: {
    description: "Can be consumed as food",
    category: "interactive",
  },
  drinkable: {
    description: "Contains liquid that can be drunk",
    category: "interactive",
  },
  readable: {
    description: "Contains text or information that can be read",
    category: "interactive",
  },
  examinable: {
    description: "Can be closely examined to learn more about it",
    category: "interactive",
  },
  lightable: {
    description: "Can be lit on fire or ignited (torches, candles, fires)",
    category: "interactive",
  },
  heatable: {
    description: "Can be heated up (ovens, forges, furnaces)",
    category: "interactive",
  },
  workstation: {
    description: "A specialized station for performing work tasks",
    category: "interactive",
  },
  searchable: {
    description: "Can be searched through to find items or information",
    category: "interactive",
  },
  workable: {
    description: "Can be used for productive work activities",
    category: "interactive",
  },

  // Social traits
  talkable: {
    description: "Can be spoken to; capable of conversation",
    category: "social",
  },
  attackable: {
    description: "Can be targeted in combat",
    category: "social",
  },
  alive: {
    description: "A living entity capable of autonomous action",
    category: "social",
    incompatibleWith: ["dead"],
  },

  // Sensory traits
  lightSource: {
    description: "Emits light; illuminates the surrounding area",
    category: "sensory",
  },

  // State traits
  occupied: {
    description: "Currently in use or occupied by someone",
    category: "state",
  },
  locked: {
    description: "Secured with a lock; cannot be opened without a key",
    category: "state",
  },
  passable: {
    description: "Can be passed through or traversed (open doors, gates)",
    category: "state",
  },
  burning: {
    description: "Currently on fire; actively burning",
    category: "state",
  },
  broken: {
    description: "Damaged beyond normal use; needs repair",
    category: "state",
  },
  dead: {
    description: "No longer alive; a lifeless body",
    category: "state",
    incompatibleWith: ["alive", "talkable"],
  },
  in_use: {
    description: "Currently being actively used by someone",
    category: "state",
  },

  // Device / technology traits
  device: {
    description: "An electronic or mechanical device that can be powered on/off",
    category: "interactive",
  },
  communication: {
    description: "Capable of sending and receiving messages or calls",
    category: "interactive",
  },
  computer: {
    description: "A computing device capable of running software",
    category: "interactive",
  },
  camera: {
    description: "Can capture images or video",
    category: "interactive",
  },
  office: {
    description: "An office-type workspace or equipment",
    category: "physical",
  },
  usable: {
    description: "In a state where it can be actively used",
    category: "state",
  },
  browsable: {
    description: "Can access and browse the web or file systems",
    category: "interactive",
  },
  typeable: {
    description: "Has a keyboard or input method for typing text",
    category: "interactive",
  },
  answerable: {
    description: "Has an incoming call or message that can be answered",
    category: "state",
  },
  callable: {
    description: "Can be used to make outgoing calls",
    category: "interactive",
  },
  textable: {
    description: "Can be used to send text messages",
    category: "interactive",
  },
  in_call: {
    description: "Currently connected to an active phone call",
    category: "state",
  },
  powered_on: {
    description: "Device is currently powered on and operational",
    category: "state",
    incompatibleWith: ["powered_off"],
  },
  powered_off: {
    description: "Device is currently powered off",
    category: "state",
    incompatibleWith: ["powered_on"],
  },

  // Actor-required traits (capabilities)
  hasKey: {
    description: "Possesses a key that can lock or unlock things",
    category: "interactive",
  },
};

/**
 * Infer a category for a trait name not found in TRAIT_METADATA.
 */
function inferCategory(name: string): TraitCategory {
  const lower = name.toLowerCase();

  // State-like traits (past tense, adjective states)
  if (
    /^(is_|has_|was_|not_)/.test(lower) ||
    ["broken", "lit", "empty", "full", "hot", "cold", "wet", "dry"].includes(lower)
  ) {
    return "state";
  }

  // Sensory traits
  if (
    /(light|sound|smell|glow|warm|cold|heat|visual|audible|aroma)/.test(lower)
  ) {
    return "sensory";
  }

  // Social traits
  if (/(talk|speak|alive|dead|friendly|hostile|npc|social)/.test(lower)) {
    return "social";
  }

  // Physical traits
  if (
    /(heavy|portable|fixed|solid|liquid|large|small|furniture|container|surface|building|structure)/.test(
      lower
    )
  ) {
    return "physical";
  }

  // Default to interactive for "-able" suffixed traits
  if (lower.endsWith("able") || lower.endsWith("ible")) {
    return "interactive";
  }

  return "custom";
}

/**
 * Generate a description for a trait not found in TRAIT_METADATA.
 */
function inferDescription(
  name: string,
  enablesAffordances: string[]
): string {
  if (enablesAffordances.length > 0) {
    return `Enables ${enablesAffordances.join(", ")} interactions`;
  }

  // Generate from name patterns
  if (name.endsWith("able") || name.endsWith("ible")) {
    const stem = name.replace(/(able|ible)$/, "");
    return `Can be ${stem}ed or subjected to ${stem}ing`;
  }

  return `Entity possesses the "${name}" property`;
}

/**
 * Scan all affordance and object type definitions to build the base trait
 * registry. Called once at module load time.
 */
export function initializeBaseTraits(): void {
  // Do not re-initialize if already populated
  if (baseTraits.size > 0) return;

  // Collect trait -> affordance mapping from affordances
  const traitToAffordances = new Map<string, Set<string>>();

  for (const [, aff] of Object.entries(BASE_AFFORDANCES)) {
    for (const trait of aff.requires) {
      const set = traitToAffordances.get(trait) ?? new Set();
      set.add(aff.name);
      traitToAffordances.set(trait, set);
    }
    for (const trait of aff.blockedBy ?? []) {
      // blockedBy traits don't enable the affordance, but they're still traits
      if (!traitToAffordances.has(trait)) {
        traitToAffordances.set(trait, new Set());
      }
    }
    for (const trait of aff.actorRequires ?? []) {
      if (!traitToAffordances.has(trait)) {
        traitToAffordances.set(trait, new Set());
      }
    }
  }

  // Collect traits from object type definitions
  const allTraitNames = new Set<string>();

  for (const [, objType] of Object.entries(BASE_OBJECT_TYPES)) {
    for (const trait of objType.traits) {
      allTraitNames.add(trait);
    }
    for (const [, stateDef] of Object.entries(objType.states)) {
      for (const trait of stateDef.traits ?? []) {
        allTraitNames.add(trait);
      }
      for (const trait of stateDef.blockedTraits ?? []) {
        allTraitNames.add(trait);
      }
    }
  }

  // Collect traits from rules
  for (const rule of BASE_RULES) {
    for (const trait of rule.when.condition?.has ?? []) {
      allTraitNames.add(trait);
    }
    for (const trait of rule.when.condition?.not ?? []) {
      allTraitNames.add(trait);
    }
    for (const effect of rule.then) {
      if (effect.query?.has) {
        for (const trait of effect.query.has) {
          allTraitNames.add(trait);
        }
      }
      if (effect.query?.not) {
        for (const trait of effect.query.not) {
          allTraitNames.add(trait);
        }
      }
    }
  }

  // Merge all affordance-referenced traits
  for (const traitName of traitToAffordances.keys()) {
    allTraitNames.add(traitName);
  }

  // Build definitions for all discovered traits
  for (const name of allTraitNames) {
    const affordances = traitToAffordances.get(name);
    const enablesAffordances = affordances
      ? Array.from(affordances).sort()
      : [];
    const meta = TRAIT_METADATA[name];

    const def: TraitDefinition = {
      name,
      description: meta?.description ?? inferDescription(name, enablesAffordances),
      category: meta?.category ?? inferCategory(name),
      enablesAffordances,
      incompatibleWith: meta?.incompatibleWith ?? [],
    };

    baseTraits.set(name, def);
  }

  // Ensure symmetry: if A is incompatible with B, B should be incompatible with A
  for (const [name, def] of baseTraits) {
    for (const other of def.incompatibleWith) {
      const otherDef = baseTraits.get(other);
      if (otherDef && !otherDef.incompatibleWith.includes(name)) {
        otherDef.incompatibleWith.push(name);
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function mergeUnique(a: string[], b: string[]): string[] {
  const set = new Set([...a, ...b]);
  return Array.from(set).sort();
}

/**
 * Case-insensitive lookup in a trait map. Returns the definition or undefined.
 */
function findTraitInMap(
  map: Map<string, TraitDefinition>,
  name: string
): TraitDefinition | undefined {
  // Fast path: exact match
  const exact = map.get(name);
  if (exact) return exact;
  // Slow path: case-insensitive scan
  const lower = name.toLowerCase();
  for (const [key, def] of map) {
    if (key.toLowerCase() === lower) return def;
  }
  return undefined;
}

/**
 * Find a trait across both base and runtime maps (case-insensitive).
 */
function findTrait(name: string): TraitDefinition | undefined {
  return findTraitInMap(baseTraits, name) ?? findTraitInMap(runtimeTraits, name);
}

// ============================================================================
// Auto-initialize on import
// ============================================================================

initializeBaseTraits();
