/**
 * System Watcher Spirit
 *
 * A spirit type that observes specific systems and reports on their behavior.
 * System watchers can:
 * - Monitor system execution frequency and performance
 * - Detect anomalies in system behavior
 * - Track component changes made by systems
 * - Report issues and opportunities to superiors
 *
 * Example uses:
 * - WeatherWatcher monitoring a WeatherSystem
 * - EconomyWatcher tracking market dynamics
 * - CombatWatcher observing combat system behavior
 */

import { generateText } from "ai";
import type { World } from "../ecs/world";
import { spiritModel } from "../llm/config";
import type { SystemRegistry } from "../ecs/dynamic-systems";
import type { SpiritRegistry } from "./spirit-registry";
import { reportToSuperior, sendMessage } from "./spirit-registry";
import {
  type DynamicSpiritState,
  type WatchConfig,
  logSpiritExecution,
} from "./spirit-factory";
import { recordEvent, getRecentEvents } from "./consistency-spirit";

// =============================================================================
// SYSTEM OBSERVATION TYPES
// =============================================================================

export interface SystemObservation {
  systemName: string;
  timestamp: number;
  executionCount: number;
  lastExecutionTime?: number;
  averageExecutionTime?: number;
  entitiesProcessed?: number;
  componentsModified?: string[];
  anomalies: SystemAnomaly[];
  patterns: SystemPattern[];
}

export interface SystemAnomaly {
  type: "performance" | "frequency" | "error" | "stagnation" | "overload";
  severity: "low" | "medium" | "high";
  description: string;
  data?: any;
}

export interface SystemPattern {
  type: "cyclic" | "trending" | "emergent" | "declining";
  description: string;
  confidence: number;  // 0-1
  data?: any;
}

export interface WatcherReport {
  watcherName: string;
  timestamp: number;
  systemObservations: SystemObservation[];
  overallHealth: "healthy" | "warning" | "critical";
  recommendations: string[];
  requiresIntervention: boolean;
}

// =============================================================================
// SYSTEM METRICS TRACKING
// =============================================================================

interface SystemMetrics {
  systemName: string;
  executionCount: number;
  executionTimes: number[];  // Last N execution times in ms
  lastExecution: number;
  entitiesProcessedHistory: number[];
  errors: { timestamp: number; message: string }[];
}

const systemMetrics = new Map<string, SystemMetrics>();

/**
 * Record a system execution (call this from system runner)
 */
export function recordSystemExecution(
  systemName: string,
  executionTimeMs: number,
  entitiesProcessed: number
): void {
  let metrics = systemMetrics.get(systemName);
  if (!metrics) {
    metrics = {
      systemName,
      executionCount: 0,
      executionTimes: [],
      lastExecution: 0,
      entitiesProcessedHistory: [],
      errors: [],
    };
    systemMetrics.set(systemName, metrics);
  }

  metrics.executionCount++;
  metrics.lastExecution = Date.now();
  metrics.executionTimes.push(executionTimeMs);
  metrics.entitiesProcessedHistory.push(entitiesProcessed);

  // Keep only last 100 measurements
  if (metrics.executionTimes.length > 100) {
    metrics.executionTimes.shift();
    metrics.entitiesProcessedHistory.shift();
  }
}

/**
 * Record a system error
 */
export function recordSystemError(systemName: string, message: string): void {
  let metrics = systemMetrics.get(systemName);
  if (!metrics) {
    metrics = {
      systemName,
      executionCount: 0,
      executionTimes: [],
      lastExecution: 0,
      entitiesProcessedHistory: [],
      errors: [],
    };
    systemMetrics.set(systemName, metrics);
  }

  metrics.errors.push({ timestamp: Date.now(), message });

  // Keep only last 50 errors
  if (metrics.errors.length > 50) {
    metrics.errors.shift();
  }
}

/**
 * Get metrics for a system
 */
export function getSystemMetrics(systemName: string): SystemMetrics | undefined {
  return systemMetrics.get(systemName);
}

/**
 * Get all tracked systems
 */
export function getAllTrackedSystems(): string[] {
  return Array.from(systemMetrics.keys());
}

// =============================================================================
// SYSTEM WATCHER OBSERVATION
// =============================================================================

/**
 * Observe systems according to watch configuration
 */
export function observeSystems(
  world: World,
  systemRegistry: SystemRegistry,
  watchConfig: WatchConfig
): SystemObservation[] {
  const observations: SystemObservation[] = [];
  const targetSystems = watchConfig.targetSystems || getAllTrackedSystems();

  for (const systemName of targetSystems) {
    const metrics = systemMetrics.get(systemName);
    const observation = createSystemObservation(systemName, metrics, watchConfig);
    observations.push(observation);
  }

  return observations;
}

