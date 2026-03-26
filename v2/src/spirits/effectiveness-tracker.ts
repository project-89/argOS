/**
 * Effectiveness Tracker
 *
 * Runtime effectiveness measurement for dynamic ECS systems.
 * Pure deterministic logic — no LLM calls.
 *
 * Provides:
 * - Component state sampling (before/after diffs around system runs)
 * - Per-system effectiveness scoring (rolling window)
 * - Cascade detection (correlated event→state-change chains)
 * - Conflict detection (overlapping writes to same component property)
 * - Composite health scoring (static + runtime)
 * - Rollback gating (regression detection + restore)
 */

import { query } from "bitecs";
import { Agent, Mind, Needs, Health, Attention, WorkingMemory } from "../ecs/components";
import type { World } from "../ecs/world";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";

// =============================================================================
// COMPONENT SAMPLING
// =============================================================================

/** A single property read from one entity */
export interface ComponentSample {
  component: string;
  property: string;
  eid: number;
  value: number;
}

/** Snapshot of sampled component state */
export type ComponentSnapshot = ComponentSample[];

/** A detected state change */
export interface StateChange {
  component: string;
  property: string;
  eid: number;
  before: number;
  after: number;
}

// Properties we sample — these are the numeric properties most likely to be
// written by dynamic systems. ~10 properties × sampleSize entities = ~80 reads.
const SAMPLED_PROPERTIES: Array<{ component: string; property: string; store: any }> = [
  { component: "Mind", property: "arousal", store: Mind.arousal },
  { component: "Needs", property: "hunger", store: Needs.hunger },
  { component: "Needs", property: "energy", store: Needs.energy },
  { component: "Needs", property: "social", store: Needs.social },
  { component: "Needs", property: "comfort", store: Needs.comfort },
  { component: "Health", property: "current", store: Health.current },
  { component: "Attention", property: "intensity", store: Attention.intensity },
  { component: "WorkingMemory", property: "currentLoad", store: WorkingMemory.currentLoad },
];

/**
 * Take a lightweight snapshot of numeric component state for a sample of agents.
 * Cost: ~160 array reads per call (~0.01ms).
 */
export function sampleComponentState(world: World, sampleSize: number = 8): ComponentSnapshot {
  const agents = Array.from(query(world, [Agent]));
  // Pick up to sampleSize agents (deterministic: first N)
  const sampled = agents.slice(0, sampleSize);
  const snapshot: ComponentSnapshot = [];

  for (const eid of sampled) {
    for (const prop of SAMPLED_PROPERTIES) {
      const value = prop.store[eid];
      if (value !== undefined && typeof value === "number") {
        snapshot.push({
          component: prop.component,
          property: prop.property,
          eid,
          value,
        });
      }
    }
  }

  return snapshot;
}

/**
 * Diff two snapshots and return state changes.
 */
export function diffComponentState(before: ComponentSnapshot, after: ComponentSnapshot): StateChange[] {
  const changes: StateChange[] = [];
  const afterMap = new Map<string, number>();

  for (const s of after) {
    afterMap.set(`${s.component}.${s.property}.${s.eid}`, s.value);
  }

  for (const b of before) {
    const key = `${b.component}.${b.property}.${b.eid}`;
    const afterValue = afterMap.get(key);
    if (afterValue !== undefined && afterValue !== b.value) {
      changes.push({
        component: b.component,
        property: b.property,
        eid: b.eid,
        before: b.value,
        after: afterValue,
      });
    }
  }

  return changes;
}

// =============================================================================
// PER-SYSTEM EFFECTIVENESS WINDOW
// =============================================================================

export interface EffectivenessWindow {
  systemName: string;
  runs: number;
  totalStateChanges: number;
  uniqueComponentsWritten: Set<string>;
  eventsEmitted: number;
  cascadesTriggered: number;
  /** Rolling score (0-100) */
  score: number;
}

const effectivenessWindows = new Map<string, EffectivenessWindow>();
const WINDOW_SIZE = 10;

function getOrCreateWindow(systemName: string): EffectivenessWindow {
  let w = effectivenessWindows.get(systemName);
  if (!w) {
    w = {
      systemName,
      runs: 0,
      totalStateChanges: 0,
      uniqueComponentsWritten: new Set(),
      eventsEmitted: 0,
      cascadesTriggered: 0,
      score: 0,
    };
    effectivenessWindows.set(systemName, w);
  }
  return w;
}

/**
 * Record one system execution's effectiveness data.
 */
