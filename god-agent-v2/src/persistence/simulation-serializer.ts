/**
 * Simulation Serialization System
 * Saves and loads complete God-created simulations as .godsim files
 */

import { World, query } from 'bitecs';
import { AutonomousGodState } from '../agents/autonomous-god.js';
import { globalRegistry } from '../components/registry.js';
import fs from 'fs/promises';

export interface SimulationFile {
  metadata: {
    name: string;
    description: string;
    created: string;
    godAgent: string;
    version: string;
  };
  components: Record<string, {
    schema: any;
    code: string;
    description: string;
  }>;
  relationships: Record<string, {
    schema: any;
    cardinality: string;
    code: string;
    description: string;
  }>;
  systems: Record<string, {
    description: string;
    requiredComponents: string[];
    code: string;
  }>;
  entities: Array<{
    id: number;
    components: Record<string, any>;
  }>;
  relationshipInstances: Array<{
    from: number;
    to: number;
    type: string;
    data?: any;
  }>;
  runtime: {
    defaultSystems: string[];
    tickRate: number;
    maxEntities: number;
  };
}

export class SimulationSerializer {
  static async save(
    god: AutonomousGodState, 
    filename: string,
    metadata: Partial<SimulationFile['metadata']> = {}
  ): Promise<void> {
    const simulation: SimulationFile = {
      metadata: {
        name: metadata.name || 'Untitled Simulation',
        description: metadata.description || 'God-generated simulation',
        created: new Date().toISOString(),
        godAgent: 'The Autonomous Creator v2.0',
        version: '1.0',
        ...metadata
      },
      components: this.serializeComponents(),
      relationships: this.serializeRelationships(),
      systems: this.serializeSystems(),
      entities: this.serializeEntities(god.world),
      relationshipInstances: this.serializeRelationshipInstances(god.world),
      runtime: {
        defaultSystems: globalRegistry.listSystems(),
        tickRate: 60,
        maxEntities: 10000
      }
    };

    const filepath = filename.endsWith('.godsim') ? filename : `${filename}.godsim`;
    await fs.writeFile(filepath, JSON.stringify(simulation, null, 2));
    console.log(`💾 Simulation saved to: ${filepath}`);
  }

  private static serializeComponents(): Record<string, any> {
    const components: Record<string, any> = {};
    
    for (const name of globalRegistry.listComponents()) {
      const comp = globalRegistry.getComponent(name);
      if (comp) {
        components[name] = {
          schema: comp.schema,
          code: `// Generated component: ${name}`,
          description: comp.schema.description || `ECS component: ${name}`
        };
      }
    }
    
    return components;
  }

  private static serializeRelationships(): Record<string, any> {
    const relationships: Record<string, any> = {};
    
    for (const name of globalRegistry.listRelationships()) {
      const rel = globalRegistry.getRelationship(name);
      if (rel) {
        relationships[name] = {
          schema: {
            properties: rel.properties
          },
          cardinality: rel.cardinality || 'many-to-many',
          code: `// Generated relationship: ${name}`,
          description: rel.description || `ECS relationship: ${name}`
        };
      }
    }
    
    return relationships;
  }

  private static serializeSystems(): Record<string, any> {
    const systems: Record<string, any> = {};
    
    for (const name of globalRegistry.listSystems()) {
      const sys = globalRegistry.getSystem(name);
      if (sys) {
        systems[name] = {
          description: sys.description || `ECS system: ${name}`,
          requiredComponents: sys.requiredComponents || [],
          code: sys.code || `// Generated system: ${name}`
        };
      }
    }
    
    return systems;
  }

  private static serializeEntities(world: World): Array<any> {
    const entities: Array<any> = [];
    
    // Get all entities (this is a simplified approach)
    // In practice, we'd need to track all entities that were created
    const allEntities = query(world, []);
    
    for (const eid of allEntities) {
      const entityData: any = { id: eid, components: {} };
      
      // For each component, extract data for this entity
      for (const componentName of globalRegistry.listComponents()) {
        const comp = globalRegistry.getComponent(componentName);
        if (comp && this.entityHasComponent(world, eid, comp)) {
          entityData.components[componentName] = this.extractComponentData(comp, eid);
        }
      }
      
      entities.push(entityData);
    }
    
    return entities;
  }

  private static serializeRelationshipInstances(_world: World): Array<any> {
    const instances: Array<any> = [];
    
    // This would need to be implemented based on how we track relationships
    // For now, return empty array
    return instances;
  }

  private static entityHasComponent(_world: World, _eid: number, comp: any): boolean {
    // Simplified check - in practice we'd use bitECS hasComponent
    try {
      return comp.component && typeof comp.component === 'object';
    } catch {
      return false;
    }
  }

  private static extractComponentData(comp: any, eid: number): any {
    const data: any = {};
    
    if (comp.component && typeof comp.component === 'object') {
      for (const [key, array] of Object.entries(comp.component)) {
        if (Array.isArray(array) && array[eid] !== undefined) {
          data[key] = array[eid];
        }
      }
    }
    
    return data;
  }

  static async load(filename: string): Promise<SimulationFile> {
    const filepath = filename.endsWith('.godsim') ? filename : `${filename}.godsim`;
    const content = await fs.readFile(filepath, 'utf8');
    return JSON.parse(content) as SimulationFile;
  }

  static async list(directory: string = '.'): Promise<string[]> {
    try {
      const files = await fs.readdir(directory);
      return files.filter(f => f.endsWith('.godsim'));
    } catch {
      return [];
    }
  }
}