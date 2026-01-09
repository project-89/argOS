/**
 * Intervention System
 *
 * Inspired by TinyTroupe's intervention concept - event-driven preconditions
 * that trigger effects when met. More powerful than tick-based systems because
 * interventions only fire when specific conditions are satisfied.
 *
 * Interventions can:
 * - Watch for specific entity states (e.g., "hunger > 80")
 * - Trigger effects when conditions are met (e.g., "seek food")
 * - Be defined with natural language conditions (evaluated via component checks)
 * - Target specific entities or entity types
 * - Fire once or repeatedly
 */

import { query } from "bitecs";
import type { World } from "./world";
import { Name, Agent, Needs } from "./components";
import { getDynamicComponent, getComponentDefinition, listDynamicComponents } from "./dynamic-components";

export interface InterventionCondition {
  // Target entity by name, or "*" for all entities with the component
  targetEntity: string;
  // Component to check (built-in or dynamic)
  component: string;
  // Property to check
  property: string;
  // Comparison operator
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=" | "contains" | "exists";
  // Value to compare against (not needed for "exists")
  value?: number | string | boolean;
}

export interface InterventionEffect {
  // Type of effect
  type: "setComponent" | "log" | "emit" | "setDynamic" | "custom";
  // Target entity (can use "$target" to refer to the entity that triggered)
  targetEntity: string;
  // For setComponent/setDynamic: component name
  component?: string;
  // For setComponent/setDynamic: property to set
  property?: string;
  // For setComponent/setDynamic: value to set (can use "$current + 10" style expressions)
  value?: any;
  // For log: message (can use $name, $property, etc.)
  message?: string;
  // For emit: event type
  eventType?: string;
  // For emit: event data
  eventData?: Record<string, any>;
  // For custom: function code as string
  customCode?: string;
}

export interface InterventionDefinition {
  name: string;
  description: string;
  // All conditions must be met (AND logic)
  conditions: InterventionCondition[];
  // All effects are executed when conditions are met
  effects: InterventionEffect[];
  // Whether the intervention fires once per entity or repeatedly
  repeatable: boolean;
  // Cooldown in ticks before it can fire again (if repeatable)
  cooldown: number;
  // Whether intervention is active
  active: boolean;
  // Priority (higher = checked first)
  priority: number;
}

export interface InterventionInstance {
  definition: InterventionDefinition;
  // Track which entities have triggered this intervention
  triggeredEntities: Map<number, number>; // eid -> last trigger tick
  // Total times fired
  fireCount: number;
}

export interface InterventionRegistry {
  interventions: Map<string, InterventionInstance>;
  logs: string[];
  events: Array<{ type: string; data: any; timestamp: number }>;
}

export function createInterventionRegistry(): InterventionRegistry {
  return {
    interventions: new Map(),
    logs: [],
    events: [],
  };
}

export function registerIntervention(
  registry: InterventionRegistry,
  definition: InterventionDefinition
): void {
  registry.interventions.set(definition.name, {
    definition,
    triggeredEntities: new Map(),
    fireCount: 0,
  });
}

export function unregisterIntervention(registry: InterventionRegistry, name: string): boolean {
  return registry.interventions.delete(name);
}

export function listInterventions(registry: InterventionRegistry): InterventionDefinition[] {
  return Array.from(registry.interventions.values()).map(i => i.definition);
}

export function activateIntervention(registry: InterventionRegistry, name: string): boolean {
  const intervention = registry.interventions.get(name);
  if (intervention) {
    intervention.definition.active = true;
    return true;
  }
  return false;
}

export function deactivateIntervention(registry: InterventionRegistry, name: string): boolean {
  const intervention = registry.interventions.get(name);
  if (intervention) {
    intervention.definition.active = false;
    return true;
  }
  return false;
}

// Built-in component accessors
const BUILTIN_COMPONENTS: Record<string, any> = {
  Name,
  Agent,
  Needs,
};

function getComponentValue(
  world: World,
  eid: number,
  componentName: string,
  property: string
): any {
  // Check built-in components first
  const builtin = BUILTIN_COMPONENTS[componentName];
  if (builtin && builtin[property]) {
    return builtin[property][eid];
  }

  // Check dynamic components
  const dynamic = getDynamicComponent(componentName);
  if (dynamic && dynamic[property]) {
    return dynamic[property][eid];
  }

  return undefined;
}

function setComponentValue(
  world: World,
  eid: number,
  componentName: string,
  property: string,
  value: any
): boolean {
  // Check built-in components first
  const builtin = BUILTIN_COMPONENTS[componentName];
  if (builtin && builtin[property]) {
    builtin[property][eid] = value;
    return true;
  }

  // Check dynamic components
  const dynamic = getDynamicComponent(componentName);
  if (dynamic && dynamic[property]) {
    dynamic[property][eid] = value;
    return true;
  }

  return false;
}

function evaluateCondition(
  world: World,
  eid: number,
  condition: InterventionCondition
): boolean {
  const value = getComponentValue(world, eid, condition.component, condition.property);

  if (condition.operator === "exists") {
    return value !== undefined;
  }

  if (value === undefined) {
    return false;
  }

  switch (condition.operator) {
    case ">":
      return value > condition.value!;
    case "<":
      return value < condition.value!;
    case ">=":
      return value >= condition.value!;
    case "<=":
      return value <= condition.value!;
    case "==":
      return value === condition.value;
    case "!=":
      return value !== condition.value;
    case "contains":
      return String(value).includes(String(condition.value));
    default:
      return false;
  }
}

