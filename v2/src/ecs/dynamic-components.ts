import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = path.join(__dirname, "../../data/components");

export interface ComponentDefinition {
  name: string;
  description: string;
  properties: Record<string, "number" | "string" | "boolean">;
}

export interface DynamicComponent {
  [key: string]: any[];
}

const runtimeComponents: Map<string, DynamicComponent> = new Map();
const componentDefinitions: Map<string, ComponentDefinition> = new Map();

export async function ensureComponentsDir(): Promise<void> {
  if (!existsSync(COMPONENTS_DIR)) {
    await mkdir(COMPONENTS_DIR, { recursive: true });
  }
}

export function createDynamicComponent(def: ComponentDefinition): DynamicComponent {
  const component: DynamicComponent = {};
  for (const [propName, propType] of Object.entries(def.properties)) {
    component[propName] = [];
  }
  runtimeComponents.set(def.name, component);
  componentDefinitions.set(def.name, def);
  return component;
}

export function getDynamicComponent(name: string): DynamicComponent | undefined {
  return runtimeComponents.get(name);
}

export function getComponentDefinition(name: string): ComponentDefinition | undefined {
  return componentDefinitions.get(name);
}

export function listDynamicComponents(): ComponentDefinition[] {
  return Array.from(componentDefinitions.values());
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
  const component = runtimeComponents.get(componentName);
  if (!component || !(property in component)) return false;
  component[property][eid] = value;
  return true;
}

export function getDynamicComponentValue(
  componentName: string,
  eid: number,
  property: string
): any {
  const component = runtimeComponents.get(componentName);
  if (!component || !(property in component)) return undefined;
  return component[property][eid];
}

export function getAllDynamicComponents(): Map<string, DynamicComponent> {
  return runtimeComponents;
}

export function getDynamicComponentValues(
  componentName: string,
  eid: number
): Record<string, any> | undefined {
  const component = runtimeComponents.get(componentName);
  const def = componentDefinitions.get(componentName);
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
  
  for (const [name, def] of componentDefinitions.entries()) {
    const component = runtimeComponents.get(name);
    if (!component) continue;
    
    const hasAnyValue = Object.keys(def.properties).some(
      prop => component[prop][eid] !== undefined
    );
    
    if (hasAnyValue) {
      result[name] = {};
      for (const propName of Object.keys(def.properties)) {
        result[name][propName] = component[propName][eid];
      }
    }
  }
  
  return result;
}
