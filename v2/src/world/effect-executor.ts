/**
 * Effect Executor - Executes effects that modify real ECS data
 *
 * This bridges the semantic layer (affordances, rules) with the ECS layer (components).
 * When an affordance is used or a rule triggers, the effects modify actual game state.
 */

import { removeEntity, query, addComponent, removeComponent, getRelationTargets } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";
import {
  getDynamicComponent,
  setDynamicComponentValue,
  getDynamicComponentValues,
  createDynamicComponent,
} from "../ecs/dynamic-components";
import { queueStimulus, broadcastToRoom } from "../cognition/cognition-system";
import type { EffectDefinition, AffordanceDefinition, ComponentModification } from "./schema";

export interface EffectContext {
  world: World;
  actorEid?: number;
  targetEid?: number;
  worldSchema: any; // WorldSchema instance
  registry: { byName: Map<string, number>; byId: Map<number, string> };
}

export interface EffectResult {
  success: boolean;
  message?: string;
  changes: string[];
}

/**
 * Resolve an effect target to an actual entity ID
 */
function resolveTarget(
  target: string | undefined,
  ctx: EffectContext
): number | undefined {
  if (!target) return ctx.targetEid;

  switch (target) {
    case "actor":
      return ctx.actorEid;
    case "target":
    case "self":
      return ctx.targetEid;
    default:
      // Check if it's a template reference like "{actor}" or "{target}"
      if (target === "{actor}") return ctx.actorEid;
      if (target === "{target}") return ctx.targetEid;
      // Try to look up by name
      return ctx.registry.byName.get(target);
  }
}

/**
 * Interpolate template strings with entity names
 */
function interpolate(template: string, ctx: EffectContext): string {
  const actorName = ctx.actorEid !== undefined ? Name.value[ctx.actorEid] || "someone" : "someone";
  const targetName = ctx.targetEid !== undefined ? Name.value[ctx.targetEid] || "something" : "something";
  const targetDesc = ctx.targetEid !== undefined ? Description.value[ctx.targetEid] || "" : "";

  return template
    .replace(/\{actor\.name\}/g, actorName)
    .replace(/\{actor\}/g, actorName)
    .replace(/\{target\.name\}/g, targetName)
    .replace(/\{target\.description\}/g, targetDesc)
    .replace(/\{target\}/g, targetName);
}

/**
 * Get current traits of an entity as a Set
 */
function getTraits(eid: number): Set<string> {
  const meta = getDynamicComponentValues("ObjectMeta", eid);
  if (!meta?.traits) return new Set();
  return new Set(meta.traits.split(",").filter(Boolean));
}

/**
 * Set traits on an entity
 */
function setTraits(eid: number, traits: Set<string>): void {
  setDynamicComponentValue("ObjectMeta", eid, "traits", Array.from(traits).join(","));
}

/**
 * Recalculate traits based on object type and current state
 */
function recalculateTraits(eid: number, ctx: EffectContext): void {
  const meta = getDynamicComponentValues("ObjectMeta", eid);
  if (!meta?.type) return;

  const objectType = ctx.worldSchema?.getObjectType(meta.type);
  if (!objectType) return;

  const stateData = objectType.states[meta.state];

  // Start with base traits
  const traitSet = new Set<string>(objectType.traits);

  // Add state-specific traits
  if (stateData?.traits) {
    stateData.traits.forEach((t: string) => traitSet.add(t));
  }

  // Remove blocked traits
  if (stateData?.blockedTraits) {
    stateData.blockedTraits.forEach((t: string) => traitSet.delete(t));
  }

  setTraits(eid, traitSet);
}

/**
 * Execute a single effect
 */
