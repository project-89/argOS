import {
  addEntity,
  removeEntity,
  addComponent,
  removeComponent,
  hasComponent,
  query,
  getRelationTargets,
  Wildcard,
  Not,
  entityExists,
} from "bitecs";
import type { World } from "./world";
import { AllComponents, Name, Description, GridPosition, Sprite, WorldMap } from "./components";
import { AllRelations } from "./relations";
import {
  createAgentEntity,
  createRoomEntity,
  createObjectEntity,
  createStimulusSourceEntity,
} from "./prefabs";
import {
  createWorldMap,
  setTile,
  getTile,
  drawRoom,
  drawDoor,
  drawPath,
  setEntityPosition,
  setEntitySprite,
  moveEntity,
  isWalkable,
} from "../world/ascii-world";
import { requestRoomPopulation } from "../spirits/steward-spirit";
import { resolveEntityId, resolveEntityName, syncEntityRegistryFromWorld } from "./entity-lookup";

export interface EntityRegistry {
  byName: Map<string, number>;
  byId: Map<number, string>;
}

export function createEntityRegistry(): EntityRegistry {
  return {
    byName: new Map(),
    byId: new Map(),
  };
}

export function registerEntity(registry: EntityRegistry, name: string, eid: number): void {
  registry.byName.set(name, eid);
  registry.byId.set(eid, name);
}

export function unregisterEntity(registry: EntityRegistry, eid: number): void {
  const name = registry.byId.get(eid);
  if (name) {
    registry.byName.delete(name);
    registry.byId.delete(eid);
  }
}

export function lookupEntity(registry: EntityRegistry, name: string): number | undefined {
  return registry.byName.get(name);
}

export function lookupEntityName(registry: EntityRegistry, eid: number): string | undefined {
  return registry.byId.get(eid);
}

export type ToolResult = {
  success: boolean;
  result: any;
  error?: string;
};

