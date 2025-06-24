/**
 * Generate LLM-Powered System Action
 * Allows God to create systems that themselves use AI for decision making
 */

import { World } from 'bitecs';
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
    // Get list of all available components
    const availableComponents = globalRegistry.listComponents();
    const componentDescriptions = availableComponents.map(name => {
      const comp = globalRegistry.getComponent(name);
      const props = comp?.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `  - ${name} (${props})`;
    }).join('\n');

    // Generate system design
    const prompt = `Create an ECS system that uses LLM for: ${params.description}

The system should:
${params.llmBehavior}

Required components: ${params.requiredComponents.join(', ')}

## AVAILABLE COMPONENTS IN THE SYSTEM:
${componentDescriptions}

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

### LLM Integration:
- miniLLM(prompt: string) - Async function that calls AI
- Always use try/catch for JSON parsing
- Handle errors gracefully

### String Handling (if using string components):
- getString(hash: number) - Convert hash to string
- setString(text: string) - Convert string to hash
- Example: const name = getString(NPCMind.name[eid]);

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

Return a JSON object with:
{
  "name": "SystemNameSystem",
  "description": "What it does",
  "code": "complete async function code"
}`;

    const response = await callLLM(prompt);
    const result = parseSystemResponse(response);
    
    if (!result) {
      return {
        success: false,
        error: 'Failed to parse LLM response'
      };
    }
    
    // Validate the generated code
    if (!validateGeneratedCode(result.code)) {
      return {
        success: false,
        error: 'Generated code failed validation'
      };
    }
    
    // Register the system with async flag
    globalRegistry.registerSystem(result.name, {
      name: result.name,
      description: result.description,
      requiredComponents: params.requiredComponents,
      code: result.code,
      isAsync: true,
      usesLLM: true,
      llmModel: params.llmModel || 'flash',
      timestamp: Date.now()
    });
    
    // Track creation
    GodMode.lastCreation[godEid] = Date.now();
    GodMode.createdCount[godEid]++;
    
    console.log(chalk.green(`✨ Created LLM-powered system: ${result.name}`));
    console.log(chalk.gray(`   Uses AI for: ${params.llmBehavior}`));
    
    return {
      success: true,
      systemName: result.name,
      description: result.description,
      code: result.code
    };
    
  } catch (error) {
    console.error(chalk.red('Failed to generate LLM system:'), error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

function parseSystemResponse(response: string): any {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Fallback: try to extract code blocks
    const codeMatch = response.match(/```(?:javascript|typescript|js|ts)?\n([\s\S]+?)\n```/);
    const nameMatch = response.match(/(?:name|system):\s*["']?(\w+System)["']?/i);
    
    if (codeMatch && nameMatch) {
      return {
        name: nameMatch[1],
        description: 'LLM-powered system',
        code: codeMatch[1]
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to parse system response:', error);
    return null;
  }
}

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