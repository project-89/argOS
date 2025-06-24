/**
 * Model Selection for Performance Optimization
 * Choose the right model for the task
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
});

// Model configurations
export const models = {
  // Ultra-fast for simple operations
  flash: google('gemini-1.5-flash'),
  
  // Balanced performance
  flashLatest: google('gemini-2.0-flash-exp'),
  
  // Most intelligent flash model - NEW!
  flash25: google('gemini-2.0-flash'),
  
  // Ultra-fast Gemini 2.5 Flash Lite - BLAZING FAST!
  flashLite: google('gemini-2.5-flash-lite-preview-06-17'),
  
  // High quality, slower
  pro: google('gemini-1.5-pro'),
  
  // Highest quality, experimental, slowest
  proPreview: google('gemini-2.5-pro-preview-06-05'),
};

// Model display names
export const modelNames = {
  flash: 'Gemini 1.5 Flash (Fastest)',
  flashLatest: 'Gemini 2.0 Flash Exp (Balanced)',
  flash25: 'Gemini 2.0 Flash (Smart & Fast)',
  flashLite: 'Gemini 2.5 Flash Lite (⚡ BLAZING FAST)',
  pro: 'Gemini 1.5 Pro (Quality)',
  proPreview: 'Gemini 2.5 Pro Preview (Highest Quality)',
};

// Allow manual override
let modelOverride: keyof typeof models | null = null;

export function setModelOverride(modelKey: keyof typeof models | null) {
  modelOverride = modelKey;
  if (modelKey) {
    console.log(`🎯 Model locked to: ${modelNames[modelKey]}`);
  } else {
    console.log('🔄 Model selection set to automatic');
  }
}

export function getCurrentModel(): string {
  return modelOverride || 'auto';
}

// Task complexity analyzer
export function selectModelForTask(input: string, toolCount: number = 0): any {
  // Check for manual override first
  if (modelOverride) {
    return models[modelOverride];
  }
  
  const inputLower = input.toLowerCase();
  
  // Simple queries - use flash
  if (
    inputLower.includes('list') ||
    inputLower.includes('show') ||
    inputLower.includes('what') ||
    inputLower.includes('inspect') ||
    inputLower.includes('/') || // Commands
    toolCount === 0
  ) {
    console.log('🚀 Using Flash model for quick response');
    return models.flash;
  }
  
  // Test/check operations - use flash latest
  if (
    inputLower.includes('test') ||
    inputLower.includes('check') ||
    inputLower.includes('run') ||
    inputLower.includes('verify')
  ) {
    console.log('⚡ Using Flash Latest for testing');
    return models.flashLatest;
  }
  
  // Complex generation - use pro
  if (
    inputLower.includes('create') ||
    inputLower.includes('build') ||
    inputLower.includes('generate') ||
    inputLower.includes('design')
  ) {
    // Very complex tasks still use preview
    if (
      inputLower.includes('complex') ||
      inputLower.includes('advanced') ||
      inputLower.includes('complete') ||
      inputLower.includes('full') ||
      inputLower.length > 200
    ) {
      console.log('🧠 Using Pro Preview for complex generation');
      return models.proPreview;
    }
    
    console.log('💫 Using Pro for standard generation');
    return models.pro;
  }
  
  // Default to smart & fast model
  console.log('⭐ Using Gemini 2.0 Flash (default)');
  return models.flash25;
}

// Concise prompts for different models
export const prompts = {
  flash: {
    system: `ECS God Agent. Be concise. Tools: create components/systems/entities, test, inspect.`,
    maxTokens: 2000,
  },
  
  standard: {
    system: `You are a God Agent for Entity Component System (ECS) architectures.
Create components (data containers), systems (behaviors), and entities.
Follow ECS best practices. Be clear and efficient.`,
    maxTokens: 4000,
  },
  
  full: {
    system: `You are a god-like AI agent with the power to create and modify Entity Component System (ECS) architectures. You can:

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

Be creative but ensure all generated code is safe and follows ECS best practices.`,
    maxTokens: 8000,
  },
  
  // Model-specific token limits
  tokenLimits: {
    flash: 8000,
    flashLatest: 8000,
    flash25: 8000,
    flashLite: 4000,
    pro: 8000,
    proPreview: 16000, // Pro Preview can handle more
  }
};