function createSystemObservation(
  systemName: string,
  metrics: SystemMetrics | undefined,
  watchConfig: WatchConfig
): SystemObservation {
  const observation: SystemObservation = {
    systemName,
    timestamp: Date.now(),
    executionCount: metrics?.executionCount || 0,
    lastExecutionTime: metrics?.lastExecution,
    averageExecutionTime: metrics?.executionTimes.length
      ? metrics.executionTimes.reduce((a, b) => a + b, 0) / metrics.executionTimes.length
      : undefined,
    entitiesProcessed: metrics?.entitiesProcessedHistory.length
      ? metrics.entitiesProcessedHistory[metrics.entitiesProcessedHistory.length - 1]
      : undefined,
    anomalies: [],
    patterns: [],
  };

  // Detect anomalies
  if (metrics) {
    observation.anomalies = detectAnomalies(metrics, watchConfig);
    observation.patterns = detectPatterns(metrics);
  } else {
    observation.anomalies.push({
      type: "stagnation",
      severity: "medium",
      description: `System "${systemName}" has no execution metrics (never run or not tracked)`,
    });
  }

  return observation;
}

function detectAnomalies(metrics: SystemMetrics, watchConfig: WatchConfig): SystemAnomaly[] {
  const anomalies: SystemAnomaly[] = [];
  const now = Date.now();

  // Check for stagnation (no execution in a while)
  const timeSinceExecution = now - metrics.lastExecution;
  if (timeSinceExecution > 60000) {  // More than 1 minute
    anomalies.push({
      type: "stagnation",
      severity: timeSinceExecution > 300000 ? "high" : "medium",
      description: `System "${metrics.systemName}" hasn't run in ${Math.round(timeSinceExecution / 1000)}s`,
      data: { timeSinceExecution },
    });
  }

  // Check for performance issues
  if (metrics.executionTimes.length >= 5) {
    const avgTime = metrics.executionTimes.reduce((a, b) => a + b, 0) / metrics.executionTimes.length;
    const recentAvg = metrics.executionTimes.slice(-5).reduce((a, b) => a + b, 0) / 5;

    if (recentAvg > avgTime * 2) {
      anomalies.push({
        type: "performance",
        severity: recentAvg > avgTime * 5 ? "high" : "medium",
        description: `System "${metrics.systemName}" performance degraded (${Math.round(recentAvg)}ms vs ${Math.round(avgTime)}ms avg)`,
        data: { recentAvg, avgTime },
      });
    }
  }

  // Check for errors
  const recentErrors = metrics.errors.filter(e => now - e.timestamp < 60000);
  if (recentErrors.length > 0) {
    anomalies.push({
      type: "error",
      severity: recentErrors.length > 5 ? "high" : recentErrors.length > 1 ? "medium" : "low",
      description: `System "${metrics.systemName}" has ${recentErrors.length} recent errors`,
      data: { errors: recentErrors },
    });
  }

  // Check for overload (processing too many entities)
  if (metrics.entitiesProcessedHistory.length >= 5) {
    const recentProcessed = metrics.entitiesProcessedHistory.slice(-5);
    const avgProcessed = recentProcessed.reduce((a, b) => a + b, 0) / 5;

    if (avgProcessed > 1000) {
      anomalies.push({
        type: "overload",
        severity: avgProcessed > 5000 ? "high" : "medium",
        description: `System "${metrics.systemName}" processing many entities (avg ${Math.round(avgProcessed)})`,
        data: { avgProcessed },
      });
    }
  }

  return anomalies;
}

function detectPatterns(metrics: SystemMetrics): SystemPattern[] {
  const patterns: SystemPattern[] = [];

  if (metrics.entitiesProcessedHistory.length < 10) {
    return patterns;
  }

  const history = metrics.entitiesProcessedHistory;
  const firstHalf = history.slice(0, Math.floor(history.length / 2));
  const secondHalf = history.slice(Math.floor(history.length / 2));

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  // Trending up or down
  if (secondAvg > firstAvg * 1.5) {
    patterns.push({
      type: "trending",
      description: `Entity count trending UP (${Math.round(firstAvg)} → ${Math.round(secondAvg)})`,
      confidence: 0.7,
      data: { firstAvg, secondAvg, direction: "up" },
    });
  } else if (secondAvg < firstAvg * 0.5) {
    patterns.push({
      type: "declining",
      description: `Entity count declining (${Math.round(firstAvg)} → ${Math.round(secondAvg)})`,
      confidence: 0.7,
      data: { firstAvg, secondAvg, direction: "down" },
    });
  }

  return patterns;
}

// =============================================================================
// WATCHER COGNITION
// =============================================================================

/**
 * Run watcher cognition cycle - observe, analyze, report
 */
