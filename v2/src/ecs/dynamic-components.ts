import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import {
  registerComponent,
  registryCreateComponent,
  getComponent,
  listDynamic,
  listDynamicEntries,
  getRegistryEntry,
  getRegistryWorld,
  attachToEntity,
} from "./component-registry";

// Get directory path - works in both ESM and CommonJS
function getCurrentDir(): string {
  // Check if we're in CommonJS (Jest compiles to this)
  if (typeof __dirname !== "undefined") {
    return __dirname;
  }
  // ESM fallback - use process.cwd() as base
  return path.join(process.cwd(), "src/ecs");
}

const currentDir = getCurrentDir();
let COMPONENTS_DIR = path.join(currentDir, "../../data/components");

/**
 * Override the components directory for sandbox isolation.
 * Each simulation run can have its own components folder.
 */
export function setComponentsDir(dir: string): void {
  COMPONENTS_DIR = dir;
}

/** Get the current components directory path */
export function getComponentsDir(): string {
  return COMPONENTS_DIR;
}

export interface ComponentDefinition {
  name: string;
  description: string;
  properties: Record<string, "number" | "string" | "boolean">;
}

export interface DynamicComponent {
  [key: string]: any[];
}

// Keep local maps for backward compat with code that directly accesses these
const runtimeComponents: Map<string, DynamicComponent> = new Map();
const componentDefinitions: Map<string, ComponentDefinition> = new Map();

export async function ensureComponentsDir(): Promise<void> {
  if (!existsSync(COMPONENTS_DIR)) {
    await mkdir(COMPONENTS_DIR, { recursive: true });
  }
}

export function createDynamicComponent(def: ComponentDefinition): DynamicComponent {
  // Delegate to registry for creation
  const component = registryCreateComponent(def);

  // Keep local maps in sync for backward compat
  runtimeComponents.set(def.name, component);
  if (def.properties && typeof def.properties === "object") {
    componentDefinitions.set(def.name, def);
  } else {
    componentDefinitions.set(def.name, { ...def, properties: {} });
  }

  return component;
}

export function getDynamicComponent(name: string): DynamicComponent | undefined {
  // Check registry first (it has both static and dynamic)
  const entry = getRegistryEntry(name);
  if (entry && !entry.isStatic) return entry.soa;
  // Fallback to local map (registry may not be initialized yet)
  return runtimeComponents.get(name);
}

export function getComponentDefinition(name: string): ComponentDefinition | undefined {
  const entry = getRegistryEntry(name);
  if (entry?.definition) return entry.definition;
  return componentDefinitions.get(name);
}

export function listDynamicComponents(): ComponentDefinition[] {
  // Prefer registry if initialized
  const dynamicDefs = listDynamic();
  if (dynamicDefs.length > 0) return dynamicDefs;
  return Array.from(componentDefinitions.values());
}

export function clearDynamicComponents(): void {
  runtimeComponents.clear();
  componentDefinitions.clear();
}

export async function saveComponentDefinition(def: ComponentDefinition): Promise<string> {
  await ensureComponentsDir();
  const filePath = path.join(COMPONENTS_DIR, `${def.name}.json`);
  await writeFile(filePath, JSON.stringify(def, null, 2), "utf-8");
  return filePath;
}

export async function loadComponentDefinitions(): Promise<ComponentDefinition[]> {
  await ensureComponentsDir();
  const { readdir } = await import("fs/promises");
  const files = await readdir(COMPONENTS_DIR);
  const defs: ComponentDefinition[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await readFile(path.join(COMPONENTS_DIR, file), "utf-8");
      const def = JSON.parse(content) as ComponentDefinition;
      createDynamicComponent(def);
      defs.push(def);
    } catch (e) {
      console.error(`Failed to load component ${file}:`, e);
    }
  }

  return defs;
}

export function setDynamicComponentValue(
  componentName: string,
  eid: number,
  property: string,
  value: any
): boolean {
  // Get component from registry or local map
  const entry = getRegistryEntry(componentName);
  const component = entry?.soa ?? runtimeComponents.get(componentName);
  if (!component || !(property in component)) return false;

  // Bridge: ensure entity has this component registered with BitECS
  const world = getRegistryWorld();
  if (world && entry) {
    // addComponent is idempotent — safe to call every time
    attachToEntity(world, eid, componentName);
  }

  component[property][eid] = value;
  return true;
}

export function getDynamicComponentValue(
  componentName: string,
  eid: number,
  property: string
): any {
  const entry = getRegistryEntry(componentName);
  const component = entry?.soa ?? runtimeComponents.get(componentName);
  if (!component || !(property in component)) return undefined;
  return component[property][eid];
}

export function getAllDynamicComponents(): Map<string, DynamicComponent> {
  // Prefer registry if initialized
  const dynamicEntries = listDynamicEntries();
  if (dynamicEntries.size > 0) return dynamicEntries;
  return runtimeComponents;
}

export function getDynamicComponentValues(
  componentName: string,
  eid: number
): Record<string, any> | undefined {
  const entry = getRegistryEntry(componentName);
  const component = entry?.soa ?? runtimeComponents.get(componentName);
  const def = entry?.definition ?? componentDefinitions.get(componentName);
  if (!component || !def) return undefined;

  const values: Record<string, any> = {};
  for (const propName of Object.keys(def.properties)) {
    values[propName] = component[propName][eid];
  }
  return values;
}

export function getAllDynamicComponentValuesForEntity(
  eid: number
): Record<string, Record<string, any>> {
  const result: Record<string, Record<string, any>> = {};

  // Check both registry and local maps
  const defsToCheck = new Map<string, { def: ComponentDefinition; soa: any }>();

  // From registry (dynamic only)
  const dynamicDefs = listDynamic();
  for (const def of dynamicDefs) {
    const soa = getComponent(def.name);
    if (soa) defsToCheck.set(def.name, { def, soa });
  }

  // From local maps (fallback)
  for (const [name, def] of componentDefinitions.entries()) {
    if (!defsToCheck.has(name)) {
      const soa = runtimeComponents.get(name);
      if (soa) defsToCheck.set(name, { def, soa });
    }
  }

  for (const [name, { def, soa }] of defsToCheck) {
    const hasAnyValue = Object.keys(def.properties).some(
      prop => soa[prop][eid] !== undefined
    );

    if (hasAnyValue) {
      result[name] = {};
      for (const propName of Object.keys(def.properties)) {
        result[name][propName] = soa[propName][eid];
      }
    }
  }

  return result;
}
