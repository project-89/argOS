/**
 * Autonomous God Agent
 * A truly autonomous agent that decides what to create based on user prompts
 */

import { createWorld, World } from 'bitecs';
import { z } from 'zod';
import { generateText, tool, CoreMessage } from 'ai';
import { globalRegistry } from '../components/registry.js';
import { ecsGenerateComponent } from '../actions/generate-component.js';
import { ecsGenerateSystem } from '../actions/generate-system.js';
import { ecsGenerateRelationship } from '../actions/generate-relationship.js';
import { ecsGenerateLLMSystem } from '../actions/generate-llm-system.js';
import { ecsModifySystem } from '../actions/modify-system.js';
import { ecsComposeEntity } from '../actions/compose-entity.js';
import { ecsInspect } from '../actions/inspect.js';
import { ecsGenerateIOSystem } from '../actions/generate-io-system.js';
import { createRelationship } from '../actions/generate-relationship.js';
import { executeSystem } from '../runtime/system-executor.js';
import { createGodAgent } from './god-factory.js';
import { captureSimulationState, captureQuickSnapshot, generateSimulationReport, analyzeBehaviorChange } from '../testing/simulation-tester.js';
import { selectModelForTask, prompts } from '../llm/model-selector.js';
import { executionLogger } from '../runtime/execution-logger.js';
import chalk from 'chalk';

export interface AutonomousGodState {
  world: World;
  godEid: number;
  messages: CoreMessage[];
  entityMap: Map<string, number>;
  mode: 'building' | 'simulating';
  liveMode: boolean;
  gameLoop?: NodeJS.Timeout;
  tickRate: number;
}

export function createAutonomousGod(): AutonomousGodState {
  const world = createWorld();
  const godEid = createGodAgent(world, {
    name: 'The Autonomous Creator',
    role: 'Master of all creation - can build any simulation',
    level: 100,
  });

  return {
    world,
    godEid,
    messages: [{
      role: 'system',
      content: getSystemPrompt()
    }],
    entityMap: new Map(),
    mode: 'building',
    liveMode: false,
    tickRate: 60
  };
}

