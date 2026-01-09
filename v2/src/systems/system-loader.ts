import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { World } from "../ecs/world";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import { query, addEntity, addComponent, removeEntity, getRelationTargets } from "bitecs";
import * as AllComponents from "../ecs/components";
import * as AllRelations from "../ecs/relations";
import { getAllDynamicComponents, getDynamicComponent, getComponentDefinition, listDynamicComponents, type DynamicComponent } from "../ecs/dynamic-components";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

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
  hasDynamic: (eid: number, componentName: string) => boolean;
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
  // Runtime error tracking
  consecutiveErrors: number;
  lastError: string | null;
  fixAttempts: number;
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
      // Runtime error tracking
      consecutiveErrors: 0,
      lastError: null,
      fixAttempts: 0,
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
    hasDynamic: (eid: number, componentName: string): boolean => {
      const component = getDynamicComponent(componentName);
      const def = getComponentDefinition(componentName);
      if (!component || !def) return false;
      // Check if any property has a defined value for this entity
      return Object.keys(def.properties).some(prop => component[prop][eid] !== undefined);
    },
    log: (message: string) => {
      registry.logs.push(`[System] ${message}`);
    },
    emit: (type: string, data: any) => {
      registry.events.push({ type, data, timestamp: Date.now() });
    },
  };
}

const MAX_CONSECUTIVE_ERRORS = 3;
const MAX_FIX_ATTEMPTS = 2;

