/**
 * Artificer Spirit
 *
 * A spirit type that maintains and repairs the simulation's systems.
 * The Artificer constantly patrols the systems, looking for:
 * - Broken or erroring systems
 * - Systems with poor performance
 * - Systems that aren't executing when they should
 * - Code issues that need fixing
 *
 * Unlike GodAI which creates systems, the Artificer MAINTAINS them.
 * This separation of concerns allows GodAI to focus on creative work
 * while the Artificer handles the technical maintenance.
 */

import { generateText } from "ai";
import type { World } from "../ecs/world";
import { spiritModel, daemonModel } from "../llm/config";
import type { SystemRegistry, SystemDefinition } from "../ecs/dynamic-systems";
import {
  listSystems,
  getSystem,
  activateSystem,
  deactivateSystem,
} from "../ecs/dynamic-systems";
import type { SpiritRegistry } from "./spirit-registry";
import { reportToSuperior } from "./spirit-registry";
import {
  type DynamicSpiritState,
  logSpiritExecution,
} from "./spirit-factory";
import { recordEvent, getRecentEvents } from "./consistency-spirit";
import { modifySystem } from "../god/system-baker";

// =============================================================================
// ARTIFICER TYPES
// =============================================================================

export interface ArtificerConfig {
  /** How often to run inspection cycles (ms) */
  inspectionInterval: number;
  /** Max errors before auto-disabling a system */
  maxErrorsBeforeDisable: number;
  /** Whether to auto-fix simple issues */
  autoFixEnabled: boolean;
  /** Systems to ignore (won't touch these) */
  ignoreSystems: string[];
}

export interface SystemDiagnosis {
  systemName: string;
  status: "healthy" | "warning" | "critical" | "dead";
  issues: SystemIssue[];
  metrics: {
    executionCount: number;
    errorCount: number;
    lastRun: number;
    frequency: number;
    active: boolean;
  };
  recommendation: "none" | "monitor" | "repair" | "disable" | "investigate";
}

export interface SystemIssue {
  type: "error" | "stagnation" | "performance" | "logic" | "missing_dependency";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  suggestedFix?: string;
  autoFixable: boolean;
}

