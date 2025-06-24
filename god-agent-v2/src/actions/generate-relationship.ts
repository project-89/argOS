/**
 * Relationship Generation Action
 * Allows god agents to create new ECS relationships for knowledge graphs
 */

import { z } from 'zod';
import { World, addEntity, addComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  DynamicRelation, 
  GodMode, 
  storeString 
} from '../components/god-components.js';
import { 
  callLLM,
  parseJSON 
} from '../llm/interface.js';
import { recordCreation } from '../agents/god-factory.js';

export const ecsGenerateRelationshipSchema = z.object({
  description: z.string(),
  purpose: z.string(),
  constraints: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-many']).optional(),
});

export type EcsGenerateRelationshipParams = z.infer<typeof ecsGenerateRelationshipSchema>;

export interface RelationshipGenerationResult {
  success: boolean;
  relationshipName?: string;
  relationship?: any;
  error?: string;
  design?: {
    name: string;
    description: string;
    reasoning: string;
    cardinality: string;
    properties?: Array<{
      name: string;
      type: string;
      description: string;
    }>;
  };
}

const RelationshipDesignSchema = z.object({
  name: z.string(),
  description: z.string(),
  reasoning: z.string(),
  cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  properties: z.array(z.object({
    name: z.string(),
    type: z.enum(['number', 'string', 'boolean']),
    description: z.string(),
  })).optional(),
});

export async function ecsGenerateRelationship(
  world: World,
  params: EcsGenerateRelationshipParams,
  godEid: number
): Promise<RelationshipGenerationResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 40) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 40 to create relationships.',
    };
  }

  try {
    // Create prompt for relationship generation
    const promptWithFormat = `Design a BitECS relationship based on this description:

Description: ${params.description}
Purpose: ${params.purpose}

${params.constraints ? `Constraints:\n${params.constraints.join('\n')}` : ''}
${params.examples ? `Examples:\n${params.examples.join('\n')}` : ''}
${params.cardinality ? `Preferred Cardinality: ${params.cardinality}` : ''}

Remember:
- Relationships connect entities to other entities
- They can have data properties (like strength of relationship)
- Use clear, descriptive names (PascalCase)
- Consider cardinality (one-to-one, one-to-many, many-to-many)
- Think about bidirectional vs unidirectional relationships

Return your response as valid JSON in this exact format:
{
  "name": "RelationshipName",
  "description": "What this relationship represents",
  "reasoning": "Why this design makes sense",
  "cardinality": "one-to-many",
  "properties": [
    {
      "name": "strength",
      "type": "number", 
      "description": "Strength of the relationship (0-100)"
    }
  ]
}`;

    const response = await callLLM(promptWithFormat);
    const design = parseJSON<z.infer<typeof RelationshipDesignSchema>>(response);
    
    if (!design) {
      return {
        success: false,
        error: 'Failed to parse relationship design from LLM response',
      };
    }

    // Check if relationship already exists
    if (globalRegistry.getRelationship(design.name)) {
      return {
        success: false,
        error: `Relationship ${design.name} already exists`,
        design,
      };
    }

    // Create the relationship component structure
    const relationship: any = {};
    
    // Add standard relationship tracking
    relationship.subject = [] as number[]; // Source entity
    relationship.target = [] as number[];  // Target entity
    
    // Add custom properties if specified
    if (design.properties) {
      for (const prop of design.properties) {
        switch (prop.type) {
          case 'number':
            relationship[prop.name] = [] as number[];
            break;
          case 'string':
            relationship[prop.name] = [] as number[];
            relationship[`${prop.name}Store`] = {} as Record<number, string>;
            break;
          case 'boolean':
            relationship[prop.name] = [] as number[];
            break;
        }
      }
    }

    // Register the relationship
    const registered = globalRegistry.registerRelationship(design.name, {
      name: design.name,
      description: design.description,
      cardinality: design.cardinality,
      properties: design.properties || [],
      relationship,
      creator: godEid,
      timestamp: Date.now(),
    });

    if (!registered) {
      return {
        success: false,
        error: 'Failed to register relationship',
        design,
      };
    }

    // Track the creation in ECS
    const drEntity = addEntity(world);
    addComponent(world, drEntity, DynamicRelation);
    DynamicRelation.nameHash[drEntity] = storeString(design.name);
    DynamicRelation.descriptionHash[drEntity] = storeString(design.description);
    DynamicRelation.creator[drEntity] = godEid;
    DynamicRelation.timestamp[drEntity] = Date.now();

    // Update god's creation stats
    recordCreation(world, godEid);

    console.log(`✨ Created relationship: ${design.name}`);
    console.log(`   Description: ${design.description}`);
    console.log(`   Cardinality: ${design.cardinality}`);

    return {
      success: true,
      relationshipName: design.name,
      relationship,
      design,
    };

  } catch (error) {
    console.error('Relationship generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Helper to create a relationship between entities
export function createRelationship(
  _world: World,
  relationshipName: string,
  subjectEid: number,
  targetEid: number,
  properties?: Record<string, any>
): boolean {
  const relationshipDef = globalRegistry.getRelationship(relationshipName);
  if (!relationshipDef) {
    console.error(`Relationship ${relationshipName} not found`);
    return false;
  }

  const relationship = relationshipDef.relationship;
  
  // Find next available index
  let index = 0;
  while (relationship.subject[index] !== undefined) {
    index++;
  }

  // Set the relationship
  relationship.subject[index] = subjectEid;
  relationship.target[index] = targetEid;

  // Set custom properties if provided
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      if (key in relationship) {
        if (typeof value === 'string' && `${key}Store` in relationship) {
          const hash = storeString(value);
          relationship[key][index] = hash;
          relationship[`${key}Store`][hash] = value;
        } else if (typeof value === 'boolean') {
          relationship[key][index] = value ? 1 : 0;
        } else if (typeof value === 'number') {
          relationship[key][index] = value;
        }
      }
    }
  }

  return true;
}

// Helper to query relationships
export function queryRelationship(
  relationshipName: string,
  subjectEid?: number,
  targetEid?: number
): Array<{ subject: number; target: number; properties: Record<string, any> }> {
  const relationshipDef = globalRegistry.getRelationship(relationshipName);
  if (!relationshipDef) return [];

  const relationship = relationshipDef.relationship;
  const results: Array<{ subject: number; target: number; properties: Record<string, any> }> = [];

  for (let i = 0; i < relationship.subject.length; i++) {
    const subject = relationship.subject[i];
    const target = relationship.target[i];
    
    if (subject === undefined || target === undefined) continue;
    
    // Filter by subject/target if specified
    if (subjectEid !== undefined && subject !== subjectEid) continue;
    if (targetEid !== undefined && target !== targetEid) continue;

    // Extract properties
    const properties: Record<string, any> = {};
    for (const prop of relationshipDef.properties) {
      if (prop.name in relationship) {
        let value = relationship[prop.name][i];
        
        // Handle string values
        if (prop.type === 'string' && `${prop.name}Store` in relationship) {
          const store = relationship[`${prop.name}Store`] as Record<number, string>;
          value = store[value] || value;
        } else if (prop.type === 'boolean') {
          value = value === 1;
        }
        
        properties[prop.name] = value;
      }
    }

    results.push({ subject, target, properties });
  }

  return results;
}