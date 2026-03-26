import type { World } from "./world";
import { query, hasComponent, getRelationTargets, addEntity, addComponent, removeEntity, entityExists } from "bitecs";
import { AllComponents, Name, Agent, Mind, StimulusSource, Stimulus, WorldMap, GridPosition, Goal, Memory, Belief, Thought, Impression } from "./components";
import { AllRelations, HasGoal, HasMemory, HasBelief, HasThought, HasImpression } from "./relations";
import { createAIContext, type AIContext } from "../ai/ai-context";
import { moveEntity, isWalkable, getTile } from "../world/ascii-world";
import {
  sampleComponentState,
  diffComponentState,
  recordEffectivenessRun,
  recordSystemEvent,
  recordTickWrite,
  runPostTickAnalysis,
} from "../spirits/effectiveness-tracker";
import { getDirectContainer, getRoomForEntity, listDirectContents } from "./location";
import { getMergedComponents, getComponent, registryCreateComponent, attachToEntity } from "./component-registry";
import type { ComponentDefinition } from "./dynamic-components";

/**
 * Safe wrapper for getRelationTargets that filters out non-existent entities.
 * BitECS can return stale entity IDs after entities are removed, causing
 * "entity does not exist" errors when accessing their components.
 */
export function safeGetRelationTargets(world: World, eid: number, relation: any): number[] {
  if (!entityExists(world, eid)) {
    return [];
  }
  try {
    const targets = getRelationTargets(world, eid, relation);
    // Filter out any targets that no longer exist
    return targets.filter(targetEid => entityExists(world, targetEid));
  } catch (e) {
    // If getRelationTargets itself fails, return empty array
    return [];
  }
}

/**
 * Check if an entity exists before accessing its components
 */
export function safeEntityAccess<T>(world: World, eid: number, accessor: () => T, fallback: T): T {
  if (!entityExists(world, eid)) {
    return fallback;
  }
  try {
    return accessor();
  } catch (e) {
    return fallback;
  }
}

export interface SystemDefinition {
  name: string;
  description: string;
  pseudocode: string;
  frequency: number;
  active: boolean;
  lastRun: number;
  code?: string;
  compiledFn?: (world: World, context: SystemContext) => void | Promise<void>;
  async?: boolean;
  running?: boolean;
  // Rollback fields for effectiveness-based regression detection
  previousCode?: string;
  previousCompiledFn?: Function;
  modificationTimestamp?: number;
  preModificationScore?: number;
  // Runtime health tracking (initialised to zero / null by registerSystem)
  consecutiveErrors?: number;
  totalErrors?: number;
  lastError?: string | null;
  lastErrorTimestamp?: number | null;
  disabledReason?: string | null;
  disabledAt?: number | null;
}

export interface SystemTelemetry {
  systemName: string;
  runs: number;
  totalDurationMs: number;
  lastDurationMs: number;
  totalEmits: number;
  totalLogs: number;
  lastEmitCount: number;
  lastLogCount: number;
  lastTick: number;
  lastTimestamp: number;
}

const systemTelemetry = new Map<string, SystemTelemetry>();

export function getSystemTelemetrySnapshot(): SystemTelemetry[] {
  return Array.from(systemTelemetry.values()).map((t) => ({ ...t }));
}

function getOrCreateTelemetry(systemName: string): SystemTelemetry {
  const existing = systemTelemetry.get(systemName);
  if (existing) return existing;
  const fresh: SystemTelemetry = {
    systemName,
    runs: 0,
    totalDurationMs: 0,
    lastDurationMs: 0,
    totalEmits: 0,
    totalLogs: 0,
    lastEmitCount: 0,
    lastLogCount: 0,
    lastTick: 0,
    lastTimestamp: 0,
  };
  systemTelemetry.set(systemName, fresh);
  return fresh;
}

export interface GridContext {
  moveEntity: (world: World, mapEid: number, eid: number, dx: number, dy: number) => boolean;
  isWalkable: (world: World, mapEid: number, x: number, y: number) => boolean;
  getTile: (world: World, mapEid: number, x: number, y: number) => string;
  getMapByName: (world: World, name: string) => number | undefined;
}

export interface GoalData {
  description: string;
  // Optional typed goal contract fields (backward-compatible)
  kind?: string;
  paramsJson?: string;
  successJson?: string;
  signature?: string;
  priority?: number;
  status?: string;
  progress?: number;
  deadline?: number;
  createdAt?: number;
}

