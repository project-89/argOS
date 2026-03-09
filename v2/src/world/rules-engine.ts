/**
 * RulesEngine - Interprets and executes declarative world rules
 *
 * Rules define emergent behavior without hardcoding:
 * - Fire spreads to flammable objects
 * - Food decays over time
 * - Objects break when durability hits zero
 * - etc.
 *
 * GodAI can define new rules at runtime.
 * Rules execute REAL effects that modify component data.
 */

import { query, hasComponent, addComponent, removeComponent, getRelationTargets } from "bitecs";
import {
  ObjectType,
  ObjectState,
  Traits,
  Durability,
  Fuel,
  GridPosition,
  Name,
} from "../ecs/components";
import {
  worldSchema,
  RuleDefinition,
  RuleCondition,
  RuleEffect,
  EffectDefinition,
} from "./schema";
import { ObjectManager } from "./object-manager";
import { LocatedIn } from "../ecs/relations";
import {
  getDynamicComponent,
  getDynamicComponentValue,
  setDynamicComponentValue,
  createDynamicComponent,
} from "../ecs/dynamic-components";
import { executeEffect, executeAffordance, type EffectContext, type EffectResult } from "./effect-executor";

export interface RuleEvent {
  type: string;
  entityId?: number;
  data?: Record<string, any>;
  timestamp: number;
}

export interface RuleContext {
  tick: number;
  events: RuleEvent[];
  random: () => number;
}

export class RulesEngine {
  private world: any;
  private objectManager: ObjectManager;
  private pendingEvents: RuleEvent[] = [];
  private eventHandlers: Map<string, ((event: RuleEvent) => void)[]> = new Map();
  private registry: { byName: Map<string, number>; byId: Map<number, string> };

  constructor(world: any, objectManager: ObjectManager) {
    this.world = world;
    this.objectManager = objectManager;
    // Entity registry for name lookups
    this.registry = { byName: new Map(), byId: new Map() };
  }

  /**
   * Register an entity in the name registry
   */
  registerEntity(eid: number, name: string): void {
    this.registry.byName.set(name, eid);
    this.registry.byId.set(eid, name);
  }

  /**
   * Unregister an entity from the name registry
   */
  unregisterEntity(eid: number): void {
    const name = this.registry.byId.get(eid);
    if (name) {
      this.registry.byName.delete(name);
      this.registry.byId.delete(eid);
    }
  }

  /**
   * Create effect context for executing effects
   */
  private createEffectContext(actorEid?: number, targetEid?: number): EffectContext {
    return {
      world: this.world,
      actorEid,
      targetEid,
      worldSchema,
      registry: this.registry,
    };
  }

  /**
   * Process all active rules for a tick
   */
  processTick(tick: number): RuleEvent[] {
    const context: RuleContext = {
      tick,
      events: [],
      random: Math.random,
    };

    const activeRules = worldSchema.getActiveRules();

    for (const rule of activeRules) {
      if (rule.when.event === "tick") {
        this.processRule(rule, context);
      }
    }

    // Process any events that were emitted
    const emittedEvents = [...this.pendingEvents];
    this.pendingEvents = [];

    // Trigger event-based rules
    for (const event of emittedEvents) {
      for (const rule of activeRules) {
        if (rule.when.event === event.type) {
          this.processRule(rule, context, event.entityId);
        }
      }

      // Notify handlers
      const handlers = this.eventHandlers.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    }

    return emittedEvents;
  }

  /**
   * Process a single rule
   */
  private processRule(
    rule: RuleDefinition,
    context: RuleContext,
    specificEid?: number
  ): void {
    // Get candidate entities
    let candidates: number[];

    if (specificEid !== undefined) {
      candidates = [specificEid];
    } else {
      // Query all entities with ObjectType (all managed objects)
      candidates = [...query(this.world, [ObjectType])];
    }

    // Filter by condition
    const matching = candidates.filter((eid) =>
      this.evaluateCondition(rule.when.condition, eid, context)
    );

    // Execute effects on matching entities
    for (const eid of matching) {
      for (const effect of rule.then) {
        this.executeEffect(effect, eid, context);
      }
    }
  }

