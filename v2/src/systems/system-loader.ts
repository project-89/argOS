import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { query, addEntity, addComponent, removeEntity, getRelationTargets } from "bitecs";
import * as AllComponents from "../ecs/components";
import * as AllRelations from "../ecs/relations";
import { getAllDynamicComponents, getDynamicComponent, type DynamicComponent } from "../ecs/dynamic-components";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.join(__dirname, "generated");

export interface SystemFile {
  name: string;
  description: string;
  frequency: number;
  active: boolean;
  run: (world: World, ctx: SystemContext) => void;
}

export interface SystemContext {
  tick: number;
  delta: number;
  query: typeof query;
  addEntity: typeof addEntity;
  addComponent: typeof addComponent;
  removeEntity: typeof removeEntity;
  getRelationTargets: typeof getRelationTargets;
  components: typeof AllComponents;
  relations: typeof AllRelations;
  dynamicComponents: Map<string, DynamicComponent>;
  getDynamic: (name: string) => DynamicComponent | undefined;
  log: (message: string) => void;
  emit: (type: string, data: any) => void;
}

export interface LoadedSystem {
  name: string;
  description: string;
  frequency: number;
  active: boolean;
  filePath: string;
  run: (world: World, ctx: SystemContext) => void;
  lastRun: number;
  source: string;
}

export async function ensureGeneratedDir(): Promise<void> {
  if (!existsSync(GENERATED_DIR)) {
    await mkdir(GENERATED_DIR, { recursive: true });
  }
}

export function generateSystemCode(system: {
  name: string;
  description: string;
  frequency: number;
  code: string;
}): string {
  const kebabName = system.name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  
  return `import type { World } from "../../ecs/world";
import type { SystemContext } from "../system-loader";

export const name = "${system.name}";
export const description = "${system.description.replace(/"/g, '\\"')}";
export const frequency = ${system.frequency};
export const active = true;

export function run(world: World, ctx: SystemContext): void {
${system.code.split('\n').map(line => '  ' + line).join('\n')}
}
`;
}

export async function writeSystemFile(system: {
  name: string;
  description: string;
  frequency: number;
  code: string;
}): Promise<string> {
  await ensureGeneratedDir();
  
  const kebabName = system.name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(GENERATED_DIR, `${kebabName}.ts`);
  const code = generateSystemCode(system);
  
  await writeFile(filePath, code, "utf-8");
  console.log(`[SystemLoader] Wrote system to ${filePath}`);
  
  return filePath;
}

export async function loadSystemFromFile(filePath: string): Promise<LoadedSystem | null> {
  try {
    const source = await readFile(filePath, "utf-8");
    const module = await import(filePath + `?t=${Date.now()}`);
    
    return {
      name: module.name,
      description: module.description,
      frequency: module.frequency ?? 1,
      active: module.active ?? true,
      filePath,
      run: module.run,
      lastRun: 0,
      source,
    };
  } catch (error) {
    console.error(`[SystemLoader] Failed to load ${filePath}:`, error);
    return null;
  }
}

export async function loadAllSystems(): Promise<LoadedSystem[]> {
  await ensureGeneratedDir();
  
  const files = await readdir(GENERATED_DIR);
  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("_"));
  
  const systems: LoadedSystem[] = [];
  
  for (const file of tsFiles) {
    const filePath = path.join(GENERATED_DIR, file);
    const system = await loadSystemFromFile(filePath);
    if (system) {
      systems.push(system);
    }
  }
  
  console.log(`[SystemLoader] Loaded ${systems.length} systems from ${GENERATED_DIR}`);
  return systems;
}

export function createSystemContext(
  registry: SystemRegistry,
  tick: number,
  delta: number
): SystemContext {
  return {
    tick,
    delta,
    query,
    addEntity,
    addComponent,
    removeEntity,
    getRelationTargets,
    components: AllComponents,
    relations: AllRelations,
    dynamicComponents: getAllDynamicComponents(),
    getDynamic: getDynamicComponent,
    log: (message: string) => {
      registry.logs.push(`[System] ${message}`);
    },
    emit: (type: string, data: any) => {
      registry.events.push({ type, data, timestamp: Date.now() });
    },
  };
}

export function runLoadedSystems(
  world: World,
  systems: LoadedSystem[],
  registry: SystemRegistry,
  tick: number,
  delta: number
): void {
  const ctx = createSystemContext(registry, tick, delta);
  
  for (const system of systems) {
    if (!system.active) continue;
    if (tick - system.lastRun < system.frequency) continue;
    
    try {
      system.run(world, ctx);
      system.lastRun = tick;
    } catch (error) {
      console.error(`[SystemLoader] Error in ${system.name}:`, error);
      registry.logs.push(`[Error] System ${system.name} failed: ${error}`);
    }
  }
}

export async function listSystemFiles(): Promise<string[]> {
  await ensureGeneratedDir();
  const files = await readdir(GENERATED_DIR);
  return files.filter(f => f.endsWith(".ts") && !f.startsWith("_"));
}

export async function getSystemSource(systemName: string): Promise<string | null> {
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(GENERATED_DIR, `${kebabName}.ts`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function deleteSystemFile(systemName: string): Promise<boolean> {
  const { unlink } = await import("fs/promises");
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(GENERATED_DIR, `${kebabName}.ts`);
  try {
    await unlink(filePath);
    console.log(`[SystemLoader] Deleted system ${systemName}`);
    return true;
  } catch {
    return false;
  }
}

export async function updateSystemFile(
  systemName: string,
  updates: { description?: string; frequency?: number; code?: string }
): Promise<LoadedSystem | null> {
  const source = await getSystemSource(systemName);
  if (!source) return null;
  
  let newDescription = updates.description;
  let newFrequency = updates.frequency;
  let newCode = updates.code;
  
  if (!newDescription) {
    const match = source.match(/export const description = "(.*)";/);
    newDescription = match ? match[1] : "";
  }
  if (newFrequency === undefined) {
    const match = source.match(/export const frequency = (\d+);/);
    newFrequency = match ? parseInt(match[1]) : 1;
  }
  if (!newCode) {
    const match = source.match(/export function run\(world: World, ctx: SystemContext\): void \{\n([\s\S]*)\n\}/);
    newCode = match ? match[1].split('\n').map(l => l.replace(/^  /, '')).join('\n') : "";
  }
  
  const filePath = await writeSystemFile({
    name: systemName,
    description: newDescription,
    frequency: newFrequency,
    code: newCode,
  });
  
  return loadSystemFromFile(filePath);
}