export interface MemoryData {
  type: "episodic" | "semantic" | "procedural";
  content: string;
  emotionalValence?: number;
  importance?: number;
}

export interface BeliefData {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  source?: string;
}

export interface ThoughtData {
  content: string;
  type?: string;
  salience?: number;
}

export interface ImpressionData {
  targetName: string;
  trait: string;
  valence: number;
  confidence?: number;
  basis?: string;
}

export interface CognitiveContext {
  createGoal: (world: World, agentEid: number, data: GoalData) => number;
  createMemory: (world: World, agentEid: number, data: MemoryData) => number;
  createBelief: (world: World, agentEid: number, data: BeliefData) => number;
  createThought: (world: World, agentEid: number, data: ThoughtData) => number;
  createImpression: (world: World, agentEid: number, data: ImpressionData) => number;
  getGoals: (world: World, agentEid: number) => Array<{ eid: number; data: GoalData }>;
  getMemories: (world: World, agentEid: number) => Array<{ eid: number; data: MemoryData }>;
  getBeliefs: (world: World, agentEid: number) => Array<{ eid: number; data: BeliefData }>;
  updateGoal: (eid: number, updates: Partial<GoalData>) => void;
  completeGoal: (world: World, eid: number) => void;
  removeGoal: (world: World, eid: number) => void;
}

export interface LocationContext {
  getDirectContainer: typeof getDirectContainer;
  getRoomForEntity: typeof getRoomForEntity;
  listDirectContents: typeof listDirectContents;
}

export interface SystemContext {
  tick: number;
  delta: number;
  elapsed: number;
  emit: (type: string, data: any) => void;
  log: (message: string) => void;
  query: typeof query;
  hasComponent: typeof hasComponent;
  getRelationTargets: typeof getRelationTargets;
  addEntity: typeof addEntity;
  addComponent: typeof addComponent;
  removeEntity: typeof removeEntity;
  components: Record<string, any>;
  relations: typeof AllRelations;
  ai: AIContext;
  grid: GridContext;
  location: LocationContext;
  cognitive: CognitiveContext;
  // Unified component registry accessors
  getComponent: (name: string) => any;
  createComponent: (def: ComponentDefinition) => any;
  attachComponent: (eid: number, name: string, values?: Record<string, any>) => boolean;
}

export interface SystemError {
  systemName: string;
  error: string;
  timestamp: number;
  errorCount: number;
  lastCode?: string;
  context?: string;
}

export interface SystemRegistry {
  systems: Map<string, SystemDefinition>;
  events: Array<{ type: string; data: any; timestamp: number }>;
  logs: string[];
  errors: SystemError[];
  errorCounts: Map<string, number>;  // Track error frequency per system
}

export function createSystemRegistry(): SystemRegistry {
  return {
    systems: new Map(),
    events: [],
    logs: [],
    errors: [],
    errorCounts: new Map(),
  };
}

/** Number of consecutive errors before a registry system is auto-disabled. */
const MAX_REGISTRY_CONSECUTIVE_ERRORS = 3;

/**
 * Report a system error for GodAI to handle.
 *
 * Updates per-system health fields (consecutiveErrors, totalErrors, lastError, etc.)
 * and auto-disables a system after MAX_REGISTRY_CONSECUTIVE_ERRORS consecutive failures.
 */
export function reportSystemError(
  registry: SystemRegistry,
  systemName: string,
  error: string,
  context?: string
): void {
  const currentCount = (registry.errorCounts.get(systemName) || 0) + 1;
  registry.errorCounts.set(systemName, currentCount);

  const system = registry.systems.get(systemName);
  const now = Date.now();

  // Update per-system health fields when the SystemDefinition exists
  if (system) {
    system.consecutiveErrors = (system.consecutiveErrors ?? 0) + 1;
    system.totalErrors = (system.totalErrors ?? 0) + 1;
    system.lastError = error;
    system.lastErrorTimestamp = now;
  }

  const errorReport: SystemError = {
    systemName,
    error,
    timestamp: now,
    errorCount: currentCount,
    lastCode: system?.code,
    context,
  };

  registry.errors.push(errorReport);

  // Auto-disable systems that fail repeatedly
  if (system && (system.consecutiveErrors ?? 0) >= MAX_REGISTRY_CONSECUTIVE_ERRORS) {
    const reason = `Auto-disabled after ${system.consecutiveErrors} consecutive errors: ${error}`;
    system.active = false;
    system.disabledReason = reason;
    system.disabledAt = now;
    console.warn(`[SystemHealth] Auto-disabled ${systemName}: ${reason}`);

    // Emit a system:auto_disabled event into the registry event stream
    registry.events.push({
      type: "system:auto_disabled",
      data: {
        name: systemName,
        reason,
        consecutiveErrors: system.consecutiveErrors,
        totalErrors: system.totalErrors,
        lastError: error,
        context,
      },
      timestamp: now,
    });
  }

  console.error(`[SystemError] ${systemName} (${currentCount}x): ${error}`);
}

