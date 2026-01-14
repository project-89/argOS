/**
 * Effect Executor - Executes effects that modify real ECS data
 *
 * This bridges the semantic layer (affordances, rules) with the ECS layer (components).
 * When an affordance is used or a rule triggers, the effects modify actual game state.
 */

import { removeEntity, query, addComponent, removeComponent, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Traits, ObjectState, ObjectType, Needs, Health, Mind, Inventory } from "../ecs/components";
import { OccupiesRoom } from "../ecs/relations";

// Map of ECS component names to their actual component objects
const ECS_COMPONENTS: Record<string, any> = {
  Needs,
  Health,
  Mind,
  Name,
  Description,
  Traits,
  ObjectState,
  ObjectType,
};
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
 * Uses the ECS Traits component (JSON array format) as the source of truth
 */
function getTraits(eid: number, world?: World): Set<string> {
  // First try the ECS Traits component (used by ObjectManager)
  const traitsJson = Traits?.active?.[eid];
  if (traitsJson) {
    try {
      const traitsArray = JSON.parse(traitsJson) as string[];
      return new Set(traitsArray);
    } catch {
      // fallback
    }
  }

  // Fallback to ObjectMeta dynamic component for backwards compatibility
  const meta = getDynamicComponentValues("ObjectMeta", eid);
  if (meta?.traits) {
    return new Set(meta.traits.split(",").filter(Boolean));
  }

  return new Set();
}

/**
 * Get inventory items for an entity
 */
function getInventoryItemsLocal(eid: number): number[] {
  const itemsJson = Inventory?.items?.[eid];
  if (!itemsJson) return [];
  try {
    return JSON.parse(itemsJson) as number[];
  } catch {
    return [];
  }
}

/**
 * Get EFFECTIVE traits for an actor - dynamically computed from containment hierarchy
 *
 * DYNAMIC TRAIT RESOLUTION: Instead of copying traits on pickup, we compute capabilities
 * by traversing what the actor is holding:
 *
 *   Actor holds Jar → Jar is open → Jar has "hasSpices" → Actor effectively has "hasSpices"
 *   Actor holds Knife → Knife is sharp → Knife has "hasKnife" → Actor effectively has "hasKnife"
 *
 * Benefits:
 *   - No stale traits: Drop the jar, immediately lose hasSpices
 *   - State-aware: Knife goes dull? Immediately lose hasKnife
 *   - No sync bugs: Sharpen knife while holding? Automatically gain hasKnife
 *   - Hierarchical: Bag contains key, you have bag, you effectively have the key's capabilities
 */
export function getEffectiveActorTraits(actorEid: number, visited: Set<number> = new Set()): Set<string> {
  // Prevent infinite loops in case of circular containment
  if (visited.has(actorEid)) return new Set();
  visited.add(actorEid);

  // Start with actor's own traits
  const effectiveTraits = new Set(getTraits(actorEid));

  // Get items in actor's inventory
  const inventoryItems = getInventoryItemsLocal(actorEid);

  // For each held item, collect its capability traits (traits starting with "has")
  for (const itemEid of inventoryItems) {
    const itemTraits = getTraits(itemEid);

    // Add capability traits from the item
    for (const trait of itemTraits) {
      if (trait.startsWith("has")) {
        effectiveTraits.add(trait);
      }
    }

    // Recursively check if this item contains other items (e.g., bag with key)
    const containedItems = getInventoryItemsLocal(itemEid);
    for (const containedEid of containedItems) {
      const containedTraits = getEffectiveActorTraits(containedEid, visited);
      for (const trait of containedTraits) {
        if (trait.startsWith("has")) {
          effectiveTraits.add(trait);
        }
      }
    }
  }

  return effectiveTraits;
}

/**
 * Set traits on an entity
 * Updates both the ECS Traits component and ObjectMeta for compatibility
 */
function setTraits(eid: number, traits: Set<string>): void {
  const traitsArray = Array.from(traits);

  // Update ECS Traits component (primary)
  if (Traits?.active) {
    Traits.active[eid] = JSON.stringify(traitsArray);
  }

  // Also update ObjectMeta for backwards compatibility
  setDynamicComponentValue("ObjectMeta", eid, "traits", traitsArray.join(","));
}

