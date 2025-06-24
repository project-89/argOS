/**
 * Component Generation Action
 * Allows god agents to create new ECS components
 */

import { z } from 'zod';
import { World, addEntity, addComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  DynamicComponent, 
  GodMode, 
  storeString
} from '../components/god-components.js';
import { 
  generateStructured, 
  ComponentDesignSchema,
  validateGeneratedCode 
} from '../llm/interface.js';
import { recordCreation } from '../agents/god-factory.js';

export const ecsGenerateComponentSchema = z.object({
  description: z.string(),
  constraints: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});

export type EcsGenerateComponentParams = z.infer<typeof ecsGenerateComponentSchema>;

export interface ComponentGenerationResult {
  success: boolean;
  componentName?: string;
  component?: any;
  error?: string;
  design?: z.infer<typeof ComponentDesignSchema>;
}

export async function ecsGenerateComponent(
  world: World,
  params: EcsGenerateComponentParams,
  godEid: number
): Promise<ComponentGenerationResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 30) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 30 to create components.',
    };
  }

  try {
    // Create prompt for component generation
    const prompt = `Design a BitECS component:

${params.description}

Create a focused component with appropriate properties.
Available types:
- number: for numeric values
- boolean: for true/false flags  
- string: for text data (stored as number hash)
- eid: for single entity references
- number[]: for arrays of numbers
- eid[]: for arrays of entity references

IMPORTANT: There is NO string[] type. For arrays of strings, use parallel arrays:
- Use 'number[]' to store string hashes
- Or use multiple 'string' properties for fixed sets

Note: In BitECS, arrays are stored per-entity. Use singular properties when possible.
Be concise.`;

    // Generate component design
    const design = await generateStructured(
      prompt,
      ComponentDesignSchema
    );

    // Check if component already exists
    if (globalRegistry.getComponent(design.name)) {
      return {
        success: false,
        error: `Component ${design.name} already exists`,
        design,
      };
    }

    // Create the actual component based on design
    const component: any = {};
    const componentCode: string[] = [];

    componentCode.push(`export const ${design.name} = {`);

    // Check if properties exist (important for fallback scenarios)
    if (!design.properties || !Array.isArray(design.properties)) {
      return {
        success: false,
        error: 'Invalid component design: missing properties array',
        design,
      };
    }

    for (const prop of design.properties) {
      switch (prop.type) {
        case 'number':
          component[prop.name] = [] as number[];
          componentCode.push(`  ${prop.name}: [] as number[], // ${prop.description}`);
          break;
        
        case 'boolean':
          // Booleans are stored as 0/1 in number arrays
          component[prop.name] = [] as number[];
          componentCode.push(`  ${prop.name}: [] as number[], // ${prop.description} (0/1)`);
          break;
        
        case 'string':
          // Strings are stored as hashes
          component[prop.name] = [] as number[];
          component[`${prop.name}Store`] = {} as Record<number, string>;
          componentCode.push(`  ${prop.name}: [] as number[], // ${prop.description} (hash)`);
          componentCode.push(`  ${prop.name}Store: {} as Record<number, string>, // String storage`);
          break;
        
        case 'eid':
          // Entity IDs are just numbers
          component[prop.name] = [] as number[];
          componentCode.push(`  ${prop.name}: [] as number[], // ${prop.description} (entity ID)`);
          break;
          
        case 'number[]':
        case 'eid[]':
          // Arrays are stored as arrays of arrays (one array per entity)
          component[prop.name] = [] as number[][];
          componentCode.push(`  ${prop.name}: [] as number[][], // ${prop.description} (array)`);
          break;
      }
    }

    componentCode.push('};');

    // Validate the generated code structure
    const fullCode = componentCode.join('\n');
    if (!validateGeneratedCode(fullCode)) {
      return {
        success: false,
        error: 'Generated component code failed validation',
        design,
      };
    }

    // Convert schema types for registry compatibility
    const registryProperties = design.properties.map(prop => ({
      name: prop.name,
      type: prop.type.includes('[]') ? 'array' as const : prop.type as 'number' | 'string' | 'boolean' | 'eid',
      description: prop.description,
      arrayType: prop.type.includes('[]') ? prop.type.replace('[]', '') : undefined,
    }));

    // Register the component
    const registered = globalRegistry.registerComponent(design.name, {
      name: design.name,
      schema: {
        description: design.description,
        properties: registryProperties,
      },
      component,
      creator: godEid,
      timestamp: Date.now(),
    });

    if (!registered) {
      return {
        success: false,
        error: 'Failed to register component',
        design,
      };
    }

    // Track the creation
    const dcEntity = addEntity(world);
    addComponent(world, dcEntity, DynamicComponent);
    DynamicComponent.nameHash[dcEntity] = storeString(design.name);
    DynamicComponent.schemaHash[dcEntity] = storeString(JSON.stringify(design));
    DynamicComponent.creator[dcEntity] = godEid;
    DynamicComponent.timestamp[dcEntity] = Date.now();
    DynamicComponent.usageCount[dcEntity] = 0;

    // Update god's creation stats
    recordCreation(world, godEid);

    console.log(`✨ Created component: ${design.name}`);
    console.log(`   Description: ${design.description}`);
    console.log(`   Properties: ${design.properties?.map(p => p.name).join(', ') || 'none'}`);

    return {
      success: true,
      componentName: design.name,
      component,
      design,
    };

  } catch (error) {
    console.error('Component generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to create an entity with a dynamic component
export function createEntityWithComponent(
  world: World,
  componentName: string,
  initialValues?: Record<string, any>
): number | null {
  const componentDef = globalRegistry.getComponent(componentName);
  if (!componentDef) {
    console.error(`Component ${componentName} not found`);
    return null;
  }

  const eid = addEntity(world);
  const component = componentDef.component;

  // Add the component to the entity
  addComponent(world, eid, component);

  // Set initial values if provided
  if (initialValues) {
    for (const [key, value] of Object.entries(initialValues)) {
      if (key in component) {
        if (typeof value === 'string' && `${key}Store` in component) {
          // Handle string storage
          const hash = storeString(value);
          component[key][eid] = hash;
          component[`${key}Store`][hash] = value;
        } else if (typeof value === 'boolean') {
          // Convert boolean to 0/1
          component[key][eid] = value ? 1 : 0;
        } else if (typeof value === 'number') {
          component[key][eid] = value;
        }
      }
    }
  }

  // Update usage count
  // This is a simplified version - in production you'd query for the DynamicComponent entity
  
  return eid;
}