/**
 * Get pending system errors for GodAI to review
 */
export function consumeSystemErrors(registry: SystemRegistry): SystemError[] {
  const errors = [...registry.errors];
  registry.errors = [];
  return errors;
}

/**
 * Clear error count for a system (after it's been fixed)
 */
export function clearSystemErrorCount(registry: SystemRegistry, systemName: string): void {
  registry.errorCounts.set(systemName, 0);
}

// ---------------------------------------------------------------------------
// Health reporting
// ---------------------------------------------------------------------------

export interface SystemHealthReport {
  name: string;
  active: boolean;
  consecutiveErrors: number;
  totalErrors: number;
  lastError: string | null;
  lastErrorTimestamp: number | null;
  disabledReason: string | null;
  disabledAt: number | null;
  totalExecutions: number;
  avgDurationMs: number;
}

function buildHealthReport(system: SystemDefinition): SystemHealthReport {
  const telemetry = systemTelemetry.get(system.name);
  return {
    name: system.name,
    active: system.active,
    consecutiveErrors: system.consecutiveErrors ?? 0,
    totalErrors: system.totalErrors ?? 0,
    lastError: system.lastError ?? null,
    lastErrorTimestamp: system.lastErrorTimestamp ?? null,
    disabledReason: system.disabledReason ?? null,
    disabledAt: system.disabledAt ?? null,
    totalExecutions: telemetry?.runs ?? 0,
    avgDurationMs: telemetry && telemetry.runs > 0 ? telemetry.totalDurationMs / telemetry.runs : 0,
  };
}

/**
 * Get health report for a single system by name.
 */
export function getSystemHealth(registry: SystemRegistry, name: string): SystemHealthReport | undefined {
  const system = registry.systems.get(name);
  if (!system) return undefined;
  return buildHealthReport(system);
}

/**
 * Get health reports for all registered systems.
 */
export function getAllSystemHealth(registry: SystemRegistry): SystemHealthReport[] {
  return Array.from(registry.systems.values()).map(buildHealthReport);
}

/**
 * Get health reports for systems that have exceeded a given consecutive-error threshold.
 * Defaults to threshold of 1 (any system with at least 1 error).
 */
export function getUnhealthySystems(registry: SystemRegistry, errorThreshold: number = 1): SystemHealthReport[] {
  return Array.from(registry.systems.values())
    .filter(s => (s.consecutiveErrors ?? 0) >= errorThreshold || (s.totalErrors ?? 0) >= errorThreshold)
    .map(buildHealthReport);
}

/**
 * Re-enable a previously disabled system and reset its error counters.
 * Returns true if the system was found and re-enabled, false otherwise.
 */
export function reEnableSystem(registry: SystemRegistry, name: string): boolean {
  const system = registry.systems.get(name);
  if (!system) return false;
  system.active = true;
  system.consecutiveErrors = 0;
  system.totalErrors = 0;
  system.lastError = null;
  system.lastErrorTimestamp = null;
  system.disabledReason = null;
  system.disabledAt = null;
  registry.errorCounts.set(name, 0);
  console.log(`[SystemHealth] Re-enabled system: ${name}`);
  return true;
}

export function registerSystem(registry: SystemRegistry, definition: SystemDefinition): void {
  // Ensure health tracking fields are initialised
  if (definition.consecutiveErrors === undefined) definition.consecutiveErrors = 0;
  if (definition.totalErrors === undefined) definition.totalErrors = 0;
  if (definition.lastError === undefined) definition.lastError = null;
  if (definition.lastErrorTimestamp === undefined) definition.lastErrorTimestamp = null;
  if (definition.disabledReason === undefined) definition.disabledReason = null;
  if (definition.disabledAt === undefined) definition.disabledAt = null;
  registry.systems.set(definition.name, definition);
}

