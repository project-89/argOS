/**
 * Dynamic UI Generation Action
 * Allows God to create custom UI for simulations on the fly
 */

import { World } from 'bitecs';
import { callLLM } from '../llm/interface.js';
import { getUniversalVisualizer } from '../visualization/universal-visualizer.js';

export interface UIGenerationParams {
  description: string;
  components: string[];
  interactionType: 'view-only' | 'interactive' | 'game';
  style?: 'minimal' | 'rich' | 'game-like' | 'artistic';
  features?: string[];
}

export interface UIGenerationResult {
  success: boolean;
  html?: string;
  css?: string;
  js?: string;
  error?: string;
}

export async function generateSimulationUI(
  _world: World,
  params: UIGenerationParams
): Promise<UIGenerationResult> {
  try {
    // Use the blazing fast model for UI generation
    const prompt = `Generate a complete HTML UI component for this simulation:

Description: ${params.description}
Available Components: ${params.components.join(', ')}
Interaction Type: ${params.interactionType}
Style: ${params.style || 'rich'}
${params.features ? `Special Features: ${params.features.join(', ')}` : ''}

Generate a self-contained HTML/CSS/JS component that:
1. Displays entities with these components in an appropriate way
2. Uses modern CSS for beautiful styling
3. Includes any necessary JavaScript for interactivity
4. Integrates with the socket.io connection to receive updates
5. Follows the style and interaction guidelines

The UI should expect to receive entity data in this format:
{
  id: number,
  name?: string,
  components: string[],
  data: { [componentName]: { [property]: value } },
  visualization: { type, position?, color?, icon?, label?, description? }
}

Generate ONLY the HTML content that will be injected into a div. Include <style> and <script> tags inline.
The socket connection is already available as 'socket' global variable.

Make it beautiful and appropriate for the simulation type!`;

    const uiCode = await callLLM(prompt, 'flashLite');
    
    // Extract HTML, CSS, and JS
    const styleMatch = uiCode.match(/<style[^>]*>([\s\S]*?)<\/style>/);
    const scriptMatch = uiCode.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    const htmlWithoutScripts = uiCode
      .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
      .trim();

    // Inject the UI if visualizer is running
    const visualizer = getUniversalVisualizer();
    if (visualizer) {
      visualizer.setCustomUI({
        html: htmlWithoutScripts,
        css: styleMatch ? styleMatch[1] : '',
        js: scriptMatch ? scriptMatch[1] : ''
      });
    }

    return {
      success: true,
      html: htmlWithoutScripts,
      css: styleMatch ? styleMatch[1] : '',
      js: scriptMatch ? scriptMatch[1] : ''
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Tool definition for God Agent
export const generateUITool = {
  name: 'generateUI',
  description: 'Generate custom UI for your simulation that adapts to its specific needs',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'What kind of UI you want (e.g., "particle visualization with trails", "RPG inventory screen")'
      },
      components: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of component names that will be displayed'
      },
      interactionType: {
        type: 'string',
        enum: ['view-only', 'interactive', 'game'],
        description: 'Level of user interaction'
      },
      style: {
        type: 'string',
        enum: ['minimal', 'rich', 'game-like', 'artistic'],
        description: 'Visual style of the UI'
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Special features like "particle trails", "health bars", "dialogue boxes"'
      }
    },
    required: ['description', 'components', 'interactionType']
  },
  execute: async ({ world, params }: any) => {
    const result = await generateSimulationUI(world, params);
    
    if (result.success) {
      return {
        success: true,
        message: `✨ Generated custom UI for: ${params.description}`,
        uiGenerated: true
      };
    } else {
      return {
        success: false,
        error: result.error
      };
    }
  }
};