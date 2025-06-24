/**
 * Entity Composition Action
 * Allows god agents to create complex entities with multiple components
 */

import { z } from 'zod';
import { World, addEntity, addComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  GodMode, 
  storeString 
} from '../components/god-components.js';
import { 
  callLLM,
  parseJSON 
} from '../llm/interface.js';
import { recordCreation } from '../agents/god-factory.js';

export const ecsComposeEntitySchema = z.object({
  description: z.string(),
  purpose: z.string(),
  traits: z.array(z.string()).optional(),
  behavior: z.string().optional(),
  examples: z.array(z.string()).optional(),
});

export type EcsComposeEntityParams = z.infer<typeof ecsComposeEntitySchema>;

export interface EntityCompositionResult {
  success: boolean;
  entityId?: number;
  components?: string[];
  error?: string;
  design?: {
    name: string;
    description: string;
    components: Array<{
      name: string;
      values: Record<string, any>;
    }>;
  };
}

const EntityDesignSchema = z.object({
  name: z.string(),
  description: z.string(),
  components: z.array(z.object({
    name: z.string(),
    values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  })),
});

export async function ecsComposeEntity(
  world: World,
  params: EcsComposeEntityParams,
  godEid: number
): Promise<EntityCompositionResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 20) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 20 to compose entities.',
    };
  }

  try {
    // Get available components
    const availableComponents = globalRegistry.listComponents();
    const componentInfo = availableComponents.map(name => {
      const comp = globalRegistry.getComponent(name);
      return {
        name,
        properties: comp?.schema.properties || [],
        description: comp?.schema.description || 'No description'
      };
    });

    // Create prompt for entity composition
    const prompt = `Design an entity based on this description:

Description: ${params.description}
Purpose: ${params.purpose}

${params.traits ? `Traits: ${params.traits.join(', ')}` : ''}
${params.behavior ? `Behavior: ${params.behavior}` : ''}
${params.examples ? `Examples: ${params.examples.join('\n')}` : ''}

Available components:
${componentInfo.map(c => `- ${c.name}: ${c.description} (${c.properties.map(p => p.name).join(', ')})`).join('\n')}

Choose appropriate components from the available list and specify realistic values for each property.
The entity should have a meaningful name and use components that make sense together.
Only use components that exist in the available list above.

Provide specific numeric values for all properties:
- For health/energy: use realistic ranges (e.g., 100 max, 80 current)
- For positions: use world coordinates (e.g., x: 150, y: 200)
- For speeds: use reasonable movement rates (e.g., 1.5 units/sec)
- For types: use appropriate numeric codes based on the component description`;

    // Generate entity design using unstructured generation
    const promptWithFormat = `${prompt}

Return your response as valid JSON in this exact format:
{
  "name": "entity name",
  "description": "entity description", 
  "components": [
    {
      "name": "ComponentName",
      "values": {
        "property1": 100,
        "property2": 50.5,
        "property3": "string value"
      }
    }
  ]
}`;

    const response = await callLLM(promptWithFormat);
    const design = parseJSON<z.infer<typeof EntityDesignSchema>>(response);
    
    if (!design) {
      return {
        success: false,
        error: 'Failed to parse entity design from LLM response',
      };
    }

    // Validate all components exist
    const missingComponents = design.components
      .map(c => c.name)
      .filter(name => !globalRegistry.getComponent(name));
    
    if (missingComponents.length > 0) {
      return {
        success: false,
        error: `Components do not exist: ${missingComponents.join(', ')}`,
        design,
      };
    }

    // Create the entity
    const eid = addEntity(world);
    const appliedComponents: string[] = [];

    // Add each component with values
    for (const compSpec of design.components) {
      const componentDef = globalRegistry.getComponent(compSpec.name);
      if (!componentDef) continue;

      const component = componentDef.component;
      
      // Add component to entity
      addComponent(world, eid, component);
      appliedComponents.push(compSpec.name);

      // Set values
      for (const [key, value] of Object.entries(compSpec.values)) {
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

    // Update god's creation stats
    recordCreation(world, godEid);

    console.log(`✨ Composed entity: ${design.name} (ID: ${eid})`);
    console.log(`   Description: ${design.description}`);
    console.log(`   Components: ${appliedComponents.join(', ')}`);

    return {
      success: true,
      entityId: eid,
      components: appliedComponents,
      design,
    };

  } catch (error) {
    console.error('Entity composition failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to get entity information
export function inspectEntity(eid: number): any {
  const components: string[] = [];
  const data: Record<string, any> = {};
  
  // Check all registered components
  for (const compName of globalRegistry.listComponents()) {
    const componentDef = globalRegistry.getComponent(compName);
    if (!componentDef) continue;
    
    const component = componentDef.component;
    
    // Check if entity has this component (simplified check)
    if (component && typeof component === 'object') {
      const firstProp = Object.keys(component)[0];
      if (firstProp && Array.isArray(component[firstProp]) && component[firstProp][eid] !== undefined) {
        components.push(compName);
        
        // Extract values
        const values: Record<string, any> = {};
        for (const [key, array] of Object.entries(component)) {
          if (Array.isArray(array) && array[eid] !== undefined) {
            if (key.endsWith('Store')) continue; // Skip string stores
            
            let value = array[eid];
            
            // Handle string values
            if (typeof value === 'number' && `${key}Store` in component) {
              const store = component[`${key}Store`] as Record<number, string>;
              if (store[value]) {
                value = store[value];
              }
            }
            
            values[key] = value;
          }
        }
        data[compName] = values;
      }
    }
  }
  
  return {
    entityId: eid,
    components,
    data
  };
}