export function unregisterSystem(registry: SystemRegistry, name: string): void {
  registry.systems.delete(name);
}

export function getSystem(registry: SystemRegistry, name: string): SystemDefinition | undefined {
  return registry.systems.get(name);
}

export function listSystems(registry: SystemRegistry): SystemDefinition[] {
  return Array.from(registry.systems.values());
}

export function activateSystem(registry: SystemRegistry, name: string): boolean {
  const system = registry.systems.get(name);
  if (system) {
    system.active = true;
    return true;
  }
  return false;
}

export function deactivateSystem(registry: SystemRegistry, name: string): boolean {
  const system = registry.systems.get(name);
  if (system) {
    system.active = false;
    return true;
  }
  return false;
}

const sharedAIContext = createAIContext();

function createGridContext(): GridContext {
  return {
    moveEntity,
    isWalkable,
    getTile,
    getMapByName: (world: World, name: string): number | undefined => {
      const maps = Array.from(query(world, [WorldMap]));
      for (const mapEid of maps) {
        if (WorldMap.name[mapEid] === name || Name.value[mapEid] === name) {
          return mapEid;
        }
      }
      return undefined;
    },
  };
}

const sharedGridContext = createGridContext();

function createCognitiveContext(): CognitiveContext {
  return {
    createGoal: (world: World, agentEid: number, data: GoalData): number => {
      const goalEid = addEntity(world);
      addComponent(world, goalEid, Goal);
      addComponent(world, agentEid, HasGoal(goalEid));
      Goal.description[goalEid] = data.description;
      if (data.kind !== undefined) Goal.kind[goalEid] = data.kind;
      if (data.paramsJson !== undefined) Goal.paramsJson[goalEid] = data.paramsJson;
      if (data.successJson !== undefined) Goal.successJson[goalEid] = data.successJson;
      if (data.signature !== undefined) Goal.signature[goalEid] = data.signature;
      Goal.priority[goalEid] = data.priority ?? 5;
      Goal.status[goalEid] = data.status ?? "active";
      Goal.progress[goalEid] = data.progress ?? 0;
      Goal.deadline[goalEid] = data.deadline ?? 0;
      Goal.createdAt[goalEid] = data.createdAt ?? Date.now();
      return goalEid;
    },
    createMemory: (world: World, agentEid: number, data: MemoryData): number => {
      const memEid = addEntity(world);
      addComponent(world, memEid, Memory);
      addComponent(world, agentEid, HasMemory(memEid));
      Memory.type[memEid] = data.type;
      Memory.content[memEid] = data.content;
      Memory.emotionalValence[memEid] = data.emotionalValence ?? 0;
      Memory.importance[memEid] = data.importance ?? 0.5;
      Memory.timestamp[memEid] = Date.now();
      Memory.lastRecalled[memEid] = Date.now();
      Memory.recallCount[memEid] = 0;
      return memEid;
    },
    createBelief: (world: World, agentEid: number, data: BeliefData): number => {
      const beliefEid = addEntity(world);
      addComponent(world, beliefEid, Belief);
      addComponent(world, agentEid, HasBelief(beliefEid));
      Belief.subject[beliefEid] = data.subject;
      Belief.predicate[beliefEid] = data.predicate;
      Belief.object[beliefEid] = data.object;
      Belief.confidence[beliefEid] = data.confidence ?? 0.5;
      Belief.source[beliefEid] = data.source ?? "observation";
      Belief.timestamp[beliefEid] = Date.now();
      return beliefEid;
    },
    createThought: (world: World, agentEid: number, data: ThoughtData): number => {
      const thoughtEid = addEntity(world);
      addComponent(world, thoughtEid, Thought);
      addComponent(world, agentEid, HasThought(thoughtEid));
      Thought.content[thoughtEid] = data.content;
      Thought.type[thoughtEid] = data.type ?? "reflection";
      Thought.salience[thoughtEid] = data.salience ?? 0.5;
      Thought.timestamp[thoughtEid] = Date.now();
      return thoughtEid;
    },
    createImpression: (world: World, agentEid: number, data: ImpressionData): number => {
      const impEid = addEntity(world);
      addComponent(world, impEid, Impression);
      addComponent(world, agentEid, HasImpression(impEid));
      Impression.targetName[impEid] = data.targetName;
      Impression.trait[impEid] = data.trait;
      Impression.valence[impEid] = data.valence;
      Impression.confidence[impEid] = data.confidence ?? 0.5;
      Impression.basis[impEid] = data.basis ?? "observation";
      return impEid;
    },
    getGoals: (world: World, agentEid: number): Array<{ eid: number; data: GoalData }> => {
      const targets = safeGetRelationTargets(world, agentEid, HasGoal);
      return targets.map(eid => ({
        eid,
        data: {
          description: Goal.description[eid],
          kind: Goal.kind[eid],
          paramsJson: Goal.paramsJson[eid],
          successJson: Goal.successJson[eid],
          signature: Goal.signature[eid],
          priority: Goal.priority[eid],
          status: Goal.status[eid],
          progress: Goal.progress[eid],
          deadline: Goal.deadline[eid],
          createdAt: Goal.createdAt[eid],
        }
      }));
    },
    getMemories: (world: World, agentEid: number): Array<{ eid: number; data: MemoryData }> => {
      const targets = safeGetRelationTargets(world, agentEid, HasMemory);
      return targets.map(eid => ({
        eid,
        data: {
          type: Memory.type[eid] as "episodic" | "semantic" | "procedural",
          content: Memory.content[eid],
          emotionalValence: Memory.emotionalValence[eid],
          importance: Memory.importance[eid],
        }
      }));
    },
    getBeliefs: (world: World, agentEid: number): Array<{ eid: number; data: BeliefData }> => {
      const targets = safeGetRelationTargets(world, agentEid, HasBelief);
      return targets.map(eid => ({
        eid,
        data: {
          subject: Belief.subject[eid],
          predicate: Belief.predicate[eid],
          object: Belief.object[eid],
          confidence: Belief.confidence[eid],
          source: Belief.source[eid],
        }
      }));
    },
    updateGoal: (eid: number, updates: Partial<GoalData>): void => {
      if (updates.description !== undefined) Goal.description[eid] = updates.description;
      if (updates.kind !== undefined) Goal.kind[eid] = updates.kind;
      if (updates.paramsJson !== undefined) Goal.paramsJson[eid] = updates.paramsJson;
      if (updates.successJson !== undefined) Goal.successJson[eid] = updates.successJson;
      if (updates.signature !== undefined) Goal.signature[eid] = updates.signature;
      if (updates.priority !== undefined) Goal.priority[eid] = updates.priority;
      if (updates.status !== undefined) Goal.status[eid] = updates.status;
      if (updates.progress !== undefined) Goal.progress[eid] = updates.progress;
      if (updates.deadline !== undefined) Goal.deadline[eid] = updates.deadline;
      if (updates.createdAt !== undefined) Goal.createdAt[eid] = updates.createdAt;
    },
    completeGoal: (world: World, eid: number): void => {
      Goal.status[eid] = "completed";
      Goal.progress[eid] = 100;
    },
    removeGoal: (world: World, eid: number): void => {
      removeEntity(world, eid);
    },
  };
}

