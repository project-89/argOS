/**
 * Effect Executor - Executes effects that modify real ECS data
 *
 * This bridges the semantic layer (affordances, rules) with the ECS layer (components).
 * When an affordance is used or a rule triggers, the effects modify actual game state.
 */

import { addEntity, removeEntity, query, addComponent, removeComponent, getRelationTargets, hasComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Name, Description, Traits, ObjectState, ObjectType, Needs, Health, Mind, StimulusSource, ObjectProperties, DynamicDescription, StateTransition, Agent, KanbanCard, KanbanColumn, OrgGovernance, Room, Goal, LastToolResult, ToolResult } from "../ecs/components";
import { getDirectContainer, getRoomForEntity, listDirectContents, setLocatedIn } from "../ecs/location";
import { AllRelations, HasGoal, HasToolResult } from "../ecs/relations";
import { hasInventory, syncInventoryCache, tryAddToInventory } from "../ecs/inventory";
import { ObjectManager } from "./object-manager";

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
import { queueStimulus, broadcastToRoom } from "../cognition/stimulus-queue";
import type { EffectDefinition, AffordanceDefinition, ComponentModification } from "./schema";
import { runOfficeTool } from "../office-tools/tool-registry";

export interface EffectContext {
  world: World;
  actorEid?: number;
  targetEid?: number;
  worldSchema: any; // WorldSchema instance
  registry: { byName: Map<string, number>; byId: Map<number, string> };
  /** Optional text payload passed from the action invocation (affordance arguments). */
  affordanceArgs?: string;
}

export interface EffectResult {
  success: boolean;
  message?: string;
  changes: string[];
}

function getTopActiveGoalEid(world: World, agentEid: number): number | undefined {
  const goals = getRelationTargets(world as any, agentEid, HasGoal as any)
    .filter((eid: number) => hasComponent(world as any, eid, Goal as any))
    .filter((eid: number) => String(Goal.status[eid] || "") === "active")
    .sort((a: number, b: number) => (Goal.priority[b] || 0) - (Goal.priority[a] || 0));
  const top = goals[0];
  return typeof top === "number" ? top : undefined;
}

function summarizeToolCommand(toolId: string, params: any): string {
  const id = String(toolId || "");

  // Terminal-like tools: prefer the literal command.
  if (id === "terminal.run") {
    const c = typeof params?.command === "string" ? params.command : (typeof params?.input === "string" ? params.input : "");
    return String(c || "").slice(0, 500);
  }

  // Multi-path apply tools: keep the whole allowlist string so contracts can match multiple files.
  if (id === "workspace.git_apply_from_last_gemini" || id === "workspace.git_apply") {
    const raw = typeof params?.command === "string" ? params.command : (typeof params?.input === "string" ? params.input : "");
    return String(raw || "").trim().slice(0, 500);
  }

  // Workspace tools: prefer the file path / fixture id rather than the full content payload.
  if (id.startsWith("workspace.")) {
    if (typeof params?.path === "string" && params.path.trim()) return params.path.trim();
    if (typeof params?.fixtureId === "string" && params.fixtureId.trim()) return params.fixtureId.trim();

    const raw = typeof params?.command === "string" ? params.command : (typeof params?.input === "string" ? params.input : "");
    const trimmed = String(raw || "").trim();
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && typeof obj.path === "string" && String(obj.path).trim()) return String(obj.path).trim();
        if (obj && typeof obj.fixtureId === "string" && String(obj.fixtureId).trim()) return String(obj.fixtureId).trim();
      } catch {
        // ignore
      }
    }

    // Plain format: first line (write_file) or first token (read/list).
    const firstLine = trimmed.split("\n")[0] || "";
    const token = firstLine.trim().split(/\s+/)[0] || "";
    return token.slice(0, 500);
  }

  // Default: keep a small summary of params for contract matching.
  try {
    const s = JSON.stringify(params ?? {});
    return s.length <= 500 ? s : s.slice(0, 500);
  } catch {
    return "";
  }
}