export function executeEffect(effect: EffectDefinition, ctx: EffectContext): EffectResult {
  const changes: string[] = [];

  // Check chance
  if (effect.chance !== undefined && Math.random() > effect.chance) {
    return { success: true, message: "Effect skipped (chance)", changes: [] };
  }

  // Check condition
  if (effect.condition) {
    const targetEid = resolveTarget(effect.target, ctx);
    if (targetEid === undefined) {
      return { success: false, message: "Target not found for condition check", changes: [] };
    }

    const [comp, prop] = (effect.condition.check || "").split(".");
    const component = getDynamicComponent(comp);
    if (!component) {
      return { success: false, message: `Component ${comp} not found`, changes: [] };
    }

    const currentValue = component[prop]?.[targetEid];
    const checkValue = effect.condition.value;
    const op = effect.condition.operator || "==";

    let conditionMet = false;
    switch (op) {
      case "==": conditionMet = currentValue == checkValue; break;
      case "!=": conditionMet = currentValue != checkValue; break;
      case ">": conditionMet = currentValue > (checkValue as number); break;
      case "<": conditionMet = currentValue < (checkValue as number); break;
      case ">=": conditionMet = currentValue >= (checkValue as number); break;
      case "<=": conditionMet = currentValue <= (checkValue as number); break;
    }

    if (!conditionMet) {
      return { success: true, message: "Condition not met", changes: [] };
    }
  }

  const targetEid = resolveTarget(effect.target, ctx);

  switch (effect.type) {
    case "modify_component": {
      if (targetEid === undefined) {
        return { success: false, message: "Target not found", changes: [] };
      }

      for (const mod of effect.modifications || []) {
        let component = getDynamicComponent(mod.component);

        // Auto-create component if it doesn't exist
        if (!component) {
          createDynamicComponent({
            name: mod.component,
            description: `Auto-created component`,
            properties: { [mod.property]: typeof mod.value === "number" ? "number" : "string" },
          });
          component = getDynamicComponent(mod.component);
        }

        if (!component) continue;

        const currentValue = component[mod.property]?.[targetEid] ?? 0;
        let newValue: any;

        switch (mod.operation) {
          case "set":
            newValue = mod.value;
            break;
          case "add":
            newValue = (currentValue as number) + (mod.value as number);
            break;
          case "subtract":
            newValue = (currentValue as number) - (mod.value as number);
            break;
          case "multiply":
            newValue = (currentValue as number) * (mod.value as number);
            break;
        }

        setDynamicComponentValue(mod.component, targetEid, mod.property, newValue);
        changes.push(`${mod.component}.${mod.property}: ${currentValue} -> ${newValue}`);
      }
      break;
    }

    case "set_state": {
      if (targetEid === undefined || !effect.state) {
        return { success: false, message: "Target or state not specified", changes: [] };
      }

      const oldState = getDynamicComponentValues("ObjectMeta", targetEid)?.state;
      setDynamicComponentValue("ObjectMeta", targetEid, "state", effect.state);
      recalculateTraits(targetEid, ctx);
      changes.push(`state: ${oldState} -> ${effect.state}`);
      break;
    }

    case "add_trait": {
      if (targetEid === undefined || !effect.trait) {
        return { success: false, message: "Target or trait not specified", changes: [] };
      }

      const traits = getTraits(targetEid);
      traits.add(effect.trait);
      setTraits(targetEid, traits);
      changes.push(`+trait: ${effect.trait}`);
      break;
    }

    case "remove_trait": {
      if (targetEid === undefined || !effect.trait) {
        return { success: false, message: "Target or trait not specified", changes: [] };
      }

      const traits = getTraits(targetEid);
      traits.delete(effect.trait);
      setTraits(targetEid, traits);
      changes.push(`-trait: ${effect.trait}`);
      break;
    }

    case "destroy": {
      if (targetEid === undefined) {
        return { success: false, message: "Target not found", changes: [] };
      }

      const name = Name.value[targetEid];
      removeEntity(ctx.world, targetEid);
      ctx.registry.byName.delete(name);
      ctx.registry.byId.delete(targetEid);
      changes.push(`destroyed: ${name}`);
      break;
    }

    case "emit_stimulus": {
      const content = interpolate(effect.stimulusContent || "", ctx);
      const stimulusType = effect.stimulusType || "event";
      const actorName = ctx.actorEid !== undefined ? Name.value[ctx.actorEid] : "world";

      if (effect.target === "nearby") {
        // Broadcast to room
        if (ctx.actorEid !== undefined) {
          const rooms = getRelationTargets(ctx.world, ctx.actorEid, OccupiesRoom);
          if (rooms.length > 0) {
            broadcastToRoom(ctx.world, rooms[0], {
              type: stimulusType,
              content,
              source: actorName,
            }, ctx.actorEid);
          }
        }
      } else if (targetEid !== undefined) {
        // Send to specific target
        queueStimulus({
          targetEid,
          type: stimulusType,
          content,
          source: actorName,
        });
      }
      changes.push(`stimulus: ${stimulusType}`);
      break;
    }

    case "spawn": {
      // TODO: Implement spawn effect using worldSchema.spawn
      changes.push(`spawn: ${effect.spawnType} (not yet implemented)`);
      break;
    }

    case "add_relation":
    case "remove_relation": {
      // TODO: Implement relation effects
      changes.push(`relation: ${effect.relation} (not yet implemented)`);
      break;
    }

    case "transfer": {
      // TODO: Implement transfer to container
      changes.push(`transfer: ${effect.containerName} (not yet implemented)`);
      break;
    }
  }

  return { success: true, changes };
}

