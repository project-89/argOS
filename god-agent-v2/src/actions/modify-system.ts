/**
 * Modify System Action
 * Allows God to update and fix existing systems based on errors or new requirements
 */

import { World } from 'bitecs';
import { callLLM } from '../llm/interface.js';
import { globalRegistry } from '../components/registry.js';
import { validateGeneratedCode } from '../llm/interface.js';
import { GodMode } from '../components/god-components.js';
import chalk from 'chalk';

export interface EcsModifySystemParams {
  systemName: string;
  issue?: string;
  errorMessage?: string;
  newBehavior?: string;
  fixInstructions?: string;
  newRequiredComponents?: string[]; // NEW: Allow updating system dependencies
}

export interface ModifySystemResult {
  success: boolean;
  systemName?: string;
  previousCode?: string;
  newCode?: string;
  changes?: string;
  error?: string;
}

export async function ecsModifySystem(
  _world: World,
  params: EcsModifySystemParams,
  godEid: number
): Promise<ModifySystemResult> {
  console.log(chalk.yellow('🔧 Modifying system...'));
  console.log(chalk.gray(`   System: ${params.systemName}`));
  if (params.errorMessage) {
    console.log(chalk.red(`   Error: ${params.errorMessage}`));
  }
  
  try {
    // Get existing system
    const existingSystem = globalRegistry.getSystem(params.systemName);
    if (!existingSystem || !existingSystem.code) {
      return {
        success: false,
        error: `System ${params.systemName} not found`
      };
    }
    
    // Get list of all available components
    const availableComponents = globalRegistry.listComponents();
    const componentDescriptions = availableComponents.map(name => {
      const comp = globalRegistry.getComponent(name);
      const props = comp?.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `  - ${name} (${props})`;
    }).join('\n');

    // Build modification prompt
    const prompt = `You need to modify an existing ECS system.

System Name: ${params.systemName}
Current Description: ${existingSystem.description}
Current Required Components: [${existingSystem.requiredComponents?.join(', ') || ''}]
${params.newRequiredComponents ? `New Required Components: [${params.newRequiredComponents.join(', ')}]` : ''}

## AVAILABLE COMPONENTS IN THE SYSTEM:
${componentDescriptions}

## IMPORTANT: You MUST use the exact component names from the available list above!

## CRITICAL REQUIREMENT FOR requiredComponents:
The requiredComponents array MUST include EVERY component that your system code references.
If the system uses query(world, [A, B]) or accesses A.x[eid] or hasComponent(world, eid, C), 
then A, B, and C MUST ALL be in requiredComponents.

Common Fix: If you see "ReferenceError: ComponentName is not defined", add ComponentName to requiredComponents!

Current Code:
\`\`\`javascript
${existingSystem.code}
\`\`\`

${params.errorMessage ? `Error Encountered:
${params.errorMessage}

This error occurred during system execution. Please fix it.` : ''}

${params.issue ? `Issue to Address:
${params.issue}` : ''}

${params.newBehavior ? `New Behavior Required:
${params.newBehavior}` : ''}

${params.fixInstructions ? `Specific Fix Instructions:
${params.fixInstructions}` : ''}

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

### Relations (if needed):
- addComponent(world, eid, RelationName(targetEid)) - Create relationship
- hasComponent(world, eid, RelationName(targetEid)) - Check relationship
- removeComponent(world, eid, RelationName(targetEid)) - Remove relationship
- getRelationTargets(world, eid, RelationName) - Get all targets
- query(world, [RelationName(targetEid)]) - Query with specific relation
- query(world, [RelationName(Wildcard)]) - Query all with any relation

### LLM Integration (for async systems):
- miniLLM(prompt: string) - Async function that calls AI
- Use 'llmPrompt' as variable name to avoid conflicts
- Always use try/catch for JSON parsing

### String Handling:
- IMPORTANT: getString/setString are ONLY available in async/LLM systems!
- Regular systems: strings are stored as number hashes automatically
- Do NOT use getString/setString in regular (non-async) systems

IMPORTANT:
1. Fix any errors in the code
2. Only use components listed in requiredComponents
3. If a ReferenceError mentions missing components, ensure they're in requiredComponents
4. Keep the same function signature
5. For LLM systems, maintain async function pattern
6. If "getString is not defined" error: This means the system is NOT async - remove getString/setString usage
7. If "setString is not defined" error: This means the system is NOT async - remove getString/setString usage

Generate the complete FIXED system code.

Return a JSON object with:
{
  "code": "complete fixed function code",
  "changes": "brief description of what was changed"
}`;

    const response = await callLLM(prompt);
    const result = parseModificationResponse(response);
    
    if (!result) {
      return {
        success: false,
        error: 'Failed to parse modification response'
      };
    }
    
    // Validate the modified code
    if (!validateGeneratedCode(result.code)) {
      return {
        success: false,
        error: 'Modified code failed validation'
      };
    }
    
    // Update the system
    existingSystem.code = result.code;
    existingSystem.systemFn = undefined; // Clear cached function
    
    // Update dependencies if provided
    if (params.newRequiredComponents && Array.isArray(params.newRequiredComponents)) {
      // Validate that the new components actually exist
      for (const compName of params.newRequiredComponents) {
        if (!globalRegistry.getComponent(compName)) {
          return { 
            success: false, 
            error: `Cannot add non-existent component '${compName}' to system dependencies. Create it first.`
          };
        }
      }
      
      const oldComponents = existingSystem.requiredComponents || [];
      existingSystem.requiredComponents = params.newRequiredComponents;
      console.log(chalk.blue(`   Updated dependencies:`));
      console.log(chalk.gray(`     Old: [${oldComponents.join(', ')}]`));
      console.log(chalk.blue(`     New: [${params.newRequiredComponents.join(', ')}]`));
    }
    
    globalRegistry.registerSystem(params.systemName, existingSystem);
    
    // Track modification
    GodMode.lastCreation[godEid] = Date.now();
    
    console.log(chalk.green(`✅ Modified system: ${params.systemName}`));
    console.log(chalk.gray(`   Changes: ${result.changes}`));
    
    return {
      success: true,
      systemName: params.systemName,
      previousCode: existingSystem.code,
      newCode: result.code,
      changes: result.changes
    };
    
  } catch (error: any) {
    console.error(chalk.red('Failed to modify system:'), error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

function parseModificationResponse(response: string): { code: string, changes: string } | null {
  try {
    // Try to parse as JSON first
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.code) {
        return {
          code: parsed.code,
          changes: parsed.changes || 'Code updated'
        };
      }
    }
    
    // Fallback: extract code block
    const codeMatch = response.match(/```(?:javascript|js|typescript|ts)?\n?([\s\S]*?)```/);
    if (codeMatch) {
      return {
        code: codeMatch[1].trim(),
        changes: 'Code extracted from response'
      };
    }
    
    return null;
  } catch (error) {
    console.error('Failed to parse modification response:', error);
    return null;
  }
}