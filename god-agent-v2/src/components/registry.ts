/**
 * Component Registry for managing dynamic components
 */

import { World } from 'bitecs';

export interface ComponentDefinition {
  name: string;
  schema: ComponentSchema;
  component: any; // The actual BitECS component
  creator?: number; // Entity ID of creator
  timestamp: number;
}

export interface ComponentSchema {
  description: string;
  properties: Array<{
    name: string;
    type: 'number' | 'string' | 'boolean' | 'eid' | 'array';
    description: string;
    arrayType?: string;
  }>;
}

export interface SystemDefinition {
  name: string;
  description: string;
  requiredComponents: string[];
  behavior?: string;
  systemFn?: (world: World) => void | Promise<void>;
  code?: string;
  creator?: number;
  timestamp: number;
  isAsync?: boolean;
  usesLLM?: boolean;
  llmModel?: string;
  lastError?: {
    message: string;
    stack?: string;
    timestamp: number;
  };
}

export interface RelationshipDefinition {
  name: string;
  description: string;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
  properties: Array<{
    name: string;
    type: 'number' | 'string' | 'boolean';
    description: string;
  }>;
  relationship: any; // The actual relationship component
  creator?: number;
  timestamp: number;
}

export class ComponentRegistry {
  private components: Map<string, ComponentDefinition> = new Map();
  private systems: Map<string, SystemDefinition> = new Map();
  private relationships: Map<string, RelationshipDefinition> = new Map();
  
  constructor() {
    // Initialize with built-in components
    this.registerBuiltins();
  }

  private registerBuiltins() {
    // Register core components that come with the system
    // These would be imported from god-components.ts in a real implementation
  }

  registerComponent(name: string, definition: ComponentDefinition): boolean {
    if (this.components.has(name)) {
      console.error(`Component ${name} already exists`);
      return false;
    }
    
    this.components.set(name, definition);
    console.log(`Registered component: ${name}`);
    return true;
  }

  registerSystem(name: string, definition: SystemDefinition): boolean {
    if (this.systems.has(name)) {
      console.error(`System ${name} already exists`);
      return false;
    }
    
    // Validate that required components exist
    for (const compName of definition.requiredComponents) {
      if (!this.components.has(compName)) {
        console.error(`System ${name} requires non-existent component: ${compName}`);
        return false;
      }
    }
    
    this.systems.set(name, definition);
    console.log(`Registered system: ${name}`);
    return true;
  }

  getComponent(name: string): ComponentDefinition | undefined {
    return this.components.get(name);
  }

  getSystem(name: string): SystemDefinition | undefined {
    return this.systems.get(name);
  }

  listComponents(): string[] {
    return Array.from(this.components.keys());
  }

  listSystems(): string[] {
    return Array.from(this.systems.keys());
  }

  getComponentsByCreator(creatorId: number): ComponentDefinition[] {
    return Array.from(this.components.values()).filter(
      comp => comp.creator === creatorId
    );
  }

  getSystemsByCreator(creatorId: number): SystemDefinition[] {
    return Array.from(this.systems.values()).filter(
      sys => sys.creator === creatorId
    );
  }

  // Relationship management methods
  registerRelationship(name: string, definition: RelationshipDefinition): boolean {
    if (this.relationships.has(name)) {
      console.error(`Relationship ${name} already exists`);
      return false;
    }
    
    this.relationships.set(name, definition);
    console.log(`Registered relationship: ${name}`);
    return true;
  }

  getRelationship(name: string): RelationshipDefinition | undefined {
    return this.relationships.get(name);
  }

  listRelationships(): string[] {
    return Array.from(this.relationships.keys());
  }

  getRelationshipsByCreator(creatorId: number): RelationshipDefinition[] {
    return Array.from(this.relationships.values()).filter(
      rel => rel.creator === creatorId
    );
  }

  exportRegistry(): {
    components: Array<[string, ComponentDefinition]>;
    systems: Array<[string, SystemDefinition]>;
    relationships: Array<[string, RelationshipDefinition]>;
  } {
    return {
      components: Array.from(this.components.entries()),
      systems: Array.from(this.systems.entries()),
      relationships: Array.from(this.relationships.entries())
    };
  }

  importRegistry(data: {
    components: Array<[string, ComponentDefinition]>;
    systems: Array<[string, SystemDefinition]>;
    relationships: Array<[string, RelationshipDefinition]>;
  }) {
    for (const [name, def] of data.components) {
      this.registerComponent(name, def);
    }
    for (const [name, def] of data.systems) {
      this.registerSystem(name, def);
    }
    if (data.relationships) {
      for (const [name, def] of data.relationships) {
        this.registerRelationship(name, def);
      }
    }
  }
}

// Global registry instance
export const globalRegistry = new ComponentRegistry();