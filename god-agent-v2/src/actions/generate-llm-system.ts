/**
 * Generate LLM-Powered System Action
 * Allows God to create systems that themselves use AI for decision making
 */

import { World } from 'bitecs';
import { z } from 'zod';
import { callLLM } from '../llm/interface.js';
import { globalRegistry } from '../components/registry.js';
import { validateGeneratedCode } from '../llm/interface.js';
import { GodMode } from '../components/god-components.js';
import chalk from 'chalk';

export interface EcsGenerateLLMSystemParams {
  description: string;
  requiredComponents: string[];
  llmBehavior: string;
  llmModel?: 'flash' | 'flash25' | 'pro';
  examples?: string[];
}

export interface LLMSystemGenerationResult {
  success: boolean;
  systemName?: string;
  description?: string;
  code?: string;
  error?: string;
}

export async function ecsGenerateLLMSystem(
  _world: World,
  params: EcsGenerateLLMSystemParams,
  godEid: number
): Promise<LLMSystemGenerationResult> {
  console.log(chalk.magenta('🤖 Generating LLM-powered system...'));
  console.log(chalk.gray(`   Description: ${params.description}`));
  console.log(chalk.gray(`   LLM Behavior: ${params.llmBehavior}`));
  
  try {
    // Create a markdown-formatted list of all available components for the prompt
    const componentManifest = globalRegistry.listComponents().map(name => {
      const comp = globalRegistry.getComponent(name);
      if (!comp) return `- ${name} (error: not found)`;
      const props = comp.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `- **${name}**: { ${props} } // *${comp.schema?.description || 'No description'}*`;
    }).join('\n');

    // Generate system design using structured approach
    const prompt = `You are an expert ECS programmer. Create an async system that uses AI/LLM for decision making.

## TASK
**Description:** ${params.description}
**LLM Behavior:** ${params.llmBehavior}
${params.examples ? `**Example behaviors:**\n${params.examples.map(e => `- ${e}`).join('\n')}` : ''}

The system should:
${params.llmBehavior}

## AVAILABLE COMPONENTS
${componentManifest}

## IMPORTANT: You MUST use the exact component names from the available list above!

## CRITICAL REQUIREMENT FOR requiredComponents:
The requiredComponents array MUST include EVERY component that your system code references.
If your system uses query(world, [A, B]) or accesses A.x[eid] or hasComponent(world, eid, C), 
then A, B, and C MUST ALL be in requiredComponents: ["A", "B", "C"]

Example: If your system code contains:
- query(world, [NPC, Thought])
- Name.value[eid]
- setString(Message.content, eid, "text")
Then requiredComponents MUST be: ["NPC", "Thought", "Name", "Message"]

REMEMBER: Any component not in requiredComponents will be undefined and cause a ReferenceError!

## BitECS API REFERENCE

### CRITICAL: There is NO 'ecs' object!
- ✅ CORRECT: query(world, [Component])
- ❌ WRONG: ecs.query(world, [Component])

### Core Functions:
- query(world, [Component1, Component2]) - Returns array of entity IDs with ALL components
- addEntity(world) - Creates new entity, returns ID
- removeEntity(world, eid) - Removes entity
- addComponent(world, eid, Component) - Adds component to entity
- removeComponent(world, eid, Component) - Removes component
- hasComponent(world, eid, Component) - Check if entity has component
- entityExists(world, eid) - Check if entity exists

### Query Operators:
- And(C1, C2) or All(...) - Entity must have ALL (default)
- Or(C1, C2) or Any(...) - Entity must have ANY
- Not(C1, C2) or None(...) - Entity must have NONE

### Component Access (SoA format):
- Component.property[eid] - Read/write data
- Example: Position.x[eid] = 10;

### LLM Integration (CRITICAL):
- miniLLM(prompt: string) - Returns Promise<string> with RAW TEXT (not JSON!)
- To get JSON responses:
  1. Ask for JSON explicitly in your prompt
  2. ALWAYS wrap JSON.parse() in try/catch
  3. Have a fallback for non-JSON responses
- Example:
  ```
  const response = await miniLLM("Respond with JSON: {action: 'speak', message: '...'}");
  let action = 'speak', message = 'Hello';
  try {
    const data = JSON.parse(response);
    action = data.action || 'speak';
    message = data.message || 'Hello';
  } catch (e) {
    // Fallback: treat entire response as message
    message = response;
  }
  ```

### String Handling (CRITICAL - MUST USE CORRECTLY):
- getString(Component.prop, eid) - Get string value from component
- setString(Component.prop, eid, value) - Set string value in component
- CORRECT: const name = getString(NPCMind.name, eid);
- CORRECT: setString(NPCMind.thought, eid, "I am thinking...");
- WRONG: getString(NPCMind.name[eid]) - This will fail!
- WRONG: setString(NPCMind.thought[eid], "text") - This will fail!

The system should include:
1. Context gathering from components
2. LLM prompt construction
3. Response parsing and state updates
4. Error handling

Example async LLM system structure:
async function ExampleLLMSystem(world) {
  const entities = query(world, [Component1, Component2]);
  
  for (const eid of entities) {
    // 1. Gather context from components
    const context = {
      prop1: Component1.property[eid],
      prop2: Component2.property[eid]
    };
    
    // 2. Build prompt
    const prompt = \`Given context: \${JSON.stringify(context)}, decide what to do.\`;
    
    // 3. Call LLM
    const response = await miniLLM(prompt);
    
    // 4. Parse and apply response
    try {
      const decision = JSON.parse(response);
      Component1.property[eid] = decision.newValue;
    } catch (e) {
      console.error('Failed to parse:', e);
    }
  }
}

## YOUR RESPONSE
Fill out this JSON object. Do not add any extra text or explanations.

{
  "name": "YourSystemNameSystem",
  "description": "A concise description of what this AI-powered system does.",
  "requiredComponents": [
    "ComponentA", "ComponentB" // IMPORTANT: List EVERY component your code below touches!
  ],
  "code": "async function YourSystemNameSystem(world) {\\n  // Your async JavaScript code here...\\n  // Must use miniLLM for AI decisions\\n  // Example: const response = await miniLLM(prompt);\\n}"
}

REMEMBER:
- List ALL components used in queries, property access, or hasComponent checks in requiredComponents
- This is an ASYNC system - use async/await
- You MUST use miniLLM for AI functionality
- getString/setString ARE available in async systems
- System name must end with "System"
- Include error handling for LLM responses`;

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
    const finalCode = functionCode.includes('async function') ? functionCode : `async function ${systemName}(world) {\n${functionCode}\n}`;
    
    // Validate the generated code
    if (!validateGeneratedCode(finalCode)) {
      return {
        success: false,
        error: 'Generated code failed validation'
      };
    }
    
    // Register the system with async flag
    globalRegistry.registerSystem(systemName, {
      name: systemName,
      description: description,
      requiredComponents: requiredComponents, // Use the dependencies from structured output
      code: finalCode,
      isAsync: true,
      usesLLM: true,
      llmModel: params.llmModel || 'flash',
      timestamp: Date.now()
    });
    
    // Track creation
    GodMode.lastCreation[godEid] = Date.now();
    GodMode.createdCount[godEid]++;
    
    console.log(chalk.green(`✨ Created LLM-powered system: ${systemName}`));
    console.log(chalk.gray(`   Uses AI for: ${params.llmBehavior}`));
    console.log(chalk.gray(`   Required: ${requiredComponents.join(', ')}`));
    
    return {
      success: true,
      systemName: systemName,
      description: description,
      code: finalCode
    };
    
  } catch (error) {
    console.error(chalk.red('Failed to generate LLM system:'), error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Removed parseSystemResponse - no longer needed with structured output

// Example template for NPC consciousness system using proper BitECS API
export const NPC_CONSCIOUSNESS_TEMPLATE = `
async function NPCConsciousnessSystem(world) {
  // Query for NPCs with all required components
  const npcs = query(world, [NPCMind, Position, Memory]);
  
  for (const npc of npcs) {
    // Gather context from components
    const name = getString(NPCMind.name[npc]);
    const personality = getString(NPCMind.personality[npc]);
    const memories = getString(Memory.recent[npc]);
    
    // Find nearby entities using position data
    const nearbyEntities = [];
    const allEntities = query(world, [Position]);
    for (const eid of allEntities) {
      if (eid !== npc) {
        const dx = Position.x[eid] - Position.x[npc];
        const dy = Position.y[eid] - Position.y[npc];
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 100) {
          nearbyEntities.push(eid);
        }
      }
    }
    
    // Construct prompt for AI
    const llmPrompt = \`You are \${name}, \${personality}.
Recent memories: \${memories}
You see \${nearbyEntities.length} entities nearby.
Current goal: \${getString(NPCMind.currentGoal[npc])}

What do you think and what action do you want to take?
Respond with JSON: { "thought": "...", "action": "...", "speech": "..." }\`;
    
    // Call LLM
    const response = await miniLLM(llmPrompt);
    
    try {
      const decision = JSON.parse(response);
      
      // Update mental state
      if (decision.thought) {
        NPCMind.lastThought[npc] = setString(decision.thought);
      }
      
      // Handle actions - assuming ActionQueue component exists
      if (decision.action && hasComponent(world, npc, ActionQueue)) {
        ActionQueue.pending[npc] = setString(decision.action);
      }
      
      // Handle speech - assuming Dialogue component exists
      if (decision.speech && hasComponent(world, npc, Dialogue)) {
        Dialogue.text[npc] = setString(decision.speech);
        Dialogue.active[npc] = 1;
      }
      
    } catch (e) {
      console.error('Failed to parse NPC decision:', e);
    }
  }
}
`;