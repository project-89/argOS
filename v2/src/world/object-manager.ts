/**
 * ObjectManager - Handles spawning, state transitions, and queries for world objects
 *
 * This bridges the WorldSchema (prefabs/definitions) with the ECS (runtime entities).
 */

import { removeEntity, addComponent, removeComponent, hasComponent, query } from "bitecs";
import { computeObjectTypeTraits } from "./object-type-traits";
import { stampObjectStateTime } from "./object-state-time";
import { setObjectDescription } from "./object-state";
import {
  Name,
  Description,
  Position,
  GridPosition,
  ObjectType,
  ObjectState,
  Traits,
  PhysicalObject,
  Durability,
  Fuel,
  Container,
  Surface,
  Portal,
  LightSource,
  DynamicDescription,
  ObjectProperties,
  StateTransition,
  StimulusSource,
} from "../ecs/components";
import { LocatedIn } from "../ecs/relations";
import { setLocatedIn } from "../ecs/location";
import { allocateWorldEntity, assertWorldConstructionAvailable } from "../runtime/world-construction-budget";
import { getRegistryEntry, registryCreateComponent, validateComponentInitialValues } from "../ecs/component-registry";
import type { ComponentDefinition } from "../ecs/dynamic-components";
import { PRIVATE_MANAGED_COMPONENTS } from "../engineering/contracts";
import { isWorldOfficeToolAllowed } from "../office-tools/tool-registry";
import { worldSchema, OnTopOf, OccupiedBy, type ObjectTypeDefinition, type StimulusDefinition } from "./schema";

const invalidStateTransitionWarned = new Set<string>();

export interface SpawnOptions {
  /** Position in the world */
  position?: { x: number; y: number };
  /** Room/container to spawn in */
  containedIn?: number;
  /** Surface to spawn on */
  onTopOf?: number;
  /** Custom name override */
  name?: string;
  /** Custom description override */
  description?: string;
  /** Initial state (defaults to type's defaultState) */
  state?: string;
  /** Properties for description templates */
  properties?: {
    adjective?: string;
    material?: string;
    color?: string;
    size?: string;
    [key: string]: string | undefined;
  };
  /** Additional component data */
  components?: Record<string, any>;
}

export interface ObjectInfo {
  eid: number;
  typeId: string;
  name: string;
  state: string;
  description: string;
  traits: string[];
  position?: { x: number; y: number };
  containedIn?: number;
}

export interface ObjectComponentPlan {
  definition: ComponentDefinition;
  values: Record<string, unknown>;
  initial: Record<string, string | number | boolean>;
  register: boolean;
}

export class ObjectManager {
  private world: any; // bitECS world
  private entityTypeMap: Map<number, string> = new Map();

  constructor(world: any) {
    this.world = world;
  }

