#!/usr/bin/env tsx
/**
 * Check and fix system errors
 */

import { createAutonomousGod, processAutonomousInput } from './src/agents/autonomous-god.js';
import { setModelOverride } from './src/llm/model-selector.js';
import chalk from 'chalk';

async function checkAndFixErrors() {
  console.log(chalk.bold.cyan('\n🔧 CHECKING SYSTEM ERRORS\n'));
  
  // Use Flash Lite for speed
  setModelOverride('flashLite');
  
  const god = createAutonomousGod();
  
  try {
    // Create a simple test
    await processAutonomousInput(god, 
      `Create a simple test: one Neuron component with membranePotential property,
       one neuron entity with membranePotential=-70,
       and one NeuronSystem that increases membranePotential by 1 each tick`
    );
    
    console.log(chalk.yellow('\n🔍 Checking for errors...'));
    await processAutonomousInput(god, 'Check for system errors');
    
    console.log(chalk.yellow('\n🏃 Running the system...'));
    await processAutonomousInput(god, 'Run NeuronSystem 5 times');
    
    console.log(chalk.yellow('\n🔍 Inspecting neuron...'));
    await processAutonomousInput(god, 'Inspect the neuron entity to see if membranePotential changed');
    
    console.log(chalk.green('\n✅ Test complete!'));
  } catch (error) {
    console.error(chalk.red('Error:', error));
  }
}

checkAndFixErrors().catch(console.error);