/**
 * Recalculate traits based on object type and current state
 * Uses ECS ObjectType and ObjectState components as primary source
 */
function recalculateTraits(eid: number, ctx: EffectContext): void {
  let typeId: string | undefined;
  let currentState: string | undefined;

  // Try ECS ObjectType component first
  if (ObjectType?.typeId?.[eid]) {
    typeId = ObjectType.typeId[eid];
    currentState = ObjectState?.current?.[eid];
  }

  // Fallback to ObjectMeta dynamic component
  if (!typeId) {
    const meta = getDynamicComponentValues("ObjectMeta", eid);
    typeId = meta?.type;
    currentState = meta?.state;
  }

  if (!typeId) {
    console.warn(`[recalculateTraits] No typeId for eid=${eid}`);
    return;
  }

  const objectType = ctx.worldSchema?.getObjectType(typeId);
  if (!objectType) {
    console.warn(`[recalculateTraits] No objectType found for typeId="${typeId}" (eid=${eid})`);
    return;
  }

  const stateData = objectType.states[currentState || objectType.defaultState];
  if (!stateData) {
    console.warn(`[recalculateTraits] No stateData for state="${currentState}" (type=${typeId}, eid=${eid})`);
  }

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

  console.log(`[recalculateTraits] eid=${eid}, type=${typeId}, state=${currentState}, traits=[${Array.from(traitSet).join(", ")}]`);
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
        // First check if it's an ECS component
        const ecsComponent = ECS_COMPONENTS[mod.component];

        if (ecsComponent && ecsComponent[mod.property]) {
          // Handle ECS component modification directly
          const currentValue = ecsComponent[mod.property][targetEid] ?? 0;
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

          ecsComponent[mod.property][targetEid] = newValue;
          changes.push(`${mod.component}.${mod.property}: ${currentValue} -> ${newValue}`);
          continue;  // Skip dynamic component handling
        }

        // Fall back to dynamic component handling
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

      // Use ECS ObjectState component primarily
      let oldState: string | undefined;
      if (ObjectState?.current?.[targetEid]) {
        oldState = ObjectState.current[targetEid];
        ObjectState.previous[targetEid] = oldState;
        ObjectState.current[targetEid] = effect.state;
      }

      // Also update ObjectMeta for backwards compatibility
      if (!oldState) {
        oldState = getDynamicComponentValues("ObjectMeta", targetEid)?.state;
      }
      setDynamicComponentValue("ObjectMeta", targetEid, "state", effect.state);

      recalculateTraits(targetEid, ctx);

      // CRITICAL: Update Description.value from WorldSchema state definition
      // This ensures the agent sees accurate state-specific descriptions
      const typeId = ObjectType?.typeId?.[targetEid];
      if (typeId && ctx.worldSchema) {
        const objectType = ctx.worldSchema.getObjectType(typeId);
        if (objectType && objectType.states[effect.state]) {
          const stateDescription = objectType.states[effect.state].description;
          if (stateDescription && Description?.value) {
            Description.value[targetEid] = stateDescription;
          }
        }
      }

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
 *
 * Uses DYNAMIC TRAIT RESOLUTION for actor requirements:
 * - Actor capabilities come from held items, not copied traits
 * - Holding a sharp knife = having "hasKnife"
 * - Holding an open spice jar = having "hasSpices"
 */
export function canUseAffordance(
  affordance: AffordanceDefinition,
  actorEid: number,
  targetEid: number
): { available: boolean; reason?: string } {
  const targetTraits = getTraits(targetEid);
  // Use DYNAMIC resolution for actor - capabilities come from held items
  const actorTraits = getEffectiveActorTraits(actorEid);

  // Check target requirements
  for (const req of affordance.requires) {
    if (!targetTraits.has(req)) {
      const currentState = ObjectState?.current?.[targetEid];
      const availableTraits = Array.from(targetTraits).filter(t => !t.startsWith("_"));
      const context = currentState
        ? `state: ${currentState}, has: [${availableTraits.join(", ")}]`
        : `has: [${availableTraits.join(", ")}]`;
      return { available: false, reason: `Target lacks trait: ${req} (${context})` };
    }
  }

  // Check blocking traits
  for (const block of affordance.blockedBy || []) {
    if (targetTraits.has(block)) {
      return { available: false, reason: `Blocked by trait: ${block}` };
    }
  }

  // Check actor requirements (using DYNAMIC traits from held items)
  for (const req of affordance.actorRequires || []) {
    if (!actorTraits.has(req)) {
      // Show what actor currently has for context
      const currentTraits = Array.from(actorTraits).filter(t => t.startsWith("has"));
      const context = currentTraits.length > 0
        ? `you have: [${currentTraits.join(", ")}]`
        : "you have no tool capabilities";
      return { available: false, reason: `Actor lacks trait: ${req} (${context})` };
    }
  }

  return { available: true };
}

/**
 * Transfer tool/capability traits from item to actor when item is picked up.
 *
 * GENERALIZABLE PRINCIPLE: Any trait starting with "has" represents a capability
 * that transfers from the item to the actor. This eliminates the need for a
 * hardcoded list - just name your capability traits with "has" prefix.
 *
 * Examples:
 *   - Crowbar has trait "hasCrowbar" → actor gains "hasCrowbar" → can use pry
 *   - Oil can has trait "hasOil" → actor gains "hasOil" → can use oil
 *   - Key has trait "hasKey" → actor gains "hasKey" → can use unlock
 */
export function transferToolTraits(actorEid: number, targetEid: number, changes: string[]): void {
  const itemTraits = getTraits(targetEid);
  const actorTraits = getTraits(actorEid);

  // Transfer any trait starting with "has" - these are capability traits
  for (const trait of itemTraits) {
    if (trait.startsWith("has") && !actorTraits.has(trait)) {
      actorTraits.add(trait);
      changes.push(`actor +trait: ${trait}`);
    }
  }

  setTraits(actorEid, actorTraits);
}

/**
 * Execute an affordance - the main entry point for agent actions
 * Supports smart affordance matching: if "unlock" fails, tries "unlock_*" variants
 */
export function executeAffordance(
  affordanceName: string,
  ctx: EffectContext
): EffectResult {
  if (ctx.actorEid === undefined || ctx.targetEid === undefined) {
    return { success: false, message: "Actor and target required", changes: [] };
  }

  // Try to find a usable affordance - first exact match, then variants
  let affordance = ctx.worldSchema?.getAffordance(affordanceName);
  let check = affordance ? canUseAffordance(affordance, ctx.actorEid, ctx.targetEid) : null;

  // If exact match fails due to requirements, try variant affordances (e.g., "unlock_toolbox")
  if (!affordance || (check && !check.available)) {
    const allAffordances = ctx.worldSchema?.getAllAffordances() || [];
    const variants = allAffordances.filter((a: AffordanceDefinition) =>
      a.name.startsWith(`${affordanceName}_`) || a.name.endsWith(`_${affordanceName}`)
    );

    for (const variant of variants) {
      const variantCheck = canUseAffordance(variant, ctx.actorEid, ctx.targetEid);
      if (variantCheck.available) {
        console.log(`[Affordance] Found usable variant: ${variant.name} (instead of ${affordanceName})`);
        affordance = variant;
        check = variantCheck;
        break;
      }
    }
  }

  if (!affordance) {
    return { success: false, message: `Unknown affordance: ${affordanceName}`, changes: [] };
  }

  if (!check || !check.available) {
    return { success: false, message: check?.reason || "Affordance not available", changes: [] };
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

  // TOOL TRAIT TRANSFER: When picking up items, transfer tool traits to actor
  // This allows: pick up crowbar -> actor gains hasCrowbar -> can use pry affordance
  if (affordanceName === "take") {
    transferToolTraits(ctx.actorEid, ctx.targetEid, allChanges);
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