const sharedCognitiveContext = createCognitiveContext();
const sharedLocationContext: LocationContext = {
  getDirectContainer,
  getRoomForEntity,
  listDirectContents,
};

function createSystemContext(world: World, registry: SystemRegistry, tick: number, delta: number): SystemContext {
  return {
    tick,
    delta,
    elapsed: tick * delta,
    emit: (type, data) => {
      registry.events.push({ type, data, timestamp: Date.now() });
    },
    log: (message) => {
      registry.logs.push(`[${tick}] ${message}`);
      console.log(`[System] ${message}`);
    },
    query,
    hasComponent,
    // Use safe wrapper that filters out non-existent entities
    getRelationTargets: ((w: World, eid: number, rel: any) => safeGetRelationTargets(w, eid, rel)) as any,
    addEntity,
    addComponent,
    removeEntity,
    components: getMergedComponents(),
    relations: AllRelations,
    ai: sharedAIContext,
    grid: sharedGridContext,
    location: sharedLocationContext,
    cognitive: sharedCognitiveContext,
    getComponent: (name: string) => getComponent(name),
    createComponent: (def: ComponentDefinition) => registryCreateComponent(def),
    attachComponent: (eid: number, name: string, values?: Record<string, any>) => attachToEntity(world, eid, name, values),
  };
}

