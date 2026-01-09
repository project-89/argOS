/**
 * Proposition/Validation System
 *
 * Inspired by TinyTroupe's Proposition concept - allows defining claims about
 * entities that can be evaluated and scored. Useful for:
 * - Validating agent behavior matches persona
 * - Checking simulation health
 * - Scoring entity states against criteria
 * - Monitoring emergent behaviors
 *
 * Propositions can evaluate to:
 * - Boolean (true/false)
 * - Score (0-9 scale)
 * - Multi-criteria assessment
 */

import { query } from "bitecs";
import type { World } from "./world";
import { Name, Agent, Needs, Description } from "./components";
import { getDynamicComponent, getComponentDefinition, getDynamicComponentValues } from "./dynamic-components";

export interface PropositionCheck {
  // Component to check (built-in or dynamic)
  component: string;
  // Property to check
  property: string;
  // Expected condition
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=" | "contains" | "exists" | "in_range";
  // Value to compare against
  value?: any;
  // For in_range: min and max
  min?: number;
  max?: number;
  // Weight for this check in overall score (0-1)
  weight: number;
  // Description of what this check validates
  description: string;
}

export interface PropositionDefinition {
  name: string;
  // Natural language description of the claim
  claim: string;
  // Target entity name, or "*" for all entities, or a component name prefixed with "@" for all entities with that component
  target: string;
  // Checks that comprise this proposition
  checks: PropositionCheck[];
  // Minimum score to pass (0-9)
  passThreshold: number;
  // Category for grouping (e.g., "persona_adherence", "simulation_health", "emergent_behavior")
  category: string;
}

export interface PropositionResult {
  proposition: string;
  target: string;
  targetEid: number;
  passed: boolean;
  score: number; // 0-9
  checkResults: Array<{
    check: string;
    passed: boolean;
    actualValue: any;
    expectedValue: any;
    contribution: number; // Contribution to final score
  }>;
  timestamp: number;
}

export interface PropositionRegistry {
  propositions: Map<string, PropositionDefinition>;
  history: PropositionResult[];
  // Aggregate scores by category
  categoryScores: Map<string, { total: number; count: number; avg: number }>;
}

export function createPropositionRegistry(): PropositionRegistry {
  return {
    propositions: new Map(),
    history: [],
    categoryScores: new Map(),
  };
}

export function registerProposition(
  registry: PropositionRegistry,
  definition: PropositionDefinition
): void {
  registry.propositions.set(definition.name, definition);
}

export function unregisterProposition(registry: PropositionRegistry, name: string): boolean {
  return registry.propositions.delete(name);
}

export function listPropositions(registry: PropositionRegistry): PropositionDefinition[] {
  return Array.from(registry.propositions.values());
}

// Built-in component accessors
const BUILTIN_COMPONENTS: Record<string, any> = {
  Name,
  Agent,
  Needs,
  Description,
};

function getComponentValue(
  world: World,
  eid: number,
  componentName: string,
  property: string
): any {
  const builtin = BUILTIN_COMPONENTS[componentName];
  if (builtin && builtin[property]) {
    return builtin[property][eid];
  }

  const dynamic = getDynamicComponent(componentName);
  if (dynamic && dynamic[property]) {
    return dynamic[property][eid];
  }

  return undefined;
}

function evaluateCheck(
  world: World,
  eid: number,
  check: PropositionCheck
): { passed: boolean; actualValue: any } {
  const value = getComponentValue(world, eid, check.component, check.property);

  if (check.operator === "exists") {
    return { passed: value !== undefined, actualValue: value };
  }

  if (value === undefined) {
    return { passed: false, actualValue: undefined };
  }

  let passed = false;
  switch (check.operator) {
    case ">":
      passed = value > check.value;
      break;
    case "<":
      passed = value < check.value;
      break;
    case ">=":
      passed = value >= check.value;
      break;
    case "<=":
      passed = value <= check.value;
      break;
    case "==":
      passed = value === check.value;
      break;
    case "!=":
      passed = value !== check.value;
      break;
    case "contains":
      passed = String(value).toLowerCase().includes(String(check.value).toLowerCase());
      break;
    case "in_range":
      passed = value >= (check.min ?? -Infinity) && value <= (check.max ?? Infinity);
      break;
  }

  return { passed, actualValue: value };
}

function getTargetEntities(world: World, target: string): number[] {
  if (target === "*") {
    return Array.from(query(world, [Name]));
  }

  if (target.startsWith("@")) {
    // Get all entities with specified component
    const componentName = target.slice(1);
    const builtin = BUILTIN_COMPONENTS[componentName];
    if (builtin) {
      return Array.from(query(world, [builtin]));
    }
    // For dynamic components
    const entities = Array.from(query(world, [Name]));
    return entities.filter(eid => {
      const values = getDynamicComponentValues(componentName, eid);
      return values && Object.values(values).some(v => v !== undefined);
    });
  }

  // Find specific entity by name
  const entities = Array.from(query(world, [Name]));
  const found = entities.find(e => Name.value[e] === target);
  return found !== undefined ? [found] : [];
}