  /**
   * Evaluate a rule condition against an entity
   */
  private evaluateCondition(
    condition: RuleCondition | undefined,
    eid: number,
    context: RuleContext
  ): boolean {
    if (!condition) return true;

    const traits = this.objectManager.getTraits(eid);

    // Check required traits
    if (condition.has) {
      for (const trait of condition.has) {
        if (!traits.includes(trait)) {
          return false;
        }
      }
    }

    // Check blocked traits
    if (condition.not) {
      for (const trait of condition.not) {
        if (traits.includes(trait)) {
          return false;
        }
      }
    }

    // Check state
    if (condition.inState) {
      if (!hasComponent(this.world, eid, ObjectState)) {
        return false;
      }
      const currentState = ObjectState.current[eid];
      if (currentState !== condition.inState) {
        return false;
      }
    }

    // Evaluate expression
    if (condition.expression) {
      if (!this.evaluateExpression(condition.expression, eid)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate a simple expression
   */
  private evaluateExpression(expr: string, eid: number): boolean {
    // Simple expression parser for component.field comparisons
    // e.g., "durability.current <= 0"

    const comparisonMatch = expr.match(
      /(\w+)\.(\w+)\s*(<=|>=|<|>|==|!=)\s*(\d+)/
    );
    if (comparisonMatch) {
      const [, componentName, fieldName, operator, valueStr] = comparisonMatch;
      const targetValue = parseFloat(valueStr);

      // Get component value
      const value = this.getComponentValue(eid, componentName, fieldName);
      if (value === undefined) return false;

      switch (operator) {
        case "<=":
          return value <= targetValue;
        case ">=":
          return value >= targetValue;
        case "<":
          return value < targetValue;
        case ">":
          return value > targetValue;
        case "==":
          return value === targetValue;
        case "!=":
          return value !== targetValue;
      }
    }

    return false;
  }

  /**
   * Get a value from a component (dynamic or hardcoded)
   */
  private getComponentValue(
    eid: number,
    componentName: string,
    fieldName: string
  ): number | undefined {
    // First try dynamic components
    const dynamicComponent = getDynamicComponent(componentName);
    if (dynamicComponent) {
      const value = dynamicComponent[fieldName]?.[eid];
      return typeof value === "number" ? value : undefined;
    }

    // Fallback to hardcoded components
    switch (componentName.toLowerCase()) {
      case "durability":
        if (!hasComponent(this.world, eid, Durability)) return undefined;
        return (Durability as any)[fieldName]?.[eid];
      case "fuel":
        if (!hasComponent(this.world, eid, Fuel)) return undefined;
        return (Fuel as any)[fieldName]?.[eid];
      default:
        return undefined;
    }
  }

  /**
   * Execute a rule effect
   */
  private executeEffect(
    effect: RuleEffect,
    sourceEid: number,
    context: RuleContext
  ): void {
    // Determine target entities
    const targets = this.resolveTargets(effect, sourceEid, context);

    for (const targetEid of targets) {
      // Check chance if specified
      if (effect.params?.chance !== undefined) {
        if (context.random() > effect.params.chance) {
          continue;
        }
      }

      switch (effect.action) {
        case "add_trait":
          this.effectAddTrait(targetEid, effect.params);
          break;

        case "remove_trait":
          this.effectRemoveTrait(targetEid, effect.params);
          break;

        case "transition_state":
          this.effectTransitionState(targetEid, effect.params);
          break;

        case "set_state": {
          // Common alias produced by LLMs (matches EffectDefinition naming).
          const state = effect.params?.state ?? effect.params?.newState;
          this.effectTransitionState(targetEid, { ...(effect.params || {}), state });
          break;
        }

        case "modify_value":
          this.effectModifyValue(targetEid, effect.params);
          break;

        case "emit_stimulus":
          this.effectEmitStimulus(sourceEid, targetEid, effect);
          break;

        case "emit_event":
          this.effectEmitEvent(targetEid, effect.params, context);
          break;

        case "destroy":
          this.objectManager.destroy(targetEid);
          break;

        case "spawn":
          this.effectSpawn(targetEid, effect.params);
          break;

        default:
          console.warn(`Unknown rule effect action: ${effect.action}`);
      }
    }
  }

  /**
   * Resolve target entities for an effect
   */
  private resolveTargets(
    effect: RuleEffect,
    sourceEid: number,
    context: RuleContext
  ): number[] {
    const target = effect.target || "self";

    switch (target) {
      case "self":
        return [sourceEid];

      case "source":
        return [sourceEid];

      case "nearby":
        return this.queryNearby(sourceEid, effect.query);

      default:
        // Custom target selector - could be an entity ID or query
        if (typeof target === "number") {
          return [target];
        }
        return [sourceEid];
    }
  }

  /**
   * Query for nearby entities
   */
  private queryNearby(
    sourceEid: number,
    queryDef?: RuleEffect["query"]
  ): number[] {
    // Canonical proximity should never "go blind" due to grid/room drift.
    // We always include containment-based proximity (same direct container),
    // and *also* include GridPosition-based proximity when available.
    const nearby = new Set<number>(this.queryInSameContainer(sourceEid, queryDef));
    if (!hasComponent(this.world, sourceEid, GridPosition)) {
      return Array.from(nearby);
    }

    const sourceX = GridPosition.x[sourceEid];
    const sourceY = GridPosition.y[sourceEid];
    const radius = queryDef?.radius || 1;

    // Get all entities with positions
    const allEntities = query(this.world, [GridPosition, ObjectType]);
    const gridNearby: number[] = [];

    for (const eid of allEntities) {
      if (eid === sourceEid) continue;

      const x = GridPosition.x[eid];
      const y = GridPosition.y[eid];
      const distance = Math.abs(x - sourceX) + Math.abs(y - sourceY); // Manhattan distance

      if (distance <= radius) {
        // Check trait requirements
        if (queryDef?.has || queryDef?.not) {
          const traits = this.objectManager.getTraits(eid);

          if (queryDef.has) {
            const hasAll = queryDef.has.every((t) => traits.includes(t));
            if (!hasAll) continue;
          }

          if (queryDef.not) {
            const hasNone = !queryDef.not.some((t) => traits.includes(t));
            if (!hasNone) continue;
          }
        }

        gridNearby.push(eid);
      }
    }

    for (const eid of gridNearby) nearby.add(eid);
    return Array.from(nearby);
  }

  /**
   * Query for entities in the same container
   */
  private queryInSameContainer(
    sourceEid: number,
    queryDef?: RuleEffect["query"]
  ): number[] {
    // Direct-container proximity: entities directly LocatedIn the same container.
    // This intentionally does NOT traverse nested containers.
    const sourceContainer = getRelationTargets(this.world, sourceEid, LocatedIn)[0];
    if (sourceContainer === undefined) return [];

    const candidates = Array.from(query(this.world, [LocatedIn(sourceContainer), ObjectType]));
    const nearby: number[] = [];

    for (const eid of candidates) {
      if (eid === sourceEid) continue;

      if (queryDef?.has || queryDef?.not) {
        const traits = this.objectManager.getTraits(eid);

        if (queryDef.has) {
          const hasAll = queryDef.has.every((t) => traits.includes(t));
          if (!hasAll) continue;
        }

        if (queryDef.not) {
          const hasNone = !queryDef.not.some((t) => traits.includes(t));
          if (!hasNone) continue;
        }
      }

      nearby.push(eid);
    }

    return nearby;
  }

  // --- Effect implementations ---

  private effectAddTrait(eid: number, params: Record<string, any> | undefined): void {
    if (!params?.trait) return;
    this.objectManager.addTrait(eid, params.trait);
  }

  private effectRemoveTrait(eid: number, params: Record<string, any> | undefined): void {
    if (!params?.trait) return;
    this.objectManager.removeTrait(eid, params.trait);
  }

  private effectTransitionState(eid: number, params: Record<string, any> | undefined): void {
    if (!params?.state) return;
    const typeId = ObjectType.typeId[eid];
    const typeDef = typeId ? worldSchema.getObjectType(typeId) : undefined;
    // Avoid noisy invalid-transition spam from LLM-authored rules: if the state isn't defined
    // for this type, treat it as a no-op at the rules layer.
    if (typeDef && !typeDef.states[params.state]) {
      return;
    }
    this.objectManager.transitionState(eid, params.state, "rule");
  }

  private effectModifyValue(eid: number, params: Record<string, any> | undefined): void {
    if (!params?.component || !params?.field) return;

    const componentName = params.component;
    const fieldName = params.field;
    const delta = params.delta || 0;

    // First try dynamic components
    const dynamicComponent = getDynamicComponent(componentName);
    if (dynamicComponent && fieldName in dynamicComponent) {
      const current = dynamicComponent[fieldName][eid] || 0;
      dynamicComponent[fieldName][eid] = current + delta;
      return;
    }

    // Fallback to hardcoded components
    switch (componentName.toLowerCase()) {
      case "durability":
        if (hasComponent(this.world, eid, Durability)) {
          const current = (Durability as any)[fieldName][eid] || 0;
          (Durability as any)[fieldName][eid] = current + delta;
        }
        break;

      case "fuel":
        if (hasComponent(this.world, eid, Fuel)) {
          const current = (Fuel as any)[fieldName][eid] || 0;
          (Fuel as any)[fieldName][eid] = current + delta;
        }
        break;
    }
  }

  private effectEmitEvent(
    eid: number,
    params: Record<string, any> | undefined,
    context: RuleContext
  ): void {
    const eventType = params?.event || params?.type;
    if (!eventType) return;

    const event: RuleEvent = {
      type: eventType,
      timestamp: context.tick,
    };

    if (params.includeEntity) {
      event.entityId = eid;
      event.data = {
        entityInfo: this.objectManager.getInfo(eid),
      };
    } else if (params && typeof params === "object") {
      // If not including entityInfo, still pass through any extra data so downstream
      // systems (and new rules) can react deterministically.
      const { event: _event, type: _type, includeEntity: _includeEntity, ...rest } = params as any;
      if (Object.keys(rest).length > 0) event.data = rest;
    }

    this.pendingEvents.push(event);
  }

  private effectEmitStimulus(sourceEid: number, targetEid: number, effect: RuleEffect): void {
    const params = effect.params || {};
    const stimulusType = params.stimulusType || params.type || "event";
    const stimulusContent = params.stimulusContent || params.content || "";
    const stimulusRadius = params.stimulusRadius || params.radius;

    const mapped: EffectDefinition = {
      type: "emit_stimulus",
      target: effect.target === "nearby" ? "nearby" : "target",
      stimulusType,
      stimulusContent,
      stimulusRadius,
    };

    const ctx = this.createEffectContext(sourceEid, targetEid);
    executeEffect(mapped, ctx);
  }

  private effectSpawn(
    nearEid: number,
    params: Record<string, any> | undefined
  ): void {
    if (!params?.typeId) return;

    // Spawn near the source entity
    const spawnOptions: any = { ...params };

    if (hasComponent(this.world, nearEid, GridPosition)) {
      spawnOptions.position = {
        x: GridPosition.x[nearEid],
        y: GridPosition.y[nearEid],
      };
    }

    this.objectManager.spawn(params.typeId, spawnOptions);
  }

  // --- Event handling ---

  /**
   * Subscribe to rule events
   */
  onEvent(eventType: string, handler: (event: RuleEvent) => void): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(eventType);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      }
    };
  }

