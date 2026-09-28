/** Shared native object-state projection. Kept independent of action selection
 * and location mutation so physical commits can reuse the executor's complete
 * state/trait/description/stimulus update without a cognition import cycle. */
import { addComponent, hasComponent, removeComponent } from "bitecs";
import type { World } from "../ecs/world";
import { Agent, Description, DynamicDescription, Name, ObjectProperties, ObjectState, ObjectType, Room, StateTransition, StimulusSource, Traits } from "../ecs/components";
import { createDynamicComponent, getDynamicComponent, getDynamicComponentValues, setDynamicComponentValue } from "../ecs/dynamic-components";
import { stampObjectStateTime } from "./object-state-time";

export interface ObjectStateContext { world: World; worldSchema: any }

/** Instance-authored visible details are distinct from a type's state prose.
 * Reuse the existing persisted override component so opening a marked chest
 * cannot erase its marks. Physical state/traits remain independently owned. */
export function setObjectDescription(world: World, eid: number, description: string, updatedBy = "system"): void {
  if (!hasComponent(world, eid, Description)) addComponent(world, eid, Description);
  if (!hasComponent(world, eid, DynamicDescription)) addComponent(world, eid, DynamicDescription);
  DynamicDescription.text[eid] = description;
  DynamicDescription.lastUpdated[eid] = Date.now();
  DynamicDescription.updatedBy[eid] = updatedBy;
  Description.value[eid] = description;
}

export function ensureCanonicalObjectState(world: World, eid: number): void {
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
      // Legacy mirror promotion has no known earlier physical state age.
      stampObjectStateTime(world, eid);
    }

    if (!hasComponent(world, eid, Traits) && meta.traits) {
      addComponent(world, eid, Traits);
      const traitsArray = meta.traits.split(",").map((t: string) => t.trim()).filter(Boolean);
      Traits.active[eid] = JSON.stringify(traitsArray);
    }
  }
}

/**
 * Set traits on an entity
 * Updates both the ECS Traits component and ObjectMeta for compatibility
 */
export function setTraits(world: World, eid: number, traits: Set<string>): void {
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
function recalculateTraits(eid: number, ctx: ObjectStateContext): void {
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
  ctx: ObjectStateContext,
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
  stampObjectStateTime(world, targetEid, oldState);

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
