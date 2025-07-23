/**
 * I/O System Generation
 * Allows God to create input/output systems for CLI interaction
 */

import { z } from 'zod';
import { World } from 'bitecs';
import { globalRegistry } from '../components/registry.js';
import { GodMode, recordCreation } from '../components/god-components.js';
import { generateStructured } from '../llm/interface.js';

export const ecsGenerateIOSystemSchema = z.object({
  description: z.string(),
  ioType: z.enum(['input', 'output', 'interactive']),
  trigger: z.string().describe('What triggers this I/O (e.g., "user command", "entity state change", "time interval")'),
  requiredComponents: z.array(z.string()),
  examples: z.array(z.string()).optional(),
});

export type EcsGenerateIOSystemParams = z.infer<typeof ecsGenerateIOSystemSchema>;

export interface IOSystemGenerationResult {
  success: boolean;
  systemName?: string;
  code?: string;
  error?: string;
}

const IOSystemDesignSchema = z.object({
  name: z.string().regex(/^[A-Z][a-zA-Z0-9]*IOSystem$/, 'I/O system names must end with "IOSystem"'),
  description: z.string(),
  requiredComponents: z.array(z.string()),
  code: z.string(),
});

export async function ecsGenerateIOSystem(
  world: World,
  params: EcsGenerateIOSystemParams,
  godEid: number
): Promise<IOSystemGenerationResult> {
  // Check god's power level
  const godLevel = GodMode.level[godEid];
  if (godLevel < 30) {
    return {
      success: false,
      error: 'Insufficient god level. Need at least level 30 to create I/O systems.',
    };
  }

  try {
    // Get available components
    const componentManifest = globalRegistry.listComponents()
      .map(name => {
        const comp = globalRegistry.getComponent(name);
        return `- ${name}: ${comp?.schema.description || 'No description'}`;
      })
      .join('\n');

    const ioTypeGuides = {
      input: `
This system should:
- Listen for user input or commands
- Parse and validate input
- Update entity states based on input
- Use readline or process.stdin for CLI input
- Handle commands like "/speak <message>", "/move <direction>", etc.`,
      
      output: `
This system should:
- Monitor entity states
- Format and display information
- Use chalk for colored output
- Show entity actions, thoughts, or state changes
- Update the CLI display with relevant information`,
      
      interactive: `
This system should:
- Combine input and output functionality
- Create a dialogue or interaction loop
- Allow users to interact with specific entities
- Provide feedback on user actions
- Create an engaging CLI experience`
    };

    const prompt = `Design an I/O system for CLI interaction.

DESCRIPTION: ${params.description}
I/O TYPE: ${params.ioType}
TRIGGER: ${params.trigger}

${ioTypeGuides[params.ioType]}

AVAILABLE COMPONENTS:
${componentManifest}

REQUIRED COMPONENTS TO USE:
${params.requiredComponents.join(', ')}

${params.examples ? `EXAMPLES:\n${params.examples.join('\n')}` : ''}

AVAILABLE CLI TOOLS:
- readline module for input (already imported as 'readline')
- chalk for colored output (already imported as 'chalk')
- console.log/warn/error for output
- logAction(eid, action) - Log entity actions
- logThought(eid, thought) - Log entity thoughts

The system will be called regularly (based on trigger).
For input systems, use readline.createInterface or similar patterns.
For output systems, format data nicely with chalk colors.

Remember:
- Component access: Component.property[eid]
- This is a regular system (not async unless handling promises)
- The system should enhance the CLI experience`;

    const design = await generateStructured(
      prompt,
      IOSystemDesignSchema
    );

    // Check if system already exists
    if (globalRegistry.getSystem(design.name)) {
      return {
        success: false,
        error: `System ${design.name} already exists`,
      };
    }

    // Register the I/O system
    globalRegistry.registerSystem(design.name, {
      code: design.code,
      requiredComponents: design.requiredComponents,
      description: design.description,
      metadata: {
        ioType: params.ioType,
        trigger: params.trigger,
        createdBy: godEid,
        createdAt: Date.now(),
      }
    });

    // Update god's creation stats
    recordCreation(world, godEid);

    console.log(`✨ Generated I/O system: ${design.name}`);
    console.log(`   Type: ${params.ioType}`);
    console.log(`   Trigger: ${params.trigger}`);

    return {
      success: true,
      systemName: design.name,
      code: design.code,
    };
  } catch (error) {
    console.error('I/O system generation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}