/**
 * Execute all effects in an array
 */
export function executeEffects(
  effects: EffectDefinition[],
  ctx: EffectContext
): EffectResult {
  const allChanges: string[] = [];

  for (const effect of effects) {
    const result = executeEffect(effect, ctx);
    if (!result.success) {
      return result;
    }
    allChanges.push(...result.changes);
  }

  return { success: true, changes: allChanges };
}

/**
 * Check if an affordance is available for an actor to use on a target
 */
export function canUseAffordance(
  affordance: AffordanceDefinition,
  actorEid: number,
  targetEid: number
): { available: boolean; reason?: string } {
  const targetTraits = getTraits(targetEid);
  const actorTraits = getTraits(actorEid);

  // Check target requirements
  for (const req of affordance.requires) {
    if (!targetTraits.has(req)) {
      return { available: false, reason: `Target lacks trait: ${req}` };
    }
  }

  // Check blocking traits
  for (const block of affordance.blockedBy || []) {
    if (targetTraits.has(block)) {
      return { available: false, reason: `Blocked by trait: ${block}` };
    }
  }

  // Check actor requirements
  for (const req of affordance.actorRequires || []) {
    if (!actorTraits.has(req)) {
      return { available: false, reason: `Actor lacks trait: ${req}` };
    }
  }

  return { available: true };
}

/**
 * Execute an affordance - the main entry point for agent actions
 */
export function executeAffordance(
  affordanceName: string,
  ctx: EffectContext
): EffectResult {
  const affordance = ctx.worldSchema?.getAffordance(affordanceName);
  if (!affordance) {
    return { success: false, message: `Unknown affordance: ${affordanceName}`, changes: [] };
  }

  if (ctx.actorEid === undefined || ctx.targetEid === undefined) {
    return { success: false, message: "Actor and target required", changes: [] };
  }

  // Check if affordance is available
  const check = canUseAffordance(affordance, ctx.actorEid, ctx.targetEid);
  if (!check.available) {
    return { success: false, message: check.reason, changes: [] };
  }

  // Execute effects
  const allChanges: string[] = [];

  if (affordance.effects && affordance.effects.length > 0) {
    const result = executeEffects(affordance.effects, ctx);
    if (!result.success) {
      return result;
    }
    allChanges.push(...result.changes);
  }

  // Handle legacy transitions (convert to set_state)
  if (affordance.transitions) {
    const currentState = getDynamicComponentValues("ObjectMeta", ctx.targetEid)?.state;
    const newState = affordance.transitions[currentState];
    if (newState) {
      const result = executeEffect(
        { type: "set_state", target: "target", state: newState },
        ctx
      );
      allChanges.push(...result.changes);
    }
  }

  // Emit perception to nearby agents
  if (affordance.descriptionTemplate) {
    const content = interpolate(affordance.descriptionTemplate, ctx);
    const rooms = ctx.actorEid !== undefined
      ? getRelationTargets(ctx.world, ctx.actorEid, OccupiesRoom)
      : [];

    if (rooms.length > 0) {
      broadcastToRoom(ctx.world, rooms[0], {
        type: "action",
        content,
        source: Name.value[ctx.actorEid!] || "someone",
      }, ctx.actorEid);
    }
  }

  const actorName = ctx.actorEid !== undefined ? Name.value[ctx.actorEid] : "someone";
  const targetName = ctx.targetEid !== undefined ? Name.value[ctx.targetEid] : "something";
  console.log(`[Affordance] ${actorName} -> ${affordanceName} -> ${targetName}: ${allChanges.join(", ")}`);

  return { success: true, changes: allChanges };
}