export function createEcsTools(world: World, registry: EntityRegistry) {
  const resolveId = (name: string): number | undefined => resolveEntityId(world, registry, name);
  const resolveName = (eid: number): string | undefined => resolveEntityName(world, registry, eid);

  return {
    createAgent: (params: {
      name: string;
      role: string;
      systemPrompt: string;
      description?: string;
      roomName?: string;
    }): ToolResult => {
      try {
        const roomId = params.roomName ? lookupEntity(registry, params.roomName) : undefined;
        const eid = createAgentEntity(world, {
          name: params.name,
          role: params.role,
          systemPrompt: params.systemPrompt,
          description: params.description,
          roomId,
        });
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    createRoom: (params: {
      name: string;
      description?: string;
      capacity?: number;
      ambience?: string;
    }): ToolResult => {
      try {
        const eid = createRoomEntity(world, params);
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    /**
     * Create a room AND request The Steward to populate it with appropriate entities.
     * This is the preferred way to create rooms as it ensures they are properly furnished.
     */
    createAndPopulateRoom: (params: {
      name: string;
      roomType: string; // e.g., "bakery", "blacksmith", "tavern"
      description?: string;
      capacity?: number;
      ambience?: string;
      context?: {
        worldTheme?: string;
        economyLevel?: "poor" | "modest" | "prosperous" | "wealthy";
        primaryFunction?: string;
        inhabitants?: string[];
      };
      constraints?: {
        maxItems?: number;
        requiredItems?: string[];
        budgetLevel?: "sparse" | "normal" | "abundant";
      };
    }): ToolResult => {
      try {
        // Create the room entity
        const eid = createRoomEntity(world, {
          name: params.name,
          description: params.description || `A ${params.roomType} awaiting furnishing.`,
          capacity: params.capacity,
          ambience: params.ambience,
        });
        registerEntity(registry, params.name, eid);

        // Queue for population by The Steward
        const request = requestRoomPopulation(
          params.roomType,
          params.name,
          params.context || {},
          params.constraints || {},
          0 // GodAI EID (will be set properly in context)
        );

        return {
          success: true,
          result: {
            entityId: eid,
            name: params.name,
            roomType: params.roomType,
            populationRequestId: request.id,
            message: `Room created and queued for population by The Steward`,
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    createObject: (params: {
      name: string;
      description?: string;
      material?: string;
      weight?: number;
      portable?: boolean;
      roomName?: string;
    }): ToolResult => {
      try {
        const roomId = params.roomName ? lookupEntity(registry, params.roomName) : undefined;
        const eid = createObjectEntity(world, {
          ...params,
          roomId,
        });
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    createStimulusSource: (params: {
      name: string;
      stimulusType: string;
      template: string;
      interval?: number;
      roomName?: string;
    }): ToolResult => {
      try {
        const roomId = params.roomName ? lookupEntity(registry, params.roomName) : undefined;
        const eid = createStimulusSourceEntity(world, {
          ...params,
          roomId,
        });
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    createEntity: (params: {
      name: string;
      description?: string;
      roomName?: string;
      initialArousal?: number;
      mode?: string;
    }): ToolResult => {
      try {
        const roomId = params.roomName ? lookupEntity(registry, params.roomName) : undefined;
        const eid = addEntity(world);
        
        addComponent(world, eid, Name);
        addComponent(world, eid, Description);
        addComponent(world, eid, AllComponents.Mind);
        addComponent(world, eid, AllComponents.Position);
        
        Name.value[eid] = params.name;
        Description.value[eid] = params.description ?? "";
        AllComponents.Mind.mode[eid] = params.mode ?? "passive";
        AllComponents.Mind.arousal[eid] = params.initialArousal ?? 0.5;
        AllComponents.Mind.focus[eid] = "";
        AllComponents.Mind.lastUpdate[eid] = Date.now();
        
        if (roomId !== undefined) {
          addComponent(world, eid, AllRelations.LocatedIn(roomId));
        }
        
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name, type: "mechanical_entity" } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    removeEntity: (params: { name: string }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.name);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.name}` };
        }
        removeEntity(world, eid);
        unregisterEntity(registry, eid);
        return { success: true, result: { removed: params.name } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    addComponent: (params: {
      entityName: string;
      componentName: string;
      values?: Record<string, any>;
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        const component = AllComponents[params.componentName as keyof typeof AllComponents];
        if (!component) {
          return { success: false, result: null, error: `Component not found: ${params.componentName}` };
        }
        addComponent(world, eid, component);
        if (params.values) {
          for (const [key, value] of Object.entries(params.values)) {
            if (key in component) {
              (component as any)[key][eid] = value;
            }
          }
        }
        return { success: true, result: { entity: params.entityName, component: params.componentName } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    removeComponentFromEntity: (params: {
      entityName: string;
      componentName: string;
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        const component = AllComponents[params.componentName as keyof typeof AllComponents];
        if (!component) {
          return { success: false, result: null, error: `Component not found: ${params.componentName}` };
        }
        removeComponent(world, eid, component);
        return { success: true, result: { entity: params.entityName, component: params.componentName } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setComponentValues: (params: {
      entityName: string;
      componentName: string;
      values: Record<string, any>;
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        const component = AllComponents[params.componentName as keyof typeof AllComponents];
        if (!component) {
          return { success: false, result: null, error: `Component not found: ${params.componentName}` };
        }
        if (!hasComponent(world, eid, component)) {
          addComponent(world, eid, component);
        }
        for (const [key, value] of Object.entries(params.values)) {
          if (key in component) {
            (component as any)[key][eid] = value;
          }
        }
        return { success: true, result: { entity: params.entityName, values: params.values } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getComponentValues: (params: {
      entityName: string;
      componentName: string;
      properties?: string[];
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        const component = AllComponents[params.componentName as keyof typeof AllComponents];
        if (!component) {
          return { success: false, result: null, error: `Component not found: ${params.componentName}` };
        }
        const result: Record<string, any> = {};
        const props = params.properties ?? Object.keys(component);
        for (const key of props) {
          if (key in component) {
            result[key] = (component as any)[key][eid];
          }
        }
        return { success: true, result };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    addRelation: (params: {
      subjectName: string;
      relationName: string;
      targetName: string;
      values?: Record<string, any>;
    }): ToolResult => {
      try {
        const subjectId = lookupEntity(registry, params.subjectName);
        const targetId = lookupEntity(registry, params.targetName);
        if (subjectId === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.subjectName}` };
        }
        if (targetId === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.targetName}` };
        }
        const relation = AllRelations[params.relationName as keyof typeof AllRelations];
        if (!relation) {
          return { success: false, result: null, error: `Relation not found: ${params.relationName}` };
        }
        const relationComponent = relation(targetId) as any;
        addComponent(world, subjectId, relationComponent);
        if (params.values && relationComponent) {
          for (const [key, value] of Object.entries(params.values)) {
            if (relationComponent[key]) {
              relationComponent[key][subjectId] = value;
            }
          }
        }
        return { 
          success: true, 
          result: { 
            subject: params.subjectName, 
            relation: params.relationName, 
            target: params.targetName 
          } 
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    removeRelation: (params: {
      subjectName: string;
      relationName: string;
      targetName: string;
    }): ToolResult => {
      try {
        const subjectId = lookupEntity(registry, params.subjectName);
        const targetId = lookupEntity(registry, params.targetName);
        if (subjectId === undefined || targetId === undefined) {
          return { success: false, result: null, error: `Entity not found` };
        }
        const relation = AllRelations[params.relationName as keyof typeof AllRelations];
        if (!relation) {
          return { success: false, result: null, error: `Relation not found: ${params.relationName}` };
        }
        removeComponent(world, subjectId, relation(targetId));
        return { success: true, result: { removed: true } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getRelationTargets: (params: {
      subjectName: string;
      relationName: string;
    }): ToolResult => {
      try {
        const subjectId = resolveId(params.subjectName);
        if (subjectId === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.subjectName}` };
        }
        const relation = AllRelations[params.relationName as keyof typeof AllRelations];
        if (!relation) {
          return { success: false, result: null, error: `Relation not found: ${params.relationName}` };
        }
        const targets = getRelationTargets(world, subjectId, relation);
        const targetNames = targets.map((tid) => resolveName(tid) ?? `entity:${tid}`);
        return { success: true, result: { targets: targetNames, targetIds: targets } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    queryEntities: (params: {
      componentNames?: string[];
      notComponentNames?: string[];
    }): ToolResult => {
      try {
        const components = (params.componentNames ?? [])
          .map((name) => AllComponents[name as keyof typeof AllComponents])
          .filter(Boolean);
        
        const notComponents = (params.notComponentNames ?? [])
          .map((name) => Not(AllComponents[name as keyof typeof AllComponents]))
          .filter(Boolean);

        const queryTerms = [...components, ...notComponents];
        if (queryTerms.length === 0) {
          // Friendly behavior: an empty query acts like listEntities(), which is what LLMs often intend.
          syncEntityRegistryFromWorld(world, registry);
          const entities = Array.from(query(world, [Name]))
            .filter((eid: number) => entityExists(world, eid))
            .map((eid: number) => ({ id: eid, name: resolveName(eid) ?? `entity:${eid}` }));
          return { success: true, result: entities };
        }

        const entities = Array.from(query(world, queryTerms));
        const result = entities.map((eid: number) => ({
          id: eid,
          name: resolveName(eid) ?? `entity:${eid}`,
        }));

        return { success: true, result };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getEntityByName: (params: { name: string }): ToolResult => {
      const eid = resolveId(params.name);
      if (eid === undefined) {
        return { success: false, result: null, error: `Entity not found: ${params.name}` };
      }
      return { success: true, result: { id: eid, name: params.name } };
    },

    listEntities: (): ToolResult => {
      // World-backed list: avoids registry drift when entities are created outside tools.
      syncEntityRegistryFromWorld(world, registry);
      const entities = Array.from(query(world, [Name]))
        .filter((eid: number) => entityExists(world, eid))
        .map((eid: number) => ({ name: resolveName(eid) ?? `entity:${eid}`, id: eid }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, result: entities };
    },

    listComponents: (): ToolResult => {
      return { success: true, result: Object.keys(AllComponents) };
    },

    listRelations: (): ToolResult => {
      return { success: true, result: Object.keys(AllRelations) };
    },

    createWorldMap: (params: {
      name: string;
      width: number;
      height: number;
      fill?: string;
    }): ToolResult => {
      try {
        const eid = createWorldMap(world, params.name, params.width, params.height, params.fill);
        registerEntity(registry, params.name, eid);
        return { success: true, result: { entityId: eid, name: params.name, width: params.width, height: params.height } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setTile: (params: {
      mapName: string;
      x: number;
      y: number;
      char: string;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        setTile(world, mapEid, params.x, params.y, params.char);
        return { success: true, result: { x: params.x, y: params.y, char: params.char } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setTiles: (params: {
      mapName: string;
      tiles: Array<{ x: number; y: number; char: string }>;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        for (const tile of params.tiles) {
          setTile(world, mapEid, tile.x, tile.y, tile.char);
        }
        return { success: true, result: { count: params.tiles.length } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    drawRoom: (params: {
      mapName: string;
      x: number;
      y: number;
      width: number;
      height: number;
      floor?: string;
      wall?: string;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        drawRoom(world, mapEid, params.x, params.y, params.width, params.height, params.floor, params.wall);
        return { success: true, result: { x: params.x, y: params.y, width: params.width, height: params.height } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    drawDoor: (params: {
      mapName: string;
      x: number;
      y: number;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        drawDoor(world, mapEid, params.x, params.y);
        return { success: true, result: { x: params.x, y: params.y } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    drawPath: (params: {
      mapName: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      char?: string;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        drawPath(world, mapEid, params.x1, params.y1, params.x2, params.y2, params.char);
        return { success: true, result: { from: [params.x1, params.y1], to: [params.x2, params.y2] } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    placeEntityOnGrid: (params: {
      entityName: string;
      mapName: string;
      x: number;
      y: number;
      char?: string;
      color?: string;
      facing?: string;
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        const mapEid = lookupEntity(registry, params.mapName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        if (!isWalkable(world, mapEid, params.x, params.y)) {
          return { success: false, result: null, error: `Position (${params.x}, ${params.y}) is not walkable` };
        }
        setEntityPosition(world, eid, params.x, params.y, params.facing);
        setEntitySprite(world, eid, params.char ?? '@', params.color ?? '#ff6666');
        return { success: true, result: { entity: params.entityName, x: params.x, y: params.y } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    moveEntityOnGrid: (params: {
      entityName: string;
      mapName: string;
      direction: 'north' | 'south' | 'east' | 'west';
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        const mapEid = lookupEntity(registry, params.mapName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        const dx = params.direction === 'east' ? 1 : params.direction === 'west' ? -1 : 0;
        const dy = params.direction === 'south' ? 1 : params.direction === 'north' ? -1 : 0;
        const success = moveEntity(world, mapEid, eid, dx, dy);
        if (!success) {
          return { success: false, result: null, error: `Cannot move ${params.direction} - blocked` };
        }
        return { 
          success: true, 
          result: { 
            entity: params.entityName, 
            direction: params.direction,
            newPosition: { x: GridPosition.x[eid], y: GridPosition.y[eid] }
          } 
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    setEntitySprite: (params: {
      entityName: string;
      char: string;
      color?: string;
    }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        setEntitySprite(world, eid, params.char, params.color);
        return { success: true, result: { entity: params.entityName, char: params.char } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    fillArea: (params: {
      mapName: string;
      x: number;
      y: number;
      width: number;
      height: number;
      char: string;
    }): ToolResult => {
      try {
        const mapEid = lookupEntity(registry, params.mapName);
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        for (let py = params.y; py < params.y + params.height; py++) {
          for (let px = params.x; px < params.x + params.width; px++) {
            setTile(world, mapEid, px, py, params.char);
          }
        }
        return { success: true, result: { x: params.x, y: params.y, width: params.width, height: params.height, char: params.char } };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getEntityPosition: (params: { entityName: string }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (GridPosition.x[eid] === undefined) {
          return { success: false, result: null, error: `Entity ${params.entityName} has no grid position` };
        }
        return {
          success: true,
          result: {
            entity: params.entityName,
            x: GridPosition.x[eid],
            y: GridPosition.y[eid],
            facing: GridPosition.facing[eid] || 'south',
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getEntitiesAtPosition: (params: { x: number; y: number }): ToolResult => {
      try {
        const entities = Array.from(query(world, [GridPosition]));
        const atPosition = entities.filter(
          (eid) => GridPosition.x[eid] === params.x && GridPosition.y[eid] === params.y
        );
        const result = atPosition.map((eid) => ({
          id: eid,
          name: lookupEntityName(registry, eid) ?? `entity:${eid}`,
          facing: GridPosition.facing[eid] || 'south',
          sprite: Sprite.char[eid] || '?',
        }));
        return { success: true, result };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    getEntitiesInRadius: (params: { x: number; y: number; radius: number }): ToolResult => {
      try {
        const entities = Array.from(query(world, [GridPosition]));
        const inRadius = entities.filter((eid) => {
          const dx = GridPosition.x[eid] - params.x;
          const dy = GridPosition.y[eid] - params.y;
          return Math.sqrt(dx * dx + dy * dy) <= params.radius;
        });
        const result = inRadius.map((eid) => ({
          id: eid,
          name: lookupEntityName(registry, eid) ?? `entity:${eid}`,
          x: GridPosition.x[eid],
          y: GridPosition.y[eid],
          distance: Math.sqrt(
            Math.pow(GridPosition.x[eid] - params.x, 2) +
            Math.pow(GridPosition.y[eid] - params.y, 2)
          ),
        }));
        result.sort((a, b) => a.distance - b.distance);
        return { success: true, result };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },

    checkCollision: (params: { entityName: string; direction: 'north' | 'south' | 'east' | 'west'; mapName: string }): ToolResult => {
      try {
        const eid = lookupEntity(registry, params.entityName);
        const mapEid = lookupEntity(registry, params.mapName);
        if (eid === undefined) {
          return { success: false, result: null, error: `Entity not found: ${params.entityName}` };
        }
        if (mapEid === undefined) {
          return { success: false, result: null, error: `Map not found: ${params.mapName}` };
        }
        const dx = params.direction === 'east' ? 1 : params.direction === 'west' ? -1 : 0;
        const dy = params.direction === 'south' ? 1 : params.direction === 'north' ? -1 : 0;
        const newX = GridPosition.x[eid] + dx;
        const newY = GridPosition.y[eid] + dy;

        const tileWalkable = isWalkable(world, mapEid, newX, newY);

        const entitiesAtTarget = Array.from(query(world, [GridPosition])).filter(
          (otherEid) => otherEid !== eid && GridPosition.x[otherEid] === newX && GridPosition.y[otherEid] === newY
        );
        const entityCollisions = entitiesAtTarget.map((otherEid) => ({
          id: otherEid,
          name: lookupEntityName(registry, otherEid) ?? `entity:${otherEid}`,
        }));

        return {
          success: true,
          result: {
            canMove: tileWalkable && entityCollisions.length === 0,
            tileWalkable,
            entityCollisions,
            targetPosition: { x: newX, y: newY },
          },
        };
      } catch (e) {
        return { success: false, result: null, error: String(e) };
      }
    },
  };
}

export type EcsTools = ReturnType<typeof createEcsTools>;
