#!/usr/bin/env tsx
/**
 * Simple Component Test
 * Tests if component generation works with shorter prompts
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { setModelOverride } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function testSimpleComponent() {
  console.log(chalk.bold.cyan('\n🧪 SIMPLE COMPONENT TEST\n'));
  
  // Try different models
  const models = ['flash25', 'flashLite', 'pro'];
  
  for (const modelName of models) {
    console.log(chalk.yellow(`\n📍 Testing with model: ${modelName}`));
    setModelOverride(modelName as any);
    
    const god = createAutonomousGod();
    
    try {
      // Very simple prompt
      await processAutonomousInput(god, 'Create a Position component with x and y properties');
      console.log(chalk.green(`✅ ${modelName} worked!`));
    } catch (error) {
      console.log(chalk.red(`❌ ${modelName} failed:`, error));
    }
  }
  
  console.log(chalk.cyan('\n\n📊 Summary complete!'));
}

testSimpleComponent().catch(console.error);