export function recordEffectivenessRun(
  systemName: string,
  changes: StateChange[],
  emitCount: number
): void {
  const w = getOrCreateWindow(systemName);
  w.runs++;
  w.totalStateChanges += changes.length;
  w.eventsEmitted += emitCount;

  for (const c of changes) {
    w.uniqueComponentsWritten.add(`${c.component}.${c.property}`);
  }

  // Decay old data when window is full (exponential moving average approach)
  if (w.runs > WINDOW_SIZE) {
    const decay = (WINDOW_SIZE - 1) / WINDOW_SIZE;
    w.totalStateChanges = Math.round(w.totalStateChanges * decay);
    w.eventsEmitted = Math.round(w.eventsEmitted * decay);
    w.runs = WINDOW_SIZE;
  }

  // Recompute score
  const changesPerRun = w.runs > 0 ? w.totalStateChanges / w.runs : 0;
  const uniqueComponents = w.uniqueComponentsWritten.size;
  const emitsPerRun = w.runs > 0 ? w.eventsEmitted / w.runs : 0;
  const cascadeScore = w.cascadesTriggered;

  w.score = Math.min(100,
    Math.min(40, changesPerRun * 10) +
    Math.min(20, uniqueComponents * 5) +
    Math.min(15, emitsPerRun * 3) +
    Math.min(25, cascadeScore * 12)
  );
}

/**
 * Get the average effectiveness score for a system.
 */
export function getAverageEffectiveness(systemName: string): number {
  const w = effectivenessWindows.get(systemName);
  return w?.score ?? 0;
}

// =============================================================================
// EVENT SOURCE TRACKING (for cascade detection)
// =============================================================================

interface SystemEventRecord {
  systemName: string;
  eventType: string;
  tick: number;
}

const systemEventLog: SystemEventRecord[] = [];
const MAX_EVENT_LOG = 500;

/**
 * Record that a system emitted an event at a given tick.
 */
export function recordSystemEvent(systemName: string, eventType: string, tick: number): void {
  systemEventLog.push({ systemName, eventType, tick });
  if (systemEventLog.length > MAX_EVENT_LOG) {
    systemEventLog.splice(0, systemEventLog.length - MAX_EVENT_LOG);
  }
}

// =============================================================================
// TICK WRITE LOG (for conflict detection)
// =============================================================================

interface TickWrite {
  systemName: string;
  tick: number;
  componentProperty: string;
  entityIds: Set<number>;
}

let currentTickWrites: TickWrite[] = [];

/**
 * Record which component properties a system wrote to during this tick.
 */
export function recordTickWrite(systemName: string, tick: number, changes: StateChange[]): void {
  if (changes.length === 0) return;

  // Group by component.property
  const grouped = new Map<string, Set<number>>();
  for (const c of changes) {
    const key = `${c.component}.${c.property}`;
    let set = grouped.get(key);
    if (!set) {
      set = new Set();
      grouped.set(key, set);
    }
    set.add(c.eid);
  }

  for (const [componentProperty, entityIds] of grouped) {
    currentTickWrites.push({ systemName, tick, componentProperty, entityIds });
  }
}

/**
 * Clear the current tick's write log.
 */
export function clearTickWriteLog(): void {
  currentTickWrites = [];
}

// =============================================================================
// CASCADE DETECTION
// =============================================================================

export interface CascadeEdge {
  from: string;
  to: string;
  correlations: number;
}

export interface CascadeResult {
  edges: CascadeEdge[];
  chains: string[][];
}

// Historical correlation data
const correlationLog: Array<{ emitter: string; responder: string; tick: number }> = [];
const MAX_CORRELATION_LOG = 200;

// Track which systems made state changes at which ticks
const systemStateChangeTicks = new Map<string, Set<number>>();

/**
 * Record that a system made state changes at a tick (called from recordEffectivenessRun context).
 */
function recordStateChangeTick(systemName: string, tick: number): void {
  let ticks = systemStateChangeTicks.get(systemName);
  if (!ticks) {
    ticks = new Set();
    systemStateChangeTicks.set(systemName, ticks);
  }
  ticks.add(tick);
  // Keep only recent ticks
  if (ticks.size > 100) {
    const arr = Array.from(ticks).sort((a, b) => a - b);
    const toKeep = arr.slice(-50);
    ticks.clear();
    for (const t of toKeep) ticks.add(t);
  }
}

/**
 * Detect cascade chains between systems.
 * Should be called once per Artificer cycle (~45s), not per tick.
 */