// Track systems that need fixing (populated during sync run, fixed async later)
const systemsNeedingFix: Array<{ system: LoadedSystem; error: string }> = [];

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
      // Reset error tracking on success
      system.consecutiveErrors = 0;
      system.lastError = null;
    } catch (error) {
      const errorStr = String(error);
      system.consecutiveErrors++;
      system.lastError = errorStr;

      console.error(`[SystemLoader] Error in ${system.name} (${system.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error);
      registry.logs.push(`[Error] System ${system.name} failed: ${errorStr}`);

      // Queue for fixing if threshold reached and not already queued
      if (system.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS &&
          system.fixAttempts < MAX_FIX_ATTEMPTS &&
          !systemsNeedingFix.some(s => s.system.name === system.name)) {
        console.log(`[SystemLoader] Queuing ${system.name} for auto-fix (attempt ${system.fixAttempts + 1})`);
        systemsNeedingFix.push({ system, error: errorStr });
        system.active = false; // Deactivate until fixed
      } else if (system.fixAttempts >= MAX_FIX_ATTEMPTS) {
        console.error(`[SystemLoader] ${system.name} exceeded fix attempts, deactivating`);
        system.active = false;
        registry.logs.push(`[Error] System ${system.name} deactivated after ${MAX_FIX_ATTEMPTS} failed fix attempts`);
      }
    }
  }
}

export function getSystemsNeedingFix(): Array<{ system: LoadedSystem; error: string }> {
  return [...systemsNeedingFix];
}

export function clearSystemsNeedingFix(): void {
  systemsNeedingFix.length = 0;
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

// Runtime error fixer using AI
const runtimeFixerModel = google("gemini-2.0-flash");

export async function fixRuntimeError(
  system: LoadedSystem,
  error: string
): Promise<LoadedSystem | null> {
  console.log(`[RuntimeFixer] Fixing ${system.name}: ${error}`);

  // Get available dynamic components for context
  const dynamicComponents = listDynamicComponents();
  const componentInfo = dynamicComponents.map(c =>
    `  - ${c.name}: { ${Object.entries(c.properties).map(([k,v]) => `${k}: ${v}`).join(', ')} }`
  ).join('\n');

  const systemPrompt = `You are a Runtime Error Fixer for an ECS (Entity Component System) simulation.

CRITICAL - STRUCTURE OF ARRAYS (SoA) PATTERN:
Dynamic components use SoA - each property is an ARRAY indexed by entity ID.

✅ CORRECT ACCESS:
  const Health = ctx.getDynamic("Health");
  const value = Health.current[eid];      // READ
  Health.current[eid] = 50;               // WRITE

❌ WRONG (these methods DON'T EXIST):
  Component.getByEntity(eid)              // NO!
  Component.get(eid)                      // NO!
  Component[eid].property                 // NO!

AVAILABLE DYNAMIC COMPONENTS:
${componentInfo || '(none defined)'}

BUILT-IN COMPONENTS (also SoA):
  - Name.value[eid]
  - Position.x[eid], Position.y[eid], Position.z[eid]
  - Mind.arousal[eid], Mind.mode[eid], Mind.focus[eid]

CONTEXT AVAILABLE IN SYSTEMS:
  - ctx.getDynamic("ComponentName") - get dynamic component (returns SoA object)
  - ctx.hasDynamic(eid, "ComponentName") - check if entity has component
  - ctx.query(world, [Component]) - query entities with component
  - ctx.components.Name, ctx.components.Position, etc. - built-in components
  - ctx.log("message") - log output

COMMON RUNTIME ERRORS AND FIXES:
1. "Cannot read properties of undefined (reading 'X')"
   - Usually means accessing Component.property[eid] where property doesn't exist
   - Check property names match component definition exactly (case-sensitive!)
   - Check the dynamic component exists before accessing

2. "X is not a function"
   - You're calling a method that doesn't exist (like getByEntity)
   - Use SoA pattern: Component.property[eid]

FIX RULES:
1. Return ONLY the fixed function body (the code inside export function run)
2. No markdown, no explanation
3. Keep the same logic, just fix the bug
4. Add null checks where needed`;

  const prompt = `Fix this runtime error in system "${system.name}":

ERROR: ${error}

CURRENT CODE:
\`\`\`typescript
${system.source}
\`\`\`

Return ONLY the fixed function body code (everything inside the run function).`;

  try {
    const { text } = await generateText({
      model: runtimeFixerModel,
      system: systemPrompt,
      prompt,
    });

    let fixedCode = text.trim();
    // Remove markdown fences if present
    if (fixedCode.startsWith('```')) {
      fixedCode = fixedCode.replace(/```\w*\n?/g, '').trim();
    }
    if (fixedCode.endsWith('```')) {
      fixedCode = fixedCode.slice(0, -3).trim();
    }

    // Extract just the function body if full function was returned
    const bodyMatch = fixedCode.match(/export function run\([^)]*\)[^{]*\{([\s\S]*)\}$/);
    if (bodyMatch) {
      fixedCode = bodyMatch[1].trim();
    }

    // Remove leading indentation
    const lines = fixedCode.split('\n');
    const minIndent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)?.[0].length ?? 0));
    fixedCode = lines.map(l => l.slice(minIndent)).join('\n');

    console.log(`[RuntimeFixer] Generated fix for ${system.name}`);

    // Get current metadata from source
    const descMatch = system.source.match(/export const description = "(.*)";/);
    const freqMatch = system.source.match(/export const frequency = (\d+);/);

    const filePath = await writeSystemFile({
      name: system.name,
      description: descMatch ? descMatch[1] : system.description,
      frequency: freqMatch ? parseInt(freqMatch[1]) : system.frequency,
      code: fixedCode,
    });

    const reloadedSystem = await loadSystemFromFile(filePath);
    if (reloadedSystem) {
      reloadedSystem.fixAttempts = system.fixAttempts + 1;
      reloadedSystem.consecutiveErrors = 0;
      reloadedSystem.active = true;
      console.log(`[RuntimeFixer] Successfully fixed and reloaded ${system.name}`);
    }
    return reloadedSystem;
  } catch (err) {
    console.error(`[RuntimeFixer] Failed to fix ${system.name}:`, err);
    return null;
  }
}

export async function fixAllQueuedSystems(
  systems: LoadedSystem[]
): Promise<{ fixed: string[]; failed: string[] }> {
  const queued = getSystemsNeedingFix();
  const fixed: string[] = [];
  const failed: string[] = [];

  for (const { system, error } of queued) {
    const fixedSystem = await fixRuntimeError(system, error);
    if (fixedSystem) {
      // Replace the system in the array
      const idx = systems.findIndex(s => s.name === system.name);
      if (idx >= 0) {
        systems[idx] = fixedSystem;
      }
      fixed.push(system.name);
    } else {
      failed.push(system.name);
    }
  }

  clearSystemsNeedingFix();
  return { fixed, failed };
}
