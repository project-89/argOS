import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import type { World } from "../ecs/world";
import { createSystemRegistry, reportSystemError, type SystemRegistry } from "../ecs/dynamic-systems";
import { query, addEntity, addComponent, removeEntity, getRelationTargets } from "bitecs";
import * as AllComponents from "../ecs/components";
import * as AllRelations from "../ecs/relations";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "../ecs/location";
import { getAllDynamicComponents, getDynamicComponent, getComponentDefinition, listDynamicComponents, loadComponentDefinitions, type DynamicComponent } from "../ecs/dynamic-components";
import { google } from "@ai-sdk/google";
import { generateText } from "ai";

// Default to a path under the project root. (Tests may load this module under CJS; avoid `import.meta`.)
const DEFAULT_GENERATED_DIR = path.resolve(process.cwd(), "src/systems/generated");

function getGeneratedDir(): string {
  const env = process.env.ARGOS_GENERATED_SYSTEMS_DIR;
  if (env && env.trim().length > 0) {
    const trimmed = env.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  return DEFAULT_GENERATED_DIR;
}

function getQuarantineDir(): string {
  return path.join(getGeneratedDir(), "_quarantine");
}

function shouldQuarantineSystems(): boolean {
  return String(process.env.ARGOS_SYSTEM_QUARANTINE || "").trim() !== "0";
}

function quarantineSystemFileSync(system: LoadedSystem, reason: string): void {
  if (!shouldQuarantineSystems()) return;
  if (!system.filePath || !existsSync(system.filePath)) return;
  if (system.quarantinedAtMs) return;

  const quarantineDir = getQuarantineDir();
  try {
    mkdirSync(quarantineDir, { recursive: true });
  } catch {
    // best-effort
  }

  const base = path.basename(system.filePath);
  const ts = Date.now();
  const destFile = path.join(quarantineDir, `${base.replace(/\.ts$/, "")}.${ts}.ts`);
  try {
    renameSync(system.filePath, destFile);
    system.quarantinedTo = destFile;
    system.quarantinedAtMs = ts;

    const report = {
      name: system.name,
      description: system.description,
      frequency: system.frequency,
      originalPath: system.filePath,
      quarantinedPath: destFile,
      quarantinedAtMs: ts,
      reason,
      lastError: system.lastError,
    };
    try {
      writeFileSync(path.join(quarantineDir, `${base.replace(/\.ts$/, "")}.${ts}.json`), JSON.stringify(report, null, 2), "utf8");
    } catch {
      // ignore
    }
    console.error(`[SystemLoader] Quarantined ${system.name} -> ${destFile}`);
  } catch (e) {
    // Never throw from the runtime loop.
    console.error(`[SystemLoader] Failed to quarantine ${system.name}:`, e);
  }
}

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
  location: {
    getDirectContainer: typeof getDirectContainer;
    getRoomForEntity: typeof getRoomForEntity;
    listDirectContents: typeof listDirectContents;
  };
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
  quarantinedTo?: string;
  quarantinedAtMs?: number;
}

export async function ensureGeneratedDir(): Promise<void> {
  const dir = getGeneratedDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
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
  const filePath = path.join(getGeneratedDir(), `${kebabName}.ts`);
  const code = generateSystemCode(system);
  
  await writeFile(filePath, code, "utf-8");
  console.log(`[SystemLoader] Wrote system to ${filePath}`);
  
  return filePath;
}

export async function loadSystemFromFile(filePath: string): Promise<LoadedSystem | null> {
  try {
    const source = await readFile(filePath, "utf-8");
    const url = pathToFileURL(filePath);
    const module = await import(url.href + `?t=${Date.now()}`);
    
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
      quarantinedTo: undefined,
      quarantinedAtMs: undefined,
    };
  } catch (error) {
    console.error(`[SystemLoader] Failed to load ${filePath}:`, error);
    return null;
  }
}