export function detectCascades(): CascadeResult {
  // For each event emitted by system A at tick T,
  // check if system B made state changes at tick T or T+1
  const edgeMap = new Map<string, number>();

  for (const evt of systemEventLog) {
    for (const [responder, ticks] of systemStateChangeTicks) {
      if (responder === evt.systemName) continue;
      if (ticks.has(evt.tick) || ticks.has(evt.tick + 1)) {
        const key = `${evt.systemName}->${responder}`;
        edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
      }
    }
  }

  // Only keep edges with 3+ correlations
  const edges: CascadeEdge[] = [];
  for (const [key, count] of edgeMap) {
    if (count >= 3) {
      const [from, to] = key.split("->") as [string, string];
      edges.push({ from, to, correlations: count });
    }
  }

  // Build chains via simple DFS
  const chains: string[][] = [];
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const existing = adjacency.get(e.from) || [];
    existing.push(e.to);
    adjacency.set(e.from, existing);
  }

  // Find chain roots (nodes with no incoming edges)
  const allTargets = new Set(edges.map(e => e.to));
  const roots = Array.from(adjacency.keys()).filter(k => !allTargets.has(k));

  for (const root of roots) {
    const chain = [root];
    let current = root;
    const visited = new Set<string>([root]);
    while (true) {
      const next = adjacency.get(current);
      if (!next || next.length === 0) break;
      const nextNode = next[0]; // follow first edge
      if (visited.has(nextNode)) break; // cycle
      visited.add(nextNode);
      chain.push(nextNode);
      current = nextNode;
    }
    if (chain.length >= 2) {
      chains.push(chain);
    }
  }

  // Update cascade counts in effectiveness windows
  for (const edge of edges) {
    const w = effectivenessWindows.get(edge.from);
    if (w) w.cascadesTriggered = Math.max(w.cascadesTriggered, 1);
    const w2 = effectivenessWindows.get(edge.to);
    if (w2) w2.cascadesTriggered = Math.max(w2.cascadesTriggered, 1);
  }

  return { edges, chains };
}

/**
 * Get cascade value for a system (0-100).
 * Systems participating in cascades have higher value.
 */
export function getCascadeScore(systemName: string): number {
  const w = effectivenessWindows.get(systemName);
  return w ? Math.min(100, w.cascadesTriggered * 25) : 0;
}

// =============================================================================
// CONFLICT DETECTION
// =============================================================================

export interface SystemConflict {
  systems: [string, string];
  componentProperty: string;
  severity: "high" | "low";
  entityOverlap: number;
  tick: number;
}

/**
 * Detect systems that wrote to the same component property in the same tick.
 */
export function detectConflicts(tick: number): SystemConflict[] {
  const conflicts: SystemConflict[] = [];

  // Group writes by component property
  const byProperty = new Map<string, TickWrite[]>();
  for (const tw of currentTickWrites) {
    const existing = byProperty.get(tw.componentProperty) || [];
    existing.push(tw);
    byProperty.set(tw.componentProperty, existing);
  }

  for (const [prop, writes] of byProperty) {
    if (writes.length < 2) continue;

    // Check all pairs
    for (let i = 0; i < writes.length; i++) {
      for (let j = i + 1; j < writes.length; j++) {
        const a = writes[i];
        const b = writes[j];

        // Count overlapping entities
        let overlap = 0;
        for (const eid of a.entityIds) {
          if (b.entityIds.has(eid)) overlap++;
        }

        conflicts.push({
          systems: [a.systemName, b.systemName],
          componentProperty: prop,
          severity: overlap > 0 ? "high" : "low",
          entityOverlap: overlap,
          tick,
        });
      }
    }
  }

  return conflicts;
}

// =============================================================================
// COMPOSITE HEALTH SCORING
// =============================================================================

export interface SystemHealthScore {
  systemName: string;
  staticComplexity: number;
  effectiveness: number;
  cascadeValue: number;
  errorRate: number;
  compositeHealth: number;
  improvementPriority: number;
}

/**
 * Compute composite health score combining static analysis + runtime data.
 */
export function computeSystemHealth(
  systemName: string,
  systemRegistry: SystemRegistry
): SystemHealthScore {
  // Get static complexity score (if the Artificer has analyzed it)
  // We import lazily to avoid circular deps
  let staticComplexity = 50; // default
  try {
    const { analyzeSystemComplexity } = require("./artificer-spirit");
    const analysis = analyzeSystemComplexity(systemRegistry, systemName);
    if (analysis) staticComplexity = analysis.score;
  } catch {}

  const effectiveness = getAverageEffectiveness(systemName);
  const cascadeValue = getCascadeScore(systemName);

  // Error rate from registry
  const errorCount = systemRegistry.errorCounts.get(systemName) || 0;
  const errorRate = Math.max(0, 100 - errorCount * 10); // 100 = no errors

  const compositeHealth =
    staticComplexity * 0.25 +
    effectiveness * 0.35 +
    cascadeValue * 0.15 +
    errorRate * 0.25;

  let improvementPriority =
    (100 - effectiveness) * 0.5 +
    staticComplexity * 0.2 +
    (100 - errorRate) * 0.3;

  // Protect working cascades — reduce priority by 70%
  if (cascadeValue > 30) {
    improvementPriority *= 0.3;
  }

  return {
    systemName,
    staticComplexity,
    effectiveness,
    cascadeValue,
    errorRate,
    compositeHealth: Math.round(compositeHealth),
    improvementPriority: Math.round(improvementPriority),
  };
}

