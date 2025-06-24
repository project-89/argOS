/**
 * System Generation Action
 * Allows god agents to create new ECS systems
 */

import { z } from 'zod';
import { World, addEntity, addComponent } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { 
  DynamicSystem, 
  GodMode, 
  storeString
} from '../components/god-components.js';
import { 
  callLLM,
  validateGeneratedCode 
} from '../llm/interface.js';
import { recordCreation } from '../agents/god-factory.js';

export const ecsGenerateSystemSchema = z.object({
  description: z.string(),
  requiredComponents: z.array(z.string()),
  behavior: z.string(),
  constraints: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});

export type EcsGenerateSystemParams = z.infer<typeof ecsGenerateSystemSchema>;

export interface SystemGenerationResult {
  success: boolean;
  systemName?: string;
  systemFn?: (world: World) => void;
  error?: string;
  code?: string;
}

export async function ecsGenerateSystem(
  world: World,
  params: EcsGenerateSystemParams,
  godEid: number
): Promise<SystemGenerationResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 50) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 50 to create systems.',
    };
  }

  // Validate required components exist
  for (const compName of params.requiredComponents) {
    if (!globalRegistry.getComponent(compName)) {
      return {
        success: false,
        error: `Required component ${compName} does not exist`,
      };
    }
  }

  try {
    // Get list of all available components
    const availableComponents = globalRegistry.listComponents();
    const componentDescriptions = availableComponents.map(name => {
      const comp = globalRegistry.getComponent(name);
      const props = comp?.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `  - ${name} (${props})`;
    }).join('\n');

    // Create prompt for system generation
    const prompt = `Generate a BitECS system function based on this description:

Description: ${params.description}
Required Components: ${params.requiredComponents.join(', ')}
Behavior: ${params.behavior}

${params.constraints ? `Constraints:\n${params.constraints.join('\n')}` : ''}

${params.examples ? `Example use cases:\n${params.examples.join('\n')}` : ''}

## AVAILABLE COMPONENTS IN THE SYSTEM:
${componentDescriptions}

## IMPORTANT: You MUST use the exact component names from the available list above!

## CRITICAL REQUIREMENT FOR requiredComponents:
The requiredComponents array MUST include EVERY component that your system code references.
If your system uses query(world, [A, B]) or accesses A.x[eid] or hasComponent(world, eid, C), 
then A, B, and C MUST ALL be in requiredComponents: ["A", "B", "C"]

Example: If your system code contains:
- query(world, [Position, Velocity])
- Neuron.charge[eid] 
- hasComponent(world, eid, Synapse)
Then requiredComponents MUST be: ["Position", "Velocity", "Neuron", "Synapse"]

REMEMBER: Any component not in requiredComponents will be undefined and cause a ReferenceError!

## BitECS API REFERENCE

### Available Functions:
- query(world, [Component1, Component2]) - Returns array of entity IDs that have ALL listed components
- addEntity(world) - Creates a new entity, returns its ID
- removeEntity(world, eid) - Removes an entity from the world
- addComponent(world, eid, Component) - Adds a component to an entity
- removeComponent(world, eid, Component) - Removes a component from an entity
- hasComponent(world, eid, Component) - Returns true if entity has component
- entityExists(world, eid) - Returns true if entity exists

### Query Operators:
- And(Component1, Component2) or All(...) - Entity must have ALL components (default behavior)
- Or(Component1, Component2) or Any(...) - Entity must have ANY of the components
- Not(Component1, Component2) or None(...) - Entity must have NONE of the components

### Component Access:
Components use Structure of Arrays (SoA) format. Access properties via:
- ComponentName.propertyName[eid] - Read/write component data
- Example: Position.x[eid] = 10; Position.y[eid] = 20;

### Relations (if needed):
- addComponent(world, eid, RelationName(targetEid)) - Create a relationship
- hasComponent(world, eid, RelationName(targetEid)) - Check if relationship exists
- removeComponent(world, eid, RelationName(targetEid)) - Remove relationship
- getRelationTargets(world, eid, RelationName) - Get all targets of a relation
- query(world, [RelationName(targetEid)]) - Query entities with specific relation
- query(world, [RelationName(Wildcard)]) - Query all entities with any relation of this type

### System Rules:
- Be named with PascalCase ending in "System" (e.g., MovementSystem)
- Take (world: World) as its only parameter
- Process entities efficiently using queries
- Be a pure function with no side effects except component mutations
- Include comments explaining the logic
- NEVER access global variables or external state
- ONLY use the components listed in requiredComponents: ${params.requiredComponents.join(', ')}
- CRITICAL: Regular systems CANNOT use getString/setString - those are ONLY for async/LLM systems
- For string components in regular systems: strings are stored as number hashes automatically
- For arrays, initialize them properly: Component.arrayProp[eid] = Component.arrayProp[eid] || []

### Example System:
function MovementSystem(world) {
  // Query entities that have Position AND Velocity
  const movingEntities = query(world, [Position, Velocity]);
  
  // Update positions based on velocity
  for (const eid of movingEntities) {
    Position.x[eid] += Velocity.x[eid];
    Position.y[eid] += Velocity.y[eid];
  }
  
  // Query entities with Position but NOT Velocity (stationary)
  const stationaryEntities = query(world, [Position, Not(Velocity)]);
  
  // Example of complex query: Has Position and either Health or Shield
  const protectedEntities = query(world, [Position, Or(Health, Shield)]);
}

### IMPORTANT: What you CANNOT use in regular systems:
- getString/setString - These are ONLY available in async/LLM systems
- miniLLM - This is ONLY available in async/LLM systems
- async/await - Regular systems must be synchronous
- Any LLM-specific functions

Generate ONLY the system function code. Do not include imports, exports, or any other code outside the function.`;

    // Generate system code
    const generatedCode = await callLLM(prompt);
    
    // Extract function code
    const functionMatch = generatedCode.match(/function\s+(\w+System)\s*\([^)]*\)\s*{[\s\S]*?^}/m);
    if (!functionMatch) {
      return {
        success: false,
        error: 'Failed to extract system function from generated code',
        code: generatedCode,
      };
    }

    const functionCode = functionMatch[0];
    const systemName = functionMatch[1];

    // Validate the generated code
    if (!validateGeneratedCode(functionCode)) {
      return {
        success: false,
        error: 'Generated system code failed validation',
        code: functionCode,
      };
    }

    // Check if system already exists
    if (globalRegistry.getSystem(systemName)) {
      return {
        success: false,
        error: `System ${systemName} already exists`,
        code: functionCode,
      };
    }

    // Create a wrapper that provides component references
    const systemFunction = createSystemFunction(functionCode, params.requiredComponents);

    // Register the system
    const registered = globalRegistry.registerSystem(systemName, {
      name: systemName,
      description: params.description,
      requiredComponents: params.requiredComponents,
      behavior: params.behavior,
      systemFn: systemFunction,
      code: functionCode,
      creator: godEid,
      timestamp: Date.now(),
    });

    if (!registered) {
      return {
        success: false,
        error: 'Failed to register system',
        code: functionCode,
      };
    }

    // Track the creation
    const dsEntity = addEntity(world);
    addComponent(world, dsEntity, DynamicSystem);
    DynamicSystem.nameHash[dsEntity] = storeString(systemName);
    DynamicSystem.descriptionHash[dsEntity] = storeString(params.description);
    DynamicSystem.creator[dsEntity] = godEid;
    DynamicSystem.timestamp[dsEntity] = Date.now();
    DynamicSystem.executionCount[dsEntity] = 0;

    // Update god's creation stats
    recordCreation(world, godEid);

    console.log(`✨ Created system: ${systemName}`);
    console.log(`   Description: ${params.description}`);
    console.log(`   Required: ${params.requiredComponents.join(', ')}`);

    return {
      success: true,
      systemName,
      systemFn: systemFunction,
      code: functionCode,
    };

  } catch (error) {
    console.error('System generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

import { createBoundedExecutor } from '../runtime/system-executor.js';

// Helper to create a system function with component bindings
function createSystemFunction(
  code: string, 
  requiredComponents: string[]
): (world: World) => void {
  // Return a function that creates the executor when called
  return async (world: World) => {
    const executor = await createBoundedExecutor(world, code, requiredComponents);
    
    if (!executor) {
      console.log(`[System Execution] Failed to create executor, simulating...`);
      console.log(`Required components: ${requiredComponents.join(', ')}`);
      return;
    }
    
    // Execute the system
    executor(world);
  };
}

import { executeSystem } from '../runtime/system-executor.js';

// Execute a dynamic system
export async function executeDynamicSystem(
  world: World,
  systemName: string
): Promise<boolean> {
  return await executeSystem(world, systemName);
}