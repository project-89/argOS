#!/usr/bin/env node
/**
 * Model Switching Demo
 * Shows performance differences between models
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { setModelOverride, modelNames, models } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function demoModelSwitching() {
  console.log(chalk.bold.cyan('\n🤖 MODEL SWITCHING DEMO\n'));
  
  const god = createAutonomousGod();
  const testInput = 'create a simple Health component with current and max values';
  
  console.log(chalk.yellow('Test task:', testInput));
  console.log(chalk.gray('─'.repeat(60)) + '\n');
  
  // Test each model
  const modelsToTest: (keyof typeof models)[] = ['flash', 'flash25', 'pro'];
  
  for (const modelKey of modelsToTest) {
    console.log(chalk.cyan(`\nTesting: ${modelNames[modelKey]}`));
    console.log(chalk.gray('─'.repeat(40)));
    
    // Switch model
    setModelOverride(modelKey);
    
    const start = performance.now();
    
    try {
      await processAutonomousInput(god, testInput);
      
      const duration = performance.now() - start;
      console.log(chalk.green(`\n⏱️  Time: ${(duration / 1000).toFixed(2)}s`));
      
    } catch (error) {
      console.error(chalk.red('Error:', error));
    }
    
    // Clear components for next test
    console.log(chalk.gray('\nClearing for next test...'));
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Reset to auto
  setModelOverride(null);
  console.log(chalk.cyan('\n✅ Demo complete! Model reset to automatic selection.\n'));
}

demoModelSwitching();