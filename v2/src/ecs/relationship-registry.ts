/**
 * Runtime Relationship Type Registry
 *
 * Enables simulation-specific relationship types to be created at runtime.
 * A medieval simulation can register `GuildMember`, `LiegeOf`, `OwesDebtTo`;
 * a neural simulation can register `Synapse` with weight and delay fields;
 * a corporate simulation can register `ManagedBy`, `ReportsTo`.
 *
 * Built on BitECS `createRelation` with `withStore` for typed data fields.
 * Static relations in `relations.ts` are untouched -- this registry is additive.
 */

import {
  createRelation,
  withStore,
  withAutoRemoveSubject,
  makeExclusive,
  addComponent,
  removeComponent,
  hasComponent,
  getRelationTargets,
  query,
  Wildcard,
} from "bitecs";
import { writeFile, readFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

import type { World } from "./world";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelationshipTypeDefinition {
  name: string;
  description: string;
  dataFields: Record<string, "number" | "string">;
  isExclusive: boolean;
  autoRemoveSubject: boolean;
  category: "social" | "economic" | "hierarchical" | "spatial" | "custom";
}

interface RegisteredRelation {
  definition: RelationshipTypeDefinition;
  relation: any; // BitECS relation (callable: relation(targetEid) => component/store)
}

// ---------------------------------------------------------------------------
// Module-level singleton registry
// ---------------------------------------------------------------------------

const registry: Map<string, RegisteredRelation> = new Map();
let _version = 0;

// ---------------------------------------------------------------------------
// Public API -- Registration
// ---------------------------------------------------------------------------

/**
 * Create and register a new relationship type at runtime.
 *
 * Returns the BitECS relation (a callable that takes a target eid and
 * returns a component token suitable for `addComponent` / `query`).
 *
 * **BitECS store semantics:** When a relation is created with `withStore`,
 * calling `relation(targetEid)` returns a per-target store object whose
 * fields are sparse arrays indexed by the subject eid.  Data is always
 * read/written via `relation(targetEid).field[subjectEid]`.
 *
 * Throws if a relation with the same name is already registered.
 */
export function registerRelationshipType(def: RelationshipTypeDefinition): any {
  if (registry.has(def.name)) {
    throw new Error(
      `[RelationshipRegistry] Relationship type "${def.name}" is already registered.`
    );
  }

  // Collect BitECS composable options
  const options: any[] = [];

  // Data store -- one per target, created lazily by BitECS
  const fieldNames = Object.keys(def.dataFields);
  if (fieldNames.length > 0) {
    options.push(
      withStore(() => {
        const store: Record<string, any[]> = {};
        for (const name of fieldNames) {
          store[name] = [] as any[];
        }
        return store;
      })
    );
  }

  if (def.autoRemoveSubject) {
    options.push(withAutoRemoveSubject);
  }

  if (def.isExclusive) {
    options.push(makeExclusive);
  }

  const relation = createRelation(...options);

  const entry: RegisteredRelation = {
    definition: { ...def },
    relation,
  };

  registry.set(def.name, entry);
  _version++;

  return relation;
}

// ---------------------------------------------------------------------------
// Public API -- Lookup
// ---------------------------------------------------------------------------

/** Get the BitECS relation for a named relationship type. */
export function getRelation(name: string): any | undefined {
  return registry.get(name)?.relation;
}

/**
 * Get the per-target data store for a named relationship type.
 *
 * BitECS creates a separate store per target entity.  Call
 * `relation(targetEid)` to get the store object whose fields are sparse
 * arrays indexed by the subject eid.  This helper returns that store for
 * a specific target.
 *
 * Returns `undefined` if the relation is not registered, has no data
 * fields, or the target has never been used.
 */
export function getRelationStore(
  name: string,
  targetEid?: number
): Record<string, any[]> | undefined {
  const entry = registry.get(name);
  if (!entry) return undefined;

  const fieldNames = Object.keys(entry.definition.dataFields);
  if (fieldNames.length === 0) return undefined;

  if (targetEid === undefined) return undefined;

  // relation(targetEid) returns the per-target store object
  const store = entry.relation(targetEid);
  return store;
}

/** Get the definition metadata for a named relationship type. */
export function getRelationshipDefinition(
  name: string
): RelationshipTypeDefinition | undefined {
  const entry = registry.get(name);
  return entry ? { ...entry.definition } : undefined;
}

/** List all registered relationship type definitions. */
export function listRelationshipTypes(): RelationshipTypeDefinition[] {
  return Array.from(registry.values()).map((e) => ({ ...e.definition }));
}

/** Check if a relationship type with the given name exists. */
export function hasRelationshipType(name: string): boolean {
  return registry.has(name);
}

/** Current registry version counter (bumped on each registration). */
export function getRelationshipRegistryVersion(): number {
  return _version;
}

// ---------------------------------------------------------------------------
// Public API -- Entity operations
// ---------------------------------------------------------------------------

/**
 * Add a relationship between two entities, optionally writing data fields.
 *
 * Returns `true` if the relation was applied, `false` if the relation name
 * is not registered.
 */
export function addRelationship(
  world: World,
  subjectEid: number,
  relationName: string,
  targetEid: number,
  data?: Record<string, any>
): boolean {
  const entry = registry.get(relationName);
  if (!entry) return false;

  // relation(targetEid) returns the per-target component/store.
  // After addComponent, the store's arrays are live and indexed by subjectEid.
  const relationComponent = entry.relation(targetEid);
  addComponent(world, subjectEid, relationComponent);

  // Write data fields into the per-target store
  if (data) {
    for (const [field, value] of Object.entries(data)) {
      if (field in relationComponent) {
        relationComponent[field][subjectEid] = value;
      }
    }
  }

  return true;
}

/**
 * Remove a relationship between two entities.
 *
 * Returns `true` if the relation component was removed, `false` if the
 * relation name is not registered.
 */
export function removeRelationship(
  world: World,
  subjectEid: number,
  relationName: string,
  targetEid: number
): boolean {
  const entry = registry.get(relationName);
  if (!entry) return false;

  const relationComponent = entry.relation(targetEid);
  removeComponent(world, subjectEid, relationComponent);
  return true;
}

/**
 * Get all target entity IDs for a given subject and relationship name.
 */
export function getRelationshipTargets(
  world: World,
  subjectEid: number,
  relationName: string
): number[] {
  const entry = registry.get(relationName);
  if (!entry) return [];

  const targets = getRelationTargets(world, subjectEid, entry.relation);
  // BitECS may return a Uint32Array -- normalize to plain number[]
  return Array.from(targets);
}

/**
 * Check whether a specific relationship exists between two entities.
 */
export function hasRelationship(
  world: World,
  subjectEid: number,
  relationName: string,
  targetEid: number
): boolean {
  const entry = registry.get(relationName);
  if (!entry) return false;

  return hasComponent(world, subjectEid, entry.relation(targetEid));
}

/**
 * Read the data fields stored on a relationship between two entities.
 *
 * Returns `undefined` if the relation is not registered, has no data
 * fields, or the relationship does not exist between these entities.
 */
export function getRelationshipData(
  world: World,
  subjectEid: number,
  relationName: string,
  targetEid: number
): Record<string, any> | undefined {
  const entry = registry.get(relationName);
  if (!entry) return undefined;

  const fieldNames = Object.keys(entry.definition.dataFields);
  if (fieldNames.length === 0) return undefined;

  // relation(targetEid) returns the per-target store
  const store = entry.relation(targetEid);

  // Verify the relationship actually exists
  if (!hasComponent(world, subjectEid, store)) {
    return undefined;
  }

  const result: Record<string, any> = {};
  for (const field of fieldNames) {
    if (field in store) {
      result[field] = store[field][subjectEid];
    }
  }
  return result;
}

/**
 * Update data fields on an existing relationship.
 *
 * Returns `true` if the relationship exists and data was written.
 */
export function setRelationshipData(
  world: World,
  subjectEid: number,
  relationName: string,
  targetEid: number,
  data: Record<string, any>
): boolean {
  const entry = registry.get(relationName);
  if (!entry) return false;

  const store = entry.relation(targetEid);

  if (!hasComponent(world, subjectEid, store)) {
    return false;
  }

  for (const [field, value] of Object.entries(data)) {
    if (field in store) {
      store[field][subjectEid] = value;
    }
  }

  return true;
}

/**
 * Query all entities that are subjects of any instance of a named relation.
 * (Uses BitECS wildcard query on the relation.)
 */
export function queryRelationshipSubjects(
  world: World,
  relationName: string
): number[] {
  const entry = registry.get(relationName);
  if (!entry) return [];

  const results = query(world, [entry.relation(Wildcard)]);
  return Array.from(results);
}

// ---------------------------------------------------------------------------
// Public API -- Persistence
// ---------------------------------------------------------------------------

/**
 * Save all registered relationship type definitions to a directory.
 * Each definition is written as `{name}.json`.
 *
 * Note: This saves the *type definitions*, not the actual relationship
 * instances between entities (those are part of world serialization).
 */
export async function saveRelationshipTypes(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  for (const [name, entry] of registry) {
    const filePath = path.join(dir, `${name}.json`);
    await writeFile(
      filePath,
      JSON.stringify(entry.definition, null, 2),
      "utf-8"
    );
  }
}

/**
 * Load relationship type definitions from a directory and register them.
 * Skips any types that are already registered (no-op, no error).
 *
 * Returns the list of definitions that were loaded (including skipped).
 */
export async function loadRelationshipTypes(
  dir: string
): Promise<RelationshipTypeDefinition[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const files = await readdir(dir);
  const loaded: RelationshipTypeDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    try {
      const content = await readFile(path.join(dir, file), "utf-8");
      const def = JSON.parse(content) as RelationshipTypeDefinition;

      // Validate minimal shape
      if (!def.name || typeof def.name !== "string") {
        console.warn(
          `[RelationshipRegistry] Skipping invalid definition in ${file}: missing name`
        );
        continue;
      }

      // Register if new; skip if already exists
      if (!registry.has(def.name)) {
        registerRelationshipType(def);
      }

      loaded.push(def);
    } catch (e) {
      console.error(
        `[RelationshipRegistry] Failed to load relationship type from ${file}:`,
        e
      );
    }
  }

  return loaded;
}

// ---------------------------------------------------------------------------
// Public API -- Testing / Reset
// ---------------------------------------------------------------------------

/**
 * Clear all registered relationship types.
 * **Use only in tests** -- active simulations will lose their relations.
 */
export function resetRelationshipRegistry(): void {
  registry.clear();
  _version = 0;
}

// ---------------------------------------------------------------------------
// Public API -- Merged lookup (static + dynamic)
// ---------------------------------------------------------------------------

/**
 * Get a merged object of all runtime-registered relations keyed by name.
 * Useful for passing into SystemContext alongside `AllRelations`.
 */
export function getMergedRelations(): Record<string, any> {
  const merged: Record<string, any> = {};
  for (const [name, entry] of registry) {
    merged[name] = entry.relation;
  }
  return merged;
}