function parseValueExpression(expression: any, currentValue: any): any {
  if (typeof expression !== "string") {
    return expression;
  }

  // Handle expressions like "$current + 10" or "$current - 5"
  if (expression.startsWith("$current")) {
    const match = expression.match(/\$current\s*([+\-*/])\s*(\d+(?:\.\d+)?)/);
    if (match && typeof currentValue === "number") {
      const operator = match[1];
      const operand = parseFloat(match[2]);
      switch (operator) {
        case "+": return currentValue + operand;
        case "-": return currentValue - operand;
        case "*": return currentValue * operand;
        case "/": return currentValue / operand;
      }
    }
    return currentValue;
  }

  return expression;
}

function executeEffect(
  world: World,
  eid: number,
  effect: InterventionEffect,
  registry: InterventionRegistry
): void {
  // Resolve target entity
  let targetEid = eid;
  if (effect.targetEntity !== "$target") {
    // Look up entity by name
    const entities = Array.from(query(world, [Name]));
    const found = entities.find(e => Name.value[e] === effect.targetEntity);
    if (found !== undefined) {
      targetEid = found;
    }
  }

  const entityName = Name.value[targetEid] || `Entity#${targetEid}`;

  switch (effect.type) {
    case "setComponent":
    case "setDynamic":
      if (effect.component && effect.property !== undefined) {
        const currentValue = getComponentValue(world, targetEid, effect.component, effect.property);
        const newValue = parseValueExpression(effect.value, currentValue);
        setComponentValue(world, targetEid, effect.component, effect.property, newValue);
      }
      break;

    case "log":
      let message = effect.message || "";
      message = message.replace("$name", entityName);
      if (effect.component && effect.property) {
        const val = getComponentValue(world, targetEid, effect.component, effect.property);
        message = message.replace("$value", String(val));
      }
      registry.logs.push(`[Intervention] ${message}`);
      break;

    case "emit":
      registry.events.push({
        type: effect.eventType || "intervention",
        data: {
          ...effect.eventData,
          targetEntity: entityName,
          targetEid,
        },
        timestamp: Date.now(),
      });
      break;

    case "custom":
      // Custom code execution (sandboxed)
      try {
        const fn = new Function("world", "eid", "registry", "getComponentValue", "setComponentValue",
          effect.customCode || "");
        fn(world, targetEid, registry, getComponentValue, setComponentValue);
      } catch (e) {
        registry.logs.push(`[Intervention] Custom code error: ${e}`);
      }
      break;
  }
}

function getEntitiesForCondition(
  world: World,
  condition: InterventionCondition
): number[] {
  if (condition.targetEntity === "*") {
    // Get all entities with the specified component
    const builtin = BUILTIN_COMPONENTS[condition.component];
    if (builtin) {
      return Array.from(query(world, [builtin]));
    }
    // For dynamic components, get all entities with Name and filter
    const entities = Array.from(query(world, [Name]));
    const dynamic = getDynamicComponent(condition.component);
    if (dynamic) {
      return entities.filter(eid => {
        const def = getComponentDefinition(condition.component);
        if (!def) return false;
        return Object.keys(def.properties).some(prop => dynamic[prop][eid] !== undefined);
      });
    }
    return [];
  } else {
    // Find specific entity by name
    const entities = Array.from(query(world, [Name]));
    const found = entities.find(e => Name.value[e] === condition.targetEntity);
    return found !== undefined ? [found] : [];
  }
}

export function runInterventions(
  world: World,
  registry: InterventionRegistry,
  tick: number
): void {
  // Sort by priority (higher first)
  const sorted = Array.from(registry.interventions.values())
    .filter(i => i.definition.active)
    .sort((a, b) => b.definition.priority - a.definition.priority);

  for (const instance of sorted) {
    const def = instance.definition;

    // Get candidate entities from first condition
    if (def.conditions.length === 0) continue;

    const candidateEntities = getEntitiesForCondition(world, def.conditions[0]);

    for (const eid of candidateEntities) {
      // Check cooldown
      const lastTrigger = instance.triggeredEntities.get(eid) || -Infinity;
      if (!def.repeatable && lastTrigger >= 0) continue;
      if (def.repeatable && tick - lastTrigger < def.cooldown) continue;

      // Check all conditions for this entity
      let allConditionsMet = true;
      for (const condition of def.conditions) {
        // For conditions with specific targets, check that entity
        let checkEid = eid;
        if (condition.targetEntity !== "*" && condition.targetEntity !== Name.value[eid]) {
          const entities = Array.from(query(world, [Name]));
          const found = entities.find(e => Name.value[e] === condition.targetEntity);
          if (found === undefined) {
            allConditionsMet = false;
            break;
          }
          checkEid = found;
        }

        if (!evaluateCondition(world, checkEid, condition)) {
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
        // Execute all effects
        for (const effect of def.effects) {
          executeEffect(world, eid, effect, registry);
        }

        // Record trigger
        instance.triggeredEntities.set(eid, tick);
        instance.fireCount++;

        registry.logs.push(
          `[Intervention] "${def.name}" fired for ${Name.value[eid] || `Entity#${eid}`}`
        );
      }
    }
  }
}

// Helper to create simple interventions
export function createSimpleIntervention(
  name: string,
  description: string,
  targetEntity: string,
  component: string,
  property: string,
  operator: InterventionCondition["operator"],
  value: any,
  effectType: InterventionEffect["type"],
  effectConfig: Partial<InterventionEffect>
): InterventionDefinition {
  return {
    name,
    description,
    conditions: [{
      targetEntity,
      component,
      property,
      operator,
      value,
    }],
    effects: [{
      type: effectType,
      targetEntity: "$target",
      ...effectConfig,
    }],
    repeatable: true,
    cooldown: 1,
    active: true,
    priority: 5,
  };
}