export function evaluateProposition(
  world: World,
  registry: PropositionRegistry,
  propositionName: string
): PropositionResult[] {
  const definition = registry.propositions.get(propositionName);
  if (!definition) {
    return [];
  }

  const targetEntities = getTargetEntities(world, definition.target);
  const results: PropositionResult[] = [];

  for (const eid of targetEntities) {
    const entityName = Name.value[eid] || `Entity#${eid}`;
    const checkResults: PropositionResult["checkResults"] = [];
    let totalWeight = 0;
    let weightedScore = 0;

    for (const check of definition.checks) {
      const { passed, actualValue } = evaluateCheck(world, eid, check);
      const contribution = passed ? check.weight * 9 : 0;

      checkResults.push({
        check: check.description,
        passed,
        actualValue,
        expectedValue: check.value ?? (check.operator === "in_range" ? `${check.min}-${check.max}` : "exists"),
        contribution,
      });

      totalWeight += check.weight;
      weightedScore += contribution;
    }

    // Normalize score to 0-9
    const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 10) / 10 : 0;
    const passed = score >= definition.passThreshold;

    const result: PropositionResult = {
      proposition: definition.name,
      target: entityName,
      targetEid: eid,
      passed,
      score,
      checkResults,
      timestamp: Date.now(),
    };

    results.push(result);
    registry.history.push(result);

    // Update category scores
    const categoryScore = registry.categoryScores.get(definition.category) || { total: 0, count: 0, avg: 0 };
    categoryScore.total += score;
    categoryScore.count++;
    categoryScore.avg = categoryScore.total / categoryScore.count;
    registry.categoryScores.set(definition.category, categoryScore);
  }

  return results;
}

export function evaluateAllPropositions(
  world: World,
  registry: PropositionRegistry
): Map<string, PropositionResult[]> {
  const allResults = new Map<string, PropositionResult[]>();

  for (const name of registry.propositions.keys()) {
    allResults.set(name, evaluateProposition(world, registry, name));
  }

  return allResults;
}

export function getCategoryReport(registry: PropositionRegistry): Record<string, { avg: number; count: number }> {
  const report: Record<string, { avg: number; count: number }> = {};
  for (const [category, scores] of registry.categoryScores) {
    report[category] = { avg: Math.round(scores.avg * 10) / 10, count: scores.count };
  }
  return report;
}

export function getPropositionHistory(
  registry: PropositionRegistry,
  options?: {
    propositionName?: string;
    targetEntity?: string;
    category?: string;
    passedOnly?: boolean;
    failedOnly?: boolean;
    limit?: number;
  }
): PropositionResult[] {
  let results = registry.history;

  if (options?.propositionName) {
    results = results.filter(r => r.proposition === options.propositionName);
  }
  if (options?.targetEntity) {
    results = results.filter(r => r.target === options.targetEntity);
  }
  if (options?.category) {
    const propDef = registry.propositions.get(options.category);
    // Filter by category - need to look up proposition category
    results = results.filter(r => {
      const def = registry.propositions.get(r.proposition);
      return def?.category === options.category;
    });
  }
  if (options?.passedOnly) {
    results = results.filter(r => r.passed);
  }
  if (options?.failedOnly) {
    results = results.filter(r => !r.passed);
  }
  if (options?.limit) {
    results = results.slice(-options.limit);
  }

  return results;
}

// Helper to create common proposition types
export function createNeedsHealthProposition(
  name: string,
  targetEntity: string,
  hungerMax: number = 70,
  energyMin: number = 30
): PropositionDefinition {
  return {
    name,
    claim: `Entity "${targetEntity}" has healthy needs levels`,
    target: targetEntity,
    checks: [
      {
        component: "Needs",
        property: "hunger",
        operator: "<",
        value: hungerMax,
        weight: 0.5,
        description: `Hunger below ${hungerMax}`,
      },
      {
        component: "Needs",
        property: "energy",
        operator: ">",
        value: energyMin,
        weight: 0.5,
        description: `Energy above ${energyMin}`,
      },
    ],
    passThreshold: 5,
    category: "agent_health",
  };
}

export function createValueRangeProposition(
  name: string,
  claim: string,
  targetEntity: string,
  component: string,
  property: string,
  min: number,
  max: number,
  category: string = "simulation_health"
): PropositionDefinition {
  return {
    name,
    claim,
    target: targetEntity,
    checks: [
      {
        component,
        property,
        operator: "in_range",
        min,
        max,
        weight: 1.0,
        description: `${property} is between ${min} and ${max}`,
      },
    ],
    passThreshold: 5,
    category,
  };
}

export function createExistenceProposition(
  name: string,
  claim: string,
  targetEntity: string,
  component: string,
  property: string,
  category: string = "entity_validation"
): PropositionDefinition {
  return {
    name,
    claim,
    target: targetEntity,
    checks: [
      {
        component,
        property,
        operator: "exists",
        weight: 1.0,
        description: `${component}.${property} exists`,
      },
    ],
    passThreshold: 9,
    category,
  };
}
