/**
 * ObjectManager - Handles spawning, state transitions, and queries for world objects
 *
 * This bridges the WorldSchema (prefabs/definitions) with the ECS (runtime entities).
 */

import { addEntity, removeEntity, addComponent, removeComponent, hasComponent, query } from "bitecs";
import {
  Name,
  Description,
  Position,
  GridPosition,
  ObjectType,
  ObjectState,
  Traits,
  Durability,
  Fuel,
  Container,
  Surface,
  Portal,
  LightSource,
  DynamicDescription,
  ObjectProperties,
  StateTransition,
} from "../ecs/components";
import { worldSchema, ContainedIn, OnTopOf, OccupiedBy, type ObjectTypeDefinition } from "./schema";

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

    const eid = addEntity(this.world);
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
    const traits = this.computeTraits(typeDef, initialState);
    addComponent(this.world, eid, Traits);
    Traits.active[eid] = JSON.stringify(traits);

    // Set Name component
    addComponent(this.world, eid, Name);
    Name.value[eid] = ObjectType.instanceName[eid];

    // Set Description
    const description = options.description || this.generateDescription(typeDef, initialState, options);
    addComponent(this.world, eid, Description);
    Description.value[eid] = description;

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
      addComponent(this.world, eid, ContainedIn(options.containedIn));
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

    // Apply any additional component data
    if (options.components) {
      for (const [compName, data] of Object.entries(options.components)) {
        // This would need to be expanded based on actual component needs
        console.log(`Would apply component ${compName}:`, data);
      }
    }

    return eid;
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
    const eid = addEntity(this.world);
    this.entityTypeMap.set(eid, "_custom");

    addComponent(this.world, eid, ObjectType);
    ObjectType.typeId[eid] = "_custom";
    ObjectType.instanceName[eid] = config.name;

    addComponent(this.world, eid, Name);
    Name.value[eid] = config.name;

    addComponent(this.world, eid, Description);
    Description.value[eid] = config.description;

    addComponent(this.world, eid, Traits);
    Traits.active[eid] = JSON.stringify(config.traits);

    addComponent(this.world, eid, ObjectState);
    ObjectState.current[eid] = config.state || "normal";
    ObjectState.previous[eid] = "";
    ObjectState.lockedUntil[eid] = 0;

    if (config.position) {
      addComponent(this.world, eid, GridPosition);
      GridPosition.x[eid] = config.position.x;
      GridPosition.y[eid] = config.position.y;
      GridPosition.facing[eid] = "down";
    }

    if (config.containedIn !== undefined) {
      addComponent(this.world, eid, ContainedIn(config.containedIn));
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
      console.error(`Invalid state '${newState}' for type '${typeId}'`);
      return false;
    }

    const currentState = ObjectState.current[eid];
    ObjectState.previous[eid] = currentState;
    ObjectState.current[eid] = newState;

    // Update traits based on new state
    if (typeDef) {
      const newTraits = this.computeTraits(typeDef, newState);
      Traits.active[eid] = JSON.stringify(newTraits);

      // Update description if no dynamic override
      if (!hasComponent(this.world, eid, DynamicDescription)) {
        const desc = this.generateDescription(typeDef, newState, {
          properties: this.getProperties(eid),
        });
        Description.value[eid] = desc;
      }
    }

    return true;
  }

  /**
   * Set a dynamic description (overrides type-based description)
   */
  setDescription(eid: number, description: string, updatedBy: string = "system"): void {
    if (!hasComponent(this.world, eid, DynamicDescription)) {
      addComponent(this.world, eid, DynamicDescription);
    }
    DynamicDescription.text[eid] = description;
    DynamicDescription.lastUpdated[eid] = Date.now();
    DynamicDescription.updatedBy[eid] = updatedBy;

    // Also update the main description component
    Description.value[eid] = description;
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
    return [...query(this.world, [ContainedIn(containerEid)])];
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
    // Remove from old container if any
    // Note: bitECS relations handle this automatically with exclusive
    addComponent(this.world, eid, ContainedIn(containerEid));

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

  private computeTraits(typeDef: ObjectTypeDefinition, state: string): string[] {
    const baseTraits = [...typeDef.traits];
    const stateDef = typeDef.states[state];

    if (stateDef) {
      // Add state-specific traits
      if (stateDef.traits) {
        for (const t of stateDef.traits) {
          if (!baseTraits.includes(t)) {
            baseTraits.push(t);
          }
        }
      }
      // Remove blocked traits
      if (stateDef.blockedTraits) {
        for (const t of stateDef.blockedTraits) {
          const idx = baseTraits.indexOf(t);
          if (idx !== -1) {
            baseTraits.splice(idx, 1);
          }
        }
      }
    }

    return baseTraits;
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
