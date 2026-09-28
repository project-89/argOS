/**
 * Modify System Action
 * Allows God to update and fix existing systems based on errors or new requirements
 */

import { World } from 'bitecs';
import { z } from 'zod';
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
    
    // Create a markdown-formatted list of all available components for the prompt
    const componentManifest = globalRegistry.listComponents().map(name => {
      const comp = globalRegistry.getComponent(name);
      if (!comp) return `- ${name} (error: not found)`;
      const props = comp.schema?.properties?.map(p => `${p.name}: ${p.type}`).join(', ') || 'No properties';
      return `- **${name}**: { ${props} } // *${comp.schema?.description || 'No description'}*`;
    }).join('\n');

    // Build modification prompt using structured approach
    const prompt = `You are an expert ECS programmer, and your task is to debug a broken system.

## BROKEN SYSTEM
**Name:** ${params.systemName}
**Current Dependencies:** [${existingSystem.requiredComponents?.join(', ') || 'None'}]
**Error Message:** ${params.errorMessage || 'No error provided, check for logical issues.'}

**Current Code:**
\`\`\`javascript
${existingSystem.code}
\`\`\`

## AVAILABLE COMPONENTS
${componentManifest}

## DEBUGGING TASK
Analyze the error and the code. Then, provide a fixed version in the JSON format below.
- **\`ReferenceError\` means you MUST add the missing component to \`requiredComponents\`.**
- **\`TypeError\` often means you are using a property that doesn't exist on a component, or using a method like \`.push\` on a non-array. Check the component manifest!**
- **\`getString/setString is not defined\` means the system is NOT async - remove these function calls entirely.**
- **\`Cannot create property 'undefined' on string\` means setString is used WRONG. Use: setString(Component.prop, eid, "value") NOT setString(Component.prop[eid], "value")**
- **\`SyntaxError: Unexpected token\` in JSON.parse means miniLLM returned plain text, not JSON. Wrap JSON.parse in try/catch and handle plain text responses!**
- **\`ecs is not defined\` means you're using 'ecs.something' - There is NO ecs object! Use functions directly: query(world, [...]) NOT ecs.query(...)**

${params.issue ? `**Issue to Address:** ${params.issue}` : ''}
${params.newBehavior ? `**New Behavior Required:** ${params.newBehavior}` : ''}
${params.fixInstructions ? `**Specific Fix Instructions:** ${params.fixInstructions}` : ''}

## YOUR RESPONSE
Fill out this JSON object with the corrected system.

{
  "changes": "A brief, one-sentence description of the fix.",
  "newRequiredComponents": [
    "ComponentA", "ComponentB" // The new, COMPLETE list of dependencies.
  ],
  "newCode": "function ${params.systemName}(world) {\\n  // Your FIXED JavaScript code here...\\n}"
}`;

    // Use generateStructured to get the response
    const { generateStructured } = await import('../llm/interface.js');
    const fix = await generateStructured(
      prompt,
      z.object({
        changes: z.string(),
        newRequiredComponents: z.array(z.string()),
        newCode: z.string(),
      })
    );
    
    // Validate that the new components actually exist
    for (const compName of fix.newRequiredComponents) {
      if (!globalRegistry.getComponent(compName)) {
        return { 
          success: false, 
          error: `Cannot add non-existent component '${compName}' to system dependencies. Create it first.`
        };
      }
    }
    
    // Ensure the function code is properly formatted
    const finalCode = fix.newCode.includes('function') ? fix.newCode : `function ${params.systemName}(world) {\n${fix.newCode}\n}`;
    
    // Validate the modified code
    if (!validateGeneratedCode(finalCode)) {
      return {
        success: false,
        error: 'Modified code failed validation'
      };
    }
    
    // Update the system
    const oldComponents = existingSystem.requiredComponents || [];
    existingSystem.code = finalCode;
    existingSystem.systemFn = undefined; // Clear cached function
    existingSystem.requiredComponents = fix.newRequiredComponents;
    
    if (oldComponents.join(',') !== fix.newRequiredComponents.join(',')) {
      console.log(chalk.blue(`   Updated dependencies:`));
      console.log(chalk.gray(`     Old: [${oldComponents.join(', ')}]`));
      console.log(chalk.blue(`     New: [${fix.newRequiredComponents.join(', ')}]`));
    }
    
    globalRegistry.registerSystem(params.systemName, existingSystem);
    
    // Track modification
    GodMode.lastCreation[godEid] = Date.now();
    
    console.log(chalk.green(`✅ Modified system: ${params.systemName}`));
    console.log(chalk.gray(`   Changes: ${fix.changes}`));
    
    return {
      success: true,
      systemName: params.systemName,
      previousCode: existingSystem.code,
      newCode: finalCode,
      changes: fix.changes
    };
    
  } catch (error: any) {
    console.error(chalk.red('Failed to modify system:'), error);
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

// parseModificationResponse removed - using structured output instead