export interface RepairAction {
  systemName: string;
  actionType: "fix_code" | "restart" | "disable" | "modify_frequency" | "clear_errors";
  description: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface ArtificerReport {
  timestamp: number;
  systemsInspected: number;
  healthySystems: number;
  warningSystems: number;
  criticalSystems: number;
  repairsAttempted: RepairAction[];
  recommendations: string[];
}

// =============================================================================
// ERROR TRACKING
// =============================================================================

interface SystemErrorLog {
  systemName: string;
  errors: { timestamp: number; message: string; count: number }[];
  totalErrors: number;
  lastError: number;
}

const errorLogs = new Map<string, SystemErrorLog>();

/**
 * Record a system error (called from system runner)
 */
export function recordSystemError(systemName: string, error: string): void {
  let log = errorLogs.get(systemName);
  if (!log) {
    log = { systemName, errors: [], totalErrors: 0, lastError: 0 };
    errorLogs.set(systemName, log);
  }

  const now = Date.now();
  const recentError = log.errors.find(
    e => e.message === error && now - e.timestamp < 60000
  );

  if (recentError) {
    recentError.count++;
    recentError.timestamp = now;
  } else {
    log.errors.push({ timestamp: now, message: error, count: 1 });
    // Keep only last 20 unique errors
    if (log.errors.length > 20) {
      log.errors = log.errors.slice(-20);
    }
  }

  log.totalErrors++;
  log.lastError = now;
}

/**
 * Get error log for a system
 */
export function getSystemErrorLog(systemName: string): SystemErrorLog | null {
  return errorLogs.get(systemName) || null;
}

/**
 * Clear errors for a system
 */
export function clearSystemErrors(systemName: string): void {
  const log = errorLogs.get(systemName);
  if (log) {
    log.errors = [];
    log.totalErrors = 0;
  }
}

// =============================================================================
// SYSTEM INSPECTION
// =============================================================================

/**
 * Inspect a single system and diagnose its health
 */
export function inspectSystem(
  systemRegistry: SystemRegistry,
  systemName: string
): SystemDiagnosis | null {
  const system = getSystem(systemRegistry, systemName);
  if (!system) return null;

  const errorLog = getSystemErrorLog(systemName);
  const issues: SystemIssue[] = [];
  let status: SystemDiagnosis["status"] = "healthy";

  const now = Date.now();
  const timeSinceLastRun = now - (system.lastRun || 0);

  // Check for errors
  if (errorLog && errorLog.totalErrors > 0) {
    const recentErrors = errorLog.errors.filter(e => now - e.timestamp < 300000); // Last 5 min

    if (recentErrors.length > 10) {
      issues.push({
        type: "error",
        severity: "critical",
        description: `System has ${recentErrors.length} errors in the last 5 minutes`,
        suggestedFix: "Review system code for logic errors",
        autoFixable: false,
      });
      status = "critical";
    } else if (recentErrors.length > 3) {
      issues.push({
        type: "error",
        severity: "high",
        description: `System has ${recentErrors.length} recent errors`,
        suggestedFix: "Check for edge cases in system logic",
        autoFixable: false,
      });
      status = "warning";
    }
  }

  // Check for stagnation (system should run but hasn't)
  if (system.active && system.frequency > 0) {
    const expectedRuns = timeSinceLastRun / system.frequency;
    if (expectedRuns > 3 && system.lastRun > 0) {
      issues.push({
        type: "stagnation",
        severity: "medium",
        description: `System hasn't run in ${Math.round(timeSinceLastRun / 1000)}s (expected every ${system.frequency}ms)`,
        suggestedFix: "Check if system is being blocked or skipped",
        autoFixable: false,
      });
      if (status === "healthy") status = "warning";
    }
  }

  // Check for never-run active systems
  if (system.active && system.lastRun === 0 && system.compiledFn) {
    issues.push({
      type: "stagnation",
      severity: "low",
      description: "Active system has never executed",
      suggestedFix: "Verify system is registered correctly",
      autoFixable: false,
    });
  }

  // Check for systems with no compiled function
  if (!system.compiledFn && !system.code) {
    issues.push({
      type: "missing_dependency",
      severity: "critical",
      description: "System has no executable code",
      suggestedFix: "Re-bake the system or provide code",
      autoFixable: false,
    });
    status = "dead";
  }

  // Determine recommendation
  let recommendation: SystemDiagnosis["recommendation"] = "none";
  if (status === "critical" || status === "dead") {
    recommendation = "disable";
  } else if (issues.some(i => i.severity === "high")) {
    recommendation = "repair";
  } else if (issues.length > 0) {
    recommendation = "monitor";
  }

  return {
    systemName,
    status,
    issues,
    metrics: {
      executionCount: systemRegistry.systems.get(systemName)?.lastRun ? 1 : 0, // Simplified
      errorCount: errorLog?.totalErrors || 0,
      lastRun: system.lastRun,
      frequency: system.frequency,
      active: system.active,
    },
    recommendation,
  };
}

/**
 * Inspect all systems and return diagnoses
 */
export function inspectAllSystems(
  systemRegistry: SystemRegistry,
  ignoreSystems: string[] = []
): SystemDiagnosis[] {
  const systems = listSystems(systemRegistry);
  const diagnoses: SystemDiagnosis[] = [];

  for (const system of systems) {
    if (ignoreSystems.includes(system.name)) continue;

    const diagnosis = inspectSystem(systemRegistry, system.name);
    if (diagnosis) {
      diagnoses.push(diagnosis);
    }
  }

  return diagnoses;
}

// =============================================================================
// REPAIR ACTIONS
// =============================================================================

/**
 * Attempt to repair a system based on its diagnosis
 */
export async function repairSystem(
  world: World,
  systemRegistry: SystemRegistry,
  diagnosis: SystemDiagnosis,
  config: ArtificerConfig
): Promise<RepairAction> {
  const action: RepairAction = {
    systemName: diagnosis.systemName,
    actionType: "fix_code",
    description: "",
    success: false,
    timestamp: Date.now(),
  };

  try {
    switch (diagnosis.recommendation) {
      case "disable": {
        // Disable critically broken systems
        const disabled = deactivateSystem(systemRegistry, diagnosis.systemName);
        action.actionType = "disable";
        action.description = `Disabled system due to: ${diagnosis.issues.map(i => i.description).join("; ")}`;
        action.success = disabled;
        break;
      }

      case "repair": {
        // Attempt to fix the system
        const errorIssues = diagnosis.issues.filter(i => i.type === "error");
        if (errorIssues.length > 0 && config.autoFixEnabled) {
          // Try to modify the system to fix errors
          const fixDescription = `Fix the following issues: ${errorIssues.map(i => i.description).join("; ")}. Add better error handling and null checks.`;

          const result = await modifySystem(
            diagnosis.systemName,
            fixDescription,
            world,
            systemRegistry
          );

          action.actionType = "fix_code";
          action.description = fixDescription;
          action.success = result.success;
          action.error = result.error;

          if (result.success) {
            clearSystemErrors(diagnosis.systemName);
          }
        } else {
          // Can't auto-fix, just clear errors and monitor
          clearSystemErrors(diagnosis.systemName);
          action.actionType = "clear_errors";
          action.description = "Cleared error log for monitoring";
          action.success = true;
        }
        break;
      }

      case "monitor": {
        // Just clear old errors and continue monitoring
        action.actionType = "clear_errors";
        action.description = "Cleared stale errors, continuing to monitor";
        action.success = true;
        break;
      }

      default:
        action.description = "No action needed";
        action.success = true;
    }
  } catch (error) {
    action.success = false;
    action.error = String(error);
  }

  return action;
}

// =============================================================================
// ARTIFICER COGNITION CYCLE
// =============================================================================

/**
 * Create default Artificer configuration
 */
export function createArtificerConfig(
  overrides: Partial<ArtificerConfig> = {}
): ArtificerConfig {
  return {
    inspectionInterval: 60000, // Every 60 seconds
    maxErrorsBeforeDisable: 20,
    autoFixEnabled: true,
    ignoreSystems: ["StimulusEmission", "MindDecay"], // Core systems to leave alone
    ...overrides,
  };
}

/**
 * Run a single Artificer cognition cycle
 */
export async function runArtificerCognition(
  world: World,
  systemRegistry: SystemRegistry,
  spiritRegistry: SpiritRegistry,
  artificer: DynamicSpiritState
): Promise<ArtificerReport> {
  const config = artificer.artificerConfig || createArtificerConfig();
  const report: ArtificerReport = {
    timestamp: Date.now(),
    systemsInspected: 0,
    healthySystems: 0,
    warningSystems: 0,
    criticalSystems: 0,
    repairsAttempted: [],
    recommendations: [],
  };

  // 1. Inspect all systems
  const diagnoses = inspectAllSystems(systemRegistry, config.ignoreSystems);
  report.systemsInspected = diagnoses.length;

  // 2. Categorize by health
  for (const d of diagnoses) {
    if (d.status === "healthy") report.healthySystems++;
    else if (d.status === "warning") report.warningSystems++;
    else report.criticalSystems++;
  }

  // 3. Handle critical systems first
  const criticalSystems = diagnoses.filter(d => d.status === "critical" || d.status === "dead");
  for (const diagnosis of criticalSystems) {
    const action = await repairSystem(world, systemRegistry, diagnosis, config);
    report.repairsAttempted.push(action);

    if (action.success) {
      console.log(`[Artificer] ${action.actionType}: ${diagnosis.systemName} - ${action.description}`);
    } else {
      console.log(`[Artificer] FAILED ${action.actionType}: ${diagnosis.systemName} - ${action.error}`);
    }
  }

  // 4. Handle warning systems
  const warningSystems = diagnoses.filter(d => d.status === "warning");
  for (const diagnosis of warningSystems) {
    // Only attempt repair if issues are significant
    if (diagnosis.issues.some(i => i.severity === "high")) {
      const action = await repairSystem(world, systemRegistry, diagnosis, config);
      report.repairsAttempted.push(action);
    }
  }

  // 5. NEW: Check for overly simple systems that need improvement
  const simpleSystems = findSimpleSystems(systemRegistry, "moderate");
  if (simpleSystems.length > 0 && config.autoFixEnabled) {
    console.log(`[Artificer] Found ${simpleSystems.length} systems below complexity threshold`);

    // Improve up to 2 simple systems per cycle to avoid overwhelming
    for (const analysis of simpleSystems.slice(0, 2)) {
      console.log(`[Artificer] Improving ${analysis.systemName} (complexity: ${analysis.complexity}, score: ${analysis.score})`);
      console.log(`[Artificer] Issues: ${analysis.issues.join("; ")}`);

      const improvementPrompt = generateImprovementPrompt(analysis);

      try {
        const result = await modifySystem(
          analysis.systemName,
          improvementPrompt,
          world,
          systemRegistry
        );

        report.repairsAttempted.push({
          systemName: analysis.systemName,
          actionType: "fix_code",
          description: `Improved complexity from ${analysis.complexity} (${analysis.score}/100)`,
          success: result.success,
          error: result.error,
          timestamp: Date.now(),
        });

        if (result.success) {
          console.log(`[Artificer] SUCCESS: Improved ${analysis.systemName}`);
        } else {
          console.log(`[Artificer] FAILED to improve ${analysis.systemName}: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Artificer] Error improving ${analysis.systemName}:`, error);
      }
    }

    // Add recommendations for remaining simple systems
    for (const analysis of simpleSystems.slice(2)) {
      report.recommendations.push(
        `System "${analysis.systemName}" is too simple (${analysis.complexity}). Needs: ${analysis.improvements[0] || "state transformation"}`
      );
    }
  }

  // 6. Generate recommendations using LLM for complex issues
  const complexIssues = diagnoses.filter(d =>
    d.issues.some(i => !i.autoFixable && i.severity !== "low")
  );

  if (complexIssues.length > 0) {
    try {
      const result = await generateText({
        model: daemonModel, // Use fast model for quick analysis
        prompt: `You are the Artificer, a spirit that maintains simulation systems.

Analyze these system issues and provide 1-3 brief recommendations:

${complexIssues.map(d => `
System: ${d.systemName}
Status: ${d.status}
Issues:
${d.issues.map(i => `- [${i.severity}] ${i.type}: ${i.description}`).join("\n")}
`).join("\n")}

Respond with a JSON array of recommendation strings (max 3):
["recommendation 1", "recommendation 2"]`,
        maxTokens: 200,
      });

      const cleaned = result.text.trim().replace(/```json\n?|\n?```/g, "");
      const recommendations = JSON.parse(cleaned);
      report.recommendations.push(...recommendations.slice(0, 3));
    } catch (error) {
      // Fallback recommendations
      report.recommendations.push(...complexIssues.map(d =>
        `Review ${d.systemName}: ${d.issues[0]?.description || "unknown issue"}`
      ).slice(0, 3));
    }
  }

  // 7. Report to superior if there are critical issues or improvements made
  if (report.criticalSystems > 0 || report.repairsAttempted.length > 0) {
    const spiritName = artificer.definition?.name || "The Artificer";
    const improvementsMade = report.repairsAttempted.filter(r => r.description.includes("Improved complexity"));

    reportToSuperior(
      spiritRegistry,
      artificer.eid,
      "System Maintenance Report",
      `${spiritName} inspection complete:
- Systems: ${report.healthySystems} healthy, ${report.warningSystems} warning, ${report.criticalSystems} critical
- Repairs attempted: ${report.repairsAttempted.length}
${improvementsMade.length > 0 ? `- Complexity improvements: ${improvementsMade.length}` : ""}
${report.recommendations.length > 0 ? `\nRecommendations:\n${report.recommendations.map(r => `- ${r}`).join("\n")}` : ""}`,
      report.criticalSystems > 0 ? "high" : "normal"
    );
  }

  // 8. Record event
  recordEvent("artificer_inspection", {
    systemsInspected: report.systemsInspected,
    healthy: report.healthySystems,
    warning: report.warningSystems,
    critical: report.criticalSystems,
    repairsAttempted: report.repairsAttempted.length,
    simpleSystemsFound: simpleSystems.length,
  }, artificer.definition?.name || "Artificer");

  logSpiritExecution(
    artificer.eid,
    "inspection",
    `${report.systemsInspected} systems`,
    "success",
    `${report.repairsAttempted.length} repairs, ${simpleSystems.length} simple systems`
  );

  return report;
}

// =============================================================================
// SYSTEM CODE ANALYSIS (for complex repairs)
// =============================================================================

/**
 * Complexity levels for ECS systems
 */
export type SystemComplexity = "trivial" | "simple" | "moderate" | "complex" | "robust";

/**
 * Complexity analysis result
 */
export interface ComplexityAnalysis {
  systemName: string;
  complexity: SystemComplexity;
  score: number;  // 0-100
  issues: string[];
  improvements: string[];
  codePatterns: {
    hasStateReads: boolean;
    hasStateWrites: boolean;
    usesRelations: boolean;
    hasConditionalLogic: boolean;
    hasMultipleFactors: boolean;
    emitsEvents: boolean;
    hasEdgeCaseHandling: boolean;
    isTextOnly: boolean;
    hasHardcodedNames: boolean;
  };
}

/**
 * Analyze system code complexity using static analysis
 * Returns a complexity score and improvement suggestions
 */
export function analyzeSystemComplexity(
  systemRegistry: SystemRegistry,
  systemName: string
): ComplexityAnalysis | null {
  const system = getSystem(systemRegistry, systemName);
  if (!system) return null;

  const code = system.code || "";
  if (!code) {
    return {
      systemName,
      complexity: "trivial",
      score: 0,
      issues: ["No code available"],
      improvements: ["Re-bake the system with proper implementation"],
      codePatterns: {
        hasStateReads: false,
        hasStateWrites: false,
        usesRelations: false,
        hasConditionalLogic: false,
        hasMultipleFactors: false,
        emitsEvents: false,
        hasEdgeCaseHandling: false,
        isTextOnly: true,
        hasHardcodedNames: false,
      },
    };
  }

  // Static code analysis patterns
  const patterns = {
    // Good patterns - signs of proper ECS usage
    hasStateReads: /\w+\.\w+\[eid\]/.test(code) && !/Name\.value\[eid\]/.test(code.replace(/Name\.value\[eid\]/g, '')),
    hasStateWrites: /\w+\.\w+\[eid\]\s*=/.test(code) && !/ctx\.emit/.test(code.split(/\w+\.\w+\[eid\]\s*=/)[0]),
    usesRelations: /getRelationTargets|OccupiesRoom|Knows|Contains|HasMemory|HasGoal/.test(code),
    hasConditionalLogic: /if\s*\(.*\w+\.\w+\[/.test(code),  // if statement using component data
    hasMultipleFactors: (code.match(/\w+\.\w+\[eid\]/g) || []).length >= 3,
    emitsEvents: /ctx\.emit\(/.test(code),
    hasEdgeCaseHandling: /Math\.max|Math\.min|\.length\s*===?\s*0|\|\||if\s*\(!/.test(code),

    // Bad patterns - signs of trivial/text-only systems
    isTextOnly: /ctx\.emit\(["'].*["'],\s*\{.*content:/.test(code) && !/\w+\.\w+\[eid\]\s*=/.test(code),
    hasHardcodedNames: /\.includes\(["'][A-Z][a-z]+["']\)|===?\s*["'][A-Z][a-z]+["']/.test(code),
  };

  const issues: string[] = [];
  const improvements: string[] = [];
  let score = 0;

  // Score good patterns
  if (patterns.hasStateReads) {
    score += 15;
  } else {
    issues.push("System does not read component state to make decisions");
    improvements.push("Add logic that reads Mind.arousal, Needs.hunger, or other component values");
  }

  if (patterns.hasStateWrites) {
    score += 25;  // Most important - must modify state!
  } else {
    issues.push("CRITICAL: System does not write to any component state");
    improvements.push("Add state mutations like 'Needs.hunger[eid] = newValue' or 'Mind.arousal[eid] += 0.1'");
  }

  if (patterns.usesRelations) {
    score += 15;
    improvements.push("Good use of relations for spatial/social awareness");
  } else if (code.includes("Room") || code.includes("room")) {
    issues.push("System references rooms but doesn't use OccupiesRoom relation");
    improvements.push("Use ctx.getRelationTargets(world, eid, OccupiesRoom) instead of Room component");
  }

  if (patterns.hasConditionalLogic) {
    score += 15;
  } else {
    issues.push("System lacks conditional logic based on component state");
    improvements.push("Add if statements that branch based on entity state (e.g., if hunger > 0.8)");
  }

  if (patterns.hasMultipleFactors) {
    score += 15;
  } else {
    issues.push("System only considers one or two factors");
    improvements.push("Consider multiple components: combine hunger + energy + social needs for richer behavior");
  }

  if (patterns.hasEdgeCaseHandling) {
    score += 10;
  } else {
    issues.push("System may not handle edge cases (empty arrays, undefined values)");
    improvements.push("Add Math.max/min for clamping, check array lengths before accessing");
  }

  if (patterns.emitsEvents) {
    score += 5;  // Events are good but secondary to state changes
  }

  // Penalize bad patterns
  if (patterns.isTextOnly) {
    score -= 30;
    issues.push("CRITICAL: System only emits text without modifying ECS state");
    improvements.push("Transform state, don't just emit messages. Change component values!");
  }

  if (patterns.hasHardcodedNames) {
    score -= 20;
    issues.push("System uses hardcoded entity names instead of component-based logic");
    improvements.push("Check Agent.role or use component presence instead of Name.value.includes('Ada')");
  }

  // Determine complexity level
  let complexity: SystemComplexity;
  if (score <= 10) complexity = "trivial";
  else if (score <= 30) complexity = "simple";
  else if (score <= 55) complexity = "moderate";
  else if (score <= 75) complexity = "complex";
  else complexity = "robust";

  return {
    systemName,
    complexity,
    score: Math.max(0, Math.min(100, score)),
    issues,
    improvements,
    codePatterns: patterns,
  };
}

/**
 * Analyze all systems for complexity and return those needing improvement
 */
export function findSimpleSystems(
  systemRegistry: SystemRegistry,
  minComplexity: SystemComplexity = "moderate"
): ComplexityAnalysis[] {
  const systems = listSystems(systemRegistry);
  const analyses: ComplexityAnalysis[] = [];

  const complexityOrder: SystemComplexity[] = ["trivial", "simple", "moderate", "complex", "robust"];
  const minIndex = complexityOrder.indexOf(minComplexity);

  for (const system of systems) {
    const analysis = analyzeSystemComplexity(systemRegistry, system.name);
    if (analysis) {
      const complexityIndex = complexityOrder.indexOf(analysis.complexity);
      if (complexityIndex < minIndex) {
        analyses.push(analysis);
      }
    }
  }

  // Sort by complexity (worst first)
  return analyses.sort((a, b) => a.score - b.score);
}

/**
 * Generate improvement prompt for a simple system
 */
export function generateImprovementPrompt(analysis: ComplexityAnalysis): string {
  const lines = [
    `Improve the "${analysis.systemName}" system to be more robust.`,
    "",
    "CURRENT ISSUES:",
    ...analysis.issues.map(i => `- ${i}`),
    "",
    "REQUIRED IMPROVEMENTS:",
    ...analysis.improvements.map(i => `- ${i}`),
    "",
    "The improved system MUST:",
    "1. Read multiple component values to make decisions",
    "2. Write new values to components (actual state mutation)",
    "3. Use relations correctly (OccupiesRoom, Knows, etc.)",
    "4. Handle edge cases (null checks, bounds clamping)",
    "5. NOT just emit text - must transform ECS state",
  ];

  return lines.join("\n");
}

/**
 * Analyze system code and suggest improvements
 */
export async function analyzeSystemCode(
  systemRegistry: SystemRegistry,
  systemName: string
): Promise<{ analysis: string; suggestions: string[] } | null> {
  const system = getSystem(systemRegistry, systemName);
  if (!system) return null;

  const code = system.code || system.pseudocode || "";
  if (!code) {
    return {
      analysis: "No code available for analysis",
      suggestions: ["Re-bake the system to generate code"],
    };
  }

  // First do static complexity analysis
  const complexity = analyzeSystemComplexity(systemRegistry, systemName);

  try {
    const result = await generateText({
      model: spiritModel,
      prompt: `Analyze this ECS system code for potential issues:

System: ${systemName}
Description: ${system.description}
Frequency: ${system.frequency}ms
Complexity Score: ${complexity?.score || "unknown"}/100

Code:
${code}

Static Analysis Issues:
${complexity?.issues.join("\n") || "None detected"}

Identify:
1. Potential null/undefined errors
2. Performance issues
3. Logic bugs
4. Missing edge cases
5. Missing state transformations (systems MUST modify component values!)

Respond with JSON:
{
  "analysis": "Brief overall assessment",
  "suggestions": ["suggestion 1", "suggestion 2", ...]
}`,
      maxTokens: 500,
    });

    const cleaned = result.text.trim().replace(/```json\n?|\n?```/g, "");
    return JSON.parse(cleaned);
  } catch (error) {
    // Return static analysis results if LLM fails
    return {
      analysis: complexity ? `Complexity: ${complexity.complexity} (${complexity.score}/100)` : "Code analysis failed",
      suggestions: complexity?.improvements || ["Manual review recommended"],
    };
  }
}

/**
 * Get a summary of all system health for display
 */
export function getSystemHealthSummary(systemRegistry: SystemRegistry): string {
  const diagnoses = inspectAllSystems(systemRegistry);

  const lines = [
    "=== System Health Summary ===",
    "",
  ];

  const grouped = {
    healthy: diagnoses.filter(d => d.status === "healthy"),
    warning: diagnoses.filter(d => d.status === "warning"),
    critical: diagnoses.filter(d => d.status === "critical" || d.status === "dead"),
  };

  if (grouped.critical.length > 0) {
    lines.push(`🔴 CRITICAL (${grouped.critical.length}):`);
    for (const d of grouped.critical) {
      lines.push(`   ${d.systemName}: ${d.issues[0]?.description || "unknown"}`);
    }
    lines.push("");
  }

  if (grouped.warning.length > 0) {
    lines.push(`🟡 WARNING (${grouped.warning.length}):`);
    for (const d of grouped.warning) {
      lines.push(`   ${d.systemName}: ${d.issues[0]?.description || "unknown"}`);
    }
    lines.push("");
  }

  lines.push(`🟢 HEALTHY: ${grouped.healthy.length} systems`);

  return lines.join("\n");
}

// =============================================================================
// TOOL-BASED ARTIFICER COGNITION
// =============================================================================

import { generateText as generateTextWithTools } from "ai";
import { createArtificerTools } from "./spirit-tools";

/**
 * Run Artificer cognition using the AI tool system
 * This allows the AI to decide what actions to take based on the situation
 */
export async function runArtificerWithTools(
  world: World,
  systemRegistry: SystemRegistry,
  _spiritRegistry: SpiritRegistry,
  artificer: DynamicSpiritState
): Promise<ArtificerReport> {
  const config = artificer.artificerConfig || createArtificerConfig();
  const tools = createArtificerTools(world, systemRegistry);

  // Always do a deterministic inspection first to populate the report
  const allSystems = listSystems(systemRegistry);
  const diagnoses = inspectAllSystems(systemRegistry, config.ignoreSystems);

  // Debug: log if registry appears empty or has few systems
  if (allSystems.length === 0) {
    console.warn(`[Artificer] WARNING: systemRegistry has 0 systems!`);
    console.warn(`  Registry type: ${typeof systemRegistry}`);
    console.warn(`  Has systems property: ${!!systemRegistry?.systems}`);
    console.warn(`  Systems type: ${systemRegistry?.systems?.constructor?.name || typeof systemRegistry?.systems}`);
    console.warn(`  Systems size: ${systemRegistry?.systems?.size ?? "N/A"}`);
    if (systemRegistry?.systems instanceof Map) {
      console.warn(`  Systems keys: [${Array.from(systemRegistry.systems.keys()).join(", ")}]`);
    }
  } else {
    // Log successful inspection for debugging
    console.log(`[Artificer] Inspecting ${allSystems.length} systems: ${allSystems.map(s => s.name).join(", ")}`);
  }

  const report: ArtificerReport = {
    timestamp: Date.now(),
    systemsInspected: diagnoses.length,
    healthySystems: diagnoses.filter(d => d.status === "healthy").length,
    warningSystems: diagnoses.filter(d => d.status === "warning").length,
    criticalSystems: diagnoses.filter(d => d.status === "critical" || d.status === "dead").length,
    repairsAttempted: [],
    recommendations: [],
  };

  // Get current system state for context
  const systemHealth = getSystemHealthSummary(systemRegistry);
  const recentEvents = getRecentEvents(10).filter(e =>
    e.type.includes("system") || e.type.includes("error")
  );

  const systemPrompt = `You are The Tinkerer, an Artificer spirit responsible for maintaining the simulation's systems.

Your job is to:
1. Inspect systems for problems
2. Repair broken systems
3. Adjust system frequencies if needed
4. Disable critically broken systems
5. Report issues you can't fix to GodAI

Current System Health:
${systemHealth}

Recent Events:
${recentEvents.map(e => `- ${e.type}: ${JSON.stringify(e.data || {})}`).join("\n") || "No recent system events"}

You have access to tools for inspection, repair, and management.
Be methodical: first inspect, then decide what to repair, then act.
If a system is critically broken and you can't fix it, disable it to prevent cascading failures.`;

  try {
    // Use generateText with tools - the AI will call tools as needed
    const result = await generateTextWithTools({
      model: spiritModel,
      system: systemPrompt,
      prompt: `Perform your maintenance cycle. Inspect any systems that need attention and take appropriate action.`,
      tools,
    });

    // Parse the tool results to populate our report
    // The toolResults array contains all results from tool calls
    if (result.toolResults) {
      for (const toolResult of result.toolResults as any[]) {
        const resultData = (toolResult as any).result;

        switch (toolResult.toolName) {
          case "listSystems":
            if (Array.isArray(resultData)) {
              report.systemsInspected = resultData.length;
              report.healthySystems = resultData.filter((s: any) => s.active).length;
            }
            break;
          case "repairSystem":
            report.repairsAttempted.push({
              systemName: resultData?.systemName || "unknown",
              actionType: "fix_code",
              description: resultData?.message || "repair attempted",
              success: resultData?.success || false,
              error: resultData?.error,
              timestamp: Date.now(),
            });
            break;
          case "enableSystem":
            report.repairsAttempted.push({
              systemName: resultData?.systemName || "unknown",
              actionType: "restart", // Using valid action type
              description: resultData?.message || "enabled",
              success: resultData?.success || true,
              timestamp: Date.now(),
            });
            break;
          case "disableSystem":
            report.repairsAttempted.push({
              systemName: resultData?.systemName || "unknown",
              actionType: "disable",
              description: resultData?.message || "disabled",
              success: resultData?.success || true,
              timestamp: Date.now(),
            });
            break;
          case "reportToGodAI":
            report.recommendations.push(resultData?.message || "Issue reported");
            break;
        }
      }
    }

    // Extract any text recommendations from the final response
    if (result.text && result.text.length > 0) {
      console.log(`[Artificer] ${result.text.slice(0, 200)}`);
    }

  } catch (error) {
    console.error("[Artificer] Tool-based cognition error:", error);
    // Fall back to deterministic inspection
    const diagnoses = inspectAllSystems(systemRegistry, config.ignoreSystems);
    report.systemsInspected = diagnoses.length;
    report.healthySystems = diagnoses.filter(d => d.status === "healthy").length;
    report.warningSystems = diagnoses.filter(d => d.status === "warning").length;
    report.criticalSystems = diagnoses.filter(d => d.status === "critical" || d.status === "dead").length;
  }

  // Record the inspection event
  recordEvent("artificer_inspection", {
    systemsInspected: report.systemsInspected,
    healthy: report.healthySystems,
    warning: report.warningSystems,
    critical: report.criticalSystems,
    repairsAttempted: report.repairsAttempted.length,
    mode: "tool-based",
  }, "The Tinkerer");

  return report;
}