  /**
   * Spawn an object from a type definition
   */
  spawn(typeId: string, options: SpawnOptions = {}): number | null {
    const typeDef = worldSchema.getObjectType(typeId);
    if (!typeDef) {
      console.error(`Unknown object type: ${typeId}`);
      return null;
    }

    let components: ObjectComponentPlan[];
    try {
      // Validate the entire request before registering schemas or allocating an
      // entity. A later invalid component cannot leave a half-created prop.
      components = ObjectManager.prepareComponentSpecs(typeDef, options.components);
      assertWorldConstructionAvailable(this.world);
      for (const component of components) if (component.register) registryCreateComponent(component.definition);
    } catch (error) {
      console.error(`[ObjectManager] Cannot spawn ${typeId}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    const eid = allocateWorldEntity(this.world, "object");
    this.entityTypeMap.set(eid, typeId);

    // Set ObjectType
    addComponent(this.world, eid, ObjectType);
    ObjectType.typeId[eid] = typeId;
    ObjectType.instanceName[eid] = options.name || this.generateName(typeDef, options);

    // Set initial state
    const initialState = options.state || typeDef.defaultState;
    addComponent(this.world, eid, ObjectState);
    ObjectState.current[eid] = initialState;
    ObjectState.previous[eid] = "";
    ObjectState.lockedUntil[eid] = 0;

    // Compute initial traits from type + state
    const traits = computeObjectTypeTraits(typeDef, initialState);
    addComponent(this.world, eid, Traits);
    Traits.active[eid] = JSON.stringify(traits);

    // Set Name component
    addComponent(this.world, eid, Name);
    Name.value[eid] = ObjectType.instanceName[eid];

    // Set Description
    const description = options.description || this.generateDescription(typeDef, initialState, options);
    addComponent(this.world, eid, Description);
    Description.value[eid] = description;
    if (options.description) setObjectDescription(this.world, eid, options.description, "author");

    // Mark as a physical object so it participates in grounded queries/actions.
    addComponent(this.world, eid, PhysicalObject);
    PhysicalObject.material[eid] = options.properties?.material || "unknown";
    PhysicalObject.weight[eid] = 1;
    PhysicalObject.portable[eid] = traits.includes("takeable");

    // Set properties for template substitution
    if (options.properties) {
      addComponent(this.world, eid, ObjectProperties);
      ObjectProperties.adjective[eid] = options.properties.adjective || "";
      ObjectProperties.material[eid] = options.properties.material || "";
      ObjectProperties.color[eid] = options.properties.color || "";
      ObjectProperties.size[eid] = options.properties.size || "";
      ObjectProperties.custom[eid] = JSON.stringify(
        Object.fromEntries(
          Object.entries(options.properties).filter(
            ([k]) => !["adjective", "material", "color", "size"].includes(k)
          )
        )
      );
    }

    // Set position if provided
    if (options.position) {
      addComponent(this.world, eid, GridPosition);
      GridPosition.x[eid] = options.position.x;
      GridPosition.y[eid] = options.position.y;
      GridPosition.facing[eid] = "down";
    }

    // Set containment relation
    if (options.containedIn !== undefined) {
      setLocatedIn(this.world, eid, options.containedIn);
    }

    // If spawning into a container/room and no explicit position was provided,
    // inherit the container's GridPosition so agents can navigate to the object.
    if (!options.position && options.containedIn !== undefined) {
      const containerEid = options.containedIn;
      if (hasComponent(this.world, containerEid, GridPosition) && !hasComponent(this.world, eid, GridPosition)) {
        addComponent(this.world, eid, GridPosition);
        GridPosition.x[eid] = GridPosition.x[containerEid] + Math.floor(Math.random() * 3) - 1;
        GridPosition.y[eid] = GridPosition.y[containerEid] + Math.floor(Math.random() * 3) - 1;
        GridPosition.facing[eid] = "down";
      }
    }

    // Set surface relation
    if (options.onTopOf !== undefined) {
      addComponent(this.world, eid, OnTopOf(options.onTopOf));
    }

    // Handle container type
    if (typeDef.isContainer) {
      addComponent(this.world, eid, Container);
      Container.capacity[eid] = typeDef.containerCapacity || 10;
      Container.currentCount[eid] = 0;
      Container.allowedTypes[eid] = "";
    }

    // Surface is a physical capability, not just a word in a description.
    if (traits.includes("surface")) {
      addComponent(this.world, eid, Surface);
      Surface.capacity[eid] = typeDef.containerCapacity || 10;
      Surface.currentCount[eid] = 0;
    }

    // Handle type-specific components
    if (typeDef.category === "lighting") {
      addComponent(this.world, eid, LightSource);
      LightSource.intensity[eid] = 1;
      LightSource.radius[eid] = 5;
      LightSource.color[eid] = "warm";
    }

    if (traits.includes("portal")) {
      addComponent(this.world, eid, Portal);
      Portal.destinationRoom[eid] = 0;
      Portal.bidirectional[eid] = true;
    }

    // Set up StimulusSource based on state's stimuli (DYNAMIC PERCEPTION)
    this.setupStimuliForState(eid, typeDef, initialState, options.properties);

    for (const plan of components) {
      const component = getRegistryEntry(plan.definition.name)!.soa;
      const values = hasComponent(this.world, eid, component) ? plan.values : plan.initial;
      addComponent(this.world, eid, component);
      for (const [field, value] of Object.entries(values)) component[field][eid] = value;
    }

    stampObjectStateTime(this.world, eid);
    return eid;
  }

  /**
   * Set up StimulusSource component based on state's stimuli definitions
   */
  private setupStimuliForState(
    eid: number,
    typeDef: ObjectTypeDefinition,
    state: string,
    properties?: Record<string, string | undefined>
  ): void {
    const stateDef = typeDef.states[state];
    if (!stateDef) return;

    // Get stimuli from state definition (prefer new stimuli array over legacy emitsStimulus)
    const stimuli = [...(stateDef.stimuli || [])];

    // Also check legacy emitsStimulus and convert if no new stimuli
    if (stimuli.length === 0 && stateDef.emitsStimulus) {
      stimuli.push({
        type: stateDef.emitsStimulus.type as any,
        template: stateDef.description,
        intensity: stateDef.emitsStimulus.intensity,
        radius: stateDef.emitsStimulus.radius,
      });
    }

    if (stimuli.length === 0) {
      // No stimuli - remove component if it exists
      if (hasComponent(this.world, eid, StimulusSource)) {
        removeComponent(this.world, eid, StimulusSource);
      }
      return;
    }

    // For now, use the highest-intensity stimulus as the primary one
    // Future: Support multiple StimulusSource components per entity
    const primaryStimulus = stimuli.reduce((best, curr) =>
      (curr.intensity || 0.5) > (best.intensity || 0.5) ? curr : best
    );

    // Substitute variables in template
    let template = primaryStimulus.template;
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (value) {
          template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
      }
    }
    // Also substitute from type variables defaults
    if (typeDef.variables) {
      for (const [key, varDef] of Object.entries(typeDef.variables)) {
        if (varDef.default) {
          template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), varDef.default);
        }
      }
    }

    addComponent(this.world, eid, StimulusSource);
    StimulusSource.stimulusType[eid] = primaryStimulus.type;
    StimulusSource.template[eid] = template;
    StimulusSource.interval[eid] = primaryStimulus.interval || 5000;
    StimulusSource.lastEmit[eid] = 0;

    // Store all stimuli as JSON for systems that want full multi-sensory data
    // This can be read by enhanced perception systems
    const allStimuliJson = JSON.stringify(stimuli.map(s => ({
      ...s,
      template: this.substituteVariables(s.template, properties, typeDef.variables),
    })));
    // TODO: Add a MultiStimuli component or extend StimulusSource to hold this
  }

  /**
   * Substitute variables in a template string
   */
  private substituteVariables(
    template: string,
    properties?: Record<string, string | undefined>,
    typeVariables?: Record<string, { type: string; default?: string; options?: string[] }>
  ): string {
    let result = template;
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (value) {
          result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
      }
    }
    if (typeVariables) {
      for (const [key, varDef] of Object.entries(typeVariables)) {
        if (varDef.default) {
          result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), varDef.default);
        }
      }
    }
    return result;
  }

  /**
   * Resolve declared component schemas and explicit overrides without mutation.
   */
  static prepareComponentSpecs(typeDef: ObjectTypeDefinition, additional: SpawnOptions["components"]): ObjectComponentPlan[] {
    const plans = new Map<string, ObjectComponentPlan>();
    const identifier = (name: unknown): name is string => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)
      && !["constructor", "prototype", "__proto__"].includes(name);
    const assertPhysicalComponent = (name: string) => {
      if (PRIVATE_MANAGED_COMPONENTS.has(name) || ["WorkingMemoryIdentity", "WorldClock", "EquipSlot", "Room"].includes(name))
        throw new Error(`Object component ${name} requires a separate host capability`);
    };
    const valueRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    if (typeDef.defaultComponents !== undefined && (!Array.isArray(typeDef.defaultComponents) || typeDef.defaultComponents.length > 32))
      throw new Error("Expected at most 32 default component specs");
    for (const spec of typeDef.defaultComponents ?? []) {
      if (!spec || !identifier(spec.name) || !valueRecord(spec.values)) throw new Error("Invalid component spec");
      assertPhysicalComponent(spec.name);
      if (plans.has(spec.name)) throw new Error(`Duplicate component ${spec.name}`);
      const entry = getRegistryEntry(spec.name);
      let declared: ComponentDefinition | undefined;
      if (spec.schema !== undefined) {
        if (!valueRecord(spec.schema) || Object.keys(spec.schema).length < 1 || Object.keys(spec.schema).length > 32
          || Object.entries(spec.schema).some(([field, kind]) => !identifier(field) || !["number", "string", "boolean"].includes(String(kind))))
          throw new Error(`Invalid declared schema ${spec.name}`);
        declared = { name: spec.name, description: `Declared by object type ${typeDef.name}`,
          properties: { ...spec.schema } as ComponentDefinition["properties"] };
      }
      if (entry) {
        if (!entry.definition) throw new Error(`Missing canonical schema ${spec.name}`);
        if (spec.dynamic && entry.isStatic) throw new Error(`Cannot redefine built-in component ${spec.name}`);
        if (declared) {
          const canonical = entry.definition.properties;
          if (Object.keys(canonical).length !== Object.keys(declared.properties).length
            || Object.entries(declared.properties).some(([field, kind]) => {
              const fieldSchema: any = Object.hasOwn(canonical, field) ? canonical[field] : undefined;
              return kind !== (typeof fieldSchema === "string" ? fieldSchema : fieldSchema?.type);
            })) throw new Error(`Schema conflict for component ${spec.name}`);
        }
      } else if (!spec.dynamic || !declared) throw new Error(`Unknown component ${spec.name}: an explicit dynamic schema is required`);
      const definition = entry?.definition ?? declared!;
      const initial = validateComponentInitialValues(definition, spec.values);
      plans.set(spec.name, { definition, values: { ...spec.values }, initial, register: !entry });
    }
    if (additional !== undefined) {
      if (!valueRecord(additional)) throw new Error("Invalid additional components");
      for (const [name, values] of Object.entries(additional)) {
        if (!identifier(name) || !valueRecord(values)) throw new Error(`Invalid component values: ${name}`);
        assertPhysicalComponent(name);
        const existing = plans.get(name), entry = getRegistryEntry(name);
        const definition = existing?.definition ?? entry?.definition;
        if (!definition) throw new Error(`Unknown component ${name}: additional values cannot declare a schema`);
        const merged = { ...existing?.values, ...values };
        plans.set(name, { definition, values: merged, initial: validateComponentInitialValues(definition, merged), register: existing?.register ?? false });
      }
    }
    if (plans.size > 32) throw new Error("Expected at most 32 components per object");
    return [...plans.values()];
  }

  /**
   * Spawn a one-off entity without a prefab
   */
  spawnCustom(config: {
    name: string;
    description: string;
    traits: string[];
    state?: string;
    position?: { x: number; y: number };
    containedIn?: number;
  }): number {
    const eid = allocateWorldEntity(this.world, "object");
    this.entityTypeMap.set(eid, "_custom");

    addComponent(this.world, eid, ObjectType);
    ObjectType.typeId[eid] = "_custom";
    ObjectType.instanceName[eid] = config.name;

    addComponent(this.world, eid, Name);
    Name.value[eid] = config.name;

    addComponent(this.world, eid, Description);
    setObjectDescription(this.world, eid, config.description, "author");

    addComponent(this.world, eid, PhysicalObject);
    PhysicalObject.material[eid] = "unknown";
    PhysicalObject.weight[eid] = 1;
    PhysicalObject.portable[eid] = config.traits.includes("takeable");

    addComponent(this.world, eid, Traits);
    Traits.active[eid] = JSON.stringify(config.traits);

    addComponent(this.world, eid, ObjectState);
    ObjectState.current[eid] = config.state || "normal";
    ObjectState.previous[eid] = "";
    ObjectState.lockedUntil[eid] = 0;
    stampObjectStateTime(this.world, eid);

    if (config.position) {
      addComponent(this.world, eid, GridPosition);
      GridPosition.x[eid] = config.position.x;
      GridPosition.y[eid] = config.position.y;
      GridPosition.facing[eid] = "down";
    }

    if (config.containedIn !== undefined) {
      setLocatedIn(this.world, eid, config.containedIn);
    }

    if (!config.position && config.containedIn !== undefined) {
      const containerEid = config.containedIn;
      if (hasComponent(this.world, containerEid, GridPosition) && !hasComponent(this.world, eid, GridPosition)) {
        addComponent(this.world, eid, GridPosition);
        GridPosition.x[eid] = GridPosition.x[containerEid] + Math.floor(Math.random() * 3) - 1;
        GridPosition.y[eid] = GridPosition.y[containerEid] + Math.floor(Math.random() * 3) - 1;
        GridPosition.facing[eid] = "down";
      }
    }

    return eid;
  }

  /**
   * Transition an object to a new state
   */
  transitionState(eid: number, newState: string, triggeredBy: string = "system"): boolean {
    if (!hasComponent(this.world, eid, ObjectState)) {
      return false;
    }

    const typeId = ObjectType.typeId[eid];
    const typeDef = worldSchema.getObjectType(typeId);

    // Validate state exists (unless custom object)
    if (typeDef && !typeDef.states[newState]) {
      // LLM-generated rules/systems can propose invalid states; avoid log-spam under tick-driven rules.
      // Keep semantics grounded: do not transition if the state isn't part of the object type definition.
      const key = `${typeId}::${newState}`;
      if (!invalidStateTransitionWarned.has(key)) {
        invalidStateTransitionWarned.add(key);
        console.warn(`Invalid state '${newState}' for type '${typeId}'`);
      }
      return false;
    }

    const currentState = ObjectState.current[eid];
    ObjectState.previous[eid] = currentState;
    ObjectState.current[eid] = newState;
    stampObjectStateTime(this.world, eid, currentState);

    // Update traits based on new state
    if (typeDef) {
      const newTraits = computeObjectTypeTraits(typeDef, newState);
      Traits.active[eid] = JSON.stringify(newTraits);

      // Update description if no dynamic override
      if (!hasComponent(this.world, eid, DynamicDescription)) {
        const desc = this.generateDescription(typeDef, newState, {
          properties: this.getProperties(eid),
        });
        Description.value[eid] = desc;
      }

      // Update stimuli for new state (DYNAMIC PERCEPTION)
      // When state changes, what the entity emits changes too
      this.setupStimuliForState(eid, typeDef, newState, this.getProperties(eid));
    }

    return true;
  }

  /**
   * Set a dynamic description (overrides type-based description)
   */
  setDescription(eid: number, description: string, updatedBy: string = "system"): void {
    setObjectDescription(this.world, eid, description, updatedBy);
  }

  /**
   * Add a trait to an entity
   */
  addTrait(eid: number, trait: string): void {
    if (!hasComponent(this.world, eid, Traits)) {
      addComponent(this.world, eid, Traits);
      Traits.active[eid] = "[]";
    }
    const traits = JSON.parse(Traits.active[eid]) as string[];
    if (!traits.includes(trait)) {
      traits.push(trait);
      Traits.active[eid] = JSON.stringify(traits);
    }
  }

  /**
   * Remove a trait from an entity
   */
  removeTrait(eid: number, trait: string): void {
    if (!hasComponent(this.world, eid, Traits)) return;
    const traits = JSON.parse(Traits.active[eid]) as string[];
    const idx = traits.indexOf(trait);
    if (idx !== -1) {
      traits.splice(idx, 1);
      Traits.active[eid] = JSON.stringify(traits);
    }
  }

  /**
   * Check if entity has a trait
   */
  hasTrait(eid: number, trait: string): boolean {
    if (!hasComponent(this.world, eid, Traits)) return false;
    const traits = JSON.parse(Traits.active[eid]) as string[];
    return traits.includes(trait);
  }

  /**
   * Get all traits for an entity
   */
  getTraits(eid: number): string[] {
    if (!hasComponent(this.world, eid, Traits)) return [];
    return JSON.parse(Traits.active[eid]) as string[];
  }

  /**
   * Get available affordances for an entity
   */
  getAvailableAffordances(eid: number): string[] {
    const traits = this.getTraits(eid);
    const affordances: string[] = [];

    for (const aff of worldSchema.getAllAffordances()) {
      if ((aff.effects ?? []).some(effect => effect.type === "run_tool" && (!effect.toolId || !isWorldOfficeToolAllowed(this.world, effect.toolId)))) continue;
      // Check required traits
      const hasRequired = aff.requires.every(t => traits.includes(t));
      // Check blocked traits
      const isBlocked = (aff.blockedBy || []).some(t => traits.includes(t));

      if (hasRequired && !isBlocked) {
        affordances.push(aff.name);
      }
    }

    return affordances;
  }

  /**
   * Get full info about an object
   */
  getInfo(eid: number): ObjectInfo | null {
    if (!hasComponent(this.world, eid, ObjectType)) {
      return null;
    }

    const info: ObjectInfo = {
      eid,
      typeId: ObjectType.typeId[eid],
      name: Name.value[eid] || ObjectType.instanceName[eid],
      state: ObjectState.current[eid],
      description: Description.value[eid],
      traits: this.getTraits(eid),
    };

    if (hasComponent(this.world, eid, GridPosition)) {
      info.position = {
        x: GridPosition.x[eid],
        y: GridPosition.y[eid],
      };
    }

    return info;
  }

  /**
   * Get all objects in a container/room
   */
  getContents(containerEid: number): number[] {
    return [...query(this.world, [LocatedIn(containerEid)])];
  }

  /**
   * Get all objects on a surface
   */
  getObjectsOnSurface(surfaceEid: number): number[] {
    return [...query(this.world, [OnTopOf(surfaceEid)])];
  }

  /**
   * Move object to a new container
   */
  moveToContainer(eid: number, containerEid: number): void {
    setLocatedIn(this.world, eid, containerEid);

    // Update container counts
    if (hasComponent(this.world, containerEid, Container)) {
      Container.currentCount[containerEid]++;
    }
  }

  /**
   * Place object on a surface
   */
  placeOnSurface(eid: number, surfaceEid: number): void {
    addComponent(this.world, eid, OnTopOf(surfaceEid));

    if (hasComponent(this.world, surfaceEid, Surface)) {
      Surface.currentCount[surfaceEid]++;
    }
  }

  /**
   * Destroy an object
   */
  destroy(eid: number): void {
    this.entityTypeMap.delete(eid);
    removeEntity(this.world, eid);
  }

  // --- Private helpers ---

  private generateName(typeDef: ObjectTypeDefinition, options: SpawnOptions): string {
    const adj = options.properties?.adjective || "";
    const mat = options.properties?.material || "";
    const base = typeDef.name;

    if (adj && mat) return `${adj} ${mat} ${base}`;
    if (adj) return `${adj} ${base}`;
    if (mat) return `${mat} ${base}`;
    return base;
  }

  private generateDescription(
    typeDef: ObjectTypeDefinition,
    state: string,
    options: SpawnOptions
  ): string {
    const stateDef = typeDef.states[state];
    if (!stateDef) return typeDef.description;

    let desc = stateDef.description;

    // Template substitution
    if (options.properties) {
      for (const [key, value] of Object.entries(options.properties)) {
        if (value) {
          desc = desc.replace(new RegExp(`\\{${key}\\}`, "g"), value);
        }
      }
    }

    return desc;
  }

  private getProperties(eid: number): SpawnOptions["properties"] {
    if (!hasComponent(this.world, eid, ObjectProperties)) {
      return undefined;
    }
    return {
      adjective: ObjectProperties.adjective[eid],
      material: ObjectProperties.material[eid],
      color: ObjectProperties.color[eid],
      size: ObjectProperties.size[eid],
    };
  }
}
