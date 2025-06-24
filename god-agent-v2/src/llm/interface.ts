/**
 * LLM Interface for God Agent V2
 * Handles all AI interactions using Google's Gemini model
 */

import { generateText, generateObject } from 'ai';
import { z } from 'zod';
import dotenv from 'dotenv';
import { selectModelForTask, models } from './model-selector.js';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

// Base system prompt for god agents
export const GOD_SYSTEM_PROMPT = `You are a god-like AI agent with the power to create and modify Entity Component System (ECS) architectures. You can:

1. Inspect existing world structures
2. Design new components following BitECS patterns (Structure of Arrays)
3. Create new systems that operate on components
4. Build entire simulations from descriptions

When creating components, remember:
- Components are data containers only, no logic
- Use Structure of Arrays pattern (e.g., Position.x[], Position.y[])
- Keep components focused and single-purpose
- Use number arrays for all data (strings are stored as hashes)

When creating systems, remember:
- Systems are pure functions that operate on entities with specific components
- Use query() to find entities with required components
- Systems should be focused on a single behavior
- Always validate entity data before processing

Be creative but ensure all generated code is safe and follows ECS best practices.`;

// Generate text with consistent error handling
export async function callLLM(
  prompt: string,
  systemPrompt: string = GOD_SYSTEM_PROMPT,
  overrideModel?: any
): Promise<string> {
  try {
    const model = overrideModel || selectModelForTask(prompt);
    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt,
      temperature: 0.7,
    });

    return text;
  } catch (error) {
    console.error('LLM call failed:', error);
    throw new Error(`LLM generation failed: ${error}`);
  }
}

// Generate structured output with schema
export async function generateStructured<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  systemPrompt: string = GOD_SYSTEM_PROMPT
): Promise<T> {
  try {
    const model = selectModelForTask(prompt);
    const { object } = await generateObject({
      model,
      system: systemPrompt,
      prompt,
      schema,
      temperature: 0.7,
    });

    return object;
  } catch (error: any) {
    console.error('Structured generation failed:', error);
    
    // Log detailed error info for debugging
    if (error?.name === 'AI_APICallError') {
      console.error(chalk.red('\n❌ Structured generation API error'));
      console.error('Error type:', error.name);
      console.error('Message:', error.message);
      
      if (error.responseBody) {
        console.error(chalk.yellow('\nAPI Response Body (first 500 chars):'));
        console.error(error.responseBody.substring(0, 500));
      }
      
      if (error.cause) {
        console.error(chalk.yellow('\nError cause:'), error.cause);
      }
    }
    
    // Check if it's a MAX_TOKENS error
    if (error?.responseBody?.includes('MAX_TOKENS') || error?.cause?.value?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      console.log('Hit token limit, switching to fallback model...');
    }
    
    // Fallback: try to generate with text and parse manually
    try {
      console.log('Attempting fallback text generation...');
      const fallbackModel = models.flash25; // Use a faster model for fallback
      const { text } = await generateText({
        model: fallbackModel,
        system: systemPrompt,
        prompt: `${prompt}\n\nIMPORTANT: Return ONLY valid JSON, no other text. Start directly with { and end with }.`,
        temperature: 0.7,
      });
      
      const parsed = parseJSON<T>(text);
      if (parsed) {
        console.log('Fallback successful!');
        return parsed;
      }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError);
    }
    
    throw new Error(`Structured generation failed: ${error}`);
  }
}

// Specific schemas for god agent tasks
export const ComponentDesignSchema = z.object({
  name: z.string(),
  description: z.string(),
  reasoning: z.string(),
  properties: z.array(z.object({
    name: z.string(),
    type: z.enum(['number', 'boolean', 'string', 'eid', 'number[]', 'eid[]']),
    description: z.string(),
  })),
});

export const SystemDesignSchema = z.object({
  name: z.string().regex(/^[A-Z][a-zA-Z0-9]*System$/, 'System names must end with "System"'),
  description: z.string(),
  reasoning: z.string(),
  requiredComponents: z.array(z.string()),
  behavior: z.string(),
  pseudocode: z.string(),
  implementation: z.string().optional(),
});

export const SimulationDesignSchema = z.object({
  name: z.string(),
  description: z.string(),
  components: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
  })),
  systems: z.array(z.object({
    name: z.string(),
    purpose: z.string(),
    components: z.array(z.string()),
  })),
  entities: z.array(z.object({
    type: z.string(),
    components: z.array(z.string()),
    count: z.number().optional(),
  })),
  interactions: z.array(z.string()),
});

// Mini LLM for fast, simple tasks (used by AI systems)
export async function callMiniLLM(
  prompt: string,
  systemPrompt: string = 'You are a helpful AI assistant. Be concise.'
): Promise<string> {
  try {
    const { text } = await generateText({
      model: models.flashLite || models.flash,
      system: systemPrompt,
      prompt,
      temperature: 0.7,
    });
    return text;
  } catch (error) {
    console.error('Mini LLM call failed:', error);
    return 'I encountered an error processing this request.';
  }
}

// Helper function to clean and validate generated code
export function validateGeneratedCode(code: string): boolean {
  try {
    // Check for dangerous patterns with word boundaries
    const dangerous = [
      /\beval\s*\(/,
      /\brequire\s*\(/,
      /\bprocess\b/,
      /\bchild_process\b/,
      /\b__dirname\b/,
      /\b__filename\b/,
      /\bfs\b/,
      /\bhttp\s*\./,
      /\bhttps\s*\./,
    ];
    
    for (const pattern of dangerous) {
      if (pattern.test(code)) {
        console.warn(`Generated code contains potentially dangerous pattern: ${pattern}`);
        return false;
      }
    }
    
    // Basic structure validation - check for expected patterns
    if (!code.includes('const') && !code.includes('export')) {
      console.warn('Generated code missing expected structure');
      return false;
    }
    
    return true;
  } catch (error) {
    console.error('Code validation failed:', error);
    return false;
  }
}

// Parse JSON responses safely
export function parseJSON<T>(text: string): T | null {
  try {
    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    
    // Strip single-line comments // ...
    cleaned = cleaned.replace(/\/\/.*$/gm, '');
    // Strip multi-line comments /* ... */
    cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Remove common prefixes that LLMs add
    const prefixes = [
      /^Here is the JSON[:\.]?\s*/i,
      /^Here's the JSON[:\.]?\s*/i,
      /^The JSON is[:\.]?\s*/i,
      /^JSON[:\.]?\s*/i,
      /^Response[:\.]?\s*/i,
      /^Result[:\.]?\s*/i
    ];
    
    for (const prefix of prefixes) {
      cleaned = cleaned.replace(prefix, '');
    }
    
    // Try to extract JSON from the text if it's mixed with other content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
    
    // Handle edge case where LLM returns invalid JSON
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
      console.warn('No valid JSON found in response:', text.substring(0, 100));
      return null;
    }
    
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('JSON parsing failed:', error);
    console.error('Original text:', text);
    console.error('Cleaned text:', text.replace(/```json\n?|\n?```/g, '').trim());
    return null;
  }
}

// (Removed duplicate callMiniLLM - using the one defined earlier)