export function runSystems(world: World, registry: SystemRegistry, tick: number, delta: number): void {
  const context = createSystemContext(world, registry, tick, delta);
  const now = Date.now();

  for (const system of registry.systems.values()) {
    if (!system.active) continue;
    if (now - system.lastRun < system.frequency) continue;
    if (system.async) continue;

    try {
      if (system.compiledFn) {
        const telemetry = getOrCreateTelemetry(system.name);
        telemetry.lastEmitCount = 0;
        telemetry.lastLogCount = 0;
        telemetry.lastTick = tick;
        telemetry.lastTimestamp = now;

        const ctxForSystem: SystemContext = {
          ...context,
          emit: (type, data) => {
            telemetry.lastEmitCount++;
            telemetry.totalEmits++;
            context.emit(type, { ...data, _sourceSystem: system.name });
            recordSystemEvent(system.name, type, tick);
          },
          log: (message) => {
            telemetry.lastLogCount++;
            telemetry.totalLogs++;
            context.log(`[${system.name}] ${message}`);
          },
        };

        const snapshot = sampleComponentState(world);
        const started = Date.now();
        system.compiledFn(world, ctxForSystem);
        const duration = Date.now() - started;
        const afterSnapshot = sampleComponentState(world);
        const changes = diffComponentState(snapshot, afterSnapshot);
        recordEffectivenessRun(system.name, changes, telemetry.lastEmitCount);
        recordTickWrite(system.name, tick, changes);

        telemetry.runs++;
        telemetry.lastDurationMs = duration;
        telemetry.totalDurationMs += duration;

        system.lastRun = now;
        // Successful execution — reset consecutive error counter
        system.consecutiveErrors = 0;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      reportSystemError(registry, system.name, errorMsg, `tick=${tick}`);
    }
  }
}

export function runAsyncSystems(world: World, registry: SystemRegistry, tick: number, delta: number): void {
  const context = createSystemContext(world, registry, tick, delta);
  const now = Date.now();

  for (const system of registry.systems.values()) {
    if (!system.active) continue;
    if (!system.async) continue;
    if (system.running) continue;
    if (now - system.lastRun < system.frequency) continue;

    if (system.compiledFn) {
      system.running = true;
      system.lastRun = now;

      const telemetry = getOrCreateTelemetry(system.name);
      telemetry.lastEmitCount = 0;
      telemetry.lastLogCount = 0;
      telemetry.lastTick = tick;
      telemetry.lastTimestamp = now;

      const ctxForSystem: SystemContext = {
        ...context,
        emit: (type, data) => {
          telemetry.lastEmitCount++;
          telemetry.totalEmits++;
          context.emit(type, { ...data, _sourceSystem: system.name });
          recordSystemEvent(system.name, type, tick);
        },
        log: (message) => {
          telemetry.lastLogCount++;
          telemetry.totalLogs++;
          context.log(`[${system.name}] ${message}`);
        },
      };

      const snapshot = sampleComponentState(world);
      const started = Date.now();
      Promise.resolve(system.compiledFn(world, ctxForSystem))
        .then(() => {
          const duration = Date.now() - started;
          const afterSnapshot = sampleComponentState(world);
          const changes = diffComponentState(snapshot, afterSnapshot);
          recordEffectivenessRun(system.name, changes, telemetry.lastEmitCount);
          recordTickWrite(system.name, tick, changes);

          telemetry.runs++;
          telemetry.lastDurationMs = duration;
          telemetry.totalDurationMs += duration;
          system.running = false;
          // Successful execution — reset consecutive error counter
          system.consecutiveErrors = 0;
        })
        .catch((error) => {
          const errorMsg = error instanceof Error ? error.message : String(error);
          reportSystemError(registry, system.name, errorMsg, `async, tick=${tick}`);
          system.running = false;
        });
    }
  }
}

export function consumeEvents(registry: SystemRegistry): Array<{ type: string; data: any; timestamp: number }> {
  const events = [...registry.events];
  registry.events = [];
  return events;
}

export function consumeLogs(registry: SystemRegistry): string[] {
  const logs = [...registry.logs];
  registry.logs = [];
  return logs;
}

export function compileSystem(pseudocode: string, definition: SystemDefinition): SystemDefinition {
  const fn = createSystemFunction(pseudocode, definition);
  return {
    ...definition,
    compiledFn: fn,
  };
}

function createSystemFunction(pseudocode: string, definition: SystemDefinition): (world: World, ctx: SystemContext) => void {
  const lines = pseudocode.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  return (world: World, ctx: SystemContext) => {
    for (const line of lines) {
      try {
        interpretLine(line, world, ctx);
      } catch (e) {
        ctx.log(`Error interpreting: ${line} - ${e}`);
      }
    }
  };
}

function interpretLine(line: string, world: World, ctx: SystemContext): void {
  if (line.startsWith('//') || line.startsWith('#')) return;

  if (line.startsWith('LOG ')) {
    ctx.log(line.slice(4));
    return;
  }

  if (line.startsWith('EMIT ')) {
    const match = line.match(/EMIT\s+(\w+)\s*:\s*(.+)/);
    if (match) {
      ctx.emit(match[1], JSON.parse(match[2]));
    }
    return;
  }

  if (line.startsWith('FOR_EACH ')) {
    return;
  }
}

export const BUILTIN_SYSTEMS: Record<string, Omit<SystemDefinition, 'lastRun'>> = {
  StimulusEmission: {
    name: "StimulusEmission",
    description: "Emits stimuli from StimulusSource entities to agents in the same room",
    pseudocode: `
      FOR_EACH entity WITH StimulusSource:
        room = getRoomForEntity(entity)
        IF room AND now - lastEmit > interval:
          FOR_EACH agent WITH Agent:
            IF getRoomForEntity(agent) == room:
              EMIT stimulus: { type, content: template, source: entity.name, target: agent }
          SET lastEmit = now
    `,
    frequency: 1000,
    active: true,
  },

  MindDecay: {
    name: "MindDecay",
    description: "Gradually reduces arousal levels of agents over time",
    pseudocode: `
      FOR_EACH entity WITH Mind:
        IF arousal > 0.3:
          SET arousal = arousal - 0.01
    `,
    frequency: 5000,
    active: true,
  },

  AttentionShift: {
    name: "AttentionShift",
    description: "Agents may shift focus based on stimuli and events",
    pseudocode: `
      FOR_EACH entity WITH Agent, Mind:
        IF focus == "" AND arousal > 0.5:
          QUERY nearby entities
          SET focus = most_salient_entity
    `,
    frequency: 3000,
    active: false,
  },
};

export function createStimulusEmissionSystem(): SystemDefinition {
  return {
    name: "StimulusEmission",
    description: "Emits stimuli from StimulusSource entities to agents in the same room",
    pseudocode: "FOR_EACH StimulusSource: emit to agents in same room",
    frequency: 1000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const sources = Array.from(ctx.query(world, [StimulusSource]));
      const now = Date.now();

      for (const sourceEid of sources) {
        const interval = StimulusSource.interval[sourceEid];
        const lastEmit = StimulusSource.lastEmit[sourceEid];

        if (now - lastEmit < interval) continue;

        const stimulusType = StimulusSource.stimulusType[sourceEid];
        const template = StimulusSource.template[sourceEid];
        const sourceName = Name.value[sourceEid];

        const roomEid = getRoomForEntity(world, sourceEid);
        if (roomEid === undefined) continue;
        const roomName = Name.value[roomEid];

        const agents = Array.from(ctx.query(world, [Agent]));
        for (const agentEid of agents) {
          if (getRoomForEntity(world, agentEid) === roomEid) {
            const agentName = Name.value[agentEid];
            ctx.emit("stimulus", {
              type: stimulusType,
              content: template,
              source: sourceName,
              target: agentName,
              room: roomName,
            });
            ctx.log(`${sourceName} -> ${agentName}: "${template.slice(0, 50)}..."`);
          }
        }

        StimulusSource.lastEmit[sourceEid] = now;
      }
    },
  };
}

export function createMindDecaySystem(): SystemDefinition {
  return {
    name: "MindDecay",
    description: "Gradually normalizes arousal levels over time",
    pseudocode: "FOR_EACH Mind: arousal tends toward 0.5",
    frequency: 5000,
    active: true,
    lastRun: 0,
    compiledFn: (world: World, ctx: SystemContext) => {
      const minds = Array.from(ctx.query(world, [Mind]));

      for (const eid of minds) {
        const current = Mind.arousal[eid];
        const target = 0.5;
        const decay = 0.02;

        if (current > target + decay) {
          Mind.arousal[eid] = current - decay;
        } else if (current < target - decay) {
          Mind.arousal[eid] = current + decay;
        }
      }
    },
  };
}