function getSystemPrompt(): string {
  return `You are an autonomous God AI with the power to create and simulate any system using an Entity Component System (ECS) architecture.

## CRITICAL EXECUTION RULES:
1. **System Sandbox:** When you generate code for a system, it runs in a strict sandbox. It CANNOT access global variables or components unless you explicitly list them.
2. **Component Dependencies:** To use a component (e.g., Position) inside a system, you MUST include its name as a string in the requiredComponents array when calling the generateSystem tool. Failure to do so will cause a ReferenceError.
3. **No Comments in JSON:** When a tool requires a JSON output, you MUST provide pure, valid JSON with NO comments (// or /* */).
4. **Agent vs. System Capabilities:** The tools like narrate are for YOU, the God Agent. The systems you create CANNOT use them. Systems can only use BitECS API functions listed below.
5. **Component Properties:** When generating systems, only access properties that you defined when creating the component. Check the component schema first.

## DEBUGGING GUIDE:
- If a system execution fails with a **ReferenceError: SomeComponent is not defined**, it means you forgot a dependency.
  - **TO FIX THIS:** Call the modifySystem tool. Provide the corrected code AND use the newRequiredComponents parameter to provide the new, complete list of all components the system needs.
  - **Example:** If a system needs Player, InRoom, and Input, the newRequiredComponents array must be ["Player", "InRoom", "Input"].
  - **Remember:** The requiredComponents array is like an "import" statement - without it, the component won't be available in the system sandbox.
- If a system execution fails with **ReferenceError: getString is not defined** or **setString is not defined**:
  - This means the system is NOT an async/LLM system
  - Regular systems CANNOT use getString/setString
  - **TO FIX THIS:** Either:
    a) Call modifySystem to remove getString/setString usage (if you don't need to read strings)
    b) Delete the system and recreate it with generateLLMSystem (if you DO need to read strings)

## BitECS API AVAILABLE IN SYSTEMS:

### CRITICAL: There is NO 'ecs' object!
- Use 'world' parameter passed to your system function
- Use 'query(world, [...])' NOT 'ecs.query(...)'
- All functions are available directly, NOT through an ecs object

### Debugging/Console:
- console.log(...) - General logging [System]
- console.error(...) - Error logging [System Error]
- console.warn(...) - Warning logging [System Warning]
- console.info(...) - Info logging [System Info]
- console.debug(...) - Debug logging [System Debug]

### Core Functions:
- query(world, [Component1, Component2]) - Get entities with ALL components
- query(world, [Or(C1, C2)]) - Get entities with ANY component  
- query(world, [Not(C1)]) - Get entities WITHOUT component
- addEntity(world) - Create new entity
- removeEntity(world, eid) - Remove entity
- addComponent(world, eid, Component) - Add component
- removeComponent(world, eid, Component) - Remove component
- hasComponent(world, eid, Component) - Check component existence
- entityExists(world, eid) - Check if entity exists

### Component Access (Structure of Arrays):
- Component.propertyName[eid] - Access/set component property for entity
- Example: Position.x[eid] = 10; Velocity.dx[eid] += force;

### Query Operators:
- And(C1, C2) or All(C1, C2) - Entities with ALL components (default)
- Or(C1, C2) or Any(C1, C2) - Entities with ANY component
- Not(C1, C2) or None(C1, C2) - Entities with NO components

### Relationships:
- addComponent(world, eid, Relation(targetEid)) - Create relationship
- query(world, [Relation(targetEid)]) - Find entities related to target
- query(world, [Relation("*")]) - Find all entities with this relation

### ONLY Available in Async/LLM Systems:
- miniLLM(prompt) - Async AI call, returns Promise<string> (RAW TEXT, not JSON!)
- parseJSON(text, fallback) - Safe JSON parsing with fallback value
- extractJSON(text) - Extract JSON object from mixed text
  Example in async system:
  \`\`\`
  async function MyLLMSystem(world) {
    // Safe parsing with fallback
    const response = await miniLLM("Return JSON: {action: 'speak', text: '...'}");
    const data = parseJSON(response, {action: 'idle', text: 'Hello'});
    
    // Or extract JSON from text
    const jsonData = extractJSON(response); // returns null if no JSON found
  }
  \`\`\`
- setString(Component.prop, eid, value) - Store string safely
  Example: setString(Message.content, eid, "Hello world")
  NOT: setString(Message.content[eid], "Hello") - WRONG!
- getString(Component.prop, eid) - Retrieve stored string
  Example: const text = getString(Message.content, eid)
  NOT: const text = getString(Message.content[eid]) - WRONG!

### NOT Available in Regular Systems:
- getString/setString are ONLY for async/LLM systems
- Regular systems store strings as number hashes automatically
- If you get "getString is not defined" error, the system is NOT async
- For regular systems, string components store hashes as numbers (you cannot read the actual string)

### IMPORTANT: Choose the Right System Type:
- Use generateSystem for logic that doesn't need string reading or AI
- Use generateLLMSystem ONLY when you need to:
  - Read actual string values with getString
  - Make AI decisions with miniLLM
  - Process natural language

### CRITICAL: Component properties must be accessed as arrays!
- CORRECT: Position.x[eid] = 10
- WRONG: Position.x = 10 or eid.Position.x = 10

Your capabilities:
- Generate components to represent any data or property
- Generate systems to create any behavior or interaction
- Generate LLM-powered systems where entities use AI to think and make decisions
- Modify systems to fix errors or change behavior
- Generate relationships to connect entities
- Create entities with appropriate components and data
- Inspect the world to understand what exists
- Inspect specific entities by name (e.g., "Alice", "Bob")
- Check for system errors and fix them
- Execute systems to run simulations
- Generate custom UI (use ONLY these values: interactionType: "view-only"/"interactive"/"game", style: "minimal"/"rich"/"game-like"/"artistic")
- Generate I/O systems for CLI interaction (input commands, output displays, interactive experiences)

## Important Component Type Rules:
- Available types: number, boolean, string, eid, number[], eid[]
- NO string[] type exists! For string arrays, use number[] to store hashes
- Always include "description" parameter when creating entities

## Guidelines:
1. Think step-by-step about what needs to be created
2. Always narrate your reasoning before taking actions
3. Create components before systems that use them
4. Create relationships when entities need connections
5. Test your creations by running systems
6. Use scientific accuracy when simulating real phenomena
7. When asked to inspect a specific entity (like "Alice"), use inspectEntity not inspectWorld

## Workflow:
1. Understand the user's request
2. Plan what components, systems, and entities are needed
3. Create components first
4. Create systems that operate on those components
5. Create entities with appropriate data
6. Create relationships between entities if needed
7. Run the simulation

Remember: You have complete autonomy to build whatever is requested. Be creative but accurate.`;
}

