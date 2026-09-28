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
    // Create a markdown-formatted list of all available components for the prompt
    const componentManifest = globalRegistry.listComponents().map(name => {
      const comp = globalRegistry.getComponent(name);
      if (!comp) return `- ${name} (error: not found)`;
      const props = comp.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `- **${name}**: { ${props} } // *${comp.schema?.description || 'No description'}*`;
    }).join('\n');

    // Create prompt for system generation using structured approach
    const prompt = `You are an expert ECS programmer. Your task is to generate a system by filling out the following JSON structure.

## AVAILABLE COMPONENTS
You have access to the following components. You can use any of them in your system's code.
${componentManifest}

## TASK
**Description:** ${params.description}
**Behavior:** ${params.behavior}
${params.constraints ? `**Constraints:**\n${params.constraints.map(c => `- ${c}`).join('\n')}` : ''}
${params.examples ? `**Example use cases:**\n${params.examples.map(e => `- ${e}`).join('\n')}` : ''}

## BITECS API QUICK REFERENCE
**CRITICAL: There is NO 'ecs' object! Use functions directly.**
- ✅ CORRECT: query(world, [Component])
- ❌ WRONG: ecs.query(world, [Component])

- query(world, [ComponentA, ComponentB]) - Get entities with ALL components
- query(world, [Or(A, B)]) - Get entities with ANY component
- query(world, [Not(A)]) - Get entities WITHOUT component
- addEntity(world), removeEntity(world, eid)
- addComponent(world, eid, Component), removeComponent(world, eid, Component)
- hasComponent(world, eid, Component), entityExists(world, eid)
- Component.property[eid] - Access/modify component data (SoA format)

## YOUR RESPONSE
Fill out this JSON object. Do not add any extra text or explanations.

{
  "name": "YourSystemNameSystem",
  "description": "A concise description of what this system does.",
  "requiredComponents": [
    "ComponentA", "ComponentB" // IMPORTANT: List EVERY component your code below touches!
  ],
  "code": "function YourSystemNameSystem(world) {\\n  // Your JavaScript code here...\\n  // Example: const entities = query(world, [ComponentA, ComponentB]);\\n  // for (const eid of entities) { ... }\\n}"
}

REMEMBER:
- List ALL components used in queries, property access, or hasComponent checks in requiredComponents
- Regular systems CANNOT use getString/setString (only for async/LLM systems)
- System name must end with "System"
- Code must be a complete function`;

    // Use generateStructured to get a guaranteed JSON response
    const { generateStructured } = await import('../llm/interface.js');
    const design = await generateStructured(
      prompt,
      z.object({
        name: z.string().regex(/^[A-Z][a-zA-Z0-9]*System$/, 'System names must end with "System"'),
        description: z.string(),
        requiredComponents: z.array(z.string()),
        code: z.string(),
      })
    );

    // The LLM has now given us the name, dependencies, and code in a structured way
    const { name: systemName, description, requiredComponents, code: functionCode } = design;

    // Validate that the listed requiredComponents actually exist
    for (const compName of requiredComponents) {
      if (!globalRegistry.getComponent(compName)) {
        return {
          success: false,
          error: `System '${systemName}' requires a non-existent component: '${compName}'. Please create it first.`,
        };
      }
    }

    // Ensure the function code is properly formatted
    const finalCode = functionCode.includes('function') ? functionCode : `function ${systemName}(world) {\n${functionCode}\n}`;

    // Validate the generated code
    if (!validateGeneratedCode(finalCode)) {
      return {
        success: false,
        error: 'Generated system code failed validation',
        code: finalCode,
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
    const systemFunction = createSystemFunction(finalCode, requiredComponents);

    // Register the system
    const registered = globalRegistry.registerSystem(systemName, {
      name: systemName,
      description: description, // Use the description from the structured output
      requiredComponents: requiredComponents, // Use the dependencies from the structured output
      behavior: params.behavior,
      systemFn: systemFunction,
      code: finalCode,
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
    console.log(`   Description: ${description}`);
    console.log(`   Required: ${requiredComponents.join(', ')}`);

    return {
      success: true,
      systemName,
      systemFn: systemFunction,
      code: finalCode,
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