function recordToolEvidence(world: World, actorEid: number, deviceEid: number, toolId: string, params: any, result: any): void {
  const toolEid = addEntity(world as any);
  addComponent(world as any, toolEid, ToolResult as any);

  const cmd = summarizeToolCommand(toolId, params);
  ToolResult.toolId[toolEid] = String(toolId || "");
  ToolResult.command[toolEid] = String(cmd || "");
  ToolResult.ok[toolEid] = !!result?.ok;
  ToolResult.exitCode[toolEid] = Number.isFinite(Number(result?.exitCode)) ? Number(result.exitCode) : (result?.ok ? 0 : 1);
  ToolResult.summary[toolEid] = String(result?.summary || "");
  ToolResult.stdout[toolEid] = String(result?.stdout || "");
  ToolResult.stderr[toolEid] = String(result?.stderr || "");
  ToolResult.timestamp[toolEid] = Date.now();
  ToolResult.deviceEid[toolEid] = typeof deviceEid === "number" ? deviceEid : -1;

  const goalEid = getTopActiveGoalEid(world, actorEid);
  ToolResult.goalEid[toolEid] = typeof goalEid === "number" ? goalEid : -1;

  addComponent(world as any, actorEid, HasToolResult(toolEid) as any);

  // Keep the log bounded to avoid unbounded growth in long-running sims.
  const MAX_TOOL_RESULTS_PER_AGENT = 200;
  const all = getRelationTargets(world as any, actorEid, HasToolResult as any)
    .filter((eid: number) => hasComponent(world as any, eid, ToolResult as any))
    .filter((eid: number) => (ToolResult.timestamp[eid] || 0) > 0)
    .sort((a: number, b: number) => (ToolResult.timestamp[a] || 0) - (ToolResult.timestamp[b] || 0));
  const overflow = all.length - MAX_TOOL_RESULTS_PER_AGENT;
  if (overflow > 0) {
    for (const eid of all.slice(0, overflow)) {
      removeComponent(world as any, actorEid, HasToolResult(eid) as any);
      removeEntity(world as any, eid);
    }
  }
}

function getOrgGovernance(world: World): { eid: number; requireTicketForWork: boolean } | null {
  // Org governance is optional; we scan for an enabled config entity.
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    if (!hasComponent(world as any, eid, OrgGovernance as any)) continue;
    if (OrgGovernance.enabled[eid] === false) continue;
    return { eid, requireTicketForWork: OrgGovernance.requireTicketForWork[eid] === true };
  }
  return null;
}

function isWorkToolId(toolId: string): boolean {
  const id = String(toolId || "");
  if (id === "terminal.run") return true;
  if (id.startsWith("workspace.")) return true;
  if (id.startsWith("repo.")) return true;
  return false;
}