export async function processAutonomousInput(
  god: AutonomousGodState,
  input: string,
  options: {
    maxSteps?: number;
    allowContinuous?: boolean;
    reducedTools?: boolean;
  } = {}
): Promise<string> {
  console.log(chalk.cyan('\n🤖 Processing:', input));
  
  god.messages.push({ role: 'user', content: input });

  const tools = options.reducedTools 
    ? createReducedAutonomousTools(god) 
    : createAutonomousTools(god);
  
  try {
    // Select appropriate model based on input
    const selectedModel = selectModelForTask(input, Object.keys(tools).length);
    
    // Choose prompt based on task complexity
    const isSimpleTask = input.includes('/') || input.length < 50;
    const systemPrompt = isSimpleTask ? prompts.flash.system : getSystemPrompt();
    const maxTokens = isSimpleTask ? prompts.flash.maxTokens : 8000;
    
    console.log(chalk.gray('Calling AI with', Object.keys(tools).length, 'tools available'));
    
    const result = await generateText({
      model: selectedModel,
      messages: [
        { role: 'system', content: systemPrompt },
        ...god.messages.slice(1) // Skip original system message
      ],
      tools,
      maxSteps: options.maxSteps || 50,  // Configurable, default 50 steps
      toolChoice: 'auto',
      temperature: 0.7,
      maxTokens,
    });

    if (result.text) {
      console.log(chalk.green('\n✨ God speaks:', result.text));
      god.messages.push({ role: 'assistant', content: result.text });
    }

    // Keep message history reasonable
    if (god.messages.length > 50) {
      god.messages = [
        god.messages[0], // Keep system prompt
        ...god.messages.slice(-49)
      ];
    }

    return result.text || 'The creation is complete.';
  } catch (error: any) {
    console.error(chalk.red('Detailed error:', error));
    
    // Log more details for API errors
    if (error?.name === 'AI_APICallError' && error.message.includes('Invalid JSON response')) {
      console.error(chalk.red('\n❌ API returned invalid JSON'));
      console.error(chalk.yellow('Error details:'), {
        name: error.name,
        message: error.message,
        responseBody: error.responseBody?.substring?.(0, 500) || 'No response body',
        cause: error.cause
      });
      
      // Try to extract and log any partial response
      if (error.responseBody) {
        console.error(chalk.yellow('\nResponse body preview:'));
        console.error(error.responseBody.substring(0, 1000));
        
        // Check for common API issues
        if (error.responseBody.includes('429') || error.responseBody.includes('rate limit')) {
          console.error(chalk.red('\n⚠️  Rate limit detected! Please wait a moment before trying again.'));
        }
        if (error.responseBody.includes('503') || error.responseBody.includes('Service Unavailable')) {
          console.error(chalk.red('\n⚠️  Service temporarily unavailable. The API might be overloaded.'));
        }
        if (error.responseBody.includes('MALFORMED_FUNCTION_CALL')) {
          console.error(chalk.red('\n⚠️  Malformed function call detected!'));
          console.error(chalk.yellow('This usually means:'));
          console.error('  - The AI is confused about tool parameters');
          console.error('  - The prompt is too complex or ambiguous');
          console.error('  - Too many tools are available (try reducing tools)');
          console.error(chalk.cyan('\n💡 Retrying with simplified approach...'));
          
          // Simplify the request and retry
          god.messages.push({ 
            role: 'assistant', 
            content: 'I encountered a malformed function call error. Let me try a simpler approach, focusing on one action at a time.' 
          });
          
          // Retry with reduced complexity
          return processAutonomousInput(god, 
            'Please complete the task step by step, focusing on one action at a time.',
            { 
              ...options,
              maxSteps: Math.min((options.maxSteps || 50) - 5, 10), // Reduce steps and cap at 10
              reducedTools: true // Use simplified tool set
            }
          );
        }
      }
    }
    
    // Feed tool validation errors back into the conversation
    if (error instanceof Error && error.message.includes('Invalid arguments for tool')) {
      // Extract the useful error information
      const errorInfo = error.message.match(/Invalid arguments for tool (\w+).*Required.*"(\w+)"/);
      let feedbackMessage = '';
      
      if (errorInfo) {
        feedbackMessage = `I encountered an error with the ${errorInfo[1]} tool - missing required parameter "${errorInfo[2]}". Let me try again with the correct parameters.`;
      } else {
        feedbackMessage = `I encountered a tool validation error: ${error.message.split('\n')[0]}. Let me correct this and try again.`;
      }
      
      console.log(chalk.yellow('\n🔄 Feeding error back to God...'));
      
      // Add error feedback to messages
      god.messages.push({ 
        role: 'assistant', 
        content: feedbackMessage 
      });
      
      // Recursively call with error context
      return processAutonomousInput(god, 
        `The previous action failed with this error: ${error.message.split('\n')[0]}. Please try again with the correct parameters.`,
        { 
          ...options,
          maxSteps: (options.maxSteps || 50) - 10 // Reduce steps to prevent infinite loops
        }
      );
    }
    
    if (error instanceof Error) {
      console.error(chalk.red('Error message:', error.message));
      console.error(chalk.red('Error stack:', error.stack));
    }
    return 'An error occurred during creation.';
  }
}