// =============================================================================
// ROLLBACK GATING
// =============================================================================

/**
 * Returns the current effectiveness score for a system.
 * Used to decide whether to allow modification.
 */
export function shouldAllowModification(systemName: string): number {
  return getAverageEffectiveness(systemName);
}

/**
 * After 5+ post-modification runs, check if effectiveness dropped >15 points.
 */
export function checkForRegression(
  systemName: string,
  systemRegistry: SystemRegistry
): boolean {
  const system = systemRegistry.systems.get(systemName);
  if (!system) return false;

  const def = system as SystemDefinition & {
    preModificationScore?: number;
    modificationTimestamp?: number;
  };

  if (def.preModificationScore === undefined || def.modificationTimestamp === undefined) {
    return false;
  }

  const w = effectivenessWindows.get(systemName);
  if (!w || w.runs < 5) return false; // Not enough data yet

  const scoreDrop = def.preModificationScore - w.score;
  return scoreDrop > 15;
}

/**
 * Roll back a system to its previous code/function.
 */
export function rollbackSystem(
  systemName: string,
  systemRegistry: SystemRegistry
): boolean {
  const system = systemRegistry.systems.get(systemName) as SystemDefinition & {
    previousCode?: string;
    previousCompiledFn?: Function;
    preModificationScore?: number;
    modificationTimestamp?: number;
  };

  if (!system) return false;
  if (!system.previousCode || !system.previousCompiledFn) return false;

  console.log(`[EffectivenessTracker] Rolling back ${systemName} to previous version`);

  system.code = system.previousCode;
  system.compiledFn = system.previousCompiledFn as any;
  system.previousCode = undefined;
  system.previousCompiledFn = undefined;
  system.preModificationScore = undefined;
  system.modificationTimestamp = undefined;

  return true;
}

// =============================================================================
// POST-TICK ANALYSIS
// =============================================================================

/**
 * Run post-tick analysis: conflict detection + cleanup.
 * Call this after all systems have run in a tick.
 */
export function runPostTickAnalysis(tick: number): SystemConflict[] {
  const conflicts = detectConflicts(tick);

  // Report high-severity conflicts to observation aggregator
  for (const c of conflicts.filter(c => c.severity === "high")) {
    try {
      const { reportGap } = require("./observation-aggregator");
      reportGap(
        "EffectivenessTracker",
        "performance_issue",
        `System conflict: ${c.systems.join(" vs ")} on ${c.componentProperty}`,
        `${c.entityOverlap} entities affected at tick ${c.tick}`,
        "high"
      );
    } catch {}
  }

  clearTickWriteLog();
  return conflicts;
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Get a human-readable effectiveness report for a system.
 */
export function getEffectivenessReport(systemName: string): string {
  const w = effectivenessWindows.get(systemName);
  if (!w) return `No runtime data for ${systemName}`;

  const changesPerRun = w.runs > 0 ? (w.totalStateChanges / w.runs).toFixed(1) : "0";
  const emitsPerRun = w.runs > 0 ? (w.eventsEmitted / w.runs).toFixed(1) : "0";

  return [
    `Effectiveness score: ${w.score}/100`,
    `Runs sampled: ${w.runs}`,
    `Avg state changes/run: ${changesPerRun}`,
    `Unique components written: ${Array.from(w.uniqueComponentsWritten).join(", ") || "none"}`,
    `Avg events/run: ${emitsPerRun}`,
    `Cascade participation: ${w.cascadesTriggered > 0 ? "yes" : "no"}`,
  ].join("\n");
}

/**
 * Get a summary of all tracked systems' effectiveness.
 */
export function getEffectivenessSummary(): string {
  const entries = Array.from(effectivenessWindows.values())
    .sort((a, b) => b.score - a.score);

  if (entries.length === 0) return "No effectiveness data collected yet";

  return entries
    .map(w => `${w.systemName}: eff=${w.score} cascade=${w.cascadesTriggered}`)
    .join(", ");
}
