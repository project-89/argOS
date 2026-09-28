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
import { builtinComponentSchema } from "./builtin-component-schema";
import type { ComponentDefinition, DynamicComponent } from "./dynamic-components";
import { assertParticipantMutationAllowed } from "../runtime/participant-identities";
import { assertComponentValueFormat, getComponentValueFormats, prepareComponentEncodedValues } from "./component-value-formats";

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
    const properties = { ...builtinComponentSchema[name as keyof typeof builtinComponentSchema] };
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
  const existing = entries.get(name);
  if (existing) {
    const existingKind = existing.isStatic ? "built-in" : "dynamic";
    const incomingKind = isStatic ? "built-in" : "dynamic";
    throw new Error(
      `[Registry] Component name collision: "${name}" is already registered as ${existingKind}; cannot replace it with ${incomingKind}`
    );
  }

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

/** Additive live schema migration. Preserve the SoA identity held by BitECS queries. */
export function extendDynamicComponent(def: ComponentDefinition): void {
  const entry = entries.get(def.name);
  if (!entry) { registryCreateComponent(def); return; }
  if (entry.isStatic) throw new Error(`Cannot redefine built-in ${def.name}`);
  for (const [field, old] of Object.entries(entry.definition?.properties ?? {})) {
    const oldType = typeof old === "string" ? old : (old as any).type;
    if (def.properties[field] !== oldType) throw new Error(`Incompatible schema change: ${def.name}.${field}`);
  }
  for (const field of Object.keys(def.properties)) if (!Object.hasOwn(entry.soa, field)) entry.soa[field] = [];
  entry.definition = def;
  _version++;
  _cachedMerged = null;
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
  assertParticipantMutationAllowed(world,eid,name,values);
  const prepared=prepareComponentEncodedValues(name,values,!bitecsHasComponent(world,eid,entry.soa));
  bitecsAddComponent(world, eid, entry.soa);

  if (prepared) {
    for (const [prop, value] of Object.entries(prepared)) {
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

/** Pure preflight shared by additive entity/object materializers. Neither a
 * missing schema nor sampled values can define the type of a requested field. */
export function validateComponentInitialValues(definition: ComponentDefinition, values: unknown): Record<string, string | number | boolean> {
  const name = definition.name;
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`Invalid component values: ${name}`);
  const fields = definition.properties;
  const valid = (kind: unknown, value: unknown) => ["string", "number", "boolean"].includes(String(kind)) && typeof value === kind
    && (typeof value !== "number" || Number.isFinite(value)) && (typeof value !== "string" || value.length <= 4000);
  for (const [field, value] of Object.entries(values)) {
    const schema: any = Object.hasOwn(fields, field) ? fields[field] : undefined;
    const kind = typeof schema === "string" ? schema : schema?.type;
    if (!valid(kind, value)) throw new Error(`Invalid type or unknown field ${name}.${field}`);
  }
  return Object.fromEntries(Object.entries(fields).map(([field, schema]: [string, any]) => {
    const kind = typeof schema === "string" ? schema : schema?.type;
    const value = Object.hasOwn(values, field) ? (values as Record<string, unknown>)[field]
      : definition.defaults?.[field] ?? schema?.default ?? getComponentValueFormats(name)[field]?.defaultValue ?? (kind === "number" ? 0 : kind === "boolean" ? false : "");
    if (!valid(kind, value)) throw new Error(`Invalid default or schema ${name}.${field}`);
    assertComponentValueFormat(name,field,value);
    return [field, value as string | number | boolean];
  }));
}