function actorHasOwnedInProgressTicket(world: World, actorEid: number): boolean {
  for (let eid = 0; eid < (Name.value as any).length; eid++) {
    if (!hasComponent(world as any, eid, KanbanCard as any)) continue;
    if (Number(KanbanCard.ownerEid[eid] ?? -1) !== Number(actorEid)) continue;
    const colEid = getDirectContainer(world, eid);
    if (colEid === undefined) continue;
    if (!hasComponent(world as any, colEid, KanbanColumn as any)) continue;
    const colName = String(Name.value[colEid] || KanbanColumn.name[colEid] || "");
    if (colName === "In Progress" || colName === "Review") return true;
  }
  return false;
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
function ensureCanonicalObjectState(world: World, eid: number): void {
  if (!hasComponent(world, eid, ObjectType) || !hasComponent(world, eid, ObjectState) || !hasComponent(world, eid, Traits)) {
    const meta = getDynamicComponentValues("ObjectMeta", eid);
    if (!meta) return;

    if (!hasComponent(world, eid, ObjectType) && meta.type) {
      addComponent(world, eid, ObjectType);
      ObjectType.typeId[eid] = meta.type;
      ObjectType.instanceName[eid] = Name.value[eid] || meta.type;
    }

    if (!hasComponent(world, eid, ObjectState) && meta.state) {
      addComponent(world, eid, ObjectState);
      ObjectState.current[eid] = meta.state;
      ObjectState.previous[eid] = "";
      ObjectState.lockedUntil[eid] = 0;
    }

    if (!hasComponent(world, eid, Traits) && meta.traits) {
      addComponent(world, eid, Traits);
      const traitsArray = meta.traits.split(",").map((t: string) => t.trim()).filter(Boolean);
      Traits.active[eid] = JSON.stringify(traitsArray);
    }
  }
}

function getTraits(world: World, eid: number): Set<string> {
  ensureCanonicalObjectState(world, eid);

  if (!hasComponent(world, eid, Traits)) return new Set();
  const traitsJson = Traits.active[eid];
  if (!traitsJson) return new Set();

  try {
    const traitsArray = JSON.parse(traitsJson) as string[];
    return new Set(traitsArray);
  } catch {
    return new Set();
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
export function getEffectiveActorTraits(world: World, actorEid: number, visited: Set<number> = new Set()): Set<string> {
  // Prevent infinite loops in case of circular containment
  if (visited.has(actorEid)) return new Set();
  visited.add(actorEid);

  // Start with actor's own traits
  const effectiveTraits = new Set(getTraits(world, actorEid));

  // Get direct contents of the actor (canonical: containment graph)
  const inventoryItems = listDirectContents(world, actorEid);

  // For each held item, collect its capability traits (traits starting with "has")
  for (const itemEid of inventoryItems) {
    const itemTraits = getTraits(world, itemEid);

    // Add capability traits from the item
    for (const trait of itemTraits) {
      if (trait.startsWith("has")) {
        effectiveTraits.add(trait);
      }
    }

    // Recursively check descendants (e.g., bag with key)
    const containedItems = listDirectContents(world, itemEid);
    for (const containedEid of containedItems) {
      const containedTraits = getEffectiveActorTraits(world, containedEid, visited);
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
function setTraits(world: World, eid: number, traits: Set<string>): void {
  const traitsArray = Array.from(traits);

  // Update ECS Traits component (primary)
  if (Traits?.active) {
    if (!hasComponent(world, eid, Traits)) addComponent(world, eid, Traits);
    Traits.active[eid] = JSON.stringify(traitsArray);
  }

  // Also update ObjectMeta for backwards compatibility
  ensureObjectMetaComponent();
  setDynamicComponentValue("ObjectMeta", eid, "traits", traitsArray.join(","));
}

/**
 * Recalculate traits based on object type and current state
 * Uses ECS ObjectType and ObjectState components as primary source
 */
function recalculateTraits(eid: number, ctx: EffectContext): void {
  ensureCanonicalObjectState(ctx.world, eid);

  const typeId = ObjectType?.typeId?.[eid];
  const currentState = ObjectState?.current?.[eid];

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
  if (process.env.DEBUG_RECALCULATE_TRAITS === "1") {

  console.log(`[recalculateTraits] eid=${eid}, type=${typeId}, state=${currentState}, traits=[${Array.from(traitSet).join(", ")}]`);
  }
  setTraits(ctx.world, eid, traitSet);
}

function substituteTemplate(
  template: string,
  world: World,
  eid: number,
  typeDef?: any
): string {
  let out = template;

  // Common substitutions
  out = out.replace(/\{name\}/g, Name.value[eid] || "");
  out = out.replace(/\{description\}/g, Description.value[eid] || "");
  out = out.replace(/\{role\}/g, Agent.role?.[eid] || "");
  out = out.replace(/\{ambience\}/g, Room.ambience?.[eid] || "");

  // ObjectProperties substitutions
  if (hasComponent(world, eid, ObjectProperties)) {
    const base: Record<string, string> = {
      adjective: ObjectProperties.adjective[eid] || "",
      material: ObjectProperties.material[eid] || "",
      color: ObjectProperties.color[eid] || "",
      size: ObjectProperties.size[eid] || "",
    };
    for (const [k, v] of Object.entries(base)) {
      if (v) out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v);
    }

    const customJson = ObjectProperties.custom[eid];
    if (customJson) {
      try {
        const custom = JSON.parse(customJson) as Record<string, string>;
        for (const [k, v] of Object.entries(custom)) {
          if (v) out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v);
        }
      } catch {
        // ignore
      }
    }
  }

  // Schema variable defaults
  if (typeDef?.variables) {
    for (const [key, def] of Object.entries(typeDef.variables as Record<string, any>)) {
      if (def?.default) {
        out = out.replace(new RegExp(`\\{${key}\\}`, "g"), String(def.default));
      }
    }
  }

  return out;
}

function ensureObjectMetaComponent(): void {
  if (getDynamicComponent("ObjectMeta")) return;
  createDynamicComponent({
    name: "ObjectMeta",
    description: "Legacy mirror of ObjectType/ObjectState/Traits for compatibility",
    properties: { type: "string", state: "string", traits: "string" },
  });
}

export function transitionObjectState(
  world: World,
  targetEid: number,
  newState: string,
  ctx: EffectContext,
  triggeredBy: string = "effect"
): { ok: boolean; oldState?: string; error?: string } {
  ensureCanonicalObjectState(world, targetEid);

  if (!hasComponent(world, targetEid, ObjectState) || !hasComponent(world, targetEid, ObjectType)) {
    return { ok: false, error: "Target missing ObjectState/ObjectType" };
  }

  const typeId = ObjectType.typeId[targetEid];
  const typeDef = ctx.worldSchema?.getObjectType(typeId);
  if (typeDef && !typeDef.states?.[newState]) {
    const oldState = ObjectState.current[targetEid];
    return {
      ok: false,
      oldState,
      error: `Invalid state '${newState}' for type '${typeId}'. Available: ${Object.keys(typeDef.states || {}).join(", ")}`,
    };
  }

  const oldState = ObjectState.current[targetEid];
  ObjectState.previous[targetEid] = oldState;
  ObjectState.current[targetEid] = newState;

  // Update legacy mirror
  ensureObjectMetaComponent();
  setDynamicComponentValue("ObjectMeta", targetEid, "state", newState);

  // Recalculate traits
  recalculateTraits(targetEid, ctx);

  // Update description from schema state (unless dynamically overridden)
  const stateDef = typeDef?.states?.[newState];

  if (stateDef?.description && !hasComponent(world, targetEid, DynamicDescription)) {
    Description.value[targetEid] = substituteTemplate(stateDef.description, world, targetEid, typeDef);
  }

  // Update StimulusSource from state stimuli (simple: pick strongest)
  const stimuli: any[] = Array.isArray(stateDef?.stimuli) ? stateDef.stimuli : [];
  if (stimuli.length === 0) {
    if (hasComponent(world, targetEid, StimulusSource)) {
      removeComponent(world, targetEid, StimulusSource);
    }
  } else {
    const primary = stimuli.reduce((best, curr) => (curr.intensity ?? 0.5) > (best.intensity ?? 0.5) ? curr : best);
    if (!hasComponent(world, targetEid, StimulusSource)) {
      addComponent(world, targetEid, StimulusSource);
    }
    StimulusSource.stimulusType[targetEid] = primary.type;
    StimulusSource.template[targetEid] = substituteTemplate(primary.template, world, targetEid, typeDef);
    StimulusSource.interval[targetEid] = primary.interval ?? 5000;
    StimulusSource.lastEmit[targetEid] = 0;
  }

  // Record transition marker (optional)
  if (!hasComponent(world, targetEid, StateTransition)) {
    addComponent(world, targetEid, StateTransition);
  }
  StateTransition.targetState[targetEid] = newState;
  StateTransition.triggeredBy[targetEid] = triggeredBy;
  StateTransition.timestamp[targetEid] = Date.now();

  return { ok: true, oldState };
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
    const ecsComponent = ECS_COMPONENTS[comp];
    const dynamicComponent = ecsComponent ? null : getDynamicComponent(comp);
    const currentValue =
      ecsComponent && (prop in ecsComponent) ? ecsComponent[prop]?.[targetEid] :
      dynamicComponent ? dynamicComponent[prop]?.[targetEid] :
      undefined;

    if (currentValue === undefined) {
      return { success: false, message: `Component/property not found: ${comp}.${prop}`, changes: [] };
    }
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
          if (!hasComponent(ctx.world, targetEid, ecsComponent)) {
            addComponent(ctx.world, targetEid, ecsComponent);
          }
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

      const result = transitionObjectState(ctx.world, targetEid, effect.state, ctx, "effect:set_state");
      if (!result.ok) {
        return { success: false, message: result.error || "Invalid state transition", changes: [] };
      }

      changes.push(`state: ${result.oldState} -> ${effect.state}`);
      break;
    }

    case "add_trait": {
      if (targetEid === undefined || !effect.trait) {
        return { success: false, message: "Target or trait not specified", changes: [] };
      }

      const traits = getTraits(ctx.world, targetEid);
      traits.add(effect.trait);
      setTraits(ctx.world, targetEid, traits);
      changes.push(`+trait: ${effect.trait}`);
      break;
    }

    case "remove_trait": {
      if (targetEid === undefined || !effect.trait) {
        return { success: false, message: "Target or trait not specified", changes: [] };
      }

      const traits = getTraits(ctx.world, targetEid);
      traits.delete(effect.trait);
      setTraits(ctx.world, targetEid, traits);
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
          const roomEid = getRoomForEntity(ctx.world, ctx.actorEid);
          if (roomEid !== undefined) {
            broadcastToRoom(ctx.world, roomEid, {
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
      if (!effect.spawnType) {
        return { success: false, message: "spawnType not specified", changes: [] };
      }

      const manager = new ObjectManager(ctx.world);

      // Determine spawn container: explicit containerName if provided; else actor room; else target room.
      let containerEid: number | undefined;
      if (effect.containerName) {
        containerEid = resolveTarget(effect.containerName, ctx);
        if (containerEid === undefined && effect.containerName === "room") {
          containerEid = ctx.actorEid !== undefined ? getRoomForEntity(ctx.world, ctx.actorEid) : undefined;
        }
      }
      if (containerEid === undefined && ctx.actorEid !== undefined) {
        containerEid = getRoomForEntity(ctx.world, ctx.actorEid);
      }
      if (containerEid === undefined && ctx.targetEid !== undefined) {
        containerEid = getRoomForEntity(ctx.world, ctx.targetEid);
      }

      const state = typeof (effect.spawnProperties as any)?.state === "string" ? (effect.spawnProperties as any).state : undefined;
      const eid = manager.spawn(effect.spawnType, {
        name: effect.spawnName,
        state,
        properties: effect.spawnProperties,
        containedIn: containerEid,
      });

      if (eid === null) {
        return { success: false, message: `Failed to spawn type: ${effect.spawnType}`, changes: [] };
      }

      const spawnedName = Name.value[eid] || effect.spawnName || `${effect.spawnType}#${eid}`;
      ctx.registry.byName.set(spawnedName, eid);
      ctx.registry.byId.set(eid, spawnedName);

      changes.push(`spawned: ${spawnedName} (${effect.spawnType})`);
      if (containerEid !== undefined) {
        const containerName = Name.value[containerEid] || `entity:${containerEid}`;
        changes.push(`locatedIn: ${containerName}`);
      }
      break;
    }

    case "add_relation":
    case "remove_relation": {
      if (!effect.relation) {
        return { success: false, message: "relation not specified", changes: [] };
      }

      const subjectEid = resolveTarget(effect.target, ctx);
      if (subjectEid === undefined) {
        return { success: false, message: "Subject not found", changes: [] };
      }

      const relatedEid = effect.relatedEntity ? resolveTarget(effect.relatedEntity, ctx) : undefined;
      if (relatedEid === undefined) {
        return { success: false, message: "relatedEntity not found", changes: [] };
      }

      const rel = (AllRelations as any)[effect.relation];
      if (!rel) {
        return { success: false, message: `Unknown relation: ${effect.relation}`, changes: [] };
      }

      if (effect.type === "add_relation") {
        addComponent(ctx.world, subjectEid, rel(relatedEid));
        changes.push(`+relation: ${effect.relation} -> ${Name.value[relatedEid] || `entity:${relatedEid}`}`);
      } else {
        removeComponent(ctx.world, subjectEid, rel(relatedEid));
        changes.push(`-relation: ${effect.relation} -> ${Name.value[relatedEid] || `entity:${relatedEid}`}`);
      }
      break;
    }

    case "run_tool": {
      if (!effect.toolId) {
        return { success: false, message: "toolId not specified", changes: [] };
      }
      if (ctx.actorEid === undefined) {
        return { success: false, message: "Actor required for run_tool", changes: [] };
      }
      if (targetEid === undefined) {
        return { success: false, message: "Target/device not found for run_tool", changes: [] };
      }

      // Optional org governance gate: require an owned in-progress ticket before doing "work" tools.
      const gov = getOrgGovernance(ctx.world);
      if (gov?.requireTicketForWork && isWorkToolId(effect.toolId)) {
        if (!actorHasOwnedInProgressTicket(ctx.world, ctx.actorEid)) {
          return {
            success: false,
            message: `Org policy: cannot run ${effect.toolId} without an owned ticket in "In Progress" (claim a card first)`,
            changes: [],
          };
        }
      }

      const inputFrom = effect.toolInputFrom || "affordanceArgs";
      const rawArgs = (ctx.affordanceArgs || "").trim();
      let params: any;

      if (inputFrom === "static") {
        params = effect.toolInput ?? {};
      } else if (inputFrom === "affordanceArgsJson") {
        try {
          params = rawArgs ? JSON.parse(rawArgs) : {};
        } catch (e) {
          return { success: false, message: `Invalid JSON tool params: ${rawArgs.slice(0, 120)}`, changes: [] };
        }
      } else {
        // affordanceArgs: provide both `input` and `command` so tools can choose a convention.
        params = { input: rawArgs, command: rawArgs };
      }

      const result = runOfficeTool(effect.toolId, params, {
        world: ctx.world,
        actorEid: ctx.actorEid,
        deviceEid: targetEid,
      });

      // Async tools: return immediately and let OfficeToolJobSystem publish tool_result + evidence on completion.
      if (result.pending && result.jobId) {
        const recipient = resolveTarget(effect.toolResultTarget || "actor", ctx);
        if (recipient !== undefined) {
          queueStimulus({
            targetEid: recipient,
            type: effect.toolResultType || "tool_result",
            content: `[Tool:${effect.toolId}] ${result.summary}`,
            source: Name.value[targetEid] || effect.toolId,
            modality: "cognitive",
          });
        }
        changes.push(`tool: ${effect.toolId}`);
        changes.push(`tool_job: ${result.jobId}`);
        break;
      }

      // Record tool evidence in ECS (deterministic, grounded).
      // This allows goal success criteria to be evaluated from ECS state (not just prompt text).
      if (ctx.actorEid !== undefined) {
        if (!hasComponent(ctx.world as any, ctx.actorEid, LastToolResult as any)) addComponent(ctx.world as any, ctx.actorEid, LastToolResult as any);
        LastToolResult.toolId[ctx.actorEid] = effect.toolId;
        LastToolResult.command[ctx.actorEid] = summarizeToolCommand(effect.toolId, params);
        LastToolResult.ok[ctx.actorEid] = !!result.ok;
        LastToolResult.exitCode[ctx.actorEid] = Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : (result.ok ? 0 : 1);
        LastToolResult.summary[ctx.actorEid] = String(result.summary || "");
        LastToolResult.stdout[ctx.actorEid] = String(result.stdout || "");
        LastToolResult.stderr[ctx.actorEid] = String(result.stderr || "");
        LastToolResult.timestamp[ctx.actorEid] = Date.now();

        recordToolEvidence(ctx.world, ctx.actorEid, targetEid, effect.toolId, params, result);
      }

      const recipient = resolveTarget(effect.toolResultTarget || "actor", ctx);
      if (recipient !== undefined) {
        const stdout = result.stdout ? String(result.stdout) : "";
        const stderr = result.stderr ? String(result.stderr) : "";

        const maxLen = 1600;
        const clip = (s: string) => (s.length > maxLen ? s.slice(0, maxLen) + "\n…(truncated)" : s);

        const parts: string[] = [];
        parts.push(`[Tool:${effect.toolId}] ${result.summary}`);
        if (stdout.trim()) parts.push(`stdout:\n${clip(stdout)}`);
        if (stderr.trim()) parts.push(`stderr:\n${clip(stderr)}`);

        queueStimulus({
          targetEid: recipient,
          type: effect.toolResultType || "tool_result",
          content: parts.join("\n\n"),
          source: Name.value[targetEid] || effect.toolId,
          modality: "cognitive",
        });
      }

      changes.push(`tool: ${effect.toolId}`);

      const failOnToolError = effect.failOnToolError !== false;
      if (!result.ok && failOnToolError) return { success: false, message: result.summary, changes };
      break;
    }

    case "transfer": {
      if (targetEid === undefined) {
        return { success: false, message: "Target not found", changes: [] };
      }

      if (!effect.containerName) {
        return { success: false, message: "containerName not specified", changes: [] };
      }

      let containerEid = resolveTarget(effect.containerName, ctx);
      if (containerEid === undefined && effect.containerName === "room") {
        containerEid = ctx.actorEid !== undefined ? getRoomForEntity(ctx.world, ctx.actorEid) : undefined;
      }
      if (containerEid === undefined) {
        return { success: false, message: `Container not found: ${effect.containerName}`, changes: [] };
      }

      const prev = getDirectContainer(ctx.world, targetEid);
      if (hasInventory(ctx.world, containerEid)) {
        const res = tryAddToInventory(ctx.world, containerEid, targetEid);
        if (!res.success) {
          return { success: false, message: res.reason, changes: [] };
        }
      } else {
        setLocatedIn(ctx.world, targetEid, containerEid);
        if (prev !== undefined) syncInventoryCache(ctx.world, prev);
        syncInventoryCache(ctx.world, containerEid);
      }

      const prevName = prev !== undefined ? (Name.value[prev] || `entity:${prev}`) : "nowhere";
      const nextName = Name.value[containerEid] || `entity:${containerEid}`;
      changes.push(`locatedIn: ${prevName} -> ${nextName}`);
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
  world: World,
  affordance: AffordanceDefinition,
  actorEid: number,
  targetEid: number
): { available: boolean; reason?: string } {
  // Grounding for canonical containment:
  // - take: only if target is directly in the actor's room (on the ground) and not already held
  // - drop: only if target is directly located in the actor
  if (affordance.name === "take") {
    const actorRoom = getRoomForEntity(world, actorEid);
    const targetContainer = getDirectContainer(world, targetEid);
    if (actorRoom === undefined) return { available: false, reason: "Actor is not in a room" };
    if (targetContainer === actorEid) return { available: false, reason: "Target is already held" };
    if (targetContainer !== actorRoom) return { available: false, reason: "Target is not directly accessible here" };
  }

  if (affordance.name === "drop") {
    const targetContainer = getDirectContainer(world, targetEid);
    if (targetContainer !== actorEid) return { available: false, reason: "You are not holding that" };
  }

  const targetTraits = getTraits(world, targetEid);
  // Use DYNAMIC resolution for actor - capabilities come from held items
  const actorTraits = getEffectiveActorTraits(world, actorEid);

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

  // Robustness: callers (including LLM-planned "interact" content) sometimes include punctuation
  // around affordance names (e.g. "run_command:"), so normalize before lookup/variant matching.
  const normalizedAffordanceName = String(affordanceName || "")
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[^\p{L}\p{N}_-]+$/gu, "");

  // Try to find a usable affordance - first exact match, then variants
  let affordance = ctx.worldSchema?.getAffordance(normalizedAffordanceName);
  let check = affordance ? canUseAffordance(ctx.world, affordance, ctx.actorEid, ctx.targetEid) : null;

  // If exact match fails due to requirements, try variant affordances (e.g., "unlock_toolbox")
  if (!affordance || (check && !check.available)) {
    const allAffordances = ctx.worldSchema?.getAllAffordances() || [];
    const variants = allAffordances.filter((a: AffordanceDefinition) =>
      a.name.startsWith(`${normalizedAffordanceName}_`) || a.name.endsWith(`_${normalizedAffordanceName}`)
    );

    for (const variant of variants) {
      const variantCheck = canUseAffordance(ctx.world, variant, ctx.actorEid, ctx.targetEid);
      if (variantCheck.available) {
        console.log(`[Affordance] Found usable variant: ${variant.name} (instead of ${normalizedAffordanceName})`);
        affordance = variant;
        check = variantCheck;
        break;
      }
    }
  }

  if (!affordance) {
    return { success: false, message: `Unknown affordance: ${normalizedAffordanceName || affordanceName}`, changes: [] };
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
    ensureCanonicalObjectState(ctx.world, ctx.targetEid);
    const currentState = ObjectState?.current?.[ctx.targetEid];
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
    const roomEid = ctx.actorEid !== undefined ? getRoomForEntity(ctx.world, ctx.actorEid) : undefined;

    if (roomEid !== undefined) {
      broadcastToRoom(ctx.world, roomEid, {
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
