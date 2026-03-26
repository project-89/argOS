/**
 * Unified Component Registry
 *
 * Single source of truth mapping component name → SoA object + definition.
 * Bridges static (built-in) and dynamic (runtime-created) components so both
 * are first-class BitECS citizens — queryable, attachable, and usable in
 * generated systems via ctx.components.
 */

import { addComponent as bitecsAddComponent, removeComponent as bitecsRemoveComponent, hasComponent as bitecsHasComponent } from "bitecs";
import type { World } from "./world";
import { AllComponents } from "./components";
import type { ComponentDefinition, DynamicComponent } from "./dynamic-components";

export interface RegistryEntry {
  soa: any;                        // The SoA object (same shape as static components)
  definition?: ComponentDefinition; // Schema metadata for LLM prompts
  isStatic: boolean;               // Built-in vs runtime-created
}

// Module-level singleton
const entries = new Map<string, RegistryEntry>();
let _world: World | null = null;
let _version = 0;
let _cachedMerged: Record<string, any> | null = null;

/**
 * Initialize registry with all static components and optionally load
 * persisted dynamic components from disk.
 */
export function initializeRegistry(world: World): void {
  _world = world;
  entries.clear();
  _version = 0;
  _cachedMerged = null;

  // Register all static components
  for (const [name, soa] of Object.entries(AllComponents)) {
    const properties: Record<string, "number" | "string" | "boolean"> = {};
    for (const prop of Object.keys(soa)) {
      // Default to string; could inspect existing values for better inference
      properties[prop] = "string";
    }
    entries.set(name, {
      soa,
      definition: {
        name,
        description: `Built-in ${name} component`,
        properties,
      },
      isStatic: true,
    });
  }

  _version++;
  _cachedMerged = null;
}

/**
 * Register a component (static or dynamic) in the registry.
 */
export function registerComponent(
  name: string,
  soa: any,
  definition?: ComponentDefinition,
  isStatic: boolean = false
): void {
  entries.set(name, { soa, definition, isStatic });
  _version++;
  _cachedMerged = null;
}

/**
 * Create a new dynamic component from a definition, register it, and return the SoA.
 */
export function registryCreateComponent(def: ComponentDefinition): DynamicComponent {
  const component: DynamicComponent = {};

  if (!def || !def.properties || typeof def.properties !== "object") {
    console.warn(`[Registry] Invalid component definition for "${def?.name || "unknown"}": missing properties`);
    if (def?.name) {
      registerComponent(def.name, component, { ...def, properties: {} }, false);
    }
    return component;
  }

  for (const [propName] of Object.entries(def.properties)) {
    component[propName] = [];
  }

  registerComponent(def.name, component, def, false);
  return component;
}

/**
 * Get a component's SoA object by name. Works for both static and dynamic.
 */
export function getComponent(name: string): any | undefined {
  return entries.get(name)?.soa;
}

/**
 * Check if a component exists in the registry.
 */
export function registryHasComponent(name: string): boolean {
  return entries.has(name);
}

/**
 * Attach a component to an entity by name. This is the critical bridge —
 * it calls BitECS addComponent so the entity is queryable.
 * Optionally writes initial values.
 */
export function attachToEntity(
  world: World,
  eid: number,
  name: string,
  values?: Record<string, any>
): boolean {
  const entry = entries.get(name);
  if (!entry) return false;

  // BitECS addComponent is idempotent — safe to call repeatedly
  bitecsAddComponent(world, eid, entry.soa);

  if (values) {
    for (const [prop, value] of Object.entries(values)) {
      if (prop in entry.soa) {
        entry.soa[prop][eid] = value;
      }
    }
  }

  return true;
}

/**
 * Detach a component from an entity by name.
 */
export function detachFromEntity(world: World, eid: number, name: string): boolean {
  const entry = entries.get(name);
  if (!entry) return false;
  bitecsRemoveComponent(world, eid, entry.soa);
  return true;
}

/**
 * Check if an entity has a component by name.
 */
export function entityHasComponent(world: World, eid: number, name: string): boolean {
  const entry = entries.get(name);
  if (!entry) return false;
  return bitecsHasComponent(world, eid, entry.soa);
}

/**
 * Get a merged object of all components { ...static, ...dynamic } for use as ctx.components.
 * Cached and invalidated on registry version change.
 */
export function getMergedComponents(): Record<string, any> {
  if (_cachedMerged && _version > 0) return _cachedMerged;

  const merged: Record<string, any> = {};
  for (const [name, entry] of entries) {
    merged[name] = entry.soa;
  }

  _cachedMerged = merged;
  return merged;
}

/**
 * List all component names.
 */
export function listNames(): string[] {
  return Array.from(entries.keys());
}

/**
 * List definitions of all registered components.
 */
export function listDefinitions(): ComponentDefinition[] {
  const defs: ComponentDefinition[] = [];
  for (const entry of entries.values()) {
    if (entry.definition) defs.push(entry.definition);
  }
  return defs;
}

/**
 * List only dynamic (non-static) component definitions.
 */
export function listDynamic(): ComponentDefinition[] {
  const defs: ComponentDefinition[] = [];
  for (const entry of entries.values()) {
    if (!entry.isStatic && entry.definition) defs.push(entry.definition);
  }
  return defs;
}

/**
 * List only dynamic component entries (name → SoA).
 */
export function listDynamicEntries(): Map<string, DynamicComponent> {
  const result = new Map<string, DynamicComponent>();
  for (const [name, entry] of entries) {
    if (!entry.isStatic) result.set(name, entry.soa);
  }
  return result;
}

/**
 * Get the registry version (bumped on every registration).
 */
export function getRegistryVersion(): number {
  return _version;
}

/**
 * Get the stored world reference.
 */
export function getRegistryWorld(): World | null {
  return _world;
}

/**
 * Get registry entry by name (for advanced use).
 */
export function getRegistryEntry(name: string): RegistryEntry | undefined {
  return entries.get(name);
}