export async function loadAllSystems(): Promise<LoadedSystem[]> {
  await ensureGeneratedDir();
  
  const dir = getGeneratedDir();
  const files = await readdir(dir);
  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("_"));
  
  const systems: LoadedSystem[] = [];
  
  for (const file of tsFiles) {
    const filePath = path.join(dir, file);
    const system = await loadSystemFromFile(filePath);
    if (system) {
      systems.push(system);
    }
  }
  
  console.log(`[SystemLoader] Loaded ${systems.length} systems from ${dir}`);
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
    location: {
      getDirectContainer,
      getRoomForEntity,
      listDirectContents,
    },
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
      const errorStr = error instanceof Error ? (error.stack || error.message) : String(error);
      system.consecutiveErrors++;
      system.lastError = errorStr;

      console.error(`[SystemLoader] Error in ${system.name} (${system.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error);
      registry.logs.push(`[Error] System ${system.name} failed: ${errorStr}`);
      reportSystemError(registry, system.name, errorStr, `fileSystem:${system.filePath}`);

      // Always deactivate when we hit the threshold. Even if the system is already queued for fixing,
      // it must not keep running and spamming errors (e.g., if an agent tries to re-activate it).
      if (system.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        system.active = false;
        quarantineSystemFileSync(system, `runtime_error_threshold:${system.consecutiveErrors}`);
        registry.events.push({
          type: "system_quarantined",
          data: { name: system.name, filePath: system.filePath, quarantinedTo: system.quarantinedTo, error: errorStr },
          timestamp: Date.now(),
        });
      }

      // Queue for fixing if threshold reached and not already queued
      if (system.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS &&
          system.fixAttempts < MAX_FIX_ATTEMPTS &&
          !systemsNeedingFix.some(s => s.system.name === system.name)) {
        console.log(`[SystemLoader] Queuing ${system.name} for auto-fix (attempt ${system.fixAttempts + 1})`);
        systemsNeedingFix.push({ system, error: errorStr });
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
  const files = await readdir(getGeneratedDir());
  return files.filter(f => f.endsWith(".ts") && !f.startsWith("_"));
}

export async function getSystemSource(systemName: string): Promise<string | null> {
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(getGeneratedDir(), `${kebabName}.ts`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function deleteSystemFile(systemName: string): Promise<boolean> {
  const { unlink } = await import("fs/promises");
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(getGeneratedDir(), `${kebabName}.ts`);
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
      const preflight = await preflightValidateSystem(reloadedSystem, { ticks: 2 });
      if (!preflight.ok) {
        reloadedSystem.lastError = preflight.error || "Preflight validation failed";
        reloadedSystem.active = false;
        quarantineSystemFileSync(reloadedSystem, "preflight_failed_after_fix");
        console.error(`[RuntimeFixer] Preflight failed for ${system.name}, quarantined`);
        return null;
      }
      console.log(`[RuntimeFixer] Successfully fixed, validated, and reloaded ${system.name}`);
    }
    return reloadedSystem;
  } catch (err) {
    console.error(`[RuntimeFixer] Failed to fix ${system.name}:`, err);
    return null;
  }
}

export async function preflightValidateSystem(
  system: LoadedSystem,
  opts: { ticks?: number } = {}
): Promise<{ ok: boolean; error?: string }> {
  const ticks = Number.isFinite(Number(opts.ticks)) ? Math.max(1, Math.min(10, Number(opts.ticks))) : 2;
  try {
    await loadComponentDefinitions();
  } catch {
    // best-effort
  }

  const { createArgosWorld } = await import("../ecs/world");
  const { initializePrefabs, createRoomEntity, createAgentEntity } = await import("../ecs/prefabs");
  const { ObjectManager } = await import("../world/object-manager");

  const world = createArgosWorld(`SystemPreflight:${system.name}`) as any;
  initializePrefabs(world);
  const objectManager = new ObjectManager(world);

  const room = createRoomEntity(world, { name: "Validation Room", description: "A room used for preflight validation." });
  createAgentEntity(world, { name: "Validator", role: "npc", systemPrompt: "x", roomId: room });
  objectManager.spawn("torch", { name: "Validation Torch", containedIn: room, state: "lit" });

  const registry = createSystemRegistry();

  for (let t = 1; t <= ticks; t++) {
    const ctx = createSystemContext(registry, t, 16);
    try {
      system.run(world, ctx);
    } catch (e) {
      const errorStr = e instanceof Error ? (e.stack || e.message) : String(e);
      return { ok: false, error: errorStr };
    }
  }

  return { ok: true };
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

// ============================================================================
// Simulation-Aware System Management
// ============================================================================

/**
 * Write a system file to a custom directory (e.g., simulation folder)
 */
export async function writeSystemToDir(
  dir: string,
  system: {
    name: string;
    description: string;
    frequency: number;
    code: string;
  }
): Promise<string> {
  await mkdir(dir, { recursive: true });

  const kebabName = system.name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(dir, `${kebabName}.ts`);
  const code = generateSystemCode(system);

  await writeFile(filePath, code, "utf-8");
  console.log(`[SystemLoader] Wrote system to ${filePath}`);

  return filePath;
}

/**
 * Load all systems from a custom directory (e.g., simulation folder)
 */
export async function loadSystemsFromDir(dir: string): Promise<LoadedSystem[]> {
  if (!existsSync(dir)) {
    return [];
  }

  const files = await readdir(dir);
  const tsFiles = files.filter(f => f.endsWith(".ts") && !f.startsWith("_"));

  const systems: LoadedSystem[] = [];

  for (const file of tsFiles) {
    const filePath = path.join(dir, file);
    const system = await loadSystemFromFile(filePath);
    if (system) {
      systems.push(system);
    }
  }

  console.log(`[SystemLoader] Loaded ${systems.length} systems from ${dir}`);
  return systems;
}

/**
 * Delete a system file from a custom directory
 */
export async function deleteSystemFromDir(dir: string, systemName: string): Promise<boolean> {
  const { unlink } = await import("fs/promises");
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(dir, `${kebabName}.ts`);
  try {
    await unlink(filePath);
    console.log(`[SystemLoader] Deleted system ${systemName} from ${dir}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get system source from a custom directory
 */
export async function getSystemSourceFromDir(dir: string, systemName: string): Promise<string | null> {
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const filePath = path.join(dir, `${kebabName}.ts`);
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Get the path to a system file (supports both default and custom directories)
 */
export function getSystemFilePath(systemName: string, customDir?: string): string {
  const kebabName = systemName.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const dir = customDir ?? getGeneratedDir();
  return path.join(dir, `${kebabName}.ts`);
}

/**
 * Export the default generated directory path
 */
export function getDefaultSystemsDir(): string {
  return DEFAULT_GENERATED_DIR;
}

export function getConfiguredSystemsDir(): string {
  return getGeneratedDir();
}