export async function runWatcherCognition(
  world: World,
  systemRegistry: SystemRegistry,
  spiritRegistry: SpiritRegistry,
  watcher: DynamicSpiritState
): Promise<WatcherReport | null> {
  if (!watcher.watchConfig) {
    console.error(`[SystemWatcher] Watcher ${watcher.definition.name} has no watch config`);
    return null;
  }

  // 1. OBSERVE: Collect system observations
  const observations = observeSystems(world, systemRegistry, watcher.watchConfig);

  // 2. ANALYZE: Determine overall health and recommendations
  const report = await analyzeObservations(watcher, observations);

  // 3. REPORT: Send to superior if needed
  if (report.requiresIntervention || report.overallHealth !== "healthy") {
    sendWatcherReport(spiritRegistry, watcher, report);
  }

  // Record observation event
  recordEvent("watcher_observation", {
    watcher: watcher.definition.name,
    systemsObserved: observations.length,
    health: report.overallHealth,
    anomalies: observations.reduce((sum, o) => sum + o.anomalies.length, 0),
  }, watcher.definition.name);

  logSpiritExecution(
    watcher.eid,
    "observe",
    `${observations.length} systems`,
    "success",
    `Health: ${report.overallHealth}`
  );

  return report;
}

async function analyzeObservations(
  watcher: DynamicSpiritState,
  observations: SystemObservation[]
): Promise<WatcherReport> {
  // Count issues
  const allAnomalies = observations.flatMap(o => o.anomalies);
  const highSeverity = allAnomalies.filter(a => a.severity === "high").length;
  const mediumSeverity = allAnomalies.filter(a => a.severity === "medium").length;

  // Determine health
  let overallHealth: WatcherReport["overallHealth"] = "healthy";
  if (highSeverity > 0) {
    overallHealth = "critical";
  } else if (mediumSeverity > 2 || allAnomalies.length > 5) {
    overallHealth = "warning";
  }

  // Generate recommendations via LLM
  let recommendations: string[] = [];

  if (allAnomalies.length > 0) {
    try {
      const result = await generateText({
        model: spiritModel,
        prompt: `You are ${watcher.definition.name}, a system watcher spirit.

You observed these system anomalies:
${allAnomalies.map(a => `- [${a.severity}] ${a.type}: ${a.description}`).join("\n")}

Based on these observations, provide 1-3 concise recommendations for the simulation.
Format as a JSON array of strings.
Example: ["Add more entities to balance load", "Investigate performance degradation"]`,
        maxTokens: 200,
      });

      try {
        recommendations = JSON.parse(result.text.trim());
      } catch {
        // Extract recommendations from text if JSON fails
        recommendations = [result.text.trim().slice(0, 200)];
      }
    } catch (error) {
      recommendations = allAnomalies
        .filter(a => a.severity === "high")
        .map(a => `Address ${a.type}: ${a.description}`);
    }
  }

  return {
    watcherName: watcher.definition.name,
    timestamp: Date.now(),
    systemObservations: observations,
    overallHealth,
    recommendations,
    requiresIntervention: overallHealth === "critical",
  };
}

function sendWatcherReport(
  spiritRegistry: SpiritRegistry,
  watcher: DynamicSpiritState,
  report: WatcherReport
): void {
  const content = formatWatcherReport(report);
  const priority = report.overallHealth === "critical" ? "urgent" :
                   report.overallHealth === "warning" ? "high" : "normal";

  // Report to superior (if any) or to GodAI
  reportToSuperior(
    spiritRegistry,
    watcher.eid,
    `System Watch Report: ${report.overallHealth.toUpperCase()}`,
    content,
    priority as any,
    { report }
  );

  console.log(`[SystemWatcher] ${watcher.definition.name} sent ${priority} report (${report.overallHealth})`);
}

function formatWatcherReport(report: WatcherReport): string {
  const lines: string[] = [
    `## System Watcher Report: ${report.watcherName}`,
    `**Overall Health:** ${report.overallHealth.toUpperCase()}`,
    "",
  ];

  // Group anomalies by severity
  const allAnomalies = report.systemObservations.flatMap(o =>
    o.anomalies.map(a => ({ ...a, system: o.systemName }))
  );

  if (allAnomalies.length > 0) {
    lines.push("### Anomalies Detected:");
    for (const anomaly of allAnomalies) {
      lines.push(`- [${anomaly.severity.toUpperCase()}] ${anomaly.system}: ${anomaly.description}`);
    }
    lines.push("");
  }

  // Patterns
  const allPatterns = report.systemObservations.flatMap(o =>
    o.patterns.map(p => ({ ...p, system: o.systemName }))
  );

  if (allPatterns.length > 0) {
    lines.push("### Patterns Observed:");
    for (const pattern of allPatterns) {
      lines.push(`- ${pattern.system}: ${pattern.description} (${Math.round(pattern.confidence * 100)}% confidence)`);
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("### Recommendations:");
    for (const rec of report.recommendations) {
      lines.push(`- ${rec}`);
    }
  }

  return lines.join("\n");
}

// =============================================================================
// WATCHER CREATION HELPER
// =============================================================================

/**
 * Create a system watcher for specific systems
 */
export function createSystemWatcherConfig(
  systems: string[],
  patterns?: string[]
): WatchConfig {
  return {
    targetSystems: systems,
    watchPatterns: patterns || ["stagnation", "performance", "errors"],
    alertThresholds: {
      stagnationMs: 60000,
      performanceDegradationFactor: 2.0,
      errorCount: 3,
    },
  };
}