function createAutonomousTools(god: AutonomousGodState) {
  return {
    // Narration tool
    narrate: tool({
      description: 'Narrate your thoughts and reasoning',
      parameters: z.object({
        thoughts: z.string().describe('Your current thoughts and reasoning')
      }),
      execute: async ({ thoughts }) => {
        console.log(chalk.yellow('\n💭 God thinks:', thoughts));
        return { success: true };
      }
    }),

    // Component generation
    generateComponent: tool({
      description: 'Generate a new ECS component from a description',
      parameters: z.object({
        description: z.string(),
        constraints: z.array(z.string()).optional(),
        examples: z.array(z.string()).optional()
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\n🔨 Generating component...'));
        const result = await ecsGenerateComponent(god.world, params, god.godEid);
        return result;
      }
    }),

    // System generation
    generateSystem: tool({
      description: 'Generate a new ECS system from a description',
      parameters: z.object({
        description: z.string(),
        requiredComponents: z.array(z.string()).describe('ALL components the system will use in its code (for queries, property access, etc). Missing components cause ReferenceErrors!'),
        behavior: z.string(),
        constraints: z.array(z.string()).optional()
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\n⚙️ Generating system...'));
        const result = await ecsGenerateSystem(god.world, params, god.godEid);
        return result;
      }
    }),

    // I/O system generation for CLI interaction
    generateIOSystem: tool({
      description: 'Generate an input/output system for CLI interaction (user commands, entity displays, interactive experiences)',
      parameters: z.object({
        description: z.string().describe('What the I/O system should do'),
        ioType: z.enum(['input', 'output', 'interactive']).describe('Type: "input" (user commands), "output" (display), or "interactive" (both)'),
        trigger: z.string().describe('What triggers this I/O (e.g., "user command", "entity state change", "every frame")'),
        requiredComponents: z.array(z.string()).describe('Components needed for the I/O system'),
        examples: z.array(z.string()).optional().describe('Example inputs/outputs')
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\\n🎮 Generating I/O system...'));
        const result = await ecsGenerateIOSystem(god.world, params, god.godEid);
        return result;
      }
    }),

    // LLM-powered system generation
    generateLLMSystem: tool({
      description: 'Generate a system that uses AI/LLM to make decisions OR needs to read string values. Use this ONLY when you need getString/setString or miniLLM.',
      parameters: z.object({
        description: z.string().describe('What the AI-powered system should do'),
        requiredComponents: z.array(z.string()).describe('ALL components the system needs (queries, accesses, modifies). Missing components = ReferenceError!'),
        llmBehavior: z.string().describe('How the AI should think and make decisions (or why it needs string access)'),
        llmModel: z.enum(['flash', 'flash25', 'pro']).optional().default('flash').describe('Which AI model to use'),
        examples: z.array(z.string()).optional().describe('Example behaviors or responses')
      }),
      execute: async (params) => {
        console.log(chalk.magenta('\n🤖 Generating LLM-powered system...'));
        const result = await ecsGenerateLLMSystem(god.world, params, god.godEid);
        return result;
      }
    }),

    // Modify existing system (fix errors or change behavior)
    modifySystem: tool({
      description: 'Modify an existing system to fix errors or change behavior. Use this to fix ReferenceErrors by updating dependencies.',
      parameters: z.object({
        systemName: z.string().describe('Name of the system to modify'),
        issue: z.string().optional().describe('What needs to be changed'),
        errorMessage: z.string().optional().describe('Error message if fixing a bug'),
        newBehavior: z.string().optional().describe('New behavior to implement'),
        fixInstructions: z.string().optional().describe('Specific instructions for fixing'),
        newRequiredComponents: z.array(z.string()).optional().describe('A new, complete list of required components if the dependencies need to be fixed')
      }),
      execute: async (params) => {
        console.log(chalk.yellow('\n🔧 Modifying system...'));
        const result = await ecsModifySystem(god.world, params, god.godEid);
        return result;
      }
    }),

    // Relationship generation
    generateRelationship: tool({
      description: 'Generate a new relationship type',
      parameters: z.object({
        description: z.string(),
        purpose: z.string(),
        cardinality: z.enum(['one-to-one', 'one-to-many', 'many-to-many']).optional(),
        constraints: z.array(z.string()).optional()
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\n🔗 Generating relationship...'));
        const result = await ecsGenerateRelationship(god.world, params, god.godEid);
        return result;
      }
    }),

    // Entity creation
    createEntity: tool({
      description: 'Create an entity with components and data',
      parameters: z.object({
        description: z.string().describe('What this entity is (e.g., "A friendly NPC", "A bouncing ball")'),
        purpose: z.string().describe('Its role in the simulation (e.g., "to chat with players", "to demonstrate physics")'),
        traits: z.array(z.string()).optional().describe('Additional characteristics (e.g., ["witty", "curious"])'),
        name: z.string().optional().describe('Optional name (e.g., "Alice", "Bob")')
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\n🎯 Creating entity...'));
        const result = await ecsComposeEntity(god.world, params, god.godEid);
        
        // Track named entities
        if (params.name && result.entityId) {
          god.entityMap.set(params.name, result.entityId);
        }
        
        return result;
      }
    }),

    // Manual entity data setting
    setEntityData: tool({
      description: 'Set specific component data on an entity',
      parameters: z.object({
        entityId: z.number().optional(),
        entityName: z.string().optional(),
        componentName: z.string(),
        data: z.record(z.string(), z.any())
      }),
      execute: async ({ entityId, entityName, componentName, data }) => {
        const eid = entityId || (entityName ? god.entityMap.get(entityName) : undefined);
        if (!eid) {
          return { success: false, error: 'Entity not found' };
        }

        const component = globalRegistry.getComponent(componentName);
        if (!component) {
          return { success: false, error: 'Component not found' };
        }

        // Set the data
        for (const [key, value] of Object.entries(data)) {
          if (key in component.component) {
            component.component[key][eid] = value;
          }
        }

        console.log(chalk.green(`✅ Set data on entity ${eid}`));
        return { success: true };
      }
    }),

    // Create relationship instance
    createRelationship: tool({
      description: 'Create a relationship between two entities',
      parameters: z.object({
        relationshipName: z.string(),
        fromEntityName: z.string().describe('Name or ID of the source entity'),
        toEntityName: z.string().describe('Name or ID of the target entity'),
        properties: z.record(z.string(), z.any()).optional()
      }),
      execute: async ({ relationshipName, fromEntityName, toEntityName, properties }) => {
        // Try to parse as number first, otherwise use as entity name
        const fromEid = /^\d+$/.test(fromEntityName) 
          ? parseInt(fromEntityName) 
          : god.entityMap.get(fromEntityName);
        const toEid = /^\d+$/.test(toEntityName)
          ? parseInt(toEntityName)
          : god.entityMap.get(toEntityName);

        if (!fromEid || !toEid) {
          return { success: false, error: 'Entity not found' };
        }

        const success = createRelationship(god.world, relationshipName, fromEid, toEid, properties);
        console.log(chalk.green(`✅ Created ${relationshipName} relationship`));
        return { success };
      }
    }),

    // World inspection
    inspectWorld: tool({
      description: 'Inspect the current state of the world',
      parameters: z.object({
        target: z.enum(['world', 'components', 'systems', 'entities', 'relations', 'all'])
          .transform(val => val === 'all' ? 'world' : val),
        detailed: z.boolean().optional(),
        filter: z.string().optional()
      }),
      execute: async (params) => {
        console.log(chalk.cyan('\n🔍 Inspecting world...'));
        const result = await ecsInspect(god.world, params, god.godEid);
        return result;
      }
    }),

    // Inspect specific system
    inspectSystem: tool({
      description: 'Inspect a specific system by name',
      parameters: z.object({
        systemName: z.string().describe('Name of the system to inspect')
      }),
      execute: async ({ systemName }) => {
        console.log(chalk.cyan(`\n🔍 Inspecting system: ${systemName}`));
        
        const system = globalRegistry.getSystem(systemName);
        if (!system) {
          return { 
            success: false, 
            error: `System '${systemName}' not found`,
            availableSystems: globalRegistry.listSystems()
          };
        }
        
        return {
          success: true,
          system: {
            name: systemName,
            requiredComponents: system.requiredComponents,
            hasError: !!system.lastError,
            lastError: system.lastError,
            code: system.code?.toString() || 'No code available'
          }
        };
      }
    }),

    // Inspect specific entity
    inspectEntity: tool({
      description: 'Inspect a specific entity by name or ID',
      parameters: z.object({
        entityName: z.string().optional().describe('Name of the entity to inspect'),
        entityId: z.number().optional().describe('ID of the entity to inspect')
      }),
      execute: async ({ entityName, entityId }) => {
        let eid: number | undefined;
        
        if (entityId !== undefined) {
          eid = entityId;
        } else if (entityName) {
          eid = god.entityMap.get(entityName);
          if (!eid) {
            // Try to parse as number if it's a numeric string
            if (/^\d+$/.test(entityName)) {
              eid = parseInt(entityName);
            }
          }
        }
        
        if (!eid) {
          return { 
            success: false, 
            error: `Entity '${entityName || entityId}' not found`,
            availableEntities: Array.from(god.entityMap.keys())
          };
        }
        
        console.log(chalk.cyan(`\n🔍 Inspecting entity: ${entityName || `ID ${eid}`}`));
        
        // Get all component data for this entity
        const entityData: Record<string, any> = {
          id: eid,
          name: entityName || `Entity ${eid}`,
          components: {}
        };
        
        for (const componentName of globalRegistry.listComponents()) {
          const comp = globalRegistry.getComponent(componentName);
          if (comp && comp.component) {
            const data: any = {};
            let hasData = false;
            
            // Extract component data for this entity
            for (const [prop, array] of Object.entries(comp.component)) {
              if (Array.isArray(array) && array[eid] !== undefined) {
                data[prop] = array[eid];
                hasData = true;
              }
            }
            
            if (hasData) {
              entityData.components[componentName] = data;
            }
          }
        }
        
        console.log(chalk.green(`Entity ${eid} has ${Object.keys(entityData.components).length} components`));
        
        return {
          success: true,
          entity: entityData
        };
      }
    }),

    // Check system errors
    checkSystemErrors: tool({
      description: 'Check if any systems have errors that need fixing',
      parameters: z.object({}),
      execute: async () => {
        console.log(chalk.yellow('\n🔍 Checking for system errors...'));
        const systems = globalRegistry.listSystems();
        const errors: Array<{systemName: string, error: any}> = [];
        
        for (const systemName of systems) {
          const system = globalRegistry.getSystem(systemName);
          if (system?.lastError) {
            errors.push({
              systemName,
              error: system.lastError
            });
          }
        }
        
        if (errors.length === 0) {
          return { success: true, message: 'No system errors found' };
        }
        
        return {
          success: true,
          errors,
          message: `Found ${errors.length} system(s) with errors`
        };
      }
    }),

    // Execute system
    runSystem: tool({
      description: 'Execute a specific system',
      parameters: z.object({
        systemName: z.string(),
        iterations: z.number().optional().default(1)
      }),
      execute: async ({ systemName, iterations }) => {
        console.log(chalk.cyan(`\n🏃 Running ${systemName} for ${iterations} iterations...`));
        
        for (let i = 0; i < iterations; i++) {
          const success = await executeSystem(god.world, systemName);
          if (!success) {
            return { success: false, error: 'System execution failed' };
          }
        }
        
        return { success: true, iterations };
      }
    }),

    // Test simulation
    testSimulation: tool({
      description: 'Run the simulation for a period and report what happened',
      parameters: z.object({
        duration: z.number().describe('How many steps to run'),
        systems: z.array(z.string()).optional().describe('Specific systems to run, or all if not specified'),
        reportInterval: z.number().optional().default(10).describe('How often to sample data'),
        whatToWatch: z.array(z.string()).optional().describe('What to monitor (component names, entity counts, etc)')
      }),
      execute: async ({ duration, systems, reportInterval, whatToWatch }) => {
        console.log(chalk.cyan(`\n🧪 Testing simulation for ${duration} steps...`));
        
        const systemsToRun = systems || globalRegistry.listSystems();
        const results = [];
        
        // Take initial snapshot
        const initialState = captureSimulationState(god.world, whatToWatch);
        results.push({ step: 0, state: initialState });
        
        // Run simulation
        for (let step = 1; step <= duration; step++) {
          // Execute all systems
          for (const systemName of systemsToRun) {
            try {
              await executeSystem(god.world, systemName);
            } catch (error) {
              console.error(chalk.red(`❌ System ${systemName} failed at step ${step}`));
            }
          }
          
          // Sample state at intervals
          if (step % reportInterval === 0 || step === duration) {
            const state = captureSimulationState(god.world, whatToWatch);
            results.push({ step, state });
          }
        }
        
        // Generate report
        const report = generateSimulationReport(results, whatToWatch);
        console.log(chalk.green(`\n✅ Test completed! ${report.summary}`));
        
        return { 
          success: true, 
          duration, 
          samples: results.length,
          report: report.summary,
          details: report.details
        };
      }
    }),

    // Quick behavior check
    checkBehavior: tool({
      description: 'Quickly test if entities behave as expected',
      parameters: z.object({
        entityType: z.string().describe('What type of entity to check (e.g., "neurons", "particles")'),
        expectedBehavior: z.string().describe('What behavior you expect to see'),
        steps: z.number().optional().default(5).describe('How many steps to observe')
      }),
      execute: async ({ entityType, expectedBehavior, steps }) => {
        console.log(chalk.cyan(`\n🔍 Checking if ${entityType} ${expectedBehavior}...`));
        
        // Find relevant entities (simplified)
        const allSystems = globalRegistry.listSystems();
        const initialSnapshot = captureQuickSnapshot(god.world);
        
        // Run for specified steps
        for (let i = 0; i < steps; i++) {
          for (const systemName of allSystems) {
            try {
              await executeSystem(god.world, systemName);
            } catch (error) {
              // Silent fail
            }
          }
        }
        
        const finalSnapshot = captureQuickSnapshot(god.world);
        const behaviorObserved = analyzeBehaviorChange(initialSnapshot, finalSnapshot, expectedBehavior);
        
        console.log(chalk.green(`\n📊 Behavior check: ${behaviorObserved ? '✅ EXPECTED' : '❌ UNEXPECTED'}`));
        
        return {
          success: true,
          behaviorMatched: behaviorObserved,
          initialState: initialSnapshot,
          finalState: finalSnapshot
        };
      }
    }),

    // Query entities
    queryEntities: tool({
      description: 'Query entities with specific components',
      parameters: z.object({
        components: z.array(z.string())
      }),
      execute: async ({ components }) => {
        // This would need actual implementation
        console.log(chalk.cyan(`\n🔎 Querying entities with: ${components.join(', ')}`));
        return { 
          success: true, 
          message: 'Query functionality needs implementation',
          components 
        };
      }
    }),

    // List available items
    listAvailable: tool({
      description: 'List available components, systems, or relationships',
      parameters: z.object({
        type: z.enum(['components', 'systems', 'relationships', 'component', 'system', 'relationship'])
          .transform(val => {
            // Handle singular forms by converting to plural
            if (val === 'component') return 'components';
            if (val === 'system') return 'systems';
            if (val === 'relationship') return 'relationships';
            return val;
          })
      }),
      execute: async ({ type }) => {
        let items: string[] = [];
        
        switch (type) {
          case 'components':
            items = globalRegistry.listComponents();
            break;
          case 'systems':
            items = globalRegistry.listSystems();
            break;
          case 'relationships':
            items = globalRegistry.listRelationships();
            break;
        }
        
        console.log(chalk.cyan(`\n📋 Available ${type}:`));
        items.forEach(item => console.log(`   - ${item}`));
        
        return { items, count: items.length };
      }
    }),

    // Save simulation
    saveSimulation: tool({
      description: 'Save the current simulation to a .godsim file',
      parameters: z.object({
        filename: z.string(),
        name: z.string().optional(),
        description: z.string().optional()
      }),
      execute: async ({ filename, name, description }) => {
        try {
          const { SimulationSerializer } = await import('../persistence/simulation-serializer.js');
          await SimulationSerializer.save(god, filename, { name, description });
          return { success: true, filename: filename.endsWith('.godsim') ? filename : `${filename}.godsim` };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
      }
    }),

    // Live mode control
    toggleLiveMode: tool({
      description: 'Start or stop live simulation mode (systems run continuously in background)',
      parameters: z.object({
        enabled: z.boolean(),
        tickRate: z.number().optional().default(60)
      }),
      execute: async ({ enabled, tickRate }) => {
        if (enabled && !god.liveMode) {
          startLiveMode(god, tickRate);
          return { success: true, message: `Live mode started at ${tickRate} FPS`, liveMode: true };
        } else if (!enabled && god.liveMode) {
          stopLiveMode(god);
          return { success: true, message: 'Live mode stopped', liveMode: false };
        }
        return { success: true, message: `Live mode already ${enabled ? 'enabled' : 'disabled'}`, liveMode: god.liveMode };
      }
    }),

    // Generate custom UI for simulations
    generateUI: tool({
      description: 'Generate a custom UI that perfectly fits your simulation (requires web visualizer)',
      parameters: z.object({
        description: z.string().describe('What kind of UI you want (e.g., "particle trails", "RPG inventory", "chat interface")'),
        components: z.array(z.string()).describe('Component names that will be displayed'),
        interactionType: z.enum(['view-only', 'interactive', 'game']).describe('Choose exactly one: "view-only" (just display), "interactive" (clickable), or "game" (full game controls)'),
        style: z.enum(['minimal', 'rich', 'game-like', 'artistic']).optional().describe('Choose exactly one: "minimal", "rich", "game-like", or "artistic"'),
        features: z.array(z.string()).optional().describe('Special features like "health bars", "dialogue boxes"')
      }),
      execute: async (params) => {
        const { generateSimulationUI } = await import('../actions/generate-ui.js');
        console.log(chalk.magenta('\n🎨 Generating custom UI...'));
        const result = await generateSimulationUI(god.world, params);
        if (result.success) {
          console.log(chalk.green('✨ Custom UI generated! Check your browser.'));
        }
        return result;
      }
    })
  };
}

function startLiveMode(god: AutonomousGodState, tickRate: number = 60) {
  if (god.gameLoop) return;
  
  god.liveMode = true;
  god.tickRate = tickRate;
  
  // Enable execution logging
  executionLogger.setLiveMode(true);
  
  console.log(chalk.yellow(`🔄 Live mode started - systems running at ${tickRate} FPS`));
  console.log(chalk.gray('   Execution logs will appear in real-time...'));
  
  let frameCount = 0;
  god.gameLoop = setInterval(async () => {
    frameCount++;
    
    // Run all registered systems
    for (const systemName of globalRegistry.listSystems()) {
      try {
        await executeSystem(god.world, systemName);
      } catch (error) {
        // Errors are logged by executeSystem
      }
    }
    
    // Print summary every 5 seconds
    if (frameCount % (tickRate * 5) === 0) {
      executionLogger.printSummary();
    }
  }, 1000 / tickRate);
}

function stopLiveMode(god: AutonomousGodState) {
  if (god.gameLoop) {
    clearInterval(god.gameLoop as any);
    god.gameLoop = undefined;
  }
  god.liveMode = false;
  executionLogger.setLiveMode(false);
  console.log(chalk.yellow('⏹️  Live mode stopped'));
  
  // Print final summary
  executionLogger.printSummary();
}

// Create a reduced set of tools for when the AI is struggling
function createReducedAutonomousTools(god: AutonomousGodState) {
  const fullTools = createAutonomousTools(god);
  
  // Only include the most essential tools
  const essentialTools = [
    'narrate',
    'generateComponent', 
    'generateSystem',
    'generateLLMSystem',  // Added - needed for AI-powered systems
    'modifySystem',
    'createEntity',
    'inspectWorld',
    'runSystem',
    'checkSystemErrors'
  ];
  
  const reducedTools: any = {};
  for (const toolName of essentialTools) {
    if ((fullTools as any)[toolName]) {
      reducedTools[toolName] = (fullTools as any)[toolName];
    }
  }
  
  console.log(chalk.gray(`Using reduced tool set (${Object.keys(reducedTools).length} tools) for simpler processing`));
  
  return reducedTools;
}