  /**
   * Manually trigger a rule event
   */
  triggerEvent(event: Omit<RuleEvent, "timestamp">, tick: number): void {
    this.pendingEvents.push({
      ...event,
      timestamp: tick,
    });
  }

  /**
   * Process an action and trigger relevant rules
   * Now uses the effect executor for REAL game state changes
   */
  processAction(
    action: string,
    actorEid: number,
    targetEid: number,
    tick: number
  ): { success: boolean; message: string; changes?: string[] } {
    // Create effect context
    const ctx = this.createEffectContext(actorEid, targetEid);

    // Use the effect executor to run the affordance
    const result = executeAffordance(action, ctx);

    if (!result.success) {
      return { success: false, message: result.message || `Cannot ${action}` };
    }

    // Emit action event
    this.triggerEvent(
      {
        type: `action_${action}`,
        entityId: targetEid,
        data: {
          actor: actorEid,
          target: targetEid,
          changes: result.changes,
        },
      },
      tick
    );

    // Generate description message
    const affordance = worldSchema.getAffordance(action);
    const targetName = Name.value[targetEid] || "something";
    const actorName = Name.value[actorEid] || "someone";

    const message = affordance?.descriptionTemplate
      ?.replace(/\{target\.name\}/g, targetName)
      ?.replace(/\{target\}/g, targetName)
      ?.replace(/\{actor\.name\}/g, actorName)
      ?.replace(/\{actor\}/g, actorName)
      || `${actorName} ${action}s the ${targetName}.`;

    return {
      success: true,
      message,
      changes: result.changes,
    };
  }

  /**
   * Execute a raw effect directly (for rules with EffectDefinition)
   */
  executeRawEffect(effect: EffectDefinition, sourceEid: number): EffectResult {
    const ctx = this.createEffectContext(sourceEid, sourceEid);
    return executeEffect(effect, ctx);
  }
}
