/**
 * ECS Inspection Action
 * Allows god agents to deeply inspect the world state
 */

import { z } from 'zod';
import { World, query, hasComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { Agent, GodMode, DynamicComponent, DynamicSystem, getString } from '../components/god-components.js';

export const ecsInspectSchema = z.object({
  target: z.enum(['world', 'components', 'systems', 'entities', 'relations']),
  filter: z.string().optional(),
  detailed: z.boolean().optional(),
});

export type EcsInspectParams = z.infer<typeof ecsInspectSchema>;

export interface InspectionResult {
  target: string;
  data: any;
  summary: string;
  timestamp: number;
}

export async function ecsInspect(
  world: World,
  params: EcsInspectParams,
  _agentEid: number
): Promise<InspectionResult> {
  const { target, filter, detailed } = params;
  const timestamp = Date.now();

  switch (target) {
    case 'world':
      return inspectWorld(world, timestamp);
    
    case 'components':
      return inspectComponents(world, filter, detailed || false, timestamp);
    
    case 'systems':
      return inspectSystems(world, filter, detailed || false, timestamp);
    
    case 'entities':
      return inspectEntities(world, filter, detailed || false, timestamp);
    
    case 'relations':
      return {
        target: 'relations',
        data: { message: 'Relation inspection not yet implemented' },
        summary: 'Relation inspection coming soon',
        timestamp,
      };
    
    default:
      throw new Error(`Unknown inspection target: ${target}`);
  }
}

function inspectWorld(world: World, timestamp: number): InspectionResult {
  const allEntities = query(world, []);
  const agents = query(world, [Agent]);
  const gods = query(world, [Agent, GodMode]);
  const dynamicComps = query(world, [DynamicComponent]);
  const dynamicSys = query(world, [DynamicSystem]);

  const data = {
    entityCount: allEntities.length,
    agentCount: agents.length,
    godCount: gods.length,
    registeredComponents: globalRegistry.listComponents().length,
    registeredSystems: globalRegistry.listSystems().length,
    dynamicComponents: dynamicComps.length,
    dynamicSystems: dynamicSys.length,
    worldTime: timestamp,
  };

  const summary = `World contains ${data.entityCount} entities, ${data.agentCount} agents (${data.godCount} gods), ${data.registeredComponents} components, and ${data.registeredSystems} systems`;

  return {
    target: 'world',
    data,
    summary,
    timestamp,
  };
}

function inspectComponents(
  _world: World,
  filter: string | undefined,
  detailed: boolean,
  timestamp: number
): InspectionResult {
  const components = globalRegistry.listComponents();
  const filtered = filter 
    ? components.filter(name => name.toLowerCase().includes(filter.toLowerCase()))
    : components;

  const data = filtered.map(name => {
    const def = globalRegistry.getComponent(name);
    if (!def) return null;

    const baseInfo = {
      name,
      description: def.schema.description,
      propertyCount: def.schema.properties.length,
      creator: def.creator,
      timestamp: def.timestamp,
    };

    if (detailed) {
      return {
        ...baseInfo,
        properties: def.schema.properties,
        // Could add usage stats here
      };
    }

    return baseInfo;
  }).filter(Boolean);

  const summary = `Found ${data.length} components${filter ? ` matching "${filter}"` : ''}`;

  return {
    target: 'components',
    data,
    summary,
    timestamp,
  };
}

function inspectSystems(
  _world: World,
  filter: string | undefined,
  detailed: boolean,
  timestamp: number
): InspectionResult {
  const systems = globalRegistry.listSystems();
  const filtered = filter
    ? systems.filter(name => name.toLowerCase().includes(filter.toLowerCase()))
    : systems;

  const data = filtered.map(name => {
    const def = globalRegistry.getSystem(name);
    if (!def) return null;

    const baseInfo = {
      name,
      description: def.description,
      requiredComponents: def.requiredComponents,
      creator: def.creator,
      timestamp: def.timestamp,
    };

    if (detailed) {
      return {
        ...baseInfo,
        behavior: def.behavior,
        // Could add execution stats, performance metrics, etc.
      };
    }

    return baseInfo;
  }).filter(Boolean);

  const summary = `Found ${data.length} systems${filter ? ` matching "${filter}"` : ''}`;

  return {
    target: 'systems',
    data,
    summary,
    timestamp,
  };
}

function inspectEntities(
  world: World,
  filter: string | undefined,
  detailed: boolean,
  timestamp: number
): InspectionResult {
  const allEntities = query(world, []);
  
  const data = allEntities.map(eid => {
    const components: string[] = [];
    
    // Check which components this entity has
    if (hasComponent(world, eid, Agent)) {
      components.push('Agent');
    }
    if (hasComponent(world, eid, GodMode)) {
      components.push('GodMode');
    }
    if (hasComponent(world, eid, DynamicComponent)) {
      components.push('DynamicComponent');
    }
    if (hasComponent(world, eid, DynamicSystem)) {
      components.push('DynamicSystem');
    }

    const baseInfo = {
      eid,
      components,
      isAgent: hasComponent(world, eid, Agent),
      isGod: hasComponent(world, eid, GodMode),
    };

    if (detailed && hasComponent(world, eid, Agent)) {
      return {
        ...baseInfo,
        name: getString(Agent.nameHash[eid]),
        role: getString(Agent.roleHash[eid]),
        godLevel: hasComponent(world, eid, GodMode) ? GodMode.level[eid] : 0,
      };
    }

    return baseInfo;
  });

  const filtered = filter
    ? data.filter(e => {
        if (detailed && 'name' in e) {
          return e.name?.toLowerCase().includes(filter.toLowerCase());
        }
        return false;
      })
    : data;

  const summary = `Found ${filtered.length} entities${filter ? ` matching "${filter}"` : ''}`;

  return {
    target: 'entities',
    data: filtered,
    summary,
    timestamp,
  };
}