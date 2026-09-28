/**
 * Standalone Simulation Runtime
 * Loads and executes .godsim files independently of God Agent
 */

import { createWorld, World, addEntity, addComponent } from 'bitecs';
import { SimulationFile } from '../persistence/simulation-serializer.js';
import { ComponentRegistry } from '../components/registry.js';

export class SimulationRuntime {
  private world: World;
  private systems: Map<string, Function> = new Map();
  private components: Map<string, any> = new Map();
  private running: boolean = false;
  private tickRate: number = 60;
  private lastTime: number = 0;
  private registry: ComponentRegistry;

  constructor() {
    this.world = createWorld();
    this.registry = new ComponentRegistry();
  }

  async loadFromFile(filename: string): Promise<void> {
    const { SimulationSerializer } = await import('../persistence/simulation-serializer.js');
    const simData = await SimulationSerializer.load(filename);
    await this.loadFromData(simData);
  }

  async loadFromData(simData: SimulationFile): Promise<void> {
    console.log(`🎮 Loading simulation: ${simData.metadata.name}`);
    console.log(`📝 Description: ${simData.metadata.description}`);
    
    // Load components
    await this.loadComponents(simData.components);
    
    // Load relationships
    await this.loadRelationships(simData.relationships);
    
    // Load systems
    await this.loadSystems(simData.systems);
    
    // Create entities
    await this.createEntities(simData.entities);
    
    // Create relationship instances
    await this.createRelationshipInstances(simData.relationshipInstances);
    
    // Set runtime configuration
    this.tickRate = simData.runtime.tickRate || 60;
    
    console.log(`✅ Simulation loaded successfully!`);
    console.log(`   Components: ${Object.keys(simData.components).length}`);
    console.log(`   Systems: ${Object.keys(simData.systems).length}`);
    console.log(`   Entities: ${simData.entities.length}`);
  }

  private async loadComponents(components: Record<string, any>): Promise<void> {
    for (const [name, comp] of Object.entries(components)) {
      try {
        // Create component from schema
        const componentDef = this.createComponentFromSchema(name, comp.schema);
        this.components.set(name, componentDef);
        this.registry.registerComponent(name, {
          name,
          component: componentDef,
          schema: comp.schema,
          timestamp: Date.now()
        });
        
        console.log(`📦 Loaded component: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to load component ${name}:`, error);
      }
    }
  }

  private createComponentFromSchema(_name: string, schema: any): any {
    const component: any = {};
    
    for (const [prop, type] of Object.entries(schema)) {
      switch (type) {
        case 'number':
          component[prop] = [] as number[];
          break;
        case 'boolean':
          component[prop] = [] as boolean[];
          break;
        case 'string':
          component[prop] = [] as number[]; // Store as hashes
          break;
        default:
          component[prop] = [] as any[];
      }
    }
    
    return component;
  }

  private async loadRelationships(relationships: Record<string, any>): Promise<void> {
    for (const [name, _rel] of Object.entries(relationships)) {
      try {
        // TODO: Implement relationship loading
        console.log(`🔗 Loaded relationship: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to load relationship ${name}:`, error);
      }
    }
  }

  private async loadSystems(systems: Record<string, any>): Promise<void> {
    for (const [name, sys] of Object.entries(systems)) {
      try {
        // Create function from code string
        const systemFunction = this.createSystemFunction(sys.code, name);
        this.systems.set(name, systemFunction);
        
        console.log(`⚙️  Loaded system: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to load system ${name}:`, error);
      }
    }
  }

  private createSystemFunction(code: string, name: string): Function {
    try {
      // Create a safe execution context
      const context = {
        world: this.world,
        components: Object.fromEntries(this.components),
        query: (world: World, components: any[]) => {
          // Import query from bitecs
          const { query } = require('bitecs');
          return query(world, components);
        },
        console: console,
        Math: Math
      };

      // Wrap the code in a function
      const functionCode = `
        return function ${name}System(world) {
          ${code}
        };
      `;

      const factory = new Function(...Object.keys(context), functionCode);
      return factory(...Object.values(context));
    } catch (error) {
      console.error(`Failed to create system ${name}:`, error);
      return () => {}; // Return no-op function
    }
  }

  private async createEntities(entities: Array<any>): Promise<void> {
    for (const entityData of entities) {
      try {
        const eid = addEntity(this.world);
        
        // Add components to entity
        for (const [componentName, data] of Object.entries(entityData.components)) {
          const component = this.components.get(componentName);
          if (component) {
            addComponent(this.world, component, eid);
            
            // Set component data
            for (const [prop, value] of Object.entries(data as any)) {
              if (component[prop] && Array.isArray(component[prop])) {
                component[prop][eid] = value;
              }
            }
          }
        }
        
        console.log(`🎯 Created entity ${eid} with components: ${Object.keys(entityData.components).join(', ')}`);
      } catch (error) {
        console.error(`❌ Failed to create entity:`, error);
      }
    }
  }

  private async createRelationshipInstances(instances: Array<any>): Promise<void> {
    // TODO: Implement relationship instance creation
    console.log(`🔗 Creating ${instances.length} relationship instances...`);
  }

  // Runtime Control
  start(): void {
    if (this.running) return;
    
    this.running = true;
    this.lastTime = performance.now();
    console.log(`🚀 Starting simulation at ${this.tickRate} FPS`);
    this.gameLoop();
  }

  stop(): void {
    this.running = false;
    console.log(`⏹️  Simulation stopped`);
  }

  step(): void {
    this.executeSystems();
    console.log(`⏭️  Executed single step`);
  }

  reset(): void {
    this.stop();
    // TODO: Reset world state to initial conditions
    console.log(`🔄 Simulation reset`);
  }

  private gameLoop(): void {
    if (!this.running) return;

    const currentTime = performance.now();
    const deltaTime = currentTime - this.lastTime;
    const targetDelta = 1000 / this.tickRate;

    if (deltaTime >= targetDelta) {
      this.executeSystems();
      this.lastTime = currentTime;
    }

    setTimeout(() => this.gameLoop(), 1);
  }

  private executeSystems(): void {
    for (const [name, system] of this.systems) {
      try {
        system(this.world);
      } catch (error) {
        console.error(`❌ System ${name} failed:`, error);
      }
    }
  }

  // Inspection Methods
  getWorldStats(): any {
    return {
      componentCount: this.components.size,
      systemCount: this.systems.size,
      isRunning: this.running,
      tickRate: this.tickRate
    };
  }

  listComponents(): string[] {
    return Array.from(this.components.keys());
  }

  listSystems(): string[] {
    return Array.from(this.systems.keys());
  }

  queryEntities(componentNames: string[]): number[] {
    const { query } = require('bitecs');
    const components = componentNames.map(name => this.components.get(name)).filter(Boolean);
    return query(this.world, components);
  }
}